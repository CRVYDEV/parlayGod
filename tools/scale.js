// THE POPULATION-SCALE HARNESS — does the SOCIAL economy function with a town in it?
//
// The seventh harness, and it measures the one axis the other six cannot:
//
//   tools/sim.js         — does the economy conserve, and how big is each faucet   (sequential, few)
//   tools/playthrough.js — what does one person experience                          (one player)
//   tools/pgcheck.js     — the node-pg + real-Postgres contract                     (a few pairs)
//   tools/loadtest.js    — many players at once: deadlocks, torn transfers          (concurrency)
//   tools/chaos.js       — what survives being interrupted                          (crash/restart)
//   tools/mobile.js      — do the screens lay out at phone size                     (layout)
//   tools/scale.js       — DOES THE MULTIPLAYER ECONOMY HAVE A COUNTERPARTY         (this file)
//
// Why it exists. Every economic proof in this repo is about one player or about conservation. Neither
// asks the question the whole Risk-to-Earn thesis rests on: with a town's worth of people in the
// city, is there anyone on the OTHER SIDE of a trade? A market with perfect accounting and no
// counterparty is a dead market, and nothing here would have noticed. The progression harness already
// measured the shape of the problem from the other end — a plausible player reaches level 44 and
// $1.9M in seven days having never once interacted with another human.
//
// This drives a POPULATION through a mixed diet of behaviour over warped days, then takes a census of
// every player-to-player market: how many have a live counterparty, how much of what got posted got
// taken, and where the money ended up. It reports rather than prescribes — liquidity numbers are a
// finding for the founder, not a pass/fail. What it DOES assert is the two things that would be bugs
// rather than balance:
//
//   1. §10.4 drift DELTA is zero across the whole run (the loadtest discipline — this harness seeds
//      starting cash so players can reach the markets at all, so the baseline is non-zero by
//      construction; what must not move is the delta).
//   2. Every market is REACHABLE — if a market ends with nobody able to post at all, that is a gate
//      bug, not a quiet town, and it fails.
//
// Runs on pg-mem by default (portable, like sim.js); set DATABASE_URL to drive real Postgres.
// Knobs: SCALE_PLAYERS (36), SCALE_DAYS (5), SCALE_SWEEP (a comma list of populations — runs each and
// prints the DENSITY CURVE, which is what answers "how many people does this game need to feel alive").
process.env.MOD_KEY = process.env.MOD_KEY || 'scale-mod-key';
process.env.MARKET_SEED = process.env.MARKET_SEED || 'scale-harness-seed-000000000000';
process.env.SOCIAL_VERIFY_MODE = 'off';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { runPopulation, runResidentBehaviour } from '../src/population.js';

const PLAYERS = Number(process.env.SCALE_PLAYERS || 36);
const DAYS = Number(process.env.SCALE_DAYS || 5);
const SWEEP = (process.env.SCALE_SWEEP || '').split(',').map((n) => Number(n.trim())).filter(Boolean);

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const pct = (num, den) => (den ? Math.round((num / den) * 100) : null);

// One whole run of the town, start to finish, on its own database. Returns the numbers rather than
// printing them, so the sweep can run it at several populations and compare.
async function runTown({ players: PLAYERS, days: DAYS, verbose = true }) {
const app = await buildServer();
const pool = app.pool;

const call = async (method, url, token, body) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  let json = null; try { json = res.json(); } catch { /* empty body */ }
  return { code: res.statusCode, body: json || {} };
};

// ── the population ──────────────────────────────────────────────────────────────────────────────
// Archetypes, not optimal play. A real town is a mix, and a market's liquidity depends on whether the
// people who WANT to be on each side actually exist — which a single scripted optimum cannot show.
const ARCHETYPES = ['grinder', 'trader', 'lender', 'killer', 'gambler', 'idler'];
const NAMES = ['Vito', 'Sal', 'Nico', 'Rocco', 'Enzo', 'Gino', 'Bruno', 'Carmine', 'Dante', 'Fabio',
  'Marco', 'Paulie', 'Silvio', 'Tommy', 'Angelo', 'Bobby', 'Chris', 'Donnie', 'Eddie', 'Frankie'];

const players = [];
for (let i = 0; i < PLAYERS; i++) {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  const name = `${NAMES[i % NAMES.length]} Scale${i}`;
  await call('POST', '/v1/character', token, { name });
  const me = (await call('GET', '/v1/me', token)).body.character;
  if (!me) continue;
  players.push({ token, id: me.id, name, loc: me.loc, kind: ARCHETYPES[i % ARCHETYPES.length] });
}
assert(players.length >= PLAYERS * 0.9, `only ${players.length}/${PLAYERS} characters were created`);

// Seed reachability, not outcomes. Players need a stake and a level to be ALLOWED into the markets
// (level floors, minimum stakes, garage caps). Seeding is why the assertion below is a DELTA: the
// baseline drift is whatever this SQL created, and the run must not move it.
const ids = players.map((p) => `'${p.id}'`).join(',');
await pool.query(`UPDATE characters SET respect=25000, cash=4000000, energy=100, nerve=50, muscle=60, cunning=60, speed=60 WHERE id IN (${ids})`);

const before = await runLedgerInvariants(pool, { alert: false });
const baseline = Object.fromEntries(before.checks.map((c) => [c.name, c.drift]));

// ── the days ────────────────────────────────────────────────────────────────────────────────────
// Each round: every player takes one archetype action, then the world ticks (NPC residents act, the
// clock warps a day). Failures are EXPECTED and counted — a gate refusing a bad move is the game
// working, and a harness that treated every 4xx as fatal would only ever test the happy path.
const posted = { listing: 0, order: 0, loan: 0, contract: 0, guard: 0, duel: 0, fade: 0, car: 0, club: 0 };
const taken = { listing: 0, order: 0, loan: 0, contract: 0, guard: 0, duel: 0 };
const errors = new Map();
const skipped = new Map();   // a branch that could not even ATTEMPT — counted, never silently nothing
const note = (r) => { if (r.code !== 200 && r.body?.error) errors.set(r.body.error, (errors.get(r.body.error) || 0) + 1); return r; };
const skip = (why) => skipped.set(why, (skipped.get(why) || 0) + 1);

// ── AVAILABILITY: the measurement that actually answers the question ────────────────────────────
// The first version of this harness reported `taken / posted` as "liquidity" and it was WRONG — not
// slightly, structurally. `taken` is bounded by PER-PLAYER caps (one debt at a time, one bodyguard,
// a duel cooldown), so over a run it can never exceed the number of distinct shoppers. With posts
// scaling as players/6 per round and takes capped at players/2 for the whole run, the ratio collapses
// to 3/rounds — INDEPENDENT OF POPULATION. It matched the data exactly (6 rounds → 50%, 15 → 20%),
// which is how a number that says nothing about the game can look like a finding about it.
//
// What actually answers "is anyone on the other side" is per-ATTEMPT: when a player went looking,
// was there an eligible counterparty on the board at all? That is density-sensitive by construction,
// and it separates the two reasons a trade does not happen — nobody was there (a dead market) versus
// a gate said no (the game working as designed).
const shopped = {};   // market -> { looked, found, took, blocked }
const look = (m) => (shopped[m] ||= { looked: 0, found: 0, took: 0, blocked: 0 });
const attempt = (m, counterparty) => { const s = look(m); s.looked++; if (counterparty) s.found++; return !!counterparty; };
const result = (m, ok) => { const s = look(m); if (ok) s.took++; else s.blocked++; };

async function act(p) {
  const other = pick(players.filter((x) => x.id !== p.id));
  switch (p.kind) {
    case 'grinder': {
      note(await call('POST', '/v1/crimes/pick', p.token));
      // and the iron: boost a car, then put it on the block. This is the CAR AUCTION market — it
      // was censused but never driven, so "every market reachable" only ever covered 7 of 9.
      const car = (await call('GET', '/v1/me', p.token)).body.character?.cars?.find((c) => !c.listed && !c.pledged);
      if (car) {
        const r = note(await call('POST', '/v1/market', p.token, { kind: 'car', carId: car.id, minBid: 5000, hours: 24 }));
        if (r.code === 200) posted.car++;
      } else note(await call('POST', '/v1/garage/boost', p.token));
      break;
    }
    case 'trader': {
      // buy goods at the local price, then put them on the board for someone else
      // `prices.goods` is an id -> price MAP, not an array. A first cut read `goods[0]`, got
      // undefined, and this whole branch did nothing for the entire run while reporting no error —
      // which is why `skip()` exists: a branch that cannot attempt is counted, not silent.
      // `prices.goods` is keyed by DISTRICT and THEN by good — two layers, and goods are pinned to
      // the dock you are standing on. A first cut read the outer map's first entry and cheerfully
      // tried to buy a district ('docks') as a commodity; the run reported 54 × bad_good rather than
      // silence, which is the only reason it was findable.
      const prices = (await call('GET', '/v1/market/prices', p.token)).body;
      const here = Object.entries(prices?.goods?.[p.loc] || {});
      if (!here.length) { skip(`no goods priced at ${p.loc}`); break; }
      // The field is `price`, not `unitPrice` — the neighbouring /v1/exchange/list takes `unitPrice`
      // and a first cut sent that here. The handler read `undefined`, floored it to 0 and threw
      // min_price on EVERY attempt, so both black-market branches posted nothing for a whole run.
      // Exactly the class test/client.js check 3 exists for, and the reason `posted` is asserted.
      const [goodId, price] = here[0];
      // Buy one, list one: the trunk is capped (cargoCap), and a net-positive diet fills it and then
      // spends the rest of the run refusing with `cargo` instead of measuring anything.
      note(await call('POST', '/v1/goods/buy', p.token, { goodId, qty: 1 }));
      const r = note(await call('POST', '/v1/market', p.token, { kind: 'good', goodId, qty: 1, price: Math.round(price * 1.1) }));
      if (r.code === 200) posted.listing++;
      const o = note(await call('POST', '/v1/market/order', p.token, { goodId, qty: 1, price: Math.round(price * 0.9) }));
      if (o.code === 200) posted.order++;
      break;
    }
    case 'lender': {
      const r = note(await call('POST', '/v1/loans', p.token, { amount: 20000, rate: 0.25, hours: 24 }));
      if (r.code === 200) posted.loan++;
      break;
    }
    case 'killer': {
      const r = note(await call('POST', `/v1/streets/${other.id}/bounty`, p.token, { amount: 3000, kind: 'hospitalize' }));
      if (r.code === 200) posted.contract++;
      const g = note(await call('POST', '/v1/bodyguard/offer', p.token, { price: 15000 }));
      if (g.code === 200) posted.guard++;
      break;
    }
    case 'gambler': {
      // the club: one per district, so most attempts refuse — which is the point, a market with a
      // hard supply cap still has to be REACHABLE by whoever gets there first.
      if (!p.club) {
        const c = note(await call('POST', `/v1/speakeasy/${p.loc}/open`, p.token));
        if (c.code === 200) { posted.club++; p.club = true; }
      }
      const d = note(await call('POST', '/v1/duels/list', p.token, { limit: 5000 }));
      if (d.code === 200) posted.duel++;
      const f = note(await call('POST', '/v1/casino/fade', p.token, { limit: 5000 }));
      if (f.code === 200) posted.fade++;
      break;
    }
    default: break;   // the idler is load-bearing: a town where everyone plays optimally is not a town
  }
}

// The other side of every trade. Liquidity is not "somebody posted", it is "somebody took" — so each
// round a slice of the population goes shopping against whatever the board is actually offering.
async function shop(p) {
  const board = (await call('GET', '/v1/market', p.token)).body;
  // `seller` on the board is a NAME, not a {id} — a first cut compared `l.seller?.id` and so never
  // filtered anything, and the run reported the resulting self-buys as `own` refusals.
  const lot = (board.listings || []).find((l) => l.kind === 'good' && l.seller !== p.name);
  if (attempt('goods lots', lot)) {
    const r = note(await call('POST', `/v1/market/${lot.id}/buy`, p.token, { qty: 1 }));
    result('goods lots', r.code === 200); if (r.code === 200) taken.listing++;
  }

  const loans = (await call('GET', '/v1/loans', p.token)).body;
  const offer = (loans.offers || []).find((l) => l.lender?.id !== p.id);
  if (attempt('loan offers', offer)) {
    const r = note(await call('POST', `/v1/loans/${offer.id}/take`, p.token));
    result('loan offers', r.code === 200); if (r.code === 200) taken.loan++;
  }

  const guards = (await call('GET', '/v1/streets', p.token)).body;
  const guard = (guards.streets || []).find((s) => s.guardPrice && s.id !== p.id);
  if (attempt('bodyguards', guard)) {
    const r = note(await call('POST', `/v1/bodyguard/hire/${guard.id}`, p.token));
    result('bodyguards', r.code === 200); if (r.code === 200) taken.guard++;
  }

  const duels = (await call('GET', '/v1/duels', p.token)).body;
  const rival = (duels.board || duels.duelists || []).find((d) => d.id !== p.id && d.limit);
  if (attempt('duel listings', rival)) {
    const r = note(await call('POST', `/v1/duels/${rival.id}`, p.token, { amount: 1000 }));
    result('duel listings', r.code === 200); if (r.code === 200) taken.duel++;
  }

  // A buy order's counterparty is a SELLER standing at the pinned dock with the goods in the trunk.
  // Without this the order row read "0% taken", which says nothing about the game and everything
  // about the harness. But it must only be ATTEMPTED by someone who actually holds the good —
  // a first cut fired it from every shopper, most of them idlers with empty trunks, and the 8%
  // that came back measured "did a random player happen to be carrying that" rather than the
  // market's depth. A shopper with nothing to sell is a skip, not a failed fill.
  const cargo = (await call('GET', '/v1/me', p.token)).body.character?.cargo || {};
  const order = (board.listings || []).find((l) => l.kind === 'order' && l.seller !== p.name
    && (cargo[l.good] || 0) > 0 && l.district === p.loc);
  if (attempt('buy orders', order)) {
    const r = note(await call('POST', `/v1/market/${order.id}/fill`, p.token, { qty: 1 }));
    result('buy orders', r.code === 200); if (r.code === 200) taken.order++;
  } else if ((board.listings || []).some((l) => l.kind === 'order')) skip('no goods on hand at the order\'s dock to fill with');

  // A contract's counterparty is whoever collects it. A hospitalize pot pays on a jump, so the
  // shopper goes looking for a mark with money on their head — the actual liquidity question.
  const pots = (await call('GET', '/v1/contracts', p.token)).body.contracts || [];
  const mark = pots.find((c) => c.kind === 'hospitalize' && c.target?.id !== p.id);
  if (attempt('contracts', mark)) {
    const r = note(await call('POST', `/v1/streets/${mark.target.id}/jump`, p.token));
    result('contracts', r.code === 200 && !!r.body?.bounty); if (r.code === 200 && r.body?.bounty) taken.contract++;
  }
}

const ROUNDS_PER_DAY = 3;
for (let day = 0; day < DAYS; day++) {
  for (let round = 0; round < ROUNDS_PER_DAY; round++) {
    for (const p of players) await act(p);
    for (const p of players.slice(0, Math.ceil(players.length / 2))) await shop(p);
  }
  await runPopulation(pool);          // the city tops itself up and retires drained residents
  await runResidentBehaviour(pool);   // residents advertise consent limits, post offers/orders
  // Warp a day. Everything here is lazy-accrual off `last_accrued_at`, so pulling that clock back IS
  // moving time — the same trick tools/sim.js uses. Energy and nerve are refilled because a real day
  // regenerates them; without that the population starves after round one and measures nothing.
  await pool.query("UPDATE characters SET last_accrued_at = last_accrued_at - interval '1 day', energy=100, nerve=50 WHERE NOT is_npc");
}

// ── the census ──────────────────────────────────────────────────────────────────────────────────
const n = async (q) => Number((await pool.query(q)).rows[0]?.n || 0);
// Columns: name, live count, whether THIS harness drives a post into it, and which flow row it
// corresponds to. The `driven` flag matters because an undriven market reading EMPTY says nothing
// about the game and would otherwise read as a finding. The flow key powers the census self-check
// at the bottom.
const MARKETS = [
  ['black market — car auctions', await n("SELECT COUNT(*) n FROM market_listings WHERE kind='car' AND status='live'"), true, 'car'],
  ['black market — goods lots', await n("SELECT COUNT(*) n FROM market_listings WHERE kind='good' AND status='live'"), true, 'listing'],
  ['black market — buy orders', await n("SELECT COUNT(*) n FROM market_listings WHERE kind='order' AND status='live'"), true, 'order'],
  // 'open', not 'offered' — a first cut guessed the status word, counted zero every time and would
  // have published "the Shylock ended EMPTY" as a finding about the game. A census that reads a
  // column wrong reports confident nonsense, so each of these was checked against the module.
  ['the shylock — open loan offers', await n("SELECT COUNT(*) n FROM loans WHERE status='open'"), true, 'loan'],
  ['the shylock — active debts', await n("SELECT COUNT(*) n FROM loans WHERE status='active'"), true, null],
  ['the contract board — live pots', await n('SELECT COUNT(*) n FROM bounties'), true, 'contract'],
  ['bodyguards for hire', await n('SELECT COUNT(*) n FROM characters WHERE guard_price IS NOT NULL AND alive'), true, 'guard'],
  ['the dueling ladder — listed', await n('SELECT COUNT(*) n FROM characters WHERE duel_limit IS NOT NULL AND alive'), true, 'duel'],
  ['back-room dice — faders', await n('SELECT COUNT(*) n FROM characters WHERE fade_limit IS NOT NULL AND alive'), true, 'fade'],
  ['speakeasies open', await n('SELECT COUNT(*) n FROM speakeasies'), true, 'club'],
];

const humans = await n(`SELECT COUNT(*) n FROM characters WHERE alive AND NOT is_npc`);
const residents = await n('SELECT COUNT(*) n FROM characters WHERE alive AND is_npc');
const wealth = (await pool.query(`SELECT cash FROM characters WHERE alive AND NOT is_npc ORDER BY cash DESC`)).rows.map((r) => Number(r.cash));
// THE STREET TAKE — measured, because tokenomics v2 needs it. The Exchange window pays cash for
// burned $OMR out of a pool fed by EXCHANGE.FUND_BPS of the street take, so the take's real accrual
// rate is what bounds how much $OMR the game can ever absorb. It is fed by 45 sites across 22
// modules, which is far too broad to size analytically — so measure it off a driven population and
// report it PER PLAYER PER DAY, which is the only form that scales to a launch estimate.
const streetTake = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
const takePerPlayerDay = streetTake / Math.max(1, humans) / Math.max(1, DAYS);

const total = wealth.reduce((a, b) => a + b, 0);
const topTenth = wealth.slice(0, Math.max(1, Math.floor(wealth.length / 10))).reduce((a, b) => a + b, 0);

if (verbose) {
console.log(`\n════ POPULATION-SCALE CENSUS — ${humans} players + ${residents} residents, ${DAYS} days ════\n`);
console.log('LIQUIDITY — is anyone on the other side?');
for (const [name, live, driven] of MARKETS) {
  const flag = !driven ? '  · not driven by this harness' : live === 0 ? '  ✗ EMPTY' : live < 3 ? '  ~ thin' : '  ✓';
  console.log(`  ${name.padEnd(34)} ${String(live).padStart(4)} live${flag}`);
}

// AVAILABILITY is the honest measurement. `found/looked` is the share of shopping trips that had a
// counterparty on the board at all, and it is what moves with population. `took/found` is what
// happened once one existed — and that one IS mostly gates (one debt at a time, already guarded,
// on cooldown), which is the game working, not a market failing.
console.log(`\nTHE STREET TAKE — what funds the Exchange window (tokenomics v2)`);
console.log(`  pool after ${DAYS} days      $${Math.round(streetTake).toLocaleString()}`);
console.log(`  per player per day        $${Math.round(takePerPlayerDay).toLocaleString()}  ← the rate that scales`);

console.log('\nAVAILABILITY — when a player went looking, was anyone there?');
for (const [m, s] of Object.entries(shopped)) {
  console.log(`  ${m.padEnd(16)} looked ${String(s.looked).padStart(4)}   found a counterparty `
    + `${String(s.found).padStart(4)} (${pct(s.found, s.looked)}%)   of those, closed `
    + `${String(s.took).padStart(4)} (${pct(s.took, s.found) ?? '—'}%)`);
}
console.log('\nPOSTED (supply side — what the town put on the boards)');
console.log('  ' + Object.entries(posted).map(([k, v]) => `${k} ${v}`).join(' · '));
console.log('  NOTE: posted-vs-taken is NOT a liquidity measure. Takes are bounded by per-player caps');
console.log('  (one debt, one bodyguard, a duel cooldown), so the ratio is ~3/rounds whatever the');
console.log('  population. Read AVAILABILITY above for density, not this.');

console.log('\nWEALTH');
console.log(`  total player cash            ${money(total)}`);
console.log(`  top 10% hold                 ${total ? Math.round((topTenth / total) * 100) : 0}%`);
console.log(`  richest / median             ${money(wealth[0])} / ${money(wealth[Math.floor(wealth.length / 2)])}`);

if (skipped.size) {
  console.log('\nSKIPPED (a branch that could not attempt — a silent zero here would be a harness bug)');
  [...skipped.entries()].sort((a, b) => b[1] - a[1]).forEach(([w, c]) => console.log(`  ${String(c).padStart(5)} × ${w}`));
}
if (errors.size) {
  console.log('\nREFUSALS (gates doing their job — high counts show what a real town runs into)');
  [...errors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .forEach(([e, c]) => console.log(`  ${String(c).padStart(5)} × ${e}`));
}
}

// ── the assertions ──────────────────────────────────────────────────────────────────────────────
// (1) conservation: the DELTA, not the absolute — this harness seeds so players can reach the markets.
const after = await runLedgerInvariants(pool, { alert: false });
const moved = after.checks.filter((c) => Math.abs(c.drift - (baseline[c.name] ?? 0)) > 0.01)
  .map((c) => `${c.name}: ${baseline[c.name] ?? 0} → ${c.drift}`);
assert.equal(moved.length, 0, `§10.4 MOVED during the run — a lost update or torn transfer:\n  ${moved.join('\n  ')}`);
if (verbose) console.log(`\n✓ §10.4 held: all ${after.checks.length} checks moved by exactly nothing across ${DAYS} simulated days`);

// (2) reachability: a market nobody could even POST into is a gate bug, not a quiet town. Reported
// per-market above; asserted here only for the ones this harness actually drives a post for.
const drivable = { listing: 'black market goods', order: 'buy orders', loan: 'loan offers', contract: 'contracts', guard: 'bodyguard offers', duel: 'duel listings', fade: 'fade limits', car: 'car auctions', club: 'speakeasies' };
const unreachable = Object.entries(drivable).filter(([k]) => posted[k] === 0).map(([, label]) => label);
assert.equal(unreachable.length, 0,
  `${unreachable.length} market(s) took ZERO posts across the whole run — with ${players.length} funded, `
  + `levelled players that is a gate bug, not a quiet town: ${unreachable.join(', ')}`);
if (verbose) console.log(`✓ every driven market is reachable — all ${Object.keys(drivable).length} took real posts`);

// (3) the census reads what it claims to read. A first cut queried the loans table for
// `status='offered'` — the word is 'open' — so it counted zero every run and was about to publish
// "the Shylock ended EMPTY" as a finding about the GAME rather than about a typo in a SQL string.
// A census that reads a column wrong reports confident nonsense, and nothing else here would notice.
// So: if more got POSTED into a market than got TAKEN out of it, something must still be standing.
// Size matters here: below ~18 players every loan offer gets taken, posted == taken, and the check
// is vacuous — the first mutation run passed for exactly that reason and read like a clean bill of
// health. CI runs 18×2, which is the smallest size where it actually bites.
const miscounted = MARKETS.filter(([, live, driven, key]) =>
  driven && key && posted[key] > (taken[key] ?? 0) && live === 0)
  .map(([name, , , key]) => `${name}: posted ${posted[key]}, taken ${taken[key] ?? 0}, yet the census sees 0 live`);
assert.equal(miscounted.length, 0,
  'the CENSUS disagrees with the FLOW — more went in than came out, so the query is reading the wrong '
  + `table, column or status word:\n  ${miscounted.join('\n  ')}`);
if (verbose) console.log('✓ the census reconciles with the flow — nothing posted has vanished from the count');

// Empty at the end has two completely different meanings and the flow tells them apart: a market
// that CLEARED (everything posted got taken) is the healthiest possible reading, and a market nobody
// wanted is the finding. Printing "EMPTY" without that distinction would report the first as the second.
const dead = MARKETS.filter(([, live, driven]) => driven && live === 0);
if (verbose) {
  if (!dead.length) console.log('\n✓ every driven market ended with a live counterparty');
  else {
    console.log(`\n⚠ ${dead.length} driven market(s) ended EMPTY:`);
    for (const [name, , , key] of dead) {
      const rate = key && posted[key] ? Math.round(((taken[key] ?? 0) / posted[key]) * 100) : null;
      console.log(`  ${name.padEnd(34)} ${rate === 100 ? 'CLEARED — everything posted was taken, which is the healthy reading'
        : rate === null ? 'nothing was posted into it' : `only ${rate}% was taken — the rest went unwanted or lapsed`}`);
    }
  }
  console.log('  (emptiness is a FINDING for balance/design, not a failure — a market can be reachable and still unattractive)\n');
}

await app.close();
return { players: players.length, residents, days: DAYS, shopped, posted, taken, wealth: { total, topTenth } };
}   // ── end runTown ────────────────────────────────────────────────────────────────────────────────

// ── the density curve ───────────────────────────────────────────────────────────────────────────
// THE QUESTION THIS ANSWERS: how many people does the city need before it feels inhabited? That sets
// the invite-wave size, and nothing else here could answer it.
//
// The measurement is sound because each player acts ONCE PER ROUND regardless of N: posting scales
// with N and looking scales with N, so if AVAILABILITY stays flat then density genuinely does not
// matter, and if it climbs there is a floor below which a real person finds an empty board.
if (SWEEP.length) {
  const rows = [];
  for (const n of SWEEP) {
    process.stdout.write(`  running ${n} players…\n`);
    rows.push([n, await runTown({ players: n, days: DAYS, verbose: false })]);
  }
  console.log(`\n════ THE DENSITY CURVE — availability vs population, ${DAYS} days each ════\n`);
  const markets = [...new Set(rows.flatMap(([, r]) => Object.keys(r.shopped)))];
  console.log(`  ${'market'.padEnd(16)}${rows.map(([n]) => `${n}p`.padStart(8)).join('')}`);
  for (const m of markets) {
    const cells = rows.map(([, r]) => {
      const s = r.shopped[m];
      return (s && s.looked ? `${pct(s.found, s.looked)}%` : '—').padStart(8);
    });
    console.log(`  ${m.padEnd(16)}${cells.join('')}`);
  }
  console.log('\n  (each cell: the share of shopping trips that found a counterparty on the board.');
  console.log('   Flat across the row = population-independent. Climbing = there is a floor below');
  console.log('   which the city reads as empty, and that floor is your minimum invite wave.)\n');
  console.log('✅ density sweep complete.');
} else {
  await runTown({ players: PLAYERS, days: DAYS });
  console.log('✅ scale complete — the multiplayer economy was driven at population scale, every market '
    + 'censused for a live counterparty, and §10.4 moved by exactly nothing.');
}

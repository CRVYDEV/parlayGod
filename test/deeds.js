// STREET DEEDS — the map as property (omerta-street-deeds-design.md), Phase 1. A named, mapped plot of
// the world a player OWNS and builds a legend on. PURE STATUS: account-level (survives death), ZERO
// §10.4 (no currency, no faucet, no new reason). This suite proves: the claim + every validation gate
// (bad district / short name / one-per-account / city-wide uniqueness), the legend engine (a claim
// records a history event; renown/rank), the great-streets leaderboard (ranked by legend, agents
// excluded), SURVIVES DEATH (a mod-kill's heir inherits the deed; report.kept.deed names it; the
// bloodline's death leaves a "fell here" mark on the record), and §10.4-neutrality (the whole deed
// flow writes ZERO transactions rows — the portrait/dynasty/estate precedent).
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildServer } from '../src/server.js';
import { DEEDS, deedRankOf, deedRenown, deedNeighborhoodsOpen,
         GOODS, goodPriceOf, CONSUMABLES, cityEventOf, dayOf, seasonModOf,
         OPERATIONS, opSlotsOf, RACKETS, ASSETS } from '../src/rules.js';
import { deedChainConfig, DEED_VOUCHER_TYPES, deedTokenId, markDeedExtracted, reimportDeed,
         sweepDeedReimports } from '../src/chain.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body, mod } = {}) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (mod) headers['x-mod-key'] = 'test-mod-key';
  const res = await app.inject({ method, url, headers, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const ch = await meOf(token);
  return { token, id: ch.id, acct: (await pool.query('SELECT account_id a FROM characters WHERE id=$1', [ch.id])).rows[0].a };
};
const txCount = async () => Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n);
const notesFor = async (id, type) => (await pool.query(
  'SELECT payload FROM notifications WHERE character_id=$1 AND type=$2', [id, type]))
  .rows.map((r) => (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload));

const a = await mk('Vito'), b = await mk('Sonny');

// ════════════ THE HELPERS ════════════
assert.equal(deedRankOf(0).name, 'A Nameless Block', 'a deed with no legend is a nameless block');
assert.equal(deedRankOf(120).name, 'A Legend of the City', 'the top rank is a legend of the city');
assert.equal(deedRenown([{ kind: 'claim' }, { kind: 'fell' }]), 6, 'renown sums the event weights (claim 1 + fell 5)');

// ════════════ THE BOARD before a claim ════════════
const b0 = (await call('GET', '/v1/deeds', { token: a.token })).body;
assert.equal(b0.deed, null, 'no deed yet');
assert.equal(b0.canClaim, true, 'a deedless account can claim');
assert.equal(b0.districts.length, 6, 'all six core districts are shown to claim in');
assert(b0.ranks.length >= 3, 'the renown-rank ladder is published');

const txBefore = await txCount();

// ════════════ GATES ════════════
assert.equal((await call('POST', '/v1/deeds/claim', { token: a.token, body: { name: 'Ash Street', district: 'nowhere' } })).body.error,
  'district', 'a street must sit in a real district');
assert.equal((await call('POST', '/v1/deeds/claim', { token: a.token, body: { name: 'x', district: 'neon' } })).body.error,
  'name', `a name must be at least ${DEEDS.NAME_MIN} characters`);

// ════════════ CLAIM ════════════
const claim = await call('POST', '/v1/deeds/claim', { token: a.token, body: { name: '  Corvino   Way  ', district: 'neon' } });
assert.equal(claim.code, 200, 'the claim lands');
assert.equal(claim.body.name, 'Corvino Way', 'the name is whitespace-collapsed');
assert.equal(claim.body.district, 'neon', 'mapped to the chosen district');

const b1 = (await call('GET', '/v1/deeds', { token: a.token })).body;
assert.equal(b1.deed.name, 'Corvino Way', 'the board shows your deed');
assert.equal(b1.deed.districtName, 'The Neon Mile', 'with the district name');
assert.equal(b1.canClaim, false, 'you can no longer claim (one deed per account)');
assert.equal(b1.history.length, 1, 'the claim recorded a legend event');
assert.equal(b1.history[0].kind, 'claim', 'the first event is the claim');
assert.equal(b1.renown, 1, 'renown reflects the one event (claim = 1)');

// ════════════ MORE GATES (post-claim) ════════════
assert.equal((await call('POST', '/v1/deeds/claim', { token: a.token, body: { name: 'Second Street', district: 'docks' } })).body.error,
  'have_deed', 'one deed per account');
assert.equal((await call('POST', '/v1/deeds/claim', { token: b.token, body: { name: 'corvino WAY', district: 'docks' } })).body.error,
  'taken', 'a street name is unique across the whole city (case-insensitive)');

// markup is stripped (stored-XSS) — a second player claims a name with markup, and it comes back clean
const cx = await call('POST', '/v1/deeds/claim', { token: b.token, body: { name: 'Nine <b>Fingers</b> Row', district: 'brick' } });
assert.equal(cx.code, 200, 'the second player claims their own street');
assert(!/[<>]/.test(cx.body.name), 'markup is stripped from the stored name');

// ════════════ §10.4 — the whole deed flow moved no value ════════════
assert.equal(await txCount(), txBefore, 'STREET DEEDS writes ZERO ledger rows — pure status, never value');

// ════════════ THE GREAT STREETS leaderboard (ranked by legend) ════════════
// give A's deed more legend so it tops the board
await pool.query("INSERT INTO street_deed_history (account_id, kind, detail) VALUES ($1,'war','a war was won here'),($1,'blood','blood spilled')", [a.acct]);
const lb = (await call('GET', '/v1/leaderboard/streets', { token: a.token })).body;
assert(lb.streets.length >= 2, 'both claimed streets are on the board');
assert.equal(lb.streets[0].name, 'Corvino Way', 'the most storied street tops the board');
assert.equal(lb.streets[0].renown, deedRenown([{ kind: 'claim' }, { kind: 'war' }, { kind: 'blood' }]), 'ranked by its true renown');
// an agent is excluded from the status board
await pool.query('UPDATE account_persistent SET agent_flag=true WHERE account_id=$1', [b.acct]);
const lb2 = (await call('GET', '/v1/leaderboard/streets', { token: a.token })).body;
assert(!lb2.streets.find((s) => s.name === 'Nine Fingers Row'), "an agent's street is off the status board");
await pool.query('UPDATE account_persistent SET agent_flag=false WHERE account_id=$1', [b.acct]);

// ════════════ PHASE 2 — CONTROL + THE CORNER TAKE ════════════
// The deed is property; CONTROL (the corner take) is contestable. `a` owns "Corvino Way" in neon,
// `b` owns "Nine Fingers Row" in brick. §10.4: the corner take is the ONE new faucet (`deed:corner`,
// character_id'd); the shakedown moves control, not money.
const backdate = (acct, hours) =>
  pool.query("UPDATE street_deeds SET corner_at = now() - ($2 || ' hours')::interval WHERE account_id=$1", [acct, String(hours)]);
const cashOf = async (id) => Number((await pool.query('SELECT cash FROM characters WHERE id=$1', [id])).rows[0].cash);
const deedRows = async (reason) => Number((await pool.query(
  "SELECT COUNT(*) n FROM transactions WHERE reason=$1", [reason])).rows[0].n);

// the corner take accrues — backdate 6h, the board shows the owed take
await backdate(a.acct, 6);
const cA = (await call('GET', '/v1/deeds', { token: a.token })).body.corner;
assert.equal(cA.iControl, true, 'the owner controls their own corner');
assert.equal(cA.owed, DEEDS.CORNER_PER_HR * 6, 'the corner take accrues at the per-hour rate');
assert.equal(cA.collectable, DEEDS.CORNER_PER_HR * 6, 'collectable == owed when you hold only your own corner');

// COLLECT — a bounded cash faucet, ledgered `deed:corner`, and the clock resets
const cashA0 = await cashOf(a.id), rows0 = await deedRows('deed:corner');
const col = await call('POST', '/v1/deeds/corner', { token: a.token });
assert.equal(col.code, 200, 'the collect lands');
assert.equal(col.body.total, DEEDS.CORNER_PER_HR * 6, 'the whole owed take is paid');
assert.equal(await cashOf(a.id), cashA0 + DEEDS.CORNER_PER_HR * 6, 'the cash lands in pocket');
assert.equal(await deedRows('deed:corner'), rows0 + 1, 'exactly one deed:corner ledger row — the faucet is character_id\'d');
// the clock reset — nothing to collect a second time
assert.equal((await call('POST', '/v1/deeds/corner', { token: a.token })).body.error, 'nothing', 'the clock resets on collect');

// THE CAP — an absent controller banks ≤ 24h however long it's been
await backdate(a.acct, 48);
assert.equal((await call('GET', '/v1/deeds', { token: a.token })).body.corner.owed,
  DEEDS.CORNER_PER_HR * (DEEDS.CORNER_CAP_MS / 3600000), 'the corner take caps at CORNER_CAP_MS');

// THE SHAKEDOWN — `b` muscles in on `a`'s corner. Put b on the block, past the level floor, funded.
await pool.query("UPDATE characters SET loc='neon', respect=1000, muscle=40, cunning=40, energy=100 WHERE id=$1", [b.id]);
const cashBpre = await cashOf(b.id);
process.env.DEEDS_SHAKE_P = '1'; // force the roll to land
const shake = await call('POST', `/v1/deeds/shakedown/${a.id}`, { token: b.token });
assert.equal(shake.code, 200, 'the shakedown resolves');
assert.equal(shake.body.won, true, 'the forced roll lands the corner');
assert.equal(shake.body.reclaim, false, 'a rival muscling in is a seizure, not a reclaim');
assert.equal(await cashOf(b.id), cashBpre, 'the shakedown moved NO cash — it moves control, not money');
// b now controls a's corner; a sees it seized
const bBoard = (await call('GET', '/v1/deeds', { token: b.token })).body.corner;
assert(bBoard.rivalCorners.some((r) => r.name === 'Corvino Way'), 'b now controls Corvino Way');
const aSeized = (await call('GET', '/v1/deeds', { token: a.token })).body.corner;
assert.equal(aSeized.iControl, false, 'a no longer controls their own corner');
assert.equal(aSeized.seized, true, 'a sees the corner seized');
assert.equal(aSeized.owed, 0, 'a can collect nothing off a corner a rival holds');

// b collects the seized corner (backdate it — the seize reset the clock)
await backdate(a.acct, 5);
const cashB0 = await cashOf(b.id);
const bcol = await call('POST', '/v1/deeds/corner', { token: b.token });
assert.equal(bcol.code, 200, 'b collects the corner they muscled in on');
assert.equal(await cashOf(b.id), cashB0 + DEEDS.CORNER_PER_HR * 5, 'b banks the seized corner take');

// RECLAIM — `a` takes their own corner back. Clear the cooldown, put a on the block, fund them.
await pool.query("UPDATE street_deeds SET shakedown_at = now() - interval '7 hours' WHERE account_id=$1", [a.acct]);
await pool.query("UPDATE characters SET loc='neon', respect=1000, muscle=40, cunning=40, energy=100 WHERE id=$1", [a.id]);
const reclaim = await call('POST', `/v1/deeds/shakedown/${a.id}`, { token: a.token });
assert.equal(reclaim.body.reclaim, true, 'the owner taking their own corner back is a reclaim');
const aBack = (await call('GET', '/v1/deeds', { token: a.token })).body.corner;
assert.equal(aBack.iControl, true, 'the owner controls their corner again');
delete process.env.DEEDS_SHAKE_P;

// CONTROL LAPSES — a rival's window expires and control falls back to the owner with no action.
process.env.DEEDS_SHAKE_P = '1';
await pool.query("UPDATE characters SET loc='neon', respect=1000, muscle=40, cunning=40, energy=100 WHERE id=$1", [b.id]);
await pool.query("UPDATE street_deeds SET shakedown_at = now() - interval '7 hours' WHERE account_id=$1", [a.acct]);
await call('POST', `/v1/deeds/shakedown/${a.id}`, { token: b.token }); // b re-seizes
await pool.query("UPDATE street_deeds SET control_until = now() - interval '1 hour' WHERE account_id=$1", [a.acct]); // window lapses
const aLapsed = (await call('GET', '/v1/deeds', { token: a.token })).body.corner;
assert.equal(aLapsed.iControl, true, 'once the window lapses, control falls back to the owner with no action');
delete process.env.DEEDS_SHAKE_P;

// SHAKEDOWN GATES
process.env.DEEDS_SHAKE_P = '1';
await pool.query("UPDATE characters SET loc='docks' WHERE id=$1", [b.id]);
assert.equal((await call('POST', `/v1/deeds/shakedown/${a.id}`, { token: b.token })).body.error,
  'district', 'you have to be on the block to lean on the corner');
await pool.query("UPDATE characters SET loc='neon', respect=1 WHERE id=$1", [b.id]);
assert.equal((await call('POST', `/v1/deeds/shakedown/${a.id}`, { token: b.token })).body.error,
  'rookie', 'a rookie under the level floor can\'t muscle a corner');
delete process.env.DEEDS_SHAKE_P;

// ════════════ PHASE 2C — THE CONTROLLER'S PERKS (the turf perk + the op seat) ════════════
// The deed-vs-control split applied to TURF POWER: whoever CONTROLS a corner personally enjoys the
// district's SIGNED turf perk — OR'd with family turf by SET-UNION, so a district counted twice adds
// NOTHING — and controlling your OWN corner seats one extra operation, capped at SLOTS_MAX (parity:
// the deed accelerates the seat curve, never exceeds it). Every claim below is proven at a REAL TILL
// (a goods price, a workshop bill, a racket seat), never by reading a flag back.
{
  // `a` controls their own neon corner (the lapse above handed it back). Fund + place them.
  await pool.query("UPDATE characters SET cash=100000000, loc='neon', respect=1000, energy=100 WHERE id=$1", [a.id]);
  const gid = GOODS[0].id;
  const base = goodPriceOf(gid, 'neon');
  // (1) THE TURF PRICE EDGE — the controller buys at the held-district 0.95; a deedless twin at 1.0
  const dd = await mk('Tessio');
  await pool.query("UPDATE characters SET cash=1000000, loc='neon' WHERE id=$1", [dd.id]);
  const buyA = await call('POST', '/v1/goods/buy', { token: a.token, body: { goodId: gid, qty: 1 } });
  assert.equal(buyA.code, 200, 'the controller buys goods on their corner');
  assert.equal(buyA.body.unit, Math.round(base * 0.95),
    'the corner controller buys at the held-district 0.95 — the signed turf price edge follows control');
  const buyD = await call('POST', '/v1/goods/buy', { token: dd.token, body: { goodId: gid, qty: 1 } });
  assert.equal(buyD.body.unit, Math.round(base), 'a deedless player in the same district pays full freight');
  // …and the SELL side of the same edge — mirroring the till's own composition exactly, INCLUDING the
  // live seasonModOf() read: a SEASON_MOD pin would be date-proof too, but it is a TEST_ONLY knob and
  // preflight refuses it the moment a real DATABASE_URL makes the box read as production (verified).
  const evT = cityEventOf(dayOf()).tradeMult || 1, seasonT = seasonModOf().tradeSellMult || 1;
  const sellA = await call('POST', '/v1/goods/sell', { token: a.token, body: { goodId: gid, qty: 1 } });
  assert.equal(sellA.body.unit, Math.round(base * 1.05 * evT * seasonT),
    'the controller sells at the held-district 1.05 (deed corners count at the sell till too)');
  // (2) NEVER STACKS — put `a` in a family that HOLDS neon: the price must be UNCHANGED (OR, not ×²).
  await pool.query("INSERT INTO gangs (id, name, tag) VALUES ('g2c','The 2C Family','2CF')");
  await pool.query("INSERT INTO gang_members (gang_id, character_id, role) VALUES ('g2c',$1,'boss')", [a.id]);
  await pool.query("UPDATE districts SET holder_gang='g2c' WHERE id='neon'");
  const buyBoth = await call('POST', '/v1/goods/buy', { token: a.token, body: { goodId: gid, qty: 1 } });
  assert.equal(buyBoth.body.unit, Math.round(base * 0.95),
    'MUTATION never-stack: family turf + a controlled corner in the SAME district apply the perk ONCE (set-union OR, never 0.95²)');
  await pool.query("UPDATE districts SET holder_gang=NULL WHERE id='neon'");
  await pool.query("DELETE FROM gang_members WHERE gang_id='g2c'");
  await pool.query("DELETE FROM gangs WHERE id='g2c'");
  // (3) THE FOUNDRY BILL — repoint b's OWN deed to foundry: their workshop bill drops to 0.75×.
  await pool.query('UPDATE characters SET cash=10000000, cb=20 WHERE id=$1', [b.id]);
  const c0 = CONSUMABLES[0];
  const cashPre = await cashOf(b.id);
  await call('POST', `/v1/workshop/craft/${c0.id}`, { token: b.token });
  assert.equal(await cashOf(b.id), cashPre - c0.cost, "a brick corner buys no foundry discount — the bill is full");
  await pool.query("UPDATE street_deeds SET district='foundry' WHERE account_id=$1", [b.acct]);
  const cashPre2 = await cashOf(b.id);
  await call('POST', `/v1/workshop/craft/${c0.id}`, { token: b.token });
  assert.equal(await cashOf(b.id), cashPre2 - Math.floor(c0.cost * 0.75),
    'a foundry corner controller crafts at the signed 0.75 — the workshop till reads the corner');
  // (4) THE OP SEAT — the board AND the till: level 11 seats opSlotsOf(11); the corner seats one more.
  const lvlA = 11; // respect 1000
  const meA = (await call('GET', '/v1/me', { token: a.token })).body.character;
  assert.equal(meA.ops.slots, opSlotsOf(lvlA) + DEEDS.PERK_OP_SLOTS,
    'the board shows the corner seat (the same opSlotsOf the till gates on)');
  const seats = opSlotsOf(lvlA) + DEEDS.PERK_OP_SLOTS;
  // rackets AND income assets share the ONE seat pool (the strategy package), so the till walk mixes
  // them — only 3 rackets sit at level ≤ 11, the rest of the seats take the cheapest income assets.
  const seatables = [
    ...RACKETS.filter((r) => (r.lvl || 0) <= lvlA).map((r) => ({ url: `/v1/rackets/${r.id}/buy`, cost: r.cost })),
    ...ASSETS.filter((x) => x.cat === OPERATIONS.INCOME_ASSET_CAT).map((x) => ({ url: `/v1/assets/${x.id}/buy`, cost: x.cost })),
  ].sort((p, q) => p.cost - q.cost);
  assert(seatables.length > seats, 'the catalog has more level-open rungs than seats (or the refusal below is vacuous)');
  for (let i = 0; i < seats; i++)
    assert.equal((await call('POST', seatables[i].url, { token: a.token })).code, 200,
      `the till seats operation ${i + 1} of ${seats} — the corner's extra seat is real at the till`);
  assert.equal((await call('POST', seatables[seats].url, { token: a.token })).body.error,
    'slots', 'one past the corner-boosted seat count still refuses — the seat is +1, not unlimited');
  // (5) THE PARITY CAP — at level ≥ 40 the seat adds NOTHING (SLOTS_MAX binds; the deed accelerates
  // the curve, never exceeds it — free-player parity, the load-bearing bound).
  await pool.query('UPDATE characters SET respect=20000 WHERE id=$1', [a.id]); // level 45
  assert.equal((await call('GET', '/v1/me', { token: a.token })).body.character.ops.slots, OPERATIONS.SLOTS_MAX,
    'MUTATION cap: the corner seat NEVER exceeds SLOTS_MAX — a deed accelerates the seat curve, it cannot exceed what level alone reaches');
  await pool.query('UPDATE characters SET respect=1000 WHERE id=$1', [a.id]);
  // (6) THE PERK FOLLOWS CONTROL — b re-seizes a's corner: a loses the price edge AND the seat;
  // b (whose own deed is in foundry) now enjoys the NEON edge through the corner they muscled.
  process.env.DEEDS_SHAKE_P = '1';
  await pool.query("UPDATE characters SET loc='neon', respect=1000, muscle=40, cunning=40, energy=100, cash=1000000 WHERE id=$1", [b.id]);
  await pool.query("UPDATE street_deeds SET shakedown_at = now() - interval '7 hours' WHERE account_id=$1", [a.acct]);
  assert.equal((await call('POST', `/v1/deeds/shakedown/${a.id}`, { token: b.token })).body.won, true, 'b re-seizes the corner');
  delete process.env.DEEDS_SHAKE_P;
  const buySeized = await call('POST', '/v1/goods/buy', { token: a.token, body: { goodId: gid, qty: 1 } });
  assert.equal(buySeized.body.unit, Math.round(base),
    'MUTATION control: the dispossessed OWNER pays full freight — the turf perk follows CONTROL, not the paper');
  const meSeized = (await call('GET', '/v1/me', { token: a.token })).body.character;
  assert.equal(meSeized.ops.slots, opSlotsOf(lvlA),
    'the seized owner loses the op seat too (over-seated operations keep running; buying more refuses)');
  const buyUsurper = await call('POST', '/v1/goods/buy', { token: b.token, body: { goodId: gid, qty: 1 } });
  assert.equal(buyUsurper.body.unit, Math.round(base * 0.95),
    'the USURPER enjoys the neon edge through the corner they muscled — control carries the perk');
  // the board discloses the perk state both ways (the terms-ride-with-the-price rule)
  const aPk = (await call('GET', '/v1/deeds', { token: a.token })).body.corner;
  assert.equal(aPk.perkActive, false, 'the seized owner sees the edge is gone');
  assert(aPk.perkText, 'and what it was');
  const bPk = (await call('GET', '/v1/deeds', { token: b.token })).body.corner;
  assert(bPk.rivalCorners.find((r) => r.name === 'Corvino Way' && r.perk),
    "the usurper's board names the perk riding the corner they run");
  // restore: lapse b's window so `a` controls their corner again for the blocks below
  await pool.query("UPDATE street_deeds SET control_until = now() - interval '1 hour' WHERE account_id=$1", [a.acct]);
}

// ════════════ PHASE 4 — THE GROWING MAP (§10.4-zero — pure render off the population) ════════════
// the helper: the first neighborhood is always open, one more per EXPANSION_STEP living players, capped
assert.equal(deedNeighborhoodsOpen(0, 'neon'), 1, 'a fresh city opens the first neighborhood only');
assert.equal(deedNeighborhoodsOpen(DEEDS.EXPANSION_STEP, 'neon'), 2, 'one more neighborhood opens per EXPANSION_STEP players');
assert.equal(deedNeighborhoodsOpen(10 * DEEDS.EXPANSION_STEP, 'neon'), DEEDS.NEIGHBORHOODS.neon.length, 'the map caps at the district\'s neighborhood count');
// the board surfaces the growing city + per-district neighborhoods
const bg = (await call('GET', '/v1/deeds', { token: a.token })).body;
assert(bg.city && typeof bg.city.population === 'number', 'the board reports the city population (how big the world is)');
assert.equal(bg.city.step, DEEDS.EXPANSION_STEP, 'the expansion cadence is published');
assert(bg.city.nextExpansionAt > bg.city.population, 'the next expansion threshold is ahead of the current population');
const neonTile = bg.districts.find((d) => d.id === 'neon');
assert(neonTile.neighborhoods && neonTile.neighborhoods.open.length >= 1, 'a district surfaces its open neighborhoods');
assert.equal(neonTile.neighborhoods.total, DEEDS.NEIGHBORHOODS.neon.length, 'and its total (open + coming) neighborhoods');
assert(bg.deed.neighborhood, 'your deed shows which neighborhood it sits in');

// ════════════ PHASE 3 — THE SECONDARY MARKET (the off-chain deed trade) ════════════
const cc = await mk('Clemenza');           // a DEEDLESS buyer
await pool.query('UPDATE characters SET cash=200000 WHERE id=$1', [cc.id]);
// LIST gates: a deedless account can't list; a price under the floor is refused
assert.equal((await call('POST', '/v1/deeds/list', { token: cc.token, body: { price: 50000 } })).body.error, 'no_deed', 'a deedless account has no street to sell');
assert.equal((await call('POST', '/v1/deeds/list', { token: b.token, body: { price: 1 } })).body.error, 'min_price', 'a street has a real floor price');
// THE STORED-NOT-SPENT BOUND (red-team, found by driving the route): `sale_price` is a bigint and
// `Number.isFinite` does not bound it, so 1e308 reached Postgres as a 22P02 and surfaced as a 500
// on a request the server should simply have refused. Asserted as the REFUSAL rather than as
// "not a 500", because pg-mem is more permissive than Postgres and would store the value happily —
// a not-a-500 assertion would pass here with no fix at all.
for (const huge of [1e308, Number.MAX_SAFE_INTEGER + 2, 9.9e18]) {
  const r = await call('POST', '/v1/deeds/list', { token: b.token, body: { price: huge } });
  assert.equal(r.body.error, 'max_price', `a price of ${huge} is refused, not stored (nor 500'd)`);
  assert.ok(r.code < 500, `${huge} is a clean refusal, never an internal error`);
}
// b lists their street
const sellerStreet = (await call('GET', '/v1/deeds', { token: b.token })).body.deed.name;
const list = await call('POST', '/v1/deeds/list', { token: b.token, body: { price: 50000 } });
assert.equal(list.code, 200, 'the listing lands');
const bMarket = (await call('GET', '/v1/deeds', { token: b.token })).body.market;
assert.equal(bMarket.listed, true, 'the seller sees their street listed');
assert.equal(bMarket.salePrice, 50000, 'at the asked price');
// a deedless buyer browses the market and sees it (with its legend — the value)
const ccBoard = (await call('GET', '/v1/deeds', { token: cc.token })).body.market;
assert.equal(ccBoard.canBuy, true, 'a deedless account can buy');
const onSale = ccBoard.forSale.find((s) => s.street === sellerStreet);
assert(onSale, 'the listed street is on the market board');
assert.equal(onSale.price, 50000, 'at its price');
assert('renown' in onSale, 'the legend (renown) travels with the listing — it is the value');
// BUY gates: b can't buy their own; a (holds a deed) can't buy
assert.equal((await call('POST', `/v1/deeds/buy/${b.id}`, { token: b.token })).body.error, 'self', "you can't buy your own street (the two-party guard catches it)");
assert.equal((await call('POST', `/v1/deeds/buy/${b.id}`, { token: a.token })).body.error, 'have_deed', 'one deed per account — sell before you buy');
// cc buys Nine Fingers Row from b
const ccCash0 = Number((await pool.query('SELECT cash FROM characters WHERE id=$1', [cc.id])).rows[0].cash);
const bCash0 = Number((await pool.query('SELECT cash FROM characters WHERE id=$1', [b.id])).rows[0].cash);
const pool0 = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
const buy = await call('POST', `/v1/deeds/buy/${b.id}`, { token: cc.token });
assert.equal(buy.code, 200, 'the sale goes through');
const fee = Math.ceil(50000 * DEEDS.SALE_FEE_BPS / 10000), tax = Math.ceil(50000 * DEEDS.SALE_TAX_BPS / 10000);
assert.equal(Number((await pool.query('SELECT cash FROM characters WHERE id=$1', [cc.id])).rows[0].cash), ccCash0 - 50000, 'the buyer pays the full price');
assert.equal(Number((await pool.query('SELECT cash FROM characters WHERE id=$1', [b.id])).rows[0].cash), bCash0 + (50000 - fee - tax), 'the seller nets 98% (1% dev + 1% street tax)');
assert.equal(Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool), pool0 + tax, 'the street-tax half of the take feeds the buyback');
// exactly two deed:sale rows (buyer + seller); the take is off-ledger/burned, not minted on top
assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM transactions WHERE reason='deed:sale'")).rows[0].n), 2, 'the sale ledgers exactly the two-party transfer — no mint');
// the deed + its provenance transferred to cc; b is now deedless; control reset; a "sold" event marks the record
const ccAfter = (await call('GET', '/v1/deeds', { token: cc.token })).body;
assert.equal(ccAfter.deed.name, sellerStreet, 'the buyer now holds the street');
assert(ccAfter.history.some((h) => h.kind === 'claim'), 'the whole PROVENANCE (legend) travelled with the deed');
assert(ccAfter.history.some((h) => h.kind === 'sold'), 'the sale is written into the street\'s record');
assert.equal(ccAfter.corner.iControl, true, 'control RESET to the new owner — they hold a clean corner');
assert.equal((await call('GET', '/v1/deeds', { token: b.token })).body.deed, null, 'the seller is now deedless — they can claim or buy again');

// ════════════ SURVIVES DEATH — the heir inherits the deed; the bloodline leaves its mark ════════════
const kill = await call('POST', '/v1/mod/kill', { mod: true, body: { characterId: a.id } });
assert.equal(kill.code, 200, 'the mod-kill runs the estate');
const heir = kill.body.heirId;
// report.kept.deed names the street the bloodline keeps
const estateNote = await notesFor(heir, 'estate');
assert.equal(estateNote.length, 1, 'the heir gets the estate report');
assert.equal(estateNote[0].kept.deed, 'Corvino Way', 'the estate report names the deed the bloodline keeps');
// the deed still belongs to the account (the heir's board shows it — account-keyed, survives death)
const bHeir = (await call('GET', '/v1/deeds', { token: a.token })).body;
assert.equal(bHeir.deed.name, 'Corvino Way', 'the heir inherits the deed — it survives death');
// the death left a "fell here" mark on the record (the legend engine)
assert(bHeir.history.some((h) => h.kind === 'fell'), 'a bloodline dying holding the deed leaves a "fell here" mark');

// ════════════ PHASE 3 (on-chain) — THE TRADEABLE DEED (chain-dormant until env-configured) ════════════
// The deed EXTRACTS as an ERC-721 (EIP-712 self-mint, the OmertaBond precedent) and goes INERT in-game
// until someone RE-IMPORTS (burns) it back — the car/boat v3-step-7 precedent. The deed + its whole legend
// travel with the token; the extraction entitlement (`minted`) and the corner control do NOT. §10.4-ZERO.
process.env.VOUCHER_SIGNER_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
process.env.STREET_DEED_ADDRESS = '0x3333333333333333333333333333333333333333';
process.env.CHAIN_ID = '46630';
const signerAddr = privateKeyToAccount(process.env.VOUCHER_SIGNER_PK).address;
const eWallet = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d').address;
const burnerWallet = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a').address;
const mint = (acct) => pool.query('UPDATE account_persistent SET minted=true WHERE account_id=$1', [acct]);
const linkWallet = (acct, w) => pool.query('UPDATE account_persistent SET wallet_address=$2 WHERE account_id=$1', [acct, w]);

const chainTx0 = await txCount();
const e = await mk('Enzo');
assert.equal((await call('POST', '/v1/deeds/claim', { token: e.token, body: { name: 'Enzo Alley', district: 'docks' } })).code, 200,
  'the extractor claims a street');

// GATE: not minted → can't extract (the Sybil bound — `minted` never travels with the token)
assert.equal((await call('POST', '/v1/deeds/extract', { token: e.token })).body.error, 'not_minted',
  'an unmade account cannot take its street on-chain');
await mint(e.acct);
// GATE: made but no linked wallet → can't extract
assert.equal((await call('POST', '/v1/deeds/extract', { token: e.token })).body.error, 'wallet',
  'a made account with no linked wallet cannot extract');
await linkWallet(e.acct, eWallet);
// GATE: a listed street can't ALSO be extracted (no double-disposal)
await call('POST', '/v1/deeds/list', { token: e.token, body: { price: 40000 } });
assert.equal((await call('POST', '/v1/deeds/extract', { token: e.token })).body.error, 'listed',
  'a street on the in-game market cannot also be extracted');
await call('POST', '/v1/deeds/unlist', { token: e.token });

// the board surfaces the chain state
const eBoard = (await call('GET', '/v1/deeds', { token: e.token })).body;
assert.equal(eBoard.chain.configured, true, 'the deed chain reads configured');
assert.equal(eBoard.chain.canExtract, true, 'a made, wallet-linked, unlisted holder can extract');
assert.equal(eBoard.chain.extractPending, false, 'nothing pending yet');

// GATE: the eligibility SELF-ATTESTATION (founder sign-off 2026-08-16 — the stock-delivery
// verification depth): no attestation, no voucher — and a merely-truthy value never passes
assert.equal((await call('POST', '/v1/deeds/extract', { token: e.token })).body.error, 'attestation',
  'extraction without the eligibility attestation refuses by name');
assert.equal((await call('POST', '/v1/deeds/extract', { token: e.token, body: { attest: 'yes' } })).body.error, 'attestation',
  'the attestation is read STRICTLY — a truthy accident is not an attestation');

// EXTRACT — the voucher signs and the deed goes extraction-pending (state 1→2, INERT)
const ext = await call('POST', '/v1/deeds/extract', { token: e.token, body: { attest: true } });
assert.equal(ext.code, 200, 'the extract signs a voucher');
{
  const att = (await pool.query('SELECT attested_at FROM street_deeds WHERE onchain_token_id IS NOT NULL')).rows[0];
  assert.ok(att?.attested_at, 'the attestation is RECORDED on the row (it survives the on-chain re-key)');
}
assert.equal(ext.body.street, 'Enzo Alley', 'the voucher carries the street name');
// PARITY: recover the signer against a domain HARDCODED to mirror the CONTRACT's EIP712("OmertaStreetDeed","1").
// Recovering with deedChainConfig() would be vacuous (any consistent-but-wrong domain agrees with itself) —
// pinning the literal is what catches the server's domain drifting from StreetDeed.sol's own domain separator.
const contractDomain = { name: 'OmertaStreetDeed', version: '1', chainId: 46630,
  verifyingContract: process.env.STREET_DEED_ADDRESS };
assert.deepEqual(deedChainConfig(), { ...contractDomain, verifyingContract: contractDomain.verifyingContract },
  'the server domain matches the contract domain field-for-field');
const msg = { to: ext.body.voucher.to, name: ext.body.voucher.name, district: ext.body.voucher.district,
  nonce: BigInt(ext.body.voucher.nonce), deadline: BigInt(ext.body.voucher.deadline) };
const rec = await recoverTypedDataAddress({ domain: contractDomain, types: DEED_VOUCHER_TYPES,
  primaryType: 'DeedVoucher', message: msg, signature: ext.body.signature });
assert.equal(rec.toLowerCase(), signerAddr.toLowerCase(), 'the DeedVoucher recovers to the server signer under the CONTRACT domain — EIP-712 parity');
assert.equal(ext.body.tokenId, deedTokenId('Enzo Alley'), 'the tokenId is uint256(keccak256(name)) — exact on-chain parity');

// INERT: pending, can't extract twice, can't list, can't claim a fresh street, can't shake a corner
const ePend = (await call('GET', '/v1/deeds', { token: e.token })).body;
assert.equal(ePend.chain.extractPending, true, 'the deed reads extraction-pending');
assert.equal(ePend.chain.tokenId, deedTokenId('Enzo Alley'), 'the pending tokenId is surfaced');
assert.equal(ePend.deed.onChain, true, 'the deed flags on-chain');
assert.equal((await call('POST', '/v1/deeds/extract', { token: e.token })).body.error, 'already',
  'a pending street cannot be extracted twice');
assert.equal((await call('POST', '/v1/deeds/list', { token: e.token, body: { price: 1000 } })).body.error, 'onchain',
  'an inert street cannot be listed on the in-game market');
assert.equal((await call('POST', '/v1/deeds/claim', { token: e.token, body: { name: 'New Row', district: 'canal' } })).body.error,
  'have_deed', 'a pending extraction still counts as holding a street (one deed per account)');

// CONFIRM ON-CHAIN (the Extracted watcher): state 2→3 — re-key to onchain:<token>, freeing the extractor
await markDeedExtracted(pool, { nonce: ext.body.nonce, tokenId: ext.body.tokenId });
const eFreed = (await call('GET', '/v1/deeds', { token: e.token })).body;
assert.equal(eFreed.deed, null, 'once on-chain, the extractor is deedless — free to claim again');
assert.equal(eFreed.canClaim, true, 'and canClaim is back');
await markDeedExtracted(pool, { nonce: ext.body.nonce, tokenId: ext.body.tokenId }); // idempotent — a re-delivered event is a no-op

// RE-IMPORT (the Redeemed watcher): a DEEDLESS burner with a linked wallet takes the on-chain deed back
const burner = await mk('Bruno');
await linkWallet(burner.acct, burnerWallet);
const ri = await reimportDeed(pool, { ref: 'tx1:0', from: burnerWallet, tokenId: ext.body.tokenId });
assert.equal(ri.applied, true, 'the re-import applies to the linked burner');
const brBoard = (await call('GET', '/v1/deeds', { token: burner.token })).body;
assert.equal(brBoard.deed.name, 'Enzo Alley', 'the burner now holds the street — deed + name travelled');
assert.equal(brBoard.deed.onChain, false, 'back in the game (not on-chain)');
assert(brBoard.history.some((h) => h.kind === 'claim'), 'the WHOLE legend travelled with the token');
assert(brBoard.history.some((h) => h.detail && h.detail.includes('on-chain')), 'a lineage line marks the re-import');
assert.equal(brBoard.corner.iControl, true, 'control RESET to the re-importer — a clean corner (the identity-NFT lesson)');
assert.equal((await reimportDeed(pool, { ref: 'tx1:0', from: burnerWallet, tokenId: ext.body.tokenId })).duplicate, true,
  're-import is idempotent on the log ref (txHash:logIndex)');

// THE ON-CHAIN LIFE IS OVER — every field that described it is cleared with the token id (red-team C4).
// This is not tidiness: the STOCK-DELIVERY rail (brokers §3.4) resolves a deed's delivery target from
// `onchain_owner` first and `extracted_by_account` second. Leave either set and a deed that is
// re-imported, then re-extracted by SOMEBODY ELSE, spends its extract-pending window carrying the
// PREVIOUS life's owner — so that owner's allocations are delivered into the ERC-6551 vault of a deed
// the new extractor is about to control. Asserted through the delivery rail's own predicate, not just
// on the columns, because the columns are only a defect through what reads them.
const backHome = (await pool.query(
  'SELECT onchain_token_id, extracted_by_account, extracted_at, onchain_owner FROM street_deeds WHERE name=$1',
  ['Enzo Alley'])).rows[0];
assert.equal(backHome.onchain_token_id, null, 'the token id is cleared — the deed is in-game again');
assert.equal(backHome.extracted_by_account, null, 'and the extractor with it');
assert.equal(backHome.extracted_at, null, 'and when they did it');
assert.equal(backHome.onchain_owner, null, 'and the last on-chain owner — nothing survives to mis-route the next extraction');
const { deedTargetRows } = await import('../src/stockdeliver.js');
assert.equal((await deedTargetRows(pool)).some((t) => t.name === 'Enzo Alley'), false,
  'and the delivery rail no longer sees a re-imported street as anyone\'s stock target');

// ════════════ THE STRANDED-VAULT RECOVERY — a burn nobody can re-mint ════════════
//
// Burning FREEZES a deed's ERC-6551 vault, it never empties it — the address is a function of the
// tokenId, the tokenId is keccak(NAME), and nothing deletes a street_deeds row or frees its unique
// name, so re-minting the same street restores control with the contents intact. Ordinarily nobody
// has to act: the re-import stays `pending` and the sweep retries forever. The case that never
// resolves is a burn from a wallet that will NEVER link — then real stock sits frozen with no route.
// This is that route, and it recovers to a TREASURY HOLDING address (founder call, 2026-08-16), never
// to an address the caller supplies.
{
  const st = 'Stranded Row';
  const stToken = deedTokenId(st);
  const lost = await mk('Ghost');   // burned it, then vanished — no wallet ever links
  await pool.query('INSERT INTO street_deeds (account_id,name,name_lc,district,onchain_token_id) VALUES ($1,$2,$3,$4,$5)',
    ['onchain:' + stToken, st, st.toLowerCase(), 'docks', stToken]);
  const recover = (body) => call('POST', '/v1/mod/deeds/recover', { mod: true, body });

  // GATE: no treasury address configured → refuse. With nowhere agreed to send a recovered street,
  // not recovering is safer than guessing, so unset must FAIL rather than fall back to anything.
  assert.equal((await recover({ street: st })).body.error, 'no_recovery_address',
    'with no treasury holding address configured, recovery refuses rather than guessing a destination');
  process.env.DEED_RECOVERY_ADDRESS = '0x000000000000000000000000000000000000dead';

  // WALL 2 — a burn must actually have been RECORDED. Without it the street may still be owned
  // on-chain, and recovering a live deed would be a confiscation.
  assert.equal((await recover({ street: st })).body.error, 'not_burned',
    'no recorded burn → no recovery: a voucher for a street somebody still owns is a confiscation');

  // record the burn from a wallet that is not linked to any account (the stranding condition)
  await pool.query("INSERT INTO deed_reimports (ref, wallet_address, token_id) VALUES ($1,$2,$3)",
    ['lostburn:0', '0x000000000000000000000000000000000000bEEF', stToken]);
  // WALL 3 — a fresh burn is IN FLIGHT, not stranded. The sweep may still land it.
  assert.equal((await recover({ street: st })).body.error, 'too_soon',
    'a burn minutes old is in flight — the wait is what distinguishes stranded from in-flight');
  await pool.query("UPDATE deed_reimports SET created_at = now() - interval '60 days' WHERE ref='lostburn:0'");

  // WALL 2 again — a street that is NOT in the on-chain state is not recoverable at all
  assert.equal((await recover({ street: 'Corvino Way' })).body.error, 'not_stranded',
    'a street sitting in the game is not stranded — only the on-chain state is recoverable');

  const rec = await recover({ street: st });
  assert.equal(rec.code, 200, 'a genuinely stranded street recovers');
  // WALL 1 — the destination is FIXED. The caller named no address and cannot: a recovery can never be
  // talked into "I lost my key, mint my street to this new wallet".
  assert.equal(rec.body.to.toLowerCase(), '0x000000000000000000000000000000000000dead',
    'it recovers to the TREASURY HOLDING address, never anywhere the caller could aim it');
  assert.equal(rec.body.tokenId, stToken, 'and to the SAME token id — which is what unfreezes the vault');
  // the voucher is real: it recovers to the server signer against the CONTRACT's own domain
  const rsig = await recoverTypedDataAddress({ domain: contractDomain, types: DEED_VOUCHER_TYPES,
    primaryType: 'DeedVoucher', message: { to: rec.body.voucher.to, name: rec.body.voucher.name,
      district: rec.body.voucher.district, nonce: BigInt(rec.body.voucher.nonce), deadline: BigInt(rec.body.voucher.deadline) },
    signature: rec.body.signature });
  assert.equal(rsig.toLowerCase(), privateKeyToAccount(process.env.VOUCHER_SIGNER_PK).address.toLowerCase(),
    'the recovery voucher is signed by the server signer against the contract domain');

  // WALL 4 — the pending re-import is SUPERSEDED. Without this the sweep could later hand the street
  // to the burner while the treasury holds the NFT: two parties each believing they own it.
  assert.equal((await pool.query("SELECT status FROM deed_reimports WHERE ref='lostburn:0'")).rows[0].status,
    'superseded', 'the pending re-import is superseded, so the sweep can never split-brain the street');
  await sweepDeedReimports(pool);
  assert.equal((await pool.query('SELECT account_id FROM street_deeds WHERE name=$1', [st])).rows[0].account_id,
    'onchain:' + stToken, 'and the sweep leaves it alone — the treasury holds it now');

  // the operator board names what is stuck, and only what is stuck
  const board = (await call('GET', '/v1/mod/deeds/stranded', { mod: true })).body;
  assert.equal(board.stranded.some((s) => s.street === st), false, 'a recovered street leaves the stranded list');
  assert.equal((await call('GET', '/v1/mod/deeds/stranded')).code, 401, 'the board is mod-gated');
  delete process.env.DEED_RECOVERY_ADDRESS;
  void lost;
}

// ════════════ THE VAULT'S RECORD — what travels with the street (the red-team follow-up) ════════════
//
// A deed's ERC-6551 vault is keyed on tokenId = keccak(NAME), so it SURVIVES THE BURN: 'Enzo Alley' was
// extracted, burned and re-imported above, and its vault is the same account it always was. Anything in
// it travels with the name to whoever extracts it next — including an in-game BUYER, who was pricing
// the street with no sight of it. That bijection is load-bearing (it is what makes a burned deed's vault
// recoverable rather than stranded forever), so the fix is DISCLOSURE, asserted here.
const enzoToken = deedTokenId('Enzo Alley');
await pool.query(
  `INSERT INTO stock_deliveries (delivery_id, epoch_id, account_id, ticker, units, deed_token_id, tba, tx_hash, status)
     VALUES ('vd-real','ep-v',$1,'TSLA',4.5,$2,'0xVAULT','0xrealtx','delivered'),
            ('vd-real2','ep-v',$1,'TSLA',0.5,$2,'0xVAULT','0xrealtx2','delivered'),
            ('vd-comp','ep-v',$1,'NVDA',99,$2,'0xVAULT',NULL,'simulated')`, [e.acct, enzoToken]);

// THE OWNER SEES IT — and note WHOSE board this is: the burner, who never extracted anything. The
// record resolves off the NAME, so a re-imported deed (onchain_token_id NULL) still carries its vault.
const brVault = (await call('GET', '/v1/deeds', { token: burner.token })).body.deed.vault;
assert(brVault, 'a re-imported street still carries its vault record — it is keyed on the NAME, which survived the burn');
assert.equal(brVault.received.length, 1, 'ONE line — the two real TSLA deliveries fold into one, and the comp is not a line at all');
assert.equal(brVault.received[0].ticker, 'TSLA', 'the ticker that was really delivered');
assert.equal(brVault.received[0].units, 5, 'summed across deliveries (4.5 + 0.5)');
assert.equal(brVault.received.some((r) => r.ticker === 'NVDA'), false,
  'a COMP delivery books no stock, so it is NEVER shown as received — showing one would fabricate exactly what the txHash gate prevents');
assert.equal(brVault.tba, '0xVAULT', 'the account is published so a buyer can check it themselves — no RPC needed to say where it is');

// THE BUYER SEES IT TOO — the whole point. A deedless buyer browsing the market gets the vault on the
// listing, so the street is priced with it rather than around it.
await call('POST', '/v1/deeds/list', { token: burner.token, body: { price: 50000 } });
const shopper = await mk('Nico');
const listing = ((await call('GET', '/v1/deeds', { token: shopper.token })).body.market.forSale || [])
  .find((s) => s.street === 'Enzo Alley');
assert(listing, 'the street is on the market');
assert(listing.vault && listing.vault.received[0].units === 5,
  'and its listing states the vault — a buyer prices the street WITH what comes with it');

// THE BUY-CONFIRM READ — the record inside the read txn, the live balance outside it. Chain-dormant
// here, so `live:false` — never a fabricated zero, because "we can't see the vault" and "the vault is
// empty" are different answers and only one of them is true.
const vr = await call('GET', '/v1/deeds/vault/' + burner.id, { token: shopper.token });
assert.equal(vr.code, 200, 'the confirm read answers');
assert.equal(vr.body.street, 'Enzo Alley', 'keyed on the SELLER exactly like the buy — the confirm can never describe a different deed than the purchase');
assert.equal(vr.body.price, 50000, 'and quotes the price the buy will charge');
assert.equal(vr.body.vault.received[0].units, 5, 'the record');
assert.equal(vr.body.live.live, false, 'the live half is honestly UNAVAILABLE with no chain — not an empty vault');
await call('POST', '/v1/deeds/unlist', { token: burner.token });

// §10.4-NEUTRALITY: the whole on-chain lifecycle (extract → confirm → re-import) + the vault disclosure
// wrote ZERO ledger rows — reading what a vault received moves nothing.
assert.equal(await txCount(), chainTx0, 'the on-chain deed lifecycle moves NO §10.4 value — a deed is ownership, not a currency');

console.log('deeds: PASS');
await app.close();
process.exit(0);

// THE GAMBLING DEN test — street craps (pass line, one-call rounds) + the daily Numbers.
// Proves the guardrails: cash only ($OMR never moves), located at neon, table limits, every
// stake/payout ledgered casino:* (per-character §10.4 identity holds EXACTLY over a gambling
// session), the 1% street cut feeding the tax pool, one ticket/day, lazy claim at 600:1,
// and the vocabulary knows the new reasons. Runs on pg-mem — zero infra.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { CASINO, UNDERWORLD, numbersDrawOf, dayOf, weekOf, hash01, MARKET_SEED } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body, headers } = {}) => {
  const res = await app.inject({ method, url,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers || {}) }, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;

const { body: { token } } = await call('POST', '/v1/auth/guest');
await call('POST', '/v1/character', { token, body: { name: 'Lucky Lou' } });
const cid = (await meOf(token)).id;
const seed = (cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${cid}'`);

// ── gates: the den is at the Neon Mile; the tables have limits; lockup has no dice ──
await seed("cash=1000000, nerve=50, energy=200, loc='docks'");
assert.equal((await call('POST', '/v1/casino/dice', { token, body: { amount: 500 } })).body.error, 'district', 'the den runs on neon — travel there');
await seed("loc='neon'");
assert.equal((await call('POST', '/v1/casino/dice', { token, body: { amount: 50 } })).body.error, 'min', 'table minimum $100');
assert.equal((await call('POST', '/v1/casino/dice', { token, body: { amount: 500000 } })).body.error, 'max', 'table maximum $250k');
await seed("jail_until = now() + interval '1 hour'");
assert.equal((await call('POST', '/v1/casino/dice', { token, body: { amount: 500 } })).body.error, 'jailed', 'no dice from lockup');
await seed("jail_until=NULL");

// ── street craps: a session of rounds — wins and losses both land, all of it ledgered ──
const omrBefore = (await meOf(token)).omr;
const taxPre = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
let wins = 0, losses = 0, staked = 0, paidOut = 0;
// econ pass: mirror of the HOUSE BOOK — the street is tipped 1% per stake but only out of realized
// profit (no open tickets during the session, so liability is 0 and the mirror is exact)
let denProfit = 0, denDist = 0;
for (let i = 0; i < 60; i++) {
  await seed('nerve=50'); // nerve is the natural throttle; refill to keep the session going
  const r = await call('POST', '/v1/casino/dice', { token, body: { amount: 1000 } });
  assert.equal(r.code, 200, `round resolves (${JSON.stringify(r.body)})`);
  assert(Array.isArray(r.body.rolls) && r.body.rolls.length >= 1, 'the roll sequence comes back');
  const last = r.body.rolls[r.body.rolls.length - 1];
  if (r.body.rolls.length === 1) assert([7, 11, 2, 3, 12].includes(last), 'a one-roll round is a natural or craps');
  else assert(last === 7 || last === r.body.point, 'a point round ends on the point or a seven');
  staked += 1000;
  denProfit += 1000;                                                // the stake enters the book…
  const take = Math.min(10, Math.max(0, denProfit - denDist));      // …the tip is profit-capped
  denDist += take;
  if (r.body.win) { wins++; paidOut += 2000; denProfit -= 2000; } else losses++;
}
assert(wins > 0 && losses > 0, `both outcomes over 60 rounds (${wins}W/${losses}L)`);
// every roll is in the audit log
assert(Number((await pool.query(`SELECT COUNT(*) n FROM rng_audit WHERE action='casino:dice' AND character_id='${cid}'`)).rows[0].n) === 60, 'every round rng-audited');
// the ledger knows every dollar: bets == -staked, wins == payouts
const sum = async (reason) => Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='${reason}' AND character_id='${cid}'`)).rows[0].s);
assert.equal(await sum('casino:bet:dice'), -staked, 'every stake is a ledgered casino:bet:dice sink');
assert.equal(await sum('casino:win:dice'), paidOut, 'every payout is a ledgered casino:win:dice faucet');
// the street's cut: 1% of each stake, CAPPED at the house's realized profit (the mint-on-top fix —
// the den tips out of its winnings, it never emits on volume)
const taxPost = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
assert.equal(taxPost - taxPre, denDist, 'the street cut is tipped only out of realized profit');
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='casino:take'")).rows[0].s),
  -denDist, 'every tip-out is a ledgered NULL casino:take row');
const dvCraps = (await pool.query('SELECT profit, distributed FROM den_volume WHERE id=1')).rows[0];
assert.equal(Number(dvCraps.profit), staked - paidOut, 'the house book mirrors the ledger (profit == bets − wins)');
assert.equal(Number(dvCraps.distributed), denDist, 'and knows exactly what it tipped out');
// THE regulatory line: a gambling session never touches $OMR
assert.equal((await meOf(token)).omr, omrBefore, 'the den never touches $OMR — cash only');

// ── the Numbers: one ticket a day, lazy claim at 600:1 against the seed-drawn number ──
const den = await call('GET', '/v1/casino', { token });
assert.equal(den.code, 200, 'den info');
assert(den.body.numbers.yesterday >= 0 && den.body.numbers.yesterday <= 999, "yesterday's number is public");
let rr = await call('POST', '/v1/casino/numbers', { token, body: { pick: 1234, amount: 100 } });
assert.equal(rr.body.error, 'pick', '0–999 only');
rr = await call('POST', '/v1/casino/numbers', { token, body: { pick: 777, amount: 5 } });
assert.equal(rr.body.error, 'min', 'numbers minimum $10');
rr = await call('POST', '/v1/casino/numbers', { token, body: { pick: 777, amount: 100 } });
assert.equal(rr.code, 200, 'ticket bought');
assert.equal((await call('POST', '/v1/casino/numbers', { token, body: { pick: 8, amount: 100 } })).body.error, 'ticket', 'one ticket a day');
assert.equal((await call('POST', '/v1/casino/numbers/claim', { token })).body.settled, 0, "today's ticket hasn't matured — nothing to settle");
// backdate the ticket to YESTERDAY and make it a WINNER (the pick is set to yesterday's draw —
// state warping, not value: the stake was honestly paid above)
const yesterday = dayOf() - 1;
const winningPick = numbersDrawOf(yesterday);
await pool.query(`UPDATE numbers_tickets SET day=${yesterday}, pick=${winningPick} WHERE character_id='${cid}'`);
const cashPreClaim = (await meOf(token)).cash;
rr = await call('POST', '/v1/casino/numbers/claim', { token });
assert.equal(rr.code, 200, 'claimed'); assert.equal(rr.body.settled, 1, 'one ticket settled');
assert.equal(rr.body.won, 100 * CASINO.NUMBERS_PAYOUT, 'the hit paid 600:1');
assert.equal((await meOf(token)).cash, cashPreClaim + 60000, 'the payout landed in pocket');
assert.equal(await sum('casino:win:numbers'), 60000, 'the win is a ledgered faucet');
assert.equal((await call('POST', '/v1/casino/numbers/claim', { token })).body.settled, 0, 'a settled ticket is gone (idempotent)');
// a losing ticket settles to nothing
rr = await call('POST', '/v1/casino/numbers', { token, body: { pick: (winningPick + 1) % 1000, amount: 100 } });
assert.equal(rr.code, 200, 'a second ticket (new day slot freed)');
await pool.query(`UPDATE numbers_tickets SET day=${yesterday} WHERE character_id='${cid}'`);
rr = await call('POST', '/v1/casino/numbers/claim', { token });
assert.equal(rr.body.settled, 1, 'the loser settled'); assert.equal(rr.body.won, 0, 'and paid nothing');

// econ-pass regression: the 600:1 hit put the house DEEP under water — no street cut is minted on
// top of a stake until the book recovers (the old model tipped 1% regardless of results)
assert(Number((await pool.query('SELECT profit FROM den_volume WHERE id=1')).rows[0].profit) < 0,
  'the jackpot drove the house book negative');
const poolUW = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
await seed('nerve=50');
assert.equal((await call('POST', '/v1/casino/dice', { token, body: { amount: 1000 } })).code, 200, 'a round while the house is under water');
assert.equal(Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool), poolUW,
  'no street cut while the book is negative — the den only tips out of realized profit');

// ══════════ STEP TWO: back-room PvP dice, the weekly fight + the neon fix, rakeback ══════════
let seededCash = 1000000; // every later seed is a tracked RELATIVE bump so the identity check stays exact

// ── back-room dice: consent-by-listing, symmetric roll, winner takes pot − 5% rake ──
const { body: { token: t2 } } = await call('POST', '/v1/auth/guest');
await call('POST', '/v1/character', { token: t2, body: { name: 'Dice Danny' } });
const did = (await meOf(t2)).id;
await pool.query(`UPDATE characters SET cash=100000, loc='neon', nerve=50 WHERE id='${did}'`);
assert.equal((await call('POST', `/v1/casino/dice/${did}`, { token, body: { amount: 1000 } })).body.error, 'not_fading', 'no action without a listing');
assert.equal((await call('POST', '/v1/casino/fade', { token: t2, body: { limit: 50 } })).body.error, 'limit', 'fade limits respect the table');
rr = await call('POST', '/v1/casino/fade', { token: t2, body: { limit: 20000 } });
assert.equal(rr.code, 200, 'danny lists an open fade'); assert.equal(rr.body.character.fadeLimit, 20000, 'surfaced in the view');
assert((await call('GET', '/v1/casino', { token })).body.backroom.faders.some((f) => f.id === did), 'danny is on the den board');
assert.equal((await call('POST', `/v1/casino/dice/${did}`, { token, body: { amount: 50000 } })).body.error, 'limit', 'the fade limit binds');
// play until both outcomes seen; verify the exact transfer + rake every round
let pvpW = 0, pvpL = 0;
for (let i = 0; i < 30 && (pvpW === 0 || pvpL === 0); i++) {
  await seed("nerve=50");
  const louPre = (await meOf(token)).cash, danPre = (await meOf(t2)).cash;
  const taxP = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
  const g = await call('POST', `/v1/casino/dice/${did}`, { token, body: { amount: 2000 } });
  assert.equal(g.code, 200, `backroom round resolves (${JSON.stringify(g.body)})`);
  const rake = g.body.rake;
  assert.equal(rake, Math.ceil(4000 * 0.05), 'the rake is 5% of the pot');
  if (g.body.win) { pvpW++;
    assert.equal((await meOf(token)).cash, louPre + 2000 - rake, 'winner nets stake − rake');
    assert.equal((await meOf(t2)).cash, danPre - 2000, 'loser pays the stake');
  } else { pvpL++;
    assert.equal((await meOf(token)).cash, louPre - 2000, 'loser pays the stake');
    assert.equal((await meOf(t2)).cash, danPre + 2000 - rake, 'winner nets stake − rake');
  }
  assert.equal(Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool) - taxP,
    Math.floor(rake / 2), 'half the rake to the street, the rest burns');
}
assert(pvpW > 0 && pvpL > 0, `both sides won at least once (${pvpW}/${pvpL})`);

// ── the fight: one capped bet a week; the family holding neon can buy the result ──
// SIGN-OFF (2.5): the book won't take action from a rookie — an anti-alt floor on the fix-Sybil ring
const { body: { token: rookieTok } } = await call('POST', '/v1/auth/guest');
await call('POST', '/v1/character', { token: rookieTok, body: { name: 'Rookie Ricky' } });
await pool.query(`UPDATE characters SET cash=100000, loc='neon' WHERE id='${(await meOf(rookieTok)).id}'`);
assert.equal((await call('POST', '/v1/casino/fight', { token: rookieTok, body: { side: 'a', amount: 500 } })).body.error, 'rookie', 'a fresh alt (level 1) is refused a fight bet');
await seed('respect=200'); // Lou is level 7 — clears the fight-bet floor
assert.equal((await call('POST', '/v1/casino/fight', { token, body: { side: 'x', amount: 500 } })).body.error, 'side', "back 'a' or 'b'");
assert.equal((await call('POST', '/v1/casino/fight', { token, body: { side: 'b', amount: 50000 } })).body.error, 'max', 'fight bets cap small — the fix stays bounded');
rr = await call('POST', '/v1/casino/fight', { token, body: { side: 'b', amount: 5000 } });
assert.equal(rr.code, 200, 'backed the dog'); assert(rr.body.a && rr.body.b, 'the bout card names the fighters');
assert.equal((await call('POST', '/v1/casino/fight', { token, body: { side: 'a', amount: 500 } })).body.error, 'bet', 'one bet a bout');
assert.equal((await call('POST', '/v1/casino/fight/claim', { token })).body.settled, 0, 'the bout has not gone off yet');
// the fix: boss-only, neon-holders-only, once, treasury-funded
assert.equal((await call('POST', '/v1/casino/fight/fix', { token, body: { winner: 'b' } })).body.error, 'rank', 'no family, no fix');
await seed(`respect=${4 * 57 * 57}`); // level 58 — founding, the high-stakes room, and the casino front below
const gangId = (await call('POST', '/v1/gangs', { token, body: { name: 'Neon Kings', tag: 'NKG' } })).body.gangId;
assert(gangId, 'lou founded a family'); seededCash -= 0; // founding is ledgered, not seeded
assert.equal((await call('POST', '/v1/gangs/tribute', { token, body: { amount: 100000 } })).code, 200, 'war chest funded');
assert.equal((await call('POST', '/v1/casino/fight/fix', { token, body: { winner: 'b' } })).body.error, 'turf', 'the fix belongs to whoever runs neon');
await pool.query(`UPDATE districts SET npc_holder=NULL WHERE id='neon'`); // World step five: this test just needs the family to hold neon (bypass the apex NPC occupation)
assert.equal((await call('POST', '/v1/districts/neon/seize', { token })).code, 200, 'the Kings took the Mile');
const treasuryPreFix = (await call('GET', `/v1/gangs/${gangId}`, {})).body.gang.treasury;
const madamePreFix = (await call('GET', '/v1/underworld', { token })).body.npcs.find((n) => n.id === 'madame').standing;
rr = await call('POST', '/v1/casino/fight/fix', { token, body: { winner: 'b' } });
assert.equal(rr.code, 200, 'the referee is bought'); assert.equal(rr.body.cost, CASINO.FIGHT_FIX_COST, 'for the listed price');
assert.equal((await call('GET', `/v1/gangs/${gangId}`, {})).body.gang.treasury, treasuryPreFix - CASINO.FIGHT_FIX_COST, 'paid from the treasury');
// Underworld step five, rivalry #3: nobody fixes HER book — the buying boss wears it
assert.equal((await call('GET', '/v1/underworld', { token })).body.npcs.find((n) => n.id === 'madame').standing,
  Math.max(0, madamePreFix - UNDERWORLD.STEP5.FIX_LOSS), 'the Madame heard who bought the referee (−5)');
assert.equal((await call('POST', '/v1/casino/fight/fix', { token, body: { winner: 'a' } })).body.error, 'fixed', 'one fix a bout');
// roll the bout into the past: the FIXED result pays the dog backer at 2.6
const wk = weekOf();
await pool.query(`UPDATE fight_bets SET week=${wk - 1} WHERE character_id='${cid}'`);
await pool.query(`UPDATE fight_fixes SET week=${wk - 1} WHERE week=${wk}`);
const cashPreFight = (await meOf(token)).cash;
rr = await call('POST', '/v1/casino/fight/claim', { token });
assert.equal(rr.body.settled, 1, 'the bout settled');
assert.equal(rr.body.won, Math.floor(5000 * CASINO.FIGHT_DOG_PAYS), 'the fixed dog paid 2.6');
assert.equal((await meOf(token)).cash, cashPreFight + 13000, 'the payout landed');
// an UNFIXED bout resolves off the seed draw
rr = await call('POST', '/v1/casino/fight', { token, body: { side: 'a', amount: 1000 } });
assert.equal(rr.code, 200, 'a fresh bet on the new bout');
await pool.query(`UPDATE fight_bets SET week=${wk - 2} WHERE character_id='${cid}'`);
const drawWinner = hash01(`fight:${wk - 2}:${MARKET_SEED}`) < CASINO.FIGHT_FAV_P ? 'a' : 'b';
rr = await call('POST', '/v1/casino/fight/claim', { token });
assert.equal(rr.body.settled, 1, 'unfixed bout settled');
assert.equal(rr.body.results[0].winner, drawWinner, 'the seed draw decided it');
assert.equal(rr.body.won, drawWinner === 'a' ? Math.floor(1000 * CASINO.FIGHT_FAV_PAYS) : 0, 'paid iff the pick hit');

// ── rakeback: a casino-front owner earns a cut of den volume — paid ONLY out of house profit ──
await seed("cash = cash + 8000000"); seededCash += 8000000;
rr = await call('POST', '/v1/business/casino/buy', { token });
assert.equal(rr.code, 200, 'lou bought the casino front');
const volAtBuy = Number((await pool.query('SELECT total FROM den_volume WHERE id=1')).rows[0].total);
assert.equal(Number((await pool.query("SELECT rake_cursor FROM businesses WHERE character_id=$1 AND kind='casino'", [cid])).rows[0].rake_cursor),
  volAtBuy, 'the rakeback cursor starts at today — no claiming history');
// econ-pass regression: the house is still under water from the 600:1 hit — the rakeback WAITS
// (the cursor holds; the claim isn't forfeited, it's just not minted while the book is negative)
await seed("nerve=50");
assert.equal((await call('POST', '/v1/casino/dice', { token, body: { amount: 1000 } })).code, 200, 'volume lands after the buy');
rr = await call('POST', '/v1/business/collect', { token });
assert.equal(rr.body.rakeback, undefined, 'no rakeback while the book is negative');
assert.equal(Number((await pool.query("SELECT rake_cursor FROM businesses WHERE character_id=$1 AND kind='casino'", [cid])).rows[0].rake_cursor),
  volAtBuy, 'the cursor holds — the claim waits for the house to recover, nothing forfeits');
// bank REAL profit for the house (honest play, no value seeded): matured losing tickets, until the
// book can cover the rakeback owed on the volume since the cursor
for (let i = 0; i < 300; i++) {
  const dv = (await pool.query('SELECT profit, distributed FROM den_volume WHERE id=1')).rows[0];
  const volNow0 = Number((await pool.query('SELECT total FROM den_volume WHERE id=1')).rows[0].total);
  const owed = Math.floor((volNow0 - volAtBuy) * CASINO.RAKEBACK_BPS / 10000);
  if (Number(dv.profit) - Number(dv.distributed) >= owed + 1000) break;
  rr = await call('POST', '/v1/casino/numbers', { token, body: { pick: 0, amount: 1000 } });
  assert.equal(rr.code, 200, `top-up ticket (${JSON.stringify(rr.body)})`);
  await pool.query(`UPDATE numbers_tickets SET day=${yesterday}, pick=${(winningPick + 1) % 1000} WHERE character_id='${cid}'`);
  await call('POST', '/v1/casino/numbers/claim', { token }); // a settled loser: +$1k realized profit
}
rr = await call('POST', '/v1/business/collect', { token });
assert.equal(rr.code, 200, 'collected');
const volNow = Number((await pool.query('SELECT total FROM den_volume WHERE id=1')).rows[0].total);
assert.equal(rr.body.rakeback, Math.floor((volNow - volAtBuy) * CASINO.RAKEBACK_BPS / 10000),
  'the owner raked 1% of the volume since the cursor — now that the house can pay it');
assert.equal(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='casino:rakeback' AND character_id='${cid}'`)).rows[0].s),
  rr.body.rakeback, 'the rakeback is a ledgered casino: faucet');
assert.equal((await call('POST', '/v1/business/collect', { token })).body.rakeback, undefined, 'no double-claim — the cursor advanced');

// ── §10.4: the per-character cash identity holds EXACTLY over the whole gambling session ──
// (cash was SQL-seeded once at the top — everything after that has a row, so we check the DELTA
// from the seed against the ledger sum, and the vocabulary must know every casino reason)
const me = await meOf(token);
const ledgerAll = Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='cash' AND character_id='${cid}'`)).rows[0].s);
assert(Math.abs((me.cash + me.bank - seededCash) - ledgerAll) <= 1, `every gambled dollar reconciles (drift ${(me.cash + me.bank - seededCash) - ledgerAll})`);
const inv = await runLedgerInvariants(pool);
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `casino:* reasons are in the §10.4 vocabulary (${JSON.stringify(vocab.unknown || [])})`);
const treas = inv.checks.find((c) => c.name === 'gang treasuries');
assert(treas.ok, `the treasury check reconciles the casino:fix sink (drift ${treas.drift})`);
// econ pass: the den's book mirrors the ledger exactly — both §10.4 identities hold
const denP = inv.checks.find((c) => c.name === 'den profit');
assert(denP?.ok, `den profit == PvE bets − wins (drift ${denP?.drift})`);
const denD = inv.checks.find((c) => c.name === 'den distributions');
assert(denD?.ok, `den tip-outs are all ledgered (drift ${denD?.drift})`);

console.log(`✅ Gambling Den test passed — neon-located tables, limits, ${wins}W/${losses}L craps session fully ledgered (stakes/payouts/profit-capped street cut exact — the mint-on-top fix), $OMR untouched, Numbers ticket lifecycle (one/day, lazy 600:1 claim, idempotent settle), step two: back-room PvP dice (${pvpW}W/${pvpL}L, exact transfer + 5% rake, half to the street), the weekly fight (capped book, neon-family fix from the treasury — and the Madame docks the buying boss 5, Underworld rivalry #3 — fixed + seed-drawn settlements), casino-front rakeback (cursor-exact, no history claims), §10.4 identity + vocabulary + treasury checks hold`);
await app.close();

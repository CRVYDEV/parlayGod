// THE GAMBLING DEN test — street craps (pass line, one-call rounds) + the daily Numbers.
// Proves the guardrails: cash only ($OMR never moves), located at neon, table limits, every
// stake/payout ledgered casino:* (per-character §10.4 identity holds EXACTLY over a gambling
// session), the 1% street cut feeding the tax pool, one ticket/day, lazy claim at 600:1,
// and the vocabulary knows the new reasons. Runs on pg-mem — zero infra.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { CASINO, numbersDrawOf, dayOf } from '../src/rules.js';
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
for (let i = 0; i < 60; i++) {
  await seed('nerve=50'); // nerve is the natural throttle; refill to keep the session going
  const r = await call('POST', '/v1/casino/dice', { token, body: { amount: 1000 } });
  assert.equal(r.code, 200, `round resolves (${JSON.stringify(r.body)})`);
  assert(Array.isArray(r.body.rolls) && r.body.rolls.length >= 1, 'the roll sequence comes back');
  const last = r.body.rolls[r.body.rolls.length - 1];
  if (r.body.rolls.length === 1) assert([7, 11, 2, 3, 12].includes(last), 'a one-roll round is a natural or craps');
  else assert(last === 7 || last === r.body.point, 'a point round ends on the point or a seven');
  staked += 1000;
  if (r.body.win) { wins++; paidOut += 2000; } else losses++;
}
assert(wins > 0 && losses > 0, `both outcomes over 60 rounds (${wins}W/${losses}L)`);
// every roll is in the audit log
assert(Number((await pool.query(`SELECT COUNT(*) n FROM rng_audit WHERE action='casino:dice' AND character_id='${cid}'`)).rows[0].n) === 60, 'every round rng-audited');
// the ledger knows every dollar: bets == -staked, wins == payouts
const sum = async (reason) => Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='${reason}' AND character_id='${cid}'`)).rows[0].s);
assert.equal(await sum('casino:bet:dice'), -staked, 'every stake is a ledgered casino:bet:dice sink');
assert.equal(await sum('casino:win:dice'), paidOut, 'every payout is a ledgered casino:win:dice faucet');
// the street's cut: 1% of every stake landed in the tax pool
const taxPost = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
assert.equal(taxPost - taxPre, Math.ceil(1000 * 0.01) * 60, 'the street takes 1% of every stake (→ the buyback)');
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

// ── §10.4: the per-character cash identity holds EXACTLY over the whole gambling session ──
// (cash was SQL-seeded once at the top — everything after that has a row, so we check the DELTA
// from the seed against the ledger sum, and the vocabulary must know every casino reason)
const me = await meOf(token);
const ledgerAll = Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='cash' AND character_id='${cid}'`)).rows[0].s);
assert(Math.abs((me.cash + me.bank - 1000000) - ledgerAll) <= 1, `every gambled dollar reconciles (drift ${(me.cash + me.bank - 1000000) - ledgerAll})`);
const vocab = (await runLedgerInvariants(pool)).checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `casino:* reasons are in the §10.4 vocabulary (${JSON.stringify(vocab.unknown || [])})`);

console.log(`✅ Gambling Den test passed — neon-located tables, limits, ${wins}W/${losses}L craps session fully ledgered (stakes/payouts/1% street cut exact), $OMR untouched, Numbers ticket lifecycle (one/day, lazy 600:1 claim, idempotent settle), §10.4 identity + vocabulary hold`);
await app.close();

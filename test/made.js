// THE FLOAT (economy v3 step 5) — THE MADE MAN, the tiered loot rate and the access stake.
// The 63rd suite. Design §5 (the holding problem), §11.1, §11.2, §11.5.
//
// The step exists because of one sentence: **a consumable you should never HOLD cannot be the loot
// that makes killing worth it.** So the assertions are aimed at the ways that could fail rather than
// at the happy path:
//
//   (1) THE DUES BUY POWER. The line that keeps the game free is that operating costs stay in CASH
//       and a subscription gates no earning loop's strength. The pad-pays-itself convenience is the
//       one that could drift: it must deduct the SAME cash and write the SAME ledger row, or it has
//       quietly become a discount.
//   (2) THE SINK DESTROYS SUPPLY. Since step 2 a sink hands its $OMR to the desk. A new sink that
//       forgets to recycle silently shrinks the shelf the auction sells from.
//   (3) THE FLOAT IS STILL SAFE SOMEWHERE. Staking used to be a safe harbour and §4.1 admits no
//       fourth way for $OMR to move, so "committed" has to mean CHEAPER, never FREE.
//
// pg-mem, zero infra. SQL-granting $OMR is an unledgered mint (the estate/portfolio precedent), so
// the $OMR-conservation DRIFT stays exactly the grant — which is what proves `made:dues` reconciles.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { MADE, ACCESS_STAKE, CASINO, DESK, recyclesToDesk, estateTierOf, SPEAKEASY,
  BUSINESSES, PACING, businessTierOf } from '../src/rules.js';
import { upkeepBps } from '../src/business.js';
import { runLedgerInvariants } from '../src/invariants.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url,
    headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  return { token, id: (await meOf(token)).id };
};
const seed = (id, sql) => pool.query(`UPDATE characters SET ${sql} WHERE id='${id}'`);
const grantOmr = (id, n) => pool.query(
  `UPDATE account_persistent SET omr = omr + ${n} WHERE account_id=(SELECT account_id FROM characters WHERE id='${id}')`);
const shelf = async () => Number((await pool.query('SELECT balance FROM desk_inventory WHERE id=1')).rows[0].balance);
const rowsOf = async (id, reason) => (await pool.query(   // account-scoped ($OMR rides the account)
  `SELECT amount FROM transactions WHERE account_id=(SELECT account_id FROM characters WHERE id='${id}') AND reason=$1`, [reason])).rows;
const charRowsOf = async (id, reason) => (await pool.query( // character-scoped (cash rides the street)
  `SELECT amount FROM transactions WHERE character_id=$1 AND reason=$2`, [id, reason])).rows;
const lvlRespect = (lvl) => Math.ceil(Math.pow(lvl - 1, 2) * PACING.LEVEL_DIVISOR);
let grantDrift = 0;

// ═══════════════ 1. THE CLASSIFICATION — the dues are a sink, and sinks recycle ═══════════════
assert(DESK.SINK_REASONS.some((p) => p === 'made:%'), "the dues are in the SINGLE sink list (so the burn term and the desk feed can't drift apart)");
assert(recyclesToDesk('made:dues'), 'a dues payment RECYCLES to the desk — since step 2 a sink hands the token over rather than destroying it');

// ═══════════════ 2. THE BOARD, AND PAYING THE DUES ═══════════════
const don = await mk('Don Dues');
let r = await call('GET', '/v1/made', { token: don.token });
assert.equal(r.code, 200, 'the board is readable by anyone');
assert.equal(r.body.made, false, 'a nobody is not made');
assert.equal(r.body.dues, MADE.OMR, 'the price is published');
assert.equal(r.body.days, Math.round(MADE.MS / 86400000), 'and the window it buys');
assert(r.body.opens.length >= 4, 'the board states what standing opens');
assert(/no earning loop is gated/i.test(r.body.buysNoPower), 'and says plainly that it buys no power');

assert.equal((await call('POST', '/v1/made', { token: don.token })).body.error, 'omr', 'you cannot be made on credit');
await grantOmr(don.id, 100); grantDrift += 100;
const shelfPre = await shelf();
r = await call('POST', '/v1/made', { token: don.token });
assert.equal(r.code, 200, 'the dues are paid');
assert.equal(r.body.made, true, "you're made");
assert.equal((await meOf(don.token)).omr, 100 - MADE.OMR, 'the burn debited exactly the dues');
assert.equal((await meOf(don.token)).made, true, 'and the badge is on the sheet');
assert(Math.abs((await meOf(don.token)).madeSeconds - MADE.MS / 1000) < 60, 'the window is the full term');
// the sink half: ledgered, and handed to the desk rather than destroyed
const duesRows = await rowsOf(don.id, 'made:dues');
assert.equal(duesRows.length, 1, 'one ledgered dues row');
assert.equal(Number(duesRows[0].amount), -MADE.OMR, 'a negative $OMR row — a burn, not a transfer to a player');
assert.equal(await shelf() - shelfPre, MADE.OMR, 'and the whole of it landed on the DESK SHELF (step 2) to be sold again');

// ── re-paying EXTENDS from the current end, it does not reset the clock ──
const endBefore = (await meOf(don.token)).madeSeconds;
r = await call('POST', '/v1/made', { token: don.token });
assert.equal(r.code, 200, 'a second month is fine');
const endAfter = (await meOf(don.token)).madeSeconds;
assert(endAfter > endBefore + MADE.MS / 1000 - 60, 'the second term stacks ON the first (later-of(now, end)) — paying early never burns the window you own');
assert.equal((await meOf(don.token)).omr, 100 - 2 * MADE.OMR, 'twice the dues');

// ═══════════════ 3. WHAT THE DUES OPEN — status and access, never power ═══════════════
// (a) THE UPPER COMPOUND. The estate is display-only, so this is status gating status.
const nobody = await mk('Nick Nobody');
await grantOmr(nobody.id, 5000); grantDrift += 5000;
for (let t = 1; t < MADE.ESTATE_TIER; t++) {
  assert.equal((await call('POST', '/v1/estate/upgrade', { token: nobody.token })).code, 200,
    `tier ${t} is open to everyone — the lower compound is not a paywall`);
}
r = await call('POST', '/v1/estate/upgrade', { token: nobody.token });
assert.equal(r.body.error, 'made', `the ${estateTierOf(MADE.ESTATE_TIER).name} needs standing`);
await pool.query(`UPDATE account_persistent SET made_until = now() + interval '30 days' WHERE account_id=(SELECT account_id FROM characters WHERE id='${nobody.id}')`);
assert.equal((await call('POST', '/v1/estate/upgrade', { token: nobody.token })).body.tier, MADE.ESTATE_TIER, 'made — the upper compound opens');

// (b) A HOUSE OF YOUR OWN. Gated at the OPENING only.
const host = await mk('Hank Hostess');
await seed(host.id, `respect=${lvlRespect(SPEAKEASY.MIN_LEVEL + 2)}, cash=${SPEAKEASY.OPEN_COST + 1000}`);
assert.equal((await call('POST', '/v1/speakeasy/neon/open', { token: host.token })).body.error, 'made',
  'a club is standing — the level and the cash are not enough');
await pool.query(`UPDATE account_persistent SET made_until = now() + interval '30 days' WHERE account_id=(SELECT account_id FROM characters WHERE id='${host.id}')`);
assert.equal((await call('POST', '/v1/speakeasy/neon/open', { token: host.token })).code, 200, 'made — the door opens');

// ═══════════════ 4. THE PAD PAYS ITSELF — and it is TIME, not POWER ═══════════════
// The one convenience that could quietly become a discount. A made owner's fronts settle their own
// upkeep on a touch — the SAME cash, the SAME ledger row. What is bought is not having to remember.
const kind = BUSINESSES[0].kind;
const tier1 = businessTierOf(kind, 1);
const mkOwner = async (name) => {
  const c = await mk(name);
  await seed(c.id, `respect=${lvlRespect(BUSINESSES[0].lvl + 2)}, cash=${tier1.cost * 3}`);
  assert.equal((await call('POST', `/v1/business/${kind}/buy`, { token: c.token })).code, 200, `${name} bought a front`);
  // run the clocks back so there is real income AND a real pad owed
  await pool.query(`UPDATE businesses SET last_collect_at = now() - interval '6 hours', upkeep_at = now() - interval '6 hours' WHERE character_id='${c.id}'`);
  return c;
};
const owed6h = Math.floor(tier1.incomePerHr * (upkeepBps(1) / 10000) * 6);
const free = await mkOwner('Freddy Free');
const paid = await mkOwner('Paulie Paid');
await pool.query(`UPDATE account_persistent SET made_until = now() + interval '30 days' WHERE account_id=(SELECT account_id FROM characters WHERE id='${paid.id}')`);

const freeCollect = await call('POST', '/v1/business/collect', { token: free.token });
assert.equal(freeCollect.code, 200, 'the free man collects');
assert.equal(freeCollect.body.padPaid, undefined, "…and nobody paid his pad for him — it is still owed");
assert.equal((await charRowsOf(free.id, 'business:upkeep')).length, 0, 'no upkeep row on a free collect');

const paidCollect = await call('POST', '/v1/business/collect', { token: paid.token });
assert.equal(paidCollect.code, 200, 'the made man collects');
assert.equal(paidCollect.body.padPaid, owed6h, 'the pad settled itself out of his pocket, to the dollar');
const padRows = await charRowsOf(paid.id, 'business:upkeep');
assert.equal(padRows.length, 1, 'and it is a REAL ledgered sink — the same row the manual route writes');
assert.equal(Number(padRows[0].amount), -owed6h, 'the same amount, NOT discounted — this is TIME, not POWER');
assert.equal(paidCollect.body.collected, freeCollect.body.collected,
  'and the INCOME is identical: standing changes who has to remember the pad, not what a front earns');

// ═══════════════ 5. THE ACCESS STAKE — the high-stakes room wants a HELD balance ═══════════════
const whale = await mk('Wally Whale');
await seed(whale.id, `respect=${lvlRespect(CASINO.HIGH_LVL + 5)}, cash=5000000, nerve=50, loc='${CASINO.DISTRICT}'`);
const overTable = CASINO.MAX_BET + 1000;
r = await call('POST', '/v1/casino/dice', { token: whale.token, body: { amount: overTable } });
assert.equal(r.body.error, 'max', 'level alone does not open the big table — the seat wants a stake behind it');
await grantOmr(whale.id, ACCESS_STAKE.HIGH_OMR); grantDrift += ACCESS_STAKE.HIGH_OMR;
assert.equal((await call('POST', '/v1/stake', { token: whale.token, body: { amount: ACCESS_STAKE.HIGH_OMR } })).code, 200, 'the stake is posted');
r = await call('POST', '/v1/casino/dice', { token: whale.token, body: { amount: overTable } });
assert.equal(r.code, 200, 'with the stake HELD, the high-stakes room opens');
// and the board states both conditions rather than making the player discover them
const den = (await call('GET', '/v1/casino', { token: whale.token })).body;
assert.equal(den.dice.highStakes.stakeOmr, ACCESS_STAKE.HIGH_OMR, 'the board publishes the stake the table wants');
assert.equal(den.dice.highStakes.staked, ACCESS_STAKE.HIGH_OMR, 'and what this player is holding');
assert.equal(den.dice.highStakes.stakeMet, true, 'and whether it clears');

// ═══════════════ 6. §10.4 — the vocabulary is closed and the dues reconcile ═══════════════
const inv = await runLedgerInvariants(pool, { alert: false });
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `every reason is enumerated: ${JSON.stringify(vocab)}`);
const cons = inv.checks.find((c) => c.name === '$OMR conservation');
assert.equal(cons.drift, grantDrift,
  `$OMR conservation drift is EXACTLY the unledgered SQL grants (${grantDrift}) — so made:dues reconciles as a burn, and its desk:recycle partner cancels inside the same term`);
const deskBacked = inv.checks.find((c) => c.name === 'desk inventory backed');
assert(deskBacked.ok, `the shelf still reconciles with the dues on it: ${JSON.stringify(deskBacked)}`);

await app.close();
console.log('✅ THE FLOAT (economy v3 step 5) test passed — the dues are a classified sink that RECYCLES to the desk (not a burn that destroys supply), the board publishes the price/term/gates, the burn is exact and the window extends from later-of(now, end), the gates open only status and access (the upper compound, a house of your own) while THE PAD PAYS ITSELF deducts the same cash and writes the same ledger row for the same income (TIME, never POWER), the access stake gates the high-stakes table on a HELD balance with both conditions on the board, and §10.4 holds — vocabulary closed, drift == the SQL grants only');

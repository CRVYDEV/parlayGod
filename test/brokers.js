// THE BROKERS — the activation sink and the epoch allocator.
// Design: `omerta-brokers-design.md`.
//
// What this file is really asserting is THE WEIGHT, because the weight is the whole design and the
// two ways it can be zero are what make this a game mechanic rather than a yield product:
//
//     weight = activationTier x activityScore
//
// Stonkbrokers' weight is a pure function of tokens burned, so their largest holder is by
// construction their largest earner. Ours multiplies by measured play, so an activated NFT owned by
// somebody who did not play earns NOTHING. That assertion is the point of this file.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { BROKERS, ACTIVITY, MASTERY, brokerWeight, activityScore, activityQualifies, dayOf } from '../src/rules.js';
import { allocateEpoch, epochBoard, gainsFor } from '../src/brokers.js';
import { runLedgerInvariants } from '../src/invariants.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url,
    headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const c = (await call('GET', '/v1/me', { token })).body.character;
  return { token, id: c.id, aid: (await pool.query(`SELECT account_id a FROM characters WHERE id='${c.id}'`)).rows[0].a };
};
const omrOf = async (aid) =>
  Number((await pool.query(`SELECT omr FROM account_persistent WHERE account_id='${aid}'`)).rows[0].omr);
const shelf = async () =>
  Number((await pool.query('SELECT balance FROM desk_inventory WHERE id=1')).rows[0]?.balance || 0);

const sal = await mk('Sal Vittorio');    // activates AND plays
const nico = await mk('Nico Barese');    // activates at the TOP tier and never plays

// ── the catalog is public ──
const rules = (await call('GET', '/v1/rules')).body;
assert.equal(rules.brokers.tiers.length, BROKERS.TIERS.length, 'the tier catalog is public');
assert(rules.brokers.tags.length > 0 && rules.brokers.minTracks > 0 && rules.brokers.minScore > 0,
  'the gate is published too — a client never re-derives the metric');

// ── an unactivated holder weighs nothing, however hard they played ──
const today = dayOf();
await pool.query(
  `INSERT INTO activity_log (account_id, day, tag, n) VALUES
   ('${sal.aid}', ${today}, 'crime', 200),
   ('${sal.aid}', ${today}, 'jump', 20),
   ('${sal.aid}', ${today}, 'heist', 5)`);

let r = await call('GET', '/v1/brokers', { token: sal.token });
assert.equal(r.code, 200, 'the board is readable');
assert(r.body.activity.score > 0, 'the play is scored');
assert.equal(r.body.activity.qualifies, true, 'and clears the breadth gate');
assert.equal(r.body.weight, 0, 'but an UNACTIVATED holder weighs nothing');
assert.equal(r.body.blocked, 'not_activated');

// ── activation burns $OMR, and the burn RECYCLES to the desk like every sink since economy v3 ──
await pool.query(`UPDATE account_persistent SET omr=6000 WHERE account_id='${sal.aid}'`);
const shelfBefore = await shelf();
const t3 = BROKERS.TIERS.find((x) => x.id === 3);

r = await call('POST', '/v1/brokers/activate', { token: sal.token, body: { tier: 3 } });
assert.equal(r.code, 200, JSON.stringify(r.body));
assert.equal(r.body.tier, 3);
assert.equal(r.body.mult, t3.mult);
assert.equal(await omrOf(sal.aid), 6000 - t3.omr, 'exactly the tier price left the balance');

const burns = (await pool.query(
  `SELECT amount FROM transactions WHERE account_id='${sal.aid}' AND reason='brokers:activate'`)).rows;
assert.equal(burns.length, 1, 'one ledgered burn');
assert.equal(Number(burns[0].amount), -t3.omr, 'for exactly the tier price');
assert.equal(await shelf() - shelfBefore, t3.omr, 'and it recycled to the desk shelf, not the fire');

// ── an activated holder who played weighs tier x score ──
r = await call('GET', '/v1/brokers', { token: sal.token });
assert.equal(r.body.activation.active, true);
assert.equal(r.body.blocked, null);
assert.equal(r.body.weight, brokerWeight(3, r.body.activity.gains), 'weight is tier x score, exactly');
assert(r.body.weight > 0);

// ── THE WALL: activation alone buys nothing ──────────────────────────────────────────────────────
// If this ever returns non-zero, the mechanism has become a yield product for whoever burns most.
await pool.query(`UPDATE account_persistent SET omr=30000 WHERE account_id='${nico.aid}'`);
r = await call('POST', '/v1/brokers/activate', { token: nico.token, body: { tier: 5 } });
assert.equal(r.code, 200, JSON.stringify(r.body));
r = await call('GET', '/v1/brokers', { token: nico.token });
assert.equal(r.body.activation.active, true, 'activated at the HIGHEST tier');
assert.equal(r.body.weight, 0, 'and still weighs NOTHING without play');
assert.equal(r.body.blocked, 'not_enough_play');

// ── the breadth gate: a one-loop grinder cannot qualify, whatever the score ──
const oneLoop = { crime: 500 };
assert(activityScore(oneLoop) > ACTIVITY.MIN_SCORE, 'plenty of raw score');
assert.equal(activityQualifies(oneLoop), false, 'but one track can never qualify');

// ── the allocator publishes weights and DELIVERS NOTHING ──
const ep = await allocateEpoch(pool, { endDay: today });
assert(ep.epochId, 'an epoch is published');
assert.equal(ep.holders, 1, 'only the holder who both activated AND played');
assert(ep.totalWeight > 0);

const wrows = (await pool.query(`SELECT account_id, tier, weight FROM broker_weights WHERE epoch_id='${ep.epochId}'`)).rows;
assert.equal(wrows.length, 1, 'one weight row');
assert.equal(wrows[0].account_id, sal.aid, 'the player, not the top-tier idler');
assert.equal(Number(wrows[0].tier), 3);

const board = await epochBoard(pool);
assert.equal(board.delivered, false, 'the board states plainly that nothing was delivered');
assert(/gated/i.test(board.note), 'and names the gate');

// ── re-running an epoch is idempotent, not a second payout ──
const again = await allocateEpoch(pool, { endDay: today });
assert.equal(again.already, true, 'a re-run is a no-op');
assert.equal(Number((await pool.query('SELECT COUNT(*) c FROM broker_epochs')).rows[0].c), 1,
  'still exactly one epoch for that window');

// ── THE RECORDER LOGS COUNTS, NEVER GRANTED XP ──────────────────────────────────────────────────
// bumpMastery applies pathXpMult (1.5x home / 0.6x rival) to `xp`. If the recorder wrote `xp`, a
// player's declared PATH would silently change their share of a stock distribution. It writes 1.
assert.notEqual(MASTERY.XP.crime, 1,
  'precondition: the base crime award is not 1, so a COUNT is distinguishable from XP');
const before = await gainsFor(pool, sal.aid, today, today);
let pulled = 0;
for (let i = 0; i < 30 && pulled === 0; i++) {
  await pool.query(`UPDATE characters SET nerve=100 WHERE id='${sal.id}'`);
  if ((await call('POST', '/v1/crimes/pick', { token: sal.token })).body.success) pulled++;
}
assert.equal(pulled, 1, 'a job landed, so the recorder ran');
const after = await gainsFor(pool, sal.aid, today, today);
assert.equal((after.crime || 0) - (before.crime || 0), 1,
  'ONE landed job records exactly ONE count — not its XP award, not its path multiple');

// ...and the SAME assertion on the INSERT path. The recorder is UPDATE-then-INSERT, and the check
// above only ever exercises the UPDATE half because `crime` was pre-seeded for Sal. A mutation to
// the INSERT literal survived a green run until this was added — the first action of any account's
// day takes that branch, so leaving it uncovered meant the wall was half-tested and read as whole.
assert.equal(Object.keys(await gainsFor(pool, nico.aid, today, today)).length, 0,
  'precondition: Nico has no activity row at all, so his first job must INSERT');
let nicoPulled = 0;
for (let i = 0; i < 30 && nicoPulled === 0; i++) {
  await pool.query(`UPDATE characters SET nerve=100 WHERE id='${nico.id}'`);
  if ((await call('POST', '/v1/crimes/pick', { token: nico.token })).body.success) nicoPulled++;
}
assert.equal(nicoPulled, 1, 'a job landed for Nico too');
assert.equal((await gainsFor(pool, nico.aid, today, today)).crime, 1,
  'the INSERT path records ONE as well — a fresh day cannot start the count at an XP award');

// ── gates ──
r = await call('POST', '/v1/brokers/activate', { token: nico.token, body: { tier: 1 } });
assert.equal(r.code, 400, 'a mid-window downgrade is refused');
assert.equal(r.body.error, 'downgrade');
r = await call('POST', '/v1/brokers/activate', { token: sal.token, body: { tier: 99 } });
assert.equal(r.code, 400);
assert.equal(r.body.error, 'bad_tier');

// ── §10.4 ──
const inv = await runLedgerInvariants(pool, { alert: false });
const vocab = inv.checks.find((c) => /vocabulary/i.test(c.name));
assert(vocab.ok, `brokers:activate must be a recognised reason: ${JSON.stringify(vocab)}`);

await app.close();
console.log('✅ brokers test passed — the weight is tier x play, activation alone buys NOTHING (the '
  + 'wealth-weighted case this design deliberately does not pay), the burn recycles to the desk, the '
  + 'allocator publishes and delivers nothing, and the recorder logs COUNTS so no progression '
  + 'multiplier can ever reach the distribution key.');

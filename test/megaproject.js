// THE MEGAPROJECT test (the 39th suite) — the collective monument (founder pick #1, design
// omerta-megaproject-design.md). Covers: the announced-but-unstarted board, the three
// contribution rails as PURE SINKS (cash burn ledgered `megaproject:cash`, goods deleted from
// the trunk at base value, $OMR burned `megaproject:omr` through spendOmr at the fixed rate),
// the gates (floors / jailed / bad good / empty trunk), the clamp (nobody pays into a finished
// wall), the plaque (account-level, tiers, your share), COMPLETION (the crossing brick finishes
// it in-txn — skyline + architect notify + the next monument announced), death survival of the
// plaque, and §10.4 (both vocabularies closed; the per-character cash check + $OMR conservation
// reconcile the burns — the only drift is the unledgered SQL grants).
// pg-mem, zero infra. SQL-granting cash/$OMR is an unledgered mint (the landmarks precedent).
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { MEGAPROJECT } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const ch = await meOf(token);
  return { token, id: ch.id, aid: (await pool.query(`SELECT account_id a FROM characters WHERE id='${ch.id}'`)).rows[0].a };
};
const seedCash = (id, n) => pool.query(`UPDATE characters SET cash = cash + ${n} WHERE id='${id}'`);
const acctOmr = (id, n) => pool.query(`UPDATE account_persistent SET omr = omr + ${n} WHERE account_id='${id}'`);

const mon0 = MEGAPROJECT.MONUMENTS[0];
const don = await mk('Enzo the Mason');
const widow = await mk('The Widow Bellamy');
await seedCash(don.id, 40_000_000);
await seedCash(widow.id, 40_000_000);
await acctOmr(don.aid, 2000);

// ── the board before the first brick: announced from the catalog, unstarted ──
let r = await call('GET', '/v1/megaproject', { token: don.token });
assert.equal(r.code, 200, 'the board reads');
assert.equal(r.body.current.monument, mon0.id, 'the first monument is announced');
assert.equal(r.body.current.started, false, 'not a brick laid yet');
assert.equal(r.body.current.target, mon0.target, 'the catalog target');
assert.deepEqual(r.body.skyline, [], 'the skyline is empty');

// ── gates: floors + bad good + empty trunk ──
assert.equal((await call('POST', '/v1/megaproject/cash', { token: don.token, body: { amount: 10 } })).body.error, 'amount', 'the cash floor holds');
assert.equal((await call('POST', '/v1/megaproject/omr', { token: don.token, body: { amount: 0.5 } })).body.error, 'amount', 'the $OMR floor holds');
assert.equal((await call('POST', '/v1/megaproject/goods', { token: don.token, body: { goodId: 'nothing', qty: 1 } })).body.error, 'bad_good', 'no such good');
assert.equal((await call('POST', '/v1/megaproject/goods', { token: don.token, body: { goodId: 'gin', qty: 1 } })).body.error, 'none', 'an empty trunk gives nothing');
assert.equal((await call('POST', '/v1/megaproject/goods', { token: don.token, body: { goodId: 'gin', qty: 0 } })).body.error, 'amount', '(red-team A2) qty 0 is rejected, never coerced to a silent 1-unit donation');

// ── the CASH rail: a ledgered burn, progress moves, the plaque records the account ──
r = await call('POST', '/v1/megaproject/cash', { token: don.token, body: { amount: 1_000_000 } });
assert.equal(r.code, 200, 'a cash brick lands');
assert.equal(r.body.credited, 1_000_000, 'credited 1:1');
assert.equal(r.body.progress, 1_000_000, 'the wall rises');
const cashRow = (await pool.query(
  `SELECT amount FROM transactions WHERE character_id='${don.id}' AND reason='megaproject:cash'`)).rows;
assert.equal(cashRow.length, 1, 'one ledgered cash burn');
assert.equal(Number(cashRow[0].amount), -1_000_000, 'the burn is exact');

// ── the GOODS rail: trunk decremented, credited at CATALOG BASE (location-free) ──
r = await call('POST', '/v1/goods/buy', { token: don.token, body: { goodId: 'gin', qty: 10 } });
assert.equal(r.code, 200, 'stocked the trunk');
r = await call('POST', '/v1/megaproject/goods', { token: don.token, body: { goodId: 'gin', qty: 10 } });
assert.equal(r.code, 200, 'a goods brick lands');
assert.equal(r.body.qty, 10, 'all ten donated');
assert.equal(r.body.credited, 10 * 120, 'credited at the gin base ($120), never the district price');
const trunk = (await pool.query(`SELECT qty FROM character_cargo WHERE character_id='${don.id}' AND good_id='gin'`)).rows;
assert.equal(trunk.length, 0, 'the trunk emptied — a pure ownership sink, no ledger row');

// ── the $OMR rail: burned through spendOmr at the FIXED rate ──
r = await call('POST', '/v1/megaproject/omr', { token: don.token, body: { amount: 100 } });
assert.equal(r.code, 200, 'an $OMR brick lands');
assert.equal(r.body.omr, 100, 'the full hundred burned');
assert.equal(r.body.credited, 100 * MEGAPROJECT.OMR_RATE, 'credited at the fixed rate');
const omrRow = (await pool.query(
  `SELECT amount FROM transactions WHERE currency='omr' AND reason='megaproject:omr'`)).rows;
assert.equal(omrRow.length, 1, 'one ledgered $OMR burn');
assert.equal(Number(omrRow[0].amount), -100, 'the burn is exact');

// ── jailed gate ──
await pool.query(`UPDATE characters SET jail_until = now() + interval '10 minutes' WHERE id='${widow.id}'`);
assert.equal((await call('POST', '/v1/megaproject/cash', { token: widow.token, body: { amount: 1000 } })).body.error, 'jailed', 'no writing checks from lockup');
await pool.query(`UPDATE characters SET jail_until = NULL WHERE id='${widow.id}'`);

// ── the plaque: both names, ranked, your share; account-level ──
await call('POST', '/v1/megaproject/cash', { token: widow.token, body: { amount: 250_000 } });
r = await call('GET', '/v1/megaproject', { token: widow.token });
const cur = r.body.current;
assert.equal(cur.started, true, 'the build is live');
assert.equal(cur.plaque[0].name, 'Enzo the Mason', 'the top brick leads the plaque');
assert.equal(cur.plaque[0].tier, 'The Architect', 'rank 1 is the Architect');
assert.equal(cur.plaque[1].name, 'The Widow Bellamy', 'the second name stands');
assert(cur.you && cur.you.rank === 2 && cur.you.contributed === 250_000, 'your share is yours');

// ── the CLAMP + COMPLETION: the crossing brick finishes it, never overpays ──
const remaining = cur.remaining;
r = await call('POST', '/v1/megaproject/cash', { token: widow.token, body: { amount: remaining + 5_000_000 } });
assert.equal(r.code, 200, 'the final brick lands');
assert.equal(r.body.credited, remaining, 'clamped to what the wall needed — nobody pays into a finished wall');
assert.equal(r.body.completed, true, 'the monument STANDS');
const widowCash = Number((await pool.query(`SELECT cash FROM characters WHERE id='${widow.id}'`)).rows[0].cash);
assert(widowCash > 5_000_000, 'the over-ask was never taken');
// the architect (top contributor — the widow's giant final brick outbuilt the don) was notified
const note = (await pool.query(
  `SELECT payload FROM notifications WHERE character_id='${widow.id}' AND type='megaproject_architect'`)).rows;
assert.equal(note.length, 1, 'the Architect (the top contributor) got the word');
assert.equal(JSON.parse(note[0].payload).monument, mon0.name, 'named the monument');

// ── the skyline + the NEXT monument announced ──
r = await call('GET', '/v1/megaproject', { token: don.token });
assert.equal(r.body.skyline.length, 1, 'one monument on the skyline');
assert.equal(r.body.skyline[0].architect, 'The Widow Bellamy', 'the Architect is on the skyline forever');
assert.equal(r.body.skyline[0].plaque.length, 2, '(red-team C4) the full plaque survives completion');
assert.equal(r.body.skyline[0].plaque[1].name, 'Enzo the Mason', 'the Foreman keeps his name forever');
assert.equal(r.body.current.monument, MEGAPROJECT.MONUMENTS[1].id, 'the next monument is announced');
assert.equal(r.body.current.started, false, 'fresh wall, no bricks');

// ── a completed project takes no more bricks (the new one does) ──
r = await call('POST', '/v1/megaproject/cash', { token: don.token, body: { amount: 5000 } });
assert.equal(r.code, 200, 'a brick lands on the NEW monument');
assert.equal(r.body.monument, MEGAPROJECT.MONUMENTS[1].name, 'it went into the new wall');

// ── DEATH SURVIVAL: the plaque is account-level — the heir keeps the dynasty's glory ──
await app.inject({ method: 'POST', url: '/v1/mod/kill', headers: { 'x-mod-key': 'test-mod-key' }, payload: { characterId: don.id } });
const rows = (await pool.query(
  `SELECT contributed FROM megaproject_contributions WHERE account_id='${don.aid}'`)).rows;
assert(rows.length >= 1, 'the contributions survive the estate');
r = await call('GET', '/v1/megaproject', { token: don.token });
assert.equal(r.body.skyline[0].architect.length > 0, true, 'the skyline still names the line');

// ── §10.4: vocabulary closed + both burns reconcile (drift == the SQL grants only) ──
const inv = await runLedgerInvariants(pool);
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `megaproject: rides both vocabularies (${JSON.stringify(vocab.unknown || [])})`);
const omrCheck = inv.checks.find((c) => c.name === '$OMR conservation');
assert.equal(omrCheck.drift, 2000, `$OMR drift == the SQL grant only (the megaproject:omr burn reconciles): ${omrCheck.drift}`);
const cashCheck = inv.checks.find((c) => c.name === 'character cash');
assert.equal(cashCheck.drift, 80_000_000, `cash drift == the two SQL seeds only (every megaproject:cash burn reconciles): ${cashCheck.drift}`);

await app.close();
console.log('✅ THE MEGAPROJECT test passed — the announced board (catalog monument, unstarted), the three contribution rails as pure sinks (ledgered megaproject:cash burn · goods deleted from the trunk at catalog base · megaproject:omr burned at the fixed rate), the gates (floors/jailed/bad-good/empty-trunk), the plaque (account-level, Architect tier, your share), the CLAMP + COMPLETION (the crossing brick finishes it exactly — no overpay — skyline WITH the kept plaque + Architect notify + the next monument announced), a brick landing on the new wall, DEATH SURVIVAL (the dynasty keeps the plaque), and §10.4 (vocabularies closed, $OMR drift == the SQL grant only)');

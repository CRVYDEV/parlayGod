// NAMED LANDMARKS test (the 27th suite) — one dedicable plaque per district, held by the highest $OMR
// flex. Covers: the board (open districts), the dedicate (min floor + ledgered vanity:landmark BURN),
// the takeover (must strictly beat the current flex; the plaque + name change), the bad-district +
// too-low gates, the dynasty name borne (survives death), and §10.4 (vanity:landmark rides vanity:% —
// the only $OMR drift is the unledgered SQL grant, proving the dedication reconciles as a burn).
// pg-mem, zero infra. SQL-granting $OMR is an unledgered mint (the estate/portfolio precedent).
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { LANDMARKS } from '../src/rules.js';
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
const acctOmr = (id, n) => pool.query(`UPDATE account_persistent SET omr = omr + ${n} WHERE account_id='${id}'`);
let grantDrift = 0;

const don = await mk('Vito Corleone');
const rival = await mk('Sollozzo');
await acctOmr(don.aid, 5000); grantDrift += 5000;
await acctOmr(rival.aid, 5000); grantDrift += 5000;

// ── the board: every district open, the plaque names present ──
let r = await call('GET', '/v1/landmarks');
assert.equal(r.code, 200, 'the landmark map is public');
assert.equal(r.body.landmarks.length, Object.keys(LANDMARKS.PLACES).length, 'a plaque per district');
const neon = r.body.landmarks.find((l) => l.district === 'neon');
assert.equal(neon.place, LANDMARKS.PLACES.neon, 'the Neon Arch is named');
assert.equal(neon.holder, null, 'open — nobody dedicated it yet');
assert.equal(neon.nextMin, LANDMARKS.MIN_DEDICATE, 'first dedication is the floor');

// ── gates: bad district, below the floor ──
assert.equal((await call('POST', '/v1/landmarks/nowhere', { token: don.token, body: { amount: 100 } })).body.error, 'district', 'no landmark there');
assert.equal((await call('POST', '/v1/landmarks/neon', { token: don.token, body: { amount: LANDMARKS.MIN_DEDICATE - 1 } })).body.error, 'amount', 'below the floor is refused');

// ── name your dynasty, then dedicate — a ledgered vanity:landmark BURN ──
await call('POST', '/v1/dynasty/name', { token: don.token, body: { name: 'The Corleones' } }); // 5 $OMR
const omrPre = (await meOf(don.token)).omr;
r = await call('POST', '/v1/landmarks/neon', { token: don.token, body: { amount: 100 } });
assert.equal(r.code, 200, 'dedicated the Neon Arch');
assert.equal(r.body.name, 'The Corleones', 'the dynasty name is borne on the plaque');
assert.equal((await meOf(don.token)).omr, omrPre - 100, 'the flex burned exactly 100 $OMR');
r = await call('GET', '/v1/landmarks');
const neon2 = r.body.landmarks.find((l) => l.district === 'neon');
assert.equal(neon2.holder, 'The Corleones', 'the plaque bears the family');
assert.equal(neon2.amount, 100, 'and the flex amount');
assert.equal(neon2.nextMin, 101, 'a takeover must beat it');

// ── takeover: a bigger flex takes the plaque; a too-low flex is refused ──
assert.equal((await call('POST', '/v1/landmarks/neon', { token: rival.token, body: { amount: 100 } })).body.error, 'outbid', 'matching the flex is not beating it');
r = await call('POST', '/v1/landmarks/neon', { token: rival.token, body: { amount: 250 } });
assert.equal(r.code, 200, 'the rival takes the plaque with a bigger flex');
r = await call('GET', '/v1/landmarks');
assert.equal(r.body.landmarks.find((l) => l.district === 'neon').holder, 'Sollozzo', 'the plaque changed hands (no dynasty name → the street)');
assert.equal(r.body.landmarks.find((l) => l.district === 'neon').amount, 250, 'to the bigger flex');
// the ousted don is not refunded (a flex, not escrow) — he still spent his 100
assert.equal((await meOf(don.token)).omr, omrPre - 100, 'the ousted holder gets no refund (a burn, not escrow)');

// ── DEATH SURVIVAL: the plaque bears the account-level dynasty, so it stands after the holder dies ──
await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: rival.id }, headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal((await call('GET', '/v1/landmarks')).body.landmarks.find((l) => l.district === 'neon').holder, 'Sollozzo', 'the monument outlives the man');

// ── §10.4: vanity:landmark rides vanity:% — the only $OMR drift is the unledgered SQL grant ──
const inv = await runLedgerInvariants(pool);
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `vanity:landmark rides the omr vocabulary (${JSON.stringify(vocab.unknown || [])})`);
const omrCheck = inv.checks.find((c) => c.name === '$OMR conservation');
assert.equal(omrCheck.drift, grantDrift, `the only $OMR drift is the test grants (${grantDrift}) — dedications reconcile as burns`);

console.log('✅ Named landmarks test passed — the public map (a plaque per district), the dedicate (min floor + ledgered vanity:landmark burn), the takeover (must strictly beat the current flex; plaque + name change; no refund to the ousted), bad-district + too-low gates, the dynasty name borne, DEATH SURVIVAL (the monument outlives the man), and §10.4 (vanity:landmark rides vanity:% — drift == the test grants only)');
await app.close();

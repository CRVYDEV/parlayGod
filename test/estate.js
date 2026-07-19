// THE ESTATE ("the compound") test — the deep personal $OMR sink. Covers: the board + tier ladder,
// sequential tier upgrades (the seal pattern), feature tier-gates + no-double-buy, naming (needs a
// place first), trophies computed from REAL holdings, DEATH SURVIVAL (the heir inherits the compound),
// spends == ledgered estate:* burns, and the §10.4 vocabulary + $OMR conservation. pg-mem, zero infra.
// SQL-granting $OMR is an unledgered mint (the skills/portfolio precedent), so the $OMR-conservation
// DRIFT stays exactly the grant — proving estate:* reconciles as a burn.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { ESTATE, estateTierOf } from '../src/rules.js';
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
const acctOmr = (id, n) => pool.query(
  `UPDATE account_persistent SET omr = omr + ${n} WHERE account_id = (SELECT account_id FROM characters WHERE id='${id}')`);
let grantDrift = 0;

const don = await mk('Don Draper');
await acctOmr(don.id, 5000); grantDrift += 5000;

// ── the board: no estate yet, tier 0, the ladder + catalog present ──
let r = await call('GET', '/v1/estate', { token: don.token });
assert.equal(r.code, 200, 'the estate board is readable');
assert.equal(r.body.tier, 0, 'a nobody has no compound');
assert.equal(r.body.nextTier.tier, 1, 'the Safe House is the first rung');
assert.equal(r.body.tiers.length, ESTATE.TIERS.length, 'the full tier ladder');
assert.equal(r.body.features.length, ESTATE.FEATURES.length, 'the full feature catalog');
assert(r.body.features.every((f) => !f.owned), 'nothing furnished yet');

// naming needs a place first
assert.equal((await call('POST', '/v1/estate/name', { token: don.token, body: { name: 'The Havens' } })).body.error, 'no_estate', "can't name a place you don't own");

// ── sequential tier upgrades: exact $OMR burns, ledgered estate:tier ──
r = await call('POST', '/v1/estate/upgrade', { token: don.token });
assert.equal(r.code, 200, 'bought the Safe House');
assert.equal(r.body.tier, 1, 'tier 1');
let omrAfter1 = (await meOf(don.token)).omr;
assert.equal(omrAfter1, 5000 - estateTierOf(1).omr, 'the burn debited exactly the tier price');
r = await call('POST', '/v1/estate/upgrade', { token: don.token });
assert.equal(r.body.tier, 2, 'tier 2 — you buy the ladder in order');

// ── features: tier-gated, one-time ──
assert.equal((await call('POST', '/v1/estate/feature/chapel', { token: don.token })).body.error, 'tier', 'the Chapel needs a bigger place (tier 4)');
assert.equal((await call('POST', '/v1/estate/feature/nope', { token: don.token })).body.error, 'feature', 'no such wing');
r = await call('POST', '/v1/estate/feature/wine_cellar', { token: don.token });
assert.equal(r.code, 200, 'the Wine Cellar is in reach at tier 2');
assert.equal((await call('POST', '/v1/estate/feature/wine_cellar', { token: don.token })).body.error, 'owned', "can't build the same wing twice");

// ── naming (now that there's a place) ──
r = await call('POST', '/v1/estate/name', { token: don.token, body: { name: 'The Havens' } });
assert.equal(r.code, 200, 'named the compound');
assert.equal(r.body.name, 'The Havens', 'the name took');

// ── the board reflects it: tier, name, owned feature, spent, trophies from real holdings ──
await pool.query(`INSERT INTO cars (id, character_id, model_id, trim_id, dmg) VALUES ('carX','${don.id}','muscle','stock',0)`);
r = await call('GET', '/v1/estate', { token: don.token });
assert.equal(r.body.tier, 2, 'the board shows tier 2');
assert.equal(r.body.name, 'The Havens', 'and the name');
assert(r.body.features.find((f) => f.id === 'wine_cellar').owned, 'the Wine Cellar reads owned');
assert.equal(r.body.spent, estateTierOf(1).omr + estateTierOf(2).omr + ESTATE.FEATURES.find((f) => f.id === 'wine_cellar').omr + ESTATE.NAME_OMR, 'estate value = every $OMR sunk');
assert.equal(r.body.trophies.fleet, 1, 'trophies count the real fleet');
// the character view carries the summary
assert.equal((await meOf(don.token)).estate.tierName, 'Row House', 'the sheet shows the compound');

// ── spends == ledgered estate:* burns ──
const burned = -Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason LIKE 'estate:%'")).rows[0].s);
assert.equal(burned, r.body.spent, 'every dollar spent is a ledgered estate:* burn');

// ── DEATH SURVIVAL: the compound is account-level, so the heir inherits it ──
const kill = await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: don.id },
  headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal(kill.statusCode, 200, 'the don is retired');
const heir = await meOf(don.token);
assert.notEqual(heir.id, don.id, 'a new street');
assert.equal(heir.estate.tier, 2, 'the heir inherits the compound — it survived the death');
assert.equal((await call('GET', '/v1/estate', { token: don.token })).body.name, 'The Havens', 'name and all');

// ── §10.4: estate:* is a recognized burn; the ONLY drift is the unledgered SQL grant ──
const inv = await runLedgerInvariants(pool);
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `estate: rides the omr vocabulary (${JSON.stringify(vocab.unknown || [])})`);
const omrCheck = inv.checks.find((c) => c.name === '$OMR conservation');
assert.equal(omrCheck.drift, grantDrift, `the only $OMR drift is the test grant (${grantDrift}) — estate:* reconciles as a burn`);

console.log('✅ Estate ("the compound") test passed — the board + tier ladder + feature catalog, sequential tier upgrades (exact ledgered estate:tier burns), feature tier-gates + no-double-buy, naming (needs a place first), trophies from real holdings, the sheet summary, estate value = every $OMR sunk, DEATH SURVIVAL (the heir inherits the compound), spends == ledgered estate:* burns, and §10.4 (estate: vocabulary + $OMR conservation — drift == the test grant only)');
await app.close();

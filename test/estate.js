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

// ══ STEP TWO — THE STAFF (recurring $OMR payroll) + THE GALA + the leaderboard ══
const aid = (await pool.query(`SELECT account_id a FROM characters WHERE id='${heir.id}'`)).rows[0].a;
const staffOf = (id) => ESTATE.STAFF.find((s) => s.id === id);

// the board carries the household + gala surfaces
r = await call('GET', '/v1/estate', { token: don.token });
assert.equal(r.body.household.catalog.length, ESTATE.STAFF.length, 'the full staff catalog');
assert.equal(r.body.household.staff.length, 0, 'nobody on the payroll yet');
assert.equal(r.body.gala.live, false, 'no party on');

// hire gates: unknown trade, tier lock (Capo needs tier 4; the heir holds a tier-2 Row House)
assert.equal((await call('POST', '/v1/estate/staff/nonsuch', { token: don.token })).body.error, 'staff', 'no such trade');
assert.equal((await call('POST', '/v1/estate/staff/house_capo', { token: don.token })).body.error, 'tier', 'the Capo needs a bigger house');

// hire the Groundskeeper + the Butler — exact ledgered estate:staff:hire burns
const omrBeforeHire = (await meOf(don.token)).omr;
assert.equal((await call('POST', '/v1/estate/staff/groundskeeper', { token: don.token })).code, 200, 'groundskeeper hired');
r = await call('POST', '/v1/estate/staff/butler', { token: don.token });
assert.equal(r.code, 200, 'butler hired');
assert.equal((await call('POST', '/v1/estate/staff/butler', { token: don.token })).body.error, 'hired', 'one of each');
assert.equal((await meOf(don.token)).omr, omrBeforeHire - staffOf('groundskeeper').hireOmr - staffOf('butler').hireOmr,
  'hire fees burned exactly');

// wages accrue lazily on the household clock — backdate 2 days, the book shows the arrears
await pool.query(`UPDATE estates SET staff_paid_at = now() - interval '2 days' WHERE account_id='${aid}'`);
r = await call('GET', '/v1/estate', { token: don.token });
const perDay = staffOf('groundskeeper').wageOmrDay + staffOf('butler').wageOmrDay;
assert.equal(r.body.household.wagePerDay, perDay, 'the daily rate sums the household');
assert(Math.abs(r.body.household.owed - perDay * 2) < 0.02, `two days owed (${r.body.household.owed})`);
assert(r.body.household.walkInSeconds > 0 && r.body.household.walkInSeconds <= 5 * 86400 + 5, 'the walk clock runs');
assert.equal((await call('POST', '/v1/estate/staff/sommelier', { token: don.token })).body.error, 'tier', 'sommelier needs tier 3 anyway');
assert.equal((await call('POST', '/v1/estate/gala', { token: don.token })).body.error, 'wages', 'no party on a delinquent book');

// pay the household — an exact ledgered estate:staff burn, the clock resets
const omrBeforeWages = (await meOf(don.token)).omr;
const owedNow = r.body.household.owed;
r = await call('POST', '/v1/estate/wages', { token: don.token });
assert.equal(r.code, 200, 'the pad is paid');
assert(Math.abs(r.body.paid - owedNow) < 0.02, 'paid what was owed');
assert(Math.abs((await meOf(don.token)).omr - (omrBeforeWages - r.body.paid)) < 1e-6, 'the wage burn debited exactly');
assert.equal((await call('GET', '/v1/estate', { token: don.token })).body.household.owed, 0, 'the book is square');

// THE WALK: stiff them past the window — the whole household leaves, arrears die with the insult
await pool.query(`UPDATE estates SET staff_paid_at = now() - interval '8 days' WHERE account_id='${aid}'`);
r = await call('GET', '/v1/estate', { token: don.token });
assert.equal(r.body.household.walked, true, 'the board warns the house has walked');
assert.equal((await call('POST', '/v1/estate/wages', { token: don.token })).body.error, 'walked', 'too late to pay — they left');
r = await call('GET', '/v1/estate', { token: don.token });
assert.equal(r.body.household.staff.length, 0, 'the house is empty');
assert.equal(r.body.household.owed, 0, 'and the debt died with the insult');

// THE GALA: rehire the Butler, throw the party (tier-scaled burn), the city attends
assert.equal((await call('POST', '/v1/estate/gala', { token: don.token })).body.error, 'butler', 'no gala without the Butler');
await call('POST', '/v1/estate/staff/butler', { token: don.token });
const omrBeforeGala = (await meOf(don.token)).omr;
r = await call('POST', '/v1/estate/gala', { token: don.token });
assert.equal(r.code, 200, 'the doors open');
assert.equal(r.body.cost, ESTATE.GALA_OMR * 2, 'the burn scales with the tier');
assert.equal((await meOf(don.token)).omr, omrBeforeGala - r.body.cost, 'ledgered exactly');
assert.equal((await call('POST', '/v1/estate/gala', { token: don.token })).body.error, 'already', 'one party at a time');
const guest = await mk('Party Pete');
assert.equal((await call('POST', '/v1/estate/gala/attend', { token: don.token, body: { hostId: heir.id } })).body.error, 'self',
  'the host is not a guest');
r = await call('POST', '/v1/estate/gala/attend', { token: guest.token, body: { hostId: heir.id } });
assert.equal(r.code, 200, 'Pete makes his entrance');
assert.equal(r.body.guests, 1, 'first on the list');
assert.equal((await call('POST', '/v1/estate/gala/attend', { token: guest.token, body: { hostId: heir.id } })).body.error,
  'attended', 'one entrance per party');
r = await call('GET', '/v1/estate', { token: don.token });
assert.deepEqual(r.body.gala.guests, ['Party Pete'], 'the guest list shows the name');
assert.equal(r.body.gala.hosted, 1, 'galas hosted banked');
assert.equal(r.body.gala.best, 1, 'best turnout banked');

// the leaderboard: the great houses by $OMR sunk, the living steward named
r = await call('GET', '/v1/leaderboard/estates', { token: don.token });
assert.equal(r.body.houses[0].estate, 'The Havens', 'the Havens tops the board');
assert.equal(r.body.houses[0].steward, heir.name, 'with the living steward');
assert.equal(r.body.houses[0].staff, 1, 'and the household counted');
// spends == ledgered estate:* burns (now including hires + wages + the gala)
const burned2 = -Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason LIKE 'estate:%'")).rows[0].s);
assert(Math.abs(burned2 - (await call('GET', '/v1/estate', { token: don.token })).body.spent) < 0.02,
  'every dollar sunk is a ledgered estate:* burn — step two included');

// ── §10.4: estate:* is a recognized burn; the ONLY drift is the unledgered SQL grant ──
const inv = await runLedgerInvariants(pool);
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `estate: rides the omr vocabulary (${JSON.stringify(vocab.unknown || [])})`);
const omrCheck = inv.checks.find((c) => c.name === '$OMR conservation');
assert.equal(omrCheck.drift, grantDrift, `the only $OMR drift is the test grant (${grantDrift}) — estate:* reconciles as a burn`);

console.log('✅ Estate ("the compound") test passed — the board + tier ladder + feature catalog, sequential tier upgrades (exact ledgered estate:tier burns), feature tier-gates + no-double-buy, naming (needs a place first), trophies from real holdings, the sheet summary, estate value = every $OMR sunk, DEATH SURVIVAL (the heir inherits the compound), spends == ledgered estate:* burns, and §10.4 (estate: vocabulary + $OMR conservation — drift == the test grant only)');
await app.close();

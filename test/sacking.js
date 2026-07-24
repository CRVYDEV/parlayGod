// THE SACKING (L3a) test — a player fire-kill lets the killer SEIZE one of the victim's business fronts
// (the endgame passive-income engine) instead of it dying with the street. The review's keystone lever:
// the passive empire becomes PvP RISK CAPITAL and the kill gets a prize worth the ammo.
//
// Covers: a seizable front (killer meets the level gate + has an empty kind slot) is TRANSFERRED to the
// killer and SURVIVES the estate wipe; the rest of the empire dies with the street; the level gate + the
// occupied-slot gate both fall through to "dies as normal, no seize"; the SACK_ON_KILL toggle; and §10.4
// stays exact (a front is an ownership object, not a currency — no ledger row, no drift).
//
// A `businesses` row is not a §10.4 currency (no business-conservation check), so SQL-seeding a front is
// legitimate (the gear/racer/stash-seed precedent). Cash paid to build one WOULD be §10.4, so we never
// buy — we seed the row and the victim's respect, then drive a real fire-kill.
process.env.SEARCH_MS = '0';
process.env.SHOOT_CD_MS = '0';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { BUSINESSES } from '../src/rules.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (token) => (await call('GET', '/v1/me', { token })).body.character;
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);
const mk = async (name) => { const { body: { token } } = await call('POST', '/v1/auth/guest'); await call('POST', '/v1/character', { token, body: { name } }); return { token, id: (await meOf(token)).id }; };
let _bid = 0;
const seedFront = (charId, kind, tier) => pool.query(
  `INSERT INTO businesses (id, character_id, kind, tier, last_collect_at, upkeep_at, scrutiny_at, launder_at)
   VALUES ('biz_${++_bid}', '${charId}', '${kind}', ${tier}, now(), now(), now(), now())`);
const frontsOf = async (charId) => (await pool.query(`SELECT kind, tier FROM businesses WHERE character_id='${charId}'`)).rows;

// a bankrolled, high-level killer; a level-11 victim with an empire
const don = await mk('Don Sacker');
const mark = await mk('Marco the Mogul');
await seedCh(don.id, "respect=20000, cash=500000, cb=20, muscle=500, speed=500, energy=200, ammo=8000, nerve=50, jail_until=NULL, shoot_cd_until=NULL, hosp_until=NULL, loc='docks'");
assert.equal((await call('POST', '/v1/armory/gun/lastresort/buy', { token: don.token })).code, 200, 'the killer arms up');
const whack = async (tid, rounds = 8000) => {
  await seedCh(don.id, "energy=200, ammo=8000, nerve=50, jail_until=NULL, shoot_cd_until=NULL, hosp_until=NULL, loc='docks'");
  await seedCh(tid, "hosp_until=NULL, jail_until=NULL, safe_until=NULL, loc='docks', respect=400");
  await call('POST', `/v1/streets/${tid}/search`, { token: don.token });
  return (await call('POST', `/v1/streets/${tid}/fire`, { token: don.token, body: { rounds } })).body;
};

// §10.4 note: the kill machinery is driven with SQL-seeded ammo/respect (like test/social.js), so the
// FULL sweep carries a constant phantom-ammo drift from the seed. The SACKING is a pure `businesses`
// ownership move — it can touch NO §10.4 currency — so we prove neutrality by a DRIFT DELTA on the stable
// buckets (cash/$OMR/cars/cb) across the sacking-kill: every flow the kill DOES move (loot, the estate
// burn) is ledgered, so those drifts must be UNCHANGED, and the seize adds nothing.
const driftMap = (inv) => Object.fromEntries(inv.checks.map((c) => [c.name, c.drift]));
const stable = ['character cash', '$OMR conservation', 'car conservation', 'cb conservation'];

// ── the victim runs a small empire: a laundromat + a restaurant ──
await seedFront(mark.id, 'laundromat', 3);   // the killer will SEIZE the more valuable of the two
await seedFront(mark.id, 'restaurant', 2);
assert.equal((await frontsOf(mark.id)).length, 2, 'the mark owns two fronts');

// the killer is level-capable (respect 20000 = well past casino lvl58) and owns NO fronts → can hold either.
// restaurant t2 ($52k/hr) > laundromat t3 ($65k/hr)? check the catalog to know which is "most valuable".
const lVal = BUSINESSES.find((b) => b.kind === 'laundromat').tiers[2].incomePerHr;   // t3
const rVal = BUSINESSES.find((b) => b.kind === 'restaurant').tiers[1].incomePerHr;   // t2
const richerKind = lVal >= rVal ? 'laundromat' : 'restaurant';
const richerTier = lVal >= rVal ? 3 : 2;

const d0 = driftMap(await runLedgerInvariants(pool));
const k = await whack(mark.id);
assert.ok(k.kill, 'the mogul is dead');
assert.ok(k.empireLoot, 'the kill sacked a front');
assert.equal(k.empireLoot.kind, richerKind, 'the killer seized the MOST VALUABLE holdable front');
assert.equal(k.empireLoot.tier, richerTier, 'at its current tier');

// the seized front SURVIVED the estate wipe and now belongs to the KILLER; the rest died with the street
const donFronts = await frontsOf(don.id);
assert.equal(donFronts.length, 1, 'the killer inherited exactly one front (the prize)');
assert.equal(donFronts[0].kind, richerKind, 'and it is the one that was seized');
assert.equal((await pool.query(`SELECT count(*)::int n FROM businesses WHERE character_id='${mark.id}'`)).rows[0].n, 0,
  'the mark holds nothing — the seized front changed hands, the rest died with the street');
// the seized front reset its clocks (a seized op is never born pending-full)
assert.equal((await pool.query(`SELECT scrutiny FROM businesses WHERE character_id='${don.id}'`)).rows[0].scrutiny, 0, 'scrutiny reset on the handover');

// §10.4 — a front is an ownership object, not a currency: the sacking-kill moved zero NEW value on the
// stable buckets (every kill flow is a ledgered transfer/burn; the seize adds nothing)
const d1 = driftMap(await runLedgerInvariants(pool));
for (const k of stable) assert.equal(d1[k], d0[k], `the sacking is §10.4-neutral on ${k} (drift unchanged)`);

// ── the OCCUPIED-SLOT gate: the killer now runs a laundromat/restaurant; a fresh mark with the SAME kinds
//    can't be sacked of those (the killer has no empty slot) → dies as normal, no seize ──
const twin = await mk('Twin Tony');
await seedFront(twin.id, richerKind, 1);       // the same kind the killer already runs
const k2 = await whack(twin.id);
assert.ok(k2.kill, 'twin dead');
assert.ok(!k2.empireLoot, 'no seize — the killer already runs that kind (no empty slot)');
assert.equal((await frontsOf(don.id)).length, 1, "the killer's empire is unchanged");

// ── the LEVEL gate: a low-level killer cannot seize a high-tier front they could never run ──
const rookie = await mk('Rookie Rita');
await seedCh(rookie.id, "respect=100, cash=500000, cb=20, muscle=500, speed=500, energy=200, ammo=8000, nerve=50, loc='docks'"); // ~level 6, below casino lvl58
assert.equal((await call('POST', '/v1/armory/gun/lastresort/buy', { token: rookie.token })).code, 200, 'the rookie arms up');
const whale = await mk('Casino Carl');
await seedFront(whale.id, 'casino', 3);        // lvl58 to run
await seedCh(whale.id, "respect=400, hosp_until=NULL, jail_until=NULL, safe_until=NULL, loc='docks'");
await seedCh(rookie.id, "energy=200, ammo=8000, nerve=50, jail_until=NULL, shoot_cd_until=NULL, hosp_until=NULL, loc='docks'");
await call('POST', `/v1/streets/${whale.id}/search`, { token: rookie.token });
const d2 = driftMap(await runLedgerInvariants(pool));
const k3 = (await call('POST', `/v1/streets/${whale.id}/fire`, { token: rookie.token, body: { rounds: 8000 } })).body;
assert.ok(k3.kill, 'the whale is dead');
assert.ok(!k3.empireLoot, 'the rookie could not HOLD a casino front (level gate) — no seize');
assert.equal((await frontsOf(rookie.id)).length, 0, 'the rookie inherited nothing');
assert.equal((await pool.query(`SELECT count(*)::int n FROM businesses WHERE character_id='${whale.id}'`)).rows[0].n, 0, 'the casino still died with the street');

// the no-seize (level-gated) kill is §10.4-neutral on the stable buckets too
const d3 = driftMap(await runLedgerInvariants(pool));
for (const kk of stable) assert.equal(d3[kk], d2[kk], `no-seize kill is §10.4-neutral on ${kk}`);

console.log('ok - THE SACKING (L3a): fire-kill seizes the most-valuable holdable front (survives the wipe, rest die), occupied-slot + level gates fall through clean, §10.4-neutral');
await app.close();

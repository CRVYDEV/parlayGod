// SKILLS & SPECIALIZATIONS test — the board, point derivation from level, learn gates
// (bad/owned/prereq/points), every measurable touchpoint (laylow, heal, listing fee, trunk,
// crime stint, convoy speed, search clock), respec (ledgered $OMR burn, shared cooldown, points
// restored), the estate wipe, and the §10.4 vocabulary. pg-mem, zero infra.
process.env.MOD_KEY = 'test-mod-key';
process.env.CONVOY_MS = '600000';   // 10-min road (TEST-ONLY knob)
process.env.SEARCH_MS = '10000';    // 10s search (TEST-ONLY knob)
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { SKILLS, M4, COMMISSION } from '../src/rules.js';
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
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);

const vic = await mk('Versatile Vic');   // the build under test
const rob = await mk('Rookie Rob');      // no points
await seedCh(vic.id, "cash=500000, loc='docks'");

// ── the board + point derivation ──
let r = await call('GET', '/v1/skills', { token: vic.token });
assert.equal(r.code, 200, 'the tree is readable');
assert.equal(r.body.tree.length, 12, 'twelve skills — three branches × four tiers (incl. capstones)');
assert.equal(r.body.points.total, 0, 'level 1 has no points');
assert.equal((await call('POST', '/v1/skills/pack_mule', { token: rob.token })).body.error, 'points', 'no points, no school');
assert.equal((await call('POST', '/v1/skills/juggling', { token: vic.token })).body.error, 'bad_skill', 'no such skill');
// level 25 (respect 2304) → floor(25/4) = 6 points
await seedCh(vic.id, 'respect=2304');
r = await call('GET', '/v1/skills', { token: vic.token });
assert.equal(r.body.points.total, 6, 'level 25 carries six points');

// ── learn gates: prereq + budget; the view shows the build ──
assert.equal((await call('POST', '/v1/skills/broker', { token: vic.token })).body.error, 'prereq', 'tier 3 builds on tier 2');
assert.equal((await call('POST', '/v1/skills/fast_talker', { token: vic.token })).code, 200, 'operator T1 learned');
assert.equal((await call('POST', '/v1/skills/fast_talker', { token: vic.token })).body.error, 'owned', 'no double-learn');
assert.equal((await call('POST', '/v1/skills/fence_network', { token: vic.token })).code, 200, 'operator T2 (2pt)');
assert.equal((await call('POST', '/v1/skills/broker', { token: vic.token })).code, 200, 'operator T3 (3pt) — branch maxed');
r = await call('GET', '/v1/skills', { token: vic.token });
assert.equal(r.body.points.available, 0, 'six points all spent');
assert.equal((await call('POST', '/v1/skills/pack_mule', { token: vic.token })).body.error, 'points', 'the second branch waits for levels');
assert.deepEqual([...(await meOf(vic.token)).skills].sort(), ['broker', 'fast_talker', 'fence_network'], 'the view carries the build');

// ── FAST TALKER: laylow at ×0.8, the discounted number is what's ledgered ──
await seedCh(vic.id, 'heat=50, energy=200');
r = await call('POST', '/v1/kitchen/laylow', { token: vic.token });
assert.equal(r.code, 200, 'laid low');
assert.equal(r.body.cost, Math.floor(M4.LAYLOW_CASH * SKILLS.FX.LAYLOW_MULT), 'the operator talks the price down 20%');

// ── BROKER: market listing fees halved ──
assert.equal((await call('POST', '/v1/goods/buy', { token: vic.token, body: { goodId: 'gin', qty: 5 } })).code, 200, 'trunk stocked');
r = await call('POST', '/v1/market', { token: vic.token, body: { goodId: 'gin', qty: 5, price: 1000 } });
assert.equal(r.code, 200, 'listed');
const fullFee = Math.max(10, Math.ceil(5000 * 100 / 10000));
assert.equal(r.body.fee, Math.max(1, Math.floor(fullFee * SKILLS.FX.BROKER_FEE_MULT)), 'the broker pays half the fee');
await call('POST', `/v1/market/${r.body.id}/cancel`, { token: vic.token }); // reclaim (space math below)

// ── respec: ledgered $OMR burn, points restored, shared cooldown ──
await pool.query(`UPDATE account_persistent SET omr = omr + 20 WHERE account_id = (SELECT account_id FROM characters WHERE id='${vic.id}')`);
r = await call('POST', '/v1/skills/respec', { token: vic.token });
assert.equal(r.code, 200, 'the trainer wipes the slate');
assert.deepEqual(r.body.unlearned.sort(), ['broker', 'fast_talker', 'fence_network'], 'everything unlearned');
assert.equal(r.body.points.available, 6, 'all six points restored');
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='respec:skills'")).rows[0].s), -SKILLS.RESPEC_OMR, 'the burn is ledgered respec:skills');
assert.equal((await call('POST', '/v1/skills/respec', { token: vic.token })).body.error, 'none', 'nothing left to unlearn');
assert.equal((await call('POST', '/v1/skills/fast_talker', { token: vic.token })).code, 200, 'relearning is fine');
assert.equal((await call('POST', '/v1/skills/respec', { token: vic.token })).body.error, 'cooldown', 'the trainer sees you once a day (shared respec_at)');

// ── the WHEELMAN branch on a fresh street: trunk, stints, convoys ──
const wil = await mk('Wheelman Wil');
await seedCh(wil.id, "cash=500000, respect=2304, loc='docks'");
assert.equal((await call('POST', '/v1/skills/pack_mule', { token: wil.token })).code, 200, 'T1');
assert.equal((await call('POST', '/v1/skills/getaway', { token: wil.token })).code, 200, 'T2');
assert.equal((await call('POST', '/v1/skills/road_captain', { token: wil.token })).code, 200, 'T3');
// PACK MULE: the base 10-trunk takes 13
r = await call('POST', '/v1/goods/buy', { token: wil.token, body: { goodId: 'gin', qty: 13 } });
assert.equal(r.code, 200, 'thirteen units bought');
assert.equal((await meOf(wil.token)).cargo.gin, 13, 'the trunk holds base+3');
assert.equal((await meOf(wil.token)).cargoCap, 13, 'and the view says so');
// ROAD CAPTAIN: the 600s test road runs in 480
r = await call('POST', '/v1/convoy', { token: wil.token, body: { to: 'neon', goodId: 'gin', qty: 13 } });
assert.equal(r.code, 200, 'shipment opened');
r = await call('POST', '/v1/convoy/depart', { token: wil.token, body: { guards: 'none' } });
assert.equal(r.code, 200, 'on the road');
assert.equal(r.body.arrivesSeconds, Math.ceil(600000 * SKILLS.FX.CONVOY_MULT / 1000), 'the wheelman rides 20% faster');
// GETAWAY: bust until jailed — the stint lands at EXACTLY the book number × every multiplier
const { CRIMES, cityEventOf, dayOf, rankIdxOf, levelOf } = await import('../src/rules.js');
const c0 = CRIMES.find((c) => c.id === 'torch'); // base 0.4 — fails often; jail 22s
let jailedS = 0, tries = 0;
while (!jailedS && tries++ < 200) {
  await seedCh(wil.id, 'jail_until=NULL, energy=200, nerve=20');
  const cr = await call('POST', `/v1/crimes/${c0.id}`, { token: wil.token });
  if (cr.body.success === false && cr.body.jailSeconds > 0) jailedS = cr.body.jailSeconds;
}
assert(jailedS > 0, 'eventually busted');
const rIdxW = rankIdxOf(levelOf(2304));
const expectStint = Math.round(c0.jail * (cityEventOf(dayOf()).jailMult || 1) * (rIdxW >= 5 ? 0.8 : 1) * SKILLS.FX.JAIL_MULT);
assert.equal(jailedS, expectStint, `the getaway stint is exactly the book × multipliers × 0.8 (${jailedS}s = ${expectStint}s)`);

// ── EXECUTIONER: the hunter's search clock runs at ×0.8 (both sites agree via placedAt) ──
const ex = await mk('Executioner Eve');
await seedCh(ex.id, "cash=500000, respect=2304, loc='docks'");
for (const s of ['bruiser', 'doctors_friend', 'executioner'])
  assert.equal((await call('POST', `/v1/skills/${s}`, { token: ex.token })).code, 200, `${s} learned`);
await seedCh(rob.id, "loc='docks'");
r = await call('POST', `/v1/streets/${rob.id}/search`, { token: ex.token });
assert.equal(r.code, 200, 'the search is out');
const eta = new Date(r.body.placedAt).getTime() - Date.now();
assert(eta > 6500 && eta < 8500, `the 10s test search places in ~8s (saw ${Math.round(eta)}ms)`);
// THE DOC'S FRIEND: heal cost ×0.75 exactly
await seedCh(ex.id, 'health=40');
r = await call('POST', '/v1/heal', { token: ex.token });
assert.equal(r.code, 200, 'healed');
assert.equal(r.body.cost, Math.floor((100 - 40) * 15 * SKILLS.FX.DOC_MULT), 'the Doc charges the friend price');

// ── STEP TWO: TIER-4 CAPSTONES + ACTIVE ABILITIES + per-skill respec ──
// ex holds the maxed enforcer branch (bruiser/doctors_friend/executioner, 6 pts @ lvl 25).
r = await call('GET', '/v1/skills', { token: ex.token });
assert.equal(r.body.actives.length, 3, 'three capstone-unlocked active abilities on the board');
assert(r.body.actives.every((a) => !a.unlocked), 'no capstone learned yet → nothing unlocked');
// the capstone needs the tier-3 prereq AND a full ten points (level 40)
assert.equal((await call('POST', '/v1/skills/made_man', { token: ex.token })).body.error, 'points', 'MADE MAN waits for level 40 (ten points)');
await seedCh(ex.id, 'respect=6084');   // levelOf(6084)=40 → ten points; enforcer t1-3 already cost six
assert.equal((await call('POST', '/v1/skills/made_man', { token: ex.token })).code, 200, 'MADE MAN — the enforcer capstone (cost 4)');
r = await call('GET', '/v1/skills', { token: ex.token });
assert.equal(r.body.points.available, 0, 'all ten points spent on the maxed branch');
assert.equal(r.body.tree.find((s) => s.id === 'made_man').known, true, 'the capstone shows on the tree');
assert(r.body.actives.find((a) => a.id === 'adrenaline').unlocked, 'Adrenaline Rush is now unlocked');

// ACTIVE ABILITY: gates (bad id, locked, cooldown), then the energy burst to the level-scaled cap
assert.equal((await call('POST', '/v1/skills/active/nope', { token: ex.token })).body.error, 'bad_active', 'no such ability');
assert.equal((await call('POST', '/v1/skills/active/moxie', { token: ex.token })).body.error, 'locked', 'no kingpin → Moxie stays locked');
await seedCh(ex.id, 'energy=1');
r = await call('POST', '/v1/skills/active/adrenaline', { token: ex.token });
assert.equal(r.code, 200, 'adrenaline pumped');
assert.equal(r.body.energy, 50 + 2 * 40, 'energy refilled to the level-40 cap');
assert.equal((await meOf(ex.token)).energy, r.body.energy, 'and the sheet agrees');
assert.equal((await call('POST', '/v1/skills/active/adrenaline', { token: ex.token })).body.error, 'cooldown', 'one burst per shared cooldown');

// PER-SKILL RESPEC: leaf-first (the capstone blocks the tier beneath it), ledgered, shared daily cooldown
await pool.query(`UPDATE account_persistent SET omr = omr + 20 WHERE account_id = (SELECT account_id FROM characters WHERE id='${ex.id}')`);
assert.equal((await call('POST', '/v1/skills/respec/executioner', { token: ex.token })).body.error, 'dependent', 'unlearn the capstone above it first');
assert.equal((await call('POST', '/v1/skills/respec/getaway', { token: ex.token })).body.error, 'not_known', "you can't unlearn what you never learned");
r = await call('POST', '/v1/skills/respec/made_man', { token: ex.token });
assert.equal(r.code, 200, 'the capstone comes off for a single-skill $OMR burn');
assert(![...(await meOf(ex.token)).skills].includes('made_man'), 'made_man unlearned');
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='respec:skills'")).rows[0].s),
  -(SKILLS.RESPEC_OMR + SKILLS.RESPEC_ONE_OMR), 'the single-skill burn is ledgered respec:skills too (vic full + ex one)');
assert.equal((await call('POST', '/v1/skills/respec/executioner', { token: ex.token })).body.error, 'cooldown', 'per-skill respec shares the daily cooldown');

// ── the estate wipes the build; the §10.4 vocabulary stays closed ──
const kill = await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: wil.id },
  headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal(kill.statusCode, 200, 'the Commission retires wil');
const heir = await meOf(wil.token);
assert.equal((heir.skills || []).length, 0, 'the heir starts unschooled — skills died with the street');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM character_skills WHERE character_id='${wil.id}'`)).rows[0].n), 0, 'the rows are gone');
const vocab = (await runLedgerInvariants(pool)).checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `respec:skills rides the respec prefix (${JSON.stringify(vocab.unknown || [])})`);

console.log('✅ Skills test passed — twelve-skill tree (three branches × four tiers), level-derived points (6 @ lvl 25), learn gates (bad/owned/prereq/points), FAST TALKER laylow ×0.8 ledger-exact, BROKER half listing fees, PACK MULE trunk 13, ROAD CAPTAIN 480s road, GETAWAY stints ≤80%, EXECUTIONER ~8s search clock, DOC\'S FRIEND heal ×0.75, respec (ledgered 10 $OMR burn, points restored, shared daily cooldown), STEP TWO: MADE MAN capstone (needs lvl 40 / 10 points, unlocks Adrenaline Rush), active-ability gates + energy burst to the level-scaled cap + shared cooldown, per-skill respec (leaf-first, not_known, ledgered, daily cooldown), estate wipes the build, vocabulary closed');
await app.close();

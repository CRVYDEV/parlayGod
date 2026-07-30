// THE REGIMEN (omerta-training-expansion-design.md) — five trainable disciplines on the shared gym
// clock + the fixtures' daily trainer drills. Proves: the board + public catalog, a session pays
// banded XP + burns energy + arms the SHARED train_at clock (a discipline session blocks a core-stat
// session and vice versa — breadth never rate, the pacing wall), the gates (bad_discipline / energy /
// capped / jailed via cooldown), each touchpoint that can be pinned deterministically (stamina →
// maxEnergy, composure → maxNerve, conditioning → the Doc's bill, presence → the daily standing
// budget; marksmanship's duel edge is variance-buried and covered by the levers guard instead),
// the trainer drills (not_done / claim pays DRILL_XP to the RIGHT discipline / claimed-once /
// Mickey trains your weakest), DEATH (disciplines + drill claims die with the street), and §10.4
// (training writes ZERO transactions rows — XP is not a currency). pg-mem, zero infra.
process.env.MOD_KEY = 'test-mod-key';
process.env.TRAIN_CD_MS = '180000'; // the shared clock ON — the whole point under test
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { REGIMEN, UNDERWORLD, disciplineLvlOf, energyCapOf, nerveCapOf, dayOf } from '../src/rules.js';

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
  const c = await meOf(token);
  return { token, id: c.id };
};
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);
const seedXp = async (id, disc, xp) => {
  const row = (await pool.query(`SELECT 1 FROM character_disciplines WHERE character_id='${id}' AND discipline='${disc}'`)).rows[0];
  if (row) await pool.query(`UPDATE character_disciplines SET xp=${xp} WHERE character_id='${id}' AND discipline='${disc}'`);
  else await pool.query(`INSERT INTO character_disciplines (character_id, discipline, xp) VALUES ('${id}','${disc}',${xp})`);
};
const clearClock = (id) => pool.query(`UPDATE characters SET train_at=NULL WHERE id='${id}'`);
const txCount = async () => Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n);

const al = await mk('Regimen Al');

// ── the board + the public catalog ──
let r = await call('GET', '/v1/regimen', { token: al.token });
assert.equal(r.code, 200, 'the regimen board is readable');
assert.equal(r.body.disciplines.length, 5, 'five disciplines');
assert(r.body.disciplines.every((d) => d.level === 1 && d.xp === 0 && d.cap === REGIMEN.CAP), 'a fresh street is untrained');
assert.equal(r.body.drills.length, Object.keys(REGIMEN.TRAINERS).length, 'one drill per trainer');
assert(r.body.drills.every((d) => d.progress === 0 && !d.done && !d.claimed && d.how && d.n >= 1), 'every drill starts undone with a HOW');
const rules = (await call('GET', '/v1/rules')).body;
assert.equal(rules.regimen.disciplines.length, 5, 'the catalog is public on /v1/rules');
assert.equal(rules.regimen.drillXp, REGIMEN.DRILL_XP, 'the drill reward is knowable');

// ── a session: banded XP, energy burned, the SHARED clock armed, no ledger row ──
const tx0 = await txCount();
r = await call('POST', '/v1/regimen/stamina', { token: al.token });
assert.equal(r.code, 200, 'a stamina session lands');
assert(r.body.xp >= REGIMEN.XP_MIN && r.body.xp <= REGIMEN.XP_MAX, 'XP inside the band');
assert.equal(r.body.total, r.body.xp, 'the first session IS the total');
assert((await pool.query(`SELECT 1 FROM rng_audit WHERE character_id='${al.id}' AND action='regimen:stamina'`)).rows.length, 'the roll is rng-audited');
// the SHARED clock: a discipline session blocks the CORE gym…
r = await call('POST', '/v1/train/muscle', { token: al.token });
assert.equal(r.body.error, 'cooldown', 'a discipline session arms the core-stat gym clock');
// …and a core session blocks the disciplines (one clock, two doors)
await clearClock(al.id); await seedCh(al.id, 'energy=100');
r = await call('POST', '/v1/train/muscle', { token: al.token });
assert.equal(r.code, 200, 'core train lands with the clock cleared');
r = await call('POST', '/v1/regimen/stamina', { token: al.token });
assert.equal(r.body.error, 'cooldown', 'a core session arms the discipline clock');
assert.equal(await txCount(), tx0, 'training writes ZERO transactions rows (XP is not a currency)');

// ── the gates ──
r = await call('POST', '/v1/regimen/juggling', { token: al.token });
assert.equal(r.body.error, 'bad_discipline', 'no such discipline');
await clearClock(al.id); await seedCh(al.id, 'energy=2');
r = await call('POST', '/v1/regimen/composure', { token: al.token });
assert.equal(r.body.error, 'energy', 'too tired to train');
await seedCh(al.id, 'energy=100');
await seedXp(al.id, 'composure', REGIMEN.XP_DIVISOR * REGIMEN.CAP * REGIMEN.CAP);
r = await call('POST', '/v1/regimen/composure', { token: al.token });
assert.equal(r.body.error, 'capped', 'a mastered discipline refuses more schooling');
await seedXp(al.id, 'composure', 0);

// ── the touchpoints (each a single new site, pinned deterministically) ──
// stamina → +1 max energy per level (energyCapOf, read by view + accrual + the coach)
const lvl0 = (await meOf(al.token)).level;
const baseEnergy = (await meOf(al.token)).maxEnergy;
await seedXp(al.id, 'stamina', REGIMEN.XP_DIVISOR * 4); // xp 60 → lvl 3
assert.equal(disciplineLvlOf(REGIMEN.XP_DIVISOR * 4), 3, 'the curve sanity-check');
let me = await meOf(al.token);
assert.equal(me.maxEnergy, baseEnergy + 2, 'Roadwork lvl 3 = +2 max energy');
assert.equal(me.maxEnergy, energyCapOf(lvl0, 0, { stamina: REGIMEN.XP_DIVISOR * 4 }), 'view and helper agree');
// composure → +1 max nerve per 2 levels
const baseNerve = me.maxNerve;
await seedXp(al.id, 'composure', REGIMEN.XP_DIVISOR * 16); // lvl 5 → +2
me = await meOf(al.token);
assert.equal(me.maxNerve, baseNerve + 2, 'Steady Hands lvl 5 = +2 max nerve');
assert.equal(me.maxNerve, nerveCapOf(lvl0, { composure: REGIMEN.XP_DIVISOR * 16 }), 'view and helper agree');
// conditioning → the Doc's bill, twins compared to the dollar
const chinA = await mk('Chinless Charlie');
const chinB = await mk('Iron Chin Carla');
await seedXp(chinB.id, 'conditioning', REGIMEN.XP_DIVISOR * 100); // lvl 11 → 10% off
for (const t of [chinA, chinB]) await seedCh(t.id, 'health=50, cash=100000');
const billA = (await call('POST', '/v1/heal', { token: chinA.token })).body.cost;
const billB = (await call('POST', '/v1/heal', { token: chinB.token })).body.cost;
assert.equal(billB, Math.floor(billA * 0.9), 'Iron Chin lvl 11 takes exactly 10% off the Doc\'s bill');
// presence → a wider DAILY standing budget. Gifts are business:false (cap-exempt by design), so
// the cap is probed at a BUSINESS touchpoint (heal, +2 doc) and pinned on npc_gain.gained — the
// allowance ledger itself, immune to the cap-EXEMPT lead/streak bonuses that ride on top.
const roomA = await mk('Wallflower Wally');
const roomB = await mk('Room Worker Rita');
await seedXp(roomB.id, 'presence', REGIMEN.XP_DIVISOR * 36); // lvl 7 → +6 budget
for (let i = 0; i < 16; i++) { // 16 heals × +2 = 32 raw, vs base cap 25 / widened 31
  for (const t of [roomA, roomB]) {
    await seedCh(t.id, 'health=50, cash=1000000');
    await call('POST', '/v1/heal', { token: t.token });
  }
}
const gainedOf = async (id) => Number((await pool.query(
  `SELECT gained FROM npc_gain WHERE character_id='${id}' AND npc_id='doc'`)).rows[0]?.gained || 0);
assert.equal(await gainedOf(roomA.id), UNDERWORLD.STANDING_DAILY_CAP, 'the base day caps at the signed budget');
assert.equal(await gainedOf(roomB.id), UNDERWORLD.STANDING_DAILY_CAP + 6, 'Work the Room lvl 7 widens the day by +6');

// ── the trainer drills: not_done → do the work → claim pays the RIGHT discipline → once ──
const txDrill = await txCount(); // the heals above ledgered (they're heals) — drills must add nothing
const board = (await call('GET', '/v1/regimen', { token: al.token })).body;
const doc = board.drills.find((d) => d.npc === 'doc');
r = await call('POST', '/v1/regimen/drill/doc', { token: al.token });
assert.equal(r.body.error, 'not_done', 'no schooling before the work');
assert(r.body.message.includes(doc.how), 'the refusal tells you HOW');
// seed the day's counters to meet the drawn drill (the drill READS daily_progress — zero new counting)
const day = dayOf();
const seedCounters = async (id, counters) => {
  const row = (await pool.query(`SELECT 1 FROM daily_progress WHERE character_id='${id}' AND day=${day}`)).rows[0];
  const j = JSON.stringify(counters).replace(/'/g, "''");
  if (row) await pool.query(`UPDATE daily_progress SET counters='${j}' WHERE character_id='${id}' AND day=${day}`);
  else await pool.query(`INSERT INTO daily_progress (character_id, day, counters) VALUES ('${id}',${day},'${j}')`);
};
await seedCounters(al.id, { [doc.kind]: doc.n });
const condBefore = Number((await pool.query(
  `SELECT xp FROM character_disciplines WHERE character_id='${al.id}' AND discipline='conditioning'`)).rows[0]?.xp || 0);
r = await call('POST', '/v1/regimen/drill/doc', { token: al.token });
assert.equal(r.code, 200, 'the Doc schools you once the work is done');
assert.equal(r.body.discipline, 'conditioning', 'the Doc trains HIS discipline');
assert.equal(r.body.xp, REGIMEN.DRILL_XP, 'a drill pays the flat schooling');
assert.equal(r.body.total, condBefore + REGIMEN.DRILL_XP, 'the XP landed');
r = await call('POST', '/v1/regimen/drill/doc', { token: al.token });
assert.equal(r.body.error, 'claimed', 'one drill per trainer per day');
r = await call('POST', '/v1/regimen/drill/nobody', { token: al.token });
assert.equal(r.body.error, 'bad_trainer', 'no such trainer');
// the board reflects it
const after = (await call('GET', '/v1/regimen', { token: al.token })).body;
assert(after.drills.find((d) => d.npc === 'doc').claimed, 'the board shows the claimed drill');
// Mickey the Corner tops up your WEAKEST — with composure zeroed and the rest schooled, he picks it
await seedXp(al.id, 'composure', 0);
await seedXp(al.id, 'conditioning', 500); await seedXp(al.id, 'marksmanship', 500); await seedXp(al.id, 'presence', 500);
const mick = (await call('GET', '/v1/regimen', { token: al.token })).body.drills.find((d) => d.npc === 'cornerman');
assert.equal(mick.discipline, 'composure', 'the board shows Mickey targeting the weakest');
await seedCounters(al.id, { [doc.kind]: doc.n, [mick.kind]: mick.n });
r = await call('POST', '/v1/regimen/drill/cornerman', { token: al.token });
assert.equal(r.body.discipline, 'composure', 'Mickey schools the weakest discipline');
assert.equal(await txCount(), txDrill, 'drills write ZERO transactions rows');

// ── DEATH: the schooling dies with the street ──
const kill = await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: al.id },
  headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal(kill.statusCode, 200, 'Al is retired');
const heir = await meOf(al.token);
assert.notEqual(heir.id, al.id, 'the heir rises');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM character_disciplines WHERE character_id='${al.id}'`)).rows[0].n), 0,
  'the dead street\'s disciplines are wiped');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM npc_drills WHERE character_id='${al.id}'`)).rows[0].n), 0,
  'the dead street\'s drill claims are wiped');
const heirBoard = (await call('GET', '/v1/regimen', { token: al.token })).body;
assert(heirBoard.disciplines.every((d) => d.xp === 0 && d.level === 1), 'the heir hits the gym fresh');

console.log('regimen: all assertions passed');
await app.close();
process.exit(0);

// THE TRADES (mastery expansion, step one) — the use-XP board, the funnel firing at real hook
// sites (a pulled job, a dice play), level-ups notified, the account-level legend mirroring every
// point, DEATH (levels die; the heir inherits HEIR_KEEP_BPS of each track's XP; the legend
// survives whole), the trades leaderboard (agents excluded), the public catalog, and §10.4
// (XP is not a currency — the whole system writes ZERO transactions rows of its own).
// pg-mem, zero infra.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { MASTERY, masteryLvlOf, masteryXpFor } from '../src/rules.js';
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
  const c = await meOf(token);
  return { token, id: c.id, aid: (await pool.query(`SELECT account_id a FROM characters WHERE id='${c.id}'`)).rows[0].a };
};
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);
const myXp = async (id, track) =>
  Number((await pool.query(`SELECT xp FROM masteries WHERE character_id='${id}' AND track_id='${track}'`)).rows[0]?.xp || 0);
const legendXp = async (aid, track) =>
  Number((await pool.query(`SELECT xp FROM mastery_legend WHERE account_id='${aid}' AND track_id='${track}'`)).rows[0]?.xp || 0);

const gus = await mk('Grinder Gus');

// ── the fresh board + the public catalog ──
let r = await call('GET', '/v1/mastery', { token: gus.token });
assert.equal(r.code, 200, 'the trades board is readable');
assert.equal(r.body.tracks.length, 10, 'ten trades');
assert(r.body.tracks.every((t) => t.xp === 0 && t.lvl === 1 && t.rank === 'Green'), 'a fresh street is Green in every trade');
assert.equal(r.body.legend.rank, 'Dabbler', 'a fresh bloodline is a Dabbler');
assert.equal(r.body.heirKeepBps, MASTERY.HEIR_KEEP_BPS, 'the death-rule dial is on the board');
const rules = (await call('GET', '/v1/rules')).body;
assert.equal(rules.mastery.tracks.length, 10, 'the catalog is public on /v1/rules');
assert.equal(rules.mastery.xp.crime, MASTERY.XP.crime, 'the XP awards are knowable');

// ── the funnel fires on a pulled job (larceny) — and the legend mirrors it exactly ──
let jobs = 0;
for (let i = 0; i < 40 && jobs === 0; i++) {
  await seedCh(gus.id, 'nerve=100');
  if ((await call('POST', '/v1/crimes/pick', { token: gus.token })).body.success) jobs++;
}
assert(jobs > 0, 'at least one clean job landed');
assert.equal(await myXp(gus.id, 'larceny'), MASTERY.XP.crime, `a clean job pays ${MASTERY.XP.crime} larceny XP`);
assert.equal(await legendXp(gus.aid, 'larceny'), MASTERY.XP.crime, 'the lifetime legend mirrors every point');

// ── the gambling hook (dice at the den) — a second track, same funnel ──
await seedCh(gus.id, "cash=50000, nerve=100, loc='neon'");
r = await call('POST', '/v1/casino/dice', { token: gus.token, body: { amount: 100 } });
assert.equal(r.code, 200, 'a dice play resolved');
assert.equal(await myXp(gus.id, 'gambling'), MASTERY.XP.dice, 'the play schooled The Gambler');

// ── level-up: cross a threshold and the street hears about it ──
// seed just under L2 (xp 15 at DIVISOR 15) so the next clean job crosses it
const l2at = masteryXpFor(2);
await pool.query(`UPDATE masteries SET xp=$1 WHERE character_id='${gus.id}' AND track_id='larceny'`, [l2at - 1]);
jobs = 0;
for (let i = 0; i < 40 && jobs === 0; i++) {
  await seedCh(gus.id, 'nerve=100');
  if ((await call('POST', '/v1/crimes/pick', { token: gus.token })).body.success) jobs++;
}
assert(jobs > 0, 'a second clean job landed');
r = await call('GET', '/v1/mastery', { token: gus.token });
const lar = r.body.tracks.find((t) => t.id === 'larceny');
assert(lar.lvl >= 2, 'larceny crossed into L2');
const ding = await pool.query(
  `SELECT payload FROM notifications WHERE character_id='${gus.id}' AND type='mastery_up'`);
assert(ding.rows.length >= 1, 'the level-up was notified');
assert.equal(JSON.parse(ding.rows[0].payload).track, 'larceny', 'the ding names the trade'); // payload is a TEXT column — parse the string

// ── the curve helpers agree with the board ──
assert.equal(masteryLvlOf(lar.xp), lar.lvl, 'board level == curve');
assert.equal(lar.nextAt, masteryXpFor(lar.lvl + 1), 'the next-level distance is the curve');

// ── DEATH: levels die, the heir keeps HEIR_KEEP_BPS of each track, the legend survives whole ──
await pool.query(`UPDATE masteries SET xp=1000 WHERE character_id='${gus.id}' AND track_id='larceny'`);
const legendBefore = await legendXp(gus.aid, 'larceny');
const kill = await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: gus.id },
  headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal(kill.statusCode, 200, 'Gus is retired');
const heir = await meOf(gus.token);
assert.notEqual(heir.id, gus.id, 'the heir rises');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM masteries WHERE character_id='${gus.id}'`)).rows[0].n), 0,
  'the dead street\'s trades are wiped');
assert.equal(await myXp(heir.id, 'larceny'), Math.floor(1000 * MASTERY.HEIR_KEEP_BPS / 10000),
  'the heir inherits exactly HEIR_KEEP_BPS of the larceny schooling');
assert.equal(await legendXp(gus.aid, 'larceny'), legendBefore, 'the lifetime legend survives whole');
const estate = await pool.query(
  `SELECT payload FROM notifications WHERE character_id='${heir.id}' AND type='estate'`);
assert(Number(JSON.parse(estate.rows[0].payload).kept.masteries) >= 1,
  'the estate report counts the echoed trades');

// ── the trades leaderboard: ranked by lifetime XP, agents excluded ──
const bot = await mk('Bot Bertha');
await pool.query(`UPDATE account_persistent SET agent_flag=true WHERE account_id='${bot.aid}'`);
await pool.query(`INSERT INTO mastery_legend (account_id, track_id, xp) VALUES ('${bot.aid}', 'larceny', 999999)`);
r = await call('GET', '/v1/leaderboard/trades', { token: gus.token });
assert.equal(r.code, 200, 'the board is readable');
assert(r.body.trades.some((k) => k.name === 'Grinder Gus'), 'the bloodline (via the living heir) is ranked');
assert(!r.body.trades.some((k) => k.name === 'Bot Bertha'), 'agents never seat the trades board');
const gusRow = r.body.trades.find((k) => k.name === 'Grinder Gus');
assert(gusRow.bestTrade === 'Larceny', 'the deepest trade is named');

// ── §10.4: XP is not a currency — the whole system wrote ZERO ledger rows of its own ──
const xpRows = await pool.query(
  "SELECT COUNT(*) n FROM transactions WHERE reason LIKE 'mastery%' OR reason LIKE 'trade:%'");
assert.equal(Number(xpRows.rows[0].n), 0, 'no mastery reason ever touches the ledger');
const vocab = (await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `the reason vocabulary stays closed (${JSON.stringify(vocab.unknown || [])})`);

await app.close();
console.log('✅ THE TRADES test passed — the ten-track board + public catalog, the funnel firing at real hook sites (a clean job → larceny, a dice play → The Gambler) with the lifetime legend mirroring every point, the level-up ding, the curve helpers agreeing with the board, DEATH (levels wiped, the heir keeps exactly HEIR_KEEP_BPS of each track, the legend survives whole, kept.masteries on the estate report), the trades leaderboard (agents excluded, deepest trade named), and §10.4 (zero ledger rows — XP is not a currency)');

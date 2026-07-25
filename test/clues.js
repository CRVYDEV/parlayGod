// CLUE SCROLLS test (the 41st suite) — treasure trails (slate #4, design
// omerta-ladder-clues-seasons-design.md). Covers: the forced drop on a successful crime
// (CLUE_DROP_P=1, TEST-ONLY), one-active-scroll, the board + riddle, the COLD dig (wrong
// district — energy spent, step holds), the timed-window cold dig, walking the full trail to
// THE CASKET (a ledgered clue:casket faucet + the lifetime legend + the post-casket cooldown
// blocking the next drop), the no-scroll/jailed gates, DEATH (the scroll dies with the street,
// the legend survives), the leaderboard, and §10.4 (clue: vocabulary; cash drift == the seeds
// + every casket — the faucet reconciles per character).
process.env.MOD_KEY = 'test-mod-key';
process.env.CLUE_DROP_P = '1'; // TEST-ONLY (boot-guard rejects it in production)
// TEST-ONLY, and off until the relic section deliberately turns it on. The easy tier carries
// relicP 0.02, so the first casket below drops a relic on ~1 run in 50 — which is precisely how
// often CI went red on an assertion that has nothing to do with that roll. Pinning it to 0 makes
// every casket before the relic test deterministic instead of merely usually-right.
process.env.CLUE_RELIC_P = '0';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { CLUES, clueStepOf, cityHourOf } from '../src/rules.js';
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

// mine a salt whose 3 steps are all answerable RIGHT NOW (window contains the current city hour)
// — the derivation is deterministic, so the test picks a solvable hunt and pins it on the row.
const hourNow = cityHourOf().hour;
const openNow = (st) => !st.window || (hourNow >= st.window.lo && hourNow <= st.window.hi);
let goodSalt = null, coldSalt = null;
for (let i = 0; i < 5000 && (!goodSalt || !coldSalt); i++) {
  const salt = `mine-${i}`;
  const steps = [1, 2, 3].map((n) => clueStepOf(salt, n));
  if (!goodSalt && steps.every(openNow)) goodSalt = salt;
  if (!coldSalt && steps[0].window && !openNow(steps[0])) coldSalt = salt;
}
assert(goodSalt && coldSalt, 'mined a solvable and a timed-out salt');

const digger = await mk('Shovels McGee');
await pool.query(`UPDATE characters SET energy=200, nerve=50 WHERE id='${digger.id}'`);

// ── the drop: a successful crime hands a scroll (forced), once — the second job doesn't stack ──
let r = await call('POST', '/v1/crimes/pick', { token: digger.token, body: {} });
let tries = 0;
while ((!r.body.clue || !r.body.success) && tries++ < 20) { // 'pick' is 90%+ — retry the rare fail
  await pool.query(`UPDATE characters SET nerve=50 WHERE id='${digger.id}'`);
  r = await call('POST', '/v1/crimes/pick', { token: digger.token, body: {} });
}
assert(r.body.clue && r.body.clue.riddle, 'the job dropped a scroll (forced)');
r = await call('POST', '/v1/crimes/pick', { token: digger.token, body: {} });
assert(!r.body.clue, 'one hunt at a time — no second scroll while one is held');

// pin the mined solvable hunt on the row (3 steps, all answerable now)
await pool.query(`UPDATE clue_scrolls SET salt='${goodSalt}', step=1, steps=3 WHERE character_id='${digger.id}'`);

// ── the board reads the riddle ──
r = await call('GET', '/v1/clues', { token: digger.token });
assert.equal(r.body.scroll.step, 1, 'step one');
assert.equal(r.body.scroll.riddle, clueStepOf(goodSalt, 1).riddle, 'the riddle derives from the salt');

// ── (red-team K) D2: no digging from a safehouse — a casket is a collect-class faucet ──
await pool.query(`UPDATE characters SET safe_until = now() + interval '1 hour' WHERE id='${digger.id}'`);
r = await call('POST', '/v1/clues/dig', { token: digger.token, body: {} });
assert.equal(r.body.error, 'safe', 'no shovel work while off the grid');
await pool.query(`UPDATE characters SET safe_until = NULL WHERE id='${digger.id}'`);

// ── the COLD dig: wrong district — energy spent, the step holds ──
const step1 = clueStepOf(goodSalt, 1);
const wrong = ['docks', 'canal', 'brick', 'neon', 'cathedral', 'foundry'].find((d) => d !== step1.district);
await pool.query(`UPDATE characters SET loc='${wrong}' WHERE id='${digger.id}'`);
const e0 = (await meOf(digger.token)).energy;
r = await call('POST', '/v1/clues/dig', { token: digger.token, body: {} });
assert.equal(r.body.cold, true, 'cold ground');
assert.equal((await meOf(digger.token)).energy, e0 - CLUES.DIG_ENERGY, 'the shovel is paid win or lose');
assert.equal((await call('GET', '/v1/clues', { token: digger.token })).body.scroll.step, 1, 'the step holds');

// ── the TIMED cold dig: right ground, wrong hour (the mined timed-out salt) ──
await pool.query(`UPDATE clue_scrolls SET salt='${coldSalt}', step=1, steps=3 WHERE character_id='${digger.id}'`);
const t1 = clueStepOf(coldSalt, 1);
await pool.query(`UPDATE characters SET loc='${t1.district}' WHERE id='${digger.id}'`);
r = await call('POST', '/v1/clues/dig', { token: digger.token, body: {} });
assert.equal(r.body.cold, true, 'right ground, wrong hour');
assert(/wrong hour/.test(r.body.hint), 'the hint names the window');

// ── walk the full trail to THE CASKET (pin to the easy tier so the legacy band assert holds) ──
await pool.query(`UPDATE clue_scrolls SET salt='${goodSalt}', step=1, steps=3, tier='easy' WHERE character_id='${digger.id}'`);
const cash0 = (await meOf(digger.token)).cash;
for (let n = 1; n <= 3; n++) {
  const st = clueStepOf(goodSalt, n);
  await pool.query(`UPDATE characters SET loc='${st.district}' WHERE id='${digger.id}'`);
  r = await call('POST', '/v1/clues/dig', { token: digger.token, body: {} });
  assert.equal(r.code, 200, `dig ${n} lands`);
  if (n < 3) assert.equal(r.body.step, n + 1, 'the trail advances');
}
assert.equal(r.body.casket, true, 'THE CASKET');
assert(r.body.take >= CLUES.CASKET_MIN && r.body.take <= CLUES.CASKET_MAX, 'the take is in band');
assert.equal((await meOf(digger.token)).cash, cash0 + r.body.take, 'the casket paid to pocket');
const row = (await pool.query(
  `SELECT amount FROM transactions WHERE character_id='${digger.id}' AND reason='clue:casket'`)).rows;
assert.equal(row.length, 1, 'one ledgered casket faucet');
assert.equal(Number(row[0].amount), r.body.take, 'ledgered exactly');
assert.equal(r.body.caskets, 1, 'the lifetime legend banks');
// the scroll is gone + the post-casket cooldown blocks the next drop
assert.equal((await call('GET', '/v1/clues', { token: digger.token })).body.scroll, null, 'the scroll is spent');
r = await call('POST', '/v1/clues/dig', { token: digger.token, body: {} });
assert.equal(r.body.error, 'no_scroll', 'no scroll, no dig');
await pool.query(`UPDATE characters SET nerve=50 WHERE id='${digger.id}'`);
r = await call('POST', '/v1/crimes/pick', { token: digger.token, body: {} });
assert(!r.body.clue, 'the 8h post-casket cooldown keeps the streets quiet');

// ── the leaderboard ──
r = await call('GET', '/v1/leaderboard/clues', { token: digger.token });
assert.equal(r.body.diggers[0].name, 'Shovels McGee', 'the digger leads');
assert.equal(r.body.diggers[0].caskets, 1, 'with one casket');

// ═══ TIER-4: trail tiers, the puzzle kind, casket band scaling, relics ═══
// clear the cooldown, force a fresh scroll, then pin it to the MASTER tier
await pool.query(`UPDATE characters SET clue_at=NULL, nerve=50, energy=200 WHERE id='${digger.id}'`);
r = await call('POST', '/v1/crimes/pick', { token: digger.token, body: {} });
let ct = 0; while ((!r.body.clue || !r.body.success) && ct++ < 20) { await pool.query(`UPDATE characters SET nerve=50 WHERE id='${digger.id}'`); r = await call('POST', '/v1/crimes/pick', { token: digger.token, body: {} }); }
assert(r.body.clue && r.body.clue.tier, 'the drop carries a trail tier');
// pin a MASTER 1-step solvable hunt (goodSalt step 1 answers now)
await pool.query(`UPDATE clue_scrolls SET salt='${goodSalt}', step=1, steps=1, tier='master' WHERE character_id='${digger.id}'`);
r = (await call('GET', '/v1/clues', { token: digger.token })).body;
assert.equal(r.scroll.tier, 'master', 'the board reads the tier');
assert.equal(r.scroll.tierName, 'a Master Scroll', 'and its name');
assert(['riddle', 'anagram', 'cipher'].includes(r.scroll.kind), 'the step carries a puzzle kind');
assert(Array.isArray(r.tiers) && r.tiers.length === 5, 'the 5-tier ladder surfaces');
assert('relics' in r.legend, 'the relic count is on the board');
// Measured as a DELTA, not an absolute. The easy-tier casket earlier in this run rolls its own relic
// chance, so "exactly one relic exists" is true only on the runs where that roll missed — a 1-in-N
// red CI for a test that is not about that roll at all. What is actually being asserted is that a
// rare casket yields a relic AND that the relic reaches the Collection, which is a +1 either way.
const relicRows0 = Number((await pool.query(
  `SELECT COUNT(*) n FROM collection_log WHERE account_id='${digger.aid}' AND category='relics'`)).rows[0].n);
const relics0 = r.legend.relics;
// walk the single master step to the casket with a FORCED relic
process.env.CLUE_RELIC_P = '1';
const st = clueStepOf(goodSalt, 1);
await pool.query(`UPDATE characters SET loc='${st.district}' WHERE id='${digger.id}'`);
r = (await call('POST', '/v1/clues/dig', { token: digger.token, body: {} })).body;
assert.equal(r.casket, true, 'THE MASTER CASKET');
assert.equal(r.tier, 'master', 'the casket knows its tier');
assert(r.take >= 55000 && r.take <= 120000, `the take is in the MASTER band (saw $${r.take})`);
assert(r.relic && r.relic.id, 'a rare casket yielded a RELIC (status collectible)');
// the relic is logged to the Collection + surfaces on the board
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM collection_log WHERE account_id='${digger.aid}' AND category='relics'`)).rows[0].n), relicRows0 + 1, 'the relic is in the Collection');
assert.equal((await call('GET', '/v1/clues', { token: digger.token })).body.legend.relics, relics0 + 1, 'the board shows the relic found');
process.env.CLUE_RELIC_P = '';

// ── DEATH: the scroll dies with the street; the legend survives to the heir ──
await pool.query(`UPDATE characters SET clue_at=NULL WHERE id='${digger.id}'`);
await pool.query(`UPDATE characters SET nerve=50 WHERE id='${digger.id}'`);
r = await call('POST', '/v1/crimes/pick', { token: digger.token, body: {} });
assert(r.body.clue, 'a fresh scroll for the death test');
await app.inject({ method: 'POST', url: '/v1/mod/kill', headers: { 'x-mod-key': 'test-mod-key' }, payload: { characterId: digger.id } });
assert.equal((await pool.query(`SELECT 1 FROM clue_scrolls WHERE character_id='${digger.id}'`)).rows.length, 0,
  'the scroll died with the street');
assert.equal(Number((await pool.query(`SELECT caskets FROM account_persistent WHERE account_id='${digger.aid}'`)).rows[0].caskets),
  2, 'the lifetime legend survives to the heir (1 easy + 1 master casket)');

// ── §10.4: clue: vocabulary + the faucet reconciles per character ──
const inv = await runLedgerInvariants(pool);
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `clue: rides the cash vocabulary (${JSON.stringify(vocab.unknown || [])})`);
const cash = inv.checks.find((c) => c.name === 'character cash');
assert.equal(cash.drift, 0, `every clue:casket reconciles (no SQL cash was seeded): ${cash.drift}`);

await app.close();
console.log('✅ CLUE SCROLLS test passed — the forced crime drop (one hunt at a time), the salt-derived riddle board, the COLD dig (wrong district — energy spent, step holds), the TIMED cold dig (right ground, wrong hour), the full trail to THE CASKET (in-band take, ledgered clue:casket faucet, lifetime legend, scroll spent), the post-casket cooldown silencing the next drop, the diggers leaderboard, DEATH (the scroll dies, the legend survives), and §10.4 (clue: vocabulary + zero cash drift — the faucet reconciles exactly)');

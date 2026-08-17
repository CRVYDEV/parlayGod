// THE FIRSTS (omerta-scarcity-design.md §1) — the trophy that can only ever be won once.
//
// What this file proves, in the order it matters:
//   1. THE LATCH — one row per first, forever. The second claimant gets nothing, however well they
//      play. That is the whole feature; everything else is plumbing around it.
//   2. THE CROSSINGS — a completed collection category, a trade at MAX_LVL, a grandmastery, all
//      claim at their real hook sites (never by calling claimFirst directly, which would prove
//      only that the module works and nothing about whether the game reaches it).
//   3. SURVIVES DEATH — account-keyed by construction, so a mod-kill leaves the trophy standing and
//      the heir carries it. There is no character_id on the table to wipe.
//   4. §10.4 — a first is STATUS: the whole flow writes ZERO transactions rows and moves no cash.
// pg-mem, zero infra.
process.env.MOD_KEY = 'test-mod-key';
process.env.RATE_LIMIT = 'off';   // a real limiter has its own suites; this one drives many calls
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { MASTERY, SKILLS, collectionCatalog, firstsCatalog, masteryXpFor } from '../src/rules.js';
import { claimFirst, firstsBoard } from '../src/firsts.js';
import { logCollect } from '../src/collection.js';
import { bumpMastery } from '../src/game.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body, key } = {}) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (key) headers['x-mod-key'] = key;
  const res = await app.inject({ method, url, headers, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const c = await meOf(token);
  return { token, id: c.id, name,
    aid: (await pool.query(`SELECT account_id a FROM characters WHERE id='${c.id}'`)).rows[0].a };
};
const ledgerRows = async () => Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n);

const ace = await mk('Ace Moreno');
const bo  = await mk('Bo Vitale');

// ── the catalog derives from the live catalogs (content, never stored) ──
const cat = firstsCatalog();
const cats = Object.keys(collectionCatalog()).length;
assert.equal(Object.keys(cat).length, cats + MASTERY.TRACKS.length + SKILLS.GRANDMASTERIES.length + 1,
  'a first per collection category, per trade, per grandmastery, plus the master trail');
assert(cat['collection:cars'] && cat['mastery:larceny'] && cat['grandmastery:the_boss'] && cat['clue:master'],
  'the four kinds are all in the catalog');

// ── the board: everything OPEN on a fresh server (a race nobody has won is the point) ──
let r = await call('GET', '/v1/firsts', { token: ace.token });
assert.equal(r.code, 200, 'the firsts board is readable');
assert.equal(r.body.taken, 0, 'nothing has been won yet');
assert.equal(r.body.open, r.body.total, 'every first is open on a fresh server');
assert(r.body.firsts.every((f) => !f.taken && !f.mine && f.holder === null), 'and nobody holds one');

// ═══ 1. THE LATCH — one per server, forever ═══
// §10.4 is measured as a DELTA across the pure blocks (1, 2a, 2c). Block 2b drives real CRIMES,
// whose own cash faucet is the game's and not the trophy's — measuring across it would be
// measuring the wrong thing, and a test that can't tell those apart proves neither.
const before = await ledgerRows();
const won = await claimFirst(pool, ace.aid, 'clue:master', { name: ace.name });
assert(won && won.id === 'clue:master', 'the first claimant takes it');
const lost = await claimFirst(pool, bo.aid, 'clue:master', { name: bo.name });
assert.equal(lost, null, 'THE LATCH: the second claimant gets nothing — it is gone forever');
const again = await claimFirst(pool, ace.aid, 'clue:master', { name: ace.name });
assert.equal(again, null, 'not even the holder can claim it twice');
assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM firsts WHERE first_id='clue:master'")).rows[0].n), 1,
  'exactly one row exists for that first, ever');
assert.equal(await claimFirst(pool, ace.aid, 'not:a:real:first'), null, 'an unknown id is never a trophy');

// it reads back on both boards, and only the winner sees `mine`
r = await call('GET', '/v1/firsts', { token: ace.token });
const mine = r.body.firsts.find((f) => f.id === 'clue:master');
assert(mine.taken && mine.mine && mine.holder === 'Ace Moreno', "the winner's board shows it as theirs");
assert.equal(r.body.mine, 1, 'and counts it');
r = await call('GET', '/v1/firsts', { token: bo.token });
const theirs = r.body.firsts.find((f) => f.id === 'clue:master');
assert(theirs.taken && !theirs.mine && theirs.holder === 'Ace Moreno',
  "everyone else sees who got there first — that's the content");

// ═══ 2. THE CROSSINGS — at the real hook sites ═══

// (a) a COMPLETED collection category. Logged one item at a time through the real primitive; the
// first is claimed on the entry that COMPLETES it and not one item earlier.
const boats = collectionCatalog().boats.items;
assert(boats.length > 1, 'the marina has more than one boat — a partial category is a real state');
for (const b of boats.slice(0, -1)) await logCollect(pool, bo.aid, 'boats', b.id);
assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM firsts WHERE first_id='collection:boats'")).rows[0].n), 0,
  'an INCOMPLETE category claims nothing');
await logCollect(pool, bo.aid, 'boats', boats[boats.length - 1].id);
const boatRow = (await pool.query("SELECT account_id, holder_name FROM firsts WHERE first_id='collection:boats'")).rows[0];
assert(boatRow && boatRow.account_id === bo.aid, 'completing the category claimed the first');
// and the race is over: Ace completing it later takes nothing
for (const b of boats) await logCollect(pool, ace.aid, 'boats', b.id);
assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM firsts WHERE first_id='collection:boats'")).rows[0].n), 1,
  'a later completionist finishes the set and still does not hold the FIRST');
r = await call('GET', '/v1/collection', { token: ace.token });
assert.equal(r.body.categories.find((c) => c.id === 'boats').have, boats.length,
  'they DO get the full collection — only the first is gone');

assert.equal(await ledgerRows(), before, 'the latch + the collection crossing moved no value');

// (b) MASTERY at the cap. Seeded one level short, then driven over by a real action.
const capXp = masteryXpFor(MASTERY.MAX_LVL);
await pool.query(`INSERT INTO masteries (character_id, track_id, xp) VALUES ('${ace.id}','larceny',${capXp - 1})`);
await pool.query(`UPDATE characters SET nerve=10, energy=100 WHERE id='${ace.id}'`);
for (let i = 0; i < 12 && !(await pool.query("SELECT 1 FROM firsts WHERE first_id='mastery:larceny'")).rows[0]; i++) {
  await call('POST', '/v1/crimes/pick', { token: ace.token });
  await pool.query(`UPDATE characters SET nerve=10 WHERE id='${ace.id}'`);
}
const mrow = (await pool.query("SELECT account_id FROM firsts WHERE first_id='mastery:larceny'")).rows[0];
assert(mrow && mrow.account_id === ace.aid, 'taking a trade to the cap through real play claims its first');

const afterCrimes = await ledgerRows();   // whatever the crimes themselves wrote — not ours

// (c) GRANDMASTERY — derived on read, so the capstone that completes the pair is the event.
const boss = SKILLS.GRANDMASTERIES.find((g) => g.id === 'the_boss');
await pool.query(`UPDATE characters SET respect=2000000 WHERE id='${bo.id}'`);
for (const s of SKILLS.TREE.filter((s) => ['enforcer', 'operator'].includes(s.branch)))
  await pool.query(`INSERT INTO character_skills (character_id, skill_id) VALUES ('${bo.id}','${s.id}') ON CONFLICT DO NOTHING`);
// drop ONE of the pair's capstones back off so learning it is the crossing
await pool.query(`DELETE FROM character_skills WHERE character_id='${bo.id}' AND skill_id='${boss.reqs[1]}'`);
assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM firsts WHERE first_id='grandmastery:the_boss'")).rows[0].n), 0,
  'one capstone short is no grandmastery');
r = await call('POST', `/v1/skills/${boss.reqs[1]}`, { token: bo.token });
assert.equal(r.code, 200, `learning ${boss.reqs[1]} succeeds`);
const grow = (await pool.query("SELECT account_id FROM firsts WHERE first_id='grandmastery:the_boss'")).rows[0];
assert(grow && grow.account_id === bo.aid, 'the capstone that completes the pair claimed the grandmastery first');

assert.equal(await ledgerRows(), afterCrimes, 'the grandmastery crossing moved no value either');

// ═══ 3. SURVIVES DEATH ═══
const heldBefore = (await pool.query(`SELECT COUNT(*) n FROM firsts WHERE account_id='${ace.aid}'`)).rows[0].n;
const kill = await call('POST', '/v1/mod/kill', { key: 'test-mod-key', body: { characterId: ace.id } });
assert.equal(kill.code, 200, 'the mod-kill runs the estate');
assert.equal((await pool.query(`SELECT COUNT(*) n FROM firsts WHERE account_id='${ace.aid}'`)).rows[0].n, heldBefore,
  'a death takes nothing — the table has no character_id to wipe');
const heir = await meOf(ace.token);
assert(heir && heir.id === kill.body.heirId, 'the heir rose');
r = await call('GET', '/v1/firsts', { token: ace.token });
assert.equal(r.body.mine, Number(heldBefore), 'the heir carries the bloodline’s firsts');
assert.equal(r.body.firsts.find((f) => f.id === 'clue:master').steward, heir.name,
  'and the board names the street that carries it now');

// ═══ 4. §10.4 — a first is STATUS ═══
assert.equal((await pool.query(
  "SELECT COUNT(*) n FROM transactions WHERE reason LIKE 'first%'")).rows[0].n, 0,
  'and no reason anywhere mentions a first');

// the board still reconciles after all of it
const bd = await firstsBoard(pool, bo.aid);
assert.equal(bd.taken + bd.open, bd.total, 'taken + open == the whole catalog');
assert.equal(bd.taken, 4, 'four firsts have been won: the trail, the marina, larceny, the Boss');

// ═══ 2d. NOT SCENERY, AND NOT A BOT (red team 2026-08-16) ═══
// `claimFirst` excluded nobody, while every sibling status axis — including `mastery.js`'s own
// Trades leaderboard, which ranks this exact achievement one rung down — excludes NPC residents and
// agent accounts by name. A first is CONSUMED: a leaderboard place is re-taken tomorrow, a first is
// gone from the human game forever, so it is the worse one to lose. Both halves were reproduced
// against a booted server before the fix (a resident took `mastery:wetwork` through a real duel;
// an agent took `mastery:larceny` with one ordinary crime).
// The assertion is two-sided ON PURPOSE: "nobody claimed it" would also pass if claiming were
// broken outright, so a HUMAN must still take the same first straight afterwards.
{
  const trk = MASTERY.TRACKS.find((t) => !['larceny'].includes(t.id)) || MASTERY.TRACKS[1];
  const fid = `mastery:${trk.id}`;
  const crossOver = async (who) => {
    await pool.query(`INSERT INTO masteries (character_id, track_id, xp) VALUES ('${who.id}','${trk.id}',${capXp - 1})
      ON CONFLICT (character_id, track_id) DO UPDATE SET xp=${capXp - 1}`);
    await bumpMastery(pool, null, (await pool.query(`SELECT * FROM characters WHERE id='${who.id}'`)).rows[0], trk.id, 'duel');
  };

  const bot = await mk('Botto Malone');
  await pool.query(`UPDATE account_persistent SET agent_flag=true WHERE account_id='${bot.aid}'`);
  await crossOver(bot);
  assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM firsts WHERE first_id='${fid}'`)).rows[0].n), 0,
    'an AGENT crossing the cap takes no first — agents earn everything and consume no trophy');

  const npc = await mk('Silvio Bruno');
  await pool.query(`UPDATE account_persistent SET npc_flag=true WHERE account_id='${npc.aid}'`);
  await pool.query(`UPDATE characters SET is_npc=true WHERE id='${npc.id}'`);
  await crossOver(npc);
  assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM firsts WHERE first_id='${fid}'`)).rows[0].n), 0,
    'nor does an NPC RESIDENT — scenery the server spawned must never hold a one-per-server trophy');

  const human = await mk('Rea Lucci');
  await crossOver(human);
  const won = (await pool.query(`SELECT account_id FROM firsts WHERE first_id='${fid}'`)).rows[0];
  assert(won && won.account_id === human.aid,
    'and the race is still WINNABLE — a human crossing the same cap takes it (without this the block is vacuous)');
}

await app.close();
console.log('firsts: PASS');

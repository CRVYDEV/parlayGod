// THE CITY STANDING test (the 44th suite) — the unifying "who's winning" spine over the 35 status axes.
// Covers: the six-pillar aggregate + log-share scoring, the board rank order, BREADTH beating a single
// maxed axis (present in two pillars ranks above one giant column), agent + banned exclusion, the
// personal myStanding (rank/of/pillars), and a no-legend account reading 0 but still ranked.
//
// The standing legends are account-level survives-death STATUS columns (kills/tycoon_earned/…), NOT §10.4
// currency, so SQL-seeding them here is legitimate (the hitman-rep/portfolio board precedent — the sim's
// "never seed value" rule is about the ledger, and standing legends move no value).
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { cityStanding, myStanding, STANDING_PILLARS } from '../src/standing.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const id = (await call('GET', '/v1/me', { token })).body.character.id;
  return { token, id, aid: (await pool.query(`SELECT account_id a FROM characters WHERE id='${id}'`)).rows[0].a };
};
const seed = (aid, cols) => pool.query(`UPDATE account_persistent SET ${cols} WHERE account_id='${aid}'`);

const blood = await mk('Vito Blood');        // maxes ONE pillar hard
const spanner = await mk('Sal Spanner');     // present across TWO pillars, each modest
const nobody = await mk('Guido Nobody');     // no legends at all
const agent = await mk('Bot Runner');        // agent — excluded

await seed(blood.aid, 'kills=100, hitman_rep=5000, boxing_wins=80');                  // Blood only
await seed(spanner.aid, 'tycoon_earned=2000000, rwa_invested=3000, monument_built=1000000'); // Empire + Legit
await seed(agent.aid, 'agent_flag=true, kills=999999, tycoon_earned=999999999');       // huge but excluded

// ── the board ──
let r = await call('GET', '/v1/leaderboard/city', { token: blood.token });
assert.equal(r.code, 200, 'the City Standing board is live');
const board = r.body.board;
assert.ok(board.length >= 3, 'the living non-agent population is ranked');
const names = board.map((b) => b.name);
assert.ok(!names.includes('Bot Runner'), 'agents are excluded from the human spine');

// BREADTH beats a single maxed axis: the two-pillar spanner outranks the one-pillar blood.
const iSpan = names.indexOf('Sal Spanner'), iBlood = names.indexOf('Vito Blood');
assert.ok(iSpan >= 0 && iBlood >= 0, 'both ranked');
assert.ok(iSpan < iBlood, 'presence across two pillars ranks above maxing one column');

// pillar breakdown is surfaced (the "why") — the spanner has Empire AND Legit, zero Blood.
const span = board[iSpan];
assert.ok(span.pillars.empire > 0 && span.pillars.legit > 0, 'spanner scores its two pillars');
assert.equal(span.pillars.blood, 0, 'spanner has no blood');
assert.ok(board[iBlood].pillars.blood > 0 && board[iBlood].pillars.empire === 0, 'blood scores only blood');
assert.equal(Object.keys(span.pillars).length, STANDING_PILLARS.length, 'all six pillars present');
assert.ok(typeof board[0].title === 'string' && board[0].standing >= board[1].standing, 'sorted desc with a title');

// ── the personal read (myStanding via the endpoint's `you`) ──
assert.equal(r.body.you.rank, iBlood + 1, "the caller's own rank matches their board position");
assert.ok(r.body.you.standing > 0 && r.body.you.pillars.blood > 0, 'own standing + pillar breakdown surfaced');
assert.ok(r.body.you.of >= 3, 'population size reported');

// a NO-LEGEND account is still counted (present, unranked-at-the-top, standing 0)
const ns = await myStanding(pool, nobody.aid);
assert.equal(ns.standing, 0, 'a legend-less street reads 0 standing');
assert.equal(ns.title, 'Nobody Yet', 'and the entry-tier title');
assert.ok(ns.of >= 3, 'still part of the counted population');

// ── banned exclusion ──
await pool.query(`UPDATE accounts SET status='banned' WHERE id='${blood.aid}'`);
const board2 = await cityStanding(pool);
assert.ok(!board2.some((b) => b.name === 'Vito Blood'), 'a banned account drops off the spine');

console.log('ok - city standing: spine board, breadth>depth, pillar breakdown, agent+banned exclusion, personal rank, no-legend zero');
await app.close();

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
import { memo } from '../src/memo.js';
import { cityStanding, myStanding, STANDING_PILLARS } from '../src/standing.js';

// The scored population is CACHED in production (see standing.js — it was the most expensive polled
// read in the game). Every assertion below reads state it has just written, so the suite pins the TTL
// to 0 and the cache block at the foot turns it back on to prove the cache itself.
process.env.STANDING_CACHE_MS = '0';

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

// ── THE MEMO: single-flight and the TTL, proven directly on the shared helper ──
// Directly, because the property that matters is a COUNT of computations and a database probe cannot
// see one: a burst of N arrivals must cost ONE computation, not N. That is the half people leave out
// of a hand-rolled cache, and the half the /health measurement (400 concurrent hits -> 2 queries with
// it, 400 without) exists to demonstrate.
let computes = 0;
let ttl = 60000;
const slow = memo(async () => { computes++; await new Promise((r) => setTimeout(r, 20)); return { n: computes }; }, () => ttl);

const burst = await Promise.all(Array.from({ length: 200 }, () => slow()));
assert.equal(computes, 1, 'SINGLE-FLIGHT: 200 arrivals inside one cold window cost exactly ONE computation');
assert.ok(burst.every((b) => b.n === 1), 'and every one of them is served the same answer');

await slow();
assert.equal(computes, 1, 'a warm hit inside the TTL recomputes nothing');

ttl = 0;
await slow(); await slow();
assert.equal(computes, 3, 'TTL 0 disables the cache entirely — every call is a live computation');

ttl = 60000;
await slow();
const before = computes;
slow.clear();
await slow();
assert.equal(computes, before + 1, 'clear() forces the next caller to recompute');

const blood = await mk('Vito Blood');        // maxes ONE pillar hard
const spanner = await mk('Sal Spanner');     // present across TWO pillars, each modest
const nobody = await mk('Guido Nobody');     // no legends at all
const agent = await mk('Bot Runner');        // agent — excluded

await seed(blood.aid, 'kills=100, hitman_rep=5000, boxing_wins=80');                  // Blood only
await seed(spanner.aid, 'tycoon_earned=2000000, prestige_sunk=3000, monument_built=1000000'); // Empire + Legit (D11: rwa_invested left the pillar)
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

// ── THE STANDING CACHE: warm, and — the load-bearing half — never leaking one player's own figures ──
// the two personal truths, taken LIVE (the cache is still off here) so the leak assertions below
// compare against a figure the cache cannot have influenced.
const spanTruth = await myStanding(pool, spanner.aid);
assert.ok(spanTruth.standing > 0 && spanTruth.rank > 0, 'the spanner has a real standing to be robbed of');

process.env.STANDING_CACHE_MS = '60000';
const spanToken = spanner.token, nobodyToken = nobody.token;

await call('GET', '/v1/leaderboard/city', { token: spanToken });   // warm it
await seed(nobody.aid, 'kills=123456789');                          // a mutation the warm window must not see
const warm = await call('GET', '/v1/leaderboard/city', { token: spanToken });
assert.equal(warm.body.board.find((b) => b.name === 'Guido Nobody')?.standing ?? 0, 0,
  'the board is served from the warm cache — the write inside the window is not reflected');

// THE LEAK: the shared half is cached, the PERSONAL half is not. Two players hitting the cached board
// must each read their OWN `you`, or the cache is handing one player another player's figures.
// NOBODY calls first, so a payload-level cache would hand the SPANNER the previous caller's zero —
// and the two truths are taken with the cache OFF above, so the comparison cannot go vacuous under a
// mutation that makes both readings identical.
const asNobody = await call('GET', '/v1/leaderboard/city', { token: nobodyToken });
const asSpan = await call('GET', '/v1/leaderboard/city', { token: spanToken });
assert.equal(asNobody.body.you.standing, 0, "the legend-less street reads their OWN zero");
assert.equal(asSpan.body.you.standing, spanTruth.standing, "and the spanner reads their OWN standing, never the previous caller's");
assert.equal(asSpan.body.you.rank, spanTruth.rank, 'their own rank too');
assert.notEqual(asSpan.body.you.rank, asNobody.body.you.rank, 'two callers of one cached board read two different ranks');
assert.deepEqual(asSpan.body.board.map((b) => b.name), asNobody.body.board.map((b) => b.name),
  'while the SHARED half really is the same array for both — which is what makes caching it correct');

// the RECRUITERS board on the same landing screen is cached WHOLE, because every field of it is
// server-wide — so the warmth is asserted the same way, and it shares standing.js's window rather than
// restating the default.
const rec0 = await call('GET', '/v1/leaderboard/recruiters', { token: spanToken });
assert.equal(rec0.body.recruiters.find((x) => x.name === 'Sal Spanner'), undefined, 'the spanner has recruited nobody yet');
await seed(spanner.aid, 'recruits=7');
const rec1 = await call('GET', '/v1/leaderboard/recruiters', { token: spanToken });
assert.equal(rec1.body.recruiters.find((x) => x.name === 'Sal Spanner'), undefined,
  'the recruiters board is served from the warm cache too — the write inside the window is not reflected');

// and with the cache off the same write is live immediately
process.env.STANDING_CACHE_MS = '0';
const fresh = await call('GET', '/v1/leaderboard/city', { token: spanToken });
assert.ok((fresh.body.board.find((b) => b.name === 'Guido Nobody')?.standing ?? 0) > 0,
  'STANDING_CACHE_MS=0 disables it — the write is reflected on the next read');
const recFresh = await call('GET', '/v1/leaderboard/recruiters', { token: spanToken });
assert.equal(recFresh.body.recruiters.find((x) => x.name === 'Sal Spanner')?.recruits, 7,
  '…on both boards, which is what proves they share one window rather than two copies of the default');

console.log('ok - city standing: spine board, breadth>depth, pillar breakdown, agent+banned exclusion, personal rank, no-legend zero, the cache (single-flight, TTL, no per-player leak)');
await app.close();

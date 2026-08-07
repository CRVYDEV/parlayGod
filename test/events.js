// TONIGHT IN THE CITY (omerta-first-contact-and-events-design.md, MOVE 2) — the live-events aggregator.
//
// A read-only strip of the OPEN scheduled events (boxing main event / poker tournament / grand prix /
// stakes / futurity / megaproject), so anticipation is something a player can SEE. The centre of the
// test: the open events surface with a clock (or progress), a settled/absent event does NOT, and the
// whole aggregator moves no value.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const events = async () => (await call('GET', '/v1/events')).body.events;
const txCount = async () => Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n);

// ════════════ empty city — the honest empty state ════════════
{
  const e = await events();
  assert.equal(Array.isArray(e), true, 'the board returns an events array');
  assert.equal(e.length, 0, 'nothing scheduled → an empty strip (never a dead "no events" card)');
}

// ════════════ open events surface with a clock ════════════
const before = await txCount();
// a poker tournament with buy-ins in the pool, closing in an hour
await pool.query(`INSERT INTO poker_tournaments (id, status, opened_at, resolves_at, pool) VALUES ('tourney-1', 'open', now(), now() + interval '1 hour', 50000)`);
// a grand prix closing in 30 minutes (should sort ABOVE the tournament)
await pool.query(`INSERT INTO grand_prix (id, status, opened_at, resolves_at, pool) VALUES ('gp-1', 'open', now(), now() + interval '30 minutes', 25000)`);
// a RESOLVED tournament — must NOT show
await pool.query(`INSERT INTO poker_tournaments (id, status, opened_at, resolves_at, pool) VALUES ('tourney-old', 'resolved', now(), now() - interval '1 hour', 9000)`);
// a building megaproject — shows as PROGRESS, no clock
await pool.query(`INSERT INTO megaprojects (id, monument, seq, target, progress, status) VALUES ('mp-1', 'cathedral', 0, 1000000, 250000, 'building')`);

const e = await events();
const kinds = e.map((x) => x.kind);
assert.equal(kinds.includes('poker'), true, 'the open tournament is on the strip');
assert.equal(kinds.includes('grandprix'), true, 'the open grand prix is on the strip');
assert.equal(kinds.includes('megaproject'), true, 'the building megaproject is on the strip');
assert.equal(e.filter((x) => x.kind === 'poker').length, 1, 'the RESOLVED tournament is not shown — only the open one');

const gp = e.find((x) => x.kind === 'grandprix');
const pk = e.find((x) => x.kind === 'poker');
assert.equal(gp.closesSeconds > 0 && gp.closesSeconds <= 1800 + 5, true, 'the grand prix carries a live countdown (~30 min)');
assert.equal(pk.closesSeconds > 1800, true, 'the tournament carries its own (~1h) countdown');
// the clocked events sort soonest-closing first (the megaproject, no clock, trails)
const clocked = e.filter((x) => x.closesSeconds != null);
assert.equal(clocked[0].kind, 'grandprix', 'the soonest-closing event leads the strip');
assert.equal(e[e.length - 1].kind, 'megaproject', 'the clockless megaproject trails');

const mp = e.find((x) => x.kind === 'megaproject');
assert.equal(mp.pct, 25, 'the megaproject surfaces its progress % (250k/1M)');
assert.equal(mp.closesSeconds, undefined, 'the megaproject has progress, not a clock');
assert.ok(pk.subtitle.includes('50,000'), 'a pool is surfaced so a player sees what is on the line');

// ════════════ ALSO TODAY — the always-on den draws ════════════
{
  const daily = (await call('GET', '/v1/events')).body.daily;
  assert.equal(Array.isArray(daily), true, 'the board carries a daily list of the always-on draws');
  const dk = daily.map((x) => x.kind);
  assert.deepEqual(dk, ['numbers', 'track', 'fight'], 'the numbers, the track, and the weekly fight are always on');
  assert.equal(daily.every((x) => x.tab === 'den'), true, 'every daily draw jumps to the Den');
}

// ════════════ §10.4 — the aggregator moves no value ════════════
await events(); await events();
assert.equal(await txCount(), before, 'reading the events board writes no ledger rows — it is a pure read');

console.log('events: PASS');
await app.close();
process.exit(0);

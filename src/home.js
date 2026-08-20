// THE HOME AGGREGATE — one read for the screen a returning player lands on.
//
// WHY THIS EXISTS. `tools/pollcost.js` measures what one IDLE player costs, because the server
// ceiling is in requests and the player ceiling is that divided by the per-player cost. Home was
// measured at 19 requests a tick — the worst screen in the game, and the one a returning player is
// sent to (THE HOME drop made it the landing screen deliberately). Sixteen of those nineteen are
// authed board GETs fired from one render, and TWELVE of them each call `readCharacter`, so a single
// Home render acquired twelve connections, opened twelve transactions and read the same character row
// twelve times. Worse, on the locked path they take that row `FOR UPDATE` — the client fires them in
// a `Promise.all`, so they QUEUE ON EACH OTHER'S LOCK. One read does the work of all of them.
//
// WHAT IS NOT HERE, and why that is correct rather than a compromise. `bulletinBoard` WRITES — it
// materialises the week's snapshot the first time a player picks the bulletin up — and `readCharacter`
// prefers a no-BEGIN path whose client REFUSES writes (game.js `readOnlyClient`). A writing board
// cannot ride in a read aggregate, so `/v1/bulletin` stays its own fetch. That is the honest scope:
// 16 board GETs become 2, not 1.
//
// EVERY ROUTE BELOW STAYS MOUNTED. Agents poll them (AGENTS.md), the client wiring guard fetches them
// one at a time, and `/v1/screens` beacons them. This is additive — a second door onto the same
// rooms, never a replacement for the doors that exist.
//
// SEQUENTIAL, NOT PARALLEL. These share ONE pooled connection and node-pg cannot run two queries at
// once on it (test/gates.js THE CONNECTION-SHARING LEDGER: it queues them behind a deprecation today
// and THROWS from pg@9). Handing each board its own connection is the other wrong answer — it would
// read outside the request's transaction, and N connections per request is the pool-exhaustion shape
// this project has been bitten by twice. Sequential is correct AND identical in speed.
import * as W from './growth.js';
import * as Career from './career.js';
import * as Crew from './crew.js';
import * as Discovery from './discovery.js';
import * as Streak from './streak.js';
import * as Collision from './collision.js';
import * as Explore from './explore.js';
import * as Prime from './primetime.js';
import * as Day from './day.js';
import * as Payroll from './payroll.js';
import * as People from './people.js';
import { cityEventBoard, resultsBoard } from './events.js';

// key → the route that serves the same board on its own. The client mirror resolves a read off
// `home.<key>` against `<key>`'s own route, so this map is the contract between the two: a key here
// whose route answers a different shape is exactly the drift the mirror exists to catch.
export const HOME_BOARDS = [
  ['onboard',   '/v1/onboard',   (ch, client, h) => W.onboardBoard(ch, h, client)],
  ['social',    '/v1/social',    (ch, client, h) => W.socialBoard(client, h.accountId, ch)],
  ['career',    '/v1/career',    (ch, client, h) => Career.careerBoard(ch, client, h)],
  ['people',    '/v1/people',    (ch, client) => People.peopleBoard(client, ch)],
  ['paper',     '/v1/paper',     (ch, client) => People.paperBoard(client, ch)],
  ['crew',      '/v1/crew',      (ch, client) => Crew.crewBoard(ch, client)],
  ['discovery', '/v1/discovery', (ch, client, h, ctx) =>
    Discovery.discoveryBoard(ch, client, ctx.online, { district: null, nofam: false, online: false })],
  ['events',    '/v1/events',    (ch, client) => cityEventBoard(client)],
  ['streak',    '/v1/streak',    (ch, client) => Streak.streakBoard(ch, client)],
  ['results',   '/v1/results',   async (ch, client) => ({ results: await resultsBoard(client) })],
  ['explore',   '/v1/explore',   (ch, client, h) => Explore.exploreBoard(ch, h.acct, h.owned)],
  ['primetime', '/v1/primetime', (ch, client) => Prime.primeTimeBoard(client, ch)],
  ['day',       '/v1/day',       (ch, client, h) => Day.dayBoard(client, ch, h)],
  ['live',      '/v1/live',      (ch, client, h, ctx) => Collision.collisionBoard(client, ch, ctx.online)],
  ['payroll',   '/v1/payroll',   (ch, client, h) => Payroll.payrollBoard(ch, client, h)],
];

export async function homeBoard(ch, client, h, ctx = {}) {
  const out = { boards: HOME_BOARDS.length, failed: [] };
  // PER-BOARD ISOLATION. Today a board that throws 500s its own request and the OTHER fifteen cards
  // still render; consolidating without isolation would make one broken board blank the whole landing
  // screen, which is a resilience REGRESSION on the screen that can least afford one. The two paths
  // need different mechanics: `readCharacter`'s fast path has no BEGIN, so a failed statement kills
  // only itself and a plain catch is enough — but the LOCKED fallback (taken whenever accrual moved,
  // i.e. most first renders) runs in a transaction, where a failed statement aborts the WHOLE
  // transaction (25P02) and every board after it. Hence a savepoint there.
  // The savepoint is ATTEMPTED per call and never assumed: pg-mem cannot parse one at all, and a
  // module-wide cache of "do savepoints work here" is the bug AUDIT-street-life fixed in
  // `recordContact` — whichever context ran first decided it for every later caller. Taking it
  // outside the try is the same mistake one level up: the probe itself throws under pg-mem, and a
  // throw there escapes the isolation it exists to provide (measured — it 500'd the whole board).
  const txn = !h.readOnly;
  for (const [key, route, call] of HOME_BOARDS) {
    let sp = false;
    if (txn) { try { await client.query('SAVEPOINT home_board'); sp = true; } catch { /* pg-mem: no savepoints */ } }
    try {
      out[key] = await call(ch, client, h, ctx);
      if (sp) await client.query('RELEASE SAVEPOINT home_board');
    } catch (e) {
      if (sp) { try { await client.query('ROLLBACK TO SAVEPOINT home_board'); } catch { /* the txn is already gone */ } }
      // COUNTED, never silently nothing: a missing board renders an empty card either way, and the
      // list is what tells a human which one — and that `/v1/<key>` is the route to go and read.
      out[key] = null;
      out.failed.push(key);
      console.error(`home board ${key} (${route}) failed (non-fatal)`, e?.code || e);
    }
  }
  return out;
}

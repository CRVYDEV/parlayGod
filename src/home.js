// THE HOME AGGREGATE — one read for the screen a returning player lands on.
//
// WHY THIS EXISTS. Home was measured at 19 requests a tick — the worst screen in the game, and the
// one a returning player is sent to (THE HOME drop made it the landing screen deliberately). Sixteen
// of those nineteen are authed board GETs fired from one render, and TWELVE of them each call
// `readCharacter`. `src/aggregate.js` carries the full argument and the isolation mechanics; this
// file is the MAP and nothing else.
//
// WHAT IS NOT HERE, and why that is correct rather than a compromise. `bulletinBoard` WRITES — it
// materialises the week's snapshot the first time a player picks the bulletin up — and the read path
// refuses writes. So `/v1/bulletin` stays its own fetch: the honest scope is 16 board GETs become 2,
// not 1. That constraint is also the PROOF for the fifteen below (see test/home.js).
import { runBoards } from './aggregate.js';
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
  // KEYED `cityEvents`, not `events`: the envelope owns that name (src/aggregate.js RESERVED), and a
  // board keyed on it replaces `h.events` silently on this screen alone. The key need not match the
  // route's last segment — several here already do not.
  ['cityEvents', '/v1/events',   (ch, client) => cityEventBoard(client)],
  ['streak',    '/v1/streak',    (ch, client) => Streak.streakBoard(ch, client)],
  ['results',   '/v1/results',   async (ch, client) => ({ results: await resultsBoard(client) })],
  ['explore',   '/v1/explore',   (ch, client, h) => Explore.exploreBoard(ch, h.acct, h.owned)],
  ['primetime', '/v1/primetime', (ch, client) => Prime.primeTimeBoard(client, ch)],
  ['day',       '/v1/day',       (ch, client, h) => Day.dayBoard(client, ch, h)],
  ['live',      '/v1/live',      (ch, client, h, ctx) => Collision.collisionBoard(client, ch, ctx.online)],
  ['payroll',   '/v1/payroll',   (ch, client, h) => Payroll.payrollBoard(ch, client, h)],
];

export const homeBoard = (ch, client, h, ctx = {}) => runBoards(HOME_BOARDS, ch, client, h, ctx);

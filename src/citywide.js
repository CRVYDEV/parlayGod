// CITYWIDE — the city screen's authed boards in one read.
//
// The third aggregate, and the one that moved the ceiling. Home went 19 requests a tick to 5 and the
// block took streets from 9 to 3 — which left CITY as the worst screen, at exactly the cost streets
// used to be, so the ceiling had not moved at all. `src/aggregate.js` carries the argument and the
// isolation mechanics; this file is the MAP.
//
// WHY `/v1/city` IS DELIBERATELY NOT IN IT. It is the one board here that is KEYLESS, and it already
// carries two 30-second server-side caches (the skyline and the ticker ballot) because it is public.
// Folding it into an authed read would mean either a second copy of those caches — the drift this
// project keeps paying for — or recomputing per player what is currently computed once for everybody.
// It would also close the door on edge-caching a public board, which is strictly better than any
// aggregate can be. So the city screen is two fetches, not one, and that is the right shape rather
// than a shortfall.
import { runBoards } from './aggregate.js';
import * as World from './world.js';
import * as NpcWar from './npcwar.js';
import * as Mega from './megaproject.js';
import * as Shipment from './shipment.js';

export const CITYWIDE_BOARDS = [
  ['world',     '/v1/world',        (ch, client, h) => World.worldBoard(client, ch, h)],
  ['raids',     '/v1/world/raids',  (ch, client) => World.raidBoard(client, ch.id)],
  ['npcfamily', '/v1/npcfamily',    (ch, client) => NpcWar.warBoard(client, ch)],
  // megaBoard takes its querier as an argument, so handing it the request's own client is both
  // correct and stricter than the route it mirrors — that client is the one that refuses writes.
  ['mega',      '/v1/megaproject',  (ch, client, h) => Mega.megaBoard(client, h.accountId)],
  ['shipment',  '/v1/shipment',     (ch, client, h) => Shipment.shipmentBoard(ch, client, h)],
];

export const citywideBoard = (ch, client, h, ctx = {}) => runBoards(CITYWIDE_BOARDS, ch, client, h, ctx);

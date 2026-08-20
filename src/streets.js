// THE BLOCK — one read for the streets screen, the one players spend the most time on.
//
// The Home aggregate took the landing screen from 19 requests a tick to 5, which left STREETS as the
// worst at 9 — and streets is where a player actually lives, so it is the largest remaining share of
// what one idle player costs. `src/aggregate.js` carries the argument and the isolation mechanics;
// this file is the MAP.
//
// WHY `/v1/block` AND NOT `/v1/streets/...`. `/v1/streets` is already the ROSTER — the list of people
// you can act on — and it is a different thing from the screen's own boards. Hanging the aggregate
// under it would put two unrelated meanings on one path, and the roster is not even one of the boards
// folded in here. The block is where the corner, the day's work and the gym are.
//
// TWO OF THESE DO NOT GO THROUGH `readCharacter`, and both are deliberate:
//   · `/v1/market/prices` is KEYLESS and pure — it computes today's board off the seed with no
//     database at all. It is in the map because the ceiling is measured in REQUESTS, so folding it in
//     is a whole round trip saved for no server cost. Its call ignores every argument.
//   · `/v1/daily` reads through the pool rather than `readCharacter`. `getDaily` is two SELECTs and
//     writes nothing, and it takes its querier as an argument — so handing it the request's own
//     client is both correct and stricter than the route it mirrors, since that client is the one
//     that refuses writes.
import { runBoards } from './aggregate.js';
import * as W from './growth.js';
import * as RG from './regimen.js';
import * as Hustle from './hustle.js';
import * as Corner from './corner.js';
import * as Soldiers from './soldiers.js';
import * as Clues from './clues.js';
import { priceBlock, DISTRICTS, GOODS, DRUGS, goodPriceOf, demandOf, makingsPriceOf } from './rules.js';

// The price board, in ONE place. `/v1/market/prices` built this inline in its route; with a second
// caller that becomes two implementations of one board, which is how the two ends of a mirror come to
// disagree (the extortFront lesson). The route calls this now too.
export const marketPrices = (block = priceBlock()) => ({
  block,
  goods: Object.fromEntries(DISTRICTS.map((d) =>
    [d.id, Object.fromEntries(GOODS.map((g) => [g.id, goodPriceOf(g.id, d.id, block)]))])),
  demand: Object.fromEntries(DISTRICTS.map((d) =>
    [d.id, Object.fromEntries(DRUGS.map((dr) => [dr.id, Math.round(demandOf(dr.id, d.id, block) * 100) / 100]))])),
  makings: Object.fromEntries(DRUGS.map((dr) => [dr.id, makingsPriceOf(dr.id, block)])),
});

export const STREETS_BOARDS = [
  ['prices',   '/v1/market/prices', () => marketPrices()],
  ['daily',    '/v1/daily',         (ch, client) => W.getDaily(client, ch.id)],
  ['soldiers', '/v1/soldiers',      (ch, client, h) => Soldiers.soldierBoard(ch, client, h.acct)],
  ['regimen',  '/v1/regimen',       (ch, client, h) => RG.regimenBoard(ch, client, h)],
  ['hustle',   '/v1/hustle',        (ch, client) => Hustle.hustleBoard(ch, client)],
  ['corner',   '/v1/corner',        (ch, client) => Corner.cornerBoard(ch, client)],
  // THE TREASURE TRAIL rode in its own `.then` AFTER the render and patched a slot in — one more
  // request, and a card that arrived a beat late. Folding it in lets the screen draw with it.
  ['clues',    '/v1/clues',         (ch, client, h) => Clues.clueBoard(client, ch, h.acct)],
];

export const streetsBoard = (ch, client, h, ctx = {}) => runBoards(STREETS_BOARDS, ch, client, h, ctx);

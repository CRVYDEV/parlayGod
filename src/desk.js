// ── src/desk.js — THE DESK (economy v3 step 2: where a spent $OMR goes) ──
// Design: omerta-economy-v3-design.md §3, §4.2. A sink used to destroy the token; now it hands it to
// the desk, and the desk sells it back to the market. The whole economic argument in one line:
//
//   annual revenue ≈ annual $OMR sink volume × price
//
// so the number that matters is RETURN VELOCITY — how many times a year one token comes home —
// rather than how few tokens exist. You cannot burn AND recycle the same unit; the founder chose
// revenue, which is also why nothing here may be described as deflationary (design §10 risk B).
//
// WHAT THIS FILE IS NOT, YET: the auction. Step 3 adds the daily Dutch sale that turns inventory
// into ETH, and the band that decides whether the desk should be selling at all. Until then the
// shelf only fills — which is deliberate and worth stating plainly, because a desk that accumulates
// and never sells is indistinguishable, from the outside, from a burn with extra steps.
//
// The RECYCLE itself lives in `game.js:ledger`, not here: it hooks the one function every value
// movement passes through, so a sink added later cannot forget to feed the desk. This module is the
// read side and the ops surface.
import { DESK, DESK_RECYCLE_REASON } from './rules.js';

export async function deskInventory(client) {
  return (await client.query('SELECT balance, lifetime_in, lifetime_sold FROM desk_inventory WHERE id=1')).rows[0]
    || { balance: 0, lifetime_in: 0, lifetime_sold: 0 };
}

// The public board. Published rather than hidden for the same reason the emission schedule was: a
// player who is told "every token you spend comes back to the desk and is sold again" is entitled to
// read the shelf. `sinks` names WHICH spends feed it, so the claim is checkable and not just stated.
export async function deskBoard(pool) {
  const d = await deskInventory(pool);
  const recycledToday = Number((await pool.query(
    `SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='omr' AND reason=$1 AND at >= now() - interval '1 day'`,
    [DESK_RECYCLE_REASON])).rows[0].s);
  return {
    inventory: Number(d.balance),
    lifetimeIn: Number(d.lifetime_in),
    lifetimeSold: Number(d.lifetime_sold),
    recycledToday,
    // the auction is step 3 — say so rather than implying the shelf turns over already
    auction: null,
    sinks: DESK.SINK_REASONS.filter((r) => !DESK.NOT_RECYCLED.includes(r)),
    notRecycled: DESK.NOT_RECYCLED,
    note: 'Every $OMR a sink takes lands here for the desk to sell back. Withdrawing to the chain is '
      + 'the one exception — that token leaves the game rather than coming to the house.',
  };
}

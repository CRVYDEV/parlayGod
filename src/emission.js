// ── src/emission.js — THE STREET WAGE, RETIRED (economy v3 step 1: kill the faucet) ──
// Design: omerta-economy-v3-design.md §9.1. The wage paid $OMR on a decaying schedule out of a
// fixed endowment, pro-rata to respect gained. It is gone, and the reason is the model, not a bug:
//
//   v3's FIRST WALL is "no faucet" — zero mint reasons that pay a player, so in-game $OMR can never
//   exceed what was DEPOSITED. That turns "extraction ≤ inflow" from a constraint the full-reserve
//   queue has to enforce into an identity the ledger simply exhibits. You cannot have that wall and
//   a wage at the same time; a scheduled faucet is exactly the thing it forbids.
//
// The measured Sybil economics were the second reason (BALANCE.md § THE FARM): the wage's per-account
// cap is anti-concentration, so it pays a farm of cheap identities strictly better than one real
// player, and every wall we added (the mint fee, the level floor, the score floor) taxed the farm
// without ever making it unprofitable. A faucet whose best customer is a farm is not a wage.
//
// WHAT REPLACES IT for a free player: no $OMR income, deliberately. Their paths are rarity drops and
// hunting somebody who is holding (v3 §4, §8). That is a real design risk and it is on the record as
// risk D — it needs population to work.
//
// §10.4 — READ THIS BEFORE "CLEANING UP" THE REASON: `emission:wage` stays in the `omr` vocabulary
// AND in `omrMints`. A live database holds the rows this faucet already wrote, and the conservation
// identity is a statement about the WHOLE ledger, not about what still runs — drop the reason and
// every server that ever paid a wage drifts by exactly what it paid. What changes is that nothing
// writes a new one, and `invariants.js` now asserts that directly (`emission faucet retired`),
// which is wall 1 made checkable rather than promised.
import { GameError } from './game.js';

// The board is kept as a TOMBSTONE rather than a 404 so a client — ours, or an agent that has been
// polling /v1/wage — learns what happened instead of guessing (the v2 `swap`/`launder` precedent).
export function wageBoard() {
  throw new GameError('retired',
    'The Street Wage is gone. The game no longer prints $OMR — every $OMR in the city was bought or '
    + 'taken from somebody who bought it. Earn cash on the street, and take theirs.');
}

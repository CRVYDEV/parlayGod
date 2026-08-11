// OMERTÀ — sizing the buy keeper's walls (brokers step 5, `omerta-brokers-design.md` §3.2 wall 3).
//
// The design leaves ONE number unset and says so plainly: *"the multiple itself is unsized and should
// get the `tools/bond-dials.js` treatment before it is picked — the equivalent number there turned out
// to be a function of pool depth rather than of supply, and guessing it here would be inventing
// balance."* This is that treatment. Pure arithmetic, no server, no DB, no chain.
//
// Run: node tools/keeper-dials.js
//
// ── WHAT THE KEEPER DOES, so the walls have something to bound ───────────────────────────────────
// It spends treasury ETH (`stockBudget().spendableEth`) on tokenized stock, and every fill is
// ingested by `recordStockBuy`, which stores `price_eth_per_unit`. Wall 3 is a PER-BUY price
// continuity bound: refuse a fill whose rate is more than some multiple of the last print, so a
// fat-finger, a stale feed or a leaked keeper key cannot buy at an absurd rate.
//
// ── THE FINDING, up front, because it inverts the obvious instinct ───────────────────────────────
// The instinct is "make the multiple TIGHT, because tight means safe". That is wrong here, and the
// reason is worth stating before any number: **the multiple does not bound the damage. Wall 4 does.**
// A keeper that spends its whole budget at a terrible rate has lost the budget either way; what the
// multiple changes is only how much of that spend was WASTED versus merely spent. So the binding
// consideration is the opposite one — a multiple too tight halts an honest keeper on ordinary market
// moves, and a keeper that has halted buys nothing at all, which is a worse outcome than buying
// slightly badly.
//
// So: size it for HONEST VOLATILITY first, and read the residual waste as the price of not halting.
import { BROKERS } from '../src/rules.js';

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const rows = [];
const say = (section, k, v, why) => rows.push({ section, k, v, why });

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 1. WHAT IS AN HONEST MOVE?  — this is what sets the floor under the multiple
// ══════════════════════════════════════════════════════════════════════════════════════════════
// The bounded quantity is ETH PER UNIT of a tokenized stock. That is a RATIO of two prices, and
// this is the single most important fact in the whole sizing:
//
//     price_eth_per_unit  =  stockUSD / ethUSD
//
// so it moves when EITHER leg moves, and a quiet stock does not make it quiet. ETH is by far the
// more volatile leg, which means the bound is really being set by ETH's vol, not the stock's — a
// keeper buying a blue chip still needs headroom sized for a crypto asset.
//
// Daily vols (lognormal, standard-issue figures; the conclusion is not sensitive to a point or two):
const SIGMA_STOCK_CALM = 0.015;   // a large-cap on an ordinary day
const SIGMA_STOCK_HOT = 0.035;    // a single-name high-beta (a TSLA-class mover)
const SIGMA_ETH = 0.045;          // ETH/USD, ordinary regime

// Independent-ish legs, so the ratio's vol is the quadrature sum. (Correlation is modest and
// positive in risk-off, which would REDUCE this — using the independent figure is conservative.)
const ratioSigma = (ss) => Math.sqrt(ss * ss + SIGMA_ETH * SIGMA_ETH);

// A lognormal move over `days` at `z` sigma, as a MULTIPLE of the starting price.
const move = (sigma, days, z) => Math.exp(z * sigma * Math.sqrt(days));

say('honest move', 'ratio vol, calm stock', `${pct(ratioSigma(SIGMA_STOCK_CALM))}/day`,
  `sqrt(${pct(SIGMA_STOCK_CALM)}² + ${pct(SIGMA_ETH)}²) — ETH dominates, so a blue chip is not a calm ratio`);
say('honest move', 'ratio vol, hot stock', `${pct(ratioSigma(SIGMA_STOCK_HOT))}/day`, 'a high-beta single name');

// How far can the ratio honestly travel between prints? The gap is what matters, and the gap is a
// function of how often the keeper buys — which is the epoch, unless it skips epochs.
const GAPS = [
  { days: BROKERS.EPOCH_DAYS, label: `one epoch (${BROKERS.EPOCH_DAYS}d)` },
  { days: BROKERS.EPOCH_DAYS * 2, label: 'a skipped epoch (14d)' },
  { days: 30, label: 'a month (a quiet quarter, or a paused keeper)' },
  { days: 90, label: 'a quarter (the keeper was off)' },
];
for (const g of GAPS) {
  const m = move(ratioSigma(SIGMA_STOCK_HOT), g.days, 4); // 4σ — the wall must not fire on ordinary tails
  say('honest move', `4σ over ${g.label}`, `${m.toFixed(2)}×`,
    'a wall that trips on a 4σ move will trip on a normal quarter — that is a halted keeper, not a caught attacker');
}

// And the fact that dominates all of the above: ETH does not move lognormally in a crisis.
// Real drawdowns, priced as what they do to a stock-per-ETH ratio (stock flat, ETH halves → 2×):
say('honest move', 'ETH −50% in a week (has happened repeatedly)', '2.00×', 'ratio doubles with the stock flat');
say('honest move', 'ETH −70% over a quarter (2018, 2022)', '3.33×', 'the regime the wall must survive without halting');

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 2. WHAT DOES A BAD RATE ACTUALLY COST?  — this is what sets the ceiling
// ══════════════════════════════════════════════════════════════════════════════════════════════
// If the true rate is P and the keeper pays P×F, the same ETH buys 1/F of the units. The ETH is
// gone either way (that is wall 4's business), so the LOSS is the units not received:
//
//     wasted fraction of the spend = 1 − 1/F
//
// Note what this is NOT: it is not "the attacker's profit". A leaked-key attacker selling the
// treasury an overpriced fill profits by the overpayment, but a fat-finger or a broken feed profits
// nobody — the value simply evaporates. Sizing on damage rather than on attacker P&L is the
// bond-dials lesson, and it applies here for the same reason: a griefer needs no profit.
for (const F of [1.5, 2, 3, 5, 10]) {
  say('cost of a bad rate', `at ${F}× the fair rate`, pct(1 - 1 / F), 'of that buy\'s ETH is wasted');
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 3. THE DESIGN POINT — and the first answer I got wrong, because it is the instructive one
// ══════════════════════════════════════════════════════════════════════════════════════════════
// The obvious move from sections 1 and 2 is to demand the bound never fire on an honest move, pick
// 4σ, notice a fixed number cannot cover both a frequent-print case and a long gap, and scale the
// bound with elapsed time: `BASE ^ sqrt(Δ/EPOCH)`. That is what I wrote first. Running it kills it —
// it yields 6.7× at a month and 26.7× at a quarter, and a 26× "bound" is not a bound, it is a
// formality with a comment attached.
//
// The error was in the design point, not the arithmetic. **A false halt is CHEAP and a loose bound
// is EXPENSIVE**, and those are not symmetric costs:
//
//   - bound fires wrongly → the keeper does not buy this epoch, and a human looks at why. The
//     treasury still holds its ETH. Nothing is lost but time, and the epoch allocator does not
//     depend on a buy having happened.
//   - bound is too loose  → real treasury ETH buys few units, permanently, and NO CHECK CATCHES IT
//     (see the scope note below — `allocated ≤ held` stays true the whole time).
//
// So the bound should NOT try to accommodate every honest move. It should accommodate ORDINARY ones
// and deliberately halt on extraordinary ones — because after a 3× move in stock/ETH, a bot buying
// straight through it is exactly the behaviour you do not want. A human re-baselines with a small
// deliberate fill and the keeper resumes. That also disposes of the long-gap problem without any
// scaling: a stale print does not earn a wider bound, it earns a halt.
const MULT = 2.0;
say('recommendation', 'MAX_PRICE_JUMP', `${MULT}×`,
  `covers 3σ over an epoch (${move(ratioSigma(SIGMA_STOCK_HOT), BROKERS.EPOCH_DAYS, 3).toFixed(2)}×) and an ETH-halving week (2.00×); wastes at most ${pct(1 - 1 / MULT)} of one buy`);
say('recommendation', 'anything past it', 'halt, do not widen',
  'a 3x move in stock/ETH is a regime change — the right response is a human re-baselining, not a bot buying through it');

// The staleness half of wall 3 is a SEPARATE dial and must not be conflated with the multiple: a
// bound that merely widens with age is not fail-closed, which is the trap the first cut fell into.
const MAX_AGE_D = 30;
say('recommendation', 'MAX_PRICE_AGE_DAYS (fail-closed)', `${MAX_AGE_D}d`,
  'past this the print is not a price. Halt — the OmrTwapOracle / vault-oracle discipline, where no fallback price is the whole point');
say('recommendation', 'FIRST BUY (no print at all)', 'refuse',
  'there is nothing to be continuous with; seed the first print with a deliberate, small, mod-driven fill');

// The lower side. A rate far BELOW the last print is not a bargain, it is a signal — the desk sized
// exactly this and called it the fat-finger floor, and the RWA float shipped the bug it prevents.
const FLOOR = 0.2;
say('recommendation', 'MIN_PRICE_FRAC (the floor)', `${FLOOR}× the last print`,
  'a rate an order of magnitude cheap is a broken feed or a fake token, not a bargain (the desk PRICE_FLOOR_BPS precedent)');

// ── what this dial does NOT do, said plainly so nobody counts it twice ──
say('scope', 'the damage bound is wall 4, not this', 'ethToSpend ≤ spendableEth',
  'this dial bounds the WASTE RATE of one buy; the amount at risk is the budget, and that is a different wall');
say('scope', 'the wall this protects is not allocated ≤ held', 'units are units',
  'buying few units for much ETH keeps that wall true — it destroys treasury value without breaking a check, which is why a check alone would never catch it');

// ══════════════════════════════════════════════════════════════════════════════════════════════
const w = (s, n) => String(s).padEnd(n);
let last = '';
console.log('\nTHE KEEPER DIALS — sizing wall 3 (brokers step 5)\n');
for (const r of rows) {
  if (r.section !== last) { console.log(`\n━━ ${r.section} ━━`); last = r.section; }
  console.log(`  ${w(r.k, 46)} ${w(r.v, 14)} ${r.why ? `(${r.why})` : ''}`);
}
console.log(`
━━ the sentence ━━
  ${MULT}× the last print, halt past it, and refuse a print older than ${MAX_AGE_D}d.

  The bounded quantity is stock/ETH, so ETH's volatility sets it even for a blue chip — a "calm"
  blue chip still moves ${pct(ratioSigma(SIGMA_STOCK_CALM))} a day against ETH. But the bound is
  NOT sized to never fire on an honest move, and that is the point: a false halt costs a delayed
  buy, while a loose bound costs real ETH that NO invariant catches, because buying few units for
  much ETH leaves every wall true. Asymmetric costs, so bound the ordinary case and let the
  extraordinary one stop the bot and fetch a human.
`);

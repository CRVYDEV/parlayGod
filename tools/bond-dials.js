// OMERTÀ — sizing the four bond dials (tokenomics v2 step 4 + the accretion oracle).
//
// `OmertaBond.dailyCapOMR`, `maxOmrPerEth`, `priceToleranceBps` and `OmrTwapOracle.PERIOD` are all
// unset and all block a real deploy. CHAIN-DEPLOY.md says "set them small", which is advice, not a
// number. This works out the numbers from first principles and prints the reasoning, so a founder
// can accept or move each one knowing what it buys.
//
// THE THREAT MODEL, stated once. The walls exist for exactly one attacker: someone holding the
// server's quote-signer key. That attacker can sign any quote they like — but they must still PAY
// the ETH (`bond()` requires msg.value == principal) and they must still sell the OMR to realise
// anything. So this is not "how much can they steal", it is "how much better than market can they
// buy, how much can they buy, and what do they net after the exit". Every dial below is one of
// those three questions.
//
// Run: node tools/bond-dials.js        (pure arithmetic — no server, no DB, no chain)
import { BONDS, SELL_TAX } from '../src/rules.js';

const SUPPLY = 100_000_000;          // OMR.SUPPLY — the founding mint, and the yardstick for "how much is a lot"
const LP_FEE = 0.003;                // Uniswap V2, each leg
const tax = SELL_TAX.BPS / 10000;    // the DEX sell tax — paid on the way OUT of OMR only
const maxDisc = BONDS.MAX_DISCOUNT_BPS / 10000;
const disc = BONDS.DISCOUNT_BPS / 10000;
const P0 = 5000;                     // OMR per ETH — the launch reference price (BONDS.ETH_SCORE_OMR)

const eth = (x) => `${x < 1 ? x.toFixed(3) : x.toFixed(1)} ETH`;
const pct = (x) => `${(x * 100).toFixed(Math.abs(x) < 0.01 ? 3 : 1)}%`;
const rows = [];
const say = (section, k, v, why) => rows.push({ section, k, v, why });

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 1. WHAT DOES MOVING THE TWAP COST?  — this decides PERIOD and priceToleranceBps
// ══════════════════════════════════════════════════════════════════════════════════════════════
// To make the oracle read a HIGHER omrPerEth (which is what lets an inflated quote through), the
// attacker must make OMR cheaper: dump OMR into the pool. On a constant-product pool, moving the
// price by a factor k means moving each reserve by sqrt(k):
//     M -> M*sqrt(k)   (they add OMR)      E -> E/sqrt(k)   (they take ETH)
//
// If they later restore the price, they get their OMR back and return the ETH — so the round trip
// nets out EXCEPT for what the pool kept. And here OMERTÀ has something most tokens do not: the
// 9% DEX SELL TAX. Manipulation upward REQUIRES selling, so it pays the tax, and the tax is not
// recoverable on the way back. That single fact is most of the cost.
//
// LOWER BOUND, and deliberately so: this assumes ZERO arbitrage — nobody trades against the
// manipulated price for the whole window. Reality is worse for the attacker (arbitrageurs restore
// the price and the attacker must re-push, paying again). A wall that holds against the lower
// bound holds, full stop; one that fails against it is relying on arbitrage that may not show up
// in a thin market at 4am.
function manipulationCost(ethDepth, k) {
  const sqrtK = Math.sqrt(k);
  const omrIntoPool = ethDepth * (sqrtK - 1);          // in ETH-equivalent at the true price
  const taxPaid = (tax / (1 - tax)) * omrIntoPool;     // grossed up: they must SEND more to land this much
  const fees = LP_FEE * omrIntoPool * 2;               // both legs of the round trip
  const slip = ethDepth * (sqrtK + 1 / sqrtK - 2);     // the curve's own bite, not recovered
  return taxPaid + fees + slip;
}

// The TWAP is a time-average, so holding a k-times price for a FRACTION of the window moves the
// reading by only that fraction: delta = (k-1) * t/T. An attacker who wants a 5% reading shift can
// either hold +5% for the whole window or +50% for a tenth of it. Both are priced below.
function costForShift(ethDepth, delta, holdFraction) {
  const k = 1 + delta / holdFraction;                  // the spot move needed to average out to `delta`
  return { k, cost: manipulationCost(ethDepth, k) };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 2. WHAT IS THE MANIPULATION WORTH?  — this is what the cost has to beat
// ══════════════════════════════════════════════════════════════════════════════════════════════
// The attacker's edge WITHOUT touching the oracle is the discount itself. Beating the oracle by
// `delta` multiplies the OMR they get by (1+delta) — so the marginal value of manipulation is the
// difference between those two, NOT the whole haul. This turns out to matter enormously.
function attackerEdge(haulOmr, delta, discount, ethDepth, omrDepth) {
  const paperEth = haulOmr / P0;                       // what the haul is worth at the true price
  const paid = haulOmr * (1 - discount) / (P0 * (1 + delta)); // ETH they had to put in
  // THE EXIT. They must sell into the same pool, paying the 9% tax and their own slippage. A haul
  // that is large relative to the pool's OMR reserve is largely un-realisable — which is why the
  // daily cap should be sized against POOL DEPTH and not only against supply.
  const netIn = haulOmr * (1 - tax) * (1 - LP_FEE);
  const realisedEth = (ethDepth * netIn) / (omrDepth + netIn);
  return { paperEth, paid, paperProfit: paperEth - paid, realisedProfit: realisedEth - paid,
    realisedRatio: realisedEth / paperEth };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n══════════ SIZING THE BOND DIALS ══════════');
console.log(`reference price ${P0} OMR/ETH · sell tax ${pct(tax)} · quoted discount ${pct(disc)} · max discount ${pct(maxDisc)}\n`);

// ── the cost table ────────────────────────────────────────────────────────────────────────────
console.log('COST TO MOVE THE TWAP (lower bound: assumes NOBODY arbitrages against it)\n');
console.log('  pool (ETH side) │  +2% reading  │  +5% reading  │ +20% reading  │ +100% reading');
console.log('  ────────────────┼───────────────┼───────────────┼───────────────┼──────────────');
const depths = [25, 100, 500, 2500];
for (const d of depths) {
  const c = [0.02, 0.05, 0.20, 1.00].map((x) => eth(costForShift(d, x, 1).cost).padStart(12));
  console.log(`  ${String(d).padStart(9)} ETH   │ ${c[0]}  │ ${c[1]}  │ ${c[2]}  │ ${c[3]}`);
}
console.log('\n  Held for the WHOLE window. Holding a bigger spike briefly costs more, not less:');
const brief = costForShift(100, 0.05, 0.1);
console.log(`  a 100-ETH pool, +5% reading via a ${brief.k.toFixed(2)}x spike over a tenth of the window: ${eth(brief.cost)}`
  + ` vs ${eth(costForShift(100, 0.05, 1).cost)} held throughout — so a longer PERIOD raises the floor, it does not create a shortcut.\n`);

// ── what it buys ──────────────────────────────────────────────────────────────────────────────
console.log('WHAT THAT MANIPULATION IS WORTH (at the max 20% discount, so the attacker\'s best case)\n');
console.log('  daily cap │ pool ETH │   ETH in   │ paper edge │ realised edge │ manip. adds │ cost to manip.');
console.log('  ──────────┼──────────┼────────────┼────────────┼───────────────┼─────────────┼───────────────');
const caps = [50_000, 100_000, 500_000];
for (const cap of caps) {
  for (const d of [100, 500]) {
    const omrDepth = d * P0;
    const withOut = attackerEdge(cap, 0, maxDisc, d, omrDepth);
    const withIn = attackerEdge(cap, 0.05, maxDisc, d, omrDepth);
    const marginal = withIn.realisedProfit - withOut.realisedProfit;
    const cost = costForShift(d, 0.05, 1).cost;
    console.log(`  ${String(cap).padStart(8)}  │ ${String(d).padStart(7)}  │ ${eth(withOut.paid).padStart(10)} │`
      + ` ${eth(withOut.paperProfit).padStart(10)} │ ${eth(withOut.realisedProfit).padStart(13)} │`
      + ` ${eth(marginal).padStart(11)} │ ${eth(cost).padStart(13)}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 3. DAMAGE IS NOT THE ATTACKER'S PROFIT  — and this is what actually sizes the daily cap
// ══════════════════════════════════════════════════════════════════════════════════════════════
// The table above shows the attack going NEGATIVE at larger caps: the exit slippage and the 9% tax
// eat the whole discount. It is tempting to read that as "the cap is self-limiting". It is not, and
// sizing the cap on attacker profitability would be a category error: a griefer does not need to
// profit, and anyone short elsewhere profits FROM the crash rather than from the bond. So the cap
// must be sized against DAMAGE DONE, not against gain taken.
//
// Damage has two parts, and the second dominates at any realistic launch depth:
//   * supply dilution — cap / total supply, permanent
//   * price impact — dumping a day's cap into the pool. On a constant-product pool, adding OMR to
//     take ETH moves the price by (M'/M)^2, so this bites much harder than the dilution does.
function damage(capOmr, ethDepth) {
  const omrDepth = ethDepth * P0;
  const netIn = capOmr * (1 - tax) * (1 - LP_FEE);
  const priceRatio = ((omrDepth + netIn) / omrDepth) ** 2;   // OMR gets this many times cheaper
  return { dilution: capOmr / SUPPLY, priceImpact: priceRatio - 1 };
}
// Inverted: the cap whose full dump moves the price by no more than `target`.
function capForImpact(ethDepth, target) {
  const omrDepth = ethDepth * P0;
  const netIn = omrDepth * (Math.sqrt(1 + target) - 1);
  return netIn / ((1 - tax) * (1 - LP_FEE));
}

console.log('\nDAMAGE FROM ONE DAY AT THE CAP (a griefer does not need the attack to be profitable)\n');
console.log('  daily cap │ pool ETH │ supply dilution │ price impact of dumping it');
console.log('  ──────────┼──────────┼─────────────────┼───────────────────────────');
for (const cap of [25_000, 50_000, 100_000, 500_000]) {
  for (const d of [100, 500]) {
    const dm = damage(cap, d);
    console.log(`  ${String(cap).padStart(8)}  │ ${String(d).padStart(7)}  │ ${pct(dm.dilution).padStart(15)} │ ${('OMR ' + pct(dm.priceImpact) + ' cheaper').padStart(26)}`);
  }
}
console.log('\n  Inverted — the cap whose full dump costs at most a 10% price move:');
for (const d of depths) console.log(`    ${String(d).padStart(5)}-ETH pool -> ${Math.round(capForImpact(d, 0.10)).toLocaleString().padStart(9)} OMR/day  (~${pct(capForImpact(d, 0.10) / (d * P0))} of the pool's OMR reserve)`);

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE FINDINGS
// ══════════════════════════════════════════════════════════════════════════════════════════════
const d100 = attackerEdge(100_000, 0, maxDisc, 100, 100 * P0);
say('finding', 'the discount dwarfs the oracle', `${pct(maxDisc)} vs ${pct(0.05)}`,
  `a leaked signer's edge comes overwhelmingly from MAX_DISCOUNT_BPS, not from beating the oracle: at the cap they already buy OMR ${pct(maxDisc / (1 - maxDisc))} under market before touching any feed. Moving the TWAP 5% adds only a few points on top. So the oracle tolerance is a SECOND-ORDER dial and MAX_DISCOUNT_BPS is a first-order one`);
say('finding', 'the exit is the real wall', `${pct(d100.realisedRatio)} of paper realised`,
  `dumping a 100,000-OMR haul into a 100-ETH pool pays the ${pct(tax)} sell tax AND craters the price it is selling into. A cap that lets someone mint a large fraction of the pool's OMR reserve is a cap whose damage is mostly self-inflicted on exit — which is why the daily cap should be sized against POOL DEPTH, not only against the ${(SUPPLY / 1e6)}M supply`);
say('finding', 'the attack goes NEGATIVE at large caps — do not rely on it', 'exit slippage + the tax',
  `at a 100-ETH pool a 500,000-OMR haul realises ${eth(attackerEdge(500_000, 0, maxDisc, 100, 100 * P0).realisedProfit)} — the attacker LOSES money because the exit craters the price they are selling into. Tempting to call the cap self-limiting; it is not. A griefer does not need to profit, and anyone short elsewhere profits from the crash instead. Size the cap on DAMAGE, never on the attacker's P&L`);
say('finding', 'the sell tax is an anti-manipulation tax', `${pct(tax)} on every push`,
  `manipulating the oracle UPWARD requires SELLING OMR, and selling pays the DEX tax, which the round trip never recovers. Most tokens' TWAP-manipulation cost is slippage alone; here it is slippage plus a hard ${pct(tax)}. This was not designed for that and is worth knowing before anyone proposes lowering it`);

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE RECOMMENDATIONS
// ══════════════════════════════════════════════════════════════════════════════════════════════
const capRec = Math.round(capForImpact(100, 0.10) / 1000) * 1000;
say('dial', 'dailyCapOMR', `${capRec.toLocaleString()} OMR/day at a 100-ETH pool — i.e. ~5% of the pool's OMR reserve`,
  `NOT a fixed number: a RULE, because the binding constraint is pool depth and that will change. Sized so a full day at the cap moves the price by at most ~10% if it is all dumped (${pct(damage(capRec, 100).priceImpact)} here) — the damage metric that matters, since a griefer need not profit. As a share of supply it is only ${pct(capRec / SUPPLY)}, which is why "% of supply" is the WRONG anchor and would have suggested a cap ~4x too large. It still funds ~${eth(capRec * (1 - disc) / P0)}/day of honest bonding, far above any plausible launch week. Re-derive it whenever POL materially deepens: \`node tools/bond-dials.js\``);
say('dial', 'maxOmrPerEth', `${(P0 * 3).toLocaleString()} OMR/ETH (3x the launch price)`,
  `this is a CIRCUIT BREAKER, not a price. It exists for one case: the oracle itself is lying. Set it where it NEVER binds in normal trade (the honest max rate is price x (1+tol) / (1-maxDisc) = ${Math.round(P0 * 1.05 / (1 - maxDisc)).toLocaleString()}) but does bind on a manipulated feed. 3x leaves room for real volatility. OPERATIONAL NOTE: if OMR falls hard, the honest rate rises and this must be raised with it or bonding stops — a deliberate fail-closed, but somebody has to be watching`);
say('dial', 'priceToleranceBps', '500 (5%)',
  `a TWAP LAGS spot, so zero tolerance rejects honest quotes exactly when the market is moving. 5% covers ordinary intra-window drift. The cost table says a 5% shift on a 100-ETH pool costs ~${eth(costForShift(100, 0.05, 1).cost)} to buy — cheap in isolation, which is why this is not the wall that matters; maxOmrPerEth is. Setting it to 0 makes the rule literally accretive and is a legitimate choice if you are willing to let bonding stall during volatility`);
say('dial', 'OmrTwapOracle.PERIOD', '30 minutes',
  `the floor is 10 min (compile-time). Longer = costlier to manipulate and slower to track a real move. 30 min is roughly where the cost curve stops improving quickly for a thin pool while the lag stays inside what a ${pct(0.05)} tolerance absorbs. Revisit UPWARD if the pool stays thin; the pool depth, not the clock, is what actually makes this expensive`);
say('dial', 'maxOracleAge', '90 minutes (with a 30-min keeper)',
  `must exceed the keeper interval or a single late poke halts bonding; must not be so loose that a dead keeper leaves the mint running on an hours-old price during a crash. 3x the poke interval tolerates two consecutive misses and no more`);

// ══════════════════════════════════════════════════════════════════════════════════════════════
// WHAT THIS PASS FOUND THAT IS NOT A DIAL
// ══════════════════════════════════════════════════════════════════════════════════════════════
say('flag', 'there is no MINIMUM vest', 'vestSeconds >= 1 is legal',
  `OmertaBond checks only 'vestSeconds == 0 || > MAX_VEST', and the quote (which the attacker signs) chooses it. So a leaked signer sets vestSeconds = 1 and claims in the next second — the vesting that would otherwise buy the Safe time to notice is optional and the attacker picks it. AND claim() has no whenNotPaused, so pausing does not stop a claim either. Neither is a hole on its own; together they mean the daily cap is realised IMMEDIATELY, which is the assumption the cap should be sized under (and is, above). A MIN_VEST would be a one-line change and is a founder/audit call, not something to slip in`);
say('flag', 'the backend clamps to the CEILING, not the price', 'quoteBond',
  `when our own feed reads above the chain's, quoteBond clamps to oracle x (1+tolerance) — the most generous quote the wall permits — so drift always resolves toward MORE OMR per ETH. Clamping to the oracle price itself would resolve it the other way. Defensible either way; worth deciding deliberately rather than by accident`);

console.log('\n══════════ FINDINGS ══════════');
for (const r of rows.filter((x) => x.section === 'finding')) console.log(`\n• ${r.k} — ${r.v}\n  ${r.why}`);
console.log('\n══════════ RECOMMENDED SETTINGS ══════════');
for (const r of rows.filter((x) => x.section === 'dial')) console.log(`\n• ${r.k} = ${r.v}\n  ${r.why}`);
console.log('\n══════════ FLAGGED (not dials — founder/audit calls) ══════════');
for (const r of rows.filter((x) => x.section === 'flag')) console.log(`\n• ${r.k} — ${r.v}\n  ${r.why}`);
console.log('\nAssumptions, stated so they can be argued with: no arbitrage against the manipulation (a');
console.log('LOWER bound on its cost), one attacker, gas ignored, immediate exit, and a single pool.');
console.log('Every number scales with POOL DEPTH — thin liquidity is what makes an oracle cheap to move,');
console.log('so the strongest thing that can be done for these walls is not a dial at all: it is POL.\n');

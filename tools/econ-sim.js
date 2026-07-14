// Macro-economy simulation for OMERTÀ. Reuses the REAL rules.js tables and the real
// crime/accrual/swap formulas (cited inline) to model faucet vs sink flow, $OMR mint
// rate, AMM depth, and withdrawal-reserve demand. It CHANGES NO game balance — it only
// computes with the shipped numbers to make the macro loop visible (ground rule #1).
//
// The archetype assumptions (stats, play intensity) are explicit and tunable at the top;
// this is a model, not a prediction. Its job is to reveal STRUCTURE, not exact values.
//
//   node tools/econ-sim.js            # console summary
//   node tools/econ-sim.js --json     # also writes econ-sim.json for the chart artifact
import { CRIMES, RACKETS, ASSETS, MISSIONS, CONSTANTS, levelOf, rankIdxOf } from '../src/rules.js';

const HOUR = 60; // minutes
const avg = (lo, hi) => (lo + hi) / 2;

// ── faithful sub-formulas (mirrors src/game.js doCrime + src/accrual.js §7.1) ──
const bestCrimeAt = (lvl) => [...CRIMES].reverse().find((c) => c.lvl <= lvl) || CRIMES[0];
function crimeEVPerAttempt(lvl, cunning, speed) {
  const c = bestCrimeAt(lvl);
  const rIdx = rankIdxOf(lvl);
  const chance = Math.min(0.97, c.base + cunning * 0.004 + speed * 0.002 + (rIdx >= 9 ? 0.02 : 0));
  const take = avg(c.cash[0], c.cash[1]) * (rIdx >= 1 ? 1.05 : 1) * (rIdx >= 8 ? 1.10 : 1); // event mult ~1 on avg
  return { c, chance, evCash: chance * take, evRespect: chance * c.respect };
}
// nerve-limited attempts/day: maxNerve regens at 20/min (§7.1); each job costs c.nerve
function crimeAttemptsPerDay(lvl, activeHours) {
  const c = bestCrimeAt(lvl);
  return Math.floor((activeHours * HOUR * 20) / c.nerve); // regen-bound
}
// racket + front income per minute for the top-K rackets a level can own (§7.1)
function racketIncomePerMin(lvl, cash) {
  const affordable = RACKETS.filter((r) => lvl >= r.lvl); // owns everything unlocked (whale assumption)
  const rk = affordable.reduce((a, r) => a + r.income, 0);
  const rIdx = rankIdxOf(lvl);
  return rk * (rIdx >= 7 ? 1.10 : 1); // ledger path (+10%) and turf (+15%) omitted → conservative
}

// ── archetypes (tunable) ──
const ARCHETYPES = [
  { name: 'Casual',  lvl: 15,  stat: 40,  activeHours: 1,  racketHours: 8,  ownsRackets: false, stakedOmr: 0,   swapsCashPct: 0.5 },
  { name: 'Grinder', lvl: 50,  stat: 160, activeHours: 4,  racketHours: 20, ownsRackets: true,  stakedOmr: 50,  swapsCashPct: 0.7 },
  { name: 'Whale',   lvl: 110, stat: 340, activeHours: 8,  racketHours: 24, ownsRackets: true,  stakedOmr: 2000, swapsCashPct: 0.8 },
  // a bot farm: agent throttle is 1 action / 3s = 1200 crimes/hr, run 24/7, mid level
  { name: 'Bot farm', lvl: 40, stat: 120, activeHours: 24, racketHours: 24, ownsRackets: true, stakedOmr: 0, swapsCashPct: 1.0, botCapPerHr: 1200 },
];

function dailyForArchetype(a) {
  const { evCash } = crimeEVPerAttempt(a.lvl, a.stat, a.stat);
  let attempts = crimeAttemptsPerDay(a.lvl, a.activeHours);
  if (a.botCapPerHr) attempts = Math.min(attempts, a.botCapPerHr * a.activeHours); // agent throttle
  const crimeCash = attempts * evCash;

  const racketCash = a.ownsRackets ? racketIncomePerMin(a.lvl, 0) * HOUR * a.racketHours : 0;

  // other cash faucets (§5.1): checkin ~250*lvl + streak, heist 1200*lvl (8h cd → ~1/day)
  const checkinCash = 250 * a.lvl + 100 * a.lvl * 7;
  const heistCash = 1200 * a.lvl + 200 * a.lvl; // avg
  const dailyContractCash = 700 * a.lvl; // ~all-three envelope

  const faucetCash = crimeCash + racketCash + checkinCash + heistCash + dailyContractCash;

  // cash sinks: travel (flat $250), heal (~occasional), the 2% swap house-take
  const travelSink = 250 * a.activeHours;               // ~1 trip/active hour
  const healSink = 1500 * a.activeHours;                // rough Doc usage
  const swapCash = faucetCash * a.swapsCashPct;         // cash they route into $OMR
  const swapHouseTake = swapCash * 0.02;                // 1% dev + 1% street tax
  const sinkCash = travelSink + healSink + swapHouseTake;

  const netCash = faucetCash - sinkCash;

  // $OMR minted/day: staking (14% APY, DIRECT mint) + amortized missions (DIRECT mint).
  // (daily/referral $OMR is recycled from the street-tax fund → bounded, not counted here.)
  const stakeOmr = a.stakedOmr * CONSTANTS.APY / 365;
  const missionOmrTotal = MISSIONS.reduce((s, m) => s + (m.reward.omr || 0), 0); // one-time lifetime
  const missionOmrPerDay = a.lvl >= 110 ? missionOmrTotal / 90 : (a.lvl >= 50 ? missionOmrTotal * 0.4 / 90 : 0);
  const omrMintedPerDay = stakeOmr + missionOmrPerDay;

  return { ...a, attempts, crimeCash, racketCash, faucetCash, sinkCash, netCash, swapCash, omrMintedPerDay };
}

// ── AMM depth stress (§7.12): pool seeded 10M cash / 20k OMR ──
function ammSwap(cashIn, pool = { c: 10_000_000, o: 20_000 }) {
  const fee = cashIn * 0.02, netIn = cashIn - fee;
  const k = pool.c * pool.o;
  const out = pool.o - k / (pool.c + netIn);
  const newC = pool.c + netIn, newO = pool.o - out;
  return { omrOut: out, priceBefore: pool.c / pool.o, priceAfter: newC / newO, poolOmrLeft: newO };
}

const rows = ARCHETYPES.map(dailyForArchetype);
const fmt = (n) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${Math.round(n)}`;

console.log('\n══════ PER-PLAYER DAILY FLOW (model — assumptions at top of file) ══════');
console.log('archetype   lvl   crimes/day   crime$     racket$/day   faucet$/day   sink$/day   NET$/day   faucet÷sink');
for (const r of rows) {
  const ratio = r.sinkCash > 0 ? (r.faucetCash / r.sinkCash).toFixed(0) : '∞';
  console.log(
    `${r.name.padEnd(10)} ${String(r.lvl).padStart(4)}  ${String(r.attempts).padStart(10)}  ${fmt(r.crimeCash).padStart(9)}  ${fmt(r.racketCash).padStart(11)}  ${fmt(r.faucetCash).padStart(11)}  ${fmt(r.sinkCash).padStart(9)}  ${fmt(r.netCash).padStart(9)}   ${String(ratio).padStart(6)}×`);
}

console.log('\n══════ AMM DEPTH: one day of a whale\'s cash routed into the 10M/20k pool ══════');
const whale = rows.find((r) => r.name === 'Whale');
const s = ammSwap(whale.swapCash);
console.log(`whale swaps ${fmt(whale.swapCash)} → ${s.omrOut.toFixed(0)} OMR`);
console.log(`OMR price $${s.priceBefore.toFixed(0)} → $${s.priceAfter.toFixed(0)} (${((s.priceAfter / s.priceBefore - 1) * 100).toFixed(0)}% in ONE swap); pool OMR left: ${s.poolOmrLeft.toFixed(0)} / 20000`);

console.log('\n══════ $OMR MINT vs WITHDRAWAL RESERVE (fractional-reserve check) ══════');
// a modest cohort: 10k casual, 2k grinders, 200 whales, 100 bot farms
const cohort = [['Casual', 10000], ['Grinder', 2000], ['Whale', 200], ['Bot farm', 100]];
let omrMintDay = 0, netCashDay = 0;
for (const [name, n] of cohort) {
  const r = rows.find((x) => x.name === name);
  omrMintDay += r.omrMintedPerDay * n;
  netCashDay += r.netCash * n;
}
console.log(`cohort: ${cohort.map(([n, c]) => `${c} ${n}`).join(', ')}`);
console.log(`net CASH created/day across cohort: ${fmt(netCashDay)}  (this is the inflation pressure)`);
console.log(`DIRECT $OMR minted/day (staking + missions): ${omrMintDay.toFixed(0)} OMR`);
console.log(`  → 90-day mint: ${(omrMintDay * 90).toFixed(0)} OMR of withdrawal liability the treasury must back`);
console.log(`  → vs OMR total supply 100,000,000 and AMM pool 20,000. Any tranche funded < the mint rate = fractional reserve.`);
console.log('\n(These are structural signals, not forecasts. Tune the archetype table to taste.)\n');

if (process.argv.includes('--json')) {
  const fs = await import('node:fs');
  const out = {
    perPlayer: rows.map((r) => ({ name: r.name, lvl: r.lvl, crimesDay: r.attempts,
      crimeCash: Math.round(r.crimeCash), racketCash: Math.round(r.racketCash),
      faucet: Math.round(r.faucetCash), sink: Math.round(r.sinkCash), net: Math.round(r.netCash),
      ratio: r.sinkCash > 0 ? Math.round(r.faucetCash / r.sinkCash) : null,
      omrDay: +r.omrMintedPerDay.toFixed(2) })),
    amm: { swapIn: Math.round(whale.swapCash), omrOut: Math.round(s.omrOut),
      priceBefore: Math.round(s.priceBefore), priceAfter: Math.round(s.priceAfter), poolLeft: Math.round(s.poolOmrLeft) },
    reserve: { omrMintDay: Math.round(omrMintDay), omr90: Math.round(omrMintDay * 90), netCashDay: Math.round(netCashDay) },
  };
  fs.writeFileSync(new URL('../econ-sim.json', import.meta.url), JSON.stringify(out, null, 2));
  console.log('wrote econ-sim.json');
}

// OMERTÀ economy simulation — drives the REAL server (pg-mem, in-process) through the PUBLIC API.
//
// THE RULE: value (cash/bank/$OMR/cb/ammo/cars/treasuries) is NEVER SQL-seeded — every dollar is
// earned through routes, so the §10.4 invariant sweep at the end must hold EXACTLY; any drift is a
// real leak found by simulation. Non-value state (clocks, energy, nerve, respect, heat, stats,
// jail) is freely warped to compress time — that's the same §7.1 lazy-accrual contract the tests
// use, it just makes days pass in milliseconds.
//
// Run: node tools/sim.js   (exits non-zero if any §10.4 check drifts)
process.env.MOD_KEY = 'sim-mod-key';
process.env.ALLOW_MOD_REAL_REVENUE = 'on'; // QA harness: let the mod fee-record drive the real Vig flywheel (D-MED2 gate)
process.env.SEARCH_MS = '0';   // §9 test knobs — the sim compresses hit timers (never in prod)
// SEASON PIN — the seasonal twist is ARMED in production since 2026-08-02 and its draw follows
// the real calendar. A harness whose figures mean something different depending on the week it
// was run is not a measurement, so the baseline is pinned. Run with SEASON_MOD=<id> to measure
// a specific season deliberately.
process.env.SEASON_MOD = process.env.SEASON_MOD || 'dead_quiet';
// …and the PHASE, for the same reason: THE SEASON HAS AN ENDING makes the last week of every
// season discount the turf floor and shorten the windows, derived from the real calendar. A run in
// the reckoning is measuring a different game than a run in week two.
process.env.SEASON_PHASE = process.env.SEASON_PHASE || 'long_game';
process.env.SHOOT_CD_MS = '0';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runBuyback } from '../src/worker.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { CRIMES, GUNS, CONSTANTS, M3, LOAN, btkOf,
         WORLD_NPCS, WORLD, BOXING, TERRITORY_RACKETS, TERRITORY_TYPES, territoryBuildCost,
         frontierTributePerHr, liberationCost, worldNpcOf, SPEAKEASY, PEN, RACES,
         PORT, boatOf, portRouteOf, interdictChance,
         CONVOY, DISTRICTS, goodPriceOf, STABLE , CLUES, BUSINESSES, PACING, POPULATION, boatResale, CORNER, CONTACTS, FAMILY_WAR,
         EXCHANGE, ESTATE, WIRE, GANG_SEALS, FOUNDATION, RIVALS, RACKETS, ASSETS, M4, DRUGS,
         MADE, ACCESS_STAKE, OPERATIONS, opSlotsOf, SOV,
         TREASURY, STORE, SELL_TAX, BONDS, MISSIONS } from '../src/rules.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body, headers } = {}) => {
  const res = await app.inject({ method, url,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers || {}) }, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const modH = { 'x-mod-key': 'sim-mod-key' };
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
const newChar = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  const r = await call('POST', '/v1/character', { token, body: { name } });
  assert.equal(r.code, 200, `character create: ${JSON.stringify(r.body)}`);
  return { token, id: r.body.id };
};
// state warps (never value)
const warp = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);
// levelOf inverse — reads the PACING divisor so the sim tracks the live curve instead of a
// hardcoded copy of it (this is what silently under-seeded every probe when the curve moved).
const lvlRespect = (lvl) => PACING.LEVEL_DIVISOR * (lvl - 1) * (lvl - 1);
const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

const metrics = [];
const note = (section, metric, value, comment = '') => {
  metrics.push({ section, metric, value, comment });
  console.log(`  ${metric}: ${value}${comment ? `   (${comment})` : ''}`);
};
const phase = (t) => console.log(`\n━━ ${t} ━━`);

// ════════════════ P1: THE GRINDER — honest street crime by level tier ════════════════
// Measures the observed $/attempt curve so every later payback number has a baseline.
phase('P1 grinder — the honest crime curve');
const g = await newChar('Sim Grinder');
const crimeTiers = [
  { id: 'stereo', lvl: 1 }, { id: 'poker', lvl: 11 }, { id: 'payroll', lvl: 30 },
  { id: 'counting', lvl: 58 }, { id: 'depository', lvl: 110 },
];
const crimeCurve = {};
for (const t of crimeTiers) {
  await warp(g.id, `respect=${lvlRespect(t.lvl + 2)}`);
  let earned = 0, wins = 0, jails = 0;
  const N = 40;
  for (let i = 0; i < N; i++) {
    await warp(g.id, "nerve=50, energy=200, jail_until=NULL, heat=0");
    const r = await call('POST', `/v1/crimes/${t.id}`, { token: g.token });
    if (r.body.success) { earned += r.body.take || 0; wins++; }
    else if (r.body.jailSeconds > 0) jails++;
  }
  crimeCurve[t.id] = earned / N;
  note('crime-curve', `${t.id} (lvl ${t.lvl})`, `$${fmt(earned / N)}/attempt`, `${wins}/${N} wins, ${jails} jailed`);
}
// A committed player: ~200 nerve-fueled attempts/day at their best crime.
const grindDay = crimeCurve.depository * 200;
note('crime-curve', 'top-tier grind ceiling', `$${fmt(grindDay)}/day`, '~200 attempts/day at depository');

// ════════════════ P2: PASSIVE INCOME — rackets vs assets vs businesses ════════════════
phase('P2 passive income — racket vs business payback (honest money only)');
// bankroll the grinder honestly at top tier until it can afford the comparison set
let cash = (await meOf(g.token)).cash;
let guard = 0;
while (cash < 1_600_000 && guard++ < 600) {
  await warp(g.id, "nerve=50, energy=200, jail_until=NULL, heat=0");
  const r = await call('POST', '/v1/crimes/depository', { token: g.token });
  if (r.body.success) cash += r.body.take || 0;
}
cash = (await meOf(g.token)).cash;
note('passive', 'grinder bankroll', `$${fmt(cash)}`, `${guard} extra crimes to fund the buys`);

// racket: laundro ($12.5k, $30/hr, D2b 12h/day bucket)
let r = await call('POST', '/v1/rackets/laundro/buy', { token: g.token });
assert.equal(r.code, 200, `racket buy: ${JSON.stringify(r.body)}`);
// 3 sim-days: one 24h warp + touch per day (bucket refills 12h/day)
let racketIncome = 0;
for (let d = 0; d < 3; d++) {
  const pre = (await meOf(g.token)).cash;
  await warp(g.id, "last_accrued_at = now() - interval '24 hours'");
  racketIncome += (await meOf(g.token)).cash - pre;
}
const racketPerDay = racketIncome / 3;
note('passive', 'laundro racket', `$${fmt(racketPerDay)}/day`, `payback ${fmt(12500 / (racketPerDay / 24))}h — the sim-audited baseline curve`);

// business: laundromat tier 1 ($250k, $12k/hr, 24h pending cap, no daily bucket)
r = await call('POST', '/v1/business/laundromat/buy', { token: g.token });
assert.equal(r.code, 200, `business buy: ${JSON.stringify(r.body)}`);
const bizId = r.body.id;
let bizIncome = 0;
for (let d = 0; d < 3; d++) {
  await pool.query(`UPDATE businesses SET last_collect_at = now() - interval '24 hours' WHERE id='${bizId}'`);
  const c = await call('POST', '/v1/business/collect', { token: g.token });
  bizIncome += c.body.collected || 0;
}
const bizPerDay = bizIncome / 3;
note('passive', 'laundromat t1 business', `$${fmt(bizPerDay)}/day`, `payback ${fmt(250000 / (bizPerDay / 24))}h`);
note('passive', 'business:racket dominance (gross)', `${fmt((bizPerDay / 250000) / (racketPerDay / 12500))}×`, 'daily-return-per-dollar ratio — >1 means businesses strictly dominate');

// RECURRING SINKS — "the pad": the sink exists to shrink exactly the passive stack measured
// above. Accrue 3 days of upkeep on the laundromat and pay it, then report the NET passive
// income + the net dominance ratio (does 20% actually close the gap?).
await pool.query(`UPDATE businesses SET upkeep_at = now() - interval '72 hours' WHERE id='${bizId}'`);
const upOwed = (await call('GET', '/v1/business', { token: g.token })).body.businesses.find((b) => b.id === bizId)?.upkeepOwed || 0;
const upPay = await call('POST', '/v1/business/upkeep', { token: g.token });
assert.equal(upPay.code, 200, `pay the pad: ${JSON.stringify(upPay.body)}`);
const upkeepPerDay = (upPay.body.paid || 0) / 3;
const netBizPerDay = bizPerDay - upkeepPerDay;
note('passive', 'laundromat upkeep (the pad)', `$${fmt(upkeepPerDay)}/day`, `${fmt(upkeepPerDay / bizPerDay * 100)}% of gross (owed $${fmt(upOwed)} over 3d) — the recurring sink`);
note('passive', 'laundromat NET of the pad', `$${fmt(netBizPerDay)}/day`, `payback ${fmt(250000 / (netBizPerDay / 24))}h net`);
note('passive', 'business:racket dominance (NET of pad)', `${fmt((netBizPerDay / 250000) / (racketPerDay / 12500))}×`, 'after upkeep — >1 still means businesses win, but by less');

// ════════════════ P3: THE KITCHEN — cook & deal ════════════════
phase('P3 kitchen — cook/deal margin');
const k = await newChar('Sim Cook');
await warp(k.id, `respect=${lvlRespect(12)}`);
// fund the cook honestly
guard = 0; cash = 0;
while (cash < 25000 && guard++ < 300) {
  await warp(k.id, "nerve=50, energy=200, jail_until=NULL, heat=0");
  const rr = await call('POST', '/v1/crimes/poker', { token: k.token });
  if (rr.body.success) cash += rr.body.take || 0;
}
const lab = await call('POST', '/v1/kitchen/lab/upgrade', { token: k.token }); // the bathtub
if (lab.code !== 200) note('kitchen', 'lab blocked', lab.body.error, lab.body.message || '');
let dealNet = 0, dealDays = 0;
for (let d = 0; d < 3; d++) {
  const pre = (await meOf(k.token)).cash;
  const mk = await call('POST', '/v1/kitchen/makings/vim', { token: k.token, body: { qty: 12 } });
  if (mk.code !== 200) { note('kitchen', 'makings blocked', mk.body.error, mk.body.message || ''); break; }
  const ck = await call('POST', '/v1/kitchen/cook', { token: k.token, body: { drugId: 'vim', qty: 12 } });
  if (ck.code !== 200) { note('kitchen', 'cook blocked', ck.body.error, ck.body.message || ''); break; }
  await pool.query(`UPDATE batches SET done_at = now() - interval '1 minute' WHERE character_id='${k.id}'`);
  await call('POST', '/v1/kitchen/collect', { token: k.token });
  await warp(k.id, "nerve=50, energy=200, heat=0, jail_until=NULL");
  const me1 = await meOf(k.token);
  const stashQty = (me1.stash.find((s) => s.drug === 'vim') || { qty: 0 }).qty;
  if (stashQty > 0) await call('POST', '/v1/kitchen/deal', { token: k.token, body: { drugId: 'vim', qty: stashQty } });
  dealNet += (await meOf(k.token)).cash - pre; dealDays++;
}
note('kitchen', 'vim cook+deal net', dealDays ? `$${fmt(dealNet / dealDays)}/cycle` : 'blocked', `${dealDays} cycles (entry-tier; scales with lab/rank)`);

// ════════════════ P4: THE KILL — full cost vs loot, rational vs careless victim ════════════════
phase('P4 kill economics — what a whack actually costs and pays');
const hunter = await newChar('Sim Hitman');
await warp(hunter.id, `respect=${lvlRespect(30)}, muscle=60, cunning=40, speed=40`);
// fund the hunter honestly (gun + ammo money + cb for the gun)
guard = 0;
while (((await meOf(hunter.token)).cash < 120000 || (await meOf(hunter.token)).cb < 6) && guard++ < 300) {
  await warp(hunter.id, "nerve=50, energy=200, jail_until=NULL, heat=0");
  await call('POST', '/v1/crimes/payroll', { token: hunter.token });
}
const gun = GUNS.find((x) => x.id === 'argument') || GUNS[GUNS.length - 1]; // fp 18, $18k, 3 crates
r = await call('POST', `/v1/armory/gun/${gun.id}/buy`, { token: hunter.token });
const gunOk = r.code === 200;
if (gunOk) await call('POST', `/v1/armory/gun/${gun.id}/equip`, { token: hunter.token });
// measure the ammo unit price once, honestly
let hunterMe = await meOf(hunter.token);
const preAmmoCash = hunterMe.cash, preAmmoRounds = hunterMe.ammo;
await call('POST', '/v1/armory/ammo', { token: hunter.token });
hunterMe = await meOf(hunter.token);
const perRound = (preAmmoCash - hunterMe.cash) / Math.max(1, hunterMe.ammo - preAmmoRounds);
note('kill', 'ammo price', `$${fmt(perRound)}/round`, `gun: ${gunOk ? `${gun.id} ($${fmt(gun.cash)})` : 'NONE'}`);

// the victim: a careless mid-level grinder with everything in pocket
const mark = await newChar('Sim Mark');
await warp(mark.id, `respect=${lvlRespect(12)}, muscle=5, speed=5`);
guard = 0;
while ((await meOf(mark.token)).cash < 40000 && guard++ < 200) {
  await warp(mark.id, "nerve=50, energy=200, jail_until=NULL, heat=0");
  await call('POST', '/v1/crimes/poker', { token: mark.token });
}
const markLive = await meOf(mark.token);
const markPocket = markLive.cash;
// one btk-clearing volley per attempt (a search is consumed by every shot — re-place each time).
// btk from the mark's LIVE level — the crime grind grew their respect past the warped baseline.
const btk = btkOf(markLive.level, 5);
const volley = Math.ceil(btk / ((0.7 + (gun.fp || 0) / 50) * 0.75)) + 50; // clears btk even jammed
let rounds = 0, killed = false, lootCash = 0, lootOmr = 0, attempts = 0;
while (!killed && attempts++ < 8) {
  guard = 0;
  while ((await meOf(hunter.token)).ammo < volley && guard++ < 300) {
    const a = await call('POST', '/v1/armory/ammo', { token: hunter.token });
    if (a.code !== 200) { // out of cash — earn more, honestly
      await warp(hunter.id, "nerve=50, energy=200, jail_until=NULL, heat=0");
      await call('POST', '/v1/crimes/payroll', { token: hunter.token });
    }
  }
  await warp(hunter.id, "energy=200, jail_until=NULL, shoot_cd_until=NULL, heat=0, loc='docks'");
  await warp(mark.id, "hosp_until=NULL, jail_until=NULL, loc='docks'");
  await call('POST', `/v1/streets/${mark.id}/search`, { token: hunter.token });
  const f = await call('POST', `/v1/streets/${mark.id}/fire`, { token: hunter.token, body: { rounds: volley } });
  if (f.code !== 200) continue;
  rounds += volley;
  if (f.body.kill) { killed = true; lootCash = f.body.loot || 0; lootOmr = f.body.omrLoot || 0; }
}
note('kill', 'kill completed', String(killed), `btk ${btk}, ${rounds} rounds over ${attempts} attempt(s), heat +${M3.FIRE_HEAT}/shot`);
if (killed) {
  note('kill', 'loot on kill', `$${fmt(lootCash)} cash + ${fmt(lootOmr)} $OMR`, `mark pocket was $${fmt(markPocket)} → ${fmt(100 * lootCash / Math.max(1, markPocket))}% looted`);
  note('kill', 'kill EV (careless mark)', `$${fmt(lootCash - rounds * perRound)}`, `loot − ammo $${fmt(rounds * perRound)} (search/energy/heat free-ish)`);
}
note('kill', 'kill EV (rational mark)', `−$${fmt(rounds * perRound)}`, 'a banked victim loots $0 pocket — pure ammo loss + heat');
// econ pass (D1 CONFIRMED-as-signed): standalone loot-EV is negative vs a mid mark BY DESIGN —
// the kill economy is CONTRACT-driven (pots, WANTED house bounties, war points, vendettas pay the
// work; loot is the tip). This line tracks the subsidy a contract must carry to turn the job +EV.
note('kill', 'contract break-even (mid mark)', `pot ≥ $${fmt(Math.max(0, rounds * perRound - lootCash))}`,
  `ammo $${fmt(rounds * perRound)} − loot; WANTED house bounty $${fmt(LOAN.WANTED_BOUNTY)} + open pots + war points close the gap — whale-hunting stays +EV standalone (break-even liquid ≈ $${fmt(Math.round(rounds * perRound / M3.CASH_LOOT_RATE))})`);

// MAKE-RISK-PAY CHECK: a mark caught MID-DEPOSIT — the in-transit window is the new loot surface.
// The mark banks their whole roll; the killer strikes inside BANK_CLEAR_MS.
const mark2 = await newChar('Sim Courier');
await warp(mark2.id, `respect=${lvlRespect(12)}, muscle=5, speed=5`);
guard = 0;
while ((await meOf(mark2.token)).cash < 40000 && guard++ < 200) {
  await warp(mark2.id, "nerve=50, energy=200, jail_until=NULL, heat=0");
  await call('POST', '/v1/crimes/poker', { token: mark2.token });
}
const m2cash = (await meOf(mark2.token)).cash;
await call('POST', '/v1/bank/deposit', { token: mark2.token, body: { amount: m2cash } }); // all of it, in transit
const m2 = await meOf(mark2.token);
const btk2 = btkOf(m2.level, 5);
const volley2 = Math.ceil(btk2 / ((0.7 + (gun.fp || 0) / 50) * 0.75)) + 50;
let killed2 = false, rounds2 = 0, loot2 = 0, tries2 = 0;
while (!killed2 && tries2++ < 8) {
  guard = 0;
  while ((await meOf(hunter.token)).ammo < volley2 && guard++ < 300) {
    const a = await call('POST', '/v1/armory/ammo', { token: hunter.token });
    if (a.code !== 200) { await warp(hunter.id, "nerve=50, energy=200, jail_until=NULL, heat=0"); await call('POST', '/v1/crimes/payroll', { token: hunter.token }); }
  }
  await warp(hunter.id, "energy=200, jail_until=NULL, shoot_cd_until=NULL, heat=0, loc='docks'");
  await warp(mark2.id, "hosp_until=NULL, jail_until=NULL, loc='docks'");
  await call('POST', `/v1/streets/${mark2.id}/search`, { token: hunter.token });
  const f = await call('POST', `/v1/streets/${mark2.id}/fire`, { token: hunter.token, body: { rounds: volley2 } });
  if (f.code !== 200) continue;
  rounds2 += volley2;
  if (f.body.kill) { killed2 = true; loot2 = f.body.loot || 0; }
}
if (killed2) {
  note('kill', 'kill EV (mark mid-deposit)', `$${fmt(loot2 - rounds2 * perRound)}`,
    `looted $${fmt(loot2)} incl. the IN-TRANSIT deposit ($${fmt(m2cash)} banked) − ammo $${fmt(rounds2 * perRound)} — the timed-hit surface works`);
}

// wealth-scaled safehouse: the rich pay for what they protect
const richQuote = (await meOf(g.token)).safehouseCost;
const poorQuote = (await meOf(mark.token) || {}).safehouseCost; // mark is dead — heir is poor
note('defense', 'safehouse quote (grinder, rich)', `$${fmt(richQuote)}`, '1% of liquid wealth per 4h stay');
note('defense', 'safehouse quote (fresh heir, poor)', `$${fmt(poorQuote || 25000)}`, 'the $25k floor holds for street players');

// ════════════════ P5: EXTRACTION — private laundering, AMM depth, raids ════════════════
phase('P5 extraction — washes, slippage, scrutiny, raids (honest money)');
const amm0 = (await pool.query('SELECT * FROM amm_pool WHERE id=1')).rows[0];
note('extraction', 'AMM depth at start', `$${fmt(amm0.cash_reserve)} / ${fmt(amm0.omr_reserve)} $OMR`, `price $${fmt(Number(amm0.cash_reserve) / Number(amm0.omr_reserve))}/`);
// the grinder (owns the laundromat) washes at capacity for 3 days
let washed = 0, omrGot = 0, raidLoss = 0;
for (let d = 0; d < 3; d++) {
  await pool.query(`UPDATE businesses SET launder_used=0, launder_at = now() - interval '25 hours' WHERE id='${bizId}'`);
  await warp(g.id, "heat=0, safe_until=NULL");
  const me0 = await meOf(g.token);
  if (me0.cash < 20000) break;
  const w = await call('POST', `/v1/business/${bizId}/launder`, { token: g.token, body: { amount: 20000 } });
  if (w.code === 200) { washed += 20000; omrGot += w.body.gotOmr; }
  if (w.body.raid?.raided) raidLoss += w.body.raid.fine + w.body.raid.seized;
}
const heatNow = (await meOf(g.token)).heat;
note('extraction', 'private wash (3 days @ t1 cap)', `$${fmt(washed)} → ${fmt(omrGot)} $OMR`, `heat now ${heatNow} (business heat 8/wash vs street 15)`);
// force one raid to verify the fine/seizure under honest money
process.env.BUSINESS_RAID_P = '1';
await pool.query(`UPDATE businesses SET scrutiny=100, scrutiny_at = now() - interval '1 hour', last_collect_at = now() - interval '5 hours' WHERE id='${bizId}'`);
r = await call('POST', '/v1/business/collect', { token: g.token });
delete process.env.BUSINESS_RAID_P;
if (r.body.raids?.length) note('extraction', 'forced Bureau raid', `fine $${fmt(r.body.raids[0].fine)} + seized $${fmt(r.body.raids[0].seized)}`, '10% tier cost + all pending — ledgered business:raid');
const amm1 = (await pool.query('SELECT * FROM amm_pool WHERE id=1')).rows[0];
note('extraction', 'AMM price drift from sim washes', `$${fmt(Number(amm0.cash_reserve) / Number(amm0.omr_reserve))} → $${fmt(Number(amm1.cash_reserve) / Number(amm1.omr_reserve))} per $OMR`);

// ════════════════ P6: STAKING — is the 14% actually backed? ════════════════
phase('P6 staking — pool-backed yield under real sim activity');
const gMe = await meOf(g.token);
if (gMe.omr >= 1) {
  await call('POST', '/v1/stake', { token: g.token, body: { amount: Math.floor(gMe.omr) } });
  const bb = await runBuyback(pool, { force: true }); // street tax from ALL sim house-takes
  note('staking', 'buyback', bb ? `$${fmt(bb.spentCash)} tax → ${fmt(bb.boughtOmr)} $OMR (30% → stake pool)` : 'no tax pooled', '');
  await warp(g.id, "last_accrued_at = now() - interval '30 days'");
  await meOf(g.token); // accrue 30 days of rewards
  const cl = await call('POST', '/v1/claim-rewards', { token: g.token });
  const poolRow = (await pool.query('SELECT * FROM stake_pool WHERE id=1')).rows[0];
  note('staking', '30-day claim', cl.code === 200 ? `${fmt(cl.body.claimed)} $OMR paid` : `throttled (${cl.body.error})`,
    `pool balance ${fmt(poolRow.balance)}, lifetime funded ${fmt(poolRow.lifetime_funded)} — yield is redistribution-bounded`);
}

// ════════════════ P7: FAMILY & TERRITORY ════════════════
phase('P7 family — tribute, turf, territory racket');
r = await call('POST', '/v1/gangs', { token: g.token, body: { name: 'Sim Family', tag: 'SIM' } });
if (r.code === 200) {
  const gangId = r.body.gangId;
  await call('POST', '/v1/gangs/tribute', { token: g.token, body: { amount: 120000 } });
  const s = await call('POST', '/v1/districts/docks/seize', { token: g.token });
  if (s.code === 200) {
    const est = await call('POST', '/v1/territory/docks/establish', { token: g.token });
    if (est.code === 200) {
      await pool.query("UPDATE territory_rackets SET last_income_at = now() - interval '24 hours' WHERE district_id='docks'");
      const col = await call('POST', '/v1/territory/collect', { token: g.token });
      note('family', 'territory racket (Numbers, 24h)', `$${fmt(col.body.collected)} → treasury`, 'seizable capital works under honest money');
    } else note('family', 'territory establish', `blocked: ${est.body.error}`, est.body.message || '');
  } else note('family', 'turf seizure', `blocked: ${s.body.error}`, 'needs war/garrison path — as designed');
}

// ════════════════ P8: SHAKEDOWN COLLUSION — the transfer-channel test ════════════════
phase('P8 shakedown collusion — alt-to-alt transfer rate');
const alt = await newChar('Sim Alt');
await warp(alt.id, 'muscle=2000, cunning=2000');
await warp(g.id, 'muscle=5, cunning=5, hosp_until=NULL, safe_until=NULL');
await pool.query(`UPDATE businesses SET last_collect_at = now() - interval '24 hours', shakedown_at=NULL, scrutiny=0 WHERE id='${bizId}'`);
let transferred = 0, tries = 0;
while (transferred === 0 && tries++ < 30) {
  await warp(alt.id, 'energy=200, jail_until=NULL');
  const s = await call('POST', `/v1/business/${bizId}/shakedown`, { token: alt.token });
  if (s.body.win) transferred = s.body.cut;
  else if (s.body.error === 'cooldown') await pool.query(`UPDATE businesses SET shakedown_at=NULL WHERE id='${bizId}'`);
}
note('collusion', 'one shakedown transfer', `$${fmt(transferred)}`, `30% of 24h pending; per-venue 8h cooldown → ~3×/day/venue; vs jump steal cap $${fmt(M3.JUMP_STEAL_CAP || 0)}`);

// ════════════════ P9: THE VIG — real-revenue rail ════════════════
phase('P9 vig — fees → buyback → reserve, the ETH-only mint');
await call('POST', '/v1/mod/fees/record', { headers: modH, body: { nonce: 900001, kind: 'mint', payer: '0x' + '11'.repeat(20), amountWei: '10000000000000000', txHash: '0x' + 'aa'.repeat(32) } });
await call('POST', '/v1/mod/fees/record', { headers: modH, body: { nonce: 900002, kind: 'respawn', payer: '0x' + '22'.repeat(20), amountWei: '100000000000000000', txHash: '0x' + 'bb'.repeat(32) } });
r = await call('POST', '/v1/mod/vig/buyback', { headers: modH, body: { priceOmrPerEth: 1000 } });
note('vig', 'vig buyback', r.code === 200 ? `${fmt(r.body.omrBought ?? 0)} hard $OMR bought (${fmt(r.body.ethSpent ?? 0)} ETH)` : `error ${JSON.stringify(r.body)}`, '');
const vigStatus = await call('GET', '/v1/mod/vig', { headers: modH });
const vigOk = vigStatus.body.ok ?? vigStatus.body.invariants?.ok ?? (vigStatus.body.checks || []).every?.((c) => c.ok);
note('vig', 'vig invariants (extraction ≤ inflow)', String(vigOk), '');
// THE MINT IS ETH ONLY (2026-08-10) — the $OMR rail is retired, so the extraction gate opens the way
// a real player opens it: a fee paid on the chain rail (the worker's fee watcher does this on a
// MintFeePaid event; the mod route is its manual twin), then spend the credit. Asserted BOTH ways —
// that the retired rail refuses, and that the live one works.
{
  const px = await call('POST', '/v1/plex/mint', { token: g.token });
  note('vig', 'the PLEX mint rail refuses', String(px.body?.error === 'retired'), 'fees are ETH only — one rail for the Sybil bound');
  const wallet = '0x' + '33'.repeat(20);
  const gAid = (await pool.query(`SELECT account_id a FROM characters WHERE id='${g.id}'`)).rows[0].a;
  await pool.query('UPDATE account_persistent SET wallet_address=$2 WHERE account_id=$1', [gAid, wallet]);
  await call('POST', '/v1/mod/fees/record', { headers: modH, body: { nonce: 900003, kind: 'mint', payer: wallet, amountWei: '10000000000000000', txHash: '0x' + 'cc'.repeat(32) } });
  const mint = await call('POST', '/v1/character/mint', { token: g.token });
  note('vig', 'the ETH mint opens the extraction gate', String(mint.code === 200), 'one rail, in real money, at the published wave');
}

// ════════════════ P9.5: THE DEN — realized house edge + street cut ════════════════
phase('P9.5 den — realized craps edge over a 150-roll session (honest money)');
await warp(g.id, "loc='neon', jail_until=NULL");
let denStaked = 0, denNet = 0, denOk = 0;
const taxPreDen = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
for (let i = 0; i < 150; i++) {
  await warp(g.id, 'nerve=50');
  const gm = await meOf(g.token);
  if (gm.cash < 1000) break;
  const d = await call('POST', '/v1/casino/dice', { token: g.token, body: { amount: 1000 } });
  if (d.code !== 200) break;
  denOk++; denStaked += 1000; denNet += d.body.net;
}
const taxPostDen = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
note('den', 'craps session', `${denOk} rolls, staked $${fmt(denStaked)}, net ${denNet >= 0 ? '+' : ''}$${fmt(denNet)}`,
  `realized edge ${fmt(-100 * denNet / Math.max(1, denStaked))}% (theoretical 1.41%); street cut +$${fmt(taxPostDen - taxPreDen)}`);
// extraction-risk analytics at current constants (no RNG — the founder's raid dial, computed)
const scrPerDay = CONSTANTS.BUSINESS_SCRUTINY_PER_CAP - 24 * CONSTANTS.BUSINESS_SCRUTINY_DECAY_HR;
const daysToHot = (CONSTANTS.BUSINESS_RAID_THRESHOLD / Math.max(1e-9, scrPerDay)).toFixed(1);
const pDayHot = 1 - Math.pow(1 - CONSTANTS.BUSINESS_RAID_P_PER_MIN, 1440);
note('den', 'extraction risk (analytic)', `full-cap washing goes raid-eligible in ~${daysToHot} days; P(raid)/day at max scrutiny ≈ ${fmt(100 * pDayHot)}%`,
  `net scrutiny +${scrPerDay}/day at cap; fine 10% of tier cost reaches pocket+bank`);

// ════════════════ P9.7: CREW HEISTS — the co-op faucet under honest money ════════════════
// BALANCE.md addendum: the HEIST_JOBS faucet must be sim-checked before tuning. The leader's
// stakes are paid from EARNED cash (the sim rule); crew EV is measured against the stake flow.
phase('P9.7 crew heists — payroll EV over 30 runs (honest money)');
await warp(g.id, `respect=${lvlRespect(25)}, jail_until=NULL, hosp_until=NULL, heist_at=NULL, safe_until=NULL`);
await warp(alt.id, `respect=${lvlRespect(25)}, jail_until=NULL, hosp_until=NULL, heist_at=NULL, energy=200`);
let hRuns = 0, hWins = 0, hStaked = 0, hReturned = 0, hJails = 0;
for (let i = 0; i < 30; i++) {
  // refill the leader's pocket HONESTLY if the stakes ran him dry (depository crimes)
  let gm = await meOf(g.token);
  let refill = 0;
  while (gm.cash < 12000 && refill++ < 40) {
    await warp(g.id, "nerve=50, energy=200, jail_until=NULL, heat=0");
    await call('POST', '/v1/crimes/depository', { token: g.token });
    gm = await meOf(g.token);
  }
  if (gm.cash < 12000) break;
  await warp(g.id, 'heist_at=NULL, jail_until=NULL, hosp_until=NULL');
  await warp(alt.id, 'heist_at=NULL, jail_until=NULL, hosp_until=NULL');
  const plan = await call('POST', '/v1/heists/plan', { token: g.token, body: { job: 'payroll' } });
  if (plan.code !== 200) break;
  hStaked += 10000;
  const join = await call('POST', `/v1/heists/${plan.body.id}/join`, { token: alt.token });
  if (join.code !== 200) { await call('POST', `/v1/heists/${plan.body.id}/leave`, { token: g.token }); hStaked -= 10000; break; }
  const ex = await call('POST', `/v1/heists/${plan.body.id}/execute`, { token: g.token });
  if (ex.code !== 200) break;
  hRuns++;
  if (ex.body.score) { hWins++; hReturned += ex.body.pot; } else hJails++;
}
const hEv = hRuns ? (hReturned - hStaked) / hRuns : 0;
note('heists', 'payroll co-op (2-crew, lvl 25)', `${hRuns} runs, ${hWins} scores, ${hJails} shared jails`,
  `pot−stake EV ${hEv >= 0 ? '+' : ''}$${fmt(hEv)}/run CREW-WIDE (split 1.2:1); stakes $${fmt(hStaked)} vs takes $${fmt(hReturned)}`);

// ════════════════ P9.8 world raids — apex emission ceilings (co-op step three) ════════════════
// The co-op raid faucet: co-op UNLOCKS the apex reservoirs (a soloist can't beat the def) but total
// emission is REGEN-BOUNDED — a reservoir can't emit faster than it regenerates over time. Analytic
// (exact from the signed constants), the den/extraction-risk precedent.
phase('P9.8 world raids — apex emission ceilings (co-op unlocks; regen-bounded)');
const worldRaidsPerDay = 24 / (WORLD.RAID_CD_MS / 3600000); // one raider's cadence (2h cd → 12/day)
for (const f of WORLD_NPCS.filter((n) => n.coop)) {
  const grab = Math.min(Math.floor(f.max * WORLD.GRAB_BPS / 10000), WORLD.GRAB_MAX);
  const ceilDay = f.regenPerHr * 24;                        // steady state: base-wide emission ≤ regen
  const soloFloorDay = Math.min(ceilDay, Math.round(0.10 * grab * worldRaidsPerDay)); // B1: a min-lvl whale at the 0.1 odds floor
  note('world', `${f.name} (lvl ${f.minLvl})`, `≤ $${fmt(ceilDay)}/day base-wide ceiling`,
    `regen-bounded; per-raid grab $${fmt(grab)}; one min-lvl solo @0.1-floor ≈ $${fmt(soloFloorDay)}/day`);
}
note('world', 'co-op = ACCESS not ceiling', `crew splits ONE grab (leader ${WORLD.COOP_LEADER_WEIGHT}×)`,
  'total emission stays ≤ regen; co-op just makes a heavy apex def beatable — B1 solo-floor is the dial');

// THE RESIDENT-ECONOMY ACCUMULATOR — each resident-facing probe below assigns its computed daily total
// here, and P9.32 SUMS them (never re-derives): one formula per faucet, so a retune of any single lever
// is re-measured in both the individual probe AND the consolidated ceiling with no copy to drift.
const RESIDENT = {};

// ════════ THE BLOOD WAR — NPC-family raid faucet ceiling (analytic, the world-raid twin) ════════
// A family:raid loots a bounded slice of a regen-bounded war_pool, so base-wide emission ≤ regen per
// family × the number of NPC families. Below the weakest World outfit by design (turnover-seeded).
{
  const regenDayFam = FAMILY_WAR.POOL_REGEN_HR * 24;            // steady-state emission ≤ regen, per family
  const fams = POPULATION.FAMILIES.TARGET;
  RESIDENT.familyRaidCeil = regenDayFam * fams;                 // resident-ENABLED, regen-bounded (not summed into the population total)
  const raidsDay = 24 / (FAMILY_WAR.RAID_CD_MS / 3600000);       // one raider's cadence (4h cd → 6/day)
  const perRaid = Math.min(Math.floor(FAMILY_WAR.POOL_MAX * FAMILY_WAR.RAID_BPS / 10000), FAMILY_WAR.RAID_MAX);
  note('blood war', `per-family ceiling (${fams} NPC families)`, `≤ $${fmt(regenDayFam)}/day/family → ≤ $${fmt(regenDayFam * fams)}/day base-wide`,
    `regen-bounded (POOL_MAX $${fmt(FAMILY_WAR.POOL_MAX)} < the weakest World outfit $150k); a raider caps at ${raidsDay}/day × $${fmt(perRaid)} = $${fmt(raidsDay * perRaid)}/day per family before regen bites; the DEFENCE (COUNTER_P ${FAMILY_WAR.COUNTER_P}) hospitalizes ~${Math.round(FAMILY_WAR.COUNTER_P * 100)}% of landed raids — a real risk, not a fixed-price standing buy. §10.4: a bounded family:raid faucet, NO season_wars (the severance)`);
  // THE CONQUEST tribute — a small ADDITIVE faucet (TRIBUTE_BPS of the regen rate, capped 24h) to the
  // holder's treasury. The point is turf worth HOLDING, not the money.
  const tribPerHr = Math.floor(FAMILY_WAR.POOL_REGEN_HR * FAMILY_WAR.TRIBUTE_BPS / 10000);
  note('blood war', 'conquest tribute (held vassal)', `$${fmt(tribPerHr * 24)}/day/family → ≤ $${fmt(tribPerHr * 24 * fams)}/day base-wide`,
    `a routed NPC family held as a vassal pays ${FAMILY_WAR.TRIBUTE_BPS / 100}% of its regen rate to the treasury (the World-frontier twin, capped 24h) — a small ADDITIVE faucet on top of loot; the value is the conquest/turf goal, not the income. §10.4: family:tribute reconciles the gang-treasuries check`);
}

// ════════════════ P9.9 boxing — exhibition purse EV (the new PvE faucet) ════════════════
// EV = −fee + P(win)×purse, per the exact form model (form=Σstats, +rand(0,VARIANCE) each, ties reroll).
// Enumerated P(win) over the rng grid — analytic, no maxed-fighter ($1M) build needed to seed value.
phase('P9.9 boxing — exhibition purse EV by fighter form (the new faucet)');
const pWinBox = (mf, tf, V) => { let w = 0, tot = 0; for (let a = 0; a <= V; a++) for (let b = 0; b <= V; b++) { if (mf + a === tf + b) continue; tot++; if (mf + a > tf + b) w++; } return w / tot; };
const boxPerDay = 24 / (BOXING.EXHIBITION_CD_MS / 3600000);   // one fighter's cadence (6h cd → 4/day)
for (const [label, myForm] of [['fresh signee', 3 * Math.round((BOXING.STAT_MIN + BOXING.STAT_MAX) / 2)], ['maxed fighter', 3 * BOXING.STAT_CAP]]) {
  let best = null;
  for (const t of BOXING.NPC_TIERS) { const p = pWinBox(myForm, t.form, BOXING.VARIANCE); const ev = -t.fee + p * t.purse; if (!best || ev > best.ev) best = { tier: t.name, p, ev }; }
  note('boxing', `exhibition EV — ${label} (form ${myForm})`, `${best.ev >= 0 ? '+' : ''}$${fmt(best.ev)}/bout best`,
    `best tier ${best.tier} @P${(best.p * 100).toFixed(0)}% · ${best.ev >= 0 ? '+' : ''}$${fmt(best.ev * boxPerDay)}/day/fighter · ×${BOXING.STABLE_MAX} stable ${best.ev >= 0 ? '+' : ''}$${fmt(best.ev * boxPerDay * BOXING.STABLE_MAX)}/day`);
}

// ════════════════ P9.10 territory — net income by racket TYPE (mult vs the Bureau crackdown) ════
// Territory step three's income mult is offset by crackdown risk that scales with the type's scrutiny.
// The finding the founder needs: is a hot type higher-VARIANCE or higher-EV? Depends on COLLECTION
// CADENCE (frequent collection stays ahead of the Bureau). Reported at a representative tier-3 op.
phase('P9.10 territory — net income by racket TYPE (income mult vs crackdown)');
const repTier = TERRITORY_RACKETS.find((t) => t.tier === 3); // 'District' — $60k/hr base
const tDecay = CONSTANTS.TERRITORY_SCRUTINY_DECAY_HR, tThr = CONSTANTS.TERRITORY_RAID_THRESHOLD, tPmin = CONSTANTS.TERRITORY_RAID_P_PER_MIN;
const tFine = Math.floor(territoryBuildCost(3) * CONSTANTS.TERRITORY_RAID_FINE_RATE);
for (const ty of TERRITORY_TYPES) {
  const grossDay = repTier.incomePerHr * ty.incomeMult * 24;   // daily collect, 24h cap
  const net = ty.scrutinyPerHr - tDecay;
  if (net <= 0) {
    note('territory', `${ty.name} (District t3)`, `$${fmt(grossDay)}/day`, `×${ty.incomeMult} · never heats up (${ty.scrutinyPerHr}/hr < decay ${tDecay}) — SAFE at any cadence`);
  } else {
    const hrsToHot = tThr / net;
    const hrsAbove = Math.max(0, 24 - hrsToHot);              // hours above the line on a LAZY 24h cadence
    const pRaid = 1 - Math.pow(1 - tPmin, Math.min(1440, hrsAbove * 60));
    const lazyNet = grossDay * (1 - pRaid) - pRaid * tFine;   // raided → lose the pending + fine
    note('territory', `${ty.name} (District t3)`, `$${fmt(grossDay)}/day gross (×${ty.incomeMult})`,
      `hot in ${fmt(hrsToHot)}h — collect within it to stay cool; LAZY 24h cadence P(raid) ${(pRaid * 100).toFixed(0)}% → ~$${fmt(Math.round(lazyNet))}/day (fine $${fmt(tFine)})`);
  }
}
note('territory', 'the TYPE tradeoff', 'active vs lazy', 'numbers is cadence-proof; a hot type should be higher-VARIANCE not higher-EV — watch protection (30h-to-hot dodges a daily collect) + smuggling lazy-net (BALANCE B-terr)');

// ════════ P9.11 previously-unmeasured founder-flagged faucets (analytic, from signed constants) ════════
// Closes the sim-coverage gap the sign-off pass flagged: the World frontier tribute (step four), the
// Speakeasy bar take, the Pen work faucet, and the World step-five liberation on-ramp. Analytic (the
// P9.8/9.10 precedent) — pure reads of the constants, no value seeded, so §10.4 is untouched.
phase('P9.11 sign-off faucets — frontier tribute / speakeasy bar take / pen work / liberation on-ramp');
// (1) FRONTIER TRIBUTE (World step four): a held outfit pays regenPerHr × TRIBUTE_BPS/1e4, capped 24h.
let frontierDay = 0;
for (const f of WORLD_NPCS) frontierDay += frontierTributePerHr(f) * 24;
note('world', 'frontier tribute (all 5 outfits held)', `≤ $${fmt(frontierDay)}/day base-wide`,
  `${WORLD.FRONTIER.TRIBUTE_BPS / 100}% of regen, 24h-capped, requires routing to hold — a small treasury faucet vs territory ops`);
// (2) SPEAKEASY BAR TAKE: a club's base income, 24h-capped, one club per district (6). Top tier is material.
const seTop = SPEAKEASY.TIERS[SPEAKEASY.TIERS.length - 1];
const seCapH = SPEAKEASY.INCOME_CAP_MS / 3600000;
note('speakeasy', `bar take — ${seTop.name} (top tier)`, `$${fmt(seTop.incomePerHr * seCapH)}/day/club`,
  `${SPEAKEASY.TIERS.length} decor tiers ($${fmt(SPEAKEASY.TIERS[0].incomePerHr * seCapH)}→$${fmt(seTop.incomePerHr * seCapH)}/day), one club per district, ${seCapH}h cap — a territory-scale front (safehouse-gated collect)`);
note('speakeasy', 'back-room table rake', `${SPEAKEASY.TABLE.RAKE_BPS / 100}% of stake → owner`,
  `a TRANSFER carved from the stake (never minted; the casino discipline), $${fmt(SPEAKEASY.TABLE.MIN_BET)}–$${fmt(SPEAKEASY.TABLE.MAX_BET)} bets, edge burns`);
// (3) PEN WORK: yard duty pays a small band per work, energy-gated AND only while jailed → bounded + tiny.
const penMid = Math.round((PEN.WORK_PAY[0] + PEN.WORK_PAY[1]) / 2);
note('pen', 'yard work faucet', `~$${fmt(penMid)}/work (${PEN.WORK_ENERGY} energy)`,
  `only WHILE JAILED (inherently bounded) + shaves ${PEN.WORK_CUT_S}s/work off the sentence — a trickle vs any street loop, self-limiting`);
// (4) LIBERATION ON-RAMP (World step five): the cost to free each occupied core district at FULL outfit strength.
for (const [districtId, npcId] of Object.entries(WORLD.OCCUPATION)) {
  const f = worldNpcOf(npcId);
  note('world', `liberation on-ramp — ${districtId} (${f.name})`, `$${fmt(liberationCost(f, 1))} at full strength`,
    `→ floors to $${fmt(WORLD.OCCUPY_MIN)} once the outfit is routed to the reservoir floor (the World-loop discount)`);
}

// ════════ P9.12 speakeasy bar take — NET EV by tier (the sign-off's one flagged big faucet) ════════
// The sign-off flagged the top-tier bar take ($3.12M/day) as the one large faucet never measured NET of
// its costs. The honest picture (analytic, from the signed constants): the bar take is a PASSIVE lazy
// income (24h-capped). NOTORIETY — hence the Bureau-raid risk — comes from the back-room TABLE (8/play)
// and busy ROUNDS (2 each), which are PATRON-driven, not the owner's collect; a bar-take-ONLY owner draws
// ~0 notoriety, so ~0 raid tax. There is NO recurring "pad" upkeep on a speakeasy (unlike a business
// front). So for a passive club, NET ≈ GROSS — the raid layer only bites an owner who runs a busy table.
phase('P9.12 speakeasy — bar-take NET EV + build payback by tier (the flagged faucet)');
let seBuild = SPEAKEASY.OPEN_COST;
const seKeep = 1 - SPEAKEASY.UPKEEP_BPS / 10000; // after the SIGN-OFF upkeep cut off the top of every collect
for (const t of SPEAKEASY.TIERS) {
  seBuild += t.cost; // cumulative capital to reach this tier (open + every upgrade)
  const grossDay = t.incomePerHr * (SPEAKEASY.INCOME_CAP_MS / 3600000);
  const netDay = Math.floor(grossDay * seKeep);
  const paybackDays = netDay > 0 ? seBuild / netDay : Infinity;
  note('speakeasy', `${t.name} (t${t.tier}) bar take`, `$${fmt(grossDay)}/day gross → $${fmt(netDay)} NET`,
    `−${SPEAKEASY.UPKEEP_BPS / 100}% upkeep off the top (speakeasy:upkeep sink); build-to-here $${fmt(seBuild)} → payback ~${paybackDays.toFixed(1)}d; passive collect draws ~0 notoriety → the table/rounds carry the raid risk; safehouse-gated collect (D2)`);
}
note('speakeasy', 'net-EV verdict', 'still a strong front, now taxed',
  `top tier ~$${fmt(Math.floor(3120000 * seKeep))}/day NET after the ${SPEAKEASY.UPKEEP_BPS / 100}% upkeep — no longer a risk-free faucet; incomePerHr curve is the remaining founder dial (BALANCE speakeasy)`);

// ════════ P9.13 street races — PvE purse EV (the new content faucet, boxing-exhibition twin) ════════
// EV = −fee + P(win)×purse; P(win) enumerated over the rand grid (carPower+rand vs field+rand). The PvE
// purse is the ONLY new faucet in the drop (PvP wagers are a taxed transfer, tuning a sink). Analytic.
phase('P9.13 street races — PvE circuit purse EV by car power (the new faucet)');
const pWinRace = (cp, field, V) => { let w = 0, tot = 0; for (let a = 0; a <= V; a++) for (let b = 0; b <= V; b++) { const m = cp + a, f = field + b; if (m === f) continue; tot++; if (m > f) w++; } return w / tot; };
const racesPerDay = 24 / (RACES.CD_MS / 3600000); // one driver's cadence (30-min cd → 48/day)
for (const [label, cp] of [['a tuned contender (power 200)', 200], ['a premium monster (power 450)', 450]]) {
  let best = null;
  for (const t of RACES.TIERS) { const p = pWinRace(cp, t.fieldPower, RACES.VARIANCE); const ev = -t.fee + p * t.purse; if (!best || ev > best.ev) best = { tier: t.name, p, ev }; }
  note('races', `PvE EV — ${label}`, `${best.ev >= 0 ? '+' : ''}$${fmt(Math.round(best.ev))}/race best`,
    `best tier ${best.tier} @P${(best.p * 100).toFixed(0)}% · ${best.ev >= 0 ? '+' : ''}$${fmt(Math.round(best.ev * racesPerDay))}/day at ${racesPerDay}/day cadence — bounded faucet, a lost race also dings the car (repair cost); sign-off vs boxing exhibition`);
}
// step 2 — NITROUS: burning a $NOS_COST charge adds NOS_POWER to the roll — the COMEBACK tool. It's +EV
// only when the extra P(win) it buys × the purse beats the charge cost, so it pays off for an UNDERDOG on a
// decent-purse race (flip a likely loss to a likely win), stays −EV on the cheap races, and is WASTED on a
// car already winning (ΔP≈0). Never free money (gone win/lose) → a sink on average. Modeled for an underdog
// at each tier (power = field − 20, a slight dog within the variance) — the scenario NOS is FOR.
for (const [who, delta] of [['an underdog (field − 20)', -20], ['a heavy favorite (field + 60)', 60]]) {
  let best = null;
  for (const t of RACES.TIERS) {
    const cp = t.fieldPower + delta;
    const p0 = pWinRace(cp, t.fieldPower, RACES.VARIANCE);
    const p1 = pWinRace(cp + RACES.NOS_POWER, t.fieldPower, RACES.VARIANCE);
    const dEV = (p1 - p0) * t.purse - RACES.NOS_COST;
    if (!best || dEV > best.dEV) best = { tier: t.name, p0, p1, dEV };
  }
  note('races', `NITROUS — best EV of one charge, ${who}`, `${best.dEV >= 0 ? '+' : ''}$${fmt(Math.round(best.dEV))}/charge`,
    `+${RACES.NOS_POWER} power for $${fmt(RACES.NOS_COST)}: best on ${best.tier}, P(win) ${(best.p0*100).toFixed(0)}%→${(best.p1*100).toFixed(0)}% — ${best.dEV >= 0 ? 'a viable comeback play (still a sink on average — gone win/lose)' : 'not worth it here; a favorite wastes it (ΔP≈0)'}`);
}

// ════════ P9.14 the Port — smuggling margin EV, cap-bounded (the new content faucet) ════════
// port:sale is the drop's one faucet. Per $1 of contraband bought, net = P(clean)×(sell/buy) − 1 −
// P(caught)×FINE_RATE. The DAILY faucet is bounded by SUPPLY_CAP_DAY (the max buy-value/day). Analytic —
// the fastest boat that clears each route, patrol-neutral. The bound must land at boxing/territory parity.
phase('P9.14 the Port — smuggling margin EV per route (cap-bounded faucet)');
let bestNetRatio = 0;
for (const route of PORT.ROUTES) {
  const boat = [...PORT.BOATS].sort((a, b) => b.speed - a.speed).find((b) => b.speed >= route.minSpeed) || PORT.BOATS[0];
  const p = interdictChance(route, boat, false, 0);                  // patrol-neutral
  const clean = 1 - p;
  const netRatio = clean * (route.sell / route.buy) - 1 - p * PORT.FINE_RATE; // margin per $1 of buy
  const dailyMax = Math.round(PORT.SUPPLY_CAP_DAY * netRatio);       // at full cap utilization
  bestNetRatio = Math.max(bestNetRatio, netRatio);
  note('port', `${route.name} — ${boat.name}`, `~$${fmt(dailyMax)}/day at the cap`,
    `P(caught) ${(p * 100).toFixed(0)}% · margin ×${(route.sell / route.buy).toFixed(2)} · net ${(netRatio * 100).toFixed(0)}% per $ sourced (fine ${(PORT.FINE_RATE * 100)}% of cargo on a bust; a bust can also sink the boat)`);
}
note('port', 'daily faucet (best route, maxed)', `~$${fmt(Math.round(PORT.SUPPLY_CAP_DAY * bestNetRatio))}/day`,
  `bounded by SUPPLY_CAP_DAY $${fmt(PORT.SUPPLY_CAP_DAY)} × the best net margin — sign-off vs boxing exhibition / territory (~$300-400k)`);

// ════════ P9.15 the afterSwap→Vig trade-fee flywheel — analytic contribution (design §2, Tier D) ════════
// The dormant Uniswap hook skims HOOK_FEE_BPS of each swap's ETH leg → the Vig books VIG_BPS of that as
// source='trade' revenue → the existing buyback turns it into reserve (RESERVE_BPS) + prize pool. This is a
// SIGN-OFF number, NOT a §10.4 assertion: real ETH is out-of-band (zero `transactions` rows — the fees.js
// precedent), so it neither seeds value nor moves the sweep. It bounds how much extra withdrawal-reserve a
// given daily OMR/ETH trade volume underwrites — "traders fund earners." Illustrative volumes; the real
// figure is the DEX's realized volume at mainnet.
phase('P9.15 trade-fee flywheel — Vig contribution vs daily swap volume (analytic, out-of-band)');
const VIG_BPS = Number(process.env.VIG_BPS || 6000);
const RESERVE_BPS = Number(process.env.VIG_RESERVE_BPS || 5000);
const HOOK_FEE_BPS = 30; // illustrative pool skim (contract lever, MAX_FEE_BPS 100) — sign-off
for (const volEth of [10, 100, 1000]) {                              // daily ETH-leg swap volume scenarios
  const skimEth = volEth * HOOK_FEE_BPS / 10000;                      // the hook's take
  const vigEth = skimEth * VIG_BPS / 10000;                           // booked as source='trade' revenue
  const toReserveEth = vigEth * RESERVE_BPS / 10000;                  // buyback → withdrawal reserve
  note('vig', `flywheel @ ${fmt(volEth)} ETH/day traded`, `+${vigEth.toFixed(3)} ETH/day to the Vig`,
    `skim ${HOOK_FEE_BPS}bps → ${skimEth.toFixed(3)} ETH · Vig ${(VIG_BPS/100)}% → ${toReserveEth.toFixed(3)} ETH/day underwrites withdrawal reserve (rest → prize pool); real vol = the DEX at mainnet`);
}
note('vig', 'flywheel §10.4 posture', 'out-of-band, zero ledger rows', 'the fees.js precedent — trade fees never seed value, so the sweep is untouched; extraction ≤ inflow only STRENGTHENS');

// ════════ P9.16 THE GRAND PRIX — a redistribution, NET SINK via the rake (NOT a faucet) ════════
// A parimutuel: N drivers escrow BUYIN, the top places split the pool net of RAKE_BPS (half → street tax,
// half burns). So player-side emission is ZERO minus the rake — the field pays the winners, the house
// keeps the rake. Unlike the PvE purse (a faucet), the GP MOVES no new money into the economy; it's a
// competitive redistribution + a small cash SINK (the burned half of the rake). Analytic — the house edge
// is the rake regardless of the field or who wins (the renormalized-payout property).
phase('P9.16 grand prix — house edge + net sink (a redistribution, not a faucet)');
{ const rake = RACES.GP.RAKE_BPS / 10000;
  for (const field of [RACES.GP.MIN_ENTRANTS, 8]) {
    const pool = field * RACES.GP.BUYIN;
    const houseTake = Math.round(pool * rake);            // rake off the whole pool
    const burned = Math.round(houseTake / 2);             // half burns (a §10.4 cash sink), half → street tax
    note('races', `Grand Prix — ${field}-driver pool $${fmt(pool)}`, `house edge ${(rake*100).toFixed(1)}% · burns $${fmt(burned)}`,
      `winners split $${fmt(pool - houseTake)} (${RACES.GP.PAYOUTS.map((p)=>Math.round(p*100)+'%').join('/')}); the field funds the winners — ZERO new emission, net cash SINK $${fmt(burned)}/race (the burned half-rake). Skill+gear decides, alt-stuffing is −rake/N per head (−EV)`);
  }
}

// ════════ P9.17 NPC TRUCKING — the convoy-hijack faucet (bounded goods injection) ════════
// The worker keeps CONVOY.NPC.TARGET trucks on the road, each living CONVOY.MS then despawning + respawning.
// A hijacked truck injects its manifest's GOODS into the raider's trunk → sold via the market (the one new
// faucet). Base-wide daily max = throughput × avg manifest × hijack-fraction. Analytic — no value seeded.
// The World-raid precedent: a bounded PvE faucet, sign-off vs boxing/territory (~$300-400k/day base-wide).
phase('P9.17 NPC trucking — the hijack goods faucet (bounded, base-wide)');
{ const perDay = CONVOY.NPC.TARGET * (86400000 / CONVOY.MS);           // trucks that pass through the road per day
  const avgQty = (CONVOY.NPC.MIN_QTY + CONVOY.NPC.MAX_QTY) / 2;
  // avg unit base value across the NPC loot table + the districts (goodPriceOf is the deterministic §7.11 hash)
  let sum = 0, n = 0;
  for (const g of CONVOY.NPC.GOODS) for (const d of DISTRICTS) { sum += goodPriceOf(g, d.id); n++; }
  const avgUnit = sum / n, avgManifest = avgQty * avgUnit;
  const injectedPerDay = perDay * avgManifest;                          // if EVERY truck were fully hijacked
  for (const [label, hit] of [['~50% hijacked (realistic)', 0.5], ['100% hijacked (ceiling)', 1.0]]) {
    note('convoy', `NPC trucking faucet — ${label}`, `~$${fmt(Math.round(injectedPerDay * hit))}/day base-wide ceiling`,
      `${CONVOY.NPC.TARGET} trucks on the road × ${(86400000/CONVOY.MS).toFixed(0)} turnovers/day = ${perDay.toFixed(0)} trucks · avg manifest ~$${fmt(Math.round(avgManifest))} (${avgQty} units × ~$${Math.round(avgUnit)}) · hijack ${(hit*100).toFixed(0)}%`);
  }
  // the REAL per-player bound is ENERGY: an ambush costs CONVOY.AMBUSH_ENERGY, so a solo grinder is capped
  // by their daily energy regen (not the base-wide ceiling) — and a manifest is one-per-convoy (up to
  // MAX_AMBUSHES raiders SPLIT it), so a contested road dilutes the take. The ceiling above is the whole
  // road captured uncontested; a realistic dedicated raider nets far less after ammo + the energy throttle.
  note('convoy', 'NPC trucking — the real per-player bound', `~${Math.round(500 / CONVOY.AMBUSH_ENERGY)} ambushes/day at ~500 energy`,
    `energy ${CONVOY.AMBUSH_ENERGY}/ambush + ammo ${CONVOY.AMBUSH_AMMO}/ambush throttle a solo grinder well under the base-wide ceiling; MAX_AMBUSHES ${CONVOY.MAX_AMBUSHES} raiders split one manifest, so contention dilutes — sign-off vs boxing/territory (~$300-400k/day)`);
}

// ════════ P9.18 the Stable — PvE circuit purse EV by racer form (the new faucet, boxing-exhibition twin) ════════
// EV = −fee + P(win)×purse over the exact form model (the boxing pWinBox model reused). A racer's max form is
// 3×STAT_CAP; a fresh purchase averages 3×(statMin+statMax)/2. Per-racer cadence = 24/CIRCUIT_CD hrs.
phase('P9.18 the Stable — PvE circuit purse EV by racer form + kind (the new faucet)');
{ const perDay = 24 / (STABLE.CIRCUIT_CD_MS / 3600000); // 6h cd → 4/day/racer
  for (const kind of Object.keys(STABLE.KINDS)) {
    const k = STABLE.KINDS[kind];
    for (const [label, myForm] of [['fresh', 3 * Math.round((k.statMin + k.statMax) / 2)], ['trained', 3 * STABLE.STAT_CAP]]) {
      let best = null;
      for (const m of STABLE.MEETS[kind]) { const p = pWinBox(myForm, m.form, STABLE.VARIANCE); const ev = -m.fee + p * m.purse; if (!best || ev > best.ev) best = { meet: m.name, p, ev }; }
      note('stable', `circuit EV — ${k.name} ${label} (form ${myForm})`, `${best.ev >= 0 ? '+' : ''}$${fmt(Math.round(best.ev))}/race best`,
        `best meet ${best.meet} @P${(best.p * 100).toFixed(0)}% · ${best.ev >= 0 ? '+' : ''}$${fmt(Math.round(best.ev * perDay))}/day/racer · ×${STABLE.STABLE_MAX} stable ${best.ev >= 0 ? '+' : ''}$${fmt(Math.round(best.ev * perDay * STABLE.STABLE_MAX))}/day — bounded faucet (fee burns win/lose, cooldown + injury-on-loss); sign-off vs boxing exhibition`);
    }
  }
}

// ════════ P9.19 CLUE SCROLLS — the casket faucet (slate #4; the drop's one new emission) ════════
// Analytic ceiling: one active hunt + the 8h post-casket cooldown → ≤ 24/CLUE_CD caskets/day/char;
// mean take = (MIN+MAX)/2. The realized rate is far lower (a hunt takes travel + the 2% drop).
phase('P9.19 clue scrolls — the casket faucet (bounded)');
{ const perDay = 24 / (CLUES.CLUE_CD_MS / 3600000);
  const mean = (CLUES.CASKET_MIN + CLUES.CASKET_MAX) / 2;
  note('clues', 'casket faucet ceiling', `$${fmt(Math.round(perDay * mean))}/day/char hard max`,
    `${perDay}/day cadence cap × $${fmt(mean)} mean take (band $${fmt(CLUES.CASKET_MIN)}–$${fmt(CLUES.CASKET_MAX)}); realized far lower (2% drop on jobs, travel per step) — petty vs the signed loops; KEEP unless dust telemetry says otherwise`);
}

// ════════ P9.20 THE PASSIVE STACK — the parallel-income ceiling one operator can run (the gap) ════════
// Every prior P9 probe measures ONE faucet. This sums what a SINGLE maxed operator collects in parallel,
// because the passive earners DON'T compete for energy (the bound on the active crime loop) — they cost
// only cooldowns + upkeep. So the honest question is not "is any one faucet at parity" but "does the STACK
// dwarf the active loop". Analytic, from the signed constants — no value seeded, §10.4 untouched.
phase('P9.20 the passive stack — parallel energy-free income vs the active grind (the balance gap)');
{
  const bizCapH = CONSTANTS.BUSINESS_CAP_MS / 3600000;
  // L1b — the PROGRESSIVE pad: a 5-front stack pays BUSINESS_UPKEEP_BPS + 4×PROG_BPS of gross
  const padBps5 = CONSTANTS.BUSINESS_UPKEEP_BPS + CONSTANTS.BUSINESS_UPKEEP_PROG_BPS * 4;
  const bizKeep = 1 - padBps5 / 10000;
  // PERSONAL FRONTS: one of each kind at top tier (UNIQUE(character_id,kind)) — uncontestable, 5 collect clicks
  let frontGross = 0, frontCapital = 0;
  for (const b of BUSINESSES) {
    const top = b.tiers[b.tiers.length - 1];
    frontGross += top.incomePerHr * bizCapH;
    frontCapital += b.tiers.reduce((s, t) => s + t.cost, 0);
  }
  const frontNet = frontGross * bizKeep;
  note('stack', 'personal front stack (5 kinds, top tier, NET of pad)', `$${fmt(Math.round(frontNet))}/day`,
    `gross $${fmt(Math.round(frontGross))}/day − ${padBps5 / 100}% progressive pad (L1b: ${CONSTANTS.BUSINESS_UPKEEP_BPS / 100}% base + 4×${CONSTANTS.BUSINESS_UPKEEP_PROG_BPS / 100}% per extra front); ${bizCapH}h collect cap; build-to-here $${fmt(Math.round(frontCapital))} → payback ~${(frontCapital / frontNet).toFixed(1)}d; ENERGY-FREE (5 collect clicks/day)`);

  // SPEAKEASY: one club per district, top tier, net of the sign-off upkeep — personal, additive to the fronts
  const seTop = SPEAKEASY.TIERS[SPEAKEASY.TIERS.length - 1];
  const seKeep = 1 - SPEAKEASY.UPKEEP_BPS / 10000;
  const seClubNet = seTop.incomePerHr * (SPEAKEASY.INCOME_CAP_MS / 3600000) * seKeep;
  note('stack', 'speakeasy (per club, top tier, NET)', `$${fmt(Math.round(seClubNet))}/day/club`,
    `one club per district, additive to the fronts; safehouse-gated collect (D2)`);

  // FAMILY passive (boss-collected to the treasury, not the pocket, but still a maxed-operation ceiling):
  //   territory (6 core districts, top tier × best type), frontier tribute (5 outfits), sov income (6 tiers)
  const tTop = TERRITORY_RACKETS[TERRITORY_RACKETS.length - 1];
  const tMult = Math.max(...TERRITORY_TYPES.map((t) => t.incomeMult));
  const terrDayPerDistrict = tTop.incomePerHr * tMult * (CONSTANTS.TERRITORY_CAP_MS / 3600000);
  note('stack', 'territory rackets (family, per district, top tier × best type)', `~$${fmt(Math.round(terrDayPerDistrict))}/day/district`,
    `×${tMult} type mult; up to 6 core districts if the family holds them — a separate, treasury-side passive stack`);

  // THE VERDICT: the personal stack alone vs the measured active-grind ceiling
  const ratio = frontNet / grindDay;
  note('stack', 'PERSONAL passive : ACTIVE grind', `${ratio.toFixed(1)}×`,
    `the 5-front stack ($${fmt(Math.round(frontNet))}/day, energy-free) vs the top-tier crime grind ($${fmt(Math.round(grindDay))}/day, ~200 energy-bounded attempts) — before speakeasy/territory/frontier/sov add more`);
  note('stack', 'APPLIED (founder-directed L1a+L1b balance package)', 'front curve flattened + progressive pad',
    `L1a halved the apex hotel/casino incomePerHr; L1b makes a 5-front stack pay ${padBps5 / 100}% pad vs a 1-front's ${CONSTANTS.BUSINESS_UPKEEP_BPS / 100}% — the personal stack dropped ~$48.96M→$${fmt(Math.round(frontNet))}/day (ratio ~6×→${ratio.toFixed(1)}×), still passive-favoured but no longer dwarfing the active loop; §10.4 stays drift-0 (every front a ledgered faucet). Remaining dial: the full front incomePerHr curve (BALANCE.md)`);
}

// ════════ P9.20b THE ASSET LADDER — can a player GET these, and what happens when they do ════════
// Founder-directed (2026-08-01): "run a balance check on the assets to make sure they are feasible and
// reasonable for players to even get or they will get discouraged and the meta fails."
//
// The measurement answers a sharper question than affordability, because affordability turned out not
// to be the problem. Three catalogs do the SAME thing — buy once, drip forever, cost no energy:
// RACKETS (18, level-gated), the Legit Fronts half of ASSETS (13, gated by PRICE ONLY — buyAsset has
// no level check), and BUSINESSES (5, level-gated, with a pad). The honest metric for all three is
// PAYBACK: how many days of its own income the thing costs.
//
// The band worth stating, because without one "is this reasonable" has no answer: a passive asset
// should pay for itself in LONGER than one sitting (or buying it is a formality) and SHORTER than a
// street's expected life (or it is a trap you die holding). The harness reaches level 33 in 7 days of
// play, so ~3 to ~14 days is the healthy window. Analytic, from the signed constants — no value
// seeded, §10.4 untouched.
phase('P9.20b the asset ladder — payback, and whether the entry price is really the gate');
{
  const meterH = CONSTANTS.RACKET_DAILY_CAP_MS / 3600000;   // rackets + assets accrue on this meter
  const bizCapH = CONSTANTS.BUSINESS_CAP_MS / 3600000;
  const BAND = [3, 14];
  const rows = [];
  for (const r of RACKETS) rows.push({ what: `racket ${r.id}`, lvl: r.lvl, cost: r.cost, day: r.income * 60 * meterH });
  for (const a of ASSETS) if (a.income) rows.push({ what: `asset ${a.id}`, lvl: null, cost: a.price, day: a.income * 60 * meterH });
  for (const b of BUSINESSES) { const t = b.tiers[0];
    rows.push({ what: `front ${b.kind}`, lvl: b.lvl, cost: t.cost, day: t.incomePerHr * bizCapH * (1 - CONSTANTS.BUSINESS_UPKEEP_BPS / 10000) }); }
  for (const r of rows) r.payback = r.cost / r.day;

  const fast = rows.filter((r) => r.payback < BAND[0]);
  const inBand = rows.filter((r) => r.payback >= BAND[0] && r.payback <= BAND[1]);
  note('assets', 'income assets measured', `${rows.length}`,
    `${RACKETS.length} rackets (level-gated) + ${ASSETS.filter((a) => a.income).length} Legit Fronts assets (PRICE-gated only) + ${BUSINESSES.length} business fronts (level-gated, net of the ${CONSTANTS.BUSINESS_UPKEEP_BPS / 100}% pad); all accrue with ZERO energy`);
  note('assets', 'payback range', `${Math.min(...rows.map((r) => r.payback)).toFixed(2)}d — ${Math.max(...rows.map((r) => r.payback)).toFixed(2)}d`,
    `the healthy band is ${BAND[0]}-${BAND[1]}d (longer than a sitting, shorter than a street's life)`);
  note('assets', 'INSIDE the healthy band', `${inBand.length} of ${rows.length}`,
    inBand.length ? inBand.map((r) => r.what).join(', ') : 'NONE — every income asset pays for itself faster than the band\'s floor');
  // The DETAIL has to follow the number, not restate a conclusion the number may since have
  // outgrown: this line read "so the buy decision is not 'can I afford this' but 'have I clicked
  // it yet'" for a run that measured ZERO such rungs. A stale conclusion beside a live figure is
  // the class of defect the retired `laundering.ammSpot` assertion was (a shape that stays true
  // after the thing it described is gone), so both halves are derived now.
  const sameDay = rows.filter((r) => r.payback < 1);
  note('assets', 'pay for themselves in under a day', `${sameDay.length} of ${rows.length}`,
    sameDay.length
      ? `${sameDay.map((r) => r.what).join(', ')} — for these the buy decision is not "can I afford this" but "have I clicked it yet", which is what makes the mid-game feel like it has nothing to decide`
      : 'no rung pays for itself in a sitting, so every purchase is a bet on staying alive long enough to collect on it — which is what makes it a decision');
  // the cheapest rung, because that is what a new player actually meets first
  const cheapest = rows.slice().sort((a, b) => a.cost - b.cost)[0];
  note('assets', 'the first rung anyone can reach', `${cheapest.what} — $${fmt(cheapest.cost)} → $${fmt(Math.round(cheapest.day))}/day`,
    `payback ${cheapest.payback.toFixed(2)}d. The harness has a session-1 player at ~$32k, so this is roughly a session away`);
  // THE UNGATED LADDER: 13 income assets have no level requirement at all
  const ungated = rows.filter((r) => r.lvl === null);
  const ungatedTop = ungated.slice().sort((a, b) => b.day - a.day)[0];
  note('assets', 'income assets with NO level gate', `${ungated.length}`,
    `buyAsset checks cash and nothing else, so the Legit Fronts ladder is bounded only by price — the biggest, ${ungatedTop.what}, is $${fmt(ungatedTop.cost)} → $${fmt(Math.round(ungatedTop.day))}/day at ANY level. In practice cash tracks level closely enough that this is a soft gate rather than an open door, but it is a gate nobody chose`);
  // the stack, which P9.20 measures for FRONTS only — this is the rest of it
  const rackDay = rows.filter((r) => r.what.startsWith('racket')).reduce((a, r) => a + r.day, 0);
  const assetDay = ungated.reduce((a, r) => a + r.day, 0);
  note('assets', 'the rest of the passive stack (P9.20 counts fronts only)',
    `rackets $${fmt(Math.round(rackDay))}/day + assets $${fmt(Math.round(assetDay))}/day`,
    `both buy-once and permanent; against the top-tier crime grind at $${fmt(Math.round(grindDay))}/day this is the shape of the passive-vs-active gap, and it is bigger than the front stack alone. Note this is the WHOLE ladder — see the seat bound below for what one player may actually run`);

  // ── THE OPERATION SLOTS (the strategy package) — the bound that makes the ladder a CHOICE ──
  // The 31 metered holdings above no longer stack: a player runs at most opSlotsOf(level) of them.
  // So the question this probe kept answering ("which drip do I buy next") becomes "which of the 31
  // do I want in my ${OPERATIONS.SLOTS_MAX} seats" — the same catalog, now with an opportunity cost.
  const metered = rows.filter((r) => r.what.startsWith('racket') || r.lvl === null);
  const best = metered.slice().sort((a, b) => b.day - a.day);
  const bestN = (n) => best.slice(0, n).reduce((a, r) => a + r.day, 0);
  note('assets', 'the seat bound', `${OPERATIONS.SLOTS_BASE} seats at level 1 → ${OPERATIONS.SLOTS_MAX} at level ${(OPERATIONS.SLOTS_MAX - OPERATIONS.SLOTS_BASE) * OPERATIONS.SLOTS_PER_LEVEL}`,
    `${metered.length} metered holdings (${RACKETS.length} rackets + ${ungated.length} ${OPERATIONS.INCOME_ASSET_CAT}) compete for ${OPERATIONS.SLOTS_MAX} seats — you run ~${Math.round((OPERATIONS.SLOTS_MAX / metered.length) * 100)}% of the catalog, ever`);
  note('assets', 'metered passive income, capped vs uncapped',
    `$${fmt(Math.round(bestN(OPERATIONS.SLOTS_MAX)))}/day (best ${OPERATIONS.SLOTS_MAX}) vs $${fmt(Math.round(rackDay + assetDay))}/day (all ${metered.length})`,
    `the cap is a ${((rackDay + assetDay) / bestN(OPERATIONS.SLOTS_MAX)).toFixed(2)}x cut to the metered half of the passive stack — but it is NOT primarily a nerf: an optimal player still takes the ${OPERATIONS.SLOTS_MAX} richest, so what the cap really removes is the 19 marginal rungs nobody was choosing between. Business fronts are unmetered (capped at ${BUSINESSES.length} by UNIQUE(character,kind) already)`);
  // …at a LEVEL, which means only what that level can actually buy. Rackets carry level gates;
  // the Legit Fronts assets carry none (buyAsset checks cash only), so they are always in the pool.
  // Taking the global best N here would have inflated the early figures by counting rungs a level-1
  // player is barred from — the measurement has to match what the player is choosing between.
  const bestAtLevel = (L) => metered.filter((r) => r.lvl === null || r.lvl <= L)
    .sort((a, b) => b.day - a.day).slice(0, opSlotsOf(L)).reduce((a, r) => a + r.day, 0);
  note('assets', 'the early seats', `lvl 1: $${fmt(Math.round(bestAtLevel(1)))}/day · lvl 20: $${fmt(Math.round(bestAtLevel(20)))}/day · lvl 40: $${fmt(Math.round(bestAtLevel(40)))}/day`,
    `best-affordable-at-that-level, ${opSlotsOf(1)}/${opSlotsOf(20)}/${opSlotsOf(40)} seats. The seat curve, not the price, is now the early bound — a level-1 player with unlimited cash cannot buy past ${OPERATIONS.SLOTS_BASE} operations, which is the "affordability was never the gate" finding turned into a gate. NOTE the Legit Fronts assets have NO level gate (buyAsset checks cash only), so they sit in every one of these pools`);
  const passiveRatio = (bestN(OPERATIONS.SLOTS_MAX) / grindDay).toFixed(1);
  note('assets', 'VERDICT', `${inBand.length} of ${rows.length} in the healthy band, bounded by seats`,
    `nothing here is out of reach; the ladder's ROI now TAPERS (${Math.min(...rows.map((r) => r.payback)).toFixed(2)}d at the on-ramp → ${Math.max(...rows.map((r) => r.payback)).toFixed(2)}d at the apex) instead of paying back inside a sitting at every rung, so a big rung is a commitment rather than a click. The best ${OPERATIONS.SLOTS_MAX} seats run ${passiveRatio}x the top-tier grind — passive still beats active, as capital should, without dwarfing it. The remaining outliers are the ${rows.filter((r) => r.payback < BAND[0]).length} under the band's floor (${rows.filter((r) => r.payback < BAND[0]).map((r) => r.what).join(', ') || 'none'} — the deliberately generous first rungs, plus the business fronts, whose curve the L1a/L1b package already signed separately). The levers are the per-rung income (prototype tables, machine-owned), the ${meterH}h RACKET_DAILY_CAP_MS meter, and OPERATIONS.SLOTS_* (BALANCE.md)`);
}

// ════════ P9.20d THE FAMILY LEDGER — is the family treasury scarce? ════════
// P9.20b asked "which income holding do I buy" at the PERSONAL level and found the answer was
// "all of them, eventually" — nothing competed for a seat, so nothing was a decision. That finding
// produced the operation slots. This probe asks the same question one level up, because the
// strategy package (the watch, the sealed bid, the roster) put every one of its tradeoffs on the
// FAMILY, and a tradeoff only bites if the resource behind it is scarce.
//
// The honest metric is not "how much does a family earn" — it is what each strategic DECISION costs
// measured in DAYS of that family's own income. A decision priced at a fraction of a day is not a
// decision; it is a formality with a confirm dialog. Analytic, from the signed constants — no value
// seeded, section 10.4 untouched.
phase('P9.20d the family ledger — what a family earns against what its decisions cost');
{
  const CORE = 6;                                   // the signed core-district map
  const upkeepKeep = 1 - CONSTANTS.TERRITORY_UPKEEP_BPS / 10000;
  const terrCapH = CONSTANTS.TERRITORY_CAP_MS / 3600000;
  const numbers = TERRITORY_TYPES.find((t) => t.id === 'numbers');   // the signed ×1.0 baseline
  const top = TERRITORY_RACKETS[TERRITORY_RACKETS.length - 1];
  // one operation's NET daily take, at a tier, on the safe type (collect daily, Bureau never comes)
  const terrDay = (tier, type = numbers) => tier.incomePerHr * type.incomeMult * terrCapH * upkeepKeep;

  // ── THE CLIMB, which is the healthy half ──
  // Each rung is funded out of the rung below, so the ladder is a real wait rather than a purchase.
  const climb = TERRITORY_RACKETS.map((t, i) => ({ t, days: i === 0 ? null : t.cost / terrDay(TERRITORY_RACKETS[i - 1]) }));
  note('family', 'the racket climb (one district)',
    climb.slice(1).map((c) => `${c.t.name} ${c.days.toFixed(1)}d`).join(' · '),
    `each tier funded out of the tier below at the safe ${numbers.name} type — ~${climb.slice(1).reduce((a, c) => a + c.days, 0).toFixed(0)}d of daily collecting to take ONE district from ${TERRITORY_RACKETS[0].name} to ${top.name}. This half is sound: the ladder is a wait, not a purchase`);

  // ── STEADY STATE, which is the half worth worrying about ──
  const sovTop = SOV.TIERS[SOV.TIERS.length - 1];
  const sovNet = (held) => held * (sovTop.incomePerDay - sovTop.upkeepPerDay * (1 + (SOV.OVEREXT_BPS / 10000) * Math.max(0, held - 1)));
  const frontierDay = WORLD_NPCS.reduce((a, n) => a + n.regenPerHr * (WORLD.FRONTIER.TRIBUTE_BPS / 10000) * 24, 0);
  const famDay = (held) => held * terrDay(top) + sovNet(held) + frontierDay;
  note('family', 'treasury income at the top', `1 district $${fmt(Math.round(famDay(1)))}/day · 3 $${fmt(Math.round(famDay(3)))}/day · ${CORE} $${fmt(Math.round(famDay(CORE)))}/day`,
    `${top.name} operations net of the ${CONSTANTS.TERRITORY_UPKEEP_BPS / 100}% pad, plus ${SOV.TIERS.length}-tier strongholds net of overextension (which turns NEGATIVE past a few districts — that mechanic works), plus $${fmt(Math.round(frontierDay))}/day of frontier tribute. Member cash tribute and war spoils are on top and player-driven`);

  // ── THE MENU: every strategic decision a family can make, priced in days of its own income ──
  const day6 = famDay(CORE);
  const fortAll = Array.from({ length: CONSTANTS.TERRITORY_FORT_MAX }, (_, l) => CONSTANTS.TERRITORY_FORT_COST_BASE * (l + 1) * top.tier).reduce((a, b) => a + b, 0);
  const estabAll = TERRITORY_RACKETS.reduce((a, t) => a + t.cost, 0);
  const sovAll = SOV.TIERS.reduce((a, t) => a + t.cost, 0);
  // VALUE-AT-STAKE (RE-SIM PASS 2, APPLIED): war + siege now index to what's at stake. War scales with
  // the TARGET's treasury (spoils are WAR_SPOILS of it) — a maxed rival's parked cash is at least a
  // day's income, so day6 is a conservative proxy. Siege scales with the top stronghold's build cost.
  const warScaled = Math.max(M3.WAR_COST, Math.floor(day6 * M3.WAR_COST_BPS / 10000));
  const siegeScaled = Math.max(SOV.SIEGE_COST, Math.floor(SOV.TIERS.at(-1).cost * SOV.SIEGE_COST_BPS / 10000));
  const menu = [
    { what: 'declare war (on a rich rival)', cost: warScaled, recurring: true },
    { what: 'siege a Bastion+ stronghold', cost: siegeScaled, recurring: true },
    { what: 'invade a frontier outpost (floor)', cost: WORLD.FRONTIER.INVADE_BASE, recurring: true },
    { what: 'take an unheld district (floor)', cost: M3.SEIZE_BASE, recurring: true },
    { what: `fortify one operation to ${CONSTANTS.TERRITORY_FORT_MAX}`, cost: fortAll, recurring: false },
    { what: `climb one operation to ${top.name}`, cost: estabAll, recurring: false },
    { what: `build one ${sovTop.name}`, cost: sovAll, recurring: false },
  ];
  for (const m of menu) m.days = m.cost / day6;
  note('family', 'the strategic menu, priced in days of a maxed family\'s income',
    menu.map((m) => `${m.what} ${m.days < 0.01 ? '<0.01' : m.days.toFixed(2)}d`).join(' · '),
    `against $${fmt(Math.round(day6))}/day. The one-time build-out (every operation maxed + fortified + a stronghold on every district) totals $${fmt(Math.round((estabAll + fortAll + sovAll) * CORE))} — about ${(((estabAll + fortAll + sovAll) * CORE) / day6).toFixed(0)} days of income, after which the recurring menu is what is left`);
  const trivial = menu.filter((m) => m.recurring && m.days < 0.01);
  note('family', 'RECURRING decisions costing under 1% of a day', `${trivial.length} of ${menu.filter((m) => m.recurring).length}`,
    trivial.length ? `${trivial.map((m) => `${m.what} ($${fmt(m.cost)})`).join(', ')} — the remaining flat ones are the two the founder deliberately left on the garrison ratchet (invade + take-unheld already scale with the incumbent's garrison, the value at stake). War ($${fmt(warScaled)}) and siege ($${fmt(siegeScaled)}) were INDEXED this pass — war to 2% of the target's treasury, siege to 3% of the stronghold's build cost — so declaring on a rich family is no longer free` : 'none — war + siege are now indexed to the value at stake (RE-SIM PASS 2), and invade/take-unheld ride the garrison ratchet');

  // ── THE ONE COST THAT SCALES, and why it is the model for the rest ──
  // A contest floor is max(SEIZE_BASE, garrison × SEIZE_OUTBID), and the garrison becomes the last
  // WINNING stake — so the price of turf ratchets with how hard it was fought for. That is the only
  // family cost in the game indexed to anything, and it is the shape the flat ones want.
  const ratchet = [];
  let garr = M3.SEIZE_BASE;
  for (let i = 0; i < 6; i++) { ratchet.push(garr); garr = Math.round(garr * M3.SEIZE_OUTBID); }
  note('family', 'the contest ratchet (the one cost that scales)',
    ratchet.map((g) => `$${fmt(g)}`).join(' → '),
    `each contest's floor is max($${fmt(M3.SEIZE_BASE)}, garrison × ${M3.SEIZE_OUTBID}) and the winner's whole stake BECOMES the garrison, so contested turf gets dearer every time it changes hands — after ${ratchet.length} fights it is ${(ratchet[ratchet.length - 1] / M3.SEIZE_BASE).toFixed(0)}× the opening price. THE WATCH multiplies it again (×${M3.WATCH_SURPRISE_MULT} off-window) and THE ROSTER's enforcer adds a flat premium on top`);
  note('family', 'VERDICT', 'war + siege now bite the endgame; the two floors stay on the garrison ratchet',
    `the ladder to the top is a genuine ~${climb.slice(1).reduce((a, c) => a + c.days, 0).toFixed(0)}-day wait per district and the sov overextension pad is a real recurring drain. The P9.20d flat-cost finding (declaring war / sieging cost pocket change for a maxed family) is now RESOLVED for the two fully-flat costs: war indexes to the target's treasury ($${fmt(warScaled)} against a rich rival) and siege to the stronghold's build cost ($${fmt(siegeScaled)} for a Bastion+). Both are founder sign-off levers (M3.WAR_COST_BPS 2% / SOV.SIEGE_COST_BPS 3%, floored at the old constants so the on-ramp is unchanged). The two remaining flat entries (invade + take-unheld) are FLOORS the founder deliberately kept on the garrison ratchet — the incumbent's garrison IS the value at stake there, and a fresh/unheld target being cheap is the turf on-ramp`);
}

// ════════ P9.20c THE NUT — what a crew costs against what a hand actually moves ════════
// The same founder ask, on the one asset a tester called out by name ("same for the kitchen. it's
// unbalanced"). A crew member is bought once ($50k x N) and then draws CREW_WAGE_PER_HR forever,
// but they only EARN while there is stash to move — so the honest metric is not payback, it is the
// ratio of what a hand moves to what a hand costs, at the cadence the owner actually plays.
//
// The asymmetry is the mechanic and it is sharper here than the business pad's: offline SALES are
// capped at OFFLINE_CAP_MS while the NUT runs to CREW_WAGE_CAP_MS, so an absent owner earns a few
// hours and owes a week. Analytic, from the signed constants — no value seeded, section 10.4 untouched.
phase('P9.20c the nut — crew wages against crew earnings, by cadence');
{
  const wage = M4.CREW_WAGE_PER_HR;
  const salesCapH = CONSTANTS.OFFLINE_CAP_MS / 3600000;
  const nutCapH = M4.CREW_WAGE_CAP_MS / 3600000;
  const UNITS_PER_MIN = 1;                       // accrual.js: crew x cappedMin units
  const perHr = (d) => 60 * UNITS_PER_MIN * d.base * 0.8;   // offline sale: base x quality x 0.8, demand pinned 1.0
  const cheapest = DRUGS.slice().sort((a, b) => a.base - b.base)[0];

  note('crew', 'the nut', `$${fmt(wage)}/hr per hand`,
    `flat, on the wall clock, whether the stash moves or not — the recurring sink`);
  note('crew', 'what one hand moves while stocked', `$${fmt(Math.round(perHr(cheapest)))}/hr on ${cheapest.name} (the cheapest line)`,
    `${(perHr(cheapest) / wage).toFixed(1)}:1 against the wage, rising to ${(perHr(DRUGS[DRUGS.length - 1]) / wage).toFixed(0)}:1 on ${DRUGS[DRUGS.length - 1].name} — a STOCKED crew is never the problem`);
  // the cadence table: this is what the tester was feeling
  for (const [label, gapH] of [['every 8h (three check-ins)', 8], ['daily', 24], ['every 3 days (the cold line)', 72]]) {
    const soldH = Math.min(gapH, salesCapH);      // sales are capped at the offline window
    const earn = soldH * perHr(cheapest), owe = gapH * wage;
    note('crew', `1 hand, ${label}`, `${earn > owe ? '+' : ''}$${fmt(Math.round(earn - owe))}/cycle`,
      `banks ${soldH}h of sales ($${fmt(Math.round(earn))}) against ${gapH}h of wages ($${fmt(Math.round(owe))}) = ${(earn / owe).toFixed(2)}:1 on the cheapest line`);
  }
  note('crew', 'the asymmetry', `sales cap ${salesCapH}h — the nut runs to ${nutCapH}h`,
    `${(nutCapH / salesCapH).toFixed(0)}x, sharper than the business pad's 7x. It is the same deliberate fiction (the corner holds a shift's take, the envelope runs a week) and the same defect it had: the game never SAID so. It does now — the rate, the countdown and the door out all ride with the price`);
  note('crew', 'VERDICT', 'attendance, not a trap — once the terms are visible',
    `a stocked, thrice-daily crew runs ${((Math.min(8, salesCapH) * 3 * perHr(cheapest)) / (24 * wage)).toFixed(1)}:1 even on ${cheapest.name}; a daily one is ${((salesCapH * perHr(cheapest)) / (24 * wage)).toFixed(2)}:1 and an absent one bleeds. The levers are CREW_WAGE_PER_HR, CREW_WAGE_CAP_MS (the week the nut runs to) and OFFLINE_CAP_MS (the shift the corner holds) — BALANCE.md`);
}

// ════════ P9.21 THE POPULATION — the npc:seed faucet, measured analytically ════════
// Residents are seeded with cash so the boards aren't dead in an empty alpha. That cash is the one
// new faucet: players extract it by killing residents and looting the body. Bounded by construction
// (TARGET bodies at once × band seed × how fast a player can actually kill), and the bottom two
// bands carry NOTHING lootable because M3.LOOT_MIN_LVL gates the loot at level 10.
phase('P9.21 the population — the npc:seed faucet ceiling');
{
  const totalW = POPULATION.BANDS.reduce((a, b) => a + b.w, 0);
  // expected seed per resident, and the LOOTABLE share (bands under LOOT_MIN_LVL yield nothing)
  let expSeed = 0, expLootable = 0;
  for (const b of POPULATION.BANDS) {
    const mean = (b.seed[0] + b.seed[1]) / 2;
    const share = b.w / totalW;
    expSeed += mean * share;
    // a band is lootable only where its level range clears the loot floor
    const span = b.lvl[1] - b.lvl[0] + 1;
    const over = Math.max(0, b.lvl[1] - Math.max(b.lvl[0], M3.LOOT_MIN_LVL) + 1);
    expLootable += mean * share * (over / span);
  }
  const standing = POPULATION.TARGET * expSeed;
  note('population', 'residents standing', `${POPULATION.TARGET}`, 'headcount the worker holds');
  note('population', 'seed per resident (E)', `$${fmt(expSeed)}`, 'weighted across the four bands');
  note('population', 'cash standing in the city', `$${fmt(standing)}`, 'the whole faucet exposure at any instant');
  note('population', 'LOOTABLE per resident (E)', `$${fmt(expLootable)}`,
    `bands under LOOT_MIN_LVL ${M3.LOOT_MIN_LVL} carry nothing a killer can take`);
  // what a killer actually nets: CASH_LOOT_RATE of pocket, against the ammo a kill costs
  const perKill = expLootable * M3.CASH_LOOT_RATE;
  note('population', 'a killer nets per resident kill', `$${fmt(perKill)}`,
    `${M3.CASH_LOOT_RATE * 100}% of pocket — the same loot surface as a player kill, and the SAME ammo cost applies`);
  note('population', 'faucet posture', perKill < 25000 ? 'petty vs the signed loops' : 'SIGN-OFF: material',
    'compare to the boxing exhibition / territory bands (~$300-400k/day); a resident is scenery with a wallet, not a payday');
  // The standing pool is what's on the street at any instant. Step two made nearly all of it
  // REALIZABLE (a kill leaks only CASH_LOOT_RATE — the estate burns the rest — but a duel/fade win
  // or an order-fill transfers the whole stake), and step three made it RECURRING: the worker
  // retires residents players have picked clean and puts fresh faces in their place.
  //
  // So the faucet is now a RATE, and its ceiling is a per-day headcount of replacements — metering
  // retirements, not dollars seeded, because a retirement is exactly what creates the vacancy a
  // fresh seed pays for (metering dollars would let the day-one fill of an empty city eat the whole
  // allowance before anyone had been robbed).
  const perDay = POPULATION.TURNOVER.PER_DAY * expSeed;
  RESIDENT.seedTurnover = perDay;
  note('population', 'standing pool', `~$${fmt(standing)}`,
    'what is on the street at any instant — step two made ~100% of it realizable (was ~25%: only a kill burns the remainder)');
  note('population', 'RECURRING ceiling', `${POPULATION.TURNOVER.PER_DAY} replacements/day ≈ $${fmt(perDay)}/day`,
    `step three: the city renews itself, so npc:seed is a rate. Bounded by headcount in population_state — the same band as a territory racket (~$300-400k/day) or the boxing purse, and ~${Math.round(perDay / 21600000 * 1000) / 10}% of the passive stack`);
  note('population', 'drained threshold', `${POPULATION.TURNOVER.DRAINED_BPS / 100}% of arrival stake`,
    'measured against what a resident ARRIVED with (npc_seed), never a flat cash floor — a flat floor would recycle the cheap bands on spawn, forever');
}

// ════════ P9.22 THE SEVERANCE — can the Exchange window absorb what the game emits? ════════
// TOKENOMICS v2 severs cash→$OMR. Two features are already built and switched OFF waiting for it:
// the Exchange window (EXCHANGE.OPEN false) and the family yield (FUND_BPS 0). Before building the
// severance, measure whether the window can actually carry the load — because once the AMM buy side
// is gone, the window is the ONLY cash exit for $OMR, and a claim the pool cannot honour is a
// promise the game breaks every time a player clicks it.
//
// The funding side cannot be derived from the constants: the street take is fed by 45 sites across
// 22 modules. So it is MEASURED off a driven population by tools/scale.js and passed in here as a
// per-player-per-day rate (which that harness verified is population-INVARIANT: $34/player/day at
// 12 players, $35 at 36 — so it is a real per-player rate, not an artifact of one size). It is a
// FLOOR: scale.js players follow a fixed script, and a real player trades more than a scripted one.
phase('P9.22 the severance — what the Exchange window can absorb (no faucet above it)');
{
  const TAKE_PER_PLAYER_DAY = 35;   // MEASURED, tools/scale.js — see its census line
  const toWindow = TAKE_PER_PLAYER_DAY * EXCHANGE.FUND_BPS / 10000;
  const omrPerPlayerDay = toWindow / EXCHANGE.RATE;   // what one player's activity can redeem

  note('severance', 'street take (measured floor)', `$${TAKE_PER_PLAYER_DAY}/player/day`,
    `driven population, tools/scale.js; population-invariant across 12 and 36 players. A FLOOR — scripted players trade less than real ones`);
  note('severance', 'reaches the Exchange window', `$${toWindow.toFixed(2)}/player/day`,
    `EXCHANGE.FUND_BPS ${EXCHANGE.FUND_BPS / 100}% of the take`);
  note('severance', 'absorbable at RATE', `${omrPerPlayerDay.toFixed(4)} $OMR/player/day`,
    `at $${EXCHANGE.RATE} cash per $OMR — this is the ONLY cash exit once cash→$OMR is severed`);

  // THE HEADLINE CHANGED WITH THE FAUCET. This probe used to ask "can the window clear what the wage
  // emits?" and answered no until the base was in the thousands. Economy v3 step 1 retired the wage,
  // so there is no emission to clear: the only $OMR that can ever queue at the window is $OMR
  // somebody DEPOSITED (bought). The window stops being an outlet for printed supply and becomes
  // what it should always have been — a cash-side relief valve on bought supply.
  note('severance', 'EMISSION vs ABSORPTION', 'no emission to absorb (v3 step 1)',
    `the wage is retired, so the pressure this probe was built to measure no longer exists. What can reach the window is bounded by what was bought, and that is bounded by the desk`);

  // the per-account cap is not the binding constraint — the pool is. Worth stating, because a cap
  // that never binds reads like a safety rail while the real limit is elsewhere.
  const capCash = EXCHANGE.DAILY_CAP_OMR * EXCHANGE.RATE;
  note('severance', 'per-account daily cap', `${EXCHANGE.DAILY_CAP_OMR} $OMR = $${capCash.toLocaleString()}/day`,
    `~${Math.round(EXCHANGE.DAILY_CAP_OMR / omrPerPlayerDay).toLocaleString()}× what one player's own activity funds — so the POOL binds first and the cap is decorative at any realistic base. Players meet 'dry', never the cap`);

  // THE REFRAME: the window is not where $OMR goes. The sink catalog is — and with no faucet above
  // it, the sink catalog is now the whole demand side of the token.
  const wireDay = WIRE.SUB_TIERS[0].omr / (WIRE.SUB_MS / 864e5);
  const staffDay = ESTATE.STAFF.reduce((a, x) => a + (x.wageOmrDay || 0), 0);
  const recurringDay = wireDay + staffDay;
  const oneOff = ESTATE.TIERS.reduce((a, t) => a + (t.omr || t.cost || 0), 0);
  note('severance', 'RECURRING $OMR sinks per heavy player', `~${recurringDay.toFixed(1)} $OMR/day`,
    `Street Wire ${wireDay.toFixed(1)}/day (base tier) + a full estate staff ${staffDay.toFixed(1)}/day — before auctions, megaproject, respec or vanity, which are unbounded`);
  note('severance', 'one-off personal $OMR sinks', `${oneOff.toLocaleString()} $OMR`,
    `the estate ladder alone; family seals ${GANG_SEALS.reduce((a, t) => a + (t.omr || t.cost || 0), 0)} and the foundation ${FOUNDATION.TIERS.reduce((a, t) => a + (t.omr || t.cost || 0), 0)} sit on top, per family`);

  note('severance', 'THE STANDING FINDING (restated for v3)', 'the window is a relief valve, not the exit',
    `$OMR's real exit is the SINK CATALOG and, for real value, the reserve-backed CHAIN withdrawal. With the faucet retired the window no longer has to keep up with a printer — it only has to serve holders who want out in CASH, and every $OMR it ever sees was bought. Levers: FUND_BPS (how much take reaches it) and RATE (a LOWER rate serves more $OMR per pool dollar). Founder calls — nothing is retuned here`);
}

phase('P9.23 the re-sim — cash as a closed loop (tokenomics v2 step 5)');
{
  // WHY THIS IS SPLIT BY character_id AND NOT INTO "faucets vs sinks": a naive net-per-reason
  // MISREADS the mirrored transfers. `gang:tribute`, `convoy:toll` and `port:toll` are ledgered ONCE
  // (the character's negative row) and the treasury credit is DERIVED by negating it
  // (`invariants.js` `tributeIn`/`tollIn`/`portTollIn`). So a first cut of this probe reported
  // gang:tribute as a $120,000 "sink" for cash that had simply moved into a treasury and still
  // existed. The split below is the one the invariants themselves use — check (a) is character cash,
  // check (b) is gang treasuries. BE PRECISE ABOUT WHAT THE GANG FIGURE IS, because the obvious
  // reading is also wrong: a mirrored transfer has NO gang row at all, so it appears as a character
  // -side OUT and contributes NOTHING to the gang figure. That figure is therefore "gang-bound LEDGER
  // ROWS", not "the treasury delta" -- the treasury really did receive the tribute, it just was not
  // written twice. `runLedgerInvariants` check (b) is the thing that reconciles actual treasuries,
  // and it is what P10 runs.
  const rows = (await pool.query(
    `SELECT reason, SUM(amount) AS net, COUNT(*)::int AS n,
            SUM(CASE WHEN character_id IS NULL THEN amount ELSE 0 END) AS gang_net
       FROM transactions WHERE currency='cash' GROUP BY reason`)).rows
    .map((r) => ({ reason: r.reason, net: Number(r.net), gang: Number(r.gang_net), n: r.n }))
    .map((r) => ({ ...r, chr: r.net - r.gang }));

  if (process.env.SIM_REASON_DUMP) {
    for (const r of rows.slice().sort((a, b) => b.net - a.net)) console.log(`  DUMP ${r.reason} net=${Math.round(r.net)} chr=${Math.round(r.chr)} gang=${Math.round(r.gang)} n=${r.n}`);
  }
  const top = (sel, sign) => rows.filter((r) => sign * sel(r) > 1).sort((a, b) => sign * (sel(b) - sel(a)))
    .slice(0, 5).map((r) => `${r.reason} $${Math.round(Math.abs(sel(r))).toLocaleString()}`).join(' · ');
  const chrNet = rows.reduce((a, r) => a + r.chr, 0);
  const gangNet = rows.reduce((a, r) => a + r.gang, 0);

  note('re-sim', 'the extraction link', 'SEVERED — cash cannot become $OMR',
    `omrMints is {mission:%, prize:omr, emission:%} and NONE takes cash as an input. So every cash faucet flagged for EXTRACTION risk is MOOT on that axis; what survives is the INTERNAL question (pacing, concentration), which is now the only one`);
  note('re-sim', 'character-side cash, net', `$${Math.round(chrNet).toLocaleString()} over the run`,
    `into players: ${top((r) => r.chr, 1)} — out: ${top((r) => r.chr, -1)}`);
  note('re-sim', 'gang-bound rows, net', `$${Math.round(gangNet).toLocaleString()} over the run`,
    `character_id-NULL rows ONLY — in: ${top((r) => r.gang, 1) || 'none'} — out: ${top((r) => r.gang, -1) || 'none'}. NOT the treasury delta: a mirrored transfer (gang:tribute, convoy:toll, port:toll) writes only the character's negative row and the treasury credit is derived, so it is counted on the character side above and nowhere here`);
  note('re-sim', 'what this measures', 'SHAPE, not steady state',
    `a scripted run does what the script does, so this ranks which loops MOVE the most cash; it does NOT predict a real economy's inflation. The per-faucet $/day CEILINGS in P9.8-P9.22 are the numbers to tune against, and P10 below is what proves conservation`);

  // The one thing the severance genuinely REMOVED from the risk register, stated so it is not
  // re-litigated every time a faucet is touched.
  note('re-sim', 'what a cash faucet can no longer do', 'move the token price',
    `pre-v2 the honest worry about any big cash faucet was that it became sell pressure through the swap. It cannot: the sell side is retired and the only cash exit is the Exchange window, which runs the OTHER way ($OMR in, cash out) and is bounded by a till that cash sinks fill. A bigger cash faucet now costs game balance, never token holders`);
  note('re-sim', 'what still needs founder sign-off', 'the internal-balance flags, unchanged',
    `the passive stack (P9.20), the apex world/boxing/racing purses, the port sale curve and the npc:seed recycle (P9.21) are all still live questions about PACING and CONCENTRATION. The severance lowered their stakes; it did not answer them`);
  note('re-sim', 'the $OMR side, now fully separable', '0/day emitted — bonds are the only mint',
    `see the severance block above: with cash out of the picture AND the wage retired (v3 step 1), $OMR supply is decided ONLY by bonds (four walls, ETH in the same transaction) and the sink catalog. Nothing a player can DO in game creates a token, so in-game $OMR can never exceed what was deposited — the whole token model, with neither a cash-shaped back door nor a printer`);
}

// ════════ P9.24 THE BUREAU RETURNS — income-sourced front scrutiny (the dark-risk-layer fix) ════════
// v2 step 2 left the Bureau-raid layer unreachable (scrutiny's only feed was the retired wash);
// founder option (b) re-sources it from INCOME: banking income adds PER_INCOME_DAY heat per full
// operating day's income (tier-normalized, accountant spec ×0.5). This walks the DAILY-collector
// cycle in EXPECTED VALUE, mirroring resolveScrutiny's exact math (roll on the value at the start
// of the window, then decay, then the day's heat) — analytic, no value seeded, §10.4 untouched.
// Re-run after ANY retune of the BUSINESS_SCRUTINY_* / BUSINESS_RAID_* levers.
phase('P9.24 the Bureau returns — income-sourced scrutiny equilibrium (founder option b)');
{
  const K = CONSTANTS.BUSINESS_SCRUTINY_PER_INCOME_DAY;                  // heat per operating day banked
  const D = CONSTANTS.BUSINESS_SCRUTINY_DECAY_HR * 24;                   // decay per day
  const thr = CONSTANTS.BUSINESS_RAID_THRESHOLD, cap = CONSTANTS.BUSINESS_SCRUTINY_MAX;
  const p = CONSTANTS.BUSINESS_RAID_P_PER_MIN;
  let stackTax = 0, stackGross = 0;
  for (const b of BUSINESSES) {
    const top = b.tiers[b.tiers.length - 1];
    const daily = top.incomePerHr * 24;
    // E[days to first raid] from cold, collecting daily — a renewal cycle since a raid resets to 0
    let scr = 0, alive = 1, eDay = 0, day = 0;
    while (alive > 1e-6 && day < 400) {
      day++;
      const hrsAbove = Math.min(24, Math.max(0, (scr - thr) / CONSTANTS.BUSINESS_SCRUTINY_DECAY_HR));
      const pDay = 1 - Math.pow(1 - p, hrsAbove * 60);
      eDay += alive * pDay * day;
      alive *= (1 - pDay);
      scr = Math.min(cap, Math.max(0, scr - D) + K);
    }
    const cycle = eDay + alive * 400;                                    // days per raid, daily collector
    const raidCost = daily + top.cost * CONSTANTS.BUSINESS_RAID_FINE_RATE; // the seized pending day + the fine
    const taxDay = raidCost / cycle;
    stackTax += taxDay; stackGross += daily;
    note('bureau', `${b.kind} t${b.tiers.length} (daily collector)`,
      `a raid ~every ${cycle.toFixed(1)}d ≈ $${fmt(Math.round(taxDay))}/day (${(taxDay / daily * 100).toFixed(1)}% of gross)`,
      `heat +${K}/operating day vs −${D}/day decay; a raid seizes the pending day ($${fmt(daily)}) + fines ${CONSTANTS.BUSINESS_RAID_FINE_RATE * 100}% of tier cost ($${fmt(Math.round(top.cost * CONSTANTS.BUSINESS_RAID_FINE_RATE))}); collect more often and the seized pending shrinks (the heat total is income-normalized, so cadence can't game IT)`);
  }
  note('bureau', 'the 5-front stack, raid tax total', `~$${fmt(Math.round(stackTax))}/day (${(stackTax / stackGross * 100).toFixed(1)}% of gross)`,
    `uniform-in-probability, size-scaled-in-cost by construction — on top of the L1b progressive pad; the passive stack (P9.20) is no longer risk-free. Dial: BUSINESS_SCRUTINY_PER_INCOME_DAY (0 restores the dormant state)`);
}

// ════════ P9.25 RESIDENTS AS MARKS — the Street War step-two faucet ceiling (analytic) ════════
// Residents now OWN things (omerta-street-rivals-design.md §4): sleepy-joint fronts, band-priced
// beaters, dinghies, self-bought freight. Each is a deliberate bounded faucet (the npc:seed /
// NPC-trucking posture) — this prints the base-wide analytic CEILING from the constants so any
// retune of POPULATION.MARKS.* / RIVALS.* is re-measured. No value seeded; §10.4 untouched.
phase('P9.25 residents-as-marks — the step-two faucet ceilings');
{
  const Mk = POPULATION.MARKS;
  const bandW = Object.fromEntries(POPULATION.BANDS.map((b) => [b.id, b.w / POPULATION.BANDS.reduce((a, x) => a + x.w, 0)]));
  const T = POPULATION.TARGET;
  // FRONTS: only rob/shakedown/inside realize a resident front, all bounded by the SCALED pending
  // regen. Ceiling = scaled daily income × the max realizable share (3 rob visits/day × 15% of a
  // 24h-capped pending ≈ 45%/day of the scaled curve; shakedown at 30% is the harder-mult variant
  // of the SAME shared window, so 45% (rob cadence) → 90% (shakedown cadence) brackets it — print
  // the shakedown-cadence worst case as THE ceiling).
  let frontDay = 0, frontCount = 0;
  for (const [band, [kind, tier]] of Object.entries(Mk.FRONTS)) {
    const cat = BUSINESSES.find((b) => b.kind === kind); if (!cat) continue;
    const scaledDay = cat.tiers[tier - 1].incomePerHr * 24 * Mk.FRONT_INCOME_BPS / 10000;
    const expected = T * (bandW[band] || 0) * (Mk.FRONT_P[band] || 0);
    frontDay += expected * scaledDay * 0.9;  // ≤90%/day realizable (3 shakedown visits × 30% of a 24h pending)
    frontCount += expected;
  }
  RESIDENT.marksFronts = frontDay;
  note('marks', 'resident FRONTS (rob/shakedown ceiling)', `~$${fmt(Math.round(frontDay))}/day base-wide across ~${frontCount.toFixed(1)} sleepy joints`,
    `each front runs at FRONT_INCOME_BPS (${Mk.FRONT_INCOME_BPS / 100}%) of the catalog curve and only ever REALIZES through the shared-window rob/shakedown/inside redirect — residents never collect. Dials: FRONT_INCOME_BPS, FRONT_P, the band FRONTS map`);
  // CARS: standing stock ≈ one beater per marked resident, replenished only by TURNOVER — the
  // melt/fence value of a stolen beater is the realized faucet.
  const carEV = Object.entries(Mk.CAR_VAL).reduce((a, [band, [lo, hi]]) => a + (bandW[band] || 0) * (Mk.CAR_P[band] || 0) * (lo + hi) / 2, 0)
    / Object.keys(Mk.CAR_VAL).reduce((a, band) => a + (bandW[band] || 0) * (Mk.CAR_P[band] || 0), 0);
  const carsPerDay = POPULATION.TURNOVER.PER_DAY * Object.entries(Mk.CAR_P).reduce((a, [band, pp]) => a + (bandW[band] || 0) * pp, 0);
  RESIDENT.marksCars = { perDay: carsPerDay, ev: carEV };
  note('marks', 'resident CARS (steal→melt ceiling)', `~${carsPerDay.toFixed(1)} beaters/day replenished (mean value ~$${fmt(Math.round(carEV))}; melt realizes well under half)`,
    `bounded by the turnover cap × band P × the victim shield (one vehicle/day per resident) — petty by design; conservation holds via rng_audit npc:car grant/retire rows`);
  // BOATS: dinghy resale is the realized faucet, same turnover bound.
  const boatPerDay = POPULATION.TURNOVER.PER_DAY * Object.entries(Mk.BOAT_P).reduce((a, [band, pp]) => a + (bandW[band] || 0) * pp, 0);
  RESIDENT.marksBoats = boatPerDay * boatResale('dinghy');
  note('marks', 'resident BOATS (steal→resale ceiling)', `~${boatPerDay.toFixed(1)} dinghies/day × $${fmt(boatResale('dinghy'))} resale ≈ $${fmt(Math.round(boatPerDay * boatResale('dinghy')))}/day`,
    `always the cheapest hull; bounded by turnover + the SHARED vehicle shield. Dial: BOAT_P`);
  // FREIGHT is recycle-only (bought with seed cash at the real market rail) — a redistribution of
  // the already-measured npc:seed stock, not a new faucet; printed for the record, not summed.
  note('marks', 'resident FREIGHT', 'recycle-only (goods:buy from their own seed cash)', 'the robbery realizes what the resident already paid — rides the P9.21 npc:seed measurement, no new emission');
}

// ════════ P9.26 STREET LIFE — the corner faucet ceiling + the recycle-only call (analytic) ════════
// WORD ON THE STREET (task #318) pays CORNER.CASH + CORNER.RESPECT per envelope, hard-bounded at
// CORNER.MAX_DAY claims a day per street (the claimed-count gate at claim time). THE CALL moves
// only the NPC contact's OWN cash (both legs ledgered contact:* with counterparty) — a recycle of
// the P9.21 npc:seed stock, not emission. Printed from the constants so a retune is re-measured.
phase('P9.26 street life — the corner ceiling + the call');
{
  const cornerDay = CORNER.MAX_DAY * CORNER.CASH;
  note('street life', 'THE CORNER (per-street daily ceiling)', `$${fmt(cornerDay)}/day + ${CORNER.MAX_DAY * CORNER.RESPECT} respect/day`,
    `MAX_DAY (${CORNER.MAX_DAY}) × CASH ($${CORNER.CASH}) — petty by design (the social-tasks posture: the POINTER + the respect drip are the product); every claim needs REAL counted work after accepting. Dials: MAX_DAY, CASH, RESPECT`);
  // THE CHAIN folds its bonus into the completing claim's OWN ledger row, so it cannot widen the
  // MAX_DAY claim cap — the per-day ceiling is the number of chains that can COMPLETE in a day.
  // A chain advances at most once per district per day AND needs a claim there, so advances/day is
  // bounded by min(districts, MAX_DAY); completions/day is that over CHAIN_STEPS.
  const advDay = Math.min(DISTRICTS.length, CORNER.MAX_DAY);
  const chainDay = (advDay / CORNER.CHAIN_STEPS) * CORNER.CHAIN_BONUS;
  note('street life', 'THE CHAIN (per-street daily ceiling, on top)', `~$${fmt(Math.round(chainDay))}/day + ~${Math.round((advDay / CORNER.CHAIN_STEPS) * CORNER.CHAIN_RESPECT)} respect/day`,
    `a chain completes every CHAIN_STEPS (${CORNER.CHAIN_STEPS}) days a street shows up at that district, and advances at most once per district per day gated by a real claim — so at most min(districts ${DISTRICTS.length}, MAX_DAY ${CORNER.MAX_DAY}) = ${advDay} advances/day ≈ ${(advDay / CORNER.CHAIN_STEPS).toFixed(2)} completions/day × $${fmt(CORNER.CHAIN_BONUS)}. The bonus rides the completing claim's OWN corner:job row (the First-Week capstone fold), so the claim cap still bounds it. Dials: CHAIN_BONUS, CHAIN_RESPECT, CHAIN_STEPS`);
  note('street life', 'THE CALL', 'recycle-only (paid from the contact\'s own pocket)',
    `freight pays base × ${CONTACTS.CALL_FREIGHT_PREMIUM_BPS / 10000} of goods the player really hauls; visit tips $${CONTACTS.VISIT_TIP} — both legs contact:* transfers netting zero, bounded by the P9.21 npc:seed stock`);
}

// ════════════════ P9.27 STREET WAR step three — THE TAKE ════════════════
// The founder-directed re-sourcing: a job's cash comes off the drawn MARK first and the §7.2 faucet
// only covers the remainder. The PAYOUT is unchanged, so this is measured as an EMISSION REDUCTION,
// not a balance change — the interesting number is what share of crime stops being a mint.
phase('P9.27 street war step three — the take (crime re-sourced off the marks)');
{
  const T = RIVALS.TAKE;
  // A resident funds min(take, POCKET_BPS of pocket). Across the band mix the seed pool is a STOCK
  // (~the P9.21 figure), so the honest ceiling on how much crime it can fund is that stock's
  // turnover, not a per-job share — beyond it every job falls back to the faucet.
  const meanSeed = POPULATION.BANDS.reduce((a, b) => a + b.w * (b.seed[0] + b.seed[1]) / 2, 0)
    / POPULATION.BANDS.reduce((a, b) => a + b.w, 0);
  const perJobCap = Math.floor(meanSeed * T.POCKET_BPS / 10000);
  note('street war', 'THE TAKE — what one mark can fund', `$${fmt(perJobCap)} per job at the mean resident`,
    `min(take, POCKET_BPS ${T.POCKET_BPS / 100}% of pocket), floor $${T.MIN}. A rich mark funds a whole job; a picked-clean one funds nothing and the faucet pays — so crime NEVER pays less, it just stops being a mint when there is somebody to take it from`);
  note('street war', 'THE TAKE — emission effect', 'a REDUCTION, bounded by the resident seed stock',
    `every funded dollar is a TRANSFER (both legs ledgered crime:take, netting zero) that would otherwise have been a crime:<id> FAUCET row. Total funded is bounded by the same metered seed pool P9.21 sizes (~$${fmt(Math.round(POPULATION.TURNOVER.PER_DAY * meanSeed))}/day of replacement), so the take can only ever SHRINK crime's contribution to supply — never widen it`);
  note('street war', 'REVENGE, with teeth', `atk ×${RIVALS.REVENGE_ATK_MULT}, a revenge ROB takes ${(RIVALS.ROB_RATE_BPS / 100 * RIVALS.REVENGE_CUT_MULT).toFixed(1)}%`,
    `rob-only (a boosted shakedown would breach its signed ${RIVALS.SHAKEDOWN_RATE_BPS ? RIVALS.SHAKEDOWN_RATE_BPS / 100 : 30}% ceiling) and on the SAME shared per-venue window, so the signed per-venue extraction bound is untouched; the venue clock advances by the same boosted rate, so the redirect stays emission-neutral. Self-limiting: landing the strike records it, settling the debt`);
}

// ════════ P9.28 JAILBIRDS × bust:reward — the faucet the onboarding fix made REACHABLE ════════
// JAILBIRDS (task #308) added no reason and no new formula: it keeps POPULATION.JAILBIRDS.TARGET
// residents serving a sentence so the §7.8 bust verb and its dailies are completable solo. What it
// DID do is make the pre-existing `bust:reward` faucet reachable on demand, and that faucet is
// `500 + remaining×15` — LINEAR in the sentence — while the success chance is CLAMPED at 0.10. So
// the two do not offset: EV rises without bound in `remaining` until the clamp binds and then keeps
// rising. The commit note estimated "a few $k/hour shared"; this measures it from the real
// constants so a retune of MIN_S/MAX_S/TARGET (or of the reward line) is re-measured every run.
phase('P9.28 jailbirds × bust:reward — the reachable §7.8 faucet');
{
  const jb = POPULATION.JAILBIRDS;
  // the live bust() line, restated: chance = clamp(0.7 − r/400 + busts×0.03 + event, .10, .90)
  const chanceAt = (r, busts) => Math.max(0.10, Math.min(0.90, 0.7 - r / 400 + busts * 0.03));
  const rewardAt = (r) => Math.floor(500 + r * 15);
  // Which sentence length does a rational camper WANT? Sweep the spawn band.
  let best = { ev: -1 };
  for (let r = jb.MIN_S; r <= jb.MAX_S; r += 10) {
    const ev = chanceAt(r, 0) * rewardAt(r);
    if (ev > best.ev) best = { ev, r, p: chanceAt(r, 0), reward: rewardAt(r) };
  }
  note('jailbirds', 'best sentence to camp', `${best.r}s → $${fmt(best.reward)} at ${(best.p * 100).toFixed(0)}%`,
    `EV $${fmt(Math.round(best.ev))}/attempt. The reward is LINEAR in the sentence while the chance FLOORS at 10%, so the longest spawn is always the most profitable — the two terms do not offset. Dials: the reward line (500 + r×15) or JAILBIRDS.MAX_S`);
  // The real bound is SUPPLY, not attempts: the worker tops up to TARGET once an HOUR, and a failed
  // attempt jails the buster for M3.BUST_FAIL_JAIL_S so they cannot spam either. A bird also WALKS
  // after its own sentence, so a camper gets floor(sentence / fail-jail) tries at it.
  // A failed bust jails the buster for BUST_FAIL_JAIL_S and a jailed player cannot bust ("You're in
  // the same cage"), so attempts are exactly that far apart. Best case the camper is there when the
  // bird lands, giving one attempt at t=0 and one per fail-jail after — `floor(r/fail) + 1`. This is
  // a CEILING, so it takes the best case rather than a conservative average.
  const tries = Math.floor(best.r / M3.BUST_FAIL_JAIL_S) + 1;
  const landP = 1 - (1 - best.p) ** tries;              // at least one success before it walks
  const perBird = landP * best.reward;
  const perDay = jb.TARGET * 24 * perBird;               // hourly worker tick, TARGET birds a tick
  RESIDENT.jailbirds = perDay;
  note('jailbirds', 'city-wide ceiling', `~$${fmt(Math.round(perDay))}/day`,
    `TARGET ${jb.TARGET} birds × 24 hourly ticks × $${fmt(Math.round(perBird))} expected each (${tries} attempts before it walks at ${(best.p * 100).toFixed(0)}% ⇒ ${(landP * 100).toFixed(0)}% land). SHARED city-wide and first-come, so it is one player's income only in a thin alpha — which is exactly when it is live. That is an order of magnitude above the "a few $k/hour" the drop estimated, because the estimate did not carry the reward's linear term in MAX_S`);
  note('jailbirds', 'cost side', 'no energy, no nerve, no ammo — only the fail-jail',
    `a failed bust costs ${M3.BUST_FAIL_JAIL_S}s of lockup and nothing else, so the loop is time-metered rather than resource-metered; unlike every other faucet at this scale it spends no signed resource. Founder call — flagged, NOT retuned (ground rule #1)`);
}

// ════════════════ P9.29 THE FARM — RETIRED WITH THE FAUCET IT MEASURED ════════════════
// This probe measured the Street Wage under Sybil pressure and returned the finding that killed it:
// the per-account cap is ANTI-CONCENTRATION, so it pays a farm of 100 cheap identities strictly
// better than one real player, and every wall we added (the mint fee, the level floor, the score
// floor) taxed the farm without ever making it unprofitable — measured payback 1.0 day at the
// 0.01-ETH mint price. Economy v3 step 1 retired the faucet, so there is nothing left to farm and
// nothing left to measure. The full numbers are preserved in BALANCE.md § THE FARM.
phase('P9.29 the farm — RETIRED (the wage it measured no longer exists)');
note('the farm', 'the Street Wage', 'retired (economy v3 step 1)',
  'the probe that measured it is retired with it — see BALANCE.md § THE FARM for the numbers, and '
  + 'omerta-economy-v3-design.md §2 wall 1 for what replaced it: no faucet at all, so in-game $OMR '
  + 'can never exceed what was deposited');

// ══════ P9.30 THE FLOAT — the tiered loot rate, re-measured (economy v3 step 5, design §9.5) ══════
// The design instructs a re-sim of the loot rate at this step, because §5's whole argument is that
// holding $OMR must be EXPOSED rather than safe, and the old flat 0.20 was sized when the Street Wage
// was the main source. Analytic (the P9.8/P9.20 precedent — zero value seeded, §10.4 untouched).
//
// THE FRAMING CHANGED, and that is what changed the answer. Before the severance a hunter spent cash
// (convertible to $OMR, so real) to take $OMR. After it, cash CANNOT become $OMR at any price — so a
// hunter now spends a resource with no real-money value to gain one that has it. The old "kill EV in
// dollars" number (−$72k standalone, D1) is therefore no longer the right question for the $OMR side:
// the cost is nearly free in real terms, so hunting does not need a high rate to be worth doing. It
// needs a rate that leaves something to hunt.
phase('P9.30 the float — the tiered loot rate + what the Made Man and the stake lock up');
{
  const idle = M3.OMR_LOOT_IDLE, comm = M3.OMR_LOOT_COMMITTED;
  const holder = 200; // a plausible mid-whale float, in $OMR
  note('float', 'loot rate — IDLE (loose + unbonding)', `${(idle * 100).toFixed(0)}%`,
    `a ${holder} $OMR loose balance pays a killer ${fmt(Math.floor(holder * idle))} $OMR. Hoarding is the punished behaviour — and this is also what a bond's fresh, unvested $OMR is worth to a hunter`);
  note('float', 'loot rate — COMMITTED (staked)', `${(comm * 100).toFixed(0)}%`,
    `the same ${holder} $OMR STAKED pays ${fmt(Math.floor(holder * comm))} — ${(idle / comm).toFixed(1)}x less. Staking is no longer a SAFE HARBOUR, it is a cheaper one; §4.1 admits no fourth way for $OMR to move`);
  // The commit decision, stated as the player faces it: what does committing actually save?
  note('float', 'the commit tradeoff', `${fmt(Math.floor(holder * (idle - comm)))} $OMR saved per death`,
    `on a ${holder} float. BOTH answers help the economy: committing drives velocity (the one KPI), staying liquid feeds the hunters — which is why the rate is tiered rather than flat`);
  // The self-protecting new player, and the reason no rule was needed for it.
  note('float', 'a new street holding nothing', '0 $OMR',
    'exposure is proportional to IDLENESS, not to wealth, so a fresh character is worth nothing to hunt — automatic new-player protection with no rule, and whales become the rational prey');
  // The float the two mechanisms actually create. This is the number the design's §5 exists to move.
  const perSubYear = MADE.OMR * (365 * 86400000 / MADE.MS);
  note('float', 'THE MADE MAN — recurring demand', `${MADE.OMR} $OMR / ${Math.round(MADE.MS / 86400000)}d`,
    `≈ ${fmt(Math.round(perSubYear))} $OMR per subscriber per year, CONTINUOUS rather than one-off — and every dues payment recycles to the desk (step 2) to be sold again, so it is turnover, not destruction`);
  note('float', 'THE ACCESS STAKE — locked, visible, lootable', `${ACCESS_STAKE.HIGH_OMR} $OMR per high-stakes seat`,
    `held, not spent, so it earns the house nothing — its whole job is a permanent float attached to exactly the players worth hunting. A killer takes ${fmt(Math.floor(ACCESS_STAKE.HIGH_OMR * comm))} of it`);
  // The honest limit on this probe, stated rather than left for a reader to assume.
  note('float', 'what this probe cannot measure', 'whether whales actually commit',
    'the rate is self-balancing BY DESIGN (as whales learn to commit, typical scores fall and hunters must hunt more) but the equilibrium depends on real player behaviour — watch realised $OMR loot per kill in the alpha, not this arithmetic');
}

// ════════ P9.31 THE HIRED GUNS — apex raids made SOLO-realizable (the fillHeist twin) ════════
// A leader hires up to HIRE_MAX NPC merc(s) into a co-op raid: their firepower COUNTS in the roll (the
// unblock — a soloist cracks an apex outfit a thin alpha has no crew for) but they forfeit their cut and
// pay no energy/ammo, so a solo takes the WHOLE pot. The HIRE_FEE is a `world:hire` cash SINK against it.
// EMISSION-SAFE by construction: the base-wide ceiling is still REGEN (P9.8) — hired guns change only
// WHO can tap it (solo vs 2 coordinated players), not the metered quantity. The fee nets the solo faucet.
phase('P9.31 the hired guns — apex raids made solo-realizable (founder SIGN-OFF, a new emission surface)');
{
  // the MINIMUM unblock is (COOP_MIN − 1) guns (a soloist with no real teammates); more guns buy only odds.
  const minGuns = Math.min(WORLD.HIRE_MAX, Math.max(0, WORLD.COOP_MIN - 1));
  const minCost = minGuns * WORLD.HIRE_FEE, maxCost = WORLD.HIRE_MAX * WORLD.HIRE_FEE;
  // resident-ENABLED, regen-bounded: hired guns don't widen the world:raid faucet (still ≤ regen), they
  // only make the coop-only apex reservoirs SOLO-realizable. Summed as an adjacent, not a population faucet.
  RESIDENT.apexWorldCeil = WORLD_NPCS.filter((n) => n.coop).reduce((a, f) => a + f.regenPerHr * 24, 0);
  for (const f of WORLD_NPCS.filter((n) => n.coop)) {
    const grab = Math.min(Math.floor(f.max * WORLD.GRAB_BPS / 10000), WORLD.GRAB_MAX);
    const netMin = grab - minCost; // a solo takes the WHOLE grab; the cheapest crew is minGuns hired
    const ceilDay = f.regenPerHr * 24;  // UNCHANGED — the base-wide ceiling is still regen (shared)
    note('hired-guns', `${f.name} (lvl ${f.minLvl})`, `net $${fmt(netMin)}/landed solo raid (min crew)`,
      `grab $${fmt(grab)} − $${fmt(minCost)} (${minGuns}×$${fmt(WORLD.HIRE_FEE)}, the cheapest crew); the entry apex's grab is under the fee, so a solo needs a real teammate — apex reservoirs go +EV. Base-wide ceiling still ≤ $${fmt(ceilDay)}/day (regen), so only WHO taps it changed`);
  }
  note('hired-guns', 'the fee is the dial', `$${fmt(minCost)}–$${fmt(maxCost)} to field a bought crew`,
    `HIRE_FEE/HIRE_MAX are founder sign-off levers — a real cash sink pricing solo access to a coop-only reservoir; extra guns above the min buy only ODDS (their firepower counts). A hired gun forfeits its cut so the co-op faucet only SHRINKS per real head, §10.4-neutral vs a real crew`);
}

// ════════ P9.32 THE RESIDENT ECONOMY — one consolidated base-wide emission ceiling ════════
// The resident-facing faucets grew one drop at a time (P9.21 seed turnover, P9.25 marks, P9.26 corner,
// P9.28 jailbirds, the blood war, the hired guns), each measured in isolation. This SUMS them so the
// founder reads ONE number for "how much can the NPC layer put into the economy per day", and its ratio
// to the passive stack (P9.20) — the anchor that says whether a faucet is a rounding error or a rival.
// It re-uses each probe's OWN computed total (the RESIDENT accumulator above), so there is no second
// formula to drift; a retune of any resident lever moves this ceiling automatically. Nothing is seeded.
//
// THREE CATEGORIES, kept apart on purpose:
//  (A) NEW EMISSION the resident population itself creates — cash minted into the game that would not
//      exist without residents: the seed pool players loot (turnover-metered) + the sleepy-joint fronts
//      they rob. These are the honest headline.
//  (B) resident-ENABLED but REGEN-bounded — faucets that ride ANOTHER pillar's shared reservoir, which
//      residents make reachable but do not enlarge: jailbirds (§7.8 bust:reward), the blood war
//      (family:raid), and the hired-gun apex world raids. Their ceiling is the reservoir's regen, the
//      same with or without residents, so they are listed but NOT summed into (A).
//  (C) TRANSFERS — resident interactions that move existing value and net zero: THE TAKE (crime
//      re-sourced off a mark, P9.27), the contact call / THE FAVOR / freight robbery. Zero new supply.
phase('P9.32 the resident economy — the consolidated base-wide ceiling');
{
  // GUARD the accumulator against silent drift: this probe SUMS values assigned by earlier probe
  // blocks (P9.21/P9.25/P9.28/blood-war/hired-guns). If any of those is removed or its assignment
  // renamed, its key is `undefined`, `Math.round(undefined)` is NaN, and the headline prints NaN with
  // nothing failing — the exact "a check that can't see its own subject" class. So assert every key is
  // populated and finite BEFORE summing, naming any that a probe dropped. (marksCars is an object.)
  const need = { seedTurnover: RESIDENT.seedTurnover, marksFronts: RESIDENT.marksFronts,
    marksCarsPerDay: RESIDENT.marksCars?.perDay, marksCarsEv: RESIDENT.marksCars?.ev,
    marksBoats: RESIDENT.marksBoats, jailbirds: RESIDENT.jailbirds,
    familyRaidCeil: RESIDENT.familyRaidCeil, apexWorldCeil: RESIDENT.apexWorldCeil };
  const missing = Object.entries(need).filter(([, v]) => !Number.isFinite(Number(v))).map(([k]) => k);
  if (missing.length) {
    console.error(`\n🚨 P9.32: the RESIDENT accumulator is missing ${missing.join(', ')} — a resident probe `
      + 'was removed or its assignment renamed, so the consolidated ceiling would print NaN. Re-wire it.');
    await app.close(); process.exit(1);
  }
  const PASSIVE_STACK = 21_600_000;   // P9.20, post-severance net (the anchor; see the note at P9.21)
  // (A) new emission. Cars/boats are a bounded ADDENDUM: a stolen beater is realized by melt→ammo or
  // fence→cash, so its CASH-equivalent is a fraction of book value; CAR_REALIZE is a conservative,
  // clearly-labelled discount (fence/melt-to-ammo well under half), not a signed lever.
  const CAR_REALIZE = 0.4;
  const carsDay = RESIDENT.marksCars.perDay * RESIDENT.marksCars.ev * CAR_REALIZE;
  const cashFaucets = RESIDENT.seedTurnover + RESIDENT.marksFronts;   // unambiguous cash
  const vehicleAddendum = carsDay + RESIDENT.marksBoats;              // realization-discounted
  const newEmission = cashFaucets + vehicleAddendum;
  note('resident economy', '(A) NEW EMISSION — cash faucets', `~$${fmt(Math.round(cashFaucets))}/day`,
    `npc:seed turnover $${fmt(Math.round(RESIDENT.seedTurnover))}/day (P9.21) + marks fronts $${fmt(Math.round(RESIDENT.marksFronts))}/day (P9.25) — the two unambiguous cash faucets the NPC population mints`);
  note('resident economy', '(A) NEW EMISSION — vehicle addendum', `~$${fmt(Math.round(vehicleAddendum))}/day`,
    `stolen resident cars (${RESIDENT.marksCars.perDay.toFixed(1)}/day × ~$${fmt(Math.round(RESIDENT.marksCars.ev))} book × ${CAR_REALIZE} realize = $${fmt(Math.round(carsDay))}) + boats (resale $${fmt(Math.round(RESIDENT.marksBoats))}); CAR_REALIZE ${CAR_REALIZE} is a labelled melt/fence discount, not a lever`);
  note('resident economy', '(A) HEADLINE — total new emission', `~$${fmt(Math.round(newEmission))}/day base-wide`,
    `${(newEmission / PASSIVE_STACK * 100).toFixed(1)}% of the $${fmt(PASSIVE_STACK)}/day passive stack (P9.20). The entire NPC population mints roughly ONE small territory racket's worth of new cash a day — a rounding error against the passive economy, bounded by POPULATION.TURNOVER.PER_DAY × band seed and the marks front redirect`);
  // (B) resident-ENABLED, regen-bounded — the reservoir's regen is the ceiling, residents change only reach.
  note('resident economy', '(B) regen-bounded (NOT summed)', `jailbirds ~$${fmt(Math.round(RESIDENT.jailbirds))}/day · blood war ≤ $${fmt(Math.round(RESIDENT.familyRaidCeil))}/day · hired-gun apex ≤ $${fmt(Math.round(RESIDENT.apexWorldCeil))}/day`,
    `each rides another pillar's shared reservoir (§7.8 bust pool, family war_pool, world outfit regen) — the ceiling is that reservoir's REGEN with or without residents, so residents change WHO taps it, not the metered quantity. Excluded from the headline to avoid double-counting the World/Pen/blood-war ceilings`);
  // (C) transfers — existing value moved, net zero.
  note('resident economy', '(C) transfers (net-zero)', 'THE TAKE (P9.27) · the call · THE FAVOR · freight robbery',
    'each moves value that already exists (a mark funds a crime, a contact pays from their own seed, a robbery realizes goods the resident already bought) — both legs ledger, netting zero. THE TAKE strictly SHRINKS crime emission by re-sourcing it off the marks. No new supply');
  note('resident economy', 'extraction ≤ inflow', 'unaffected', 'every faucet here is in-game cash/goods, none touches the $OMR withdrawal rail; the full-reserve queue bound is orthogonal and untouched');
}

// ════════ P9.33 D14 — the crime-stat faucet, tracked (SIGNED as-is; re-measured every run) ════════
// D14 steepened the crime-roll stat coefficients (M3.CRIME_STAT), EV-neutral at a mid build but lifting
// the maxed tail — so base-wide crime cash rises. The founder SIGNED it as-is (2026-08-06); this probe
// prints the delta every run so any later crime/stat/OFFSET change re-measures the faucet analytically
// (the den/kill-EV precedent — no value seeded, §10.4 untouched). The chance formula mirrors doCrime's
// STANDARD approach (successMult 1): chance = min(0.97, base + cun×CUN + spd×SPD − OFFSET); E[$]/nerve =
// chance × avg(cash) / nerve, averaged over the crimes a build's level can attempt.
phase('P9.33 D14 the crime-stat faucet — base-wide lift, signed as-is (re-measured every run)');
{
  const cs = M3.CRIME_STAT;
  const OLD = { CUN: 0.004, SPD: 0.002, OFFSET: 0 };           // the pre-D14 signed curve
  // a rational player at a given build picks the BEST $/nerve crime they can attempt — that is what the
  // faucet actually realizes (a mean over every crime dilutes it with trivially-capped low jobs).
  const dollarsPerNerve = (coef, cun, spd, lvl) => {
    let best = 0;
    for (const c of CRIMES) {
      if (c.lvl > lvl) continue;
      const chance = Math.min(0.97, Math.max(0, c.base + cun * coef.CUN + spd * coef.SPD - coef.OFFSET));
      best = Math.max(best, chance * ((c.cash[0] + c.cash[1]) / 2) / c.nerve);
    }
    return best;
  };
  const builds = [
    { name: 'fresh 5/5 (lvl 3)', cun: 5, spd: 5, lvl: 3, w: 0.2 },
    { name: 'mid 12/12 (lvl 25)', cun: 12, spd: 12, lvl: 25, w: 0.6 },
    { name: 'maxed 25/25 (lvl 50)', cun: 25, spd: 25, lvl: 50, w: 0.2 },
  ];
  let num = 0, den = 0;   // cash-weighted: total EXTRA dollars / total dollars = the true faucet lift
  for (const b of builds) {
    const nw = dollarsPerNerve(cs, b.cun, b.spd, b.lvl);
    const old = dollarsPerNerve(OLD, b.cun, b.spd, b.lvl);
    const delta = old > 0 ? (nw / old - 1) : 0;
    num += b.w * old * delta; den += b.w * old;   // weight each build by its cash throughput, not its head count
    note('D14 crime-stat', b.name, `${(delta * 100 >= 0 ? '+' : '') + (delta * 100).toFixed(1)}%`, `$/nerve new $${(nw).toFixed(2)} vs old $${(old).toFixed(2)}`);
  }
  const baseWide = den > 0 ? num / den : 0;
  note('D14 crime-stat', 'base-wide (cash-weighted, 20/60/20 pop)', `${(baseWide * 100 >= 0 ? '+' : '') + (baseWide * 100).toFixed(1)}%`,
    `SIGNED as-is 2026-08-06 — the maxed tail earning more on hard jobs, bounded by NERVE, small vs the passive stack. §10.4 untouched (success-rate only). Re-anchoring CRIME_STAT.OFFSET (${cs.OFFSET}) higher trades this for a fresh/mid hit — no free lunch. Reverting to {CUN:0.004,SPD:0.002,OFFSET:0} restores the pre-D14 curve`);
}

// ════════ P9.34 THE ACTIVATION MODEL — the treasury→stock rate card (design-stage sizing) ════════
// The Dynasty Machine's activation burn (design §8; NOT built — the burn ships with Phase B/A1) is
// sized ANALYTICALLY off the LIVE router levers so any retune of a treasury slice re-measures the
// model before a line of it is built (the P9.29/P9.33 precedent — no value seeded, §10.4 untouched).
// The one analytic result that matters: each activated $OMR carries T/A ETH-worth of stock
// (T = the day's treasury buy, A = the day's total activation), so rational participation
// self-sizes toward A* ≈ T × P (P = the oracle OMR/ETH) — the treasury inflow ITSELF, denominated
// in $OMR, is the size of the recurring sink activation creates. INTERNAL sizing only — the
// standing copy rule forbids publishing any value-per-$OMR figure as marketing.
phase('P9.34 THE ACTIVATION MODEL — the treasury rate card (design-stage; re-measured every run)');
{
  // the four declared treasury slices, read from the LIVE levers (the money router's own sources)
  const feeBps = TREASURY.FEE_TREASURY_BPS();                       // 10% of gameplay fees (mint/respawn/reroll)
  const storeBps = STORE.SPLIT_BPS.rwa;                             // 20% of Store packages
  const taxBps = SELL_TAX.RWA_BPS ?? 400;                           // 4% of DEX sell gross (4/9 of the 9%)
  const bondBps = BONDS.RWA_BPS;                                    // 25% of bond principal
  note('activation', 'treasury slice per source (live levers)',
    `fee ${feeBps / 100}% · store ${storeBps / 100}% · sell-tax ${taxBps / 100}% of gross · bond ${bondBps / 100}%`,
    'the stock budget is fed ONLY by these four — the activation burn recycles to the DESK (founder/POL), so demand cannot inflate its own payout (the anti-Ponzi shape)');
  // an ILLUSTRATIVE inflow composition per band — adoption scenarios, not forecasts
  const bands = [
    { name: 'thin alpha', mints: 20, storeEth: 0.2, sellEth: 1, bondEth: 0.5 },
    { name: 'live base', mints: 200, storeEth: 2, sellEth: 10, bondEth: 5 },
    { name: 'busy base', mints: 2000, storeEth: 20, sellEth: 100, bondEth: 50 },
  ];
  const P = 2000; // oracle OMR/ETH used for the $OMR-denominated equilibrium (the test-fixture price; the live TWAP on mainnet)
  for (const b of bands) {
    const T = b.mints * 0.01 * feeBps / 10000 + b.storeEth * storeBps / 10000
            + b.sellEth * taxBps / 10000 + b.bondEth * bondBps / 10000;
    const eq = T * P;   // A* — the equilibrium daily activation ($OMR/day)
    note('activation', `${b.name} (${b.mints} mints + Ξ${b.storeEth} store + Ξ${b.sellEth} sells + Ξ${b.bondEth} bonds /day)`,
      `treasury buy Ξ${T.toFixed(3)}/day → equilibrium sink ≈ ${Math.round(eq).toLocaleString()} $OMR/day`,
      `below A* early activators are over-rewarded (the bootstrap incentive); above it holding dominates — both self-correcting. At 100/1k/10k $OMR activated: ` +
      [100, 1000, 10000].map((A) => `Ξ${(T / A).toFixed(5)}/$OMR`).join(' · '));
  }
  note('activation', 'the sizing answer', 'the recurring sink ≈ the treasury inflow, in $OMR at the oracle',
    'activation converts every ETH of declared treasury revenue into that much daily $OMR demand — the demand engine the Dynasty design promised. Every ACTIVATION.* number stays a proposed default until the burn is built (post-A1)');
}

// ════════ P9.35 THE PLEX REACH — can a player actually PAY in earned $OMR? ════════════════════════
// The PLEX rail came back on 2026-08-10 for everything but the mint, and it was restored on an
// explicit fantasy: "pay your rent in ISK" — a skilled player funding their play from earnings. That
// is a claim about REACH, and reach is measurable, so it is measured here rather than asserted in a
// comment. Analytic, off the LIVE levers; no value seeded, §10.4 untouched (the P9.33/P9.34 shape).
//
// What a player can EARN, from the enumerated $OMR mint set + the one recurring transfer:
//   • `mission:%`  — the ladder, ONCE per account, lifetime
//   • `daily:all`  — the all-three daily bonus, a TRANSFER out of the event fund (not a mint)
//   • `prize:omr`  — the vig prize pool + pass stipends, both funded by REAL revenue (not grinding)
// Everything else that moves $OMR to a player is a TRANSFER they must take, buy, or be given:
// `whack:loot` off a corpse, `desk:sale` for ETH at the auction, `yield:family` from a treasury.
// So this probe answers one question — how long does the earn surface take to reach the CHEAPEST
// thing the rail sells — and it re-measures on any retune of the ladder, the daily, the premium or
// a package price. `MISSIONS` is machine-owned, so a re-extract re-measures it too.
phase('P9.35 THE PLEX REACH — how long the earn surface takes to reach the cheapest rail purchase');
{
  const lifetimeMission = MISSIONS.reduce((n, m) => n + Number(m.reward?.omr || 0), 0);
  const perDay = Number(M4.DAILY_ALL_OMR || 0);   // the all-three daily bonus (event-fund bounded)
  const floor = STORE.PLEX_FLOOR_OMR_PER_ETH;     // the pre-market $OMR/ETH anchor both quotes derive from
  const shelf = STORE.PACKAGES.map((p) => ({ sku: p.sku, omr: Math.round(p.priceEth * floor) }))
    .sort((a, b) => a.omr - b.omr);
  const cheapest = shelf[0];
  const respawn = Math.round(0.10 * floor);       // the respawn fee at the genesis anchor

  const daysTo = (target) => (perDay > 0 ? Math.ceil(Math.max(0, target - lifetimeMission) / perDay) : Infinity);

  note('plex reach', 'the whole earn surface', `${lifetimeMission.toLocaleString()} $OMR lifetime (missions) + ${perDay}/day (daily:all)`,
    'the ladder pays ONCE per account; the daily is a transfer out of the event fund, so it is bounded by the fund, not printed');
  note('plex reach', `the cheapest thing the rail sells (${cheapest.sku})`, `${cheapest.omr.toLocaleString()} $OMR`,
    `${(cheapest.omr / lifetimeMission).toFixed(1)}× the ENTIRE mission ladder — so doing every $OMR mission in the game buys nothing on the rail, and the daily takes ${daysTo(cheapest.omr).toLocaleString()} more days to close the gap`);
  note('plex reach', 'a respawn token', `${respawn.toLocaleString()} $OMR`,
    `${daysTo(respawn).toLocaleString()} days of perfect daily play after the full ladder`);
  note('plex reach', 'the verdict', 'PLEX is reachable by PREDATION or PURCHASE, not by grinding',
    'that is on-theme and it is NOT the EVE fantasy the restore invoked: in EVE, PLEX is reachable by grinding ISK. Here $OMR has had no faucet since v3 step 1, so the rail is funded by taking it off somebody (whack:loot moves 20-50% of a victim\'s liquid + staked) or buying it at the desk. SIGNED: the predator framing is accepted, and the premium has already been taken to 1.0 (17% off every rail price — comfort, not a fix, since it cannot close a multiple this size). The dials left are the ladder\'s $OMR (machine-owned — a re-extract) and M4.DAILY_ALL_OMR, and both are faucet changes rather than pricing ones');
}

phase('P10 §10.4 ledger invariants over the ENTIRE sim (nothing was seeded)');
const inv = await runLedgerInvariants(pool);
for (const c of inv.checks) console.log(`  ${c.ok ? '✅' : '🚨'} ${c.name}: drift ${c.drift}`);
const failed = inv.checks.filter((c) => !c.ok);

console.log('\n══════════ SIM METRICS SUMMARY ══════════');
for (const m of metrics) console.log(`| ${m.section} | ${m.metric} | ${m.value} | ${m.comment} |`);

await app.close();
if (failed.length) { console.error(`\n🚨 SIM FOUND §10.4 DRIFT: ${JSON.stringify(failed)}`); process.exit(1); }
console.log('\n✅ sim complete — §10.4 holds exactly over an entirely earned economy');

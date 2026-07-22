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
process.env.SHOOT_CD_MS = '0';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runBuyback } from '../src/worker.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { CRIMES, GUNS, CONSTANTS, M3, LOAN, btkOf,
         WORLD_NPCS, WORLD, BOXING, TERRITORY_RACKETS, TERRITORY_TYPES, territoryBuildCost,
         frontierTributePerHr, liberationCost, worldNpcOf, SPEAKEASY, PEN, RACES,
         PORT, boatOf, portRouteOf, interdictChance,
         CONVOY, DISTRICTS, goodPriceOf } from '../src/rules.js';

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
const lvlRespect = (lvl) => 4 * (lvl - 1) * (lvl - 1); // levelOf inverse
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
phase('P9 vig — fees → buyback → reserve, PLEX');
await call('POST', '/v1/mod/fees/record', { headers: modH, body: { nonce: 900001, kind: 'mint', payer: '0x' + '11'.repeat(20), amountWei: '10000000000000000', txHash: '0x' + 'aa'.repeat(32) } });
await call('POST', '/v1/mod/fees/record', { headers: modH, body: { nonce: 900002, kind: 'respawn', payer: '0x' + '22'.repeat(20), amountWei: '100000000000000000', txHash: '0x' + 'bb'.repeat(32) } });
r = await call('POST', '/v1/mod/vig/buyback', { headers: modH, body: { priceOmrPerEth: 1000 } });
note('vig', 'vig buyback', r.code === 200 ? `${fmt(r.body.omrBought ?? 0)} hard $OMR bought (${fmt(r.body.ethSpent ?? 0)} ETH)` : `error ${JSON.stringify(r.body)}`, '');
const vigStatus = await call('GET', '/v1/mod/vig', { headers: modH });
const vigOk = vigStatus.body.ok ?? vigStatus.body.invariants?.ok ?? (vigStatus.body.checks || []).every?.((c) => c.ok);
note('vig', 'vig invariants (extraction ≤ inflow)', String(vigOk), '');
// PLEX: pay the mint fee from EARNED $OMR
const gOmr = (await meOf(g.token)).omr;
if (gOmr >= 5) {
  const px = await call('POST', '/v1/plex/mint', { token: g.token });
  const mint = px.code === 200 ? await call('POST', '/v1/character/mint', { token: g.token }) : { code: px.code };
  note('vig', 'PLEX mint (5 earned $OMR → minted account)', String(mint.code === 200), 'the extraction gate opens without ETH');
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
    note('convoy', `NPC trucking faucet — ${label}`, `~$${fmt(Math.round(injectedPerDay * hit))}/day base-wide`,
      `${CONVOY.NPC.TARGET} trucks on the road × ${(86400000/CONVOY.MS).toFixed(0)} turnovers/day = ${perDay.toFixed(0)} trucks · avg manifest ~$${fmt(Math.round(avgManifest))} (${avgQty} units × ~$${Math.round(avgUnit)}) · hijack ${(hit*100).toFixed(0)}% — a goods faucet realized at market sale, bounded by TARGET/lifetime/trunk cap; sign-off vs boxing/territory`);
  }
}

// ════════════════ P10: THE §10.4 SWEEP — the whole point ════════════════
phase('P10 §10.4 ledger invariants over the ENTIRE sim (nothing was seeded)');
const inv = await runLedgerInvariants(pool);
for (const c of inv.checks) console.log(`  ${c.ok ? '✅' : '🚨'} ${c.name}: drift ${c.drift}`);
const failed = inv.checks.filter((c) => !c.ok);

console.log('\n══════════ SIM METRICS SUMMARY ══════════');
for (const m of metrics) console.log(`| ${m.section} | ${m.metric} | ${m.value} | ${m.comment} |`);

await app.close();
if (failed.length) { console.error(`\n🚨 SIM FOUND §10.4 DRIFT: ${JSON.stringify(failed)}`); process.exit(1); }
console.log('\n✅ sim complete — §10.4 holds exactly over an entirely earned economy');

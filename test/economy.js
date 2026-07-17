// M2 economy smoke test: deterministic market, garage, workshop, goods, rackets,
// assets, swap, staking, gear, buyback worker — plus the §10.4 cash-ledger and
// car-conservation invariants. Runs on pg-mem — zero infra.
process.env.MOD_KEY = 'test-mod-key'; // Phase 4 emission-pool ops routes are mod-gated
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runBuyback } from '../src/worker.js';
import { CARS, carVal, carMelt, CONSTANTS } from '../src/rules.js';

// ── car catalog integrity (content expansion guard: no dupe ids, well-formed, on-curve) ──
{
  const ids = CARS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'car ids are unique (no dupes from an expansion)');
  assert(CARS.length >= 60, `car catalog is the expanded set (${CARS.length} cars)`);
  for (const c of CARS) {
    assert(c.w > 0 && c.melt > 0 && c.val > 0 && c.name && c.desc, `car ${c.id} is well-formed`);
    assert(carVal(c.id, 'stock') > 0 && carMelt(c.id, 'stock') > 0, `car ${c.id} prices via the helpers`);
  }
  // values strictly ascending keeps the progression legible and the drop curve smooth
  for (let i = 1; i < CARS.length; i++) assert(CARS[i].val > CARS[i - 1].val, `cars ordered by value at ${CARS[i].id}`);
}

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body, headers } = {}) => {
  const res = await app.inject({ method, url,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers || {}) }, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (token) => (await call('GET', '/v1/me', { token })).body.character;

// ── bootstrap a well-funded, high-level character (seed via SQL to skip the grind) ──
const { body: { token } } = await call('POST', '/v1/auth/guest');
await call('POST', '/v1/character', { token, body: { name: 'Don Testa' } });
let me = await meOf(token);
const cid = me.id;
const seed = (cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${cid}'`);
await seed("respect=250000, cash=2000000, energy=200, loc='docks'"); // respect 250k ≈ level 250 (well past every gate)

// ── deterministic market (§7.11) ──
const mkt1 = (await call('GET', '/v1/market/prices', {})).body;
const mkt2 = (await call('GET', '/v1/market/prices', {})).body;
assert.equal(mkt1.block, mkt2.block, 'same block');
assert.deepEqual(mkt1.goods, mkt2.goods, 'prices are deterministic within a block');
assert(mkt1.goods.docks.gin >= 10, 'gin has a real price');
assert(mkt1.demand.docks.vim > 0 && mkt1.makings.vim >= 5, 'demand + makings present');

// ── trade goods (§7.11): buy then sell in the trunk ──
let r = await call('POST', '/v1/goods/buy', { token, body: { goodId: 'gin', qty: 5 } });
assert.equal(r.code, 200, 'buy goods'); assert.equal(r.body.character.cargo.gin, 5);
r = await call('POST', '/v1/goods/sell', { token, body: { goodId: 'gin', qty: 5 } });
assert.equal(r.code, 200, 'sell goods'); assert(!r.body.character.cargo.gin, 'trunk emptied');
// cargo cap holds (base 10 units, no Wheels)
assert.equal((await call('POST', '/v1/goods/buy', { token, body: { goodId: 'gin', qty: 99 } })).code, 400, 'trunk cap enforced');

// ── garage (§7.5): boost until we hold two cars, then melt + fence ──
let cars = 0;
for (let i = 0; i < 200 && cars < 2; i++) {
  await seed("gta_at=NULL, energy=200, jail_until=NULL");
  const b = await call('POST', '/v1/garage/boost', { token });
  assert.equal(b.code, 200, 'boost resolves');
  cars = b.body.character.cars.length;
}
assert(cars >= 2, 'boosted at least two cars');
me = await meOf(token);
const melted = await call('POST', `/v1/garage/${me.cars[0].id}/melt`, { token });
assert.equal(melted.code, 200, 'melt'); assert(melted.body.rounds >= 5, 'melt yields rounds');
assert(melted.body.character.ammo > 25, 'ammo grew from melt');
me = await meOf(token);
const fenced = await call('POST', `/v1/garage/${me.cars[0].id}/fence`, { token });
assert.equal(fenced.code, 200, 'fence'); assert(fenced.body.net > 0, 'fence pays');
// bad car id rejected
assert.equal((await call('POST', '/v1/garage/nope/melt', { token })).code, 400, 'unknown car rejected');

// ── workshop + consumables (§5.4) ──
await seed("cb=10, cash=2000000, energy=50");
r = await call('POST', '/v1/workshop/craft/espresso', { token });
assert.equal(r.code, 200, 'craft espresso'); assert.equal(r.body.character.items.espresso, 1);
r = await call('POST', '/v1/workshop/ammo', { token });
assert.equal(r.code, 200, 'craft ammo'); assert.equal(r.body.character.cb, 8, 'crate consumed (10 − espresso − ammo)');
assert(r.body.character.ammo >= 30, 'rolled 30 rounds');
const before = (await meOf(token)).energy;
r = await call('POST', '/v1/items/espresso/use', { token });
assert.equal(r.code, 200, 'use item'); assert(!r.body.character.items.espresso, 'consumable spent');

// ── rackets + income accrual (§5.4, §7.1) ──
await seed("cash=2000000");
r = await call('POST', '/v1/rackets/laundro/buy', { token });
assert.equal(r.code, 200, 'buy racket'); assert(r.body.character.rackets.includes('laundro'));
const cashPre = (await meOf(token)).cash;
await seed("last_accrued_at = now() - interval '30 minutes'"); // lazy racket income
assert((await meOf(token)).cash > cashPre, 'racket income accrued lazily');
assert.equal((await call('POST', '/v1/rackets/laundro/buy', { token })).code, 400, 'no double-buy');

// ── assets: buy then sell back at 80% ──
const capBefore = (await meOf(token)).maxEnergy;
r = await call('POST', '/v1/assets/studio/buy', { token });
assert.equal(r.code, 200, 'buy asset'); assert(r.body.character.assets.includes('studio'));
assert.equal(r.body.character.maxEnergy, capBefore + 5, 'studio adds +5 to the energy cap');
r = await call('POST', '/v1/assets/studio/sell', { token });
assert.equal(r.code, 200, 'sell asset'); assert(!r.body.character.assets.includes('studio'));

// ── D2b: rolling racket-income cap (frequent touching no longer collects ~24h/day) ──
// Pre-fix, income was only capped 8h *per accrual gap*, so touching every <8h harvested
// ~24h/day. The refilling credit bucket (RACKET_DAILY_CAP_MS/day) caps steady-state
// income to ~12h/day no matter how often you touch. Isolate racket income: bank=0, no
// assets/crew, laundro the only racket. (Every read cancels the daily city-event mult,
// so we compare against a measured 1h rate rather than an absolute number.)
await seed("cash=0, bank=0, racket_credit_ms=3600000, last_accrued_at = now() - interval '1 hour'");
const rate1h = (await meOf(token)).cash;                     // income for exactly 1h eligible
assert(rate1h > 0, 'racket pays income per hour');
// three back-to-back 8h collects over a 24h window, starting from a drained bucket
await seed("cash=0, racket_credit_ms=0, last_accrued_at = now()");
for (let i = 0; i < 3; i++) { await seed("last_accrued_at = now() - interval '8 hours'"); await meOf(token); }
const day = (await meOf(token)).cash;                        // total income across that 24h of touches
const hoursCollected = day / rate1h;
assert(hoursCollected < 14, `D2b caps racket income to ~12h/day (got ${hoursCollected.toFixed(1)}h) — pre-fix this window paid 24h`);
assert(hoursCollected > 10, `income still flows under the cap (got ${hoursCollected.toFixed(1)}h)`);
// a returning offline player still gets one full 8h burst (credit seeded to OFFLINE_CAP)
await seed("cash=0, racket_credit_ms=28800000, last_accrued_at = now() - interval '48 hours'");
assert(Math.round((await meOf(token)).cash / rate1h) === 8, 'offline collect still bursts to the 8h window');
await seed("cash=2000000, bank=0, racket_credit_ms=28800000"); // restore for the rest of the suite

// ── AMM swap (§7.12): buy $OMR, then sell some back ──
await seed("cash=2000000");
const ammPre = (await pool.query('SELECT * FROM amm_pool WHERE id=1')).rows[0];
// Risk-to-Earn P1.2 — laundering (cash→$OMR) is located + risky: illegal outside a wash house,
// blocked from a safehouse, and it draws heat. (The test char sits in 'docks', a wash house.)
await seed("loc='neon', heat=0"); // not a launder district, no turf
assert.equal((await call('POST', '/v1/swap', { token, body: { direction: 'buy', amount: 50000 } })).body.error, 'district', 'no washing cash outside a wash house');
await seed("loc='docks', heat=0, safe_until = now() + interval '1 hour'");
assert.equal((await call('POST', '/v1/swap', { token, body: { direction: 'buy', amount: 50000 } })).body.error, 'safe', "can't wash cash from a safehouse");
await seed("loc='docks', heat=0, safe_until=NULL");
assert.equal((await call('POST', '/v1/swap', { token, body: { direction: 'buy', amount: 100 } })).code, 400, 'min swap $500 enforced');
r = await call('POST', '/v1/swap', { token, body: { direction: 'buy', amount: 50000 } });
assert.equal(r.code, 200, 'swap buy'); assert(r.body.gotOmr > 0, 'received $OMR');
assert(r.body.character.heat >= 15, 'laundering drew law heat (~15)');
// the reverse (sell, bringing money in) is ungated — works anywhere
await seed("loc='neon'");
assert.equal((await call('POST', '/v1/swap', { token, body: { direction: 'sell', amount: 1 } })).code, 200, 'selling $OMR back is ungated');
await seed("loc='docks'");
const omrHeld = r.body.character.omr;
assert(omrHeld > 0, 'omr on the account');
const ammMid = (await pool.query('SELECT * FROM amm_pool WHERE id=1')).rows[0];
assert(Number(ammMid.cash_reserve) > Number(ammPre.cash_reserve), 'pool cash grew on a buy');
r = await call('POST', '/v1/swap', { token, body: { direction: 'sell', amount: Math.floor(omrHeld / 2) } });
assert.equal(r.code, 200, 'swap sell'); assert(r.body.gotCash > 0, 'sold $OMR for cash');

// ── staking (§7.1 + Phase 4 backed emission): rewards PAID FROM a funded pool, not minted ──
const modH = { 'x-mod-key': 'test-mod-key' };
r = await call('POST', '/v1/stake', { token, body: { amount: 5 } });
assert.equal(r.code, 200, 'stake'); assert(r.body.character.staked >= 5, 'omr staked');
await seed("last_accrued_at = now() - interval '365 days'"); // a full year at 14% APY
me = await meOf(token);
assert(me.rewards > 0, 'staking rewards accrued lazily');
// Phase 4: an EMPTY pool throttles the yield — the reward stays pending, nothing pays (no mint)
assert.equal((await call('POST', '/v1/claim-rewards', { token })).body.error, 'pool', 'a dry reward pool throttles the payout (rewards stay pending, no mint)');
// (the buyback below funds the pool from the AMM — the real production funding path; then we claim)

// ── NFT gear mint (§5.4): $OMR burn → account-side gear ──
r = await call('POST', '/v1/gear/brasspin/mint', { token });
assert.equal(r.code, 200, 'mint gear'); assert(r.body.character.gear.includes('brasspin'), 'gear held');
assert(r.body.character.eff.cunning > r.body.character.stats.cunning, 'gear boosts effective stat');
assert.equal((await call('POST', '/v1/gear/brasspin/mint', { token })).code, 400, 'no double-mint');

// ── §7.12 buyback worker: fences + swaps + trades filled the street-tax pool ──
const taxPre = (await pool.query('SELECT * FROM street_tax WHERE id=1')).rows[0];
assert(Number(taxPre.pool) > 0, 'street tax accumulated from house takes');
const stakePoolPre = Number((await pool.query('SELECT balance FROM stake_pool WHERE id=1')).rows[0].balance);
const bb = await runBuyback(pool, { force: true });
assert(bb && bb.boughtOmr > 0, 'buyback bought $OMR through the curve');
const taxPost = (await pool.query('SELECT * FROM street_tax WHERE id=1')).rows[0];
assert.equal(Number(taxPost.pool), 0, 'pool drained by buyback');
assert(Number(taxPost.fund) > 0, 'event fund funded');
// Phase 4: the buyback carves a 30% slice to the staking reward pool (cash sinks → yield)
const stakePoolPost = Number((await pool.query('SELECT balance FROM stake_pool WHERE id=1')).rows[0].balance);
assert(Math.abs((stakePoolPost - stakePoolPre) - bb.boughtOmr * 0.30) < 1e-6, 'the buyback funded the stake pool with its STAKE_POOL_BPS (30%) slice');
// NOW the pool is funded (by the buyback) → the staker can claim, paid FROM the pool (a transfer)
const emPre = (await call('GET', '/v1/mod/emission', { headers: modH })).body;
const omrBeforeClaim = (await meOf(token)).omr;
r = await call('POST', '/v1/claim-rewards', { token });
assert.equal(r.code, 200, 'claim rewards'); assert(r.body.claimed > 0, 'the pool paid the reward');
assert((await meOf(token)).omr > omrBeforeClaim, 'rewards → omr, paid FROM the pool');
const emPost = (await call('GET', '/v1/mod/emission', { headers: modH })).body;
assert(Math.abs((emPre.poolBalance - emPost.poolBalance) - r.body.claimed) < 1e-6, 'the pool dropped by exactly what was paid (a transfer, not a mint)');
// ops top-up moves event-fund $OMR into the pool (a §10.4 transfer, never a mint)
const fundPre = Number((await pool.query('SELECT fund FROM street_tax WHERE id=1')).rows[0].fund);
if (fundPre > 1) {
  assert.equal((await call('POST', '/v1/mod/emission/fund', { headers: modH, body: { amount: 1 } })).code, 200, 'ops moved 1 $OMR fund→pool');
  assert.equal(Number((await pool.query('SELECT fund FROM street_tax WHERE id=1')).rows[0].fund), fundPre - 1, 'the event fund paid for it (transfer)');
}
r = await call('POST', '/v1/unstake', { token });
assert.equal(r.code, 200, 'unstake'); assert.equal(r.body.character.staked, 0, 'principal returned whole (never pool-gated)');
// Make Risk Pay: the principal UNBONDS (lootable, no yield) before it's liquid — then releases whole
assert(r.body.character.unbonding > 0, 'principal is in the unbonding window, not instant-liquid');
const unbondingAmt = r.body.character.unbonding;
const omrPreRelease = (await meOf(token)).omr;
await pool.query(`UPDATE account_persistent SET unbond_at = now() - interval '1 minute' WHERE account_id = (SELECT account_id FROM characters WHERE id='${cid}')`);
const released = await meOf(token);
assert.equal(released.unbonding, 0, 'the unbond window passed — released');
assert(released.omr >= omrPreRelease + unbondingAmt - 1e-6, 'principal whole, now liquid');
assert.equal(await runBuyback(pool, { force: true }), null, 'nothing to buy back twice');

// Make Risk Pay: fresh deposits ride IN TRANSIT for BANK_CLEAR_MS (lootable), then clear
await seed("cash=50000, bank=0, bank_intransit=0");
r = await call('POST', '/v1/bank/deposit', { token, body: { amount: 30000 } });
assert.equal(r.code, 200, 'deposited');
assert.equal((await meOf(token)).bankInTransit, 30000, 'the deposit rides in transit');
await seed("bank_intransit_at = now() - interval '3 hours'");
assert.equal((await meOf(token)).bankInTransit, 0, 'cleared after the window — out of loot reach');

// ORGANIC AMM DEPTH: with the event fund now holding $OMR, the next buyback carves AMM_LP_BPS of
// the tax pool into protocol-owned liquidity — cash paired with fund-$OMR at spot, both reserves
// grow, nothing minted (the file-end $OMR conservation check proves it)
await seed("cash=4000000, loc='docks', heat=0, safe_until=NULL");
// prime the event fund: a big taxed wash + a buyback whose LP slice is still unaffordable (all →
// fund), so the NEXT cycle's fund can pair the $OMR side of the LP deposit
assert.equal((await call('POST', '/v1/swap', { token, body: { direction: 'buy', amount: 1000000 } })).code, 200, 'a big wash to prime the fund');
await runBuyback(pool, { force: true });
assert.equal((await call('POST', '/v1/swap', { token, body: { direction: 'buy', amount: 100000 } })).code, 200, 'a wash to refill the tax pool');
const fundPreLp = Number((await pool.query('SELECT fund FROM street_tax WHERE id=1')).rows[0].fund);
const ammPreLp = (await pool.query('SELECT * FROM amm_pool WHERE id=1')).rows[0];
const bb2 = await runBuyback(pool, { force: true });
assert(bb2 && bb2.lpCash > 0 && bb2.lpOmr > 0, `the buyback carved protocol-owned liquidity (${JSON.stringify(bb2)})`);
assert(Math.abs(bb2.lpCash - bb2.spentCash * 0.25) < 1e-6, 'the LP slice is AMM_LP_BPS (25%) of the tax pool');
const ammPostLp = (await pool.query('SELECT * FROM amm_pool WHERE id=1')).rows[0];
assert(Number(ammPostLp.cash_reserve) > Number(ammPreLp.cash_reserve), 'cash reserve deepened');
const fundPostLp = Number((await pool.query('SELECT fund FROM street_tax WHERE id=1')).rows[0].fund);
assert(Math.abs((fundPostLp - fundPreLp) - (bb2.toFund - bb2.lpOmr)) < 1e-6, 'the fund paid the $OMR side of the pair (net of its buyback share)');
assert(Number(ammPostLp.cash_reserve) * Number(ammPostLp.omr_reserve) > Number(ammPreLp.cash_reserve) * Number(ammPreLp.omr_reserve) * 0.999,
  'k (depth) grew — slippage falls with real activity');

// ══════════ §10.4 INVARIANTS ══════════
// (a) cash ledger: a SECOND character that only ever EARNS its cash (never SQL-seeded)
//     must satisfy  cash + bank − 500  ==  Σ(its cash-currency ledger rows).  It keeps
//     bank at 0, so unledgered bank interest can't skew the identity, and every M2 cash
//     faucet/sink is exercised: crime, goods buy/sell, craft, fence, swap both ways.
const { body: { token: t2 } } = await call('POST', '/v1/auth/guest');
await call('POST', '/v1/character', { token: t2, body: { name: 'Cleanbook' } });
const c2 = (await meOf(t2)).id;
const seed2 = (cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${c2}'`);
// grind cash + contraband via crimes at the docks (never touches cash directly)
for (let i = 0; i < 60; i++) {
  await seed2("nerve=50, energy=200, jail_until=NULL, loc='docks'");
  await call('POST', '/v1/crimes/stereo', { token: t2 });
}
let m2 = await meOf(t2);
assert(m2.cash > 3000, 'earned a bankroll from honest crime');
await call('POST', '/v1/goods/buy', { token: t2, body: { goodId: 'gin', qty: 3 } });
await call('POST', '/v1/goods/sell', { token: t2, body: { goodId: 'gin', qty: 3 } });
if (m2.cb >= 1) await call('POST', '/v1/workshop/ammo', { token: t2 });
await seed2("gta_at=NULL, energy=200, jail_until=NULL");
for (let i = 0; i < 60; i++) { // land at least one car to fence
  const b = await call('POST', '/v1/garage/boost', { token: t2 });
  if (b.body.character.cars.length) { await call('POST', `/v1/garage/${b.body.character.cars[0].id}/fence`, { token: t2 }); break; }
  await seed2("gta_at=NULL, energy=200, jail_until=NULL");
}
m2 = await meOf(t2);
if (m2.cash >= 500) {
  const sb = await call('POST', '/v1/swap', { token: t2, body: { direction: 'buy', amount: 500 } });
  if (sb.code === 200 && sb.body.character.omr > 0)
    await call('POST', '/v1/swap', { token: t2, body: { direction: 'sell', amount: Math.max(1, Math.floor(sb.body.character.omr)) } });
}
m2 = await meOf(t2);
const led2 = await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='cash' AND character_id=$1", [c2]);
const drift = Math.abs((m2.cash + m2.bank - 500) - Number(led2.rows[0].s));
assert(drift <= 1, `cash ledger invariant holds (drift ${drift})`);

// (b) car conservation: boost is the only faucet; melt + fence the only sinks.
const boosts = await pool.query("SELECT COUNT(*) n FROM rng_audit WHERE action='gta' AND outcome='success' AND character_id=$1", [cid]);
const melts = await pool.query("SELECT COUNT(*) n FROM transactions WHERE reason='melt' AND character_id=$1", [cid]);
const fences = await pool.query("SELECT COUNT(*) n FROM transactions WHERE reason='fence' AND character_id=$1", [cid]);
const held = await pool.query('SELECT COUNT(*) n FROM cars WHERE character_id=$1', [cid]);
const faucet = Number(boosts.rows[0].n), sinks = Number(melts.rows[0].n) + Number(fences.rows[0].n);
assert.equal(Number(held.rows[0].n), faucet - sinks, `car conservation: ${faucet} boosted − ${sinks} destroyed == ${held.rows[0].n} held`);

// (c) $OMR conservation — run the real §10.4 job and assert the $OMR check holds after Phase 4:
//     staking rewards are now a stake_pool TRANSFER (not a mint), the buyback funded the pool, and
//     the whole $OMR total is still genesis 20,000 (no mint from staking). (Only the $OMR check —
//     the cash check is intentionally broken by this file's SQL cash-seeds.)
const { runLedgerInvariants } = await import('../src/invariants.js');
const omrCheck = (await runLedgerInvariants(pool)).checks.find((x) => x.name === '$OMR conservation');
assert(omrCheck.ok, `$OMR conservation holds with the stake pool + stake:reward-as-transfer (drift ${omrCheck.drift})`);
const ammFinal = (await pool.query('SELECT * FROM amm_pool WHERE id=1')).rows[0];
assert(Number(ammFinal.omr_reserve) > 0 && Number(ammFinal.cash_reserve) > 0, 'AMM reserves stay positive');

// ══════════ BUSINESS EMPIRE (premium, acquired-later personal fronts) ══════════
// Buy/upgrade venues that farm pocket cash + double as private, lower-heat laundering. Exercised on
// the SQL-seeded `cid` (level ~250), so the global cash-ledger identity isn't asserted here — the
// focused checks below prove each faucet/sink is ledgered under the right §10.4 reason instead.
let cat = await call('GET', '/v1/catalog');
assert.equal(cat.code, 200, 'catalog is public'); assert(cat.body.businesses.find((b) => b.kind === 'laundromat')?.tiers.length === 3, 'catalog lists the laundromat + its tier ladder');
// level gate — a low-level man can't open a front
await seed("respect=100"); // level ~6, below the laundromat's level-15 gate
assert.equal((await call('POST', '/v1/business/laundromat/buy', { token })).body.error, 'level', 'a business is level-gated ("acquired later")');
await seed("respect=250000, cash=2000000, loc='docks', heat=0");
// buy
let bizCashPre = (await meOf(token)).cash;
r = await call('POST', '/v1/business/laundromat/buy', { token });
assert.equal(r.code, 200, 'bought a laundromat'); assert.equal(r.body.tier, 1, 'opens at tier 1');
const bizId = r.body.id;
assert(r.body.character.businesses.find((b) => b.kind === 'laundromat'), 'the front shows in the character view');
assert(bizCashPre - (await meOf(token)).cash >= 250000 - 60, 'the $250k setup cost left the pocket');
assert.equal((await call('POST', '/v1/business/laundromat/buy', { token })).body.error, 'exists', 'one laundromat per character');
// collect — lazy income to pocket cash (tier-1 laundromat = $12k/hr). Tolerances absorb the
// few-ms drift between pg-mem's now() (last_collect_at) and the JS Date.now() at accrual.
await pool.query(`UPDATE businesses SET last_collect_at = now() - interval '2 hours' WHERE character_id='${cid}'`);
r = await call('POST', '/v1/business/collect', { token });
assert.equal(r.code, 200, 'collected'); const col1 = r.body.collected;
assert(Math.abs(col1 - 24000) <= 60, `banked ~2h of tier-1 income ($24k, got $${col1})`);
// income is capped at BUSINESS_CAP_MS (24h) — an uncollected front can't hoard unbounded cash.
// The cap is a fixed constant (min(elapsed, 24h)), so this collect is exact — no clock drift.
await pool.query(`UPDATE businesses SET last_collect_at = now() - interval '48 hours' WHERE character_id='${cid}'`);
const colCap = (await call('POST', '/v1/business/collect', { token })).body.collected;
assert.equal(colCap, 288000, 'income capped at 24h ($288k), not 48h');
// upgrade — collects pending at the OLD rate first, then pays the next tier's cost
await seed("cash=2000000");
await pool.query(`UPDATE businesses SET last_collect_at = now() - interval '1 hour', tier=1 WHERE character_id='${cid}'`);
bizCashPre = (await meOf(token)).cash;
r = await call('POST', `/v1/business/${bizId}/upgrade`, { token });
assert.equal(r.code, 200, 'upgraded'); assert.equal(r.body.tier, 2, 'now tier 2'); const colUp = r.body.collected;
assert(Math.abs(colUp - 12000) <= 60, `pending banked at the OLD rate before the upgrade (got $${colUp})`);
assert(Math.abs(((await meOf(token)).cash - bizCashPre) - (colUp - 600000)) <= 60, 'net cash = +pending − the $600k tier-2 cost');
// private laundering — NOT district-gated (works from neon, a non-wash-house), LOWER heat than the street
await seed("cash=2000000, heat=0, safe_until=NULL, loc='neon'");
r = await call('POST', `/v1/business/${bizId}/launder`, { token, body: { amount: 40000 } });
assert.equal(r.code, 200, 'washed cash at your own front, off a wash-house district'); assert(r.body.gotOmr > 0, 'got $OMR');
const meL = await meOf(token);
assert(meL.heat >= 8 && meL.heat < CONSTANTS.LAUNDER_HEAT, `own-front laundering draws LESS heat than the street (${meL.heat} < ${CONSTANTS.LAUNDER_HEAT})`);
// per-tier daily launder cap — tier 2 washes $50k/day, $40k used → only $10k headroom left
assert.equal((await call('POST', `/v1/business/${bizId}/launder`, { token, body: { amount: 20000 } })).body.error, 'capacity', 'daily launder capacity is enforced');
assert.equal((await call('POST', `/v1/business/${bizId}/launder`, { token, body: { amount: 10000 } })).code, 200, 'washing the remaining headroom clears');
// the window resets after 24h
await pool.query(`UPDATE businesses SET launder_at = now() - interval '25 hours' WHERE character_id='${cid}'`);
assert.equal((await call('POST', `/v1/business/${bizId}/launder`, { token, body: { amount: 30000 } })).code, 200, 'the daily launder window rolls over after 24h');
// still an extraction act — blocked from a safehouse (P1.3 shield-not-bunker)
await seed("safe_until = now() + interval '1 hour'");
assert.equal((await call('POST', `/v1/business/${bizId}/launder`, { token, body: { amount: 1000 } })).body.error, 'safe', "can't wash money while to ground");
await seed("safe_until=NULL");
// §10.4: each movement is ledgered under the right reason (spends == sinks, income == faucet)
const bizBuys = Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='business:buy' AND character_id=$1", [cid])).rows[0].s);
const bizUp = Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='business:upgrade' AND character_id=$1", [cid])).rows[0].s);
const bizInc = Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='business:income' AND character_id=$1", [cid])).rows[0].s);
assert.equal(bizBuys, -250000, 'business:buy is a ledgered cash sink');
assert.equal(bizUp, -600000, 'business:upgrade is a ledgered cash sink');
assert.equal(bizInc, col1 + colCap + colUp, 'business:income is a ledgered cash faucet (all three collects)');

// ══════════ BUSINESS EMPIRE step two — the risk layer (scrutiny, raids, shakedowns) ══════════
// the washes above (40k + 10k + 30k against a 50k/day tier-2 cap) drew (0.8+0.2+0.6)×45 = 72
// scrutiny onto the front — sim-audit retune: max-throughput washing now CROSSES the threshold
r = await call('GET', '/v1/business', { token });
let lm = r.body.businesses.find((b) => b.id === bizId);
assert(lm.scrutiny >= 65 && lm.scrutiny <= 75, `laundering drew scrutiny onto the front (got ${lm.scrutiny})`);
assert.equal(lm.raidRisk, true, 'hard washing puts the front above the raid threshold (the risk layer is ALIVE)');
// scrutiny decays ~1/hr while the front lies quiet
await pool.query(`UPDATE businesses SET scrutiny=50, scrutiny_at = now() - interval '10 hours' WHERE id='${bizId}'`);
lm = (await call('GET', '/v1/business', { token })).body.businesses.find((b) => b.id === bizId);
assert(Math.abs(lm.scrutiny - 40) <= 1, `scrutiny decays ~1/hr (50 − 10 ≈ ${lm.scrutiny})`);
// below the threshold, even a FORCED roll never raids (BUSINESS_RAID_P is the test-only env knob)
process.env.BUSINESS_RAID_P = '1';
await pool.query(`UPDATE businesses SET scrutiny=30, scrutiny_at=now(), last_collect_at = now() - interval '2 hours' WHERE id='${bizId}'`);
r = await call('POST', '/v1/business/collect', { token });
assert(!r.body.raids, 'no raid below the scrutiny threshold');
assert(r.body.collected > 0, 'income still collects normally');
// above it, the Bureau's raid seizes ALL pending income + levies a 10%-of-tier-cost fine
await seed("cash=1000000");
await pool.query(`UPDATE businesses SET scrutiny=100, scrutiny_at = now() - interval '1 hour', last_collect_at = now() - interval '3 hours' WHERE id='${bizId}'`);
const cashPreRaid = (await meOf(token)).cash;
r = await call('POST', '/v1/business/collect', { token });
assert.equal(r.body.raids?.length, 1, 'the Bureau raided the hot front');
assert.equal(r.body.raids[0].fine, 60000, 'fined 10% of the tier-2 cost ($60k)');
assert(r.body.raids[0].seized > 0, 'pending income was seized (never banked, never minted)');
assert.equal(r.body.collected, 0, 'nothing collected from the raided front');
assert.equal((await meOf(token)).cash, cashPreRaid - 60000, 'the fine left the pocket');
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='business:raid' AND character_id=$1", [cid])).rows[0].s),
  -60000, 'business:raid is a ledgered §10.4 cash sink');
lm = (await call('GET', '/v1/business', { token })).body.businesses.find((b) => b.id === bizId);
assert.equal(lm.scrutiny, 0, 'the raid cleared the scrutiny (the heat is off)');
// the fine reaches the BANK once the pocket is empty (audit F7: banking no longer dodges it)
await seed("cash=100, bank=1000000");
await pool.query(`UPDATE businesses SET scrutiny=100, scrutiny_at = now() - interval '1 hour' WHERE id='${bizId}'`);
r = await call('POST', '/v1/business/collect', { token });
assert.equal(r.body.raids?.[0]?.fine, 60000, 'second raid fined the full 10% despite an empty pocket');
const afterBankFine = await meOf(token);
assert(afterBankFine.cash === 0 && Math.abs(afterBankFine.bank - (1000000 - 59900)) < 2, 'pocket drained first, the bank covered the rest');
delete process.env.BUSINESS_RAID_P;
await seed("cash=2000000"); // restore the pocket for the gang-founding + shakedown blocks below

// ── shakedown: a rival extorts a front for 30% of its PENDING income (PvP, two-party) ──
await pool.query(`UPDATE businesses SET scrutiny=0, scrutiny_at=now(), last_collect_at = now() - interval '10 hours', shakedown_at=NULL WHERE id='${bizId}'`);
// gates: no extortion from a safehouse; a hospitalized owner is off-limits; family is omertà
await seed2("energy=200, jail_until=NULL, hosp_until=NULL, safe_until = now() + interval '1 hour'");
assert.equal((await call('POST', `/v1/business/${bizId}/shakedown`, { token: t2 })).body.error, 'safe', 'no extortion from a safehouse');
await seed2("safe_until=NULL");
await seed("hosp_until = now() + interval '1 hour'");
assert.equal((await call('POST', `/v1/business/${bizId}/shakedown`, { token: t2 })).body.error, 'hosp', 'a hospitalized owner is off-limits');
await seed("hosp_until=NULL");
r = await call('POST', '/v1/gangs', { token, body: { name: 'Front Runners', tag: 'FRUN' } });
assert.equal(r.code, 200, 'owner founded a family');
assert.equal((await call('POST', `/v1/gangs/${r.body.gangId}/join`, { token: t2 })).code, 200, 'the rival joined it');
assert.equal((await call('POST', `/v1/business/${bizId}/shakedown`, { token: t2 })).body.error, 'family', "family fronts are off-limits — omertà");
assert.equal((await call('POST', '/v1/gangs/leave', { token: t2 })).code, 200, 'rival left the family');
// the contest: an overwhelming rival vs a soft owner — loop the roll (clamped odds, never certain)
await seed2("muscle=2000, cunning=2000, energy=200, heat=0");
await seed("muscle=5, cunning=5");
let win = null;
for (let i = 0; i < 60 && !win; i++) {
  await seed2("energy=200, jail_until=NULL");
  await pool.query(`UPDATE businesses SET shakedown_at=NULL WHERE id='${bizId}'`);
  const s = await call('POST', `/v1/business/${bizId}/shakedown`, { token: t2 });
  assert.equal(s.code, 200, 'shakedown attempt resolves');
  if (s.body.win) win = s.body;
}
assert(win, 'a 2000-muscle rival eventually cracks a 5-muscle owner');
assert(win.cut > 0, 'took a cut of the pending income');
assert((await meOf(t2)).heat >= 10, 'extortion drew heat on the attacker');
assert(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='business:shakedown' AND character_id=$1", [c2])).rows[0].s) >= win.cut,
  'the cut is a ledgered faucet on the attacker (§10.4 reconciles — same bounded income, redirected)');
// per-venue cooldown armed by the visit
assert.equal((await call('POST', `/v1/business/${bizId}/shakedown`, { token: t2 })).body.error, 'cooldown', 'per-venue cooldown after a visit');
// the owner kept the other ~70% pending (the clock advanced by only the stolen share)
r = await call('POST', '/v1/business/collect', { token });
assert(Math.abs(r.body.collected - Math.round(win.cut * 7 / 3)) <= 300,
  `owner kept ~70% of the pending (cut $${win.cut}, owner collected $${r.body.collected})`);

// ══════════ RECURRING SINKS — "the pad" (business upkeep) ══════════
await seed("cash=2000000");
await pool.query(`UPDATE businesses SET upkeep_at=now(), last_collect_at=now(), scrutiny=0, scrutiny_at=now() WHERE id='${bizId}'`);
// the view surfaces the pad: an hourly rate (BUSINESS_UPKEEP_BPS of income), what's owed, cold?
let biz = (await call('GET', '/v1/business', { token })).body.businesses.find((b) => b.id === bizId);
const upRate = biz.upkeepPerHr;
assert(upRate > 0, `the front owes upkeep at $${upRate}/hr (a % of its income)`);
assert.equal(biz.upkeepOwed, 0, 'a freshly-squared front owes nothing');
assert.equal(biz.cold, false, 'and runs warm');
// 5 hours of unpaid pad → owed ≈ rate × 5; paying is a ledgered cash sink that resets the clock
await pool.query(`UPDATE businesses SET upkeep_at = now() - interval '5 hours' WHERE id='${bizId}'`);
biz = (await call('GET', '/v1/business', { token })).body.businesses.find((b) => b.id === bizId);
assert(Math.abs(biz.upkeepOwed - upRate * 5) <= upRate, `5h of pad owed (~$${upRate * 5}, got $${biz.upkeepOwed})`);
const cashPrePad = (await meOf(token)).cash;
r = await call('POST', '/v1/business/upkeep', { token });
assert.equal(r.code, 200, 'the pad is paid'); assert(r.body.paid > 0, 'a bill came due');
assert.equal((await meOf(token)).cash, cashPrePad - r.body.paid, 'the pad left the pocket exactly');
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='business:upkeep' AND character_id=$1", [cid])).rows[0].s),
  -r.body.paid, 'business:upkeep is a ledgered §10.4 cash sink');
assert.equal((await call('GET', '/v1/business', { token })).body.businesses.find((b) => b.id === bizId).upkeepOwed, 0, 'paying squared the pad');
// COLD: a front unpaid past the cold window (3d) produces nothing until squared
await pool.query(`UPDATE businesses SET upkeep_at = now() - interval '4 days', last_collect_at = now() - interval '2 hours' WHERE id='${bizId}'`);
biz = (await call('GET', '/v1/business', { token })).body.businesses.find((b) => b.id === bizId);
assert.equal(biz.cold, true, 'four days unpaid → the front is COLD');
r = await call('POST', '/v1/business/collect', { token });
assert.equal(r.body.collected, 0, 'a cold front hands over no take');
assert.equal(r.body.cold, 1, 'and reports itself cold');
assert.equal((await call('POST', `/v1/business/${bizId}/launder`, { token, body: { amount: 20000 } })).body.error, 'cold', "a cold front won't wash");
assert.equal((await call('POST', `/v1/business/${bizId}/upgrade`, { token })).body.error, 'cold', "and won't take an upgrade");
// paying the pad THAWS it — income flows again (clock was reset by the seed, so a fresh 2h accrues)
await call('POST', '/v1/business/upkeep', { token });
await pool.query(`UPDATE businesses SET last_collect_at = now() - interval '2 hours' WHERE id='${bizId}'`);
biz = (await call('GET', '/v1/business', { token })).body.businesses.find((b) => b.id === bizId);
assert.equal(biz.cold, false, 'the pad squared → the front is warm again');
assert(((await call('POST', '/v1/business/collect', { token })).body.collected) > 0, 'and the take flows again');

// ── Risk-to-Earn B2: bank-interest daily cap (metered by a token bucket like racket income) ──
// An empty bucket over a 4h gap refills only ~2h of interest-eligibility (BANK_DAILY_CAP_MS 12h/day
// → 0.5 ms credit per ms), so a continuously-online player banks HALF the raw 4h they'd otherwise
// compound — closing the audit's ~4%/day risk-free exploit. (Seeded post-invariant-check on `cid`.)
await seed("bank=1000000");
await pool.query(`UPDATE characters SET bank_credit_ms=0, last_accrued_at = now() - interval '4 hours' WHERE id='${cid}'`);
const afterCap = await meOf(token); // any action triggers accrual; interest is metered by the bucket
assert(afterCap.bank > 1003000 && afterCap.bank < 1004000,
  `bank interest capped to ~2h of a 4h gap (~+0.33%, got +${afterCap.bank - 1000000}); uncapped 4h would be ~+6667`);

// ══════════ BALANCE.md sign-off (founder-approved recs) ══════════
// D2 — shield, not bunker: banking and collecting the take are EXPOSED acts
await seed("cash=100000, safe_until = now() + interval '1 hour'");
assert.equal((await call('POST', '/v1/bank/deposit', { token, body: { amount: 1000 } })).body.error, 'safe', 'no deposits from a safehouse (the courier walks)');
assert.equal((await call('POST', '/v1/business/collect', { token })).body.error, 'safe', 'no collecting the take from a safehouse');
await seed("safe_until=NULL");
// D3 — the public wash route is a per-account daily token bucket ($2.6M/day, = the top front tier)
await seed("cash=5000000, heat=0, loc='docks', wash_used=0, wash_at=NULL");
assert.equal((await call('POST', '/v1/swap', { token, body: { direction: 'buy', amount: 2000000 } })).code, 200, 'a big wash inside the daily cap clears');
assert.equal((await call('POST', '/v1/swap', { token, body: { direction: 'buy', amount: 700000 } })).body.error, 'wash_cap', 'the public route caps per face per day');
await seed("wash_at = now() - interval '25 hours'");
assert.equal((await call('POST', '/v1/swap', { token, body: { direction: 'buy', amount: 700000 } })).code, 200, 'the bucket refills over a day');
// D5 — bank interest TAPERS above $10M: full rate on the first $10M, 10% of the rate beyond
await seed("cash=0, bank=30000000, bank_credit_ms=0, last_accrued_at = now() - interval '4 hours', safe_until=NULL");
const taperMe = await meOf(token);
// 2h eligible (the B2 bucket) → effective principal 10M + 20M×0.1 = 12M → +$40k (untapered: +$100k)
assert(taperMe.bank > 30030000 && taperMe.bank < 30050000,
  `whale interest tapered (+$${Math.round(taperMe.bank - 30000000)}; untapered 4h-gap would be ~+$100k)`);

console.log('✅ M2 economy test passed — market, garage (+car conservation), workshop, goods, rackets (+lazy income), assets, swap (+laundering gate/heat), staking (real APY), gear, 12h buyback, ledger invariants, Risk-to-Earn bank-interest daily cap, Business Empire (catalog, level gate, buy/collect/upgrade with income cap, private lower-heat laundering + daily cap + window reset + safehouse block, §10.4 faucet/sink ledgering) + step-two risk layer (scrutiny accrual/decay, raid threshold gate, forced raid seizes pending + ledgered fine, shakedown gates/contest/cooldown, owner keeps ~70%) + RECURRING SINKS "the pad" (upkeep rate/owed in the view, paying is a ledgered business:upkeep sink resetting the clock, a front unpaid past the cold window produces nothing / no laundering / no upgrades until the pad thaws it) + BALANCE sign-off (safehouse blocks deposits/collection, the $2.6M/day public wash bucket, the >$10M bank-interest taper)');
await app.close();

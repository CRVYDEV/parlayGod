// M2 economy smoke test: deterministic market, garage, workshop, goods, rackets,
// assets, swap, staking, gear, buyback worker — plus the §10.4 cash-ledger and
// car-conservation invariants. Runs on pg-mem — zero infra.
process.env.EARLY_SELL_TAX_BPS = '0'; // legacy exact-amount swap assertions run surcharge-free (dedicated coverage: chain/emission suites)
process.env.MOD_KEY = 'test-mod-key'; // Phase 4 emission-pool ops routes are mod-gated
import assert from 'node:assert';
import crypto from 'node:crypto';
import { buildServer } from '../src/server.js';
import { runBuyback, mergeLegacyPools } from '../src/worker.js';
import { CARS, carVal, carMelt, CONSTANTS, BUSINESS_EMPIRE, BUSINESSES, RIVALS, frontTitles, launderRankOf, businessMaxTier, POPULATION, CRIMES,
         RACKETS, ASSETS, OPERATIONS, opSlotsOf } from '../src/rules.js';
import { spawnResident } from '../src/population.js';

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

// ── THE INCOME LADDERS — the ROI TAPER (BALANCE.md § THE ASSET LADDER RE-CURVED) ──
// RACKETS and the Legit Fronts half of ASSETS are both MACHINE-OWNED (rules.generated.js, rewritten
// wholesale by the extractor), so the shape that makes them a decision has nothing else holding it:
// a prototype edit or a bad re-extract could silently put the whole ladder back inside a day's
// payback and no guard in the tree would notice — the sim MEASURES it but the sim is not the build.
// The property is the TAPER: a bigger rung must pay back SLOWER, so buying up the ladder is a
// commitment rather than a formality. Asserted as a relation over the live tables, not pinned
// numbers, so content can be added freely as long as it lands on the curve.
{
  const meteredMinPerDay = CONSTANTS.RACKET_DAILY_CAP_MS / 60000;   // the accrual meter, not 1440
  assert(meteredMinPerDay > 0, 'the racket meter is the day the payback is measured against');
  const payback = (cost, incomePerMin) => cost / (incomePerMin * meteredMinPerDay);
  for (const [what, rows] of [['racket', RACKETS.map((r) => ({ id: r.id, cost: r.cost, income: r.income }))],
    ['front', ASSETS.filter((a) => a.income).map((a) => ({ id: a.id, cost: a.price, income: a.income }))]]) {
    assert(rows.length >= 13, `${what} income ladder is the full catalog (${rows.length})`);
    let prevCost = 0, prevIncome = 0, prevPay = 0;
    for (const r of rows) {
      assert(r.cost > prevCost, `${what} ${r.id} costs more than the rung below it`);
      assert(r.income > prevIncome, `${what} ${r.id} out-earns the rung below it (a dearer rung must never earn less)`);
      const p = payback(r.cost, r.income);
      // The taper, and the envelope it sweeps. 1.5d floors the on-ramp (a first purchase should
      // still feel like a win); 14d is the top of the healthy band (longer than a sitting, shorter
      // than a street's life). A rung under the floor is the "have I clicked it yet" defect.
      assert(p >= 1.5 && p <= 14, `${what} ${r.id} pays back in ${p.toFixed(2)}d — inside the 1.5-14d envelope`);
      assert(p >= prevPay - 0.01, `${what} ${r.id} pays back no FASTER than the rung below it (${p.toFixed(2)}d vs ${prevPay.toFixed(2)}d) — the ROI must taper up the ladder`);
      prevCost = r.cost; prevIncome = r.income; prevPay = p;
    }
    assert(prevPay >= 8, `the ${what} apex pays back in ${prevPay.toFixed(2)}d — the top of the ladder is a real commitment, not a click`);
  }
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
await seed("respect=625000, cash=2000000, energy=200, loc='docks'"); // respect 250k ≈ level 250 (well past every gate)

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

// ══ ASSETS & RACKETS → Tier 4: racket upgrades, the tycoon legend ══
await seed("cash=5000000");
// (A) RACKET UPGRADE — a level multiplies the racket's accrual income (a ledgered cash sink)
assert.equal((await call('POST', '/v1/rackets/pawn/upgrade', { token })).body.error, 'none', "can't upgrade a racket you don't run");
r = await call('POST', '/v1/rackets/laundro/upgrade', { token });
assert.equal(r.code, 200, 'upgraded the laundromat'); assert.equal(r.body.level, 1);
assert.equal((await meOf(token)).racketLevels.laundro, 1, 'the view shows the racket level');
assert(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='racket:upgrade' AND character_id='${cid}'`)).rows[0].s) < 0, 'racket:upgrade is a ledgered §10.4 cash sink');
// a level-1 laundro out-earns a level-0 one over the same accrual window (income ×1.12)
await seed("cash=0, bank=0, racket_credit_ms=3600000, last_accrued_at = now() - interval '1 hour'");
const upEarn = (await meOf(token)).cash;
await pool.query(`UPDATE character_rackets SET level=0 WHERE character_id='${cid}' AND racket_id='laundro'`);
await seed("cash=0, racket_credit_ms=3600000, last_accrued_at = now() - interval '1 hour'");
const baseEarn = (await meOf(token)).cash;
assert(upEarn > baseEarn, `the upgraded racket out-earns the base (${upEarn} vs ${baseEarn})`);
// (B) THE TYCOON LEGEND — lifetime racket income banked to an account-level counter that survives death
me = await meOf(token);
assert(me.tycoon && me.tycoon.earned > 0, 'the tycoon ledger shows lifetime racket income');
assert.equal(Number((await pool.query(`SELECT tycoon_earned FROM account_persistent WHERE account_id=(SELECT account_id FROM characters WHERE id='${cid}')`)).rows[0].tycoon_earned), me.tycoon.earned, 'the view matches the persisted legend');
r = await call('GET', '/v1/leaderboard/tycoons', { token });
assert.equal(r.code, 200); assert(r.body.tycoons.some((k) => k.name === 'Don Testa' && k.earned > 0), 'the don is on the tycoon board');
await pool.query(`UPDATE character_rackets SET level=1 WHERE character_id='${cid}' AND racket_id='laundro'`); // restore for downstream tests
await seed("cash=2000000, bank=0, racket_credit_ms=28800000");

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
// Measured off the LEDGER, not off `cash`. Two reasons: it isolates the racket faucet from whatever
// the collecting action itself costs, and — since reads stopped taking the write lock — accrual is
// banked by ACTIONS, not by looking at your sheet. A read shows the accrued figure truthfully but
// persists nothing (see withCharacterRead), so `cash` after a GET is no longer the collected total.
// The income is not lost: the next action accrues from the same unchanged clock and ledgers the lot.
const incomeSoFar = async () => Number((await pool.query(
  "SELECT COALESCE(SUM(amount),0) n FROM transactions WHERE character_id=$1 AND reason='racket:income'",
  [cid])).rows[0].n);
const collect = async () => {                                // any write banks the accrued income
  await seed("cash=50000, jail_until=NULL");                 // cover the fare; cash is not what we measure
  const here = (await pool.query('SELECT loc FROM characters WHERE id=$1', [cid])).rows[0].loc;
  const to = here === 'docks' ? 'neon' : 'docks';            // travel refuses a move to where you stand
  const r = await call('POST', `/v1/travel/${to}`, { token });
  assert.equal(r.code, 200, `collect via travel (${here} → ${to}): ${JSON.stringify(r.body)}`);
};
await seed("bank=0, racket_credit_ms=3600000, last_accrued_at = now() - interval '1 hour'");
let mark = await incomeSoFar();
await collect();
const rate1h = await incomeSoFar() - mark;                   // income for exactly 1h eligible
assert(rate1h > 0, 'racket pays income per hour');
// three back-to-back 8h collects over a 24h window, starting from a drained bucket
await seed("racket_credit_ms=0, last_accrued_at = now()");
mark = await incomeSoFar();
for (let i = 0; i < 3; i++) { await seed("last_accrued_at = now() - interval '8 hours'"); await collect(); }
const day = await incomeSoFar() - mark;                      // total income across that 24h of touches
const hoursCollected = day / rate1h;
assert(hoursCollected < 14, `D2b caps racket income to ~12h/day (got ${hoursCollected.toFixed(1)}h) — pre-fix this window paid 24h`);
assert(hoursCollected > 10, `income still flows under the cap (got ${hoursCollected.toFixed(1)}h)`);
// a returning offline player still gets one full 8h burst (credit seeded to OFFLINE_CAP)
await seed("racket_credit_ms=28800000, last_accrued_at = now() - interval '48 hours'");
mark = await incomeSoFar();
await collect();
assert(Math.round((await incomeSoFar() - mark) / rate1h) === 8, 'offline collect still bursts to the 8h window');
await seed("cash=2000000, bank=0, racket_credit_ms=28800000"); // restore for the rest of the suite

// ── THE AMM — RETIRED (tokenomics v2 step 2) ──
// Cash no longer becomes $OMR by ANY route. This used to be the laundering block: a located,
// heat-drawing, safehouse- and jail-gated buy at a wash house, plus an ungated sell back. All of
// it is gone, in both directions, and the redemption WINDOW (test/tokenomics.js) is the $OMR →
// cash path now. What is asserted here is that the retirement is real and total — a half-retired
// buy side would leave the money pump the window's fixed rate depends on being impossible.
await seed("cash=2000000, loc='docks', heat=0, safe_until=NULL, jail_until=NULL");
const ammPre = (await pool.query('SELECT * FROM amm_pool WHERE id=1')).rows[0];
for (const dir of ['buy', 'sell']) {
  const g = await call('POST', '/v1/swap', { token, body: { direction: dir, amount: 50000 } });
  assert.equal(g.body.error, 'retired', `the ${dir} side is retired`);
}
// laundering at your OWN front went with it — otherwise the pump just moves indoors
assert.equal((await call('POST', '/v1/business/any/launder', { token, body: { amount: 1000 } })).body.error,
  'retired', 'the private wash rail is retired too');
// and the pool is left ALONE rather than drained: its omr_reserve is inside omrBuckets, so moving
// it would perturb $OMR conservation for no gain. It is simply a bucket nobody trades against.
const ammPost = (await pool.query('SELECT * FROM amm_pool WHERE id=1')).rows[0];
assert.equal(Number(ammPost.cash_reserve), Number(ammPre.cash_reserve), 'the retired pool is untouched (cash)');
assert.equal(Number(ammPost.omr_reserve), Number(ammPre.omr_reserve), 'the retired pool is untouched ($OMR)');
// the character keeps their cash — a refused trade moves nothing
assert.equal((await meOf(token)).cash, 2000000, 'a refused trade costs nothing');
// $OMR for the staking block below now has to be GRANTED rather than bought, which is itself the
// point of v2: the only ways in are bonds (real ETH) and the family yield.
await pool.query(`UPDATE account_persistent SET omr = omr + 1200 WHERE account_id=(SELECT account_id FROM characters WHERE id='${cid}')`);

// ── staking (§7.1 + Phase 4 backed emission): rewards PAID FROM a funded pool, not minted ──
const modH = { 'x-mod-key': 'test-mod-key' };
r = await call('POST', '/v1/stake', { token, body: { amount: 5 } });
assert.equal(r.code, 200, 'stake'); assert(r.body.character.staked >= 5, 'omr staked');
await seed("last_accrued_at = now() - interval '365 days'"); // a full year at 14% APY
me = await meOf(token);
assert(me.rewards > 0, 'staking rewards accrued lazily');
// Rewards still ACCRUE on the deposit — they are simply no longer claimable by the individual
// (tokenomics v2 step 2, design §3). Left accruing rather than zeroed so nothing is destroyed and
// the number stays auditable; the claim is asserted retired in the 12h-tick block below.

// ── NFT gear mint (§5.4): $OMR burn → account-side gear ──
r = await call('POST', '/v1/gear/brasspin/mint', { token });
assert.equal(r.code, 200, 'mint gear'); assert(r.body.character.gear.includes('brasspin'), 'gear held');
assert(r.body.character.eff.cunning > r.body.character.stats.cunning, 'gear boosts effective stat');
assert.equal((await call('POST', '/v1/gear/brasspin/mint', { token })).code, 400, 'no double-mint');

// ── THE 12h TICK (tokenomics v2 step 2): the buyback no longer BUYS anything ──
// It used to spend the street-tax pool on $OMR through the AMM curve, then split the proceeds to
// the event fund, the top-25 families and the stake pool. The AMM is retired, so there is nothing
// to buy with and no curve to buy through: the take's only destination is the redemption WINDOW.
const taxPre = (await pool.query('SELECT * FROM street_tax WHERE id=1')).rows[0];
assert(Number(taxPre.pool) > 0, 'street tax accumulated from house takes');
// seed the legacy individual-yield pools so the MERGE has something real to move
await pool.query('UPDATE stake_pool SET balance = 40 WHERE id=1');
await pool.query('UPDATE rwa_dividend_pool SET pool = 10 WHERE id=1');
const fyPre = Number((await pool.query('SELECT balance FROM family_yield_pool WHERE id=1')).rows[0].balance);
const winPre = Number((await pool.query('SELECT balance FROM exchange_pool WHERE id=1')).rows[0].balance);
const bb = await runBuyback(pool, { force: true });
assert(bb && bb.toWindow > 0, 'the take went to the window');
assert.equal(bb.toWindow, Math.floor(Number(taxPre.pool)), 'the WHOLE take crosses (FUND_BPS 10000) — with no AMM there is nowhere else for it to go');
const winPost = Number((await pool.query('SELECT balance FROM exchange_pool WHERE id=1')).rows[0].balance);
assert.equal(winPost - winPre, bb.toWindow, 'and it landed in the window pool');
// THE LEGACY POOL MERGE: both individual-yield pools drain into the family pot. Its OWN tick step,
// not the buyback's (red-team A1) — gating a $OMR migration on the cash pool being non-empty is how
// it never runs on a quiet server. test/tokenomics.js asserts that independence directly.
assert.equal((await mergeLegacyPools(pool))?.merged, 50, 'the retired stake + dividend pools merged');
assert.equal(Number((await pool.query('SELECT balance FROM stake_pool WHERE id=1')).rows[0].balance), 0, 'the stake pool is emptied');
assert.equal(Number((await pool.query('SELECT pool FROM rwa_dividend_pool WHERE id=1')).rows[0].pool), 0, 'the dividend pool is emptied');
assert.equal(Number((await pool.query('SELECT balance FROM family_yield_pool WHERE id=1')).rows[0].balance) - fyPre, 50,
  'and it all arrived in the family pot — a bucket-to-bucket transfer, nothing minted, nothing lost');
// the merge is a DRAIN, so running it again is a no-op rather than double-applying
assert.equal(await mergeLegacyPools(pool), null, 'a second tick merges nothing — the drain is idempotent by construction');

// ── individual staking yield: RETIRED (repurposed to the family yield, design §3) ──
// The principal is deliberately NOT touched by that: it still comes back whole.
assert.equal((await call('POST', '/v1/claim-rewards', { token })).body.error, 'retired',
  'the personal staking claim is retired');
const stakedPre = (await meOf(token)).staked;
assert(stakedPre >= 5, 'the deposit is still there');
r = await call('POST', '/v1/unstake', { token });
assert.equal(r.code, 200, 'unstake still works');
assert.equal((await meOf(token)).staked, 0, 'the principal left the stake');
assert(Number(r.body.character.unbonding) >= stakedPre, 'and returns WHOLE into the unbonding window (the P1.1 loot surface is unchanged)');
// the emission gauge still reads (it reports the retired stake pool, now drained to the family pot)
assert.equal((await call('GET', '/v1/mod/emission', { headers: modH })).code, 200, 'the emission gauge still reads');
// ops top-up moves event-fund $OMR into the pool (a §10.4 transfer, never a mint)
const fundPre = Number((await pool.query('SELECT fund FROM street_tax WHERE id=1')).rows[0].fund);
if (fundPre > 1) {
  assert.equal((await call('POST', '/v1/mod/emission/fund', { headers: modH, body: { amount: 1 } })).code, 200, 'ops moved 1 $OMR fund→pool');
  assert.equal(Number((await pool.query('SELECT fund FROM street_tax WHERE id=1')).rows[0].fund), fundPre - 1, 'the event fund paid for it (transfer)');
}
// (the principal was already withdrawn above — the unstake path is covered there)
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

// PROTOCOL-OWNED LIQUIDITY — RETIRED with the AMM (tokenomics v2 step 2). The LP carve paired
// tax-pool cash with event-fund $OMR into both reserves so depth grew with real activity. With no
// pool to deepen there is nothing to carve, and the tick's whole job is moving the take to the
// window (asserted above). The `fund` column keeps its $OMR — it is inside omrBuckets and the
// file-end conservation check still accounts for it; it simply has no LP pairing to spend on.
{
  const fundPre = Number((await pool.query('SELECT fund FROM street_tax WHERE id=1')).rows[0].fund);
  const ammPre2 = (await pool.query('SELECT * FROM amm_pool WHERE id=1')).rows[0];
  await pool.query('UPDATE street_tax SET pool = 100000 WHERE id=1');
  const bbLp = await runBuyback(pool, { force: true });
  assert.equal(bbLp.lpCash, undefined, 'the tick no longer reports an LP carve — there is no pool to deepen');
  const ammPost2 = (await pool.query('SELECT * FROM amm_pool WHERE id=1')).rows[0];
  assert.equal(Number(ammPost2.cash_reserve), Number(ammPre2.cash_reserve), 'the retired pool gained no cash');
  assert.equal(Number(ammPost2.omr_reserve), Number(ammPre2.omr_reserve), 'and no $OMR');
  assert.equal(Number((await pool.query('SELECT fund FROM street_tax WHERE id=1')).rows[0].fund), fundPre,
    'and the event fund paid for nothing');
}

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

// (c) $OMR conservation — run the real §10.4 job and assert the $OMR total still reconciles.
//     Since tokenomics v2 step 2 there is no way to BUY $OMR in-game, so this file grants what it
//     needs by SQL (1200 to the staker, 40 + 10 into the two legacy yield pools to give the merge
//     something real to move). Those grants are deliberately UNLEDGERED, so they are exactly the
//     expected drift — asserting the drift equals them is a stronger claim than `ok`, because it
//     proves every OTHER $OMR movement in the file (the pool merge, the retired-yield paths) is
//     conservation-neutral rather than merely that the total happens to land somewhere plausible.
const SQL_OMR_GRANTED = 1200 + 40 + 10;
const { runLedgerInvariants } = await import('../src/invariants.js');
const omrCheck = (await runLedgerInvariants(pool, { alert: false })).checks.find((x) => x.name === '$OMR conservation');
assert(Math.abs(Number(omrCheck.drift) - SQL_OMR_GRANTED) < 1e-6,
  `$OMR drift is EXACTLY this file's SQL grants (${SQL_OMR_GRANTED}), i.e. every real movement conserves — got ${omrCheck.drift}`);
const ammFinal = (await pool.query('SELECT * FROM amm_pool WHERE id=1')).rows[0];
assert(Number(ammFinal.omr_reserve) > 0 && Number(ammFinal.cash_reserve) > 0, 'AMM reserves stay positive');

// ══════════ BUSINESS EMPIRE (premium, acquired-later personal fronts) ══════════
// Buy/upgrade venues that farm pocket cash + double as private, lower-heat laundering. Exercised on
// the SQL-seeded `cid` (level ~250), so the global cash-ledger identity isn't asserted here — the
// focused checks below prove each faucet/sink is ledgered under the right §10.4 reason instead.
let cat = await call('GET', '/v1/catalog');
assert.equal(cat.code, 200, 'catalog is public'); assert(cat.body.businesses.find((b) => b.kind === 'laundromat')?.tiers.length === 3, 'catalog lists the laundromat + its tier ladder');
// level gate — a low-level man can't open a front
await seed("respect=250"); // level ~6, below the laundromat's level-15 gate
assert.equal((await call('POST', '/v1/business/laundromat/buy', { token })).body.error, 'level', 'a business is level-gated ("acquired later")');
await seed("respect=625000, cash=2000000, loc='docks', heat=0");
// buy
let bizCashPre = (await meOf(token)).cash;
r = await call('POST', '/v1/business/laundromat/buy', { token });
assert.equal(r.code, 200, 'bought a laundromat'); assert.equal(r.body.tier, 1, 'opens at tier 1');
let bizId = r.body.id;
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
// red-team R3 (D2 parity): upgrading BANKS pending income, so a safehoused (untargetable) owner
// must be blocked from it exactly like collect — a shield is not a bunker to run the books from.
await seed("cash=2000000, safe_until = now() + interval '1 hour'");
assert.equal((await call('POST', `/v1/business/${bizId}/upgrade`, { token })).body.error, 'safe', "can't upgrade (bank income) from a safehouse");
await seed("cash=2000000, safe_until=NULL");
// PRIVATE LAUNDERING — RETIRED (tokenomics v2 step 2). Fronts used to be the game's best wash
// rail: no district gate, a per-tier daily capacity, and LESS heat than the street. Nothing left
// to wash into, so the whole rail is gone and the Business Empire keeps only its income half.
await seed("cash=2000000, heat=0, safe_until=NULL, loc='neon'");
assert.equal((await call('POST', `/v1/business/${bizId}/launder`, { token, body: { amount: 40000 } })).body.error,
  'retired', 'the private wash rail is retired');
assert.equal((await meOf(token)).heat, 0, 'and it draws no heat, because it does nothing');
// §10.4: each movement is ledgered under the right reason (spends == sinks, income == faucet)
const bizBuys = Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='business:buy' AND character_id=$1", [cid])).rows[0].s);
const bizUp = Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='business:upgrade' AND character_id=$1", [cid])).rows[0].s);
const bizInc = Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='business:income' AND character_id=$1", [cid])).rows[0].s);
assert.equal(bizBuys, -250000, 'business:buy is a ledgered cash sink');
assert.equal(bizUp, -600000, 'business:upgrade is a ledgered cash sink');
assert.equal(bizInc, col1 + colCap + colUp, 'business:income is a ledgered cash faucet (all three collects)');

// ══════════ THE BUREAU RETURNS — scrutiny is income-sourced (the dark-risk-layer resolution) ══════════
// Front scrutiny came ONLY from laundering and went dark with it (v2 step 2) — the dormancy was
// asserted right here. Founder-directed option (b): a front now HEATS BY EARNING — banking income
// adds PER_INCOME_DAY per full operating day's income (tier-normalized), so the Bureau-raid layer
// is reachable again and its cost scales with the size of the operation (the seized pending + a
// %-of-tier-cost fine) while the raid PROBABILITY is uniform across the catalog.
process.env.BUSINESS_RAID_P = '0';   // no raid-roll noise while the heat itself is measured
await pool.query(`UPDATE businesses SET scrutiny=0, scrutiny_at=now(), last_collect_at = now() - interval '6 hours' WHERE id='${bizId}'`);
r = await call('POST', '/v1/business/collect', { token });
assert(r.body.collected > 0, 'the income banks as before');
let lm = (await call('GET', '/v1/business', { token })).body.businesses.find((b) => b.id === bizId);
// 6h of a 24h operating day banked → + PER_INCOME_DAY × 6/24 (7.5 at the signed 30; view rounds)
const expHeat = CONSTANTS.BUSINESS_SCRUTINY_PER_INCOME_DAY * 6 / 24;
assert(Math.abs(lm.scrutiny - expHeat) <= 1, `banking 6h of income heats the front ~+${expHeat} (got ${lm.scrutiny})`);
assert.equal(lm.raidRisk, false, 'below the threshold the Bureau just watches');
assert.equal(lm.raidThreshold, CONSTANTS.BUSINESS_RAID_THRESHOLD, 'the view carries the real raid line (the territoryOf precedent)');
// a HOT front is raided at the collect touch: the pending is SEIZED (never banked, never ledgered)
// and the fine is a ledgered §10.4 cash sink — the machinery that sat dead now fires
process.env.BUSINESS_RAID_P = '1';
// scrutiny_at must sit in the PAST: the roll runs over the minutes the front actually SAT above
// the threshold this window (1−(1−p)^minAbove), so an elapsed window of ~0 rolls nothing at any p
await pool.query(`UPDATE businesses SET scrutiny=90, scrutiny_at = now() - interval '2 hours', last_collect_at = now() - interval '10 hours' WHERE id='${bizId}'`);
const fined0 = Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='business:raid' AND character_id=$1", [cid])).rows[0].s);
r = await call('POST', '/v1/business/collect', { token });
const raid = (r.body.raids || []).find((x) => x.kind === 'laundromat');
assert(raid, 'the hot front is raided at the collect touch');
assert(raid.seized > 0, 'the pending income is seized');
assert(raid.fine > 0, 'and the fine lands');
const fined1 = Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='business:raid' AND character_id=$1", [cid])).rows[0].s);
assert.equal(fined1 - fined0, -raid.fine, 'business:raid is a ledgered §10.4 cash sink');
lm = (await call('GET', '/v1/business', { token })).body.businesses.find((b) => b.id === bizId);
assert.equal(lm.scrutiny, 0, 'a raid clears the file');
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

// ══════════ THE STREET WAR — rob a front + steal a car + the rivals ledger ══════════
// (omerta-street-rivals-design.md, founder-directed). Rob is the shakedown's STEALTH sibling on
// the SAME per-venue window; car theft is a pure ownership move; rivals is intel over both.
// (1) ROB shares the shakedown's 8h window — a just-visited front refuses the OTHER verb too
assert.equal((await call('POST', `/v1/business/${bizId}/rob`, { token: t2 })).body.error, 'cooldown',
  'rob and shakedown share ONE per-venue window (the bound the signed audit assumed)');
// (2) a won rob: stealth stats dominate; the cut is 15% of pending, the owner keeps ~85%
await pool.query(`UPDATE businesses SET shakedown_at=NULL, last_collect_at = now() - interval '10 hours', scrutiny=0, scrutiny_at=now(), upkeep_at=now() WHERE id='${bizId}'`);
await seed2("cunning=2000, speed=2000, muscle=5, energy=200, heat=0, jail_until=NULL");
await seed("cunning=5, speed=5");
let robWin = null;
for (let i = 0; i < 60 && !robWin; i++) {
  await seed2("energy=200, jail_until=NULL");
  await pool.query(`UPDATE businesses SET shakedown_at=NULL WHERE id='${bizId}'`);
  const rb = await call('POST', `/v1/business/${bizId}/rob`, { token: t2 });
  assert.equal(rb.code, 200, 'rob attempt resolves');
  assert(rb.body.robbed, 'the response carries the rob marker (describe() must not read it as a shakedown)');
  if (rb.body.win) robWin = rb.body;
}
assert(robWin, 'a 2000-cunning sneak eventually cracks a 5-cunning owner');
assert(robWin.cut > 0, 'skimmed a cut of the pending take');
assert(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='business:rob' AND character_id='${c2}'`)).rows[0].s) >= robWin.cut,
  'business:rob is a ledgered faucet on the robber (§10.4 check (a) reconciles — the same bounded income, redirected)');
// the owner kept ~85% of the pending (the clock advanced by only the 15% stolen share)
r = await call('POST', '/v1/business/collect', { token });
assert(Math.abs(r.body.collected - Math.round(robWin.cut * 8500 / 1500)) <= 400,
  `owner kept ~85% of the pending (cut $${robWin.cut}, owner collected $${r.body.collected})`);
// (3) a FAILED rob is jail — it's a crime, you get pinched
await seed2("cunning=1, speed=1, energy=200, jail_until=NULL");
await seed("cunning=2000, speed=2000");
await pool.query(`UPDATE businesses SET shakedown_at=NULL, last_collect_at = now() - interval '2 hours' WHERE id='${bizId}'`);
{
  let pinched = null;
  for (let i = 0; i < 60 && !pinched; i++) {
    await seed2("energy=200, jail_until=NULL");
    await pool.query(`UPDATE businesses SET shakedown_at=NULL WHERE id='${bizId}'`);
    const rb = await call('POST', `/v1/business/${bizId}/rob`, { token: t2 });
    if (!rb.body.win) pinched = rb.body;
  }
  assert(pinched && pinched.jailedS > 0, 'a failed rob is a stretch in lockup');
  const j = (await pool.query(`SELECT jail_until FROM characters WHERE id='${c2}'`)).rows[0];
  assert(j.jail_until && new Date(j.jail_until) > new Date(), 'and the robber really is inside');
}
// (4) STEAL A CAR — the server draws a random eligible car; a win is a pure ownership move
await seed2("jail_until=NULL, energy=200, gta_at=NULL, heat=0, cunning=50, speed=50");
await seed("respect=625000, hosp_until=NULL"); // the owner is a made mark, not a rookie
// put iron on the mark's street through the REAL verb (an SQL car would drift car conservation)
for (let i = 0; i < 120; i++) {
  if (Number((await pool.query(`SELECT COUNT(*) n FROM cars WHERE character_id='${cid}'`)).rows[0].n) >= 2) break;
  await seed("gta_at=NULL, energy=200, jail_until=NULL");
  await call('POST', '/v1/garage/boost', { token });
}
const fleetBefore = Number((await pool.query('SELECT COUNT(*) n FROM cars')).rows[0].n);
const ownerCars0 = Number((await pool.query(`SELECT COUNT(*) n FROM cars WHERE character_id='${cid}'`)).rows[0].n);
assert(ownerCars0 > 0, 'the mark keeps iron on the street');
// flag ALL the mark's cars for the strip — the server steals a RANDOM one, so flagging just one
// would exercise the clearing only by luck (a mutation could survive; the scale.js vacuity lesson)
await pool.query(`UPDATE cars SET race_limit=5000, pink_slip=true WHERE character_id='${cid}'`);
process.env.CAR_THEFT_P = '1';
r = await call('POST', `/v1/streets/${cid}/steal`, { token: t2 });
assert.equal(r.code, 200, 'the theft resolves');
assert(r.body.win && r.body.theft && r.body.car, 'a forced win takes a car');
assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM cars')).rows[0].n), fleetBefore,
  'car CONSERVATION holds — a theft moves a row, never mints one');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM cars WHERE character_id='${cid}'`)).rows[0].n), ownerCars0 - 1,
  'the mark is down exactly one car');
{
  const stolen = (await pool.query(`SELECT race_limit, pink_slip FROM cars WHERE id='${r.body.car.id}'`)).rows[0];
  assert(stolen.race_limit == null && stolen.pink_slip === false,
    'the transfer clears the consent flags (a stolen car must not arrive still on the strip)');
}
assert.equal(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason LIKE 'cartheft%'`)).rows[0].s), 0,
  'a theft writes ZERO ledger rows — ownership, not currency');
// pin the WIN's own ledger entry NOW, before any failed attempts also write car_theft rows —
// without this, dropping the win-path recordRival survives on the loss-path's rows (mutation M3)
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM rival_events WHERE kind='car_theft'`)).rows[0].n), 1,
  'the successful theft itself lands on the rivals ledger');
// the victim's shield: a second theft the same night is refused however fresh the thief's clock is
await seed2("gta_at=NULL, energy=200");
assert.equal((await call('POST', `/v1/streets/${cid}/steal`, { token: t2 })).body.error, 'shielded',
  'a player loses at most one car per shield window');
// the thief's clock is the GTA clock — a fresh victim but a hot gta_at refuses too
await pool.query(`UPDATE characters SET car_stolen_at=NULL WHERE id='${cid}'`);
await seed2("gta_at=now()");
assert.equal((await call('POST', `/v1/streets/${cid}/steal`, { token: t2 })).body.error, 'cooldown',
  'player theft rides the signed GTA window (no new farm cadence)');
await seed2("gta_at=NULL");
// rookie protection: a fresh-faced victim is off-limits
await seed2("gta_at=NULL, energy=200");
await seed("respect=10"); // level 1
assert.equal((await call('POST', `/v1/streets/${cid}/steal`, { token: t2 })).body.error, 'rookie',
  "a corner kid's beater is off-limits");
await seed("respect=625000");
// a forced LOSS is jail and the mark is told who tried
process.env.CAR_THEFT_P = '0';
await pool.query(`UPDATE characters SET car_stolen_at=NULL WHERE id='${cid}'`);
r = await call('POST', `/v1/streets/${cid}/steal`, { token: t2 });
assert(r.code === 200 && !r.body.win && r.body.jailedS > 0, `caught mid-hotwire — lockup (got ${JSON.stringify(r.body)})`);
delete process.env.CAR_THEFT_P;
// (5) THE RIVALS LEDGER — the mark's board remembers the robber's bloodline, resolved to the
// living street, with NO account UUID exposed; the aggressor's own board stays clean
r = await call('GET', '/v1/rivals', { token });
assert.equal(r.code, 200, 'the rivals board answers');
{
  const riv = r.body.rivals.find((x) => x.street && x.street.id === c2);
  assert(riv, "the mark's ledger names the aggressor's living street");
  assert(riv.kinds.rob >= 1 && riv.kinds.car_theft >= 1, 'counts by kind cover the rob AND the theft');
  assert(riv.total >= 3, 'failed attempts count too — malice is malice');
  assert(!('account' in riv) && !('aggressor_account' in riv), 'no account UUID leaves the server');
  const mine = await call('GET', '/v1/rivals', { token: t2 });
  assert(!(mine.body.rivals || []).some((x) => x.street && x.street.id === cid),
    "the AGGRESSOR's board is clean — being robbed is malice, robbing back is business");
}

// ══════════ THE STREET WAR step two — trunk robbery, boat theft, sabotage, revenge, the coach ══════════
// (omerta-street-rivals-design.md §4, founder-directed). Trunk robbery is a goods OWNERSHIP MOVE,
// boat theft a ROW move sharing the vehicle shield + GTA clock, sabotage pure injured_until pacing;
// striking a rival you're still NET OWED against pays honor; the coach names fresh malice.
// (A) TRUNK ROBBERY — mug the freight; capped by the robber's free trunk space; zero ledger rows
await seed("cash=1000000, jail_until=NULL, hosp_until=NULL, respect=625000, cunning=5, speed=5, loc='docks'");
await seed2("jail_until=NULL, hosp_until=NULL, energy=200, heat=0, cunning=2000, speed=2000, loc='docks', gta_at=NULL");
// an empty mark refuses BEFORE any cost
assert.equal((await call('POST', `/v1/streets/${cid}/trunk`, { token: t2 })).body.error, 'empty', 'no freight, no mugging');
r = await call('POST', '/v1/goods/buy', { token, body: { goodId: 'gin', qty: 8 } });
assert.equal(r.code, 200, `the mark loads freight (${JSON.stringify(r.body)})`);
{
  let mug = null;
  for (let i = 0; i < 40 && !mug; i++) {
    await seed2("energy=200, jail_until=NULL");
    await pool.query(`UPDATE characters SET trunk_robbed_at=NULL WHERE id='${cid}'`);
    const rb = await call('POST', `/v1/streets/${cid}/trunk`, { token: t2 });
    assert.equal(rb.code, 200, 'the mugging resolves');
    if (rb.body.win) mug = rb.body;
  }
  assert(mug && mug.trunk && mug.good === 'gin' && mug.qty >= 1, `a 2000-cunning sneak lifts the freight (${JSON.stringify(mug)})`);
  const mine = Number((await pool.query(`SELECT COALESCE(SUM(qty),0) n FROM character_cargo WHERE character_id='${c2}' AND good_id='gin'`)).rows[0].n);
  const theirs = Number((await pool.query(`SELECT COALESCE(SUM(qty),0) n FROM character_cargo WHERE character_id='${cid}' AND good_id='gin'`)).rows[0].n);
  assert.equal(mine, mug.qty, 'the goods landed in the robber\'s trunk');
  assert.equal(theirs, 8 - mug.qty, 'and left the mark\'s — an OWNERSHIP MOVE, units conserved');
  assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM transactions WHERE reason LIKE 'trunk%'`)).rows[0].n), 0,
    'a mugging writes ZERO ledger rows — goods are not a §10.4 currency');
  // the victim's shield: one landed robbery per window, however many muggers try
  await seed2("energy=200, jail_until=NULL");
  assert.equal((await call('POST', `/v1/streets/${cid}/trunk`, { token: t2 })).body.error, 'shielded', 'the trunk shield holds');
  // (AUDIT-street-life F4) the PERSON-crime victim gates — trunk freight rides ON the man, so a
  // mark in LOCKUP can't be mugged for it (the "jail must never be MORE dangerous than the street"
  // class v2/v3 closed on fire/npcHit/jump — the shared assertStreetCrime helper lacked it).
  await pool.query(`UPDATE characters SET trunk_robbed_at=NULL, jail_until=now() + interval '10 minutes' WHERE id='${cid}'`);
  assert.equal((await call('POST', `/v1/streets/${cid}/trunk`, { token: t2 })).body.error, 'jailed',
    'F4: a jailed mark cannot be trunk-mugged — the freight went in with them');
  await pool.query(`UPDATE characters SET jail_until=NULL WHERE id='${cid}'`);
}
// a FAILED mugging is jail (reload the mark's freight first — the win may have taken it all)
await seed2("cunning=1, speed=1, energy=200, jail_until=NULL");
await seed("cunning=2000, speed=2000, cash=1000000");
await call('POST', '/v1/goods/buy', { token, body: { goodId: 'gin', qty: 5 } });
await pool.query(`UPDATE characters SET trunk_robbed_at=NULL WHERE id='${cid}'`);
{
  let pinched = null;
  for (let i = 0; i < 40 && !pinched; i++) {
    await seed2("energy=200, jail_until=NULL");
    const rb = await call('POST', `/v1/streets/${cid}/trunk`, { token: t2 });
    if (rb.code === 200 && !rb.body.win) pinched = rb.body;
  }
  assert(pinched && pinched.jailedS > 0, 'pinched mid-mugging — lockup');
}
// (B) BOAT THEFT at the docks — a docked boat's row moves; the VEHICLE shield is SHARED with cars
await seed("cash=1000000, cunning=5, speed=5, loc='docks'");
r = await call('POST', '/v1/port/boat/dinghy', { token });
assert.equal(r.code, 200, `the mark buys a dinghy (${JSON.stringify(r.body)})`);
const boatsBefore = Number((await pool.query('SELECT COUNT(*) n FROM boats')).rows[0].n);
await seed2("jail_until=NULL, energy=200, gta_at=NULL, cunning=50, speed=50, loc='canal'");
await pool.query(`UPDATE characters SET car_stolen_at=NULL WHERE id='${cid}'`);
process.env.CAR_THEFT_P = '1';
assert.equal((await call('POST', `/v1/streets/${cid}/boat`, { token: t2 })).body.error, 'district',
  'boats are stolen where they float — the docks');
await seed2("loc='docks'");
r = await call('POST', `/v1/streets/${cid}/boat`, { token: t2 });
assert(r.code === 200 && r.body.win && r.body.boatTheft && r.body.boat, `a forced win slips her moorings (${JSON.stringify(r.body)})`);
assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM boats')).rows[0].n), boatsBefore,
  'boat rows conserve — a theft moves one, never mints one');
{
  const b = (await pool.query(`SELECT character_id, rendezvous FROM boats WHERE id='${r.body.boat.id}'`)).rows[0];
  assert.equal(b.character_id, c2, 'the boat is the thief\'s now');
  assert.equal(b.rendezvous, false, 'the consent flag is cleared on transfer');
}
// the SHARED vehicle shield: the boat theft stamped car_stolen_at, so a CAR theft is refused too
await seed2("gta_at=NULL, energy=200");
assert.equal((await call('POST', `/v1/streets/${cid}/steal`, { token: t2 })).body.error, 'shielded',
  'ONE vehicle a day — car or boat, the shield is shared');
// a forced LOSS is jail
process.env.CAR_THEFT_P = '0';
await seed("cash=1000000"); await seed2("gta_at=NULL, energy=200, jail_until=NULL");
await pool.query(`UPDATE characters SET car_stolen_at=NULL WHERE id='${cid}'`);
r = await call('POST', '/v1/port/boat/dinghy', { token }); // give them another hull to fail against
r = await call('POST', `/v1/streets/${cid}/boat`, { token: t2 });
assert(r.code === 200 && !r.body.win && r.body.jailedS > 0, `caught on the gangway (${JSON.stringify(r.body)})`);
delete process.env.CAR_THEFT_P;
// (C) SABOTAGE — one random fit racer/fighter laid up; booked fighters untouchable; pure pacing
await seed2("jail_until=NULL, energy=200, cunning=2000, speed=2000");
await pool.query(`UPDATE characters SET sabotaged_at=NULL WHERE id='${cid}'`);
assert.equal((await call('POST', `/v1/streets/${cid}/sabotage`, { token: t2 })).body.error, 'nothing',
  'no stable, nothing to wreck — refused before any cost');
await seed("cash=1000000, cunning=5, speed=5");
r = await call('POST', '/v1/stable/buy', { token, body: { kind: 'dog', name: 'Old Bones' } });
assert.equal(r.code, 200, `the mark buys a greyhound (${JSON.stringify(r.body)})`);
{
  let wrecked = null;
  for (let i = 0; i < 40 && !wrecked; i++) {
    await seed2("energy=200, jail_until=NULL");
    await pool.query(`UPDATE characters SET sabotaged_at=NULL WHERE id='${cid}'`);
    const rb = await call('POST', `/v1/streets/${cid}/sabotage`, { token: t2 });
    if (rb.code === 200 && rb.body.win) wrecked = rb.body;
  }
  assert(wrecked && wrecked.what === 'racer' && wrecked.name, `the stable got wrecked (${JSON.stringify(wrecked)})`);
  const hurt = (await pool.query(`SELECT injured_until FROM racers WHERE character_id='${cid}'`)).rows[0];
  assert(hurt.injured_until && new Date(hurt.injured_until) > new Date(), 'the animal is laid up (injured_until — the existing lay-up mechanic)');
  await seed2("energy=200, jail_until=NULL");
  assert.equal((await call('POST', `/v1/streets/${cid}/sabotage`, { token: t2 })).body.error, 'shielded', 'the sabotage shield holds');
}
// (D) REVENGE TEETH — the wronged mark strikes back and the code respects it (+honor); the net
// AGGRESSOR striking again earns nothing. Judged BEFORE the strike is recorded.
await seed("energy=200, health=100, jail_until=NULL, hosp_until=NULL, muscle=2000, cunning=2000, speed=2000, heat=0");
await seed2("jail_until=NULL, hosp_until=NULL, muscle=5, cunning=5, speed=5, health=100, respect=625000");
{
  const honor0 = Number((await pool.query(`SELECT honor FROM characters WHERE id='${cid}'`)).rows[0].honor || 0);
  let jr = null;
  for (let i = 0; i < 40 && !jr; i++) {
    await seed("energy=200, jail_until=NULL");
    await pool.query(`UPDATE characters SET hosp_until=NULL WHERE id='${c2}'`);
    const rb = await call('POST', `/v1/streets/${c2}/jump`, { token });
    if (rb.code === 200 && rb.body.win) jr = rb.body;
  }
  assert(jr, 'the mark lands the payback jump');
  assert.equal(jr.revenge, true, 'the strike reads as REVENGE — they were still net owed');
  const honor1 = Number((await pool.query(`SELECT honor FROM characters WHERE id='${cid}'`)).rows[0].honor || 0);
  assert.equal(honor1, honor0 + RIVALS.REVENGE_HONOR, `settling your own scores pays honor (+${RIVALS.REVENGE_HONOR})`);
  // the net AGGRESSOR robbing the same mark again is NOT revenge (they are owed nothing)
  await seed2("cunning=2000, speed=2000, energy=200, jail_until=NULL");
  await seed("cunning=5, speed=5");
  await pool.query(`UPDATE businesses SET shakedown_at=NULL, last_collect_at = now() - interval '4 hours' WHERE id='${bizId}'`);
  let rb2 = null;
  for (let i = 0; i < 40 && !rb2; i++) {
    await seed2("energy=200, jail_until=NULL, hosp_until=NULL"); // the payback jump put them in the hospital
    await pool.query(`UPDATE businesses SET shakedown_at=NULL WHERE id='${bizId}'`);
    const rb = await call('POST', `/v1/business/${bizId}/rob`, { token: t2 });
    if (rb.code === 200 && rb.body.win) rb2 = rb.body;
  }
  assert(rb2 && rb2.revenge === false, 'the net aggressor\'s strike is just business — no honor');
}
// (E) THE COACH names fresh malice — the mark's plan leads with the someone-moved-on-you rung
await seed("jail_until=NULL, hosp_until=NULL, health=100, welsher=false, wanted_until=NULL");
{
  const me2 = (await call('GET', '/v1/me', { token })).body.character;
  const plan = [me2.coach, ...(me2.coachPlan || [])].filter(Boolean);
  assert(plan.some((c) => /moved on you/i.test(c.label || '')),
    'the coach names the fresh malice (48h window — self-clears as it rolls)');
}

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
assert.equal((await call('POST', `/v1/business/${bizId}/upgrade`, { token })).body.error, 'cold', "and won't take an upgrade");
// paying the pad THAWS it — income flows again (clock was reset by the seed, so a fresh 2h accrues)
await call('POST', '/v1/business/upkeep', { token });
await pool.query(`UPDATE businesses SET last_collect_at = now() - interval '2 hours' WHERE id='${bizId}'`);
biz = (await call('GET', '/v1/business', { token })).body.businesses.find((b) => b.id === bizId);
assert.equal(biz.cold, false, 'the pad squared → the front is warm again');
assert(((await call('POST', '/v1/business/collect', { token })).body.collected) > 0, 'and the take flows again');

// ── THE PAD MADE LEGIBLE, AND AN EXIT ──
// A tester reported the pad as a BUG ("how can I owe more in wages than my laundromat brings in?").
// The mechanic is sound — the till holds a DAY's take while the envelope runs for a WEEK — but the
// game never said so before you bought in, never warned as it slid, and (the real defect) never let
// you out: `businesses` is UNIQUE(character_id, kind), so a cold front you can't carry BLOCKED that
// kind for the rest of the street's life. These assert the three halves: the terms ship with the
// price, the slide is visible before it lands, and the door exists.
{
  // (1) THE TERMS, AT POINT OF SALE. Every figure the catalog card quotes is the SERVER's own —
  // the client re-derives none of it (the racket "/hr" precedent, where a client-side copy of a
  // formula advertised $30/hr on a front paying $1,800).
  const cat = (await call('GET', '/v1/catalog', {})).body.businesses;
  const lm = cat.find((c) => c.kind === 'laundromat');
  assert.equal(lm.upkeepPerHr, Math.floor(lm.tiers[0].incomePerHr * (CONSTANTS.BUSINESS_UPKEEP_BPS / 10000)),
    'the catalog quotes the pad alongside the income — the buyer sees both halves of the deal');
  assert.equal(lm.incomeCapHours, Math.round(CONSTANTS.BUSINESS_CAP_MS / 3600000), 'and how long the till fills');
  assert.equal(lm.upkeepCapHours, Math.round(CONSTANTS.BUSINESS_UPKEEP_CAP_MS / 3600000), 'and how long the envelope keeps running');
  assert(lm.upkeepCapHours > lm.incomeCapHours, 'the asymmetry IS the mechanic — the pad outruns the till by design');
  assert.equal(lm.coldHours, Math.round(CONSTANTS.BUSINESS_UPKEEP_COLD_MS / 3600000), 'and how long before the boys walk');

  // (2) THE SLIDE, VISIBLE BEFORE IT LANDS. `coldSeconds` counts down to the moment it goes dark
  // (a player who can see "14h" is making a choice; one who only meets the word COLD was ambushed),
  // and `padOutran` names the turn — the point where squaring it costs more than the front can hand
  // you. Both are the server's read of the same clocks the till charges from.
  await pool.query(`UPDATE businesses SET upkeep_at=now(), last_collect_at=now() WHERE id='${bizId}'`);
  biz = (await call('GET', '/v1/business', { token })).body.businesses.find((b) => b.id === bizId);
  assert(Math.abs(biz.coldSeconds - CONSTANTS.BUSINESS_UPKEEP_COLD_MS / 1000) < 60,
    `a freshly-squared front has the full window before it goes dark (~${CONSTANTS.BUSINESS_UPKEEP_COLD_MS / 1000}s, got ${biz.coldSeconds})`);
  assert.equal(biz.padOutran, false, 'and the pad has not outrun the till');
  // Two days away: the countdown is visibly running but the front is still warm and still ahead —
  // the warning arrives BEFORE the punishment, which is the whole point of surfacing the clock.
  await pool.query(`UPDATE businesses SET upkeep_at = now() - interval '2 days', last_collect_at = now() - interval '2 days' WHERE id='${bizId}'`);
  biz = (await call('GET', '/v1/business', { token })).body.businesses.find((b) => b.id === bizId);
  assert.equal(biz.cold, false, '2 days unattended → still warm');
  assert(biz.coldSeconds > 0 && biz.coldSeconds < CONSTANTS.BUSINESS_UPKEEP_COLD_MS / 1000,
    `but the clock is visibly running down (${biz.coldSeconds}s left of the window)`);
  assert.equal(biz.padOutran, false, 'and the till is still ahead of the pad');
  // Six days away — the tester's original complaint, and the assertion is now the OPPOSITE of what it
  // was, because D6=B removed the crossover it used to prove. The envelope stops at
  // BUSINESS_UPKEEP_CAP_MS while the till stops at BUSINESS_CAP_MS, so neglect still costs real income
  // — the front is cold and the take was capped days ago — but squaring up can no longer cost MORE
  // than the place can hand back, at any absence however long.
  await pool.query(`UPDATE businesses SET upkeep_at = now() - interval '6 days', last_collect_at = now() - interval '6 days' WHERE id='${bizId}'`);
  biz = (await call('GET', '/v1/business', { token })).body.businesses.find((b) => b.id === bizId);
  assert.equal(biz.cold, true, '6 days unattended → cold');
  assert.equal(biz.coldSeconds, 0, 'and the countdown is spent');
  assert(biz.upkeepOwed < biz.pending,
    `the pad no longer outruns the till (owed ${biz.upkeepOwed} vs pending ${biz.pending})`);
  assert.equal(biz.padOutran, false, 'so the view says the crossover has NOT happened');
  // ...and prove it from the CONSTANTS rather than from one fixture, at the WORST case: a five-front
  // stack pays the top progressive rate. Owed maxes at rate × capHours; the till maxes at 24h of
  // income. If a future retune stretches the cap (or steepens the pad) back past that line, this
  // fails by name instead of quietly restoring the trap the tester found.
  {
    const worstBps = CONSTANTS.BUSINESS_UPKEEP_BPS + 4 * CONSTANTS.BUSINESS_UPKEEP_PROG_BPS;
    const padHours = (worstBps / 10000) * (CONSTANTS.BUSINESS_UPKEEP_CAP_MS / 3600000);
    const tillHours = CONSTANTS.BUSINESS_CAP_MS / 3600000;
    assert(padHours <= tillHours,
      `the pad can outrun the till again: a 5-front stack owes ${padHours.toFixed(1)}h of income at the `
      + `cap against a ${tillHours}h till. Either lower BUSINESS_UPKEEP_CAP_MS or accept the crossover `
      + 'deliberately — D6=B chose to remove it (BALANCE.md § THE PAD OUTRUNS THE TILL).');
  }

  // (3) THE DOOR. Closing up is permanent and frees the UNIQUE(character, kind) slot — which is the
  // whole point: without it a front you cannot carry bars that business kind forever.
  const before = (await call('GET', '/v1/business', { token })).body.businesses.length;
  assert.equal((await call('DELETE', `/v1/business/${cid}`, { token })).body.error, 'not_yours', "you can't close a front that isn't yours");
  const shut = await call('DELETE', `/v1/business/${bizId}`, { token });
  assert.equal(shut.code, 200, 'closing up succeeds');
  assert.equal(shut.body.kind, 'laundromat', 'and names what closed');
  assert.equal((await call('GET', '/v1/business', { token })).body.businesses.length, before - 1, 'the front is gone');
  // the pad DIES WITH IT, and that is not a loophole: upkeepOwed is COMPUTED from upkeep_at, never
  // stored, so walking away leaves no debt behind to forgive — you simply forfeit everything sunk in.
  assert.equal((await call('POST', '/v1/business/upkeep', { token })).body.error, 'none', 'and owes nothing further — there is no front to owe for');
  // THE SLOT IS FREE — the defect this closes. Re-buying starts at tier 1, at tier-1 prices.
  await seed("cash=2000000");
  const rebuy = await call('POST', '/v1/business/laundromat/buy', { token });
  assert.equal(rebuy.code, 200, 'the kind is available again — a cold front no longer bars it for life');
  bizId = rebuy.body.id;
  const fresh = (await call('GET', '/v1/business', { token })).body.businesses.find((b) => b.id === bizId);
  assert.equal(fresh.tier, 1, 'and it starts at tier 1 — you bought a business, not your old one back');

  // ── THE DOOR MUST NEVER BE CHEAPER THAN THE RENT ──
  // The pad is a designed RECURRING SINK; the shutter is a door out of a permanent slot-block. If
  // walking away and re-buying ever costs LESS than squaring up, the door stops being an escape
  // hatch and becomes the optimal way to never pay rent — the sink acquires an opt-out and quietly
  // stops draining. Nothing in the code states that relation, and BUSINESS_SHUTTER_BPS ships at 0
  // precisely so it holds — but that lever is documented as raisable, so the relation is asserted
  // from the LIVE constants rather than trusted. Both branches end holding a warm TIER-1 front, so
  // they are directly comparable in cash:
  //     PAY  = collect the full till, settle the maxed arrears  →  pending − maxPad
  //     WALK = forfeit the till, pay tier-1 again, take the refund  →  back − tier1cost
  // Measured today the margin is wide (paying wins on every front by $115k–$5.3M), and the flip
  // point is BUSINESS_SHUTTER_BPS ≈ 5400 on the laundromat. Raise it past there — or stretch
  // BUSINESS_UPKEEP_CAP_MS — and this fails by name instead of unwinding the pad in silence.
  {
    const capH = CONSTANTS.BUSINESS_CAP_MS / 3600000;                       // the till: one day
    const padH = CONSTANTS.BUSINESS_UPKEEP_CAP_MS / 3600000;                // the envelope: one week
    const rate = CONSTANTS.BUSINESS_UPKEEP_BPS / 10000;
    for (const b of BUSINESSES) {
      const t1 = b.tiers[0];
      const pending = t1.incomePerHr * capH;
      const maxPad = t1.incomePerHr * padH * rate;
      const back = t1.cost * (CONSTANTS.BUSINESS_SHUTTER_BPS / 10000);      // assessed value at tier 1 IS the build cost
      assert(pending - maxPad > back - t1.cost,
        `${b.kind}: walking away and re-buying is CHEAPER than paying the pad, so the recurring sink `
        + `has an opt-out — pay nets ${Math.round(pending - maxPad)}, walk nets ${Math.round(back - t1.cost)}. `
        + `Lower BUSINESS_SHUTTER_BPS or shorten BUSINESS_UPKEEP_CAP_MS.`);
    }
  }
}

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
// D3 — the public wash cap is MOOT since tokenomics v2 step 2: there is no wash to cap. The
// per-account bucket that bounded it (`wash_used`/`wash_at`) is inert rather than removed —
// dropping live columns is a migration this change does not need to take on.
await seed("cash=5000000, heat=0, loc='docks', wash_used=0, wash_at=NULL");
assert.equal((await call('POST', '/v1/swap', { token, body: { direction: 'buy', amount: 2000000 } })).body.error,
  'retired', 'the public wash route is gone, so its daily cap has nothing left to bound');
// D5 — bank interest TAPERS above $10M: full rate on the first $10M, 10% of the rate beyond
await seed("cash=0, bank=30000000, bank_credit_ms=0, last_accrued_at = now() - interval '4 hours', safe_until=NULL");
const taperMe = await meOf(token);
// 2h eligible (the B2 bucket) → effective principal 10M + 20M×0.1 = 12M → +$40k (untapered: +$100k)
assert(taperMe.bank > 30030000 && taperMe.bank < 30050000,
  `whale interest tapered (+$${Math.round(taperMe.bank - 30000000)}; untapered 4h-gap would be ~+$100k)`);

// ══════════ BUSINESS EMPIRE → Tier 4 — the launderer legend, specializations, the hostile takeover ══════════
// reset bizId to a clean, MAX-TIER laundromat owned by cid (done last so we don't disturb the earlier blocks)
process.env.BUSINESS_TAKEOVER_P = '1';
await pool.query(`UPDATE businesses SET tier=3, spec=NULL, spec_at=NULL, scrutiny=0, scrutiny_at=now(), launder_used=0, launder_at=now(), last_collect_at=now(), upkeep_at=now(), takeover_cd_until=NULL WHERE id='${bizId}'`);
await seed("cash=2000000, loc='docks', heat=0, safe_until=NULL, muscle=5, cunning=5");
await pool.query(`UPDATE account_persistent SET omr=1200 WHERE account_id=(SELECT account_id FROM characters WHERE id='${cid}')`);
const acctOf = async (col) => Number((await pool.query(`SELECT ${col} v FROM account_persistent WHERE account_id=(SELECT account_id FROM characters WHERE id='${cid}')`)).rows[0].v);

// (A) THE LAUNDERER legend is now a FROZEN historical board. It survives death and still ranks
// what people washed while the rail existed — retiring a mechanic does not erase the record — but
// nothing can add to it any more.
// seeded, because nothing in the game can wash any more — this is exactly the shape of a real
// database after the migration: a lifetime figure earned while the rail existed, and frozen since.
await pool.query(`UPDATE account_persistent SET laundered_lifetime = 750000 WHERE account_id=(SELECT account_id FROM characters WHERE id='${cid}')`);
const washed0 = await acctOf('laundered_lifetime');
assert.equal(washed0, 750000, 'a pre-retirement launderer has a record');
assert.equal((await call('POST', `/v1/business/${bizId}/launder`, { token, body: { amount: 100000 } })).body.error,
  'retired', 'no more washing');
assert.equal(await acctOf('laundered_lifetime'), washed0, 'so the launderer legend cannot grow');
const meLaund = await meOf(token);
assert.equal(meLaund.launderer.washed, washed0, 'the view still surfaces the frozen legend');
assert.equal(meLaund.launderer.rank, launderRankOf(meLaund.launderer.washed).name, 'and still ranks it on the ladder');

// (B) THE ACCOUNTANT and THE FIXER are ALIVE again — the Bureau layer has a feed once more
// (income), so the Bureau-facing specs buy a real effect and are back on the shelf. They were
// REFUSED while the layer had no feed (selling a dead effect for real $OMR is worse than
// dormancy); un-retiring them is part of the same resolution that re-sourced scrutiny.
r = await call('POST', `/v1/business/${bizId}/specialize`, { token, body: { spec: 'accountant' } });
assert.equal(r.code, 200, 'the accountant is back on the payroll');
// and he does his job: the income heat is HALVED (scrutinyMult 0.5 now reads at the income feed)
await pool.query(`UPDATE businesses SET scrutiny=0, scrutiny_at=now(), last_collect_at = now() - interval '6 hours', upkeep_at=now() WHERE id='${bizId}'`);
await call('POST', '/v1/business/collect', { token });
{
  const lmA = (await call('GET', '/v1/business', { token })).body.businesses.find((b) => b.id === bizId);
  const expHalf = CONSTANTS.BUSINESS_SCRUTINY_PER_INCOME_DAY * 6 / 24 / 2;
  assert(Math.abs(lmA.scrutiny - expHalf) <= 1, `the accountant halves the Bureau heat on the take (~+${expHalf}, got ${lmA.scrutiny})`);
}
assert.equal((await call('POST', `/v1/business/${bizId}/specialize`, { token, body: { spec: 'fixer' } })).code, 200,
  'the fixer takes the retainer again');
const omrPreSpec = await acctOf('omr');
// THE FORTRESS still works — hostile takeovers still happen, so its +40 defence is still real
r = await call('POST', `/v1/business/${bizId}/specialize`, { token, body: { spec: 'fortress' } });
assert.equal(r.code, 200, 'the fortress is untouched — takeovers still happen');
assert.equal(await acctOf('omr'), omrPreSpec - BUSINESS_EMPIRE.SPEC_OMR, 'and it charges the $OMR it always did');
assert(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='business:spec' AND currency='omr'")).rows[0].s) <= -BUSINESS_EMPIRE.SPEC_OMR, 'business:spec is a ledgered $OMR burn');
// gates: a bad spec, and specializing a NON-max-tier front
assert.equal((await call('POST', `/v1/business/${bizId}/specialize`, { token, body: { spec: 'nope' } })).body.error, 'bad_spec', 'a bad spec is refused');
await pool.query(`UPDATE businesses SET tier=2 WHERE id='${bizId}'`);
// (any spec hits the tier gate now that all three are purchasable)
assert.equal((await call('POST', `/v1/business/${bizId}/specialize`, { token, body: { spec: 'fortress' } })).body.error, 'not_maxed', 'only a max-tier front can specialize');
await pool.query(`UPDATE businesses SET tier=3 WHERE id='${bizId}'`);

// (C) TYCOON fold-in — a collect bumps the account-level tycoon_earned by exactly the income banked
await pool.query(`UPDATE businesses SET last_collect_at = now() - interval '1 hour', scrutiny=0, scrutiny_at=now(), upkeep_at=now() WHERE id='${bizId}'`);
const ty0 = await acctOf('tycoon_earned');
r = await call('POST', '/v1/business/collect', { token });
assert(r.body.collected > 0, 'collected some income');
assert.equal((await acctOf('tycoon_earned')) - ty0, r.body.collected, 'business income folds into the TYCOON legend (exact delta)');

// (D) FRONT-SET titles — read-derived completion titles (helper unit test + the view exposes the field)
assert(frontTitles([{ kind: 'laundromat', tier: 1 }, { kind: 'restaurant', tier: 1 }, { kind: 'nightclub', tier: 1 }, { kind: 'hotel', tier: 1 }, { kind: 'casino', tier: 1 }]).includes(BUSINESS_EMPIRE.SET_FRONTMAN), 'owning all 5 kinds → The Front Man');
assert(frontTitles([{ kind: 'laundromat', tier: 3 }, { kind: 'restaurant', tier: 3 }, { kind: 'nightclub', tier: 3 }, { kind: 'hotel', tier: 3 }, { kind: 'casino', tier: 3 }]).includes(BUSINESS_EMPIRE.SET_MOGUL), 'all 5 at max tier → The Mogul');
assert(Array.isArray((await meOf(token)).frontTitles), 'the view exposes frontTitles');

// (E) THE HOSTILE TAKEOVER — c2 (a strong, ungangled rival ≥ MIN_LEVEL who runs no laundromat) takes bizId
await seed2(`respect=2500000, cash=200000000, loc='docks', muscle=800, cunning=800, energy=200, safe_until=NULL, hosp_until=NULL, jail_until=NULL`);
await pool.query(`UPDATE businesses SET spec='fortress', spec_at=now(), takeover_cd_until=NULL, last_collect_at=now() WHERE id='${bizId}'`);
// (red-team) seed a lifetime den volume so the rakeback-cursor handover below is a real assertion
await pool.query('INSERT INTO den_volume (id, total) VALUES (1, 5000000) ON CONFLICT (id) DO UPDATE SET total=5000000');
const ownerCash0 = (await meOf(token)).cash;
r = await call('POST', `/v1/business/${bizId}/takeover`, { token: t2 });
assert.equal(r.code, 200, `takeover resolved: ${JSON.stringify(r.body).slice(0, 160)}`);
assert.equal(r.body.won, true, 'BUSINESS_TAKEOVER_P=1 → the takeover lands');
assert.equal(r.body.feeBurned, BUSINESS_EMPIRE.TAKEOVER.FEE, 'the takeover fee burned');
assert.equal(Number((await pool.query(`SELECT character_id c FROM businesses WHERE id='${bizId}'`)).rows[0].c === c2), 1, 'the front changed hands to the raider');
assert.equal((await meOf(token)).cash - ownerCash0, r.body.net, 'the forced-out owner was PAID the taxed net');
assert.equal((await pool.query(`SELECT spec FROM businesses WHERE id='${bizId}'`)).rows[0].spec, null, 'the seized front is reset (spec cleared — never born specialized)');
// (red-team) the den-rakeback cursor moves to TODAY's volume on a change of hands — the SAME rule
// buyBusiness states ("a new owner earns against future action, not history"). A 0 cursor handed the
// new owner a claim on the ENTIRE lifetime den volume: capped by denAvailable so never a mint, but a
// queue-jump that drains the shared, profit-bounded rakeback pool ahead of every honest owner.
assert.equal(Number((await pool.query(`SELECT rake_cursor FROM businesses WHERE id='${bizId}'`)).rows[0].rake_cursor), 5000000,
  'the seized front’s rakeback cursor is stamped at the CURRENT den volume, not 0 (no claim on history)');
assert(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='business:takeover' AND character_id=$1", [c2])).rows[0].s) === -BUSINESS_EMPIRE.TAKEOVER.FEE, 'the fee is a ledgered §10.4 cash sink');
// gates: the raider now runs a laundromat → a takeover of ANOTHER laundromat is have_kind.
// (a fresh third owner opens a laundromat; c2 — who now runs one — is refused before the roll.)
const { body: { token: t3 } } = await call('POST', '/v1/auth/guest');
await call('POST', '/v1/character', { token: t3, body: { name: 'Third Owner' } });
const c3 = (await meOf(t3)).id;
await pool.query(`UPDATE characters SET respect=625000, cash=2000000, loc='docks' WHERE id='${c3}'`);
const buy3 = await call('POST', '/v1/business/laundromat/buy', { token: t3 });
const biz3 = buy3.body.id;
assert.equal((await call('POST', `/v1/business/${biz3}/takeover`, { token: t2 })).body.error, 'have_kind', 'you can only hold one of each kind');
delete process.env.BUSINESS_TAKEOVER_P;

// (F) THE LAUNDERER leaderboard — ranked by lifetime washed; agents excluded
let lbL = (await call('GET', '/v1/leaderboard/launderers', { token })).body;
assert(lbL.launderers.some((x) => x.washed > 0), 'the launderer board lists a washman');
const cidName = (await meOf(token)).name;
await pool.query(`UPDATE account_persistent SET agent_flag=true WHERE account_id=(SELECT account_id FROM characters WHERE id='${cid}')`);
lbL = (await call('GET', '/v1/leaderboard/launderers', { token })).body;
assert(!lbL.launderers.some((x) => x.name === cidName), 'an agent-flagged launderer is excluded from the board');
await pool.query(`UPDATE account_persistent SET agent_flag=false WHERE account_id=(SELECT account_id FROM characters WHERE id='${cid}')`);

// ══════════ THE STREET WAR step three — THE TAKE + revenge with teeth ══════════
// (founder-directed 2026-07-30, explicitly including the transfer). A pulled job's cash now comes
// off the drawn MARK when there is one to take it from; the §7.2 faucet pays only the remainder.
// The player's payout is unchanged, so this re-SOURCES crime rather than retuning it — and it
// strictly REDUCES emission, since the funded share is a transfer instead of a mint.
{
  const rowsFor = async (id, like) => Number((await pool.query(
    `SELECT COALESCE(SUM(amount),0) n FROM transactions WHERE character_id=$1 AND reason LIKE $2`, [id, like])).rows[0].n);
  // one resident, standing where our man works, so the draw is deterministic
  await pool.query("DELETE FROM characters WHERE is_npc AND loc='cathedral'");
  const res = await spawnResident(pool, { band: POPULATION.BANDS.find((b) => b.id === 'boss'), level: 20 });
  // GUARANTEE the precondition rather than hope for it. Branch (A) asserts the mark funds the WHOLE
  // take, which is only true while POCKET_BPS of their pocket covers it — and the take is a random
  // draw inside the crime's band, scaled by turf, trade rank, family role and THE DAY'S CITY EVENT.
  // At a 1,000,000 pocket the cover was 250,000 against a band topping out at 130,000 before those
  // multipliers, so on a high-jobPay day the take crossed it and the assertion failed. That is the
  // recorded date-flaky class: a deterministic claim resting on a probabilistic precondition.
  const customsMax = CRIMES.find((c) => c.id === 'customs').cash[1];
  const markPocket = 20000000;
  assert(Math.floor(markPocket * RIVALS.TAKE.POCKET_BPS / 10000) > customsMax * 10,
    'the mark is seeded rich enough that POCKET_BPS covers the top of the band with every multiplier '
    + '(turf, rank, role, city event) stacked — they top out well under 10x between them');
  await pool.query("UPDATE characters SET loc='cathedral', cash=$2 WHERE id=$1", [res.id, markPocket]);
  await seed("cash=0, jail_until=NULL, hosp_until=NULL, nerve=200, energy=200, cunning=900, speed=900, loc='cathedral', respect=625000");

  const pullUntilWin = async () => {
    for (let i = 0; i < 60; i++) {
      await seed('nerve=200, jail_until=NULL');
      const rr = await call('POST', '/v1/crimes/customs', { token, body: { approach: 'standard' } });
      assert.equal(rr.code, 200, `the job resolves (${JSON.stringify(rr.body)})`);
      if (rr.body.success) return rr.body;
    }
    throw new Error('a 900-cunning street never landed a customs job in 60 tries');
  };

  // (A) a mark who can cover it funds the WHOLE take — a transfer, not a mint
  const before = Number((await pool.query('SELECT cash FROM characters WHERE id=$1', [res.id])).rows[0].cash);
  const takeRowsBefore = await rowsFor(cid, 'crime:take');
  const won = await pullUntilWin();
  assert.equal(won.markTook, won.take, `the mark covered the whole take (${JSON.stringify(won)})`);
  assert(won.victim && won.victim.length > 0, 'and the job names who it came off');
  const after = Number((await pool.query('SELECT cash FROM characters WHERE id=$1', [res.id])).rows[0].cash);
  assert.equal(before - after, won.take, "the mark's pocket is lighter by exactly what was taken");
  assert.equal(await rowsFor(cid, 'crime:take') - takeRowsBefore, won.take, 'the thief\'s crime:take leg is ledgered');
  assert.equal(await rowsFor(res.id, 'crime:take'), -won.take, 'the mark\'s leg is the exact negative — the pair NETS ZERO');

  // (B) the POCKET_BPS cap — one job never cleans a mark out
  await pool.query('UPDATE characters SET cash=$2 WHERE id=$1', [res.id, 4000]);
  const capped = await pullUntilWin();
  assert.equal(capped.markTook, Math.floor(4000 * RIVALS.TAKE.POCKET_BPS / 10000),
    `a job takes at most POCKET_BPS of the pocket (${JSON.stringify(capped)})`);
  assert(capped.markTook < capped.take, 'and the §7.2 faucet covers the remainder — the payout is unchanged');
  assert.equal(Number((await pool.query('SELECT cash FROM characters WHERE id=$1', [res.id])).rows[0].cash),
    4000 - capped.markTook, 'the mark keeps the rest');

  // (C) a mark with nothing worth taking — the faucet pays it all, no dust transfer
  await pool.query('UPDATE characters SET cash=$2 WHERE id=$1', [res.id, 10]);
  const takeBefore = await rowsFor(cid, 'crime:take');
  const dust = await pullUntilWin();
  assert.equal(dust.markTook, 0, 'below RIVALS.TAKE.MIN nothing moves — a broke mark funds nothing');
  assert.equal(await rowsFor(cid, 'crime:take'), takeBefore, 'and no dust crime:take row is written');

  // (D) NOBODY in the district — the faucet pays, exactly as before step three
  await pool.query("UPDATE characters SET loc='neon' WHERE id=$1", [res.id]);
  const alone = await pullUntilWin();
  assert.equal(alone.markTook, 0, 'an empty street funds nothing');
  assert(alone.take > 0, 'but the job still pays its signed §7.2 band');
  await pool.query('DELETE FROM characters WHERE id=$1', [res.id]);

  // (E) (audit F4) WHO gets taken from must not be decided by the SUCCESS die. The mark index used to
  // be drawn from `roll`, and the pay branch is `roll < chance` — so on a success the index could only
  // land in [0, chance × 8), and with `ORDER BY id LIMIT 8` that is a STABLE prefix: the same two or
  // three residents in a district funded every job forever while the rest were never touched once.
  //
  // Pinned with a crime whose chance is comfortably under 0.5 (torch, base 0.40, at low stats), so the
  // OLD code could reach index 3 at most: an upper-half debit is flat-out IMPOSSIBLE under the bug and
  // ~1 − 0.5^N under the fix. Both halves are asserted, so this also fails if the draw breaks entirely.
  await pool.query("DELETE FROM characters WHERE is_npc AND loc='cathedral'");
  const ring = [];
  for (let i = 0; i < 8; i++) {
    const m = await spawnResident(pool, { band: POPULATION.BANDS.find((b) => b.id === 'boss'), level: 20 });
    await pool.query("UPDATE characters SET loc='cathedral', cash=1000000 WHERE id=$1", [m.id]);
    ring.push(m.id);
  }
  // the server's own draw order — `ORDER BY id LIMIT 8` — is what the halves are defined against
  const inOrder = (await pool.query(
    "SELECT id FROM characters WHERE alive AND is_npc AND loc='cathedral' ORDER BY id LIMIT 8")).rows.map((r) => r.id);
  assert.equal(inOrder.length, 8, 'eight marks stand in the district');
  await seed("cash=0, jail_until=NULL, hosp_until=NULL, nerve=200, energy=200, muscle=5, cunning=5, speed=5, loc='cathedral', respect=3610");
  for (let i = 0; i < 90; i++) {
    await seed('nerve=200, jail_until=NULL, hosp_until=NULL');
    const rr = await call('POST', '/v1/crimes/torch', { token, body: { approach: 'standard' } });
    assert.equal(rr.code, 200, `the job resolves (${JSON.stringify(rr.body)})`);
  }
  const debited = await Promise.all(inOrder.map(async (id) => Number((await pool.query(
    "SELECT COUNT(*) n FROM transactions WHERE character_id=$1 AND reason='crime:take'", [id])).rows[0].n) > 0));
  assert(debited.slice(0, 4).some(Boolean), 'the near half of the district funds jobs');
  assert(debited.slice(4).some(Boolean),
    `the FAR half funds them too — the mark is drawn independently of the success die (${JSON.stringify(debited)})`);
  await pool.query("DELETE FROM characters WHERE is_npc AND loc='cathedral'");
}

// REVENGE, WITH TEETH — a strike settling a debt you are still NET OWED takes a bigger bite. The
// ROB rate goes 15% → 22.5% (still under the shakedown's signed 30%, on the same shared window),
// and the venue clock must advance by that SAME rate or the redirect stops being emission-neutral.
{
  await seed("cash=1000000, jail_until=NULL, hosp_until=NULL, energy=200, heat=0, muscle=5, cunning=5, speed=5, loc='cathedral', respect=625000");
  await seed2("cash=1000000, jail_until=NULL, hosp_until=NULL, energy=200, heat=0, muscle=3000, cunning=3000, speed=3000, loc='cathedral', respect=625000");
  // the mark needs a front of their own — earlier blocks may have taken theirs in a buyout
  if (!(await pool.query('SELECT id FROM businesses WHERE character_id=$1 LIMIT 1', [cid])).rows[0])
    await call('POST', '/v1/business/laundromat/buy', { token });
  const front = (await pool.query('SELECT id FROM businesses WHERE character_id=$1 LIMIT 1', [cid])).rows[0];
  assert(front, 'the mark runs a front to rob');
  const robCut = async () => {
    await pool.query('UPDATE businesses SET shakedown_at=NULL, last_collect_at=now() - interval \'20 hours\' WHERE id=$1', [front.id]);
    await seed2('energy=200, jail_until=NULL, hosp_until=NULL');
    const rr = await call('POST', `/v1/business/${front.id}/rob`, { token: t2 });
    assert.equal(rr.code, 200, `the robbery resolves (${JSON.stringify(rr.body)})`);
    assert(rr.body.win, 'a 3000-stat thief takes it');
    return rr.body;
  };
  // no debt yet — the plain 15%
  await pool.query('DELETE FROM rival_events');
  const plain = await robCut();
  assert(!plain.revenge, 'no debt owed, so no revenge hand');
  // now the OWNER has wronged them: the payback robbery takes the bigger bite
  const accOf = async (id) => (await pool.query('SELECT account_id FROM characters WHERE id=$1', [id])).rows[0].account_id;
  // three, not one: the `plain` robbery above RECORDED itself against the owner, and the debt has
  // to still be NET OWED after that (strikes-against-me > mine-against-them) for the hand to carry
  for (let i = 0; i < 3; i++)
    await pool.query('INSERT INTO rival_events (id, victim_account, aggressor_account, kind, detail) VALUES ($1,$2,$3,$4,$5)',
      [crypto.randomUUID(), await accOf(c2), await accOf(cid), 'jump', JSON.stringify({})]);
  const avenged = await robCut();
  assert(avenged.revenge, 'the ledger says they are owed');
  const ratio = avenged.cut / plain.cut;
  assert(Math.abs(ratio - RIVALS.REVENGE_CUT_MULT) < 0.02,
    `a revenge robbery takes REVENGE_CUT_MULT of the usual cut (got ${ratio.toFixed(3)}, want ${RIVALS.REVENGE_CUT_MULT})`);
  // the clock moved by the SAME boosted rate — the owner keeps exactly the untaken share
  const left = (await pool.query('SELECT last_collect_at FROM businesses WHERE id=$1', [front.id])).rows[0].last_collect_at;
  const keptMs = Date.now() - new Date(left).getTime();
  const wantKept = 20 * 3600 * 1000 * (1 - RIVALS.ROB_RATE_BPS / 10000 * RIVALS.REVENGE_CUT_MULT);
  assert(Math.abs(keptMs - wantKept) / wantKept < 0.05,
    `the venue clock advanced by the SAME boosted rate — emission-neutral (kept ${Math.round(keptMs / 3600000)}h, want ${Math.round(wantKept / 3600000)}h)`);
  await pool.query('DELETE FROM rival_events');
}

// ══ THE OPERATION SLOTS (the strategy package) — the income catalog becomes a CHOICE ══
// The measured problem was that 31 income holdings (18 rackets + the 13 Legit Fronts assets) had no
// competition for the seat, so buying was a checklist rather than a decision. A shared slot pool is
// the fix; what has to hold is that the SEATS bind, that only the income category is metered, that
// the door out really frees a seat, and that none of it moves value (§10.4 untouched at 0 bps).
{
  await seed("respect=625000, cash=999000000, jail_until=NULL, hosp_until=NULL, safe_until=NULL");
  const lvl = (await meOf(token)).level;
  const want = opSlotsOf(lvl);
  let m = await meOf(token);
  assert(m.ops, 'the sheet carries the seat count');
  assert.equal(m.ops.slots, want, `the view's seat count is opSlotsOf(level) — the SAME helper the till gates on (${m.ops.slots} vs ${want})`);
  assert.equal(m.ops.used, (m.rackets || []).length + m.ops.incomeAssets.length, 'used counts rackets + income assets, and nothing else');

  // FILL every seat. `laundro` is already running from the earlier block, so this tops it up.
  const owned = new Set(m.rackets || []);
  for (const r of RACKETS) {
    if ((await meOf(token)).ops.free <= 0) break;
    if (owned.has(r.id)) continue;
    const br = await call('POST', `/v1/rackets/${r.id}/buy`, { token });
    assert.equal(br.code, 200, `bought ${r.id} (${JSON.stringify(br.body)})`);
  }
  m = await meOf(token);
  assert.equal(m.ops.free, 0, `every seat is running (${m.ops.used} of ${m.ops.slots})`);

  // THE GATE — a 13th operation is refused for want of hands, not money. The character is holding
  // ~$999M, so "cash" would be the wrong error and the assertion below is what tells them apart.
  const spare = RACKETS.find((r) => !(m.rackets || []).includes(r.id));
  assert(spare, 'the catalog is bigger than the seat cap — which is the whole point');
  const denied = await call('POST', `/v1/rackets/${spare.id}/buy`, { token });
  assert.equal(denied.code, 400, 'a full house refuses the next operation');
  assert.equal(denied.body.error, 'slots', `refused for SEATS, not cash (got ${denied.body.error}: ${denied.body.message})`);
  assert(/retire/i.test(denied.body.message), 'and the message names the way out');

  // …and an INCOME asset is refused by the same seat, since they share the pool
  const incomeAsset = ASSETS.find((a) => a.cat === OPERATIONS.INCOME_ASSET_CAT && !(m.assets || []).includes(a.id));
  assert.equal((await call('POST', `/v1/assets/${incomeAsset.id}/buy`, { token })).body.error, 'slots',
    'a Legit Front takes the same seat a racket does');

  // …but WHEELS and PROPERTY are NOT metered — they're stat/cargo/energy-cap progression, and
  // metering them would be a pacing change wearing an economy change's clothes.
  const wheels = ASSETS.find((a) => a.cat !== OPERATIONS.INCOME_ASSET_CAT && !(m.assets || []).includes(a.id));
  const wr = await call('POST', `/v1/assets/${wheels.id}/buy`, { token });
  assert.equal(wr.code, 200, `${wheels.cat} buys fine with every operation seat full (${JSON.stringify(wr.body)})`);
  assert.equal((await meOf(token)).ops.used, m.ops.used, 'and it took no seat');

  // THE DOOR OUT — retiring frees the seat. At RACKET_RETIRE_BPS 0 it moves NO value, so it writes
  // NO ledger row: walking away is a pure ownership change (the BUSINESS_SHUTTER_BPS argument).
  // The clock is frozen first, and that is load-bearing rather than tidy: this character owns
  // rackets, so §7.1 accrual writes `racket:income` on the next touch, and a raw row COUNT across
  // the window measured ANY event rather than the retire. Backdating `last_accrued_at` two minutes
  // reproduces it exactly (two rows) — the recorded flake class, where a deterministic assertion
  // rests on a merely-likely precondition. Stamping the clock to now() makes dtMin ~0 so no income
  // can land, and the count below is scoped to the retire's OWN reason so it measures the claim.
  await pool.query(`UPDATE characters SET last_accrued_at = now() WHERE id='${cid}'`);
  const retireRows = async () => Number((await pool.query(
    `SELECT COUNT(*) n FROM transactions WHERE character_id='${cid}' AND reason LIKE 'racket:retire%'`)).rows[0].n);
  const rowsPre = Number((await pool.query(`SELECT COUNT(*) n FROM transactions WHERE character_id='${cid}'`)).rows[0].n);
  assert.equal(await retireRows(), 0, 'nobody has walked away yet');
  const cashPreRetire = (await meOf(token)).cash;
  const quit = await call('DELETE', `/v1/rackets/${m.rackets[0]}`, { token });
  assert.equal(quit.code, 200, `walked away from ${m.rackets[0]} (${JSON.stringify(quit.body)})`);
  assert.equal(quit.body.back, 0, 'at 0 bps you get nothing back — the door exists to unblock, not to refund');
  assert.equal(await retireRows(), 0, 'retiring at 0 bps writes ZERO ledger rows — no value moved');
  assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM transactions WHERE character_id='${cid}'`)).rows[0].n), rowsPre,
    'and nothing else moved either — the frozen clock means no accrual can be mistaken for the retire');
  assert.equal((await meOf(token)).cash, cashPreRetire, 'and the pocket is untouched');
  assert.equal((await meOf(token)).ops.free, 1, 'the seat is free');

  // …and the seat is really usable — the gate was a count, not a latch
  assert.equal((await call('POST', `/v1/rackets/${spare.id}/buy`, { token })).code, 200,
    'the freed seat takes the operation the full house refused');
  assert.equal((await meOf(token)).ops.free, 0, 'back to a full house');
  // a racket you don't run can't be retired
  assert.equal((await call('DELETE', `/v1/rackets/${m.rackets[0]}`, { token })).body.error, 'none', "can't walk away from a racket you don't run");
  assert.equal((await call('DELETE', '/v1/rackets/nope', { token })).body.error, 'bad_racket', 'unknown racket rejected');
}

// (G) §10.4 — the vocabulary stays closed with business:spec (omr) + takeover/buyout (cash) in the mix
const inv3 = await runLedgerInvariants(pool, { alert: false });
assert(inv3.checks.find((c) => c.name === 'reason vocabulary').ok, `no unknown-reason alarm (${JSON.stringify(inv3.checks.find((c) => c.name === 'reason vocabulary').unknown || [])})`);

console.log('✅ M2 economy test passed — market, garage (+car conservation), workshop, goods, rackets (+lazy income), assets, THE RETIRED AMM (both directions + the private wash rail refuse; the pool is left alone), staking (principal returns whole, yield retired to the families), gear, the 12h cash-sink tick (the whole take to the window) + the legacy-pool MERGE (idempotent), ledger invariants, Risk-to-Earn bank-interest daily cap, Business Empire (catalog, level gate, buy/collect/upgrade with income cap, §10.4 faucet/sink ledgering) + the step-two PvE risk layer LIVE AGAIN (scrutiny is income-sourced — banking the take heats the front, a hot front is raided at the collect touch with the pending seized + a ledgered business:raid fine, and the view carries the real raid line) with shakedown/takeover PvP intact + THE STREET WAR (rob-a-front on the SHARED shakedown window — 15% skim ledgered business:rob, the owner keeps ~85%, a miss is lockup; PvP car theft — a pure ownership move conserving cars by row count, consent flags cleared on transfer, the victim shield + the shared GTA clock + rookie protection; and THE RIVALS LEDGER naming the aggressor bloodline via its living street with no account UUID exposed) + RECURRING SINKS "the pad" (upkeep rate/owed in the view, paying is a ledgered business:upkeep sink resetting the clock, a front unpaid past the cold window produces nothing / no upgrades until the pad thaws it) + BALANCE sign-off (safehouse blocks deposits/collection, the >$10M bank-interest taper) + BUSINESS EMPIRE → Tier 4 (THE LAUNDERER legend now a FROZEN historical board, THE ACCOUNTANT (halves the income heat) + THE FIXER back on the shelf now the Bureau layer has a feed, THE FORTRESS unchanged, the TYCOON fold-in on collect, read-derived Front-Set titles, THE HOSTILE TAKEOVER — a taxed buyout transfer + fee burn + reset handover + level/have_kind gates, §10.4 vocabulary closed) + STREET WAR step two (TRUNK ROBBERY — a goods ownership move capped by the robber\'s free trunk space, units conserved, zero ledger rows, the victim\'s own 24h shield, a miss is lockup; BOAT THEFT at the docks — a row move on the SHARED vehicle shield + GTA clock with the rendezvous consent flag cleared; SABOTAGE — a random fit racer laid up, pure pacing; REVENGE TEETH — the net-owed mark\'s payback strike pays honor while the net aggressor earns nothing; and the coach naming fresh malice inside the 48h window)');
await app.close();

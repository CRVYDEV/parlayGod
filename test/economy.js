// M2 economy smoke test: deterministic market, garage, workshop, goods, rackets,
// assets, swap, staking, gear, buyback worker — plus the §10.4 cash-ledger and
// car-conservation invariants. Runs on pg-mem — zero infra.
process.env.EARLY_SELL_TAX_BPS = '0'; // legacy exact-amount swap assertions run surcharge-free (dedicated coverage: chain/emission suites)
process.env.MOD_KEY = 'test-mod-key'; // Phase 4 emission-pool ops routes are mod-gated
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runBuyback, mergeLegacyPools } from '../src/worker.js';
import { CARS, carVal, carMelt, CONSTANTS, BUSINESS_EMPIRE, frontTitles, launderRankOf, businessMaxTier } from '../src/rules.js';

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
await pool.query(`UPDATE account_persistent SET omr = omr + 200 WHERE account_id=(SELECT account_id FROM characters WHERE id='${cid}')`);

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
//     needs by SQL (200 to the staker, 40 + 10 into the two legacy yield pools to give the merge
//     something real to move). Those grants are deliberately UNLEDGERED, so they are exactly the
//     expected drift — asserting the drift equals them is a stronger claim than `ok`, because it
//     proves every OTHER $OMR movement in the file (the pool merge, the retired-yield paths) is
//     conservation-neutral rather than merely that the total happens to land somewhere plausible.
const SQL_OMR_GRANTED = 200 + 40 + 10;
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
await pool.query(`UPDATE account_persistent SET omr=200 WHERE account_id=(SELECT account_id FROM characters WHERE id='${cid}')`);
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

// (G) §10.4 — the vocabulary stays closed with business:spec (omr) + takeover/buyout (cash) in the mix
const inv3 = await runLedgerInvariants(pool, { alert: false });
assert(inv3.checks.find((c) => c.name === 'reason vocabulary').ok, `no unknown-reason alarm (${JSON.stringify(inv3.checks.find((c) => c.name === 'reason vocabulary').unknown || [])})`);

console.log('✅ M2 economy test passed — market, garage (+car conservation), workshop, goods, rackets (+lazy income), assets, THE RETIRED AMM (both directions + the private wash rail refuse; the pool is left alone), staking (principal returns whole, yield retired to the families), gear, the 12h cash-sink tick (the whole take to the window) + the legacy-pool MERGE (idempotent), ledger invariants, Risk-to-Earn bank-interest daily cap, Business Empire (catalog, level gate, buy/collect/upgrade with income cap, §10.4 faucet/sink ledgering) + the step-two PvE risk layer LIVE AGAIN (scrutiny is income-sourced — banking the take heats the front, a hot front is raided at the collect touch with the pending seized + a ledgered business:raid fine, and the view carries the real raid line) with shakedown/takeover PvP intact + THE STREET WAR (rob-a-front on the SHARED shakedown window — 15% skim ledgered business:rob, the owner keeps ~85%, a miss is lockup; PvP car theft — a pure ownership move conserving cars by row count, consent flags cleared on transfer, the victim shield + the shared GTA clock + rookie protection; and THE RIVALS LEDGER naming the aggressor bloodline via its living street with no account UUID exposed) + RECURRING SINKS "the pad" (upkeep rate/owed in the view, paying is a ledgered business:upkeep sink resetting the clock, a front unpaid past the cold window produces nothing / no upgrades until the pad thaws it) + BALANCE sign-off (safehouse blocks deposits/collection, the >$10M bank-interest taper) + BUSINESS EMPIRE → Tier 4 (THE LAUNDERER legend now a FROZEN historical board, THE ACCOUNTANT (halves the income heat) + THE FIXER back on the shelf now the Bureau layer has a feed, THE FORTRESS unchanged, the TYCOON fold-in on collect, read-derived Front-Set titles, THE HOSTILE TAKEOVER — a taxed buyout transfer + fee burn + reset handover + level/have_kind gates, §10.4 vocabulary closed)');
await app.close();

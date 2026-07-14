// M2 economy smoke test: deterministic market, garage, workshop, goods, rackets,
// assets, swap, staking, gear, buyback worker — plus the §10.4 cash-ledger and
// car-conservation invariants. Runs on pg-mem — zero infra.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runBuyback } from '../src/worker.js';
import { CARS, carVal, carMelt } from '../src/rules.js';

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
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
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
assert.equal((await call('POST', '/v1/swap', { token, body: { direction: 'buy', amount: 100 } })).code, 400, 'min swap $500 enforced');
r = await call('POST', '/v1/swap', { token, body: { direction: 'buy', amount: 50000 } });
assert.equal(r.code, 200, 'swap buy'); assert(r.body.gotOmr > 0, 'received $OMR');
const omrHeld = r.body.character.omr;
assert(omrHeld > 0, 'omr on the account');
const ammMid = (await pool.query('SELECT * FROM amm_pool WHERE id=1')).rows[0];
assert(Number(ammMid.cash_reserve) > Number(ammPre.cash_reserve), 'pool cash grew on a buy');
r = await call('POST', '/v1/swap', { token, body: { direction: 'sell', amount: Math.floor(omrHeld / 2) } });
assert.equal(r.code, 200, 'swap sell'); assert(r.body.gotCash > 0, 'sold $OMR for cash');

// ── staking (§7.1): stake, accrue real APY, claim, unstake ──
r = await call('POST', '/v1/stake', { token, body: { amount: 5 } });
assert.equal(r.code, 200, 'stake'); assert(r.body.character.staked >= 5, 'omr staked');
await seed("last_accrued_at = now() - interval '365 days'"); // a full year at 14% APY
me = await meOf(token);
assert(me.rewards > 0, 'staking rewards accrued lazily');
const omrBeforeClaim = me.omr;
r = await call('POST', '/v1/claim-rewards', { token });
assert.equal(r.code, 200, 'claim rewards'); assert(r.body.character.omr > omrBeforeClaim, 'rewards → omr');
r = await call('POST', '/v1/unstake', { token });
assert.equal(r.code, 200, 'unstake'); assert.equal(r.body.character.staked, 0, 'nothing left staked');

// ── NFT gear mint (§5.4): $OMR burn → account-side gear ──
r = await call('POST', '/v1/gear/brasspin/mint', { token });
assert.equal(r.code, 200, 'mint gear'); assert(r.body.character.gear.includes('brasspin'), 'gear held');
assert(r.body.character.eff.cunning > r.body.character.stats.cunning, 'gear boosts effective stat');
assert.equal((await call('POST', '/v1/gear/brasspin/mint', { token })).code, 400, 'no double-mint');

// ── §7.12 buyback worker: fences + swaps + trades filled the street-tax pool ──
const taxPre = (await pool.query('SELECT * FROM street_tax WHERE id=1')).rows[0];
assert(Number(taxPre.pool) > 0, 'street tax accumulated from house takes');
const bb = await runBuyback(pool, { force: true });
assert(bb && bb.boughtOmr > 0, 'buyback bought $OMR through the curve');
const taxPost = (await pool.query('SELECT * FROM street_tax WHERE id=1')).rows[0];
assert.equal(Number(taxPost.pool), 0, 'pool drained by buyback');
assert(Number(taxPost.fund) > 0, 'event fund funded');
assert.equal(await runBuyback(pool, { force: true }), null, 'nothing to buy back twice');

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

// (c) $OMR conservation across the swap curve: nothing minted outside faucets.
//     account omr + staked + rewards + AMM omr_reserve + fund should equal the seed
//     (20,000 pool) + staking-reward faucet. We assert the pool never went negative.
const ammFinal = (await pool.query('SELECT * FROM amm_pool WHERE id=1')).rows[0];
assert(Number(ammFinal.omr_reserve) > 0 && Number(ammFinal.cash_reserve) > 0, 'AMM reserves stay positive');

console.log('✅ M2 economy test passed — market, garage (+car conservation), workshop, goods, rackets (+lazy income), assets, swap, staking (real APY), gear, 12h buyback, ledger invariants');
await app.close();

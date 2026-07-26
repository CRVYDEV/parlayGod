// THE BLACK MARKET test — listing gates (fee, floor, max listings, escrow guards), the car
// AUCTION (bid floor, min-raise, outbid refund exact, self-raise, buy-now instant settle with
// the 2% take carved FROM the hammer, expiry settle via the worker sweep), goods FIXED-PRICE
// district-pinned pickup (wrong dock rejected, trunk clamp, partial buys), cancel/reclaim
// (space-gated goods), death (seller's listings void + bid refunded; bidder's standing bid
// burns), and the §10.4 `market escrow` check + vocabulary. pg-mem, zero infra.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { BLACK_MARKET as MARKET, goodPriceOf } from '../src/rules.js';
import { sweepMarket } from '../src/market.js';
import { runLedgerInvariants } from '../src/invariants.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url,
    headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  return { token, id: (await meOf(token)).id };
};
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);
const escrowOk = async () => (await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === 'market escrow');

const sal = await mk('Seller Sal');       // lists the iron
const bea = await mk('Bidder Bea');       // wins auctions
const rex = await mk('Rival Rex');        // gets outbid
const gus = await mk('Goods Gus');        // buys gin at the dock
await seedCh(sal.id, "cash=500000, loc='docks'");
await seedCh(bea.id, 'cash=500000');
await seedCh(rex.id, 'cash=500000');

// ── seed a car through the REAL faucet (GTA can fail — loop it) and stock a trunk ──
let carId = null, guard = 0;
while (!carId && guard++ < 60) {
  await seedCh(sal.id, 'gta_at=NULL, energy=200, jail_until=NULL, heat=0');
  await call('POST', '/v1/garage/boost', { token: sal.token });
  carId = ((await meOf(sal.token)).cars || [])[0]?.id || null;
}
assert(carId, 'sal boosted a car to sell');
assert.equal((await call('POST', '/v1/goods/buy', { token: sal.token, body: { goodId: 'gin', qty: 10 } })).code, 200, 'trunk stocked');

// ── listing gates ──
assert.equal((await call('POST', '/v1/market', { token: sal.token, body: { carId: 'nope', minBid: 1000 } })).body.error, 'no_car', 'not your iron');
assert.equal((await call('POST', '/v1/market', { token: sal.token, body: { carId, minBid: 10 } })).body.error, 'min_price', `the $${MARKET.MIN_PRICE} floor holds`);
assert.equal((await call('POST', '/v1/market', { token: sal.token, body: { carId, minBid: 5000, buyNow: 100 } })).body.error, 'bad_buy_now', 'buy-now under the minimum is refused');
const salCash0 = (await meOf(sal.token)).cash;
let r = await call('POST', '/v1/market', { token: sal.token, body: { carId, minBid: 5000, buyNow: 20000 } });
assert.equal(r.code, 200, 'the car lists'); const L1 = r.body.id;
const carFee = Math.max(MARKET.LIST_FEE_MIN, Math.ceil(20000 * MARKET.LIST_FEE_BPS / 10000));
assert.equal(r.body.fee, carFee, '1% of the ask to list');
assert.equal((await meOf(sal.token)).cash, salCash0 - carFee, 'the fee left the pocket (market:list, a ledgered sink)');
assert.equal((await meOf(sal.token)).cars[0].listed, true, 'the garage shows it on the block');
// escrow guards: the listed car is untouchable
assert.equal((await call('POST', `/v1/garage/${carId}/melt`, { token: sal.token })).body.error, 'listed', 'no melting escrowed iron');
assert.equal((await call('POST', `/v1/garage/${carId}/fence`, { token: sal.token })).body.error, 'listed', 'no fencing it either');
assert.equal((await call('POST', '/v1/market', { token: sal.token, body: { carId, minBid: 5000 } })).body.error, 'listed', 'no double-listing');

// ── goods list: district-pinned, escrowed out of the trunk ──
r = await call('POST', '/v1/market', { token: sal.token, body: { goodId: 'gin', qty: 10, price: 500 } });
assert.equal(r.code, 200, 'gin listed at the docks'); const L2 = r.body.id;
assert.equal(r.body.district, 'docks', 'pinned to the listing dock');
assert(!(await meOf(sal.token)).cargo.gin, 'the gin escrowed OUT of the trunk');

// ── the board is public and shows the goods dock + the car, never the bidder ──
r = await call('GET', '/v1/market');
assert.equal(r.code, 200, 'the board is public');
const bL1 = r.body.listings.find((x) => x.id === L1), bL2 = r.body.listings.find((x) => x.id === L2);
assert(bL1.car && bL1.minBid === 5000 && bL1.buyNow === 20000, 'the iron shows with its numbers');
assert(bL2.good === 'gin' && bL2.district === 'docks' && bL2.unitPrice === 500, 'the gin shows its dock and price');

// ── the auction: floor, min-raise, outbid refund, self-raise ──
assert.equal((await call('POST', `/v1/market/${L1}/bid`, { token: sal.token, body: { amount: 5000 } })).body.error, 'own', 'no bidding up your own iron');
assert.equal((await call('POST', `/v1/market/${L1}/bid`, { token: rex.token, body: { amount: 4999 } })).body.error, 'low', 'under the minimum');
const rexCash0 = (await meOf(rex.token)).cash;
assert.equal((await call('POST', `/v1/market/${L1}/bid`, { token: rex.token, body: { amount: 5000 } })).code, 200, 'rex opens at the minimum');
assert.equal((await meOf(rex.token)).cash, rexCash0 - 5000, "rex's bid escrowed");
const raiseFloor = Math.ceil(5000 * (1 + MARKET.MIN_RAISE_BPS / 10000));
assert.equal((await call('POST', `/v1/market/${L1}/bid`, { token: bea.token, body: { amount: 5100 } })).body.error, 'low', `a raise must clear $${raiseFloor}`);
assert.equal((await call('POST', `/v1/market/${L1}/bid`, { token: bea.token, body: { amount: 6000 } })).code, 200, 'bea takes it at 6000');
assert.equal((await meOf(rex.token)).cash, rexCash0, 'rex refunded to the cent on the outbid');
const beaCash1 = (await meOf(bea.token)).cash;
assert.equal((await call('POST', `/v1/market/${L1}/bid`, { token: bea.token, body: { amount: 7000 } })).code, 200, 'bea raises herself');
assert.equal((await meOf(bea.token)).cash, beaCash1 - 1000, 'a self-raise escrows only the difference');
assert((await escrowOk()).ok, '§10.4 market escrow reconciles with a standing bid out');

// ── cancel is blocked over a standing bid ──
assert.equal((await call('POST', `/v1/market/${L1}/cancel`, { token: sal.token })).body.error, 'bid_standing', 'the hammer decides now');

// ── buy-now: instant settle — bea (standing bidder) refunded, rex takes the car, sal nets 98% ──
const salCash1 = (await meOf(sal.token)).cash;
const beaCash2 = (await meOf(bea.token)).cash;
r = await call('POST', `/v1/market/${L1}/buy`, { token: rex.token });
assert.equal(r.code, 200, 'rex slams buy-now'); assert.equal(r.body.paid, 20000);
const take = Math.ceil(20000 * MARKET.TAKE_BPS / 10000);
assert.equal((await meOf(sal.token)).cash, salCash1 + 20000 - take, `sal nets the hammer minus the ${MARKET.TAKE_BPS / 100}% take`);
assert.equal((await meOf(bea.token)).cash, beaCash2 + 7000, "bea's standing bid came back when the iron sold from over her");
assert.equal(((await meOf(rex.token)).cars || []).some((c) => c.id === carId), true, "the iron is in rex's garage");
assert.equal((await meOf(rex.token)).cars.find((c) => c.id === carId).listed, false, 'and off the block');
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='market:take'")).rows[0].s), -take, 'the take is one ledgered NULL row (half street tax, half burn)');
assert((await escrowOk()).ok, '§10.4 market escrow reconciles after the settle');

// ── goods: wrong dock refused, partial buy, trunk clamp ──
await seedCh(gus.id, "cash=500000, loc='neon'");
assert.equal((await call('POST', `/v1/market/${L2}/buy`, { token: gus.token, body: { qty: 4 } })).body.error, 'district', 'pickup is at the docks — be there');
await seedCh(gus.id, "loc='docks'");
const salCash2 = (await meOf(sal.token)).cash;
r = await call('POST', `/v1/market/${L2}/buy`, { token: gus.token, body: { qty: 4 } });
assert.equal(r.code, 200, 'four units change hands'); assert.equal(r.body.paid, 2000); assert.equal(r.body.remaining, 6);
assert.equal((await meOf(gus.token)).cargo.gin, 4, 'in the trunk');
const gTake = Math.ceil(2000 * MARKET.TAKE_BPS / 10000);
assert.equal((await meOf(sal.token)).cash, salCash2 + 2000 - gTake, 'sal nets the goods sale minus the take');

// ── cancel/reclaim: goods come back only into free trunk space ──
r = await call('POST', `/v1/market/${L2}/cancel`, { token: sal.token });
assert.equal(r.code, 200, 'sal reclaims the unsold six');
assert.equal((await meOf(sal.token)).cargo.gin, 6, 'back in the trunk');

// ── expiry settle: the worker hammers an expired auction to the standing bidder ──
let car2 = null; guard = 0;
while (!car2 && guard++ < 60) {
  await seedCh(sal.id, 'gta_at=NULL, energy=200, jail_until=NULL, heat=0');
  await call('POST', '/v1/garage/boost', { token: sal.token });
  car2 = ((await meOf(sal.token)).cars || []).find((c) => !c.listed && c.id !== carId)?.id || null;
}
assert(car2, 'sal boosted another car');
r = await call('POST', '/v1/market', { token: sal.token, body: { carId: car2, minBid: 1000 } });
const L3 = r.body.id;
assert.equal((await call('POST', `/v1/market/${L3}/buy`, { token: bea.token })).body.error, 'no_buy_now', 'no buy-now on this one — bid');
assert.equal((await call('POST', `/v1/market/${L3}/bid`, { token: bea.token, body: { amount: 1500 } })).code, 200, 'bea holds the hammer price');
await pool.query(`UPDATE market_listings SET expires_at = now() - interval '1 minute' WHERE id='${L3}'`);
assert.equal((await call('POST', `/v1/market/${L3}/bid`, { token: rex.token, body: { amount: 5000 } })).body.error, 'no_listing', 'no bids after the clock');
const salCash3 = (await meOf(sal.token)).cash;
r = await sweepMarket(pool);
assert.equal(r.settled, 1, 'the sweep hammers it');
assert.equal((await meOf(sal.token)).cash, salCash3 + 1500 - Math.ceil(1500 * MARKET.TAKE_BPS / 10000), 'sal paid at the hammer');
assert(((await meOf(bea.token)).cars || []).some((c) => c.id === car2), 'bea drives it home');

// ── expiry lapse: an unsold listing flips to expired and is reclaimed via cancel ──
assert.equal((await call('POST', '/v1/goods/buy', { token: sal.token, body: { goodId: 'gin', qty: 4 } })).code, 200);
r = await call('POST', '/v1/market', { token: sal.token, body: { goodId: 'gin', qty: 4, price: 999 } });
const L4 = r.body.id;
await pool.query(`UPDATE market_listings SET expires_at = now() - interval '1 minute' WHERE id='${L4}'`);
assert.equal((await sweepMarket(pool)).lapsed, 1, 'the sweep lapses it');
assert.equal((await call('POST', `/v1/market/${L4}/cancel`, { token: sal.token })).code, 200, 'sal reclaims the expired gin');

// ── death: the seller's listings VOID (bid refunded), the dead man's own bids BURN ──
const doom = await mk('Doomed Dan');
await seedCh(doom.id, 'cash=100000');
let car3 = null; guard = 0;
while (!car3 && guard++ < 60) {
  await seedCh(doom.id, 'gta_at=NULL, energy=200, jail_until=NULL, heat=0');
  await call('POST', '/v1/garage/boost', { token: doom.token });
  car3 = ((await meOf(doom.token)).cars || [])[0]?.id || null;
}
assert(car3, 'dan boosted a car');
r = await call('POST', '/v1/market', { token: doom.token, body: { carId: car3, minBid: 2000 } });
const L5 = r.body.id;
assert.equal((await call('POST', `/v1/market/${L5}/bid`, { token: rex.token, body: { amount: 2500 } })).code, 200, 'rex bids on the doomed man\'s iron');
// dan also bids on a fresh listing of sal's — that bid must BURN with him
let car4 = null; guard = 0;
while (!car4 && guard++ < 60) {
  await seedCh(sal.id, 'gta_at=NULL, energy=200, jail_until=NULL, heat=0');
  await call('POST', '/v1/garage/boost', { token: sal.token });
  car4 = ((await meOf(sal.token)).cars || []).find((c) => !c.listed)?.id || null;
}
r = await call('POST', '/v1/market', { token: sal.token, body: { carId: car4, minBid: 3000 } });
const L6 = r.body.id;
assert.equal((await call('POST', `/v1/market/${L6}/bid`, { token: doom.token, body: { amount: 3000 } })).code, 200, 'dan holds a bid as he walks into the wrong alley');
const rexCash1 = (await meOf(rex.token)).cash;
const kill = await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: doom.id },
  headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal(kill.statusCode, 200, 'the Commission retires dan');
assert.equal((await meOf(rex.token)).cash, rexCash1 + 2500, "rex's bid on the dead man's listing came back");
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM market_listings WHERE id='${L5}'`)).rows[0].n), 0, "the dead man's listing is gone");
const l6 = (await pool.query(`SELECT bid, bidder, status FROM market_listings WHERE id='${L6}'`)).rows[0];
assert(l6.status === 'live' && l6.bid === null && l6.bidder === null, "the dead man's own bid cleared — the auction reopened");
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='market:death'")).rows[0].s), -3000, 'and burned as a ledgered NULL row (the dead-funder precedent)');
const esc = await escrowOk();
assert(esc.ok, `§10.4 market escrow reconciles through death (${JSON.stringify(esc)})`);

// ══════════════ STEP TWO: reserve prices, anti-snipe, standing buy orders ══════════════

// ── RESERVE: a bid under the hidden reserve never hammers — the bidder is refunded ──
let car5 = null; guard = 0;
while (!car5 && guard++ < 60) {
  await seedCh(sal.id, 'gta_at=NULL, energy=200, jail_until=NULL, heat=0');
  await call('POST', '/v1/garage/boost', { token: sal.token });
  car5 = ((await meOf(sal.token)).cars || []).find((c) => !c.listed && c.id !== car4)?.id || null;
}
assert(car5, 'sal boosted a fifth car');
assert.equal((await call('POST', '/v1/market', { token: sal.token, body: { carId: car5, minBid: 1000, reserve: 500 } })).body.error, 'bad_reserve', 'a reserve under the minimum bid is refused');
r = await call('POST', '/v1/market', { token: sal.token, body: { carId: car5, minBid: 1000, reserve: 8000 } });
assert.equal(r.code, 200, 'listed with a hidden reserve'); const L7 = r.body.id;
assert.equal((await call('POST', `/v1/market/${L7}/bid`, { token: rex.token, body: { amount: 2000 } })).code, 200, 'rex bids under the reserve');
r = await call('GET', '/v1/market');
const bL7 = r.body.listings.find((x) => x.id === L7);
assert.equal(bL7.reserveMet, false, 'the board says the hammer would not fall');
assert.equal(bL7.reserve, undefined, 'but the reserve AMOUNT stays hidden');
await pool.query(`UPDATE market_listings SET expires_at = now() - interval '1 minute' WHERE id='${L7}'`);
const rexCash2 = (await meOf(rex.token)).cash;
r = await sweepMarket(pool);
assert(r.lapsed >= 1, 'the sweep lapses the reserve-not-met auction');
assert.equal((await meOf(rex.token)).cash, rexCash2 + 2000, 'rex refunded — the reserve protected the seller, not the house');
assert.equal((await call('POST', `/v1/market/${L7}/cancel`, { token: sal.token })).code, 200, 'sal reclaims the unsold iron');
assert((await escrowOk()).ok, '§10.4 escrow reconciles through the reserve lapse');

// ── ANTI-SNIPE: a bid inside the last window resets the clock (soft close) ──
r = await call('POST', '/v1/market', { token: sal.token, body: { carId: car5, minBid: 1000 } });
const L8 = r.body.id;
await pool.query(`UPDATE market_listings SET expires_at = now() + interval '2 minutes' WHERE id='${L8}'`);
r = await call('POST', `/v1/market/${L8}/bid`, { token: rex.token, body: { amount: 1200 } });
assert.equal(r.body.extended, true, 'a buzzer-beater bid soft-closes');
const exp8 = new Date((await pool.query(`SELECT expires_at FROM market_listings WHERE id='${L8}'`)).rows[0].expires_at).getTime();
assert(exp8 - Date.now() > 4 * 60 * 1000, 'the clock reset to a full snipe window');
// clean up: hammer it so the escrow drains
await pool.query(`UPDATE market_listings SET expires_at = now() - interval '1 minute' WHERE id='${L8}'`);
assert.equal((await sweepMarket(pool)).settled, 1, 'and the hammer falls at the reset clock');

// ── BUY ORDERS: post escrows cash; fills pay the seller on the spot; the buyer claims ──
await seedCh(gus.id, "cash=500000, loc='canal'");
r = await call('POST', '/v1/market/order', { token: gus.token, body: { goodId: 'gin', qty: 10, price: 600 } });
assert.equal(r.code, 200, 'gus posts WTB 10 gin @ $600 at the canal'); const O1 = r.body.id;
assert.equal(r.body.escrow, 6000, 'the order escrows qty × price');
const orderFee = Math.max(MARKET.LIST_FEE_MIN, Math.ceil(6000 * MARKET.LIST_FEE_BPS / 10000));
assert.equal(r.body.fee, orderFee, 'plus the 1% listing fee');
r = await call('GET', '/v1/market');
const bO1 = r.body.listings.find((x) => x.id === O1);
assert(bO1 && bO1.kind === 'order' && bO1.wanted === 10 && bO1.unitPrice === 600 && bO1.district === 'canal', 'the WTB shows on the public board');
// fills: wrong district refused; the right one pays the seller minus the take
await seedCh(rex.id, "loc='docks'");
assert.equal((await call('POST', '/v1/goods/buy', { token: rex.token, body: { goodId: 'gin', qty: 6 } })).code, 200, 'rex stocks gin');
assert.equal((await call('POST', `/v1/market/${O1}/fill`, { token: rex.token, body: { qty: 6 } })).body.error, 'district', 'delivery is at the canal — be there');
await seedCh(rex.id, "loc='canal'");
assert.equal((await call('POST', `/v1/market/${O1}/fill`, { token: gus.token, body: { qty: 1 } })).body.error, 'own', 'no filling your own order');
const rexCash3 = (await meOf(rex.token)).cash;
r = await call('POST', `/v1/market/${O1}/fill`, { token: rex.token, body: { qty: 6 } });
assert.equal(r.code, 200, 'rex delivers six'); assert.equal(r.body.remaining, 4, 'four still wanted');
const fillTake = Math.ceil(6 * 600 * MARKET.TAKE_BPS / 10000);
assert.equal(r.body.earned, 6 * 600 - fillTake, 'paid from the escrow minus the 2% take');
assert.equal((await meOf(rex.token)).cash, rexCash3 + 6 * 600 - fillTake, 'and it landed in-memory (no clobber)');
assert(!(await meOf(rex.token)).cargo.gin, 'the gin left his trunk for the warehouse');
assert((await escrowOk()).ok, '§10.4 escrow reconciles mid-order (bids + order balances)');
// claim: wrong district refused; the right one pulls into trunk space
await seedCh(gus.id, "loc='docks'");
assert.equal((await call('POST', `/v1/market/${O1}/claim`, { token: gus.token })).body.error, 'district', 'the warehouse is at the canal');
await seedCh(gus.id, "loc='canal'");
const gusGinPre = (await meOf(gus.token)).cargo.gin || 0;
r = await call('POST', `/v1/market/${O1}/claim`, { token: gus.token });
assert.equal(r.code, 200, 'gus claims'); assert.equal(r.body.claimed, 6, 'all six delivered units');
assert.equal((await meOf(gus.token)).cargo.gin, gusGinPre + 6, 'in the trunk');
// cancel refunds only the UN-FILLED escrow (4 × 600)
const gusCash1 = (await meOf(gus.token)).cash;
r = await call('POST', `/v1/market/${O1}/cancel`, { token: gus.token });
assert.equal(r.code, 200, 'gus pulls the rest of the order'); assert.equal(r.body.refunded, 2400, 'the un-filled escrow comes back');
assert.equal((await meOf(gus.token)).cash, gusCash1 + 2400, 'to the cent');
assert((await escrowOk()).ok, '§10.4 escrow reconciles after the order closes');

// ── order EXPIRY refunds the poster; a dead poster's escrow burns ──
r = await call('POST', '/v1/market/order', { token: gus.token, body: { goodId: 'shine', qty: 5, price: 400 } });
const O2 = r.body.id;
await pool.query(`UPDATE market_listings SET expires_at = now() - interval '1 minute' WHERE id='${O2}'`);
const gusCash2 = (await meOf(gus.token)).cash;
assert((await sweepMarket(pool)).lapsed >= 1, 'the sweep lapses the order');
assert.equal((await meOf(gus.token)).cash, gusCash2 + 2000, 'the whole un-filled escrow refunds on expiry');
const doom2 = await mk('Doomed Duke');
await seedCh(doom2.id, "cash=100000, loc='canal'");
r = await call('POST', '/v1/market/order', { token: doom2.token, body: { goodId: 'gin', qty: 4, price: 500 } });
const O3 = r.body.id;
const deadPre = Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='market:death'")).rows[0].s);
const kill2 = await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: doom2.id },
  headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal(kill2.statusCode, 200, 'the Commission retires duke');
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='market:death'")).rows[0].s), deadPre - 2000, "the dead poster's order escrow burned (dead-funder precedent)");
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM market_listings WHERE id='${O3}'`)).rows[0].n), 0, 'and the order died with him');
const esc2 = await escrowOk();
assert(esc2.ok, `§10.4 market escrow reconciles through order death (${JSON.stringify(esc2)})`);

// ── AUDIT C1 regression: you cannot BUY a buy-ORDER (it would mint un-escrowed goods) ──
await seedCh(gus.id, "cash=500000, loc='canal'");
r = await call('POST', '/v1/market/order', { token: gus.token, body: { goodId: 'gin', qty: 20, price: 500 } });
const O4 = r.body.id;
const alt = await mk('Alt Andy'); await seedCh(alt.id, "cash=500000, loc='canal'");
const altGinPre = (await meOf(alt.token)).cargo.gin || 0;
const escPreC1 = await escrowOk();
r = await call('POST', `/v1/market/${O4}/buy`, { token: alt.token, body: { qty: 20 } });
assert.equal(r.body.error, 'not_for_sale', 'a buy-order is filled at the dock, never bought — no minting goods from escrow');
assert.equal((await meOf(alt.token)).cargo.gin || 0, altGinPre, 'no conjured units landed in the trunk');
assert(escPreC1.ok && (await escrowOk()).ok, '§10.4 market escrow untouched by the rejected buy');
await call('POST', `/v1/market/${O4}/cancel`, { token: gus.token });

// ── AUDIT M2 regression: a self-raise by the current high bidder does NOT extend the auction ──
let sniperCar = null, sg = 0;
while (!sniperCar && sg++ < 60) {
  await seedCh(sal.id, "gta_at=NULL, energy=200, jail_until=NULL");
  const b = (await call('POST', '/v1/garage/boost', { token: sal.token })).body;
  if (b.success) sniperCar = b.car.id;
}
assert(sniperCar, 'sal boosted a car for the snipe test');
r = await call('POST', '/v1/market', { token: sal.token, body: { carId: sniperCar, minBid: 1000, hours: 48 } });
const snipeId = r.body.id;
r = await call('POST', `/v1/market/${snipeId}/bid`, { token: bea.token, body: { amount: 1000 } });
assert.equal(r.code, 200, 'bea takes the lead');
await pool.query(`UPDATE market_listings SET expires_at = now() + interval '2 minutes' WHERE id='${snipeId}'`); // inside the 5-min window
r = await call('POST', `/v1/market/${snipeId}/bid`, { token: bea.token, body: { amount: 2000 } });
assert.equal(r.code, 200, 'bea raises herself'); assert.equal(r.body.extended, false, 'a self-raise never resets the anti-snipe clock');
r = await call('POST', `/v1/market/${snipeId}/bid`, { token: rex.token, body: { amount: 3000 } });
assert.equal(r.code, 200, 'rex genuinely outbids inside the window'); assert.equal(r.body.extended, true, 'a real outbid DOES soft-close');
await call('POST', `/v1/market/${snipeId}/cancel`, { token: sal.token }).catch(() => {}); // (bid stands → cancel refused; harmless)

// ── AUDIT LOW-1 regression: the Broker discount never dips a fee below the LIST_FEE_MIN floor ──
const brk = await mk('Broker Bob'); await seedCh(brk.id, "cash=500000, loc='docks'");
for (const s of ['fast_talker', 'fence_network', 'broker']) await pool.query(`INSERT INTO character_skills (character_id, skill_id) VALUES ('${brk.id}','${s}')`);
assert.equal((await call('POST', '/v1/goods/buy', { token: brk.token, body: { goodId: 'gin', qty: 2 } })).code, 200, 'bob stocks a little gin');
r = await call('POST', '/v1/market', { token: brk.token, body: { goodId: 'gin', qty: 2, price: 100 } }); // $200 ask
assert.equal(r.code, 200, 'a tiny goods listing');
assert.equal(r.body.fee, MARKET.LIST_FEE_MIN, 'the broker halves the %, but the anti-spam floor still holds');

// ── the vocabulary stays closed ──
const vocab = (await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `market:* is enumerated (${JSON.stringify(vocab.unknown || [])})`);

console.log('✅ Black Market test passed — listing gates (fee/floor/escrow guards: melt+fence refuse listed iron), car auction (bid floor, 5% min-raise, outbid refund exact, self-raise diff-only, buy-now instant settle, 2% take carved FROM the hammer as one NULL row), goods district-pinned partial buys + trunk-space reclaim, worker expiry settle + lapse, death (seller listings void with bids refunded, dead man\'s bids burn) + STEP TWO: hidden reserves (board flags met/not, under-reserve lapse refunds the bidder), anti-snipe soft close, standing BUY ORDERS (escrow at post, dock-pinned fills paid minus the take, warehouse claim, un-filled cancel/expiry refunds, dead-poster burn) + AUDIT: buying a buy-order rejected (no minting from escrow, C1), a self-raise never extends the clock (M2), the broker fee never dips below the floor (LOW-1), §10.4 market escrow + vocabulary');
await app.close();

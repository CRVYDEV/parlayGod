// THE AUCTION HOUSE ("the sit-down") test — the competitive, recurring $OMR sink with $OMR ESCROW.
// Covers: weekly lot determinism, the board, first bid (min = archetype floor) + escrow debit, the
// min-raise, an OUTBID (previous bidder refunded EXACTLY, escrow moves), a SELF-RAISE (net = new−old),
// settle (worker burns the winning bid + grants the account-level trophy), the loser kept their
// refund, death survival of a won trophy, and the §10.4 auction-escrow check + $OMR conservation +
// closed vocabulary. pg-mem, zero infra. SQL-granting $OMR is an unledgered mint (the portfolio
// precedent), so the $OMR-conservation DRIFT stays exactly the grant.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { AUCTION, auctionLotsOf, weekOf } from '../src/rules.js';
import { sweepAuctions } from '../src/auction.js';
import { deadlockToRetry } from '../src/game.js';
import { runLedgerInvariants } from '../src/invariants.js';

// ── F1 regression: a concurrent FIRST bid on a fresh lot locks nothing under FOR UPDATE, so both
// txns INSERT and the loser 23505s. That can't be produced single-threaded on pg-mem, so unit-test
// the wrapper mapping directly: a bare 23505 must become a clean retryable `contention`, not a 500.
assert.equal(deadlockToRetry({ code: '23505' }).code, 'contention', '23505 (materialize race) → clean retry');
assert.equal(deadlockToRetry({ code: '40P01' }).code, 'contention', '40P01 (deadlock) still → clean retry');
const unrelated = { code: '22P02' };
assert.equal(deadlockToRetry(unrelated), unrelated, 'an unrelated error passes through untouched');

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
const acctOmr = (id, n) => pool.query(
  `UPDATE account_persistent SET omr = omr + ${n} WHERE account_id = (SELECT account_id FROM characters WHERE id='${id}')`);
const omrOf = async (t) => (await meOf(t)).omr;
let grantDrift = 0;

const a = await mk('Auction Al');
const b = await mk('Bidder Bob');
await acctOmr(a.id, 5000); grantDrift += 5000;
await acctOmr(b.id, 5000); grantDrift += 5000;

// ── lot determinism + the board ──
const week = weekOf();
const lots = auctionLotsOf(week);
// Tier-4: the week now draws LOTS_PER_WEEK regular lots + 1 always-legendary MARQUEE lot
assert.equal(lots.length, AUCTION.LOTS_PER_WEEK + 1, 'the week draws LOTS_PER_WEEK regular lots + the marquee');
assert.equal(auctionLotsOf(week)[0].id, lots[0].id, 'the draw is deterministic per week');
const marquee = lots.find((l) => l.rarity === 'legendary');
assert(marquee && marquee.id === `${week}:m`, 'the marquee lot is a legendary drawn from RARE_ARCHETYPES');
assert(AUCTION.RARE_ARCHETYPES.some((x) => x.id === marquee.archetype), 'and it comes from the rare set');
let board = (await call('GET', '/v1/auction', { token: a.token })).body;
assert.equal(board.lots.length, AUCTION.LOTS_PER_WEEK + 1, 'the block shows this week\'s lots + the marquee');
const lot = board.lots[0];
assert.equal(lot.currentBid, 0, 'no bids yet');
assert.equal(lot.minBid, lots[0].min, 'the opening bid is the archetype floor');

// ── first bid: below the floor rejected; a valid bid escrows exactly ──
assert.equal((await call('POST', `/v1/auction/${lot.id}/bid`, { token: a.token, body: { amount: lot.minBid - 1 } })).body.error, 'low', 'you can\'t open below the floor');
let r = await call('POST', `/v1/auction/${lot.id}/bid`, { token: a.token, body: { amount: lot.minBid } });
assert.equal(r.code, 200, 'Al opens the bidding');
assert.equal(r.body.youLead, true, 'and leads');
assert.equal(await omrOf(a.token), 5000 - lot.minBid, 'the bid is escrowed out of Al\'s $OMR');

// ── the min-raise: a raise must clear +5% ──
const tooLow = lot.minBid + 1;
assert.equal((await call('POST', `/v1/auction/${lot.id}/bid`, { token: b.token, body: { amount: tooLow } })).body.error, 'low', 'a raise under +5% is refused');

// ── OUTBID: Bob takes the lead; Al is refunded his bid EXACTLY ──
const raise = Math.ceil(lot.minBid * (1 + AUCTION.MIN_RAISE_BPS / 10000));
r = await call('POST', `/v1/auction/${lot.id}/bid`, { token: b.token, body: { amount: raise } });
assert.equal(r.code, 200, 'Bob outbids');
assert.equal(await omrOf(a.token), 5000, 'Al got his whole bid back — outbid is refunded exactly');
assert.equal(await omrOf(b.token), 5000 - raise, 'Bob\'s raise is escrowed');
board = (await call('GET', '/v1/auction', { token: b.token })).body;
assert.equal(board.lots.find((l) => l.id === lot.id).youLead, true, 'Bob leads the board now');

// ── SELF-RAISE: Bob raises his own bid; net cost = new − old ──
const self = Math.ceil(raise * (1 + AUCTION.MIN_RAISE_BPS / 10000));
r = await call('POST', `/v1/auction/${lot.id}/bid`, { token: b.token, body: { amount: self } });
assert.equal(r.code, 200, 'Bob raises himself');
assert.equal(await omrOf(b.token), 5000 - self, 'a self-raise nets to just the new bid (old refunded in-memory)');

// ── §10.4 mid-auction: escrow == the live standing bid; bids/refunds are transfers ──
let inv = await runLedgerInvariants(pool, { alert: false });
let esc = inv.checks.find((c) => c.name === 'auction escrow');
assert(esc.ok, `auction escrow reconciles: ${JSON.stringify(esc)}`);
assert.equal(esc.lhs, self, 'the escrow bucket == the one live standing bid');
assert.equal(inv.checks.find((c) => c.name === '$OMR conservation').drift, grantDrift, 'conservation drift is only the test grant (bids/refunds are transfers)');

// ── SETTLE: the worker burns the winning bid + grants the account-level trophy ──
// warp the lot into a past week so the sweep settles it
await pool.query(`UPDATE auctions SET week = ${week - 1} WHERE lot_id='${lot.id}'`);
const swept = await sweepAuctions(pool);
assert.equal(swept.settled, 1, 'the sweep settles the closed lot');
assert.equal(swept.burned, self, 'and burns exactly the winning bid');
assert.equal(await omrOf(b.token), 5000 - self, 'the winner already paid (escrow → burn; no extra debit)');
board = (await call('GET', '/v1/auction', { token: b.token })).body;
assert(board.wins.some((w) => w.lot === lot.id && w.price === self), 'Bob holds the trophy on his board');
// the loser Al kept his refund and holds nothing
assert.equal(await omrOf(a.token), 5000, 'the loser kept his $OMR');
assert.equal((await call('GET', '/v1/auction', { token: a.token })).body.wins.length, 0, 'and won nothing');

// ── DEATH SURVIVAL: the trophy is account-level, so the heir keeps it ──
const kill = await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: b.id },
  headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal(kill.statusCode, 200, 'Bob is retired');
const heir = await meOf(b.token);
assert.notEqual(heir.id, b.id, 'a new street');
assert(( await call('GET', '/v1/auction', { token: b.token })).body.wins.some((w) => w.lot === lot.id), 'the heir inherits the auction trophy');

// ── §10.4 after settle: escrow empty, the win is a burn, vocabulary closed ──
inv = await runLedgerInvariants(pool, { alert: false });
esc = inv.checks.find((c) => c.name === 'auction escrow');
assert(esc.ok && esc.lhs === 0, 'the escrow is empty after settle');
// the winning bid left the game, but the BURN is properly ledgered: omrBuckets dropped by `self`
// (the escrow emptied) AND the burn term rose by `self` — so conservation stays exact (drift
// unchanged = only the test's unledgered SQL grants), which is the whole point of §10.4.
assert(inv.checks.find((c) => c.name === '$OMR conservation').ok === false && inv.checks.find((c) => c.name === '$OMR conservation').drift === grantDrift, 'the win is a properly-ledgered burn — conservation-neutral (drift still only the test grant)');
assert(inv.checks.find((c) => c.name === 'reason vocabulary').ok, 'auction: rides the omr vocabulary');

// ══════════ TIER-4 — THE BLOCK (RESALE): PLAYER CONSIGNMENT ══════════
const { sweepConsignments } = await import('../src/auction.js');
const { collectorLeaderboard } = await import('../src/estate.js');
const { collectionSetsOf } = await import('../src/rules.js');
const CONS = AUCTION.CONSIGN;
const cc = await mk('Collector Carl');
await acctOmr(cc.id, 20000); grantDrift += 20000;
const sellerTok = b.token; // Bob's heir holds the account-level trophy (lot.id)

// ── COLLECTION SETS (read-derived, pure) — all six base archetypes complete the Full House ──
const fh = collectionSetsOf(['plate', 'watch', 'pistol', 'ring', 'painting', 'car'].map((x) => ({ archetype: x })));
assert(fh.find((s) => s.id === 'full_house').complete, 'the Full House completes with all six base archetypes');
assert(!collectionSetsOf([{ archetype: 'plate' }]).find((s) => s.id === 'full_house').complete, 'a partial set is incomplete');

// ── consign gates: reserve bounds, ownership ──
assert.equal((await call('POST', '/v1/auction/consign', { token: sellerTok, body: { lotId: lot.id, reserve: CONS.MIN_RESERVE - 1 } })).body.error, 'reserve', 'reserve under the floor is refused');
assert.equal((await call('POST', '/v1/auction/consign', { token: a.token, body: { lotId: lot.id, reserve: 50 } })).body.error, 'not_owned', 'you can only consign what you own');

// ── list it — the fee BURNS, the trophy flags listed, no double-list ──
const sBefore = await omrOf(sellerTok);
let cr = await call('POST', '/v1/auction/consign', { token: sellerTok, body: { lotId: lot.id, reserve: 50 } });
assert.equal(cr.code, 200, 'the trophy goes on the block');
assert.equal(await omrOf(sellerTok), sBefore - CONS.FEE_OMR, 'the listing fee burned from the seller');
const cid = cr.body.id;
assert.equal((await call('POST', '/v1/auction/consign', { token: sellerTok, body: { lotId: lot.id, reserve: 50 } })).body.error, 'listed', 'no double-listing a trophy');
board = (await call('GET', '/v1/auction', { token: sellerTok })).body;
assert(board.consignments.some((x) => x.id === cid && x.mine), 'the seller sees their own consignment (mine)');
assert(board.wins.find((w) => w.lot === lot.id).listed, 'the trophy reads on the block');

// ── the seller can't bid their own lot; Carl bids; an OUTBID refunds exactly ──
assert.equal((await call('POST', `/v1/auction/consign/${cid}/bid`, { token: sellerTok, body: { amount: 60 } })).body.error, 'own', 'no bidding your own consignment');
const carlBefore = await omrOf(cc.token);
assert.equal((await call('POST', `/v1/auction/consign/${cid}/bid`, { token: cc.token, body: { amount: 100 } })).code, 200, 'Carl bids');
assert.equal(await omrOf(cc.token), carlBefore - 100, 'Carl\'s bid is escrowed');
const alBefore = await omrOf(a.token);
const raise2 = Math.ceil(100 * (1 + CONS.MIN_RAISE_BPS / 10000));
assert.equal((await call('POST', `/v1/auction/consign/${cid}/bid`, { token: a.token, body: { amount: raise2 } })).code, 200, 'Al outbids');
assert.equal(await omrOf(cc.token), carlBefore, 'Carl got his bid back — outbid refunded exactly');
const top = Math.ceil(raise2 * (1 + CONS.MIN_RAISE_BPS / 10000));
assert.equal((await call('POST', `/v1/auction/consign/${cid}/bid`, { token: cc.token, body: { amount: top } })).code, 200, 'Carl re-takes the lead over reserve');
assert.equal(await omrOf(a.token), alBefore, 'Al got his bid back too');
assert.equal((await call('POST', `/v1/auction/consign/${cid}/cancel`, { token: sellerTok })).body.error, 'has_bid', 'no pulling a lot with a standing bid');

// ── §10.4 mid-listing: the escrow bucket now spans BOTH auctions + consignments ──
inv = await runLedgerInvariants(pool, { alert: false });
esc = inv.checks.find((c) => c.name === 'auction escrow');
assert(esc.ok, `escrow reconciles mid-consignment: ${JSON.stringify(esc)}`);
assert.equal(esc.lhs, top, 'the escrow bucket == the one live consignment bid');

// ── SETTLE: reserve MET → Carl takes the trophy, the seller is paid NET, the take BURNS ──
await pool.query('UPDATE auction_consignments SET closes_at=$1 WHERE id=$2', [new Date(Date.now() - 3600000), cid]);
const sellBefore = await omrOf(sellerTok);
const swc = await sweepConsignments(pool);
assert.equal(swc.sold, 1, 'the consignment sold');
const net = Math.floor(top * (1 - CONS.TAKE_BPS / 10000)), take = top - net;
assert.equal(swc.burned, take, 'the house take was burned');
assert.equal(await omrOf(sellerTok), sellBefore + net, 'the seller was paid net of the take');
assert((await call('GET', '/v1/auction', { token: cc.token })).body.wins.some((w) => w.lot === lot.id), 'Carl now holds the trophy');
assert(!(await call('GET', '/v1/auction', { token: sellerTok })).body.wins.some((w) => w.lot === lot.id), 'the seller no longer holds it');

// ── THE COLLECTOR legend + leaderboard + Patron ──
const clb = await collectorLeaderboard(pool);
assert(clb.collectors.length >= 1 && clb.collectors.every((x) => x.sunk > 0 && x.rank), 'the collectors board ranks the prestige-spenders with a rank');
assert(clb.collectors.some((x) => x.steward === 'Collector Carl'), 'Carl (bought the trophy) is on the board');
assert(clb.patron && clb.patron.sunk > 0, 'a Patron of the Season is crowned by this-season spend');

// ── §10.4 after the consignment settle: escrow empty, conservation still only the grants ──
inv = await runLedgerInvariants(pool, { alert: false });
esc = inv.checks.find((c) => c.name === 'auction escrow');
assert(esc.ok && esc.lhs === 0, 'the consignment escrow is empty after settle');
assert.equal(inv.checks.find((c) => c.name === '$OMR conservation').drift, grantDrift, 'conservation drift is still only the test grants (consign = transfer, take + fee = proper burns)');
assert(inv.checks.find((c) => c.name === 'reason vocabulary').ok, 'auction:consign/take/consign:fee ride the omr vocabulary');

// ── pull a NO-BID consignment (listed cleared) — Carl re-lists then cancels ──
cr = await call('POST', '/v1/auction/consign', { token: cc.token, body: { lotId: lot.id, reserve: 80 } });
assert.equal(cr.code, 200, 'Carl re-lists his trophy');
assert.equal((await call('POST', `/v1/auction/consign/${cr.body.id}/cancel`, { token: cc.token })).code, 200, 'and pulls it clean (no standing bid)');
assert(!(await call('GET', '/v1/auction', { token: cc.token })).body.wins.find((w) => w.lot === lot.id).listed, 'the trophy is off the block again');

console.log('✅ Auction House ("the sit-down") test passed — weekly lot determinism, the block, first bid (floor + escrow), the +5% min-raise, OUTBID (loser refunded exactly), SELF-RAISE (net = new−old), the auction-escrow §10.4 check mid-auction (bids/refunds are transfers), SETTLE (worker burns the winning bid + grants the account trophy, no extra debit), the loser kept his $OMR, DEATH SURVIVAL (heir inherits the trophy), and §10.4 (escrow empties, the win is a burn, vocabulary closed) + TIER-4: the LEGENDARY marquee lot (LOTS_PER_WEEK+1, from the rare set), COLLECTION SETS (read-derived), and PLAYER CONSIGNMENT (list a trophy — fee burns; bid/outbid-refund/own-bid gates; the escrow spans both auctions+consignments; settle reassigns the trophy to the buyer, pays the seller NET, BURNS the house take, bumps the buyer\'s Collector legend; the collectors leaderboard + Patron; pull a no-bid lot; §10.4 exact — consign is a transfer, take + fee proper burns)');
await app.close();

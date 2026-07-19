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
assert.equal(lots.length, AUCTION.LOTS_PER_WEEK, 'the week draws LOTS_PER_WEEK lots');
assert.equal(auctionLotsOf(week)[0].id, lots[0].id, 'the draw is deterministic per week');
let board = (await call('GET', '/v1/auction', { token: a.token })).body;
assert.equal(board.lots.length, AUCTION.LOTS_PER_WEEK, 'the block shows this week\'s lots');
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
let inv = await runLedgerInvariants(pool);
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
inv = await runLedgerInvariants(pool);
esc = inv.checks.find((c) => c.name === 'auction escrow');
assert(esc.ok && esc.lhs === 0, 'the escrow is empty after settle');
// the winning bid left the game, but the BURN is properly ledgered: omrBuckets dropped by `self`
// (the escrow emptied) AND the burn term rose by `self` — so conservation stays exact (drift
// unchanged = only the test's unledgered SQL grants), which is the whole point of §10.4.
assert(inv.checks.find((c) => c.name === '$OMR conservation').ok === false && inv.checks.find((c) => c.name === '$OMR conservation').drift === grantDrift, 'the win is a properly-ledgered burn — conservation-neutral (drift still only the test grant)');
assert(inv.checks.find((c) => c.name === 'reason vocabulary').ok, 'auction: rides the omr vocabulary');

console.log('✅ Auction House ("the sit-down") test passed — weekly lot determinism, the block, first bid (floor + escrow), the +5% min-raise, OUTBID (loser refunded exactly), SELF-RAISE (net = new−old), the auction-escrow §10.4 check mid-auction (bids/refunds are transfers), SETTLE (worker burns the winning bid + grants the account trophy, no extra debit), the loser kept his $OMR, DEATH SURVIVAL (heir inherits the trophy), and §10.4 (escrow empties, the win is a burn, vocabulary closed)');
await app.close();

// THE DESK (economy v3 step 2: recycle instead of burn) — the 62nd suite.
// A $OMR sink no longer destroys the token; it hands it to the desk, which sells it back at the
// daily auction (step 3). Design §3.3/§4.2: every sink is the house's cut, so revenue ≈ sink volume
// × price and the KPI is RETURN VELOCITY rather than supply.
//
// This is the riskiest §10.4 edit in the migration, so the assertions are aimed at the two ways it
// could go wrong rather than at the happy path:
//
//   (1) SUPPLY IS INVENTED — the desk is credited without the ledger row that justifies it, or a
//       sink that should not recycle (the on-chain withdrawal) is recycled, so the same unit exists
//       both in a player's wallet and on the shelf.
//   (2) HISTORY BREAKS — a live database holds rows written when these reasons really were burns.
//       Reclassifying them wholesale would drift conservation by the entire historical burn volume.
//
// pg-mem, zero infra.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { buildServer } from '../src/server.js';
import { BAND, DESK, DESK_RECYCLE_REASON, recyclesToDesk, auctionPriceAt, freshWindowMs } from '../src/rules.js';
import { ledger } from '../src/game.js';
import { earlySurcharge } from '../src/tax.js';
import * as Desk from '../src/desk.js';
import { runLedgerInvariants } from '../src/invariants.js';

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const round8 = (n) => Math.round(n * 1e8) / 1e8;

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url,
    headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  return token;
};
const shelf = async () => Number((await pool.query('SELECT balance FROM desk_inventory WHERE id=1')).rows[0].balance);
const books = async () => (await pool.query('SELECT balance, lifetime_in, lifetime_sold FROM desk_inventory WHERE id=1')).rows[0];
const checkOf = async (name) => {
  const r = await runLedgerInvariants(pool, { alert: false });
  const c = r.checks.find((x) => x.name === name);
  assert(c, `the ${name} check exists`);
  return c;
};
const omrOf = async (acct) => Number((await pool.query('SELECT omr FROM account_persistent WHERE account_id=$1', [acct])).rows[0].omr);

const t = await mk('Sal Recycle');
const acct = (await pool.query('SELECT account_id FROM characters LIMIT 1')).rows[0].account_id;
// Seeded through a LEDGERED mint (`prize:omr`, an enumerated one) rather than a bare SQL write, so
// conservation can be asserted ABSOLUTELY here instead of as a before/after delta — which matters,
// because the whole question of this suite is whether a recycled sink moves the identity at all.
const grant = async (n) => {
  await pool.query('UPDATE account_persistent SET omr = omr + $2 WHERE account_id=$1', [acct, n]);
  await pool.query(
    'INSERT INTO transactions (id, account_id, currency, amount, reason) VALUES ($1,$2,$3,$4,$5)',
    [crypto.randomUUID(), acct, 'omr', n, 'prize:omr']);
};

// ── (1) THE CLASSIFICATION — one list, and the exclusion that matters ──────────────────────────
// The predicate the ledger hook reads and the predicate §10.4 sums must be the SAME list, or a sink
// silently destroys supply the desk was meant to sell. They are the same array by construction; this
// asserts the property that array exists to guarantee.
assert(recyclesToDesk('vanity:name'), 'a vanity spend feeds the desk');
assert(recyclesToDesk('estate:tier'), 'so does an estate tier (prefix match)');
assert(recyclesToDesk('window:burn'), 'and the redemption window');
assert(!recyclesToDesk('withdraw:omr'),
  'withdraw:omr must NOT recycle — that token leaves for the chain, so recycling it would mint an unbacked twin');
assert(!recyclesToDesk('auction:bid'), 'an escrow leg is not a sink');
assert(!recyclesToDesk('gang:tribute'), 'nor is a transfer between buckets');
assert(!recyclesToDesk('tax:dev'), 'nor the exit toll (already a transfer to its own bucket)');
assert(!recyclesToDesk('prize:omr') && !recyclesToDesk(null), 'a mint and a null reason feed nothing');
// and the exclusion list is a SUBSET of the sinks — an entry that is not a sink excludes nothing and
// would read as protection that is not there
for (const x of DESK.NOT_RECYCLED)
  assert(DESK.SINK_REASONS.includes(x), `${x} is on the exclusion list but is not a sink reason at all`);
console.log('✓ one list decides both what §10.4 counts as a sink and what feeds the desk');

// ── (2) A REAL SPEND LANDS ON THE SHELF ────────────────────────────────────────────────────────
await grant(100);
const before = await shelf();
const beforeOmr = await omrOf(acct);
const named = await call('POST', '/v1/vanity/name', { token: t, body: { name: 'Salvatore Recycle' } });
assert.equal(named.code, 200, `the rename should land: ${JSON.stringify(named.body)}`);
const spent = beforeOmr - (await omrOf(acct));
assert(spent > 0, 'the rename really cost $OMR');
assert.equal(await shelf(), before + spent, 'every $OMR the sink took is on the desk, to the unit');
const rows = (await pool.query(
  `SELECT amount FROM transactions WHERE currency='omr' AND reason=$1 ORDER BY at DESC LIMIT 1`, [DESK_RECYCLE_REASON])).rows;
// existence FIRST, with its own message: crediting the bucket without the row is a silent mint, and
// it deserves to fail by name rather than as an undefined-property TypeError three lines later.
assert.equal(rows.length, 1, 'the desk was credited with NO ledger row — a bucket write nothing justifies');
assert.equal(Number(rows[0].amount), spent, 'and the credit is ledgered for what the sink actually took');
const bk = await books();
assert.equal(Number(bk.lifetime_in), spent, 'the desk books what it took in');
assert.equal(Number(bk.lifetime_sold), 0, 'and has sold nothing (the auction is step 3)');
console.log(`✓ a real sink (${spent} $OMR) moved to the desk instead of the fire, ledgered both sides`);

// ── (3) §10.4 — the recycle is a TRANSFER, and conservation never moves ────────────────────────
// The pair (−X spend, +X desk) cancels inside the burn term while the bucket holds the value, so a
// recycled sink is conservation-NEUTRAL. If the desk bucket were missing from omrBuckets, or the
// desk:recycle row missing from the burn term, this is the assertion that fails.
let cons = await checkOf('$OMR conservation');
assert(cons.ok, `conservation broke after a recycled sink (drift ${cons.drift})`);
assert((await checkOf('desk inventory backed')).ok, 'the shelf matches its own books');
assert((await checkOf('desk inventory ledgered')).ok, 'and its books match the ledger');
console.log('✓ §10.4 holds: a recycled sink is a transfer, not a burn and not a mint');

// ── (4) HISTORY — a burn row written BEFORE the recycle still reconciles ───────────────────────
// The step-1 lesson, applied to the harder case. A live database holds sink rows with no partner
// because they were real burns when they were written. They must keep counting as burns: the reason
// stays in the term, and only the PAIR cancels. Simulated by writing a lone sink row (the shape an
// old row has) and destroying the $OMR to match.
await grant(50);
await pool.query('UPDATE account_persistent SET omr = omr - 50 WHERE account_id=$1', [acct]);
await pool.query(
  'INSERT INTO transactions (id, account_id, currency, amount, reason, at) VALUES ($1,$2,$3,$4,$5,$6)',
  [crypto.randomUUID(), acct, 'omr', -50, 'vanity:title', new Date(Date.now() - 30 * 86400000)]);
cons = await checkOf('$OMR conservation');
assert(cons.ok, `a historical (unpaired) burn row broke conservation — drift ${cons.drift}; `
  + 'the sink reasons must stay in the burn term so old rows still count as the burns they were');
console.log('✓ a pre-recycle burn row still reconciles — the change is safe on a live database');

// ── (5) THE ON-CHAIN WITHDRAWAL IS NOT THE HOUSE'S CUT ─────────────────────────────────────────
// The one exclusion, asserted at the LEDGER rather than only at the predicate: a withdrawal debits
// $OMR that reappears on-chain in the player's own wallet, backed by the reserve. Recycle it and the
// same unit is both held by the player and on our shelf to sell — an unbacked mint, and precisely
// what wall 3 ("extraction ≤ deposits") exists to forbid.
await grant(40);
const preWithdraw = await shelf();
const client = await pool.connect();
await client.query('BEGIN');
await ledger(client, { accountId: acct, currency: 'omr', amount: -40, reason: 'withdraw:omr' });
await client.query('UPDATE account_persistent SET omr = omr - 40 WHERE account_id=$1', [acct]);
await client.query('COMMIT');
client.release();
assert.equal(await shelf(), preWithdraw, 'a withdrawal must leave the shelf untouched');
cons = await checkOf('$OMR conservation');
assert(cons.ok, `an on-chain withdrawal broke conservation (drift ${cons.drift}) — it is still a real burn`);
console.log('✓ withdrawing to the chain still BURNS in-game supply — the desk takes no cut of it');

// ── (6) THE BOARD says what feeds the shelf, and admits what is not built ──────────────────────
let board = (await call('GET', '/v1/desk')).body;
assert.equal(board.inventory, await shelf(), 'the board publishes the real shelf');
assert(board.sinks.includes('vanity:%'), 'and names which spends feed it');
assert(!board.sinks.includes('withdraw:omr') && board.notRecycled.includes('withdraw:omr'),
  'the exclusion is published too — a claim nobody can check is not worth making');
assert.equal(board.auction, null, 'and it does not imply an auction that has not been built');
console.log('✓ GET /v1/desk publishes the shelf, what feeds it, and what does not');

// ── (7) THE VOCABULARY stays closed ────────────────────────────────────────────────────────────
const vocab = (await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `desk:recycle must be an enumerated reason: ${JSON.stringify(vocab.detail)}`);
console.log('✓ the reason vocabulary is closed with desk:recycle in it');

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// STEP 3 — THE DAILY DUTCH AUCTION. The outbound half: the desk sells the shelf back.
//
// The sale is a TRANSFER (shelf down, buyer up, both inside omrBuckets), so the interesting failures
// are not conservation drifts — they are the ones conservation is structurally blind to:
//   • a buyer credited without the shelf being decremented (a mint that sums to zero anyway),
//   • the desk selling more than it holds (wall 2),
//   • a comp booking ETH revenue that never arrived,
//   • the fail-closed oracle quietly falling back to a default price.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const priced = async (omrPerEth, ageMs = 0) => pool.query(
  'INSERT INTO vig_buyback (id, eth_spent, omr_bought, price_omr_per_eth, to_reserve, to_prize, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
  [crypto.randomUUID(), 0, 0, omrPerEth, 0, 0, new Date(Date.now() - ageMs)]);

// ── (8) FAIL-CLOSED: no price, no auction — and NEVER a default one ────────────────────────────
// The vault's `ethPrice` lesson, on the other side of the trade. A stale oracle resolving to a
// fallback price would put the desk's ENTIRE shelf on the wrong side of a free option, so the only
// safe behaviour is to refuse — and the board has to say WHY, off the same read, or an operator
// cannot tell "closed on purpose" from "broken".
let opened = await Desk.openAuction(pool);
assert.equal(opened.opened, false, 'an auction must not open with no oracle print at all');
assert.equal(opened.reason, 'no_price', `expected no_price, got ${opened.reason}`);
await priced(1000, 10 * 86400000);           // a print, but ten days old
opened = await Desk.openAuction(pool);
assert.equal(opened.reason, 'stale_price', `a stale print must refuse too, got ${opened.reason}`);
board = (await call('GET', '/v1/desk')).body;
assert.equal(board.auction, null, 'and no auction is advertised');
assert.equal(board.closed, 'stale_price', 'the board says WHY it is closed, not just that it is');
assert.equal(board.band.anchorEthPerOmr, null,
  'a stale band must publish no anchor — a stale number rendered as live is worse than none');
console.log('✓ fail-closed: no print and a stale print both refuse, and the board names the reason');

// ── (9) THE LOT — yesterday's returns, and three bounds that are three different claims ────────
// Stock the shelf through the SAME hook a player's spend takes (a big sink), so the lot is a real
// one. Deliberately more than the dump cap allows, so the cap is exercised rather than merely present
// — a bound that never binds is a bound nobody has tested.
await grant(3000);
const c1 = await pool.connect();
await c1.query('BEGIN');
await ledger(c1, { accountId: acct, currency: 'omr', amount: -3000, reason: 'estate:tier' });
await c1.query('UPDATE account_persistent SET omr = omr - 3000 WHERE account_id=$1', [acct]);
await c1.query('COMMIT');
c1.release();

await priced(1000);                           // fresh: 1000 $OMR per ETH → anchor 0.001 ETH each
const lot = await Desk.lotSize(pool);
assert.equal(lot.returned, Number((await books()).lifetime_in),
  'the lot starts from what the sinks returned in the last day');
assert(lot.qty <= lot.shelf, 'and can never exceed what is actually on the shelf (wall 2)');
assert.equal(lot.qty, lot.floatCap,
  'here the 1%-of-float dump cap is what binds — a huge sink day must not become a dump');
assert(lot.returned > lot.qty, 'so most of what came home is deliberately held back for later days');
// the bootstrap floor is not decoration: with a float near zero the cap would be zero, so no auction
// would ever open, so nobody could buy, so the float would stay near zero.
assert.equal(lot.floatCap, 1000, 'and on a cold start the cap is its bootstrap floor, not zero');
console.log(`✓ the lot is min(returned ${lot.returned}, floatCap ${lot.floatCap}, shelf ${lot.shelf}) = ${lot.qty}`);

// ── (10) THE OPEN — and the reserve IS the band ────────────────────────────────────────────────
// This is the design's elegant part made checkable: there is no separate "should the desk sell
// today?" decision, because a Dutch auction that will not clear under its reserve IS that decision.
opened = await Desk.openAuction(pool);
assert(opened.opened, `the auction should open with a fresh price and a stocked shelf: ${opened.reason}`);
assert.equal(opened.anchor, 0.001, `anchor should be 1/1000 ETH per $OMR, got ${opened.anchor}`);
assert.equal(opened.reserve, Math.round(0.001 * BAND.UPPER_BPS / 10000 * 1e8) / 1e8,
  'the reserve IS the band s upper edge — not a separate number that can drift from it');
assert.equal(opened.open, 0.0015, `and it opens at 1.5x the anchor, got ${opened.open}`);
assert.equal((await Desk.openAuction(pool)).reason, 'already', 'the day is the key — one lot a day');
// the clock descends, and is clamped at both ends so a late read cannot quote under the band
const live = await Desk.liveAuction(pool);
const t0 = new Date(live.opens_at).getTime(), dur = new Date(live.closes_at).getTime() - t0;
assert.equal(auctionPriceAt(live, t0), 0.0015, 'at the bell it is the open price');
assert.equal(auctionPriceAt(live, t0 + dur / 2), 0.00125, 'halfway it is halfway down');
assert.equal(auctionPriceAt(live, t0 + dur), opened.reserve, 'at the close it is the reserve');
assert.equal(auctionPriceAt(live, t0 + dur * 10), opened.reserve, 'and never below it, however late');
console.log(`✓ the clock runs ${opened.open} → ${opened.reserve} ETH, and the reserve is the band`);

// ── (11) THE FILL — a transfer, one row, and conservation that never moves ─────────────────────
const buyerT = await mk('Vito Bidder');
const buyer = (await pool.query('SELECT account_id FROM characters WHERE name=$1', ['Vito Bidder'])).rows[0].account_id;
const shelfBefore = await shelf(), buyerBefore = await omrOf(buyer);
const consBefore = (await checkOf('$OMR conservation')).drift;
const fill = await Desk.recordAuctionBuy(pool, { ref: 'fill-1', accountId: buyer, omr: 5, txHash: '0xabc' });
assert(fill.filled, `the fill should land: ${JSON.stringify(fill)}`);
assert.equal(fill.omr, 5, 'for what was asked');
assert.equal(await omrOf(buyer), buyerBefore + 5, 'the buyer holds it');
assert.equal(await shelf(), shelfBefore - 5, 'and the shelf is down by EXACTLY that — the two are one subtraction');
const saleRows = (await pool.query(
  `SELECT amount, account_id FROM transactions WHERE currency='omr' AND reason='desk:sale'`)).rows;
assert.equal(saleRows.length, 1, 'exactly one desk:sale row — the buyer was credited with no ledger row otherwise');
assert.equal(Number(saleRows[0].amount), 5, 'ledgered for what was sold');
assert.equal(saleRows[0].account_id, buyer, 'and against the buyer, which is what makes it vest');
// the identity is UNTOUCHED, because nothing was created or destroyed — only moved between two
// buckets that are both already inside it. That is why a sale needs no mint or burn term.
assert.equal((await checkOf('$OMR conservation')).drift, consBefore,
  'a sale moved the conservation identity — it must not: both sides are inside omrBuckets');
assert((await checkOf('desk sales ledgered')).ok, 'and lifetime_sold matches the ledger');
assert.equal(Number((await books()).lifetime_sold), 5, 'the desk books what it sold');
console.log(`✓ 5 $OMR sold for ${fill.eth} ETH: a transfer off the shelf, one ledgered row, identity unmoved`);

// ── (12) THE ETH — the 50/50 split, and a comp that books none of it ───────────────────────────
assert.equal(round8(fill.polEth + fill.founderEth), fill.eth, 'the two shares sum to the gross, exactly');
assert.equal(fill.polEth, round8(fill.eth / 2), 'POL takes half (design §3.1)');
const comp = await Desk.recordAuctionBuy(pool, { ref: 'comp-1', accountId: buyer, omr: 2 });  // no txHash
assert(comp.filled && comp.omr === 2, 'a comp still moves the $OMR — that side is a transfer, so it safely can');
assert.equal(comp.eth, 0, 'but books ZERO ETH: a mod call must never be able to assert the desk was paid');
const dinv = await Desk.runDeskInvariants(pool);
assert(dinv.ok, `the desk's real-value invariants must hold: ${JSON.stringify(dinv.checks.filter((c) => !c.ok))}`);
assert(dinv.checks.find((c) => c.name === 'comps book no revenue'), 'and one of them is that gate, stated as a check');
console.log('✓ ETH splits 50/50 POL/founder, and a comp books none of it');

// ── (13) WALL 2 — the desk never sells inventory it does not hold ──────────────────────────────
// Asserted at the LEDGER, not the predicate: ask for far more than the lot and the fill CLAMPS
// rather than either overselling or 500ing on a race for the last of a lot.
const bigAsk = await Desk.recordAuctionBuy(pool, { ref: 'fill-big', accountId: buyer, omr: 1e9 });
assert(bigAsk.partial, 'an oversized ask fills partially rather than failing');
assert(await shelf() > 0, 'and the shelf still holds what the lot never covered');
const a2 = await Desk.liveAuction(pool);
assert.equal(Number(a2.sold_omr), Number(a2.qty_omr), 'the lot is exhausted, and not one unit over');
// The distinction this asserts is the whole point of a daily lot: the desk HAS more $OMR, and still
// will not sell it today. Selling the shelf on demand would make the 1%/day cap decorative.
await assert.rejects(() => Desk.recordAuctionBuy(pool, { ref: 'fill-after', accountId: buyer, omr: 1 }),
  (e) => e.code === 'sold_out',
  'with the lot gone the desk refuses, even though the shelf is not empty — it will not sell tomorrow s');
assert((await checkOf('$OMR conservation')).drift === consBefore, 'still no drift after the clamp');
console.log('✓ wall 2 holds at the ledger: the lot clamps and then refuses, with stock still on the shelf');

// ── (14) IDEMPOTENCY — a re-delivered fill is a no-op ──────────────────────────────────────────
const dupShelf = await shelf(), dupOmr = await omrOf(buyer);
const dup = await Desk.recordAuctionBuy(pool, { ref: 'fill-1', accountId: buyer, omr: 5, txHash: '0xabc' });
assert(dup.duplicate && !dup.filled, 'the same ref must be a clean no-op');
assert.equal(await shelf(), dupShelf, 'and move nothing');
assert.equal(await omrOf(buyer), dupOmr, 'on either side');
console.log('✓ a re-delivered fill is idempotent on its ref');

// ── (15) THE VEST IS ALREADY BUILT — asserted, not implemented ─────────────────────────────────
// Design §11.7 wants a 48h vest on auction purchases. We build no timer: a `desk:sale` credit is a
// positive $OMR row, and tax.js replays exactly those as FIFO lots — so bought $OMR is ALREADY
// priced at the full early-exit surcharge decaying to zero over FRESH_WINDOW_MS, which is 48h. One
// concept, one constant. This asserts it rather than assuming it, because "we get it for free" is
// the kind of claim that stops being true silently.
const held = await omrOf(buyer);
const c2 = await pool.connect();
const fresh = await earlySurcharge(c2, buyer, held, 1, Date.now());
c2.release();
assert(fresh.surcharge > 0,
  'freshly-bought $OMR must price as FRESH on exit — if this is 0 the vest silently does not exist');
assert.equal(freshWindowMs(), 48 * 3600000, 'and the window it decays over is the design s 48h');
console.log(`✓ the vest needs no timer: $OMR bought at the desk exits at ${(fresh.surcharge * 100).toFixed(0)}% surcharge, fading over 48h`);

// ── (16) THE BOARD, live ───────────────────────────────────────────────────────────────────────
board = (await call('GET', '/v1/desk')).body;
assert(board.auction, 'a live auction is published');
assert.equal(board.auction.left, round6(Number(a2.qty_omr) - Number(a2.sold_omr)), 'with what is left of the lot');
assert(board.auction.priceEthPerOmr <= board.auction.openPrice
  && board.auction.priceEthPerOmr >= board.auction.reservePrice, 'and a price inside its own clock');
assert.equal(board.band.sellAbove, board.auction.reservePrice,
  'the band the board publishes and the reserve it is selling at are the same number');
assert.equal(board.closed, null, 'nothing is closed while it is running');
console.log('✓ GET /v1/desk publishes the live clock, the lot, and the band it is selling against');

// ── (17) UNSOLD ROLLS — there is nothing to unwind ─────────────────────────────────────────────
// The lot is a RIGHT to sell, not an escrow: it never left the shelf, so an expired auction needs no
// refund path and whatever did not clear is simply on the shelf for tomorrow.
await pool.query("UPDATE desk_auctions SET closes_at = now() - interval '1 minute' WHERE status='live'");
const rolledShelf = await shelf();
assert(rolledShelf > 0, 'there is genuinely something unsold to roll');
assert.equal((await Desk.closeExpired(pool)).closed, 1, 'the expired auction closes');
assert.equal(await shelf(), rolledShelf, 'and unsold inventory simply stays on the shelf');
assert.equal(await Desk.liveAuction(pool), null, 'with nothing live');
assert((await checkOf('$OMR conservation')).drift === consBefore, 'conservation untouched by the close');
console.log(`✓ ${rolledShelf} unsold $OMR rolls to tomorrow — the lot was a right to sell, never an escrow`);

// ── (18) THE SHELF CLAMP — defence in depth, and today unreachable ────────────────────────────
// Wall 2 has TWO bounds in `recordAuctionBuy`, and only one of them binds in ordinary play: the lot
// is set at `min(returned, floatCap, shelf)` and the shelf then falls by exactly what that lot sells,
// so the remaining lot can never exceed the shelf. The third clamp is what keeps a FUTURE drain — an
// ops correction, step 4's buy side touching the same singleton, a bug — from turning into a mint.
//
// This was found by mutation: removing the shelf clamp left the suite GREEN, because the fixture only
// ever exercised the LOT bound. "Wall 2 holds" was therefore half-tested and read as fully tested,
// which is the failure mode this project keeps paying for. So the drain is done SYNTHETICALLY here —
// as a bucket-to-bucket move (shelf → stake_pool, both inside omrBuckets, so conservation stays exact
// and the drain is the shape a real one would take), because nothing in the game can currently do it.
// (the finished auction is aged into yesterday rather than the clock being pushed into tomorrow:
//  the lot is "what came home in the last 24h", so advancing `now` past the returns would leave
//  nothing to sell and this section would open on an empty lot and test nothing.)
await pool.query('UPDATE desk_auctions SET day = day - 1');
const opened2 = await Desk.openAuction(pool);
assert(opened2.opened, `a fresh day opens a fresh lot: ${opened2.reason}`);
const drainTo = 300;
const drain = (await shelf()) - drainTo;
assert(drain > 0 && drainTo < opened2.qty, 'the drain must leave the shelf BELOW the lot, or this tests nothing');
await pool.query('UPDATE desk_inventory SET balance = balance - $1 WHERE id=1', [drain]);
await pool.query('UPDATE stake_pool SET balance = balance + $1 WHERE id=1', [drain]);
const clamped = await Desk.recordAuctionBuy(pool,
  { ref: 'fill-drained', accountId: buyer, omr: opened2.qty });
assert.equal(clamped.omr, drainTo, 'the desk sells only what is on the shelf, not what the lot promised');
assert.equal(await shelf(), 0, 'and the shelf lands at zero, never below it');
assert((await checkOf('$OMR conservation')).drift === consBefore, 'with conservation still exact');
console.log(`✓ the shelf clamp binds: a ${opened2.qty} lot on a ${drainTo} shelf sells ${clamped.omr}`);

await app.close();
console.log('\n✅ THE DESK passed — a $OMR sink lands on the desk instead of the fire (the pair of rows '
  + 'cancels inside the burn term while desk_inventory holds the value, so conservation is untouched, '
  + 'and a pre-recycle burn row still counts as the burn it was); the one sink that must NOT recycle — '
  + 'the on-chain withdrawal — still burns; and the desk now SELLS. The auction is fail-closed on its '
  + 'oracle, its reserve IS the band s sell side, the sale is a transfer off a shelf we hold rather '
  + 'than a mint, a comp books no ETH, and the 48h vest needed no timer because a sale credit is '
  + 'already a fresh FIFO lot.');

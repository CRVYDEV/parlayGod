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
import { DESK, DESK_RECYCLE_REASON, recyclesToDesk } from '../src/rules.js';
import { ledger } from '../src/game.js';
import { runLedgerInvariants } from '../src/invariants.js';

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
const board = (await call('GET', '/v1/desk')).body;
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

await app.close();
console.log('\n✅ THE DESK passed — a $OMR sink now lands on the desk instead of the fire: the pair of '
  + 'rows cancels inside the burn term while desk_inventory holds the value, so conservation is '
  + 'untouched; the shelf reconciles against both its own books and the ledger; a pre-recycle burn '
  + 'row still counts as the burn it was, so the change is safe on a live database; and the one '
  + 'sink that must NOT recycle — the on-chain withdrawal — still burns, because that token leaves '
  + 'the game rather than coming to the house.');

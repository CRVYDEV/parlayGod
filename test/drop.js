// THE COMMUNITY DROP (G-3) — the launch tooling's three pieces, proven together:
//  1. the PURE halves of the two CLI tools (tools/snapshot.js foldTransfers — ERC-20 balance replay
//     + ERC-721 ownership replay; tools/allocate-drop.js — the RULED coin shape proportional+floor+cap,
//     per-NFT, the multi-community merge),
//  2. the CLAIM RAIL (D1 variant b): a SIWE-linked snapshotted wallet claims ONCE — in-game $OMR
//     (`drop:claim`, an enumerated mint) + the whitelist's free identity mint that does NOT advance
//     the published tranche schedule,
//  3. §10.4: conservation unmoved by a claim (the mint is enumerated) + the `drop claims ledgered`
//     check reconciling the minted total against the claimed rows — and the CLAWBACK being nothing
//     but the window closing.
import assert from 'node:assert';
process.env.MOD_KEY = 'test-mod-key';
import { buildServer } from '../src/server.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { foldTransfers, commitmentOf } from '../tools/snapshot.js';
import { allocateCoin, allocateNft, mergeAllocations } from '../tools/allocate-drop.js';

// ════════════ 1) the tools' pure halves ════════════
{
  const ZERO = '0x0000000000000000000000000000000000000000';
  const A = '0x' + 'aa'.repeat(20), B = '0x' + 'bb'.repeat(20), C = '0x' + 'cc'.repeat(20);
  // ERC-20: mint 100 to A, A->B 40, B burns 10 → A 60, B 30
  const t20 = (from, to, value) => ({ args: { from, to, value } });
  const e20 = foldTransfers([t20(ZERO, A, 100n), t20(A, B, 40n), t20(B, ZERO, 10n)], 'erc20');
  assert.deepEqual(e20.holders, [{ wallet: A, balance: '60' }, { wallet: B, balance: '30' }],
    'erc20 replay folds mint/transfer/burn to balances, sorted by wallet');
  assert.equal(e20.negatives, 0);
  // a PARTIAL replay (missing the mint) goes negative — counted, never silently dropped
  const partial = foldTransfers([t20(A, B, 40n)], 'erc20');
  assert.equal(partial.negatives, 1, 'a partial replay surfaces its negative balances in meta');
  // ERC-721: mint #1,#2 to A, #2 -> B, #1 burned → A 0 tokens? no: A keeps nothing after burn of #1
  const t721 = (from, to, tokenId) => ({ args: { from, to, tokenId } });
  const e721 = foldTransfers([t721(ZERO, A, 1n), t721(ZERO, A, 2n), t721(A, B, 2n), t721(A, ZERO, 1n)], 'erc721');
  assert.deepEqual(e721.holders, [{ wallet: B, count: 1 }], 'erc721 replay folds ownership; burns leave, holders counted');
  // the commitment is deterministic over the canonical rows
  assert.equal(commitmentOf(e20.holders), commitmentOf(JSON.parse(JSON.stringify(e20.holders))));

  // THE RULED COIN SHAPE — proportional + dust floor + cap, never flat-per-wallet
  const holders = [
    { wallet: A, balance: '750' },   // 75% of eligible
    { wallet: B, balance: '250' },   // 25%
    { wallet: C, balance: '5' },     // dust — under the floor, excluded
  ];
  const coin = allocateCoin({ holders, pool: 1000, dustFloor: '10', cap: 600 });
  assert.deepEqual(coin, [
    { wallet: A, omr: 600 },  // pro-rata 750 — CAPPED at 600 (the whale bound; surplus stays in the Safe)
    { wallet: B, omr: 250 },  // pro-rata of the eligible total — the dust wallet never dilutes it
  ], 'coins are proportional among floor-clearing wallets, capped per wallet, dust excluded');
  // NFTs are per-NFT — the token is the Sybil bound
  const nft = allocateNft({ holders: [{ wallet: B, count: 3 }, { wallet: A, count: 1 }], perNft: 100 });
  assert.deepEqual(nft, [{ wallet: A, omr: 100 }, { wallet: B, omr: 300 }], 'per-NFT × count, sorted');
  // the MERGE: a wallet in two communities SUMS its envelopes and records both numeric ids
  const merged = mergeAllocations([
    { id: 1, freeMint: true, rows: nft },
    { id: 4, freeMint: true, rows: coin },
  ]);
  const a = merged.find((r) => r.wallet === A);
  assert.equal(a.omr, 700, 'a two-community wallet sums its envelopes');
  assert.deepEqual(a.communities, [1, 4], 'and carries every community id (numeric — never a name)');
  assert.ok(a.freeMint, 'the whitelist waiver is the OR across its communities');
}

// ════════════ 2) the claim rail ════════════
const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body, mod } = {}) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (mod) headers['x-mod-key'] = 'test-mod-key';
  const res = await app.inject({ method, url, headers, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const acct = (await pool.query('SELECT account_id FROM characters WHERE name=$1', [name])).rows[0].account_id;
  return { token, acct };
};
const drift = async () => Number((await runLedgerInvariants(pool, { alert: false })).checks
  .find((x) => x.name === '$OMR conservation').drift);
const dropCheck = async () => (await runLedgerInvariants(pool, { alert: false })).checks
  .find((x) => x.name === 'drop claims ledgered');
const txnCount = async () => Number((await pool.query('SELECT count(*) c FROM transactions')).rows[0].c);

const W1 = '0x' + '11'.repeat(20);   // the snapshotted claimant
const W2 = '0x' + '22'.repeat(20);   // snapshotted, already-minted account (no dead credit)
const W3 = '0x' + '33'.repeat(20);   // whitelist-only (0 $OMR) row
const STRANGER = '0x' + '99'.repeat(20);

const alice = await mk('Drop Alice');
const bob = await mk('Drop Bob');
const cara = await mk('Drop Cara');

// the dataset loads mod-gated, idempotently
{
  const un = await call('POST', '/v1/mod/drop/load', { body: { rows: [] } });
  assert.equal(un.code, 401, 'loading the dataset is mod-gated');
  const r = await call('POST', '/v1/mod/drop/load', { mod: true, body: { rows: [
    { wallet: W1, omr: 250, freeMint: true, communities: [1, 4] },
    { wallet: W2.toUpperCase().replace('0X', '0x'), omr: 100, freeMint: true, communities: [1] }, // loader normalizes case
    { wallet: W3, omr: 0, freeMint: true, communities: [4] },
  ] } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.loaded, 3);
  const bad = await call('POST', '/v1/mod/drop/load', { mod: true, body: { rows: [{ wallet: 'nope', omr: 5 }] } });
  assert.equal(bad.body.error, 'wallet', 'a malformed wallet refuses the whole batch');
}

// SEALED before the window: an eligible linked wallet sees announced-but-nothing-else
await pool.query('UPDATE account_persistent SET wallet_address=$2 WHERE account_id=$1', [alice.acct, W1]);
{
  let b = (await call('GET', '/v1/drop', { token: alice.token })).body;
  assert.equal(b.announced, false, 'no window yet — nothing announced');
  const c = await call('POST', '/v1/drop/claim', { token: alice.token });
  assert.equal(c.body.error, 'closed', 'no claim before a window exists');
  // announce a FUTURE window: still sealed (amounts stay sealed until claims open)
  await call('POST', '/v1/mod/drop/window', { mod: true, body: {
    opensAt: new Date(Date.now() + 3600e3).toISOString(), closesAt: new Date(Date.now() + 7200e3).toISOString() } });
  b = (await call('GET', '/v1/drop', { token: alice.token })).body;
  assert.equal(b.announced, true);
  assert.equal(b.open, false);
  assert.equal(b.eligible, null, 'the envelope stays SEALED until the window opens');
  assert.equal(b.amount, null);
  assert.ok(b.opensSeconds > 0, 'the board counts down to the open');
}

// OPEN the window; the gates fire in order
await call('POST', '/v1/mod/drop/window', { mod: true, body: {
  opensAt: new Date(Date.now() - 60e3).toISOString(), closesAt: new Date(Date.now() + 7200e3).toISOString() } });
{
  const noWallet = await call('POST', '/v1/drop/claim', { token: bob.token });
  assert.equal(noWallet.body.error, 'wallet', 'no linked wallet → the gate names the fix');
  await pool.query('UPDATE account_persistent SET wallet_address=$2 WHERE account_id=$1', [bob.acct, STRANGER]);
  const stranger = await call('POST', '/v1/drop/claim', { token: bob.token });
  assert.equal(stranger.body.error, 'not_snapshotted', 'a wallet no snapshot saw has no envelope');
  const sb = (await call('GET', '/v1/drop', { token: bob.token })).body;
  assert.equal(sb.eligible, false, 'the open board tells a stranger honestly');
}

// THE HAPPY PATH — $OMR credited via the enumerated mint, the free mint granted, once EVER
{
  const d0 = await drift();
  const omr0 = Number((await pool.query('SELECT omr FROM account_persistent WHERE account_id=$1', [alice.acct])).rows[0].omr);
  const c = await call('POST', '/v1/drop/claim', { token: alice.token });
  assert.equal(c.code, 200, JSON.stringify(c.body));
  assert.equal(c.body.omr, 250);
  assert.equal(c.body.freeMint, true);
  assert.deepEqual(c.body.communities, [1, 4]);
  const ap = (await pool.query('SELECT omr, mint_credits, drop_free_mint FROM account_persistent WHERE account_id=$1', [alice.acct])).rows[0];
  assert.equal(Number(ap.omr) - omr0, 250, 'the envelope landed on the account');
  assert.equal(Number(ap.mint_credits), 1, 'the whitelist free mint is a credit in hand');
  assert.ok(ap.drop_free_mint, 'the account is marked drop-free-mint (the tranche counter reads this)');
  const row = (await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='drop:claim'")).rows[0];
  assert.equal(Number(row.s), 250, 'the credit is a ledgered drop:claim mint');
  // §10.4 — the mint is enumerated: conservation drift is UNCHANGED by the claim
  assert.equal(await drift(), d0, 'conservation holds through a claim (drop:claim is in the mint term)');
  const chk = await dropCheck();
  assert.ok(chk.ok, `drop claims ledgered reconciles: ${JSON.stringify(chk)}`);
  // ONCE, EVER — the latch
  const again = await call('POST', '/v1/drop/claim', { token: alice.token });
  assert.equal(again.body.error, 'already', 'one envelope per wallet, ever — the latch holds');
  // the board shows the claimed state (your own history stays visible)
  const b = (await call('GET', '/v1/drop', { token: alice.token })).body;
  assert.equal(b.claimed, true);
  assert.equal(b.amount, 250);
}

// AN ALREADY-MINTED CLAIMANT — the $OMR pays, the dead credit is NOT granted (a waiver on a fee
// already paid waives nothing — the payPackagePlex lesson)
{
  await pool.query('UPDATE account_persistent SET wallet_address=$2, minted=true WHERE account_id=$1', [bob.acct, W2]);
  const c = await call('POST', '/v1/drop/claim', { token: bob.token });
  assert.equal(c.code, 200, JSON.stringify(c.body));
  assert.equal(c.body.omr, 100);
  assert.equal(c.body.freeMint, false, 'an already-minted account gets no dead credit');
  const ap = (await pool.query('SELECT mint_credits, drop_free_mint FROM account_persistent WHERE account_id=$1', [bob.acct])).rows[0];
  assert.equal(Number(ap.mint_credits), 0);
  assert.ok(!ap.drop_free_mint, 'and is NOT excluded from the paid tranche count — he paid');
}

// A WHITELIST-ONLY ROW (0 $OMR) — claims cleanly, writes NO ledger row, the check still reconciles
{
  await pool.query('UPDATE account_persistent SET wallet_address=$2 WHERE account_id=$1', [cara.acct, W3]);
  const before = Number((await pool.query("SELECT COUNT(*) c FROM transactions WHERE reason='drop:claim'")).rows[0].c);
  const c = await call('POST', '/v1/drop/claim', { token: cara.token });
  assert.equal(c.code, 200);
  assert.equal(c.body.omr, 0);
  assert.equal(c.body.freeMint, true);
  const after = Number((await pool.query("SELECT COUNT(*) c FROM transactions WHERE reason='drop:claim'")).rows[0].c);
  assert.equal(after, before, 'a zero-$OMR envelope writes no ledger row');
  assert.ok((await dropCheck()).ok, 'and the drop check still reconciles (0 on both sides)');
}

// THE TRANCHE COUNTER — paid mints only (G-3 rule 2): Cara spends her FREE credit and is minted,
// Bob is minted PAID; the published schedule's counter sees Bob alone.
{
  const spend = await call('POST', '/v1/character/mint', { token: cara.token });
  assert.equal(spend.code, 200, JSON.stringify(spend.body));
  const minted = (await pool.query('SELECT account_id FROM account_persistent WHERE minted')).rows;
  assert.equal(minted.length, 2, 'two minted accounts exist (one free, one paid)');
  const ov = await call('GET', '/v1/mod/overview', { mod: true });
  assert.equal(ov.code, 200);
  assert.equal(ov.body.mintTier.minted, 1,
    'the tranche counter counts the PAID mint only — a whitelist wave never advances the published price');
}

// a claimed row is HISTORY: re-loading a corrected dataset cannot rewrite it
{
  const r = await call('POST', '/v1/mod/drop/load', { mod: true, body: { rows: [
    { wallet: W1, omr: 999999, freeMint: false, communities: [] } ] } });
  assert.equal(r.body.skippedClaimed, 1, 'a claimed allocation is never rewritten');
  const row = (await pool.query('SELECT omr FROM drop_allocations WHERE wallet_address=$1', [W1])).rows[0];
  assert.equal(Number(row.omr), 250);
}

// THE CLAWBACK — closing the window IS the whole mechanism (design b: nothing to sweep)
{
  await call('POST', '/v1/mod/drop/window', { mod: true, body: {
    opensAt: new Date(Date.now() - 7200e3).toISOString(), closesAt: new Date(Date.now() - 60e3).toISOString() } });
  // seed one more never-claimed allocation so the report has something lapsed
  await call('POST', '/v1/mod/drop/load', { mod: true, body: { rows: [
    { wallet: '0x' + '44'.repeat(20), omr: 500, freeMint: true, communities: [1] } ] } });
  await pool.query('UPDATE account_persistent SET wallet_address=$2 WHERE account_id=$1',
    [alice.acct, '0x' + '44'.repeat(20)]);
  const c = await call('POST', '/v1/drop/claim', { token: alice.token });
  assert.equal(c.body.error, 'closed', 'past closes_at every claim refuses — that IS the clawback');
  const st = await call('GET', '/v1/mod/drop', { mod: true });
  assert.equal(st.code, 200);
  assert.equal(st.body.window.open, false);
  assert.equal(st.body.omrClaimed, 350, 'the books: 250 + 100 claimed');
  assert.equal(st.body.omrUnclaimed, 500, 'the lapsed envelope never left the Safe — the clawback report');
}

// ════════════ THE PROVENANCE COLORS (dynasty §9) — opt-in, once per wallet EVER, display-only ════════════
{
  const { portraitRow, portraitSvg, portraitTraits } = await import('../src/portrait.js');
  // restore Alice's snapshotted wallet (the clawback block above moved it)
  await pool.query('UPDATE account_persistent SET wallet_address=$2 WHERE account_id=$1', [alice.acct, W1]);
  const tx0 = await txnCount();

  // OPT-IN (§9.2): nothing was recorded by the DROP claim itself — the default is a clean portrait
  const pre = (await pool.query('SELECT provenance, provenance_pick FROM account_persistent WHERE account_id=$1', [alice.acct])).rows[0];
  assert.equal(pre.provenance, null, 'the drop claim alone records NO colors — opt-in means a separate consent');
  let b = (await call('GET', '/v1/provenance', { token: alice.token })).body;
  assert.equal(b.eligible, true, 'the board offers the claim');
  assert.ok(b.wards.every((w) => typeof w.name === 'string' && !/punk|ape|pepe|frog|pixel|stonk|broker|cat/i.test(w.name)),
    'every ward name is FICTIONAL — the §9.5 guessability posture holds on the board');

  // the CLAIM — the consent; the pick defaults to the SCARCEST claimed community. By this point
  // community 1 rides THREE snapshot wallets (W1, W2, and the clawback block's 0x44 row) while
  // community 4 rides two (W1, W3) → 4 is scarcer.
  const c = await call('POST', '/v1/provenance', { token: alice.token });
  assert.equal(c.code, 200, JSON.stringify(c.body));
  assert.deepEqual(c.body.communities, [1, 4]);
  assert.equal(c.body.pick, 4, 'the visible pick defaults to the SCARCEST claimed community, computed once at stamp');
  assert.ok(typeof c.body.ward === 'string');

  // the portrait carries the birthmark — dossier-shaped row, the boutonnière, the §9 metadata field
  const chRow = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [alice.acct])).rows[0];
  const row = await portraitRow(pool, chRow.id);
  assert.equal(row.provenance, c.body.ward, 'the portrait row carries the fictional ward name (the same field the dossier discloses)');
  const svg = portraitSvg(row);
  assert.ok(svg.includes('circle cx="36" cy="79"'), 'the boutonnière renders on the lapel');
  const traits = portraitTraits(row);
  const gp = traits.find((t) => t.trait_type === 'genesis_provenance');
  assert.ok(gp && gp.value === c.body.ward, 'metadata carries genesis_provenance — the §9-required field, the fictional name');

  // ONCE PER WALLET, EVER (§9.3): the same wallet on ANOTHER account cannot re-stamp
  const again = await call('POST', '/v1/provenance', { token: alice.token });
  assert.equal(again.body.error, 'already', 'a birth certificate is issued once');
  const eve = await mk('Drop Eve');
  // the wallet moves on (SIWE uniqueness means alice must unlink before eve can hold it) —
  // the latch rides the WALLET row in drop_allocations, so the new holder still gets nothing
  await pool.query('UPDATE account_persistent SET wallet_address=NULL WHERE account_id=$1', [alice.acct]);
  await pool.query('UPDATE account_persistent SET wallet_address=$2 WHERE account_id=$1', [eve.acct, W1]);
  const steal = await call('POST', '/v1/provenance', { token: eve.token });
  assert.equal(steal.body.error, 'already', 'the consumption unit is the WALLET — a second account re-linking it gets nothing');

  // DISPLAY-ONLY (§9.4): the whole colors flow moved no value
  assert.equal(await txnCount(), tx0, 'claiming colors writes ZERO ledger rows — display-only forever');
}

// the drop check FAILS BY NAME when a credit has no claimed row behind it (the §10.4 tripwire)
{
  await pool.query(
    "INSERT INTO transactions (id, account_id, currency, amount, reason) VALUES ('drop-trip-77',$1,'omr',77,'drop:claim')", [alice.acct]);
  const chk = await dropCheck();
  assert.ok(!chk.ok, 'a drop:claim mint with no claimed allocation behind it trips the sweep');
  await pool.query("DELETE FROM transactions WHERE reason='drop:claim' AND amount=77");
  assert.ok((await dropCheck()).ok);
}

console.log('drop: THE COMMUNITY DROP ok — the tools\' pure folds (erc20/erc721 replay, the RULED coin shape, the merge), the sealed-then-open claim rail (once per wallet ever, the enumerated drop:claim mint, the free mint that never advances the paid tranche, no dead credits), §10.4 + the drop check reconciling, and the clawback being nothing but the window closing.');
await app.close();

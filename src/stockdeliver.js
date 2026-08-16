// ═══ THE STOCK DELIVERY RAIL — treasury-bought stock lands in the STREET DEED (brokers §3.4) ═══
//
// The treasury BUYS tokenized stock (`treasury.js:runStockBuyback`) and OWES units to accounts
// (`stock_allocations`, the play-weighted distribution). This file is the last leg: it delivers those
// owed units into the player's on-chain STREET DEED's ERC-6551 token-bound account, via
// `StockVault.deliver`. Founder-directed 2026-08-14: the container is the DEED, not the Dynasty NFT —
// the deed is the family's real-estate front, "own the street, the street holds your book, sell the
// street and the book goes with it", and keeping stock OFF the identity NFT leaves its
// `balanceOf`-gates-nothing entitlement wall intact (`omerta-identity-nft-design.md` §1).
//
// THE RULE THAT FOLLOWS: a Street Deed is an on-chain ERC-721 only once EXTRACTED
// (`street_deeds.onchain_token_id` non-null). So to RECEIVE delivered stock on-chain a player must own
// AND extract a deed; an account with no extracted deed accrues its allocation as owed and WAITS —
// nothing is lost, delivery just has no target yet. This gives the deed real utility (extract it and
// it becomes your investment vault) and changes none of the wall math.
//
// §10.4-NEUTRAL by construction: stock is out-of-band real value (the fees.js/treasury.js precedent).
// This file writes ZERO `transactions` rows — the `allocated <= held` (per ticker, units) wall in
// treasury.js bounds what may be owed, and `delivered <= allocated` (added to runTreasuryInvariants)
// bounds what may be delivered. NOTHING here mints; a delivery is a pre-held `StockVault.deliver`.
//
// CHAIN-DORMANT: the on-chain resolver + the real send need CHAIN_RPC_URL + STREET_DEED_ADDRESS +
// STOCK_VAULT_ADDRESS + the ERC-6551 config; without them `deedTbaFor` returns null and the mod route
// refuses. The DB half (the plan, the deed-required gate, the idempotent ingest, the invariant) is
// fully exercised off-chain.
//
// The two former deferrals are CLOSED (2026-08-14):
//   • Secondary-ownership exclusion — the StreetDeed Transfer watcher maintains `onchain_owner`, and
//     a deed the extractor SOLD stops being their delivery target (deedTbaFor / the plan / the board
//     all apply the same case-insensitive exclusion vs the SIWE wallet; NULL fails OPEN).
//   • The real keeper TX — `runStockDeliveryKeeper` below stages + CLAIMS + sends
//     `StockVault.deliver` (dormant unless CHAIN_RPC_URL + STOCK_VAULT_ADDRESS + STOCK_KEEPER_PK);
//     the Delivered watcher is still the only thing that confirms/flips.
//   • The vault SURVIVING A BURN — tokenId is keccak(NAME), so a re-imported street sold IN-GAME
//     hands its vault to the buyer, and a database row is not an ERC-721 transfer (nothing on that
//     path could warn anybody). Answered by DISCLOSURE rather than a mechanism change, because the
//     name↔id bijection is what makes a burned deed's vault recoverable at all: `vaultHistoryFor`
//     below (the record, on the card and every listing) + `vaultLiveBalances` (the buy-confirm read).
// STILL open, flagged rather than hidden (brokers §3.4, launch-review):
//   • Drain-before-sale: a deed's owner controls its TBA, so a seller can empty it before selling —
//     inherent to gateless push into any tradeable NFT's TBA; the StreetDeed listing lock forces the
//     drain BEFORE the unlock, which is the most any on-chain rule can do, and the buy-confirm live
//     read is what lets an in-game buyer see the result of it before they pay.

import { GameError } from './game.js';

const CANONICAL_6551_REGISTRY = '0x000000006551c19487814612e58FE06813775758';
const ZERO_SALT = '0x0000000000000000000000000000000000000000000000000000000000000000';
const num = (n) => Number(n || 0);
const round6 = (n) => Math.round(n * 1e6) / 1e6;

// The StockVault delivery id for an allocation — deterministic from its PK, so a re-drive maps to the
// SAME on-chain deliveryId (StockVault.usedDeliveryId → a clean no-op) and the same backend PK.
export async function deliveryIdFor(epochId, accountId, ticker) {
  const { keccak256, toBytes } = await import('viem');
  return BigInt(keccak256(toBytes(`stockdeliver:${epochId}:${accountId}:${String(ticker).toUpperCase()}`))).toString();
}

// Resolve an account's on-chain STREET DEED's ERC-6551 token-bound account. Reads the account's
// most-recently extracted deed (`extracted_by_account`, which survives the account_id re-key) and asks
// the canonical registry for its bound account. Returns null when the chain is unconfigured/
// unreachable/wrong-chain (the makeDeedReader fail-closed posture) OR the account has no extracted
// deed — either way there is no delivery target yet, so the allocation waits.
export async function deedTbaFor(pool, accountId) {
  const mine = (await deedTargetRows(pool)).filter((r) => r.accountId === accountId);
  if (!mine.length) return null;                          // no on-chain deed follows this account
  const row = mine[0];                                    // most recent (deedTargetRows orders)
  const tba = await resolveTba(row.tokenId);
  return tba ? { tba, deedTokenId: row.tokenId, deedName: row.name } : null;
}

// ── THE TARGET RULE — one predicate, three consumers (deedTbaFor / the plan / the board — the
// extortFront one-core discipline: a board/plan/lookup disagreement is the check-5 class). A deed is
// account A's delivery target iff:
//   • its observed on-chain owner IS A's SIWE-linked wallet — the extractor still holding it, or a
//     SECONDARY buyer who linked that wallet: THE DEED FOLLOWS ITS OWNER, so buying a Street on a
//     marketplace and linking your wallet makes its vault your delivery target (and the seller's
//     allocations go back to waiting — their stock never lands in a stranger's vault); or
//   • no transfer was ever observed (onchain_owner NULL — the pre-watcher / chain-dormant state)
//     and A extracted it: fails OPEN on purpose, a chain-dormant server keeps delivering as before.
// Case-insensitive throughout (logs arrive checksummed, SIWE stores what the signer sent). Two flat
// queries + a JS fold — never a correlated subquery, and never two IS-NOT-NULLs AND-ed on
// ALTER-added columns (both recorded pg-mem quirks; the token side filters in JS).
export async function deedTargetRows(pool) {
  const deeds = (await pool.query(
    `SELECT onchain_token_id, name, extracted_by_account, extracted_at, onchain_owner
       FROM street_deeds WHERE extracted_by_account IS NOT NULL`)).rows
    .filter((d) => d.onchain_token_id != null);
  const wallets = (await pool.query(
    'SELECT account_id, wallet_address FROM account_persistent WHERE wallet_address IS NOT NULL')).rows;
  const byWallet = new Map(wallets.map((w) => [String(w.wallet_address).toLowerCase(), w.account_id]));
  const out = [];
  for (const d of deeds) {
    const accountId = d.onchain_owner
      ? (byWallet.get(String(d.onchain_owner).toLowerCase()) || null)  // sold → the buyer (if linked), never the extractor
      : d.extracted_by_account;                                        // no transfer observed → the extractor
    if (accountId) out.push({
      accountId, tokenId: String(d.onchain_token_id), name: d.name,
      at: d.extracted_at ? new Date(d.extracted_at).getTime() : 0,
    });
  }
  out.sort((a, b) => b.at - a.at);   // most recent first — the pick when an account has several
  return out;
}

// The TBA resolver, behind a test seam (the push.js/citywire `__setDeliver` discipline): the on-chain
// registry read needs a live chain, so a suite swaps in a deterministic resolver to exercise the
// stage→confirm path without one. Production always uses `resolveTbaOnchain`.
let _resolveTba = resolveTbaOnchain;
export function __setTbaResolver(fn) { _resolveTba = fn || resolveTbaOnchain; }
export async function resolveTba(tokenId) { return _resolveTba(tokenId); }

// The pure ERC-6551 registry read: registry.account(impl, salt, chainId, StreetDeed, tokenId). Chain-
// dormant (null) without CHAIN_RPC_URL + STREET_DEED_ADDRESS + ERC6551_ACCOUNT_IMPL + CHAIN_ID.
async function resolveTbaOnchain(tokenId) {
  const rpc = process.env.CHAIN_RPC_URL;
  const deedAddr = process.env.STREET_DEED_ADDRESS;
  const impl = process.env.ERC6551_ACCOUNT_IMPL;
  const chainId = process.env.CHAIN_ID;
  if (!rpc || !deedAddr || !impl || !chainId) return null;
  const { createPublicClient, http, isAddress, getAddress } = await import('viem');
  if (!isAddress(deedAddr) || !isAddress(impl)) return null;
  const registry = process.env.ERC6551_REGISTRY || CANONICAL_6551_REGISTRY;
  if (!isAddress(registry)) return null;
  const client = createPublicClient({ transport: http(rpc) });
  try {
    if (Number(chainId) !== Number(await client.getChainId())) return null;   // wrong-chain guard
    const abi = [{ type: 'function', name: 'account', stateMutability: 'view',
      inputs: [
        { name: 'implementation', type: 'address' }, { name: 'salt', type: 'bytes32' },
        { name: 'chainId', type: 'uint256' }, { name: 'tokenContract', type: 'address' },
        { name: 'tokenId', type: 'uint256' }],
      outputs: [{ name: '', type: 'address' }] }];
    const salt = process.env.ERC6551_SALT || ZERO_SALT;
    const addr = await client.readContract({
      address: getAddress(registry), abi, functionName: 'account',
      args: [getAddress(impl), salt, BigInt(chainId), getAddress(deedAddr), BigInt(tokenId)] });
    return addr;
  } catch { return null; }
}

// ══ THE VAULT'S RECORD — what a street's token-bound account has RECEIVED (red-team follow-up) ══
//
// tokenId = keccak256(bytes(name)) (StreetDeed.tokenIdFor), so a deed's ERC-6551 account is a function
// of its NAME and SURVIVES A BURN: re-import a street, sell it in-game, and the buyer's extraction
// resolves the SAME vault — whatever sits in it travels with the name, while the in-game market priced
// the street with no sight of it. That bijection is load-bearing rather than a bug (it is what makes a
// burned deed's vault RECOVERABLE instead of stranded at an address nobody can ever reach again), so
// the answer is DISCLOSURE: the deed card and every market listing state what the vault has received,
// and a buyer prices it. The terms ride with the price — the pad, the nut, the Port lane.
//
// "RECEIVED", NEVER "HOLDS". This reads `stock_deliveries` — the record of what was PUSHED IN — and
// the account's owner controls that account and can move tokens out of it at any time. A delivered
// total presented as a balance would be a false claim on a purchase screen, which is strictly worse
// than saying nothing; the live figure needs an RPC read and rides the buy-CONFIRM step
// (`vaultLiveBalances`), never the polled board.
//
// REAL deliveries only (`tx_hash IS NOT NULL` — the txHash comp gate): a comp/QA row books no stock,
// so counting one as received would fabricate exactly what that gate exists to prevent.
export async function vaultHistoryFor(client, names = []) {
  const out = new Map();
  const uniq = [...new Set((names || []).filter(Boolean).map(String))];
  if (!uniq.length) return out;
  const { keccak256, toBytes } = await import('viem');
  const byToken = new Map();                              // tokenId → the street name that derives it
  for (const n of uniq) byToken.set(BigInt(keccak256(toBytes(n))).toString(), n);
  const ids = [...byToken.keys()];
  // an IN list, never `= ANY` (the pg-mem lesson) — the comment sits ABOVE the call so pgquery reads
  // the argument and catalogues this where it belongs (interpolated), not as an unreadable one
  const rows = (await client.query(
    `SELECT deed_token_id, ticker, units, tba FROM stock_deliveries
       WHERE tx_hash IS NOT NULL AND deed_token_id IN (${ids.map((_, i) => `$${i + 1}`).join(',')})`,
    ids)).rows;
  for (const r of rows) {
    const name = byToken.get(String(r.deed_token_id));
    if (!name) continue;
    const v = out.get(name) || { tokenId: String(r.deed_token_id), tba: null, received: [] };
    if (r.tba && !v.tba) v.tba = r.tba;                   // the recorded TBA — no RPC needed to publish it
    const line = v.received.find((x) => x.ticker === r.ticker);
    if (line) line.units = round6(line.units + num(r.units));
    else v.received.push({ ticker: r.ticker, units: round6(num(r.units)) });
    out.set(name, v);
  }
  for (const v of out.values()) v.received.sort((a, b) => b.units - a.units);
  return out;
}

// THE LIVE READ — what the vault actually holds RIGHT NOW, for the buy-CONFIRM step only.
//
// Deliberately not on the board: `/v1/deeds` is polled, and one RPC round-trip per listing per render
// is the shape the poll-cost pass just spent a session removing. A buyer asks for this once, at the
// moment the money moves, which is also the only moment the number is worth its latency.
//
// Chain-dormant → `{ live: false }` (never a fabricated zero, which would read as "the vault is
// empty" — the dormant-is-a-state-not-a-grade rule). A token that fails to read is reported as null
// rather than 0, for the same reason.
export async function vaultLiveBalances(name) {
  const { keccak256, toBytes } = await import('viem');
  const tokenId = BigInt(keccak256(toBytes(String(name)))).toString();
  const tba = await resolveTba(tokenId);                  // null when unconfigured/unreachable/wrong-chain
  const tokens = stockTokenAddresses();
  if (!tba || !Object.keys(tokens).length) return { live: false, tokenId, tba: tba || null, holds: [] };
  const { createPublicClient, http, isAddress, getAddress, formatUnits } = await import('viem');
  const client = createPublicClient({ transport: http(process.env.CHAIN_RPC_URL) });
  const abi = [{ type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ name: 'a', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }];
  const dec = Number(process.env.STOCK_TOKEN_DECIMALS || 18);
  const holds = [];
  for (const [ticker, addr] of Object.entries(tokens)) {
    if (!isAddress(addr)) continue;
    try {
      const bal = await client.readContract({ address: getAddress(addr), abi, functionName: 'balanceOf', args: [tba] });
      const units = Number(formatUnits(bal, dec));
      if (units > 0) holds.push({ ticker, units: round6(units) });
    } catch { holds.push({ ticker, units: null }); }      // unreadable ≠ empty
  }
  holds.sort((a, b) => (b.units || 0) - (a.units || 0));
  return { live: true, tokenId, tba, holds };
}

// THE PLAN — the undelivered allocation rows whose account has an extracted deed. Pure DB, so it is
// the fully-testable core. Each row is one delivery: push `units` of `ticker` into the deed's TBA.
// An account WITHOUT an extracted deed is simply absent (its allocation waits). The deed token id is
// resolved from `extracted_by_account`; the TBA itself is resolved on-chain at send time.
export async function planStockDeliveries(pool) {
  // the shared TARGET RULE resolves each account's deed (secondary owners included — the deed
  // follows its owner); an account with no target simply drops out (its allocation waits)
  const targets = await deedTargetRows(pool);
  const best = new Map();
  for (const t of targets) if (!best.has(t.accountId)) best.set(t.accountId, t); // rows arrive most-recent-first
  const rows = (await pool.query(
    'SELECT epoch_id, account_id, ticker, units FROM stock_allocations WHERE NOT delivered AND units > 0')).rows;
  const seen = new Set();
  const plan = [];
  for (const r of rows) {
    const tgt = best.get(r.account_id);
    if (!tgt) continue;   // owed, but no on-chain deed follows this account — it waits
    const key = `${r.epoch_id}|${r.account_id}|${String(r.ticker).toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    plan.push({
      epochId: r.epoch_id, accountId: r.account_id, ticker: String(r.ticker).toUpperCase(),
      units: round6(num(r.units)), deedTokenId: tgt.tokenId, deedName: tgt.name,
    });
  }
  return plan;
}

// TWO-PHASE, because the on-chain `Delivered(deliveryId, token, to, units)` event carries ONLY the
// deliveryId — so the confirming watcher cannot know which allocation a delivery fulfils unless the
// send was STAGED first. STAGE records what the keeper is about to send (status='pending'); the
// Delivered watcher CONFIRMS by deliveryId (flips the allocation). A comp records 'simulated' and is
// never confirmed, so it flips nothing (a comp must never assert a player received stock it did not —
// the treasury.js txHash gate). Idempotent on `delivery_id` (SELECT-then-INSERT / guarded UPDATE, not
// ON CONFLICT — pg-mem lies about the suppressed rowCount; the treasury.js discipline).

// STAGE ONE delivery: resolve the account's deed TBA, compute the deterministic deliveryId, and record
// a 'pending' (or, for a comp, 'simulated') row the keeper/watcher will confirm. Refuses `no_target`
// when the account has no extracted deed or the chain is unconfigured — the allocation waits.
export async function stageStockDelivery(pool, { epochId, accountId, ticker, units, simulate = false } = {}) {
  const tk = String(ticker || '').trim().toUpperCase();
  if (!tk) throw new GameError('ticker', 'A delivery needs a ticker.');
  const u = num(units);
  if (!(Number.isFinite(u) && u > 0)) throw new GameError('units', 'units must be > 0');
  const tgt = await deedTbaFor(pool, accountId);
  if (!tgt) throw new GameError('no_target',
    'No delivery target: the account has no extracted Street Deed on-chain (or the chain is unconfigured). The allocation waits until a deed is extracted.');
  const deliveryId = await deliveryIdFor(epochId, accountId, tk);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = (await client.query('SELECT status FROM stock_deliveries WHERE delivery_id=$1', [deliveryId])).rows[0];
    if (existing) { await client.query('COMMIT'); return { staged: false, duplicate: true, deliveryId, status: existing.status }; }
    await client.query(
      `INSERT INTO stock_deliveries (delivery_id, epoch_id, account_id, ticker, units, deed_token_id, tba, tx_hash, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8)`,
      [deliveryId, epochId, accountId, tk, round6(u), tgt.deedTokenId, tgt.tba, simulate ? 'simulated' : 'pending']);
    await client.query('COMMIT');
    return { staged: true, deliveryId, tba: tgt.tba, deedTokenId: tgt.deedTokenId, units: round6(u),
      ticker: tk, status: simulate ? 'simulated' : 'pending' };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e?.code === '23505') return { staged: false, duplicate: true, deliveryId };
    throw e;
  } finally { client.release(); }
}

// CONFIRM a staged delivery the moment its `Delivered` log lands (the watcher) — flip the row to
// 'delivered' + stamp the txHash, and flip the allocation. Idempotent: a re-scanned log finds the row
// already delivered (no-op). Confirms ONLY a 'pending' row — a 'simulated' comp is never upgraded.
export async function confirmStockDelivered(pool, { deliveryId, txHash } = {}) {
  const id = String(deliveryId || '').trim();
  if (!id) throw new GameError('delivery_id', 'confirm needs a deliveryId.');
  if (!txHash) throw new GameError('tx', 'confirm needs the on-chain txHash.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query('SELECT * FROM stock_deliveries WHERE delivery_id=$1 FOR UPDATE', [id])).rows[0];
    if (!row) { await client.query('COMMIT'); return { confirmed: false, unknown: true }; }
    if (row.status === 'delivered') { await client.query('COMMIT'); return { confirmed: false, duplicate: true }; }
    if (row.status !== 'pending') { await client.query('COMMIT'); return { confirmed: false, notPending: true, status: row.status }; }
    await client.query("UPDATE stock_deliveries SET status='delivered', tx_hash=$2 WHERE delivery_id=$1", [id, txHash]);
    await client.query('UPDATE stock_allocations SET delivered=true WHERE epoch_id=$1 AND account_id=$2 AND ticker=$3',
      [row.epoch_id, row.account_id, String(row.ticker).toUpperCase()]);
    await client.query('COMMIT');
    return { confirmed: true, ticker: String(row.ticker).toUpperCase(), units: round6(num(row.units)) };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}

// The mod driver for ONE delivery. `txHash` present ⇒ a REAL send already done (stage then confirm
// in one call — an operator who sent by hand passes the hash). No txHash ⇒ a QA comp (stages
// 'simulated', flips nothing). The automated path is `runStockDeliveryKeeper` below.
export async function deliverStock(pool, { epochId, accountId, ticker, units, txHash = null } = {}) {
  const staged = await stageStockDelivery(pool, { epochId, accountId, ticker, units, simulate: !txHash });
  if (txHash && staged.deliveryId) {
    const c = await confirmStockDelivered(pool, { deliveryId: staged.deliveryId, txHash });
    return { ...staged, ...c };
  }
  return staged;
}

// ═══ THE DELIVERY KEEPER — the tx sender that drives StockVault.deliver (chain-dormant) ═══
// The last leg the rail was missing: the plan existed, the Delivered watcher confirmed, and NOTHING
// sent the transaction. The keeper walks the plan, STAGES each delivery (two-phase, above), CLAIMS it
// (an atomic sent_at stamp — the push.js C1 claim-then-send discipline, so two overlapping workers
// cannot both send; and even a lost race is bounded by the contract's usedDeliveryId, which makes the
// second send a clean revert), and hands the send to `_sendDeliver`. It NEVER confirms — the
// Delivered watcher is the only thing that flips an allocation, so a tx that never lands leaves a
// claimed-pending row the resend window retries (sent_at older than RESEND_MS ⇒ eligible again).
// Ticker → ERC-20 address comes from STOCK_TOKEN_ADDRESSES (JSON env, e.g. '{"AAPL":"0x…"}'); a
// planned ticker with no address is SKIPPED BY NAME, never silently (the community-keeper no_budget
// lesson — a stranded delivery must not read like an empty plan).
const RESEND_MS = 10 * 60 * 1000;                        // a claimed-but-unconfirmed send retries after this

let _sendDeliver = sendDeliverOnchain;                   // the test seam (the __setTbaResolver discipline)
export function __setTxSender(fn) { _sendDeliver = fn || sendDeliverOnchain; }

export function stockTokenAddresses() {
  try {
    const raw = JSON.parse(process.env.STOCK_TOKEN_ADDRESSES || '{}');
    const map = {};
    for (const [k, v] of Object.entries(raw || {})) map[String(k).toUpperCase()] = v;
    return map;
  } catch { return {}; }                                 // a malformed env reads as "no addresses" — every ticker skips by name
}
export const deliveryKeeperReady = () =>
  !!(process.env.CHAIN_RPC_URL && process.env.STOCK_VAULT_ADDRESS && process.env.STOCK_KEEPER_PK);

export async function runStockDeliveryKeeper(pool, opts = {}) {
  const seamed = _sendDeliver !== sendDeliverOnchain;
  if (!seamed && !deliveryKeeperReady()) return { dormant: true };
  const tokens = opts.tokens || stockTokenAddresses();
  const plan = await planStockDeliveries(pool);
  const out = { dormant: false, sent: [], skipped: [] };
  for (const p of plan) {
    const token = tokens[p.ticker];
    if (!token) { out.skipped.push({ ticker: p.ticker, accountId: p.accountId, why: 'no_token_address' }); continue; }
    let staged;
    try { staged = await stageStockDelivery(pool, p); }
    catch (e) {
      if (e?.code === 'no_target') { out.skipped.push({ ticker: p.ticker, accountId: p.accountId, why: 'no_target' }); continue; }
      throw e;
    }
    const deliveryId = staged.deliveryId;
    // CLAIM-then-send: only a 'pending' row whose last send attempt is outside the resend window may
    // go out; a 'simulated' comp or an already-'delivered' row matches nothing and skips by name.
    const cutoff = new Date(Date.now() - (opts.resendMs ?? RESEND_MS));
    const claimed = await pool.query(
      `UPDATE stock_deliveries SET sent_at=now()
        WHERE delivery_id=$1 AND status='pending' AND (sent_at IS NULL OR sent_at < $2)
        RETURNING tba, units, ticker`, [deliveryId, cutoff]);
    if (!claimed.rowCount) {
      out.skipped.push({ deliveryId, ticker: p.ticker, why: staged.status === 'simulated' ? 'simulated' : 'in_flight_or_done' });
      continue;
    }
    try {
      const txHash = await _sendDeliver({
        deliveryId, token, to: claimed.rows[0].tba,
        units: round6(num(claimed.rows[0].units)), ticker: p.ticker,
      });
      out.sent.push({ deliveryId, ticker: p.ticker, accountId: p.accountId, units: p.units, txHash: txHash || null });
    } catch (e) {
      // a FAILED send releases the claim so the next tick retries immediately (safe: a racing double
      // send is a clean on-chain revert via usedDeliveryId); the skip is named, never silent.
      await pool.query("UPDATE stock_deliveries SET sent_at=NULL WHERE delivery_id=$1 AND status='pending'", [deliveryId]);
      out.skipped.push({ deliveryId, ticker: p.ticker, why: 'send_failed', error: e?.message });
    }
  }
  return out;
}

// The real send: build + sign + submit StockVault.deliver from the keeper key. The Safe set this key
// as the vault's `keeper`; a leaked key is bounded by the vault's own walls (per-token daily cap,
// pause, setKeeper rotation, pre-held-only transfers). Wrong-chain guarded like every other sender.
async function sendDeliverOnchain({ deliveryId, token, to, units }) {
  const rpc = process.env.CHAIN_RPC_URL;
  const vault = process.env.STOCK_VAULT_ADDRESS;
  const pk = process.env.STOCK_KEEPER_PK;
  if (!rpc || !vault || !pk) throw new Error('delivery keeper unconfigured');
  const { createWalletClient, createPublicClient, http, parseUnits, getAddress } = await import('viem');
  const { privateKeyToAccount } = await import('viem/accounts');
  const pub = createPublicClient({ transport: http(rpc) });
  const chainId = Number(process.env.CHAIN_ID || 0);
  if (chainId && chainId !== Number(await pub.getChainId()))
    throw new Error('delivery keeper: RPC chain does not match CHAIN_ID — refusing to send');
  const decimals = Number(process.env.STOCK_TOKEN_DECIMALS || 18);
  const chain = { id: chainId || Number(await pub.getChainId()), name: 'omerta-chain',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpc] } } };
  const wallet = createWalletClient({ account: privateKeyToAccount(pk), chain, transport: http(rpc) });
  const abi = [{ type: 'function', name: 'deliver', stateMutability: 'nonpayable',
    inputs: [{ name: 'deliveryId', type: 'uint256' }, { name: 'token', type: 'address' },
      { name: 'to', type: 'address' }, { name: 'units', type: 'uint256' }], outputs: [] }];
  return wallet.writeContract({ address: getAddress(vault), abi, functionName: 'deliver',
    args: [BigInt(deliveryId), getAddress(token), getAddress(to), parseUnits(String(units), decimals)] });
}

// The ops board: owed vs delivered per ticker, and how many accounts are waiting on a deed. Read-only.
export async function stockDeliveryBoard(pool) {
  const owed = (await pool.query('SELECT ticker, COALESCE(SUM(units),0) u FROM stock_allocations GROUP BY ticker')).rows;
  const del = (await pool.query("SELECT ticker, COALESCE(SUM(units),0) u FROM stock_deliveries WHERE status='delivered' GROUP BY ticker")).rows;
  const delByTicker = new Map(del.map((r) => [String(r.ticker).toUpperCase(), num(r.u)]));
  const tickers = owed.map((r) => {
    const t = String(r.ticker).toUpperCase();
    const allocated = round6(num(r.u));
    const delivered = round6(delByTicker.get(t) || 0);
    return { ticker: t, allocated, delivered, pending: round6(Math.max(0, allocated - delivered)) };
  });
  // accounts owed stock but with no deed to receive it (the deed-required gate, made visible) —
  // read through the SAME target rule the plan uses, so board and plan structurally cannot disagree
  // (the check-5 board/plan mirror; secondary owners count as targeted exactly as the plan counts them)
  const owedAccts = (await pool.query(
    'SELECT DISTINCT account_id FROM stock_allocations WHERE NOT delivered AND units > 0')).rows.map((r) => r.account_id);
  const withDeed = new Set((await deedTargetRows(pool)).map((r) => r.accountId));
  const waiting = owedAccts.filter((a) => !withDeed.has(a)).length;
  return { tickers, waitingOnADeed: waiting, chain: !!(process.env.CHAIN_RPC_URL && process.env.STREET_DEED_ADDRESS) };
}

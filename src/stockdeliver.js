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
// DEFERRED, and flagged rather than hidden (launch-review items, the same class as the DynastyNFT
// Transfer-watcher metadata freeze):
//   • Secondary-ownership re-targeting. The backend delivers to the deed an account EXTRACTED
//     (`extracted_by_account`); it does NOT run a Transfer watcher on the deed NFT, so if that deed is
//     sold on-chain before its stock is delivered, a later allocation to the seller's account would
//     land in the deed the buyer now owns. The delivery keeper should therefore run only where the
//     extractor is still the on-chain holder (a Transfer watcher supplies that), OR delivery is
//     triggered close enough to allocation that a sale in between is not the common case. Recorded.
//   • The real keeper TX (build + sign + send `StockVault.deliver`) is the external/mainnet edge, the
//     same shape as the DEX buyback bot — the mod route RECORDS a delivery (a real one carries a
//     txHash from the Delivered watcher; a comp records `simulated` and flips no allocation).
//   • Drain-before-sale: a deed's owner controls its TBA, so a seller can empty it before selling —
//     inherent to gateless push into any tradeable NFT's TBA (brokers §3.4, launch-review).

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
  const row = (await pool.query(
    "SELECT onchain_token_id, name FROM street_deeds WHERE extracted_by_account=$1 AND onchain_token_id IS NOT NULL ORDER BY extracted_at DESC NULLS LAST LIMIT 1",
    [accountId])).rows[0];
  if (!row) return null;                                  // the account holds no extracted deed
  const tba = await resolveTba(row.onchain_token_id);
  return tba ? { tba, deedTokenId: String(row.onchain_token_id), deedName: row.name } : null;
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

// THE PLAN — the undelivered allocation rows whose account has an extracted deed. Pure DB, so it is
// the fully-testable core. Each row is one delivery: push `units` of `ticker` into the deed's TBA.
// An account WITHOUT an extracted deed is simply absent (its allocation waits). The deed token id is
// resolved from `extracted_by_account`; the TBA itself is resolved on-chain at send time.
export async function planStockDeliveries(pool) {
  // One flat JOIN (never a correlated subquery — pg-mem cannot parse those, the /v1/gangs precedent).
  // The GATE is the JOIN to an extracted deed via `extracted_by_account`; an account with none drops
  // out. If an account holds several extracted deeds the JOIN yields one row per deed, so we order by
  // `extracted_at` and keep the FIRST (most recent) per (epoch,account,ticker).
  const ordered = (await pool.query(
    `SELECT a.epoch_id, a.account_id, a.ticker, a.units, d.onchain_token_id, d.name, d.extracted_at
       FROM stock_allocations a
       JOIN street_deeds d
         ON d.extracted_by_account = a.account_id AND d.onchain_token_id IS NOT NULL
      WHERE NOT a.delivered AND a.units > 0
      ORDER BY d.extracted_at DESC NULLS LAST`)).rows;
  const seen = new Set();
  const plan = [];
  for (const r of ordered) {
    const key = `${r.epoch_id}|${r.account_id}|${String(r.ticker).toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    plan.push({
      epochId: r.epoch_id, accountId: r.account_id, ticker: String(r.ticker).toUpperCase(),
      units: round6(num(r.units)), deedTokenId: String(r.onchain_token_id), deedName: r.name,
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

// The mod/keeper driver for ONE delivery. `txHash` present ⇒ a REAL send already done (stage then
// confirm in one call — the mainnet keeper, having sent, passes the hash). No txHash ⇒ a QA comp
// (stages 'simulated', flips nothing). The real keeper's build+sign+send of StockVault.deliver is the
// external/mainnet edge (the DEX-buyback-bot shape); this records the two-phase result.
export async function deliverStock(pool, { epochId, accountId, ticker, units, txHash = null } = {}) {
  const staged = await stageStockDelivery(pool, { epochId, accountId, ticker, units, simulate: !txHash });
  if (txHash && staged.deliveryId) {
    const c = await confirmStockDelivered(pool, { deliveryId: staged.deliveryId, txHash });
    return { ...staged, ...c };
  }
  return staged;
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
  // accounts owed stock but with no extracted deed to receive it (the deed-required gate, made
  // visible). Two flat queries + a JS set-difference — never a correlated subquery (pg-mem).
  const owedAccts = (await pool.query(
    'SELECT DISTINCT account_id FROM stock_allocations WHERE NOT delivered AND units > 0')).rows.map((r) => r.account_id);
  // (pg-mem quirk: two `IS NOT NULL` predicates AND-ed on ALTER-added columns wrongly returns zero
  // rows — filter the token side in JS. Both are set together at re-key, so `extracted_by_account`
  // alone is the real gate; the JS filter is the defensive both-set check the SQL AND would express.)
  const withDeed = new Set((await pool.query(
    'SELECT DISTINCT extracted_by_account a, onchain_token_id t FROM street_deeds WHERE extracted_by_account IS NOT NULL')).rows
    .filter((r) => r.t != null).map((r) => r.a));
  const waiting = owedAccts.filter((a) => !withDeed.has(a)).length;
  return { tickers, waitingOnADeed: waiting, chain: !!(process.env.CHAIN_RPC_URL && process.env.STREET_DEED_ADDRESS) };
}

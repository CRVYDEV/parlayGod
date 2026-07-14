// M6-B — the chain service (spec §11, now EVM/Robinhood Chain). Off-chain stays
// authoritative; this signs EIP-712 vouchers the on-chain VoucherClaim accepts, under
// a FULL-RESERVE discipline: the in-game $OMR ledger is debited immediately, and a
// voucher is only SIGNED when the funded tranche covers all outstanding signed claims —
// otherwise it QUEUES until the Safe funds more. The chain never owes what isn't funded.
//
// Isolation (spec §11): the only tables this writes are `vouchers`, `chain_reserve`,
// `wallet_challenges`, plus the ledger row for the $OMR debit. A compromised signer is
// bounded on-chain by the tranche + daily cap (OMR) and the per-gearId cap (gear).
import crypto from 'node:crypto';
import { hashTypedData, recoverTypedDataAddress, parseUnits, isAddress, getAddress, verifyMessage } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { GameError, ledger } from './game.js';

const uid = () => crypto.randomUUID();

// EIP-712 shape — MUST stay in exact parity with VoucherClaim.VOUCHER_TYPEHASH and its
// domain ("OmertaVoucherClaim","1"). Field order matches the Solidity struct.
export const VOUCHER_TYPES = {
  Voucher: [
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'kind', type: 'uint8' },
    { name: 'gearId', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};
const KIND_OMR = 0, KIND_GEAR = 1;
const WITHDRAW_TTL_SEC = 24 * 3600;                 // short deadline, well under MAX_VOUCHER_TTL (30d)

// Chain config from env (never hardcode chainId — see the F-3 audit note).
export function chainConfig() {
  const chainId = Number(process.env.CHAIN_ID || 46630);        // Robinhood Chain testnet
  const verifyingContract = process.env.VOUCHER_CLAIM_ADDRESS || '0x0000000000000000000000000000000000000000';
  return { name: 'OmertaVoucherClaim', version: '1', chainId, verifyingContract };
}
function signerAccount() {
  const pk = process.env.VOUCHER_SIGNER_PK;
  if (!pk) throw new GameError('chain_unconfigured', 'Withdrawals are not enabled on this server yet.');
  return privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
}

// Build the on-chain voucher tuple (amount in wei) from a stored row.
function toVoucherMessage(row) {
  return {
    to: getAddress(row.to_address),
    amount: row.kind === 'omr' ? parseUnits(String(row.amount), 18) : BigInt(row.amount),
    kind: row.kind === 'omr' ? KIND_OMR : KIND_GEAR,
    gearId: row.kind === 'gear' ? BigInt(gearNumId(row.gear_id)) : 0n,
    nonce: BigInt(row.nonce),
    deadline: BigInt(row.deadline),
  };
}
// Gear class id → on-chain uint256. The game's gear are string ids (MARKET table); the
// on-chain tokenId is their 1-based index (matches "one tokenId per gear class").
import { MARKET } from './rules.js';
export function gearNumId(gearId) {
  const i = MARKET.findIndex((m) => m.id === gearId);
  if (i < 0) throw new GameError('bad_gear', 'No such gear class.');
  return i + 1; // 1-based; 0 is reserved (contract rejects gearId 0)
}

async function signVoucher(row) {
  const message = toVoucherMessage(row);
  const domain = chainConfig();
  const signature = await signerAccount().signTypedData({ domain, types: VOUCHER_TYPES, primaryType: 'Voucher', message });
  // serialize bigints as strings for storage / client transport
  const voucher = Object.fromEntries(Object.entries(message).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]));
  return { voucher, signature };
}

// Σ signed-but-unclaimed $OMR — the live claim on the funded tranche.
async function signedOutstanding(client) {
  return Number((await client.query(
    "SELECT COALESCE(SUM(amount),0) s FROM vouchers WHERE kind='omr' AND status='signed' AND NOT claimed_onchain")).rows[0].s);
}

// ── OMR withdrawal (full-reserve queue) ──
export async function requestWithdraw(pool, accountId, amount, toAddress) {
  const amt = Math.floor(Number(amount) * 1e6) / 1e6;          // clamp to the ledger's 6-dp precision
  if (!(amt > 0)) throw new GameError('amount', 'Positive amounts only.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const acct = (await client.query('SELECT * FROM account_persistent WHERE account_id=$1 FOR UPDATE', [accountId])).rows[0];
    if (!acct) throw new GameError('no_account', 'No such account.');
    const to = toAddress || acct.wallet_address;
    if (!to || !isAddress(to)) throw new GameError('wallet', 'Link a wallet (SIWE) or pass a valid address first.');
    if (Number(acct.omr) < amt) throw new GameError('omr', 'Not that much $OMR.');

    // debit the in-game ledger NOW so the balance can't be double-spent while queued
    await client.query('UPDATE account_persistent SET omr = omr - $2 WHERE account_id=$1', [accountId, amt]);
    await ledger(client, { accountId, currency: 'omr', amount: -amt, reason: 'withdraw:omr' }); // legal §10.4 burn (leaves the game)

    const res = (await client.query('SELECT * FROM chain_reserve WHERE id=1 FOR UPDATE')).rows[0];
    const nonce = Number(res.next_nonce);
    await client.query('UPDATE chain_reserve SET next_nonce = next_nonce + 1 WHERE id=1');
    const deadline = Math.floor(Date.now() / 1000) + WITHDRAW_TTL_SEC;

    const outstanding = await signedOutstanding(client);
    const fits = outstanding + amt <= Number(res.funded_omr);
    const id = uid();
    const row = { id, account_id: accountId, kind: 'omr', amount: amt, gear_id: null, nonce, to_address: getAddress(to), deadline };
    let payload = null, status = 'queued';
    if (fits) { payload = JSON.stringify(await signVoucher(row)); status = 'signed'; }
    await client.query(
      'INSERT INTO vouchers (id, account_id, kind, amount, nonce, to_address, deadline, status, signed_payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, accountId, 'omr', amt, nonce, getAddress(to), deadline, status, payload]);
    await client.query('COMMIT');
    return { id, nonce, status, amount: amt, ...(payload ? JSON.parse(payload) : {}),
      queuedReason: fits ? undefined : 'reserve_insufficient' };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// ── Gear withdrawal (mint voucher) — not reserve-bounded; the contract caps supply ──
export async function requestGearWithdraw(pool, accountId, gearId, toAddress) {
  gearNumId(gearId); // validates the class exists
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const acct = (await client.query('SELECT * FROM account_persistent WHERE account_id=$1 FOR UPDATE', [accountId])).rows[0];
    const to = toAddress || acct?.wallet_address;
    if (!to || !isAddress(to)) throw new GameError('wallet', 'Link a wallet (SIWE) or pass a valid address first.');
    const g = (await client.query('SELECT * FROM account_gear WHERE account_id=$1 AND gear_id=$2 FOR UPDATE', [accountId, gearId])).rows[0];
    if (!g) throw new GameError('no_gear', "You don't own that gear.");
    if (g.minted_onchain) throw new GameError('already', 'That gear is already on-chain.');
    await client.query('UPDATE account_gear SET minted_onchain=true WHERE account_id=$1 AND gear_id=$2', [accountId, gearId]);

    const res = (await client.query('SELECT * FROM chain_reserve WHERE id=1 FOR UPDATE')).rows[0];
    const nonce = Number(res.next_nonce);
    await client.query('UPDATE chain_reserve SET next_nonce = next_nonce + 1 WHERE id=1');
    const deadline = Math.floor(Date.now() / 1000) + WITHDRAW_TTL_SEC;
    const id = uid();
    const row = { id, account_id: accountId, kind: 'gear', amount: 1, gear_id: gearId, nonce, to_address: getAddress(to), deadline };
    const payload = JSON.stringify(await signVoucher(row)); // gear signs immediately (contract-capped)
    await client.query(
      'INSERT INTO vouchers (id, account_id, kind, amount, gear_id, nonce, to_address, deadline, status, signed_payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, accountId, 'gear', 1, gearId, nonce, getAddress(to), deadline, 'signed', payload]);
    await client.query('COMMIT');
    return { id, nonce, status: 'signed', gearId, ...JSON.parse(payload) };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// Drain the queue FIFO after the Safe funds more reserve (or on a timer). Signs
// queued OMR vouchers oldest-first while the funded tranche still covers them.
export async function drainQueue(pool) {
  const client = await pool.connect();
  let signed = 0;
  try {
    await client.query('BEGIN');
    const res = (await client.query('SELECT * FROM chain_reserve WHERE id=1 FOR UPDATE')).rows[0];
    let outstanding = await signedOutstanding(client);
    const queued = (await client.query("SELECT * FROM vouchers WHERE kind='omr' AND status='queued' ORDER BY created_at, nonce")).rows;
    for (const row of queued) {
      if (outstanding + Number(row.amount) > Number(res.funded_omr)) break; // FIFO stops at the reserve edge
      const payload = JSON.stringify(await signVoucher(row));
      await client.query("UPDATE vouchers SET status='signed', signed_payload=$2 WHERE id=$1", [row.id, payload]);
      outstanding += Number(row.amount); signed++;
    }
    await client.query('COMMIT');
    return { signed };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// Mod/ops mirror an on-chain tranche funding into the reserve, then drain the queue.
export async function fundReserve(pool, amount) {
  const amt = Number(amount);
  if (!(amt > 0)) throw new GameError('amount', 'Positive amounts only.');
  await pool.query('UPDATE chain_reserve SET funded_omr = funded_omr + $1, last_funded_at = now() WHERE id=1', [amt]);
  return drainQueue(pool);
}

export async function reserveStatus(pool) {
  const res = (await pool.query('SELECT * FROM chain_reserve WHERE id=1')).rows[0];
  const signed = Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM vouchers WHERE kind='omr' AND status='signed' AND NOT claimed_onchain")).rows[0].s);
  const queued = Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM vouchers WHERE kind='omr' AND status='queued'")).rows[0].s);
  const funded = Number(res.funded_omr);
  return { fundedOmr: funded, signedOutstanding: signed, queuedOmr: queued,
    available: Math.max(0, funded - signed), reserveRatio: signed > 0 ? funded / signed : null };
}

// The Claimed(nonce,…) watcher marks a voucher claimed and frees its reserve. Needs a
// live RPC (CHAIN_RPC_URL) — started by the worker; markClaimed is the unit-testable core.
export async function markClaimed(pool, nonce) {
  const r = await pool.query("UPDATE vouchers SET claimed_onchain=true, status='claimed' WHERE nonce=$1 AND NOT claimed_onchain RETURNING id", [nonce]);
  return { claimed: r.rowCount };
}

// ── SIWE wallet link (§4, EVM) — proves the player controls the address ──
export async function walletChallenge(pool, accountId) {
  const nonce = crypto.randomBytes(16).toString('hex');
  await pool.query(
    `INSERT INTO wallet_challenges (account_id, nonce, issued_at) VALUES ($1,$2,now())
       ON CONFLICT (account_id) DO UPDATE SET nonce=$2, issued_at=now()`, [accountId, nonce]);
  const message = `OMERTÀ wallet link\naccount: ${accountId}\nnonce: ${nonce}`;
  return { message };
}
export async function walletVerify(pool, accountId, address, signature) {
  if (!isAddress(address)) throw new GameError('bad_address', 'Not a valid EVM address.');
  const ch = (await pool.query('SELECT nonce, issued_at FROM wallet_challenges WHERE account_id=$1', [accountId])).rows[0];
  if (!ch) throw new GameError('no_challenge', 'Request a challenge first.');
  if (Date.now() - new Date(ch.issued_at).getTime() > 10 * 60 * 1000) throw new GameError('expired', 'Challenge expired — request a new one.');
  const message = `OMERTÀ wallet link\naccount: ${accountId}\nnonce: ${ch.nonce}`;
  let ok = false;
  try { ok = await verifyMessage({ address: getAddress(address), message, signature }); }
  catch { ok = false; } // a malformed signature must be a clean rejection, not a 500
  if (!ok) throw new GameError('bad_signature', 'Signature does not match that address.');
  const addr = getAddress(address);
  const taken = (await pool.query('SELECT account_id FROM account_persistent WHERE wallet_address=$1 AND account_id<>$2', [addr, accountId])).rows[0];
  if (taken) throw new GameError('wallet_taken', 'That wallet is already linked to another account.');
  await pool.query('UPDATE account_persistent SET wallet_address=$2 WHERE account_id=$1', [accountId, addr]);
  await pool.query('DELETE FROM wallet_challenges WHERE account_id=$1', [accountId]);
  return { ok: true, wallet: addr, verified: true };
}

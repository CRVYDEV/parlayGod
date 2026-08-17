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
import { hashTypedData, recoverTypedDataAddress, parseUnits, isAddress, getAddress, verifyMessage, encodeFunctionData, keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { GameError, ledger } from './game.js';
import { reconcileFees } from './fees.js';
import { reconcileStore } from './store.js';
import { reconcileBonds } from './bonds.js';
import { portraitRow } from './portrait.js'; // the freeze snapshot (portrait.js is a leaf — no cycle)

const uid = () => crypto.randomUUID();
const round6 = (x) => Math.round(Number(x) * 1e6) / 1e6;

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
// A signed-but-unclaimed voucher whose deadline passed THIS long ago can never be claimed on-chain
// (the contract requires block.timestamp ≤ deadline) and any valid claim is already processed by the
// watcher — so it's safe to reverse. Must exceed the watcher's confirmation lag (CHAIN_CONFIRMATIONS
// × block time + poll interval) so a claim landing right at the deadline can't be both claimed AND
// reclaimed. 1h default is generously past any realistic lag.
const RECLAIM_GRACE_SEC = Number(process.env.VOUCHER_RECLAIM_GRACE_SEC || 3600);

// ── WHICH CONTRACT OWNS A VOUCHER ROW (red-team HIGH, 2026-08-16) ────────────────────────────────
// `vouchers` is shared by TWO contracts with INDEPENDENT nonce spaces: VoucherClaim signs 'omr' /
// 'gear' / 'car' / 'boat'; StreetDeed signs 'deed'. Anything that resolves a voucher by asking a
// chain whether its nonce was used MUST first know which chain to ask — a deed nonce read against
// VoucherClaim answers `false` every time, which is indistinguishable from "the player never
// claimed it" and is how a signed deed voucher got expired out from under `sweepDeedVouchers` (the
// one function that reads the right contract), leaving the street inert, unsellable and un-re-
// extractable forever, and blocking its owner from ever claiming another.
//
// An ALLOWLIST, deliberately, not `kind <> 'deed'`: the denylist fixes today and re-opens the moment
// a third contract shares this table, which is the forgotten-gate class this codebase keeps paying
// for. A kind nobody claims is SKIPPED and logged — an unrecognised voucher is somebody else's to
// resolve, and the fail-closed direction is to leave it alone.
export const VOUCHER_CLAIM_KINDS = ['omr', 'gear', 'car', 'boat'];

// Chain config from env (never hardcode chainId — see the F-3 audit note).
export function chainConfig() {
  // AUDIT (chain trust lens F1 + OMR lens F-5): NO defaults. A chainId or verifyingContract that
  // silently defaults to testnet/zero signs vouchers under the WRONG EIP-712 domain — every on-chain
  // claim then reverts (`VC: bad signature`) while the backend has already burned the $OMR, a total
  // (fail-closed-for-funds but invisible) withdrawal outage. Fail hard instead: no chain config, no
  // signing (parity with signerAccount()'s chain_unconfigured throw).
  const chainId = Number(process.env.CHAIN_ID);
  const verifyingContract = process.env.VOUCHER_CLAIM_ADDRESS;
  if (!chainId || !verifyingContract || !isAddress(verifyingContract))
    throw new GameError('chain_unconfigured', 'Withdrawals are not enabled on this server yet (chain config missing).');
  return { name: 'OmertaVoucherClaim', version: '1', chainId, verifyingContract: getAddress(verifyingContract) };
}

// AUDIT CRITICAL (reclaim-vs-claim double-spend): an authoritative reader of the contract's
// `usedNonce(nonce)` — the on-chain truth for "was this voucher already claimed?". reclaim consults
// this before reversing a voucher so a real claim the watcher hasn't yet processed can never be
// refunded. Returns null when the chain is unconfigured (dormant → no real vouchers exist, callers
// fall back to the wall-clock grace). Kept dependency-light; built per-call so tests can inject.
export async function makeChainReader() {
  if (!process.env.CHAIN_RPC_URL || !process.env.VOUCHER_CLAIM_ADDRESS || !isAddress(process.env.VOUCHER_CLAIM_ADDRESS)) return null;
  const { createPublicClient, http } = await import('viem');
  const client = createPublicClient({ transport: http(process.env.CHAIN_RPC_URL) });
  // WRONG-CHAIN GUARD (red-team R1): reclaim runs OUTSIDE the worker's assertChainId gate, and a voucher
  // genuinely claimed on chain X (whose Claimed event the sync couldn't record) must NEVER be refunded by
  // trusting a usedNonce()=false answer from a SAME-ADDRESS contract on a DIFFERENT chain Y (a colliding
  // deploy) — that is a chain-boundary double-spend the ledger can't see. So if CHAIN_ID is set, the reader
  // MUST be on that chain; otherwise fail CLOSED (return null → reclaim skips, never refunds blind — the
  // existing null-reader fail-safe). assertChainId's intent, applied to the reader itself.
  if (process.env.CHAIN_ID) {
    try {
      const rpcChainId = Number(await client.getChainId());
      if (Number(process.env.CHAIN_ID) !== rpcChainId) return null;
    } catch { return null; } // can't confirm the chain → don't trust any usedNonce answer from it
  }
  const address = getAddress(process.env.VOUCHER_CLAIM_ADDRESS);
  const abi = [{ type: 'function', name: 'usedNonce', stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }];
  return { usedNonce: (nonce) => client.readContract({ address, abi, functionName: 'usedNonce', args: [BigInt(nonce)] }) };
}
// THE PRICE THE CHAIN WILL JUDGE THE QUOTE BY (tokenomics v2 step 4, WALL 4). `OmertaBond.bond()`
// now refuses any quote whose claimed market price sits above its own TWAP oracle plus tolerance —
// so a server that signs blind against its OWN feed (the Vig buyback TWAP) has every honest quote
// revert the moment the two drift apart, and looks perfectly healthy while doing it. Reading the
// contract's `priceCeiling()` is what makes the two agree BY CONSTRUCTION rather than by luck.
// Returns null when the bond chain is dormant or unreachable — the caller then signs at its own
// price, which is exactly right, because with no chain there is no wall to disagree with.
export async function makeBondPriceReader() {
  if (!process.env.CHAIN_RPC_URL || !process.env.OMERTA_BOND_ADDRESS || !isAddress(process.env.OMERTA_BOND_ADDRESS)) return null;
  const { createPublicClient, http } = await import('viem');
  const client = createPublicClient({ transport: http(process.env.CHAIN_RPC_URL) });
  // the wrong-chain guard, same reasoning as makeChainReader: a ceiling read off a colliding deploy
  // on another chain is worse than no ceiling, because it looks authoritative.
  if (process.env.CHAIN_ID) {
    try { if (Number(process.env.CHAIN_ID) !== Number(await client.getChainId())) return null; } catch { return null; }
  }
  const address = getAddress(process.env.OMERTA_BOND_ADDRESS);
  const abi = [{ type: 'function', name: 'priceCeiling', stateMutability: 'view', inputs: [],
    outputs: [{ name: 'ceiling', type: 'uint256' }, { name: 'oraclePrice', type: 'uint256' }] }];
  return {
    ceiling: async () => {
      // A reverting priceCeiling() means the oracle is unset/stale/broken — i.e. the chain is
      // currently refusing every bond. Surface that as null so the caller can say so plainly
      // instead of signing a quote that is guaranteed to revert.
      const [ceiling, oraclePrice] = await client.readContract({ address, abi, functionName: 'priceCeiling' });
      return { ceiling: Number(ceiling) / 1e18, oraclePrice: Number(oraclePrice) / 1e18 };
    },
  };
}
function signerAccount() {
  const pk = process.env.VOUCHER_SIGNER_PK;
  if (!pk) throw new GameError('chain_unconfigured', 'Withdrawals are not enabled on this server yet.');
  return privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
}

// AUDIT (deploy hardening): assert the configured CHAIN_ID matches the RPC's ACTUAL chain at boot. A
// wrong-but-nonzero CHAIN_ID silently signs every voucher under the wrong EIP-712 domain → all on-chain
// claims revert while the backend has already burned the $OMR (a fail-closed-for-funds but INVISIBLE
// withdrawal outage). Better to refuse to boot the chain service than to sign dead vouchers. Dormant
// (no RPC) → nothing to check. Called from the worker's chain startup.
export async function assertChainId() {
  if (!process.env.CHAIN_RPC_URL || !process.env.CHAIN_ID) return;
  const { createPublicClient, http } = await import('viem');
  const client = createPublicClient({ transport: http(process.env.CHAIN_RPC_URL) });
  const rpcChainId = Number(await client.getChainId());
  if (Number(process.env.CHAIN_ID) !== rpcChainId)
    throw new Error(`CHAIN_ID mismatch: env CHAIN_ID=${process.env.CHAIN_ID} but the RPC reports ${rpcChainId} — refusing to sign vouchers under the wrong EIP-712 domain (they would all revert on-chain while $OMR is burned).`);
  return rpcChainId;
}

// Build the on-chain voucher tuple (amount in wei) from a stored row.
function toVoucherMessage(row) {
  return {
    to: getAddress(row.to_address),
    amount: row.kind === 'omr' ? parseUnits(String(row.amount), 18) : BigInt(row.amount),
    kind: row.kind === 'omr' ? KIND_OMR : KIND_GEAR,
    // v3 step 7: a car/boat voucher is an NFT voucher like gear's — only the tokenId space differs.
    // `gear_id` stores the compound key `<kind>:<catalogId>:<rarity>` so the row is self-describing
    // and the id is DERIVED here rather than trusted from the DB (a stored number could drift from
    // the rarity the row actually has, and would then mint the wrong token).
    gearId: row.kind === 'gear' ? BigInt(gearNumId(row.gear_id))
      : (row.kind === 'car' || row.kind === 'boat') ? BigInt(itemTokenId(row.gear_id)) : 0n,
    nonce: BigInt(row.nonce),
    deadline: BigInt(row.deadline),
  };
}
// Gear class id → on-chain uint256. The game's gear are string ids (MARKET table); the
// on-chain tokenId is their 1-based index (matches "one tokenId per gear class").
import { MARKET, BONDS, bondPayout, TAX, withdrawTaxBps, nftTokenId, nftDecode, dayOf, DISTRICTS } from './rules.js';
import { earlySurcharge, creditTollBuckets, splitToll } from './tax.js';
import { nftKind } from './nft.js';
// A car/boat voucher stores `<kind>:<catalogId>:<rarity>:<itemId>` in `gear_id` (no schema change).
// The tokenId is DERIVED from the first three — never stored as a number, which would let a row
// drift from the rarity it claims and mint the wrong token. The fourth field is what the reclaim
// needs to find the exact row again, and it must be last: an item id is a UUID, so anything that
// split on ':' from the right would still work, but reading left-to-right keeps the id opaque.
export function itemKeyParts(key) {
  const [kind, catalogId, rarity, itemId] = String(key || '').split(':');
  if (!kind || !catalogId || !rarity) throw new GameError('bad_item', 'Malformed item key.');
  return { kind, catalogId, rarity, itemId };
}
export function itemTokenId(key) {
  const { kind, catalogId, rarity } = itemKeyParts(key);
  return nftTokenId(kind, catalogId, rarity);
}
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
// unclaimed signed $OMR — a DISPLAY metric only (how much is signed-but-not-yet-claimed).
async function signedOutstanding(client) {
  return Number((await client.query(
    "SELECT COALESCE(SUM(amount),0) s FROM vouchers WHERE kind='omr' AND status='signed' AND NOT claimed_onchain")).rows[0].s);
}
// The GATE quantity: cumulative $OMR ever committed to leave the reserve = signed (will be claimed)
// PLUS already-claimed. funded_omr is cumulative-ever-funded and is NEVER decremented, so the honest
// full-reserve rule is committed-ever ≤ funded — a CLAIM must NOT free signing room (the tokens
// physically left the tranche; only a fresh fundReserve opens more). Counting only unclaimed here
// let cumulative signed exceed cumulative funded once a voucher was claimed → extraction > inflow.
async function committedOutstanding(client) {
  return Number((await client.query(
    "SELECT COALESCE(SUM(amount),0) s FROM vouchers WHERE kind='omr' AND (status='signed' OR claimed_onchain)")).rows[0].s);
}

// ── OMR withdrawal (full-reserve queue) ──
export async function requestWithdraw(pool, accountId, amount, toAddress) {
  const amt = Math.floor(Number(amount) * 1e6) / 1e6;          // clamp to the ledger's 6-dp precision
  if (!(amt > 0)) throw new GameError('amount', 'Positive amounts only.');
  // THE EXIT TOLL (founder-directed): every withdrawal pays a tax that splits DEV revenue + the
  // community buyback/yield pool (stake_pool — the same pool the 12h buyback funds). The player is
  // debited the GROSS; the voucher signs the NET; the toll is NON-refundable (a cancelled queued
  // withdrawal refunds the net only — the toll was paid at the gate). Rate read per-call (ops lever).
  const flo6 = (x) => Math.floor(x * 1e6) / 1e6;
  const taxBps = withdrawTaxBps();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const acct = (await client.query('SELECT * FROM account_persistent WHERE account_id=$1 FOR UPDATE', [accountId])).rows[0];
    if (!acct) throw new GameError('no_account', 'No such account.');
    if (!acct.minted) throw new GameError('not_minted', 'Only a made account can cash out — pay the 0.01 ETH mint fee first.');
    const to = toAddress || acct.wallet_address;
    if (!to || !isAddress(to)) throw new GameError('wallet', 'Link a wallet (SIWE) or pass a valid address first.');
    if (Number(acct.omr) < amt) throw new GameError('omr', 'Not that much $OMR.');

    // the flat exit toll + THE EARLY-EXIT SURCHARGE (anti-dump): $OMR younger than the fresh
    // window pays a linearly-decaying extra toll (50% at age 0 → 0 at 48h, no exemptions),
    // priced from the ledger's own credit timestamps (src/tax.js). Both tolls split half dev /
    // half the buyback/yield pool and are NON-refundable (paid at the gate).
    const flat = flo6(amt * taxBps / 10000);
    const early = await earlySurcharge(client, accountId, Number(acct.omr), amt);
    const tax = flo6(flat + early.surcharge);
    const { devCut, buyCut } = splitToll(tax);
    // ROUND (not floor) the difference of 6-dp numbers — flooring loses a 1e-6 crumb to nowhere
    const net = Math.round((amt - devCut - buyCut) * 1e6) / 1e6;
    if (!(net > 0)) throw new GameError('min', 'That withdrawal is all toll — hold the fresh $OMR longer or withdraw more.');
    // AUDIT (OMR lens F-1): reject any single withdrawal whose NET exceeds the on-chain per-UTC-day
    // cap — otherwise the backend burns the $OMR and signs a voucher whose `claim()` reverts "VC:
    // daily cap" on EVERY day forever, stranding the player until reclaim. DAILY_CAP_OMR is the
    // wei-denominated env the deploy uses; unset = unlimited (contract cap 0).
    const capWei = process.env.DAILY_CAP_OMR;
    if (capWei && Number(capWei) > 0 && net > Number(capWei) / 1e18)
      throw new GameError('daily_cap', `A single withdrawal can't exceed the daily cap of ${Math.floor(Number(capWei) / 1e18)} $OMR — split it across days.`);

    // debit the in-game ledger NOW so the balance can't be double-spent while queued.
    // §10.4 shape: the NET is the burn (it leaves the game on-chain); the toll is two TRANSFERS —
    // tax:dev → the dev_fund bucket, tax:buyback → family_yield_pool (both inside omrBuckets, so
    // conservation nets 0; 'tax:' sits in the vocabulary in neither the mint nor the burn term).
    await client.query('UPDATE account_persistent SET omr = omr - $2 WHERE account_id=$1', [accountId, amt]);
    await ledger(client, { accountId, currency: 'omr', amount: -net, reason: 'withdraw:omr' }); // legal §10.4 burn (leaves the game)
    if (devCut > 0) await ledger(client, { accountId, currency: 'omr', amount: -devCut, reason: 'tax:dev' });
    if (buyCut > 0) await ledger(client, { accountId, currency: 'omr', amount: -buyCut, reason: 'tax:buyback' });
    await creditTollBuckets(client, devCut, buyCut);

    const res = (await client.query('SELECT * FROM chain_reserve WHERE id=1 FOR UPDATE')).rows[0];
    const nonce = Number(res.next_nonce);
    await client.query('UPDATE chain_reserve SET next_nonce = next_nonce + 1 WHERE id=1');
    const deadline = Math.floor(Date.now() / 1000) + WITHDRAW_TTL_SEC;

    const outstanding = await committedOutstanding(client); // committed-ever, not just unclaimed
    const fits = outstanding + net <= Number(res.funded_omr);
    const id = uid();
    const row = { id, account_id: accountId, kind: 'omr', amount: net, gear_id: null, nonce, to_address: getAddress(to), deadline };
    let payload = null, status = 'queued';
    if (fits) { payload = JSON.stringify(await signVoucher(row)); status = 'signed'; }
    await client.query(
      'INSERT INTO vouchers (id, account_id, kind, amount, nonce, to_address, deadline, status, signed_payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, accountId, 'omr', net, nonce, getAddress(to), deadline, status, payload]);
    await client.query('COMMIT');
    return { id, nonce, status, amount: net, gross: amt, tax, earlyTax: early.surcharge, freshSold: early.freshSold, net, ...(payload ? JSON.parse(payload) : {}),
      queuedReason: fits ? undefined : 'reserve_insufficient' };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// Cancel a still-QUEUED $OMR withdrawal and refund the burned $OMR (audit LOW: a queued voucher
// debits $OMR but has no reclaim path — reclaimExpiredVouchers only reverses SIGNED-past-deadline
// vouchers — so if the reserve never funds to the FIFO position, the player's $OMR is stuck). SAFE
// because a queued voucher was NEVER signed → no on-chain claim can exist → no double-spend. Locks
// account → chain_reserve (requestWithdraw's order; serializes with drainQueue on the reserve
// singleton so a concurrent sign and this cancel can't both resolve the same voucher).
export async function cancelQueuedWithdraw(pool, accountId, voucherId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const acct = (await client.query('SELECT omr FROM account_persistent WHERE account_id=$1 FOR UPDATE', [accountId])).rows[0];
    if (!acct) throw new GameError('no_account', 'No such account.');
    await client.query('SELECT id FROM chain_reserve WHERE id=1 FOR UPDATE'); // serialize with drainQueue
    const v = (await client.query('SELECT * FROM vouchers WHERE id=$1 AND account_id=$2', [voucherId, accountId])).rows[0];
    if (!v) throw new GameError('no_voucher', 'No such withdrawal on your account.');
    if (v.kind !== 'omr') throw new GameError('not_omr', 'Only a queued $OMR withdrawal can be cancelled here.');
    if (v.status !== 'queued') throw new GameError('not_queued', 'Only an unsigned (queued) withdrawal can be cancelled — a signed voucher may already be claimable on-chain.');
    // reverse the burn (net 0): +withdraw:omr credits the $OMR back — the reclaimExpiredVouchers pattern
    await client.query('UPDATE account_persistent SET omr = omr + $2 WHERE account_id=$1', [accountId, Number(v.amount)]);
    await ledger(client, { accountId, currency: 'omr', amount: Number(v.amount), reason: 'withdraw:omr' });
    await client.query("UPDATE vouchers SET status='cancelled' WHERE id=$1", [voucherId]);
    await client.query('COMMIT');
    return { cancelled: true, refunded: Number(v.amount) };
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
    if (!acct?.minted) throw new GameError('not_minted', 'Only a made account can take gear on-chain — pay the 0.01 ETH mint fee first.');
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

// ── THE RARITY NFTs (v3 step 7): extracting a car or a boat ──────────────────────────────────
// The gear rail, applied to property. Not reserve-bounded for the same reason gear isn't: supply is
// capped ON-CHAIN per tokenId, so the wall is GearVault's `cap` rather than a funded tranche.
//
// The trade, stated once because it is the mechanic: the item LEAVES PLAY. It stops racing, hauling,
// melting and being stolen, and in exchange it stops dying with the street. Nothing here reverses
// that — there is no un-extract route, exactly as there is none for gear, because the token exists
// in the player's own wallet the moment they claim it and the game cannot take it back.
export async function requestItemWithdraw(pool, accountId, kind, itemId, toAddress) {
  const k = nftKind(kind);
  if (!k) throw new GameError('bad_kind', 'Nothing of that sort to take on-chain.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const acct = (await client.query('SELECT * FROM account_persistent WHERE account_id=$1 FOR UPDATE', [accountId])).rows[0];
    if (!acct?.minted) throw new GameError('not_minted', 'Only a made account can take property on-chain — pay the 0.01 ETH mint fee first.');
    const to = toAddress || acct?.wallet_address;
    if (!to || !isAddress(to)) throw new GameError('wallet', 'Link a wallet (SIWE) or pass a valid address first.');
    // Two flat queries rather than a locking JOIN: `FOR UPDATE OF` is not parseable by pg-mem (the
    // /v1/gangs precedent), and the lock we need is on the ITEM row anyway. Order is
    // account_persistent (held above) -> the leaf item row, so nothing new enters the lock graph.
    const row = (await client.query(`SELECT * FROM ${k.table} WHERE id=$1 FOR UPDATE`, [String(itemId || '')])).rows[0];
    const holder = row && (await client.query(
      'SELECT 1 FROM characters WHERE id=$1 AND account_id=$2 AND alive', [row.character_id, accountId])).rows[0];
    // Ownership is checked through the account's LIVING character, so an heir cannot extract the
    // property of a street that is already dead (those rows were either destroyed by the estate or
    // re-pointed at the heir, in which case this finds them under the heir's own id).
    if (!row || !holder) throw new GameError('not_yours', "That isn't yours.");
    if (row.minted_onchain) throw new GameError('already', "It's already on-chain.");
    // an escrowed/at-sea item still has an obligation attached — extracting would strand a live bid,
    // a lender's collateral or a cargo run.
    const blocked = k.esc(row);
    if (blocked) throw new GameError('busy', blocked);
    const tokenKey = `${kind}:${k.catalog(row)}:${String(row.rarity || 'common')}:${row.id}`;
    itemTokenId(tokenKey); // fail closed BEFORE anything is written if the class is unknown
    await client.query(`UPDATE ${k.table} SET minted_onchain=true, ${k.clear} WHERE id=$1`, [row.id]);

    const res = (await client.query('SELECT * FROM chain_reserve WHERE id=1 FOR UPDATE')).rows[0];
    const nonce = Number(res.next_nonce);
    await client.query('UPDATE chain_reserve SET next_nonce = next_nonce + 1 WHERE id=1');
    const deadline = Math.floor(Date.now() / 1000) + WITHDRAW_TTL_SEC;
    const id = uid();
    const vrow = { id, account_id: accountId, kind, amount: 1, gear_id: tokenKey, nonce, to_address: getAddress(to), deadline };
    const payload = JSON.stringify(await signVoucher(vrow)); // signs immediately — the contract caps supply
    await client.query(
      'INSERT INTO vouchers (id, account_id, kind, amount, gear_id, nonce, to_address, deadline, status, signed_payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, accountId, kind, 1, tokenKey, nonce, getAddress(to), deadline, 'signed', payload]);
    await client.query('COMMIT');
    return { id, nonce, status: 'signed', kind, itemId: row.id, name: k.label(row),
      rarity: String(row.rarity || 'common'), tokenId: itemTokenId(tokenKey), ...JSON.parse(payload) };
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
    let outstanding = await committedOutstanding(client); // committed-ever gate (see requestWithdraw)
    const queued = (await client.query("SELECT * FROM vouchers WHERE kind='omr' AND status='queued' ORDER BY created_at, nonce")).rows;
    for (const row of queued) {
      if (outstanding + Number(row.amount) > Number(res.funded_omr)) break; // FIFO stops at the reserve edge
      // recompute the deadline at SIGN time — a voucher may have sat queued past its original 24h TTL,
      // and the contract rejects an already-expired voucher (the in-game $OMR is already burned).
      const freshDeadline = Math.floor(Date.now() / 1000) + WITHDRAW_TTL_SEC;
      const payload = JSON.stringify(await signVoucher({ ...row, deadline: freshDeadline }));
      await client.query("UPDATE vouchers SET status='signed', signed_payload=$2, deadline=$3 WHERE id=$1", [row.id, payload, freshDeadline]);
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
  // (red-team R15 L1) reject Infinity/NaN too, not just <=0 — `Number(Infinity) > 0` would otherwise set
  // funded_omr to Infinity. Mod-gated + out-of-band chain bucket, but parity with the player-facing
  // finite-guards (vanity spendOmr / swap / bank) is cheap and closes the footgun.
  if (!Number.isFinite(amt) || !(amt > 0)) throw new GameError('amount', 'Positive amounts only.');
  await pool.query('UPDATE chain_reserve SET funded_omr = funded_omr + $1, last_funded_at = now() WHERE id=1', [amt]);
  return drainQueue(pool);
}

export async function reserveStatus(pool) {
  const res = (await pool.query('SELECT * FROM chain_reserve WHERE id=1')).rows[0];
  const signed = Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM vouchers WHERE kind='omr' AND status='signed' AND NOT claimed_onchain")).rows[0].s);
  const committed = Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM vouchers WHERE kind='omr' AND (status='signed' OR claimed_onchain)")).rows[0].s);
  const queued = Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM vouchers WHERE kind='omr' AND status='queued'")).rows[0].s);
  const funded = Number(res.funded_omr);
  // `signedOutstanding` (unclaimed) is a display metric; `available` is funded − committed-EVER,
  // since a claim never re-opens signing room (the honest full-reserve model).
  return { fundedOmr: funded, signedOutstanding: signed, committedOutstanding: committed, queuedOmr: queued,
    available: Math.max(0, funded - committed), reserveRatio: committed > 0 ? funded / committed : null };
}

// The Claimed(nonce,…) watcher marks a voucher claimed. NB: a claim does NOT free signing room
// (committed-ever ≤ funded is the honest model — the tokens physically left the tranche); it only
// records that the withdrawal completed. The `status` exclusions guard the impossible race where a
// voucher was already refunded — 'expired' (reclaim-and-refund) OR 'cancelled' (queued-then-cancel,
// its burn reversed) — and a stale/mistaken Claimed mark then arrives (grace window makes it
// impossible for a real signed voucher; the exclusion keeps the refund as the record of truth so a
// refunded amount can never re-enter committedOutstanding). `NOT claimed_onchain` already covers a
// double 'claimed'. (red-team R10 L1: 'cancelled' added — a cancelled voucher was never signed, so
// the watcher can't reach it, but the mod /reserve/claimed route could, and marking it would shrink
// `available` by re-committing a refunded amount.) Unit-testable core.
export async function markClaimed(pool, nonce) {
  // (red-team R19 F2) POSITIVE guard: only a SIGNED voucher can be claimed. A real Claimed event names a
  // signed voucher (an on-chain claim() needs a valid signature), and the reclaim path calls this only on
  // a status='signed' row — so 'signed' covers every legitimate caller. The old exclusion-guard
  // (status<>'expired' AND <>'cancelled') let the mod /reserve/claimed route flip a QUEUED (never-signed)
  // voucher to claimed on an operator typo → its burned $OMR permanently stranded (drainQueue/cancel both
  // require status='queued'). 'signed' also gives idempotency (a re-claim finds status='claimed'≠'signed').
  // …and only over VoucherClaim's OWN kinds: this is reached by its `Claimed` watcher and by the mod
  // /reserve/claimed route, and a deed nonce typed into that route would flip a signed deed voucher to
  // 'claimed' — after which sweepDeedVouchers (which selects status='signed') skips it and the street is
  // bricked exactly as the reclaim used to brick it. A deed claim has its own watcher (markDeedExtracted).
  const r = await pool.query(
    `UPDATE vouchers SET claimed_onchain=true, status='claimed' WHERE nonce=$1 AND status='signed' AND kind = ANY($2) RETURNING id`,
    [nonce, VOUCHER_CLAIM_KINDS]);
  // AUDIT detector (reserve lens F4): a real Claimed event for a voucher we ALREADY refunded (expired or
  // cancelled) is the exact double-resolution the reserve model forbids (the player would hold the tokens
  // AND the refunded $OMR). With the reclaim on-chain check below this should be impossible; if it ever
  // fires it is a §10.4 breach at the chain boundary that the ledger sweep is blind to — so alarm LOUDLY.
  if (r.rowCount === 0) {
    const ex = (await pool.query('SELECT status FROM vouchers WHERE nonce=$1', [nonce])).rows[0];
    if (ex && (ex.status === 'expired' || ex.status === 'cancelled'))
      console.error(`🚨 §10.4 CHAIN-BOUNDARY ALARM: Claimed(${nonce}) arrived for an already-${ex.status.toUpperCase()} (refunded) voucher — double-resolution`);
  }
  return { claimed: r.rowCount };
}

// Reverse expired-unclaimed vouchers (audit MED-1/MED-2). A signed voucher past `deadline + grace`
// can never land on-chain, yet: an OMR voucher's $OMR was already BURNED (withdraw:omr) and its
// amount permanently consumed `committedOutstanding` (funded_omr never decrements) — stranding both
// the player's tokens AND honest withdrawers' reserve room; a gear voucher optimistically flipped
// `minted_onchain` (removing the gear from play, loot-immune + unusable) with no path back. So:
//   • OMR  → refund the $OMR (a +withdraw:omr row exactly reverses the burn: net 0, §10.4 exact),
//            and status='expired' drops it out of committedOutstanding → the reserve room frees.
//   • gear → restore `minted_onchain=false` (back into play), status='expired'.
// Per-voucher txn, re-checked under lock (the watcher may have claimed it since the read).
export async function reclaimExpiredVouchers(pool, reader = undefined) {
  // AUDIT CRITICAL: the wall-clock `deadline + grace` is NOT proof the watcher saw a claim — if the
  // watcher/RPC stalled past the grace while a real claim landed, refunding here double-spends (tokens
  // on-chain AND $OMR back), and §10.4 is blind to it (both rows net to zero). So consult the chain
  // DIRECTLY: `usedNonce(nonce)` is the on-chain truth. reader===undefined → build from env; null (RPC
  // unset/down/wrong-chain) → FAIL CLOSED: skip every expired voucher, never refund on the wall clock
  // (see the F1 note below — no reader is NOT proof the chain is dormant). An RPC error → likewise SKIP
  // this voucher (fail safe: a delayed refund is recoverable, a double-spend is not).
  const chain = reader !== undefined ? reader : await makeChainReader();
  const client = await pool.connect();
  let omrReclaimed = 0, gearRestored = 0, reconciled = 0, skipped = 0;
  try {
    const cutoff = Math.floor(Date.now() / 1000) - RECLAIM_GRACE_SEC;
    // VoucherClaim's kinds only — `chain` below is VoucherClaim's reader, and a nonce from another
    // contract's space reads `false` there whatever really happened on-chain (see VOUCHER_CLAIM_KINDS).
    const expired = (await client.query(
      `SELECT id, account_id, kind, amount, gear_id, nonce FROM vouchers
        WHERE status='signed' AND NOT claimed_onchain AND deadline < $1 AND kind = ANY($2)`, [cutoff, VOUCHER_CLAIM_KINDS])).rows;
    // AUDIT (full-system v3, chain lens F1): a `signed` voucher exists ONLY because the chain was
    // configured enough to sign it (chainConfig + signer) — signing does NOT require CHAIN_RPC_URL,
    // but the on-chain reader DOES. So "no reader" is NOT proof the chain is dormant: it can mean a
    // signing-enabled box whose RPC is unset/down, where the voucher may ALREADY be claimed on-chain.
    // Refunding on the wall clock there double-spends (tokens on-chain AND $OMR back), invisibly to
    // §10.4. So WITHOUT a reader we NEVER refund — we skip and retry (a delayed refund is recoverable,
    // a double-spend is not; the same fail-safe the RPC-error branch already uses). A genuinely
    // torn-down chain's stuck vouchers are a manual/mod reconciliation, not a blind auto-refund.
    if (!chain && expired.length)
      console.error(`reclaim: ${expired.length} expired voucher(s) but no on-chain reader (CHAIN_RPC_URL unset/down) — skipping to avoid a blind refund; set the RPC so usedNonce can confirm before refunding`);
    for (const v of expired) {
      // ask the chain first — a used nonce means this voucher WAS claimed (tokens left the tranche);
      // record the claim the watcher missed and NEVER refund it. NO reader → skip (never refund blind).
      if (!chain) { skipped++; continue; }
      let used;
      try { used = await chain.usedNonce(v.nonce); }
      catch { continue; } // RPC hiccup — retry next tick, never refund blind
      if (used) { await markClaimed(pool, Number(v.nonce)); reconciled++; continue; }
      await client.query('BEGIN');
      try {
        const cur = (await client.query("SELECT status, claimed_onchain FROM vouchers WHERE id=$1 FOR UPDATE", [v.id])).rows[0];
        if (!cur || cur.status !== 'signed' || cur.claimed_onchain) { await client.query('ROLLBACK'); continue; }
        if (v.kind === 'omr') {
          await client.query('SELECT 1 FROM account_persistent WHERE account_id=$1 FOR UPDATE', [v.account_id]);
          await client.query('UPDATE account_persistent SET omr = omr + $2 WHERE account_id=$1', [v.account_id, Number(v.amount)]);
          await ledger(client, { accountId: v.account_id, currency: 'omr', amount: Number(v.amount), reason: 'withdraw:omr' }); // reverses the burn (net 0)
          omrReclaimed += Number(v.amount);
        } else if (v.kind === 'car' || v.kind === 'boat') {
          const { itemId } = itemKeyParts(v.gear_id);
          // by ID, not by owner: the street that extracted it may have died since, in which case the
          // row is the heir's now (extracted property follows the bloodline — runEstate).
          await client.query(`UPDATE ${v.kind === 'car' ? 'cars' : 'boats'} SET minted_onchain=false WHERE id=$1`, [itemId]);
          gearRestored++;
        } else if (v.kind === 'gear') {
          await client.query('UPDATE account_gear SET minted_onchain=false WHERE account_id=$1 AND gear_id=$2', [v.account_id, v.gear_id]);
          gearRestored++;
        } else {
          // BELT AND BRACES on the allowlist above. This used to be a bare `else`, and that is exactly
          // how a 'deed' row got here: it ran a no-op UPDATE against account_gear, counted itself as a
          // restored piece of gear, and expired a voucher belonging to another contract. Never expire
          // what we did not recognise — leave the row for whoever owns it and say so out loud.
          await client.query('ROLLBACK');
          console.error(`reclaim: voucher ${v.id} has unrecognised kind '${v.kind}' — skipped (add it to VOUCHER_CLAIM_KINDS or give it its own sweep)`);
          skipped++;
          continue;
        }
        await client.query("UPDATE vouchers SET status='expired' WHERE id=$1", [v.id]);
        await client.query('COMMIT');
      // AUDIT (reserve lens F3): isolate per voucher — a single poison row must NOT abort the whole
      // batch (matches the worker's safe() philosophy). Log + skip; each refund is already its own txn.
      } catch (e) { await client.query('ROLLBACK'); console.error('reclaim voucher failed', v.id, e?.code || e?.message || e); continue; }
    }
    return { omrReclaimed, gearRestored, reconciled, skipped };
  } finally { client.release(); }
}

// ── NFT RE-IMPORT (Option A, omerta-nft-reimport-design.md): a burned car/boat NFT re-created in-game ──
// The inverse of requestItemWithdraw. Extraction flags `minted_onchain=true` on the ORIGINAL row and
// mints the token; re-import BURNS the token (GearVault.redeem, on-chain) and re-creates a FRESH live
// row on whoever burned it. It creates a NEW row (never un-flags an existing one) because the burner is
// usually a DIFFERENT account — a buyer on a secondary market — and un-flagging the original extractor's
// row would double-count (their flagged row stays inert, follows their bloodline, and can never be
// re-imported since they no longer hold the token). §10.4-NEUTRAL: a car/boat is ownership, conserved by
// ROW COUNT, never a currency — this writes ZERO ledger rows (each burned token is a −1 matched by a +1
// row). Trim/tune/damage are NOT encoded in the tokenId (only model + rarity), so a re-imported car is a
// clean STOCK instance — the NFT represents the class and rarity, never the tune.
async function insertReimportRows(client, characterId, kind, catalogId, rarity, amount) {
  for (let i = 0; i < amount; i++) {
    const rowId = uid();
    if (kind === 'car')
      await client.query('INSERT INTO cars (id, character_id, model_id, trim_id, dmg, rarity) VALUES ($1,$2,$3,$4,0,$5)',
        [rowId, characterId, catalogId, 'stock', rarity]);
    else
      await client.query('INSERT INTO boats (id, character_id, kind, rarity) VALUES ($1,$2,$3,$4)',
        [rowId, characterId, catalogId, rarity]);
  }
}

// Apply ONE recorded re-import (called both inline from reimportItem and from the worker sweep). Locks
// the reimport row, re-checks it's still pending, resolves the burner's wallet → account → LIVING
// character, and creates the item row(s). No living character yet → returns null (stays pending; the
// sweep retries). Deliberately does NOT gate on GARAGE_CAP/FLEET_MAX: a burned NFT must never be
// stranded because a garage is full, exactly as the market-win / pink-slip / loan-seize transfers can
// push a fleet over cap (the "conserve by row count" precedent). Only the reimport row is FOR UPDATE'd
// (a leaf); account/character are plain reads → no lock-order edge.
async function applyReimport(client, ref, wallet, kind, catalogId, rarity, amount) {
  const r = (await client.query("SELECT status FROM nft_reimports WHERE id=$1 FOR UPDATE", [ref])).rows[0];
  if (!r || r.status !== 'pending') return null; // already applied / gone
  const acct = (await client.query(
    'SELECT account_id FROM account_persistent WHERE lower(wallet_address)=lower($1)', [wallet])).rows[0];
  if (!acct) return null; // wallet not linked to any account yet — wait
  const ch = (await client.query(
    'SELECT id FROM characters WHERE account_id=$1 AND alive ORDER BY created_at LIMIT 1', [acct.account_id])).rows[0];
  if (!ch) return null; // no living street — wait (you can't put a car in a dead man's garage)
  await insertReimportRows(client, ch.id, kind, catalogId, rarity, Number(amount));
  await client.query("UPDATE nft_reimports SET status='applied', applied_character=$2, applied_at=now() WHERE id=$1", [ref, ch.id]);
  return ch.id;
}

// Redeemed(from, tokenId, amount) → record + apply. Idempotent on the log ref (txHash:logIndex): a
// re-delivered log (restart / overlapping re-scan) is a clean no-op. The confirmation depth is the
// watcher's (§3 guard: a reorg that un-burns must never leave a live in-game row behind); the burn is
// the ONLY authority (no server signature — unlike a mint). Malformed / undecodable (e.g. a gear token
// the contract shouldn't have let through) → logged and skipped WITHOUT throwing, so the watcher cursor
// still advances past a log that can never succeed (a real DB fault DOES throw → cursor holds, re-scan).
export async function reimportItem(pool, { ref, from, tokenId, amount }) {
  const amt = Number(amount);
  if (!ref || !from || !isAddress(from) || !Number.isInteger(amt) || amt <= 0) {
    console.error('reimport: malformed Redeemed event', ref, from, tokenId, amount); return { skipped: true };
  }
  let dec;
  try { dec = nftDecode(tokenId); } // car/boat only — gear/unknown throws (the contract already rejects gear)
  catch (e) { console.error('reimport: undecodable token', tokenId, e.message); return { skipped: true }; }
  const wallet = getAddress(from);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // idempotent on the log ref (txHash:logIndex). SELECT-then-INSERT, not ON CONFLICT: pg-mem does not
    // report a suppressed conflict's rowCount (the recordCommunityRevenue precedent), and the single
    // worker process serialises event delivery, so there is no concurrent-insert race beyond this. On
    // real Postgres the `id` PK is the backstop — a lost race throws 23505, the tick re-scans, and the
    // SELECT then finds the row (duplicate).
    if ((await client.query('SELECT 1 FROM nft_reimports WHERE id=$1', [ref])).rows[0]) {
      await client.query('ROLLBACK'); return { duplicate: true };
    }
    await client.query(
      `INSERT INTO nft_reimports (id, wallet_address, token_id, amount, kind, catalog_id, rarity)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [ref, wallet, String(tokenId), amt, dec.kind, dec.catalogId, dec.rarity]);
    // apply in the SAME txn so record + rows commit atomically; no living character → left pending.
    const character = await applyReimport(client, ref, wallet, dec.kind, dec.catalogId, dec.rarity, amt);
    await client.query('COMMIT');
    return character ? { applied: true, character } : { pending: true };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// Worker sweep: apply any re-imports still WAITING for a living character (the burner hadn't linked a
// wallet, or had no living street, when the event landed). Per-row txn; each re-check resolves the
// wallet under the current state. The reclaimExpiredVouchers worker precedent.
export async function sweepReimports(pool) {
  const pend = (await pool.query(
    "SELECT id, wallet_address, kind, catalog_id, rarity, amount FROM nft_reimports WHERE status='pending' ORDER BY created_at LIMIT 200")).rows;
  let applied = 0;
  for (const p of pend) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ch = await applyReimport(client, p.id, p.wallet_address, p.kind, p.catalog_id, p.rarity, Number(p.amount));
      await client.query('COMMIT');
      if (ch) applied++;
    } catch (e) { await client.query('ROLLBACK'); console.error('reimport sweep failed', p.id, e?.code || e?.message || e); }
    finally { client.release(); }
  }
  return { applied, pending: pend.length };
}

// ── STREET DEEDS on-chain (omerta-street-deeds-design.md §2/§3) ────────────────────────────────
// The deed rail: extract a named street as a StreetDeed ERC-721, and re-import it (burn) back into the
// game. THE ONE STRUCTURAL RULE (design §0): the DEED transfers on-chain, the game's `minted` EXTRACTION
// entitlement and the rent/turf CONTROL do NOT. A deed is INERT while extracted (the car/boat precedent):
// its legend is PRESERVED and travels with the token — the value — and to play the rent/turf game with
// it again its holder RE-IMPORTS it (burn → the Redeemed watcher re-keys it to the burner's account).
//
// §10.4-NEUTRAL by construction: a deed is ownership, never a §10.4 currency — every function here
// writes ZERO `transactions` rows. The three states of a deed row:
//   1. in-game       account_id = A (real),   onchain_token_id = NULL          — fully playable
//   2. extract-pending account_id = A (real),  onchain_token_id = <token>       — INERT; A can't claim
//        a new street (still holds this row) until the on-chain claim lands (Extracted watcher) or the
//        voucher expires (sweep clears it → state 1). This closes the double-dispose window: A can't
//        list/sell/collect the deed off-chain AND mint the NFT for the same street.
//   3. on-chain      account_id = 'onchain:<token>', onchain_token_id = <token> — A freed; the NFT is
//        in a wallet, tradeable; the row (+ its legend) persists to reserve the name and preserve the
//        story until someone RE-IMPORTS it (state 3 → 1 on the burner).

// EIP-712 shape — MUST stay in exact parity with StreetDeed.DEED_VOUCHER_TYPEHASH and its domain
// ("OmertaStreetDeed","1"). Field order matches the Solidity struct.
export const DEED_VOUCHER_TYPES = {
  DeedVoucher: [
    { name: 'to', type: 'address' },
    { name: 'name', type: 'string' },
    { name: 'district', type: 'string' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};
// The StreetDeed EIP-712 domain (its own contract → its own verifyingContract). No defaults (the
// chainConfig fail-closed discipline): a wrong/zero chainId or verifyingContract signs a voucher under
// the WRONG domain → every on-chain claim() reverts BadSignature while the deed is flagged inert.
export function deedChainConfig() {
  const chainId = Number(process.env.CHAIN_ID);
  const verifyingContract = process.env.STREET_DEED_ADDRESS;
  if (!chainId || !verifyingContract || !isAddress(verifyingContract))
    throw new GameError('chain_unconfigured', 'Taking a Street Deed on-chain is not enabled on this server yet (chain config missing).');
  return { name: 'OmertaStreetDeed', version: '1', chainId, verifyingContract: getAddress(verifyingContract) };
}
// tokenId = uint256(keccak256(bytes(name))) as a decimal string — the deterministic id the contract
// DERIVES (tokenIdFor), and the re-import lookup key. keccak of the raw UTF-8 name bytes, exact parity.
export function deedTokenId(name) {
  return BigInt(keccak256(toBytes(String(name)))).toString();
}

// A StreetDeed `usedNonce(nonce)` reader (the makeChainReader twin, for sweepDeedVouchers). Returns null
// when the deed chain is unconfigured/unreachable/wrong-chain → the sweep FAILS CLOSED (never clears an
// inert deed blind, which could strand a genuinely-extracted street back into the game).
export async function makeDeedReader() {
  if (!process.env.CHAIN_RPC_URL || !process.env.STREET_DEED_ADDRESS || !isAddress(process.env.STREET_DEED_ADDRESS)) return null;
  const { createPublicClient, http } = await import('viem');
  const client = createPublicClient({ transport: http(process.env.CHAIN_RPC_URL) });
  if (process.env.CHAIN_ID) {  // the wrong-chain guard (makeChainReader posture)
    try { if (Number(process.env.CHAIN_ID) !== Number(await client.getChainId())) return null; } catch { return null; }
  }
  const address = getAddress(process.env.STREET_DEED_ADDRESS);
  const abi = [{ type: 'function', name: 'usedNonce', stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }];
  return { usedNonce: (nonce) => client.readContract({ address, abi, functionName: 'usedNonce', args: [BigInt(nonce)] }) };
}

// EXTRACT a named street on-chain: sign a DeedVoucher, and flag the deed EXTRACTION-PENDING (state 1→2).
// Gates mirror requestItemWithdraw: a MADE account (the Sybil bound — `minted` never travels with the
// token) + a linked wallet + the account owns a NOT-already-on-chain, NOT-listed deed. ZERO §10.4.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE IDENTITY NFT'S ENTRANCE (red team #9 F2). DynastyNFT self-mints against a server-signed
// EIP-712 MintVoucher and has NO owner mint, so with nothing signing one the contract was deployable,
// watchable and unusable — the forgotten-sibling class across the four contracts that share one
// signer key: VoucherClaim, StreetDeed and OmertaBond each had a signing route and this one did not,
// while the runbook and the log both said the rail was complete.
//
// THE GATE is the founder's recorded answer (2026-08-16, "retrofit every existing minter"): an account
// that PAID the identity fee, with a wallet it proved through SIWE, may take its portrait on-chain —
// ONE token per account. The token carries NO entitlement (the wall: nothing gates on `balanceOf`),
// so this mints a trophy, never a power.
export const MINT_VOUCHER_TYPES = {
  MintVoucher: [
    { name: 'to', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};
// Its own contract → its own verifyingContract and its own domain name; the four domains are
// deliberately distinct so a voucher for one can never be replayed against another.
export function dynastyChainConfig() {
  const chainId = Number(process.env.CHAIN_ID);
  const verifyingContract = process.env.DYNASTY_NFT_ADDRESS;
  if (!chainId || !verifyingContract || !isAddress(verifyingContract))
    throw new GameError('chain_unconfigured', 'Minting the identity NFT is not enabled on this server yet (chain config missing).');
  return { name: 'OmertaDynasty', version: '1', chainId, verifyingContract: getAddress(verifyingContract) };
}

export async function requestDynastyMint(pool, accountId, toAddress) {
  const domain = dynastyChainConfig();  // throws chain_unconfigured if not configured
  const signer = signerAccount();       // throws chain_unconfigured if the signer PK is missing
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const acct = (await client.query('SELECT * FROM account_persistent WHERE account_id=$1 FOR UPDATE', [accountId])).rows[0];
    if (!acct?.minted) throw new GameError('not_minted', 'Only a made account can take its portrait on-chain — pay the identity mint fee first.');
    const to = toAddress || acct?.wallet_address;
    if (!to || !isAddress(to)) throw new GameError('wallet', 'Link a wallet (SIWE) or pass a valid address first.');
    // ONE per account, on both horizons: a token the Minted watcher has already recorded, and a
    // voucher signed but not yet claimed. Without the second the window between signing and the mint
    // landing would issue a second voucher for the same account (the contract has no per-account cap
    // — its walls are the nonce, the deadline and the daily rate).
    const have = (await client.query('SELECT token_id FROM dynasty_tokens WHERE account_id=$1', [accountId])).rows[0];
    if (have) throw new GameError('already', 'Your bloodline already has its portrait on-chain.');
    const pending = (await client.query(
      "SELECT id FROM vouchers WHERE account_id=$1 AND kind='dynasty' AND status='signed' AND deadline > $2",
      [accountId, Math.floor(Date.now() / 1000)])).rows[0];
    if (pending) throw new GameError('pending', 'A mint voucher is already out — claim it, or wait for it to lapse.');

    // nonce from the shared chain_reserve counter (unique across ALL vouchers; this contract's own
    // usedNonce only ever sees this subset, all distinct). NOT reserve-bounded — no $OMR moves.
    const res = (await client.query('SELECT * FROM chain_reserve WHERE id=1 FOR UPDATE')).rows[0];
    const nonce = Number(res.next_nonce);
    await client.query('UPDATE chain_reserve SET next_nonce = next_nonce + 1 WHERE id=1');
    const deadline = Math.floor(Date.now() / 1000) + WITHDRAW_TTL_SEC;

    const message = { to: getAddress(to), nonce: BigInt(nonce), deadline: BigInt(deadline) };
    const signature = await signer.signTypedData({ domain, types: MINT_VOUCHER_TYPES, primaryType: 'MintVoucher', message });
    const voucher = Object.fromEntries(Object.entries(message).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]));

    const id = uid();
    await client.query(
      'INSERT INTO vouchers (id, account_id, kind, amount, gear_id, nonce, to_address, deadline, status, signed_payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, accountId, 'dynasty', 1, null, nonce, getAddress(to), deadline, 'signed', JSON.stringify({ voucher, signature })]);
    await client.query('COMMIT');
    return { id, nonce, status: 'signed', contract: domain.verifyingContract, chainId: domain.chainId, voucher, signature };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}

export async function requestDeedWithdraw(pool, accountId, toAddress, { attest } = {}) {
  const domain = deedChainConfig();  // throws chain_unconfigured if not configured
  const signer = signerAccount();    // throws chain_unconfigured if the signer PK is missing
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const acct = (await client.query('SELECT * FROM account_persistent WHERE account_id=$1 FOR UPDATE', [accountId])).rows[0];
    if (!acct?.minted) throw new GameError('not_minted', 'Only a made account can take a Street Deed on-chain — pay the 0.01 ETH mint fee first.');
    const to = toAddress || acct?.wallet_address;
    if (!to || !isAddress(to)) throw new GameError('wallet', 'Link a wallet (SIWE) or pass a valid address first.');
    const deed = (await client.query('SELECT * FROM street_deeds WHERE account_id=$1 FOR UPDATE', [accountId])).rows[0];
    if (!deed) throw new GameError('no_deed', "You don't hold a street to take on-chain.");
    if (deed.onchain_token_id) throw new GameError('already', "It's already on-chain (or an extraction is pending).");
    if (deed.sale_price != null) throw new GameError('listed', 'Pull the street off the in-game market before extracting it.');
    // THE ELIGIBILITY SELF-ATTESTATION (founder sign-off 2026-08-16 — the stock-delivery
    // verification depth: wallet + paid mint + self-attestation). The deed's ERC-6551 vault is
    // where treasury stock lands with no claim gate, so the extractor must attest — explicitly,
    // strict `=== true` at the route so a truthy accident never passes — that they may hold the
    // instruments it can receive. Recorded on the row (it survives the on-chain re-key).
    if (attest !== true) throw new GameError('attestation',
      'Confirm the eligibility attestation first — by extracting you attest you may lawfully hold the instruments this deed’s vault can receive.');
    const districtDisp = (DISTRICTS.find((d) => d.id === deed.district) || {}).name || deed.district;
    const token = deedTokenId(deed.name);

    // nonce from the shared chain_reserve counter (unique across ALL vouchers; the deed contract's own
    // usedNonce only ever sees this subset, all distinct). NOT reserve-bounded — no $OMR moves.
    const res = (await client.query('SELECT * FROM chain_reserve WHERE id=1 FOR UPDATE')).rows[0];
    const nonce = Number(res.next_nonce);
    await client.query('UPDATE chain_reserve SET next_nonce = next_nonce + 1 WHERE id=1');
    const deadline = Math.floor(Date.now() / 1000) + WITHDRAW_TTL_SEC;

    const message = { to: getAddress(to), name: deed.name, district: districtDisp, nonce: BigInt(nonce), deadline: BigInt(deadline) };
    const signature = await signer.signTypedData({ domain, types: DEED_VOUCHER_TYPES, primaryType: 'DeedVoucher', message });
    const voucher = Object.fromEntries(Object.entries(message).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]));

    // state 1 → 2: INERT (onchain_token_id set), account_id unchanged so the account can't claim a new
    // street until this resolves; control cleared (a rival's grip lapses — the deed is leaving the game).
    await client.query(
      'UPDATE street_deeds SET onchain_token_id=$2, controller_account=NULL, control_until=NULL, attested_at=now() WHERE account_id=$1', [accountId, token]);
    const id = uid();
    await client.query(
      'INSERT INTO vouchers (id, account_id, kind, amount, gear_id, nonce, to_address, deadline, status, signed_payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, accountId, 'deed', 1, token, nonce, getAddress(to), deadline, 'signed', JSON.stringify({ voucher, signature })]);
    await client.query('COMMIT');
    return { id, nonce, status: 'signed', street: deed.name, district: deed.district, tokenId: token,
      contract: domain.verifyingContract, chainId: domain.chainId, voucher, signature,
      note: 'Submit claim(voucher, signature) to the StreetDeed contract to mint your deed NFT. It is INERT in-game until you re-import it.' };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// StreetDeed Extracted(nonce, to, tokenId, name, district) → the deed genuinely minted on-chain.
// Transition EXTRACTION-PENDING → ON-CHAIN (state 2→3): re-key the deed (and its legend) to a synthetic
// `onchain:<tokenId>` owner (freeing the extractor to claim a new street; the name + story persist), and
// mark the voucher claimed. Idempotent: a re-delivered event finds the deed already re-keyed (no-op).
export async function markDeedExtracted(pool, { nonce, tokenId }) {
  const owner = 'onchain:' + String(tokenId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const deed = (await client.query(
      "SELECT account_id FROM street_deeds WHERE onchain_token_id=$1 AND account_id NOT LIKE 'onchain:%' FOR UPDATE", [String(tokenId)])).rows[0];
    if (deed) {
      await client.query('UPDATE street_deed_history SET account_id=$2 WHERE account_id=$1', [deed.account_id, owner]);
      // Re-key to the inert on-chain owner AND stamp who extracted it — the stock-delivery keeper
      // (brokers §3.4) reads `extracted_by_account` to find this account's on-chain deed after the
      // account_id link is gone, and pushes its stock allocation into the deed's ERC-6551 TBA.
      await client.query(
        'UPDATE street_deeds SET account_id=$2, extracted_by_account=$3, extracted_at=now() WHERE account_id=$1',
        [deed.account_id, owner, deed.account_id]);
    }
    if (nonce != null)
      await client.query("UPDATE vouchers SET status='claimed', claimed_onchain=true WHERE nonce=$1 AND kind='deed' AND status='signed'", [Number(nonce)]);
    await client.query('COMMIT');
    return { extracted: !!deed };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// Apply ONE observed on-chain deed Transfer (the secondary market watcher). Two jobs: (1) keep
// `onchain_owner` current — the stock-delivery rail reads it, because a deed SOLD on a secondary
// market must stop receiving its EXTRACTOR's stock allocations (the vault now belongs to the buyer;
// pushing A's stock into it would hand A's assets to a stranger); (2) append a public "changed hands
// on-chain" line to the deed's legend and tell the extractor. REPLAY-SAFE by construction: the UPDATE
// fires only when the owner actually CHANGES (`IS DISTINCT FROM`), so a re-scanned log window can
// never duplicate the legend line or re-notify. Mint transfers (from 0x0) record the FIRST owner —
// useful, and harmless to the exclusion since that owner IS the extractor's wallet. Burns are skipped
// here (`to` = 0x0 is the Redeemed stream's business, which re-imports the deed whole).
export async function recordDeedTransfer(pool, { tokenId, to, from }) {
  if (!tokenId || !to) return { changed: false };
  const owner = String(to).toLowerCase();
  if (owner === '0x0000000000000000000000000000000000000000') return { changed: false }; // a burn — the Redeemed stream's business
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // read-compare-write (NOT `IS DISTINCT FROM` — pg-mem cannot parse it); the FOR UPDATE lock +
    // the JS comparison give the same replay-safety: a re-delivered event finds the owner already
    // recorded and changes nothing.
    const cur = (await client.query(
      'SELECT account_id, extracted_by_account, name, onchain_owner FROM street_deeds WHERE onchain_token_id=$1 FOR UPDATE',
      [String(tokenId)])).rows[0];
    const row = (cur && String(cur.onchain_owner || '').toLowerCase() !== owner) ? cur : null;
    if (row) await client.query('UPDATE street_deeds SET onchain_owner=$2 WHERE onchain_token_id=$1', [String(tokenId), owner]);
    // a genuine SECONDARY move (not the mint — the mint has no prior owner recorded) goes on the
    // public record: provenance is the deed's value, and a sale is part of its story
    const isMint = !from || String(from).toLowerCase() === '0x0000000000000000000000000000000000000000';
    if (row && !isMint) {
      const { recordDeedEvent } = await import('./deeds.js');
      await recordDeedEvent(client, row.account_id, 'sold', 'the deed changed hands on-chain');
      if (row.extracted_by_account) {
        const ch = (await client.query(
          'SELECT id FROM characters WHERE account_id=$1 AND alive LIMIT 1', [row.extracted_by_account])).rows[0];
        if (ch) await client.query(
          `INSERT INTO notifications (character_id, type, payload) VALUES ($1,'deed_transferred',$2)`,
          [ch.id, JSON.stringify({ name: row.name, note: 'your extracted street changed hands on-chain — new deliveries stop targeting it' })]);
      }
    }
    await client.query('COMMIT');
    return { changed: !!row };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// ═══ THE DYNASTY TOKEN REGISTRY — the DynastyNFT's backend half (Minted + Transfer) ═══
// The identity NFT gates NOTHING (the entitlement wall), so this registry exists for exactly one
// product rule: the portrait is DYNAMIC while the minting wallet holds the token and FREEZES at the
// first owner→owner transfer — a sold living portrait would re-render on the SELLER's later play (a
// post-sale rat degrading the buyer's asset), so a sold portrait is a PHOTOGRAPH
// (omerta-identity-nft-design.md, the 2026-08-10 correction both audit lenses converged on).
// The snapshot stores the portrait ROW (the render INPUT, portraitRow's shape) rather than rendered
// SVG, so a compositor improvement still applies to frozen plates while the FACTS stay frozen.
// §10.4-NEUTRAL: a token row is status/ownership, never currency — zero `transactions` rows.

// Record ONE Minted(nonce, minter, tokenId) — idempotent on the token_id PK (SELECT-then-INSERT
// inside the txn, never ON CONFLICT DO NOTHING: pg-mem lies about the suppressed rowCount, the
// recordReckoning lesson). The account resolves from the minter's SIWE wallet (the Store
// pay-before-link pattern); an unlinked minter leaves account_id NULL — the token is a pure trophy
// either way. A Transfer-created stub (see recordDynastyTransfer's ordering note) is UPDATEd with
// the nonce rather than duplicated.
export async function recordDynastyMint(pool, { nonce, tokenId, minter }) {
  if (!tokenId || !minter) return { recorded: false };
  const addr = String(minter).toLowerCase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = (await client.query('SELECT nonce FROM dynasty_tokens WHERE token_id=$1 FOR UPDATE', [String(tokenId)])).rows[0];
    if (cur) { // a re-scan, or the Transfer stream got here first (the stub) — fill the nonce in, once
      if (cur.nonce == null && nonce != null)
        await client.query('UPDATE dynasty_tokens SET nonce=$2 WHERE token_id=$1', [String(tokenId), Number(nonce)]);
      await client.query('COMMIT');
      return { recorded: false, duplicate: true };
    }
    const acct = (await client.query(
      'SELECT account_id FROM account_persistent WHERE lower(wallet_address)=lower($1)', [addr])).rows[0];
    await client.query(
      `INSERT INTO dynasty_tokens (token_id, nonce, minter_address, owner_address, account_id)
       VALUES ($1,$2,$3,$3,$4)`,
      [String(tokenId), nonce == null ? null : Number(nonce), addr, acct?.account_id || null]);
    await client.query('COMMIT');
    return { recorded: true, tokenId: String(tokenId), accountId: acct?.account_id || null };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// Record ONE ERC-721 Transfer on the DynastyNFT. A mint transfer (from 0x0) just confirms the first
// owner; the FIRST owner→owner transfer FREEZES the portrait (snapshot = the account's latest
// character's portrait row, captured in the same transaction). Replay-safe: a re-delivered event
// finds the owner already recorded and the frozen flag already set, and changes nothing. ORDERING
// NOTE: Minted and Transfer ride two cursor streams, so a sale can arrive before its mint was
// processed — a missing row is created as a STUB from what the transfer knows (minter := from, the
// closest owner on record) so the freeze is never lost; recordDynastyMint later fills the nonce.
export async function recordDynastyTransfer(pool, { tokenId, from, to }) {
  if (!tokenId || !to) return { changed: false };
  const owner = String(to).toLowerCase();
  const ZERO = '0x0000000000000000000000000000000000000000';
  if (owner === ZERO) return { changed: false };          // a burn — DynastyNFT has none today; future-proof skip
  const isMint = !from || String(from).toLowerCase() === ZERO;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let row = (await client.query(
      'SELECT token_id, owner_address, account_id, frozen FROM dynasty_tokens WHERE token_id=$1 FOR UPDATE',
      [String(tokenId)])).rows[0];
    if (!row) {
      const seedMinter = isMint ? owner : String(from).toLowerCase();
      const acct = (await client.query(
        'SELECT account_id FROM account_persistent WHERE lower(wallet_address)=lower($1)', [seedMinter])).rows[0];
      await client.query(
        `INSERT INTO dynasty_tokens (token_id, minter_address, owner_address, account_id)
         VALUES ($1,$2,$2,$3)`, [String(tokenId), seedMinter, acct?.account_id || null]);
      row = { token_id: String(tokenId), owner_address: seedMinter, account_id: acct?.account_id || null, frozen: false };
    }
    let changed = false;
    if (String(row.owner_address || '').toLowerCase() !== owner) {
      await client.query('UPDATE dynasty_tokens SET owner_address=$2 WHERE token_id=$1', [String(tokenId), owner]);
      changed = true;
    }
    // THE FREEZE — first owner→owner move, exactly once. The snapshot is the bloodline's CURRENT
    // portrait row (latest character, living preferred), so the plate the buyer paid for is the
    // plate they keep; if the account is unknown/characterless the facts to freeze don't exist and
    // the row freezes with a NULL snapshot (the route falls back to the blank plate — honest, and
    // strictly better than letting a stranger's asset keep tracking the seller).
    if (!isMint && !row.frozen && changed) {
      let snapshot = null;
      if (row.account_id) {
        const ch = (await client.query(
          'SELECT id FROM characters WHERE account_id=$1 ORDER BY alive DESC, created_at DESC LIMIT 1',
          [row.account_id])).rows[0];
        if (ch) snapshot = await portraitRow(client, ch.id);
      }
      await client.query(
        'UPDATE dynasty_tokens SET frozen=true, frozen_at=now(), snapshot=$2 WHERE token_id=$1',
        [String(tokenId), snapshot ? JSON.stringify(snapshot) : null]);
    }
    await client.query('COMMIT');
    return { changed, frozen: !isMint && !row.frozen && changed };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// Apply ONE recorded deed re-import (called inline from reimportDeed and from the sweep). Locks the
// pending row, resolves the burner's wallet → account, requires that account be DEEDLESS (one deed per
// account), and re-keys the on-chain deed (+ its legend) to them with control RESET (the buyer earns the
// corner — the identity-NFT lesson). No living account / already holds a deed → returns null (stays
// pending; the sweep retries). §10.4-NEUTRAL — ownership, never a currency; zero ledger rows.
async function applyDeedReimport(client, ref, wallet, tokenId) {
  const r = (await client.query("SELECT status FROM deed_reimports WHERE ref=$1 FOR UPDATE", [ref])).rows[0];
  if (!r || r.status !== 'pending') return null; // already applied / gone
  const onchainOwner = 'onchain:' + String(tokenId);
  const deed = (await client.query(
    'SELECT account_id, name FROM street_deeds WHERE onchain_token_id=$1 AND account_id=$2 FOR UPDATE', [String(tokenId), onchainOwner])).rows[0];
  if (!deed) { // the deed isn't in the on-chain state (already re-imported, or never extracted) — settle
    await client.query("UPDATE deed_reimports SET status='applied', applied_at=now() WHERE ref=$1", [ref]);
    return null;
  }
  const acct = (await client.query(
    'SELECT account_id FROM account_persistent WHERE lower(wallet_address)=lower($1)', [wallet])).rows[0];
  if (!acct) return null; // burner's wallet not linked to any account yet — wait
  if ((await client.query("SELECT 1 FROM street_deeds WHERE account_id=$1 AND (onchain_token_id IS NULL OR account_id NOT LIKE 'onchain:%')", [acct.account_id])).rowCount)
    return null; // they already hold a street in-game — must offload it first (wait)
  // re-key the deed + its legend to the burner, clear the on-chain flag, RESET control (they earn the corner)
  await client.query('UPDATE street_deed_history SET account_id=$2 WHERE account_id=$1', [onchainOwner, acct.account_id]);
  // The deed's ON-CHAIN LIFE IS OVER, so every field that describes it goes with the token id —
  // `extracted_by_account`, `extracted_at` and `onchain_owner` too (red-team C4). Leaving them set is
  // the stale-state-survives-a-lifecycle-reset class, and it mis-routes REAL STOCK: the delivery rail
  // resolves a deed's target from `onchain_owner` first (a secondary buyer who linked that wallet) and
  // falls back to `extracted_by_account`. A deed re-imported and then re-extracted by SOMEBODY ELSE
  // sits in extract-pending carrying the PREVIOUS life's owner, so the previous owner's allocations
  // would be delivered into the ERC-6551 vault of a deed the new extractor is about to control.
  await client.query(
    `UPDATE street_deeds SET account_id=$2, onchain_token_id=NULL, extracted_by_account=NULL,
       extracted_at=NULL, onchain_owner=NULL, controller_account=NULL, control_until=NULL,
       corner_at=now(), shakedown_at=NULL, sale_price=NULL WHERE account_id=$1`, [onchainOwner, acct.account_id]);
  // append a lineage line to the legend (fixed string, no user input → a plain insert, no cleanText/SAVEPOINT)
  await client.query("INSERT INTO street_deed_history (account_id, kind, detail) VALUES ($1,'sold','brought back into the city from on-chain')", [acct.account_id]);
  await client.query("UPDATE deed_reimports SET status='applied', applied_account=$2, applied_at=now() WHERE ref=$1", [ref, acct.account_id]);
  return acct.account_id;
}

// StreetDeed Redeemed(from, tokenId) → record + apply the re-import (state 3→1). Idempotent on the log
// ref (txHash:logIndex — the harvest-fee discipline); the burn is the ownership proof (no server signature).
export async function reimportDeed(pool, { ref, from, tokenId }) {
  if (!ref || !from || !isAddress(from) || tokenId == null) {
    console.error('deed reimport: malformed Redeemed event', ref, from, tokenId); return { skipped: true };
  }
  const wallet = getAddress(from);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // SELECT-then-INSERT (pg-mem doesn't report a suppressed conflict's rowCount; the single worker
    // serialises delivery). Real Postgres: the ref PK backstops a lost race (23505 → re-scan → duplicate).
    if ((await client.query('SELECT 1 FROM deed_reimports WHERE ref=$1', [ref])).rows[0]) {
      await client.query('ROLLBACK'); return { duplicate: true };
    }
    await client.query('INSERT INTO deed_reimports (ref, wallet_address, token_id) VALUES ($1,$2,$3)', [ref, wallet, String(tokenId)]);
    const account = await applyDeedReimport(client, ref, wallet, String(tokenId));
    await client.query('COMMIT');
    return account ? { applied: true, account } : { pending: true };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// Worker sweep: apply deed re-imports still WAITING for a linked, deedless burner account. Per-row txn.
export async function sweepDeedReimports(pool) {
  const pend = (await pool.query(
    "SELECT ref, wallet_address, token_id FROM deed_reimports WHERE status='pending' ORDER BY created_at LIMIT 200")).rows;
  let applied = 0;
  for (const p of pend) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const a = await applyDeedReimport(client, p.ref, p.wallet_address, p.token_id);
      await client.query('COMMIT');
      if (a) applied++;
    } catch (e) { await client.query('ROLLBACK'); console.error('deed reimport sweep failed', p.ref, e?.code || e?.message || e); }
    finally { client.release(); }
  }
  return { applied, pending: pend.length };
}

// ══ THE STRANDED-VAULT RECOVERY — a burned deed nobody can re-mint (founder-directed 2026-08-16) ══
//
// Burning a deed FREEZES its ERC-6551 vault, it never empties it: the account's address is a pure
// function of the tokenId, the tokenId is keccak(NAME), and nothing ever deletes a `street_deeds` row
// or frees its unique `name_lc` — so the id is permanently reserved and re-minting that same street
// restores control with the contents intact (`StreetDeed.t.sol` proves the same-id re-mint). In the
// ORDINARY case this needs nobody: `applyDeedReimport` leaves the row `pending` when the burner has no
// linked wallet or already holds a street, and `sweepDeedReimports` retries it every tick, forever.
//
// The case that never resolves is a burn from a wallet that will NEVER link — a lost key, a redeem
// sent from the wrong address, a player who does not come back. The re-import waits indefinitely,
// nobody in-game holds the deed, so nothing re-mints the id and real stock sits frozen at a known
// address with no route to it. This is that route, and it needs NO contract change: `claim()` accepts
// any server-signed DeedVoucher and derives the tokenId from the name.
//
// FOUR WALLS, because the lever is strong (the signer can already mint any name anywhere — this adds
// no authority, but a routed, documented path makes it USABLE, which is the part that needs bounding):
//   1. THE DESTINATION IS FIXED. It recovers to `DEED_RECOVERY_ADDRESS` — a treasury holding address —
//      and takes no address from the caller (founder decision). So the route cannot be talked into
//      "I lost my key, mint my street to this new wallet": returning a recovered deed to a player is a
//      separate, deliberate act by whoever holds the treasury, not something this can be aimed.
//   2. ONLY A GENUINELY STRANDED DEED. There must be a `deed_reimports` row still `pending` for the
//      token — that row IS the evidence the burn happened and the re-import cannot land — and the deed
//      must still be in the on-chain state. A live, owned deed is not recoverable, i.e. this can never
//      be a confiscation. (The contract backstops it anyway: `_safeMint` reverts on an existing id, so
//      a voucher for a deed that was NOT burned is unclaimable.)
//   3. NOT BEFORE `RECOVER_AFTER_MS`. A burn minutes old is not stranded, it is in flight — the sweep
//      may still land it. The wait is what distinguishes the two.
//   4. IT SUPERSEDES THE PENDING RE-IMPORT. Otherwise the sweep could later re-key the deed to the
//      burner while the treasury holds the NFT — a split brain where two parties each believe they
//      own the street (the stale-state-survives-a-lifecycle-reset class the C4 fix was about).
// Mod-gated, so it lands in `mod_actions` like every other mod mutation. §10.4-NEUTRAL: a voucher and
// an ownership move, zero `transactions` rows.
export const DEED_RECOVER_AFTER_MS = Number(process.env.DEED_RECOVER_AFTER_MS || 30 * 24 * 3600 * 1000);

export async function recoverStrandedDeed(pool, { street, tokenId } = {}) {
  const to = process.env.DEED_RECOVERY_ADDRESS;
  if (!to || !isAddress(to))
    throw new GameError('no_recovery_address', 'Set DEED_RECOVERY_ADDRESS (the treasury holding address) before recovering a deed.');
  const domain = deedChainConfig();                       // throws chain_unconfigured if not configured
  const signer = signerAccount();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // resolve the deed by street name or token id — either way we end up on the SAME row
    const token = tokenId != null ? String(tokenId) : (street ? deedTokenId(String(street)) : null);
    if (!token) throw new GameError('no_deed', 'Name the street (or its token id) to recover.');
    const onchainOwner = 'onchain:' + token;
    const deed = (await client.query(
      'SELECT * FROM street_deeds WHERE onchain_token_id=$1 AND account_id=$2 FOR UPDATE', [token, onchainOwner])).rows[0];
    // WALL 2 — still in the on-chain state. A deed that came home (or never left) is not stranded.
    if (!deed) throw new GameError('not_stranded', 'That street is not sitting in the on-chain state — nothing to recover.');
    // WALL 2 + 3 — a pending re-import old enough to be genuinely stuck rather than in flight
    const pend = (await client.query(
      "SELECT ref, created_at FROM deed_reimports WHERE token_id=$1 AND status='pending' ORDER BY created_at LIMIT 1", [token])).rows[0];
    if (!pend) throw new GameError('not_burned',
      'No burn was ever recorded for that street — it may still be owned on-chain, and a voucher for a live deed cannot be claimed.');
    const waited = Date.now() - new Date(pend.created_at).getTime();
    if (waited < DEED_RECOVER_AFTER_MS) throw new GameError('too_soon',
      `That burn is ${Math.floor(waited / 3600000)}h old — the re-import may still land. Recovery opens at ${Math.round(DEED_RECOVER_AFTER_MS / 3600000)}h.`);

    const districtDisp = (DISTRICTS.find((d) => d.id === deed.district) || {}).name || deed.district;
    const res = (await client.query('SELECT * FROM chain_reserve WHERE id=1 FOR UPDATE')).rows[0];
    const nonce = Number(res.next_nonce);
    await client.query('UPDATE chain_reserve SET next_nonce = next_nonce + 1 WHERE id=1');
    const deadline = Math.floor(Date.now() / 1000) + WITHDRAW_TTL_SEC;
    const message = { to: getAddress(to), name: deed.name, district: districtDisp, nonce: BigInt(nonce), deadline: BigInt(deadline) };
    const signature = await signer.signTypedData({ domain, types: DEED_VOUCHER_TYPES, primaryType: 'DeedVoucher', message });
    const voucher = Object.fromEntries(Object.entries(message).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]));
    const id = uid();
    await client.query(
      'INSERT INTO vouchers (id, account_id, kind, amount, gear_id, nonce, to_address, deadline, status, signed_payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, onchainOwner, 'deed', 1, token, nonce, getAddress(to), deadline, 'signed', JSON.stringify({ voucher, signature })]);
    // WALL 4 — the pending re-import is SUPERSEDED, so the sweep can never later hand this street to
    // the burner while the treasury holds the NFT. Every pending row for the token, not just the one
    // we read: a re-scan can record several refs for the same burn.
    await client.query(
      "UPDATE deed_reimports SET status='superseded', applied_at=now() WHERE token_id=$1 AND status='pending'", [token]);
    await client.query(
      "INSERT INTO street_deed_history (account_id, kind, detail) VALUES ($1,'sold','recovered from a stranded burn — the vault was held for the city')",
      [onchainOwner]);
    await client.query('COMMIT');
    return { id, nonce, status: 'signed', street: deed.name, district: deed.district, tokenId: token,
      to: getAddress(to), strandedForHours: Math.floor(waited / 3600000),
      contract: domain.verifyingContract, chainId: domain.chainId, voucher, signature,
      note: 'Submit claim(voucher, signature) from the treasury holding wallet. It re-mints the SAME tokenId, which unfreezes the deed\'s ERC-6551 vault with its contents intact.' };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// The stranded set — what an operator can see before deciding to recover anything (the /admin read).
export async function strandedDeeds(pool) {
  const pend = (await pool.query(
    "SELECT ref, token_id, wallet_address, created_at FROM deed_reimports WHERE status='pending' ORDER BY created_at LIMIT 100")).rows;
  if (!pend.length) return { recoverAfterHours: Math.round(DEED_RECOVER_AFTER_MS / 3600000), stranded: [] };
  const ids = [...new Set(pend.map((p) => String(p.token_id)))];
  const deeds = (await pool.query(
    `SELECT name, district, onchain_token_id FROM street_deeds WHERE onchain_token_id IN (${ids.map((_, i) => `$${i + 1}`).join(',')})`,
    ids)).rows;
  const byToken = new Map(deeds.map((d) => [String(d.onchain_token_id), d]));
  return {
    recoverAfterHours: Math.round(DEED_RECOVER_AFTER_MS / 3600000),
    recoveryAddress: process.env.DEED_RECOVERY_ADDRESS || null,
    stranded: pend.map((p) => {
      const d = byToken.get(String(p.token_id));
      const hours = Math.floor((Date.now() - new Date(p.created_at).getTime()) / 3600000);
      return { tokenId: String(p.token_id), street: d ? d.name : null, district: d ? d.district : null,
        burnedBy: p.wallet_address, waitingHours: hours, ready: hours * 3600000 >= DEED_RECOVER_AFTER_MS };
    }),
  };
}

// Fallback for signed deed vouchers past deadline+grace (the Extracted watcher may be down / the player
// never submitted the tx). Consults the deed contract's usedNonce: CLAIMED → transition on-chain (a
// missed Extracted); NOT claimed → clear the inert flag (the deed never left the game → state 2→1). No
// reader (RPC unset/down/wrong-chain) → SKIP (never clear blind — the reclaimExpiredVouchers fail-safe).
export async function sweepDeedVouchers(pool, reader = undefined) {
  const chain = reader !== undefined ? reader : await makeDeedReader();
  const cutoff = Math.floor(Date.now() / 1000) - RECLAIM_GRACE_SEC;
  const stale = (await pool.query(
    "SELECT id, nonce, gear_id FROM vouchers WHERE kind='deed' AND status='signed' AND NOT claimed_onchain AND deadline < $1", [cutoff])).rows;
  if (!chain && stale.length)
    console.error(`deed voucher sweep: ${stale.length} stale deed voucher(s) but no on-chain reader — skipping (never clear an inert deed blind)`);
  let cleared = 0, extracted = 0, skipped = 0;
  for (const v of stale) {
    if (!chain) { skipped++; continue; }
    let used;
    try { used = await chain.usedNonce(v.nonce); }
    catch { continue; } // RPC hiccup — retry next tick
    if (used) { await markDeedExtracted(pool, { nonce: Number(v.nonce), tokenId: v.gear_id }); extracted++; continue; }
    // never claimed on-chain → the deed never left the game. Clear the inert flag (state 2→1) and expire
    // the voucher. Guard the deed is still pending under the extractor (account_id NOT onchain).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cur = (await client.query("SELECT status FROM vouchers WHERE id=$1 FOR UPDATE", [v.id])).rows[0];
      if (cur && cur.status === 'signed') {
        // the same full reset as a re-import (red-team C4): this deed is back in the game, so every
        // field describing an on-chain life goes with the token id or the NEXT extraction inherits a
        // previous owner and mis-routes its stock deliveries.
        await client.query(
          `UPDATE street_deeds SET onchain_token_id=NULL, extracted_by_account=NULL, extracted_at=NULL,
             onchain_owner=NULL WHERE onchain_token_id=$1 AND account_id NOT LIKE 'onchain:%'`, [String(v.gear_id)]);
        await client.query("UPDATE vouchers SET status='expired' WHERE id=$1", [v.id]);
        cleared++;
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); console.error('deed voucher clear failed', v.id, e?.code || e?.message || e); }
    finally { client.release(); }
  }
  return { cleared, extracted, skipped };
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
  // the SELECT above is a TOCTOU — two concurrent verifies of the same wallet both pass it, then
  // race the UPDATE; the ux_wallet_address unique index rejects the loser. Catch that as a clean
  // wallet_taken (audit LOW-1) instead of a raw 500. Data integrity was never at risk.
  try {
    await pool.query('UPDATE account_persistent SET wallet_address=$2 WHERE account_id=$1', [accountId, addr]);
  } catch (e) {
    if (e?.code === '23505') throw new GameError('wallet_taken', 'That wallet is already linked to another account.');
    throw e;
  }
  await pool.query('DELETE FROM wallet_challenges WHERE account_id=$1', [accountId]);
  // pay-before-link ordering: grant any fees + Store purchases this wallet made before it was attributable
  const { credited } = await reconcileFees(pool, accountId, addr);
  const { granted } = await reconcileStore(pool, accountId, addr);
  const { attributed } = await reconcileBonds(pool, accountId, addr); // attribute pre-link bonds (LOW-1)
  return { ok: true, wallet: addr, verified: true, feesCredited: credited, storeGranted: granted, bondsAttributed: attributed };
}

// ── THE RESERVE BOND — the EIP-712 quote signer (the piece OmertaBond.bond() needs). ──
// A player asks for a quote; the server prices it (oracle × discount), allocates a replay nonce, signs it
// EIP-712, and PERSISTS it. The player submits bond(quote, sig) on-chain; the (wired) Bonded watcher then
// calls recordBond, which recovers the exact price/discount from the persisted quote (the event omits them,
// carrying only the resolved payout + POL/Vig split). Same crown-jewel signer as the voucher path; the
// quote is bounded on-chain by MAX_DISCOUNT_BPS + MAX_VEST + MAX_QUOTE_TTL + the tranche/daily caps, and a
// compromised signer is revoked by the Safe. Chain-dormant: throws chain_unconfigured unless configured.

// MUST stay in exact parity with OmertaBond.QUOTE_TYPEHASH and its domain ("OmertaBond","1"). Field order
// matches the Solidity struct: payer, principal, priceOmrPerEth, discountBps, vestSeconds, nonce, deadline.
export const BOND_QUOTE_TYPES = {
  BondQuote: [
    { name: 'payer', type: 'address' },
    { name: 'principal', type: 'uint256' },
    { name: 'priceOmrPerEth', type: 'uint256' },
    { name: 'discountBps', type: 'uint256' },
    { name: 'vestSeconds', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};
// a short validity window — minute/hour-scale, well under the contract's MAX_QUOTE_TTL (30d) backstop.
const BOND_QUOTE_TTL_SEC = Number(process.env.BOND_QUOTE_TTL_SEC || 3600);

// The OmertaBond EIP-712 domain (its own contract → its own verifyingContract). No defaults (the
// chainConfig fail-closed discipline): a wrong/zero chainId or verifyingContract signs a quote under the
// WRONG domain → every on-chain bond() reverts BadSignature. Fail hard instead of signing dead quotes.
export function bondChainConfig() {
  const chainId = Number(process.env.CHAIN_ID);
  const verifyingContract = process.env.OMERTA_BOND_ADDRESS;
  if (!chainId || !verifyingContract || !isAddress(verifyingContract))
    throw new GameError('chain_unconfigured', 'Bonding is not enabled on this server yet (chain config missing).');
  return { name: 'OmertaBond', version: '1', chainId, verifyingContract: getAddress(verifyingContract) };
}

// Sign a bond quote for `principalEth` ETH from this account's linked wallet. The quote is bound to the
// wallet (the contract enforces msg.sender == payer), priced at the live oracle with BONDS.DISCOUNT_BPS,
// nonce'd from the bond tranche's own allocator, and PRE-CHECKED against the backend tranche budget so a
// player never gets a quote whose bond() would revert TrancheExhausted. Locks account → bond_reserve.
export async function quoteBond(pool, accountId, principalEth) {
  const eth = round6(Number(principalEth));
  if (!(eth >= BONDS.MIN_PRINCIPAL_ETH)) throw new GameError('min', `A bond takes at least ${BONDS.MIN_PRINCIPAL_ETH} ETH.`);
  const domain = bondChainConfig();  // throws chain_unconfigured if the bond chain isn't configured
  const signer = signerAccount();    // throws chain_unconfigured if the signer PK is missing

  // THE ORACLE READ HAPPENS BEFORE THE TRANSACTION OPENS (RED TEAM 2026-08-16). It needs nothing
  // from the database, and an RPC inside a held transaction pins a pooled connection for as long as
  // the node takes — the pool-exhaustion shape `bankPosition` and the deed-vault disclosure are both
  // written to avoid. Here it was worse than the read-only case those describe: the call sat between
  // an `account_persistent FOR UPDATE` and the `bond_reserve` singleton, so a slow or hanging node
  // also blocked that player's every other authed action behind their own row lock. A TWAP moves on
  // the order of its PERIOD, so a price fetched microseconds before the transaction opens is exactly
  // as current as one fetched inside it — there is nothing to buy by holding the lock across it.
  const priceReader = await makeBondPriceReader();
  let onchainPrice = null;
  if (priceReader) {
    let onchain = null;
    try { onchain = await priceReader.ceiling(); } catch {
      throw new GameError('oracle', 'The on-chain price oracle is not reporting — bonding is paused until it recovers.');
    }
    if (!(onchain?.oraclePrice > 0)) throw new GameError('oracle', 'The on-chain price oracle has no usable reading — bonding is paused.');
    onchainPrice = onchain.oraclePrice;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const acct = (await client.query('SELECT wallet_address FROM account_persistent WHERE account_id=$1 FOR UPDATE', [accountId])).rows[0];
    if (!acct) throw new GameError('no_account', 'No such account.');
    const payer = acct.wallet_address;
    if (!payer || !isAddress(payer)) throw new GameError('wallet', 'Link a wallet (SIWE) first — a bond quote is bound to your wallet.');
    // the live OMR-per-ETH oracle (the latest Vig buyback TWAP off-chain; the DEX TWAP on mainnet).
    const last = (await client.query('SELECT price_omr_per_eth FROM vig_buyback WHERE real ORDER BY created_at DESC LIMIT 1')).rows[0];
    let price = last ? round6(Number(last.price_omr_per_eth)) : null;
    if (!(price != null && Number.isFinite(price) && price > 0))
      throw new GameError('price', 'No live OMR-ETH price yet — bonding opens once the buyback prints one.');
    // WALL 4 PARITY. The contract judges this quote against its own TWAP; sign above that and the
    // bond reverts on-chain no matter how healthy this server looks. So when the bond chain is live,
    // CLAMP to what the contract will actually accept. Clamping DOWN only ever issues LESS OMR per
    // ETH than our own feed thought was fair, so the safe direction is the automatic one — and a
    // chain that is currently refusing every bond (unset/stale/broken oracle) is reported plainly
    // rather than papered over with a quote that cannot land.
    if (onchainPrice != null) {
      // CLAMP TO THE ORACLE PRICE, NOT THE CEILING (red-team F1). Two reasons, both decisive:
      //
      // 1. CORRECTNESS. `round6` ROUNDS, and it rounds UP half the time — measured at 50.0% over
      //    200k random ceilings, which is also the answer theory gives, since a uniformly-distributed
      //    residue rounds up exactly half the time. A price one micro-unit above the ceiling reverts
      //    `PriceAboveOracle` on-chain. Clamping to the CEILING therefore meant roughly every OTHER
      //    clamped quote failed, on the exact code path that exists to PREVENT failures. Clamping to
      //    the oracle price leaves the whole tolerance band as headroom, so rounding cannot breach it.
      // 2. DIRECTION. The ceiling is the most GENEROUS quote the wall permits, so clamping there made
      //    every disagreement between our feed and the chain's resolve toward MORE OMR per ETH. The
      //    conservative direction is the right default for a mint path.
      if (price > onchainPrice) price = round6(onchainPrice);
      if (!(price > 0)) throw new GameError('oracle', 'The on-chain oracle price is below the minimum quotable price.');
    }
    const disc = BONDS.DISCOUNT_BPS;
    const vestSeconds = Math.floor(BONDS.VEST_HOURS * 3600);
    const payout = bondPayout(eth, price, disc);
    if (!(payout > 0)) throw new GameError('payout', 'A bond payout must be positive.');
    // THE ANTI-PONZI PRE-CHECK (mirrors the contract's tranche cap against the backend budget). The contract
    // enforces its OWN cap on-chain against its funded balance; refusing here means a player never receives
    // a quote the treasury can't back. Keep bond_reserve.capacity_omr funded to match the on-chain balance.
    const res = (await client.query('SELECT capacity_omr, committed_omr, next_nonce FROM bond_reserve WHERE id=1 FOR UPDATE')).rows[0];
    if (Number(res.committed_omr) + payout > Number(res.capacity_omr) + 1e-6)
      throw new GameError('over_capacity', 'The bond tranche is exhausted — the treasury must top it up.');
    const nonce = Number(res.next_nonce);
    await client.query('UPDATE bond_reserve SET next_nonce = next_nonce + 1 WHERE id=1');
    // THE DAILY OFFERING (founder-directed GM issuance control): the tranche above is the LIFETIME
    // budget wall; this is the per-day POLICY throttle — no offering row for today means the desk
    // is CLOSED (fail-closed), and a signed quote CONSUMES the window at sign time (a quote is a
    // live option for its TTL, so counting quotes — not bonds — is the conservative side; an
    // unexercised quote wasting window is the accepted cost of a bounded day). Lock order:
    // account → bond_reserve → bond_offerings (a new leaf — nothing else locks it first).
    const today = dayOf();
    const off = (await client.query('SELECT offered_omr, quoted_omr FROM bond_offerings WHERE day=$1 FOR UPDATE', [today])).rows[0];
    if (!off) throw new GameError('no_offering', "The bond desk is closed today — no offering has been posted. Check back when the day's window opens.");
    if (Number(off.quoted_omr) + payout > Number(off.offered_omr) + 1e-6)
      throw new GameError('offering_spent', "Today's offering is spoken for — what was on the desk has been quoted. Tomorrow is another day.");
    await client.query('UPDATE bond_offerings SET quoted_omr = quoted_omr + $2 WHERE day=$1', [today, payout]);
    const deadline = Math.floor(Date.now() / 1000) + BOND_QUOTE_TTL_SEC;
    // the on-chain tuple: principal + priceOmrPerEth in wei (1e18). priceOmrPerEth = OMR wei per 1 ETH, so
    // the contract's `principal * priceOmrPerEth / 1e18` yields plain OMR wei (parity with bondPayout here).
    const message = {
      payer: getAddress(payer),
      principal: parseUnits(String(eth), 18),
      priceOmrPerEth: parseUnits(String(price), 18),
      discountBps: BigInt(disc),
      vestSeconds: BigInt(vestSeconds),
      nonce: BigInt(nonce),
      deadline: BigInt(deadline),
    };
    const signature = await signer.signTypedData({ domain, types: BOND_QUOTE_TYPES, primaryType: 'BondQuote', message });
    await client.query(
      `INSERT INTO bond_quotes (nonce, account_id, payer_address, principal_eth, price, discount_bps, payout_omr, vest_seconds, deadline, signature)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [nonce, accountId, getAddress(payer), eth, price, disc, payout, vestSeconds, deadline, signature]);
    await client.query('COMMIT');
    // serialize the bigints for transport; the client submits { quote, signature } to OmertaBond.bond().
    const quote = Object.fromEntries(Object.entries(message).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]));
    return {
      quote, signature,
      payoutOmr: payout, priceOmrPerEth: price, discountBps: disc, vestSeconds, nonce, deadline,
      contract: domain.verifyingContract, chainId: domain.chainId,
      note: 'Submit bond(quote, signature) to the OmertaBond contract (mainnet, dormant). The Bonded event books it to your reserve automatically.',
    };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// OmertaBond.bond((address,uint256×6) q, bytes sig) — the minimal ABI to encode a submission.
const BOND_ABI = [{
  type: 'function', name: 'bond', stateMutability: 'payable',
  inputs: [
    { name: 'q', type: 'tuple', components: [
      { name: 'payer', type: 'address' }, { name: 'principal', type: 'uint256' },
      { name: 'priceOmrPerEth', type: 'uint256' }, { name: 'discountBps', type: 'uint256' },
      { name: 'vestSeconds', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
    ] },
    { name: 'sig', type: 'bytes' },
  ],
  outputs: [{ type: 'uint256' }],
}];

// Server-encode a bond submission so the browser wallet (MetaMask / Robinhood Wallet / any injected wallet)
// can send it with `eth_sendTransaction` WITHOUT the zero-dep client hand-rolling ABI — viem (the same lib
// that SIGNED the quote) does the encoding here. Reads the player's OWN persisted quote by nonce and returns
// { to, value, data } exactly matching the signed message, plus the chainId to switch the wallet to. The
// wallet still shows the user the tx and they approve — the server custodies nothing.
export async function bondCalldata(pool, accountId, nonce) {
  const domain = bondChainConfig(); // ensures the bond chain is configured (verifyingContract + chainId)
  const q = (await pool.query('SELECT * FROM bond_quotes WHERE nonce=$1 AND account_id=$2', [Number(nonce), accountId])).rows[0];
  if (!q) throw new GameError('no_quote', 'No such quote of yours — request one first.');
  // rebuild the EXACT tuple the quote was signed over (deterministic re-derivation of the wei values).
  const tuple = {
    payer: getAddress(q.payer_address),
    principal: parseUnits(String(Number(q.principal_eth)), 18),
    priceOmrPerEth: parseUnits(String(Number(q.price)), 18),
    discountBps: BigInt(q.discount_bps),
    vestSeconds: BigInt(q.vest_seconds),
    nonce: BigInt(q.nonce),
    deadline: BigInt(q.deadline),
  };
  const data = encodeFunctionData({ abi: BOND_ABI, functionName: 'bond', args: [tuple, q.signature] });
  return {
    to: domain.verifyingContract, value: '0x' + tuple.principal.toString(16), data,
    chainId: domain.chainId, chainIdHex: '0x' + domain.chainId.toString(16),
    deadline: Number(q.deadline), // the client can warn if the quote has expired
  };
}

// ══════════ THE ORACLE KEEPER WATCHDOG (AUDIT-oracle.md's one open flag) ══════════
// The TWAP oracle only moves when someone pokes `update()`, and the keeper doing the poking is an
// operational dependency the repo had NO monitor for — a silent keeper halt is indistinguishable
// from low demand right up until bonds start refusing (staleness/rebaseline), and a keeper outage
// is exactly the F2 attack window. The backup watchdog (`archiverHealth` → `alertDrift`, latched
// per episode) is the precedent; this is its chain-side twin. Split like `dbhealth.js`: a PURE
// classifier the suite can exercise exhaustively + thin RPC plumbing that resolves the oracle
// address FROM the bond contract's own `oracle()` getter (no new env — one less thing to drift).
//
// Alert BEFORE the product breaks: the oracle discards a window past PERIOD × MAX_WINDOW_MULT (4)
// and `maxOracleAge` typically sits near 2× PERIOD, so `ORACLE_LATE_MULT` (2) flags the keeper as
// late while bonding still works — lead time, not a post-mortem.
export const ORACLE_LATE_MULT = 2;
// States (each earning its place, the archiverHealth discipline):
//   dormant     — no bond chain configured / wrong chain: nothing to watch, never alert
//   unset       — the bond has NO oracle set: bonding is refusing every quote, and it is config
//   ok          — priceCeiling() answers and the keeper poked within ORACLE_LATE_MULT × PERIOD
//   keeper-late — priceCeiling() still answers but the last poke is overdue: the keeper has halted
//                 and bonding WILL start refusing when staleness bites — the alarm with lead time
//   down        — priceCeiling() reverting (unset/stale/rebaselined/zero average): bonding is
//                 refusing every quote RIGHT NOW
//   unreachable — the RPC errored: not knowing is not the same as broken (never alert on it here;
//                 a persistently dead RPC already fails the chain sync loudly)
export function classifyOracleHealth({ oracleAddr, periodS, lastUpdateS, ceilingOk, nowS = Math.floor(Date.now() / 1000) }) {
  if (!oracleAddr || /^0x0{40}$/i.test(oracleAddr)) return { state: 'unset', note: 'the bond contract has no oracle set — every bond quote is refused' };
  const age = Math.max(0, nowS - Number(lastUpdateS));
  const lateAfter = Number(periodS) * ORACLE_LATE_MULT;
  const base = { oracleAddr, periodS: Number(periodS), ageS: age, lateAfterS: lateAfter };
  if (!ceilingOk) return { ...base, state: 'down', note: 'priceCeiling() is reverting — bonding is refusing every quote right now' };
  if (age > lateAfter) return { ...base, state: 'keeper-late', note: `the keeper has not poked update() in ${age}s (> ${lateAfter}s) — bonding still works but will refuse when staleness bites` };
  return { ...base, state: 'ok' };
}
export async function bondOracleHealth() {
  if (!process.env.CHAIN_RPC_URL || !process.env.OMERTA_BOND_ADDRESS || !isAddress(process.env.OMERTA_BOND_ADDRESS)) return { state: 'dormant' };
  try {
    const { createPublicClient, http } = await import('viem');
    const client = createPublicClient({ transport: http(process.env.CHAIN_RPC_URL) });
    // the wrong-chain guard (the makeBondPriceReader posture): a reading off a colliding deploy on
    // another chain is worse than none, because it looks authoritative
    if (process.env.CHAIN_ID && Number(process.env.CHAIN_ID) !== Number(await client.getChainId())) return { state: 'dormant' };
    const bond = getAddress(process.env.OMERTA_BOND_ADDRESS);
    const bondAbi = [
      { type: 'function', name: 'oracle', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
      { type: 'function', name: 'priceCeiling', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }, { type: 'uint256' }] },
    ];
    const oracleAddr = await client.readContract({ address: bond, abi: bondAbi, functionName: 'oracle' });
    if (!oracleAddr || /^0x0{40}$/i.test(oracleAddr)) return classifyOracleHealth({ oracleAddr });
    const oAbi = [
      { type: 'function', name: 'PERIOD', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint32' }] },
      { type: 'function', name: 'lastUpdate', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
    ];
    const [periodS, lastUpdateS] = await Promise.all([
      client.readContract({ address: oracleAddr, abi: oAbi, functionName: 'PERIOD' }),
      client.readContract({ address: oracleAddr, abi: oAbi, functionName: 'lastUpdate' }),
    ]);
    let ceilingOk = true;
    try { await client.readContract({ address: bond, abi: bondAbi, functionName: 'priceCeiling' }); } catch { ceilingOk = false; }
    return classifyOracleHealth({ oracleAddr, periodS, lastUpdateS, ceilingOk });
  } catch (e) { return { state: 'unreachable', note: e.message }; }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE ON-CHAIN SPLITS (red team #9 F1) — the raw numbers, no lever knowledge, so this file stays free
// of the economy constants. `vig.js:splitParity` does the comparison, because that is where the
// levers live and a restatement here is the class preflight's own ledger exists to stop.
//
// WHY IT MATTERS: `OmertaFees.vigBps` and `OmertaBond.polBps/devBps/rwaBps` are IMMUTABLE, hand-set at
// a deploy that no script covers — and the backend RESTATES them. For a bond the booking is
// event-authoritative (`toPol`/`toDev`/`toRwa`/`toVig` all ride `Bonded`), so a divergence corrupts
// only the DECLARED waterfall; for a gameplay fee the event carries the gross ALONE, so
// `recordVigRevenue` derives the share from `VIG_BPS` and a divergence directly mis-books the
// withdrawal reserve's funding source. Nothing anywhere compared the two.
export async function onchainSplits() {
  const rpc = process.env.CHAIN_RPC_URL;
  if (!rpc) return { state: 'dormant' };
  const fees = process.env.OMERTA_FEES_ADDRESS;
  const bond = process.env.OMERTA_BOND_ADDRESS;
  if (!(fees && isAddress(fees)) && !(bond && isAddress(bond))) return { state: 'dormant' };
  try {
    const { createPublicClient, http } = await import('viem');
    const client = createPublicClient({ transport: http(rpc) });
    // the wrong-chain guard (the bondOracleHealth posture): a reading off a colliding deploy on
    // another chain is worse than none, because it looks authoritative
    if (process.env.CHAIN_ID && Number(process.env.CHAIN_ID) !== Number(await client.getChainId())) return { state: 'dormant' };
    const u = (name) => ({ type: 'function', name, stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] });
    const out = { state: 'ok' };
    if (fees && isAddress(fees)) {
      out.feeVigBps = Number(await client.readContract({ address: getAddress(fees), abi: [u('vigBps')], functionName: 'vigBps' }));
    }
    if (bond && isAddress(bond)) {
      const abi = [u('polBps'), u('devBps'), u('rwaBps')];
      const [pol, dev, rwa] = await Promise.all([
        client.readContract({ address: getAddress(bond), abi, functionName: 'polBps' }),
        client.readContract({ address: getAddress(bond), abi, functionName: 'devBps' }),
        client.readContract({ address: getAddress(bond), abi, functionName: 'rwaBps' }),
      ]);
      out.bondPolBps = Number(pol); out.bondDevBps = Number(dev); out.bondRwaBps = Number(rwa);
    }
    return out;
  } catch (e) { return { state: 'unreachable', note: e.message }; }
}

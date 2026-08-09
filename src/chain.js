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
import { hashTypedData, recoverTypedDataAddress, parseUnits, isAddress, getAddress, verifyMessage, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { GameError, ledger } from './game.js';
import { reconcileFees } from './fees.js';
import { reconcileStore } from './store.js';
import { reconcileBonds } from './bonds.js';

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
import { MARKET, BONDS, bondPayout, TAX, withdrawTaxBps, nftTokenId, dayOf } from './rules.js';
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
  const r = await pool.query("UPDATE vouchers SET claimed_onchain=true, status='claimed' WHERE nonce=$1 AND status='signed' RETURNING id", [nonce]);
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
    const expired = (await client.query(
      "SELECT id, account_id, kind, amount, gear_id, nonce FROM vouchers WHERE status='signed' AND NOT claimed_onchain AND deadline < $1", [cutoff])).rows;
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
        } else {
          await client.query('UPDATE account_gear SET minted_onchain=false WHERE account_id=$1 AND gear_id=$2', [v.account_id, v.gear_id]);
          gearRestored++;
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const acct = (await client.query('SELECT wallet_address FROM account_persistent WHERE account_id=$1 FOR UPDATE', [accountId])).rows[0];
    if (!acct) throw new GameError('no_account', 'No such account.');
    const payer = acct.wallet_address;
    if (!payer || !isAddress(payer)) throw new GameError('wallet', 'Link a wallet (SIWE) first — a bond quote is bound to your wallet.');
    // the live OMR-per-ETH oracle (the latest Vig buyback TWAP off-chain; the DEX TWAP on mainnet).
    const last = (await client.query('SELECT price_omr_per_eth FROM vig_buyback ORDER BY created_at DESC LIMIT 1')).rows[0];
    let price = last ? round6(Number(last.price_omr_per_eth)) : null;
    if (!(price != null && Number.isFinite(price) && price > 0))
      throw new GameError('price', 'No live OMR-ETH price yet — bonding opens once the buyback prints one.');
    // WALL 4 PARITY. The contract judges this quote against its own TWAP; sign above that and the
    // bond reverts on-chain no matter how healthy this server looks. So when the bond chain is live,
    // CLAMP to what the contract will actually accept. Clamping DOWN only ever issues LESS OMR per
    // ETH than our own feed thought was fair, so the safe direction is the automatic one — and a
    // chain that is currently refusing every bond (unset/stale/broken oracle) is reported plainly
    // rather than papered over with a quote that cannot land.
    const priceReader = await makeBondPriceReader();
    if (priceReader) {
      let onchain = null;
      try { onchain = await priceReader.ceiling(); } catch {
        throw new GameError('oracle', 'The on-chain price oracle is not reporting — bonding is paused until it recovers.');
      }
      if (!(onchain?.oraclePrice > 0)) throw new GameError('oracle', 'The on-chain price oracle has no usable reading — bonding is paused.');
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
      if (price > onchain.oraclePrice) price = round6(onchain.oraclePrice);
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

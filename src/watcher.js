// §11 chain-event sync — the reliable replacement for raw `watchEvent` (audit F2/F3).
//
// Two failure modes it closes: (F3) a fee paid while the worker was down was never credited
// because watchEvent starts at head with no memory — a player loses real ETH; (F2) a reorged
// `Claimed` freed reserve the backend then over-signed against, because watchEvent has no
// confirmation depth. This module instead POLLS getLogs over a persisted block cursor, always
// staying `confirmations` behind head, so downtime backfills and a shallow reorg is never acted
// on. recordFeePayment / markClaimed are idempotent (nonce / claimed PK), so reprocessing an
// overlapping range on restart is a harmless no-op — the cursor advance need not be atomic.
//
// The chain specifics (viem getLogs + ABI decode) live in a `source` adapter the caller passes,
// so the cursor / confirmation / idempotency logic here is unit-testable with a mock source.
import { recordFeePayment } from './fees.js';
import { recordBond } from './bonds.js';
import { recordHarvestFee } from './treasury.js';
import { confirmStockDelivered } from './stockdeliver.js';
import { markClaimed, reimportItem, markDeedExtracted, reimportDeed, recordDeedTransfer } from './chain.js';

export const DEFAULT_CONFIRMATIONS = Number(process.env.CHAIN_CONFIRMATIONS || 5);

// (red-team R14 F2) Per-log isolation. recordFeePayment throws on a DETERMINISTIC data fault
// (bad_fee_kind / bad_payer / bad_nonce) BEFORE its idempotency txn — a single malformed log
// would then throw every tick, the cursor would never advance, and every legit fee behind it
// would be permanently stuck (a DoS on the whole fee pipeline). Skip a poison log (it can never
// succeed) but RE-THROW a transient error (a DB timeout / serialization failure) so the cursor
// does NOT advance and the block window re-scans idempotently next tick — never losing a real fee.
const POISON = new Set(['bad_fee_kind', 'bad_payer', 'bad_nonce', 'min', 'discount', 'payout']);
async function isolate(label, apply) {
  try { await apply(); return true; }
  catch (e) {
    if (POISON.has(e?.code)) { console.error(`watcher: skipping poison ${label} log (${e.code})`, e.message); return false; }
    throw e; // transient — stop the tick, do NOT advance the cursor
  }
}

export async function getCursor(pool, stream, initIfMissing) {
  const row = (await pool.query('SELECT last_block FROM chain_cursor WHERE stream=$1', [stream])).rows[0];
  if (row) return Number(row.last_block);
  const seed = Number(initIfMissing || 0);
  await pool.query('INSERT INTO chain_cursor (stream, last_block) VALUES ($1,$2)', [stream, seed]);
  return seed;
}
async function setCursor(pool, stream, block) {
  await pool.query(
    `INSERT INTO chain_cursor (stream, last_block) VALUES ($1,$2)
       ON CONFLICT (stream) DO UPDATE SET last_block=$2`, [stream, Math.floor(block)]);
}

// Compute the [from,to] window to scan this tick: everything after the cursor, up to
// `confirmations` blocks behind head. Returns null when there's nothing safe to process yet.
async function windowFor(pool, source, stream, confirmations, startBlock) {
  const head = Number(await source.head());
  const safeHead = head - confirmations;
  // first run with no cursor: seed at the configured start block (deploy block) so we don't
  // scan from genesis, but never ahead of the safe head.
  const from = (await getCursor(pool, stream, startBlock ?? safeHead)) + 1;
  if (safeHead < from) return null;
  return { from, to: safeHead, head };
}

// Sync fee payments: MintFeePaid / RespawnFeePaid → recordFeePayment (idempotent on nonce).
// `source.feeLogs(from,to)` returns normalized [{ kind:'mint'|'respawn', nonce, payer, amount, txHash }].
export async function syncFeeEvents(pool, source, opts = {}) {
  const confirmations = opts.confirmations ?? DEFAULT_CONFIRMATIONS;
  const w = await windowFor(pool, source, 'fees', confirmations, opts.startBlock);
  if (!w) return { processed: 0 };
  const logs = await source.feeLogs(w.from, w.to);
  let processed = 0;
  for (const l of logs) {
    if (await isolate('fee', () => recordFeePayment(pool, { nonce: l.nonce, kind: l.kind, payer: l.payer, amountWei: l.amount, txHash: l.txHash }))) processed++;
  }
  await setCursor(pool, 'fees', w.to);
  return { processed, from: w.from, to: w.to };
}

// Sync Claimed(nonce,…) → markClaimed (idempotent), staying `confirmations` behind head so a
// reorged claim can't prematurely free reserve. `source.claimedLogs(from,to)` → [{ nonce }].
export async function syncClaimedEvents(pool, source, opts = {}) {
  const confirmations = opts.confirmations ?? DEFAULT_CONFIRMATIONS;
  const w = await windowFor(pool, source, 'claimed', confirmations, opts.startBlock);
  if (!w) return { processed: 0 };
  const logs = await source.claimedLogs(w.from, w.to);
  let processed = 0;
  // (red-team R19 F3) per-log isolation symmetry with syncFeeEvents — a deterministic-poison log is
  // skipped (can never succeed) while a transient error re-throws so the cursor doesn't advance past a
  // good log. markClaimed has little deterministic-throw surface today, but this closes the asymmetry.
  for (const l of logs) { if (await isolate('claimed', () => markClaimed(pool, Number(l.nonce)))) processed++; }
  await setCursor(pool, 'claimed', w.to);
  return { processed, from: w.from, to: w.to };
}

// Sync GearVault Redeemed(from, tokenId, amount) → reimportItem (Option A, NFT re-import). Stays
// `confirmations` behind head so a reorged burn can't leave a live in-game row behind (§3 guard). The
// event carries no nonce, so the ref is txHash:logIndex (the harvest-fee discipline); reimportItem is
// idempotent on it. `source.redeemedLogs(from,to)` → [{ ref, from, tokenId, amount, txHash }]. Dormant
// unless GEARVAULT_ADDRESS is set. Per-log isolation: a malformed/undecodable event is handled inside
// reimportItem (logged, no throw → cursor advances); a real DB fault re-throws → cursor holds, re-scan.
export async function syncRedeemedEvents(pool, source, opts = {}) {
  const confirmations = opts.confirmations ?? DEFAULT_CONFIRMATIONS;
  const w = await windowFor(pool, source, 'redeemed', confirmations, opts.startBlock);
  if (!w) return { processed: 0 };
  const logs = await source.redeemedLogs(w.from, w.to);
  let processed = 0;
  for (const l of logs) {
    if (await isolate('redeemed', () => reimportItem(pool, { ref: l.ref, from: l.from, tokenId: l.tokenId, amount: l.amount }))) processed++;
  }
  await setCursor(pool, 'redeemed', w.to);
  return { processed, from: w.from, to: w.to };
}

// Sync StreetDeed Extracted(nonce, to, tokenId, name, district) → markDeedExtracted (deed minted
// on-chain: state 2→3, free the extractor to claim a new street). Idempotent (re-key by state). Its OWN
// cursor stream + address (STREET_DEED_ADDRESS), distinct from the OMR VoucherClaim `claimed` stream.
// Dormant unless STREET_DEED_ADDRESS is set. `source.deedExtractedLogs(from,to)` → [{ nonce, tokenId }].
export async function syncDeedExtractedEvents(pool, source, opts = {}) {
  const confirmations = opts.confirmations ?? DEFAULT_CONFIRMATIONS;
  const w = await windowFor(pool, source, 'deed_extracted', confirmations, opts.startBlock);
  if (!w) return { processed: 0 };
  const logs = await source.deedExtractedLogs(w.from, w.to);
  let processed = 0;
  for (const l of logs) {
    if (await isolate('deed_extracted', () => markDeedExtracted(pool, { nonce: l.nonce, tokenId: l.tokenId }))) processed++;
  }
  await setCursor(pool, 'deed_extracted', w.to);
  return { processed, from: w.from, to: w.to };
}

// Sync StreetDeed Redeemed(from, tokenId) → reimportDeed (a deed burned back into the game: state 3→1
// on the burner's deedless account). The burn is the ownership proof (no server signature); the ref is
// txHash:logIndex (reimportDeed is idempotent on it). Its own cursor stream + address. Stays
// `confirmations` behind head (a reorged burn must not leave a live in-game deed). Dormant unless
// STREET_DEED_ADDRESS is set. `source.deedRedeemedLogs(from,to)` → [{ ref, from, tokenId }].
export async function syncDeedRedeemedEvents(pool, source, opts = {}) {
  const confirmations = opts.confirmations ?? DEFAULT_CONFIRMATIONS;
  const w = await windowFor(pool, source, 'deed_redeemed', confirmations, opts.startBlock);
  if (!w) return { processed: 0 };
  const logs = await source.deedRedeemedLogs(w.from, w.to);
  let processed = 0;
  for (const l of logs) {
    if (await isolate('deed_redeemed', () => reimportDeed(pool, { ref: l.ref, from: l.from, tokenId: l.tokenId }))) processed++;
  }
  await setCursor(pool, 'deed_redeemed', w.to);
  return { processed, from: w.from, to: w.to };
}

// Sync StreetDeed Transfer(from, to, tokenId) → recordDeedTransfer (the SECONDARY MARKET stream:
// keep `onchain_owner` current so a deed sold on a marketplace stops being its extractor's stock
// delivery target, and put the sale on the deed's public legend). Its own cursor; recordDeedTransfer
// is replay-safe (IS DISTINCT FROM), so a re-scanned window is a no-op. Burns are skipped inside the
// recorder (the Redeemed stream owns them). Dormant unless STREET_DEED_ADDRESS is set.
// `source.deedTransferLogs(from,to)` → [{ from, to, tokenId }].
export async function syncDeedTransferEvents(pool, source, opts = {}) {
  const confirmations = opts.confirmations ?? DEFAULT_CONFIRMATIONS;
  const w = await windowFor(pool, source, 'deed_transfer', confirmations, opts.startBlock);
  if (!w) return { processed: 0 };
  const logs = await source.deedTransferLogs(w.from, w.to);
  let processed = 0;
  for (const l of logs) {
    if (await isolate('deed_transfer', () => recordDeedTransfer(pool, { tokenId: l.tokenId, to: l.to, from: l.from }))) processed++;
  }
  await setCursor(pool, 'deed_transfer', w.to);
  return { processed, from: w.from, to: w.to };
}

// (The afterSwap→Vig trade-fee stream is RETIRED — founder-directed 2026-08-11. Two hooks wanted
// one canonical pool and the four-slice sell tax won; the payer is deleted rather than dormant.
// See the retirement note in rules.tail.js. `'trade'` stays a declared VIG_SOURCE for history.)

// Sync THE BANK's HarvestFeeTaken(user, recipient, amount) → recordHarvestFee (source='harvest',
// idempotent on the log key, real-only). The event carries no nonce, so the ref is txHash:logIndex —
// the sell-tax discipline. Booked in the market's UNDERLYING, never mirrored into the ETH ledger:
// `rwa_revenue`'s sum IS the vault's `held` wall, so a USDC amount landing there would inflate the
// one number that bounds what players may be owed. Dormant unless ALCHEMIST_ADDRESS is set.
export async function syncHarvestFees(pool, source, opts = {}) {
  const confirmations = opts.confirmations ?? DEFAULT_CONFIRMATIONS;
  const w = await windowFor(pool, source, 'harvest', confirmations, opts.startBlock);
  if (!w) return { processed: 0 };
  const logs = await source.harvestFeeLogs(w.from, w.to);
  let processed = 0;
  // per-log isolation, symmetric with the fee/bond streams (red-team R19 F3): a deterministically
  // poison log is skipped so the cursor is not stalled forever by one bad row; a transient error
  // re-throws so the cursor does not advance past a good one.
  for (const l of logs) {
    if (await isolate('harvest', () => recordHarvestFee(pool, {
      ref: l.ref, asset: l.asset, amount: l.amount, payer: l.payer, txHash: l.txHash,
    }))) processed++;
  }
  await setCursor(pool, 'harvest', w.to);
  return { processed, from: w.from, to: w.to };
}

// Sync StockVault Delivered(deliveryId, token, to, units) → confirmStockDelivered (brokers §3.4): a
// staged stock delivery into a player's Street Deed TBA is now confirmed on-chain, so flip the row to
// 'delivered' + flip the allocation. The event carries only deliveryId (the reverse-map to
// epoch/account/ticker is the pre-staged row), so a Delivered log for a delivery this backend never
// staged (an out-of-band send) is a clean no-op. Idempotent on the deliveryId. Same cursor +
// confirmation-depth + per-log isolation. Dormant unless STOCK_VAULT_ADDRESS is set.
// `source.stockDeliveredLogs(from,to)` → [{ deliveryId, txHash }].
export async function syncStockDeliveredEvents(pool, source, opts = {}) {
  const confirmations = opts.confirmations ?? DEFAULT_CONFIRMATIONS;
  const w = await windowFor(pool, source, 'stock_delivered', confirmations, opts.startBlock);
  if (!w) return { processed: 0 };
  const logs = await source.stockDeliveredLogs(w.from, w.to);
  let processed = 0;
  for (const l of logs) {
    if (await isolate('stock_delivered', () => confirmStockDelivered(pool, { deliveryId: l.deliveryId, txHash: l.txHash }))) processed++;
  }
  await setCursor(pool, 'stock_delivered', w.to);
  return { processed, from: w.from, to: w.to };
}

// Sync Bonded(bondId, payer, nonce, principal, payout, toPol, toDev, toRwa, toVig) → recordBond (idempotent on
// nonce), booking the on-chain-AUTHORITATIVE payout + the FOUR-WAY split (the event carries no price/discount, so the
// watcher books what the contract actually did — the `onchainPayout` path in recordBond). Same cursor +
// confirmation-depth + per-log isolation discipline as the fee stream. Dormant unless OMERTA_BOND_ADDRESS
// is set. `source.bondLogs(from,to)` → [{ nonce, payer, principalEth, payoutOmr, polEth, devEth, rwaEth, vigEth, txHash }].
export async function syncBondEvents(pool, source, opts = {}) {
  const confirmations = opts.confirmations ?? DEFAULT_CONFIRMATIONS;
  const w = await windowFor(pool, source, 'bonds', confirmations, opts.startBlock);
  if (!w) return { processed: 0 };
  const logs = await source.bondLogs(w.from, w.to);
  let processed = 0;
  // (red-team R19 F3) per-log isolation symmetry with syncFeeEvents — a deterministic-poison bond log
  // (bad_payer/bad_nonce/min/discount/payout) is skipped; a transient error re-throws so the cursor
  // doesn't advance past a good log. recordBond's tranche cap is BYPASSED on the on-chain path (the
  // chain already enforced it), so a real bond is never rejected here — the cursor can't stall on it.
  for (const l of logs) {
    if (await isolate('bond', () => recordBond(pool, {
      nonce: l.nonce, payer: l.payer, principalEth: l.principalEth,
      onchainPayout: l.payoutOmr, onchainPol: l.polEth, onchainDev: l.devEth, onchainRwa: l.rwaEth,
      onchainVig: l.vigEth, txHash: l.txHash,
    }))) processed++;
  }
  await setCursor(pool, 'bonds', w.to);
  return { processed, from: w.from, to: w.to };
}

// Build the viem-backed source adapter used in production (kept thin: the tested logic is above).
// Returns null unless a real RPC + the relevant contract addresses are configured.
export async function makeViemSource() {
  if (!process.env.CHAIN_RPC_URL) return null;
  const { createPublicClient, http, parseAbiItem, formatUnits } = await import('viem');
  const client = createPublicClient({ transport: http(process.env.CHAIN_RPC_URL) });
  const feesAddr = process.env.OMERTA_FEES_ADDRESS;
  const claimAddr = process.env.VOUCHER_CLAIM_ADDRESS;
  const bondAddr = process.env.OMERTA_BOND_ADDRESS;    // the OmertaBond contract (Bonded events)
  const gearVaultAddr = process.env.GEARVAULT_ADDRESS; // GearVault (Redeemed events — NFT re-import)
  const streetDeedAddr = process.env.STREET_DEED_ADDRESS; // StreetDeed (Extracted/Redeemed — the deed NFT)
  const alchAddr = process.env.ALCHEMIST_ADDRESS;      // THE BANK's Alchemist (HarvestFeeTaken)
  const stockVaultAddr = process.env.STOCK_VAULT_ADDRESS; // StockVault (Delivered — stock into a deed TBA)
  const alchAsset = process.env.ALCHEMIST_ASSET || 'USDC';       // the market's underlying symbol
  const alchDecimals = Number(process.env.ALCHEMIST_ASSET_DECIMALS || 6); // USDC is 6, not 18
  const mintEv = parseAbiItem('event MintFeePaid(address indexed payer, uint256 indexed nonce, uint256 amount)');
  const respawnEv = parseAbiItem('event RespawnFeePaid(address indexed payer, uint256 indexed nonce, uint256 amount)');
  const rerollEv = parseAbiItem('event RerollFeePaid(address indexed payer, uint256 indexed nonce, uint256 amount)');
  const claimedEv = parseAbiItem('event Claimed(uint256 indexed nonce, address indexed to, uint8 kind, uint256 amount, uint256 gearId)');
  const harvestEv = parseAbiItem('event HarvestFeeTaken(address indexed user, address indexed recipient, uint256 amount)');
  const bondEv = parseAbiItem('event Bonded(uint256 indexed bondId, address indexed payer, uint256 indexed nonce, uint256 principal, uint256 payout, uint256 toPol, uint256 toDev, uint256 toRwa, uint256 toVig)');
  const redeemedEv = parseAbiItem('event Redeemed(address indexed from, uint256 indexed tokenId, uint256 amount)');
  const deedExtractedEv = parseAbiItem('event Extracted(uint256 indexed nonce, address indexed to, uint256 indexed tokenId, string name, string district)');
  const deedRedeemedEv = parseAbiItem('event Redeemed(address indexed from, uint256 indexed tokenId)');
  const erc721TransferEv = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');
  const deliveredEv = parseAbiItem('event Delivered(uint256 indexed deliveryId, address indexed token, address indexed to, uint256 units)');
  const range = (from, to) => ({ fromBlock: BigInt(from), toBlock: BigInt(to) });
  // wei / 1e18-decimal-OMR → ETH / in-game $OMR units, via viem's decimal-exact formatter (Number() alone
  // on a >2^53 wei bigint loses low-order digits; formatUnits keeps full precision, then recordBond round6's).
  const w18 = (v) => Number(formatUnits(v, 18));
  return {
    head: () => client.getBlockNumber(),
    feeLogs: async (from, to) => {
      if (!feesAddr) return [];
      const [mints, respawns, rerolls] = await Promise.all([
        client.getLogs({ address: feesAddr, event: mintEv, ...range(from, to) }),
        client.getLogs({ address: feesAddr, event: respawnEv, ...range(from, to) }),
        client.getLogs({ address: feesAddr, event: rerollEv, ...range(from, to) }),
      ]);
      const norm = (kind) => (l) => ({ kind, nonce: Number(l.args.nonce), payer: l.args.payer,
        amount: l.args.amount?.toString(), txHash: l.transactionHash });
      return [...mints.map(norm('mint')), ...respawns.map(norm('respawn')), ...rerolls.map(norm('reroll'))];
    },
    claimedLogs: async (from, to) => {
      if (!claimAddr) return [];
      const logs = await client.getLogs({ address: claimAddr, event: claimedEv, ...range(from, to) });
      return logs.map((l) => ({ nonce: Number(l.args.nonce) }));
    },
    harvestFeeLogs: async (from, to) => {
      if (!alchAddr) return [];
      const logs = await client.getLogs({ address: alchAddr, event: harvestEv, ...range(from, to) });
      // The event carries no nonce, so the ref is the log key. Decimals come from config because the
      // market's underlying is not always 18 — reading a 6-decimal USDC amount as 18 would understate
      // the fee by a factor of a trillion, which is the sort of thing that looks like "no revenue yet".
      return logs.map((l) => ({
        ref: `${l.transactionHash}:${l.logIndex}`,
        asset: alchAsset,
        amount: Number(formatUnits(l.args.amount, alchDecimals)),
        payer: l.args.user,
        txHash: l.transactionHash,
      }));
    },
    bondLogs: async (from, to) => {
      if (!bondAddr) return [];
      const logs = await client.getLogs({ address: bondAddr, event: bondEv, ...range(from, to) });
      return logs.map((l) => ({
        nonce: Number(l.args.nonce), payer: l.args.payer,
        principalEth: w18(l.args.principal), payoutOmr: w18(l.args.payout),
        polEth: w18(l.args.toPol), devEth: w18(l.args.toDev), rwaEth: w18(l.args.toRwa), vigEth: w18(l.args.toVig),
        txHash: l.transactionHash,
      }));
    },
    stockDeliveredLogs: async (from, to) => {
      if (!stockVaultAddr) return [];
      const logs = await client.getLogs({ address: stockVaultAddr, event: deliveredEv, ...range(from, to) });
      // deliveryId can exceed 2^53 (it is a keccak) — keep it a decimal string, exactly as it was
      // stored at stage time (`deliveryIdFor`), so the reverse-map lookup matches.
      return logs.map((l) => ({ deliveryId: l.args.deliveryId?.toString(), txHash: l.transactionHash }));
    },
    redeemedLogs: async (from, to) => {
      if (!gearVaultAddr) return [];
      const logs = await client.getLogs({ address: gearVaultAddr, event: redeemedEv, ...range(from, to) });
      // no nonce → ref is the log key (the harvest-fee discipline). amount is small (a car/boat count),
      // so Number() is exact; tokenId can exceed 2^53, so keep it a string.
      return logs.map((l) => ({ ref: `${l.transactionHash}:${l.logIndex}`, from: l.args.from,
        tokenId: l.args.tokenId?.toString(), amount: Number(l.args.amount), txHash: l.transactionHash }));
    },
    deedExtractedLogs: async (from, to) => {
      if (!streetDeedAddr) return [];
      const logs = await client.getLogs({ address: streetDeedAddr, event: deedExtractedEv, ...range(from, to) });
      // nonce fits in 2^53 (a monotonic counter); tokenId is keccak(name) > 2^53 → keep it a string.
      return logs.map((l) => ({ nonce: Number(l.args.nonce), tokenId: l.args.tokenId?.toString() }));
    },
    deedRedeemedLogs: async (from, to) => {
      if (!streetDeedAddr) return [];
      const logs = await client.getLogs({ address: streetDeedAddr, event: deedRedeemedEv, ...range(from, to) });
      return logs.map((l) => ({ ref: `${l.transactionHash}:${l.logIndex}`, from: l.args.from,
        tokenId: l.args.tokenId?.toString(), txHash: l.transactionHash }));
    },
    deedTransferLogs: async (from, to) => {
      if (!streetDeedAddr) return [];
      const logs = await client.getLogs({ address: streetDeedAddr, event: erc721TransferEv, ...range(from, to) });
      return logs.map((l) => ({ from: l.args.from, to: l.args.to, tokenId: l.args.tokenId?.toString() }));
    },
  };
}

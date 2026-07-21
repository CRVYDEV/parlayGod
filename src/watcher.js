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
import { recordTradeFee } from './vig.js';
import { markClaimed } from './chain.js';

export const DEFAULT_CONFIRMATIONS = Number(process.env.CHAIN_CONFIRMATIONS || 5);

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
    await recordFeePayment(pool, { nonce: l.nonce, kind: l.kind, payer: l.payer, amountWei: l.amount, txHash: l.txHash });
    processed++;
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
  for (const l of logs) { await markClaimed(pool, Number(l.nonce)); processed++; }
  await setCursor(pool, 'claimed', w.to);
  return { processed, from: w.from, to: w.to };
}

// Sync the afterSwap→Vig hook's TradeFeePaid(nonce, amountWei) → recordTradeFee (source='trade',
// idempotent on the nonce, real-only — the watcher is the sole producer). Same cursor + confirmation-
// depth discipline as the fee stream. Dormant unless TRADE_FEE_HOOK_ADDRESS is set. Design §2.
export async function syncTradeFees(pool, source, opts = {}) {
  const confirmations = opts.confirmations ?? DEFAULT_CONFIRMATIONS;
  const w = await windowFor(pool, source, 'trades', confirmations, opts.startBlock);
  if (!w) return { processed: 0 };
  const logs = await source.tradeFeeLogs(w.from, w.to);
  let processed = 0;
  for (const l of logs) { await recordTradeFee(pool, { nonce: l.nonce, amountWei: l.amount }); processed++; }
  await setCursor(pool, 'trades', w.to);
  return { processed, from: w.from, to: w.to };
}

// Build the viem-backed source adapter used in production (kept thin: the tested logic is above).
// Returns null unless a real RPC + the relevant contract addresses are configured.
export async function makeViemSource() {
  if (!process.env.CHAIN_RPC_URL) return null;
  const { createPublicClient, http, parseAbiItem } = await import('viem');
  const client = createPublicClient({ transport: http(process.env.CHAIN_RPC_URL) });
  const feesAddr = process.env.OMERTA_FEES_ADDRESS;
  const claimAddr = process.env.VOUCHER_CLAIM_ADDRESS;
  const hookAddr = process.env.TRADE_FEE_HOOK_ADDRESS; // the OMR/ETH pool's afterSwap→Vig hook
  const mintEv = parseAbiItem('event MintFeePaid(address indexed payer, uint256 indexed nonce, uint256 amount)');
  const respawnEv = parseAbiItem('event RespawnFeePaid(address indexed payer, uint256 indexed nonce, uint256 amount)');
  const claimedEv = parseAbiItem('event Claimed(uint256 indexed nonce, address indexed to, uint8 kind, uint256 amount, uint256 gearId)');
  const tradeEv = parseAbiItem('event TradeFeePaid(uint256 indexed nonce, uint256 amountWei)');
  const range = (from, to) => ({ fromBlock: BigInt(from), toBlock: BigInt(to) });
  return {
    head: () => client.getBlockNumber(),
    feeLogs: async (from, to) => {
      if (!feesAddr) return [];
      const [mints, respawns] = await Promise.all([
        client.getLogs({ address: feesAddr, event: mintEv, ...range(from, to) }),
        client.getLogs({ address: feesAddr, event: respawnEv, ...range(from, to) }),
      ]);
      const norm = (kind) => (l) => ({ kind, nonce: Number(l.args.nonce), payer: l.args.payer,
        amount: l.args.amount?.toString(), txHash: l.transactionHash });
      return [...mints.map(norm('mint')), ...respawns.map(norm('respawn'))];
    },
    claimedLogs: async (from, to) => {
      if (!claimAddr) return [];
      const logs = await client.getLogs({ address: claimAddr, event: claimedEv, ...range(from, to) });
      return logs.map((l) => ({ nonce: Number(l.args.nonce) }));
    },
    tradeFeeLogs: async (from, to) => {
      if (!hookAddr) return [];
      const logs = await client.getLogs({ address: hookAddr, event: tradeEv, ...range(from, to) });
      return logs.map((l) => ({ nonce: Number(l.args.nonce), amount: l.args.amountWei?.toString(), txHash: l.transactionHash }));
    },
  };
}

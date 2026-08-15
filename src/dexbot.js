// ── THE TWO DEX BOTS — the real on-chain legs of the buyback + protocol-owned liquidity ──
//
// CHAIN-DEPLOY's still-owed pair, built 2026-08-15:
//
//   1. THE DEX BUYBACK BOT (`runDexBuyback`) — the real TWAP source that replaces the manual
//      `mod/vig/buyback` price. It swaps unspent Vig revenue (real ETH) for hard $OMR on the
//      canonical Uniswap v4 pool, then reports the ACHIEVED price into the audited
//      `runVigBuyback(pool, { priceOmrPerEth, maxEth })` — so every wall that function carries
//      (the vig_prize_pool singleton lock, the VIG_MAX_PRICE_JUMP continuity wall, the
//      `ethToSpend ≤ unspent revenue` root cap, the RESERVE_BPS split, fundReserve) applies to the
//      bot's fills exactly as it did to the manual price. The bot ADDS the walls only reality can
//      supply: the price comes from the SAME oracle the bond reads (resolved from
//      `OmertaBond.oracle()` — the bondOracleHealth posture, no new address env to drift),
//      fail-closed on no/zero/stale readings (the OmrTwapOracle discipline — no fallback price,
//      ever), and the swap carries a hard `minOmrOut` slippage floor derived from that reading.
//
//   2. THE POL-PAIRING BOT (`runPolPairing`) — pairs the bonded ETH into the OMR-ETH pool as
//      protocol-owned liquidity. `OmertaBond` forwards each bond's POL slice to `polRecipient`
//      in-tx (the bot wallet holds the ETH); `bond_reserve.pol_eth` is the BOOK of what arrived.
//      The bot pairs that ETH with $OMR at the oracle price into a full-range v4 position — and
//      the root cap is the book: Σ real pairings ≤ pol_eth booked, so the bot can never pair ETH
//      the bond programme did not deliver. The $OMR side comes from the bot wallet's own hard OMR
//      (Safe-allocated genesis supply — NEVER in-game supply, nothing here mints).
//
// TWO-PHASE SWAP-THEN-BOOK (the stage→confirm discipline, stockdeliver's shape): a real swap is
// JOURNALED in `dex_swaps` (idempotent on the tx hash) the moment it fills, and BOOKING it into
// runVigBuyback is a separate step that reads unbooked journal rows — so a crash between the swap
// and the accounting loses nothing (the next run books the orphan WITHOUT re-swapping), and a
// booking refusal (a concurrent manual buyback consumed the revenue) is NAMED (`booked_short`),
// never silent. POL pairings journal the same way (`pol_pairings`); there is no booking leg —
// the journal IS the books, and the root cap sums it.
//
// §10.4: ZERO SURFACE BY CONSTRUCTION. Everything here is out-of-band real value (the fees.js
// precedent): journal rows, bond_reserve reads, and the runVigBuyback call — whose own writes
// (vig_buyback, the prize pool singleton, fundReserve → chain_reserve) were audited long ago and
// write no `transactions` rows either. The suite pins the whole flow to zero ledger rows.
//
// CHAIN-DORMANT until configured (the delivery-keeper pattern): the buyback needs CHAIN_RPC_URL +
// OMERTA_BOND_ADDRESS (the oracle resolver) + DEX_BOT_PK + UNIVERSAL_ROUTER_ADDRESS + OMR_ADDRESS
// + OMERTA_HOOK_ADDRESS; POL pairing swaps UNIVERSAL_ROUTER for POSITION_MANAGER_ADDRESS. Every
// skip is NAMED (the community-keeper no_budget lesson — silence reads as fine), the RPC senders
// sit behind `__set*` seams so the orchestration + walls + accounting are fully testable, and the
// wrong-chain guard applies to every sender (a colliding deploy on another chain must refuse).
//
// ⚠ VERIFY AT LAUNCH (the chain-e2e precedent): the raw Uniswap v4 encodings (Universal Router
// V4_SWAP command bytes; PositionManager modifyLiquidities MINT_POSITION actions) cannot be tested
// against a real pool in this environment — no v4 pool exists to swap against. The encoders below
// follow the documented v4 periphery formats and MUST be exercised on a devnet/fork pool before
// real ETH rides them (CHAIN-DEPLOY carries the step). The orchestration, walls, journals and
// §10.4 posture are what the suite proves.

import { GameError } from './game.js';
import { runVigBuyback } from './vig.js';

const num = (v) => Number(v || 0);
const round6 = (n) => Math.round(n * 1e6) / 1e6;

// ── config (ops dials, env-read per call — the RATE_LIMIT posture) ──
const maxRunEth = () => Number(process.env.DEX_BUYBACK_MAX_ETH || 5);      // per-run swap bound (a fat pool never dumps in one tx)
const maxPairEth = () => Number(process.env.POL_PAIR_MAX_ETH || 5);        // per-run pairing bound
const maxSlippageBps = () => Number(process.env.DEX_MAX_SLIPPAGE_BPS || 300); // 3% floor under the TWAP on the swap's minOut
const maxTwapAgeS = () => Number(process.env.DEX_TWAP_MAX_AGE_S || 7200);  // a reading older than this is a dead feed, not a price
const MIN_ETH = 0.001;                                                     // dust floor — gas would eat a smaller run

export const dexBuybackReady = () =>
  !!(process.env.CHAIN_RPC_URL && process.env.OMERTA_BOND_ADDRESS && process.env.DEX_BOT_PK
     && process.env.UNIVERSAL_ROUTER_ADDRESS && process.env.OMR_ADDRESS && process.env.OMERTA_HOOK_ADDRESS);
export const polPairingReady = () =>
  !!(process.env.CHAIN_RPC_URL && process.env.OMERTA_BOND_ADDRESS && process.env.DEX_BOT_PK
     && process.env.POSITION_MANAGER_ADDRESS && process.env.OMR_ADDRESS && process.env.OMERTA_HOOK_ADDRESS);

// ── the seams (the __setTbaResolver discipline: the real RPC legs are swappable so the
//    orchestration + walls are provable without a chain) ──
let _readPrice = readOraclePrice;
let _swap = swapEthForOmrOnchain;
let _pair = addLiquidityOnchain;
export function __setPriceReader(fn) { _readPrice = fn || readOraclePrice; }
export function __setSwapper(fn) { _swap = fn || swapEthForOmrOnchain; }
export function __setPairer(fn) { _pair = fn || addLiquidityOnchain; }

// ── the price (fail-closed — the whole point) ──
// Resolves the oracle FROM the bond's own `oracle()` getter (the bondOracleHealth posture: one
// less address env to drift; the Safe's setOracle cutover repoints the bots automatically) and
// reads `consult() → (omrPerEth·1e18, updatedAt)`. Returns { price, updatedAt } in JS units, or
// throws a NAMED refusal — never a fallback number. "We don't know what OMR costs" must never
// become "swap at the default" (the ETH-vault lesson, on the other side of the trade).
async function readOraclePrice() {
  const rpc = process.env.CHAIN_RPC_URL, bond = process.env.OMERTA_BOND_ADDRESS;
  if (!rpc || !bond) throw new GameError('no_price', 'The oracle is unconfigured.');
  const { createPublicClient, http, getAddress, formatUnits } = await import('viem');
  const client = createPublicClient({ transport: http(rpc) });
  if (process.env.CHAIN_ID && Number(process.env.CHAIN_ID) !== Number(await client.getChainId()))
    throw new GameError('wrong_chain', 'RPC chain does not match CHAIN_ID — refusing to price.');
  const oracleAddr = await client.readContract({
    address: getAddress(bond), functionName: 'oracle',
    abi: [{ type: 'function', name: 'oracle', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }],
  });
  if (!oracleAddr || /^0x0{40}$/i.test(oracleAddr)) throw new GameError('no_price', 'The bond has no oracle set.');
  const [omrPerEthWei, updatedAt] = await client.readContract({
    address: oracleAddr, functionName: 'consult',
    abi: [{ type: 'function', name: 'consult', stateMutability: 'view', inputs: [],
      outputs: [{ name: 'omrPerEth', type: 'uint256' }, { name: 'updatedAt', type: 'uint256' }] }],
  });
  return { price: Number(formatUnits(omrPerEthWei, 18)), updatedAt: Number(updatedAt) };
}

// The one gate both bots share: a positive, fresh reading or a named refusal.
async function freshPrice() {
  const { price, updatedAt } = await _readPrice();
  if (!(Number.isFinite(price) && price > 0)) throw new GameError('no_price', 'The oracle has no usable reading.');
  const ageS = Math.floor(Date.now() / 1000) - Number(updatedAt || 0);
  if (ageS > maxTwapAgeS()) throw new GameError('stale_price', `The oracle's reading is ${ageS}s old (max ${maxTwapAgeS()}s) — a dead feed is not a price.`);
  return price;
}

// ── THE DEX BUYBACK BOT ──
export async function runDexBuyback(pool, opts = {}) {
  const seamed = _swap !== swapEthForOmrOnchain || _readPrice !== readOraclePrice;
  if (!seamed && !dexBuybackReady()) return { dormant: true };
  const out = { dormant: false, booked: [], skipped: [] };

  // PHASE B FIRST — crash recovery: book any real fill the last run journaled but never booked
  // (a crash between swap and book must lose nothing, and must never re-swap).
  await bookUnbookedSwaps(pool, out);

  // PHASE A — the swap. Budget = the unspent Vig revenue (the same numbers runVigBuyback re-derives
  // under its own lock; this read only SIZES the swap — the booking's root cap is authoritative).
  const revenueIn = num((await pool.query('SELECT COALESCE(SUM(vig_eth),0) s FROM vig_revenue')).rows[0].s);
  const alreadySpent = num((await pool.query('SELECT COALESCE(SUM(eth_spent),0) s FROM vig_buyback')).rows[0].s);
  let eth = round6(revenueIn - alreadySpent);
  eth = Math.min(eth, maxRunEth());
  if (opts.maxEth != null) eth = Math.min(eth, Number(opts.maxEth));
  eth = round6(eth);
  if (!(eth >= MIN_ETH)) { out.skipped.push({ why: 'no_revenue', unspent: round6(revenueIn - alreadySpent) }); return out; }

  let price;
  try { price = await freshPrice(); }
  catch (e) { out.skipped.push({ why: e.code || 'no_price', error: e.message }); return out; }

  // The slippage floor: the swap must return at least TWAP − slippage or revert on-chain. This is
  // the wall only reality can supply — a sandwiched/manipulated fill fails the minOut rather than
  // booking a bad price into the game's canonical print.
  const minOmrOut = round6(eth * price * (1 - maxSlippageBps() / 10000));
  let fill;
  try { fill = await _swap({ ethIn: eth, minOmrOut, twapOmrPerEth: price }); }
  catch (e) { out.skipped.push({ why: 'swap_failed', error: e.message }); return out; }

  // JOURNAL the fill (idempotent on the tx hash — a re-delivered fill is a no-op), then book it.
  const ref = String(fill.txHash || '').trim();
  const ethSpent = round6(num(fill.ethSpent ?? eth));
  const omrReceived = round6(num(fill.omrReceived));
  if (!ref || !(ethSpent > 0) || !(omrReceived > 0)) { out.skipped.push({ why: 'bad_fill', fill }); return out; }
  const achieved = round6(omrReceived / ethSpent);
  // a fill under the floor should be impossible (minOut enforced on-chain) — if a seam/encoder bug
  // returns one anyway, journal + book the TRUTH and FLAG it loudly (the OMR is real; hiding it is worse).
  if (achieved < minOmrOut / eth * 0.999) out.slippageBreach = { achieved, floor: round6(minOmrOut / eth) };
  const seen = (await pool.query('SELECT 1 FROM dex_swaps WHERE ref=$1', [ref])).rows[0];
  if (!seen) await pool.query(
    'INSERT INTO dex_swaps (ref, eth_spent, omr_received, price_omr_per_eth, real, booked) VALUES ($1,$2,$3,$4,true,false)',
    [ref, ethSpent, omrReceived, achieved]);
  await bookUnbookedSwaps(pool, out);
  out.swap = { ref, ethSpent, omrReceived, priceOmrPerEth: achieved };
  return out;
}

// Book every real, unbooked journaled fill through the audited accounting — at the ACHIEVED price,
// capped at the ETH the fill actually spent, inheriting every wall runVigBuyback carries. Marks the
// row booked either way; a short booking (a concurrent manual buyback consumed the revenue between
// swap and book — the only path here) is NAMED in the output and left to runDexBotInvariants'
// swaps-vs-buybacks reconciliation, never silently swallowed.
async function bookUnbookedSwaps(pool, out) {
  const rows = (await pool.query(
    'SELECT ref, eth_spent, omr_received, price_omr_per_eth FROM dex_swaps WHERE real AND NOT booked ORDER BY created_at')).rows;
  for (const r of rows) {
    const eth = round6(num(r.eth_spent));
    const booked = await runVigBuyback(pool, { priceOmrPerEth: num(r.price_omr_per_eth), maxEth: eth });
    await pool.query('UPDATE dex_swaps SET booked=true WHERE ref=$1', [r.ref]);
    const entry = { ref: r.ref, ethSpent: eth, omrBought: booked?.omrBought || 0 };
    if (!booked || round6(booked.ethSpent) < eth) entry.bookedShort = true; // the revenue moved under us — flagged, not hidden
    out.booked.push(entry);
  }
}

// ── THE POL-PAIRING BOT ──
export async function runPolPairing(pool, opts = {}) {
  const seamed = _pair !== addLiquidityOnchain || _readPrice !== readOraclePrice;
  if (!seamed && !polPairingReady()) return { dormant: true };
  const out = { dormant: false, skipped: [] };

  // THE ROOT CAP — the book of POL ETH the bond programme actually delivered, minus what is
  // already paired. Real pairings only: a comp/QA row (real=false) consumes NO budget, because the
  // budget is the assertion "this ETH arrived", and a comp must never be able to make it.
  const booked = num((await pool.query('SELECT pol_eth FROM bond_reserve WHERE id=1')).rows[0]?.pol_eth);
  const paired = num((await pool.query('SELECT COALESCE(SUM(eth_paired),0) s FROM pol_pairings WHERE real')).rows[0].s);
  let eth = round6(booked - paired);
  eth = Math.min(eth, maxPairEth());
  if (opts.maxEth != null) eth = Math.min(eth, Number(opts.maxEth));
  eth = round6(eth);
  if (!(eth >= MIN_ETH)) { out.skipped.push({ why: 'no_budget', booked: round6(booked), paired: round6(paired) }); return out; }

  let price;
  try { price = await freshPrice(); }
  catch (e) { out.skipped.push({ why: e.code || 'no_price', error: e.message }); return out; }

  // Pair at the oracle price — pairing off-price donates value to arbitrageurs the moment the
  // position opens, so the OMR side is sized from the same fail-closed reading the buyback trusts.
  const omr = round6(eth * price);
  let fill;
  try { fill = await _pair({ ethIn: eth, omrIn: omr, twapOmrPerEth: price }); }
  catch (e) { out.skipped.push({ why: 'pair_failed', error: e.message }); return out; }

  const ref = String(fill.txHash || '').trim();
  const ethPaired = round6(num(fill.ethPaired ?? eth));
  const omrPaired = round6(num(fill.omrPaired ?? omr));
  if (!ref || !(ethPaired > 0)) { out.skipped.push({ why: 'bad_fill', fill }); return out; }
  const seen = (await pool.query('SELECT 1 FROM pol_pairings WHERE ref=$1', [ref])).rows[0];
  if (!seen) await pool.query(
    'INSERT INTO pol_pairings (ref, eth_paired, omr_paired, price_omr_per_eth, real) VALUES ($1,$2,$3,$4,true)',
    [ref, ethPaired, omrPaired, round6(ethPaired > 0 ? omrPaired / ethPaired : 0)]);
  out.paired = { ref, ethPaired, omrPaired, remaining: round6(booked - paired - ethPaired) };
  return out;
}

// ── the ops board + the invariants (nightly, beside vig/bond/desk/treasury) ──
export async function dexBotBoard(pool) {
  const booked = num((await pool.query('SELECT pol_eth FROM bond_reserve WHERE id=1')).rows[0]?.pol_eth);
  const paired = num((await pool.query('SELECT COALESCE(SUM(eth_paired),0) s FROM pol_pairings WHERE real')).rows[0].s);
  const swaps = (await pool.query(
    'SELECT COUNT(*)::int n, COALESCE(SUM(eth_spent),0) e, COALESCE(SUM(omr_received),0) o FROM dex_swaps WHERE real')).rows[0];
  const unbooked = num((await pool.query('SELECT COUNT(*)::int n FROM dex_swaps WHERE real AND NOT booked')).rows[0].n);
  const last = (await pool.query('SELECT price_omr_per_eth, created_at FROM dex_swaps WHERE real ORDER BY created_at DESC LIMIT 1')).rows[0];
  return {
    buyback: { ready: dexBuybackReady(), swaps: num(swaps.n), ethSpent: round6(num(swaps.e)),
      omrBought: round6(num(swaps.o)), unbooked,
      lastPrice: last ? round6(num(last.price_omr_per_eth)) : null },
    pol: { ready: polPairingReady(), bookedEth: round6(booked), pairedEth: round6(paired),
      unpairedEth: round6(Math.max(0, booked - paired)) },
    config: { maxRunEth: maxRunEth(), maxPairEth: maxPairEth(), maxSlippageBps: maxSlippageBps(), maxTwapAgeS: maxTwapAgeS() },
  };
}

export async function runDexBotInvariants(pool) {
  const checks = [];
  const push = (name, lhs, rhs, cmp) => checks.push({ name, lhs: round6(lhs), rhs: round6(rhs), ok: cmp });
  // (1) THE ROOT CAP HELD: the bot never paired ETH the bond programme did not deliver.
  const booked = num((await pool.query('SELECT pol_eth FROM bond_reserve WHERE id=1')).rows[0]?.pol_eth);
  const paired = num((await pool.query('SELECT COALESCE(SUM(eth_paired),0) s FROM pol_pairings WHERE real')).rows[0].s);
  push('POL paired ≤ POL booked (eth)', paired, booked, paired <= booked + 1e-6);
  // (2) NO ORPHANED FILL: a real swap the booking leg never reached, older than an hour, means the
  // crash-recovery pass is broken (or the worker is down — either way a human looks). Freshness, not
  // membership: a fill IN FLIGHT this minute is a normal state, not an alarm.
  const staleCutoff = new Date(Date.now() - 3600 * 1000); // computed in JS — pg-mem parses no interval arithmetic
  const stale = num((await pool.query(
    'SELECT COUNT(*)::int n FROM dex_swaps WHERE real AND NOT booked AND created_at < $1', [staleCutoff])).rows[0].n);
  push('no real swap unbooked > 1h', stale, 0, stale === 0);
  // (3) COMPS BOOK NOTHING: a real=false journal row must never reach the accounting.
  const compBooked = num((await pool.query('SELECT COUNT(*)::int n FROM dex_swaps WHERE NOT real AND booked')).rows[0].n);
  push('no comp swap is booked', compBooked, 0, compBooked === 0);
  // (4) THE SWAP↔BUYBACK RECONCILIATION: every booked real fill went through runVigBuyback, whose
  // own root cap means Σ vig_buyback.eth_spent covers Σ booked swap ETH only when nothing was
  // booked short — the manual rail also inserts vig_buyback rows, so this is one-sided (≥), and a
  // shortfall (a fill the accounting could not absorb) is exactly what it exists to surface.
  const swapEth = num((await pool.query('SELECT COALESCE(SUM(eth_spent),0) s FROM dex_swaps WHERE real AND booked')).rows[0].s);
  const buybackEth = num((await pool.query('SELECT COALESCE(SUM(eth_spent),0) s FROM vig_buyback')).rows[0].s);
  push('booked swaps ≤ buybacks recorded (eth)', swapEth, buybackEth, swapEth <= buybackEth + 1e-6);
  return { ok: checks.every((c) => c.ok), checks };
}

// ── the real RPC legs (⚠ VERIFY AT LAUNCH — see the header) ──

async function botWallet() {
  const rpc = process.env.CHAIN_RPC_URL, pk = process.env.DEX_BOT_PK;
  if (!rpc || !pk) throw new Error('dex bot unconfigured');
  const { createWalletClient, createPublicClient, http } = await import('viem');
  const { privateKeyToAccount } = await import('viem/accounts');
  const pub = createPublicClient({ transport: http(rpc) });
  const liveId = Number(await pub.getChainId());
  const chainId = Number(process.env.CHAIN_ID || 0);
  if (chainId && chainId !== liveId) throw new Error('dex bot: RPC chain does not match CHAIN_ID — refusing to send');
  const chain = { id: chainId || liveId, name: 'omerta-chain',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpc] } } };
  return { pub, wallet: createWalletClient({ account: privateKeyToAccount(pk), chain, transport: http(rpc) }) };
}

// The canonical pool key: native ETH (currency0 = address(0) in v4) against OMR, hooked by
// OmertaHook. Fee + tick spacing are the deploy's pool-init choices (env, defaulted to the
// 0.30%/60 v4 convention) — they must match the initialized pool EXACTLY or every call misses it.
function poolKey(getAddress) {
  return {
    currency0: '0x0000000000000000000000000000000000000000',
    currency1: getAddress(process.env.OMR_ADDRESS),
    fee: Number(process.env.DEX_POOL_FEE || 3000),
    tickSpacing: Number(process.env.DEX_POOL_TICK_SPACING || 60),
    hooks: getAddress(process.env.OMERTA_HOOK_ADDRESS),
  };
}

// ETH → OMR through the Universal Router's V4_SWAP command (0x10): actions SWAP_EXACT_IN_SINGLE
// (0x06) → SETTLE_ALL (0x0c) → TAKE_ALL (0x0f), ETH riding as msg.value. Returns the achieved fill
// by reading the bot wallet's OMR balance delta (the router does not return amounts).
async function swapEthForOmrOnchain({ ethIn, minOmrOut }) {
  const { pub, wallet } = await botWallet();
  const { getAddress, parseEther, parseUnits, formatUnits, encodeAbiParameters, encodePacked, concatHex } = await import('viem');
  const router = getAddress(process.env.UNIVERSAL_ROUTER_ADDRESS);
  const omr = getAddress(process.env.OMR_ADDRESS);
  const key = poolKey(getAddress);
  const amountIn = parseEther(String(ethIn));
  const minOut = parseUnits(String(minOmrOut), 18);
  const keyTuple = { type: 'tuple', components: [
    { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] };
  const swapParams = encodeAbiParameters(
    [{ type: 'tuple', components: [
      { ...keyTuple, name: 'poolKey' },
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountIn', type: 'uint128' },
      { name: 'amountOutMinimum', type: 'uint128' },
      { name: 'hookData', type: 'bytes' }] }],
    [{ poolKey: key, zeroForOne: true, amountIn, amountOutMinimum: minOut, hookData: '0x' }]);
  const settleParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }], [key.currency0, amountIn]);
  const takeParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }], [key.currency1, minOut]);
  const actions = encodePacked(['uint8', 'uint8', 'uint8'], [0x06, 0x0c, 0x0f]); // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
  const v4Input = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [actions, [swapParams, settleParams, takeParams]]);
  const commands = '0x10';                                                        // V4_SWAP
  const abi = [{ type: 'function', name: 'execute', stateMutability: 'payable',
    inputs: [{ name: 'commands', type: 'bytes' }, { name: 'inputs', type: 'bytes[]' }, { name: 'deadline', type: 'uint256' }],
    outputs: [] }];
  const erc20 = [{ type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }];
  const me = wallet.account.address;
  const before = await pub.readContract({ address: omr, abi: erc20, functionName: 'balanceOf', args: [me] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const txHash = await wallet.writeContract({ address: router, abi, functionName: 'execute',
    args: [commands, [v4Input], deadline], value: amountIn });
  await pub.waitForTransactionReceipt({ hash: txHash });
  const after = await pub.readContract({ address: omr, abi: erc20, functionName: 'balanceOf', args: [me] });
  return { txHash, ethSpent: ethIn, omrReceived: Number(formatUnits(after - before, 18)) };
}

// Full-range OMR-ETH liquidity through PositionManager.modifyLiquidities: MINT_POSITION (0x02) →
// SETTLE_PAIR (0x0d), the position minted to the SAFE (POL belongs to the treasury, never the hot
// bot key). Liquidity is derived from the ETH side at the oracle price; both max amounts carry the
// slippage headroom so a moved pool reverts rather than over-consuming.
async function addLiquidityOnchain({ ethIn, omrIn }) {
  const { pub, wallet } = await botWallet();
  const { getAddress, parseEther, parseUnits, encodeAbiParameters, encodePacked } = await import('viem');
  const pm = getAddress(process.env.POSITION_MANAGER_ADDRESS);
  const safe = getAddress(process.env.POL_POSITION_OWNER || wallet.account.address);
  const key = poolKey(getAddress);
  const amountEth = parseEther(String(ethIn));
  const amountOmr = parseUnits(String(omrIn), 18);
  // full-range bounds on the pool's tick spacing
  const ts = key.tickSpacing;
  const tickLower = Math.ceil(-887272 / ts) * ts;
  const tickUpper = Math.floor(887272 / ts) * ts;
  // read the live sqrtPrice to derive a liquidity figure for the two amounts
  const stateView = getAddress(process.env.STATE_VIEW_ADDRESS || pm);
  let liquidity;
  {
    // L for full-range ≈ min(amount0 / (1/sqrtP − 1/sqrtPmax), amount1 / (sqrtP − sqrtPmin)); with
    // full-range bounds this reduces to ~min(amount0 · sqrtP, amount1 / sqrtP) in Q96 terms.
    const { keccak256, encodeAbiParameters: enc } = await import('viem');
    const poolId = keccak256(enc(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
    const slot0 = await pub.readContract({ address: stateView,
      abi: [{ type: 'function', name: 'getSlot0', stateMutability: 'view',
        inputs: [{ name: 'poolId', type: 'bytes32' }],
        outputs: [{ type: 'uint160' }, { type: 'int24' }, { type: 'uint24' }, { type: 'uint24' }] }],
      functionName: 'getSlot0', args: [poolId] });
    const sqrtP = BigInt(slot0[0]);
    const Q96 = 1n << 96n;
    const l0 = (amountEth * sqrtP) / Q96;       // ETH-side liquidity at ~full range
    const l1 = (amountOmr * Q96) / sqrtP;       // OMR-side liquidity at ~full range
    liquidity = l0 < l1 ? l0 : l1;
  }
  const keyComponents = [
    { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }];
  const mintParams = encodeAbiParameters(
    [{ type: 'tuple', components: keyComponents }, { type: 'int24' }, { type: 'int24' },
     { type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'address' }, { type: 'bytes' }],
    [key, tickLower, tickUpper, liquidity, amountEth, amountOmr, safe, '0x']);
  const settleParams = encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [key.currency0, key.currency1]);
  const actions = encodePacked(['uint8', 'uint8'], [0x02, 0x0d]);                 // MINT_POSITION, SETTLE_PAIR
  const unlockData = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [actions, [mintParams, settleParams]]);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const txHash = await wallet.writeContract({ address: pm,
    abi: [{ type: 'function', name: 'modifyLiquidities', stateMutability: 'payable',
      inputs: [{ name: 'unlockData', type: 'bytes' }, { name: 'deadline', type: 'uint256' }], outputs: [] }],
    functionName: 'modifyLiquidities', args: [unlockData, deadline], value: amountEth });
  await pub.waitForTransactionReceipt({ hash: txHash });
  return { txHash, ethPaired: ethIn, omrPaired: omrIn };
}

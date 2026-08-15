// THE TWO DEX BOTS (src/dexbot.js) — the real on-chain legs of the Vig buyback + protocol-owned
// liquidity. This suite proves the fully-testable core through the __set* seams (the raw v4
// encoders are the mainnet edge, VERIFY-AT-LAUNCH per CHAIN-DEPLOY): the buyback's budget sizing +
// slippage floor + two-phase swap-then-book (a crash between the real swap and the accounting
// loses nothing AND never re-swaps), the ACHIEVED price reaching the audited runVigBuyback (whose
// reserve split funds chain_reserve), the fail-closed oracle gates (no price / stale price — never
// a fallback number), the POL root cap (Σ real pairings ≤ bond_reserve.pol_eth — the bot can never
// pair ETH the bond programme did not deliver), comps consuming nothing, the invariants runner
// failing by name, dormancy without env, and §10.4-NEUTRALITY (the whole flow writes ZERO
// transactions rows).
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { makeDb } from '../src/db.js';
import {
  runDexBuyback, runPolPairing, dexBotBoard, runDexBotInvariants,
  __setPriceReader, __setSwapper, __setPairer,
} from '../src/dexbot.js';

const pool = await makeDb();
const q = (sql, args) => pool.query(sql, args);
const one = async (sql, args) => Number((await q(sql, args)).rows[0].s);
const txCount = async () => Number((await q('SELECT COUNT(*) n FROM transactions')).rows[0].n);
const checkOf = async (name) => (await runDexBotInvariants(pool)).checks.find((c) => c.name === name);

// ── the seams: a fresh oracle print + instrumented swap/pair legs ──
let priceNow = { price: 500, updatedAt: Math.floor(Date.now() / 1000) };
__setPriceReader(async () => priceNow);
const swapCalls = [];
let swapImpl = async ({ ethIn }) => ({ txHash: `0xswap${swapCalls.length}`, ethSpent: ethIn, omrReceived: ethIn * 495 });
__setSwapper(async (args) => { swapCalls.push(args); return swapImpl(args); });
const pairCalls = [];
let pairImpl = async ({ ethIn, omrIn }) => ({ txHash: `0xpol${pairCalls.length}`, ethPaired: ethIn, omrPaired: omrIn });
__setPairer(async (args) => { pairCalls.push(args); return pairImpl(args); });

const tx0 = await txCount();

// ════════════ THE BUYBACK — budget, slippage floor, journal, booking, reserve ════════════
{
  await q("INSERT INTO vig_revenue (source, ref, kind, gross_eth, vig_eth) VALUES ('fee','dex-rev-1','fee',3,2)");
  const reserve0 = await one('SELECT COALESCE(SUM(funded_omr),0) s FROM chain_reserve');
  const out = await runDexBuyback(pool);
  assert.equal(out.dormant, false);
  // the swap was sized to the UNSPENT revenue (2 ETH, under the 5-ETH per-run cap)...
  assert.equal(swapCalls.length, 1, 'exactly one swap');
  assert.equal(swapCalls[0].ethIn, 2, 'the swap spends exactly the unspent Vig revenue');
  // ...and carried the slippage floor: TWAP 500 − 3% = 485/ETH → minOut 970 on 2 ETH
  assert.equal(swapCalls[0].minOmrOut, 970, 'minOmrOut = eth × TWAP × (1 − DEX_MAX_SLIPPAGE_BPS)');
  // the fill was journaled AND booked at the ACHIEVED price (990 OMR / 2 ETH = 495, not the TWAP)
  const j = (await q('SELECT * FROM dex_swaps WHERE ref=$1', [out.swap.ref])).rows[0];
  assert.ok(j.real && j.booked, 'the fill is journaled real + booked');
  assert.equal(Number(j.price_omr_per_eth), 495);
  const vb = (await q('SELECT * FROM vig_buyback ORDER BY created_at DESC LIMIT 1')).rows[0];
  assert.equal(Number(vb.eth_spent), 2, 'the booking spent exactly the fill ETH');
  assert.equal(Number(vb.price_omr_per_eth), 495, 'the booking rides the ACHIEVED price, never the TWAP');
  assert.equal(Number(vb.omr_bought), 990);
  // the audited split fired: RESERVE_BPS (50%) of the bought OMR funded the withdrawal reserve
  const reserve1 = await one('SELECT COALESCE(SUM(funded_omr),0) s FROM chain_reserve');
  assert.equal(reserve1 - reserve0, 495, 'the reserve split rode the booking (fundReserve)');
  assert.equal(out.booked.length, 1);
  assert.ok(!out.booked[0].bookedShort, 'a clean booking is not flagged short');
}

// ════════════ THE ROOT CAP — a second run finds no revenue and swaps nothing ════════════
{
  const out = await runDexBuyback(pool);
  assert.equal(swapCalls.length, 1, 'no revenue → no swap');
  assert.equal(out.skipped[0]?.why, 'no_revenue', 'a spent budget refuses by name');
  assert.equal(out.skipped[0].unspent, 0);
}

// ════════════ FAIL-CLOSED — a stale print refuses; no fallback price, no swap ════════════
{
  await q("INSERT INTO vig_revenue (source, ref, kind, gross_eth, vig_eth) VALUES ('fee','dex-rev-2','fee',1,1)");
  priceNow = { price: 500, updatedAt: Math.floor(Date.now() / 1000) - 8000 }; // older than DEX_TWAP_MAX_AGE_S (7200)
  const out = await runDexBuyback(pool);
  assert.equal(out.skipped[0]?.why, 'stale_price', 'a stale print refuses BY NAME');
  assert.equal(swapCalls.length, 1, 'a stale print never swaps');
  priceNow = { price: 500, updatedAt: Math.floor(Date.now() / 1000) };        // fresh again for what follows
}

// ════════════ CRASH RECOVERY — an orphaned fill books WITHOUT re-swapping ════════════
// Simulate a crash between swap and book: a real, unbooked journal row whose ETH matches the
// still-unspent revenue. The next run must book it (at ITS achieved price) and never call the
// swapper — booking consumes the revenue, so phase A finds nothing to swap.
{
  await q("INSERT INTO dex_swaps (ref, eth_spent, omr_received, price_omr_per_eth, real, booked) VALUES ('0xorphan',1,500,500,true,false)");
  swapImpl = async () => { throw new Error('re-swap! the orphan should have been booked, not re-bought'); };
  const out = await runDexBuyback(pool);
  const orphan = (await q("SELECT booked FROM dex_swaps WHERE ref='0xorphan'")).rows[0];
  assert.ok(orphan.booked, 'the orphaned fill was booked by the recovery pass');
  const vb = (await q('SELECT * FROM vig_buyback ORDER BY created_at DESC LIMIT 1')).rows[0];
  assert.equal(Number(vb.eth_spent), 1, 'the orphan booked its own ETH');
  assert.equal(Number(vb.price_omr_per_eth), 500, 'the orphan booked at its own achieved price');
  assert.equal(swapCalls.length, 1, 'recovery never re-swaps');
  assert.equal(out.skipped[0]?.why, 'no_revenue', 'booking the orphan consumed the revenue — nothing left to swap');
  swapImpl = async ({ ethIn }) => ({ txHash: `0xswap${swapCalls.length}`, ethSpent: ethIn, omrReceived: ethIn * 495 });
}

// ════════════ THE POL BOT — the root cap is the bond programme's books ════════════
{
  await q('UPDATE bond_reserve SET pol_eth = 3 WHERE id=1');
  const out = await runPolPairing(pool);
  assert.equal(pairCalls.length, 1);
  assert.equal(pairCalls[0].ethIn, 3, 'pairs exactly the unpaired POL budget');
  assert.equal(pairCalls[0].omrIn, 1500, 'the OMR side is sized at the oracle price');
  assert.equal(out.paired.remaining, 0);
  const row = (await q('SELECT * FROM pol_pairings WHERE ref=$1', [out.paired.ref])).rows[0];
  assert.ok(row.real, 'a real pairing journals real');
  // the ROOT CAP: a second run finds no budget — the bot can never pair ETH the bond did not deliver
  const out2 = await runPolPairing(pool);
  assert.equal(out2.skipped[0]?.why, 'no_budget',
    'the ROOT CAP: a fully-paired book must refuse — the bot never pairs ETH the bond did not deliver');
  assert.equal(pairCalls.length, 1, 'no budget → no pairing');
  // new bond POL arrives → the bot pairs ONLY the remainder (the mutation target: drop the
  // `− paired` term from the budget and this fails by name)
  await q('UPDATE bond_reserve SET pol_eth = 4 WHERE id=1');
  const out3 = await runPolPairing(pool);
  assert.equal(pairCalls[1].ethIn, 1, 'a top-up pairs ONLY the remainder, never the whole book again');
  assert.equal(out3.paired.ethPaired, 1);
  // a comp/QA row (real=false) consumes NO budget: with the book fully paired, a fat comp row
  // changes nothing — the budget query counts real rows only
  await q("INSERT INTO pol_pairings (ref, eth_paired, omr_paired, price_omr_per_eth, real) VALUES ('0xcomp',100,50000,500,false)");
  const out4 = await runPolPairing(pool);
  assert.equal(out4.skipped[0]?.why, 'no_budget', 'a comp row neither consumes nor frees budget');
  assert.equal(out4.skipped[0]?.paired, 4, 'the budget math counts REAL pairings only');
}

// ════════════ THE BOARD + THE INVARIANTS — each check fails by name ════════════
{
  const board = await dexBotBoard(pool);
  assert.equal(board.pol.bookedEth, 4);
  assert.equal(board.pol.pairedEth, 4);
  assert.equal(board.pol.unpairedEth, 0);
  assert.equal(board.buyback.swaps, 2);          // the seamed fill + the orphan
  assert.equal(board.buyback.ethSpent, 3);
  assert.equal(board.buyback.unbooked, 0);
  let inv = await runDexBotInvariants(pool);
  assert.ok(inv.ok, `all green: ${JSON.stringify(inv.checks.filter((c) => !c.ok))}`);
  // (1) the root cap breached → fails by name
  await q("INSERT INTO pol_pairings (ref, eth_paired, omr_paired, price_omr_per_eth, real) VALUES ('0xover',100,50000,500,true)");
  assert.equal((await checkOf('POL paired ≤ POL booked (eth)')).ok, false, 'an over-pair trips the root cap');
  await q("DELETE FROM pol_pairings WHERE ref='0xover'");
  // (2) an orphaned fill older than an hour → fails by name (a broken recovery pass, or a dead worker)
  await q("INSERT INTO dex_swaps (ref, eth_spent, omr_received, price_omr_per_eth, real, booked) VALUES ('0xstale',1,500,500,true,false)");
  await q('UPDATE dex_swaps SET created_at=$1 WHERE ref=$2', [new Date(Date.now() - 2 * 3600 * 1000), '0xstale']);
  assert.equal((await checkOf('no real swap unbooked > 1h')).ok, false, 'a stale orphan alarms');
  await q("DELETE FROM dex_swaps WHERE ref='0xstale'");
  // (3) a comp reaching the accounting → fails by name
  await q("INSERT INTO dex_swaps (ref, eth_spent, omr_received, price_omr_per_eth, real, booked) VALUES ('0xcompbooked',1,500,500,false,true)");
  assert.equal((await checkOf('no comp swap is booked')).ok, false, 'a booked comp alarms');
  await q("DELETE FROM dex_swaps WHERE ref='0xcompbooked'");
  inv = await runDexBotInvariants(pool);
  assert.ok(inv.ok, 'green again once the forced breaches are removed');
}

// ════════════ §10.4 — the whole flow writes ZERO transactions rows ════════════
// Everything above — swaps, bookings (runVigBuyback + fundReserve), pairings, invariants — is
// out-of-band real value. Not one in-game ledger row moved.
assert.equal(await txCount(), tx0, 'the DEX bots write ZERO transactions rows');

// ════════════ DORMANT — without seams or env, both bots sleep ════════════
{
  __setPriceReader(null); __setSwapper(null); __setPairer(null);
  assert.deepEqual(await runDexBuyback(pool), { dormant: true });
  assert.deepEqual(await runPolPairing(pool), { dormant: true });
}

console.log('dexbot: THE TWO DEX BOTS pass — buyback (budget/slippage/journal/book/reserve + root cap + fail-closed oracle + crash recovery), POL pairing (root cap + remainder-only + comps consume nothing), the board, the invariants failing by name, §10.4 zero rows, and dormancy.');
await pool.end();

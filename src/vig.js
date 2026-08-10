// Risk-to-Earn Phase 2 — THE VIG: the real-revenue redistribution engine (off-chain core).
// Design: omerta-phase2-vig-design.md. This is the piece that makes "a player can earn a small
// living" both real AND incapable of Axie-collapse. The single invariant it enforces:
//
//     cumulative $OMR players can withdraw ≤ cumulative $OMR the Vig bought with real revenue
//
// so extraction can never exceed inflow. We don't build a new safety mechanism — we re-source the
// EXISTING full-reserve withdrawal queue (chain.js) from spender revenue instead of team charity:
// real ETH in → the buyback buys hard $OMR → that $OMR funds the reserve → the queue can only sign
// what the reserve holds. This module does the ACCOUNTING and the INVARIANT; the real DEX swap is
// the mainnet bot's job (dormant until the chain is wired — the M6 pattern). Its DB writes are
// confined to vig_revenue / vig_buyback / vig_prize_pool + (via fundReserve) chain_reserve; real
// ETH and hard $OMR are out-of-band value, OUTSIDE the §10.4 in-game set (zero `transactions` rows
// here — the PLEX bridge, which used to burn IN-GAME $OMR, is retired; see below).
import crypto from 'node:crypto';
import { GameError, ledger } from './game.js';
import { TRADE_FEE } from './rules.js'; // the trade-fee split lever — the booking path must read the DECLARED constant (F1)
import { fundReserve } from './chain.js';

const uid = () => crypto.randomUUID();
const num = (x) => Number(x || 0);
const round6 = (x) => Math.round(x * 1e6) / 1e6;

// ── config (env-overridable, like chain.js; all founder sim + sign-off levers) ──
// VIG_BPS: the Vig's share of real revenue (the rest is dev/business). RESERVE_BPS: of each
// buyback's $OMR, how much backs withdrawals vs the season prize pool.
export const VIG_BPS = Number(process.env.VIG_BPS || 6000);         // 60% to the Vig (exported: the router derives the waterfall from the LIVE constant)
export const RESERVE_BPS = Number(process.env.VIG_RESERVE_BPS || 5000); // 50% of bought $OMR to the reserve (exported for the router)
// ── THE PLEX BRIDGE IS RETIRED (founder-directed 2026-08-10: "Make plex items and consumables eth
// only") ────────────────────────────────────────────────────────────────────────────────────────
// Every real-money price is now ETH. The mint went first, on the Sybil-bound argument; this finishes
// the job, and the reason it is right is that the bridge's ORIGINAL justification stopped being true
// two migrations ago.
//
// PLEX was sold as "ETH payers fund the pool, $OMR payers BURN supply — both support the token". That
// was accurate when sinks destroyed the token. Since economy v3 step 2 they do not: `plex:%` is in
// `DESK.SINK_REASONS`, so a PLEX purchase RECYCLES the $OMR onto the desk shelf, which sells it for
// ETH at the daily auction. So the real comparison was never "ETH now vs deflation" — it was
// **immediate certain ETH vs deferred uncertain ETH, minus the deflation that justified it**. Once
// stated that way there is nothing left to trade off.
//
// What it costs, honestly: the EVE "pay your rent in ISK" fantasy — a skilled player funding their
// play from earnings. That is a real loss and it is the reason to think twice. It is bounded by the
// fact that the FREE path never ran through this rail (the mission GRANTS a mint credit), and by
// $OMR keeping every IN-GAME use it had: dues, the estate, seals, the Wire, vanity, respec, and the
// held-stake ladder. The line is now simple enough to state in one sentence: **real money buys
// real-money things; $OMR buys in-game things.**
//
// Retired the standard way — the PAYERS are gone, the reasons stay (`plex:%` remains in the omr
// vocabulary, the burn term and SINK_REASONS forever, because real rows exist and conservation is a
// claim about the whole ledger), and `plex bridge retired` asserts nothing new uses them.
const MINT_FEE_ETH = Number(process.env.MINT_FEE_ETH || 0.01);
const RESPAWN_FEE_ETH = Number(process.env.RESPAWN_FEE_ETH || 0.10);

// The quote is GONE: there is no $OMR price for a real-money fee. Kept as an exported no-op so a
// caller gets `null` (a positive "no such price") rather than a crash.
export async function plexQuote() { return null; }

// The payer refuses. Deleted rather than left dormant behind a flag — a rail that merely sleeps is
// one env var from being live again (the emission.js rule).
export async function payPlex(ch, kind) {
  throw new GameError('retired',
    'Fees are ETH only. $OMR buys in-game things — dues, the compound, seals, the wire, vanity.');
}

// ── revenue ingestion (called inside recordFeePayment's txn; idempotent on source+ref) ──
// Records the Vig's share of one real-ETH payment. `client` is the caller's open transaction so
// the revenue row and the fee row commit together. Amounts arrive in wei (string) and are stored
// in ETH units to stay inside JS-safe-integer range for the accounting math.
export async function recordVigRevenue(client, { source, ref, kind, amountWei, bps }) {
  let grossEth = 0;
  try { grossEth = Number(BigInt(amountWei ?? '0')) / 1e18; } catch { grossEth = 0; }
  if (!(grossEth > 0)) return { recorded: false };
  // `bps` defaults to the gameplay-fee split; a source with its OWN declared split passes it
  // explicitly (ROUTER F1: recordTradeFee booked 60% while TRADE_FEE.VIG_BPS declares 100% —
  // the constant was read nowhere on the booking path, so 40% of every trade-fee gross would
  // have been booked to nobody. Chain-dormant, so zero real rows were wrong; the wiring was.)
  const vigEth = round6(grossEth * (bps ?? VIG_BPS) / 10000);
  // SELECT-then-INSERT (pg-mem's ON CONFLICT is unreliable) — a re-delivered fee event is a no-op
  const seen = (await client.query('SELECT 1 FROM vig_revenue WHERE source=$1 AND ref=$2', [source, String(ref)])).rows[0];
  if (seen) return { recorded: false, duplicate: true };
  await client.query(
    'INSERT INTO vig_revenue (source, ref, kind, gross_eth, vig_eth) VALUES ($1,$2,$3,$4,$5)',
    [source, String(ref), kind || null, round6(grossEth), vigEth]);
  return { recorded: true, vigEth };
}

// ── the afterSwap→Vig hook's revenue ingestion (the recordFeePayment twin; chain-dormant, watcher-driven) ──
// A `TradeFeePaid(nonce, amountWei)` log from the OMR/ETH pool's afterSwap hook → the Vig's share, through
// the SAME rail as gameplay fees (recordVigRevenue splits VIG_BPS, idempotent on source+ref). Design:
// omerta-uniswap-hooks-design.md §2. Security posture: there is NO mod route for trade fees BY DESIGN —
// the on-chain watcher is the ONLY producer, so unlike fees/store/bonds (which carry a QA mod route behind
// ALLOW_MOD_REAL_REVENUE) there is ZERO fabrication surface. A re-delivered / reorged log is a no-op.
export async function recordTradeFee(pool, { nonce, amountWei }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await recordVigRevenue(client, { source: 'trade', ref: nonce, kind: 'trade', amountWei, bps: TRADE_FEE.VIG_BPS });
    await client.query('COMMIT');
    return r;
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

const sumEth = async (pool, table, col, where = '') =>
  Number((await pool.query(`SELECT COALESCE(SUM(${col}),0) s FROM ${table} ${where}`)).rows[0].s);

// ── the buyback (the bot's accounting half) ──
// Spend the UNSPENT Vig revenue (revenue in − ETH already spent) on hard $OMR at `priceOmrPerEth`,
// split the $OMR to the withdrawal reserve + the prize pool, and record it. On mainnet the bot does
// the real DEX swap (TWAP, slippage-capped) and passes the achieved price; here the price is a
// parameter so the accounting is deterministic and testable. Never spends more ETH than came in —
// that hard cap (`ethToSpend ≤ unspent`) is the root of "extraction ≤ inflow".
export async function runVigBuyback(pool, { priceOmrPerEth, maxEth } = {}) {
  const price = Number(priceOmrPerEth);
  if (!(Number.isFinite(price) && price > 0)) throw new GameError('price', 'A buyback needs a positive $OMR/ETH price.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // lock the Vig singleton FIRST (before the spend-basis reads) so two concurrent buybacks (the
    // bot + a manual mod call, say) can't both read the same `alreadySpent` and each spend the full
    // unspent revenue → over-buy → unbacked reserve. payPrizes already locks this row first.
    await client.query('SELECT balance FROM vig_prize_pool WHERE id=1 FOR UPDATE');
    // (red-team R41 MED) `omrBought = ethToSpend × price` mints in-game $OMR (via the prize/reserve split)
    // that BOTH the §10.4 sweep and runVigInvariants read as legitimate — neither sanity-checks the price
    // against reality. A leaked/abused mod key passing a wildly inflated price would mint $OMR past real
    // inflow (breaking extraction-≤-inflow) invisibly. On mainnet the DEX bot supplies a real TWAP; a real
    // price has CONTINUITY between 12h buybacks — so once a first buyback establishes a reference, bound
    // each subsequent price to a generous factor of the last (up OR down). This is a fraud/fat-finger
    // sanity bound on the mod parameter, not a game-balance lever (env-configurable ops dial); the very
    // first buyback is the unavoidable bootstrap (Safe = root of trust). A real TWAP never trips 10×.
    const jump = Number(process.env.VIG_MAX_PRICE_JUMP) || 10;
    // ORDER BY created_at, NOT by id: `vig_buyback.id` is a random UUID, so `ORDER BY id DESC` reads
    // an ARBITRARY historical row rather than the last one — the wall would anchor on a random old
    // price (measured: after 12 buybacks it read the 7th, and a 50× call sailed through by anchoring
    // on a stale high print). Every CONSUMER of this price — the ETH vault, bond quotes, PLEX, the
    // exit toll — reads `created_at DESC`, so the wall must guard the same number they read.
    const last = Number((await client.query('SELECT price_omr_per_eth FROM vig_buyback ORDER BY created_at DESC LIMIT 1')).rows[0]?.price_omr_per_eth || 0);
    if (last > 0 && (price > last * jump || price < last / jump))
      throw new GameError('price_sanity', `Buyback price ${price} is more than ${jump}× off the last (${last}) — refusing (set VIG_MAX_PRICE_JUMP to override).`);
    const revenueIn = await sumEth(client, 'vig_revenue', 'vig_eth');
    const alreadySpent = await sumEth(client, 'vig_buyback', 'eth_spent');
    let ethToSpend = round6(revenueIn - alreadySpent);           // only ever spend money that came in
    if (maxEth != null) ethToSpend = Math.min(ethToSpend, Number(maxEth));
    if (!(ethToSpend > 0)) { await client.query('COMMIT'); return null; }
    const omrBought = round6(ethToSpend * price);
    const toReserve = round6(omrBought * RESERVE_BPS / 10000);
    const toPrize = round6(omrBought - toReserve);
    await client.query(
      'INSERT INTO vig_buyback (id, eth_spent, omr_bought, price_omr_per_eth, to_reserve, to_prize) VALUES ($1,$2,$3,$4,$5,$6)',
      [uid(), ethToSpend, omrBought, price, toReserve, toPrize]);
    await client.query('UPDATE vig_prize_pool SET balance = balance + $1 WHERE id=1', [toPrize]);
    await client.query('COMMIT');
    // fund the reserve OUTSIDE this txn (fundReserve opens its own) — it's the bridge to the queue
    if (toReserve > 0) await fundReserve(pool, toReserve);
    return { ethSpent: ethToSpend, omrBought, toReserve, toPrize };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// ── the PLEX bridge (pay a real-money fee in earned $OMR instead of ETH) ──
// ── season prize payout (from the prize pool, through the withdrawal rail) ──
// Pay a winner: credit their IN-GAME $OMR (a legal faucet `prize:omr`, like a mission reward) AND
// move the same hard $OMR from the prize pool to the withdrawal reserve to BACK it — so the prize
// is extractable and the reserve stays fully backed. `winners` = [{ accountId, omr }]. Bounded by
// the prize-pool balance (a prize can never exceed what the Vig actually bought for prizes).
export async function payPrizes(pool, winners) {
  const client = await pool.connect();
  let paid = 0, toReserve = 0;
  try {
    await client.query('BEGIN');
    const pp = (await client.query('SELECT balance FROM vig_prize_pool WHERE id=1 FOR UPDATE')).rows[0];
    let balance = num(pp.balance);
    for (const w of winners || []) {
      const omr = round6(Number(w.omr));
      if (!(omr > 0) || omr > balance) continue;              // never overpay the pool
      const acct = (await client.query('SELECT account_id FROM account_persistent WHERE account_id=$1 FOR UPDATE', [w.accountId])).rows[0];
      if (!acct) continue;
      await client.query('UPDATE account_persistent SET omr = omr + $2 WHERE account_id=$1', [w.accountId, omr]);
      await ledger(client, { accountId: w.accountId, currency: 'omr', amount: omr, reason: 'prize:omr' }); // in-game faucet, backed below
      balance = round6(balance - omr);
      paid = round6(paid + omr); toReserve = round6(toReserve + omr);
    }
    await client.query('UPDATE vig_prize_pool SET balance=$1, paid_total = paid_total + $2 WHERE id=1', [balance, paid]);
    await client.query('COMMIT');
    if (toReserve > 0) await fundReserve(pool, toReserve); // back the freshly-credited $OMR so it can be withdrawn
    return { paid, winners: (winners || []).length };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// ── read model ──
export async function vigStatus(pool) {
  const revenueIn = await sumEth(pool, 'vig_revenue', 'vig_eth');
  const grossIn = await sumEth(pool, 'vig_revenue', 'gross_eth');
  const ethSpent = await sumEth(pool, 'vig_buyback', 'eth_spent');
  const omrBought = await sumEth(pool, 'vig_buyback', 'omr_bought');
  const toReserve = await sumEth(pool, 'vig_buyback', 'to_reserve');
  const pp = (await pool.query('SELECT balance, paid_total FROM vig_prize_pool WHERE id=1')).rows[0] || {};
  return {
    grossRevenueEth: round6(grossIn), vigRevenueEth: round6(revenueIn),
    devRevenueEth: round6(grossIn - revenueIn),
    ethSpent: round6(ethSpent), unspentEth: round6(revenueIn - ethSpent),
    omrBought: round6(omrBought), toReserveTotal: round6(toReserve),
    prizePool: round6(num(pp.balance)), prizePaid: round6(num(pp.paid_total)),
    // EVERY real-money price is ETH now, so there is no implied $OMR rate for an operator to watch
    // and nothing for the two-rails guard to compare. `null` states that positively rather than
    // leaving a stale number somebody would read as a live price.
    config: { vigBps: VIG_BPS, reserveBps: RESERVE_BPS,
      plexMintOmr: null, plexRespawnOmr: null, mintOmrPerEth: null, respawnOmrPerEth: null },
  };
}

// ── the extraction ≤ inflow invariant (the second §10.4, on the REAL-value side) ──
// Proves the whole chain end-to-end. Any failure is a real-MONEY alarm, not a game-balance one.
export async function runVigInvariants(pool) {
  const checks = [];
  const push = (name, ok, detail = {}) => checks.push({ name, ok, ...detail });

  const revenueIn = round6(await sumEth(pool, 'vig_revenue', 'vig_eth'));
  const ethSpent = round6(await sumEth(pool, 'vig_buyback', 'eth_spent'));
  const omrBought = round6(await sumEth(pool, 'vig_buyback', 'omr_bought'));
  const toReserve = round6(await sumEth(pool, 'vig_buyback', 'to_reserve'));
  const toPrize = round6(await sumEth(pool, 'vig_buyback', 'to_prize'));
  const pp = (await pool.query('SELECT balance, paid_total FROM vig_prize_pool WHERE id=1')).rows[0] || {};
  const prizePaid = round6(num(pp.paid_total));
  const prizeBalance = round6(num(pp.balance));
  const funded = round6(Number((await pool.query('SELECT funded_omr FROM chain_reserve WHERE id=1')).rows[0].funded_omr));
  // signed + already-claimed withdrawal vouchers = hard $OMR that has left / is committed to leave
  const extracted = round6(Number((await pool.query(
    "SELECT COALESCE(SUM(amount),0) s FROM vouchers WHERE kind='omr' AND (status='signed' OR claimed_onchain)")).rows[0].s));

  // ECONOMY v3 STEP 4 — the reserve now has a SECOND legitimate source. The desk's band buyback buys
  // hard OMR off the market with POL fees and delivers it here, in the same transaction as the soft
  // shelf credit that pairs with it. Both checks below are EXACT (funded == the sum of its sources),
  // so a source the sandwich does not know about trips both of them at once — which is why this term
  // is added rather than the checks being loosened. `desk.js:runDeskInvariants` separately asserts
  // that every one of these hard tokens corresponds to a real purchase.
  // `WHERE real` matches the gate on the credit itself (desk.js: only a REAL buy funds the reserve).
  // The two must agree or the sandwich fires spuriously — which is the point: with both halves gated
  // this pair now CATCHES a comp-funded reserve instead of silently absorbing it.
  const deskToReserve = round6(await sumEth(pool, 'desk_buys', 'omr_bought', 'WHERE real'));

  const eps = 1e-6;
  // (1) the bot never spends more ETH than the Vig received — the root cap
  push('spend ≤ revenue', ethSpent <= revenueIn + eps, { ethSpent, revenueIn });
  // (2) every bought $OMR is split to reserve + prize, nothing conjured
  push('buyback split exact', Math.abs((toReserve + toPrize) - omrBought) <= eps, { toReserve, toPrize, omrBought });
  // (3) the reserve holds ONLY Vig-bought $OMR — the buyback's reserve share plus any prize $OMR
  // moved from the pool to back a prize withdrawal. No unbacked (team-charity) funding.
  push('reserve fully backed', funded <= toReserve + prizePaid + deskToReserve + eps,
    { funded, toReserve, prizePaid, deskToReserve });
  // (3b) …and holds ALL of it: fundReserve runs post-commit (it opens its own txn), so a crash
  // between the buyback/prize COMMIT and the reserve top-up would leave the intended funding
  // recorded but never applied — winners' withdrawals queue forever with every one-sided check
  // green. Under-funding is a LOST-FUNDING alarm (re-fund the difference); over-funding stays
  // check (3)'s charity alarm. (Audit: the invariant was one-sided.)
  push('reserve not under-funded', funded >= toReserve + prizePaid + deskToReserve - eps,
    { funded, toReserve, prizePaid, deskToReserve });
  // (4) extraction never exceeds the funded reserve (the queue guarantees this live; assert it)
  push('extraction ≤ reserve', extracted <= funded + eps, { extracted, funded });
  // (5) prizes paid + still pooled never exceed what the Vig bought for prizes
  push('prizes ≤ bought', prizePaid + prizeBalance <= toPrize + eps, { prizePaid, prizeBalance, toPrize });

  const ok = checks.every((c) => c.ok);
  return { ok, checks, summary: { revenueIn, ethSpent, omrBought, funded, extracted, prizePaid } };
}

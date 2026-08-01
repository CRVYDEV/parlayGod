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
// here — except the PLEX bridge, which burns IN-GAME $OMR and so is a legal §10.4 burn).
import crypto from 'node:crypto';
import { GameError, ledger } from './game.js';
import { fundReserve } from './chain.js';

const uid = () => crypto.randomUUID();
const num = (x) => Number(x || 0);
const round6 = (x) => Math.round(x * 1e6) / 1e6;

// ── config (env-overridable, like chain.js; all founder sim + sign-off levers) ──
// VIG_BPS: the Vig's share of real revenue (the rest is dev/business). RESERVE_BPS: of each
// buyback's $OMR, how much backs withdrawals vs the season prize pool. PLEX_*: the in-game $OMR
// price to pay a fee from earnings instead of ETH (the EVE PLEX bridge — a skilled player's rent).
const VIG_BPS = Number(process.env.VIG_BPS || 6000);         // 60% to the Vig
const RESERVE_BPS = Number(process.env.VIG_RESERVE_BPS || 5000); // 50% of bought $OMR to the reserve
export const PLEX_MINT_OMR = Number(process.env.PLEX_MINT_OMR || 5);
export const PLEX_RESPAWN_OMR = Number(process.env.PLEX_RESPAWN_OMR || 50);
// MARKET-LINKED PLEX (sim-audit F3): a static 5 $OMR was minutes of play vs 0.01 ETH real money —
// nobody would ever pay ETH, starving the Vig at the source. The $OMR price now tracks the REAL
// exchange rate: fee-in-ETH × the latest Vig buyback's price (the actual OMR/ETH the Vig paid —
// on mainnet the DEX TWAP) × a premium ≥ 1 so the ETH rail stays the economical one (ETH funds
// the pool; $OMR burns supply at a markup). Static PLEX_*_OMR is the pre-market fallback floor.
const PLEX_PREMIUM_BPS = Number(process.env.PLEX_PREMIUM_BPS || 12000); // 1.2× the ETH-equivalent
const MINT_FEE_ETH = Number(process.env.MINT_FEE_ETH || 0.01);
const RESPAWN_FEE_ETH = Number(process.env.RESPAWN_FEE_ETH || 0.10);

// The live quote: {price, oracle} — oracle null (static floor) until a first buyback prints a price.
export async function plexQuote(db, kind) {
  const feeEth = kind === 'mint' ? MINT_FEE_ETH : RESPAWN_FEE_ETH;
  const fallback = kind === 'mint' ? PLEX_MINT_OMR : PLEX_RESPAWN_OMR;
  const last = (await db.query(
    'SELECT price_omr_per_eth FROM vig_buyback ORDER BY created_at DESC LIMIT 1')).rows[0];
  if (!last) return { price: fallback, oracle: null };
  const oracle = Number(last.price_omr_per_eth);
  const price = Math.max(fallback, round6(feeEth * oracle * PLEX_PREMIUM_BPS / 10000));
  return { price, oracle };
}

// ── revenue ingestion (called inside recordFeePayment's txn; idempotent on source+ref) ──
// Records the Vig's share of one real-ETH payment. `client` is the caller's open transaction so
// the revenue row and the fee row commit together. Amounts arrive in wei (string) and are stored
// in ETH units to stay inside JS-safe-integer range for the accounting math.
export async function recordVigRevenue(client, { source, ref, kind, amountWei }) {
  let grossEth = 0;
  try { grossEth = Number(BigInt(amountWei ?? '0')) / 1e18; } catch { grossEth = 0; }
  if (!(grossEth > 0)) return { recorded: false };
  const vigEth = round6(grossEth * VIG_BPS / 10000);
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
    const r = await recordVigRevenue(client, { source: 'trade', ref: nonce, kind: 'trade', amountWei });
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
// A skilled player covers their own "rent" from earnings: burn in-game $OMR → get the SAME
// entitlement an ETH payer gets (a mint credit or a respawn token). The $OMR is BURNED (a legal
// §10.4 sink, `plex:*`) — deflationary, offsetting emission. ETH payers fund the Vig; $OMR payers
// shrink supply; both support the token. Runs under withCharacter (h.acct is the account).
export async function payPlex(ch, kind, client, h) {
  if (kind !== 'mint' && kind !== 'respawn') throw new GameError('bad_kind', "PLEX pays a 'mint' or a 'respawn'.");
  if (kind === 'mint' && h.acct.minted) throw new GameError('minted', 'This account is already made.');
  const { price } = await plexQuote(client, kind); // market-linked: fee-ETH × latest buyback price × premium
  if (Number(h.acct.omr) < price) throw new GameError('omr', `That costs ${price} $OMR at the current rate — earn it, or pay the ETH fee.`);
  h.acct.omr = Number(h.acct.omr) - price;
  await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: -price, reason: `plex:${kind}` });
  if (kind === 'mint') h.acct.mint_credits = Number(h.acct.mint_credits || 0) + 1;
  else h.acct.respawn_tokens = Number(h.acct.respawn_tokens || 0) + 1;
  await h.track(client, ch.account_id, 'plex', { kind, omr: price });
  return { ok: true, kind, omrSpent: price,
    mintCredits: Number(h.acct.mint_credits || 0), respawnTokens: Number(h.acct.respawn_tokens || 0) };
}

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
    config: { vigBps: VIG_BPS, reserveBps: RESERVE_BPS, plexMintOmr: PLEX_MINT_OMR, plexRespawnOmr: PLEX_RESPAWN_OMR,
      // The IMPLIED RATE each fee pair puts on $OMR. Pre-market the PLEX price is the static floor
      // and ignores the ETH fee, so these two must agree or whichever rail is cheap is the one a
      // farm buys identities on — and minting is the Sybil bound. preflight warns at boot; this is
      // the same number where an operator is already looking (the "a warning nobody reads" answer).
      mintOmrPerEth: round6(PLEX_MINT_OMR / MINT_FEE_ETH),
      respawnOmrPerEth: round6(PLEX_RESPAWN_OMR / RESPAWN_FEE_ETH) },
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
  const deskToReserve = round6(await sumEth(pool, 'desk_buys', 'omr_bought'));

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

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
import { genesisOmrFor, BONDS } from './rules.js';
import { fundReserve, onchainSplits } from './chain.js';

const uid = () => crypto.randomUUID();
const num = (x) => Number(x || 0);
const round6 = (x) => Math.round(x * 1e6) / 1e6;

// ── config (env-overridable, like chain.js; all founder sim + sign-off levers) ──
// VIG_BPS: the Vig's share of real revenue (the rest is dev/business). RESERVE_BPS: of each
// buyback's $OMR, how much backs withdrawals vs the season prize pool.
export const VIG_BPS = Number(process.env.VIG_BPS || 6000);         // 60% to the Vig (exported: the router derives the waterfall from the LIVE constant)
export const RESERVE_BPS = Number(process.env.VIG_RESERVE_BPS || 5000); // 50% of bought $OMR to the reserve (exported for the router)
// ── THE PLEX BRIDGE — THE MINT IS ETH ONLY, EVERYTHING ELSE IS PAYABLE IN EARNED $OMR ───────────
// (founder-directed 2026-08-10: "Make the mint ETH only no OMR", then "Make plex items and
// consumables eth only", then — reading the cost that second sweep was flagged with — "maybe we over
// exaggerated on removing everything payable by OMR in Plex".)
//
// THE LINE IS THE BOUND, NOT THE DENOMINATION. That was the rule the mint-only pass drew and the
// second sweep erased; this restores it, because only one of the two arguments for retirement was
// ever about PLEX itself:
//
//   • "A fee payable two ways is always priced by the CHEAPER rail." TRUE, and FATAL for the MINT —
//     minting is the Sybil bound AND the extraction gate, so it is the one price that must never be
//     ambiguous. It is not fatal anywhere else: for a repeatable CONSUMABLE, two rails is a choice
//     of currency, not a bypassed bound. Nothing is gated by how you paid for a revive.
//   • "The $OMR rail stopped burning." True since v3 step 2 (`plex:%` is in `DESK.SINK_REASONS`, so
//     it RECYCLES to the desk shelf, which sells it for ETH at the daily auction). But read again,
//     that is an argument that the two rails are roughly EQUIVALENT — immediate ETH vs deferred ETH
//     through the desk — not an argument for removing one. And it undersells the $OMR rail, which
//     also creates the thing the post-v3 economy most lacks: recurring DEMAND for the token.
//
// WHO ACTUALLY PAYS IN $OMR, stated honestly rather than sold. $OMR has had no faucet since v3 step
// 1, and the mission ladder pays ~1,320 lifetime — nowhere near a respawn at the market rate. So
// this is NOT rent-from-grinding, and sim P9.35 now MEASURES the gap rather than leaving it to a
// comment: the whole earn surface is 1,320 lifetime (the mission ladder, once per account) plus 3/day
// (`daily:all`, a transfer out of the event fund), against 4,118 for the CHEAPEST thing the rail
// sells — 3.1× the entire ladder. So the player who funds their fees in $OMR is the one who takes it
// off somebody: `whack:loot` moves 20–50% of a victim's liquid AND staked $OMR to their killer. That
// is a better fit than EVE's version, not a worse one — you pay your rent by robbing people, which is
// the entire premise — but it is a DIFFERENT claim, so do not describe it as ISK-rent.
const MINT_FEE_ETH = Number(process.env.MINT_FEE_ETH || 0.01);
const RESPAWN_FEE_ETH = Number(process.env.RESPAWN_FEE_ETH || 0.10);
// MARKET-LINKED (sim-audit F3): a hand-set $OMR price is minutes of play against real money, so the
// rail is priced off the REAL rate — fee-ETH × the latest Vig buyback's price (the DEX TWAP on
// mainnet) × a premium ≥ 1, so ETH stays the economical rail and that asymmetry keeps feeding the
// vig. The static floor is the PRE-MARKET stand-in only, and it derives from the ONE stated rate
// rather than being hand-set — the genesis-rate pass's whole finding was that a hand-set floor and a
// market path silently disagree, and the effective price is whichever is cheaper.
const PLEX_PREMIUM_BPS = Number(process.env.PLEX_PREMIUM_BPS || 10000); // 1.0× the ETH-equivalent
export const PLEX_RESPAWN_OMR = Number(process.env.PLEX_RESPAWN_OMR
  || genesisOmrFor(RESPAWN_FEE_ETH, PLEX_PREMIUM_BPS));

// The live quote: {price, oracle} — oracle null (the static floor) until a first buyback prints one.
// RESPAWN ONLY: a 'mint' asks for a price that does not exist, so it answers null rather than
// quoting one, and the board renders that as "ETH only" instead of a number nobody may pay.
export async function plexQuote(db, kind) {
  if (kind !== 'respawn') return null;
  const last = (await db.query(
    'SELECT price_omr_per_eth FROM vig_buyback WHERE real ORDER BY created_at DESC LIMIT 1')).rows[0];
  if (!last) return { price: PLEX_RESPAWN_OMR, oracle: null };
  const oracle = Number(last.price_omr_per_eth);
  const price = Math.max(PLEX_RESPAWN_OMR, round6(RESPAWN_FEE_ETH * oracle * PLEX_PREMIUM_BPS / 10000));
  return { price, oracle };
}

// Pay a real-money fee from EARNED $OMR instead of ETH. Burns through the audited ledger under the
// caller's held account lock (runs inside withCharacter, so `h.acct` is the account). §10.4: the
// `plex:*` reason is already in the omr vocabulary, the burn term and `DESK.SINK_REASONS`, so the
// value recycles to the desk shelf — no new reason, no new bucket.
export async function payPlex(ch, kind, client, h) {
  // THE MINT STAYS ETH ONLY. Minting is the Sybil bound and it gates extraction, so it is the one
  // price that must never be ambiguous — and the FREE path does not run through this rail anyway:
  // "you can get made for free" is delivered by a mission GRANTING the credit outright, which is why
  // retiring this half cost nothing and why restoring it would give nothing back.
  if (kind === 'mint') throw new GameError('retired',
    'The mint is ETH only. Pay the fee on-chain, or earn the credit — the mission ladder grants one outright.');
  if (kind !== 'respawn') throw new GameError('bad_kind', "PLEX pays a 'respawn'.");
  const { price } = await plexQuote(client, kind); // market-linked: fee-ETH × latest buyback price × premium
  if (Number(h.acct.omr) < price) throw new GameError('omr', `That costs ${price} $OMR at the current rate — earn it, or pay the ETH fee.`);
  h.acct.omr = Number(h.acct.omr) - price;
  await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: -price, reason: `plex:${kind}` });
  h.acct.respawn_tokens = Number(h.acct.respawn_tokens || 0) + 1;
  await h.track(client, ch.account_id, 'plex', { kind, omr: price });
  return { ok: true, kind, omrSpent: price,
    mintCredits: Number(h.acct.mint_credits || 0), respawnTokens: Number(h.acct.respawn_tokens || 0) };
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
  // explicitly. Kept after the trade fee's retirement because the LESSON outlives the rail that
  // taught it (ROUTER F1: the booking path read no lever at all, so a source whose declared split
  // differed from the default booked the difference to nobody, with both invariants green).
  const vigEth = round6(grossEth * (bps ?? VIG_BPS) / 10000);
  // SELECT-then-INSERT (pg-mem's ON CONFLICT is unreliable) — a re-delivered fee event is a no-op
  const seen = (await client.query('SELECT 1 FROM vig_revenue WHERE source=$1 AND ref=$2', [source, String(ref)])).rows[0];
  if (seen) return { recorded: false, duplicate: true };
  await client.query(
    'INSERT INTO vig_revenue (source, ref, kind, gross_eth, vig_eth) VALUES ($1,$2,$3,$4,$5)',
    [source, String(ref), kind || null, round6(grossEth), vigEth]);
  return { recorded: true, vigEth };
}

// THE TRADE-FEE PAYER IS RETIRED (founder-directed 2026-08-11) — `recordTradeFee` is DELETED rather
// than left dormant, because a payer behind a flag is one env var from live. Two hooks wanted one
// pool and the four-slice sell tax won; see the retirement note in rules.tail.js. `'trade'` stays in
// the router's VIG_SOURCES forever (history), and `router.js` check (8) now asserts nothing NEW
// writes it — the freshness shape, not a membership deletion.

const sumEth = async (pool, table, col, where = '') =>
  Number((await pool.query(`SELECT COALESCE(SUM(${col}),0) s FROM ${table} ${where}`)).rows[0].s);

// ── the buyback (the bot's accounting half) ──
// Spend the UNSPENT Vig revenue (revenue in − ETH already spent) on hard $OMR at `priceOmrPerEth`,
// split the $OMR to the withdrawal reserve + the prize pool, and record it. On mainnet the bot does
// the real DEX swap (TWAP, slippage-capped) and passes the achieved price; here the price is a
// parameter so the accounting is deterministic and testable. Never spends more ETH than came in —
// that hard cap (`ethToSpend ≤ unspent`) is the root of "extraction ≤ inflow".
// THE ANTI-FABRICATION GATE (red team 2026-08-16). `txHash` is the claim that a real DEX swap
// happened; without one this is a comp/QA call and books ZERO — the desk/bank/community/treasury
// posture, arrived at here last because this is the oldest ingest. It matters more here than
// anywhere: a buyback credits `chain_reserve.funded_omr` (what `signVoucher` reads before signing a
// REAL withdrawal) AND the prize pool (whose only exit is a `prize:omr` mint to players), and its
// price is the canonical print the desk band, the bond oracle, PLEX, the exit toll and the ETH vault
// all anchor on. A comp booking amounts would let a mod key assert hard $OMR arrived; a comp setting
// the PRINT would let it move every one of those consumers at once. So a comp books zero AND is
// excluded from every anchor read (`WHERE real`), and the real bot passes its swap hash.
export async function runVigBuyback(pool, { priceOmrPerEth, maxEth, txHash } = {}) {
  const price = Number(priceOmrPerEth);
  const real = !!txHash;
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
    const last = Number((await client.query('SELECT price_omr_per_eth FROM vig_buyback WHERE real ORDER BY created_at DESC LIMIT 1')).rows[0]?.price_omr_per_eth || 0);
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
    // A comp books the ROW (the journal of what was asked for) with every AMOUNT zeroed — so it
    // consumes no real revenue, credits nothing, and needs no `WHERE real` on the amount sums to stay
    // honest. The community/bank precedent verbatim.
    const spentBooked = real ? ethToSpend : 0;
    const boughtBooked = real ? omrBought : 0;
    const reserveBooked = real ? toReserve : 0;
    const prizeBooked = real ? toPrize : 0;
    await client.query(
      'INSERT INTO vig_buyback (id, eth_spent, omr_bought, price_omr_per_eth, to_reserve, to_prize, tx_hash, real) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [uid(), spentBooked, boughtBooked, price, reserveBooked, prizeBooked, txHash || null, real]);
    if (prizeBooked > 0) await client.query('UPDATE vig_prize_pool SET balance = balance + $1 WHERE id=1', [prizeBooked]);
    await client.query('COMMIT');
    // fund the reserve OUTSIDE this txn (fundReserve opens its own) — it's the bridge to the queue
    if (reserveBooked > 0) await fundReserve(pool, reserveBooked);
    return { ethSpent: spentBooked, omrBought: boughtBooked, toReserve: reserveBooked, toPrize: prizeBooked, real };
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
  const ethSpent = await sumEth(pool, 'vig_buyback', 'eth_spent', 'WHERE real');
  const omrBought = await sumEth(pool, 'vig_buyback', 'omr_bought', 'WHERE real');
  const toReserve = await sumEth(pool, 'vig_buyback', 'to_reserve', 'WHERE real');
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
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// SPLIT PARITY (red team #9 F1) — does the chain perform the split this backend restates?
//
// Both contract-side numbers are IMMUTABLE and hand-set at a deploy no script covers, and both have a
// backend counterpart nothing ever compared them to. The two failures differ, which is why they are
// reported separately rather than summed:
//   * `OmertaFees.vigBps` vs VIG_BPS - the fee event carries the GROSS alone, so `recordVigRevenue`
//     DERIVES the share. A divergence directly over- or under-books `vig_revenue`, which is what
//     `runVigBuyback` spends and `fundReserve` credits, and every invariant sums either way because
//     they all compare figures derived from the same restated number.
//   * `OmertaBond.polBps/devBps/rwaBps` vs BONDS.* - the booking is event-authoritative, so the
//     ACCOUNTING is safe; what diverges is the router's DECLARED waterfall, silently.
// Dormant states never alarm (`unreachable` is not knowing, which is not the same as broken - the
// archiver/oracle watchdog split).
let splitsReader = null;   // tests inject the on-chain side; production reads the chain
export function __setSplitsReader(fn) { splitsReader = fn; }
export async function splitParity() {
  const chain = await (splitsReader || onchainSplits)();
  if (chain.state !== 'ok') return { state: chain.state, note: chain.note, mismatches: [] };
  const mismatches = [];
  const cmp = (what, onchain, backend) => {
    if (onchain === undefined || onchain === null) return;
    if (Number(onchain) !== Number(backend)) mismatches.push({ what, onchain: Number(onchain), backend: Number(backend) });
  };
  cmp('OmertaFees.vigBps', chain.feeVigBps, VIG_BPS);
  cmp('OmertaBond.polBps', chain.bondPolBps, BONDS.POL_BPS);
  cmp('OmertaBond.devBps', chain.bondDevBps, BONDS.DEV_BPS);
  cmp('OmertaBond.rwaBps', chain.bondRwaBps, BONDS.RWA_BPS);
  return { state: mismatches.length ? 'mismatch' : 'ok', mismatches, chain };
}

export async function runVigInvariants(pool) {
  const checks = [];
  const push = (name, ok, detail = {}) => checks.push({ name, ok, ...detail });

  const revenueIn = round6(await sumEth(pool, 'vig_revenue', 'vig_eth'));
  const ethSpent = round6(await sumEth(pool, 'vig_buyback', 'eth_spent', 'WHERE real'));
  const omrBought = round6(await sumEth(pool, 'vig_buyback', 'omr_bought', 'WHERE real'));
  const toReserve = round6(await sumEth(pool, 'vig_buyback', 'to_reserve', 'WHERE real'));
  const toPrize = round6(await sumEth(pool, 'vig_buyback', 'to_prize', 'WHERE real'));
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
  // THE CITY LEG (src/bank.js) is the third legitimate funder. Every $OMR it credits a player is
  // fundReserve'd for the same amount immediately after the commit — the payPrizes shape — so its
  // lifetime paid IS its contribution to `funded`. It has to be named in BOTH terms below, and the
  // failure mode if it is not is worth stating: this pair does not fail OPEN on an unknown funder,
  // it fires SPURIOUSLY on both halves at once, which reads as a reserve emergency that is not one.
  // (AUDIT-desk F1 learned this the same way, one funder earlier.)
  const cityPaid = round6(num((await pool.query(
    'SELECT COALESCE(paid_total,0) s FROM bank_city_pool WHERE id=1')).rows[0]?.s));

  const eps = 1e-6;
  // (1) the bot never spends more ETH than the Vig received — the root cap
  push('spend ≤ revenue', ethSpent <= revenueIn + eps, { ethSpent, revenueIn });
  // (2) every bought $OMR is split to reserve + prize, nothing conjured
  push('buyback split exact', Math.abs((toReserve + toPrize) - omrBought) <= eps, { toReserve, toPrize, omrBought });
  // (3) the reserve holds ONLY Vig-bought $OMR — the buyback's reserve share plus any prize $OMR
  // moved from the pool to back a prize withdrawal. No unbacked (team-charity) funding.
  push('reserve fully backed', funded <= toReserve + prizePaid + deskToReserve + cityPaid + eps,
    { funded, toReserve, prizePaid, deskToReserve, cityPaid });
  // (3b) …and holds ALL of it: fundReserve runs post-commit (it opens its own txn), so a crash
  // between the buyback/prize COMMIT and the reserve top-up would leave the intended funding
  // recorded but never applied — winners' withdrawals queue forever with every one-sided check
  // green. Under-funding is a LOST-FUNDING alarm (re-fund the difference); over-funding stays
  // check (3)'s charity alarm. (Audit: the invariant was one-sided.)
  push('reserve not under-funded', funded >= toReserve + prizePaid + deskToReserve + cityPaid - eps,
    { funded, toReserve, prizePaid, deskToReserve, cityPaid });
  // (4) extraction never exceeds the funded reserve (the queue guarantees this live; assert it)
  push('extraction ≤ reserve', extracted <= funded + eps, { extracted, funded });
  // (5) prizes paid + still pooled never exceed what the Vig bought for prizes
  push('prizes ≤ bought', prizePaid + prizeBalance <= toPrize + eps, { prizePaid, prizeBalance, toPrize });

  const ok = checks.every((c) => c.ok);
  return { ok, checks, summary: { revenueIn, ethSpent, omrBought, funded, extracted, prizePaid } };
}

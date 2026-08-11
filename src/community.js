// ── THE COMMUNITY EARMARK + THE FAMILY BUYBACK — Phase 1 of the treasury→family split ────────────
// (founder-directed 2026-08-11: "Lock this in" → "Let's start"; omerta-treasury-to-family-design.md
// §4/§8. This is build-order step 1: the machinery, chain-dormant, every slice lever defaulting to
// ZERO so production is byte-identical until the Phase-2 flip.)
//
// THE FLOW: the revenue ingests (fees.js / store.js / treasury.js recordSellTax + recordHarvestFee)
// carve a community slice out of each REAL payment into `community_revenue` (recordCommunityRevenue,
// below — the rwa_revenue shape: no `real` column, the txHash gate lives at the callers). The keeper
// (runFamilyBuyback — the runVigBuyback twin) spends the UNSPENT community revenue on hard $OMR off
// the canonical pool (mainnet: the DEX bot reports the trade; until then a mod/QA param) and credits
// the bought amount to `family_yield_pool`, which `payFamilyYield` already distributes 5-4-3-2-1 by
// seasonal standing. So the family prize grows on REAL revenue, in in-game $OMR — never real ETH to
// a gang, which is the regulatory line the whole design exists to hold.
//
// ── THE §10.4 SHAPE, and the decision behind it ─────────────────────────────────────────────────
// The pool credit is a MINT: `yield:buyback`, an EXACT new reason in invariants.js's omrMints term
// (never the `yield:%` prefix — yield:window and yield:family are genuine transfers and must stay
// out of both terms). It cannot be a transfer, because the credit has no counted-bucket debit — an
// unclassified reason crediting a counted bucket is precisely the kitchen:module silent-drift class.
// It is admissible exactly to the extent the hard token really arrived (the desk:buyback argument),
// which conservation cannot see — so runFamilyBuybackInvariants asserts the soft credit equals the
// hard purchase, real rows only.
//
// DELIBERATELY NO fundReserve — the desk-shelf posture, NOT the bank's, and the reason is where the
// pool's contents can GO: the bank's city pool pays PLAYERS, whose $OMR is extractable, so its hard
// tokens must reach the claim contract and its lifetime paid is named in the Vig's reserve sandwich.
// This pool pays GANG RESERVES, which today are burn-only (seals, the Foundation) — nothing routes a
// gang's $OMR back to an account, so reserve-funding it would raise signable withdrawal capacity for
// claims that cannot be made. The bought hard $OMR stays in the community-buyback wallet (§5 of the
// design doc: the SAME custody the sell-tax community recipient pays into), attested by the
// invariants' `walletMustHold` — the treasury safeMustHold shape. IF a future mechanism ever lets
// gang-reserve $OMR reach an account, this decision re-opens: the credit would then need the bank's
// fundReserve pairing AND a named term in BOTH halves of the Vig sandwich (the cityPaid lesson —
// an unnamed funder does not fail open, it fires spuriously on both halves at once).
//
// COMPS BOOK ZERO — the bank posture, stricter than the desk's: a comp/QA call records the episode
// (auditable) but books zero spend and zero $OMR, because the PRICE is caller-supplied and the
// pool's exit reaches real families — a fabricated price must never mint a colossal credit from a
// small real budget. QA exercises the credit path the way test/bank.js does: a direct call carrying
// a txHash (the mod route strips it unless ALLOW_MOD_REAL_REVENUE=on — the D-MED2 discipline).
//
// Import graph: rules.js (leaf) + game.js (GameError) + exchange.js (fundFamilyYield — ONE
// implementation of the pool credit, the sackEmpire rake-cursor lesson; exchange.js imports only
// rules/game/vanity/commission, none of which import the ingests, so no cycle).
import crypto from 'node:crypto';
import { COMMUNITY } from './rules.js';
import { GameError } from './game.js';
import { fundFamilyYield } from './exchange.js';

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const num = (v) => Number(v || 0);

// ── the inflow ledger ────────────────────────────────────────────────────────────────────────────
// One row per real payment's community slice. Runs inside the CALLER's transaction (every ingest
// already holds one), SELECT-then-INSERT idempotent on (source, ref) — pg-mem does not report a
// suppressed conflict's rowCount, so ON CONFLICT would count every re-delivery as a fresh booking.
// The callers gate on txHash + a nonzero lever, so like vig_revenue/rwa_revenue this table needs no
// `real` column of its own.
export async function recordCommunityRevenue(client, { source, ref, currency = 'eth', gross, amount }) {
  const amt = round6(num(amount));
  if (!(amt > 0)) return { recorded: false };
  const key = String(ref);
  if ((await client.query('SELECT 1 FROM community_revenue WHERE source=$1 AND ref=$2', [source, key])).rows[0])
    return { recorded: false, duplicate: true };
  await client.query(
    'INSERT INTO community_revenue (source, ref, currency, gross, amount) VALUES ($1,$2,$3,$4,$5)',
    [source, key, String(currency || 'eth'), round6(num(gross)), amt]);
  return { recorded: true, amount: amt };
}

// ── the keeper ───────────────────────────────────────────────────────────────────────────────────
// The runVigBuyback twin, per CURRENCY ('eth' for the three ETH sources; the harvest carve arrives
// in the market's underlying, e.g. 'USDC'): spend the unspent community revenue on $OMR at a
// reported price, credit the pool. `priceOmr` is $OMR per unit of `currency` — a PARAMETER, so the
// accounting is deterministic and testable off-chain; on mainnet the bot reports the TWAP it
// realized, carrying the trade's txHash.
export async function runFamilyBuyback(pool, { currency = 'eth', priceOmr, maxSpend, txHash = null } = {}) {
  const price = Number(priceOmr);
  if (!(Number.isFinite(price) && price > 0)) throw new GameError('price', 'A family buyback needs a positive $OMR price per unit.');
  const ccy = String(currency || 'eth').trim();
  const real = !!txHash;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the pool singleton FIRST (the runVigBuyback discipline): two concurrent keeper runs must
    // not both read the same unspent budget and each spend the whole of it. It is this txn's ONLY
    // lock, so there is no cycle against payFamilyYield's gangs→pool order — a single-lock
    // transaction cannot AB-BA, and "the pool is taken last" holds trivially.
    await client.query('SELECT balance FROM family_yield_pool WHERE id=1 FOR UPDATE');
    // The price-continuity wall (the VIG_MAX_PRICE_JUMP twin), per currency, against the last REAL
    // buy — a fat-finger or a leaked mod key cannot reprice the pool credit by more than the band.
    // ORDER BY created_at DESC, never id (a UUID order anchors on an arbitrary historical row).
    const jump = Number(process.env.FAMILY_MAX_PRICE_JUMP) || 10;
    const last = num((await client.query(
      'SELECT price_omr FROM family_buybacks WHERE currency=$1 AND real ORDER BY created_at DESC LIMIT 1',
      [ccy])).rows[0]?.price_omr);
    if (last > 0 && (price > last * jump || price < last / jump))
      throw new GameError('price_sanity', `Price ${price} is more than ${jump}x away from the last real buy (${last}).`);
    // The root cap: never spend more than the community revenue that actually arrived, per currency.
    const rev = num((await client.query(
      'SELECT COALESCE(SUM(amount),0) s FROM community_revenue WHERE currency=$1', [ccy])).rows[0].s);
    const spent = num((await client.query(
      'SELECT COALESCE(SUM(spent),0) s FROM family_buybacks WHERE currency=$1', [ccy])).rows[0].s);
    let toSpend = round6(rev - spent);
    if (maxSpend != null) toSpend = Math.min(toSpend, Number(maxSpend));
    if (!(toSpend > 0)) { await client.query('COMMIT'); return null; }
    const omrNotional = round6(toSpend * price);
    // A comp records the episode and moves NOTHING — zero spend (the budget is not consumed), zero
    // $OMR (the pool does not grow). The header explains why this is the bank posture, not the desk's.
    const spentBooked = real ? toSpend : 0;
    const boughtBooked = real ? omrNotional : 0;
    await client.query(
      'INSERT INTO family_buybacks (id, currency, spent, price_omr, omr_bought, tx_hash, real) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [crypto.randomUUID(), ccy, spentBooked, price, boughtBooked, txHash, real]);
    if (real && boughtBooked > 0) {
      // ONE implementation of the pool credit (exchange.js) — balance + lifetime_funded move
      // together, so the exchange's own `family yield backed` / `balance` invariants stay exact
      // with this second funder in the mix, no change to either check.
      await fundFamilyYield(client, boughtBooked);
      // The mint row — the §10.4 leg. NULL character/account (the yield:family shape): the credit
      // belongs to the pool, not a player; invariants.js counts the exact reason in omrMints.
      await client.query(
        'INSERT INTO transactions (id, character_id, account_id, currency, amount, reason, counterparty) VALUES ($1,NULL,NULL,$2,$3,$4,NULL)',
        [crypto.randomUUID(), 'omr', boughtBooked, 'yield:buyback']);
    }
    await client.query('COMMIT');
    return { currency: ccy, spent: spentBooked, price, omrBought: boughtBooked, real,
      // the notional a comp WOULD have moved — QA legibility, never booked
      quote: { toSpend, omrNotional } };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}

// ── the real-value invariant (the runBankInvariants twin) ────────────────────────────────────────
// Runs beside the vig/bond/desk/treasury/bank/exchange/router runners in the worker's nightly
// alertDrift, and IS the GET /v1/mod/community body (the GET /v1/mod/bank shape).
export async function runFamilyBuybackInvariants(pool) {
  const checks = [];
  const push = (name, ok, detail = {}) => checks.push({ name, ok, ...detail });
  const eps = 1e-6;

  // The two per-currency sums keep LITERAL SQL at the query() call (a helper taking the SQL as a
  // parameter is invisible to tools/pgquery.js — the guard's own interpolated ceiling caught the
  // first cut of this); the folding is the shared part, so that is what the helper holds.
  const fold = (rows) => {
    const out = {};
    for (const r of rows) out[r.currency] = round6(num(r.s));
    return out;
  };
  const revenue = fold((await pool.query(
    'SELECT currency, COALESCE(SUM(amount),0) s FROM community_revenue GROUP BY currency')).rows);
  const spent = fold((await pool.query(
    'SELECT currency, COALESCE(SUM(spent),0) s FROM family_buybacks WHERE real GROUP BY currency')).rows);

  // (1) the root cap, per currency — the bot never spends community money that did not arrive.
  for (const ccy of new Set([...Object.keys(revenue), ...Object.keys(spent)]))
    push(`spend <= revenue (${ccy})`, (spent[ccy] || 0) <= (revenue[ccy] || 0) + eps,
      { spent: spent[ccy] || 0, revenue: revenue[ccy] || 0 });

  // (2) every soft $OMR the pool was credited corresponds to a real purchase — the desk's
  // "buyback backed by a real purchase" shape. The ledger side is the exact yield:buyback reason;
  // the books side is family_buybacks WHERE real. A pool credit with no purchase behind it (or a
  // purchase whose credit never landed) breaks the equality from one side or the other.
  const credited = num((await pool.query(
    "SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='omr' AND reason='yield:buyback'")).rows[0].s);
  const bought = num((await pool.query(
    'SELECT COALESCE(SUM(omr_bought),0) s FROM family_buybacks WHERE real')).rows[0].s);
  push('buyback credited == bought', Math.abs(credited - bought) <= eps, { credited, bought });

  // (3) comps move nothing — spend AND $OMR (the bank's "books ZERO $OMR, not merely zero spend").
  const comp = (await pool.query(
    'SELECT COALESCE(SUM(spent),0) s, COALESCE(SUM(omr_bought),0) b FROM family_buybacks WHERE NOT real')).rows[0];
  push('comps buy nothing', num(comp.s) === 0 && num(comp.b) === 0, { compSpent: num(comp.s), compBought: num(comp.b) });

  return { ok: checks.every((c) => c.ok), checks,
    summary: { revenue, spent, bought: round6(bought),
      // THE ATTESTATION LINE (the treasury safeMustHold shape): the ledger proves the pool never
      // credited more than the books say was bought; only a look at the real community-buyback
      // wallet proves the hard $OMR is still there. Nothing ever leaves it in Phase 1.
      walletMustHold: round6(bought) } };
}

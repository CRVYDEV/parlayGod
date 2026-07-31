// ═══ THE TREASURY — where the game's real ETH goes (omerta-stock-layer-retirement.md) ═══
//
// This file was `rwa.js`, THE FLOAT: ETH slices accumulated, a bot bought real tokenized stock, and
// players burned earned $OMR to claim allocation from it. The founder retired that layer on
// 2026-07-31 — the treasury holds ETH instead.
//
// WHAT THAT CHANGED, AND WHY IT IS A SIMPLIFICATION RATHER THAN A LOSS. The float rested on
// `allocated <= held`: the game only ever owes stock it already owns, in UNITS, so price movement
// could never create a shortfall. That works only while both sides of the ledger are the SAME asset
// — the vault owing units, the reserve holding units. "The treasury holds ETH" is therefore only
// coherent if nothing owes stock. Backing a stock-denominated claim with ETH would have been the
// worse answer twice over: legally it turns handing over an asset you own into a cash-settled payout
// on one you do not (a derivative), and mechanically it breaks the wall the moment the two assets
// diverge — the treasury goes short exactly when players claim.
//
// So the cut was: REMOVE THE PROMISE, KEEP THE ACCOUNTING. There is no vault, no reserve, no buy bot
// and no `allocated <= held` — and that absence is the design, not a gap. What remains is a ledger of
// ETH the treasury received and from where, which is worth knowing whatever it is spent on.
//
// The four slices keep their bps and their sources (Store 20% / gameplay fees FEE_TREASURY_BPS /
// the DEX sell tax's SELL_TAX.RWA_BPS / bond ETH's BONDS.RWA_BPS). Only the destination changed:
// a treasury Safe rather than a buy bot. The on-chain fourth recipient built in `e598b6b` stands —
// and the founder's key-separation ruling gets STRONGER here, since a treasury that only ever
// receives has no reason to share a key with anything that spends.
//
// The table is still named `rwa_revenue`. Renaming it is migration risk for no benefit; it is the
// treasury's inflow ledger and every reader of this file knows it.
//
// Out-of-band real value, as before: ZERO §10.4 rows. Nothing here touches the in-game economy.
// R1 — the Portfolio (`portfolio.js`) — is UNTOUCHED: it was always pure in-game status with a
// deterministic §7.11 hash price, no sell and no cash-out, and it stays exactly that.
import crypto from 'node:crypto';
import { GameError } from './game.js';
import { SELL_TAX } from './rules.js';

const round6 = (n) => Math.round(n * 1e6) / 1e6;

// ── THE DEX SELL TAX ingest (tokenomics v2 §5/§6) ──
// One row per taxed episode (a `SellTaxTaken` log on mainnet). The tax is charged in OMR at the pool;
// the bot realizes it as ETH, and that ETH splits three ways (SELL_TAX.DEV/RWA/LP_BPS). The RWA slice
// — now the TREASURY slice — is mirrored into `rwa_revenue` (source='tax'); the dev and LP slices are
// recorded so the episode reconciles and the founder can see where it went.
//
// Idempotent on `ref` (txHash:logIndex on-chain). `txHash` marks a REAL episode — the store/bond
// D-MED2 discipline: a mod/QA simulate records the episode but books ZERO revenue. That gate mattered
// more when fabricated revenue could buy real-looking units; it is kept because "the treasury received
// this much ETH" should never be assertable by a QA call either.
export async function recordSellTax(pool, { ref, omrTaxed, priceOmrPerEth, txHash = null } = {}) {
  const key = String(ref || '').trim();
  if (!key) throw new GameError('ref', 'A tax episode needs a ref (txHash:logIndex).');
  const omr = Number(omrTaxed);
  const price = Number(priceOmrPerEth);
  if (!(Number.isFinite(omr) && omr > 0)) throw new GameError('amount', 'omrTaxed must be > 0');
  if (!(Number.isFinite(price) && price > 0)) throw new GameError('price', 'priceOmrPerEth must be > 0 (mainnet: the TWAP the bot realized).');
  const real = !!txHash;
  const grossEth = round6(omr / price);
  // the REMAINDER rule sits on the LP slice so the three shares sum to the gross EXACTLY (two of
  // three round down; a "natural" third division strands wei belonging to nobody).
  // A SIMULATE books ZERO across all three slices, not just zero revenue: the episode is recorded
  // for QA, but a comp must never be able to assert the treasury (or the dev wallet, or LP) received
  // ETH that never moved. Preserved verbatim from the float's ingest — it is the anti-fabrication
  // gate, and it is the reason a mod route cannot manufacture a real-value position.
  const devEth = real ? round6(grossEth * SELL_TAX.DEV_BPS / SELL_TAX.BPS) : 0;
  const rwaEth = real ? round6(grossEth * SELL_TAX.RWA_BPS / SELL_TAX.BPS) : 0;
  const lpEth = real ? round6(grossEth - devEth - rwaEth) : 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // SELECT-then-INSERT, not `ON CONFLICT DO NOTHING` + rowCount: pg-mem does not report the
    // rowCount of a suppressed conflict, so the tidier idiom silently reports every duplicate as a
    // fresh booking. (Learned the hard way porting this file — do not "improve" it back.)
    if ((await client.query('SELECT 1 FROM sell_tax_events WHERE ref=$1', [key])).rows[0]) {
      await client.query('COMMIT');
      return { recorded: false, duplicate: true }; // a re-delivered log is a clean no-op
    }
    await client.query(
      'INSERT INTO sell_tax_events (ref, omr_taxed, price_omr_per_eth, gross_eth, dev_eth, rwa_eth, lp_eth, tx_hash, real) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [key, round6(omr), price, grossEth, devEth, rwaEth, lpEth, txHash, real]);
    if (real && rwaEth > 0)
      await client.query("INSERT INTO rwa_revenue (source, ref, rwa_eth) VALUES ('tax',$1,$2)", [key, rwaEth]);
    await client.query('COMMIT');
    return { recorded: true, grossEth, devEth, rwaEth, lpEth, real };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    // a concurrent re-delivery of the same log (23505) is the duplicate case, not an error
    if (e?.code === '23505') return { recorded: false, duplicate: true };
    throw e;
  } finally { client.release(); }
}

// ── the board: what the treasury has taken in, by source ──
// Public-safe (no per-account anything). The FLOAT's `GET /v1/vault` is gone with the claim rail it
// served; this is the founder-facing replacement, mounted mod-gated.
export async function treasuryStatus(pool) {
  const bySource = {};
  for (const s of (await pool.query('SELECT source, SUM(rwa_eth) s FROM rwa_revenue GROUP BY source')).rows)
    bySource[s.source] = round6(Number(s.s));
  const total = Number((await pool.query('SELECT COALESCE(SUM(rwa_eth),0) s FROM rwa_revenue')).rows[0].s);
  return { holds: 'eth', totalEth: round6(total), bySource };
}

// ── the real-value invariant (the runVigInvariants / runBondInvariants twin) ──
// What is LEFT after the stock layer went. The unit checks (`allocated <= held`, `held == bought`,
// cost basis) are GONE because nothing is allocated — deleting them is correct, not a weakening.
// What still has to hold is that every ETH episode reconciles and reached the bucket it claimed to.
export async function runTreasuryInvariants(pool) {
  const checks = [];
  const push = (name, lhs, rhs) => checks.push({
    name, lhs: round6(lhs), rhs: round6(rhs), ok: Math.abs(lhs - rhs) < 1e-6 });
  // each sell-tax episode's three slices sum to its gross, and the treasury slice reached the ledger.
  // A silent mismatch means the books disagree with what the tax actually took.
  const tax = (await pool.query(
    'SELECT COALESCE(SUM(gross_eth),0) g, COALESCE(SUM(dev_eth),0) d, COALESCE(SUM(rwa_eth),0) r, COALESCE(SUM(lp_eth),0) l FROM sell_tax_events WHERE real')).rows[0];
  const taxMirror = Number((await pool.query("SELECT COALESCE(SUM(rwa_eth),0) s FROM rwa_revenue WHERE source='tax'")).rows[0].s);
  push('sell-tax split == gross', Number(tax.d) + Number(tax.r) + Number(tax.l), Number(tax.g));
  push('sell-tax treasury slice == recorded', Number(tax.r), taxMirror);
  const status = await treasuryStatus(pool);
  return { ok: checks.every((c) => c.ok), checks, ...status };
}

export const _uid = () => crypto.randomUUID();

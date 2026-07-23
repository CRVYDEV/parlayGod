// THE RESERVE BOND (omerta-reserve-bond-design.md) — Protocol-Owned Liquidity via a disciplined treasury
// bond (Olympus Pro, without the reflexive mint). A bonder deposits real ETH → receives DISCOUNTED treasury
// OMR, vested; the ETH deepens the OMR-ETH pool (POL) + feeds the Vig. The payout OMR is a SALE from a
// BUDGETED tranche (`bond_reserve.capacity_omr`), NEVER a mint, and `committed ≤ capacity` is enforced at
// bond time — so bond emission is hard-capped and never reflexive. REAL-VALUE / OUT-OF-BAND: this module
// writes only bonds / bond_reserve / vig_revenue(source='bond') — ZERO `transactions` rows — so the in-game
// §10.4 sweep is untouched by construction (the fees.js precedent). It carries its OWN invariant
// (`runBondInvariants`) on the real-value side. The chain layer (the OmertaBond contract + a Bonded watcher
// + the POL pairing bot) is DORMANT, mainnet-gated on legal + a third-party audit.
import crypto from 'node:crypto';
import { getAddress } from 'viem';
import { GameError } from './game.js';
import { BONDS, bondPayout } from './rules.js';

const uid = () => crypto.randomUUID();
const round6 = (x) => Math.round(Number(x) * 1e6) / 1e6;
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : NaN);
const norm = (addr) => { try { return getAddress(addr); } catch { return null; } };

// the live OMR-per-ETH oracle (the DEX TWAP on mainnet; the latest Vig buyback print off-chain). null if
// no price has ever printed — bonding needs a price, so recordBond takes one explicitly (the watcher/mod
// supplies the TWAP), and the board falls back to this read for display.
async function oraclePrice(db) {
  const last = (await db.query('SELECT price_omr_per_eth FROM vig_buyback ORDER BY created_at DESC LIMIT 1')).rows[0];
  const p = last ? Number(last.price_omr_per_eth) : null;
  return (p != null && Number.isFinite(p) && p > 0) ? p : null;
}

// ── ingest one bond (the recordFeePayment / Store recordStorePurchase twin; chain-dormant, mod/test-driven).
// Idempotent on nonce. Prices the payout, ENFORCES the tranche cap (committed + payout ≤ capacity), splits
// the ETH (POL + the Vig buyback), and books the vesting bond. account_id null parks it for reconcile-at-link.
export async function recordBond(pool, { nonce, accountId = null, payer = null, principalEth, priceOmrPerEth, discountBps, txHash = null, onchainPayout = null, onchainPol = null, onchainVig = null, onchainDev = null }) {
  const n = Number(nonce);
  if (!Number.isInteger(n) || n < 0) throw new GameError('bad_nonce', 'Bad bond nonce.');
  // the on-chain path supplies the depositing wallet; store it (normalized) so a pre-link bond can be
  // reconciled at wallet-link (the Store precedent). The mod/test path supplies accountId directly.
  const addr = payer == null ? null : norm(payer);
  if (payer != null && !addr) throw new GameError('bad_payer', 'Payer is not a valid EVM address.');
  const eth = num(principalEth);
  if (!(eth >= BONDS.MIN_PRINCIPAL_ETH)) throw new GameError('min', `A bond takes at least ${BONDS.MIN_PRINCIPAL_ETH} ETH.`);
  // THE ON-CHAIN (WATCHER) PATH vs THE MOD/SIMULATE PATH. The `Bonded` event carries the AUTHORITATIVE
  // payout + POL/Vig split the contract already computed from the signed quote — but it does NOT re-emit
  // the quote's price/discount. So when `onchainPayout` is set (the watcher), BOOK the event's values
  // directly (the chain is the source of truth); store the effective rate (payout/eth) as oracle_price for
  // the record. The mod/simulate path (no onchainPayout) re-derives payout from an explicit price+discount.
  const onchain = onchainPayout != null;
  const price = onchain ? (eth > 0 ? round6(num(onchainPayout) / eth) : 0) : num(priceOmrPerEth);
  if (!onchain && !(price > 0)) throw new GameError('price', 'A bond needs a live OMR-ETH price.');
  const disc = discountBps == null ? (onchain ? 0 : BONDS.DISCOUNT_BPS) : Number(discountBps);
  if (!(Number.isFinite(disc) && disc >= 0 && disc <= BONDS.MAX_DISCOUNT_BPS))
    throw new GameError('discount', `The discount runs 0–${BONDS.MAX_DISCOUNT_BPS} bps.`);
  const payout = onchain ? round6(num(onchainPayout)) : bondPayout(eth, price, disc);
  if (!(payout > 0)) throw new GameError('payout', 'A bond payout must be positive.');
  const vestMs = BONDS.VEST_HOURS * 3600000;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // idempotency FIRST (under the tranche lock) — a re-delivered bond is a clean no-op even if the tranche
    // has since filled (never re-reject a valid, already-booked bond as over_capacity).
    await client.query('SELECT capacity_omr, committed_omr, pol_eth, dev_eth FROM bond_reserve WHERE id=1 FOR UPDATE');
    if ((await client.query('SELECT 1 FROM bonds WHERE nonce=$1', [n])).rows[0]) {
      await client.query('ROLLBACK'); return { recorded: false, duplicate: true };
    }
    const res = (await client.query('SELECT capacity_omr, committed_omr, pol_eth, dev_eth FROM bond_reserve WHERE id=1')).rows[0];
    // THE ANTI-PONZI CAP: the treasury can never promise more OMR than it budgeted (the full-reserve-queue
    // discipline). Over the tranche → reject; the treasury must top up (mod/bond/fund) first. This is a
    // PRE-FLIGHT guard for the off-chain/mod request path ONLY: a REAL on-chain Bonded event already
    // happened (the contract enforced its OWN identical cap against its funded balance), so it must ALWAYS
    // be recorded — never rejected — or the watcher would stall the cursor forever on a legitimate bond.
    if (!onchain && Number(res.committed_omr) + payout > Number(res.capacity_omr) + 1e-6) {
      await client.query('ROLLBACK');
      throw new GameError('over_capacity', 'The bond tranche is exhausted — the treasury must top it up.');
    }
    // attribute: an explicit accountId (mod/test) wins; else resolve the payer wallet → account (null = parked
    // for reconcileBonds at link — the Store precedent; recordBond stays valid + tranche-committed either way).
    let acct = accountId;
    if (!acct && addr) acct = (await client.query('SELECT account_id FROM account_persistent WHERE wallet_address=$1', [addr])).rows[0]?.account_id || null;
    // REAL-ETH accounting (POL + the Vig buyback basis) is booked ONLY for a bond driven by a real
    // on-chain Bonded event (one carrying a txHash) — the store.js:121 precedent (audit MED). A mod
    // comp/QA `simulate` has NO txHash: it books the bond + the OMR tranche commitment (bounded by the
    // treasury-funded capacity, so the OMR side stays backed) but injects ZERO pol_eth / vig_revenue.
    // Else a comp with no real ETH behind it would fabricate Vig revenue that runVigBuyback (which sums
    // vig_revenue with no source filter) would spend → unbacking the withdrawal reserve, invisible to
    // runVigInvariants. Real ETH only ever comes with a tx.
    // the on-chain path books the EVENT's actual toPol/toVig split (mirrors the contract's polBps exactly,
    // so the backend can't drift from the contract even if BONDS.POL_BPS ever diverges); the mod/simulate
    // path derives it from BONDS.POL_BPS, and books ZERO real-ETH accounting without a txHash (the audit
    // MED — a comp with no real ETH must not fabricate Vig revenue runVigBuyback would spend unbacked).
    const real = !!txHash;
    const polEth = onchain ? round6(num(onchainPol)) : (real ? round6(eth * BONDS.POL_BPS / 10000) : 0);
    const devEth = onchain ? round6(num(onchainDev) || 0) : (real ? round6(eth * BONDS.DEV_BPS / 10000) : 0);
    const vigEth = onchain ? round6(num(onchainVig)) : (real ? round6(eth - polEth - devEth) : 0);
    // THE QUOTE-SIGNER ENRICHMENT: the Bonded event omits the quote's price/discount (it emits only the
    // resolved payout + POL/Vig split), so the watcher's effective values (payout/eth, disc 0) are a
    // fallback. If the server-signed quote is on file (chain.js:quoteBond persisted it by nonce), recover
    // the TRUE price + discount for the record — so oracle_price + discount_bps are the real bond terms and
    // the invariant's `discounts ≤ MAX` check sees the actual number. Mark the quote consumed. No quote
    // (a mod comp/QA bond, or a bond made out-of-band) → the effective fallback stands.
    let recPrice = round6(price), recDisc = disc;
    if (onchain) {
      const q = (await client.query('SELECT price, discount_bps FROM bond_quotes WHERE nonce=$1', [n])).rows[0];
      if (q) {
        recPrice = round6(Number(q.price)); recDisc = Number(q.discount_bps);
        await client.query("UPDATE bond_quotes SET status='bonded' WHERE nonce=$1", [n]);
      }
    }
    await client.query(
      'INSERT INTO bonds (id, nonce, account_id, payer_address, principal_eth, payout_omr, oracle_price, discount_bps, vest_ms, tx_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [uid(), n, acct, addr, round6(eth), payout, recPrice, recDisc, vestMs, txHash]);
    await client.query('UPDATE bond_reserve SET committed_omr = committed_omr + $1, pol_eth = pol_eth + $2, dev_eth = dev_eth + $3 WHERE id=1', [payout, polEth, devEth]);
    if (real && !(await client.query("SELECT 1 FROM vig_revenue WHERE source='bond' AND ref=$1", [String(n)])).rows[0])
      await client.query("INSERT INTO vig_revenue (source, ref, kind, gross_eth, vig_eth) VALUES ('bond',$1,'bond',$2,$2)", [String(n), vigEth]);
    await client.query('COMMIT');
    return { recorded: true, payoutOmr: payout, polEth, devEth, vigEth, real, attributed: !!acct };
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

// vested OMR for a bond row at `now` (linear over vest_ms)
const vestedOf = (b, now = Date.now()) =>
  round6(Number(b.payout_omr) * Math.min(1, Math.max(0, now - new Date(b.opened_at).getTime()) / Number(b.vest_ms)));

// ── claim vested OMR (accounting off-chain; the real release is the OmertaBond contract on mainnet). ──
export async function claimBond(pool, accountId, bondId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const b = (await client.query('SELECT * FROM bonds WHERE id=$1 AND account_id=$2 FOR UPDATE', [bondId, accountId])).rows[0];
    if (!b) { await client.query('ROLLBACK'); throw new GameError('not_found', 'No such bond of yours.'); }
    const claimable = round6(vestedOf(b) - Number(b.claimed_omr));
    if (!(claimable > 0)) { await client.query('ROLLBACK'); throw new GameError('nothing', 'Nothing vested to claim yet.'); }
    await client.query('UPDATE bonds SET claimed_omr = claimed_omr + $2 WHERE id=$1', [bondId, claimable]);
    await client.query('COMMIT');
    return { ok: true, claimed: claimable, note: 'Off-chain accounting — the on-chain OmertaBond contract releases the real OMR (mainnet, dormant).' };
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

// ── reconcile-at-link (the reconcileStore twin) — attribute any PARKED bonds this wallet made BEFORE it was
// linked, so a pre-link bonder can claim. Case-insensitive address match; claim-then-attribute is a single
// UPDATE so two concurrent links can't both grab the same parked row. Called from walletVerify. ──
export async function reconcileBonds(pool, accountId, address) {
  const addr = norm(address);
  if (!addr) return { attributed: 0 };
  const claimed = (await pool.query(
    'UPDATE bonds SET account_id=$2 WHERE lower(payer_address)=lower($1) AND account_id IS NULL RETURNING id',
    [addr, accountId])).rows;
  return { attributed: claimed.length };
}

// ── the treasury tops up the bond tranche (the budget the protocol will bond out). A treasury act (mod). ──
export async function fundBondTranche(pool, omr) {
  const amt = num(omr);
  // (red-team R15 L1) reject Infinity/NaN too — `Number(Infinity) > 0` would set capacity_omr to Infinity
  // (mod-gated + out-of-band bucket, but parity with the player-facing finite guards).
  if (!Number.isFinite(amt) || !(amt > 0)) throw new GameError('bad_amount', 'Fund a positive OMR amount.');
  await pool.query('UPDATE bond_reserve SET capacity_omr = capacity_omr + $1 WHERE id=1', [round6(amt)]);
  const r = (await pool.query('SELECT capacity_omr, committed_omr FROM bond_reserve WHERE id=1')).rows[0];
  return { ok: true, added: round6(amt), capacityOmr: round6(Number(r.capacity_omr)), committedOmr: round6(Number(r.committed_omr)) };
}

// ── GET /v1/bonds — public: the offering + remaining capacity + the oracle + your bonds. Informational
// (real bonds are on-chain at the mainnet paywall — the Store's on-chain-note precedent). ──
export async function bondBoard(pool, accountId) {
  const r = (await pool.query('SELECT capacity_omr, committed_omr, pol_eth, dev_eth FROM bond_reserve WHERE id=1')).rows[0] || {};
  const remaining = round6(Math.max(0, Number(r.capacity_omr || 0) - Number(r.committed_omr || 0)));
  const oracle = await oraclePrice(pool);
  const mine = accountId ? (await pool.query('SELECT * FROM bonds WHERE account_id=$1 ORDER BY opened_at DESC', [accountId])).rows : [];
  const now = Date.now();
  return {
    offering: { discountBps: BONDS.DISCOUNT_BPS, vestHours: BONDS.VEST_HOURS, polBps: BONDS.POL_BPS, vigBps: BONDS.VIG_BPS, devBps: BONDS.DEV_BPS, minEth: BONDS.MIN_PRINCIPAL_ETH },
    oracle, // OMR per ETH (null until a Vig buyback prints a price)
    reserve: { capacityOmr: round6(Number(r.capacity_omr || 0)), committedOmr: round6(Number(r.committed_omr || 0)), remainingOmr: remaining, polEth: round6(Number(r.pol_eth || 0)), devEth: round6(Number(r.dev_eth || 0)) },
    // an illustrative quote for 1 ETH at the current oracle + discount (display only)
    quote: oracle ? { forEth: 1, payoutOmr: bondPayout(1, oracle, BONDS.DISCOUNT_BPS) } : null,
    yours: mine.map((b) => {
      const vested = vestedOf(b, now);
      return { id: b.id, principalEth: round6(Number(b.principal_eth)), payoutOmr: round6(Number(b.payout_omr)),
        discountBps: Number(b.discount_bps), vestedOmr: vested, claimedOmr: round6(Number(b.claimed_omr)),
        claimableOmr: round6(Math.max(0, vested - Number(b.claimed_omr))),
        fullyVested: now - new Date(b.opened_at).getTime() >= Number(b.vest_ms) };
    }),
    isBacker: mine.length > 0, // "Treasury Backer" — pure STATUS (derived; no gameplay power, no §10.4 surface)
    note: 'Bonds are purchased on-chain at the OmertaBond paywall (mainnet, dormant); this endpoint is informational.',
  };
}

// ── ops view (the founder's bond dashboard) — capacity/committed/remaining + POL + the Vig share + the invariant. ──
export async function bondStatus(pool) {
  const r = (await pool.query('SELECT capacity_omr, committed_omr, pol_eth, dev_eth FROM bond_reserve WHERE id=1')).rows[0] || {};
  const bonds = Number((await pool.query('SELECT COUNT(*) n FROM bonds')).rows[0].n);
  const claimed = round6(Number((await pool.query('SELECT COALESCE(SUM(claimed_omr),0) s FROM bonds')).rows[0].s));
  const vigEth = round6(Number((await pool.query("SELECT COALESCE(SUM(vig_eth),0) s FROM vig_revenue WHERE source='bond'")).rows[0].s));
  const inv = await runBondInvariants(pool);
  return {
    capacityOmr: round6(Number(r.capacity_omr || 0)), committedOmr: round6(Number(r.committed_omr || 0)),
    remainingOmr: round6(Math.max(0, Number(r.capacity_omr || 0) - Number(r.committed_omr || 0))),
    polEth: round6(Number(r.pol_eth || 0)), devEth: round6(Number(r.dev_eth || 0)), vigEth, bonds, claimedOmr: claimed,
    invariant: inv.ok, checks: inv.checks,
    chainDormant: true, // the OmertaBond contract + watcher + POL bot are the mainnet milestone (legal + audit gated)
  };
}

// ── runBondInvariants — the real-value side (the runVigInvariants twin). Proves the bond is disciplined:
// committed matches the rows, never over-budget, never over-claimed, the ETH split reconciles, discounts capped. ──
export async function runBondInvariants(pool) {
  const checks = [];
  const push = (name, lhs, rhs, tol = 0.01) => checks.push({ name, lhs: round6(lhs), rhs: round6(rhs), ok: Math.abs(lhs - rhs) <= tol });
  const r = (await pool.query('SELECT capacity_omr, committed_omr, pol_eth, dev_eth FROM bond_reserve WHERE id=1')).rows[0] || { capacity_omr: 0, committed_omr: 0, pol_eth: 0, dev_eth: 0 };
  const sumPayout = Number((await pool.query('SELECT COALESCE(SUM(payout_omr),0) s FROM bonds')).rows[0].s);
  const sumClaimed = Number((await pool.query('SELECT COALESCE(SUM(claimed_omr),0) s FROM bonds')).rows[0].s);
  // REAL bonds only (tx_hash present): a mod comp/QA bond books no pol_eth/vig_eth, so the ETH-split
  // check (4) must reconcile over the real bonds that actually moved ETH (audit MED).
  const sumEth = Number((await pool.query('SELECT COALESCE(SUM(principal_eth),0) s FROM bonds WHERE tx_hash IS NOT NULL')).rows[0].s);
  const vigEth = Number((await pool.query("SELECT COALESCE(SUM(vig_eth),0) s FROM vig_revenue WHERE source='bond'")).rows[0].s);
  const committed = Number(r.committed_omr), capacity = Number(r.capacity_omr), polEth = Number(r.pol_eth), devEth = Number(r.dev_eth || 0);
  // (1) committed matches the rows
  push('bond committed == Σ payout', committed, sumPayout);
  // (2) THE CAP: committed ≤ capacity (one-sided — never over-budget)
  checks.push({ name: 'bond committed ≤ capacity', lhs: round6(committed), rhs: round6(capacity), ok: committed <= capacity + 0.01 });
  // (3) never over-claimed
  checks.push({ name: 'bond claimed ≤ committed', lhs: round6(sumClaimed), rhs: round6(committed), ok: sumClaimed <= committed + 0.01 });
  // (4) the ETH split reconciles (POL + Dev + Vig == principal — nothing skimmed, nothing hidden)
  push('bond ETH split == principal', polEth + devEth + vigEth, sumEth);
  // (5) discounts capped
  const badDisc = Number((await pool.query('SELECT COUNT(*) n FROM bonds WHERE discount_bps > $1', [BONDS.MAX_DISCOUNT_BPS])).rows[0].n);
  checks.push({ name: 'bond discounts ≤ MAX', lhs: badDisc, rhs: 0, ok: badDisc === 0 });
  return { ok: checks.every((c) => c.ok), checks };
}

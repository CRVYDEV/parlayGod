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
import { BONDS, bondPayout, underwriterScore, backerTierOf, nextBackerTier, charterOf, dayOf } from './rules.js';
import { spendOmr } from './vanity.js';

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
export async function recordBond(pool, { nonce, accountId = null, payer = null, principalEth, priceOmrPerEth, discountBps, txHash = null, onchainPayout = null, onchainPol = null, onchainVig = null, onchainDev = null, onchainRwa = null }) {
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
    // v2 step 3: a FOURTH slice — the TREASURY (earmarked for the stock float until that layer was
    // retired 2026-07-31; the bps and the plumbing are unchanged, only the destination). On the
    // on-chain path every slice comes from the event (the contract is the source of truth); off-chain
    // the remainder rule sits on the VIG slice so the four sum to the principal exactly, no dust.
    const real = !!txHash;
    const polEth = onchain ? round6(num(onchainPol)) : (real ? round6(eth * BONDS.POL_BPS / 10000) : 0);
    const devEth = onchain ? round6(num(onchainDev) || 0) : (real ? round6(eth * BONDS.DEV_BPS / 10000) : 0);
    const rwaEth = onchain ? round6(num(onchainRwa) || 0) : (real ? round6(eth * BONDS.RWA_BPS / 10000) : 0);
    const vigEth = onchain ? round6(num(onchainVig)) : (real ? round6(eth - polEth - devEth - rwaEth) : 0);
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
    await client.query('UPDATE bond_reserve SET committed_omr = committed_omr + $1, pol_eth = pol_eth + $2, dev_eth = dev_eth + $3, rwa_eth = rwa_eth + $4 WHERE id=1', [payout, polEth, devEth, rwaEth]);
    if (real && !(await client.query("SELECT 1 FROM vig_revenue WHERE source='bond' AND ref=$1", [String(n)])).rows[0])
      await client.query("INSERT INTO vig_revenue (source, ref, kind, gross_eth, vig_eth) VALUES ('bond',$1,'bond',$2,$2)", [String(n), vigEth]);
    // v2 step 3: the treasury's PRIMARY-INFLOW source (bond ETH arrives whether or not anyone is
    // trading). Same real-ETH gate as the Vig — a comp/QA bond books zero, so a simulate can never
    // assert the treasury received ETH that never moved.
    if (real && rwaEth > 0 && !(await client.query("SELECT 1 FROM rwa_revenue WHERE source='bond' AND ref=$1", [String(n)])).rows[0])
      await client.query("INSERT INTO rwa_revenue (source, ref, rwa_eth) VALUES ('bond',$1,$2)", [String(n), rwaEth]);
    await client.query('COMMIT');
    return { recorded: true, payoutOmr: payout, polEth, devEth, vigEth, rwaEth, real, attributed: !!acct };
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE UNDERWRITER (Tier-4) — the off-chain backer-prestige pillar. Pure STATUS + $OMR SINKS: the
// UNDERWRITER SCORE combines the real-ETH axis (bonded_eth, read-derived from the bonds table) with an
// earn-in-game pledge axis (pledged_omr, bumped by a $OMR burn), so a player reaches backer status in
// alpha via THE PLEDGE while the ETH axis lights up at mainnet. Zero new faucet, zero chain touch.
// Every new WRITE is single-party under withCharacter (locks the caller's own char + own account row
// only — trivially acyclic); the crown/league are READ-DERIVED (recomputed on read — the architect-crown
// precedent — so no cross-account write under a singleton lock).
// ════════════════════════════════════════════════════════════════════════════════════════════════

// the account's real-ETH backing, read-derived from the bonds table (account-level → survives death).
async function derivedBondedEth(pool, accountId) {
  if (!accountId) return 0;
  const s = (await pool.query('SELECT COALESCE(SUM(principal_eth),0) s FROM bonds WHERE account_id=$1', [accountId])).rows[0].s;
  return round6(Number(s || 0));
}

// the caller's backer standing — the combined score, tier, next-tier delta, and charter badge.
async function standingOf(pool, accountId) {
  const ap = (await pool.query('SELECT pledged_omr, bond_charter FROM account_persistent WHERE account_id=$1', [accountId])).rows[0] || {};
  const pledgedOmr = round6(Number(ap.pledged_omr || 0));
  const bondedEth = await derivedBondedEth(pool, accountId);
  const score = underwriterScore(bondedEth, pledgedOmr);
  const tier = backerTierOf(score);
  const nxt = nextBackerTier(score);
  const charterTier = Number(ap.bond_charter || 0);
  return {
    bondedEth, pledgedOmr, score, tier: tier.name, tierMin: tier.min,
    nextTier: nxt ? { name: nxt.name, min: nxt.min, delta: round6(nxt.min - score) } : null,
    charter: charterTier, charterName: charterTier ? (charterOf(charterTier) || {}).name || null : null,
    nextCharter: charterOf(charterTier + 1) || null,
  };
}

// ── THE PLEDGE — burn in-game $OMR "into the treasury's name" (the live-now orthogonal $OMR sink).
// Uncapped, repeatable, additive-to-score. A §10.4 BURN (bond:pledge) through the vanity spendOmr till. ──
export async function pledgeTreasury(ch, omr, client, h) {
  const amt = num(omr);
  if (!Number.isFinite(amt) || amt < BONDS.PLEDGE_MIN) throw new GameError('min', `Pledge at least ${BONDS.PLEDGE_MIN} $OMR.`);
  const cost = round6(amt);
  await spendOmr(client, h, cost, 'bond:pledge'); // debits h.acct.omr + ledgers the burn (throws 'omr' if short)
  // bump the account legend by DIRECT SQL on the same already-locked account row (NUMERIC → pg-mem arith-safe;
  // OFF persistAccount's positional list, so no clobber). h.acct arrives via loadOwned's SELECT *.
  await client.query('UPDATE account_persistent SET pledged_omr = pledged_omr + $1 WHERE account_id=$2', [cost, h.accountId]);
  if (h.acct) h.acct.pledged_omr = round6(Number(h.acct.pledged_omr || 0) + cost); // same-turn-consistent view
  const st = await standingOf(client, h.accountId);
  return { pledged: cost, standing: st };
}

// ── THE CHARTER — commission the next sequential treasury seal (the family-seals / estate-tier precedent).
// A pure display badge; a §10.4 BURN (bond:charter) from the account bucket. Backer-gated (score > 0). ──
export async function commissionCharter(ch, client, h) {
  const cur = Number(h.acct?.bond_charter || 0);
  const next = charterOf(cur + 1);
  if (!next) throw new GameError('maxed', 'You already hold The Founding Charter.');
  const bondedEth = await derivedBondedEth(client, h.accountId);
  const score = underwriterScore(bondedEth, Number(h.acct?.pledged_omr || 0));
  if (!(score > 0)) throw new GameError('not_backer', 'Back the treasury first — pledge $OMR or bond.');
  await spendOmr(client, h, next.omr, 'bond:charter'); // throws 'omr' if short
  await client.query('UPDATE account_persistent SET bond_charter = $1 WHERE account_id=$2', [next.tier, h.accountId]);
  if (h.acct) h.acct.bond_charter = next.tier;
  return { charter: next.tier, name: next.name, spent: next.omr };
}

// ── THE UNDERWRITERS' LEAGUE + THE FINANCIER crown + THE FAMILY SYNDICATE — all read-derived.
// A full-scan of living non-agent accounts (the hitmen-board precedent), bonds summed in JS (the /v1/gangs
// pg-mem precedent — never a correlated subquery), score computed, the top backer crowned 'The Financier'. ──
export async function underwriterLeaderboard(pool, limit = 25) {
  const rows = (await pool.query(
    `SELECT a.account_id, a.pledged_omr, a.bond_charter, c.name, g.name AS gang, g.tag
       FROM account_persistent a
       JOIN characters c ON c.account_id = a.account_id AND c.alive
       LEFT JOIN gang_members gm ON gm.character_id = c.id
       LEFT JOIN gangs g ON g.id = gm.gang_id
      WHERE NOT a.agent_flag`)).rows;
  const bondRows = (await pool.query('SELECT account_id, principal_eth FROM bonds WHERE account_id IS NOT NULL')).rows;
  const ethByAcct = {};
  for (const b of bondRows) ethByAcct[b.account_id] = (ethByAcct[b.account_id] || 0) + Number(b.principal_eth);
  const scored = [];
  const gangTally = {};
  for (const r of rows) {
    const bondedEth = round6(Number(ethByAcct[r.account_id] || 0));
    const pledgedOmr = round6(Number(r.pledged_omr || 0));
    const score = underwriterScore(bondedEth, pledgedOmr);
    if (!(score > 0)) continue;
    scored.push({ name: r.name, gang: r.gang || null, tag: r.tag || null, bondedEth, pledgedOmr, score,
      tier: backerTierOf(score).name, charter: Number(r.bond_charter || 0),
      charterName: r.bond_charter ? (charterOf(Number(r.bond_charter)) || {}).name || null : null });
    if (r.gang) { const gk = r.gang; (gangTally[gk] = gangTally[gk] || { name: r.gang, tag: r.tag || null, score: 0, backers: 0 });
      gangTally[gk].score += score; gangTally[gk].backers += 1; }
  }
  scored.sort((a, b) => b.score - a.score);
  const league = scored.slice(0, limit).map((e, i) => ({ ...e, rank: i + 1, financier: i === 0 }));
  const syndicate = Object.values(gangTally).map((g) => ({ ...g, score: round6(g.score) }))
    .sort((a, b) => b.score - a.score).slice(0, 15).map((g, i) => ({ ...g, rank: i + 1 }));
  return { league, syndicate };
}

// ── GET /v1/bonds — public: the offering + remaining capacity + the oracle + your bonds. Informational
// (real bonds are on-chain at the mainnet paywall — the Store's on-chain-note precedent). ──
// ── THE DAILY OFFERING — the GM's per-day issuance window (founder-directed) ─────────────────────
// The tranche (bond_reserve.capacity_omr) is the LIFETIME budget wall; this is the daily POLICY
// throttle on top: no offering row for the day → quoteBond signs NOTHING (fail-closed). Distinct
// from the contract's dailyCapOMR (the wall against a leaked signer — that one caps damage, this
// one expresses intent). Setting an offering moves no value and writes no ledger row (bonds are
// out-of-band real-value plumbing — the §10.4 posture of the whole module).
export async function setBondOffering(pool, omr, day = null) {
  const amt = Math.round(Number(omr));
  if (!Number.isFinite(amt) || amt < 0) throw new GameError('amount', 'A non-negative whole-OMR offering.');
  const d = day == null ? dayOf() : Math.floor(Number(day));
  if (!Number.isInteger(d) || d < dayOf()) throw new GameError('day', 'Offerings are set for today or a future day — the past is the record.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query('SELECT offered_omr, quoted_omr FROM bond_offerings WHERE day=$1 FOR UPDATE', [d])).rows[0];
    if (row) {
      // never retract below what's already signed — a signed quote is a live commitment
      const floor = Math.ceil(Number(row.quoted_omr));
      const eff = Math.max(amt, floor);
      await client.query('UPDATE bond_offerings SET offered_omr=$2 WHERE day=$1', [d, eff]);
      await client.query('COMMIT');
      return { ok: true, day: d, offeredOmr: eff, quotedOmr: Number(row.quoted_omr), flooredAtQuoted: eff !== amt };
    }
    await client.query('INSERT INTO bond_offerings (day, offered_omr) VALUES ($1,$2)', [d, amt]);
    await client.query('COMMIT');
    return { ok: true, day: d, offeredOmr: amt, quotedOmr: 0, flooredAtQuoted: false };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

export async function offeringOf(db, day = null) {
  const d = day == null ? dayOf() : Math.floor(Number(day));
  const row = (await db.query('SELECT offered_omr, quoted_omr FROM bond_offerings WHERE day=$1', [d])).rows[0];
  if (!row) return null;
  const offered = round6(Number(row.offered_omr)), quoted = round6(Number(row.quoted_omr));
  return { day: d, offeredOmr: offered, quotedOmr: quoted, remainingOmr: round6(Math.max(0, offered - quoted)) };
}

export async function bondBoard(pool, accountId) {
  const r = (await pool.query('SELECT capacity_omr, committed_omr, pol_eth, dev_eth, rwa_eth FROM bond_reserve WHERE id=1')).rows[0] || {};
  const remaining = round6(Math.max(0, Number(r.capacity_omr || 0) - Number(r.committed_omr || 0)));
  const oracle = await oraclePrice(pool);
  const mine = accountId ? (await pool.query('SELECT * FROM bonds WHERE account_id=$1 ORDER BY opened_at DESC', [accountId])).rows : [];
  const daily = await offeringOf(pool);
  const now = Date.now();
  return {
    offering: { discountBps: BONDS.DISCOUNT_BPS, vestHours: BONDS.VEST_HOURS, polBps: BONDS.POL_BPS, vigBps: BONDS.VIG_BPS, rwaBps: BONDS.RWA_BPS, devBps: BONDS.DEV_BPS, minEth: BONDS.MIN_PRINCIPAL_ETH },
    oracle, // OMR per ETH (null until a Vig buyback prints a price)
    reserve: { capacityOmr: round6(Number(r.capacity_omr || 0)), committedOmr: round6(Number(r.committed_omr || 0)), remainingOmr: remaining, polEth: round6(Number(r.pol_eth || 0)), devEth: round6(Number(r.dev_eth || 0)), rwaEth: round6(Number(r.rwa_eth || 0)) },
    // an illustrative quote for 1 ETH at the current oracle + discount (display only)
    // THE DAILY OFFERING — null = the desk is CLOSED today (fail-closed; the GM opens it)
    daily,
    quote: oracle ? { forEth: 1, payoutOmr: bondPayout(1, oracle, BONDS.DISCOUNT_BPS) } : null,
    yours: mine.map((b) => {
      const vested = vestedOf(b, now);
      return { id: b.id, principalEth: round6(Number(b.principal_eth)), payoutOmr: round6(Number(b.payout_omr)),
        discountBps: Number(b.discount_bps), vestedOmr: vested, claimedOmr: round6(Number(b.claimed_omr)),
        claimableOmr: round6(Math.max(0, vested - Number(b.claimed_omr))),
        fullyVested: now - new Date(b.opened_at).getTime() >= Number(b.vest_ms) };
    }),
    isBacker: mine.length > 0, // "Treasury Backer" — pure STATUS (derived; no gameplay power, no §10.4 surface)
    // Tier-4 — the caller's backer standing + the sink catalogs (the /v1/catalog discoverability precedent)
    yourStanding: accountId ? await standingOf(pool, accountId) : null,
    catalogs: { backerTiers: BONDS.BACKER_TIERS, charterTiers: BONDS.CHARTER_TIERS, pledgeMin: BONDS.PLEDGE_MIN, ethScoreOmr: BONDS.ETH_SCORE_OMR },
    note: 'Bonds are purchased on-chain at the OmertaBond paywall (mainnet, dormant); this endpoint is informational.',
  };
}

// ── ops view (the founder's bond dashboard) — capacity/committed/remaining + POL + the Vig share + the invariant. ──
export async function bondStatus(pool) {
  const r = (await pool.query('SELECT capacity_omr, committed_omr, pol_eth, dev_eth, rwa_eth FROM bond_reserve WHERE id=1')).rows[0] || {};
  const daily = await offeringOf(pool);
  const bonds = Number((await pool.query('SELECT COUNT(*) n FROM bonds')).rows[0].n);
  const claimed = round6(Number((await pool.query('SELECT COALESCE(SUM(claimed_omr),0) s FROM bonds')).rows[0].s));
  const vigEth = round6(Number((await pool.query("SELECT COALESCE(SUM(vig_eth),0) s FROM vig_revenue WHERE source='bond'")).rows[0].s));
  const inv = await runBondInvariants(pool);
  return {
    daily, // THE DAILY OFFERING — null = closed today (the GM opens it via POST /v1/mod/bond/offer)
    capacityOmr: round6(Number(r.capacity_omr || 0)), committedOmr: round6(Number(r.committed_omr || 0)),
    remainingOmr: round6(Math.max(0, Number(r.capacity_omr || 0) - Number(r.committed_omr || 0))),
    polEth: round6(Number(r.pol_eth || 0)), devEth: round6(Number(r.dev_eth || 0)),
    rwaEth: round6(Number(r.rwa_eth || 0)), vigEth, bonds, claimedOmr: claimed,
    invariant: inv.ok, checks: inv.checks,
    chainDormant: true, // the OmertaBond contract + watcher + POL bot are the mainnet milestone (legal + audit gated)
  };
}

// ── runBondInvariants — the real-value side (the runVigInvariants twin). Proves the bond is disciplined:
// committed matches the rows, never over-budget, never over-claimed, the ETH split reconciles, discounts capped. ──
export async function runBondInvariants(pool) {
  const checks = [];
  const push = (name, lhs, rhs, tol = 0.01) => checks.push({ name, lhs: round6(lhs), rhs: round6(rhs), ok: Math.abs(lhs - rhs) <= tol });
  const r = (await pool.query('SELECT capacity_omr, committed_omr, pol_eth, dev_eth, rwa_eth FROM bond_reserve WHERE id=1')).rows[0] || { capacity_omr: 0, committed_omr: 0, pol_eth: 0, dev_eth: 0, rwa_eth: 0 };
  const sumPayout = Number((await pool.query('SELECT COALESCE(SUM(payout_omr),0) s FROM bonds')).rows[0].s);
  const sumClaimed = Number((await pool.query('SELECT COALESCE(SUM(claimed_omr),0) s FROM bonds')).rows[0].s);
  // REAL bonds only (tx_hash present): a mod comp/QA bond books no pol_eth/vig_eth, so the ETH-split
  // check (4) must reconcile over the real bonds that actually moved ETH (audit MED).
  const sumEth = Number((await pool.query('SELECT COALESCE(SUM(principal_eth),0) s FROM bonds WHERE tx_hash IS NOT NULL')).rows[0].s);
  const vigEth = Number((await pool.query("SELECT COALESCE(SUM(vig_eth),0) s FROM vig_revenue WHERE source='bond'")).rows[0].s);
  const committed = Number(r.committed_omr), capacity = Number(r.capacity_omr), polEth = Number(r.pol_eth), devEth = Number(r.dev_eth || 0);
  const rwaEth = Number(r.rwa_eth || 0);
  // v2 step 3: the treasury slice is mirrored into rwa_revenue (the treasury's inflow ledger — the
  // table keeps its historical name) — so the accumulator and the mirror must agree, or the slice
  // could be booked twice or not at all.
  const rwaMirror = Number((await pool.query("SELECT COALESCE(SUM(rwa_eth),0) s FROM rwa_revenue WHERE source='bond'")).rows[0].s);
  // (1) committed matches the rows
  push('bond committed == Σ payout', committed, sumPayout);
  // (2) THE CAP: committed ≤ capacity (one-sided — never over-budget)
  checks.push({ name: 'bond committed ≤ capacity', lhs: round6(committed), rhs: round6(capacity), ok: committed <= capacity + 0.01 });
  // (3) never over-claimed
  checks.push({ name: 'bond claimed ≤ committed', lhs: round6(sumClaimed), rhs: round6(committed), ok: sumClaimed <= committed + 0.01 });
  // (4) the ETH split reconciles (POL + Dev + Vig + RWA == principal — nothing skimmed, nothing hidden)
  push('bond ETH split == principal', polEth + devEth + vigEth + rwaEth, sumEth);
  // (4b) the treasury slice reached the inflow ledger, not just the accumulator
  push('bond RWA slice == rwa_revenue', rwaEth, rwaMirror);
  // (4c) THE TREASURY ACTUALLY GOT PAID. (4) and (4b) are both satisfiable by rwaEth == 0 — (4) because the
  // Vig remainder absorbs the missing slice EXACTLY, (4b) because 0 == 0 — so between them they cannot
  // see a total failure of the RWA leg. That is not hypothetical: `OmertaBond` shipped splitting ETH
  // three ways (toPol/toDev/toVig) with no `toRwa`, so `recordBond`'s on-chain branch booked
  // rwa_eth = 0 on every REAL bond while both checks stayed green (CHAIN-DEPLOY.md §0.5, since fixed —
  // the contract now emits a fourth slice). This check is
  // deliberately PER-BOND and RATE-INDEPENDENT: "every real bond that moved ETH left a treasury row". An
  // aggregate `rwaEth ≈ sumEth × RWA_BPS` would false-alarm the moment the founder retunes the lever
  // (historical bonds were booked at the old rate) and a check that cries wolf gets deleted; a merely
  // structural "rwaEth > 0" would go quiet as soon as ONE bond funded the treasury, which is exactly the
  // mixed history a real deployment has. Counting bonds with no row survives both.
  //   Skipped when RWA_BPS is 0 (no treasury share signed → no row expected), and the principal guard
  // excludes a bond so small its slice rounds below 6dp, where `recordBond` legitimately writes nothing.
  //   Two flat queries + a JS filter rather than a correlated NOT EXISTS — pg-mem cannot parse one
  // (the /v1/gangs precedent), and an invariant that only runs in production is not an invariant.
  let unfunded = 0;
  if (BONDS.RWA_BPS > 0) {
    const realRows = (await pool.query('SELECT nonce, principal_eth FROM bonds WHERE tx_hash IS NOT NULL')).rows;
    const funded = new Set((await pool.query("SELECT ref FROM rwa_revenue WHERE source='bond'")).rows.map((x) => String(x.ref)));
    unfunded = realRows.filter((b) => Number(b.principal_eth) * BONDS.RWA_BPS / 10000 >= 0.000001
      && !funded.has(String(b.nonce))).length;
  }
  checks.push({ name: 'every real bond funded the treasury', lhs: unfunded, rhs: 0, ok: unfunded === 0 });
  // (5) discounts capped
  const badDisc = Number((await pool.query('SELECT COUNT(*) n FROM bonds WHERE discount_bps > $1', [BONDS.MAX_DISCOUNT_BPS])).rows[0].n);
  checks.push({ name: 'bond discounts ≤ MAX', lhs: badDisc, rhs: 0, ok: badDisc === 0 });
  return { ok: checks.every((c) => c.ok), checks };
}

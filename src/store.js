// THE STORE — ETH revenue packages (design omerta-eth-store-design.md). Real-money purchases that
// grant ONLY non-§10.4 things — entitlements (mint_credit / respawn_token), access windows
// (pass_until / wire_until), and status (patron). So §10.4 is UNTOUCHED by construction: this module
// writes ZERO `transactions` rows (the entitlements it grants are already out-of-band, the fees.js
// precedent). The only real-value accounting is the three-way revenue split (out-of-band, like
// vig_revenue): founder profit / $OMR buyback flywheel / RWA reserve (R2, dormant). The ETH itself
// went to the dev wallet ON-CHAIN via the OmertaFees tollbooth — the backend never custodies it.
//
// Isolation: this module writes only store_payments / store_grants / rwa_revenue / vig_revenue and
// the entitlement columns on account_persistent (+ the wire_until access window on the living
// character). The chain layer (a StorePaid watcher) is DORMANT — until it ships, the mod comp route
// and the test drive recordStorePurchase directly (the test/chain.js fee precedent).
import crypto from 'node:crypto';
import { getAddress } from 'viem';
import { GameError, notify } from './game.js';
import { STORE, PASS, PATRON, packageOf, RETIRED_PACKAGES, passActive, patronTierOf, patronTierName, passPrestigeOf } from './rules.js';
import { spendOmr } from './vanity.js'; // the audited $OMR till — gates the balance, debits in-memory, ledgers the burn

const uid = () => crypto.randomUUID();
const norm = (addr) => { try { return getAddress(addr); } catch { return null; } };
const positiveWei = (s) => { try { return BigInt(s ?? '0') > 0n; } catch { return false; } };
const round6 = (x) => Math.round(x * 1e6) / 1e6;
const laterMs = (a, b) => Math.max(a, b ? new Date(b).getTime() : 0);

// ── the three-way revenue split (recorded inside the caller's txn; idempotent on source+ref) ──
// buyback share → vig_revenue (the EXISTING flywheel: runVigBuyback buys $OMR → reserve + prize pool,
// so Store revenue funds earner prizes and runVigInvariants' `spend ≤ revenue` absorbs it unchanged).
// rwa share → rwa_revenue (R2, DORMANT — recorded, never spent). founder share is implicit (the ETH
// already hit the dev wallet on-chain). Amounts stored in ETH units to stay in JS-safe-integer range.
async function splitRevenue(client, { ref, amountWei }) {
  let grossEth = 0;
  try { grossEth = Number(BigInt(amountWei ?? '0')) / 1e18; } catch { grossEth = 0; }
  if (!(grossEth > 0)) return { split: false };
  const { founder, buyback, rwa } = STORE.SPLIT_BPS;
  const buybackEth = round6(grossEth * buyback / 10000);
  const rwaEth = round6(grossEth * rwa / 10000);
  const founderEth = round6(grossEth - buybackEth - rwaEth);
  // buyback share → the Vig flywheel (source 'store'). SELECT-then-INSERT (pg-mem ON CONFLICT is
  // unreliable); a re-delivered event is a no-op. gross_eth = the FULL payment, vig_eth = the buyback
  // share (so vigStatus.devRevenueEth = gross − buyback = founder + rwa, correct from the Vig's view).
  if (!(await client.query("SELECT 1 FROM vig_revenue WHERE source='store' AND ref=$1", [String(ref)])).rows[0])
    await client.query(
      "INSERT INTO vig_revenue (source, ref, kind, gross_eth, vig_eth) VALUES ('store',$1,'store',$2,$3)",
      [String(ref), round6(grossEth), buybackEth]);
  // rwa share → the dormant R2 accounting bucket
  if (!(await client.query("SELECT 1 FROM rwa_revenue WHERE source='store' AND ref=$1", [String(ref)])).rows[0])
    await client.query("INSERT INTO rwa_revenue (source, ref, rwa_eth) VALUES ('store',$1,$2)", [String(ref), rwaEth]);
  return { split: true, grossEth: round6(grossEth), founderEth, buybackEth, rwaEth };
}

// ── apply a SKU's grant to the account (headless — direct SQL, the fees.js no-clobber discipline) ──
async function grantPackage(client, accountId, sku, ref = null, real = false) {
  // A RETIRED sku still GRANTS here, and that asymmetry with the ingest is deliberate. This function
  // applies a payment that already exists — recorded before the retirement, or parked pre-link and
  // reconciled after it — so the money has moved and the buyer is owed what they bought. Refusing
  // would cancel a paid purchase AND crash sweepUncreditedStore for every other parked payment behind
  // it. What stops is buying it ANEW: recordStorePurchase and payPackagePlex both refuse.
  const pkg = packageOf(sku) || RETIRED_PACKAGES[sku];
  if (!pkg) throw new GameError('bad_sku', `Unknown package: ${sku}`);
  const g = pkg.grant || {};
  const now = Date.now();
  // THE PATRON PROGRAM (Tier-4): a REAL contribution (a txHash'd ETH purchase — never a comp) bumps the
  // lifetime patron_spent status meter by the SKU's ETH price. Direct SQL, OFF persistAccount's list.
  if (real && pkg.priceEth > 0) await client.query('UPDATE account_persistent SET patron_spent = patron_spent + $2 WHERE account_id=$1', [accountId, pkg.priceEth]);
  if (g.mintCredits) await client.query('UPDATE account_persistent SET mint_credits = mint_credits + $2 WHERE account_id=$1', [accountId, g.mintCredits]);
  if (g.respawnTokens) await client.query('UPDATE account_persistent SET respawn_tokens = respawn_tokens + $2 WHERE account_id=$1', [accountId, g.respawnTokens]);
  if (g.patron) await client.query('UPDATE account_persistent SET patron=true WHERE account_id=$1', [accountId]);
  if (g.cosmetic) {
    // account-level cosmetic UNLOCK (survives death). SELECT-then-INSERT (pg-mem ON CONFLICT unreliable);
    // a re-grant of an already-owned style is a no-op (the entitlement is boolean-owned, not stacked).
    if (!(await client.query('SELECT 1 FROM store_cosmetics WHERE account_id=$1 AND style=$2', [accountId, g.cosmetic])).rows[0])
      await client.query('INSERT INTO store_cosmetics (account_id, style) VALUES ($1,$2)', [accountId, g.cosmetic]);
  }
  if (g.passDays) {
    // EXTEND from the later of now / current end (the retainer/subscription precedent); absolute write
    // (pg-mem timestamp-interval arithmetic is unreliable — compute in JS, the setCargo discipline).
    const cur = (await client.query('SELECT pass_until, pass_tier FROM account_persistent WHERE account_id=$1', [accountId])).rows[0];
    const wasActive = cur?.pass_until && new Date(cur.pass_until).getTime() > now;
    const until = new Date(laterMs(now, cur?.pass_until) + g.passDays * 86400000);
    // buying the pass while it's LAPSED starts a FRESH season — reset the Ledger track. Renewing an
    // ACTIVE pass keeps your progress (the track just runs longer). THE LEDGER PRESTIGE (Tier-4): if the
    // prior track was COMPLETED (all tiers claimed), the fresh season bumps the lifetime pass_seasons meter.
    if (wasActive) await client.query('UPDATE account_persistent SET pass_until=$2 WHERE account_id=$1', [accountId, until]);
    else {
      const completed = Number(cur?.pass_tier || 0) >= PASS.TRACK.length;
      await client.query(`UPDATE account_persistent SET pass_until=$2, pass_tier=0, pass_at=NULL${completed ? ', pass_seasons = pass_seasons + 1' : ''} WHERE account_id=$1`, [accountId, until]);
    }
  }
  if (g.wireDays) {
    // the ETH Street Wire — extend the LIVING character's wire_until (character-level access window).
    // LOCK the character row (full-system v3 concurrency #2): wire_until is a persist-list column, and
    // this headless grant reads-then-writes it ABSOLUTE. Without the lock, a concurrent subscribeWire
    // (which mutates wire_until under the withCharacter char lock) could commit in the read→write gap
    // and be clobbered by the stale-read value — silently shortening a paid window. FOR UPDATE
    // serializes the two; grantPackage locks no account row here (its account updates are relative),
    // so char-first introduces no lock-order inversion.
    const ch = (await client.query('SELECT id, wire_until FROM characters WHERE account_id=$1 AND alive FOR UPDATE', [accountId])).rows[0];
    if (ch) {
      const until = new Date(laterMs(now, ch.wire_until) + g.wireDays * 86400000);
      await client.query('UPDATE characters SET wire_until=$2 WHERE id=$1', [ch.id, until]);
    } else {
      // no living character (bought pre-creation, or in a death→heir gap): PARK the days on the
      // account so the paid benefit isn't dropped — applied at the next character's birth (audit).
      await client.query('UPDATE account_persistent SET wire_pending_days = wire_pending_days + $2 WHERE account_id=$1', [accountId, g.wireDays]);
    }
  }
  await client.query('INSERT INTO store_grants (id, account_id, sku, ref) VALUES ($1,$2,$3,$4)', [uid(), accountId, sku, ref]);
  // tell the player their real-ETH purchase landed (offline-durable + live push); skip if no living street yet
  const liveCh = (await client.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [accountId])).rows[0];
  if (liveCh) await notify(client, liveCh.id, 'store_grant', { sku, name: pkg.name });
}

// Apply any parked Store Street-Wire window to a freshly-born character (audit — a wire bought while
// the account had no living character isn't dropped). Called at character creation; zeroes the parked
// days. Computed in JS (no pg-mem interval math). No §10.4 surface (an access window, not currency).
export async function claimPendingWire(client, accountId, characterId) {
  const a = (await client.query('SELECT wire_pending_days FROM account_persistent WHERE account_id=$1', [accountId])).rows[0];
  const days = Number(a?.wire_pending_days || 0);
  if (days <= 0) return 0;
  const ch = (await client.query('SELECT wire_until FROM characters WHERE id=$1', [characterId])).rows[0];
  const until = new Date(Math.max(Date.now(), ch?.wire_until ? new Date(ch.wire_until).getTime() : 0) + days * 86400000);
  await client.query('UPDATE characters SET wire_until=$2 WHERE id=$1', [characterId, until]);
  await client.query('UPDATE account_persistent SET wire_pending_days=0 WHERE account_id=$1', [accountId]);
  return days;
}

// ── ingestion: record one on-chain Store purchase (the recordFeePayment twin) ──
// Idempotent on nonce: a re-delivered event (reorg / watcher restart) is a no-op. If the payer's
// wallet is already linked AND the payment carried value, the entitlement is granted now; else the
// row waits (account_id NULL, granted false) until reconcileStore runs at link.
export async function recordStorePurchase(pool, { nonce, sku, payer, amountWei, txHash }) {
  // A RETIRED sku throwing here is the RIGHT failure, not an oversight. This is the ingest, so a
  // throw rolls the transaction back and the watcher cursor does NOT advance — which is what we want
  // if real money ever arrives for a package we no longer sell: a human looks, rather than the game
  // silently keeping the ETH or silently granting a bound-bypassing credit. Today it is unreachable
  // for `made_man` (the on-chain Store paywall is unbuilt, so the only caller is the mod comp route).
  if (!packageOf(sku)) throw new GameError(RETIRED_PACKAGES[sku] ? 'retired' : 'bad_sku',
    RETIRED_PACKAGES[sku]?.why || `Unknown package: ${sku}`);
  const addr = norm(payer);
  if (!addr) throw new GameError('bad_payer', 'Payer is not a valid EVM address.');
  const n = Number(nonce);
  if (!Number.isInteger(n) || n < 0) throw new GameError('bad_nonce', 'Bad payment nonce.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // idempotency: the nonce PK rejects a re-delivered event. Rethrow anything but 23505 so the outer
    // handler rolls back and the watcher cursor does NOT advance past an unrecorded real-money payment
    // (the fees.js F1 discipline — never swallow a non-duplicate insert error as "duplicate").
    try {
      await client.query(
        'INSERT INTO store_payments (nonce, sku, payer_address, amount_wei, tx_hash) VALUES ($1,$2,$3,$4,$5)',
        [n, sku, addr, String(amountWei ?? '0'), txHash || null]);
    } catch (e) {
      await client.query('ROLLBACK');
      if (e?.code === '23505') return { recorded: false, duplicate: true };
      throw e;
    }
    // Record the three-way revenue split ONLY for a REAL on-chain payment (one carrying a txHash from
    // the StorePaid event). A comp / QA grant via the mod route has no txHash → it grants the
    // entitlement but injects NO Vig buyback basis (audit MED: else a free comp would fabricate real-ETH
    // "revenue" that runVigBuyback — which sums vig_revenue with no source filter — could then spend,
    // unbacking the withdrawal reserve). Real ETH only ever comes with a tx.
    if (txHash) await splitRevenue(client, { ref: n, amountWei });
    const acct = (await client.query('SELECT account_id FROM account_persistent WHERE wallet_address=$1', [addr])).rows[0];
    let granted = false;
    if (acct) {
      const doGrant = positiveWei(amountWei);
      if (doGrant) await grantPackage(client, acct.account_id, sku, n, !!txHash); // real=!!txHash → patron_spent bumps only on real ETH
      await client.query('UPDATE store_payments SET account_id=$2, granted=$3 WHERE nonce=$1', [n, acct.account_id, doGrant]);
      granted = doGrant;
    }
    await client.query('COMMIT');
    return { recorded: true, granted, attributed: !!acct };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// ── reconcile-at-link (the reconcileFees twin): grant any purchases this wallet made BEFORE it linked.
// CLAIM-then-grant atomically (UPDATE … WHERE NOT granted RETURNING) so exactly one txn wins each row —
// two concurrent links (or a link racing the watcher) can't both grant the same purchase. Case-
// insensitive address match (parity with the sweep's discovery join). ──
export async function reconcileStore(pool, accountId, address) {
  const addr = norm(address);
  if (!addr) return { granted: 0 };
  const client = await pool.connect();
  let granted = 0;
  try {
    await client.query('BEGIN');
    const claimed = (await client.query(
      'UPDATE store_payments SET granted=true, account_id=$2 WHERE lower(payer_address)=lower($1) AND NOT granted RETURNING nonce, sku, amount_wei, tx_hash',
      [addr, accountId])).rows;
    for (const r of claimed) {
      // real=!!tx_hash — a pay-before-link REAL purchase still bumps patron_spent at reconcile (the risk
      // note: without SELECTing tx_hash here, the entitlement would credit but the patron meter would miss it).
      if (positiveWei(r.amount_wei)) { await grantPackage(client, accountId, r.sku, Number(r.nonce), !!r.tx_hash); granted++; }
    }
    await client.query('COMMIT');
    return { granted };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// Worker sweep (the link-vs-purchase TOCTOU twin of sweepUncreditedFees): re-run the reconcile for
// every ungranted purchase whose payer is a linked wallet. reconcileStore's claim-then-grant makes it
// race-safe + idempotent, so a purchase whose wallet linked in the same instant the row committed
// (event re-delivery is a nonce no-op) is still healed.
export async function sweepUncreditedStore(pool) {
  const rows = (await pool.query(
    `SELECT DISTINCT s.payer_address, a.account_id FROM store_payments s
       JOIN account_persistent a ON lower(a.wallet_address) = lower(s.payer_address)
      WHERE NOT s.granted`)).rows;
  let granted = 0;
  for (const r of rows) granted += (await reconcileStore(pool, r.account_id, r.payer_address)).granted;
  return { granted };
}

// ── PLEX-for-packages: pay a Store SKU from EARNED $OMR instead of ETH ──────────────────────────
// (founder-directed 2026-08-10, after the full retirement was pulled back to the mint alone: "maybe
// we over exaggerated on removing everything payable by OMR in Plex".)
//
// THE LINE IS THE BOUND, NOT THE DENOMINATION (see the same note in vig.js). A Store SKU is a
// consumable, an access window or cosmetic status — none of it gates anything, so which currency
// paid for it changes nothing about what it does. The one exception is absolute and is enforced
// below rather than remembered.
//
// The retirement's Store-specific argument was that a $OMR purchase routes around the four-way
// revenue split, and that half is TRUE: the four destinations get no wei today. What it left out is
// where the $OMR goes — since v3 step 2 `plex:%` is in `DESK.SINK_REASONS`, so it recycles onto the
// desk shelf and is sold for ETH at the daily auction. So the split is DEFERRED and re-routed
// through the desk, not skipped; and against that the rail buys the thing the post-v3 economy most
// lacks, which is a recurring reason to want the token at all.
//
// THE MINT IS THE EXCEPTION, and closing it is a real fix rather than a restoration. Before the full
// retirement, `payPlex('mint')` refused while the `made_man` SKU — which grants the same mint credit
// — was still PLEX-payable, so the ETH-only mint had a $OMR door standing open beside it. That is
// exactly the cheaper-rail hole the mint rule exists to prevent, routed around one layer up. No
// $OMR rail may produce a mint credit, checked on the GRANT rather than on the sku name so a new
// SKU cannot reopen it by being spelled differently.
//
// `made_man` itself is now RETIRED outright (see RETIRED_PACKAGES) — closing its $OMR door only to
// leave it selling the same credit for a hardcoded 0.01 ETH would have swapped a $OMR cheap-rail for
// an ETH one that did not move with MINT_TRANCHES. The grant guard below STAYS despite there no
// longer being a SKU that trips it: it is the wall, not the patch, and the whole point of checking
// the grant rather than the name is that it holds for a package nobody has written yet.
export async function plexPackageQuote(db, sku) {
  const pkg = packageOf(sku);
  if (!pkg) return null;
  const floor = round6(pkg.priceEth * STORE.PLEX_FLOOR_OMR_PER_ETH);
  const last = (await db.query('SELECT price_omr_per_eth FROM vig_buyback ORDER BY created_at DESC LIMIT 1')).rows[0];
  const oracle = last ? Number(last.price_omr_per_eth) : null;
  // defense-in-depth (audit LOW-1): a non-finite/≤0 oracle (only reachable via a hand-corrupted buyback
  // row — runVigBuyback guards price>0) must never propagate NaN into the price → the spend → §10.4.
  if (oracle == null || !Number.isFinite(oracle) || oracle <= 0) return { sku, price: floor, oracle: null };
  const price = Math.max(floor, round6(pkg.priceEth * oracle * STORE.PLEX_PREMIUM_BPS / 10000));
  return { sku, price, oracle };
}

export async function payPackagePlex(ch, sku, client, h) {
  const pkg = packageOf(sku);
  if (!pkg) throw new GameError(RETIRED_PACKAGES[sku] ? 'retired' : 'bad_sku',
    RETIRED_PACKAGES[sku]?.why || `Unknown package: ${sku}`);
  const g = pkg.grant || {}, now = Date.now();
  // GATE BEFORE THE BURN (walkthrough MED-1, the vig.js:116 precedent): a mint credit bought while
  // already made is DEAD (mintCharacter short-circuits on acct.minted, never spending it), and a pure
  // Patron's Ring re-buy is a no-op — refuse both so the player keeps their earned $OMR. (season_pass
  // still grants patron alongside pass days + revives, so it's never a no-op — don't gate it.)
  // THE MINT IS ETH ONLY, and this is the door beside it. `payPlex('mint')` has refused since the
  // mint-only pass, but a SKU whose grant includes a mint credit sold the same thing for $OMR one
  // layer up — the cheaper-rail hole the rule exists to close, routed around. Checked on the GRANT,
  // not the sku id, so a new package cannot reopen it by being spelled differently.
  if (g.mintCredits) throw new GameError('retired',
    'Anything that makes you is ETH only. Pay the fee on-chain, or earn the credit — the mission ladder grants one outright.');
  if (g.patron && !g.passDays && !g.mintCredits && !g.respawnTokens && h.acct?.patron)
    throw new GameError('patron', 'You already wear the ring.');
  // a cosmetic you already own would be a dead re-buy — refuse BEFORE the burn (the mint-credit precedent)
  if (g.cosmetic && (await client.query('SELECT 1 FROM store_cosmetics WHERE account_id=$1 AND style=$2', [ch.account_id, g.cosmetic])).rows[0])
    throw new GameError('owned', 'You already own that decor style.');
  const q = await plexPackageQuote(client, sku);
  // THE PATRON DISCOUNT (Tier-4) — a higher patron tier shaves plexDiscountBps off the PLEX price (the
  // DISCOUNTED $OMR is the number burned). SHIPS AT 0 (pure status) → q.price unchanged; the flagged lever.
  const spent0 = Number((await client.query('SELECT patron_spent FROM account_persistent WHERE account_id=$1', [ch.account_id])).rows[0]?.patron_spent || 0);
  const discBps = PATRON.TIERS[patronTierOf(spent0)]?.plexDiscountBps || 0;
  const floor = round6(pkg.priceEth * STORE.PLEX_FLOOR_OMR_PER_ETH);
  const price = Math.max(floor, round6(q.price * (10000 - discBps) / 10000)); // discounted, never below the PLEX floor
  if (Number(h.acct.omr) < price) throw new GameError('omr', `That runs ${price} $OMR at the current rate — earn it, or pay the ETH fee.`);
  await spendOmr(client, h, price, `plex:${sku}`); // gates h.acct.omr, debits in-memory, ledgers the burn (plex:% term)
  // PLEX is a REAL earned-$OMR contribution → bump the lifetime patron meter (direct SQL under the actor lock, off the persist list)
  if (pkg.priceEth > 0) await client.query('UPDATE account_persistent SET patron_spent = patron_spent + $2 WHERE account_id=$1', [ch.account_id, pkg.priceEth]);
  if (g.mintCredits) h.acct.mint_credits = Number(h.acct.mint_credits || 0) + g.mintCredits;         // persistAccount commits
  if (g.respawnTokens) h.acct.respawn_tokens = Number(h.acct.respawn_tokens || 0) + g.respawnTokens; // persistAccount commits
  if (g.patron) { await client.query('UPDATE account_persistent SET patron=true WHERE account_id=$1', [ch.account_id]); if (h.acct) h.acct.patron = true; }
  if (g.cosmetic) await client.query('INSERT INTO store_cosmetics (account_id, style) VALUES ($1,$2)', [ch.account_id, g.cosmetic]); // gated above → never a dup
  if (g.passDays) {
    const cur = (await client.query('SELECT pass_until, pass_tier FROM account_persistent WHERE account_id=$1', [ch.account_id])).rows[0];
    const wasActive = cur?.pass_until && new Date(cur.pass_until).getTime() > now;
    const until = new Date(laterMs(now, cur?.pass_until) + g.passDays * 86400000);
    if (wasActive) await client.query('UPDATE account_persistent SET pass_until=$2 WHERE account_id=$1', [ch.account_id, until]);
    else {
      const completed = Number(cur?.pass_tier || 0) >= PASS.TRACK.length; // THE LEDGER PRESTIGE: a finished track → +1 season
      await client.query(`UPDATE account_persistent SET pass_until=$2, pass_tier=0, pass_at=NULL${completed ? ', pass_seasons = pass_seasons + 1' : ''} WHERE account_id=$1`, [ch.account_id, until]);
    }
  }
  if (g.wireDays) ch.wire_until = new Date(laterMs(now, ch.wire_until) + g.wireDays * 86400000); // persistCharacter commits
  await client.query('INSERT INTO store_grants (id, account_id, sku, ref) VALUES ($1,$2,$3,NULL)', [uid(), ch.account_id, sku]);
  await h.track(client, ch.account_id, 'plex_package', { sku, omr: price });
  return { ok: true, sku, name: pkg.name, omrSpent: price };
}

// ── read model: the catalog + your live entitlements ──
export async function storeBoard(pool, accountId) {
  const a = (await pool.query(
    'SELECT minted, mint_credits, respawn_tokens, patron, pass_until, patron_spent, pass_seasons FROM account_persistent WHERE account_id=$1', [accountId])).rows[0] || {};
  const ch = (await pool.query('SELECT wire_until FROM characters WHERE account_id=$1 AND alive', [accountId])).rows[0];
  const now = Date.now();
  const wireMs = ch?.wire_until ? new Date(ch.wire_until).getTime() : 0;
  const passMs = a.pass_until ? new Date(a.pass_until).getTime() : 0;
  const cosmetics = (await pool.query('SELECT style FROM store_cosmetics WHERE account_id=$1', [accountId])).rows.map((r) => r.style);
  // THE PATRON PROGRAM (Tier-4): the caller's backer standing + the (ship-at-0) PLEX discount.
  const spentEth = round6(Number(a.patron_spent || 0));
  const tierIdx = patronTierOf(spentEth);
  const discBps = PATRON.TIERS[tierIdx]?.plexDiscountBps || 0;
  const nextT = PATRON.TIERS[tierIdx + 1] || null;
  const seasons = Number(a.pass_seasons || 0);
  const prIdx = passPrestigeOf(seasons);
  const oracleRow = (await pool.query('SELECT price_omr_per_eth FROM vig_buyback ORDER BY created_at DESC LIMIT 1')).rows[0];
  const oracle = oracleRow ? Number(oracleRow.price_omr_per_eth) : null;
  // `plexOmr: null` on a SKU is the POSITIVE claim that this one has a single rail and it is ETH —
  // which is now true of exactly one thing, anything that would MAKE you. Everything else quotes.
  const plexOf = (p) => {
    if (p.grant?.mintCredits) return null;               // the mint is ETH only — no $OMR price exists
    const floor = round6(p.priceEth * STORE.PLEX_FLOOR_OMR_PER_ETH);
    const raw = (oracle && Number.isFinite(oracle) && oracle > 0)
      ? Math.max(floor, round6(p.priceEth * oracle * STORE.PLEX_PREMIUM_BPS / 10000)) : floor;
    return Math.max(floor, round6(raw * (10000 - discBps) / 10000)); // patron-discounted, never below the floor
  };
  return {
    packages: STORE.PACKAGES.map((p) => ({ sku: p.sku, name: p.name, priceEth: p.priceEth, plexOmr: plexOf(p), grant: p.grant, blurb: p.blurb })),
    // A POSITIVE claim rather than a silent absence: a client with a card for a retired sku learns
    // where the thing went instead of finding it simply gone (the `plexOmr: null` / `emission:
    // {faucet: null}` shape). `where` is the route that now sells it.
    retired: Object.entries(RETIRED_PACKAGES).map(([sku, p]) => ({ sku, name: p.name, why: p.why, where: p.where })),
    split: STORE.SPLIT_BPS,
    owned: {
      minted: !!a.minted, mintCredits: Number(a.mint_credits || 0), respawnTokens: Number(a.respawn_tokens || 0),
      patron: !!a.patron,
      patronStanding: { spentEth, tier: tierIdx, tierName: PATRON.TIERS[tierIdx].name, plexDiscountBps: discBps,
        nextTier: nextT ? { name: nextT.name, minEth: nextT.minEth, delta: round6(nextT.minEth - spentEth) } : null },
      pass: { active: passActive(a, now), seconds: Math.max(0, Math.ceil((passMs - now) / 1000)),
        seasons, prestigeRank: prIdx, prestigeName: PASS.PRESTIGE_RANKS[prIdx].name },
      wire: { active: wireMs > now, seconds: Math.max(0, Math.ceil((wireMs - now) / 1000)) },
      cosmetics, // owned decor styles (applied to your club via POST /v1/speakeasy/decor)
    },
    catalogs: { patronTiers: PATRON.TIERS, prestigeRanks: PASS.PRESTIGE_RANKS },
    // real-money payments are on-chain (the OmertaFees paywall) — this endpoint is informational
    note: 'Purchases are made on-chain at the OmertaFees paywall; the watcher credits your account.',
  };
}

// ── THE BENEFACTORS + PATRON FAMILIES + THE HOUSE'S FAVOR (Store Tier-4) — all read-derived (zero writes).
// A full-scan of living non-agent accounts with patron_spent > 0 (the recruiter-board precedent; agents pay
// like anyone but are excluded from the status board, matching estates/collection — the founder-choice default).
// families aggregates a gang's roster spend in JS (the /gangs pg-mem precedent); favor is the top patron (crown). ──
export async function benefactorLeaderboard(pool, limit = 25) {
  const rows = (await pool.query(
    `SELECT a.account_id, a.patron_spent, a.pass_seasons, c.name, g.name AS gang, g.tag
       FROM account_persistent a
       JOIN characters c ON c.account_id = a.account_id AND c.alive
       LEFT JOIN gang_members gm ON gm.character_id = c.id
       LEFT JOIN gangs g ON g.id = gm.gang_id
      WHERE a.patron_spent > 0 AND NOT a.agent_flag`)).rows;
  const patrons = []; const gangTally = {};
  for (const r of rows) {
    const spentEth = round6(Number(r.patron_spent || 0));
    const seasons = Number(r.pass_seasons || 0);
    patrons.push({ steward: r.name, gang: r.gang || null, tag: r.tag || null, spentEth,
      tier: patronTierOf(spentEth), tierName: patronTierName(spentEth),
      seasons, prestige: passPrestigeOf(seasons), prestigeName: PASS.PRESTIGE_RANKS[passPrestigeOf(seasons)].name });
    if (r.gang) { const k = r.gang; (gangTally[k] = gangTally[k] || { name: r.gang, tag: r.tag || null, spentEth: 0, patrons: 0 });
      gangTally[k].spentEth += spentEth; gangTally[k].patrons += 1; }
  }
  patrons.sort((a, b) => b.spentEth - a.spentEth);
  const ranked = patrons.slice(0, limit).map((p, i) => ({ ...p, rank: i + 1, spentEth: round6(p.spentEth) }));
  const families = Object.values(gangTally).map((g) => ({ ...g, spentEth: round6(g.spentEth) }))
    .sort((a, b) => b.spentEth - a.spentEth).slice(0, 15).map((g, i) => ({ ...g, rank: i + 1 }));
  return { patrons: ranked, families, favor: ranked[0] || null }; // favor = THE HOUSE'S FAVOR (the read-derived crown)
}

// ── the founder's revenue view (the three-way split totals) for the ops dashboard ──
export async function revenueStatus(pool) {
  const grossEth = round6(Number((await pool.query("SELECT COALESCE(SUM(gross_eth),0) s FROM vig_revenue WHERE source='store'")).rows[0].s));
  const buybackEth = round6(Number((await pool.query("SELECT COALESCE(SUM(vig_eth),0) s FROM vig_revenue WHERE source='store'")).rows[0].s));
  // the TREASURY's share. Named `rwa*` throughout because the table and the split key are — the
  // stock layer it funded was retired 2026-07-31 (omerta-stock-layer-retirement.md) and the ETH now
  // simply accumulates. There is no spend seat any more, so nothing reads a buyback log.
  const rwaEth = round6(Number((await pool.query("SELECT COALESCE(SUM(rwa_eth),0) s FROM rwa_revenue WHERE source='store'")).rows[0].s));
  const founderEth = round6(grossEth - buybackEth - rwaEth);
  const bySku = (await pool.query(
    'SELECT sku, COUNT(*) n FROM store_payments WHERE granted GROUP BY sku')).rows.map((r) => ({ sku: r.sku, sold: Number(r.n) }));
  const pending = Number((await pool.query('SELECT COUNT(*) n FROM store_payments WHERE NOT granted')).rows[0].n);
  return {
    split: STORE.SPLIT_BPS,
    grossEth, founderEth, buybackEth, rwaEth, treasuryEth: rwaEth,
    treasuryHolds: 'eth', // the stock layer is retired — this slice accumulates as ETH, it is not spent on units
    bySku, pendingLinks: pending,
  };
}

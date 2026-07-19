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
import { STORE, packageOf, passActive } from './rules.js';
import { spendOmr } from './vanity.js';

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
async function grantPackage(client, accountId, sku, ref = null) {
  const pkg = packageOf(sku);
  if (!pkg) throw new GameError('bad_sku', `Unknown package: ${sku}`);
  const g = pkg.grant || {};
  const now = Date.now();
  if (g.mintCredits) await client.query('UPDATE account_persistent SET mint_credits = mint_credits + $2 WHERE account_id=$1', [accountId, g.mintCredits]);
  if (g.respawnTokens) await client.query('UPDATE account_persistent SET respawn_tokens = respawn_tokens + $2 WHERE account_id=$1', [accountId, g.respawnTokens]);
  if (g.patron) await client.query('UPDATE account_persistent SET patron=true WHERE account_id=$1', [accountId]);
  if (g.passDays) {
    // EXTEND from the later of now / current end (the retainer/subscription precedent); absolute write
    // (pg-mem timestamp-interval arithmetic is unreliable — compute in JS, the setCargo discipline).
    const cur = (await client.query('SELECT pass_until FROM account_persistent WHERE account_id=$1', [accountId])).rows[0];
    const wasActive = cur?.pass_until && new Date(cur.pass_until).getTime() > now;
    const until = new Date(laterMs(now, cur?.pass_until) + g.passDays * 86400000);
    // buying the pass while it's LAPSED starts a FRESH season — reset the Ledger track. Renewing an
    // ACTIVE pass keeps your progress (the track just runs longer).
    if (wasActive) await client.query('UPDATE account_persistent SET pass_until=$2 WHERE account_id=$1', [accountId, until]);
    else await client.query('UPDATE account_persistent SET pass_until=$2, pass_tier=0, pass_at=NULL WHERE account_id=$1', [accountId, until]);
  }
  if (g.wireDays) {
    // the ETH Street Wire — extend the LIVING character's wire_until (character-level access window)
    const ch = (await client.query('SELECT id, wire_until FROM characters WHERE account_id=$1 AND alive', [accountId])).rows[0];
    if (ch) {
      const until = new Date(laterMs(now, ch.wire_until) + g.wireDays * 86400000);
      await client.query('UPDATE characters SET wire_until=$2 WHERE id=$1', [ch.id, until]);
    }
  }
  await client.query('INSERT INTO store_grants (id, account_id, sku, ref) VALUES ($1,$2,$3,$4)', [uid(), accountId, sku, ref]);
  // tell the player their real-ETH purchase landed (offline-durable + live push); skip if no living street yet
  const liveCh = (await client.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [accountId])).rows[0];
  if (liveCh) await notify(client, liveCh.id, 'store_grant', { sku, name: pkg.name });
}

// ── ingestion: record one on-chain Store purchase (the recordFeePayment twin) ──
// Idempotent on nonce: a re-delivered event (reorg / watcher restart) is a no-op. If the payer's
// wallet is already linked AND the payment carried value, the entitlement is granted now; else the
// row waits (account_id NULL, granted false) until reconcileStore runs at link.
export async function recordStorePurchase(pool, { nonce, sku, payer, amountWei, txHash }) {
  if (!packageOf(sku)) throw new GameError('bad_sku', `Unknown package: ${sku}`);
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
      if (doGrant) await grantPackage(client, acct.account_id, sku, n);
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
      'UPDATE store_payments SET granted=true, account_id=$2 WHERE lower(payer_address)=lower($1) AND NOT granted RETURNING nonce, sku, amount_wei',
      [addr, accountId])).rows;
    for (const r of claimed) {
      if (positiveWei(r.amount_wei)) { await grantPackage(client, accountId, r.sku, Number(r.nonce)); granted++; }
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

// ── PLEX-for-packages: pay a SKU's fee from EARNED $OMR (a plex:* burn) for the SAME entitlement ──
// The market-linked quote: max(floor, feeEth × latest-buyback-price × premium). `db` is a pool or an
// open client (in-txn read). oracle null (static floor) until a first buyback prints a price.
export async function plexPackageQuote(db, sku) {
  const pkg = packageOf(sku);
  if (!pkg) return null;
  const floor = round6(pkg.priceEth * STORE.PLEX_FLOOR_OMR_PER_ETH);
  const last = (await db.query('SELECT price_omr_per_eth FROM vig_buyback ORDER BY created_at DESC LIMIT 1')).rows[0];
  if (!last) return { sku, price: floor, oracle: null };
  const oracle = Number(last.price_omr_per_eth);
  const price = Math.max(floor, round6(pkg.priceEth * oracle * STORE.PLEX_PREMIUM_BPS / 10000));
  return { sku, price, oracle };
}

// POST /v1/store/plex/:sku — buy a Store package with EARNED $OMR. Runs under withCharacter (h.acct is
// the account). BURNS the $OMR (plex:<sku>, a §10.4-legal deflationary sink via the plex:% term) and
// grants the SAME non-§10.4 entitlement an ETH payer gets. The grant is done IN-CONTEXT: persisted
// columns (mint_credits/respawn_tokens via persistAccount; wire_until via persistCharacter) are mutated
// IN-MEMORY so the post-handler persist commits them; non-persisted state (patron/pass_*) is direct SQL
// (no clobber). This is why we don't call the headless grantPackage here — it would be clobbered.
export async function payPackagePlex(ch, sku, client, h) {
  const pkg = packageOf(sku);
  if (!pkg) throw new GameError('bad_sku', `Unknown package: ${sku}`);
  const q = await plexPackageQuote(client, sku);
  const price = q.price;
  if (Number(h.acct.omr) < price) throw new GameError('omr', `That runs ${price} $OMR at the current rate — earn it, or pay the ETH fee.`);
  await spendOmr(client, h, price, `plex:${sku}`); // gates h.acct.omr, debits in-memory, ledgers the burn (plex:% term)
  const g = pkg.grant || {}, now = Date.now();
  if (g.mintCredits) h.acct.mint_credits = Number(h.acct.mint_credits || 0) + g.mintCredits;         // persistAccount commits
  if (g.respawnTokens) h.acct.respawn_tokens = Number(h.acct.respawn_tokens || 0) + g.respawnTokens; // persistAccount commits
  if (g.patron) { await client.query('UPDATE account_persistent SET patron=true WHERE account_id=$1', [ch.account_id]); if (h.acct) h.acct.patron = true; }
  if (g.passDays) {
    const cur = (await client.query('SELECT pass_until FROM account_persistent WHERE account_id=$1', [ch.account_id])).rows[0];
    const wasActive = cur?.pass_until && new Date(cur.pass_until).getTime() > now;
    const until = new Date(laterMs(now, cur?.pass_until) + g.passDays * 86400000);
    if (wasActive) await client.query('UPDATE account_persistent SET pass_until=$2 WHERE account_id=$1', [ch.account_id, until]);
    else await client.query('UPDATE account_persistent SET pass_until=$2, pass_tier=0, pass_at=NULL WHERE account_id=$1', [ch.account_id, until]);
  }
  if (g.wireDays) ch.wire_until = new Date(laterMs(now, ch.wire_until) + g.wireDays * 86400000); // persistCharacter commits
  await client.query('INSERT INTO store_grants (id, account_id, sku, ref) VALUES ($1,$2,$3,NULL)', [uid(), ch.account_id, sku]);
  await h.track(client, ch.account_id, 'plex_package', { sku, omr: price });
  return { ok: true, sku, name: pkg.name, omrSpent: price };
}

// ── read model: the catalog + your live entitlements ──
export async function storeBoard(pool, accountId) {
  const a = (await pool.query(
    'SELECT minted, mint_credits, respawn_tokens, patron, pass_until FROM account_persistent WHERE account_id=$1', [accountId])).rows[0] || {};
  const ch = (await pool.query('SELECT wire_until FROM characters WHERE account_id=$1 AND alive', [accountId])).rows[0];
  const now = Date.now();
  const wireMs = ch?.wire_until ? new Date(ch.wire_until).getTime() : 0;
  const passMs = a.pass_until ? new Date(a.pass_until).getTime() : 0;
  // the PLEX price (pay in earned $OMR) — one oracle read, derived per SKU
  const last = (await pool.query('SELECT price_omr_per_eth FROM vig_buyback ORDER BY created_at DESC LIMIT 1')).rows[0];
  const oracle = last ? Number(last.price_omr_per_eth) : null;
  const plexOf = (p) => {
    const floor = round6(p.priceEth * STORE.PLEX_FLOOR_OMR_PER_ETH);
    return oracle ? Math.max(floor, round6(p.priceEth * oracle * STORE.PLEX_PREMIUM_BPS / 10000)) : floor;
  };
  return {
    packages: STORE.PACKAGES.map((p) => ({ sku: p.sku, name: p.name, priceEth: p.priceEth, plexOmr: plexOf(p), grant: p.grant, blurb: p.blurb })),
    split: STORE.SPLIT_BPS,
    owned: {
      minted: !!a.minted, mintCredits: Number(a.mint_credits || 0), respawnTokens: Number(a.respawn_tokens || 0),
      patron: !!a.patron,
      pass: { active: passActive(a, now), seconds: Math.max(0, Math.ceil((passMs - now) / 1000)) },
      wire: { active: wireMs > now, seconds: Math.max(0, Math.ceil((wireMs - now) / 1000)) },
    },
    // real-money payments are on-chain (the OmertaFees paywall) — this endpoint is informational
    note: 'Purchases are made on-chain at the OmertaFees paywall; the watcher credits your account.',
  };
}

// ── the founder's revenue view (the three-way split totals) for the ops dashboard ──
export async function revenueStatus(pool) {
  const grossEth = round6(Number((await pool.query("SELECT COALESCE(SUM(gross_eth),0) s FROM vig_revenue WHERE source='store'")).rows[0].s));
  const buybackEth = round6(Number((await pool.query("SELECT COALESCE(SUM(vig_eth),0) s FROM vig_revenue WHERE source='store'")).rows[0].s));
  const rwaEth = round6(Number((await pool.query("SELECT COALESCE(SUM(rwa_eth),0) s FROM rwa_revenue WHERE source='store'")).rows[0].s));
  const rwaSpent = round6(Number((await pool.query("SELECT COALESCE(SUM(spent_eth),0) s FROM rwa_revenue")).rows[0].s));
  const founderEth = round6(grossEth - buybackEth - rwaEth);
  const bySku = (await pool.query(
    'SELECT sku, COUNT(*) n FROM store_payments WHERE granted GROUP BY sku')).rows.map((r) => ({ sku: r.sku, sold: Number(r.n) }));
  const pending = Number((await pool.query('SELECT COUNT(*) n FROM store_payments WHERE NOT granted')).rows[0].n);
  return {
    split: STORE.SPLIT_BPS,
    grossEth, founderEth, buybackEth, rwaEth, rwaSpent,
    rwaDormant: rwaSpent === 0, // R2 not yet built — the rwa share is recorded, never spent
    bySku, pendingLinks: pending,
  };
}

// §11 inbound fee ingestion — the entry (0.01 ETH mint) and revive-insurance (0.10 ETH
// respawn) fees. Players pay them ON-CHAIN to the OmertaFees contract, which forwards the
// ETH straight to the developer wallet in the same transaction — this backend never custodies
// ETH and never mints in-game value from a fee. The worker's fee watcher observes the
// contract's MintFeePaid / RespawnFeePaid events and calls `recordFeePayment` here, which
// (idempotently) records the payment and credits the paying account an in-game entitlement:
//   • mint    → account.mint_credits +1   (spend via POST /v1/character/mint → account.minted)
//   • respawn → account.respawn_tokens +1 (auto-consumed on a killing blow, see social.js)
//   • reroll  → account.reroll_credits +1 (spend via POST /v1/character/reroll → re-roll the build)
//
// Isolation: this module writes only `fee_payments`, the four entitlement columns on
// `account_persistent` (minted / mint_credits / respawn_tokens / reroll_credits), and — on a
// reroll spend — the paying character's OWN stat columns (a total-conserved re-roll, no value
// moves). It writes ZERO rows to `transactions` — real ETH is out-of-band value, outside the
// §10.4 in-game conservation set (a re-roll only redistributes a fixed stat budget, no currency).
import { getAddress } from 'viem';
import crypto from 'node:crypto';
import { GameError, notify, deadlockToRetry } from './game.js';
import { recordVigRevenue } from './vig.js';
import { recordCommunityRevenue } from './community.js';
import { rollStats, TREASURY, COMMUNITY } from './rules.js';

const norm = (addr) => { try { return getAddress(addr); } catch { return null; } };
// A payment only grants an entitlement if it actually carried value — belt-and-suspenders
// against a zero/underpriced fee misconfig on-chain (the contract also enforces a >0 floor).
const positiveWei = (s) => { try { return BigInt(s ?? '0') > 0n; } catch { return false; } };

async function creditEntitlement(client, accountId, kind) {
  if (kind === 'mint') await client.query('UPDATE account_persistent SET mint_credits = mint_credits + 1 WHERE account_id=$1', [accountId]);
  else if (kind === 'respawn') await client.query('UPDATE account_persistent SET respawn_tokens = respawn_tokens + 1 WHERE account_id=$1', [accountId]);
  else if (kind === 'reroll') await client.query('UPDATE account_persistent SET reroll_credits = reroll_credits + 1 WHERE account_id=$1', [accountId]);
  else throw new GameError('bad_fee_kind', `Unknown fee kind: ${kind}`);
  // tell the player their real-ETH payment landed (offline-durable + live push); the paywall's
  // silent moment otherwise gives zero in-game acknowledgement. Skip if no living character yet.
  const ch = (await client.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [accountId])).rows[0];
  if (ch) await notify(client, ch.id, 'fee_credited', { kind });
}

// Record one on-chain payment. Idempotent on the contract nonce: a re-delivered event (reorg,
// watcher restart) is a no-op. If the payer's wallet is already linked, the entitlement is
// credited now; otherwise the row waits (account_id NULL) until `reconcileFees` runs at link.
export async function recordFeePayment(pool, { nonce, kind, payer, amountWei, txHash }) {
  if (kind !== 'mint' && kind !== 'respawn' && kind !== 'reroll') throw new GameError('bad_fee_kind', `Unknown fee kind: ${kind}`);
  const addr = norm(payer);
  if (!addr) throw new GameError('bad_payer', 'Payer is not a valid EVM address.');
  const n = Number(nonce);
  if (!Number.isInteger(n) || n < 0) throw new GameError('bad_nonce', 'Bad payment nonce.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // idempotency: the nonce PK rejects a re-delivered event. Try the insert; a duplicate
    // key (23505) means we've already processed this payment — roll back and report it.
    // AUDIT (fee lens F1): swallow ONLY the true duplicate. A bare catch absorbed EVERY insert
    // error (timeout, serialization failure, a future constraint) as "duplicate", returned
    // normally, and let the watcher advance its cursor past a real-money payment that was never
    // recorded — an unrecoverable lost fee. Rethrow anything but 23505 so the outer handler rolls
    // back and the cursor does NOT advance (the block window re-scans idempotently next tick).
    try {
      await client.query(
        'INSERT INTO fee_payments (nonce, kind, payer_address, amount_wei, tx_hash) VALUES ($1,$2,$3,$4,$5)',
        [n, kind, addr, String(amountWei ?? '0'), txHash || null]);
    } catch (e) {
      await client.query('ROLLBACK');
      if (e?.code === '23505') return { recorded: false, duplicate: true };
      throw e;
    }
    // Phase 2: route this payment's Vig share into the redistribution pool (same txn). The ETH
    // itself still went to the dev wallet on-chain; this only records the accounting split. Booked
    // ONLY for a REAL on-chain payment (one carrying a txHash from the observed FeePaid event) — the
    // store.js/bonds.js precedent (AUDIT-full-system-v2 D-MED2). A comp / manual QA record with no
    // txHash grants the entitlement but injects ZERO Vig revenue — else it would fabricate real-ETH
    // "revenue" that runVigBuyback (which sums vig_revenue with no source filter) would spend,
    // unbacking the withdrawal reserve, invisible to runVigInvariants.
    if (txHash) await recordVigRevenue(client, { source: 'fee', ref: n, kind, amountWei });
    // THE FLOAT (omerta-rwa-float-design.md): a FEE_RWA_BPS slice of the same real payment funds the
    // The TREASURY's slice — carved from the FOUNDER share (the Vig 60% is untouched), so the split
    // is Vig 60 / treasury 10 / founder 30. Same txHash gate (no fabricated real-ETH revenue), same
    // SELECT-then-INSERT idempotency on (source, ref) as the Store's earmark. (This funded the stock
    // float until 2026-07-31; the slice and its bps are unchanged, only the destination.)
    if (txHash) {
      let grossEth = 0;
      try { grossEth = Number(BigInt(amountWei ?? '0')) / 1e18; } catch { grossEth = 0; }
      const rwaEth = Math.round(grossEth * TREASURY.FEE_TREASURY_BPS() / 10000 * 1e6) / 1e6;
      if (rwaEth > 0 && !(await client.query(
        "SELECT 1 FROM rwa_revenue WHERE source='fee' AND ref=$1", [String(n)])).rows[0])
        await client.query("INSERT INTO rwa_revenue (source, ref, rwa_eth) VALUES ('fee',$1,$2)", [String(n), rwaEth]);
      // THE COMMUNITY SLICE (the family buyback, omerta-treasury-to-family-design.md §4) — carved
      // from the implicit founder/operations remainder exactly like the treasury slice above. The
      // lever ships at 0 (Phase 1), so this books nothing until the Phase-2 flip; same txHash gate,
      // same idempotency, recorded inside the same txn.
      const commEth = Math.round(grossEth * COMMUNITY.FEE_BPS() / 10000 * 1e6) / 1e6;
      if (commEth > 0)
        await recordCommunityRevenue(client, { source: 'fee', ref: String(n), currency: 'eth', gross: grossEth, amount: commEth });
    }
    const acct = (await client.query('SELECT account_id FROM account_persistent WHERE wallet_address=$1', [addr])).rows[0];
    let credited = false;
    if (acct) {
      // attribute now; only GRANT the entitlement when the payment carried value
      const grant = positiveWei(amountWei);
      if (grant) await creditEntitlement(client, acct.account_id, kind);
      await client.query('UPDATE fee_payments SET account_id=$2, credited=$3 WHERE nonce=$1', [n, acct.account_id, grant]);
      credited = grant;
    }
    await client.query('COMMIT');
    return { recorded: true, credited, attributed: !!acct };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// Worker sweep (audit: link-vs-fee TOCTOU): a fee whose wallet links in the same instant the fee
// row commits can land uncredited with NO later trigger — event re-delivery is a nonce no-op and
// the player only re-heals by re-running SIWE. Periodically re-run the reconcile for every
// uncredited payment whose payer is a linked wallet; reconcileFees's claim-then-credit makes the
// sweep race-safe and idempotent.
export async function sweepUncreditedFees(pool) {
  const rows = (await pool.query(
    `SELECT DISTINCT f.payer_address, a.account_id FROM fee_payments f
       JOIN account_persistent a ON lower(a.wallet_address) = lower(f.payer_address)
      WHERE NOT f.credited`)).rows;
  let credited = 0;
  for (const r of rows) credited += (await reconcileFees(pool, r.account_id, r.payer_address)).credited;
  return { credited };
}

// Called right after a wallet links (SIWE): sweep any payments this wallet made BEFORE it was
// linked and grant the entitlements now. Each becomes credited exactly once (the flag guards it).
export async function reconcileFees(pool, accountId, address) {
  const addr = norm(address);
  if (!addr) return { credited: 0 };
  const client = await pool.connect();
  let credited = 0;
  try {
    await client.query('BEGIN');
    // CLAIM-then-credit, atomically: the guarded UPDATE ... WHERE NOT credited RETURNING lets
    // exactly one transaction win each row. Two concurrent links (or a link racing the watcher)
    // can no longer both see the same uncredited row and each grant a token — the loser's UPDATE
    // matches zero rows. (Prior SELECT-then-credit double-credited one on-chain fee into N tokens.)
    // AUDIT (fee lens F4): match case-INSENSITIVELY, exactly like sweepUncreditedFees's JOIN. Both
    // sides store checksummed addresses today (so this is behaviour-preserving), but an exact-case
    // predicate here against a case-insensitive discovery join was a fragile coupling: any future
    // path storing a differently-cased address would make the row forever uncreditable AND make the
    // sweep re-select it every cycle (a busy no-op). lower()=lower() closes that.
    const claimed = (await client.query(
      'UPDATE fee_payments SET credited=true, account_id=$2 WHERE lower(payer_address)=lower($1) AND NOT credited RETURNING kind, amount_wei',
      [addr, accountId])).rows;
    for (const r of claimed) {
      if (positiveWei(r.amount_wei)) { await creditEntitlement(client, accountId, r.kind); credited++; }
    }
    await client.query('COMMIT');
    return { credited };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// Spend one mint credit to "mint" the account's living street — the two-tier upgrade from a
// free trial character to a permanent, withdrawal-eligible one. Idempotent: an already-minted
// account is a no-op (never burns a second credit). account-level `minted` is the gate truth;
// the living character's `minted` mirror is for the view + the fiction (a "made" man).
export async function mintCharacter(pool, accountId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // lock the CHARACTER row first, then the account — the canonical characters→accounts order
    // (matching withCharacter + rerollCharacter), so mint can't AB-BA against any of them; the rare
    // residual still maps to a clean retryable `contention` via deadlockToRetry below. A character
    // exists before minting; if there's no living street, minting is a no-op-with-error either branch.
    const ch = (await client.query('SELECT id FROM characters WHERE account_id=$1 AND alive FOR UPDATE', [accountId])).rows[0];
    const acct = (await client.query('SELECT * FROM account_persistent WHERE account_id=$1 FOR UPDATE', [accountId])).rows[0];
    if (!acct) throw new GameError('no_account', 'No such account.');
    if (acct.minted) {
      if (ch) await client.query('UPDATE characters SET minted=true WHERE id=$1', [ch.id]);
      await client.query('COMMIT');
      return { minted: true, alreadyMinted: true };
    }
    if (Number(acct.mint_credits) < 1)
      throw new GameError('no_mint_credit', 'You need a mint credit first — pull the Dockside Heist on the mission ladder (free), or buy one with ETH or earned $OMR.');
    if (!ch) throw new GameError('no_character', 'Create a character first, then mint it.');
    await client.query('UPDATE account_persistent SET minted=true, mint_credits = mint_credits - 1 WHERE account_id=$1', [accountId]);
    await client.query('UPDATE characters SET minted=true WHERE id=$1', [ch.id]);
    await notify(client, ch.id, 'made', {}); // a made man — the street is permanent now
    await client.query('COMMIT');
    return { minted: true };
  } catch (e) { await client.query('ROLLBACK'); throw deadlockToRetry(e); }
  finally { client.release(); }
}

// Spend one reroll credit (a paid 0.01 ETH re-roll) to RE-ROLL the living character's build. The
// roll is total-conserved (same fixed budget, new shape — no power creep, no §10.4 surface: no
// currency moves) and server-authoritative + rng_audit'd. Infinitely repeatable — each re-roll
// consumes one paid credit. The CHARACTER row is locked first (the canonical characters→accounts
// order, matching withCharacter) so a double-submit can't spend two credits on one intent and a
// concurrent action can't clobber the new build. The rare AB-BA vs mintCharacter (account→character,
// once-ever) surfaces as a clean retryable `contention` via deadlockToRetry rather than a raw 500.
export async function rerollCharacter(pool, accountId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // lock the CHARACTER row first, then the account — the canonical characters→accounts order (a
    // concurrent withCharacter action locks the character too, so the re-roll serializes with it and
    // no persist can clobber the new build, and there's no AB-BA vs the standard lock order).
    const ch = (await client.query('SELECT id FROM characters WHERE account_id=$1 AND alive FOR UPDATE', [accountId])).rows[0];
    if (!ch) throw new GameError('no_character', 'Create a character first.');
    const acct = (await client.query('SELECT reroll_credits FROM account_persistent WHERE account_id=$1 FOR UPDATE', [accountId])).rows[0];
    if (!acct) throw new GameError('no_account', 'No such account.');
    if (Number(acct.reroll_credits) < 1)
      throw new GameError('no_reroll_credit', 'Pay the 0.01 ETH re-roll fee on-chain first, then re-roll your build.');
    const st = rollStats();
    await client.query('UPDATE account_persistent SET reroll_credits = reroll_credits - 1 WHERE account_id=$1', [accountId]);
    await client.query('UPDATE characters SET muscle=$2, cunning=$3, speed=$4 WHERE id=$1', [ch.id, st.muscle, st.cunning, st.speed]);
    await client.query('INSERT INTO rng_audit (id, character_id, action, roll, outcome) VALUES ($1,$2,$3,$4,$5)',
      [crypto.randomUUID(), ch.id, 'reroll_stats', Math.random(), `${st.muscle}/${st.cunning}/${st.speed}`]);
    await notify(client, ch.id, 'rerolled', st);
    await client.query('COMMIT');
    return { rerolled: true, stats: st };
  } catch (e) { await client.query('ROLLBACK'); throw deadlockToRetry(e); }
  finally { client.release(); }
}

export async function feeStatus(pool, accountId) {
  const a = (await pool.query('SELECT minted, mint_credits, respawn_tokens, reroll_credits FROM account_persistent WHERE account_id=$1', [accountId])).rows[0] || {};
  return { minted: !!a.minted, mintCredits: Number(a.mint_credits || 0), respawnTokens: Number(a.respawn_tokens || 0), rerollCredits: Number(a.reroll_credits || 0) };
}

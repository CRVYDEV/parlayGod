// §11 inbound fee ingestion — the entry (0.01 ETH mint) and revive-insurance (0.10 ETH
// respawn) fees. Players pay them ON-CHAIN to the OmertaFees contract, which forwards the
// ETH straight to the developer wallet in the same transaction — this backend never custodies
// ETH and never mints in-game value from a fee. The worker's fee watcher observes the
// contract's MintFeePaid / RespawnFeePaid events and calls `recordFeePayment` here, which
// (idempotently) records the payment and credits the paying account an in-game entitlement:
//   • mint    → account.mint_credits +1   (spend via POST /v1/character/mint → account.minted)
//   • respawn → account.respawn_tokens +1 (auto-consumed on a killing blow, see social.js)
//
// Isolation: this module writes only `fee_payments` and the three entitlement columns on
// `account_persistent` (minted / mint_credits / respawn_tokens). It writes ZERO rows to
// `transactions` — real ETH is out-of-band value, outside the §10.4 in-game conservation set.
import { getAddress } from 'viem';
import { GameError, notify } from './game.js';
import { recordVigRevenue } from './vig.js';

const norm = (addr) => { try { return getAddress(addr); } catch { return null; } };
// A payment only grants an entitlement if it actually carried value — belt-and-suspenders
// against a zero/underpriced fee misconfig on-chain (the contract also enforces a >0 floor).
const positiveWei = (s) => { try { return BigInt(s ?? '0') > 0n; } catch { return false; } };

async function creditEntitlement(client, accountId, kind) {
  if (kind === 'mint') await client.query('UPDATE account_persistent SET mint_credits = mint_credits + 1 WHERE account_id=$1', [accountId]);
  else if (kind === 'respawn') await client.query('UPDATE account_persistent SET respawn_tokens = respawn_tokens + 1 WHERE account_id=$1', [accountId]);
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
  if (kind !== 'mint' && kind !== 'respawn') throw new GameError('bad_fee_kind', `Unknown fee kind: ${kind}`);
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
    const acct = (await client.query('SELECT * FROM account_persistent WHERE account_id=$1 FOR UPDATE', [accountId])).rows[0];
    if (!acct) throw new GameError('no_account', 'No such account.');
    if (acct.minted) {
      await client.query('UPDATE characters SET minted=true WHERE account_id=$1 AND alive', [accountId]);
      await client.query('COMMIT');
      return { minted: true, alreadyMinted: true };
    }
    if (Number(acct.mint_credits) < 1)
      throw new GameError('no_mint_credit', 'Pay the 0.01 ETH mint fee on-chain first (then your character is made).');
    const ch = (await client.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [accountId])).rows[0];
    if (!ch) throw new GameError('no_character', 'Create a character first, then mint it.');
    await client.query('UPDATE account_persistent SET minted=true, mint_credits = mint_credits - 1 WHERE account_id=$1', [accountId]);
    await client.query('UPDATE characters SET minted=true WHERE account_id=$1 AND alive', [accountId]);
    await notify(client, ch.id, 'made', {}); // a made man — the street is permanent now
    await client.query('COMMIT');
    return { minted: true };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

export async function feeStatus(pool, accountId) {
  const a = (await pool.query('SELECT minted, mint_credits, respawn_tokens FROM account_persistent WHERE account_id=$1', [accountId])).rows[0] || {};
  return { minted: !!a.minted, mintCredits: Number(a.mint_credits || 0), respawnTokens: Number(a.respawn_tokens || 0) };
}

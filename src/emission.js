// ── src/emission.js — THE STREET WAGE (the value-creation pivot, E1 off-chain core) ──
// Design: omerta-value-creation-design.md. The game creates $OMR on a fixed, transparent,
// decaying schedule: each epoch (a UTC day) releases at most `epochBudget(epoch)` from the
// hard-capped Emission Endowment, paid pro-rata to MEASURED PLAY — respect gained during the
// epoch — with a per-account cap, a level floor, a minimum score, and agents/banned excluded
// (the referral/social anti-Sybil posture). Respect gain costs energy (regen-limited), so a
// login-bot earns nothing and a Sybil farm pays a real grind cost per account.
//
// §10.4: every wage is a ledgered `emission:wage` $OMR MINT (in the vocabulary + the mint term),
// bounded twice — per-epoch by the budget (enforced here at pay time) and lifetime by the
// `emission within endowment` invariant check. The budget is a ceiling, not an obligation:
// what isn't earned isn't minted, and the endowment lasts longer.
//
// Concurrency discipline (the runSeasonRollover twin): ONE txn per character — lock the char row
// FOR UPDATE (canonical characters→accounts order, so a concurrent player action can't clobber
// the account credit), re-check the snapshot stamp under the lock (idempotent + crash-resumable),
// pay, stamp. `payable` is the epoch budget MINUS what this epoch already minted (`emittedThisEpoch`),
// so a mid-epoch process crash + resume TOPS UP toward the budget instead of restarting it — the
// survivors split only the unspent remainder (reproducing their original shares) and the signed
// per-epoch schedule is never breached. The lifetime endowment still bounds emission. (A single
// worker + guardedTick keeps two runs of one epoch from racing the pre-commit `emittedThisEpoch`
// read; any true endowment breach still trips the `emission within endowment` invariant regardless.)
import crypto from 'node:crypto';
import { EMISSION, emissionEpochOf, epochBudget, levelOf, wageRequireMinted } from './rules.js';

const floor2 = (x) => Math.floor(x * 100) / 100;

export async function emittedTotal(pool) {
  return Number((await pool.query(
    "SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='omr' AND reason='emission:wage'"
  )).rows[0].s);
}

// What THIS epoch has already minted — the crash-resume budget guard (survives a process restart,
// unlike an in-memory pre-compute). The epoch is a raw UTC day number (emissionEpochOf =
// floor(ms/86400000)), so its window opens at epoch × 86400000 and wage rows, dated at pay time,
// fall inside that day. So a resumed run reads what run 1 committed and tops up toward the budget.
export async function emittedThisEpoch(pool, epoch) {
  return Number((await pool.query(
    "SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='omr' AND reason='emission:wage' AND at >= $1 AND at < $2",
    [new Date(epoch * 86400000), new Date((epoch + 1) * 86400000)])).rows[0].s);
}

// Run one wage epoch. Idempotent per epoch (safe at any worker tick frequency): candidates are
// characters whose snapshot is stamped `epoch-1`; every processed character is re-stamped `epoch`,
// so a second run the same day finds nobody. A character with no snapshot yet (fresh street, or
// the feature just shipped) is ENROLLED this epoch and can earn from the next one.
// Advisory-lock namespace for the wage epoch — the two-int form (classid, objid=epoch) so it can
// never collide with the single-arg schema boot lock (db.js SCHEMA_LOCK_KEY). 0x5741 = "WA".
const WAGE_LOCK_CLASS = 0x5741;

export async function runWageEpoch(pool, opts = {}) {
  const epoch = opts.epoch ?? emissionEpochOf();
  const budget = opts.budget ?? epochBudget(epoch);
  // Cross-PROCESS single-execution for this epoch. guardedTick only bounds IN-process overlap, so
  // two worker replicas (or a mod-fired run alongside the scheduled tick) could each read
  // emittedThisEpoch=0 pre-commit and both pay up to the budget — a SILENT per-epoch overrun the
  // lifetime-endowment invariant can't see (it only bounds the total). A SESSION advisory lock held
  // on a dedicated connection across the whole run serializes the replicas; a crashed run releases
  // it when its session ends, so a resume still runs and tops up toward the budget (the
  // emittedThisEpoch design is preserved). pg-mem (no DATABASE_URL) is single-process → no lock.
  let lockConn = null;
  if (process.env.DATABASE_URL) {
    lockConn = await pool.connect();
    const got = (await lockConn.query('SELECT pg_try_advisory_lock($1,$2) AS ok', [WAGE_LOCK_CLASS, epoch])).rows[0].ok;
    if (!got) { lockConn.release(); return { epoch, budget, payable: 0, paid: 0, workers: 0, candidates: 0, skipped: 'locked' }; }
  }
  try {
    return await runWageEpochInner(pool, opts, epoch, budget);
  } finally {
    if (lockConn) {
      await lockConn.query('SELECT pg_advisory_unlock($1,$2)', [WAGE_LOCK_CLASS, epoch]).catch(() => {});
      lockConn.release();
    }
  }
}

async function runWageEpochInner(pool, opts, epoch, budget) {
  // lifetime ceiling: what's already minted leaves this much endowment room
  const room = Math.max(0, EMISSION.ENDOWMENT_OMR - (await emittedTotal(pool)));
  // per-epoch ceiling that SURVIVES a mid-epoch crash: subtract what this epoch already minted, so a
  // resumed run tops up toward the budget instead of re-granting the whole budget to the survivors
  // (the confirmed crash-resume over-emission). Endowment room still hard-bounds lifetime emission.
  const consumed = await emittedThisEpoch(pool, epoch);
  const payable = Math.min(Math.max(0, budget - consumed), room);

  const rows = (await pool.query(`
    SELECT c.id, c.account_id, c.respect, s.epoch AS snap_epoch, s.respect AS snap_respect,
           a.agent_flag, a.minted, acc.status
      FROM characters c
      JOIN account_persistent a ON a.account_id = c.account_id
      JOIN accounts acc ON acc.id = c.account_id
      LEFT JOIN wage_snapshots s ON s.character_id = c.id
     WHERE c.alive ORDER BY c.id`)).rows;

  // score the candidates (baseline = last epoch's stamp; everyone else just [re-]enrolls)
  const needMinted = wageRequireMinted();
  const scored = [];
  for (const r of rows) {
    if (Number(r.snap_epoch) !== epoch - 1) continue;
    if (r.agent_flag || r.status === 'banned') continue;
    if (needMinted && !r.minted) continue; // the D1 Sybil wall: only paid (minted) identities draw
    const gain = Math.max(0, Number(r.respect) - Number(r.snap_respect));
    if (levelOf(Number(r.respect)) < EMISSION.WAGE_MIN_LVL) continue;
    if (gain < EMISSION.WAGE_MIN_SCORE) continue;
    scored.push({ id: r.id, account: r.account_id, gain });
  }
  const total = scored.reduce((a, b) => a + b.gain, 0);
  // pre-compute every share (stable across a crash-resume; Σ shares ≤ payable by construction)
  const shareOf = new Map(scored.map((s) =>
    [s.id, total > 0 && payable > 0 ? floor2(Math.min(EMISSION.WAGE_CAP_OMR, payable * (s.gain / total))) : 0]));

  let paid = 0, workers = 0;
  for (const r of rows) {
    const share = shareOf.get(r.id) || 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // canonical lock order: the character row first (serializes vs withCharacter), then the account
      const ch = (await client.query('SELECT id, account_id, respect FROM characters WHERE id=$1 AND alive FOR UPDATE', [r.id])).rows[0];
      if (!ch) { await client.query('ROLLBACK'); continue; }
      const snap = (await client.query('SELECT epoch FROM wage_snapshots WHERE character_id=$1 FOR UPDATE', [r.id])).rows[0];
      const alreadyStamped = snap && Number(snap.epoch) >= epoch;
      if (!alreadyStamped && share > 0) {
        await client.query('SELECT account_id FROM account_persistent WHERE account_id=$1 FOR UPDATE', [ch.account_id]);
        await client.query('UPDATE account_persistent SET omr = omr + $2 WHERE account_id=$1', [ch.account_id, share]);
        await client.query(
          'INSERT INTO transactions (id, character_id, account_id, currency, amount, reason, counterparty) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [crypto.randomUUID(), ch.id, ch.account_id, 'omr', share, 'emission:wage', 'emission']);
        await client.query('INSERT INTO notifications (id, character_id, type, payload) VALUES ($1,$2,$3,$4)',
          [crypto.randomUUID(), ch.id, 'wage_paid', JSON.stringify({ epoch, omr: share })]);
        paid += share; workers++;
      }
      if (!alreadyStamped) {
        if (snap) await client.query('UPDATE wage_snapshots SET epoch=$2, respect=$3 WHERE character_id=$1', [ch.id, epoch, Number(ch.respect)]);
        else await client.query('INSERT INTO wage_snapshots (character_id, epoch, respect) VALUES ($1,$2,$3)', [ch.id, epoch, Number(ch.respect)]);
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); } // poison row skipped, batch continues
    finally { client.release(); }
  }
  return { epoch, budget, payable, paid: floor2(paid), workers, candidates: scored.length };
}

// The public board — the whole schedule is transparent (the design's point: everyone can verify
// the printer). Shows the epoch, the live budget, endowment spent/remaining, your enrollment +
// progress toward today's wage, and the eligibility gates.
export async function wageBoard(pool, ch, acct) {
  const epoch = emissionEpochOf();
  const emitted = await emittedTotal(pool);
  const snap = (await pool.query('SELECT epoch, respect FROM wage_snapshots WHERE character_id=$1', [ch.id])).rows[0];
  const gain = snap ? Math.max(0, Number(ch.respect) - Number(snap.respect)) : 0;
  const lastWage = (await pool.query(
    "SELECT amount, at FROM transactions WHERE account_id=$1 AND reason='emission:wage' ORDER BY at DESC LIMIT 1",
    [ch.account_id])).rows[0];
  return {
    epoch,
    budget: epochBudget(epoch),
    endowment: { total: EMISSION.ENDOWMENT_OMR, emitted, remaining: Math.max(0, EMISSION.ENDOWMENT_OMR - emitted) },
    schedule: { epochOmr: EMISSION.EPOCH_OMR, decay: EMISSION.DECAY, decayEvery: EMISSION.DECAY_EVERY },
    you: {
      enrolled: !!snap,
      baselineEpoch: snap ? Number(snap.epoch) : null,
      gainThisEpoch: gain,
      minScore: EMISSION.WAGE_MIN_SCORE,
      minLevel: EMISSION.WAGE_MIN_LVL,
      capOmr: EMISSION.WAGE_CAP_OMR,
      mintedRequired: wageRequireMinted(),
      minted: !!acct?.minted,
      eligible: !!snap && !acct?.agent_flag && (!wageRequireMinted() || !!acct?.minted)
        && levelOf(Number(ch.respect)) >= EMISSION.WAGE_MIN_LVL && gain >= EMISSION.WAGE_MIN_SCORE,
      agentExcluded: !!acct?.agent_flag,
      lastWage: lastWage ? { omr: Number(lastWage.amount), at: lastWage.at } : null,
    },
  };
}

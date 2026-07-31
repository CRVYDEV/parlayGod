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

// ── ONE eligibility predicate, read by BOTH the payer and the board ──
// The vig-anchor rule: a surface that TELLS a player they qualify must be derived from the same
// thing that DECIDES whether they get paid. These drifted — the board said `enrolled: !!snap`
// (any snapshot at all) while the payer requires the snapshot be stamped EXACTLY `epoch-1`. The
// gap is not hypothetical: `runWageEpoch` re-stamps every living character each run, so a stale
// baseline means the worker MISSED a day — an outage — and on the next run the board told the
// ENTIRE base "on the payroll" while the epoch correctly re-enrolled them and paid nothing. On
// the one faucet that pays real value, with no explanation on screen.
//
// The payer's rule is the correct one and is load-bearing: scoring a stale baseline would pay for
// days of play outside this epoch's window, and since a share is `payable × gain/total`, banking
// gain across skipped days would buy a bigger slice of one day's budget at everyone else's
// expense. So the board moved to the payer, not the other way round.
//
// `reason` is why NOT (null when eligible) so the console can say it instead of going quiet.
export function wageEligibility(r, epoch) {
  const snapEpoch = r.snap_epoch == null ? null : Number(r.snap_epoch);
  const gain = snapEpoch == null ? 0 : Math.max(0, Number(r.respect) - Number(r.snap_respect));
  const out = (reason) => ({ eligible: !reason, reason: reason || null, gain, snapEpoch });
  if (snapEpoch == null) return out('enrolling');            // fresh street / heir — earns from the next epoch
  if (snapEpoch !== epoch - 1) return out('re_enrolling');   // baseline is not yesterday's (a missed epoch)
  if (r.agent_flag) return out('agent');
  if (r.npc_flag) return out('resident');                    // a resident drawing the wage is theft from the endowment
  if (r.status === 'banned') return out('banned');
  if (wageRequireMinted() && !r.minted) return out('mint');  // the D1 Sybil wall
  if (levelOf(Number(r.respect)) < EMISSION.WAGE_MIN_LVL) return out('level');
  if (gain < EMISSION.WAGE_MIN_SCORE) return out('score');
  return out(null);
}

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
           a.agent_flag, a.npc_flag, a.minted, acc.status
      FROM characters c
      JOIN account_persistent a ON a.account_id = c.account_id
      JOIN accounts acc ON acc.id = c.account_id
      LEFT JOIN wage_snapshots s ON s.character_id = c.id
     WHERE c.alive ORDER BY c.id`)).rows;

  // score the candidates (baseline = last epoch's stamp; everyone else just [re-]enrolls).
  // THE POPULATION exclusion lives in `wageEligibility` and is the single most important NPC
  // exclusion in the codebase: a resident drawing the Street Wage would be theft from the
  // endowment. (Residents are never `minted`, so the D1 wall already stops them whenever
  // WAGE_REQUIRE_MINTED is on; the explicit npc_flag check holds when it isn't.)
  const scored = [];
  for (const r of rows) {
    const { eligible, gain } = wageEligibility(r, epoch);
    if (eligible) scored.push({ id: r.id, account: r.account_id, gain });
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
  // the SAME predicate the payer scores with — see wageEligibility. Shaped like a payer row.
  const { eligible, reason, gain } = wageEligibility({
    respect: ch.respect, snap_epoch: snap ? snap.epoch : null, snap_respect: snap ? snap.respect : null,
    agent_flag: !!acct?.agent_flag, npc_flag: !!acct?.npc_flag, minted: !!acct?.minted, status: acct?.status,
  }, epoch);
  const lastWage = (await pool.query(
    "SELECT amount, at FROM transactions WHERE account_id=$1 AND reason='emission:wage' ORDER BY at DESC LIMIT 1",
    [ch.account_id])).rows[0];
  return {
    epoch,
    budget: epochBudget(epoch),
    endowment: { total: EMISSION.ENDOWMENT_OMR, emitted, remaining: Math.max(0, EMISSION.ENDOWMENT_OMR - emitted) },
    schedule: { epochOmr: EMISSION.EPOCH_OMR, decay: EMISSION.DECAY, decayEvery: EMISSION.DECAY_EVERY },
    you: {
      // `enrolled` means enrolled FOR THIS EPOCH — a baseline stamped yesterday, which is exactly
      // what the payer scores on. A stale stamp (the worker missed a day) re-enrols you today and
      // pays from the next epoch; saying "enrolled" for it would be the board promising a wage the
      // payer will not hand over.
      enrolled: !!snap && Number(snap.epoch) === epoch - 1,
      baselineEpoch: snap ? Number(snap.epoch) : null,
      gainThisEpoch: gain,
      minScore: EMISSION.WAGE_MIN_SCORE,
      minLevel: EMISSION.WAGE_MIN_LVL,
      capOmr: EMISSION.WAGE_CAP_OMR,
      mintedRequired: wageRequireMinted(),
      minted: !!acct?.minted,
      eligible,
      reason,          // why not (null when eligible) — so the console can say it
      agentExcluded: !!acct?.agent_flag,
      lastWage: lastWage ? { omr: Number(lastWage.amount), at: lastWage.at } : null,
    },
  };
}

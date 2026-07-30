// THE RIVALS LEDGER — who has shown you malice (omerta-street-rivals-design.md §3).
// Pure intel over events the victim already WITNESSED: zero §10.4 surface (nothing here moves
// value), and the info-economy rule is load-bearing — recordRival is called ONLY from acts whose
// existing notify already NAMES the aggressor to the victim (jump, shakedown, rob, car theft,
// hostile takeover, a fire-kill). It must never reveal what the game hides: anonymous contracts,
// NPC-hit payers and wiretaps stay hidden; the $OMR peek/trace stay the only piercers.
//
// ACCOUNT-keyed on BOTH sides (the vendetta/dm_blocks posture): malice follows the bloodline —
// your heir remembers who robbed you, and the aggressor's heir carries the name. No character_id
// column, so the estate wipe never touches it by construction; the CURRENT living street on each
// side is resolved at read (the feud-ledger pattern).
import { randomUUID as uid } from 'node:crypto';
import { RIVALS, levelOf } from './rules.js';

// Best-effort by design (the logCollect discipline VERBATIM, including its pg-mem lesson): a failed
// intel write must never roll back the landed action it rides in. In real Postgres that needs a
// SAVEPOINT (an errored statement aborts the ENCLOSING txn — 25P02); pg-mem can't parse SAVEPOINT
// at all, so a naive savepoint-first version silently recorded NOTHING under the whole suite —
// there the bare insert runs instead (safe: pg-mem doesn't poison a txn on a failed statement).
let savepointsWork = null; // null = unprobed
export async function recordRival(client, victimAccountId, aggressorCh, kind, detail = {}) {
  if (!victimAccountId || !aggressorCh || victimAccountId === aggressorCh.account_id) return;
  const insert = () => client.query(
    'INSERT INTO rival_events (id, victim_account, aggressor_account, kind, detail) VALUES ($1,$2,$3,$4,$5)',
    [uid(), victimAccountId, aggressorCh.account_id, kind, JSON.stringify(detail)]);
  try {
    if (savepointsWork === null) {
      try { await client.query('SAVEPOINT rival_probe'); await client.query('RELEASE SAVEPOINT rival_probe'); savepointsWork = true; }
      catch { savepointsWork = false; }
    }
    if (!savepointsWork) { await insert(); return; }
    await client.query('SAVEPOINT rival_ev');
    try { await insert(); await client.query('RELEASE SAVEPOINT rival_ev'); }
    catch { await client.query('ROLLBACK TO SAVEPOINT rival_ev').catch(() => {}); }
  } catch { /* the grudge ledger never blocks the grudge */ }
}

// The board: aggregated per aggressor BLOODLINE — counts by kind, last incident, and their current
// living street for revenge targeting (through the EXISTING rails: contracts, searches, duels —
// step one adds no revenge teeth, only the memory). Two flat queries + a JS aggregate (the
// /v1/gangs pg-mem posture — no correlated subqueries).
export async function rivalsBoard(pool, accountId) {
  const rows = (await pool.query(
    'SELECT aggressor_account, kind, at FROM rival_events WHERE victim_account=$1 ORDER BY at DESC LIMIT 500',
    [accountId])).rows;
  const byAgg = new Map();
  for (const r of rows) {
    let a = byAgg.get(r.aggressor_account);
    if (!a) { a = { account: r.aggressor_account, total: 0, kinds: {}, lastAt: r.at }; byAgg.set(r.aggressor_account, a); }
    a.total += 1;
    a.kinds[r.kind] = (a.kinds[r.kind] || 0) + 1;
    if (new Date(r.at) > new Date(a.lastAt)) a.lastAt = r.at;
  }
  // JOIN through rival_events rather than ANY($1)-of-array — pg-mem returns ZERO rows for
  // `= ANY($1::uuid[])` (the MY PROFILE lesson); the duplicate rows (one per event) dedup in JS.
  const streets = byAgg.size ? (await pool.query(
    `SELECT c.account_id, c.id, c.name, c.respect, c.loc FROM characters c
       JOIN rival_events e ON e.aggressor_account = c.account_id
      WHERE c.alive AND e.victim_account = $1`, [accountId])).rows : [];
  const liveBy = new Map();
  for (const s of streets) if (!liveBy.has(s.account_id)) liveBy.set(s.account_id, s);
  const rivals = [...byAgg.values()]
    .sort((a, b) => b.total - a.total || new Date(b.lastAt) - new Date(a.lastAt))
    .map((a) => {
      const live = liveBy.get(a.account);
      return {
        total: a.total, kinds: a.kinds, lastAt: a.lastAt,
        // the bloodline's CURRENT face — null when the line has no living street (the ledger keeps
        // the grudge; the name returns with the heir). Account UUIDs are NEVER exposed (the
        // closeSocketsOnKill discipline) — the client keys revenge on the living characterId.
        street: live ? { id: live.id, name: live.name, level: levelOf(Number(live.respect)), loc: live.loc } : null,
      };
    });
  return { rivals, retentionDays: RIVALS.RETENTION_D };
}

// Row hygiene — the ledger's memory is RETENTION_D days (grudges older than a season fade).
export async function sweepRivals(pool) {
  const r = await pool.query(`DELETE FROM rival_events WHERE at < now() - interval '${Number(RIVALS.RETENTION_D)} days'`);
  return { swept: r.rowCount || 0 };
}

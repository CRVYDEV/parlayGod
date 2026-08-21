// Is the database reachable, and does anything SAY SO when it isn't?
//
// WHY THIS EXISTS. On 2026-07-25 the founder reported "omerta-db is down and I don't know" — and the
// not-knowing was the real problem. Postgres was in fact up; WAL archiving was failing. But nothing in
// the stack could tell those apart, because every database problem surfaced identically: a 500 with the
// body `{"error":"internal"}`. That is what a NullPointerException looks like too. So an outage read as
// a code bug, a code bug read as an outage, and the only way to find out was to go digging in logs.
//
// Three things follow from that, and this module is the shared piece under all three:
//   1. an unreachable database is a 503 `db_down`, never a 500 `internal` — "come back later", not
//      "we're broken". The client says so in plain English instead of "Internal".
//   2. GET /health answers the question directly, for a human or an uptime monitor.
//   3. the worker stops re-trying ~60 jobs against a dead socket every hour and burying the real
//      signal under a wall of identical stack traces.
//
// The classifier is deliberately CONSERVATIVE. Mistaking a genuine bug for an outage would hide the bug
// behind a reassuring "try again shortly" and stop it ever being fixed, so anything not clearly a
// connectivity failure stays a 500. Errors are matched on SQLSTATE and errno — structured fields the
// driver sets — before falling back to message text.

// Postgres class 08 is "Connection Exception" in full; class 57 admin-shutdown/cannot-connect-now are
// the ones a restarting server sends on the way down. 53300 is "too many connections" — the database
// is up but has no room for us, which from a caller's seat is the same "retry shortly".
const PG_CODES = new Set([
  '08000', '08001', '08003', '08004', '08006', '08007', '08P01', // connection exception
  '57P01', '57P02', '57P03',                                     // admin shutdown / crash shutdown / cannot connect now
  '53300',                                                       // too many connections
]);
// EAI_AGAIN/EAI_FAIL are TRANSIENT DNS resolution failures — exactly the failure text from the recorded
// 2026-07-30 production incident ("Temporary failure in name resolution"). Without them (and without the
// `getaddrinfo` syscall below) a DNS-flavored outage to the DB host answered 500 `internal` instead of
// 503 `db_down`, defeating the whole outage-legibility split for that one flavor of outage.
const ERRNOS = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
  'EAI_AGAIN', 'EAI_FAIL']);
// node-pg raises several of these as a plain Error with no code at all, so text is the only signal left.
const MESSAGES = [
  /connection terminated/i,          // pool client died mid-query, or during connect
  /connection ended unexpectedly/i,
  /timeout exceeded when trying to connect/i,
  /client has encountered a connection error/i,
  /terminating connection due to administrator command/i,
  /the database system is (starting up|shutting down|in recovery)/i,
  /server closed the connection unexpectedly/i,
  /could not connect to server/i,
];

/** True only when this error means "the database is not reachable right now" — never for a real bug. */
export function isDbDown(err) {
  if (!err) return false;
  const code = err.code ?? err.original?.code;
  if (typeof code === 'string' && (PG_CODES.has(code) || ERRNOS.has(code))) return true;
  // A FAILED CONNECT, whatever the errno. Node stamps `syscall:'connect'` on every connection attempt
  // that fails, which catches cases the errno list alone misses — a stopped Postgres on a unix socket
  // raises ENOENT (the socket file is simply gone), and ENOENT on its own is far too broad to trust
  // (a missing template file is not an outage). Pairing it with the syscall keeps this precise.
  // DNS errors carry syscall 'getaddrinfo', NOT 'connect' — a name that cannot resolve right now is
  // the same "the database is not reachable" from a caller's seat, and here the syscall is inherently
  // narrow (only name resolution stamps it), so no ENOENT-style breadth concern applies.
  if (err.syscall === 'connect' || err.syscall === 'getaddrinfo') return true;
  // an aggregate connect failure (multiple addresses tried) buries the errno one level down
  if (Array.isArray(err.errors) && err.errors.some((e) => ERRNOS.has(e?.code) || e?.syscall === 'connect' || e?.syscall === 'getaddrinfo')) return true;
  const msg = String(err.message || '');
  return MESSAGES.some((re) => re.test(msg));
}

/**
 * IS THE BACKUP CHAIN ALIVE? — the question nobody could answer on 2026-07-25.
 *
 * Postgres continuously ships write-ahead-log segments to the backup service. If that stops, the
 * database keeps serving perfectly and point-in-time recovery quietly rots: everything looks healthy
 * while your ability to restore does not exist. That failed TWICE in one day here (segments `A8` and
 * `FD`, ~11 and ~7 minutes), and the only evidence was buried in the hosting provider's log stream.
 *
 * `pg_stat_archiver` is the database's own account of it, readable over an ordinary connection —
 * so the game can watch its own backups instead of a human remembering to go and look.
 *
 * The verdict is deliberately five-state, not a boolean:
 *   ok       — the last thing that happened was a successful ship
 *   failing  — the last thing that happened was a FAILURE (more recent than the last success)
 *   stale    — no failures, but nothing has shipped in a long time either. On an idle database that
 *              is perfectly normal (no writes → no segments), so it is a note, never an alarm.
 *   off      — archiving is DISABLED. There is no chain to break because there is no chain. Caught
 *              by a probe against a database with `archive_mode=off`, which the first cut of this
 *              function cheerfully reported as "ok" — a zero failure count reads as healthy right up
 *              until you need a backup. Reporting "fine" for "not configured" is the exact false
 *              reassurance this whole module exists to kill, so archive_mode is read explicitly.
 *   unsupported — pg-mem, or a role that cannot read the view. Not knowing is not the same as broken.
 */
export async function archiverHealth(pool, { staleAfterMs = 6 * 3600 * 1000 } = {}) {
  let r;
  try {
    r = await pool.query(`SELECT archived_count, last_archived_wal, last_archived_time,
                                 failed_count, last_failed_wal, last_failed_time,
                                 current_setting('archive_mode') AS archive_mode
                          FROM pg_stat_archiver`);
  } catch (e) {
    // pg-mem has no pg_stat_archiver, and a locked-down managed role may not expose it. Neither is
    // a backup problem, so neither may be reported as one.
    return { state: 'unsupported', reason: String(e.message || e).slice(0, 120) };
  }
  const s = r.rows[0];
  if (!s) return { state: 'unsupported', reason: 'pg_stat_archiver returned no row' };
  const at = s.last_archived_time ? new Date(s.last_archived_time).getTime() : null;
  const ft = s.last_failed_time ? new Date(s.last_failed_time).getTime() : null;
  const now = Date.now();
  // A failure only counts as CURRENT if it is more recent than the last success. Postgres retries the
  // same segment until it lands, so a healed outage leaves its failure timestamps sitting in this view
  // forever — reading `last_failed_time` alone would alarm about an incident that is long over.
  const failing = ft != null && (at == null || ft > at);
  // `archive_mode` is only absent when the caller handed us a stub row (the unit tests) — a real
  // Postgres always reports it, so treating "not stated" as on keeps the tests honest about the
  // failing/healed logic they exist to pin without asserting on a setting they never set.
  const off = s.archive_mode !== undefined && s.archive_mode !== 'on' && s.archive_mode !== 'always';
  const state = off ? 'off'
    : failing ? 'failing'
      : (at != null && now - at > staleAfterMs ? 'stale' : 'ok');
  return {
    state,
    archiveMode: s.archive_mode ?? null,
    archivedCount: Number(s.archived_count || 0),
    failedCount: Number(s.failed_count || 0),
    lastArchivedWal: s.last_archived_wal || null,
    lastArchivedAt: s.last_archived_time || null,
    lastFailedWal: s.last_failed_wal || null,
    lastFailedAt: s.last_failed_time || null,
    secondsSinceArchived: at == null ? null : Math.round((now - at) / 1000),
    secondsSinceFailed: ft == null ? null : Math.round((now - ft) / 1000),
  };
}

/**
 * Can we actually round-trip a query right now? Answers in bounded time: a pool with no free
 * connections (or a host that black-holes packets) would otherwise hang the health check itself,
 * which is exactly the failure mode a health check exists to report.
 */
export async function pingDb(pool, timeoutMs = 2000) {
  const started = Date.now();
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout exceeded when trying to connect'), { code: 'ETIMEDOUT' })), timeoutMs)),
    ]);
    return { ok: true, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, down: isDbDown(e), error: String(e.message || e).slice(0, 200) };
  }
}

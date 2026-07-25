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
const ERRNOS = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE']);
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
  if (err.syscall === 'connect') return true;
  // an aggregate connect failure (multiple addresses tried) buries the errno one level down
  if (Array.isArray(err.errors) && err.errors.some((e) => ERRNOS.has(e?.code) || e?.syscall === 'connect')) return true;
  const msg = String(err.message || '');
  return MESSAGES.some((re) => re.test(msg));
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

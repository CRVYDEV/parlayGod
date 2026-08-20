// THE BOARD AGGREGATOR — the shared core behind every screen that folds its reads into one.
//
// WHY A SHARED CORE RATHER THAN A COPY. The isolation logic below is twenty subtle lines, and the
// subtlety is all in the failure paths — which is exactly the shape this project has been bitten by:
// `sackEmpire` copied a column list instead of calling the helper and the rake cursor drifted; three
// gate predicates ended up with sixty-nine private copies because writing the comparison locally was
// the reasonable thing to do at each site. A second aggregate reproducing this by hand would agree
// with the first today and diverge on the first fix that reaches only one of them.
//
// WHY IT EXISTS AT ALL. `tools/pollcost.js` measures what one IDLE player costs, because the server
// ceiling is in requests and the player ceiling is that divided by the per-player cost. A screen that
// fans out to N board GETs pays N times: N connection acquisitions, N transactions and N reads of the
// same character row — and on the locked path each takes that row FOR UPDATE, so a client firing them
// in a `Promise.all` has them QUEUE ON EACH OTHER'S LOCK. One read does the work of all of them.
//
// EVERY ROUTE FOLDED IN HERE STAYS MOUNTED. Agents poll them (AGENTS.md), the client wiring guard
// fetches them one at a time, `/v1/screens` beacons them. An aggregate is a second door onto the same
// rooms, never a replacement for the doors that exist.
//
// WHAT CANNOT RIDE ALONG. `readCharacter` prefers a no-BEGIN path whose client REFUSES writes
// (game.js `readOnlyClient`), so a board that WRITES — one that materialises a row the first time you
// look at it — cannot be in a map. That is a constraint rather than a compromise, and it is also the
// PROOF for the boards that are: the read path answering at all is what shows none of them is quietly
// changing something. A writing board keeps its own fetch.
//
// SEQUENTIAL, NOT PARALLEL. These share ONE pooled connection and node-pg cannot run two queries at
// once on it (test/gates.js THE CONNECTION-SHARING LEDGER: it queues them behind a deprecation today
// and THROWS from pg@9). Handing each board its own connection is the other wrong answer — it would
// read outside the request's transaction, and N connections per request is the pool-exhaustion shape
// this project has been bitten by twice. Sequential is correct AND identical in speed.

// A board map is `[key, route, call]` triples. The route is not decoration: the client mirror resolves
// a read off `<aggregate>.<key>` against `<key>`'s own route, so the map is the CONTRACT between the
// two — a key here whose route answers a different shape is exactly the drift the mirror exists to
// catch, and each suite's contract block asserts value-for-value equality against it.
export async function runBoards(boards, ch, client, h, ctx = {}) {
  const out = { boards: boards.length, failed: [] };
  // PER-BOARD ISOLATION. Today a board that throws 500s its own request and the other cards still
  // render; consolidating without isolation would make one broken board blank the whole screen, which
  // is a resilience REGRESSION on screens that can least afford one. The two paths need different
  // mechanics: `readCharacter`'s fast path has no BEGIN, so a failed statement kills only itself and a
  // plain catch is enough — but the LOCKED fallback (taken whenever accrual moved, i.e. most first
  // renders) runs in a transaction, where a failed statement aborts the WHOLE transaction (25P02) and
  // every board after it. Hence a savepoint there.
  // The savepoint is ATTEMPTED per call and never assumed: pg-mem cannot parse one at all, and a
  // module-wide cache of "do savepoints work here" is the bug AUDIT-street-life fixed in
  // `recordContact` — whichever context ran first decided it for every later caller. Taking it
  // outside the try is the same mistake one level up: the probe itself throws under pg-mem, and a
  // throw there escapes the isolation it exists to provide (measured — it 500'd the whole board).
  const txn = !h.readOnly;
  for (const [key, route, call] of boards) {
    let sp = false;
    if (txn) { try { await client.query('SAVEPOINT board_agg'); sp = true; } catch { /* pg-mem: no savepoints */ } }
    try {
      out[key] = await call(ch, client, h, ctx);
      if (sp) await client.query('RELEASE SAVEPOINT board_agg');
    } catch (e) {
      if (sp) { try { await client.query('ROLLBACK TO SAVEPOINT board_agg'); } catch { /* the txn is already gone */ } }
      // COUNTED, never silently nothing: a missing board renders an empty card either way, and the
      // list is what tells a human which one — and that `/v1/<key>` is the route to go and read.
      out[key] = null;
      out.failed.push(key);
      console.error(`board ${key} (${route}) failed (non-fatal)`, e?.code || e);
    }
  }
  return out;
}

// ═══ THE FIRSTS (omerta-scarcity-design.md §1) ═══
// One per server, forever. The first ACCOUNT in the city's life to complete a collection category,
// take a trade to mastery 50, earn a grandmastery, or dig a master casket holds that FIRST — and
// nobody can hold it again, however well they play afterwards. Everyone else can still finish
// everything; only the FIRST is gone.
//
// Why this module exists at all: the luxury layer already had plenty to DO and nothing scarce to
// WIN. Two players can hold the same complete collection. This re-prices content that already
// ships from "a thing to finish" into "a race that ends", at the cost of one table.
//
// PURE STATUS — no currency, no reason, no ledger row (test-pinned by counting), no gameplay power.
// Account-keyed → SURVIVES DEATH by construction (no character_id, so the estate wipe and the
// death-disposition guard never see it — the deed/dynasty/vouch posture).
//
// This module is a LEAF: it imports rules.js and nothing else, so any acquisition touchpoint can
// call it without a cycle (the collection.js discipline — the callers import us, never the reverse).
import { firstsCatalog, firstOf } from './rules.js';

// best-effort, exactly like logCollect and for the same reason: a trophy must NEVER fail the
// action that earned it. In real Postgres a bare try/catch can't deliver that — an errored
// statement (here: the 23505 two claimants race into) aborts the ENCLOSING transaction — so the
// insert runs under a SAVEPOINT. pg-mem can't parse SAVEPOINT and doesn't poison a txn on a failed
// statement, so the bare insert is safe there.
//
// The probe is PER CALL and never cached module-wide (AUDIT-street-life F2, red-team F3): real
// Postgres refuses SAVEPOINT in autocommit, so a cache set by whichever context called first makes
// every later call in the OTHER context take the wrong branch — and the direction that costs you is
// a cached `false` silently dropping every claim forever, invisible to pg-mem, which cannot parse
// either branch.
async function savepointsWork(client) {
  try { await client.query('SAVEPOINT firsts_probe'); await client.query('RELEASE SAVEPOINT firsts_probe'); return true; }
  catch { return false; }
}

// THE ANNOUNCER is injected (the push.js `__setDeliver` / bonds.js `__setLpReader` seam) rather
// than imported: a first is announced to the winner AND to the city, and both live in game.js —
// which imports collection.js, which imports us. Importing back would close the cycle this module
// exists outside of. game.js injects at boot; until it does, a claim is silent but still binding.
let announcer = null;
export function __setAnnouncer(fn) { announcer = fn; }
async function announce(client, entry, accountId) {
  if (!announcer) return;
  try { await announcer(client, entry, accountId); } catch { /* the trophy stands even if the news doesn't */ }
}

// THE LATCH is the PK on first_id: one row per first, ever. Deliberately SELECT-then-INSERT rather
// than `ON CONFLICT DO NOTHING RETURNING` — pg-mem LIES about that shape (it reports rowCount 1 and
// returns a row even when nothing was written; the recordReckoning lesson), which would hand a
// second claimant the same trophy in every test we write. Under real Postgres two concurrent
// claimants both see nothing and both INSERT; the loser takes 23505 and gets null, which is the
// correct answer — somebody else was first.
//
// The SELECT is a fast path, NOT the latch — verified by mutation: deleting it leaves the suite
// green, because the PK still refuses the second write. Only "simplifying" the insert to
// `ON CONFLICT DO NOTHING` (which pg-mem reports as a success) hands a second claimant the trophy.
export async function claimFirst(client, accountId, firstId, meta = {}) {
  if (!accountId || !firstId) return null;
  const entry = firstOf(firstId);
  if (!entry) return null;                       // an unknown id is never a trophy
  try {
    const sp = await savepointsWork(client);
    const taken = (await client.query('SELECT 1 FROM firsts WHERE first_id=$1', [firstId])).rows[0];
    if (taken) return null;
    const ins = () => client.query(
      'INSERT INTO firsts (first_id, account_id, holder_name) VALUES ($1,$2,$3)',
      [firstId, accountId, meta.name || null]);
    if (!sp) { await ins(); }
    else {
      await client.query('SAVEPOINT firsts_claim');
      try { await ins(); await client.query('RELEASE SAVEPOINT firsts_claim'); }
      catch { await client.query('ROLLBACK TO SAVEPOINT firsts_claim').catch(() => {}); return null; }
    }
    const won = { id: firstId, ...entry };
    await announce(client, won, accountId);
    return won;
  } catch { return null; /* the ledger of firsts never blocks the achievement */ }
}

// has a first already gone? A cheap PK read the hooks use to skip the (dearer) completion check.
export async function firstTaken(client, firstId) {
  try { return !!(await client.query('SELECT 1 FROM firsts WHERE first_id=$1', [firstId])).rows[0]; }
  catch { return true; } // fail CLOSED: if we can't tell, don't claim
}

// THE BOARD — every first in the city: who took it, when, and which are still open. The open ones
// are the point (a race nobody has won yet is the only kind worth entering), so they are listed
// too, and `mine` marks the ones this bloodline holds.
export async function firstsBoard(client, accountId) {
  const cat = firstsCatalog();
  const rows = (await client.query(
    'SELECT first_id, account_id, holder_name, claimed_at FROM firsts')).rows;
  const by = Object.fromEntries(rows.map((r) => [r.first_id, r]));
  // the holder's CURRENT living street (a first outlives the man who won it — show who carries it now)
  // ONE query, not one per holder: this is a board, and a board sits on a polled screen — the
  // client's tick re-renders whatever is open, so a per-row lookup here runs (holders × players)
  // times a minute forever (red-team F5). A parameterized IN list rather than `= ANY($1::text[])`,
  // which pg-mem returns zero rows for (the MY PROFILE lesson).
  const stewards = {};
  const holders = [...new Set(rows.map((r) => r.account_id))];
  if (holders.length) {
    const q = await client.query(
      `SELECT account_id, name FROM characters WHERE alive AND account_id IN (${holders.map((_, i) => `$${i + 1}`).join(',')})`,
      holders);
    for (const s of q.rows) stewards[s.account_id] = s.name;
  }
  const firsts = Object.entries(cat).map(([id, c]) => {
    const r = by[id];
    return {
      id, kind: c.kind, name: c.name, blurb: c.blurb,
      taken: !!r,
      holder: r ? (r.holder_name || stewards[r.account_id] || 'a made man') : null,
      steward: r ? stewards[r.account_id] : null,
      claimedAt: r ? r.claimed_at : null,
      mine: !!r && r.account_id === accountId,
    };
  });
  return {
    firsts,
    total: firsts.length,
    taken: firsts.filter((f) => f.taken).length,
    open: firsts.filter((f) => !f.taken).length,
    mine: firsts.filter((f) => f.mine).length,
  };
}

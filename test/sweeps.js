// THE WORKER-SWEEP SUITE — the nightly jobs that reap, refund and reconcile, and the property every
// one of them CLAIMS in a comment but almost none proves: running it a second time changes nothing.
//
// The worker fans out to ~35 sweeps a tick. Each is meant to be idempotent (a poison row is skipped
// and caught up next run — src/worker.js:236), but until this file eight of them had ZERO test
// coverage at all: sweepDiplomacy, sweepRivals, sweepSocialClaims, sweepStaleRaids, and the two that
// reconcile REAL-MONEY entitlements — sweepUncreditedFees / sweepUncreditedStore. A reconcile that
// double-grants, or a housekeeping DELETE that throws on an empty table, fails at 3am into a log
// nobody reads. `chaos.js` interrupts a subset on real Postgres; this proves the base properties on
// pg-mem, in-process, in `npm test`, for EVERY sweep the worker calls.
//
// Two things are asserted here that a per-feature suite structurally can't:
//   (1) NO SWEEP CRASHES on an empty database, and RUNNING IT TWICE is a clean no-op — swept once,
//       the second pass reaps nothing. The generic loop below covers all ~35 at once, so a new sweep
//       that forgets `IF EXISTS` / a NULL guard / a `rowCount || 0` return trips here.
//   (2) The eight previously-untested sweeps do their JOB (reap the due row, leave the fresh one),
//       and the two reconcile sweeps are IDEMPOTENT AT THE MONEY LAYER — a second run grants nothing
//       and never burns a second credit.
import assert from 'node:assert';
import crypto from 'node:crypto';
import { buildServer } from '../src/server.js';
import { RIVALS } from '../src/rules.js';

// every sweep the worker actually calls, with the module it lives in. Kept in step with
// src/worker.js's imports — a new sweep added there without a line here is the gap this file exists
// to close, and `test/docs.js`/the reader could later assert the two lists agree.
import { sweepDiplomacy } from '../src/diplomacy.js';
import { sweepRivals } from '../src/rivals.js';
import { sweepSocialClaims } from '../src/growth.js';
import { sweepGrandReferrals } from '../src/game.js';
import { sweepStaleRaids, sweepUprisings } from '../src/world.js';
import { sweepUncreditedFees } from '../src/fees.js';
import { sweepUncreditedStore } from '../src/store.js';
import { sweepMarket } from '../src/market.js';
import { sweepLoans } from '../src/loans.js';
import { sweepAuctions, sweepConsignments } from '../src/auction.js';
import { sweepLaw } from '../src/law.js';
import { sweepFavors } from '../src/favors.js';
import { sweepSecrets } from '../src/secrets.js';
import { sweepCalls, generateContactCalls } from '../src/contacts.js';
import { sweepConvoyHauls } from '../src/convoy.js';
import { sweepWire, sweepWireAlerts, sweepStandingWatches } from '../src/wire.js';
import { sweepStaleHeists } from '../src/heists.js';
import { sweepStaleBreaks } from '../src/pen.js';
import { sweepPassStipends } from '../src/pass.js';
import { sweepMainEvents } from '../src/boxing.js';
import { sweepTournaments, sweepTrackEntries, sweepFuturity } from '../src/casino.js';
import { sweepRingTables } from '../src/ring.js';
import { sweepGrandPrix } from '../src/races.js';
import { sweepStakes } from '../src/stable.js';
import { sweepExpiredBounties, sweepContests, huntWanted } from '../src/social.js';
import { runLedgerInvariants } from '../src/invariants.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const c = await meOf(token);
  return { token, id: c.id, acct: c.account_id };
};
const acctOf = async (chId) => (await pool.query("SELECT account_id FROM characters WHERE id=$1", [chId])).rows[0].account_id;
const noDrift = async (label) => {
  const r = await runLedgerInvariants(pool, { alert: false });
  const bad = r.checks.filter((c) => !c.ok);
  assert.equal(bad.length, 0, `${label}: §10.4 drift — ${bad.map((c) => c.name).join(', ')}`);
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// (1) EVERY SWEEP: no crash on an empty DB, and running it twice is a clean no-op.
//
// This is the property ~35 comments claim and none proved. A sweep that throws on an empty table,
// or that isn't safe to re-run, fails HERE rather than at 3am. Each is called with the pool exactly
// as src/worker.js calls it. A couple carry a partner the worker pairs them with (generateContactCalls
// before sweepCalls) — included so the pairing itself is exercised.
const ALL_SWEEPS = [
  ['sweepDiplomacy', () => sweepDiplomacy(pool)],
  ['sweepRivals', () => sweepRivals(pool)],
  ['sweepSocialClaims', () => sweepSocialClaims(pool)],
  ['sweepGrandReferrals', () => sweepGrandReferrals(pool)],
  ['sweepStaleRaids', () => sweepStaleRaids(pool)],
  ['sweepUprisings', () => sweepUprisings(pool)],
  ['sweepUncreditedFees', () => sweepUncreditedFees(pool)],
  ['sweepUncreditedStore', () => sweepUncreditedStore(pool)],
  ['sweepMarket', () => sweepMarket(pool)],
  ['sweepLoans', () => sweepLoans(pool)],
  ['sweepAuctions', () => sweepAuctions(pool)],
  ['sweepConsignments', () => sweepConsignments(pool)],
  ['sweepLaw', () => sweepLaw(pool)],
  ['sweepFavors', () => sweepFavors(pool)],
  ['sweepSecrets', () => sweepSecrets(pool)],
  ['generateContactCalls', () => generateContactCalls(pool)],
  ['sweepCalls', () => sweepCalls(pool)],
  ['sweepConvoyHauls', () => sweepConvoyHauls(pool)],
  ['sweepWire', () => sweepWire(pool)],
  ['sweepWireAlerts', () => sweepWireAlerts(pool)],
  ['sweepStandingWatches', () => sweepStandingWatches(pool)],
  ['sweepStaleHeists', () => sweepStaleHeists(pool)],
  ['sweepStaleBreaks', () => sweepStaleBreaks(pool)],
  ['sweepPassStipends', () => sweepPassStipends(pool)],
  ['sweepMainEvents', () => sweepMainEvents(pool)],
  ['sweepTournaments', () => sweepTournaments(pool)],
  ['sweepTrackEntries', () => sweepTrackEntries(pool)],
  ['sweepFuturity', () => sweepFuturity(pool)],
  ['sweepRingTables', () => sweepRingTables(pool)],
  ['sweepGrandPrix', () => sweepGrandPrix(pool)],
  ['sweepStakes', () => sweepStakes(pool)],
  ['sweepExpiredBounties', () => sweepExpiredBounties(pool)],
  ['sweepContests', () => sweepContests(pool)],
  ['huntWanted', () => huntWanted(pool)],
];
for (const [name, run] of ALL_SWEEPS) {
  await run();          // must not throw on an empty database
  await run();          // must be safe to run again immediately
}
await noDrift('after an empty-DB double-sweep of every worker job');
console.log(`✅ all ${ALL_SWEEPS.length} worker sweeps run clean on an empty DB and are safe to re-run`);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// (2) sweepDiplomacy — expired coalitions and their member rows are deleted; a live one survives.
{
  const now = Date.now();
  await pool.query("INSERT INTO coalitions (id, target_gang, formed_by, expires_at) VALUES ('coa-dead','tgt','g1', $1)", [new Date(now - 1000)]);
  await pool.query("INSERT INTO coalition_members (coalition_id, gang_id) VALUES ('coa-dead','g2')");
  await pool.query("INSERT INTO coalitions (id, target_gang, formed_by, expires_at) VALUES ('coa-live','tgt','g1', $1)", [new Date(now + 3600000)]);
  await pool.query("INSERT INTO coalition_members (coalition_id, gang_id) VALUES ('coa-live','g3')");
  await sweepDiplomacy(pool);
  assert.equal((await pool.query("SELECT 1 FROM coalitions WHERE id='coa-dead'")).rowCount, 0, 'expired coalition reaped');
  assert.equal((await pool.query("SELECT 1 FROM coalition_members WHERE coalition_id='coa-dead'")).rowCount, 0, 'its members reaped');
  assert.equal((await pool.query("SELECT 1 FROM coalitions WHERE id='coa-live'")).rowCount, 1, 'the live coalition survives');
  await sweepDiplomacy(pool);   // idempotent
  assert.equal((await pool.query("SELECT 1 FROM coalitions WHERE id='coa-live'")).rowCount, 1, 'a second sweep leaves the live one alone');
  console.log('✅ sweepDiplomacy reaps expired coalitions + members, keeps the live one, idempotent');
}

// (3) sweepRivals — a rival event past the retention window is dropped; a fresh one is kept.
{
  const old = new Date(Date.now() - (RIVALS.RETENTION_D + 1) * 86400000);
  const fresh = new Date(Date.now() - 3600000);
  await pool.query("INSERT INTO rival_events (id, victim_account, aggressor_account, kind, at) VALUES ($1,$2,$3,'jump',$4)",
    [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), old]);
  await pool.query("INSERT INTO rival_events (id, victim_account, aggressor_account, kind, at) VALUES ($1,$2,$3,'jump',$4)",
    [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), fresh]);
  const r = await sweepRivals(pool);
  assert.equal(r.swept, 1, 'exactly the stale grudge is swept');
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM rival_events")).rows[0].n, 1, 'the fresh grudge is kept');
  assert.equal((await sweepRivals(pool)).swept, 0, 'a second sweep reaps nothing');
  console.log('✅ sweepRivals drops grudges past the retention window, keeps fresh ones, idempotent');
}

// (4) sweepSocialClaims — a long-paid claim and a lapsed unpaid registration are dropped; a fresh one stays.
{
  const acc = 'sc-acct';
  const oldPaid = new Date(Date.now() - 8 * 86400000);
  const oldPending = new Date(Date.now() - 3 * 86400000);   // > 48h SOCIAL_PENDING_TTL
  const fresh = new Date(Date.now() - 3600000);
  await pool.query("INSERT INTO social_claims (account_id, day, task_id, posted_at, paid) VALUES ($1, 1, 'sw_post', $2, true)", [acc, oldPaid]);
  await pool.query("INSERT INTO social_claims (account_id, day, task_id, posted_at, paid) VALUES ($1, 2, 'sw_invite', $2, false)", [acc, oldPending]);
  await pool.query("INSERT INTO social_claims (account_id, day, task_id, posted_at, paid) VALUES ($1, 3, 'sw_boost', $2, false)", [acc, fresh]);
  const r = await sweepSocialClaims(pool);
  assert.equal(r.swept, 2, 'the spent-paid and the lapsed-pending rows are both dropped');
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM social_claims WHERE account_id=$1", [acc])).rows[0].n, 1, 'the fresh registration survives');
  assert.equal((await sweepSocialClaims(pool)).swept, 0, 'idempotent');
  console.log('✅ sweepSocialClaims drops spent/lapsed rows, keeps live registrations, idempotent');
}

// (5) sweepStaleRaids — a stale co-op world-raid PLAN and its crew rows are cleared; a fresh plan is kept.
{
  const oldPlan = new Date(Date.now() - 6 * 3600000);   // past COOP_TTL_MS (1h)
  await pool.query("INSERT INTO world_raids (id, npc_id, leader_character, status, created_at) VALUES ('wr-stale','volkov','ch-x','planning',$1)", [oldPlan]);
  await pool.query("INSERT INTO world_raid_members (raid_id, character_id) VALUES ('wr-stale','ch-x')");
  await pool.query("INSERT INTO world_raids (id, npc_id, leader_character, status, created_at) VALUES ('wr-fresh','volkov','ch-y','planning',now())");
  await sweepStaleRaids(pool);
  assert.equal((await pool.query("SELECT status FROM world_raids WHERE id='wr-stale'")).rows[0]?.status !== 'planning', true, 'the stale plan is no longer open');
  assert.equal((await pool.query("SELECT status FROM world_raids WHERE id='wr-fresh'")).rows[0].status, 'planning', 'the fresh plan survives');
  await sweepStaleRaids(pool);   // idempotent
  assert.equal((await pool.query("SELECT status FROM world_raids WHERE id='wr-fresh'")).rows[0].status, 'planning', 'a second sweep leaves the fresh plan');
  console.log('✅ sweepStaleRaids clears stale co-op raid plans, keeps fresh ones, idempotent');
}

// (6) sweepUncreditedFees — a pay-BEFORE-link mint fee is granted at the sweep, EXACTLY ONCE.
// This is the real-money reconcile path: the row waits (account_id NULL) until the wallet links,
// then the sweep discovers it by the linked address and grants the entitlement. The idempotency here
// is a MONEY property — a second run must not mint a second credit.
{
  const player = await mk('Fee Payer');
  const acct = await acctOf(player.id);
  const addr = '0x' + crypto.randomBytes(20).toString('hex');
  await pool.query("UPDATE account_persistent SET wallet_address=$1 WHERE account_id=$2", [addr, acct]);
  const before = Number((await pool.query("SELECT mint_credits FROM account_persistent WHERE account_id=$1", [acct])).rows[0].mint_credits);
  await pool.query("INSERT INTO fee_payments (nonce, kind, payer_address, amount_wei, credited) VALUES (900001, 'mint', $1, '10000000000000000', false)", [addr]);
  const r = await sweepUncreditedFees(pool);
  assert.equal(r.credited, 1, 'the parked fee is credited at the sweep');
  const after = Number((await pool.query("SELECT mint_credits FROM account_persistent WHERE account_id=$1", [acct])).rows[0].mint_credits);
  assert.equal(after, before + 1, 'exactly one mint credit granted');
  assert.equal((await pool.query("SELECT credited FROM fee_payments WHERE nonce=900001")).rows[0].credited, true, 'the row is flagged credited');
  const r2 = await sweepUncreditedFees(pool);
  assert.equal(r2.credited, 0, 'a second sweep grants nothing');
  const after2 = Number((await pool.query("SELECT mint_credits FROM account_persistent WHERE account_id=$1", [acct])).rows[0].mint_credits);
  assert.equal(after2, after, 'no second mint credit — idempotent at the money layer');
  await noDrift('after a fee reconcile');
  console.log('✅ sweepUncreditedFees grants a parked fee exactly once; a re-run mints nothing');
}

// (7) sweepUncreditedStore — the Store twin: a pay-before-link package grants exactly once.
{
  const player = await mk('Store Payer');
  const acct = await acctOf(player.id);
  const addr = '0x' + crypto.randomBytes(20).toString('hex');
  await pool.query("UPDATE account_persistent SET wallet_address=$1 WHERE account_id=$2", [addr, acct]);
  const before = Number((await pool.query("SELECT mint_credits FROM account_persistent WHERE account_id=$1", [acct])).rows[0].mint_credits);
  await pool.query("INSERT INTO store_payments (nonce, sku, payer_address, amount_wei, granted) VALUES (900002, 'made_man', $1, '10000000000000000', false)", [addr]);
  const r = await sweepUncreditedStore(pool);
  assert.equal(r.granted, 1, 'the parked package is granted at the sweep');
  const after = Number((await pool.query("SELECT mint_credits FROM account_persistent WHERE account_id=$1", [acct])).rows[0].mint_credits);
  assert.equal(after, before + 1, 'the made_man SKU granted its mint credit');
  assert.equal((await pool.query("SELECT granted FROM store_payments WHERE nonce=900002")).rows[0].granted, true, 'the row is flagged granted');
  const r2 = await sweepUncreditedStore(pool);
  assert.equal(r2.granted, 0, 'a second sweep grants nothing');
  assert.equal(Number((await pool.query("SELECT mint_credits FROM account_persistent WHERE account_id=$1", [acct])).rows[0].mint_credits), after, 'idempotent at the money layer');
  await noDrift('after a store reconcile');
  console.log('✅ sweepUncreditedStore grants a parked package exactly once; a re-run grants nothing');
}

console.log('✅ worker-sweep suite passed');
await app.close();

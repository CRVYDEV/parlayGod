// WORKER COST — what each background job COSTS, on tables that only ever GROW.
//
// pollcost sizes what an idle PLAYER costs and boardcost sizes what a polled BOARD costs. Neither can
// see the third surface, and it is the one with the sharpest consequence: the worker fans out to 116
// jobs every tick, against tables that accumulate for the life of the server, and nothing has ever
// timed one of them.
//
// A slow board costs one player a slow screen. A slow WORKER costs everything at once and says
// nothing about it: the nightly §10.4 drift monitor, the backup watchdog, the oracle-keeper watchdog,
// every timed settlement (main events, tournaments, contests, the desk's daily auction) and every
// expiry refund all live on the same tick. A worker that falls behind is indistinguishable from a
// quiet night — which is exactly why worker_heartbeat had to be built (BLUE-TEAM C2), and why sizing
// the jobs it runs is worth doing before a real population exists rather than after.
//
// REAL POSTGRES ONLY, for boardcost's reason: pg-mem is a different planner and disagrees about
// exactly this shape (it reported super-linear where Postgres is linear).
//
// WHAT IT MEASURES, and the two honest limits stated up front:
//   • the FIRST run of each job against a fully-seeded table, which is the cost that matters — a
//     retention DELETE run twice measures a drained table the second time, and reporting that would be
//     measuring the wrong thing. The median of the later runs is reported BESIDE it, and the gap
//     between the two is itself the signal: a large one means the job's cost is proportional to the
//     backlog it found, which is the shape that grows.
//   • it seeds the tables that ACCUMULATE (telemetry, chat, DMs, duels, notifications, the ledger,
//     the rng audit). A job that reads further than that is sized against a thin tail, and says so.
//
// NOT IN CI — a measurement, not a gate, for the reason boardcost states: it wants a big seeded
// database, and a threshold would sit either so high it never fires or so low it fires on the flat
// jobs and gets routed around. What it FINDS gets a real guard.
//
// Run:  su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pg -o '-p 5433 -k /tmp' start"
//       DATABASE_URL='postgres://postgres@/wcost?host=/tmp&port=5433' node tools/workercost.js [players]
import fs from 'node:fs';
import { buildServer } from '../src/server.js';
import { runBuyback, mergeLegacyPools, sweepTelemetry, runSeasonRollover } from '../src/worker.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { sweepExpiredBounties, huntWanted, sweepContests } from '../src/social.js';
import { sweepUncreditedFees } from '../src/fees.js';
import { sweepGrandReferrals } from '../src/game.js';
import { sweepSocialClaims, sweepCapoLicense } from '../src/growth.js';
import { sweepUncreditedStore } from '../src/store.js';
import { sweepPassStipends } from '../src/pass.js';
import { sweepStaleHeists } from '../src/heists.js';
import { sweepStaleBreaks } from '../src/pen.js';
import { sweepStaleRaids, sweepUprisings } from '../src/world.js';
import { sweepFamilyAggro, sweepNpcWars, sweepNpcAggression } from '../src/npcwar.js';
import { sweepWire, sweepWireAlerts, sweepStandingWatches } from '../src/wire.js';
import { sweepMarket } from '../src/market.js';
import { sweepDiplomacy, sweepNpcDiplomacy } from '../src/diplomacy.js';
import { settleProposals, sweepTickerBallot } from '../src/commission.js';
import { sweepSecrets } from '../src/secrets.js';
import { sweepRivals } from '../src/rivals.js';
import { generateContactCalls, sweepCalls } from '../src/contacts.js';
import { sweepFavors } from '../src/favors.js';
import { sweepCrewInvites } from '../src/crew.js';
import { sweepMentorOffers } from '../src/mentor.js';
import { settlePrimeTime } from '../src/primetime.js';
import { sweepPush } from '../src/push.js';
import { sweepDispatch } from '../src/dispatch.js';
import { spawnNpcConvoys, despawnArrivedNpc, sweepConvoyHauls } from '../src/convoy.js';
import { runPopulation, runResidentBehaviour } from '../src/population.js';
import { sweepLaw } from '../src/law.js';
import { sweepLoans } from '../src/loans.js';
import { sweepAuctions, sweepConsignments } from '../src/auction.js';
import { sweepMainEvents, enforceBeltDefense } from '../src/boxing.js';
import { sweepTournaments, sweepTrackEntries, sweepFuturity } from '../src/casino.js';
import { stampFairness } from '../src/fairness.js';
import { sweepRingTables } from '../src/ring.js';
import { sweepGrandPrix } from '../src/races.js';
import { sweepStakes } from '../src/stable.js';
import { openAuction, closeExpired, runDeskInvariants } from '../src/desk.js';
import { archiverHealth } from '../src/dbhealth.js';
import { runVigInvariants } from '../src/vig.js';
import { carveExchange, payFamilyYield, runExchangeInvariants } from '../src/exchange.js';
import { runRouterInvariants } from '../src/router.js';
import { runFamilyBuybackInvariants } from '../src/community.js';
import { runBondInvariants } from '../src/bonds.js';
import { runCityLeg, runBankInvariants } from '../src/bank.js';
import { runTreasuryInvariants } from '../src/treasury.js';
import { runDexBotInvariants } from '../src/dexbot.js';
import { reclaimExpiredVouchers, sweepReimports, sweepDeedReimports, sweepDeedVouchers } from '../src/chain.js';

if (!process.env.DATABASE_URL) {
  console.error('workercost needs real Postgres — pg-mem is a different planner and disagrees about\n' +
    'exactly the shape being measured here.');
  process.exit(1);
}
process.env.RATE_LIMIT = 'off';

const PLAYERS = Number(process.argv[2] || 3000);
const app = await buildServer();
const pool = app.pool;

// ── the accumulation ───────────────────────────────────────────────────────────────────────────────
// The population is what every per-player sweep joins over; the LOG tables are the ones that grow
// without a player doing anything special, and they are where a per-tick scan gets expensive. Sized so
// a day's play at PLAYERS scale has already happened: the point is to measure a job against a backlog,
// not against an empty table where every plan looks the same.
process.stdout.write(`seeding ${PLAYERS} players + their logs… `);
const t0 = Date.now();
await pool.query(`INSERT INTO accounts (id, auth_provider, auth_subject)
  SELECT gen_random_uuid(), 'guest', 'wcost-' || g FROM generate_series(1, $1) g`, [PLAYERS]);
await pool.query(`INSERT INTO account_persistent (account_id, kills, prestige) SELECT id, 0, 0
  FROM accounts WHERE auth_subject LIKE 'wcost-%'`);
await pool.query(`INSERT INTO characters (id, account_id, name, respect, cash, loc, season)
  SELECT gen_random_uuid(), id, 'Load ' || substr(id::text, 1, 8), (random()*400000)::int,
         (random()*100000)::numeric, 'docks', 1 FROM accounts WHERE auth_subject LIKE 'wcost-%'`);
// the log tables, at roughly a day of play each. `at` is spread across the retention window on
// purpose: a DELETE that finds nothing measures the SCAN and not the delete, and both halves matter.
const LOGS = [
  ['telemetry', `INSERT INTO telemetry (id, account_id, event, props, at)
     SELECT md5(random()::text || id), id, (ARRAY['crime','deal','travel','death'])[1+(random()*3)::int], '{}',
            now() - (random() * interval '20 days') FROM accounts WHERE auth_subject LIKE 'wcost-%'`, 12],
  ['transactions', `INSERT INTO transactions (id, character_id, currency, amount, reason, at)
     SELECT md5(random()::text || c.id), c.id, 'cash', 100, 'crime:pick', now() - (random() * interval '20 days')
       FROM characters c JOIN accounts a ON a.id = c.account_id WHERE a.auth_subject LIKE 'wcost-%'`, 8],
  ['rng_audit', `INSERT INTO rng_audit (id, character_id, action, roll, outcome, at)
     SELECT md5(random()::text || c.id), c.id, 'crime', random(), 'ok', now() - (random() * interval '20 days')
       FROM characters c JOIN accounts a ON a.id = c.account_id WHERE a.auth_subject LIKE 'wcost-%'`, 8],
  ['notifications', `INSERT INTO notifications (id, character_id, type, payload, created_at)
     SELECT md5(random()::text || c.id), c.id, 'jumped', '{}', now() - (random() * interval '10 days')
       FROM characters c JOIN accounts a ON a.id = c.account_id WHERE a.auth_subject LIKE 'wcost-%'`, 4],
  ['chat_messages', `INSERT INTO chat_messages (id, channel, character_id, name, body, at)
     SELECT md5(random()::text || c.id), 'city', c.id, 'Load', 'talk', now() - (random() * interval '10 days')
       FROM characters c JOIN accounts a ON a.id = c.account_id WHERE a.auth_subject LIKE 'wcost-%'`, 4],
  ['dm_messages', `INSERT INTO dm_messages (id, from_account, to_account, from_name, to_name, body, at)
     SELECT md5(random()::text || id), id::uuid, id::uuid, 'Load', 'Load', 'talk',
            now() - (random() * interval '40 days') FROM accounts WHERE auth_subject LIKE 'wcost-%'`, 2],
  ['duels', `INSERT INTO duels (id, account_a, account_b, winner_account, day, at)
     SELECT md5(random()::text || id), id::uuid, id::uuid, id::uuid, 1,
            now() - (random() * interval '80 days') FROM accounts WHERE auth_subject LIKE 'wcost-%'`, 2],
  ['event_results', `INSERT INTO event_results (id, kind, icon, headline, resolved_at)
     SELECT md5(random()::text || id), 'bout', 'x', 'somebody won', now() - (random() * interval '10 days')
       FROM accounts WHERE auth_subject LIKE 'wcost-%'`, 1],
  ['gala_guests', `INSERT INTO gala_guests (host_account, guest_account, gala_key, guest_name, at)
     SELECT id, md5(random()::text || id), now() - (random() * interval '10 days'), 'Load',
            now() - (random() * interval '10 days') FROM accounts WHERE auth_subject LIKE 'wcost-%'`, 1],
  ['idempotency', `INSERT INTO idempotency (account_id, key, status, body_hash, response, created_at)
     SELECT id, md5(random()::text || id), 1, 'h', '{}', now() - (random() * interval '3 days')
       FROM accounts WHERE auth_subject LIKE 'wcost-%'`, 2],
  ['oauth_states', `INSERT INTO oauth_states (state, verifier, purpose, created_at)
     SELECT md5(random()::text || g), 'v', 'signin', now() - (random() * interval '2 hours')
       FROM generate_series(1, $1) g`, 1],
];
// A seed that failed is FATAL rather than a warning: the job it feeds would then be sized against an
// empty table, and a job with nothing to do reads exactly like a cheap job — which is the whole failure
// this harness exists to avoid reporting.
let seedFailed = 0;
for (const [name, sql, mult] of LOGS) {
  for (let i = 0; i < mult; i++) {
    try { await pool.query(sql, sql.includes('$1') ? [PLAYERS] : []); }
    catch (e) { console.error(`\n  seed ${name} FAILED: ${String(e.message).slice(0, 90)}`); seedFailed++; break; }
  }
}
console.log(`${Date.now() - t0}ms`);
if (seedFailed) { console.error(`\n${seedFailed} log table(s) unseeded — refusing to report a tick sized against empty tables.`); process.exit(1); }
await pool.query('ANALYZE');
const sizes = (await pool.query(`SELECT relname, n_live_tup FROM pg_stat_user_tables
  WHERE n_live_tup > 0 ORDER BY n_live_tup DESC LIMIT 8`)).rows;
console.log('  accumulated: ' + sizes.map((r) => `${r.relname} ${r.n_live_tup}`).join(', '));

// ── the jobs ───────────────────────────────────────────────────────────────────────────────────────
// Eight of the tick's jobs are inline pool.query() DELETEs rather than exported functions, so timing
// them means restating their SQL here — and a restatement rots (preflight's own ledger exists for that
// class). So each one is CROSSED against src/worker.js below: the statement this file times must
// appear verbatim in the tick, or the run fails rather than quietly measuring a query the game no
// longer runs. The cutoffs are restated the same way, and are the reason the seed spreads `at` across
// each window: a DELETE that finds nothing measures the SCAN, which is the half that grows.
const D = 86400000;
const INLINE = [
  ['vendetta prune', 'DELETE FROM vendettas WHERE expires_at <= now()', null],
  ['troll box retention', 'DELETE FROM chat_messages WHERE at < $1', 7 * D],
  ['cellphone retention', 'DELETE FROM dm_messages WHERE at < $1', 30 * D],
  ['results retention', 'DELETE FROM event_results WHERE resolved_at < $1', 7 * D],
  ['duel log retention', 'DELETE FROM duels WHERE at < $1', 60 * D],
  ['gala guest retention', 'DELETE FROM gala_guests WHERE at < $1', 7 * D],
  ['oauth state sweep', 'DELETE FROM oauth_states WHERE created_at < $1', 30 * 60000],
  ['idempotency prune (completed)', "DELETE FROM idempotency WHERE status <> 0 AND created_at < now() - interval '24 hours'", null],
  ['idempotency prune (orphan reservations)', "DELETE FROM idempotency WHERE status = 0 AND created_at < now() - interval '7 days'", null],
];
const workerSrc = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
for (const [label, sql] of INLINE) {
  if (!workerSrc.includes(sql)) {
    console.error(`restatement rotted: '${label}' times a statement the tick no longer runs:\n  ${sql}`);
    process.exit(1);
  }
}

const q = (sql, cutoff) => () => pool.query(sql, cutoff === null ? [] : [new Date(Date.now() - cutoff)]);

const JOBS = [
  ['heartbeat', () => pool.query('UPDATE worker_heartbeat SET beat_at = now() WHERE id = 1')],
  ['fair draw stamp', () => stampFairness(pool)],
  ['buyback', () => runBuyback(pool)],
  ['legacy pools', () => mergeLegacyPools(pool)],
  ['desk auction close', () => closeExpired(pool)],
  ['desk auction', () => openAuction(pool)],
  ['family yield', () => payFamilyYield(pool)],
  ['bounty sweep', () => sweepExpiredBounties(pool)],
  ['fee reconcile', () => sweepUncreditedFees(pool)],
  ['store reconcile', () => sweepUncreditedStore(pool)],
  ['pass stipend sweep', () => sweepPassStipends(pool)],
  ['telemetry retention', () => sweepTelemetry(pool)],
  ['grand-referral reconcile', () => sweepGrandReferrals(pool)],
  ['social claims sweep', () => sweepSocialClaims(pool)],
  ['capo license', () => sweepCapoLicense(pool)],
  ['ticker ballot', () => sweepTickerBallot(pool)],
  ['diplomacy sweep', () => sweepDiplomacy(pool)],
  ['npc diplomacy', () => sweepNpcDiplomacy(pool)],
  ['secrets sweep', () => sweepSecrets(pool)],
  ['rivals sweep', () => sweepRivals(pool)],
  ['contact calls sweep', () => sweepCalls(pool)],
  ['contact calls', () => generateContactCalls(pool)],
  ['turf contest sweep', () => sweepContests(pool)],
  ['favor sweep', () => sweepFavors(pool)],
  ['crew invite sweep', () => sweepCrewInvites(pool)],
  ['mentor offer sweep', () => sweepMentorOffers(pool)],
  ['prime time settle', () => settlePrimeTime(pool)],
  ['web push sweep', () => sweepPush(pool)],
  ['email digest sweep', () => sweepDispatch(pool)],
  ['heist sweep', () => sweepStaleHeists(pool)],
  ['pen break sweep', () => sweepStaleBreaks(pool)],
  ['world raid sweep', () => sweepStaleRaids(pool)],
  ['world uprising sweep', () => sweepUprisings(pool)],
  ['blood war manhunt', () => sweepFamilyAggro(pool)],
  ['family war sweep', () => sweepNpcWars(pool)],
  ['npc offensive', () => sweepNpcAggression(pool)],
  ['market sweep', () => sweepMarket(pool)],
  ['npc convoy despawn', () => despawnArrivedNpc(pool)],
  ['npc convoy spawn', () => spawnNpcConvoys(pool)],
  ['convoy hauls sweep', () => sweepConvoyHauls(pool)],
  ['population', () => runPopulation(pool)],
  ['resident behaviour', () => runResidentBehaviour(pool)],
  ['commission proposals', () => settleProposals(pool)],
  ['auction sweep', () => sweepAuctions(pool)],
  ['consignment sweep', () => sweepConsignments(pool)],
  ['main event sweep', () => sweepMainEvents(pool)],
  ['ring sweep', () => sweepRingTables(pool)],
  ['tournament sweep', () => sweepTournaments(pool)],
  ['track entries sweep', () => sweepTrackEntries(pool)],
  ['futurity sweep', () => sweepFuturity(pool)],
  ['grand prix sweep', () => sweepGrandPrix(pool)],
  ['stakes sweep', () => sweepStakes(pool)],
  ['belt defense', () => enforceBeltDefense(pool)],
  ['wire sweep', () => sweepWire(pool)],
  ['wire alerts', () => sweepWireAlerts(pool)],
  ['wire watches', () => sweepStandingWatches(pool)],
  ['law sweep', () => sweepLaw(pool)],
  ['loan sweep', () => sweepLoans(pool)],
  ['wanted hunt', () => huntWanted(pool)],
  ['voucher reclaim', () => reclaimExpiredVouchers(pool)],
  ['reimport sweep', () => sweepReimports(pool)],
  ['deed reimport sweep', () => sweepDeedReimports(pool)],
  ['deed voucher sweep', () => sweepDeedVouchers(pool)],
  ['archiver health', () => archiverHealth(pool)],
  ['§10.4 invariants', () => runLedgerInvariants(pool, { alert: false })],
  ['vig invariants', () => runVigInvariants(pool)],
  ['bond invariants', () => runBondInvariants(pool)],
  ['treasury invariants', () => runTreasuryInvariants(pool)],
  ['desk invariants', () => runDeskInvariants(pool)],
  ['city leg', () => runCityLeg(pool)],
  ['bank invariants', () => runBankInvariants(pool)],
  ['exchange invariants', () => runExchangeInvariants(pool)],
  ['router invariants', () => runRouterInvariants(pool)],
  ['family buyback invariants', () => runFamilyBuybackInvariants(pool)],
  ['dex bot invariants', () => runDexBotInvariants(pool)],
  ...INLINE.map(([label, sql, cutoff]) => [label, q(sql, cutoff)]),
  // LAST on purpose: a rollover rewrites every character row in the population, so anything timed
  // after it would be sized against a converted fixture. Its first-vs-median gap is the whole point —
  // one pass does the work and the rest find nothing to do.
  ['season rollover', () => runSeasonRollover(pool)],
];

// Catalogue-or-declare: every job the tick runs is timed here, or DECLARED with the property that
// makes it untimeable — never silently absent, because a job missing from the table reads exactly like
// a cheap one.
const DECLARED = new Map([
  ...['desk dark alert', 'archiver alert', 'oracle alert', 'chain parity alert', 'vig alert', 'bond alert',
    'treasury alert', 'desk alert', 'bank alert', 'exchange alert', 'router alert', 'family buyback alert',
    'dex bot alert'].map((l) => [l,
      'fires only when its check already failed, and its cost is an outbound webhook POST — timing it would size the network, not the database']),
  ...['oracle keeper health', 'chain parity', 'fee sync', 'store sync', 'claimed sync', 'bank harvest sync',
    'bond sync', 'gear re-import sync', 'deed extracted sync', 'deed redeemed sync', 'deed transfer sync',
    'stock delivered sync', 'dynasty mint sync', 'dynasty transfer sync', 'stock delivery keeper',
    'lp depth sync', 'dex buyback', 'pol pairing'].map((l) => [l,
      'needs a live chain reader — dormant without CHAIN_RPC_URL, so what it costs is an RPC round trip rather than a query']),
]);

const labels = [...workerSrc.matchAll(/safe\('([^']+)'/g)].map((m) => m[1]);
if (labels.length < 100) { console.error(`read only ${labels.length} worker jobs — the extractor is broken`); process.exit(1); }
const timed = new Set(JOBS.map(([l]) => l));
const missing = labels.filter((l) => !timed.has(l) && !DECLARED.has(l));
const stale = [...timed, ...DECLARED.keys()].filter((l) => !labels.includes(l));
if (missing.length) { console.error(`untimed and undeclared worker jobs:\n  ${missing.join('\n  ')}`); process.exit(1); }
if (stale.length) { console.error(`stale entries — no such worker job:\n  ${stale.join('\n  ')}`); process.exit(1); }
console.log(`  ${labels.length} worker jobs: ${timed.size} timed, ${DECLARED.size} declared untimeable\n`);

// ── the timing ─────────────────────────────────────────────────────────────────────────────────────
// JOB-MAJOR, not pass-major, and that is the measurement rather than a detail: the FIRST run meets the
// backlog and the rest meet whatever it left, so each job's two numbers have to be taken back to back.
const REPS = 5;
const median = (ms) => { const s = [...ms].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const results = [];
for (const [label, fn] of JOBS) {
  const t = process.hrtime.bigint();
  try { await fn(); } catch (e) { results.push({ label, err: String(e.message || e).slice(0, 70) }); continue; }
  const first = Number(process.hrtime.bigint() - t) / 1e6;
  const rest = [];
  for (let i = 0; i < REPS; i++) {
    const t2 = process.hrtime.bigint();
    try { await fn(); } catch { break; }
    rest.push(Number(process.hrtime.bigint() - t2) / 1e6);
  }
  results.push({ label, first, rest: rest.length ? median(rest) : null });
}

results.sort((a, b) => (b.first ?? -1) - (a.first ?? -1));
console.log(`  WORKER COST at ${PLAYERS} players — first run against the backlog, then the median of ${REPS} more\n`);
console.log(`     first    steady   job`);
for (const r of results) {
  if (r.err) { console.log(`         —         —   ${r.label.padEnd(32)} ${r.err}`); continue; }
  const steady = r.rest === null ? '     —  ' : `${r.rest.toFixed(2).padStart(8)}`;
  console.log(`  ${r.first.toFixed(2).padStart(8)}  ${steady}   ${r.label}`);
}
const failed = results.filter((r) => r.err);
const heavy = results.filter((r) => !r.err && r.first >= 25);
const total = results.reduce((n, r) => n + (r.first || 0), 0);
// Deliberately NOT called "the whole tick": the 31 declared jobs are not in it, and the rollover in it
// runs once a season rather than once an hour. Both are named rather than rounded away.
const rollover = results.find((r) => r.label === 'season rollover');
console.log(`\n  the ${results.length - failed.length} TIMED jobs, cold: ${total.toFixed(0)} ms — of which the season`);
console.log(`  rollover is ${(rollover?.first ?? 0).toFixed(0)} ms and runs once a season, not once a tick. The other ${DECLARED.size} jobs are`);
console.log(`  declared untimeable (webhooks and dormant chain syncs) and are NOT in that figure.`);
console.log(`  ${heavy.length} job(s) at 25ms or more on the first pass — the ones whose cost is proportional`);
console.log(`  to a backlog, which is the shape that grows with the life of the server.`);
if (failed.length) console.log(`  ${failed.length} job(s) errored (listed above, never silently dropped).`);
console.log('\n✅ workercost — what each background job costs. A measurement, not a gate.');
await app.close();
process.exit(0);

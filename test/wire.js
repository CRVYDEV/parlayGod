// THE WIRE — the intelligence terminal. Covers: the board (costs, ticker tape, empty state), the
// wiretap sink (self/gone/cap gates, exact intel:wiretap burn), tap INTEL (law stage, wealth band,
// ops counts, the huntingYou money-signal), bugs-on-you + SWEEP (free when clean, charged + clears
// when bugged), the Street Wire subscription (intel:wire burn, the premium feed: forecast + threat
// chatter COUNT + war room), the worker sweep of expired taps, and §10.4 (intel:* rides the omr
// vocabulary; the only drift is the unledgered SQL $OMR grant — proving every wire spend is a burn).
// pg-mem, zero infra. SQL-granting $OMR is an unledgered mint (the estate/portfolio precedent).
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { WIRE } from '../src/rules.js';
import { sweepWire } from '../src/wire.js';
import { runLedgerInvariants } from '../src/invariants.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url,
    headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  return { token, id: (await meOf(token)).id };
};
const acctOmr = (id, n) => pool.query(
  `UPDATE account_persistent SET omr = omr + ${n} WHERE account_id = (SELECT account_id FROM characters WHERE id='${id}')`);
let grantDrift = 0;

const watcher = await mk('Nosy Nick');
const mark = await mk('Fat Tony');
const other = await mk('Two-Face Sal');
await acctOmr(watcher.id, 1000); grantDrift += 1000;

// give the mark a legible footprint: heat, an investigation-worthy exposure, a fat bankroll, a front
await pool.query(`UPDATE characters SET heat=70, heat_exposure=1200, cash=300000, bank=2000000 WHERE id='${mark.id}'`);
await pool.query(`INSERT INTO businesses (id, character_id, kind, tier) VALUES ('bizW','${mark.id}','laundromat',1)`);

// ── the board: empty, costs surfaced, ticker tape present, not subscribed ──
let r = await call('GET', '/v1/wire', { token: watcher.token });
assert.equal(r.code, 200, 'the wire terminal is readable');
assert.equal(r.body.subscribed, false, 'no premium feed yet');
assert.equal(r.body.taps.length, 0, 'no wires running');
assert.equal(r.body.costs.tap, WIRE.TAP_OMR, 'the tap price is quoted');
assert.equal(r.body.tapMax, WIRE.TAP_MAX, 'the concurrent cap is quoted');
assert.equal(r.body.bugsOnYou, 0, 'clean lines');
assert(Array.isArray(r.body.tape) && r.body.tape.length > 0, 'the ticker tape scrolls');
assert(r.body.tape[0].ticker && typeof r.body.tape[0].price === 'number', 'each tape entry has a ticker + price');
assert(!r.body.premium, 'no premium block without a subscription');

// ── the wiretap sink: self + gone gates ──
assert.equal((await call('POST', `/v1/wire/tap/${watcher.id}`, { token: watcher.token })).body.error, 'self', "can't wire yourself");
assert.equal((await call('POST', '/v1/wire/tap/nobody', { token: watcher.token })).body.error, 'gone', 'no such mark');

// ── place a tap: exact intel:wiretap burn ──
const omrBefore = (await meOf(watcher.token)).omr;
r = await call('POST', `/v1/wire/tap/${mark.id}`, { token: watcher.token });
assert.equal(r.code, 200, 'the wire is live');
assert.equal(r.body.spent, WIRE.TAP_OMR, 'the tap cost was quoted');
assert.equal((await meOf(watcher.token)).omr, omrBefore - WIRE.TAP_OMR, 'exactly the tap price burned');

// ── the intel: law stage, wealth band, ops counts ──
r = await call('GET', '/v1/wire', { token: watcher.token });
assert.equal(r.body.taps.length, 1, 'one wire running');
const i = r.body.taps[0];
assert.equal(i.target, mark.id, 'the tap names the mark');
assert.equal(i.law.stage, 'investigation', 'the wire reads their Law stage (exposure 40 ≥ the investigation line)');
assert.equal(i.law.heat, 'hot', 'and rough heat band (70 → hot)');
assert.equal(i.wealth, 'flush', 'and a wealth band (2.3M → flush), never the exact books');
assert.equal(i.ops.businesses, 1, 'their front count');
assert.equal(i.huntingYou, false, "the mark isn't hunting the watcher (yet)");
assert(i.expiresSeconds > 0, 'the wire has a countdown');

// ── the money signal: the mark starts hunting the watcher → the tap flips huntingYou ──
await pool.query(`INSERT INTO searches (hunter, target) VALUES ('${mark.id}','${watcher.id}')`);
r = await call('GET', '/v1/wire', { token: watcher.token });
assert.equal(r.body.taps[0].huntingYou, true, 'the wire catches the mark putting a search on the watcher');

// ── re-tapping an existing mark refreshes (not a new slot) ──
r = await call('POST', `/v1/wire/tap/${mark.id}`, { token: watcher.token });
assert.equal(r.code, 200, 're-tapping the same mark is allowed (refresh)');

// ── the concurrent cap: fill to TAP_MAX with dummy live taps, a new distinct mark is refused ──
for (let n = 0; n < WIRE.TAP_MAX - 1; n++)
  await pool.query(`INSERT INTO wiretaps (watcher_character, target_character, expires_at) VALUES ('${watcher.id}','dummy${n}', now() + interval '1 hour')`);
assert.equal((await call('POST', `/v1/wire/tap/${other.id}`, { token: watcher.token })).body.error, 'capped', `can't run more than ${WIRE.TAP_MAX} wires`);

// ── the defensive side: the mark sees bugs on their line ──
r = await call('GET', '/v1/wire', { token: mark.token });
assert.equal(r.body.bugsOnYou, 1, 'the mark counts the wire on them');

// SWEEP is free when clean (the watcher has no taps on them)
r = await call('POST', '/v1/wire/sweep', { token: watcher.token });
assert.equal(r.code, 200, 'sweeping clean lines is fine');
assert.equal(r.body.clean, true, 'nothing to sweep');
assert.equal(r.body.spent, 0, 'a clean sweep is free (the peek precedent)');

// SWEEP charges + clears when bugged
const markOmrBefore = (await meOf(mark.token)).omr;
await acctOmr(mark.id, 100); grantDrift += 100; // the mark needs $OMR to pay the sweeper
r = await call('POST', '/v1/wire/sweep', { token: mark.token });
assert.equal(r.code, 200, 'the mark sweeps their lines');
assert.equal(r.body.bugsFound, 1, 'found the wire');
assert.equal(r.body.spent, WIRE.SWEEP_OMR, 'the sweep cost was quoted');
assert.equal((await meOf(mark.token)).omr, markOmrBefore + 100 - WIRE.SWEEP_OMR, 'exactly the sweep price burned');
assert.equal((await call('GET', '/v1/wire', { token: mark.token })).body.bugsOnYou, 0, 'the lines are clean again');
// the watcher's tap on the mark is gone (swept)
assert.equal((await call('GET', '/v1/wire', { token: watcher.token })).body.taps.filter((t) => t.target === mark.id).length, 0, 'the swept wire dropped off the watcher terminal');

// ── the Street Wire subscription: intel:wire burn + the premium feed ──
const subOmrBefore = (await meOf(watcher.token)).omr;
r = await call('POST', '/v1/wire/subscribe', { token: watcher.token });
assert.equal(r.code, 200, 'subscribed to the Street Wire');
assert.equal(r.body.spent, WIRE.SUB_OMR, 'the sub cost was quoted');
assert.equal((await meOf(watcher.token)).omr, subOmrBefore - WIRE.SUB_OMR, 'exactly the sub price burned');

// put a search + a contract on the WATCHER so the threat chatter has something to report
await pool.query(`INSERT INTO searches (hunter, target) VALUES ('${other.id}','${watcher.id}')`);
await pool.query(`INSERT INTO bounties (target_character, kind, amount, posted_by) VALUES ('${watcher.id}','kill',50000,'${other.id}')`);
r = await call('GET', '/v1/wire', { token: watcher.token });
assert.equal(r.body.subscribed, true, 'the premium feed is on');
assert(r.body.subSeconds > 0, 'the subscription has a countdown');
assert(r.body.premium, 'the premium block is present');
assert(Array.isArray(r.body.premium.forecast) && r.body.premium.forecast.length > 0, 'the Law forecast is delivered');
assert.equal(r.body.premium.threats.huntersCount, 2, 'threat chatter counts every hunter on the watcher (mark + other — a COUNT, never a name)');
assert.equal(r.body.premium.threats.contracts.length, 1, 'and the open contract on their head');
assert.equal(r.body.premium.threats.contracts[0].pot, 50000, 'with the pot');

// re-subscribing extends from the current end (the retainer precedent)
await acctOmr(watcher.id, 100); grantDrift += 100;
const wireEnd1 = (await meOf(watcher.token)); // just to advance
r = await call('POST', '/v1/wire/subscribe', { token: watcher.token });
assert.equal(r.code, 200, 're-subscribed');
assert(r.body.wireSeconds > WIRE.SUB_MS / 1000, 'the window stacked past a single term');

// ── LOW-1 regression: a DEAD watcher's un-swept tap is NOT a phantom bug the victim pays to clear ──
const ghost = await mk('Ghost Gus');
await acctOmr(ghost.id, 100); grantDrift += 100;
await call('POST', `/v1/wire/tap/${mark.id}`, { token: ghost.token }); // ghost bugs the mark
assert.equal((await call('GET', '/v1/wire', { token: mark.token })).body.bugsOnYou, 1, 'a live watcher is a real bug');
await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: ghost.id }, headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal((await call('GET', '/v1/wire', { token: mark.token })).body.bugsOnYou, 0, "a dead watcher's tap is not counted (alive-join parity with the threat read)");
r = await call('POST', '/v1/wire/sweep', { token: mark.token });
assert.equal(r.body.spent, 0, "and a sweep against only a dead watcher's ghost row is free — no phantom charge");
// ── MED regression: a tap on a mark who DIES is deleted at their estate, freeing the watcher's cap slot ──
const hunter = await mk('Wire Hunter'); const doomed = await mk('Doomed Mark');
await acctOmr(hunter.id, 100); grantDrift += 100;
await call('POST', `/v1/wire/tap/${doomed.id}`, { token: hunter.token });
assert.equal((await call('GET', '/v1/wire', { token: hunter.token })).body.taps.filter((t) => t.target === doomed.id).length, 1, 'the hunter is wired on the mark');
await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: doomed.id }, headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM wiretaps WHERE watcher_character='${hunter.id}'`)).rows[0].n), 0, "the dead mark's tap is deleted at the estate — the watcher's slot is freed (no untap dead-end)");

// ── the worker sweep: expired taps are tidied (reads already filter, this is hygiene) ──
await pool.query(`INSERT INTO wiretaps (watcher_character, target_character, expires_at) VALUES ('${watcher.id}','stale', now() - interval '1 hour')`);
const swept = await sweepWire(pool);
assert(swept.swept >= 1, 'the worker swept the expired tap');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM wiretaps WHERE target_character='stale'`)).rows[0].n), 0, 'the stale row is gone');

// ══ STEP TWO — THE BUG TRACE + THE DOSSIER + THE SPYMASTER ══
// (A) THE BUG TRACE — NAME who's on your line (counter-intel; does NOT clear). `other` bugs the watcher.
await acctOmr(other.id, 100); grantDrift += 100;
await call('POST', `/v1/wire/tap/${watcher.id}`, { token: other.token });
await acctOmr(watcher.id, 100); grantDrift += 100;
const traceOmrBefore = (await meOf(watcher.token)).omr;
r = await call('POST', '/v1/wire/trace', { token: watcher.token });
assert.equal(r.code, 200, 'the trace runs');
assert.equal(r.body.bugsFound, 1, 'the trace finds the bug');
assert(r.body.watchers.find((w) => w.name === 'Two-Face Sal'), 'the trace NAMES the watcher (counter-intel — the sweep only counts)');
assert.equal(r.body.spent, WIRE.TRACE_OMR, 'the trace burned its price');
assert.equal((await meOf(watcher.token)).omr, traceOmrBefore - WIRE.TRACE_OMR, 'exactly the trace price burned');
assert.equal((await call('GET', '/v1/wire', { token: watcher.token })).body.bugsOnYou, 1, "trace does NOT clear the bug (that's the cheaper sweep's job)");
const cleanGuy = await mk('Clean Clyde');
assert.equal((await call('POST', '/v1/wire/trace', { token: cleanGuy.token })).body.spent, 0, 'a trace on clean lines is free (the sweep/peek precedent)');

// (B) THE DOSSIER — a deep read (kill record / flags / family role / who they're tapping; NO exact cash)
const markAcct = (await pool.query(`SELECT account_id a FROM characters WHERE id='${mark.id}'`)).rows[0].a;
const otherAcct = (await pool.query(`SELECT account_id a FROM characters WHERE id='${other.id}'`)).rows[0].a;
await pool.query(`INSERT INTO kill_log (id, killer_account, victim_account, victim_name) VALUES ('kl_dos','${markAcct}','${otherAcct}','Two-Face Sal')`);
await pool.query(`UPDATE characters SET welsher=true WHERE id='${mark.id}'`);
await acctOmr(mark.id, 100); grantDrift += 100;
await call('POST', `/v1/wire/tap/${watcher.id}`, { token: mark.token }); // the mark keeps a wire on the watcher
await acctOmr(watcher.id, 100); grantDrift += 100;
const dossOmrBefore = (await meOf(watcher.token)).omr;
r = await call('POST', `/v1/wire/dossier/${mark.id}`, { token: watcher.token });
assert.equal(r.code, 200, 'the dossier compiles');
assert.equal(r.body.spent, WIRE.DOSSIER_OMR, 'the dossier burned its price');
assert.equal((await meOf(watcher.token)).omr, dossOmrBefore - WIRE.DOSSIER_OMR, 'exactly the dossier price burned');
const d = r.body.dossier;
assert.equal(d.record.kills, 1, "the dossier reads the mark's kill record");
assert.equal(d.flags.welsher, true, 'and their welsher flag');
assert(d.watching.find((n) => n === 'Nosy Nick'), 'and WHO they have wires on (counter-intel — the mark is watching the watcher)');
assert.equal(typeof d.wealth, 'string', 'wealth stays a BAND — never exact cash (the audit anti-kill-EV rule holds)');
assert.equal((await call('POST', `/v1/wire/dossier/${watcher.id}`, { token: watcher.token })).body.error, 'self', 'no dossier on yourself');

// (C) THE SPYMASTER — lifetime intel ops (account-level, survives death) + the leaderboard
const spyBoard = (await call('GET', '/v1/wire', { token: watcher.token })).body;
assert(spyBoard.spymaster && spyBoard.spymaster.ops > 0, 'the terminal shows your lifetime intel ops + rank');
const wlb = (await call('GET', '/v1/leaderboard/wire', { token: watcher.token })).body;
assert(wlb.spies.find((x) => x.name === 'Nosy Nick' && x.ops > 0), 'the watcher ranks on the Spymaster board');

// ── §10.4: intel:* is a recognized burn; the ONLY drift is the unledgered SQL grant ──
const inv = await runLedgerInvariants(pool);
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `intel: rides the omr vocabulary (${JSON.stringify(vocab.unknown || [])})`);
const omrCheck = inv.checks.find((c) => c.name === '$OMR conservation');
assert.equal(omrCheck.drift, grantDrift, `the only $OMR drift is the test grant (${grantDrift}) — every wire spend reconciles as an intel:* burn`);

console.log('✅ The Wire test passed — the terminal (costs, ticker tape, empty state), the wiretap sink (self/gone/cap gates + exact intel:wiretap burn), tap INTEL (law stage, wealth band, ops counts, the huntingYou money-signal), bugs-on-you + SWEEP (free when clean, charged + clears when bugged), the Street Wire subscription (intel:wire burn + the premium feed: forecast, threat-chatter COUNT, open contracts), the worker sweep of expired taps, STEP TWO — THE BUG TRACE (names your watchers without clearing, free when clean), THE DOSSIER (a deep read: kill record / flags / family role / who they tap — banded wealth, never exact), THE SPYMASTER (lifetime intel ops + rank + the leaderboard, account-level), and §10.4 (intel:* vocabulary + $OMR conservation — drift == the test grant only)');
await app.close();

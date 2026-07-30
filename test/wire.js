// THE WIRE — the intelligence terminal. Covers: the board (costs, ticker tape, empty state), the
// wiretap sink (self/gone/cap gates, exact intel:wiretap burn), tap INTEL (law stage, wealth band,
// ops counts, the huntingYou money-signal), bugs-on-you + SWEEP (free when clean, charged + clears
// when bugged), the Street Wire subscription (intel:wire burn, the premium feed: forecast + threat
// chatter COUNT + war room), the worker sweep of expired taps, and §10.4 (intel:* rides the omr
// vocabulary; the only drift is the unledgered SQL $OMR grant — proving every wire spend is a burn).
// pg-mem, zero infra. SQL-granting $OMR is an unledgered mint (the estate/portfolio precedent).
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { buildServer } from '../src/server.js';
import { WIRE, RIVALS, intelCost, wireSubTier } from '../src/rules.js';
import { sweepWire, sweepWireAlerts, sweepStandingWatches } from '../src/wire.js';
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

// ── STREET WAR step two: tapping a RIVAL (someone who wronged you) costs half — the discounted
// number is what's burned (the tradecraft-discount discipline); a stranger still pays full price
// (the full-price tap above IS the control). The ledger row only ever discloses what the mark
// already announced (the rivals ledger records named acts only).
{
  // (fetch the two accounts first — an INSERT…SELECT over a two-table FROM writes the WRONG pair
  // under pg-mem, which the tap check then misses; VALUES is unambiguous on both engines)
  const wAcct = (await pool.query(`SELECT account_id FROM characters WHERE id='${watcher.id}'`)).rows[0].account_id;
  const mAcct = (await pool.query(`SELECT account_id FROM characters WHERE id='${mark.id}'`)).rows[0].account_id;
  await pool.query(
    `INSERT INTO rival_events (id, victim_account, aggressor_account, kind, detail)
     VALUES ('${crypto.randomUUID()}','${wAcct}','${mAcct}','jump','{}'::jsonb)`);
}
{
  const omrB4 = (await meOf(watcher.token)).omr;
  const rr = await call('POST', `/v1/wire/tap/${mark.id}`, { token: watcher.token }); // refresh at the rival rate
  assert.equal(rr.code, 200, 'the rival tap is live');
  assert.equal(rr.body.rivalDiscount, true, 'the discount is flagged');
  assert.equal(rr.body.spent, Math.floor(WIRE.TAP_OMR * RIVALS.WIRE_RIVAL_MULT), 'half the tap price');
  assert.equal((await meOf(watcher.token)).omr, omrB4 - rr.body.spent, 'and the DISCOUNTED number is what burned');
}

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

// ════════ STEP THREE — the counter-intel triad (DISINFORMATION + THE INFORMANT) ════════
const spy = await mk('Spooky Sue');       // a fresh operator + target for the triad
const quarry = await mk('Slippery Sam');
await acctOmr(spy.id, 200); grantDrift += 200;
await acctOmr(quarry.id, 200); grantDrift += 200;
// the quarry is a whale who is HUNTING the spy (the money signal a tap/informant is worth)
await pool.query(`UPDATE characters SET cash=6000000, bank=0, heat=90, heat_exposure=1200 WHERE id='${quarry.id}'`);
await pool.query(`INSERT INTO searches (hunter, target) VALUES ('${quarry.id}','${spy.id}')`);

// (A) DISINFORMATION — the quarry plants false intel: any WIRETAP reading them gets cooked signals
r = await call('POST', '/v1/wire/disinfo', { token: quarry.token });
assert.equal(r.code, 200, 'the quarry plants disinformation');
assert.equal(r.body.spent, WIRE.DISINFO_OMR, 'disinfo is an intel:disinfo $OMR sink');
assert(r.body.disinfoSeconds > 0, 'and opens a disinfo window');
assert((await call('GET', '/v1/wire', { token: quarry.token })).body.disinfo.active, 'the board shows the quarry’s own disinfo is live');
// persist-clobber guard: disinfo_until is written by DIRECT SQL (outside persistCharacter's positional
// column list), so a LATER persisting action by the same character must NOT wipe it. The quarry subscribes
// (which persists ch.wire_until) — the disinfo window must survive the persist.
await call('POST', '/v1/wire/subscribe', { token: quarry.token });
assert((await call('GET', '/v1/wire', { token: quarry.token })).body.disinfo.active, 'disinfo survives a later persisting action (direct-SQL column — no persist-clobber)');

// the spy taps the quarry — the wiretap gets GARBAGE: the hunt is hidden, indicted forced false
await call('POST', `/v1/wire/tap/${quarry.id}`, { token: spy.token });
let tapView = (await call('GET', '/v1/wire', { token: spy.token })).body.taps.find((t) => t.target === quarry.id);
assert(tapView, 'the tap is live');
assert.equal(tapView.huntingYou, false, 'DISINFO hides the hunt from a wiretap (the quarry IS hunting the spy, but the bug says no)');
assert.equal(tapView.law.indicted, false, 'the cooked read never flags an indictment');

// (B) THE INFORMANT — a human source PIERCES the disinfo: the truth, and who they’re hunting
assert.equal((await call('POST', `/v1/wire/informant/${spy.id}`, { token: spy.token })).body.error, 'self', 'no informant on yourself');
assert.equal((await call('POST', '/v1/wire/informant/nobody', { token: spy.token })).body.error, 'gone', 'no informant on a ghost');
r = await call('POST', `/v1/wire/informant/${quarry.id}`, { token: spy.token });
assert.equal(r.code, 200, 'the spy puts a standing informant on the quarry');
assert.equal(r.body.spent, WIRE.INFORMANT_OMR, 'the informant is an intel:informant retainer sink');
const info = (await call('GET', '/v1/wire', { token: spy.token })).body.informants.find((i) => i.target === quarry.id);
assert(info, 'the informant reads on the terminal');
assert.equal(info.source, 'informant', 'flagged as a human source');
assert.equal(info.huntingYou, true, 'the INFORMANT pierces the disinfo — it sees the quarry IS hunting the spy');
assert.equal(info.wealth, 'a whale — deep pockets', 'and reads the TRUE wealth band (the cooked tap couldn’t)');
assert(info.huntingAnyone >= 1, 'the human source also reports whether they’re hunting ANYONE (not just you)');

// (C) the informant cap — three on retainer, no more
await acctOmr(spy.id, 200); grantDrift += 200;
const e1 = await mk('Extra One'); const e2 = await mk('Extra Two'); const e3 = await mk('Extra Three');
await call('POST', `/v1/wire/informant/${e1.id}`, { token: spy.token });  // 2nd
await call('POST', `/v1/wire/informant/${e2.id}`, { token: spy.token });  // 3rd (cap = 3)
assert.equal((await call('POST', `/v1/wire/informant/${e3.id}`, { token: spy.token })).body.error, 'capped', `no more than ${WIRE.INFORMANT_MAX} informants on retainer`);
// the worker tidies expired retainers (row hygiene)
await pool.query(`UPDATE wire_informants SET paid_until = now() - interval '1 hour' WHERE watcher_character='${spy.id}' AND target_character='${e1.id}'`);
assert((await sweepWire(pool)).swept >= 1, 'the worker sweeps a lapsed informant retainer');

// ══════════ STEP FOUR — THE SPYMASTER'S TRADECRAFT + THE WATCHDOG ══════════
// (A) TRADECRAFT: the earned SPY_RANKS now grant perks — more wire slots + an intel-read discount.
const tspy = await mk('Tradecraft Terry'); await acctOmr(tspy.id, 200); grantDrift += 200;
await pool.query(`UPDATE account_persistent SET intel_ops = 100 WHERE account_id = (SELECT account_id FROM characters WHERE id='${tspy.id}')`); // → Spymaster: +2 slots, −10%
const tBoard = (await call('GET', '/v1/wire', { token: tspy.token })).body;
assert.equal(tBoard.spymaster.rank, 'Spymaster', 'intel_ops 100 → the Spymaster rank');
assert.equal(tBoard.spymaster.tapBonus, 2, 'the rank grants +2 wire slots');
assert.equal(tBoard.spymaster.discountBps, 1000, 'and a 10% intel-read discount');
assert.equal(tBoard.tapMax, WIRE.TAP_MAX + 2, 'the board surfaces the raised wire cap');
assert.equal(tBoard.costs.tap, intelCost(WIRE.TAP_OMR, 100), 'the surfaced tap cost is the discounted price');
const tmark = await mk('Tradecraft Mark');
const tr = await call('POST', `/v1/wire/tap/${tmark.id}`, { token: tspy.token });
assert.equal(tr.code, 200, 'the spymaster taps'); assert.equal(tr.body.spent, intelCost(WIRE.TAP_OMR, 100), 'and pays the discounted intel:wiretap burn (7, not 8)');

// (B) THE WATCHDOG: a SUBSCRIBED watcher is pushed a wire_alert the moment a tapped mark turns hot.
const wd = await mk('Watchdog Wanda'); await acctOmr(wd.id, 200); grantDrift += 200;
assert.equal((await call('POST', '/v1/wire/subscribe', { token: wd.token })).code, 200, 'Wanda subscribes to the Street Wire');
const wdMark = await mk('Hot Harry');
assert.equal((await call('POST', `/v1/wire/tap/${wdMark.id}`, { token: wd.token })).code, 200, 'Wanda taps Harry');
const alertCount = async (id) => Number((await pool.query(`SELECT COUNT(*) n FROM notifications WHERE character_id='${id}' AND type='wire_alert'`)).rows[0].n);
assert.equal(await alertCount(wd.id), 0, 'no alert yet — Harry is quiet');
assert.equal((await sweepWireAlerts(pool)).fired, 0, 'the watchdog fires nothing while the mark is cold');
// Harry goes WANTED → the watchdog pushes an alert
await pool.query(`UPDATE characters SET wanted_until = now() + interval '1 day' WHERE id='${wdMark.id}'`);
assert((await sweepWireAlerts(pool)).fired >= 1, 'the watchdog fires when the tapped mark goes wanted');
assert.equal(await alertCount(wd.id), 1, 'Wanda got a wire_alert push');
assert.equal((await sweepWireAlerts(pool)).fired, 0, 'and it fires ONCE per event per tap — no spam');
assert.equal(await alertCount(wd.id), 1, 'still just the one alert');
// a NON-subscribed tapper gets NO watchdog alert (the premium-service gate)
const nosub = await mk('No-Sub Ned'); await acctOmr(nosub.id, 50); grantDrift += 50;
assert.equal((await call('POST', `/v1/wire/tap/${wdMark.id}`, { token: nosub.token })).code, 200, 'Ned taps the (already wanted) Harry without subscribing');
await sweepWireAlerts(pool);
assert.equal(await alertCount(nosub.id), 0, 'an un-subscribed watcher gets no watchdog alert — it rides the premium Street Wire');
// re-tapping resets the alert flags → a fresh surveillance can re-alert
await call('POST', `/v1/wire/tap/${wdMark.id}`, { token: wd.token });
assert((await sweepWireAlerts(pool)).fired >= 1, 'a re-tap resets the flags — the watchdog can alert again');
assert.equal(await alertCount(wd.id), 2, 'Wanda got a second alert on the fresh tap');

// ══════════ STEP FIVE — THE TIERED SUBSCRIPTION LADDER + THE STANDING WATCH ══════════
const T2 = wireSubTier(2), T3 = wireSubTier(3);
// (A) the tiered ladder: subscribe at a TIER (a bigger intel:wire burn) — the board surfaces the tier + slots
const ss = await mk('Switchboard Steve'); await acctOmr(ss.id, 500); grantDrift += 500;
const ssOmrBefore = (await meOf(ss.token)).omr;
r = await call('POST', '/v1/wire/subscribe', { token: ss.token, body: { tier: 2 } });
assert.equal(r.code, 200, 'subscribe at tier 2 (the Wire Room)');
assert.equal(r.body.tier, 2, 'the tier is set'); assert.equal(r.body.spent, T2.omr, 'the tier-2 price burned');
assert.equal((await meOf(ss.token)).omr, ssOmrBefore - T2.omr, 'exactly the tier-2 sub price burned');
let ssBoard = (await call('GET', '/v1/wire', { token: ss.token })).body;
assert.equal(ssBoard.subTier, 2, 'the board shows the active tier'); assert.equal(ssBoard.subTierName, T2.name, 'and its name');
assert.equal(ssBoard.watchSlots, T2.watchSlots, 'and the tier-2 standing-watch slots (2)');
assert(Array.isArray(ssBoard.subTiers) && ssBoard.subTiers.length === WIRE.SUB_TIERS.length, 'the ladder catalog is surfaced');

// (B) the STANDING WATCH: enroll a mark → places the tap now + records the auto-renew enrollment
const w1 = await mk('Watched One'); const w2 = await mk('Watched Two'); const w3 = await mk('Watched Three');
r = await call('POST', `/v1/wire/watch/${w1.id}`, { token: ss.token });
assert.equal(r.code, 200, 'enroll a standing watch'); assert.equal(r.body.standing, true, 'it is a standing watch');
ssBoard = (await call('GET', '/v1/wire', { token: ss.token })).body;
assert.equal(ssBoard.watches.length, 1, 'the enrollment shows on the terminal');
assert(ssBoard.watches[0].target === w1.id && ssBoard.watches[0].live === true, 'the watched mark + a live tap');
assert.equal(ssBoard.taps.filter((t) => t.target === w1.id).length, 1, 'enrolling placed the tap (the intel:wiretap sink)');
// gates: self, and the tier-2 watch cap (2 slots)
assert.equal((await call('POST', `/v1/wire/watch/${ss.id}`, { token: ss.token })).body.error, 'self', "no watch on your own line");
await call('POST', `/v1/wire/watch/${w2.id}`, { token: ss.token }); // 2nd (cap = 2)
assert.equal((await call('POST', `/v1/wire/watch/${w3.id}`, { token: ss.token })).body.error, 'watch_full', 'the tier-2 cap is 2 standing watches');

// (C) the no_sub + tier gates: a non-subscriber and a tier-1 subscriber can't run standing watches
const nn = await mk('No-Wire Nate');
assert.equal((await call('POST', `/v1/wire/watch/${w1.id}`, { token: nn.token })).body.error, 'no_sub', 'a standing watch needs a subscription');
await acctOmr(nn.id, 50); grantDrift += 50;
await call('POST', '/v1/wire/subscribe', { token: nn.token, body: { tier: 1 } }); // tier 1 = feed only, 0 watch slots
assert.equal((await call('POST', `/v1/wire/watch/${w1.id}`, { token: nn.token })).body.error, 'tier', 'tier 1 (Street Wire) runs no standing watches — upgrade');

// (D) the worker AUTO-RENEWS a lapsing watched tap by burning intel:watch from the watcher's $OMR.
// w1 is pushed near lapse; w2's tap is comfortably live (12h from enroll) so it is NOT re-burned.
await pool.query(`UPDATE wiretaps SET expires_at = now() + interval '5 minutes' WHERE watcher_character='${ss.id}' AND target_character='${w1.id}'`); // near lapse
const preRenewOmr = (await meOf(ss.token)).omr;
const preRenewExp = new Date((await pool.query(`SELECT expires_at e FROM wiretaps WHERE watcher_character='${ss.id}' AND target_character='${w1.id}'`)).rows[0].e);
const ren = await sweepStandingWatches(pool);
assert.equal(ren.renewed, 1, 'the worker renewed ONLY the near-lapse watched tap (w1) — w2 is comfortably live');
const postRenewExp = new Date((await pool.query(`SELECT expires_at e FROM wiretaps WHERE watcher_character='${ss.id}' AND target_character='${w1.id}'`)).rows[0].e);
assert(postRenewExp > preRenewExp, 'the tap window was extended');
assert.equal((await meOf(ss.token)).omr, preRenewOmr - intelCost(WIRE.TAP_OMR, 0), 'the renew burned the tap cost from the watcher $OMR (intel:watch)');
assert(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='intel:watch' AND account_id=(SELECT account_id FROM characters WHERE id='${ss.id}')`)).rows[0].s) < 0, 'the renew is a ledgered intel:watch burn');
// a comfortably-live tap is NOT renewed again (only renews within the window)
await sweepStandingWatches(pool);
const w1Renews = Number((await pool.query(`SELECT COUNT(*) n FROM transactions WHERE reason='intel:watch' AND account_id=(SELECT account_id FROM characters WHERE id='${ss.id}')`)).rows[0].n);
assert.equal(w1Renews, 1, 'only the near-lapse tap renewed once — a still-live tap is not re-burned');

// (E) a BROKE watcher's watch PAUSES (the tap lapses, no renew). Fund BROKY exactly the tier-2 sub + one
// tap (so after enrolling they're at $OMR 0), then a near-lapse tick can't auto-renew. No raw-SQL zeroing
// (that would be an unledgered burn — every $OMR move here is a tracked grant or a ledgered spend).
const broky = await mk('Broke Betty'); const bmark = await mk('Betty Mark');
await acctOmr(broky.id, T2.omr + WIRE.TAP_OMR); grantDrift += (T2.omr + WIRE.TAP_OMR);
await call('POST', '/v1/wire/subscribe', { token: broky.token, body: { tier: 2 } });
await call('POST', `/v1/wire/watch/${bmark.id}`, { token: broky.token }); // enroll spends the last tap cost → balance 0
assert.equal((await meOf(broky.token)).omr, 0, 'Betty is tapped out after the sub + one watch');
await pool.query(`UPDATE wiretaps SET expires_at = now() + interval '5 minutes' WHERE watcher_character='${broky.id}' AND target_character='${bmark.id}'`);
const paused = await sweepStandingWatches(pool);
assert(paused.paused >= 1, 'a broke watcher pauses the watch (no funds to auto-renew)');
assert.equal((await meOf(broky.token)).omr, 0, "and nothing was burned — a broke watch just pauses");

// (F) cancelWatch drops the enrollment (the tap lapses on its own)
r = await call('DELETE', `/v1/wire/watch/${w1.id}`, { token: ss.token });
assert.equal(r.code, 200, 'the standing watch is dropped'); assert.equal(r.body.standing, false, 'no longer standing');
assert.equal((await call('DELETE', `/v1/wire/watch/${w1.id}`, { token: ss.token })).body.error, 'no_watch', 'a second cancel has nothing to drop');

// ── §10.4: intel:* is a recognized burn; the ONLY drift is the unledgered SQL grant ──
const inv = await runLedgerInvariants(pool, { alert: false });
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `intel: rides the omr vocabulary (${JSON.stringify(vocab.unknown || [])})`);
const omrCheck = inv.checks.find((c) => c.name === '$OMR conservation');
assert.equal(omrCheck.drift, grantDrift, `the only $OMR drift is the test grant (${grantDrift}) — every wire spend reconciles as an intel:* burn`);

console.log('✅ The Wire test passed — the terminal (costs, ticker tape, empty state), the wiretap sink (self/gone/cap gates + exact intel:wiretap burn), tap INTEL (law stage, wealth band, ops counts, the huntingYou money-signal), bugs-on-you + SWEEP (free when clean, charged + clears when bugged), the Street Wire subscription (intel:wire burn + the premium feed: forecast, threat-chatter COUNT, open contracts), the worker sweep of expired taps, STEP TWO — THE BUG TRACE (names your watchers without clearing, free when clean), THE DOSSIER (a deep read: kill record / flags / family role / who they tap — banded wealth, never exact), THE SPYMASTER (lifetime intel ops + rank + the leaderboard, account-level), STEP THREE — the counter-intel triad: DISINFORMATION (an intel:disinfo sink that cooks a wiretap’s private signals — the hunt hidden, the indictment flag false) and THE INFORMANT (an intel:informant retainer that PIERCES the disinfo — the true read + who they’re hunting — self/gone/cap gates + worker sweep of lapsed retainers), STEP FOUR — THE SPYMASTER’S TRADECRAFT (the earned rank grants +wire-slots + an intel-read discount — the discounted amount is what’s ledgered) and THE WATCHDOG (a SUBSCRIBED watcher is pushed a wire_alert when a tapped mark turns hot — once per event per tap, reset on a re-tap, un-subscribers get nothing), STEP FIVE — THE TIERED SUBSCRIPTION LADDER (subscribe at a tier — a bigger intel:wire burn — surfacing the tier/slots/catalog) and THE STANDING WATCH (enroll a mark so the worker auto-renews the tap from your $OMR — self/no_sub/tier/watch_full gates, the worker renewing ONLY a near-lapse tap as a ledgered intel:watch burn, a broke watcher pausing, and cancel), and §10.4 (intel:* vocabulary + $OMR conservation — drift == the test grant only)');
await app.close();

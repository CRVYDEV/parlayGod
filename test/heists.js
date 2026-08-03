// CREW HEISTS test — plan/crew/execute/rat lifecycle: gates (job, level, cash, busy, full,
// not-leader, not-ready, stale), a scored job (weighted split, exact §10.4 ledgering, respect,
// shared cooldown), a bust (shared jail), the rat (informant paid, crew doubled, nobody named),
// disband/leave refunds, the stale sweep, and the reason-vocabulary check. pg-mem, zero infra.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { HEIST_JOBS, HEIST_CASE_ENERGY } from '../src/rules.js';
import { sweepStaleHeists } from '../src/heists.js';
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
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);

const hank = await mk('Heist Hank');   // the leader
const cara = await mk('Crew Cara');    // the crew
const ray = await mk('Rookie Ray');    // level 1 — below every gate
await seedCh(hank.id, 'respect=5760, cash=100000, muscle=400, cunning=400, speed=100'); // lvl 25
await seedCh(cara.id, 'respect=5760, cash=1000, muscle=400, cunning=400, speed=100');
const payroll = HEIST_JOBS.find((j) => j.id === 'payroll');

// ── the board + the gates ──
let r = await call('GET', '/v1/heists', { token: hank.token });
assert.equal(r.code, 200); assert(r.body.jobs.length >= 3, 'the catalog is on the board'); assert.equal(r.body.mine, null, 'no active job yet');
assert.equal((await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'nope' } })).body.error, 'bad_job', 'no such job');
assert.equal((await call('POST', '/v1/heists/plan', { token: ray.token, body: { job: 'vault' } })).body.error, 'level', 'the vault wants made players');
await seedCh(hank.id, 'cash=100');
assert.equal((await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'payroll' } })).body.error, 'cash', 'no stake, no job');
await seedCh(hank.id, 'cash=100000');
r = await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'payroll' } });
assert.equal(r.code, 200, 'the job is planned'); const h1 = r.body.id;
assert.equal(r.body.crewNeeded, 1, 'needs one more');
assert.equal((await meOf(hank.token)).cash, 100000 - payroll.stake, 'the stake left the pocket');
assert.equal((await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'payroll' } })).body.error, 'busy', 'one job at a time');
assert.equal((await call('POST', `/v1/heists/${h1}/join`, { token: ray.token })).body.error, 'level', 'the crew is gated too');
assert.equal((await call('POST', `/v1/heists/${h1}/execute`, { token: hank.token })).body.error, 'crew_short', 'no going in alone');
assert.equal((await call('POST', `/v1/heists/${h1}/join`, { token: cara.token })).code, 200, 'cara is in');
assert((await call('GET', '/v1/heists', { token: cara.token })).body.mine.crew.length === 2, 'her board shows the crew');
assert.equal((await call('POST', `/v1/heists/${h1}/execute`, { token: cara.token })).body.error, 'not_leader', 'the leader calls the go');
await seedCh(cara.id, "jail_until = now() + interval '1 minute'");
assert.equal((await call('POST', `/v1/heists/${h1}/execute`, { token: hank.token })).body.error, 'crew_not_ready', 'nobody goes with a man inside');
await seedCh(cara.id, 'jail_until=NULL');

// ── run jobs until BOTH outcomes land; verify the money on each ──
let scored = false, busted = false, guard = 0;
let activeId = h1;
while ((!scored || !busted) && guard++ < 60) {
  if (!activeId) {
    await seedCh(hank.id, 'cash=100000, heist_at=NULL, jail_until=NULL, hosp_until=NULL');
    await seedCh(cara.id, 'heist_at=NULL, jail_until=NULL, hosp_until=NULL');
    const p = await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'payroll' } });
    assert.equal(p.code, 200, `replan (${JSON.stringify(p.body)})`);
    activeId = p.body.id;
    assert.equal((await call('POST', `/v1/heists/${activeId}/join`, { token: cara.token })).code, 200, 'recrew');
  }
  const hankPre = (await meOf(hank.token)).cash, caraPre = (await meOf(cara.token)).cash;
  const ex = await call('POST', `/v1/heists/${activeId}/execute`, { token: hank.token });
  assert.equal(ex.code, 200, `execute resolves (${JSON.stringify(ex.body)})`);
  if (ex.body.score && !scored) {
    scored = true;
    const unit = ex.body.pot / 2.2; // leader 1.2 + 1 crew
    assert.equal(ex.body.share, Math.floor(unit * 1.2), 'the leader takes the weighted share');
    assert.equal((await meOf(hank.token)).cash, hankPre + Math.floor(unit * 1.2), "the leader's cut landed");
    assert.equal((await meOf(cara.token)).cash, caraPre + Math.floor(unit), "cara's cut landed");
    // R1 step-two — THE BIG-SCORE CUT: a standard score parks a legit AAPL sliver for the crew (a
    // status grant on top of the cash, so the pot is untouched) — it shows on the leader's book.
    assert(ex.body.rwaCut && ex.body.rwaCut.ticker === 'AAPL' && ex.body.rwaCut.shares > 0, 'the score parks a legit AAPL cut');
    const book = (await meOf(hank.token)).portfolio;
    assert(book.holdings.some((x) => x.ticker === 'AAPL' && x.shares > 0), "the leader's legit book carries the cut");
    assert.equal((await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'payroll' } })).body.error, 'cooldown', 'one Score per window');
  } else if (!ex.body.score && !ex.body.blown && !busted) {
    busted = true;
    assert((await meOf(hank.token)).jailSeconds > 0 && (await meOf(cara.token)).jailSeconds > 0, 'the whole crew goes down together');
  }
  activeId = null;
}
assert(scored && busted, `both outcomes over ${guard} jobs`);
// every dollar of it is ledgered: shares == heist:crew rows, stakes/refunds == heist:crew:stake rows
const sum = async (reason, cid) => Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='${reason}' AND character_id='${cid}'`)).rows[0].s);
assert(Number((await pool.query("SELECT COUNT(*) n FROM rng_audit WHERE action LIKE 'heist:%'")).rows[0].n) >= 2, 'every roll rng-audited');

// ── THE HIRED HAND (residents-in-crews): a solo leader fills a seat with an NPC body. The hand's
//    cut is FORFEITED (never minted → the faucet only shrinks), so co-op is reachable without a
//    real crewmate but the emission is bounded; HEIST_FILL_MAX keeps the marquee jobs multiplayer. ──
const hand = await mk('Hired Hand');
await pool.query(`UPDATE characters SET is_npc=true, loc=(SELECT loc FROM characters WHERE id='${hank.id}') WHERE id='${hand.id}'`);
const handAcct = (await pool.query(`SELECT account_id FROM characters WHERE id='${hand.id}'`)).rows[0].account_id;
await seedCh(hank.id, 'cash=100000, heist_at=NULL, jail_until=NULL, hosp_until=NULL, safe_until=NULL');
let hp = await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'payroll' } });
const hh = hp.body.id;
assert.equal((await call('POST', `/v1/heists/${hh}/fill`, { token: cara.token })).body.error, 'not_leader', 'only the leader hires the crew');
const hankPreFill = (await meOf(hank.token)).cash;
let fr = await call('POST', `/v1/heists/${hh}/fill`, { token: hank.token });
assert.equal(fr.code, 200, `the hand is hired (${JSON.stringify(fr.body)})`);
assert.equal(fr.body.hired, true, 'a hired hand'); assert.equal(fr.body.fee, 5000, 'the hire fee');
assert.equal((await meOf(hank.token)).cash, hankPreFill - 5000, 'the fee left the pocket');
// the committed hand is INERT — the eligible/retire pickers (the population-side change) skip anyone
// on a live plan, so a hired resident can't be retired out from under the job. Assert the exact guard.
const inert = (await pool.query(`SELECT id FROM characters WHERE is_npc AND alive AND id='${hand.id}'
  AND id NOT IN (SELECT m.character_id FROM crew_heist_members m JOIN crew_heists ch2 ON ch2.id=m.heist_id WHERE ch2.status='planning')`)).rows;
assert.equal(inert.length, 0, 'a committed hand is excluded from the free/retire pool');
let mb = (await call('GET', '/v1/heists', { token: hank.token })).body.mine;
assert.equal(mb.crew.length, 2, 'the crew is full with a body');
assert(mb.crew.some((c) => c.hired), 'the board flags the hand as hired');
assert.equal(mb.canHire, false, 'no room for another hand on a full 2-man job');
// run until a score lands, then verify the hand was NEVER paid and the leader still scored
const handCashPre = Number((await pool.query(`SELECT cash FROM characters WHERE id='${hand.id}'`)).rows[0].cash);
const handPulledPre = Number((await pool.query(`SELECT heists_pulled FROM account_persistent WHERE account_id='${handAcct}'`)).rows[0].heists_pulled);
let hScored = false, hg = 0, hid2 = hh;
while (!hScored && hg++ < 80) {
  const ex = await call('POST', `/v1/heists/${hid2}/execute`, { token: hank.token });
  assert.equal(ex.code, 200, `hired execute resolves (${JSON.stringify(ex.body)})`);
  if (ex.body.score) {
    hScored = true;
    assert.equal(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='heist:crew' AND character_id='${hand.id}'`)).rows[0].s), 0, 'THE EMISSION CLAIM: the hand takes no cut — its slice is never minted');
    assert.equal(Number((await pool.query(`SELECT cash FROM characters WHERE id='${hand.id}'`)).rows[0].cash), handCashPre, "the hand's pocket is untouched");
    assert.equal(Number((await pool.query(`SELECT heists_pulled FROM account_persistent WHERE account_id='${handAcct}'`)).rows[0].heists_pulled), handPulledPre, 'the hand earns no legend');
    assert(ex.body.share > 0, 'the leader still scores — co-op is reachable');
    assert(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='heist:crew' AND character_id='${hank.id}'`)).rows[0].s) > 0, "the leader's cut is ledgered heist:crew");
    assert.equal(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='heist:hire' AND character_id='${hank.id}'`)).rows[0].s), -5000, 'the hire fee is a ledgered heist:hire sink');
  } else { // busted/blown — the hand shares the crew's fate; clear it and go again
    await seedCh(hank.id, 'cash=100000, heist_at=NULL, jail_until=NULL, hosp_until=NULL, safe_until=NULL');
    await pool.query(`UPDATE characters SET jail_until=NULL, heist_at=NULL WHERE id='${hand.id}'`);
    const rp = await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'payroll' } });
    hid2 = rp.body.id;
    await call('POST', `/v1/heists/${hid2}/fill`, { token: hank.token });
  }
}
assert(hScored, `the solo-NPC crew landed a score within ${hg} tries`);

// ── THE CAP: the marquee jobs stay multiplayer — at most HEIST_FILL_MAX hands, the rest real bodies ──
await seedCh(hank.id, 'cash=100000, heist_at=NULL, jail_until=NULL, hosp_until=NULL, safe_until=NULL');
await pool.query(`UPDATE characters SET jail_until=NULL, heist_at=NULL WHERE id='${hand.id}'`);
const vp = await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'vault' } });
const vh = vp.body.id;
assert.equal((await call('POST', `/v1/heists/${vh}/fill`, { token: hank.token })).code, 200, 'one hand on the vault');
assert.equal((await call('POST', `/v1/heists/${vh}/fill`, { token: hank.token })).body.error, 'fill_capped', 'a 3-man job needs real bodies past the cap');
await call('POST', `/v1/heists/${vh}/leave`, { token: hank.token }); // disband + refund, drop the hand's row
await seedCh(hank.id, 'heist_at=NULL, jail_until=NULL');

// ── THE RAT: the job never fires, the informer walks paid, the street hears only "somebody talked" ──
await seedCh(hank.id, 'cash=100000, heist_at=NULL, jail_until=NULL');
await seedCh(cara.id, 'heist_at=NULL, jail_until=NULL');
r = await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'payroll' } });
const h2 = r.body.id;
await call('POST', `/v1/heists/${h2}/join`, { token: cara.token });
assert.equal((await call('POST', `/v1/heists/${h2}/rat`, { token: cara.token })).code, 200, 'cara talks to the law, quietly');
const caraPreRat = (await meOf(cara.token)).cash;
r = await call('POST', `/v1/heists/${h2}/execute`, { token: hank.token });
assert.equal(r.body.blown, true, 'the law was waiting');
assert((await meOf(hank.token)).jailSeconds > payroll.jailS, 'the leader eats DOUBLE time');
// audit M3: the informer is hauled in WITH the crew — the public jail roster used to out the
// rat as the only member walking free; now everyone sits the same stretch, the pay lands quietly
assert((await meOf(cara.token)).jailSeconds > payroll.jailS, 'the rat sits the double stretch with everyone (no jail-roster tell)');
assert.equal((await meOf(cara.token)).cash, caraPreRat + Math.floor(payroll.stake * 0.5), 'the informant is still paid half the stake');
assert.equal(await sum('heist:crew:rat', cara.id), Math.floor(payroll.stake * 0.5), 'the payout is a ledgered faucet');
assert(!JSON.stringify(r.body).includes('Cara'), 'the rat is never named');

// ── disband + leave + the stale sweep ──
await seedCh(hank.id, 'cash=100000, heist_at=NULL, jail_until=NULL');
await seedCh(cara.id, 'heist_at=NULL, jail_until=NULL');
r = await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'payroll' } });
const h3 = r.body.id;
await call('POST', `/v1/heists/${h3}/join`, { token: cara.token });
assert.equal((await call('POST', `/v1/heists/${h3}/leave`, { token: cara.token })).body.left, true, 'a member can walk');
const hankPreDisband = (await meOf(hank.token)).cash;
r = await call('POST', `/v1/heists/${h3}/leave`, { token: hank.token });
assert.equal(r.body.disbanded, true, 'the leader walking disbands the job');
assert.equal((await meOf(hank.token)).cash, hankPreDisband + payroll.stake, 'the stake comes back whole before execution');
// stale: a cold plan is swept, the living leader refunded
r = await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'payroll' } });
const h4 = r.body.id;
await pool.query(`UPDATE crew_heists SET created_at = now() - interval '7 hours' WHERE id='${h4}'`);
assert.equal((await call('POST', `/v1/heists/${h4}/join`, { token: cara.token })).body.error, 'stale', 'a cold plan takes no crew');
const hankPreSweep = (await meOf(hank.token)).cash;
assert.equal((await sweepStaleHeists(pool)).swept, 1, 'the sweep found it');
assert.equal((await meOf(hank.token)).cash, hankPreSweep + payroll.stake, 'the sweep refunded the living leader');

// ── P1.3/D2 (audit H1): a safehouse is a shield, not a base of operations ──
await seedCh(hank.id, "cash=200000, heist_at=NULL, jail_until=NULL, safe_until = now() + interval '1 hour'");
assert.equal((await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'payroll' } })).body.error, 'safe', 'no planning jobs from a safehouse');
await seedCh(hank.id, 'safe_until=NULL');

// ── STEP TWO: roles — every slot is a seat, each claimed once, and the roll reads YOUR stat ──
await seedCh(hank.id, 'cash=200000, heist_at=NULL, jail_until=NULL');
await seedCh(cara.id, 'heist_at=NULL, jail_until=NULL');
r = await call('GET', '/v1/heists', { token: hank.token });
const insideJob = r.body.jobs.find((j) => j.id === 'inside');
assert(insideJob && insideJob.roles.length === 2 && insideJob.rateBps > 0, 'the inside job is on the board with roles');
assert(r.body.jobs.every((j) => Array.isArray(j.roles) && j.roles.length === j.crew), 'every job seats exactly its crew in roles');

// ── STEP TWO: the INSIDE JOB — a crew raids a player's front for its pending income ──
const marco = await mk('Mark Marco');
await seedCh(marco.id, 'respect=5760, cash=1000000');
r = await call('POST', '/v1/business/laundromat/buy', { token: marco.token });
assert.equal(r.code, 200, 'marco opened a laundromat'); const frontId = r.body.id;
await pool.query(`UPDATE businesses SET last_collect_at = now() - interval '25 hours' WHERE id='${frontId}'`);
// gates: a mark is required, must exist, and can't be your own till
assert.equal((await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'inside' } })).body.error, 'no_mark', 'name the front');
assert.equal((await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'inside', businessId: 'nope' } })).body.error, 'no_mark', 'a real front');
assert.equal((await call('POST', '/v1/heists/plan', { token: marco.token, body: { job: 'inside', businessId: frontId } })).body.error, 'own_mark', 'not your own till');
// roles: bad seat, taken seat, and the mark can't sneak into the crew
r = await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'inside', businessId: frontId, role: 'brains' } });
assert.equal(r.code, 200, 'hank cases the laundromat'); assert.equal(r.body.role, 'brains', 'and takes the brains seat');
const h5 = r.body.id;
assert.equal((await call('POST', `/v1/heists/${h5}/join`, { token: cara.token, body: { role: 'wheelman' } })).body.error, 'bad_role', 'no wheelman seat on this job');
assert.equal((await call('POST', `/v1/heists/${h5}/join`, { token: cara.token, body: { role: 'brains' } })).body.error, 'role_taken', 'the brains seat is warm');
assert.equal((await call('POST', `/v1/heists/${h5}/join`, { token: marco.token, body: { role: 'muscle' } })).body.error, 'own_mark', 'the mark stays out of the crew');
assert.equal((await call('POST', `/v1/heists/${h5}/join`, { token: cara.token, body: { role: 'muscle' } })).code, 200, 'cara takes muscle');
// the board shows open seats on other jobs
r = await call('GET', '/v1/heists', { token: ray.token });
assert(r.body.open.every((o) => Array.isArray(o.rolesOpen)), 'the board lists open seats');

// run it until it scores (P is a roll): the pot is EXACTLY rateBps of the pending income,
// the owner keeps the rest pending, and the venue locks down for a day — win or lose
const laund = HEIST_JOBS.find((j) => j.id === 'inside');
const tier1 = 12000; // laundromat t1 incomePerHr
const pendingFull = Math.floor(tier1 * 24); // capped at BUSINESS_CAP_MS (24h)
let insideScored = false, g2 = 0, hid = h5;
while (!insideScored && g2++ < 60) {
  const hankPre = (await meOf(hank.token)).cash;
  const ex = await call('POST', `/v1/heists/${hid}/execute`, { token: hank.token });
  assert.equal(ex.code, 200, `inside execute resolves (${JSON.stringify(ex.body)})`);
  if (ex.body.score) {
    insideScored = true;
    const pot = Math.floor(pendingFull * laund.rateBps / 10000);
    assert.equal(ex.body.pot, pot, `the pot is ${laund.rateBps / 100}% of the front's pending income ($${pot})`);
    assert.equal(ex.body.share, Math.floor((pot / 2.2) * 1.2), 'split by the crew rules');
    assert.equal((await meOf(hank.token)).cash, hankPre + ex.body.share, "the leader's cut landed");
    const ledgered = Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='heist:inside'")).rows[0].s);
    assert.equal(ledgered, Math.floor((pot / 2.2) * 1.2) + Math.floor(pot / 2.2), 'every dollar of it ledgered heist:inside');
    // the owner keeps the REST pending — the clock advanced by only the stolen share
    const owned = (await call('GET', '/v1/business', { token: marco.token })).body.businesses.find((b) => b.id === frontId);
    const kept = pendingFull - pot;
    assert(Math.abs(owned.pending - kept) <= Math.ceil(tier1 / 60), `the owner keeps ~$${kept} pending (saw $${owned.pending})`);
    assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM notifications WHERE character_id='${marco.id}' AND type='inside_job'`)).rows[0].n), 1, 'the mark heard');
  } else {
    // a bust still locks the venue down — clear it (and the crew) to try again
    await seedCh(hank.id, 'cash=200000, heist_at=NULL, jail_until=NULL');
    await seedCh(cara.id, 'heist_at=NULL, jail_until=NULL');
    await pool.query(`UPDATE businesses SET inside_at=NULL, last_collect_at = now() - interval '25 hours' WHERE id='${frontId}'`);
    const p2 = await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'inside', businessId: frontId, role: 'brains' } });
    assert.equal(p2.code, 200, `replan (${JSON.stringify(p2.body)})`); hid = p2.body.id;
    assert.equal((await call('POST', `/v1/heists/${hid}/join`, { token: cara.token, body: { role: 'muscle' } })).code, 200, 'recrew');
  }
}
assert(insideScored, `the inside job landed within ${g2} tries`);
// the venue is HOT for a day — a fresh crew bounces off the lockdown
await seedCh(hank.id, 'cash=200000, heist_at=NULL, jail_until=NULL');
await seedCh(cara.id, 'heist_at=NULL, jail_until=NULL');
r = await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'inside', businessId: frontId } });
const h6 = r.body.id;
await call('POST', `/v1/heists/${h6}/join`, { token: cara.token });
assert.equal((await call('POST', `/v1/heists/${h6}/execute`, { token: hank.token })).body.error, 'mark_hot', 'the books are locked down for a day');
// audit H2: a raid-eligible front can't be crewed to spirit the income away from the Bureau
await pool.query(`UPDATE businesses SET inside_at=NULL, scrutiny=100, scrutiny_at=now() WHERE id='${frontId}'`);
assert.equal((await call('POST', `/v1/heists/${h6}/execute`, { token: hank.token })).body.error, 'feds_watching', 'a hot front is off the menu — the owner eats the raid first');
await pool.query(`UPDATE businesses SET scrutiny=0 WHERE id='${frontId}'`);
// family marks are off-limits: marco joins hank's new family → omertà
const famId = (await call('POST', '/v1/gangs', { token: hank.token, body: { name: 'Inside Men', tag: 'INS' } })).body.gangId;
assert(famId, 'hank founded a family');
assert.equal((await call('POST', `/v1/gangs/${famId}/join`, { token: marco.token })).code, 200, 'marco joined it');
assert.equal((await call('POST', `/v1/heists/${h6}/execute`, { token: hank.token })).body.error, 'family', "the crew doesn't raid its own flag");

// ═══ TIER-4: casing, the fence (hot loot), notoriety + the crew leaderboard ═══
// clear any lingering plan from the earlier flow (h6 was left mid-gate) so hank isn't 'busy'
await pool.query("UPDATE crew_heists SET status='abandoned' WHERE status='planning'");
await pool.query('DELETE FROM crew_heist_members');
const enOf = async (id) => Number((await pool.query(`SELECT energy FROM characters WHERE id='${id}'`)).rows[0].energy);
// Re-pins RESPECT as well as the rest. That matters: the loop above pays respect on every score,
// so by here hank had drifted 5760 -> ~6730, i.e. level 25 -> 26, which lifts his energy CAP from
// exactly 100 to 102. Seeded at 100 he then sits BELOW the cap, so §7.1's continuous regen (which
// fires whenever >=1s has passed) leaks into the exact-equality energy assertion below — invisible
// standalone, where the calls run in milliseconds, but a real intermittent failure under full-suite
// load. Pinned back to lvl 25 the seeded 100 IS the cap, so Math.min clamps regen to zero however
// long the gap: deterministic by construction rather than by racing the clock.
const reset = async () => { await seedCh(hank.id, "jail_until=NULL, heist_at=NULL, energy=100, cash=100000, heist_loot=0, respect=5760");
  await seedCh(cara.id, "jail_until=NULL, heist_at=NULL, energy=100, cash=1000, respect=5760"); };

// ── CASING PHASE: spend energy to case (once each), the board reflects it, no double-case ──
await reset();
r = await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'payroll' } });
const hc = r.body.id;
await call('POST', `/v1/heists/${hc}/join`, { token: cara.token, body: { role: 'wheelman' } });
const en0 = await enOf(hank.id);
r = await call('POST', `/v1/heists/${hc}/case`, { token: hank.token });
assert(r.code === 200 && r.body.cased, 'the leader cases the joint');
assert.equal(await enOf(hank.id), en0 - HEIST_CASE_ENERGY, 'casing spent energy');
assert.equal((await call('POST', `/v1/heists/${hc}/case`, { token: hank.token })).body.error, 'cased', 'no casing it twice');
let board = (await call('GET', '/v1/heists', { token: hank.token })).body;
assert(board.mine.crew.some((c) => c.cased), 'the board shows the cased crew');
assert('pulled' in board.you && board.you.rank, 'the notoriety fields surface on the board');
assert(board.jobs.length >= 12, 'the job ladder grew to 12');
await call('POST', `/v1/heists/${hc}/leave`, { token: hank.token });   // disband, tidy up

// ── THE FENCE: a fenced payroll banks HOT LOOT (no cash); fenceLoot converts it at the drifting rate ──
let hotBanked = 0;
for (let i = 0; i < 25 && hotBanked === 0; i++) {
  await reset();
  r = await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'payroll', fence: true } });
  assert.equal(r.body.fenced, true, 'the plan is flagged hot');
  const hf = r.body.id;
  await call('POST', `/v1/heists/${hf}/join`, { token: cara.token, body: { role: 'wheelman' } });
  const ex = await call('POST', `/v1/heists/${hf}/execute`, { token: hank.token });
  if (ex.body.score) { assert.equal(ex.body.share, 0, 'a hot score pays NO cash'); assert(ex.body.hot > 0, 'it banks hot loot instead'); hotBanked = ex.body.hot; }
}
assert(hotBanked > 0, 'a fenced payroll banked hot loot within the attempts');
board = (await call('GET', '/v1/heists', { token: hank.token })).body;
assert.equal(board.you.hotLoot, hotBanked, 'the hot loot is on the board');
assert(board.you.pulled >= 1, 'the crew legend banked a score');
const cashPre = (await meOf(hank.token)).cash;
r = await call('POST', '/v1/heists/fence', { token: hank.token });
assert(r.code === 200 && r.body.paid > 0, 'the fence converts hot loot to cash');
assert.equal(r.body.loot, hotBanked, 'it fenced the whole stash');
assert.equal((await meOf(hank.token)).cash, cashPre + r.body.paid, 'the fence cash landed');
assert.equal((await call('GET', '/v1/heists', { token: hank.token })).body.you.hotLoot, 0, 'the stash is empty');
assert.equal((await call('POST', '/v1/heists/fence', { token: hank.token })).body.error, 'nothing', 'nothing left to move');

// ── NOTORIETY GATE: a fresh high-level thief can't touch the marquee jobs until they earn it ──
const boss = await mk('High Roller');
await seedCh(boss.id, 'respect=500000, cash=2000000, energy=100');   // well past museum lvl 56
await pool.query(`UPDATE account_persistent SET heists_pulled=0 WHERE account_id=(SELECT account_id FROM characters WHERE id='${boss.id}')`);
assert.equal((await call('POST', '/v1/heists/plan', { token: boss.token, body: { job: 'museum' } })).body.error, 'notoriety', 'the marquee jobs are notoriety-gated');

// ── the crew leaderboard: the notorious rise ──
const lb = (await call('GET', '/v1/leaderboard/heists', { token: hank.token })).body;
assert(lb.crews.some((c) => c.name === 'Heist Hank'), 'the notorious crew is on the board');

// ── §10.4: the vocabulary knows every heist reason (incl. heist:fence) ──
const vocab = (await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `heist:crew*/heist:inside/heist:fence ride the 'heist' prefix (${JSON.stringify(vocab.unknown || [])})`);

console.log('✅ Crew heists test passed — board/gates, scored job (weighted split, exact ledgered shares, shared cooldown), shared-jail bust, THE RAT, disband/leave/stale refunds + STEP TWO: roles + the INSIDE JOB + TIER-4: the 12-job ladder, THE CASING phase (energy spent, board flag, no double-case), THE FENCE (a hot score banks loot not cash, fenced to cash at the drifting rate, hot loot on the board), the NOTORIETY gate on the marquee jobs + the crew leaderboard, and §10.4 (heist:fence rides the heist prefix)');
await app.close();

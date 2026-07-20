// M4 test: the Kitchen (makings → cook → collect → deal, crew sales + raids in
// accrual, laylow/cleanpapers), paths, trade ranks, heist, missions, daily
// contracts, First Week (+capstone), referrals (§7.13 incl. agent exclusion),
// telemetry, and mod tools. Runs on pg-mem — zero infra.
process.env.SOCIAL_VERIFY_MODE = 'trust';   // alpha honor system; production runs 'live'
process.env.MOD_KEY = 'test-mod-key';

import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { SOCIAL_TASKS } from '../src/rules.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body, headers } = {}) => {
  const res = await app.inject({ method, url, payload: body,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers || {}) } });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (token) => (await call('GET', '/v1/me', { token })).body.character;
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);
const mk = async (name, referralCode) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name, referralCode } });
  return { token, id: (await meOf(token)).id };
};

// ── the chef: level 11, bankrolled ──
const chef = await mk('Stringer Bell');
await seedCh(chef.id, "respect=400, cash=500000, cb=20, energy=200, loc='docks'");

// ── paths (§5.1): $10k first pick at level 5+ ──
assert.equal((await call('POST', '/v1/path', { token: chef.token, body: { path: 'chemistry' } })).code, 400, 'bad path rejected');
let r = await call('POST', '/v1/path', { token: chef.token, body: { path: 'kitchen' } });
assert.equal(r.code, 200, 'path declared'); assert.equal(r.body.character.path, 'kitchen');
assert.equal((await call('POST', '/v1/path', { token: chef.token, body: { path: 'gun' } })).code, 400, 'switch needs 25 $OMR');
// sim-audit regression: the $10k first pick ledgers cash reason 'path:<id>' — it was missing from
// the §10.4 cash vocabulary, so EVERY production account tripped a permanent false drift alarm
{
  const { runLedgerInvariants } = await import('../src/invariants.js');
  const vocab = (await runLedgerInvariants(pool)).checks.find((c) => c.name === 'reason vocabulary');
  assert(vocab.ok, `a path pick must not trip the vocabulary alarm (${JSON.stringify(vocab.unknown || [])})`);
}

// ── lab ladder: sequential tiers ──
r = await call('POST', '/v1/kitchen/lab/upgrade', { token: chef.token });
assert.equal(r.code, 200, 'first lab'); assert.equal(r.body.lab, 'bathtub');
r = await call('POST', '/v1/kitchen/lab/upgrade', { token: chef.token });
assert.equal(r.code, 200, 'second lab'); assert.equal(r.body.lab, 'cellar');

// ── makings (§5.3): trade-rank gate + drifting price ──
assert.equal((await call('POST', '/v1/kitchen/makings/moonmilk', { token: chef.token, body: { qty: 5 } })).code, 400, 'locked line gated');
r = await call('POST', '/v1/kitchen/makings/vim', { token: chef.token, body: { qty: 200 } });
assert.equal(r.code, 200, 'makings bought'); assert.equal(r.body.character.makings.vim, 200);

// ── cook → collect (§7.10): one batch, crates 1/20 units, fire vs quality ──
assert.equal((await call('POST', '/v1/kitchen/collect', { token: chef.token })).code, 400, 'nothing on the burner');
let stash = null;
for (let i = 0; i < 30 && !stash; i++) {
  r = await call('POST', '/v1/kitchen/cook', { token: chef.token, body: { drugId: 'vim', qty: 40 } });
  assert.equal(r.code, 200, 'cook starts');
  assert.equal(r.body.qty, 35, 'batch capped by the cellar (35)');
  assert.equal(r.body.crates, 2, '1 crate per 20 units');
  assert.equal((await call('POST', '/v1/kitchen/cook', { token: chef.token, body: { drugId: 'vim', qty: 5 } })).code, 400, 'one batch at a time');
  assert.equal((await call('POST', '/v1/kitchen/collect', { token: chef.token })).code, 400, 'chemistry doesn\'t negotiate');
  await pool.query(`UPDATE batches SET done_at = now() - interval '1 second' WHERE character_id='${chef.id}'`);
  const c = await call('POST', '/v1/kitchen/collect', { token: chef.token });
  assert.equal(c.code, 200, 'collect resolves');
  if (!c.body.fire) stash = c.body;
  await seedCh(chef.id, 'cb=20');
}
assert(stash, 'a batch survived the burner');
assert(stash.quality >= 0.6 && stash.quality <= 1.6, 'quality in range');
assert(stash.quality >= 0.75, 'kitchen path (+0.15) shows in quality floor');

// ── deal (§7.10): demand × quality × rank bonus; heat; nerve; trade_rep on gross ──
let me = await meOf(chef.token);
const repBefore = me.tradeRep, heatBefore = me.heat;
r = await call('POST', '/v1/kitchen/deal', { token: chef.token, body: { drugId: 'vim', qty: 10 } });
assert.equal(r.code, 200, 'deal closed');
assert(r.body.earned > 0, 'the street pays');
// sim-audit kitchen on-ramp: a rank-0 dealer earns the +50% corner premium (phases out at rank 1)
assert.equal(r.body.cornerPremium, true, 'the corner premium applied to the entry-rank deal');
me = await meOf(chef.token);
assert(me.tradeRep > repBefore, 'trade rep climbs on gross');
assert(me.heat >= heatBefore, 'heat follows product');
const dealLedger = await pool.query(`SELECT COUNT(*) n FROM transactions WHERE reason='deal:vim' AND character_id='${chef.id}'`);
assert(Number(dealLedger.rows[0].n) >= 1, 'deal ledgered');

// ── crew (§5.3 + §7.1): hire, then lazy offline sales ──
r = await call('POST', '/v1/kitchen/crew/hire', { token: chef.token });
assert.equal(r.code, 200); assert.equal(r.body.crew, 1); assert.equal(r.body.cost, 50000);
r = await call('POST', '/v1/kitchen/crew/hire', { token: chef.token });
assert.equal(r.body.cost, 100000, 'second hire costs double');
me = await meOf(chef.token);
const stashBefore = me.stash.find((s) => s.drug === 'vim')?.qty || 0;
assert(stashBefore > 0, 'product on the shelf for the crew');
const cashBefore = me.cash;
await seedCh(chef.id, "last_accrued_at = now() - interval '30 minutes', heat=0");
me = await meOf(chef.token);
const stashAfter = me.stash.find((s) => s.drug === 'vim')?.qty || 0;
assert(stashAfter < stashBefore, 'crew moved product while offline');
assert(me.cash > cashBefore, 'crew sales paid');
const crewLedger = await pool.query(`SELECT COUNT(*) n FROM transactions WHERE reason='crew:sales' AND character_id='${chef.id}'`);
assert(Number(crewLedger.rows[0].n) >= 1, 'crew sales ledgered');

// ── RECURRING SINKS: crew wages ("the nut") — pay them or the corner goes quiet ──
me = await meOf(chef.token);
assert.equal(me.crewWagePerHr, 2 * 1200, 'the view shows the nut: 2 crew × $1,200/hr');
assert.equal(me.crewCold, false, 'a freshly-hired crew is working'); assert.equal(me.crewWageOwed, 0, 'and the nut is square (hire stamped the clock)');
// 5 hours on the payroll → owed ≈ 2 × $1,200 × 5; paying is a ledgered sink that resets the clock
await pool.query(`UPDATE characters SET crew_paid_at = now() - interval '5 hours' WHERE id='${chef.id}'`);
me = await meOf(chef.token);
assert(Math.abs(me.crewWageOwed - 2 * 1200 * 5) <= 2 * 1200, `5h of wages owed (~$${2 * 1200 * 5}, got $${me.crewWageOwed})`);
await seedCh(chef.id, 'cash=500000');
const cashPreNut = (await meOf(chef.token)).cash;
r = await call('POST', '/v1/kitchen/crew/wages', { token: chef.token });
assert.equal(r.code, 200); assert(r.body.paid > 0, 'the nut came due');
assert.equal((await meOf(chef.token)).cash, cashPreNut - r.body.paid, 'the nut left the pocket exactly');
assert.equal(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='crew:wages' AND character_id='${chef.id}'`)).rows[0].s),
  -r.body.paid, 'crew:wages is a ledgered §10.4 cash sink');
assert.equal((await meOf(chef.token)).crewWageOwed, 0, 'paying squared the nut');
// COLD: an unpaid crew (past the 3-day window) DOWNS TOOLS — accrual stops their offline sales.
// Make them cold FIRST, then stock the shelf (a cold crew won't touch it — a warm 2-crew would
// eat the restock as fast as it's cooked). Stash isn't a §10.4 currency, so a direct seed is fine.
await pool.query(`UPDATE characters SET crew_paid_at = now() - interval '4 days' WHERE id='${chef.id}'`);
await pool.query(`DELETE FROM stash WHERE character_id='${chef.id}' AND drug_id='vim'`);
await pool.query(`INSERT INTO stash (character_id, drug_id, qty, quality) VALUES ('${chef.id}','vim',100,1.0)`);
assert.equal((await meOf(chef.token)).crewCold, true, 'four days unpaid → the crew is cold');
const coldStash = (await meOf(chef.token)).stash.find((s) => s.drug === 'vim')?.qty || 0;
assert.equal(coldStash, 100, 'the shelf is stocked');
await seedCh(chef.id, "last_accrued_at = now() - interval '30 minutes', heat=0"); // trigger a big accrual window
assert.equal((await meOf(chef.token)).stash.find((s) => s.drug === 'vim')?.qty || 0, coldStash, 'a cold crew moves NOTHING — the shelf sits untouched');
// paying the nut puts them back on the corner
await seedCh(chef.id, 'cash=2000000');
await call('POST', '/v1/kitchen/crew/wages', { token: chef.token });
assert.equal((await meOf(chef.token)).crewCold, false, 'the nut squared → the crew is back');
await seedCh(chef.id, "last_accrued_at = now() - interval '30 minutes', heat=0");
assert((((await meOf(chef.token)).stash.find((s) => s.drug === 'vim')?.qty) || 0) < coldStash, 'and they move product again');

// ── raid (§7.1): sustained heat past 60 draws the Bureau ──
await call('POST', '/v1/kitchen/makings/vim', { token: chef.token, body: { qty: 60 } });
await seedCh(chef.id, 'cb=20, energy=200, jail_until=NULL');
let cooked = false;
for (let i = 0; i < 30 && !cooked; i++) {
  await call('POST', '/v1/kitchen/cook', { token: chef.token, body: { drugId: 'vim', qty: 35 } });
  await pool.query(`UPDATE batches SET done_at = now() - interval '1 second' WHERE character_id='${chef.id}'`);
  const c = await call('POST', '/v1/kitchen/collect', { token: chef.token });
  if (c.code === 200 && !c.body.fire) cooked = true;
  await seedCh(chef.id, 'cb=20, jail_until=NULL, health=100');
}
assert(cooked, 'restocked the stash');
let raided = false;
for (let i = 0; i < 300 && !raided; i++) {
  await seedCh(chef.id, "heat=100, crew=0, last_accrued_at = now() - interval '30 minutes', jail_until=NULL");
  me = await meOf(chef.token);
  if (me.jailSeconds > 0) raided = true;
}
assert(raided, 'the Bureau eventually kicked the door');
const raidNotes = (await call('GET', '/v1/notifications', { token: chef.token })).body.notifications;
assert(raidNotes.some((n) => n.type === 'raid'), 'raid notified');
assert(Number((await pool.query("SELECT COUNT(*) n FROM telemetry WHERE event='raid'")).rows[0].n) >= 1, 'raid telemetered');

// ── laylow + clean papers ──
await seedCh(chef.id, 'heat=50, energy=200, jail_until=NULL');
r = await call('POST', '/v1/kitchen/laylow', { token: chef.token });
assert.equal(r.code, 200); assert.equal(r.body.heat, 25, '−25 heat for $5k + 25 energy');
await pool.query(`UPDATE account_persistent SET omr = omr + 12 WHERE account_id = (SELECT account_id FROM characters WHERE id='${chef.id}')`);
r = await call('POST', '/v1/kitchen/cleanpapers', { token: chef.token });
assert.equal(r.code, 200); assert.equal(r.body.heat, 0, 'papers retyped, heat wiped');

// ── heist (§5.1): 8h cooldown ──
await seedCh(chef.id, 'jail_until=NULL, health=100');
me = await meOf(chef.token);
r = await call('POST', '/v1/heist', { token: chef.token });
assert.equal(r.code, 200, 'the Daily Score');
assert(r.body.take >= 1200 * me.level, 'level-scaled take');
assert.equal((await call('POST', '/v1/heist', { token: chef.token })).code, 400, '8h cooldown holds');

// ── missions (§5.1): req validation, pay once, $OMR faucet, title ──
assert.equal((await call('POST', '/v1/missions/m9', { token: chef.token })).code, 400, 'reqs enforced');
await seedCh(chef.id, 'muscle=10');
r = await call('POST', '/v1/missions/m1', { token: chef.token });
assert.equal(r.code, 200, 'mission cleared'); assert.equal(r.body.reward.cash, 1000);
assert.equal((await call('POST', '/v1/missions/m1', { token: chef.token })).code, 400, 'chapters close');
await seedCh(chef.id, 'respect=1000, cunning=40, cb=20, cash=500000'); // lvl 16 for m4
await call('POST', '/v1/armory/gun/argument/buy', { token: chef.token }); // fp 18
const omrBefore = (await meOf(chef.token)).omr;
r = await call('POST', '/v1/missions/m4', { token: chef.token });
assert.equal(r.code, 200, 'the Dockside Heist');
assert.equal((await meOf(chef.token)).omr, omrBefore + 5, 'mission $OMR faucet paid');

// ── daily contracts (§7.4): deterministic draw, claim, all-three bonus ──
await pool.query('UPDATE street_tax SET fund = fund + 20 WHERE id=1');
let daily = (await call('GET', '/v1/daily', { token: chef.token })).body;
assert.equal(daily.jobs.length, 3, 'three contracts drawn');
const counters = Object.fromEntries(daily.jobs.map((j) => [j.kind, j.goal]));
await pool.query(`DELETE FROM daily_progress WHERE character_id='${chef.id}'`);
await pool.query(`INSERT INTO daily_progress (character_id, day, counters) VALUES ('${chef.id}', ${daily.day}, '${JSON.stringify(counters)}')`);
for (let i = 0; i < 3; i++) {
  me = await meOf(chef.token);
  const job = daily.jobs[i];
  r = await call('POST', `/v1/daily/${job.id}/claim`, { token: chef.token });
  assert.equal(r.code, 200, `claimed ${job.id}`);
  const expected = 200 * me.level + (i === 2 ? 500 * me.level : 0);
  assert.equal(r.body.payout, expected, 'level-scaled payout (+all-three bonus on the last)');
  if (i === 2) {
    assert(r.body.all, 'full envelope');
    assert.equal(r.body.omrBonus, 0.5, 'event fund covers the extra');
    // refill targets the level at claim time (v24); the claim's own rep may nudge max upward
    assert(r.body.character.energy >= 50 + 2 * me.level, 'energy refilled');
  }
  assert.equal((await call('POST', `/v1/daily/${job.id}/claim`, { token: chef.token })).code, 400, 'no double claim');
}

// ── First Week (§5.1): server-checked claims, capstone, cash-only rewards ──
await seedCh(chef.id, 'cash=500000, energy=50, jail_until=NULL');
// the guided board (the client's Start Here funnel): nine tasks, none claimed, crime not yet ready
let ob = (await call('GET', '/v1/onboard', { token: chef.token })).body;
assert.equal(ob.total, 9, 'nine first-week tasks on the board');
assert.equal(ob.claimed, 0, 'a fresh street has claimed nothing');
assert.equal(ob.allDone, false, 'and is not done');
assert.equal(ob.tasks.find((t) => t.id === 'ob_crime').ready, false, 'pull-a-job is not ready before any crime');
assert.equal(ob.tasks.find((t) => t.id === 'ob_x').ready, true, 'social tasks are always ready to claim');
assert.equal((await call('POST', '/v1/onboard/ob_crime/claim', { token: chef.token })).code, 400, 'no crime yet, no pay');
for (let i = 0; i < 20; i++) { // land one clean job
  await seedCh(chef.id, 'nerve=50, energy=200, jail_until=NULL');
  const c = await call('POST', '/v1/crimes/pick', { token: chef.token });
  if (c.body.success) break;
}
// after landing a job the board flips ob_crime to ready
ob = (await call('GET', '/v1/onboard', { token: chef.token })).body;
assert.equal(ob.tasks.find((t) => t.id === 'ob_crime').ready, true, 'the board sees the job — reward ready');
assert.equal((await call('POST', '/v1/onboard/ob_crime/claim', { token: chef.token })).code, 200, 'first job claimed');
assert.equal((await call('POST', '/v1/onboard/ob_crime/claim', { token: chef.token })).code, 400, 'claims pay once');
assert.equal((await call('GET', '/v1/onboard', { token: chef.token })).body.tasks.find((t) => t.id === 'ob_crime').claimed, true, 'the board marks it claimed');
await seedCh(chef.id, 'gta_at=NULL, energy=200, jail_until=NULL');
await call('POST', '/v1/garage/boost', { token: chef.token }); // gta_at set win or lose
await call('POST', '/v1/bank/deposit', { token: chef.token, body: { amount: 100 } });
// the legacy base58 wallet route is retired (EVM migration) — it now redirects to SIWE
assert.equal((await call('POST', '/v1/wallet', { token: chef.token, body: { address: 'So1anaAddre55Fake1111111111111111111111111' } })).code, 400, 'legacy /v1/wallet redirects to SIWE');
// ob_wallet requires a real proven wallet_address — set here as a completed SIWE link would
await pool.query(`UPDATE account_persistent SET wallet_address='0x1111111111111111111111111111111111111111' WHERE account_id=(SELECT account_id FROM characters WHERE id='${chef.id}')`);
await seedCh(chef.id, 'jail_until=NULL, cash=500000');
assert.equal((await call('POST', '/v1/gangs', { token: chef.token, body: { name: 'The Kitchen Cartel', tag: 'KC' } })).code, 200);
for (const t of ['ob_boost', 'ob_bank', 'ob_wallet', 'ob_path', 'ob_family', 'ob_x', 'ob_discord']) {
  r = await call('POST', `/v1/onboard/${t}/claim`, { token: chef.token });
  assert.equal(r.code, 200, `claimed ${t}`);
  assert.equal(r.body.capstone, false, 'capstone waits for all nine');
}
r = await call('POST', '/v1/onboard/ob_repo/claim', { token: chef.token });
assert.equal(r.code, 200, 'ninth claim');
assert.equal(r.body.capstone, true, 'THE FIRST WEEK IS DONE');
assert.equal(r.body.cash, 1500 + 5000, 'task + capstone cash (cash-only, never $OMR)');

// ── onboarding polish: the COACH (server next-step) + the founder FUNNEL ──
const rook = await mk('Rookie Ray');
let rm = (await call('GET', '/v1/me', { token: rook.token })).body.character;
assert(rm.coach && rm.coach.label === 'Pull your first job', 'a fresh street is coached to its first job');
assert.equal(rm.coach.tab, 'streets', 'and pointed at the Streets');
// land a job → the coach moves off "first job"
await seedCh(rook.id, 'nerve=50, energy=200, jail_until=NULL');
for (let i = 0; i < 20; i++) { const c = await call('POST', '/v1/crimes/pick', { token: rook.token }); if (c.body.success) break; await seedCh(rook.id, 'nerve=50, energy=200, jail_until=NULL'); }
rm = (await call('GET', '/v1/me', { token: rook.token })).body.character;
assert.notEqual(rm.coach?.label, 'Pull your first job', 'once the first job is pulled the coach advances');
// the funnel (mod-gated): counts characters + first-week claims, refuses without the key
assert.equal((await call('GET', '/v1/mod/funnel', { token: rook.token })).code, 401, 'the funnel needs the mod key');
const funnel = (await app.inject({ method: 'GET', url: '/v1/mod/funnel', headers: { 'x-mod-key': 'test-mod-key' } })).json();
assert(funnel.characters.total >= 1 && funnel.characters.alive >= 1, 'funnel counts characters');
assert(funnel.progression.pulled_a_job >= 1, 'funnel sees at least one job pulled');
assert(funnel.firstWeek.ob_crime >= 1, 'funnel tallies first-week claims from telemetry');

// ── referrals (§7.13): all four gates, atomic payout, milestone, exclusions ──
const mentor = await mk('Mentor Max');
const recruit = await mk('Fresh Blood', 'Mentor Max');
assert(Number((await pool.query('SELECT COUNT(*) n FROM referrals')).rows[0].n) >= 1, 'referral graph row written');
await seedCh(recruit.id, 'respect=400, lc_crime=39, cash=30000, nerve=50, energy=200');
await pool.query(`UPDATE account_persistent SET checkins_lifetime=3 WHERE account_id = (SELECT account_id FROM characters WHERE id='${recruit.id}')`);
const mentorCashBefore = (await meOf(mentor.token)).cash;
for (let i = 0; i < 20; i++) { // the 40th CLEAN job crosses the last gate — retry the odd fumble
  await seedCh(recruit.id, 'nerve=50, energy=200, jail_until=NULL');
  r = await call('POST', '/v1/crimes/pick', { token: recruit.token });
  if (r.body.success) break;
}
assert(r.body.success, 'the recruit landed the qualifying job');
me = await meOf(recruit.token);
assert.equal(me.omr, 1, 'recruit +1 $OMR from the fund');
const mentorMe = await meOf(mentor.token);
assert.equal(mentorMe.cash, mentorCashBefore + 10000 + 5000, 'recruiter +$10k + first-blood milestone');
assert.equal(mentorMe.omr, 3, 'recruiter +3 $OMR from the fund');
assert.equal(mentorMe.recruits, 1, 'ladder advanced');
assert((await call('GET', '/v1/notifications', { token: mentor.token })).body.notifications.some((n) => n.type === 'ref'), 'recruiter notified');
assert(Number((await pool.query('SELECT COUNT(*) n FROM referrals WHERE qualified_at IS NOT NULL')).rows[0].n) >= 1, 'qualification recorded');
// once ever: further actions pay nothing more
await call('POST', '/v1/crimes/pick', { token: recruit.token });
assert.equal((await meOf(mentor.token)).recruits, 1, 'qualification fires once');
// agent-flagged recruits never pay out
const bot = await mk('Bot Barlow', 'Mentor Max');
await pool.query(`UPDATE account_persistent SET agent_flag=true, checkins_lifetime=3 WHERE account_id = (SELECT account_id FROM characters WHERE id='${bot.id}')`);
await seedCh(bot.id, 'respect=400, lc_crime=40, cash=30000, nerve=50, energy=200');
await call('POST', '/v1/crimes/pick', { token: bot.token });
assert.equal((await meOf(mentor.token)).recruits, 1, 'agent accounts excluded from referral payouts');

// ── DAILY SOCIAL TASKS ("Spread the Word") — the organic-growth petty-cash faucet ──
const promoter = await mk('Promoter Pete');
let sw = (await call('GET', '/v1/social', { token: promoter.token })).body;
assert.equal(sw.enabled, true, 'trust mode → word-of-mouth rewards are live');
assert.equal(sw.tasks.length, SOCIAL_TASKS.TASKS.length, 'the board lists every task');
assert.equal(sw.code, 'Promoter Pete', "the share code is the player's living name");
assert(sw.tasks[0].share.includes('x.com'), 'each task carries a prefilled share intent');
assert.equal(sw.tasks[0].claimed, false, 'nothing claimed yet');
const swCashBefore = (await meOf(promoter.token)).cash;
r = await call('POST', '/v1/social/sw_post/claim', { token: promoter.token });
assert.equal(r.code, 200); assert.equal(r.body.cash, SOCIAL_TASKS.CASH, 'a task pays the petty cash');
assert.equal((await meOf(promoter.token)).cash, swCashBefore + SOCIAL_TASKS.CASH, 'the cash landed');
assert.equal((await call('GET', '/v1/social', { token: promoter.token })).body.tasks.find((t) => t.id === 'sw_post').claimed, true, 'the board marks it done today');
assert.equal((await call('POST', '/v1/social/sw_post/claim', { token: promoter.token })).body.error, 'claimed', 'once per day per task');
await call('POST', '/v1/social/sw_invite/claim', { token: promoter.token });
r = await call('POST', '/v1/social/sw_boost/claim', { token: promoter.token });
assert.equal(r.body.allDone, true, 'the last task completes the day');
assert.equal(r.body.cash, SOCIAL_TASKS.CASH + SOCIAL_TASKS.ALL_BONUS, 'and pays the all-done bonus, folded into the row');
assert.equal((await call('POST', '/v1/social/sw_nope/claim', { token: promoter.token })).body.error, 'bad_task', 'unknown task rejected');
const swPaid = SOCIAL_TASKS.CASH * 3 + SOCIAL_TASKS.ALL_BONUS;
assert.equal(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE character_id='${promoter.id}' AND reason LIKE 'social:%'`)).rows[0].s), swPaid, 'every payout is a ledgered social: cash faucet');
assert.equal((await meOf(promoter.token)).cash, 500 + swPaid, 'the character cash reconciles with the ledger (§10.4)');
// agent accounts are excluded (the referral precedent)
const shill = await mk('Shill Bot');
await pool.query(`UPDATE account_persistent SET agent_flag = true WHERE account_id = (SELECT account_id FROM characters WHERE id='${shill.id}')`);
assert.equal((await call('POST', '/v1/social/sw_post/claim', { token: shill.token })).body.error, 'agent', 'agent accounts earn no word-of-mouth cash');
// the reward gate: with verification off, claiming is refused (sharing itself stays free)
process.env.SOCIAL_VERIFY_MODE = 'off';
const quiet = await mk('Quiet Guy');
assert.equal((await call('POST', '/v1/social/sw_post/claim', { token: quiet.token })).body.error, 'social_off', 'off mode pays nothing');
process.env.SOCIAL_VERIFY_MODE = 'trust'; // restore for the rest of the suite

// ── telemetry (§12) ──
for (const ev of ['crime_attempt', 'deal', 'first_week_step', 'referral_qualified', 'social_task'])
  assert(Number((await pool.query('SELECT COUNT(*) n FROM telemetry WHERE event=$1', [ev])).rows[0].n) >= 1, `telemetry: ${ev}`);

// ── mod tools (§10.3): MOD_KEY gate, ban, mod-kill, confiscate, audit ──
assert.equal((await call('POST', '/v1/mod/ban', { body: { accountId: 'x' } })).code, 401, 'mod endpoints need the key');
const modH = { headers: { 'x-mod-key': 'test-mod-key' } };
const botAccount = (await pool.query(`SELECT account_id FROM characters WHERE id='${bot.id}'`)).rows[0].account_id;
assert.equal((await call('POST', '/v1/mod/ban', { body: { accountId: botAccount, reason: 'agent abuse' }, headers: modH.headers })).code, 200, 'banned');
assert.equal((await call('GET', '/v1/me', { token: bot.token })).code, 403, 'banned account refused');
r = await call('POST', '/v1/mod/kill', { body: { characterId: recruit.id, reason: 'test' }, headers: modH.headers });
assert.equal(r.code, 200, 'mod-kill runs the estate');
assert.equal((await meOf(recruit.token)).generation, 2, 'heir stood up');
const poolBefore = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
r = await call('POST', '/v1/mod/confiscate', { body: { characterId: chef.id, amount: 1000 }, headers: modH.headers });
assert.equal(r.code, 200); assert.equal(r.body.confiscated, 1000);
assert.equal(Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool), poolBefore + 1000, 'seized cash recycles to the buyback pool');
r = await call('GET', `/v1/mod/audit?characterId=${chef.id}`, { headers: modH.headers });
assert.equal(r.code, 200); assert(r.body.transactions.length > 0 && r.body.rng.length > 0, 'audit view live');

// ── M8: stat respec — redistribute trained points, total conserved, ledgered $OMR burn ──
await seedCh(chef.id, 'muscle=50, cunning=20, speed=30, jail_until=NULL'); // total 100
await pool.query(`UPDATE account_persistent SET omr = 0 WHERE account_id = (SELECT account_id FROM characters WHERE id='${chef.id}')`);
assert.equal((await call('POST', '/v1/respec', { token: chef.token, body: { muscle: 60, cunning: 20, speed: 20 } })).body.error, 'omr', 'the ledger man charges up front');
await pool.query(`UPDATE account_persistent SET omr = 20 WHERE account_id = (SELECT account_id FROM characters WHERE id='${chef.id}')`);
assert.equal((await call('POST', '/v1/respec', { token: chef.token, body: { muscle: 60, cunning: 20, speed: 30 } })).body.error, 'alloc', 'no minting points — the sum must match exactly');
assert.equal((await call('POST', '/v1/respec', { token: chef.token, body: { muscle: 94, cunning: 3, speed: 3 } })).body.error, 'alloc', 'no stat below the creation base (5)');
assert.equal((await call('POST', '/v1/respec', { token: chef.token, body: { muscle: 50, cunning: 20, speed: 30 } })).body.error, 'same', 'a no-op respec is refused, not charged');
assert.equal((await meOf(chef.token)).omr, 20, 'every rejection above charged nothing');
r = await call('POST', '/v1/respec', { token: chef.token, body: { muscle: 20, cunning: 20, speed: 60 } });
assert.equal(r.code, 200, 'the chef rebuilt himself for the getaway life');
const respecMe = await meOf(chef.token);
assert.equal(respecMe.stats.muscle, 20); assert.equal(respecMe.stats.speed, 60);
assert.equal(respecMe.stats.muscle + respecMe.stats.cunning + respecMe.stats.speed, 100, 'the total is conserved exactly');
assert.equal(respecMe.omr, 5, 'the respec burned 15 $OMR');
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='omr' AND reason='respec'")).rows[0].s), -15, 'the burn is ledgered');
// BALANCE D7: one re-shaping a day — a second paid respec inside the window is refused (unpaid)
assert.equal((await call('POST', '/v1/respec', { token: chef.token, body: { muscle: 60, cunning: 20, speed: 20 } })).body.error, 'cooldown', 'no re-shaping between fights (24h)');
assert.equal((await meOf(chef.token)).omr, 5, 'the refused respec charged nothing');
await pool.query(`UPDATE characters SET respec_at = now() - interval '25 hours' WHERE id='${chef.id}'`);
await pool.query(`UPDATE account_persistent SET omr = 20 WHERE account_id = (SELECT account_id FROM characters WHERE id='${chef.id}')`);
assert.equal((await call('POST', '/v1/respec', { token: chef.token, body: { muscle: 60, cunning: 20, speed: 20 } })).code, 200, 'a day later the trainer works again');

console.log('✅ M4 growth test passed — paths, kitchen (makings/cook/collect/deal/crew/raid/laylow/cleanpapers), heist, missions (+$OMR faucet), dailies (+all-three bonus), First Week (+capstone), referrals (+milestones, agent exclusion), telemetry, mod tools, M8 stat respec (sum-conserving, floor-gated, ledgered burn)');
await app.close();

// M4 test: the Kitchen (makings → cook → collect → deal, crew sales + raids in
// accrual, laylow/cleanpapers), paths, trade ranks, heist, missions, daily
// contracts, First Week (+capstone), referrals (§7.13 incl. agent exclusion),
// telemetry, and mod tools. Runs on pg-mem — zero infra.
process.env.SOCIAL_VERIFY_MODE = 'trust';   // alpha honor system; production runs 'live'
process.env.MOD_KEY = 'test-mod-key';

import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { SOCIAL_TASKS, socialShareUrl, SOCIAL_LINKS, CONSTANTS, DISTRICTS, HUSTLE, CORNER, cornerTasksOf, dayOf, M4, levelOf, PACING, MASTERY, masteryXpFor, CRIMES, MISSIONS, M8 } from '../src/rules.js';
import { socialRewardsLive } from '../src/growth.js';
import { sweepGrandReferrals, gainRespect } from '../src/game.js';

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
await seedCh(chef.id, "respect=1000, cash=500000, cb=20, energy=200, loc='docks'");

// ── paths (§5.1): $10k first pick at level 5+ ──
assert.equal((await call('POST', '/v1/path', { token: chef.token, body: { path: 'chemistry' } })).code, 400, 'bad path rejected');
let r = await call('POST', '/v1/path', { token: chef.token, body: { path: 'kitchen' } });
assert.equal(r.code, 200, 'path declared'); assert.equal(r.body.character.path, 'kitchen');
assert.equal((await call('POST', '/v1/path', { token: chef.token, body: { path: 'gun' } })).code, 400, 'switch needs 25 $OMR');
// sim-audit regression: the $10k first pick ledgers cash reason 'path:<id>' — it was missing from
// the §10.4 cash vocabulary, so EVERY production account tripped a permanent false drift alarm
{
  const { runLedgerInvariants } = await import('../src/invariants.js');
  const vocab = (await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === 'reason vocabulary');
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
const repBefore = me.tradeRep, heatBefore = me.heat, energyBefore = me.energy;
// D13 (SIGNED 2026-08-05): the corner costs ENERGY now — an empty tank is refused with the teaching
// message, and a landed deal spends exactly DEAL_ENERGY (the clock is frozen so regen can't refill
// the gap between the two reads — the recorded flake class, headed off)
await seedCh(chef.id, 'energy=2, last_accrued_at = now()');
assert.equal((await call('POST', '/v1/kitchen/deal', { token: chef.token, body: { drugId: 'vim', qty: 10 } })).body.error, 'energy',
  'a drained tank cannot work the corner (D13)');
await seedCh(chef.id, `energy=${energyBefore}, last_accrued_at = now()`);
r = await call('POST', '/v1/kitchen/deal', { token: chef.token, body: { drugId: 'vim', qty: 10 } });
assert.equal(r.code, 200, 'deal closed');
assert.equal((await meOf(chef.token)).energy, energyBefore - M4.DEAL_ENERGY, 'the deal spent exactly DEAL_ENERGY');
assert(r.body.earned > 0, 'the street pays');
// sim-audit kitchen on-ramp: a rank-0 dealer earns the +50% corner premium (phases out at rank 1)
assert.equal(r.body.cornerPremium, true, 'the corner premium applied to the entry-rank deal');
me = await meOf(chef.token);
assert(me.tradeRep > repBefore, 'trade rep climbs on gross');
assert(me.heat >= heatBefore, 'heat follows product');
const dealLedger = await pool.query(`SELECT COUNT(*) n FROM transactions WHERE reason='deal:vim' AND character_id='${chef.id}'`);
assert(Number(dealLedger.rows[0].n) >= 1, 'deal ledgered');

// ── D14 — stats matter more to the crime roll (SIGNED, option A) ──
// Two streets, same LEVEL and same mid-base crime, differing ONLY in cunning: the high-cunning one
// must land materially more jobs. Sampled (the roll is Math.random), but the +24-point spread over
// 300 attempts separates ~90 vs ~175 successes — never overlaps, so it is not flaky. Also proves the
// design guarantee: MUSCLE does nothing for crime (a muscle build ≈ a min build).
{
  const CRIME = 'poker'; // base 0.46, lvl 11
  const N = 300;
  const respect11 = PACING.LEVEL_DIVISOR * (11 - 1) ** 2;
  const runs = async (tok, id, cols) => {
    let wins = 0;
    for (let i = 0; i < N; i++) {
      // refill nerve + freeze the clock each attempt so no accrual or nerve wall interferes
      await seedCh(id, `${cols}, respect=${respect11}, nerve=50, jail_until=NULL, last_accrued_at=now()`);
      const r = await call('POST', `/v1/crimes/${CRIME}`, { token: tok });
      if (r.body.success) wins++;
    }
    return wins;
  };
  const hi = await mk('Sharp Sammy');   // maxed cunning/speed
  const lo = await mk('Dull Dan');       // min cunning/speed
  const hiWins = await runs(hi.token, hi.id, 'cunning=25, speed=25, muscle=3');
  const loWins = await runs(lo.token, lo.id, 'cunning=3, speed=3, muscle=3');
  assert(hiWins > loWins + 40,
    `D14: the high-cunning build lands materially more jobs (${hiWins}/${N} vs ${loWins}/${N}) — stats now MOVE the roll`);
  // MUSCLE stays out of crime (the PvP axis): two builds with IDENTICAL cunning/speed differing ONLY
  // in muscle must succeed EQUALLY (within sampling noise). If muscle ever leaks into the crime roll,
  // the maxed-muscle build pulls ahead and this separation blows past the noise band.
  // The band is 50, sized off the sampling variance: two EQUAL Binomial(300, ~0.4) have a difference
  // stddev of ~12, so 35 was only ~2.9σ and flaked ~0.4% of runs (a 42-diff tail was hit in a full-suite
  // run); 50 is ~4σ (robust) yet well under a REAL 22-point-stat leak, which — at cunning's measured rate
  // — would separate ~+85 (see the assert above), so it still catches any muscle bleed.
  const musHi = await mk('Bruiser Bo'), musLo = await mk('Scrawny Sid');
  const musHiWins = await runs(musHi.token, musHi.id, 'cunning=3, speed=3, muscle=25');
  const musLoWins = await runs(musLo.token, musLo.id, 'cunning=3, speed=3, muscle=3');
  assert(Math.abs(musHiWins - musLoWins) < 50,
    `D14: MUSCLE is inert for crime — same cunning/speed → same success (${musHiWins}/${N} vs ${musLoWins}/${N}, within noise)`);
}


// ── D6a step two — THE PLAY (the corner's decision axis: throughput vs the Law) ──
// The deal above carried no play → 'standard', the identity (all mults 1.0), so the assertions
// above ARE the regression that the pre-choice behaviour is byte-identical. The axis is deliberately
// NOT price: the §7.10 CASH curve is sim-audited and must pay THE SAME on every play.
{
  const plays = (await call('GET', '/v1/rules', { token: chef.token })).body.dealPlays;
  assert.deepEqual(plays.map((p) => p.id), ['careful', 'standard', 'flood'], 'the three deal plays surface on /v1/rules');
  // hold everything the price depends on constant (stash/quality/loc/trade rank) and reset the meters
  const stock = () => pool.query(`INSERT INTO stash (character_id, drug_id, qty, quality) VALUES ('${chef.id}','vim',200,1)
    ON CONFLICT (character_id, drug_id) DO UPDATE SET qty=200, quality=1`);
  const reset = () => seedCh(chef.id, 'nerve=100, heat=0, trade_rep=0');
  const run = async (play) => { await stock(); await reset();
    const res = await call('POST', '/v1/kitchen/deal', { token: chef.token, body: { drugId: 'vim', qty: 20, play } });
    assert.equal(res.code, 200, `the ${play || 'default'} play runs`);
    return { ...res.body, nerveLeft: (await meOf(chef.token)).nerve };
  };
  const careful = await run('careful'), std = await run('standard'), flood = await run('flood');
  // (1) THE CASH IS IDENTICAL — the signed §7.10 curve is untouched on every play
  assert.equal(careful.earned, std.earned, 'working the regulars pays exactly the signed price');
  assert.equal(flood.earned, std.earned, 'moving weight pays exactly the signed price — the axis is not price');
  // (2) what you trade is THE LAW: half the heat quiet, double the heat flooding
  assert(careful.heat < std.heat, `quiet draws less heat (${careful.heat} < ${std.heat})`);
  assert(flood.heat > std.heat, `weight draws more heat (${flood.heat} > ${std.heat})`);
  // (3) ...against THROUGHPUT: nerve is the corner's real throttle
  assert(careful.nerve > std.nerve, `patience costs nerve (${careful.nerve} > ${std.nerve})`);
  assert(flood.nerve < std.nerve, `weight moves fast (${flood.nerve} < ${std.nerve})`);
  // (4) churn burns your name — the fast play can only SLOW rank progression, never accelerate it
  const repOf = async () => (await meOf(chef.token)).tradeRep;
  await stock(); await reset(); await call('POST', '/v1/kitchen/deal', { token: chef.token, body: { drugId: 'vim', qty: 20, play: 'careful' } });
  const carefulRep = await repOf();
  await stock(); await reset(); await call('POST', '/v1/kitchen/deal', { token: chef.token, body: { drugId: 'vim', qty: 20, play: 'flood' } });
  assert(await repOf() < carefulRep, 'flooding the corner builds less of a name than working the regulars');
  // (5) an unknown play falls back to standard — no 400 (the crime-approach precedent)
  await stock(); await reset();
  const junk = await call('POST', '/v1/kitchen/deal', { token: chef.token, body: { drugId: 'vim', qty: 20, play: 'nonsense' } });
  assert.equal(junk.code, 200, 'an unknown play is not a 400');
  assert.equal(junk.body.play, 'standard', 'an unknown play resolves to standard');
  assert.equal(junk.body.earned, std.earned, 'the fallback pays the signed price');
  await stock(); await seedCh(chef.id, 'nerve=100, heat=0');
}

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
// A READ shows the accrued result truthfully but persists nothing (withCharacterRead — reads stopped
// taking the write lock). Any WRITE banks it. Assert both: the projection, then the ledgered fact.
me = await meOf(chef.token);
const stashAfter = me.stash.find((s) => s.drug === 'vim')?.qty || 0;
assert(stashAfter < stashBefore, 'crew moved product while offline (the view shows it)');
assert(me.cash > cashBefore, 'crew sales paid (the view shows it)');
const where = (await pool.query('SELECT loc FROM characters WHERE id=$1', [chef.id])).rows[0].loc;
await seedCh(chef.id, "cash=50000, jail_until=NULL");
await call('POST', `/v1/travel/${where === 'docks' ? 'neon' : 'docks'}`, { token: chef.token });
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

// ── THE DOOR OUT OF THE NUT (the pad/shutter precedent) ──────────────────────────────────────
// A recurring sink with no exit is a trap: the wage runs on the wall clock but the crew only earn
// while there's stash, so a player who hires ahead of their kitchen could never stop paying. The
// terms now ride with the price, and there is a way out.
{
  let m = await meOf(chef.token);
  assert.equal(m.crewWagePerHead, 1200, 'the sheet states the per-head rate BEFORE you hire');
  assert.equal(m.crewMax, 5, 'and how many hands you may keep');
  assert(m.crewColdSeconds > 0 && m.crewColdSeconds <= 3 * 24 * 3600,
    `a countdown to downed tools (got ${m.crewColdSeconds})`);
  const rules = (await call('GET', '/v1/rules')).body;
  assert.equal(rules.crew.wagePerHr, 1200, 'the public catalog carries the wage');
  assert.equal(rules.crew.coldHours, 72, 'and the cold window');
  // D7=C (founder, 2026-08-02): 168h → 48h. Stated precisely, because C SOFTENS the crossover rather
  // than removing it — only raising OFFLINE_CAP_MS would do that, and that number governs every
  // offline faucet in the game. What the cap buys is that the loss STOPS GROWING: a hand still earns
  // at most 8h of sales however long you are away, but now owes at most 48h of wage instead of 168h,
  // so three days away goes 0.40:1 → 0.60:1 and a week away no longer gets any worse than three days.
  // Absence has a floor. Read off the constant so the published figure and the clock cannot drift.
  assert.equal(rules.crew.wageCapHours, M4.CREW_WAGE_CAP_MS / 3600000, 'and how long the nut runs');

  // a WORKING crew must be squared up: the nut is settled through the existing sink, then one walks
  await pool.query(`UPDATE characters SET crew_paid_at = now() - interval '5 hours' WHERE id='${chef.id}'`);
  await seedCh(chef.id, 'cash=2000000');
  m = await meOf(chef.token);
  const owedNow = m.crewWageOwed, cashNow = m.cash, crewNow = m.crew;
  assert(owedNow > 0 && crewNow === 2, 'a warm crew with the nut running');
  const wagesBefore = Number((await pool.query(
    `SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='crew:wages' AND character_id='${chef.id}'`)).rows[0].s);
  r = await call('DELETE', '/v1/kitchen/crew', { token: chef.token });
  assert.equal(r.code, 200);
  assert.equal(r.body.walked, false, 'a working hand does not just walk');
  assert.equal(r.body.settled, owedNow, 'you square what they worked for');
  assert.equal(r.body.crew, crewNow - 1, 'and one goes');
  m = await meOf(chef.token);
  assert.equal(m.crew, 1, 'the roster is down a hand');
  assert.equal(m.cash, cashNow - owedNow, 'the settle came out of pocket, exactly');
  assert.equal(m.crewWageOwed, 0, 'and the clock restarted for whoever is left');
  assert.equal(Number((await pool.query(
    `SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='crew:wages' AND character_id='${chef.id}'`)).rows[0].s),
    wagesBefore - owedNow, 'settled through the EXISTING crew:wages sink — no new §10.4 reason');

  // broke + warm: the door is shut, and it says why
  await pool.query(`UPDATE characters SET crew_paid_at = now() - interval '10 hours' WHERE id='${chef.id}'`);
  await seedCh(chef.id, 'cash=1');
  r = await call('DELETE', '/v1/kitchen/crew', { token: chef.token });
  assert.equal(r.code, 400); assert.equal(r.body.error, 'nut');

  // COLD: men who downed tools three days ago have already gone — they walk for nothing, which is
  // the exit a broke player needs. It is not a dodge: reaching it costs three days of sales.
  await pool.query(`UPDATE characters SET crew_paid_at = now() - interval '4 days' WHERE id='${chef.id}'`);
  assert.equal((await meOf(chef.token)).crewCold, true, 'downed tools');
  const rowsBefore = Number((await pool.query(
    `SELECT COUNT(*) n FROM transactions WHERE character_id='${chef.id}'`)).rows[0].n);
  r = await call('DELETE', '/v1/kitchen/crew', { token: chef.token });
  assert.equal(r.code, 200, 'a BROKE player can always let a downed crew go — that is the exit');
  assert.equal(r.body.walked, true); assert.equal(r.body.settled, 0, 'and it costs them nothing');
  assert.equal(r.body.crew, 0, 'the last hand is gone');
  assert.equal(Number((await pool.query(
    `SELECT COUNT(*) n FROM transactions WHERE character_id='${chef.id}'`)).rows[0].n), rowsBefore,
    'a cold walk-off moves NO value — not one ledger row (the BUSINESS_SHUTTER_BPS=0 argument)');
  m = await meOf(chef.token);
  assert.equal(m.crewWageOwed, 0, 'with nobody left there is no nut');
  assert.equal(m.crewCold, false, 'and nothing cold to thaw');
  assert.equal(m.crewColdSeconds, null, 'the countdown is gone with them');
  r = await call('DELETE', '/v1/kitchen/crew', { token: chef.token });
  assert.equal(r.code, 400); assert.equal(r.body.error, 'none', 'and you cannot fire nobody');
  // the buy-in is forfeit — coming back costs the step price again, from the bottom
  await seedCh(chef.id, 'cash=2000000');
  r = await call('POST', '/v1/kitchen/crew/hire', { token: chef.token });
  assert.equal(r.body.cost, 50000, 'a rehire starts at the first step — what you sank is gone');
}

// ══ THE KITCHEN → Tier 4: lab modules, cutting agents, the kingpin legend ══
await seedCh(chef.id, 'cash=5000000, jail_until=NULL');
await pool.query(`UPDATE account_persistent SET omr=300 WHERE account_id=(SELECT account_id FROM characters WHERE id='${chef.id}')`);
// (A) LAB MODULES — a bad module id is refused; a level-1 buy is a ledgered cash sink surfaced in the view
assert.equal((await call('POST', '/v1/kitchen/module/nope', { token: chef.token })).body.error, 'bad_module', 'no such module');
r = await call('POST', '/v1/kitchen/module/purity', { token: chef.token });
assert.equal(r.code, 200, 'bought the purity rig'); assert.equal(r.body.level, 1); assert.equal(r.body.omr, 0, 'level 1 is cash-only');
assert.equal((await meOf(chef.token)).labModules.purity, 1, 'the view shows the module level');
// climb to level 3 — the top levels also burn $OMR (the lab-ladder precedent)
await call('POST', '/v1/kitchen/module/purity', { token: chef.token });
const omrPre = (await meOf(chef.token)).omr;
// §10.4: a kitchen:module $OMR burn must reconcile — it rides DESK.SINK_REASONS (the burn term +
// recycle to the desk), NOT a transfer. A prod incident (drift -72) proved it had been mis-classified
// as an uncounted transfer; assert the burn leaves $OMR conservation UNCHANGED. growth.js SQL-seeds
// omr=300 un-ledgered, so the baseline drift is non-zero → assert a DELTA (the scale/loadtest posture).
const { runLedgerInvariants: runInv } = await import('../src/invariants.js');
const driftOmrPre = Number((await runInv(pool, { alert: false })).checks.find((c) => c.name === '$OMR conservation').drift);
r = await call('POST', '/v1/kitchen/module/purity', { token: chef.token });
assert.equal(r.code, 200); assert.equal(r.body.level, 3); assert(r.body.omr > 0, 'level 3 burns $OMR');
assert.equal((await meOf(chef.token)).omr, omrPre - r.body.omr, 'the $OMR left the account exactly');
assert(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='kitchen:module' AND currency='cash' AND character_id='${chef.id}'`)).rows[0].s) < 0, 'module cash sink ledgered');
assert.equal(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='kitchen:module' AND currency='omr'`)).rows[0].s), -r.body.omr, 'module $OMR burn ledgered');
assert.equal(Number((await runInv(pool, { alert: false })).checks.find((c) => c.name === '$OMR conservation').drift), driftOmrPre, 'a kitchen:module $OMR burn keeps $OMR conservation drift unchanged (it is in the burn term via DESK.SINK_REASONS, not an uncounted transfer)');
// (B) CUTTING AGENTS — stretch a stash line: more units, weaker product; a ledgered cash sink
await pool.query(`DELETE FROM stash WHERE character_id='${chef.id}'`);
await pool.query(`INSERT INTO stash (character_id, drug_id, qty, quality) VALUES ('${chef.id}','vim',100,1.0)`);
assert.equal((await call('POST', '/v1/kitchen/cut/nope', { token: chef.token })).body.error, 'bad_drug', 'no such line to cut');
// freeze the accrual clock — chef holds a CREW and the line above just stocked 100 units, so a
// minute boundary between the two cash reads lets a §7.1 crew sale land in the pocket mid-assert
// (the recorded kingpin-flake class: a deterministic assertion on a probabilistic precondition)
await seedCh(chef.id, 'last_accrued_at = now()');
const cutCashPre = (await meOf(chef.token)).cash;
r = await call('POST', '/v1/kitchen/cut/vim', { token: chef.token });
assert.equal(r.code, 200, 'cut the line'); assert(r.body.added >= 40, `+~40% units (got +${r.body.added})`);
assert(r.body.quality < 1.0, 'the product is weaker after the cut');
assert.equal((await meOf(chef.token)).cash, cutCashPre - r.body.cost, 'the cutting agent left the pocket');
const cutStashNow = (await meOf(chef.token)).stash.find((s) => s.drug === 'vim');
assert.equal(cutStashNow.qty, 140, 'the stash grew by the added units');
assert.equal(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='kitchen:cut' AND character_id='${chef.id}'`)).rows[0].s), -r.body.cost, 'kitchen:cut is a ledgered §10.4 cash sink');
// (C) THE KINGPIN LEGEND — dealing bumped lifetime product moved (account-level, survives death)
await seedCh(chef.id, 'nerve=200, jail_until=NULL, safe_until=NULL');
await call('POST', '/v1/kitchen/deal', { token: chef.token, body: { drugId: 'vim', qty: 20 } });
// FLAKE FIX (~1 run in 10, pre-existing): the view renders `kingpin.moved` from the account snapshot
// loadOwned took at the START of the request, but §7.1 accrual runs AFTER that and an offline crew
// sale bumps product_moved by DIRECT SQL — so a read whose accrual window happens to fire a sale
// returns a view one sale behind the row, and the two assertions below disagree. Freeze the clock so
// the read's accrual window is ~0 and no sale can land inside it (the "guarantee the precondition"
// discipline, not a weakened assertion — what is asserted is unchanged).
await pool.query(`UPDATE characters SET last_accrued_at = now() WHERE id='${chef.id}'`);
me = await meOf(chef.token);
assert(me.kingpin && me.kingpin.moved > 0, 'the kingpin ledger shows lifetime product moved');
assert.equal(Number((await pool.query(`SELECT product_moved FROM account_persistent WHERE account_id=(SELECT account_id FROM characters WHERE id='${chef.id}')`)).rows[0].product_moved), me.kingpin.moved, 'the view matches the persisted legend');
r = await call('GET', '/v1/leaderboard/kingpins', { token: chef.token });
assert.equal(r.code, 200); assert(r.body.kingpins.some((k) => k.name === 'Stringer Bell' && k.moved > 0), 'the chef is on the kingpin board');

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
  // a SHORT window (5 min): accrual decays heat by dtMin×event.heatDecay FIRST, and the raid only
  // rolls while heat is still >60 — a 30-min window on a heatDecay=2 city-event day (e.g. 'opencity')
  // decayed 100→40 before the roll, so the raid never fired (a date-flaky test). 5 min keeps heat ≥90.
  await seedCh(chef.id, "heat=100, crew=0, last_accrued_at = now() - interval '5 minutes', jail_until=NULL");
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
await pool.query(`UPDATE account_persistent SET omr = omr + 72 WHERE account_id = (SELECT account_id FROM characters WHERE id='${chef.id}')`);
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
// PACING: the ladder no longer cascades — one job at a time. (This is what stopped a tester
// claiming all 28 back-to-back for level 245 in an afternoon.)
await seedCh(chef.id, 'speed=20'); // m10's req, so the COOLDOWN is what refuses it (reqs are checked first)
assert.equal((await call('POST', '/v1/missions/m10', { token: chef.token })).body.error, 'cooldown',
  'the family gives you one job at a time — no cascading the ladder');
assert((await meOf(chef.token)).missionSeconds > 0, 'the sheet shows the next-job timer');
await seedCh(chef.id, 'mission_at=NULL'); // the rest of this block tests mission MECHANICS, not pacing
await seedCh(chef.id, 'respect=2500, cunning=40, cb=20, cash=500000'); // lvl 16 for m4
await call('POST', '/v1/armory/gun/argument/buy', { token: chef.token }); // fp 18
const omrBefore = (await meOf(chef.token)).omr;
const m4 = MISSIONS.find((m) => m.id === 'm4');
const credBefore = (await meOf(chef.token)).mintCredits || 0;
r = await call('POST', '/v1/missions/m4', { token: chef.token });
assert.equal(r.code, 200, 'the Dockside Heist');
assert.equal((await meOf(chef.token)).omr, omrBefore + m4.reward.omr, 'mission $OMR faucet paid');
// ── THE FREE PATH (2026-08-10): the mission the coach names hands over the MINT CREDIT itself, so
// "you can get made for free" is a fact rather than an arithmetic race between a $OMR reward and an
// ETH-priced mint. Asserted off the CATALOG, so a re-extract that drops the grant fails here by name.
assert.equal(m4.reward.mintCredit, 1, 'the catalog still attaches the free mint credit to the job the coach names');
assert.equal(r.body.reward.mintCredit, 1, 'the claim hands over the credit');
assert.equal((await meOf(chef.token)).mintCredits, credBefore + 1, 'and it lands on the ACCOUNT (it survives death)');
// once per account, latched on the same row as the $OMR — an heir cannot re-farm it
await pool.query(`DELETE FROM missions_done WHERE character_id='${chef.id}' AND mission_id='m4'`);
await seedCh(chef.id, 'mission_at=NULL');
r = await call('POST', '/v1/missions/m4', { token: chef.token });
assert.equal(r.code, 200, 'the job can be re-run');
assert.equal(r.body.reward.mintCredit, 0, 'but the credit pays ONCE per account');
assert.equal((await meOf(chef.token)).mintCredits, credBefore + 1, 'the credit count is unmoved');

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
    assert.equal(r.body.omrBonus, M4.DAILY_ALL_OMR, 'event fund covers the extra');
    // refill targets the level at claim time (v24); the claim's own rep may nudge max upward
    assert(r.body.character.energy >= 50 + 2 * me.level, 'energy refilled');
  }
  assert.equal((await call('POST', `/v1/daily/${job.id}/claim`, { token: chef.token })).code, 400, 'no double claim');
}

// ── a drawn contract the player STRUCTURALLY cannot finish says so, and the coach stops counting it ──
// `tribute` needs a FAMILY, and the NPC residents deliberately never found one — so on the 6 days in
// 31 the pool draws a tribute job, a family-less street has a card whose bar can never move, and the
// coach's work-board rung sat on "N of today's contracts unclaimed" all day pointing at it (the F2
// masking class: a rung that cannot clear masks every live rung under it). The day is FORCED here
// because waiting for the draw would leave this vacuous on 25 days in 31 — a deterministic assertion
// must never rest on a probabilistic precondition.
{
  const { getDaily } = await import('../src/growth.js');
  const { dailyJobsOf, dailyBlockedFor, dailyLiveFor } = await import('../src/rules.js');
  let tributeDay = null;
  for (let d = dayOf(); d < dayOf() + 31 && tributeDay === null; d++) if (dailyJobsOf(d).some((j) => j.k === 'tribute')) tributeDay = d;
  assert(tributeDay !== null, 'the pool draws a tribute contract within a 31-day cycle');
  const trib = dailyJobsOf(tributeDay).find((j) => j.k === 'tribute');

  // the helper itself — the one core the board's copy and the coach's count both read
  assert.equal(dailyBlockedFor(trib, { gangId: null }), 'you need a family to pay tribute', 'no family, no tribute');
  assert.equal(dailyBlockedFor(trib, { gangId: 'g1' }), null, 'a made man can pay it');
  assert.equal(dailyBlockedFor(dailyJobsOf(tributeDay).find((j) => j.k !== 'tribute'), { gangId: null }), null,
    'nothing else in the pool needs a family');

  // the BOARD: the card says why it is out of reach, and only that card
  let board = await getDaily(pool, chef.id, tributeDay);
  assert.equal(board.jobs.find((j) => j.id === trib.id).blocked, 'you need a family to pay tribute',
    'the tribute card carries the reason instead of a bar that never moves');
  assert.equal(board.jobs.filter((j) => j.blocked).length, 1, 'and nothing else on the board is blocked');
  // the COACH counts only what is live: two of three, not three
  assert.equal(dailyLiveFor([], { gangId: null }, tributeDay).length, 2, 'a family-less street has two live contracts that day');
  assert.equal(dailyLiveFor([trib.id], { gangId: null }, tributeDay).length, 2, 'and a blocked one is never double-subtracted');
  assert.equal(dailyLiveFor([], { gangId: 'g1' }, tributeDay).length, 3, 'in a family all three count');
  // honest scope: `coachLadder` calls dailyLiveFor with the claimed ids and the gang, and THAT call
  // is exercised on the live day by the work-board walk below (where the count tracks real claims).
  // The blocked half is proven here on the forced day, since the coach's own day cannot be moved.

  // in a family the same day reads clean — proves the board really looks the membership up
  await pool.query(`INSERT INTO gang_members (gang_id, character_id) VALUES ('g-daily-probe', '${chef.id}')`);
  board = await getDaily(pool, chef.id, tributeDay);
  assert.equal(board.jobs.filter((j) => j.blocked).length, 0, 'a made man sees no blocked contract');
  await pool.query(`DELETE FROM gang_members WHERE character_id='${chef.id}'`);
}

// ── First Week (§5.1): server-checked claims, capstone, cash-only rewards ──
await seedCh(chef.id, 'cash=500000, energy=50, jail_until=NULL');
// the guided board (the client's Start Here funnel): eight tasks, none claimed, crime not yet ready
let ob = (await call('GET', '/v1/onboard', { token: chef.token })).body;
assert.equal(ob.total, 7, 'seven first-week tasks on the board (Discord retired as a growth funnel)');
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
for (const t of ['ob_boost', 'ob_bank', 'ob_wallet', 'ob_path', 'ob_family']) {
  r = await call('POST', `/v1/onboard/${t}/claim`, { token: chef.token });
  assert.equal(r.code, 200, `claimed ${t}`);
  assert.equal(r.body.capstone, false, 'capstone waits for all seven');
}
r = await call('POST', '/v1/onboard/ob_x/claim', { token: chef.token });
assert.equal(r.code, 200, 'seventh (final) claim');
assert.equal(r.body.capstone, true, 'THE FIRST WEEK IS DONE');
assert.equal(r.body.cash, 1500 + 5000, 'task + capstone cash (cash-only, never $OMR)');

// ── onboarding polish: the COACH (server next-step) + the founder FUNNEL ──
const rook = await mk('Rookie Ray');
let rm = (await call('GET', '/v1/me', { token: rook.token })).body.character;
assert(rm.coach && rm.coach.label === 'Pull your first job', 'a fresh street is coached to its first job');
assert.equal(rm.coach.tab, 'streets', 'and pointed at the Streets');
// (founder) THE PLAN — "the next 5 things to do, always": coachPlan is the whole queue in priority
// order, plan[0] IS the coach, and below level 5 the road to 5 is queued right behind the first job
// so a brand-new player never has to guess what comes after the current step.
assert(Array.isArray(rm.coachPlan) && rm.coachPlan.length >= 2, 'coachPlan is a queue, not one rung');
assert.equal(rm.coachPlan[0].label, rm.coach.label, 'plan[0] IS the coach');
assert(rm.coachPlan.some((s) => s.label === 'Get to level 5'), 'the road to level 5 is queued for a fresh street');
// land a job → the coach moves off "first job"
await seedCh(rook.id, 'nerve=50, energy=200, jail_until=NULL');
for (let i = 0; i < 20; i++) { const c = await call('POST', '/v1/crimes/pick', { token: rook.token }); if (c.body.success) break; await seedCh(rook.id, 'nerve=50, energy=200, jail_until=NULL'); }
rm = (await call('GET', '/v1/me', { token: rook.token })).body.character;
assert.notEqual(rm.coach?.label, 'Pull your first job', 'once the first job is pulled the coach advances');
// (founder) THE ROAD TO LEVEL 5 — below 5, with nerve in the tank, the coach's one instruction is
// "keep pulling jobs", with the live respect distance in the hint (no exploring required)…
assert.equal(rm.coach?.label, 'Get to level 5', 'below level 5 the coach walks the road there');
assert(/respect/.test(rm.coach.hint) && rm.coach.tab === 'streets', 'quoting the respect distance, pointing at the Streets');
// …and with the nerve pool EMPTY it says exactly what to do while waiting (a rung that clears
// itself in minutes, so it can never mask the ladder — the harness-F1 rule)
await seedCh(rook.id, 'nerve=0');
rm = (await call('GET', '/v1/me', { token: rook.token })).body.character;
assert.equal(rm.coach?.label, 'Out of nerve — it comes back by itself', 'an empty pool coaches the productive wait');
assert.equal(rm.coach.tab, 'start', 'and points at Start Here (claim what\'s READY while nerve refills)');
// (harness F1) THE COACH MUST NOT DEAD-END. THREE separate rungs could never clear for a solo
// player, each masking every rung below it — the harness caught it by reporting the same coach line
// for a whole simulated 7-day run, and a 30-day run still stuck at "Finish your First Week" at
// LEVEL 128. (a) "Nobody survives alone" is declinable forever; (b) `ob_family` sat in the
// First-Week gate, so that rung was uncompletable too; (c) `owned.skills` is a SET, so the skills
// rung tested `.length` → undefined → fired forever. Walk the whole ladder and prove each advances.
const coachOf = async () => (await call('GET', '/v1/me', { token: rook.token })).body.character.coach?.label;
await seedCh(rook.id, `respect=${10 * 19 * 19}, cash=1000, bank=100, path='gun', gta_at=now(), lc_crime=1`);
for (const t of ['ob_crime', 'ob_boost', 'ob_bank', 'ob_path']) await call('POST', `/v1/onboard/${t}/claim`, { token: rook.token });
assert.equal(await coachOf(), 'Money while you sleep',
  '(b) the four SOLO First-Week tasks clear the gate — ob_family no longer pins it');
await seedCh(rook.id, "lab='street'");
assert.equal(await coachOf(), 'You\'ve earned skill points', 'the ladder advances to skills');
await call('POST', '/v1/skills/bruiser', { token: rook.token });
assert.notEqual(await coachOf(), 'You\'ve earned skill points',
  '(c) buying a skill CLEARS the rung — owned.skills is a Set, so .length would have hung here forever; '
  + 'and the hoarder guard holds: 4 banked points (a capstone costs 4) is correct play, not a nag');
// ── THE ROAD TO 30 (founder: "continue coaching… on a plethora of possible actions all the way up
// to level 30"). Rook is level 20, so every band ≤20 fires IN ORDER, and each rung must clear the
// moment its thing is done once — walked end to end so a dead rung can never mask the ladder below.
const rookAid = (await pool.query(`SELECT account_id a FROM characters WHERE id='${rook.id}'`)).rows[0].a;
assert.equal(await coachOf(), 'Get strapped', 'lvl 6+ unarmed → the armory');
await pool.query(`INSERT INTO character_guns (character_id, gun_id) VALUES ('${rook.id}', 'pocket22')`);
assert.equal(await coachOf(), 'Learn the trade winds', 'lvl 7+ never traded goods → the arbitrage on-ramp');
await pool.query(`INSERT INTO masteries (character_id, track_id, xp) VALUES ('${rook.id}', 'commerce', 2)`);
// the kitchen rung is already cleared (the lab was seeded above) — the ladder skips straight past it
// THE SOCIAL BAND (progression harness, second run). A crew score cannot be pulled alone, so the rung
// LEADS only inside its band and drops to the tail after — otherwise it sits on top of every solo
// system for a player who has nobody, which is exactly the alpha's population. Inside the band first:
await seedCh(rook.id, `respect=${PACING.LEVEL_DIVISOR * 12 * 12}`);   // level 13 — inside 9..9+8, and PAST the family band (≤12)
assert.equal(await coachOf(), 'Pull a crew score', 'lvl 9+ never heisted → Big Scores, INSIDE the band');
// …and OUTSIDE it the same unpulled score must not lead. This is the assertion that makes the band
// real: without it, banding the rung would silently do nothing and the walk would still pass.
await seedCh(rook.id, `respect=${PACING.LEVEL_DIVISOR * 19 * 19}`);   // level 20 — past 9 + 8
assert.notEqual(await coachOf(), 'Pull a crew score',
  'past the band a multiplayer-only rung stops leading — it cannot mask the solo ladder');
await seedCh(rook.id, `respect=${PACING.LEVEL_DIVISOR * 12 * 12}`);
await pool.query(`UPDATE account_persistent SET heists_pulled=1 WHERE account_id='${rookAid}'`);
assert.equal(await coachOf(), 'A night at the Den', 'lvl 10+ never gambled a real stake → the Den');
await pool.query(`INSERT INTO masteries (character_id, track_id, xp) VALUES ('${rook.id}', 'gambling', 1)`);
assert.equal(await coachOf(), 'Get into the fight game', 'lvl 12+ no stable, no wins → The Fights');
await pool.query(`UPDATE account_persistent SET boxing_wins=1 WHERE account_id='${rookAid}'`);
await seedCh(rook.id, `respect=${PACING.LEVEL_DIVISOR * 19 * 19}`);   // back to 20 for the rest
assert.equal(await coachOf(), 'Run the streets', 'lvl 14+ never raced → Street Races');
await pool.query(`UPDATE account_persistent SET race_wins=1 WHERE account_id='${rookAid}'`);
// (founder, from an alpha tester reading the game as pay-to-win) — the free route to being MADE is
// real and was simply never said. Since 2026-08-10 the rung states a FACT rather than a price: the
// mission it names hands over the credit, so it must NAME that job and clear on being minted.
const made = (await call('GET', '/v1/me', { token: rook.token })).body.character.coach;
assert.equal(made?.label, 'You can get made for free', 'lvl 14+ unminted → the free route to being made');
const freeJob = MISSIONS.find((m) => Number(m.reward?.mintCredit) > 0);
assert(made.hint.includes(freeJob.name), 'the rung names the job that hands over the credit');
assert(!/\d+ \$OMR/.test(made.hint), 'and states no price — a quoted figure would be a lie at the till');
// holding a credit swaps the rung for "spend it" — the promise does not go silent mid-way
await pool.query(`UPDATE account_persistent SET mint_credits=1 WHERE account_id='${rookAid}'`);
assert.equal(await coachOf(), 'Spend your mint credit', 'a credit in hand → spend it');
await pool.query(`UPDATE account_persistent SET mint_credits=0, minted=true WHERE account_id='${rookAid}'`);
assert.notEqual(await coachOf(), 'You can get made for free', 'being minted clears it — it cannot nag a made man');
// (founder: "not obvious… the steps to buy your first business") — concrete, priced off the catalog
let front = (await call('GET', '/v1/me', { token: rook.token })).body.character.coach;
assert.equal(front?.label, 'Open your first front', 'lvl 15+ no front → the Empire walkthrough');
assert(/Laundromat/.test(front.hint) && /250,000/.test(front.hint), 'the hint names the front AND its live catalog price');
await pool.query(`INSERT INTO businesses (id, character_id, kind, tier) VALUES ('cb-front-1', '${rook.id}', 'laundromat', 1)`);
// D11: the stake rung moved to 15 (going legit IS the ladder now) — it gates on HOLDING the first
// rung's $OMR, so a broke rook skips it; then it fires funded and clears through the REAL till
assert.notEqual(await coachOf(), 'Put your $OMR to work', "holding nothing → the stake rung stands down");
await pool.query(`UPDATE account_persistent SET omr=60 WHERE account_id='${rookAid}'`);
assert.equal(await coachOf(), 'Put your $OMR to work', 'lvl 15+ nothing staked, holding the first rung → the ladder');
assert.equal((await call('POST', '/v1/stake', { token: rook.token, body: { amount: 60 } })).code, 200, 'the stake goes through');
// staking spent the balance to 0, so the wire rung (18, needs a tap's worth) skips too
assert.equal(await coachOf(), 'Take it to the water', 'lvl 16+ never smuggled → the Port');
await pool.query(`UPDATE account_persistent SET smuggled=1000 WHERE account_id='${rookAid}'`);
// lvl 22 band: raise the level and the wetwork rung surfaces; a first duel win clears it
await seedCh(rook.id, `respect=${10 * 22 * 22}`);
assert.equal(await coachOf(), 'Blood on the ledger', 'lvl 22+ never drew blood → the Dueling Circuit');
await pool.query(`INSERT INTO masteries (character_id, track_id, xp) VALUES ('${rook.id}', 'wetwork', 10)`);
// ── THE DEEP CITY (founder: "extend the coach past ~24 into the mid-game systems it never names").
// The 7-day harness measured a solo player touching 10 of 39 systems with the ladder ending at 22 —
// these five rungs walk the convoy/stable/nightlife/monument/estate layers, each clearing on a
// signal that cannot regress. Walked in order, clearing each, same rule as the road to 30 above.
// levels 24-30 accrue 6-7 skill points against rook's single bought skill, which re-arms the ≥5-idle
// skills nag above this band — spend two more tier-1s so the walk stays a strict ladder
for (const s of ['fast_talker', 'pack_mule']) await pool.query(
  `INSERT INTO character_skills (character_id, skill_id) VALUES ('${rook.id}', '${s}') ON CONFLICT DO NOTHING`);
await seedCh(rook.id, `respect=${10 * 24 * 24}, cash=10000, bank=0`);
assert.equal(await coachOf(), 'Put a truck on the road', 'lvl 24+ never hauled freight → Convoys');
await pool.query(`UPDATE account_persistent SET freight_delivered=1000 WHERE account_id='${rookAid}'`);
// the stable rung gates on HOLDING the cheap animal's price (the work-the-wires rule) — a broke
// street skips it rather than being pinned on advice it cannot act on
await seedCh(rook.id, `respect=${10 * 25 * 25}, cash=10000, bank=0`);
assert.notEqual(await coachOf(), 'Own the animals', 'broke → the stable rung stands down (the $ gate)');
await seedCh(rook.id, 'cash=50000');
const stableRung = (await call('GET', '/v1/me', { token: rook.token })).body.character.coach;
assert.equal(stableRung?.label, 'Own the animals', 'lvl 25+ funded, never won a race → The Stable');
assert(/30,000/.test(stableRung.hint), 'the hint quotes the live catalog price');
await pool.query(`UPDATE account_persistent SET racer_wins=1 WHERE account_id='${rookAid}'`);
// ── THE EARN→SPEND ARC (founder-directed pairing) — dues then the stake, walked as the arc reads:
// hold $OMR → become made → open the club → put the rest to work. Granting $OMR re-arms the two
// EARLIER $OMR-gated rungs (legit at 15, the wire at 18), so their clearing signals go in first.
await seedCh(rook.id, `respect=${10 * 26 * 26}, cash=800000, bank=0`);
assert.notEqual(await coachOf(), 'You can afford your dues', 'holding no $OMR → the dues rung stands down');
assert.notEqual(await coachOf(), 'Open a club of your own', 'funded but UNMADE → the club rung stands down');
// (D11: the old lvl-15 legit rung's GLD clearing-signal is gone with the Portfolio; rook is already
// STAKED from the 15-rung above, so granting $OMR re-arms only the wire rung — intel_ops clears it)
await pool.query(`UPDATE account_persistent SET omr=120, intel_ops=1 WHERE account_id='${rookAid}'`);
assert.equal(await coachOf(), 'You can afford your dues', 'lvl 26+ unmade, holding the dues → become a Made Man');
// pay through the REAL till — the burn + made_until land exactly as a player's would
assert.equal((await call('POST', '/v1/made', { token: rook.token })).code, 200, 'the dues go through');
assert.equal(await coachOf(), 'Open a club of your own', 'made and funded, no club → The Speakeasy — the arc\'s next step');
await pool.query(`INSERT INTO speakeasies (district_id, owner_character) VALUES ('brick', '${rook.id}')`);
assert.notEqual(await coachOf(), 'Open a club of your own', 'owning a club clears it for good');
// (D11: the stake rung now lives at 15 and was walked + cleared up there — rook stays staked)
await seedCh(rook.id, `respect=${10 * 28 * 28}`);
assert.equal(await coachOf(), 'Put your name on the skyline', 'lvl 28+ never bricked in → the monument');
await pool.query(`UPDATE account_persistent SET monument_built=500 WHERE account_id='${rookAid}'`);
// the estate rung gates on HOLDING tier 1's $OMR (rook has none yet)
await seedCh(rook.id, `respect=${10 * 30 * 30}`);
assert.notEqual(await coachOf(), 'Buy the compound', 'no $OMR → the estate rung stands down');
// (the wire re-arm signal was cleared back at the dues step; rook is staked so the stake rung
// stays quiet too — this grant only opens the compound's own gate)
await pool.query(`UPDATE account_persistent SET omr=300 WHERE account_id='${rookAid}'`);
const compound = (await call('GET', '/v1/me', { token: rook.token })).body.character.coach;
assert.equal(compound?.label, 'Buy the compound', 'lvl 30+ holding the price, no estate → The Estate');
assert(/Safe House/.test(compound.hint), 'naming tier 1 off the live catalog');
await pool.query(`INSERT INTO estates (account_id, tier) VALUES ('${rookAid}', 1)`);
assert.notEqual(await coachOf(), 'Buy the compound', 'the heir who inherits a compound is never re-schooled');
await pool.query(`UPDATE account_persistent SET omr=0 WHERE account_id='${rookAid}'`);
// THE BUREAU tail rung — reactive, the cold-front class: fires at stage 'investigation'
// (pre-indictment) and self-clears as the exposure bleeds or gets bribed off
await seedCh(rook.id, 'heat_exposure=1500');
assert.equal(await coachOf(), 'The Bureau is building a case', 'a thick file pre-indictment → The Law, while the cheap outs still exist');
await seedCh(rook.id, 'heat_exposure=0');
assert.notEqual(await coachOf(), 'The Bureau is building a case', 'a cooled file stands the rung down');
await seedCh(rook.id, `respect=${10 * 22 * 22}`);   // back to 22 for the tail walk
// the tail: most-clearable first, the permanent decline LAST, so nothing masks anything.
// THE PAD — a cold front is the most actionable thing on the list when it happens (it earns nothing
// while the envelope keeps running), so it leads the tail. rook already owns cb-front-1; push its pad
// past the cold window and the rung must surface AHEAD of the bank nudge, then clear when squared.
await seedCh(rook.id, 'cash=400000, bank=0, energy=0');
await pool.query(`UPDATE businesses SET upkeep_at = now() - interval '5 days' WHERE id='cb-front-1'`);
assert.equal(await coachOf(), 'A front has gone cold', 'a cold front leads the tail — it bleeds while it sits');
await pool.query(`UPDATE businesses SET upkeep_at = now() WHERE id='cb-front-1'`);
// …and the skills rung must go SILENT once there is nothing left to buy. Points keep accruing
// (floor(level/4)) long after the 12-skill tree is complete, so without this gate the rung fires
// forever pointing at a finished tree — the same never-clearing class as (a)/(b)/(c) above.
{
  const { SKILLS } = await import('../src/rules.js');
  await seedCh(rook.id, `respect=${PACING.LEVEL_DIVISOR * 199 * 199}`);   // level 200 — 50 points, tree is 30
  for (const s of SKILLS.TREE) await pool.query(
    `INSERT INTO character_skills (character_id, skill_id) VALUES ('${rook.id}', '${s.id}') ON CONFLICT DO NOTHING`);
  assert.notEqual(await coachOf(), 'You\'ve earned skill points',
    'a finished tree stops the skills rung — 20 spare points with nothing to spend them on is not a nudge');
  await pool.query(`DELETE FROM character_skills WHERE character_id='${rook.id}' AND skill_id <> 'bruiser'`);
  await seedCh(rook.id, `respect=${10 * 22 * 22}`);
}

// ── THE WORK BOARD (omerta-early-game-design.md F1) ──
// Everything above this point is a ONE-TIME milestone, so a player who follows the coach clears the
// last of them around level 22 — at exactly the level the CONTENT thins out (7 of the levels from 17
// to 31 unlock nothing at all). The coach then fell to three generic nudges and effectively stopped
// talking. These rungs never run out because they refill daily, and every one points at work that
// already exists and already pays. Walked in order, clearing each, so a dead rung cannot mask the
// ones below it — the same rule the ladder above is walked by.
const cday = dayOf();
assert.equal(await coachOf(), 'A job came in from the family',
  'a mission off cooldown is the biggest respect on the board, so it leads the work board');
await pool.query(`UPDATE characters SET mission_at = now() WHERE id='${rook.id}'`);
assert.equal(await coachOf(), '3 of today\'s contracts unclaimed', 'then the day\'s contracts, counted');
// the REAL drawn ids — the count subtracts what this player has actually claimed, so a placeholder
// id would be silently ignored and the assertion below would pass for the wrong reason
const cjobs = (await import('../src/rules.js')).dailyJobsOf(cday).map((j) => j.id);
// rook already HAS a daily row (he pulled jobs above, which bumps the counters) — upsert, don't insert
await pool.query(`INSERT INTO daily_progress (character_id, day, counters, claimed) VALUES ('${rook.id}', ${cday}, '{}', '${JSON.stringify(cjobs.slice(0, 2))}')
  ON CONFLICT (character_id, day) DO UPDATE SET claimed = EXCLUDED.claimed`);
assert.equal(await coachOf(), '1 of today\'s contracts unclaimed', 'and the count is REAL — two claimed leaves one');
await pool.query(`UPDATE daily_progress SET claimed='${JSON.stringify(cjobs)}' WHERE character_id='${rook.id}' AND day=${cday}`);
assert.equal(await coachOf(), 'Tonight\'s hustle is waiting', 'then tonight\'s hustle, unstarted');
await pool.query(`INSERT INTO hustles (character_id, day, step, baseline) VALUES ('${rook.id}', ${cday}, 1, '{}')`);
assert.equal(await coachOf(), 'Your hustle is half-finished', 'a started hustle reads as half-finished, not waiting');
await pool.query(`UPDATE hustles SET step=3 WHERE character_id='${rook.id}' AND day=${cday}`);
// the corner and the clue only fire when the player really has one open — seeded here so both are
// PROVEN rather than skipped (an un-fired rung and a broken rung look identical from the outside)
// …but first CLEAR any clue rook picked up organically. Every successful crime rolls CLUES.DROP_P
// (2%), rook pulled a dozen jobs above, and the clue rung sits BETWEEN the corner and the trainers —
// so roughly one run in ten the "allowance spent → the trainers lead" assertion below met a clue
// scroll instead and failed. A deterministic assertion must never rest on a probabilistic
// precondition (the population duel-ladder and Doc-drill flakes, same class). The clue rung is still
// PROVEN a few lines down, on a scroll seeded deliberately.
await pool.query(`DELETE FROM clue_scrolls WHERE character_id='${rook.id}'`);
await pool.query(`INSERT INTO corner_jobs (character_id, day, district, slot, baseline, claimed) VALUES ('${rook.id}', ${cday}, 'docks', 0, '{}', false)`);
assert.equal(await coachOf(), 'The corner has an envelope for you', 'an open corner job surfaces — the only daily work that pays respect');
// (red-team F2) …but ONLY while it can still be collected. `claimCorner` refuses on two counts the
// board has to know about, or the coach spends the rest of the day leading at work the server will
// not pay: the CORNER.MAX_DAY allowance, and one envelope per KIND of work. A rung that never
// clears must never sit above rungs that do — the tail's own rule, and the corner sits at its head.
for (let i = 0; i < CORNER.MAX_DAY; i++) {                       // slots 90+ map to no real task, so
  await pool.query(`INSERT INTO corner_jobs (character_id, day, district, slot, baseline, claimed)   -- only the ALLOWANCE can be
    VALUES ('${rook.id}', ${cday}, 'canal', ${90 + i}, '{}', true)`);                              // what refuses the claim
}
assert.equal(await coachOf(), 'The trainers have work for you',
  'the day\'s allowance is spent, so the open envelope is dead weight — the corner goes quiet and the next LIVE rung leads');
await pool.query(`DELETE FROM corner_jobs WHERE character_id='${rook.id}' AND day=${cday} AND district='canal'`);
assert.equal(await coachOf(), 'The corner has an envelope for you', 'allowance back, envelope live again');
// …and the OTHER gate: one envelope per KIND of work per day. The open envelope on docks slot 0 is
// dead the moment the same kind is collected somewhere else, so the coach must stop pointing at it.
// The pair is FOUND rather than hardcoded (the draw is per-day), and asserted to exist — 18 slots
// drawing from ~9 kinds collide by pigeonhole, so a day with no pair means the draw itself changed.
{
  const mine = cornerTasksOf('docks', cday).find((t) => t.slot === 0);
  let twin = null;
  for (const d of DISTRICTS) {
    if (d.id === 'docks') continue;
    const t = cornerTasksOf(d.id, cday).find((x) => x.kind === mine.kind);
    if (t) { twin = { district: d.id, slot: t.slot }; break; }
  }
  assert(twin, `no other district draws '${mine.kind}' today — the corner draw changed, not this rule`);
  await pool.query(`INSERT INTO corner_jobs (character_id, day, district, slot, baseline, claimed)
    VALUES ('${rook.id}', ${cday}, '${twin.district}', ${twin.slot}, '{}', true)`);
  assert.equal(await coachOf(), 'The trainers have work for you',
    `the corner already paid for '${mine.kind}' today, so the open envelope of that kind is dead — the rung stands down`);
  await pool.query(`DELETE FROM corner_jobs WHERE character_id='${rook.id}' AND day=${cday} AND district='${twin.district}'`);
  assert.equal(await coachOf(), 'The corner has an envelope for you', 'and comes back when it is collectable again');
}
await pool.query(`UPDATE corner_jobs SET claimed=true WHERE character_id='${rook.id}' AND day=${cday}`);
await pool.query(`INSERT INTO clue_scrolls (character_id, salt, step, steps) VALUES ('${rook.id}', 'sd', 2, 4)`);
assert.equal(await coachOf(), 'You\'re carrying a clue scroll (step 2 of 4)', 'a live clue names where you are on the trail');
await pool.query(`DELETE FROM clue_scrolls WHERE character_id='${rook.id}'`);
assert.equal(await coachOf(), 'The trainers have work for you', 'and the trainers\' drills close the board');
for (const npc of ['doc', 'fixer']) await pool.query(`INSERT INTO npc_drills (character_id, day, npc) VALUES ('${rook.id}', ${cday}, '${npc}')`);

// F6 — THE TRADES, named at the moment they pay off. Mastery XP has accrued on every action since
// level 1 and the perks at 10/25/40 are real, but the board lives on the Life tab and the coach has
// never once mentioned it — so 200 crime clicks read as repetition rather than a ladder. The rung
// fires only ONE level short of a milestone: rare, and it self-clears by playing that loop.
const m1 = MASTERY.MILESTONES[0];
await pool.query(`INSERT INTO masteries (character_id, track_id, xp) VALUES ('${rook.id}', 'larceny', $1)
  ON CONFLICT (character_id, track_id) DO UPDATE SET xp = EXCLUDED.xp`, [masteryXpFor(m1 - 1)]);
assert.equal(await coachOf(), `One level off a ${MASTERY.TRACKS.find((t) => t.id === 'larceny').name} perk`,
  'a trade one level short of a perk is the last thing on the work board');
// two levels out it says nothing — this must not become another permanent nudge
await pool.query(`UPDATE masteries SET xp=$1 WHERE character_id='${rook.id}' AND track_id='larceny'`,
  [masteryXpFor(m1 - 2)]);

assert.equal(await coachOf(), 'You\'re carrying too much', 'a fat pocket surfaces the bank nudge');
await seedCh(rook.id, 'cash=0, bank=0, energy=999');
assert.equal(await coachOf(), 'Full tank', 'banked + rested surfaces the energy rung');
await seedCh(rook.id, 'energy=0');
assert.equal(await coachOf(), 'Still running solo',
  '(a) and the declinable family nudge is the LAST rung — present, but masking nothing');
// …but INSIDE the early band the family rung is still the high-priority nudge it should be: for a
// brand-new street, joining a family genuinely IS the next thing.
const band = await mk('Band Benny');
await seedCh(band.id, `respect=${10 * 5 * 5}, path='gun'`);   // level 6 — inside the 3..12 band
for (let i = 0; i < 20; i++) { const c = await call('POST', '/v1/crimes/pick', { token: band.token }); if (c.body.success) break; await seedCh(band.id, 'nerve=50, jail_until=NULL'); }
const bandCoach = (await call('GET', '/v1/me', { token: band.token })).body.character.coach;
assert.equal(bandCoach?.label, 'Nobody survives alone', 'inside the band a gangless street IS nudged to a family');
assert.equal(bandCoach.tab, 'family', 'and pointed at the Family tab');
// the funnel (mod-gated): counts characters + first-week claims, refuses without the key
assert.equal((await call('GET', '/v1/mod/funnel', { token: rook.token })).code, 401, 'the funnel needs the mod key');
const funnel = (await app.inject({ method: 'GET', url: '/v1/mod/funnel', headers: { 'x-mod-key': 'test-mod-key' } })).json();
assert(funnel.characters.total >= 1 && funnel.characters.alive >= 1, 'funnel counts characters');
assert(funnel.progression.pulled_a_job >= 1, 'funnel sees at least one job pulled');
assert(funnel.firstWeek.ob_crime >= 1, 'funnel tallies first-week claims from telemetry');
assert(funnel.referral && typeof funnel.referral.kFactor === 'number' && funnel.referral.accounts >= 1, 'funnel carries the referral block (K-factor + counts)');
// THE BROADCAST funnel: a share beacon (authed) feeds broadcast.shares → referredPerShare
assert.equal((await call('POST', '/v1/broadcast/shared', { token: rook.token, body: { kind: 'dossier' } })).code, 200, 'the share beacon accepts an authed post');
await call('POST', '/v1/broadcast/shared', { token: rook.token, body: { kind: 'win' } });
const funnel2 = (await app.inject({ method: 'GET', url: '/v1/mod/funnel', headers: { 'x-mod-key': 'test-mod-key' } })).json();
assert(funnel2.broadcast && funnel2.broadcast.shares >= 2, 'funnel counts broadcast share intents');
assert(funnel2.broadcast.byKind.dossier >= 1 && funnel2.broadcast.byKind.win >= 1, 'funnel breaks shares down by kind');
assert(funnel2.broadcast.sharers >= 1 && typeof funnel2.broadcast.referredPerShare === 'number', 'funnel carries distinct sharers + reach→conversion');
// THE CAREER block — the ladder shipped with a board and a test and NO way for the founder to see
// whether anybody climbs it. The funnel above stops at day seven; this is where the drop-off moves.
{
  const { CAREER } = await import('../src/rules.js');
  const before = (await app.inject({ method: 'GET', url: '/v1/mod/funnel', headers: { 'x-mod-key': 'test-mod-key' } })).json().career;
  assert(before && before.reached.associate !== undefined, 'the funnel carries a career block, tier by tier');
  assert.equal(before.reached.soldier, 0, 'and nobody has opened the second tier yet');
  await seedCh(rook.id, 'bank=30000, jail_until=NULL');
  assert.equal((await call('POST', '/v1/career/ca_bank', { token: rook.token })).code, 200, 'a real career claim through the real route');
  const after = (await app.inject({ method: 'GET', url: '/v1/mod/funnel', headers: { 'x-mod-key': 'test-mod-key' } })).json().career;
  assert.equal(after.started, before.started + 1, 'the ladder counts the account that started climbing');
  assert.equal(after.tasks.ca_bank, before.tasks.ca_bank + 1, 'and the task tally names WHICH rung');
  assert.equal(after.cashPaid, before.cashPaid + CAREER.TIERS[0].tasks.find((t) => t.id === 'ca_bank').cash,
    'cashPaid is read off the ledger, so the faucet is measured not assumed');
  assert.equal(after.reached.soldier, 0, 'one claim is not four — the second tier stays shut (the NEED gate, mirrored)');
}

// ── SCREEN REACH — which of the console's 25 screens a player ever OPENS ─────────────────────────
// The measurement that decides whether the nav wants cutting, merging or leaving alone. Asserted on
// the REACH PERCENTAGE rather than the raw count, because the percentage is what a founder reads and
// it is the half that can silently go wrong (a wrong denominator still produces plausible numbers).
assert.equal((await call('POST', '/v1/screens', { token: rook.token, body: { screens: ['streets', 'kitchen', 'streets'] } })).code,
  200, 'the screen beacon accepts an authed batch');
const fun3 = (await app.inject({ method: 'GET', url: '/v1/mod/funnel', headers: { 'x-mod-key': 'test-mod-key' } })).json();
assert.equal(fun3.screens.reporters, 1, 'one reporting player');
// the server dedupes WITHIN a batch — that is what `counted` reports, and all it guards
assert.equal((await call('POST', '/v1/screens', { token: rook.token, body: { screens: ['den', 'den', 'den'] } })).body.counted,
  1, 'a repeated screen in one batch is counted once');
// but the property that makes this REACH rather than frequency is the per-account aggregation, which
// has to hold ACROSS batches too — a client that re-sends after a reload must not inflate the number
await call('POST', '/v1/screens', { token: rook.token, body: { screens: ['streets'] } });
const funDup = (await app.inject({ method: 'GET', url: '/v1/mod/funnel', headers: { 'x-mod-key': 'test-mod-key' } })).json();
assert.equal(funDup.screens.opens.streets, 1, 'the same player re-reporting a screen still counts ONCE — reach, not frequency');
assert.equal(fun3.screens.reach.streets, 100, 'the only reporter opened streets → 100% reach');
assert.equal(fun3.screens.reach.kitchen, 100, 'and the kitchen');
assert.equal(fun3.screens.reach.pen, undefined, 'a screen nobody opened is absent, never a phantom 0%');
// a SECOND player who never finds the kitchen must halve its reach — the denominator is the thing
// most likely to be wrong, and a single reporter can never show that it is
const rook2 = await mk('Reach Two');
await call('POST', '/v1/screens', { token: rook2.token, body: { screens: ['streets'] } });
const fun4 = (await app.inject({ method: 'GET', url: '/v1/mod/funnel', headers: { 'x-mod-key': 'test-mod-key' } })).json();
assert.equal(fun4.screens.reporters, 2, 'two reporting players');
assert.equal(fun4.screens.reach.streets, 100, 'both found the streets');
assert.equal(fun4.screens.reach.kitchen, 50, 'only one found the kitchen — the cold screen the founder acts on');
// bounds: junk is dropped, the batch is capped, and an empty post is a clean no-op rather than a row
const many = Array.from({ length: 60 }, (_, i) => 'scr' + i);
assert.equal((await call('POST', '/v1/screens', { token: rook.token, body: { screens: many } })).body.counted, 40,
  'the batch is capped rather than trusted');
assert.equal((await call('POST', '/v1/screens', { token: rook.token, body: { screens: [] } })).body.counted, 0,
  'an empty batch writes nothing');
assert.equal((await call('POST', '/v1/screens', { token: rook.token, body: { screens: [1, null, {}] } })).body.counted, 0,
  'non-string entries are dropped, not stringified');

// ── STEPPED PAYOUT — "the spark": a small EARLY cash payout the moment a recruit shows real
// engagement (level 3 + 10 jobs), long before full qualification. Fast feedback for the referrer. ──
const sponsor = await mk('Sponsor Sal');
const rookie = await mk('Green Recruit', 'Sponsor Sal');
const sponsorBefore = (await meOf(sponsor.token)).cash;
await seedCh(rookie.id, 'respect=160, lc_crime=9, nerve=50, energy=200'); // L5, 9 jobs — one shy of the spark gate
for (let i = 0; i < 20; i++) { await seedCh(rookie.id, 'nerve=50, energy=200, jail_until=NULL'); r = await call('POST', '/v1/crimes/pick', { token: rookie.token }); if (r.body.success) break; }
const spSponsor = await meOf(sponsor.token);
assert.equal(spSponsor.cash, sponsorBefore + 2500, 'the sponsor gets the early spark ($2500) — fast feedback before full qualification');
assert.equal(spSponsor.omr, 0, 'the spark is cash only (no $OMR until the full gate)');
assert.equal(spSponsor.recruits, 0, 'the spark does not advance the recruiter ladder (that is full qualification)');
assert.equal((await pool.query(`SELECT ref_spark FROM account_persistent WHERE account_id=(SELECT account_id FROM characters WHERE id='${rookie.id}')`)).rows[0].ref_spark, true, 'ref_spark latched');
// red-team R28: the spark (the cheapest referral cash faucet) must flag a same-IP pair for mod review,
// at parity with the qualify path — both test accounts share 127.0.0.1, so the flag must have fired.
{
  const sf = (await pool.query(`SELECT props FROM telemetry WHERE event='referral_same_ip_flag' AND account_id=(SELECT account_id FROM characters WHERE id='${rookie.id}')`)).rows[0];
  const sp = sf && (typeof sf.props === 'string' ? JSON.parse(sf.props) : sf.props);
  assert(sp && sp.spark === true, 'a same-IP spark pair is flagged for review (parity with qualify)');
}
await call('POST', '/v1/crimes/pick', { token: rookie.token }); // once ever
assert.equal((await meOf(sponsor.token)).cash, sponsorBefore + 2500, 'the spark fires once, not per-action');

// ── referrals (§7.13): all four gates, atomic payout, milestone, exclusions ──
const mentor = await mk('Mentor Max');
const recruit = await mk('Fresh Blood', 'Mentor Max');
assert(Number((await pool.query('SELECT COUNT(*) n FROM referrals')).rows[0].n) >= 1, 'referral graph row written');
await seedCh(recruit.id, 'respect=1000, lc_crime=39, cash=30000, nerve=50, energy=200');
await pool.query(`UPDATE account_persistent SET checkins_lifetime=3 WHERE account_id = (SELECT account_id FROM characters WHERE id='${recruit.id}')`);
const mentorCashBefore = (await meOf(mentor.token)).cash;
for (let i = 0; i < 20; i++) { // the 40th CLEAN job crosses the last gate — retry the odd fumble
  await seedCh(recruit.id, 'nerve=50, energy=200, jail_until=NULL');
  r = await call('POST', '/v1/crimes/pick', { token: recruit.token });
  if (r.body.success) break;
}
assert(r.body.success, 'the recruit landed the qualifying job');
me = await meOf(recruit.token);
// THE $OMR IS RETIRED (founder-directed 2026-07-31). A referral pays cash and THE CREW BONUS now,
// and this asserts the retirement rather than merely not checking for it — an endpoint that still
// pays is exactly what a dropped assertion would hide.
assert.equal(me.omr, 0, 'the recruit gets NO $OMR — referrals no longer pay any');
const mentorMe = await meOf(mentor.token);
assert.equal(mentorMe.cash, mentorCashBefore + 2500 + 10000 + 5000, 'recruiter: the spark ($2500) + full recruiter ($10k) + first-blood milestone ($5k) — a fast-forward recruit crosses both gates at once');
assert.equal(mentorMe.omr, 0, 'and neither does the recruiter');
assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM transactions WHERE currency='omr' AND reason LIKE 'referral:%'")).rows[0].n),
  0, 'not one $OMR ledger row anywhere in the referral machinery');
assert.equal(mentorMe.recruits, 1, 'ladder advanced');

// ── THE CREW BONUS: what replaces the $OMR ─────────────────────────────────────────────────────
// A qualified recruit makes their recruiter earn respect faster, scaled by how far the recruit has
// got: level 5 → +5%, level 10 → +10%, and so on in whole steps of REF_XP.STEP_LEVELS.
{
  // Push the recruit up the ladder first. This is not decoration: `pick` pays 2 respect, and at a
  // small bonus `Math.round(2 * 1.1)` is still 2 — the comparison below would pass whether or not
  // the multiplier were applied at all. (It did: the first cut of this block survived a mutation
  // that deleted the multiplier outright.) A bonus big enough to move a 2-rep job is what makes the
  // assertion capable of failing. It also proves the bonus is LIVE — the recruit levelling up is
  // what raised it, with nothing re-qualified.
  await seedCh(recruit.id, `respect=${10 * (50 - 1) ** 2}`); // level 50 → 10 steps → +50%
  const lvl = levelOf(Number((await pool.query(`SELECT respect FROM characters WHERE id='${recruit.id}'`)).rows[0].respect));
  const expect = Math.floor(lvl / M4.REF_XP.STEP_LEVELS) * M4.REF_XP.PER_STEP;
  assert(expect > 0, `the seeded recruit is past the first step (level ${lvl})`);
  assert.equal((await meOf(mentor.token)).crewBonusPct, Math.round(expect * 100),
    'the sheet shows the bonus their crew is currently worth — recomputed live, so levelling the recruit moved it');

  // and it is APPLIED, not merely displayed: the same job pays the mentor more than a stranger.
  const loner = await mk('Solo Sal');
  const jobRep = async (t, id) => {
    await seedCh(id, 'nerve=50, energy=200, jail_until=NULL, heat=0');
    const before = Number((await pool.query(`SELECT respect FROM characters WHERE id='${id}'`)).rows[0].respect);
    let res; for (let i = 0; i < 20; i++) { // retry the odd fumble — a bust pays no respect
      await seedCh(id, 'nerve=50, energy=200, jail_until=NULL');
      res = await call('POST', '/v1/crimes/pick', { token: t });
      if (res.body.success) break;
    }
    assert(res.body.success, 'landed a clean job to measure respect on');
    return Number((await pool.query(`SELECT respect FROM characters WHERE id='${id}'`)).rows[0].respect) - before;
  };
  await seedCh(mentor.id, 'respect=1000');
  const mentorGain = await jobRep(mentor.token, mentor.id);
  const lonerGain = await jobRep(loner.token, loner.id);
  // `pick` pays a fixed rep, so the only difference is the multiplier.
  assert.equal(mentorGain, Math.round(lonerGain * (1 + expect)),
    `the recruiter earns ${Math.round(expect * 100)}% more respect for the same job (${mentorGain} vs ${lonerGain})`);
  // …and they are genuinely different numbers. Without this the equality above can be satisfied by a
  // bonus small enough to round away, which is how the first version of this block went vacuous.
  assert(mentorGain > lonerGain, `the bonus has to be visible in the number (${mentorGain} vs ${lonerGain})`);
}
assert((await call('GET', '/v1/notifications', { token: mentor.token })).body.notifications.some((n) => n.type === 'ref'), 'recruiter notified');
assert(Number((await pool.query('SELECT COUNT(*) n FROM referrals WHERE qualified_at IS NOT NULL')).rows[0].n) >= 1, 'qualification recorded');
// once ever: further actions pay nothing more
await call('POST', '/v1/crimes/pick', { token: recruit.token });
assert.equal((await meOf(mentor.token)).recruits, 1, 'qualification fires once');
// agent-flagged recruits never pay out
const bot = await mk('Bot Barlow', 'Mentor Max');
await pool.query(`UPDATE account_persistent SET agent_flag=true, checkins_lifetime=3 WHERE account_id = (SELECT account_id FROM characters WHERE id='${bot.id}')`);
await seedCh(bot.id, 'respect=1000, lc_crime=40, cash=30000, nerve=50, energy=200');
await call('POST', '/v1/crimes/pick', { token: bot.token });
assert.equal((await meOf(mentor.token)).recruits, 1, 'agent accounts excluded from referral payouts');

// ── THE RECRUITERS boards (§7.13 status): individual hall of fame + family recruitment ──
const lb = (await call('GET', '/v1/leaderboard/recruiters', { token: mentor.token })).body;
const mm = lb.recruiters.find((r) => r.name === 'Mentor Max');
assert(mm && mm.recruits === 1, 'the recruiter appears on the board with their recruit count');
assert.equal(mm.rank, 'First Blood Brought In', 'the milestone rank surfaces on the board');
assert(!lb.recruiters.some((r) => r.agent), 'agent recruiters never appear (they never bump recruits)');
// family recruitment board: put the mentor in a gang and their count feeds the family total
await seedCh(mentor.id, 'cash=200000, respect=1000, energy=200, nerve=50, jail_until=NULL');
await call('POST', '/v1/gangs', { token: mentor.token, body: { name: 'The Rainmakers', tag: 'RAIN' } });
const lb2 = (await call('GET', '/v1/leaderboard/recruiters', { token: mentor.token })).body;
const fam = lb2.families.find((f) => f.name === 'The Rainmakers');
assert(fam && fam.recruits === 1 && fam.members >= 1, 'the family recruitment board sums the roster\'s recruits');

// ── THE LATE CLAIM (the growth-funnel fix): type who sent you — at creation OR in your first days ──
// (1) a TYPED code in the WRONG CASE still credits at creation, and the response says so
const acctOf = async (id) => (await pool.query(`SELECT account_id a FROM characters WHERE id='${id}'`)).rows[0].a;
{
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  const cr = await call('POST', '/v1/character', { token, body: { name: 'Typo Tony', referralCode: 'mentor max' } });
  assert.equal(cr.body.referral, 'credited', 'a wrong-case typed code still credits (exact-then-CI match)');
  const tid = (await meOf(token)).id;
  const rb = (await pool.query(`SELECT referred_by FROM account_persistent WHERE account_id='${await acctOf(tid)}'`)).rows[0];
  assert.equal(rb.referred_by, await acctOf(mentor.id), 'referred_by points at the recruiter');
}
// (2) an unknown code never blocks creation — but the response says it missed (no silent drop)
{
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  const cr = await call('POST', '/v1/character', { token, body: { name: 'Lost Larry', referralCode: 'Nobody Nowhere' } });
  assert.equal(cr.code, 200, 'an unknown code never blocks stepping out');
  assert.equal(cr.body.referral, 'unknown', 'the client is told the code missed');
}
// (3) the late claim: skipped the field → name them from Start Here, inside the window
const late = await mk('Late Lucy'); // no code at creation
let obLate = await call('GET', '/v1/onboard', { token: late.token });
assert.equal(obLate.body.referral.canClaim, true, 'the board offers the who-sent-you card in the window');
assert(obLate.body.referral.windowSeconds > 0, 'with a live countdown');
r = await call('POST', '/v1/referral/claim', { token: late.token, body: { code: 'MENTOR MAX' } });
assert.equal(r.code, 200, 'the late claim lands');
assert.equal(r.body.referrer, 'Mentor Max', 'and names the recruiter it resolved');
assert.equal((await pool.query(`SELECT referred_by FROM account_persistent WHERE account_id='${await acctOf(late.id)}'`)).rows[0].referred_by,
  await acctOf(mentor.id), 'late attribution set referred_by — the whole §7.13 machinery reads it from here');
assert(Number((await pool.query(`SELECT COUNT(*) n FROM referrals WHERE recruit_account='${await acctOf(late.id)}'`)).rows[0].n) === 1, 'the referral graph row written');
obLate = await call('GET', '/v1/onboard', { token: late.token });
assert.equal(obLate.body.referral.referred, true, 'the board reflects it'); assert.equal(obLate.body.referral.canClaim, false, 'and stops offering the card');
// (4) the gates: once ever · not yourself · a real name · only in the first days
assert.equal((await call('POST', '/v1/referral/claim', { token: late.token, body: { code: 'Stringer Bell' } })).body.error, 'already_referred', 'once ever');
const gated = await mk('Gated Gary');
assert.equal((await call('POST', '/v1/referral/claim', { token: gated.token, body: { code: 'gated gary' } })).body.error, 'self', 'not yourself');
assert.equal((await call('POST', '/v1/referral/claim', { token: gated.token, body: { code: 'Nobody Nowhere' } })).body.error, 'unknown_code', 'a real living name only');
assert.equal((await call('POST', '/v1/referral/claim', { token: gated.token, body: {} })).body.error, 'no_code', 'a name is required');
await pool.query(`UPDATE accounts SET created_at = now() - interval '4 days' WHERE id='${await acctOf(gated.id)}'`);
assert.equal((await call('POST', '/v1/referral/claim', { token: gated.token, body: { code: 'Mentor Max' } })).body.error, 'window', 'the first-days window closes');

// ── THE RECRUITMENT DRIVE ("the push"): a mod-started window doubles referral CASH ──
await app.inject({ method: 'POST', url: '/v1/mod/referral/push', payload: { hours: 6, mult: 2 }, headers: { 'x-mod-key': 'test-mod-key' } });
const drive = (await call('GET', '/v1/leaderboard/recruiters', { token: mentor.token })).body.push;
assert(drive.active && drive.mult === 2 && drive.seconds > 0, 'the drive is live + publicly visible on the board');
const dMentor = await mk('Drive Dana');
const dRecruit = await mk('Doubled Danny', 'Drive Dana');
await seedCh(dRecruit.id, 'respect=1000, lc_crime=39, cash=30000, nerve=50, energy=200');
await pool.query(`UPDATE account_persistent SET checkins_lifetime=3 WHERE account_id=(SELECT account_id FROM characters WHERE id='${dRecruit.id}')`);
const dMentorBefore = (await meOf(dMentor.token)).cash;
for (let i = 0; i < 20; i++) { await seedCh(dRecruit.id, 'nerve=50, energy=200, jail_until=NULL'); r = await call('POST', '/v1/crimes/pick', { token: dRecruit.token }); if (r.body.success) break; }
const dMentorMe = await meOf(dMentor.token);
assert.equal(dMentorMe.cash, dMentorBefore + (2500 + 10000 + 5000) * 2, 'the drive DOUBLES the recruiter cash (spark + full + milestone)');
assert.equal(Number((await pool.query(`SELECT amount FROM transactions WHERE character_id='${dRecruit.id}' AND reason='referral:recruit'`)).rows[0].amount), 10000, 'the recruit side is doubled too ($5k → $10k) — and ledgered');
assert.equal(dMentorMe.omr, 0, 'the drive multiplies CASH and nothing else — there is no $OMR left to multiply');
await pool.query('UPDATE referral_push SET until=NULL, mult=1 WHERE id=1'); // end the drive — later payouts back to base

// ── TIER-2 "the family tree": a BOUNDED one-time finder's fee to the grandrecruiter (anti-MLM: flat, not %) ──
const gTony = await mk('Grand Tony');                    // A — the grandrecruiter (root)
const mMike = await mk('Middle Mike', 'Grand Tony');     // R — brought in by A
const bBenny = await mk('Bottom Benny', 'Middle Mike');  // R2 — brought in by R
// the middle link must ITSELF qualify (audit: every level of the tree is a real made man) — qualify Mike first
await seedCh(mMike.id, 'respect=1000, lc_crime=39, cash=30000, nerve=50, energy=200');
await pool.query(`UPDATE account_persistent SET checkins_lifetime=3 WHERE account_id=(SELECT account_id FROM characters WHERE id='${mMike.id}')`);
for (let i = 0; i < 20; i++) { await seedCh(mMike.id, 'nerve=50, energy=200, jail_until=NULL'); r = await call('POST', '/v1/crimes/pick', { token: mMike.token }); if (r.body.success) break; }
assert.equal((await pool.query(`SELECT ref_paid FROM account_persistent WHERE account_id=(SELECT account_id FROM characters WHERE id='${mMike.id}')`)).rows[0].ref_paid, true, 'the middle link qualified');
await seedCh(bBenny.id, 'respect=1000, lc_crime=39, cash=30000, nerve=50, energy=200');
await pool.query(`UPDATE account_persistent SET checkins_lifetime=3 WHERE account_id=(SELECT account_id FROM characters WHERE id='${bBenny.id}')`);
const tonyMe0 = await meOf(gTony.token); // captured AFTER Mike's qualification already paid Tony
const tonyBefore = tonyMe0.cash, tonyOmrBefore = tonyMe0.omr;
for (let i = 0; i < 20; i++) { await seedCh(bBenny.id, 'nerve=50, energy=200, jail_until=NULL'); r = await call('POST', '/v1/crimes/pick', { token: bBenny.token }); if (r.body.success) break; }
const tonyAfter = await meOf(gTony.token);
assert.equal(tonyAfter.cash, tonyBefore + 5000, 'the grandrecruiter earns the one-time tier-2 fee ($5k) when their recruit\'s recruit qualifies');
assert.equal(tonyAfter.omr, tonyOmrBefore, 'tier-2 adds NO $OMR — CASH ONLY (the anti-MLM/legal line)');
assert.equal((await pool.query(`SELECT ref_l2_paid FROM account_persistent WHERE account_id=(SELECT account_id FROM characters WHERE id='${bBenny.id}')`)).rows[0].ref_l2_paid, true, 'the tier-2 latch is set');
assert.equal(Number((await pool.query(`SELECT amount FROM transactions WHERE character_id='${gTony.id}' AND reason='referral:tier2'`)).rows[0].amount), 5000, 'the tier-2 fee is ledgered referral:tier2');
await call('POST', '/v1/crimes/pick', { token: bBenny.token });
assert.equal((await meOf(gTony.token)).cash, tonyBefore + 5000, 'the tier-2 fee fires once, not per-action');

// ── BRING ONE: a qualified recruit who runs in their recruiter's crew earns BOTH a bonus ──
// (the first-crewmate incentive, gated behind the whole §7.13 qualification wall — so it inherits
// every anti-Sybil property; a crewmate can't collect it any faster than a real recruit qualifies).
const boBoss = await mk('Crew Boss Vito');
const boFriend = await mk('Crew Friend Sal', 'Crew Boss Vito');
// put them in the same crew — seed the rows directly (the createCrew level gate is not under test)
const boCrewId = 'crew-bringone-test';
await pool.query(`INSERT INTO crews (id, name, leader_account) VALUES ('${boCrewId}', 'The Test Crew', '${await acctOf(boBoss.id)}')`);
await pool.query(`INSERT INTO crew_members (crew_id, account_id, name) VALUES ('${boCrewId}', '${await acctOf(boBoss.id)}', 'Crew Boss Vito'), ('${boCrewId}', '${await acctOf(boFriend.id)}', 'Crew Friend Sal')`);
await seedCh(boFriend.id, 'respect=1000, lc_crime=39, cash=30000, nerve=50, energy=200');
await pool.query(`UPDATE account_persistent SET checkins_lifetime=3 WHERE account_id='${await acctOf(boFriend.id)}'`);
for (let i = 0; i < 20; i++) { await seedCh(boFriend.id, 'nerve=50, energy=200, jail_until=NULL'); r = await call('POST', '/v1/crimes/pick', { token: boFriend.token }); if (r.body.success) break; }
assert.equal((await pool.query(`SELECT ref_paid FROM account_persistent WHERE account_id='${await acctOf(boFriend.id)}'`)).rows[0].ref_paid, true, 'the crewmate recruit qualified');
const boRecruitRow = (await pool.query(`SELECT amount FROM transactions WHERE character_id='${boFriend.id}' AND reason='crew:bringone'`)).rows[0];
const boBossRow = (await pool.query(`SELECT amount FROM transactions WHERE character_id='${boBoss.id}' AND reason='crew:bringone'`)).rows[0];
assert(boRecruitRow, 'a crewmate recruit collects the Bring One bonus');
assert.equal(Number(boRecruitRow.amount), 7500, 'the recruit side is BRING_ONE.RECRUIT_CASH');
assert.equal(Number(boBossRow.amount), 15000, 'the recruiter side is BRING_ONE.RECRUITER_CASH');

// control: a qualified recruit who is NOT in the recruiter's crew gets NO Bring One bonus
const soloBoss = await mk('Solo Boss Nick');
const soloFriend = await mk('Solo Friend Ray', 'Solo Boss Nick');
await seedCh(soloFriend.id, 'respect=1000, lc_crime=39, cash=30000, nerve=50, energy=200');
await pool.query(`UPDATE account_persistent SET checkins_lifetime=3 WHERE account_id='${await acctOf(soloFriend.id)}'`);
for (let i = 0; i < 20; i++) { await seedCh(soloFriend.id, 'nerve=50, energy=200, jail_until=NULL'); r = await call('POST', '/v1/crimes/pick', { token: soloFriend.token }); if (r.body.success) break; }
assert.equal((await pool.query(`SELECT ref_paid FROM account_persistent WHERE account_id='${await acctOf(soloFriend.id)}'`)).rows[0].ref_paid, true, 'the solo recruit still qualified (the referral pays regardless)');
assert.equal((await pool.query(`SELECT COUNT(*) n FROM transactions WHERE character_id='${soloFriend.id}' AND reason='crew:bringone'`)).rows[0].n, '0', 'NO Bring One bonus without a shared crew — the crew bonus is the crew-run reward, not the referral');

// §10.4: crew:bringone is in the cash vocabulary + the qualify txn reconciles per character
{
  const { runLedgerInvariants } = await import('../src/invariants.js');
  const inv = await runLedgerInvariants(pool, { alert: false });
  assert(inv.checks.find((c) => c.name === 'reason vocabulary').ok, 'crew:bringone must not trip the vocabulary alarm');
}

// ── MY PROFILE — the MySpace page: identity + referral tracking + LEDGER-EXACT earnings ──
// Mentor Max's whole referral history fired above through the REAL machinery (spark + qualify +
// milestone, plus two attribution-only recruits and one agent), so every figure here is earned,
// never SQL-seeded — the profile must read the ledger back exactly.
{
  const p = (await call('GET', '/v1/profile', { token: mentor.token })).body;
  assert.equal(p.name, 'Mentor Max', 'the profile is mine');
  assert(p.memberSince && p.days >= 0, 'member-since rides accounts.created_at');
  assert.equal(p.generation, 1, 'first of the line');
  assert(typeof p.mood === 'string' && p.mood.length, 'a derived mood line');
  assert(typeof p.spinning === 'string' && p.spinning.includes('—'), 'the now-spinning record (seeded per account+day)');
  assert.equal(p.family?.name, 'The Rainmakers', 'the family shows');
  assert.equal(typeof p.hitmanRank, 'string', 'the assassin rank resolves to a real title');
  assert(typeof p.honorTier === 'string' && p.honorTier.length, 'the honor tier resolves');
  // referral tracking: 4 brought in (Fresh Blood, agent Bot Barlow, Typo Tony, Lost Larry), 1 qualified
  assert.equal(p.code, 'Mentor Max', "the code IS the living name");
  assert(p.shareUrl.includes('x.com/intent/tweet'), 'a prefilled X intent');
  assert(p.profilePath.startsWith('/u/') && p.profilePath.includes('ref='), 'the frictionless ?ref deep link');
  assert.equal(p.recruitsTotal, 4, 'every soul brought in is on the list');
  assert.equal(p.recruitsQualified, 1, 'one made it all the way');
  assert.equal(p.recruitsSparked, 1, 'one sparked (the agent never sparks)');
  assert.equal(p.recruitsLifetime, 1, 'the ladder count');
  assert.equal(p.recruitRank, 'First Blood Brought In', 'the milestone rank');
  // THE TAKE — ledger-exact: spark $2500 + recruiter $10k + first-blood milestone $5k
  assert.equal(p.earnedCash, 17500, 'earned cash reads the ledger back exactly');
  assert.equal(p.earnedOmr, 0, 'earned $OMR is 0 — referrals pay none since the 2026-07-31 retirement (the sum stays for databases holding pre-retirement rows)');
  // THE CREW BONUS is what the take box shows instead: a live percentage off the recruits' levels.
  assert(p.crewBonusPct > 0, 'the profile shows the respect bonus the crew is currently worth');
  assert.equal(p.crewBonusPct, (await meOf(mentor.token)).crewBonusPct, 'and it agrees with the sheet — one helper, one number');
  const fb = p.recruits.find((x) => x.name === 'Fresh Blood');
  assert(fb && fb.qualified && fb.sparked && fb.alive, 'the qualified recruit is fully flagged');
  assert.equal(fb.earnedCash, 12500, 'per-recruit attribution via counterparty (spark + recruiter; milestones are ladder-level)');
  assert.equal(p.recruits[0].name, 'Fresh Blood', 'qualified recruits lead the Top 8');
}
// the RECRUIT's side: their own welcome money is NEVER "earnings from recruiting"
{
  const p = (await call('GET', '/v1/profile', { token: recruit.token })).body;
  assert.equal(p.sentBy, 'Mentor Max', 'the profile names who sent you');
  assert.equal(p.referred, true, 'referred flag');
  assert.equal(p.earnedCash, 0, "the recruit's own referral:recruit welcome cash is excluded");
  assert.equal(p.earnedOmr, 0, 'the +1 $OMR welcome bonus is excluded (both sides share referral:fund)');
  assert.equal(p.recruitsTotal, 0, 'no crew of their own yet');
}
// tier-2 counts as recruiting income (ladder-level, un-attributed per head)
{
  const p = (await call('GET', '/v1/profile', { token: gTony.token })).body;
  assert.equal(p.earnedCash, 17500 + 5000, "Grand Tony's take includes the tier-2 finder's fee");
  const mike = p.recruits.find((x) => x.name === 'Middle Mike');
  assert.equal(mike.earnedCash, 12500, 'per-head attribution stays spark+recruiter only');
}

// ── IDENTITY — the free "about me" blurb (status text, §10.4-free) ──
{
  const ida = await mk('Identity Ida');
  const before = Number((await pool.query(`SELECT COUNT(*) n FROM transactions WHERE character_id='${ida.id}'`)).rows[0].n);
  // set it (HTML/control chars stripped, clamped to BIO_MAX)
  let r2 = await call('POST', '/v1/identity/bio', { token: ida.token, body: { bio: '  I ran the docks before you were <b>born</b>.  ' } });
  assert.equal(r2.body.ok, true, 'bio set');
  assert(!/[<>]/.test(r2.body.bio), 'HTML is stripped from the bio (stored-XSS discipline)');
  assert.equal((await meOf(ida.token)).bio, r2.body.bio, 'the view surfaces the bio');
  assert.equal((await call('GET', '/v1/profile', { token: ida.token })).body.bio, r2.body.bio, 'My Profile surfaces the bio');
  // clamp
  const longBio = 'x'.repeat(500);
  r2 = await call('POST', '/v1/identity/bio', { token: ida.token, body: { bio: longBio } });
  assert(r2.body.bio.length <= 200, 'the bio is clamped to BIO_MAX (200)');
  // clearing it goes back to the auto-blurb
  r2 = await call('POST', '/v1/identity/bio', { token: ida.token, body: { bio: '' } });
  assert.equal(r2.body.bio, null, 'an empty bio clears it (free — back to the auto-blurb)');
  assert.equal((await meOf(ida.token)).bio, null, 'the cleared bio is null in the view');
  // §10.4: setting a bio moves no value — zero new ledger rows across the whole flow
  const after = Number((await pool.query(`SELECT COUNT(*) n FROM transactions WHERE character_id='${ida.id}'`)).rows[0].n);
  assert.equal(after, before, 'IDENTITY writes ZERO ledger rows — it is status text, not a faucet');
}

// ── DAILY SOCIAL TASKS ("Spread the Word") — the organic-growth petty-cash faucet ──
const promoter = await mk('Promoter Pete');
let sw = (await call('GET', '/v1/social', { token: promoter.token })).body;
assert.equal(sw.enabled, true, 'trust mode → word-of-mouth rewards are live');
assert.equal(sw.tasks.length, SOCIAL_TASKS.TASKS.length, 'the board lists every task');
assert.equal(sw.code, 'Promoter Pete', "the share code is the player's living name");
assert(sw.tasks[0].share.includes('x.com'), 'each task carries a prefilled share intent');
assert.equal(sw.tasks[0].claimed, false, 'nothing claimed yet');
const swCashBefore = (await meOf(promoter.token)).cash;
// THE 4-HOUR STAND: the first claim only REGISTERS the share — no cash until it matures
r = await call('POST', '/v1/social/sw_post/claim', { token: promoter.token, body: { proof: 'https://x.com/pete/status/12345678901234' } });
assert.equal(r.code, 200); assert.equal(r.body.pending, true, 'the first claim registers, it does not pay');
assert(r.body.matureSeconds > 0, 'the clock is running');
assert.equal((await meOf(promoter.token)).cash, swCashBefore, 'no cash before the post has stood');
let swb = (await call('GET', '/v1/social', { token: promoter.token })).body;
assert.equal(swb.tasks.find((t) => t.id === 'sw_post').state, 'pending', 'the board shows the stand clock');
r = await call('POST', '/v1/social/sw_post/claim', { token: promoter.token });
assert.equal(r.body.pending, true, 'claiming early just reports the clock — never pays');
// mature the post (backdate the registration past SOCIAL_MATURE_MS) → the claim PAYS
const matureSw = (id, task) => pool.query(
  `UPDATE social_claims SET posted_at = $2 WHERE account_id=(SELECT account_id FROM characters WHERE id='${id}') AND task_id=$1 AND NOT paid`,
  [task, new Date(Date.now() - 5 * 3600000)]);
await matureSw(promoter.id, 'sw_post');
r = await call('POST', '/v1/social/sw_post/claim', { token: promoter.token });
assert.equal(r.code, 200); assert.equal(r.body.cash, SOCIAL_TASKS.CASH, 'a matured share pays the petty cash');
assert.equal((await meOf(promoter.token)).cash, swCashBefore + SOCIAL_TASKS.CASH, 'the cash landed');
assert.equal((await call('GET', '/v1/social', { token: promoter.token })).body.tasks.find((t) => t.id === 'sw_post').claimed, true, 'the board marks it done today');
assert.equal((await call('POST', '/v1/social/sw_post/claim', { token: promoter.token })).body.error, 'claimed', 'once per day per task');
await call('POST', '/v1/social/sw_invite/claim', { token: promoter.token });
await matureSw(promoter.id, 'sw_invite');
await call('POST', '/v1/social/sw_invite/claim', { token: promoter.token });
await call('POST', '/v1/social/sw_boost/claim', { token: promoter.token });
await matureSw(promoter.id, 'sw_boost');
r = await call('POST', '/v1/social/sw_boost/claim', { token: promoter.token });
assert.equal(r.body.allDone, true, 'the last matured task completes the day');
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
// (red-team R20) 'trust' is an honor-system faucet that must FAIL CLOSED in production (mirror verify.js) —
// a prod server that forgot SOCIAL_VERIFY_MODE=live pays nobody, not the whole base on zero proof. Direct
// unit-check (no API call between the env flip + restore, so the running server is unaffected).
process.env.SOCIAL_VERIFY_MODE = 'trust'; process.env.NODE_ENV = 'production';
assert.equal(socialRewardsLive(), false, "'trust' is not live in production (fail-closed)");
delete process.env.NODE_ENV;
assert.equal(socialRewardsLive(), true, "'trust' stays live in the alpha (non-production)");

// ══════════ REFERRAL / X-RECRUITMENT FIXES ══════════
// ── FIX M2: the Spread-the-Word share URL is the FRICTIONLESS /u/<name>?ref=<name> deep link (was the
// bare domain, forcing a recruit to type the code) — a tapped daily-task tweet now auto-credits the sharer.
{
  const u = socialShareUrl('tweet', 'Promoter Pete');
  const inner = decodeURIComponent((u.match(/[?&]url=([^&]+)/) || [])[1] || '');
  assert(inner.includes('/u/Promoter') && inner.includes('ref=Promoter'), `the share URL carries the auto-crediting ?ref deep link (${inner})`);
  assert(!socialShareUrl('tweet', '').includes('/u/'), 'a nameless share falls back to the bare domain');
  assert(/x\.com\/OmertaOnRH/i.test(SOCIAL_LINKS.ob_x), 'SOCIAL_LINKS.ob_x resolves to the OMERTÀ handle');
}
// ── FIX L1: the First-Week "Follow on X" task points at the OMERTÀ handle, not the bare x.com homepage.
{
  const ob = (await call('GET', '/v1/onboard', { token: promoter.token })).body;
  const obx = (ob.tasks || []).find((t) => t.id === 'ob_x');
  assert(obx && /x\.com\/OmertaOnRH/i.test(obx.social), `the First-Week X task links to the handle (${obx && obx.social})`);
}
// ── FIX H1/H2: Spread-the-Word in LIVE verify mode — a share needs a POST LINK to pay (H1), and the post
// must come from the player's LINKED X account (H2 author-binding, previously dead code off the claim path).
// Stub the X API so the check is deterministic (no network). ──
{
  process.env.SOCIAL_VERIFY_MODE = 'live'; process.env.X_BEARER_TOKEN = 'test-bearer';
  const realFetch = global.fetch;
  let stubAuthor = '777';
  global.fetch = async () => ({ status: 200, ok: true, json: async () => ({ data: { id: '12345678901234', author_id: stubAuthor } }) });
  try {
    // H1: a share registered with NO proof can NEVER pay in live mode (the exact production break — the
    // old client posted an empty body, so verifyPostUp(null) threw need_proof and nobody was ever paid).
    const noProof = await mk('No-Proof Ned');
    await call('POST', '/v1/social/sw_post/claim', { token: noProof.token }); // register, no proof (the old client)
    await matureSw(noProof.id, 'sw_post');
    assert.equal((await call('POST', '/v1/social/sw_post/claim', { token: noProof.token })).body.error, 'need_proof',
      'live mode: a proof-less share can never pay — the client now sends the post link');
    // H2: an X-linked account whose post comes from THEIR handle pays (author-binding satisfied on the real path)
    const linked = await mk('Linked Lou');
    const linkedAcct = (await pool.query(`SELECT account_id a FROM characters WHERE id='${linked.id}'`)).rows[0].a;
    await pool.query(`UPDATE accounts SET auth_provider='x', auth_subject='777' WHERE id='${linkedAcct}'`);
    stubAuthor = '777';
    await call('POST', '/v1/social/sw_post/claim', { token: linked.token, body: { proof: 'https://x.com/lou/status/12345678901234' } });
    await matureSw(linked.id, 'sw_post');
    assert.equal((await call('POST', '/v1/social/sw_post/claim', { token: linked.token })).body.cash, SOCIAL_TASKS.CASH,
      'live mode: a matured post from the linked X account pays (H2 author-binding wired through the claim path)');
    // H2: registering someone ELSE's tweet (a different author_id) pays NOTHING
    const faker = await mk('Faker Frank');
    const fakerAcct = (await pool.query(`SELECT account_id a FROM characters WHERE id='${faker.id}'`)).rows[0].a;
    await pool.query(`UPDATE accounts SET auth_provider='x', auth_subject='888' WHERE id='${fakerAcct}'`);
    stubAuthor = '999'; // the post is NOT Frank's
    await call('POST', '/v1/social/sw_post/claim', { token: faker.token, body: { proof: 'https://x.com/celeb/status/12345678901234' } });
    await matureSw(faker.id, 'sw_post');
    assert.equal((await call('POST', '/v1/social/sw_post/claim', { token: faker.token })).body.error, 'not_your_post',
      "live mode binds the post to the player's linked X account (registering a celebrity's tweet earns nothing)");
  } finally {
    global.fetch = realFetch; delete process.env.X_BEARER_TOKEN; process.env.SOCIAL_VERIFY_MODE = 'trust';
  }
}

// ── LIVE MODE WITH NOTHING TO VERIFY WITH — the configuration production actually shipped in ──────
// render.yaml set SOCIAL_VERIFY_MODE=live (correct) and no X token (not). Every social
// claim then threw `verify_unavailable`: the Spread-the-Word cash faucet paid nobody, and 2 of the 8
// First-Week tasks were listed-but-unclaimable, which made the all-done capstone UNREACHABLE. Nothing
// announced it — no boot error, no dashboard row, and the suite only ever ran `trust`, which is why
// the tests were green over a dead growth loop for weeks.
//
// The rule now: a check the server cannot perform is not offered. Asserted here in the exact broken
// configuration, so it cannot come back.
{
  const prevMode = process.env.SOCIAL_VERIFY_MODE;
  process.env.SOCIAL_VERIFY_MODE = 'live';                  // …and deliberately NO tokens
  delete process.env.X_BEARER_TOKEN; delete process.env.X_TARGET_USER_ID;
  try {
    const dud = await mk('Unverified Ulla');
    const board = (await call('GET', '/v1/onboard', { token: dud.token })).body;
    assert.equal(board.total, 6, 'the unverifiable social task is DROPPED, not offered and refused');
    assert.equal(board.tasks.some((t) => t.id === 'ob_x'), false,
      'the follow task does not appear on a server that cannot check it');
    // the capstone is now REACHABLE: every remaining task is one this player can actually finish
    assert.equal((await call('POST', '/v1/onboard/ob_x/claim', { token: dud.token })).body.error, 'task_unavailable',
      'and claiming one says why, instead of the generic verify_unavailable');

    // the Spread-the-Word faucet reports itself OFF rather than taking registrations it can never settle
    const sw = await call('POST', '/v1/social/sw_post/claim', { token: dud.token, body: { proof: 'https://x.com/x/status/12345678901234' } });
    assert.equal(sw.body.error, 'social_off', 'live-without-a-token pays nobody, and SAYS so up front');

    // and the founder can see it without reading a log: /admin's Growth-loop panel reads this
    const ov = (await app.inject({ method: 'GET', url: '/v1/mod/overview', headers: { 'x-mod-key': 'test-mod-key' } })).json();
    assert.equal(ov.social.rewardsLive, false, 'the ops dashboard reports the loop as NOT PAYING');
    assert.equal(ov.social.mode, 'live', '…while still reporting the configured mode honestly');
    assert.deepEqual([ov.social.posts, ov.social.x], [false, false],
      'per-provider capability is surfaced, so it is obvious WHICH token is missing');

    // WHERE SHARE LINKS POINT. A live server ran with PUBLIC_URL set (X sign-in needs it) and
    // SOCIAL_GAME_URL unset, so every referral link, brag prompt and card URL was built from the
    // hardcoded default — a domain that did not resolve. The growth loop looked healthy from inside
    // the process and mailed every recruit into thin air; only DNS knew. So the share base now
    // prefers the server's own origin, and preflight says so when neither is set.
    {
      const mod = await import('../src/rules.tail.js?share=' + Date.now());   // re-eval with env set
      // The fallback is now the LIVE origin (playomerta.com was unreachable — the very "into thin air"
      // failure above; the default itself was still the dead host until this was repointed).
      assert.equal(mod.SOCIAL_GAME_URL, 'https://www.omerta.fun', 'with neither var set, the live default stands');
      process.env.PUBLIC_URL = 'https://omerta.example.com';
      const withPub = await import('../src/rules.tail.js?share=' + (Date.now() + 1));
      assert.equal(withPub.SOCIAL_GAME_URL, 'https://omerta.example.com',
        "PUBLIC_URL alone is enough — share links follow the server's own origin");
      // socialShareUrl returns an X intent with the game link URL-encoded inside it. Pull it out of
      // `url` rather than regexing the whole string, so a stray substring can't pass. searchParams
      // decodes exactly ONE layer, and the player's name was already encoded when the link was built
      // — so the name stays percent-encoded here, and that is correct, not a bug to decode away.
      const intent = withPub.socialShareUrl('referral', 'Tony Two-Times');
      const inner = new URL(intent).searchParams.get('url') || '';  // searchParams already decodes
      assert.match(inner, /^https:\/\/omerta\.example\.com\/u\/Tony%20Two-Times\?ref=/,
        'and the referral deep link inside the share intent is built from it, not the built-in default');
      process.env.SOCIAL_GAME_URL = 'https://vanity.example.com';
      const withBoth = await import('../src/rules.tail.js?share=' + (Date.now() + 2));
      assert.equal(withBoth.SOCIAL_GAME_URL, 'https://vanity.example.com',
        'an explicit SOCIAL_GAME_URL still wins, for a separate marketing domain');
      delete process.env.PUBLIC_URL; delete process.env.SOCIAL_GAME_URL;
    }
    const { preflight: pf0 } = await import('../src/preflight.js');
    assert(pf0({ NODE_ENV: 'production', JWT_SECRET: 'a-real-jwt-secret-value-long-enough', MOD_KEY: 'y'.repeat(20),
      MARKET_SEED: 'YqB7#tR2vLx9Kp4Wm6Zn8Cf3Hj5Ds1Ge', SOCIAL_VERIFY_MODE: 'off', TRUST_PROXY: 'on' })
      .warnings.some((w) => /PUBLIC_URL/.test(w) && /referral link/.test(w)),
    'and with neither set, preflight warns that shares point at somebody else\'s domain');

    // preflight names the missing var rather than failing the boot (a fatal error here would take a
    // running server down to fix a dormant faucet — strictly worse than the dormant faucet)
    const { preflight } = await import('../src/preflight.js');
    const pf = preflight({ NODE_ENV: 'production', JWT_SECRET: 'a-real-jwt-secret-value-long-enough', MOD_KEY: 'y'.repeat(20),
      MARKET_SEED: 'YqB7#tR2vLx9Kp4Wm6Zn8Cf3Hj5Ds1Ge', SOCIAL_VERIFY_MODE: 'live', TRUST_PROXY: 'on' });
    assert.deepEqual(pf.errors, [], 'live-without-tokens must NOT be fatal');
    assert(pf.warnings.some((w) => /X_BEARER_TOKEN/.test(w) && /pays nobody/.test(w)),
      'but it must warn, naming the exact variable and the consequence');

    // ONE token changes the picture: posts verify, so the faucet is live again, while the FOLLOW check
    // still cannot run — so ob_x stays off the checklist. Per-capability, not all-or-nothing.
    process.env.X_BEARER_TOKEN = 'test-bearer';
    const partial = (await app.inject({ method: 'GET', url: '/v1/mod/overview', headers: { 'x-mod-key': 'test-mod-key' } })).json().social;
    assert.equal(partial.posts, true, 'a bearer token alone enables post checks');
    assert.equal(partial.x, false, '…but not the follow check, which also needs X_TARGET_USER_ID');
    assert.equal(partial.rewardsLive, true, 'so Spread-the-Word starts paying');
    assert.equal((await call('GET', '/v1/onboard', { token: dud.token })).body.total, 6,
      'ob_x is still dropped — the follow check is what it needs, and that is still unconfigured');

    // THE BOARD AND THE PAYOUT MUST AGREE. The first cut of this fix filtered the BOARD and left the
    // claim path computing its capstone over the unfiltered list — so the checklist read "complete"
    // and the capstone bonus never fired. A promise the UI makes and the ledger never keeps is worse
    // than the unreachable capstone it replaced. Drive the last offered task with the other five
    // already claimed, and require the money.
    delete process.env.X_BEARER_TOKEN;                       // back to the fully-unconfigured server
    const finisher = await mk('Capstone Cass');
    await pool.query(
      `UPDATE account_persistent SET onboard=$2 WHERE account_id=(SELECT account_id FROM characters WHERE id=$1)`,
      [finisher.id, JSON.stringify({ ob_boost: true, ob_bank: true, ob_path: true, ob_family: true, ob_wallet: true })]);
    const before = (await call('GET', '/v1/onboard', { token: finisher.token })).body;
    assert.equal(before.total, 6, 'six offered on this server');
    assert.equal(before.allDone, false, 'one to go');
    await seedCh(finisher.id, 'nerve=50, energy=200');       // the last one is a crime — go pull it
    for (let i = 0; i < 30; i++) {
      await seedCh(finisher.id, 'nerve=50, energy=200, jail_until=NULL');
      if ((await call('POST', '/v1/crimes/pick', { token: finisher.token })).body?.success) break;
    }
    const last = await call('POST', '/v1/onboard/ob_crime/claim', { token: finisher.token });
    assert.equal(last.body.capstone, true,
      'the capstone fires on the tasks THIS SERVER offers — not on two it can never verify');
    assert.equal(last.body.cash, 500 + CONSTANTS.ONBOARD_CAPSTONE.cash, 'and the bonus cash is actually paid');
    assert.equal((await call('GET', '/v1/onboard', { token: finisher.token })).body.allDone, true,
      'board and payout agree');

    // ── AND THE SECOND AXIS: CONFIGURED ON THE SERVER IS NOT THE SAME AS CLAIMABLE BY THIS PLAYER ──
    // The filter above asks "can the SERVER check this". It also has to ask "can it check THIS
    // ACCOUNT", because verification interrogates the provider about one specific player:
    // `ob_x` reads the follow list of acct.auth_subject, so it needs an X-signed-in account — a guest
    // was shown the task and got `verify_provider` on claim, leaving a reward on screen they could
    // never collect and stranding the capstone again. This is the exact configuration a live server
    // runs once X credentials are added, which is when it went live.
    process.env.X_BEARER_TOKEN = 'test-bearer';
    process.env.X_TARGET_USER_ID = '1234567890';
    const guest = await mk('Guest Gus');
    const gb = (await call('GET', '/v1/onboard', { token: guest.token })).body;
    assert.equal(gb.tasks.some((t) => t.id === 'ob_x'), false,
      'a GUEST is not offered "Follow on X" — the follow check reads an X identity they do not have');
    assert.equal(gb.total, 6, 'the guest checklist stays the six tasks they can actually finish');
    assert.equal((await call('POST', '/v1/onboard/ob_x/claim', { token: guest.token })).body.error,
      'task_unavailable', 'and claiming it anyway is refused with a reason, not a provider error');

    // an X-SIGNED-IN account DOES get it — the gate is identity, not a blanket ban
    await pool.query("UPDATE accounts SET auth_provider='x', auth_subject='555' WHERE id=(SELECT account_id FROM characters WHERE id=$1)", [guest.id]);
    const xb = (await call('GET', '/v1/onboard', { token: guest.token })).body;
    assert.equal(xb.tasks.some((t) => t.id === 'ob_x'), true,
      'the same player, signed in with X, IS offered the follow task');

    // …AND CAN ACTUALLY CLAIM IT. The deeper half of the same defect: `verifySocial` reads
    // `auth_provider`/`auth_subject` off whatever it is handed, and it was handed `h.acct` — the
    // account_persistent row, which has NEITHER column. So it compared `undefined !== 'x'` and threw
    // `verify_provider` at every player alive, and had it got past that it would have called
    // `/2/users/undefined/following`. Nothing caught it because the suite only ran `trust`, which
    // returns before either field is read. Stub X and assert the real id reaches the request.
    const realFetch2 = global.fetch;
    let askedFor = null;
    global.fetch = async (url) => {
      askedFor = String(url);
      return { ok: true, status: 200, json: async () => ({ data: [{ id: '1234567890' }] }) };
    };
    try {
      const claim = await call('POST', '/v1/onboard/ob_x/claim', { token: guest.token });
      assert.equal(claim.code, 200, 'an X-signed-in player who follows can finally claim the task');
      assert.match(askedFor || '', /\/2\/users\/555\/following/,
        'and X was asked about THIS account (555), not about `undefined`');
      // THE CALL BUDGET: a repeat check inside the window must cost ZERO outbound calls. The follow
      // path paginates up to 5 pages and a player who has NOT followed burns every one of them and
      // can click again immediately — that retry loop, not the happy path, is where paid credits go.
      const dud2 = await mk('Clicky Cliff');
      await pool.query("UPDATE accounts SET auth_provider='x', auth_subject='90210' WHERE id=(SELECT account_id FROM characters WHERE id=$1)", [dud2.id]);
      let calls = 0;
      global.fetch = async () => {                          // a follower list that never contains us
        calls += 1;
        return { ok: true, status: 200, json: async () => ({ data: [{ id: 'somebody-else' }] }) };
      };
      const first = await call('POST', '/v1/onboard/ob_x/claim', { token: dud2.token });
      assert.equal(first.body.error, 'verify_failed', 'not following → the check runs and says so');
      const spent = calls;
      assert(spent > 0, 'the first attempt really did ask X');
      const again = await call('POST', '/v1/onboard/ob_x/claim', { token: dud2.token });
      assert.equal(again.body.error, 'verify_cooldown', 'clicking again is answered from the database');
      assert.equal(calls, spent, `and cost NO further X calls (still ${spent})`);
      assert.match(again.body.message || '', /minute/, 'and says when to come back');
    } finally { global.fetch = realFetch2; }
  } finally {
    delete process.env.X_TARGET_USER_ID;
    delete process.env.X_BEARER_TOKEN; process.env.SOCIAL_VERIFY_MODE = prevMode;
  }
}
// ── FIX M1: the tier-2 "family tree" reconcile sweep — a grandrecruiter who had no living street at the
// qualifying instant lost the finder's fee forever (the one-shot post-commit hook never retried). The
// worker sweep pays it once they're reachable again, idempotently. ──
{
  const gAl = await mk('Grand Al');                  // A — grandrecruiter (root)
  const mMoe = await mk('Middle Moe', 'Grand Al');   // R — brought in by A
  const bBo = await mk('Bottom Bo', 'Middle Moe');   // R2 — brought in by R
  const qualify = async (c) => { // drive a recruit through the 4 gates (level/jobs/checkins/cash)
    await seedCh(c.id, 'respect=1000, lc_crime=39, cash=30000, nerve=50, energy=200');
    await pool.query(`UPDATE account_persistent SET checkins_lifetime=3 WHERE account_id=(SELECT account_id FROM characters WHERE id='${c.id}')`);
    for (let i = 0; i < 20; i++) { await seedCh(c.id, 'nerve=50, energy=200, jail_until=NULL'); const rr = await call('POST', '/v1/crimes/pick', { token: c.token }); if (rr.body.success) break; }
  };
  await qualify(mMoe);
  const l2 = (id) => pool.query(`SELECT ref_paid, ref_l2_paid FROM account_persistent WHERE account_id=(SELECT account_id FROM characters WHERE id='${id}')`).then((r) => r.rows[0]);
  assert.equal((await l2(mMoe.id)).ref_paid, true, 'the middle link qualified');
  // A goes dark — no living street — right as R2 qualifies, so the inline tier-2 can't reach them
  await pool.query(`UPDATE characters SET alive=false WHERE id='${gAl.id}'`);
  await qualify(bBo);
  assert.equal((await l2(bBo.id)).ref_paid, true, 'R2 qualified (the direct referral paid)');
  assert.equal((await l2(bBo.id)).ref_l2_paid, false, 'but the tier-2 fee was NOT paid — the grandrecruiter had no living street');
  // A stands a new street up; the worker reconcile pays the deferred fee, once
  await pool.query(`UPDATE characters SET alive=true WHERE id='${gAl.id}'`);
  const alBefore = (await meOf(gAl.token)).cash;
  const sweep = await sweepGrandReferrals(pool);
  assert(sweep.paid >= 1, `the reconcile sweep pays the deferred tier-2 fee (paid ${sweep.paid})`);
  assert.equal((await l2(bBo.id)).ref_l2_paid, true, 'the tier-2 latch is now set');
  assert.equal((await meOf(gAl.token)).cash, alBefore + 5000, 'A received the $5k finder\'s fee after the sweep');
  assert.equal((await sweepGrandReferrals(pool)).paid, 0, 'a second sweep pays nothing (idempotent — the latch holds)');
}

// ── telemetry (§12) ──
for (const ev of ['crime_attempt', 'deal', 'first_week_step', 'referral_qualified', 'referral_spark', 'social_task'])
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
await pool.query(`UPDATE account_persistent SET omr = 120 WHERE account_id = (SELECT account_id FROM characters WHERE id='${chef.id}')`);
assert.equal((await call('POST', '/v1/respec', { token: chef.token, body: { muscle: 60, cunning: 20, speed: 30 } })).body.error, 'alloc', 'no minting points — the sum must match exactly');
assert.equal((await call('POST', '/v1/respec', { token: chef.token, body: { muscle: 94, cunning: 3, speed: 3 } })).body.error, 'alloc', 'no stat below the creation base (5)');
assert.equal((await call('POST', '/v1/respec', { token: chef.token, body: { muscle: 50, cunning: 20, speed: 30 } })).body.error, 'same', 'a no-op respec is refused, not charged');
assert.equal((await meOf(chef.token)).omr, 120, 'every rejection above charged nothing');
r = await call('POST', '/v1/respec', { token: chef.token, body: { muscle: 20, cunning: 20, speed: 60 } });
assert.equal(r.code, 200, 'the chef rebuilt himself for the getaway life');
const respecMe = await meOf(chef.token);
assert.equal(respecMe.stats.muscle, 20); assert.equal(respecMe.stats.speed, 60);
assert.equal(respecMe.stats.muscle + respecMe.stats.cunning + respecMe.stats.speed, 100, 'the total is conserved exactly');
assert.equal(respecMe.omr, 120 - M8.RESPEC_OMR, `the respec burned ${M8.RESPEC_OMR} $OMR`);
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='omr' AND reason='respec'")).rows[0].s), -M8.RESPEC_OMR, 'the burn is ledgered');
// BALANCE D7: one re-shaping a day — a second paid respec inside the window is refused (unpaid)
assert.equal((await call('POST', '/v1/respec', { token: chef.token, body: { muscle: 60, cunning: 20, speed: 20 } })).body.error, 'cooldown', 'no re-shaping between fights (24h)');
assert.equal((await meOf(chef.token)).omr, 120 - M8.RESPEC_OMR, 'the refused respec charged nothing');
await pool.query(`UPDATE characters SET respec_at = now() - interval '25 hours' WHERE id='${chef.id}'`);
await pool.query(`UPDATE account_persistent SET omr = 120 WHERE account_id = (SELECT account_id FROM characters WHERE id='${chef.id}')`);
assert.equal((await call('POST', '/v1/respec', { token: chef.token, body: { muscle: 60, cunning: 20, speed: 20 } })).code, 200, 'a day later the trainer works again');

// ── THE HUSTLE + THE MARK (crime-loop interactivity, founder-directed) ──────────────────────────
{
  const hus = await mk('Hustler Hank');
  await seedCh(hus.id, "respect=2500, cash=5000, energy=200, nerve=100, loc='docks'");
  // (1) THE MARK — every job names a victim (a fictional fallback here: no NPC residents seeded)
  let job = null;
  for (let i = 0; i < 30 && !job; i++) {
    await seedCh(hus.id, 'nerve=100');
    const r = await call('POST', '/v1/crimes/pick', { token: hus.token });
    if (typeof r.body.success === 'boolean') job = r.body;
  }
  assert(job && typeof job.victim === 'string' && job.victim.length > 2,
    'every job is against SOMEBODY — the result names the mark (fictional fallback with no residents)');
  // …and when an NPC RESIDENT stands in the district, THEY are the mark
  const resAcct = (await pool.query(`INSERT INTO accounts (id, auth_provider, auth_subject) VALUES ('hu-res-a','guest','hu-res') RETURNING id`)).rows[0].id;
  await pool.query(`INSERT INTO account_persistent (account_id, npc_flag) VALUES ('${resAcct}', true)`);
  await pool.query(`INSERT INTO characters (id, account_id, name, loc, is_npc, alive, season) VALUES ('hu-res-c','${resAcct}','Sally Two-Steps','docks', true, true, 1)`);
  let named = null;
  for (let i = 0; i < 30 && !named; i++) {
    await seedCh(hus.id, 'nerve=100');
    const r = await call('POST', '/v1/crimes/pick', { token: hus.token });
    if (r.body.victim === 'Sally Two-Steps') named = r.body;
  }
  assert(named, 'a resident standing in your district becomes the named mark');
  // REGRESSION (the dice-counter class): a goods BUY bumps the daily 'goods' counter — the daily
  // contract AND the hustle legwork both promise "buy OR sell", but only the sell side counted, so
  // a goods-drawn hustle was uncompletable by buying (the suite flaked on which legwork the seed
  // drew). Deterministic here regardless of the draw.
  {
    await seedCh(hus.id, 'cash=100000');
    const g0 = (await pool.query(`SELECT counters FROM daily_progress WHERE character_id='${hus.id}' AND day=$1`, [dayOf()])).rows[0];
    const before = g0 ? Number(JSON.parse(g0.counters).goods || 0) : 0;
    assert.equal((await call('POST', '/v1/goods/buy', { token: hus.token, body: { goodId: 'gin', qty: 1 } })).code, 200, 'bought a unit');
    const g1 = (await pool.query(`SELECT counters FROM daily_progress WHERE character_id='${hus.id}' AND day=$1`, [dayOf()])).rows[0];
    assert.equal(Number(JSON.parse(g1.counters).goods || 0), before + 1, 'a goods BUY counts toward the daily goods contract (the promised "buy or sell")');
  }
  // (2) THE HUSTLE — the daily three-stop chain: deterministic, location-gated, legwork-verified
  const b0 = (await call('GET', '/v1/hustle', { token: hus.token })).body;
  assert.equal(b0.of, 3, 'three stops');
  assert(b0.contact && b0.stops.length === 3 && new Set(b0.stops.map((s) => s.id)).size === 3, 'three DISTINCT districts + a contact');
  assert.equal(b0.step, 0, 'the chain starts at the contact meeting');
  // wrong district → refused with directions
  const wrong = DISTRICTS.map((d) => d.id).find((d) => d !== b0.district);
  await seedCh(hus.id, `loc='${wrong}'`);
  assert.equal((await call('POST', '/v1/hustle/advance', { token: hus.token })).body.error, 'district', 'a stop must be claimed ON LOCATION');
  // meet the contact
  await seedCh(hus.id, `loc='${b0.district}'`);
  let r = await call('POST', '/v1/hustle/advance', { token: hus.token });
  assert.equal(r.body.step, 1, 'the contact meeting advances the chain');
  // the legwork stop: standing there is NOT enough — the drawn action must be done AFTER the meeting
  const b1 = (await call('GET', '/v1/hustle', { token: hus.token })).body;
  await seedCh(hus.id, `loc='${b1.district}', nerve=100, energy=200, cash=100000`);
  assert.equal((await call('POST', '/v1/hustle/advance', { token: hus.token })).body.error, 'legwork', 'no check-in before the work is done');
  // do the drawn action (crime → pull jobs; goods → buy; train → a gym session)
  const kind = (await pool.query(`SELECT baseline FROM hustles WHERE character_id='${hus.id}'`)).rows[0] ? b1.legwork : null;
  assert(kind, 'the board names the legwork');
  // …and the work is done SOMEWHERE ELSE, on purpose. The proof is a delta on the DAILY counter,
  // which is global — there is no way to know where the job was pulled — so the copy must not claim
  // the work happens at the stop, and this asserts the contract the code actually has: do the work
  // wherever, CHECK IN at the named district. (The routing this mechanic exists for comes from the
  // three check-ins, all of which are location-gated, as the refusal above just showed.)
  const elsewhere = DISTRICTS.map((d) => d.id).find((d) => d !== b1.district);
  await seedCh(hus.id, `loc='${elsewhere}'`);
  if (/job/.test(b1.legwork)) { for (let i = 0; i < 20; i++) { await seedCh(hus.id, 'nerve=100'); if ((await call('POST', '/v1/crimes/pick', { token: hus.token })).body.success) break; } }
  else if (/goods/.test(b1.legwork)) await call('POST', '/v1/goods/buy', { token: hus.token, body: { goodId: 'gin', qty: 1 } });
  else { await pool.query(`UPDATE characters SET train_at=NULL WHERE id='${hus.id}'`); await call('POST', '/v1/train/muscle', { token: hus.token }); }
  assert.equal((await call('POST', '/v1/hustle/advance', { token: hus.token })).body.error, 'district',
    'the work counts, but the CHECK-IN is still location-gated — you have to bring it to the stop');
  await seedCh(hus.id, `loc='${b1.district}'`);
  r = await call('POST', '/v1/hustle/advance', { token: hus.token });
  assert.equal(r.body.step, 2, `the legwork done (${b1.legwork}) advances the chain`);
  // the payoff: on location, ledgered, level-scaled, once a day
  const b2 = (await call('GET', '/v1/hustle', { token: hus.token })).body;
  await seedCh(hus.id, `loc='${b2.district}'`);
  const cashBefore = (await meOf(hus.token)).cash;
  r = await call('POST', '/v1/hustle/advance', { token: hus.token });
  assert(r.body.pay > 0, 'the payoff pays');
  assert.equal(r.body.pay, Math.max(HUSTLE.PAY_MIN, HUSTLE.PAY_PER_LVL * (await meOf(hus.token)).level), 'level-scaled with a floor');
  assert.equal((await meOf(hus.token)).cash, cashBefore + r.body.pay, 'the cash landed');
  const led = (await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE character_id='${hus.id}' AND reason='hustle:payoff'`)).rows[0];
  assert.equal(Number(led.s), r.body.pay, 'the payoff is a ledgered hustle:payoff faucet (§10.4 check (a) reconciles)');
  assert.equal((await call('POST', '/v1/hustle/advance', { token: hus.token })).body.error, 'done', 'one hustle a day — the PK is the cap');
  assert((await call('GET', '/v1/hustle', { token: hus.token })).body.done, 'the board reads done');
}

// ── WORD ON THE STREET (task #318) — the district quest boards: seed-drawn per (district, day),
// one CONFLICT kind guaranteed, accept-then-DELTA-then-claim (the hustle baseline rule), the
// corner:job faucet hard-bounded at CORNER.MAX_DAY envelopes a day. ──────────────────────────────
{
  const cw = await mk('Corner Worker');
  const day = dayOf();
  // 'crime' is in EVERY district pool, so it is drawn SOMEWHERE virtually every day (missing
  // everywhere needs six independent exclusions — ~(1/4)^6); the astronomically-rare all-quiet
  // day falls back to a counter bump so the suite never flakes on the seed.
  let pick = null;
  for (const d of DISTRICTS.map((x) => x.id)) {
    const t = cornerTasksOf(d, day).find((t) => t.kind === 'crime');
    if (t) { pick = { district: d, slot: t.slot }; break; }
  }
  const viaCrime = !!pick;
  if (!pick) pick = { district: DISTRICTS[0].id, slot: 0 };
  await seedCh(cw.id, `loc='${pick.district}', nerve=100, energy=200`);
  // the board: PER_DAY tasks matching the seed draw, one conflict guaranteed
  let r = await call('GET', '/v1/corner', { token: cw.token });
  assert.equal(r.code, 200, 'the corner board reads');
  assert.equal(r.body.tasks.length, CORNER.PER_DAY, 'PER_DAY tasks posted');
  assert.deepEqual(r.body.tasks.map((t) => t.kind), cornerTasksOf(pick.district, day).map((t) => t.kind),
    'the board IS the seed draw (town-wide per district)');
  assert(r.body.tasks.some((t) => t.conflict), 'one CONFLICT kind guaranteed every day');
  assert.equal(r.body.leftToday, CORNER.MAX_DAY, 'a fresh street has the full allowance');
  const kind = r.body.tasks[pick.slot].kind;
  // accept: once, snapshots the baseline
  r = await call('POST', `/v1/corner/${pick.slot}/accept`, { token: cw.token });
  assert.equal(r.code, 200, 'take the job');
  assert.equal((await call('POST', `/v1/corner/${pick.slot}/accept`, { token: cw.token })).body.error, 'taken', 'once');
  // the claim is LOCATED: at another district that slot was never taken
  const other = DISTRICTS.map((d) => d.id).find((d) => d !== pick.district);
  await seedCh(cw.id, `loc='${other}'`);
  assert.equal((await call('POST', `/v1/corner/${pick.slot}/claim`, { token: cw.token })).body.error, 'not_taken',
    'the envelope is collected where the job was taken');
  await seedCh(cw.id, `loc='${pick.district}'`);
  // the work comes first — the refusal NAMES the how
  r = await call('POST', `/v1/corner/${pick.slot}/claim`, { token: cw.token });
  assert.equal(r.body.error, 'not_done', 'no pay before the work');
  assert(r.body.message.includes(CORNER.HOW[kind]), 'the refusal teaches the HOW');
  // do the work — the REAL funnel when crime was drawn (a clean job bumps the daily counter),
  // the SQL fallback otherwise (bumpDaily itself is covered per-kind elsewhere; the DELTA gate
  // is what is under test)
  if (viaCrime) {
    for (let i = 0; i < 25; i++) {
      await seedCh(cw.id, 'nerve=100, jail_until=NULL');
      if ((await call('POST', '/v1/crimes/pick', { token: cw.token })).body.success) break;
    }
  } else {
    const row = (await pool.query('SELECT counters FROM daily_progress WHERE character_id=$1 AND day=$2', [cw.id, day])).rows[0];
    const c = row ? JSON.parse(row.counters) : {};
    c[kind] = Number(c[kind] || 0) + 1;
    if (row) await pool.query('UPDATE daily_progress SET counters=$3 WHERE character_id=$1 AND day=$2', [cw.id, day, JSON.stringify(c)]);
    else await pool.query('INSERT INTO daily_progress (character_id, day, counters) VALUES ($1,$2,$3)', [cw.id, day, JSON.stringify(c)]);
  }
  // claim: pays cash + respect, ledgered corner:job, once
  const before = await meOf(cw.token);
  r = await call('POST', `/v1/corner/${pick.slot}/claim`, { token: cw.token });
  assert.equal(r.code, 200, `the envelope pays (via ${viaCrime ? 'a real clean job' : 'the fallback bump'})`);
  assert.equal(r.body.cash, CORNER.CASH); assert.equal(r.body.respect, CORNER.RESPECT);
  const after = await meOf(cw.token);
  assert.equal(after.cash, before.cash + CORNER.CASH, 'the cash landed');
  const led = (await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE character_id='${cw.id}' AND reason='corner:job'`)).rows[0];
  assert.equal(Number(led.s), CORNER.CASH, 'a ledgered corner:job faucet (check (a) reconciles)');
  assert.equal((await call('POST', `/v1/corner/${pick.slot}/claim`, { token: cw.token })).body.error, 'claimed', 'one envelope per job');
  r = await call('GET', '/v1/corner', { token: cw.token });
  assert(r.body.tasks[pick.slot].claimed, 'the board reads PAID');
  assert.equal(r.body.claimedToday, 1, 'one claimed today');
  // MAX_DAY is the HARD faucet bound — seed the rest of the allowance as claimed rows elsewhere,
  // then a further claim (work done and all) is refused 'capped'
  const pad = DISTRICTS.map((d) => d.id).filter((d) => d !== pick.district);
  for (let i = 0; i < CORNER.MAX_DAY - 1; i++)
    await pool.query(`INSERT INTO corner_jobs (character_id, day, district, slot, baseline, claimed)
      VALUES ($1,$2,$3,$4,'{}',true)`, [cw.id, day, pad[i % pad.length], 90 + i]);
  const slot2 = [0, 1, 2].find((s) => s !== pick.slot);
  await call('POST', `/v1/corner/${slot2}/accept`, { token: cw.token });
  { // hand the second job its delta so ONLY the cap can refuse it
    const row = (await pool.query('SELECT counters FROM daily_progress WHERE character_id=$1 AND day=$2', [cw.id, day])).rows[0];
    const k2 = cornerTasksOf(pick.district, day)[slot2].kind;
    const c = row ? JSON.parse(row.counters) : {};
    c[k2] = Number(c[k2] || 0) + 1;
    if (row) await pool.query('UPDATE daily_progress SET counters=$3 WHERE character_id=$1 AND day=$2', [cw.id, day, JSON.stringify(c)]);
    else await pool.query('INSERT INTO daily_progress (character_id, day, counters) VALUES ($1,$2,$3)', [cw.id, day, JSON.stringify(c)]);
  }
  r = await call('POST', `/v1/corner/${slot2}/claim`, { token: cw.token });
  assert.equal(r.body.error, 'capped', `the corner pays ${CORNER.MAX_DAY} envelopes a day — the hard faucet bound`);
}

// ── STREET LIFE step two — THE CHAIN (task #321): the district's standing job. A claimed envelope
// HERE advances the block's chain, at most one step a day, and the completing step pays a bonus
// folded into that claim's own ledger row (so the chain can never add a claim past MAX_DAY). ─────
{
  const ch = await mk('Chain Walker');
  const day = dayOf();
  // pick a district that drew 'crime' so the whole chain runs through the REAL funnel
  let pick = null;
  for (const d of DISTRICTS.map((x) => x.id)) {
    const t = cornerTasksOf(d, day).find((t) => t.kind === 'crime');
    if (t) { pick = { district: d, slot: t.slot }; break; }
  }
  const viaCrime = !!pick;
  if (!pick) pick = { district: DISTRICTS[0].id, slot: 0 };
  await seedCh(ch.id, `loc='${pick.district}', nerve=100, energy=200`);
  const kind = cornerTasksOf(pick.district, day)[pick.slot].kind;
  // a fresh street has no chain running here
  let r = await call('GET', '/v1/corner', { token: ch.token });
  assert.equal(r.body.chain.step, 0, 'no chain running on a corner you have never worked');
  assert.equal(r.body.chain.steps, CORNER.CHAIN_STEPS, 'the board publishes how long the block job runs');
  assert.equal(r.body.chain.bonus, CORNER.CHAIN_BONUS, 'and what it pays');

  // work the corner CHAIN_STEPS times, one per day — each claim on its own day advances one step
  const doWork = async (d) => {
    if (viaCrime) {
      for (let i = 0; i < 25; i++) {
        await seedCh(ch.id, 'nerve=100, jail_until=NULL');
        if ((await call('POST', '/v1/crimes/pick', { token: ch.token })).body.success) return;
      }
    }
    const row = (await pool.query('SELECT counters FROM daily_progress WHERE character_id=$1 AND day=$2', [ch.id, d])).rows[0];
    const c = row ? JSON.parse(row.counters) : {};
    c[kind] = Number(c[kind] || 0) + 1;
    if (row) await pool.query('UPDATE daily_progress SET counters=$3 WHERE character_id=$1 AND day=$2', [ch.id, d, JSON.stringify(c)]);
    else await pool.query('INSERT INTO daily_progress (character_id, day, counters) VALUES ($1,$2,$3)', [ch.id, d, JSON.stringify(c)]);
  };
  let last = null, extraEnvelopes = 0;
  for (let step = 1; step <= CORNER.CHAIN_STEPS; step++) {
    await call('POST', `/v1/corner/${pick.slot}/accept`, { token: ch.token });
    await doWork(day);
    last = await call('POST', `/v1/corner/${pick.slot}/claim`, { token: ch.token });
    assert.equal(last.code, 200, `claim ${step} pays`);
    if (step < CORNER.CHAIN_STEPS) {
      assert.equal(last.body.chain.step, step, `the block job is ${step}/${CORNER.CHAIN_STEPS}`);
      assert.equal(last.body.cash, CORNER.CASH, 'a mid-chain envelope is just an envelope');
      const board = await call('GET', '/v1/corner', { token: ch.token });
      assert.equal(board.body.chain.advancedToday, true, 'the board says you already showed up today');
      // THE POINT, driven rather than asserted off a flag: a SECOND envelope on this corner TODAY
      // pays, but does NOT move the chain. A chain is DAYS of showing up, not a busy afternoon —
      // without the one-step-a-day guard the whole three-day job falls in one sitting.
      if (step === 1) {
        const other = [0, 1, 2].find((sl) => sl !== pick.slot
          && cornerTasksOf(pick.district, day)[sl].kind !== kind);
        if (other !== undefined) {
          const k2 = cornerTasksOf(pick.district, day)[other].kind;
          await call('POST', `/v1/corner/${other}/accept`, { token: ch.token });
          const row = (await pool.query('SELECT counters FROM daily_progress WHERE character_id=$1 AND day=$2', [ch.id, day])).rows[0];
          const c = row ? JSON.parse(row.counters) : {};
          c[k2] = Number(c[k2] || 0) + 1;
          if (row) await pool.query('UPDATE daily_progress SET counters=$3 WHERE character_id=$1 AND day=$2', [ch.id, day, JSON.stringify(c)]);
          else await pool.query('INSERT INTO daily_progress (character_id, day, counters) VALUES ($1,$2,$3)', [ch.id, day, JSON.stringify(c)]);
          const second = await call('POST', `/v1/corner/${other}/claim`, { token: ch.token });
          assert.equal(second.code, 200, 'the second envelope of the day still pays');
          assert.equal(second.body.cash, CORNER.CASH, 'as an envelope, not a bonus');
          extraEnvelopes++;
          assert.equal(second.body.chain, undefined, 'and it reports no chain movement');
          assert.equal((await pool.query(
            'SELECT step FROM corner_chains WHERE character_id=$1 AND district=$2', [ch.id, pick.district])).rows[0].step,
            1, 'the chain is STILL at step 1 — a second envelope today does not advance it');
        }
      }
      // roll the clock + clear the day's claims so the next step is a genuinely different day
      await pool.query('DELETE FROM corner_jobs WHERE character_id=$1', [ch.id]);
      await pool.query('UPDATE corner_chains SET last_day = last_day - 1 WHERE character_id=$1', [ch.id]);
    }
  }
  assert.equal(last.body.chain.done, true, 'the block pays on the last day');
  assert.equal(last.body.cash, CORNER.CASH + CORNER.CHAIN_BONUS, 'the bonus rides the completing envelope');
  assert.equal(last.body.respect, CORNER.RESPECT + CORNER.CHAIN_RESPECT, 'and the respect with it');
  const paid = Number((await pool.query(
    `SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE character_id='${ch.id}' AND reason='corner:job'`)).rows[0].s);
  assert.equal(paid, CORNER.CASH * (CORNER.CHAIN_STEPS + extraEnvelopes) + CORNER.CHAIN_BONUS,
    'the corner paid one envelope per claim and exactly ONE bonus (the pocket also carries the crime work that drove it)');
  // ONE ROW PER CLAIM — the bonus is folded in, never a second faucet row (the capstone precedent)
  const rows = (await pool.query(
    `SELECT amount FROM transactions WHERE character_id='${ch.id}' AND reason='corner:job' ORDER BY amount`)).rows;
  assert.equal(rows.length, CORNER.CHAIN_STEPS + extraEnvelopes, 'one ledger row per claim — the chain adds no rows');
  assert.equal(Number(rows[rows.length - 1].amount), CORNER.CASH + CORNER.CHAIN_BONUS,
    'the completing row carries the bonus, so the faucet stays inside the MAX_DAY bound');
  // and the chain resets — the block has another job for you
  assert.equal((await call('GET', '/v1/corner', { token: ch.token })).body.chain.step, 0, 'a finished chain starts over');
  // (audit F5) it resets IN PLACE, stamped with today. Deleting the row instead let a second claim
  // here the same day find nothing, skip the once-a-day check and take step 1 immediately — so after
  // the first chain the bonus arrived every TWO days, not the three the design states.
  {
    const row = (await pool.query(
      'SELECT step, last_day FROM corner_chains WHERE character_id=$1 AND district=$2', [ch.id, pick.district])).rows[0];
    assert(row, 'the finished chain leaves a fresh row behind, not a hole a same-day claim can start in');
    assert.equal(Number(row.step), 0, 'the fresh chain is at step 0');
    assert.equal(Number(row.last_day), day, "and stamped with today — you already showed up on this block");
    assert.equal((await call('GET', '/v1/corner', { token: ch.token })).body.chain.advancedToday, true,
      'which the board reports honestly');
  }
}

// ── (AUDIT-street-life, lenses A+D) ONE ENVELOPE PER KIND PER DAY: the same kind sits in several
// districts' pools and every accepted slot snapshots the SAME shared daily counter, so ONE action
// used to satisfy every same-kind slot on the map (accept crime in 5 districts → 1 crime → 5 × $400).
// Deterministic by PIGEONHOLE: 6 districts × PER_DAY draws over ~11 kinds guarantees some kind is
// drawn in two districts every day — find that pair and prove the second envelope refuses. ──
{
  const cw2 = await mk('Map Walker');
  const day = dayOf();
  const seen = new Map(); let pair = null;
  for (const d of DISTRICTS.map((x) => x.id)) {
    for (const t of cornerTasksOf(d, day)) {
      if (seen.has(t.kind) && seen.get(t.kind).district !== d) { pair = [seen.get(t.kind), { district: d, slot: t.slot, kind: t.kind }]; break; }
      if (!seen.has(t.kind)) seen.set(t.kind, { district: d, slot: t.slot, kind: t.kind });
    }
    if (pair) break;
  }
  assert(pair, 'pigeonhole: some kind is drawn in two districts every day (18 draws over ~11 kinds)');
  const [a, b] = pair;
  await seedCh(cw2.id, `loc='${a.district}', nerve=100, energy=200`);
  assert.equal((await call('POST', `/v1/corner/${a.slot}/accept`, { token: cw2.token })).code, 200, 'accept the kind at district A');
  await seedCh(cw2.id, `loc='${b.district}'`);
  assert.equal((await call('POST', `/v1/corner/${b.slot}/accept`, { token: cw2.token })).code, 200, 'accept the SAME kind at district B');
  // one counted action (the SQL fallback — the delta gate itself is covered above)
  await pool.query('INSERT INTO daily_progress (character_id, day, counters) VALUES ($1,$2,$3)',
    [cw2.id, day, JSON.stringify({ [a.kind]: 1 })]);
  await seedCh(cw2.id, `loc='${a.district}'`);
  let r = await call('POST', `/v1/corner/${a.slot}/claim`, { token: cw2.token });
  assert.equal(r.code, 200, 'the first envelope of that kind pays');
  await seedCh(cw2.id, `loc='${b.district}'`);
  r = await call('POST', `/v1/corner/${b.slot}/claim`, { token: cw2.token });
  assert.equal(r.body.error, 'done_kind',
    'one envelope per KIND per day — one action can never cash two same-kind slots across the map');
}

// ══ F3 — CATALOG BREADTH: the ladder has a beat at every level (omerta-early-game-design.md) ══
// The level-gate map found seven levels between 17 and 31 that delivered NOTHING — no job, no
// mission, no system — which the harness puts at hours 2.5 to 7 of play. Filling them is a content
// expansion through the machine-owned seam (edit the prototype, re-extract — the car-catalog
// precedent), so what this guards is the SHAPE: no dupes, well-formed, on-curve, and no dead level.
{
  const cids = CRIMES.map((c) => c.id);
  assert.equal(new Set(cids).size, cids.length, 'crime ids are unique (no dupes from the expansion)');
  for (const c of CRIMES) {
    assert(c.name && c.nerve > 0 && c.cash[1] > c.cash[0] && c.respect > 0,
      `crime ${c.id} is well-formed`);
    assert(c.base > 0 && c.base <= 1, `crime ${c.id} has a real success rate`);
  }
  // THE POINT OF THE DROP: every level from 2 to 31 delivers SOMETHING — a job, a mission, or a
  // system. Before this there were seven silent levels in a row of the 17-31 band.
  const beats = new Set([...CRIMES.map((c) => c.lvl), ...MISSIONS.map((m) => m.req.lvl)]);
  const silent = [];
  for (let l = 2; l <= 31; l++) if (!beats.has(l)) silent.push(l);
  assert.equal(silent.length, 0, `every level 2-31 has a beat (silent: ${silent.join(', ')})`);
  // ON-CURVE means BRACKETED, and that is asserted about the entries THIS DROP ADDED rather than
  // about the whole legacy table — which is deliberately not monotone (level 3's booze is a cheaper,
  // safer job than level 2's numbers, and that choice is the point). Each new rung must pay more
  // than the best job below it and less than the cheapest above it, or it is a rebalance in content's
  // clothing. Naming the ids is the honest form: a future expansion adds its own.
  const NEW_CRIMES = ['pigeon', 'meter', 'laundry', 'bookie', 'pawn', 'protection', 'switchbag',
    'ballot', 'payoff', 'nightdeposit', 'bondsman', 'cathouse', 'ticker', 'distillery'];
  for (const id of NEW_CRIMES) {
    const c = CRIMES.find((x) => x.id === id);
    assert(c, `${id} survived the re-extract`);
    const below = CRIMES.filter((x) => x.lvl < c.lvl), above = CRIMES.filter((x) => x.lvl > c.lvl);
    const prevMax = Math.max(...below.map((x) => x.cash[1]));
    const nextMin = Math.min(...above.map((x) => x.cash[1]));
    assert(c.cash[1] >= prevMax && c.cash[1] <= nextMin,
      `${id} pays between its neighbours (${prevMax} <= ${c.cash[1]} <= ${nextMin})`);
    assert(c.respect >= Math.max(...below.map((x) => x.respect))
      && c.respect <= Math.min(...above.map((x) => x.respect)), `${id} is on the respect curve too`);
  }
  const NEW_MISSIONS = ['m29', 'm30', 'm31', 'm32', 'm33', 'm34', 'm35', 'm36'];
  // the KITCHEN missions are their own track — gated on lifetime trade volume rather than level, so
  // they pay off a different curve (the level-15 Taste Test out-pays the level-16 Long Drive) and
  // comparing against them would measure the wrong ladder.
  const LADDER = MISSIONS.filter((x) => !x.req.trade);
  for (const id of NEW_MISSIONS) {
    const m = MISSIONS.find((x) => x.id === id);
    assert(m, `${id} survived the re-extract`);
    const below = LADDER.filter((x) => x.req.lvl < m.req.lvl), above = LADDER.filter((x) => x.req.lvl > m.req.lvl);
    assert(m.reward.cash >= Math.max(...below.map((x) => x.reward.cash))
      && m.reward.cash <= Math.min(...above.map((x) => x.reward.cash)),
      `${id} pays between its neighbours on the ladder`);
    assert(m.reward.respect >= Math.max(...below.map((x) => x.reward.respect))
      && m.reward.respect <= Math.min(...above.map((x) => x.reward.respect)),
      `${id} is on the respect curve too`);
  }
  const mids = MISSIONS.map((m) => m.id);
  assert.equal(new Set(mids).size, mids.length, 'mission ids are unique');
  for (const m of MISSIONS) assert(m.name && m.brief && m.req?.lvl >= 1 && m.reward?.cash > 0,
    `mission ${m.id} is well-formed`);
  // the $OMR ladder is UNTOUCHED by the expansion — the new rungs pay cash + respect only, so the
  // enumerated mission faucet is exactly what it was
  assert.equal(MISSIONS.filter((m) => m.reward.omr).length, 9,
    'the expansion added no new $OMR rung (the enumerated faucet is unchanged)');
}

// ══ F4 — THE LEVEL-UP MOMENT (omerta-early-game-design.md) ══
// Crossing a level refills energy and nerve to their newly-raised caps, so the moment you go up you
// can keep playing. §10.4-free by construction: both are regen resources, nothing is ledgered.
{
  const up = await mk('Level-Up Lou');
  // sit one respect short of level 3, drained, with a bust impossible to reason about — so the
  // ONLY thing that can refill these bars is the crossing itself.
  const at3 = PACING.LEVEL_DIVISOR * 2 * 2;
  await seedCh(up.id, `respect=${at3 - 1}, energy=3, nerve=9, jail_until=NULL`);
  const before = await meOf(up.token);
  assert.equal(before.level, 2, 'seeded one respect short of level 3');
  // a clean job (any crime pays respect ≥ 1, so the crossing is guaranteed on the first success)
  let res = null;
  for (let i = 0; i < 60; i++) {
    const c = await call('POST', '/v1/crimes/pick', { token: up.token });
    if (c.body.success) { res = c.body; break; }
    await seedCh(up.id, `respect=${at3 - 1}, energy=3, nerve=9, jail_until=NULL`);
  }
  assert(res, 'a clean job landed');
  const after = await meOf(up.token);
  assert.equal(after.level, 3, 'the job crossed into level 3');
  assert.equal(after.energy, after.maxEnergy, 'levelling up refilled the tank to the NEW cap');
  assert.equal(after.nerve, after.maxNerve, 'and nerve with it — you can keep playing');
  assert(after.maxEnergy > before.maxEnergy, 'and the cap itself went up, so the refill is to the bigger bar');
  // the response names the beat: which level, and the street rank it walks
  assert(res.character && res.character.leveled, 'the response carries the level-up');
  assert.equal(res.character.leveled.to, 3, 'it names the level reached');
  assert(typeof res.character.leveled.rank === 'string' && res.character.leveled.rank.length,
    'and the street rank');
  // a plain read never claims a level-up — only the action that crossed one does
  assert(!after.leveled, 'a later read carries no level-up (it is the moment, not a state)');
  // §10.4: a refill is not a currency — the crossing wrote no ledger row of its own
  const rows = await pool.query(
    `SELECT COUNT(*) n FROM transactions WHERE character_id='${up.id}' AND reason LIKE 'level%'`);
  assert.equal(Number(rows.rows[0].n), 0, 'no level-up reason ever touches the ledger');

  // ── THE REFILL CEILING (PACING.LEVEL_UP_REFILL_MAX_DAY). The refill is a nerve FAUCET whose rate
  // is how often you level, and past level ~90 a crossing returns MORE nerve than the next level
  // costs — measured live at level 115 with the clock frozen: a pool funding 3 jobs funded 3000 and
  // reached level 656 in one sitting. A rolling daily bucket bounds it. Spend the bucket and the
  // SAME crossing must hand back nothing; this is the assertion that fails if the ceiling is ever
  // removed or turned self-sustaining again.
  const cap = PACING.LEVEL_UP_REFILL_MAX_DAY;
  assert(cap > 0, 'the ceiling is armed — an unbounded refill is the alpha level-240 speedrun reborn');
  const at4 = PACING.LEVEL_DIVISOR * 3 * 3;
  const spend = `respect=${at4 - 1}, energy=3, nerve=9, jail_until=NULL, refill_used=${cap}, refill_at=now()`;
  await seedCh(up.id, spend);
  let crossed = null;
  for (let i = 0; i < 60; i++) {
    const c = await call('POST', '/v1/crimes/pick', { token: up.token });
    if (c.body.success) { crossed = c.body; break; }
    await seedCh(up.id, spend);
  }
  assert(crossed, 'a clean job landed on a spent bucket');
  const dry = await meOf(up.token);
  assert.equal(dry.level, 4, 'the job still crossed into level 4 — the bucket meters the gift, not the level');
  assert(dry.nerve < dry.maxNerve, 'a spent bucket hands back NO nerve on the crossing');
  assert(dry.nerve < 9, 'and the job still spent what it cost — regen is untouched, only the top-up is metered');
}


// ── THE CAPO'S LICENSE — agent recruiting perks, gated on signals a Sybil ring can't fake ─────────
{
  const { sweepCapoLicense } = await import('../src/growth.js');
  // the agent recruiter + three referred humans, one per failed gate + one that passes all three
  const acctOf = async (chId) => (await pool.query('SELECT account_id FROM characters WHERE id=$1', [chId])).rows[0].account_id;
  const capo = await mk('CapoAgent'); capo.account = await acctOf(capo.id);
  await pool.query('UPDATE account_persistent SET agent_flag=true WHERE account_id=$1', [capo.account]);
  const mkRecruit = async (name, { minted, levelled, fresh }) => {
    const r = await mk(name); r.account = await acctOf(r.id);
    await pool.query('UPDATE account_persistent SET referred_by=$1, minted=$2 WHERE account_id=$3',
      [capo.account, !!minted, r.account]);
    if (levelled) await pool.query("UPDATE characters SET respect=600 WHERE account_id=$1", [r.account]); // lvl 8 needs 490
    // retention = telemetry inside CAPO.RETAIN_DAYS; a stale row models a recruit who quit
    await pool.query('INSERT INTO telemetry (id, account_id, event, at) VALUES ($1,$2,$3,$4)',
      [globalThis.crypto.randomUUID(), r.account, 'checkin', fresh ? new Date() : new Date(Date.now() - 30 * 86400000)]);
    return r;
  };
  await mkRecruit('CapoGood', { minted: true, levelled: true, fresh: true });     // counts
  await mkRecruit('CapoUnminted', { minted: false, levelled: true, fresh: true }); // MUTATION GUARD: drop the
  // minted gate in sweepCapoLicense and this recruit counts too — the count reads 2 and the tier
  // assertion below fails by name. The 0.01-ETH identity fee is THE Sybil bound; it must stay load-bearing.
  await mkRecruit('CapoLapsed', { minted: true, levelled: true, fresh: false });   // quit — retention window
  await mkRecruit('CapoParked', { minted: true, levelled: false, fresh: true });   // a parked signup, never played
  await sweepCapoLicense(pool);
  const n = Number((await pool.query('SELECT capo_recruits FROM account_persistent WHERE account_id=$1', [capo.account])).rows[0].capo_recruits);
  assert.equal(n, 1, 'exactly ONE recruit qualifies — minted AND retained AND levelled (unminted/lapsed/parked all refused)');
  const cb = (await call('GET', '/v1/capo', { token: capo.token })).body;
  assert(cb.agent && cb.recruits === 1 && cb.tier === 'Street Captain' && cb.next.at === 3,
    'the license board reads tier 1 with the next rung disclosed');
  assert(cb.counts.retainDays === 14 && cb.counts.minLevel === 8, 'the board discloses its own terms (the terms-ride-with-the-price rule)');
  // the perks are CAPABILITY, never cash: a licensed agent runs more standing wires. Grant tier 2 by
  // SQL (the sweep is proven above; this leg tests the READ side) and check the wire board's tapMax.
  await pool.query('UPDATE account_persistent SET capo_recruits=3, omr=200 WHERE account_id=$1', [capo.account]);
  const wb = (await call('GET', '/v1/wire', { token: capo.token })).body;
  assert.equal(wb.tapMax, 6, 'Capo tier (3 recruits) adds +1 standing-wire slot on the live board (TAP_MAX 5 + 1)');
  // and the whole license moved ZERO currency — capability perks write no ledger row
  const capoRows = Number((await pool.query(
    "SELECT COUNT(*) n FROM transactions t JOIN characters c ON c.id=t.character_id WHERE c.account_id=$1", [capo.account])).rows[0].n);
  assert.equal(capoRows, 0, "the license is capability, never cash — zero ledger rows for the whole flow");
}

console.log('✅ M4 growth test passed — paths, kitchen (makings/cook/collect/deal/crew/raid/laylow/cleanpapers), heist, missions (+$OMR faucet), dailies (+all-three bonus), First Week (+capstone), referrals (+milestones, agent exclusion), telemetry, mod tools, M8 stat respec (sum-conserving, floor-gated, ledgered burn), THE HUSTLE (the three-stop chain: location gates, legwork delta, ledgered once-a-day payoff), WORD ON THE STREET (per-district seed boards, conflict guaranteed, accept/delta/claim, ledgered corner:job, the MAX_DAY cap) + THE MARK (every job names a victim; residents in your district get named) + THE CAPO\'S LICENSE (agent recruiting perks: minted+retained+levelled gates, the tier board, the wire-slot perk, zero ledger rows)');
await app.close();

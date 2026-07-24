// THE PEN test — the prison meta-game. The yard board, the four inside actions (work → cash faucet +
// sentence cut, commissary shiv sink, protection window, bribe-out sink), and the marquee JAILHOUSE
// SHANK: both-inside gate, no-shiv/family/witpro/protected gates, a deterministic landed kill (full
// estate, no loot, sentence extended), the caught miss, and paid revive-insurance absorption. §10.4
// vocabulary stays closed (pen:* — a bounded work faucet + commissary/protection/bribe sinks). pg-mem.
process.env.MOD_KEY = 'test-mod-key';
process.env.PEN_YARD_EVENT = 'quiet'; // baseline: no yard incident perturbs the step-one tests (overridden per-case below)
process.env.PEN_SHANK_CD_MS = '1';    // TEST-ONLY: shrink the per-attacker shank cooldown (SEARCH_MS precedent) — a dedicated block below restores it to assert the gate
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { PEN, NPC_HITMEN, yardEventOf } from '../src/rules.js';
import { sweepStaleBreaks } from '../src/pen.js';
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
  return { token, id: (await meOf(token)).id };
};
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);
const rawCh = async (id) => (await pool.query(`SELECT * FROM characters WHERE id='${id}'`)).rows[0];
const ledgerOf = async (chId, reason) => Number((await pool.query(
  `SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE character_id='${chId}' AND reason='${reason}'`)).rows[0].s);
const poolCash = async () => Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
const jailFuture = "jail_until = now() + interval '30 minutes'";

// ── the board + the free-player gate ──
const cal = await mk('Convict Cal');
let board = (await call('GET', '/v1/pen', { token: cal.token })).body;
assert.equal(board.inside, false, 'a free man is not inside');
assert.equal(board.commissary.length, PEN.CONTRABAND.length, 'the commissary is stocked');
assert.equal((await call('POST', '/v1/pen/work', { token: cal.token })).body.error, 'free', 'no yard duty on the outside');
assert.equal((await call('POST', '/v1/pen/buy/shiv', { token: cal.token })).body.error, 'free', 'no commissary on the outside');

// ── inside: work the yard (a bounded cash faucet + a good-behaviour sentence cut) ──
await seedCh(cal.id, `${jailFuture}, energy=200, cash=1000000`);
board = (await call('GET', '/v1/pen', { token: cal.token })).body;
assert.equal(board.inside, true, 'now Cal is inside');
assert(board.sentenceSeconds > 0, 'the board shows the sentence');
const sentence0 = board.sentenceSeconds;
let r = await call('POST', '/v1/pen/work', { token: cal.token });
assert.equal(r.code, 200, 'worked the yard');
assert(r.body.pay >= PEN.WORK_PAY[0] && r.body.pay <= PEN.WORK_PAY[1], 'yard pay is in band');
assert.equal(await ledgerOf(cal.id, 'pen:work'), r.body.pay, 'yard work is a ledgered faucet');
assert(r.body.sentenceSeconds <= sentence0 - PEN.WORK_CUT_S + 2, 'good behaviour shaved the sentence');
await seedCh(cal.id, 'energy=5');
assert.equal((await call('POST', '/v1/pen/work', { token: cal.token })).body.error, 'energy', 'no yard duty without the energy');

// ── the commissary: buy a shiv (a cash sink → the guard's pocket → the pool) ──
await seedCh(cal.id, 'energy=200, cash=1000000');
let pool0 = await poolCash();
r = await call('POST', '/v1/pen/buy/shiv', { token: cal.token });
assert.equal(r.code, 200, 'a shiv changes hands');
assert.equal(r.body.cost, PEN.CONTRABAND[0].cost, 'the guard charges the sticker');
assert.equal(await ledgerOf(cal.id, 'pen:commissary'), -PEN.CONTRABAND[0].cost, 'contraband is a ledgered sink');
assert.equal((await poolCash()) - pool0, PEN.CONTRABAND[0].cost, 'the guard’s cut recycles into the pool');
assert.equal((await call('GET', '/v1/pen', { token: cal.token })).body.armed, true, 'Cal is holding');
assert.equal((await call('POST', '/v1/pen/buy/nope', { token: cal.token })).body.error, 'bad_item', 'the guard doesn’t move that');

// ── protection: pay the yard boss for a no-shank window ──
pool0 = await poolCash();
r = await call('POST', '/v1/pen/protection', { token: cal.token });
assert.equal(r.code, 200, 'protection bought');
assert(r.body.protectedSeconds > 0, 'the protection window is live');
assert.equal(await ledgerOf(cal.id, 'pen:protection'), -PEN.PROTECTION_COST, 'protection is a ledgered sink');
assert.equal((await poolCash()) - pool0, PEN.PROTECTION_COST, 'protection money reaches the pool');

// ── bribe the guard: cut the remaining sentence (a cash sink) ──
const preBribe = (await call('GET', '/v1/pen', { token: cal.token })).body.sentenceSeconds;
pool0 = await poolCash();
r = await call('POST', '/v1/pen/bribe', { token: cal.token, body: { seconds: 120 } });
assert.equal(r.code, 200, 'the guard takes the envelope');
assert.equal(r.body.cutSeconds, 120, 'cut the requested time');
assert.equal(r.body.cost, 120 * PEN.BRIBE_PER_S, 'priced per second');
assert.equal(await ledgerOf(cal.id, 'pen:bribe'), -120 * PEN.BRIBE_PER_S, 'the bribe is a ledgered sink');
assert(r.body.sentenceSeconds <= preBribe - 120 + 2, 'the sentence dropped by the bought seconds');
assert.equal((await poolCash()) - pool0, 120 * PEN.BRIBE_PER_S, 'the bribe reaches the pool');
// AUDIT REGRESSION: an EXPLICIT non-positive `seconds` is a clean error, not a silent full-sentence charge
assert.equal((await call('POST', '/v1/pen/bribe', { token: cal.token, body: { seconds: 0 } })).body.error, 'seconds', 'seconds:0 is rejected, not read as "buy it all"');

// ─────────────────────────────────────────────────────────────────────────────
// THE JAILHOUSE SHANK
// ─────────────────────────────────────────────────────────────────────────────
const killer = await mk('Shiv Sam');
const mark = await mk('Marked Marv');
const free = await mk('Free Fred');
await seedCh(killer.id, `${jailFuture}, energy=200, cash=200000, muscle=400`);
await seedCh(mark.id, `${jailFuture}, muscle=5, respect=1250`);

// gates: a free target is out of reach; you need a shiv
assert.equal((await call('POST', `/v1/pen/shank/${free.id}`, { token: killer.token })).body.error, 'target_free', 'no reaching a free man');
assert.equal((await call('POST', `/v1/pen/shank/${mark.id}`, { token: killer.token })).body.error, 'no_shiv', 'no shank without a shiv');
await call('POST', '/v1/pen/buy/shiv', { token: killer.token });

// a protected mark can't be touched (the yard boss covers them)
await seedCh(mark.id, "pen_safe_until = now() + interval '1 hour'");
assert.equal((await call('POST', `/v1/pen/shank/${mark.id}`, { token: killer.token })).body.error, 'protected', 'the yard boss’s man is off-limits');
await seedCh(mark.id, 'pen_safe_until=NULL');
// AUDIT REGRESSION (shield-not-bunker, P1.3): a PROTECTED attacker can't shank either — take the
// yard boss's cover or hunt, not both (mirrors the street safeHoused(ch) actor-guard).
await seedCh(killer.id, "pen_safe_until = now() + interval '1 hour'");
assert.equal((await call('POST', `/v1/pen/shank/${mark.id}`, { token: killer.token })).body.error, 'safe', 'no hunting from under protection');
await seedCh(killer.id, 'pen_safe_until=NULL');

// paid revive insurance still absorbs a landed shank (the shiv is spent, the mark lives)
await seedCh(mark.id, `${jailFuture}`);
await pool.query(`UPDATE account_persistent SET respawn_tokens=1 WHERE account_id=(SELECT account_id FROM characters WHERE id='${mark.id}')`);
process.env.SHANK_P = '1';
r = await call('POST', `/v1/pen/shank/${mark.id}`, { token: killer.token });
assert.equal(r.body.revived, true, 'the mark’s revive insurance pulls them off the brink');
assert(!!(await rawCh(mark.id)).alive, 'the mark lives');
assert.equal(Number((await pool.query(`SELECT respawn_tokens FROM account_persistent WHERE account_id=(SELECT account_id FROM characters WHERE id='${mark.id}')`)).rows[0].respawn_tokens), 0, 'the token was spent');
assert.equal((await pool.query(`SELECT COALESCE(SUM(qty),0) q FROM pen_contraband WHERE character_id='${killer.id}' AND item='shiv'`)).rows[0].q, 0, 'the shiv is gone win or lose');

// a landed shank on an unprotected mark → a body, the full estate, and more time for the killer
await call('POST', '/v1/pen/buy/shiv', { token: killer.token });
await seedCh(killer.id, 'energy=200');
const killerSentence0 = (await call('GET', '/v1/pen', { token: killer.token })).body.sentenceSeconds;
const killerCash0 = Number((await rawCh(killer.id)).cash);
r = await call('POST', `/v1/pen/shank/${mark.id}`, { token: killer.token });
process.env.SHANK_P = undefined; delete process.env.SHANK_P;
assert.equal(r.body.kill, true, 'the blade lands');
assert(r.body.estate && r.body.estate.heirId, 'the estate runs — an heir is born');
assert.equal((await rawCh(mark.id)).alive, false, 'the mark’s street is dead');
assert.equal(Number((await rawCh(killer.id)).cash), killerCash0, 'a shank loots nothing — you can’t strip a man from a cell');
assert(r.body.sentenceSeconds >= killerSentence0 + PEN.KILL_ADD_S - 3, 'a body means more time for the killer');

// the caught miss: the shiv is spent, the killer eats damage + more time, the mark walks
const killer2 = await mk('Clumsy Cliff');
const mark2 = await mk('Lucky Lou');
await seedCh(killer2.id, `${jailFuture}, energy=200, cash=200000, health=100`);
await seedCh(mark2.id, `${jailFuture}, respect=1250`);
await call('POST', '/v1/pen/buy/shiv', { token: killer2.token });
const k2sent0 = (await call('GET', '/v1/pen', { token: killer2.token })).body.sentenceSeconds;
process.env.SHANK_P = '0';
r = await call('POST', `/v1/pen/shank/${mark2.id}`, { token: killer2.token });
delete process.env.SHANK_P;
assert.equal(r.body.caught, true, 'the move is fumbled');
assert(r.body.dmg > 0 && Number((await rawCh(killer2.id)).health) < 100, 'the killer takes the beating');
assert(r.body.sentenceSeconds >= k2sent0 + PEN.CAUGHT_ADD_S - 3, 'getting caught adds time');
assert(!!(await rawCh(mark2.id)).alive, 'the mark walks away');

// ── SIGN-OFF Tier 3: the per-attacker SHANK COOLDOWN ───────────────────────────────────────────
// Energy + a shiv + the sentence extension were the only brakes, so a stocked-up inmate could work
// down a whole wing in one sitting. (The suite runs with PEN_SHANK_CD_MS=1 so the sequences above
// aren't serialised; here we restore the real gate to prove it exists.)
{
  const cd = await mk('Cooldown Carl');
  const mark3 = await mk('Wing Walter');
  await seedCh(cd.id, `${jailFuture}, energy=200, cash=200000, health=100, muscle=90`);
  await seedCh(mark3.id, `${jailFuture}, respect=1250, muscle=1`);
  await call('POST', '/v1/pen/buy/shiv', { token: cd.token });
  await call('POST', '/v1/pen/buy/shiv', { token: cd.token });
  process.env.PEN_SHANK_CD_MS = String(30 * 60 * 1000); // the production value
  process.env.SHANK_P = '0';
  r = await call('POST', `/v1/pen/shank/${mark3.id}`, { token: cd.token });
  assert.equal(r.body.caught, true, 'the first move is made (and fumbled)');
  const board = (await call('GET', '/v1/pen', { token: cd.token })).body;
  assert(board.shankCooldownSeconds > 1700, 'the yard board shows the cooldown running');
  await seedCh(cd.id, 'hole_until=NULL, energy=200'); // walk him out of solitary so the COOLDOWN is what bites
  r = await call('POST', `/v1/pen/shank/${mark3.id}`, { token: cd.token });
  assert.equal(r.body.error, 'cooldown', 'a second move is refused — win or lose, the guards are watching');
  assert.equal((await pool.query(`SELECT COALESCE(SUM(qty),0) q FROM pen_contraband WHERE character_id='${cd.id}' AND item='shiv'`)).rows[0].q, 1,
    'the refused move spends nothing — the second shiv is still in the sock');
  delete process.env.SHANK_P;
  process.env.PEN_SHANK_CD_MS = '1';
}

// AUDIT REGRESSION: a shank is a DIRECT player kill — it FULFILS an open kill contract on the mark
// (like fire, not the hired npcHit), so a hunter who does the wet work in the yard gets paid rather
// than the funder's escrow burning for a $5k shiv.
const funder = await mk('Funder Fay');
const yardKiller = await mk('Yard Yuri');
const contractMark = await mk('Contract Cyril');
await seedCh(funder.id, 'cash=300000');
await seedCh(contractMark.id, 'respect=2000');   // a real target
r = await call('POST', `/v1/streets/${contractMark.id}/bounty`, { token: funder.token, body: { amount: 100000, kind: 'kill' } });
assert.equal(r.code, 200, 'an open kill contract is posted on the mark');
await seedCh(yardKiller.id, `${jailFuture}, energy=200, cash=100000, muscle=400`);
await seedCh(contractMark.id, `${jailFuture}, muscle=5`);   // the mark gets pinched
await call('POST', '/v1/pen/buy/shiv', { token: yardKiller.token });
const ykCash0 = Number((await rawCh(yardKiller.id)).cash);
process.env.SHANK_P = '1';
r = await call('POST', `/v1/pen/shank/${contractMark.id}`, { token: yardKiller.token });
delete process.env.SHANK_P;
assert.equal(r.body.kill, true, 'the yard hit lands');
assert.equal(r.body.bounty, 100000, 'the open kill contract pays out on a shank');
assert.equal(Number((await rawCh(yardKiller.id)).cash) - ykCash0, 100000, 'the shanker collects the contract (wet work paid, escrow not burned)');

// ─────────────────────────────────────────────────────────────────────────────
// STEP TWO — the hole, yard incidents, the burner phone
// ─────────────────────────────────────────────────────────────────────────────
// THE HOLE: a caught shank throws the killer in solitary — no yard actions, and untouchable.
const holed = await mk('Holed Hank');
const holeMark = await mk('Hole Mark');
await seedCh(holed.id, `${jailFuture}, energy=200, cash=200000, health=100`);
await seedCh(holeMark.id, `${jailFuture}, respect=1250`);
await call('POST', '/v1/pen/buy/shiv', { token: holed.token });
process.env.SHANK_P = '0';
r = await call('POST', `/v1/pen/shank/${holeMark.id}`, { token: holed.token });
delete process.env.SHANK_P;
assert.equal(r.body.caught, true, 'the shank is fumbled');
assert(r.body.holeSeconds > 0, 'getting caught earns a stretch in the hole');
let hb = (await call('GET', '/v1/pen', { token: holed.token })).body;
assert(hb.holeSeconds > 0, 'the board shows the hole time');
assert.equal((await call('POST', '/v1/pen/work', { token: holed.token })).body.error, 'hole', 'no yard duty from the hole');
await seedCh(holed.id, 'cash=200000');
assert.equal((await call('POST', '/v1/pen/buy/shiv', { token: holed.token })).body.error, 'hole', 'no commissary from the hole');
// …and a man in the hole can't be shanked (segregated)
const holeHunter = await mk('Hole Hunter');
await seedCh(holeHunter.id, `${jailFuture}, energy=200, cash=200000, muscle=400`);
await call('POST', '/v1/pen/buy/shiv', { token: holeHunter.token });
process.env.SHANK_P = '1';
assert.equal((await call('POST', `/v1/pen/shank/${holed.id}`, { token: holeHunter.token })).body.error, 'segregated', 'nobody reaches a man in the hole');
delete process.env.SHANK_P;
await seedCh(holed.id, 'hole_until=NULL');

// YARD INCIDENTS: deterministic block-wide modifiers (forced via PEN_YARD_EVENT for the test).
// LOCKDOWN freezes the yard — no shanks.
const inc = await mk('Incident Ike');
const incMark = await mk('Incident Mark');
await seedCh(inc.id, `${jailFuture}, energy=200, cash=1000000, muscle=400`);
await seedCh(incMark.id, `${jailFuture}, respect=1250`);
await call('POST', '/v1/pen/buy/shiv', { token: inc.token });
process.env.PEN_YARD_EVENT = 'lockdown';
assert.equal((await call('POST', `/v1/pen/shank/${incMark.id}`, { token: inc.token })).body.error, 'lockdown', 'a lockdown freezes the yard — no shanks');
assert.equal((await call('GET', '/v1/pen', { token: inc.token })).body.incident.id, 'lockdown', 'the board names the incident');
// A CELL TOSS closes the commissary.
process.env.PEN_YARD_EVENT = 'toss';
assert.equal((await call('POST', '/v1/pen/buy/shiv', { token: inc.token })).body.error, 'toss', 'a cell toss shuts the commissary');
// A RIOT halves protection (the board reflects it, the charge is the discounted number).
process.env.PEN_YARD_EVENT = 'riot';
let rb = (await call('GET', '/v1/pen', { token: inc.token })).body;
assert.equal(rb.protectionCost, Math.round(PEN.PROTECTION_COST * 0.5), 'a riot puts cover on sale (board)');
let poolR = await poolCash();
r = await call('POST', '/v1/pen/protection', { token: inc.token });
assert.equal(r.body.cost, Math.round(PEN.PROTECTION_COST * 0.5), 'protection is charged the riot-discounted price');
assert.equal((await poolCash()) - poolR, r.body.cost, 'the discounted number is what reaches the pool');
// A VISIT DAY halves the bribe rate.
process.env.PEN_YARD_EVENT = 'visit';
const preV = (await call('GET', '/v1/pen', { token: inc.token })).body.sentenceSeconds;
r = await call('POST', '/v1/pen/bribe', { token: inc.token, body: { seconds: 60 } });
assert.equal(r.body.cost, 60 * Math.round(PEN.BRIBE_PER_S * 0.5), 'a visit day, the guard takes half');
process.env.PEN_YARD_EVENT = 'quiet';

// THE BURNER PHONE: call in an NPC hit from inside (jail-gated everywhere else).
const caller = await mk('Caller Cass');
const hitMark = await mk('Hit Mark');
await seedCh(caller.id, `${jailFuture}, cash=1000000`);
await seedCh(hitMark.id, 'respect=2000');   // over the NPC-hit level floor, on the outside
// a normal NPC hit from lockup is refused…
assert.equal((await call('POST', `/v1/streets/${hitMark.id}/npchit`, { token: caller.token, body: { tier: 'legbreaker' } })).body.error, 'jailed', 'no arranging wet work from lockup — without a burner');
// …but a burner reaches out. No burner yet → refused.
assert.equal((await call('POST', `/v1/pen/burner/${hitMark.id}`, { token: caller.token, body: { tier: 'legbreaker' } })).body.error, 'no_burner', 'no call without a burner');
await call('POST', '/v1/pen/buy/burner', { token: caller.token });
const feeBurn0 = await ledgerOf(caller.id, 'npchit:hire');
r = await call('POST', `/v1/pen/burner/${hitMark.id}`, { token: caller.token, body: { tier: 'legbreaker' } });
assert.equal(r.code, 200, 'the call goes through from the cell');
assert.equal(r.body.burner, true, 'the burner was used');
assert.equal(await ledgerOf(caller.id, 'npchit:hire'), feeBurn0 - NPC_HITMEN[0].cost, 'the NPC-hit fee burned, win or lose (the street npchit sink)');
assert.equal((await pool.query(`SELECT COALESCE(SUM(qty),0) q FROM pen_contraband WHERE character_id='${caller.id}' AND item='burner'`)).rows[0].q, 0, 'the burner is spent — one call, then you eat the SIM');

// AUDIT REGRESSION: the burner-hit HONOURS the Pen's own defenses — a hole'd or yard-boss-protected
// inmate is untouchable by an NPC hit too (npcHit gates inHole/penSafe, parity with the shank).
const burnKiller = await mk('Burner Bane');
const segTarget = await mk('Seg Target');
await seedCh(burnKiller.id, `${jailFuture}, cash=2000000`);
await seedCh(segTarget.id, `${jailFuture}, respect=1250`);   // jailed + over the NPC-hit level floor
await call('POST', '/v1/pen/buy/burner', { token: burnKiller.token });
await seedCh(segTarget.id, "hole_until = now() + interval '20 minutes'");
assert.equal((await call('POST', `/v1/pen/burner/${segTarget.id}`, { token: burnKiller.token, body: { tier: 'legbreaker' } })).body.error, 'segregated', 'no burner-hit reaches a man in the hole');
await seedCh(segTarget.id, "hole_until=NULL, pen_safe_until = now() + interval '1 hour'");
assert.equal((await call('POST', `/v1/pen/burner/${segTarget.id}`, { token: burnKiller.token, body: { tier: 'legbreaker' } })).body.error, 'protected', 'no burner-hit reaches a protected inmate');
assert.equal((await pool.query(`SELECT COALESCE(SUM(qty),0) q FROM pen_contraband WHERE character_id='${burnKiller.id}' AND item='burner'`)).rows[0].q, 1, 'a refused call rolls back — the burner is NOT spent');
await seedCh(segTarget.id, 'pen_safe_until=NULL');
// AUDIT REGRESSION: shield-not-bunker — a PROTECTED inmate can't burner-hit either
await seedCh(burnKiller.id, "pen_safe_until = now() + interval '1 hour'");
assert.equal((await call('POST', `/v1/pen/burner/${segTarget.id}`, { token: burnKiller.token, body: { tier: 'legbreaker' } })).body.error, 'safe', 'no hunting by phone from under protection');
await seedCh(burnKiller.id, 'pen_safe_until=NULL');
// AUDIT REGRESSION: a LOCKDOWN freezes an INSIDE burner-kill, but an OUTSIDE call still goes through
const outsideMark = await mk('Outside Otto');
await seedCh(outsideMark.id, 'respect=2000');   // free, over the floor
process.env.PEN_YARD_EVENT = 'lockdown';
assert.equal((await call('POST', `/v1/pen/burner/${segTarget.id}`, { token: burnKiller.token, body: { tier: 'legbreaker' } })).body.error, 'lockdown', 'lockdown freezes an inside burner-kill');
r = await call('POST', `/v1/pen/burner/${outsideMark.id}`, { token: burnKiller.token, body: { tier: 'legbreaker' } });
assert.equal(r.code, 200, 'the burner still reaches an OUTSIDE target during a lockdown (it’s a phone call)');
process.env.PEN_YARD_EVENT = 'quiet';

// AUDIT REGRESSION: the hole can't outlast the sentence (no leak into a future re-jail)
const shortTimer = await mk('Short Timer');
const stMark = await mk('ST Mark');
await seedCh(shortTimer.id, "jail_until = now() + interval '10 seconds', energy=200, cash=200000, health=100");
await seedCh(stMark.id, `${jailFuture}, respect=1250`);
await call('POST', '/v1/pen/buy/shiv', { token: shortTimer.token });
process.env.SHANK_P = '0';
await call('POST', `/v1/pen/shank/${stMark.id}`, { token: shortTimer.token });
delete process.env.SHANK_P;
const stRow = await rawCh(shortTimer.id);
assert(new Date(stRow.hole_until) <= new Date(stRow.jail_until), 'the hole is capped at the sentence — it can’t leak into a future stretch');

// ── STEP THREE — THE BREAKOUT: burn a cutkit, go over the wall (a WANTED fugitive on a win) ──
process.env.PEN_YARD_EVENT = 'quiet';
const runner = await mk('Runner Ricky');
assert.equal((await call('POST', '/v1/pen/break', { token: runner.token })).body.error, 'free', 'no breakout on the outside');
await seedCh(runner.id, `${jailFuture}, energy=200, cash=1000000, health=100`);
assert.equal((await call('POST', '/v1/pen/break', { token: runner.token })).body.error, 'no_kit', 'no wall to go over without a cutkit');
const poolB0 = await poolCash();
r = await call('POST', '/v1/pen/buy/cutkit', { token: runner.token });
assert.equal(r.code, 200, 'the guard moves a hacksaw & rope');
assert.equal((await poolCash()) - poolB0, PEN.CONTRABAND[2].cost, 'the cutkit cash reaches the pool (a ledgered commissary sink)');
process.env.PEN_YARD_EVENT = 'lockdown';
assert.equal((await call('POST', '/v1/pen/break', { token: runner.token })).body.error, 'lockdown', 'no going over the wall during a lockdown');
process.env.PEN_YARD_EVENT = 'quiet';
// FORCED FAIL — caught at the fence: the hole + a longer stretch + a beating, the kit spent, NOT wanted
const preSent = await rawCh(runner.id);
process.env.PEN_BREAK_P = '0';
r = await call('POST', '/v1/pen/break', { token: runner.token });
delete process.env.PEN_BREAK_P;
assert.equal(r.body.escaped, false, 'the roll catches him at the fence');
assert(r.body.caught && r.body.holeSeconds > 0, 'caught → the hole');
let rr = await rawCh(runner.id);
assert(new Date(rr.jail_until) > new Date(preSent.jail_until), 'a caught break adds a long stretch');
assert(Number(rr.health) < 100, 'and a beating');
assert.equal((await pool.query(`SELECT COALESCE(SUM(qty),0) q FROM pen_contraband WHERE character_id='${runner.id}' AND item='cutkit'`)).rows[0].q, 0, 'the kit is spent win or lose');
assert(!rr.wanted_until || new Date(rr.wanted_until) <= new Date(), 'a FAILED break does not make you a fugitive');
// FORCED WIN — over the wall: the sentence clears, but he walks out a WANTED fugitive
const runner2 = await mk('Runner Two');
await seedCh(runner2.id, `${jailFuture}, energy=200, cash=1000000, health=100, heat=0`);
await call('POST', '/v1/pen/buy/cutkit', { token: runner2.token });
process.env.PEN_BREAK_P = '1';
r = await call('POST', '/v1/pen/break', { token: runner2.token });
delete process.env.PEN_BREAK_P;
assert.equal(r.body.escaped, true, 'over the wall');
assert(r.body.wantedSeconds > 0, 'and WANTED now');
rr = await rawCh(runner2.id);
assert(!rr.jail_until || new Date(rr.jail_until) <= new Date(), 'the sentence is cleared — he walked');
assert(rr.wanted_until && new Date(rr.wanted_until) > new Date(), 'he is a hunted fugitive (wanted_until set — omertà stripped + NPC hunters key on it)');
assert(Number(rr.heat) >= PEN.BREAK_HEAT, 'the alarm raised his heat');
assert.equal((await call('GET', '/v1/me', { token: runner2.token })).body.character.wanted, true, 'the escapee reads WANTED on the sheet');

// ── STEP FOUR — THE CO-OP BREAKOUT: a crew of inmates over the wall together ──
process.env.PEN_YARD_EVENT = 'quiet';
const cl = await mk('Crew Leader');
const c1 = await mk('Crew One');
const c2 = await mk('Crew Two');
await seedCh(cl.id, `${jailFuture}, energy=200, cash=1000000, health=100, heat=0`);
await seedCh(c1.id, `${jailFuture}, energy=100, health=100, heat=0`);
await seedCh(c2.id, `${jailFuture}, energy=100, health=100, heat=0`);
const freeGuy = await mk('Free Guy');
assert.equal((await call('POST', '/v1/pen/break/plan', { token: freeGuy.token })).body.error, 'free', 'no crew break on the outside');
assert.equal((await call('POST', '/v1/pen/break/plan', { token: cl.token })).body.error, 'no_kit', 'a crew break needs a cutkit');
await call('POST', '/v1/pen/buy/cutkit', { token: cl.token });
const plan = await call('POST', '/v1/pen/break/plan', { token: cl.token });
assert.equal(plan.code, 200, 'the leader opens a break'); const bid = plan.body.id;
assert.equal((await pool.query(`SELECT COALESCE(SUM(qty),0) q FROM pen_contraband WHERE character_id='${cl.id}' AND item='cutkit'`)).rows[0].q, 0, 'the cutkit is staked into the break');
assert.equal((await call('POST', `/v1/pen/break/${bid}/go`, { token: cl.token })).body.error, 'crew_short', 'a break needs the minimum crew');
assert.equal((await call('POST', `/v1/pen/break/${bid}/join`, { token: c1.token })).code, 200, 'one joins');
assert.equal((await call('POST', `/v1/pen/break/${bid}/join`, { token: c2.token })).code, 200, 'two joins');
const cboard = (await call('GET', '/v1/pen/breaks', { token: c1.token })).body;
assert(cboard.mine && cboard.mine.crew.length === 3, 'the board shows the full crew to a member');
assert.equal((await call('POST', `/v1/pen/break/${bid}/go`, { token: c1.token })).body.error, 'not_leader', 'only the leader calls the go');
process.env.PEN_BREAK_P = '1';
const go = await call('POST', `/v1/pen/break/${bid}/go`, { token: cl.token });
delete process.env.PEN_BREAK_P;
assert.equal(go.body.escaped, true, 'over the wall'); assert.equal(go.body.crew, 3, 'three walked');
for (const m of [cl, c1, c2]) {
  const row = await rawCh(m.id);
  assert(!row.jail_until || new Date(row.jail_until) <= new Date(), 'a member sentence cleared');
  assert(row.wanted_until && new Date(row.wanted_until) > new Date(), 'the whole crew walks out WANTED');
  assert(Number(row.heat) >= PEN.BREAK_HEAT, 'the alarm spiked everyone\'s heat');
}
assert.equal((await pool.query(`SELECT status FROM pen_breaks WHERE id='${bid}'`)).rows[0].status, 'done', 'the break is resolved');
// AUDIT HIGH: a resolved break DELETES its memberships, so a survivor isn't perma-bricked by the
// UNIQUE(character_id) — re-jailed, they can plan a fresh break (pre-fix this 23505'd into 'contention').
assert.equal((await pool.query(`SELECT COUNT(*) n FROM pen_break_members WHERE character_id='${cl.id}'`)).rows[0].n, 0, 'a resolved break clears its member rows');
await seedCh(cl.id, `${jailFuture}, cash=1000000, wanted_until=NULL`);
await call('POST', '/v1/pen/buy/cutkit', { token: cl.token });
const replan = await call('POST', '/v1/pen/break/plan', { token: cl.token });
assert.equal(replan.code, 200, 'a survivor can plan another break — not perma-bricked (audit HIGH)');
await call('POST', `/v1/pen/break/${replan.body.id}/leave`, { token: cl.token }); // disband to leave state clean for later cases
// FORCED FAIL — the whole crew eats the hole + a longer stretch
const fl = await mk('Fail Leader'); const f1 = await mk('Fail One');
await seedCh(fl.id, `${jailFuture}, energy=200, cash=1000000, health=100`);
await seedCh(f1.id, `${jailFuture}, energy=100, health=100`);
await call('POST', '/v1/pen/buy/cutkit', { token: fl.token });
const fplan = (await call('POST', '/v1/pen/break/plan', { token: fl.token })).body.id;
await call('POST', `/v1/pen/break/${fplan}/join`, { token: f1.token });
const fpre = await rawCh(f1.id);
process.env.PEN_BREAK_P = '0';
const fgo = await call('POST', `/v1/pen/break/${fplan}/go`, { token: fl.token });
delete process.env.PEN_BREAK_P;
assert.equal(fgo.body.escaped, false, 'caught at the fence');
for (const m of [fl, f1]) {
  const row = await rawCh(m.id);
  assert(new Date(row.hole_until) > new Date(), 'the whole crew is in the hole');
  assert(new Date(row.jail_until) > new Date(fpre.jail_until), 'and eats a longer stretch');
}
// DISBAND — the leader walking refunds the staked cutkit
const dl = await mk('Disband Leader');
await seedCh(dl.id, `${jailFuture}, cash=1000000`);
await call('POST', '/v1/pen/buy/cutkit', { token: dl.token });
const dplan = (await call('POST', '/v1/pen/break/plan', { token: dl.token })).body.id;
assert.equal((await call('POST', `/v1/pen/break/${dplan}/leave`, { token: dl.token })).body.disbanded, true, 'the leader disbands');
assert.equal((await pool.query(`SELECT COALESCE(SUM(qty),0) q FROM pen_contraband WHERE character_id='${dl.id}' AND item='cutkit'`)).rows[0].q, 1, 'the staked cutkit comes back on disband');
// STALE SWEEP — an abandoned plan refunds a living leader's cutkit
const sl = await mk('Stale Leader');
await seedCh(sl.id, `${jailFuture}, cash=1000000`);
await call('POST', '/v1/pen/buy/cutkit', { token: sl.token });
const splan = (await call('POST', '/v1/pen/break/plan', { token: sl.token })).body.id;
await pool.query(`UPDATE pen_breaks SET created_at = now() - interval '2 hours' WHERE id='${splan}'`);
const sw = await sweepStaleBreaks(pool);
assert(sw.swept >= 1, 'the sweep abandons the stale plan');
assert.equal((await pool.query(`SELECT COALESCE(SUM(qty),0) q FROM pen_contraband WHERE character_id='${sl.id}' AND item='cutkit'`)).rows[0].q, 1, 'a living leader gets the cutkit back on sweep');

// AUDIT L2: a dead break-leader's plan is abandoned AT DEATH (not left for the 1h sweep) so the
// stranded crew are freed to plan a fresh break immediately
const dkl = await mk('Doomed Leader'); const dm = await mk('Doomed Member');
await seedCh(dkl.id, `${jailFuture}, cash=1000000`);
await seedCh(dm.id, `${jailFuture}, cash=1000000`);
await call('POST', '/v1/pen/buy/cutkit', { token: dkl.token });
const dkPlan = (await call('POST', '/v1/pen/break/plan', { token: dkl.token })).body.id;
assert.equal((await call('POST', `/v1/pen/break/${dkPlan}/join`, { token: dm.token })).code, 200, 'the doomed member joins');
await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: dkl.id }, headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal((await pool.query(`SELECT status FROM pen_breaks WHERE id='${dkPlan}'`)).rows[0].status, 'abandoned', 'the dead leader\'s break is abandoned at death');
await seedCh(dm.id, `${jailFuture}, cash=1000000`); // the survivor is still jailed
await call('POST', '/v1/pen/buy/cutkit', { token: dm.token });
assert.equal((await call('POST', '/v1/pen/break/plan', { token: dm.token })).code, 200, 'the freed member can plan a fresh break, not bricked by the dead leader\'s plan');

// ══ STEP FIVE — PRISON FACTIONS + SHOT-CALLERS ══
const fal = await mk('Faction Al'); const fbo = await mk('Faction Bo'); const fcy = await mk('Faction Cy');
await seedCh(fal.id, `${jailFuture}, energy=200`); await seedCh(fbo.id, `${jailFuture}`); await seedCh(fcy.id, `${jailFuture}`);
const freeFred = await mk('Yardless Yuri');
assert.equal((await call('POST', '/v1/pen/faction/northside', { token: freeFred.token })).body.error, 'free', 'no yard crew on the outside');
assert.equal((await call('POST', '/v1/pen/faction/nope', { token: fal.token })).body.error, 'bad_faction', 'no such crew runs this yard');
assert.equal((await call('POST', '/v1/pen/faction/northside', { token: fal.token })).code, 200, 'Al runs with the Northside Crew');
assert.equal((await call('POST', '/v1/pen/faction/northside', { token: fbo.token })).code, 200, 'Bo runs with him');
assert.equal((await call('POST', '/v1/pen/faction/muertos', { token: fcy.token })).code, 200, 'Cy runs with Los Muertos');
assert.equal((await call('POST', '/v1/pen/faction/northside', { token: fal.token })).body.error, 'already', 'no double-join');
// the board surfaces your crew + the cover it buys: 1 mate (8%) + the shot-caller bonus (Al ties on kills)
board = (await call('GET', '/v1/pen', { token: fal.token })).body;
assert.equal(board.faction.id, 'northside', 'the board shows your crew');
assert.equal(board.faction.mates, 1, 'one fellow inmate in the crew (Bo)');
assert.equal(board.faction.shotCaller, true, 'Al is the shot-caller (nobody out-kills him yet)');
assert.equal(board.faction.cover, Math.round((PEN.FACTION_COVER + PEN.SHOTCALLER_COVER) * 100), 'cover = one mate + the shot-caller leadership');
// SHOT-CALLER moves to the most-feared: give Bo kills → Bo calls the shots, Al loses the leadership cover
await seedCh(fbo.id, 'season_kills=5');
board = (await call('GET', '/v1/pen', { token: fal.token })).body;
assert.equal(board.faction.shotCaller, false, 'Al is no longer the shot-caller');
assert.equal(board.faction.cover, Math.round(PEN.FACTION_COVER * 100), 'so Al keeps just the one-mate cover');
assert.equal((await call('GET', '/v1/pen', { token: fbo.token })).body.faction.shotCaller, true, 'Bo now calls the shots');
// YARD OMERTÀ: you don't move on your own crew (fires before the shiv check); a rival crew is fair game
assert.equal((await call('POST', `/v1/pen/shank/${fbo.id}`, { token: fal.token })).body.error, 'crew', "you don't shank your own crew");
assert.equal((await call('POST', `/v1/pen/shank/${fcy.id}`, { token: fal.token })).body.error, 'no_shiv', 'a rival crew is fair game — blocked only for want of a shiv, not omertà');
assert.equal((await call('POST', '/v1/pen/faction', { token: fcy.token })).body.left, 'muertos', 'Cy walks away from his crew');

// ══ STEP FIVE — THE BREAK RAT (the heist-rat twin) ══
const ratLd = await mk('Rat Leader'); const ratMn = await mk('The Rat');
await seedCh(ratLd.id, "jail_until = now() + interval '4 hours', cash=1000000, energy=200, health=100");
await seedCh(ratMn.id, "jail_until = now() + interval '4 hours', cash=1000000, energy=200, health=100");
await call('POST', '/v1/pen/buy/cutkit', { token: ratLd.token });
const rplan = (await call('POST', '/v1/pen/break/plan', { token: ratLd.token })).body.id;
assert.equal((await call('POST', `/v1/pen/break/${rplan}/join`, { token: ratMn.token })).code, 200, 'the rat joins the crew');
assert.equal((await call('POST', `/v1/pen/break/${rplan}/rat`, { token: ratMn.token })).code, 200, 'the rat quietly tips the guards');
const ratLdJail0 = new Date((await rawCh(ratLd.id)).jail_until).getTime();
const ratMnJail0 = new Date((await rawCh(ratMn.id)).jail_until).getTime();
process.env.PEN_BREAK_P = '1'; // even a guaranteed-success roll can't save a ratted break — it blows first
const rgo = await call('POST', `/v1/pen/break/${rplan}/go`, { token: ratLd.token });
delete process.env.PEN_BREAK_P;
assert.equal(rgo.body.blown, true, 'a ratted break BLOWS — the guards were waiting');
assert.equal(rgo.body.escaped, false, 'nobody goes over the wall');
assert(/talked/i.test(rgo.body.message || ''), 'the feed only says somebody talked (the rat is never named)');
const ratLdAfter = await rawCh(ratLd.id), ratMnAfter = await rawCh(ratMn.id);
assert(new Date(ratLdAfter.hole_until) > new Date(), 'the honest leader is thrown in the hole');
assert(new Date(ratLdAfter.jail_until).getTime() > ratLdJail0, 'and eats a longer stretch');
// the RAT's deal is RELIEF-ONLY (audit): they dodge the crew's added stretch + beating, but serve their
// OWN sentence unchanged — never LESS. So join-and-rat is never better than abstaining (a Sybil main+alt
// can't farm a cheap sentence trim); the rat still fares better than the honest crew who eat the longer stretch.
assert(Math.abs(new Date(ratMnAfter.jail_until).getTime() - ratMnJail0) < 1000, 'the RAT serves their OWN sentence — no cut below it (Sybil-farm-proof, relief-only)');
assert(new Date(ratMnAfter.jail_until).getTime() < new Date(ratLdAfter.jail_until).getTime(), 'but still fares better than the honest crew (who eat the longer stretch)');
assert(new Date(ratMnAfter.hole_until) > new Date(), 'and is holed WITH the crew so the roster never outs them');

// ── §10.4: the Pen vocabulary is closed ──
const vocab = (await runLedgerInvariants(pool)).checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `pen:* rides the §10.4 vocabulary (${JSON.stringify(vocab.unknown || [])})`);

// ── SIGN-OFF (Pen T3): 'quiet' is weighted up so the yard isn't hard-blocked ~40% of days ──
let quietDays = 0, blockDays = 0;
for (let d = 0; d < 300; d++) { const e = yardEventOf(d); if (e.id === 'quiet') quietDays++; if (e.shankBlock || e.commissaryClosed) blockDays++; }
assert(quietDays / 300 > 0.35, `quiet days are weighted up (${quietDays}/300 ≈ ${Math.round(quietDays / 3)}%, was ~14% uniform)`);
assert(blockDays / 300 < 0.25, `hard-block days (lockdown/toss) are diluted below a quarter (${blockDays}/300)`);

console.log('✅ test/pen.js — the prison meta-game + step two (the hole, yard incidents, the burner phone) + step three THE BREAKOUT (cutkit sink, free/no-kit/lockdown gates, forced fail → the hole + longer stretch + beating + kit spent + NOT wanted, forced win → sentence cleared + WANTED fugitive + heat spike) + step four THE CO-OP BREAKOUT (plan stakes a cutkit, crew joins, crew_short/not_leader gates, forced win → the whole crew out + WANTED, forced fail → the whole crew in the hole + longer stretch, leader-disband + stale-sweep refund the staked kit) + step five PRISON FACTIONS (join/leave, free/bad/already gates, the board cover + SHOT-CALLER derivation moving to the most-feared, yard omertà blocking a same-crew shank while a rival stays fair game) + THE BREAK RAT (a crew member tips the guards → the break blows, the honest crew eats the hole + a longer stretch, the rat cuts a deal for time OFF but is holed WITH the crew so the roster never outs them, the feed only says somebody talked)');
process.exit(0);

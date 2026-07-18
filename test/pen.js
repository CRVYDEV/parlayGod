// THE PEN test — the prison meta-game. The yard board, the four inside actions (work → cash faucet +
// sentence cut, commissary shiv sink, protection window, bribe-out sink), and the marquee JAILHOUSE
// SHANK: both-inside gate, no-shiv/family/witpro/protected gates, a deterministic landed kill (full
// estate, no loot, sentence extended), the caught miss, and paid revive-insurance absorption. §10.4
// vocabulary stays closed (pen:* — a bounded work faucet + commissary/protection/bribe sinks). pg-mem.
process.env.MOD_KEY = 'test-mod-key';
process.env.PEN_YARD_EVENT = 'quiet'; // baseline: no yard incident perturbs the step-one tests (overridden per-case below)
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { PEN, NPC_HITMEN } from '../src/rules.js';
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
await seedCh(mark.id, `${jailFuture}, muscle=5, respect=500`);

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
await seedCh(mark2.id, `${jailFuture}, respect=500`);
await call('POST', '/v1/pen/buy/shiv', { token: killer2.token });
const k2sent0 = (await call('GET', '/v1/pen', { token: killer2.token })).body.sentenceSeconds;
process.env.SHANK_P = '0';
r = await call('POST', `/v1/pen/shank/${mark2.id}`, { token: killer2.token });
delete process.env.SHANK_P;
assert.equal(r.body.caught, true, 'the move is fumbled');
assert(r.body.dmg > 0 && Number((await rawCh(killer2.id)).health) < 100, 'the killer takes the beating');
assert(r.body.sentenceSeconds >= k2sent0 + PEN.CAUGHT_ADD_S - 3, 'getting caught adds time');
assert(!!(await rawCh(mark2.id)).alive, 'the mark walks away');

// AUDIT REGRESSION: a shank is a DIRECT player kill — it FULFILS an open kill contract on the mark
// (like fire, not the hired npcHit), so a hunter who does the wet work in the yard gets paid rather
// than the funder's escrow burning for a $5k shiv.
const funder = await mk('Funder Fay');
const yardKiller = await mk('Yard Yuri');
const contractMark = await mk('Contract Cyril');
await seedCh(funder.id, 'cash=300000');
await seedCh(contractMark.id, 'respect=800');   // a real target
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
await seedCh(holeMark.id, `${jailFuture}, respect=500`);
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
await seedCh(incMark.id, `${jailFuture}, respect=500`);
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
await seedCh(hitMark.id, 'respect=800');   // over the NPC-hit level floor, on the outside
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

// ── §10.4: the Pen vocabulary is closed ──
const vocab = (await runLedgerInvariants(pool)).checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `pen:* rides the §10.4 vocabulary (${JSON.stringify(vocab.unknown || [])})`);

console.log('✅ test/pen.js — the prison meta-game + step two (the hole, yard incidents, the burner phone)');
process.exit(0);

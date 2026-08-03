// THE POPULATION test (the 47th suite) — NPC residents of the city.
// Design: omerta-npc-population-design.md. Covers: spawn (real character + flagged account, banded
// level/stats/cash), the §10.4 ledger discipline (npc:seed is a ledgered FAUCET so residents sit
// inside the per-character cash check exactly like a player; npc:retire burns what they carried),
// the worker top-up to TARGET, retirement of old bloodlines, presence on the streets roster with the
// flag EXPOSED, and — the four that matter most — that a resident never holds $OMR (the Street Wage
// was the sharp edge of that until the faucet retired), City Standing, ops and the onboarding funnel.
//
// NOTE ON SEEDING: this suite never SQL-seeds value. Resident cash arrives through the ledgered
// `npc:seed` faucet inside spawnResident, which is the whole point — the §10.4 assertions below are
// only meaningful because nothing here writes cash behind the ledger's back.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { buildServer } from '../src/server.js';
import { boxingBoard } from '../src/boxing.js';
import { spawnResident, retireResident, runPopulation, population, runResidentBehaviour, residentAct, seededToday, runFamilies } from '../src/population.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { cityStanding } from '../src/standing.js';
import { funnelStats } from '../src/growth.js';
import { joinGang, removeMember } from '../src/social/gangs.js';
import { opsOverview } from '../src/ops.js';
import { POPULATION, levelOf, npcBandOf, M3, DUELS, CASINO, BOXING, STABLE } from '../src/rules.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body, headers } = {}) => {
  const res = await app.inject({ method, url,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers || {}) }, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const id = (await call('GET', '/v1/me', { token })).body.character.id;
  return { token, id };
};
const one = async (q, p = []) => Number((await pool.query(q, p)).rows[0].n);
const driftOf = async (name) => {
  const r = await runLedgerInvariants(pool, { alert: false });
  const c = r.checks.find((x) => x.name === name);
  assert(c, `check ${name} exists`);
  return Number(c.drift);
};
const tx = async (id) => one('SELECT COALESCE(SUM(amount),0) n FROM transactions WHERE character_id=$1 AND currency=$2', [id, 'cash']);

// ── a real player, so every exclusion below has something REAL to keep counting ──
const player = await mk('Frankie Real');

// ════════════ SPAWN — a resident is a real character on a flagged account ════════════
const cashDrift0 = await driftOf('character cash');
const client = await pool.connect();
await client.query('BEGIN');
const born = await spawnResident(client, { band: POPULATION.BANDS.find((b) => b.id === 'made') });
await client.query('COMMIT');
client.release();
assert(born && born.id, 'a resident was born');

const row = (await pool.query('SELECT * FROM characters WHERE id=$1', [born.id])).rows[0];
assert.equal(row.is_npc, true, 'the character carries is_npc');
assert.equal(row.alive, true, 'and is walking around');
assert(/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(row.name), `a noir name (got ${row.name})`);
const lvl = levelOf(Number(row.respect));
assert(lvl >= 10 && lvl <= 24, `the "made" band levels 10-24 (got ${lvl})`);
assert(Number(row.cash) >= 2000 && Number(row.cash) <= 12000, `banded seed cash (got ${row.cash})`);
const acct = (await pool.query('SELECT * FROM account_persistent WHERE account_id=$1', [row.account_id])).rows[0];
assert.equal(acct.npc_flag, true, 'the ACCOUNT carries npc_flag (the agent_flag twin)');
assert.equal(acct.agent_flag, false, 'a resident is NOT an agent — separate axes');
const provider = (await pool.query('SELECT auth_provider p FROM accounts WHERE id=$1', [row.account_id])).rows[0].p;
assert.equal(provider, 'npc', "the account's provider marks it");

// §10.4 — the seed is LEDGERED, so a resident reconciles like any player
assert.equal(await tx(born.id), Number(row.cash) - 500, 'npc:seed ledgers the whole balance above the base 500');
assert.equal(await driftOf('character cash'), cashDrift0, 'the per-character cash check is UNMOVED by a spawn');
const seeds = await one("SELECT COUNT(*) n FROM transactions WHERE reason='npc:seed'");
assert.equal(seeds, 1, 'exactly one seed row');

// ════════════ THE STREETS — present, and honestly flagged ════════════
const streets = (await call('GET', '/v1/streets', { token: player.token })).body.streets;
const onStreet = streets.find((s) => s.id === born.id);
assert(onStreet, 'the resident is on the streets roster — the empty-board problem is the whole point');
assert.equal(onStreet.npc, true, 'and the flag is EXPOSED, not hidden (real-money game: no passing scenery off as people)');
assert.equal(streets.find((s) => s.id === player.id).npc, false, 'a real player is not flagged');

// ════════════ THE EXCLUSIONS — the human-only surfaces ════════════
// (1) $OMR — a resident must never hold any. The Street Wage used to be the sharp edge of this
// (a resident drawing it was theft from the endowment) and the payer is retired with the whole
// faucet (economy v3 step 1), so the claim is now the stronger one: NOTHING pays a resident $OMR.
// Marked MINTED deliberately — that was the wage's own Sybil wall, so a minted resident is the
// hardest case any future $OMR grant would face.
await pool.query("UPDATE account_persistent SET minted=true WHERE account_id=$1", [row.account_id]);
const npcOmrRows = await one("SELECT COUNT(*) n FROM transactions WHERE character_id=$1 AND currency='omr'", [born.id]);
assert.equal(npcOmrRows, 0, 'a resident is never credited $OMR by anything');
const npcOmr = await one('SELECT COALESCE(omr,0) n FROM account_persistent WHERE account_id=$1', [row.account_id]);
assert.equal(npcOmr, 0, 'and holds no $OMR');

// (2) CITY STANDING — the human "who's winning" spine
const standing = await cityStanding(pool);
assert(Array.isArray(standing), 'cityStanding returns the ranked board');
assert(!standing.some((s) => s.name === row.name), 'residents are absent from City Standing');
assert(standing.some((s) => s.name === 'Frankie Real'), '…while the real player is on it');

// (3) OPS — the founder's real-player counts
const ops = await opsOverview(pool);
assert.equal(ops.players.alive, 1, 'ops counts ONE alive player (the resident is not a player)');
assert.equal(ops.players.residents, 1, '…and reports the city headcount separately');

// (4) THE ONBOARDING FUNNEL
const funnel = await funnelStats(pool);
assert.equal(funnel.characters.alive, 1, 'the funnel measures real players only');

// ════════════ DEATH — the heir IS the respawn (no new death path) ════════════
// The design's central simplification: a killed resident runs the ORDINARY estate, and the heir —
// same name, generation+1 — takes the corner. social.js needs zero NPC branches and the population
// self-heals. Driven here through mod-kill because it's deterministic; a player fire-kill is the
// same runEstate with loot on top (exercised exhaustively against players in test/social.js).
const doomedAcct = row.account_id;
const killRes = await call('POST', '/v1/mod/kill', { headers: { 'x-mod-key': 'test-mod-key' }, body: { characterId: born.id, reason: 'test' } });
assert.equal(killRes.code, 200, `a resident dies through the ordinary estate: ${JSON.stringify(killRes.body)}`);
const heir = (await pool.query('SELECT name, generation, is_npc FROM characters WHERE account_id=$1 AND alive', [doomedAcct])).rows[0];
assert(heir, 'the bloodline continues — an heir was born');
assert.equal(heir.name, row.name, 'same name (the bloodline)');
assert.equal(Number(heir.generation), 2, 'generation 2 — "Sal Fontana II takes the corner"');
assert.equal(heir.is_npc, true, 'and the heir is still a resident, so headcount self-heals');
assert.equal(await driftOf('character cash'), cashDrift0, 'the estate keeps §10.4 exact over a resident death');

// re-spawn a fresh resident for the retirement leg below (the heir above is a different character)
const c1b = await pool.connect();
await c1b.query('BEGIN');
const born2 = await spawnResident(c1b, { band: POPULATION.BANDS.find((b) => b.id === 'made') });
await c1b.query('COMMIT');
c1b.release();

// ════════════ RETIREMENT — the books close exactly ════════════
const heldBefore = Number((await pool.query('SELECT cash FROM characters WHERE id=$1', [born2.id])).rows[0].cash);
const born2Acct = (await pool.query('SELECT account_id a FROM characters WHERE id=$1', [born2.id])).rows[0].a;
const c2 = await pool.connect();
await c2.query('BEGIN');
const gone = await retireResident(c2, born2.id);
await c2.query('COMMIT');
c2.release();
assert.equal(gone.burned, heldBefore, 'retirement burns exactly what they carried');
assert.equal(await tx(born2.id), -500, 'the ledger nets to −500 (the un-ledgered base every character starts with)');
assert.equal(await driftOf('character cash'), cashDrift0, 'and the per-character cash check is STILL unmoved');
assert.equal(await one('SELECT COUNT(*) n FROM characters WHERE id=$1 AND alive', [born2.id]), 0, 'the resident is gone');
assert.equal(await one('SELECT COUNT(*) n FROM characters WHERE account_id=$1 AND alive', [born2Acct]), 0,
  'and leaves NO heir — retirement makes room, unlike a killing');

// ════════════ THE WORKER — keep the city topped up ════════════
const head0 = await population(pool);   // the killed resident's HEIR is alive and still a resident
const tick1 = await runPopulation(pool);
assert.equal(tick1.spawned, POPULATION.SPAWN_PER_TICK, 'a tick spawns at most SPAWN_PER_TICK (the city fills in visibly)');
assert.equal(await population(pool), head0 + POPULATION.SPAWN_PER_TICK, 'headcount climbs');
await runPopulation(pool);
assert.equal(await population(pool), head0 + POPULATION.SPAWN_PER_TICK * 2, 'and keeps climbing toward TARGET');
assert.equal(await driftOf('character cash'), cashDrift0, '§10.4 holds across a populated city');

// retirement of old bloodlines — a line past RETIRE_GENERATIONS is culled, capping death:legacy creep
await pool.query('UPDATE characters SET generation=$1 WHERE is_npc AND alive',
  [POPULATION.RETIRE_GENERATIONS + 1]);
const before = await population(pool);
const tick3 = await runPopulation(pool);
assert(tick3.retired > 0, 'the worker retires bloodlines past RETIRE_GENERATIONS');
assert.equal(await driftOf('character cash'), cashDrift0, 'and the burn keeps §10.4 exact');
assert(await population(pool) <= before + POPULATION.SPAWN_PER_TICK, 'headcount stays bounded');

// ════════════ STEP TWO — THE CITY ACTS ════════════
// The one rule: a resident may only ever RECYCLE value it already holds, never conjure it at the
// point of sale. So every behaviour below is either zero-value (consent limits, drift) or parks
// already-seeded cash in an EXISTING audited escrow — NO new faucet, NO new §10.4 reason.
const escrowDrift = async () => {
  const r = await runLedgerInvariants(pool, { alert: false });
  return r.checks.filter((c) => /escrow/.test(c.name)).map((c) => `${c.name}:${c.drift}`).join(' ');
};
const escrow0 = await escrowDrift();

// Give every standing resident MANY turns, and make sure there are enough of them. Both matter, and
// for different reasons — this block asserts that specific boards light up, and each assertion has
// its own way of coming up empty by luck:
//
//   • the DUEL ladder needs a resident who can actually reach DUELS.STAKE_MIN. A limit is bps of
//     their own cash, so only the richer bands qualify at all — and whether ANY of them turns up is
//     a weighted band draw, i.e. a PROBABILISTIC precondition for a DETERMINISTIC claim.
//   • the ESCROW assertions need a resident to reach the SHYLOCK / market branches, and a resident's
//     FIRST turn is always consumed by the consent-limit branch (it returns 'listed'). So those
//     branches are only reachable on a second turn onward. More turns, not more residents, fixes it.
//
// Measured before this: ~1 run in 12 failed, on one or the other. Raising the headcount and the
// turn count took the duel case down to roughly 1 run in 80 — better odds, same defect, and the
// residual still reddened a full `npm test` (2026-07-30). A gate that reddens at random teaches
// people to ignore it, so the precondition is now GUARANTEED rather than made likely: one resident
// is spawned from a band whose seed range clears the threshold outright, through the ordinary
// ledgered spawn path. What is being asserted is untouched — residentAct still has to notice them
// and list them, which is the actual claim, and every OTHER resident still arrives by the real draw.
for (let i = 0; i < 4; i++) await runPopulation(pool);          // headcount, for the band draw
const bossBand = POPULATION.BANDS.find((b) => b.id === 'boss');
assert(bossBand.seed[0] * POPULATION.BEHAVIOUR.DUEL_BPS / 10000 >= DUELS.STAKE_MIN,
  'the boss band must clear the duel floor outright, or this precondition is not guaranteed after all');
assert(await spawnResident(pool, { band: bossBand }), 'the guaranteed duel-capable resident spawns');
for (let i = 0; i < 60; i++) await runResidentBehaviour(pool);  // turns, for the later branches

// (1) CONSENT LIMITS — this is what lights up the bodyguard market, the fade board and the duel
//     ladder. All three are consent-by-listing, so without residents an empty alpha has NOBODY.
const listed = await one('SELECT COUNT(*) n FROM characters WHERE is_npc AND alive AND guard_price IS NOT NULL');
assert(listed > 0, 'residents advertise a bodyguard price');
assert(await one('SELECT COUNT(*) n FROM characters WHERE is_npc AND alive AND fade_limit IS NOT NULL') > 0,
  'residents take a fade at the back-room table');
assert(await one('SELECT COUNT(*) n FROM characters WHERE is_npc AND alive AND duel_limit IS NOT NULL') > 0,
  'residents are on the duelling ladder');
// what they advertise is always covered by what they hold — they can't write a cheque that bounces
const overcommitted = await one(
  'SELECT COUNT(*) n FROM characters WHERE is_npc AND alive AND duel_limit IS NOT NULL AND duel_limit > cash + 1');
assert.equal(overcommitted, 0, 'a resident never advertises a stake bigger than its own cash');

// (1b) RED-TEAM F1–F3 — these three columns are written by DIRECT SQL, which bypasses
//      offerBodyguard / listDuel / setFadeLimit and every bound they enforce. So each advertised
//      limit must independently satisfy its OWN system's constant, or residents quietly undercut a
//      signed lever (the bodyguard floor is the sharp one: Phase 1.3 repriced it 1000→10000 for
//      safehouse parity, and an unfloored resident would sell the same one-bullet shield for a few
//      hundred) or post listings that are literally unactionable.
const cheapGuard = await one(
  `SELECT COUNT(*) n FROM characters WHERE is_npc AND alive AND guard_price IS NOT NULL AND guard_price < ${M3.BODYGUARD_MIN_PRICE}`);
assert.equal(cheapGuard, 0, 'no resident undercuts the signed bodyguard floor — the direct-SQL write respects it');
const deadDuel = await one(
  `SELECT COUNT(*) n FROM characters WHERE is_npc AND alive AND duel_limit IS NOT NULL AND duel_limit < ${DUELS.STAKE_MIN}`);
assert.equal(deadDuel, 0, 'every ladder entry is actually challengeable (under STAKE_MIN is an empty window)');
const badFade = await one(
  `SELECT COUNT(*) n FROM characters WHERE is_npc AND alive AND fade_limit IS NOT NULL AND (fade_limit < ${CASINO.MIN_BET} OR fade_limit > ${CASINO.MAX_BET})`);
assert.equal(badFade, 0, 'every fade sits inside the table limits');

// (1c) a DRAINED resident drops OFF the boards. Simulating the after-state of a player emptying
//      one: a stored stake its cash can no longer cover. Left standing, that listing can only ever
//      answer `their_cash` — a board that looks full and isn't, which is the exact failure step two
//      exists to fix. (duel_limit is a status column, so this fixture moves no money.)
const drained = (await pool.query(
  'SELECT id, cash FROM characters WHERE is_npc AND alive AND duel_limit IS NOT NULL ORDER BY id LIMIT 1')).rows[0];
await pool.query('UPDATE characters SET duel_limit = cash + 1000000 WHERE id=$1', [drained.id]);
const c1 = await pool.connect();
await c1.query('BEGIN');
const didRelist = await residentAct(c1, (await c1.query(
  'SELECT id, cash, loc, guard_price, fade_limit, duel_limit FROM characters WHERE id=$1', [drained.id])).rows[0]);
await c1.query('COMMIT'); c1.release();
assert.equal(didRelist, 'listed', 'a resident whose advertised stake has gone stale spends its turn relisting');
const relisted = (await pool.query('SELECT duel_limit FROM characters WHERE id=$1', [drained.id])).rows[0].duel_limit;
assert(relisted == null || Number(relisted) <= Number(drained.cash),
  'the stale stake is off the board — what they advertise is what they can still cover');

// (2) THE SHYLOCK — secured offers. A resident never calls collectLoan, so an UNSECURED NPC loan
//     would be free money for a defaulter; requiring collateral worth more than the debt means the
//     audited grace-forfeit sweep seizes a car worth more than they borrowed.
const offers = (await pool.query(
  "SELECT l.principal, l.rate, l.collateral_min FROM loans l JOIN characters c ON c.id=l.lender_character WHERE c.is_npc AND l.status='open'")).rows;
assert(offers.length > 0, 'the Shylock board has resident offers on it');
for (const o of offers) {
  assert(Number(o.collateral_min) > 0, 'every resident offer is SECURED — never free money for a defaulter');
  const owed = Number(o.principal) * (1 + Number(o.rate));
  assert(Number(o.collateral_min) >= owed, 'the pledged car must be worth MORE than what is owed');
}

// (3) THE BLACK MARKET — a standing buy order gives a player a reliable cash buyer for real goods
const orders = (await pool.query(
  "SELECT m.qty, m.price FROM market_listings m JOIN characters c ON c.id=m.seller_character WHERE c.is_npc AND m.kind='order' AND m.status='live'")).rows;
assert(orders.length > 0, 'residents post standing buy orders');

// §10.4 — the whole point: no new faucet, and every escrow reconciles
assert.equal(await driftOf('character cash'), cashDrift0, 'the per-character cash check is UNMOVED by a city full of activity');
assert.equal(await escrowDrift(), escrow0, 'every escrow check still reconciles with resident money in it');
// The real claim: step two introduced no NEW way for a resident to RECEIVE cash. Every credit a
// resident holds must come from an enumerated, pre-existing flow — the spawn seed, the heir's estate
// stake, or its own escrow coming back. Anything else would mean a behaviour conjured value.
const ALLOWED_CREDITS = new Set(['npc:seed', 'death:legacy', 'loan:refund', 'market:refund']);
const credits = (await pool.query(
  `SELECT DISTINCT t.reason FROM transactions t JOIN characters c ON c.id = t.character_id
    WHERE c.is_npc AND t.currency='cash' AND t.amount > 0`)).rows.map((r) => r.reason);
const conjured = credits.filter((r) => !ALLOWED_CREDITS.has(r));
assert.deepEqual(conjured, [],
  `step two conjured NOTHING — a resident only ever spends what it already holds (unexpected credit reasons: ${conjured})`);

// ════════════ STEP THREE — THE TURNOVER ════════════
// Steps one/two light the city up ONCE: residents have no income, so the seed pool is a stock, not a
// flow. The worker now retires residents players have PICKED CLEAN and puts fresh faces in their
// place — which makes `npc:seed` a RECURRING faucet, hence the explicit rolling-24h ceiling.

// fixture: the old-bloodline section above aged EVERY resident past RETIRE_GENERATIONS, and old
// lines are retired first, so they'd starve the drained pass of its per-tick room. Reset the
// generations (pure status, no money) so the turnover path below is actually exercised.
await pool.query('UPDATE characters SET generation=1 WHERE is_npc AND alive');

// every resident records what they ARRIVED with — the only way to tell drained from born-poor
assert.equal(await one('SELECT COUNT(*) n FROM characters WHERE is_npc AND alive AND npc_seed <= 0'), 0,
  'every resident carries the stake they arrived with');

// THE TRAP this design exists to avoid: a flat cash floor would retire the `corner` band (seeded as
// little as $200) the moment it spawned, respawn it, and loop forever — an unbounded faucet. Measured
// against their OWN arrival stake instead, a freshly-spawned resident is never "picked clean".
const poor = (await pool.query(
  'SELECT id, cash, npc_seed FROM characters WHERE is_npc AND alive ORDER BY cash ASC LIMIT 1')).rows[0];
assert(Number(poor.cash) >= Number(poor.npc_seed) * POPULATION.TURNOVER.DRAINED_BPS / 10000,
  'the poorest resident in the city is still not "drained" — born poor is not the same as picked clean');
const quiet = await runPopulation(pool);
assert.equal(quiet.drained, 0, 'a city nobody has robbed retires nobody for being broke');

// now actually pick one clean — the after-state of a player draining them through duels/fades/fills.
// (A direct cash write would move the books, so the burn is ledgered as the loss it represents.)
const mark = (await pool.query(
  'SELECT id, cash, npc_seed FROM characters WHERE is_npc AND alive AND npc_seed > 5000 ORDER BY npc_seed DESC LIMIT 1')).rows[0];
const stripped = Math.floor(Number(mark.npc_seed) * 0.05); // 5% of what they arrived with
await pool.query('UPDATE characters SET cash=$2 WHERE id=$1', [mark.id, stripped]);
await pool.query(
  "INSERT INTO transactions (id, character_id, currency, amount, reason) VALUES ($1,$2,'cash',$3,'npc:retire')",
  [`t-drain-${mark.id}`, mark.id, stripped - Number(mark.cash)]);

const beforeTurnover = await population(pool);
const chargedBefore = await one('SELECT retired n FROM population_state WHERE id=1');
const turn = await runPopulation(pool);
assert(turn.drained > 0, 'the worker retires a resident players have picked clean');
assert.equal(await one(`SELECT COUNT(*) n FROM characters WHERE id='${mark.id}' AND alive`), 0,
  'the picked-clean resident is off the streets');
assert(await population(pool) >= beforeTurnover,
  'and a fresh face took their place — the city renews itself instead of quietly emptying');

assert.equal(await one('SELECT retired n FROM population_state WHERE id=1') - chargedBefore, turn.retired,
  'every retirement charged the day\'s replacement allowance, exactly once each');
assert(await seededToday(pool) > 0, 'and the seeding it paid for is visible on the ledger');


// (red-team F1) Retiring old bloodlines is bounded MAINTENANCE; retiring the picked-clean is the
// renewal LOOP. Sharing a per-tick room and taking old lines FIRST let maintenance starve the loop
// indefinitely — and heavy PvP sustains that, since a resident's generation only rises when players
// kill them. Age enough lines to fill the room and confirm the drained still get a slot.
await pool.query(
  `UPDATE characters SET generation=$1 WHERE id IN
     (SELECT id FROM characters WHERE is_npc AND alive ORDER BY id LIMIT $2)`,
  [POPULATION.RETIRE_GENERATIONS + 1, POPULATION.SPAWN_PER_TICK + 2]);
const starved = (await pool.query(
  'SELECT id, cash, npc_seed FROM characters WHERE is_npc AND alive AND npc_seed > 5000 AND generation = 1 ORDER BY npc_seed DESC LIMIT 1')).rows[0];
const strippedS = Math.floor(Number(starved.npc_seed) * 0.05);
await pool.query('UPDATE characters SET cash=$2 WHERE id=$1', [starved.id, strippedS]);
await pool.query(
  "INSERT INTO transactions (id, character_id, currency, amount, reason) VALUES ($1,$2,'cash',$3,'npc:retire')",
  [`t-starve-${starved.id}`, starved.id, strippedS - Number(starved.cash)]);
const contended = await runPopulation(pool);
assert(contended.drained > 0,
  'a picked-clean resident is still replaced with the per-tick room full of old bloodlines — maintenance cannot starve the renewal loop');
assert(contended.retired <= POPULATION.SPAWN_PER_TICK, 'and the per-tick cap still holds');
await pool.query('UPDATE characters SET generation=1 WHERE is_npc AND alive');

// (red-team F2) An HEIR records its arrival stake AT BIRTH. Backfilling it on the heir's first
// worker turn left a window — up to a full sweep of the city — in which a player could drain them
// first, so the backfill would record the DRAINED cash as their stake and that resident could never
// be recycled: an immortal broke body occupying a slot, which a griefer could manufacture at will.
const toKill = (await pool.query('SELECT id, account_id FROM characters WHERE is_npc AND alive ORDER BY id LIMIT 1')).rows[0];
await call('POST', '/v1/mod/kill', { headers: { 'x-mod-key': 'test-mod-key' }, body: { characterId: toKill.id, reason: 'test' } });
const bornHeir = (await pool.query(
  'SELECT cash, npc_seed, is_npc FROM characters WHERE account_id=$1 AND alive', [toKill.account_id])).rows[0];
assert.equal(bornHeir.is_npc, true, 'the heir is a resident');
assert(Number(bornHeir.npc_seed) > 0 && Number(bornHeir.npc_seed) === Number(bornHeir.cash),
  'and is born with its arrival stake already recorded — no window for a drained value to be mistaken for it');

// THE CEILING. Recycling makes npc:seed recurring, so REPLACEMENTS are metered — a per-day headcount
// held in the population_state singleton, charged in the same transaction as the retirement.
// Deliberately NOT a dollar budget on seeding: the day-one fill of an empty city is ~48 seeds that
// replace nobody, and would eat the whole allowance before a single resident had been robbed.
// spend the rest of the allowance, then prove a picked-clean resident STAYS until the day rolls
await pool.query('UPDATE population_state SET day=$1, retired=$2 WHERE id=1',
  [Math.floor(Date.now() / 86400000), POPULATION.TURNOVER.PER_DAY]);
const mark2 = (await pool.query(
  'SELECT id, cash, npc_seed FROM characters WHERE is_npc AND alive AND npc_seed > 5000 ORDER BY npc_seed DESC LIMIT 1')).rows[0];
const stripped2 = Math.floor(Number(mark2.npc_seed) * 0.05);
await pool.query('UPDATE characters SET cash=$2 WHERE id=$1', [mark2.id, stripped2]);
await pool.query(
  "INSERT INTO transactions (id, character_id, currency, amount, reason) VALUES ($1,$2,'cash',$3,'npc:retire')",
  [`t-drain2-${mark2.id}`, mark2.id, stripped2 - Number(mark2.cash)]);
const capped = await runPopulation(pool);
assert.equal(capped.turnoverLeft, 0, 'the day\'s replacement allowance reads as spent');
assert.equal(capped.drained, 0, 'and a picked-clean resident is NOT replaced past the ceiling');
assert.equal(await one(`SELECT COUNT(*) n FROM characters WHERE id='${mark2.id}' AND alive`), 1,
  'they stay on the streets, broke, until the day rolls — the faucet is bounded by headcount, not hope');
assert(credits.includes('npc:seed'), 'and the seed is the source it all traces back to');

// (4) RETIREMENT WITH LIVE ESCROW — the books must still close. A retiring resident pulls its offers
//     and orders back in first, so nothing is left standing on a board with nobody behind it.
const withEscrow = (await pool.query(
  "SELECT c.id FROM characters c JOIN loans l ON l.lender_character=c.id AND l.status='open' WHERE c.is_npc AND c.alive LIMIT 1")).rows[0];
assert(withEscrow, 'found a resident holding live escrow');
const c3 = await pool.connect();
await c3.query('BEGIN');
await retireResident(c3, withEscrow.id);
await c3.query('COMMIT');
c3.release();
assert.equal(await one("SELECT COUNT(*) n FROM loans WHERE lender_character=$1 AND status='open'", [withEscrow.id]), 0,
  'their offer is pulled off the board, not left standing behind a dead lender');
assert.equal(await driftOf('character cash'), cashDrift0, 'and the cash check STILL reconciles');
assert.equal(await escrowDrift(), escrow0, 'as does every escrow check');

// (4b) (AUDIT-street-life F1 — HIGH) RETIREMENT WITH A TAKEN LOAN — retirement is not a death, so
// voidLoansAtDeath never runs and there is no heir: an ACTIVE loan used to strand pointing at a
// dead lender. The borrower could not repay (the two-party repay needs a living lender), yet the
// sweep would brand them WELSHER + WANTED for the unpayable debt, and the pledged car would
// grace-forfeit into a dead heirless fleet. Now the claim VOIDS at retirement: pledge unlocked,
// loan gone, borrower told. (The fixture rows are a CLAIM + an ownership flag, not value — the
// principal "moved at take time", so no ledger rows are owed and the cash check must not move.)
{
  const c4 = await pool.connect();
  await c4.query('BEGIN');
  const lender = await spawnResident(c4, { band: POPULATION.BANDS.find((b) => b.id === 'capo') });
  await c4.query('COMMIT');
  c4.release();
  const carId = `car-f1-${Date.now()}`;
  await pool.query(
    "INSERT INTO cars (id, character_id, model_id, trim_id, dmg, pledged) VALUES ($1,$2,'falcone','base',0,true)",
    [carId, player.id]);
  await pool.query(
    `INSERT INTO loans (id, lender_character, borrower_character, principal, rate, hours, status, due_at, collateral_min, collateral_car)
     VALUES ('loan-f1', $1, $2, 10000, 0.2, 24, 'active', now() + interval '1 day', 13000, $3)`,
    [lender.id, player.id, carId]);
  // (F5) and a pending call FROM this resident — it must die with them, not jam the slot 24h
  await pool.query(
    `INSERT INTO contact_calls (character_id, npc_character, kind, district, pay, expires_at)
     VALUES ($1,$2,'visit','docks',750, now() + interval '20 hours')`, [player.id, lender.id]);
  // (Lens C LOW-1) and the player's black-book line to them — retirement leaves no heir, so a kept
  // row would render a dead line FOREVER (unlike a player's number, where the heir answers)
  const lenderAcct = (await pool.query('SELECT account_id a FROM characters WHERE id=$1', [lender.id])).rows[0].a;
  const playerAcct = (await pool.query('SELECT account_id a FROM characters WHERE id=$1', [player.id])).rows[0].a;
  await pool.query("INSERT INTO contacts (owner_account, contact_account, how) VALUES ($1,$2,'met') ON CONFLICT DO NOTHING",
    [playerAcct, lenderAcct]);
  const c5 = await pool.connect();
  await c5.query('BEGIN');
  await retireResident(c5, lender.id);
  await c5.query('COMMIT');
  c5.release();
  assert.equal(await one("SELECT COUNT(*) n FROM loans WHERE id='loan-f1'"), 0,
    'F1: the taken loan VOIDS at retirement — no unpayable debt survives the lender');
  const car = (await pool.query('SELECT pledged, character_id FROM cars WHERE id=$1', [carId])).rows[0];
  assert.equal(car.pledged, false, 'F1: the pledged car UNLOCKS — never grace-forfeits into a dead fleet');
  assert.equal(car.character_id, player.id, 'and stays with the borrower');
  assert.equal(await one(
    "SELECT COUNT(*) n FROM notifications WHERE character_id=$1 AND type='loan_voided'", [player.id]), 1,
    'F1: the borrower is told the book closed');
  assert.equal(await one('SELECT COUNT(*) n FROM contact_calls WHERE npc_character=$1', [lender.id]), 0,
    'F5: the pending call died with the caller — the slot is free');
  assert.equal(await one('SELECT COUNT(*) n FROM contacts WHERE contact_account=$1 OR owner_account=$1', [lenderAcct]), 0,
    "LOW-1: the retired resident's number is a disconnected line — it leaves every black book");
  assert.equal(await driftOf('character cash'), cashDrift0, 'F1 moved no value — the cash check is unmoved');
  await pool.query('DELETE FROM cars WHERE id=$1', [carId]); // fixture hygiene (car conservation reads rows)
}

// ════════════ THE VOCABULARY ════════════
const inv = await runLedgerInvariants(pool, { alert: false });
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab && vocab.ok, `npc: reasons are in the §10.4 cash vocabulary (${JSON.stringify(vocab)})`);
const retires = await one("SELECT COUNT(*) n FROM transactions WHERE reason='npc:retire'");
assert(retires > 0, 'retirements are ledgered');

// the band picker spans the roster instead of clustering
assert.equal(npcBandOf(0.0).id, 'corner', 'the low roll is the corner band');
assert.equal(npcBandOf(0.999).id, 'boss', 'the high roll is the boss band');

// ── JAILBIRDS (founder: the "Bust a player out of lockup" daily was uncompletable solo) ──
// The worker keeps TARGET residents in lockup; a bust frees one through the UNCHANGED §7.8 path.
{
  const jailedResidents = async () => Number((await pool.query(
    'SELECT COUNT(*) n FROM characters WHERE alive AND is_npc AND jail_until > now()')).rows[0].n);
  const t1 = await runPopulation(pool);
  assert.equal(await jailedResidents(), POPULATION.JAILBIRDS.TARGET, 'the worker keeps TARGET residents serving a sentence');
  const t2 = await runPopulation(pool);
  assert.equal(t2.jailed, 0, 'a full jail is not over-filled on the next tick');
  assert.equal(await jailedResidents(), POPULATION.JAILBIRDS.TARGET, 'still exactly TARGET inside');
  void t1; // the earlier ticks in this file already filled the jail — t1 legitimately collars 0
  // a PLAYER busts a jailbird through the ordinary §7.8 verb: give the sentence a short tail
  // (best odds near the end — the signed curve), retry across the buster's own fail-jail
  const bird = (await pool.query(
    'SELECT id, name FROM characters WHERE alive AND is_npc AND jail_until > now() LIMIT 1')).rows[0];
  const buster = await mk('Springer Sal');
  let sprung = null;
  for (let i = 0; i < 40 && !sprung; i++) {
    await pool.query(`UPDATE characters SET jail_until=NULL, cash=1000 WHERE id='${buster.id}'`);
    await pool.query(`UPDATE characters SET jail_until = now() + interval '30 seconds' WHERE id='${bird.id}'`);
    const r = await call('POST', `/v1/streets/${bird.id}/bust`, { token: buster.token });
    if (r.body.success) sprung = r.body;
  }
  assert(sprung, 'a resident jailbird is bustable through the ordinary §7.8 verb (~0.63/attempt at a 30s tail)');
  assert(sprung.reward > 0, 'the bust paid the signed §7.8 reward');
  assert.equal(await one(
    `SELECT COALESCE(SUM(amount),0) n FROM transactions WHERE character_id='${buster.id}' AND reason='bust:reward'`),
    sprung.reward, 'the reward is the ledgered bust:reward faucet (§10.4 check (a) reconciles)');
  const cnt = (await pool.query(
    `SELECT counters FROM daily_progress WHERE character_id='${buster.id}' ORDER BY day DESC LIMIT 1`)).rows[0];
  assert(cnt && Number(JSON.parse(cnt.counters).bust || 0) >= 1, 'the bust daily contract counter advanced — the bust1/bust2 dailies are completable solo at last');
  // the freed bird counts as a vacancy the NEXT tick refills (the standing-target rule)
  const t3 = await runPopulation(pool);
  assert.equal(await jailedResidents(), POPULATION.JAILBIRDS.TARGET, `the jail refills to TARGET after a bust (tick jailed ${t3.jailed})`);
}

// ════════════ STEP TWO of THE STREET WAR — residents OWN things worth taking (MARKS) ════════════
// Cars are counted into the car-conservation invariant via rng_audit npc:car grant/retire rows;
// fronts realize ONLY through the rob redirect at the sleepy-joint scale; boats/goods are ownership.
{
  const carDrift0 = await driftOf('car conservation');
  const cM = await pool.connect(); await cM.query('BEGIN');
  const marked = await spawnResident(cM, {
    band: POPULATION.BANDS.find((b) => b.id === 'boss'),
    marks: { car: true, front: true, boat: true },   // tests pin the rolls; production rolls the band P
  });
  await cM.query('COMMIT'); cM.release();
  const mCars = (await pool.query('SELECT * FROM cars WHERE character_id=$1', [marked.id])).rows;
  assert.equal(mCars.length, 1, 'the resident spawned holding a beater');
  assert.equal(await driftOf('car conservation'), carDrift0,
    'the car-conservation invariant ABSORBS the granted beater (an rng_audit npc:car grant row per car)');
  const mFront = (await pool.query('SELECT * FROM businesses WHERE character_id=$1', [marked.id])).rows[0];
  assert(mFront && mFront.kind === 'restaurant' && Number(mFront.tier) === 1, 'the boss band runs a sleepy restaurant t1');
  assert.equal(await one('SELECT COUNT(*) n FROM boats WHERE character_id=$1', [marked.id]), 1, 'and keeps a dinghy at the docks');

  // THE SLEEPY-JOINT SCALE — robbing the resident front prices its pending at FRONT_INCOME_BPS of
  // the catalog curve (10h × $22k/hr = $220k catalog pending → ×10% = $22k → ×15% cut ≈ $3,300).
  // Dropping the scale pays ~$33,000 — an order of magnitude, so the band below catches the mutation.
  await pool.query("UPDATE businesses SET last_collect_at = now() - interval '10 hours' WHERE id=$1", [mFront.id]);
  await pool.query('UPDATE characters SET cunning=2000, speed=2000, energy=200, heat=0, jail_until=NULL, hosp_until=NULL WHERE id=$1', [player.id]);
  let robWin = null;
  for (let i = 0; i < 40 && !robWin; i++) {
    await pool.query('UPDATE characters SET energy=200, jail_until=NULL WHERE id=$1', [player.id]);
    await pool.query('UPDATE businesses SET shakedown_at=NULL WHERE id=$1', [mFront.id]);
    const rb = await call('POST', `/v1/business/${mFront.id}/rob`, { token: player.token });
    assert.equal(rb.code, 200, `the rob resolves (${JSON.stringify(rb.body)})`);
    if (rb.body.win) robWin = rb.body;
  }
  assert(robWin, 'the player cracks the sleepy joint');
  {
    // expected = 15% of (FRONT_INCOME_BPS of the 10h catalog pending) — derived from the levers so
    // a founder retune moves the expectation with it (the stale-figure class)
    const expect = Math.floor(22000 * 10 * POPULATION.MARKS.FRONT_INCOME_BPS / 10000 * 0.15);
    assert(Math.abs(robWin.cut - expect) <= Math.max(200, expect * 0.15),
      `the cut prices at the SLEEPY-JOINT scale (~$${expect}; got $${robWin.cut})`);
    assert(robWin.cut < 33000 * 0.5, 'and is nowhere near the unscaled catalog cut (the mutation band)');
  }

  // STEAL the resident's car — a pure row move, and the invariant stays exact with npc iron in play
  process.env.CAR_THEFT_P = '1';
  await pool.query('UPDATE characters SET gta_at=NULL, car_stolen_at=NULL, trunk_robbed_at=NULL WHERE id=$1', [player.id]);
  let r2 = await call('POST', `/v1/streets/${marked.id}/steal`, { token: player.token });
  assert(r2.code === 200 && r2.body.win, `the resident's beater is stealable (${JSON.stringify(r2.body)})`);
  assert.equal(await driftOf('car conservation'), carDrift0, 'car conservation still exact after the theft (a row moved, nothing minted)');
  // STEAL the boat too (the shared vehicle shield is a per-victim knob — clear it for the test)
  await pool.query('UPDATE characters SET car_stolen_at=NULL WHERE id=$1', [marked.id]);
  await pool.query("UPDATE characters SET gta_at=NULL, loc='docks', energy=200 WHERE id=$1", [player.id]);
  r2 = await call('POST', `/v1/streets/${marked.id}/boat`, { token: player.token });
  assert(r2.code === 200 && r2.body.win && r2.body.boatTheft, `the dinghy slips its moorings (${JSON.stringify(r2.body)})`);
  delete process.env.CAR_THEFT_P;

  // RETIREMENT squares every mark's books: cars leave with matching npc:car retire rows, and
  // boats / fronts / cargo rows go with the resident (no orphan scenery).
  const cM2 = await pool.connect(); await cM2.query('BEGIN');
  const marked2 = await spawnResident(cM2, {
    band: POPULATION.BANDS.find((b) => b.id === 'boss'),
    marks: { car: true, front: true, boat: true },
  });
  await cM2.query('COMMIT'); cM2.release();
  const cR = await pool.connect(); await cR.query('BEGIN');
  await retireResident(cR, marked2.id);
  await cR.query('COMMIT'); cR.release();
  assert.equal(await one('SELECT COUNT(*) n FROM cars WHERE character_id=$1', [marked2.id]), 0, 'the retired resident took the beater with them');
  assert.equal(await one('SELECT COUNT(*) n FROM boats WHERE character_id=$1', [marked2.id]), 0, '…and the dinghy');
  assert.equal(await one('SELECT COUNT(*) n FROM businesses WHERE character_id=$1', [marked2.id]), 0, '…and the front');
  assert(await one("SELECT COUNT(*) n FROM rng_audit WHERE action='npc:car' AND outcome='retire' AND character_id=$1", [marked2.id]) >= 1,
    'the retirement wrote the matching npc:car retire row');
  assert.equal(await driftOf('car conservation'), carDrift0, 'car conservation exact through the whole grant→steal→retire cycle');

  // FREIGHT — a resident sometimes carries goods (bought with its OWN seed cash at the real market
  // price + take: recycle-only), which makes it a trunk-robbery mark; the budget floor keeps it
  // clear of the picked-clean line.
  const cF = await pool.connect(); await cF.query('BEGIN');
  const hauler = await spawnResident(cF, { band: POPULATION.BANDS.find((b) => b.id === 'boss'), marks: {} });
  await cF.query('COMMIT'); cF.release();
  let freighted = false;
  for (let i = 0; i < 8 && !freighted; i++) {
    const cA = await pool.connect(); await cA.query('BEGIN');
    const live = (await cA.query('SELECT id, cash, loc, npc_seed, guard_price, fade_limit, duel_limit FROM characters WHERE id=$1 FOR UPDATE', [hauler.id])).rows[0];
    const did = await residentAct(cA, live);
    await cA.query('COMMIT'); cA.release();
    if (did === 'freighted') freighted = true;
  }
  assert(freighted, 'the resident loads freight within a few turns');
  const held = await one('SELECT COALESCE(SUM(qty),0) n FROM character_cargo WHERE character_id=$1', [hauler.id]);
  assert(held >= 1, 'goods in the trunk');
  assert(await one("SELECT COUNT(*) n FROM transactions WHERE character_id=$1 AND reason LIKE 'goods:buy:%'", [hauler.id]) >= 1,
    'bought at the real market rail (goods:buy sink — recycle-only, never conjured)');
  const hRow = (await pool.query('SELECT cash, npc_seed FROM characters WHERE id=$1', [hauler.id])).rows[0];
  assert(Number(hRow.cash) > Number(hRow.npc_seed) * POPULATION.TURNOVER.DRAINED_BPS / 10000,
    'the freight budget keeps the resident clear of the picked-clean line (no self-inflicted turnover)');
  // …and the player can mug it
  await pool.query("UPDATE characters SET energy=200, jail_until=NULL, gta_at=NULL, loc=(SELECT loc FROM characters WHERE id='" + hauler.id + "') WHERE id=$1", [player.id]);
  let mug = null;
  for (let i = 0; i < 40 && !mug; i++) {
    await pool.query('UPDATE characters SET energy=200, jail_until=NULL WHERE id=$1', [player.id]);
    await pool.query('UPDATE characters SET trunk_robbed_at=NULL WHERE id=$1', [hauler.id]);
    const rb = await call('POST', `/v1/streets/${hauler.id}/trunk`, { token: player.token });
    if (rb.code === 200 && rb.body.win) mug = rb.body;
  }
  assert(mug && mug.qty >= 1, `the resident's freight is muggable (${JSON.stringify(mug)})`);
}

// ══════════ STREET WAR step three — the resident's STABLE ══════════
// Residents field fighters and racers so the PvP boards (the Circuit, the strip) are LIVE in an
// empty alpha. The listing obeys recycle-only: a resident advertises only a stake they ALREADY
// HOLD, and one who cannot reach the system's own floor simply DOESN'T LIST — a limit under
// MIN_STAKE sits in an EMPTY window (`amt >= MIN_STAKE && amt <= limit`) and reads as a dead board.
{
  const cS = await pool.connect();
  try {
    await cS.query('BEGIN');
    const rich = await spawnResident(cS, { band: POPULATION.BANDS.find((b) => b.id === 'boss'),
      marks: { fighter: true, racer: true } });
    const f = (await cS.query('SELECT * FROM fighters WHERE character_id=$1', [rich.id])).rows[0];
    const r = (await cS.query('SELECT * FROM racers WHERE character_id=$1', [rich.id])).rows[0];
    assert(f && r, 'a boss resident fields a fighter and a racer');
    assert(f.name.includes("'"), `the fighter carries a ring name (${f.name})`);
    assert(['dog', 'horse'].includes(r.kind), `the racer is a real kind (${r.kind})`);
    // the stake is covered by their own pocket AND clears the system floor — never an empty window
    assert.equal(Number(f.bout_limit), Math.min(Math.floor(rich.cash * POPULATION.MARKS.STAKE_BPS / 10000), BOXING.MAX_STAKE),
      'the bout limit is a share of the pocket they actually hold');
    assert(Number(f.bout_limit) >= BOXING.MIN_STAKE, 'and clears the circuit floor, so the board is really playable');
    assert(Number(f.bout_limit) <= Number(rich.cash), 'recycle-only: a resident never advertises more than they hold');
    assert(Number(r.race_limit) >= STABLE.MIN_STAKE, 'the racer likewise sits in a live window');

    // a resident too poor to cover the floor DOESN'T LIST (rather than listing an untakeable stake)
    const poor = await spawnResident(cS, { band: POPULATION.BANDS.find((b) => b.id === 'made'),
      marks: { fighter: true, racer: true } });
    const pf = (await cS.query('SELECT * FROM fighters WHERE character_id=$1', [poor.id])).rows[0];
    if (Math.floor(poor.cash * POPULATION.MARKS.STAKE_BPS / 10000) < BOXING.MIN_STAKE)
      assert.equal(pf.bout_limit, null, 'a resident who cannot cover MIN_STAKE leaves the limit unset — no dead board entry');

    // retirement takes the stable with them — no fighter lingering on a board nobody can collect from
    await retireResident(cS, rich.id);
    assert.equal(Number((await cS.query('SELECT COUNT(*) n FROM fighters WHERE character_id=$1', [rich.id])).rows[0].n), 0,
      'a retired resident leaves no fighter behind');
    assert.equal(Number((await cS.query('SELECT COUNT(*) n FROM racers WHERE character_id=$1', [rich.id])).rows[0].n), 0,
      'nor a racer');
    await cS.query('ROLLBACK');
  } finally { cS.release(); }
}

// ════════════ AUDIT (Street War step three) — scenery must not take a human's PRIVILEGE ════════════
// Step three put fighters and racers in resident hands so the PvP boards are live in an empty alpha.
// Two consequences nobody had traced: a derived STATUS PRIVILEGE that keys on "top fighter" can be
// held by an NPC, and RETIREMENT is not a death, so the estate hooks that clean up after a fighter
// never run for a resident.
{
  const fighter = async (charId, name, wins) => {
    const id = crypto.randomUUID();
    await pool.query('INSERT INTO fighters (id, character_id, name, power, chin, speed, wins) VALUES ($1,$2,$3,20,20,20,$4)',
      [id, charId, name, wins]);
    return id;
  };
  await pool.query('DELETE FROM fighters');

  // (F1) THE #1 CONTENDER. One lost bout gives a resident's fighter the `wins >= 1` the slot needs, and
  // `callOutChamp` demands `top.character_id === ch.id` — so while scenery held the slot NO player
  // could call out the champion, and a resident never calls anybody out. Pinned with the NPC ahead on
  // wins, which is exactly how it would happen: the same argument as the step-three leaderboards.
  const holder = await mk('Reigning Champ');
  const npcMgr = await spawnResident(pool, { band: POPULATION.BANDS.find((b) => b.id === 'boss'), marks: { fighter: true } });
  const npcF = (await pool.query('SELECT id FROM fighters WHERE character_id=$1', [npcMgr.id])).rows[0];
  assert(npcF, 'the resident fields a fighter');
  await pool.query('UPDATE fighters SET wins=9 WHERE id=$1', [npcF.id]);   // scenery, ahead on record
  const humanF = await fighter(player.id, 'Kid Marciano', 3);              // a real contender, behind it
  const beltF = await fighter(holder.id, 'The Champion', 20);
  await pool.query('UPDATE boxing_title SET holder_fighter=$1, holder_char=$2, holder_name=$3, since=now(), last_defense=now() WHERE id=1',
    [beltF, holder.id, 'The Champion']);
  const board = await boxingBoard(pool, player.id);
  assert(board.champion, 'there is a champion to challenge');
  assert.equal(board.champion.contender.fighterId, humanF,
    'the #1 contender is the top HUMAN fighter — a resident with a better record cannot hold the slot that gates the callout');
  assert.equal(board.champion.contender.mine, true, 'and the human who owns them is told they can call the champ out');

  // (F2) RETIREMENT IS NOT A DEATH. applyBeltResult keys the belt on the FIGHTER, so a resident's
  // fighter can win it. A bare `DELETE FROM fighters` on retirement left boxing_title pointing at a
  // row that no longer exists and a character no longer alive — a phantom champion on every board
  // until the 7-day mandatory-defense clock stripped it. The same class as the step-two stranded loan.
  await pool.query('UPDATE boxing_title SET holder_fighter=$1, holder_char=$2, holder_name=$3, since=now(), last_defense=now() WHERE id=1',
    [npcF.id, npcMgr.id, 'The Scenery']);
  const cR = await pool.connect();
  try { await cR.query('BEGIN'); await retireResident(cR, npcMgr.id); await cR.query('COMMIT'); }
  catch (e) { await cR.query('ROLLBACK'); throw e; } finally { cR.release(); }
  const t = (await pool.query('SELECT holder_fighter, holder_char FROM boxing_title WHERE id=1')).rows[0];
  assert.equal(t.holder_fighter, null, 'retiring the champion vacates the belt — no phantom holder left on the board');
  assert.equal(t.holder_char, null, 'and no phantom holder character either');

  // (F3) STALE STABLE LISTINGS. The step-two fix ("a drained resident's advertised stake must not stand
  // on the board answering only `their_cash`") covered the three CHARACTER columns; step three added two
  // more consent listings, on the fighters/racers rows, and nothing re-checked them. THE TAKE drains
  // residents by design, so this is the ordinary case, not a corner.
  const shopworn = await spawnResident(pool, { band: POPULATION.BANDS.find((b) => b.id === 'boss'), marks: { fighter: true, racer: true } });
  await pool.query('UPDATE characters SET cash=500 WHERE id=$1', [shopworn.id]);
  await pool.query('UPDATE fighters SET bout_limit=90000 WHERE character_id=$1', [shopworn.id]);
  await pool.query('UPDATE racers SET race_limit=90000 WHERE character_id=$1', [shopworn.id]);
  const cS2 = await pool.connect();
  try {
    await cS2.query('BEGIN');
    await residentAct(cS2, (await cS2.query(
      'SELECT id, cash, loc, npc_seed, guard_price, fade_limit, duel_limit FROM characters WHERE id=$1', [shopworn.id])).rows[0]);
    await cS2.query('COMMIT');
  } catch (e) { await cS2.query('ROLLBACK'); throw e; } finally { cS2.release(); }
  const bl = (await pool.query('SELECT bout_limit FROM fighters WHERE character_id=$1', [shopworn.id])).rows[0].bout_limit;
  const rl = (await pool.query('SELECT race_limit FROM racers WHERE character_id=$1', [shopworn.id])).rows[0].race_limit;
  assert(bl == null || Number(bl) <= 500, `a drained resident's fighter is off the circuit, not advertising a purse they can't cover (got ${bl})`);
  assert(rl == null || Number(rl) <= 500, `and their racer is off the strip too (got ${rl})`);
  await pool.query('DELETE FROM fighters');
  await pool.query('UPDATE boxing_title SET holder_fighter=NULL, holder_char=NULL, holder_name=NULL, since=NULL, last_defense=NULL WHERE id=1');
}

// ══════════════ NPC FAMILIES (omerta-npc-families-design.md) ══════════════
// The coach's first social rung held 43% of a measured 7-day solo run and could never be acted on:
// nothing to JOIN, and founding costs level 5 + $25,000. Residents found and fill families through
// the AUDITED createGang/joinGang so a real player can walk into one. The load-bearing claims are
// the three EXCLUSIONS (a silent Commission ballot, real $OMR into an unspendable reserve, a family
// that cannot fight back being a standing farm) and the retirement hole this opens.
{
  const { runFamilies } = await import('../src/population.js');
  const { seatedGangs } = await import('../src/commission.js');
  const { POPULATION, M3 } = await import('../src/rules.js');
  const F = POPULATION.FAMILIES;
  assert(F.TARGET > 0, 'the feature ships ON — TARGET 0 disables it entirely');
  assert(F.MAX_MEMBERS < M3.GANG_MAX_MEMBERS,
    `an NPC family never fills up (${F.MAX_MEMBERS} of ${M3.GANG_MAX_MEMBERS}), so a player always has room to walk in`);

  // the city has to be able to AFFORD a founder: capo/boss residents carry the $25,000 fee
  for (let i = 0; i < 3; i++) await spawnResident(pool, { band: POPULATION.BANDS.find((b) => b.id === 'boss') });
  // BASELINES, not absolutes: earlier blocks call runPopulation, which now founds families too, and
  // retirements there dissolve them — so the lifetime `gang:found` total is not this block's.
  const cashBefore = Number((await pool.query('SELECT COALESCE(SUM(cash),0) s FROM characters WHERE is_npc')).rows[0].s);
  const foundBefore = Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='gang:found'")).rows[0].s);

  let founded = 0;
  for (let i = 0; i < F.TARGET + 4; i++) founded += (await runFamilies(pool)).familiesFounded;
  const fams = (await pool.query('SELECT id, name, tag, npc_flag FROM gangs WHERE npc_flag')).rows;
  assert.equal(fams.length, F.TARGET, `the worker keeps ${F.TARGET} families on the board (got ${fams.length})`);
  for (let i = 0; i < 4; i++) await runFamilies(pool);
  assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM gangs WHERE npc_flag')).rows[0].n), F.TARGET,
    'and stops at TARGET — it does not found one a tick forever');

  // it is a SINK, not a faucet: the fee comes out of the founder's own npc:seed cash and is ledgered
  // `gang:found` by the audited path, so the resident pool can only get SMALLER
  const foundDelta = Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='gang:found'")).rows[0].s) - foundBefore;
  assert.equal(foundDelta, -M3.GANG_FOUND_COST * founded, `every founding is a ledgered gang:found SINK at the real price (${founded} of them)`);
  const cashAfter = Number((await pool.query('SELECT COALESCE(SUM(cash),0) s FROM characters WHERE is_npc')).rows[0].s);
  assert.equal(cashAfter, cashBefore + foundDelta, 'and the founders really paid it out of their own seed cash — no faucet anywhere in this');

  // …and they get filled, so a player joining does not join a family of one
  for (let i = 0; i < F.TARGET * F.MIN_MEMBERS + 4; i++) await runFamilies(pool);
  for (const g of fams) {
    const n = Number((await pool.query('SELECT COUNT(*) n FROM gang_members WHERE gang_id=$1', [g.id])).rows[0].n);
    assert(n >= F.MIN_MEMBERS, `${g.name} has a roster (${n} of ${F.MIN_MEMBERS})`);
    assert(n <= F.MAX_MEMBERS, `${g.name} does not fill up (${n})`);
  }

  // THE JOIN BOARD shows them, flagged. Hidden scenery is not a call to make silently.
  const board = (await call('GET', '/v1/gangs')).body.gangs;
  const shown = board.filter((g) => g.npc);
  assert.equal(shown.length, F.TARGET, 'every NPC family is on the join board');
  assert(shown.every((g) => g.members >= F.MIN_MEMBERS), 'with a real roster count');

  // ── EXCLUSION 1: THE COMMISSION. An NPC family cannot vote, and a silent ballot shrinks the
  // electorate and deadlocks decrees that move signed surfaces. Seeded with standing that would
  // otherwise seat it FIRST — the `standing > 0` filter is not what is being tested here.
  await pool.query('UPDATE gangs SET season_tribute=9999999 WHERE npc_flag');
  const seats = await seatedGangs(pool);
  assert.equal(seats.filter((g) => fams.some((f) => f.id === g.id)).length, 0,
    'an NPC family never holds a Commission seat, even out-standing every real family');

  // ── EXCLUSION 2: THE FAMILY YIELD. Real player-funded $OMR into a reserve nobody can spend from.
  // Matched by NAME, not id: `yieldBoard` does not expose ids, so the obvious id filter here is
  // ALWAYS false and the assertion passes with the exclusion removed — which is exactly what the
  // mutation run showed. The PAYER is asserted too, because the board is display and the payer is
  // where the value actually moves.
  const { yieldBoard, payFamilyYield } = await import('../src/exchange.js');
  const npcNames = new Set(fams.map((f) => f.name));
  const yb = await yieldBoard(pool);
  assert.equal((yb.families || []).filter((g) => npcNames.has(g.name)).length, 0,
    'an NPC family never appears on the family-yield board, out-standing everyone');
  await pool.query('UPDATE family_yield_pool SET balance = 500 WHERE id=1');
  const paid = await payFamilyYield(pool);
  assert.equal((paid.families || []).filter((g) => npcNames.has(g.name)).length, 0,
    'and never draws a cent of it');
  assert.equal(Number((await pool.query('SELECT COALESCE(SUM(omr_reserve),0) s FROM gangs WHERE npc_flag')).rows[0].s), 0,
    'their reserves are untouched — the $OMR stayed where a real family can still win it');
  await pool.query('UPDATE gangs SET season_tribute=0 WHERE npc_flag');

  // ── EXCLUSION 3: WAR. A family that never retaliates is a fixed-price standing farm.
  const boss = await mk('War Hungry');
  await pool.query("UPDATE characters SET respect=250000, cash=9000000 WHERE id=$1", [boss.id]);
  assert.equal((await call('POST', '/v1/gangs', { token: boss.token, body: { name: 'Real Outfit', tag: 'REAL' } })).code, 200, 'a player founds their own');
  await pool.query('UPDATE gangs SET treasury=5000000 WHERE id=(SELECT gang_id FROM gang_members WHERE character_id=$1)', [boss.id]);
  const war = await call('POST', `/v1/gangs/war/${fams[0].id}`, { token: boss.token });
  assert.equal(war.code, 400, 'declaring war on an NPC family is refused');
  assert.equal(war.body.error, 'npc', 'and says why');

  // ── THE RETIREMENT HOLE this opens. Retirement is NOT a death — runEstate never sees it — so a
  // kept membership row is a phantom made man; and if they were the LAST member, a family that
  // never dissolves and never ledgers gang:dissolved, which is permanent §10.4 treasury drift.
  const solo = (await pool.query('SELECT id FROM gangs WHERE npc_flag ORDER BY id LIMIT 1')).rows[0].id;
  const roster = (await pool.query('SELECT character_id FROM gang_members WHERE gang_id=$1 ORDER BY character_id', [solo])).rows;
  await pool.query('UPDATE gangs SET treasury=4000 WHERE id=$1', [solo]);
  const cRet = await pool.connect();
  try {
    await cRet.query('BEGIN');
    for (const m of roster) await retireResident(cRet, m.character_id);
    await cRet.query('COMMIT');
  } catch (e) { await cRet.query('ROLLBACK'); throw e; } finally { cRet.release(); }
  assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM gang_members WHERE gang_id=$1', [solo])).rows[0].n), 0,
    'a retiring resident leaves the family — no phantom made man on the roster');
  assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM gangs WHERE id=$1', [solo])).rows[0].n), 0,
    'and the last one out dissolves it, through the audited path');
  assert.equal(Number((await pool.query(
    "SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='gang:dissolved' AND counterparty=$1", [solo])).rows[0].s), -4000,
    'with the treasury BURNED and ledgered — the drift the §10.4 job exists to catch');

  // ── THE FLAG IS ABOUT WHO RUNS IT. Succession can hand the chair to a player who joined as a
  // soldier, and a player-run family carrying the flag would be barred from the Commission and the
  // yield — a penalty applied to a player by a flag that was never about them.
  const heir = await mk('Made Man Marco');
  await pool.query('UPDATE characters SET respect=5000 WHERE id=$1', [heir.id]);
  const target = (await pool.query('SELECT id FROM gangs WHERE npc_flag ORDER BY id LIMIT 1')).rows[0].id;
  assert.equal((await call('POST', `/v1/gangs/${target}/join`, { token: heir.token })).code, 200, 'a player walks into a local outfit');
  assert.equal((await pool.query('SELECT npc_flag FROM gangs WHERE id=$1', [target])).rows[0].npc_flag, true,
    'joining as a soldier changes nothing — the house still runs it');
  const npcMembers = (await pool.query(
    `SELECT m.character_id FROM gang_members m JOIN characters c ON c.id=m.character_id
      WHERE m.gang_id=$1 AND c.is_npc ORDER BY m.character_id`, [target])).rows;
  const cSucc = await pool.connect();
  try {
    await cSucc.query('BEGIN');
    for (const m of npcMembers) await retireResident(cSucc, m.character_id);
    await cSucc.query('COMMIT');
  } catch (e) { await cSucc.query('ROLLBACK'); throw e; } finally { cSucc.release(); }
  assert.equal((await pool.query('SELECT npc_flag FROM gangs WHERE id=$1', [target])).rows[0].npc_flag, false,
    'but when the chair passes to the PLAYER, the family is theirs — the flag clears');

  // …and BACK, which is the half that matters for the war block. Clearing one-way would leave a
  // family that briefly had a player boss permanently unflagged; a resident then inherits it and it
  // is a resident-run family anyone can declare war on, over and over, for the season_wars standing
  // the block exists to stop paying out.
  const cBack = await pool.connect();
  let backBoss = null;
  try {
    await cBack.query('BEGIN');
    const rejoin = await spawnResident(cBack, { band: POPULATION.BANDS.find((b) => b.id === 'made'), marks: {} });
    backBoss = rejoin.id;
    await joinGang({ id: rejoin.id }, target, cBack, { owned: {} });
    await removeMember(cBack, target, heir.id);          // the player walks; the chair goes back
    await cBack.query('COMMIT');
  } catch (e) { await cBack.query('ROLLBACK'); throw e; } finally { cBack.release(); }
  assert.equal((await pool.query(
    'SELECT role FROM gang_members WHERE gang_id=$1 AND character_id=$2', [target, backBoss])).rows[0].role, 'boss',
    'the resident really did inherit the chair (or the next assertion proves nothing)');
  assert.equal((await pool.query('SELECT npc_flag FROM gangs WHERE id=$1', [target])).rows[0].npc_flag, true,
    'and when a RESIDENT takes it back the flag returns — no unflagged, unretaliating war target');
}

// A CITY THAT CANNOT AFFORD A NEW FAMILY MUST STILL FILL THE ONES IT HAS. The tick makes one
// structural change, and founding is checked first — so returning unconditionally after a FAILED
// founding starves the recruit pass forever whenever nobody can cover the fee, and thin families
// never fill. That is the JAILBIRDS-vs-turnover starvation (T1) in a second costume: two passes,
// one budget, the first taking priority whether or not it can use it.
{
  const F = POPULATION.FAMILIES;
  // fixture: below TARGET (so the founding branch runs), nobody can pay the fee (so it FAILS),
  // and one live family sits under MIN_MEMBERS
  const flagged = (await pool.query('SELECT id FROM gangs WHERE npc_flag ORDER BY id')).rows;
  assert(flagged.length, 'the city has NPC families to work with');
  for (const g of flagged.slice(F.TARGET - 1)) await pool.query('UPDATE gangs SET npc_flag=false WHERE id=$1', [g.id]);
  await pool.query('UPDATE characters SET cash=100 WHERE is_npc AND alive');
  const thin = (await pool.query('SELECT id FROM gangs WHERE npc_flag ORDER BY id LIMIT 1')).rows[0].id;
  const roster = (await pool.query('SELECT character_id FROM gang_members WHERE gang_id=$1', [thin])).rows;
  for (const m of roster.slice(1)) await pool.query('DELETE FROM gang_members WHERE gang_id=$1 AND character_id=$2', [thin, m.character_id]);
  const before = Number((await pool.query('SELECT COUNT(*) n FROM gang_members WHERE gang_id=$1', [thin])).rows[0].n);
  assert(before < F.MIN_MEMBERS, `the fixture really is thin (${before} < ${F.MIN_MEMBERS})`);

  const r = await runFamilies(pool);
  assert.equal(r.familiesFounded, 0, 'nobody could cover the founding fee — the precondition holds');
  assert.equal(r.familiesJoined, 1, 'so the tick spends itself RECRUITING instead of doing nothing');
  assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM gang_members WHERE gang_id=$1', [thin])).rows[0].n), before + 1,
    'and the thin family really gained a made man');
}

// THE FOUNDER IS READ UNDER A ROW LOCK. `createGang` deducts the fee IN MEMORY and leaves the caller
// to write the resulting cash back ABSOLUTELY, so a candidate picked from an unlocked shortlist and
// written back later CLOBBERS anything that debited them in between — and the highest-frequency
// writer against exactly these residents is the ordinary crime TAKE. Reproduced at the seam before
// the fix: the take's $5,000 came back and the per-character cash check moved by exactly that,
// because `gang:found` books −25,000 while the row only falls 25,000 from a stale figure.
//
// This is a SOURCE-LEVEL TRIPWIRE and is labelled as one: pg-mem is a single caller, so no test here
// can make two writers race. What it pins is the discipline every other resident writer in the file
// already follows (retireResident, residentAct) — re-read FOR UPDATE, re-verify, then write.
{
  const src = fs.readFileSync(new URL('../src/population.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('async function foundNpcFamily'), src.indexOf('async function recruitIntoFamily'));
  assert(/FROM characters WHERE id=\$1 AND alive AND is_npc FOR UPDATE/.test(fn),
    'foundNpcFamily re-reads the chosen founder FOR UPDATE before the absolute cash writeback');
  assert(fn.indexOf('FOR UPDATE') < fn.indexOf('createGang('),
    'and it takes that lock BEFORE createGang deducts the fee, not after');
  assert(/spendable\(ch\.cash\) < M3\.GANG_FOUND_COST/.test(fn),
    'and re-verifies affordability under the lock — they may have been drained since the shortlist');
}

console.log('✅ THE POPULATION passed — residents spawn as real flagged characters on the streets roster '
  + '(flag exposed), the npc:seed faucet + npc:retire sink keep §10.4 drift-0, the worker tops the city up '
  + 'and retires old lines, and residents never hold $OMR (nothing pays them any) and are excluded from City Standing, ops and the funnel; STEP TWO: they advertise consent limits, post SECURED loan offers and standing buy orders, and retire without stranding escrow — all pure recycling, zero new faucet; JAILBIRDS: the worker keeps TARGET residents in lockup (never over-fills, refills after a bust) so the §7.8 bust verb + the bust dailies work on a solo run — the reward is the signed ledgered bust:reward faucet; MARKS (Street War step two): residents spawn holding band-priced beaters (counted into car conservation via rng_audit npc:car grant/retire rows), sleepy-joint fronts whose rob cut prices at FRONT_INCOME_BPS of the catalog curve, dinghies at the docks, and self-bought freight (goods:buy, recycle-only, budget-floored above the picked-clean line) — stealable/robbable through the ordinary verbs with conservation exact through the whole grant→steal→retire cycle');
process.exit(0);

// THE POPULATION test (the 47th suite) — NPC residents of the city.
// Design: omerta-npc-population-design.md. Covers: spawn (real character + flagged account, banded
// level/stats/cash), the §10.4 ledger discipline (npc:seed is a ledgered FAUCET so residents sit
// inside the per-character cash check exactly like a player; npc:retire burns what they carried),
// the worker top-up to TARGET, retirement of old bloodlines, presence on the streets roster with the
// flag EXPOSED, and — the four that matter most — exclusion from the Street Wage (emission!), City
// Standing, the ops overview and the onboarding funnel.
//
// NOTE ON SEEDING: this suite never SQL-seeds value. Resident cash arrives through the ledgered
// `npc:seed` faucet inside spawnResident, which is the whole point — the §10.4 assertions below are
// only meaningful because nothing here writes cash behind the ledger's back.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { spawnResident, retireResident, runPopulation, population, runResidentBehaviour, residentAct, seededToday } from '../src/population.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { cityStanding } from '../src/standing.js';
import { funnelStats } from '../src/growth.js';
import { opsOverview } from '../src/ops.js';
import { runWageEpoch } from '../src/emission.js';
import { POPULATION, levelOf, npcBandOf, M3, DUELS, CASINO } from '../src/rules.js';

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
  const r = await runLedgerInvariants(pool);
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
// (1) THE STREET WAGE — the one that would be theft from the endowment
await pool.query("UPDATE account_persistent SET minted=true WHERE account_id=$1", [row.account_id]); // even MINTED, a resident must not draw
await pool.query('INSERT INTO wage_snapshots (character_id, epoch, respect) VALUES ($1,$2,$3)',
  [born.id, 0, 0]);   // enrolled last epoch with a big respect gain — the perfect wage candidate
const wage = await runWageEpoch(pool, 1);
const paidToNpc = await one("SELECT COUNT(*) n FROM transactions WHERE character_id=$1 AND reason='emission:wage'", [born.id]);
assert.equal(paidToNpc, 0, 'a resident draws NO Street Wage even fully enrolled + minted');
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
  const r = await runLedgerInvariants(pool);
  return r.checks.filter((c) => /escrow/.test(c.name)).map((c) => `${c.name}:${c.drift}`).join(' ');
};
const escrow0 = await escrowDrift();

// give every standing resident several turns so each behaviour branch fires
for (let i = 0; i < 12; i++) await runResidentBehaviour(pool);

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

// ════════════ THE VOCABULARY ════════════
const inv = await runLedgerInvariants(pool);
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab && vocab.ok, `npc: reasons are in the §10.4 cash vocabulary (${JSON.stringify(vocab)})`);
const retires = await one("SELECT COUNT(*) n FROM transactions WHERE reason='npc:retire'");
assert(retires > 0, 'retirements are ledgered');

// the band picker spans the roster instead of clustering
assert.equal(npcBandOf(0.0).id, 'corner', 'the low roll is the corner band');
assert.equal(npcBandOf(0.999).id, 'boss', 'the high roll is the boss band');

console.log('✅ THE POPULATION passed — residents spawn as real flagged characters on the streets roster '
  + '(flag exposed), the npc:seed faucet + npc:retire sink keep §10.4 drift-0, the worker tops the city up '
  + 'and retires old lines, and residents are excluded from the Street Wage, City Standing, ops and the funnel; STEP TWO: they advertise consent limits, post SECURED loan offers and standing buy orders, and retire without stranding escrow — all pure recycling, zero new faucet');
process.exit(0);

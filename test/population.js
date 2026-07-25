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
import { spawnResident, retireResident, runPopulation, population } from '../src/population.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { cityStanding } from '../src/standing.js';
import { funnelStats } from '../src/growth.js';
import { opsOverview } from '../src/ops.js';
import { runWageEpoch } from '../src/emission.js';
import { POPULATION, levelOf, npcBandOf } from '../src/rules.js';

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
  + 'and retires old lines, and residents are excluded from the Street Wage, City Standing, ops and the funnel');
process.exit(0);

// THE BLOOD WAR test — NPC families as a PvE antagonist (omerta-npc-families-defend-design.md).
//   · the board lists NPC families with strength/defense/loot; a player family is excluded
//   · a raid loots a bounded slice of the war_pool (a ledgered family:raid cash faucet + ammo sink),
//     banks the account-level family_war legend, drains the pool, sets the per-attacker cooldown
//   · THE DEFENCE — a landed raid can counter-hospitalize the raider (FAMILY_COUNTER pins it)
//   · a repel hospitalizes the raider, the pool untouched
//   · THE SEVERANCE — a raid NEVER bumps season_wars (no Commission faucet — the whole design)
//   · the gates (level / own_family / cooldown / bad_target) + the leaderboard
//   · §10.4 vocabulary stays closed (family:raid cash faucet + ammo sink). FAMILY_RAID_P pins the roll.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { FAMILY_WAR, familyWarRankOf } from '../src/rules.js';
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
const sum = async (reason, cid) => Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='${reason}'${cid ? ` AND character_id='${cid}'` : ''}`)).rows[0].s);

const raider = await mk('War Wolf');
await seedCh(raider.id, 'respect=5760, cash=50000, muscle=400, cunning=400, speed=100, energy=100, ammo=100'); // lvl 25
// an NPC family: found a gang through a resident-stand-in, then flag it + seed the war_pool
const founder = await mk('Don Fixture');
await seedCh(founder.id, 'cash=100000, respect=5760'); // lvl 25, past the found gate
const fg = await call('POST', '/v1/gangs', { token: founder.token, body: { name: 'The Fixture Family', tag: 'FIX' } });
assert.equal(fg.code, 200, `founded the family (${JSON.stringify(fg.body)})`);
const gid = (await pool.query(`SELECT gang_id FROM gang_members WHERE character_id='${founder.id}'`)).rows[0].gang_id;
await pool.query(`UPDATE gangs SET npc_flag=true, war_pool=${FAMILY_WAR.POOL_MAX}, war_pool_at=now(), season_wars=0 WHERE id='${gid}'`);

// ── THE BOARD ──
let b = (await call('GET', '/v1/npcfamily', { token: raider.token })).body;
assert.equal(b.families.length, 1, 'the NPC family is on the board');
const fam = b.families[0];
assert.equal(fam.strengthPct, 100, 'a fresh family is at full strength');
assert.equal(fam.defense, FAMILY_WAR.DEF_MAX, 'full-pool families defend at DEF_MAX');
const expectLoot = Math.min(Math.floor(FAMILY_WAR.POOL_MAX * FAMILY_WAR.RAID_BPS / 10000), FAMILY_WAR.RAID_MAX);
assert.equal(fam.loot, expectLoot, 'the board estimates the bounded loot');
assert.equal(b.you.rank, 'Unblooded', 'no blood on the ledger yet');

// ── THE GATES ──
const rook = await mk('Rookie Ray');
assert.equal((await call('POST', `/v1/npcfamily/${gid}/raid`, { token: rook.token })).body.error, 'level', 'a rookie can\'t run a blood-war raid');
assert.equal((await call('POST', `/v1/npcfamily/nope/raid`, { token: raider.token })).body.error, 'bad_target', 'no such outfit');

// ── A LANDED RAID (FAMILY_RAID_P=1, no counter) — bounded loot, legend, drain, cooldown, ammo sink ──
process.env.FAMILY_RAID_P = '1';
const cashPre = (await meOf(raider.token)).cash;
let r = await call('POST', `/v1/npcfamily/${gid}/raid`, { token: raider.token });
assert.equal(r.code, 200, `the raid lands (${JSON.stringify(r.body)})`);
assert.equal(r.body.success, true, 'a landed raid');
assert.equal(r.body.loot, expectLoot, 'the bounded loot');
assert.equal(r.body.countered, false, 'no counter this time (FAMILY_COUNTER off)');
assert.equal((await meOf(raider.token)).cash, cashPre + expectLoot, 'the loot hit the pocket');
assert.equal(await sum('family:raid', raider.id), expectLoot - FAMILY_WAR.RAID_AMMO, 'family:raid ledgered: +loot cash, −ammo (net over both currencies)');
// the account legend + rank
const fw = Number((await pool.query(`SELECT family_war FROM account_persistent WHERE account_id=(SELECT account_id FROM characters WHERE id='${raider.id}')`)).rows[0].family_war);
assert.equal(fw, expectLoot, 'the blood-war legend banked the loot');
// the pool drained by exactly the loot
const poolAfter = Number((await pool.query(`SELECT war_pool FROM gangs WHERE id='${gid}'`)).rows[0].war_pool);
assert.equal(poolAfter, FAMILY_WAR.POOL_MAX - expectLoot, 'the pool drained by exactly the loot');
// the cooldown is live
assert.equal((await call('POST', `/v1/npcfamily/${gid}/raid`, { token: raider.token })).body.error, 'cooldown', 'the per-attacker cooldown bites');

// ── THE SEVERANCE: a raid NEVER touches Commission standing ──
const seasonWars = Number((await pool.query(`SELECT season_wars FROM gangs WHERE id='${gid}'`)).rows[0].season_wars);
assert.equal(seasonWars, 0, 'THE SEVERANCE: a blood-war raid banks no season_wars — no Commission seat is bought');

// ── THE INTERLOCK: a beaten-down family is easier + lower-loot on the board ──
b = (await call('GET', '/v1/npcfamily', { token: raider.token })).body;
assert(b.families[0].strengthPct < 100 && b.families[0].defense < FAMILY_WAR.DEF_MAX, 'a raided family reads weaker on the board');

// ── THE DEFENCE: a landed raid can counter-hospitalize the raider ──
await seedCh(raider.id, 'family_raid_at=NULL, energy=100, ammo=100, hosp_until=NULL');
process.env.FAMILY_COUNTER = 'on';
r = await call('POST', `/v1/npcfamily/${gid}/raid`, { token: raider.token });
assert.equal(r.body.success, true, 'still a landed raid'); assert.equal(r.body.countered, true, 'THE DEFENCE — the family hit back');
assert((await meOf(raider.token)).hospSeconds > 0, 'the counter put the raider in the hospital');
delete process.env.FAMILY_COUNTER;

// ── A REPEL (FAMILY_RAID_P=0) — hospitalized, the pool untouched ──
await seedCh(raider.id, 'family_raid_at=NULL, energy=100, ammo=100, hosp_until=NULL');
const poolBeforeRepel = Number((await pool.query(`SELECT war_pool FROM gangs WHERE id='${gid}'`)).rows[0].war_pool);
process.env.FAMILY_RAID_P = '0';
r = await call('POST', `/v1/npcfamily/${gid}/raid`, { token: raider.token });
assert.equal(r.body.success, false, 'repelled'); assert(r.body.hospSeconds > 0, 'a repel hospitalizes the raider');
// pool regenerated a touch but was NOT looted — assert it's >= what it was (regen only, no drain)
const poolAfterRepel = Number((await pool.query(`SELECT war_pool FROM gangs WHERE id='${gid}'`)).rows[0].war_pool);
assert(poolAfterRepel >= poolBeforeRepel, 'a repelled raid does not loot the pool');
delete process.env.FAMILY_RAID_P;

// ── own_family: a member of the family can't raid it ──
await seedCh(raider.id, 'family_raid_at=NULL, hosp_until=NULL');
const member = await mk('Turncoat Tony');
await seedCh(member.id, 'respect=5760, energy=100, ammo=100');
assert.equal((await call('POST', `/v1/gangs/${gid}/join`, { token: member.token })).code, 200, 'joined the NPC family (step one)');
assert.equal((await call('POST', `/v1/npcfamily/${gid}/raid`, { token: member.token })).body.error, 'own_family', "you don't raid your own people");

// ── THE LEADERBOARD ──
const lb = (await call('GET', '/v1/leaderboard/blood-wars', { token: raider.token })).body;
assert(lb.warmakers.some((w) => w.name === 'War Wolf' && w.war > 0), 'the family-killer is on the blood-war board');

// ── §10.4: the vocabulary knows family:raid (cash faucet + ammo sink) ──
const vocab = (await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `family:raid rides the 'family' prefix (${JSON.stringify(vocab.unknown || [])})`);

console.log('✅ THE BLOOD WAR test passed — the board (strength/defense/loot, player family excluded), a landed raid (bounded family:raid loot + legend + pool drain + ammo sink + cooldown), THE SEVERANCE (no season_wars → no Commission seat), the interlock (a beaten family reads weaker), THE DEFENCE (a counter hospitalizes the raider), a repel (hospitalized, pool untouched), the gates (level/own_family/cooldown/bad_target), the leaderboard, and §10.4 (family: vocabulary closed)');
await app.close();

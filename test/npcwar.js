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
import { sweepFamilyAggro, sweepNpcWars, sweepNpcAggression } from '../src/npcwar.js';
import { readFileSync as _readSrc } from 'node:fs';

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

// ── THE MANHUNT (step three): a raider who ESCAPED the scene counter is hunted down later ──
await pool.query('DELETE FROM family_aggro');   // start clean
await seedCh(raider.id, 'family_raid_at=NULL, energy=100, ammo=100, hosp_until=NULL, safe_until=NULL');
process.env.FAMILY_RAID_P = '1';                // FAMILY_COUNTER unset → cRoll=1 ≥ COUNTER_P → escaped → aggro scheduled
r = await call('POST', `/v1/npcfamily/${gid}/raid`, { token: raider.token });
assert.equal(r.body.countered, false, 'escaped the scene → a manhunt is scheduled');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM family_aggro WHERE gang_id='${gid}'`)).rows[0].n), 1, 'the family remembers the raider');
// warp it due + force the strike → the raider is hunted down
await pool.query(`UPDATE family_aggro SET scheduled_at = now() - interval '1 minute' WHERE gang_id='${gid}'`);
await seedCh(raider.id, 'hosp_until=NULL');
process.env.FAMILY_RETAL_P = '1';
let mh = await sweepFamilyAggro(pool);
assert.equal(mh.struck, 1, 'THE MANHUNT — the family hunted the raider down');
assert((await meOf(raider.token)).hospSeconds > 0, 'the manhunt put the raider in the hospital');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM family_aggro WHERE gang_id='${gid}'`)).rows[0].n), 0, 'the manhunt is one-shot (row cleared)');
// SHIELD-HONOURING: a raider who hides during the delay dodges the manhunt
await seedCh(raider.id, 'family_raid_at=NULL, energy=100, ammo=100, hosp_until=NULL');
r = await call('POST', `/v1/npcfamily/${gid}/raid`, { token: raider.token });
assert.equal(r.body.countered, false, 'escaped again');
await pool.query(`UPDATE family_aggro SET scheduled_at = now() - interval '1 minute' WHERE gang_id='${gid}'`);
await seedCh(raider.id, `safe_until = now() + interval '1 hour', hosp_until=NULL`); // gone to ground
mh = await sweepFamilyAggro(pool);
assert.equal(mh.struck, 0, 'a hidden raider dodges the manhunt (shield-honouring)');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM family_aggro WHERE gang_id='${gid}'`)).rows[0].n), 0, 'a missed manhunt still clears the aggro (one shot)');
delete process.env.FAMILY_RETAL_P; delete process.env.FAMILY_RAID_P;
await seedCh(raider.id, 'safe_until=NULL, family_raid_at=NULL, hosp_until=NULL');

// ── own_family: a member of the family can't raid it ──
await seedCh(raider.id, 'family_raid_at=NULL, hosp_until=NULL');
const member = await mk('Turncoat Tony');
await seedCh(member.id, 'respect=5760, energy=100, ammo=100');
assert.equal((await call('POST', `/v1/gangs/${gid}/join`, { token: member.token })).code, 200, 'joined the NPC family (step one)');
assert.equal((await call('POST', `/v1/npcfamily/${gid}/raid`, { token: member.token })).body.error, 'own_family', "you don't raid your own people");

// ── THE CONQUEST (step three): routing an NPC family lets the raider's FAMILY hold it as a vassal ──
// the raider founds a family, then routs the NPC family (war_pool crosses the floor) → conquest.
await seedCh(raider.id, 'family_raid_at=NULL, energy=100, ammo=100, hosp_until=NULL, safe_until=NULL');
assert.equal((await call('POST', '/v1/gangs', { token: raider.token, body: { name: 'The Wolf Pack', tag: 'WLF' } })).code, 200, 'the raider founds a family');
const wolfGang = (await pool.query(`SELECT gang_id FROM gang_members WHERE character_id='${raider.id}'`)).rows[0].gang_id;
const floor = FAMILY_WAR.POOL_MAX * FAMILY_WAR.ROUT_FLOOR_BPS / 10000;
await pool.query(`UPDATE gangs SET war_pool=${floor + 500}, war_pool_at=now() WHERE id='${gid}'`); // just above the rout floor
process.env.FAMILY_RAID_P = '1';
r = await call('POST', `/v1/npcfamily/${gid}/raid`, { token: raider.token });
assert.equal(r.body.conquered, true, `THE CONQUEST — routing the family claims it (${JSON.stringify(r.body)})`);
assert.equal((await pool.query(`SELECT held_by_gang FROM gangs WHERE id='${gid}'`)).rows[0].held_by_gang, wolfGang, 'the NPC family flies the raider family\'s flag');
delete process.env.FAMILY_RAID_P;
// the board shows the vassal as mine
b = (await call('GET', '/v1/npcfamily', { token: raider.token })).body;
assert.equal(b.you.vassals, 1, 'the board counts my vassal');
assert(b.families.find((f) => f.id === gid)?.heldBy?.mine, 'the conquered family is flagged as mine');
// own_vassal (red-team AUDIT-blood-war): you don't raid an outfit your own family already holds
await seedCh(raider.id, 'family_raid_at=NULL, energy=100, ammo=100, hosp_until=NULL');
assert.equal((await call('POST', `/v1/npcfamily/${gid}/raid`, { token: raider.token })).body.error, 'own_vassal', "you don't raid your own vassal");
// tribute accrues → collect to the treasury (a ledgered family:tribute faucet)
await pool.query(`UPDATE gangs SET tribute_at = now() - interval '10 hours' WHERE id='${gid}'`);
const col = await call('POST', '/v1/npcfamily/collect', { token: raider.token });
assert.equal(col.code, 200, `collected tribute (${JSON.stringify(col.body)})`);
assert(col.body.collected > 0, 'the vassal paid tribute to the treasury');
assert.equal(await sum('family:tribute'), col.body.collected, 'the tribute is a ledgered family:tribute faucet');
const gtCheck = (await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === 'gang treasuries');
assert(gtCheck.ok, `family:tribute reconciles the gang-treasuries check (${JSON.stringify(gtCheck)})`);
// the conquest leaderboard
const clb = (await call('GET', '/v1/leaderboard/conquest', { token: raider.token })).body;
assert(clb.families.some((f) => f.name === 'The Wolf Pack' && f.vassals === 1), 'the conqueror tops the conquest board');

// ── THE LEADERBOARD ──
const lb = (await call('GET', '/v1/leaderboard/blood-wars', { token: raider.token })).body;
assert(lb.warmakers.some((w) => w.name === 'War Wolf' && w.war > 0), 'the family-killer is on the blood-war board');

// ══════════ THE FAMILY WAR (formal declaration) ══════════
// A SEPARATE NPC family to war on (gid is now the raider's vassal). Fund the raider's family war chest
// through the LEDGERED tribute route (not a direct treasury seed) so the gang-treasuries §10.4 check
// stays exact — then it can prove the gang:war sink reconciles for an NPC-family war too.
const W = FAMILY_WAR.WAR;
const sf = await mk('Don Second');
await seedCh(sf.id, 'cash=100000, respect=5760');
const fg2 = await call('POST', '/v1/gangs', { token: sf.token, body: { name: 'The Second Family', tag: 'SEC' } });
assert.equal(fg2.code, 200, `founded the second family (${JSON.stringify(fg2.body)})`);
const gid2 = (await pool.query(`SELECT gang_id FROM gang_members WHERE character_id='${sf.id}'`)).rows[0].gang_id;
await pool.query(`UPDATE gangs SET npc_flag=true, war_pool=${FAMILY_WAR.POOL_MAX}, war_pool_at=now() WHERE id='${gid2}'`);
// the raider (boss of The Wolf Pack) tributes cash into the treasury — ledgered gang:tribute
await seedCh(raider.id, `cash=${W.COST * 3}, family_raid_at=NULL, energy=100, ammo=100, hosp_until=NULL`);
assert.equal((await call('POST', '/v1/gangs/tribute', { token: raider.token, body: { amount: W.COST * 2 } })).code, 200, 'funded the war chest via ledgered tribute');

// the rank gate: a soldier of a family can't declare
assert.equal((await call('POST', `/v1/npcfamily/${gid2}/war`, { token: member.token })).body.error, 'rank', 'only the boss/underboss declares a family war');
// the boss declares — the EXISTING gang:war treasury sink, and NO season_wars (the severance)
const treasPre = Number((await pool.query(`SELECT treasury FROM gangs WHERE id='${wolfGang}'`)).rows[0].treasury);
const dw = await call('POST', `/v1/npcfamily/${gid2}/war`, { token: raider.token });
assert.equal(dw.code, 200, `war declared (${JSON.stringify(dw.body)})`);
assert.equal(dw.body.winScore, W.WIN_SCORE, 'the win score is surfaced');
assert.equal(Number((await pool.query(`SELECT treasury FROM gangs WHERE id='${wolfGang}'`)).rows[0].treasury), treasPre - W.COST, 'the war chest burned from the treasury');
assert.equal(Number((await pool.query(`SELECT season_wars FROM gangs WHERE id='${wolfGang}'`)).rows[0].season_wars || 0), 0, 'a family war grants NO season_wars — the Commission-standing faucet stays severed by construction');
// one campaign at a time (MAX_PER_FAMILY) — a SECOND front on a different, unheld NPC family is blocked
const tf = await mk('Don Third');
await seedCh(tf.id, 'cash=100000, respect=5760');
await call('POST', '/v1/gangs', { token: tf.token, body: { name: 'The Third Family', tag: 'THR' } });
const gid3 = (await pool.query(`SELECT gang_id FROM gang_members WHERE character_id='${tf.id}'`)).rows[0].gang_id;
await pool.query(`UPDATE gangs SET npc_flag=true, war_pool=${FAMILY_WAR.POOL_MAX}, war_pool_at=now() WHERE id='${gid3}'`);
assert.equal((await call('POST', `/v1/npcfamily/${gid3}/war`, { token: raider.token })).body.error, 'at_war', 'one active campaign per family (no second front)');
// the board decorates the family with the live campaign
b = (await call('GET', '/v1/npcfamily', { token: raider.token })).body;
assert(b.families.find((f) => f.id === gid2)?.atWar?.score === 0, 'the board shows the live campaign at score 0');
assert.equal(b.you.activeWars, 1, 'the board counts my active war');
assert.equal(b.you.warsWon, 0, 'no campaigns won yet');

// SCORE the campaign: WIN_SCORE landed raids on the family win it (keep the pool topped so it stays a
// WAR, not a rout/conquest). The trophy → the DECLARER's account (survives death, never season_wars).
process.env.FAMILY_RAID_P = '1';
let last;
for (let i = 0; i < W.WIN_SCORE; i++) {
  await seedCh(raider.id, 'family_raid_at=NULL, energy=100, ammo=100, hosp_until=NULL');
  await pool.query(`UPDATE gangs SET war_pool=${FAMILY_WAR.POOL_MAX}, war_pool_at=now() WHERE id='${gid2}'`);
  last = await call('POST', `/v1/npcfamily/${gid2}/raid`, { token: raider.token });
  assert.equal(last.code, 200, `war raid ${i + 1} landed (${JSON.stringify(last.body)})`);
}
assert.equal(last.body.warWon, true, 'the WIN_SCORE-th landed raid wins the campaign');
const winsA = Number((await pool.query(`SELECT family_wars_won FROM account_persistent WHERE account_id=(SELECT account_id FROM characters WHERE id='${raider.id}')`)).rows[0].family_wars_won);
assert.equal(winsA, 1, "the declarer's war-chief trophy banked the win");
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM npc_wars WHERE attacker_gang='${wolfGang}' AND npc_gang='${gid2}' AND NOT resolved`)).rows[0].n), 0, 'the won campaign is resolved');
// the war-chief leaderboard
const wlb = (await call('GET', '/v1/leaderboard/family-wars', { token: raider.token })).body;
assert(wlb.chiefs.some((c) => c.name === 'War Wolf' && c.wins === 1), 'the war chief tops the family-war board');

// THE LAPSE — a campaign that expires below the score just closes: no trophy, no penalty. A win freed
// the slot, so a fresh (1ms) campaign can be declared; the worker lapses it.
await seedCh(raider.id, `cash=${W.COST * 2}`);
assert.equal((await call('POST', '/v1/gangs/tribute', { token: raider.token, body: { amount: W.COST } })).code, 200, 're-funded the treasury');
process.env.NPC_WAR_MS = '1';
assert.equal((await call('POST', `/v1/npcfamily/${gid2}/war`, { token: raider.token })).code, 200, 'declared a short campaign');
delete process.env.NPC_WAR_MS; delete process.env.FAMILY_RAID_P;
await new Promise((r) => setTimeout(r, 8));
const swept = await sweepNpcWars(pool);
assert(swept.lapsed >= 1, 'the worker lapses an expired campaign');
assert.equal(Number((await pool.query(`SELECT family_wars_won FROM account_persistent WHERE account_id=(SELECT account_id FROM characters WHERE id='${raider.id}')`)).rows[0].family_wars_won), 1, 'a lapsed campaign grants NO trophy (still 1 from the win)');

// (red-team) CONQUERING an outfit you're at war with WINS the campaign. Routing it makes it your vassal,
// which would otherwise throw own_vassal on every future raid and strand the war unwon (chest wasted).
// Declare on the third family, seed its pool just above the rout floor, and one raid routs+conquers → won.
await seedCh(raider.id, `cash=${W.COST * 2}, family_raid_at=NULL, energy=100, ammo=100, hosp_until=NULL, safe_until=NULL`);
assert.equal((await call('POST', '/v1/gangs/tribute', { token: raider.token, body: { amount: W.COST } })).code, 200, 're-funded the treasury');
assert.equal((await call('POST', `/v1/npcfamily/${gid3}/war`, { token: raider.token })).code, 200, 'declared war on the third family');
const routFloor = FAMILY_WAR.POOL_MAX * FAMILY_WAR.ROUT_FLOOR_BPS / 10000;
await pool.query(`UPDATE gangs SET war_pool=${routFloor + 500}, war_pool_at=now() WHERE id='${gid3}'`);
process.env.FAMILY_RAID_P = '1';
const cr = await call('POST', `/v1/npcfamily/${gid3}/raid`, { token: raider.token });
delete process.env.FAMILY_RAID_P;
assert.equal(cr.body.conquered, true, `the raid routs and conquers the third family (${JSON.stringify(cr.body)})`);
assert.equal(cr.body.warWon, true, 'conquering an outfit you are at war with WINS the campaign, even below WIN_SCORE');
assert.equal(Number((await pool.query(`SELECT family_wars_won FROM account_persistent WHERE account_id=(SELECT account_id FROM characters WHERE id='${raider.id}')`)).rows[0].family_wars_won), 2, 'the conquest-win banked a second trophy');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM npc_wars WHERE attacker_gang='${wolfGang}' AND npc_gang='${gid3}' AND NOT resolved`)).rows[0].n), 0, 'the conquest-won campaign is resolved');

// §10.4: the gang:war war-chest sink reconciles the gang-treasuries check (funded by ledgered tribute)
const gt2 = (await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === 'gang treasuries');
assert(gt2.ok, `the family-war gang:war sink reconciles the gang-treasuries check (${JSON.stringify(gt2)})`);

// ══════════════════ THE OFFENSIVE — NPC families that DECLARE FIRST (step four) ══════════════════
// A worker opens a hostility from an NPC family onto a real player family unprompted; while live it strikes
// on cadence via the SHIPPED shield-honouring family_aggro primitive. §10.4-NEUTRAL (a strike is pure
// pacing). Counterplay: routing the outfit (conquest) ends its aggression.
const A = FAMILY_WAR.AGGRESSION;
// build a REAL player family with MIN_MEMBERS living made men (the only ≥2-member player gang — wolfGang
// has one, so the picker will target THIS one deterministically).
const capo = await mk('Vito Target'); await seedCh(capo.id, 'cash=100000, respect=5760'); // lvl 25, past the found gate
const tg = await call('POST', '/v1/gangs', { token: capo.token, body: { name: 'The Targets', tag: 'TGT' } });
assert.equal(tg.code, 200, `founded the target family (${JSON.stringify(tg.body)})`);
const targetGid = (await pool.query(`SELECT gang_id FROM gang_members WHERE character_id='${capo.id}'`)).rows[0].gang_id;
const soldier = await mk('Sal Soldier'); await seedCh(soldier.id, 'respect=5760'); // lvl 25
assert.equal((await call('POST', `/v1/gangs/${targetGid}/join`, { token: soldier.token })).code, 200, 'the soldier joins the family');

// no aggressions live yet → PASS 3 opens exactly one onto the only ≥2-member player family. Ensure at
// least one UNHELD NPC family is an eligible aggressor (earlier blocks conquered gid/gid2/gid3).
await pool.query(`UPDATE gangs SET held_by_gang=NULL, war_pool=${FAMILY_WAR.POOL_MAX}, war_pool_at=now() WHERE id='${gid}'`);
await pool.query('DELETE FROM npc_aggression');
await pool.query(`UPDATE gangs SET npc_aggro_until=NULL WHERE id='${targetGid}'`);
const txPre = Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n);
let off = await sweepNpcAggression(pool);
assert(off.opened >= 1, `an NPC family opened a hostility (${JSON.stringify(off)})`);
const ag = (await pool.query(`SELECT npc_gang, target_gang FROM npc_aggression WHERE target_gang='${targetGid}'`)).rows[0];
assert(ag, 'the hostility targets the real player family');
const openedNpc = ag.npc_gang;
assert((await pool.query(`SELECT npc_flag FROM gangs WHERE id='${openedNpc}'`)).rows[0].npc_flag, 'the aggressor is an NPC family');
// every member SEES it (agency — hit them back), and the harassed family gets a post-lapse peace window
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM notifications WHERE type='npc_aggression' AND character_id IN ('${capo.id}','${soldier.id}')`)).rows[0].n), 2, 'both members are told the family opened hostilities');
assert((await pool.query(`SELECT npc_aggro_until FROM gangs WHERE id='${targetGid}'`)).rows[0].npc_aggro_until, 'the peace/cooldown window is set');
// the board surfaces it on the harassed family's side
const capoBoard = (await call('GET', '/v1/npcfamily', { token: capo.token })).body;
assert.equal(capoBoard.you.underFire.length, 1, 'the board shows the family who to hit back');
assert.equal(capoBoard.you.underFire[0].id, openedNpc, 'it names the aggressor');
// under fire, the picker does NOT pile a second NPC family on the same target (one at a time)
off = await sweepNpcAggression(pool);
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM npc_aggression WHERE target_gang='${targetGid}'`)).rows[0].n), 1, 'a family under fire is not piled on by a second');

// ── THE STRIKE — a due aggression enqueues a family_aggro hit on a member (shield-honouring at resolve) ──
await pool.query(`UPDATE npc_aggression SET next_strike_at=now() WHERE npc_gang='${openedNpc}'`);
await pool.query(`DELETE FROM family_aggro WHERE gang_id='${openedNpc}'`);
off = await sweepNpcAggression(pool);
assert.equal(off.struck, 1, `the aggression enqueued a strike (${JSON.stringify(off)})`);
const strike = (await pool.query(`SELECT target_character FROM family_aggro WHERE gang_id='${openedNpc}'`)).rows[0];
assert([capo.id, soldier.id].includes(strike.target_character), 'the strike marks a member of the family');

const hospOf = async (id) => (await pool.query(`SELECT hosp_until FROM characters WHERE id='${id}'`)).rows[0].hosp_until;
// SHIELD-HONOURING: a safe-housed mark takes no hit even with the retaliation roll forced
await seedCh(strike.target_character, `safe_until = now() + interval '1 hour', hosp_until=NULL`);
process.env.FAMILY_RETAL_P = '1';
await sweepFamilyAggro(pool);
assert(!(await hospOf(strike.target_character)), 'the earned shield turns the strike into a clean miss');
// unshielded, the same forced roll lands the hospitalization (both members are reachable now)
await seedCh(capo.id, 'safe_until=NULL, hosp_until=NULL, safehouse_used=0');
await seedCh(soldier.id, 'safe_until=NULL, hosp_until=NULL, safehouse_used=0');
await pool.query(`UPDATE npc_aggression SET next_strike_at=now() WHERE npc_gang='${openedNpc}'`);
await pool.query(`DELETE FROM family_aggro WHERE gang_id='${openedNpc}'`);
await sweepNpcAggression(pool);
const strike2 = (await pool.query(`SELECT target_character FROM family_aggro WHERE gang_id='${openedNpc}'`)).rows[0].target_character;
await sweepFamilyAggro(pool);
delete process.env.FAMILY_RETAL_P;
assert(await hospOf(strike2), 'an unshielded member is hospitalized — the world hit back');

// §10.4-NEUTRAL: opening + striking + lapsing moved ZERO value
assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n), txPre, 'the whole offensive wrote no ledger rows');

// ── COUNTERPLAY: routing the aggressor (conquest) ends its hostility ──
await seedCh(raider.id, 'family_raid_at=NULL, energy=100, ammo=100, hosp_until=NULL');
await pool.query(`UPDATE gangs SET war_pool=${routFloor + 500}, war_pool_at=now(), held_by_gang=NULL WHERE id='${openedNpc}'`);
process.env.FAMILY_RAID_P = '1';
const conq = await call('POST', `/v1/npcfamily/${openedNpc}/raid`, { token: raider.token });
delete process.env.FAMILY_RAID_P;
assert.equal(conq.body.conquered, true, `the raider routs and conquers the aggressor (${JSON.stringify(conq.body)})`);
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM npc_aggression WHERE npc_gang='${openedNpc}'`)).rows[0].n), 0, 'conquering the outfit ended its hostility — a vassal does not war its overlord');

// ── LAPSE: an expired hostility is reaped ──
await pool.query('DELETE FROM npc_aggression');
await pool.query(`INSERT INTO npc_aggression (npc_gang, target_gang, ends_at, next_strike_at) VALUES ('${gid}','${targetGid}', now() - interval '1 minute', now())`);
off = await sweepNpcAggression(pool);
assert.equal(off.lapsed, 1, 'the expired hostility lapsed');
await pool.query('DELETE FROM npc_aggression');

// ══════════════════ NPC-FAMILY DIPLOMACY — sue for peace + NPC alliances (2026-08-06) ══════════════════
// A player can sue an NPC family for PEACE (the existing pact route); the worker signs the NPC's side,
// signing ENDS its live OFFENSIVE on you, and while the pact stands the OFFENSIVE won't target you AND you
// can't raid them. §10.4-NEUTRAL (a pact is a status row). Plus NPC↔NPC alliance flavor on the board.
const { sweepNpcDiplomacy } = await import('../src/diplomacy.js');
// a fresh unheld NPC family to sue for peace (the founding is SETUP — the §10.4 snapshot is taken after it)
const pfounder = await mk('Don Peace'); await seedCh(pfounder.id, 'cash=100000, respect=5760');
const pfg = await call('POST', '/v1/gangs', { token: pfounder.token, body: { name: 'The Peaceables', tag: 'PAX' } });
assert.equal(pfg.code, 200, `founded the peace NPC family (${JSON.stringify(pfg.body)})`);
const peaceNpc = (await pool.query(`SELECT gang_id FROM gang_members WHERE character_id='${pfounder.id}'`)).rows[0].gang_id;
await pool.query(`UPDATE gangs SET npc_flag=true, war_pool=${FAMILY_WAR.POOL_MAX}, war_pool_at=now(), held_by_gang=NULL WHERE id='${peaceNpc}'`);
const dipTxPre = Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n);

// capo (boss of The Targets) sues the outfit for peace → a pending offer
const prop = await call('POST', `/v1/diplomacy/pact/${peaceNpc}`, { token: capo.token });
assert.equal(prop.code, 200, `sued for peace (${JSON.stringify(prop.body)})`);
assert(prop.body.pending, 'the offer is on the table');
// seed a live hostility from that outfit onto the family — signing peace must END it
await pool.query(`INSERT INTO npc_aggression (npc_gang, target_gang, ends_at, next_strike_at) VALUES ('${peaceNpc}','${targetGid}', now() + interval '1 hour', now() + interval '1 hour')`);
const nd = await sweepNpcDiplomacy(pool);
assert(nd.signed >= 1, `the outfit came to the table and signed (${JSON.stringify(nd)})`);
const pactRow = (await pool.query(`SELECT accepted, until FROM gang_relations WHERE kind='pact' AND ((gang_a='${targetGid}' AND gang_b='${peaceNpc}') OR (gang_a='${peaceNpc}' AND gang_b='${targetGid}'))`)).rows[0];
assert(pactRow && pactRow.accepted && new Date(pactRow.until) > new Date(), 'the peace pact is sworn');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM npc_aggression WHERE npc_gang='${peaceNpc}' AND target_gang='${targetGid}'`)).rows[0].n), 0, 'making peace ended their live hostility');
// the board surfaces the peace on the harassed family's side
const capoBw = (await call('GET', '/v1/npcfamily', { token: capo.token })).body;
const peaceFam = capoBw.families.find((f) => f.id === peaceNpc);
assert(peaceFam && peaceFam.pact && peaceFam.pact.active, 'the war board shows the family at peace');

// THE RAID GATE — you can't raid an outfit you've sworn peace with
await seedCh(capo.id, 'energy=100, ammo=100, family_raid_at=NULL, hosp_until=NULL, jail_until=NULL, safe_until=NULL');
assert.equal((await call('POST', `/v1/npcfamily/${peaceNpc}/raid`, { token: capo.token })).body.error, 'pact', 'a sworn peace blocks the raid — break it first');

// NPC↔NPC ALLIANCES — the worker forms them among NPC families (flavor, pure status)
for (let i = 0; i < 4; i++) await sweepNpcDiplomacy(pool);
const npcIdRows = (await pool.query('SELECT id FROM gangs WHERE npc_flag')).rows.map((r) => `'${r.id}'`).join(',');
const alliances = Number((await pool.query(`SELECT COUNT(*) n FROM gang_relations WHERE kind='pact' AND accepted AND until > now() AND gang_a IN (${npcIdRows}) AND gang_b IN (${npcIdRows})`)).rows[0].n);
assert(alliances >= 1, 'the NPC families have formed at least one alliance among themselves');
const anyAllied = (await call('GET', '/v1/npcfamily', { token: capo.token })).body.families.some((f) => (f.allies || []).length > 0);
assert(anyAllied, 'the war board surfaces an NPC family\'s allies — the landscape is not all-human');

// THE PICKER EXCLUSION — a pact severs the pair, so the OFFENSIVE won't open on a family at peace. Make
// peaceNpc the only eligible aggressor and targetGid the only ≥2-member target: with the pact, no pair.
await pool.query(`UPDATE gangs SET held_by_gang='${wolfGang}' WHERE npc_flag AND id != '${peaceNpc}'`);
await pool.query('DELETE FROM npc_aggression');
await pool.query(`UPDATE gangs SET npc_aggro_until=NULL WHERE id='${targetGid}'`);
assert.equal((await sweepNpcAggression(pool)).opened, 0, 'a sworn peace keeps the OFFENSIVE off the pair');
// tear the pact down directly → the only pair is open again
await pool.query(`DELETE FROM gang_relations WHERE (gang_a='${targetGid}' AND gang_b='${peaceNpc}') OR (gang_a='${peaceNpc}' AND gang_b='${targetGid}')`);
await pool.query(`UPDATE gangs SET npc_aggro_until=NULL WHERE id='${targetGid}'`);
const reopened = await sweepNpcAggression(pool);
assert.equal(reopened.opened, 1, 'with the peace gone the outfit opens hostilities again');
assert.equal((await pool.query(`SELECT target_gang FROM npc_aggression WHERE npc_gang='${peaceNpc}'`)).rows[0].target_gang, targetGid, 'and it targets the family it was at peace with');
await pool.query('DELETE FROM npc_aggression');

// §10.4-NEUTRAL: the whole diplomacy layer moved ZERO value
assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n), dipTxPre, 'NPC diplomacy wrote no ledger rows');

// ══════════════════ ALLIES JOIN THE OFFENSIVE (2026-08-06) ══════════════════
// The aggressor's NPC allies send guns at the same target on each strike cycle (each its own family_aggro
// slot) — up to ALLY_JOIN_MAX. An ally at PEACE with the target stays out. §10.4-neutral (the same primitive).
const af = await mk('Don Agg'); await seedCh(af.id, 'cash=100000, respect=5760');
await call('POST', '/v1/gangs', { token: af.token, body: { name: 'The Aggressors', tag: 'AGG' } });
const aggNpc = (await pool.query(`SELECT gang_id FROM gang_members WHERE character_id='${af.id}'`)).rows[0].gang_id;
const bf = await mk('Don Ally'); await seedCh(bf.id, 'cash=100000, respect=5760');
await call('POST', '/v1/gangs', { token: bf.token, body: { name: 'The Allies', tag: 'ALY' } });
const allyNpc = (await pool.query(`SELECT gang_id FROM gang_members WHERE character_id='${bf.id}'`)).rows[0].gang_id;
await pool.query(`UPDATE gangs SET npc_flag=true, held_by_gang=NULL, war_pool=${FAMILY_WAR.POOL_MAX}, war_pool_at=now() WHERE id IN ('${aggNpc}','${allyNpc}')`);
// an alliance between them (accepted npc↔npc pact)
const [aa1, aa2] = [aggNpc, allyNpc].sort();
await pool.query(`INSERT INTO gang_relations (gang_a, gang_b, kind, proposed_by, accepted, until) VALUES ('${aa1}','${aa2}','pact','${aggNpc}',true, now() + interval '2 hours')`);
await seedCh(capo.id, 'safe_until=NULL, hosp_until=NULL, jail_until=NULL');
await seedCh(soldier.id, 'safe_until=NULL, hosp_until=NULL, jail_until=NULL');
await pool.query('DELETE FROM npc_aggression');
await pool.query(`DELETE FROM family_aggro WHERE gang_id IN ('${aggNpc}','${allyNpc}')`);
await pool.query(`UPDATE gangs SET npc_aggro_until=NULL WHERE id='${targetGid}'`);
await pool.query(`INSERT INTO npc_aggression (npc_gang, target_gang, ends_at, next_strike_at) VALUES ('${aggNpc}','${targetGid}', now() + interval '2 hours', now())`);
await sweepNpcAggression(pool);
const strikers = (await pool.query(`SELECT gang_id, target_character FROM family_aggro WHERE gang_id IN ('${aggNpc}','${allyNpc}')`)).rows;
assert.equal(strikers.length, 2, `the aggressor AND its ally both sent guns (${JSON.stringify(strikers)})`);
assert(strikers.every((s) => [capo.id, soldier.id].includes(s.target_character)), 'both strikes mark a member of the family');
// the board names the ally who may join
const bwUf = (await call('GET', '/v1/npcfamily', { token: capo.token })).body.you.underFire.find((u) => u.id === aggNpc);
assert(bwUf && (bwUf.allies || []).includes('The Allies'), 'the war board names the aggressor\'s ally as a joiner');

// PEACE with the ally keeps it out — sue the ally, the worker signs it, then the ally sits the cycle out
await call('POST', `/v1/diplomacy/pact/${allyNpc}`, { token: capo.token });
await sweepNpcDiplomacy(pool);
await pool.query(`DELETE FROM family_aggro WHERE gang_id IN ('${aggNpc}','${allyNpc}')`);
await pool.query(`UPDATE npc_aggression SET next_strike_at=now() WHERE npc_gang='${aggNpc}'`);
await sweepNpcAggression(pool);
const after = (await pool.query(`SELECT gang_id FROM family_aggro WHERE gang_id IN ('${aggNpc}','${allyNpc}')`)).rows.map((r) => r.gang_id);
assert(after.includes(aggNpc), 'the aggressor still strikes');
assert(!after.includes(allyNpc), 'an ally at peace with the family stays out of the OFFENSIVE');
await pool.query('DELETE FROM npc_aggression');

// ── §10.4: the vocabulary knows family:raid (cash faucet + ammo sink) ──
const vocab = (await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `family:raid rides the 'family' prefix (${JSON.stringify(vocab.unknown || [])})`);

// (red-team R28 #1) sweepFamilyAggro must CLAIM the family_aggro row before striking — the DELETE uses
// RETURNING and the strike is guarded by the claimed rowCount, so two overlapping workers reading the
// same due row can't both hospitalize + double-notify (the push.js C1 class). pg-mem is single-caller and
// can't interleave two workers, so this is a labelled source tripwire on the claim discipline. The happy
// path (struck==1, row cleared) and the shield-honouring miss (struck==0) are behaviorally covered above.
{
  const warSrc = _readSrc(new URL('../src/npcwar.js', import.meta.url), 'utf8');
  assert(/DELETE FROM family_aggro WHERE gang_id=\$1 RETURNING gang_id/.test(warSrc), 'sweepFamilyAggro DELETE claims the row (RETURNING)');
  assert(/if \(claimed\.rowCount && g && t\)/.test(warSrc), 'the strike is guarded by the claim rowCount (one worker only)');
}

console.log('✅ THE BLOOD WAR test passed — the board (strength/defense/loot, player family excluded), a landed raid (bounded family:raid loot + legend + pool drain + ammo sink + cooldown), THE SEVERANCE (no season_wars → no Commission seat), the interlock (a beaten family reads weaker), THE DEFENCE (a counter hospitalizes the raider), THE MANHUNT (an escaped raider is hunted down later, shield-honouring, one-shot), a repel (hospitalized, pool untouched), THE CONQUEST (routing claims the family as a vassal → bounded family:tribute to the treasury, gang-treasuries reconciled, the conquest board), the gates (level/own_family/cooldown/bad_target), the leaderboard, THE FAMILY WAR (formal: the rank gate, the gang:war war-chest sink with NO season_wars, one campaign per family, the board decoration, scoring WIN_SCORE raids to WIN a status trophy for the declarer, the war-chief leaderboard, the worker lapse of an expired campaign, and the gang-treasuries reconcile), THE OFFENSIVE (step four: an NPC family opens hostilities on a real player family unprompted → members notified + a peace/cooldown window + the board surfaces who to hit back, not piled on by a second, a due strike enqueues a shield-honouring family_aggro hit — a safe-housed mark is a clean miss, an unshielded one is hospitalized — §10.4-NEUTRAL (zero ledger rows), counterplay: routing the outfit ends its aggression, and an expired hostility lapses), NPC-FAMILY DIPLOMACY (sue an NPC family for peace → the worker signs it, signing ENDS its live OFFENSIVE, the board shows the peace, the raid is blocked by the pact, NPC↔NPC alliances form + surface on the board, the picker keeps the OFFENSIVE off a pacted pair and reopens once the peace is gone — all §10.4-neutral), ALLIES JOIN THE OFFENSIVE (the aggressor\'s NPC ally sends guns at the same target — both strike a member — the board names the joiner, and suing that ally for peace keeps it out), and §10.4 (family: vocabulary closed)');
await app.close();

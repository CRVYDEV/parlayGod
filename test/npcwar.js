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
import { sweepFamilyAggro, sweepNpcWars } from '../src/npcwar.js';

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

// ── §10.4: the vocabulary knows family:raid (cash faucet + ammo sink) ──
const vocab = (await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `family:raid rides the 'family' prefix (${JSON.stringify(vocab.unknown || [])})`);

console.log('✅ THE BLOOD WAR test passed — the board (strength/defense/loot, player family excluded), a landed raid (bounded family:raid loot + legend + pool drain + ammo sink + cooldown), THE SEVERANCE (no season_wars → no Commission seat), the interlock (a beaten family reads weaker), THE DEFENCE (a counter hospitalizes the raider), THE MANHUNT (an escaped raider is hunted down later, shield-honouring, one-shot), a repel (hospitalized, pool untouched), THE CONQUEST (routing claims the family as a vassal → bounded family:tribute to the treasury, gang-treasuries reconciled, the conquest board), the gates (level/own_family/cooldown/bad_target), the leaderboard, THE FAMILY WAR (formal: the rank gate, the gang:war war-chest sink with NO season_wars, one campaign per family, the board decoration, scoring WIN_SCORE raids to WIN a status trophy for the declarer, the war-chief leaderboard, the worker lapse of an expired campaign, and the gang-treasuries reconcile), and §10.4 (family: vocabulary closed)');
await app.close();

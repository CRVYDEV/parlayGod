// M3 social smoke test: gangs, tribute, weekly contracts, turf (+perks), melt tithe,
// jumps (+war score), bounties, armory, hit contract → death/estate, busting,
// exchange, notifications, websocket push, buyback family split — plus §10.4
// invariants (earn-only cash ledger, car conservation across death).
// Runs on pg-mem — zero infra. Production timers shrunk via env (§9 note in social.js).
process.env.SEARCH_MS = '0';
process.env.SHOOT_CD_MS = '1000';

import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runBuyback } from '../src/worker.js';
import { huntWanted } from '../src/social.js';
import { familyTaskOf, weekOf, M3, BLACK_MARKET, bustProbOf, TERRITORY_RACKETS, territoryRankOf, territoryBuildCost } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (token) => (await call('GET', '/v1/me', { token })).body.character;
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);

// ── three players: Don (gang A boss), Rocco (gang B boss, the victim), Mook (clean books) ──
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  return { token, id: (await meOf(token)).id };
};
const don = await mk('Don Fabrizio');
const rocco = await mk('Rocco Two-Knives');
const mook = await mk('Mook');
// Don: high-level bruiser with a bankroll. Rocco: level 11 target. Mook: NEVER cash-seeded (§10.4 check).
await seedCh(don.id, "respect=10000, cash=200000, muscle=500, speed=500, energy=200, ammo=3000, cb=20, loc='docks'");
await seedCh(rocco.id, "respect=400, cash=40000, muscle=1, speed=1, loc='docks'");
await seedCh(mook.id, "cb=5, loc='docks'");

// ── gangs (§5.5): found, validate, join, promote ──
assert.equal((await call('POST', '/v1/gangs', { token: don.token, body: { name: 'X', tag: 'DON' } })).code, 400, 'short name rejected');
let r = await call('POST', '/v1/gangs', { token: don.token, body: { name: 'The Fabrizi', tag: 'DON' } });
assert.equal(r.code, 200, 'gang founded');
const gangA = r.body.gangId;
assert.equal((await call('POST', '/v1/gangs', { token: don.token, body: { name: 'Encore', tag: 'ENC' } })).code, 400, 'one family per character');
assert.equal((await call('POST', '/v1/gangs', { token: rocco.token, body: { name: 'The Roccos', tag: 'DON' } })).code, 400, 'duplicate tag rejected');
r = await call('POST', '/v1/gangs', { token: rocco.token, body: { name: 'The Roccos', tag: 'RCC' } });
assert.equal(r.code, 200, 'second gang founded');
const gangB = r.body.gangId;
assert.equal((await call('POST', `/v1/gangs/${gangA}/join`, { token: mook.token })).code, 200, 'mook joined');
assert.equal((await call('POST', '/v1/gangs/promote', { token: don.token, body: { characterId: mook.id, role: 'underboss' } })).code, 200, 'promoted');
assert.equal((await call('POST', '/v1/gangs/kick', { token: don.token, body: { characterId: rocco.id } })).code, 400, 'kick non-member rejected');

// ── tribute + weekly contract progress ──
r = await call('POST', '/v1/gangs/tribute', { token: don.token, body: { amount: 100000 } });
assert.equal(r.code, 200, 'tribute paid');
assert.equal((await call('POST', '/v1/gangs/tribute', { token: rocco.token, body: { amount: 5000 } })).code, 200, 'rocco tribute');
let gA = (await call('GET', `/v1/gangs/${gangA}`, {})).body.gang;
assert.equal(gA.treasury, 100000, 'treasury credited');
if (familyTaskOf(weekOf()).key === 'tribute') assert(gA.weekly.progress >= 100000, 'weekly tribute task progressed');

// ── turf (§5.5) + THE OCCUPATION (World step five): LIBERATE the Docks from its NPC garrison (dockrats),
// then buy goods 5% cheaper standing on it. At full outfit strength the cost = dockrats.max × OCCUPY_BPS.
r = await call('POST', `/v1/districts/docks/seize`, { token: don.token });
assert.equal(r.code, 200, 'district liberated'); assert.equal(r.body.liberated, true, 'docks starts NPC-occupied — a liberation');
assert.equal(r.body.garrison, 45000, 'liberation cost at full outfit strength = 150000 × OCCUPY_BPS/10000');
assert.equal((await call('POST', `/v1/districts/docks/seize`, { token: don.token })).code, 400, 'already held');
const board = (await call('GET', '/v1/market/prices', {})).body;
r = await call('POST', '/v1/goods/buy', { token: don.token, body: { goodId: 'gin', qty: 1 } });
assert.equal(r.code, 200, 'goods bought on own turf');
assert.equal(r.body.unit, Math.round(board.goods.docks.gin * 0.95), 'turf discount −5% applied');
const districts = (await call('GET', '/v1/districts', {})).body.districts;
assert.equal(districts.find((d) => d.id === 'docks').holder.tag, 'DON', 'holder listed');

// ── THE OCCUPATION (World step five) — the raid loop cheapens core turf ──
// canal is garrisoned by the Kryl Syndicate (max 1.5M): at full strength it costs 1.5M × OCCUPY_BPS/10000 = $450k
let dboard = (await call('GET', '/v1/districts', {})).body.districts;
const canal0 = dboard.find((d) => d.id === 'canal');
assert(canal0.occupiedBy && canal0.occupiedBy.npc === 'kryl', 'canal is occupied by the Kryl Syndicate');
assert.equal(canal0.liberationCost, 450000, 'at full outfit strength the liberation cost is the full garrison');
assert(dboard.find((d) => d.id === 'cathedral' && !d.occupiedBy), 'cathedral is the free fallback district');
// beat the outfit down (seed its reservoir near the floor) → its district goes cheap (the interlock)
await pool.query(`DELETE FROM world_npcs WHERE npc_id='kryl'`);
await pool.query(`INSERT INTO world_npcs (npc_id, strength, strength_at) VALUES ('kryl', 30000, now())`); // ~2% of max
assert.equal((await call('GET', '/v1/districts', {})).body.districts.find((d) => d.id === 'canal').liberationCost, 30000,
  'a beaten-down outfit’s turf floors at OCCUPY_MIN — the World raid loop is the path to core turf');
// E2 (audit): a rookie boss can't free-ride the rout to liberate an APEX core district. Rocco is level 11;
// canal is the Kryl Syndicate's turf (minLvl 20) — even beaten-down it's off-limits until he can raid kryl himself.
assert.equal((await call('POST', '/v1/districts/canal/seize', { token: rocco.token })).code, 400,
  'occupied apex district needs the outfit’s raid level — no cheap free-ride');
// now the family liberates canal cheaply from the treasury (a §10.4 turf:seize sink; the perk was dormant, now theirs)
const treasBefore = (await call('GET', `/v1/gangs/${gangA}`, {})).body.gang.treasury;
r = await call('POST', '/v1/districts/canal/seize', { token: don.token });
assert.equal(r.code, 200, 'canal liberated'); assert.equal(r.body.liberated, true); assert.equal(r.body.cost, 30000, 'paid the floored cost');
assert.equal((await call('GET', `/v1/gangs/${gangA}`, {})).body.gang.treasury, treasBefore - 30000, 'the treasury paid the liberation');
const canalNow = (await call('GET', '/v1/districts', {})).body.districts.find((d) => d.id === 'canal');
assert.equal(canalNow.occupiedBy, undefined, 'canal is no longer NPC-occupied');
assert.equal(canalNow.holder.tag, 'DON', 'the Fabrizi hold it now (the +10% crime-payout perk is live)');

// E1 (audit): the schema occupation seed is idempotent against a liberated-then-dissolved district.
// canal is now DON-held with seized_at set. Simulate the family dissolving (holder_gang→NULL, garrison→0,
// seized_at stays set), then re-run the EXACT schema seed UPDATE — the seized_at guard blocks re-occupation.
await pool.query(`UPDATE districts SET holder_gang=NULL, garrison=0 WHERE id='canal'`);
await pool.query(`UPDATE districts SET npc_holder='kryl' WHERE id='canal' AND holder_gang IS NULL AND npc_holder IS NULL AND garrison=0 AND seized_at IS NULL`);
assert.equal((await pool.query(`SELECT npc_holder FROM districts WHERE id='canal'`)).rows[0].npc_holder, null,
  'a once-liberated district (seized_at set) never re-occupies on a schema re-run');
await pool.query(`UPDATE districts SET holder_gang='${gangA}', garrison=30000 WHERE id='canal'`); // restore for downstream

// ── melt tithe (§7.5): 25% of rounds to the family armory, $30/round to treasury ──
let car = null;
for (let i = 0; i < 100 && !car; i++) {
  await seedCh(don.id, "gta_at=NULL, energy=200, jail_until=NULL");
  const b = await call('POST', '/v1/garage/boost', { token: don.token });
  if (b.body.success) car = b.body.car;
}
assert(car, 'boosted a car');
const treasuryBefore = (await call('GET', `/v1/gangs/${gangA}`, {})).body.gang.treasury;
r = await call('POST', `/v1/garage/${car.id}/melt`, { token: don.token });
assert.equal(r.code, 200, 'melted');
assert(r.body.tithe >= 1, 'tithe taken');
gA = (await call('GET', `/v1/gangs/${gangA}`, {})).body.gang;
assert.equal(gA.ammoBank, r.body.tithe, 'tithe rounds in the armory');
assert.equal(gA.treasury, treasuryBefore + r.body.tithe * 30, 'treasury credited $30/round');

// ── exchange (§5.4): Mook escrows crates, Don buys the lot ──
assert.equal((await call('POST', '/v1/exchange/list', { token: mook.token, body: { kind: 'product', qty: 1, unitPrice: 1 } })).code, 400, 'product rejected');
r = await call('POST', '/v1/exchange/list', { token: mook.token, body: { kind: 'cb', qty: 5, unitPrice: 200 } });
assert.equal(r.code, 200, 'listed'); assert.equal(r.body.character.cb, 0, 'crates escrowed');
const listing = r.body.listingId;
assert((await call('GET', '/v1/exchange', {})).body.listings.some((l) => l.id === listing), 'on the board');
const donCbBefore = (await meOf(don.token)).cb;
r = await call('POST', `/v1/exchange/${listing}/buy`, { token: don.token });
assert.equal(r.code, 200, 'lot bought');
assert.equal(r.body.character.cb, donCbBefore + 5, 'crates delivered');
assert.equal((await meOf(mook.token)).cash, 500 + 980, 'seller paid minus 2% take');

// ── jump #1 (§7.6): Don flattens Rocco ──
assert.equal((await call(`POST`, `/v1/streets/${don.id}/jump`, { token: don.token })).code, 400, 'self-jump rejected');
assert.equal((await call(`POST`, `/v1/streets/${mook.id}/jump`, { token: don.token })).code, 400, 'same-family jump rejected');
const roccoCashBefore = (await meOf(rocco.token)).cash;
r = await call('POST', `/v1/streets/${rocco.id}/jump`, { token: don.token });
assert.equal(r.code, 200, 'jump resolved'); assert(r.body.win, 'the bruiser wins');
assert(r.body.stolen > 0 && r.body.stolen <= 25000, 'pocket cash stolen within cap');
let roccoMe = await meOf(rocco.token);
assert.equal(roccoMe.cash, roccoCashBefore - r.body.stolen, 'victim pocket emptied by exactly the steal');
assert(roccoMe.hospSeconds > 0, 'victim hospitalized');
assert.equal((await call('POST', `/v1/streets/${rocco.id}/jump`, { token: don.token })).code, 400, 'hospitalized target protected');
const roccoNotes = (await call('GET', '/v1/notifications', { token: rocco.token })).body.notifications;
assert(roccoNotes.some((n) => n.type === 'attack'), 'victim notified');

// ── bounty (§5.2): Mook posts a HOSPITALIZE contract on Rocco; Don collects on the next jump ──
r = await call('POST', `/v1/streets/${rocco.id}/bounty`, { token: mook.token, body: { amount: 1000, kind: 'hospitalize' } });
assert.equal(r.code, 200, 'hospitalize contract posted');
await seedCh(rocco.id, 'hosp_until=NULL');
await seedCh(don.id, 'energy=200');
r = await call('POST', `/v1/streets/${rocco.id}/jump`, { token: don.token });
assert(r.body.win && r.body.bounty === 1000, 'hospitalize contract paid to the hospitalizer');
assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM bounties')).rows[0].n), 0, 'contract cleared');

// ── the contract board (M7 Phase 1): kill contracts, the board, cancel/refund ──
// A paying client (Vito, not in the §10.4 Mook check) posts a KILL contract on Rocco — a jump
// must NOT collect it (only a completed hit will); Don (not a funder) collects it on the kill.
const vito = await mk('Vito the Client');
await seedCh(vito.id, 'cash=100000');
r = await call('POST', `/v1/streets/${rocco.id}/bounty`, { token: vito.token, body: { amount: 5000, kind: 'kill', reason: 'He talked to the wrong people.' } });
assert.equal(r.code, 200, 'kill contract posted'); assert.equal(r.body.kind, 'kill');
await seedCh(rocco.id, 'hosp_until=NULL'); await seedCh(don.id, 'energy=200');
r = await call('POST', `/v1/streets/${rocco.id}/jump`, { token: don.token });
assert.equal(r.body.bounty, 0, 'a jump does NOT collect a kill contract');
// the board surfaces it (reason, poster, expiry), richest first
const openContracts = (await call('GET', '/v1/contracts', { token: don.token })).body.contracts;
const kc = openContracts.find((c) => c.target.id === rocco.id && c.kind === 'kill');
assert(kc && kc.pot === 5000, 'kill contract on the board');
assert.equal(kc.reason, 'He talked to the wrong people.', 'board shows the reason');
assert(kc.poster && kc.expiresInSeconds > 0, 'board shows poster + time remaining');
// cancel/refund: Vito posts a hospitalize contract then withdraws his own stake (2% take kept)
r = await call('POST', `/v1/streets/${rocco.id}/bounty`, { token: vito.token, body: { amount: 800, kind: 'hospitalize' } });
assert.equal(r.code, 200, 'hospitalize contract posted for cancel test');
const vitoPre = (await meOf(vito.token)).cash;
r = await call('POST', `/v1/contracts/${rocco.id}/hospitalize/cancel`, { token: vito.token });
assert.equal(r.code, 200, 'contract cancelled'); assert.equal(r.body.refunded, 800, 'own stake refunded');
assert.equal((await meOf(vito.token)).cash, vitoPre + 800, 'refund returned to the funder');
assert.equal((await call('POST', `/v1/contracts/${rocco.id}/hospitalize/cancel`, { token: vito.token })).code, 400, 'nothing left to cancel');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM bounties WHERE target_character='${rocco.id}' AND kind='hospitalize'`)).rows[0].n), 0, 'empty pot removed');

// ── red-team M1: reposting onto an expired-but-unswept pot refunds the old funder + posts fresh (no 500) ──
const snitch = await mk('Snitch Sammy');
assert.equal((await call('POST', `/v1/streets/${snitch.id}/bounty`, { token: vito.token, body: { amount: 1000, kind: 'kill' } })).code, 200, 'first contract on snitch');
await pool.query(`UPDATE bounties SET expires_at = now() - interval '1 hour' WHERE target_character='${snitch.id}' AND kind='kill'`);
const vitoBefore = (await meOf(vito.token)).cash;
r = await call('POST', `/v1/streets/${snitch.id}/bounty`, { token: vito.token, body: { amount: 2000, kind: 'kill' } });
assert.equal(r.code, 200, 'repost onto a lapsed pot succeeds (no PK 500)');
assert.equal(r.body.total, 2000, 'fresh pot, not a top-up of the lapsed one');
assert.equal((await meOf(vito.token)).cash, vitoBefore + 1000 - 2040, 'lapsed $1000 refunded, then $2040 charged for the fresh contract');
assert.equal(Number((await pool.query(`SELECT amount FROM bounties WHERE target_character='${snitch.id}' AND kind='kill'`)).rows[0].amount), 2000, 'pot holds only the fresh amount');

// ── red-team M2: a DEAD funder's stake is BURNED on expiry (death:bounty), not paid to their corpse ──
const ghost = await mk('Ghost Funder'); await seedCh(ghost.id, 'cash=5000');
const markd = await mk('Marked Man');
assert.equal((await call('POST', `/v1/streets/${markd.id}/bounty`, { token: ghost.token, body: { amount: 1500, kind: 'kill' } })).code, 200, 'ghost funds a contract');
const ghostCash = (await meOf(ghost.token)).cash;
await pool.query(`UPDATE characters SET alive=false WHERE id='${ghost.id}'`); // ghost dies, stake still escrowed on markd
await pool.query(`UPDATE bounties SET expires_at = now() - interval '1 hour' WHERE target_character='${markd.id}'`);
const { sweepExpiredBounties } = await import('../src/social.js');
const sw = await sweepExpiredBounties(pool);
assert(sw.pots >= 1, 'expired pot swept');
assert.equal(Number((await pool.query(`SELECT cash FROM characters WHERE id='${ghost.id}'`)).rows[0].cash), ghostCash, 'no refund credited to the dead funder');
assert.equal(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='death:bounty' AND counterparty='${markd.id}'`)).rows[0].s), -1500, 'dead stake burned as death:bounty');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM bounties WHERE target_character='${markd.id}'`)).rows[0].n), 0, 'pot cleared after the sweep');

// ── war (§5.5): declare, score via jumps, resolve with spoils ──
r = await call('POST', `/v1/gangs/war/${gangB}`, { token: don.token });
assert.equal(r.code, 200, 'war declared');
assert.equal((await call('POST', `/v1/gangs/war/${gangB}`, { token: don.token })).code, 400, 'no double war');
await seedCh(rocco.id, 'hosp_until=NULL');
await seedCh(don.id, 'energy=200');
r = await call('POST', `/v1/streets/${rocco.id}/jump`, { token: don.token });
assert(r.body.win && r.body.war, 'war hit');
gA = (await call('GET', `/v1/gangs/${gangA}`, {})).body.gang;
assert.equal(gA.war.us, 1, 'war score on the board');
const bTreasuryPreResolve = (await call('GET', `/v1/gangs/${gangB}`, {})).body.gang.treasury;
await pool.query(`UPDATE gangs SET war_until = now() - interval '1 second' WHERE id IN ('${gangA}','${gangB}')`);
gA = (await call('GET', `/v1/gangs/${gangA}`, {})).body.gang; // lazy resolution on read
assert.equal(gA.war, null, 'war resolved');
assert.equal(gA.warsWon, 1, 'win recorded');
const spoils = Math.floor(bTreasuryPreResolve * 0.2);
assert.equal((await call('GET', `/v1/gangs/${gangB}`, {})).body.gang.treasury, bTreasuryPreResolve - spoils, 'loser paid 20% spoils');

// ── armory (§5.2) ──
r = await call('POST', '/v1/armory/gun/lastresort/buy', { token: don.token });
assert.equal(r.code, 200, 'gun bought'); assert.equal(r.body.character.gun, 'lastresort', 'first iron auto-equipped');
assert.equal((await call('POST', '/v1/armory/gun/lastresort/buy', { token: don.token })).code, 400, 'no duplicate gun');
assert.equal((await call('POST', '/v1/armory/ammo', { token: don.token })).code, 200, 'ammo box bought');
await pool.query(`UPDATE account_persistent SET omr = omr + 5 WHERE account_id = (SELECT account_id FROM characters WHERE id='${don.id}')`);
r = await call('POST', '/v1/armory/vest/woolv', { token: don.token });
assert.equal(r.code, 200, 'vest bought with $OMR'); assert.equal(r.body.character.vest, 'woolv');

// ── hit contract (§7.7) → death & the estate (§7.9) ──
await pool.query(`INSERT INTO cars (id, character_id, model_id, trim_id, dmg) VALUES ('roccocar','${rocco.id}','junker','stock',0)`);
await pool.query(`UPDATE account_persistent SET omr = 7 WHERE account_id = (SELECT account_id FROM characters WHERE id='${rocco.id}')`);
assert.equal((await call('POST', `/v1/streets/${rocco.id}/fire`, { token: don.token, body: { rounds: 2200 } })).code, 400, 'no fire without a search');
assert.equal((await call('POST', `/v1/streets/${rocco.id}/search`, { token: don.token })).code, 200, 'search started');
assert.equal((await call('POST', `/v1/streets/${mook.id}/search`, { token: don.token })).code, 400, 'one active search');
await seedCh(don.id, "energy=200, jail_until=NULL, loc='docks'");
await seedCh(rocco.id, "hosp_until=NULL, loc='docks', health=100");

// ── §11 pre-paid revive insurance: a respawn token absorbs a killing blow (no permadeath) ──
await pool.query(`UPDATE account_persistent SET respawn_tokens = 1 WHERE account_id = (SELECT account_id FROM characters WHERE id='${rocco.id}')`);
// audit MEDIUM: a revive must NOT wipe OTHER hunters' searches — plant a second hunter (mook) on rocco
await pool.query(`INSERT INTO searches (hunter, target, started_at) VALUES ('${mook.id}','${rocco.id}', now() - interval '4 hours')`);
r = await call('POST', `/v1/streets/${rocco.id}/fire`, { token: don.token, body: { rounds: 2200 } }); // uses the search from above
assert.equal(r.code, 200, 'shots fired at an insured target');
assert.equal(r.body.kill, false, 'the killing blow is absorbed — not a kill');
assert.equal(r.body.revived, true, 'target revived via pre-paid insurance');
let survivor = await meOf(rocco.token);
assert.equal(survivor.generation, 1, 'no heir — the same street lives on');
assert.equal(survivor.respawnTokens, 0, 'the respawn token was consumed');
assert.equal(survivor.health, 100, 'revived at full health');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM searches WHERE hunter='${mook.id}' AND target='${rocco.id}'`)).rows[0].n), 1, "other hunters' searches survive the revive (no manhunt reset)");
await pool.query(`DELETE FROM searches WHERE hunter='${mook.id}'`); // clean up the planted search
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM cars WHERE character_id='${rocco.id}'`)).rows[0].n), 1, 'the insured man keeps his fleet');
// the hunt reset — re-search for the real (uninsured) kill below (top up ammo for the 2nd burst)
await seedCh(don.id, "energy=200, ammo=3000, jail_until=NULL, shoot_cd_until=NULL, loc='docks'");
assert.equal((await call('POST', `/v1/streets/${rocco.id}/search`, { token: don.token })).code, 200, 're-search after the revive');

const donCashPreKill = (await meOf(don.token)).cash;
const donOmrPreKill = (await meOf(don.token)).omr;
const roccoCashPreKill = (await meOf(rocco.token)).cash;
r = await call('POST', `/v1/streets/${rocco.id}/fire`, { token: don.token, body: { rounds: 2200 } });
assert.equal(r.code, 200, 'shots fired');
assert(r.body.kill, `level-11 target with 2200 rounds is a kill (eff vs btk: ${JSON.stringify(r.body)})`);
assert.equal(r.body.chop, Math.floor(900 * 0.4), 'chop = 40% of the real fleet value');
assert.equal(r.body.bounty, 5000, "the completed hit collects Mook's open kill contract");
// Risk-to-Earn P1.1 — the killer loots 25% of the victim's POCKET cash and 20% of their LIQUID $OMR
assert.equal(r.body.loot, Math.floor(roccoCashPreKill * 0.25), 'looted 25% of the victim pocket cash');
assert.equal(r.body.omrLoot, Math.floor(7 * 0.20), 'looted 20% of the victim liquid $OMR (floor(7×0.2)=1)');
assert.equal((await meOf(don.token)).omr, donOmrPreKill + 1, 'the looted $OMR landed in the killer\'s account');
assert.equal((await meOf(don.token)).cash, donCashPreKill + r.body.chop + r.body.bounty + r.body.loot, 'chop + bounty + cash loot all paid to the killer');

// estate: heir stands up on the same account; the street died with the man
const heir = await meOf(rocco.token);
assert.equal(heir.generation, 2, 'heir generation');
assert.equal(heir.name, 'Rocco Two-Knives', 'the bloodline keeps the name');
assert.equal(heir.cash, 500 + 100 * 5, 'legacy stake: $500 + $100 × prestige (floor(11/2))');
assert.equal(heir.omr, 6, 'liquid $OMR survives death on the account MINUS the 20% the killer looted (7−1)');
assert.equal(heir.cars.length, 0, 'fleet died');
assert(!heir.gang, 'gang seat vacated');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM cars WHERE character_id='${rocco.id}'`)).rows[0].n), 0, 'victim cars wiped');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM gangs WHERE id='${gangB}'`)).rows[0].n), 0, 'one-man family dissolved with its boss');
const heirNotes = (await call('GET', '/v1/notifications', { token: rocco.token })).body.notifications;
assert(heirNotes.some((n) => n.type === 'estate' && n.payload.legacy === 5), 'estate report delivered to the heir');
const mookNotes = (await call('GET', '/v1/notifications', { token: mook.token })).body.notifications;
// the kill notifies 3 RANDOM living witnesses — assert 3 were delivered globally (robust to which
// ones the RNG picks from the now-larger cast), not that a specific character was chosen
assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM notifications WHERE type='witness'")).rows[0].n), 3, 'three witnesses saw something');
assert(mookNotes.some((n) => n.type === 'sale'), 'exchange sale notified');
assert.equal((await call('GET', '/v1/notifications', { token: mook.token })).body.notifications.length, 0, 'reading marks delivered');

// ── busting (§7.8): spring Mook from county ──
let busted = null;
for (let i = 0; i < 200 && !busted; i++) {
  await seedCh(mook.id, "jail_until = now() + interval '20 seconds'");
  await seedCh(don.id, 'jail_until=NULL');
  const b = await call('POST', `/v1/streets/${mook.id}/bust`, { token: don.token });
  assert.equal(b.code, 200, 'bust resolves');
  if (b.body.success) busted = b.body;
}
assert(busted, 'eventually a clean bust');
assert(busted.reward >= 500, 'bust reward paid');
assert.equal((await meOf(mook.token)).jailSeconds, 0, 'mook walked');
assert.equal((await call('POST', `/v1/streets/${don.id}/bust`, { token: don.token })).code, 400, 'no self-busts');

// ── §10.4 invariants ──
// Mook's cash was NEVER seeded: cash + bank − 500 must equal his ledger exactly
// (sale +980, bounty −1020 — the bust reward went to Don, not Mook).
const mookMe = await meOf(mook.token);
const mookLedger = Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='cash' AND character_id='${mook.id}'`)).rows[0].s);
assert(Math.abs((mookMe.cash + mookMe.bank - 500) - mookLedger) <= 1, `earn-only ledger holds for Mook (drift ${(mookMe.cash + mookMe.bank - 500) - mookLedger})`);
// car conservation with death as a sink: every car in the table belongs to a living character
const orphans = await pool.query('SELECT COUNT(*) n FROM cars c JOIN characters ch ON ch.id = c.character_id WHERE NOT ch.alive');
assert.equal(Number(orphans.rows[0].n), 0, 'no cars owned by the dead');

// ── buyback family split (§7.12): standing = tribute + 10,000/war ──
const bb = await runBuyback(pool, { force: true });
assert(bb && bb.toFamilies > 0, 'families got their half');
gA = (await call('GET', `/v1/gangs/${gangA}`, {})).body.gang;
assert(gA.omrReserve > 0, 'top family reserve funded');

// ── websocket (§5.6): live push on the me-channel ──
await app.listen({ port: 0, host: '127.0.0.1' });
const port = app.server.address().port;
const heirToken = rocco.token; // same account — resolves to the living heir
const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws?token=${encodeURIComponent(heirToken)}`);
const wsMessages = [];
const wsReady = new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error('ws timeout')), 5000);
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    wsMessages.push(msg);
    if (msg.channel === 'me' && msg.type === 'attack') { clearTimeout(to); res(); }
  };
});
await new Promise((res) => { ws.onopen = res; });
await seedCh(don.id, 'energy=200, jail_until=NULL');
r = await call('POST', `/v1/streets/${heir.id}/jump`, { token: don.token });
assert.equal(r.code, 200, 'heir jumped (life is hard)');
await wsReady;
assert(wsMessages.some((m) => m.channel === 'hello'), 'ws handshake');
assert(wsMessages.some((m) => m.channel === 'me' && m.type === 'attack'), 'attack pushed live over the socket');
ws.close();

// ── M7 Phase 2: the assassin's reputation ladder ──
// Don already whacked Rocco (a level-11 mark) above → his first kill: +33 rep (11×3).
let donMe = await meOf(don.token);
const donName = donMe.name;
assert.equal(donMe.kills, 1, 'lifetime kill counted on the account legend');
assert.equal(donMe.seasonKills, 1, "this street's season streak counted");
assert.equal(donMe.hitmanRep, 33, 'feared-rep = vicLvl(11) × 3 on the first kill of a bloodline');
assert.equal(donMe.hitmanTitle, 'Associate', 'rank reflects rep (33 < 50)');

// a controlled kill: search (SEARCH_MS=0) then empty a magazine — btk is easily cleared
const whack = async (tid, rounds = 6000) => {
  await seedCh(don.id, "energy=200, ammo=8000, jail_until=NULL, shoot_cd_until=NULL, hosp_until=NULL, loc='docks'");
  await seedCh(tid, "hosp_until=NULL, jail_until=NULL, loc='docks'");
  await call('POST', `/v1/streets/${tid}/search`, { token: don.token });
  return (await call('POST', `/v1/streets/${tid}/fire`, { token: don.token, body: { rounds } })).body;
};

// anti-farm floor (audit M1): whacking a sub-level-5 rookie counts on NO board — not rep, not
// the kills counter, not the season streak — so the leaderboards can't be farmed with rookies/alts
const rookie = await mk('Rookie Ricky');
let k = await whack(rookie.id);
assert(k.kill, 'rookie whacked'); assert.equal(k.hitman.repGain, 0, 'no rep for a rookie (below the level floor)');
assert.equal(k.hitman.qualified, false, 'a rookie kill does not qualify for the boards');
donMe = await meOf(don.token);
assert.equal(donMe.kills, 1, 'rookie kill does NOT inflate the lifetime kills board');
assert.equal(donMe.seasonKills, 1, 'nor the season streak');
assert.equal(donMe.hitmanRep, 33, 'and rep is unchanged');

// directed contract: Vito names Don as the hitman → exclusive window + a 1.5x rep bonus on the kill
const marked = await mk('Marked Mario'); await seedCh(marked.id, 'respect=400'); // level 11
await seedCh(vito.id, 'cash=200000');
// sim-audit F1: exclusivity takes a real stake — below DIRECTED_MIN the direction is refused
r = await call('POST', `/v1/streets/${marked.id}/bounty`, { token: vito.token, body: { amount: 3000, kind: 'kill', hitman: don.id } });
assert.equal(r.body.error, 'directed_min', 'a cheap pot cannot reserve a mark ($10k floor)');
// LOAN step 2 (the welsher hunt): a WELSHER's broken word waives the directed floor on a KILL pot
// (the rat/vendetta-waiver twin — a status consequence, no money returns to any lender). Hospitalize
// pots never get the waiver (kill-only — a welsher hunt means a body, not a squat).
const deadbeat = await mk('Deadbeat Denny'); await seedCh(deadbeat.id, 'respect=400, welsher=true');
r = await call('POST', `/v1/streets/${deadbeat.id}/bounty`, { token: vito.token, body: { amount: 3000, kind: 'kill', hitman: don.id } });
assert.equal(r.code, 200, 'a welsher is cheap to put a named gun on — the directed floor is waived on a kill pot');
r = await call('POST', `/v1/streets/${deadbeat.id}/bounty`, { token: vito.token, body: { amount: 3000, kind: 'hospitalize', hitman: don.id } });
assert.equal(r.body.error, 'directed_min', 'no waiver on a hospitalize pot — a welsher hunt means a body');
r = await call('POST', `/v1/streets/${marked.id}/bounty`, { token: vito.token, body: { amount: 12000, kind: 'kill', hitman: don.id, reason: 'Make it clean.', exclusiveHours: 999 } });
assert.equal(r.code, 200, 'directed contract posted'); assert.equal(r.body.hitman, don.id, 'named hitman recorded');
const dc = (await call('GET', '/v1/contracts', { token: don.token })).body.contracts.find((c) => c.target.id === marked.id);
assert.equal(dc.directedTo, donName, 'the board shows the named hitman during the exclusive window');
assert(dc.opensInSeconds > 0, 'and when it opens to everyone');
assert(dc.opensInSeconds <= 24 * 3600, 'the exclusive window caps at DIRECTED_MAX_H (24h), not the full TTL');
k = await whack(marked.id);
assert(k.kill && k.bounty === 12000, 'the named hitman collects the directed contract');
assert.equal(k.hitman.repGain, 49, 'directed kill pays the 1.5x bonus: floor(11×3×1.5)');
assert.equal((await meOf(don.token)).hitmanRep, 82, 'rep 33 + 49');

// repeat-bloodline diminishing: whacking Marked's HEIR (same account) pays half — and no bonus
const heir2 = await meOf(marked.token); await seedCh(heir2.id, 'respect=400'); // the heir, level 11
k = await whack(heir2.id);
assert(k.kill, 'the heir is whacked too');
assert.equal(k.hitman.repGain, 16, 'a repeat kill of the same bloodline is diminished: floor(11×3 / 2)');
donMe = await meOf(don.token);
assert.equal(donMe.hitmanRep, 98, 'rep 82 + 16');
assert.equal(donMe.kills, 3, 'three QUALIFYING lifetime kills (Rocco, Marked, heir — rookie excluded)');
assert.equal(donMe.hitmanTitle, 'Button Man', '98 rep → Button Man');

// the feared-assassin leaderboard: the lifetime legend + this season's streak
const lb = (await call('GET', '/v1/leaderboard/hitmen', { token: don.token })).body;
assert(lb.legend.some((e) => e.name === donName && e.rep === 98 && e.title === 'Button Man'), 'Don leads the legend board');
assert(lb.season.some((e) => e.name === donName && e.kills === donMe.seasonKills), 'Don on the season board');

// audit M2: a directed post onto an EXISTING live pot is rejected (direction is the first poster's)
r = await call('POST', `/v1/streets/${don.id}/bounty`, { token: vito.token, body: { amount: 1000, kind: 'kill' } }); // open pot on Don
assert.equal(r.code, 200, 'open contract on Don');
r = await call('POST', `/v1/streets/${don.id}/bounty`, { token: vito.token, body: { amount: 12000, kind: 'kill', hitman: mook.id } });
assert.equal(r.code, 400, 'cannot direct a mark that already has a standing contract');
assert.equal(r.body.error, 'directed_exists', 'clear error, not a silent drop');
await call('POST', `/v1/contracts/${don.id}/kill/cancel`, { token: vito.token }); // clean up

// sim-audit F1 (squat resistance): an OUTSIDER killing the mark inside the exclusive window now
// COLLECTS the kill pot — the mark is dead, the pot pays whoever did the job (the named hitman
// keeps only the rep bonus). A confederate's cheap pot on your own head now FUNDS your enemies.
const wanted = await mk('Wanted Wally'); await seedCh(wanted.id, 'respect=400'); // level 11
await seedCh(vito.id, 'cash=100000');
r = await call('POST', `/v1/streets/${wanted.id}/bounty`, { token: vito.token, body: { amount: 12000, kind: 'kill', hitman: mook.id, exclusiveHours: 24 } });
assert.equal(r.code, 200, 'directed at Mook');
const vitoPreBurn = (await meOf(vito.token)).cash;
k = await whack(wanted.id); // DON (not the named Mook) kills Wally while the window is open
assert(k.kill, 'outsider kills the mark');
assert.equal(k.bounty, 12000, 'the outsider COLLECTS the kill pot (kill trumps courtesy — squatting pays your enemies)');
assert.equal((await meOf(vito.token)).cash, vitoPreBurn, "the poster's stake went to the killer, not back to the poster");
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM bounties WHERE target_character='${wanted.id}'`)).rows[0].n), 0, 'the directed pot is settled');

// audit L1 / anti-abuse: an AGENT tallies kills but earns NO feared-rep and is off BOTH boards
const agent = await mk('Agent Smith');
await pool.query(`UPDATE account_persistent SET agent_flag=true WHERE account_id=(SELECT account_id FROM characters WHERE id='${agent.id}')`);
const donGun = (await pool.query(`SELECT gun FROM characters WHERE id='${don.id}'`)).rows[0].gun;
await seedCh(agent.id, `gun='${donGun}', muscle=500, speed=500, energy=200, ammo=8000, respect=400, loc='docks'`);
const aMark = await mk('Agent Mark'); await seedCh(aMark.id, "respect=400, muscle=1, hosp_until=NULL, loc='docks'"); // level 11
await call('POST', `/v1/streets/${aMark.id}/search`, { token: agent.token });
k = (await call('POST', `/v1/streets/${aMark.id}/fire`, { token: agent.token, body: { rounds: 6000 } })).body;
assert(k.kill, 'agent whacks a qualifying mark'); assert.equal(k.hitman.repGain, 0, 'an agent earns NO feared-rep');
const aAcct = (await pool.query(`SELECT hitman_rep, kills FROM account_persistent WHERE account_id=(SELECT account_id FROM characters WHERE id='${agent.id}')`)).rows[0];
assert.equal(Number(aAcct.kills), 1, 'but the agent tallies the kill for its own stats');
assert.equal(Number(aAcct.hitman_rep), 0, 'zero rep on the account');
const lb2 = (await call('GET', '/v1/leaderboard/hitmen', { token: don.token })).body;
assert(!lb2.legend.some((e) => e.name === 'Agent Smith') && !lb2.season.some((e) => e.name === 'Agent Smith'), 'agent absent from both boards');

// ── M7 Phase 3: NPC hitmen for hire (paid, rolled, rep-less §10.4 cash sink) ──
const hirer = await mk('Hiram the Hirer'); await seedCh(hirer.id, 'cash=5000000');
// a high-level mark for the hire/cooldown checks — near-impossible to actually drop, so it
// survives to test the deterministic parts (fee burn, heat, cooldown)
const tough = await mk('Tough Tony'); await seedCh(tough.id, 'respect=10000'); // ~level 51 → legbreaker clamps to the 2% floor
assert.equal((await call('POST', `/v1/streets/${tough.id}/npchit`, { token: hirer.token, body: { tier: 'nope' } })).code, 400, 'bad tier rejected');
const hirerPre = (await meOf(hirer.token)).cash;
r = await call('POST', `/v1/streets/${tough.id}/npchit`, { token: hirer.token, body: { tier: 'legbreaker' } });
assert.equal(r.code, 200, 'contractor hired');
assert.equal((await meOf(hirer.token)).cash, hirerPre - 50000, 'the fee burns win or lose (a §10.4 sink)');
assert((await meOf(hirer.token)).heat >= 20, 'arranging a hit draws law heat (~25, minus a hair of decay on read)');
assert.equal((await call('POST', `/v1/streets/${tough.id}/npchit`, { token: hirer.token, body: { tier: 'legbreaker' } })).code, 400, 'contractor cooldown between jobs');
// a rookie target is off-limits
const rook2 = await mk('Nobody Nick');
assert.equal((await call('POST', `/v1/streets/${rook2.id}/npchit`, { token: hirer.token, body: { tier: 'professional' } })).code, 400, 'no sanctioned hits on nobodies (level floor)');

// ═══ AUDIT-full-system-v2 C-HIGH-1 / C-MED-1: a jailed inmate is unreachable from the STREET ═══
// (the shank — which requires the killer be jailed too — is the in-cell path; without this, jail was
// strictly MORE lethal than freedom, since a jailed player can't enter a safehouse)
{
  const inmate = await mk('Jailbird Joe');
  await seedCh(inmate.id, "respect=100, hosp_until=NULL, loc='docks', jail_until = now() + interval '1 hour'");
  await seedCh(don.id, "energy=200, ammo=8000, jail_until=NULL, shoot_cd_until=NULL, hosp_until=NULL, loc='docks'");
  await call('POST', `/v1/streets/${inmate.id}/search`, { token: don.token });
  assert.equal((await call('POST', `/v1/streets/${inmate.id}/fire`, { token: don.token, body: { rounds: 8000 } })).body.error, 'jailed', 'no firing a jailed inmate from the street (C-HIGH-1)');
  await seedCh(hirer.id, 'cash=5000000, npchit_at=NULL'); await pool.query('DELETE FROM npc_hits');
  assert.equal((await call('POST', `/v1/streets/${inmate.id}/npchit`, { token: hirer.token, body: { tier: 'professional' } })).body.error, 'jailed', 'no contractor reaches a jailed inmate (C-MED-1)');
  // a pen-PROTECTED inmate (also jailed) reports the shield first (penSafe checked before bare jail)
  await seedCh(inmate.id, "pen_safe_until = now() + interval '1 hour'");
  assert.equal((await call('POST', `/v1/streets/${inmate.id}/fire`, { token: don.token, body: { rounds: 8000 } })).body.error, 'protected', 'a pen-protected inmate reports the shield (fire)');
  await pool.query(`DELETE FROM searches WHERE hunter='${don.id}'`); // clear don's lingering search (it never resolved)
}

// a fresh, killable mark: loop the server roll until the contractor lands a kill → the estate runs
const kt = await mk('Killable Kelly'); await seedCh(kt.id, 'respect=100'); // level ~6 → professional ≈ 0.52
let killed = false;
for (let i = 0; i < 80 && !killed; i++) {
  await seedCh(hirer.id, 'cash=5000000, npchit_at=NULL'); await pool.query('DELETE FROM npc_hits');
  await seedCh(kt.id, "hosp_until=NULL, respect=100");
  const res = (await call('POST', `/v1/streets/${kt.id}/npchit`, { token: hirer.token, body: { tier: 'professional' } })).body;
  killed = !!res.killed;
}
assert(killed, 'the contractor eventually lands the kill');
assert.equal((await meOf(kt.token)).generation, 2, 'the NPC kill runs the estate — heir stands up');
assert.equal((await meOf(hirer.token)).hitmanRep, 0, 'NPC hits earn the payer NO feared-rep');
assert.equal((await meOf(hirer.token)).kills, 0, 'nor any kills on the legend');

// pre-paid revive insurance absorbs an NPC hit too (the target paid ETH to survive)
const insured = await mk('Insured Izzy'); await seedCh(insured.id, 'respect=100');
await pool.query(`UPDATE account_persistent SET respawn_tokens=1 WHERE account_id=(SELECT account_id FROM characters WHERE id='${insured.id}')`);
let absorbed = false;
for (let i = 0; i < 60 && !absorbed; i++) {
  await seedCh(hirer.id, 'cash=5000000, npchit_at=NULL'); await pool.query('DELETE FROM npc_hits');
  await seedCh(insured.id, 'hosp_until=NULL');
  const res = (await call('POST', `/v1/streets/${insured.id}/npchit`, { token: hirer.token, body: { tier: 'professional' } })).body;
  assert(!res.killed, 'an insured target is never killed by an NPC hit');
  absorbed = !!res.revived;
}
assert(absorbed, 'the respawn token absorbs a landed NPC hit');
assert.equal((await meOf(insured.token)).generation, 1, 'the insured target lives on (no heir)');
assert.equal((await meOf(insured.token)).respawnTokens, 0, 'the token was consumed');

// audit HIGH: a payer who funded an EXCLUSIVE directed pot on the victim is REFUNDED on the NPC
// kill — else refundPot's SQL credit is clobbered by persistCharacter (§10.4 drift + stolen escrow)
const rival = await mk('Rival Rick'); await seedCh(rival.id, 'respect=100'); // level ~6
await seedCh(hirer.id, 'cash=200000000, npchit_at=NULL'); await pool.query('DELETE FROM npc_hits');
assert.equal((await call('POST', `/v1/streets/${rival.id}/bounty`, { token: hirer.token, body: { amount: 12000, kind: 'kill', hitman: mook.id, exclusiveHours: 24 } })).code, 200, 'hirer funds a directed contract on the rival');
let refundOk = false;
for (let i = 0; i < 40 && !refundOk; i++) {
  await seedCh(hirer.id, 'npchit_at=NULL'); await pool.query('DELETE FROM npc_hits'); // let cash ride (do NOT re-seed) so the kill-shot delta is measurable
  await seedCh(rival.id, 'hosp_until=NULL');
  const before = (await meOf(hirer.token)).cash;
  const res = (await call('POST', `/v1/streets/${rival.id}/npchit`, { token: hirer.token, body: { tier: 'professional' } })).body;
  if (res.killed) {
    // res.cost, not a hard $1M: hiram's looped hits earned him Vinnie-the-Match standing (the
    // Underworld T1 discount) — the invariant under test is fee-burn + refund, not the sticker
    assert.equal((await meOf(hirer.token)).cash, before - res.cost + 12000, 'the fee burned AND the $12000 exclusive escrow refunded (no clobber)');
    refundOk = true;
  }
}
assert(refundOk, 'the NPC landed the kill and the payer-funded escrow was verifiably refunded');

// ── M7 Phase 4: earnable defense (safehouse) + interlocks (fire-heat, war-kill scoring) ──
// safehouse: pay cash to go to ground → untargetable by fire AND NPC-hit for a window
const dave = await mk('Ducking Dave'); await seedCh(dave.id, 'respect=100, cash=100000');
const daveCash = (await meOf(dave.token)).cash;
r = await call('POST', '/v1/safehouse', { token: dave.token });
assert.equal(r.code, 200, 'went to ground in a safehouse');
assert.equal((await meOf(dave.token)).cash, daveCash - 25000, 'safehouse fee burned (a §10.4 sink)');
assert((await meOf(dave.token)).safeSeconds > 0, 'off the grid for a window');
await seedCh(don.id, "energy=200, ammo=8000, shoot_cd_until=NULL, jail_until=NULL, loc='docks'");
await seedCh(dave.id, "loc='docks'"); // same district — but he's in the safehouse
await call('POST', `/v1/streets/${dave.id}/search`, { token: don.token });
const blocked = await call('POST', `/v1/streets/${dave.id}/fire`, { token: don.token, body: { rounds: 6000 } });
assert.equal(blocked.code, 400, 'a fire on a safe-housed target is blocked'); assert.equal(blocked.body.error, 'safe', 'because they went to ground');
await seedCh(hirer.id, 'cash=5000000, npchit_at=NULL'); await pool.query('DELETE FROM npc_hits');
const npcBlocked = await call('POST', `/v1/streets/${dave.id}/npchit`, { token: hirer.token, body: { tier: 'professional' } });
assert.equal(npcBlocked.code, 400, 'an NPC hit on a safe-housed target is blocked'); assert.equal(npcBlocked.body.error, 'safe', 'the contractor can\'t find them');
// Risk-to-Earn P1.3 — SHIELD, NOT BUNKER: while safe, DAVE himself can't do offense or extraction.
await seedCh(dave.id, "energy=200, ammo=8000, health=100, loc='docks'"); // still safe_until in the future
await call('POST', `/v1/streets/${don.id}/search`, { token: dave.token }); // (search itself isn't gated; firing is)
assert.equal((await call('POST', `/v1/streets/${don.id}/fire`, { token: dave.token, body: { rounds: 6000 } })).body.error, 'safe', "a safe-housed player can't fire (shield, not bunker)");
assert.equal((await call('POST', `/v1/streets/${don.id}/jump`, { token: dave.token })).body.error, 'safe', "a safe-housed player can't jump");
assert.equal((await call('POST', '/v1/swap', { token: dave.token, body: { direction: 'buy', amount: 1000 } })).body.error, 'safe', "a safe-housed player can't launder/extract");
// once the safehouse lapses, they're fair game — and the hit draws law HEAT on the shooter
await seedCh(dave.id, "safe_until = now() - interval '1 minute', loc='docks'");
await seedCh(don.id, "energy=200, ammo=8000, shoot_cd_until=NULL, heat=0, loc='docks'");
const donHeat0 = (await meOf(don.token)).heat;
const lapsed = await call('POST', `/v1/streets/${dave.id}/fire`, { token: don.token, body: { rounds: 6000 } }); // search persists from above
assert.equal(lapsed.code, 200, 'a lapsed safehouse offers no protection');
assert((await meOf(don.token)).heat >= donHeat0 + 15, 'the hit drew law heat on the shooter (~20)');

// war-kill scoring: a kill on a family you're at war with scores war points (not just jumps)
const enemy = await mk('Enemy Eddie'); await seedCh(enemy.id, 'respect=400, cash=50000'); // level 11
const egId = (await call('POST', '/v1/gangs', { token: enemy.token, body: { name: 'The Rivals', tag: 'RIV' } })).body.gangId;
assert(egId, 'enemy founded a rival family');
await pool.query(`UPDATE gangs SET war_with='${egId}', war_until=now()+interval '1 hour', war_score_us=0 WHERE id='${gangA}'`);
await pool.query(`UPDATE gangs SET war_with='${gangA}', war_until=now()+interval '1 hour', war_score_them=0 WHERE id='${egId}'`);
const kr = await whack(enemy.id); // Don (gangA) whacks the enemy boss mid-war
assert(kr.kill && kr.warKill === true, 'a kill on a warring family is a war kill');
assert.equal(Number((await pool.query(`SELECT war_score_us FROM gangs WHERE id='${gangA}'`)).rows[0].war_score_us), 3, 'a war kill scores WAR_KILL_POINTS (3), worth more than a jump');

// ── M7 Phase 4 remainder: FAMILY CONTRACTS — the treasury orders the hit ──
const carl = await mk('Contract Carl'); await seedCh(carl.id, "respect=400, muscle=1, speed=1, loc='docks'");
const sal = await mk('Soldier Sal'); // a PLAIN soldier (mook is the underboss, who legitimately can)
assert.equal((await call('POST', `/v1/gangs/${gangA}/join`, { token: sal.token })).code, 200, 'sal made his bones');
assert.equal((await call('POST', `/v1/gangs/contract/${carl.id}`, { token: sal.token, body: { amount: 10000 } })).body.error, 'rank', 'a soldier cannot spend family money');
await seedCh(don.id, 'cash=500000');
assert.equal((await call('POST', '/v1/gangs/tribute', { token: don.token, body: { amount: 100000 } })).code, 200, 'the family war chest is funded');
let tre = (await call('GET', `/v1/gangs/${gangA}`, {})).body.gang.treasury;
r = await call('POST', `/v1/gangs/contract/${carl.id}`, { token: don.token, body: { amount: 10000, kind: 'kill', reason: 'He knows what he did.' } });
assert.equal(r.code, 200, 'the boss posted a family contract');
assert.equal(r.body.treasury, tre - 10200, 'the TREASURY paid the pot + the 2% take (no character cash moved)');
const famRow = (await call('GET', '/v1/contracts', { token: mook.token })).body.contracts.find((c) => c.target.id === carl.id && c.kind === 'kill');
assert(famRow && famRow.family === true && famRow.poster === 'The Fabrizi' && famRow.pot === 10000, 'the board names the FAMILY as the poster');
// the funder lockout extends to the whole family: even the boss collects nothing on his own order
const kCarl = await whack(carl.id);
assert(kCarl.kill, 'the mark went down');
assert.equal(kCarl.bounty, 0, "no member of the funding family collects the family's own money");
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM bounties WHERE target_character='${carl.id}'`)).rows[0].n), 0, 'the unclaimed pot died with the mark (burned, ledgered death:bounty)');
// cancel → the pot goes home to the treasury (the 2% take is spent)
const carla = await mk('Contract Carla'); await seedCh(carla.id, "respect=400, muscle=1, speed=1, loc='docks'");
tre = (await call('GET', `/v1/gangs/${gangA}`, {})).body.gang.treasury;
assert.equal((await call('POST', `/v1/gangs/contract/${carla.id}`, { token: don.token, body: { amount: 5000 } })).code, 200, 'second family contract posted');
r = await call('POST', `/v1/gangs/contract/${carla.id}/kill/cancel`, { token: don.token });
assert.equal(r.code, 200, 'the boss called it off'); assert.equal(r.body.refunded, 5000, 'the full pot came back');
assert.equal((await call('GET', `/v1/gangs/${gangA}`, {})).body.gang.treasury, tre - 100, 'treasury made whole minus the 2% take');
// expiry → the sweep refunds the treasury like any other funder
tre = (await call('GET', `/v1/gangs/${gangA}`, {})).body.gang.treasury;
assert.equal((await call('POST', `/v1/gangs/contract/${carla.id}`, { token: don.token, body: { amount: 4000 } })).code, 200, 'third family contract posted');
await pool.query(`UPDATE bounties SET expires_at = now() - interval '1 minute' WHERE target_character='${carla.id}'`);
await sweepExpiredBounties(pool);
assert.equal((await call('GET', `/v1/gangs/${gangA}`, {})).body.gang.treasury, tre - 4080 + 4000, 'the expired pot refunded the treasury via the sweep');
// an OUTSIDER collects: a freelancer fulfils the family's hospitalize contract with a jump
const frank = await mk('Freelance Frank'); await seedCh(frank.id, "muscle=800, speed=800, energy=200, loc='docks'");
assert.equal((await call('POST', `/v1/gangs/contract/${carla.id}`, { token: don.token, body: { amount: 3000, kind: 'hospitalize' } })).code, 200, 'family hospitalize contract posted');
await seedCh(carla.id, "hosp_until=NULL, loc='docks', cash=1000");
const jr = (await call('POST', `/v1/streets/${carla.id}/jump`, { token: frank.token })).body;
assert(jr.win, 'the freelancer took the job');
assert.equal(jr.bounty, 3000, 'an outsider collects the family contract in full');

// ── M7 Phase 4 remainder: BODYGUARDS — the player-to-player defense market ──
const barry = await mk('Bullet Barry'); const paula = await mk('Principal Paula');
assert.equal((await call('POST', '/v1/bodyguard/offer', { token: barry.token, body: { price: 400 } })).body.error, 'min', 'nobody eats a bullet for pocket change');
assert.equal((await call('POST', '/v1/bodyguard/offer', { token: barry.token, body: { price: 'Infinity' } })).body.error, 'price', 'a non-finite price is refused (no NUMERIC-write 500)'); // audit: Number("Infinity")===Infinity
assert.equal((await call('POST', `/v1/bodyguard/hire/${barry.id}`, { token: paula.token })).body.error, 'not_offering', 'no hiring a guard who is not listed');
assert.equal((await call('POST', '/v1/bodyguard/offer', { token: barry.token, body: { price: 15000 } })).code, 200, 'barry lists himself');
// audit: the offer is discoverable on the streets board (else the whole hire market is dead)
const barryOnBoard = (await call('GET', '/v1/streets', { token: paula.token })).body.streets.find((s) => s.id === barry.id);
assert.equal(barryOnBoard.guardPrice, 15000, 'the guard price is surfaced on the streets board');
await seedCh(paula.id, "cash=100000, loc='docks'");
const barryCash0 = (await meOf(barry.token)).cash;
r = await call('POST', `/v1/bodyguard/hire/${barry.id}`, { token: paula.token });
assert.equal(r.code, 200, 'paula hired protection');
assert.equal((await meOf(paula.token)).cash, 85000, 'paula paid the listed rate');
// sim-audit fix: hires now carry the standard 2% house take (1% dev + 1% street tax) — an untaxed
// unlimited P2P transfer was the cheapest value pipe in the game. Barry nets 98%.
assert.equal((await meOf(barry.token)).cash, barryCash0 + 14700, 'barry pocketed 98% up front (2% house take, a ledgered transfer)');
assert((await meOf(paula.token)).guardSeconds > 0, 'under protection');
assert.equal((await call('POST', `/v1/bodyguard/hire/${barry.id}`, { token: paula.token })).body.error, 'guarded', 'one bullet-catcher at a time');
// the earnable shield burns BEFORE real-ETH insurance — and one contract stops ONE bullet
await pool.query(`UPDATE account_persistent SET respawn_tokens = 1 WHERE account_id = (SELECT account_id FROM characters WHERE id='${paula.id}')`);
const ka = await whack(paula.id);
assert.equal(ka.kill, false, 'the blow never reached paula'); assert.equal(ka.absorbed, true, 'barry took the bullet');
assert.equal((await meOf(paula.token)).respawnTokens, 1, 'the real-ETH token was NOT spent — the bodyguard goes first');
assert((await meOf(barry.token)).hospSeconds > 0, "barry is under the Doc's care in her place");
assert.equal((await meOf(paula.token)).guardedBy, null, 'the contract is consumed — one bullet each');
const kb = await whack(paula.id);
assert.equal(kb.revived, true, 'with the guard spent, the respawn token is the last line');
// the betrayal: your own bodyguard's trigger finger voids the protection entirely
await seedCh(barry.id, "hosp_until=NULL, jail_until=NULL, energy=200, ammo=8000, cash=100000, cb=5, loc='docks'");
assert.equal((await call('POST', '/v1/armory/gun/lastresort/buy', { token: barry.token })).code, 200, 'barry armed');
assert.equal((await call('POST', `/v1/bodyguard/hire/${barry.id}`, { token: paula.token })).code, 200, 'paula, ever trusting, re-hired him');
assert.equal((await call('POST', `/v1/streets/${paula.id}/search`, { token: barry.token })).code, 200, 'her own guard put eyes on her');
await seedCh(paula.id, "hosp_until=NULL, loc='docks'"); await seedCh(barry.id, "energy=200, shoot_cd_until=NULL, loc='docks'");
const betrayal = (await call('POST', `/v1/streets/${paula.id}/fire`, { token: barry.token, body: { rounds: 6000 } })).body;
assert.equal(betrayal.kill, true, "the guard's OWN shot is never absorbed — betrayal beats protection");
// the guard steps in front of an NPC contractor's bullet too (payer-as-guard would step aside)
const gina = await mk('Guardian Gina');
assert.equal((await call('POST', '/v1/bodyguard/offer', { token: gina.token, body: { price: 15000 } })).code, 200, 'gina lists herself');
await seedCh(carla.id, "hosp_until=NULL, cash=50000, loc='docks'");
assert.equal((await call('POST', `/v1/bodyguard/hire/${gina.id}`, { token: carla.token })).code, 200, 'carla hired gina');
await seedCh(hirer.id, 'cash=200000000, npchit_at=NULL'); await pool.query('DELETE FROM npc_hits');
let npcAbsorbed = false;
for (let i = 0; i < 40 && !npcAbsorbed; i++) {
  await seedCh(hirer.id, 'npchit_at=NULL'); await pool.query('DELETE FROM npc_hits');
  await seedCh(carla.id, 'hosp_until=NULL');
  const res = (await call('POST', `/v1/streets/${carla.id}/npchit`, { token: hirer.token, body: { tier: 'professional' } })).body;
  assert(!res.killed, 'a guarded target is never killed by an NPC hit');
  if (res.absorbed) npcAbsorbed = true;
}
assert(npcAbsorbed, "gina took the contractor's bullet");
assert((await meOf(gina.token)).hospSeconds > 0, 'gina is in the hospital, carla is not in the ground');
// BALANCE D4: the per-TARGET cooldown — resetting the payer clock no longer lets a whale
// repeat-reset ONE rival; the (payer, target) pair rests a day between attempts
await seedCh(hirer.id, 'npchit_at=NULL');
assert.equal((await call('POST', `/v1/streets/${carla.id}/npchit`, { token: hirer.token, body: { tier: 'professional' } })).body.error,
  'target_cd', 'the same mark cannot be hit again for a day');
const otherMark = await mk('Other Mark'); await seedCh(otherMark.id, 'respect=400');
const om = await call('POST', `/v1/streets/${otherMark.id}/npchit`, { token: hirer.token, body: { tier: 'professional' } });
assert.equal(om.code, 200, 'a DIFFERENT mark is fair game immediately');
// sim-audit regression (F8): a DEAD guard releases his principals — protection was already void,
// but the stale pointer also blocked a replacement hire for the rest of the paid window
const doug = await mk('Doomed Doug');
assert.equal((await call('POST', '/v1/bodyguard/offer', { token: doug.token, body: { price: 15000 } })).code, 200, 'doug lists himself');
await seedCh(carla.id, "hosp_until=NULL, cash=100000, loc='docks'");
assert.equal((await call('POST', `/v1/bodyguard/hire/${doug.id}`, { token: carla.token })).code, 200, 'carla hired doug');
assert.equal((await whack(doug.id)).kill, true, 'doug got clipped');
assert.equal((await meOf(carla.token)).guardedBy, null, "the dead guard's contract is released at the estate");
await seedCh(gina.id, 'hosp_until=NULL');
assert.equal((await call('POST', `/v1/bodyguard/hire/${gina.id}`, { token: carla.token })).code, 200, 'carla can hire a live guard immediately');

// ── M8: the Tailor & Engraver — vanity/identity $OMR sinks (display-only, ledgered burns) ──
await pool.query(`UPDATE account_persistent SET omr = 100 WHERE account_id = (SELECT account_id FROM characters WHERE id='${don.id}')`);
const donOmr0 = (await meOf(don.token)).omr;
// street name change: costs 5 $OMR, living-name uniqueness still enforced
assert.equal((await call('POST', '/v1/vanity/name', { token: don.token, body: { name: 'Bullet Barry' } })).body.error, 'name_taken', 'no stealing a living name');
r = await call('POST', '/v1/vanity/name', { token: don.token, body: { name: 'Don Fabrizio II' } });
assert.equal(r.code, 200, 'the Don rebranded');
assert.equal((await meOf(don.token)).name, 'Don Fabrizio II', 'the streets know the new name');
assert.equal((await meOf(don.token)).omr, donOmr0 - 5, 'the name change burned 5 $OMR');
// custom title: 10 $OMR into the SAME display slot mission titles use; clearing is free
r = await call('POST', '/v1/vanity/title', { token: don.token, body: { title: 'The Velvet Hammer' } });
assert.equal(r.code, 200, 'title engraved'); assert.equal((await meOf(don.token)).title, 'The Velvet Hammer', 'title displayed');
assert.equal((await meOf(don.token)).omr, donOmr0 - 15, 'the title burned 10 $OMR');
assert.equal((await call('POST', '/v1/vanity/title', { token: don.token, body: { title: '' } })).code, 200, 'cleared');
assert.equal((await meOf(don.token)).title, null, 'slot empty again');
assert.equal((await meOf(don.token)).omr, donOmr0 - 15, 'clearing a title is free (ink, not ransom)');
// vanity plate: on YOUR car only, 2 $OMR, engraved uppercase
await pool.query(`INSERT INTO cars (id, character_id, model_id, trim_id, dmg) VALUES ('doncar','${don.id}','junker','stock',0)`);
assert.equal((await call('POST', '/v1/vanity/plate/nosuchcar', { token: don.token, body: { plate: 'OMERTA' } })).body.error, 'no_car', 'no engraving another man\'s ride');
r = await call('POST', '/v1/vanity/plate/doncar', { token: don.token, body: { plate: 'omerta 1' } });
assert.equal(r.code, 200, 'plate engraved'); assert.equal(r.body.plate, 'OMERTA 1', 'plates come back uppercase');
assert((await meOf(don.token)).cars.some((c) => c.plate === 'OMERTA 1'), 'the garage shows the plate');
// family colors: boss only, '#rrggbb'
assert.equal((await call('POST', '/v1/gangs/vanity/color', { token: mook.token, body: { color: '#aa00ff' } })).body.error, 'rank', 'the underboss does not pick the colors');
assert.equal((await call('POST', '/v1/gangs/vanity/color', { token: don.token, body: { color: 'purple' } })).body.error, 'color', 'a crest color is #rrggbb');
assert.equal((await call('POST', '/v1/gangs/vanity/color', { token: don.token, body: { color: '#AA00FF' } })).code, 200, 'the family flies new colors');
assert.equal((await call('GET', `/v1/gangs/${gangA}`, {})).body.gang.color, '#aa00ff', 'the crest color shows on the family page');
// family rename: boss only, founding rules + uniqueness, 25 $OMR
await seedCh(barry.id, 'respect=100, cash=50000'); // barry founds a throwaway family to squat a name
assert.equal((await call('POST', '/v1/gangs', { token: barry.token, body: { name: 'The Landmarks', tag: 'LMK' } })).code, 200, 'barry founded a family');
assert.equal((await call('POST', '/v1/gangs/vanity/name', { token: don.token, body: { name: 'The Landmarks' } })).body.error, 'taken', 'no renaming onto a claimed name');
r = await call('POST', '/v1/gangs/vanity/name', { token: don.token, body: { name: 'The New Fabrizi', tag: 'NFAB' } });
assert.equal(r.code, 200, 'the family rebranded');
assert.equal((await call('GET', `/v1/gangs/${gangA}`, {})).body.gang.name, 'The New Fabrizi', 'the ledger of record shows the new name');
// §10.4: every vanity purchase is an enumerated, ledgered $OMR burn — spends match rows exactly
const vanitySpent = donOmr0 - (await meOf(don.token)).omr;
const vanityLedger = -Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='omr' AND reason LIKE 'vanity:%'")).rows[0].s);
assert.equal(vanitySpent, 5 + 10 + 2 + 10 + 25, 'the shop charged exactly its price list');
assert.equal(vanityLedger, vanitySpent, 'every $OMR the Tailor took is a ledgered vanity:* burn');

// ── M8: board anonymity fee + counter-intelligence peek (the two sinks feed each other) ──
const seedOmr = (id, omr) => pool.query(`UPDATE account_persistent SET omr = ${omr} WHERE account_id = (SELECT account_id FROM characters WHERE id='${id}')`);
await seedCh(frank.id, 'cash=100000'); await seedOmr(frank.id, 0);
// no $OMR → no anonymity, and the WHOLE post rolls back (cash untouched, no pot)
const frankCash0 = (await meOf(frank.token)).cash;
r = await call('POST', `/v1/streets/${barry.id}/bounty`, { token: frank.token, body: { amount: 1000, kind: 'kill', anon: true } });
assert.equal(r.body.error, 'omr', 'anonymity has a price');
assert.equal((await meOf(frank.token)).cash, frankCash0, 'the failed anon post rolled back in full (cash untouched)');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM bounties WHERE target_character='${barry.id}'`)).rows[0].n), 0, 'no pot was opened');
await seedOmr(frank.id, 20);
assert.equal((await call('POST', `/v1/streets/${barry.id}/bounty`, { token: frank.token, body: { amount: 1000, kind: 'kill', anon: true } })).code, 200, 'anon contract posted');
assert.equal((await meOf(frank.token)).omr, 17, 'the anon fee burned 3 $OMR');
const anonRow = (await call('GET', '/v1/contracts', { token: mook.token })).body.contracts.find((c) => c.target.id === barry.id);
assert(anonRow && anonRow.poster === null, 'the board shows no poster');
// a top-up of a LIVE pot inherits its anonymity — the flag has no effect, so it is never charged
const donOmrPre = (await meOf(don.token)).omr;
assert.equal((await call('POST', `/v1/streets/${barry.id}/bounty`, { token: don.token, body: { amount: 600, kind: 'kill', anon: true } })).code, 200, 'top-up joined the pot');
assert.equal((await meOf(don.token)).omr, donOmrPre, 'no anon charge on a top-up (the flag took no effect)');
// the peek: the MARK reads every funder — including the anon poster. Charged only when there is something to hear.
assert.equal((await call('POST', '/v1/contracts/peek', { token: barry.token })).body.error, 'omr', 'intel has a price too');
await seedOmr(barry.id, 10);
r = await call('POST', '/v1/contracts/peek', { token: barry.token });
assert.equal(r.code, 200, 'barry bought the whisper');
assert.equal((await meOf(barry.token)).omr, 5, 'the peek burned 5 $OMR');
let names = r.body.contracts.find((c) => c.kind === 'kill').funders.map((f) => f.name);
assert(names.includes('Freelance Frank'), 'the peek PIERCES anonymity — the anon poster is named');
assert(names.includes('Don Fabrizio II'), 'every funder is named with their share');
// a family-funded pot shows the FAMILY as the funder
assert.equal((await call('POST', `/v1/gangs/contract/${barry.id}`, { token: don.token, body: { amount: 500, kind: 'hospitalize' } })).code, 200, 'the family put paper on barry too');
r = await call('POST', '/v1/contracts/peek', { token: barry.token });
assert.equal(r.code, 200, 'barry pays again (each whisper costs)');
names = r.body.contracts.find((c) => c.kind === 'hospitalize').funders.map((f) => f.name);
assert(names.includes('The New Fabrizi (family)'), 'a family stake is attributed to the family');
// sim-audit regression (F2): an ANON family contract must not name the family on the PUBLIC
// streets feed either — the emit outed what the 3 $OMR bought (the board already hid it)
{
  const { bus } = await import('../src/game.js');
  const feed = [];
  const spy = (e) => feed.push(e);
  bus.on('streets', spy);
  const anonMark = await mk('Anon Mark');
  await seedCh(don.id, 'cash=100000');
  assert.equal((await call('POST', '/v1/gangs/tribute', { token: don.token, body: { amount: 50000 } })).code, 200, 'don topped up the treasury');
  await seedOmr(don.id, 10);
  assert.equal((await call('POST', `/v1/gangs/contract/${anonMark.id}`, { token: don.token, body: { amount: 600, kind: 'kill', anon: true } })).code, 200, 'anon family contract posted');
  bus.off('streets', spy);
  const evt = feed.find((e) => e.type === 'bounty' && e.on === 'Anon Mark');
  assert(evt && !('family' in evt), 'the public streets feed does NOT name the family behind an anon pot');
}
// nothing on your head → no charge, just the good news
assert.equal((await call('POST', '/v1/contracts/peek', { token: gina.token })).body.error, 'no_contracts', 'silence is free (checked before any charge)');

// ── M8: family seals — the gang-prestige ladder, paid from the POOLED $OMR reserve ──
const close = (a, b) => Math.abs(a - b) < 1e-6; // reserve is NUMERIC and buybacks pay fractions
assert.equal((await call('POST', '/v1/gangs/vanity/seal', { token: mook.token })).body.error, 'rank', 'only the boss commissions the seal');
assert.equal((await call('POST', '/v1/gangs/vanity/seal', { token: barry.token })).body.error, 'reserve', 'an empty reserve buys no seal');
// any member pools $OMR into the reserve — the seal is a cooperative purchase, not a wallet flex
await seedOmr(mook.id, 3000);
assert.equal((await call('POST', '/v1/gangs/tribute/omr', { token: mook.token, body: { amount: 0 } })).body.error, 'min', 'zero tribute rejected');
const reserve0 = (await call('GET', `/v1/gangs/${gangA}`, {})).body.gang.omrReserve;
assert.equal((await call('POST', '/v1/gangs/tribute/omr', { token: mook.token, body: { amount: 2000 } })).code, 200, 'mook pooled tokens for the family');
assert.equal((await meOf(mook.token)).omr, 1000, "the tribute left mook's vault");
assert(close((await call('GET', `/v1/gangs/${gangA}`, {})).body.gang.omrReserve, reserve0 + 2000), 'and landed in the family reserve (a §10.4 bucket transfer)');
// the ladder climbs sequentially: Wax (25) then Brass (75) — each burn ledgered against the reserve
r = await call('POST', '/v1/gangs/vanity/seal', { token: don.token });
assert.equal(r.code, 200, 'the family took its first seal'); assert.equal(r.body.seal.name, 'Wax Seal', 'the ladder starts at wax');
r = await call('POST', '/v1/gangs/vanity/seal', { token: don.token });
assert.equal(r.code, 200, 'and climbed'); assert.equal(r.body.seal.name, 'Brass Seal', 'no skipping tiers');
assert(close((await call('GET', `/v1/gangs/${gangA}`, {})).body.gang.omrReserve, reserve0 + 2000 - 100), 'Wax (25) + Brass (75) burned from the reserve');
assert.equal((await call('GET', `/v1/gangs/${gangA}`, {})).body.gang.seal, 'Brass Seal', 'the family page bears the seal');
assert.equal((await call('GET', '/v1/gangs', {})).body.gangs.find((g) => g.id === gangA).seal, 'Brass Seal', 'the seal shows on the families list');
assert.equal((await meOf(don.token)).gang.seal, 'Brass Seal', 'every member carries it');
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='omr' AND reason='vanity:gang:seal'")).rows[0].s), -100, 'every seal $OMR is a ledgered burn');

// ── THE FOUNDATION — the family charity: a $OMR sink from the reserve that softens members' RICO trials ──
const soldier = await mk('Footsoldier Frankie');
assert.equal((await call('POST', `/v1/gangs/${gangA}/join`, { token: soldier.token })).code, 200, 'a soldier joins the family');
assert.equal((await call('POST', '/v1/gangs/foundation', { token: soldier.token })).body.error, 'rank', 'a rank-and-file soldier can\'t endow the foundation (boss/underboss only)');
assert.equal((await call('POST', '/v1/gangs/foundation', { token: barry.token })).body.error, 'reserve', 'an empty reserve endows nothing');
// top up the reserve, then climb sequentially: Community Fund (60) then Youth League (180)
await seedOmr(mook.id, 1000);
await call('POST', '/v1/gangs/tribute/omr', { token: mook.token, body: { amount: 300 } });
const fReserve0 = (await call('GET', `/v1/gangs/${gangA}`, {})).body.gang.omrReserve;
r = await call('POST', '/v1/gangs/foundation', { token: don.token });
assert.equal(r.code, 200, 'the family endowed its first foundation'); assert.equal(r.body.foundation.name, 'Community Fund', 'the ladder starts at the community fund');
r = await call('POST', '/v1/gangs/foundation', { token: don.token });
assert.equal(r.code, 200, 'and climbed'); assert.equal(r.body.foundation.name, 'Youth League', 'no skipping tiers');
assert(close((await call('GET', `/v1/gangs/${gangA}`, {})).body.gang.omrReserve, fReserve0 - 240), 'Community Fund (60) + Youth League (180) burned from the reserve');
// the badge on all three views
const fGang = (await call('GET', `/v1/gangs/${gangA}`, {})).body.gang;
assert.equal(fGang.foundation, 'Youth League', 'the family page bears the foundation');
assert.equal(fGang.foundationTier, 2, 'and its tier');
assert(fGang.foundationBustMult < 1, 'the family page publishes the trial-softening');
assert.equal((await call('GET', '/v1/gangs', {})).body.gangs.find((g) => g.id === gangA).foundation, 'Youth League', 'the foundation shows on the families list');
assert.equal((await meOf(don.token)).gang.foundation, 'Youth League', 'every member carries it');
// the philanthropy leaderboard
const fboard = (await call('GET', '/v1/leaderboard/foundation', { token: don.token })).body.board;
assert(fboard.some((g) => g.tier === 2 && g.foundation === 'Youth League'), 'the family tops the philanthropy board');
// every foundation $OMR is a ledgered burn (its own reason, distinct from vanity)
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='omr' AND reason='foundation:tier'")).rows[0].s), -240, 'every foundation $OMR is a ledgered burn');
// the RICO effect: the charity softens a member's conviction odds, more at higher tiers (bustProbOf × the tier mult)
{
  const fch = { heat_exposure: 3500, indicted_at: new Date(), jury_bought: false };
  const p0 = bustProbOf(fch, Date.now(), 0), p1 = bustProbOf(fch, Date.now(), 1), p2 = bustProbOf(fch, Date.now(), 2);
  assert(p2 < p1 && p1 < p0, `the family foundation cuts a member's conviction odds, more at higher tiers (${p2.toFixed(3)} < ${p1.toFixed(3)} < ${p0.toFixed(3)})`);
}
// STEP TWO — the FREELOAD GATE: the family charity softens the trial only for a member who was in the
// family when the case was FILED. Seed don indicted; joined BEFORE → soften, joined AFTER → none.
await seedCh(don.id, "indicted_at = now() - interval '1 hour', heat_exposure = 5000, heat = 0, last_accrued_at = now()");
await pool.query(`UPDATE gang_members SET joined_at = now() - interval '2 hours' WHERE character_id='${don.id}'`);
const oddsMember = (await call('GET', '/v1/law', { token: don.token })).body.convictionOdds;
await pool.query(`UPDATE gang_members SET joined_at = now() WHERE character_id='${don.id}'`); // "joined" AFTER the case — a freeloader
const oddsFreeload = (await call('GET', '/v1/law', { token: don.token })).body.convictionOdds;
assert(oddsMember < oddsFreeload, `the foundation softens a real member's trial but not a freeloader's (${oddsMember} < ${oddsFreeload})`);
await pool.query(`UPDATE gang_members SET joined_at = now() - interval '2 hours' WHERE character_id='${don.id}'`);
await seedCh(don.id, "indicted_at = NULL, heat_exposure = 0");
// (the FOUNDATION passive heat-bleed — accrue ctx.foundationTier — is covered by the direct accrue check in test/law.js)

// ── AUDIT (Pen breakout LOW-1): omertà is VOID on the JUMP path too for a WANTED man — a fugitive's
// own family can lay hands on him (parity with fire/npcHit/postBounty; the non-lethal gap, now closed) ──
const jboss = await mk('Jump Boss');
const jmember = await mk('Jump Member');
await seedCh(jboss.id, "respect=5000, cash=100000, muscle=800, energy=200, ammo=500, health=100, loc='downtown', jail_until=NULL, safe_until=NULL");
await seedCh(jmember.id, "respect=300, health=100, loc='downtown', jail_until=NULL, hosp_until=NULL");
const jgid = (await call('POST', '/v1/gangs', { token: jboss.token, body: { name: 'Jumpers', tag: 'JMP' } })).body.gangId;
await call('POST', `/v1/gangs/${jgid}/join`, { token: jmember.token });
assert.equal((await call('POST', `/v1/streets/${jmember.id}/jump`, { token: jboss.token })).body.error, 'family', 'a loyal family member has omertà on the jump path');
await seedCh(jmember.id, "wanted_until = now() + interval '1 day'");
assert.equal((await call('POST', `/v1/streets/${jmember.id}/jump`, { token: jboss.token })).code, 200, 'a WANTED family member forfeits omertà on the jump path too (audit LOW-1)');


// ── Phase 3 remainder: GEAR LOOT on a fire-kill — in-game gear is losable, on-chain gear is safe ──
process.env.GEAR_LOOT_CHANCE = '1'; // force the roll for a deterministic test (SEARCH_MS pattern)
const geared = await mk('Geared Gary'); await seedCh(geared.id, "respect=400, muscle=1, speed=1, loc='docks'");
const garyAcct = (await pool.query(`SELECT account_id FROM characters WHERE id='${geared.id}'`)).rows[0].account_id;
const donAcct = (await pool.query(`SELECT account_id FROM characters WHERE id='${don.id}'`)).rows[0].account_id;
await pool.query(`INSERT INTO account_gear (account_id, gear_id, minted_onchain) VALUES ('${garyAcct}','knuckles',false)`); // in-game — lootable
await pool.query(`INSERT INTO account_gear (account_id, gear_id, minted_onchain) VALUES ('${garyAcct}','brasspin',true)`);  // extracted on-chain — safe
const kg = await whack(geared.id);
assert(kg.kill, 'the geared mark went down');
assert.equal(kg.gearLoot, 'knuckles', 'the killer stripped the IN-GAME gear piece');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM account_gear WHERE account_id='${donAcct}' AND gear_id='knuckles'`)).rows[0].n), 1, 'the looted gear is now the killer\'s');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM account_gear WHERE account_id='${garyAcct}' AND gear_id='knuckles'`)).rows[0].n), 0, 'the victim lost it');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM account_gear WHERE account_id='${donAcct}' AND gear_id='brasspin'`)).rows[0].n), 0, 'the on-chain gear was NOT looted — it left the game, out of reach');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM account_gear WHERE account_id='${garyAcct}' AND gear_id='brasspin' AND minted_onchain`)).rows[0].n), 1, 'the extracted piece stays with the bloodline account, safe');
delete process.env.GEAR_LOOT_CHANCE; // restore the production default for the rest of the suite

// ── Risk-to-Earn Phase 3: TERRITORY RACKETS — productive, seizable capital ──
// gangA (DON) holds 'docks' (seized at the top). Establish an operation, earn from it, upgrade it,
// then watch a rival seize the turf and take the operation — and its income — with it.
assert.equal((await call('POST', '/v1/territory/docks/establish', { token: sal.token })).body.error, 'rank', 'a soldier does not run the rackets');
assert.equal((await call('POST', '/v1/territory/neon/establish', { token: don.token })).body.error, 'turf', "can't run an operation on turf you don't hold");
await seedCh(don.id, 'cash=500000');
assert.equal((await call('POST', '/v1/gangs/tribute', { token: don.token, body: { amount: 100000 } })).code, 200, 'treasury funded for the operation');
let treA = (await call('GET', `/v1/gangs/${gangA}`, {})).body.gang.treasury;
r = await call('POST', '/v1/territory/docks/establish', { token: don.token });
assert.equal(r.code, 200, 'operation established on docks'); assert.equal(r.body.name, 'Corner Numbers Game'); assert.equal(r.body.kind, 'numbers');
assert.equal((await call('GET', `/v1/gangs/${gangA}`, {})).body.gang.treasury, treA - 50000, 'establish cost ($50k) paid from the treasury');
assert.equal((await call('POST', '/v1/territory/docks/establish', { token: don.token })).body.error, 'exists', 'one operation per district');
// income accrues lazily; backdate the clock and collect to the treasury (any member can collect)
await pool.query(`UPDATE territory_rackets SET last_income_at = now() - interval '2 hours' WHERE district_id='docks'`);
treA = (await call('GET', `/v1/gangs/${gangA}`, {})).body.gang.treasury;
r = await call('POST', '/v1/territory/collect', { token: mook.token });
assert.equal(r.code, 200); assert.equal(r.body.collected, 8000, '2h × $4000/hr = $8000 collected');
assert.equal((await call('GET', `/v1/gangs/${gangA}`, {})).body.gang.treasury, treA + 8000, 'income landed in the treasury');
// the cap bounds hoarding: 100h backdated collects only the 24h cap
await pool.query(`UPDATE territory_rackets SET last_income_at = now() - interval '100 hours' WHERE district_id='docks'`);
assert.equal((await call('POST', '/v1/territory/collect', { token: don.token })).body.collected, 24 * 4000, 'income capped at TERRITORY_CAP_MS (24h)');
// upgrade to tier 2
r = await call('POST', '/v1/territory/docks/upgrade', { token: don.token });
assert.equal(r.code, 200, 'upgraded'); assert.equal(r.body.name, 'Neighborhood Numbers Game'); assert.equal(r.body.tier, 2);
assert(((await call('GET', `/v1/gangs/${gangA}`, {})).body.gang.territory || []).some((t) => t.district === 'docks' && t.tier === 2), 'the gang view shows the tier-2 operation');
// ── SEIZURE: a rival takes the turf → the operation transfers with it (wars fight over income) ──
const raider = await mk('Turf Raider'); await seedCh(raider.id, 'respect=400, cash=500000');
const rg = (await call('POST', '/v1/gangs', { token: raider.token, body: { name: 'The Claimants', tag: 'CLM' } })).body.gangId;
assert.equal((await call('POST', '/v1/gangs/tribute', { token: raider.token, body: { amount: 300000 } })).code, 200, 'raider funds the war chest');
r = await call('POST', '/v1/districts/docks/seize', { token: raider.token });
assert.equal(r.code, 200, 'the raider seized the docks');
// sim-audit F5: the seizure carried a war premium of 50% of the t2 operation's build cost
assert.equal(r.body.premium, Math.floor((50000 + 250000) * 0.5), 'seizing a built district costs the operation premium');
const raiderSeize = r.body.cost;
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM territory_rackets WHERE district_id='docks' AND owner_gang='${rg}'`)).rows[0].n), 1, 'the operation transferred to the victor with the turf');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM territory_rackets WHERE owner_gang='${gangA}'`)).rows[0].n), 0, 'the loser no longer owns it');
// the victor now earns the operation's income at the tier-2 rate
await pool.query(`UPDATE territory_rackets SET last_income_at = now() - interval '1 hour' WHERE district_id='docks'`);
assert.equal((await call('POST', '/v1/territory/collect', { token: raider.token })).body.collected, 16000, 'the new owner earns the tier-2 rate ($16k/hr)');
// §10.4: the raider's treasury reconciles to its ledger (tribute in − seize out + territory income in)
assert.equal((await call('GET', `/v1/gangs/${rg}`, {})).body.gang.treasury, 300000 - raiderSeize + 16000, 'territory income + seizure reconcile in the treasury');

// ══ STEP TWO — the ladder extended 3→5 + THE EMPIRE (gang status) ══
// the ladder grew 3→5 (content); upgradeRacket/territoryTierOf already handle any tier generically, so
// the extension is zero-code — a tier-3 operation can now climb to Vice Empire → The Syndicate.
assert.equal(TERRITORY_RACKETS.length, 5, 'the ladder grew to five tiers (content)');
assert(TERRITORY_RACKETS.find((t) => t.tier === 4 && t.name === 'Citywide') && TERRITORY_RACKETS.find((t) => t.tier === 5 && t.name === 'The Syndicate'), 'the two top scale tiers (Citywide / The Syndicate) are on the ladder');
// THE EMPIRE — the raider's family banked 16000 of lifetime territory income (its single tier-2 collect)
const empView = (await call('GET', `/v1/gangs/${rg}`, {})).body.gang.empire;
assert(empView && empView.earned === 16000, 'the gang view shows lifetime territory income (THE EMPIRE)');
assert.equal(empView.rank, territoryRankOf(16000).name, 'the empire rank is derived from lifetime income');
// THE EMPIRE leaderboard — both families that earned territory income appear, ranked by lifetime take
const terrLb = (await call('GET', '/v1/leaderboard/territory', { token: raider.token })).body;
assert(terrLb.empires.find((e) => e.family === 'The Claimants') && terrLb.empires.find((e) => e.family === 'The New Fabrizi'), 'both territorial families rank on the Empire board (§10.4-clean — territory_earned is a status counter, not currency)');
// BALANCE D2: collecting the district take is an exposed act — not from a safehouse
await seedCh(raider.id, "safe_until = now() + interval '1 hour'");
assert.equal((await call('POST', '/v1/territory/collect', { token: raider.token })).body.error, 'safe', 'no collecting territory income from a safehouse');
await seedCh(raider.id, 'safe_until=NULL');

// ── RECURRING SINKS: territory upkeep ("the pad" at the gang level, paid from the treasury) ──
// docks is a tier-2 Numbers→Protection op owned by the raider's gang (rg): incomePerHr $16k →
// upkeepPerHr = 20% = $3.2k. Fund the treasury via a LEDGERED tribute (so the §10.4 treasury
// check stays exact — no SQL-seeded cash) to afford the pads below, then square + measure.
await seedCh(raider.id, 'cash=5000000');
assert.equal((await call('POST', '/v1/gangs/tribute', { token: raider.token, body: { amount: 4000000 } })).code, 200, 'the boss funds the war chest');
await pool.query(`UPDATE territory_rackets SET upkeep_at=now(), last_income_at=now() WHERE district_id='docks'`);
let terr = (await call('GET', '/v1/territory', { token: raider.token })).body.territory.find((t) => t.district === 'docks');
assert.equal(terr.upkeepPerHr, 3200, 'the operation owes upkeep at 20% of its $16k/hr income');
assert.equal(terr.upkeepOwed, 0, 'a squared op owes nothing'); assert.equal(terr.cold, false, 'and runs warm');
// a soldier can't pay the pad (boss/underboss only, the establish gate)
const grunt = await mk('Grunt Gary');
assert.equal((await call('POST', `/v1/gangs/${rg}/join`, { token: grunt.token })).code, 200, 'gary joined the raiders');
assert.equal((await call('POST', '/v1/territory/upkeep', { token: grunt.token })).body.error, 'rank', 'a soldier does not square the pad');
// 5 hours of unpaid pad → owed ≈ $16k; paying is a ledgered treasury sink that resets the clock
await pool.query(`UPDATE territory_rackets SET upkeep_at = now() - interval '5 hours' WHERE district_id='docks'`);
const treaPrePad = (await call('GET', `/v1/gangs/${rg}`, {})).body.gang.treasury;
r = await call('POST', '/v1/territory/upkeep', { token: raider.token });
assert.equal(r.code, 200, 'the boss squares the pad'); assert.equal(r.body.paid, 3200 * 5, '5h × $3.2k paid from the treasury');
assert.equal((await call('GET', `/v1/gangs/${rg}`, {})).body.gang.treasury, treaPrePad - 3200 * 5, 'the pad left the treasury exactly');
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='territory:upkeep'")).rows[0].s),
  -(3200 * 5), 'territory:upkeep is a ledgered §10.4 treasury sink (character_id NULL)');
// COLD: an operation unpaid past the cold window (3d) produces nothing until squared
await pool.query(`UPDATE territory_rackets SET upkeep_at = now() - interval '4 days', last_income_at = now() - interval '2 hours' WHERE district_id='docks'`);
terr = (await call('GET', '/v1/territory', { token: raider.token })).body.territory.find((t) => t.district === 'docks');
assert.equal(terr.cold, true, 'four days unpaid → the operation is COLD');
r = await call('POST', '/v1/territory/collect', { token: raider.token });
assert.equal(r.body.collected, 0, 'a cold op hands the treasury nothing'); assert.equal(r.body.cold, 1, 'and reports itself cold');
assert.equal((await call('POST', '/v1/territory/docks/upgrade', { token: raider.token })).body.error, 'cold', "and won't take an upgrade");
// paying the pad THAWS it — income flows to the treasury again
await call('POST', '/v1/territory/upkeep', { token: raider.token });
await pool.query(`UPDATE territory_rackets SET last_income_at = now() - interval '1 hour' WHERE district_id='docks'`);
assert.equal((await call('GET', '/v1/territory', { token: raider.token })).body.territory.find((t) => t.district === 'docks').cold, false, 'the pad squared → warm again');
assert.equal((await call('POST', '/v1/territory/collect', { token: raider.token })).body.collected, 16000, 'and the take flows to the treasury again');
// §10.4: the treasury check still reconciles with the upkeep sink in the mix
const terrTreas = (await runLedgerInvariants(pool)).checks.find((c) => c.name === 'gang treasuries');
assert(terrTreas.ok, `the treasury check reconciles territory:upkeep (drift ${terrTreas.drift})`);

// ══ TERRITORY STEP THREE — per-district racket TYPE + the BUREAU CRACKDOWN ══
const tboss = await mk('Territory Boss'); await seedCh(tboss.id, 'respect=2000, cash=5000000');
const tgang = (await call('POST', '/v1/gangs', { token: tboss.token, body: { name: 'The Frontier Family', tag: 'TFF' } })).body.gangId;
await call('POST', '/v1/gangs/tribute', { token: tboss.token, body: { amount: 2000000 } }); // a LEDGERED war chest (so the treasury check stays exact)
await pool.query(`UPDATE districts SET holder_gang='${tgang}' WHERE id='canal'`);   // seed the turf
// TYPE choice: a bad business is refused; a SMUGGLING ring earns ×1.35 the base tier rate
assert.equal((await call('POST', '/v1/territory/canal/establish', { token: tboss.token, body: { kind: 'nope' } })).body.error, 'bad_kind', 'a real business or nothing');
r = await call('POST', '/v1/territory/canal/establish', { token: tboss.token, body: { kind: 'smuggling' } });
assert.equal(r.code, 200, 'a Smuggling Ring is established'); assert.equal(r.body.kind, 'smuggling'); assert.equal(r.body.name, 'Corner Smuggling Ring');
// income rides the type multiplier — 2h of a tier-1 smuggling ring = 2 × $4000 × 1.35 = $10,800
await pool.query(`UPDATE territory_rackets SET last_income_at = now() - interval '2 hours' WHERE district_id='canal'`);
r = await call('POST', '/v1/territory/collect', { token: tboss.token });
assert.equal(r.body.collected, Math.floor(2 * 4000 * 1.35), 'a Smuggling Ring earns 1.35× the base tier rate');
assert(!r.body.raided, 'a fresh operation has no heat yet — no raid');
// THE BUREAU CRACKDOWN: leave the hot ring running and the Feds come — seize the pending, fine the treasury
await pool.query(`UPDATE territory_rackets SET last_income_at = now() - interval '5 hours', scrutiny=0, scrutiny_at = now() - interval '20 hours' WHERE district_id='canal'`); // 20h × net +10/hr → over the threshold
let treT = (await call('GET', `/v1/gangs/${tgang}`, {})).body.gang.treasury;
process.env.TERRITORY_RAID_P = '1';   // pin the roll (TEST-ONLY, the BUSINESS_RAID_P precedent)
r = await call('POST', '/v1/territory/collect', { token: tboss.token });
assert(r.body.raided && r.body.raided.length === 1, 'the Bureau raids the hot Smuggling Ring');
assert.equal(r.body.collected, 0, 'the raid seized the pending income — nothing banked');
const tFine = Math.floor(territoryBuildCost(1) * 0.10);   // 10% of the tier-1 build cost
assert.equal(r.body.raided[0].fine, tFine, 'the treasury is fined 10% of the operation build cost');
assert.equal((await call('GET', `/v1/gangs/${tgang}`, {})).body.gang.treasury, treT - tFine, 'the fine hit the treasury exactly');
assert.equal(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='territory:raid' AND counterparty='${tgang}'`)).rows[0].s), -tFine, 'the fine is a ledgered §10.4 territory:raid treasury sink');
// a NUMBERS operation never heats up — safe and steady, no matter how long it runs (even with the roll pinned)
await pool.query(`UPDATE territory_rackets SET kind='numbers', scrutiny=0, scrutiny_at = now() - interval '200 hours', last_income_at = now() - interval '2 hours' WHERE district_id='canal'`);
r = await call('POST', '/v1/territory/collect', { token: tboss.token });
assert(!r.body.raided, 'a Numbers Game never draws the Bureau (scrutinyPerHr 0 < decay — never crosses the line)');
assert.equal(r.body.collected, 2 * 4000, 'the numbers op just pays out its base rate, safe');
delete process.env.TERRITORY_RAID_P;
// the type surfaces on the view; §10.4 treasury reconciles with territory:raid in the mix
const tView = (await call('GET', '/v1/territory', { token: tboss.token })).body.territory.find((t) => t.district === 'canal');
assert.equal(tView.kind, 'numbers', 'the view carries the operation type');
const t3Treas = (await runLedgerInvariants(pool)).checks.find((c) => c.name === 'gang treasuries');
assert(t3Treas.ok, `the treasury check reconciles territory:raid (drift ${t3Treas.drift})`);

// ══ TERRITORY STEP FOUR — FORTIFICATION + RIVAL RAIDS (the racket-wars layer) ══
// tgang (Territory Boss) holds canal (a tier-1 Numbers op); rg (raider) holds docks. Fund tgang so it
// can fortify, then rg muscles canal for a cut of its pending income (the shakedown pattern).
await call('POST', '/v1/gangs/tribute', { token: tboss.token, body: { amount: 500000 } }); // ledgered war chest
// FORTIFY — rank gate (a soldier can't), a rival can't fortify your op, then the boss buys a defense level
const tsold = await mk('Territory Soldier'); await call('POST', `/v1/gangs/${tgang}/join`, { token: tsold.token });
assert.equal((await call('POST', '/v1/territory/canal/fortify', { token: tsold.token })).body.error, 'rank', 'a soldier does not fortify the rackets');
assert.equal((await call('POST', '/v1/territory/canal/fortify', { token: raider.token })).body.error, 'not_yours', "you can't fortify a rival's operation");
const treTgPreFort = (await call('GET', `/v1/gangs/${tgang}`, {})).body.gang.treasury;
r = await call('POST', '/v1/territory/canal/fortify', { token: tboss.token });
assert.equal(r.code, 200, 'the boss fortified canal'); assert.equal(r.body.fortitude, 1, 'defense at level 1');
assert.equal(r.body.cost, 100000, 'fortifying a tier-1 op to level 1 costs $100k (base × 1 × tier)');
assert.equal((await call('GET', `/v1/gangs/${tgang}`, {})).body.gang.treasury, treTgPreFort - 100000, 'the fortify cost left the treasury exactly');
assert.equal(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='territory:fortify' AND counterparty='${tgang}'`)).rows[0].s), -100000, 'territory:fortify is a ledgered §10.4 treasury sink');
assert.equal((await call('GET', '/v1/territory', { token: tboss.token })).body.territory.find((t) => t.district === 'canal').fortitude, 1, 'the view shows the fortitude');

// RIVAL RAID — rg muscles canal (tgang's op) for a cut of its pending income
await seedCh(raider.id, 'energy=200, muscle=80, cunning=40'); // a real earner, past the level floor already (respect 400 → lvl 11)
await pool.query(`UPDATE territory_rackets SET last_income_at = now() - interval '2 hours', upkeep_at = now(), raid_cd_until=NULL WHERE district_id='canal'`);
assert.equal((await call('POST', '/v1/territory/docks/raid', { token: raider.token })).body.error, 'own', "you can't muscle your own family's operation");
const gruntRaid = await mk('Gangless Gus'); await seedCh(gruntRaid.id, 'energy=200, respect=400');
assert.equal((await call('POST', '/v1/territory/canal/raid', { token: gruntRaid.token })).body.error, 'no_gang', 'you need a family to bank the take');
process.env.TERRITORY_RIVAL_RAID_P = '1'; // pin the contest to a WIN (TEST-ONLY, the raid precedent)
const rgPreRaid = (await call('GET', `/v1/gangs/${rg}`, {})).body.gang.treasury;
r = await call('POST', '/v1/territory/canal/raid', { token: raider.token });
assert.equal(r.code, 200, `the raid lands (${JSON.stringify(r.body)})`); assert.equal(r.body.win, true, 'the muscle got in');
assert.equal(r.body.cut, Math.floor(8000 * 0.30), 'stole 30% of the $8000 pending (a Numbers op, ×1.0)');
assert.equal((await call('GET', `/v1/gangs/${rg}`, {})).body.gang.treasury, rgPreRaid + Math.floor(8000 * 0.30), "the cut landed in the raider's treasury");
assert.equal(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='territory:muscle' AND counterparty='${rg}'`)).rows[0].s), Math.floor(8000 * 0.30), 'territory:muscle is a ledgered §10.4 treasury faucet');
// the OWNER keeps the rest pending (the clock advanced only by the stolen share)
const canalPending = (await call('GET', '/v1/territory', { token: tboss.token })).body.territory.find((t) => t.district === 'canal').pending;
assert(Math.abs(canalPending - (8000 - Math.floor(8000 * 0.30))) <= 5, `the owner keeps ~the un-stolen $5600 pending (got ${canalPending})`);
// COOLDOWN — the op is on alert; a second raid is refused (the owner isn't ground down)
assert.equal((await call('POST', '/v1/territory/canal/raid', { token: raider.token })).body.error, 'cooldown', 'a raided op is on alert — no back-to-back raids');
// a LOSS costs the raider health, no cut (pin to a loss on a DIFFERENT op — reuse docks? it's rg's own → use a fresh setup)
await pool.query(`UPDATE territory_rackets SET raid_cd_until=NULL, last_income_at = now() - interval '2 hours' WHERE district_id='canal'`);
process.env.TERRITORY_RIVAL_RAID_P = '0'; // pin to a LOSS
await seedCh(raider.id, 'energy=200, health=100');
const rgPreLoss = (await call('GET', `/v1/gangs/${rg}`, {})).body.gang.treasury;
r = await call('POST', '/v1/territory/canal/raid', { token: raider.token });
assert.equal(r.body.win, false, 'the raid was repelled'); assert(r.body.dmg > 0, 'and the raider took a beating');
assert.equal((await call('GET', `/v1/gangs/${rg}`, {})).body.gang.treasury, rgPreLoss, 'a failed raid steals nothing');
assert(((await meOf(raider.token)).health || 100) < 100, "the raider's health dropped on the failed raid");
delete process.env.TERRITORY_RIVAL_RAID_P;
// §10.4: the treasury check reconciles with territory:fortify (sink) + territory:muscle (faucet) in the mix
const t4Treas = (await runLedgerInvariants(pool)).checks.find((c) => c.name === 'gang treasuries');
assert(t4Treas.ok, `the treasury check reconciles territory:fortify + territory:muscle (drift ${t4Treas.drift})`);

// ══ MAKE RISK PAY (sim-audit package): in-transit deposits + unbonding $OMR are lootable;
// ══ the safehouse is priced off the wealth it protects
const vault = await mk('Vinnie Vault');
await seedCh(vault.id, "cash=100000, loc='docks'");
r = await call('POST', '/v1/bank/deposit', { token: vault.token, body: { amount: 80000 } });
assert.equal(r.code, 200, 'deposited');
let vm = await meOf(vault.token);
assert.equal(vm.bankInTransit, 80000, 'the deposit rides IN TRANSIT (the courier is on the street)');
assert(vm.bankClearSeconds > 0, 'with a clearing clock');
// unstake → the unbonding window: no instant liquidity on the stake→extract path
await seedOmr(vault.id, 50);
assert.equal((await call('POST', '/v1/stake', { token: vault.token, body: { amount: 50 } })).code, 200, 'staked 50 (instant — the harbour is entered freely)');
r = await call('POST', '/v1/unstake', { token: vault.token });
assert.equal(r.code, 200, 'unstaked');
vm = await meOf(vault.token);
assert.equal(vm.staked, 0, 'principal left the stake whole');
assert.equal(vm.unbonding, 50, '…into the UNBONDING window, not liquid');
assert.equal(Math.floor(vm.omr), 0, 'not liquid yet — extraction crosses an exposure window');
// the kill: loot reaches 25% of (pocket + in-transit) and 20% of (liquid + unbonding)
const kv = await whack(vault.id);
assert.equal(kv.kill, true, 'vinnie got clipped mid-transfer');
assert.equal(kv.loot, Math.floor(20000 * 0.25) + Math.floor(80000 * 0.25), 'loot took 25% of pocket AND 25% of the in-transit deposit');
assert.equal(kv.omrLoot, Math.floor(50 * 0.20), 'loot took 20% of the UNBONDING $OMR');
// the survivor's account: the rest of the unbonding releases to liquid once the window passes
await pool.query(`UPDATE account_persistent SET unbond_at = now() - interval '1 minute' WHERE account_id = (SELECT account_id FROM characters WHERE id='${vault.id}')`);
vm = await meOf(vault.token);
assert.equal(vm.unbonding, 0, 'the unbond window passed — released');
assert.equal(Math.floor(vm.omr), 40, 'principal (50 − 10 looted) is liquid on the heir\'s account');
// wealth-scaled safehouse: 1% of liquid wealth, $25k floor — priced off what it protects
const rich = await mk('Richie Reserves');
await seedCh(rich.id, "cash=6000000, bank=14000000");
assert.equal((await meOf(rich.token)).safehouseCost, 200000, 'the view quotes 1% of cash+bank ($200k)');
r = await call('POST', '/v1/safehouse', { token: rich.token });
assert.equal(r.code, 200, 'the whale went to ground'); assert.equal(r.body.cost, 200000, 'and paid the scaled rate');
assert.equal((await meOf(rich.token)).cash, 6000000 - 200000, 'charged from pocket, ledgered safehouse sink');

// ══ VENDETTAS & BLOOD FEUDS: every death gets a story hook ══
const kane = await mk('Kane Killer');
const vitoB = await mk('Vito Vendetta');
await seedCh(vitoB.id, "respect=400, muscle=1, loc='docks', hosp_until=NULL");
await seedCh(kane.id, "respect=400, muscle=1, cash=100000, cb=5, energy=200, ammo=8000, loc='docks'");
assert.equal((await call('POST', '/v1/armory/gun/lastresort/buy', { token: kane.token })).code, 200, 'kane armed');
assert.equal((await call('POST', `/v1/streets/${vitoB.id}/search`, { token: kane.token })).code, 200, 'kane hunts');
k = (await call('POST', `/v1/streets/${vitoB.id}/fire`, { token: kane.token, body: { rounds: 6000 } })).body;
assert.equal(k.kill, true, 'first blood'); assert.equal(k.vendetta, false, 'no debt settled — this kill STARTS one');
// the heir is born owing blood
let vHeir = await meOf(vitoB.token);
assert.equal(vHeir.generation, 2, 'the heir stands up');
assert.equal(vHeir.vendettas.length, 1, 'sworn to vengeance');
assert.equal(vHeir.vendettas[0].target, 'Kane Killer', 'against the killer bloodline\'s current street');
assert.equal(vHeir.vendettas[0].sworn, 'Vito Vendetta', 'for the man they took');
assert(vHeir.vendettas[0].expiresSeconds > 6 * 86400, 'a seven-day window');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM notifications WHERE character_id='${vHeir.id}' AND type='vendetta'`)).rows[0].n), 1, 'the heir was told at birth');
// the blood-feud ledger
let feud = (await call('GET', `/v1/feud/${(await meOf(kane.token)).id}`, { token: vitoB.token })).body;
assert.equal(feud.kills.theirs, 1, 'they took one of ours');
assert.equal(feud.bloodOwed, 1, 'they owe us a body');
assert.equal(feud.myVendetta.sworn, 'Vito Vendetta', 'our vendetta is on the ledger');
// vengeance posts at street rates: the DIRECTED_MIN floor is waived against a vendetta target
// — for KILL pots ONLY (audit F2: a hospitalize pot stays exclusive to its named hitman, so a
// manufactured vendetta + a cheap directed hospitalize pot would re-open the squat the floor
// was built to price out; vengeance means a body, not a hospital bill)
await seedCh(vHeir.id, 'cash=20000');
r = await call('POST', `/v1/streets/${(await meOf(kane.token)).id}/bounty`, { token: vitoB.token, body: { amount: 600, kind: 'hospitalize', hitman: mook.id } });
assert.equal(r.body.error, 'directed_min', 'NO waiver for a directed hospitalize pot — kill contracts only');
r = await call('POST', `/v1/streets/${(await meOf(kane.token)).id}/bounty`, { token: vitoB.token, body: { amount: 600, kind: 'kill', hitman: mook.id } });
assert.equal(r.code, 200, 'a $600 directed revenge KILL contract clears (the $10k floor is waived for a vendetta)');
await call('POST', `/v1/contracts/${(await meOf(kane.token)).id}/kill/cancel`, { token: vitoB.token }); // clean the board
// SETTLEMENT: the heir collects the debt personally — vengeance pays 2x rep
await seedCh(vHeir.id, "respect=400, muscle=100, cash=100000, cb=5, energy=200, ammo=8000, loc='docks', hosp_until=NULL, jail_until=NULL");
assert.equal((await call('POST', '/v1/armory/gun/lastresort/buy', { token: vitoB.token })).code, 200, 'the heir armed');
const kaneStreet = (await meOf(kane.token)).id;
await seedCh(kaneStreet, "muscle=1, loc='docks', hosp_until=NULL");
assert.equal((await call('POST', `/v1/streets/${kaneStreet}/search`, { token: vitoB.token })).code, 200, 'the heir hunts');
k = (await call('POST', `/v1/streets/${kaneStreet}/fire`, { token: vitoB.token, body: { rounds: 6000 } })).body;
assert.equal(k.kill, true, 'the debt is collected');
assert.equal(k.vendetta, true, 'the vendetta is SETTLED');
assert.equal(k.hitman.repGain, 66, 'vengeance pays 2x feared-rep (floor(11×3×2), no prior bloodline kills)');
assert.equal((await meOf(vitoB.token)).vendettas.length, 0, 'the debt is off the books');
// the cycle turns: Kane's heir is born owing US blood — and a lapsed vendetta grants nothing
feud = (await call('GET', `/v1/feud/${kaneStreet}`, { token: vitoB.token })).body;
assert.equal(feud.bloodOwed, 0, 'a body for a body — the ledger is square');
assert.equal(feud.theirVendetta, true, 'but their heir has sworn the next round');
await pool.query(`UPDATE vendettas SET expires_at = now() - interval '1 minute' WHERE target_account = (SELECT account_id FROM characters WHERE id='${vHeir.id}')`);
assert.equal((await call('GET', `/v1/feud/${kaneStreet}`, { token: vitoB.token })).body.theirVendetta, false, 'a lapsed vendetta is no vendetta');
const kaneHeir = await meOf(kane.token);
await pool.query(`UPDATE characters SET cash=20000 WHERE id='${kaneHeir.id}'`);
r = await call('POST', `/v1/streets/${(await meOf(vitoB.token)).id}/bounty`, { token: kane.token, body: { amount: 600, kind: 'kill', hitman: mook.id } });
assert.equal(r.body.error, 'directed_min', 'no waiver on a lapsed vendetta — the floor is back');

// ── AUDIT #1: a fire-kill LOOTS the victim's live buy-order escrow (no more loot-proof vault) ──
const vvince = await mk('Vaulting Vince'); await seedCh(vvince.id, "cash=500000, respect=400, loc='docks'");
r = await call('POST', '/v1/market/order', { token: vvince.token, body: { goodId: 'gin', qty: 100, price: 500 } }); // $50k parked
assert.equal(r.code, 200, 'vince parks $50k in a buy-order'); assert.equal(r.body.escrow, 50000, 'the escrow is the vault');
// #1(b): can't set up a fresh cash-park while hiding
await seedCh(vvince.id, `safe_until = now() + interval '1 hour'`);
assert.equal((await call('POST', '/v1/market/order', { token: vvince.token, body: { goodId: 'gin', qty: 10, price: 100 } })).body.error, 'safe', 'no parking cash from a safehouse');
await seedCh(vvince.id, 'safe_until=NULL');
const escLootPre = (await runLedgerInvariants(pool)).checks.find((c) => c.name === 'market escrow');
assert(escLootPre.ok, 'market escrow starts reconciled with the parked order');
const donPreLoot = (await meOf(don.token)).cash;
const deathPre = Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='market:death'")).rows[0].s);
const kvo = await whack(vvince.id);
assert.equal(kvo.kill, true, 'don whacks the vault-keeper');
const expLoot = Math.floor(50000 * M3.CASH_LOOT_RATE);
assert.equal(kvo.orderLoot, expLoot, `the killer loots CASH_LOOT_RATE of the parked escrow ($${expLoot})`);
assert.equal((await meOf(don.token)).cash, donPreLoot + kvo.chop + kvo.loot + expLoot, "the order loot landed in don's pocket alongside chop + cash loot");
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='market:death'")).rows[0].s), deathPre - (50000 - expLoot), 'the un-looted remainder burned (dead-funder precedent)');
const escLootPost = (await runLedgerInvariants(pool)).checks.find((c) => c.name === 'market escrow');
assert(escLootPost.ok, `market escrow still exact after the loot+burn (${JSON.stringify(escLootPost)})`);
const vocabLoot = (await runLedgerInvariants(pool)).checks.find((c) => c.name === 'reason vocabulary');
assert(vocabLoot.ok, `market:loot rides the vocabulary (${JSON.stringify(vocabLoot.unknown || [])})`);

// ── STEP FOUR: WANTED — a defaulter forfeits omertà (family may hit them); NPC hunters come ──
const boss4 = await mk('Boss Fourette');
const mem4 = await mk('Deadbeat Member');
await seedCh(boss4.id, 'cash=200000, respect=5000'); // level to found a family
const g4 = (await call('POST', '/v1/gangs', { token: boss4.token, body: { name: 'The Welchers', tag: 'WEL' } })).body.gangId;
await call('POST', `/v1/gangs/${g4}/join`, { token: mem4.token });
assert.equal((await call('POST', `/v1/streets/${mem4.id}/bounty`, { token: boss4.token, body: { amount: 5000, kind: 'kill' } })).body.error, 'family', 'omertà: no contract on your own family');
await seedCh(mem4.id, "wanted_until = now() + interval '3 days'");
assert.equal((await call('POST', `/v1/streets/${mem4.id}/bounty`, { token: boss4.token, body: { amount: 5000, kind: 'kill' } })).code, 200, 'a WANTED family member forfeits omertà — the contract lands');
await seedCh(mem4.id, 'wanted_until = NULL'); // clear so the hunt below targets only the fresh mark
// the NPC bounty hunters whack a WANTED mark (WANTED_HUNT_P forced to 1)
process.env.WANTED_HUNT_P = '1';
const mark = await mk('Hunted Mark');
await seedCh(mark.id, "wanted_until = now() + interval '3 days'");
let hunt = await huntWanted(pool);
assert.equal(hunt.killed, 1, 'the NPC bounty hunter whacks the wanted mark');
assert.equal((await pool.query(`SELECT alive FROM characters WHERE id='${mark.id}'`)).rows[0].alive, false, 'the mark is dead (the estate ran)');
// a SAFEHOUSED wanted player is beyond the hunter's reach this tick (hide or square up)
const safe4 = await mk('Hiding Deadbeat');
await seedCh(safe4.id, "wanted_until = now() + interval '3 days', safe_until = now() + interval '4 hours'");
hunt = await huntWanted(pool);
assert.equal(hunt.killed, 0, 'a safehoused wanted player survives the hunt');
assert.equal((await pool.query(`SELECT alive FROM characters WHERE id='${safe4.id}'`)).rows[0].alive, true, 'still alive, still hiding');
await seedCh(safe4.id, 'wanted_until = NULL');
delete process.env.WANTED_HUNT_P;

// §10.4: the escrow bucket reconciles with family money in the mix (mirrors invariants.js check (c))
const escNow = Number((await pool.query('SELECT COALESCE(SUM(amount),0) s FROM bounties')).rows[0].s);
const tsum = async (w) => Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='cash' AND ${w}`)).rows[0].s);
const rhsEsc = -(await tsum("reason='bounty:post'")) - (await tsum("reason='gang:contract'")) - (await tsum("reason='bounty:wanted'"))
  - (await tsum("reason='bounty:claim'")) - (await tsum("reason='bounty:refund'")) + (await tsum("reason='death:bounty'"));
assert(Math.abs(escNow - rhsEsc) <= 1, `bounty/contract escrow reconciles: bucket ${escNow} vs ledger ${rhsEsc}`);

console.log('✅ M3 social test passed — gangs, tribute+weekly, turf (+perks), melt tithe, exchange, jumps, bounty, contract board, hit→death/estate, busting, notifications, websocket push, buyback family split, §10.4 invariants, M7 assassin rep + NPC hitmen + safehouse/fire-heat/war-kills + family contracts (treasury-funded, member lockout, refunds) + bodyguards (hire/absorb/betrayal, before-insurance ordering) + M8 Tailor & Engraver vanity sinks (name/title/plate/crest/rename — ledgered vanity:* burns) + M8 intel sinks (anon fee, peek pierces anon) + M8 family seals ($OMR tribute → pooled reserve → sequential ladder, ledgered burns) + THE FOUNDATION (family charity: rank gate, empty-reserve rejection, sequential tiers from the reserve, badge on all three views + philanthropy leaderboard, softens members\' RICO odds, ledgered foundation:tier burns; STEP TWO: freeload gate — the trial-soften only helps a member who joined before the case was filed) + M7-P3 territory rackets (establish/collect/upgrade, income cap, SEIZURE transfers the operation to the victor, treasury §10.4 reconcile) + VENDETTAS (heir born owing blood, feud ledger, waived directed floor, 2x settlement rep, the cycle turns, lapsed = nothing)');
await app.close();

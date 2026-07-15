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
import { familyTaskOf, weekOf } from '../src/rules.js';

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

// ── turf (§5.5): seize the Docks, then buy goods 5% cheaper standing on it ──
r = await call('POST', `/v1/districts/docks/seize`, { token: don.token });
assert.equal(r.code, 200, 'district seized'); assert.equal(r.body.garrison, 30000);
assert.equal((await call('POST', `/v1/districts/docks/seize`, { token: don.token })).code, 400, 'already held');
const board = (await call('GET', '/v1/market/prices', {})).body;
r = await call('POST', '/v1/goods/buy', { token: don.token, body: { goodId: 'gin', qty: 1 } });
assert.equal(r.code, 200, 'goods bought on own turf');
assert.equal(r.body.unit, Math.round(board.goods.docks.gin * 0.95), 'turf discount −5% applied');
const districts = (await call('GET', '/v1/districts', {})).body.districts;
assert.equal(districts.find((d) => d.id === 'docks').holder.tag, 'DON', 'holder listed');

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

r = await call('POST', `/v1/streets/${rocco.id}/fire`, { token: don.token, body: { rounds: 2200 } });
assert.equal(r.code, 200, 'shots fired');
assert(r.body.kill, `level-11 target with 2200 rounds is a kill (eff vs btk: ${JSON.stringify(r.body)})`);
assert.equal(r.body.chop, Math.floor(900 * 0.4), 'chop = 40% of the real fleet value');
assert.equal(r.body.bounty, 5000, "the completed hit collects Mook's open kill contract");

// estate: heir stands up on the same account; the street died with the man
const heir = await meOf(rocco.token);
assert.equal(heir.generation, 2, 'heir generation');
assert.equal(heir.name, 'Rocco Two-Knives', 'the bloodline keeps the name');
assert.equal(heir.cash, 500 + 100 * 5, 'legacy stake: $500 + $100 × prestige (floor(11/2))');
assert.equal(heir.omr, 7, '$OMR survives death on the account');
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

// anti-farm floor: a sub-level-5 rookie counts as a kill but pays ZERO rep
const rookie = await mk('Rookie Ricky');
let k = await whack(rookie.id);
assert(k.kill, 'rookie whacked'); assert.equal(k.hitman.repGain, 0, 'no rep for a rookie (below the level floor)');
donMe = await meOf(don.token);
assert.equal(donMe.kills, 2, 'the kill still counts'); assert.equal(donMe.hitmanRep, 33, 'but rep is unchanged');

// directed contract: Vito names Don as the hitman → exclusive window + a 1.5x rep bonus on the kill
const marked = await mk('Marked Mario'); await seedCh(marked.id, 'respect=400'); // level 11
r = await call('POST', `/v1/streets/${marked.id}/bounty`, { token: vito.token, body: { amount: 3000, kind: 'kill', hitman: don.id, reason: 'Make it clean.' } });
assert.equal(r.code, 200, 'directed contract posted'); assert.equal(r.body.hitman, don.id, 'named hitman recorded');
const dc = (await call('GET', '/v1/contracts', { token: don.token })).body.contracts.find((c) => c.target.id === marked.id);
assert.equal(dc.directedTo, donName, 'the board shows the named hitman during the exclusive window');
assert(dc.opensInSeconds > 0, 'and when it opens to everyone');
k = await whack(marked.id);
assert(k.kill && k.bounty === 3000, 'the named hitman collects the directed contract');
assert.equal(k.hitman.repGain, 49, 'directed kill pays the 1.5x bonus: floor(11×3×1.5)');
assert.equal((await meOf(don.token)).hitmanRep, 82, 'rep 33 + 49');

// repeat-bloodline diminishing: whacking Marked's HEIR (same account) pays half — and no bonus
const heir2 = await meOf(marked.token); await seedCh(heir2.id, 'respect=400'); // the heir, level 11
k = await whack(heir2.id);
assert(k.kill, 'the heir is whacked too');
assert.equal(k.hitman.repGain, 16, 'a repeat kill of the same bloodline is diminished: floor(11×3 / 2)');
donMe = await meOf(don.token);
assert.equal(donMe.hitmanRep, 98, 'rep 82 + 16'); assert.equal(donMe.kills, 4, 'four lifetime kills');
assert.equal(donMe.hitmanTitle, 'Button Man', '98 rep → Button Man');

// the feared-assassin leaderboard: the lifetime legend + this season's streak
const lb = (await call('GET', '/v1/leaderboard/hitmen', { token: don.token })).body;
assert(lb.legend.some((e) => e.name === donName && e.rep === 98 && e.title === 'Button Man'), 'Don leads the legend board');
assert(lb.season.some((e) => e.name === donName && e.kills === donMe.seasonKills), 'Don on the season board');

console.log('✅ M3 social test passed — gangs, tribute+weekly, turf (+perks), melt tithe, exchange, jumps, bounty, contract board, hit→death/estate, busting, notifications, websocket push, buyback family split, §10.4 invariants, M7 Phase 2 assassin rep (rep/kills/streak, level floor, directed bonus, bloodline diminishing, leaderboard)');
await app.close();

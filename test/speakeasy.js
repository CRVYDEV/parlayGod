// THE SPEAKEASY test (the 28th suite) — the social hub: a club per district, the proprietor's front +
// the being-seen economy. Covers: open (level gate, one-per-district, one-per-man, cash sink), the base
// bar take (lazy income faucet + 24h cap + safehouse gate), the decor ladder (collects pending first),
// naming (vanity:speakeasy burn + no-op guard), buying a ROUND (two-party taxed transfer patron→owner,
// guest list, prestige, cooldown + travel/jail/self gates), the REGULAR status, BOTTLE service (a pure
// $OMR burn + big prestige), the nightlife board, DEATH (a dead proprietor's club goes dark), and §10.4
// (the per-character cash check reconciles the speakeasy: vocabulary; bottles/naming ride vanity:%).
// pg-mem, zero infra. Seeded cash/$OMR are unledgered grants → tallied into the expected check drift.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { SPEAKEASY, speakeasyTierOf } from '../src/rules.js';
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
  const ch = await meOf(token);
  return { token, id: ch.id, aid: (await pool.query(`SELECT account_id a FROM characters WHERE id='${ch.id}'`)).rows[0].a };
};
const seed = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);
let cashDrift = 0, omrDrift = 0;
const grantCash = async (id, n) => { await pool.query(`UPDATE characters SET cash = cash + ${n} WHERE id='${id}'`); cashDrift += n; };
const grantOmr = async (aid, n) => { await pool.query(`UPDATE account_persistent SET omr = omr + ${n} WHERE account_id='${aid}'`); omrDrift += n; };
const lvlRespect = (lvl) => 4 * (lvl - 1) * (lvl - 1);

const owner = await mk('Nucky Thompson');
const patron = await mk('Arnold Rothstein');
const rival = await mk('Al Capone');

// ── OPEN: level-gated, one per district, one per man, cash sink ──
assert.equal((await call('POST', '/v1/speakeasy/neon/open', { token: owner.token })).body.error, 'level', 'a nobody cannot open a club');
await seed(owner.id, `respect=${lvlRespect(20)}`); // clear the level gate
assert.equal((await call('POST', '/v1/speakeasy/nowhere/open', { token: owner.token })).body.error, 'bad_district', 'no such district');
// not enough cash first
assert.equal((await call('POST', '/v1/speakeasy/neon/open', { token: owner.token })).body.error, 'cash', "can't open a club broke");
await grantCash(owner.id, 2000000);
const open = await call('POST', '/v1/speakeasy/neon/open', { token: owner.token });
assert.equal(open.code, 200, 'the boss opens the Neon Mile club');
assert.equal(open.body.tier, 0, 'opens at tier 0 (The Backroom)');
assert.equal((await meOf(owner.token)).cash, 2000500 - SPEAKEASY.OPEN_COST, 'the open cost left the pocket (ledgered speakeasy:open)');
// one per district
await seed(rival.id, `respect=${lvlRespect(20)}`); await grantCash(rival.id, 2000000);
assert.equal((await call('POST', '/v1/speakeasy/neon/open', { token: rival.token })).body.error, 'taken', 'only one club per district');
// one per man
assert.equal((await call('POST', '/v1/speakeasy/docks/open', { token: owner.token })).body.error, 'own', 'a man runs one house');

// ── the character view surfaces the club ──
assert.equal((await meOf(owner.token)).speakeasy.district, 'neon', 'the sheet shows the club');
assert.equal((await meOf(owner.token)).speakeasy.tierName, 'The Backroom', 'with its tier name');

// ── the nightlife board ──
let board = (await call('GET', '/v1/speakeasy', { token: patron.token })).body;
assert.equal(board.clubs.length, 1, 'one club on the map');
assert.equal(board.clubs[0].owner, 'Nucky Thompson', 'named by its proprietor');
assert(board.open.includes('docks') && !board.open.includes('neon'), 'the open districts list neon as taken');

// ── COLLECT the base bar take: lazy, capped, ledgered speakeasy:income ──
await pool.query(`UPDATE speakeasies SET income_at = now() - interval '25 hours' WHERE district_id='neon'`);
const preCollect = (await meOf(owner.token)).cash;
const coll = await call('POST', '/v1/speakeasy/collect', { token: owner.token });
assert.equal(coll.code, 200, 'the take is collected');
const capIncome = Math.floor(speakeasyTierOf(0).incomePerHr * SPEAKEASY.INCOME_CAP_MS / 3600000);
assert.equal(coll.body.collected, capIncome, 'the bar take is capped at 24h');
assert.equal((await meOf(owner.token)).cash, preCollect + capIncome, 'it landed in the pocket');
// safehouse blocks collection (an exposed act, D2)
await seed(owner.id, `safe_until = now() + interval '1 hour'`);
assert.equal((await call('POST', '/v1/speakeasy/collect', { token: owner.token })).body.error, 'safe', 'no collecting from the bunker');
await seed(owner.id, `safe_until = NULL`);

// ── UPGRADE the decor: banks pending at the old rate, pays the next tier, raises income ──
await pool.query(`UPDATE speakeasies SET income_at = now() WHERE district_id='neon'`); // no pending, clean upgrade
await grantCash(owner.id, 1000000);
const up = await call('POST', '/v1/speakeasy/upgrade', { token: owner.token });
assert.equal(up.code, 200, 'the decor goes up a tier');
assert.equal(up.body.tier, 1, 'now The Lounge');
assert.equal((await meOf(owner.token)).speakeasy.incomePerHr, speakeasyTierOf(1).incomePerHr, 'the take rises with the room');

// ── NAME the club: a $OMR vanity burn (rides vanity:%) + the no-op guard ──
await grantOmr(owner.aid, 50);
assert.equal((await call('POST', '/v1/speakeasy/name', { token: owner.token, body: { name: 'x' } })).body.error, 'name', 'too short a name');
const nm = await call('POST', '/v1/speakeasy/name', { token: owner.token, body: { name: 'The Onyx Club' } });
assert.equal(nm.code, 200, 'the club is named');
assert.equal(nm.body.spent, SPEAKEASY.NAME_OMR, 'the naming burned $OMR');
assert.equal((await call('POST', '/v1/speakeasy/name', { token: owner.token, body: { name: 'The Onyx Club' } })).body.error, 'same', 'a same-name rename is a refused no-op');

// ── BUY A ROUND: two-party taxed transfer patron → owner, guest list, prestige, gates ──
await grantCash(patron.id, 500000);
// not in the district
await seed(patron.id, `loc='docks'`);
assert.equal((await call('POST', '/v1/speakeasy/neon/round', { token: patron.token, body: { round: 'round' } })).body.error, 'travel', "can't buy a round from across town");
await seed(patron.id, `loc='neon'`);
// the owner can't buy at their own joint (withTwoCharacters rejects self)
assert.equal((await call('POST', '/v1/speakeasy/neon/round', { token: owner.token, body: { round: 'round' } })).body.error, 'self', 'no buying rounds at your own club');
// jailed can't
await seed(patron.id, `jail_until = now() + interval '10 minutes'`);
assert.equal((await call('POST', '/v1/speakeasy/neon/round', { token: patron.token, body: { round: 'round' } })).body.error, 'jailed', 'no nights out from lockup');
await seed(patron.id, `jail_until = NULL`);
const round = SPEAKEASY.ROUNDS[0], net = round.cost - Math.ceil(round.cost * 0.01) * 2;
const ownerCashPre = (await meOf(owner.token)).cash, patronCashPre = (await meOf(patron.token)).cash;
const poolPre = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
const r1 = await call('POST', '/v1/speakeasy/neon/round', { token: patron.token, body: { round: 'round' } });
assert.equal(r1.code, 200, 'a round for the house');
assert.equal(r1.body.toOwner, net, 'the owner nets 98% of the round');
assert.equal((await meOf(patron.token)).cash, patronCashPre - round.cost, 'the patron paid the full round');
assert.equal((await meOf(owner.token)).cash, ownerCashPre + net, 'the owner got the cut');
assert.equal(Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool), poolPre + Math.ceil(round.cost * 0.01), 'the 1% street tax fed the buyback');
assert.equal(r1.body.visits, 1, 'the patron is on the guest list');
// cooldown: an immediate second round is refused
assert.equal((await call('POST', '/v1/speakeasy/neon/round', { token: patron.token, body: { round: 'round' } })).body.error, 'cooldown', 'one round, then let the room breathe');

// ── REGULAR: enough visits make you a regular (status) ──
for (let i = 0; i < SPEAKEASY.REGULAR_VISITS; i++) {
  await pool.query(`UPDATE speakeasy_patrons SET last_at = now() - interval '2 hours' WHERE character_id='${patron.id}'`);
  await call('POST', '/v1/speakeasy/neon/round', { token: patron.token, body: { round: 'round' } });
}
board = (await call('GET', '/v1/speakeasy', { token: patron.token })).body;
const you = board.clubs[0].guestList.find((g) => g.you);
assert(you && you.regular, 'the patron is now a regular');
assert(board.clubs[0].regulars >= 1, 'the club counts a regular');
assert(board.clubs[0].prestige > speakeasyTierOf(1).prestige, 'the rounds raised the club prestige above the tier floor');

// ── BOTTLE SERVICE: a pure $OMR status burn + big prestige ──
await grantOmr(patron.aid, 100);
const prestigePreBottle = board.clubs[0].prestige;
const bottle = SPEAKEASY.BOTTLES[2]; // the reserve
const omrPre = (await meOf(patron.token)).omr;
const bs = await call('POST', '/v1/speakeasy/neon/bottle', { token: patron.token, body: { bottle: bottle.id } });
assert.equal(bs.code, 200, 'bottle service, on the man');
assert.equal(bs.body.spent, bottle.omr, 'the bottle burned $OMR');
assert.equal((await meOf(patron.token)).omr, omrPre - bottle.omr, 'the $OMR left the account');
board = (await call('GET', '/v1/speakeasy', { token: patron.token })).body;
assert.equal(board.clubs[0].prestige, prestigePreBottle + bottle.prestige, 'the bottle raised the club prestige');
// a bottle requires being at the club
await seed(patron.id, `loc='docks'`);
assert.equal((await call('POST', '/v1/speakeasy/neon/bottle', { token: patron.token, body: { bottle: 'bottle' } })).body.error, 'travel', 'no bottle from across town');
await seed(patron.id, `loc='neon'`);

// ── §10.4 (mid-life): the per-character cash check reconciles the speakeasy: vocabulary ──
let inv = await runLedgerInvariants(pool);
const cashCheck = inv.checks.find((c) => c.name === 'character cash');
assert.equal(cashCheck.drift, cashDrift, `the only cash drift is the test's unledgered grants (${cashDrift}) — speakeasy: reconciles`);
let vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `speakeasy: rides the §10.4 vocabulary (${JSON.stringify(vocab.unknown || [])})`);
const omrCheck = inv.checks.find((c) => c.name === '$OMR conservation');
assert.equal(omrCheck.drift, omrDrift, `the only $OMR drift is the test grants (${omrDrift}) — bottles/naming reconcile as vanity:% burns`);

// ── DEATH: a dead proprietor's club goes dark (+ its guest list clears) ──
await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: owner.id }, headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM speakeasies WHERE district_id='neon'`)).rows[0].n), 0, "the dead don's club is gone");
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM speakeasy_patrons WHERE district_id='neon'`)).rows[0].n), 0, 'the guest list cleared with it');
board = (await call('GET', '/v1/speakeasy', { token: patron.token })).body;
assert(board.open.includes('neon'), 'the district is open for a new proprietor');

// §10.4 still holds after the estate (the club/guest-list wipe moves no currency)
inv = await runLedgerInvariants(pool);
assert.equal(inv.checks.find((c) => c.name === 'character cash').drift, cashDrift, 'cash §10.4 holds through the estate');
assert(inv.checks.find((c) => c.name === 'reason vocabulary').ok, 'vocabulary still closed');

console.log('✅ The Speakeasy test passed — open (level/one-per-district/one-per-man/cash gates), the base bar take (lazy income + 24h cap + safehouse gate), the decor ladder, naming (vanity:speakeasy burn + no-op guard), buying a ROUND (two-party taxed patron→owner transfer + guest list + prestige + cooldown/travel/self/jail gates), the REGULAR status, BOTTLE service (a pure $OMR burn + prestige), the nightlife board, DEATH (the proprietor\'s club goes dark + guest list clears + district reopens), and §10.4 (the per-character cash check reconciles speakeasy:; bottles/naming ride vanity:%)');
await app.close();

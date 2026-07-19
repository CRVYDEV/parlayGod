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
const bruno = await mk('Bruno Tattaglia'); // the step-four standover challenger

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

// ── STEP TWO — THE BACK-ROOM TABLE: patron plays, owner takes the rake (a taxed transfer, edge burns) ──
await grantCash(patron.id, 200000);
assert.equal((await call('POST', '/v1/speakeasy/neon/table', { token: patron.token, body: { bet: 10 } })).body.error, 'min', 'below the table minimum');
assert.equal((await call('POST', '/v1/speakeasy/neon/table', { token: patron.token, body: { bet: 99999999 } })).body.error, 'max', 'above the table cap');
const notoPre = Number((await pool.query(`SELECT notoriety FROM speakeasies WHERE district_id='neon'`)).rows[0].notoriety);
const ownerCashPreT = (await meOf(owner.token)).cash, patronCashPreT = (await meOf(patron.token)).cash;
const tbet = 10000, trake = Math.ceil(tbet * SPEAKEASY.TABLE.RAKE_BPS / 10000);
const tbl = await call('POST', '/v1/speakeasy/neon/table', { token: patron.token, body: { bet: tbet } });
assert.equal(tbl.code, 200, 'the wheel spins');
assert.equal(tbl.body.rake, trake, 'the club took its rake');
assert.equal((await meOf(owner.token)).cash, ownerCashPreT + trake, 'the rake landed with the owner (carved from the stake, not minted)');
assert.equal((await meOf(patron.token)).cash, patronCashPreT + (tbl.body.win ? tbl.body.payout - tbet : -tbet), 'the patron paid the bet and got the win (or not)');
assert(Number((await pool.query(`SELECT notoriety FROM speakeasies WHERE district_id='neon'`)).rows[0].notoriety) > notoPre, 'gambling drew heat onto the club');
// away from the club → no table
await seed(patron.id, `loc='docks'`);
assert.equal((await call('POST', '/v1/speakeasy/neon/table', { token: patron.token, body: { bet: tbet } })).body.error, 'travel', 'no table from across town');
await seed(patron.id, `loc='neon'`);
// audit HIGH-1: ONE patron can only add PATRON_NOTORIETY_CAP notoriety (< RAID_THRESHOLD) — a single account
// can NEVER flood a club into a raid; a hot club needs distinct traffic. Play the table many times, assert cap.
await grantCash(patron.id, 300000);
for (let i = 0; i < 12; i++) await call('POST', '/v1/speakeasy/neon/table', { token: patron.token, body: { bet: 1000 } });
const floodNoto = Number((await pool.query(`SELECT notoriety FROM speakeasies WHERE district_id='neon'`)).rows[0].notoriety);
assert(floodNoto <= SPEAKEASY.PATRON_NOTORIETY_CAP, `one patron's heat is capped at ${SPEAKEASY.PATRON_NOTORIETY_CAP} (was ${floodNoto}) — no solo grief`);
assert(floodNoto < SPEAKEASY.RAID_THRESHOLD, 'one patron can never push a club to the raid threshold');
await pool.query(`UPDATE speakeasies SET notoriety=0 WHERE district_id='neon'`); // reset for the forced-raid test below

// ── STEP TWO — THE PROHIBITION RAID: a hot club is seized + fined + shuttered on the owner's collect ──
await grantCash(owner.id, 500000); // cover the fine
await pool.query(`UPDATE speakeasies SET notoriety=100, notoriety_at = now() - interval '1 hour', income_at = now() - interval '3 hours' WHERE district_id='neon'`);
const ownerBeforeRaid = (await meOf(owner.token)).cash;
process.env.SPEAKEASY_RAID_P = '1'; // force the roll (the BUSINESS_RAID_P precedent)
const raid = await call('POST', '/v1/speakeasy/collect', { token: owner.token });
delete process.env.SPEAKEASY_RAID_P;
assert(raid.body.raid && raid.body.raid.raided, 'the Prohibition boys raided the club');
assert(raid.body.raid.fine > 0, 'the owner was fined');
assert.equal((await meOf(owner.token)).cash, ownerBeforeRaid - raid.body.raid.fine, 'the fine left the pocket (ledgered speakeasy:raid) — the pending take was seized, not banked');
const shutRow = (await pool.query(`SELECT shut_until FROM speakeasies WHERE district_id='neon'`)).rows[0];
assert(shutRow.shut_until && new Date(shutRow.shut_until) > new Date(), 'the club is shuttered');
// a shuttered club serves no one and earns nothing
assert.equal((await call('POST', '/v1/speakeasy/neon/round', { token: patron.token, body: { round: 'round' } })).body.error, 'shut', 'no rounds at a shuttered club');
assert.equal((await call('POST', '/v1/speakeasy/neon/table', { token: patron.token, body: { bet: tbet } })).body.error, 'shut', 'no table at a shuttered club');
assert.equal((await call('POST', '/v1/speakeasy/collect', { token: owner.token })).body.collected, 0, 'a dark club earns nothing while shuttered');
assert.equal((await call('POST', '/v1/speakeasy/upgrade', { token: owner.token })).body.error, 'shut', 'no renovating a shuttered club (audit MED-1: upgrade resolves the raid + honours the shutter)');
await pool.query(`UPDATE speakeasies SET shut_until=NULL, notoriety=0, income_at=now() WHERE district_id='neon'`); // reopen for the step-three tests

// ── STEP THREE — cross-club RENOWN (the nightlife legend, derived from patronage + ownership) ──
board = (await call('GET', '/v1/speakeasy', { token: patron.token })).body;
assert(board.yourRenown && board.yourRenown.renown > 100, `the patron built real renown from rounds + a bottle (was ${board.yourRenown?.renown})`);
assert(typeof board.yourRenown.rank === 'string', 'renown carries a display rank');
const nl = (await call('GET', '/v1/leaderboard/nightlife', { token: patron.token })).body;
assert(nl.board.length >= 1 && nl.board.some((x) => x.you && x.renown > 0), 'the patron ranks on the nightlife leaderboard');
assert(nl.board.some((x) => x.name === 'Nucky Thompson'), 'the proprietor ranks too (own-club prestige feeds renown)');

// ── STEP THREE — the ETH COSMETIC DECOR tier (Store SKU → account unlock → apply to the club) ──
assert.equal((await call('POST', '/v1/speakeasy/decor', { token: owner.token, body: { style: 'gilded' } })).body.error, 'locked', "you can't apply decor you don't own");
assert.equal((await call('POST', '/v1/speakeasy/decor', { token: owner.token, body: { style: 'nope' } })).body.error, 'bad_style', 'no such decor style');
// buy the Art Deco style with EARNED $OMR (the PLEX path — floor price 0.02 ETH × 5000 = 100 $OMR, no oracle)
await grantOmr(owner.aid, 150);
const buyDeco = await call('POST', '/v1/store/plex/decor_deco', { token: owner.token });
assert.equal(buyDeco.code, 200, 'bought the Art Deco decor via PLEX ($OMR)');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM store_cosmetics WHERE account_id='${owner.aid}' AND style='deco'`)).rows[0].n), 1, 'the cosmetic unlock landed (account-level, survives death)');
assert.equal((await call('POST', '/v1/store/plex/decor_deco', { token: owner.token })).body.error, 'owned', 'a re-buy of an owned cosmetic is refused BEFORE the burn');
const applied = await call('POST', '/v1/speakeasy/decor', { token: owner.token, body: { style: 'deco' } });
assert.equal(applied.code, 200, 'the owner fitted out the club');
assert.equal(applied.body.decorName, 'Art Deco', 'the decor name resolves');
board = (await call('GET', '/v1/speakeasy', { token: owner.token })).body;
assert.equal(board.clubs.find((c) => c.district === 'neon').decor, 'deco', 'the board shows the applied decor');
assert.equal((await call('POST', '/v1/speakeasy/decor', { token: owner.token, body: { style: null } })).body.decor, null, 'clearing to stock is free (you own the club)');
await call('POST', '/v1/speakeasy/decor', { token: owner.token, body: { style: 'deco' } }); // re-apply for the board

// ── STEP FOUR — renown-EARNED decor (a cosmetic you unlock by being SEEN, not bought; access-not-power) ──
assert.equal((await call('POST', '/v1/speakeasy/decor', { token: owner.token, body: { style: 'house' } })).body.error, 'renown', "the House Favorite style is renown-gated — you can't just apply it");
await pool.query(`UPDATE speakeasies SET prestige=2000 WHERE district_id='neon'`); // a storied club → the owner's renown clears the House Favorite bar (prestige×0.5=1000 ≥ 800)
const houseDecor = await call('POST', '/v1/speakeasy/decor', { token: owner.token, body: { style: 'house' } });
assert.equal(houseDecor.code, 200, 'with the renown earned, the House Favorite style applies — no purchase');
assert.equal(houseDecor.body.decorName, 'House Favorite', 'the earned style resolves');
assert.equal((await call('POST', '/v1/speakeasy/decor', { token: owner.token, body: { style: 'crown' } })).body.error, 'renown', 'The Crown needs more renown still (2000)');
await call('POST', '/v1/speakeasy/decor', { token: owner.token, body: { style: 'deco' } }); // back to a bought style (the buyout reverts it anyway)

// ── STEP THREE — the P2P BUYOUT (a district clears without a death; a taxed transfer) ──
assert.equal((await call('POST', '/v1/speakeasy/list', { token: owner.token, body: { price: 1 } })).body.error, 'price', 'below the sale floor');
assert.equal((await call('POST', '/v1/speakeasy/neon/buy', { token: rival.token })).body.error, 'not_for_sale', "you can't buy a club that isn't listed");
const salePrice = 500000;
const listed = await call('POST', '/v1/speakeasy/list', { token: owner.token, body: { price: salePrice } });
assert.equal(listed.code, 200, 'the owner lists the club');
assert.equal(listed.body.salePrice, salePrice, 'at the asking price');
// the buyer must be at the district
await seed(rival.id, `loc='docks'`);
assert.equal((await call('POST', '/v1/speakeasy/neon/buy', { token: rival.token })).body.error, 'travel', 'the buyer shows up in person');
await seed(rival.id, `loc='neon'`);
// a safehoused buyer can't do a public sit-down (audit LOW-1: parity with round/table/bottle)
await seed(rival.id, `safe_until = now() + interval '1 hour'`);
assert.equal((await call('POST', '/v1/speakeasy/neon/buy', { token: rival.token })).body.error, 'safe', 'no taking over a club from the bunker');
await seed(rival.id, `safe_until = NULL`);
const buyerCashPre = (await meOf(rival.token)).cash, sellerCashPre = (await meOf(owner.token)).cash;
const poolPreBuy = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
const netSale = salePrice - Math.ceil(salePrice * 0.01) * 2;
const buy = await call('POST', '/v1/speakeasy/neon/buy', { token: rival.token });
assert.equal(buy.code, 200, 'the club changes hands');
assert.equal(buy.body.toSeller, netSale, 'the seller nets 98% of the sale');
assert.equal((await meOf(rival.token)).cash, buyerCashPre - salePrice, 'the buyer paid the full price');
const sellerAfter = (await meOf(owner.token)).cash; // net sale + any pending bar take collected at handover (ledgered speakeasy:income)
assert(sellerAfter >= sellerCashPre + netSale && sellerAfter <= sellerCashPre + netSale + 2000, 'the seller got the cut (+ any pending take)');
assert.equal(Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool), poolPreBuy + Math.ceil(salePrice * 0.01), 'the 1% street tax fed the buyback');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM speakeasies WHERE district_id='neon' AND owner_character='${rival.id}'`)).rows[0].n), 1, 'the rival now runs the Neon club');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM speakeasy_patrons WHERE district_id='neon'`)).rows[0].n), 0, 'the guest list reset for the new proprietor');
assert.equal((await meOf(owner.token)).speakeasy, null, 'the seller runs no house now (freed to open/buy elsewhere)');
assert.equal((await call('POST', '/v1/speakeasy/name', { token: owner.token, body: { name: 'x' } })).body.error, 'no_club', 'a seller has no club to name');
board = (await call('GET', '/v1/speakeasy', { token: rival.token })).body;
assert.equal(board.clubs.find((c) => c.district === 'neon').decor, null, 'the decor reverted to stock on sale (an owner-bound style — the new proprietor brings their own; audit LOW-2)');
// the SELLER kept their cosmetic UNLOCK (account-level) — they can decorate a next club
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM store_cosmetics WHERE account_id='${owner.aid}' AND style='deco'`)).rows[0].n), 1, 'the seller keeps the Art Deco unlock after the sale');

// ── STEP FOUR — the STANDOVER (a hostile forced-sale: pay a fee, roll a muscle contest, a win forces a sale) ──
// rival now owns neon (tier 1, The Lounge): the assessed BUILD value = open $750k + tier-1 $600k = $1.35M.
const assessed = 1350000, S_FEE = SPEAKEASY.STANDOVER.FEE;
await seed(bruno.id, `respect=${lvlRespect(20)}, loc='neon'`);
// a fresh challenger can't afford the fee + the forced purchase
assert.equal((await call('POST', '/v1/speakeasy/neon/standover', { token: bruno.token })).body.error, 'cash', 'no standover without the fee + the assessed price on hand');
await grantCash(bruno.id, 2000000);
// a man can't stand over his own house / a non-existent club — and the owner isn't at self (withTwoCharacters)
assert.equal((await call('POST', '/v1/speakeasy/docks/standover', { token: bruno.token })).body.error, 'no_club', 'no club in that district to lean on');
// LOSS (forced roll): the fee BURNS, the owner keeps the club
process.env.SPEAKEASY_STANDOVER_P = '0';
const brunoPreLoss = (await meOf(bruno.token)).cash;
const lose = await call('POST', '/v1/speakeasy/neon/standover', { token: bruno.token });
delete process.env.SPEAKEASY_STANDOVER_P;
assert.equal(lose.body.won, false, 'the standover was repelled');
assert.equal((await meOf(bruno.token)).cash, brunoPreLoss - S_FEE, 'only the fee burned on a loss (speakeasy:standover sink)');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM speakeasies WHERE district_id='neon' AND owner_character='${rival.id}'`)).rows[0].n), 1, 'the rival kept the club');
// the club goes on cooldown after any attempt
assert.equal((await call('POST', '/v1/speakeasy/neon/standover', { token: bruno.token })).body.error, 'cooldown', 'a leaned-on club goes on cooldown');
await pool.query(`UPDATE speakeasies SET standover_cd_until=NULL WHERE district_id='neon'`);
// WIN (forced roll): a forced sale — the owner is PAID the assessed value (taxed), bruno takes the club
process.env.SPEAKEASY_STANDOVER_P = '1';
const brunoPreWin = (await meOf(bruno.token)).cash, rivalPreWin = (await meOf(rival.token)).cash;
const poolPreStandover = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
const netAssessed = assessed - Math.ceil(assessed * 0.01) * 2;
const win = await call('POST', '/v1/speakeasy/neon/standover', { token: bruno.token });
delete process.env.SPEAKEASY_STANDOVER_P;
assert.equal(win.body.won, true, 'the standover landed');
assert.equal(win.body.paid, assessed, 'bruno paid the assessed build value');
assert.equal((await meOf(bruno.token)).cash, brunoPreWin - S_FEE - assessed, 'bruno paid the fee + the assessed price');
assert.equal((await meOf(rival.token)).cash, rivalPreWin + netAssessed, 'the forced-out owner was PAID the assessed value (98%) — a forced SALE, not theft');
assert.equal(Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool), poolPreStandover + Math.ceil(assessed * 0.01), 'the 1% street tax fed the buyback');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM speakeasies WHERE district_id='neon' AND owner_character='${bruno.id}'`)).rows[0].n), 1, 'bruno now runs the Neon club');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM speakeasy_patrons WHERE district_id='neon'`)).rows[0].n), 0, 'the guest list reset for the new proprietor');

// ── §10.4 (mid-life): the per-character cash check reconciles the speakeasy: vocabulary ──
let inv = await runLedgerInvariants(pool);
const cashCheck = inv.checks.find((c) => c.name === 'character cash');
assert.equal(cashCheck.drift, cashDrift, `the only cash drift is the test's unledgered grants (${cashDrift}) — speakeasy: reconciles`);
let vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `speakeasy: rides the §10.4 vocabulary (${JSON.stringify(vocab.unknown || [])})`);
const omrCheck = inv.checks.find((c) => c.name === '$OMR conservation');
assert.equal(omrCheck.drift, omrDrift, `the only $OMR drift is the test grants (${omrDrift}) — bottles/naming reconcile as vanity:% burns`);

// ── DEATH: a dead proprietor's club goes dark (+ its guest list clears). Bruno owns Neon now (he stood over it). ──
await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: bruno.id }, headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM speakeasies WHERE district_id='neon'`)).rows[0].n), 0, "the dead don's club is gone");
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM speakeasy_patrons WHERE district_id='neon'`)).rows[0].n), 0, 'the guest list cleared with it');
board = (await call('GET', '/v1/speakeasy', { token: patron.token })).body;
assert(board.open.includes('neon'), 'the district is open for a new proprietor');
// the cosmetic UNLOCK survives death (account-level) — the seller kept his Art Deco style even after the sale
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM store_cosmetics WHERE account_id='${owner.aid}' AND style='deco'`)).rows[0].n), 1, 'the decor cosmetic survives (account-level, the patron-badge precedent)');

// §10.4 still holds after the estate (the club/guest-list wipe moves no currency)
inv = await runLedgerInvariants(pool);
assert.equal(inv.checks.find((c) => c.name === 'character cash').drift, cashDrift, 'cash §10.4 holds through the estate');
assert(inv.checks.find((c) => c.name === 'reason vocabulary').ok, 'vocabulary still closed');

console.log('✅ The Speakeasy test passed — open gates, the base bar take (lazy income + 24h cap + safehouse gate), the decor ladder, naming (vanity:speakeasy burn + no-op guard), buying a ROUND (two-party taxed patron→owner transfer + guest list + prestige + cooldown/travel/self/jail gates), the REGULAR status, BOTTLE service (a pure $OMR burn) + STEP TWO: the BACK-ROOM TABLE (min/max gates, the owner rake carved from the stake, win/lose, notoriety drawn, travel gate) and the PROHIBITION RAID (a hot club seized + fined + SHUTTERED on collect, the shutter blocking rounds/table/income) + STEP THREE: cross-club RENOWN (derived from patronage + ownership, the leaderboard), the ETH COSMETIC DECOR tier (PLEX-bought unlock + own-gate + apply/clear + survives death), and the P2P BUYOUT (list/not_for_sale/travel gates, a taxed transfer, ownership + guest-list reset, the seller freed, the club keeps its build) + STEP FOUR: renown-EARNED decor (unlocked by renown, not bought) and the STANDOVER (a hostile forced-sale — cash gate, the fee burns win/lose, a loss keeps the club + sets a cooldown, a win forces a taxed sale at the assessed build value + transfers ownership), the nightlife board, DEATH (the club goes dark + guest list clears + district reopens; the cosmetic unlock survives), and §10.4 (the per-character cash check reconciles speakeasy: incl. table:bet/rake/win + raid + buyout + standover; bottles/naming/decor-PLEX ride vanity:%/plex:%)');
await app.close();

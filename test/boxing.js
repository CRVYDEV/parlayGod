// THE FIGHT CIRCUIT test (the 29th suite) — mob boxing. STEP ONE: sign a contender, train, and stake
// them in PvP bouts (the casino:pvp transfer pattern). STEP TWO: THE STABLE (many fighters), NPC
// EXHIBITION bouts (a bounded PvE purse), the world TITLE BELT (PvP, pure status), and the MANAGER
// career LEGEND (lifetime wins, account-level → survives death). Covers the gates, the taxed transfer +
// rake split, the exhibition faucet/sink, the belt claim + vacate-on-death, the legend, DEATH, and §10.4.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { BOXING, UNDERWORLD, PACING } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { sweepMainEvents, enforceBeltDefense } from '../src/boxing.js';

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
let cashDrift = 0;
const grantCash = async (id, n) => { await pool.query(`UPDATE characters SET cash = cash + ${n} WHERE id='${id}'`); cashDrift += n; };
const lvlRespect = (lvl) => PACING.LEVEL_DIVISOR * (lvl - 1) * (lvl - 1); // reads the live curve, not a copy
const boxingWins = async (aid) => Number((await pool.query(`SELECT boxing_wins w FROM account_persistent WHERE account_id='${aid}'`)).rows[0].w);

const aa = await mk('Don King');        // manager of the strong stable (the challenger)
const bb = await mk('Bob Arum');         // manager of the weak fighter (takes bouts)
const lowbie = await mk('Ringside Kid'); // for the level gate

// ── RECRUIT: level-gated, cash sink, THE STABLE (up to STABLE_MAX) ──
assert.equal((await call('POST', '/v1/boxing/recruit', { token: lowbie.token, body: { name: 'Palooka' } })).body.error, 'level', 'a nobody cannot sign a fighter');
await seed(aa.id, `respect=${lvlRespect(12)}`); await seed(bb.id, `respect=${lvlRespect(12)}`);
assert.equal((await call('POST', '/v1/boxing/recruit', { token: aa.token, body: { name: 'x' } })).body.error, 'name', 'a fighter needs a real name');
assert.equal((await call('POST', '/v1/boxing/recruit', { token: aa.token, body: { name: 'The Bull' } })).body.error, 'cash', "can't sign a fighter broke");
await grantCash(aa.id, 5000000); await grantCash(bb.id, 3000000);
const sign = await call('POST', '/v1/boxing/recruit', { token: aa.token, body: { name: 'The Bull' } });
assert.equal(sign.code, 200, 'the boss signs a contender'); assert.equal(sign.body.stable, 1, 'stable of one');
const bull = sign.body.id;
assert(sign.body.power >= BOXING.STAT_MIN && sign.body.power <= BOXING.STAT_MAX, 'stats rolled in range');
assert.equal((await meOf(aa.token)).cash, 5000500 - BOXING.RECRUIT_COST, 'the signing bonus left the pocket (ledgered boxing:recruit)');
// fill the stable, then overflow
await call('POST', '/v1/boxing/recruit', { token: aa.token, body: { name: 'Sugar Ray' } });
await call('POST', '/v1/boxing/recruit', { token: aa.token, body: { name: 'Kid Gloves' } });
assert.equal((await call('POST', '/v1/boxing/recruit', { token: aa.token, body: { name: 'Overflow' } })).body.error, 'stable_full', `a stable holds ${BOXING.STABLE_MAX}`);
assert.equal((await meOf(aa.token)).fighters.length, BOXING.STABLE_MAX, 'the sheet shows the whole stable');
const p = await call('POST', '/v1/boxing/recruit', { token: bb.token, body: { name: 'The Palooka' } });
const palooka = p.body.id;

// ── TRAIN by fighter id: bad-stat / energy / cap gates + the sink ──
assert.equal((await call('POST', '/v1/boxing/train', { token: aa.token, body: { fighter: bull, stat: 'jab' } })).body.error, 'bad_stat', 'train a real stat');
await seed(aa.id, `energy=5`);
assert.equal((await call('POST', '/v1/boxing/train', { token: aa.token, body: { fighter: bull, stat: 'power' } })).body.error, 'energy', 'training takes energy');
await seed(aa.id, `energy=200`);
const trainCashPre = (await meOf(aa.token)).cash;
assert.equal((await call('POST', '/v1/boxing/train', { token: aa.token, body: { fighter: bull, stat: 'power' } })).code, 200, 'a training session');
assert.equal((await meOf(aa.token)).cash, trainCashPre - BOXING.TRAIN_COST, 'the session cost left the pocket (ledgered boxing:train)');
assert.equal((await call('POST', '/v1/boxing/train', { token: aa.token, body: { fighter: palooka, stat: 'power' } })).body.error, 'no_fighter', "you can't train someone else's fighter");

// deterministic mismatch: The Bull (maxed, form 75) always beats a form-18/26 opponent
await pool.query(`UPDATE fighters SET power=25, chin=25, speed=25 WHERE id='${bull}'`);
await pool.query(`UPDATE fighters SET power=6, chin=6, speed=6 WHERE id='${palooka}'`);

// ── NPC EXHIBITION: a bounded PvE purse (fee burns, purse only on a win) + a per-fighter cooldown ──
assert.equal((await call('POST', '/v1/boxing/exhibition', { token: aa.token, body: { fighter: bull, tier: 'nope' } })).body.error, 'bad_tier', 'no such card');
const tier = BOXING.NPC_TIERS[0];
const exPre = (await meOf(aa.token)).cash;
const ex = await call('POST', '/v1/boxing/exhibition', { token: aa.token, body: { fighter: bull, tier: tier.id } });
assert.equal(ex.code, 200, 'the exhibition is made'); assert.equal(ex.body.win, true, 'the maxed fighter beats the club card');
assert.equal(ex.body.net, tier.purse - tier.fee, 'net = purse − sanction fee');
assert.equal((await meOf(aa.token)).cash, exPre + tier.purse - tier.fee, 'the purse (faucet) − fee (sink) landed in pocket');
assert.equal(await boxingWins(aa.aid), 1, 'the exhibition win banked a career win (the legend, account-level)');
assert.equal((await call('POST', '/v1/boxing/exhibition', { token: aa.token, body: { fighter: bull, tier: tier.id } })).body.error, 'cooldown', 'a fighter rests between exhibitions');

// ── LIST + PvP FIGHT (belt) ──
assert.equal((await call('POST', '/v1/boxing/list', { token: bb.token, body: { fighter: palooka, stake: 100 } })).body.error, 'stake', 'below the minimum stake');
await call('POST', '/v1/boxing/list', { token: bb.token, body: { fighter: palooka, stake: 50000 } });
assert.equal((await call('POST', `/v1/boxing/fight/${bb.id}`, { token: lowbie.token, body: { myFighter: bull, theirFighter: palooka, stake: 10000 } })).body.error, 'no_fighter', "you can't fight with someone else's fighter");
assert.equal((await call('POST', `/v1/boxing/fight/${aa.id}`, { token: aa.token, body: { myFighter: bull, theirFighter: bull, stake: 10000 } })).body.error, 'self', "you don't fight your own stable");
assert.equal((await call('POST', `/v1/boxing/fight/${bb.id}`, { token: aa.token, body: { myFighter: bull, theirFighter: palooka, stake: 999999 } })).body.error, 'limit', 'over the opponent limit');

const stake = 10000, pot = stake * 2, rake = Math.ceil(pot * BOXING.RAKE_BPS / 10000);
const aPre = (await meOf(aa.token)).cash, bPre = (await meOf(bb.token)).cash;
const poolPre = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
const bout = await call('POST', `/v1/boxing/fight/${bb.id}`, { token: aa.token, body: { myFighter: bull, theirFighter: palooka, stake } });
assert.equal(bout.body.win, true, 'the stronger fighter wins (form 75 vs 18 — a lock)');
assert.equal(bout.body.belt, true, 'the winner CLAIMS the vacant world title');
assert.equal((await meOf(aa.token)).cash, aPre + stake - rake, 'the winner took the purse minus the vig');
assert.equal((await meOf(bb.token)).cash, bPre - stake, 'the loser paid the purse');
assert.equal(Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool), poolPre + Math.floor(rake / 2), 'half the vig fed the buyback (half burns)');
assert.equal(await boxingWins(aa.aid), 2, 'the bout win banked a second career win');
const bF = (await pool.query(`SELECT wins, losses, injured_until FROM fighters WHERE id='${palooka}'`)).rows[0];
assert(Number(bF.losses) === 1 && bF.injured_until && new Date(bF.injured_until) > new Date(), 'the losing fighter took the L + is laid up');

// ── the board (belt + stable) + the leaderboard (records + LEGEND) ──
const board = (await call('GET', '/v1/boxing', { token: aa.token })).body;
assert.equal(board.champion.fighter, 'The Bull', 'The Bull holds the world title');
assert(board.stable.find((f) => f.id === bull).belt === true, 'the belt chip is on the champion');
const lb = (await call('GET', '/v1/leaderboard/boxing', { token: aa.token })).body;
assert(lb.fighters[0] && lb.fighters[0].fighter === 'The Bull' && lb.fighters[0].belt, 'The Bull tops the circuit board with the belt');
assert(lb.legend.find((m) => m.manager === 'Don King' && m.wins === 2), 'the manager legend ranks Don King by career wins');

// ── §10.4 (mid-life): the per-character cash check reconciles boxing: incl. the exhibition faucet ──
let inv = await runLedgerInvariants(pool, { alert: false });
assert.equal(inv.checks.find((c) => c.name === 'character cash').drift, cashDrift, `the only cash drift is the test grants (${cashDrift}) — boxing: (bout/purse/fee/train/recruit) all reconcile`);
assert(inv.checks.find((c) => c.name === 'reason vocabulary').ok, 'boxing: rides the §10.4 vocabulary');

// ══ STEP THREE — THE MAIN EVENT (spectator parimutuel betting) ══
const cc = await mk('Promoter Cus');    // headlines the card (the challenger)
const dd = await mk('Angelo Dundee');   // takes the card (lists a fighter)
await seed(cc.id, `respect=${lvlRespect(12)}`); await seed(dd.id, `respect=${lvlRespect(12)}`);
await grantCash(cc.id, 2000000); await grantCash(dd.id, 2000000);
const goliath = (await call('POST', '/v1/boxing/recruit', { token: cc.token, body: { name: 'Goliath' } })).body.id;
const david = (await call('POST', '/v1/boxing/recruit', { token: dd.token, body: { name: 'David' } })).body.id;
await pool.query(`UPDATE fighters SET power=25,chin=25,speed=25 WHERE id='${goliath}'`); // form 75
await pool.query(`UPDATE fighters SET power=6,chin=6,speed=6 WHERE id='${david}'`);        // form 18 — Goliath is a lock
// announce gates: the opponent's fighter must be LISTED (consent-by-listing)
assert.equal((await call('POST', `/v1/boxing/announce/${dd.id}`, { token: cc.token, body: { myFighter: goliath, theirFighter: david } })).body.error, 'not_listed', 'the opponent fighter must be taking bouts');
await call('POST', '/v1/boxing/list', { token: dd.token, body: { fighter: david, stake: 50000 } });
assert.equal((await call('POST', `/v1/boxing/announce/${dd.id}`, { token: cc.token, body: { myFighter: david, theirFighter: goliath } })).body.error, 'no_fighter', "you can only headline your OWN fighter");
const ann = await call('POST', `/v1/boxing/announce/${dd.id}`, { token: cc.token, body: { myFighter: goliath, theirFighter: david } });
assert.equal(ann.code, 200, 'the main event is booked'); const boutId = ann.body.bout;
assert.equal((await call('POST', `/v1/boxing/announce/${dd.id}`, { token: cc.token, body: { myFighter: goliath, theirFighter: david } })).body.error, 'booked_self', 'a booked fighter is on a card already');
// a booked fighter's form is FROZEN — no training / fighting / exhibitions while the crowd bets
assert.equal((await call('POST', '/v1/boxing/train', { token: cc.token, body: { fighter: goliath, stat: 'power' } })).body.error, 'booked', "can't change a booked fighter's form");
assert.equal((await call('POST', '/v1/boxing/exhibition', { token: cc.token, body: { fighter: goliath, tier: BOXING.NPC_TIERS[0].id } })).body.error, 'booked', "a booked fighter can't take an exhibition");

// the crowd bets (CASH escrow → the pot)
const bet1 = await mk('Bettor One'); const bet2 = await mk('Bettor Two'); const bet3 = await mk('Bettor Three'); const late = await mk('Latecomer');
for (const b of [bet1, bet2, bet3, late]) await grantCash(b.id, 500000);
assert.equal((await call('POST', `/v1/boxing/bout/${boutId}/bet`, { token: cc.token, body: { fighter: goliath, amount: 10000 } })).body.error, 'own_event', "a principal can't bet their own card");
assert.equal((await call('POST', `/v1/boxing/bout/${boutId}/bet`, { token: bet1.token, body: { fighter: 'nope', amount: 10000 } })).body.error, 'bad_fighter', 'bet on one of the two fighters');
assert.equal((await call('POST', `/v1/boxing/bout/${boutId}/bet`, { token: bet1.token, body: { fighter: goliath, amount: 1 } })).body.error, 'amount', 'a bet has a floor');
const winBet1 = 20000, winBet2 = 30000, loseBet = 40000;
assert.equal((await call('POST', `/v1/boxing/bout/${boutId}/bet`, { token: bet1.token, body: { fighter: goliath, amount: winBet1 } })).code, 200, 'bettor 1 backs Goliath');
assert.equal((await call('POST', `/v1/boxing/bout/${boutId}/bet`, { token: bet2.token, body: { fighter: goliath, amount: winBet2 } })).code, 200, 'bettor 2 backs Goliath');
assert.equal((await call('POST', `/v1/boxing/bout/${boutId}/bet`, { token: bet3.token, body: { fighter: david, amount: loseBet } })).code, 200, 'bettor 3 backs David');
assert.equal((await call('POST', `/v1/boxing/bout/${boutId}/bet`, { token: bet1.token, body: { fighter: goliath, amount: 5000 } })).body.error, 'already_bet', 'one bet per card per bettor');
assert.equal((await meOf(bet1.token)).cash, 500500 - winBet1, "the bettor's stake is escrowed out of pocket");
// the board shows the open card + the live parimutuel pools
const meBoard = (await call('GET', '/v1/boxing', { token: bet1.token })).body;
const card = meBoard.mainEvents.find((m) => m.id === boutId);
assert(card && card.a.pool + card.b.pool === winBet1 + winBet2 + loseBet, 'the board shows the live pools');
assert.equal(card.yourBet.amount, winBet1, 'the board shows your own bet');
// §10.4 escrow reconciles mid-window (bets are transfers into the pot)
let inv2 = await runLedgerInvariants(pool, { alert: false });
const esc = (i) => i.checks.find((c) => c.name === 'boxing bet escrow');
assert(esc(inv2).ok && esc(inv2).lhs === winBet1 + winBet2 + loseBet, 'escrow == the sum of live bets');
assert.equal(inv2.checks.find((c) => c.name === 'character cash').drift, cashDrift, 'per-character cash still reconciles with escrowed bets');

// close the window (SQL clock warp — the worker-sweep test pattern), then resolve via the worker
await pool.query(`UPDATE boxing_bouts SET resolves_at = now() - interval '1 hour' WHERE id='${boutId}'`);
assert.equal((await call('POST', `/v1/boxing/bout/${boutId}/bet`, { token: late.token, body: { fighter: goliath, amount: 10000 } })).body.error, 'closed', 'betting closes at the bell');
// (R34 regression) resolution reads the form SNAPSHOTTED at booking, NOT live stats — so a manager can't
// train a booked fighter up in the betting-close→worker-settle gap to rig the parimutuel. Confirm the
// snapshot was stored, then make weak David a live MONSTER: if resolve read live form he'd crush Goliath
// and every payout assertion below would flip; the snapshot keeps Goliath (75) the winner. Restore after.
const snap = (await pool.query(`SELECT a_form, b_form FROM boxing_bouts WHERE id='${boutId}'`)).rows[0];
assert.equal(Number(snap.a_form), 75, 'Goliath form snapshotted at booking');
assert.equal(Number(snap.b_form), 18, 'David form snapshotted at booking');
const davidLive = (await pool.query(`SELECT power, chin, speed FROM fighters WHERE id='${david}'`)).rows[0];
await pool.query(`UPDATE fighters SET power=900, chin=900, speed=900 WHERE id='${david}'`); // "trains up" AFTER the bell
const ccPre = (await meOf(cc.token)).cash, taxPre = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
const swept = await sweepMainEvents(pool);
assert.equal(swept.resolved, 1, 'the worker resolved the card');
// Goliath won (form 75 v 18): bettors 1+2 split the losing pot net of vig; bettor 3 lost their stake
const betRake = Math.floor(loseBet * BOXING.BET_RAKE_BPS / 10000), purse = Math.floor(betRake / 2), houseCut = betRake - purse;
const distributable = loseBet - betRake, totalWin = winBet1 + winBet2;
const share1 = Math.floor(distributable * winBet1 / totalWin), share2 = distributable - share1; // bet2 (last) mops up the remainder
assert.equal((await meOf(bet1.token)).cash, 500500 + share1, 'winner 1: stake back + pro-rata cut of the losers');
assert.equal((await meOf(bet2.token)).cash, 500500 + share2, 'winner 2: stake back + pro-rata cut');
assert.equal((await meOf(bet3.token)).cash, 500500 - loseBet, 'the loser lost their stake to the pot');
assert.equal((await meOf(cc.token)).cash, ccPre + purse, 'the winning manager banked the promoter purse (from the vig)');
assert.equal(Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool), taxPre + Math.floor(houseCut / 2), 'half the house vig fed the buyback (half burns)');
assert.equal(Number((await pool.query(`SELECT wins FROM fighters WHERE id='${goliath}'`)).rows[0].wins), 1, 'Goliath banked the win');
assert.equal(await boxingWins(cc.aid), 1, 'the manager legend banked the main-event win');
assert.equal((await pool.query(`SELECT booked_until FROM fighters WHERE id='${goliath}'`)).rows[0].booked_until, null, 'the fighters are unbooked after the bell');
// (R34) Goliath still won despite David's post-bell live stats being maxed — the snapshot defeated the rig. Restore David.
await pool.query(`UPDATE fighters SET power=${davidLive.power}, chin=${davidLive.chin}, speed=${davidLive.speed} WHERE id='${david}'`);
let inv3 = await runLedgerInvariants(pool, { alert: false });
assert(esc(inv3).ok && esc(inv3).lhs === 0, 'the escrow empties after resolution');
assert.equal(inv3.checks.find((c) => c.name === 'character cash').drift, cashDrift, 'per-character cash reconciles after payout (bets/wins/purse are transfers)');

// ── (red-team R18) the manager LEGEND is anti-Sybil: a win over a SUB-LEVEL-10 loser banks NO boxing_wins ──
const sybW = await mk('Legit Champ'); await seed(sybW.id, `respect=${lvlRespect(12)}`); await grantCash(sybW.id, 2000000);
const sybL = await mk('Alt Bum'); await seed(sybL.id, `respect=${lvlRespect(9)}`); await grantCash(sybL.id, 2000000); // level 9 < LEGEND_MIN_LVL (10)
const sybWF = (await call('POST', '/v1/boxing/recruit', { token: sybW.token, body: { name: 'Real McCoy' } })).body.id;
const sybLF = (await call('POST', '/v1/boxing/recruit', { token: sybL.token, body: { name: 'The Stiff' } })).body.id;
await pool.query(`UPDATE fighters SET power=14,chin=14,speed=14 WHERE id='${sybWF}'`);
await pool.query(`UPDATE fighters SET power=6,chin=6,speed=6 WHERE id='${sybLF}'`);
await call('POST', '/v1/boxing/list', { token: sybL.token, body: { fighter: sybLF, stake: 5000 } });
assert.equal(await boxingWins(sybW.aid), 0, 'the legit champ has no career wins yet');
const sybBout = await call('POST', `/v1/boxing/fight/${sybL.id}`, { token: sybW.token, body: { myFighter: sybWF, theirFighter: sybLF, stake: 5000 } });
assert.equal(sybBout.body.win, true, 'the leveled fighter wins the bout (form 42 vs 18)');
assert.equal(await boxingWins(sybW.aid), 0, 'a win over a SUB-LEVEL-10 loser banks NO manager legend (the races/stable anti-Sybil floor)');

// ── DEATH CANCELS a booked card + refunds the crowd (dead principal) ──
const ee = await mk('Doomed Don'); await seed(ee.id, `respect=${lvlRespect(12)}`); await grantCash(ee.id, 2000000);
const chump = (await call('POST', '/v1/boxing/recruit', { token: ee.token, body: { name: 'Chump' } })).body.id;
await pool.query(`UPDATE fighters SET power=10,chin=10,speed=10 WHERE id='${chump}'`);
await call('POST', '/v1/boxing/list', { token: ee.token, body: { fighter: chump, stake: 50000 } });
const bout2 = (await call('POST', `/v1/boxing/announce/${ee.id}`, { token: cc.token, body: { myFighter: goliath, theirFighter: chump } })).body.bout;
await call('POST', `/v1/boxing/bout/${bout2}/bet`, { token: bet1.token, body: { fighter: goliath, amount: 15000 } });
const bet1Pre = (await meOf(bet1.token)).cash;
await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: ee.id }, headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal((await pool.query(`SELECT status FROM boxing_bouts WHERE id='${bout2}'`)).rows[0].status, 'cancelled', "a dead principal's card is cancelled");
assert.equal((await meOf(bet1.token)).cash, bet1Pre + 15000, 'the crowd is refunded when the card is cancelled');
assert.equal((await pool.query(`SELECT booked_until FROM fighters WHERE id='${goliath}'`)).rows[0].booked_until, null, 'the surviving fighter is freed');
let inv4 = await runLedgerInvariants(pool, { alert: false });
assert(esc(inv4).ok && esc(inv4).lhs === 0, 'escrow reconciles through the death-cancel');
assert.equal(inv4.checks.find((c) => c.name === 'character cash').drift, cashDrift, 'per-character cash reconciles through the cancel');

// ══ STEP FOUR — THE CORNERMAN (Underworld) + BELT DEFENSE ══
// (A) THE CORNERMAN — training discount (T1) + build bonus (T3). aa earned some standing from earlier
// boxing actions (the row exists); force a known tier.
const sugar = (await pool.query(`SELECT id FROM fighters WHERE character_id='${aa.id}' AND name='Sugar Ray'`)).rows[0];
await pool.query(`UPDATE fighters SET power=10 WHERE id='${sugar.id}'`);
await seed(aa.id, `energy=200`); await grantCash(aa.id, 1000000);
await pool.query(`UPDATE npc_standing SET standing=30, touched_at=now() WHERE character_id='${aa.id}' AND npc_id='cornerman'`); // tier 1
const t1Pre = (await meOf(aa.token)).cash;
const t1 = await call('POST', '/v1/boxing/train', { token: aa.token, body: { fighter: sugar.id, stat: 'power' } });
assert.equal(t1.code, 200, 'cornerman-discounted training session');
assert.equal((await meOf(aa.token)).cash, t1Pre - Math.round(BOXING.TRAIN_COST * UNDERWORLD.FX.CORNER_TRAIN_MULT), 'Mickey the Corner discounts the session (train ×0.9), the discounted number ledgered');
assert.equal(t1.body.value, 11, 'tier 1 still builds +1 (10 → 11)');
await pool.query(`UPDATE npc_standing SET standing=90, touched_at=now() WHERE character_id='${aa.id}' AND npc_id='cornerman'`); // tier 3
const t3 = await call('POST', '/v1/boxing/train', { token: aa.token, body: { fighter: sugar.id, stat: 'power' } });
assert.equal(t3.body.value, 13, 'tier 3 builds +2 a session (11 → 13)');
// (B) BELT DEFENSE — The Bull holds the belt; a win while champ is a DEFENSE (reign++); an inactive champ is STRIPPED
await pool.query(`UPDATE fighters SET injured_until=NULL WHERE id='${palooka}'`); // heal for a rematch
await call('POST', '/v1/boxing/list', { token: bb.token, body: { fighter: palooka, stake: 50000 } });
await seed(aa.id, `energy=200`); await grantCash(aa.id, 100000); await grantCash(bb.id, 100000);
const def = await call('POST', `/v1/boxing/fight/${bb.id}`, { token: aa.token, body: { myFighter: bull, theirFighter: palooka, stake: 10000 } });
assert.equal(def.body.win, true, 'the champion wins the rematch');
assert.equal(def.body.defended, true, 'a win while HOLDING the belt is a DEFENSE (not a new title)');
assert.equal(def.body.belt, false, 'the champ keeps — no new coronation');
const champ = (await call('GET', '/v1/boxing', { token: aa.token })).body.champion;
assert.equal(champ.defenses, 1, 'the reign counts one title defense');
assert(champ.defendSeconds > 0 && champ.contender, 'the mandatory-defense clock ticks + a #1 contender is surfaced');
// an inactive champ is stripped by the worker (warp the defense clock into the past)
await pool.query(`UPDATE boxing_title SET last_defense = now() - interval '30 days', since = now() - interval '30 days' WHERE id=1`);
const strip = await enforceBeltDefense(pool);
assert.equal(strip.stripped, true, 'the inactive champion forfeits the belt');
assert.equal((await pool.query('SELECT holder_fighter FROM boxing_title WHERE id=1')).rows[0].holder_fighter, null, 'the belt goes vacant');
// (C) the cornerman's weekly FAVOR — patch up the whole stable (heals injuries)
await pool.query(`UPDATE npc_standing SET standing=90, touched_at=now() WHERE character_id='${aa.id}' AND npc_id='cornerman'`);
await pool.query(`UPDATE fighters SET injured_until = now() + interval '2 hours' WHERE id='${sugar.id}'`);
const fav = await call('POST', '/v1/underworld/cornerman/favor', { token: aa.token });
assert.equal(fav.code, 200, 'the corner does a favor for the inner circle'); assert.equal(fav.body.healedFighters, 1, 'one laid-up fighter patched up');
assert.equal((await pool.query(`SELECT injured_until FROM fighters WHERE id='${sugar.id}'`)).rows[0].injured_until, null, 'the fighter is off the injured list');
// re-crown The Bull so the callout + DEATH belt tests below stay meaningful (the strip above left it vacant)
await pool.query(`UPDATE boxing_title SET holder_fighter='${bull}', holder_char='${aa.id}', holder_name='The Bull', since=now(), last_defense=now(), defenses=0 WHERE id=1`);

// ══ STEP FIVE — THE CALLOUT (the mandatory #1-contender challenge) ══
// The Bull (aa) holds the belt; Goliath (cc, 1 win from the step-three main event) is the #1 contender.
assert.equal((await call('POST', `/v1/boxing/callout/${bull}`, { token: aa.token })).body.error, 'self', "the champ can't call themselves out");
assert.equal((await call('POST', `/v1/boxing/callout/${palooka}`, { token: bb.token })).body.error, 'not_contender', 'only the #1 contender can call out the champ');
const co = await call('POST', `/v1/boxing/callout/${goliath}`, { token: cc.token });
assert.equal(co.code, 200, 'the #1 contender calls out the champ'); assert.equal(co.body.champion, 'The Bull', 'the callout names the champ');
assert.equal((await call('POST', `/v1/boxing/callout/${goliath}`, { token: cc.token })).body.error, 'callout_exists', 'one callout at a time');
let champB = (await call('GET', '/v1/boxing', { token: aa.token })).body.champion;
assert(champB.callout && champB.callout.challenger === 'Goliath' && champB.callout.deadlineSeconds > 0, 'the board shows the pending callout + the accept clock');
// (A) DUCK IT — the champ ignores the mandatory challenge past the deadline → the belt forfeits to the challenger
await pool.query(`UPDATE boxing_title SET callout_deadline = now() - interval '1 hour' WHERE id=1`);
const duck = await enforceBeltDefense(pool);
assert.equal(duck.ducked, true, 'a ducked callout forfeits the belt');
assert.equal(duck.newChampion, 'Goliath', 'the challenger is crowned — you can\'t duck the #1 contender');
assert.equal((await pool.query('SELECT holder_char FROM boxing_title WHERE id=1')).rows[0].holder_char, cc.id, 'Goliath\'s manager is the new champion');
// (B) ACCEPT IT — re-crown The Bull, call out again, the champ accepts → a TITLE main event is booked
await pool.query(`UPDATE boxing_title SET holder_fighter='${bull}', holder_char='${aa.id}', holder_name='The Bull', since=now(), last_defense=now(), defenses=0, callout_fighter=NULL, callout_char=NULL, callout_deadline=NULL WHERE id=1`);
await pool.query(`UPDATE fighters SET injured_until=NULL, booked_until=NULL WHERE id='${goliath}'`); // Goliath ready to challenge
await call('POST', `/v1/boxing/callout/${goliath}`, { token: cc.token });
assert.equal((await call('POST', '/v1/boxing/callout/accept', { token: cc.token })).body.error, 'not_champ', 'only the champion can accept');
const acc = await call('POST', '/v1/boxing/callout/accept', { token: aa.token });
assert.equal(acc.code, 200, 'the champ accepts the challenge'); assert.equal(acc.body.title, true, 'it books a TITLE main event');
const titleBout = acc.body.bout;
assert.equal((await pool.query('SELECT callout_fighter FROM boxing_title WHERE id=1')).rows[0].callout_fighter, null, 'the callout is consumed into the booked card');
const meBout = (await call('GET', '/v1/boxing', { token: cc.token })).body.mainEvents.find((m) => m.id === titleBout);
assert(meBout && meBout.title === true, 'the board flags it as a title fight (the belt is on the line)');
assert(Number((await pool.query(`SELECT COUNT(*) n FROM fighters WHERE id IN ('${bull}','${goliath}') AND booked_until > now()`)).rows[0].n) === 2, 'both fighters are locked into the card');

// ── DEATH: a dead manager's whole STABLE is done + the belt VACATES; the career legend SURVIVES ──
await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: aa.id }, headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM fighters WHERE character_id='${aa.id}'`)).rows[0].n), 0, "the dead manager's stable is gone");
assert.equal((await pool.query('SELECT holder_fighter FROM boxing_title WHERE id=1')).rows[0].holder_fighter, null, 'the belt is vacated when the champion dies');
assert.equal(await boxingWins(aa.aid), 3, 'the career legend (account-level) SURVIVES death — the heir keeps it (exhibition + bout + belt defense)');
inv = await runLedgerInvariants(pool, { alert: false });
assert.equal(inv.checks.find((c) => c.name === 'character cash').drift, cashDrift, 'cash §10.4 holds through the estate');

console.log('✅ The Fight Circuit test passed — recruit/THE STABLE (level/name/cash gates + cap at STABLE_MAX + rolled stats), train-by-id (gates + sink + ownership), the NPC EXHIBITION (bad-tier gate, fee-sink + purse-faucet on a win, the career-win bank, the per-fighter cooldown), the PvP BOUT (ownership/self/limit gates, the taxed transfer + rake split half→buyback, records + injury), THE TITLE BELT (claimed vacant, chip on the board, vacated on the champion\'s death), the MANAGER LEGEND (lifetime wins, leaderboard, SURVIVES death), STEP THREE — THE MAIN EVENT (announce gates + consent-by-listing, booked-form freeze, CASH parimutuel betting with escrow + gates, the worker resolution: winners split the losers net of vig / the promoter purse / half-vig→buyback / the manager legend, the board pools, DEATH cancels a booked card + refunds the crowd, and the boxing-bet-escrow §10.4 check), STEP FOUR — THE CORNERMAN (Underworld fixture — training ×0.9 cash at tier 1, +2 build at tier 3, the weekly stable patch-up favor) + BELT DEFENSE (a win while holding the belt is a DEFENSE that grows the reign; the mandatory-defense clock + #1 contender on the board; an inactive champion is STRIPPED by the worker), STEP FIVE — THE CALLOUT (only the #1 contender can call out the champ, self/not-contender/one-at-a-time gates, the board shows the pending challenge + accept clock; DUCK IT → the belt forfeits straight to the challenger; ACCEPT IT → a TITLE main event is booked, the callout consumed, both fighters locked, the board flags the title fight), the board + leaderboard, DEATH (the stable dies with the street), and §10.4 (per-character cash reconciles boxing: incl. the exhibition faucet)');
await app.close();

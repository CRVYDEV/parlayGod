// THE STABLE test (the 33rd suite) — own the dogs & the ponies. The boxing-stable pattern applied to
// racing animals: BUY (cash sink, level-gated, dog/horse), TRAIN (cash+energy, capped), the PvE CIRCUIT
// (fee burns, purse only on a win — a bounded faucet), and a PvP MATCH RACE (the casino:pvp taxed
// transfer). Covers the gates, the sink/faucet, the taxed transfer + rake split, same-kind-only, the
// owner LEGEND (survives death), DEATH (the stable is wiped), and the §10.4 per-character reconcile.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { STABLE } from '../src/rules.js';
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
let cashDrift = 0;
const grantCash = async (id, n) => { await pool.query(`UPDATE characters SET cash = cash + ${n} WHERE id='${id}'`); cashDrift += n; };
const lvlRespect = (lvl) => 4 * (lvl - 1) * (lvl - 1);
const racerWins = async (aid) => Number((await pool.query(`SELECT racer_wins w FROM account_persistent WHERE account_id='${aid}'`)).rows[0].w);

const aa = await mk('Diamond Jim');   // the strong stable (dogs + horses)
const bb = await mk('Lucky Luciano');  // takes match races
const lowbie = await mk('Stable Boy');  // the level gate

// ── BUY: level-gated, kind, name, cash, stable-full ──
assert.equal((await call('POST', '/v1/stable/buy', { token: lowbie.token, body: { kind: 'dog', name: 'Rex' } })).body.error, 'level', 'a nobody cannot own a racer');
await seed(aa.id, `respect=${lvlRespect(10)}`); await seed(bb.id, `respect=${lvlRespect(10)}`);
assert.equal((await call('POST', '/v1/stable/buy', { token: aa.token, body: { kind: 'cat', name: 'Whiskers' } })).body.error, 'kind', "a dog or a horse, not a cat");
assert.equal((await call('POST', '/v1/stable/buy', { token: aa.token, body: { kind: 'dog', name: 'x' } })).body.error, 'name', 'a racer needs a real name');
assert.equal((await call('POST', '/v1/stable/buy', { token: aa.token, body: { kind: 'dog', name: 'Grey Ghost' } })).body.error, 'cash', "can't buy a racer broke");
await grantCash(aa.id, 8000000); await grantCash(bb.id, 4000000);
const buy = await call('POST', '/v1/stable/buy', { token: aa.token, body: { kind: 'dog', name: 'Grey Ghost' } });
assert.equal(buy.code, 200, 'buys a greyhound'); assert.equal(buy.body.stable, 1, 'stable of one');
const ghost = buy.body.id;
assert(buy.body.speed >= STABLE.KINDS.dog.statMin && buy.body.speed <= STABLE.KINDS.dog.statMax, 'stats rolled in the dog range');
assert.equal((await meOf(aa.token)).cash, 8000500 - STABLE.KINDS.dog.cost, 'the price left the pocket (ledgered stable:buy)');
// fill the stable (a horse + two more dogs), then overflow
const pony = (await call('POST', '/v1/stable/buy', { token: aa.token, body: { kind: 'horse', name: 'War Admiral' } })).body.id;
await call('POST', '/v1/stable/buy', { token: aa.token, body: { kind: 'dog', name: 'Blue Streak' } });
await call('POST', '/v1/stable/buy', { token: aa.token, body: { kind: 'dog', name: 'Iron Jaw' } });
assert.equal((await call('POST', '/v1/stable/buy', { token: aa.token, body: { kind: 'dog', name: 'Overflow' } })).body.error, 'stable_full', `a stable holds ${STABLE.STABLE_MAX}`);

// ── TRAIN by racer id: bad-stat / energy / cap / ownership gates + the sink ──
assert.equal((await call('POST', `/v1/stable/train/${ghost}`, { token: aa.token, body: { stat: 'jaw' } })).body.error, 'bad_stat', 'train a real stat');
await seed(aa.id, 'energy=5');
assert.equal((await call('POST', `/v1/stable/train/${ghost}`, { token: aa.token, body: { stat: 'speed' } })).body.error, 'energy', 'training takes energy');
await seed(aa.id, 'energy=200');
const trainPre = (await meOf(aa.token)).cash;
assert.equal((await call('POST', `/v1/stable/train/${ghost}`, { token: aa.token, body: { stat: 'speed' } })).code, 200, 'a training session');
assert.equal((await meOf(aa.token)).cash, trainPre - STABLE.TRAIN_COST, 'the session cost left the pocket (ledgered stable:train)');
assert.equal((await call('POST', `/v1/stable/train/${pony}`, { token: bb.token, body: { stat: 'speed' } })).body.error, 'no_racer', "you can't train someone else's racer");

// ── THE CIRCUIT: a bounded PvE purse (fee burns, purse only on a win) + a per-racer cooldown ──
// deterministic WIN: max the dog (form 75) vs the maiden (form 24) — the gap beats VARIANCE
await pool.query(`UPDATE racers SET speed=25, stamina=25, heart=25 WHERE id='${ghost}'`);
assert.equal((await call('POST', `/v1/stable/circuit/${ghost}`, { token: aa.token, body: { meet: 'nope' } })).body.error, 'bad_meet', 'no such meet');
const maiden = STABLE.MEETS.dog[0];
const cPre = (await meOf(aa.token)).cash;
const circ = await call('POST', `/v1/stable/circuit/${ghost}`, { token: aa.token, body: { meet: maiden.id } });
assert.equal(circ.code, 200, 'the dog runs the maiden'); assert.equal(circ.body.win, true, 'the maxed dog wins');
assert.equal(circ.body.net, maiden.purse - maiden.fee, 'net = purse − entry fee');
assert.equal((await meOf(aa.token)).cash, cPre + maiden.purse - maiden.fee, 'the purse (faucet) − fee (sink) landed');
assert.equal(await racerWins(aa.aid), 1, 'the circuit win banked a career win (the legend, account-level)');
assert.equal((await call('POST', `/v1/stable/circuit/${ghost}`, { token: aa.token, body: { meet: maiden.id } })).body.error, 'cooldown', 'a racer rests between races');
// a LOSS: a weak dog vs the top meet (form 60) — a lock the other way; the fee still burns, the dog is laid up
await pool.query(`UPDATE racers SET speed=6, stamina=6, heart=6, circuit_at=NULL WHERE id='${ghost}'`);
const derby = STABLE.MEETS.dog[2];
const lPre = (await meOf(aa.token)).cash;
const loss = await call('POST', `/v1/stable/circuit/${ghost}`, { token: aa.token, body: { meet: derby.id } });
assert.equal(loss.body.win, false, 'the weak dog loses the derby'); assert.equal(loss.body.net, -derby.fee, 'only the fee burned');
assert.equal((await meOf(aa.token)).cash, lPre - derby.fee, 'the entry fee left the pocket, no purse');
const lostDog = (await pool.query(`SELECT losses, injured_until FROM racers WHERE id='${ghost}'`)).rows[0];
assert(Number(lostDog.losses) === 1 && lostDog.injured_until && new Date(lostDog.injured_until) > new Date(), 'the beaten dog took the L + is laid up');

// ── LIST + PvP MATCH RACE (the casino:pvp taxed transfer) ──
// bb buys a dog to race ghost; heal + reset ghost first
await pool.query(`UPDATE racers SET speed=25, stamina=25, heart=25, injured_until=NULL, circuit_at=NULL WHERE id='${ghost}'`);
const rival = (await call('POST', '/v1/stable/buy', { token: bb.token, body: { kind: 'dog', name: 'Sad-Eye Sam' } })).body.id;
await pool.query(`UPDATE racers SET speed=6, stamina=6, heart=6 WHERE id='${rival}'`); // ghost is a lock
assert.equal((await call('POST', `/v1/stable/list/${rival}`, { token: bb.token, body: { limit: 100 } })).body.error, 'stake', 'below the minimum wager');
await call('POST', `/v1/stable/list/${rival}`, { token: bb.token, body: { limit: 50000 } });
assert.equal((await call('POST', `/v1/stable/match/${aa.id}`, { token: aa.token, body: { myRacer: ghost, theirRacer: ghost, stake: 10000 } })).body.error, 'self', "you don't race your own stable");
// same-kind only: ghost (dog) can't race a horse
assert.equal((await call('POST', `/v1/stable/match/${bb.id}`, { token: aa.token, body: { myRacer: pony, theirRacer: rival, stake: 10000 } })).body.error, 'kind', 'a horse races horses — match the kind');
assert.equal((await call('POST', `/v1/stable/match/${bb.id}`, { token: aa.token, body: { myRacer: ghost, theirRacer: rival, stake: 999999 } })).body.error, 'limit', 'over the opponent limit');
const stake = 10000, pot = stake * 2, rake = Math.ceil(pot * STABLE.RAKE_BPS / 10000);
const aPre = (await meOf(aa.token)).cash, bPre = (await meOf(bb.token)).cash;
const poolPre = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
const match = await call('POST', `/v1/stable/match/${bb.id}`, { token: aa.token, body: { myRacer: ghost, theirRacer: rival, stake } });
assert.equal(match.body.win, true, 'the stronger dog wins (form 75 vs 18 — a lock)');
assert.equal((await meOf(aa.token)).cash, aPre + stake - rake, 'the winner took the wager minus the vig');
assert.equal((await meOf(bb.token)).cash, bPre - stake, 'the loser paid the wager');
assert.equal(Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool), poolPre + Math.floor(rake / 2), 'half the vig fed the buyback (half burns)');
assert.equal(await racerWins(aa.aid), 2, 'the match win banked a second career win');
const beaten = (await pool.query(`SELECT losses, injured_until FROM racers WHERE id='${rival}'`)).rows[0];
assert(Number(beaten.losses) === 1 && beaten.injured_until && new Date(beaten.injured_until) > new Date(), 'the beaten racer took the L + is laid up');

// ── the board (your stable + the field) + the leaderboard (records + LEGEND) ──
const board = (await call('GET', '/v1/stable', { token: aa.token })).body;
assert(board.stable.find((r) => r.id === ghost), 'the sheet shows your stable');
assert.equal(board.legend.wins, 2, 'the board shows your owner legend');
assert(board.field.find((r) => r.racerId === rival && r.raceLimit === 50000), 'the rival is on the field with its listed wager (now laid up from the loss)');
const lb = (await call('GET', '/v1/leaderboard/stable', { token: aa.token })).body;
assert(lb.racers[0] && lb.racers[0].racer === 'Grey Ghost', 'Grey Ghost tops the field board by record');
assert(lb.legend.find((m) => m.owner === 'Diamond Jim' && m.wins === 2), 'the owner legend ranks Diamond Jim by career wins');

// ── §10.4 (mid-life): the per-character cash check reconciles stable: incl. the circuit faucet ──
let inv = await runLedgerInvariants(pool);
assert.equal(inv.checks.find((c) => c.name === 'character cash').drift, cashDrift, `the only cash drift is the test grants (${cashDrift}) — stable: (buy/train/fee/purse/race) all reconcile`);
assert(inv.checks.find((c) => c.name === 'reason vocabulary').ok, 'stable: rides the §10.4 vocabulary');

// ══════════ STEP TWO: BREEDING + THE STAKES ══════════
import { sweepStakes } from '../src/stable.js';

// ── BREEDING: retire two same-kind racers into a foal (a head start, not a cap-skip); a cash SINK ──
// pin two of aa's dogs to known stats so the foal's inherited range is deterministic
const aaDogs = (await pool.query(`SELECT id FROM racers WHERE character_id='${aa.id}' AND kind='dog' ORDER BY id`)).rows.map((r) => r.id);
assert(aaDogs.length >= 2, 'the owner has two dogs to breed');
const [sire, dam] = aaDogs;
await pool.query(`UPDATE racers SET speed=20, stamina=20, heart=20 WHERE id IN ('${sire}','${dam}')`);
// gates: same racer / kind mismatch (a dog + the horse)
assert.equal((await call('POST', '/v1/stable/breed', { token: aa.token, body: { sire, dam: sire, name: 'Clone' } })).body.error, 'same', 'breeding takes two different racers');
assert.equal((await call('POST', '/v1/stable/breed', { token: aa.token, body: { sire, dam: pony, name: 'Chimera' } })).body.error, 'kind', "a dog and a horse can't be bred");
const dogCountPre = Number((await pool.query(`SELECT COUNT(*) n FROM racers WHERE character_id='${aa.id}'`)).rows[0].n);
const breedCashPre = (await meOf(aa.token)).cash;
const breed = await call('POST', '/v1/stable/breed', { token: aa.token, body: { sire, dam, name: 'Young Pretender' } });
assert.equal(breed.code, 200, 'the foal is born'); assert.equal(breed.body.name, 'Young Pretender', 'named');
assert.equal((await meOf(aa.token)).cash, breedCashPre - STABLE.BREED_COST, 'the stud fee left the pocket (ledgered stable:breed)');
// foal inherits floor(avg(20,20)×0.6)=12 + rand(0,5) → [12,17], clamped ≥ dog statMin
assert(breed.body.speed >= 12 && breed.body.speed <= 17, `the foal inherits a head start, not a cap-skip (speed ${breed.body.speed})`);
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM racers WHERE id IN ('${sire}','${dam}')`)).rows[0].n), 0, 'both parents retired to stud (consumed)');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM racers WHERE character_id='${aa.id}'`)).rows[0].n), dogCountPre - 1, 'two parents in, one foal out (a net −1)');

// ── THE STAKES: a scheduled marquee race; enter your racer (cash escrows), the worker settles ──
const st1 = await mk('Stakes Sam'); const st2 = await mk('Feature Fred'); const st3 = await mk('Purse Pete');
for (const s of [st1, st2, st3]) { await seed(s.id, `respect=${lvlRespect(10)}`); await grantCash(s.id, 500000); }
const stRacer = async (s, kind, name, stats) => { const b = await call('POST', '/v1/stable/buy', { token: s.token, body: { kind, name } });
  await pool.query(`UPDATE racers SET speed=${stats},stamina=${stats},heart=${stats} WHERE id='${b.body.id}'`); return b.body.id; };
const r1 = await stRacer(st1, 'horse', 'Secretariat', 25);  // form 75 — the class of the field
const r2 = await stRacer(st2, 'dog', 'Also-Ran', 8);
const r3 = await stRacer(st3, 'horse', 'Longshot', 10);
// short-field gate first: one entry, force-resolve → refunded (min entrants is 3)
assert.equal((await call('POST', `/v1/stable/stakes/${r1}`, { token: st1.token })).code, 200, 'st1 enters the stakes');
const soloRace = (await pool.query("SELECT id FROM stakes_races WHERE status='open'")).rows[0].id;
await pool.query(`UPDATE stakes_races SET resolves_at = now() - interval '1 minute' WHERE id='${soloRace}'`);
const solCashPre = (await meOf(st1.token)).cash;
await sweepStakes(pool);
assert.equal((await pool.query(`SELECT status FROM stakes_races WHERE id='${soloRace}'`)).rows[0].status, 'refunded', 'a short field is refunded');
assert.equal((await meOf(st1.token)).cash, solCashPre + STABLE.STAKES.BUYIN, 'the lone entrant got their buy-in back');
// now a FULL field: three enter, escrow holds, §10.4 stakes-escrow reconciles, the worker pays the top places
const e1 = await call('POST', `/v1/stable/stakes/${r1}`, { token: st1.token });
assert.equal(e1.code, 200, 'st1 re-enters the fresh stakes'); const raceId = e1.body.stakes;
assert.equal((await call('POST', `/v1/stable/stakes/${r1}`, { token: st1.token })).body.error, 'entered', 'one runner per owner per race');
await call('POST', `/v1/stable/stakes/${r2}`, { token: st2.token });
await call('POST', `/v1/stable/stakes/${r3}`, { token: st3.token });
const poolAmt = Number((await pool.query(`SELECT pool FROM stakes_races WHERE id='${raceId}'`)).rows[0].pool);
assert.equal(poolAmt, 3 * STABLE.STAKES.BUYIN, 'the purse holds all three buy-ins');
// mid-open §10.4: the stakes-escrow check reconciles (pool == Σ buyin)
const invMid = await runLedgerInvariants(pool);
const skMid = invMid.checks.find((c) => c.name === 'stakes escrow');
assert(skMid?.ok, `stakes escrow reconciles mid-open (drift ${skMid?.drift})`);
// resolve: Secretariat (form 75) tops a field of 75+rand vs ~24/30 — a lock; the top places split net of rake
await pool.query(`UPDATE stakes_races SET resolves_at = now() - interval '1 minute' WHERE id='${raceId}'`);
const winPreCash = (await meOf(st1.token)).cash;
await sweepStakes(pool);
assert.equal((await pool.query(`SELECT status FROM stakes_races WHERE id='${raceId}'`)).rows[0].status, 'resolved', 'the stakes settled');
const winPlace = Number((await pool.query(`SELECT place FROM stakes_entries WHERE race_id='${raceId}' AND character_id='${st1.id}'`)).rows[0].place);
assert.equal(winPlace, 1, 'the class of the field won'); assert((await meOf(st1.token)).cash > winPreCash, 'the winner banked a share of the purse');
// escrow closes: buyins == wins + take + refund + death (a full field, no death, no refund this race)
const skPosted = -(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='stable:stakes:buyin'")).rows[0].s));
const skWins = Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='stable:stakes:win'")).rows[0].s);
const skTake = -(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='stable:stakes:take'")).rows[0].s));
const skRef = Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='stable:stakes:refund'")).rows[0].s);
assert.equal(skPosted - skWins - skTake - skRef, 0, 'the stakes escrow closes (buyins == wins + take + refunds, both races)');
const invSk = await runLedgerInvariants(pool);
assert(invSk.checks.find((c) => c.name === 'stakes escrow').ok, 'the stakes-escrow §10.4 check holds after settle');

// ── DEATH: a dead owner's whole stable is done (survives-death is the LEGEND, not the animals) ──
const before = Number((await pool.query(`SELECT COUNT(*) n FROM racers WHERE character_id='${aa.id}'`)).rows[0].n);
assert(before > 0, 'the owner had racers');
await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: aa.id }, headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM racers WHERE character_id='${aa.id}'`)).rows[0].n), 0, 'the stable died with the street');
assert.equal(await racerWins(aa.aid), 2, 'but the OWNER legend survives death (account-level)');

// ── §10.4 final: the whole session reconciles ──
inv = await runLedgerInvariants(pool);
assert(inv.checks.find((c) => c.name === 'reason vocabulary').ok, 'the vocabulary still closes');

console.log('✅ The Stable test passed — own the dogs & the ponies: buy (level/kind/name/cash/full gates + the ledgered sink), train (bad-stat/energy/cap/ownership + sink), the PvE circuit (bad-meet/cooldown gates, a win\'s purse faucet + a loss\'s fee-only burn + injury, the owner legend), the PvP match race (self/kind/limit gates, the casino:pvp taxed transfer + the rake split half-to-the-street, injury-on-loss, the legend), the board + leaderboard, STEP TWO — BREEDING (same/kind gates, a foal inheriting a head-start-not-a-cap-skip, the two parents consumed, the ledgered stud-fee sink) + THE STAKES (buy-in escrow, a short-field refund, one-runner-per-owner gate, the worker settling a full field to the top places net of rake, and the stakes-escrow §10.4 check reconciling), DEATH (the stable wiped, the legend survives), and the §10.4 per-character cash reconcile + vocabulary');
await app.close();

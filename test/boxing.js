// THE FIGHT CIRCUIT test (the 29th suite) — mob boxing. STEP ONE: sign a contender, train, and stake
// them in PvP bouts (the casino:pvp transfer pattern). STEP TWO: THE STABLE (many fighters), NPC
// EXHIBITION bouts (a bounded PvE purse), the world TITLE BELT (PvP, pure status), and the MANAGER
// career LEGEND (lifetime wins, account-level → survives death). Covers the gates, the taxed transfer +
// rake split, the exhibition faucet/sink, the belt claim + vacate-on-death, the legend, DEATH, and §10.4.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { BOXING } from '../src/rules.js';
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
let inv = await runLedgerInvariants(pool);
assert.equal(inv.checks.find((c) => c.name === 'character cash').drift, cashDrift, `the only cash drift is the test grants (${cashDrift}) — boxing: (bout/purse/fee/train/recruit) all reconcile`);
assert(inv.checks.find((c) => c.name === 'reason vocabulary').ok, 'boxing: rides the §10.4 vocabulary');

// ── DEATH: a dead manager's whole STABLE is done + the belt VACATES; the career legend SURVIVES ──
await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: aa.id }, headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM fighters WHERE character_id='${aa.id}'`)).rows[0].n), 0, "the dead manager's stable is gone");
assert.equal((await pool.query('SELECT holder_fighter FROM boxing_title WHERE id=1')).rows[0].holder_fighter, null, 'the belt is vacated when the champion dies');
assert.equal(await boxingWins(aa.aid), 2, 'the career legend (account-level) SURVIVES death — the heir keeps it');
inv = await runLedgerInvariants(pool);
assert.equal(inv.checks.find((c) => c.name === 'character cash').drift, cashDrift, 'cash §10.4 holds through the estate');

console.log('✅ The Fight Circuit test passed — recruit/THE STABLE (level/name/cash gates + cap at STABLE_MAX + rolled stats), train-by-id (gates + sink + ownership), the NPC EXHIBITION (bad-tier gate, fee-sink + purse-faucet on a win, the career-win bank, the per-fighter cooldown), the PvP BOUT (ownership/self/limit gates, the taxed transfer + rake split half→buyback, records + injury), THE TITLE BELT (claimed vacant, chip on the board, vacated on the champion\'s death), the MANAGER LEGEND (lifetime wins, leaderboard, SURVIVES death), the board + leaderboard, DEATH (the stable dies with the street), and §10.4 (per-character cash reconciles boxing: incl. the exhibition faucet)');
await app.close();

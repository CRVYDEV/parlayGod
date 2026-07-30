// THE GAMBLING DEN test — street craps (pass line, one-call rounds) + the daily Numbers.
// Proves the guardrails: cash only ($OMR never moves), located at neon, table limits, every
// stake/payout ledgered casino:* (per-character §10.4 identity holds EXACTLY over a gambling
// session), the 1% street cut feeding the tax pool, one ticket/day, lazy claim at 600:1,
// and the vocabulary knows the new reasons. Runs on pg-mem — zero infra.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { CASINO, UNDERWORLD, numbersDrawOf, dayOf, weekOf, hash01, MARKET_SEED, PACING } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { sweepTournaments, trackFieldOf, sweepTrackEntries, sweepFuturity } from '../src/casino.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body, headers } = {}) => {
  const res = await app.inject({ method, url,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers || {}) }, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;

const { body: { token } } = await call('POST', '/v1/auth/guest');
await call('POST', '/v1/character', { token, body: { name: 'Lucky Lou' } });
const cid = (await meOf(token)).id;
const seed = (cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${cid}'`);

// ── gates: the den is at the Neon Mile; the tables have limits; lockup has no dice ──
await seed("cash=1000000, nerve=50, energy=200, loc='docks'");
assert.equal((await call('POST', '/v1/casino/dice', { token, body: { amount: 500 } })).body.error, 'district', 'the den runs on neon — travel there');
await seed("loc='neon'");
assert.equal((await call('POST', '/v1/casino/dice', { token, body: { amount: 50 } })).body.error, 'min', 'table minimum $100');
assert.equal((await call('POST', '/v1/casino/dice', { token, body: { amount: 500000 } })).body.error, 'max', 'table maximum $250k');
await seed("jail_until = now() + interval '1 hour'");
assert.equal((await call('POST', '/v1/casino/dice', { token, body: { amount: 500 } })).body.error, 'jailed', 'no dice from lockup');
await seed("jail_until=NULL");

// ── street craps: a session of rounds — wins and losses both land, all of it ledgered ──
const omrBefore = (await meOf(token)).omr;
const taxPre = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
let wins = 0, losses = 0, staked = 0, paidOut = 0;
// econ pass: mirror of the HOUSE BOOK — the street is tipped 1% per stake but only out of realized
// profit (no open tickets during the session, so liability is 0 and the mirror is exact)
let denProfit = 0, denDist = 0;
for (let i = 0; i < 60; i++) {
  await seed('nerve=50'); // nerve is the natural throttle; refill to keep the session going
  const r = await call('POST', '/v1/casino/dice', { token, body: { amount: 1000 } });
  assert.equal(r.code, 200, `round resolves (${JSON.stringify(r.body)})`);
  assert(Array.isArray(r.body.rolls) && r.body.rolls.length >= 1, 'the roll sequence comes back');
  const last = r.body.rolls[r.body.rolls.length - 1];
  if (r.body.rolls.length === 1) assert([7, 11, 2, 3, 12].includes(last), 'a one-roll round is a natural or craps');
  else assert(last === 7 || last === r.body.point, 'a point round ends on the point or a seven');
  staked += 1000;
  denProfit += 1000;                                                // the stake enters the book…
  if (r.body.win) { wins++; paidOut += 2000; denProfit -= 2000; } else losses++; // …THIS round's payout is booked…
  const take = Math.min(10, Math.max(0, denProfit - denDist));      // …and ONLY THEN the tip is profit-capped
  denDist += take;                                                  // (red-team R4 casino F1: dice tips post-payout)
}
assert(wins > 0 && losses > 0, `both outcomes over 60 rounds (${wins}W/${losses}L)`);
// every roll is in the audit log
assert(Number((await pool.query(`SELECT COUNT(*) n FROM rng_audit WHERE action='casino:dice' AND character_id='${cid}'`)).rows[0].n) === 60, 'every round rng-audited');
// the ledger knows every dollar: bets == -staked, wins == payouts
const sum = async (reason) => Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='${reason}' AND character_id='${cid}'`)).rows[0].s);
assert.equal(await sum('casino:bet:dice'), -staked, 'every stake is a ledgered casino:bet:dice sink');
assert.equal(await sum('casino:win:dice'), paidOut, 'every payout is a ledgered casino:win:dice faucet');
// the street's cut: 1% of each stake, CAPPED at the house's realized profit (the mint-on-top fix —
// the den tips out of its winnings, it never emits on volume)
const taxPost = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
assert.equal(taxPost - taxPre, denDist, 'the street cut is tipped only out of realized profit');
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='casino:take'")).rows[0].s),
  -denDist, 'every tip-out is a ledgered NULL casino:take row');
const dvCraps = (await pool.query('SELECT profit, distributed FROM den_volume WHERE id=1')).rows[0];
assert.equal(Number(dvCraps.profit), staked - paidOut, 'the house book mirrors the ledger (profit == bets − wins)');
assert.equal(Number(dvCraps.distributed), denDist, 'and knows exactly what it tipped out');
// THE regulatory line: a gambling session never touches $OMR
assert.equal((await meOf(token)).omr, omrBefore, 'the den never touches $OMR — cash only');

// ── the Numbers: one ticket a day, lazy claim at 600:1 against the seed-drawn number ──
const den = await call('GET', '/v1/casino', { token });
assert.equal(den.code, 200, 'den info');
assert(den.body.numbers.yesterday >= 0 && den.body.numbers.yesterday <= 999, "yesterday's number is public");
let rr = await call('POST', '/v1/casino/numbers', { token, body: { pick: 1234, amount: 100 } });
assert.equal(rr.body.error, 'pick', '0–999 only');
rr = await call('POST', '/v1/casino/numbers', { token, body: { pick: 777, amount: 5 } });
assert.equal(rr.body.error, 'min', 'numbers minimum $10');
rr = await call('POST', '/v1/casino/numbers', { token, body: { pick: 777, amount: 100 } });
assert.equal(rr.code, 200, 'ticket bought');
assert.equal((await call('POST', '/v1/casino/numbers', { token, body: { pick: 8, amount: 100 } })).body.error, 'ticket', 'one ticket a day');
assert.equal((await call('POST', '/v1/casino/numbers/claim', { token })).body.settled, 0, "today's ticket hasn't matured — nothing to settle");
// backdate the ticket to YESTERDAY and make it a WINNER (the pick is set to yesterday's draw —
// state warping, not value: the stake was honestly paid above)
const yesterday = dayOf() - 1;
const winningPick = numbersDrawOf(yesterday);
await pool.query(`UPDATE numbers_tickets SET day=${yesterday}, pick=${winningPick} WHERE character_id='${cid}'`);
const cashPreClaim = (await meOf(token)).cash;
rr = await call('POST', '/v1/casino/numbers/claim', { token });
assert.equal(rr.code, 200, 'claimed'); assert.equal(rr.body.settled, 1, 'one ticket settled');
assert.equal(rr.body.won, 100 * CASINO.NUMBERS_PAYOUT, 'the hit paid 600:1');
assert.equal((await meOf(token)).cash, cashPreClaim + 60000, 'the payout landed in pocket');
assert.equal(await sum('casino:win:numbers'), 60000, 'the win is a ledgered faucet');
assert.equal((await call('POST', '/v1/casino/numbers/claim', { token })).body.settled, 0, 'a settled ticket is gone (idempotent)');
// a losing ticket settles to nothing
rr = await call('POST', '/v1/casino/numbers', { token, body: { pick: (winningPick + 1) % 1000, amount: 100 } });
assert.equal(rr.code, 200, 'a second ticket (new day slot freed)');
await pool.query(`UPDATE numbers_tickets SET day=${yesterday} WHERE character_id='${cid}'`);
rr = await call('POST', '/v1/casino/numbers/claim', { token });
assert.equal(rr.body.settled, 1, 'the loser settled'); assert.equal(rr.body.won, 0, 'and paid nothing');

// econ-pass regression: the 600:1 hit put the house DEEP under water — no street cut is minted on
// top of a stake until the book recovers (the old model tipped 1% regardless of results)
assert(Number((await pool.query('SELECT profit FROM den_volume WHERE id=1')).rows[0].profit) < 0,
  'the jackpot drove the house book negative');
const poolUW = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
await seed('nerve=50');
assert.equal((await call('POST', '/v1/casino/dice', { token, body: { amount: 1000 } })).code, 200, 'a round while the house is under water');
assert.equal(Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool), poolUW,
  'no street cut while the book is negative — the den only tips out of realized profit');

// ══════════ STEP TWO: back-room PvP dice, the weekly fight + the neon fix, rakeback ══════════
let seededCash = 1000000; // every later seed is a tracked RELATIVE bump so the identity check stays exact

// ── back-room dice: consent-by-listing, symmetric roll, winner takes pot − 5% rake ──
const { body: { token: t2 } } = await call('POST', '/v1/auth/guest');
await call('POST', '/v1/character', { token: t2, body: { name: 'Dice Danny' } });
const did = (await meOf(t2)).id;
await pool.query(`UPDATE characters SET cash=100000, loc='neon', nerve=50 WHERE id='${did}'`);
assert.equal((await call('POST', `/v1/casino/dice/${did}`, { token, body: { amount: 1000 } })).body.error, 'not_fading', 'no action without a listing');
assert.equal((await call('POST', '/v1/casino/fade', { token: t2, body: { limit: 50 } })).body.error, 'limit', 'fade limits respect the table');
rr = await call('POST', '/v1/casino/fade', { token: t2, body: { limit: 20000 } });
assert.equal(rr.code, 200, 'danny lists an open fade'); assert.equal(rr.body.character.fadeLimit, 20000, 'surfaced in the view');
assert((await call('GET', '/v1/casino', { token })).body.backroom.faders.some((f) => f.id === did), 'danny is on the den board');
assert.equal((await call('POST', `/v1/casino/dice/${did}`, { token, body: { amount: 50000 } })).body.error, 'limit', 'the fade limit binds');
// play until both outcomes seen; verify the exact transfer + rake every round
let pvpW = 0, pvpL = 0;
for (let i = 0; i < 30 && (pvpW === 0 || pvpL === 0); i++) {
  await seed("nerve=50");
  const louPre = (await meOf(token)).cash, danPre = (await meOf(t2)).cash;
  const taxP = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
  const g = await call('POST', `/v1/casino/dice/${did}`, { token, body: { amount: 2000 } });
  assert.equal(g.code, 200, `backroom round resolves (${JSON.stringify(g.body)})`);
  const rake = g.body.rake;
  assert.equal(rake, Math.ceil(4000 * 0.05), 'the rake is 5% of the pot');
  if (g.body.win) { pvpW++;
    assert.equal((await meOf(token)).cash, louPre + 2000 - rake, 'winner nets stake − rake');
    assert.equal((await meOf(t2)).cash, danPre - 2000, 'loser pays the stake');
  } else { pvpL++;
    assert.equal((await meOf(token)).cash, louPre - 2000, 'loser pays the stake');
    assert.equal((await meOf(t2)).cash, danPre + 2000 - rake, 'winner nets stake − rake');
  }
  assert.equal(Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool) - taxP,
    Math.floor(rake / 2), 'half the rake to the street, the rest burns');
}
assert(pvpW > 0 && pvpL > 0, `both sides won at least once (${pvpW}/${pvpL})`);
// (founder 2026-07-30) the M4 "undrawable-day gap" is closed: a back-room WIN advances the 'dice'
// daily counter, so "Win N rolls in the Back Room" is finally a quest that can be done. Both men
// won at least once above, so BOTH counters must carry dice > 0 (only wins count — total == pvpW+pvpL).
{
  const dcount = async (id) => {
    const rows = (await pool.query('SELECT counters FROM daily_progress WHERE character_id=$1', [id])).rows;
    return rows.reduce((s, r) => s + (JSON.parse(r.counters).dice || 0), 0);
  };
  const louD = await dcount((await meOf(token)).id), danD = await dcount(did);
  assert(louD > 0 && danD > 0, `back-room WINS advance the dice daily for whoever won (${louD}/${danD})`);
  assert.equal(louD + danD, pvpW + pvpL, 'exactly one dice bump per round — the winner\'s');
}

// ── the fight: one capped bet a week; the family holding neon can buy the result ──
// SIGN-OFF (2.5): the book won't take action from a rookie — an anti-alt floor on the fix-Sybil ring
const { body: { token: rookieTok } } = await call('POST', '/v1/auth/guest');
await call('POST', '/v1/character', { token: rookieTok, body: { name: 'Rookie Ricky' } });
await pool.query(`UPDATE characters SET cash=100000, loc='neon' WHERE id='${(await meOf(rookieTok)).id}'`);
assert.equal((await call('POST', '/v1/casino/fight', { token: rookieTok, body: { side: 'a', amount: 500 } })).body.error, 'rookie', 'a fresh alt (level 1) is refused a fight bet');
await seed('respect=500'); // Lou is level 7 — clears the fight-bet floor
assert.equal((await call('POST', '/v1/casino/fight', { token, body: { side: 'x', amount: 500 } })).body.error, 'side', "back 'a' or 'b'");
assert.equal((await call('POST', '/v1/casino/fight', { token, body: { side: 'b', amount: 50000 } })).body.error, 'max', 'fight bets cap small — the fix stays bounded');
rr = await call('POST', '/v1/casino/fight', { token, body: { side: 'b', amount: 5000 } });
assert.equal(rr.code, 200, 'backed the dog'); assert(rr.body.a && rr.body.b, 'the bout card names the fighters');
assert.equal((await call('POST', '/v1/casino/fight', { token, body: { side: 'a', amount: 500 } })).body.error, 'bet', 'one bet a bout');
assert.equal((await call('POST', '/v1/casino/fight/claim', { token })).body.settled, 0, 'the bout has not gone off yet');
// the fix: boss-only, neon-holders-only, once, treasury-funded
assert.equal((await call('POST', '/v1/casino/fight/fix', { token, body: { winner: 'b' } })).body.error, 'rank', 'no family, no fix');
await seed(`respect=${PACING.LEVEL_DIVISOR * 57 * 57}`); // level 58 — founding, the high-stakes room, and the casino front below
const gangId = (await call('POST', '/v1/gangs', { token, body: { name: 'Neon Kings', tag: 'NKG' } })).body.gangId;
assert(gangId, 'lou founded a family'); seededCash -= 0; // founding is ledgered, not seeded
assert.equal((await call('POST', '/v1/gangs/tribute', { token, body: { amount: 100000 } })).code, 200, 'war chest funded');
assert.equal((await call('POST', '/v1/casino/fight/fix', { token, body: { winner: 'b' } })).body.error, 'turf', 'the fix belongs to whoever runs neon');
await pool.query(`UPDATE districts SET npc_holder=NULL WHERE id='neon'`); // World step five: this test just needs the family to hold neon (bypass the apex NPC occupation)
assert.equal((await call('POST', '/v1/districts/neon/seize', { token })).code, 200, 'the Kings took the Mile');
const treasuryPreFix = (await call('GET', `/v1/gangs/${gangId}`, {})).body.gang.treasury;
const madamePreFix = (await call('GET', '/v1/underworld', { token })).body.npcs.find((n) => n.id === 'madame').standing;
rr = await call('POST', '/v1/casino/fight/fix', { token, body: { winner: 'b' } });
assert.equal(rr.code, 200, 'the referee is bought'); assert.equal(rr.body.cost, CASINO.FIGHT_FIX_COST, 'for the listed price');
assert.equal((await call('GET', `/v1/gangs/${gangId}`, {})).body.gang.treasury, treasuryPreFix - CASINO.FIGHT_FIX_COST, 'paid from the treasury');
// Underworld step five, rivalry #3: nobody fixes HER book — the buying boss wears it
assert.equal((await call('GET', '/v1/underworld', { token })).body.npcs.find((n) => n.id === 'madame').standing,
  Math.max(0, madamePreFix - UNDERWORLD.STEP5.FIX_LOSS), 'the Madame heard who bought the referee (−5)');
assert.equal((await call('POST', '/v1/casino/fight/fix', { token, body: { winner: 'a' } })).body.error, 'fixed', 'one fix a bout');
// roll the bout into the past: the FIXED result pays the dog backer at 2.6
const wk = weekOf();
await pool.query(`UPDATE fight_bets SET week=${wk - 1} WHERE character_id='${cid}'`);
await pool.query(`UPDATE fight_fixes SET week=${wk - 1} WHERE week=${wk}`);
const cashPreFight = (await meOf(token)).cash;
rr = await call('POST', '/v1/casino/fight/claim', { token });
assert.equal(rr.body.settled, 1, 'the bout settled');
assert.equal(rr.body.won, Math.floor(5000 * CASINO.FIGHT_DOG_PAYS), 'the fixed dog paid 2.6');
assert.equal((await meOf(token)).cash, cashPreFight + 13000, 'the payout landed');
// an UNFIXED bout resolves off the seed draw
rr = await call('POST', '/v1/casino/fight', { token, body: { side: 'a', amount: 1000 } });
assert.equal(rr.code, 200, 'a fresh bet on the new bout');
await pool.query(`UPDATE fight_bets SET week=${wk - 2} WHERE character_id='${cid}'`);
const drawWinner = hash01(`fight:${wk - 2}:${MARKET_SEED}`) < CASINO.FIGHT_FAV_P ? 'a' : 'b';
rr = await call('POST', '/v1/casino/fight/claim', { token });
assert.equal(rr.body.settled, 1, 'unfixed bout settled');
assert.equal(rr.body.results[0].winner, drawWinner, 'the seed draw decided it');
assert.equal(rr.body.won, drawWinner === 'a' ? Math.floor(1000 * CASINO.FIGHT_FAV_PAYS) : 0, 'paid iff the pick hit');

// ── rakeback: a casino-front owner earns a cut of den volume — paid ONLY out of house profit ──
await seed("cash = cash + 8000000"); seededCash += 8000000;
rr = await call('POST', '/v1/business/casino/buy', { token });
assert.equal(rr.code, 200, 'lou bought the casino front');
const volAtBuy = Number((await pool.query('SELECT total FROM den_volume WHERE id=1')).rows[0].total);
assert.equal(Number((await pool.query("SELECT rake_cursor FROM businesses WHERE character_id=$1 AND kind='casino'", [cid])).rows[0].rake_cursor),
  volAtBuy, 'the rakeback cursor starts at today — no claiming history');
// econ-pass regression: the house is still under water from the 600:1 hit — the rakeback WAITS
// (the cursor holds; the claim isn't forfeited, it's just not minted while the book is negative)
await seed("nerve=50");
assert.equal((await call('POST', '/v1/casino/dice', { token, body: { amount: 1000 } })).code, 200, 'volume lands after the buy');
rr = await call('POST', '/v1/business/collect', { token });
assert.equal(rr.body.rakeback, undefined, 'no rakeback while the book is negative');
assert.equal(Number((await pool.query("SELECT rake_cursor FROM businesses WHERE character_id=$1 AND kind='casino'", [cid])).rows[0].rake_cursor),
  volAtBuy, 'the cursor holds — the claim waits for the house to recover, nothing forfeits');
// bank REAL profit for the house (honest play, no value seeded): matured losing tickets, until the
// book can cover the rakeback owed on the volume since the cursor
for (let i = 0; i < 300; i++) {
  const dv = (await pool.query('SELECT profit, distributed FROM den_volume WHERE id=1')).rows[0];
  const volNow0 = Number((await pool.query('SELECT total FROM den_volume WHERE id=1')).rows[0].total);
  const owed = Math.floor((volNow0 - volAtBuy) * CASINO.RAKEBACK_BPS / 10000);
  if (Number(dv.profit) - Number(dv.distributed) >= owed + 1000) break;
  rr = await call('POST', '/v1/casino/numbers', { token, body: { pick: 0, amount: 1000 } });
  assert.equal(rr.code, 200, `top-up ticket (${JSON.stringify(rr.body)})`);
  await pool.query(`UPDATE numbers_tickets SET day=${yesterday}, pick=${(winningPick + 1) % 1000} WHERE character_id='${cid}'`);
  await call('POST', '/v1/casino/numbers/claim', { token }); // a settled loser: +$1k realized profit
}
rr = await call('POST', '/v1/business/collect', { token });
assert.equal(rr.code, 200, 'collected');
const volNow = Number((await pool.query('SELECT total FROM den_volume WHERE id=1')).rows[0].total);
assert.equal(rr.body.rakeback, Math.floor((volNow - volAtBuy) * CASINO.RAKEBACK_BPS / 10000),
  'the owner raked 1% of the volume since the cursor — now that the house can pay it');
assert.equal(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='casino:rakeback' AND character_id='${cid}'`)).rows[0].s),
  rr.body.rakeback, 'the rakeback is a ledgered casino: faucet');
assert.equal((await call('POST', '/v1/business/collect', { token })).body.rakeback, undefined, 'no double-claim — the cursor advanced');

// ══════════ STEP THREE: the TABLE GAMES — blackjack (stateful PvE) + heads-up hold'em (PvP) ══════════

// ── BLACKJACK: deal → hit / stand / double, every hand's cash delta == its reported net ──
await seed("cash = cash + 5000000, nerve=50, loc='neon'"); seededCash += 5000000;
// gates: no live hand yet
assert.equal((await call('POST', '/v1/casino/blackjack/hit', { token })).body.error, 'no_hand', 'no hit without a hand');
assert.equal((await call('POST', '/v1/casino/blackjack/stand', { token })).body.error, 'no_hand', 'no stand without a hand');
// the one-live-hand gate: deal until a hand actually sits (a natural resolves instantly), then re-deal is refused
let liveDeal = null;
for (let i = 0; i < 20 && !liveDeal; i++) {
  await seed('nerve=50');
  const d = await call('POST', '/v1/casino/blackjack', { token, body: { amount: 1000 } });
  assert.equal(d.code, 200, `deal (${JSON.stringify(d.body)})`);
  if (!d.body.done) liveDeal = d.body; else { /* an instant natural — count it below */ }
}
assert(liveDeal, 'a live hand was dealt');
assert.equal(liveDeal.player.length, 2, 'two cards up front');
assert.equal((await call('POST', '/v1/casino/blackjack', { token, body: { amount: 1000 } })).body.error, 'hand', 'one live hand at a time');
// hit past two cards, THEN double is refused (double is a first-two-cards move)
const afterHit = await call('POST', '/v1/casino/blackjack/hit', { token });
if (!afterHit.body.done) assert.equal((await call('POST', '/v1/casino/blackjack/double', { token })).body.error, 'double', 'no double after a hit');
// clean up the live hand
if (!afterHit.body.done) await call('POST', '/v1/casino/blackjack/stand', { token });

let bjStaked = 0, bjPaid = 0, bjWins = 0, bjLosses = 0, bjBusts = 0, bjDoubles = 0, bjNaturals = 0;
async function playHand(strategy) {
  await seed('nerve=50');
  const pre = (await meOf(token)).cash;
  let r = await call('POST', '/v1/casino/blackjack', { token, body: { amount: 1000 } });
  assert.equal(r.code, 200, `deal (${JSON.stringify(r.body)})`);
  while (!r.body.done) {
    if (strategy === 'double' && r.body.canDouble) r = await call('POST', '/v1/casino/blackjack/double', { token });
    else if (strategy === 'hit' && r.body.playerTotal < 17) r = await call('POST', '/v1/casino/blackjack/hit', { token });
    else r = await call('POST', '/v1/casino/blackjack/stand', { token });
    assert.equal(r.code, 200, `action (${JSON.stringify(r.body)})`);
  }
  const post = (await meOf(token)).cash;
  assert.equal(post - pre, r.body.net, `cash moved by exactly the net (${r.body.outcome})`);
  bjStaked += r.body.bet; bjPaid += r.body.payout;
  if (r.body.outcome === 'bust') bjBusts++;
  if (r.body.outcome === 'blackjack') bjNaturals++;
  if (r.body.net > 0) bjWins++; else if (r.body.net < 0) bjLosses++;
  if (r.body.bet === 2000) bjDoubles++;
  return r.body;
}
// count the earlier auto-resolved deals into the ledger totals too (they staked $1000 each and paid out)
const bjBetPre = -(await sum('casino:bet:blackjack')); // includes the gate-loop deals above
const bjWinPre = await sum('casino:win:blackjack');
for (let i = 0; i < 60; i++) await playHand('stand');
for (let i = 0; i < 15; i++) await playHand('hit');
for (let i = 0; i < 15; i++) await playHand('double');
assert(bjWins > 0 && bjLosses > 0, `blackjack saw both wins and losses (${bjWins}W/${bjLosses}L)`);
assert(bjBusts > 0, 'a hit-strategy hand busted at least once');
assert(bjDoubles > 0, 'at least one hand doubled down (bet $2000)');
// the ledger knows every blackjack dollar: bets == −staked, wins == payouts (matched against the
// den book's profit identity below and the global §10.4 check at the end)
assert.equal(-(await sum('casino:bet:blackjack')), bjBetPre + bjStaked, 'every stake is a ledgered casino:bet:blackjack sink');
assert.equal(await sum('casino:win:blackjack'), bjWinPre + bjPaid, 'every payout is a ledgered casino:win:blackjack faucet');
// every blackjack draw is rng-audited (deal + at least one dealer/hit event per resolved hand)
assert(Number((await pool.query(`SELECT COUNT(*) n FROM rng_audit WHERE action LIKE 'casino:blackjack:%' AND character_id='${cid}'`)).rows[0].n) > 90, 'blackjack draws are rng-audited');
// THE regulatory line holds through the table games too
const omrAfterBJ = (await meOf(token)).omr;

// red-team regression: a LIVE blackjack hand's pending payout is RESERVED (openLiability), so the
// street can't be tipped against an unresolved hand — parity with the numbers/fight reservation
await seed('cash = cash + 60000000'); seededCash += 60000000; // fund up to 25× HIGH_MAX ($2M) probes on any losing streak (TRACKED bump — the §10.4 identity stays exact)
let bigLive = null;
for (let i = 0; i < 25 && !bigLive; i++) { await seed('nerve=50');
  const d = await call('POST', '/v1/casino/blackjack', { token, body: { amount: CASINO.HIGH_MAX } });
  assert.equal(d.code, 200, `big deal (${JSON.stringify(d.body)})`);
  if (!d.body.done) bigLive = d.body; // a natural resolved — deal again until a live hand sits
}
assert(bigLive, 'a live high-stakes hand sits'); // Lou is level 58 → the high-stakes room
await seed('nerve=50');
// The contract is "the tip never exceeds profit the house has not already committed" — the live
// hand's pending payout is reserved against it. Asserting the pool does not move AT ALL only holds
// when the reservation happens to exceed undistributed profit, and everything above this line is
// random cards and dice: measured at 2 failures in 24 runs on an unmodified tree, a ~6% chance of
// reddening CI for a reason unrelated to anything under test. So assert the contract itself, which
// is true on every deal of the cards. (The book can't simply be squared here — den_volume.profit is
// reconciled against the ledger by the `den profit` §10.4 check, so zeroing it would break that.)
const dvRes = (await pool.query('SELECT profit, distributed FROM den_volume WHERE id=1')).rows[0];
// what the live hand reserves: bet × (doubled ? 2 : 1) × 2. Any OTHER open liability (numbers
// tickets, fight bets) only makes the real reserve larger, so this over-states what's available and
// the assertion stays sound either way.
const reservedRes = 2 * CASINO.HIGH_MAX;
const availRes = Math.max(0, Math.floor(Number(dvRes.profit) - Number(dvRes.distributed) - reservedRes));
const taxBeforeRes = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
assert.equal((await call('POST', '/v1/casino/dice', { token, body: { amount: 1000 } })).code, 200, 'a dice round while a big hand is live');
const taxAfterRes = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
assert(taxAfterRes - taxBeforeRes <= availRes,
  `the live blackjack hand's payout is RESERVED — the street tip never exceeds uncommitted profit `
  + `(tipped ${taxAfterRes - taxBeforeRes}, available ${availRes})`);
await call('POST', '/v1/casino/blackjack/stand', { token }); // resolve so no hand lingers into the §10.4 check

// ── HEADS-UP HOLD'EM: consent-by-listing, best 5-of-7 wins the raked pot, a tie splits ──
await pool.query(`UPDATE characters SET cash=5000000, loc='neon' WHERE id='${did}'`); // Danny sits at the table
assert.equal((await call('POST', `/v1/casino/poker/${did}`, { token, body: { amount: 1000 } })).body.error, 'not_dealing', 'no hand without a listing');
assert.equal((await call('POST', '/v1/casino/poker/deal', { token: t2, body: { limit: 10 } })).body.error, 'limit', 'poker limits respect the table minimum');
rr = await call('POST', '/v1/casino/poker/deal', { token: t2, body: { limit: 50000 } });
assert.equal(rr.code, 200, 'danny opens a poker table'); assert.equal(rr.body.character.pokerLimit, 50000, 'surfaced in the view');
assert((await call('GET', '/v1/casino', { token })).body.poker.tables.some((t) => t.id === did), 'danny is a poker table on the board');
assert.equal((await call('POST', `/v1/casino/poker/${did}`, { token, body: { amount: 60000 } })).body.error, 'limit', 'the poker limit binds');
let pkW = 0, pkL = 0, pkPush = 0;
for (let i = 0; i < 40 && (pkW === 0 || pkL === 0); i++) {
  const louPre = (await meOf(token)).cash, danPre = (await meOf(t2)).cash;
  const taxP = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
  const g = await call('POST', `/v1/casino/poker/${did}`, { token, body: { amount: 2000 } });
  assert.equal(g.code, 200, `poker hand resolves (${JSON.stringify(g.body)})`);
  assert.equal(g.body.board.length, 5, 'five community cards'); assert.equal(g.body.yourHole.length, 2, 'two hole cards');
  assert(typeof g.body.yourHand === 'string' && typeof g.body.theirHand === 'string', 'both hands named');
  if (g.body.result === 'push') { pkPush++;
    assert.equal((await meOf(token)).cash, louPre, 'a tie moves no money'); assert.equal(g.body.rake, 0, 'no rake on a split');
  } else {
    const rake = g.body.rake; assert.equal(rake, Math.ceil(4000 * 0.05), 'poker rake is 5% of the pot');
    if (g.body.result === 'win') { pkW++;
      assert.equal((await meOf(token)).cash, louPre + 2000 - rake, 'winner nets stake − rake');
      assert.equal((await meOf(t2)).cash, danPre - 2000, 'loser pays the stake');
    } else { pkL++;
      assert.equal((await meOf(token)).cash, louPre - 2000, 'loser pays the stake');
      assert.equal((await meOf(t2)).cash, danPre + 2000 - rake, 'winner nets stake − rake');
    }
    assert.equal(Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool) - taxP, Math.floor(rake / 2), 'half the poker rake to the street, the rest burns');
  }
}
assert(pkW > 0 && pkL > 0, `heads-up poker saw both sides win (${pkW}W/${pkL}L, ${pkPush} split)`);
assert.equal((await meOf(token)).omr, omrAfterBJ, 'poker never touches $OMR either');

// ══════════ STEP FOUR: the POKER TOURNAMENT (scheduled showdown, escrow → worker settle) ══════════
// three fresh players (kept off Lou's tracked ledger); the worker deals + settles; the escrow §10.4
// check reconciles the pool. BUYIN escrows on entry; the worker pays the top places net of the rake.
const BUYIN = CASINO.TOURNEY.BUYIN;
const newPlayer = async (name) => { const { body: { token: tk } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token: tk, body: { name } });
  const id = (await meOf(tk)).id; await pool.query(`UPDATE characters SET cash=200000, loc='neon' WHERE id='${id}'`);
  return { tk, id }; };
const tsum = async (reason) => Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='${reason}'`)).rows[0].s);

// gate: not at the den
const D = await newPlayer('Tourney Tess');
await pool.query(`UPDATE characters SET loc='docks' WHERE id='${D.id}'`);
assert.equal((await call('POST', '/v1/casino/tournament', { token: D.tk })).body.error, 'district', 'the big table is at neon');
await pool.query(`UPDATE characters SET loc='neon' WHERE id='${D.id}'`);
// ── the SHORT-FIELD REFUND: one entrant, the field never fills → the buy-in comes back ──
let e = await call('POST', '/v1/casino/tournament', { token: D.tk });
assert.equal(e.code, 200, `Tess buys in (${JSON.stringify(e.body)})`); assert.equal(e.body.pool, BUYIN, 'the pool holds her buy-in');
assert.equal((await call('POST', '/v1/casino/tournament', { token: D.tk })).body.error, 'entered', "you can't buy in twice");
const cashPreRefund = (await meOf(D.tk)).cash;
const tid1 = e.body.tournament;
await pool.query(`UPDATE poker_tournaments SET resolves_at = now() - interval '1 minute' WHERE id='${tid1}'`);
// registration is closed now — a fresh entrant is turned away
assert.equal((await call('POST', '/v1/casino/tournament', { token: (await newPlayer('Late Larry')).tk })).body.error, 'closed', 'no seating after the window closes');
await sweepTournaments(pool);
assert.equal((await pool.query(`SELECT status FROM poker_tournaments WHERE id='${tid1}'`)).rows[0].status, 'refunded', 'a short field is refunded');
assert.equal((await meOf(D.tk)).cash, cashPreRefund + BUYIN, "Tess got her buy-in back");
assert.equal((await pool.query('SELECT current FROM poker_state WHERE id=1')).rows[0].current, null, 'the state cleared for the next tournament');

// ── a full field settles: buy-ins escrow, one dies (their stake burns), the top places split net of rake ──
const A = await newPlayer('Ante Al'), B = await newPlayer('Bluff Bo'), C = await newPlayer('Cold Cy');
for (const p of [A, B, C]) assert.equal((await call('POST', '/v1/casino/tournament', { token: p.tk })).code, 200, 'entered the tournament');
const tid2 = (await pool.query("SELECT id FROM poker_tournaments WHERE status='open'")).rows[0].id;
assert.equal(Number((await pool.query(`SELECT pool FROM poker_tournaments WHERE id='${tid2}'`)).rows[0].pool), 3 * BUYIN, 'the pool holds all three buy-ins');
await pool.query(`UPDATE characters SET alive=false WHERE id='${C.id}'`); // Cy's street dies before the deal — his stake burns
const buyinPre = -(await tsum('casino:tourney:buyin')), winPre = await tsum('casino:tourney:win'), takePre = -(await tsum('casino:tourney:take')), deathPre = -(await tsum('casino:tourney:death'));
await pool.query(`UPDATE poker_tournaments SET resolves_at = now() - interval '1 minute' WHERE id='${tid2}'`);
await sweepTournaments(pool);
assert.equal((await pool.query(`SELECT status FROM poker_tournaments WHERE id='${tid2}'`)).rows[0].status, 'resolved', 'the tournament settled');
// escrow math for THIS tournament: pool 15000, Cy's 5000 burns, net 9500 (5% rake) split between the 2 live
const win2 = await tsum('casino:tourney:win') - winPre, take2 = -(await tsum('casino:tourney:take')) + takePre, death2 = -(await tsum('casino:tourney:death')) + deathPre;
assert.equal(death2, BUYIN, "the dead entrant's stake burned (casino:tourney:death)");
assert.equal(win2 + take2 + death2, 3 * BUYIN, 'buy-ins == prizes + house take + the dead burn (escrow closes)');
// both live entrants placed; the winner took the biggest share
const places = (await pool.query(`SELECT character_id, place, hand FROM poker_entries WHERE tournament_id='${tid2}' AND character_id IN ('${A.id}','${B.id}') ORDER BY place`)).rows;
assert.equal(places.length, 2, 'both live players were ranked'); assert(places.every((r) => r.hand), 'each got a dealt hand');
assert.equal(Number(places[0].place), 1, 'a first place'); assert.equal(Number(places[1].place), 2, 'and a second');
// the §10.4 escrow check reconciles across every tournament (open + settled)
const invT = await runLedgerInvariants(pool, { alert: false });
const trEsc = invT.checks.find((c) => c.name === 'poker tourney escrow');
assert(trEsc?.ok, `poker tourney escrow reconciles (drift ${trEsc?.drift})`);

// ══════════ THE TRACK: the dogs & the ponies (daily card, seed-drawn field + winner) ══════════
// the day's winner index (the seed draw weighted by the runners' TRUE p — mirrors trackWinnerOf)
const trackWinner = (race, day) => {
  const rs = trackFieldOf(race, day);
  const r = hash01(`trackwin:${race}:${day}:${MARKET_SEED}`);
  let acc = 0;
  for (let k = 0; k < rs.length; k++) { acc += rs[k].p; if (r < acc) return k; }
  return rs.length - 1;
};
await seed("loc='neon'");
// the card is public + priced with a uniform ~15% takeout (posted odds = (1/p)×(1−EDGE))
const denT = (await call('GET', '/v1/casino', { token })).body.track;
assert(denT && Array.isArray(denT.dogs) && denT.dogs.length === CASINO.TRACK.FIELD, 'the dog card shows the full field');
assert(denT.horses.length === CASINO.TRACK.FIELD && denT.dogs.every((r) => r.odds >= 1.1 && r.odds <= CASINO.TRACK.MAX_ODDS), 'horses too, odds in range');
assert(denT.dogs.every((r) => r.name && !('p' in r)), 'the field shows names + odds, never the true probability');
// gates: bad race / min / max / bad runner
assert.equal((await call('POST', '/v1/casino/track', { token, body: { race: 'cats', runner: 0, amount: 100 } })).body.error, 'race', "bet the 'dogs' or the 'horses'");
// R24 input-validation: a prototype key (constructor/__proto__) must NOT slip the dogs|horses allow-list
assert.equal((await call('POST', '/v1/casino/track', { token, body: { race: 'constructor', runner: 0, amount: 100 } })).body.error, 'race', 'a prototype key is rejected, not a phantom race');
assert.equal((await call('POST', '/v1/casino/track', { token, body: { race: '__proto__', runner: 0, amount: 100 } })).body.error, 'race', '__proto__ is rejected too');
assert.equal((await call('POST', '/v1/casino/track', { token, body: { race: 'dogs', runner: 0, amount: 10 } })).body.error, 'min', 'track minimum $50');
assert.equal((await call('POST', '/v1/casino/track', { token, body: { race: 'dogs', runner: 0, amount: 999999 } })).body.error, 'max', 'the window caps the bet');
assert.equal((await call('POST', '/v1/casino/track', { token, body: { race: 'dogs', runner: 99, amount: 100 } })).body.error, 'runner', 'a runner must be in the field');
// back the WINNING dog, backdate to yesterday, claim at the LOCKED odds (a bookmaker's board — the
// price you took at bet time, not a recomputed one)
const tDay = dayOf();
const dogWin = trackWinner('dogs', tDay - 1);
let tr2 = await call('POST', '/v1/casino/track', { token, body: { race: 'dogs', runner: dogWin, amount: 2000 } });
assert.equal(tr2.code, 200, 'a bet on the dogs'); assert(tr2.body.horse && tr2.body.odds, 'the ticket names the runner + odds');
const dogLockedOdds = tr2.body.odds; // the odds locked on the ticket
assert.equal((await call('POST', '/v1/casino/track', { token, body: { race: 'dogs', runner: 0, amount: 100 } })).body.error, 'bet', 'one ticket a race');
assert.equal((await call('POST', '/v1/casino/track/claim', { token })).body.settled, 0, "today's race hasn't run — nothing to settle");
await pool.query(`UPDATE track_bets SET day=${tDay - 1} WHERE character_id='${cid}' AND race='dogs'`);
const cashPreTrack = (await meOf(token)).cash;
tr2 = await call('POST', '/v1/casino/track/claim', { token });
assert.equal(tr2.body.settled, 1, 'the race settled'); assert.equal(tr2.body.results[0].hit, true, 'the pick won');
const dogPayout = Math.floor(2000 * dogLockedOdds);
assert.equal(tr2.body.won, dogPayout, 'paid the LOCKED odds on the stake');
assert.equal((await meOf(token)).cash, cashPreTrack + dogPayout, 'the payout landed in pocket');
assert.equal(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='casino:win:track' AND character_id='${cid}'`)).rows[0].s), dogPayout, 'the win is a ledgered casino:win:track faucet');
// a LOSING ticket (back a non-winner on the horses) settles to nothing — the stake was a ledgered sink
const horseWin = trackWinner('horses', tDay - 1);
const horseLoser = (horseWin + 1) % CASINO.TRACK.FIELD;
tr2 = await call('POST', '/v1/casino/track', { token, body: { race: 'horses', runner: horseLoser, amount: 1500 } });
assert.equal(tr2.code, 200, 'a horse ticket — a second race the same day (dogs slot was separate)');
await pool.query(`UPDATE track_bets SET day=${tDay - 1} WHERE character_id='${cid}' AND race='horses'`);
tr2 = await call('POST', '/v1/casino/track/claim', { token });
assert.equal(tr2.body.settled, 1, 'the horse race settled'); assert.equal(tr2.body.won, 0, 'the loser paid nothing');
assert.equal(-(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='casino:bet:track' AND character_id='${cid}'`)).rows[0].s)), 3500, 'both stakes ($2000 + $1500) are ledgered casino:bet:track sinks');

// ══════════ THE TRACK step three: RUN IN THE CARD (player racers in the daily card) ══════════
const { body: { token: ownTok } } = await call('POST', '/v1/auth/guest');
await call('POST', '/v1/character', { token: ownTok, body: { name: 'Owner Otto' } });
const oid = (await meOf(ownTok)).id;
await pool.query(`UPDATE characters SET respect=1000, cash=300000, loc='neon', energy=200 WHERE id='${oid}'`);
const oAid = (await pool.query(`SELECT account_id a FROM characters WHERE id='${oid}'`)).rows[0].a;
// buy a greyhound + max its form (25/25/25 → form 75, the class of the field)
const buyR = await call('POST', '/v1/stable/buy', { token: ownTok, body: { kind: 'dog', name: 'Rocket Dog' } });
assert.equal(buyR.code, 200, 'otto buys a greyhound'); const rocket = buyR.body.id;
await pool.query(`UPDATE racers SET speed=25, stamina=25, heart=25 WHERE id='${rocket}'`);
// enter gates: at the track only, one runner a card
await pool.query(`UPDATE characters SET loc='docks' WHERE id='${oid}'`);
assert.equal((await call('POST', `/v1/casino/track/enter/${rocket}`, { token: ownTok })).body.error, 'district', 'entries are taken at the track');
await pool.query(`UPDATE characters SET loc='neon' WHERE id='${oid}'`);
const cashPreEnter = (await meOf(ownTok)).cash;
const ent = await call('POST', `/v1/casino/track/enter/${rocket}`, { token: ownTok });
assert.equal(ent.code, 200, 'otto runs Rocket Dog in the card'); assert.equal(ent.body.race, 'dogs', 'a greyhound runs in the dogs race');
assert.equal((await meOf(ownTok)).cash, cashPreEnter - CASINO.TRACK.ENTRY_FEE, 'the nomination fee left the pocket');
assert.equal(-(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='casino:track:entry' AND character_id='${oid}'`)).rows[0].s)), CASINO.TRACK.ENTRY_FEE, 'ledgered casino:track:entry sink');
assert.equal((await call('POST', `/v1/casino/track/enter/${rocket}`, { token: ownTok })).body.error, 'entered', 'one runner a card');
// the merged card shows the player runner (the last post) flagged as a player entry, short-priced
const card = (await call('GET', '/v1/casino', { token: ownTok })).body.track;
const mine = card.dogs.find((r) => r.name === 'Rocket Dog');
assert(mine && mine.player === true, 'the player runner appears in the dogs card flagged player:true');
assert(mine.post === CASINO.TRACK.FIELD && mine.odds >= 1.1 && mine.odds < 6, 'the maxed racer takes the outside post as the short-priced favorite');
// find a past day where Rocket Dog (post FIELD-1) wins the dogs (reproduce the server's merged draw)
const myEntry = [{ post: CASINO.TRACK.FIELD - 1, form: 75, racer_name: 'Rocket Dog', character_id: oid, racer_id: rocket }];
const winnerIdx = (race, day, es) => { const rs = trackFieldOf(race, day, es); const rr = hash01(`trackwin:${race}:${day}:${MARKET_SEED}`); let acc = 0; for (let k = 0; k < rs.length; k++) { acc += rs[k].p; if (rr < acc) return k; } return rs.length - 1; };
let winDay = null; for (let d = dayOf() - 1; d > dayOf() - 500 && winDay === null; d--) if (winnerIdx('dogs', d, myEntry) === CASINO.TRACK.FIELD - 1) winDay = d;
assert(winDay !== null, 'found a day the favorite wins its card');
// the owner backs their own dog TODAY (locks the odds), then we roll the card into that winning day
const bet = await call('POST', '/v1/casino/track', { token: ownTok, body: { race: 'dogs', runner: CASINO.TRACK.FIELD - 1, amount: 1000 } });
assert.equal(bet.code, 200, 'a bet on the player runner'); assert.equal(bet.body.player, true, 'the ticket knows it backed a player racer');
const lockedOdds = bet.body.odds;
await pool.query(`UPDATE track_bets SET day=${winDay} WHERE character_id='${oid}' AND race='dogs'`);
await pool.query(`UPDATE track_entries SET day=${winDay} WHERE character_id='${oid}' AND race='dogs'`);
const claimPre = (await meOf(ownTok)).cash;
const trClaim = await call('POST', '/v1/casino/track/claim', { token: ownTok });
assert.equal(trClaim.body.settled, 1, 'the ticket settled'); assert.equal(trClaim.body.results[0].hit, true, 'Rocket Dog came home');
assert.equal(trClaim.body.won, Math.floor(1000 * lockedOdds), 'paid at the LOCKED odds (the bookmaker board), not a recomputed price');
assert.equal((await meOf(ownTok)).cash, claimPre + Math.floor(1000 * lockedOdds), 'the payout landed');
// the worker banks the racer's card win (status only — its record + the owner legend)
const winsPre = Number((await pool.query(`SELECT wins FROM racers WHERE id='${rocket}'`)).rows[0].wins);
const legPre = Number((await pool.query(`SELECT racer_wins FROM account_persistent WHERE account_id='${oAid}'`)).rows[0].racer_wins);
await sweepTrackEntries(pool);
assert.equal(Number((await pool.query(`SELECT wins FROM racers WHERE id='${rocket}'`)).rows[0].wins), winsPre + 1, "the racer's card win banked on its record");
assert.equal(Number((await pool.query(`SELECT racer_wins FROM account_persistent WHERE account_id='${oAid}'`)).rows[0].racer_wins), legPre + 1, 'the owner legend banked the win (account-level)');
assert.equal((await pool.query(`SELECT settled FROM track_entries WHERE character_id='${oid}' AND race='dogs'`)).rows[0].settled, true, 'the entry is settled (idempotent)');
await sweepTrackEntries(pool); // idempotent — a second sweep banks nothing
assert.equal(Number((await pool.query(`SELECT wins FROM racers WHERE id='${rocket}'`)).rows[0].wins), winsPre + 1, 'a second sweep is a no-op');

// ── regression (red-team step three): distinct posts + the slot cap. Two owners entering the same card
// must get DISTINCT posts (5, then 4 — the count→post→insert window is now serialized on street_tax),
// and a third → 'full' (PLAYER_SLOTS=2). (pg-mem is single-threaded, so this asserts the correctness the
// street_tax lock guarantees under real concurrency: no two entries share a post.)
const owners = [];
for (const nm of ['Post A', 'Post B', 'Post C']) {
  const { body: { token: t } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token: t, body: { name: nm } });
  const id = (await meOf(t)).id;
  await pool.query(`UPDATE characters SET respect=1000, cash=200000, loc='neon' WHERE id='${id}'`);
  const b = await call('POST', '/v1/stable/buy', { token: t, body: { kind: 'dog', name: `${nm} Dog` } });
  owners.push({ t, id, racer: b.body.id });
}
const e1 = await call('POST', `/v1/casino/track/enter/${owners[0].racer}`, { token: owners[0].t });
const e2 = await call('POST', `/v1/casino/track/enter/${owners[1].racer}`, { token: owners[1].t });
assert.equal(e1.code, 200, 'first owner enters the fresh card');
assert.equal(e2.code, 200, 'second owner enters the same card');
assert.equal(e1.body.post, CASINO.TRACK.FIELD, 'first owner takes the outside post');
assert.equal(e2.body.post, CASINO.TRACK.FIELD - 1, 'second owner takes a DISTINCT inner post (no collision)');
assert.notEqual(e1.body.post, e2.body.post, 'the two owners never share a post');
const e3 = await call('POST', `/v1/casino/track/enter/${owners[2].racer}`, { token: owners[2].t });
assert.equal(e3.body.error, 'full', `the card is full at PLAYER_SLOTS=${CASINO.TRACK.PLAYER_SLOTS}`);
// clear these fresh entries so they don't disturb the §10.4 sweep below
await pool.query(`DELETE FROM track_entries WHERE character_id IN ('${owners[0].id}','${owners[1].id}')`);

// ── regression (full-system red-team v4, HIGH): THE SCRATCHED-RUNNER REFUND. A bettor backs a post at LONG
// NPC odds; a STRONG player racer is then ENTERED at that same post. The winner is drawn from the MERGED
// field, so without the fix the bettor would collect the strong racer's win at the locked longshot NPC
// price. The bet snapshots WHICH runner it backed (bet_racer_id); if the identity at that post changes →
// the ticket SCRATCHES (1:1 refund), it never pays the stale price. A plain NPC bet that stays put still pays.
{
  const { body: { token: bTok } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token: bTok, body: { name: 'Scratch Sam' } });
  const bId = (await meOf(bTok)).id;
  await pool.query(`UPDATE characters SET respect=1000, cash=200000, loc='neon' WHERE id='${bId}'`);
  // bet the OUTSIDE post (the last slot, index FIELD-1) while it's still a plain NPC → bet_racer_id NULL
  const scratchBet = await call('POST', '/v1/casino/track', { token: bTok, body: { race: 'horses', runner: CASINO.TRACK.FIELD - 1, amount: 500 } });
  assert.equal(scratchBet.code, 200, 'the scratch bet placed on the NPC outside post');
  assert.equal(scratchBet.body.player, false, 'backed a plain NPC runner (no player racer there yet)');
  // now a STRONG player racer ENTERS the horses card and lands on that outside post
  const { body: { token: sTok } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token: sTok, body: { name: 'Strong Steve' } });
  const sId = (await meOf(sTok)).id;
  await pool.query(`UPDATE characters SET respect=1000, cash=300000, loc='neon' WHERE id='${sId}'`);
  const sBuy = await call('POST', '/v1/stable/buy', { token: sTok, body: { kind: 'horse', name: 'Steve Horse' } });
  const sRacer = sBuy.body.id;
  await pool.query(`UPDATE racers SET speed=25, stamina=25, heart=25 WHERE id='${sRacer}'`);
  const sEnt = await call('POST', `/v1/casino/track/enter/${sRacer}`, { token: sTok });
  assert.equal(sEnt.code, 200, 'the strong racer enters the horses card');
  assert.equal(sEnt.body.post, CASINO.TRACK.FIELD, 'and takes the outside post the bettor backed');
  // find a past day where the outside post (with the strong entry merged) WINS the horses
  const sEntry = [{ post: CASINO.TRACK.FIELD - 1, form: 75, racer_name: 'Steve Horse', character_id: sId, racer_id: sRacer }];
  let sWinDay = null; for (let d = dayOf() - 1; d > dayOf() - 500 && sWinDay === null; d--) if (winnerIdx('horses', d, sEntry) === CASINO.TRACK.FIELD - 1) sWinDay = d;
  assert(sWinDay !== null, 'found a day the merged outside post wins');
  await pool.query(`UPDATE track_bets SET day=${sWinDay} WHERE character_id='${bId}' AND race='horses'`);
  await pool.query(`UPDATE track_entries SET day=${sWinDay} WHERE character_id='${sId}' AND race='horses'`);
  const scratchPre = (await meOf(bTok)).cash;
  const scratchClaim = await call('POST', '/v1/casino/track/claim', { token: bTok });
  assert.equal(scratchClaim.body.settled, 1, 'the scratch ticket settled');
  assert.equal(scratchClaim.body.results[0].scratched, true, 'the runner backed was replaced by a player entry → SCRATCHED');
  assert.equal(scratchClaim.body.results[0].hit, false, 'a scratch is not a hit');
  assert.equal(scratchClaim.body.won, 500, 'the stake is REFUNDED 1:1 — never paid at the locked longshot odds');
  assert.equal((await meOf(bTok)).cash, scratchPre + 500, 'exactly the stake came back');
  await pool.query(`DELETE FROM track_entries WHERE character_id='${sId}'`); // don't disturb the §10.4 sweep below
}

// ══════════ THE FUTURITY (Track step four): the crowd-bet marquee for player-owned racers ══════════
process.env.FUTURITY_MS = String(30 * 60 * 1000); // a real window so betting stays open (we backdate to settle)
// three owners each nominate a racer — a clear FAVORITE (form 75) + two longshots (form 3)
const fu = [];
for (const [nm, spd] of [['Fav', 25], ['Long A', 1], ['Long B', 1]]) {
  const { body: { token: t } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token: t, body: { name: `Fut ${nm}` } });
  const id = (await meOf(t)).id;
  await pool.query(`UPDATE characters SET respect=1000, cash=300000, loc='neon' WHERE id='${id}'`);
  const aid = (await pool.query(`SELECT account_id a FROM characters WHERE id='${id}'`)).rows[0].a;
  const b = await call('POST', '/v1/stable/buy', { token: t, body: { kind: 'dog', name: `${nm} Dog` } });
  const racer = b.body.id;
  await pool.query(`UPDATE racers SET speed=${spd}, stamina=${spd}, heart=${spd} WHERE id='${racer}'`);
  fu.push({ t, id, aid, racer, nm });
}
// nomination gates: at the track + the fee burns
await pool.query(`UPDATE characters SET loc='docks' WHERE id='${fu[0].id}'`);
assert.equal((await call('POST', `/v1/casino/futurity/nominate/${fu[0].racer}`, { token: fu[0].t })).body.error, 'district', 'nominations are taken at the track');
await pool.query(`UPDATE characters SET loc='neon' WHERE id='${fu[0].id}'`);
const cashPreNom = (await meOf(fu[0].t)).cash;
const nom = await call('POST', `/v1/casino/futurity/nominate/${fu[0].racer}`, { token: fu[0].t });
assert.equal(nom.code, 200, 'the favorite is nominated'); assert.equal(nom.body.racer, 'Fav Dog', 'the right racer');
assert.equal((await meOf(fu[0].t)).cash, cashPreNom - CASINO.FUTURITY.NOMINATE_FEE, 'the nomination fee left the pocket');
assert.equal(-(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='casino:futurity:nom' AND character_id='${fu[0].id}'`)).rows[0].s)), CASINO.FUTURITY.NOMINATE_FEE, 'ledgered casino:futurity:nom sink');
assert.equal((await call('POST', `/v1/casino/futurity/nominate/${fu[0].racer}`, { token: fu[0].t })).body.error, 'entered', 'one runner per owner per card');
await call('POST', `/v1/casino/futurity/nominate/${fu[1].racer}`, { token: fu[1].t });
await call('POST', `/v1/casino/futurity/nominate/${fu[2].racer}`, { token: fu[2].t });
const fid = nom.body.futurity;
// an owner can't bet their own card
assert.equal((await call('POST', '/v1/casino/futurity/bet', { token: fu[0].t, body: { racerId: fu[0].racer, amount: 1000 } })).body.error, 'own_event', 'no betting on your own race');
// two spectators bet: A backs the favorite, B backs a longshot
const spec = [];
for (const nm of ['Punter A', 'Punter B']) {
  const { body: { token: t } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token: t, body: { name: nm } });
  const id = (await meOf(t)).id;
  await pool.query(`UPDATE characters SET respect=1000, cash=100000, loc='neon' WHERE id='${id}'`);
  spec.push({ t, id, nm });
}
assert.equal((await call('POST', '/v1/casino/futurity/bet', { token: spec[0].t, body: { racerId: 'nope', amount: 1000 } })).body.error, 'bad_runner', 'bet on a real runner');
const betA = await call('POST', '/v1/casino/futurity/bet', { token: spec[0].t, body: { racerId: fu[0].racer, amount: 1000 } });
assert.equal(betA.code, 200, 'Punter A backs the favorite'); assert.equal(betA.body.on, 'Fav Dog', 'on the favorite');
assert.equal((await call('POST', '/v1/casino/futurity/bet', { token: spec[0].t, body: { racerId: fu[1].racer, amount: 500 } })).body.error, 'already_bet', 'one bet per bettor');
await call('POST', '/v1/casino/futurity/bet', { token: spec[1].t, body: { racerId: fu[1].racer, amount: 1000 } });
// §10.4 MID-window: the futurity escrow == the two live bets ($2000)
let invMid = (await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === 'futurity escrow');
assert(invMid.ok && Math.abs(invMid.lhs - 2000) < 1, `mid-window escrow == the live pool (lhs ${invMid.lhs})`);
// backdate the window + settle via the worker
await pool.query(`UPDATE futurities SET resolves_at='${new Date(Date.now() - 1000).toISOString()}' WHERE id='${fid}'`);
const favLegPre = Number((await pool.query(`SELECT racer_wins FROM account_persistent WHERE account_id='${fu[0].aid}'`)).rows[0].racer_wins);
const punterAPre = (await meOf(spec[0].t)).cash, punterBPre = (await meOf(spec[1].t)).cash;
const favOwnerPre = (await meOf(fu[0].t)).cash;
await sweepFuturity(pool);
assert.equal((await pool.query(`SELECT status FROM futurities WHERE id='${fid}'`)).rows[0].status, 'resolved', 'the futurity settled');
assert.equal((await pool.query(`SELECT winner_racer FROM futurities WHERE id='${fid}'`)).rows[0].winner_racer, fu[0].racer, 'the favorite won (form 75 vs 3)');
// the winner's owner legend banked (account-level) + the racer record
assert.equal(Number((await pool.query(`SELECT racer_wins FROM account_persistent WHERE account_id='${fu[0].aid}'`)).rows[0].racer_wins), favLegPre + 1, 'the owner legend banked the win');
assert.equal(Number((await pool.query(`SELECT wins FROM racers WHERE id='${fu[0].racer}'`)).rows[0].wins), 1, "the racer's futurity win on its record");
// the parimutuel: A (backed the winner) gets stake back + the losing pool net of 5% vig; B loses; the owner takes half the rake as a purse
// rake = floor(1000*0.05)=50; distributable=950; A payout=1000+950=1950 (net +950); purse=25; houseCut=25
assert.equal((await meOf(spec[0].t)).cash, punterAPre + 1950, 'Punter A collected stake + the losing pool net of vig');
assert.equal((await meOf(spec[1].t)).cash, punterBPre, 'Punter B lost their stake (escrowed pre-sweep, nothing back)');
assert.equal((await meOf(fu[0].t)).cash, favOwnerPre + 25, 'the winning owner took the promoter purse (half the rake)');
assert.equal(-(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='casino:futurity:take'`)).rows[0].s)), 25, 'the house vig ledgered (NULL take)');
await sweepFuturity(pool); // idempotent — a second sweep settles nothing
// §10.4 POST-settle: the futurity escrow closes to 0 (posted − wins − refunds − purse − take − death == 0, no open pool)
const invFut = (await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === 'futurity escrow');
assert(invFut && invFut.ok, `futurity escrow reconciles post-settle (lhs ${invFut?.lhs}, rhs ${invFut?.rhs})`);

// ── §10.4: the per-character cash identity holds EXACTLY over the whole gambling session ──
// (cash was SQL-seeded once at the top — everything after that has a row, so we check the DELTA
// from the seed against the ledger sum, and the vocabulary must know every casino reason)
const me = await meOf(token);
const ledgerAll = Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='cash' AND character_id='${cid}'`)).rows[0].s);
assert(Math.abs((me.cash + me.bank - seededCash) - ledgerAll) <= 1, `every gambled dollar reconciles (drift ${(me.cash + me.bank - seededCash) - ledgerAll})`);
const inv = await runLedgerInvariants(pool, { alert: false });
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `casino:* reasons are in the §10.4 vocabulary (${JSON.stringify(vocab.unknown || [])})`);
const treas = inv.checks.find((c) => c.name === 'gang treasuries');
assert(treas.ok, `the treasury check reconciles the casino:fix sink (drift ${treas.drift})`);
// econ pass: the den's book mirrors the ledger exactly — both §10.4 identities hold
const denP = inv.checks.find((c) => c.name === 'den profit');
assert(denP?.ok, `den profit == PvE bets − wins (drift ${denP?.drift})`);
const denD = inv.checks.find((c) => c.name === 'den distributions');
assert(denD?.ok, `den tip-outs are all ledgered (drift ${denD?.drift})`);
const trFinal = inv.checks.find((c) => c.name === 'poker tourney escrow');
assert(trFinal?.ok, `poker tourney escrow holds at the end (drift ${trFinal?.drift})`);

console.log(`✅ Gambling Den test passed — neon-located tables, limits, ${wins}W/${losses}L craps session fully ledgered (stakes/payouts/profit-capped street cut exact — the mint-on-top fix), $OMR untouched, Numbers ticket lifecycle (one/day, lazy 600:1 claim, idempotent settle), step two: back-room PvP dice (${pvpW}W/${pvpL}L, exact transfer + 5% rake, half to the street), the weekly fight (capped book, neon-family fix from the treasury — and the Madame docks the buying boss 5, Underworld rivalry #3 — fixed + seed-drawn settlements), casino-front rakeback (cursor-exact, no history claims), step three: BLACKJACK (${bjWins}W/${bjLosses}L, ${bjBusts} bust, ${bjDoubles} doubled, ${bjNaturals} naturals — deal/hit/stand/double, cash-delta==net, every hand ledgered casino:*blackjack, book identity holds) + heads-up HOLD'EM (${pkW}W/${pkL}L/${pkPush} split — 5-of-7 showdown, raked pot, tie splits), step four: the POKER TOURNAMENT (buy-in escrow, short-field refund, closed-window gate, double-entry gate, a 3-handed settle with a dead entrant's stake burned + the top places splitting net of rake, and the new poker-tourney-escrow §10.4 check), THE TRACK (the dogs & the ponies — a daily seed-drawn card, uniform ~15% takeout, one WIN bet per race per day, lazy claim at the LOCKED odds, winning + losing tickets ledgered casino:*:track) + step three RUN IN THE CARD (a player enters a fit racer into the day's card — the district/one-per-card gates + the casino:track:entry nomination sink, the merged field showing the maxed racer as the short-priced favorite flagged player:true, a bet paid at the locked odds, and the worker banking the racer's card win to its record + the owner legend, idempotent) + step four THE FUTURITY (the crowd-bet marquee — owners nominate player racers for a burned casino:futurity:nom fee, the town bets parimutuel, the worker races the field and pays the winner's backers the losing pool net of vig / the owner a promoter purse / half-vig→buyback; the district/own_event/bad_runner/already_bet gates, the distinct-posts regression + slot cap, and the new futurity-escrow §10.4 check mid-window + closing to 0), §10.4 identity + vocabulary + treasury + den + tourney-escrow + futurity-escrow checks hold`);
await app.close();

// THE GAMBLING DEN test — street craps (pass line, one-call rounds) + the daily Numbers.
// Proves the guardrails: cash only ($OMR never moves), located at neon, table limits, every
// stake/payout ledgered casino:* (per-character §10.4 identity holds EXACTLY over a gambling
// session), the 1% street cut feeding the tax pool, one ticket/day, lazy claim at 600:1,
// and the vocabulary knows the new reasons. Runs on pg-mem — zero infra.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { CASINO, UNDERWORLD, numbersDrawOf, dayOf, weekOf, hash01, MARKET_SEED } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';

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
  const take = Math.min(10, Math.max(0, denProfit - denDist));      // …the tip is profit-capped
  denDist += take;
  if (r.body.win) { wins++; paidOut += 2000; denProfit -= 2000; } else losses++;
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

// ── the fight: one capped bet a week; the family holding neon can buy the result ──
// SIGN-OFF (2.5): the book won't take action from a rookie — an anti-alt floor on the fix-Sybil ring
const { body: { token: rookieTok } } = await call('POST', '/v1/auth/guest');
await call('POST', '/v1/character', { token: rookieTok, body: { name: 'Rookie Ricky' } });
await pool.query(`UPDATE characters SET cash=100000, loc='neon' WHERE id='${(await meOf(rookieTok)).id}'`);
assert.equal((await call('POST', '/v1/casino/fight', { token: rookieTok, body: { side: 'a', amount: 500 } })).body.error, 'rookie', 'a fresh alt (level 1) is refused a fight bet');
await seed('respect=200'); // Lou is level 7 — clears the fight-bet floor
assert.equal((await call('POST', '/v1/casino/fight', { token, body: { side: 'x', amount: 500 } })).body.error, 'side', "back 'a' or 'b'");
assert.equal((await call('POST', '/v1/casino/fight', { token, body: { side: 'b', amount: 50000 } })).body.error, 'max', 'fight bets cap small — the fix stays bounded');
rr = await call('POST', '/v1/casino/fight', { token, body: { side: 'b', amount: 5000 } });
assert.equal(rr.code, 200, 'backed the dog'); assert(rr.body.a && rr.body.b, 'the bout card names the fighters');
assert.equal((await call('POST', '/v1/casino/fight', { token, body: { side: 'a', amount: 500 } })).body.error, 'bet', 'one bet a bout');
assert.equal((await call('POST', '/v1/casino/fight/claim', { token })).body.settled, 0, 'the bout has not gone off yet');
// the fix: boss-only, neon-holders-only, once, treasury-funded
assert.equal((await call('POST', '/v1/casino/fight/fix', { token, body: { winner: 'b' } })).body.error, 'rank', 'no family, no fix');
await seed(`respect=${4 * 57 * 57}`); // level 58 — founding, the high-stakes room, and the casino front below
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

// ── §10.4: the per-character cash identity holds EXACTLY over the whole gambling session ──
// (cash was SQL-seeded once at the top — everything after that has a row, so we check the DELTA
// from the seed against the ledger sum, and the vocabulary must know every casino reason)
const me = await meOf(token);
const ledgerAll = Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='cash' AND character_id='${cid}'`)).rows[0].s);
assert(Math.abs((me.cash + me.bank - seededCash) - ledgerAll) <= 1, `every gambled dollar reconciles (drift ${(me.cash + me.bank - seededCash) - ledgerAll})`);
const inv = await runLedgerInvariants(pool);
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `casino:* reasons are in the §10.4 vocabulary (${JSON.stringify(vocab.unknown || [])})`);
const treas = inv.checks.find((c) => c.name === 'gang treasuries');
assert(treas.ok, `the treasury check reconciles the casino:fix sink (drift ${treas.drift})`);
// econ pass: the den's book mirrors the ledger exactly — both §10.4 identities hold
const denP = inv.checks.find((c) => c.name === 'den profit');
assert(denP?.ok, `den profit == PvE bets − wins (drift ${denP?.drift})`);
const denD = inv.checks.find((c) => c.name === 'den distributions');
assert(denD?.ok, `den tip-outs are all ledgered (drift ${denD?.drift})`);

console.log(`✅ Gambling Den test passed — neon-located tables, limits, ${wins}W/${losses}L craps session fully ledgered (stakes/payouts/profit-capped street cut exact — the mint-on-top fix), $OMR untouched, Numbers ticket lifecycle (one/day, lazy 600:1 claim, idempotent settle), step two: back-room PvP dice (${pvpW}W/${pvpL}L, exact transfer + 5% rake, half to the street), the weekly fight (capped book, neon-family fix from the treasury — and the Madame docks the buying boss 5, Underworld rivalry #3 — fixed + seed-drawn settlements), casino-front rakeback (cursor-exact, no history claims), step three: BLACKJACK (${bjWins}W/${bjLosses}L, ${bjBusts} bust, ${bjDoubles} doubled, ${bjNaturals} naturals — deal/hit/stand/double, cash-delta==net, every hand ledgered casino:*blackjack, book identity holds) + heads-up HOLD'EM (${pkW}W/${pkL}L/${pkPush} split — 5-of-7 showdown, raked pot, tie splits), §10.4 identity + vocabulary + treasury + den checks hold`);
await app.close();

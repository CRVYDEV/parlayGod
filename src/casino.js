// THE GAMBLING DEN — player-vs-house games at the Neon Mile (design: omerta-gambling-den-design.md).
// HARD RULES: cash only, never $OMR (the regulatory line); every roll server-side + rng_audit'd
// (ground rule #3); every stake a §10.4 sink (casino:bet:<game>), every payout a faucet
// (casino:win:<game>), both with character_id so the per-character cash check reconciles. The
// street's 1% cut (→ the buyback/yield loop) and the fronts' rakeback are paid ONLY from the
// house's REALIZED profit net of open liabilities (the econ-pass mint-on-top fix — see the book
// helpers below); whatever profit isn't tipped out burns. Dice are stateless (a full pass-line
// round in one call); the Numbers is a daily ticket resolved lazily against the seed-drawn number.
import crypto from 'node:crypto';
import { GameError, bus, npcTier, bumpStanding, ledger, notify, rngLog } from './game.js';
import { CASINO, UNDERWORLD, numbersDrawOf, dayOf, weekOf, levelOf, hash01, MARKET_SEED } from './rules.js';

const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const hospitalized = (ch) => ch.hosp_until && new Date(ch.hosp_until) > new Date();
const d6 = () => 1 + Math.floor(Math.random() * 6);
// blackjack: an infinite deck (each draw independent, unpredictable — the same server RNG as dice).
// rank ints 1=Ace … 11/12/13 = J/Q/K; face cards count 10, the ace 11 or 1.
const drawCard = () => 1 + Math.floor(Math.random() * 13);
const parseCards = (s) => (s ? String(s).split(',').map(Number) : []);
function handValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) { const v = c >= 10 ? 10 : c; if (c === 1) { aces++; total += 11; } else total += v; }
  while (total > 21 && aces > 0) { total -= 10; aces--; } // an ace drops 11→1 to dodge a bust
  return { total, soft: aces > 0 };
}

// ── the house's book (econ pass — the mint-on-top fix) ──
// The street's cut and the fronts' rakeback are paid ONLY out of the den's REALIZED profit
// (Σ PvE stakes − Σ PvE payouts), net of what the book still owes if every open ticket/bet hits
// (600:1 numbers, dog-odds fight liabilities held in reserve). The den distributes its winnings;
// it never emits on volume — on a bad night the street simply doesn't get tipped. Every pool
// credit is a ledgered character_id-NULL `casino:take` row, and §10.4 gained two exact identities
// (den profit == PvE bets − wins; den distributed == takes + rakeback). PvP is untouched: its
// rake is carved FROM the winner's payout (real money withheld — audited sound).
async function bumpProfit(client, delta) {
  if (delta) await client.query('UPDATE den_volume SET profit = profit + $1 WHERE id=1', [delta]);
}
// what the book still owes if every open ticket/bet hits — held back before any tip-out
async function openLiability(client) {
  const n = Number((await client.query('SELECT COALESCE(SUM(stake),0) s FROM numbers_tickets')).rows[0].s);
  const f = Number((await client.query('SELECT COALESCE(SUM(stake),0) s FROM fight_bets')).rows[0].s);
  // a LIVE blackjack hand's pending payout is reserved too (parity with numbers/fight — else the
  // street could be tipped against an unresolved hand): each hand pays at most 2× its effective bet
  // if it wins (bet × 2 on a stand, × 2 again on a double). Computed in JS to dodge the pg-mem
  // SUM-over-expression quirk.
  const bj = (await client.query('SELECT bet, dbl FROM blackjack_hands')).rows
    .reduce((s, r) => s + Number(r.bet) * (r.dbl ? 2 : 1) * 2, 0);
  // an open track ticket pays at most stake × MAX_ODDS (the longshot ceiling) — reserved so the
  // street can't be tipped against an unresolved race (parity with numbers/fight).
  const t = Number((await client.query('SELECT COALESCE(SUM(stake),0) s FROM track_bets')).rows[0].s);
  return n * CASINO.NUMBERS_PAYOUT + Math.ceil(f * CASINO.FIGHT_DOG_PAYS) + bj + Math.ceil(t * CASINO.TRACK.MAX_ODDS);
}
// distributable house profit right now (locks den_volume — serializes concurrent tip-outs)
export async function denAvailable(client) {
  const dv = (await client.query('SELECT profit, distributed FROM den_volume WHERE id=1 FOR UPDATE')).rows[0];
  return Math.floor(Number(dv.profit) - Number(dv.distributed) - (await openLiability(client)));
}
// rakeback bookkeeping hook for business.js — the payer marks what it tipped out
export async function denDistribute(client, amt) {
  if (amt > 0) await client.query('UPDATE den_volume SET distributed = distributed + $1 WHERE id=1', [amt]);
}
async function takeHouse(client, h, tax) { // PvE street cut — profit-capped, ledgered
  const pay = Math.min(tax, Math.max(0, await denAvailable(client)));
  if (pay > 0) {
    await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [pay]);
    await denDistribute(client, pay);
    await h.ledger(client, { currency: 'cash', amount: -pay, reason: 'casino:take' });
  }
}
// lifetime den stake volume — a counter (not a money bucket), the rakeback basis
async function bumpVolume(client, amt) {
  await client.query('UPDATE den_volume SET total = total + $1 WHERE id=1', [amt]);
}

function gateBet(ch, amount, min, max) {
  if (jailed(ch)) throw new GameError('jailed', 'No dice in lockup — yet.');
  if (ch.loc !== CASINO.DISTRICT) throw new GameError('district', `The den runs on the ${CASINO.DISTRICT} — the games are where the lights are.`);
  const amt = Math.floor(Number(amount));
  if (!(amt >= min)) throw new GameError('min', `Table minimum is $${min}.`);
  if (amt > max) throw new GameError('max', `Table maximum is $${max} — the house knows variance.`);
  if (Number(ch.cash) < amt) throw new GameError('cash', 'Not that much in pocket.');
  return amt;
}

// ── STREET CRAPS: the pass line, one call per round ──
// First roll 7/11 wins, 2/3/12 craps out; anything else sets the point and the server rolls on
// until the point (win) or a seven (loss). Pays 1:1 — house edge ≈ 1.41%, the authentic number.
export async function playDice(ch, amount, client, h) {
  // the HIGH-STAKES ROOM: a made player (HIGH_LVL+) plays up to HIGH_MAX a roll — or the
  // MADAME T2 velvet rope opens it at any level (an ACCESS perk; the table odds are untouched)
  const max = levelOf(Number(ch.respect)) >= CASINO.HIGH_LVL || npcTier(h, 'madame') >= 2 ? CASINO.HIGH_MAX : CASINO.MAX_BET;
  const amt = gateBet(ch, amount, CASINO.MIN_BET, max);
  // MADAME T1: the house comps your seat — dice cost no nerve (pacing QoL, the edge still pays)
  if (npcTier(h, 'madame') < 1) {
    if (Number(ch.nerve) < CASINO.DICE_NERVE) throw new GameError('nerve', 'Even dice take nerve.');
    ch.nerve = Number(ch.nerve) - CASINO.DICE_NERVE;
  }

  const rolls = [];
  const roll = () => { const r = d6() + d6(); rolls.push(r); return r; };
  let win;
  const first = roll();
  if (first === 7 || first === 11) win = true;
  else if (first === 2 || first === 3 || first === 12) win = false;
  else {
    const point = first;
    for (;;) {
      const r = roll();
      if (r === point) { win = true; break; }
      if (r === 7) { win = false; break; }
    }
  }

  const tax = Math.ceil(amt * 0.01);
  ch.cash = Number(ch.cash) - amt;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -amt, reason: 'casino:bet:dice' });
  await bumpProfit(client, amt);        // the stake enters the house's book…
  await takeHouse(client, h, tax);      // …and the street is tipped only from realized profit
  if (win) {
    const payout = amt * 2; // stake back + 1:1
    ch.cash = Number(ch.cash) + payout;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: payout, reason: 'casino:win:dice' });
    await bumpProfit(client, -payout);
  }
  await bumpVolume(client, amt);
  await bumpStanding(client, h, ch, 'madame', 1, { action: 'dice' }); // action on her floor is business
  await h.rngLog(client, ch.id, 'casino:dice', rolls[0], `${win ? 'win' : 'loss'} $${amt} [${rolls.join(',')}]`);
  await h.track(client, ch.account_id, 'casino', { game: 'dice', amt, win, rolls: rolls.length });
  if (amt >= CASINO.HIGH_FEED) bus.emit('streets', { type: 'highroller', who: ch.name, amount: amt, win }); // whale theater
  return { ok: true, game: 'dice', bet: amt, rolls, point: ![7, 11, 2, 3, 12].includes(rolls[0]) ? rolls[0] : null,
    win, net: win ? amt : -amt };
}

// ── BACK-ROOM DICE (PvP, runs under withTwoCharacters) ──
// Consent-by-listing (the bodyguard-market pattern): a fader posts an open limit; any challenger
// at the den rolls against them for a stake up to it. One symmetric 2d6 hi-roll (ties reroll —
// a fair 50/50), the winner takes the pot minus PVP_RAKE_BPS: half the rake to the street-tax
// pool, half burns. Ledger: loser −stake, winner +(stake − rake), both casino:pvp with
// counterparties — a pure transfer with a house take, §10.4-exact per character.
export function setFadeLimit(ch, limit) {
  const v = limit == null || Number(limit) === 0 ? null : Math.floor(Number(limit));
  if (v != null && !(v >= CASINO.MIN_BET && v <= CASINO.MAX_BET))
    throw new GameError('limit', `Fade limits run $${CASINO.MIN_BET}–$${CASINO.MAX_BET} (0 clears).`);
  ch.fade_limit = v;
  return { ok: true, fadeLimit: v };
}

export async function pvpDice(ch, fader, amount, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No dice in lockup — yet.');
  if (ch.loc !== CASINO.DISTRICT) throw new GameError('district', `The back room is on the ${CASINO.DISTRICT}.`);
  const limit = fader.fade_limit != null ? Math.floor(Number(fader.fade_limit)) : 0;
  if (!(limit > 0)) throw new GameError('not_fading', "They're not taking action.");
  if (jailed(fader) || hospitalized(fader) || fader.loc !== CASINO.DISTRICT)
    throw new GameError('unavailable', "They're not at the den right now.");
  const amt = Math.floor(Number(amount));
  if (!(amt >= CASINO.MIN_BET)) throw new GameError('min', `Table minimum is $${CASINO.MIN_BET}.`);
  if (amt > limit) throw new GameError('limit', `They'll only fade up to $${limit}.`);
  if (Number(ch.cash) < amt) throw new GameError('cash', 'Not that much in pocket.');
  if (Number(fader.cash) < amt) throw new GameError('their_cash', "They can't cover it right now.");
  // MADAME T1 comps the back room too — the challenger's nerve, actor-side like the standing
  if (npcTier(h, 'madame') < 1) {
    if (Number(ch.nerve) < CASINO.DICE_NERVE) throw new GameError('nerve', 'Even dice take nerve.');
    ch.nerve = Number(ch.nerve) - CASINO.DICE_NERVE;
  }

  let mine, theirs;
  do { mine = d6() + d6(); theirs = d6() + d6(); } while (mine === theirs); // ties reroll — fair 50/50
  const win = mine > theirs;
  const pot = amt * 2;
  const rake = Math.ceil(pot * CASINO.PVP_RAKE_BPS / 10000);
  const winner = win ? ch : fader, loser = win ? fader : ch;
  loser.cash = Number(loser.cash) - amt;
  winner.cash = Number(winner.cash) + amt - rake; // their own stake never left; net +stake − rake
  await h.ledger(client, { characterId: loser.id, currency: 'cash', amount: -amt, reason: 'casino:pvp', counterparty: winner.id });
  await h.ledger(client, { characterId: winner.id, currency: 'cash', amount: amt - rake, reason: 'casino:pvp', counterparty: loser.id });
  // half the rake to the street, the rest burns — a DIRECT credit, not takeHouse: the pvp rake is
  // carved FROM the winner's payout (real money withheld), so it needs no profit cap and must not
  // touch the PvE profit book (pvp rows aren't casino:bet/win — the §10.4 den identities stay exact).
  // LOCK ORDER (AUDIT-full-system-v2 B-H1): bump den_volume BEFORE crediting street_tax so this path
  // matches the PvE trio's den_volume→street_tax order — else the two hottest den paths AB-BA.
  await bumpVolume(client, pot);
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [Math.floor(rake / 2)]);
  await bumpStanding(client, h, ch, 'madame', 3, { action: 'fade' }); // back-room action is her favorite kind
  await h.rngLog(client, ch.id, `casino:pvp:${fader.id}`, mine, `${win ? 'win' : 'loss'} $${amt} (${mine} vs ${theirs})`);
  await h.notify(client, fader.id, 'backroom_dice', { from: ch.name, amount: amt, theyWon: !win });
  await h.track(client, ch.account_id, 'casino', { game: 'pvp', amt, win });
  if (pot >= CASINO.HIGH_FEED) bus.emit('streets', { type: 'highroller', who: `${ch.name} v ${fader.name}`, amount: pot, win });
  return { ok: true, game: 'pvp', bet: amt, you: mine, them: theirs, win, rake, net: win ? amt - rake : -amt };
}

// ── THE FIGHT (weekly bout): bet the book, or FIX it if your family runs the Neon Mile ──
const FIGHTERS = ['Sailor Sal', 'Kid Canvas', 'Iron Enzo', 'Gino the Bell', 'Two-Ton Tony', 'The Preacher'];
export function boutOf(week = weekOf()) {
  const i = Math.floor(hash01(`bout:${week}:${MARKET_SEED}`) * FIGHTERS.length);
  const j = (i + 1 + Math.floor(hash01(`bout2:${week}:${MARKET_SEED}`) * (FIGHTERS.length - 1))) % FIGHTERS.length;
  return { week, a: FIGHTERS[i], b: FIGHTERS[j], favPays: CASINO.FIGHT_FAV_PAYS, dogPays: CASINO.FIGHT_DOG_PAYS };
}
// the result: the fix rules if one landed, else the seed draw (favorite at FAV_P)
async function fightResultOf(client, week) {
  const fix = (await client.query('SELECT winner FROM fight_fixes WHERE week=$1', [week])).rows[0];
  if (fix) return { winner: fix.winner, fixed: true };
  return { winner: hash01(`fight:${week}:${MARKET_SEED}`) < CASINO.FIGHT_FAV_P ? 'a' : 'b', fixed: false };
}

export async function betFight(ch, side, amount, client, h) {
  // SIGN-OFF (2.5): an anti-alt floor so a fix-Sybil ring can't field free throwaway bettors — each
  // fixed-side alt must be a real, leveled character (the WANTED_MIN_LVL / npcHit rookie-floor precedent).
  if (levelOf(Number(ch.respect)) < CASINO.FIGHT_BET_MIN_LVL)
    throw new GameError('rookie', `The book doesn't take action from rookies — reach level ${CASINO.FIGHT_BET_MIN_LVL} first.`);
  const amt = gateBet(ch, amount, CASINO.MIN_BET, CASINO.FIGHT_MAX);
  if (side !== 'a' && side !== 'b') throw new GameError('side', "Back 'a' (the favorite) or 'b' (the dog).");
  const week = weekOf();
  const existing = (await client.query('SELECT 1 FROM fight_bets WHERE character_id=$1 AND week=$2', [ch.id, week])).rows[0];
  if (existing) throw new GameError('bet', 'One bet a bout — the book knows your face.');
  await client.query('INSERT INTO fight_bets (character_id, week, side, stake) VALUES ($1,$2,$3,$4)', [ch.id, week, side, amt]);
  ch.cash = Number(ch.cash) - amt;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -amt, reason: 'casino:bet:fight' });
  await bumpProfit(client, amt); // the open bet's dog-odds exposure is held back by openLiability
  await takeHouse(client, h, Math.ceil(amt * 0.01));
  await bumpVolume(client, amt);
  await bumpStanding(client, h, ch, 'madame', 2, { action: 'fight' }); // she holds the book
  await h.track(client, ch.account_id, 'casino', { game: 'fight', amt, side });
  return { ok: true, game: 'fight', ...boutOf(week), side, stake: amt };
}

// settle every matured bet (week < current — the bout is final once the week ends)
export async function claimFight(ch, client, h) {
  const now = weekOf();
  const bets = (await client.query('SELECT * FROM fight_bets WHERE character_id=$1 AND week < $2 FOR UPDATE', [ch.id, now])).rows;
  if (!bets.length) return { ok: true, settled: 0, won: 0 };
  let won = 0;
  const results = [];
  for (const b of bets) {
    const res = await fightResultOf(client, Number(b.week));
    const hit = b.side === res.winner;
    if (hit) {
      const pays = res.winner === 'a' ? CASINO.FIGHT_FAV_PAYS : CASINO.FIGHT_DOG_PAYS;
      const payout = Math.floor(Number(b.stake) * pays);
      won += payout;
      ch.cash = Number(ch.cash) + payout;
      await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: payout, reason: 'casino:win:fight' });
      await bumpProfit(client, -payout);
    }
    results.push({ week: Number(b.week), side: b.side, winner: res.winner, hit });
    await client.query('DELETE FROM fight_bets WHERE character_id=$1 AND week=$2', [ch.id, b.week]);
  }
  await h.track(client, ch.account_id, 'casino', { game: 'fight_claim', settled: bets.length, won });
  return { ok: true, settled: bets.length, won, results };
}

// THE FIX — the turf perk with teeth: the boss/underboss of the family holding the Neon Mile
// buys this week's result, once, for FIGHT_FIX_COST from the TREASURY (a §10.4 treasury sink,
// character_id NULL like gang:war). The bettors never know until the bell. The abuse bound is
// structural: bets cap at FIGHT_MAX/street/week, so a fix can mint at most stake × payout per
// conspirator — a bounded family play, not a faucet.
export async function fixFight(ch, winner, client, h) {
  if (h.owned.gangRole !== 'boss' && h.owned.gangRole !== 'underboss')
    throw new GameError('rank', 'Only the boss or underboss buys a referee.');
  if (winner !== 'a' && winner !== 'b') throw new GameError('side', "Fix it for 'a' or 'b'.");
  const holder = (await client.query("SELECT holder_gang FROM districts WHERE id=$1", [CASINO.DISTRICT])).rows[0];
  if (!holder || holder.holder_gang !== h.owned.gangId)
    throw new GameError('turf', `The fix belongs to whoever runs the ${CASINO.DISTRICT}.`);
  const week = weekOf();
  // audit (race → raw 500): the once-a-week check runs UNDER the gang lock (a boss/underboss
  // double-submit serializes there), and the week-PK insert is the true arbiter — a loser
  // crossing gangs (neon seized between checks) gets a clean 'fixed', not a 23505 500.
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  const existing = (await client.query('SELECT 1 FROM fight_fixes WHERE week=$1', [week])).rows[0];
  if (existing) throw new GameError('fixed', "This bout's already been bought.");
  if (Number(g.treasury) < CASINO.FIGHT_FIX_COST)
    throw new GameError('treasury', `A referee costs $${CASINO.FIGHT_FIX_COST} from the treasury.`);
  await client.query('UPDATE gangs SET treasury = treasury - $2 WHERE id=$1', [h.owned.gangId, CASINO.FIGHT_FIX_COST]);
  try {
    await client.query('INSERT INTO fight_fixes (week, gang_id, winner) VALUES ($1,$2,$3)', [week, h.owned.gangId, winner]);
  } catch (e) {
    if (e?.code === '23505') throw new GameError('fixed', "This bout's already been bought.");
    throw e;
  }
  await h.ledger(client, { currency: 'cash', amount: -CASINO.FIGHT_FIX_COST, reason: 'casino:fix', counterparty: h.owned.gangId });
  if (h.owned.gang) h.owned.gang.treasury = Number(g.treasury) - CASINO.FIGHT_FIX_COST;
  // RIVALRY #3 (Underworld step five): nobody fixes HER book — the buying boss wears it
  await bumpStanding(client, h, ch, 'madame', -UNDERWORLD.STEP5.FIX_LOSS);
  await h.track(client, ch.account_id, 'casino', { game: 'fix', week, winner });
  return { ok: true, week, winner, cost: CASINO.FIGHT_FIX_COST };
}

// ── THE TRACK: the dogs & the ponies — a daily race card, bet the field ──
// Two races a day (greyhounds + horses), each a FIELD of runners drawn off the §7.11 seed. Each
// runner gets a true win probability p (seeded weights, normalized) and posted decimal odds =
// (1/p)×(1−EDGE), so the book takes a uniform EDGE takeout on every runner. The winner is drawn
// from the seed weighted by the TRUE p (the odds carry the vig, the draw does not — so it's fair
// and verifiable). One WIN bet per race per street per day, settled lazily the next day (the
// numbers/fight pattern). Cash only; the payout rides casino:win:track (under the den book).
const GREYHOUNDS = ['Grey Ghost', 'Blue Streak', 'Ol’ Rocket', 'Ash-Can Annie', 'Midnight Mick',
  'Lucky Paws', 'Iron Jaw', 'Sad-Eye Sam', 'Canal Kid', 'Dockyard Dot'];
const RACEHORSES = ['War Admiral', 'Sea Biscuit', 'Man o’ Sand', 'Dark Star', 'Native Dancer',
  'Whirlaway', 'Gallant Fox', 'Citation', 'Northern Bell', 'Silky Sullivan'];
const TRACK_RACES = { dogs: GREYHOUNDS, horses: RACEHORSES };

// today's field for a race — deterministic per day + race off the seed
export function trackFieldOf(race, day = dayOf()) {
  const pool = TRACK_RACES[race];
  if (!pool) return null;
  const { FIELD, EDGE, MAX_ODDS } = CASINO.TRACK;
  const start = Math.floor(hash01(`track:${race}:${day}:${MARKET_SEED}`) * pool.length);
  const ws = [];
  let wsum = 0;
  for (let k = 0; k < FIELD; k++) {
    const w = 0.2 + hash01(`trackw:${race}:${day}:${k}:${MARKET_SEED}`) * 1.8; // [0.2, 2.0]
    ws.push(w); wsum += w;
  }
  const runners = [];
  for (let k = 0; k < FIELD; k++) {
    const p = ws[k] / wsum;
    const odds = Math.min(MAX_ODDS, Math.max(1.1, Math.round((1 / p) * (1 - EDGE) * 100) / 100));
    runners.push({ post: k + 1, name: pool[(start + k) % pool.length], odds, p });
  }
  return runners;
}
// the day's winner index for a race — the seed draw weighted by the TRUE p (edge-free)
function trackWinnerOf(race, day) {
  const runners = trackFieldOf(race, day);
  const r = hash01(`trackwin:${race}:${day}:${MARKET_SEED}`);
  let acc = 0;
  for (let k = 0; k < runners.length; k++) { acc += runners[k].p; if (r < acc) return k; }
  return runners.length - 1;
}
// the card as shown to a player (no p leaked — just the field + odds)
function trackCardOf(day = dayOf()) {
  const strip = (rs) => rs.map(({ post, name, odds }) => ({ post, name, odds }));
  return { day, dogs: strip(trackFieldOf('dogs', day)), horses: strip(trackFieldOf('horses', day)) };
}

export async function betTrack(ch, race, runner, amount, client, h) {
  if (!TRACK_RACES[race]) throw new GameError('race', "Bet the 'dogs' or the 'horses'.");
  const amt = gateBet(ch, amount, CASINO.TRACK.MIN_BET, CASINO.TRACK.MAX_BET);
  const idx = Math.floor(Number(runner));
  const field = trackFieldOf(race);
  if (!(idx >= 0 && idx < field.length)) throw new GameError('runner', `Pick a post, 1 through ${field.length}.`);
  const day = dayOf();
  const existing = (await client.query('SELECT 1 FROM track_bets WHERE character_id=$1 AND day=$2 AND race=$3', [ch.id, day, race])).rows[0];
  if (existing) throw new GameError('bet', 'One ticket a race — the window knows your face.');
  await client.query('INSERT INTO track_bets (character_id, day, race, runner, stake) VALUES ($1,$2,$3,$4,$5)', [ch.id, day, race, idx, amt]);
  ch.cash = Number(ch.cash) - amt;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -amt, reason: 'casino:bet:track' });
  await bumpProfit(client, amt);              // the open bet's odds exposure is held back by openLiability
  await takeHouse(client, h, Math.ceil(amt * 0.01));
  await bumpVolume(client, amt);
  await bumpStanding(client, h, ch, 'madame', 2, { action: 'track' }); // her floor, her book
  await h.track(client, ch.account_id, 'casino', { game: 'track', race, runner: idx, amt });
  const pick = field[idx];
  return { ok: true, game: 'track', race, day, runner: idx, post: pick.post, horse: pick.name, odds: pick.odds, stake: amt };
}

// settle every matured ticket (day < today — the race ran at the day's end)
export async function claimTrack(ch, client, h) {
  const today = dayOf();
  const bets = (await client.query('SELECT * FROM track_bets WHERE character_id=$1 AND day < $2 FOR UPDATE', [ch.id, today])).rows;
  if (!bets.length) return { ok: true, settled: 0, won: 0 };
  let won = 0;
  const results = [];
  for (const b of bets) {
    const d = Number(b.day);
    const winner = trackWinnerOf(b.race, d);
    const field = trackFieldOf(b.race, d);
    const hit = Number(b.runner) === winner;
    if (hit) {
      const payout = Math.floor(Number(b.stake) * field[Number(b.runner)].odds);
      won += payout;
      ch.cash = Number(ch.cash) + payout;
      await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: payout, reason: 'casino:win:track' });
      await bumpProfit(client, -payout);
    }
    results.push({ day: d, race: b.race, runner: Number(b.runner), winner, winnerName: field[winner].name, hit });
    await client.query('DELETE FROM track_bets WHERE character_id=$1 AND day=$2 AND race=$3', [ch.id, d, b.race]);
  }
  await h.track(client, ch.account_id, 'casino', { game: 'track_claim', settled: bets.length, won });
  return { ok: true, settled: bets.length, won, results };
}

// ── THE NUMBERS: pick 0–999, one ticket per street per day, pays 600:1 on the day's draw ──
export async function playNumbers(ch, pick, amount, client, h) {
  const amt = gateBet(ch, amount, CASINO.NUMBERS_MIN, CASINO.NUMBERS_MAX);
  const n = Math.floor(Number(pick));
  if (!(n >= 0 && n <= 999)) throw new GameError('pick', 'Pick a number, 0 through 999.');
  const day = dayOf();
  const existing = (await client.query('SELECT 1 FROM numbers_tickets WHERE character_id=$1 AND day=$2', [ch.id, day])).rows[0];
  if (existing) throw new GameError('ticket', "One ticket a day — the runner knows your face.");
  await client.query('INSERT INTO numbers_tickets (character_id, day, pick, stake) VALUES ($1,$2,$3,$4)', [ch.id, day, n, amt]);
  const tax = Math.ceil(amt * 0.01);
  ch.cash = Number(ch.cash) - amt;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -amt, reason: 'casino:bet:numbers' });
  await bumpProfit(client, amt); // the ticket's 600:1 exposure is held back by openLiability
  await takeHouse(client, h, tax);
  await bumpVolume(client, amt);
  await bumpStanding(client, h, ch, 'madame', 1, { action: 'numbers' }); // the runner reports who plays
  await h.track(client, ch.account_id, 'casino', { game: 'numbers', amt, pick: n });
  return { ok: true, game: 'numbers', pick: n, stake: amt, drawsOnDay: day + 1, payout: CASINO.NUMBERS_PAYOUT };
}

// Settle every MATURED ticket (day < today — the draw for a day is final once the day ends).
// Wins credit casino:win:numbers; losing tickets just close. Idempotent: tickets are deleted in
// the same transaction that settles them.
export async function claimNumbers(ch, client, h) {
  const today = dayOf();
  const tickets = (await client.query('SELECT * FROM numbers_tickets WHERE character_id=$1 AND day < $2 FOR UPDATE', [ch.id, today])).rows;
  if (!tickets.length) return { ok: true, settled: 0, won: 0 };
  let won = 0;
  const results = [];
  for (const t of tickets) {
    const drawn = numbersDrawOf(Number(t.day));
    const hit = Number(t.pick) === drawn;
    if (hit) {
      const payout = Number(t.stake) * CASINO.NUMBERS_PAYOUT;
      won += payout;
      ch.cash = Number(ch.cash) + payout;
      await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: payout, reason: 'casino:win:numbers' });
      await bumpProfit(client, -payout);
      await h.notify(client, ch.id, 'numbers_hit', { day: Number(t.day), pick: Number(t.pick), payout });
    }
    results.push({ day: Number(t.day), pick: Number(t.pick), drawn, hit });
    await client.query('DELETE FROM numbers_tickets WHERE character_id=$1 AND day=$2', [ch.id, t.day]);
  }
  await h.track(client, ch.account_id, 'casino', { game: 'numbers_claim', settled: tickets.length, won });
  return { ok: true, settled: tickets.length, won, results };
}

// ── BLACKJACK (stateful PvE): deal → hit / stand / double ──
// The bet is taken and profit-booked at DEAL; the hand persists (blackjack_hands, one live hand per
// street) across hit/stand/double calls — each its own atomic txn under withCharacter — until it
// resolves and the payout (if any) is credited. Same book accounting as dice (casino:bet/win:blackjack,
// the profit-capped street tip). Dealer stands on BJ_DEALER_MIN and hits soft 17; a natural pays 3:2.
async function payBlackjack(ch, client, h, payout) { // the win/refund faucet + profit book
  if (payout > 0) {
    ch.cash = Number(ch.cash) + payout;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: payout, reason: 'casino:win:blackjack' });
    await bumpProfit(client, -payout);
  }
}
// play the dealer out (hit while < min, and once more on a soft 17 if the rule says so) and settle
async function resolveDealer(ch, client, h, hand, player, dealer, dbl) {
  const eff = Number(hand.bet) * (dbl ? 2 : 1);
  const pv = handValue(player);
  const dcards = [...dealer];
  for (;;) {
    const v = handValue(dcards);
    const mustHit = v.total < CASINO.BJ_DEALER_MIN || (v.total === CASINO.BJ_DEALER_MIN && v.soft && CASINO.BJ_HIT_SOFT_17);
    if (!mustHit) break;
    const c = drawCard(); dcards.push(c);
    await h.rngLog(client, ch.id, 'casino:blackjack:dealer', c, `dealer ${c}`);
  }
  const dv = handValue(dcards);
  let payout = 0, outcome;
  if (dv.total > 21) { payout = eff * 2; outcome = 'dealer_bust'; }
  else if (pv.total > dv.total) { payout = eff * 2; outcome = 'win'; }
  else if (pv.total < dv.total) { payout = 0; outcome = 'loss'; }
  else { payout = eff; outcome = 'push'; }
  await client.query('DELETE FROM blackjack_hands WHERE character_id=$1', [ch.id]);
  await payBlackjack(ch, client, h, payout);
  await h.rngLog(client, ch.id, 'casino:blackjack:end', pv.total, `${outcome} p${pv.total} d${dv.total} pay $${payout}`);
  await h.track(client, ch.account_id, 'casino', { game: 'blackjack', action: 'resolve', outcome });
  return { ok: true, game: 'blackjack', done: true, outcome, bet: eff, player, dealer: dcards,
    playerTotal: pv.total, dealerTotal: dv.total, payout, net: payout - eff };
}

export async function blackjackDeal(ch, amount, client, h) {
  const max = levelOf(Number(ch.respect)) >= CASINO.HIGH_LVL || npcTier(h, 'madame') >= 2 ? CASINO.HIGH_MAX : CASINO.MAX_BET;
  const amt = gateBet(ch, amount, CASINO.MIN_BET, max);
  if ((await client.query('SELECT 1 FROM blackjack_hands WHERE character_id=$1', [ch.id])).rows[0])
    throw new GameError('hand', "Finish the hand you're in first.");
  // MADAME T1 comps the seat — a hand costs no nerve (the dice pacing perk)
  if (npcTier(h, 'madame') < 1) {
    if (Number(ch.nerve) < CASINO.BJ_NERVE) throw new GameError('nerve', 'Even a hand takes nerve.');
    ch.nerve = Number(ch.nerve) - CASINO.BJ_NERVE;
  }
  ch.cash = Number(ch.cash) - amt;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -amt, reason: 'casino:bet:blackjack' });
  await bumpProfit(client, amt);
  await takeHouse(client, h, Math.ceil(amt * 0.01));
  await bumpVolume(client, amt);
  await bumpStanding(client, h, ch, 'madame', 1, { action: 'dice' }); // a table on her floor is business

  const player = [drawCard(), drawCard()];
  const dealer = [drawCard(), drawCard()];
  await h.rngLog(client, ch.id, 'casino:blackjack:deal', player[0], `deal p[${player}] up ${dealer[0]}`);
  const pv = handValue(player), dv = handValue(dealer);
  const pBJ = pv.total === 21, dBJ = dv.total === 21;
  if (pBJ || dBJ) { // a natural on either side ends it at the deal
    let payout = 0, outcome;
    if (pBJ && dBJ) { payout = amt; outcome = 'push'; }
    else if (pBJ) { payout = amt + Math.floor(amt * CASINO.BJ_PAYS_BPS / 10000); outcome = 'blackjack'; }
    else outcome = 'dealer_blackjack';
    await payBlackjack(ch, client, h, payout);
    await h.track(client, ch.account_id, 'casino', { game: 'blackjack', action: 'deal', outcome });
    return { ok: true, game: 'blackjack', done: true, outcome, bet: amt, player, dealer,
      playerTotal: pv.total, dealerTotal: dv.total, payout, net: payout - amt };
  }
  await client.query('INSERT INTO blackjack_hands (character_id, bet, player, dealer) VALUES ($1,$2,$3,$4)',
    [ch.id, amt, player.join(','), dealer.join(',')]);
  await h.track(client, ch.account_id, 'casino', { game: 'blackjack', action: 'deal', amt });
  return { ok: true, game: 'blackjack', done: false, bet: amt, player, dealerUp: dealer[0],
    playerTotal: pv.total, canDouble: true };
}

export async function blackjackHit(ch, client, h) {
  const hand = (await client.query('SELECT * FROM blackjack_hands WHERE character_id=$1 FOR UPDATE', [ch.id])).rows[0];
  if (!hand) throw new GameError('no_hand', 'No hand in play — deal first.');
  const player = parseCards(hand.player), dealer = parseCards(hand.dealer);
  const card = drawCard(); player.push(card);
  const pv = handValue(player);
  await h.rngLog(client, ch.id, 'casino:blackjack:hit', card, `hit ${card} -> ${pv.total}`);
  if (pv.total > 21) { // bust — the bet was taken at deal, no payout, hand closes
    await client.query('DELETE FROM blackjack_hands WHERE character_id=$1', [ch.id]);
    await h.track(client, ch.account_id, 'casino', { game: 'blackjack', action: 'bust' });
    return { ok: true, game: 'blackjack', done: true, outcome: 'bust', bet: Number(hand.bet), player,
      dealer, playerTotal: pv.total, payout: 0, net: -Number(hand.bet) };
  }
  await client.query('UPDATE blackjack_hands SET player=$2 WHERE character_id=$1', [ch.id, player.join(',')]);
  return { ok: true, game: 'blackjack', done: false, bet: Number(hand.bet), player, dealerUp: dealer[0],
    playerTotal: pv.total, canDouble: false };
}

export async function blackjackStand(ch, client, h) {
  const hand = (await client.query('SELECT * FROM blackjack_hands WHERE character_id=$1 FOR UPDATE', [ch.id])).rows[0];
  if (!hand) throw new GameError('no_hand', 'No hand in play — deal first.');
  return resolveDealer(ch, client, h, hand, parseCards(hand.player), parseCards(hand.dealer), hand.dbl);
}

export async function blackjackDouble(ch, client, h) {
  const hand = (await client.query('SELECT * FROM blackjack_hands WHERE character_id=$1 FOR UPDATE', [ch.id])).rows[0];
  if (!hand) throw new GameError('no_hand', 'No hand in play — deal first.');
  const player = parseCards(hand.player), dealer = parseCards(hand.dealer);
  if (player.length !== 2) throw new GameError('double', 'Double only on your first two cards.');
  const bet = Number(hand.bet);
  if (Number(ch.cash) < bet) throw new GameError('cash', 'Not enough in pocket to double.');
  ch.cash = Number(ch.cash) - bet;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -bet, reason: 'casino:bet:blackjack' });
  await bumpProfit(client, bet);
  await bumpVolume(client, bet);
  const card = drawCard(); player.push(card); // exactly one card, then stand
  const pv = handValue(player);
  await h.rngLog(client, ch.id, 'casino:blackjack:double', card, `double ${card} -> ${pv.total}`);
  if (pv.total > 21) {
    await client.query('DELETE FROM blackjack_hands WHERE character_id=$1', [ch.id]);
    await h.track(client, ch.account_id, 'casino', { game: 'blackjack', action: 'double_bust' });
    return { ok: true, game: 'blackjack', done: true, outcome: 'bust', bet: bet * 2, player, dealer,
      playerTotal: pv.total, payout: 0, net: -bet * 2 };
  }
  return resolveDealer(ch, client, h, hand, player, dealer, true);
}

// ── HEADS-UP HOLD'EM (PvP showdown, runs under withTwoCharacters) ──
// Consent-by-listing (a dealer posts a poker_limit — the fade pattern). A challenger antes an equal
// stake; both are dealt 2 hole + a shared 5-card board, best 5-of-7 wins the pot minus PVP_RAKE_BPS
// (half → street tax, half burns — the back-room-dice mechanism, §10.4-exact per character). A tie
// splits (stakes returned, no rake). One atomic showdown — no betting streets (turn-based sessions
// are deferred).
function evalFive(cs) { // returns a comparable tuple [category, ...tiebreakers], higher is better
  const ranks = cs.map((c) => c.rank).sort((a, b) => b - a);
  const flush = cs.every((c) => c.suit === cs[0].suit);
  const uniq = [...new Set(ranks)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5; // the wheel A-2-3-4-5
  }
  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  const groups = Object.entries(counts).map(([r, c]) => [c, +r]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const shape = groups.map((g) => g[0]).join('');
  const k = groups.map((g) => g[1]);
  if (straightHigh && flush) return [8, straightHigh];
  if (shape === '41') return [7, k[0], k[1]];
  if (shape === '32') return [6, k[0], k[1]];
  if (flush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (shape === '311') return [3, k[0], k[1], k[2]];
  if (shape === '221') return [2, k[0], k[1], k[2]];
  if (shape === '2111') return [1, k[0], k[1], k[2], k[3]];
  return [0, ...ranks];
}
function cmpHand(a, b) { for (let i = 0; i < Math.max(a.length, b.length); i++) { const x = a[i] || 0, y = b[i] || 0; if (x !== y) return x - y; } return 0; }
function best7(seven) { // the best 5-card hand out of 7 (21 combinations — small and exact)
  let best = null;
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 4; b++) for (let c = b + 1; c < 5; c++)
    for (let d = c + 1; d < 6; d++) for (let e = d + 1; e < 7; e++) {
      const s = evalFive([seven[a], seven[b], seven[c], seven[d], seven[e]]);
      if (!best || cmpHand(s, best) > 0) best = s;
    }
  return best;
}
const HAND_NAMES = ['high card', 'a pair', 'two pair', 'trips', 'a straight', 'a flush', 'a full house', 'quads', 'a straight flush'];
const handName = (score) => HAND_NAMES[score[0]];
function dealPoker() { // a real 52-card shuffle — distinct cards matter for poker
  const deck = [];
  for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) deck.push({ rank: r, suit: s });
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return { a: [deck[0], deck[1]], b: [deck[2], deck[3]], board: deck.slice(4, 9) };
}

export function setPokerLimit(ch, limit) {
  const v = limit == null || Number(limit) === 0 ? null : Math.floor(Number(limit));
  if (v != null && !(v >= CASINO.POKER_MIN && v <= CASINO.MAX_BET))
    throw new GameError('limit', `Poker limits run $${CASINO.POKER_MIN}–$${CASINO.MAX_BET} (0 clears).`);
  ch.poker_limit = v;
  return { ok: true, pokerLimit: v };
}

export async function playPoker(ch, dealer, amount, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No cards in lockup.');
  if (ch.loc !== CASINO.DISTRICT) throw new GameError('district', `The table is on the ${CASINO.DISTRICT}.`);
  const limit = dealer.poker_limit != null ? Math.floor(Number(dealer.poker_limit)) : 0;
  if (!(limit > 0)) throw new GameError('not_dealing', "They're not dealing a hand.");
  if (jailed(dealer) || hospitalized(dealer) || dealer.loc !== CASINO.DISTRICT)
    throw new GameError('unavailable', "They're not at the table right now.");
  const amt = Math.floor(Number(amount));
  if (!(amt >= CASINO.POKER_MIN)) throw new GameError('min', `Table minimum is $${CASINO.POKER_MIN}.`);
  if (amt > limit) throw new GameError('limit', `They'll only play up to $${limit}.`);
  if (Number(ch.cash) < amt) throw new GameError('cash', 'Not that much in pocket.');
  if (Number(dealer.cash) < amt) throw new GameError('their_cash', "They can't cover it right now.");

  const { a, b, board } = dealPoker();
  const chScore = best7([...a, ...board]), dlScore = best7([...b, ...board]);
  const c = cmpHand(chScore, dlScore);
  const pot = amt * 2;
  const rake = Math.ceil(pot * CASINO.PVP_RAKE_BPS / 10000);
  let result;
  if (c === 0) result = 'push'; // a genuine tie — each keeps their stake, no rake, no money moves
  else {
    const win = c > 0;
    const winner = win ? ch : dealer, loser = win ? dealer : ch;
    loser.cash = Number(loser.cash) - amt;
    winner.cash = Number(winner.cash) + amt - rake; // their own stake never left; net +stake − rake
    await h.ledger(client, { characterId: loser.id, currency: 'cash', amount: -amt, reason: 'casino:pvp', counterparty: winner.id });
    await h.ledger(client, { characterId: winner.id, currency: 'cash', amount: amt - rake, reason: 'casino:pvp', counterparty: loser.id });
    // bump volume BEFORE crediting street_tax (the den_volume→street_tax lock order — AUDIT-full-system-v2 B-H1)
    await bumpVolume(client, pot);
    await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [Math.floor(rake / 2)]);
    result = win ? 'win' : 'loss';
  }
  await bumpStanding(client, h, ch, 'madame', 3, { action: 'fade' }); // back-room action is her favorite kind
  await h.rngLog(client, ch.id, `casino:poker:${dealer.id}`, chScore[0], `${result} you[${handName(chScore)}] them[${handName(dlScore)}]`);
  await h.notify(client, dealer.id, 'poker_hand', { from: ch.name, amount: amt, theyWon: result === 'loss' });
  await h.track(client, ch.account_id, 'casino', { game: 'poker', amt, result });
  if (pot >= CASINO.HIGH_FEED && result !== 'push') bus.emit('streets', { type: 'highroller', who: `${ch.name} v ${dealer.name}`, amount: pot, win: result === 'win' });
  return { ok: true, game: 'poker', bet: amt, yourHole: a, theirHole: b, board,
    yourHand: handName(chScore), theirHand: handName(dlScore), result, rake: result === 'push' ? 0 : rake,
    net: result === 'win' ? amt - rake : result === 'loss' ? -amt : 0 };
}

// ── THE POKER TOURNAMENT (scheduled showdown, escrow → worker settle — the boxing main-event pattern) ──
// A CASH buy-in ESCROWS into the pool during an open registration window; the worker deals every
// LIVE entrant an independent 7-card hand and pays the top places a share of the pool net of the
// house rake (half → street tax / half burns). A pure competitive redistribution — no new emission
// (the field is net-negative by the rake), a NEW §10.4 escrow check reconciles it. One open
// tournament at a time (poker_state.current); a fresh one materializes on the next entry after the
// last settles.
const tourneyMs = () => Number(process.env.TOURNEY_MS) || CASINO.TOURNEY.REGISTER_MS; // TEST-ONLY env (SEARCH_MS pattern)
function deal7() { // an independent 7-card hand from a fresh shuffle (scales to any field — no shared board)
  const deck = [];
  for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) deck.push({ rank: r, suit: s });
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck.slice(0, 7);
}

export async function enterTournament(ch, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No cards in lockup.');
  if (ch.loc !== CASINO.DISTRICT) throw new GameError('district', `The big table is on the ${CASINO.DISTRICT}.`);
  const buyin = CASINO.TOURNEY.BUYIN;
  if (Number(ch.cash) < buyin) throw new GameError('cash', `The buy-in is $${buyin}.`);
  // materialize/find the open tournament under the state singleton lock (LOCK ORDER: char → poker_state → tournament)
  const st = (await client.query('SELECT current FROM poker_state WHERE id=1 FOR UPDATE')).rows[0];
  let t = st.current ? (await client.query("SELECT * FROM poker_tournaments WHERE id=$1 AND status='open' FOR UPDATE", [st.current])).rows[0] : null;
  if (!t) {
    const id = crypto.randomUUID();
    const resolvesAt = new Date(Date.now() + tourneyMs());
    await client.query('INSERT INTO poker_tournaments (id, status, resolves_at, pool) VALUES ($1,$2,$3,0)', [id, 'open', resolvesAt]);
    await client.query('UPDATE poker_state SET current=$1 WHERE id=1', [id]);
    t = { id, status: 'open', resolves_at: resolvesAt, pool: 0 };
  } else if (new Date(t.resolves_at) <= new Date()) {
    throw new GameError('closed', 'Registration has closed — the tournament is about to run. Try again after it settles.');
  }
  if ((await client.query('SELECT 1 FROM poker_entries WHERE tournament_id=$1 AND character_id=$2', [t.id, ch.id])).rows[0])
    throw new GameError('entered', "You're already seated at this tournament.");
  ch.cash = Number(ch.cash) - buyin;
  await client.query('INSERT INTO poker_entries (tournament_id, character_id, buyin) VALUES ($1,$2,$3)', [t.id, ch.id, buyin]);
  await client.query('UPDATE poker_tournaments SET pool = pool + $2 WHERE id=$1', [t.id, buyin]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -buyin, reason: 'casino:tourney:buyin', counterparty: t.id });
  await bumpStanding(client, h, ch, 'madame', 2); // seating a tournament is serious business
  const entrants = Number((await client.query('SELECT COUNT(*) n FROM poker_entries WHERE tournament_id=$1', [t.id])).rows[0].n);
  await h.track(client, ch.account_id, 'casino', { game: 'tourney', buyin });
  bus.emit('streets', { type: 'tourney_entry', who: ch.name, entrants });
  return { ok: true, game: 'tourney', tournament: t.id, buyin, pool: Number(t.pool) + buyin, entrants,
    closesSeconds: Math.max(0, Math.ceil((new Date(t.resolves_at) - Date.now()) / 1000)) };
}

// Worker settle: deal every LIVE entrant an independent 7-card hand, rank them, pay the top places a
// share of the pool net of the rake. Single-writer (no player-lock races), idempotent (status gate).
export async function resolveTournament(client, tid) {
  const t0 = (await client.query('SELECT * FROM poker_tournaments WHERE id=$1', [tid])).rows[0];
  if (!t0 || t0.status !== 'open') return null;
  // LOCK ORDER: entrant chars sorted → poker_state → tournament row. poker_state MUST be locked
  // BEFORE the tournament row here — clearCurrent() below writes it, and enterTournament locks
  // poker_state → tournament, so locking the tournament first would AB-BA a concurrent entry
  // (red-team: a real deadlock, previously only masked by the deadlockToRetry/worker retry).
  const entChars = (await client.query('SELECT character_id FROM poker_entries WHERE tournament_id=$1', [tid])).rows.map((r) => r.character_id).sort();
  for (const cid of entChars) await client.query('SELECT 1 FROM characters WHERE id=$1 FOR UPDATE', [cid]);
  await client.query('SELECT current FROM poker_state WHERE id=1 FOR UPDATE');
  const t = (await client.query("SELECT * FROM poker_tournaments WHERE id=$1 AND status='open' FOR UPDATE", [tid])).rows[0];
  if (!t) return null;
  const pool = Number(t.pool);
  const entries = (await client.query(
    'SELECT e.character_id, e.buyin, c.alive, c.name FROM poker_entries e LEFT JOIN characters c ON c.id=e.character_id WHERE e.tournament_id=$1', [tid])).rows;
  let deadBurn = 0;
  const live = [];
  for (const e of entries) {
    if (e.alive) live.push(e);
    else { deadBurn += Number(e.buyin); await ledger(client, { currency: 'cash', amount: -Number(e.buyin), reason: 'casino:tourney:death', counterparty: tid }); }
  }
  const clearCurrent = async () => { await client.query('UPDATE poker_state SET current=NULL WHERE id=1 AND current=$1', [tid]); };
  if (live.length < CASINO.TOURNEY.MIN_ENTRANTS) { // not enough runners — refund the field, burn the dead
    for (const e of live) {
      await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [e.character_id, Number(e.buyin)]);
      await ledger(client, { characterId: e.character_id, currency: 'cash', amount: Number(e.buyin), reason: 'casino:tourney:refund', counterparty: tid });
      await notify(client, e.character_id, 'tourney_refund', { buyin: Number(e.buyin) });
    }
    await client.query("UPDATE poker_tournaments SET status='refunded' WHERE id=$1", [tid]);
    await clearCurrent();
    return { tournament: tid, refunded: live.length };
  }
  // deal + rank (independent 7-card hands — best 5-of-7, ties share the covered places' shares)
  const ranked = live.map((e) => { const cards = deal7(); const score = best7(cards); return { ...e, score, hand: handName(score) }; })
    .sort((a, b) => cmpHand(b.score, a.score));
  const livePool = pool - deadBurn;
  const rake = Math.floor(livePool * CASINO.TOURNEY.RAKE_BPS / 10000);
  const net = livePool - rake;
  // pay the top min(field, PAYOUTS.length) places, RENORMALIZED to the field so the house edge stays
  // the 5% rake regardless of turnout (an unpaid place otherwise leaks its share to the take).
  const frac = CASINO.TOURNEY.PAYOUTS.slice(0, ranked.length);
  const denom = frac.reduce((a, b) => a + b, 0) || 1;
  const placeShare = frac.map((f) => Math.floor(net * f / denom)); // share for places 0,1,2…
  const payouts = new Array(ranked.length).fill(0);
  for (let i = 0; i < ranked.length;) { // group ties: a run of equal hands splits the covered places' shares
    let j = i; while (j + 1 < ranked.length && cmpHand(ranked[j + 1].score, ranked[i].score) === 0) j++;
    let sum = 0; for (let p = i; p <= j; p++) sum += placeShare[p] || 0;
    const each = Math.floor(sum / (j - i + 1));
    for (let p = i; p <= j; p++) payouts[p] = each;
    i = j + 1;
  }
  let handedOut = 0;
  for (let i = 0; i < ranked.length; i++) {
    const e = ranked[i], payout = payouts[i];
    if (payout > 0) {
      handedOut += payout;
      await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [e.character_id, payout]);
      await ledger(client, { characterId: e.character_id, currency: 'cash', amount: payout, reason: 'casino:tourney:win', counterparty: tid });
    }
    await client.query('UPDATE poker_entries SET place=$3, hand=$4 WHERE tournament_id=$1 AND character_id=$2', [tid, e.character_id, i + 1, e.hand]);
    await notify(client, e.character_id, 'tourney_result', { place: i + 1, of: ranked.length, hand: e.hand, payout });
  }
  const totalTake = rake + (net - handedOut); // the rake + any rounding/unpaid remainder = the house cut
  if (totalTake > 0) {
    await ledger(client, { currency: 'cash', amount: -totalTake, reason: 'casino:tourney:take', counterparty: tid });
    await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [Math.floor(totalTake / 2)]); // half → the buyback, half burns
  }
  await client.query("UPDATE poker_tournaments SET status='resolved' WHERE id=$1", [tid]);
  await clearCurrent();
  await rngLog(client, ranked[0].character_id, `casino:tourney:${tid}`, ranked[0].score[0],
    `winner ${ranked[0].name} ${ranked[0].hand} · ${ranked.length} runners · pool $${pool}`);
  bus.emit('streets', { type: 'tourney_result', winner: ranked[0].name, hand: ranked[0].hand, pool, runners: ranked.length });
  return { tournament: tid, runners: ranked.length, pool, winner: ranked[0].name, take: totalTake };
}

// worker sweep — settle every open tournament past its registration window (per-tournament txn,
// idempotent; a poison tournament can't starve the rest).
export async function sweepTournaments(pool) {
  const due = (await pool.query("SELECT id FROM poker_tournaments WHERE status='open' AND resolves_at <= now() ORDER BY resolves_at")).rows;
  let resolved = 0;
  for (const { id } of due) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); await resolveTournament(client, id); await client.query('COMMIT'); resolved++; }
    catch (e) { await client.query('ROLLBACK'); } // 40P01 / transient → next tick retries (idempotent)
    finally { client.release(); }
  }
  return { resolved };
}

// The den's front window: yesterday's number, your open tickets, the table limits.
export async function denInfo(pool, characterId) {
  const today = dayOf();
  const tickets = (await pool.query('SELECT day, pick, stake FROM numbers_tickets WHERE character_id=$1 ORDER BY day', [characterId])).rows
    .map((t) => ({ day: Number(t.day), pick: Number(t.pick), stake: Number(t.stake), matured: Number(t.day) < today }));
  const week = weekOf();
  const bet = (await pool.query('SELECT week, side, stake FROM fight_bets WHERE character_id=$1 ORDER BY week', [characterId])).rows
    .map((b) => ({ week: Number(b.week), side: b.side, stake: Number(b.stake), matured: Number(b.week) < week }));
  const trackBets = (await pool.query('SELECT day, race, runner, stake FROM track_bets WHERE character_id=$1 ORDER BY day', [characterId])).rows
    .map((t) => { const f = trackFieldOf(t.race, Number(t.day)); const r = f[Number(t.runner)];
      return { day: Number(t.day), race: t.race, runner: Number(t.runner), post: r?.post, name: r?.name, odds: r?.odds, stake: Number(t.stake), matured: Number(t.day) < today }; });
  const faders = (await pool.query(
    `SELECT id, name, fade_limit FROM characters WHERE alive AND fade_limit IS NOT NULL AND loc=$1 AND id<>$2 ORDER BY fade_limit DESC LIMIT 20`,
    [CASINO.DISTRICT, characterId])).rows.map((f) => ({ id: f.id, name: f.name, fadeLimit: Math.floor(Number(f.fade_limit)) }));
  // step three: the live blackjack hand (if any) + the open poker tables (consent-by-listing)
  const bj = (await pool.query('SELECT bet, dbl, player, dealer FROM blackjack_hands WHERE character_id=$1', [characterId])).rows[0];
  const hand = bj ? (() => { const p = parseCards(bj.player), d = parseCards(bj.dealer);
    return { bet: Number(bj.bet), doubled: !!bj.dbl, player: p, playerTotal: handValue(p).total, dealerUp: d[0], canDouble: p.length === 2 && !bj.dbl }; })() : null;
  const pokerTables = (await pool.query(
    `SELECT id, name, poker_limit FROM characters WHERE alive AND poker_limit IS NOT NULL AND loc=$1 AND id<>$2 ORDER BY poker_limit DESC LIMIT 20`,
    [CASINO.DISTRICT, characterId])).rows.map((f) => ({ id: f.id, name: f.name, limit: Math.floor(Number(f.poker_limit)) }));
  // step four: the open poker TOURNAMENT (if one's registering) + whether you're seated
  const st = (await pool.query('SELECT current FROM poker_state WHERE id=1')).rows[0];
  const tr = st?.current ? (await pool.query("SELECT * FROM poker_tournaments WHERE id=$1 AND status='open'", [st.current])).rows[0] : null;
  const tourney = tr ? {
    id: tr.id, pool: Number(tr.pool),
    entrants: Number((await pool.query('SELECT COUNT(*) n FROM poker_entries WHERE tournament_id=$1', [tr.id])).rows[0].n),
    seated: !!(await pool.query('SELECT 1 FROM poker_entries WHERE tournament_id=$1 AND character_id=$2', [tr.id, characterId])).rows[0],
    closesSeconds: Math.max(0, Math.ceil((new Date(tr.resolves_at) - Date.now()) / 1000)),
    buyin: CASINO.TOURNEY.BUYIN, payouts: CASINO.TOURNEY.PAYOUTS, minEntrants: CASINO.TOURNEY.MIN_ENTRANTS,
  } : { buyin: CASINO.TOURNEY.BUYIN, payouts: CASINO.TOURNEY.PAYOUTS, minEntrants: CASINO.TOURNEY.MIN_ENTRANTS, open: false };
  return {
    district: CASINO.DISTRICT,
    dice: { minBet: CASINO.MIN_BET, maxBet: CASINO.MAX_BET, pays: '1:1 pass line',
      highStakes: { level: CASINO.HIGH_LVL, maxBet: CASINO.HIGH_MAX } },
    numbers: { min: CASINO.NUMBERS_MIN, max: CASINO.NUMBERS_MAX, pays: `${CASINO.NUMBERS_PAYOUT}:1`,
      yesterday: numbersDrawOf(today - 1) },
    tickets,
    fight: { ...boutOf(week), max: CASINO.FIGHT_MAX, myBets: bet },
    track: { ...trackCardOf(today), minBet: CASINO.TRACK.MIN_BET, maxBet: CASINO.TRACK.MAX_BET, edgeBps: Math.round(CASINO.TRACK.EDGE * 10000), myBets: trackBets },
    backroom: { rakeBps: CASINO.PVP_RAKE_BPS, faders },
    blackjack: { minBet: CASINO.MIN_BET, maxBet: CASINO.MAX_BET, pays: `${CASINO.BJ_PAYS_BPS / 10000 * 2}:2 on a natural`, hand },
    poker: { min: CASINO.POKER_MIN, maxBet: CASINO.MAX_BET, rakeBps: CASINO.PVP_RAKE_BPS, tables: pokerTables },
    tournament: tourney,
  };
}

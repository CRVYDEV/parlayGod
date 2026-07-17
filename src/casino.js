// THE GAMBLING DEN — player-vs-house games at the Neon Mile (design: omerta-gambling-den-design.md).
// HARD RULES: cash only, never $OMR (the regulatory line); every roll server-side + rng_audit'd
// (ground rule #3); every stake a §10.4 sink (casino:bet:<game>), every payout a faucet
// (casino:win:<game>), both with character_id so the per-character cash check reconciles; 1% of
// every stake → the street-tax pool via takeHouse (the buyback/yield loop), the rest of the house
// edge burns. Dice are stateless (a full pass-line round in one call); the Numbers is a daily
// ticket resolved lazily against the seed-drawn number.
import { GameError, bus, npcTier, bumpStanding } from './game.js';
import { CASINO, UNDERWORLD, numbersDrawOf, dayOf, weekOf, levelOf, hash01, MARKET_SEED } from './rules.js';

const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const hospitalized = (ch) => ch.hosp_until && new Date(ch.hosp_until) > new Date();
const d6 = () => 1 + Math.floor(Math.random() * 6);

async function takeHouse(client, tax) {
  if (tax > 0) await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [tax]);
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
  await takeHouse(client, tax);
  if (win) {
    const payout = amt * 2; // stake back + 1:1
    ch.cash = Number(ch.cash) + payout;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: payout, reason: 'casino:win:dice' });
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
  await takeHouse(client, Math.floor(rake / 2)); // half the rake to the street; the rest burns
  await bumpVolume(client, pot);
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
  const amt = gateBet(ch, amount, CASINO.MIN_BET, CASINO.FIGHT_MAX);
  if (side !== 'a' && side !== 'b') throw new GameError('side', "Back 'a' (the favorite) or 'b' (the dog).");
  const week = weekOf();
  const existing = (await client.query('SELECT 1 FROM fight_bets WHERE character_id=$1 AND week=$2', [ch.id, week])).rows[0];
  if (existing) throw new GameError('bet', 'One bet a bout — the book knows your face.');
  await client.query('INSERT INTO fight_bets (character_id, week, side, stake) VALUES ($1,$2,$3,$4)', [ch.id, week, side, amt]);
  ch.cash = Number(ch.cash) - amt;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -amt, reason: 'casino:bet:fight' });
  await takeHouse(client, Math.ceil(amt * 0.01));
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
  const existing = (await client.query('SELECT 1 FROM fight_fixes WHERE week=$1', [week])).rows[0];
  if (existing) throw new GameError('fixed', "This bout's already been bought.");
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  if (Number(g.treasury) < CASINO.FIGHT_FIX_COST)
    throw new GameError('treasury', `A referee costs $${CASINO.FIGHT_FIX_COST} from the treasury.`);
  await client.query('UPDATE gangs SET treasury = treasury - $2 WHERE id=$1', [h.owned.gangId, CASINO.FIGHT_FIX_COST]);
  await client.query('INSERT INTO fight_fixes (week, gang_id, winner) VALUES ($1,$2,$3)', [week, h.owned.gangId, winner]);
  await h.ledger(client, { currency: 'cash', amount: -CASINO.FIGHT_FIX_COST, reason: 'casino:fix', counterparty: h.owned.gangId });
  if (h.owned.gang) h.owned.gang.treasury = Number(g.treasury) - CASINO.FIGHT_FIX_COST;
  // RIVALRY #3 (Underworld step five): nobody fixes HER book — the buying boss wears it
  await bumpStanding(client, h, ch, 'madame', -UNDERWORLD.STEP5.FIX_LOSS);
  await h.track(client, ch.account_id, 'casino', { game: 'fix', week, winner });
  return { ok: true, week, winner, cost: CASINO.FIGHT_FIX_COST };
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
  await takeHouse(client, tax);
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
      await h.notify(client, ch.id, 'numbers_hit', { day: Number(t.day), pick: Number(t.pick), payout });
    }
    results.push({ day: Number(t.day), pick: Number(t.pick), drawn, hit });
    await client.query('DELETE FROM numbers_tickets WHERE character_id=$1 AND day=$2', [ch.id, t.day]);
  }
  await h.track(client, ch.account_id, 'casino', { game: 'numbers_claim', settled: tickets.length, won });
  return { ok: true, settled: tickets.length, won, results };
}

// The den's front window: yesterday's number, your open tickets, the table limits.
export async function denInfo(pool, characterId) {
  const today = dayOf();
  const tickets = (await pool.query('SELECT day, pick, stake FROM numbers_tickets WHERE character_id=$1 ORDER BY day', [characterId])).rows
    .map((t) => ({ day: Number(t.day), pick: Number(t.pick), stake: Number(t.stake), matured: Number(t.day) < today }));
  const week = weekOf();
  const bet = (await pool.query('SELECT week, side, stake FROM fight_bets WHERE character_id=$1 ORDER BY week', [characterId])).rows
    .map((b) => ({ week: Number(b.week), side: b.side, stake: Number(b.stake), matured: Number(b.week) < week }));
  const faders = (await pool.query(
    `SELECT id, name, fade_limit FROM characters WHERE alive AND fade_limit IS NOT NULL AND loc=$1 AND id<>$2 ORDER BY fade_limit DESC LIMIT 20`,
    [CASINO.DISTRICT, characterId])).rows.map((f) => ({ id: f.id, name: f.name, fadeLimit: Math.floor(Number(f.fade_limit)) }));
  return {
    district: CASINO.DISTRICT,
    dice: { minBet: CASINO.MIN_BET, maxBet: CASINO.MAX_BET, pays: '1:1 pass line',
      highStakes: { level: CASINO.HIGH_LVL, maxBet: CASINO.HIGH_MAX } },
    numbers: { min: CASINO.NUMBERS_MIN, max: CASINO.NUMBERS_MAX, pays: `${CASINO.NUMBERS_PAYOUT}:1`,
      yesterday: numbersDrawOf(today - 1) },
    tickets,
    fight: { ...boutOf(week), max: CASINO.FIGHT_MAX, myBets: bet },
    backroom: { rakeBps: CASINO.PVP_RAKE_BPS, faders },
  };
}

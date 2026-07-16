// THE GAMBLING DEN — player-vs-house games at the Neon Mile (design: omerta-gambling-den-design.md).
// HARD RULES: cash only, never $OMR (the regulatory line); every roll server-side + rng_audit'd
// (ground rule #3); every stake a §10.4 sink (casino:bet:<game>), every payout a faucet
// (casino:win:<game>), both with character_id so the per-character cash check reconciles; 1% of
// every stake → the street-tax pool via takeHouse (the buyback/yield loop), the rest of the house
// edge burns. Dice are stateless (a full pass-line round in one call); the Numbers is a daily
// ticket resolved lazily against the seed-drawn number.
import { GameError } from './game.js';
import { CASINO, numbersDrawOf, dayOf } from './rules.js';

const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const d6 = () => 1 + Math.floor(Math.random() * 6);

async function takeHouse(client, tax) {
  if (tax > 0) await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [tax]);
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
  const amt = gateBet(ch, amount, CASINO.MIN_BET, CASINO.MAX_BET);
  if (Number(ch.nerve) < CASINO.DICE_NERVE) throw new GameError('nerve', 'Even dice take nerve.');
  ch.nerve = Number(ch.nerve) - CASINO.DICE_NERVE;

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
  await h.rngLog(client, ch.id, 'casino:dice', rolls[0], `${win ? 'win' : 'loss'} $${amt} [${rolls.join(',')}]`);
  await h.track(client, ch.account_id, 'casino', { game: 'dice', amt, win, rolls: rolls.length });
  return { ok: true, game: 'dice', bet: amt, rolls, point: ![7, 11, 2, 3, 12].includes(rolls[0]) ? rolls[0] : null,
    win, net: win ? amt : -amt };
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
  return {
    district: CASINO.DISTRICT,
    dice: { minBet: CASINO.MIN_BET, maxBet: CASINO.MAX_BET, pays: '1:1 pass line' },
    numbers: { min: CASINO.NUMBERS_MIN, max: CASINO.NUMBERS_MAX, pays: `${CASINO.NUMBERS_PAYOUT}:1`,
      yesterday: numbersDrawOf(today - 1) },
    tickets,
  };
}

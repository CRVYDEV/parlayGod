// RING POKER (casino step five — design omerta-deep-deferred-design.md §D). True multi-way
// hold'em with betting streets, built atomic-architecture-native:
//
//   THE TABLE IS AN ESCROW. Cash moves ONLY at sit-down (`casino:ring:sit`, a character_id'd sink
//   into escrow) and cash-out (`casino:ring:leave`, a character_id'd faucet back out). Stacks,
//   street bets, and pots live in poker_tables/poker_ring_seats rows — so no action ever locks
//   another player's character row (no multi-party lock graph at all; the pot pays the winner's
//   SEAT STACK, realized as cash when they leave).
//
//   THE TABLE ROW LOCK IS THE MUTEX. Every mutation path — actions, the estate, the sweep — locks
//   the poker_tables row FOR UPDATE first; seat rows are only ever touched under it. Lock order is
//   chars → tables (the actor's char via withCharacter, then the table), acyclic everywhere.
//
//   NO SIDE POTS. Raises cap at the smallest live stack (table-stakes simplified — everyone can
//   always call), the one honest simplification that keeps the state machine exact.
//
//   ANTE POKER. Everyone antes the bb each hand (no blind positions — stud-room flavor, and the
//   state machine needs no dealer button). Streets: preflop → flop → turn → river → showdown
//   (best-5-of-7 via the audited casino.js evaluator; ties split).
//
// §10.4: `casino:ring:*` rides the `casino:` cash prefix (zero vocab change; NOT under the
// den-book casino:bet:%/casino:win:% LIKE patterns — the PvE house book never sees ring money).
// The `ring poker escrow` check: Σ stacks + Σ pots == sit − leave − take − death. The rake
// (`casino:ring:take`, NULL row) is carved from the pot — half → street tax, half burns (the
// audited casino:pvp split). A dead player's stack burns (`casino:ring:death`, the dead-funder
// precedent, in runEstate). All CASINO.RING numbers are founder sign-off levers.
import crypto from 'node:crypto';
import { GameError, ledger, notify } from './game.js';
import { CASINO, levelOf , jailed } from './rules.js';
import { best7, cmpHand, handName } from './casino.js';

const uid = () => crypto.randomUUID();
const turnMs = () => (process.env.RING_TURN_MS != null ? Number(process.env.RING_TURN_MS) : CASINO.RING.TURN_MS); // TEST-ONLY env
const J = (x) => JSON.stringify(x);
const P = (x) => (x ? JSON.parse(x) : null);

function shuffle52() {
  const deck = [];
  for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) deck.push([r, s]);
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}
const asCards = (arr) => arr.map(([rank, suit]) => ({ rank, suit }));

// ── low-level: load + persist (ABSOLUTE writes, everything under the held table lock) ──
async function lockTable(client, tableId) {
  const t = (await client.query('SELECT * FROM poker_tables WHERE id=$1 FOR UPDATE', [tableId])).rows[0];
  if (!t) throw new GameError('no_table', 'That table folded up.');
  return t;
}
const seatsOf = async (client, tableId) =>
  (await client.query('SELECT * FROM poker_ring_seats WHERE table_id=$1 ORDER BY seat', [tableId])).rows;

async function persist(client, t, seats) {
  await client.query(
    `UPDATE poker_tables SET street=$2, deck=$3, board=$4, pot=$5, current_bet=$6, acting_seat=$7,
       act_deadline=$8, hand_no=$9, last_result=$10, last_action_at=now() WHERE id=$1`,
    [t.id, t.street, t.deck, t.board, t.pot, t.current_bet, t.acting_seat, t.act_deadline, t.hand_no, t.last_result]);
  for (const s of seats) {
    if (s._gone) await client.query('DELETE FROM poker_ring_seats WHERE table_id=$1 AND seat=$2', [t.id, s.seat]);
    else await client.query(
      'UPDATE poker_ring_seats SET stack=$3, hole=$4, in_hand=$5, bet_street=$6, acted=$7 WHERE table_id=$1 AND seat=$2',
      [t.id, s.seat, s.stack, s.hole, s.in_hand, s.bet_street, s.acted]);
  }
}

// ── the state machine (pure in-memory over t + seats; persist() commits it) ──
const inHand = (seats) => seats.filter((s) => s.in_hand && !s._gone);

function finishHand(t, seats, winners, showdown) {
  const pot = Number(t.pot);
  const rake = Math.min(Math.floor(pot * CASINO.RING.RAKE_BPS / 10000), CASINO.RING.RAKE_CAP_BB * Number(t.bb));
  const net = pot - rake;
  const share = winners.length ? Math.floor(net / winners.length) : 0;
  let handed = 0;
  for (const w of winners) { w.stack = Number(w.stack) + share; handed += share; }
  if (winners.length) { winners[0].stack = Number(winners[0].stack) + (net - handed); } // the odd chip to the first winner
  t._rake = winners.length ? rake : 0;        // no winner (all seats died mid-hand) → the whole pot burns
  t._deadPot = winners.length ? 0 : pot;
  t.last_result = J({
    hand: Number(t.hand_no), pot, rake: t._rake, showdown: !!showdown,
    winners: winners.map((w) => ({ name: w.name, hand: showdown ? showdown[w.seat] : null })),
  });
  for (const s of seats) { if (!s._gone) { s.in_hand = false; s.hole = null; s.bet_street = 0; s.acted = false; } }
  t.street = null; t.deck = null; t.board = null; t.pot = 0; t.current_bet = 0; t.acting_seat = null; t.act_deadline = null;
}

function showdown(t, seats) {
  const live = inHand(seats);
  const board = asCards(P(t.board) || []);
  const scored = live.map((s) => ({ s, score: best7([...asCards(P(s.hole)), ...board]) }));
  scored.sort((a, b) => cmpHand(b.score, a.score));
  const best = scored[0].score;
  const winners = scored.filter((x) => cmpHand(x.score, best) === 0).map((x) => x.s);
  const names = {};
  for (const x of scored) names[x.s.seat] = handName(x.score);
  finishHand(t, seats, winners, names);
}

// deal the next community street off the deck
function dealStreet(t) {
  const deck = P(t.deck), board = P(t.board) || [];
  const n = t.street === 'preflop' ? 3 : 1;
  for (let i = 0; i < n; i++) board.push(deck.shift());
  t.deck = J(deck); t.board = J(board);
  t.street = t.street === 'preflop' ? 'flop' : t.street === 'flop' ? 'turn' : 'river';
}

// ── THE ALL-IN RULE ──────────────────────────────────────────────────────────────────────────
// A seat with NO CHIPS is never asked to act, and a betting round only opens while at least TWO
// live seats still have chips. Both halves matter, and the second is the one that bites: the raise
// cap (`act`, below) is the smallest live stack, so the moment ANYONE is all-in the cap is 0 and
// `check` is the only legal action left for anybody. Real poker runs the board out in that spot.
//
// Handing the action to an all-in player instead is a money bug, not a cosmetic one: they have no
// decision and no reason to click, so the turn clock reaches them and `enforceDeadline` sets
// `in_hand = false` — FOLDING THEM OUT OF A POT THEY PUT THEIR ENTIRE STACK INTO, while an
// opponent simply waits them out. Reproduced deterministically three ways before this was fixed:
// a short stack all-in preflop at seat 1, the same at seat 0 (the first cut of this fix filtered
// the pending list but still handed the NEXT STREET to `live[0]` regardless of stack, so it only
// looked fixed while the short stack sat second), and — worst — a table where every seat is
// all-in, where the clock folded them one by one and the LAST SEAT STANDING took a $9,000 pot
// without a showdown. The cards decide, or the game is not poker.
//
// Returns false when no betting round is possible; the caller then runs the board out.
function openBetting(t, live) {
  t.current_bet = 0;
  for (const s of live) { s.bet_street = 0; s.acted = false; }
  const actors = live.filter((s) => Number(s.stack) > 0);
  if (actors.length < 2) { t.acting_seat = null; t.act_deadline = null; return false; }
  t.acting_seat = actors[0].seat;
  t.act_deadline = new Date(Date.now() + turnMs());
  return true;
}

// no decisions left anywhere — deal out the rest of the board and show it down
function runOut(t, seats) {
  while (t.street !== 'river') dealStreet(t);
  showdown(t, seats);
}

// advance the action pointer / the street / the hand — called after every applied action
function advance(t, seats, fromSeat) {
  const live = inHand(seats);
  if (live.length === 0) { finishHand(t, seats, [], null); return; }          // every live seat died mid-hand
  if (live.length === 1) { finishHand(t, seats, [live[0]], null); return; }   // the last man standing takes it
  const pending = live.filter((s) => !s.acted && Number(s.stack) > 0);        // all-in seats have nothing to decide
  if (pending.length) { // next pending seat in cyclic order after the seat that just acted
    const after = pending.filter((s) => s.seat > fromSeat);
    const next = (after.length ? after : pending)[0];
    t.acting_seat = next.seat;
    t.act_deadline = new Date(Date.now() + turnMs());
    return;
  }
  // street complete
  if (t.street === 'river') { showdown(t, seats); return; }
  dealStreet(t);
  if (!openBetting(t, live)) runOut(t, seats);
}

// fold out a stalled (or vanished) acting seat until the table is healthy — the never-wedge rule
function enforceDeadline(t, seats) {
  let guard = 0;
  while (t.street && guard++ < 20) {
    const acting = seats.find((s) => s.seat === t.acting_seat && !s._gone && s.in_hand);
    if (!acting) { advance(t, seats, t.acting_seat ?? -1); continue; } // the acting seat died/left — reroute
    if (t.act_deadline && new Date(t.act_deadline) <= new Date()) {
      acting.in_hand = false; acting.acted = true;                     // the clock folds them
      advance(t, seats, acting.seat); continue;
    }
    break;
  }
}

// settle a finished hand's ledger side-effects (rake → street tax / burned dead pots) — run AFTER
// the machine, still inside the txn. street_tax is a singleton locked last (the canonical order).
async function settleFinish(client, t) {
  if (t._rake > 0) {
    await ledger(client, { currency: 'cash', amount: -t._rake, reason: 'casino:ring:take', counterparty: t.id });
    await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [Math.floor(t._rake / 2)]);
  }
  if (t._deadPot > 0) await ledger(client, { currency: 'cash', amount: -t._deadPot, reason: 'casino:ring:death', counterparty: t.id });
  t._rake = 0; t._deadPot = 0;
}

// ── player actions (all under withCharacter → the table lock) ──
export async function openTable(ch, body, client, h) {
  const bb = Math.floor(Number(body?.bb) || 0);
  if (!CASINO.RING.BLINDS.includes(bb)) throw new GameError('stakes', `Tables run at $${CASINO.RING.BLINDS.join(' / $')} a hand.`);
  const t = { id: uid(), bb };
  await client.query('INSERT INTO poker_tables (id, bb) VALUES ($1,$2)', [t.id, bb]);
  const sat = await sitAt(ch, t.id, body?.buyin, client, h);
  return { ok: true, tableId: t.id, bb, ...sat };
}

export async function sitAt(ch, tableId, buyin, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No cards in lockup.');
  if (ch.loc !== CASINO.DISTRICT) throw new GameError('district', `The back room is on the ${CASINO.DISTRICT}.`, { district: CASINO.DISTRICT });
  if (levelOf(Number(ch.respect)) < CASINO.RING.MIN_LVL) throw new GameError('level', 'Earn a name before you sit down.');
  const t = await lockTable(client, tableId);
  const seats = await seatsOf(client, tableId);
  if ((await client.query('SELECT 1 FROM poker_ring_seats WHERE character_id=$1', [ch.id])).rows[0])
    throw new GameError('seated', "You're already at a table — one game at a time.");
  if (seats.length >= CASINO.RING.SEATS) throw new GameError('full', 'The table is full.');
  const amt = Math.floor(Number(buyin) || 0);
  const lo = t.bb * CASINO.RING.BUYIN_MIN_BB, hi = t.bb * CASINO.RING.BUYIN_MAX_BB;
  if (!(amt >= lo && amt <= hi)) throw new GameError('buyin', `Buy in for $${lo}–$${hi} at this table.`);
  if (Number(ch.cash) < amt) throw new GameError('cash', 'Not that much in pocket.');
  ch.cash = Number(ch.cash) - amt;
  const seat = [...Array(CASINO.RING.SEATS).keys()].find((i) => !seats.some((s) => s.seat === i));
  await client.query(
    'INSERT INTO poker_ring_seats (table_id, seat, character_id, name, stack) VALUES ($1,$2,$3,$4,$5)',
    [tableId, seat, ch.id, ch.name, amt]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -amt, reason: 'casino:ring:sit', counterparty: tableId });
  await h.track(client, ch.account_id, 'ring_sit', { table: tableId, buyin: amt });
  return { ok: true, tableId, seat, stack: amt, bb: Number(t.bb) };
}

export async function leaveTable(ch, tableId, client, h) {
  const t = await lockTable(client, tableId);
  const seats = await seatsOf(client, tableId);
  const mine = seats.find((s) => s.character_id === ch.id);
  if (!mine) throw new GameError('not_seated', "You're not at that table.");
  enforceDeadline(t, seats);
  if (t.street && mine.in_hand) { // leaving mid-hand folds you (your street bets stay in the pot)
    mine.in_hand = false; mine.acted = true;
    if (t.acting_seat === mine.seat) advance(t, seats, mine.seat);
    // (red-team MED) if the leaver was NOT the acting seat, advance() never ran — so a departure that
    // drops the table to one live player wouldn't resolve the hand (the survivor's win stalls until
    // the clock, which then folds THEM and burns their rightful pot as casino:ring:death). Mirror the
    // last-man-standing catch wipeRingAtDeath already has.
    else { const live = inHand(seats); if (live.length <= 1) finishHand(t, seats, live, null); }
  }
  const out = Math.floor(Number(mine.stack));
  mine._gone = true;
  if (out > 0) {
    ch.cash = Number(ch.cash) + out;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: out, reason: 'casino:ring:leave', counterparty: tableId });
  }
  await persist(client, t, seats);
  await settleFinish(client, t);
  if (!seats.some((s) => !s._gone)) await client.query('DELETE FROM poker_tables WHERE id=$1', [t.id]);
  await h.track(client, ch.account_id, 'ring_leave', { table: tableId, out });
  return { ok: true, cashedOut: out };
}

// any seated player pokes the deal when no hand is live — everyone with the ante joins
export async function dealHand(ch, tableId, client, h) {
  const t = await lockTable(client, tableId);
  const seats = await seatsOf(client, tableId);
  if (!seats.some((s) => s.character_id === ch.id)) throw new GameError('not_seated', "You're not at that table.");
  enforceDeadline(t, seats);
  // (red-team HIGH) if enforceDeadline just RESOLVED a prior stalled hand (t.street→null, t._rake set),
  // ledger its rake/dead-pot NOW — before we deal a fresh hand that overwrites t._rake. Without this,
  // the resolved hand's rake never hits casino:ring:take and the ring-escrow §10.4 identity drifts on
  // COMMIT. A no-op when nothing resolved (t._rake/t._deadPot both 0).
  await settleFinish(client, t);
  if (t.street) { await persist(client, t, seats); await settleFinish(client, t); throw new GameError('hand', 'A hand is live — play it out.'); }
  const players = seats.filter((s) => Number(s.stack) >= Number(t.bb));
  if (players.length < 2) throw new GameError('short', 'It takes two with the ante to deal.');
  const deck = shuffle52();
  let pot = 0;
  for (const s of seats) {
    if (Number(s.stack) >= Number(t.bb)) {
      s.stack = Number(s.stack) - Number(t.bb); pot += Number(t.bb);
      s.hole = J([deck.shift(), deck.shift()]); s.in_hand = true; s.bet_street = 0; s.acted = false;
    } else { s.in_hand = false; s.hole = null; }
  }
  t.street = 'preflop'; t.deck = J(deck); t.board = J([]); t.pot = pot; t.current_bet = 0;
  t.hand_no = Number(t.hand_no) + 1;
  const live = inHand(seats);
  // THE ALL-IN RULE applies from the first card: a seat whose whole stack was the ante is already
  // all-in, so the action goes to the first seat that can still bet — and if fewer than two can,
  // the board runs out and the hand shows down immediately with no betting at all.
  if (!openBetting(t, live)) runOut(t, seats);
  await persist(client, t, seats);
  // if it ran out and resolved right here, its rake/dead pot must be ledgered NOW or the ring-escrow
  // §10.4 identity drifts on COMMIT (the same reason settleFinish is called above). No-op otherwise.
  await settleFinish(client, t);
  await h.rngLog(client, ch.id, `casino:ring:${tableId}`, Math.random(),
    `hand ${t.hand_no} dealt · ${live.length} players · pot $${pot}`);
  await h.track(client, ch.account_id, 'ring_deal', { table: tableId, players: live.length });
  return { ok: true, hand: Number(t.hand_no), players: live.length, pot, yourHole: asCards(P(live.find((s) => s.character_id === ch.id)?.hole || '[]')) };
}

// check / call / raise-to / fold — the betting streets
export async function actAt(ch, tableId, body, client, h) {
  const action = String(body?.action || '');
  const t = await lockTable(client, tableId);
  const seats = await seatsOf(client, tableId);
  const mine = seats.find((s) => s.character_id === ch.id);
  if (!mine) throw new GameError('not_seated', "You're not at that table.");
  enforceDeadline(t, seats);
  if (!t.street) { await persist(client, t, seats); await settleFinish(client, t); throw new GameError('no_hand', 'No hand live — deal one.'); }
  if (!mine.in_hand) throw new GameError('folded', "You're out of this one.");
  if (t.acting_seat !== mine.seat) throw new GameError('not_you', 'Not your action.');
  const cur = Number(t.current_bet), myBet = Number(mine.bet_street);
  if (action === 'fold') {
    mine.in_hand = false; mine.acted = true;
  } else if (action === 'check') {
    if (myBet !== cur) throw new GameError('bet', `There's $${cur - myBet} to you — call, raise, or fold.`);
    mine.acted = true;
  } else if (action === 'call') {
    const need = cur - myBet;
    if (need <= 0) { mine.acted = true; } else {
      mine.stack = Number(mine.stack) - need; t.pot = Number(t.pot) + need;
      mine.bet_street = cur; mine.acted = true;
    }
  } else if (action === 'raise' || action === 'bet') {
    // raise TO a street total; capped at the smallest live stack (everyone can always call)
    const cap = Math.min(...inHand(seats).map((s) => Number(s.bet_street) + Number(s.stack)));
    let target = Math.floor(Number(body?.amount) || 0);
    target = Math.min(target, cap);
    const minTo = cur > 0 ? cur + Number(t.bb) : Number(t.bb);
    if (target < Math.min(minTo, cap)) throw new GameError('amount', `The table minimum raise is to $${Math.min(minTo, cap)}.`);
    if (target <= cur) throw new GameError('amount', 'A raise has to raise.');
    const pay = target - myBet;
    mine.stack = Number(mine.stack) - pay; t.pot = Number(t.pot) + pay;
    mine.bet_street = target; t.current_bet = target; mine.acted = true;
    for (const s of inHand(seats)) if (s.seat !== mine.seat) s.acted = false; // the raise reopens the action
  } else throw new GameError('action', 'check, call, raise, or fold.');
  advance(t, seats, mine.seat);
  await persist(client, t, seats);
  await settleFinish(client, t);
  await h.track(client, ch.account_id, 'ring_act', { table: tableId, action });
  return { ok: true, action, ...(await viewOf(client, t.id, ch.id)) };
}

// ── the rail: the lobby + a redacted table view (your hole only; showdowns publish via last_result) ──
export async function ringLobby(pool, ch) {
  const tables = (await pool.query('SELECT * FROM poker_tables ORDER BY bb, created_at')).rows;
  const allSeats = (await pool.query('SELECT table_id, seat, name, stack, in_hand FROM poker_ring_seats')).rows;
  const mineRow = ch ? (await pool.query('SELECT table_id FROM poker_ring_seats WHERE character_id=$1', [ch.id])).rows[0] : null;
  return {
    tables: tables.map((t) => ({ id: t.id, bb: Number(t.bb), pot: Number(t.pot), live: !!t.street,
      players: allSeats.filter((s) => s.table_id === t.id).map((s) => ({ name: s.name, stack: Number(s.stack) })) })),
    blinds: CASINO.RING.BLINDS, buyinMinBb: CASINO.RING.BUYIN_MIN_BB, buyinMaxBb: CASINO.RING.BUYIN_MAX_BB,
    seats: CASINO.RING.SEATS, rakeBps: CASINO.RING.RAKE_BPS, minLevel: CASINO.RING.MIN_LVL,
    yourTable: mineRow?.table_id || null,
  };
}

export async function viewOf(db, tableId, characterId) {
  const t = (await db.query('SELECT * FROM poker_tables WHERE id=$1', [tableId])).rows[0];
  if (!t) throw new GameError('no_table', 'That table folded up.');
  const seats = (await db.query('SELECT * FROM poker_ring_seats WHERE table_id=$1 ORDER BY seat', [tableId])).rows;
  const mine = seats.find((s) => s.character_id === characterId) || null;
  return {
    table: { id: t.id, bb: Number(t.bb), street: t.street, pot: Number(t.pot), currentBet: Number(t.current_bet),
      board: asCards(P(t.board) || []), actingSeat: t.acting_seat,
      actSeconds: t.act_deadline ? Math.max(0, Math.ceil((new Date(t.act_deadline) - Date.now()) / 1000)) : null,
      lastResult: P(t.last_result) },
    seats: seats.map((s) => ({ seat: s.seat, name: s.name, stack: Number(s.stack), inHand: s.in_hand,
      betStreet: Number(s.bet_street), you: s.character_id === characterId })),
    yourSeat: mine ? { seat: mine.seat, stack: Number(mine.stack), inHand: mine.in_hand,
      hole: asCards(P(mine.hole) || []), toCall: mine.in_hand ? Math.max(0, Number(t.current_bet) - Number(mine.bet_street)) : 0,
      yourTurn: t.acting_seat === mine.seat && !!t.street && mine.in_hand } : null,
  };
}

// ── the estate: a dead player's seat folds, their STACK burns (the dead-funder rule). Their chips
// already in the pot ride to whoever wins the hand (escrow-conserving). Called from runEstate under
// the victim's char lock; lock order chars → tables holds. ──
export async function wipeRingAtDeath(client, victimId, h) {
  const tids = (await client.query('SELECT table_id FROM poker_ring_seats WHERE character_id=$1', [victimId])).rows
    .map((r) => r.table_id).sort();
  for (const tid of tids) {
    const t = (await client.query('SELECT * FROM poker_tables WHERE id=$1 FOR UPDATE', [tid])).rows[0];
    if (!t) continue;
    const seats = await seatsOf(client, tid);
    const mine = seats.find((s) => s.character_id === victimId);
    if (!mine) continue;
    const stack = Math.floor(Number(mine.stack));
    if (mine.in_hand && t.street) { mine.in_hand = false; mine.acted = true; }
    mine._gone = true;
    if (stack > 0) await h.ledger(client, { currency: 'cash', amount: -stack, reason: 'casino:ring:death', counterparty: tid });
    if (t.street) { enforceDeadline(t, seats); if (t.acting_seat === mine.seat) advance(t, seats, mine.seat); }
    // a hand left with one live player resolves right here (finishHand runs inside advance paths);
    // any residual stall is the sweep's job (act_deadline drives it home)
    const live = inHand(seats);
    if (t.street && live.length <= 1) { finishHand(t, seats, live, null); }
    await persist(client, t, seats);
    await settleFinish(client, t);
    if (!seats.some((s) => !s._gone)) await client.query('DELETE FROM poker_tables WHERE id=$1', [tid]);
  }
}

// ── the worker sweep: fold out stalled hands; fold up idle tables (stacks cash out to their owners).
// Lock order: chars (sorted) → the table (the cash-out touches character rows). ──
export async function sweepRingTables(pool) {
  let resolvedStalls = 0, foldedTables = 0;
  const stalled = (await pool.query(
    "SELECT id FROM poker_tables WHERE street IS NOT NULL AND act_deadline < now() ORDER BY id")).rows;
  for (const { id } of stalled) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const t = (await client.query('SELECT * FROM poker_tables WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!t || !t.street) { await client.query('ROLLBACK'); continue; }
      const seats = await seatsOf(client, id);
      enforceDeadline(t, seats);
      await persist(client, t, seats);
      await settleFinish(client, t);
      await client.query('COMMIT'); resolvedStalls++;
    } catch (e) { await client.query('ROLLBACK'); console.error('[sweepRing stall]', id, e?.code || e?.message || e); }
    finally { client.release(); }
  }
  const idle = (await pool.query(
    // the interval is PARAMETERISED, not a SQL literal — a literal made CASINO.RING.IDLE_MS a
    // decorative constant that nothing read, so retuning it did nothing at all.
    'SELECT id FROM poker_tables WHERE street IS NULL AND last_action_at < now() - ($1 || \' milliseconds\')::interval ORDER BY id',
    [CASINO.RING.IDLE_MS])).rows;
  for (const { id } of idle) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const pre = (await client.query('SELECT character_id FROM poker_ring_seats WHERE table_id=$1', [id])).rows;
      for (const cid of pre.map((r) => r.character_id).sort())
        await client.query('SELECT 1 FROM characters WHERE id=$1 FOR UPDATE', [cid]);
      const t = (await client.query("SELECT * FROM poker_tables WHERE id=$1 AND street IS NULL FOR UPDATE", [id])).rows[0];
      if (!t) { await client.query('ROLLBACK'); continue; }
      const seats = await seatsOf(client, id);
      for (const s of seats) {
        const out = Math.floor(Number(s.stack));
        if (out > 0) {
          const alive = (await client.query('SELECT 1 FROM characters WHERE id=$1 AND alive', [s.character_id])).rows[0];
          if (alive) {
            await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [s.character_id, out]);
            await ledger(client, { characterId: s.character_id, currency: 'cash', amount: out, reason: 'casino:ring:leave', counterparty: id });
            await notify(client, s.character_id, 'ring_folded_up', { cashedOut: out });
          } else { // belt-and-braces: an un-estated corpse's stack burns (the estate normally handles it)
            await ledger(client, { currency: 'cash', amount: -out, reason: 'casino:ring:death', counterparty: id });
          }
        }
        await client.query('DELETE FROM poker_ring_seats WHERE table_id=$1 AND seat=$2', [id, s.seat]);
      }
      await client.query('DELETE FROM poker_tables WHERE id=$1', [id]);
      await client.query('COMMIT'); foldedTables++;
    } catch (e) { await client.query('ROLLBACK'); console.error('[sweepRing idle]', id, e?.code || e?.message || e); }
    finally { client.release(); }
  }
  return { resolvedStalls, foldedTables };
}

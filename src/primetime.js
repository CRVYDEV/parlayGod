// PRIME TIME — the nightly synchronous window (the answer to "nothing draws players to be online at
// the same time"). One forecastable UTC hour a day, drawn off the §7.11 seed; the MECHANIC and the
// MODE both rotate, so the night is a surprise you can plan for. Step one ships THE RALLY.
//
// THE RALLY is co-present BY CONSTRUCTION: the value reward scales with TURNOUT (more people answering
// = bigger reward each, capped), settled at the window's CLOSE by the worker so everyone gets the final
// count — the boxing-main-event / tournament settle pattern. On an `honor` night the reward is a
// rotating status TITLE instead (the bulletin precedent), so some nights pay and some are pure brag.
//
// §10.4: only `value` nights move value — a bounded cash faucet `primetime:rally` (BASE + PER×min(turnout
// −1, CAP), once/day per street, level-floored, agent-excluded). `honor` nights write no ledger row.
import { PRIME_TIME, primeTimeOf, dayOf, levelOf } from './rules.js';
import { GameError, ledger, notify, bumpMastery } from './game.js';

const HOUR = 3600000, DAY = 86400000;

// the [start, end) ms of a given day's window
function windowOf(day) {
  const pt = primeTimeOf(day);
  const start = day * DAY + pt.hour * HOUR;
  return { pt, start, end: start + PRIME_TIME.WINDOW_H * HOUR };
}

// the event to SHOW right now + whether the window is live. If today's window has already closed, show
// TOMORROW's (so the board never dead-ends on "tonight is over"). PRIME_TIME_LIVE=on forces live (a
// TEST-ONLY override — the SEARCH_MS precedent — so a test needn't warp the clock to the drawn hour).
export function statusNow(now = Date.now()) {
  const testLive = process.env.PRIME_TIME_LIVE === 'on';
  const today = dayOf(now);
  let w = windowOf(today);
  if (!testLive && now >= w.end) w = windowOf(today + 1);  // today's is over → the next night
  const live = testLive || (now >= w.start && now < w.end);
  return {
    pt: w.pt, start: w.start, end: w.end, live,
    secondsToStart: live ? 0 : Math.max(0, Math.round((w.start - now) / 1000)),
    secondsToEnd: live ? Math.max(60, Math.round((w.end - now) / 1000)) : 0,
  };
}

// turnout so far tonight (a live count — the "N have answered" co-presence signal)
async function turnoutOf(client, day) {
  return Number((await client.query('SELECT count(*) c FROM primetime_rally WHERE day=$1', [day])).rows[0].c);
}

// the reward each answerer gets on a value night, scaled by FINAL turnout (co-present: a busy night pays
// each person more). Bounded by CAP — this is the whole §10.4 exposure per row.
export function rallyReward(turnout) {
  return PRIME_TIME.RALLY_BASE + PRIME_TIME.RALLY_PER * Math.min(Math.max(0, turnout - 1), PRIME_TIME.RALLY_TURNOUT_CAP);
}

// A compact summary for the TONIGHT strip on Home (events.js) — icon/title/subtitle + the countdown.
export function primeTimeSummary(now = Date.now()) {
  const s = statusNow(now);
  const mode = s.pt.mode, happy = s.pt.mechanic === 'happyhour';
  const title = happy ? 'Prime Time — Happy Hour' : 'Prime Time — Answer the Call';
  const sub = happy
    ? (s.live
      ? (mode === 'value' ? `The house is buying — ${PRIME_TIME.HAPPY_ROUNDS} rounds of walking-around money while the bar's open.` : 'The house is buying — a few rounds with the crew sharpen the card sense.')
      : 'Tonight the house buys rounds for one hour — be at the bar.')
    : (s.live
      ? (mode === 'value' ? 'The city\'s out. Answer the call — the more who show, the bigger the cut.' : `The city\'s out. Answer the call for tonight's badge: ${s.pt.title}.`)
      : (mode === 'value' ? 'Tonight the whole city gathers for one hour — show up and share the take.' : 'Tonight the whole city gathers for one hour — show up for the badge.'));
  return { kind: 'primetime', icon: '🌃', title, subtitle: sub, tab: 'start',
    live: s.live, closesSeconds: s.live ? s.secondsToEnd : null, opensSeconds: s.live ? null : s.secondsToStart };
}

// how many rounds you've bought tonight (HAPPY HOUR)
async function roundsOf(client, day, cid) {
  return Number((await client.query('SELECT rounds FROM primetime_happy WHERE day=$1 AND character_id=$2', [day, cid])).rows[0]?.rounds || 0);
}

// The board: tonight's window (mechanic/mode/hour/live/countdown), your participation, and the forecast.
// Branches on the mechanic — RALLY carries turnout+reward+answered; HAPPY HOUR carries rounds. Pure read.
export async function primeTimeBoard(client, ch) {
  const s = statusNow();
  const day = s.pt.day;
  const forecast = Array.from({ length: PRIME_TIME.FORECAST_DAYS }, (_, i) => {
    const w = windowOf(dayOf() + i);
    return { day: w.pt.day, mechanic: w.pt.mechanic, mode: w.pt.mode, hour: w.pt.hour, startMs: w.start };
  });
  const happy = s.pt.mechanic === 'happyhour';
  // ONE shape, always — every field of both mechanics is present (the inactive one carries defaults),
  // so the client (which branches on `mechanic`) and the mirror-guard both see a stable board.
  const rounds = happy ? await roundsOf(client, day, ch.id) : 0;
  const answered = !happy && !!(await client.query('SELECT 1 FROM primetime_rally WHERE day=$1 AND character_id=$2', [day, ch.id])).rows.length;
  const turnout = happy ? 0 : await turnoutOf(client, day);
  return {
    mechanic: s.pt.mechanic, mode: s.pt.mode, hour: s.pt.hour,
    live: s.live, opensSeconds: s.secondsToStart, closesSeconds: s.secondsToEnd,
    minLevel: PRIME_TIME.RALLY_MIN_LVL, windowH: PRIME_TIME.WINDOW_H, forecast,
    // RALLY fields
    answered, turnout, title: s.pt.title,
    reward: (!happy && s.pt.mode === 'value') ? rallyReward(turnout) : 0,  // an ESTIMATE — grows as more show; settled at final turnout
    // HAPPY HOUR fields
    rounds, roundsMax: PRIME_TIME.HAPPY_ROUNDS, roundsLeft: happy ? Math.max(0, PRIME_TIME.HAPPY_ROUNDS - rounds) : 0,
    roundCash: PRIME_TIME.HAPPY_CASH,
  };
}

// Answer the call — record participation once per night, in-window only. On an honor night the title
// lands immediately; on a value night the row waits for the worker to settle at final turnout.
export async function answerCall(ch, client, h) {
  const s = statusNow();
  if (s.pt.mechanic !== 'rally') throw new GameError('not_rally', 'Tonight is not a rally — check the board for what\'s on.');
  if (!s.live) throw new GameError('closed', 'Prime Time isn\'t live right now. The board shows when tonight\'s window opens.');
  if (levelOf(Number(ch.respect)) < PRIME_TIME.RALLY_MIN_LVL) throw new GameError('rookie', `Answer the call at level ${PRIME_TIME.RALLY_MIN_LVL}.`);
  const day = s.pt.day;
  // once per night. NOT `ON CONFLICT DO NOTHING RETURNING` — pg-mem LIES about it (returns a row even on
  // a conflict, so the latch never fires; the recordReckoning lesson). answerCall runs under the
  // character FOR UPDATE lock (withCharacter), so two answers by the SAME street are serialized — a
  // plain SELECT-then-INSERT is race-safe here, and the (day, character) PK is the real-PG backstop.
  const seen = await client.query('SELECT 1 FROM primetime_rally WHERE day=$1 AND character_id=$2', [day, ch.id]);
  if (seen.rows.length) throw new GameError('already', 'You\'ve already answered tonight\'s call.');
  await client.query('INSERT INTO primetime_rally (day, character_id, settled) VALUES ($1,$2,$3)',
    [day, ch.id, s.pt.mode === 'honor']);  // honor rows are born settled (they pay no cash — the worker skips them)
  const turnout = await turnoutOf(client, day);
  if (s.pt.mode === 'honor') {
    ch.title = s.pt.title;              // status — persisted by withCharacter ($30 title slot)
    await notify(client, ch.id, 'primetime_answered', { mode: 'honor', title: s.pt.title, turnout }).catch(() => {});
    return { answered: true, mode: 'honor', title: s.pt.title, turnout };
  }
  // value night: the cash lands at close, scaled by the FINAL turnout (so nobody is punished for coming early)
  await notify(client, ch.id, 'primetime_answered', { mode: 'value', turnout }).catch(() => {});
  return { answered: true, mode: 'value', turnout, pending: true };
}

// HAPPY HOUR — buy a round (up to HAPPY_ROUNDS a night), in-window only. value → petty cash per round
// (paid immediately, a bounded faucet — no turnout scaling, so no worker settle); honor → gambling
// mastery XP per round (status, zero §10.4). The counter is a SELECT-then-write under the character
// lock (pg-mem-safe, the answerCall latch discipline; the (day, character) PK is the real-PG backstop).
export async function buyRound(ch, client, h) {
  const s = statusNow();
  if (s.pt.mechanic !== 'happyhour') throw new GameError('not_happy', 'Tonight is not a happy hour — check the board for what\'s on.');
  if (!s.live) throw new GameError('closed', 'Happy Hour isn\'t live right now. The board shows when tonight\'s window opens.');
  if (levelOf(Number(ch.respect)) < PRIME_TIME.RALLY_MIN_LVL) throw new GameError('rookie', `Join the round at level ${PRIME_TIME.RALLY_MIN_LVL}.`);
  const day = s.pt.day;
  const rounds = await roundsOf(client, day, ch.id);
  if (rounds >= PRIME_TIME.HAPPY_ROUNDS) throw new GameError('done', `You\'ve had your ${PRIME_TIME.HAPPY_ROUNDS} rounds tonight — pace yourself.`);
  const next = rounds + 1;
  const upd = await client.query('UPDATE primetime_happy SET rounds=$3 WHERE day=$1 AND character_id=$2', [day, ch.id, next]);
  if (!upd.rowCount) await client.query('INSERT INTO primetime_happy (day, character_id, rounds) VALUES ($1,$2,$3)', [day, ch.id, next]);
  const left = PRIME_TIME.HAPPY_ROUNDS - next;
  if (s.pt.mode === 'value') {
    const cash = PRIME_TIME.HAPPY_CASH;
    ch.cash = Number(ch.cash) + cash;      // paid immediately (persistCharacter commits); the faucet is character_id'd
    await ledger(client, { characterId: ch.id, currency: 'cash', amount: cash, reason: 'primetime:happy', counterparty: `d${day}` });
    await notify(client, ch.id, 'primetime_round', { mode: 'value', cash, left }).catch(() => {});
    return { round: next, of: PRIME_TIME.HAPPY_ROUNDS, left, mode: 'value', cash };
  }
  // honor night: a round with the crew schools the card sense (gambling XP — status, no §10.4)
  await bumpMastery(client, h, ch, 'gambling', 'primetime');
  await notify(client, ch.id, 'primetime_round', { mode: 'honor', left }).catch(() => {});
  return { round: next, of: PRIME_TIME.HAPPY_ROUNDS, left, mode: 'honor' };
}

// THE WORKER SETTLE — after a value-rally window has fully closed, pay every answerer the turnout-scaled
// reward, once (claim-then-pay, so concurrent workers can't double-pay). Idempotent via the `settled`
// flag; the reward is a pure function of the day's final turnout, fixed once the window closed. Also
// prunes old rows (hygiene — the troll-box retention pattern). Runs in one transaction (the tournament-
// sweep pattern): a small closed-night settle, so a single txn is fine.
export async function settlePrimeTime(pool) {
  const client = await pool.connect();
  let paid = 0;
  try {
    await client.query('BEGIN');
    const now = Date.now();
    const today = dayOf(now);
    for (let d = today - 1; d >= today - 3; d--) {   // look back a few closed nights (worker-downtime backfill)
      const pt = primeTimeOf(d);
      if (pt.mechanic !== 'rally' || pt.mode !== 'value') continue;    // honor nights pay no cash
      // eligible answerers still unsettled — exclude agents (the faucet posture) and the dead (their row is estate-wiped)
      const rows = (await client.query(
        `SELECT r.character_id, ap.agent_flag, c.alive
           FROM primetime_rally r JOIN characters c ON c.id=r.character_id
           JOIN account_persistent ap ON ap.account_id=c.account_id
          WHERE r.day=$1 AND NOT r.settled`, [d])).rows;
      if (!rows.length) continue;
      const turnout = await turnoutOf(client, d);       // final turnout — no new answers can land after close
      const reward = rallyReward(turnout);
      for (const r of rows) {
        // atomic claim: only the winner of this row's UPDATE pays it (concurrent-worker-safe)
        const claim = await client.query(
          'UPDATE primetime_rally SET settled=true WHERE day=$1 AND character_id=$2 AND NOT settled RETURNING character_id',
          [d, r.character_id]);
        if (!claim.rows.length) continue;               // another worker took this row
        if (!r.alive || r.agent_flag) continue;         // marked settled, but no payout (dead / agent)
        await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [r.character_id, reward]);
        await ledger(client, { characterId: r.character_id, currency: 'cash', amount: reward, reason: 'primetime:rally', counterparty: `d${d}` });
        await notify(client, r.character_id, 'primetime_paid', { reward, turnout });
        paid++;
      }
    }
    // prune old rows (both mechanics) past the backfill window
    const cutoff = dayOf(Date.now()) - 3;
    await client.query('DELETE FROM primetime_rally WHERE day < $1', [cutoff]);
    await client.query('DELETE FROM primetime_happy WHERE day < $1', [cutoff]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
  return { paid };
}

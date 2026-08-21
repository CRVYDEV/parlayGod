// THE FAIR DRAW (NetNet research rec F, 2026-08-21) — commit/reveal over the daily seed draw, so a
// player (or an agent — they read these boards) can PROVE the house did not move a draw after seeing
// the bets. The shape is the standard commitment scheme:
//
//   commitment(day) = sha256( nonce(day) + ':' + JSON.stringify(results(day)) )
//   nonce(day)      = HMAC-SHA256(MARKET_SEED, 'fair:' + day)      — one-way, so revealing a day's
//                     nonce exposes nothing about MARKET_SEED or any other day's draw, and without
//                     it the tiny results space (a 0-999 number) would be brute-forceable from the
//                     hash alone.
//
// TODAY the board publishes the COMMITMENT only (the draw is SEALED — tickets on day D's draw are
// bought during day D and mature at D+1). YESTERDAY it publishes the full REVEAL (results + nonce),
// and anyone can hash the two together and compare against the commitment they recorded the day
// before — no trust in this server required beyond "it said X yesterday", which is exactly what the
// worker-stamped `fair_commitments` record exists to witness (and what a player screenshot witnesses
// harder). A stored row that no longer matches the recomputation is surfaced as `mismatch: true`,
// never hidden — the one way it happens is a MARKET_SEED rotation, which would silently rewrite
// every historical draw, and a fairness board that papered over that would be worse than none.
//
// SCOPE — deliberately the NUMBERS draw alone, and the reasons are properties of the other draws,
// not laziness: the TRACK winner is drawn from the day's FINAL entry list (players enter runners all
// day), so it is not fixed when bets open and cannot be pre-committed without lying; the weekly
// FIGHT can be bought by the boss holding neon (THE FIX overrides the seed draw), so a committed
// "result" would be false exactly when the mechanic fires. The Numbers is the flagship anyway — the
// 600:1 book, the near-miss band and the VIG POT jackpot all settle off this one number.
//
// §10.4: ZERO — a commitment is a hash, the stamp is a day-keyed record row (account-agnostic, so
// it is outside the death-disposition guard by construction), and nothing here moves value. The
// keyless GET rides the H4 default throttle like every keyless /v1 board.
import crypto from 'node:crypto';
import { MARKET_SEED, dayOf, numbersDrawOf } from './rules.js';

export const fairNonce = (day) =>
  crypto.createHmac('sha256', String(MARKET_SEED)).update(`fair:${day}`).digest('hex');
// canonical results object — key order is part of the published formula (the `how` string names it),
// so anything added here later changes every commitment from that day forward and must be announced.
export const fairResults = (day) => ({ day, numbers: numbersDrawOf(day) });
export const fairCommitment = (day) =>
  crypto.createHash('sha256').update(`${fairNonce(day)}:${JSON.stringify(fairResults(day))}`).digest('hex');

const storedRow = async (q, day) =>
  (await q.query('SELECT commitment, created_at FROM fair_commitments WHERE day=$1', [day])).rows[0] || null;

// the worker's stamp — SELECT-then-INSERT (the recordReckoning discipline: pg-mem reports success on
// ON CONFLICT DO NOTHING even when nothing was written, so the latch is a read). Idempotent; a
// re-run never rewrites a stamped day (the record is the point — rewriting it would defeat it).
export async function stampFairness(pool) {
  const day = dayOf();
  const have = await storedRow(pool, day);
  if (have) return { day, stamped: false };
  await pool.query('INSERT INTO fair_commitments (day, commitment) VALUES ($1, $2)', [day, fairCommitment(day)]);
  return { day, stamped: true };
}

// the public board — PURE READ (it rides denInfo's read-only path too, so it must never write; an
// unstamped day serves the computed commitment with recorded:false rather than materializing a row —
// a read that materializes state is a write wearing a read's clothes, the shipmentBoard lesson).
export async function fairnessBoard(q) {
  const today = dayOf(), yday = today - 1;
  const tRow = await storedRow(q, today);
  const yRow = await storedRow(q, yday);
  const yCommit = fairCommitment(yday);
  return {
    // TODAY IS SEALED: exactly {day, commitment, recorded} — never results, never the nonce. The
    // drawn number decides a 600:1 book and the jackpot; leaking it here would let everyone buy the
    // winner. (test/casino.js pins the key set.)
    today: { day: today, commitment: tRow ? tRow.commitment : fairCommitment(today), recorded: !!tRow },
    yesterday: {
      day: yday,
      commitment: yCommit,
      recorded: !!yRow,
      recordedCommitment: yRow ? yRow.commitment : null,
      // a stored record that disagrees with the recomputation is SURFACED, never hidden
      mismatch: !!yRow && yRow.commitment !== yCommit,
      reveal: { results: fairResults(yday), nonce: fairNonce(yday) },
    },
    how: "verify yesterday: sha256(reveal.nonce + ':' + JSON.stringify(reveal.results)) === yesterday.commitment "
      + '(hex, key order exactly as served: {"day":<n>,"numbers":<0-999>}). Record today.commitment now; '
      + "tomorrow's reveal must hash back to it — that is the proof the draw was fixed before your ticket.",
  };
}

// the one-line summary denInfo folds into the Den board (no extra client fetch on a polled screen —
// the poll-cost rule): today's sealed commitment + whether yesterday's record verifies.
export async function fairSummary(q) {
  const b = await fairnessBoard(q);
  return {
    today: b.today.commitment, recorded: b.today.recorded,
    yesterday: { numbers: b.yesterday.reveal.results.numbers, verified: b.yesterday.recorded && !b.yesterday.mismatch, mismatch: b.yesterday.mismatch },
  };
}

// ── src/tax.js — THE EARLY-EXIT SURCHARGE (anti-dump, the value-creation pivot's third toll) ──
// $OMR younger than the fresh window pays a linearly-decaying surcharge when it EXITS the game
// economy (the AMM sell or a withdrawal): `EARLY_SELL_TAX_BPS` (50%) at age 0 → 0 at
// `FRESH_WINDOW_MS` (48h). No exemptions. Split like the exit toll: half → dev_fund, half →
// stake_pool (the buyback/yield pool). Spending/burning in-game is NEVER surcharged — only exits.
//
// THE LEDGER IS THE LOT TABLE (zero new instrumentation, unfakeable): every $OMR credit already
// writes a timestamped positive `transactions` row — replay the window (credits append lots,
// debits consume lots) and the surviving lots are exactly which tokens the account holds and how
// old each is. Deriving from the ledger means an SQL-granted balance (tests/mod comps) carries
// no credit rows and is treated as AGED — and no player-side trick can forge a timestamp.
//
// FRESH-FIRST PRICING (the AUDIT-value-creation.md D2 fix, founder-directed): both the exit
// pricing AND the historical-debit replay consume the NEWEST lots first (LIFO). Under the
// original oldest-first ordering, an account's tax-free daily exit allowance equalled its balance
// of 48h ago — a steady earner with a 2-day-old buffer dumped every day's fresh tokens
// surcharge-free forever (the anti-INSTANT-dump-only seam). Newest-first closes it: any exit
// prices the freshest holdings, so EVERY fresh token pays on its first exit — and because past
// exits also replay newest-first, a fresh token taxed once is consumed and never re-taxed (each
// token pays exactly once, then only aging past the window makes later exits free — which costs a
// real 48h earning pause, the intended dodge price). In-game spends/burns consuming fresh tokens
// first is deliberate too: spending fresh earnings IN the economy (deflationary) is what the
// design wants to reward with a cheaper aged exit later.
//
// STAKING IS NOT A DODGE (re-measured, AUDIT-value-creation.md): stake→unstake moves buckets with
// no ledger rows, but a FRESH token's original credit row stays in the window, so the replay still
// prices it fresh after a round-trip — the un-ledgered release only "ages" tokens that were
// already aged. (The safety clamp trims aged-first when the ledger over-represents holdings, so
// the balance dip from staking errs toward MORE tax, never less.)
import { TAX, earlySellTaxBps, freshWindowMs } from './rules.js';

const flo6 = (x) => Math.floor(x * 1e6) / 1e6;

// Price the early-exit surcharge for taking `amount` $OMR out of an account holding `liquid`.
// Read-only (runs on the caller's txn client so it sees the txn's own view). Returns
// { surcharge, freshSold, rateNow } — the caller debits/splits/ledgers.
export async function earlySurcharge(client, accountId, liquid, amount, now = Date.now()) {
  const bps = earlySellTaxBps(), win = freshWindowMs();
  const amt = Number(amount), bal = Number(liquid);
  if (!(bps > 0) || !(amt > 0) || !(win > 0)) return { surcharge: 0, freshSold: 0 };
  // EXACT REPLAY over the window: take EVERY omr row (credits AND debits) in the last 48h in
  // time order, seed an "aged" opening lot (balance − net window change — covers pre-window
  // holdings and any un-ledgered credit, e.g. an SQL grant, which is treated as aged), then replay:
  // a credit appends a lot at its timestamp; a debit consumes lots NEWEST-first (LIFO — see the
  // header: fresh-first, so each fresh token is priced exactly once across consecutive exits).
  // The surviving lots are exactly which tokens the account still holds and how old each is.
  const rows = (await client.query(
    "SELECT amount, at FROM transactions WHERE account_id=$1 AND currency='omr' AND at > $2 ORDER BY at ASC",
    [accountId, new Date(now - win)])).rows;
  const netWindow = rows.reduce((a, r) => a + Number(r.amount), 0);
  const lots = [];
  const opening = Math.max(0, bal - netWindow);
  if (opening > 0) lots.push({ amount: opening, at: 0 }); // aged — surcharge-free
  for (const r of rows) {
    const a = Number(r.amount);
    if (a > 0) { lots.push({ amount: a, at: new Date(r.at).getTime() }); continue; }
    let debit = -a;
    while (debit > 0 && lots.length) {                      // LIFO: spends/exits consume the NEWEST first
      const last = lots[lots.length - 1];
      const take = Math.min(last.amount, debit);
      last.amount -= take; debit -= take;
      if (last.amount <= 1e-9) lots.pop();
    }
  }
  // safety clamp: if the ledger over-represents holdings (shouldn't happen), trim OLDEST first —
  // fresh lots survive the trim and fresh-first pricing then sees them, so the error direction is
  // MORE tax on what remains, never less
  let held = lots.reduce((a, l) => a + l.amount, 0);
  while (held > bal + 1e-9 && lots.length) {
    const over = held - bal, take = Math.min(lots[0].amount, over);
    lots[0].amount -= take; held -= take;
    if (lots[0].amount <= 1e-9) lots.shift();
  }
  // price the exit NEWEST-first (the D2 fix): the freshest tokens pay their age's rate — an aged
  // buffer can no longer absorb a fresh dump, and every fresh token pays exactly once (a later
  // replay consumes this exit newest-first too, so what was priced here is what left here)
  let toExit = amt, surcharge = 0, freshSold = 0;
  for (let i = lots.length - 1; i >= 0 && toExit > 0; i--) {
    const l = lots[i];
    const take = Math.min(l.amount, toExit);
    if (l.at > 0) {
      const age = Math.max(0, now - l.at);
      const rate = (bps / 10000) * Math.max(0, 1 - age / win);
      if (rate > 0) { surcharge += take * rate; freshSold += take; }
    }
    toExit -= take;
  }
  return { surcharge: flo6(surcharge), freshSold: flo6(freshSold) };
}

// Split a toll (the flat exit toll + any early surcharge) into the two revenue buckets and credit
// them. The caller writes its own ledger rows (tax:dev / tax:buyback) with its own conventions.
// (tokenomics v2 step 2) The toll's non-dev half used to land in `stake_pool`, which paid individual
// staking yield. That yield is retired — it is the family yield now (design §3) — so the same $OMR
// goes to `family_yield_pool` instead. Both are inside `omrBuckets`, so this is a bucket-to-bucket
// TRANSFER exactly as before: no ledger row, conservation untouched, only the destination changed.
//
// This matters more than it looks: retiring the AMM took away the only in-game way to turn cash into
// $OMR, so the 12h buyback can no longer acquire any. The exit toll and the early-exit surcharge are
// $OMR-denominated already — they need no market — which makes them the pool's real ongoing feed.
export async function creditTollBuckets(client, devCut, buyCut) {
  if (devCut > 0) await client.query('UPDATE dev_fund SET omr = omr + $1, lifetime = lifetime + $1 WHERE id=1', [devCut]);
  if (buyCut > 0) await client.query('UPDATE family_yield_pool SET balance = balance + $1, lifetime_funded = lifetime_funded + $1 WHERE id=1', [buyCut]);
}

export const splitToll = (toll) => {
  const devCut = flo6(Number(toll) * TAX.DEV_BPS / 10000);
  return { devCut, buyCut: flo6(Number(toll) - devCut) };
};

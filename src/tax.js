// ── src/tax.js — THE EARLY-EXIT SURCHARGE (anti-dump, the value-creation pivot's third toll) ──
// $OMR younger than the fresh window pays a linearly-decaying surcharge when it EXITS the game
// economy (the AMM sell or a withdrawal): `EARLY_SELL_TAX_BPS` (50%) at age 0 → 0 at
// `FRESH_WINDOW_MS` (48h). No exemptions. Split like the exit toll: half → dev_fund, half →
// stake_pool (the buyback/yield pool). Spending/burning in-game is NEVER surcharged — only exits.
//
// THE LEDGER IS THE LOT TABLE (zero new instrumentation, unfakeable): every $OMR credit already
// writes a timestamped positive `transactions` row. Under FIFO (spends consume the OLDEST tokens
// first), the fresh tokens an account still HOLDS are the NEWEST `min(liquid, Σ window credits)`
// — attribute the current balance to the window's credits newest-first, then price an exit
// oldest-first (the aged, surcharge-free portion sells first; then fresh lots, each at its own
// age's rate). Deriving from the ledger means an SQL-granted balance (tests/mod comps) carries
// no credit rows and is treated as AGED — and no player-side trick can forge a timestamp.
//
// KNOWN, ACCEPTED SEAM (flagged in the design doc): stake→unstake is a bucket-internal move with
// no ledger rows, so a round-trip re-enters `omr` invisible to the window (effectively aged). The
// path is throttled by its own 6h loot-exposed unbonding; if the alpha shows dump-washing through
// staking, the dials are UNSTAKE_CD_MS or ledgering the release.
import { TAX, earlySellTaxBps, freshWindowMs } from './rules.js';

const flo6 = (x) => Math.floor(x * 1e6) / 1e6;

// Price the early-exit surcharge for taking `amount` $OMR out of an account holding `liquid`.
// Read-only (runs on the caller's txn client so it sees the txn's own view). Returns
// { surcharge, freshSold, rateNow } — the caller debits/splits/ledgers.
export async function earlySurcharge(client, accountId, liquid, amount, now = Date.now()) {
  const bps = earlySellTaxBps(), win = freshWindowMs();
  const amt = Number(amount), bal = Number(liquid);
  if (!(bps > 0) || !(amt > 0) || !(win > 0)) return { surcharge: 0, freshSold: 0 };
  // EXACT FIFO REPLAY over the window: take EVERY omr row (credits AND debits) in the last 48h in
  // time order, seed an "aged" opening lot (balance − net window change — covers pre-window
  // holdings and any un-ledgered credit, e.g. an SQL grant, which is treated as aged), then replay:
  // a credit appends a lot at its timestamp; a debit consumes lots OLDEST-first. The surviving lots
  // are exactly which tokens the account still holds and how old each is.
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
    while (debit > 0 && lots.length) {                      // FIFO: spends consume the oldest first
      const take = Math.min(lots[0].amount, debit);
      lots[0].amount -= take; debit -= take;
      if (lots[0].amount <= 1e-9) lots.shift();
    }
  }
  // safety clamp: if the ledger over-represents holdings (shouldn't happen), trim OLDEST first so
  // the error direction is MORE tax on what remains, never less
  let held = lots.reduce((a, l) => a + l.amount, 0);
  while (held > bal + 1e-9 && lots.length) {
    const over = held - bal, take = Math.min(lots[0].amount, over);
    lots[0].amount -= take; held -= take;
    if (lots[0].amount <= 1e-9) lots.shift();
  }
  // price the exit: it consumes OLDEST-first, so cheap (aged) tokens go first
  let toExit = amt, surcharge = 0, freshSold = 0;
  for (const l of lots) {
    if (toExit <= 0) break;
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
export async function creditTollBuckets(client, devCut, buyCut) {
  if (devCut > 0) await client.query('UPDATE dev_fund SET omr = omr + $1, lifetime = lifetime + $1 WHERE id=1', [devCut]);
  if (buyCut > 0) await client.query('UPDATE stake_pool SET balance = balance + $1, lifetime_funded = lifetime_funded + $1 WHERE id=1', [buyCut]);
}

export const splitToll = (toll) => {
  const devCut = flo6(Number(toll) * TAX.DEV_BPS / 10000);
  return { devCut, buyCut: flo6(Number(toll) - devCut) };
};

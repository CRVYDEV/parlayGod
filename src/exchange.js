// TOKENOMICS v2 — THE EXCHANGE and THE FAMILY YIELD (founder-directed 2026-07-27).
// Design: omerta-tokenomics-v2-design.md
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────────────
// v2 severs cash → OMR. That single change is the point of the whole rework: today every cash faucet
// in the game is secretly a token-price decision, because in-game cash converts to OMR. The measured
// maxed passive stack is $21.6M/day for ONE player, and the only things between that and sell
// pressure are a wash cap and AMM depth. Cut the conversion and cash becomes a purely internal
// gameplay resource — you could 10x every faucet and the token would not notice.
//
// But you CANNOT implement that by disabling one side of the AMM. `swap` is constant-product over a
// cash reserve and an OMR reserve; make it one-directional and every trade removes cash and adds
// OMR, nothing refills the cash side, and the reserves skew monotonically until the price approaches
// zero and the window shuts itself. A one-way AMM is not a market — it is a draining bucket. So the
// AMM is replaced by a purpose-built redemption window:
//
//     burn X OMR  →  X × EXCHANGE.RATE cash, from a pool that only real cash SINKS feed,
//                    clamped to what was funded, clamped to a per-account daily cap.
//
// The Phase-4 stake-pool discipline, applied to cash: the window is a CLAIM ON WHAT WAS FUNDED,
// never a promise. A dry pool refuses cleanly and burns nothing.
//
// Arbitrage is impossible BY CONSTRUCTION — cash has no exit in v2, so there is no outside price to
// arbitrage the window against. That is the quiet benefit of the one-way design and it is why a flat
// published rate is safe here where it would not be in a two-way market.
//
// §10.4: `window:burn` is an $OMR BURN (omrBurns). `window:payout` is a character_id'd cash
// FAUCET — honest about being one, bounded by the pool, and reconciled by a new `exchange pool
// backed` invariant (paid <= funded) which proves it is a redistribution of real sinks rather than
// inflation. The prefix is `window:` and NOT `exchange:` on purpose — the M3 cb/ammo barter board
// already owns `exchange:`, and two systems sharing a reason prefix is exactly how a vocabulary
// check stops meaning anything.
import crypto from 'node:crypto';
import { EXCHANGE, FAMILY_YIELD, exchangeOpen } from './rules.js';
import { GameError } from './game.js';
import { spendOmr } from './vanity.js';

const num = (v) => Number(v || 0);
const round2 = (n) => Math.round(n * 100) / 100;

// ── the pool ─────────────────────────────────────────────────────────────────────────────────────
export async function exchangePool(db) {
  const r = (await db.query('SELECT balance, lifetime_funded, lifetime_paid FROM exchange_pool WHERE id=1')).rows[0];
  return { balance: num(r?.balance), funded: num(r?.lifetime_funded), paid: num(r?.lifetime_paid) };
}

// Move a slice of the street-tax pool into the window. Runs on the 12h worker tick alongside the
// buyback, which is the same cash the buyback already draws on — so the window competes with the
// buyback for sink revenue rather than inventing any. Locks street_tax then exchange_pool: both are
// singletons and this is the only writer that touches the pair, so the order is trivially stable.
// The carve itself — ONE implementation, called either from inside the buyback's transaction (which
// already holds the street_tax lock and has done the 12h due-check) or standalone below. Two copies
// of this arithmetic in two transaction contexts is exactly how a funding number drifts.
export async function carveExchange(client, cashPool) {
  if (!exchangeOpen()) return 0;          // shut window: divert no revenue (see EXCHANGE.OPEN)
  const take = Math.floor(num(cashPool) * EXCHANGE.FUND_BPS / 10000);
  if (take <= 0) return 0;
  await client.query('UPDATE street_tax SET pool = pool - $1 WHERE id=1', [take]);
  await client.query(
    'UPDATE exchange_pool SET balance = balance + $1, lifetime_funded = lifetime_funded + $1 WHERE id=1', [take]);
  return take;
}

export async function fundExchange(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tax = (await client.query('SELECT pool FROM street_tax WHERE id=1 FOR UPDATE')).rows[0];
    const take = await carveExchange(client, num(tax?.pool));
    if (take <= 0) { await client.query('ROLLBACK'); return { funded: 0 }; }
    await client.query('COMMIT');
    return { funded: take };
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

// ── the window ───────────────────────────────────────────────────────────────────────────────────
// Burn $OMR, take cash. Runs inside withCharacter, so the actor's character + account rows are
// already locked; the pool singleton is locked LAST (the canonical characters → accounts →
// singletons order), so concurrent redemptions serialize on it and the clamp cannot be raced.
export async function redeem(ch, amount, client, h) {
  // THE INTERLOCK (see EXCHANGE.OPEN): while cash → $OMR still exists, a fixed-rate window is a
  // money pump whenever AMM spot sits below RATE. Shut until the buy side is retired.
  if (!exchangeOpen()) {
    throw new GameError('closed', 'The window is shut. It opens when cash stops buying $OMR.');
  }
  const omr = Number(amount);
  if (!(Number.isFinite(omr) && omr >= EXCHANGE.MIN_OMR)) {
    throw new GameError('amount', `The window takes ${EXCHANGE.MIN_OMR} $OMR or more.`);
  }
  // the rolling-24h per-account cap (the D3 wash-cap token bucket, on the account this time)
  const now = Date.now();
  const at = h.acct.exchange_at ? new Date(h.acct.exchange_at).getTime() : 0;
  const elapsed = Math.max(0, now - at);
  const decayed = Math.max(0, num(h.acct.exchange_used) - EXCHANGE.DAILY_CAP_OMR * (elapsed / 864e5));
  if (decayed + omr > EXCHANGE.DAILY_CAP_OMR) {
    throw new GameError('cap', `The window moves ${EXCHANGE.DAILY_CAP_OMR} $OMR a day. Come back tomorrow.`);
  }

  const p = (await client.query('SELECT balance FROM exchange_pool WHERE id=1 FOR UPDATE')).rows[0];
  const cash = Math.floor(omr * EXCHANGE.RATE);
  if (num(p?.balance) < cash) {
    // NOTHING is burned on a dry pool. The window is a claim on what was funded, not a promise —
    // burning into an empty till would be taking the token and giving nothing back.
    throw new GameError('dry', 'The window is short today. Nothing was burned — try again after the next take.');
  }

  await spendOmr(client, h, omr, 'window:burn');          // the $OMR leaves supply
  await client.query(
    'UPDATE exchange_pool SET balance = balance - $1, lifetime_paid = lifetime_paid + $1 WHERE id=1', [cash]);
  ch.cash = num(ch.cash) + cash;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: cash, reason: 'window:payout' });

  // absolute writes from the decayed value (the wash-bucket discipline — never `used = used + n`,
  // which would re-add what time already forgave)
  await client.query('UPDATE account_persistent SET exchange_used=$2, exchange_at=now() WHERE account_id=$1',
    [h.accountId, round2(decayed + omr)]);
  h.acct.exchange_used = round2(decayed + omr); h.acct.exchange_at = new Date(now);

  return { ok: true, burned: omr, cash, rate: EXCHANGE.RATE, poolLeft: num(p.balance) - cash };
}

// The public window: the rate, what the till holds, and your own headroom.
export async function exchangeBoard(db, h) {
  const p = await exchangePool(db);
  const now = Date.now();
  const at = h?.acct?.exchange_at ? new Date(h.acct.exchange_at).getTime() : 0;
  const decayed = Math.max(0, num(h?.acct?.exchange_used) - EXCHANGE.DAILY_CAP_OMR * (Math.max(0, now - at) / 864e5));
  return {
    rate: EXCHANGE.RATE, minOmr: EXCHANGE.MIN_OMR, dailyCapOmr: EXCHANGE.DAILY_CAP_OMR,
    pool: Math.floor(p.balance),
    // what the till could pay you right now, in $OMR terms — the honest number to show
    poolOmr: Math.floor(p.balance / EXCHANGE.RATE),
    yourHeadroomOmr: round2(Math.max(0, EXCHANGE.DAILY_CAP_OMR - decayed)),
    open: exchangeOpen(),
    note: exchangeOpen()
      ? 'One way. Cash never becomes $OMR — the window only runs the other direction.'
      : 'The window is shut. It opens when cash stops buying $OMR — one way only, from then on.',
  };
}

// ── THE FAMILY YIELD ─────────────────────────────────────────────────────────────────────────────
// What individual staking rewards and personal RWA dividends are repurposed into. Standing already
// bought Commission seats (status); now it pays, so tribute, wars and the seasonal standing reset
// carry a real economic prize — and $OMR gains a reason to be held by an ORGANISATION rather than
// sold by a person.
//
// §10.4: a pure TRANSFER, pool → gangs.omr_reserve. Both sides are already in `omrBuckets`, so
// conservation is exact and nothing is minted. Ledgered `yield:family` with no character_id and the
// gang as counterparty — the `gang:contract` shape.
export async function fundFamilyYield(client, omr) {
  const add = Number(omr);
  if (!(Number.isFinite(add) && add > 0)) return 0;
  await client.query(
    'UPDATE family_yield_pool SET balance = balance + $1, lifetime_funded = lifetime_funded + $1 WHERE id=1', [add]);
  return add;
}

export async function familyYieldPool(db) {
  const r = (await db.query('SELECT balance, lifetime_funded, lifetime_paid FROM family_yield_pool WHERE id=1')).rows[0];
  return { balance: num(r?.balance), funded: num(r?.lifetime_funded), paid: num(r?.lifetime_paid) };
}

// The distribution. Runs on the 12h worker tick. Ranks by the SEASONAL standing formula the chamber
// already uses (the econ-pass fix that made seats re-contestable), pays the top SEATS families a
// descending-weighted share, and skips a family that has dissolved between the read and the write —
// its share simply stays in the pool rather than leaking.
export async function payFamilyYield(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // LOCK ORDER (red-team F1). Rank UNLOCKED, then lock the payee GANGS in a stable id order, and
    // only THEN the pool singleton — the codebase's global order (characters → accounts → gangs →
    // singletons), and specifically the order runBuyback already takes: it holds gang locks and then
    // writes family_yield_pool once FUND_BPS > 0. Locking the pool first (as this did) is an AB-BA
    // deadlock against the buyback — and one ARMED BY THE MIGRATION ITSELF, since it only becomes
    // reachable the moment the founder raises the very dial the design says to raise.
    const ranked = (await client.query(
      `SELECT id, name, (COALESCE(season_tribute,0) + 10000 * COALESCE(season_wars,0)) AS standing
         FROM gangs ORDER BY standing DESC, id ASC LIMIT $1`, [FAMILY_YIELD.SEATS])).rows
      .filter((g) => num(g.standing) > 0);
    if (!ranked.length) { await client.query('ROLLBACK'); return { paid: 0, families: [] }; }

    // Weights come from RANK across the whole ranked set, so a family that dissolves between the read
    // and the lock simply drops out and its share stays in the pot rather than being redistributed.
    // Sorted with the codepoint comparator the rest of the tree uses (`.sort()` / `a.id < b.id`), NOT
    // localeCompare: for canonical UUIDs the two agree, but two lock paths ordering the same rows by
    // different comparators is how a deadlock hides, so there is one comparator.
    const live = [];
    for (const g of [...ranked].sort((a, b) => (a.id < b.id ? -1 : 1)))
      if ((await client.query('SELECT 1 FROM gangs WHERE id=$1 FOR UPDATE', [g.id])).rows[0]) live.push(g.id);
    if (!live.length) { await client.query('ROLLBACK'); return { paid: 0, families: [] }; }

    // now the singleton, LAST
    const p = (await client.query('SELECT balance FROM family_yield_pool WHERE id=1 FOR UPDATE')).rows[0];
    const bal = num(p?.balance);
    if (bal < FAMILY_YIELD.MIN_PAYOUT) { await client.query('ROLLBACK'); return { paid: 0, families: [] }; }

    const total = ranked.reduce((a, _, i) => a + (FAMILY_YIELD.WEIGHTS[i] ?? 1), 0);
    const out = [];
    let paid = 0;
    // pay in RANK order (the locks are already held, so order here is free) — the head seat gets its
    // full share and the tail seat absorbs any rounding
    for (let i = 0; i < ranked.length; i++) {
      const g = ranked[i];
      if (!live.includes(g.id)) continue;      // dissolved under the lock — share stays in the pot
      // CLAMP to what the pot actually holds (red-team F2). Rounding each share to 2dp can sum to a
      // cent MORE than the balance — measured at 53 of the first 400 cent-values — which drives the
      // pool NEGATIVE and trips this system's own `family yield backed` invariant. Never pay out
      // more than is there.
      const share = Math.min(round2(bal * (FAMILY_YIELD.WEIGHTS[i] ?? 1) / total), round2(bal - paid));
      if (share < FAMILY_YIELD.MIN_PAYOUT) continue;
      await client.query('UPDATE gangs SET omr_reserve = omr_reserve + $2 WHERE id=$1', [g.id, share]);
      // the headless-ledger convention (emission.js): a JS-generated id, because pg-mem has no
      // gen_random_uuid(). NULL character_id + the gang as counterparty — the `gang:contract` shape.
      await client.query(
        'INSERT INTO transactions (id, character_id, account_id, currency, amount, reason, counterparty) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [crypto.randomUUID(), null, null, 'omr', share, 'yield:family', g.id]);
      paid = round2(paid + share);
      out.push({ gang: g.id, name: g.name, share, rank: i + 1 });
    }
    if (paid > 0) {
      await client.query(
        'UPDATE family_yield_pool SET balance = balance - $1, lifetime_paid = lifetime_paid + $1 WHERE id=1', [paid]);
    }
    await client.query('COMMIT');
    return { paid, families: out };
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

// The public board — who is drawing the yield, and what the pot holds.
export async function yieldBoard(db) {
  const p = await familyYieldPool(db);
  const top = (await db.query(
    `SELECT id, name, tag, omr_reserve, (COALESCE(season_tribute,0) + 10000 * COALESCE(season_wars,0)) AS standing
       FROM gangs ORDER BY standing DESC, id ASC LIMIT $1`, [FAMILY_YIELD.SEATS])).rows;
  const weights = top.map((_, i) => FAMILY_YIELD.WEIGHTS[i] ?? 1);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return {
    pool: round2(p.balance), lifetimePaid: round2(p.paid), seats: FAMILY_YIELD.SEATS,
    families: top.map((g, i) => ({
      rank: i + 1, name: g.name, tag: g.tag, standing: num(g.standing),
      shareBps: Math.round(weights[i] / total * 10000),
      nextPayout: round2(p.balance * weights[i] / total),
      reserve: round2(num(g.omr_reserve)),
    })),
    note: `The top ${FAMILY_YIELD.SEATS} families by this season's standing split the yield. Seats re-contest every season.`,
  };
}

// ── the real-value invariant ─────────────────────────────────────────────────────────────────────
// The cash side of the window is a FAUCET, so it needs its own proof that it is a redistribution
// rather than inflation: it can never have paid out more than was moved into it. Same shape as
// runVigInvariants — checked on demand and by the worker, separate from the §10.4 sweep.
export async function runExchangeInvariants(pool) {
  const ex = await exchangePool(pool);
  const fy = await familyYieldPool(pool);
  const checks = [
    { name: 'exchange pool backed', lhs: ex.paid, rhs: ex.funded, ok: ex.paid <= ex.funded + 0.01,
      note: 'cash paid out of the redemption window <= cash funded into it' },
    { name: 'exchange pool balance', lhs: round2(ex.balance), rhs: round2(ex.funded - ex.paid),
      ok: Math.abs(ex.balance - (ex.funded - ex.paid)) < 0.01,
      note: 'balance == funded - paid' },
    { name: 'family yield backed', lhs: fy.paid, rhs: fy.funded, ok: fy.paid <= fy.funded + 0.01,
      note: '$OMR paid to families <= $OMR funded into the pot' },
    // (red-team F7) The pot needs the SAME identity the exchange pool has. `backed` alone is not
    // enough: it carries a 0.01 tolerance, which is exactly the size of the per-share rounding
    // over-pay it would have to catch — so a pot driven NEGATIVE reads ok:true and the alarm never
    // fires. This is the check that actually sees it. Verified against the unclamped code.
    { name: 'family yield balance', lhs: round2(fy.balance), rhs: round2(fy.funded - fy.paid),
      ok: Math.abs(fy.balance - (fy.funded - fy.paid)) < 0.01 && fy.balance >= -0.001,
      note: 'balance == funded - paid, and never negative' },
  ];
  return { ok: checks.every((c) => c.ok), checks };
}

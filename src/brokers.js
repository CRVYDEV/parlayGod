// THE BROKERS — treasury-funded RWA rewards to NFT holders.
// Design: `omerta-brokers-design.md`. Founder-directed 2026-08-10.
//
// ── WHAT IS HERE, AND WHAT DELIBERATELY IS NOT ───────────────────────────────────────────────────
// Steps 3 and 4 of the design's order of work — the ACTIVATION sink and the EPOCH ALLOCATOR — plus,
// since 2026-08-15, THE DISTRIBUTION (`distributeBuy`): the one link that turns a real buy's units
// into `stock_allocations` rows pro-rata over an epoch's published weights. Activation is a
// recurring $OMR sink the late game has wanted since the audits first flagged supply pooling into
// staking; the allocator computes and publishes the weights; the distribution writes the OWED
// ledger the delivery rail consumes.
//
// **NOTHING HERE ACQUIRES, HOLDS, OR DELIVERS A SECURITY.** No stock is bought (that is the keeper,
// step 5), and nothing here moves stock on-chain: `distributeBuy` writes account-keyed BOOKKEEPING
// (the vault-ledger shape — an allocation is a ledger row, not a stranded on-chain balance), and it
// is dormant by construction pre-mainnet, because only a REAL buy's units exist to split and real
// buys need a real DEX. Delivery — the act the launch checklist gates — is `src/stockdeliver.js`'s
// keeper + the Delivered watcher, behind their own env walls.
//
// ── §10.4 ────────────────────────────────────────────────────────────────────────────────────────
// The only value that moves is the activation burn: `brokers:activate`, an $OMR SINK through the
// audited `spendOmr` till. It is in `DESK.SINK_REASONS`, so since economy v3 it RECYCLES to the desk
// shelf like every other sink rather than being destroyed — the paired `desk:recycle` row means
// conservation needs no new term. Nothing here mints.
import { GameError } from './game.js';
import { BROKERS, ACTIVITY, brokerTier, brokerActive, brokerWeight, activityScore, activityQualifies, dayOf }
  from './rules.js';
import { spendOmr } from './vanity.js';
import { allocateStock } from './treasury.js';
import crypto from 'node:crypto';

// Floor at the ledger's 6dp grid so a pro-rata split can never sum PAST the buy (the remainder
// stays unallocated in the treasury's held — never rounded up into somebody's line).
const floor6 = (n) => Math.floor(n * 1e6) / 1e6;
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/// The tier catalog, for the client and for `/v1/rules`.
export const brokerCatalog = () => ({
  tiers: BROKERS.TIERS.map((t) => ({ id: t.id, name: t.name, omr: t.omr, mult: t.mult })),
  windowDays: Math.round(BROKERS.ACTIVATION_MS / 86400000),
  epochDays: BROKERS.EPOCH_DAYS,
  // published so a client never re-derives the metric — the tradeRank precedent
  tags: ACTIVITY.TAGS,
  minTracks: ACTIVITY.MIN_TRACKS,
  minScore: ACTIVITY.MIN_SCORE,
});

/// Raw action counts for an account over a day window, as `activityScore` expects them.
export async function gainsFor(client, accountId, fromDay, toDay) {
  const r = await client.query(
    'SELECT tag, SUM(n) AS n FROM activity_log WHERE account_id=$1 AND day >= $2 AND day <= $3 GROUP BY tag',
    [accountId, fromDay, toDay]);
  const gains = {};
  for (const row of r.rows) gains[row.tag] = Number(row.n);
  return gains;
}

/// Buy or extend an activation window.
///
/// A tier is chosen, not climbed — it is a commitment level, not a ladder, so there is no "sequential
/// only" rule here (unlike family seals or the estate). Re-activating at any tier extends the window
/// from the later of now and the current end, which is the retainer/envelope/Street-Wire precedent.
export async function activate(ch, client, h, tierId) {
  const t = brokerTier(tierId);
  if (!t) throw new GameError('bad_tier', 'No such broker tier.');

  const cur = (await client.query(
    'SELECT tier, until, spent_omr FROM broker_activations WHERE account_id=$1 FOR UPDATE',
    [ch.account_id])).rows[0];

  // A DOWNGRADE while a window is live is refused rather than silently taken: it would burn $OMR to
  // make the holder's own weight smaller, which is never what anybody meant to click.
  if (cur && brokerActive(cur.until) && Number(cur.tier) > t.id) {
    throw new GameError('downgrade', `You are already activated at ${brokerTier(cur.tier).name}. Pick that tier or higher.`);
  }

  await spendOmr(client, h, t.omr, 'brokers:activate');

  const base = cur && brokerActive(cur.until) ? new Date(cur.until).getTime() : Date.now();
  const until = new Date(base + BROKERS.ACTIVATION_MS);
  const spent = Number(cur?.spent_omr || 0) + t.omr;

  const upd = await client.query(
    'UPDATE broker_activations SET tier=$2, until=$3, spent_omr=$4 WHERE account_id=$1',
    [ch.account_id, t.id, until, spent]);
  if (!upd.rowCount) {
    await client.query(
      'INSERT INTO broker_activations (account_id, tier, until, spent_omr) VALUES ($1,$2,$3,$4)',
      [ch.account_id, t.id, until, spent]);
  }
  return { tier: t.id, name: t.name, omr: t.omr, mult: t.mult, until, spentOmr: spent };
}

/// The holder's own view: where they stand, what they would weigh, and what is missing.
export async function brokerBoard(client, ch) {
  const a = (await client.query(
    'SELECT tier, until, spent_omr FROM broker_activations WHERE account_id=$1', [ch.account_id])).rows[0];
  const active = !!a && brokerActive(a.until);
  const today = dayOf();
  const from = today - (BROKERS.EPOCH_DAYS - 1);
  const gains = await gainsFor(client, ch.account_id, from, today);

  const score = activityScore(gains);
  const qualifies = activityQualifies(gains);
  const tierId = active ? Number(a.tier) : null;

  return {
    catalog: brokerCatalog(),
    activation: {
      tier: tierId,
      name: tierId ? brokerTier(tierId).name : null,
      mult: tierId ? brokerTier(tierId).mult : 0,
      active,
      until: a?.until || null,
      secondsLeft: active ? Math.max(0, Math.floor((new Date(a.until).getTime() - Date.now()) / 1000)) : 0,
      spentOmr: Number(a?.spent_omr || 0),
    },
    epoch: { fromDay: from, toDay: today, days: BROKERS.EPOCH_DAYS },
    activity: { gains, score, qualifies, tracks: Object.keys(gains).length },
    // the whole design in one number, and the two ways it can be zero
    weight: active && qualifies ? brokerWeight(tierId, gains) : 0,
    blocked: !active ? 'not_activated' : (!qualifies ? 'not_enough_play' : null),
  };
}

/// Compute and PUBLISH one epoch's weights. Delivers nothing — see the header.
///
/// Idempotent on `(start_day, end_day)`: a re-run of the same window is a no-op rather than a second
/// epoch, so a worker restart or an overlapping manual call cannot double-publish.
export async function allocateEpoch(pool, { endDay = dayOf() - 1, days = BROKERS.EPOCH_DAYS } = {}) {
  const startDay = endDay - (days - 1);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = (await client.query(
      'SELECT id FROM broker_epochs WHERE start_day=$1 AND end_day=$2', [startDay, endDay])).rows[0];
    if (existing) { await client.query('COMMIT'); return { epochId: existing.id, already: true }; }

    // Every account with a LIVE activation. Two flat queries and a join in JS — pg-mem parses
    // neither a correlated subquery nor `= ANY($1::text[])` (the /v1/gangs and MY PROFILE lessons).
    const acts = (await client.query(
      'SELECT account_id, tier FROM broker_activations WHERE until > now()')).rows;
    const rows = (await client.query(
      'SELECT account_id, tag, SUM(n) AS n FROM activity_log WHERE day >= $1 AND day <= $2 GROUP BY account_id, tag',
      [startDay, endDay])).rows;

    const byAccount = new Map();
    for (const r of rows) {
      if (!byAccount.has(r.account_id)) byAccount.set(r.account_id, {});
      byAccount.get(r.account_id)[r.tag] = Number(r.n);
    }

    const epochId = crypto.randomUUID();
    let total = 0;
    const out = [];
    for (const a of acts) {
      const gains = byAccount.get(a.account_id) || {};
      // BOTH gates. Not activated is already excluded by the query; not enough play is excluded
      // here — and the breadth gate is what makes a one-loop grinder score nothing, which is the
      // anti-Sybil half of the metric rather than a difficulty knob.
      if (!activityQualifies(gains)) continue;
      const score = activityScore(gains);
      const weight = brokerWeight(a.tier, gains);
      if (!(weight >= BROKERS.MIN_WEIGHT)) continue;
      out.push({ accountId: a.account_id, tier: Number(a.tier), score, weight });
      total += weight;
    }

    await client.query(
      'INSERT INTO broker_epochs (id, start_day, end_day, total_weight) VALUES ($1,$2,$3,$4)',
      [epochId, startDay, endDay, total]);
    for (const w of out) {
      await client.query(
        'INSERT INTO broker_weights (epoch_id, account_id, tier, score, weight) VALUES ($1,$2,$3,$4,$5)',
        [epochId, w.accountId, w.tier, w.score, w.weight]);
    }
    await client.query('COMMIT');
    return { epochId, startDay, endDay, holders: out.length, totalWeight: total };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/// THE DISTRIBUTION — split one REAL buy's units across an epoch's published weights, exactly once.
///
/// This is the link the whole brokers chain was missing: activation burns $OMR, the allocator
/// publishes weights, the keeper buys units, the delivery rail consumes `stock_allocations` — and
/// nothing wrote `stock_allocations` from the weights side. `u_a = U × w_a / Σw`, floored at the
/// 6dp grid (the remainder stays unallocated in held — never rounded up into somebody's line), each
/// share written through the audited `allocateStock` so the `allocated ≤ held` clamp applies to
/// every row this function ever writes.
///
/// ── THE FROZEN-WEIGHTS RULE, which is §8's anti-windfall rule in the brokers shape ──────────────
/// A buy distributes ONLY to the latest epoch published BEFORE the buy was recorded
/// (`computed_at <= buy.created_at`). The allocator reads LIVE activations at publish time, so an
/// epoch published AFTER a buy could include someone who saw the buy land and activated to catch
/// it — rewarding waiting out the town, which is exactly what the design's "no roll-forward" rule
/// forbids. The ops order is therefore publish → buy → distribute, and it is stated on the mod
/// route; a buy with no frozen epoch (or a weightless one) CONSUMES its latch with zero
/// allocations — the silent-epoch rule: those units sit in the treasury's held, claimable by
/// nobody, rather than becoming a retroactive jackpot for tomorrow's activators.
///
/// ── WHY THERE IS NO `allocated ≤ Σ distributed` INVARIANT beside the nightly wall ───────────────
/// The design's invariant list names "allocations grow only from a buy's pro-rata split", and the
/// tempting enforcement is a nightly check. Deliberately not added: the treasury suite's wall tests
/// seed allocations DIRECTLY (that is how you test a clamp), a QA comp path may too, and an alarm
/// that fires on expected states is one people learn to ignore (the desk-dark lesson). The single-
/// writer discipline is enforced where it can be exact instead — the latch here, the clamp in
/// `allocateStock`, and `allocated ≤ held` nightly, which bounds the damage of any writer absolutely.
///
/// §10.4: ZERO — an allocation is ownership bookkeeping, never a currency; no `transactions` row.
export async function distributeBuy(pool, { ref } = {}) {
  const key = String(ref || '').trim();
  if (!key) throw new GameError('ref', 'Name the buy to distribute.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // The buy row IS the latch — FOR UPDATE serializes two concurrent distributions of the same
    // buy, and `distributed` makes the second a clean refusal rather than a double-booking.
    const buy = (await client.query(
      'SELECT ref, ticker, units, real, distributed, created_at FROM stock_buys WHERE ref=$1 FOR UPDATE',
      [key])).rows[0];
    if (!buy) throw new GameError('no_buy', 'No such buy.');
    if (!buy.real) throw new GameError('not_real', 'A comp books zero units — there is nothing to distribute.');
    if (buy.distributed) throw new GameError('already', 'This buy has already been distributed.');

    const units = Number(buy.units);
    const epoch = (await client.query(
      'SELECT id, total_weight FROM broker_epochs WHERE computed_at <= $1 ORDER BY computed_at DESC LIMIT 1',
      [buy.created_at])).rows[0];

    let holders = 0;
    let allocated = 0;
    let reason = null;
    if (!epoch) {
      reason = 'no_frozen_epoch'; // consumed anyway — see the frozen-weights rule above
    } else if (!(Number(epoch.total_weight) > 0)) {
      reason = 'no_weights';      // a silent epoch: the buy stands, the units stay unallocated
    } else {
      const total = Number(epoch.total_weight);
      const weights = (await client.query(
        'SELECT account_id, weight FROM broker_weights WHERE epoch_id=$1 ORDER BY account_id',
        [epoch.id])).rows;
      for (const w of weights) {
        const share = floor6(units * Number(w.weight) / total);
        if (!(share > 0)) continue;
        const got = await allocateStock(client, {
          epochId: epoch.id, accountId: w.account_id, ticker: buy.ticker, units: share });
        if (got.units > 0) { holders += 1; allocated = round6(allocated + got.units); }
      }
    }

    await client.query('UPDATE stock_buys SET distributed=true WHERE ref=$1', [key]);
    await client.query('COMMIT');
    return { ref: key, ticker: String(buy.ticker).toUpperCase(), units,
      epochId: epoch?.id || null, holders, allocated,
      unallocated: round6(units - allocated), ...(reason ? { reason } : {}) };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/// The published record, for the ops dashboard and for anyone auditing a distribution.
export async function epochBoard(pool, { limit = 10 } = {}) {
  const eps = (await pool.query(
    'SELECT id, start_day, end_day, total_weight, computed_at FROM broker_epochs ORDER BY end_day DESC LIMIT $1',
    [limit])).rows;
  return {
    epochs: eps.map((e) => ({
      id: e.id, startDay: e.start_day, endDay: e.end_day,
      totalWeight: Number(e.total_weight), computedAt: e.computed_at,
    })),
    // stated plainly on the surface a founder or auditor reads, so nobody mistakes a published
    // weight for a delivered reward
    delivered: false,
    note: 'Weights publish, distribution writes the owed ledger only. On-chain delivery is the gated act (design §6, step 7).',
  };
}

// THE CITY LEG — protocol profit buys $OMR, and the players who PLAY receive it.
// (`omerta-bank-protocol-design.md` §4.1–§4.3. Founder-directed 2026-08-10: "make it so the OMR
// bought from the profit only funds the game the players who play.")
//
// The Bank's other half was already here — the contracts, the `bank_revenue` ledger that harvest
// fees land in, and `ACTIVITY` in the rules tail, locked and pinned by `test/activity.js`. What was
// missing is the thing that connects them: nothing turned revenue into $OMR, and nothing handed
// that $OMR to anybody. This is that, and it is the flywheel the whole design is for —
// **borrowers who pay fund the players who don't**.
//
// ── THE TWO RULES, AND WHY EACH IS A CHECK RATHER THAN A POLICY ─────────────────────────────────
//
// RULE 1 — the bought $OMR is EXCLUSIVELY for in-game distribution to players. It never reaches
// NFT holders, stakers, or the team; those legs are funded from the ETH/stable side of the split
// and never from this one. Stated that way it is a promise. Stated as `Σ bought == Σ distributed`
// it is an identity a nightly runner asserts, which is what `runBankInvariants` does below.
//
// RULE 2 — the recipients are defined by PLAYING. Not by not-paying: "free player" is a status you
// hold by doing nothing, and a farm of accounts that never play is exactly that. The key IS the
// playing, so the farm receives nothing without becoming a player first.
//
// ── LINEAR AND UNCAPPED, WHICH IS NOT A PREFERENCE ─────────────────────────────────────────────
//
// Pro-rata on the activity score with NO per-account cap. This project already measured and paid
// for the alternative (BALANCE.md § THE FARM): the Street Wage's `WAGE_CAP_OMR` was commented
// "anti-Sybil" and did the opposite — a per-individual cap clips the honest whale and hands the
// remainder to whoever runs more accounts, because the only way around a per-individual cap is to
// BE several individuals. The general law:
//
//   concave (a cap, a log-share) → splitting effort across N accounts GAINS      → Sybil-POSITIVE
//   linear                       → splitting gains exactly nothing               → Sybil-NEUTRAL ✔
//
// So the Sybil bound is not a cap; it is the game's own clocks. Every tag in `ACTIVITY.TAGS` is
// throttled by nerve, energy or a cooldown, so a farm's cost and its reward are both linear in N —
// identical ROI to an honest player. `test/bank.js` asserts the split-is-neutral property directly,
// because it is the one an added cap would silently break.
//
// The breadth gate (`MIN_TRACKS`) is the opposite shape and belongs: it is a fixed cost per ACCOUNT,
// so it is Sybil-NEGATIVE, and it never clips an honest player's payout.
//
// ── §10.4 ──────────────────────────────────────────────────────────────────────────────────────
//
// ONE reason, and it is not a new one: `prize:omr`, which `invariants.js` already documents as "an
// in-game $OMR credit BACKED by hard $OMR moved into the withdrawal reserve — admissible because real
// revenue backs every token". Wall 1 (no faucet) survives intact, because every token handed to a
// player was BOUGHT, not printed — and now, additionally, bought for somebody who was playing.
//
// The backing is asserted from both directions, and that needed care: `fundReserve` has a two-sided
// sandwich in `runVigInvariants` naming every legitimate funder BY NAME, so a new one that is not
// added to both terms does not fail open — it fires SPURIOUSLY, on both halves at once. That is the
// desk's lesson (AUDIT-desk F1) and `cityPaid` is threaded there in the same commit as this file.
import crypto from 'node:crypto';
import { ledger, GameError } from './game.js';
import { fundReserve } from './chain.js';
import { ACTIVITY, activityScore, activityQualifies, dayOf } from './rules.js';

const num = (x) => Number(x || 0);
const round6 = (x) => Math.round(x * 1e6) / 1e6;

// How many days one distribution covers. A day matches ACTIVITY.EPOCH and the ticker ballot's clock.
export const CITY_EPOCH_DAYS = 1;

/// The pool's books. A singleton row that materialises on first touch (the world_npcs precedent).
async function poolRow(client) {
  await client.query('INSERT INTO bank_city_pool (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
  return (await client.query('SELECT * FROM bank_city_pool WHERE id=1 FOR UPDATE')).rows[0];
}

/// Revenue that has actually arrived, per asset — the root cap on what the buy may spend.
export async function revenueByAsset(client) {
  const out = {};
  for (const r of (await client.query(
    "SELECT asset, COALESCE(SUM(amount),0) s FROM bank_revenue WHERE real GROUP BY asset")).rows) {
    out[r.asset] = round6(num(r.s));
  }
  return out;
}
async function spentByAsset(client) {
  const out = {};
  for (const r of (await client.query(
    'SELECT asset, COALESCE(SUM(spent),0) s FROM bank_buys WHERE real GROUP BY asset')).rows) {
    out[r.asset] = round6(num(r.s));
  }
  return out;
}

/// THE BUY — protocol profit spent on $OMR at market, landing in the city pool.
///
/// The ACCOUNTING half only, exactly like `runVigBuyback` and `runStockBuyback`: the achieved price
/// is a PARAMETER, so this is deterministic and testable off-chain, and on mainnet the bot does the
/// real DEX trade and reports what it got. There is no price source in-process and a tick that had
/// to invent one would be inventing the number every wall here bounds.
///
/// Two gates, and they are the same two every real-value ingest in this tree carries:
///   • IDEMPOTENT on `ref`, so a re-delivered event books once.
///   • `txHash` GATED — a comp/QA call records the episode and books ZERO **$OMR**, not merely zero
///     spend. That is stricter than the desk's comp, which stocks its shelf unconditionally, and the
///     difference is where the pool's contents can GO. Desk inventory is soft supply inside
///     `omrBuckets` that only reaches a player through a paid fill; this pool's ONLY exit is a
///     `prize:omr` MINT followed by `fundReserve`, i.e. the assertion "hard $OMR arrived and stands
///     behind this". A comp that credited $OMR here would let the server sign a real withdrawal
///     against backing that does not exist — the treasury's "a comp books ZERO units" posture, and
///     the reason it is that one rather than the desk's.
///     To exercise the distribution in QA, pass a txHash (the mod route's `modRealTxHash` gate).
export async function recordBankBuy(pool, { ref, asset = 'USDC', spent, omrBought, txHash = null, bootstrap = false } = {}) {
  if (!ref) throw new GameError('ref', 'Every buy needs a reference.');
  const sp = Number(spent); const got = Number(omrBought);
  if (!Number.isFinite(sp) || !(sp > 0)) throw new GameError('spent', 'Positive amounts only.');
  if (!Number.isFinite(got) || !(got > 0)) throw new GameError('bought', 'Positive amounts only.');
  const real = !!txHash;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if ((await client.query('SELECT 1 FROM bank_buys WHERE ref=$1', [ref])).rows[0]) {
      await client.query('COMMIT');
      return { already: true, ref };
    }
    // THE ROOT CAP. Never spend more of an asset than actually arrived as revenue — the same shape
    // as the Vig's `spend ≤ revenue` and the keeper's budget. Read inside the transaction so two
    // concurrent buys cannot each see the whole budget (the runVigBuyback discipline).
    if (real) {
      const rev = (await revenueByAsset(client))[asset] || 0;
      const already = (await spentByAsset(client))[asset] || 0;
      if (round6(already + sp) > round6(rev) + 1e-6) {
        await client.query('ROLLBACK');
        throw new GameError('budget', `Only ${round6(rev - already)} ${asset} of protocol profit has arrived.`);
      }
      // THE PRICE WALL (AUDIT-family-buyback F3 — the same class as the family keeper's, one system
      // over, and with a sharper consequence). This ingest takes `spent` and `omrBought` as two
      // INDEPENDENT numbers and caps only the first, so the implied price was unbounded: measured on
      // the unfixed code, 1 USDC of real protocol profit booked 1,000,000,000 $OMR into the city pool
      // with runBankInvariants green — green BY CONSTRUCTION, because `distributed \u2264 bought` compares
      // against the caller's own `bought`. And this pool's exit is not a badge: payCityLeg mints
      // `prize:omr` to PLAYERS and calls fundReserve, i.e. it raises the number signVoucher reads
      // before signing a REAL on-chain withdrawal.
      // The game has no OMR/USDC price to anchor on (the canonical print is OMR per ETH), so this is
      // the family keeper's answer exactly: continuity against the last real buy IN THIS ASSET, and a
      // first fill that has nothing to be continuous with is REFUSED rather than trusted to set its
      // own reference — the treasury's posture, seeded once, deliberately.
      const price = round6(got / sp);
      const jump = Number(process.env.BANK_MAX_PRICE_JUMP) || 10;
      const lastRow = (await client.query(
        'SELECT spent, omr_bought FROM bank_buys WHERE asset=$1 AND real AND spent > 0 ORDER BY created_at DESC LIMIT 1',
        [asset])).rows[0];
      const ref0 = lastRow ? round6(num(lastRow.omr_bought) / num(lastRow.spent)) : 0;
      if (ref0 > 0 && (price > ref0 * jump || price < ref0 / jump)) {
        await client.query('ROLLBACK');
        throw new GameError('price_sanity',
          `${price} $OMR per ${asset} is more than ${jump}x away from the last real buy (${ref0}).`);
      }
      if (!(ref0 > 0) && !bootstrap) {
        await client.query('ROLLBACK');
        throw new GameError('price_unanchored',
          `No prior real buy in ${asset} to check ${price} $OMR per ${asset} against — pass bootstrap:true to seed the reference deliberately.`);
      }
    }
    // Both columns are gated, not just `spent` — see the header. The episode is on the record either
    // way, so a comp is still auditable; it simply moves nothing.
    const booked = real ? round6(got) : 0;
    await client.query(
      'INSERT INTO bank_buys (ref, asset, spent, omr_bought, tx_hash, real) VALUES ($1,$2,$3,$4,$5,$6)',
      [ref, asset, real ? sp : 0, booked, txHash, real]);
    const p = await poolRow(client);
    await client.query(
      'UPDATE bank_city_pool SET balance = $1, bought_total = $2 WHERE id=1',
      [round6(num(p.balance) + booked), round6(num(p.bought_total) + booked)]);
    await client.query('COMMIT');
    return { ref, asset, spent: real ? sp : 0, omrBought: booked, real };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}

/// Raw per-account action counts over a day window, in the shape `activityScore` expects.
/// Two flat queries and a join in JS: pg-mem parses neither a correlated subquery nor
/// `= ANY($1::text[])` (the /v1/gangs and MY PROFILE lessons), and this runs on both engines.
async function gainsByAccount(client, startDay, endDay) {
  const rows = (await client.query(
    'SELECT account_id, tag, SUM(n) AS n FROM activity_log WHERE day >= $1 AND day <= $2 GROUP BY account_id, tag',
    [startDay, endDay])).rows;
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.account_id)) by.set(r.account_id, {});
    by.get(r.account_id)[r.tag] = Number(r.n);
  }
  return by;
}

/// THE DISTRIBUTION — one epoch, pro-rata linear on the activity score, uncapped.
///
/// Idempotent on the window (`UNIQUE (start_day, end_day)`), so a second run over the same days is a
/// no-op rather than a second payout — the backstop the broker allocator uses, and the one that
/// makes a worker sweep safe to run on every tick.
///
/// Pays through the audited rail: credit `prize:omr`, then `fundReserve` the same amount so the hard
/// token stands behind the soft one. `fundReserve` opens its own transaction, so it runs AFTER the
/// commit exactly as `payPrizes` does — and the Vig's `reserve not under-funded` half is what would
/// catch a crash in that gap, which is why it had to learn this leg's name.
const CITY_LOCK_CLASS = 0x424b;  // 'BK' — distinct from the wage epoch's, the population's, NW and ND
export async function runCityLeg(pool, opts = {}) {
  // SINGLE-WRITER. Two worker replicas overlap on every deploy, and this is a MINT path. The
  // `UNIQUE (start_day, end_day)` constraint already makes a double payout impossible — the loser's
  // whole transaction rolls back — but "impossible because a constraint threw" means the loser has
  // taken a `FOR UPDATE` on every payee and done all the work first, and it surfaces as a 23505 in
  // the worker log rather than as nothing. The advisory lock is the documented posture for a metered
  // faucet (the wage epoch's, then the population's); a crashed run releases it with its session.
  // pg-mem (no DATABASE_URL) is single-process, so there is nothing to serialize there.
  let lockConn = null;
  if (process.env.DATABASE_URL) {
    lockConn = await pool.connect();
    const got = (await lockConn.query('SELECT pg_try_advisory_lock($1,$2) AS ok', [CITY_LOCK_CLASS, 0])).rows[0].ok;
    if (!got) { lockConn.release(); return { skipped: 'locked' }; }
  }
  try {
    return await runCityLegInner(pool, opts);
  } finally {
    if (lockConn) {
      await lockConn.query('SELECT pg_advisory_unlock($1,$2)', [CITY_LOCK_CLASS, 0]).catch(() => {});
      lockConn.release();
    }
  }
}

async function runCityLegInner(pool, { endDay = dayOf() - 1, days = CITY_EPOCH_DAYS } = {}) {
  const startDay = endDay - (days - 1);
  const client = await pool.connect();
  let funded = 0;
  try {
    await client.query('BEGIN');
    const existing = (await client.query(
      'SELECT id, paid_omr FROM bank_epochs WHERE start_day=$1 AND end_day=$2', [startDay, endDay])).rows[0];
    if (existing) {
      await client.query('COMMIT');
      return { epochId: existing.id, already: true, paid: round6(num(existing.paid_omr)) };
    }

    const p = await poolRow(client);
    const poolOmr = round6(num(p.balance));

    // AN EMPTY POOL DOES NOT CONSUME THE WINDOW. Writing a zero-paid epoch would be harmless to the
    // books — the pool rolls forward either way — but `UNIQUE (start_day, end_day)` means the row is
    // the window's only chance. A sweep that ran at 00:05 with nothing bought yet would quietly
    // close yesterday against a buy that lands at noon. Skipping leaves the day claimable, which
    // costs nothing and is the difference between "no profit yet" and "those players missed out".
    if (!(poolOmr > 0)) {
      await client.query('COMMIT');
      return { startDay, endDay, paid: 0, skipped: 'empty' };
    }

    // Who qualifies. Agents and residents are excluded at the SOURCE, matching the standing posture
    // on every legend and faucet surface — an agent that plays is playing, but the participation
    // pools are for humans, and scenery cannot receive a distribution at all.
    // The two flags are read in JS rather than interpolated into the WHERE, so the SQL is STATIC and
    // `tools/pgquery.js` can prepare it against real Postgres — an interpolated string is unchecked
    // by that guard, and this query runs on the one path that mints.
    const humans = new Set((await client.query(
      'SELECT account_id, agent_flag, npc_flag FROM account_persistent')).rows
      .filter((r) => !(ACTIVITY.EXCLUDE_AGENTS && r.agent_flag) && !(ACTIVITY.EXCLUDE_NPC && r.npc_flag))
      .map((r) => r.account_id));

    const by = await gainsByAccount(client, startDay, endDay);
    const runners = [];
    let totalScore = 0;
    for (const [accountId, gains] of by) {
      if (!humans.has(accountId)) continue;
      // The breadth gate AND the dust floor. Neither is a cap: MIN_TRACKS is a fixed per-account
      // cost (Sybil-negative) and MIN_SCORE only refuses dust rows.
      if (!activityQualifies(gains)) continue;
      const score = activityScore(gains);
      if (!(score > 0)) continue;
      runners.push({ accountId, score });
      totalScore += score;
    }
    // SORTED, and for two reasons. The obvious one: this loop takes a `FOR UPDATE` on every payee,
    // and the house rule is that multi-row lock acquisition follows a stable id order so it can
    // never cycle — `refundPot` iterated its funders unsorted and that was the bounty AB-BA root.
    // The quieter one: the remainder below lands on the LAST runner, and an unsorted Map hands that
    // crumb to whoever the query happened to return last, which is not a thing a distribution
    // should leave to chance.
    runners.sort((x, y) => (x.accountId < y.accountId ? -1 : x.accountId > y.accountId ? 1 : 0));

    const epochId = crypto.randomUUID();
    let paid = 0;
    if (totalScore > 0) {
      // LINEAR, UNCAPPED. Splitting one player's effort across N accounts yields the identical
      // total, which is the property that makes this Sybil-neutral — assert it, never soften it.
      //
      // The remainder rule sits on the LAST payee: shares round DOWN at six decimals, so paying
      // each `floor(share)` strands dust in the pool forever and `Σ paid == bought` drifts by a
      // crumb per epoch. The last runner takes what is left of this epoch's pot instead (the
      // sell-tax LP-slice and boxing-purse discipline).
      for (let i = 0; i < runners.length; i++) {
        const r = runners[i];
        const want = i === runners.length - 1
          ? round6(poolOmr - paid)
          : round6(poolOmr * (r.score / totalScore));
        const omr = Math.min(want, round6(poolOmr - paid));
        if (!(omr > 0)) continue;
        const acct = (await client.query(
          'SELECT account_id FROM account_persistent WHERE account_id=$1 FOR UPDATE', [r.accountId])).rows[0];
        if (!acct) continue;                       // vanished between the read and the pay
        await client.query('UPDATE account_persistent SET omr = omr + $2 WHERE account_id=$1', [r.accountId, omr]);
        await ledger(client, { accountId: r.accountId, currency: 'omr', amount: omr, reason: 'prize:omr' });
        await client.query(
          'INSERT INTO bank_payouts (epoch_id, account_id, score, omr) VALUES ($1,$2,$3,$4)',
          [epochId, r.accountId, r.score, omr]);
        r.omr = omr;
        paid = round6(paid + omr);
      }
    }

    await client.query(
      `INSERT INTO bank_epochs (id, start_day, end_day, pool_omr, total_score, players, paid_omr)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [epochId, startDay, endDay, poolOmr, totalScore, runners.filter((r) => r.omr > 0).length, paid]);
    await client.query(
      'UPDATE bank_city_pool SET balance = $1, paid_total = paid_total + $2 WHERE id=1',
      [round6(num(p.balance) - paid), paid]);
    await client.query('COMMIT');
    funded = paid;
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }

  // Back the freshly-credited $OMR so it can actually be withdrawn. Post-commit by necessity —
  // fundReserve opens its own transaction — which is precisely the gap the Vig's under-funded half
  // exists to catch.
  if (funded > 0) await fundReserve(pool, funded);
  return { startDay, endDay, paid: funded };
}

/// ── §3 THE IN-GAME SURFACE — the player's own protocol position, read from the chain.
///
/// DORMANT until the market is deployed (`CHAIN_RPC_URL` + `ALCHEMIST_ADDRESS`), which is the
/// M6 posture: build the reader, ship it inert, and the day the deployment lands the screen already
/// exists. Returns `{ dormant: true }` rather than throwing, so the tab renders an honest "not open
/// yet" instead of an error — a surface that errors when a feature is merely unbuilt is
/// indistinguishable from one that is broken.
///
/// PURE READ, and that is the second of §3's two hard product rules made structural: **the
/// play-money economy and the protocol stay separate ledgers.** Nothing here writes a
/// `transactions` row, touches in-game cash, or lets one become the other. The only value that
/// crosses between them is §4 above, in one direction, as a purchase.
///
/// The FIRST product rule — never a phrase implying speed or a guaranteed return — is why there is
/// no rate on this object and why `payoffDays` is null until a harvest has actually happened. The
/// design's wording is exact: the projected payoff date is "computed from realised yield and moves
/// with it". With no realised yield there is no honest projection, and inventing one from a
/// nominal rate is the thing the rule forbids.
/// ONE SHAPE, dormant or live. The mirror guard caught the alternative: a dormant object carrying
/// only `{dormant, market}` leaves every field the screen renders missing rather than null, so the
/// card reads `undefined` and the client cannot tell "no position" from "no such field". Both paths
/// return the same keys, so a renderer written against one is correct against the other.
function dormantView(extra = {}) {
  return { dormant: true, market: 'Denari', linked: false, wallet: null,
    collateral: null, debt: null, borrowable: null, ltvBps: null,
    payoffDays: null, liquidation: 'none', ...extra };
}

export async function bankPosition(pool, accountId) {
  // THE SAME env var the watcher, the worker and chainparams already use for this contract. The
  // first cut invented `NUSD_ALCHEMIST_ADDRESS`, and preflight's unclassified-knob guard caught it —
  // which turned out to be the more useful catch: two names for one contract is a deploy where half
  // the code finds the market and half does not, with nothing failing loudly.
  const addr = process.env.ALCHEMIST_ADDRESS;
  if (!process.env.CHAIN_RPC_URL || !addr) return dormantView();
  const { createPublicClient, http, isAddress, getAddress } = await import('viem');
  if (!isAddress(addr)) return dormantView({ note: 'misconfigured address' });

  // The position belongs to the player's PROVEN wallet, never to their account — the protocol has
  // no idea what an account is, and a position keyed on anything but the on-chain address would be
  // this game asserting a fact about a contract it does not control.
  const w = accountId ? (await pool.query(
    'SELECT wallet_address FROM account_persistent WHERE account_id=$1', [accountId])).rows[0] : null;
  const wallet = w?.wallet_address;
  if (!wallet || !isAddress(wallet)) return dormantView({ dormant: false });

  const client = createPublicClient({ transport: http(process.env.CHAIN_RPC_URL) });
  // WRONG-CHAIN GUARD (the makeChainReader discipline): a same-address deploy on another chain would
  // answer confidently and wrongly, and this figure is what a player reads their own debt off.
  if (process.env.CHAIN_ID) {
    try {
      if (Number(process.env.CHAIN_ID) !== Number(await client.getChainId())) {
        return dormantView({ note: 'wrong chain' });
      }
    } catch { return dormantView({ note: 'unreachable' }); }
  }
  const address = getAddress(addr); const user = getAddress(wallet);
  const u256 = (name) => ({ type: 'function', name, stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] });
  const abi = [u256('collateralOf'), u256('debtOf'), u256('maxDebtOf'),
    { type: 'function', name: 'ltvBps', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint16' }] }];
  try {
    const [collateral, debt, maxDebt, ltvBps] = await Promise.all(
      ['collateralOf', 'debtOf', 'maxDebtOf'].map((fn) =>
        client.readContract({ address, abi, functionName: fn, args: [user] }))
        .concat(client.readContract({ address, abi, functionName: 'ltvBps' })));
    return positionView({ wallet: user, collateral, debt, maxDebt, ltvBps });
  } catch { return dormantView({ note: 'unreachable' }); }
}

/// The SHAPING, split out from the I/O — and split out for a reason a mutation found. §3's first
/// product rule (never a phrase implying speed or a guaranteed return) can only be asserted against
/// the object a LIVE position produces, and with the market undeployed every test sees the dormant
/// one. A banned-word scan over `{dormant:true}` passes whatever the live path says, which is a
/// check that cannot fail reading as a clean bill of health. Pure, so the test reaches it directly.
export function positionView({ wallet, collateral, debt, maxDebt, ltvBps }) {
  const n = (x) => Number(x) / 1e18;
  return {
    dormant: false, market: 'Denari', linked: true, wallet,
    collateral: n(collateral), debt: n(debt),
    borrowable: Math.max(0, n(maxDebt) - n(debt)),
    ltvBps: Number(ltvBps),
    // NO PROJECTION WITHOUT REALISED YIELD. The design's wording is exact — the payoff date is
    // "computed from realised yield and moves with it" — so with none there is no honest number,
    // and deriving one from a nominal rate is the thing the rule forbids. This is the rule, not a gap.
    payoffDays: null,
    // The one claim here that is a structural fact rather than a forecast: matching the debt's
    // denomination to the collateral's removes the mechanism, so the debt only ever falls.
    liquidation: 'none',
  };
}

/// The player-facing read. What the leg is, what it paid, and what THIS player earned — never a
/// projection and never a rate, because §3's first product rule is that nothing here may imply a
/// speed or a guaranteed return.
export async function bankBoard(pool, accountId) {
  const p = (await pool.query('SELECT * FROM bank_city_pool WHERE id=1')).rows[0] || {};
  const epochs = (await pool.query(
    'SELECT id, start_day, end_day, pool_omr, players, paid_omr FROM bank_epochs ORDER BY end_day DESC LIMIT 10')).rows;
  const mine = accountId ? (await pool.query(
    `SELECT p.epoch_id, p.score, p.omr, e.end_day FROM bank_payouts p
       JOIN bank_epochs e ON e.id = p.epoch_id
      WHERE p.account_id=$1 ORDER BY e.end_day DESC LIMIT 10`, [accountId])).rows : [];

  // Today's standing so far — the honest version of "am I in the next one", computed from the same
  // functions the distribution uses rather than a second copy of the rules.
  let today = null;
  if (accountId) {
    const day = dayOf();
    const rows = (await pool.query(
      'SELECT tag, n FROM activity_log WHERE account_id=$1 AND day=$2', [accountId, day])).rows;
    const gains = Object.fromEntries(rows.map((r) => [r.tag, Number(r.n)]));
    today = {
      score: activityScore(gains),
      qualifies: activityQualifies(gains),
      minScore: ACTIVITY.MIN_SCORE,
      minTracks: ACTIVITY.MIN_TRACKS,
    };
  }
  return {
    // What the leg IS, in the game's language and with no promise attached.
    what: 'Borrowers pay to use the Bank. That profit buys $OMR on the open market, and it goes to '
        + 'the people who play — pro-rata on what you actually did, with no cap and no cut for '
        + 'holding anything.',
    pool: { balance: round6(num(p.balance)), boughtTotal: round6(num(p.bought_total)), paidTotal: round6(num(p.paid_total)) },
    epochs: epochs.map((e) => ({
      id: e.id, endDay: e.end_day, poolOmr: round6(num(e.pool_omr)),
      players: Number(e.players), paidOmr: round6(num(e.paid_omr)),
    })),
    you: { today, payouts: mine.map((m) => ({ endDay: m.end_day, score: round6(num(m.score)), omr: round6(num(m.omr)) })) },
    tags: ACTIVITY.TAGS,
  };
}

/// THE REAL-VALUE INVARIANT — RULE 1 made checkable, plus the books either side of it.
/// Runs beside the vig/bond/desk/treasury runners in the worker's nightly alertDrift.
export async function runBankInvariants(pool) {
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
  const eps = 1e-6;

  const p = (await pool.query('SELECT * FROM bank_city_pool WHERE id=1')).rows[0] || {};
  const balance = round6(num(p.balance));
  const bought = round6(num(p.bought_total));
  const paidTotal = round6(num(p.paid_total));
  const boughtRows = round6(num((await pool.query('SELECT COALESCE(SUM(omr_bought),0) s FROM bank_buys')).rows[0].s));
  const paidRows = round6(num((await pool.query('SELECT COALESCE(SUM(omr),0) s FROM bank_payouts')).rows[0].s));

  // (1) RULE 1, the wall: never hand out more than was bought. Everything else here is books;
  // this is the one that says no token reached a player without a purchase behind it.
  push('distributed ≤ bought', paidTotal <= bought + eps, { paidTotal, bought });
  // (2) the pool's own books — what is left is what arrived minus what went out
  push('city pool balance exact', Math.abs(balance - (bought - paidTotal)) <= eps, { balance, bought, paidTotal });
  // (3) the summary agrees with the row-level record on BOTH sides. A counter that drifts from its
  // own rows is how a "balanced" pool hides a double credit.
  push('bought == Σ buys', Math.abs(bought - boughtRows) <= eps, { bought, boughtRows });
  push('paid == Σ payouts', Math.abs(paidTotal - paidRows) <= eps, { paidTotal, paidRows });
  // (4) the root cap, per asset: the buy never spends profit that did not arrive.
  const client = await pool.connect();
  let rev, spent;
  try { rev = await revenueByAsset(client); spent = await spentByAsset(client); }
  finally { client.release(); }
  const over = Object.entries(spent).filter(([a, s]) => s > (rev[a] || 0) + eps).map(([a]) => a);
  push('spend ≤ revenue', over.length === 0, { spent, revenue: rev, over });

  const ok = checks.every((c) => c.ok);
  return { ok, checks, summary: { balance, bought, paidTotal } };
}

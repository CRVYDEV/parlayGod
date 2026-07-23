// ═══ THE FLOAT — the full-reserve RWA layer (omerta-rwa-float-design.md) ═══
// The founder-approved R2 redesign. The principle: THE GAME ONLY EVER OWES STOCK IT ALREADY OWNS.
// ETH tax slices (Store 20% + the gameplay-fee FEE_RWA_BPS slice) accumulate in rwa_revenue; a buy
// bot (mainnet: Uniswap TWAP; here a mod-driven param — the runVigBuyback twin) spends ≤ that
// revenue on real tokenized-stock UNITS into rwa_reserve (the float); players burn earned $OMR
// ('rwa:vault', riding the existing rwa:% vocabulary — ZERO invariants.js change) to CLAIM
// allocation from the float at the REAL oracle price. allocated ≤ held per ticker is THE anti-Ponzi
// invariant (the OmertaBond tranche / full-reserve-queue discipline) — in UNITS, so price movement
// can never create a shortfall. The legacy hash-priced book stays the PAPER tier (portfolio.js,
// untouched); the vaulted book is account-level and SURVIVES DEATH (never estate-wiped).
// Out-of-band real value otherwise (the vig/bond/fees precedent): zero §10.4 rows beyond the burn.
import crypto from 'node:crypto';
import { GameError } from './game.js';
import { spendOmr } from './vanity.js';
import { PORTFOLIO, RWA_FLOAT, STORE, tickerOf } from './rules.js';

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const round2 = (n) => Math.round(n * 100) / 100;

// OMR-per-ETH oracle: the latest Vig buyback's TWAP (the plexQuote machinery), PLEX floor pre-market.
async function omrPerEth(db) {
  const last = (await db.query(
    'SELECT price_omr_per_eth FROM vig_buyback ORDER BY created_at DESC LIMIT 1')).rows[0];
  return last ? Number(last.price_omr_per_eth) : STORE.PLEX_FLOOR_OMR_PER_ETH;
}

// ── THE BUY BOT seat (mod-driven until mainnet; the runVigBuyback twin) ──
// Spends UNSPENT rwa_revenue on units at the oracle price. ROOT CAP: eth ≤ revenue − already spent
// (the Vig "spend ≤ inflow" discipline — over → over_budget, never a partial silent clamp).
// txHash marks a REAL on-chain swap (the bonds/store D-MED2 gate); NULL = simulated (QA /
// pre-mainnet — counted against the budget CONSERVATIVELY and flagged real=false so the invariant
// view surfaces the real-vs-simulated gap before R3 extraction can ever ship).
export async function runRwaBuyback(pool, { ticker, eth, priceEth, txHash } = {}) {
  const t = tickerOf(ticker);
  if (!t) throw new GameError('ticker', 'No such stock on the board.');
  const spend = Number(eth), price = Number(priceEth);
  if (!(Number.isFinite(spend) && spend > 0)) throw new GameError('amount', 'eth must be > 0');
  if (!(Number.isFinite(price) && price > 0)) throw new GameError('price', 'priceEth must be > 0 (mainnet: the Uniswap TWAP)');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // serialize concurrent buybacks on the reserve row (materialize first — the world_npcs pattern)
    if (!(await client.query('SELECT 1 FROM rwa_reserve WHERE ticker=$1', [ticker])).rows[0])
      await client.query('INSERT INTO rwa_reserve (ticker) VALUES ($1)', [ticker]);
    const res = (await client.query('SELECT * FROM rwa_reserve WHERE ticker=$1 FOR UPDATE', [ticker])).rows[0];
    const revenue = Number((await client.query('SELECT COALESCE(SUM(rwa_eth),0) s FROM rwa_revenue')).rows[0].s);
    const spent = Number((await client.query('SELECT COALESCE(SUM(eth),0) s FROM rwa_buys')).rows[0].s);
    const budget = round6(revenue - spent);
    if (spend > budget + 1e-9)
      throw new GameError('over_budget', `The float can spend ${budget} ETH — that's what the taxes have brought in.`);
    const units = round6(spend / price);
    await client.query(
      'INSERT INTO rwa_buys (id, ticker, eth, units, price_eth, tx_hash, real) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [crypto.randomUUID(), ticker, spend, units, price, txHash || null, !!txHash]);
    await client.query(
      'UPDATE rwa_reserve SET units=$2, eth_spent=$3, last_price_eth=$4, updated_at=now() WHERE ticker=$1',
      [ticker, round6(Number(res.units) + units), round6(Number(res.eth_spent) + spend), price]);
    await client.query('COMMIT');
    return { ok: true, ticker, units, eth: spend, priceEth: price, real: !!txHash, budgetLeft: round6(budget - spend) };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// ── THE CLAIM — the player rail (withCharacter; char + account rows held) ──
// Burn earned $OMR at the real oracle price to claim units from the float. $OMR is the RATIONING
// TICKET; the ETH taxes were the funding — so the burn is pure deflation and the value received was
// already paid for. Clamps to the float's available units (never an IOU); the reserve row lock
// serializes concurrent claims per ticker (chars → accounts → leaf, canonical). The RICO graduation
// applies exactly as to a paper invest: the SAME cumulative rwa_used window (structuring-proof),
// SCRUTINY_HEAT, the safehouse block (P1.3 — moving big money into legit fronts is an exposed act),
// and the jailed gate. Plus the per-account rolling-24h CLAIM_DAILY_OMR bucket (anti-float-sweep).
export async function claimVaulted(ch, ticker, omr, client, h) {
  const t = tickerOf(ticker);
  if (!t) throw new GameError('ticker', 'No such stock on the board.');
  if (ch.jail_until && new Date(ch.jail_until) > new Date())
    throw new GameError('jailed', "You can't move money into legit fronts from a cell.");
  const amt = Math.floor(Number(omr));
  if (!(Number.isFinite(amt) && amt >= RWA_FLOAT.CLAIM_MIN_OMR))
    throw new GameError('amount', `Claims start at ${RWA_FLOAT.CLAIM_MIN_OMR} $OMR.`);
  // the D3 wash-bucket: a continuous rolling-24h per-ACCOUNT cap (account row is FOR UPDATE'd by
  // withCharacter, so the direct UPDATE below is lock-safe and can't be persist-clobbered — the
  // vault_used/vault_at columns are not in persistAccount's list)
  const refillDaily = h.acct.vault_at
    ? (Date.now() - new Date(h.acct.vault_at).getTime()) / RWA_FLOAT.CLAIM_WINDOW_MS * RWA_FLOAT.CLAIM_DAILY_OMR
    : RWA_FLOAT.CLAIM_DAILY_OMR;
  const dailyUsed = Math.max(0, Number(h.acct.vault_used || 0) - Math.max(0, refillDaily));
  if (dailyUsed + amt > RWA_FLOAT.CLAIM_DAILY_OMR)
    throw new GameError('daily_cap', `The vault takes ${RWA_FLOAT.CLAIM_DAILY_OMR} $OMR a day per house — come back tomorrow.`);
  // the RICO graduation — the invest twin, SHARED window (paper + vaulted structuring counts together)
  const refill = ch.rwa_at
    ? (Date.now() - new Date(ch.rwa_at).getTime()) / PORTFOLIO.SCRUTINY_WINDOW_MS * PORTFOLIO.SCRUTINY_MIN_OMR
    : PORTFOLIO.SCRUTINY_MIN_OMR;
  const windowUsed = Math.max(0, Number(ch.rwa_used || 0) - Math.max(0, refill));
  const cumulative = windowUsed + amt;
  const scrutiny = cumulative >= PORTFOLIO.SCRUTINY_MIN_OMR;
  if (scrutiny && ch.safe_until && new Date(ch.safe_until) > new Date())
    throw new GameError('safe', "You can't move big money into legit fronts while you're to ground.");
  // the float: materialize + lock the reserve row, price at the REAL oracle, clamp to available
  if (!(await client.query('SELECT 1 FROM rwa_reserve WHERE ticker=$1', [ticker])).rows[0])
    await client.query('INSERT INTO rwa_reserve (ticker) VALUES ($1)', [ticker]);
  const res = (await client.query('SELECT * FROM rwa_reserve WHERE ticker=$1 FOR UPDATE', [ticker])).rows[0];
  const priceEth = Number(res.last_price_eth);
  if (!(priceEth > 0) || !(Number(res.units) > 0))
    throw new GameError('float_dry', 'The float holds none of that stock yet — the next buyback fills it.');
  const perEth = await omrPerEth(client);
  const omrPerUnit = round6(priceEth * perEth);
  const allocated = Number((await client.query(
    'SELECT COALESCE(SUM(units),0) s FROM rwa_vault WHERE ticker=$1', [ticker])).rows[0].s);
  const available = round6(Number(res.units) - allocated);
  if (available <= 1e-9)
    throw new GameError('float_dry', 'The float is fully claimed — the next buyback restocks it.');
  const wanted = round6(amt / omrPerUnit);
  const units = Math.min(wanted, available);
  const charge = units < wanted ? Math.max(1, Math.floor(units * omrPerUnit)) : amt; // clamp → pay only for what you got
  await spendOmr(client, h, charge, 'rwa:vault'); // gates h.acct.omr, debits, ledgers the burn (rwa:% — audited vocabulary)
  const cur = (await client.query(
    'SELECT units, cost_omr FROM rwa_vault WHERE account_id=$1 AND ticker=$2', [ch.account_id, ticker])).rows[0];
  const total = round6(Number(cur?.units || 0) + units);
  const cost = Number(cur?.cost_omr || 0) + charge;
  if (cur) await client.query('UPDATE rwa_vault SET units=$3, cost_omr=$4 WHERE account_id=$1 AND ticker=$2',
    [ch.account_id, ticker, total, cost]);
  else await client.query('INSERT INTO rwa_vault (account_id, ticker, units, cost_omr) VALUES ($1,$2,$3,$4)',
    [ch.account_id, ticker, total, cost]);
  await client.query('UPDATE account_persistent SET vault_used=$2, vault_at=now() WHERE account_id=$1',
    [ch.account_id, dailyUsed + charge]);
  ch.rwa_used = windowUsed + charge; ch.rwa_at = new Date(); // the SHARED graduation window (persist carries it)
  if (scrutiny) ch.heat = Math.min(100, Number(ch.heat || 0) + PORTFOLIO.SCRUTINY_HEAT);
  await h.track(client, ch.account_id, 'rwa_vault_claim', { ticker, omr: charge, units });
  return { ok: true, ticker, name: t.name, units, totalUnits: total, spent: charge,
    omrPerUnit, priceEth, clamped: units < wanted, scrutiny };
}

// ── the public board (keyless-safe read; folded into the Going Legit screen) ──
export async function vaultBoard(db, accountId) {
  const perEth = await omrPerEth(db);
  const reserve = (await db.query('SELECT * FROM rwa_reserve ORDER BY ticker')).rows;
  const alloc = {};
  for (const r of (await db.query('SELECT ticker, SUM(units) s FROM rwa_vault GROUP BY ticker')).rows)
    alloc[r.ticker] = Number(r.s);
  const float = PORTFOLIO.TICKERS.map((t) => {
    const r = reserve.find((x) => x.ticker === t.id);
    const held = Number(r?.units || 0), allocated = alloc[t.id] || 0;
    const priceEth = Number(r?.last_price_eth || 0);
    return { ticker: t.id, name: t.name, held: round6(held), allocated: round6(allocated),
      available: round6(Math.max(0, held - allocated)),
      omrPerUnit: priceEth > 0 ? round6(priceEth * perEth) : null };
  });
  const mine = accountId ? (await db.query(
    'SELECT ticker, units, cost_omr FROM rwa_vault WHERE account_id=$1 ORDER BY ticker', [accountId])).rows
    .map((r) => ({ ticker: r.ticker, name: tickerOf(r.ticker)?.name || r.ticker,
      units: round6(Number(r.units)), costOmr: Number(r.cost_omr) })) : [];
  return { float, mine, claimMin: RWA_FLOAT.CLAIM_MIN_OMR, claimDailyOmr: RWA_FLOAT.CLAIM_DAILY_OMR,
    note: 'Backed by tokenized stock the treasury actually holds — the game never owes a unit it does not own. No sell, no cash-out; extraction is a future KYC-gated phase.' };
}

// ── the real-value invariant (the runVigInvariants / runBondInvariants twin) ──
export async function runRwaInvariants(pool) {
  const checks = [];
  const push = (name, lhs, rhs, cmp = 'lte') => checks.push({
    name, lhs: round6(lhs), rhs: round6(rhs),
    ok: cmp === 'lte' ? lhs <= rhs + 1e-6 : Math.abs(lhs - rhs) < 1e-6 });
  const revenue = Number((await pool.query('SELECT COALESCE(SUM(rwa_eth),0) s FROM rwa_revenue')).rows[0].s);
  const spent = Number((await pool.query('SELECT COALESCE(SUM(eth),0) s FROM rwa_buys')).rows[0].s);
  push('rwa spend <= revenue', spent, revenue);
  const reserve = (await pool.query('SELECT * FROM rwa_reserve')).rows;
  const buysByTicker = {};
  for (const b of (await pool.query('SELECT ticker, SUM(units) u, SUM(eth) e FROM rwa_buys GROUP BY ticker')).rows)
    buysByTicker[b.ticker] = { units: Number(b.u), eth: Number(b.e) };
  const allocByTicker = {};
  for (const a of (await pool.query('SELECT ticker, SUM(units) s FROM rwa_vault GROUP BY ticker')).rows)
    allocByTicker[a.ticker] = Number(a.s);
  for (const r of reserve) {
    push(`allocated <= held (${r.ticker})`, allocByTicker[r.ticker] || 0, Number(r.units)); // THE anti-Ponzi check
    push(`held == bought (${r.ticker})`, Number(r.units), buysByTicker[r.ticker]?.units || 0, 'eq');
    push(`cost basis == spent (${r.ticker})`, Number(r.eth_spent), buysByTicker[r.ticker]?.eth || 0, 'eq');
  }
  // real-vs-simulated float: before R3 extraction ships, simulated units must reconcile to the Safe
  const realU = Number((await pool.query('SELECT COALESCE(SUM(units),0) s FROM rwa_buys WHERE real')).rows[0].s);
  const simU = Number((await pool.query('SELECT COALESCE(SUM(units),0) s FROM rwa_buys WHERE NOT real')).rows[0].s);
  return { ok: checks.every((c) => c.ok), checks,
    revenueEth: round6(revenue), spentEth: round6(spent),
    realUnits: round6(realU), simulatedUnits: round6(simU) };
}

// ═══ THE FLOAT — the full-reserve RWA layer (omerta-rwa-float-design.md) ═══
// The founder-approved R2 redesign. The principle: THE GAME ONLY EVER OWES STOCK IT ALREADY OWNS.
// ETH slices accumulate in rwa_revenue from FOUR sources — Store 20%, the gameplay-fee FEE_RWA_BPS
// slice, and (tokenomics v2 step 3) the DEX sell tax's SELL_TAX.RWA_BPS slice + bond ETH's
// BONDS.RWA_BPS slice, the last two being the pair the design turns on: the tax scales with trading
// volume and bonds with primary inflow, and a one-way conversion makes quiet markets the norm — so
// neither alone keeps the float growing. A buy
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
import { BONDS, PORTFOLIO, RWA_FLOAT, SELL_TAX, STORE, tickerOf } from './rules.js';

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const round2 = (n) => Math.round(n * 100) / 100;

// OMR-per-ETH oracle: the latest Vig buyback's TWAP (the plexQuote machinery), PLEX floor pre-market.
async function omrPerEth(db) {
  const last = (await db.query(
    'SELECT price_omr_per_eth FROM vig_buyback ORDER BY created_at DESC LIMIT 1')).rows[0];
  return last ? Number(last.price_omr_per_eth) : STORE.PLEX_FLOOR_OMR_PER_ETH;
}

// ── THE DEX SELL TAX ingest (tokenomics v2 §5/§6, step 3) — the float's SECOND source ──
// One row per taxed episode (a `SellTaxTaken` log on mainnet). The tax is charged in OMR at the pool;
// the bot realizes it as ETH, and that ETH splits three ways (SELL_TAX.DEV/RWA/LP_BPS). Only the RWA
// slice is mirrored into `rwa_revenue` (source='tax') — the bucket the buy bot actually draws on; the
// dev and LP slices are recorded so the episode reconciles and the founder can see where it went.
//
// TWO SOURCES, DELIBERATELY. The tax scales with TRADING VOLUME; bond ETH scales with PRIMARY INFLOW.
// A one-way conversion is designed to produce a quiet market (gameplay no longer makes sellers), so in
// a quiet month the tax yields little and bonds are what keep the float growing. Neither alone is
// enough — that gap is what step 3 closes.
//
// Idempotent on `ref` (txHash:logIndex on-chain). `txHash` marks a REAL episode — the store/bond
// D-MED2 discipline: a mod/QA simulate records the episode but books ZERO revenue, so a comp can
// never fabricate float backing that `runRwaBuyback` would then spend on units it can't cover.
// Out-of-band real value: ZERO §10.4 rows. DORMANT until step 4 arms the contract's three-way split.
export async function recordSellTax(pool, { ref, omrTaxed, priceOmrPerEth, txHash = null } = {}) {
  const key = String(ref ?? '').trim();
  if (!key) throw new GameError('ref', 'A tax episode needs a ref (txHash:logIndex).');
  const omr = Number(omrTaxed), price = Number(priceOmrPerEth);
  if (!(Number.isFinite(omr) && omr > 0)) throw new GameError('amount', 'omrTaxed must be > 0');
  if (!(Number.isFinite(price) && price > 0)) throw new GameError('price', 'priceOmrPerEth must be > 0 (mainnet: the TWAP the bot realized).');
  const real = !!txHash;
  const gross = round6(omr / price);
  // the remainder rule sits on the LP slice so the three always sum to gross with no rounding dust
  const devEth = real ? round6(gross * SELL_TAX.DEV_BPS / SELL_TAX.BPS) : 0;
  const rwaEth = real ? round6(gross * SELL_TAX.RWA_BPS / SELL_TAX.BPS) : 0;
  const lpEth = real ? round6(gross - devEth - rwaEth) : 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if ((await client.query('SELECT 1 FROM sell_tax_events WHERE ref=$1', [key])).rows[0]) {
      await client.query('COMMIT');
      return { recorded: false, duplicate: true }; // a re-delivered log is a clean no-op
    }
    await client.query(
      'INSERT INTO sell_tax_events (ref, omr_taxed, price_omr_per_eth, gross_eth, dev_eth, rwa_eth, lp_eth, tx_hash, real) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [key, round6(omr), price, gross, devEth, rwaEth, lpEth, txHash, real]);
    if (real && rwaEth > 0)
      await client.query("INSERT INTO rwa_revenue (source, ref, rwa_eth) VALUES ('tax',$1,$2)", [key, rwaEth]);
    await client.query('COMMIT');
    return { recorded: true, grossEth: gross, devEth, rwaEth, lpEth, real };
  } catch (e) {
    await client.query('ROLLBACK');
    // a concurrent re-delivery of the same log (23505) is the duplicate case, not an error
    if (e?.code === '23505') return { recorded: false, duplicate: true };
    throw e;
  } finally { client.release(); }
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
    // AUDIT F2: the BUDGET is global but the row lock is per-ticker — two concurrent buys on
    // DIFFERENT tickers could each read the full unspent budget and together overspend revenue.
    // A txn-scoped advisory lock serializes the budget read across tickers (the runWageEpoch
    // precedent; auto-released at COMMIT/ROLLBACK; real Postgres only — pg-mem is single-caller).
    if (process.env.DATABASE_URL) await client.query('SELECT pg_advisory_xact_lock($1)', [0x52574146]); // 'RWAF'
    // serialize concurrent buybacks on the reserve row (materialize first — the world_npcs pattern)
    if (!(await client.query('SELECT 1 FROM rwa_reserve WHERE ticker=$1', [ticker])).rows[0])
      await client.query('INSERT INTO rwa_reserve (ticker) VALUES ($1)', [ticker]);
    const res = (await client.query('SELECT * FROM rwa_reserve WHERE ticker=$1 FOR UPDATE', [ticker])).rows[0];
    // AUDIT F3: price CONTINUITY — a typo'd/dust buy would reprice the WHOLE existing float (claims
    // read last_price_eth), so once a ticker has a reference price, bound each subsequent buy to a
    // generous factor of it (the runVigBuyback VIG_MAX_PRICE_JUMP precedent — a fat-finger/fraud
    // sanity bound on the mod/bot parameter, not a balance lever; a real TWAP never trips 10×).
    const jump = Number(process.env.RWA_MAX_PRICE_JUMP) || 10;
    const lastPrice = Number(res.last_price_eth || 0);
    if (lastPrice > 0 && (price > lastPrice * jump || price < lastPrice / jump))
      throw new GameError('price_sanity', `Buy price ${price} is more than ${jump}× off the last (${lastPrice}) — refusing (set RWA_MAX_PRICE_JUMP to override).`);
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
  } catch (e) {
    await client.query('ROLLBACK');
    // a two-first-touch INSERT race on a fresh ticker (23505) / a lock cycle (40P01) surfaces as a
    // clean retryable error, not a raw 500 (the world_npcs/auction F1 posture; mod/bot-seat only)
    if (e?.code === '23505' || e?.code === '40P01')
      throw new GameError('contention', 'The float was busy — try the buy again.');
    throw e;
  }
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
  // MINTED-ONLY (AUDIT-rwa-float #2, recommended): claiming from the float is the on-ramp to the one
  // KYC-gated extraction the whole design is built around, so every claiming identity pays the
  // 0.01-ETH mint fee first — the Street Wage D1 precedent. Two reasons, both load-bearing:
  // (1) Sybil — the per-account daily cap is only a real bound if an account costs something;
  // (2) R3 dead allocation — nothing ever decrements `rwa_vault`, so units claimed by alts that will
  //     never KYC permanently shrink the claimable float. Free-trial players still play and earn
  //     everything else; minting was already the gate on every other extraction path.
  if (!h.acct.minted)
    throw new GameError('mint', 'The float only opens to a made man — mint your character first.');
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
  // AUDIT F3 (the omrPerUnit→0 edge): a degenerate price must NEVER reach the allocation math —
  // wanted would go Infinite and the whole float could be swept for the Math.max(1,…) floor charge
  if (!(omrPerUnit > 0))
    throw new GameError('float_dry', 'The float has no sane price yet — the next buyback sets it.');
  const allocated = Number((await client.query(
    'SELECT COALESCE(SUM(units),0) s FROM rwa_vault WHERE ticker=$1', [ticker])).rows[0].s);
  const available = round6(Number(res.units) - allocated);
  if (available <= 1e-9)
    throw new GameError('float_dry', 'The float is fully claimed — the next buyback restocks it.');
  const wanted = round6(amt / omrPerUnit);
  const units = Math.min(wanted, available);
  // AUDIT B-F1 (the zero-unit burn): at an extreme unit price, round6 can floor `wanted` to 0 —
  // then units == wanted == 0, the clamp branch doesn't fire, and the FULL amt would burn for
  // nothing. A claim that yields no units is refused BEFORE any $OMR moves.
  if (!(units > 0))
    throw new GameError('amount', `A unit runs ${omrPerUnit} $OMR — that ask buys none of it.`);
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
  // WHERE THE FLOAT'S MONEY COMES FROM (v2 §6) — published, because "backed" is a claim and a player
  // is entitled to see what is behind it. Two sources by design: the DEX sell tax scales with trading
  // volume, bond ETH with primary inflow, and a one-way conversion makes quiet markets the norm.
  const bySource = {};
  for (const s of (await db.query('SELECT source, SUM(rwa_eth) s FROM rwa_revenue GROUP BY source')).rows)
    bySource[s.source] = round6(Number(s.s));
  const spent = Number((await db.query('SELECT COALESCE(SUM(eth),0) s FROM rwa_buys')).rows[0].s);
  const revenue = Object.values(bySource).reduce((a, b) => a + b, 0);
  return { float, mine, claimMin: RWA_FLOAT.CLAIM_MIN_OMR, claimDailyOmr: RWA_FLOAT.CLAIM_DAILY_OMR,
    funding: { bySource, revenueEth: round6(revenue), spentEth: round6(spent), unspentEth: round6(Math.max(0, revenue - spent)),
      sellTaxBps: SELL_TAX.RWA_BPS, bondBps: BONDS.RWA_BPS },
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
  // v2 step 3: the DEX-tax episodes must reconcile — each episode's three slices sum to its gross,
  // and the RWA slice reached rwa_revenue (the bucket the buy bot draws on). A silent mismatch here
  // would mean the float is funded by more or less than the tax actually took.
  const tax = (await pool.query(
    'SELECT COALESCE(SUM(gross_eth),0) g, COALESCE(SUM(dev_eth),0) d, COALESCE(SUM(rwa_eth),0) r, COALESCE(SUM(lp_eth),0) l FROM sell_tax_events WHERE real')).rows[0];
  const taxGross = Number(tax.g), taxSlices = Number(tax.d) + Number(tax.r) + Number(tax.l);
  const taxMirror = Number((await pool.query("SELECT COALESCE(SUM(rwa_eth),0) s FROM rwa_revenue WHERE source='tax'")).rows[0].s);
  push('sell-tax split == gross', taxSlices, taxGross, 'eq');
  push('sell-tax RWA slice == rwa_revenue', Number(tax.r), taxMirror, 'eq');
  // where the float's money came from — the founder's view of the two sources (§6's whole point)
  const bySource = {};
  for (const s of (await pool.query('SELECT source, SUM(rwa_eth) s FROM rwa_revenue GROUP BY source')).rows)
    bySource[s.source] = round6(Number(s.s));
  // real-vs-simulated float: before R3 extraction ships, simulated units must reconcile to the Safe
  const realU = Number((await pool.query('SELECT COALESCE(SUM(units),0) s FROM rwa_buys WHERE real')).rows[0].s);
  const simU = Number((await pool.query('SELECT COALESCE(SUM(units),0) s FROM rwa_buys WHERE NOT real')).rows[0].s);
  return { ok: checks.every((c) => c.ok), checks,
    revenueEth: round6(revenue), spentEth: round6(spent), revenueBySource: bySource,
    realUnits: round6(realU), simulatedUnits: round6(simU) };
}

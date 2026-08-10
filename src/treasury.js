// ═══ THE TREASURY — the ETH vault, and (since 2026-08-10) the stock reserve beside it ═══
// This file was `rwa.js`, THE FLOAT: ETH slices accumulated, a bot bought real tokenized stock, and
// players burned earned $OMR to claim allocation from it. The founder retired the STOCK half on
// 2026-07-31 and directed that **the vault stays and is BACKED WITH ETH** instead — then REOPENED
// stock acquisition on 2026-08-10 (`omerta-brokers-design.md`) to fund a play-weighted distribution
// to NFT holders. Both halves now live here, and the distinction between them is the whole file:
//
//   THE VAULT is the PLAYER rail — burn $OMR, get an ETH allocation. It is ETH on both sides and
//   stays that way; a player's claim is never denominated in stock, so the game is never in the
//   position of owing a claim in one asset while holding another.
//   THE STOCK RESERVE is a separate obligation to NFT holders, in units, with its own per-ticker
//   wall. It touches the vault at exactly one point — the ETH it spends is ETH the vault can no
//   longer promise — and that point is `heldAndAllocated`'s spend term.
//
// WHY THAT IS THE STRONG VERSION, NOT THE WEAK ONE. The float rested on `allocated <= held`: the
// game only ever owes what it already holds, and price movement can never create a shortfall. That
// property works ONLY while both sides of the ledger are the SAME asset. Backing a STOCK-denominated
// claim with ETH would have broken it twice over — legally it turns handing over an asset you own
// into a cash-settled payout on one you do not, and mechanically the treasury goes short exactly when
// players claim. Denominating BOTH SIDES in ETH restores the original wall EXACTLY: the game only
// ever owes ETH it already holds, and there is no second asset to diverge from.
//
// WHAT THE RETIREMENT DELETED, AND WHAT THE REOPENING BRINGS BACK. The retirement removed the buy
// bot, the per-ticker reserve, the stock oracle and the price-continuity bound — and with them the
// only securities event in the project. The 2026-08-10 reversal brings back the reserve and the wall
// (below), and the keeper (design step 5) with them; `rwa_reserve`/`rwa_buys` stayed gone, because
// the new tables are `stock_buys`/`stock_allocations` and HELD-in-ETH is still just the inflow
// ledger. The securities question came back too, and §6 of the brokers design is where it is
// recorded rather than here.
//
// WHAT IT IS, PRECISELY. An ALLOCATION ledger, exactly as the float was: a claim moves ETH from the
// treasury's unallocated pool into the player's account-level line. **Nothing here delivers ETH to a
// player** — no transfer, no withdrawal, no on-chain path. Delivery is a separate decision with its
// own legal question, and it is deliberately unbuilt (R3 was the same shape).
//
// The four slices keep their bps and their sources (Store 20% / gameplay fees FEE_TREASURY_BPS / the
// DEX sell tax's SELL_TAX.RWA_BPS / bond ETH's BONDS.RWA_BPS). The table is still named
// `rwa_revenue`: renaming it is migration risk for no benefit, and it is the treasury's inflow ledger.
//
// Out-of-band real value: ZERO §10.4 rows beyond the `rwa:vault` $OMR burn, which rides the existing
// `rwa:%` vocabulary (so invariants.js needs no change). R1 — the Portfolio (`portfolio.js`) — is
// UNTOUCHED: it was always pure in-game status with a deterministic §7.11 hash price, no sell and no
// cash-out, and it stays exactly that.
import crypto from 'node:crypto';
import { GameError } from './game.js';
import { spendOmr } from './vanity.js';
import { BONDS, PORTFOLIO, SELL_TAX, TREASURY, jailed, safeHoused } from './rules.js';

const round6 = (n) => Math.round(n * 1e6) / 1e6;

// ── THE PRICE (the only oracle on the path) ──
// The claim is ETH-for-$OMR, so there is exactly one price: OMR per ETH, from the latest Vig buyback
// (mainnet: the DEX TWAP). There is no second, externally-quoted asset price to manipulate — that
// whole surface went with the stock.
//
// FAIL-CLOSED, because this price now moves REAL ETH out of the treasury's unallocated pool. A stale
// or absent price is a free option: claim at yesterday's rate and keep the difference. So:
//   - no print, or a print older than ORACLE_MAX_AGE_MS  →  the vault REFUSES. It does NOT fall back
//     to `STORE.PLEX_FLOOR_OMR_PER_ETH`. That floor is fine for quoting a fixed-price SKU pre-market;
//     using it to price a claim on real ETH would mean "we don't know what ETH costs" resolves to
//     "sell it at the default", which is the whole hole.
//   - the price a claimer pays carries CLAIM_PREMIUM_BPS over spot. The vault is not a market maker;
//     handing ETH out at exactly the market price makes every claim a risk-free skim on whichever
//     side the oracle happens to lag.
// `stale` is returned rather than thrown so the BOARD can render an honest "closed" state while the
// CLAIM refuses — one source of truth for both.
async function ethPrice(db) {
  const last = (await db.query(
    'SELECT price_omr_per_eth, created_at FROM vig_buyback ORDER BY created_at DESC LIMIT 1')).rows[0];
  if (!last) return { spot: null, price: null, stale: true, reason: 'no_price' };
  const spot = Number(last.price_omr_per_eth);
  const ageMs = Date.now() - new Date(last.created_at).getTime();
  if (!(spot > 0)) return { spot: null, price: null, stale: true, reason: 'no_price' };
  if (ageMs > TREASURY.ORACLE_MAX_AGE_MS) return { spot, price: null, stale: true, reason: 'stale_price', ageMs };
  return { spot, price: round6(spot * (1 + TREASURY.CLAIM_PREMIUM_BPS / 10000)), stale: false, ageMs };
}

// what the treasury HOLDS, and what it has already promised. Both in ETH — that sameness is the wall.
//
// THE SPEND TERM IS NOT OPTIONAL, and it is the one thing the brokers design would have broken
// silently. Once the buy keeper converts treasury ETH into stock, the Safe holds LESS ETH — but
// `rwa_revenue` is an INFLOW ledger and records nothing about it. Leave the term out and the vault
// keeps quoting ETH that has already been spent, so a player can be allocated ETH the treasury no
// longer has, with `allocated <= held` reading green the whole time. Subtracting it here fixes the
// claim path, the board and the invariant together, because all three read this one function.
async function heldAndAllocated(db) {
  const held = Number((await db.query('SELECT COALESCE(SUM(rwa_eth),0) s FROM rwa_revenue')).rows[0].s);
  const allocated = Number((await db.query('SELECT COALESCE(SUM(eth),0) s FROM eth_vault')).rows[0].s);
  const spent = Number((await db.query('SELECT COALESCE(SUM(eth_spent),0) s FROM stock_buys WHERE real')).rows[0].s);
  return { held: round6(held), allocated: round6(allocated), spentOnStock: round6(spent),
    available: round6(Math.max(0, held - allocated - spent)) };
}

// ── THE STOCK RESERVE — per-ticker units, held vs owed (brokers §3.2 wall 1) ──
// Two flat queries and a join in JS, not a correlated subquery: pg-mem parses neither that nor
// `= ANY($1::text[])` (the /v1/gangs and MY PROFILE lessons, learned repeatedly).
async function stockPerTicker(db) {
  const byTicker = new Map();
  const at = (t) => {
    if (!byTicker.has(t)) byTicker.set(t, { ticker: t, held: 0, allocated: 0 });
    return byTicker.get(t);
  };
  for (const r of (await db.query('SELECT ticker, SUM(units) u FROM stock_buys WHERE real GROUP BY ticker')).rows)
    at(r.ticker).held = round6(Number(r.u));
  for (const r of (await db.query('SELECT ticker, SUM(units) u FROM stock_allocations GROUP BY ticker')).rows)
    at(r.ticker).allocated = round6(Number(r.u));
  for (const t of byTicker.values()) t.available = round6(Math.max(0, t.held - t.allocated));
  return [...byTicker.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/// What the buy keeper (step 5) may spend, and the reason it is a read rather than a promise.
///
/// The `runVigBuyback` root cap, applied to the treasury: ETH that has ALREADY been promised to a
/// player's vault line is not the keeper's to spend. Publishing this as a function means step 5 reads
/// the same number the invariant checks, instead of re-deriving a looser one from `held` alone.
export async function stockBudget(db) {
  const { held, allocated, spentOnStock, available } = await heldAndAllocated(db);
  return { heldEth: held, allocatedEth: allocated, spentEth: spentOnStock, spendableEth: available };
}

/// Record an acquisition. Faithful, idempotent, and deliberately WITHOUT a budget gate.
///
/// A fill that happened on-chain must be recorded whatever it cost — refusing it would make the books
/// disagree with the chain and stall the sync cursor (the `recordBond` lesson: the event is
/// authoritative, and an overspend is something the INVARIANT should scream about, not something the
/// ingest should hide by dropping the row). The budget lives in `stockBudget`, which is the keeper's
/// job to respect; `eth spent <= eth available to spend` in `runTreasuryInvariants` is what catches it
/// if the keeper ever does not.
export async function recordStockBuy(pool, { ref, ticker, units, ethSpent, txHash = null } = {}) {
  const key = String(ref || '').trim();
  const tk = String(ticker || '').trim().toUpperCase();
  if (!key) throw new GameError('ref', 'A fill needs a ref (txHash:logIndex).');
  if (!tk) throw new GameError('ticker', 'A fill needs a ticker.');
  const u = Number(units);
  const eth = Number(ethSpent);
  if (!(Number.isFinite(u) && u > 0)) throw new GameError('amount', 'units must be > 0');
  if (!(Number.isFinite(eth) && eth > 0)) throw new GameError('amount', 'ethSpent must be > 0');
  const real = !!txHash;
  // A COMP BOOKS ZERO — both sides, not just the spend. Units are the ceiling on what may ever be
  // delivered, so a QA path that booked them would raise that ceiling with no asset behind it, and
  // `allocated <= held` would happily wave the delivery through. This is the sharpest instance of the
  // anti-fabrication gate in the project, because here the fabricated quantity IS the wall's input.
  const bookedUnits = real ? round6(u) : 0;
  const bookedEth = real ? round6(eth) : 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // SELECT-then-INSERT, not ON CONFLICT DO NOTHING + rowCount — pg-mem misreports the suppressed
    // conflict, so the tidier idiom silently books every duplicate as fresh (see recordSellTax).
    if ((await client.query('SELECT 1 FROM stock_buys WHERE ref=$1', [key])).rows[0]) {
      await client.query('COMMIT');
      return { recorded: false, duplicate: true };
    }
    await client.query(
      'INSERT INTO stock_buys (ref, ticker, units, eth_spent, price_eth_per_unit, tx_hash, real) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [key, tk, bookedUnits, bookedEth, round6(eth / u), txHash, real]);
    await client.query('COMMIT');
    return { recorded: true, ticker: tk, units: bookedUnits, ethSpent: bookedEth, real };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e?.code === '23505') return { recorded: false, duplicate: true };
    throw e;
  } finally { client.release(); }
}

/// Promise units out. THE ONLY writer of the owed side, and it refuses past what is held.
///
/// The invariant is the DETECTOR; this is the PREVENTION, and both are needed. A nightly check that
/// notices an over-allocation after the fact is worth having, but with §3.3's no-gate delivery the
/// over-allocated units would already be on their way into a freely-trading token-bound account by
/// the time it fired. So the wall is enforced where the promise is made.
///
/// Clamps rather than throws when the reserve is thin: an epoch that can only be part-funded should
/// pay what exists and record that it was short, not fail wholesale and pay nobody.
export async function allocateStock(client, { epochId, accountId, ticker, units }) {
  const tk = String(ticker || '').trim().toUpperCase();
  const want = Number(units);
  if (!(Number.isFinite(want) && want > 0)) throw new GameError('amount', 'units must be > 0');
  // Serialize competing allocations against the same reserve. Txn-scoped; real Postgres only, as with
  // the ETH pool lock — pg-mem is single-caller, so the suite exercises the arithmetic and Postgres
  // exercises the serialization.
  if (process.env.DATABASE_URL) await client.query('SELECT pg_advisory_xact_lock($1)', [0x53544b00]); // 'STK'
  const held = Number((await client.query(
    'SELECT COALESCE(SUM(units),0) u FROM stock_buys WHERE real AND ticker=$1', [tk])).rows[0].u);
  const owed = Number((await client.query(
    'SELECT COALESCE(SUM(units),0) u FROM stock_allocations WHERE ticker=$1', [tk])).rows[0].u);
  const free = round6(Math.max(0, held - owed));
  const give = round6(Math.min(want, free));
  if (!(give > 0)) return { units: 0, clamped: true, available: free };
  const upd = await client.query(
    'UPDATE stock_allocations SET units = units + $4 WHERE epoch_id=$1 AND account_id=$2 AND ticker=$3',
    [epochId, accountId, tk, give]);
  if (!upd.rowCount) {
    await client.query(
      'INSERT INTO stock_allocations (epoch_id, account_id, ticker, units) VALUES ($1,$2,$3,$4)',
      [epochId, accountId, tk, give]);
  }
  return { units: give, clamped: give < want, available: round6(free - give) };
}

// ── THE DEX SELL TAX ingest (tokenomics v2 §5/§6) ──
// One row per taxed episode (a `SellTaxTaken` log on mainnet). The tax is charged in OMR at the pool;
// the bot realizes it as ETH, and that ETH splits three ways (SELL_TAX.DEV/RWA/LP_BPS). The RWA slice
// — now the TREASURY slice — is mirrored into `rwa_revenue` (source='tax'); the dev and LP slices are
// recorded so the episode reconciles and the founder can see where it went.
//
// Idempotent on `ref` (txHash:logIndex on-chain). `txHash` marks a REAL episode — the store/bond
// D-MED2 discipline: a mod/QA simulate records the episode but books ZERO revenue. That gate mattered
// more when fabricated revenue could buy real-looking units; it is kept because "the treasury received
// this much ETH" should never be assertable by a QA call either.
export async function recordSellTax(pool, { ref, omrTaxed, priceOmrPerEth, txHash = null } = {}) {
  const key = String(ref || '').trim();
  if (!key) throw new GameError('ref', 'A tax episode needs a ref (txHash:logIndex).');
  const omr = Number(omrTaxed);
  const price = Number(priceOmrPerEth);
  if (!(Number.isFinite(omr) && omr > 0)) throw new GameError('amount', 'omrTaxed must be > 0');
  if (!(Number.isFinite(price) && price > 0)) throw new GameError('price', 'priceOmrPerEth must be > 0 (mainnet: the TWAP the bot realized).');
  const real = !!txHash;
  const grossEth = round6(omr / price);
  // the REMAINDER rule sits on the LP slice so the three shares sum to the gross EXACTLY (two of
  // three round down; a "natural" third division strands wei belonging to nobody).
  // A SIMULATE books ZERO across all three slices, not just zero revenue: the episode is recorded
  // for QA, but a comp must never be able to assert the treasury (or the dev wallet, or LP) received
  // ETH that never moved. Preserved verbatim from the float's ingest — it is the anti-fabrication
  // gate, and it is the reason a mod route cannot manufacture a real-value position.
  const devEth = real ? round6(grossEth * SELL_TAX.DEV_BPS / SELL_TAX.BPS) : 0;
  const rwaEth = real ? round6(grossEth * SELL_TAX.RWA_BPS / SELL_TAX.BPS) : 0;
  const lpEth = real ? round6(grossEth - devEth - rwaEth) : 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // SELECT-then-INSERT, not `ON CONFLICT DO NOTHING` + rowCount: pg-mem does not report the
    // rowCount of a suppressed conflict, so the tidier idiom silently reports every duplicate as a
    // fresh booking. (Learned the hard way porting this file — do not "improve" it back.)
    if ((await client.query('SELECT 1 FROM sell_tax_events WHERE ref=$1', [key])).rows[0]) {
      await client.query('COMMIT');
      return { recorded: false, duplicate: true }; // a re-delivered log is a clean no-op
    }
    await client.query(
      'INSERT INTO sell_tax_events (ref, omr_taxed, price_omr_per_eth, gross_eth, dev_eth, rwa_eth, lp_eth, tx_hash, real) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [key, round6(omr), price, grossEth, devEth, rwaEth, lpEth, txHash, real]);
    if (real && rwaEth > 0)
      await client.query("INSERT INTO rwa_revenue (source, ref, rwa_eth) VALUES ('tax',$1,$2)", [key, rwaEth]);
    await client.query('COMMIT');
    return { recorded: true, grossEth, devEth, rwaEth, lpEth, real };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    // a concurrent re-delivery of the same log (23505) is the duplicate case, not an error
    if (e?.code === '23505') return { recorded: false, duplicate: true };
    throw e;
  } finally { client.release(); }
}

// ── the ops board: what the treasury holds, what it owes, and where the ETH came from ──
// Public-safe (no per-account anything); mounted mod-gated. The PLAYER-facing view is vaultBoard.
export async function treasuryStatus(pool) {
  const bySource = {};
  for (const s of (await pool.query('SELECT source, SUM(rwa_eth) s FROM rwa_revenue GROUP BY source')).rows)
    bySource[s.source] = round6(Number(s.s));
  const { held, allocated, spentOnStock, available } = await heldAndAllocated(pool);
  const stock = await stockPerTicker(pool);
  // THE ATTESTATION LINE. The ledger can prove the vault never OWES more than the books say arrived;
  // it cannot prove the treasury Safe still HOLDS it — that is a wallet a human controls, and ETH
  // spent out of it does not write a row here. So the ops view states the obligation plainly:
  // `safeMustHold` is the floor the real Safe balance has to clear for the vault to be honest, and
  // reconciling it is a standing operational duty (CHAIN-DEPLOY). Publishing the number is what makes
  // "backed" checkable rather than asserted.
  //   It is now TWO obligations in two denominations, and both have to be reconciled: the Safe must
  // hold `safeMustHold` ETH **and** `safeMustHoldUnits` of each ticker. Stating only the ETH figure
  // after the stock layer returned would understate what is owed by exactly the thing that made the
  // wall load-bearing.
  return { holds: 'eth+stock', totalEth: held, allocatedEth: allocated, spentOnStockEth: spentOnStock,
    availableEth: available, safeMustHold: allocated, bySource,
    stock, safeMustHoldUnits: Object.fromEntries(stock.map((s) => [s.ticker, s.allocated])) };
}

// ── THE CLAIM — the player rail (withCharacter; char + account rows held) ──
// Burn earned $OMR to claim ETH out of what the treasury actually holds. $OMR is the RATIONING
// TICKET; the four ETH slices were the funding — so the burn is pure deflation and the ETH allocated
// was already paid for by real revenue. Clamps to what is unallocated (never an IOU).
//
// THE WALL: `allocated <= held`, in ETH on both sides. A claim can only ever move ETH from the
// unallocated pool into a player's line, so the treasury can never owe more than it holds, whatever
// the price of anything does. That is the same invariant the stock float had, made unbreakable by
// removing the second asset.
//
// NOT A PAYOUT: this allocates; it does not deliver. No ETH leaves the treasury here and there is no
// route that makes it. Delivery is its own decision and is deliberately unbuilt.
//
// The gates are the float's, unchanged: minted-only (a claiming identity costs the 0.01-ETH mint fee,
// so the per-account daily cap is a real bound and dead allocation by throwaway alts is priced), the
// jailed gate, the per-account rolling-24h CLAIM_DAILY_OMR bucket, and the RICO graduation on the
// SAME cumulative rwa_used window as a paper invest (structuring-proof across both books) with its
// SCRUTINY_HEAT and safehouse block.
export async function claimVaulted(ch, omr, client, h) {
  if (jailed(ch))
    throw new GameError('jailed', "You can't move money into the vault from a cell.");
  if (!h.acct.minted)
    throw new GameError('mint', 'The vault only opens to a made man — mint your character first.');
  const amt = Math.floor(Number(omr));
  if (!(Number.isFinite(amt) && amt >= TREASURY.CLAIM_MIN_OMR))
    throw new GameError('amount', `Claims start at ${TREASURY.CLAIM_MIN_OMR} $OMR.`);
  // the D3 wash-bucket: a continuous rolling-24h per-ACCOUNT cap. The account row is FOR UPDATE'd by
  // withCharacter, so the direct UPDATE below is lock-safe; vault_used/vault_at are not in
  // persistAccount's positional list, so they cannot be clobbered.
  const refillDaily = h.acct.vault_at
    ? (Date.now() - new Date(h.acct.vault_at).getTime()) / TREASURY.CLAIM_WINDOW_MS * TREASURY.CLAIM_DAILY_OMR
    : TREASURY.CLAIM_DAILY_OMR;
  const dailyUsed = Math.max(0, Number(h.acct.vault_used || 0) - Math.max(0, refillDaily));
  if (dailyUsed + amt > TREASURY.CLAIM_DAILY_OMR)
    throw new GameError('daily_cap', `The vault takes ${TREASURY.CLAIM_DAILY_OMR} $OMR a day per house — come back tomorrow.`);
  // the RICO graduation — the invest twin, SHARED window (paper + vaulted structuring counts together)
  const refill = ch.rwa_at
    ? (Date.now() - new Date(ch.rwa_at).getTime()) / PORTFOLIO.SCRUTINY_WINDOW_MS * PORTFOLIO.SCRUTINY_MIN_OMR
    : PORTFOLIO.SCRUTINY_MIN_OMR;
  const windowUsed = Math.max(0, Number(ch.rwa_used || 0) - Math.max(0, refill));
  const scrutiny = windowUsed + amt >= PORTFOLIO.SCRUTINY_MIN_OMR;
  if (scrutiny && safeHoused(ch))
    throw new GameError('safe', "You can't move big money into the vault while you're to ground.");
  // LOCK THE POOL. There is no reserve row to lock now, so the serialization point is the claimer's
  // own line plus an advisory lock over the shared pool: two claims must not both read the same
  // `available` and together allocate past `held` (the buy bot's F2 cross-ticker race, in the one
  // place it still exists). Txn-scoped, released at COMMIT/ROLLBACK; real Postgres only — pg-mem is
  // single-caller, so the suite exercises the arithmetic and Postgres exercises the serialization.
  if (process.env.DATABASE_URL) await client.query('SELECT pg_advisory_xact_lock($1)', [0x45544856]); // 'ETHV'
  const { available } = await heldAndAllocated(client);
  if (available <= 1e-9)
    throw new GameError('vault_dry', 'The vault is fully claimed — the next revenue refills it.');
  const { price: perEth, stale, reason } = await ethPrice(client);
  if (stale) throw new GameError(reason === 'stale_price' ? 'stale_price' : 'no_price',
    reason === 'stale_price'
      ? 'The vault is closed — the ETH price is stale, and it will not guess one.'
      : 'The vault is closed — no ETH price has printed yet, and it will not guess one.');
  const wanted = round6(amt / perEth);
  const eth = Math.min(wanted, available);
  // a claim that yields nothing is refused BEFORE any $OMR moves (the float's B-F1 zero-unit burn)
  if (!(eth > 0))
    throw new GameError('amount', `ETH runs ${perEth} $OMR — that ask buys none of it.`);
  const charge = eth < wanted ? Math.max(1, Math.floor(eth * perEth)) : amt; // clamp → pay only for what you got
  await spendOmr(client, h, charge, 'rwa:vault'); // gates balance, debits, ledgers the burn (rwa:% — audited vocabulary)
  const cur = (await client.query('SELECT eth, cost_omr FROM eth_vault WHERE account_id=$1', [ch.account_id])).rows[0];
  const total = round6(Number(cur?.eth || 0) + eth);
  const cost = Number(cur?.cost_omr || 0) + charge;
  if (cur) await client.query('UPDATE eth_vault SET eth=$2, cost_omr=$3, updated_at=now() WHERE account_id=$1',
    [ch.account_id, total, cost]);
  else await client.query('INSERT INTO eth_vault (account_id, eth, cost_omr) VALUES ($1,$2,$3)',
    [ch.account_id, total, cost]);
  await client.query('UPDATE account_persistent SET vault_used=$2, vault_at=now() WHERE account_id=$1',
    [ch.account_id, dailyUsed + charge]);
  ch.rwa_used = windowUsed + charge; ch.rwa_at = new Date(); // the SHARED graduation window (persist carries it)
  if (scrutiny) ch.heat = Math.min(100, Number(ch.heat || 0) + PORTFOLIO.SCRUTINY_HEAT);
  await h.track(client, ch.account_id, 'eth_vault_claim', { omr: charge, eth });
  return { ok: true, eth, totalEth: total, spent: charge, omrPerEth: perEth,
    clamped: eth < wanted, scrutiny };
}

// ── the public board (keyless-safe read; folded into the Going Legit screen) ──
export async function vaultBoard(db, accountId) {
  const { held, allocated, spentOnStock, available } = await heldAndAllocated(db);
  // WHERE THE VAULT'S MONEY COMES FROM — published, because "backed" is a claim and a player is
  // entitled to check it. Two of the four matter at scale and are deliberately different: the DEX
  // sell tax scales with TRADING VOLUME, bond ETH with PRIMARY INFLOW, and a one-way conversion makes
  // quiet markets the norm — so neither alone would keep the vault growing.
  const bySource = {};
  for (const s of (await db.query('SELECT source, SUM(rwa_eth) s FROM rwa_revenue GROUP BY source')).rows)
    bySource[s.source] = round6(Number(s.s));
  const mine = accountId
    ? (await db.query('SELECT eth, cost_omr FROM eth_vault WHERE account_id=$1', [accountId])).rows[0]
    : null;
  const px = await ethPrice(db);
  return {
    heldEth: held, allocatedEth: allocated, availableEth: available,
    // published because it is the honest reason `available` can fall without anybody claiming: the
    // treasury converted ETH into stock. A player watching the number drop deserves the cause.
    spentOnStockEth: spentOnStock,
    // what a claim COSTS (spot + the premium), and whether the vault is open at all. Both come from
    // the same read the claim uses, so the board can never advertise a price the claim would refuse.
    omrPerEth: px.price, spotOmrPerEth: px.spot, priceStale: px.stale,
    open: !px.stale && available > 0, premiumBps: TREASURY.CLAIM_PREMIUM_BPS,
    mine: { eth: round6(Number(mine?.eth || 0)), costOmr: Number(mine?.cost_omr || 0) },
    claimMin: TREASURY.CLAIM_MIN_OMR, claimDailyOmr: TREASURY.CLAIM_DAILY_OMR,
    funding: { bySource, sellTaxBps: SELL_TAX.RWA_BPS, bondBps: BONDS.RWA_BPS },
    note: 'Backed by ETH the treasury actually holds — the game never owes ETH it does not have. Allocation only: nothing is delivered, and there is no sell and no cash-out.',
  };
}

// ── the real-value invariant (the runVigInvariants / runBondInvariants twin) ──
// THE ANTI-PONZI CHECK IS BACK, and in its strongest form: `allocated <= held` with BOTH SIDES IN
// ETH. The float's version compared units of stock to units of stock; this compares ETH to ETH, so
// there is no second asset whose price could move the two apart. The unit checks that went with the
// buy bot (`held == Σ buys`, cost basis) are gone because nothing is bought — the backing asset
// arrives directly from the four revenue slices, and `held` IS that ledger.
export async function runTreasuryInvariants(pool) {
  const checks = [];
  const push = (name, lhs, rhs, cmp = 'eq') => checks.push({
    name, lhs: round6(lhs), rhs: round6(rhs),
    ok: cmp === 'lte' ? lhs <= rhs + 1e-6 : Math.abs(lhs - rhs) < 1e-6 });
  const { held, allocated, spentOnStock } = await heldAndAllocated(pool);
  // THE anti-Ponzi check, ETH arm — deliberately TWO checks rather than one stronger one, because the
  // two ways it can break have different owners and different fixes. `allocated <= held` breaching
  // means the VAULT over-allocated (a claim-path bug); `allocated + spent <= held` breaching while
  // the first holds means the KEEPER overspent into ETH already promised to a player. Collapsing them
  // into a single check would still catch both, and would tell whoever reads the alarm at 3am
  // nothing about which one they are looking at.
  push('allocated <= held (ETH)', allocated, held, 'lte');
  push('allocated + spent <= held (ETH)', allocated + spentOnStock, held, 'lte');
  // THE anti-Ponzi check, STOCK arm — PER TICKER, in UNITS (brokers §3.2 wall 1). One check per
  // ticker rather than a summed one, because a surplus of one stock must never paper over a shortfall
  // in another: they are not fungible, and a delivery is made in a specific ticker.
  //   With §3.3's no-gate delivery this is the only wall left between the treasury and owing stock it
  // does not hold, which is why it is here in the nightly sweep — `runTreasuryInvariants` is already
  // wired into the worker's `alertDrift`, so these checks inherit the alarm the moment they exist.
  for (const s of await stockPerTicker(pool))
    push(`allocated <= held (${s.ticker}, units)`, s.allocated, s.held, 'lte');
  // each sell-tax episode's three slices sum to its gross, and the treasury slice reached the ledger.
  // A silent mismatch means the books disagree with what the tax actually took.
  const tax = (await pool.query(
    'SELECT COALESCE(SUM(gross_eth),0) g, COALESCE(SUM(dev_eth),0) d, COALESCE(SUM(rwa_eth),0) r, COALESCE(SUM(lp_eth),0) l FROM sell_tax_events WHERE real')).rows[0];
  const taxMirror = Number((await pool.query("SELECT COALESCE(SUM(rwa_eth),0) s FROM rwa_revenue WHERE source='tax'")).rows[0].s);
  push('sell-tax split == gross', Number(tax.d) + Number(tax.r) + Number(tax.l), Number(tax.g));
  push('sell-tax treasury slice == recorded', Number(tax.r), taxMirror);
  const status = await treasuryStatus(pool);
  return { ok: checks.every((c) => c.ok), checks, ...status };
}

export const _uid = () => crypto.randomUUID();

// THE OPPORTUNITY BOARD — the agent-liquidity feature. One keyless read that aggregates every open
// economic action AND every standing skill-loop with computed EV/risk signals, so an agent polls
// ONE endpoint instead of modelling a dozen boards. Pure aggregation over existing reads +
// deterministic price math — read-only, moves no value, ZERO §10.4 surface. See AGENTS.md.
import { GOODS, DISTRICTS, goodPriceOf, priceBlock } from './rules.js';
import { listContracts } from './social.js';
import { loanBoard } from './loans.js';
import { convoyBoard } from './convoy.js';
import { marketBoard } from './market.js';
import { exchangeBoard } from './exchange.js';

// The standing skill-loops (the "agent niches") — how an agent makes money by playing well, each
// with a live, computable signal. This is the sanctioned agent income: SKILL, not faucets.
function arbitrage(blk, limit = 8) {
  // Trade-goods prices are a DETERMINISTIC hash of (good, district, day) — so cross-district
  // arbitrage is a solved optimization, not a guess. For each good, find the cheapest buy district
  // and the richest sell district TODAY; rank by spread. The single highest-signal agent niche.
  const rows = [];
  for (const g of GOODS) {
    let lo = null, hi = null;
    for (const d of DISTRICTS) {
      const price = goodPriceOf(g.id, d.id, blk);
      if (!lo || price < lo.price) lo = { district: d.id, price };
      if (!hi || price > hi.price) hi = { district: d.id, price };
    }
    const spread = hi.price - lo.price;
    rows.push({ good: g.id, name: g.name, buyIn: lo.district, buyPrice: lo.price,
      sellIn: hi.district, sellPrice: hi.price, spread, spreadPct: Math.round((spread / lo.price) * 1000) / 10 });
  }
  return rows.sort((a, b) => b.spread - a.spread).slice(0, limit);
}

export async function opportunityBoard(pool, ch) {
  const blk = priceBlock();
  // the redemption window replaced the AMM (tokenomics v2 step 2) — read the live till, not a
  // spot price for a market that no longer trades
  const window = await exchangeBoard(pool, null);
  const opportunities = [];

  // 1. CONTRACTS — open kill/hospitalize pots you could fulfill (the pot is the reward). A pot in a
  //    directed-exclusive window (directedTo set) is not open to outsiders right now — skip it.
  const contracts = await listContracts(pool);
  for (const c of contracts) {
    if (c.directedTo) continue;
    if (ch && c.target.id === ch.id) continue; // can't collect a contract on your own head
    opportunities.push({
      type: 'contract', reward: c.pot, risk: c.kind === 'kill' ? 'high' : 'medium',
      action: c.kind, targetId: c.target.id, target: c.target.name,
      endpoint: c.kind === 'kill' ? `POST /v1/streets/${c.target.id}/fire (search first: /search)` : `POST /v1/streets/${c.target.id}/jump`,
      note: `${c.kind} contract on ${c.target.name}: pot $${c.pot}${c.family ? ' (family)' : ''}`,
      expiresInSeconds: c.expiresInSeconds,
    });
  }

  // 2. CONVOYS — in-transit shipments you could ambush; the value BAND is the upside, guards the risk.
  const cb = await convoyBoard(pool, ch?.id || '');
  for (const v of (cb.inTransit || [])) {
    if (v.ambushesLeft <= 0) continue;
    opportunities.push({
      type: 'convoy', reward: null, band: v.band, risk: 'medium',
      action: 'ambush', convoyId: v.id, from: v.from, to: v.to,
      endpoint: `POST /v1/convoy/${v.id}/ambush`,
      note: `${v.owner}'s convoy ${v.from}→${v.to}, cargo band ${v.band}, arrives in ${v.arrivesSeconds}s`,
      arrivesInSeconds: v.arrivesSeconds,
    });
  }

  // 3. LOANS — open offers on the board (take one to borrow; or read the rates to price your own).
  const loans = ch ? await loanBoard(pool, ch) : { offers: [] };
  for (const o of (loans.offers || [])) {
    if (o.mine) continue;
    opportunities.push({
      type: 'loan', reward: null, risk: 'low',
      action: 'borrow', loanId: o.id, principal: o.principal, rate: o.rate, owed: o.owed, hours: o.hours,
      endpoint: `POST /v1/loans/${o.id}/take`,
      note: `borrow $${o.principal} @ ${Math.round(o.rate * 100)}% for ${o.hours}h (owe $${o.owed})${o.secured ? ' — secured' : ''}`,
    });
  }

  // 4. MARKET — WTB buy orders you could FILL from your trunk (instant cash), + live car auctions.
  const market = await marketBoard(pool);
  for (const l of (market.listings || [])) {
    if (l.kind === 'order') {
      opportunities.push({
        type: 'order', reward: l.wanted * l.unitPrice, risk: 'none',
        action: 'fill', listingId: l.id, good: l.good, wanted: l.wanted, unitPrice: l.unitPrice, district: l.district,
        endpoint: `POST /v1/market/${l.id}/fill`,
        note: `WTB ${l.wanted}× ${l.good} @ $${l.unitPrice} at ${l.district} (fill from trunk)`,
      });
    }
  }

  // Rank the discrete opportunities: known reward first (desc), then everything else.
  opportunities.sort((a, b) => (b.reward || 0) - (a.reward || 0));

  // 5. NICHES — the standing skill-loops with live signals (the sanctioned agent income).
  const niches = {
    arbitrage: arbitrage(blk),
    // (red-team C1, tokenomics v2) This used to advertise `POST /v1/swap` and publish an AMM spot
    // price. Cash → $OMR is gone and so is the AMM, so every clause of that was false — and this
    // board is the surface AGENTS.md tells agents to poll, so a wrong entry here is not a stale
    // comment, it is an agent burning calls on a route that only ever answers `retired`.
    // What actually exists now runs the other way: burn $OMR, take cash, from a funded till.
    redemption: {
      note: 'The window runs ONE WAY: burn $OMR for cash at a published rate (POST /v1/window/redeem), '
        + 'out of a till the street take funds. Cash can no longer be turned into $OMR at all — no swap, '
        + 'no laundering. A short till refuses and burns nothing. GET /v1/window for the rate and headroom.',
      rate: window.rate, poolCash: window.pool, poolOmr: window.poolOmr, open: window.open,
    },
    loanSharking: { note: 'Offer credit with POST /v1/loans (rate ≤ 0.5, term 1–72h); price default risk; trade the paper.',
      openOffers: (loans.offers || []).length },
    convoyRunning: { note: 'Run bulk freight for profit: POST /v1/convoy, /load, /depart {guards}. Bigger than a trunk, on a real clock.' },
    passiveIncome: { note: 'Buy-once drip: rackets, businesses (/v1/business), territory (gang). Collect on your own clock — never leave income on the table.' },
  };

  return {
    updatedBlock: blk,
    counts: { contracts: opportunities.filter((o) => o.type === 'contract').length,
      convoys: opportunities.filter((o) => o.type === 'convoy').length,
      loans: opportunities.filter((o) => o.type === 'loan').length,
      orders: opportunities.filter((o) => o.type === 'order').length },
    opportunities,
    niches,
    note: 'Aggregated open economic actions + standing skill-loops with EV/risk signals. Read-only. See GET /agents.',
  };
}

// LIVE-OPS overview + activity aggregation for the mod dashboard (public/admin.html). Pure read
// snapshots over the economy singletons + player tables + the telemetry feed — no writes, no §10.4
// surface. The dashboard also calls the existing mod endpoints (invariants, funnel, vig, emission,
// reserve, audit) alongside these two. Founder-facing so the alpha can be run and watched without a dev.

const num = (v) => Number(v || 0);
const safeParse = (p) => { try { return typeof p === 'string' ? JSON.parse(p) : (p || {}); } catch { return {}; } };

export async function opsOverview(pool) {
  const one = async (q, p = []) => num((await pool.query(q, p)).rows[0]?.n);
  const row = async (q, p = []) => (await pool.query(q, p)).rows[0] || {};
  const rows = async (q, p = []) => (await pool.query(q, p)).rows;

  const players = {
    accounts: await one('SELECT COUNT(*) n FROM accounts'),
    banned: await one("SELECT COUNT(*) n FROM accounts WHERE status='banned'"),
    total: await one('SELECT COUNT(*) n FROM characters'),
    alive: await one('SELECT COUNT(*) n FROM characters WHERE alive'),
    dead: await one('SELECT COUNT(*) n FROM characters WHERE NOT alive'),
    active24h: await one("SELECT COUNT(*) n FROM characters WHERE alive AND last_accrued_at > now() - interval '24 hours'"),
    agents: await one('SELECT COUNT(*) n FROM account_persistent WHERE agent_flag'),
    jailed: await one('SELECT COUNT(*) n FROM characters WHERE alive AND jail_until > now()'),
    indicted: await one('SELECT COUNT(*) n FROM characters WHERE alive AND indicted_at IS NOT NULL'),
  };

  const amm = await row('SELECT cash_reserve, omr_reserve FROM amm_pool WHERE id=1');
  const tax = await row('SELECT pool, fund, last_buyback FROM street_tax WHERE id=1');
  const stake = await row('SELECT balance, lifetime_funded, lifetime_paid FROM stake_pool WHERE id=1');
  const den = await row('SELECT total, profit, distributed FROM den_volume WHERE id=1');
  const ammPrice = num(amm.omr_reserve) > 0 ? num(amm.cash_reserve) / num(amm.omr_reserve) : 0;

  // $OMR supply — the invariants omrBuckets (the true circulating soft-$OMR total)
  const omrSupply = await one('SELECT COALESCE(SUM(omr+staked+unbonding),0) n FROM account_persistent')
    + num(amm.omr_reserve) + num(tax.fund)
    + await one('SELECT COALESCE(SUM(omr_reserve),0) n FROM gangs')
    + num(stake.balance);

  const topPlayers = await rows('SELECT name, respect, cash, bank FROM characters WHERE alive ORDER BY respect DESC LIMIT 8');
  const topGangs = await rows('SELECT name, tag, treasury, wars_won FROM gangs ORDER BY treasury DESC LIMIT 8');

  return {
    at: null, // stamped by the client on receipt (Date.now() is unavailable server-side in some paths)
    players,
    economy: {
      ammPrice: Math.round(ammPrice * 100) / 100,
      ammCash: Math.floor(num(amm.cash_reserve)), ammOmr: Math.round(num(amm.omr_reserve) * 100) / 100,
      taxPool: Math.floor(num(tax.pool)), eventFund: Math.round(num(tax.fund) * 100) / 100, lastBuyback: tax.last_buyback || null,
      stakePool: Math.round(num(stake.balance) * 1000) / 1000, stakeFunded: Math.round(num(stake.lifetime_funded) * 1000) / 1000, stakePaid: Math.round(num(stake.lifetime_paid) * 1000) / 1000,
      den: { total: Math.floor(num(den.total)), profit: Math.floor(num(den.profit)), distributed: Math.floor(num(den.distributed)) },
      gangCount: await one('SELECT COUNT(*) n FROM gangs'),
      gangTreasury: await one('SELECT COALESCE(SUM(treasury),0) n FROM gangs'),
      charWealth: await one('SELECT COALESCE(SUM(cash+bank),0) n FROM characters'),
      omrSupply: Math.round(omrSupply * 1000) / 1000,
      omrStaked: Math.round(await one('SELECT COALESCE(SUM(staked),0) n FROM account_persistent') * 1000) / 1000,
    },
    top: {
      players: topPlayers.map((p) => ({ name: p.name, respect: num(p.respect), netWorth: Math.floor(num(p.cash) + num(p.bank)) })),
      gangs: topGangs.map((g) => ({ name: g.name, tag: g.tag, treasury: Math.floor(num(g.treasury)), warsWon: num(g.wars_won) })),
    },
  };
}

// The live event feed — recent telemetry rows (what's happening right now), newest first.
export async function opsActivity(pool, limit = 50) {
  const n = Math.min(200, Math.max(1, Math.floor(Number(limit) || 50)));
  const rows = (await pool.query('SELECT event, props, at FROM telemetry ORDER BY at DESC LIMIT $1', [n])).rows;
  return { events: rows.map((r) => ({ event: r.event, at: r.at, props: safeParse(r.props) })) };
}

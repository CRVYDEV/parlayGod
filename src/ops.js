// LIVE-OPS overview + activity aggregation for the mod dashboard (public/admin.html). Pure read
// snapshots over the economy singletons + player tables + the telemetry feed — no writes, no §10.4
// surface. The dashboard also calls the existing mod endpoints (invariants, funnel, vig, emission,
// reserve, audit) alongside these two. Founder-facing so the alpha can be run and watched without a dev.

import { POPULATION } from './rules.js';
import { seededToday } from './population.js';
import { archiverHealth } from './dbhealth.js';

const num = (v) => Number(v || 0);
const safeParse = (p) => { try { return typeof p === 'string' ? JSON.parse(p) : (p || {}); } catch { return {}; } };

export async function opsOverview(pool) {
  const one = async (q, p = []) => num((await pool.query(q, p)).rows[0]?.n);
  const row = async (q, p = []) => (await pool.query(q, p)).rows[0] || {};
  const rows = async (q, p = []) => (await pool.query(q, p)).rows;

  // THE POPULATION: every player count EXCLUDES NPC residents — the founder is reading how many real
  // people are in the game, and scenery in that number would be worse than useless. `residents` is
  // reported separately so the city's headcount is still visible.
  const players = {
    accounts: await one('SELECT COUNT(*) n FROM accounts WHERE auth_provider <> $1', ['npc']),
    banned: await one("SELECT COUNT(*) n FROM accounts WHERE status='banned'"),
    total: await one('SELECT COUNT(*) n FROM characters WHERE NOT is_npc'),
    alive: await one('SELECT COUNT(*) n FROM characters WHERE alive AND NOT is_npc'),
    dead: await one('SELECT COUNT(*) n FROM characters WHERE NOT alive AND NOT is_npc'),
    active24h: await one("SELECT COUNT(*) n FROM characters WHERE alive AND NOT is_npc AND last_accrued_at > now() - interval '24 hours'"),
    agents: await one('SELECT COUNT(*) n FROM account_persistent WHERE agent_flag'),
    residents: await one('SELECT COUNT(*) n FROM characters WHERE alive AND is_npc'),
    // step three (THE TURNOVER): the city renews itself by retiring picked-clean residents and
    // spawning fresh ones, so `npc:seed` is a recurring faucet — surface the replacements used
    // against the day's ceiling, plus the dollars it actually cost, so the founder can watch the
    // faucet rather than take it on trust.
    residentTurnoverToday: await one('SELECT retired n FROM population_state WHERE id=1'),
    residentTurnoverCap: POPULATION.TURNOVER.PER_DAY,
    residentSeedToday: await seededToday(pool),
    jailed: await one('SELECT COUNT(*) n FROM characters WHERE alive AND NOT is_npc AND jail_until > now()'),
    indicted: await one('SELECT COUNT(*) n FROM characters WHERE alive AND NOT is_npc AND indicted_at IS NOT NULL'),
  };

  const amm = await row('SELECT cash_reserve, omr_reserve FROM amm_pool WHERE id=1');
  const tax = await row('SELECT pool, fund, last_buyback FROM street_tax WHERE id=1');
  const stake = await row('SELECT balance, lifetime_funded, lifetime_paid FROM stake_pool WHERE id=1');
  const den = await row('SELECT total, profit, distributed FROM den_volume WHERE id=1');
  const ammPrice = num(amm.omr_reserve) > 0 ? num(amm.cash_reserve) / num(amm.omr_reserve) : 0;

  // $OMR supply — the invariants omrBuckets (the true circulating soft-$OMR total). Includes the
  // auction escrow (live standing bids are $OMR parked in the house, part of the bucket sum).
  const omrSupply = await one('SELECT COALESCE(SUM(omr+staked+unbonding),0) n FROM account_persistent')
    + num(amm.omr_reserve) + num(tax.fund)
    + await one('SELECT COALESCE(SUM(omr_reserve),0) n FROM gangs')
    + num(stake.balance)
    + await one("SELECT COALESCE(SUM(current_bid),0) n FROM auctions WHERE status='live'");

  const topPlayers = await rows('SELECT name, respect, cash, bank FROM characters WHERE alive ORDER BY respect DESC LIMIT 8');
  const topGangs = await rows('SELECT name, tag, treasury, wars_won FROM gangs ORDER BY treasury DESC LIMIT 8');

  return {
    at: null, // stamped by the client on receipt (Date.now() is unavailable server-side in some paths)
    // ARE THE BACKUPS RUNNING? The one health question the game could not previously answer about
    // itself — the database serves fine while its recovery chain rots. Read straight from Postgres's
    // own pg_stat_archiver, so the dashboard shows it without anyone reading the host's log stream.
    backups: await archiverHealth(pool),
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

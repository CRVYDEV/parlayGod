// LIVE-OPS overview + activity aggregation for the mod dashboard (public/admin.html). Pure read
// snapshots over the economy singletons + player tables + the telemetry feed — no writes, no §10.4
// surface. The dashboard also calls the existing mod endpoints (invariants, funnel, vig, emission,
// reserve, audit) alongside these two. Founder-facing so the alpha can be run and watched without a dev.

import { POPULATION, MINT_TRANCHES, mintTierOf } from './rules.js';
import { seededToday } from './population.js';
import { archiverHealth } from './dbhealth.js';
import { socialProviders } from './verify.js';
import { socialRewardsLive } from './growth.js';

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
    // IS THE GROWTH LOOP ON? Same class as `backups` above — a question the game could not answer
    // about itself. A server can run SOCIAL_VERIFY_MODE=live with no provider token, in which case
    // Spread-the-Word pays nobody and the First-Week socials are dropped; nothing about that was
    // visible anywhere. `rewardsLive` is the bottom line: false means the word-of-mouth cash faucet
    // is inert right now, whatever the mode says.
    social: { ...socialProviders(), rewardsLive: socialRewardsLive() },
    // CAN THE ALARM REACH YOU? Same class again. Both alarms above (§10.4 drift, backups) shout through
    // INVARIANT_WEBHOOK_URL; unset, they only reach a log nobody reads. It is set on the WORKER, so an
    // api-only reading of `process.env` here can say "no" while the worker says "yes" — the dashboard
    // labels that rather than implying the alarm is dead. Never return the URL itself: it is a bearer
    // secret (anyone holding it can post into the channel) and this endpoint's output ends up pasted
    // into bug reports.
    alerting: { webhook: !!process.env.INVARIANT_WEBHOOK_URL },
    // THE TRANCHE SCHEDULE (Shape D): tier progress + the expected-vs-live pair, so the GM sees a
    // boundary coming and a live pair that has drifted off the published table. The boundary is
    // EXECUTED by hand — one Safe setFees tx, and the $OMR rail follows on its own now that it
    // DERIVES from the fee at the genesis rate. This line is the instrument.
    mintTier: await (async () => {
      const minted = await one('SELECT COUNT(*) n FROM account_persistent WHERE minted');
      const t = mintTierOf(minted);
      // ETH ONLY — the mint has one rail, so there is one number to compare and a boundary is one
      // Safe setFees transaction.
      const liveEth = Number(process.env.MINT_FEE_ETH || 0.01);
      return {
        minted, tier: t.tier, of: MINT_TRANCHES.length, through: t.flat ? null : t.through,
        priceEth: t.eth, priceOmr: null, flat: t.flat, liveEth, liveOmr: null,
        offSchedule: Math.abs(liveEth - t.eth) > 1e-9,
      };
    })(),
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

// ── THE INTEGRATIONS PANEL — which dormant retention/funnel wiring is LIVE, and how to switch it on.
// A returning-player game lives or dies on push + a frictionless top-of-funnel, and all of it ships
// DORMANT (the chain/dormant precedent) — built, tested, and switched on by ONE deploy-config action.
// This is the founder's switchboard: is it on, and if not, the exact steps. Pure env PRESENCE — it
// reports a boolean per integration and NEVER echoes a secret value (a key or webhook URL never
// leaves the server). No DB, no §10.4.
export function integrationsStatus() {
  const has = (k) => !!(process.env[k] && String(process.env[k]).trim());
  const baseUrl = process.env.PUBLIC_URL || process.env.SOCIAL_GAME_URL;
  return { integrations: [
    { id: 'push', name: 'Web Push', kind: 'retention',
      live: has('VAPID_PUBLIC_KEY') && has('VAPID_PRIVATE_KEY'),
      why: 'Wakes returning players — for a lazy-accrual game where things happen to you while you\'re gone, this is the single highest-ROI retention primitive.',
      needs: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT (optional, mailto:)'],
      steps: 'Run `node tools/vapid.js` once, set VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY (keep the private one secret), redeploy. The 🔔 button then appears in-client.' },
    { id: 'x_oauth', name: 'X one-click sign-in', kind: 'funnel',
      live: has('X_CLIENT_ID') && !!baseUrl,
      why: 'One-tap signup removes the friction at the top of the funnel — without it, X users must paste a token (developers only), which nobody does.',
      needs: ['X_CLIENT_ID', 'X_CLIENT_SECRET', 'PUBLIC_URL'],
      steps: 'Register an X app, set X_CLIENT_ID/X_CLIENT_SECRET + PUBLIC_URL, and register the callback URL PUBLIC_URL + /v1/auth/x/callback on the X app.' },
    { id: 'city_wire', name: 'Discord city wire', kind: 'funnel',
      live: has('CITY_WIRE_WEBHOOK_URL'),
      why: 'Posts city drama (kills, wars, monuments) to your community Discord — the genre audience shares beef, so every server war becomes free organic reach.',
      needs: ['CITY_WIRE_WEBHOOK_URL'],
      steps: 'Create a Discord CHANNEL webhook (a PUBLIC community channel, distinct from the private INVARIANT_WEBHOOK_URL ops alarm), set CITY_WIRE_WEBHOOK_URL on the API.' },
    { id: 'wallet_connect', name: 'WalletConnect (mobile chain)', kind: 'chain',
      live: has('WALLETCONNECT_PROJECT_ID'),
      why: 'Mobile wallet linking for on-chain $OMR extraction (mainnet-gated — lower priority until the chain is live).',
      needs: ['WALLETCONNECT_PROJECT_ID'],
      steps: 'Grab a free public project id from dashboard.reown.com, set WALLETCONNECT_PROJECT_ID (public/client-embedded by design).' },
  ] };
}

// ── THE COACH CENSUS — where the coach has every ACTIVE player standing, live ────────────────────
// The progression harness measures where a SIMULATED player sits on the ladder; this is the same
// reading over the real population: for every living human character active inside the window, the
// coach's current top rung, aggregated. A rung that half the base is sitting on IS the measured
// drop-off — the live counterpart of the harness's anti-masking bound, and the first thing to read
// once testers touch the game. Pure read (view() computes, nothing persists), mod-only, bounded to
// 200 characters so the census can never become a load problem.
export async function opsCoach(pool) {
  const { loadOwned, view } = await import('./game.js');
  const chars = (await pool.query(
    `SELECT * FROM characters
      WHERE alive AND NOT is_npc AND last_accrued_at > now() - interval '7 days'
      ORDER BY last_accrued_at DESC LIMIT 200`)).rows;
  const rungs = new Map();
  let surveyed = 0, silent = 0;
  for (const ch of chars) {
    try {
      const acct = (await pool.query('SELECT * FROM account_persistent WHERE account_id=$1', [ch.account_id])).rows[0] || {};
      const owned = await loadOwned(pool, ch);
      const coach = view(ch, acct, owned).coach;
      surveyed++;
      if (!coach) { silent++; continue; }
      let r = rungs.get(coach.label);
      if (!r) { r = { label: coach.label, tab: coach.tab, count: 0, players: [] }; rungs.set(coach.label, r); }
      r.count++;
      if (r.players.length < 5) r.players.push(ch.name);
    } catch { /* one broken row must not blind the census — the worker safe() posture */ }
  }
  return {
    surveyed, silent, activeWindowDays: 7,
    rungs: [...rungs.values()].sort((a, b) => b.count - a.count),
  };
}

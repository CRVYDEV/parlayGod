// §10.4 — the nightly ledger-invariant job. Value transfers, it is never minted:
// every bucket of value must reconcile against the enumerated faucet/sink reasons
// in the transactions ledger. Any drift beyond $1 (or one unit) — or any ledger
// row with a reason outside the known vocabulary — is an alert.
import crypto from 'node:crypto';

// The complete reason vocabulary, by currency. A row whose reason matches no
// prefix here is an unenumerated faucet/sink — the loudest possible §10.4 alarm.
const KNOWN_REASONS = {
  cash: ['crime:', 'racket:income', 'bank:interest', 'bank:', 'heal', 'checkin', 'travel', 'heist',
    'melt:tithe', 'fence', 'repair', 'craft:', 'goods:', 'racket:buy:', 'asset:', 'swap:', 'gun:buy:',
    'ammo:buy', 'gang:found', 'gang:tribute', 'gang:war', 'gang:dissolved', 'turf:seize:', 'jump:',
    'bounty:', 'bust:reward', 'whack:chop', 'death:', 'exchange:', 'crew:sales', 'deal:', 'makings:',
    'lab:', 'crew:hire', 'laylow', 'mission:', 'daily:', 'onboard:', 'referral:', 'mod:confiscate', 'npchit:', 'safehouse',
    'gang:contract', 'bodyguard:'],
  omr: ['swap:', 'stake:reward', 'gear:mint:', 'vest:', 'lab:', 'cleanpapers', 'path:', 'mission:',
    'daily:all', 'referral:', 'family:weekly', 'gang:dissolved', 'withdraw:omr', 'vanity:', 'intel:', 'respec'],
  cb: ['crime:', 'craft:', 'gun:buy:', 'jump:', 'death:', 'exchange:', 'onboard:', 'cook:'],
  ammo: ['melt', 'melt:tithe', 'craft:ammo', 'ammo:buy', 'jump', 'fire', 'death:', 'exchange:', 'gang:dissolved'],
};

const sum = async (pool, where) =>
  Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE ${where}`)).rows[0].s);
const one = async (pool, q) => Number((await pool.query(q)).rows[0].s);

export async function runLedgerInvariants(pool) {
  const checks = [];
  const push = (name, lhs, rhs, tolerance = 1, extra = {}) =>
    checks.push({ name, lhs: Math.round(lhs * 1e6) / 1e6, rhs: Math.round(rhs * 1e6) / 1e6,
      drift: Math.round((lhs - rhs) * 1e6) / 1e6, ok: Math.abs(lhs - rhs) <= tolerance, ...extra });

  // (a) CHARACTER CASH: every character starts with an unledgered $500; everything
  // after that has a row. Dead rows are zeroed and their estate burn is ledgered.
  const charWealth = await one(pool, 'SELECT COALESCE(SUM(cash+bank),0) s FROM characters');
  const charCount = await one(pool, 'SELECT COUNT(*) s FROM characters');
  const charLedger = await sum(pool, "currency='cash' AND character_id IS NOT NULL");
  push('character cash', charWealth, 500 * charCount + charLedger);

  // (b) GANG TREASURIES: inflows are tribute (mirrored off character rows) and the
  // melt tithe; sinks are war chests, garrisons, and dissolution; spoils are internal.
  const treasuries = await one(pool, 'SELECT COALESCE(SUM(treasury),0) s FROM gangs');
  const tributeIn = -(await sum(pool, "currency='cash' AND reason='gang:tribute'"));
  const titheIn = await sum(pool, "currency='cash' AND reason='melt:tithe'");
  const warOut = -(await sum(pool, "currency='cash' AND reason='gang:war'"));
  const seizeOut = -(await sum(pool, "currency='cash' AND reason LIKE 'turf:seize:%'"));
  const dissolvedCash = -(await sum(pool, "currency='cash' AND reason='gang:dissolved'"));
  // M7 Phase 4 family contracts: treasury → escrow ('gang:contract' + its 2% ':take') is an
  // outflow; a cancel/expiry refund comes home as a character_id-NULL 'bounty:refund' row
  // (character refunds carry a character_id, so the split is exact).
  const contractOut = -(await sum(pool, "currency='cash' AND reason LIKE 'gang:contract%'"));
  const treasuryRefunds = await sum(pool, "currency='cash' AND reason='bounty:refund' AND character_id IS NULL");
  push('gang treasuries', treasuries, tributeIn + titheIn - warOut - seizeOut - dissolvedCash - contractOut + treasuryRefunds);

  // (c) BOUNTY/CONTRACT ESCROW: posted (escrow rows, player 'bounty:post' + family 'gang:contract')
  // − claimed − refunded (cancel/expiry) − cleared at death.
  const escrow = await one(pool, 'SELECT COALESCE(SUM(amount),0) s FROM bounties');
  const posted = -(await sum(pool, "currency='cash' AND reason='bounty:post'"));
  const gangPosted = -(await sum(pool, "currency='cash' AND reason='gang:contract'"));
  const claimed = await sum(pool, "currency='cash' AND reason='bounty:claim'");
  const refunded = await sum(pool, "currency='cash' AND reason='bounty:refund'");
  const deadBounties = -(await sum(pool, "currency='cash' AND reason='death:bounty'"));
  push('bounty escrow', escrow, posted + gangPosted - claimed - refunded - deadBounties);

  // (d) $OMR CONSERVATION: buckets = accounts (omr + staked; unclaimed rewards mint
  // at claim time) + AMM reserve + event fund + family reserves. Genesis is the
  // 20,000-token pool seed. Legal mints: staking-reward claims, mission rewards.
  // Legal burns: vests, clean papers, lab tiers, gear mints, path switches,
  // dissolution. Swaps, buybacks, and fund-sourced payouts are transfers — they
  // move between buckets and cancel inside the total.
  const omrBuckets = await one(pool, 'SELECT COALESCE(SUM(omr+staked),0) s FROM account_persistent')
    + await one(pool, 'SELECT COALESCE(SUM(omr_reserve),0) s FROM amm_pool')
    + await one(pool, 'SELECT COALESCE(SUM(fund),0) s FROM street_tax')
    + await one(pool, 'SELECT COALESCE(SUM(omr_reserve),0) s FROM gangs');
  const omrMints = await sum(pool, "currency='omr' AND (reason='stake:reward' OR reason LIKE 'mission:%')");
  const omrBurns = -(await sum(pool, "currency='omr' AND (reason LIKE 'vest:%' OR reason='cleanpapers' OR reason LIKE 'lab:%' OR reason LIKE 'gear:mint:%' OR reason LIKE 'path:%' OR reason='gang:dissolved' OR reason='withdraw:omr' OR reason LIKE 'vanity:%' OR reason LIKE 'intel:%' OR reason='respec')"));
  push('$OMR conservation', omrBuckets, 20000 + omrMints - omrBurns, 0.001);

  // (e) CAR CONSERVATION: boost is the only faucet; melt, fence, and death the only
  // sinks (death events carry the destroyed fleet size in telemetry).
  const carsHeld = await one(pool, 'SELECT COUNT(*) s FROM cars');
  const boosts = await one(pool, "SELECT COUNT(*) s FROM rng_audit WHERE action='gta' AND outcome='success'");
  const melts = await one(pool, "SELECT COUNT(*) s FROM transactions WHERE reason='melt' AND currency='ammo' AND character_id IS NOT NULL");
  const fences = await one(pool, "SELECT COUNT(*) s FROM transactions WHERE reason='fence'");
  const deaths = (await pool.query("SELECT props FROM telemetry WHERE event='death'")).rows;
  const deathCars = deaths.reduce((a, r) => a + (JSON.parse(r.props).cars || 0), 0);
  push('car conservation', carsHeld, boosts - melts - fences - deathCars, 0);

  // (f) CONTRABAND & AMMO: characters + exchange escrow (+ the family armories);
  // ammo starts at 25/character, crates at 0.
  for (const cur of ['cb', 'ammo']) {
    const held = await one(pool, `SELECT COALESCE(SUM(${cur}),0) s FROM characters`);
    const inEscrow = await one(pool, `SELECT COALESCE(SUM(qty),0) s FROM listings WHERE item_kind='${cur}'`);
    const banked = cur === 'ammo' ? await one(pool, 'SELECT COALESCE(SUM(ammo_bank),0) s FROM gangs') : 0;
    const ledgered = await sum(pool, `currency='${cur}'`);
    const start = cur === 'ammo' ? 25 * charCount : 0;
    push(`${cur} conservation`, held + inEscrow + banked, start + ledgered);
  }

  // (g) UNKNOWN REASONS — any row outside the vocabulary is an unenumerated faucet/sink
  const unknown = [];
  for (const [cur, prefixes] of Object.entries(KNOWN_REASONS)) {
    const rows = (await pool.query('SELECT DISTINCT reason FROM transactions WHERE currency=$1', [cur])).rows;
    for (const r of rows)
      if (!prefixes.some((p) => r.reason === p || r.reason.startsWith(p))) unknown.push(`${cur}:${r.reason}`);
  }
  push('reason vocabulary', unknown.length, 0, 0, { unknown });

  const ok = checks.every((c) => c.ok);
  if (!ok) await alertDrift(pool, checks.filter((c) => !c.ok));
  return { ok, checks };
}

// Alerting: a telemetry row always; a webhook when INVARIANT_WEBHOOK_URL is set.
async function alertDrift(pool, failed) {
  await pool.query('INSERT INTO telemetry (id, event, props) VALUES ($1,$2,$3)',
    [crypto.randomUUID(), 'invariant_drift', JSON.stringify(failed)]);
  console.error('🚨 §10.4 LEDGER INVARIANT DRIFT:', JSON.stringify(failed));
  if (process.env.INVARIANT_WEBHOOK_URL) {
    try {
      await fetch(process.env.INVARIANT_WEBHOOK_URL, { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ alert: 'ledger_invariant_drift', failed }) });
    } catch (e) { console.error('invariant webhook failed', e.message); }
  }
}

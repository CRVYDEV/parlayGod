// ── THE TOKEN-HEALTH BOARD — five KPIs, and the four ways a dashboard lies ───────────────────────
// (`src/tokenhealth.js`; the tokenomics review's "no external token-health dashboard".)
//
// Every other instrument in this project answers "can the books lie?". This one answers "is the
// economy working?", and a dashboard has its own failure modes — none of which §10.4 can see:
//
//   (1) A STRUCTURAL ZERO READS AS AN ALARM. Pre-market there is no auction, no withdrawal and no
//       float, so most of these are zero BY CONSTRUCTION. If that renders as "the desk is starving",
//       the board cries wolf from day one and gets ignored by launch — the exact fate of a check
//       nobody reads. So the first block asserts a fresh database reads DORMANT, not `act`.
//   (2) THE DENOMINATOR IS WRONG. Velocity is sink volume over the float that can come home. Fold
//       the house's own pools into it and the number falls every time the desk COLLECTS a sink —
//       i.e. it would report the revenue engine slowing down precisely when it is working.
//   (3) SPEND AND TRANSFER GET CONFLATED. A $OMR transfer out of an account (loot, tribute) is not
//       the house taking a cut. Count it as sink volume and both the revenue KPI and the agent-vs-
//       human composition are inflated by player-to-player churn.
//   (4) THE BOARD MOVES MONEY. It is a read; it must write nothing at all, and that is asserted by
//       counting ledger rows across a full computation rather than by intent.
//   (5) A THIN SAMPLE READS AS A HEALTHY ONE — the launch-hour lie, and the one (1) does not cover.
//       (1) is about a denominator that is ZERO; this is about one that EXISTS and means nothing.
//       Measured before the floors shipped: one player holding 5 $OMR who spends it once produced
//       `velocity: 52.14 turns/year, band ok` — the headline revenue KPI reporting a confident
//       PASS off a sample of one, on exactly the day a founder is most likely to read it. A number
//       that cannot say "I do not know yet" is indistinguishable from a good one.
//
// pg-mem, zero infra.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { buildServer } from '../src/server.js';
import { tokenHealth } from '../src/tokenhealth.js';
import { ledger } from '../src/game.js';
import * as Desk from '../src/desk.js';
import { DESK_AUCTION } from '../src/rules.js';

const app = await buildServer();
const pool = app.pool;
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const call = async (method, url, { token, mod, body } = {}) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (mod) headers['x-mod-key'] = 'test-mod-key';
  const res = await app.inject({ method, url, headers, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  const { body: ch } = await call('POST', '/v1/character', { token, body: { name } });
  const id = ch.character?.id || ch.id;
  const acct = (await pool.query('SELECT account_id FROM characters WHERE id=$1', [id])).rows[0].account_id;
  return { token, acct, id };
};
const grant = (acct, omr) =>
  pool.query('UPDATE account_persistent SET omr = omr + $2 WHERE account_id=$1', [acct, omr]);
// spend through the REAL ledger, so the desk:recycle hook fires exactly as it does in the game
const spend = async (acct, omr, reason) => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await ledger(c, { accountId: acct, currency: 'omr', amount: -omr, reason });
    await c.query('UPDATE account_persistent SET omr = omr - $2 WHERE account_id=$1', [acct, omr]);
    await c.query('COMMIT');
  } finally { c.release(); }
};
const kpiOf = (board, key) => {
  const k = board.kpis.find((x) => x.key === key);
  assert(k, `the "${key}" KPI exists`);
  return k;
};

// ── 1. A FRESH DATABASE IS DORMANT, NOT FAILING ────────────────────────────────────────────────
{
  const b = await tokenHealth(pool);
  assert.equal(b.verdict, 'dormant', 'a game with no market reads dormant overall');
  for (const key of ['velocity', 'sinkPerPlayer', 'clearance', 'committedShare'])
    assert.equal(kpiOf(b, key).state, 'dormant',
      `"${key}" must read dormant with no denominator — a structural zero is not an alarm`);
  // and it says so in words a person can act on (or correctly decline to act on)
  assert(/pre-market|no auction/i.test(kpiOf(b, 'clearance').reads),
    'the clearance reading explains that nothing has closed yet, rather than reporting 0%');
}

// ── 2. THE FLOAT SPLIT — player-held vs the house's own pools ───────────────────────────────────
{
  const a = await mk('Velocity Vic');
  const b = await mk('Holder Hal');
  await grant(a.acct, 1000);
  await grant(b.acct, 600);
  // Hal commits: 400 staked, 200 unbonding, 0 liquid left of his 600
  await pool.query('UPDATE account_persistent SET omr = omr - 600, staked = staked + 400, unbonding = unbonding + 200 WHERE account_id=$1', [b.acct]);
  // a family reserve — organisation-held float, which is still float that can come home
  await pool.query("INSERT INTO gangs (id, name, tag, omr_reserve) VALUES ($1,'The Test Family','TTF',150)",
    [crypto.randomUUID()]);

  const board = await tokenHealth(pool);
  assert.equal(board.float.player.liquid, 1000, 'liquid = what accounts hold loose');
  assert.equal(board.float.player.staked, 400);
  assert.equal(board.float.player.unbonding, 200);
  assert.equal(board.float.player.gangReserves, 150);
  assert.equal(board.float.player.total, 1750, 'player float = liquid + committed + family reserves');
  const share = kpiOf(board, 'committedShare');
  assert.equal(share.value, Math.round(600 / 1750 * 1000) / 10, 'the committed share is 600 of 1750');
  assert.equal(share.state, 'ok', 'a 34% committed share is neither extreme');
}

// ── 3. SINK VOLUME, VELOCITY, AND THE DENOMINATOR THAT MUST NOT INCLUDE THE HOUSE ──────────────
// Spending through the real ledger fires the recycle hook: the $OMR lands on the desk's shelf, so
// the house's pools GROW by exactly what the player float LOST. If the velocity denominator counted
// the shelf, the measured engine would slow down every time it ran.
{
  const before = await tokenHealth(pool);
  const floatBefore = before.float.player.total;
  const spender = (await pool.query(
    'SELECT account_id FROM account_persistent WHERE omr >= 700 ORDER BY omr DESC LIMIT 1')).rows[0].account_id;
  await spend(spender, 700, 'estate:tier');          // a recycling sink (in DESK.SINK_REASONS)

  const b = await tokenHealth(pool);
  assert.equal(b.sinks.recycled, 700, 'the sink is measured off the desk:recycle row the hook wrote');
  assert.equal(b.sinks.windowVolume, 700, 'window sink volume');
  assert.equal(b.float.system.shelf, 700, 'and the same 700 is sitting on the shelf');
  assert.equal(b.float.player.total, round6(floatBefore - 700), 'the player float fell by exactly the spend');
  // velocity = sinkVolume × (365/window) ÷ playerFloat — the house's 700 is NOT in the denominator
  const v = kpiOf(b, 'velocity');
  const expect = Math.round(700 * (365 / b.window.days) / b.float.player.total * 100) / 100;
  assert.equal(v.value, expect, `velocity is annualised sink volume over PLAYER float (${expect})`);
  assert(v.value > 0, 'and a live economy is not dormant');
}

// ── 4. A TRANSFER IS NOT A SINK ────────────────────────────────────────────────────────────────
// The sharpest way this board could flatter itself: count player-to-player $OMR movement as house
// revenue. `whack:loot` moves $OMR between accounts and is in NEITHER the mint nor the burn term.
{
  const beforeVol = (await tokenHealth(pool)).sinks.windowVolume;
  const victim = await mk('Looted Lou');
  const killer = await mk('Loot Larry');
  await grant(victim.acct, 500);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await ledger(c, { accountId: victim.acct, currency: 'omr', amount: -300, reason: 'whack:loot' });
    await ledger(c, { accountId: killer.acct, currency: 'omr', amount: 300, reason: 'whack:loot' });
    await c.query('UPDATE account_persistent SET omr = omr - 300 WHERE account_id=$1', [victim.acct]);
    await c.query('UPDATE account_persistent SET omr = omr + 300 WHERE account_id=$1', [killer.acct]);
    await c.query('COMMIT');
  } finally { c.release(); }
  const b = await tokenHealth(pool);
  assert.equal(b.sinks.windowVolume, beforeVol, 'a 300 $OMR loot moved zero sink volume');
  assert.equal(b.sinks.byCohort.human + b.sinks.byCohort.agent, beforeVol,
    'and the cohort split counts the same sinks, not the transfer');
}

// ── 5. THE WITHDRAWAL IS A SINK THE DESK NEVER SEES ────────────────────────────────────────────
// `withdraw:omr` is the ONE reason in the burn term that does not recycle (the token left for the
// chain). It is still $OMR leaving the player float, so it belongs in sink volume — and it must be
// read from the rules' own NOT_RECYCLED list rather than restated here.
{
  const before = await tokenHealth(pool);
  const holder = (await pool.query(
    'SELECT account_id FROM account_persistent WHERE omr >= 100 ORDER BY omr DESC LIMIT 1')).rows[0].account_id;
  await spend(holder, 100, 'withdraw:omr');
  const b = await tokenHealth(pool);
  assert.equal(b.sinks.withdrawn, 100, 'the withdrawal counts as sink volume');
  assert.equal(b.sinks.windowVolume, round6(before.sinks.windowVolume + 100), 'and lands in the window total');
  assert.equal(b.float.system.shelf, before.float.system.shelf,
    'but NOT on the shelf — recycling it would put the same unit in two places');
}

// ── 6. WHO IS SPENDING — the agent-vs-human composition (review angle 5) ───────────────────────
{
  const bot = await mk('Agent Smith');
  await pool.query('UPDATE account_persistent SET agent_flag = true WHERE account_id=$1', [bot.acct]);
  await grant(bot.acct, 400);
  await spend(bot.acct, 250, 'intel:tap');           // a sink an EV optimizer genuinely pays for

  const b = await tokenHealth(pool);
  assert.equal(b.sinks.byCohort.agent, 250, 'agent spend is attributed to the agent cohort');
  assert(b.sinks.byCohort.human > 0, 'and human spend to the humans');
  assert.equal(b.players.agents, 1, 'the active count splits the same way');
  assert(b.players.humans >= 4, 'the humans are counted too');
  const tap = b.sinks.topSinks.find((s) => s.reason === 'intel:tap');
  assert(tap && tap.agent === 250 && tap.human === 0,
    'the per-reason breakdown is the useful half: WHICH sinks a cohort pays for');
  // A PER-HEAD RATE NEEDS HEADS. The board refuses to compute one below its significance floor (a
  // "rate" across four people is a portrait of one of them), so the city has to be a city before this
  // property is even reachable. These extra players never spend, so every cohort figure above is
  // unchanged — they exist purely to make the denominator real.
  for (let i = 0; i < 8; i++) await mk(`Bystander ${i}`);
  const c = await tokenHealth(pool);
  assert(c.players.active >= 10, 'the sample now clears the per-head significance floor');

  // and the per-player figure divides by everyone active, agents included — they are real players
  const per = kpiOf(c, 'sinkPerPlayer');
  assert.equal(per.value, Math.round(c.sinks.windowVolume / c.players.active / c.window.days * 100) / 100,
    'sink volume per active player per day');
}

// ── 7. DESK CLEARANCE — driven through the real auction, not asserted into existence ───────────
{
  await pool.query(
    'INSERT INTO vig_buyback (id, eth_spent, omr_bought, price_omr_per_eth, to_reserve, to_prize) VALUES ($1,0,0,1000,0,0)',
    [crypto.randomUUID()]);                          // a fresh print → the band has an anchor
  const opened = await Desk.openAuction(pool);
  assert(opened.opened, `the auction opens with a stocked shelf and a fresh price: ${opened.reason}`);
  const lot = Number((await pool.query('SELECT qty_omr FROM desk_auctions ORDER BY day DESC LIMIT 1')).rows[0].qty_omr);
  // sell a little under half the lot, then close the day
  const buyer = (await pool.query('SELECT account_id FROM account_persistent ORDER BY omr DESC LIMIT 1')).rows[0].account_id;
  const sellQty = Math.floor(lot * 0.4);
  await Desk.recordAuctionBuy(pool, { ref: 'th-fill-1', accountId: buyer, omr: sellQty, txHash: '0xfill' });
  await pool.query("UPDATE desk_auctions SET status='closed', closes_at = now() - interval '1 minute'");

  const b = await tokenHealth(pool);
  assert.equal(b.desk.offered, lot, 'the window offered the whole lot');
  assert.equal(b.desk.sold, sellQty, 'and cleared what really sold');
  const cl = kpiOf(b, 'clearance');
  assert.equal(cl.value, Math.round(sellQty / lot * 1000) / 10, 'clearance is sold over offered');
  assert.equal(cl.state, 'watch', 'a ~40% clearance is a watch, not an all-clear');
}

// ── 8. THE QUEUE IS THE SHOCK GAUGE ────────────────────────────────────────────────────────────
// The full-reserve rail turns a demand shock into a queue rather than insolvency, so a standing
// queue IS the reading. Reuses chain.js's own reserveStatus, so the board and the rail cannot
// disagree about what is outstanding.
{
  const clean = kpiOf(await tokenHealth(pool), 'queue');
  assert.equal(clean.value, 0, 'nothing queued yet');
  await pool.query(
    `INSERT INTO vouchers (id, account_id, kind, amount, nonce, to_address, deadline, status)
     VALUES ($1,$2,'omr',250,9901,$3,9999999999,'queued')`,
    [crypto.randomUUID(), (await pool.query('SELECT account_id FROM account_persistent LIMIT 1')).rows[0].account_id,
      '0x' + 'a'.repeat(40)]);
  const q = kpiOf(await tokenHealth(pool), 'queue');
  assert.equal(q.value, 250, 'the queued (debited but unsigned) $OMR is the depth');
  assert.equal(q.state, 'act', 'a queue with nothing funded behind it is the act band');
}

// ── 9. THE BOARD MOVES NOTHING, AND ONLY A MOD MAY READ IT ────────────────────────────────────
{
  const rows = async () => Number((await pool.query('SELECT COUNT(*) c FROM transactions')).rows[0].c);
  const before = await rows();
  await tokenHealth(pool);
  await tokenHealth(pool, { days: 30 });
  assert.equal(await rows(), before, 'computing the board writes ZERO ledger rows — it is a read');

  const got = await call('GET', '/v1/mod/tokenhealth', { mod: true });
  assert.equal(got.code, 200, 'the mod route serves it');
  assert(Array.isArray(got.body.kpis) && got.body.kpis.length === 5, 'five KPIs');
  for (const k of got.body.kpis) {
    assert(k.threshold && k.why, `"${k.key}" states the reading that would make you act, and why`);
    assert(['ok', 'watch', 'act', 'dormant'].includes(k.state), `"${k.key}" has a legible state`);
  }
  const wide = await call('GET', '/v1/mod/tokenhealth?days=30', { mod: true });
  assert.equal(wide.body.window.days, 30, 'the window widens on request');
  const ungated = await app.inject({ method: 'GET', url: '/v1/mod/tokenhealth' });
  assert(ungated.statusCode >= 400, 'no mod key, no board');
}

// ── 8. THE LAUNCH-HOUR LIE — a sample of one must not read as a healthy city ────────────────────
// Block 1 proves an EMPTY world reads dormant. This proves the harder case: a world with data in it
// that is far too thin to judge. The numbers below are the ones actually measured against the code
// before the significance floors existed — one player, a 5 $OMR float, one spend — which produced
// `velocity 52.14, band ok`. The assertion is not that the value is different; it is that the board
// declines to answer AND says why, because a founder reading "ok" on launch day is the failure.
{
  const fresh = await buildServer();
  try {
    const one = await (async () => {
      const g = await fresh.inject({ method: 'POST', url: '/v1/auth/guest', headers: { 'content-type': 'application/json' }, payload: {} });
      const tok = g.json().token;
      await fresh.inject({ method: 'POST', url: '/v1/character',
        headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, payload: { name: 'Only Soul' } });
      return (await fresh.pool.query('SELECT account_id FROM account_persistent LIMIT 1')).rows[0].account_id;
    })();
    await fresh.pool.query('UPDATE account_persistent SET omr = 5 WHERE account_id=$1', [one]);
    await ledger(fresh.pool, { accountId: one, currency: 'omr', amount: -5, reason: 'estate:tier' });

    const h = await tokenHealth(fresh.pool);
    assert.equal(h.players.active, 1, 'exactly one player, which is the point');
    assert(h.float.player.total < 1000, 'and a float far below anything meaningful');
    assert(h.sinks.windowVolume > 0, 'a real sink DID happen — this is not the empty-world case');

    for (const key of ['velocity', 'sinkPerPlayer', 'committedShare']) {
      const k = h.kpis.find((x) => x.key === key);
      assert.equal(k.value, null, `${key} declines to answer on a sample of one`);
      assert.equal(k.state, 'dormant', `${key} says dormant, not a band`);
      assert(/too thin to judge/.test(k.reads),
        `${key} must SAY why it is silent — a blank reads like a bug, and the founder needs the reason`);
    }
    // and the floors are per-denominator: the reason names the float for a per-token ratio and the
    // headcount for a per-head rate. Getting these crossed would be a threshold chosen to be strict
    // rather than to match the thing it bounds.
    assert(/player float/.test(h.kpis.find((x) => x.key === 'velocity').reads),
      'velocity is a per-TOKEN rate, so its floor is the float');
    assert(/active player/.test(h.kpis.find((x) => x.key === 'sinkPerPlayer').reads),
      'sink-per-player is a per-HEAD rate, so its floor is the headcount');
  } finally { await fresh.close(); }
}

console.log('tokenhealth: a fresh database reads DORMANT rather than crying wolf; velocity divides by the PLAYER float (never the house pools it grows); a transfer is not a sink and a withdrawal is; the agent/human split names WHICH sinks each cohort pays for; clearance is driven through a real auction; the queue is the shock gauge off chain.js own reserveStatus; and the whole board writes zero ledger rows behind the mod key.');
process.exit(0);

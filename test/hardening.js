// M5 hardening test: the §10.4 invariant job over an organically-earned economy
// (zero SQL cash seeding), drift detection, idempotency keys, invite codes,
// X OAuth + guest upgrade, season rollover (§8), and §10.2 rate limits
// (human burst / agent 1-per-3s / swap 6-per-minute). Runs on pg-mem.
process.env.RATE_LIMIT = 'off';           // flipped on for the rate-limit section
process.env.RATE_HUMAN_PER_SEC = '0.5';   // slow refill so bursts are observable
process.env.RATE_HUMAN_BURST = '8';
process.env.MOD_KEY = 'test-mod-key';
process.env.JWT_SECRET = 'test-jwt-secret-for-the-hardening-suite'; // pinned so the token-algorithm
                                                                   // section can hand-sign with it

import assert from 'node:assert';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildServer } from '../src/server.js';
import { runLedgerInvariants, alertDrift } from '../src/invariants.js';
import { runSeasonRollover } from '../src/worker.js';
import { deadlockToRetry as G_deadlockToRetry, withCharacterRead } from '../src/game.js';

// audit (process): the two codices (canonical docs/WIKI.md + served public/wiki.html) drifted — a
// system landed in one but not the other. This drift-detector fails if a system this audit re-synced
// falls out of EITHER, so a future doc edit can't silently desync them again.
{
  const wm = readFileSync(new URL('../docs/WIKI.md', import.meta.url), 'utf8').toLowerCase();
  const wh = readFileSync(new URL('../public/wiki.html', import.meta.url), 'utf8').toLowerCase();
  for (const term of ['spread the word', 'family tree', 'opportunity', '/agents',
    'dueling circuit', 'clue scrolls', 'megaproject', 'cellphone',
    'ring poker', 'house window', 'gala', 'the family yield', 'the trades', 'my profile',
    'the black book', 'word on the street']) {
    assert(wm.includes(term), `docs/WIKI.md must document "${term}" (codex drift)`);
    assert(wh.includes(term), `public/wiki.html must document "${term}" (codex drift)`);
  }
}

const app = await buildServer();
const pool = app.pool;
const modH = { 'x-mod-key': 'test-mod-key' };
const call = async (method, url, { token, body, headers } = {}) => {
  const res = await app.inject({ method, url, payload: body,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers || {}) } });
  return { code: res.statusCode, body: res.json(), headers: res.headers };
};
const meOf = async (token) => (await call('GET', '/v1/me', { token })).body.character;
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);
const mk = async (name, body = {}) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest', { body });
  await call('POST', '/v1/character', { token, body: { name, ...body } });
  return { token, id: (await meOf(token)).id };
};

// ═══════ §10.4 — an economy earned entirely through ledgered faucets ═══════
// Stats/respect/energy get seeded (they aren't currency); cash/cb/ammo/$OMR never are.
const boss = await mk('Avon B');
const rival = await mk('Marlo S');
await seedCh(boss.id, "respect=25000, muscle=100, cunning=50, speed=50, energy=200, nerve=60, loc='docks'");
await seedCh(rival.id, "respect=1000, energy=200, nerve=60, loc='docks'");

let r = await call('POST', '/v1/heist', { token: boss.token });
assert.equal(r.code, 200, 'boss heist');
r = await call('POST', '/v1/heist', { token: rival.token });
assert.equal(r.code, 200, 'rival heist');

// crimes until the boss holds crates (cb faucet) — high-tier jobs pay the war chest
for (let i = 0; i < 60; i++) {
  await seedCh(boss.id, 'nerve=60, energy=200, jail_until=NULL, health=100');
  await call('POST', '/v1/crimes/fixfight', { token: boss.token });
  const m = await meOf(boss.token);
  if (m.cash > 150000 && m.cb >= 4) break;
}
let m = await meOf(boss.token);
assert(m.cash > 60000 && m.cb >= 1, `earned a bankroll organically (cash ${m.cash}, cb ${m.cb})`);

assert.equal((await call('POST', '/v1/gangs', { token: boss.token, body: { name: 'Barksdale Org', tag: 'BO' } })).code, 200);
assert.equal((await call('POST', '/v1/gangs/tribute', { token: boss.token, body: { amount: 31000 } })).code, 200);
await pool.query(`UPDATE districts SET npc_holder=NULL WHERE id='docks'`); // World step five: this hardening flow just needs a seizable district (bypass the NPC occupation)
assert.equal((await call('POST', '/v1/districts/docks/seize', { token: boss.token })).code, 200);

// garage: boost two, melt one (tithe), fence one
let cars = [];
for (let i = 0; i < 120 && cars.length < 2; i++) {
  await seedCh(boss.id, 'gta_at=NULL, energy=200, jail_until=NULL');
  const b = await call('POST', '/v1/garage/boost', { token: boss.token });
  if (b.body.success) cars = b.body.character.cars;
}
assert.equal(cars.length, 2, 'two cars boosted');
assert.equal((await call('POST', `/v1/garage/${cars[0].id}/melt`, { token: boss.token })).code, 200);
assert.equal((await call('POST', `/v1/garage/${cars[1].id}/fence`, { token: boss.token })).code, 200);

// armory + exchange + bounty + jump + swap + stake + mission
assert.equal((await call('POST', '/v1/armory/gun/lastresort/buy', { token: boss.token })).code, 200);
assert.equal((await call('POST', '/v1/armory/ammo', { token: boss.token })).code, 200);
r = await call('POST', '/v1/exchange/list', { token: boss.token, body: { kind: 'ammo', qty: 40, unitPrice: 10 } });
assert.equal(r.code, 200, 'ammo lot listed');
assert.equal((await call('POST', `/v1/exchange/${r.body.listingId}/buy`, { token: rival.token })).code, 200, 'rival bought the lot');
assert.equal((await call('POST', `/v1/streets/${rival.id}/bounty`, { token: boss.token, body: { amount: 500 } })).code, 200);
await seedCh(boss.id, 'energy=200, jail_until=NULL, health=100');
r = await call('POST', `/v1/streets/${rival.id}/jump`, { token: boss.token });
assert.equal(r.code, 200, 'jump resolved');
assert.equal(r.body.bounty || 0, 0, 'a bounty never pays its own poster');
// Staking is exercised elsewhere; it is skipped here deliberately. This file's whole point is that
// its economy is EARNED — nothing SQL-seeded — so the §10.4 sweep must come back drift-0. Since
// tokenomics v2 step 2 there is no in-game way to earn $OMR at this scale (bonds are real ETH), so
// granting some to stake would put unledgered $OMR in the buckets and break exactly the invariant
// this scenario exists to prove.
await seedCh(boss.id, 'muscle=100');
assert.equal((await call('POST', '/v1/missions/m1', { token: boss.token })).code, 200);

// death path: the Commission retires the rival (open bounty clears, estate burns).
// audit H1: the estate now ledgers the EXACT cash+bank (not a floored integer), so fractional
// bank interest isn't destroyed unledgered at death. tools/sim.js is the end-to-end regression —
// it kills characters holding interest-accrued (ledgered) fractional bank and asserts drift-0.
assert.equal((await call('POST', '/v1/mod/kill', { body: { characterId: rival.id }, headers: modH })).code, 200);
assert.equal((await meOf(rival.token)).generation, 2, 'heir stood up');

// audit M2: mod/confiscate clamps to [0, pocket] — a NEGATIVE amount must not mint cash or drain
// the street-tax pool (it was truthy, so `cash - (-x)` credited the player). Tested against the
// boss's REAL earned cash (no unledgered SQL seed) so the §10.4 sweep below stays meaningful.
const bossCashPre = Number((await meOf(boss.token)).cash);
const poolPre = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
let cf = await call('POST', '/v1/mod/confiscate', { body: { characterId: boss.id, amount: -100000 }, headers: modH });
assert.equal(cf.body.confiscated, 0, 'a negative confiscation is clamped to zero — no mint');
assert.equal(Number((await meOf(boss.token)).cash), bossCashPre, 'the player gained nothing');
assert.equal(Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool), poolPre, 'the street-tax pool was not drained');
if (bossCashPre >= 100) { // a normal (ledgered) confiscation still works
  cf = await call('POST', '/v1/mod/confiscate', { body: { characterId: boss.id, amount: 100 }, headers: modH });
  assert.equal(cf.body.confiscated, 100, 'a normal confiscation seizes the amount');
  assert.equal(Number((await meOf(boss.token)).cash), bossCashPre - 100, 'debited from pocket');
}

// the sweep: every bucket reconciles to the ledger exactly
let inv = await runLedgerInvariants(pool, { alert: false });
assert(inv.ok, `§10.4 invariants hold: ${JSON.stringify(inv.checks.filter((c) => !c.ok))}`);

// drift detection: an unledgered mint must trip the character-cash check + alert.
// THIS ONE ALERTS ON PURPOSE — it is the only place in the suite that proves the alarm actually
// fires (the telemetry row asserted three lines down). Everywhere else passes `{alert: false}`,
// because the suites seed by SQL and every sweep was printing a red 🚨 banner on a GREEN run — 140
// of them, which is precisely how a real drift alarm goes unnoticed in CI.
await seedCh(boss.id, 'cash = cash + 12345');
inv = await runLedgerInvariants(pool);
assert(!inv.ok, 'drift detected');
assert(inv.checks.find((c) => c.name === 'character cash' && !c.ok), 'the right check tripped');
assert(Number((await pool.query("SELECT COUNT(*) n FROM telemetry WHERE event='invariant_drift'")).rows[0].n) >= 1, 'drift alert recorded');
await seedCh(boss.id, 'cash = cash - 12345');
assert((await runLedgerInvariants(pool, { alert: false })).ok, 'clean again after revert');

// (red-team R21) prove drift detection for the $OMR bucket too — the extraction-backing currency, not just
// cash. An unledgered $OMR mint (bucket up, no `mint` ledger row) MUST trip the $OMR conservation check; this
// validates the omrBuckets reconstruction actually detects a leak (else a miscoded RHS could pass forever).
const bossAcct = (await pool.query(`SELECT account_id a FROM characters WHERE id='${boss.id}'`)).rows[0].a;
await pool.query(`UPDATE account_persistent SET omr = omr + 777 WHERE account_id='${bossAcct}'`);
inv = await runLedgerInvariants(pool, { alert: false });
assert(!inv.ok && inv.checks.find((c) => c.name === '$OMR conservation' && !c.ok), 'an unledgered $OMR mint trips the $OMR conservation check');
await pool.query(`UPDATE account_persistent SET omr = omr - 777 WHERE account_id='${bossAcct}'`);
assert((await runLedgerInvariants(pool, { alert: false })).ok, '$OMR clean again after revert');

// ═══════ idempotency keys (§5) ═══════
const idemKey = { 'idempotency-key': 'dep-001' };
const r1 = await call('POST', '/v1/bank/deposit', { token: boss.token, body: { amount: 100 }, headers: idemKey });
assert.equal(r1.code, 200, 'first deposit');
const bankAfter = r1.body.character.bank;
const r2 = await call('POST', '/v1/bank/deposit', { token: boss.token, body: { amount: 100 }, headers: idemKey });
assert.equal(r2.code, 200, 'replay returns the stored response');
assert.equal(r2.headers['x-idempotent-replay'], 'true', 'flagged as replay');
assert.equal(r2.body.character.bank, bankAfter, 'identical body');
assert.equal(Math.floor((await meOf(boss.token)).bank), Math.floor(bankAfter), 'deposited exactly once');

// ═══════ invite codes (closed alpha) ═══════
process.env.INVITE_MODE = 'on';
assert.equal((await call('POST', '/v1/auth/guest', {})).code, 400, 'no code, no entry');
r = await call('POST', '/v1/mod/invites', { body: { count: 2, uses: 1 }, headers: modH });
assert.equal(r.code, 200); assert.equal(r.body.codes.length, 2, 'codes minted');
const code = r.body.codes[0];
assert.equal((await call('POST', '/v1/auth/guest', { body: { inviteCode: code } })).code, 200, 'valid code enters');
assert.equal((await call('POST', '/v1/auth/guest', { body: { inviteCode: code } })).code, 400, 'single-use code spent');
process.env.INVITE_MODE = 'off';

// ═══════ real OAuth (§4): X login + guest upgrade, provider APIs stubbed ═══════
// X sign-in is the confused-deputy stopgap — OFF until an operator explicitly enables it
assert.equal((await call('POST', '/v1/auth/x', { body: { token: 'good-x-token' } })).body.error, 'provider_unavailable', 'X sign-in refused until explicitly enabled');
process.env.X_TRUST_USER_TOKEN = 'on';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('api.x.com/2/users/me')) {
    const tok = opts?.headers?.authorization || '';
    if (tok.includes('good-x-token')) return { ok: true, json: async () => ({ data: { id: 'x-user-42' } }) };
    if (tok.includes('other-x-token')) return { ok: true, json: async () => ({ data: { id: 'x-user-99' } }) };
    return { ok: false, json: async () => ({}) };
  }
  return realFetch(url, opts);
};
assert.equal((await call('POST', '/v1/auth/x', { body: { token: 'bad-token' } })).code, 400, 'X rejects bad tokens');
const x1 = await call('POST', '/v1/auth/x', { body: { token: 'good-x-token' } });
assert.equal(x1.code, 200, 'X sign-in'); assert.equal(x1.body.created, true, 'new account');
const x2 = await call('POST', '/v1/auth/x', { body: { token: 'good-x-token' } });
assert.equal(x2.body.created, false, 'same identity, same account');
assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM accounts WHERE auth_provider='x'")).rows[0].n), 1, 'one X account');
// guest upgrade preserves the character
const up = await mk('Guest Gus');
const gusId = up.id;
assert.equal((await call('POST', '/v1/auth/upgrade', { token: up.token, body: { provider: 'x', token: 'good-x-token' } })).code, 400, 'identity already linked elsewhere');
assert.equal((await call('POST', '/v1/auth/upgrade', { token: up.token, body: { provider: 'x', token: 'other-x-token' } })).code, 200, 'guest upgraded');
assert.equal((await meOf(up.token)).id, gusId, 'possessions survive the upgrade');
assert.equal((await call('POST', '/v1/auth/privy', { body: { token: 'whatever' } })).code, 400, 'privy unconfigured → clean error');
globalThis.fetch = realFetch;
delete process.env.X_TRUST_USER_TOKEN;

// ═══════ season rollover (§8) ═══════
await seedCh(boss.id, 'season = season - 1'); // boss is level ~51 → floor(lvl/2) prestige
const prestigeBefore = (await meOf(boss.token)).prestige;
const lvlBefore = (await meOf(boss.token)).level;
const season = await runSeasonRollover(pool);
assert(season.converted >= 1, 'stale-season characters converted');
m = await meOf(boss.token);
assert.equal(m.respect, 0, 'respect reset for the new season');
assert.equal(m.prestige, prestigeBefore + Math.floor(lvlBefore / 2), 'level converted to prestige');
assert(Number((await pool.query("SELECT COUNT(*) n FROM telemetry WHERE event='season_convert'")).rows[0].n) >= 1, 'conversion telemetered');
assert((await runLedgerInvariants(pool, { alert: false })).ok, 'invariants still hold after rollover');

// ═══════ rate limits (§10.2) — flipped on for this section ═══════
process.env.RATE_LIMIT = 'on';
// human bucket: burst 8 (test config). Character creation ate 1 token → 7 left.
const human = await mk('Hasty Harry');
let limited = null;
for (let i = 0; i < 8; i++) {
  const d = await call('POST', '/v1/bank/deposit', { token: human.token, body: { amount: 1 } });
  if (d.code === 429) { limited = d; break; }
}
assert(limited, 'human burst exhausted → 429');
assert.equal(limited.body.error, 'rate_limited');
assert(Number(limited.headers['retry-after']) >= 1, 'Retry-After header set');
// agent keys: 1 action per 3 s, hard — the second immediate call bounces
const agentBase = await mk('Agent Smith');
const ak = await call('POST', '/v1/auth/agent-key', { token: agentBase.token });
assert.equal(ak.code, 200, 'agent key minted');
assert.equal((await pool.query(`SELECT agent_flag FROM account_persistent WHERE account_id = (SELECT account_id FROM characters WHERE id='${agentBase.id}')`)).rows[0].agent_flag, true, 'agent_flag permanent');
const agentToken = ak.body.token;
assert.equal((await call('POST', '/v1/bank/deposit', { token: agentToken, body: { amount: 1 } })).code, 200, 'agent action 1');
assert.equal((await call('POST', '/v1/bank/deposit', { token: agentToken, body: { amount: 1 } })).code, 429, 'agent action 2 inside 3s → 429');
// swap bucket: 6/min on top of the account bucket
const swapper = await mk('Swappy');
await seedCh(swapper.id, 'cash=1000000');
let swapLimited = null;
for (let i = 0; i < 7; i++) {
  const s = await call('POST', '/v1/swap', { token: swapper.token, body: { direction: 'buy', amount: 500 } });
  if (s.code === 429) { swapLimited = { at: i + 1, res: s }; break; }
  // the SWAP ITSELF is retired (400), but this is testing the swap RATE BUCKET, which sits in a
  // preHandler ahead of the handler — so the call still counts against the limiter either way, and
  // the seventh in a minute must still be throttled. That is the property under test, not the trade.
  assert.equal(s.code, 400, `swap ${i + 1} reaches the handler (and is refused as retired)`);
}
assert(swapLimited && swapLimited.at === 7, 'the seventh swap in a minute → 429');
process.env.RATE_LIMIT = 'off';

// ── LIVE-OPS dashboard endpoints (mod-gated overview + activity feed) ──
assert.equal((await call('GET', '/v1/mod/overview')).code, 401, 'the ops overview needs the mod key');
const ov = (await call('GET', '/v1/mod/overview', { headers: modH })).body;
assert(ov.players.accounts >= 1 && ov.players.alive >= 1, 'overview counts accounts + living streets');
assert(ov.economy.ammPrice > 0, 'overview reads the AMM spot ($/$OMR)');
assert(ov.economy.omrSupply >= 20000, 'overview reads the true $OMR supply (≥ the 20k genesis)');
assert(Array.isArray(ov.top.players) && Array.isArray(ov.top.gangs), 'overview carries the leaderboards');
const act = (await call('GET', '/v1/mod/activity?limit=10', { headers: modH })).body;
assert(Array.isArray(act.events), 'the activity feed returns events');
assert.equal((await call('GET', '/v1/mod/activity')).code, 401, 'the activity feed needs the mod key');

// ── THE AGENT GATEWAY: machine discovery — keyless, auto-derived, never drifts from live routes ──
const oa = (await call('GET', '/openapi.json')).body;
assert.equal(oa.openapi, '3.1.0', 'openapi 3.1 doc');
assert(Object.keys(oa.paths).length > 100, 'the spec enumerates every mounted route');
assert(oa.paths['/v1/rules']?.get && oa.paths['/v1/character/mint']?.post, 'key routes are in the spec');
assert.deepEqual(oa.paths['/v1/rules'].get.security, [], '/v1/rules is advertised keyless');
assert.deepEqual(oa.paths['/v1/character/mint'].post.security, [{ bearerAuth: [] }], 'player routes require the bearer');
// audit F1: the moderator surface is NOT advertised in the public contract
assert(!Object.keys(oa.paths).some((p) => p.startsWith('/v1/mod')), 'no /v1/mod route appears in the public spec');
assert(!oa.components.securitySchemes.modKey, 'the x-mod-key header is not disclosed in the spec');
assert(oa.components.securitySchemes.bearerAuth, 'the bearer scheme is declared');
// audit F2: security is DERIVED from the real preHandler, not a URL heuristic — a keyless public
// route reads as keyless, an authed route as bearer, purely from what the route actually mounts
assert.deepEqual(oa.paths['/v1/catalog'].get.security, [], 'a keyless route (real preHandler) reads keyless');
assert.deepEqual(oa.paths['/v1/opportunities'].get.security, [{ bearerAuth: [] }], 'an authed route (real preHandler) reads bearer');
const ag = await app.inject({ method: 'GET', url: '/agents' }); // markdown, not JSON — raw inject
assert(ag.statusCode === 200 && /text\/markdown/.test(ag.headers['content-type']) && /agent-key/.test(ag.body), 'the agent guide serves at /agents');
assert.equal((await app.inject({ method: 'GET', url: '/AGENTS.md' })).statusCode, 200, 'the conventional AGENTS.md filename serves too');
const lt = await app.inject({ method: 'GET', url: '/llms.txt' });
assert(lt.statusCode === 200 && /\/openapi\.json/.test(lt.body) && /\/agents/.test(lt.body), 'llms.txt indexes the machine surfaces');

// ── THE OPPORTUNITY BOARD + THE AGENT LEADERBOARD (the agent economy) ──
const agtGuest = (await call('POST', '/v1/auth/guest')).body.token;
const agtToken = (await call('POST', '/v1/auth/agent-key', { token: agtGuest })).body.token;
await call('POST', '/v1/character', { token: agtToken, body: { name: 'Machine Malone' } });
const opp = (await call('GET', '/v1/opportunities', { token: agtToken })).body;
assert(opp.niches && Array.isArray(opp.niches.arbitrage) && opp.niches.arbitrage.length > 0, 'the opportunity board computes cross-district arbitrage spreads');
assert(opp.niches.arbitrage[0].buyIn && opp.niches.arbitrage[0].sellIn && opp.niches.arbitrage[0].spread >= 0, 'each arbitrage row names a buy/sell district + spread');
assert(Array.isArray(opp.opportunities) && opp.counts, 'the board carries the ranked opportunities');
// (red-team C1) This asserted `niches.laundering.ammSpot` was a number — which stayed TRUE for a
// whole release after cash → $OMR was retired, because a stale niche still has a shape. Presence is
// not the property that matters here. What matters is that the board an agent is told to POLL never
// points at a route that only ever answers `retired`: an agent has no way to tell a dead niche from
// a live one except by burning calls on it.
assert(!opp.niches.laundering, 'the retired laundering niche is gone, not merely reshaped');
assert(opp.niches.redemption && typeof opp.niches.redemption.rate === 'number',
  'and the window that replaced it is what the board advertises');
assert(!JSON.stringify(opp.niches).includes('/v1/swap'),
  'no niche sends an agent to a retired route — the whole point of the board is that it is actionable');
const agLb = (await call('GET', '/v1/leaderboard/agents', { token: agtToken })).body;
assert(Array.isArray(agLb.agents) && agLb.agents.some((a) => a.name === 'Machine Malone'), 'the agent leaderboard lists agent_flag players');
// audit: liquid is published as a BAND, not an exact figure (so a hunter can't compute precise kill-EV)
assert(agLb.agents.every((a) => typeof a.wealthBand === 'string' && typeof a.omrBand === 'string' && a.netWorth === undefined), 'agents carry banded wealth (no exact net worth leaked)');

// ── ITEM ART route: a generated PHOTO per catalog entry when one shipped (public/art/<kind>-<id>.jpg),
// else the procedural SVG emblem (cosmetic; keyless; must never 500). The catalog art pass covers every
// car/boat/drug/gun/vest/good, so on a checkout with the art present nearly all of these are photos —
// but the test accepts EITHER shape per id, because the route's contract is "an image, never a 500",
// not "these exact bytes", and a fresh clone without the jpgs must still pass. ──
const { CARS: ARC, PORT: ARP, DRUGS: ARD, GUNS: ARG, VESTS: ARV, GOODS: ARGD } = await import('../src/rules.js');
const artCats = { car: ARC, boat: ARP.BOATS, drug: ARD, gun: ARG, vest: ARV, good: ARGD };
let artCount = 0, photoCount = 0;
for (const [kind, list] of Object.entries(artCats)) {
  for (const it of list) {
    const res = await app.inject({ method: 'GET', url: `/v1/art/${kind}/${encodeURIComponent(it.id)}` });
    assert.equal(res.statusCode, 200, `art ${kind}/${it.id} → 200`);
    if (res.headers['content-type'] === 'image/jpeg') {
      // a photo: real JPEG bytes (SOI marker), not an error body with an image header
      assert.equal(res.rawPayload[0], 0xFF, `art ${kind}/${it.id} photo has JPEG magic`);
      assert.equal(res.rawPayload[1], 0xD8, `art ${kind}/${it.id} photo has JPEG magic`);
      photoCount++;
    } else {
      assert.equal(res.headers['content-type'], 'image/svg+xml; charset=utf-8', `art ${kind}/${it.id} is SVG or JPEG, nothing else`);
      assert(/^<svg[\s\S]*<\/svg>$/.test(res.body.trim()), `art ${kind}/${it.id} is a well-formed <svg>`);
      assert(!/undefined|NaN/.test(res.body), `art ${kind}/${it.id} carries no undefined/NaN`);
    }
    artCount++;
  }
}
// unknown id + unknown kind both fall back to a neutral emblem, never a 500 (a broken <img> is harmless)
assert.equal((await app.inject({ method: 'GET', url: '/v1/art/car/nonesuch' })).statusCode, 200, 'unknown item id → 200 emblem');
assert.equal((await app.inject({ method: 'GET', url: '/v1/art/widget/x' })).statusCode, 200, 'unknown kind → 200 emblem');
assert(artCount >= 100, `every catalog item (${artCount}) rendered an icon`);
// with the shipped art present, the photos must actually be REACHED (a broken photo-first lookup that
// silently fell through to SVG for everything would otherwise read as a pass)
const artShipped = (await import('node:fs')).existsSync(new URL('../public/art/car-milk.jpg', import.meta.url));
if (artShipped) assert(photoCount >= 100, `the shipped catalog photos are actually served (${photoCount} photos)`);

// ── THE BROADCAST: shareable noir cards + public profile + frictionless ?ref attribution ──
// PUBLIC + keyless + read-only; a card must never 500, never leak an exact dollar figure, never emit undefined/NaN.
{
  const bGuest = (await call('POST', '/v1/auth/guest')).body.token;
  await call('POST', '/v1/character', { token: bGuest, body: { name: 'Broadcast Bruno' } });
  const me = await meOf(bGuest);
  await seedCh(me.id, "respect=1700, season_kills=3, wanted_until=NOW()+interval '1 day'");
  // (1) the safe public dossier — real fields, NEVER an exact wealth number
  const dj = await call('GET', '/v1/u/Broadcast%20Bruno');
  assert.equal(dj.code, 200, 'dossier → 200');
  assert.equal(dj.body.found, true, 'dossier finds the living bearer by name');
  assert.equal(dj.body.name, 'Broadcast Bruno', 'dossier carries the name');
  assert(typeof dj.body.level === 'number' && dj.body.wanted === true, 'dossier bands rank/level + flags');
  assert(typeof dj.body.hitmanRank === 'string' && dj.body.hitmanRank.length > 0, 'dossier resolves the assassin rank title (not undefined)');
  assert(dj.body.cash === undefined && dj.body.bank === undefined && dj.body.omr === undefined, 'dossier NEVER leaks an exact wealth figure (anti precise-kill-EV)');
  // (2) the cards — every type is well-formed SVG with no undefined/NaN
  for (const t of ['legend', 'wanted', 'whacked', 'join']) {
    const c = await app.inject({ method: 'GET', url: `/card/${t}/${encodeURIComponent('Broadcast Bruno')}` });
    assert.equal(c.statusCode, 200, `card ${t} → 200`);
    assert(/^<svg[\s\S]*<\/svg>\s*$/.test(c.body.trim()), `card ${t} is a well-formed <svg>`);
    // Scan the MARKUP, not the embedded photo. The cards now carry their background plate as a
    // base64 data URI, and ~250KB of [A-Za-z0-9+/] is near-certain to contain the literal three
    // characters "NaN" — every one of the four plates does. The check's intent has always been
    // "no undefined/NaN reached rendered TEXT"; an opaque binary payload is not rendered text, and
    // leaving it in scope makes this fail for a reason that has nothing to do with the card.
    // Strip the payloads and assert on what a reader actually sees.
    const markup = c.body.replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g, 'data:PLATE');
    assert(markup.includes('data:PLATE'), `card ${t} embeds its background plate`);
    assert(!/undefined|NaN/.test(markup), `card ${t} carries no undefined/NaN`);
    assert.equal(c.headers['content-type'], 'image/svg+xml; charset=utf-8', `card ${t} served as SVG`);
  }
  // (2b) the PNG variant — X/feeds won't unfurl an SVG; resvg rasterizes it (falls back to SVG if absent)
  const cp = await app.inject({ method: 'GET', url: `/card/legend/${encodeURIComponent('Broadcast Bruno')}.png` });
  assert.equal(cp.statusCode, 200, 'card .png → 200');
  const ct = cp.headers['content-type'];
  assert(/image\/(png|svg\+xml)/.test(ct), 'card .png is a PNG (or SVG fallback when no rasterizer)');
  if (/image\/png/.test(ct)) {                          // resvg present → real PNG magic bytes
    const buf = cp.rawPayload || Buffer.from(cp.body, 'binary');
    assert(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47, 'the .png body is a valid PNG');
  }
  // (3) the public profile page — OG unfurl tags + the referral CTA carrying the sharer's name
  const p = await app.inject({ method: 'GET', url: '/u/Broadcast%20Bruno' });
  assert.equal(p.statusCode, 200, 'profile page → 200');
  assert(/text\/html/.test(p.headers['content-type']), 'profile served as HTML');
  assert(p.body.includes('og:image') && p.body.includes('/card/legend/') && p.body.includes('.png'), 'profile declares the OG unfurl image (PNG variant)');
  assert(p.body.includes('ENTER THE CITY') && p.body.includes('?ref=Broadcast%20Bruno'), 'profile CTA carries the sharer as referral');
  // (4) an unknown name falls back cleanly — never a 500 (a bad share link is harmless)
  const uk = await call('GET', '/v1/u/Nobody%20Here');
  assert.equal(uk.code, 200, 'unknown dossier → 200');
  assert.equal(uk.body.found, false, 'unknown dossier reports not-found');
  assert.equal((await app.inject({ method: 'GET', url: '/card/legend/Nobody%20Here' })).statusCode, 200, 'unknown card → 200 (join fallback)');
  assert.equal((await app.inject({ method: 'GET', url: '/u/Nobody%20Here' })).statusCode, 200, 'unknown profile → 200 (join the city)');
  assert.equal((await app.inject({ method: 'GET', url: '/card/bogus/Broadcast%20Bruno' })).statusCode, 200, 'unknown card type → 200 (falls back to legend, never breaks a share)');
  // (5) SECURITY — these are PUBLIC keyless routes. An oversized ?ref (query, so NOT bounded by
  //     Fastify's URI cap the way a giant :name path is) is clamped before render, so it can't inflate
  //     the SVG / make resvg rasterize a giant string / poison the PNG cache. And any HTML/SVG
  //     metacharacter in the name is escaped (no injection into the SVG/HTML output).
  // Measured as a DELTA against a normal ref, not against an absolute byte budget. The budget was a
  // proxy — it worked only while a card was ~2KB of markup, and broke the moment cards started
  // embedding a background plate as a base64 data URI (~260KB of fixed payload that has nothing to do
  // with the ref). The delta measures the actual claim: an oversized ?ref must not inflate the render.
  // server.js clips a ref to 48 chars, so a clamped 5000-char ref can add at most ~48 bytes; an
  // unclamped one adds ~5000.
  const refBase = await app.inject({ method: 'GET', url: '/card/legend/Bob?ref=Al' });
  const hc = await app.inject({ method: 'GET', url: `/card/legend/Bob?ref=${'B'.repeat(5000)}` });
  assert.equal(hc.statusCode, 200, 'oversized ?ref → 200 (clamped, no crash)');
  const grew = hc.body.length - refBase.body.length;
  assert(grew < 200, `oversized ?ref is clamped before render (grew ${grew}b over a normal ref, not ~5000)`);
  const xss = '<script>alert(1)</script>';
  const xc = await app.inject({ method: 'GET', url: `/card/legend/${encodeURIComponent(xss)}` });
  assert.equal(xc.statusCode, 200, 'injection name → 200');
  assert(!xc.body.includes('<script>'), 'the card escapes HTML/SVG metacharacters (no raw <script>)');
  const xp = await app.inject({ method: 'GET', url: `/u/${encodeURIComponent(xss)}?ref=${encodeURIComponent(xss)}` });
  assert(!xp.body.includes('<script>alert'), 'the profile page escapes the name + ref (no injection)');
}

// ── PRESENCE + THE TROLL BOX (founder overnight list): the keyless online counter, the public
// city box + the family-only room (member-gated), server-side sanitization + the length clamp,
// and the flood brake. Zero §10.4 surface (talk moves no value). ──
{
  const on = await app.inject({ method: 'GET', url: '/v1/online' });
  assert.equal(on.statusCode, 200, 'online counter is keyless');
  const ob = on.json();
  assert(typeof ob.online === 'number' && typeof ob.active15m === 'number', 'online counter shape');

  const talker = await mk('Chatty Vinnie');
  const lurker = await mk('Quiet Sal');
  let r = await call('POST', '/v1/chat', { token: talker.token, body: { text: '  <b>ayo</b> the city hears me ' } });
  assert.equal(r.code, 200, 'city chat accepts a line');
  r = await call('GET', '/v1/chat', { token: lurker.token });
  assert.equal(r.code, 200, 'anyone can read the city box');
  const line = r.body.messages.find((m) => m.who === 'Chatty Vinnie');
  assert(line, 'the line landed in the city box');
  assert(!line.text.includes('<') && line.text.includes('ayo'), 'server-side cleanText strips markup');
  r = await call('POST', '/v1/chat', { token: talker.token, body: { text: 'double tap' } });
  assert.equal(r.code, 400, 'the flood brake refuses'); assert.equal(r.body.error, 'slow_down');
  r = await call('POST', '/v1/chat', { token: talker.token, body: { text: '' } });
  assert.equal(r.code, 400, 'an empty line is refused'); assert.equal(r.body.error, 'empty');
  r = await call('POST', '/v1/gangs/chat', { token: talker.token, body: { text: 'family biz' } });
  assert.equal(r.code, 400, 'no family → no family room');
  assert.equal(r.body.error, 'no_gang');
  r = await call('GET', '/v1/gangs/chat', { token: talker.token });
  assert.deepEqual(r.body.messages, [], 'gangless family-room read is empty, not an error');
}

// ── THE CELLPHONE — the personal inbox + player-to-player DMs (founder request). Pure talk,
// zero §10.4 (no transactions row ever); account-keyed threads; troll-box discipline (cleanText
// + 240 clamp + flood brake); the inbox PEEK never flips `delivered` (that's the WS backfill's). ──
{
  const caller = await mk('Louie the Line');
  const callee = await mk('Frankie Dial');
  // STREET LIFE (the black book): numbers are DISCOVERABLE — a stranger's line refuses the dial
  let r = await call('POST', `/v1/phone/dm/${callee.id}`, { token: caller.token, body: { text: 'cold call' } });
  assert.equal(r.body.error, 'no_number', "you can't dial a number you don't hold");
  // seed the line ONE WAY (the real earn paths — a meeting / a wiretap — are covered in the
  // STREET LIFE block below; this block is about the phone itself)
  const acctOf = async (cid) => (await pool.query('SELECT account_id FROM characters WHERE id=$1', [cid])).rows[0].account_id;
  await pool.query("INSERT INTO contacts (owner_account, contact_account, how) VALUES ($1,$2,'met')",
    [await acctOf(caller.id), await acctOf(callee.id)]);
  // send: sanitized, lands, rings the recipient's inbox
  r = await call('POST', `/v1/phone/dm/${callee.id}`, { token: caller.token, body: { text: '  <b>meet me</b> at the docks at nine ' } });
  assert.equal(r.code, 200, 'a DM sends once you hold the number');
  // gates: self / empty / unknown number / flood brake
  r = await call('POST', `/v1/phone/dm/${caller.id}`, { token: caller.token, body: { text: 'hello me' } });
  assert.equal(r.body.error, 'self', 'no messaging your own line');
  r = await call('POST', `/v1/phone/dm/${callee.id}`, { token: caller.token, body: { text: '' } });
  assert.equal(r.body.error, 'empty', 'an empty message is refused');
  r = await call('POST', '/v1/phone/dm/no-such-character', { token: caller.token, body: { text: 'yo' } });
  assert.equal(r.body.error, 'gone', 'an unknown number is refused');
  r = await call('POST', `/v1/phone/dm/${callee.id}`, { token: caller.token, body: { text: 'double tap' } });
  assert.equal(r.body.error, 'slow_down', 'the DM flood brake refuses a 2s double-tap');
  // the recipient's board: one thread, one unread, the sanitized preview, replyable
  r = await call('GET', '/v1/phone', { token: callee.token });
  assert.equal(r.code, 200, 'the phone board reads');
  assert.equal(r.body.unreadDm, 1, 'one unread DM waiting');
  const th = r.body.threads.find((t) => t.name === 'Louie the Line');
  assert(th && th.unread === 1 && th.replyable, 'the thread shows the sender, unread, replyable');
  assert(!th.last.text.includes('<') && th.last.text.includes('meet me'), 'cleanText stripped the markup');
  // the inbox PEEK carries the dm ring WITHOUT flipping delivered (the WS backfill owns that flag)
  const ring = r.body.inbox.find((n) => n.type === 'dm');
  assert(ring && ring.payload.from === 'Louie the Line', 'the dm notification rings the inbox');
  const undeliv = await pool.query(
    "SELECT COUNT(*) c FROM notifications n JOIN characters c2 ON c2.id=n.character_id WHERE c2.id=$1 AND n.type='dm' AND NOT n.delivered", [callee.id]);
  assert.equal(Number(undeliv.rows[0].c), 1, 'the phone PEEK did not mark the notification delivered');
  // reading the thread marks seen; reply flows back
  r = await call('GET', `/v1/phone/thread/${caller.id}`, { token: callee.token });
  assert.equal(r.code, 200, 'the thread reads');
  assert.equal(r.body.messages.length, 1, 'one message in the thread');
  assert.equal(r.body.messages[0].fromMe, false, 'their line, not mine');
  r = await call('GET', '/v1/phone', { token: callee.token });
  assert.equal(r.body.unreadDm, 0, 'reading the thread cleared the unread count');
  r = await call('POST', `/v1/phone/dm/${caller.id}`, { token: callee.token, body: { text: 'nine it is' } });
  assert.equal(r.code, 200, 'the reply sends');
  r = await call('GET', `/v1/phone/thread/${callee.id}`, { token: caller.token });
  assert.equal(r.body.messages.length, 2, 'both sides of the conversation');
  assert(r.body.messages[1].fromMe === false && r.body.messages[1].text === 'nine it is', 'the reply landed in order');
  // zero §10.4 surface: the whole exchange wrote NO transactions rows
  const tx = await pool.query(
    'SELECT COUNT(*) c FROM transactions WHERE character_id IN ($1,$2)', [caller.id, callee.id]);
  assert.equal(Number(tx.rows[0].c), 0, 'the phone moved no value — zero ledger rows');

  // ── STEP TWO: BLOCKED LINES (a fresh pair — the flood brake stays clean) ──
  const pest = await mk('Petey Pest');
  const mark = await mk('Marie the Mark');
  await pool.query("INSERT INTO contacts (owner_account, contact_account, how) VALUES ($1,$2,'met')",
    [await acctOf(pest.id), await acctOf(mark.id)]);
  r = await call('POST', `/v1/phone/dm/${mark.id}`, { token: pest.token, body: { text: 'hey. hey. answer me' } });
  assert.equal(r.code, 200, 'the pest gets one message in');
  r = await call('POST', `/v1/phone/block/${pest.id}`, { token: mark.token });
  assert.equal(r.code, 200, 'the mark blocks the line');
  assert.equal(r.body.blocked, 'Petey Pest', 'the block names who got blocked');
  r = await call('POST', `/v1/phone/dm/${mark.id}`, { token: pest.token, body: { text: 'why no answer' } });
  assert.equal(r.body.error, 'blocked', 'a blocked sender gets the dead tone (before the flood brake)');
  r = await call('POST', `/v1/phone/dm/${pest.id}`, { token: mark.token, body: { text: 'testing' } });
  assert.equal(r.body.error, 'you_blocked', 'the blocker cannot message the blocked line either');
  // the board surfaces it: the thread flags blocked + the blocks list carries the name
  r = await call('GET', '/v1/phone', { token: mark.token });
  const bth = r.body.threads.find((t) => t.name === 'Petey Pest');
  assert(bth && bth.blocked === true, 'the thread shows BLOCKED');
  assert(r.body.blocks.some((bl) => bl.name === 'Petey Pest' && bl.characterId === pest.id), 'the blocks list names the line');
  // thread view: replyable false while blocked (history stands)
  r = await call('GET', `/v1/phone/thread/${pest.id}`, { token: mark.token });
  assert(r.body.with.blocked === true && r.body.with.replyable === false, 'a blocked thread reads but cannot reply');
  assert.equal(r.body.messages.length, 1, 'blocking never deletes history');
  // self / unknown / double-unblock gates
  r = await call('POST', `/v1/phone/block/${mark.id}`, { token: mark.token });
  assert.equal(r.body.error, 'self', 'no blocking your own line');
  r = await call('DELETE', `/v1/phone/block/${pest.id}`, { token: mark.token });
  assert.equal(r.code, 200, 'unblock lifts it');
  r = await call('DELETE', `/v1/phone/block/${pest.id}`, { token: mark.token });
  assert.equal(r.body.error, 'not_blocked', 'a second unblock is a clean refusal');
  // the line works again (the pest's brake armed at the first landed send, long since elapsed —
  // his blocked attempts never armed it; still, wait out the 2s brake to keep this deterministic)
  await new Promise((res) => setTimeout(res, 2100));
  r = await call('POST', `/v1/phone/dm/${mark.id}`, { token: pest.token, body: { text: 'thank you' } });
  assert.equal(r.code, 200, 'an unblocked line takes calls again');
}

// ── STREET LIFE (task #318): THE BLACK BOOK (numbers are DISCOVERABLE — a meeting hands both
// sides the other's number; intel earns it one-way) + THE CALL (an NPC contact rings with a paid
// request settled from THEIR OWN pocket — a pure two-leg ledgered transfer, zero new faucet). ──
{
  const A = await mk('Book Keeper');
  const B = await mk('Face Unknown');
  const acctOf2 = async (cid) => (await pool.query('SELECT account_id FROM characters WHERE id=$1', [cid])).rows[0].account_id;
  // strangers hold nothing
  let r = await call('GET', '/v1/contacts', { token: A.token });
  assert.equal(r.code, 200, 'the black book reads');
  assert.equal(r.body.contacts.length, 0, 'a fresh book is empty');
  // A MEETING — any COMPLETED two-party action (a jump, win or lose) — is MUTUAL: both walk away
  // with the other's number (the ONE hook in withTwoCharacters)
  await seedCh(A.id, "energy=200, nerve=60, loc='docks'");
  await seedCh(B.id, "loc='docks'");
  r = await call('POST', `/v1/streets/${B.id}/jump`, { token: A.token, body: {} });
  assert.equal(r.code, 200, 'the jump completes (either outcome is a meeting)');
  r = await call('GET', '/v1/contacts', { token: A.token });
  const lineB = r.body.contacts.find((c) => c.street && c.street.id === B.id);
  assert(lineB && lineB.how === 'met', "the jumper holds the mark's number (how: met)");
  r = await call('GET', '/v1/contacts', { token: B.token });
  assert(r.body.contacts.some((c) => c.street && c.street.id === A.id),
    "the MARK holds the jumper's number too — a meeting is mutual");
  r = await call('POST', `/v1/phone/dm/${B.id}`, { token: A.token, body: { text: 'nothing personal' } });
  assert.equal(r.code, 200, 'met → the line dials');
  // blocks precede the number gate: a blocked STRANGER hears the dead tone, not "no number"
  const S = await mk('Total Stranger');
  r = await call('POST', `/v1/phone/block/${S.id}`, { token: B.token });
  assert.equal(r.code, 200, 'B blocks the stranger');
  r = await call('POST', `/v1/phone/dm/${B.id}`, { token: S.token, body: { text: 'let me in' } });
  assert.equal(r.body.error, 'blocked', 'a block is a harder truth than a missing number');

  // ── THE CALL — seed an NPC resident contact (the population INSERT shape) ──
  const npcAcct = crypto.randomUUID(), npcId = crypto.randomUUID();
  await pool.query("INSERT INTO accounts (id, auth_provider, auth_subject) VALUES ($1,'npc',$2)", [npcAcct, `npc:${npcAcct}`]);
  await pool.query('INSERT INTO account_persistent (account_id, npc_flag) VALUES ($1,true)', [npcAcct]);
  await pool.query(
    `INSERT INTO characters (id, account_id, name, is_npc, season, respect, cash, muscle, cunning, speed, loc, health, energy, nerve)
     VALUES ($1,$2,'Old Mo the Grocer',true,0,1000,40000,10,10,10,'canal',100,50,10)`, [npcId, npcAcct]);
  const { generateContactCalls, sweepCalls } = await import('../src/contacts.js');
  // no contact → no call (a stranger's grocer never rings you)
  r = await generateContactCalls(pool, { characterId: A.id, npcCharacterId: npcId, kind: 'freight', goodId: 'gin', qty: 2 });
  assert.equal(r.placed, 0, 'a contact you have not met never calls');
  await pool.query("INSERT INTO contacts (owner_account, contact_account, how) VALUES ($1,$2,'met')", [await acctOf2(A.id), npcAcct]);
  r = await generateContactCalls(pool, { characterId: A.id, npcCharacterId: npcId, kind: 'freight', goodId: 'gin', qty: 2 });
  assert.equal(r.placed, 1, 'a met NPC contact places a call');
  // one open call per street — the PK refuses a second
  r = await generateContactCalls(pool, { characterId: A.id, npcCharacterId: npcId, kind: 'visit' });
  assert.equal(r.placed, 0, 'one open call per street (the PK is the cap)');
  // the board carries it, addressed to where the CONTACT stands
  r = await call('GET', '/v1/contacts', { token: A.token });
  const cc = r.body.call;
  assert(cc && cc.from === 'Old Mo the Grocer' && cc.kind === 'freight' && cc.qty === 2 && cc.district === 'canal', 'the open call rides the board');
  assert(cc.pay > 0 && cc.expiresSeconds > 0, 'priced + clocked');
  // fulfil gates: wrong district → travel; empty trunk → short
  await seedCh(A.id, "loc='docks', cash=200000");
  r = await call('POST', '/v1/call/fulfill', { token: A.token });
  assert.equal(r.body.error, 'district', 'the errand is LOCATED — travel to them first');
  await seedCh(A.id, "loc='canal'");
  r = await call('POST', '/v1/call/fulfill', { token: A.token });
  assert.equal(r.body.error, 'short', 'you must be carrying what they asked for');
  r = await call('POST', '/v1/goods/buy', { token: A.token, body: { goodId: 'gin', qty: 2 } });
  assert.equal(r.code, 200, 'stock the trunk');
  const cashBefore = (await meOf(A.token)).cash;
  const npcCashBefore = Number((await pool.query('SELECT cash FROM characters WHERE id=$1', [npcId])).rows[0].cash);
  r = await call('POST', '/v1/call/fulfill', { token: A.token });
  assert.equal(r.code, 200, 'the freight settles');
  assert.equal(r.body.kind, 'freight');
  assert.equal(r.body.pay, cc.pay, 'paid what was quoted');
  assert.equal((await meOf(A.token)).cash, cashBefore + cc.pay, 'the cash landed');
  // the goods changed hands + the pay came from the CONTACT's own pocket (recycle-only)
  const npcCargo = Number((await pool.query("SELECT COALESCE(SUM(qty),0) n FROM character_cargo WHERE character_id=$1 AND good_id='gin'", [npcId])).rows[0].n);
  assert.equal(npcCargo, 2, 'the freight reached the contact');
  const npcCashAfter = Number((await pool.query('SELECT cash FROM characters WHERE id=$1', [npcId])).rows[0].cash);
  assert.equal(npcCashAfter, npcCashBefore - cc.pay, "paid from the contact's own pocket");
  // §10.4: the two legs are a PURE TRANSFER — they net to zero
  const net = await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason LIKE 'contact:%'");
  assert.equal(Number(net.rows[0].s), 0, 'contact:* legs net to zero — a transfer, never a faucet');
  r = await call('POST', '/v1/call/fulfill', { token: A.token });
  assert.equal(r.body.error, 'no_call', 'the settled call is gone');
  // a VISIT call + the broke-void (robbed blind since they rang → the job is off, nothing moves)
  r = await generateContactCalls(pool, { characterId: A.id, npcCharacterId: npcId, kind: 'visit' });
  assert.equal(r.placed, 1, 'a visit call places');
  await pool.query('UPDATE characters SET cash=0 WHERE id=$1', [npcId]);
  r = await call('POST', '/v1/call/fulfill', { token: A.token });
  assert.equal(r.body.error, 'broke', 'a turned-over contact voids the request');
  // expiry: a lapsed request fades (the sweep) and cannot be settled
  await pool.query('UPDATE characters SET cash=40000 WHERE id=$1', [npcId]);
  await generateContactCalls(pool, { characterId: A.id, npcCharacterId: npcId, kind: 'visit' });
  await pool.query('UPDATE contact_calls SET expires_at=now() - interval \'1 hour\' WHERE character_id=$1', [A.id]);
  r = await call('POST', '/v1/call/fulfill', { token: A.token });
  assert.equal(r.body.error, 'no_call', 'a lapsed request cannot be settled');
  r = await sweepCalls(pool);
  assert(r.swept >= 1, 'the sweep reaps lapsed requests');
}

// ── ONE-CLICK X SIGN-IN (OAuth2 PKCE redirect) — dormant without env; configured: /start mints a
// single-use state + authorize URL, the callback rejects unknown/replayed states with a clean
// fragment redirect (the token/e­rror rides the URL FRAGMENT, never a query the server would log). ──
{
  let r = await call('POST', '/v1/auth/x/start', { body: {} });
  assert.equal(r.body.error, 'oauth_unconfigured', 'dormant without X_CLIENT_ID + PUBLIC_URL');
  process.env.X_CLIENT_ID = 'test-client-id';
  process.env.PUBLIC_URL = 'https://omerta.example';
  const rules = await call('GET', '/v1/rules');
  assert.equal(rules.body.auth.xOAuth, true, 'the rules surface flips on with the env');
  r = await call('POST', '/v1/auth/x/start', { body: { inviteCode: 'ABC' } });
  assert.equal(r.code, 200, 'start mints an authorize URL');
  const u = new URL(r.body.url);
  assert.equal(u.hostname, 'x.com', 'authorize lives on x.com');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256', 'PKCE S256');
  assert(u.searchParams.get('redirect_uri').endsWith('/v1/auth/x/callback'), 'the registered callback path');
  const state = u.searchParams.get('state');
  const row = (await pool.query('SELECT purpose, invite FROM oauth_states WHERE state=$1', [state])).rows[0];
  assert(row && row.purpose === 'login' && row.invite === 'ABC', 'the state row persists the PKCE context');
  // an AUTHED start binds the state to the guest account (the claim-in-place upgrade path)
  const ghost = await mk('Oauth Ghost');
  r = await call('POST', '/v1/auth/x/start', { token: ghost.token, body: {} });
  const st2 = new URL(r.body.url).searchParams.get('state');
  const row2 = (await pool.query('SELECT purpose, account_id FROM oauth_states WHERE state=$1', [st2])).rows[0];
  assert(row2.purpose === 'upgrade' && row2.account_id, 'an authed start binds the guest for upgrade');
  // /start browser-binds the state in an HttpOnly cookie (anti account-linking CSRF)
  r = await call('POST', '/v1/auth/x/start', { body: {} });
  const setC = r.headers['set-cookie'];
  assert(setC && /omerta_oauth=[^;]+;.*HttpOnly/i.test(Array.isArray(setC) ? setC.join(';') : setC), 'start sets the HttpOnly binding cookie');
  const boundState = new URL(r.body.url).searchParams.get('state');
  // the callback WITHOUT the matching cookie is refused (a CSRF'd victim never carries it)
  let cb = await app.inject({ method: 'GET', url: `/v1/auth/x/callback?code=zzz&state=${boundState}` });
  assert.equal(cb.statusCode, 302, 'callback redirects home');
  assert(cb.headers.location.includes('#autherr=oauth_session'), 'no matching cookie → CSRF-guard refusal');
  // an unknown state is refused too (the state check is belt-and-braces behind the cookie)
  cb = await app.inject({ method: 'GET', url: '/v1/auth/x/callback?code=zzz&state=not-a-state',
    headers: { cookie: 'omerta_oauth=not-a-state' } });
  assert(cb.headers.location.includes('#autherr=oauth_state'), 'unknown state (with cookie) → clean fragment error');
  delete process.env.X_CLIENT_ID; delete process.env.PUBLIC_URL;
}

// ── X INTEGRATIONS BULLETPROOF (mocked X API) — the full callback exchange, upgrade + identity
// collision, transient-vs-definitive error semantics, author binding, follow pagination ──
{
  const realFetch = globalThis.fetch;
  const jres = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const xmock = {};
  globalThis.fetch = async (url, opts) => {
    const s = String(url);
    if (s.includes('api.x.com/2/oauth2/token')) return xmock.token(s, opts);
    if (s.includes('api.x.com/2/users/me')) return xmock.me(s, opts);
    if (s.includes('/following')) return xmock.following(s, opts);
    if (s.includes('api.x.com/2/tweets/')) return xmock.tweet(s, opts);
    return realFetch(url, opts);
  };
  try {
    process.env.X_CLIENT_ID = 'test-client-id';
    process.env.PUBLIC_URL = 'https://omerta.example';
    // (1) the FULL sign-in: start → X redirects back → server exchanges the code → #token lands
    xmock.token = () => jres(200, { access_token: 'tok-abc' });
    xmock.me = () => jres(200, { data: { id: '777' } });
    let r = await call('POST', '/v1/auth/x/start', { body: {} });
    let state = new URL(r.body.url).searchParams.get('state');
    let cb = await app.inject({ method: 'GET', url: `/v1/auth/x/callback?code=ok&state=${state}`,
      headers: { cookie: `omerta_oauth=${state}` } });
    assert(cb.headers.location.includes('#token='), 'a real exchange lands a signed session token');
    const xToken = decodeURIComponent(cb.headers.location.split('#token=')[1]);
    const sess = await call('GET', '/v1/session', { token: xToken });
    assert.equal(sess.body.provider, 'x', 'the minted session is the X identity');
    // REPLAY the same callback → the state was consumed (single-use, DELETE-returning)
    cb = await app.inject({ method: 'GET', url: `/v1/auth/x/callback?code=ok&state=${state}`,
      headers: { cookie: `omerta_oauth=${state}` } });
    assert(cb.headers.location.includes('#autherr=oauth_state'), 'a replayed callback finds no state');
    // (2) the guest UPGRADE: an authed start claims-in-place; the same X id can never claim twice
    const claimer = await mk('Claim Kid');
    xmock.me = () => jres(200, { data: { id: '888' } });
    r = await call('POST', '/v1/auth/x/start', { token: claimer.token, body: {} });
    state = new URL(r.body.url).searchParams.get('state');
    cb = await app.inject({ method: 'GET', url: `/v1/auth/x/callback?code=ok&state=${state}`,
      headers: { cookie: `omerta_oauth=${state}` } });
    assert(cb.headers.location.includes('#claimed=x'), 'the guest is upgraded in place');
    assert.equal((await call('GET', '/v1/session', { token: claimer.token })).body.provider, 'x',
      'same account row, now an X identity');
    const rival = await mk('Second Claimer');
    r = await call('POST', '/v1/auth/x/start', { token: rival.token, body: {} });
    state = new URL(r.body.url).searchParams.get('state');
    cb = await app.inject({ method: 'GET', url: `/v1/auth/x/callback?code=ok&state=${state}`,
      headers: { cookie: `omerta_oauth=${state}` } });
    assert(cb.headers.location.includes('#autherr=linked_elsewhere'), 'one X account, one street — the collision is clean');
    // (3) a transient X failure during the exchange is a clean retryable x_busy, never a 500
    xmock.token = () => jres(500, {});
    r = await call('POST', '/v1/auth/x/start', { body: {} });
    state = new URL(r.body.url).searchParams.get('state');
    cb = await app.inject({ method: 'GET', url: `/v1/auth/x/callback?code=ok&state=${state}`,
      headers: { cookie: `omerta_oauth=${state}` } });
    assert(cb.headers.location.includes('#autherr=x_busy'), 'an X outage mid-exchange reads as busy, not broken');
    // (4) verifyPostUp semantics: transient ≠ definitive (an outage must NEVER read as "post gone")
    process.env.SOCIAL_VERIFY_MODE = 'live';
    process.env.X_BEARER_TOKEN = 'bearer-test';
    const { verifyPostUp, verifySocial } = await import('../src/verify.js');
    const postUrl = 'https://x.com/who/status/12345678901234';
    const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return e.code; } };
    xmock.tweet = () => jres(429, {});
    assert.equal(await errOf(() => verifyPostUp(postUrl)), 'verify_busy', 'a rate limit is BUSY — the registration stands');
    xmock.tweet = () => { throw new Error('network down'); };
    assert.equal(await errOf(() => verifyPostUp(postUrl)), 'verify_busy', 'a network failure is BUSY too');
    xmock.tweet = () => jres(200, { errors: [{ title: 'Not Found' }] });
    assert.equal(await errOf(() => verifyPostUp(postUrl)), 'post_gone', 'a DEFINITIVE not-found is post_gone');
    // author binding: the upgraded account (X id 888) can only be paid for ITS OWN post
    const boundAcct = (await pool.query("SELECT id FROM accounts WHERE auth_provider='x' AND auth_subject='888'")).rows[0];
    xmock.tweet = () => jres(200, { data: { id: '12345678901234', author_id: '999' } });
    assert.equal(await errOf(() => verifyPostUp(postUrl, { client: pool, accountId: boundAcct.id })),
      'not_your_post', "someone else's tweet doesn't pay an X-linked account");
    xmock.tweet = () => jres(200, { data: { id: '12345678901234', author_id: '888' } });
    assert.equal(await verifyPostUp(postUrl, { client: pool, accountId: boundAcct.id }), true, 'their own standing post pays');
    // (5) the follow check PAGINATES (the >1000-follows false-negative fix) + busy semantics
    process.env.X_TARGET_USER_ID = 'TARGET1';
    const acct888 = { auth_provider: 'x', auth_subject: '888' };
    xmock.following = (s) => s.includes('pagination_token=page2')
      ? jres(200, { data: [{ id: 'TARGET1' }] })
      : jres(200, { data: [{ id: 'someone-else' }], meta: { next_token: 'page2' } });
    assert.equal(await verifySocial('ob_x', acct888), true, 'a follow parked on page 2 is FOUND (pagination)');
    xmock.following = () => jres(429, {});
    assert.equal(await errOf(() => verifySocial('ob_x', acct888)), 'verify_busy', 'a rate-limited follow check is BUSY, not "not found"');
    console.log('✓ X integrations: full PKCE exchange + replay, upgrade + identity collision, x_busy transient semantics, post author binding, follow pagination');
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.X_CLIENT_ID; delete process.env.PUBLIC_URL;
    delete process.env.SOCIAL_VERIFY_MODE; delete process.env.X_BEARER_TOKEN; delete process.env.X_TARGET_USER_ID;
  }
}

// ── THE FAMILY ROOM shows no back-chat to a spy who slips in — reads floor at your join time ──
{
  const boss = await mk('Chat Boss');
  await call('POST', '/v1/gangs', { token: boss.token, body: { name: 'The Talkers', tag: 'TT' } });
  await call('POST', '/v1/gangs/chat', { token: boss.token, body: { text: 'war plans for the docks' } });
  await new Promise((r) => setTimeout(r, 10));
  const spy = await mk('Sneaky Spy');
  await call('POST', '/v1/gangs/The%20Talkers/join', { token: spy.token }).catch(() => {});
  // join by id if the name route differs — look the gang up
  const gid = (await pool.query("SELECT id FROM gangs WHERE tag='TT'")).rows[0]?.id;
  if (gid) await call('POST', `/v1/gangs/${gid}/join`, { token: spy.token });
  const spyView = await call('GET', '/v1/gangs/chat', { token: spy.token });
  if (spyView.code === 200) {
    assert(!spyView.body.messages.some((m) => m.text.includes('war plans')), 'a fresh member sees no pre-join family chat');
  }
  await call('POST', '/v1/gangs/chat', { token: boss.token, body: { text: 'new orders' } });
  await new Promise((r) => setTimeout(r, 10));
  const after = await call('GET', '/v1/gangs/chat', { token: spy.token });
  if (after.code === 200 && gid) assert(after.body.messages.some((m) => m.text.includes('new orders')), 'but sees messages from after they joined');
}

// ── AN UNREACHABLE DATABASE SAYS SO — 503 db_down, never 500 internal ──
// The 2026-07-25 incident: every database problem surfaced as `{"error":"internal"}`, which is also
// what a genuine bug looks like, so a tester reporting "Internal on every button" could have been
// either and nobody could tell. These assertions pin BOTH directions — an outage must be legible as an
// outage, and a real bug must NOT be laundered into a reassuring "try again shortly".
{
  const { isDbDown } = await import('../src/dbhealth.js');
  // the shapes node-pg actually produces when Postgres is gone
  for (const e of [
    Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' }),
    Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' }),
    Object.assign(new Error('the database system is starting up'), { code: '57P03' }),
    Object.assign(new Error('sorry, too many clients already'), { code: '53300' }),
    new Error('Connection terminated unexpectedly'),                 // no code at all — text is the only signal
    new Error('timeout exceeded when trying to connect'),
    Object.assign(new Error('all attempts failed'), { errors: [{ code: 'ECONNREFUSED' }] }), // aggregate connect error
    // a stopped Postgres on a UNIX SOCKET raises ENOENT — the socket file is gone. Observed against a
    // real Postgres; the errno alone is far too broad to trust, so it is the syscall that qualifies it.
    Object.assign(new Error('connect ENOENT /var/run/postgresql/.s.PGSQL.5432'), { code: 'ENOENT', syscall: 'connect' }),
  ]) assert(isDbDown(e), `an unreachable database must be recognised: ${e.code || e.message}`);
  // …and a bare ENOENT (a missing file, not a failed connect) is NOT an outage
  assert(!isDbDown(Object.assign(new Error("ENOENT: no such file or directory, open 'x.html'"), { code: 'ENOENT', syscall: 'open' })),
    'a missing FILE is not a database outage');
  // …and everything else stays a bug. Laundering these into "come back later" would hide real defects.
  for (const e of [
    new TypeError("Cannot read properties of undefined (reading 'cash')"),
    Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }),
    Object.assign(new Error('deadlock detected'), { code: '40P01' }),
    Object.assign(new Error('column "nope" does not exist'), { code: '42703' }),
    new Error('something went wrong'),
  ]) assert(!isDbDown(e), `a real bug must NOT be reported as an outage: ${e.code || e.message}`);
  assert(!isDbDown(null) && !isDbDown(undefined), 'a missing error is not an outage');

  // GET /health answers "is it up?" directly, keyless
  const h = await call('GET', '/health');
  assert(h.code === 200 && h.body.ok === true && h.body.db === 'up', 'GET /health reports a reachable database');
  assert(typeof h.body.uptimeSeconds === 'number' && typeof h.body.dbLatencyMs === 'number', '/health carries uptime + latency');

  // and when the database is NOT reachable it reports 503 with a retry hint, not 200 and not 500
  const realQuery = pool.query.bind(pool);
  pool.query = async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); };
  try {
    const down = await call('GET', '/health');
    assert(down.code === 503, `an unreachable database makes /health 503 (got ${down.code})`);
    assert(down.body.ok === false && down.body.db === 'unreachable', '/health names the state');
    assert(down.headers['retry-after'], '/health tells a monitor when to come back');
    // the same on a real game route: 503 db_down, so the client can say something honest
    const act = await call('GET', '/v1/me', { token: boss.token });
    assert(act.code === 503 && act.body.error === 'db_down',
      `a game route reports db_down, not internal (got ${act.code} ${act.body.error})`);
  } finally { pool.query = realQuery; }
  const back = await call('GET', '/health');
  assert(back.code === 200 && back.body.ok === true, '/health recovers when the database does');

  // THE PROCESS MUST SURVIVE THE DATABASE RESTARTING. node-pg emits 'error' on the Pool when an idle
  // connection dies, and an EventEmitter with no 'error' listener THROWS — an uncaught exception that
  // kills Node outright. Verified by stopping a real Postgres under a running server: before the
  // handler the process died with `Unhandled 'error' event: terminating connection due to
  // administrator command`; after it, the server rode out a full stop/start and recovered on its own.
  //
  // This assertion is deliberately SOURCE-LEVEL. The suite runs on pg-mem, whose adapter never raises
  // that event, so no behavioural test here can reach the real code path — but a defect that kills the
  // process on every database bounce is worth a guard against silent deletion even so. The real proof
  // is the stop/start probe against Postgres; this is the tripwire.
  const dbSrc = readFileSync(new URL('../src/db.js', import.meta.url), 'utf8');
  assert(/pool\.on\(\s*['"]error['"]/.test(dbSrc),
    "src/db.js must attach a pool 'error' handler — without it a database restart kills the process");
}

// ── TRANSIENT CONTENTION IS RETRYABLE, A REAL BUG IS NOT ──
// The pool now sets lock_timeout, so a request that waits out a busy row surfaces 55P03 rather than
// queueing on it indefinitely. To a caller that is the same thing as a deadlock: transient, nothing
// committed, safe to retry — so it gets the same clean error rather than a 500.
{
  const lockTimeout = Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
  assert.equal(G_deadlockToRetry(lockTimeout).code, 'contention', 'lock_timeout maps to a clean retryable error');
  assert.equal(G_deadlockToRetry(new TypeError('boom')).constructor, TypeError, 'a real bug is not laundered into contention');
}

// ── THE TOKEN ALGORITHM IS PINNED — and a rejected token is a 401, not a 500 ──
// fast-jwt derives the allowed algorithm set from the KEY when none is given, and a string secret
// admits the whole HMAC family. Measured: before `verify: { algorithms: ['HS256'] }` was set, a token
// hand-signed HS512 with the same secret AUTHENTICATED — the server accepted tokens it never issues.
// Not a break (same secret, HMAC is HMAC), but a needlessly wide door, and one that would swing open
// much further the day someone swaps in an asymmetric key. So the set is pinned in code, and this is
// the regression that notices if the pin is ever dropped.
{
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const g = (await call('POST', '/v1/auth/guest')).body;
  const sub = app.jwt.decode(g.token).sub;
  const exp = Math.floor(Date.now() / 1000) + 3600;

  assert.equal(app.jwt.decode(g.token, { complete: true }).header.alg, 'HS256',
    'tokens are issued HS256 — so pinning HS256 accepts every token already in the wild');

  const body = `${b64({ alg: 'HS512', typ: 'JWT' })}.${b64({ sub, exp })}`;
  const sig = crypto.createHmac('sha512', process.env.JWT_SECRET).update(body).digest('base64url');
  const hs512 = await call('GET', '/v1/me', { token: `${body}.${sig}` });
  assert.equal(hs512.code, 401, 'a valid-signature HS512 token is refused, not authenticated');
  assert.equal(hs512.body.error, 'auth', '…and refused cleanly');

  // the classic. Belt and braces: this was already rejected, and must stay rejected.
  const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, exp })}.`;
  assert.equal((await call('GET', '/v1/me', { token: none })).code, 401, 'alg:none is refused');

  // The rejection must not read as a server fault. FAST_JWT_INVALID_ALGORITHM carries no statusCode,
  // so before the error handler matched the FAST_JWT_/FST_JWT_ family it fell through to `internal` —
  // the one case the pin exists to catch reported itself as a bug in the game.
  assert.notEqual(hs512.code, 500, 'an untrusted token is never a 500');
  for (const bad of ['not.a.jwt', 'zzzz', app.jwt.sign({ sub }, { expiresIn: '-1s' })]) {
    assert.equal((await call('GET', '/v1/me', { token: bad })).code, 401,
      'malformed / garbage / expired tokens all 401 so the client knows to re-authenticate');
  }
}

// ── ARE THE BACKUPS RUNNING? — the health the game could not see about itself ──
// Postgres ships write-ahead-log segments to the backup service. When that stops, the database keeps
// serving perfectly while the ability to RESTORE it rots — invisible from inside the game, and on
// 2026-07-25 invisible to the founder too (twice in one day, evidence only in the host's log stream).
{
  const { archiverHealth } = await import('../src/dbhealth.js');
  // pg-mem has no pg_stat_archiver — the dev default must read as "can't see it", never as broken
  const dev = await archiverHealth(pool);
  assert(dev.state === 'unsupported', `a database without pg_stat_archiver reports unsupported, got ${dev.state}`);

  const fake = (rows) => ({ query: async () => ({ rows }) });
  const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

  // healthy: the last thing that happened was a successful ship
  let h = await archiverHealth(fake([{ archived_count: 900, last_archived_wal: '00000001000000030000000A',
    last_archived_time: iso(60_000), failed_count: 0, last_failed_wal: null, last_failed_time: null }]));
  assert(h.state === 'ok' && h.lastArchivedWal.endsWith('0A') && h.secondsSinceArchived <= 61, 'a shipping archive is ok');

  // FAILING: the newest event is a failure. This is the alarm.
  h = await archiverHealth(fake([{ archived_count: 900, last_archived_wal: 'FD', last_archived_time: iso(600_000),
    failed_count: 12, last_failed_wal: 'FE', last_failed_time: iso(30_000) }]));
  assert(h.state === 'failing' && h.failedCount === 12, 'a failure newer than the last success is FAILING');

  // ...and the same numbers the other way round are NOT an alarm. Postgres retries a stuck segment
  // until it lands, so a HEALED outage leaves its failure timestamps in this view forever — reading
  // last_failed_time alone would alarm about an incident that resolved hours ago. This is exactly what
  // 2026-07-25 looked like after 19:37:36: 12 recorded failures, then a success, then normal service.
  h = await archiverHealth(fake([{ archived_count: 904, last_archived_wal: '000000010000000300000001',
    last_archived_time: iso(30_000), failed_count: 12, last_failed_wal: 'FD', last_failed_time: iso(600_000) }]));
  assert(h.state === 'ok' && h.failedCount === 12, 'a HEALED outage is ok — old failures must not re-alarm');

  // quiet (no writes → no segments) is a note, not an alarm: an idle database ships nothing, correctly
  h = await archiverHealth(fake([{ archived_count: 5, last_archived_wal: 'X', last_archived_time: iso(20 * 3600_000),
    failed_count: 0, last_failed_wal: null, last_failed_time: null }]));
  assert(h.state === 'stale', 'a long-quiet archive is stale, not failing');

  // SWITCHED OFF is not healthy. A database with archive_mode=off has zero failures forever, which
  // the first cut of this read as "ok" — caught by probing a real Postgres that had archiving
  // disabled. "No failures" and "nothing is even being attempted" must never look the same.
  h = await archiverHealth(fake([{ archived_count: 0, last_archived_wal: null, last_archived_time: null,
    failed_count: 0, last_failed_wal: null, last_failed_time: null, archive_mode: 'off' }]));
  assert(h.state === 'off' && h.archiveMode === 'off', `archive_mode=off must report off, got ${h.state}`);
  h = await archiverHealth(fake([{ archived_count: 3, last_archived_wal: 'A', last_archived_time: iso(10_000),
    failed_count: 0, last_failed_wal: null, last_failed_time: null, archive_mode: 'on' }]));
  assert(h.state === 'ok', 'archive_mode=on and shipping is ok');

  // and it must never throw the caller's request away on a database that refuses the view
  const denied = await archiverHealth({ query: async () => { throw new Error('permission denied for view pg_stat_archiver'); } });
  assert(denied.state === 'unsupported', 'a restricted role reports unsupported, not an outage');

  const ov = await call('GET', '/v1/mod/overview', { headers: modH });
  assert(ov.code === 200 && ov.body.backups && ov.body.backups.state, 'the ops dashboard carries backup health');
}

// ── D1: THE LOCK-FREE READ PATH ────────────────────────────────────────────────────────────────
// Reads used to open SELECT … FOR UPDATE on the player's own row and hold it for the whole request,
// so a player's own requests serialized against each other — production caught four of one player's
// queued 1.0s/2.1s/2.3s/4.3s. withCharacterRead accrues in memory with no lock and reports whether
// there is anything to persist; readCharacter falls through to the locked path when there is.
{
  const { body: { token: rt } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token: rt, body: { name: 'Reader Malone' } });
  const rid = (await call('GET', '/v1/me', { token: rt })).body.character.id;
  const acctOf = async () => (await pool.query(`SELECT account_id a FROM characters WHERE id='${rid}'`)).rows[0].a;
  const aid = await acctOf();

  // 1. Nothing accrued → the fast path serves the read itself and returns a character.
  const fast = await withCharacterRead(app.pool, aid, async () => ({}));
  assert(fast && fast.character && fast.character.id === rid, 'a clean read is served without the lock');

  // 2. Accrual moved → it declines, so the caller re-runs under the lock. Backdating the clock is
  //    what an idle player looks like, and it MUST still reach the locked path: §7.1 accrual is
  //    gameplay (it fires the Bureau raid), not something a read may quietly skip.
  await pool.query(`UPDATE characters SET last_accrued_at = now() - interval '30 minutes' WHERE id='${rid}'`);
  const declined = await withCharacterRead(app.pool, aid, async () => ({}));
  assert(declined === null, 'a read with real accrual behind it declines the fast path');

  // …and the route wrapper transparently picks the locked path, so the player still sees the
  //    accrued state — energy regenerates over 30 idle minutes and the row is banked.
  const before = Number((await pool.query(`SELECT energy FROM characters WHERE id='${rid}'`)).rows[0].energy);
  const seen = (await call('GET', '/v1/me', { token: rt })).body.character;
  const after = Number((await pool.query(`SELECT energy FROM characters WHERE id='${rid}'`)).rows[0].energy);
  assert(after > before, 'the delegated read banked the accrual it found');
  assert(seen.energy === after, 'and the view the player saw matches what was persisted');

  // THE CLAIM THAT MATTERS, stated so it cannot quietly stop being true: a read still CHECKPOINTS.
  // The fast path skips the write only when accrue() provably changed nothing, and the fallback
  // persists — so `last_accrued_at` advances on any read with real time behind it, exactly as it did
  // before this path existed. Without this, an idle-but-polling player would drift toward the
  // offline-returner treatment on every time-metered surface (bank interest is capped per BURST as
  // well as per day, and the RICO meter builds from heat sampled at the START of a step), which
  // would be a silent change to signed economy behaviour. It is measured here instead of assumed:
  // an earlier reading of this code concluded the opposite, and only the measurement settled it.
  const stamp = async () => (await pool.query(`SELECT last_accrued_at FROM characters WHERE id='${rid}'`)).rows[0].last_accrued_at;
  await pool.query(`UPDATE characters SET last_accrued_at = now() - interval '20 minutes' WHERE id='${rid}'`);
  const t0 = await stamp();
  await call('GET', '/v1/skills', { token: rt });
  assert(+new Date(await stamp()) > +new Date(t0),
    'a READ with real time behind it advances last_accrued_at — reads still checkpoint accrual');
  // …and one with nothing behind it does not write at all (that is the whole point of the fast path)
  const t1 = await stamp();
  await call('GET', '/v1/skills', { token: rt });
  assert.equal(+new Date(await stamp()), +new Date(t1),
    'a read with nothing to bank leaves the clock alone rather than churning the row');

  // The write guard is a BACKSTOP, so it is probed with forms nobody wrote by hand. MERGE, COPY,
  // SELECT … INTO, setval/nextval, an advisory lock and `SELECT … FOR UPDATE` all slipped past the
  // first version of it. FOR UPDATE is not a write, but with no BEGIN on this path the lock is taken
  // and dropped in the same statement — protection that looks real and is not.
  for (const sql of [
    'MERGE INTO characters USING characters s ON (1=1) WHEN MATCHED THEN UPDATE SET cash=1',
    'COPY characters FROM STDIN',
    'SELECT id INTO tmp_x FROM characters',
    "SELECT setval('s', 1)", "SELECT nextval('s')",
    'SELECT pg_advisory_lock(1)', 'SELECT pg_advisory_xact_lock(1)',
    `SELECT * FROM characters WHERE id='${rid}' FOR UPDATE`,
    'SELECT * FROM characters FOR SHARE',
    'WITH x AS (SELECT 1) INSERT INTO rng_audit SELECT * FROM x',
  ]) {
    let refused = false;
    await withCharacterRead(app.pool, aid, async (_ch, client) => {
      try { await client.query(sql); } catch (e) { refused = /read path attempted a write/.test(e.message); }
      return {};
    });
    assert(refused, `the read path must refuse: ${sql.slice(0, 46)}`);
  }
  // …without refusing legitimate reads, including the shapes that look like writes
  for (const sql of [
    'SELECT 1 AS updated_at, 2 AS last_update',
    `SELECT c.id, g.name FROM characters c LEFT JOIN gangs g ON g.id=c.gang_id WHERE c.id='${rid}'`,
    'SELECT COUNT(*) FROM transactions WHERE reason LIKE $1',
  ]) {
    let ok = true;
    await withCharacterRead(app.pool, aid, async (_ch, client) => {
      try { await client.query(sql, sql.includes('$1') ? ['crime:%'] : undefined); }
      catch (e) { if (/read path attempted a write/.test(e.message)) ok = false; }
      return {};
    });
    assert(ok, `the guard must not refuse a legitimate read: ${sql.slice(0, 46)}`);
  }

  // 3. The write guard is real, not a comment. These routes are registered on the read path only
  //    because they were verified side-effect free; a future edit that writes must fail loudly
  //    rather than commit outside any transaction — there is no BEGIN on this path to roll back.
  let guarded = null;
  try {
    await withCharacterRead(app.pool, aid, async (ch, client) =>
      client.query(`INSERT INTO notifications (id, character_id, type) VALUES ('d1-guard-probe','${rid}','x')`));
  } catch (e) { guarded = e; }
  assert(guarded && /read path attempted a write/.test(guarded.message), 'a write from the read path is refused');
  assert.equal(Number((await pool.query(
    `SELECT COUNT(*) n FROM notifications WHERE id='d1-guard-probe'`)).rows[0].n), 0,
    'and the refused write never landed');

  // 4. A read still SELECTs freely — the guard blocks writes, not queries.
  const read = await withCharacterRead(app.pool, aid, async (ch, client) =>
    ({ n: (await client.query('SELECT 1 AS one')).rows.length }));
  assert(read && read.n === 1, 'the read path can still query');

  // 5. (red-team) A LEADING SELECT does not make a statement a read. An anchored check passes both
  //    of these straight through, which would have made the guard weaker than it reads.
  for (const sneaky of [
    `SELECT 1; INSERT INTO notifications (id, character_id, type) VALUES ('d1-sneak','${rid}','x')`,
    `WITH x AS (SELECT 1) INSERT INTO notifications (id, character_id, type) VALUES ('d1-cte','${rid}','x')`,
  ]) {
    let blocked = null;
    try { await withCharacterRead(app.pool, aid, async (ch, client) => client.query(sneaky)); }
    catch (e) { blocked = e; }
    assert(blocked && /read path attempted a write/.test(blocked.message),
      `the guard sees the write past a leading SELECT: ${sneaky.slice(0, 28)}…`);
  }
  //    …while an ordinary SELECT naming a column like `last_update` is NOT a false positive.
  const ok = await withCharacterRead(app.pool, aid, async (ch, client) =>
    ({ n: (await client.query("SELECT 1 AS updated_at, 2 AS last_update")).rows.length }));
  assert(ok && ok.n === 1, 'a column named like a write keyword is not mistaken for one');

  // 6. (red-team) The guard only protects a route that actually PASSES it. Three read routes were
  //    handing their board the raw `pool` instead — statically write-free, so no bug, but entirely
  //    outside the guard. A source-level tripwire, because that is a wiring mistake, not a runtime one.
  const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8').split('\n');
  const leaks = [];
  for (let i = 0; i < server.length; i++) {
    const m = /app\.get\('([^']+)'/.exec(server[i]);
    if (!m) continue;
    let end = Math.min(i + 14, server.length);
    for (let j = i + 1; j < end; j++) if (/^\s*app\.(get|post|put|delete|patch)\(/.test(server[j])) { end = j; break; }
    const body = server.slice(i, end).join('\n');
    if (!body.includes('readCharacter')) continue;
    const inner = body.slice(body.indexOf('=>', body.indexOf('readCharacter')) + 2);
    for (const c of inner.matchAll(/\b[A-Z][A-Za-z]*\.[a-zA-Z]+\(([^)]*)\)/g))
      if (c[1].split(',').map((a) => a.trim()).includes('pool')) leaks.push(`${m[1]} -> ${c[0]}`);
  }
  assert.equal(leaks.length, 0, `read routes must hand their board the guarded client, not the pool: ${leaks.join(' | ')}`);
}

// ════════════ THE ALARM ACTUALLY REACHES A HUMAN ════════════
// The nightly §10.4 sweep and the backup watchdog POST to INVARIANT_WEBHOOK_URL, and the deploy docs tell
// the founder to point it at Slack or Discord. Both REJECT (400) a body with no `text` / `content`
// respectively, and alertDrift swallows the failure into a console line nobody reads — so the original
// payload of `{alert, failed}` meant a correctly-configured webhook delivered NOTHING, silently, forever.
// This is the whole silent-failure class the drift monitor exists to catch, aimed at the monitor itself.
{
  const { webhookText } = await import('../src/invariants.js');
  const drift = [{ name: 'character cash', lhs: 1477500, rhs: -22500, drift: 1500000, ok: false }];
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return { ok: true }; };
  process.env.INVARIANT_WEBHOOK_URL = 'http://127.0.0.1:1/hook';
  try {
    await alertDrift(pool, drift);
    await alertDrift(pool, [{ name: 'wal archiving off', archiveMode: 'off', note: 'no PITR' }], 'backup');
  } finally { globalThis.fetch = realFetch; delete process.env.INVARIANT_WEBHOOK_URL; }

  assert.equal(sent.length, 2, 'a webhook fires for both the ledger sweep and the backup watchdog');
  for (const { body } of sent) {
    assert(typeof body.text === 'string' && body.text.length > 0,
      'the payload must carry `text` — Slack incoming webhooks 400 without it and the failure is swallowed');
    assert(typeof body.content === 'string' && body.content.length > 0,
      'the payload must carry `content` — Discord webhooks 400 without it and the failure is swallowed');
    assert(body.content.length < 2000, "Discord's hard message limit is 2,000 characters");
    assert(Array.isArray(body.failed), 'the structured fields stay, for anything custom');
  }
  assert(sent[0].body.text.includes('character cash') && sent[0].body.text.includes('1500000'),
    'the message must name the failed check and its drift, or it is a page with no information');
  assert(/BACKUPS ARE NOT RUNNING/.test(sent[1].body.content),
    'the backup alarm must say what is wrong in words the founder can act on');
  // and no `[object Object]`: the archiver shape has no lhs/rhs/drift, so a naive formatter mangles it
  for (const { body } of sent) assert(!/\[object Object\]/.test(body.content), 'no unformatted objects in the message');

  // nothing sent when unconfigured — the var is optional and its absence must not throw
  const before = sent.length;
  globalThis.fetch = async () => { sent.push({ url: 'SHOULD-NOT-HAPPEN' }); return { ok: true }; };
  try { await alertDrift(pool, drift); } finally { globalThis.fetch = realFetch; }
  assert.equal(sent.length, before, 'with no INVARIANT_WEBHOOK_URL set, nothing is posted anywhere');

  // a 4-check drift renders one line per check, so a real page is readable at a glance
  const many = webhookText('ledger', ['a', 'b', 'c', 'd'].map((n) => ({ name: n, lhs: 1, rhs: 0, drift: 1 })));
  assert.equal(many.split('\n').length, 5, 'a header plus one line per failed check');

  // …and the clamp is exercised with a payload that WOULD exceed the limit. The two alerts above are a few
  // hundred characters, so asserting `< 2000` on them passed whether or not a clamp existed — a vacuous
  // check of exactly the kind this file keeps finding. Every named check failing at once is plausible
  // (a corrupt ledger fails all 18 plus every per-currency bucket), and Discord DROPS an over-long
  // message with a 400, so the alarm would go silent precisely when it matters most.
  const flood = webhookText('ledger', Array.from({ length: 300 },
    (_, i) => ({ name: `some quite long check name number ${i}`, lhs: 123456789, rhs: -987654321, drift: 1111111111 })));
  assert(flood.length < 2000, `a 300-check page must be clamped under Discord's limit; got ${flood.length}`);
  assert(flood.endsWith('(truncated)'), 'and it must say it was truncated, not just stop mid-sentence');

  // THE DRILL. Setting INVARIANT_WEBHOOK_URL is otherwise unverifiable — you find out whether it works
  // the night the ledger drifts, which is the worst moment to discover a typo. POST /v1/mod/alert/test
  // fires through this same path so a message landing in the channel proves the whole chain.
  const drill = [];
  globalThis.fetch = async (url, opts) => { drill.push(JSON.parse(opts.body)); return { ok: true }; };
  process.env.INVARIANT_WEBHOOK_URL = 'http://127.0.0.1:1/hook';
  let testRes;
  try {
    testRes = await app.inject({ method: 'POST', url: '/v1/mod/alert/test', headers: { 'x-mod-key': 'test-mod-key' } });
  } finally { globalThis.fetch = realFetch; delete process.env.INVARIANT_WEBHOOK_URL; }
  assert.equal(testRes.statusCode, 200);
  assert.equal(testRes.json().configured, true, 'the route reports whether a webhook is actually configured');
  assert.equal(drill.length, 1, 'the drill posts exactly one message');
  assert(drill[0].text && drill[0].content, 'and it carries both provider keys, like a real alert');
  // A DRILL MUST NOT READ LIKE AN EMERGENCY. The generic formatter renders kind='test' as
  // "🚨 … test invariant drift", which is precisely the message someone would panic at — and the
  // point of a drill is to learn what a real page looks like, so it has to be distinguishable.
  assert(/DRILL/.test(drill[0].content) && !drill[0].content.startsWith('🚨'),
    `the test alert must announce itself as a drill, not impersonate an emergency; got ${JSON.stringify(drill[0].content)}`);

  // mod-gated like every other tool on that perimeter
  assert.equal((await app.inject({ method: 'POST', url: '/v1/mod/alert/test' })).statusCode, 401,
    'the drill is a mod tool — an unauthenticated caller cannot make the founder\'s phone buzz');
}

console.log(`✅ M5 hardening test passed — §10.4 invariant job (zero drift on an earned economy, drift alarm fires), idempotency keys, invite codes, X OAuth + guest upgrade, season rollover, rate limits (human burst / agent 1-per-3s / swap 6-per-min), catalog item art (${artCount} icons — ${photoCount} generated photos, SVG emblem fallback), THE BROADCAST (dossier/cards/profile, no exact-wealth leak, clean fallbacks), PRESENCE + THE TROLL BOX (online counter, city + family-gated chat, sanitized + flood-braked), ONE-CLICK X SIGN-IN (PKCE start/state/callback surface, dormant without env), THE CELLPHONE (DM send/gates/flood brake, threads + unread + seen, inbox peek without flipping delivered, zero ledger rows) + STEP TWO BLOCKED LINES (block/unblock, dead tone both directions, board + thread surfacing, history stands, self/double gates), DB-DOWN LEGIBILITY (503 db_down not 500 internal, GET /health up+down+recovery, real bugs still report as bugs), THE LOCK-FREE READ PATH (D1: a clean read is served without FOR UPDATE, a read with real accrual behind it declines and the route re-runs under the lock so the banked state and the rendered view agree, a read still CHECKPOINTS accrual while a read with nothing to bank leaves the clock alone, and the write guard refuses ten write/lock forms including MERGE, COPY, SELECT-INTO, setval and FOR UPDATE without refusing three legitimate reads), BACKUP HEALTH (pg_stat_archiver: shipping/failing/healed-not-realarming/quiet/unsupported, surfaced on the ops dashboard, and archive_mode=off reads as NOT RUNNING rather than healthy — the worker alerts on both), STREET LIFE (the black book: no_number gate, a jump-meeting is mutual, blocks precede the number gate; THE CALL: contact-only generation, one-open-call PK, located freight fulfilment paid from the contact's own pocket — contact:* legs net to zero, broke-void, expiry sweep)`);
await app.close();

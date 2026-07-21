// M5 hardening test: the §10.4 invariant job over an organically-earned economy
// (zero SQL cash seeding), drift detection, idempotency keys, invite codes,
// X OAuth + guest upgrade, season rollover (§8), and §10.2 rate limits
// (human burst / agent 1-per-3s / swap 6-per-minute). Runs on pg-mem.
process.env.RATE_LIMIT = 'off';           // flipped on for the rate-limit section
process.env.RATE_HUMAN_PER_SEC = '0.5';   // slow refill so bursts are observable
process.env.RATE_HUMAN_BURST = '8';
process.env.MOD_KEY = 'test-mod-key';

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { buildServer } from '../src/server.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { runSeasonRollover } from '../src/worker.js';

// audit (process): the two codices (canonical docs/WIKI.md + served public/wiki.html) drifted — a
// system landed in one but not the other. This drift-detector fails if a system this audit re-synced
// falls out of EITHER, so a future doc edit can't silently desync them again.
{
  const wm = readFileSync(new URL('../docs/WIKI.md', import.meta.url), 'utf8').toLowerCase();
  const wh = readFileSync(new URL('../public/wiki.html', import.meta.url), 'utf8').toLowerCase();
  for (const term of ['spread the word', 'family tree', 'opportunity', '/agents']) {
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
await seedCh(boss.id, "respect=10000, muscle=100, cunning=50, speed=50, energy=200, nerve=60, loc='docks'");
await seedCh(rival.id, "respect=400, energy=200, nerve=60, loc='docks'");

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
assert.equal((await call('POST', '/v1/swap', { token: boss.token, body: { direction: 'buy', amount: 1000 } })).code, 200);
assert.equal((await call('POST', '/v1/stake', { token: boss.token, body: { amount: 0.5 } })).code, 200);
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
let inv = await runLedgerInvariants(pool);
assert(inv.ok, `§10.4 invariants hold: ${JSON.stringify(inv.checks.filter((c) => !c.ok))}`);

// drift detection: an unledgered mint must trip the character-cash check + alert
await seedCh(boss.id, 'cash = cash + 12345');
inv = await runLedgerInvariants(pool);
assert(!inv.ok, 'drift detected');
assert(inv.checks.find((c) => c.name === 'character cash' && !c.ok), 'the right check tripped');
assert(Number((await pool.query("SELECT COUNT(*) n FROM telemetry WHERE event='invariant_drift'")).rows[0].n) >= 1, 'drift alert recorded');
await seedCh(boss.id, 'cash = cash - 12345');
assert((await runLedgerInvariants(pool)).ok, 'clean again after revert');

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
assert((await runLedgerInvariants(pool)).ok, 'invariants still hold after rollover');

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
  assert.equal(s.code, 200, `swap ${i + 1} fills`);
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
assert(Array.isArray(opp.opportunities) && opp.counts && typeof opp.niches.laundering.ammSpot === 'number', 'the board carries the ranked opportunities + AMM spot');
const agLb = (await call('GET', '/v1/leaderboard/agents', { token: agtToken })).body;
assert(Array.isArray(agLb.agents) && agLb.agents.some((a) => a.name === 'Machine Malone'), 'the agent leaderboard lists agent_flag players');
// audit: liquid is published as a BAND, not an exact figure (so a hunter can't compute precise kill-EV)
assert(agLb.agents.every((a) => typeof a.wealthBand === 'string' && typeof a.omrBand === 'string' && a.netWorth === undefined), 'agents carry banded wealth (no exact net worth leaked)');

// ── ITEM ART route: one procedural SVG per catalog entry (cosmetic; keyless; must never 500) ──
const { CARS: ARC, PORT: ARP, DRUGS: ARD, GUNS: ARG, VESTS: ARV, GOODS: ARGD } = await import('../src/rules.js');
const artCats = { car: ARC, boat: ARP.BOATS, drug: ARD, gun: ARG, vest: ARV, good: ARGD };
let artCount = 0;
for (const [kind, list] of Object.entries(artCats)) {
  for (const it of list) {
    const res = await app.inject({ method: 'GET', url: `/v1/art/${kind}/${encodeURIComponent(it.id)}` });
    assert.equal(res.statusCode, 200, `art ${kind}/${it.id} → 200`);
    assert(/^<svg[\s\S]*<\/svg>$/.test(res.body.trim()), `art ${kind}/${it.id} is a well-formed <svg>`);
    assert(!/undefined|NaN/.test(res.body), `art ${kind}/${it.id} carries no undefined/NaN`);
    assert.equal(res.headers['content-type'], 'image/svg+xml; charset=utf-8', `art ${kind}/${it.id} is served as SVG`);
    artCount++;
  }
}
// unknown id + unknown kind both fall back to a neutral emblem, never a 500 (a broken <img> is harmless)
assert.equal((await app.inject({ method: 'GET', url: '/v1/art/car/nonesuch' })).statusCode, 200, 'unknown item id → 200 emblem');
assert.equal((await app.inject({ method: 'GET', url: '/v1/art/widget/x' })).statusCode, 200, 'unknown kind → 200 emblem');
assert(artCount >= 100, `every catalog item (${artCount}) rendered an icon`);

// ── THE BROADCAST: shareable noir cards + public profile + frictionless ?ref attribution ──
// PUBLIC + keyless + read-only; a card must never 500, never leak an exact dollar figure, never emit undefined/NaN.
{
  const bGuest = (await call('POST', '/v1/auth/guest')).body.token;
  await call('POST', '/v1/character', { token: bGuest, body: { name: 'Broadcast Bruno' } });
  const me = await meOf(bGuest);
  await seedCh(me.id, "respect=680, season_kills=3, wanted_until=NOW()+interval '1 day'");
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
    assert(!/undefined|NaN/.test(c.body), `card ${t} carries no undefined/NaN`);
    assert.equal(c.headers['content-type'], 'image/svg+xml; charset=utf-8', `card ${t} served as SVG`);
  }
  // (3) the public profile page — OG unfurl tags + the referral CTA carrying the sharer's name
  const p = await app.inject({ method: 'GET', url: '/u/Broadcast%20Bruno' });
  assert.equal(p.statusCode, 200, 'profile page → 200');
  assert(/text\/html/.test(p.headers['content-type']), 'profile served as HTML');
  assert(p.body.includes('og:image') && p.body.includes('/card/legend/'), 'profile declares the OG unfurl image');
  assert(p.body.includes('ENTER THE CITY') && p.body.includes('?ref=Broadcast%20Bruno'), 'profile CTA carries the sharer as referral');
  // (4) an unknown name falls back cleanly — never a 500 (a bad share link is harmless)
  const uk = await call('GET', '/v1/u/Nobody%20Here');
  assert.equal(uk.code, 200, 'unknown dossier → 200');
  assert.equal(uk.body.found, false, 'unknown dossier reports not-found');
  assert.equal((await app.inject({ method: 'GET', url: '/card/legend/Nobody%20Here' })).statusCode, 200, 'unknown card → 200 (join fallback)');
  assert.equal((await app.inject({ method: 'GET', url: '/u/Nobody%20Here' })).statusCode, 200, 'unknown profile → 200 (join the city)');
  assert.equal((await app.inject({ method: 'GET', url: '/card/bogus/Broadcast%20Bruno' })).statusCode, 200, 'unknown card type → 200 (falls back to legend, never breaks a share)');
}

console.log(`✅ M5 hardening test passed — §10.4 invariant job (zero drift on an earned economy, drift alarm fires), idempotency keys, invite codes, X OAuth + guest upgrade, season rollover, rate limits (human burst / agent 1-per-3s / swap 6-per-min), procedural item art (${artCount} icons, SVG-valid, emblem fallback), THE BROADCAST (dossier/cards/profile, no exact-wealth leak, clean fallbacks)`);
await app.close();

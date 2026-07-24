import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import crypto from 'node:crypto';
import { makeDb } from './db.js';
import * as G from './game.js';
import * as E from './economy.js';
import * as S from './social.js';
import * as K from './kitchen.js';
import * as W from './growth.js';
import * as A from './auth.js';
import * as Chain from './chain.js';
import * as Fees from './fees.js';
import * as V from './vanity.js';
import * as Vig from './vig.js';
import * as Territory from './territory.js';
import * as Diplomacy from './diplomacy.js';
import * as Sov from './sov.js';
import * as Campaigns from './campaigns.js';
import * as Bloodline from './bloodline.js';
import * as Dynasty from './dynasty.js';
import * as Soldiers from './soldiers.js';
import * as Secrets from './secrets.js';
import * as Collection from './collection.js';
import * as Business from './business.js';
import * as Speakeasy from './speakeasy.js';
import * as Boxing from './boxing.js';
import * as Stable from './stable.js';
import * as Races from './races.js';
import * as Port from './port.js';
import * as Bonds from './bonds.js';
import * as Casino from './casino.js';
import * as Ring from './ring.js';
import * as Heists from './heists.js';
import * as Convoy from './convoy.js';
import * as Commission from './commission.js';
import * as Market from './market.js';
import * as Skills from './skills.js';
import * as Underworld from './underworld.js';
import * as Law from './law.js';
import * as World from './world.js';
import * as Pen from './pen.js';
import * as Loans from './loans.js';
import * as Portfolio from './portfolio.js';
import * as Emission from './emission.js';
import * as Rwa from './rwa.js';
import * as Phone from './phone.js';
import * as Mega from './megaproject.js';
import * as Duels from './duels.js';
import * as Clues from './clues.js';
import * as Estate from './estate.js';
import * as Auction from './auction.js';
import * as Wire from './wire.js';
import * as Store from './store.js';
import * as Pass from './pass.js';
import * as Landmarks from './landmarks.js';
import * as Ops from './ops.js';
import { itemArt } from './assets.js';
import * as Cards from './cards.js';
import { renderPng } from './cardpng.js';
import { buildOpenApi, llmsTxt } from './agentgateway.js';
import { opportunityBoard } from './opportunities.js';
import { rateLimitsEnabled, initRateLimiter, checkRateLimit, checkAuthRateLimit, checkReadLimit, checkPublicRateLimit } from './ratelimit.js';
import { runLedgerInvariants } from './invariants.js';
import { dayOf, cityEventOf, priceBlock, goodPriceOf, demandOf, makingsPriceOf,
         levelOf, GOODS, DRUGS, DISTRICTS, sealOf, CRIMES, GUNS, VESTS, CARS, KITCHENS, TRADE_RANKS, M3, M4, PATHS,
         cityLawEventOf, cityForecast, regionShockOf, cityHourOf, tickerPriceOf, PORTFOLIO, RWA_FLOAT, ESTATE, AUCTION, MEGAPROJECT, CLUES, DUELS, DUEL_TITLE_RANKS, SEASON_MODS, seasonModOf, seasonIdxOf, seasonDaysLeft,
         foundationOf, foundationBustMult, foundationBleedMult, FOUNDATION, LAW, WIRE, STORE, PASS, SPEAKEASY, BOXING,
         RACKETS, ASSETS, MISSIONS, GANG_SEALS, SOCIAL_GAME_URL, SOCIAL_X_HANDLE, territoryRankOf, syndicateOf, TERRITORY_TYPES, TERRITORY_RACKETS,
         worldNpcOf, liberationCost, RACES, PORT, CASINO, rollStats, feudTierOf, STABLE,
         EMISSION, emissionEpochOf, epochBudget, wageRequireMinted, TAX, withdrawTaxBps,
         HONOR, DIPLOMACY, SOV, CAMPAIGNS, CAMPAIGN_MIN_STANDING, MARRIAGE, SOLDIERS, SECRETS, KITCHEN, RACKET_EMPIRE } from './rules.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const uid = () => crypto.randomUUID();

export async function buildServer() {
  // (red-team R9 config) The whole hardening posture below used to hinge SOLELY on
  // NODE_ENV==='production' — but `npm start` / a bare `node src/server.js` never sets it, so a
  // real deploy that forgot the one variable most likely to be forgotten silently reverted EVERY
  // guard (forgeable JWT, public MARKET_SEED, live test-knobs, rate limits off) at once. A real
  // DATABASE_URL is the unforgeable "there is persistent value at stake here" signal — dev/CI use
  // pg-mem (no DATABASE_URL) and stay on the convenient fallbacks; anything pointed at a real
  // Postgres hardens regardless of NODE_ENV. (Tests set neither, so they are unaffected; the
  // security suite still sets NODE_ENV=production explicitly to exercise the guards.)
  const hardened = process.env.NODE_ENV === 'production' || !!process.env.DATABASE_URL;
  // Never boot a real deployment on the public dev fallback secret — anyone could forge a
  // token for any account. Dev/test may use the fallback (in-memory db, no real value).
  if (hardened && !process.env.JWT_SECRET)
    throw new Error('JWT_SECRET must be set for a real deployment (NODE_ENV=production or DATABASE_URL set) — refusing to boot on the dev fallback.');
  // (red-team R3) The §7.11 determinism model rests on MARKET_SEED being a server SECRET — every seeded
  // money draw (the Numbers 600:1, the Track/Fight winners, goods prices) is client-PREDICTABLE if the seed
  // is the known public default. Unlike JWT this fails OPEN (forget the env → silently vulnerable), so refuse
  // to boot on the unset/default seed — same fail-closed posture as the JWT guard above.
  if (hardened && (!process.env.MARKET_SEED || process.env.MARKET_SEED === 'omerta-server-seed'))
    throw new Error('MARKET_SEED must be set to a secret value for a real deployment — the default is public and makes every seeded draw (Numbers/Track/Fight/goods) predictable.');
  // (red-team R14 F1) The seeded draws use FNV-1a truncated to mod 1000, and the public prices board
  // publishes goodPriceOf(good,district,block) — leaking many (known-prefix → mod-1000) pairs. FNV is
  // brute-forceable, so a SHORT/low-entropy operator seed is recoverable offline from that surface, after
  // which numbersDrawOf/trackWinnerOf/boutOf are all computable (guaranteed 600:1 hits). A long random
  // seed is NOT recoverable, so this reduces to seed hygiene — enforce a floor (length + distinct chars),
  // matching the fail-closed posture above. (The hash itself staying FNV is a founder call — swapping it
  // to a keyed HMAC changes every deterministic draw/price output, a mechanic surface; flagged, not changed.)
  if (hardened) {
    const seed = String(process.env.MARKET_SEED || '');
    const distinct = new Set(seed).size;
    if (seed.length < 24 || distinct < 8)
      throw new Error('MARKET_SEED is too weak — use a long, high-entropy random secret (≥24 chars, ≥8 distinct). A short seed is offline-recoverable from the public prices board, making every money draw predictable.');
  }
  // (red-team R3) Test-only roll/timer overrides turn a money-affecting roll into an always-win switch or
  // collapse a §9/convoy/port timer, server-wide. They are safe-by-default (require an active misconfig) but
  // must never reach a real deployment — refuse to boot if any leaked into the env (the fail-closed JWT pattern;
  // CHAIN_POLL_MS is a legitimate production knob and is deliberately excluded).
  if (hardened) {
    const TEST_ONLY_ENV = ['BUSINESS_RAID_P', 'CALLOUT_MS', 'CLUE_DROP_P', 'CLUE_RELIC_P', 'DUEL_CD_MS', 'SEASON_MOD', 'RING_TURN_MS', 'BRACKET_ROUND_MS', 'CONVOY_MS', 'FUTURITY_MS', 'GEAR_LOOT_CHANCE', 'GRAND_PRIX_MS', 'LAW_BUST_P', 'MAIN_EVENT_MS', 'PASS_CLAIM_MS', 'PEN_BREAK_P', 'PEN_YARD_EVENT', 'PORT_INTERDICT_P', 'PORT_PIRATE_WIN', 'PORT_RUN_MS', 'PORT_SINK', 'RACE_CD_MS', 'SEARCH_MS', 'SHANK_P', 'SHOOT_CD_MS', 'SPEAKEASY_RAID_P', 'SPEAKEASY_STANDOVER_P', 'STAKES_MS', 'TERRITORY_RAID_P', 'TERRITORY_RIVAL_RAID_P', 'TOURNEY_MS', 'WANTED_HUNT_P', 'WORLD_RAID_P', 'WORLD_UPRISING', 'WORLD_UPRISING_FORCE'];
    const leaked = TEST_ONLY_ENV.filter((k) => process.env[k] != null);
    if (leaked.length) throw new Error(`Test-only roll/timer overrides must not be set in production (they turn money rolls into always-win switches): ${leaked.join(', ')}`);
  }
  // trustProxy (AUDIT-full-system-v2 H): OFF by default (raw socket IP — X-Forwarded-For is spoofable
  // when NOT behind a trusted proxy). An operator deploying behind a load balancer sets TRUST_PROXY=on
  // so req.ip reflects the real client — else the per-IP auth throttle (E-M1) collapses to one global
  // bucket at the proxy's IP. No behaviour change in the alpha (rate limits are off there anyway).
  const app = Fastify({ logger: false, trustProxy: process.env.TRUST_PROXY === 'on' });

  // THE AGENT GATEWAY — collect every mounted route (this hook fires per registration) so the
  // OpenAPI 3.1 contract at /openapi.json is auto-derived and never drifts from what's live.
  const routeRegistry = [];
  app.addHook('onRoute', (r) => {
    // Capture the REAL enforcement from the route's preHandler (by function name) so the OpenAPI
    // security is derived from what's actually mounted, never a URL heuristic that could drift or
    // mask a missing-auth hole (audit F2). `auth`/`modAuth` are named consts below.
    const pre = [].concat(r.preHandler || []);
    const names = pre.map((f) => (f && f.name) || '');
    const isMod = names.includes('modAuth');
    const hasAuth = names.includes('auth') || isMod;
    const methods = Array.isArray(r.method) ? r.method : [r.method];
    for (const m of methods) if (m !== 'HEAD' && m !== 'OPTIONS') routeRegistry.push({ method: m, url: r.url, hasAuth, isMod });
  });
  const baseUrl = process.env.PUBLIC_URL || SOCIAL_GAME_URL;

  // ── the playable console: one static file, no build step, no new deps (public/index.html) ──
  // Read once at boot; a missing file degrades to a pointer, never a crash (tests boot headless).
  let clientHtml = '<!doctype html><title>OMERTA</title><p>API up. Client file missing (public/index.html).</p>';
  try { clientHtml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'index.html'), 'utf8'); } catch { /* headless */ }
  app.get('/', async (req, reply) => reply.type('text/html; charset=utf-8').send(clientHtml));
  // the LIVE-OPS dashboard (mod-key gated client-side; every call carries x-mod-key) — public/admin.html
  let adminHtml = '<!doctype html><title>OMERTA ops</title><p>Ops console file missing (public/admin.html).</p>';
  try { adminHtml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'admin.html'), 'utf8'); } catch { /* headless */ }
  // (red-team R20) the mod ops console — deny framing (clickjacking defense-in-depth; the dashboard holds
  // the mod key in sessionStorage and drives confiscate/ban/mint). No CSP (would break its inline scripts).
  app.get('/admin', async (req, reply) => reply.type('text/html; charset=utf-8').header('X-Frame-Options', 'DENY').header('Referrer-Policy', 'no-referrer').send(adminHtml));
  // the CODEX: the in-game wiki — every system + gameplay loop (public/wiki.html); public, read-only
  let wikiHtml = '<!doctype html><title>OMERTA codex</title><p>Codex file missing (public/wiki.html).</p>';
  try { wikiHtml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'wiki.html'), 'utf8'); } catch { /* headless */ }
  app.get('/wiki', async (req, reply) => reply.type('text/html; charset=utf-8').send(wikiHtml));
  // ── ITEM ART: one procedural SVG per catalog entry (cosmetic; no ledger surface). Public + keyless,
  // heavily cacheable — the same id always renders the same icon. Shown in garage/port/kitchen/armory/
  // market. Unknown kind/id falls back to a neutral emblem, so a broken <img src> never 500s. ──
  const ART_CATALOGS = { car: CARS, boat: PORT.BOATS, drug: DRUGS, gun: GUNS, vest: VESTS, good: GOODS };
  app.get('/v1/art/:kind/:id', async (req, reply) => {
    // (red-team R16) own-property lookup — a '__proto__'/'constructor' :kind on this KEYLESS public route
    // otherwise returns Object.prototype (truthy) → `.find` is undefined → an uncaught TypeError 500.
    const list = Object.prototype.hasOwnProperty.call(ART_CATALOGS, req.params.kind) ? ART_CATALOGS[req.params.kind] : null;
    const item = list && list.find((x) => x.id === req.params.id);
    reply.type('image/svg+xml; charset=utf-8').header('cache-control', 'public, max-age=604800, immutable');
    return reply.send(itemArt(req.params.kind, item));
  });
  // ── THE BROADCAST: shareable noir cards + public profile + frictionless ?ref attribution (§7.13). ──
  // PUBLIC + keyless + read-only; ZERO §10.4 surface (marketing/status only). Wealth is never exact.
  const CARD_TYPES = new Set(['legend', 'wanted', 'whacked', 'join']);
  // These routes are PUBLIC + keyless, so bound every untrusted string before it renders — a living
  // name is ≤24 chars, so 48 never truncates a real lookup but caps an attacker's <100KB name that
  // would otherwise render a giant SVG and make resvg rasterize (CPU/mem) + poison the PNG cache.
  const clip = (s) => String(s || '').slice(0, 48);
  app.get('/v1/u/:name', async (req, reply) =>            // the safe public dossier (JSON)
    Cards.publicDossier(pool, clip(req.params.name)));
  app.get('/card/:type/:name', async (req, reply) => {    // the shareable 1200×630 poster (.png for feeds, else SVG)
    const wantPng = req.params.name.endsWith('.png');     // X/Twitter won't unfurl an SVG — /card/legend/<name>.png
    const rawName = clip(wantPng ? req.params.name.slice(0, -4) : req.params.name);
    const ref = clip(req.query.ref || rawName);
    const type = CARD_TYPES.has(req.params.type) ? req.params.type : 'legend';
    const d = await Cards.publicDossier(pool, rawName);
    const svg = Cards.card(type, d.found ? d : { name: rawName, gang: null, level: 1, kills: 0 }, ref);
    if (wantPng) {
      const png = await renderPng(svg);                   // null when no rasterizer is installed → fall back to SVG
      if (png) { reply.type('image/png').header('cache-control', 'public, max-age=300'); return reply.send(png); }
    }
    reply.type('image/svg+xml; charset=utf-8').header('cache-control', 'public, max-age=300');
    return reply.send(svg);
  });
  app.get('/u/:name', async (req, reply) => {             // the public profile page (the champion destination)
    const name = clip(req.params.name);
    const d = await Cards.publicDossier(pool, name);
    reply.type('text/html; charset=utf-8');
    return reply.send(Cards.profilePage(d, baseUrl, clip(req.query.ref || name)));
  });
  // ── THE AGENT GATEWAY: the machine-discovery layer (agents are first-class players; see AGENTS.md) ──
  let agentsMd = '# OMERTÀ — Agent Guide\n\nGuide file missing (AGENTS.md). See GET /openapi.json and GET /v1/rules.';
  try { agentsMd = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'AGENTS.md'), 'utf8'); } catch { /* headless */ }
  const serveAgents = async (req, reply) => reply.type('text/markdown; charset=utf-8').send(agentsMd);
  app.get('/agents', serveAgents);            // the agent onboarding quickstart
  app.get('/AGENTS.md', serveAgents);         // the conventional filename agents look for
  app.get('/llms.txt', async (req, reply) => reply.type('text/markdown; charset=utf-8').send(llmsTxt({ baseUrl })));
  // OpenAPI 3.1 of every mounted route — built once, after all routes register (deferred to first hit).
  let openApiCache = null;
  app.get('/openapi.json', async () => (openApiCache ||= buildOpenApi(routeRegistry, { baseUrl })));
  const pool = await makeDb();
  app.decorate('pool', pool);
  await app.register(jwt, { secret: process.env.JWT_SECRET || 'dev-secret-change-me' });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof G.GameError) return reply.code(400).send({ error: err.code, message: err.message });
    if (err.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER' || err.statusCode === 401) return reply.code(401).send({ error: 'auth' });
    req.log?.error?.(err); console.error(err);
    return reply.code(500).send({ error: 'internal' });
  });
  const auth = async (req, reply) => {
    await req.jwtVerify();
    // §10.3 — banned accounts are refused at the door (agent_flag rides the same query — no extra round-trip)
    const a = (await pool.query(
      'SELECT a.status, ap.agent_flag FROM accounts a LEFT JOIN account_persistent ap ON ap.account_id=a.id WHERE a.id=$1',
      [req.user.sub])).rows[0];
    if (!a || a.status === 'banned') return reply.code(403).send({ error: 'banned' });
    // R1: authed GET reads run through withCharacter (lazy accrual + ledger/telemetry writes) too, so an
    // agent could poll a read endpoint (e.g. GET /v1/me) at unlimited rate to DODGE the §10.2 agent 1/3s
    // hard throttle — the global limiter only guards POST/DELETE. Enforce the AGENT bucket on authed GETs
    // here; humans are left unthrottled on GETs so multi-tab console loads never 429 — only the agent cadence closes.
    // (red-team R19 F1) HEAD too — Fastify 5 auto-generates a HEAD route per GET (exposeHeadRoutes) that
    // runs the SAME handler, but `=== 'GET'` alone let `HEAD /v1/me` dodge this agent cadence + the read
    // limiter below while still running withCharacter (FOR UPDATE + a held connection). Treat HEAD as a read.
    if (rateLimitsEnabled() && a.agent_flag && (req.method === 'GET' || req.method === 'HEAD')) {
      const limited = await checkRateLimit({ accountId: req.user.sub, agent: true, path: req.routeOptions?.url || req.url });
      if (limited) return reply.code(429).header('retry-after', limited.retryAfter)
        .send({ error: 'rate_limited', retryAfter: limited.retryAfter });
    }
  };
  // Mod endpoints (§10.3) authenticate with the MOD_KEY header, never a player JWT.
  // Constant-time compare (audit L1) — the one secret-equality check on the mod perimeter.
  const modKeyOk = (given) => {
    const key = process.env.MOD_KEY;
    if (!key || typeof given !== 'string') return false;
    const a = Buffer.from(given), b = Buffer.from(key);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  const modAuth = async (req, reply) => {
    if (!modKeyOk(req.headers['x-mod-key'])) return reply.code(401).send({ error: 'mod_auth' });
  };
  // AUDIT-full-system-v2 D-MED2: real-ETH revenue (vig/pol/rwa) is booked ONLY from the on-chain
  // watcher observing a genuine event — a mod comp/QA route must never fabricate it. So mod routes
  // pass their caller-supplied txHash through this gate: it survives only when ALLOW_MOD_REAL_REVENUE=on
  // (a QA-only escape hatch, default OFF), so a production comp can't book unbacked withdrawal reserve.
  const modRealTxHash = (req) => (process.env.ALLOW_MOD_REAL_REVENUE === 'on' ? (req.body?.txHash || null) : null);

  // ── M5 hardening hooks: §10.2 rate limits + §5 idempotency keys ──
  // Applied to mutating player endpoints (auth/mod routes are excluded).
  await initRateLimiter();
  const guarded = (req) => (req.method === 'POST' || req.method === 'DELETE')
    && req.url.startsWith('/v1') && !req.url.startsWith('/v1/auth') && !req.url.startsWith('/v1/mod');
  app.addHook('preHandler', async (req, reply) => {
    // E-M1: auth endpoints are excluded from the account-keyed limiter above (they're unauthenticated),
    // so throttle them per-IP — bounds guest-mint Sybil floods + X/Privy auth-fetch amplification.
    if (rateLimitsEnabled() && req.method === 'POST' && req.url.startsWith('/v1/auth')) {
      const limited = await checkAuthRateLimit({ ip: req.ip });
      if (limited) return reply.code(429).header('retry-after', limited.retryAfter)
        .send({ error: 'rate_limited', retryAfter: limited.retryAfter });
    }
    // (red-team R13 F1/F2) the keyless public render routes (/card SVG+PNG, /u profile, /v1/u dossier)
    // do real per-hit work (an SVG→PNG raster + a DB dossier) and are NOT under the /v1 read-limiter — an
    // unauthenticated flood from one origin could pin the server. Throttle them per-IP (generous, only
    // bites a flood). Placed before the /v1 read branch so /v1/u (keyless) is covered too.
    // (red-team R19 F2) also throttle the keyless HEAVY GETs — /v1/art renders an SVG per hit and
    // /v1/landmarks does a full-table scan; both are keyless (no auth preHandler), so an unauthenticated
    // caller sends no token → the /v1 read limiter below early-returns → they were throttled by NOTHING.
    // (red-team R25 L1) /v1/ws is the same class — the WS upgrade carries its token in the subprotocol,
    // NOT the Authorization header, so the /v1 read branch's jwtVerify throws → catch/return, unthrottled;
    // each connect still does a real jwt.verify + socket churn. Bound the pre-auth upgrade per-IP too.
    if (rateLimitsEnabled() && (req.method === 'GET' || req.method === 'HEAD')
      && (req.url.startsWith('/card/') || req.url.startsWith('/u/') || req.url.startsWith('/v1/u/')
          || req.url.startsWith('/v1/art/') || req.url.startsWith('/v1/landmarks') || req.url.startsWith('/v1/ws')
          // (D1) the OAuth callback is a keyless GET that does real per-hit work (oauth_states DELETE +
          // an outbound X token/user fetch); the POST-only auth limiter + the token-gated read limiter
          // both skip it, so throttle it here with the other keyless heavy GETs.
          || req.url.startsWith('/v1/auth/x/callback'))) {
      const limited = await checkPublicRateLimit({ ip: req.ip });
      if (limited) return reply.code(429).header('retry-after', limited.retryAfter)
        .send({ error: 'rate_limited', retryAfter: limited.retryAfter });
    }
    // (red-team R10 F1) authed READ GETs were unthrottled for humans, yet a withCharacter GET holds a
    // pooled connection while it accrues+persists under a FOR UPDATE on the caller's own row — a
    // concurrent-GET flood from one account can pin the pool and starve everyone. Throttle authed /v1
    // GETs per-account with a GENEROUS bucket (never bites the console's debounced polling/re-render).
    // jwtVerify is cheap + no DB; a keyless/public GET (no token) falls through unthrottled.
    if (rateLimitsEnabled() && (req.method === 'GET' || req.method === 'HEAD')
      && req.url.startsWith('/v1') && !req.url.startsWith('/v1/mod')) {
      try { await req.jwtVerify(); } catch { return; }
      const limited = await checkReadLimit({ accountId: req.user.sub });
      if (limited) return reply.code(429).header('retry-after', limited.retryAfter)
        .send({ error: 'rate_limited', retryAfter: limited.retryAfter });
    }
    if (!guarded(req)) return;
    try { await req.jwtVerify(); } catch { return; } // unauthenticated → the route 401s
    // Ban + agent status come from the DB, never the token: an agent-flagged account
    // could otherwise keep using its pre-flag token to dodge the harder agent throttle.
    const acct = (await pool.query(
      'SELECT a.status, ap.agent_flag FROM accounts a LEFT JOIN account_persistent ap ON ap.account_id=a.id WHERE a.id=$1',
      [req.user.sub])).rows[0];
    if (!acct || acct.status === 'banned') return reply.code(403).send({ error: 'banned' });
    if (rateLimitsEnabled()) {
      const limited = await checkRateLimit({ accountId: req.user.sub, agent: !!acct.agent_flag,
        path: req.routeOptions?.url || req.url });
      if (limited) return reply.code(429).header('retry-after', limited.retryAfter)
        .send({ error: 'rate_limited', retryAfter: limited.retryAfter });
    }
    // Idempotency: RESERVE the key transactionally before the handler runs, so two
    // concurrent requests with the same key can't both execute (a check-only guard
    // that stores in onSend does not stop the double-submit it exists to prevent).
    const idem = req.headers['idempotency-key'];
    if (idem) {
      const key = String(idem);
      const bodyHash = crypto.createHash('sha256')
        .update(req.method + '\n' + req.url + '\n' + JSON.stringify(req.body ?? null)).digest('hex');
      // (red-team R4 idempotency MED) Reserve-or-replay, and NEVER proceed unreserved. If our INSERT
      // PK-conflicts but the SELECT then finds no row (the holder released it — a 4xx/5xx that DELETEs
      // its reservation between our conflict and our read, e.g. the `contention` error we tell clients
      // to retry), the old code ran the action WITHOUT a reservation → onSend stored nothing → a
      // further retry re-executed = double bank/spend. Loop and re-INSERT so every proceeding request
      // holds a reservation; on a pathological insert/delete storm, refuse (409) rather than run unprotected.
      for (let attempt = 0; attempt < 5; attempt++) {
        let reserved = false;
        try {
          await pool.query('INSERT INTO idempotency (account_id, key, status, body_hash, response) VALUES ($1,$2,0,$3,$4)',
            [req.user.sub, key, bodyHash, '']);
          reserved = true;
        } catch { /* PK conflict → the key already exists */ }
        if (reserved) { req._idem = { key, bodyHash }; return; }
        const row = (await pool.query('SELECT status, body_hash, response FROM idempotency WHERE account_id=$1 AND key=$2',
          [req.user.sub, key])).rows[0];
        if (!row) continue; // released between our INSERT and this SELECT — loop and re-reserve, never proceed unreserved
        if (row.body_hash !== bodyHash)
          return reply.code(422).send({ error: 'idempotency_key_reuse', message: 'This Idempotency-Key was used with a different request.' });
        if (row.status === 0)
          return reply.code(409).header('retry-after', 1).send({ error: 'in_progress', message: 'A request with this key is still processing.' });
        return reply.code(row.status).header('x-idempotent-replay', 'true').type('application/json').send(row.response);
      }
      return reply.code(409).header('retry-after', 1).send({ error: 'in_progress', message: 'Key contention — retry.' });
    }
  });
  app.addHook('onSend', async (req, reply, payload) => {
    if (!req._idem || reply.getHeader('x-idempotent-replay')) return payload;
    const { key } = req._idem;
    // Only a genuine success is stored (and thus replayed). A 4xx/5xx RELEASES the
    // reservation so the key isn't poisoned — a transient "jailed" or a 429 must not
    // permanently lock the key out.
    if (reply.statusCode >= 200 && reply.statusCode < 300) {
      // (red-team R15 F1) A swallowed store failure leaves a COMMITTED action's key at status=0 — the
      // orphan the long-horizon worker prune protects. Surface it so an operator sees the (rare)
      // committed-but-unstored seam rather than it vanishing silently.
      await pool.query('UPDATE idempotency SET status=$3, response=$4 WHERE account_id=$1 AND key=$2',
        [req.user.sub, key, reply.statusCode, String(payload)])
        .catch((e) => console.error('idempotency: store UPDATE failed — key left in-progress, value may have committed', e?.message));
    } else {
      await pool.query('DELETE FROM idempotency WHERE account_id=$1 AND key=$2 AND status=0',
        [req.user.sub, key]).catch(() => {});
    }
    return payload;
  });

  // ── auth (§4): guest, X, Privy — all behind the invite gate when INVITE_MODE=on ──
  app.post('/v1/auth/guest', async (req) => {
    await A.consumeInvite(pool, req.body?.inviteCode);
    const id = uid();
    await pool.query('INSERT INTO accounts (id, auth_provider, auth_subject, created_ip, last_ip) VALUES ($1,$2,$3,$4,$4)',
      [id, 'guest', id, req.ip || '0.0.0.0']);
    await pool.query('INSERT INTO account_persistent (account_id) VALUES ($1)', [id]);
    return { token: app.jwt.sign({ sub: id }, { expiresIn: '30d' }) };
  });
  const providerLogin = (verify) => async (req) => {
    const identity = await verify(req.body?.token);
    // (B2) the invite is consumed ATOMICALLY inside accountForIdentity's create txn — one invite per
    // new account, gate held even under a concurrent same-identity race (no separate pre-consume).
    const { accountId, created } = await A.accountForIdentity(pool, identity, req.ip || '0.0.0.0', req.body?.inviteCode);
    return { token: app.jwt.sign({ sub: accountId }, { expiresIn: '30d' }), created };
  };
  app.post('/v1/auth/x', providerLogin(A.verifyX));
  app.post('/v1/auth/privy', providerLogin(A.verifyPrivy));
  // ── ONE-CLICK X SIGN-IN (founder: no manual token pasting) — OAuth2 PKCE, server-side exchange.
  // POST start (optionally authed → binds the state to the guest for a claim-in-place upgrade;
  // the bearer never rides a URL) → the browser goes to X → GET callback exchanges the code
  // server-side, then redirects home with the result in the URL FRAGMENT (never sent to servers/
  // logs): #token= for a sign-in, #claimed=x for an upgrade, #autherr= on failure. DORMANT unless
  // X_CLIENT_ID + PUBLIC_URL are set (the callback URL to register on the X app is PUBLIC_URL +
  // /v1/auth/x/callback).
  const cookieVal = (req, name) => (req.headers.cookie || '').split(';')
    .map((c) => c.trim().split('=')).find(([k]) => k === name)?.[1];
  app.post('/v1/auth/x/start', async (req, reply) => {
    let accountId = null;
    try { await req.jwtVerify(); accountId = req.user.sub; } catch { /* unauthed start = a fresh sign-in */ }
    const { url, state } = await A.xOAuthStart(pool, { accountId, invite: req.body?.inviteCode });
    // BROWSER-BIND the state (anti account-linking CSRF): the callback must present the same cookie,
    // so an attacker who leaks their authorize URL can't have a victim's X identity bound to the
    // attacker's account (the victim's browser never carries the attacker's cookie). Path-scoped +
    // HttpOnly + Lax so it rides the top-level redirect back but nothing else.
    reply.header('Set-Cookie', `omerta_oauth=${state}; Path=/v1/auth/x; HttpOnly; SameSite=Lax; Max-Age=900`);
    return { url };
  });
  app.get('/v1/auth/x/callback', async (req, reply) => {
    // clear the one-shot binding cookie no matter the outcome
    reply.header('Set-Cookie', 'omerta_oauth=; Path=/v1/auth/x; HttpOnly; SameSite=Lax; Max-Age=0');
    try {
      if (!req.query?.state || cookieVal(req, 'omerta_oauth') !== req.query.state) {
        return reply.redirect('/#autherr=oauth_session'); // no matching browser binding → refuse (CSRF guard)
      }
      const r = await A.xOAuthCallback(pool, { code: req.query?.code, state: req.query?.state });
      if (r.purpose === 'upgrade' && r.accountId) {
        await A.upgradeAccount(pool, r.accountId, r.identity);
        return reply.redirect('/#claimed=x');
      }
      // (B2) invite consumed atomically inside accountForIdentity's create txn — gate held under races
      const { accountId } = await A.accountForIdentity(pool, r.identity, req.ip || '0.0.0.0', r.invite);
      return reply.redirect(`/#token=${encodeURIComponent(app.jwt.sign({ sub: accountId }, { expiresIn: '30d' }))}`);
    } catch (e) {
      const code = e instanceof G.GameError ? e.code : 'oauth_failed';
      if (!(e instanceof G.GameError)) console.error('x oauth callback', e);
      return reply.redirect(`/#autherr=${encodeURIComponent(code)}`);
    }
  });
  // guest → provider upgrade preserves the account row and everything on it (§4)
  app.post('/v1/auth/upgrade', { preHandler: auth }, async (req) => {
    const verify = req.body?.provider === 'x' ? A.verifyX
      : req.body?.provider === 'privy' ? A.verifyPrivy : null;
    if (!verify) throw new G.GameError('bad_provider', 'Providers: x, privy.');
    const identity = await verify(req.body?.token);
    return A.upgradeAccount(pool, req.user.sub, identity);
  });
  // §4/§10.2 agent API keys: flags the account permanently (🤖 badge, referral
  // exclusion) and mints a token the rate limiter throttles at 1 action / 3 s.
  app.post('/v1/auth/agent-key', { preHandler: auth }, async (req) => {
    await pool.query('UPDATE account_persistent SET agent_flag=true WHERE account_id=$1', [req.user.sub]);
    return { token: app.jwt.sign({ sub: req.user.sub, agent: true }, { expiresIn: '90d' }), agent: true };
  });

  // ── character ──
  app.post('/v1/character', { preHandler: auth }, async (req) => {
    const name = G.cleanText(req.body?.name).trim().slice(0, 24); // strip HTML-injection chars (stored-XSS fix)
    if (name.length < 2) throw new G.GameError('name', 'Pick a name (2–24 chars).');
    // (red-team R8) ASCII-only charset — the SAME guard the cosmetic name fields already use. The
    // character name IS the referral code + broadcast identity, so a Cyrillic-homoglyph / zero-width /
    // bidi name that renders identically to another player's = impersonation across every social surface.
    if (!/^[\w .,'&-]+$/.test(name)) throw new G.GameError('name', "Letters, numbers and simple punctuation only (no look-alike unicode).");
    const season = Math.floor(dayOf() / 28);
    const id = uid();
    // every fresh character rolls a UNIQUE build — same fixed budget (no power creep), different
    // shape (no two the same). Server-authoritative randomness, logged to rng_audit (§ ground rule #3).
    const st = rollStats();
    // (red-team R13 data-integrity) the account-existence check was a RACED check-then-insert (raw
    // pool.query, no lock) — two concurrent creates with DIFFERENT names both passed it and both INSERTed
    // → two living characters on one account (an uncontrollable "ghost", since every load reads rows[0]).
    // Serialize the whole create on the account_persistent row FOR UPDATE (the withCharacter idiom): a
    // concurrent second create blocks, then sees the first's committed character → clean `exists`. (A
    // partial UNIQUE(account_id) index would be a DB-level backstop but trips pg-mem's ANY() planner in
    // the referral path.) runEstate flips the dead row alive=false before the heir, so succession is fine.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT 1 FROM account_persistent WHERE account_id=$1 FOR UPDATE', [req.user.sub]);
      const existing = await client.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub]);
      if (existing.rows.length) throw new G.GameError('exists', 'One living character per account.');
      // names must be unique among the living (referral codes resolve by name, §7.13);
      // ux_char_name_alive is the race backstop (a 23505 below → name_taken)
      const nameClash = await client.query('SELECT 1 FROM characters WHERE name=$1 AND alive', [name]);
      if (nameClash.rows.length) throw new G.GameError('name_taken', 'Someone on the streets already goes by that name.');
      await client.query('INSERT INTO characters (id, account_id, name, season, muscle, cunning, speed) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id, req.user.sub, name, season, st.muscle, st.cunning, st.speed]);
      await client.query('INSERT INTO rng_audit (id, character_id, action, roll, outcome) VALUES ($1,$2,$3,$4,$5)',
        [uid(), id, 'roll_stats', Math.random(), `${st.muscle}/${st.cunning}/${st.speed}`]);
      // apply any Store Street-Wire window parked while the account had no living character (audit)
      await Store.claimPendingWire(client, req.user.sub, id);
      if (req.body?.referralCode) {
        // §7.13 — the referral code is the recruiter's character name
        const rec = await client.query('SELECT account_id FROM characters WHERE name=$1 AND alive AND account_id<>$2 LIMIT 1', [String(req.body.referralCode), req.user.sub]);
        if (rec.rows.length) {
          await client.query('UPDATE account_persistent SET referred_by=$1 WHERE account_id=$2 AND referred_by IS NULL', [rec.rows[0].account_id, req.user.sub]);
          const already = await client.query('SELECT 1 FROM referrals WHERE recruit_account=$1', [req.user.sub]);
          if (!already.rows.length)
            await client.query('INSERT INTO referrals (recruit_account, recruiter_account) VALUES ($1,$2)', [req.user.sub, rec.rows[0].account_id]);
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (e?.code === '23505') throw new G.GameError('name_taken', 'Someone on the streets already goes by that name.'); // name-index race backstop
      throw e;
    } finally { client.release(); }
    return { ok: true, id };
  });

  app.get('/v1/me', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, async () => ({})));

  // Lightweight pre-character session probe: a freshly-authed client can ask "am I set up?"
  // without eating a no_character 400 from /v1/me. Surfaces the whole gate state at a glance.
  app.get('/v1/session', { preHandler: auth }, async (req) => {
    const a = (await pool.query('SELECT minted, mint_credits, respawn_tokens, wallet_address, agent_flag FROM account_persistent WHERE account_id=$1', [req.user.sub])).rows[0] || {};
    const acct = (await pool.query('SELECT auth_provider FROM accounts WHERE id=$1', [req.user.sub])).rows[0] || {};
    const ch = (await pool.query('SELECT id, name, generation FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0] || null;
    return { authed: true, hasCharacter: !!ch, character: ch ? { id: ch.id, name: ch.name, generation: ch.generation } : null,
      // the client's claim-your-account card keys on this: a guest can upgrade to X/Privy in place
      provider: acct.auth_provider || 'guest',
      minted: !!a.minted, mintCredits: Number(a.mint_credits || 0), respawnTokens: Number(a.respawn_tokens || 0),
      wallet: a.wallet_address || null, agent: !!a.agent_flag,
      canWithdraw: !!a.minted && !!a.wallet_address };
  });

  // ── M1 actions (crimes/gym/doc/checkin/bank/travel) ──
  app.post('/v1/crimes/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => G.doCrime(ch, req.params.id, client, h)));
  app.post('/v1/train/:stat', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => G.train(ch, req.params.stat, client, h)));
  app.post('/v1/heal', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => G.heal(ch, client, h)));
  app.post('/v1/checkin', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => G.checkin(ch, client, h)));
  // THE BROADCAST share beacon — a player tapped broadcast / brag. AUTHED (bounded by real accounts +
  // rate limits, never an unauthenticated write), zero §10.4 — telemetry feeding the organic-growth funnel.
  app.post('/v1/broadcast/shared', { preHandler: auth }, async (req) => {
    const kind = ['dossier', 'win', 'wanted', 'whacked'].includes(req.body?.kind) ? req.body.kind : 'dossier';
    await G.track(pool, req.user.sub, 'broadcast_share', { kind });
    return { ok: true };
  });
  app.post('/v1/bank/:dir', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => G.bank(ch, req.params.dir, req.body?.amount, client, h)));
  app.post('/v1/travel/:district', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => G.travel(ch, req.params.district, client, h)));

  // ── M2: garage (§7.5) ──
  app.post('/v1/garage/boost', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.boostCar(ch, client, h)));
  app.post('/v1/garage/:carId/melt', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.meltCar(ch, req.params.carId, client, h)));
  app.post('/v1/garage/:carId/repair', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.repairCar(ch, req.params.carId, client, h)));
  app.post('/v1/garage/:carId/fence', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.fenceCar(ch, req.params.carId, client, h)));

  // ── M2: workshop + consumables (§5.4) ──
  app.post('/v1/workshop/craft/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.craft(ch, req.params.id, client, h)));
  app.post('/v1/workshop/ammo', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.craftAmmo(ch, client, h)));
  app.post('/v1/items/:id/use', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.useItem(ch, req.params.id, client, h)));

  // ── M2: trade goods (§7.11) ──
  app.post('/v1/goods/buy', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.buyGood(ch, req.body?.goodId, req.body?.qty, client, h)));
  app.post('/v1/goods/sell', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.sellGood(ch, req.body?.goodId, req.body?.qty, client, h)));

  // ── M2: rackets & assets (§5.4) ──
  app.post('/v1/rackets/:id/buy', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.buyRacket(ch, req.params.id, client, h)));
  app.post('/v1/assets/:id/buy', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.buyAsset(ch, req.params.id, client, h)));
  app.post('/v1/assets/:id/sell', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.sellAsset(ch, req.params.id, client, h)));
  // ── ASSETS & RACKETS → Tier 4 ──
  app.post('/v1/rackets/:id/upgrade', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.upgradeRacket(ch, req.params.id, client, h)));
  app.get('/v1/leaderboard/tycoons', async () => E.tycoonLeaderboard(pool));

  // ── M2: swap, staking, gear (§7.12 / §5.4) ──
  app.post('/v1/swap', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.swap(ch, req.body?.direction, req.body?.amount, client, h)));
  app.post('/v1/stake', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.stake(ch, req.body?.amount, client, h)));
  app.post('/v1/unstake', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.unstake(ch, client, h)));
  app.post('/v1/claim-rewards', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.claimRewards(ch, client, h)));
  app.post('/v1/gear/:id/mint', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.mintGear(ch, req.params.id, client, h)));

  // ── M3: armory (§5.2) ──
  app.post('/v1/armory/gun/:id/buy', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.buyGun(ch, req.params.id, client, h)));
  app.post('/v1/armory/gun/:id/equip', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.equipGun(ch, req.params.id, client, h)));
  app.post('/v1/armory/unequip', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.equipGun(ch, null, client, h)));
  app.post('/v1/armory/vest/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.buyVest(ch, req.params.id, client, h)));
  app.post('/v1/armory/ammo', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.buyAmmo(ch, client, h)));

  // ── M3: family (§5.5) ──
  app.post('/v1/gangs', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.createGang(ch, req.body?.name, req.body?.tag, client, h)));
  app.post('/v1/gangs/:id/join', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.joinGang(ch, req.params.id, client, h)));
  app.post('/v1/gangs/leave', { preHandler: auth }, async (req) => {
    const r = await G.withCharacter(pool, req.user.sub, (ch, client, h) => S.leaveGang(ch, client, h));
    // (red-team R9 WS) A member's gang: subscription is derived ONCE at connect. On leave/kick the socket
    // kept feeding the family's private war/contract/tribute chatter until the ex-member chose to
    // disconnect (a deliberate spy just holds it open). Close their sockets post-COMMIT (committed state
    // is now gangless) so the client reconnects and re-derives the correct — now empty — subscription.
    closeAccountSockets(req.user.sub, 4009, 'gang_changed');
    return r;
  });
  app.post('/v1/gangs/kick', { preHandler: auth }, async (req) => {
    const r = await G.withCharacter(pool, req.user.sub, (ch, client, h) => S.kickMember(ch, req.body?.characterId, client, h));
    // cut the KICKED member's live gang: feed (look the account up server-side — never expose the
    // account UUID to the client; the JWT blast-radius analysis relies on UUIDs never reaching clients).
    // (red-team R10 F2) This runs POST-COMMIT — a throw here (a pool blip on the lookup) would surface a
    // 5xx AFTER the kick committed, and the onSend hook would release the idempotency key → a retry
    // re-executes kickMember. So it must NEVER throw (the leave route is safe because closeAccountSockets
    // is internally try-caught; this lookup isn't, so wrap it). A missed socket-close is self-healing
    // (the client reconnects), a released key is a double-execute.
    try {
      const tid = req.body?.characterId;
      if (tid) {
        const acc = (await pool.query('SELECT account_id FROM characters WHERE id=$1', [tid])).rows[0];
        if (acc) closeAccountSockets(acc.account_id, 4009, 'gang_changed');
      }
    } catch (e) { console.error('kick socket-close (post-commit, non-fatal)', e?.code || e); }
    return r;
  });
  app.post('/v1/gangs/promote', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.promoteMember(ch, req.body?.characterId, req.body?.role, client, h)));
  app.post('/v1/gangs/tribute', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.tribute(ch, req.body?.amount, client, h)));
  // M8: $OMR tribute — any member pools tokens into the family reserve (feeds the seal ladder).
  app.post('/v1/gangs/tribute/omr', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.tributeOmr(ch, req.body?.amount, client, h)));
  app.post('/v1/gangs/war/:targetGangId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.declareWar(ch, req.params.targetGangId, client, h)));
  app.post('/v1/districts/:id/seize', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.seizeDistrict(ch, req.params.id, client, h)));
  // Risk-to-Earn Phase 3: territory rackets — establish/upgrade an operation on your turf, collect
  // its income, and lose it (with the district) to whoever seizes the turf.
  app.post('/v1/territory/:districtId/establish', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Territory.establishRacket(ch, req.params.districtId, req.body?.kind, client, h)));
  app.post('/v1/territory/:districtId/upgrade', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Territory.upgradeRacket(ch, req.params.districtId, client, h)));
  app.post('/v1/territory/collect', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Territory.collectTerritory(ch, client, h)));
  // recurring sinks: a boss/underboss pays the pad on the family's operations from the treasury
  app.post('/v1/territory/upkeep', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Territory.payTerritoryUpkeep(ch, client, h)));
  // step four — the racket-wars layer: fortify your own op (treasury sink) / raid a rival's for a cut
  app.post('/v1/territory/:districtId/fortify', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Territory.fortifyRacket(ch, req.params.districtId, client, h)));
  app.post('/v1/territory/:districtId/raid', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Territory.raidRivalRacket(ch, req.params.districtId, client, h)));
  // step five — racket specialists + special operations
  app.post('/v1/territory/:districtId/specialist', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Territory.assignSpecialist(ch, req.params.districtId, req.body?.memberId, client, h)));
  app.delete('/v1/territory/:districtId/specialist', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Territory.unassignSpecialist(ch, req.params.districtId, client, h)));
  app.post('/v1/territory/:districtId/op', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Territory.runTerritoryOp(ch, req.params.districtId, client, h)));
  app.get('/v1/territory', { preHandler: auth }, async (req) => {
    const gid = (await pool.query('SELECT gang_id FROM gang_members WHERE character_id=(SELECT id FROM characters WHERE account_id=$1 AND alive)', [req.user.sub])).rows[0]?.gang_id;
    if (!gid) return { territory: [], syndicate: null };
    return { territory: await Territory.territoryOf(pool, gid), ...(await Territory.territorySyndicate(pool, gid)) };
  });
  app.get('/v1/leaderboard/territory', { preHandler: auth }, async () => Territory.territoryLeaderboard(pool)); // THE EMPIRE board

  // Business Empire — the premium, acquired-later personal front layer: buy/upgrade venues that
  // farm pocket cash and double as private, lower-heat laundering. GET /v1/catalog is the public
  // discoverable catalog (also closes the audit's API-discoverability gap).
  app.get('/v1/catalog', async () => ({ businesses: Business.catalog() }));
  // ── the public rulebook (client discoverability — the /v1/catalog precedent, read-only) ──
  // Curated PUBLIC constants only: what the prototype UI always showed players. Server stays
  // authoritative — knowing the odds table doesn't move a single roll client-side.
  app.get('/v1/rules', async () => ({
    crimes: CRIMES.map((c) => ({ id: c.id, name: c.name, lvl: c.lvl, nerve: c.nerve, cash: c.cash, base: c.base, jail: c.jail })),
    districts: DISTRICTS,
    stats: ['muscle', 'cunning', 'speed'],
    paths: PATHS,
    share: { gameUrl: SOCIAL_GAME_URL, xHandle: SOCIAL_X_HANDLE }, // brag-on-X: prefilled intents carry the player's name as a referral code
    // THE STREET WAGE — the emission schedule is PUBLIC by design (anyone can verify the printer)
    emission: { endowmentOmr: EMISSION.ENDOWMENT_OMR, epochOmr: EMISSION.EPOCH_OMR, decay: EMISSION.DECAY,
      decayEvery: EMISSION.DECAY_EVERY, capOmr: EMISSION.WAGE_CAP_OMR, minLevel: EMISSION.WAGE_MIN_LVL,
      minScore: EMISSION.WAGE_MIN_SCORE, mintedRequired: wageRequireMinted(),
      epoch: emissionEpochOf(), budget: epochBudget(emissionEpochOf()) },
    // FIVE PILLARS — the public catalogs (levers are sign-off; the schedule/ladders are knowable)
    honor: { tiers: HONOR.TIERS, trusted: HONOR.TRUSTED, dreaded: HONOR.DREADED },
    diplomacy: { pactDays: DIPLOMACY.PACT_MS / 86400000, coalitionMin: DIPLOMACY.COALITION_MIN,
      warMult: DIPLOMACY.COALITION_WAR_MULT, seizeMult: DIPLOMACY.COALITION_SEIZE_MULT,
      dominance: { districts: DIPLOMACY.DOMINANCE_DISTRICTS, standingMult: DIPLOMACY.DOMINANCE_STANDING_MULT } },
    sov: { tiers: SOV.TIERS, windowH: SOV.WINDOW_H, siegeCost: SOV.SIEGE_COST, ranks: SOV.RANKS,
      overextBps: SOV.OVEREXT_BPS },
    campaigns: CAMPAIGNS.map((c) => ({ id: c.id, npc: c.npc, name: c.name, blurb: c.blurb,
      steps: c.steps.length, minStanding: CAMPAIGN_MIN_STANDING, reward: c.reward })),
    marriage: { proposeCost: MARRIAGE.PROPOSE_COST, acceptCost: MARRIAGE.ACCEPT_COST,
      consigliereCost: MARRIAGE.CONSIGLIERE_COST, scandal: MARRIAGE.SCANDAL, divorce: MARRIAGE.DIVORCE },
    soldiers: { max: SOLDIERS.MAX, hireCost: SOLDIERS.HIRE_COST, cutBps: SOLDIERS.CUT_BPS,
      deathP: SOLDIERS.DEATH_P, traits: Object.entries(SOLDIERS.TRAITS).map(([id, t]) => ({ id, name: t.name, desc: t.desc })) },
    secrets: { digOmr: SECRETS.DIG_OMR, maxHeld: SECRETS.MAX_HELD, ttlDays: SECRETS.TTL_MS / 86400e3,
      windowHours: SECRETS.EXTORT_WINDOW_MS / 3600e3,
      kinds: Object.entries(SECRETS.KINDS).map(([id, k]) => ({ id, name: k.name, hushCap: k.hushCap, exposeHeat: k.exposeHeat })) },
    // WalletConnect (mobile wallets — Robinhood Wallet, MetaMask Mobile, …): the public Cloud project id +
    // the chain to request. DORMANT (null) unless WALLETCONNECT_PROJECT_ID is set — the console hides the
    // option then. Project ids are public (client-embedded), so surfacing it here is standard + safe.
    walletConnect: process.env.WALLETCONNECT_PROJECT_ID
      ? { projectId: process.env.WALLETCONNECT_PROJECT_ID, chainId: Number(process.env.CHAIN_ID) || 1 }
      : null,
    // one-click X sign-in (OAuth redirect): the console shows the button only when configured
    auth: { xOAuth: A.xOAuthConfigured() },

    rackets: RACKETS.map((r) => ({ id: r.id, name: r.name, lvl: r.lvl, cost: r.cost, income: r.income, desc: r.desc })),
    assets: ASSETS.map((a) => ({ id: a.id, name: a.name, cat: a.cat, price: a.price, stat: a.stat, boost: a.boost, cargo: a.cargo, desc: a.desc })),
    // ASSETS & RACKETS → Tier 4 — the upgrade axis, the tycoon ladder, the empire-set titles
    empire: { upMax: RACKET_EMPIRE.UP_MAX, upStep: RACKET_EMPIRE.UP_STEP, tycoonRanks: RACKET_EMPIRE.TYCOON_RANKS,
      sets: RACKET_EMPIRE.SETS.map((s) => ({ id: s.id, name: s.name })) },
    missions: MISSIONS.map((m) => ({ id: m.id, name: m.name, req: m.req, reward: m.reward, brief: m.brief })),
    seals: GANG_SEALS,
    guns: GUNS.map((g) => ({ id: g.id, name: g.name, cash: g.cash, crates: g.crates, fp: g.fp, desc: g.desc })),
    races: { minLevel: RACES.MIN_LEVEL, tiers: RACES.TIERS.map((t) => ({ id: t.id, name: t.name, minLvl: t.minLvl, fee: t.fee, purse: t.purse })), tune: { cost: RACES.TUNE_COST, max: RACES.TUNE_MAX }, wager: { min: RACES.WAGER_MIN, max: RACES.WAGER_MAX }, nos: { cost: RACES.NOS_COST, max: RACES.NOS_MAX, power: RACES.NOS_POWER }, pinkSlips: true, grandPrix: { buyin: RACES.GP.BUYIN, minLevel: RACES.GP.MIN_LEVEL, minEntrants: RACES.GP.MIN_ENTRANTS, payouts: RACES.GP.PAYOUTS } },
    port: { minLevel: PORT.MIN_LEVEL, district: PORT.DISTRICT, boats: PORT.BOATS.map((b) => ({ id: b.id, name: b.name, cost: b.cost, hold: b.hold, speed: b.speed })), routes: PORT.ROUTES.map((r) => ({ id: r.id, name: r.name, minLvl: r.minLvl, minSpeed: r.minSpeed, buy: r.buy, sell: r.sell })), upgrade: { max: PORT.STEP2.UPGRADE_MAX, hullStep: PORT.STEP2.HULL_STEP, engineStep: PORT.STEP2.ENGINE_STEP }, piracy: { minLevel: PORT.STEP2.PIRATE_MIN_LEVEL, energy: PORT.STEP2.PIRATE_ENERGY, ammo: PORT.STEP2.PIRATE_AMMO } },
    vests: VESTS.map((v) => ({ id: v.id, name: v.name, mult: v.mult, omr: v.omr, desc: v.desc })),
    drugs: DRUGS.map((d) => ({ id: d.id, name: d.name, tag: d.tag, base: d.base, unlock: d.unlock })),
    goods: GOODS.map((g) => ({ id: g.id, name: g.name, base: g.base })),
    kitchens: KITCHENS.map((k) => ({ id: k.id, name: k.name, cost: k.cost, omr: k.omr, cap: k.cap, mins: k.mins, fire: k.fire, desc: k.desc })),
    tradeRanks: TRADE_RANKS,
    // THE KITCHEN → Tier 4 — lab modules, cutting, the kingpin ladder
    kitchen: { modules: Object.entries(KITCHEN.MODULES).map(([id, m]) => ({ id, name: m.name, desc: m.desc, step: m.step })),
      moduleMax: KITCHEN.MODULE_MAX, cut: { cost: KITCHEN.CUT_COST, units: KITCHEN.CUT_UNITS, qualityHit: KITCHEN.CUT_QUALITY, floor: KITCHEN.CUT_FLOOR },
      kingpinRanks: KITCHEN.KINGPIN_RANKS },
    family: { foundCost: M3.GANG_FOUND_COST, tributeMin: M3.TRIBUTE_MIN },
    crew: { costStep: M4.CREW_COST_STEP, max: M4.CREW_MAX },
    portfolio: { minInvest: PORTFOLIO.MIN_INVEST_OMR, scrutinyMin: PORTFOLIO.SCRUTINY_MIN_OMR,
      tickers: PORTFOLIO.TICKERS.map((t) => ({ id: t.id, name: t.name, blurb: t.blurb })) },
    vault: { claimMin: RWA_FLOAT.CLAIM_MIN_OMR, claimDailyOmr: RWA_FLOAT.CLAIM_DAILY_OMR,
      note: 'the backed tier — claims allocate real treasury-held stock units; the paper book above is status' },
    estate: { nameOmr: ESTATE.NAME_OMR, tiers: ESTATE.TIERS, features: ESTATE.FEATURES },
    seasonMods: { pool: SEASON_MODS, note: 'one seed-drawn twist per 28-day season — the touchpoints compose on existing modifier sites' },
    clues: { dropP: CLUES.DROP_P, digEnergy: CLUES.DIG_ENERGY, casket: [CLUES.CASKET_MIN, CLUES.CASKET_MAX],
      cooldownHours: Math.round(CLUES.CLUE_CD_MS / 3600000), ranks: CLUES.RANKS,
      note: 'a rare drop on any successful job — a riddle trail ending in a casket' },
    duels: { stakeMin: DUELS.STAKE_MIN, rakeBps: DUELS.RAKE_BPS, minLevel: DUELS.MIN_LVL, ranks: DUELS.RANKS,
      divisions: DUELS.DIVISIONS, styles: DUELS.STYLES, styleEdge: DUELS.STYLE_EDGE, titleRanks: DUEL_TITLE_RANKS },
    megaproject: { monuments: MEGAPROJECT.MONUMENTS, minCash: MEGAPROJECT.MIN_CASH,
      minOmr: MEGAPROJECT.MIN_OMR, omrRate: MEGAPROJECT.OMR_RATE,
      note: 'the collective monument — every contribution is a burn; the plaque is forever' },
    speakeasy: { minLevel: SPEAKEASY.MIN_LEVEL, openCost: SPEAKEASY.OPEN_COST, nameOmr: SPEAKEASY.NAME_OMR,
      tiers: SPEAKEASY.TIERS, rounds: SPEAKEASY.ROUNDS, bottles: SPEAKEASY.BOTTLES,
      table: { minBet: SPEAKEASY.TABLE.MIN_BET, maxBet: SPEAKEASY.TABLE.MAX_BET, rakeBps: SPEAKEASY.TABLE.RAKE_BPS },
      raidThreshold: SPEAKEASY.RAID_THRESHOLD, saleMin: SPEAKEASY.SALE_MIN, saleMax: SPEAKEASY.SALE_MAX,
      decorStyles: SPEAKEASY.DECOR_STYLES, renownRanks: SPEAKEASY.RENOWN.RANKS,
      styleUnlocks: SPEAKEASY.RENOWN.STYLE_UNLOCKS, standoverFee: SPEAKEASY.STANDOVER.FEE },
    boxing: { minLevel: BOXING.MANAGER_MIN_LEVEL, recruitCost: BOXING.RECRUIT_COST, trainCost: BOXING.TRAIN_COST,
      trainEnergy: BOXING.TRAIN_ENERGY, statCap: BOXING.STAT_CAP, stats: BOXING.STATS,
      minStake: BOXING.MIN_STAKE, maxStake: BOXING.MAX_STAKE, ranks: BOXING.RANKS, rakeBps: BOXING.RAKE_BPS,
      stableMax: BOXING.STABLE_MAX, npcTiers: BOXING.NPC_TIERS, legendRanks: BOXING.LEGEND_RANKS,
      betMin: BOXING.BET_MIN, betMax: BOXING.BET_MAX, betRakeBps: BOXING.BET_RAKE_BPS, defenseMs: BOXING.DEFENSE_MS, calloutMs: BOXING.CALLOUT_MS },
    stable: { minLevel: STABLE.MIN_LEVEL, kinds: STABLE.KINDS, meets: STABLE.MEETS, trainCost: STABLE.TRAIN_COST,
      trainEnergy: STABLE.TRAIN_ENERGY, statCap: STABLE.STAT_CAP, stats: STABLE.STATS, stableMax: STABLE.STABLE_MAX,
      minStake: STABLE.MIN_STAKE, maxStake: STABLE.MAX_STAKE, ranks: STABLE.RANKS, legendRanks: STABLE.LEGEND_RANKS, rakeBps: STABLE.RAKE_BPS,
      breedCost: STABLE.BREED_COST, stakes: { buyin: STABLE.STAKES.BUYIN, minEntrants: STABLE.STAKES.MIN_ENTRANTS, payouts: STABLE.STAKES.PAYOUTS, rakeBps: STABLE.STAKES.RAKE_BPS } },
    auction: { lotsPerWeek: AUCTION.LOTS_PER_WEEK, minRaiseBps: AUCTION.MIN_RAISE_BPS, archetypes: AUCTION.ARCHETYPES },
    envelope: { omr: LAW.ENVELOPE_OMR, days: Math.round(LAW.ENVELOPE_MS / 86400000), gainMult: LAW.ENVELOPE_GAIN_MULT, bleedMult: LAW.ENVELOPE_BLEED_MULT },
    foundation: FOUNDATION.TIERS.map((t) => ({ tier: t.tier, name: t.name, omr: t.omr, bustMult: t.bustMult, bleedMult: t.bleedMult, blurb: t.blurb })),
    wire: { tapOmr: WIRE.TAP_OMR, tapHours: Math.round(WIRE.TAP_MS / 3600000), tapMax: WIRE.TAP_MAX,
      sweepOmr: WIRE.SWEEP_OMR, subOmr: WIRE.SUB_OMR, subDays: Math.round(WIRE.SUB_MS / 86400000),
      traceOmr: WIRE.TRACE_OMR, dossierOmr: WIRE.DOSSIER_OMR,
      disinfoOmr: WIRE.DISINFO_OMR, disinfoHours: Math.round(WIRE.DISINFO_MS / 3600000),
      informantOmr: WIRE.INFORMANT_OMR, informantDays: Math.round(WIRE.INFORMANT_MS / 86400000), informantMax: WIRE.INFORMANT_MAX,
      spyRanks: WIRE.SPY_RANKS.map((r) => ({ min: r.min, name: r.name, tapBonus: r.tapBonus || 0, discountBps: r.discountBps || 0 })), // step four tradecraft
      subTiers: WIRE.SUB_TIERS.map((t) => ({ tier: t.tier, name: t.name, omr: t.omr, days: Math.round(t.ms / 86400000), watchSlots: t.watchSlots, warRoom: t.warRoom })) }, // step five ladder + standing watch
    store: STORE.PACKAGES.map((p) => ({ sku: p.sku, name: p.name, priceEth: p.priceEth, grant: p.grant, blurb: p.blurb })),
    pass: { tiers: PASS.TRACK.map((t) => ({ tier: t.tier, reward: t.reward })) },
    casino: { district: CASINO.DISTRICT, minBet: CASINO.MIN_BET, maxBet: CASINO.MAX_BET,
      dice: { pays: '1:1', nerve: CASINO.DICE_NERVE }, numbers: { min: CASINO.NUMBERS_MIN, max: CASINO.NUMBERS_MAX, pays: CASINO.NUMBERS_PAYOUT },
      blackjack: { paysBps: CASINO.BJ_PAYS_BPS, dealerMin: CASINO.BJ_DEALER_MIN, hitSoft17: CASINO.BJ_HIT_SOFT_17 },
      poker: { min: CASINO.POKER_MIN, rakeBps: CASINO.PVP_RAKE_BPS },
      tournament: { buyin: CASINO.TOURNEY.BUYIN, rakeBps: CASINO.TOURNEY.RAKE_BPS, payouts: CASINO.TOURNEY.PAYOUTS, minEntrants: CASINO.TOURNEY.MIN_ENTRANTS },
      pvpRakeBps: CASINO.PVP_RAKE_BPS, fight: { max: CASINO.FIGHT_MAX, minLvl: CASINO.FIGHT_BET_MIN_LVL },
      track: { minBet: CASINO.TRACK.MIN_BET, maxBet: CASINO.TRACK.MAX_BET, field: CASINO.TRACK.FIELD, edgeBps: Math.round(CASINO.TRACK.EDGE * 10000),
        playerSlots: CASINO.TRACK.PLAYER_SLOTS, entryFee: CASINO.TRACK.ENTRY_FEE },
      futurity: { nominateFee: CASINO.FUTURITY.NOMINATE_FEE, fieldMax: CASINO.FUTURITY.FIELD_MAX, minRunners: CASINO.FUTURITY.MIN_RUNNERS,
        minBet: CASINO.FUTURITY.MIN_BET, maxBet: CASINO.FUTURITY.MAX_BET, rakeBps: CASINO.FUTURITY.RAKE_BPS } },
  }));
  app.post('/v1/business/:kind/buy', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Business.buyBusiness(ch, req.params.kind, client, h)));
  app.post('/v1/business/collect', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Business.collectBusiness(ch, client, h)));
  // recurring sinks: pay the pad (protection + wages) on your fronts — a front unpaid past the
  // cold window produces nothing until squared
  app.post('/v1/business/upkeep', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Business.payBusinessUpkeep(ch, client, h)));
  app.post('/v1/business/:id/upgrade', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Business.upgradeBusiness(ch, req.params.id, client, h)));
  app.post('/v1/business/:id/launder', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Business.launderAtBusiness(ch, req.params.id, req.body?.amount, client, h)));
  // step two (risk layer): a rival extorts a front for a cut of its pending income — two-party,
  // so the owner lookup happens first and withTwoCharacters locks both sides in sorted order.
  app.post('/v1/business/:id/shakedown', { preHandler: auth }, async (req) => {
    const owner = (await pool.query('SELECT character_id FROM businesses WHERE id=$1', [req.params.id])).rows[0];
    if (!owner) throw new G.GameError('bad_business', 'No such front.');
    return G.withTwoCharacters(pool, req.user.sub, owner.character_id, (ch, victim, client, h) =>
      Business.shakedownBusiness(ch, victim, req.params.id, client, h));
  });
  app.get('/v1/business', { preHandler: auth }, async (req) => {
    const cid = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0]?.id;
    return { businesses: cid ? await Business.businessesOf(pool, cid) : [] };
  });

  // THE SPEAKEASY — the social hub: a club per district, the proprietor's front + the being-seen economy.
  app.get('/v1/speakeasy', { preHandler: auth }, async (req) => {
    const cid = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0]?.id;
    return Speakeasy.speakeasyBoard(pool, cid || '');
  });
  app.post('/v1/speakeasy/:districtId/open', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Speakeasy.openSpeakeasy(ch, req.params.districtId, client, h)));
  app.post('/v1/speakeasy/collect', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Speakeasy.collectSpeakeasy(ch, client, h)));
  app.post('/v1/speakeasy/upgrade', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Speakeasy.upgradeSpeakeasy(ch, client, h)));
  app.post('/v1/speakeasy/name', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Speakeasy.nameSpeakeasy(ch, req.body?.name, client, h)));
  app.post('/v1/speakeasy/:districtId/bottle', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Speakeasy.bottleService(ch, req.params.districtId, req.body?.bottle, client, h)));
  // buy a round: two-party (patron → owner) — look up the club's owner first, then withTwoCharacters
  // locks both sides in sorted order (the shakedown precedent).
  app.post('/v1/speakeasy/:districtId/round', { preHandler: auth }, async (req) => {
    const club = (await pool.query('SELECT owner_character FROM speakeasies WHERE district_id=$1', [req.params.districtId])).rows[0];
    if (!club) throw new G.GameError('no_club', "There's no club in that district.");
    return G.withTwoCharacters(pool, req.user.sub, club.owner_character, (ch, owner, client, h) =>
      Speakeasy.visitSpeakeasy(ch, owner, req.params.districtId, req.body?.round, client, h));
  });
  // the back-room table: two-party (patron plays, owner takes the rake)
  app.post('/v1/speakeasy/:districtId/table', { preHandler: auth }, async (req) => {
    const club = (await pool.query('SELECT owner_character FROM speakeasies WHERE district_id=$1', [req.params.districtId])).rows[0];
    if (!club) throw new G.GameError('no_club', "There's no club in that district.");
    return G.withTwoCharacters(pool, req.user.sub, club.owner_character, (ch, owner, client, h) =>
      Speakeasy.playTable(ch, owner, req.params.districtId, req.body?.bet, client, h));
  });
  // step three — the P2P buyout: list / unlist your club, buy out a listed one (two-party)
  app.post('/v1/speakeasy/list', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Speakeasy.listSpeakeasy(ch, req.body?.price, client, h)));
  app.post('/v1/speakeasy/unlist', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Speakeasy.unlistSpeakeasy(ch, client, h)));
  app.post('/v1/speakeasy/:districtId/buy', { preHandler: auth }, async (req) => {
    const club = (await pool.query('SELECT owner_character, sale_price FROM speakeasies WHERE district_id=$1', [req.params.districtId])).rows[0];
    if (!club) throw new G.GameError('no_club', "There's no club in that district.");
    if (club.sale_price == null) throw new G.GameError('not_for_sale', "That club isn't on the market.");
    return G.withTwoCharacters(pool, req.user.sub, club.owner_character, (ch, seller, client, h) =>
      Speakeasy.buySpeakeasy(ch, seller, req.params.districtId, client, h));
  });
  // step three — apply an owned/renown-earned cosmetic decor style to your club (null clears to stock)
  app.post('/v1/speakeasy/decor', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Speakeasy.applyDecor(ch, req.body?.style, client, h)));
  // step four — the STANDOVER: a hostile forced-sale (two-party muscle contest), the challenger leans on the owner
  app.post('/v1/speakeasy/:districtId/standover', { preHandler: auth }, async (req) => {
    const club = (await pool.query('SELECT owner_character FROM speakeasies WHERE district_id=$1', [req.params.districtId])).rows[0];
    if (!club) throw new G.GameError('no_club', "There's no club in that district.");
    return G.withTwoCharacters(pool, req.user.sub, club.owner_character, (ch, owner, client, h) =>
      Speakeasy.standoverSpeakeasy(ch, owner, req.params.districtId, client, h));
  });
  app.get('/v1/leaderboard/nightlife', { preHandler: auth }, async (req) => {
    const cid = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0]?.id;
    return Speakeasy.nightlifeLeaderboard(pool, cid || '');
  });

  // THE FIGHT CIRCUIT — sign a contender, train them, stake them in PvP bouts (the casino:pvp pattern).
  app.get('/v1/boxing', { preHandler: auth }, async (req) => {
    const cid = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0]?.id;
    return Boxing.boxingBoard(pool, cid || '');
  });
  app.post('/v1/boxing/recruit', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Boxing.recruitFighter(ch, req.body?.name, client, h)));
  app.post('/v1/boxing/train', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Boxing.trainFighter(ch, req.body?.fighter, req.body?.stat, client, h)));
  app.post('/v1/boxing/list', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Boxing.listBout(ch, req.body?.fighter, req.body?.stake, client, h)));
  // NPC exhibition — a bounded PvE purse: your fighter vs a server card (step two)
  app.post('/v1/boxing/exhibition', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Boxing.exhibitionBout(ch, req.body?.fighter, req.body?.tier, client, h)));
  app.post('/v1/boxing/fight/:opponentId', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.opponentId, (ch, opponent, client, h) =>
      Boxing.fightBout(ch, opponent, req.body, client, h)));
  // THE MAIN EVENT (step three) — book a scheduled card the crowd bets on; place a CASH bet; worker resolves.
  app.post('/v1/boxing/announce/:opponentId', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.opponentId, (ch, opponent, client, h) =>
      Boxing.announceMainEvent(ch, opponent, req.body, client, h)));
  app.post('/v1/boxing/bout/:id/bet', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Boxing.placeBoutBet(ch, req.params.id, req.body, client, h)));
  // THE CALLOUT (step five) — the #1 contender forces a title fight; the champ accepts or forfeits.
  app.post('/v1/boxing/callout/:fighterId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Boxing.callOutChamp(ch, req.params.fighterId, client, h)));
  app.post('/v1/boxing/callout/accept', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Boxing.acceptCallout(ch, client, h)));
  app.get('/v1/leaderboard/boxing', { preHandler: auth }, async (req) => {
    const cid = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0]?.id;
    return Boxing.boxingLeaderboard(pool, cid || '');
  });

  // ── THE STABLE — own the dogs & the ponies (buy/train/list/circuit(PvE)/match(PvP) + the legend) ──
  app.get('/v1/stable', { preHandler: auth }, async (req) => {
    const cid = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0]?.id;
    return Stable.stableBoard(pool, cid || '');
  });
  app.post('/v1/stable/buy', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Stable.buyRacer(ch, req.body?.kind, req.body?.name, client, h)));
  app.post('/v1/stable/train/:racerId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Stable.trainRacer(ch, req.params.racerId, req.body?.stat, client, h)));
  app.post('/v1/stable/list/:racerId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Stable.listRacer(ch, req.params.racerId, req.body?.limit, client, h)));
  app.post('/v1/stable/circuit/:racerId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Stable.raceCircuit(ch, req.params.racerId, req.body?.meet, client, h)));
  app.post('/v1/stable/match/:opponentId', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.opponentId, (ch, opponent, client, h) =>
      Stable.matchRace(ch, opponent, req.body, client, h)));
  // step two: breeding (two racers → a foal) + THE STAKES (a scheduled marquee race, worker-resolved)
  app.post('/v1/stable/breed', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Stable.breedRacers(ch, req.body?.sire, req.body?.dam, req.body?.name, client, h)));
  app.post('/v1/stable/stakes/:racerId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Stable.enterStakes(ch, req.params.racerId, client, h)));
  app.get('/v1/leaderboard/stable', { preHandler: auth }, async () => Stable.stableLeaderboard(pool));

  // ── STREET RACES — the deep car catalog as a competitive loop (PvE circuit + PvP wagers + tuning) ──
  app.get('/v1/races', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Races.raceBoard(ch, client, h)));
  app.post('/v1/races/npc', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Races.raceNpc(ch, req.body?.car, req.body?.tier, req.body?.nos, client, h)));
  app.post('/v1/races/tune/:carId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Races.tuneCar(ch, req.params.carId, client, h)));
  app.post('/v1/races/nos/:carId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Races.buyNos(ch, req.params.carId, client, h)));
  app.post('/v1/races/list/:carId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Races.listRace(ch, req.params.carId, req.body?.limit, client, h)));
  app.post('/v1/races/unlist/:carId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Races.unlistRace(ch, req.params.carId, client, h)));
  app.post('/v1/races/pinkslip/:carId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Races.pinkSlipList(ch, req.params.carId, req.body?.on, client, h)));
  app.post('/v1/races/challenge/:ownerId', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.ownerId, (ch, opponent, client, h) =>
      Races.raceChallenge(ch, opponent, req.body, client, h)));
  app.post('/v1/races/pinks/:ownerId', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.ownerId, (ch, opponent, client, h) =>
      Races.pinkSlipRace(ch, opponent, req.body, client, h)));
  app.post('/v1/races/gp', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Races.enterGrandPrix(ch, req.body?.car, client, h)));
  app.get('/v1/leaderboard/races', { preHandler: auth }, async () => Races.raceLeaderboard(pool));
  app.get('/v1/leaderboard/port', { preHandler: auth }, async () => Port.portLeaderboard(pool)); // THE SMUGGLER'S LEGEND board

  // ── THE PORT — maritime smuggling (boats + the run + the Coast Guard) ──
  app.get('/v1/port', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Port.portBoard(ch, client, h)));
  app.post('/v1/port/boat/:kind', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Port.buyBoat(ch, req.params.kind, client, h)));
  app.post('/v1/port/boat/:boatId/sell', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Port.sellBoat(ch, req.params.boatId, client, h)));
  app.post('/v1/port/run/:boatId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Port.launchRun(ch, req.params.boatId, req.body?.route, !!req.body?.escort, client, h)));
  app.post('/v1/port/collect/:boatId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Port.collectRun(ch, req.params.boatId, !!req.body?.warehouse, client, h)));
  app.post('/v1/port/fence', { preHandler: auth }, async (req) =>                    // step four: fence warehoused contraband
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Port.fenceContraband(ch, client, h)));
  app.post('/v1/port/berth', { preHandler: auth }, async (req) =>                     // step four: rent a harbor slip (+fleet cap)
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Port.rentBerth(ch, client, h)));
  app.post('/v1/port/upgrade/:boatId', { preHandler: auth }, async (req) =>          // step two: naval upgrade (hull/engine)
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Port.upgradeBoat(ch, req.params.boatId, req.body?.part, client, h)));
  app.post('/v1/port/intercept/:boatId', { preHandler: auth }, async (req) =>        // step two: PIRACY — run down a rival at sea
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Port.interceptRun(ch, req.params.boatId, client, h)));
  app.post('/v1/port/boat/:boatId/rendezvous', { preHandler: auth }, async (req) =>  // step two: flag a docked boat open to a handoff
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Port.setRendezvous(ch, req.params.boatId, req.body?.open !== false, client, h)));
  app.post('/v1/port/rendezvous/:boatId', { preHandler: auth }, async (req) =>       // step two: hand your run to a partner's boat
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Port.rendezvous(ch, req.params.boatId, req.body?.to, client, h)));

  // THE COMMISSION — the top families' weekly city decree (votes public, effect next week).
  app.get('/v1/commission', async () => Commission.commissionBoard(pool));
  app.post('/v1/commission/vote', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Commission.castVote(ch, req.body?.decree, client, h)));
  app.post('/v1/commission/veto', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Commission.vetoDecree(ch, client, h)));
  // step three — a seated family stakes a treasury deposit to put a motion on the week's ballot
  app.post('/v1/commission/propose', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Commission.proposeDecree(ch, req.body?.decree, client, h)));

  // SKILLS & SPECIALIZATIONS — the build layer: learn with level-derived points, respec for $OMR.
  app.get('/v1/skills', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Skills.skillsBoard(ch, h)));
  app.post('/v1/skills/respec', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Skills.respecSkills(ch, client, h)));
  // step two: fire a capstone-unlocked ACTIVE ability, and per-skill (leaf-first) respec.
  app.post('/v1/skills/active/:ability', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Skills.useActive(ch, req.params.ability, client, h)));
  app.post('/v1/skills/respec/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Skills.respecOne(ch, req.params.id, client, h)));
  app.post('/v1/skills/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Skills.learnSkill(ch, req.params.id, client, h)));

  // THE LAW — the state antagonist. GET /v1/law is the rap sheet + docket; the sinks are the
  // escapes (bribe/lawyer), the courtroom is plea/jury/trial, and the flip turns state's evidence.
  app.get('/v1/law', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Law.lawBoard(ch, h)));
  app.post('/v1/law/bribe', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Law.bribe(ch, client, h)));
  app.post('/v1/law/retainer', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Law.retainer(ch, client, h)));
  app.post('/v1/law/envelope', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Law.payEnvelope(ch, client, h)));
  app.post('/v1/law/plea', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Law.plea(ch, client, h)));
  app.post('/v1/law/jury', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Law.buyJury(ch, client, h)));
  app.post('/v1/law/trial', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Law.demandTrial(ch, client, h)));
  app.post('/v1/law/witpro', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Law.enterWitpro(ch, client, h)));
  // the flip is two-party — you name a rival, seeding THEIR case. Look up the target, lock both.
  app.post('/v1/law/flip/:targetId', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, victim, client, h) => Law.flip(ch, victim, client, h)));

  // THE PEN — the prison meta-game. Every action requires being in lockup; the shank is two-party.
  app.get('/v1/pen', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.penBoard(ch, client, h)));
  app.post('/v1/pen/work', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.workYard(ch, client, h)));
  app.post('/v1/pen/buy/:item', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.buyContraband(ch, req.params.item, client, h)));
  app.post('/v1/pen/protection', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.payProtection(ch, client, h)));
  app.post('/v1/pen/bribe', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.bribeGuard(ch, req.body?.seconds, client, h)));
  app.post('/v1/pen/break', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.attemptBreak(ch, client, h)));
  // step four — the CO-OP BREAKOUT (the crew-heist pattern, inside)
  app.get('/v1/pen/breaks', { preHandler: auth }, async (req) => {
    const cid = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0]?.id;
    if (!cid) throw new G.GameError('no_character', 'Create a character first.');
    return Pen.breakBoard(pool, cid);
  });
  app.post('/v1/pen/break/plan', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.planBreak(ch, client, h)));
  app.post('/v1/pen/break/:id/join', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.joinBreak(ch, req.params.id, client, h)));
  app.post('/v1/pen/break/:id/leave', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.leaveBreak(ch, req.params.id, client, h)));
  app.post('/v1/pen/break/:id/go', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.executeBreak(ch, req.params.id, client, h)));
  app.post('/v1/pen/shank/:targetId', { preHandler: auth }, async (req) => {
    const r = await G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, victim, client, h) => Pen.shank(ch, victim, client, h));
    await closeSocketsOnKill(r, req.params.targetId);
    return r;
  });
  // step two: the burner phone — call in an NPC hit from inside (two-party, consumes a burner)
  app.post('/v1/pen/burner/:targetId', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, victim, client, h) => Pen.burnerHit(ch, victim, client, h, req.body?.tier)));
  // step five: prison factions (join/leave for cover) + the break RAT
  app.post('/v1/pen/faction/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.joinFaction(ch, req.params.id, client, h)));
  app.post('/v1/pen/faction', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.leaveFaction(ch, client, h)));
  app.post('/v1/pen/break/:id/rat', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.ratBreak(ch, req.params.id, client, h)));

  // LOAN SHARKING — the Shylock: escrowed offers, a taken loan is a live debt, default is enforced.
  app.get('/v1/loans', { preHandler: auth }, async (req) => {
    const ch = (await pool.query('SELECT id, respect, welsher FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0];
    return ch ? Loans.loanBoard(pool, ch) : { offers: [], active: [] };
  });
  app.post('/v1/loans', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Loans.offerLoan(ch, req.body, client, h)));
  app.post('/v1/loans/:id/take', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Loans.takeLoan(ch, req.params.id, req.body?.carId, client, h)));
  app.post('/v1/loans/:id/cancel', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Loans.cancelLoan(ch, req.params.id, client, h)));
  // repay is two-party (borrower pays, lender credited): look up the lender, lock both.
  app.post('/v1/loans/:id/repay', { preHandler: auth }, async (req) => {
    const l = (await pool.query("SELECT lender_character FROM loans WHERE id=$1 AND status='active'", [req.params.id])).rows[0];
    if (!l) throw new G.GameError('no_loan', 'No such debt to square.');
    return G.withTwoCharacters(pool, req.user.sub, l.lender_character, (ch, victim, client, h) => Loans.repayLoan(ch, victim, req.params.id, client, h));
  });
  // collect is two-party (lender seizes from the borrower): look up the borrower, lock both.
  app.post('/v1/loans/:id/collect', { preHandler: auth }, async (req) => {
    const l = (await pool.query("SELECT borrower_character FROM loans WHERE id=$1 AND status='active'", [req.params.id])).rows[0];
    if (!l) throw new G.GameError('no_loan', 'No such debt to collect.');
    return G.withTwoCharacters(pool, req.user.sub, l.borrower_character, (ch, victim, client, h) => Loans.collectLoan(ch, victim, req.params.id, client, h));
  });
  // step 3 — the paper market: a lender sells/pulls an active loan's claim; a buyer takes it over.
  app.post('/v1/loans/:id/sell', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Loans.sellPaper(ch, req.params.id, req.body, client, h)));
  app.post('/v1/loans/:id/unsell', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Loans.unsellPaper(ch, req.params.id, client, h)));
  // step 4 — square your name: pay to clear WANTED + the welsher mark (calls off the hunt + pool bounty)
  // step 5 — THE LOAN HOUSE: the always-open backed NPC lender (bad terms, pool-bounded)
  app.post('/v1/loans/house', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Loans.takeHouseLoan(ch, req.body?.amount, client, h)));
  app.post('/v1/loans/house/repay', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Loans.repayHouseLoan(ch, client, h)));
  app.post('/v1/mod/loanhouse/fund', { preHandler: modAuth }, async (req) =>
    Loans.fundLoanHouse(pool, req.body?.amount));
  app.post('/v1/loans/square', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Loans.squareWanted(ch, client, h)));
  // buy is two-party (buyer pays the current lender, becomes the new lender): look up the seller, lock both.
  app.post('/v1/loans/:id/buy', { preHandler: auth }, async (req) => {
    const l = (await pool.query("SELECT lender_character FROM loans WHERE id=$1 AND status='active' AND for_sale IS NOT NULL", [req.params.id])).rows[0];
    if (!l) throw new G.GameError('gone', 'That paper is off the market.');
    return G.withTwoCharacters(pool, req.user.sub, l.lender_character, (ch, victim, client, h) => Loans.buyPaper(ch, victim, req.params.id, client, h));
  });

  // THE UNDERWORLD — named NPCs: standing earned by doing business, perks at 25/60/90.
  app.get('/v1/underworld', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Underworld.underworldBoard(ch, client, h)));
  app.post('/v1/underworld/discharge', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Underworld.discharge(ch, client, h)));
  app.post('/v1/underworld/gun/:gunId/sell', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Underworld.sellGunBack(ch, req.params.gunId, client, h)));
  app.post('/v1/underworld/:npc/gift', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Underworld.giftNpc(ch, req.params.npc, client, h)));
  // step four: square a grudge (a ledgered cash sink) / claim the weekly favor (resources, never money)
  app.post('/v1/underworld/:npc/penance', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Underworld.payPenance(ch, req.params.npc, client, h)));
  app.post('/v1/underworld/:npc/favor', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Underworld.claimFavor(ch, req.params.npc, client, h)));
  // step five: the errand chain — a fixture's storyline (drawn task on N separate days → big standing jump)
  app.post('/v1/underworld/:npc/errand', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Underworld.startErrand(ch, req.params.npc, client, h)));

  // R1 — THE PORTFOLIO ("going legit"): burn clean $OMR into legit, death-proof RWA/blue-chip
  // holdings (pure STATUS in R1 — no sell, no cash-out; the only §10.4 flow is the 'rwa:invest' burn).
  app.get('/v1/portfolio', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Portfolio.portfolioBoard(ch, client, h)));
  app.post('/v1/portfolio/invest', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Portfolio.invest(ch, req.body?.ticker, req.body?.omr, client, h)));
  app.post('/v1/gangs/portfolio/invest', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Portfolio.familyInvest(ch, req.body?.ticker, req.body?.omr, client, h)));
  // THE DYNASTY FUND — claim your ~daily $OMR dividend on the book (sink-fed pool, pool-bounded)
  app.post('/v1/portfolio/dividend', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Portfolio.claimDividend(ch, client, h)));
  // the FAMILY dividend — the gang book's yield, drawn to the reserve by the boss/underboss
  app.post('/v1/gangs/portfolio/dividend', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Portfolio.claimFamilyDividend(ch, client, h)));
  // THE FLOAT (omerta-rwa-float-design.md) — the full-reserve VAULTED book: ETH taxes fund a real
  // tokenized-stock reserve; players burn earned $OMR to claim allocation from it at the real oracle
  // price (allocated ≤ held BY CONSTRUCTION). The legacy book above stays the PAPER (status) tier.
  app.get('/v1/vault', { preHandler: auth }, async (req) => Rwa.vaultBoard(pool, req.user.sub));
  app.post('/v1/vault/claim', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Rwa.claimVaulted(ch, req.body?.ticker, req.body?.omr, client, h)));
  // name the FAMILY fund (a reserve $OMR sink) + the family-legit leaderboard (biggest family books)
  app.post('/v1/gangs/portfolio/name', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Portfolio.nameFamilyDynasty(ch, req.body?.name, client, h)));
  app.get('/v1/leaderboard/family-portfolio', { preHandler: auth }, async () => Portfolio.familyPortfolioLeaderboard(pool));
  app.get('/v1/leaderboard/portfolio', { preHandler: auth }, async () => Portfolio.portfolioLeaderboard(pool));
  app.post('/v1/dynasty/name', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Portfolio.nameDynasty(ch, req.body?.name, client, h)));
  app.get('/v1/leaderboard/foundation', { preHandler: auth }, async () => V.foundationLeaderboard(pool));

  // THE ESTATE ("the compound"): the deep personal $OMR sink + a "home" that displays your legend.
  app.get('/v1/estate', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Estate.estateBoard(ch, client, h)));
  app.post('/v1/estate/upgrade', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Estate.upgradeEstate(ch, client, h)));
  app.post('/v1/estate/feature/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Estate.unlockFeature(ch, req.params.id, client, h)));
  app.post('/v1/estate/name', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Estate.nameEstate(ch, req.body?.name, client, h)));
  // step two — THE STAFF (recurring $OMR payroll) + THE GALA (design omerta-deep-deferred-design.md §A)
  app.post('/v1/estate/staff/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Estate.hireStaff(ch, req.params.id, client, h)));
  app.delete('/v1/estate/staff/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Estate.dismissStaff(ch, req.params.id, client, h)));
  app.post('/v1/estate/wages', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Estate.payStaffWages(ch, client, h)));
  app.post('/v1/estate/gala', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Estate.throwGala(ch, client, h)));
  app.post('/v1/estate/gala/attend', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Estate.attendGala(ch, req.body?.hostId, client, h)));
  app.get('/v1/leaderboard/estates', { preHandler: auth }, async () => Estate.estateLeaderboard(pool));

  // THE AUCTION HOUSE ("the sit-down"): weekly $OMR auctions of unique prestige items — highest bid burns.
  app.get('/v1/auction', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Auction.auctionBoard(ch, client, h)));
  app.post('/v1/auction/:lotId/bid', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Auction.bidAuction(ch, req.params.lotId, req.body?.amount, client, h)));

  // NAMED LANDMARKS — one dedicable plaque per district, held by the highest $OMR flex (a status sink).
  app.get('/v1/landmarks', async () => Landmarks.landmarkBoard(pool));
  app.post('/v1/landmarks/:districtId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Landmarks.dedicateLandmark(ch, req.params.districtId, req.body?.amount, client, h)));

  // THE WIRE — the intelligence terminal: wiretaps on rivals + the Street Wire premium feed ($OMR sinks).
  app.get('/v1/wire', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Wire.wireBoard(ch, client, h)));
  app.post('/v1/wire/tap/:targetId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Wire.placeTap(ch, req.params.targetId, client, h)));
  app.post('/v1/wire/sweep', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Wire.sweepBugs(ch, client, h)));
  app.post('/v1/wire/subscribe', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Wire.subscribeWire(ch, req.body?.tier, client, h)));
  // Wire step five: THE STANDING WATCH — auto-renewed taps (enroll/cancel; the worker keeps them live)
  app.post('/v1/wire/watch/:targetId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Wire.enrollWatch(ch, req.params.targetId, client, h)));
  app.delete('/v1/wire/watch/:targetId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Wire.cancelWatch(ch, req.params.targetId, client, h)));
  // Wire step two: THE BUG TRACE (name your watchers), THE DOSSIER (a deep read), THE SPYMASTER board
  app.post('/v1/wire/trace', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Wire.traceBugs(ch, client, h)));
  app.post('/v1/wire/dossier/:targetId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Wire.pullDossier(ch, req.params.targetId, client, h)));
  app.get('/v1/leaderboard/wire', { preHandler: auth }, async () => Wire.wireLeaderboard(pool));
  // Wire step three: DISINFORMATION (feed your tappers lies) + THE INFORMANT (a standing human source)
  app.post('/v1/wire/disinfo', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Wire.plantDisinfo(ch, client, h)));
  app.post('/v1/wire/informant/:targetId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Wire.recruitInformant(ch, req.params.targetId, client, h)));

  // THE BLACK MARKET — P2P trade: cars by auction (bid/buy-now), goods fixed-price at the dock.
  app.get('/v1/market', async () => Market.marketBoard(pool));
  app.post('/v1/market', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Market.listItem(ch, req.body || {}, client, h)));
  app.post('/v1/market/:id/bid', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Market.bidListing(ch, req.params.id, req.body?.amount, client, h)));
  app.post('/v1/market/:id/buy', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Market.buyListing(ch, req.params.id, req.body?.qty, client, h)));
  app.post('/v1/market/:id/cancel', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Market.cancelListing(ch, req.params.id, client, h)));
  // step two — standing buy orders (WTB): post escrows cash at your dock; sellers fill from the
  // trunk and are paid on the spot; the buyer claims delivered goods into trunk space.
  app.post('/v1/market/order', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Market.postOrder(ch, req.body || {}, client, h)));
  app.post('/v1/market/:id/fill', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Market.fillOrder(ch, req.params.id, req.body?.qty, client, h)));
  app.post('/v1/market/:id/claim', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Market.claimOrder(ch, req.params.id, client, h)));

  // SMUGGLING CONVOYS — bulk goods in transit: load, guard, ship; ambush someone else's.
  app.get('/v1/convoys', { preHandler: auth }, async (req) => {
    const cid = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0]?.id;
    if (!cid) throw new G.GameError('no_character', 'Create a character first.');
    return Convoy.convoyBoard(pool, cid);
  });
  app.post('/v1/convoy', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Convoy.openConvoy(ch, req.body?.to, req.body?.goodId, req.body?.qty, client, h)));
  app.post('/v1/convoy/load', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Convoy.loadConvoy(ch, req.body?.goodId, req.body?.qty, client, h)));
  app.post('/v1/convoy/depart', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Convoy.departConvoy(ch, req.body?.guards, !!req.body?.insure, client, h)));
  app.post('/v1/convoy/cancel', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Convoy.cancelConvoy(ch, client, h)));
  app.post('/v1/convoy/:id/ambush', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Convoy.ambushConvoy(ch, req.params.id, client, h)));
  app.post('/v1/convoy/:id/collect', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Convoy.collectConvoy(ch, req.params.id, client, h)));

  // CREW HEISTS — THE BIG SCORE: plan, crew up off the board, execute together (or rat).
  app.get('/v1/heists', { preHandler: auth }, async (req) => {
    const cid = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0]?.id;
    if (!cid) throw new G.GameError('no_character', 'Create a character first.');
    return Heists.heistBoard(pool, cid);
  });
  app.post('/v1/heists/plan', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) =>
      Heists.planHeist(ch, req.body?.job, { role: req.body?.role, businessId: req.body?.businessId, fence: req.body?.fence }, client, h)));
  app.post('/v1/heists/:id/join', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Heists.joinHeist(ch, req.params.id, req.body?.role, client, h)));
  app.post('/v1/heists/:id/leave', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Heists.leaveHeist(ch, req.params.id, client, h)));
  app.post('/v1/heists/:id/case', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Heists.caseJob(ch, req.params.id, client, h)));
  app.post('/v1/heists/:id/rat', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Heists.ratHeist(ch, req.params.id, client, h)));
  app.post('/v1/heists/:id/execute', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Heists.executeHeist(ch, req.params.id, client, h)));
  app.post('/v1/heists/fence', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Heists.fenceLoot(ch, client, h)));
  app.get('/v1/leaderboard/heists', { preHandler: auth }, async () => Heists.heistLeaderboard(pool));

  // THE GAMBLING DEN (Neon Mile, cash only — never $OMR): street craps + the daily Numbers.
  app.post('/v1/casino/dice', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.playDice(ch, req.body?.amount, client, h)));
  app.post('/v1/casino/numbers', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.playNumbers(ch, req.body?.pick, req.body?.amount, client, h)));
  app.post('/v1/casino/numbers/claim', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.claimNumbers(ch, client, h)));
  // step two: back-room PvP dice (consent-by-listing), the weekly fight book + the neon fix
  app.post('/v1/casino/fade', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch) => Casino.setFadeLimit(ch, req.body?.limit)));
  app.post('/v1/casino/dice/:targetId', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, fader, client, h) =>
      Casino.pvpDice(ch, fader, req.body?.amount, client, h)));
  app.post('/v1/casino/fight', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.betFight(ch, req.body?.side, req.body?.amount, client, h)));
  app.post('/v1/casino/fight/claim', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.claimFight(ch, client, h)));
  app.post('/v1/casino/fight/fix', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.fixFight(ch, req.body?.winner, client, h)));
  // THE TRACK: the dogs & the ponies — a daily race card, one WIN bet per race per day
  app.post('/v1/casino/track', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.betTrack(ch, req.body?.race, req.body?.runner, req.body?.amount, client, h)));
  app.post('/v1/casino/track/claim', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.claimTrack(ch, client, h)));
  // step three — RUN IN THE CARD: enter one of your racers into today's card (the town bets on it)
  app.post('/v1/casino/track/enter/:racerId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.enterTrackRace(ch, req.params.racerId, client, h)));
  // Track step four: THE FUTURITY — nominate a player racer + bet parimutuel on the field (crowd-bet marquee)
  app.post('/v1/casino/futurity/nominate/:racerId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.nominateFuturity(ch, req.params.racerId, client, h)));
  app.post('/v1/casino/futurity/bet', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.betFuturity(ch, req.body?.racerId, req.body?.amount, client, h)));
  // step three: BLACKJACK (stateful PvE — deal/hit/stand/double) + heads-up HOLD'EM (PvP showdown)
  app.post('/v1/casino/blackjack', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.blackjackDeal(ch, req.body?.amount, client, h)));
  app.post('/v1/casino/blackjack/hit', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.blackjackHit(ch, client, h)));
  app.post('/v1/casino/blackjack/stand', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.blackjackStand(ch, client, h)));
  app.post('/v1/casino/blackjack/double', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.blackjackDouble(ch, client, h)));
  app.post('/v1/casino/poker/deal', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch) => Casino.setPokerLimit(ch, req.body?.limit)));
  app.post('/v1/casino/poker/:targetId', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, dealer, client, h) =>
      Casino.playPoker(ch, dealer, req.body?.amount, client, h)));
  // the scheduled POKER TOURNAMENT — buy in during the open window; the worker deals + settles
  app.post('/v1/casino/tournament', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.enterTournament(ch, client, h, { bracket: !!req.body?.bracket })));
  // step five — RING POKER: the multi-way stateful table (the table is an escrow; see src/ring.js)
  app.get('/v1/casino/ring', { preHandler: auth }, async (req) => {
    const ch = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0];
    return Ring.ringLobby(pool, ch);
  });
  app.get('/v1/casino/ring/:id', { preHandler: auth }, async (req) => {
    const ch = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0];
    return Ring.viewOf(pool, req.params.id, ch?.id);
  });
  app.post('/v1/casino/ring/open', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Ring.openTable(ch, req.body, client, h)));
  app.post('/v1/casino/ring/:id/sit', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Ring.sitAt(ch, req.params.id, req.body?.buyin, client, h)));
  app.post('/v1/casino/ring/:id/leave', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Ring.leaveTable(ch, req.params.id, client, h)));
  app.post('/v1/casino/ring/:id/deal', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Ring.dealHand(ch, req.params.id, client, h)));
  app.post('/v1/casino/ring/:id/act', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Ring.actAt(ch, req.params.id, req.body, client, h)));
  app.get('/v1/casino', { preHandler: auth }, async (req) => {
    const cid = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0]?.id;
    if (!cid) throw new G.GameError('no_character', 'Create a character first.');
    return Casino.denInfo(pool, cid);
  });

  app.get('/v1/gangs', async () => {
    // two flat queries instead of a correlated subquery — identical response, and pg-mem
    // (the test db) can execute it, so the route is actually covered by the suite
    const r = await pool.query('SELECT id, name, tag, seal, foundation, treasury, wars_won, lifetime_tribute FROM gangs');
    const counts = await pool.query('SELECT gang_id, COUNT(*) n FROM gang_members GROUP BY gang_id');
    const members = Object.fromEntries(counts.rows.map((c) => [c.gang_id, Number(c.n)]));
    return { gangs: r.rows.map((g) => ({ id: g.id, name: g.name, tag: g.tag,
      seal: sealOf(g.seal)?.name || null, foundation: foundationOf(g.foundation)?.name || null,
      members: members[g.id] || 0, warsWon: Number(g.wars_won),
      standing: Number(g.lifetime_tribute) + 10000 * Number(g.wars_won) })) };
  });
  app.get('/v1/gangs/:id', async (req) => {
    const client = await pool.connect();
    try { // war state resolves lazily on read
      await client.query('BEGIN');
      await S.resolveWarIfDue(client, req.params.id);
      const g = (await client.query('SELECT * FROM gangs WHERE id=$1', [req.params.id])).rows[0];
      if (!g) { await client.query('COMMIT'); return { gang: null }; }
      const members = (await client.query(
        'SELECT m.character_id, m.role, c.name FROM gang_members m JOIN characters c ON c.id = m.character_id WHERE m.gang_id=$1', [req.params.id])).rows;
      const held = (await client.query('SELECT id FROM districts WHERE holder_gang=$1', [req.params.id])).rows.map((d) => d.id);
      const territory = await Territory.territoryOf(client, req.params.id); // Phase 3 productive operations
      // R1 — the family's legit book: a seize-resistant status flex, valued at today's price.
      const famBook = (await client.query('SELECT ticker, shares FROM gang_portfolios WHERE gang_id=$1 AND shares>0 ORDER BY ticker', [req.params.id])).rows
        .map((r) => ({ ticker: r.ticker, shares: Math.round(Number(r.shares) * 1e6) / 1e6, price: tickerPriceOf(r.ticker),
          bookValue: Math.round(Number(r.shares) * tickerPriceOf(r.ticker) * 100) / 100 }));
      await client.query('COMMIT');
      return { gang: { id: g.id, name: g.name, tag: g.tag, color: g.color || null,
        seal: sealOf(g.seal)?.name || null, sealTier: Number(g.seal || 0),
        nextSeal: sealOf(Number(g.seal || 0) + 1) || null,
        foundation: foundationOf(g.foundation)?.name || null, foundationTier: Number(g.foundation || 0),
        foundationBustMult: foundationBustMult(Number(g.foundation || 0)),
        foundationBleedMult: foundationBleedMult(Number(g.foundation || 0)),
        nextFoundation: foundationOf(Number(g.foundation || 0) + 1) || null,
        treasury: Math.floor(Number(g.treasury)),
        ammoBank: Number(g.ammo_bank), omrReserve: Number(g.omr_reserve), warsWon: Number(g.wars_won),
        war: g.war_with ? { with: g.war_with, until: g.war_until, us: g.war_score_us, them: g.war_score_them } : null,
        weekly: { week: g.weekly_week, progress: Number(g.weekly_progress), done: g.weekly_done },
        members: members.map((m) => ({ id: m.character_id, name: m.name, role: m.role })), held, territory,
        empire: { earned: Math.floor(Number(g.territory_earned || 0)), rank: territoryRankOf(g.territory_earned || 0).name }, // THE EMPIRE (territory step two)
        syndicate: syndicateOf(territory), // TIER-4 §D — the specialization meta (same-type holding)
        portfolio: { holdings: famBook, bookValue: Math.round(famBook.reduce((a, r) => a + r.bookValue, 0) * 100) / 100 } } };
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  });
  app.get('/v1/districts', async () => {
    const r = await pool.query('SELECT d.id, d.holder_gang, d.garrison, d.npc_holder, g.name AS gang_name, g.tag FROM districts d LEFT JOIN gangs g ON g.id = d.holder_gang');
    // step five — THE OCCUPATION: quote the LIVE liberation cost for each NPC-garrisoned district (scales
    // with the occupying outfit's current strength, so the raid loop cheapens turf).
    const out = [];
    for (const d of r.rows) {
      const base = { id: d.id, perk: DISTRICTS.find((x) => x.id === d.id)?.perk,
        holder: d.holder_gang ? { gangId: d.holder_gang, name: d.gang_name, tag: d.tag } : null,
        garrison: Math.floor(Number(d.garrison)) };
      if (d.npc_holder) {
        const fx = worldNpcOf(d.npc_holder);
        const frac = await World.outfitStrengthFrac(pool, fx);
        base.occupiedBy = { npc: d.npc_holder, name: fx?.name || d.npc_holder, strengthPct: Math.round(frac * 100) };
        base.liberationCost = liberationCost(fx, frac);
      }
      out.push(base);
    }
    return { districts: out };
  });

  // ── M3: the streets (§5.2) ──
  app.get('/v1/streets', { preHandler: auth }, async () => {
    const r = await pool.query(`SELECT c.id, c.name, c.respect, c.loc, c.jail_until, c.hosp_until, c.guard_price, g.tag
      FROM characters c LEFT JOIN gang_members m ON m.character_id = c.id LEFT JOIN gangs g ON g.id = m.gang_id
      WHERE c.alive ORDER BY c.respect DESC LIMIT 100`);
    return { streets: r.rows.map((c) => ({ id: c.id, name: c.name, level: levelOf(Number(c.respect)),
      respect: Number(c.respect), loc: c.loc, gangTag: c.tag || null,
      // surface the bodyguard offer so the hire market is discoverable (a guard lists a price,
      // consent-by-listing; without this the whole earnable-defense feature is unreachable)
      guardPrice: c.guard_price != null ? Math.floor(Number(c.guard_price)) : null,
      jailed: !!(c.jail_until && new Date(c.jail_until) > new Date()),
      hospitalized: !!(c.hosp_until && new Date(c.hosp_until) > new Date()) })) };
  });
  app.post('/v1/streets/:targetId/jump', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, victim, client, h) => S.jump(ch, victim, client, h)));
  app.post('/v1/streets/:targetId/bounty', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.postBounty(ch, req.params.targetId, req.body?.amount, client, h,
      { kind: req.body?.kind, reason: req.body?.reason, hours: req.body?.hours, anon: req.body?.anon,
        hitman: req.body?.hitman, exclusiveHours: req.body?.exclusiveHours })));
  // The contract board — browse open contracts, and pull your own funding back.
  app.get('/v1/contracts', { preHandler: auth }, async () => ({ contracts: await S.listContracts(pool) }));
  // M8 counter-intel: the mark pays $OMR to read every funder on their own head (pierces anon).
  app.post('/v1/contracts/peek', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.peekContracts(ch, client, h)));
  app.post('/v1/contracts/:targetId/:kind/cancel', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.cancelBounty(ch, req.params.targetId, req.params.kind, client, h)));
  // The feared-assassin leaderboard (M7 Phase 2): lifetime legend + this season's kill streak.
  app.get('/v1/leaderboard/hitmen', { preHandler: auth }, async () => S.hitmanLeaderboard(pool));
  // The RECRUITERS (§7.13): the organic-growth hall of fame + the family recruitment board. Status only.
  app.get('/v1/leaderboard/recruiters', { preHandler: auth }, async () => ({
    recruiters: await W.recruiterLeaderboard(pool), families: await W.recruitingFamilyLeaderboard(pool),
    push: await G.referralPushStatus(pool) })); // the active recruitment DRIVE (2×… payouts), publicly visible
  // THE AGENT LEADERBOARD: a SEPARATE machine hall of fame (net worth / kills / $OMR extracted). See AGENTS.md.
  app.get('/v1/leaderboard/agents', { preHandler: auth }, async () => ({ agents: await W.agentLeaderboard(pool) }));
  // THE OPPORTUNITY BOARD (the agent-liquidity feature): every open economic action + standing
  // skill-loop with EV/risk signals, in ONE read. Read-only; the caller's character scopes filters.
  app.get('/v1/opportunities', { preHandler: auth }, async (req) => {
    const ch = (await pool.query('SELECT id, loc FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0] || null;
    return opportunityBoard(pool, ch);
  });
  // THE BLOOD-FEUD LEDGER: the public tally between MY bloodline and theirs — kills each way
  // (from kill_log), net bloodOwed (positive = they owe us bodies), and any active vendetta in
  // either direction. Pure reader; vendettas themselves are created by the estate.
  app.get('/v1/feud/:characterId', { preHandler: auth }, async (req) => {
    const myAcct = req.user.sub;
    const theirs = (await pool.query('SELECT account_id, name FROM characters WHERE id=$1', [req.params.characterId])).rows[0];
    if (!theirs) throw new G.GameError('no_target', 'Nobody by that name, living or dead.');
    const count = async (killer, victim) => Number((await pool.query(
      'SELECT COUNT(*) n FROM kill_log WHERE killer_account=$1 AND victim_account=$2', [killer, victim])).rows[0].n);
    const oursDown = await count(theirs.account_id, myAcct);   // bodies they took from us
    const theirsDown = await count(myAcct, theirs.account_id); // bodies we took from them
    const vend = async (a, b) => (await pool.query(
      'SELECT sworn, expires_at, kills FROM vendettas WHERE avenger_account=$1 AND target_account=$2 AND expires_at > now()', [a, b])).rows[0] || null;
    const mineV = await vend(myAcct, theirs.account_id), theirsV = await vend(theirs.account_id, myAcct);
    // step two: pending sit-down offers in either direction + the feud tier
    const offer = async (from, to) => !!(await pool.query('SELECT 1 FROM feud_peace_offers WHERE from_account=$1 AND target_account=$2', [from, to])).rows[0];
    return { bloodline: theirs.name, kills: { ours: theirsDown, theirs: oursDown },
      bloodOwed: oursDown - theirsDown, // positive: they owe us bodies
      myVendetta: mineV ? { sworn: mineV.sworn, kills: Number(mineV.kills), tier: feudTierOf(mineV.kills).name,
        expiresSeconds: Math.max(0, Math.ceil((new Date(mineV.expires_at) - Date.now()) / 1000)) } : null,
      theirVendetta: theirsV ? { kills: Number(theirsV.kills), tier: feudTierOf(theirsV.kills).name } : null,
      peace: { iOffered: await offer(myAcct, theirs.account_id), theyOffered: await offer(theirs.account_id, myAcct) } };
  });
  // VENDETTA step two — THE SIT-DOWN: offer / accept a consensual peace (clears both-direction feuds)
  app.post('/v1/feud/:targetId/peace', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.proposePeace(ch, req.params.targetId, client, h)));
  app.post('/v1/feud/:targetId/peace/accept', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.acceptPeace(ch, req.params.targetId, client, h)));
  app.get('/v1/leaderboard/feuds', { preHandler: auth }, async () => S.feudLeaderboard(pool));
  // M7 Phase 3: hire an NPC contractor for a rolled hit on a target (a ledgered cash sink).
  app.post('/v1/streets/:targetId/npchit', { preHandler: auth }, async (req) => {
    const r = await G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, victim, client, h) => S.npcHit(ch, victim, client, h, req.body?.tier));
    await closeSocketsOnKill(r, req.params.targetId);
    return r;
  });
  // M7 Phase 4: go to ground in a safehouse — earnable defense (untargetable by fire/NPC-hit).
  app.post('/v1/safehouse', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.enterSafehouse(ch, client, h)));
  // M7 Phase 4: family contracts — the boss posts (and cancels) a contract funded from the treasury.
  app.post('/v1/gangs/contract/:targetId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.postFamilyContract(ch, req.params.targetId, req.body?.amount, client, h,
      { kind: req.body?.kind, reason: req.body?.reason, hours: req.body?.hours, anon: req.body?.anon })));
  app.post('/v1/gangs/contract/:targetId/:kind/cancel', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.cancelFamilyContract(ch, req.params.targetId, req.params.kind, client, h)));
  // M7 Phase 4: bodyguards — list yourself for hire; hire a listed guard (two-party, ledgered transfer).
  app.post('/v1/bodyguard/offer', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.offerBodyguard(ch, req.body?.price, client, h)));
  app.post('/v1/bodyguard/hire/:guardId', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.guardId, (ch, guard, client, h) => S.hireBodyguard(ch, guard, client, h)));
  // M8: the Tailor & Engraver — vanity/identity $OMR sinks (display-only; every burn ledgered 'vanity:*').
  app.post('/v1/vanity/name', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => V.changeName(ch, req.body?.name, client, h)));
  app.post('/v1/vanity/title', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => V.setTitle(ch, req.body?.title, client, h)));
  app.post('/v1/vanity/plate/:carId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => V.setPlate(ch, req.params.carId, req.body?.plate, client, h)));
  app.post('/v1/gangs/vanity/color', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => V.recolorGang(ch, req.body?.color, client, h)));
  app.post('/v1/gangs/vanity/name', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => V.renameGang(ch, req.body?.name, req.body?.tag, client, h)));
  app.post('/v1/gangs/vanity/seal', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => V.buySeal(ch, client, h)));
  app.post('/v1/gangs/foundation', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => V.buyFoundation(ch, client, h)));
  app.post('/v1/streets/:targetId/search', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.startSearch(ch, req.params.targetId, client, h)));
  app.delete('/v1/streets/search', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client) => S.callOffSearch(ch, client)));
  app.post('/v1/streets/:targetId/fire', { preHandler: auth }, async (req) => {
    const r = await G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, victim, client, h) => S.fire(ch, victim, client, h, req.body?.rounds));
    await closeSocketsOnKill(r, req.params.targetId); // a kill left the victim's account gangless — cut its stale gang: feed
    return r;
  });
  app.post('/v1/streets/:targetId/bust', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, victim, client, h) => S.bust(ch, victim, client, h)));

  // ── M3: the exchange (§5.4, escrowed order book) ──
  app.get('/v1/exchange', async () => {
    const r = await pool.query('SELECT l.*, c.name AS seller_name FROM listings l JOIN characters c ON c.id = l.seller_character ORDER BY l.created_at');
    return { listings: r.rows.map((l) => ({ id: l.id, seller: l.seller_name, kind: l.item_kind,
      itemId: l.item_id, qty: Number(l.qty), unitPrice: Number(l.unit_price) })) };
  });
  app.post('/v1/exchange/list', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.listItem(ch, req.body?.kind, req.body?.itemId, req.body?.qty, req.body?.unitPrice, client, h)));
  app.delete('/v1/exchange/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.cancelListing(ch, req.params.id, client, h)));
  app.post('/v1/exchange/:id/buy', { preHandler: auth }, async (req) => {
    const l = (await pool.query('SELECT seller_character FROM listings WHERE id=$1', [req.params.id])).rows[0];
    if (!l) throw new G.GameError('gone', 'Too slow — someone else took that lot.');
    return G.withTwoCharacters(pool, req.user.sub, l.seller_character,
      (ch, seller, client, h) => S.buyListing(ch, seller, client, h, req.params.id));
  });

  // ── M3: notifications (§3.3) — reading marks delivered ──
  app.get('/v1/notifications', { preHandler: auth }, async (req) => {
    const me = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0];
    if (!me) return { notifications: [] };
    // flip-and-return in one statement: a plain SELECT-then-UPDATE would silently
    // drop any notification inserted between the two queries
    const r = await pool.query('UPDATE notifications SET delivered=true WHERE character_id=$1 AND NOT delivered RETURNING *', [me.id]);
    const rows = r.rows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return { notifications: rows.map((n) => ({ id: n.id, type: n.type, payload: JSON.parse(n.payload), at: n.created_at })) };
  });

  // ── M3: websocket gateway (§5.6) — channels: me, streets, gang:{id} ──
  await app.register(websocket);
  // (red-team R4 auth F1) A live intel-feed registry keyed by account — the connect-time banned
  // check (below) only guards NEW connections, so a mid-session ban left an already-open socket
  // feeding streets/gang chatter until the client chose to disconnect, falsifying the documented
  // "banned-WS close" guarantee. The ban handler closes every open socket for the banned account.
  const wsClients = new Map(); // accountId -> Set<socket>
  const wsReserving = new Map(); // accountId -> in-flight connection count (TOCTOU-safe cap)
  const WS_MAX_PER_ACCOUNT = 8; // (red-team R7 DoS) one token can't open unlimited sockets — each adds a
  // 'streets' bus listener, so N sockets make every streets emit O(N) server-wide; 8 covers legit multi-tab.
  const WS_PING_MS = Number(process.env.WS_PING_MS || 30_000); // heartbeat: reap half-open/dead sockets
  app.get('/v1/ws', { websocket: true }, async (socket, req) => {
    let accountId;
    // (red-team R12 F2) The session JWT is the same full bearer used on every REST call. Passing it in
    // the WS URL query (`?token=`) leaks it into web-server/proxy/CDN access logs + browser history →
    // token theft → account takeover. Read it from the Sec-WebSocket-Protocol header instead (the client
    // offers it as a subprotocol value: "bearer, <token>"), which is NOT logged. Our own console uses
    // the header path (R12).
    // (red-team R14 F1) The `?token=` fallback is now GATED (default OFF) behind WS_ALLOW_QUERY_TOKEN —
    // a live query-string credential path is a standing account-takeover surface the header path retired,
    // so it's off unless an operator explicitly re-enables it for a legacy client (the fail-closed
    // INVITE_MODE/SOCIAL_VERIFY_MODE posture). The WS tests set it on.
    const sub = String(req.headers['sec-websocket-protocol'] || '').split(',').map((s) => s.trim());
    const headerBearer = sub[0] === 'bearer' ? sub[1] : null;
    const allowQuery = process.env.WS_ALLOW_QUERY_TOKEN === 'on';
    const bearer = headerBearer || (allowQuery ? req.query?.token : null);
    try { accountId = app.jwt.verify(String(bearer || '')).sub; }
    catch { socket.close(4001, 'auth'); return; }
    // (red-team R9 WS) The per-account cap was a TOCTOU: it read the Set size but only ADDED the socket
    // after three awaited queries, so concurrent connects for one token all observed size<MAX and all
    // registered — blowing past the cap (→ server-wide 'streets' fan-out amplification + fd/memory DoS).
    // Reserve a slot SYNCHRONOUSLY (no await between read and increment, single-threaded turn) and count
    // in-flight reservations alongside registered sockets. Released in `finally` once the socket is either
    // registered (now counted in the Set) or rejected — no gap, no double-count.
    const live = wsClients.get(accountId)?.size || 0;
    const reserving = wsReserving.get(accountId) || 0;
    if (live + reserving >= WS_MAX_PER_ACCOUNT) { socket.close(4008, 'too_many'); return; }
    wsReserving.set(accountId, reserving + 1);
    const releaseReservation = () => { const n = (wsReserving.get(accountId) || 1) - 1; if (n > 0) wsReserving.set(accountId, n); else wsReserving.delete(accountId); };
    try {
      // banned accounts must not keep a live intel feed (REST re-checks per request;
      // the socket is long-lived, so check status at connect)
      const acct = (await pool.query('SELECT status FROM accounts WHERE id=$1', [accountId])).rows[0];
      if (!acct || acct.status === 'banned') { socket.close(4003, 'banned'); return; }
      const me = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [accountId])).rows[0];
      if (!me) { socket.close(4004, 'no_character'); return; }
      const gm = (await pool.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [me.id])).rows[0];
      const send = (channel) => (event) => { try { socket.send(JSON.stringify({ channel, ...event })); } catch { /* gone */ } };
      const subs = [[`me:${me.id}`, send('me')], ['streets', send('streets')],
        ['activity', send('activity')], ['chat', send('chat')]]; // the public wire: town-wide action ticker + the troll box
      if (gm?.gang_id) subs.push([`gang:${gm.gang_id}`, send('gang')]);
      for (const [ev, fn] of subs) G.bus.on(ev, fn);
      let set = wsClients.get(accountId); if (!set) wsClients.set(accountId, set = new Set()); set.add(socket);
      // (red-team R9 WS) `app.register(websocket)` sets no keepalive, so half-open/dead sockets never get
      // reaped and their bus listeners accumulate forever. Standard heartbeat: ping every WS_PING_MS; a
      // browser auto-pongs (so legit idle viewers stay connected), a dead/half-open socket misses two
      // cycles and is terminated. unref()'d so the timer never holds the process open (clean test exit).
      let alive = true;
      socket.on('pong', () => { alive = true; });
      const hb = setInterval(() => {
        if (!alive) { try { socket.terminate(); } catch { /* gone */ } return; }
        alive = false; try { socket.ping(); } catch { /* gone */ }
      }, WS_PING_MS);
      hb.unref?.();
      socket.on('close', () => {
        clearInterval(hb);
        for (const [ev, fn] of subs) G.bus.off(ev, fn);
        const s = wsClients.get(accountId); if (s) { s.delete(socket); if (!s.size) wsClients.delete(accountId); }
      });
      socket.send(JSON.stringify({ channel: 'hello', characterId: me.id }));
    } finally {
      releaseReservation();
    }
  });
  // close every live socket for an account (its own 'close' handler tears down the bus subs + registry)
  const closeAccountSockets = (accountId, code, reason) => {
    const s = wsClients.get(accountId); if (!s) return;
    for (const sock of [...s]) { try { sock.close(code, reason); } catch { /* already gone */ } }
  };
  // (red-team R26 WS) A killed character's account is left GANGLESS (runEstate → removeMember; the heir is
  // born with no family), but its live socket keeps the dead street's `gang:` subscription — a stale mole
  // into the former family's private war/contract/tribute/racket feed. runEstate can't reach wsClients
  // (a buildApp closure), so the KILL ROUTES must close the victim's sockets post-COMMIT, mirroring the
  // leave/kick fix (R9). Look the account up server-side by the victim CHARACTER id (the row survives as
  // alive=false — never deleted), never exposing the account UUID. Non-fatal like kick: a throw here would
  // surface a 5xx AFTER the kill committed → the onSend idempotency release → a retry re-runs the kill.
  const closeSocketsOnKill = async (result, victimCharId) => {
    try {
      if (!(result && (result.kill === true || result.killed === true)) || !victimCharId) return;
      const acc = (await pool.query('SELECT account_id FROM characters WHERE id=$1', [victimCharId])).rows[0];
      if (acc) closeAccountSockets(acc.account_id, 4009, 'gang_changed');
    } catch (e) { console.error('kill socket-close (post-commit, non-fatal)', e?.code || e); }
  };

  // ── PRESENCE — who's on the wire right now (founder: "display of all users online") ──
  // `online` = distinct accounts with a live websocket (in the console this second);
  // `active15m` = distinct accounts with any telemetry in the last 15 min (playing, maybe over REST).
  // Keyless + cached 15s so the badge poll costs ~nothing.
  let onlineCache = { at: 0, active15m: 0 };
  app.get('/v1/online', async () => {
    if (Date.now() - onlineCache.at > 15000) {
      const r = await pool.query('SELECT COUNT(DISTINCT account_id) c FROM telemetry WHERE at > $1',
        [new Date(Date.now() - 15 * 60000)]);
      onlineCache = { at: Date.now(), active15m: Number(r.rows[0].c) };
    }
    return { online: wsClients.size, active15m: Math.max(wsClients.size, onlineCache.active15m) };
  });

  // ── THE ACTION WIRE — a public, color-coded ticker of PUBLIC-SAFE acts (founder: "activity feed
  // of whenever any user performs any action, color coded"). DELIBERATELY an allowlist: covert acts
  // (searches, taps, bank moves, kitchen deals, port runs, laundering) must NOT leak — the game's
  // info economy (anonymity, wealth bands, hidden hunts) is audited design. Only acts that are
  // already public-by-design (or harmlessly flavorful) are announced, and never with amounts.
  const ACTIVITY_WIRE = {
    // (founder) the specific job, not a generic line — the crime id is already public (the whole
    // book is on /v1/rules) and the line carries no amounts, so naming it leaks nothing new
    'POST /v1/crimes/:id': ['crime', (req) => {
      const c = CRIMES.find((x) => x.id === req.params?.id);
      return c ? `pulled a job — ${c.name}` : 'pulled a job';
    }],
    'POST /v1/heist': ['crime', 'pulled a score'],
    'POST /v1/travel/:district': ['move', 'is on the move'],
    'POST /v1/casino/dice': ['den', 'is rolling dice at the den'],
    'POST /v1/casino/numbers': ['den', 'played the numbers'],
    'POST /v1/casino/blackjack': ['den', 'sat down at the blackjack table'],
    'POST /v1/casino/track': ['den', 'bet the races at the track'],
    'POST /v1/casino/tournament': ['den', 'entered the poker tournament'],
    'POST /v1/races/npc': ['race', 'ran the street circuit'],
    'POST /v1/races/challenge/:ownerId': ['race', 'raced for money on the strip'],
    'POST /v1/races/pinks/:ownerId': ['race', 'raced for pink slips'],
    'POST /v1/races/gp': ['race', 'entered the Grand Prix'],
    'POST /v1/stable/circuit/:racerId': ['race', 'raced an animal on the circuit'],
    'POST /v1/boxing/exhibition': ['fights', 'put a fighter in the ring'],
    'POST /v1/boxing/fight/:opponentId': ['fights', 'staked a fighter in a bout'],
    'POST /v1/boxing/recruit': ['fights', 'signed a contender'],
    'POST /v1/duels/:targetId': ['fights', 'fought a ranked duel'],
    'POST /v1/market': ['market', 'posted a Black Market listing'],
    'POST /v1/market/order': ['market', 'posted a buy order'],
    'POST /v1/auction/:lotId/bid': ['flex', 'bid on the Auction Block'],
    'POST /v1/speakeasy/:district/round': ['vice', 'bought a round at a speakeasy'],
    'POST /v1/speakeasy/:district/bottle': ['vice', 'ordered bottle service'],
    'POST /v1/world/:id/raid': ['world', 'raided a cartel outfit'],
    'POST /v1/world/raids/:id/go': ['world', 'led a crew raid on a cartel'],
  };
  // (B3) FIFO-bound the two in-process caches so a long-lived API process can't grow them without
  // limit (one entry per account ever seen). A Map preserves insertion order, so evict the oldest
  // key once over the cap — the caches are best-effort (a 60s name cache / a 2s flood brake), so
  // dropping the coldest entry is harmless.
  const capMap = (m, cap = 20000) => { while (m.size > cap) m.delete(m.keys().next().value); };
  const actorNames = new Map(); // accountId -> { name, at } (60s cache — one indexed read per miss)
  const actorName = async (accountId) => {
    const hit = actorNames.get(accountId);
    if (hit && Date.now() - hit.at < 60000) return hit.name;
    const r = (await pool.query('SELECT name FROM characters WHERE account_id=$1 AND alive', [accountId])).rows[0];
    const name = r?.name || null;
    actorNames.set(accountId, { name, at: Date.now() }); capMap(actorNames);
    return name;
  };
  app.addHook('onResponse', async (req, reply) => {
    try {
      if (reply.statusCode < 200 || reply.statusCode >= 300 || !req.user?.sub) return;
      const key = `${req.method} ${req.routeOptions?.url || ''}`;
      const hit = ACTIVITY_WIRE[key];
      if (!hit) return;
      const who = await actorName(req.user.sub);
      const text = typeof hit[1] === 'function' ? hit[1](req) : hit[1];
      if (who) G.bus.emit('activity', { type: 'act', cat: hit[0], who, text });
    } catch { /* the wire is decorative — never fail a request for it */ }
  });

  // ── THE TROLL BOX — public city chat + a family-only room (founder request). Pure talk:
  // zero §10.4 surface, name snapshots (history survives death/rename), server-side cleanText +
  // a 240-char clamp + a 2s per-account cooldown on top of the global rate buckets. Retention is
  // the worker's 7-day sweep. Family room = the sender's CURRENT gang; reads are member-gated. ──
  const lastChatAt = new Map(); // accountId -> ms (in-process flood brake)
  const chatChar = async (accountId) => (await pool.query(
    `SELECT c.id, c.name, gm.gang_id, gm.joined_at FROM characters c
       LEFT JOIN gang_members gm ON gm.character_id = c.id
      WHERE c.account_id=$1 AND c.alive`, [accountId])).rows[0];
  const postChat = async (req, family) => {
    const body = G.cleanText(req.body?.text ?? '').trim().slice(0, 240);
    if (!body) throw new G.GameError('empty', 'say something');
    const ch = await chatChar(req.user.sub);
    if (!ch) throw new G.GameError('no_character', 'no living street');
    if (family && !ch.gang_id) throw new G.GameError('no_gang', 'you need a family for the family room');
    // the flood brake LAST — semantic errors surface first, and only a landed line arms it
    const last = lastChatAt.get(req.user.sub) || 0;
    if (Date.now() - last < 2000) throw new G.GameError('slow_down', 'easy — one line at a time');
    lastChatAt.set(req.user.sub, Date.now()); capMap(lastChatAt);
    const channel = family ? ch.gang_id : 'city';
    const id = crypto.randomUUID();
    await pool.query('INSERT INTO chat_messages (id, channel, character_id, name, body) VALUES ($1,$2,$3,$4,$5)',
      [id, channel, ch.id, ch.name, body]);
    const ev = { type: 'chat', who: ch.name, text: body, at: Date.now() };
    if (family) G.bus.emit(`gang:${ch.gang_id}`, ev); else G.bus.emit('chat', ev);
    return { ok: true };
  };
  const readChat = async (req, family) => {
    const ch = await chatChar(req.user.sub);
    if (!ch) throw new G.GameError('no_character', 'no living street');
    if (family && !ch.gang_id) return { messages: [] };
    const channel = family ? ch.gang_id : 'city';
    // the family room shows only messages from AFTER you joined — a spy who slips into a family
    // can't read its back-chat (war planning, contracts). City chat has no floor.
    const since = family ? (ch.joined_at || new Date(0)) : new Date(0);
    const rows = (await pool.query(
      'SELECT name, body, at FROM chat_messages WHERE channel=$1 AND at >= $2 ORDER BY at DESC LIMIT 50',
      [channel, since])).rows;
    return { messages: rows.reverse().map((r) => ({ who: r.name, text: r.body, at: r.at })) };
  };
  app.post('/v1/chat', { preHandler: auth }, async (req) => postChat(req, false));
  app.get('/v1/chat', { preHandler: auth }, async (req) => readChat(req, false));
  app.post('/v1/gangs/chat', { preHandler: auth }, async (req) => postChat(req, true));
  app.get('/v1/gangs/chat', { preHandler: auth }, async (req) => readChat(req, true));

  // ── THE CELLPHONE (founder request) — inbox + player-to-player DMs. Pure talk, zero §10.4;
  // account-keyed threads survive death (the heir inherits the phone). src/phone.js. ──
  app.get('/v1/phone', { preHandler: auth }, async (req) => Phone.phoneBoard(pool, req.user.sub));
  app.get('/v1/phone/thread/:characterId', { preHandler: auth }, async (req) =>
    Phone.readThread(pool, req.user.sub, req.params.characterId));
  app.post('/v1/phone/dm/:characterId', { preHandler: auth }, async (req) =>
    Phone.sendDm(pool, req.user.sub, req.params.characterId, req.body?.text));
  app.post('/v1/phone/block/:characterId', { preHandler: auth }, async (req) =>
    Phone.blockLine(pool, req.user.sub, req.params.characterId));
  app.delete('/v1/phone/block/:characterId', { preHandler: auth }, async (req) =>
    Phone.unblockLine(pool, req.user.sub, req.params.characterId));

  // ── M4: the Kitchen (§5.3, §7.10) ──
  app.post('/v1/kitchen/makings/:drugId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => K.buyMakings(ch, req.params.drugId, req.body?.qty, client, h)));
  app.post('/v1/kitchen/lab/upgrade', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => K.upgradeLab(ch, client, h)));
  app.post('/v1/kitchen/cook', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => K.cook(ch, req.body?.drugId, req.body?.qty, client, h)));
  app.post('/v1/kitchen/collect', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => K.collect(ch, client, h)));
  app.post('/v1/kitchen/deal', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => K.deal(ch, req.body?.drugId, req.body?.qty, client, h)));
  app.post('/v1/kitchen/crew/hire', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => K.hireCrew(ch, client, h)));
  // recurring sinks: pay the crew's nut (wages) — an unpaid crew downs tools until covered
  app.post('/v1/kitchen/crew/wages', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => K.payCrewWages(ch, client, h)));
  app.post('/v1/kitchen/laylow', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => K.layLow(ch, client, h)));
  app.post('/v1/kitchen/cleanpapers', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => K.cleanPapers(ch, client, h)));
  // ── THE KITCHEN → Tier 4 ──
  app.post('/v1/kitchen/module/:mod', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => K.upgradeModule(ch, req.params.mod, client, h)));
  app.post('/v1/kitchen/cut/:drugId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => K.cutStash(ch, req.params.drugId, client, h)));
  app.get('/v1/leaderboard/kingpins', async () => K.kingpinLeaderboard(pool));

  // ── M4: growth (§5.1) ──
  app.post('/v1/path', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => W.choosePath(ch, req.body?.path, client, h)));
  // M8: stat respec — redistribute trained points (sum-conserving, $OMR burn).
  app.post('/v1/respec', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => W.respec(ch, req.body, client, h)));
  app.post('/v1/heist', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => W.heist(ch, client, h)));
  app.post('/v1/missions/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => W.doMission(ch, req.params.id, client, h)));
  app.get('/v1/daily', { preHandler: auth }, async (req) => {
    const me = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0];
    if (!me) throw new G.GameError('no_character', 'Create a character first.');
    return W.getDaily(pool, me.id);
  });
  app.post('/v1/daily/:id/claim', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => W.claimDaily(ch, req.params.id, client, h)));
  app.get('/v1/onboard', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => W.onboardBoard(ch, h)));
  // THE STREET WAGE (the value-creation pivot) — the public emission board: epoch, budget, your progress
  app.get('/v1/wage', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Emission.wageBoard(client, ch, h.acct)));

  // ── FIVE PILLARS: diplomacy (#2), sovereignty (#3), campaigns (#4), the bloodline (#5) ──
  app.get('/v1/diplomacy', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Diplomacy.diplomacyBoard(client, h)));
  app.post('/v1/diplomacy/pact/:gangId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Diplomacy.proposePact(ch, req.params.gangId, client, h)));
  app.post('/v1/diplomacy/pact/:gangId/accept', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Diplomacy.acceptPact(ch, req.params.gangId, client, h)));
  app.delete('/v1/diplomacy/pact/:gangId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Diplomacy.breakPact(ch, req.params.gangId, client, h)));
  app.post('/v1/diplomacy/coalition/:gangId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Diplomacy.formCoalition(ch, req.params.gangId, client, h)));
  app.post('/v1/diplomacy/coalition/:id/join', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Diplomacy.joinCoalition(ch, req.params.id, client, h)));
  app.delete('/v1/diplomacy/coalition/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Diplomacy.leaveCoalition(ch, req.params.id, client, h)));
  app.get('/v1/sov', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Sov.sovBoard(client, h)));
  app.post('/v1/sov/:district/build', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Sov.buildSov(ch, req.params.district, req.body?.windowHour, client, h)));
  app.post('/v1/sov/:district/upgrade', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Sov.upgradeSov(ch, req.params.district, client, h)));
  app.post('/v1/sov/upkeep', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Sov.paySovUpkeep(ch, client, h)));
  app.post('/v1/sov/:district/siege', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Sov.siegeSov(ch, req.params.district, client, h)));
  app.post('/v1/sov/collect', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Sov.collectSov(ch, client, h)));
  app.get('/v1/leaderboard/sov', { preHandler: auth }, async () => Sov.sovLeaderboard(pool));
  app.get('/v1/campaigns', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Campaigns.campaignBoard(ch, client, h)));
  app.post('/v1/campaigns/:id/start', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Campaigns.startCampaign(ch, req.params.id, client, h)));
  app.post('/v1/campaigns/:id/choose', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Campaigns.chooseCampaign(ch, req.params.id, req.body?.branch, client, h)));
  app.post('/v1/campaigns/:id/claim', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Campaigns.claimCampaign(ch, req.params.id, client, h)));
  app.get('/v1/bloodline', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Bloodline.bloodlineBoard(ch, client, h)));
  app.get('/v1/leaderboard/bloodline', { preHandler: auth }, async () => Bloodline.bloodlineLeaderboard(pool));
  // DYNASTIC MARRIAGES & THE CONSIGLIERE (CK3 — account-level ties on the Bloodline)
  app.get('/v1/dynasty', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client) => Dynasty.dynastyBoard(ch, client)));
  app.post('/v1/dynasty/propose/:characterId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Dynasty.proposeMarriage(ch, req.params.characterId, client, h)));
  app.post('/v1/dynasty/accept/:accountId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Dynasty.acceptMarriage(ch, req.params.accountId, client, h)));
  app.post('/v1/dynasty/divorce', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Dynasty.divorceMarriage(ch, client, h)));
  app.post('/v1/dynasty/consigliere/:characterId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Dynasty.nameConsigliere(ch, req.params.characterId, client, h)));
  app.post('/v1/dynasty/consigliere/accept/:accountId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Dynasty.acceptConsigliere(ch, req.params.accountId, client, h)));
  app.delete('/v1/dynasty/consigliere', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client) => Dynasty.endConsigliere(ch, client, req.query?.role || req.body?.role || null)));
  // NAMED SOLDIERS (XCOM — recruit / assign / dismiss; the assists live inside crime/heist/raids)
  app.get('/v1/soldiers', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Soldiers.soldierBoard(ch, client, h.acct)));
  app.get('/v1/leaderboard/commanders', { preHandler: auth }, async () => Soldiers.commanderLeaderboard(pool));
  app.post('/v1/soldiers/hire', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Soldiers.hireSoldier(ch, client, h)));
  app.post('/v1/soldiers/:id/assign', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client) => Soldiers.assignSoldier(ch, req.params.id, client)));
  app.post('/v1/soldiers/unassign', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client) => Soldiers.unassignSoldier(ch, client)));
  app.delete('/v1/soldiers/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client) => Soldiers.dismissSoldier(ch, req.params.id, client)));
  // BLACKMAIL & SECRETS (CK3 intrigue — dig / extort / pay the hush / expose)
  app.get('/v1/secrets', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client) => Secrets.secretsBoard(ch, client)));
  app.post('/v1/wire/dig/:targetId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Secrets.digSecret(ch, req.params.targetId, client, h)));
  app.post('/v1/secrets/:id/extort', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Secrets.extortSecret(ch, req.params.id, req.body?.demand, client, h)));
  // the mark pays the hush — two-party (the holder is the counterparty); the holder is resolved
  // from the secret row up front so withTwoCharacters can lock both char rows sorted
  app.post('/v1/secrets/:id/pay', { preHandler: auth }, async (req) => {
    const s = (await pool.query('SELECT holder_character FROM secrets WHERE id=$1', [req.params.id])).rows[0];
    if (!s) return { error: 'no_secret', message: 'That page has already turned.' };
    return G.withTwoCharacters(pool, req.user.sub, s.holder_character,
      (ch, holder, client, h) => Secrets.payHush(ch, holder, req.params.id, client, h));
  });
  // expose — two-party (the holder + the mark's living street; both rows held so the meter bump
  // rides the mark's positional persist)
  app.post('/v1/secrets/:id/expose', { preHandler: auth }, async (req) => {
    const s = (await pool.query('SELECT target_account FROM secrets WHERE id=$1', [req.params.id])).rows[0];
    if (!s) return { error: 'no_secret', message: 'That page has already turned.' };
    const mark = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [s.target_account])).rows[0];
    if (!mark) return { error: 'gone', message: 'The dirt died with them.' };
    return G.withTwoCharacters(pool, req.user.sub, mark.id,
      (ch, markCh, client, h) => Secrets.exposeSecret(ch, markCh, req.params.id, client, h));
  });
  // THE COLLECTION — the account-level completion ledger (pure status)
  app.get('/v1/collection', { preHandler: auth }, async (req) => Collection.collectionBoard(pool, req.user.sub));
  app.get('/v1/leaderboard/collection', { preHandler: auth }, async () => Collection.collectionLeaderboard(pool));
  app.post('/v1/onboard/:taskId/claim', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => W.claimOnboard(ch, req.params.taskId, client, h)));
  // DAILY SOCIAL TASKS ("Spread the Word") — the organic word-of-mouth / referral petty-cash faucet
  app.get('/v1/social', { preHandler: auth }, async (req) => {
    const me = (await pool.query('SELECT id, name FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0];
    return W.socialBoard(pool, req.user.sub, me);
  });
  app.post('/v1/social/:taskId/claim', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => W.claimSocial(ch, req.params.taskId, req.body?.proof, client, h)));
  // Wallet linking is SIWE now (EVM migration): the base58/no-proof path is retired. A real
  // 0x link — the only thing that sets wallet_address and satisfies the ob_wallet reward —
  // goes through POST /v1/wallet/challenge → POST /v1/wallet/verify (chain.js).
  app.post('/v1/wallet', { preHandler: auth }, async () => {
    throw new G.GameError('use_siwe', 'Wallet linking moved to sign-in-with-Ethereum: call POST /v1/wallet/challenge, sign it, then POST /v1/wallet/verify.');
  });

  // ── M4: mod tools (§10.3) — X-Mod-Key header; disabled unless MOD_KEY is set ──
  app.post('/v1/mod/ban', { preHandler: modAuth }, async (req) => {
    const { accountId, reason } = req.body || {};
    if (!accountId) throw new G.GameError('args', 'accountId required.');
    await pool.query("UPDATE accounts SET status='banned' WHERE id=$1", [accountId]);
    await pool.query('INSERT INTO bans (account_id, kind, reason, by_mod) VALUES ($1,$2,$3,$4)',
      [accountId, 'ban', reason || null, 'mod']);
    closeAccountSockets(accountId, 4003, 'banned'); // red-team R4 F1: cut the live intel feed now, not at their leisure
    return { ok: true };
  });
  app.post('/v1/mod/kill', { preHandler: modAuth }, async (req) => {
    // runs the §7.9 estate without a killer ("THE COMMISSION")
    const { characterId, reason } = req.body || {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const victim = (await client.query('SELECT * FROM characters WHERE id=$1 AND alive FOR UPDATE', [characterId])).rows[0];
      if (!victim) throw new G.GameError('no_target', 'No living character by that id.');
      const victimAcct = (await client.query('SELECT * FROM account_persistent WHERE account_id=$1 FOR UPDATE', [victim.account_id])).rows[0];
      const victimOwned = await G.loadOwned(client, victim);
      const h = { ledger: G.ledger, notify: G.notify, victimAcct, victimOwned };
      const estate = await S.runEstate(client, h, victim, 'THE COMMISSION'); // tracks the death itself
      await client.query('UPDATE account_persistent SET prestige=$2, deaths=$3 WHERE account_id=$1',
        [victim.account_id, victimAcct.prestige, victimAcct.deaths]);
      if (reason) await G.track(client, victim.account_id, 'mod_kill_reason', { reason });
      await client.query('COMMIT');
      closeAccountSockets(victim.account_id, 4009, 'gang_changed'); // R26 WS: the heir is gangless — cut the dead street's stale gang: feed
      return { ok: true, heirId: estate.heirId };
    // runEstate → removeMember can hit a war-partner AB-BA (40P01); this hand-rolled txn isn't
    // wrapped by withCharacter, so map it to a clean retry here too (audit MED) instead of a 500.
    } catch (e) { await client.query('ROLLBACK'); throw G.deadlockToRetry(e); }
    finally { client.release(); }
  });
  app.post('/v1/mod/confiscate', { preHandler: modAuth }, async (req) => {
    // seized cash recycles into the street-tax pool (next buyback)
    const { characterId, amount } = req.body || {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ch = (await client.query('SELECT * FROM characters WHERE id=$1 AND alive FOR UPDATE', [characterId])).rows[0];
      if (!ch) throw new G.GameError('no_target', 'No living character by that id.');
      // clamp to [0, pocket] (audit M2): a negative `amount` was truthy, so `cash - (-x)` MINTED
      // cash to the player and drained the street-tax pool below zero (a §10.4-invisible mint into
      // an unaudited buffer). A MISSING amount keeps the documented "confiscate all" default;
      // an explicit invalid/negative amount confiscates NOTHING (never mints, never "all" on a typo).
      const pocket = Math.max(0, Math.floor(Number(ch.cash)));
      let want;
      if (amount === undefined || amount === null || amount === '') want = pocket; // "confiscate all"
      else { const n = Number(amount); want = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; }
      const amt = Math.max(0, Math.min(want, pocket));
      await client.query('UPDATE characters SET cash = cash - $2 WHERE id=$1', [characterId, amt]);
      await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [amt]);
      await G.ledger(client, { characterId, currency: 'cash', amount: -amt, reason: 'mod:confiscate' });
      await client.query('COMMIT');
      return { ok: true, confiscated: amt };
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  });
  app.post('/v1/mod/invites', { preHandler: modAuth }, async (req) => {
    const count = Math.min(100, Math.max(1, Math.floor(Number(req.body?.count) || 1)));
    const uses = Math.max(1, Math.floor(Number(req.body?.uses) || 1));
    const codes = [];
    for (let i = 0; i < count; i++) {
      const code = crypto.randomBytes(6).toString('hex');
      await pool.query('INSERT INTO invite_codes (code, uses_left, created_by) VALUES ($1,$2,$3)', [code, uses, 'mod']);
      codes.push(code);
    }
    return { codes, uses };
  });
  // Start a time-boxed RECRUITMENT DRIVE — referral CASH payouts multiply for the window. Also readable.
  app.post('/v1/mod/referral/push', { preHandler: modAuth }, async (req) =>
    G.startReferralPush(pool, req.body?.hours, req.body?.mult));
  app.get('/v1/mod/referral/push', { preHandler: modAuth }, async () => G.referralPushStatus(pool));
  app.get('/v1/mod/invariants', { preHandler: modAuth }, async () => runLedgerInvariants(pool));
  app.get('/v1/mod/funnel', { preHandler: modAuth }, async () => W.funnelStats(pool)); // new-player onboarding drop-off
  app.get('/v1/mod/overview', { preHandler: modAuth }, async () => Ops.opsOverview(pool)); // live-ops economy + player snapshot
  app.get('/v1/mod/activity', { preHandler: modAuth }, async (req) => Ops.opsActivity(pool, req.query?.limit)); // the live event feed
  app.get('/v1/mod/audit', { preHandler: modAuth }, async (req) => {
    const cid = req.query?.characterId;
    const tx = await pool.query('SELECT * FROM transactions WHERE ($1::text IS NULL OR character_id=$1) ORDER BY at DESC LIMIT 100', [cid || null]);
    const rng = await pool.query('SELECT * FROM rng_audit WHERE ($1::text IS NULL OR character_id=$1) ORDER BY at DESC LIMIT 100', [cid || null]);
    return { transactions: tx.rows, rng: rng.rows };
  });

  // ── THE RESERVE BOND (Protocol-Owned Liquidity; off-chain accounting, chain DORMANT / mainnet-gated) ──
  app.get('/v1/bonds', { preHandler: auth }, async (req) => Bonds.bondBoard(pool, req.user.sub));
  app.post('/v1/bonds/:id/claim', { preHandler: auth }, async (req) => Bonds.claimBond(pool, req.user.sub, req.params.id));
  // the EIP-712 bond QUOTE SIGNER — a player requests a signed BondQuote (bound to their linked wallet),
  // then submits bond(quote, signature) to the on-chain OmertaBond contract; the Bonded watcher books it.
  // Chain-dormant: 400s chain_unconfigured unless the bond chain (CHAIN_ID + OMERTA_BOND_ADDRESS + signer) is set.
  app.post('/v1/bond/quote', { preHandler: auth }, async (req) => Chain.quoteBond(pool, req.user.sub, req.body?.principalEth));
  // server-encode the bond() submission so an injected browser wallet (MetaMask / Robinhood Wallet / etc.)
  // can `eth_sendTransaction` it without the zero-dep client hand-rolling ABI (viem does it server-side).
  app.post('/v1/bond/calldata', { preHandler: auth }, async (req) => Chain.bondCalldata(pool, req.user.sub, req.body?.nonce));
  app.get('/v1/mod/bonds', { preHandler: modAuth }, async () => Bonds.bondStatus(pool)); // the ops/invariant view
  // THE FLOAT — the RWA buy-bot seat (mod-driven until the mainnet Uniswap bot; the runVigBuyback
  // twin: spend ≤ rwa_revenue, priceEth = the oracle param, txHash marks a REAL swap) + the
  // real-value invariant view (allocated ≤ held — the anti-Ponzi check — spend ≤ revenue, unit sums)
  app.get('/v1/mod/rwa', { preHandler: modAuth }, async () => Rwa.runRwaInvariants(pool));
  app.post('/v1/mod/rwa/buy', { preHandler: modAuth }, async (req) =>
    // AUDIT F1: txHash rides the modRealTxHash gate (route parity with mod/fees/record +
    // mod/bond/simulate) — a mod comp can't stamp a simulated buy real=true and poison the
    // real-vs-simulated unit ledger R3 extraction reconciles against
    Rwa.runRwaBuyback(pool, { ticker: req.body?.ticker, eth: req.body?.eth, priceEth: req.body?.priceEth, txHash: modRealTxHash(req) }));
  app.post('/v1/mod/bond/fund', { preHandler: modAuth }, async (req) => Bonds.fundBondTranche(pool, req.body?.omr)); // top up the tranche
  app.post('/v1/mod/bond/simulate', { preHandler: modAuth }, async (req) => // QA/comp until the paywall (the Store precedent)
    // No txHash = a pure comp: books the bond + OMR tranche but NO real-ETH Vig/POL accounting (audit
    // MED — else a comp fabricates Vig revenue the buyback spends, unbacking the withdrawal reserve).
    // AUDIT-full-system-v2 D-MED2: real-ETH revenue must ONLY come from the on-chain watcher observing
    // a genuine event — never a caller-supplied txHash on a mod route. So the route STRIPS txHash unless
    // ALLOW_MOD_REAL_REVENUE=on (a QA-only escape hatch, default OFF — the X_TRUST_USER_TOKEN posture),
    // making the production comp path incapable of booking real revenue no matter what the caller sends.
    Bonds.recordBond(pool, { nonce: req.body?.nonce, accountId: req.body?.account, payer: req.body?.payer, principalEth: req.body?.principalEth, priceOmrPerEth: req.body?.price, discountBps: req.body?.discountBps, txHash: modRealTxHash(req) }));

  // ── M6-B: the chain service (§11, EVM) — withdrawals, gear mint, SIWE wallet link ──
  app.post('/v1/wallet/challenge', { preHandler: auth }, async (req) => Chain.walletChallenge(pool, req.user.sub));
  app.post('/v1/wallet/verify', { preHandler: auth }, async (req) =>
    Chain.walletVerify(pool, req.user.sub, req.body?.address, req.body?.signature));
  app.post('/v1/withdraw', { preHandler: auth }, async (req) =>
    Chain.requestWithdraw(pool, req.user.sub, req.body?.amount, req.body?.address));
  // cancel a still-QUEUED (unsigned) withdrawal and refund the burned $OMR (audit LOW — an escape hatch
  // if the reserve never funds to your FIFO position; safe because a queued voucher was never signed).
  app.post('/v1/withdraw/:id/cancel', { preHandler: auth }, async (req) =>
    Chain.cancelQueuedWithdraw(pool, req.user.sub, req.params.id));
  app.post('/v1/gear/:id/withdraw', { preHandler: auth }, async (req) =>
    Chain.requestGearWithdraw(pool, req.user.sub, req.params.id, req.body?.address));
  app.get('/v1/withdraw/status', { preHandler: auth }, async (req) => {
    const mine = (await pool.query(
      'SELECT id, kind, amount, gear_id, nonce, status, claimed_onchain, signed_payload FROM vouchers WHERE account_id=$1 ORDER BY created_at DESC LIMIT 50',
      [req.user.sub])).rows;
    return { reserve: await Chain.reserveStatus(pool),
      vouchers: mine.map((v) => ({ id: v.id, kind: v.kind, amount: Number(v.amount), gearId: v.gear_id,
        nonce: Number(v.nonce), status: v.status, claimed: v.claimed_onchain,
        payload: v.signed_payload ? JSON.parse(v.signed_payload) : null })) };
  });
  // Mod/ops: mirror an on-chain tranche funding into the reserve (drains the queue),
  // read the reserve gauge, and (for tests/ops) mark a voucher claimed.
  app.post('/v1/mod/reserve/fund', { preHandler: modAuth }, async (req) => Chain.fundReserve(pool, req.body?.amount));
  app.get('/v1/mod/reserve', { preHandler: modAuth }, async () => Chain.reserveStatus(pool));
  app.post('/v1/mod/reserve/claimed', { preHandler: modAuth }, async (req) => Chain.markClaimed(pool, Number(req.body?.nonce)));

  // ── §11 entry/revive fees (paid on-chain to OmertaFees → dev wallet) ──
  // Spend a paid mint credit to make your character permanent (the two-tier upgrade).
  app.post('/v1/character/mint', { preHandler: auth }, async (req) => Fees.mintCharacter(pool, req.user.sub));
  // Spend a paid re-roll credit (0.01 ETH each on-chain) to re-roll your build — total-conserved,
  // rng_audit'd, infinitely repeatable (one credit per re-roll).
  app.post('/v1/character/reroll', { preHandler: auth }, async (req) => Fees.rerollCharacter(pool, req.user.sub));
  app.get('/v1/fees/status', { preHandler: auth }, async (req) => Fees.feeStatus(pool, req.user.sub));
  // Ops/manual reconciliation of an on-chain payment (the worker's watcher does this live from
  // MintFeePaid/RespawnFeePaid events; this endpoint is the manual + test path for the same call).
  app.post('/v1/mod/fees/record', { preHandler: modAuth }, async (req) =>
    Fees.recordFeePayment(pool, { nonce: req.body?.nonce, kind: req.body?.kind,
      payer: req.body?.payer, amountWei: req.body?.amountWei, txHash: modRealTxHash(req) })); // D-MED2: strip caller txHash unless the QA flag is set

  // ── Risk-to-Earn Phase 2: THE VIG (off-chain core) ──
  // PLEX bridge — pay a real-money fee from EARNED $OMR instead of ETH (burns $OMR → the same
  // entitlement). A skilled player funds their own play; a whale pays ETH (which funds the Vig).
  app.post('/v1/plex/mint', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Vig.payPlex(ch, 'mint', client, h)));
  app.post('/v1/plex/respawn', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Vig.payPlex(ch, 'respawn', client, h)));
  // the live market-linked quote (fee-ETH × latest buyback price × premium; static floor pre-market)
  app.get('/v1/plex/price', async () => ({
    mint: await Vig.plexQuote(pool, 'mint'), respawn: await Vig.plexQuote(pool, 'respawn') }));
  // Mod/ops: the Vig gauge + the extraction-≤-inflow invariant, and the buyback trigger (on
  // mainnet the DEX bot runs this with a TWAP price; here it's the manual/test path).
  app.get('/v1/mod/vig', { preHandler: modAuth }, async () =>
    ({ status: await Vig.vigStatus(pool), invariants: await Vig.runVigInvariants(pool) }));
  app.post('/v1/mod/vig/buyback', { preHandler: modAuth }, async (req) =>
    Vig.runVigBuyback(pool, { priceOmrPerEth: req.body?.priceOmrPerEth, maxEth: req.body?.maxEth }));
  app.post('/v1/mod/vig/prizes', { preHandler: modAuth }, async (req) => Vig.payPrizes(pool, req.body?.winners));

  // ── THE STORE (ETH revenue packages) ──
  // The catalog + your live entitlements. Purchases are made ON-CHAIN at the OmertaFees paywall
  // (dormant); the watcher observes StorePaid and calls recordStorePurchase (the mint/respawn fee
  // pattern). §10.4-neutral — the Store grants only entitlements/access/status, never currency.
  app.get('/v1/store', { preHandler: auth }, async (req) => Store.storeBoard(pool, req.user.sub));
  // PLEX-for-packages — buy a Store SKU with EARNED $OMR (burns $OMR for the same entitlement)
  app.post('/v1/store/plex/:sku', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Store.payPackagePlex(ch, req.params.sku, client, h)));
  // Mod/ops: the founder's three-way revenue split (founder / buyback / RWA), and the comp/simulate
  // path — drives recordStorePurchase with a synthetic nonce (for comps, QA, and until the paywall
  // ships). `nonce` must be unique; a duplicate is the idempotent no-op.
  app.get('/v1/mod/revenue', { preHandler: modAuth }, async () => Store.revenueStatus(pool));
  app.post('/v1/mod/store/grant', { preHandler: modAuth }, async (req) =>
    Store.recordStorePurchase(pool, { nonce: req.body?.nonce, sku: req.body?.sku,
      payer: req.body?.payer, amountWei: req.body?.amountWei, txHash: modRealTxHash(req) })); // D-MED2: strip caller txHash unless the QA flag is set

  // THE LEDGER — the Season Pass reward track. The daily-claim track (status/consumables in the
  // claim txn; the $OMR stipend is paid post-commit through the BACKED prize-pool rail — pool-bounded,
  // never a mint, so extraction ≤ inflow holds).
  app.get('/v1/pass', { preHandler: auth }, async (req) => Pass.passBoard(pool, req.user.sub));
  app.post('/v1/pass/claim', { preHandler: auth }, async (req) => {
    const res = await G.withCharacter(pool, req.user.sub, (ch, client, h) => Pass.claimPass(ch, client, h));
    // pay down any accrued stipend from the BACKED pool — BEST-EFFORT (the owe is durably recorded, so
    // a failure/dry-pool never loses the reward or mis-advances the track; the worker sweep is the net)
    if (res?.owed > 0) {
      try { const s = await Pass.settlePassStipend(pool, req.user.sub); res.stipendPaid = s.paid; res.owed = s.owed; }
      catch { /* leave it owed — sweepPassStipends will pay it when the pool funds. Never fail the claim. */ }
    }
    return res;
  });

  // ── Risk-to-Earn Phase 4: BACKED EMISSION (the staking reward pool) ──
  // Gauge: pool balance + effective-APY runway; and an ops/test top-up (the buyback funds it live).
  // THE DEV FUND — the founder's revenue bucket (fed by the withdrawal exit toll's tax:dev share).
  app.get('/v1/mod/dev', { preHandler: modAuth }, async () => {
    const d = (await pool.query('SELECT omr, lifetime FROM dev_fund WHERE id=1')).rows[0] || { omr: 0, lifetime: 0 };
    return { omr: Number(d.omr), lifetime: Number(d.lifetime), taxBps: withdrawTaxBps(), devBps: TAX.DEV_BPS };
  });
  // claim the dev fund to an account (a bucket TRANSFER — tax:dev:claim rides the tax: vocabulary,
  // never a mint); the founder then withdraws like any player (paying the toll like anyone).
  app.post('/v1/mod/dev/claim', { preHandler: modAuth }, async (req) => {
    const accountId = String(req.body?.accountId || '');
    if (!accountId) return { error: 'account', message: 'accountId required' };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const acct = (await client.query('SELECT account_id FROM account_persistent WHERE account_id=$1 FOR UPDATE', [accountId])).rows[0];
      if (!acct) { await client.query('ROLLBACK'); return { error: 'no_account' }; }
      const d = (await client.query('SELECT omr FROM dev_fund WHERE id=1 FOR UPDATE')).rows[0];
      const amt = Number(d?.omr || 0);
      if (!(amt > 0)) { await client.query('ROLLBACK'); return { error: 'empty', message: 'nothing to claim' }; }
      await client.query('UPDATE dev_fund SET omr = 0 WHERE id=1');
      await client.query('UPDATE account_persistent SET omr = omr + $2 WHERE account_id=$1', [accountId, amt]);
      await client.query('INSERT INTO transactions (id, account_id, currency, amount, reason, counterparty) VALUES ($1,$2,$3,$4,$5,$6)',
        [crypto.randomUUID(), accountId, 'omr', amt, 'tax:dev:claim', 'dev_fund']);
      await client.query('COMMIT');
      return { claimed: amt };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  });
  app.get('/v1/mod/emission', { preHandler: modAuth }, async () => {
    const sp = (await pool.query('SELECT balance, lifetime_funded, lifetime_paid FROM stake_pool WHERE id=1')).rows[0] || {};
    const staked = Number((await pool.query('SELECT COALESCE(SUM(staked),0) s FROM account_persistent')).rows[0].s);
    const pending = Number((await pool.query('SELECT COALESCE(SUM(rewards),0) s FROM account_persistent')).rows[0].s);
    return { poolBalance: Number(sp.balance || 0), lifetimeFunded: Number(sp.lifetime_funded || 0),
      lifetimePaid: Number(sp.lifetime_paid || 0), totalStaked: staked, pendingRewards: pending,
      backed: pending > 0 ? Math.min(1, Number(sp.balance || 0) / pending) : 1 };
  });
  // Ops top-up: MOVE $OMR from the event fund into the staking pool (a §10.4 transfer, both
  // buckets inside the $OMR conservation set — never a mint). The buyback funds the pool live;
  // this is the manual twin for moving surplus event-fund $OMR into staker yield.
  app.post('/v1/mod/emission/fund', { preHandler: modAuth }, async (req) => {
    const amt = Number(req.body?.amount);
    if (!(amt > 0)) throw new G.GameError('amount', 'Positive amounts only.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const f = (await client.query('SELECT fund FROM street_tax WHERE id=1 FOR UPDATE')).rows[0];
      if (Number(f.fund) < amt) throw new G.GameError('fund', `The event fund holds ${Math.floor(Number(f.fund))} $OMR — not ${amt}.`);
      await client.query('UPDATE street_tax SET fund = fund - $1 WHERE id=1', [amt]);
      await client.query('UPDATE stake_pool SET balance = balance + $1, lifetime_funded = lifetime_funded + $1 WHERE id=1', [amt]);
      await client.query('COMMIT');
      return { ok: true, funded: amt, fromEventFund: true };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  });

  // ── M2: deterministic market board (§7.11) — public, server-computed ──
  app.get('/v1/market/prices', async () => {
    const block = priceBlock();
    return {
      block,
      goods: Object.fromEntries(DISTRICTS.map((d) =>
        [d.id, Object.fromEntries(GOODS.map((g) => [g.id, goodPriceOf(g.id, d.id, block)]))])),
      demand: Object.fromEntries(DISTRICTS.map((d) =>
        [d.id, Object.fromEntries(DRUGS.map((dr) => [dr.id, Math.round(demandOf(dr.id, d.id, block) * 100) / 100]))])),
      makings: Object.fromEntries(DRUGS.map((dr) => [dr.id, makingsPriceOf(dr.id, block)])),
    };
  });

  // THE LIVING WORLD — the city you can SEE: today's two event tracks, the intraday clock, the
  // per-district economic weather, and a 7-day forecast (all pure functions of the day, so players
  // can plan). Public, no auth.
  app.get('/v1/city', async () => {
    const day = dayOf(), block = priceBlock(), hr = cityHourOf();
    return {
      day, event: cityEventOf(day), lawEvent: cityLawEventOf(day),
      clock: hr,
      forecast: cityForecast(day),
      // each district's current goods-shock (mean-neutral daily weather) — the arbitrage map
      weather: Object.fromEntries(DISTRICTS.map((d) => [d.id, Math.round(regionShockOf(d.id, Math.floor(block / 6)) * 1000) / 1000])),
      // SEASONAL MODIFIER (slate #6): this season's league twist — public, verifiable, no state
      season: (() => { const m = seasonModOf();
        return { idx: seasonIdxOf(), daysLeft: seasonDaysLeft(),
          mod: { id: m.id, name: m.name, blurb: m.blurb } }; })(),
      // THE SKYLINE — every monument the city ever raised (permanent, public — the Megaproject).
      // Cached 30s: /v1/city is a KEYLESS route and the skyline only changes on a completion.
      skyline: await cachedSkyline(),
    };
  });
  let skylineCache = { at: 0, v: [] };
  const cachedSkyline = async () => {
    if (Date.now() - skylineCache.at > 30_000)
      skylineCache = { at: Date.now(), v: await Mega.skylineOf(pool) };
    return skylineCache.v;
  };
  // ── THE MEGAPROJECT (founder pick #1) — the collective monument. Contributions are pure
  // §10.4 SINKS (cash burn / $OMR burn / goods deleted); completion permanently changes the city. ──
  app.get('/v1/megaproject', { preHandler: auth }, async (req) => Mega.megaBoard(pool, req.user.sub));
  app.post('/v1/megaproject/cash', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Mega.giveCash(ch, req.body?.amount, client, h)));
  app.post('/v1/megaproject/goods', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Mega.giveGoods(ch, req.body?.goodId, req.body?.qty, client, h)));
  app.post('/v1/megaproject/omr', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Mega.giveOmr(ch, req.body?.amount, client, h)));

  // ── THE DUELING LADDER (slate #5) — ranked ELO PvP on the audited casino:pvp transfer ──
  app.get('/v1/duels', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch) => Duels.duelBoard(pool, ch)));
  app.post('/v1/duels/list', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client) => Duels.listDuel(ch, req.body?.limit, client)));
  app.post('/v1/duels/style', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client) => Duels.pickStyle(ch, req.body?.style, client)));
  app.post('/v1/duels/:targetId', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.targetId,
      (ch, opponent, client, h) => Duels.challenge(ch, opponent, req.body?.amount, client, h)));
  app.get('/v1/leaderboard/duels', { preHandler: auth }, async () => Duels.duelLeaderboard(pool));

  // ── CLUE SCROLLS (slate #4) — treasure trails off the §7.11 seed; the casket is the one faucet ──
  app.get('/v1/clues', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Clues.clueBoard(client, ch, h.acct)));
  app.post('/v1/clues/dig', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Clues.dig(ch, client, h)));
  app.get('/v1/leaderboard/clues', { preHandler: auth }, async () => Clues.clueLeaderboard(pool));
  // NPC RIVAL FAMILIES — the server-wide common enemy. GET is the board (odds tonight); raid is co-op.
  app.get('/v1/world', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => World.worldBoard(pool, ch, h)));
  app.post('/v1/world/:npcId/raid', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => World.raidNpc(ch, req.params.npcId, client, h)));
  app.get('/v1/leaderboard/world', { preHandler: auth }, async () => World.worldLeaderboard(pool)); // THE WAR EFFORT board
  // step three — CO-OP CREW RAIDS on the apex outfits + THE FRONTIER (family conquest leaderboard)
  app.get('/v1/world/raids', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch) => World.raidBoard(pool, ch.id)));
  app.post('/v1/world/:npcId/plan', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => World.planRaid(ch, req.params.npcId, client, h)));
  app.post('/v1/world/raids/:id/join', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => World.joinRaid(ch, req.params.id, client, h)));
  app.post('/v1/world/raids/:id/leave', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => World.leaveRaid(ch, req.params.id, client, h)));
  app.post('/v1/world/raids/:id/go', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => World.executeRaid(ch, req.params.id, client, h)));
  app.get('/v1/leaderboard/frontier', { preHandler: auth }, async () => World.frontierLeaderboard(pool)); // THE FRONTIER board
  // step four — THE FRONTIER MADE REAL: collect a held outpost's tribute + invade a rival-held outpost
  app.post('/v1/world/collect', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => World.collectFrontier(ch, client, h)));
  app.post('/v1/world/:npcId/invade', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => World.invadeOutpost(ch, req.params.npcId, client, h)));
  // step six — THE UPRISING: reinforce a held outpost's garrison (vs the cartel uprising AND rival invasions)
  app.post('/v1/world/:npcId/reinforce', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => World.reinforceOutpost(ch, req.params.npcId, req.body?.amount, client, h)));
  return app;
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  const app = await buildServer();
  // AUDIT-full-system-v2 D-MED1: THIS process signs the withdrawal vouchers (Chain.requestWithdraw),
  // so it — not just the worker — must verify CHAIN_ID matches the RPC's real chain before serving. A
  // wrong-but-nonzero CHAIN_ID would sign every voucher under the wrong EIP-712 domain (all claims
  // revert while $OMR is burned). Dormant (no CHAIN_RPC_URL) → no-op; a mismatch refuses to boot.
  await Chain.assertChainId();
  const port = Number(process.env.PORT || 8787);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`OMERTÀ backend (M1–M5) listening on :${port}`);
}

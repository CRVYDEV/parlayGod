import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import crypto from 'node:crypto';
import { makeDb } from './db.js';
import { isDbDown, pingDb } from './dbhealth.js';
import { preflight } from './preflight.js';
import * as G from './game.js';
import * as E from './economy.js';
import * as S from './social.js';
import * as K from './kitchen.js';
import * as W from './growth.js';
import * as RG from './regimen.js';
import * as Hustle from './hustle.js';
import * as Career from './career.js';
import * as Corner from './corner.js';
import * as Contacts from './contacts.js';
import * as Favors from './favors.js';
import * as Crew from './crew.js';
import * as Discovery from './discovery.js';
import * as Mentor from './mentor.js';
import { cityEventBoard } from './events.js';
import * as A from './auth.js';
import * as Chain from './chain.js';
import * as Fees from './fees.js';
import * as V from './vanity.js';
import * as Vig from './vig.js';
import * as Territory from './territory.js';
import * as Diplomacy from './diplomacy.js';
import * as Sov from './sov.js';
import * as Rivals from './rivals.js';
import * as People from './people.js';
import * as Campaigns from './campaigns.js';
import * as Bloodline from './bloodline.js';
import * as Honor from './honor.js';
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
import * as Mastery from './mastery.js';
import * as Underworld from './underworld.js';
import * as Law from './law.js';
import * as World from './world.js';
import * as NpcWar from './npcwar.js';
import * as Standing from './standing.js';
import * as Season from './season.js';
import * as Pen from './pen.js';
import * as Loans from './loans.js';
import * as Portfolio from './portfolio.js';
import * as Treasury from './treasury.js';
import * as Emission from './emission.js';
import * as Desk from './desk.js';
import * as Exchange from './exchange.js';
import { register as registerCasino } from './routes/casino.js';
import { register as registerPen } from './routes/pen.js';
import { register as registerSpeakeasy } from './routes/speakeasy.js';
import { register as registerPort } from './routes/port.js';
import { register as registerKitchen } from './routes/kitchen.js';
import { register as registerTerritory } from './routes/territory.js';
import { register as registerBoxing } from './routes/boxing.js';
import { register as registerRaces } from './routes/races.js';
import { register as registerLaw } from './routes/law.js';
import { register as registerEstate } from './routes/estate.js';
import { register as registerStable } from './routes/stable.js';
import { register as registerConvoy } from './routes/convoy.js';
import { register as registerHeists } from './routes/heists.js';
import { register as registerUnderworld } from './routes/underworld.js';
import { register as registerDiplomacy } from './routes/diplomacy.js';
import { register as registerSov } from './routes/sov.js';
import { register as registerLeaderboards } from './routes/leaderboards.js';
import { register as registerModTools } from './routes/modtools.js';
import * as Phone from './phone.js';
import * as Mega from './megaproject.js';
import * as Duels from './duels.js';
import * as Clues from './clues.js';
import * as Estate from './estate.js';
import { nftBoard, upgradeRarity } from './nft.js';
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
         RANKS,
         cityLawEventOf, cityForecast, regionShockOf, cityHourOf, ESTATE, AUCTION, MEGAPROJECT, CLUES, DUELS, DUEL_TITLE_RANKS, SEASON_MODS, seasonModOf, seasonIdxOf, seasonDaysLeft, SEASON_PHASES, seasonPhaseOf, seasonPhaseLeft,
         foundationOf, foundationBustMult, foundationBleedMult, CHARTERS, familyCharterOf, FAMILY_CHARTER, FOUNDATION, LAW, WIRE, STORE, PASS, PATRON, BONDS, SPEAKEASY, BOXING, RARITY,
         RACKETS, ASSETS, MISSIONS, GANG_SEALS, SOCIAL_GAME_URL, SOCIAL_X_HANDLE, territoryRankOf, syndicateOf, TERRITORY_TYPES, TERRITORY_RACKETS,
         worldNpcOf, liberationCost, RACES, PORT, CASINO, rollStats, feudTierOf, STABLE, NOTORIETY, MAP, DISTRICT_ADJ, districtNeighbours,
         TAX, withdrawTaxBps,
         HONOR, DIPLOMACY, SOV, CAMPAIGNS, CAMPAIGN_MIN_STANDING, MARRIAGE, SOLDIERS, SECRETS, KITCHEN, RACKET_EMPIRE, OPERATIONS, BUSINESS_EMPIRE, PACING, MASTERY,
         PATH_FX, PATH_XP_HOME, PATH_XP_RIVAL, PATH_SWITCH_CD_MS, REGIMEN, HUSTLE, CAREER, RIVALS,
         CORNER, CONTACTS, FAVOR, DISCOVERY, MENTOR, MADE, MADE_LADDER, ACCESS_STAKE, ROSTER_POSTS, jailed, hospitalized } from './rules.js';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const uid = () => crypto.randomUUID();

export async function buildServer() {
  // ── PREFLIGHT (src/preflight.js) ────────────────────────────────────────────────────────────
  // Every deploy check lives there as DATA, because the guards were never the weak part — the LIST
  // was. It sat inline here, so each drop that added a test-only knob had to remember to come update
  // it, and several didn't: the pacing pass shipped TRAIN_CD_MS and MISSION_CD_MS, the two knobs that
  // exist to collapse the very timers that stopped "level 240 in two hours", and neither was ever
  // guarded. `test/preflight.js` now fails if any process.env in src/ is unclassified, so the list
  // can't fall behind again.
  //
  // "Real deployment" keys off DATABASE_URL as well as NODE_ENV: `npm start` never sets NODE_ENV, so
  // hinging solely on it meant a deploy that forgot the single most forgettable variable silently
  // reverted every guard at once. Dev/CI (pg-mem, no DATABASE_URL) keeps the convenient fallbacks.
  const { errors: preflightErrors, warnings: preflightWarnings } = preflight();
  if (preflightErrors.length)
    throw new Error(`Refusing to boot — deploy preflight failed:\n  - ${preflightErrors.join('\n  - ')}`);
  for (const w of preflightWarnings) console.warn(`⚠️  preflight: ${w}`);

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
  // Exposed so tests can assert the mounted surface directly. /openapi.json is derived from the same
  // registry but deliberately omits /v1/mod, so it cannot stand in for the whole table — and the one
  // invariant worth enforcing (every /v1 route is authed unless explicitly declared public) is about
  // exactly the routes a refactor is most likely to drop on the floor.
  app.decorate('routes', routeRegistry);
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
  // ── GENERATED ART (public/art/*.jpg): the landing hero, the district plates, the system interiors.
  // Loaded into memory ONCE at boot as an ALLOWLIST keyed by filename, and the request only ever does a
  // Map lookup — user input is never joined into a path, so there is no traversal surface by
  // construction (`/art/../../etc/passwd` is simply a key that isn't in the Map). Immutable + a long
  // max-age: the bytes for a given filename never change, and a re-roll ships under a new name.
  // A missing directory degrades to an empty Map — the CSS falls back to its flat fills, never a crash.
  const artDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'art');
  const ART_FILES = new Map();
  try {
    for (const name of readdirSync(artDir)) {
      const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
      const type = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[ext];
      if (type) ART_FILES.set(name, { body: readFileSync(join(artDir, name)), type });
    }
  } catch { /* no art shipped — the flat fills stand in */ }
  app.get('/art/:file', async (req, reply) => {
    const hit = ART_FILES.get(req.params.file);
    if (!hit) return reply.code(404).send({ error: 'not_found' });
    return reply.type(hit.type).header('cache-control', 'public, max-age=604800, immutable').send(hit.body);
  });
  // ── ITEM ART: a generated photo per catalog entry when one shipped (public/art/<kind>-<id>.jpg —
  // the tools/art.js catalog pass covers every car/boat/drug/gun/vest/good), else the procedural SVG
  // (cosmetic; no ledger surface). Public + keyless, heavily cacheable — the same id always renders
  // the same image. Shown in garage/port/kitchen/armory/market. The photo lookup rides the SAME boot
  // ALLOWLIST Map as /art/:file, so user input is never joined into a path here either; unknown
  // kind/id falls through to a neutral SVG emblem, so a broken <img src> never 500s. ──
  const ART_CATALOGS = { car: CARS, boat: PORT.BOATS, drug: DRUGS, gun: GUNS, vest: VESTS, good: GOODS };
  app.get('/v1/art/:kind/:id', async (req, reply) => {
    const photo = ART_FILES.get(`${req.params.kind}-${req.params.id}.jpg`);
    if (photo) {
      return reply.type(photo.type).header('cache-control', 'public, max-age=604800, immutable').send(photo.body);
    }
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
  // `algorithms` is pinned rather than inferred. fast-jwt already derives the allowed set from the key
  // — a string secret admits only HMAC, so the classic "sign HS256 using the RSA public key as the
  // shared secret" confusion has no purchase here. But that safety is a property of the key we happen
  // to pass today, not of this line. Pinning makes it a property of the code: if someone later moves to
  // an asymmetric key, the verifier does not silently widen to whatever that key can do. Tokens are
  // signed HS256 by default with a string secret, so this accepts every token already issued.
  await app.register(jwt, {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    verify: { algorithms: ['HS256'] },
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof G.GameError) return reply.code(400).send({ error: err.code, message: err.message });
    // A bad token is a bad token — 401, never 500. Most fast-jwt errors already arrive carrying a 401,
    // but not all: FAST_JWT_INVALID_ALGORITHM (raised by the pinned `algorithms` above when a token is
    // signed with an algorithm we do not accept) has no statusCode and fell through to `internal`. So
    // the very case the pin exists to reject reported itself as a server bug, which both misleads the
    // client and buries a probe in the 500 pile. Match the whole FAST_JWT_/FST_JWT_ family instead of
    // naming codes one at a time — every one of them means "we could not trust this token".
    if (/^(FAST_JWT_|FST_JWT_)/.test(String(err.code || '')) || err.statusCode === 401)
      return reply.code(401).send({ error: 'auth' });
    // An unreachable database is NOT a bug in the game — it is "come back in a minute". Reporting it as
    // 500 `internal` is what made the 2026-07-25 incident unreadable: an outage and a null-dereference
    // produced byte-identical responses, so a tester saw "Internal" on every button and nobody could tell
    // which it was. 503 + Retry-After says the true thing, keeps it out of the bug pile, and lets the
    // client tell the player something honest. Deliberately still logged — an outage is worth a line.
    if (isDbDown(err)) {
      req.log?.error?.({ err }, 'database unreachable');
      console.error('[db] unreachable:', err.message);
      return reply.code(503).header('retry-after', '15').send({ error: 'db_down' });
    }
    req.log?.error?.(err); console.error(err);
    return reply.code(500).send({ error: 'internal' });
  });
  // GET /health — the question "is it up?" answered directly, keyless, for a human or an uptime monitor.
  // 200 with `ok:true` when a query round-trips; 503 with `ok:false` when it does not, so a monitor can
  // alert on status alone. DEPLOY.md covers the one judgement call: point an UPTIME MONITOR at this, and
  // think twice before making it the platform's own health check — restarting the API does not fix a
  // database, it just adds a restart loop to an outage.
  app.get('/health', async (req, reply) => {
    const db = await pingDb(pool);
    const body = {
      ok: db.ok,
      db: db.ok ? 'up' : (db.down ? 'unreachable' : 'error'),
      dbLatencyMs: db.ms,
      uptimeSeconds: Math.round(process.uptime()),
      at: new Date().toISOString(),
    };
    if (!db.ok) { body.error = db.error; reply.code(503).header('retry-after', '15'); }
    return body;
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

  // ── the live intel-feed socket registry ────────────────────────────────────────────────────────
  // Declared here, above the route registrations, because routes in the extracted src/routes modules
  // need the two close helpers passed in — a `const` further down would be in its temporal dead zone
  // at register time. The websocket route itself lives below and closes over the same map.
  //
  // (red-team R4 auth F1) The connect-time banned check only guards NEW connections, so a mid-session
  // ban left an already-open socket feeding streets/gang chatter until the client chose to disconnect,
  // falsifying the documented "banned-WS close" guarantee. The ban handler closes every open socket.
  const wsClients = new Map(); // accountId -> Set<socket>
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
    let referral; // 'credited' | 'unknown' | undefined — did a supplied referral code land?
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
        // §7.13 — the referral code is the recruiter's character name. Exact match first (case-
        // sensitive names may coexist), then case-insensitive — a typed name shouldn't lose
        // attribution to a shift key. The response says whether it landed, so the client can tell
        // the player instead of silently dropping their referrer (the growth-funnel leak).
        const code = String(req.body.referralCode);
        let rec = await client.query('SELECT account_id FROM characters WHERE name=$1 AND alive AND account_id<>$2 LIMIT 1', [code, req.user.sub]);
        if (!rec.rows.length)
          rec = await client.query('SELECT account_id FROM characters WHERE LOWER(name)=LOWER($1) AND alive AND account_id<>$2 LIMIT 1', [code, req.user.sub]);
        if (rec.rows.length) {
          await client.query('UPDATE account_persistent SET referred_by=$1 WHERE account_id=$2 AND referred_by IS NULL', [rec.rows[0].account_id, req.user.sub]);
          const already = await client.query('SELECT 1 FROM referrals WHERE recruit_account=$1', [req.user.sub]);
          if (!already.rows.length)
            await client.query('INSERT INTO referrals (recruit_account, recruiter_account) VALUES ($1,$2)', [req.user.sub, rec.rows[0].account_id]);
          referral = 'credited';
        } else referral = 'unknown';
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (e?.code === '23505') throw new G.GameError('name_taken', 'Someone on the streets already goes by that name.'); // name-index race backstop
      throw e;
    } finally { client.release(); }
    return { ok: true, id, ...(referral ? { referral } : {}) };
  });

  // The sheet — the single most-polled route in the game, and the one production caught queueing on
  // its own player's row. Its handler is empty: it exists to return the accrued view, nothing else,
  // so it is the clearest possible case for the lock-free read path (D1). readCharacter takes no lock
  // and writes nothing when accrual has not moved, and falls through to withCharacter when it has.
  app.get('/v1/me', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, async () => ({})));

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
    G.withCharacter(pool, req.user.sub, (ch, client, h) => G.doCrime(ch, req.params.id, client, h, req.body?.approach)));
  app.post('/v1/train/:stat', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => G.train(ch, req.params.stat, client, h)));
  // THE REGIMEN — the expanded gym: five disciplines on the SAME train_at clock + NPC trainer drills
  app.get('/v1/regimen', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client, h) => RG.regimenBoard(ch, client, h)));
  app.post('/v1/regimen/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => RG.trainDiscipline(ch, req.params.id, client, h)));
  app.post('/v1/regimen/drill/:npc', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => RG.claimDrill(ch, req.params.npc, client, h)));
  // THE HUSTLE — the daily three-stop job chain (crime-loop interactivity: travel, talk, work, collect)
  app.get('/v1/hustle', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client) => Hustle.hustleBoard(ch, client)));
  app.post('/v1/hustle/advance', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Hustle.advanceHustle(ch, client, h)));
  // WORD ON THE STREET — each district's seed-drawn daily quest board (accept where you stand,
  // do the work, claim the envelope; the counter DELTA proves it — the hustle rule)
  app.get('/v1/corner', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client) => Corner.cornerBoard(ch, client)));
  app.post('/v1/corner/:slot/accept', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Corner.acceptCorner(ch, req.params.slot, client, h)));
  app.post('/v1/corner/:slot/claim', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Corner.claimCorner(ch, req.params.slot, client, h)));
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
  // SCREEN REACH — which of the console's screens a player ever actually opens. The game has 25 of
  // them behind a two-tier nav, and until this existed nothing measured whether a mid-game player
  // uses six or twenty, so any restructure would have been guesswork against a nav that tested well.
  //
  // BATCHED and FIRST-OPEN-ONLY: the client sends each screen once per session, flushed in one call,
  // so a session that walks eight screens makes ~one request rather than eight. That measures REACH
  // (did they ever find it) rather than frequency, which is the question that decides whether to cut,
  // merge or leave the nav alone.
  //
  // Shape-validated rather than allowlisted, deliberately: the tab list is CLIENT presentation and
  // the server has no business owning it — a screen the client renames would silently stop being
  // counted, which is a measurement that lies. Bounded instead (count, length), authed, and rate
  // limited like any other route, so the worst a bad caller achieves is junk rows in an ops view.
  app.post('/v1/screens', { preHandler: auth }, async (req) => {
    const raw = Array.isArray(req.body?.screens) ? req.body.screens : [];
    const seen = new Set();
    for (const s of raw) {
      if (typeof s !== 'string') continue;
      const id = s.trim().slice(0, 24);
      if (id) seen.add(id);
      if (seen.size >= 40) break;                       // more than the console has; a cap, not a filter
    }
    if (!seen.size) return { ok: true, counted: 0 };
    await G.track(pool, req.user.sub, 'screen_open', { screens: [...seen] });
    return { ok: true, counted: seen.size };
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
  // THE OPERATION SLOTS — the door out. Frees the seat; returns RACKET_RETIRE_BPS of the buy-in (0).
  app.delete('/v1/rackets/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.retireRacket(ch, req.params.id, client, h)));
  registerLeaderboards(app, { pool, auth, modAuth });

  // ── TOKENOMICS v2 — THE EXCHANGE (the one-way window) + THE FAMILY YIELD ──
  // Burn $OMR, take cash from a pool real sinks fed. Cash never runs the other way in v2; see
  // omerta-tokenomics-v2-design.md for why a one-directional AMM cannot be the mechanism.
  // readCharacter (the lock-free read path), and the CLIENT — not the pool. Passing `pool` to a
  // function running inside a held transaction checks out a SECOND connection while the first is
  // still held: with every connection in flight doing that, the pool deadlocks against itself. It
  // also read outside the caller's snapshot. Every sibling board (wage, portfolio) passes `client`.
  app.get('/v1/window', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client, h) => Exchange.exchangeBoard(client, h)));
  app.post('/v1/window/redeem', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Exchange.redeem(ch, req.body?.amount, client, h)));
  app.get('/v1/yield', async () => Exchange.yieldBoard(pool));           // public: who draws the family yield
  app.get('/v1/desk', async () => Desk.deskBoard(pool));                 // public: the shelf a spent $OMR lands on
  app.get('/v1/mod/exchange', { preHandler: modAuth }, async () => ({
    exchange: await Exchange.exchangePool(pool), familyYield: await Exchange.familyYieldPool(pool),
    invariants: await Exchange.runExchangeInvariants(pool),
  }));

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
  // THE WATCH — the holder declares the hour their family stands ready. Free; the cost is being there.
  app.post('/v1/districts/:id/watch', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.setWatch(ch, req.params.id, req.body?.hour, client, h)));
  // THE ROSTER — a family's made men are a scarce resource: one post per man, one man per post.
  app.get('/v1/roster', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client, h) => S.rosterOf(client, h.owned.gangId)));
  app.post('/v1/roster/:post', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.assignPost(ch, req.body?.memberId, req.params.post, client, h)));
  app.delete('/v1/roster/:post', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.vacatePost(ch, req.params.post, client, h)));
  // THE SEALED BID — a district a family holds changes hands only through the contest. Your number
  // is secret until it closes; a stake only goes up.
  app.post('/v1/districts/:id/claim', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.stakeClaim(ch, req.params.id, req.body?.amount, client, h)));
  registerTerritory(app, { pool, auth });

  // Business Empire — the premium, acquired-later personal front layer: buy/upgrade venues that
  // farm pocket cash and double as private, lower-heat laundering. GET /v1/catalog is the public
  // discoverable catalog (also closes the audit's API-discoverability gap).
  app.get('/v1/catalog', async () => ({ businesses: Business.catalog() }));
  // ── the public rulebook (client discoverability — the /v1/catalog precedent, read-only) ──
  // Curated PUBLIC constants only: what the prototype UI always showed players. Server stays
  // authoritative — knowing the odds table doesn't move a single roll client-side.
  app.get('/v1/rules', async () => ({
    crimes: CRIMES.map((c) => ({ id: c.id, name: c.name, lvl: c.lvl, nerve: c.nerve, cash: c.cash, base: c.base, jail: c.jail })),
    // D6a — THE APPROACH: the per-job risk/reward choice (Case It / Standard / Go Loud). Public so the
    // client can render the three-way picker; the server stays the referee (the roll is server-side).
    // PACING — published so a player can see the clock they're playing against (and so the console
    // can render live cooldown timers instead of a bare error).
    pacing: { levelDivisor: PACING.LEVEL_DIVISOR,
      energyRegenPerMin: PACING.ENERGY_REGEN_PER_MIN, nerveRegenPerMin: PACING.NERVE_REGEN_PER_MIN,
      trainCooldownSeconds: Math.round(PACING.TRAIN_CD_MS / 1000),
      missionCooldownSeconds: Math.round(PACING.MISSION_CD_MS / 1000),
      // respect(L) = levelDivisor × (L−1)² — published so the client can draw a progress bar
      respectFormula: 'levelDivisor * (level - 1)^2',
      // F4 — the level-up moment: what crossing a level hands you, and the street-rank ladder it
      // walks, so the client can NAME the beat instead of just noticing a number moved.
      levelUpRefill: PACING.LEVEL_UP_REFILL, ranks: RANKS },
    crimeApproaches: Object.values(M3.CRIME_APPROACHES).map((a) => ({ id: a.id, name: a.name,
      successMult: a.successMult, payMult: a.payMult, heat: a.heat, jailMult: a.jailMult })),
    // THE REGIMEN — the expanded gym: five disciplines + the trainer-drill config (the catalog
    // discoverability precedent; the live board with progress is GET /v1/regimen)
    regimen: { disciplines: REGIMEN.DISCIPLINES, cap: REGIMEN.CAP,
      drillXp: REGIMEN.DRILL_XP, trainers: REGIMEN.TRAINERS, energy: REGIMEN.ENERGY },
    // THE HUSTLE — the daily three-stop chain's config (the live chain is GET /v1/hustle)
    hustle: { payPerLvl: HUSTLE.PAY_PER_LVL, payMin: HUSTLE.PAY_MIN },
    // WORD ON THE STREET — the district quest boards' config (the live board is GET /v1/corner)
    corner: { perDay: CORNER.PER_DAY, maxDay: CORNER.MAX_DAY, cash: CORNER.CASH, respect: CORNER.RESPECT,
      chainSteps: CORNER.CHAIN_STEPS, chainBonus: CORNER.CHAIN_BONUS, chainRespect: CORNER.CHAIN_RESPECT },
    // THE BLACK BOOK + THE CALL — numbers are earned (meet / tap / be called), requests pay from
    // the contact's own pocket (the live book is GET /v1/contacts)
    contacts: { callTtlHours: Math.round(CONTACTS.CALL_TTL_MS / 3600000), visitTip: CONTACTS.VISIT_TIP,
      freightPremiumBps: CONTACTS.CALL_FREIGHT_PREMIUM_BPS,
      ranks: CONTACTS.RANKS, standingTiers: CONTACTS.STANDING_TIERS },
    favors: { maxOpen: FAVOR.MAX_OPEN, minPay: FAVOR.MIN_PAY, maxPay: FAVOR.MAX_PAY, maxQty: FAVOR.MAX_QTY,
      takeBps: FAVOR.TAKE_BPS, ttlHours: Math.round(FAVOR.TTL_MS / 3600000) },
    // THE ROLODEX — player discovery (omerta-discovery-design.md). §10.4-free; just the level band.
    // (THE CREW's own limits are on the /v1/crew board, not here — a `crew` key already belongs to the
    // M4 KITCHEN crew below, and a duplicate key would silently shadow one of them.)
    discovery: { band: DISCOVERY.BAND },
    // THE MENTOR — the positive first interaction (levels/caps/milestones; the offer flow is server-gated)
    mentor: { minLvl: MENTOR.MIN_LVL, protegeMaxLvl: MENTOR.PROTEGE_MAX_LVL, activeMax: MENTOR.ACTIVE_MAX,
      milestones: MENTOR.MILESTONES.map((m) => ({ lvl: m.lvl, cash: m.cash, graduate: !!m.graduate })) },
    // THE STREET WAR + RIVALS (discoverability — costs and bounds only; the odds stay server-side)
    rivals: { robRateBps: RIVALS.ROB_RATE_BPS, robEnergy: RIVALS.ROB_ENERGY, robJailS: RIVALS.ROB_JAIL_S,
      trunkEnergy: RIVALS.TRUNK.ENERGY, trunkJailS: RIVALS.TRUNK.JAIL_S,
      boatEnergy: RIVALS.BOAT_THEFT.ENERGY, boatJailS: RIVALS.BOAT_THEFT.JAIL_S,
      sabotageEnergy: RIVALS.SABOTAGE.ENERGY, sabotageInjuryHours: Math.round(RIVALS.SABOTAGE.INJURY_MS / 3600000),
      revengeHonor: RIVALS.REVENGE_HONOR, wireRivalMult: RIVALS.WIRE_RIVAL_MULT,
      theftEnergy: RIVALS.CAR_THEFT.ENERGY, theftJailS: RIVALS.CAR_THEFT.JAIL_S,
      victimMinLvl: RIVALS.VICTIM_MIN_LVL, victimShieldHours: Math.round(RIVALS.CAR_THEFT.VICTIM_SHIELD_MS / 3600000),
      retentionDays: RIVALS.RETENTION_D },
    // THE CAREER — the public ladder catalog (the /v1/catalog discoverability precedent)
    career: { need: CAREER.NEED, tiers: CAREER.TIERS.map((t) => ({ id: t.id, name: t.name, capstone: t.capstone,
      tasks: t.tasks.map((k) => ({ id: k.id, name: k.name, cash: k.cash })) })) },
    // D6a step two — the other two entry verbs' decision axes (each its own, not a copy of the crime picker)
    jumpIntents: Object.values(M3.JUMP_INTENTS).map((i) => ({ id: i.id, name: i.name,
      stealMult: i.stealMult, repMult: i.repMult, dmgMult: i.dmgMult, hospMult: i.hospMult, heat: i.heat })),
    dealPlays: Object.values(M4.DEAL_PLAYS).map((p) => ({ id: p.id, name: p.name,
      heatMult: p.heatMult, nerveMult: p.nerveMult, repMult: p.repMult })),
    districts: DISTRICTS,
    stats: ['muscle', 'cunning', 'speed'],
    paths: PATHS,
    // PATHS v2 — the hand-written teeth behind the catalog (home/rival trades + the fx matrix),
    // published so the Declare-Your-Path card can show what a career really costs and pays
    pathFx: { matrix: PATH_FX, xpHome: PATH_XP_HOME, xpRival: PATH_XP_RIVAL,
      switchCdSeconds: Math.round(PATH_SWITCH_CD_MS / 1000) },
    share: { gameUrl: SOCIAL_GAME_URL, xHandle: SOCIAL_X_HANDLE }, // brag-on-X: prefilled intents carry the player's name as a referral code
    // THE PRINTER IS OFF (economy v3 step 1). The Street Wage published its schedule here so anyone
    // could verify the printer; there is no printer. `faucet: null` is a deliberate positive claim
    // rather than a removed key — a client that used to render the schedule can say what replaced it.
    emission: { faucet: null, note: 'No $OMR is minted in game. Every $OMR in the city was bought or taken.' },
    // THE FLOAT (economy v3 step 5) — the dues, what they open, and the two loot rates. All published,
    // because a player deciding whether to hold $OMR is entitled to know exactly what it costs them
    // to be caught holding it.
    made: { omr: MADE.OMR, days: Math.round(MADE.MS / 86400000), estateTier: MADE.ESTATE_TIER,
      // §4.3 is retired (founder, 2026-08-02) — dues DO buy power now, bounded by a reachable ceiling
      // rather than by a category. Both facts are published because a player is entitled to both.
      buysPower: true, ceilingOmr: MADE_LADDER.RUNGS[MADE_LADDER.RUNGS.length - 1].min,
      noCombatPower: true },
    accessStake: { highOmr: ACCESS_STAKE.HIGH_OMR },
    // THE LADDER (D8=D) — power for HOLDING. Published in full: the rungs, what each gives, and the
    // shortcut dues buy, so the client renders terms rather than restating them (the catalog precedent).
    ladder: { rungs: MADE_LADDER.RUNGS, madeRungs: MADE_LADDER.MADE_RUNGS,
      note: 'The ladder runs on $OMR you HOLD (staked), not what you spend. Being made climbs it — it never raises the top.' },
    loot: { omrIdle: M3.OMR_LOOT_IDLE, omrCommitted: M3.OMR_LOOT_COMMITTED, cash: M3.CASH_LOOT_RATE,
      minLevel: M3.LOOT_MIN_LVL,
      note: 'A loose or unbonding balance is IDLE and is looted deepest. A staked balance is COMMITTED and is looted less — but nothing is safe.' },
    // THE TRADES — the mastery catalog (tracks, curve, ranks — knowable; XP is earned, never bought)
    mastery: { tracks: MASTERY.TRACKS, xpDivisor: MASTERY.XP_DIVISOR, maxLvl: MASTERY.MAX_LVL,
      xp: MASTERY.XP, ranks: MASTERY.RANKS, heirKeepBps: MASTERY.HEIR_KEEP_BPS, legendRanks: MASTERY.LEGEND_RANKS,
      // step two — the milestone perks + the level-50 trait choice (all knowable; the den XP floor too)
      milestones: MASTERY.MILESTONES, perks: MASTERY.PERKS, traits: MASTERY.TRAITS,
      traitHeirBps: MASTERY.TRAIT_HEIR_BPS, gamblerMinStake: MASTERY.GAMBLER_MIN_STAKE,
      statUse: MASTERY.STAT_USE },
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
    // THE OPERATION SLOTS — published so the client can render "3 of 5 seats" beside the catalogs
    // and grey what won't fit, rather than letting a player pick and then be refused (the check-5 rule).
    operations: { base: OPERATIONS.SLOTS_BASE, perLevel: OPERATIONS.SLOTS_PER_LEVEL, max: OPERATIONS.SLOTS_MAX,
      meteredCat: OPERATIONS.INCOME_ASSET_CAT, retireBps: OPERATIONS.RACKET_RETIRE_BPS,
      note: 'Rackets and Legit Fronts share your operation seats — you can only run so many at once. Wheels and Property don\'t take a seat.' },
    // THE WATCH + THE SEALED BID — turf's two strategy layers, published so the client can render
    // both the window and the contest's terms without re-deriving anything.
    turf: { watchWindowH: M3.WATCH_WINDOW_H, surpriseMult: M3.WATCH_SURPRISE_MULT,
      contestMinutes: Math.round(M3.CONTEST_MS / 60000), contestLossBps: M3.CONTEST_LOSS_BPS,
      roster: { posts: ROSTER_POSTS, minLevel: M3.ROSTER_MIN_LEVEL,
        reassignSeconds: Math.round(M3.ROSTER_REASSIGN_CD_MS / 1000), powerMax: M3.ROSTER_POWER_MAX,
        note: 'One post per made man, one man per post — and a post is dead while its holder is dead, in lockup or in the hospital.' },
      // FAMILY CHARTERS — the whole catalog, good and bad together. A client that showed only the
      // upside would be selling a free upgrade, which is exactly what the handicap exists to prevent.
      charters: { list: CHARTERS, changeOmr: FAMILY_CHARTER.CHANGE_OMR,
        changeAfterH: Math.round(FAMILY_CHARTER.CHANGE_CD_MS / 3600000),
        note: 'What your family is good at, and what it gives up for it. Free the first time; after that it costs the reserve. Running no charter is a real answer — you get neither side.' },
      note: 'A district a family holds changes hands only through a sealed contest: every stake is secret until it closes, the highest takes it, the holder wins ties, and a loser forfeits part of what they put up.' },
    // ASSETS & RACKETS → Tier 4 — the upgrade axis, the tycoon ladder, the empire-set titles
    empire: { upMax: RACKET_EMPIRE.UP_MAX, upStep: RACKET_EMPIRE.UP_STEP, tycoonRanks: RACKET_EMPIRE.TYCOON_RANKS,
      sets: RACKET_EMPIRE.SETS.map((s) => ({ id: s.id, name: s.name })),
      // BUSINESS EMPIRE Tier-4 — the launderer legend + the front specializations + the takeover surface
      launderer: BUSINESS_EMPIRE.LAUNDERER_RANKS, specs: BUSINESS_EMPIRE.SPECS, specOmr: BUSINESS_EMPIRE.SPEC_OMR,
      takeover: { fee: BUSINESS_EMPIRE.TAKEOVER.FEE, minLevel: BUSINESS_EMPIRE.TAKEOVER.MIN_LEVEL } },
    missions: MISSIONS.map((m) => ({ id: m.id, name: m.name, req: m.req, reward: m.reward, brief: m.brief })),
    seals: GANG_SEALS,
    guns: GUNS.map((g) => ({ id: g.id, name: g.name, cash: g.cash, crates: g.crates, fp: g.fp, desc: g.desc })),
    races: { minLevel: RACES.MIN_LEVEL, tiers: RACES.TIERS.map((t) => ({ id: t.id, name: t.name, minLvl: t.minLvl, fee: t.fee, purse: t.purse })), tune: { cost: RACES.TUNE_COST, max: RACES.TUNE_MAX }, wager: { min: RACES.WAGER_MIN, max: RACES.WAGER_MAX }, nos: { cost: RACES.NOS_COST, max: RACES.NOS_MAX, power: RACES.NOS_POWER }, pinkSlips: true, grandPrix: { buyin: RACES.GP.BUYIN, minLevel: RACES.GP.MIN_LEVEL, minEntrants: RACES.GP.MIN_ENTRANTS, payouts: RACES.GP.PAYOUTS } },
    port: { minLevel: PORT.MIN_LEVEL, district: PORT.DISTRICT, boats: PORT.BOATS.map((b) => ({ id: b.id, name: b.name, cost: b.cost, hold: b.hold, speed: b.speed })), routes: PORT.ROUTES.map((r) => ({ id: r.id, name: r.name, minLvl: r.minLvl, minSpeed: r.minSpeed, buy: r.buy, sell: r.sell })), upgrade: { max: PORT.STEP2.UPGRADE_MAX, hullStep: PORT.STEP2.HULL_STEP, engineStep: PORT.STEP2.ENGINE_STEP }, piracy: { minLevel: PORT.STEP2.PIRATE_MIN_LEVEL, energy: PORT.STEP2.PIRATE_ENERGY, ammo: PORT.STEP2.PIRATE_AMMO } },
    // TIER C — ROUTE NOTORIETY: running the same lane heats it (convoys shed guard def / sea lanes draw the Coast Guard); vary lanes to stay cool. The Teamster/Smuggler legends earn a reputation that manages it.
    smuggling: { gain: NOTORIETY.GAIN, max: NOTORIETY.MAX, decayPerHr: NOTORIETY.DECAY_PER_HR,
      reputation: [{ tier: NOTORIETY.REP_DECAY_TIER, perk: 'your lanes cool 2× faster' }, { tier: NOTORIETY.REP_TOLL_TIER, perk: 'docks toll halved' }, { tier: NOTORIETY.REP_GAIN_TIER, perk: 'your lanes heat half as fast' }] },
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
    // the nut rides with the price: what a hand costs to keep, how long before they down tools,
    // and the wage cap (an ABSENT owner owes up to a week while the corner only earns while stocked)
    crew: { costStep: M4.CREW_COST_STEP, max: M4.CREW_MAX, wagePerHr: M4.CREW_WAGE_PER_HR,
      coldHours: M4.CREW_WAGE_COLD_MS / 3600000, wageCapHours: M4.CREW_WAGE_CAP_MS / 3600000 },
    // D11 (2026-08-05): the in-game stock book is retired — the positive claim, so a client can
    // render what replaced it (the v3 `emission: {faucet: null}` precedent).
    portfolio: null,
    estate: { nameOmr: ESTATE.NAME_OMR, tiers: ESTATE.TIERS, features: ESTATE.FEATURES, staff: ESTATE.STAFF },
    seasonMods: { pool: SEASON_MODS, note: 'one seed-drawn twist per 28-day season — the touchpoints compose on existing modifier sites' },
    // THE MAP — the edge list, published: which districts border which, and what geography does to
    // the price of turf. The board on /v1/districts carries each district's own neighbours.
    map: { adjacency: DISTRICT_ADJ, neighbourPremiumMult: MAP.NEIGHBOUR_PREMIUM_MULT, adjacentMult: MAP.ADJACENT_MULT,
      note: "contiguous turf defends itself (the holder's bordering districts raise the price once each); "
        + 'a district next to ground you already hold is cheaper to come for' },
    // THE SEASON HAS AN ENDING — the phases and what the last one changes, published so a player
    // can plan against the deadline rather than discover it
    seasonPhases: { phases: SEASON_PHASES.map((p) => ({ id: p.id, name: p.name, fromDay: p.from + 1, blurb: p.blurb })),
      reckoning: { contestMsMult: SEASON_PHASES.find((p) => p.id === 'reckoning')?.contestMsMult,
        floorMult: SEASON_PHASES.find((p) => p.id === 'reckoning')?.floorMult,
        watchWindowMult: SEASON_PHASES.find((p) => p.id === 'reckoning')?.watchWindowMult },
      note: 'the final week makes turf cheap to challenge and fast to settle — it never pays more' },
    clues: { dropP: CLUES.DROP_P, digEnergy: CLUES.DIG_ENERGY, casket: [CLUES.CASKET_MIN, CLUES.CASKET_MAX],
      cooldownHours: Math.round(CLUES.CLUE_CD_MS / 3600000), ranks: CLUES.RANKS,
      note: 'a rare drop on any successful job — a riddle trail ending in a casket' },
    duels: { stakeMin: DUELS.STAKE_MIN, rakeBps: DUELS.RAKE_BPS, minLevel: DUELS.MIN_LVL, ranks: DUELS.RANKS,
      divisions: DUELS.DIVISIONS, styles: DUELS.STYLES, styleEdge: DUELS.STYLE_EDGE, titleRanks: DUEL_TITLE_RANKS },
    megaproject: { monuments: MEGAPROJECT.MONUMENTS, minCash: MEGAPROJECT.MIN_CASH,
      minOmr: MEGAPROJECT.MIN_OMR, omrRate: MEGAPROJECT.OMR_RATE, builderRanks: MEGAPROJECT.BUILDER_RANKS,
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
    auction: { lotsPerWeek: AUCTION.LOTS_PER_WEEK, minRaiseBps: AUCTION.MIN_RAISE_BPS, archetypes: AUCTION.ARCHETYPES,
      rareArchetypes: AUCTION.RARE_ARCHETYPES, sets: AUCTION.SETS, collectorRanks: AUCTION.COLLECTOR_RANKS, consign: AUCTION.CONSIGN },
    envelope: { omr: LAW.ENVELOPE_OMR, days: Math.round(LAW.ENVELOPE_MS / 86400000), gainMult: LAW.ENVELOPE_GAIN_MULT, bleedMult: LAW.ENVELOPE_BLEED_MULT },
    foundation: FOUNDATION.TIERS.map((t) => ({ tier: t.tier, name: t.name, omr: t.omr, bustMult: t.bustMult, bleedMult: t.bleedMult, blurb: t.blurb })),
    wire: { tapOmr: WIRE.TAP_OMR, tapHours: Math.round(WIRE.TAP_MS / 3600000), tapMax: WIRE.TAP_MAX,
      sweepOmr: WIRE.SWEEP_OMR, subOmr: WIRE.SUB_OMR, subDays: Math.round(WIRE.SUB_MS / 86400000),
      traceOmr: WIRE.TRACE_OMR, dossierOmr: WIRE.DOSSIER_OMR,
      disinfoOmr: WIRE.DISINFO_OMR, disinfoHours: Math.round(WIRE.DISINFO_MS / 3600000),
      informantOmr: WIRE.INFORMANT_OMR, informantDays: Math.round(WIRE.INFORMANT_MS / 86400000), informantMax: WIRE.INFORMANT_MAX,
      spyRanks: WIRE.SPY_RANKS.map((r) => ({ min: r.min, name: r.name, tapBonus: r.tapBonus || 0, discountBps: r.discountBps || 0 })), // step four tradecraft
      subTiers: WIRE.SUB_TIERS.map((t) => ({ tier: t.tier, name: t.name, omr: t.omr, days: Math.round(t.ms / 86400000), watchSlots: t.watchSlots, warRoom: t.warRoom })) }, // step five ladder + standing watch
    // THE RARITY NFTs (v3 step 7) — public so a client can render the ladder and the tokenId space
    // without re-deriving either. `sellDeterministic` is stated in the API on purpose: it is the
    // line the loot-box question turns on, and a claim nobody can check is not worth making.
    rarity: { tiers: RARITY.TIERS.map((t) => ({ id: t.id, name: t.name, weight: t.w })),
      upgradeOmr: RARITY.UPGRADE_OMR, kinds: ['car', 'boat'], token: RARITY.TOKEN,
      sellDeterministic: true, rolledOn: 'earned-in-play' },
    store: STORE.PACKAGES.map((p) => ({ sku: p.sku, name: p.name, priceEth: p.priceEth, grant: p.grant, blurb: p.blurb })),
    pass: { tiers: PASS.TRACK.map((t) => ({ tier: t.tier, reward: t.reward })), prestigeRanks: PASS.PRESTIGE_RANKS },
    patron: { tiers: PATRON.TIERS.map((t) => ({ name: t.name, minEth: t.minEth })), prestigeRanks: PASS.PRESTIGE_RANKS },
    bonds: { backerTiers: BONDS.BACKER_TIERS, charterTiers: BONDS.CHARTER_TIERS, ethScoreOmr: BONDS.ETH_SCORE_OMR, pledgeMin: BONDS.PLEDGE_MIN,
      discountBps: BONDS.DISCOUNT_BPS, vestHours: BONDS.VEST_HOURS },
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
  // WALK AWAY — close a front up for good. The way OUT of a pad you can no longer carry: without it
  // a cold front holds its UNIQUE(character, kind) slot forever and that business kind is barred to
  // you for the rest of the street's life.
  app.delete('/v1/business/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Business.shutterBusiness(ch, req.params.id, client, h)));
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
  // rob a front — "hit the register" (the shakedown's stealth sibling on the SAME per-venue window)
  app.post('/v1/business/:id/rob', { preHandler: auth }, async (req) => {
    const owner = (await pool.query('SELECT character_id FROM businesses WHERE id=$1', [req.params.id])).rows[0];
    if (!owner) throw new G.GameError('bad_business', 'No such front.');
    return G.withTwoCharacters(pool, req.user.sub, owner.character_id, (ch, victim, client, h) =>
      Business.robBusiness(ch, victim, req.params.id, client, h));
  });
  // Tier-4: FRONT SPECIALIZATION (a max-tier $OMR-sink build choice) + THE HOSTILE TAKEOVER (two-party PvP)
  app.post('/v1/business/:id/specialize', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Business.specializeBusiness(ch, req.params.id, req.body?.spec, client, h)));
  app.post('/v1/business/:id/takeover', { preHandler: auth }, async (req) => {
    const owner = (await pool.query('SELECT character_id FROM businesses WHERE id=$1', [req.params.id])).rows[0];
    if (!owner) throw new G.GameError('bad_business', 'No such front.');
    return G.withTwoCharacters(pool, req.user.sub, owner.character_id, (ch, victim, client, h) =>
      Business.takeoverBusiness(ch, victim, req.params.id, client, h));
  });
  app.get('/v1/business', { preHandler: auth }, async (req) => {
    const cid = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0]?.id;
    return { businesses: cid ? await Business.businessesOf(pool, cid) : [] };
  });

  registerSpeakeasy(app, { pool, auth });

  registerBoxing(app, { pool, auth });

  registerStable(app, { pool, auth });

  registerRaces(app, { pool, auth });

  registerPort(app, { pool, auth });

  // THE COMMISSION — the top families' weekly city decree (votes public, effect next week).
  app.get('/v1/commission', async () => Commission.commissionBoard(pool));
  app.post('/v1/commission/vote', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Commission.castVote(ch, req.body?.decree, client, h)));
  app.post('/v1/commission/veto', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Commission.vetoDecree(ch, client, h)));
  // step three — a seated family stakes a treasury deposit to put a motion on the week's ballot
  app.post('/v1/commission/propose', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Commission.proposeDecree(ch, req.body?.decree, client, h)));
  // Tier-4 — a seated FLOOR family moves to override the head's veto (a floor supermajority restores the decree)
  app.post('/v1/commission/override', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Commission.overrideVeto(ch, client, h)));

  // SKILLS & SPECIALIZATIONS — the build layer: learn with level-derived points, respec for $OMR.
  app.get('/v1/skills', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client, h) => Skills.skillsBoard(ch, h)));
  // THE TRADES — the mastery board (use-XP tracks; pure status, the trade_rep shape generalised)
  app.get('/v1/mastery', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client, h) => Mastery.masteryBoard(ch, client, h)));
  app.post('/v1/mastery/trait/:trackId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Mastery.chooseTrait(ch, req.params.trackId, req.body?.trait, client, h)));
  app.post('/v1/skills/respec', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Skills.respecSkills(ch, client, h)));
  // step two: fire a capstone-unlocked ACTIVE ability, and per-skill (leaf-first) respec.
  app.post('/v1/skills/active/:ability', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Skills.useActive(ch, req.params.ability, client, h)));
  app.post('/v1/skills/respec/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Skills.respecOne(ch, req.params.id, client, h)));
  app.post('/v1/skills/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Skills.learnSkill(ch, req.params.id, client, h)));

  registerLaw(app, { pool, auth });

  registerPen(app, { pool, auth, closeSocketsOnKill });

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
  registerModTools(app, { pool, auth, modAuth, closeAccountSockets });
  app.post('/v1/loans/square', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Loans.squareWanted(ch, client, h)));
  // buy is two-party (buyer pays the current lender, becomes the new lender): look up the seller, lock both.
  app.post('/v1/loans/:id/buy', { preHandler: auth }, async (req) => {
    const l = (await pool.query("SELECT lender_character FROM loans WHERE id=$1 AND status='active' AND for_sale IS NOT NULL", [req.params.id])).rows[0];
    if (!l) throw new G.GameError('gone', 'That paper is off the market.');
    return G.withTwoCharacters(pool, req.user.sub, l.lender_character, (ch, victim, client, h) => Loans.buyPaper(ch, victim, req.params.id, client, h));
  });

  registerUnderworld(app, { pool, auth });

  // THE PORTFOLIO — RETIRED (D11, 2026-08-05). The routes stay MOUNTED as tombstones (the /v1/wage
  // precedent): every handler throws a clean `retired`, so a client or agent that has been polling
  // them learns what happened instead of 404-guessing. src/portfolio.js is the record.
  app.get('/v1/portfolio', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client, h) => Portfolio.portfolioBoard(ch, client, h)));
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
  // THE VAULT — burn earned $OMR to claim allocation out of the ETH the treasury actually holds
  // (omerta-stock-layer-retirement.md). The STOCK layer was retired 2026-07-31; the founder kept the
  // vault and backed it with ETH, which is what makes `allocated <= held` unbreakable — both sides
  // are now the same asset, so no price movement can put the treasury short. ALLOCATION ONLY:
  // nothing is delivered here and there is no route that delivers it.
  //   The board is a READ (readCharacter, no write lock — the D1 tripwire); the claim takes the
  // write path because it burns $OMR and touches the account's rolling cap.
  app.get('/v1/vault', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client) => Treasury.vaultBoard(client, ch.account_id)));
  app.post('/v1/vault/claim', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Treasury.claimVaulted(ch, req.body?.omr, client, h)));
  // name the FAMILY fund (a reserve $OMR sink) + the family-legit leaderboard (biggest family books)
  app.post('/v1/gangs/portfolio/name', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Portfolio.nameFamilyDynasty(ch, req.body?.name, client, h)));
  app.post('/v1/dynasty/name', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Portfolio.nameDynasty(ch, req.body?.name, client, h)));

  registerEstate(app, { pool, auth });

  // THE AUCTION HOUSE ("the sit-down"): weekly $OMR auctions of unique prestige items — highest bid burns.
  app.get('/v1/auction', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client, h) => Auction.auctionBoard(ch, client, h)));
  app.post('/v1/auction/:lotId/bid', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Auction.bidAuction(ch, req.params.lotId, req.body?.amount, client, h)));
  // Tier-4 — THE BLOCK (RESALE): consign a won trophy, bid on / pull a consignment; the collectors board
  app.post('/v1/auction/consign', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Auction.consignTrophy(ch, req.body?.lotId, req.body?.reserve, client, h)));
  app.post('/v1/auction/consign/:id/bid', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Auction.bidConsignment(ch, req.params.id, req.body?.amount, client, h)));
  app.post('/v1/auction/consign/:id/cancel', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Auction.reclaimConsignment(ch, req.params.id, client, h)));

  // NAMED LANDMARKS — one dedicable plaque per district, held by the highest $OMR flex (a status sink).
  app.get('/v1/landmarks', async () => Landmarks.landmarkBoard(pool));
  app.post('/v1/landmarks/:districtId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Landmarks.dedicateLandmark(ch, req.params.districtId, req.body?.amount, client, h)));

  // THE WIRE — the intelligence terminal: wiretaps on rivals + the Street Wire premium feed ($OMR sinks).
  app.get('/v1/wire', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client, h) => Wire.wireBoard(ch, client, h)));
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
  registerConvoy(app, { pool, auth });

  registerHeists(app, { pool, auth });

  registerCasino(app, { pool, auth });

  app.get('/v1/gangs', async () => {
    // two flat queries instead of a correlated subquery — identical response, and pg-mem
    // (the test db) can execute it, so the route is actually covered by the suite
    const r = await pool.query('SELECT id, name, tag, seal, foundation, charter, treasury, wars_won, lifetime_tribute, npc_flag FROM gangs');
    const counts = await pool.query('SELECT gang_id, COUNT(*) n FROM gang_members GROUP BY gang_id');
    const members = Object.fromEntries(counts.rows.map((c) => [c.gang_id, Number(c.n)]));
    return { gangs: r.rows.map((g) => ({ id: g.id, name: g.name, tag: g.tag,
      seal: sealOf(g.seal)?.name || null, foundation: foundationOf(g.foundation)?.name || null,
      charter: familyCharterOf(g.charter)?.name || null,
      members: members[g.id] || 0, warsWon: Number(g.wars_won),
      // NPC FAMILIES surfaced, not hidden — the streets roster's RESIDENT chip, one level up. In a
      // game with real-money extraction, passing scenery off as people is not a call to make
      // silently. They are joinable and mechanically ordinary; they just cannot sit on the
      // Commission, draw the family yield, or be declared war on.
      npc: !!g.npc_flag,
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
      // THE ROSTER — who this family has in which chair, and what each is worth right now. Public:
      // the whole point is that a rival can SEE which capability to take off the board.
      const roster = await S.rosterOf(client, req.params.id);
      await client.query('COMMIT');
      return { roster, gang: { id: g.id, name: g.name, tag: g.tag, color: g.color || null,
        // THE CHARTER — public on purpose: what a family is good at, and what it gave up for it,
        // is exactly the thing a rival should be able to read before deciding how to come at them.
        charter: g.charter ? { ...familyCharterOf(g.charter), changeOmr: FAMILY_CHARTER.CHANGE_OMR } : null,
        charters: CHARTERS,
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
        syndicate: syndicateOf(territory) } };
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  });
  app.get('/v1/districts', async () => {
    const r = await pool.query('SELECT d.id, d.holder_gang, d.garrison, d.npc_holder, d.watch_hour, d.contest_until, g.name AS gang_name, g.tag FROM districts d LEFT JOIN gangs g ON g.id = d.holder_gang');
    // THE SEALED BID — how many families are IN is public (that is the tension); what any of them
    // put up is not, and no route reads another gang's number before the contest closes.
    const bidCounts = new Map();
    for (const b of (await pool.query('SELECT district_id FROM district_bids')).rows)
      bidCounts.set(b.district_id, (bidCounts.get(b.district_id) || 0) + 1);
    // step five — THE OCCUPATION: quote the LIVE liberation cost for each NPC-garrisoned district (scales
    // with the occupying outfit's current strength, so the raid loop cheapens turf).
    const out = [];
    for (const d of r.rows) {
      const base = { id: d.id, perk: DISTRICTS.find((x) => x.id === d.id)?.perk,
        holder: d.holder_gang ? { gangId: d.holder_gang, name: d.gang_name, tag: d.tag } : null,
        garrison: Math.floor(Number(d.garrison)),
        // THE MAP: which districts border this one. Public — geography is the board everyone plays
        // on, and a map you cannot read is not a map.
        neighbours: districtNeighbours(d.id) };
      // THE WATCH — public by design (an EVE window is content precisely because everyone can read
      // it). The holder's declared hour, whether it is open right now, and what a surprise costs.
      if (d.holder_gang) {
        base.watch = { hour: d.watch_hour == null ? null : Number(d.watch_hour),
          windowH: M3.WATCH_WINDOW_H, open: S.onWatch(d), surpriseMult: S.watchMult(d) };
        // the FLOOR quoted with no coalition and no gang of your own — i.e. the dearest a stake can
        // start at. An armed coalition against the holder pays less; the server names your exact
        // number when you stake, and a wrong hint here would be worse than none.
        base.claimFloor = (await S.turfQuote(pool, { respect: 0 }, d, null)).cost;
        base.contest = d.contest_until && new Date(d.contest_until).getTime() > Date.now()
          ? { resolvesSeconds: Math.max(0, Math.round((new Date(d.contest_until).getTime() - Date.now()) / 1000)),
              families: bidCounts.get(d.id) || 0 }
          : null;
      }
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
    const r = await pool.query(`SELECT c.id, c.name, c.respect, c.loc, c.jail_until, c.hosp_until, c.guard_price, c.is_npc, g.tag
      FROM characters c LEFT JOIN gang_members m ON m.character_id = c.id LEFT JOIN gangs g ON g.id = m.gang_id
      WHERE c.alive ORDER BY c.respect DESC LIMIT 100`);
    // THE STREET WAR discovery: each mark's fronts as {id, kind} — EXISTENCE, never the books
    // (pending/scrutiny stay the owner's; the anti-precise-kill-EV info rule). One flat query
    // + a JS group (the /v1/gangs pg-mem posture).
    const fr = await pool.query('SELECT id, character_id, kind FROM businesses');
    const frontsBy = new Map();
    for (const b of fr.rows) {
      if (!frontsBy.has(b.character_id)) frontsBy.set(b.character_id, []);
      frontsBy.get(b.character_id).push({ id: b.id, kind: b.kind });
    }
    return { streets: r.rows.map((c) => ({ id: c.id, name: c.name, level: levelOf(Number(c.respect)),
      respect: Number(c.respect), loc: c.loc, gangTag: c.tag || null,
      // THE POPULATION: residents are mechanically indistinguishable — every interaction runs the
      // same audited code — but the flag is EXPOSED rather than hidden. In a game with real-money
      // extraction, quietly passing scenery off as people is not a call to make silently; the client
      // shows a subtle marker. Founder can override the presentation; the API stays honest.
      npc: !!c.is_npc,
      // surface the bodyguard offer so the hire market is discoverable (a guard lists a price,
      // consent-by-listing; without this the whole earnable-defense feature is unreachable)
      guardPrice: c.guard_price != null ? Math.floor(Number(c.guard_price)) : null,
      fronts: frontsBy.get(c.id) || [],
      jailed: jailed(c),
      hospitalized: hospitalized(c) })) };
  });
  app.post('/v1/streets/:targetId/jump', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, victim, client, h) => S.jump(ch, victim, client, h, req.body?.intent)));
  // THE STREET WAR (omerta-street-rivals-design.md): grand theft PvP — the server draws a random
  // eligible car (no fleet leak) — and the rivals ledger (who has shown you malice; account-keyed)
  app.post('/v1/streets/:targetId/steal', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, victim, client, h) => S.stealCar(ch, victim, client, h)));
  // STREET WAR step two — trunk robbery, boat theft (at the docks), stable sabotage
  app.post('/v1/streets/:targetId/trunk', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, victim, client, h) => S.robTrunk(ch, victim, client, h)));
  app.post('/v1/streets/:targetId/boat', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, victim, client, h) => S.stealBoat(ch, victim, client, h)));
  app.post('/v1/streets/:targetId/sabotage', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, victim, client, h) => S.sabotage(ch, victim, client, h)));
  app.get('/v1/rivals', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client) => Rivals.rivalsBoard(client, ch.account_id)));
  // THE CAST & THE STORY — the interpersonal cohesion layer (src/people.js): every relationship
  // the game remembers, read together; pure reads, zero §10.4
  app.get('/v1/people', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client) => People.peopleBoard(client, ch)));
  app.get('/v1/people/history/:characterId', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client) => People.pairHistory(client, ch, req.params.characterId)));
  // THE MORNING PAPER — the while-you-were-gone digest; folding is an explicit POST (a GET that
  // consumed its own window would zero itself on every render — the notifications-peek rule)
  app.get('/v1/paper', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client) => People.paperBoard(client, ch)));
  app.post('/v1/paper/read', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client) => People.foldPaper(client, ch)));
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
  app.post('/v1/streets/:targetId/npchit', { preHandler: auth }, async (req) => {
    // COVERT (meet:false) — the victim only ever meets "a hired gun"; the payer's number must not
    // land in their black book (AUDIT-street-life HIGH-1)
    const r = await G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, victim, client, h) => S.npcHit(ch, victim, client, h, req.body?.tier), { meet: false });
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
  app.post('/v1/gangs/charter/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.chooseCharter(ch, req.params.id, client, h)));
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
      const cm = (await pool.query('SELECT crew_id FROM crew_members WHERE account_id=$1', [accountId])).rows[0];
      const send = (channel) => (event) => { try { socket.send(JSON.stringify({ channel, ...event })); } catch { /* gone */ } };
      const subs = [[`me:${me.id}`, send('me')], ['streets', send('streets')],
        ['activity', send('activity')], ['chat', send('chat')]]; // the public wire: town-wide action ticker + the troll box
      if (gm?.gang_id) subs.push([`gang:${gm.gang_id}`, send('gang')]);
      if (cm?.crew_id) subs.push([`crew:${cm.crew_id}`, send('crew')]); // THE CREW ROOM — the small-group live feed
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
  // chatChar now also carries the CREW tie (account-keyed, so joined by account) — THE CREW ROOM is
  // the small-group tier between DM and family (omerta-crew-design.md).
  const chatChar = async (accountId) => (await pool.query(
    `SELECT c.id, c.name, gm.gang_id, gm.joined_at, cm.crew_id, cm.joined_at AS crew_joined FROM characters c
       LEFT JOIN gang_members gm ON gm.character_id = c.id
       LEFT JOIN crew_members cm ON cm.account_id = c.account_id
      WHERE c.account_id=$1 AND c.alive`, [accountId])).rows[0];
  // room ∈ 'city' | 'family' | 'crew'. The channel + emit target + read floor all key off it.
  const chatChannel = (ch, room) => room === 'family' ? ch.gang_id : room === 'crew' ? `crew:${ch.crew_id}` : 'city';
  const postChat = async (req, room = 'city') => {
    const body = G.cleanText(req.body?.text ?? '').trim().slice(0, 240);
    if (!body) throw new G.GameError('empty', 'say something');
    const ch = await chatChar(req.user.sub);
    if (!ch) throw new G.GameError('no_character', 'no living street');
    if (room === 'family' && !ch.gang_id) throw new G.GameError('no_gang', 'you need a family for the family room');
    if (room === 'crew' && !ch.crew_id) throw new G.GameError('no_crew', 'you need a crew for the crew room');
    // the flood brake LAST — semantic errors surface first, and only a landed line arms it
    const last = lastChatAt.get(req.user.sub) || 0;
    if (Date.now() - last < 2000) throw new G.GameError('slow_down', 'easy — one line at a time');
    lastChatAt.set(req.user.sub, Date.now()); capMap(lastChatAt);
    const channel = chatChannel(ch, room);
    const id = crypto.randomUUID();
    await pool.query('INSERT INTO chat_messages (id, channel, character_id, name, body) VALUES ($1,$2,$3,$4,$5)',
      [id, channel, ch.id, ch.name, body]);
    const ev = { type: 'chat', who: ch.name, text: body, at: Date.now() };
    if (room === 'family') G.bus.emit(`gang:${ch.gang_id}`, ev);
    else if (room === 'crew') G.bus.emit(`crew:${ch.crew_id}`, ev);
    else G.bus.emit('chat', ev);
    return { ok: true };
  };
  const readChat = async (req, room = 'city') => {
    const ch = await chatChar(req.user.sub);
    if (!ch) throw new G.GameError('no_character', 'no living street');
    if (room === 'family' && !ch.gang_id) return { messages: [] };
    if (room === 'crew' && !ch.crew_id) return { messages: [] };
    const channel = chatChannel(ch, room);
    // the family/crew room shows only messages from AFTER you joined — a spy who slips in can't read
    // the back-chat (war planning, a hit). City chat has no floor.
    const since = room === 'family' ? (ch.joined_at || new Date(0))
      : room === 'crew' ? (ch.crew_joined || new Date(0)) : new Date(0);
    const rows = (await pool.query(
      'SELECT name, body, at FROM chat_messages WHERE channel=$1 AND at >= $2 ORDER BY at DESC LIMIT 50',
      [channel, since])).rows;
    return { messages: rows.reverse().map((r) => ({ who: r.name, text: r.body, at: r.at })) };
  };
  app.post('/v1/chat', { preHandler: auth }, async (req) => postChat(req, 'city'));
  app.get('/v1/chat', { preHandler: auth }, async (req) => readChat(req, 'city'));
  app.post('/v1/gangs/chat', { preHandler: auth }, async (req) => postChat(req, 'family'));
  app.get('/v1/gangs/chat', { preHandler: auth }, async (req) => readChat(req, 'family'));
  app.post('/v1/crew/chat', { preHandler: auth }, async (req) => postChat(req, 'crew'));
  app.get('/v1/crew/chat', { preHandler: auth }, async (req) => readChat(req, 'crew'));

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
  // THE BLACK BOOK — every number you hold (met / tapped / they called you) + your open contact call
  app.get('/v1/contacts', { preHandler: auth }, async (req) => Contacts.contactsBoard(pool, req.user.sub));
  // THE BOOK — who knows the most people. Pure status (a count of lines held), so it ranks by a
  // number nobody can spend; agents and residents are excluded like every other human board.
  app.get('/v1/leaderboard/contacts', { preHandler: auth }, async () => Contacts.contactsLeaderboard(pool));
  // THE CALL — fulfil the open request. Two-party: the caller's NPC is looked up first, then both
  // rows lock in sorted order (the shakedown-route pattern — the pay can't clobber a residentAct).
  app.post('/v1/call/fulfill', { preHandler: auth }, async (req) => {
    const me = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0];
    if (!me) throw new G.GameError('no_character', 'No living street.');
    const call = (await pool.query('SELECT npc_character FROM contact_calls WHERE character_id=$1', [me.id])).rows[0];
    if (!call) throw new G.GameError('no_call', 'Nobody is waiting on you.');
    return G.withTwoCharacters(pool, req.user.sub, call.npc_character, (ch, npc, client, h) =>
      Contacts.fulfillCall(ch, npc, client, h));
  });
  // THE FAVOR (step two) — the PLAYER-posted call. Single-party throughout: the pay is escrowed on
  // the row at post, so a runner never locks the poster's character (no two-party lock surface).
  app.get('/v1/favors', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client) => Favors.favorBoard(ch, client)));
  app.post('/v1/favors', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Favors.postFavor(ch, req.body || {}, client, h)));
  app.post('/v1/favors/:id/run', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Favors.runFavor(ch, req.params.id, client, h)));
  app.delete('/v1/favors/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Favors.cancelFavor(ch, req.params.id, client, h)));

  // ── THE CREW (omerta-crew-design.md) — the lightweight 2-4 player mutual-aid pact. Status +
  // coordination only, zero §10.4. Single-party lifecycle (an invite is a pending row; nothing moves
  // until accepted, so the target is never locked). ──
  app.get('/v1/crew', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client) => Crew.crewBoard(ch, client)));
  app.post('/v1/crew', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Crew.createCrew(ch, req.body?.name, client, h)));
  app.post('/v1/crew/invite', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Crew.inviteToCrew(ch, req.body?.name, client, h)));
  app.post('/v1/crew/accept/:crewId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Crew.acceptInvite(ch, req.params.crewId, client, h)));
  app.post('/v1/crew/decline/:crewId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Crew.declineInvite(ch, req.params.crewId, client)));
  app.post('/v1/crew/leave', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Crew.leaveCrew(ch, client, h)));
  app.delete('/v1/crew/member/:characterId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Crew.kickMember(ch, req.params.characterId, client, h)));
  // THE CREW HIT (step two) — the leader calls a shared target; the crew chips in via the EXISTING
  // contract board (POST /v1/streets/:id/bounty), so this sets a pointer and moves no value.
  app.post('/v1/crew/target', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Crew.setCrewTarget(ch, req.body?.name, req.body?.kind, client, h)));
  app.delete('/v1/crew/target', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Crew.clearCrewTarget(ch, client, h)));
  // THE ROLODEX step two — RECRUITING (the crew advertises) + join REQUESTS (a solo player asks, the
  // leader accepts). The push half of discovery; status/coordination only, zero §10.4.
  app.post('/v1/crew/recruiting', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Crew.setRecruiting(ch, req.body?.on, client, h)));
  app.post('/v1/crew/request/:crewId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Crew.requestJoin(ch, req.params.crewId, client, h)));
  app.post('/v1/crew/request/:characterId/accept', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Crew.acceptRequest(ch, req.params.characterId, client, h)));
  app.delete('/v1/crew/request/:characterId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Crew.declineRequest(ch, req.params.characterId, client, h)));
  app.get('/v1/leaderboard/crews', { preHandler: auth }, async () => Crew.crewLeaderboard(pool));

  // ── THE ROLODEX (omerta-discovery-design.md) — player discovery: humans near your level + a
  // "looking for a crew" flag, so THE CREW is reachable by strangers. §10.4-free (reads + a toggle).
  app.get('/v1/discovery', { preHandler: auth }, async (req) => {
    const q = req.query || {};
    const filters = { district: q.district || null, nofam: q.nofam === '1' || q.nofam === 'true', online: q.online === '1' || q.online === 'true' };
    return G.readCharacter(pool, req.user.sub, (ch, client) => Discovery.discoveryBoard(ch, client, [...wsClients.keys()], filters));
  });
  app.post('/v1/discovery/lfg', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Discovery.setLfg(ch, req.body?.on, client, h)));

  // ── TONIGHT IN THE CITY (MOVE 2) — the live scheduled events, so anticipation is something a player
  // can SEE. A public read-only aggregator; §10.4-free.
  app.get('/v1/events', async () => cityEventBoard(pool));
  // ── THE MENTOR (MOVE 1) — the positive first interaction. ──
  app.get('/v1/mentor', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client) => Mentor.mentorBoard(ch, client)));
  app.post('/v1/mentor/seeking', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Mentor.seekMentor(ch, req.body?.on, client, h)));
  app.post('/v1/mentor/offer/:characterId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Mentor.offerMentor(ch, req.params.characterId, client, h)));
  app.post('/v1/mentor/accept/:mentorCharId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Mentor.acceptMentor(ch, req.params.mentorCharId, client, h)));
  app.post('/v1/mentor/claim', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Mentor.claimMentor(ch, client, h)));
  app.post('/v1/mentor/gift/:protegeCharId', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.protegeCharId, (ch, protege, client, h) => Mentor.mentorGift(ch, protege, client, h)));
  app.get('/v1/leaderboard/mentors', { preHandler: auth }, async () => Mentor.mentorLeaderboard(pool));

  registerKitchen(app, { pool, auth });

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
    G.readCharacter(pool, req.user.sub, (ch, client, h) => W.onboardBoard(ch, h, client)));
  // THE CAREER — the post-First-Week progression ladder (task #308): five tiers of once-ever tasks
  app.get('/v1/career', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client, h) => Career.careerBoard(ch, client, h)));
  app.post('/v1/career/:taskId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Career.claimCareer(ch, req.params.taskId, client, h)));
  // §7.13 THE LATE CLAIM — name who sent you (within the first-days window, once, attribution only)
  app.post('/v1/referral/claim', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => W.claimReferral(ch, req.body?.code, client, h)));
  // MY PROFILE — the MySpace-style personal page: identity + referral tracking + ledger-exact earnings
  app.get('/v1/profile', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client, h) => W.myProfile(ch, client, h)));
  // THE STREET WAGE (the value-creation pivot) — the public emission board: epoch, budget, your progress
  app.get('/v1/wage', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client, h) => Emission.wageBoard(client, ch, h.acct)));

  registerDiplomacy(app, { pool, auth });
  registerSov(app, { pool, auth });
  app.get('/v1/campaigns', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client, h) => Campaigns.campaignBoard(ch, client, h)));
  app.post('/v1/campaigns/:id/start', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Campaigns.startCampaign(ch, req.params.id, client, h)));
  app.post('/v1/campaigns/:id/choose', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Campaigns.chooseCampaign(ch, req.params.id, req.body?.branch, client, h)));
  app.post('/v1/campaigns/:id/claim', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Campaigns.claimCampaign(ch, req.params.id, client, h)));
  app.get('/v1/bloodline', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client, h) => Bloodline.bloodlineBoard(ch, client, h)));
  app.get('/v1/dynasty', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client) => Dynasty.dynastyBoard(ch, client)));
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
    G.readCharacter(pool, req.user.sub, (ch, client, h) => Soldiers.soldierBoard(ch, client, h.acct)));
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
    G.readCharacter(pool, req.user.sub, (ch, client) => Secrets.secretsBoard(ch, client)));
  app.post('/v1/wire/dig/:targetId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Secrets.digSecret(ch, req.params.targetId, client, h)));
  app.post('/v1/secrets/:id/extort', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Secrets.extortSecret(ch, req.params.id, req.body?.demand, client, h)));
  // the mark pays the hush — two-party (the holder is the counterparty); the holder is resolved
  // from the secret row up front so withTwoCharacters can lock both char rows sorted
  app.post('/v1/secrets/:id/pay', { preHandler: auth }, async (req) => {
    const s = (await pool.query('SELECT holder_character FROM secrets WHERE id=$1', [req.params.id])).rows[0];
    if (!s) return { error: 'no_secret', message: 'That page has already turned.' };
    // COVERT (meet:false) — the extorter reached the mark anonymously (dig via the wire, extort with
    // no name attached); PAYING the hush must not hand the mark the extorter's number in the black
    // book, or the mark can identify and retaliate against a source whose anonymity was the whole
    // mechanic. The sibling exposeSecret already carries this flag (AUDIT-street-war-street-life D1).
    return G.withTwoCharacters(pool, req.user.sub, s.holder_character,
      (ch, holder, client, h) => Secrets.payHush(ch, holder, req.params.id, client, h), { meet: false });
  });
  // expose — two-party (the holder + the mark's living street; both rows held so the meter bump
  // rides the mark's positional persist)
  app.post('/v1/secrets/:id/expose', { preHandler: auth }, async (req) => {
    const s = (await pool.query('SELECT target_account FROM secrets WHERE id=$1', [req.params.id])).rows[0];
    if (!s) return { error: 'no_secret', message: 'That page has already turned.' };
    const mark = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [s.target_account])).rows[0];
    if (!mark) return { error: 'gone', message: 'The dirt died with them.' };
    // COVERT (meet:false) — the exposure is blamed on "the wire"; the mark must not learn the
    // holder's number from the act itself (AUDIT-street-life HIGH-1)
    return G.withTwoCharacters(pool, req.user.sub, mark.id,
      (ch, markCh, client, h) => Secrets.exposeSecret(ch, markCh, req.params.id, client, h), { meet: false });
  });
  // THE COLLECTION — the account-level completion ledger (pure status)
  app.get('/v1/collection', { preHandler: auth }, async (req) => Collection.collectionBoard(pool, req.user.sub));
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

  // ── THE RESERVE BOND (Protocol-Owned Liquidity; off-chain accounting, chain DORMANT / mainnet-gated) ──
  app.get('/v1/bonds', { preHandler: auth }, async (req) => Bonds.bondBoard(pool, req.user.sub));
  app.post('/v1/bonds/:id/claim', { preHandler: auth }, async (req) => Bonds.claimBond(pool, req.user.sub, req.params.id));
  // THE UNDERWRITER (Tier-4) — the off-chain backer-prestige pillar: pledge $OMR into the treasury's name
  // (a live-now sink), commission the sequential Charter seal, and the read-derived Underwriters' League.
  app.post('/v1/bonds/pledge', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Bonds.pledgeTreasury(ch, req.body?.omr, client, h)));
  app.post('/v1/bonds/charter', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Bonds.commissionCharter(ch, client, h)));
  app.post('/v1/bond/quote', { preHandler: auth }, async (req) => Chain.quoteBond(pool, req.user.sub, req.body?.principalEth));
  // server-encode the bond() submission so an injected browser wallet (MetaMask / Robinhood Wallet / etc.)
  // can `eth_sendTransaction` it without the zero-dep client hand-rolling ABI (viem does it server-side).
  app.post('/v1/bond/calldata', { preHandler: auth }, async (req) => Chain.bondCalldata(pool, req.user.sub, req.body?.nonce));

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
  // THE RARITY NFTs (v3 step 7) — the collection, the deterministic upgrade, and the extraction.
  app.get('/v1/nft', { preHandler: auth }, async (req) => G.readCharacter(pool, req.user.sub, (ch, client, h) => nftBoard(ch, client, h)));
  app.post('/v1/nft/:kind/:id/upgrade', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => upgradeRarity(ch, req.params.kind, req.params.id, client, h), req));
  app.post('/v1/nft/:kind/:id/withdraw', { preHandler: auth }, async (req) =>
    Chain.requestItemWithdraw(pool, req.user.sub, req.params.kind, req.params.id, req.body?.address));
  app.get('/v1/withdraw/status', { preHandler: auth }, async (req) => {
    const mine = (await pool.query(
      'SELECT id, kind, amount, gear_id, nonce, status, claimed_onchain, signed_payload FROM vouchers WHERE account_id=$1 ORDER BY created_at DESC LIMIT 50',
      [req.user.sub])).rows;
    return { reserve: await Chain.reserveStatus(pool),
      vouchers: mine.map((v) => ({ id: v.id, kind: v.kind, amount: Number(v.amount), gearId: v.gear_id,
        nonce: Number(v.nonce), status: v.status, claimed: v.claimed_onchain,
        payload: v.signed_payload ? JSON.parse(v.signed_payload) : null })) };
  });

  // ── §11 entry/revive fees (paid on-chain to OmertaFees → dev wallet) ──
  // Spend a paid mint credit to make your character permanent (the two-tier upgrade).
  app.post('/v1/character/mint', { preHandler: auth }, async (req) => Fees.mintCharacter(pool, req.user.sub));
  // Spend a paid re-roll credit (0.01 ETH each on-chain) to re-roll your build — total-conserved,
  // rng_audit'd, infinitely repeatable (one credit per re-roll).
  app.post('/v1/character/reroll', { preHandler: auth }, async (req) => Fees.rerollCharacter(pool, req.user.sub));
  app.get('/v1/fees/status', { preHandler: auth }, async (req) => Fees.feeStatus(pool, req.user.sub));

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

  // ── THE STORE (ETH revenue packages) ──
  // The catalog + your live entitlements. Purchases are made ON-CHAIN at the OmertaFees paywall
  // (dormant); the watcher observes StorePaid and calls recordStorePurchase (the mint/respawn fee
  // pattern). §10.4-neutral — the Store grants only entitlements/access/status, never currency.
  app.get('/v1/store', { preHandler: auth }, async (req) => Store.storeBoard(pool, req.user.sub));
  app.post('/v1/store/plex/:sku', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Store.payPackagePlex(ch, req.params.sku, client, h)));

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

  // THE SEASON HAS AN ENDING — the clock and the roll of past seasons. Keyless like /v1/city: a
  // deadline nobody can read is not a deadline, and the record is the whole point of the arc.
  app.get('/v1/seasons', async () => Season.seasonBoard(pool));
  // THE SEASON RECAP — your own "your season" keepsakes (account-level, survives death)
  app.get('/v1/season/recap', { preHandler: auth }, async (req) => Season.seasonRecaps(pool, req.user.sub));

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
      // THE SEASON HAS AN ENDING: the twist, plus the PHASE — the clock a player plans against. A
      // deadline nobody can read is not a deadline, so the escalation is published too.
      season: (() => { const m = seasonModOf(), p = seasonPhaseOf();
        return { idx: seasonIdxOf(), daysLeft: seasonDaysLeft(),
          mod: { id: m.id, name: m.name, blurb: m.blurb },
          phase: { id: p.id, name: p.name, blurb: p.blurb, daysLeft: seasonPhaseLeft() },
          reckoning: p.id === 'reckoning' }; })(),
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
  // ── THE MEGAPROJECT → Tier 4 ──

  // ── THE DUELING LADDER (slate #5) — ranked ELO PvP on the audited casino:pvp transfer ──
  app.get('/v1/duels', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client) => Duels.duelBoard(client, ch)));
  app.post('/v1/duels/list', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client) => Duels.listDuel(ch, req.body?.limit, client)));
  app.post('/v1/duels/style', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client) => Duels.pickStyle(ch, req.body?.style, client)));
  app.post('/v1/duels/:targetId', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.targetId,
      (ch, opponent, client, h) => Duels.challenge(ch, opponent, req.body?.amount, client, h)));

  // ── CLUE SCROLLS (slate #4) — treasure trails off the §7.11 seed; the casket is the one faucet ──
  app.get('/v1/clues', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client, h) => Clues.clueBoard(client, ch, h.acct)));
  app.post('/v1/clues/dig', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Clues.dig(ch, client, h)));
  app.get('/v1/world', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client, h) => World.worldBoard(client, ch, h)));
  app.post('/v1/world/:npcId/raid', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => World.raidNpc(ch, req.params.npcId, client, h)));
  // THE BLOOD WAR — NPC families as a PvE antagonist (omerta-npc-families-defend-design.md)
  app.get('/v1/npcfamily', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client) => NpcWar.warBoard(client, ch)));
  app.post('/v1/npcfamily/:gangId/raid', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => NpcWar.raidFamily(ch, req.params.gangId, client, h)));
  app.post('/v1/npcfamily/collect', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => NpcWar.collectFamilyTribute(ch, client, h)));
  // THE FAMILY WAR (formal declaration) — a boss opens a time-boxed scored campaign against an NPC family
  app.post('/v1/npcfamily/:gangId/war', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => NpcWar.declareNpcWar(ch, req.params.gangId, client, h)));
  app.get('/v1/world/raids', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client) => World.raidBoard(client, ch.id)));
  app.post('/v1/world/:npcId/plan', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => World.planRaid(ch, req.params.npcId, client, h)));
  app.post('/v1/world/raids/:id/join', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => World.joinRaid(ch, req.params.id, client, h)));
  app.post('/v1/world/raids/:id/hire', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => World.hireRaid(ch, req.params.id, client, h)));
  app.post('/v1/world/raids/:id/dismiss', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => World.dismissGun(ch, req.params.id, client, h)));
  app.post('/v1/world/raids/:id/leave', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => World.leaveRaid(ch, req.params.id, client, h)));
  app.post('/v1/world/raids/:id/go', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => World.executeRaid(ch, req.params.id, client, h)));
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

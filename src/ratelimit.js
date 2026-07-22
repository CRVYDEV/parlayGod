// §10.2 rate limits, per account. Token buckets:
//   human keys ~1 mutating action/s, burst 5
//   agent keys 1 per 3 s hard (mirrors the prototype's agent cadence)
//   swaps 6/min (their own bucket on top of the account bucket)
// Backed by an in-process store by default; set REDIS_URL to share buckets
// across processes (fixed-window INCR/PEXPIRE — coarser but distributed).
// Enabled when NODE_ENV=production or RATE_LIMIT=on; 429 + Retry-After otherwise.

const buckets = new Map(); // key → {tokens, updatedAt}

// (red-team R9 WS/DoS) The in-memory store grew one entry per distinct account key + source IP forever
// (no eviction) → slow memory growth / DoS-over-time on the default (non-Redis) deploy. A bucket idle
// past this TTL has provably refilled to its burst (the slowest rate, swaps 0.1/s, tops any burst within
// ~1min), so deleting it is identical to it never existing — a fresh access recreates it at burst.
const BUCKET_TTL_MS = 5 * 60_000;
let sweeper = null;
function ensureSweeper() {
  if (sweeper || process.env.REDIS_URL) return;
  sweeper = setInterval(() => {
    const cutoff = Date.now() - BUCKET_TTL_MS;
    for (const [k, b] of buckets) if (b.updatedAt < cutoff) buckets.delete(k);
  }, BUCKET_TTL_MS);
  sweeper.unref?.(); // never hold the process open (clean test/CLI exit)
}

function takeMemory(key, ratePerSec, burst, now = Date.now()) {
  ensureSweeper();
  const b = buckets.get(key) || { tokens: burst, updatedAt: now };
  b.tokens = Math.min(burst, b.tokens + ((now - b.updatedAt) / 1000) * ratePerSec);
  b.updatedAt = now;
  if (b.tokens >= 1) { b.tokens -= 1; buckets.set(key, b); return { ok: true }; }
  buckets.set(key, b);
  return { ok: false, retryAfter: Math.ceil((1 - b.tokens) / ratePerSec) };
}

let redis = null;
async function takeRedis(key, ratePerSec, burst) {
  // fixed window sized to the burst: allow `burst` actions per burst/rate seconds
  const windowMs = Math.ceil((burst / ratePerSec) * 1000);
  const n = await redis.incr(`rl:${key}`);
  if (n === 1) await redis.pexpire(`rl:${key}`, windowMs);
  if (n <= burst) return { ok: true };
  const ttl = await redis.pttl(`rl:${key}`);
  return { ok: false, retryAfter: Math.max(1, Math.ceil(ttl / 1000)) };
}

export function rateLimitsEnabled() {
  if (process.env.RATE_LIMIT === 'off') return false;
  // (red-team R9 config) engage on a real deployment even if NODE_ENV was forgotten — a real
  // DATABASE_URL means real value at stake, so throttle Sybil/swap-manipulation floods regardless.
  return process.env.NODE_ENV === 'production' || process.env.RATE_LIMIT === 'on' || !!process.env.DATABASE_URL;
}

export async function initRateLimiter() {
  if (process.env.REDIS_URL) {
    const { default: Redis } = await import('ioredis');
    redis = new Redis(process.env.REDIS_URL);
    console.log('[ratelimit] redis-backed buckets');
  }
}

// Rates are read per call (not at import) so tests and ops can tune them live.
const AGENT_RATE = 1 / 3, AGENT_BURST = 1;   // §10.2: hard, no burst
const SWAP_RATE = 6 / 60, SWAP_BURST = 6;    // 6 per minute

// Auth endpoints are UNAUTHENTICATED (no accountId), so they throttle per source IP — bounding
// guest-account Sybil floods + auth-fetch (X/Privy) amplification from one origin (AUDIT-full-system-v2
// E-M1). Deliberately GENEROUS (burst 20) so it only bites a flood, never a normal sign-in burst.
// Returns null when allowed, else {retryAfter}.
export async function checkAuthRateLimit({ ip }) {
  const take = redis ? takeRedis : takeMemory;
  const rate = Number(process.env.RATE_AUTH_PER_SEC || 1);
  const burst = Number(process.env.RATE_AUTH_BURST || 20);
  const r = await take(`auth:${ip || 'unknown'}`, rate, burst);
  return r.ok ? null : { retryAfter: r.retryAfter };
}

// (red-team R10 F1) Authed READ GETs were entirely unthrottled for humans, yet a withCharacter GET
// holds a pooled connection while it accrues+persists under a FOR UPDATE on the caller's own row — so a
// concurrent-GET flood from ONE account can pin the whole connection pool and starve everyone else. A
// GENEROUS per-account read bucket: sized far above any real client's polling / WS-driven re-render
// (which the console debounces), so it never bites legit use, but caps a sustained flood. Returns null
// when allowed, else {retryAfter}.
export async function checkReadLimit({ accountId }) {
  const take = redis ? takeRedis : takeMemory;
  const rate = Number(process.env.RATE_READ_PER_SEC || 15);
  const burst = Number(process.env.RATE_READ_BURST || 60);
  const r = await take(`rd:${accountId}`, rate, burst);
  return r.ok ? null : { retryAfter: r.retryAfter };
}

// (red-team R13 F1/F2) The keyless public render routes (/card, /u, /v1/u) do real work per hit (an
// SVG→PNG raster + a DB dossier) and sit OUTSIDE the /v1 read-limiter, so an unauthenticated flood from
// one origin could pin the server. A per-IP bucket, generous enough for legit OG-crawler unfurls (a share
// is crawled a handful of times) but bounding a single-origin flood. Returns null when allowed.
export async function checkPublicRateLimit({ ip }) {
  const take = redis ? takeRedis : takeMemory;
  const rate = Number(process.env.RATE_PUBLIC_PER_SEC || 5);
  const burst = Number(process.env.RATE_PUBLIC_BURST || 30);
  const r = await take(`pub:${ip || 'unknown'}`, rate, burst);
  return r.ok ? null : { retryAfter: r.retryAfter };
}

// Returns null when allowed, else {retryAfter} seconds.
export async function checkRateLimit({ accountId, agent, path }) {
  const take = redis ? takeRedis : takeMemory;
  const humanRate = Number(process.env.RATE_HUMAN_PER_SEC || 1);
  const humanBurst = Number(process.env.RATE_HUMAN_BURST || 5);
  const main = agent
    ? await take(`a:${accountId}`, AGENT_RATE, AGENT_BURST)
    : await take(`h:${accountId}`, humanRate, humanBurst);
  if (!main.ok) return { retryAfter: main.retryAfter };
  // the swap bucket covers EVERY route that drives the AMM curve — business laundering rides the
  // same pool, so it gets the same 6/min manipulation guard (audit: the launder route bypassed it)
  if (path === '/v1/swap' || /^\/v1\/business\/[^/]+\/launder$/.test(path)) {
    const swap = await take(`s:${accountId}`, SWAP_RATE, SWAP_BURST);
    if (!swap.ok) return { retryAfter: swap.retryAfter };
  }
  return null;
}

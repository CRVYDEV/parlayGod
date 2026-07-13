// §10.2 rate limits, per account. Token buckets:
//   human keys ~1 mutating action/s, burst 5
//   agent keys 1 per 3 s hard (mirrors the prototype's agent cadence)
//   swaps 6/min (their own bucket on top of the account bucket)
// Backed by an in-process store by default; set REDIS_URL to share buckets
// across processes (fixed-window INCR/PEXPIRE — coarser but distributed).
// Enabled when NODE_ENV=production or RATE_LIMIT=on; 429 + Retry-After otherwise.

const buckets = new Map(); // key → {tokens, updatedAt}

function takeMemory(key, ratePerSec, burst, now = Date.now()) {
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
  return process.env.NODE_ENV === 'production' || process.env.RATE_LIMIT === 'on';
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

// Returns null when allowed, else {retryAfter} seconds.
export async function checkRateLimit({ accountId, agent, path }) {
  const take = redis ? takeRedis : takeMemory;
  const humanRate = Number(process.env.RATE_HUMAN_PER_SEC || 1);
  const humanBurst = Number(process.env.RATE_HUMAN_BURST || 5);
  const main = agent
    ? await take(`a:${accountId}`, AGENT_RATE, AGENT_BURST)
    : await take(`h:${accountId}`, humanRate, humanBurst);
  if (!main.ok) return { retryAfter: main.retryAfter };
  if (path === '/v1/swap') {
    const swap = await take(`s:${accountId}`, SWAP_RATE, SWAP_BURST);
    if (!swap.ok) return { retryAfter: swap.retryAfter };
  }
  return null;
}

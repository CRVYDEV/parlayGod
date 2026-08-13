// THE CITY WIRE — the organic-marketing loop. For a mafia game the community lives on Discord, and
// the city's own drama (a kill, a war declared, a family's monument raised, a prison break) is exactly
// what a genre audience screenshots and shares. This posts a CURATED, public-safe subset of the
// streets feed to a Discord webhook, so every server war becomes reach at near-zero cost.
//
// DORMANT by default — nothing posts unless CITY_WIRE_WEBHOOK_URL is set (a channel webhook, DISTINCT
// from the ops INVARIANT_WEBHOOK_URL). Read-only side-effect: it moves no value, writes no ledger row,
// ZERO §10.4 surface. PUBLIC-SAFE BY CONSTRUCTION — the allowlist below only ever posts the same
// names + event the streets feed already shows everyone; it never carries an exact dollar figure (the
// info-economy rule / the anti-precise-kill-EV rule), so a public channel can't be scanned for wealth.

// The curated dramatic set: streets event type → a formatter over its (public) payload. Anything NOT
// in this map is silently dropped — the wire is a highlight reel, not the full feed. Each line is
// deliberately punchy and screenshot-friendly; none references money.
const WIRE = {
  kill: (e) => e.by && e.by.startsWith('a ') ? `☠️ **${e.victim}** was found dead in the gutter — ${e.by} did the job.`
    : `☠️ **${e.by}** put **${e.victim}** in the ground.`,
  sacked: (e) => `🏢 **${e.by}** whacked **${e.on}** and seized their ${e.front}.`,
  scandal: (e) => `🔪 **${e.killer}** murdered their own in-law, **${e.victim}** — the families will not forget it.`,
  vendetta_settled: (e) => `🩸 **${e.by}** settled the blood feud, avenging **${e.for}** on **${e.on}**.`,
  family_war_declared: (e) => `⚔️ **${e.who}** declared WAR on the **${e.family}** family.`,
  family_war_won: (e) => `🏴 **${e.who}** crushed the **${e.family}** family and took the spoils.`,
  ticker_ballot: (e) => e.ticker ? (e.decidedBy === 'chamber'
    ? `📈 The Commission set the day's buy: **${e.ticker}** (${e.votes} ${e.votes === 1 ? 'family' : 'families'} voted).`
    : `📈 The chamber was silent — the day's buy defaults to **${e.ticker}**.`) : null,
  frontier_seized: (e) => e.gang ? `🌆 The **${e.gang}** family routed the ${e.npc} and planted their flag.`
    : `🌆 The ${e.npc} cartel was routed on the frontier.`,
  megaproject_complete: (e) => `🏛️ The city raised **${e.monument}** — its architect: **${e.architect}**. It stands forever.`,
  sov_built: (e) => `🏰 The **${e.gang}** family raised a stronghold over ${e.district}.`,
  breakout: (e) => e.crew > 1 ? `🚨 ${e.crew} inmates went over the wall together — a jailbreak.`
    : `🚨 Somebody went over the wall — a prison break.`,
  boxing_title_fight: (e) => `🥊 Title fight announced: **${e.card}**.`,
};

// A light in-memory token bucket so a busy server can't flood the channel (Discord rate-limits, and a
// wall of messages reads as noise, not drama). Per-process; a spike over the cap is simply dropped.
const MAX_PER_WINDOW = 20;      // at most 20 posts …
const WINDOW_MS = 10 * 60 * 1000; // … per 10 minutes
let bucket = [];

// The delivery seam — swapped in tests (the push.js discipline) so we assert what WOULD be posted
// without a network call. Default posts a Discord-shaped { content } payload.
let deliver = async (url, content) => {
  try {
    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }) });
  } catch { /* best-effort: a down webhook must never affect gameplay */ }
};
export function __setDeliver(fn) { deliver = fn; }

// Format a streets event for the wire, or null if it isn't in the curated dramatic set. Exported so a
// test can assert the allowlist + that no line carries a dollar figure, without any network.
export function cityWireLine(ev) {
  if (!ev || typeof ev.type !== 'string') return null;
  const fmt = WIRE[ev.type];
  if (!fmt) return null;
  try {
    const line = fmt(ev.payload || ev);
    if (typeof line !== 'string' || !line.trim()) return null;
    // A missing payload field interpolates as "undefined"/"null" — drop the garbage line rather than
    // post it (a formatter shouldn't have to hand-validate every field, and a half-formed name on a
    // public channel is worse than silence).
    if (/\b(undefined|null|NaN)\b/.test(line)) return null;
    return line;
  } catch { return null; }
}

// The hook: called for every streets bus event. Dormant unless the webhook is configured; drops
// anything outside the curated set; throttled. Best-effort and non-blocking — a slow/broken webhook
// can never affect the request that emitted the event (the caller does not await this).
export function postCityWire(ev) {
  const url = process.env.CITY_WIRE_WEBHOOK_URL;
  if (!url) return;                          // dormant by default
  const line = cityWireLine(ev);
  if (!line) return;                          // not a highlight
  const now = Date.now();
  bucket = bucket.filter((t) => now - t < WINDOW_MS);
  if (bucket.length >= MAX_PER_WINDOW) return; // throttled — drop the overflow
  bucket.push(now);
  deliver(url, line);                          // fire-and-forget
}

// THE DISPATCH — the opt-in "while you were gone" email digest.
//
// A lazy-accrual game means things happen TO you while you're gone. Web push reaches players who opted in
// on a device; email reaches the ones who DIDN'T — the lapsed, the churned, the ones who closed the tab
// weeks ago. The content already exists (the Morning Paper: your empire's take, your rival's move, the
// Bureau circling); this is the channel that carries it to a returning-nudge.
//
// DORMANT until an email provider key is set (the VAPID / chain precedent — nothing sends without
// EMAIL_API_KEY). OPT-IN only (a player enters an address and turns it on) with a one-click unsubscribe in
// every message (a stateless HMAC token — no click-tracking, no dark patterns). §10.4-FREE: a digest moves
// no value and writes no ledger row; it READS the same notification + ledger data the Morning Paper does.
//
// Deliberately careful copy: in-game figures are game currency, never a real-money/price/earnings claim.
import crypto from 'node:crypto';
import { GameError } from './game.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const day = 24 * 3600 * 1000;

export function digestConfigured() { return !!process.env.EMAIL_API_KEY; }
const cfg = {
  lapseDays: () => Number(process.env.DIGEST_LAPSE_DAYS ?? 3),
  cooldownDays: () => Number(process.env.DIGEST_COOLDOWN_DAYS ?? 7),
  maxLapseDays: () => Number(process.env.DIGEST_MAX_LAPSE_DAYS ?? 30),
  from: () => process.env.EMAIL_FROM || 'OMERTA <noreply@omerta.fun>',
  apiUrl: () => process.env.EMAIL_API_URL || 'https://api.resend.com/emails',
  base: () => (process.env.PUBLIC_URL || process.env.SOCIAL_GAME_URL || 'https://www.omerta.fun').replace(/\/$/, ''),
};

// ── the unsubscribe token: HMAC(account_id) with the server secret. Stateless (no column), unforgeable,
// so an unsubscribe link needs no login and can't be guessed. ──
export function unsubToken(accountId) {
  const secret = process.env.JWT_SECRET || 'dev-secret';
  return crypto.createHmac('sha256', secret).update(`digest:${accountId}`).digest('base64url').slice(0, 24);
}
export function verifyUnsub(accountId, token) {
  const want = unsubToken(accountId);
  try { return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(String(token || ''))); }
  catch { return false; }
}

// ── SET / READ preferences (the player's own account, via withCharacter's account row) ──
export async function setDigestPrefs(pool, accountId, { email, optin }) {
  const on = !!optin;
  let addr = email == null ? undefined : String(email).trim().toLowerCase();
  if (addr !== undefined && addr !== '' && !EMAIL_RE.test(addr)) throw new GameError('bad_email', "That doesn't look like an email address.");
  if (on && (addr === undefined || addr === '')) {
    // turning ON without giving an address: keep whatever's stored, but there must be one
    const cur = (await pool.query('SELECT email FROM account_persistent WHERE account_id=$1', [accountId])).rows[0];
    if (!cur?.email) throw new GameError('no_email', 'Add an email address to turn on the digest.');
  }
  // build the update from only the fields provided (email optional on a plain toggle)
  if (addr !== undefined) {
    await pool.query('UPDATE account_persistent SET email=$2, digest_optin=$3 WHERE account_id=$1',
      [accountId, addr === '' ? null : addr, on && addr !== '']);
  } else {
    await pool.query('UPDATE account_persistent SET digest_optin=$2 WHERE account_id=$1', [accountId, on]);
  }
  return getDigestPrefs(pool, accountId);
}
export async function getDigestPrefs(pool, accountId) {
  const r = (await pool.query('SELECT email, digest_optin FROM account_persistent WHERE account_id=$1', [accountId])).rows[0] || {};
  return { available: digestConfigured(), email: r.email || null, optin: !!r.digest_optin };
}

// ── the unsubscribe landing (public, keyless — the link in every email) ──
export async function unsubscribe(pool, accountId, token) {
  if (!verifyUnsub(accountId, token)) return { ok: false };
  await pool.query('UPDATE account_persistent SET digest_optin=false WHERE account_id=$1', [accountId]);
  return { ok: true };
}

// ── the digest content over a window (the Morning Paper's shape, but on a window WE control — since the
// last dispatch / last-active, capped — not the in-app paper_at marker). Reads only; moves nothing. ──
async function digestFor(client, charId, since) {
  const headlines = (await client.query(
    `SELECT type, COUNT(*) n FROM notifications WHERE character_id=$1 AND created_at > $2
      GROUP BY type ORDER BY COUNT(*) DESC LIMIT 10`, [charId, since])).rows.map((r) => ({ type: r.type, n: Number(r.n) }));
  const rows = (await client.query(
    `SELECT reason, SUM(amount) s FROM transactions WHERE character_id=$1 AND at > $2 AND currency='cash'
      GROUP BY reason`, [charId, since])).rows;
  const inFold = new Map(), outFold = new Map();
  for (const r of rows) {
    const k = String(r.reason).split(':')[0], s = Number(r.s);
    if (s > 0) inFold.set(k, (inFold.get(k) || 0) + s);
    else if (s < 0) outFold.set(k, (outFold.get(k) || 0) - s);
  }
  const earned = [...inFold].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([what, total]) => ({ what, total: Math.floor(total) }));
  const spent = [...outFold].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([what, total]) => ({ what, total: Math.floor(total) }));
  const totalIn = earned.reduce((a, e) => a + e.total, 0);
  return { headlines, earned, totalIn, worth: headlines.length > 0 || totalIn > 0 };
}

// human words for the headline types (the same public-safe vocabulary the feed uses)
const HEAD = {
  whacked: 'your street was killed — your heir is up', indicted: 'the Bureau indicted you',
  bounty_on_you: 'a contract was put on your head', sacked: 'a rival seized one of your fronts',
  robbed: 'your business got hit', car_stolen: 'your car was stolen', attack: 'you were jumped',
  extortion: "you're being extorted", npc_aggression: 'a family opened hostilities', first_blood: 'someone called you out',
  loan_defaulted: 'a debt came due', protege_attacked: 'your protégé was attacked', made: 'you got made',
};
const headLine = (t) => HEAD[t] || String(t).replace(/_/g, ' ');
const money = (n) => '$' + Number(n || 0).toLocaleString('en-US');

function renderEmail(name, d, accountId) {
  const base = cfg.base();
  const unsub = `${base}/v1/digest/unsubscribe?a=${encodeURIComponent(accountId)}&t=${unsubToken(accountId)}`;
  const heads = d.headlines.slice(0, 6).map((h) => `${headLine(h.type)}${h.n > 1 ? ` (×${h.n})` : ''}`);
  const subject = heads.length
    ? `While you were gone: ${heads[0]}${heads.length > 1 ? ` (+${heads.length - 1} more)` : ''}`
    : `The city moved without you`;
  const takeLine = d.totalIn > 0 ? `Your operations booked ${money(d.totalIn)} while you were away.` : '';
  const bullets = heads.map((h) => `<li style="margin:6px 0">${h}</li>`).join('');
  const html = `<!doctype html><html><body style="margin:0;background:#0c0b0d;color:#e9e3d6;font-family:Georgia,serif">
    <div style="max-width:520px;margin:0 auto;padding:32px 24px">
      <div style="font-family:monospace;font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:#a89e90">The Morning Paper</div>
      <h1 style="font-size:30px;margin:10px 0 4px;color:#e9e3d6">While you were gone, ${escapeHtml(name)}.</h1>
      ${takeLine ? `<p style="color:#c9a24a;margin:8px 0 16px">${takeLine}</p>` : ''}
      ${bullets ? `<p style="color:#a89e90;margin:16px 0 6px">Here's what the city got up to:</p><ul style="color:#e9e3d6;padding-left:18px;margin:0">${bullets}</ul>` : `<p style="color:#a89e90">${takeLine ? 'Otherwise quiet' : "It's quiet"} — but it won't stay that way. Come see who's on the wire.</p>`}
      <div style="margin:28px 0">
        <a href="${base}/" style="display:inline-block;background:#b02a30;color:#fff;text-decoration:none;padding:12px 22px;border-radius:3px;font-family:monospace;letter-spacing:.1em;text-transform:uppercase;font-size:13px">Back to the city →</a>
      </div>
      <hr style="border:0;border-top:1px solid rgba(233,227,214,.13);margin:24px 0">
      <p style="font-family:monospace;font-size:11px;color:#6f675d;line-height:1.7">
        You're getting this because you turned on the digest in OMERTÀ. Figures are in-game currency only.<br>
        <a href="${unsub}" style="color:#a89e90">Unsubscribe</a> — one click, no questions.
      </p>
    </div></body></html>`;
  const text = `While you were gone, ${name}.\n\n${takeLine ? takeLine + '\n\n' : ''}${heads.length ? heads.map((h) => '· ' + h).join('\n') : `${takeLine ? 'Otherwise quiet' : "It's quiet"} — but it won't stay that way.`}\n\nBack to the city: ${base}/\n\nFigures are in-game currency only.\n\nUnsubscribe: ${unsub}`;
  return { subject, html, text };
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// the actual send — a provider HTTP POST (Resend shape: from/to/subject/html/text + Bearer key). A seam so
// the test observes without a real provider. Returns true on a 2xx.
let sender = async (to, subject, html, text) => {
  const res = await fetch(cfg.apiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.EMAIL_API_KEY}` },
    body: JSON.stringify({ from: cfg.from(), to: [to], subject, html, text }),
  });
  return res.ok;
};
export function __setSender(fn) { sender = fn; }   // test seam only

// ── THE WORKER SWEEP — email each lapsed, opted-in player one digest, then stamp digest_at (the cooldown).
// Lapsed = last activity between DIGEST_LAPSE_DAYS and DIGEST_MAX_LAPSE_DAYS ago (we stop nagging the long
// gone). Dormant unless configured. §10.4-free. ──
export async function sweepDispatch(pool) {
  if (!digestConfigured()) return 0;
  const now = Date.now();
  const cooldownBefore = new Date(now - cfg.cooldownDays() * day);
  const activeSince = new Date(now - cfg.maxLapseDays() * day);   // not gone TOO long
  const lapsedBefore = new Date(now - cfg.lapseDays() * day);     // gone at least this long

  // opted-in accounts with an address, a living non-npc/agent street, not banned, cooldown elapsed.
  const cands = (await pool.query(
    `SELECT ap.account_id, ap.email, c.id char_id, c.name
       FROM account_persistent ap
       JOIN characters c ON c.account_id = ap.account_id AND c.alive AND NOT c.is_npc
       JOIN accounts a ON a.id = ap.account_id AND a.status <> 'banned'
      WHERE ap.digest_optin AND ap.email IS NOT NULL AND NOT ap.agent_flag AND NOT ap.npc_flag
        AND (ap.digest_at IS NULL OR ap.digest_at < $1)
      LIMIT 500`, [cooldownBefore])).rows;
  if (!cands.length) return 0;

  // last-activity per account (the telemetry signal /v1/online uses). Flat query + JS map — pg-mem can't
  // do a correlated aggregate (the /v1/gangs lesson).
  const acts = await pool.query('SELECT account_id, MAX(at) last FROM telemetry GROUP BY account_id');
  const lastActive = new Map(acts.rows.map((r) => [r.account_id, new Date(r.last).getTime()]));

  let sent = 0;
  for (const c of cands) {
    const la = lastActive.get(c.account_id);
    // LAPSED window: last-active older than the lapse threshold, but not older than the max (don't email
    // someone gone months, forever). No telemetry at all = never really played; skip.
    if (!la || la > lapsedBefore.getTime() || la < activeSince.getTime()) continue;
    // CLAIM the cooldown BEFORE the send (claim-then-send, the push C1 discipline): stamp digest_at with
    // a guard so two overlapping workers can't both email; only the winner proceeds.
    const claim = await pool.query(
      'UPDATE account_persistent SET digest_at=now() WHERE account_id=$1 AND (digest_at IS NULL OR digest_at < $2)',
      [c.account_id, cooldownBefore]);
    if (!claim.rowCount) continue;
    // build the digest over the window since they went quiet (capped at the max lapse)
    const since = new Date(Math.max(la, activeSince.getTime()));
    const d = await digestFor(pool, c.char_id, since);
    if (!d.worth) continue;   // nothing happened worth an email (the cooldown stamp stands — no empty nag)
    const { subject, html, text } = renderEmail(c.name, d, c.account_id);
    try { if (await sender(c.email, subject, html, text)) sent++; }
    catch { /* a bad address never stalls the sweep (the stamp stands — no retry-storm) */ }
  }
  return sent;
}

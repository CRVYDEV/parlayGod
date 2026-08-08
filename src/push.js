// src/push.js — WEB PUSH (so a returning player learns what happened while away, tab closed).
//
// A lazy-accrual game means things happen TO you while you're gone — a contract on your head, a RICO
// indictment, your empire seized — and the only way to learn was to open the tab. Web push closes that:
// an opt-in browser subscription + a service worker, and the WORKER pushes URGENT, still-undelivered
// notifications to the phone.
//
// DESIGN: the worker (not the request path) does the sending, so a push is POST-COMMIT by construction —
// it only ever sees notifications that really landed (no spurious push for a rolled-back action), and it
// naturally targets AWAY players (their notifications are `delivered=false` until they read them). Idempotent
// via a `pushed` flag. DORMANT unless VAPID_* is configured (the chain/dormant precedent). ZERO §10.4 — a
// push moves no value; the notification row was already written by the game action.
import webpush from 'web-push';
import { GameError } from './game.js';
import { uid } from './social/shared.js';

let configured = false;
export function initPush() {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT || 'mailto:ops@omerta.fun';
  configured = false;
  if (pub && priv) { try { webpush.setVapidDetails(subj, pub, priv); configured = true; } catch { configured = false; } }
  return configured;
}
export const pushConfigured = () => configured;
// the applicationServerKey the client subscribes with — PUBLIC by design (client-embedded), null when off
export const pushPublicKey = () => (configured ? process.env.VAPID_PUBLIC_KEY || null : null);

// the URGENT notification types worth a phone buzz — a curated subset of the client's URGENT_TYPES (the
// terminal / high-signal ones a player genuinely wants to know about immediately, even away from the tab).
// Each maps to a short push title; the body is derived from the payload.
export const PUSH_TITLES = {
  whacked: 'You were killed',
  indicted: 'The Bureau indicted you',
  bounty_on_you: 'A contract is out on you',
  sacked: 'Your empire was seized',
  extortion: "You're being extorted",
  protege_attacked: 'Your protégé needs you',
  npc_aggression: 'An outfit opened hostilities',
  loan_defaulted: 'A debt has come due',
  robbed: 'Your business was hit',
  car_stolen: 'Your car was stolen',
};

// a short body line from the type + payload (best-effort; falls back to a generic line)
function bodyFor(type, p) {
  switch (type) {
    case 'whacked': return `${p.by || 'Someone'} put you in the ground — your heir is up.`;
    case 'indicted': return 'The clock is ticking — square it or stand trial.';
    case 'bounty_on_you': return `${p.amount ? '$' + Number(p.amount).toLocaleString() + ' ' : ''}on your head. Lie low or square your name.`;
    case 'sacked': return `${p.by || 'A rival'} took over one of your fronts.`;
    case 'extortion': return `${p.from || 'Someone'} wants a cut — pay up or expose it.`;
    case 'protege_attacked': return `${p.protege || 'Your protégé'} got ${p.what || 'hit'} by ${p.from || 'someone'}.`;
    case 'npc_aggression': return `${p.family || 'An outfit'} sent their guns at your family.`;
    case 'loan_defaulted': return 'You defaulted — the shark is collecting.';
    case 'robbed': return `${p.from || 'Someone'} hit the register at your ${p.kind || 'business'}.`;
    case 'car_stolen': return `${p.from || 'Someone'} stole your ${p.model || 'ride'}.`;
    default: return 'Something happened in the city.';
  }
}

// ── SUBSCRIBE / UNSUBSCRIBE — the browser's PushSubscription, stored per account (endpoint is the key). ──
export async function saveSubscription(pool, accountId, sub) {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    throw new GameError('bad_sub', 'Invalid push subscription.');
  }
  // (red-team R28 LOW-3) the endpoint is attacker-chosen and the worker POSTs to it — reject anything
  // that isn't a real https push host so it can't be pointed at an internal address (a blind SSRF from
  // the worker, e.g. http://169.254.169.254/…). A genuine Web-Push endpoint is always https.
  let host = '';
  try { const u = new URL(sub.endpoint); if (u.protocol !== 'https:') throw 0; host = u.hostname; } catch { throw new GameError('bad_sub', 'Invalid push subscription.'); }
  if (host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) throw new GameError('bad_sub', 'Invalid push subscription.');
  await pool.query(
    `INSERT INTO push_subscriptions (id, account_id, endpoint, p256dh, auth) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (endpoint) DO UPDATE SET account_id=$2, p256dh=$4, auth=$5`,
    [uid(), accountId, sub.endpoint, sub.keys.p256dh, sub.keys.auth]);
  return { ok: true, subscribed: true };
}
export async function removeSubscription(pool, accountId, endpoint) {
  if (endpoint) await pool.query('DELETE FROM push_subscriptions WHERE account_id=$1 AND endpoint=$2', [accountId, endpoint]);
  else await pool.query('DELETE FROM push_subscriptions WHERE account_id=$1', [accountId]);
  return { ok: true, subscribed: false };
}

// the actual delivery — a seam so the test can observe calls without a real push service (production uses
// webpush.sendNotification). A dead endpoint (404/410) is pruned so the table doesn't accumulate corpses.
let deliver = async (pool, sub, payload) => {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
  } catch (e) {
    const code = e && e.statusCode;
    if (code === 404 || code === 410) await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [sub.endpoint]).catch(() => {});
  }
};
export function __setDeliver(fn) { deliver = fn; }   // test seam only

async function pushToAccount(pool, accountId, title, body, url) {
  const subs = (await pool.query('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE account_id=$1', [accountId])).rows;
  if (!subs.length) return 0;
  const payload = JSON.stringify({ title, body, url: url || '/' });
  for (const s of subs) await deliver(pool, s, payload);
  return subs.length;
}

// build ONE digest push from an account's batch of claimed notifications — a per-account digest, so a
// player who missed several things gets ONE buzz, not a storm. A single alert keeps its specific line.
function digest(claimed) {
  if (claimed.length === 1) {
    const n = claimed[0]; let p = {}; try { p = JSON.parse(n.payload); } catch { /* keep {} */ }
    return { title: PUSH_TITLES[n.type] || 'OMERTÀ', body: bodyFor(n.type, p) };
  }
  const heads = [];
  for (const n of claimed) { const t = PUSH_TITLES[n.type]; if (t && !heads.includes(t)) heads.push(t); }
  const shown = heads.slice(0, 3).join(' · ');
  const more = heads.length > 3 ? ` +${heads.length - 3} more` : '';
  return { title: `${claimed.length} things need you`, body: `${shown}${more}. Open OMERTÀ.` };
}

// ── THE WORKER SWEEP — push URGENT, still-undelivered, not-yet-pushed notifications from the last hour,
// then mark them pushed (idempotent; a failed send still marks so we don't retry-storm). Post-commit by
// construction. Dormant unless configured. Two behaviours the deferred gaps asked for:
//   · SKIP a recently-active account — a live tab is NOT "away", and the notification already reached
//     them on the WS `me` channel; a phone buzz would be redundant. The worker is a SEPARATE process
//     with no `wsClients`, so it uses the SAME cross-process signal /v1/online uses: the telemetry table.
//   · DIGEST per account — one buzz for the whole batch, not one per event. ──
export async function sweepPush(pool) {
  if (!configured) return;
  const types = Object.keys(PUSH_TITLES);
  // pg-mem returns zero rows for `= ANY($1)` (the MY PROFILE lesson) — build a parameterized IN list.
  const inList = types.map((_, i) => `$${i + 1}`).join(',');
  const rows = (await pool.query(
    `SELECT n.id, n.type, n.payload, c.account_id
       FROM notifications n JOIN characters c ON c.id=n.character_id AND c.alive
      WHERE NOT n.pushed AND NOT n.delivered AND n.type IN (${inList})
        AND n.created_at > now() - interval '1 hour'
      ORDER BY c.account_id, n.created_at LIMIT 200`, types)).rows;
  if (!rows.length) return 0;
  // the recently-active set (a live/at-the-tab player). pg-mem can't do a correlated NOT EXISTS (the
  // /v1/gangs lesson), so pull it flat and filter in JS. PUSH_SKIP_ACTIVE_MIN=0 disables the skip.
  const activeMin = Number(process.env.PUSH_SKIP_ACTIVE_MIN ?? 3);
  const active = new Set();
  if (activeMin > 0) {
    const a = await pool.query('SELECT DISTINCT account_id FROM telemetry WHERE at > $1',
      [new Date(Date.now() - activeMin * 60000)]);
    for (const r of a.rows) active.add(r.account_id);
  }
  // group the pushable rows by account (skipping the recently-active)
  const byAcct = new Map();
  for (const n of rows) {
    if (active.has(n.account_id)) continue;
    let g = byAcct.get(n.account_id); if (!g) byAcct.set(n.account_id, g = []);
    g.push(n);
  }
  let pushed = 0;
  for (const [accountId, ns] of byAcct) {
    // CLAIM the whole batch atomically BEFORE the send (claim-then-notify, the Wire-watchdog / fees
    // discipline, C1). A plain SELECT takes no row lock, so two overlapping workers (a deploy overlap —
    // the runWageEpoch threat model) would BOTH buzz. The atomic `AND NOT pushed RETURNING` means each
    // row is claimed by exactly one worker; RETURNING is the set THIS worker owns. The tradeoff — a lost
    // push if the process dies AFTER the claim but BEFORE the send — is chosen over duplicate buzzes.
    const ids = ns.map((n) => n.id);
    const ph = ids.map((_, i) => `$${i + 1}`).join(',');
    const claimed = (await pool.query(
      `UPDATE notifications SET pushed=true WHERE id IN (${ph}) AND NOT pushed RETURNING id, type, payload`, ids)).rows;
    if (!claimed.length) continue;   // another worker won them all
    const { title, body } = digest(claimed);
    try { await pushToAccount(pool, accountId, title, body, '/'); pushed++; }
    catch { /* a bad account/sub never stalls the sweep (the claims stand — no re-buzz) */ }
  }
  return pushed;
}

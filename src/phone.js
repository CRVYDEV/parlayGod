// THE CELLPHONE (founder-directed): a personal inbox + player-to-player DIRECT MESSAGES.
// Two halves, both pure talk — ZERO §10.4 surface (no currency ever rides the phone):
//   THE INBOX  — the existing `notifications` stream (every "something happened TO you" event:
//                convoy jacked, contract posted, tribute due, fee credited, …) surfaced as a
//                readable list WITHOUT flipping `delivered` (that flag belongs to the WS backfill —
//                the phone PEEKS; GET /v1/notifications remains the one delivery-marking read).
//   THE LINE   — DMs between players, ACCOUNT-keyed on both sides so a thread survives death and
//                rename (the bloodline keeps its phone; the heir picks it up). Name snapshots per
//                line (the troll-box discipline); the counterpart's CURRENT living street is
//                resolved for display + reply targeting.
// Discipline: cleanText + 240-char clamp + a 2s per-account flood brake (the postChat trio);
// self-DM blocked; a recipient with no living street still receives (the heir reads it later).
// Retention: the worker's 30-day sweep. No block/mute in step one (flagged in the design margin).
import crypto from 'crypto';
import { GameError, cleanText, notify } from './game.js';

const DM_MAX_LEN = 240;
const DM_BRAKE_MS = 2000;
const lastDmAt = new Map(); // accountId -> ms (in-process flood brake, the lastChatAt twin)
const capMap = (m, cap = 20000) => { while (m.size > cap) m.delete(m.keys().next().value); };

const livingChar = async (pool, accountId) =>
  (await pool.query('SELECT id, name, account_id FROM characters WHERE account_id=$1 AND alive', [accountId])).rows[0];

// ── send a DM to the player behind a character id (alive or dead — the ACCOUNT is the line) ──
export async function sendDm(pool, fromAccountId, targetCharacterId, text) {
  const body = cleanText(text ?? '').trim().slice(0, DM_MAX_LEN);
  if (!body) throw new GameError('empty', 'Say something.');
  const me = await livingChar(pool, fromAccountId);
  if (!me) throw new GameError('no_character', 'No living street — no phone.');
  const target = (await pool.query('SELECT id, name, account_id, alive FROM characters WHERE id=$1',
    [targetCharacterId])).rows[0];
  if (!target) throw new GameError('gone', 'Nobody answers that number.');
  if (target.account_id === fromAccountId) throw new GameError('self', 'Talking to yourself again.');
  // the flood brake LAST — semantic errors surface first, and only a landed line arms it
  const last = lastDmAt.get(fromAccountId) || 0;
  if (Date.now() - last < DM_BRAKE_MS) throw new GameError('slow_down', 'Easy — one message at a time.');
  lastDmAt.set(fromAccountId, Date.now()); capMap(lastDmAt);
  // to_name: the line's CURRENT holder if the named street is dead (the heir answers the phone)
  let toName = target.name;
  if (!target.alive) {
    const heir = await livingChar(pool, target.account_id);
    if (heir) toName = heir.name;
  }
  const id = crypto.randomUUID();
  await pool.query('INSERT INTO dm_messages (id, from_account, to_account, from_name, to_name, body) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, fromAccountId, target.account_id, me.name, toName, body]);
  // ring the recipient's LIVING street: a normal notification (inbox row + live WS push).
  // notify() only needs a query()-capable handle — the pool works outside a txn (best-effort:
  // the DM row is already committed; a dead line just waits for the heir).
  try {
    const rcpt = await livingChar(pool, target.account_id);
    if (rcpt) await notify(pool, rcpt.id, 'dm', { from: me.name, fromCharacter: me.id, preview: body.slice(0, 80) });
  } catch { /* the ring is decorative — the message stands */ }
  return { ok: true, id };
}

// ── the phone board: threads (grouped by counterpart account) + an inbox PEEK ──
export async function phoneBoard(pool, accountId) {
  const me = await livingChar(pool, accountId);
  // flat query, grouped in JS (the /v1/gangs two-flat-queries pg-mem precedent)
  const rows = (await pool.query(
    `SELECT * FROM dm_messages WHERE from_account=$1 OR to_account=$1 ORDER BY at DESC LIMIT 300`,
    [accountId])).rows;
  const threads = new Map(); // counterpart account -> thread
  let unreadDm = 0;
  for (const m of rows) {
    const mine = m.from_account === accountId;
    const other = mine ? m.to_account : m.from_account;
    const unread = !mine && !m.seen;
    if (unread) unreadDm += 1;
    let t = threads.get(other);
    if (!t) {
      t = { account: other, name: mine ? m.to_name : m.from_name,
        last: { text: m.body, at: m.at, fromMe: mine }, unread: 0 };
      threads.set(other, t);
    }
    if (unread) t.unread += 1;
  }
  // resolve each counterpart's CURRENT living street (reply target + fresh name); a line with no
  // living street shows the snapshot name and replyable:false (the heir will pick it up)
  const others = [...threads.keys()];
  if (others.length) {
    const ph = others.map((_, i) => `$${i + 1}`).join(',');
    const live = (await pool.query(
      `SELECT id, name, account_id FROM characters WHERE alive AND account_id IN (${ph})`, others)).rows;
    for (const c of live) {
      const t = threads.get(c.account_id);
      if (t) { t.name = c.name; t.characterId = c.id; }
    }
  }
  // the inbox PEEK — recent notifications WITHOUT flipping delivered (that's the WS backfill's flag)
  let inbox = [], unreadInbox = 0;
  if (me) {
    const ns = (await pool.query(
      'SELECT id, type, payload, delivered, created_at FROM notifications WHERE character_id=$1 ORDER BY created_at DESC LIMIT 30',
      [me.id])).rows;
    inbox = ns.map((n) => ({ id: n.id, type: n.type, payload: JSON.parse(n.payload), unread: !n.delivered, at: n.created_at }));
    unreadInbox = inbox.filter((n) => n.unread).length;
  }
  // account UUIDs are NEVER exposed to clients (the closeSocketsOnKill discipline) — threads are
  // keyed for the client by the counterpart's living characterId; a dead line simply can't be
  // opened until the heir rises (the already-sent messages are waiting for them, not for you).
  return { threads: [...threads.values()].map(({ account, ...t }) => ({ ...t, replyable: !!t.characterId })),
    unreadDm, inbox, unreadInbox };
}

// ── read one thread (by the counterpart's character id) — marks their lines to me as seen ──
export async function readThread(pool, accountId, counterpartCharacterId) {
  const target = (await pool.query('SELECT id, name, account_id, alive FROM characters WHERE id=$1',
    [counterpartCharacterId])).rows[0];
  if (!target) throw new GameError('gone', 'Nobody answers that number.');
  if (target.account_id === accountId) throw new GameError('self', 'That is your own line.');
  const rows = (await pool.query(
    `SELECT * FROM dm_messages
      WHERE (from_account=$1 AND to_account=$2) OR (from_account=$2 AND to_account=$1)
      ORDER BY at DESC LIMIT 100`, [accountId, target.account_id])).rows;
  await pool.query('UPDATE dm_messages SET seen=true WHERE to_account=$1 AND from_account=$2 AND NOT seen',
    [accountId, target.account_id]);
  const live = await livingChar(pool, target.account_id);
  return { with: { name: live?.name || target.name,
      characterId: live?.id || null, replyable: !!live },
    messages: rows.reverse().map((m) => ({ fromMe: m.from_account === accountId,
      who: m.from_name, text: m.body, at: m.at })) };
}

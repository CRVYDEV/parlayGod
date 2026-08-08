// THE AHA MOMENT — "First Blood". A deep multiplayer mob game's hook is DANGER: the first time the
// city comes for YOU. A new player's early minutes are competent but not dangerous — the PvP/revenge
// loop (the emotional spine of the genre) is gated behind level and depth, so a fresh street can grind
// for a session and never once feel hunted. This engineers a GUARANTEED first conflict: soon after a
// player finds their feet, a nearby resident "makes a move" on them — recorded on the rivals ledger so
// it lights up the nemesis card, delivered as a cinematic — and the coach points them at hitting back.
// Settling it (a JUMP — the accessible level-1 verb) teaches the whole rivalry loop through a winnable,
// on-theme, once-ever beat, and pays a small bounded bonus.
//
// Leaf module: imports ONLY rules.js (+ crypto) so it can be called from BOTH game.js (the post-commit
// assignment hook) and social/combat.js (the settle hook) with no import cycle. §10.4: the assignment
// moves no value (a notification + a rival_events row); the settle pays ONE bounded once-ever cash
// faucet `firstblood:reward` (gated by aha_stage, so it can never pay twice on a street).
import crypto from 'node:crypto';
import { AHA, levelOf } from './rules.js';

const uid = () => crypto.randomUUID();
// rival_events.{victim,aggressor}_account are UUID columns while characters.account_id is TEXT (the
// mixed-id schema behind the loadOwned outage). A real account IS a uuid string, so this passes in
// production; it only skips the non-uuid account ids some suites seed (else the INSERT below CastErrors
// and spams the non-fatal log — a test-data artifact, never a production path).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── ASSIGN (post-commit hook, called from game.js with the acting account) ──────────────────────────
// Cheap unlocked pre-check first (the referral-hook discipline), so the common no-op costs one indexed
// read. Opens a txn only when it will actually assign. Returns { characterId, payload } for the caller
// to emit live on the bus (a leaf module can't import the bus), or null.
export async function startFirstBlood(pool, accountId) {
  const pre = (await pool.query(
    'SELECT id, respect, aha_stage, is_npc FROM characters WHERE account_id=$1 AND alive', [accountId])).rows[0];
  if (!pre || pre.is_npc || Number(pre.aha_stage) !== 0) return null;
  if (levelOf(Number(pre.respect)) < AHA.MIN_LVL) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const me = (await client.query(
      'SELECT id, account_id, respect, aha_stage, loc, is_npc FROM characters WHERE id=$1 AND alive FOR UPDATE', [pre.id])).rows[0];
    if (!me || me.is_npc || Number(me.aha_stage) !== 0) { await client.query('ROLLBACK'); return null; }
    // pick a WINNABLE rival: a live resident (a real NPC character), weak, and NEARBY if possible so the
    // player can find them on the Wet Work roster in their own district. A fresh city with no residents
    // yet simply doesn't assign (the beat waits until there is a body to point at — no error).
    const rival = (await client.query(
      `SELECT id, account_id, name FROM characters
        WHERE is_npc AND alive AND id <> $1 AND respect <= $2
        ORDER BY (loc = $3) DESC, respect ASC LIMIT 1`,
      [me.id, Number(me.respect) + 500, me.loc])).rows[0];
    if (!rival) { await client.query('ROLLBACK'); return null; }
    // the rivals ledger is uuid-typed on the account columns — skip cleanly if either side is a
    // non-uuid seed (never a production account); nothing partial has committed yet.
    if (!UUID_RE.test(me.account_id) || !UUID_RE.test(rival.account_id)) { await client.query('ROLLBACK'); return null; }
    // the rival "makes a move" — a rival_events row (aggressor = the resident) so it surfaces on the
    // nemesis card + the rivals ledger exactly like a real player's move; the info-economy rule holds
    // because the streets already show everyone who is in the district.
    await client.query(
      'INSERT INTO rival_events (id, victim_account, aggressor_account, kind, detail) VALUES ($1,$2,$3,$4,$5)',
      [uid(), me.account_id, rival.account_id, 'callout', JSON.stringify({ firstBlood: true })]);
    await client.query(
      'INSERT INTO notifications (id, character_id, type, payload) VALUES ($1,$2,$3,$4)',
      [uid(), me.id, 'first_blood', JSON.stringify({ rival: rival.name })]);
    await client.query('UPDATE characters SET aha_stage=1, aha_rival=$2, aha_rival_name=$3 WHERE id=$1',
      [me.id, rival.id, rival.name]);
    await client.query('COMMIT');
    return { characterId: me.id, payload: { rival: rival.name } };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// ── SETTLE (called from the JUMP success path in social/combat.js) ──────────────────────────────────
// If this win is against the player's assigned first-blood rival and the beat is live (stage 1), pay
// the bounded once-ever bonus and close it. Direct-SQL stage write (off persistCharacter's positional
// UPDATE — the active_at pattern → clobber-safe). `deps` carries combat.js's own imports (ledger /
// notify / gainRespect) so this stays a leaf module. Returns the reward for the response, or null.
export async function settleFirstBlood(client, ch, victim, h, deps) {
  if (Number(ch.aha_stage) !== 1 || ch.aha_rival !== victim.id) return null;
  const cash = AHA.REWARD_CASH, rep = AHA.REWARD_RESPECT;
  ch.cash = Number(ch.cash) + cash;
  deps.gainRespect(h, ch, rep);
  await deps.ledger(client, { characterId: ch.id, currency: 'cash', amount: cash, reason: 'firstblood:reward' });
  await client.query('UPDATE characters SET aha_stage=2 WHERE id=$1', [ch.id]);
  ch.aha_stage = 2;
  await deps.notify(client, ch.id, 'first_blood_settled', { rival: ch.aha_rival_name || victim.name, cash, rep });
  return { cash, rep, rival: ch.aha_rival_name || victim.name };
}

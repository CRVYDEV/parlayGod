// THE VOUCH (gap #3 — the positive-sum bond between strangers). Discovery finds people and THE CREW binds
// them, but between "just met" and "crewed up" there was nothing — no lightweight mutual act. THE MENTOR is
// the only positive first-contact and it's asymmetric (veteran → newbie). A vouch is the SYMMETRIC peer act:
// you publicly stake your name on someone ("I know this one — they're solid"), which gives THEM a reputation
// and costs YOU one of a scarce set of slots, so a vouch is a considered endorsement, not noise. If they
// vouch back, that's a MUTUAL bond — the thing the whole cohesion layer (the Cast, the Situation) reads from.
//
// PURE STATUS — a vouch moves no value and writes no ledger row (§10.4-FREE by construction, the test pins
// it). ACCOUNT-keyed both sides → the bond SURVIVES DEATH (the heir keeps who they vouched and who vouched
// them — the crew/marriage/contacts posture; `vouches` is outside the estate wipe by construction). Anti-Sybil
// the hitmen-board way: no payout attaches so a Sybil ring gains nothing tangible, both sides must be a real
// HUMAN (an NPC resident or an agent is neither voucher nor target), and the outbound CAP makes each vouch
// scarce — you only have so many, so spending one means something.
import { GameError } from './game.js';
import { VOUCH, vouchRankOf } from './rules.js';

// resolve a character id → { account_id, name, human }. A plain read (the mentor.js pattern).
async function resolveTarget(client, charId) {
  const r = (await client.query(
    `SELECT c.account_id, c.name, c.is_npc, a.agent_flag
       FROM characters c JOIN account_persistent a ON a.account_id=c.account_id
      WHERE c.id=$1 AND c.alive`, [charId])).rows[0];
  return r ? { account_id: r.account_id, name: r.name, human: !r.is_npc && !r.agent_flag } : null;
}

const outCount = async (client, acct) =>
  Number((await client.query('SELECT COUNT(*) n FROM vouches WHERE voucher_account=$1', [acct])).rows[0].n);

// GIVE a vouch — stake your name on someone. One per pair ever (revocable to free the slot), no self, both
// human, bounded by the outbound cap. Single-party (a vouch touches no second character row — the target's
// account gains reputation by a public row, not a write to their character), so no lock complexity.
export async function giveVouch(ch, targetCharId, client, h) {
  const t = await resolveTarget(client, targetCharId);
  if (!t) throw new GameError('gone', 'That street is gone.');
  if (t.account_id === ch.account_id) throw new GameError('self', "You can't vouch for yourself.");
  if (!t.human) throw new GameError('not_human', 'You can only vouch for real players.');
  const exists = (await client.query('SELECT 1 FROM vouches WHERE voucher_account=$1 AND target_account=$2', [ch.account_id, t.account_id])).rows[0];
  if (exists) throw new GameError('already', `You already vouch for ${t.name}.`);
  if (await outCount(client, ch.account_id) >= VOUCH.MAX_OUT)
    throw new GameError('maxed', `You can only vouch for ${VOUCH.MAX_OUT} people — pull one to free a slot.`);
  await client.query('INSERT INTO vouches (voucher_account, target_account, from_name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [ch.account_id, t.account_id, ch.name]);
  // did they already vouch for YOU? then it's now mutual — tell them the bond is sworn both ways.
  const mutual = (await client.query('SELECT 1 FROM vouches WHERE voucher_account=$1 AND target_account=$2', [t.account_id, ch.account_id])).rows[0];
  if (h?.notify) await h.notify(client, targetCharId, mutual ? 'vouch_mutual' : 'vouched', { by: ch.name });
  return { ok: true, vouched: t.name, mutual: !!mutual };
}

// REVOKE — pull your name back (frees a slot; a bond isn't a life sentence).
export async function revokeVouch(ch, targetCharId, client) {
  const t = await resolveTarget(client, targetCharId);
  if (!t) throw new GameError('gone', 'That street is gone.');
  const d = await client.query('DELETE FROM vouches WHERE voucher_account=$1 AND target_account=$2 RETURNING 1', [ch.account_id, t.account_id]);
  if (!d.rowCount) throw new GameError('not_vouched', `You don't vouch for ${t.name}.`);
  return { ok: true, pulled: t.name };
}

// THE BOARD — who you vouch, who vouches you, the mutuals, and your slots. Keyed by the CURRENT living
// character on each side (no account UUID leaves — the people.js rule); a side with no living street is
// skipped (a bond outlives a street, but you can only act on someone who's currently alive).
export async function vouchBoard(client, ch) {
  const out = (await client.query(
    `SELECT v.target_account, c.id, c.name FROM vouches v
       JOIN characters c ON c.account_id=v.target_account AND c.alive
      WHERE v.voucher_account=$1 ORDER BY v.at DESC`, [ch.account_id])).rows;
  const inn = (await client.query(
    `SELECT v.voucher_account, c.id, c.name FROM vouches v
       JOIN characters c ON c.account_id=v.voucher_account AND c.alive
      WHERE v.target_account=$1 ORDER BY v.at DESC`, [ch.account_id])).rows;
  const outSet = new Set(out.map((r) => r.target_account));
  const inSet = new Set(inn.map((r) => r.voucher_account));
  const mutuals = out.filter((r) => inSet.has(r.target_account)).map((r) => ({ id: r.id, name: r.name }));
  // the true inbound COUNT (the reputation) counts every voucher, living or dead — a vouch you earned
  // stands even if that street fell; only the actionable lists JOIN on alive.
  const vouchedBy = Number((await client.query('SELECT COUNT(*) n FROM vouches WHERE target_account=$1', [ch.account_id])).rows[0].n);
  return {
    vouchedBy, rank: vouchRankOf(vouchedBy).name, cap: VOUCH.MAX_OUT, slotsLeft: VOUCH.MAX_OUT - out.length,
    given: out.map((r) => ({ id: r.id, name: r.name, mutual: inSet.has(r.target_account) })),
    vouchers: inn.map((r) => ({ id: r.id, name: r.name, mutual: outSet.has(r.voucher_account) })),
    mutuals,
  };
}

// how many vouch a given character's bloodline — the chip the roster/Cast/discovery cards show. Batched by
// account so a list render is one query (pass the character ids; returns a Map keyed by characterId).
export async function vouchCounts(client, charIds) {
  if (!charIds.length) return new Map();
  // two flat queries + a JS join — pg-mem chokes on both `= ANY($1::text[])` AND a correlated subquery,
  // so map charId → account → count in JS (the /v1/gangs posture).
  const inList = charIds.map((_, i) => `$${i + 1}`).join(',');
  const chars = (await client.query(`SELECT id, account_id FROM characters WHERE id IN (${inList})`, charIds)).rows;
  const accts = [...new Set(chars.map((r) => r.account_id))];
  if (!accts.length) return new Map();
  const aList = accts.map((_, i) => `$${i + 1}`).join(',');
  const counts = (await client.query(
    `SELECT target_account, COUNT(*) n FROM vouches WHERE target_account IN (${aList}) GROUP BY target_account`, accts)).rows;
  const byAcct = new Map(counts.map((r) => [r.target_account, Number(r.n)]));
  return new Map(chars.map((r) => [r.id, byAcct.get(r.account_id) || 0]));
}

// THE LEADERBOARD — the most-vouched players (the trusted). Pure status, agents + residents excluded (the
// hitmen/portfolio board precedent); a bloodline with no living street is skipped.
export async function vouchLeaderboard(pool, limit = 20) {
  // two flat queries + a JS join (pg-mem can't parse the derived-table join — the /v1/gangs posture).
  const counts = (await pool.query('SELECT target_account, COUNT(*) n FROM vouches GROUP BY target_account')).rows;
  if (!counts.length) return [];
  const byAcct = new Map(counts.map((r) => [r.target_account, Number(r.n)]));
  const accts = [...byAcct.keys()];
  const inList = accts.map((_, i) => `$${i + 1}`).join(',');
  const rows = (await pool.query(
    `SELECT c.id, c.name, c.account_id FROM characters c
       JOIN account_persistent a ON a.account_id=c.account_id
      WHERE c.account_id IN (${inList}) AND c.alive AND NOT c.is_npc AND NOT a.agent_flag`, accts)).rows;
  return rows
    .map((r) => ({ id: r.id, name: r.name, vouches: byAcct.get(r.account_id) || 0 }))
    .sort((x, y) => y.vouches - x.vouches || x.name.localeCompare(y.name))
    .slice(0, limit)
    .map((r, i) => ({ rank: i + 1, id: r.id, name: r.name, vouches: r.vouches }));
}

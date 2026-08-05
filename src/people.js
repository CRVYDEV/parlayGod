// ── THE CAST & THE STORY — the interpersonal cohesion layer ──────────────────────────────────────
// The game already REMEMBERS every relationship a street has — rival_events (who moved on you),
// kill_log (the blood between two bloodlines), dynasty_marriages/consiglieri (the alliances),
// contacts (whose number you hold and what you've done for them), vendettas, the bodyguard pair,
// the family roster — but it remembered them into eight separate boards, so a rivalry never read
// as a RELATIONSHIP, only as rows. This module is the one place all of it is read TOGETHER:
//
//   GET /v1/people                       — THE CAST: your nemesis, your spouse, your adviser,
//                                          your family, who you guard and who guards you, the
//                                          contacts you've worked for, the open vendettas
//   GET /v1/people/history/:characterId — THE STORY OF YOU AND THEM: one merged, chronological
//                                          timeline of everything recorded between your bloodline
//                                          and theirs
//
// PURE READS — zero §10.4 surface (nothing moves, nothing is written), no locks beyond the
// caller's own readCharacter. Two rules are load-bearing:
//   * ACCOUNT UUIDs never leave (the rivals/contacts posture) — every party resolves to its
//     bloodline's CURRENT living street, or to a name snapshot when the line is dead.
//   * THE INFO-ECONOMY RULE: the story only surfaces what the game already TOLD both parties.
//     rival_events is recorded only from acts whose notify names the aggressor; kill_log names the
//     killer at the estate; a marriage/divorce/peace offer is mutual by construction; a `met`
//     contact line is a mutual meeting. The `detail` JSONB is deliberately NOT surfaced (it can
//     carry amounts), and nothing here pierces anonymity — the $OMR peek/trace stay the piercers.
import { GameError } from './game.js';
import { levelOf } from './rules.js';
import { marriageOf } from './dynasty.js';

// a bloodline's face: its current LIVING street, else the freshest name the record holds
async function faceOf(client, accountId, fallbackName = null) {
  const live = (await client.query(
    'SELECT id, name, respect, loc FROM characters WHERE account_id=$1 AND alive', [accountId])).rows[0];
  if (live) return { id: live.id, name: live.name, level: levelOf(Number(live.respect)), loc: live.loc, alive: true };
  if (fallbackName) return { id: null, name: fallbackName, level: null, loc: null, alive: false };
  const last = (await client.query(
    'SELECT name FROM characters WHERE account_id=$1 ORDER BY created_at DESC LIMIT 1', [accountId])).rows[0];
  return last ? { id: null, name: last.name, level: null, loc: null, alive: false } : null;
}

// the blood ledger between two bloodlines — the feud route's counts, shared here so the nemesis
// card and the history read the same numbers (kill_log accounts are TEXT in this schema)
async function bloodBetween(client, mine, theirs) {
  const ours = Number((await client.query(
    'SELECT COUNT(*) n FROM kill_log WHERE killer_account=$1 AND victim_account=$2', [mine, theirs])).rows[0].n);
  const theirsN = Number((await client.query(
    'SELECT COUNT(*) n FROM kill_log WHERE killer_account=$1 AND victim_account=$2', [theirs, mine])).rows[0].n);
  return { ours, theirs: theirsN, bloodOwed: theirsN - ours };
}

// ── THE CAST ─────────────────────────────────────────────────────────────────────────────────────
export async function peopleBoard(client, ch) {
  const me = ch.account_id;
  // THE NEMESIS — the bloodline with the most recorded malice against you (the rivals board's #1,
  // re-aggregated here as a top-1 because the enrichment needs the aggressor ACCOUNT internally,
  // which rivalsBoard rightly never returns), enriched with the blood ledger + the vendetta state.
  // `victim_account` is UUID and `me` is the TEXT account id — cast the PARAMETER, so
  // ix_rival_events_victim still leads (the uuid=text outage class; pgquery proves the parse).
  const top = (await client.query(
    `SELECT aggressor_account::text AS acct, COUNT(*) n, MAX(at) last_at
       FROM rival_events WHERE victim_account = $1::uuid
      GROUP BY aggressor_account ORDER BY COUNT(*) DESC, MAX(at) DESC LIMIT 1`, [me])).rows[0] || null;
  let nemesis = null;
  if (top) {
    const blood = await bloodBetween(client, me, top.acct);
    const vend = (await client.query(
      `SELECT avenger_account FROM vendettas
        WHERE ((avenger_account=$1 AND target_account=$2) OR (avenger_account=$2 AND target_account=$1))
          AND expires_at > now()`, [me, top.acct])).rows;
    nemesis = {
      street: await faceOf(client, top.acct), total: Number(top.n), lastAt: top.last_at,
      kills: { ours: blood.ours, theirs: blood.theirs }, bloodOwed: blood.bloodOwed,
      vendetta: { mine: vend.some((v) => v.avenger_account === me),
                  theirs: vend.some((v) => v.avenger_account === top.acct) },
    };
  }
  // THE SPOUSE — the accepted marriage, faced as the other house's current steward
  const m = await marriageOf(client, me);
  const spouseAcct = m ? (m.account_a === me ? m.account_b : m.account_a) : null;
  const spouse = spouseAcct ? {
    street: await faceOf(client, spouseAcct),
    dynasty: (await client.query('SELECT dynasty_name FROM account_persistent WHERE account_id=$1', [spouseAcct])).rows[0]?.dynasty_name || null,
    since: m.created_at,
  } : null;
  // THE CONSIGLIERE — the adviser this dynasty named (accepted), and how many houses I counsel
  const adv = (await client.query(
    'SELECT adviser_account FROM consiglieri WHERE dynasty_account=$1 AND accepted', [me])).rows[0];
  const consigliere = adv ? { street: await faceOf(client, adv.adviser_account) } : null;
  const advising = Number((await client.query(
    'SELECT COUNT(*) n FROM consiglieri WHERE adviser_account=$1 AND accepted', [me])).rows[0].n);
  // THE FAMILY — name/tag/role off the roster (null when running solo)
  const fam = (await client.query(
    `SELECT g.name, g.tag, gm.role FROM gang_members gm JOIN gangs g ON g.id = gm.gang_id
      WHERE gm.character_id=$1`, [ch.id])).rows[0] || null;
  // THE MUSCLE — both directions of the bodyguard pair, resolved to NAMES (the view carries only
  // a raw id one way and nothing the other — the scout's gap this board closes)
  const guardedBy = (ch.guarded_by && ch.guarded_until && new Date(ch.guarded_until) > new Date())
    ? (await client.query('SELECT id, name FROM characters WHERE id=$1', [ch.guarded_by])).rows[0] || null : null;
  const guarding = (await client.query(
    'SELECT id, name FROM characters WHERE guarded_by=$1 AND guarded_until > now() AND alive', [ch.id])).rows;
  // THE BONDS — the contacts you've actually WORKED for (jobs > 0), deepest standing first
  const bonds = (await client.query(
    `SELECT ct.jobs, c.id, c.name FROM contacts ct
       JOIN characters c ON c.account_id = ct.contact_account AND c.alive
      WHERE ct.owner_account=$1 AND ct.jobs > 0 ORDER BY ct.jobs DESC LIMIT 5`, [me])).rows
    .map((b) => ({ id: b.id, name: b.name, jobs: Number(b.jobs) }));
  // open vendettas sworn by YOUR bloodline (the view carries the detail; this is the count)
  const vendettas = Number((await client.query(
    'SELECT COUNT(*) n FROM vendettas WHERE avenger_account=$1 AND expires_at > now()', [me])).rows[0].n);
  return {
    nemesis, spouse, consigliere, advising,
    family: fam ? { name: fam.name, tag: fam.tag, role: fam.role } : null,
    guardedBy: guardedBy ? { id: guardedBy.id, name: guardedBy.name } : null,
    guarding: guarding.map((g) => ({ id: g.id, name: g.name })),
    bonds, vendettas,
  };
}

// ── THE STORY OF YOU AND THEM ────────────────────────────────────────────────────────────────────
// One merged, chronological record of everything the game has told BOTH parties about each other.
// Keyed by a CHARACTER id (living or dead — a story outlives a street) resolved to its bloodline.
export async function pairHistory(client, ch, targetCharacterId) {
  const t = (await client.query(
    'SELECT id, account_id, name FROM characters WHERE id=$1', [targetCharacterId])).rows[0];
  if (!t) throw new GameError('gone', 'No such soul in the city, living or dead.');
  const me = ch.account_id, them = t.account_id;
  if (them === me) throw new GameError('self', 'Your own story you already know.');
  const ev = [];
  // recorded malice, both directions — kind + when + which way, never the detail JSONB
  const strikes = (await client.query(
    `SELECT kind, at, aggressor_account::text AS agg FROM rival_events
      WHERE (victim_account=$1::uuid AND aggressor_account=$2::uuid)
         OR (victim_account=$2::uuid AND aggressor_account=$1::uuid)
      ORDER BY at DESC LIMIT 40`, [me, them])).rows;
  for (const s of strikes) ev.push({ at: s.at, kind: s.kind, who: s.agg === me ? 'me' : 'them' });
  // the blood — every kill either bloodline landed on the other, with the fallen street's name
  const kills = (await client.query(
    `SELECT killer_account, victim_name, at FROM kill_log
      WHERE (killer_account=$1 AND victim_account=$2) OR (killer_account=$2 AND victim_account=$1)
      ORDER BY at DESC LIMIT 40`, [me, them])).rows;
  for (const k of kills) ev.push({ at: k.at, kind: 'kill', who: k.killer_account === me ? 'me' : 'them', fell: k.victim_name });
  // the alliances — a marriage (or the tombstone of one) and standing peace offers are mutual acts
  const [a, b] = [me, them].sort();
  const mar = (await client.query(
    'SELECT accepted, created_at FROM dynasty_marriages WHERE account_a=$1 AND account_b=$2', [a, b])).rows[0];
  if (mar) ev.push({ at: mar.created_at, kind: mar.accepted ? 'married' : 'proposed', who: 'us' });
  const div = (await client.query(
    'SELECT at FROM dynasty_divorces WHERE account_a=$1 AND account_b=$2', [a, b])).rows[0];
  if (div) ev.push({ at: div.at, kind: 'divorced', who: 'us' });
  const peace = (await client.query(
    `SELECT from_account, at FROM feud_peace_offers
      WHERE (from_account=$1 AND target_account=$2) OR (from_account=$2 AND target_account=$1)`,
    [me, them])).rows;
  for (const p of peace) ev.push({ at: p.at, kind: 'peace_offer', who: p.from_account === me ? 'me' : 'them' });
  // the first meeting — the moment their number entered your book (a mutual `met` line only)
  const met = (await client.query(
    "SELECT met_at FROM contacts WHERE owner_account=$1 AND contact_account=$2 AND how='met'", [me, them])).rows[0];
  if (met) ev.push({ at: met.met_at, kind: 'met', who: 'us' });
  ev.sort((x, y) => new Date(y.at) - new Date(x.at));
  const blood = await bloodBetween(client, me, them);
  return {
    them: { id: t.id, name: t.name, face: await faceOf(client, them, t.name) },
    kills: { ours: blood.ours, theirs: blood.theirs }, bloodOwed: blood.bloodOwed,
    events: ev.slice(0, 60),
  };
}

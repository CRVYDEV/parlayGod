// THE ROLODEX (omerta-discovery-design.md) — player DISCOVERY, the front door the social layer lacked.
//
// Every social system now EXISTS — crew, family, contacts, rivals, marriage, bodyguard, the read-only
// Cast/Story/Situation cohesion layer — but they all assume you already KNOW who to talk to: a crew
// invite is by exact name, the Wet Work roster is the top 100 by respect (whales, not your peers), and
// the contact book is EARNED through interacting. So a new or mid player who wants to team up has no
// way to FIND peers. This is that surface, and it is the piece that makes THE CREW reachable by
// strangers (the whole point in a low-population game).
//
// Deliberately §10.4-FREE: nothing here moves value or writes a `transactions` row. It is READS + one
// LFG boolean toggle. The `discovery:` word appears in no ledger vocabulary; the lifecycle test proves
// it by counting rows.
//
// HUMANS ONLY on every list — a crew cannot include an NPC resident and an agent is excluded from the
// social front door (`NOT c.is_npc AND NOT a.agent_flag`); residents are already findable on the
// streets roster. If you are genuinely alone the lists are empty, which is the TRUE state and the
// empty-state honesty rule (never dress an empty board as full).
import { DISCOVERY, CREW, DISTRICTS, levelOf, PACING } from './rules.js';

const districtName = (id) => (DISTRICTS.find((d) => d.id === id) || {}).name || id;
// the respect a level costs, from the signed pacing curve (respect(L) = D·(L−1)²) — used to turn a
// LEVEL band into a respect band the SQL can filter on. The inverse of levelOf, kept local (the
// hustle.js districtName pattern: rules.js does not export it).
const respectAtLevel = (lvl) => PACING.LEVEL_DIVISOR * Math.max(0, lvl - 1) ** 2;

// map a raw characters row (joined to account_persistent + crew_members) to a public discovery card.
// NO account UUID ever leaves (the rivals/cast discipline — the client keys off the living characterId);
// `online` is derived from the account_id internally, then account_id is dropped from the output.
const card = (r, online) => ({
  id: r.id, name: r.name, level: levelOf(Number(r.respect)),
  district: r.loc || null, districtName: r.loc ? districtName(r.loc) : null,
  gangTag: r.tag || null, lfg: !!r.lfg, hasCrew: r.has_crew, online: online.has(r.account_id),
});
// the human list SELECT — shared by all three lists (only the WHERE/ORDER differ). Selects account_id
// for the `online` derivation, never surfaced.
const HUMAN_COLS = `SELECT c.id, c.name, c.account_id, c.respect, c.loc, c.lfg, g.tag, (cm.crew_id IS NOT NULL) AS has_crew
   FROM characters c JOIN account_persistent a ON a.account_id = c.account_id
   LEFT JOIN gang_members m ON m.character_id=c.id LEFT JOIN gangs g ON g.id=m.gang_id
   LEFT JOIN crew_members cm ON cm.account_id = c.account_id`;

// ── THE BOARD — three lists of humans + recruiting crews, so a player who wants to team up can find
// someone AND someone can find them. A read; single-party (readCharacter). `onlineIds` is the set of
// currently-connected accounts (the WS registry, passed in by the route — the board has no socket
// access). `filters` (step three) narrows the human lists: {district, nofam, online}. district + nofam
// filter in SQL (pre-LIMIT, correct — a fixed `($n::text IS NULL OR …)` clause so param positions never
// shift); online is a post-filter (it's derived from the socket set, not a column). Crews are unfiltered
// (a group isn't in one district and isn't online/offline). ──
export async function discoveryBoard(ch, client, onlineIds = [], filters = {}) {
  const online = new Set(onlineIds);
  const district = filters.district || null;   // null = every district
  const nofam = !!filters.nofam;               // true = unaffiliated only
  const onlineOnly = !!filters.online;
  const applyOnline = (arr) => onlineOnly ? arr.filter((r) => r.online) : arr;
  const myLevel = levelOf(Number(ch.respect));
  const myCrew = (await client.query('SELECT crew_id FROM crew_members WHERE account_id=$1', [ch.account_id])).rows[0]?.crew_id || null;
  const lo = respectAtLevel(Math.max(1, myLevel - DISCOVERY.BAND));
  const hi = respectAtLevel(myLevel + DISCOVERY.BAND + 1);   // +1 so the top of the band is inclusive
  const fresh = new Date(Date.now() - DISCOVERY.LFG_TTL_MS);
  // the district/nofam filter is built DYNAMICALLY — the clause + its params are appended only when the
  // filter is active, so there is never a null/unused param (pg-mem's type inference breaks on a bound
  // NULL, which mis-typed the neighbouring numeric params). `nofam` needs no param (a literal predicate).
  const filt = (params) => {
    let sql = nofam ? ' AND m.gang_id IS NULL' : '';
    if (district) { params.push(district); sql += ` AND c.loc = $${params.length}`; }
    return sql;
  };

  // LOOKING FOR A CREW — the recruit list: humans who flagged LFG (within the freshness window),
  // crewless, near your level. Ordered by closeness. This is the highlight the console leads with.
  const lp = [ch.id, fresh, lo, hi, Number(ch.respect), DISCOVERY.LIMIT];
  const looking = applyOnline((await client.query(
    `${HUMAN_COLS}
      WHERE c.alive AND NOT c.is_npc AND NOT a.agent_flag AND c.id <> $1
        AND c.lfg AND c.lfg_at > $2 AND cm.crew_id IS NULL
        AND c.respect BETWEEN $3 AND $4${filt(lp)}
      ORDER BY (c.respect - $5) * (c.respect - $5) LIMIT $6`, lp)).rows.map((r) => card(r, online)));
  const lookingIds = new Set(looking.map((r) => r.id));

  // PEERS — everyone near your level (whether or not they're looking), so you can reach out to anyone;
  // the looking-ones are excluded here so the two lists don't duplicate.
  const pp = [ch.id, lo, hi, Number(ch.respect), DISCOVERY.LIMIT + looking.length];
  const peers = applyOnline((await client.query(
    `${HUMAN_COLS}
      WHERE c.alive AND NOT c.is_npc AND NOT a.agent_flag AND c.id <> $1
        AND c.respect BETWEEN $2 AND $3${filt(pp)}
      ORDER BY (c.respect - $4) * (c.respect - $4) LIMIT $5`, pp)).rows
      .map((r) => card(r, online))).filter((r) => !lookingIds.has(r.id)).slice(0, DISCOVERY.LIMIT);

  // FRESH BLOOD — the newest humans, ANY level, so a veteran can welcome a newcomer and a new player
  // sees other new players even when nobody's in their band. The front door that's never empty while
  // anyone at all has joined.
  const np = [ch.id, DISCOVERY.LIMIT];
  const newcomers = applyOnline((await client.query(
    `${HUMAN_COLS}
      WHERE c.alive AND NOT c.is_npc AND NOT a.agent_flag AND c.id <> $1${filt(np)}
      ORDER BY c.created_at DESC LIMIT $2`, np)).rows.map((r) => card(r, online)));

  // CREWS RECRUITING — the push half: crews that opened their doors, near your level, with room. A flat
  // query + a JS fold (pg-mem can't run the correlated aggregate — the /v1/gangs precedent). A crew is
  // "near you" if its member level RANGE overlaps your band; your own crew is never listed.
  const crewRows = (await client.query(
    `SELECT cr.id, cr.name, cm.account_id, c.respect
       FROM crews cr JOIN crew_members cm ON cm.crew_id = cr.id
       LEFT JOIN characters c ON c.account_id = cm.account_id AND c.alive
      WHERE cr.recruiting`)).rows;
  const byCrew = new Map();
  for (const r of crewRows) {
    if (r.id === myCrew) continue;
    const lvl = r.respect != null ? levelOf(Number(r.respect)) : null;
    const e = byCrew.get(r.id) || { id: r.id, name: r.name, members: 0, min: null, max: null };
    e.members += 1;
    if (lvl != null) { e.min = e.min == null ? lvl : Math.min(e.min, lvl); e.max = e.max == null ? lvl : Math.max(e.max, lvl); }
    byCrew.set(r.id, e);
  }
  const crews = [...byCrew.values()]
    .filter((e) => e.members < CREW.MAX_MEMBERS && (e.max == null || (e.max >= myLevel - DISCOVERY.BAND && e.min <= myLevel + DISCOVERY.BAND)))
    .map((e) => ({ id: e.id, name: e.name, members: e.members, minLevel: e.min, maxLevel: e.max }))
    .sort((a, b) => b.members - a.members).slice(0, DISCOVERY.LIMIT);

  return {
    me: { level: myLevel, lfg: !!ch.lfg, inCrew: !!myCrew, band: DISCOVERY.BAND, crewMax: CREW.MAX_MEMBERS },
    filters: { district, nofam, online: onlineOnly },   // echo the applied filters so the client shows active state
    looking, peers, newcomers, crews,
  };
}

// ── LFG — advertise that you're open to a crew (or take the flag down). A boolean + a freshness stamp,
// written by direct SQL (outside persistCharacter's positional UPDATE — the active_at pattern; the
// column is not persisted positionally, so a later persisting action can't clobber it). Dies with the
// street: a fresh heir is not looking until they say so, which is correct. §10.4-free. ──
export async function setLfg(ch, on, client, h) {
  const flag = !!on;
  await client.query('UPDATE characters SET lfg=$2, lfg_at = CASE WHEN $2 THEN now() ELSE lfg_at END WHERE id=$1', [ch.id, flag]);
  return { ok: true, discovery: flag ? 'looking' : 'not_looking', lfg: flag };
}

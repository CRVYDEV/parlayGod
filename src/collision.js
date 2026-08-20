// THE COLLISION (real-human-collision-being-rare, founder-directed) — make the RARE moment a real human
// is around VISIBLE and ACTIONABLE, on Home, the second it exists.
//
// OMERTÀ is a deep multiplayer built for a population it has not met yet: the NPC residents (the
// population layer) fill every board, so a player sees SCENERY everywhere and rarely knows when an actual
// human is around. THE ROLODEX (discovery.js) answers "who is near my LEVEL" — but it is a screen you
// visit, level-based, not REACHABLE-now. This answers the sharper question the thin population makes rare:
// "who is a real human near me — in my district (reachable) or near my level (findable) — and are they on
// the wire RIGHT NOW". Surfaced prominently on Home so the collision is seen, not missed.
//
// Three lists: HERE (real humans in YOUR district — the reachable collision: jump/rob/contract/crew),
// NEARBY (real humans near your level elsewhere — travel to them / DM), and HOT DISTRICTS (where the
// humans are, so a lonely player can go TO the action — the convergence nudge). Each row carries an
// `online` flag (the live ●); lists are sorted ONLINE-FIRST so a player on the wire leads.
//
// §10.4-FREE: pure reads, no ledger vocabulary, no write. NO account UUID leaves (the rivals/cast
// discipline — the client keys off the living characterId). RESIDENTS + AGENTS excluded
// (`NOT c.is_npc AND NOT a.agent_flag`) — this surface is specifically about REAL humans, the thing the
// scenery hides. Empty when you're genuinely alone (the empty-state honesty rule; the client hides it).
//
// `online` is surfaced as a FLAG, not a hard filter: a real human in your district who isn't socketed
// this second is still a real collision target (they'll be back; you can contract/DM them), and the ●
// lights when they're live — more robust than a filter that flickers with socket state.
//
// STILL AROUND is the one hard filter, and it exists because the paragraph above is true of a player
// and false of an abandoned account. "They'll be back" is the whole argument for listing someone who
// is offline; somebody who made a character a month ago and never returned will not be back, cannot
// meaningfully be contracted, and crowds out the one board built to cut through noise. The residents
// filter knows about ONE kind of scenery; this is the second kind. See DISCOVERY.SEEN_DAYS for why the
// discriminator is recency rather than level or activity — the wrong choice there hides the whole
// launch-night cohort, who are by definition brand new and have done nothing yet.
import { DISTRICTS, DISCOVERY, levelOf, PACING, seenSince } from './rules.js';

const districtName = (id) => (DISTRICTS.find((d) => d.id === id) || {}).name || id;
// the respect a level costs (respect(L) = D·(L−1)²) — the inverse of levelOf, to turn a LEVEL band into a
// respect band the SQL filters on. Kept local (rules.js does not export it — the discovery.js pattern).
const respectAtLevel = (lvl) => PACING.LEVEL_DIVISOR * Math.max(0, lvl - 1) ** 2;

const HUMAN_COLS = `SELECT c.id, c.name, c.account_id, c.respect, c.loc, m.gang_id, g.tag,
        (cm.crew_id IS NOT NULL) AS has_crew,
        (c.wanted_until IS NOT NULL AND c.wanted_until > now()) AS wanted
   FROM characters c JOIN account_persistent a ON a.account_id = c.account_id
   LEFT JOIN gang_members m ON m.character_id = c.id LEFT JOIN gangs g ON g.id = m.gang_id
   LEFT JOIN crew_members cm ON cm.account_id = c.account_id`;

// ── THE BOARD — who's a REAL human near you, and who's on the wire. Single-party (readCharacter).
// `onlineIds` is the set of currently-connected accounts (the WS registry, passed in by the route). ──
export async function collisionBoard(client, ch, onlineIds = []) {
  const online = new Set(onlineIds);
  const you = { district: ch.loc || null, districtName: ch.loc ? districtName(ch.loc) : null };
  const myGang = (await client.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [ch.id])).rows[0]?.gang_id || null;
  const myLevel = levelOf(Number(ch.respect));

  const card = (r) => ({
    id: r.id, name: r.name, level: levelOf(Number(r.respect)),
    district: r.loc || null, districtName: r.loc ? districtName(r.loc) : null,
    gangTag: r.tag || null, hasCrew: !!r.has_crew, wanted: !!r.wanted,
    sameFamily: !!(myGang && r.gang_id && r.gang_id === myGang),
    online: online.has(r.account_id),
  });
  // ONLINE-FIRST: a real human on the wire leads the list (the live collision), then closest by level.
  const onlineFirst = (a, b) => (b.online - a.online) || (Math.abs(a.level - myLevel) - Math.abs(b.level - myLevel));

  const since = seenSince();

  // HERE — real humans in YOUR district (any level): the reachable collision.
  let here = [];
  if (ch.loc) {
    here = (await client.query(
      `${HUMAN_COLS} WHERE c.alive AND NOT c.is_npc AND NOT a.agent_flag AND c.id <> $1 AND c.loc = $2
        AND c.last_accrued_at > $3
        ORDER BY c.respect DESC LIMIT 12`, [ch.id, ch.loc, since])).rows.map(card).sort(onlineFirst);
  }
  // NEARBY — real humans near your level, in OTHER districts: findable (travel / DM).
  const lo = respectAtLevel(Math.max(1, myLevel - DISCOVERY.BAND));
  const hi = respectAtLevel(myLevel + DISCOVERY.BAND + 1);
  const nearParams = ch.loc
    ? [ch.id, lo, hi, Number(ch.respect), since, ch.loc]
    : [ch.id, lo, hi, Number(ch.respect), since];
  const nearby = (await client.query(
    `${HUMAN_COLS} WHERE c.alive AND NOT c.is_npc AND NOT a.agent_flag AND c.id <> $1
        AND c.respect BETWEEN $2 AND $3 AND c.last_accrued_at > $5${ch.loc ? ' AND (c.loc IS NULL OR c.loc <> $6)' : ''}
      ORDER BY (c.respect - $4) * (c.respect - $4) LIMIT 8`, nearParams)).rows.map(card).sort(onlineFirst);

  // HOT DISTRICTS — real humans per OTHER district (the convergence nudge: go where the action is).
  // Same gate: a district is only "hot" if the people in it are actually around. Counting the dormant
  // sends a lonely player TO the emptiest room in the city, which is the exact opposite of the nudge.
  const hotRows = (await client.query(
    `SELECT c.loc, COUNT(*)::int n FROM characters c JOIN account_persistent a ON a.account_id = c.account_id
      WHERE c.alive AND NOT c.is_npc AND NOT a.agent_flag AND c.loc IS NOT NULL
        AND c.last_accrued_at > $1${ch.loc ? ' AND c.loc <> $2' : ''}
      GROUP BY c.loc ORDER BY n DESC LIMIT 6`, ch.loc ? [since, ch.loc] : [since])).rows;
  const hotDistricts = hotRows.map((r) => ({ district: r.loc, districtName: districtName(r.loc), count: Number(r.n) }));

  const onlineNow = here.filter((p) => p.online).length + nearby.filter((p) => p.online).length;
  return { onlineNow, here, nearby, hotDistricts, you };
}

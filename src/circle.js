// THE CIRCLE — the ambient stream of the people you KNOW (the connective tissue the social layer lacked).
//
// The cohesion layer (Cast/Story/Situation) and the ROLODEX made relationships DISCOVERABLE and READ-able,
// but they were almost all PULL — you go look. THE CIRCLE is the ambient half: a scoped, live view of the
// people in your circle — your crew, your mentor, your protégés, your spouse — showing who's ONLINE right
// now, who's in TROUBLE (lockup / hospital / wanted), and the recent BLOOD in your circle (kills involving
// anyone in it, both directions). So three crewmates and a mentor feel like they're living in the city.
//
// Two halves, both PURE READS — zero §10.4, zero write hooks:
//   • RIGHT NOW — a snapshot of each circle member's current living street (name/level/district + online +
//     trouble flags), keyed by the living characterId (NO account UUID ever leaves — the people.js rule).
//   • LATELY — the recent kills involving any circle account, derived from kill_log (timestamped, and the
//     one persistent public-safe activity source), enriched with the actor's CURRENT living name. The
//     info-economy rule holds by construction: a kill is already public to both parties + the streets feed.
import { levelOf } from './rules.js';

const lvl = (respect) => levelOf(Number(respect));
const future = (ts) => !!(ts && new Date(ts) > new Date());

// ── resolve the set of ACCOUNT ids in your circle → { account: relation }. Crew mates, your mentor, your
// protégés, your spouse. A handful of cheap keyed reads; the sets can overlap (a crewmate who's also your
// protégé), first-relation-wins by insertion order (crew → mentor → protégé → spouse). ──
export async function circleAccounts(client, meAccount) {
  const rel = new Map();   // account → relation label (never includes ME)
  const add = (acct, label) => { if (acct && acct !== meAccount && !rel.has(acct)) rel.set(acct, label); };
  // crew mates
  const mine = (await client.query('SELECT crew_id FROM crew_members WHERE account_id=$1', [meAccount])).rows[0];
  if (mine) for (const r of (await client.query('SELECT account_id FROM crew_members WHERE crew_id=$1', [mine.crew_id])).rows) add(r.account_id, 'crew');
  // your mentor
  const mentor = (await client.query('SELECT mentor_account FROM mentorships WHERE protege_account=$1', [meAccount])).rows[0];
  if (mentor) add(mentor.mentor_account, 'mentor');
  // your protégés
  for (const r of (await client.query('SELECT protege_account FROM mentorships WHERE mentor_account=$1', [meAccount])).rows) add(r.protege_account, 'protégé');
  // your spouse (the marriage is a sorted account pair)
  for (const r of (await client.query(
    'SELECT account_a, account_b FROM dynasty_marriages WHERE accepted AND (account_a=$1 OR account_b=$1)', [meAccount])).rows) {
    add(r.account_a === meAccount ? r.account_b : r.account_a, 'spouse');
  }
  return rel;
}

// ── THE BOARD — RIGHT NOW (a live snapshot) + LATELY (the blood feed). `online` is the account-id set of
// live WS connections, passed in from the route (the board has no socket access — the discovery precedent). ──
export async function circleBoard(client, ch, online) {
  const me = ch.account_id;
  const rel = await circleAccounts(client, me);
  const onlineSet = new Set(online || []);
  if (!rel.size) return { people: [], feed: [], empty: true };
  const accts = [...rel.keys()];
  // pg-mem returns zero rows for `= ANY($1::text[])` (the MY PROFILE lesson) — build a parameterized IN list.
  const inList = accts.map((_, i) => `$${i + 1}`).join(',');

  // RIGHT NOW — each member's CURRENT living street (a member with no living character is skipped)
  const chars = (await client.query(
    `SELECT id, account_id, name, respect, loc, jail_until, hosp_until, wanted_until
       FROM characters WHERE account_id IN (${inList}) AND alive`, accts)).rows;
  const people = chars.map((c) => ({
    charId: c.id,                            // client-keyed by the LIVING character — never the account UUID
    name: c.name, level: lvl(c.respect), district: c.loc, relation: rel.get(c.account_id),
    online: onlineSet.has(c.account_id),
    jailed: future(c.jail_until),
    hospital: future(c.hosp_until),
    wanted: future(c.wanted_until),
  })).sort((a, b) => (b.online - a.online) || (b.level - a.level));   // online first, then the biggest

  // LATELY — recent kills involving anyone in the circle (either side), newest first. kill_log is the one
  // timestamped public-safe activity source; the killer's CURRENT living name is resolved at read.
  const inA = accts.map((_, i) => `$${i + 1}`).join(',');
  const inB = accts.map((_, i) => `$${accts.length + i + 1}`).join(',');
  const kills = (await client.query(
    `SELECT k.killer_account, k.victim_account, k.victim_name, k.at,
            kc.name AS killer_name
       FROM kill_log k
       LEFT JOIN characters kc ON kc.account_id=k.killer_account AND kc.alive
      WHERE (k.killer_account IN (${inA}) OR k.victim_account IN (${inB}))
      ORDER BY k.at DESC LIMIT 20`, [...accts, ...accts])).rows;
  const feed = kills.map((k) => {
    const killerIn = rel.get(k.killer_account), victimIn = rel.get(k.victim_account);
    return {
      at: k.at,
      // frame it around whoever is in YOUR circle (the killer takes precedence — it's the more notable act)
      who: killerIn ? (k.killer_name || 'someone in your circle') : k.victim_name,
      relation: killerIn || victimIn,
      kind: killerIn ? 'whacked' : 'fell',
      // the other party (a name only — the victim snapshot, or the killer's living name)
      other: killerIn ? k.victim_name : (k.killer_name || 'someone'),
    };
  });
  return { people, feed };
}

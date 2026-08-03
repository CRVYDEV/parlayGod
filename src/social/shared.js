// Shared predicates and the house take — the leaf of the social package.
//
// Everything else in src/social/ imports from here and nothing here imports back, so this is
// the bottom of the layering. These are the one-line predicates the PvP gates are written in
// (jailed / hospitalized / safeHoused / isWanted), the rank check every family command runs, and
// takeHouse, which is the only place the street-tax pool is credited from this package.
//
// Split out of the 2,003-line src/social.js; every function below is byte-identical to what was
// there. Import from '../social.js' — it re-exports this package's public surface unchanged.
import crypto from 'node:crypto';
import { LOAN } from '../rules.js';

export const uid = () => crypto.randomUUID();

export const now = () => new Date();

// jailed / safeHoused / hospitalized MOVED to rules.tail.js — the universal leaf, beside their five
// siblings (penSafe, inHole, witproActive, crewCold, isMade). They were defined here, which reads
// wrong from outside the social package, so sixteen modules hand-rolled the date comparison instead
// of importing across; the gate matrix named every copy. Re-exported so this package's ~100 call
// sites are untouched — `import { jailed } from './shared.js'` still resolves.
export { jailed, safeHoused, hospitalized } from '../rules.js';

export const isWanted = (ch) => ch && ch.wanted_until && new Date(ch.wanted_until) > new Date(); // LOAN step 4: a WANTED defaulter forfeits omertà (the rat precedent)

export const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;


export async function takeHouse(client, tax) {
  if (tax > 0) await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [tax]);
}

// ═══════════════════ GANGS (§5.5) ═══════════════════

export const canCommand = (h) => h.owned.gangRole === 'boss' || h.owned.gangRole === 'underboss';


// ═══════════════════ WARS (§5.5) ═══════════════════
export const warActive = (g) => g && g.war_with && new Date(g.war_until) > new Date();

// Lazy war resolution: first touch after war_until settles it — winner takes 20%
// of the loser's treasury and a standing bump (wars_won). Locks both gang rows in
// stable id order (same discipline as character locks, §10.1).

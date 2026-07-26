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

export const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();

export const safeHoused = (ch) => ch.safe_until && new Date(ch.safe_until) > new Date();

export const isWanted = (ch) => ch && ch.wanted_until && new Date(ch.wanted_until) > new Date(); // LOAN step 4: a WANTED defaulter forfeits omertà (the rat precedent)

export const hospitalized = (ch) => ch.hosp_until && new Date(ch.hosp_until) > new Date();

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

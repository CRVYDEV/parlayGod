// THE COLUMN-MIGRATION test (the 34th suite) — the in-place-upgrade fix (red-team R30 MED-1).
// schema.sql is 100% `CREATE TABLE IF NOT EXISTS`, so on an ALREADY-created Postgres DB a column added to a
// table's CREATE block after the table first existed is silently absent — an in-place upgrade then 500s on
// every path naming a new column. `columnMigrations(schema)` derives an idempotent `ALTER TABLE … ADD COLUMN
// IF NOT EXISTS` set FROM the schema text (drift-proof + auto-covers future columns); `migrateColumns` runs
// it. This proves: the derived set is well-formed (no constraint/multi-column leakage), it's a clean no-op on
// a fresh DB, and — the actual fix — it RE-ADDS a column an "old" DB is missing. pg-mem, zero infra.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newDb } from 'pg-mem';
import { columnMigrations, migrateColumns } from '../src/db.js';
import { srcText } from './lib/srcfiles.js';

const SCHEMA = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema.sql'), 'utf8');

// ── 1. the derived statement set is well-formed ──
const stmts = columnMigrations(SCHEMA);
assert(stmts.length > 500, `expected a large ADD COLUMN set from the whole schema, got ${stmts.length}`);
assert(stmts.every((s) => s.startsWith('ALTER TABLE ') && s.includes(' ADD COLUMN IF NOT EXISTS ')), 'every statement is an idempotent ADD COLUMN');
// no table-level constraint line leaked in as a "column"
assert.equal(stmts.filter((s) => /ADD COLUMN IF NOT EXISTS (PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT|INSERT|CREATE|SELECT)\b/i.test(s)).length, 0,
  'no PRIMARY KEY/UNIQUE/FOREIGN/CHECK/CONSTRAINT (or stray statement) is mistaken for a column');
// no statement carries a stray TOP-LEVEL comma (i.e. multiple columns crammed into one ALTER)
const hasTopComma = (s) => { const d = s.replace(/^ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS \w+ /, ''); let dp = 0; for (const c of d) { if (c === '(') dp++; else if (c === ')') dp--; else if (c === ',' && dp === 0) return true; } return false; };
assert.equal(stmts.filter(hasTopComma).length, 0, 'each statement adds exactly ONE column (multi-column lines split on depth-0 commas)');
// known later-added columns are covered (these are exactly the ones an in-place upgrade would miss)
for (const need of [
  'ALTER TABLE track_bets ADD COLUMN IF NOT EXISTS odds NUMERIC',
  'ALTER TABLE track_bets ADD COLUMN IF NOT EXISTS bet_racer_id TEXT',
  'ALTER TABLE characters ADD COLUMN IF NOT EXISTS wire_tier INT NOT NULL DEFAULT 0',
  'ALTER TABLE characters ADD COLUMN IF NOT EXISTS contraband NUMERIC NOT NULL DEFAULT 0',
  'ALTER TABLE characters ADD COLUMN IF NOT EXISTS heat_exposure NUMERIC NOT NULL DEFAULT 0',
  'ALTER TABLE commission_votes ADD COLUMN IF NOT EXISTS standing',
  'ALTER TABLE gang_members ADD COLUMN IF NOT EXISTS joined_at',
]) assert(stmts.some((s) => s.startsWith(need)), `migration must cover: ${need}`);
// column-level PRIMARY KEY is stripped from the generated def (the ADD COLUMN is always safe)
const idStmt = stmts.find((s) => s.startsWith('ALTER TABLE characters ADD COLUMN IF NOT EXISTS id '));
assert(idStmt && !/PRIMARY KEY/i.test(idStmt), 'column-level PRIMARY KEY is stripped from the ADD COLUMN def');

// ── 2. clean no-op on a FRESH DB (every column already exists) ──
const mem = newDb();
const { Pool } = mem.adapters.createPg();
const pool = new Pool();
await pool.query(SCHEMA);
const fresh = await migrateColumns(pool, SCHEMA);
assert.equal(fresh.total, stmts.length, 'runs every derived statement');
assert.equal(fresh.failed, 0, `a fresh DB is a clean no-op — 0 statements should fail (got ${fresh.failed})`);

// ── 3. the actual fix: an "old" DB missing a later-added column gets it back ──
const has = async (t, c) => { try { await pool.query(`SELECT ${c} FROM ${t} LIMIT 0`); return true; } catch { return false; } };
await pool.query('ALTER TABLE track_bets DROP COLUMN odds');       // simulate an in-place upgrade gap
await pool.query('ALTER TABLE characters DROP COLUMN wire_tier');
assert.equal(await has('track_bets', 'odds'), false, 'the "old" DB is missing odds');
assert.equal(await has('characters', 'wire_tier'), false, 'the "old" DB is missing wire_tier');
const fixed = await migrateColumns(pool, SCHEMA);
assert.equal(fixed.failed, 0, 're-migration adds the missing columns without error');
assert.equal(await has('track_bets', 'odds'), true, 'odds is restored by the migration');
assert.equal(await has('characters', 'wire_tier'), true, 'wire_tier is restored by the migration');
// idempotent: running again is still a clean no-op
assert.equal((await migrateColumns(pool, SCHEMA)).failed, 0, 're-running the migration is idempotent');

// ── 4. MED-2 completeness guard: every `character_id` table has a KNOWN death disposition ──
// The schema has zero FKs — referential integrity on death is 100% the runEstate wipe loop (+ custom
// wipers + the escrow-resolve `*:death` burns). That's complete today, but a FUTURE character_id table a
// developer forgets to wipe orphans SILENTLY — invisible to Postgres AND pg-mem (this is exactly how the
// historical port_intercepts / npc_hits / convoy_ambushes orphans slipped in). An FK ON DELETE CASCADE is
// the WRONG tool here: on death the character row is KEPT (`alive=false`), never DELETE'd, so a cascade
// never fires — and FKs risk breaking the pg-mem test path. Instead, fail CI CLOSED when a new
// character_id table isn't classified. Categories: wiped (runEstate loop / a death-path DELETE), special
// (a custom *AtDeath wiper in another module), escrow (self-contained snapshot settled at the worker
// resolve with a `*:death` burn — deliberately NOT wiped so the frozen field resolves), ledger/log
// (immutable §10.4/audit/historical rows — intentionally never wiped; a dead id is a valid historical ref).
const DISPOSITION = {
  batches: 'wiped', blackjack_hands: 'wiped', boats: 'wiped', businesses: 'wiped', cars: 'wiped',
  character_assets: 'wiped', character_cargo: 'wiped', character_guns: 'wiped', character_items: 'wiped',
  character_rackets: 'wiped', character_skills: 'wiped', convoy_ambushes: 'wiped', crew_heist_members: 'wiped',
  daily_progress: 'wiped', fight_bets: 'wiped', makings: 'wiped', missions_done: 'wiped', npc_errands: 'wiped',
  npc_favors: 'wiped', npc_gain: 'wiped', npc_grudges: 'wiped', npc_leads: 'wiped', npc_standing: 'wiped',
  wage_snapshots: 'wiped', // the Street Wage baseline dies with the street — the heir enrolls fresh (no inherited gain window)
  campaign_progress: 'wiped', // FIVE PILLARS #4: a fresh street walks the stories again (the roguelike spine)
  soldiers: 'wiped', // XCOM soldiers die with the street — a fresh street hires fresh muscle (memorial included)
  digs: 'wiped', // secret-dig cooldowns die with the digger (secrets themselves are holder_character-keyed, wiped in runEstate)
  family_aggro: 'wiped', // THE MANHUNT: a dead raider isn't hunted — the pending family retaliation on them is cleared in runEstate
  numbers_tickets: 'wiped', pen_break_members: 'wiped', pen_contraband: 'wiped', port_intercepts: 'wiped',
  racers: 'wiped', stash: 'wiped', track_bets: 'wiped', world_raid_members: 'wiped',
  fighters: 'special', gang_members: 'special', speakeasy_patrons: 'special',
  futurity_runners: 'escrow', grand_prix_entries: 'escrow', poker_entries: 'escrow', stakes_entries: 'escrow', track_entries: 'escrow',
  transactions: 'ledger', rng_audit: 'ledger', notifications: 'log',
  clue_scrolls: 'wiped', // the treasure trail dies with the street (the heir starts a fresh hunt)
  masteries: 'wiped', // THE TRADES die with the street (the estate echoes HEIR_KEEP_BPS of each track's XP to the heir); mastery_legend is account-keyed and survives by construction
  character_traits: 'wiped', // the level-50 trait dies with the street (the DYNAST echo is read BEFORE the wipe)
  character_disciplines: 'wiped', // THE REGIMEN: discipline XP dies with the street (the heir hits the gym fresh)
  npc_drills: 'wiped', // THE REGIMEN: daily trainer-drill claims are the street's own day — die with them
  hustles: 'wiped', // THE HUSTLE: the daily three-stop chain is the street's own day — dies with them (the heir draws fresh work)
  pen_talks: 'wiped', // PEN step six: the daily yard-character conversation is the street's own day
  corner_jobs: 'wiped', // STREET LIFE: the district quest board is the street's own day — dies with them
  corner_chains: 'wiped', // the block's standing job is a WEEK of showing up — a new man starts it cold
  contact_calls: 'wiped', // STREET LIFE: an open contact call dies with the street (no escrow — the pay only moves at fulfilment; `contacts` itself is account-keyed and survives by construction)
  primetime_rally: 'wiped', // PRIME TIME: a night's answer is the street's own — a dead answerer isn't paid (no ledger row was written; the worker's JOIN skips a wiped row)
  rigs: 'wiped', // CONVOY Tier-4: the hauler dies with the street (the cars/boats precedent)
  route_notoriety: 'wiped', // TIER C: per-lane heat is the street's own reputation — dies with them (the heir runs clean lanes)
  poker_ring_seats: 'special', // RING POKER: wipeRingAtDeath folds the seat + BURNS the stack (casino:ring:death) under the table lock — never a bare DELETE (the stack is escrowed cash)
  chat_messages: 'log', // troll-box lines keep their name snapshot — a dead man's words stand (7d worker retention)
  // ── the `%_character` half (audit F4): sixteen tables that scope themselves by a named role rather
  // than by `character_id`, and were invisible to this guard until it learned the suffix. Every one is
  // handled today — that is precisely why the blind spot mattered: nothing was ENFORCING it.
  wiretaps: 'wiped', wire_informants: 'wiped', wire_watches: 'wiped', // die with EITHER party (estate)
  secrets: 'wiped', informants: 'wiped',                             // dirt dies both ways; the flip collapses
  bounties: 'special', bounty_contributors: 'special', // escrow SUMmed under lock then burned death:bounty
  listings: 'special',        // M3 exchange: cb/ammo escrow forfeited (death:escrow) before the DELETE
  market_listings: 'special', // voidListingsAtDeath — bids refunded, a dead poster's own escrow burns
  favors: 'special',          // voidFavorsAtDeath — the loot surface, then whatever's left burns
  loans: 'special',           // voidLoansAtDeath — a dead LENDER's claim passes to the heir, not the void
  convoys: 'special',         // freight scatters (status='lost'), cargo deleted — never a bare row DELETE
  speakeasies: 'special',     // wipeSpeakeasyAtDeath — the club goes dark and the district reopens
  crew_heists: 'special', pen_breaks: 'special', world_raids: 'special', // a dead leader's plan is ABANDONED

  // SIGN-OFF 2.4: the funding family's roster snapshot, keyed to the POT rather than to the listed
  // member — so it is torn down with the pot (claim / the family cancelling its share / the expiry
  // sweep / the target's estate), not with the member. A listed member's own death leaves a row that
  // can never do anything (a corpse cannot claim), and the pot's own teardown reaps it.
  bounty_gang_roster: 'special',
};
// SCOPE: this guard covers the literal `character_id` column convention (42 tables). Tables that
// reference a character via a DIFFERENTLY-NAMED column (npc_hits payer/target, searches hunter/target,
// wiretaps/wire_informants/wire_watches watcher/target, informants, kill_log, vendettas, feud_peace_offers,
// loans lender/borrower_character, market_listings, bounties/bounty_contributors, convoys owner_character…)
// are outside the parser's scope here — they were verified complete by the R30 schema audit + are cleaned
// by NAMED death handlers (voidLoansAtDeath / voidListingsAtDeath / the runEstate special DELETEs). The
// value of this guard is the common case: a NEW `character_id` table added without a wipe fails CI closed.
// parse schema.sql for every table whose body declares a `character_id` column
const charTables = new Set();
{
  const head = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let mm;
  const clean = SCHEMA.replace(/--[^\n]*/g, '');
  while ((mm = head.exec(clean))) {
    let depth = 1, body = '', i = head.lastIndex;
    for (; i < clean.length && depth > 0; i++) { const ch = clean[i]; if (ch === '(') depth++; else if (ch === ')') { depth--; if (depth === 0) break; } body += ch; }
    head.lastIndex = i;
    // (audit F4) `character_id` is the COMMON name for a character FK, not the only one. Sixteen
    // tables scope themselves with `poster_character` / `leader_character` / `owner_character` and
    // friends, and every one of them was INVISIBLE to a guard whose stated job is to fail CI closed
    // on an unclassified character-scoped table. All sixteen happen to be handled today, which is
    // exactly the problem: a guard that cannot see the class it guards reads as a clean bill of
    // health. Any `%_character` column counts.
    if (/^\s*(character_id|[a-z0-9_]+_character)\b/m.test(body)) charTables.add(mm[1]);
  }
}
// (a) every character_id table is classified; no stale classifications
const unclassified = [...charTables].filter((t) => !DISPOSITION[t]);
assert.equal(unclassified.length, 0, `unclassified character_id table(s) — a dead street would ORPHAN them: ${unclassified.join(', ')}. Wipe in runEstate (add to DISPOSITION 'wiped'/'special') or document as 'escrow'/'ledger'.`);
const stale = Object.keys(DISPOSITION).filter((t) => !charTables.has(t));
assert.equal(stale.length, 0, `stale DISPOSITION entr(y/ies) no longer a character_id table: ${stale.join(', ')}`);
// (b) every 'wiped'/'special' table actually has a DELETE FROM somewhere in src/ (classification ⇒ code)
const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const allSrc = srcText();  // RECURSIVE — a flat listing missed src/social/ and hid the whole estate wipe
for (const [t, kind] of Object.entries(DISPOSITION)) {
  // a table is "cleaned on death" if it's DELETE'd by name (custom wipers: DELETE FROM fighters) OR it
  // appears as a quoted name in the runEstate wipe-loop array (`for (const t of ['businesses', …])` →
  // `DELETE FROM ${t}`). Either proves the death path references it; a NEW wiped table someone forgets to
  // wire in matches neither → this fails.
  // Death cleanup takes THREE shapes in this tree, and only the first was recognised: a DELETE, a
  // resolving status UPDATE (a convoy is 'lost', a plan 'abandoned', a favor 'cancelled' — the row
  // stays as the record of what happened), or the table's name listed in the estate's own wipe loop.
  // `favors` is handled by an UPDATE and tripped this; the four tables already relying on a status
  // UPDATE passed only because their names happened to appear quoted somewhere else in src/.
  if (kind === 'wiped' || kind === 'special') assert(
    new RegExp(`DELETE FROM ${t}\\b|UPDATE ${t} SET status=|['"]${t}['"]`).test(allSrc),
    `${t} is classified '${kind}' but no death-cleanup DELETE / resolving status UPDATE for it exists in src/ — the estate wipe is missing`);
}

// ── (c) DISTRICT → GANG lock order (full-sweep red-team, lens B) ──────────────────────────────
// Three paths hold BOTH a `districts` and a `gangs` row lock: seizeDistrict (social/gangs.js),
// establishRacket (territory.js) and buildSov (sov.js). Two took districts first; buildSov took
// gangs first, on the reasoning that "no sov path ever locks district THEN gang" — which analysed
// the wrong pair. A cycle needs ANY path in the tree to take the other order, and both siblings do,
// so a boss seizing a district while an underboss built on it was a live AB-BA (masked by the
// 40P01 → `contention` retry). Reasoning about this by hand is what produced the bug; this derives
// it. Anything holding both must take DISTRICTS first.
//
// Anchored on COLUMN-0 function declarations: an earlier hand-rolled version of this analysis bound
// locks to inner arrow-function names and reported fake cycles.
{
  const files = [['src/sov.js'], ['src/territory.js'], ['src/social/gangs.js'], ['src/economy.js'],
    ['src/world.js'], ['src/commission.js'], ['src/diplomacy.js']].map(([p]) => p);
  const offenders = [], both = [], unreadable = [];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(srcDir, '..', rel), 'utf8');
    const lines = text.split('\n');
    let fn = null, body = [];
    const flush = () => {
      if (!fn) return;
      const src = body.join('\n');
      // a lock = `FROM <table> … FOR UPDATE` in one statement; record first occurrence of each table
      const at = (t) => {
        const m = src.match(new RegExp(`FROM ${t}\\b[\\s\\S]{0,200}?FOR UPDATE`));
        return m ? m.index : -1;
      };
      const dIdx = at('districts'), gIdx = at('gangs');
      if (dIdx >= 0 && gIdx >= 0) {
        both.push(`${rel}:${fn}`);
        if (gIdx < dIdx) offenders.push(`${rel}:${fn} locks gangs before districts`);
      }
      fn = null; body = [];
    };
    for (const line of lines) {
      const m = line.match(/^(?:export )?(?:async )?function (\w+)\s*\(/);
      if (m) { flush(); fn = m[1]; }
      else if (/^(?:export )?(?:const|let|class) /.test(line)) flush();
      if (fn) body.push(line);
    }
    flush();
    // "counted, never silently skipped": a file we scan that declares no top-level function at all
    // would silently contribute nothing — assert we actually parsed something out of each.
    if (!/^(?:export )?(?:async )?function \w+\s*\(/m.test(text)) unreadable.push(rel);
  }
  assert.equal(unreadable.length, 0, `lock-order scan parsed no top-level function from: ${unreadable.join(', ')} — the scanner, not the code, is broken`);
  assert(both.length >= 3, `expected ≥3 functions holding both a districts and a gangs lock, found ${both.length} (${both.join(', ')}) — the scanner stopped seeing the pair, so this guard has gone vacuous`);
  assert.equal(offenders.length, 0, `districts→gangs lock-order inversion (AB-BA deadlock vs seizeDistrict/establishRacket): ${offenders.join('; ')}`);
}

console.log(`✅ Schema-integrity test passed — MED-1: ${stmts.length} idempotent ADD COLUMN IF NOT EXISTS statements derived from schema.sql (no leakage, clean no-op on a fresh DB, a dropped later-added column is RE-ADDED). MED-2: all ${charTables.size} character-scoped tables (character_id OR a named %_character role) have a documented death disposition (${Object.values(DISPOSITION).filter((v) => v === 'wiped').length} wiped / ${Object.values(DISPOSITION).filter((v) => v === 'special').length} special / ${Object.values(DISPOSITION).filter((v) => v === 'escrow').length} escrow / ${Object.values(DISPOSITION).filter((v) => v === 'ledger' || v === 'log').length} ledger — a new unclassified table fails CI closed, and every wiped/special table has a DELETE or a resolving status UPDATE in src).`);
process.exit(0);

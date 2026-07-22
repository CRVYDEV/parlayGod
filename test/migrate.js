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

console.log(`✅ Column-migration test passed — ${stmts.length} idempotent ADD COLUMN IF NOT EXISTS statements derived from schema.sql (no constraint/multi-column leakage), a clean no-op on a fresh DB, and a missing later-added column (odds/wire_tier) is RE-ADDED on an "old" DB — the R30 MED-1 in-place-upgrade fix.`);
process.exit(0);

// DB layer: real Postgres when DATABASE_URL is set, in-memory pg-mem otherwise.
// pg-mem mode means `npm start` works with ZERO infrastructure — for Jorge and for CI.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(here, '..', 'schema.sql'), 'utf8');

export async function makeDb() {
  if (process.env.DATABASE_URL) {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(SCHEMA);
    return pool;
  }
  // (red-team R9 config F2) A production deploy that forgot DATABASE_URL would SILENTLY boot the whole
  // game on an in-memory pg-mem DB — every account/dollar/$OMR/voucher lives only in RAM, lost on restart,
  // with subtly different SQL semantics. Refuse rather than fail open (the JWT/MARKET_SEED posture).
  if (process.env.NODE_ENV === 'production')
    throw new Error('DATABASE_URL must be set in production — refusing to boot on the in-memory pg-mem database (all state would be lost on restart).');
  const { newDb } = await import('pg-mem');
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();
  await pool.query(SCHEMA);
  console.log('[db] pg-mem in-memory database (set DATABASE_URL for Postgres)');
  return pool;
}

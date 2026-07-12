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
  const { newDb } = await import('pg-mem');
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();
  await pool.query(SCHEMA);
  console.log('[db] pg-mem in-memory database (set DATABASE_URL for Postgres)');
  return pool;
}

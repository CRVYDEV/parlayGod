// ═══ THE COLLECTION (founder pick #8 — omerta-secrets-collection-design.md, Drop B) ═══
// The account-level "ever owned / ever done" completion ledger (the Pokédex compulsion pointed at
// content that already exists). Pure STATUS — the log moves no value, grants no power, survives
// death/selling/seizure by construction (account-keyed, outside the estate wipe). `logCollect` is
// the one write primitive: an idempotent INSERT called from each acquisition touchpoint; this
// module imports NOTHING from game.js (acyclic — the callers import us).
import { collectionCatalog } from './rules.js';

// best-effort by design: a collection entry must never fail the underlying action
export async function logCollect(client, accountId, category, itemId) {
  if (!accountId || !itemId) return;
  try {
    await client.query(
      `INSERT INTO collection_log (account_id, category, item_id) VALUES ($1,$2,$3)
         ON CONFLICT (account_id, category, item_id) DO NOTHING`, [accountId, String(category), String(itemId)]);
  } catch { /* the ledger of flexes never blocks the flex */ }
}

// car transfers happen at six sites that hold a character id + a car id but not always the model
// or account — resolve both here (two cheap reads; pg-mem-safe, no INSERT..SELECT)
export async function logCarCollect(client, characterId, carId) {
  try {
    const a = (await client.query('SELECT account_id FROM characters WHERE id=$1', [characterId])).rows[0];
    const c = (await client.query('SELECT model_id FROM cars WHERE id=$1', [carId])).rows[0];
    if (a && c) await logCollect(client, a.account_id, 'cars', c.model_id);
  } catch { /* never blocks the transfer */ }
}

export async function collectionBoard(client, accountId) {
  const cat = collectionCatalog();
  const got = new Set((await client.query(
    'SELECT category, item_id FROM collection_log WHERE account_id=$1', [accountId])).rows
    .map((r) => `${r.category}:${r.item_id}`));
  let have = 0, total = 0;
  const categories = Object.entries(cat).map(([id, c]) => {
    const items = c.items.map((it) => ({ ...it, got: got.has(`${id}:${it.id}`) }));
    const h = items.filter((it) => it.got).length;
    have += h; total += items.length;
    return { id, name: c.name, have: h, total: items.length, items };
  });
  return { categories, have, total, pct: total ? Math.round((have / total) * 1000) / 10 : 0 };
}

// the completionist board — dynasties ranked by lifetime completion (agents excluded, the boards
// precedent). Flat queries + a JS tally (the /v1/gangs pg-mem precedent).
export async function collectionLeaderboard(pool) {
  const total = Object.values(collectionCatalog()).reduce((a, c) => a + c.items.length, 0);
  const agents = new Set((await pool.query(
    'SELECT account_id FROM account_persistent WHERE agent_flag')).rows.map((a) => a.account_id));
  const names = Object.fromEntries((await pool.query(
    'SELECT account_id, dynasty_name FROM account_persistent')).rows.map((a) => [a.account_id, a.dynasty_name]));
  const tally = {};
  for (const r of (await pool.query('SELECT account_id FROM collection_log')).rows) {
    if (agents.has(r.account_id)) continue;
    tally[r.account_id] = (tally[r.account_id] || 0) + 1;
  }
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 20);
  const out = [];
  for (const [accountId, have] of top) {
    const living = (await pool.query(
      'SELECT name FROM characters WHERE account_id=$1 AND alive', [accountId])).rows[0];
    out.push({
      name: names[accountId] || living?.name || 'a quiet collector',
      steward: living?.name || null,
      have, total, pct: Math.round((have / total) * 1000) / 10,
    });
  }
  return { collectors: out, total };
}

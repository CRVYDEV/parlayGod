// ═══ FIVE PILLARS #5 — THE BLOODLINE (Fable legacy × EU4 succession) ═══
// The dynasty made visible: runEstate writes a death record for every generation (recordDeath —
// account-level, it IS the record of the dead, outside the estate wipe by construction), and the
// ancestral hall derives Roman numerals, EPITHETS ("Vito II, the Butcher — whacked by Sal, lvl 24"),
// and the DYNASTY SCORE from it at read (never stored — pure status, zero §10.4 surface).
import { BLOODLINE, bloodlineEpithet, honorTierOf } from './rules.js';

// called from runEstate BEFORE the wipe, under the victim's row lock (idempotent per generation)
export async function recordDeath(client, victim, { cause, level, kills, honor }) {
  await client.query(
    `INSERT INTO bloodline (account_id, generation, name, cause, level, kills, honor)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (account_id, generation) DO NOTHING`,
    [victim.account_id, Number(victim.generation), victim.name, cause || null,
     Number(level) || 1, Number(kills) || 0, Number(honor) || 0]);
}

const scoreOf = (gens) => gens.reduce((a, g) =>
  a + Number(g.level) * BLOODLINE.SCORE.LEVEL + Number(g.kills) * BLOODLINE.SCORE.KILL
    + Math.abs(Number(g.honor)) * BLOODLINE.SCORE.HONOR_ABS, 0);

const numeral = (n) => BLOODLINE.NUMERALS[n - 1] || String(n);

export async function bloodlineBoard(ch, client, h) {
  const gens = (await client.query(
    'SELECT * FROM bloodline WHERE account_id=$1 ORDER BY generation', [ch.account_id])).rows;
  const acct = h.acct || {};
  return {
    dynasty: acct.dynasty_name || null,
    steward: { name: ch.name, generation: Number(ch.generation), title: `${ch.name}, ${numeral(Number(ch.generation))} of the line`,
      honorTier: honorTierOf(ch.honor || 0).name },
    ancestors: gens.map((g) => ({
      generation: Number(g.generation),
      title: `${g.name}, ${numeral(Number(g.generation))} of the line`,
      epithet: bloodlineEpithet(g),
      cause: g.cause || 'the city took its due',
      level: Number(g.level), kills: Number(g.kills),
      honorTier: honorTierOf(g.honor).name,
      diedAt: g.died_at,
    })),
    score: scoreOf(gens),
    weights: BLOODLINE.SCORE,
  };
}

// the great houses of the city — ranked by dynasty score (pure status; shown under the F4 dynasty
// name with the living steward beneath, the portfolio-board pattern).
// (red-team R31 F1) AGENTS **and RESIDENTS** excluded. Residents die through the ORDINARY runEstate —
// that is the population layer's whole design ("death is deliberately not special") — so every killed
// resident writes a `bloodline` row, and with RETIRE_GENERATIONS 6 a boss-band line accrues six
// generations of level+kills score. REPRODUCED: four mod-kills put a resident house on the board at
// score 520 while the only human on the server was absent, because he had not died yet.
export async function bloodlineLeaderboard(pool) {
  // flat queries + JS aggregate — pg-mem chokes on a GROUP BY aggregate with joined aliases
  // (the /v1/gangs precedent); the dataset is small (one row per generation).
  const excluded = new Set((await pool.query('SELECT account_id FROM account_persistent WHERE agent_flag OR npc_flag')).rows.map((a) => a.account_id));
  const names = Object.fromEntries((await pool.query(
    'SELECT account_id, dynasty_name FROM account_persistent')).rows.map((a) => [a.account_id, a.dynasty_name]));
  const tally = {};
  for (const g of (await pool.query('SELECT account_id, generation, level, kills, honor FROM bloodline')).rows) {
    if (excluded.has(g.account_id)) continue;
    const t = tally[g.account_id] || (tally[g.account_id] = { score: 0, generations: 0 });
    t.score += Number(g.level) * BLOODLINE.SCORE.LEVEL + Number(g.kills) * BLOODLINE.SCORE.KILL
      + Math.abs(Number(g.honor)) * BLOODLINE.SCORE.HONOR_ABS;
    t.generations = Math.max(t.generations, Number(g.generation));
  }
  const top = Object.entries(tally).sort((a, b) => b[1].score - a[1].score).slice(0, 20);
  const out = [];
  for (const [accountId, t] of top) {
    const living = (await pool.query(
      'SELECT name, generation FROM characters WHERE account_id=$1 AND alive', [accountId])).rows[0];
    out.push({
      dynasty: names[accountId] || (living ? `the house of ${living.name}` : 'a fallen house'),
      steward: living ? `${living.name}, ${numeral(Number(living.generation))} of the line` : null,
      generations: t.generations + (living ? 1 : 0),
      score: t.score,
    });
  }
  return { houses: out };
}

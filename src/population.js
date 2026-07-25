// THE POPULATION — NPC residents of the city. Design: omerta-npc-population-design.md.
//
// OMERTÀ is a multiplayer game launching with ~zero players, so every board that reads `characters`
// is dead in an empty alpha: the streets roster, the contract board, the duelling ladder, the Black
// Market, the Shylock, the bodyguard market, the nightlife board, the fights, the races strip, the
// fade/poker tables, the Wire's tap targets, Secrets' dig targets. The progression harness measured
// the consequence exactly — a plausible player reaches level 128 with $51M in 30 days having never
// once met another person, because there is nobody to meet.
//
// A resident is a REAL character (the convoys.is_npc precedent): a real `accounts` +
// `account_persistent` + `characters` row, flagged on both levels. That means every interaction a
// player has with a resident — a jump, a contract, a fire-kill, a wiretap, a dig, a DM — runs the
// SAME audited code that runs against a real player. Nothing in social.js knows it's fighting a ghost.
//
// §10.4: residents hold cash, so they sit inside the per-character cash check and every dollar they
// hold must have an enumerated reason. Exactly two new ones, both under the `npc:` cash prefix:
//   npc:seed    FAUCET — the cash a resident is spawned holding (the one new faucet; sim P9.21)
//   npc:retire  SINK   — the cash burned when the worker retires a resident
// Everything else is an existing audited flow: a fire-kill loots them through `whack:loot`, the
// estate burns the remainder through the existing death rows, the heir's stake is `death:legacy`.
//
// DEATH IS DELIBERATELY NOT SPECIAL. A killed resident runs the ordinary runEstate, and the heir —
// same name, generation+1 — IS the respawn. social.js needs zero changes and the population
// self-heals. The worker only tops up headcount and retires old bloodlines.
import crypto from 'node:crypto';
import { POPULATION, NPC_FIRST, NPC_LAST, npcBandOf, DISTRICTS, PACING, dayOf } from './rules.js';

const uid = () => crypto.randomUUID();
const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
const rndInt = (lo, hi) => Math.floor(rnd(lo, hi + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// respect for a target level, off the LIVE pacing curve (never a hardcoded copy of the inverse —
// that duplication is what silently under-seeded every sim probe when the curve last moved)
const respectFor = (lvl) => PACING.LEVEL_DIVISOR * (lvl - 1) * (lvl - 1);

/** How many residents are currently walking around. */
export async function population(client) {
  return Number((await client.query('SELECT COUNT(*) n FROM characters WHERE alive AND is_npc')).rows[0].n);
}

/**
 * Spawn ONE resident. Returns { id, name, level, band } or null if a unique name couldn't be found
 * (living names are unique game-wide — the caller just tries again next tick).
 *
 * Runs inside the caller's transaction so a failed spawn leaves nothing behind.
 */
export async function spawnResident(client, opts = {}) {
  const band = opts.band || npcBandOf(Math.random());
  const lvl = opts.level || rndInt(band.lvl[0], band.lvl[1]);
  const cash = Math.round(rnd(band.seed[0], band.seed[1]));

  // a unique living name — retry a few times before giving up to the next tick
  let name = null;
  for (let i = 0; i < 6 && !name; i++) {
    const cand = `${pick(NPC_FIRST)} ${pick(NPC_LAST)}`;
    const taken = (await client.query('SELECT 1 FROM characters WHERE name=$1 AND alive LIMIT 1', [cand])).rows.length;
    if (!taken) name = cand;
  }
  if (!name) return null;

  const accountId = uid();
  const charId = uid();
  // the account: a real row (characters.account_id is NOT NULL), flagged npc so the human-only
  // surfaces — above all the Street Wage — can exclude it.
  await client.query('INSERT INTO accounts (id, auth_provider, auth_subject) VALUES ($1,$2,$3)',
    [accountId, 'npc', `npc:${accountId}`]);
  await client.query('INSERT INTO account_persistent (account_id, npc_flag) VALUES ($1,true)', [accountId]);

  // `season` is NOT NULL with no default — the real creation path stamps the current season and so
  // must this, or the lazy season-rollover marker is wrong for every resident.
  await client.query(
    `INSERT INTO characters (id, account_id, name, is_npc, season, respect, cash, muscle, cunning, speed, loc, health, energy, nerve)
     VALUES ($1,$2,$3,true,$4,$5,$6,$7,$8,$9,$10,100,50,10)`,
    [charId, accountId, name, Math.floor(dayOf() / 28), respectFor(lvl), cash,
     rndInt(band.stat[0], band.stat[1]), rndInt(band.stat[0], band.stat[1]), rndInt(band.stat[0], band.stat[1]),
     pick(DISTRICTS).id]);

  // §10.4 — the seed is ledgered against the resident, so the per-character cash check reconciles
  // them exactly like a player. Every character row carries an un-ledgered base of 500 (that's the
  // baseline the check subtracts), so what gets ledgered is the DELTA from it — the same accounting
  // the heir's legacy stake uses. The delta can be NEGATIVE: the `corner` band seeds below 500, and
  // skipping the row for those left the books short by exactly the shortfall.
  if (cash !== 500) {
    await client.query(
      'INSERT INTO transactions (id, character_id, currency, amount, reason) VALUES ($1,$2,$3,$4,$5)',
      [uid(), charId, 'cash', cash - 500, 'npc:seed']);
  }
  return { id: charId, name, level: lvl, band: band.id, cash };
}

/**
 * Retire ONE resident — the city moves on. Burns whatever cash they were carrying (`npc:retire`, a
 * ledgered SINK) so the §10.4 books close exactly, then marks them dead WITHOUT an estate: a retired
 * resident leaves no heir, which is how headcount makes room for fresh faces.
 */
export async function retireResident(client, charId) {
  const c = (await client.query(
    'SELECT id, cash, bank FROM characters WHERE id=$1 AND alive AND is_npc FOR UPDATE', [charId])).rows[0];
  if (!c) return null;
  const held = Number(c.cash) + Number(c.bank);
  if (held > 0) {
    await client.query(
      'INSERT INTO transactions (id, character_id, currency, amount, reason) VALUES ($1,$2,$3,$4,$5)',
      [uid(), charId, 'cash', -held, 'npc:retire']);
  }
  await client.query('UPDATE characters SET alive=false, cash=0, bank=0 WHERE id=$1', [charId]);
  return { id: charId, burned: held };
}

/**
 * THE WORKER TICK — keep the city populated.
 *
 * Tops headcount up to POPULATION.TARGET (at most SPAWN_PER_TICK per tick, so the city fills in
 * visibly rather than appearing all at once), and retires bloodlines past RETIRE_GENERATIONS so no
 * resident line accumulates prestige — and therefore an ever-growing `death:legacy` stake — forever.
 *
 * Each spawn/retire is its own transaction: one bad row can never starve the rest (the worker
 * per-job isolation discipline).
 */
export async function runPopulation(pool) {
  const out = { spawned: 0, retired: 0, population: 0 };

  // 1. retire the old lines first, so the top-up below refills the space they leave
  const old = (await pool.query(
    'SELECT id FROM characters WHERE alive AND is_npc AND generation > $1 ORDER BY id LIMIT $2',
    [POPULATION.RETIRE_GENERATIONS, POPULATION.SPAWN_PER_TICK])).rows;
  for (const r of old) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const done = await retireResident(client, r.id);
      await client.query('COMMIT');
      if (done) out.retired++;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[population] retire failed', r.id, e.message);
    } finally { client.release(); }
  }

  // 2. top up to target
  const have = await population(pool);
  const want = Math.max(0, Math.min(POPULATION.SPAWN_PER_TICK, POPULATION.TARGET - have));
  for (let i = 0; i < want; i++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const born = await spawnResident(client);
      await client.query('COMMIT');
      if (born) out.spawned++;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[population] spawn failed', e.message);
    } finally { client.release(); }
  }
  out.population = await population(pool);
  return out;
}

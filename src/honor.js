// ═══ FIVE PILLARS #1 — HONOR ↔ INFAMY (the Fable identity axis) ═══
// One unifying reputation the world reacts to, derived from DEEDS at existing sites (repay a debt,
// take a bullet, settle a vendetta ↔ welsh, rat, shank, hire cowards' work, break an oath). Lives on
// `characters.honor` (NUMERIC −100..+100 — NUMERIC so set-based clamped arithmetic is pg-mem-safe),
// DIES with the street like stats, and echoes to the heir at ×HONOR.HEIR_KEEP (the npc-memory
// precedent — identity shadows the name, it doesn't survive whole).
//
// §10.4: ZERO — honor moves no value. Its two teeth are NEW levers off every signed surface
// (flagged sign-off): a Man of Honor lays low at ×HONOR.LAYLOW_MULT (the amnesty/fast_talker
// multiplicative stack at the one kitchen.js site), and a Mad Dog is refused by bodyguards +
// barred from proposing pacts/coalitions (diplomacy.js) — shut out of the social game.
import { HONOR, honorTierOf } from './rules.js';

const clamp = (v) => Math.max(HONOR.MIN, Math.min(HONOR.MAX, v));

// The standard bump: the caller holds the character's row lock (withCharacter / withTwoCharacters),
// so an absolute write from the in-memory value is race-free AND keeps `ch.honor` honest for the
// rest of the turn (view/persist read it). honor is NOT in persistCharacter's positional UPDATE —
// this direct write is the only writer (the active_at discipline), so no clobber either way.
export async function bumpHonor(client, ch, delta) {
  const next = clamp(Number(ch.honor || 0) + delta);
  await client.query('UPDATE characters SET honor=$2 WHERE id=$1', [ch.id, next]);
  ch.honor = next;
  // THE HONOR LEGEND (Tier-4) — the bloodline's high-water mark of honor + its deepest infamy
  // (account-level, survives death; the account row is held by the caller's char lock → no new lock.
  // NUMERIC, so GREATEST/LEAST arithmetic is pg-mem-safe).
  await client.query(
    'UPDATE account_persistent SET honor_peak = GREATEST(honor_peak, $2), honor_low = LEAST(honor_low, $2) WHERE account_id=$1',
    [ch.account_id, next]);
  return next;
}

// THE REPUTATION BOARDS (Tier-4) — MEN OF HONOR (highest honor the bloodline ever reached) and THE
// MOST FEARED (its deepest infamy). Account-level, survives death; agents excluded. Pure STATUS.
export async function honorLeaderboard(pool) {
  const nameFor = async (rows) => {
    const out = rows.map((r) => ({ ...r }));
    for (const r of out) {
      const c = (await pool.query('SELECT name FROM characters WHERE account_id=$1 AND alive LIMIT 1', [r.account_id])).rows[0];
      r.name = c?.name || (r.dynasty_name ? `House ${r.dynasty_name}` : 'a fallen name');
    }
    return out;
  };
  const menRows = await nameFor((await pool.query(
    `SELECT account_id, honor_peak, dynasty_name FROM account_persistent
      WHERE NOT agent_flag AND honor_peak > 0 ORDER BY honor_peak DESC, account_id LIMIT 15`)).rows);
  const fearedRows = await nameFor((await pool.query(
    `SELECT account_id, honor_low, dynasty_name FROM account_persistent
      WHERE NOT agent_flag AND honor_low < 0 ORDER BY honor_low ASC, account_id LIMIT 15`)).rows);
  return {
    menOfHonor: menRows.map((r, i) => ({ pos: i + 1, name: r.name, peak: Number(r.honor_peak), tier: honorTierOf(r.honor_peak).name })),
    mostFeared: fearedRows.map((r, i) => ({ pos: i + 1, name: r.name, low: Number(r.honor_low), tier: honorTierOf(r.honor_low).name })),
  };
}

// The set-based bump for paths with no loaded/locked ch (the loans overdue sweep marks welshers in
// one UPDATE): clamped in SQL. honor is NUMERIC → arithmetic UPDATE is pg-mem-safe (the documented
// quirk is INT-only).
export const sqlHonorDelta = (delta) =>
  delta >= 0 ? `LEAST(${HONOR.MAX}, honor + ${Number(delta)})` : `GREATEST(${HONOR.MIN}, honor - ${Math.abs(Number(delta))})`;

export const honorOf = (ch) => {
  const v = Number(ch.honor || 0);
  return { value: v, tier: honorTierOf(v).name };
};

export const isManOfHonor = (ch) => Number(ch.honor || 0) >= HONOR.TRUSTED;
export const isMadDog = (ch) => Number(ch.honor || 0) <= HONOR.DREADED;

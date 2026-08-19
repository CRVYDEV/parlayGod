// ═══ NAMED SOLDIERS with PERMADEATH (XCOM — omerta-marriage-soldiers-design.md, Drop B) ═══
// Recruited muscle with a rolled noir NAME + ONE trait. The assigned "second" assists three loops
// (crime / The Score / world raids — the assist TOUCHPOINTS live in game.js as soldierAssist/
// soldierResult, the advanceCampaignsInline one-way-import pattern), takes a cut, levels with jobs,
// gets INJURED on failures, and can DIE — permanently (the row stays as the memorial). Soldiers die
// with the street (estate-wiped). §10.4: `soldier:hire` is the one enumerated character_id'd cash
// SINK; the 5% cut is a pre-ledger shave (the crime faucet strictly shrinks — no new reason). All
// roster actions run single-party under withCharacter — soldier rows belong to the actor, so the
// char lock serializes everything (no second lock, no AB-BA surface).
import crypto from 'node:crypto';
import { GameError } from './game.js';
import { SOLDIERS, soldierLevelOf, soldierFxOf, soldierRankOf, commanderRankOf, rollSoldierName } from './rules.js';

const uid = () => crypto.randomUUID();
const fit = (s) => s.alive && (!s.injured_until || new Date(s.injured_until) <= new Date());

export async function hireSoldier(ch, client, h) {
  const living = (await client.query(
    'SELECT COUNT(*) c FROM soldiers WHERE character_id=$1 AND alive', [ch.id])).rows[0];
  if (Number(living.c) >= SOLDIERS.MAX)
    throw new GameError('full', `You run ${SOLDIERS.MAX} soldiers, tops. Somebody has to go first.`);
  if (Number(ch.cash) < SOLDIERS.HIRE_COST)
    throw new GameError('cash', `Good muscle costs $${SOLDIERS.HIRE_COST} up front.`);
  ch.cash = Number(ch.cash) - SOLDIERS.HIRE_COST;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -SOLDIERS.HIRE_COST, reason: 'soldier:hire' });
  const traits = Object.keys(SOLDIERS.TRAITS);
  const roll = Math.random();
  const trait = traits[Math.floor(roll * traits.length)];
  const name = rollSoldierName();
  const id = uid();
  await client.query(
    'INSERT INTO soldiers (id, character_id, name, trait) VALUES ($1,$2,$3,$4)', [id, ch.id, name, trait]);
  await h.rngLog(client, ch.id, 'soldier:hire', roll, `${name} — ${SOLDIERS.TRAITS[trait].name}`);
  return { ok: true, id, name, trait, traitName: SOLDIERS.TRAITS[trait].name,
    desc: SOLDIERS.TRAITS[trait].desc, cost: SOLDIERS.HIRE_COST };
}

// assign ONE soldier as your second (unassigns the rest); pass none/null via unassign to ride alone
export async function assignSoldier(ch, soldierId, client) {
  const s = (await client.query(
    'SELECT * FROM soldiers WHERE id=$1 AND character_id=$2 AND alive', [soldierId, ch.id])).rows[0];
  if (!s) throw new GameError('no_soldier', 'No such soldier on your payroll.');
  if (!fit(s)) throw new GameError('injured', `${s.name} is laid up — give it time.`);
  await client.query('UPDATE soldiers SET on_job=false WHERE character_id=$1', [ch.id]);
  await client.query('UPDATE soldiers SET on_job=true WHERE id=$1', [soldierId]);
  return { ok: true, name: s.name };
}

export async function unassignSoldier(ch, client) {
  // RETURNING the name so the client can say WHO stood down — a bare {ok:true} reached the toast as
  // "done.", which is the same nothing whether you had a second or not (the action-ledger class).
  const r = await client.query(
    'UPDATE soldiers SET on_job=false WHERE character_id=$1 AND on_job RETURNING name', [ch.id]);
  return { ok: true, standDown: r.rows[0]?.name || null };
}

// dismiss a LIVING soldier (free — they walk; the memorial keeps only the dead)
export async function dismissSoldier(ch, soldierId, client) {
  const r = await client.query(
    'DELETE FROM soldiers WHERE id=$1 AND character_id=$2 AND alive', [soldierId, ch.id]);
  if (!r.rowCount) throw new GameError('no_soldier', 'No such soldier on your payroll.');
  return { ok: true };
}

export async function soldierBoard(ch, client, acct) {
  const rows = (await client.query(
    'SELECT * FROM soldiers WHERE character_id=$1 ORDER BY hired_at', [ch.id])).rows;
  const now = Date.now();
  const led = Number(acct?.soldiers_led || 0);
  return {
    max: SOLDIERS.MAX, hireCost: SOLDIERS.HIRE_COST, cutBps: SOLDIERS.CUT_BPS,
    // TIER-4 — THE COMMANDER LEGEND (lifetime jobs led, survives death)
    commander: { led, rank: commanderRankOf(led).name },
    roster: rows.filter((s) => s.alive).map((s) => ({
      id: s.id, name: s.name, trait: s.trait,
      traitName: SOLDIERS.TRAITS[s.trait]?.name || s.trait,
      desc: SOLDIERS.TRAITS[s.trait]?.desc || '',
      level: soldierLevelOf(s.xp), xp: Number(s.xp), rank: soldierRankOf(s.xp).name, // Tier-4 — the recruit→capo grade
      onJob: s.on_job,
      injuredSeconds: s.injured_until && new Date(s.injured_until) > now
        ? Math.floor((new Date(s.injured_until) - now) / 1000) : 0,
    })),
    // THE MEMORIAL — the fallen stay on the wall until the street itself dies
    memorial: rows.filter((s) => !s.alive).map((s) => ({
      name: s.name, trait: SOLDIERS.TRAITS[s.trait]?.name || s.trait,
      level: soldierLevelOf(s.xp), rank: soldierRankOf(s.xp).name, cause: s.cause || 'a job gone wrong', diedAt: s.died_at,
    })),
  };
}

// THE COMMANDERS' BOARD (Tier-4) — the most decorated commanders by lifetime jobs led (agents excluded).
export async function commanderLeaderboard(pool) {
  const rows = (await pool.query(
    `SELECT c.name, ap.soldiers_led FROM account_persistent ap
       JOIN characters c ON c.account_id = ap.account_id AND c.alive
      WHERE NOT ap.agent_flag AND NOT c.is_npc AND ap.soldiers_led > 0
      ORDER BY ap.soldiers_led DESC, c.name LIMIT 20`)).rows;
  return { commanders: rows.map((r, i) => ({ pos: i + 1, name: r.name, led: Number(r.soldiers_led),
    rank: commanderRankOf(r.soldiers_led).name })) };
}

export { soldierLevelOf, soldierFxOf };

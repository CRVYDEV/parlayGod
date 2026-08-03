// THE REGIMEN — the expanded training system (omerta-training-expansion-design.md,
// founder-directed 2026-07-30: "the training system is way too basic … more stats you can train
// and develop … daily quests picked up from NPCs").
//
// Five DISCIPLINES beyond muscle/cunning/speed, trained on the SAME gym cooldown clock as the core
// stats (breadth, never rate — the pacing wall holds by construction), plus one TRAINER DRILL per
// Underworld fixture per day (seed-drawn; progress READ from daily_progress.counters — zero new
// counting surface) paying discipline XP on claim.
//
// §10.4: ZERO surface. Training costs energy + the shared clock, never cash; XP and levels are not
// currencies; nothing here writes a transactions row (the regimen test proves it). Discipline state
// DIES WITH THE STREET (runEstate wipes character_disciplines + npc_drills).
import { REGIMEN, UNDERWORLD, PACING, disciplineLvlOf, drillOf, dayOf, jailed } from './rules.js';
import { GameError } from './game.js';

const DISC_IDS = REGIMEN.DISCIPLINES.map((d) => d.id);

// absolute-write upsert (the pg-mem INT-arithmetic discipline): read under the char lock the caller
// already holds, write the computed total.
export async function addXp(client, characterId, discipline, xp) {
  const row = (await client.query(
    'SELECT xp FROM character_disciplines WHERE character_id=$1 AND discipline=$2', [characterId, discipline])).rows[0];
  const total = Number(row?.xp || 0) + xp;
  if (row) await client.query('UPDATE character_disciplines SET xp=$3 WHERE character_id=$1 AND discipline=$2', [characterId, discipline, total]);
  else await client.query('INSERT INTO character_disciplines (character_id, discipline, xp) VALUES ($1,$2,$3)', [characterId, discipline, xp]);
  return total;
}

// ── train a discipline — the gym's fourth-through-eighth doors, on the gym's ONE clock ──
// PEN step six threads { fromYard } to waive ONLY the jail gate (the burner `fromBurner` precedent):
// the iron pile IS the gym for a jailed man — every other gate (energy, the shared clock, the cap)
// stands, so jail never trains faster than the street.
export async function trainDiscipline(ch, id, client, h, { fromYard = false } = {}) {
  if (!DISC_IDS.includes(id)) throw new GameError('bad_discipline', 'No such discipline.');
  if (!fromYard && jailed(ch)) throw new GameError('jailed', 'No gym in lockup — but there\'s an iron pile in the yard.');
  if (Number(ch.energy) < REGIMEN.ENERGY) throw new GameError('energy', 'Too tired to train.');
  const trainCd = Number(process.env.TRAIN_CD_MS ?? PACING.TRAIN_CD_MS);
  if (trainCd > 0 && ch.train_at && new Date(ch.train_at) > new Date())
    throw new GameError('cooldown', `The body needs a minute. Back to the gym in ${Math.max(1, Math.ceil((new Date(ch.train_at) - Date.now()) / 60000))}m.`);
  const cur = Number(h.owned.disciplines?.[id] || 0);
  if (disciplineLvlOf(cur) >= REGIMEN.CAP) throw new GameError('capped', 'You\'ve mastered that discipline.');
  ch.energy = Number(ch.energy) - REGIMEN.ENERGY;
  const trainAt = new Date(Date.now() + trainCd);
  await client.query('UPDATE characters SET train_at=$2 WHERE id=$1', [ch.id, trainAt]);
  ch.train_at = trainAt;
  const roll = Math.random();
  const gain = REGIMEN.XP_MIN + Math.floor(roll * (REGIMEN.XP_MAX - REGIMEN.XP_MIN + 1));
  const before = disciplineLvlOf(cur);
  const total = await addXp(client, ch.id, id, gain);
  const after = disciplineLvlOf(total);
  await h.rngLog(client, ch.id, `regimen:${id}`, roll, `+${gain} xp (${total})`);
  await h.bumpDaily(client, ch.id, 'train'); // a regimen session IS a gym session — the daily counts it
  if (after > before) await h.notify(client, ch.id, 'discipline_up', { discipline: id, level: after });
  return { ok: true, discipline: id, xp: gain, total, level: after, levelUp: after > before,
    nextTrainSeconds: trainCd > 0 ? Math.ceil(trainCd / 1000) : 0 };
}

// today's drill progress for one character — READ from the daily counters (never counted twice)
async function drillProgress(client, characterId, day) {
  const row = (await client.query('SELECT counters FROM daily_progress WHERE character_id=$1 AND day=$2', [characterId, day])).rows[0];
  return row ? JSON.parse(row.counters) : {};
}

// which discipline a fixture trains — Mickey the Corner tops up your WEAKEST
function trainerDiscipline(npc, disc) {
  const t = REGIMEN.TRAINERS[npc];
  if (t !== 'lowest') return t;
  let low = DISC_IDS[0];
  for (const id of DISC_IDS) if (Number(disc?.[id] || 0) < Number(disc?.[low] || 0)) low = id;
  return low;
}

// ── claim a trainer's daily drill ──
export async function claimDrill(ch, npc, client, h) {
  if (!(npc in REGIMEN.TRAINERS)) throw new GameError('bad_trainer', 'Nobody by that name runs drills.');
  const day = dayOf();
  const d = drillOf(npc, day);
  const counters = await drillProgress(client, ch.id, day);
  if (Number(counters[d.kind] || 0) < d.n) throw new GameError('not_done', `Not yet — ${d.how} (${counters[d.kind] || 0}/${d.n}).`);
  const taken = await client.query(
    'INSERT INTO npc_drills (character_id, day, npc) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [ch.id, day, npc]);
  if (!taken.rowCount) throw new GameError('claimed', 'You already ran that drill today.');
  const disc = h.owned.disciplines || {};
  const target = trainerDiscipline(npc, disc);
  const total = await addXp(client, ch.id, target, REGIMEN.DRILL_XP);
  await h.notify(client, ch.id, 'drill_done', { npc, discipline: target, xp: REGIMEN.DRILL_XP });
  return { ok: true, npc, discipline: target, xp: REGIMEN.DRILL_XP, total, level: disciplineLvlOf(total) };
}

// ── the board: your disciplines + today's six drills with live progress ──
export async function regimenBoard(ch, client, h) {
  const day = dayOf();
  const disc = h.owned.disciplines || {};
  const counters = await drillProgress(client, ch.id, day);
  const claimed = new Set((await client.query(
    'SELECT npc FROM npc_drills WHERE character_id=$1 AND day=$2', [ch.id, day])).rows.map((r) => r.npc));
  const npcName = (id) => (UNDERWORLD.NPCS.find((n) => n.id === id) || {}).name || id;
  return {
    disciplines: REGIMEN.DISCIPLINES.map((d) => {
      const xp = Number(disc[d.id] || 0), lvl = disciplineLvlOf(xp);
      const nextAt = REGIMEN.XP_DIVISOR * lvl * lvl; // xp where the NEXT level lands
      const prevAt = REGIMEN.XP_DIVISOR * (lvl - 1) * (lvl - 1);
      return { id: d.id, name: d.name, desc: d.desc, xp, level: lvl, cap: REGIMEN.CAP,
        nextXp: lvl >= REGIMEN.CAP ? null : nextAt,
        // server-computed progress-within-level (the tradeRank discipline — the client never re-derives)
        pct: lvl >= REGIMEN.CAP ? 100 : Math.max(0, Math.min(100, Math.floor(((xp - prevAt) / (nextAt - prevAt)) * 100))) };
    }),
    drills: Object.keys(REGIMEN.TRAINERS).map((npc) => {
      const d = drillOf(npc, day);
      return { npc, trainer: npcName(npc), discipline: trainerDiscipline(npc, disc),
        kind: d.kind, n: d.n, how: d.how,
        progress: Math.min(Number(counters[d.kind] || 0), d.n),
        done: Number(counters[d.kind] || 0) >= d.n, claimed: claimed.has(npc), xp: REGIMEN.DRILL_XP };
    }),
    energy: REGIMEN.ENERGY,
    trainSeconds: ch.train_at && new Date(ch.train_at) > new Date()
      ? Math.ceil((new Date(ch.train_at) - Date.now()) / 1000) : 0,
  };
}

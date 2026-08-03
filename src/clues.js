// CLUE SCROLLS (slate #4 — the RuneScape treasure trail; design
// omerta-ladder-clues-seasons-design.md). A rare drop from a successful CRIME starts a
// multi-step riddle hunt: each step names a DISTRICT (sometimes with a city-hour window),
// derived deterministically from the scroll's stored salt via the §7.11 hash — server-verifiable,
// no stored answers. Stand on the right ground, dig, advance; the final dig opens a CASKET.
//
// THE ONE NEW FAUCET: the casket's cash (`clue:casket`, character_id'd — §10.4 check (a)
// reconciles it), bounded three ways — the 2% drop chance, ONE active scroll per street, and the
// 8h post-casket cooldown (≤ ~3 caskets/day ≈ $36k/day hard ceiling; sim probe P9.19 prints it).
// Rares/cosmetics in caskets are deliberately DEFERRED (never chance-based $OMR — the RWA rule's
// spirit). `CLUE_DROP_P` is a TEST-ONLY roll knob (the LAW_BUST_P precedent, boot-guard listed).
//
// The scroll DIES with the street (clue_scrolls: DISPOSITION wiped); `caskets` is the
// account-level lifetime legend (survives death, the boxing_wins precedent). `clue_at` (the
// post-casket cooldown) is a DIRECT-SQL column — never in the positional persist.
import { GameError, notify } from './game.js';
import { CLUES, clueStepOf, clueRankOf, clueTierOf, cityHourOf , jailed, safeHoused } from './rules.js';
import { logCollect } from './collection.js';


// ── the board: your scroll + the riddle + the legend ──
export async function clueBoard(pool, ch, acct) {
  const s = (await pool.query('SELECT * FROM clue_scrolls WHERE character_id=$1', [ch.id])).rows[0];
  const caskets = Number(acct?.caskets || 0);
  const cdMs = ch.clue_at ? new Date(ch.clue_at) - Date.now() : 0;
  // TIER-4 §C — the relic count (status collectibles found; the completion chase)
  const relics = Number((await pool.query(
    "SELECT COUNT(*) n FROM collection_log WHERE account_id=$1 AND category='relics'", [ch.account_id])).rows[0]?.n || 0);
  let scroll = null;
  if (s) { const step = clueStepOf(s.salt, Number(s.step)); const t = clueTierOf(s.tier);
    scroll = { step: Number(s.step), of: Number(s.steps), riddle: step.riddle, kind: step.kind,
      tier: t.id, tierName: t.name, casketBand: [t.casketMin, t.casketMax] }; }
  return {
    scroll,
    cooldownSeconds: Math.max(0, Math.ceil(cdMs / 1000)),
    digEnergy: CLUES.DIG_ENERGY,
    legend: { caskets, rank: clueRankOf(caskets).title, relics, relicsMax: CLUES.RELICS.length },
    ranks: CLUES.RANKS, tiers: CLUES.TIERS,
  };
}

// ── the dig — stand on the right ground (inside the window if timed), pay the shovel work ──
export async function dig(ch, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No digging from lockup.');
  // (red-team, D2 consistency) a casket is a collect-class faucet — no shovel work from a safehouse
  if (safeHoused(ch)) throw new GameError('safe', 'No digging while you are off the grid — surface first.');
  const s = (await client.query('SELECT * FROM clue_scrolls WHERE character_id=$1 FOR UPDATE', [ch.id])).rows[0];
  if (!s) throw new GameError('no_scroll', 'No scroll in hand — clues turn up on jobs.');
  if (Number(ch.energy) < CLUES.DIG_ENERGY) throw new GameError('energy', `Digging takes ${CLUES.DIG_ENERGY} energy.`);
  ch.energy = Number(ch.energy) - CLUES.DIG_ENERGY;   // the shovel is paid win or lose (pacing)
  const step = clueStepOf(s.salt, Number(s.step));
  if (ch.loc !== step.district)
    return { ok: false, cold: true, riddle: step.riddle, hint: 'Cold ground. Read it again — this is not the place.' };
  if (step.window) {
    const hr = cityHourOf().hour;
    if (hr < step.window.lo || hr > step.window.hi)
      return { ok: false, cold: true, riddle: step.riddle, hint: `Right ground, wrong hour — come ${step.window.text} (h${step.window.lo}–${step.window.hi}).` };
  }
  const done = Number(s.step) >= Number(s.steps);
  if (!done) {
    const next = Number(s.step) + 1;
    await client.query('UPDATE clue_scrolls SET step=$2 WHERE character_id=$1', [ch.id, next]);
    return { ok: true, step: next, of: Number(s.steps), riddle: clueStepOf(s.salt, next).riddle };
  }
  // THE CASKET — the final dig. TIER-4: the take band scales with the scroll's TIER (the one faucet:
  // rng-audited, ledgered, cooldown stamped). A rare roll also yields a RELIC (status, never $OMR).
  const tier = clueTierOf(s.tier);
  const roll = Math.random();
  const take = Math.floor(tier.casketMin + roll * (tier.casketMax - tier.casketMin));
  ch.cash = Number(ch.cash) + take;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: take, reason: 'clue:casket' });
  await h.rngLog(client, ch.id, 'clue:casket', roll, `${tier.id} casket $${take}`);
  // §C — the RELIC roll (rarity scaled by tier): a status collectible logged to the Collection.
  // CLUE_RELIC_P is a TEST-ONLY roll knob (the CLUE_DROP_P precedent, boot-guard listed).
  let relic = null;
  const relicP = process.env.CLUE_RELIC_P != null ? Number(process.env.CLUE_RELIC_P) : tier.relicP;
  const relicRoll = Math.random();
  if (relicRoll < relicP) {
    relic = CLUES.RELICS[Math.floor(Math.random() * CLUES.RELICS.length)];
    await logCollect(client, ch.account_id, 'relics', relic.id);
    await h.rngLog(client, ch.id, 'clue:relic', relicRoll, `relic ${relic.id}`);
  }
  await client.query('DELETE FROM clue_scrolls WHERE character_id=$1', [ch.id]);
  await client.query('UPDATE characters SET clue_at=$2 WHERE id=$1', [ch.id, new Date(Date.now() + CLUES.CLUE_CD_MS)]);
  ch.clue_at = new Date(Date.now() + CLUES.CLUE_CD_MS);
  await client.query('UPDATE account_persistent SET caskets = caskets + 1 WHERE account_id=$1', [ch.account_id]);
  await h.track(client, ch.account_id, 'clue_casket', { take, tier: tier.id, steps: Number(s.steps), relic: relic?.id });
  const caskets = Number((await client.query(
    'SELECT caskets FROM account_persistent WHERE account_id=$1', [ch.account_id])).rows[0]?.caskets || 0);
  return { ok: true, casket: true, take, tier: tier.id, caskets, rank: clueRankOf(caskets).title,
    ...(relic ? { relic: { id: relic.id, name: relic.name } } : {}) };
}

// ── the diggers' leaderboard (lifetime caskets — agents excluded, the status-board posture) ──
export async function clueLeaderboard(pool) {
  const rows = (await pool.query(
    `SELECT ap.account_id, ap.caskets, c.name, c.respect
       FROM account_persistent ap
       JOIN characters c ON c.account_id = ap.account_id AND c.alive
      WHERE ap.caskets > 0 AND NOT ap.agent_flag
      ORDER BY ap.caskets DESC, c.name LIMIT 15`)).rows;
  // TIER-4 §D — the relic tally per digger (the collector's axis; two flat queries, pg-mem-safe)
  const relicRows = (await pool.query("SELECT account_id, COUNT(*) n FROM collection_log WHERE category='relics' GROUP BY account_id")).rows;
  const relicsBy = Object.fromEntries(relicRows.map((r) => [r.account_id, Number(r.n)]));
  return { diggers: rows.map((r, i) => ({ pos: i + 1, name: r.name,
    caskets: Number(r.caskets), rank: clueRankOf(r.caskets).title, relics: relicsBy[r.account_id] || 0 })) };
}

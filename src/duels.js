// THE DUELING LADDER (slate #5 — the ranked ELO circuit; design
// omerta-ladder-clues-seasons-design.md). The game's first RATING: a formal dueling circuit —
// consent-by-listing (the fade/bout/race pattern), one atomic two-party duel, standard ELO.
//
// The MONEY is the audited casino:pvp taxed transfer byte-for-byte (the boxing fightBout
// accounting): loser −stake, winner +stake − rake, half the rake → the street-tax buyback, half
// burns. ZERO new emission. `duel:wager` rides a new `duel:` cash-vocabulary prefix, both rows
// character_id'd — the per-character §10.4 check reconciles them.
//
// The RATING is pure status: `characters.duel_elo` is a DIRECT-SQL column (never in the
// positional persist — clobber-safe; absolute writes under the two char locks withTwoCharacters
// already holds). Seasonal: runSeasonRollover resets it to ELO_START — the elo also dies with
// the street (the heir starts fresh; no death-softening). Lifetime `duel_wins` is the
// account-level legend (survives death, the boxing_wins precedent).
//
// Anti-Sybil: K_eff = ELO_K / (1 + duels vs the SAME ACCOUNT PAIR today) — the bloodline
// kill-diminishing precedent, keyed on accounts so a fed alt's fresh street doesn't reset the
// pair; plus the MIN_LVL floor (both sides), the LEGEND_MIN_LVL floor on the lifetime credit,
// the ELO_FLOOR, and every feed paying the 5% rake. Flagged in BALANCE.md.
import crypto from 'crypto';
import { GameError, notify, bumpMastery } from './game.js';
import { DUELS, duelRankOf, duelDivisionOf, duelStyleOf, duelTitleRankOf, levelOf, dayOf, effStat, pathFx } from './rules.js';

const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const hospitalized = (ch) => ch.hosp_until && new Date(ch.hosp_until) > new Date();
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

// TIER-4: pick your weapon stance (direct-SQL — clobber-safe, off the positional persist)
export async function pickStyle(ch, styleId, client) {
  const s = duelStyleOf(styleId);
  if (!s) throw new GameError('style', 'No such fighting style.');
  await client.query('UPDATE characters SET duel_style=$2 WHERE id=$1', [ch.id, s.id]);
  ch.duel_style = s.id;
  return { ok: true, style: s.id, name: s.name };
}

// ── list / unlist yourself on the circuit (consent-by-listing) ──
export async function listDuel(ch, limit, client) {
  if (limit == null || limit === false) {
    await client.query('UPDATE characters SET duel_limit=NULL WHERE id=$1', [ch.id]);
    ch.duel_limit = null; // (red-team) mirror the direct-SQL write — the same response renders the view
    return { ok: true, listed: false };
  }
  const cap = Math.floor(Number(limit));
  if (!Number.isFinite(cap) || cap < DUELS.STAKE_MIN)
    throw new GameError('amount', `List a stake cap of at least $${DUELS.STAKE_MIN}.`);
  if (levelOf(Number(ch.respect)) < DUELS.MIN_LVL)
    throw new GameError('level', `The circuit takes duelists at level ${DUELS.MIN_LVL}.`);
  await client.query('UPDATE characters SET duel_limit=$2 WHERE id=$1', [ch.id, cap]);
  ch.duel_limit = cap; // (red-team) mirror the direct-SQL write
  return { ok: true, listed: true, limit: cap };
}

// ── the board: open duelists, nearest rival first (|elo diff|) ──
export async function duelBoard(pool, ch) {
  const rows = (await pool.query(
    `SELECT c.id, c.name, c.respect, c.duel_elo, c.duel_limit, c.duel_style, g.tag
       FROM characters c
       LEFT JOIN gang_members gm ON gm.character_id = c.id
       LEFT JOIN gangs g ON g.id = gm.gang_id
      WHERE c.alive AND c.duel_limit IS NOT NULL`)).rows;
  const mine = Number(ch.duel_elo || DUELS.ELO_START);
  const div = (e) => { const d = duelDivisionOf(e); return { name: d.name, tag: d.tag }; };
  const duelists = rows
    .map((r) => ({ id: r.id, name: r.name, level: levelOf(Number(r.respect)),
      elo: Number(r.duel_elo), rank: duelRankOf(r.duel_elo).title, division: div(Number(r.duel_elo)),
      style: r.duel_style || null, limit: Number(r.duel_limit), tag: r.tag || null, me: r.id === ch.id }))
    .sort((a, b) => Math.abs(a.elo - mine) - Math.abs(b.elo - mine));
  // THE BELT — the highest-ELO active LISTED duelist holds it (recomputed on read, the Commission-seats
  // precedent). Ties break on the earliest to reach it (id) so the chair doesn't flap.
  const champ = (await pool.query(
    `SELECT c.id, c.name, c.duel_elo FROM characters c WHERE c.alive AND c.duel_limit IS NOT NULL
      ORDER BY c.duel_elo DESC, c.id ASC LIMIT 1`)).rows[0];
  // account-level lifetime title count (survives death) — read straight off the persistent row
  const titles = Number((await pool.query(
    'SELECT duel_titles FROM account_persistent WHERE account_id=$1', [ch.account_id])).rows[0]?.duel_titles || 0);
  return { you: { elo: mine, rank: duelRankOf(mine).title, division: div(mine),
      style: ch.duel_style || null, titles, titleRank: duelTitleRankOf(titles)?.name || null,
      listed: ch.duel_limit != null, limit: ch.duel_limit != null ? Number(ch.duel_limit) : null },
    belt: champ ? { name: champ.name, elo: Number(champ.duel_elo), mine: champ.id === ch.id } : null,
    stakeMin: DUELS.STAKE_MIN, rakeBps: DUELS.RAKE_BPS, minLevel: DUELS.MIN_LVL,
    styles: DUELS.STYLES, divisions: DUELS.DIVISIONS, ranks: DUELS.RANKS, duelists };
}

// ── the duel — one atomic two-party contest (withTwoCharacters holds both char+account locks) ──
export async function challenge(ch, opponent, amount, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No duels from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp', "You're in no shape to duel.");
  if (jailed(opponent) || hospitalized(opponent)) throw new GameError('unavailable', "They can't answer a challenge right now.");
  if (h.owned.gangId && h.victimOwned.gangId === h.owned.gangId) throw new GameError('family', 'No family matchups — spar off the books.');
  if (levelOf(Number(ch.respect)) < DUELS.MIN_LVL || levelOf(Number(opponent.respect)) < DUELS.MIN_LVL)
    throw new GameError('level', `The circuit takes duelists at level ${DUELS.MIN_LVL}.`);
  // (red-team) the CHALLENGER cools between duels (the street-races precedent) — a strong build
  // can't machine-gun a listed weaker duelist; DUEL_CD_MS is a TEST-ONLY knob (boot-guard listed)
  let cdMs = process.env.DUEL_CD_MS != null ? Number(process.env.DUEL_CD_MS) : DUELS.CHALLENGE_CD_MS;
  if (ch.duel_at && new Date(ch.duel_at) > new Date()) throw new GameError('cooldown', 'Catch your breath — the circuit takes its time between bouts.');
  // TIER-4 GRUDGE REMATCH: if this opponent's account was the LAST to beat you, the rematch cools
  // ~⅓ as long — chase the redemption. Read the most recent duel between the pair from the log.
  const grudge = (await client.query(
    `SELECT winner_account FROM duels WHERE (account_a=$1 AND account_b=$2) OR (account_a=$2 AND account_b=$1)
      ORDER BY at DESC LIMIT 1`, [ch.account_id, opponent.account_id])).rows[0];
  const isGrudge = grudge && grudge.winner_account === opponent.account_id;
  if (isGrudge) cdMs = Math.floor(cdMs * DUELS.GRUDGE_CD_MULT);
  const limit = opponent.duel_limit != null ? Math.floor(Number(opponent.duel_limit)) : 0;
  if (!(limit > 0)) throw new GameError('not_listed', "They're not taking duels.");
  const amt = Math.floor(Number(amount));
  if (!(Number.isFinite(amt) && amt >= DUELS.STAKE_MIN)) throw new GameError('amount', `The minimum stake is $${DUELS.STAKE_MIN}.`);
  if (amt > limit) throw new GameError('limit', `They take duels up to $${limit}.`);
  if (Number(ch.cash) < amt) throw new GameError('cash', 'Not enough pocket cash for the stake.');
  if (Number(opponent.cash) < amt) throw new GameError('their_cash', "They can't cover that stake right now.");

  // the contest: the BUILD decides (eff stats incl. gear/assets), the dice add flavor, and the
  // WEAPON STYLE tilts a favorable matchup (rock-paper-scissors — Brawler>Gunslinger>Fencer>Brawler).
  const eff = (c, owned) => ['muscle', 'cunning', 'speed']
    .reduce((s, st) => s + effStat(c[st], st, owned?.assets || [], owned?.gear || []), 0);
  const myStyle = duelStyleOf(ch.duel_style), theirStyle = duelStyleOf(opponent.duel_style);
  const myEdge = myStyle && theirStyle && myStyle.beats === theirStyle.id ? DUELS.STYLE_EDGE : 1;
  const theirEdge = myStyle && theirStyle && theirStyle.beats === myStyle.id ? DUELS.STYLE_EDGE : 1;
  let mine, theirs;
  do {
    mine = (eff(ch, h.owned) + rand(0, DUELS.VARIANCE)) * myEdge * pathFx(ch, 'contest');       // PATHS v2 — the Ring's edge /
    theirs = (eff(opponent, h.victimOwned) + rand(0, DUELS.VARIANCE)) * theirEdge * pathFx(opponent, 'contest'); // the Shadow's aversion
  } while (mine === theirs);
  const win = mine > theirs;
  const styleClash = myEdge > 1 ? 'you had the style edge' : theirEdge > 1 ? 'they had the style edge' : null;
  await h.rngLog(client, ch.id, 'duel', mine / (mine + theirs), `${win ? 'win' : 'loss'}${styleClash ? ' · ' + styleClash : ''}`);

  // the audited casino:pvp taxed transfer (the fightBout accounting, byte-for-byte)
  const rake = Math.ceil(amt * 2 * DUELS.RAKE_BPS / 10000);
  const winner = win ? ch : opponent, loser = win ? opponent : ch;
  loser.cash = Number(loser.cash) - amt;
  winner.cash = Number(winner.cash) + amt - rake;
  await h.ledger(client, { characterId: loser.id, currency: 'cash', amount: -amt, reason: 'duel:wager', counterparty: winner.id });
  await h.ledger(client, { characterId: winner.id, currency: 'cash', amount: amt - rake, reason: 'duel:wager', counterparty: loser.id });
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [Math.floor(rake / 2)]); // half → the buyback, half burns

  // ELO — standard update, K damped per account-pair per day (anti-feeding)
  const [pa, pb] = [ch.account_id, opponent.account_id].sort();
  const day = dayOf();
  const prior = Number((await client.query(
    'SELECT COUNT(*) c FROM duels WHERE account_a=$1 AND account_b=$2 AND day=$3', [pa, pb, day])).rows[0].c);
  const kEff = DUELS.ELO_K / (1 + prior);
  const myElo = Number(ch.duel_elo || DUELS.ELO_START), theirElo = Number(opponent.duel_elo || DUELS.ELO_START);
  const winnerElo = win ? myElo : theirElo, loserElo = win ? theirElo : myElo;
  const expected = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const delta = Math.max(0, Math.round(kEff * (1 - expected)));
  const winnerNew = winnerElo + delta;
  const loserNew = Math.max(DUELS.ELO_FLOOR, loserElo - delta);
  // absolute writes on the DIRECT-SQL column, under the char locks withTwoCharacters holds
  await client.query('UPDATE characters SET duel_elo=$2 WHERE id=$1', [winner.id, winnerNew]);
  await client.query('UPDATE characters SET duel_elo=$2 WHERE id=$1', [loser.id, loserNew]);
  ch.duel_elo = win ? winnerNew : loserNew; opponent.duel_elo = win ? loserNew : winnerNew;
  await client.query('INSERT INTO duels (id, account_a, account_b, winner_account, day) VALUES ($1,$2,$3,$4,$5)',
    [crypto.randomUUID(), pa, pb, winner.account_id, day]);
  await client.query('UPDATE characters SET duel_at=$2 WHERE id=$1', [ch.id, new Date(Date.now() + cdMs)]);
  ch.duel_at = new Date(Date.now() + cdMs);
  // THE TRADES — the WINNER worked the lethal art (headless h when the passive lister wins: the
  // funnel reads cur by SQL and skips the mirror — the bumpMastery contract)
  await bumpMastery(client, win ? h : null, winner, 'wetwork', 'duel');
  // The lifetime legend needs a real opponent (the WHEEL anti-Sybil floor) AND a NEW one each day:
  // `prior === 0` means this is the first duel against that bloodline today, so the same funded
  // lvl-10 alt can't feed wins at rate-limit speed (AUDIT-slate-drops #2 — the level floor alone
  // bounded WHO you farm, never HOW OFTEN). It reuses the pair/day counter the ELO K-decay already
  // computes, and mirrors the hitman-rep bloodline-diminishing precedent. ELO is unaffected (it
  // already decays); the wager is unaffected (a taxed transfer either way).
  if (prior === 0 && levelOf(Number(loser.respect)) >= DUELS.LEGEND_MIN_LVL)
    await client.query('UPDATE account_persistent SET duel_wins = duel_wins + 1 WHERE account_id=$1', [winner.account_id]);
  // (red-team) report the ACTUAL applied deltas — the floor clamp means the loser may move less
  // than `delta` (or 0 at the floor); persisted values were always right, the report now matches
  const loserApplied = loserNew - loserElo; // ≤ 0
  await notify(client, opponent.id, 'duel_result', { by: ch.name, win: !win, stake: amt,
    elo: Number(opponent.duel_elo), delta: win ? loserApplied : delta });
  await h.track(client, ch.account_id, 'duel', { win, stake: amt, kEff: Math.round(kEff) });
  return { ok: true, win, stake: amt, rake, myScore: Math.round(mine), theirScore: Math.round(theirs),
    elo: Number(ch.duel_elo), delta: win ? delta : loserApplied,
    rank: duelRankOf(ch.duel_elo).title, pairDuelsToday: prior + 1 };
}

// ── the ladder — top living duelists (agents excluded, the status-board posture) ──
export async function duelLeaderboard(pool) {
  const rows = (await pool.query(
    `SELECT c.name, c.respect, c.duel_elo, ap.duel_wins, ap.duel_titles
       FROM characters c
       JOIN account_persistent ap ON ap.account_id = c.account_id
      WHERE c.alive AND NOT ap.agent_flag
      ORDER BY c.duel_elo DESC, c.name LIMIT 20`)).rows;
  // THE TITLES BOARD — a second, DEATH-PROOF ranking on lifetime season championships (the boxing-
  // belt/hitman-rep legend twin — a career axis the raw seasonal ELO can't capture).
  const titled = (await pool.query(
    `SELECT c.name, ap.duel_titles FROM account_persistent ap
       JOIN characters c ON c.account_id = ap.account_id AND c.alive
      WHERE NOT ap.agent_flag AND ap.duel_titles > 0
      ORDER BY ap.duel_titles DESC, c.name LIMIT 10`)).rows;
  return {
    ladder: rows.map((r, i) => ({ pos: i + 1, name: r.name, level: levelOf(Number(r.respect)),
      elo: Number(r.duel_elo), rank: duelRankOf(r.duel_elo).title,
      division: duelDivisionOf(r.duel_elo).name, titles: Number(r.duel_titles || 0),
      lifetimeWins: Number(r.duel_wins || 0) })),
    champions: titled.map((r, i) => ({ pos: i + 1, name: r.name, titles: Number(r.duel_titles),
      rank: duelTitleRankOf(r.duel_titles)?.name || null })),
  };
}

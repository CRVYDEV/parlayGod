// THE FIGHT CIRCUIT — mob boxing (omerta-fight-circuit-design.md). A manager signs ONE contender (a
// persistent owned asset: power/chin/speed + a W/L record), trains them, and stakes them in PvP bouts.
// The bout is the audited `casino:pvp` back-room-dice pattern EXACTLY — a taxed transfer with a vig (half
// → the buyback pool, half burns), NEVER a new cash faucet and NEVER an escrow, so §10.4 stays exact.
// The fighter dies with the street (the business/club precedent — `fighters` joins the runEstate wipe).
import { GameError, bus } from './game.js';
import { BOXING, boxerRankOf, levelOf } from './rules.js';

const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const hospitalized = (ch) => ch.hosp_until && new Date(ch.hosp_until) > new Date();
const injured = (f) => f.injured_until && new Date(f.injured_until) > new Date();
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const form = (f) => Number(f.power) + Number(f.chin) + Number(f.speed);

// Sign a contender — one per manager (re-sign only when you run no fighter). A cash SINK; stats rolled.
export async function recruitFighter(ch, name, client, h) {
  if (jailed(ch)) throw new GameError('jailed', "You can't sign a fighter from a cell.");
  if (levelOf(Number(ch.respect)) < BOXING.MANAGER_MIN_LEVEL)
    throw new GameError('level', `Managing a fighter opens up at level ${BOXING.MANAGER_MIN_LEVEL}.`);
  const n = String(name || '').trim();
  if (n.length < 3 || n.length > 24) throw new GameError('name', "A fighter's name runs 3–24 characters.");
  if (!/^[\w .,'&-]+$/.test(n)) throw new GameError('name', 'Letters, numbers and simple punctuation only.');
  const have = (await client.query('SELECT character_id FROM fighters WHERE character_id=$1 FOR UPDATE', [ch.id])).rows[0];
  if (have) throw new GameError('have_fighter', 'You already manage a contender — one at a time.');
  if (Number(ch.cash) < BOXING.RECRUIT_COST) throw new GameError('cash', `Signing a fighter runs $${BOXING.RECRUIT_COST}.`);
  ch.cash = Number(ch.cash) - BOXING.RECRUIT_COST;
  const power = rand(BOXING.STAT_MIN, BOXING.STAT_MAX), chin = rand(BOXING.STAT_MIN, BOXING.STAT_MAX), speed = rand(BOXING.STAT_MIN, BOXING.STAT_MAX);
  await client.query('INSERT INTO fighters (character_id, name, power, chin, speed) VALUES ($1,$2,$3,$4,$5)', [ch.id, n, power, chin, speed]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -BOXING.RECRUIT_COST, reason: 'boxing:recruit' });
  await h.track(client, ch.account_id, 'boxing_recruit', {});
  return { ok: true, name: n, power, chin, speed };
}

// Train a stat — a cash + energy SINK, +TRAIN_GAIN, capped at STAT_CAP.
export async function trainFighter(ch, stat, client, h) {
  const s = String(stat || '');
  if (!BOXING.STATS.includes(s)) throw new GameError('bad_stat', 'Train power, chin or speed.');
  if (jailed(ch)) throw new GameError('jailed', 'No gym time from lockup.');
  const f = (await client.query('SELECT * FROM fighters WHERE character_id=$1 FOR UPDATE', [ch.id])).rows[0];
  if (!f) throw new GameError('no_fighter', "You don't manage a fighter.");
  if (Number(f[s]) >= BOXING.STAT_CAP) throw new GameError('maxed', `Their ${s} is already maxed (${BOXING.STAT_CAP}).`);
  if (Number(ch.energy) < BOXING.TRAIN_ENERGY) throw new GameError('energy', `Need ${BOXING.TRAIN_ENERGY} energy to run a session.`);
  if (Number(ch.cash) < BOXING.TRAIN_COST) throw new GameError('cash', `A training session runs $${BOXING.TRAIN_COST}.`);
  ch.cash = Number(ch.cash) - BOXING.TRAIN_COST;
  ch.energy = Number(ch.energy) - BOXING.TRAIN_ENERGY;
  const nv = Math.min(BOXING.STAT_CAP, Number(f[s]) + BOXING.TRAIN_GAIN); // absolute write (pg-mem INT-arith quirk)
  await client.query(`UPDATE fighters SET ${s}=$2 WHERE character_id=$1`, [ch.id, nv]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -BOXING.TRAIN_COST, reason: 'boxing:train' });
  await h.track(client, ch.account_id, 'boxing_train', { stat: s });
  return { ok: true, stat: s, value: nv };
}

// List your fighter as TAKING BOUTS at a stake (consent-by-listing, the fade/bodyguard pattern). null clears.
export async function listBout(ch, stake, client, h) {
  const f = (await client.query('SELECT character_id FROM fighters WHERE character_id=$1 FOR UPDATE', [ch.id])).rows[0];
  if (!f) throw new GameError('no_fighter', "You don't manage a fighter.");
  const v = stake == null || Number(stake) === 0 ? null : Math.floor(Number(stake));
  if (v != null && !(Number.isFinite(v) && v >= BOXING.MIN_STAKE && v <= BOXING.MAX_STAKE))
    throw new GameError('stake', `Bout stakes run $${BOXING.MIN_STAKE}–$${BOXING.MAX_STAKE} (0 clears).`);
  await client.query('UPDATE fighters SET bout_limit=$2 WHERE character_id=$1', [ch.id, v]);
  return { ok: true, boutLimit: v };
}

// FIGHT — the challenger's fighter vs a listed fighter, both stake the purse; the winner takes it minus the
// vig (half → the buyback pool, half burns — the casino:pvp split). Two-party. Score = form + rand(VARIANCE),
// ties reroll. The LOSER's fighter is laid up (no spam). A pure taxed TRANSFER — §10.4-exact per character.
export async function fightBout(ch, opponent, stake, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No fight nights from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp', "You're in no shape to work a corner.");
  if (opponent.id === ch.id) throw new GameError('self', "You don't fight your own contender.");
  if (h.owned.gangId && h.victimOwned.gangId === h.owned.gangId) throw new GameError('family', "They're family — no family matchups.");
  const amt = Math.floor(Number(stake));
  if (!(Number.isFinite(amt) && amt >= BOXING.MIN_STAKE)) throw new GameError('min', `The minimum purse is $${BOXING.MIN_STAKE}.`);
  // lock both fighter rows in sorted character-id order (the char rows are already locked by withTwoCharacters,
  // which serialises any overlapping bout — this is belt-and-suspenders leaf ordering, no cycle)
  const [first, second] = [ch.id, opponent.id].sort();
  await client.query('SELECT 1 FROM fighters WHERE character_id=$1 FOR UPDATE', [first]);
  await client.query('SELECT 1 FROM fighters WHERE character_id=$1 FOR UPDATE', [second]);
  const f = (await client.query('SELECT * FROM fighters WHERE character_id=$1', [ch.id])).rows[0];
  const of = (await client.query('SELECT * FROM fighters WHERE character_id=$1', [opponent.id])).rows[0];
  if (!f) throw new GameError('no_fighter', "You don't manage a fighter.");
  if (!of) throw new GameError('no_opponent', "They don't manage a fighter.");
  // the counterparty must be available (the casino:pvp precedent — no draining a manager who's in lockup
  // or laid up in the hospital and can't call it off, even though they consented by listing)
  if (jailed(opponent) || hospitalized(opponent)) throw new GameError('unavailable', "Their manager can't make a match right now.");
  const limit = of.bout_limit != null ? Math.floor(Number(of.bout_limit)) : 0;
  if (!(limit > 0)) throw new GameError('not_listed', "Their fighter isn't taking bouts.");
  if (amt > limit) throw new GameError('limit', `Their fighter takes bouts up to $${limit}.`);
  if (injured(f)) throw new GameError('injured_self', 'Your fighter is laid up — let them heal.');
  if (injured(of)) throw new GameError('injured_them', 'Their fighter is laid up right now.');
  if (Number(ch.cash) < amt) throw new GameError('cash', 'Not that much in pocket for the purse.');
  if (Number(opponent.cash) < amt) throw new GameError('their_cash', "They can't cover the purse right now.");
  let mine, theirs;
  do { mine = form(f) + rand(0, BOXING.VARIANCE); theirs = form(of) + rand(0, BOXING.VARIANCE); } while (mine === theirs);
  const win = mine > theirs;
  const pot = amt * 2;
  const rake = Math.ceil(pot * BOXING.RAKE_BPS / 10000);
  const winner = win ? ch : opponent, loser = win ? opponent : ch;
  const winnerF = win ? f : of, loserF = win ? of : f;
  loser.cash = Number(loser.cash) - amt;
  winner.cash = Number(winner.cash) + amt - rake; // their own stake never left; net +stake − rake (the casino:pvp accounting)
  await h.ledger(client, { characterId: loser.id, currency: 'cash', amount: -amt, reason: 'boxing:bout', counterparty: winner.id });
  await h.ledger(client, { characterId: winner.id, currency: 'cash', amount: amt - rake, reason: 'boxing:bout', counterparty: loser.id });
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [Math.floor(rake / 2)]); // half → the buyback, half burns (the casino:pvp split)
  // records + injury — absolute INT writes (pg-mem arithmetic-UPDATE quirk)
  await client.query('UPDATE fighters SET wins=$2 WHERE character_id=$1', [winner.id, Number(winnerF.wins) + 1]);
  await client.query('UPDATE fighters SET losses=$2, injured_until=$3 WHERE character_id=$1',
    [loser.id, Number(loserF.losses) + 1, new Date(Date.now() + BOXING.INJURY_MS)]);
  await h.rngLog(client, ch.id, `boxing:bout:${opponent.id}`, mine, `${win ? 'win' : 'loss'} $${amt} (${mine} vs ${theirs})`);
  await h.notify(client, opponent.id, 'boxing_bout', { from: ch.name, yours: of.name, mine: f.name, amount: amt, theyWon: !win });
  bus.emit('streets', { type: 'boxing_bout', by: ch.name, fighters: `${f.name} v ${of.name}`, amount: pot, win });
  await h.track(client, ch.account_id, 'boxing_bout', { amt, win });
  return { ok: true, win, purse: amt, rake, net: win ? amt - rake : -amt,
    you: { name: f.name, score: mine }, them: { name: of.name, score: theirs },
    yourFighter: win ? `${Number(f.wins) + 1}-${f.losses}` : `${f.wins}-${Number(f.losses) + 1}` };
}

// the manager's fighter summary (loadOwned + the character view). null if they run no fighter.
export async function fighterOf(pool, characterId) {
  const f = (await pool.query('SELECT * FROM fighters WHERE character_id=$1', [characterId])).rows[0];
  if (!f) return null;
  return { name: f.name, power: Number(f.power), chin: Number(f.chin), speed: Number(f.speed),
    form: form(f), wins: Number(f.wins), losses: Number(f.losses), rank: boxerRankOf(f.wins).name,
    boutLimit: f.bout_limit == null ? null : Math.floor(Number(f.bout_limit)),
    injuredSeconds: injured(f) ? Math.ceil((new Date(f.injured_until).getTime() - Date.now()) / 1000) : 0 };
}

// GET /v1/boxing — your fighter + the circuit (every fighter taking bouts, living managers), ranked by record.
export async function boxingBoard(pool, characterId) {
  const rows = (await pool.query(
    `SELECT f.character_id, f.name, f.power, f.chin, f.speed, f.wins, f.losses, f.injured_until, f.bout_limit, c.name AS manager
       FROM fighters f JOIN characters c ON c.id = f.character_id AND c.alive`)).rows;
  const circuit = rows.map((f) => ({
    characterId: f.character_id, // the opponent id for a match (targeting only — records/stats are public)
    manager: f.manager, name: f.name, form: form(f), record: `${Number(f.wins)}-${Number(f.losses)}`,
    wins: Number(f.wins), rank: boxerRankOf(f.wins).name, mine: f.character_id === characterId,
    boutLimit: f.bout_limit == null ? null : Math.floor(Number(f.bout_limit)),
    injured: !!(f.injured_until && new Date(f.injured_until) > new Date()),
    taking: f.bout_limit != null && !(f.injured_until && new Date(f.injured_until) > new Date()) && f.character_id !== characterId,
  })).sort((a, b) => b.wins - a.wins || b.form - a.form);
  const you = rows.find((f) => f.character_id === characterId) || null;
  return {
    yours: you ? { name: you.name, power: Number(you.power), chin: Number(you.chin), speed: Number(you.speed),
      form: form(you), record: `${Number(you.wins)}-${Number(you.losses)}`, rank: boxerRankOf(you.wins).name,
      boutLimit: you.bout_limit == null ? null : Math.floor(Number(you.bout_limit)),
      injuredSeconds: (you.injured_until && new Date(you.injured_until) > new Date()) ? Math.ceil((new Date(you.injured_until).getTime() - Date.now()) / 1000) : 0 } : null,
    circuit,
    recruitCost: BOXING.RECRUIT_COST, trainCost: BOXING.TRAIN_COST, minLevel: BOXING.MANAGER_MIN_LEVEL,
    minStake: BOXING.MIN_STAKE, maxStake: BOXING.MAX_STAKE, statCap: BOXING.STAT_CAP, stats: BOXING.STATS,
  };
}

// GET /v1/leaderboard/boxing — the circuit's top fighters by record (living managers). A status board.
export async function boxingLeaderboard(pool, characterId) {
  const rows = (await pool.query(
    `SELECT f.character_id, f.name, f.wins, f.losses, f.power, f.chin, f.speed, c.name AS manager
       FROM fighters f JOIN characters c ON c.id = f.character_id AND c.alive`)).rows;
  const board = rows.map((f) => ({ fighter: f.name, manager: f.manager, record: `${Number(f.wins)}-${Number(f.losses)}`,
    wins: Number(f.wins), form: form(f), rank: boxerRankOf(f.wins).name, you: f.character_id === characterId }))
    .filter((x) => x.wins > 0 || x.form > 0).sort((a, b) => b.wins - a.wins || b.form - a.form).slice(0, 15);
  return { board };
}

// estate hook — a dead manager's fighter is done (character-level, dies with the street). Called from runEstate.
export async function wipeFighterAtDeath(client, characterId) {
  await client.query('DELETE FROM fighters WHERE character_id=$1', [characterId]);
}

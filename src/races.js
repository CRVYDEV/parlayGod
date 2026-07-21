// STREET RACES (omerta-street-races-design) — the deep 60-car catalog becomes a competitive loop.
// A car's RACE POWER = sqrt(book value) + tune + the wheelman's speed − damage (rules.js:carPower), so
// fast/valuable iron wins but tuning + skill decide close races. Three loops, all CASH (the Den's rule):
//   • the PvE CIRCUIT (raceNpc) — pay a fee (BURNS win/lose, a §10.4 sink), beat the NPC field for a
//     bounded PURSE (a faucet on a win — the boxing-exhibition precedent; sim-gated).
//   • PvP WAGER races (raceChallenge, two-party) — the audited casino:pvp taxed transfer: winner takes
//     the pot − a 5% rake (half → street tax/buyback, half burns), the loser's car takes damage. NO escrow.
//   • TUNING (tuneCar) — a cash sink that adds race power (the car-progression the catalog lacked).
// Lifetime wins are THE WHEEL — an account-level legend that SURVIVES DEATH (the boxing-legend precedent).
import { GameError, bus } from './game.js';
import { RACES, raceTierOf, raceRankOf, carPower, carVal, levelOf } from './rules.js';

const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const hospitalized = (ch) => ch.hosp_until && new Date(ch.hosp_until) > new Date();
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const raceCdMs = () => (process.env.RACE_CD_MS != null ? Number(process.env.RACE_CD_MS) : RACES.CD_MS); // TEST-ONLY knob (SEARCH_MS precedent)
const bumpWheel = (client, accountId) => // lifetime race wins (status, survives death — literal +1 is pg-mem-safe)
  client.query('UPDATE account_persistent SET race_wins = race_wins + 1 WHERE account_id=$1', [accountId]);
// a raceable car the actor owns (not on the Black Market block, not pledged as loan collateral)
const raceable = (h, carId) => {
  const car = h.owned.cars.find((c) => c.id === carId);
  if (!car) throw new GameError('no_car', 'No such car in your garage.');
  if (car.listed) throw new GameError('unavailable', "It's on the block — pull the listing to race it.");
  if (car.pledged) throw new GameError('unavailable', "It's pledged as collateral — square the loan first.");
  return car;
};

// POST /v1/races/npc {car, tier} — the PvE circuit. Fee BURNS win/lose; a win pays the bounded purse.
export async function raceNpc(ch, carId, tierId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No racing from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp', "You're in no shape to drive — see the Doc.");
  const lvl = levelOf(Number(ch.respect));
  if (lvl < RACES.MIN_LEVEL) throw new GameError('level', `Racing takes level ${RACES.MIN_LEVEL}.`);
  const tier = raceTierOf(tierId);
  if (!tier) throw new GameError('bad_tier', 'No such race on the card.');
  if (lvl < tier.minLvl) throw new GameError('tier_level', `${tier.name} runs at level ${tier.minLvl}.`);
  const now = new Date();
  if (ch.race_at && new Date(ch.race_at) > now) throw new GameError('cooldown', 'Your ride needs to cool down before the next run.');
  const car = raceable(h, carId);
  if (Number(ch.cash) < tier.fee) throw new GameError('cash', `The buy-in is $${tier.fee}.`);
  // the fee burns (a §10.4 cash sink) win or lose; stamp the cooldown (direct SQL — outside persist)
  ch.cash = Number(ch.cash) - tier.fee;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -tier.fee, reason: 'race:fee' });
  await client.query('UPDATE characters SET race_at=$2 WHERE id=$1', [ch.id, new Date(now.getTime() + raceCdMs())]);
  const power = carPower(car.model_id, car.trim_id, car.tune, ch.speed, car.dmg);
  const mine = power + rand(0, RACES.VARIANCE), field = tier.fieldPower + rand(0, RACES.VARIANCE);
  const win = mine > field;
  await h.rngLog(client, ch.id, `race:npc:${tier.id}`, mine, `${win ? 'win' : 'loss'} (${mine} vs ${field})`);
  if (win) {
    ch.cash = Number(ch.cash) + tier.purse; // the PURSE — a bounded faucet, only on a win
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: tier.purse, reason: 'race:purse' });
    await bumpWheel(client, ch.account_id);
    await h.track(client, ch.account_id, 'race', { mode: 'npc', tier: tier.id, win: true });
    bus.emit('streets', { type: 'race_win', by: ch.name, race: tier.name, purse: tier.purse });
    return { ok: true, win: true, tier: tier.id, purse: tier.purse, fee: tier.fee, net: tier.purse - tier.fee, power: mine, field };
  }
  // a loss dings the car (the existing damage mechanic — absolute write, pg-mem-safe)
  const nd = Math.min(100, Number(car.dmg) + RACES.LOSS_DMG);
  await client.query('UPDATE cars SET dmg=$2 WHERE id=$1', [car.id, nd]);
  car.dmg = nd;
  await h.track(client, ch.account_id, 'race', { mode: 'npc', tier: tier.id, win: false });
  return { ok: true, win: false, tier: tier.id, fee: tier.fee, net: -tier.fee, dmg: nd, power: mine, field };
}

// POST /v1/races/tune/:carId — spend cash to add a tune level (a §10.4 sink + car progression).
export async function tuneCar(ch, carId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No shop time from lockup.');
  const car = raceable(h, carId);
  if (Number(car.tune) >= RACES.TUNE_MAX) throw new GameError('maxed', `That engine is already maxed (${RACES.TUNE_MAX}).`);
  if (Number(ch.cash) < RACES.TUNE_COST) throw new GameError('cash', `A tune costs $${RACES.TUNE_COST}.`);
  ch.cash = Number(ch.cash) - RACES.TUNE_COST;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -RACES.TUNE_COST, reason: 'race:tune' });
  const nt = Number(car.tune) + 1;
  await client.query('UPDATE cars SET tune=$2 WHERE id=$1', [car.id, nt]);
  car.tune = nt;
  await h.track(client, ch.account_id, 'race', { mode: 'tune', tune: nt });
  return { ok: true, tune: nt, spent: RACES.TUNE_COST, power: carPower(car.model_id, car.trim_id, nt, ch.speed, car.dmg) };
}

// POST /v1/races/list/:carId {limit} — put a car on the strip to race for a wager up to `limit`
// (consent-by-listing, the fade/bout pattern). POST /v1/races/unlist/:carId pulls it.
export async function listRace(ch, carId, limit, client, h) {
  const car = raceable(h, carId);
  const lim = Math.floor(Number(limit));
  if (!(Number.isFinite(lim) && lim >= RACES.WAGER_MIN)) throw new GameError('limit', `The floor is $${RACES.WAGER_MIN}.`);
  const cap = Math.min(lim, RACES.WAGER_MAX);
  await client.query('UPDATE cars SET race_limit=$2 WHERE id=$1', [car.id, cap]);
  car.race_limit = cap;
  return { ok: true, carId: car.id, limit: cap };
}
export async function unlistRace(ch, carId, client, h) {
  const car = raceable(h, carId);
  await client.query('UPDATE cars SET race_limit=NULL WHERE id=$1', [car.id]);
  car.race_limit = null;
  return { ok: true, carId: car.id };
}

// POST /v1/races/challenge/:ownerId {myCar, theirCar, wager} — a PvP wager race (two-party, the
// audited casino:pvp taxed transfer, NO escrow — one atomic txn). withTwoCharacters(challenger, owner).
export async function raceChallenge(ch, opponent, body, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No racing from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp', "You're in no shape to drive.");
  if (opponent.id === ch.id) throw new GameError('self', "You don't race your own garage.");
  if (h.owned.gangId && h.victimOwned.gangId === h.owned.gangId) throw new GameError('family', 'No racing family for money.');
  if (jailed(opponent) || hospitalized(opponent)) throw new GameError('unavailable', "They can't make the start line right now.");
  const amt = Math.floor(Number(body?.wager));
  if (!(Number.isFinite(amt) && amt >= RACES.WAGER_MIN)) throw new GameError('min', `The minimum wager is $${RACES.WAGER_MIN}.`);
  if (amt > RACES.WAGER_MAX) throw new GameError('max', `The strip caps wagers at $${RACES.WAGER_MAX}.`);
  const now = new Date();
  if (ch.race_at && new Date(ch.race_at) > now) throw new GameError('cooldown', 'Your ride needs to cool down before the next run.');
  // lock the two car rows in sorted id order (leaf ordering; the char rows are already locked)
  const [first, second] = [String(body?.myCar || ''), String(body?.theirCar || '')].sort();
  await client.query('SELECT 1 FROM cars WHERE id=$1 FOR UPDATE', [first]);
  await client.query('SELECT 1 FROM cars WHERE id=$1 FOR UPDATE', [second]);
  const my = (await client.query('SELECT * FROM cars WHERE id=$1', [body?.myCar])).rows[0];
  const their = (await client.query('SELECT * FROM cars WHERE id=$1', [body?.theirCar])).rows[0];
  if (!my || my.character_id !== ch.id) throw new GameError('no_car', 'Pick one of your own cars.');
  if (!their || their.character_id !== opponent.id) throw new GameError('no_opponent_car', "That car isn't in their garage.");
  if (my.listed || my.pledged) throw new GameError('unavailable', "Your car is on the block or pledged.");
  if (their.listed || their.pledged) throw new GameError('their_unavailable', 'Their car is on the block or pledged.');
  const limit = their.race_limit != null ? Math.floor(Number(their.race_limit)) : 0;
  if (!(limit > 0)) throw new GameError('not_listed', "Their car isn't taking races.");
  if (amt > limit) throw new GameError('limit', `They race that car up to $${limit}.`);
  if (Number(ch.cash) < amt) throw new GameError('cash', 'Not that much in pocket for the wager.');
  if (Number(opponent.cash) < amt) throw new GameError('their_cash', "They can't cover the wager right now.");
  let mine, theirs;
  const mp = carPower(my.model_id, my.trim_id, my.tune, ch.speed, my.dmg);
  const tp = carPower(their.model_id, their.trim_id, their.tune, opponent.speed, their.dmg);
  do { mine = mp + rand(0, RACES.VARIANCE); theirs = tp + rand(0, RACES.VARIANCE); } while (mine === theirs);
  const win = mine > theirs;
  const pot = amt * 2;
  const rake = Math.ceil(pot * RACES.RAKE_BPS / 10000);
  const winner = win ? ch : opponent, loser = win ? opponent : ch;
  const winCar = win ? my : their, loseCar = win ? their : my;
  loser.cash = Number(loser.cash) - amt;
  winner.cash = Number(winner.cash) + amt - rake; // their own wager never left; net +wager − rake (casino:pvp)
  await h.ledger(client, { characterId: loser.id, currency: 'cash', amount: -amt, reason: 'race:wager', counterparty: winner.id });
  await h.ledger(client, { characterId: winner.id, currency: 'cash', amount: amt - rake, reason: 'race:wager', counterparty: loser.id });
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [Math.floor(rake / 2)]); // half → the buyback, half burns
  // the loser's car takes damage (absolute write); the challenger's ride cools down
  const nd = Math.min(100, Number(loseCar.dmg) + RACES.LOSS_DMG);
  await client.query('UPDATE cars SET dmg=$2 WHERE id=$1', [loseCar.id, nd]);
  await client.query('UPDATE characters SET race_at=$2 WHERE id=$1', [ch.id, new Date(now.getTime() + raceCdMs())]);
  await bumpWheel(client, winner.account_id);
  await h.rngLog(client, ch.id, `race:pvp:${their.id}`, mine, `${win ? 'win' : 'loss'} $${amt} (${mine} vs ${theirs})`);
  await h.notify(client, opponent.id, 'race_pvp', { from: ch.name, amount: amt, theyWon: !win });
  bus.emit('streets', { type: 'race_pvp', by: ch.name, vs: opponent.name, amount: pot, win });
  await h.track(client, ch.account_id, 'race', { mode: 'pvp', amt, win });
  return { ok: true, win, wager: amt, rake, net: win ? amt - rake : -amt,
    you: { car: winCar === my ? my.model_id : my.model_id, score: mine }, them: { score: theirs } };
}

// GET /v1/races — the strip: your cars (power + tune + listing), the PvE card, the open PvP field, your legend.
export async function raceBoard(ch, client, h) {
  const now = Date.now();
  const cars = (h.owned.cars || []).filter((c) => !c.listed && !c.pledged).map((c) => ({
    id: c.id, model: c.model_id, trim: c.trim_id, dmg: Number(c.dmg), tune: Number(c.tune || 0),
    power: carPower(c.model_id, c.trim_id, c.tune, ch.speed, c.dmg),
    raceLimit: c.race_limit != null ? Math.floor(Number(c.race_limit)) : null,
  }));
  // the open strip — other players' listed cars (a power BAND, never the exact figure; the convoy-band rule)
  const strip = (await client.query(
    `SELECT c.id, c.model_id, c.trim_id, c.tune, c.dmg, c.race_limit, c.character_id, o.name owner, o.speed
       FROM cars c JOIN characters o ON o.id = c.character_id AND o.alive
      WHERE c.race_limit IS NOT NULL AND c.character_id <> $1 AND NOT c.listed AND NOT c.pledged
      ORDER BY c.race_limit DESC LIMIT 30`, [ch.id])).rows.map((r) => {
    const p = carPower(r.model_id, r.trim_id, r.tune, r.speed, r.dmg);
    return { ownerId: r.character_id, owner: r.owner, carId: r.id, model: r.model_id, limit: Math.floor(Number(r.race_limit)),
      band: p >= 500 ? 'a monster' : p >= 250 ? 'serious iron' : p >= 100 ? 'quick' : 'a runabout' };
  });
  const wins = Number((await client.query('SELECT race_wins FROM account_persistent WHERE account_id=$1', [ch.account_id])).rows[0]?.race_wins || 0);
  const cdLeft = ch.race_at && new Date(ch.race_at).getTime() > now ? Math.ceil((new Date(ch.race_at).getTime() - now) / 1000) : 0;
  return {
    cars, strip,
    tiers: RACES.TIERS.map((t) => ({ id: t.id, name: t.name, minLvl: t.minLvl, fee: t.fee, purse: t.purse, fieldPower: t.fieldPower })),
    tune: { cost: RACES.TUNE_COST, max: RACES.TUNE_MAX }, wager: { min: RACES.WAGER_MIN, max: RACES.WAGER_MAX },
    legend: { wins, rank: raceRankOf(wins).name }, cooldownSeconds: cdLeft,
  };
}

// GET /v1/leaderboard/races — THE WHEEL: the base's winningest drivers (account-level, survives death).
export async function raceLeaderboard(pool) {
  const rows = (await pool.query(
    `SELECT a.race_wins, c.name FROM account_persistent a JOIN characters c ON c.account_id=a.account_id AND c.alive
      WHERE a.race_wins > 0 ORDER BY a.race_wins DESC LIMIT 15`)).rows;
  return { drivers: rows.map((r) => ({ name: r.name, wins: Number(r.race_wins), rank: raceRankOf(r.race_wins).name })) };
}

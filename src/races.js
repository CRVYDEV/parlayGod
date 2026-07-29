// STREET RACES (omerta-street-races-design) — the deep 60-car catalog becomes a competitive loop.
// A car's RACE POWER = sqrt(book value) + tune + the wheelman's speed − damage (rules.js:carPower), so
// fast/valuable iron wins but tuning + skill decide close races. Three loops, all CASH (the Den's rule):
//   • the PvE CIRCUIT (raceNpc) — pay a fee (BURNS win/lose, a §10.4 sink), beat the NPC field for a
//     bounded PURSE (a faucet on a win — the boxing-exhibition precedent; sim-gated).
//   • PvP WAGER races (raceChallenge, two-party) — the audited casino:pvp taxed transfer: winner takes
//     the pot − a 5% rake (half → street tax/buyback, half burns), the loser's car takes damage. NO escrow.
//   • TUNING (tuneCar) — a cash sink that adds race power (the car-progression the catalog lacked).
// Lifetime wins are THE WHEEL — an account-level legend that SURVIVES DEATH (the boxing-legend precedent).
import crypto from 'node:crypto';
import { GameError, bus, ledger, notify, rngLog, bumpMastery } from './game.js';
import { RACES, raceTierOf, raceRankOf, carPower, carVal, levelOf } from './rules.js';
import { logCarCollect } from './collection.js';

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
// step 2 — spend one NITROUS charge on the actor's OWN car for a one-race power bump (consumed win/lose).
// Absolute write (pg-mem INT-arithmetic quirk). Returns the power bonus (0 if not used / no charge).
async function spendNos(client, car, use) {
  if (!use || Number(car.nos || 0) <= 0) return 0;
  const nn = Number(car.nos) - 1;
  await client.query('UPDATE cars SET nos=$2 WHERE id=$1', [car.id, nn]);
  car.nos = nn;
  return RACES.NOS_POWER;
}

// POST /v1/races/npc {car, tier, nos} — the PvE circuit. Fee BURNS win/lose; a win pays the bounded purse.
export async function raceNpc(ch, carId, tierId, useNos, client, h) {
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
  const nos = await spendNos(client, car, useNos); // step 2 — one-race nitrous bump (consumed win/lose)
  const power = carPower(car.model_id, car.trim_id, car.tune, ch.speed, car.dmg);
  const mine = power + nos + rand(0, RACES.VARIANCE), field = tier.fieldPower + rand(0, RACES.VARIANCE);
  const win = mine > field;
  await h.rngLog(client, ch.id, `race:npc:${tier.id}`, mine, `${win ? 'win' : 'loss'}${nos ? ' +nos' : ''} (${mine} vs ${field})`);
  await bumpMastery(client, h, ch, 'wheels', 'race'); // THE TRADES — seat time, win or lose (the cooldown is the throttle)
  if (win) {
    ch.cash = Number(ch.cash) + tier.purse; // the PURSE — a bounded faucet, only on a win
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: tier.purse, reason: 'race:purse' });
    await bumpWheel(client, ch.account_id);
    await h.track(client, ch.account_id, 'race', { mode: 'npc', tier: tier.id, win: true });
    bus.emit('streets', { type: 'race_win', by: ch.name, race: tier.name, purse: tier.purse });
    return { ok: true, win: true, tier: tier.id, purse: tier.purse, fee: tier.fee, net: tier.purse - tier.fee, power: mine, field, nos: nos > 0 };
  }
  // a loss dings the car (the existing damage mechanic — absolute write, pg-mem-safe)
  const nd = Math.min(100, Number(car.dmg) + RACES.LOSS_DMG);
  await client.query('UPDATE cars SET dmg=$2 WHERE id=$1', [car.id, nd]);
  car.dmg = nd;
  await h.track(client, ch.account_id, 'race', { mode: 'npc', tier: tier.id, win: false });
  return { ok: true, win: false, tier: tier.id, fee: tier.fee, net: -tier.fee, dmg: nd, power: mine, field, nos: nos > 0 };
}

// POST /v1/races/nos/:carId — buy a NITROUS charge for a car (a §10.4 cash sink; capped NOS_MAX).
export async function buyNos(ch, carId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No shop time from lockup.');
  const car = raceable(h, carId);
  if (Number(car.nos || 0) >= RACES.NOS_MAX) throw new GameError('maxed', `That car already holds ${RACES.NOS_MAX} charges.`);
  if (Number(ch.cash) < RACES.NOS_COST) throw new GameError('cash', `A nitrous charge costs $${RACES.NOS_COST}.`);
  ch.cash = Number(ch.cash) - RACES.NOS_COST;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -RACES.NOS_COST, reason: 'race:nos' });
  const nn = Number(car.nos || 0) + 1;
  await client.query('UPDATE cars SET nos=$2 WHERE id=$1', [car.id, nn]); // absolute write (pg-mem-safe)
  car.nos = nn;
  await h.track(client, ch.account_id, 'race', { mode: 'nos', charges: nn });
  return { ok: true, carId: car.id, nos: nn, spent: RACES.NOS_COST };
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

// POST /v1/races/pinkslip/:carId {on} — offer (or pull) a car for PINKS. When on, any challenger can
// race you for the title: the winner TAKES the loser's car. Consent-by-listing (the fade/bout pattern).
export async function pinkSlipList(ch, carId, on, client, h) {
  const car = raceable(h, carId);
  const flag = on !== false; // default on; explicit false pulls it
  await client.query('UPDATE cars SET pink_slip=$2 WHERE id=$1', [car.id, flag]);
  car.pink_slip = flag;
  return { ok: true, carId: car.id, pinkSlip: flag };
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
  const nos = await spendNos(client, my, body?.nos); // step 2 — the challenger may burn one nitrous charge (their own car only; the passive owner's isn't touched without consent)
  const mp = carPower(my.model_id, my.trim_id, my.tune, ch.speed, my.dmg) + nos;
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
  // cool down the CHALLENGER (they initiated, win or lose) AND the WINNER — so an owner-account can't be
  // fed WHEEL wins by disposable alt challengers with no throttle of its own (audit LOW-1). A losing owner
  // is NOT cooled: no win to farm, and it can't be griefed into a lockout by spam challenges.
  const cd = new Date(now.getTime() + raceCdMs());
  await client.query('UPDATE characters SET race_at=$2 WHERE id=$1', [ch.id, cd]);
  if (winner.id !== ch.id) await client.query('UPDATE characters SET race_at=$2 WHERE id=$1', [winner.id, cd]);
  await bumpMastery(client, h, ch, 'wheels', 'race'); // THE TRADES — the challenger raced (the same cooldown throttles)
  // THE WHEEL credit only lands when the LOSER is a real racer (level floor) — AUDIT-full-system-v2
  // F-MED1: the winner-cooldown alone was inert (the cooldown gate checks the CHALLENGER, and the bump
  // fired regardless), so a ring of disposable low-level alts could pad an owner's status board by
  // deliberately losing. A level floor on the loser is the WANTED_MIN_LVL / npcHit-rookie-floor anti-Sybil
  // pattern — farming now costs the ring a real respect grind per alt. The wager/rake still move (a taxed
  // transfer); only the cosmetic WHEEL credit is gated.
  if (levelOf(Number(loser.respect)) >= RACES.WHEEL_MIN_LVL) await bumpWheel(client, winner.account_id);
  await h.rngLog(client, ch.id, `race:pvp:${their.id}`, mine, `${win ? 'win' : 'loss'} $${amt} (${mine} vs ${theirs})`);
  await h.notify(client, opponent.id, 'race_pvp', { from: ch.name, amount: amt, theyWon: !win });
  bus.emit('streets', { type: 'race_pvp', by: ch.name, vs: opponent.name, amount: pot, win });
  await h.track(client, ch.account_id, 'race', { mode: 'pvp', amt, win });
  return { ok: true, win, wager: amt, rake, net: win ? amt - rake : -amt,
    you: { car: winCar === my ? my.model_id : my.model_id, score: mine }, them: { score: theirs } };
}

// POST /v1/races/pinkslip/:ownerId {myCar, theirCar, nos} — a PINK-SLIP race: the winner TAKES the loser's
// raced car. §10.4-NEUTRAL (an ownership transfer — cars conserve by ROW COUNT, no ledger — the chop/market-
// seize precedent; can push the winner past GARAGE_CAP, the market-win precedent). withTwoCharacters. The
// challenger stakes `myCar` by racing; the owner consents by pink-slip-listing `theirCar`. No cash moves.
export async function pinkSlipRace(ch, opponent, body, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No racing from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp', "You're in no shape to drive.");
  if (opponent.id === ch.id) throw new GameError('self', "You don't race your own garage.");
  if (h.owned.gangId && h.victimOwned.gangId === h.owned.gangId) throw new GameError('family', 'No taking family iron.');
  if (jailed(opponent) || hospitalized(opponent)) throw new GameError('unavailable', "They can't make the start line right now.");
  const now = new Date();
  if (ch.race_at && new Date(ch.race_at) > now) throw new GameError('cooldown', 'Your ride needs to cool down before the next run.');
  const [first, second] = [String(body?.myCar || ''), String(body?.theirCar || '')].sort();
  await client.query('SELECT 1 FROM cars WHERE id=$1 FOR UPDATE', [first]);
  await client.query('SELECT 1 FROM cars WHERE id=$1 FOR UPDATE', [second]);
  const my = (await client.query('SELECT * FROM cars WHERE id=$1', [body?.myCar])).rows[0];
  const their = (await client.query('SELECT * FROM cars WHERE id=$1', [body?.theirCar])).rows[0];
  if (!my || my.character_id !== ch.id) throw new GameError('no_car', 'Pink-slip one of your own cars.');
  if (!their || their.character_id !== opponent.id) throw new GameError('no_opponent_car', "That car isn't in their garage.");
  if (my.listed || my.pledged) throw new GameError('unavailable', "Your car is on the block or pledged — can't put it up for pinks.");
  if (their.listed || their.pledged) throw new GameError('their_unavailable', 'Their car is on the block or pledged.');
  if (!their.pink_slip) throw new GameError('not_offered', "That car isn't up for pinks.");
  let mine, theirs;
  const nos = await spendNos(client, my, body?.nos); // the challenger may burn one nitrous charge on their own car
  const mp = carPower(my.model_id, my.trim_id, my.tune, ch.speed, my.dmg) + nos;
  const tp = carPower(their.model_id, their.trim_id, their.tune, opponent.speed, their.dmg);
  do { mine = mp + rand(0, RACES.VARIANCE); theirs = tp + rand(0, RACES.VARIANCE); } while (mine === theirs);
  const win = mine > theirs;
  const winner = win ? ch : opponent, loser = win ? opponent : ch;
  const wonCar = win ? their : my, lostBy = loser; // the LOSER's raced car changes hands to the winner
  // TRANSFER the loser's car to the winner — reset listings/pinks/nitrous on the new title (§10.4-neutral,
  // no ledger row; car conservation counts rows). The winner may exceed GARAGE_CAP (the market-win precedent).
  await client.query('UPDATE cars SET character_id=$2, race_limit=NULL, pink_slip=false, nos=0 WHERE id=$1', [wonCar.id, winner.id]);
  await logCarCollect(client, winner.id, wonCar.id); // THE COLLECTION
  // keep the actor's in-memory garage honest for this response (the next view reload is authoritative)
  if (winner.id === ch.id) { const w = { ...wonCar, character_id: ch.id, race_limit: null, pink_slip: false, nos: 0 }; h.owned.cars.push(w); }
  else h.owned.cars = (h.owned.cars || []).filter((c) => c.id !== wonCar.id);
  // cool down the challenger (win or lose) AND the winner (so an owner-account can't be fed WHEEL wins by
  // alt challengers throwing junk cars — the raceChallenge LOW-1 posture); a losing owner isn't cooled.
  const cd = new Date(now.getTime() + raceCdMs());
  await client.query('UPDATE characters SET race_at=$2 WHERE id=$1', [ch.id, cd]);
  if (winner.id !== ch.id) await client.query('UPDATE characters SET race_at=$2 WHERE id=$1', [winner.id, cd]);
  // WHEEL credit gated on the loser's level (anti-Sybil — the raceChallenge floor; a pink win is already a
  // real car-cost play, but keep the status floor consistent so a ring can't pad the board with junk iron).
  if (levelOf(Number(loser.respect)) >= RACES.WHEEL_MIN_LVL) await bumpWheel(client, winner.account_id);
  await h.rngLog(client, ch.id, `race:pink:${their.id}`, mine, `${win ? 'win' : 'loss'}${nos ? ' +nos' : ''} for pinks (${mine} vs ${theirs})`);
  await h.notify(client, opponent.id, 'race_pink', { from: ch.name, theyWon: !win, car: wonCar.model_id });
  bus.emit('streets', { type: 'race_pink', by: ch.name, vs: opponent.name, win });
  await h.track(client, ch.account_id, 'race', { mode: 'pink', win });
  return { ok: true, win, forPinks: true, wonCar: win ? { id: wonCar.id, model: wonCar.model_id } : null,
    lostCar: win ? null : { id: wonCar.id, model: wonCar.model_id }, you: mine, them: theirs };
}

// GET /v1/races — the strip: your cars (power + tune + listing), the PvE card, the open PvP field, your legend.
export async function raceBoard(ch, client, h) {
  const now = Date.now();
  const cars = (h.owned.cars || []).filter((c) => !c.listed && !c.pledged).map((c) => ({
    id: c.id, model: c.model_id, trim: c.trim_id, dmg: Number(c.dmg), tune: Number(c.tune || 0),
    power: carPower(c.model_id, c.trim_id, c.tune, ch.speed, c.dmg),
    raceLimit: c.race_limit != null ? Math.floor(Number(c.race_limit)) : null,
    pinkSlip: !!c.pink_slip, nos: Number(c.nos || 0),
  }));
  // the open strip — other players' cars taking a race (cash wager OR pinks). A power BAND, never the exact
  // figure (the convoy-band rule); `forPinks` flags the ones you can race for the title.
  const strip = (await client.query(
    `SELECT c.id, c.model_id, c.trim_id, c.tune, c.dmg, c.race_limit, c.pink_slip, c.character_id, o.name owner, o.speed
       FROM cars c JOIN characters o ON o.id = c.character_id AND o.alive
      WHERE (c.race_limit IS NOT NULL OR c.pink_slip) AND c.character_id <> $1 AND NOT c.listed AND NOT c.pledged
      ORDER BY c.race_limit DESC NULLS LAST LIMIT 30`, [ch.id])).rows.map((r) => {
    const p = carPower(r.model_id, r.trim_id, r.tune, r.speed, r.dmg);
    return { ownerId: r.character_id, owner: r.owner, carId: r.id, model: r.model_id,
      limit: r.race_limit != null ? Math.floor(Number(r.race_limit)) : null, forPinks: !!r.pink_slip,
      band: p >= 500 ? 'a monster' : p >= 250 ? 'serious iron' : p >= 100 ? 'quick' : 'a runabout' };
  });
  const wins = Number((await client.query('SELECT race_wins FROM account_persistent WHERE account_id=$1', [ch.account_id])).rows[0]?.race_wins || 0);
  const cdLeft = ch.race_at && new Date(ch.race_at).getTime() > now ? Math.ceil((new Date(ch.race_at).getTime() - now) / 1000) : 0;
  const grandPrix = await grandPrixInfo(client, ch);
  return {
    cars, strip,
    tiers: RACES.TIERS.map((t) => ({ id: t.id, name: t.name, minLvl: t.minLvl, fee: t.fee, purse: t.purse, fieldPower: t.fieldPower })),
    tune: { cost: RACES.TUNE_COST, max: RACES.TUNE_MAX }, wager: { min: RACES.WAGER_MIN, max: RACES.WAGER_MAX },
    nos: { cost: RACES.NOS_COST, max: RACES.NOS_MAX, power: RACES.NOS_POWER },
    grandPrix,
    legend: { wins, rank: raceRankOf(wins).name }, cooldownSeconds: cdLeft,
  };
}

// ── THE GRAND PRIX (step 3) — a scheduled, worker-resolved CASH parimutuel (the poker-tournament twin) ──
const gpMs = () => Number(process.env.GRAND_PRIX_MS) || RACES.GP.REGISTER_MS; // TEST-ONLY env (SEARCH_MS pattern)

// POST /v1/races/gp {car} — buy into the open Grand Prix (cash ESCROWS; the car's power is snapshotted).
export async function enterGrandPrix(ch, carId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No racing from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp', "You're in no shape to drive.");
  if (levelOf(Number(ch.respect)) < RACES.GP.MIN_LEVEL) throw new GameError('level', `The Grand Prix runs at level ${RACES.GP.MIN_LEVEL}.`);
  const car = raceable(h, carId); // a car you own, not on the block / pledged
  const buyin = RACES.GP.BUYIN;
  if (Number(ch.cash) < buyin) throw new GameError('cash', `The buy-in is $${buyin}.`);
  const power = carPower(car.model_id, car.trim_id, car.tune, ch.speed, car.dmg); // SNAPSHOT the form at entry
  // materialize/find the open grand prix under the state singleton lock (LOCK ORDER: char → gp_state → gp)
  const st = (await client.query('SELECT current FROM grand_prix_state WHERE id=1 FOR UPDATE')).rows[0];
  let g = st.current ? (await client.query("SELECT * FROM grand_prix WHERE id=$1 AND status='open' FOR UPDATE", [st.current])).rows[0] : null;
  if (!g) {
    const id = crypto.randomUUID();
    const resolvesAt = new Date(Date.now() + gpMs());
    await client.query('INSERT INTO grand_prix (id, status, resolves_at, pool) VALUES ($1,$2,$3,0)', [id, 'open', resolvesAt]);
    await client.query('UPDATE grand_prix_state SET current=$1 WHERE id=1', [id]);
    g = { id, status: 'open', resolves_at: resolvesAt, pool: 0 };
  } else if (new Date(g.resolves_at) <= new Date()) {
    throw new GameError('closed', 'The grid is set — this race is about to run. Try again after it settles.');
  }
  if ((await client.query('SELECT 1 FROM grand_prix_entries WHERE gp_id=$1 AND character_id=$2', [g.id, ch.id])).rows[0])
    throw new GameError('entered', "You're already on the grid for this race.");
  ch.cash = Number(ch.cash) - buyin;
  await client.query('INSERT INTO grand_prix_entries (gp_id, character_id, buyin, power) VALUES ($1,$2,$3,$4)', [g.id, ch.id, buyin, power]);
  await client.query('UPDATE grand_prix SET pool = pool + $2 WHERE id=$1', [g.id, buyin]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -buyin, reason: 'race:gp:buyin', counterparty: g.id });
  const entrants = Number((await client.query('SELECT COUNT(*) n FROM grand_prix_entries WHERE gp_id=$1', [g.id])).rows[0].n);
  await h.track(client, ch.account_id, 'race', { mode: 'gp', buyin });
  bus.emit('streets', { type: 'gp_entry', who: ch.name, entrants });
  return { ok: true, grandPrix: g.id, buyin, power, pool: Number(g.pool) + buyin, entrants,
    closesSeconds: Math.max(0, Math.ceil((new Date(g.resolves_at) - Date.now()) / 1000)) };
}

// Worker settle: race every LIVE entrant (snapshotted power + rand(VARIANCE)), rank, pay the top places a
// share of the pool net of the rake. Single-writer (no player-lock races), idempotent (status gate).
export async function resolveGrandPrix(client, gpId) {
  const g0 = (await client.query('SELECT * FROM grand_prix WHERE id=$1', [gpId])).rows[0];
  if (!g0 || g0.status !== 'open') return null;
  // LOCK ORDER: entrant chars sorted → gp_state → gp row (gp_state BEFORE the gp row — enterGrandPrix locks
  // gp_state → gp, so locking gp first would AB-BA a concurrent entry; the resolveTournament posture).
  const entChars = (await client.query('SELECT character_id FROM grand_prix_entries WHERE gp_id=$1', [gpId])).rows.map((r) => r.character_id).sort();
  for (const cid of entChars) await client.query('SELECT 1 FROM characters WHERE id=$1 FOR UPDATE', [cid]);
  await client.query('SELECT current FROM grand_prix_state WHERE id=1 FOR UPDATE');
  const g = (await client.query("SELECT * FROM grand_prix WHERE id=$1 AND status='open' FOR UPDATE", [gpId])).rows[0];
  if (!g) return null;
  const pool = Number(g.pool);
  const entries = (await client.query(
    'SELECT e.character_id, e.buyin, e.power, c.alive, c.name FROM grand_prix_entries e LEFT JOIN characters c ON c.id=e.character_id WHERE e.gp_id=$1', [gpId])).rows;
  let deadBurn = 0;
  const live = [];
  for (const e of entries) {
    if (e.alive) live.push(e);
    else { deadBurn += Number(e.buyin); await ledger(client, { currency: 'cash', amount: -Number(e.buyin), reason: 'race:gp:death', counterparty: gpId }); }
  }
  const clearCurrent = async () => { await client.query('UPDATE grand_prix_state SET current=NULL WHERE id=1 AND current=$1', [gpId]); };
  if (live.length < RACES.GP.MIN_ENTRANTS) { // not a full grid — refund the field, burn the dead
    for (const e of live) {
      await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [e.character_id, Number(e.buyin)]);
      await ledger(client, { characterId: e.character_id, currency: 'cash', amount: Number(e.buyin), reason: 'race:gp:refund', counterparty: gpId });
      await notify(client, e.character_id, 'gp_refund', { buyin: Number(e.buyin) });
    }
    await client.query("UPDATE grand_prix SET status='refunded' WHERE id=$1", [gpId]);
    await clearCurrent();
    return { grandPrix: gpId, refunded: live.length };
  }
  // race: snapshotted power + rand(0,VARIANCE) each; rank DESC (fast/tuned iron wins, the road is fickle)
  const ranked = live.map((e) => ({ ...e, score: Number(e.power) + rand(0, RACES.VARIANCE) })).sort((a, b) => b.score - a.score);
  const livePool = pool - deadBurn;
  const rake = Math.floor(livePool * RACES.GP.RAKE_BPS / 10000);
  const net = livePool - rake;
  // pay the top min(field, PAYOUTS.length) places, RENORMALIZED to the field so the house edge stays the
  // rake regardless of turnout (an unpaid place otherwise leaks its share to the take).
  const frac = RACES.GP.PAYOUTS.slice(0, ranked.length);
  const denom = frac.reduce((a, b) => a + b, 0) || 1;
  const placeShare = frac.map((f) => Math.floor(net * f / denom));
  const payouts = new Array(ranked.length).fill(0);
  for (let i = 0; i < ranked.length;) { // group ties (equal final score) — split the covered places' shares
    let j = i; while (j + 1 < ranked.length && ranked[j + 1].score === ranked[i].score) j++;
    let sum = 0; for (let p = i; p <= j; p++) sum += placeShare[p] || 0;
    const each = Math.floor(sum / (j - i + 1));
    for (let p = i; p <= j; p++) payouts[p] = each;
    i = j + 1;
  }
  let handedOut = 0;
  for (let i = 0; i < ranked.length; i++) {
    const e = ranked[i], payout = payouts[i];
    if (payout > 0) {
      handedOut += payout;
      await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [e.character_id, payout]);
      await ledger(client, { characterId: e.character_id, currency: 'cash', amount: payout, reason: 'race:gp:win', counterparty: gpId });
    }
    await client.query('UPDATE grand_prix_entries SET place=$3 WHERE gp_id=$1 AND character_id=$2', [gpId, e.character_id, i + 1]);
    await notify(client, e.character_id, 'gp_result', { place: i + 1, of: ranked.length, payout });
  }
  const totalTake = rake + (net - handedOut); // the rake + any rounding/unpaid remainder = the house cut
  if (totalTake > 0) {
    await ledger(client, { currency: 'cash', amount: -totalTake, reason: 'race:gp:take', counterparty: gpId });
    await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [Math.floor(totalTake / 2)]); // half → the buyback, half burns
  }
  await client.query("UPDATE grand_prix SET status='resolved' WHERE id=$1", [gpId]);
  await clearCurrent();
  await rngLog(client, ranked[0].character_id, `race:gp:${gpId}`, ranked[0].score, `winner ${ranked[0].name} · ${ranked.length} runners · pool $${pool}`);
  bus.emit('streets', { type: 'gp_result', winner: ranked[0].name, pool, runners: ranked.length });
  return { grandPrix: gpId, runners: ranked.length, pool, winner: ranked[0].name, take: totalTake };
}

// worker sweep — settle every open grand prix past its window (per-race txn, idempotent; a poison race
// can't starve the rest).
export async function sweepGrandPrix(pool) {
  const due = (await pool.query("SELECT id FROM grand_prix WHERE status='open' AND resolves_at <= now() ORDER BY resolves_at")).rows;
  let resolved = 0;
  for (const { id } of due) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); await resolveGrandPrix(client, id); await client.query('COMMIT'); resolved++; }
    catch (e) { await client.query('ROLLBACK'); console.error('[sweepGrandPrix]', id, e?.code || e?.message || e); } // 40P01 / transient → next tick retries; a PERSISTENT throw freezes this pot's escrow → log it (the sweepAuctions poison-row precedent) so it surfaces, not silent
    finally { client.release(); }
  }
  return { resolved };
}

// the open Grand Prix summary for the board (pool, grid, your entry, the clock)
async function grandPrixInfo(client, ch) {
  const st = (await client.query('SELECT current FROM grand_prix_state WHERE id=1')).rows[0];
  const g = st?.current ? (await client.query("SELECT * FROM grand_prix WHERE id=$1 AND status='open'", [st.current])).rows[0] : null;
  if (!g) return { open: false, buyin: RACES.GP.BUYIN, minLevel: RACES.GP.MIN_LEVEL, minEntrants: RACES.GP.MIN_ENTRANTS };
  const entrants = Number((await client.query('SELECT COUNT(*) n FROM grand_prix_entries WHERE gp_id=$1', [g.id])).rows[0].n);
  const mine = !!(await client.query('SELECT 1 FROM grand_prix_entries WHERE gp_id=$1 AND character_id=$2', [g.id, ch.id])).rows[0];
  return { open: true, id: g.id, buyin: RACES.GP.BUYIN, minLevel: RACES.GP.MIN_LEVEL, minEntrants: RACES.GP.MIN_ENTRANTS,
    pool: Number(g.pool), entrants, entered: mine,
    closesSeconds: Math.max(0, Math.ceil((new Date(g.resolves_at) - Date.now()) / 1000)) };
}

// GET /v1/leaderboard/races — THE WHEEL: the base's winningest drivers (account-level, survives death).
export async function raceLeaderboard(pool) {
  const rows = (await pool.query(
    `SELECT a.race_wins, c.name FROM account_persistent a JOIN characters c ON c.account_id=a.account_id AND c.alive
      WHERE a.race_wins > 0 AND NOT a.agent_flag ORDER BY a.race_wins DESC LIMIT 15`)).rows; // agents excluded from the human status board (F-LOW2, the hitman-rep precedent)
  return { drivers: rows.map((r) => ({ name: r.name, wins: Number(r.race_wins), rank: raceRankOf(r.race_wins).name })) };
}

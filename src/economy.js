// M2 economy — garage, workshop, goods, rackets/assets, exchange, swap, staking, gear.
// Every formula cites spec §7 / prototype v24. Actions receive the locked character
// row (ch), the txn client, and the helper bag h = {ledger, rngLog, events, acct, owned}.
import crypto from 'node:crypto';
import { logCollect } from './collection.js';
// (tokenomics v2 step 2) the early-exit surcharge + toll split now live only on the WITHDRAWAL
// boundary in chain.js — the AMM sell that used to carry them here is retired with the pool.
import { GameError, bumpFamilyTask, skillMult, trunkCap, npcMult, bumpStanding, bumpMastery, bus, notify } from './game.js';
import { CONSUMABLES, RACKETS, ASSETS, GOODS, GUNS, VESTS, CONSTANTS, SKILLS, UNDERWORLD, LIMITED_RUNS, runOf, limitedRunP, levelOf, cityEventOf, dayOf, carOf, carVal, carMelt, rollCar, rollTrim, effStat, cargoCapacity, goodPriceOf, gearOf, gunObjOf, RACKET_EMPIRE, racketUpgradeCost, racketIncomeLeveled, tycoonRankOf, seasonModOf, pathFx, rollRarity, ladderFx, ladderFenceMult, STAKE_LOCKS, stakeLockActive, effectiveStake, OPERATIONS, opSlotsOf, nextOpSlotLevel, jailed, usd, art } from './rules.js';

const uid = () => crypto.randomUUID();
const cargoCount = (cargo) => Object.values(cargo).reduce((a, n) => a + (n || 0), 0);
// Family turf (§5.4): holding the district you're standing in gets better prices both ways.
const turfMult = (held, loc, side) => (held.includes(loc) ? (side === 'buy' ? 0.95 : 1.05) : 1);

// The 1% street tax on every house-take feeds the 12h buyback (spec §7.12).
// The 1% dev fee is an off-ledger cut. Neither touches a character's cash ledger,
// so the per-character invariant (Σ cash rows == cash+bank change) stays exact.
async function takeHouse(client, tax) {
  if (tax > 0) await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [tax]);
}
async function setCargo(client, charId, goodId, qty) {
  await client.query('DELETE FROM character_cargo WHERE character_id=$1 AND good_id=$2', [charId, goodId]);
  if (qty > 0) await client.query('INSERT INTO character_cargo (character_id, good_id, qty) VALUES ($1,$2,$3)', [charId, goodId, qty]);
}
async function setItem(client, charId, itemId, qty) {
  await client.query('DELETE FROM character_items WHERE character_id=$1 AND item_id=$2', [charId, itemId]);
  if (qty > 0) await client.query('INSERT INTO character_items (character_id, item_id, qty) VALUES ($1,$2,$3)', [charId, itemId, qty]);
}

// ═══════════════════ THE GARAGE (§7.5) ═══════════════════
// LIMITED RUNS — mint at most one numbered car per boost. The cap enforcement and the serial
// allocation are the SAME statement: `minted = minted + 1 WHERE minted < cap RETURNING minted` is
// atomic, so two concurrent boosts on the last slot cannot both take it and the returned count IS
// the serial. (Addition with a bound param is pg-mem-safe; the documented quirk is INT SUBTRACTION.)
// An exhausted run simply doesn't fire.
//
// Errors are NOT swallowed, and that is a correction rather than a looseness (red-team F1). The
// first cut caught the 23505 a concurrent first touch raises and returned null "so a mint failure
// can never fail a boost" — a promise that cannot be kept inside a transaction: in real Postgres an
// errored statement ABORTS the enclosing txn, so the caught 23505 left the boost's own car INSERT
// dying one statement later with 25P02, which `deadlockToRetry` does not map — a raw 500 where the
// swallow was meant to buy silence. Letting the 23505 through instead reaches deadlockToRetry and
// becomes a clean retryable `contention`, which is the shipment dayRow posture exactly.
export async function mintLimitedRun(client, modelId, roll) {
  const open = LIMITED_RUNS.filter((r) => r.model === modelId);
  if (!open.length || !(roll < limitedRunP())) return null;
  // one model can carry more than one run; pick deterministically off the same die so the draw
  // stays replayable from the rng_audit row
  const r = open[Math.floor((roll / Math.max(limitedRunP(), Number.EPSILON)) * open.length) % open.length];
  const up = await client.query(
    'UPDATE limited_runs SET minted = minted + 1 WHERE run_id=$1 AND minted < $2 RETURNING minted',
    [r.id, r.cap]);
  if (!up.rowCount) {
    // first touch of this run — materialize at serial 1 (the world_npcs first-touch precedent; a
    // concurrent first touch raises 23505, which the caller retries into)
    const has = (await client.query('SELECT minted FROM limited_runs WHERE run_id=$1', [r.id])).rows[0];
    if (has) return null;   // the run is EXHAUSTED — it never fires again, for anybody
    await client.query('INSERT INTO limited_runs (run_id, minted) VALUES ($1, 1)', [r.id]);
    return { runId: r.id, name: r.name, serial: 1, cap: r.cap };
  }
  return { runId: r.id, name: r.name, serial: Number(up.rows[0].minted), cap: r.cap };
}

export async function boostCar(ch, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No boosting from lockup.');
  const cd = CONSTANTS.GTA_CD_MS;
  if (ch.gta_at && Date.now() < new Date(ch.gta_at).getTime() + cd)
    throw new GameError('cooldown', `The heat's still on — wait ${Math.ceil((new Date(ch.gta_at).getTime() + cd - Date.now()) / 1000)}s.`);
  // THE LADDER (D8=D): held $OMR parks more iron. One expression for the bound AND the message,
  // so the refusal can never quote a number the check does not use.
  const garageCap = CONSTANTS.GARAGE_CAP + ladderFx(h.acct, 'garage');
  if (h.owned.cars.length >= garageCap) throw new GameError('full', `The garage holds ${garageCap}. Melt or fence one first.`);
  if (Number(ch.energy) < 10) throw new GameError('energy', 'Boosting takes 10 energy.');
  const speed = effStat(ch.speed, 'speed', h.owned.assets, h.owned.gear);
  const cunning = effStat(ch.cunning, 'cunning', h.owned.assets, h.owned.gear);
  const chance = Math.min(0.9, 0.35 + speed * 0.01 + cunning * 0.005 + (cityEventOf(dayOf()).boostAdd || 0));
  const roll = Math.random();
  ch.energy = Number(ch.energy) - 10;
  ch.gta_at = new Date();
  if (roll < chance) {
    const model = rollCar(), trim = rollTrim(), dmg = Math.floor(Math.random() * 61);
    const carId = uid();
    // THE RARITY NFTs (v3 step 7) — the car is EARNED here, so this is where the rarity is DROPPED.
    // Its own roll, rng_audit'd separately from the success roll so the draw is replayable (the
    // audit's Street-War lesson: reusing one die for two decisions correlates them silently).
    const rrRoll = Math.random();
    const rarity = rollRarity(rrRoll);
    // LIMITED RUNS (scarcity §2) — its OWN die, for the reason the rarity roll has its own: reusing
    // one for two decisions correlates them silently. A run mint is a pure ownership event (cars
    // conserve by ROW COUNT and are not a §10.4 currency), so it writes no ledger row; the boost's
    // faucet is unchanged whether the car turns out to be numbered or not.
    const runRoll = Math.random();
    const run = await mintLimitedRun(client, model.id, runRoll);
    await client.query('INSERT INTO cars (id, character_id, model_id, trim_id, dmg, rarity, run_id, serial) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [carId, ch.id, model.id, trim.id, dmg, rarity, run?.runId || null, run?.serial || null]);
    await h.rngLog(client, ch.id, 'rarity:car', rrRoll, rarity);
    h.owned.cars.push({ id: carId, model_id: model.id, trim_id: trim.id, dmg, rarity,
      run_id: run?.runId || null, serial: run?.serial || null });
    if (run) {
      await h.rngLog(client, ch.id, 'limited:run', runRoll, `${run.runId} ${run.serial}/${run.cap}`);
      await logCollect(client, ch.account_id, 'runs', run.runId);
      bus.emit('streets', { type: 'limited_run', who: ch.name, run: run.name, serial: run.serial, cap: run.cap });
      await notify(client, ch.id, 'limited_run', { run: run.runId, name: run.name, serial: run.serial, cap: run.cap });
    }
    await logCollect(client, ch.account_id, 'cars', model.id); // THE COLLECTION
    await h.rngLog(client, ch.id, 'gta', roll, 'success');
    await h.bumpDaily(client, ch.id, 'gta');
    await bumpFamilyTask(client, h, 'gta', 1);
    await bumpMastery(client, h, ch, 'wheels', 'boost'); // THE TRADES — a clean boost is the wheelman's craft
    // `model` here is the catalog ID (`junker`), which is what the ART route and every follow-on
    // call key on — but it is not a name, and the reply carried nothing else, so the boost read
    // "boosted a rare ride" on the game's most-repeated money verb. Send the NAME beside the id:
    // the id keeps working for the art, and the line can finally say what was stolen.
    return { ok: true, success: true, car: { id: carId, model: model.id, name: model.name, trim: trim.id,
      trimName: trim.name || '', dmg, rare: !!model.rare, rarity,
      run: run ? { id: run.runId, name: run.name, serial: run.serial, cap: run.cap } : null } };
  }
  const stint = 15 + Math.floor(Math.random() * 16); // 15–30s
  ch.jail_until = new Date(Date.now() + stint * 1000);
  await h.rngLog(client, ch.id, 'gta', roll, 'fail');
  return { ok: true, success: false, jailSeconds: stint };
}

function findCar(h, carId) {
  const car = h.owned.cars.find((c) => c.id === carId);
  if (!car) throw new GameError('no_car', 'No such car in the garage.');
  // Black Market escrow: a listed car is on the block — melt/fence/repair keep hands off until
  // the listing settles or is cancelled. (Chop still VALUES it: a hit crew knows your assets,
  // and excluding listed iron would let a marked man warehouse his fleet pre-hit.)
  if (car.listed) throw new GameError('listed', "It's on the block — cancel the listing first.");
  // Loan step 2: a pledged car is collateral — melt/fence/repair keep hands off until the debt clears
  // (or the shark seizes it). Same escrow-lock discipline as `listed`; CHOP still values it (a hit
  // crew knows your assets — a marked man can't warehouse his fleet by pledging it).
  if (car.pledged) throw new GameError('pledged', "It's pledged as loan collateral — square the debt first.");
  return car;
}
async function removeCar(client, h, carId) {
  await client.query('DELETE FROM cars WHERE id=$1', [carId]);
  h.owned.cars = h.owned.cars.filter((c) => c.id !== carId);
}

export async function meltCar(ch, carId, client, h) {
  const car = findCar(h, carId);
  // FENCE NETWORK (skills): the operator's contacts pay better — a new modifier, sign-off lever
  // THE LADDER (D8=D) composes onto the existing skill chain as one more multiplicative term —
  // the one economic edge on the ladder, and it is on an ACTIVE loop (you have to boost the car).
  const yieldRounds = Math.floor(carMelt(car.model_id, car.trim_id, car.dmg)
    * skillMult(h, 'fence_network', SKILLS.FX.FENCE_MULT) * skillMult(h, 'kingpin', SKILLS.FX.KINGPIN_MULT)
    * ladderFenceMult(h.acct));
  // §7.5: in a family, 25% of the rounds tithe to the armory and the treasury is
  // credited $30/round — atomically, in this same transaction.
  const tithe = h.owned.gangId ? Math.floor(yieldRounds * CONSTANTS.MELT_TITHE) : 0;
  const keep = yieldRounds - tithe;
  ch.ammo = Number(ch.ammo || 0) + keep;
  // LIMITED RUNS — DESTRUCTION IS NEWS (scarcity §4c). The counter never decrements, so melting a
  // numbered car takes it out of the world permanently: the run's live supply falls and can never
  // recover. Scarcity is only FELT if the city sees supply fall, so this goes on the wire.
  const melted = car.run_id ? runOf(car.run_id) : null;
  await removeCar(client, h, carId);
  await h.ledger(client, { characterId: ch.id, currency: 'ammo', amount: keep, reason: 'melt' });
  if (tithe > 0) {
    const titheValue = tithe * CONSTANTS.TITHE_ROUND_VALUE;
    await client.query('UPDATE gangs SET ammo_bank = ammo_bank + $2, treasury = treasury + $3 WHERE id=$1',
      [h.owned.gangId, tithe, titheValue]);
    // gang-bucket rows carry no character_id so per-character invariants stay exact
    await h.ledger(client, { currency: 'ammo', amount: tithe, reason: 'melt:tithe', counterparty: h.owned.gangId });
    await h.ledger(client, { currency: 'cash', amount: titheValue, reason: 'melt:tithe', counterparty: h.owned.gangId });
  }
  if (melted) {
    bus.emit('streets', { type: 'run_melted', who: ch.name, run: melted.name,
      serial: car.serial != null ? Number(car.serial) : null, cap: melted.cap });
  }
  await h.bumpDaily(client, ch.id, 'melt');
  await bumpFamilyTask(client, h, 'melt', yieldRounds);
  return { ok: true, rounds: keep, tithe, melted: melted ? { run: car.run_id, name: melted.name, serial: car.serial } : null };
}

export async function repairCar(ch, carId, client, h) {
  const car = findCar(h, carId);
  if ((car.dmg || 0) <= 0) throw new GameError('clean', 'Not a scratch on it.');
  const model = carOf(car.model_id);
  const cost = Math.max(50, Math.floor((car.dmg / 100) * carVal(car.model_id, car.trim_id) * 0.2));
  if (Number(ch.cash) < cost) throw new GameError('cash', `The shop wants ${usd(cost)}.`);
  const chance = Math.max(0.05, ((model?.rare ? 50 : 100) - car.dmg) / 100); // rare iron repairs badly
  const roll = Math.random();
  ch.cash = Number(ch.cash) - cost;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'repair' });
  const fixed = roll < chance;
  if (fixed) {
    await client.query('UPDATE cars SET dmg=0 WHERE id=$1', [carId]);
    car.dmg = 0;
  }
  await h.rngLog(client, ch.id, 'repair', roll, fixed ? 'fixed' : 'botched');
  return { ok: true, fixed, cost };
}

export async function fenceCar(ch, carId, client, h) {
  const car = findCar(h, carId);
  // FENCE NETWORK (skills): +8% on the gross — a new modifier, sign-off lever
  const gross = Math.floor(carVal(car.model_id, car.trim_id) * 0.5 * (1 - (car.dmg || 0) / 100) * (cityEventOf(dayOf()).fenceMult || 1)
    * skillMult(h, 'fence_network', SKILLS.FX.FENCE_MULT) * skillMult(h, 'kingpin', SKILLS.FX.KINGPIN_MULT)
    * ladderFenceMult(h.acct));   // THE LADDER (D8=D) — the top rung's edge, on the same chain
  const fee = Math.ceil(gross * 0.01), tax = Math.ceil(gross * 0.01);
  const net = gross - fee - tax;
  ch.cash = Number(ch.cash) + net;
  await removeCar(client, h, carId);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: net, reason: 'fence' });
  await takeHouse(client, tax);
  return { ok: true, gross, net };
}

// ═══════════════════ THE WORKSHOP (§5.4) ═══════════════════
export async function craft(ch, itemId, client, h) {
  const c = CONSUMABLES.find((x) => x.id === itemId);
  if (!c) throw new GameError('bad_item', 'No such craftable.');
  // Old Foundry turf: crafts cost 25% less cash for the holding family — OR a controller of a
  // foundry CORNER (STREET DEEDS 2C; OR by set-union, applies once whichever list carries it).
  // BELLA T2 (underworld) stacks ×0.9 on top — both discounts are what's ledgered.
  const cost = Math.floor(c.cost
    * ([...(h.owned.held || []), ...(h.owned.deedPerk || [])].includes('foundry') ? 0.75 : 1)
    * npcMult(h, 'armorer', 2, UNDERWORLD.FX.CRAFT_MULT));
  if (Number(ch.cb || 0) < c.cb) throw new GameError('cb', `Need ${c.cb} crates of contraband.`);
  if (Number(ch.cash) < cost) throw new GameError('cash', 'Not enough pocket cash for materials.');
  ch.cb = Number(ch.cb) - c.cb;
  ch.cash = Number(ch.cash) - cost;
  const have = (h.owned.items[itemId] || 0) + 1;
  h.owned.items[itemId] = have;
  await setItem(client, ch.id, itemId, have);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: `craft:${itemId}` });
  await h.ledger(client, { characterId: ch.id, currency: 'cb', amount: -c.cb, reason: `craft:${itemId}` });
  await bumpStanding(client, h, ch, 'armorer', 1, { action: 'craft' }); // workshop business is Bella's business
  await h.bumpDaily(client, ch.id, 'craft');
  // the DISCOUNTED cost is what was charged, so it is what the receipt states (the foundry/Bella
  // stack is already folded in above). Crates are the second currency — guns and ammo are the only
  // other purchases that spend one, and both now say so.
  return { ok: true, op: 'craft', item: itemId, cost, crates: c.cb };
}

export async function craftAmmo(ch, client, h) {
  if (Number(ch.cb || 0) < 1) throw new GameError('cb', 'Rolling rounds takes 1 crate of contraband.');
  if (Number(ch.cash) < 400) throw new GameError('cash', 'Rolling rounds takes $400 in materials.');
  ch.cb = Number(ch.cb) - 1;
  ch.cash = Number(ch.cash) - 400;
  ch.ammo = Number(ch.ammo || 0) + 30;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -400, reason: 'craft:ammo' });
  await h.ledger(client, { characterId: ch.id, currency: 'cb', amount: -1, reason: 'craft:ammo' });
  await h.ledger(client, { characterId: ch.id, currency: 'ammo', amount: 30, reason: 'craft:ammo' });
  // `rolled` is what this box ADDED and `ammo` is what you are CARRYING. They were one field, and the
  // line renders it as a total ("N on you"), so a player holding 55 rounds was told 30 — the number
  // you check before a hit, wrong in the direction that gets somebody killed. `op` names the SYSTEM
  // so the branch stops discriminating on `gun === undefined`: absence is not a discriminator.
  return { ok: true, op: 'ammo', rolled: 30, ammo: Number(ch.ammo), cost: 400, crates: 1 };
}

export function useItem(ch, itemId, client, h) {
  const c = CONSUMABLES.find((x) => x.id === itemId);
  if (!c) throw new GameError('bad_item', 'No such item.');
  if ((h.owned.items[itemId] || 0) <= 0) throw new GameError('none', "You don't have that.");
  const lvl = levelOf(Number(ch.respect));
  const maxEnergy = 50 + 2 * lvl + h.owned.assets.reduce((a, id) => a + (ASSETS.find((x) => x.id === id)?.energyCap || 0), 0);
  const maxNerve = 10 + lvl;
  const fx = c.fx || {};
  if (fx.hp) ch.health = Math.min(100, Number(ch.health) + fx.hp);
  if (fx.en) ch.energy = Math.min(maxEnergy, Number(ch.energy) + fx.en);
  if (fx.nv) ch.nerve = Math.min(maxNerve, Number(ch.nerve) + fx.nv);
  if (fx.cool) ch.heat = Math.max(0, Number(ch.heat || 0) - fx.cool);
  if (fx.jail0) ch.jail_until = null;
  const have = h.owned.items[itemId] - 1;
  h.owned.items[itemId] = have;
  return (async () => {
    await setItem(client, ch.id, itemId, have);
    return { ok: true, used: itemId, effect: c.effect };
  })();
}

// ═══════════════════ TRADE GOODS (§7.11) ═══════════════════
export async function buyGood(ch, goodId, qty, client, h) {
  const g = GOODS.find((x) => x.id === goodId);
  if (!g) throw new GameError('bad_good', 'No such good.');
  const n = Math.max(1, Math.floor(Number(qty) || 0));
  const cap = trunkCap(h);
  if (cargoCount(h.owned.cargo) + n > cap) throw new GameError('cargo', `The trunk holds ${cap} units. Better Wheels carry more.`);
  // STREET DEEDS 2C — controlled corners count for the ±5% turf price edge (set-union → OR, once)
  const unit = Math.round(goodPriceOf(goodId, ch.loc) * turfMult([...(h.owned.held || []), ...(h.owned.deedPerk || [])], ch.loc, 'buy'));
  const cost = unit * n, fee = Math.ceil(cost * 0.01), tax = Math.ceil(cost * 0.01);
  if (Number(ch.cash) < cost + fee + tax) throw new GameError('cash', `That runs ${usd(cost + fee + tax)} with the 2% house take.`);
  ch.cash = Number(ch.cash) - cost - fee - tax;
  const have = (h.owned.cargo[goodId] || 0) + n;
  h.owned.cargo[goodId] = have;
  await setCargo(client, ch.id, goodId, have);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -(cost + fee + tax), reason: `goods:buy:${goodId}` });
  await takeHouse(client, tax);
  await logCollect(client, ch.account_id, 'goods', goodId); // THE COLLECTION
  // the daily 'goods' contract + the hustle legwork both promise "buy OR sell" — only the sell
  // side counted (the dice-counter class from the daily pool), so a buy-only day couldn't complete
  // either. The bump costs the buyer the 2% take either way; the contract payout is unchanged.
  await h.bumpDaily(client, ch.id, 'goods');
  // WAVE 59 — ten goods lines and one sentence: "bought 2 at $190 a unit" named nothing, so the
  // cheapest crate and the dearest read identically but for the figure. The id is enough here — the
  // client resolves it through goodName off the published /v1/rules catalog.
  return { ok: true, good: goodId, unit, qty: n, spent: cost + fee + tax };
}

export async function sellGood(ch, goodId, qty, client, h) {
  const g = GOODS.find((x) => x.id === goodId);
  if (!g) throw new GameError('bad_good', 'No such good.');
  const have = h.owned.cargo[goodId] || 0;
  const n = Math.min(Math.max(1, Math.floor(Number(qty) || 0)), have);
  if (n <= 0) throw new GameError('none', 'Nothing of that in the trunk.');
  const ev = cityEventOf(dayOf());
  // SEASONAL MODIFIER (slate #6): THE GOLD RUSH lifts every sale (composes like the city event)
  const unit = Math.round(goodPriceOf(goodId, ch.loc) * turfMult([...(h.owned.held || []), ...(h.owned.deedPerk || [])], ch.loc, 'sell') * (ev.tradeMult || 1) * pathFx(ch, 'goodsSell') * (seasonModOf().tradeSellMult || 1)); // PATHS v2 — ledger keeps 1.05; the Gun sells at 0.95 (the soldier's-no-merchant handicap); deed corners count (2C)
  const gross = unit * n, fee = Math.ceil(gross * 0.01), tax = Math.ceil(gross * 0.01);
  const net = gross - fee - tax;
  ch.cash = Number(ch.cash) + net;
  const left = have - n;
  h.owned.cargo[goodId] = left;
  await setCargo(client, ch.id, goodId, left);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: net, reason: `goods:sell:${goodId}` });
  await takeHouse(client, tax);
  await h.bumpDaily(client, ch.id, 'goods');
  await bumpMastery(client, h, ch, 'commerce', 'sell'); // THE TRADES — goods moved at a margin is commerce
  return { ok: true, good: goodId, unit, qty: n, earned: net };
}

// ═══════════════════ RACKETS & ASSETS (§5.4) ═══════════════════
// THE OPERATION SLOTS (strategy package) — rackets and income assets share ONE pool of seats, so
// buying is a CHOICE between 31 catalog entries rather than a checklist. The two helpers below are
// the single source for "what counts" and "how many you may run"; every gate and every board reads
// them, so the sheet can never advertise a seat the till refuses (the coach/cornerOpen lesson).
export const incomeAssetIds = (assets = []) =>
  assets.filter((id) => ASSETS.find((a) => a.id === id)?.cat === OPERATIONS.INCOME_ASSET_CAT);
export function opsUsed(h) {
  return (h?.owned?.rackets?.length || 0) + incomeAssetIds(h?.owned?.assets || []).length;
}
// STREET DEEDS 2C — controlling your OWN corner seats one more operation (the deedSeat arg on the
// SAME rules-level opSlotsOf the view's ops block reads, still capped at SLOTS_MAX — the deed
// accelerates the seat curve, never exceeds it). Lose your corner to a rival, lose the seat.
export function opsSlots(ch, h) { return opSlotsOf(levelOf(Number(ch.respect)), !!h?.owned?.deedSeat); }
function assertSlot(ch, h) {
  const used = opsUsed(h), slots = opsSlots(ch, h);
  if (used < slots) return;
  const next = nextOpSlotLevel(levelOf(Number(ch.respect)));
  throw new GameError('slots', next
    ? `You're running ${used} operations and you only have ${slots} pairs of hands. Retire one, or make level ${next}.`
    : `You're running ${used} operations — that's every seat you'll ever have. Retire one to take on another.`);
}

export async function buyRacket(ch, racketId, client, h) {
  const r = RACKETS.find((x) => x.id === racketId);
  if (!r) throw new GameError('bad_racket', 'No such racket.');
  if (h.owned.rackets.includes(r.id)) throw new GameError('owned', 'You already run that.');
  if (levelOf(Number(ch.respect)) < r.lvl) throw new GameError('level', `Need level ${r.lvl}.`);
  assertSlot(ch, h); // …before the cash check: a player who can't seat it shouldn't hear "not enough cash"
  if (Number(ch.cash) < r.cost) throw new GameError('cash', 'Not enough pocket cash.');
  ch.cash = Number(ch.cash) - r.cost;
  await client.query('INSERT INTO character_rackets (character_id, racket_id) VALUES ($1,$2)', [ch.id, r.id]);
  h.owned.rackets.push(r.id);
  if (h.owned.racketLevels) h.owned.racketLevels[r.id] = 0;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -r.cost, reason: `racket:buy:${r.id}` });
  return { ok: true, racket: r.id, income: r.income };
}

// THE DOOR OUT (the OPERATION SLOTS' other half — the BUSINESS_SHUTTER_BPS precedent). A slot cap
// without a way to free a seat is a permanent bad pick, so retiring is always available. At
// RACKET_RETIRE_BPS 0 it returns NOTHING and writes NO ledger row — walking away moves no value, so
// it needs no sign-off, and nothing can pay for itself by churning the catalog. Any upgrade levels
// sunk into it go with it (the row carries the level; a rehire starts at 0 — the crew-buy-in rule).
export async function retireRacket(ch, racketId, client, h) {
  const r = RACKETS.find((x) => x.id === racketId);
  if (!r) throw new GameError('bad_racket', 'No such racket.');
  if (!h.owned.rackets.includes(r.id)) throw new GameError('none', "You don't run that racket.");
  const back = Math.floor(r.cost * (OPERATIONS.RACKET_RETIRE_BPS / 10000));
  await client.query('DELETE FROM character_rackets WHERE character_id=$1 AND racket_id=$2', [ch.id, r.id]);
  h.owned.rackets = h.owned.rackets.filter((id) => id !== r.id);
  if (h.owned.racketLevels) delete h.owned.racketLevels[r.id];
  if (back > 0) {
    ch.cash = Number(ch.cash) + back;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: back, reason: `racket:retire:${r.id}` });
  }
  return { ok: true, racket: r.id, back, slotsUsed: opsUsed(h), slots: opsSlots(ch, h) };
}

// ASSETS & RACKETS → Tier 4 — RACKET UPGRADES: buy the next level of a racket you run; its accrual
// income multiplies by RACKET_EMPIRE.UP_STEP/level (capped UP_MAX). A §10.4 cash SINK `racket:upgrade`;
// the level lives on character_rackets.level (direct SQL, not a persistCharacter column → clobber-safe).
export async function upgradeRacket(ch, racketId, client, h) {
  const r = RACKETS.find((x) => x.id === racketId);
  if (!r) throw new GameError('bad_racket', 'No such racket.');
  if (!h.owned.rackets.includes(r.id)) throw new GameError('none', "You don't run that racket.");
  const level = Number(h.owned.racketLevels?.[r.id] || 0);
  if (level >= RACKET_EMPIRE.UP_MAX) throw new GameError('maxed', `${art(r.name, 'The')} is running as hard as it can.`);
  const cost = racketUpgradeCost(r.id, level);
  if (Number(ch.cash) < cost) throw new GameError('cash', `Muscling ${art(r.name)} up a level runs ${usd(cost)}.`);
  ch.cash = Number(ch.cash) - cost;
  await client.query('UPDATE character_rackets SET level=$1 WHERE character_id=$2 AND racket_id=$3', [level + 1, ch.id, r.id]);
  if (h.owned.racketLevels) h.owned.racketLevels[r.id] = level + 1;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'racket:upgrade' });
  return { ok: true, racket: r.id, level: level + 1, cost,
    incomePerHr: Math.floor(racketIncomeLeveled(r.id, level + 1) * 60) };
}

// THE TYCOON LEADERBOARD (Tier-4) — the biggest lifetime racket/front earners (agents excluded).
// Pure STATUS — account-level, survives death.
export async function tycoonLeaderboard(pool) {
  const rows = (await pool.query(
    `SELECT c.name, ap.tycoon_earned FROM account_persistent ap
       JOIN characters c ON c.account_id = ap.account_id AND c.alive
      WHERE NOT ap.agent_flag AND NOT c.is_npc AND ap.tycoon_earned > 0
      ORDER BY ap.tycoon_earned DESC, c.name LIMIT 20`)).rows;
  return { tycoons: rows.map((r, i) => ({ pos: i + 1, name: r.name, earned: Number(r.tycoon_earned),
    rank: tycoonRankOf(r.tycoon_earned).name })) };
}

export async function buyAsset(ch, assetId, client, h) {
  const a = ASSETS.find((x) => x.id === assetId);
  if (!a) throw new GameError('bad_asset', 'No such asset.');
  if (h.owned.assets.includes(a.id)) throw new GameError('owned', 'You already own that.');
  // Only the INCOME category takes a seat. Wheels and Property are stat/cargo/energy-cap progression,
  // and metering them would be a pacing change wearing an economy change's clothes.
  if (a.cat === OPERATIONS.INCOME_ASSET_CAT) assertSlot(ch, h);
  const fee = Math.ceil(a.price * 0.01), tax = Math.ceil(a.price * 0.01);
  if (Number(ch.cash) < a.price + fee + tax) throw new GameError('cash', 'Not enough pocket cash (price + 2% house take).');
  ch.cash = Number(ch.cash) - a.price - fee - tax;
  await client.query('INSERT INTO character_assets (character_id, asset_id) VALUES ($1,$2)', [ch.id, a.id]);
  h.owned.assets.push(a.id);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -(a.price + fee + tax), reason: `asset:buy:${a.id}` });
  await takeHouse(client, tax);
  return { ok: true, asset: a.id };
}

export async function sellAsset(ch, assetId, client, h) {
  const a = ASSETS.find((x) => x.id === assetId);
  if (!a) throw new GameError('bad_asset', 'No such asset.');
  if (!h.owned.assets.includes(a.id)) throw new GameError('none', "You don't own that.");
  const back = Math.floor(a.price * 0.8); // prototype sells back at 80% (spec §5.4 says 70% — discrepancy; prototype wins per CLAUDE.md)
  const fee = Math.ceil(back * 0.01), tax = Math.ceil(back * 0.01);
  const net = back - fee - tax;
  ch.cash = Number(ch.cash) + net;
  await client.query('DELETE FROM character_assets WHERE character_id=$1 AND asset_id=$2', [ch.id, a.id]);
  h.owned.assets = h.owned.assets.filter((id) => id !== a.id);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: net, reason: `asset:sell:${a.id}` });
  await takeHouse(client, tax);
  return { ok: true, asset: a.id, earned: net };
}

// ═══════════════════ THE AMM — RETIRED (tokenomics v2 step 2) ═══════════════════
// Cash no longer converts to $OMR, in either direction, by any route. This is the pivot's whole
// point (design §0): while cash bought $OMR, every cash faucet in the game was secretly a token-
// price decision, and the measured maxed passive stack ($21.6M/day for one player) sat one swap
// away from sell pressure. Now cash is a purely internal gameplay resource with no exit, and $OMR
// enters circulation only when someone pays real ETH for it.
//
// BOTH directions go, not just the buy. §1 of the design lists only cash → $OMR, but §2's own
// reasoning applies harder to what would be left behind: a sell-only constant-product AMM drains
// its cash reserve monotonically — every trade removes cash and adds $OMR, nothing refills the
// cash side — until the price approaches zero and the window shuts itself. That is a mechanical
// certainty, not a risk. THE EXCHANGE (src/exchange.js) is the $OMR → cash path now: a fixed
// published rate, paid from a pool that real cash sinks fund, capped by that pool.
//
// The route stays mounted and answers with this, rather than 404ing: players and agents have it
// bookmarked and coded against, and a clean explanation beats a dead URL. The `swap:` reasons stay
// in the §10.4 vocabulary too — historical rows still have to validate, and dropping the prefix
// would turn every past trade into an unknown-reason alarm.
//
// `amm_pool` itself is left ALONE. Its omr_reserve is inside omrBuckets, so deleting the row would
// mean moving genesis $OMR somewhere and perturbing conservation for no gain. It is simply a bucket
// nobody trades against any more, and the §10.4 sweep stays drift-0.
export async function swap() {
  throw new GameError('retired',
    'Cash and $OMR do not trade in either direction. $OMR is redeemed for cash at the Exchange window, at a published rate.');
}

// ═══════════════════ STAKING (§7.1 / §5.4) ═══════════════════
export function stake(ch, amount, client, h) {
  const a = Math.min(Math.floor(Number(amount) * 1e6) / 1e6, Number(h.acct.omr));
  if (!(a > 0)) throw new GameError('omr', 'Nothing to stake.');
  h.acct.omr = Number(h.acct.omr) - a;
  h.acct.staked = Number(h.acct.staked) + a;
  return { ok: true, staked: a }; // internal move, no faucet/sink
}
// (tokenomics v2 step 2, red-team A2) `payStakeRewards` lived here — the Phase-4 backed payout that
// moved $OMR out of `stake_pool`. Both its callers retired with individual yield, leaving it
// unreachable, and it MATTERED that it was gone rather than merely unused: it read as the live drain
// for a pool that in fact has only one exit now, the legacy-pool merge on the worker tick. Deleted so
// nobody reasons from it. `stake:reward` stays in the §10.4 vocabulary — historical rows are real.
// ═══ THE COMMITMENT (NetNet rec A, 2026-08-21) — lock the staked balance for a published window.
// A locked stake counts ×mult toward the MADE_LADDER (rules.tail.js effectiveStake — the ONE reader
// the ladder, the board and the coach share) and refuses to unstake until the window passes.
// ZERO §10.4 surface: no currency moves at lock time (test-pinned — zero ledger rows), the lock
// only changes what the ladder READS and what unstake REFUSES. And deliberately NOT a loot shield:
// whack:loot debits `staked` directly and never consults these columns (test/made.js kills a
// locked holder and asserts the committed rate still lands). The two columns are OFF
// persistAccount's positional list, so the direct SQL write here — under withCharacter's held
// account lock — is clobber-safe; h.acct is updated in memory so this request's own view agrees.
export async function lockStake(ch, tierId, client, h) {
  const tier = STAKE_LOCKS.TIERS.find((t) => t.id === tierId);
  if (!tier) throw new GameError('bad_tier', 'No such commitment. The windows are: '
    + STAKE_LOCKS.TIERS.map((t) => `${t.id} (${t.days}d, ×${t.mult})`).join(', ') + '.');
  const staked = Number(h.acct.staked || 0);
  if (!(staked > 0)) throw new GameError('none', 'Nothing staked — stake $OMR first, then give your word on it.');
  const now = Date.now();
  const until = new Date(now + tier.days * 86400000);
  if (stakeLockActive(h.acct, now)) {
    // an active lock may only be UPGRADED — longer AND at least as strong. A commitment is not a
    // dial you turn down when a killer shows up (the wall the design names).
    const curUntil = new Date(h.acct.stake_lock_until).getTime();
    const curMult = Number(h.acct.stake_lock_mult || 1);
    if (until.getTime() < curUntil || tier.mult < curMult)
      throw new GameError('committed', 'Your word is already given — a live commitment only ever gets LONGER or STRONGER, never weaker.');
  }
  await client.query('UPDATE account_persistent SET stake_lock_until=$2, stake_lock_mult=$3 WHERE account_id=$1',
    [ch.account_id, until, tier.mult]);
  h.acct.stake_lock_until = until; h.acct.stake_lock_mult = tier.mult;
  return { ok: true, lock: tier.id, lockName: tier.name, mult: tier.mult, days: tier.days,
    lockSeconds: Math.ceil((until.getTime() - now) / 1000),
    staked, effectiveStake: effectiveStake(h.acct, now) };
}
export async function unstake(ch, client, h) {
  const staked = Number(h.acct.staked), rewards = Number(h.acct.rewards);
  if (staked <= 0 && rewards <= 0) throw new GameError('none', 'Nothing staked.');
  // THE COMMITMENT: a locked stake does not come out until the window passes. The refusal names
  // the time left (the terms-ride-with-the-refusal rule) — and it is the WHOLE point of the lock,
  // which is why the ladder paid you ×mult for it.
  if (staked > 0 && stakeLockActive(h.acct)) {
    const left = Math.ceil((new Date(h.acct.stake_lock_until).getTime() - Date.now()) / 1000);
    throw new GameError('locked',
      `You gave your word on that stake — it stays put another ${Math.ceil(left / 3600)}h. That commitment is what the ladder is paying you for.`,
      { lockSeconds: left });
  }
  // Make-Risk-Pay: principal still ALWAYS returns whole (a bucket move, never pool-gated) — but it
  // UNBONDS for UNSTAKE_CD_MS first: no yield, and LOOTABLE (whack:loot reaches liquid + unbonding)
  // until the window passes and accrual releases it to `omr`. The stake→extract path now always
  // crosses an exposure window; staking in stays instant (the safe harbour is entered freely,
  // exited deliberately). A repeat unstake stacks and resets the clock.
  h.acct.unbonding = Number(h.acct.unbonding || 0) + staked;
  h.acct.unbond_at = new Date(Date.now() + CONSTANTS.UNSTAKE_CD_MS);
  h.acct.staked = 0;
  // (tokenomics v2 step 2) NO YIELD is paid here any more — individual staking rewards are retired
  // and repurposed into the FAMILY yield (design §3). The PRINCIPAL is untouched by that change: it
  // still returns whole, still unbonds, still stays lootable through the window. Accrued-but-never-
  // paid `rewards` are left on the account rather than silently zeroed, so nothing is destroyed and
  // the number stays auditable if the founder ever wants to settle it.
  const paid = 0;
  return { ok: true, unbonding: staked, unbondSeconds: Math.ceil(CONSTANTS.UNSTAKE_CD_MS / 1000),
    rewards: paid, stillPending: rewards - paid };
}
// (tokenomics v2 step 2) INDIVIDUAL STAKING YIELD — RETIRED, repurposed into the FAMILY yield
// (design §3). The pool this paid from is merged into `family_yield_pool` on the next worker tick,
// and standing — not deposit size — is what earns it now.
//
// Staking itself is untouched in every other respect: the deposit still goes in, the principal
// still comes back WHOLE, and the unbonding window (the P1.1 loot surface) still applies. The
// design explicitly defers "retire the deposit entirely" to v2.1 if it turns out to have no
// remaining purpose, so it is left alone here rather than pre-empted.
export async function claimRewards() {
  throw new GameError('retired',
    'Staking pays the FAMILIES, not the man — standing earns it into the family reserve. Your principal is untouched and comes back whole.');
}

// ═══════════════════ THE ARMORY (§5.2) ═══════════════════
export async function buyGun(ch, gunId, client, h) {
  const g = GUNS.find((x) => x.id === gunId);
  if (!g) throw new GameError('bad_gun', 'No such piece.');
  if (h.owned.guns.includes(gunId)) throw new GameError('owned', 'You already own that piece.');
  // BELLA T1 (underworld): friends buy iron at a discount — cash only, the crates stand.
  // The discounted price is what's ledgered (decree/skill precedent). Sign-off lever.
  const price = Math.floor(g.cash * npcMult(h, 'armorer', 1, UNDERWORLD.FX.GUN_MULT));
  if (Number(ch.cash) < price) throw new GameError('cash', 'The dealer doesn\'t extend credit.');
  if ((Number(ch.cb) || 0) < g.crates) throw new GameError('cb', `The dealer wants ${g.crates} crates on top of the cash.`);
  ch.cash = Number(ch.cash) - price;
  ch.cb = Number(ch.cb) - g.crates;
  await client.query('INSERT INTO character_guns (character_id, gun_id) VALUES ($1,$2)', [ch.id, gunId]);
  h.owned.guns.push(gunId);
  if (!ch.gun) ch.gun = gunId; // first iron auto-equips (v24)
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -price, reason: `gun:buy:${gunId}` });
  await h.ledger(client, { characterId: ch.id, currency: 'cb', amount: -g.crates, reason: `gun:buy:${gunId}` });
  await bumpStanding(client, h, ch, 'armorer', 3, { action: 'gun' }); // Bella remembers a customer
  await logCollect(client, ch.account_id, 'guns', gunId); // THE COLLECTION
  // `crates` because iron costs TWO things and the reply carried only one: the till debits cash AND
  // g.crates of contraband (both ledgered `gun:buy:<id>` above), so without it the receipt cannot state
  // what the purchase actually took. `equipped` was already here and unread — the first piece you buy
  // auto-equips, which is the difference between walking out armed and walking out holding it.
  return { ok: true, gun: gunId, price, crates: g.crates, equipped: ch.gun === gunId };
}

export function equipGun(ch, gunId, client, h) {
  if (gunId && !h.owned.guns.includes(gunId)) throw new GameError('none', "You don't own that piece.");
  ch.gun = gunId || null;
  return { ok: true, gun: ch.gun };
}

// Vests are an $OMR burn (§5.2) — they don't survive death, the burn is final.
export async function buyVest(ch, vestId, client, h) {
  const v = VESTS.find((x) => x.id === vestId);
  if (!v) throw new GameError('bad_vest', 'No such vest.');
  if (ch.vest === vestId) throw new GameError('worn', "You're already wearing it.");
  if (Number(h.acct.omr) < v.omr) throw new GameError('omr', `${art(v.name, 'The')} runs ${v.omr} $OMR.`);
  h.acct.omr = Number(h.acct.omr) - v.omr;
  ch.vest = vestId;
  await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: -v.omr, reason: `vest:${vestId}` });
  return { ok: true, vest: vestId, mult: v.mult };
}

export async function buyAmmo(ch, client, h) {
  if (Number(ch.cash) < 2000) throw new GameError('cash', 'A box of 50 rounds runs $2,000.');
  ch.cash = Number(ch.cash) - 2000;
  ch.ammo = Number(ch.ammo) + 50;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -2000, reason: 'ammo:buy' });
  await h.ledger(client, { characterId: ch.id, currency: 'ammo', amount: 50, reason: 'ammo:buy' });
  // ammo PRICE is the D1-signed kill-EV anchor — Bella never discounts it, only remembers you
  await bumpStanding(client, h, ch, 'armorer', 1, { action: 'ammo' });
  return { ok: true, op: 'ammo', rolled: 50, ammo: Number(ch.ammo), cost: 2000 };
}

// ═══════════════════ NFT GEAR MINT (§5.4) ═══════════════════
export async function mintGear(ch, gearId, client, h) {
  const g = gearOf(gearId);
  if (!g) throw new GameError('bad_gear', 'No such gear.');
  if (h.owned.gear.includes(gearId)) throw new GameError('owned', 'You already hold that piece.');
  // an EXTRACTED piece no longer boosts anything, but the account_gear row still holds the PK slot —
  // an INSERT here would 23505. And the honest message is not "you already hold it": it left play.
  if ((h.owned.gearOnchain || []).includes(gearId)) throw new GameError('extracted', 'You took that piece on-chain — it left play, and the slot went with it.');
  if (Number(h.acct.omr) < g.price) throw new GameError('omr', `That mints for ${g.price} $OMR.`);
  h.acct.omr = Number(h.acct.omr) - g.price;
  await client.query('INSERT INTO account_gear (account_id, gear_id) VALUES ($1,$2)', [h.accountId, gearId]);
  h.owned.gear.push(gearId);
  await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: -g.price, reason: `gear:mint:${gearId}` });
  return { ok: true, gear: gearId, stat: g.stat, boost: g.boost };
}

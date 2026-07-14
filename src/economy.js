// M2 economy — garage, workshop, goods, rackets/assets, exchange, swap, staking, gear.
// Every formula cites spec §7 / prototype v24. Actions receive the locked character
// row (ch), the txn client, and the helper bag h = {ledger, rngLog, events, acct, owned}.
import crypto from 'node:crypto';
import { GameError, bumpFamilyTask } from './game.js';
import {
  CONSUMABLES, RACKETS, ASSETS, GOODS, GUNS, VESTS, CONSTANTS,
  levelOf, cityEventOf, dayOf, carOf, carVal, carMelt, rollCar, rollTrim,
  effStat, cargoCapacity, goodPriceOf, gearOf, gunObjOf,
} from './rules.js';

const uid = () => crypto.randomUUID();
const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
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
export async function boostCar(ch, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No boosting from lockup.');
  const cd = CONSTANTS.GTA_CD_MS;
  if (ch.gta_at && Date.now() < new Date(ch.gta_at).getTime() + cd)
    throw new GameError('cooldown', `The heat's still on — wait ${Math.ceil((new Date(ch.gta_at).getTime() + cd - Date.now()) / 1000)}s.`);
  if (h.owned.cars.length >= CONSTANTS.GARAGE_CAP) throw new GameError('full', `The garage holds ${CONSTANTS.GARAGE_CAP}. Melt or fence one first.`);
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
    await client.query('INSERT INTO cars (id, character_id, model_id, trim_id, dmg) VALUES ($1,$2,$3,$4,$5)',
      [carId, ch.id, model.id, trim.id, dmg]);
    h.owned.cars.push({ id: carId, model_id: model.id, trim_id: trim.id, dmg });
    await h.rngLog(client, ch.id, 'gta', roll, 'success');
    await h.bumpDaily(client, ch.id, 'gta');
    await bumpFamilyTask(client, h, 'gta', 1);
    return { ok: true, success: true, car: { id: carId, model: model.id, trim: trim.id, dmg, rare: !!model.rare } };
  }
  const stint = 15 + Math.floor(Math.random() * 16); // 15–30s
  ch.jail_until = new Date(Date.now() + stint * 1000);
  await h.rngLog(client, ch.id, 'gta', roll, 'fail');
  return { ok: true, success: false, jailSeconds: stint };
}

function findCar(h, carId) {
  const car = h.owned.cars.find((c) => c.id === carId);
  if (!car) throw new GameError('no_car', 'No such car in the garage.');
  return car;
}
async function removeCar(client, h, carId) {
  await client.query('DELETE FROM cars WHERE id=$1', [carId]);
  h.owned.cars = h.owned.cars.filter((c) => c.id !== carId);
}

export async function meltCar(ch, carId, client, h) {
  const car = findCar(h, carId);
  const yieldRounds = carMelt(car.model_id, car.trim_id, car.dmg);
  // §7.5: in a family, 25% of the rounds tithe to the armory and the treasury is
  // credited $30/round — atomically, in this same transaction.
  const tithe = h.owned.gangId ? Math.floor(yieldRounds * CONSTANTS.MELT_TITHE) : 0;
  const keep = yieldRounds - tithe;
  ch.ammo = Number(ch.ammo || 0) + keep;
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
  await h.bumpDaily(client, ch.id, 'melt');
  await bumpFamilyTask(client, h, 'melt', yieldRounds);
  return { ok: true, rounds: keep, tithe };
}

export async function repairCar(ch, carId, client, h) {
  const car = findCar(h, carId);
  if ((car.dmg || 0) <= 0) throw new GameError('clean', 'Not a scratch on it.');
  const model = carOf(car.model_id);
  const cost = Math.max(50, Math.floor((car.dmg / 100) * carVal(car.model_id, car.trim_id) * 0.2));
  if (Number(ch.cash) < cost) throw new GameError('cash', `The shop wants $${cost}.`);
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
  const gross = Math.floor(carVal(car.model_id, car.trim_id) * 0.5 * (1 - (car.dmg || 0) / 100) * (cityEventOf(dayOf()).fenceMult || 1));
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
  // Old Foundry turf: crafts cost 25% less cash for the holding family
  const cost = (h.owned.held || []).includes('foundry') ? Math.floor(c.cost * 0.75) : c.cost;
  if (Number(ch.cb || 0) < c.cb) throw new GameError('cb', `Need ${c.cb} crates of contraband.`);
  if (Number(ch.cash) < cost) throw new GameError('cash', 'Not enough pocket cash for materials.');
  ch.cb = Number(ch.cb) - c.cb;
  ch.cash = Number(ch.cash) - cost;
  const have = (h.owned.items[itemId] || 0) + 1;
  h.owned.items[itemId] = have;
  await setItem(client, ch.id, itemId, have);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: `craft:${itemId}` });
  await h.ledger(client, { characterId: ch.id, currency: 'cb', amount: -c.cb, reason: `craft:${itemId}` });
  await h.bumpDaily(client, ch.id, 'craft');
  return { ok: true, item: itemId };
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
  return { ok: true, ammo: 30 };
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
  const cap = cargoCapacity(h.owned.assets);
  if (cargoCount(h.owned.cargo) + n > cap) throw new GameError('cargo', `The trunk holds ${cap} units. Better Wheels carry more.`);
  const unit = Math.round(goodPriceOf(goodId, ch.loc) * turfMult(h.owned.held || [], ch.loc, 'buy'));
  const cost = unit * n, fee = Math.ceil(cost * 0.01), tax = Math.ceil(cost * 0.01);
  if (Number(ch.cash) < cost + fee + tax) throw new GameError('cash', `That runs $${cost + fee + tax} with the 2% house take.`);
  ch.cash = Number(ch.cash) - cost - fee - tax;
  const have = (h.owned.cargo[goodId] || 0) + n;
  h.owned.cargo[goodId] = have;
  await setCargo(client, ch.id, goodId, have);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -(cost + fee + tax), reason: `goods:buy:${goodId}` });
  await takeHouse(client, tax);
  return { ok: true, unit, qty: n, spent: cost + fee + tax };
}

export async function sellGood(ch, goodId, qty, client, h) {
  const g = GOODS.find((x) => x.id === goodId);
  if (!g) throw new GameError('bad_good', 'No such good.');
  const have = h.owned.cargo[goodId] || 0;
  const n = Math.min(Math.max(1, Math.floor(Number(qty) || 0)), have);
  if (n <= 0) throw new GameError('none', 'Nothing of that in the trunk.');
  const ev = cityEventOf(dayOf());
  const unit = Math.round(goodPriceOf(goodId, ch.loc) * turfMult(h.owned.held || [], ch.loc, 'sell') * (ev.tradeMult || 1) * (ch.path === 'ledger' ? 1.05 : 1));
  const gross = unit * n, fee = Math.ceil(gross * 0.01), tax = Math.ceil(gross * 0.01);
  const net = gross - fee - tax;
  ch.cash = Number(ch.cash) + net;
  const left = have - n;
  h.owned.cargo[goodId] = left;
  await setCargo(client, ch.id, goodId, left);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: net, reason: `goods:sell:${goodId}` });
  await takeHouse(client, tax);
  await h.bumpDaily(client, ch.id, 'goods');
  return { ok: true, unit, qty: n, earned: net };
}

// ═══════════════════ RACKETS & ASSETS (§5.4) ═══════════════════
export async function buyRacket(ch, racketId, client, h) {
  const r = RACKETS.find((x) => x.id === racketId);
  if (!r) throw new GameError('bad_racket', 'No such racket.');
  if (h.owned.rackets.includes(r.id)) throw new GameError('owned', 'You already run that.');
  if (levelOf(Number(ch.respect)) < r.lvl) throw new GameError('level', `Need level ${r.lvl}.`);
  if (Number(ch.cash) < r.cost) throw new GameError('cash', 'Not enough pocket cash.');
  ch.cash = Number(ch.cash) - r.cost;
  await client.query('INSERT INTO character_rackets (character_id, racket_id) VALUES ($1,$2)', [ch.id, r.id]);
  h.owned.rackets.push(r.id);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -r.cost, reason: `racket:buy:${r.id}` });
  return { ok: true, racket: r.id, income: r.income };
}

export async function buyAsset(ch, assetId, client, h) {
  const a = ASSETS.find((x) => x.id === assetId);
  if (!a) throw new GameError('bad_asset', 'No such asset.');
  if (h.owned.assets.includes(a.id)) throw new GameError('owned', 'You already own that.');
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

// ═══════════════════ AMM SWAP (§7.12) ═══════════════════
// Constant-product pool, single row, SELECT … FOR UPDATE. 1% dev + 1% street tax
// each direction, taken in cash. Min swap $500 (buy side, per prototype).
export async function swap(ch, direction, amount, client, h) {
  if (direction !== 'buy' && direction !== 'sell') throw new GameError('bad_dir', "Direction must be 'buy' or 'sell'.");
  const amt = Math.floor(Number(amount));
  if (!(amt > 0)) throw new GameError('amount', 'Positive amounts only.');
  const pool = (await client.query('SELECT * FROM amm_pool WHERE id=1 FOR UPDATE')).rows[0];
  const c = Number(pool.cash_reserve), o = Number(pool.omr_reserve), k = c * o;

  if (direction === 'buy') {
    if (amt < CONSTANTS.SWAP_MIN) throw new GameError('min', `Minimum swap is $${CONSTANTS.SWAP_MIN}.`);
    if (Number(ch.cash) < amt) throw new GameError('cash', 'Not that much in pocket.');
    const fee = Math.ceil(amt * 0.01), tax = Math.ceil(amt * 0.01), netIn = amt - fee - tax;
    const out = o - k / (c + netIn);
    if (!(out > 0)) throw new GameError('pool', "The pool couldn't fill that.");
    await client.query('UPDATE amm_pool SET cash_reserve=$1, omr_reserve=$2 WHERE id=1', [c + netIn, o - out]);
    ch.cash = Number(ch.cash) - amt;
    h.acct.omr = Number(h.acct.omr) + out;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -amt, reason: 'swap:buy' });
    await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: out, reason: 'swap:buy' });
    await takeHouse(client, tax);
    return { ok: true, spentCash: amt, gotOmr: out, price: (c + netIn) / (o - out) };
  }
  // sell: amt is $OMR in
  if (Number(h.acct.omr) < amt) throw new GameError('omr', 'Not that much $OMR.');
  const gross = c - k / (o + amt);
  if (!(gross > 0)) throw new GameError('pool', "The pool couldn't fill that.");
  const fee = Math.ceil(gross * 0.01), tax = Math.ceil(gross * 0.01), net = Math.floor(gross - fee - tax);
  // the buy side has a $500 minimum; the sell side had none, so a dust sale could
  // yield net ≤ 0 (ceil fees > gross) — the seller would burn $OMR and be DEBITED cash
  if (net <= 0) throw new GameError('min', 'That sale is too small to clear the 2% house take.');
  h.acct.omr = Number(h.acct.omr) - amt;
  ch.cash = Number(ch.cash) + net;
  await client.query('UPDATE amm_pool SET cash_reserve=$1, omr_reserve=$2 WHERE id=1', [c - gross, o + amt]);
  await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: -amt, reason: 'swap:sell' });
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: net, reason: 'swap:sell' });
  await takeHouse(client, tax);
  return { ok: true, soldOmr: amt, gotCash: net, price: (c - gross) / (o + amt) };
}

// ═══════════════════ STAKING (§7.1 / §5.4) ═══════════════════
export function stake(ch, amount, client, h) {
  const a = Math.min(Math.floor(Number(amount) * 1e6) / 1e6, Number(h.acct.omr));
  if (!(a > 0)) throw new GameError('omr', 'Nothing to stake.');
  h.acct.omr = Number(h.acct.omr) - a;
  h.acct.staked = Number(h.acct.staked) + a;
  return { ok: true, staked: a }; // internal move, no faucet/sink
}
export async function unstake(ch, client, h) {
  const staked = Number(h.acct.staked), rewards = Number(h.acct.rewards);
  if (staked <= 0 && rewards <= 0) throw new GameError('none', 'Nothing staked.');
  h.acct.omr = Number(h.acct.omr) + staked + rewards;
  h.acct.staked = 0; h.acct.rewards = 0;
  if (rewards > 0) await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: rewards, reason: 'stake:reward' });
  return { ok: true, returned: staked, rewards };
}
export async function claimRewards(ch, client, h) {
  const rewards = Number(h.acct.rewards);
  if (!(rewards > 0)) throw new GameError('none', 'No rewards to claim.');
  h.acct.omr = Number(h.acct.omr) + rewards;
  h.acct.rewards = 0;
  await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: rewards, reason: 'stake:reward' });
  return { ok: true, claimed: rewards };
}

// ═══════════════════ THE ARMORY (§5.2) ═══════════════════
export async function buyGun(ch, gunId, client, h) {
  const g = GUNS.find((x) => x.id === gunId);
  if (!g) throw new GameError('bad_gun', 'No such piece.');
  if (h.owned.guns.includes(gunId)) throw new GameError('owned', 'You already own that piece.');
  if (Number(ch.cash) < g.cash) throw new GameError('cash', 'The dealer doesn\'t extend credit.');
  if ((Number(ch.cb) || 0) < g.crates) throw new GameError('cb', `The dealer wants ${g.crates} crates on top of the cash.`);
  ch.cash = Number(ch.cash) - g.cash;
  ch.cb = Number(ch.cb) - g.crates;
  await client.query('INSERT INTO character_guns (character_id, gun_id) VALUES ($1,$2)', [ch.id, gunId]);
  h.owned.guns.push(gunId);
  if (!ch.gun) ch.gun = gunId; // first iron auto-equips (v24)
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -g.cash, reason: `gun:buy:${gunId}` });
  await h.ledger(client, { characterId: ch.id, currency: 'cb', amount: -g.crates, reason: `gun:buy:${gunId}` });
  return { ok: true, gun: gunId, equipped: ch.gun === gunId };
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
  if (Number(h.acct.omr) < v.omr) throw new GameError('omr', `The ${v.name} runs ${v.omr} $OMR.`);
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
  return { ok: true, ammo: 50 };
}

// ═══════════════════ NFT GEAR MINT (§5.4) ═══════════════════
export async function mintGear(ch, gearId, client, h) {
  const g = gearOf(gearId);
  if (!g) throw new GameError('bad_gear', 'No such gear.');
  if (h.owned.gear.includes(gearId)) throw new GameError('owned', 'You already hold that piece.');
  if (Number(h.acct.omr) < g.price) throw new GameError('omr', `That mints for ${g.price} $OMR.`);
  h.acct.omr = Number(h.acct.omr) - g.price;
  await client.query('INSERT INTO account_gear (account_id, gear_id) VALUES ($1,$2)', [h.accountId, gearId]);
  h.owned.gear.push(gearId);
  await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: -g.price, reason: `gear:mint:${gearId}` });
  return { ok: true, gear: gearId, stat: g.stat, boost: g.boost };
}

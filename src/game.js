// M1 core + shared transaction machinery. Every formula cites spec §7 / prototype v24.
import crypto from 'node:crypto';
import { CRIMES, DISTRICTS, CONSTANTS, levelOf, rankIdxOf, cityEventOf, dayOf,
         assetEnergyCap, effStat, assetsValue, cargoCapacity } from './rules.js';
import { accrue } from './accrual.js';

const uid = () => crypto.randomUUID();
export class GameError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

export async function ledger(client, { characterId = null, accountId = null, currency, amount, reason, counterparty = null }) {
  await client.query(
    'INSERT INTO transactions (id, character_id, account_id, currency, amount, reason, counterparty) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [uid(), characterId, accountId, currency, amount, reason, counterparty]);
}
export async function rngLog(client, characterId, action, roll, outcome) {
  await client.query('INSERT INTO rng_audit (id, character_id, action, roll, outcome) VALUES ($1,$2,$3,$4,$5)',
    [uid(), characterId, action, roll, outcome]);
}

const idList = (rows, col) => rows.map((r) => r[col]);
const cargoMap = (rows) => Object.fromEntries(rows.map((r) => [r.good_id, Number(r.qty)]));
const itemMap = (rows) => Object.fromEntries(rows.map((r) => [r.item_id, Number(r.qty)]));

// Load-and-lock the living character + its account, accrue both, hand to fn, persist.
// One DB transaction per action (spec §10.1). Child tables are loaded for the action
// to read; the action mutates them via `client` and updates h.owned so the view is fresh.
export async function withCharacter(pool, accountId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM characters WHERE account_id = $1 AND alive FOR UPDATE', [accountId]);
    if (!r.rows.length) throw new GameError('no_character', 'Create a character first.');
    const ch = r.rows[0];
    const acct = (await client.query('SELECT * FROM account_persistent WHERE account_id = $1 FOR UPDATE', [accountId])).rows[0];

    const [rk, as, cars, cargo, items, gear] = await Promise.all([
      client.query('SELECT racket_id FROM character_rackets WHERE character_id=$1', [ch.id]),
      client.query('SELECT asset_id FROM character_assets WHERE character_id=$1', [ch.id]),
      client.query('SELECT * FROM cars WHERE character_id=$1 ORDER BY created_at', [ch.id]),
      client.query('SELECT good_id, qty FROM character_cargo WHERE character_id=$1 AND qty>0', [ch.id]),
      client.query('SELECT item_id, qty FROM character_items WHERE character_id=$1 AND qty>0', [ch.id]),
      client.query('SELECT gear_id FROM account_gear WHERE account_id=$1', [accountId]),
    ]);
    const owned = {
      rackets: idList(rk.rows, 'racket_id'), assets: idList(as.rows, 'asset_id'),
      cars: cars.rows, cargo: cargoMap(cargo.rows), items: itemMap(items.rows),
      gear: idList(gear.rows, 'gear_id'),
    };

    accrue(ch, acct, { rackets: owned.rackets, assets: owned.assets });
    // §7.1 accrued racket/front income is a faucet — record it so the ledger balances
    if (ch._accruedIncome > 0)
      await ledger(client, { characterId: ch.id, currency: 'cash', amount: ch._accruedIncome, reason: 'racket:income' });

    const h = { ledger, rngLog, events: [], acct, owned, accountId };
    const result = await fn(ch, client, h);

    await persistCharacter(client, ch);
    await client.query('UPDATE account_persistent SET omr=$2, staked=$3, rewards=$4 WHERE account_id=$1',
      [accountId, acct.omr, acct.staked, acct.rewards]);
    await client.query('COMMIT');
    return { character: view(ch, acct, owned), events: h.events, ...result };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

async function persistCharacter(client, ch) {
  await client.query(
    `UPDATE characters SET respect=$2, energy=$3, nerve=$4, health=$5, cash=$6, bank=$7,
      muscle=$8, cunning=$9, speed=$10, jail_until=$11, loc=$12, streak=$13, checkin_day=$14,
      lc_crime=$15, ammo=$16, cb=$17, heat=$18, trade_rep=$19, gta_at=$20, path=$21,
      last_accrued_at=$22 WHERE id=$1`,
    [ch.id, ch.respect, ch.energy, ch.nerve, ch.health, ch.cash, ch.bank,
     ch.muscle, ch.cunning, ch.speed, ch.jail_until, ch.loc, ch.streak, ch.checkin_day,
     ch.lc_crime, ch.ammo, ch.cb, ch.heat, ch.trade_rep, ch.gta_at, ch.path, ch.last_accrued_at]);
}

export function view(ch, acct = {}, owned = {}) {
  const lvl = levelOf(Number(ch.respect));
  const assets = owned.assets || [];
  const gear = owned.gear || [];
  const eff = (s) => effStat(ch[s], s, assets, gear);
  return { id: ch.id, name: ch.name, generation: ch.generation, level: lvl,
    respect: Number(ch.respect), energy: Math.floor(Number(ch.energy)), nerve: Math.floor(Number(ch.nerve)),
    health: Math.floor(Number(ch.health)), cash: Math.floor(Number(ch.cash)), bank: Math.floor(Number(ch.bank)),
    omr: Number(acct.omr || 0), staked: Number(acct.staked || 0), rewards: Number(acct.rewards || 0),
    stats: { muscle: ch.muscle, cunning: ch.cunning, speed: ch.speed },
    eff: { muscle: eff('muscle'), cunning: eff('cunning'), speed: eff('speed') },
    ammo: Number(ch.ammo || 0), cb: Number(ch.cb || 0), heat: Math.round(Number(ch.heat || 0)),
    tradeRep: Number(ch.trade_rep || 0),
    jailSeconds: ch.jail_until ? Math.max(0, Math.ceil((new Date(ch.jail_until) - Date.now()) / 1000)) : 0,
    loc: ch.loc, path: ch.path, title: ch.title, streak: ch.streak,
    maxEnergy: 50 + 2 * lvl + assetEnergyCap(assets), maxNerve: 10 + lvl,
    cargoCap: cargoCapacity(assets),
    rackets: owned.rackets || [], assets, cargo: owned.cargo || {}, items: owned.items || {}, gear,
    cars: (owned.cars || []).map((c) => ({ id: c.id, model: c.model_id, trim: c.trim_id, dmg: c.dmg })),
    netWorth: Math.floor(Number(ch.cash) + Number(ch.bank) + assetsValue(assets)),
    cityEvent: cityEventOf(dayOf()).id };
}

// ── §7.2 CRIME ──
export function doCrime(ch, crimeId, client, h) {
  const c = CRIMES.find((x) => x.id === crimeId);
  if (!c) throw new GameError('bad_crime', 'No such job.');
  const lvl = levelOf(Number(ch.respect));
  if (ch.jail_until && new Date(ch.jail_until) > new Date()) throw new GameError('jailed', 'You are in lockup.');
  if (lvl < c.lvl) throw new GameError('level', `That job needs level ${c.lvl}.`);
  if (Number(ch.nerve) < c.nerve) throw new GameError('nerve', `Takes ${c.nerve} nerve.`);
  ch.nerve = Number(ch.nerve) - c.nerve;
  const ev = cityEventOf(dayOf());
  const rIdx = rankIdxOf(lvl);
  const chance = Math.min(0.97, c.base + ch.cunning * 0.004 + ch.speed * 0.002 + (rIdx >= 9 ? 0.02 : 0)); // gang/turf mults in M3
  const roll = Math.random();
  return (async () => {
    if (roll < chance) {
      let take = Math.floor((c.cash[0] + Math.random() * (c.cash[1] - c.cash[0]))
        * (rIdx >= 1 ? 1.05 : 1) * (rIdx >= 8 ? 1.10 : 1) * (ev.jobPay || 1));
      const rep = Math.round(c.respect * (ev.crimeRep || 1));
      ch.cash = Number(ch.cash) + take; ch.respect = Number(ch.respect) + rep; ch.lc_crime += 1;
      await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: take, reason: `crime:${c.id}` });
      // §7.2 contraband crates: docks turf +50%, event cbMult; feed the workshop/exchange
      const pCrate = (0.25 + Number(ch.nerve) * 0.02) * (ev.cbMult || 1) * (ch.loc === 'docks' ? 1.5 : 1);
      let crates = 0;
      if (Math.random() < pCrate) {
        crates = 1 + Math.floor(Number(ch.nerve) / 8);
        ch.cb = Number(ch.cb || 0) + crates;
        await h.ledger(client, { characterId: ch.id, currency: 'cb', amount: crates, reason: `crime:${c.id}:cb` });
      }
      await h.rngLog(client, ch.id, `crime:${c.id}`, roll, 'success');
      return { ok: true, success: true, take, rep, crates };
    }
    const jailS = Math.round(c.jail * (ev.jailMult || 1) * (rIdx >= 5 ? 0.8 : 1));
    if (jailS > 0) ch.jail_until = new Date(Date.now() + jailS * 1000);
    await h.rngLog(client, ch.id, `crime:${c.id}`, roll, 'fail');
    return { ok: true, success: false, jailSeconds: jailS };
  })();
}

// ── §7.3 TRAIN ──
export function train(ch, stat) {
  if (!['muscle', 'cunning', 'speed'].includes(stat)) throw new GameError('bad_stat', 'No such stat.');
  if (ch.jail_until && new Date(ch.jail_until) > new Date()) throw new GameError('jailed', 'No gym in lockup.');
  if (Number(ch.energy) < 10) throw new GameError('energy', 'Too tired to train.');
  ch.energy = Number(ch.energy) - 10;
  const gain = Math.max(1, Math.round((1 + Math.random() * 2) * (200 / (200 + ch[stat]))));
  ch[stat] += gain;
  return { ok: true, stat, gain };
}

// ── §5.1 HEAL ──
export async function heal(ch, client, h) {
  const lvl = levelOf(Number(ch.respect));
  const cost = Math.floor((100 - Math.floor(Number(ch.health))) * 15 * (rankIdxOf(lvl) >= 4 ? 0.9 : 1));
  if (cost <= 0) throw new GameError('healthy', 'Already healthy.');
  if (Number(ch.cash) < cost) throw new GameError('cash', `The Doc wants $${cost}.`);
  ch.cash = Number(ch.cash) - cost; ch.health = 100;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'heal' });
  return { ok: true, cost };
}

// ── §7.4 CHECK-IN ──
export async function checkin(ch, client, h) {
  const today = dayOf();
  if (ch.checkin_day === today) throw new GameError('done', 'Already checked in today.');
  ch.streak = ch.checkin_day === today - 1 ? ch.streak + 1 : Math.max(1, Math.floor(ch.streak / 2)); // miss halves, never zero
  ch.checkin_day = today;
  const lvl = levelOf(Number(ch.respect));
  const pay = 250 * lvl + 100 * lvl * Math.min(ch.streak, 7);
  ch.cash = Number(ch.cash) + pay;
  ch.energy = Math.min(50 + 2 * lvl, Number(ch.energy) + 20);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: pay, reason: 'checkin' });
  return { ok: true, pay, streak: ch.streak };
}

// ── BANK & TRAVEL ──
export async function bank(ch, dir, amount, client, h) {
  amount = Math.floor(Number(amount));
  if (!(amount > 0)) throw new GameError('amount', 'Positive amounts only.');
  if (dir === 'deposit') {
    if (Number(ch.cash) < amount) throw new GameError('cash', 'Not that much in pocket.');
    ch.cash = Number(ch.cash) - amount; ch.bank = Number(ch.bank) + amount;
  } else {
    if (Number(ch.bank) < amount) throw new GameError('bank', 'Not that much banked.');
    ch.bank = Number(ch.bank) - amount; ch.cash = Number(ch.cash) + amount;
  }
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: 0, reason: `bank:${dir}:${amount}` });
  return { ok: true };
}
export async function travel(ch, district, client, h) {
  if (!DISTRICTS.find((d) => d.id === district)) throw new GameError('bad_district', 'No such district.');
  if (ch.loc === district) throw new GameError('there', 'You are already there.');
  if (ch.jail_until && new Date(ch.jail_until) > new Date()) throw new GameError('jailed', 'No travel from lockup.');
  if (Number(ch.cash) < CONSTANTS.TRAVEL_COST) throw new GameError('cash', `A ride costs $${CONSTANTS.TRAVEL_COST}.`);
  ch.cash = Number(ch.cash) - CONSTANTS.TRAVEL_COST; ch.loc = district;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -CONSTANTS.TRAVEL_COST, reason: 'travel' });
  return { ok: true, loc: district };
}

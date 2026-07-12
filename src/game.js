// M1 core + shared transaction machinery. Every formula cites spec §7 / prototype v24.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { CRIMES, DISTRICTS, CONSTANTS, levelOf, rankIdxOf, cityEventOf, dayOf,
         assetEnergyCap, effStat, assetsValue, cargoCapacity,
         gangLevelOf, roleMultOf, weekOf, familyTaskOf, M3 } from './rules.js';
import { accrue } from './accrual.js';

const uid = () => crypto.randomUUID();
export class GameError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

// In-process pub/sub feeding the websocket gateway (§5.6): 'me:{characterId}'
// for notifications, 'streets' for the public kill/bust feed, 'gang:{id}' updates.
export const bus = new EventEmitter();
bus.setMaxListeners(0);

// Write a notification row AND push it live if the player is connected.
// Delivery over the socket doesn't mark it delivered — GET /notifications does.
export async function notify(client, characterId, type, payload = {}) {
  await client.query('INSERT INTO notifications (id, character_id, type, payload) VALUES ($1,$2,$3,$4)',
    [uid(), characterId, type, JSON.stringify(payload)]);
  bus.emit(`me:${characterId}`, { type, payload });
}

// §5.5 weekly family contracts — the same actions that call bumpFamilyTask in v24
// (tribute $, crime, melt rounds, gta, jump, deal, recruit) progress the gang's task.
// Goal scales with roster size; completion pays +15,000 standing and +5 $OMR to the
// family reserve IF the event fund covers it. Caller must hold the character lock;
// the gang row is updated atomically inside the same transaction.
export async function bumpFamilyTask(client, h, kind, amount) {
  const gangId = h.owned?.gangId;
  if (!gangId || !(amount > 0)) return;
  const wk = weekOf();
  const task = familyTaskOf(wk);
  if (task.key !== kind) return;
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [gangId])).rows[0];
  if (!g) return;
  let prog = Number(g.weekly_progress), done = g.weekly_done;
  if (g.weekly_week !== wk) { prog = 0; done = false; }             // new week, new contract
  if (done) return;
  const members = Number((await client.query('SELECT COUNT(*) n FROM gang_members WHERE gang_id=$1', [gangId])).rows[0].n);
  const effGoal = task.goal * Math.max(1, Math.ceil(members / 4));
  prog += amount;
  let completed = false, omrPaid = 0;
  if (prog >= effGoal) {
    completed = true; done = true;
    const fund = (await client.query('SELECT * FROM street_tax WHERE id=1 FOR UPDATE')).rows[0];
    if (Number(fund.fund) >= M3.WEEKLY_OMR) {
      omrPaid = M3.WEEKLY_OMR;
      await client.query('UPDATE street_tax SET fund = fund - $1 WHERE id=1', [omrPaid]);
    }
    await client.query(
      'UPDATE gangs SET weekly_week=$2, weekly_progress=$3, weekly_done=true, lifetime_tribute = lifetime_tribute + $4, omr_reserve = omr_reserve + $5 WHERE id=$1',
      [gangId, wk, prog, M3.WEEKLY_STANDING, omrPaid]);
    bus.emit(`gang:${gangId}`, { type: 'weekly_done', task: task.id, omr: omrPaid });
  } else {
    await client.query('UPDATE gangs SET weekly_week=$2, weekly_progress=$3, weekly_done=false WHERE id=$1', [gangId, wk, prog]);
  }
  return { completed, prog, effGoal, omrPaid };
}

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

// Everything a character owns or belongs to, loaded inside the caller's txn.
export async function loadOwned(client, ch) {
  const [rk, as, cars, cargo, items, gear, guns, gm] = await Promise.all([
    client.query('SELECT racket_id FROM character_rackets WHERE character_id=$1', [ch.id]),
    client.query('SELECT asset_id FROM character_assets WHERE character_id=$1', [ch.id]),
    client.query('SELECT * FROM cars WHERE character_id=$1 ORDER BY created_at', [ch.id]),
    client.query('SELECT good_id, qty FROM character_cargo WHERE character_id=$1 AND qty>0', [ch.id]),
    client.query('SELECT item_id, qty FROM character_items WHERE character_id=$1 AND qty>0', [ch.id]),
    client.query('SELECT gear_id FROM account_gear WHERE account_id=$1', [ch.account_id]),
    client.query('SELECT gun_id FROM character_guns WHERE character_id=$1', [ch.id]),
    client.query('SELECT gang_id, role FROM gang_members WHERE character_id=$1', [ch.id]),
  ]);
  const gangId = gm.rows[0]?.gang_id || null;
  let gang = null, held = [];
  if (gangId) {
    gang = (await client.query('SELECT * FROM gangs WHERE id=$1', [gangId])).rows[0] || null;
    held = idList((await client.query('SELECT id FROM districts WHERE holder_gang=$1', [gangId])).rows, 'id');
  }
  return {
    rackets: idList(rk.rows, 'racket_id'), assets: idList(as.rows, 'asset_id'),
    cars: cars.rows, cargo: cargoMap(cargo.rows), items: itemMap(items.rows),
    gear: idList(gear.rows, 'gear_id'), guns: idList(guns.rows, 'gun_id'),
    gangId, gangRole: gm.rows[0]?.role || null, gang, held,
  };
}

async function accrueAndLedger(client, ch, acct, owned) {
  accrue(ch, acct, { rackets: owned.rackets, assets: owned.assets, held: owned.held });
  // §7.1 accrued racket/front income is a faucet — record it so the ledger balances
  if (ch._accruedIncome > 0)
    await ledger(client, { characterId: ch.id, currency: 'cash', amount: ch._accruedIncome, reason: 'racket:income' });
}

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
    const owned = await loadOwned(client, ch);
    await accrueAndLedger(client, ch, acct, owned);

    const h = { ledger, rngLog, notify, events: [], acct, owned, accountId };
    const result = await fn(ch, client, h);

    if (ch.alive !== false) await persistCharacter(client, ch); // a killed row is finalized by the estate
    await client.query('UPDATE account_persistent SET omr=$2, staked=$3, rewards=$4 WHERE account_id=$1',
      [accountId, acct.omr, acct.staked, acct.rewards]);
    await client.query('COMMIT');
    return { character: view(ch, acct, owned), events: h.events, ...result };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// Two-party actions (§10.1): lock BOTH character rows in stable id order, then both
// account rows in stable id order — every multi-lock txn follows characters-then-
// accounts so lock acquisition can never cycle. Both sides accrue (§7.1: a player is
// "touched" when targeted). fn gets (ch, victim, client, h) with h.victimOwned loaded.
export async function withTwoCharacters(pool, accountId, targetCharacterId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mine = await client.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [accountId]);
    if (!mine.rows.length) throw new GameError('no_character', 'Create a character first.');
    const myId = mine.rows[0].id;
    if (myId === targetCharacterId) throw new GameError('self', 'Not on yourself.');

    const lockChar = async (id) =>
      (await client.query('SELECT * FROM characters WHERE id=$1 AND alive FOR UPDATE', [id])).rows[0];
    const [firstId, secondId] = [myId, targetCharacterId].sort();
    const first = await lockChar(firstId), second = await lockChar(secondId);
    const ch = firstId === myId ? first : second;
    const victim = firstId === myId ? second : first;
    if (!ch) throw new GameError('no_character', 'Create a character first.');
    if (!victim) throw new GameError('no_target', "They're gone — nobody by that name on the streets.");

    const lockAcct = async (accId) =>
      (await client.query('SELECT * FROM account_persistent WHERE account_id=$1 FOR UPDATE', [accId])).rows[0];
    const [a1, a2] = [ch.account_id, victim.account_id].sort();
    const accts = { [a1]: await lockAcct(a1), [a2]: await lockAcct(a2) };
    const acct = accts[ch.account_id], victimAcct = accts[victim.account_id];

    const owned = await loadOwned(client, ch);
    const victimOwned = await loadOwned(client, victim);
    await accrueAndLedger(client, ch, acct, owned);
    await accrueAndLedger(client, victim, victimAcct, victimOwned);

    const h = { ledger, rngLog, notify, events: [], acct, owned, accountId,
                victimAcct, victimOwned };
    const result = await fn(ch, victim, client, h);

    await persistCharacter(client, ch);
    if (victim.alive !== false) await persistCharacter(client, victim); // death finalizes its own row
    for (const [accId, a] of Object.entries(accts))
      await client.query('UPDATE account_persistent SET omr=$2, staked=$3, rewards=$4, prestige=$5, deaths=$6 WHERE account_id=$1',
        [accId, a.omr, a.staked, a.rewards, a.prestige, a.deaths]);
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
      gun=$22, vest=$23, shoot_cd_until=$24, busts=$25, hosp_until=$26,
      last_accrued_at=$27 WHERE id=$1`,
    [ch.id, ch.respect, ch.energy, ch.nerve, ch.health, ch.cash, ch.bank,
     ch.muscle, ch.cunning, ch.speed, ch.jail_until, ch.loc, ch.streak, ch.checkin_day,
     ch.lc_crime, ch.ammo, ch.cb, ch.heat, ch.trade_rep, ch.gta_at, ch.path,
     ch.gun, ch.vest, ch.shoot_cd_until, ch.busts, ch.hosp_until, ch.last_accrued_at]);
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
    tradeRep: Number(ch.trade_rep || 0), busts: Number(ch.busts || 0),
    gun: ch.gun || null, vest: ch.vest || null, guns: owned.guns || [],
    jailSeconds: ch.jail_until ? Math.max(0, Math.ceil((new Date(ch.jail_until) - Date.now()) / 1000)) : 0,
    hospSeconds: ch.hosp_until ? Math.max(0, Math.ceil((new Date(ch.hosp_until) - Date.now()) / 1000)) : 0,
    shootCdSeconds: ch.shoot_cd_until ? Math.max(0, Math.ceil((new Date(ch.shoot_cd_until) - Date.now()) / 1000)) : 0,
    loc: ch.loc, path: ch.path, title: ch.title, streak: ch.streak,
    maxEnergy: 50 + 2 * lvl + assetEnergyCap(assets), maxNerve: 10 + lvl,
    cargoCap: cargoCapacity(assets),
    rackets: owned.rackets || [], assets, cargo: owned.cargo || {}, items: owned.items || {}, gear,
    cars: (owned.cars || []).map((c) => ({ id: c.id, model: c.model_id, trim: c.trim_id, dmg: c.dmg })),
    gang: owned.gang ? { id: owned.gang.id, name: owned.gang.name, tag: owned.gang.tag, role: owned.gangRole,
      treasury: Math.floor(Number(owned.gang.treasury)), ammoBank: Number(owned.gang.ammo_bank),
      held: owned.held } : null,
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
  const held = h.owned?.held || [];
  const eff = (s) => effStat(ch[s], s, h.owned?.assets || [], h.owned?.gear || []);
  // §7.2 full chance: stats + gang level (treasury tiers) + Brick Yards turf + rank
  const gangLevel = h.owned?.gang ? gangLevelOf(h.owned.gang.treasury) : 0;
  const chance = Math.min(0.97, c.base + eff('cunning') * 0.004 + eff('speed') * 0.002
    + gangLevel * 0.02 + (held.includes('brick') ? 0.02 : 0) + (rIdx >= 9 ? 0.02 : 0));
  const roll = Math.random();
  return (async () => {
    if (roll < chance) {
      let take = Math.floor((c.cash[0] + Math.random() * (c.cash[1] - c.cash[0]))
        * (held.includes('canal') ? 1.1 : 1)                       // Canal Row turf +10%
        * (rIdx >= 1 ? 1.05 : 1) * (rIdx >= 8 ? 1.10 : 1)
        * roleMultOf(h.owned?.gangRole) * (ev.jobPay || 1));
      const rep = Math.round(c.respect * (ev.crimeRep || 1));
      ch.cash = Number(ch.cash) + take; ch.respect = Number(ch.respect) + rep; ch.lc_crime += 1;
      await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: take, reason: `crime:${c.id}` });
      // §7.2 contraband crates: Docks turf ×1.5, event cbMult; feed the workshop/exchange
      const pCrate = (0.25 + Number(ch.nerve) * 0.02) * (ev.cbMult || 1) * (held.includes('docks') ? 1.5 : 1);
      let crates = 0;
      if (Math.random() < pCrate) {
        crates = 1 + Math.floor(Number(ch.nerve) / 8);
        ch.cb = Number(ch.cb || 0) + crates;
        await h.ledger(client, { characterId: ch.id, currency: 'cb', amount: crates, reason: `crime:${c.id}:cb` });
      }
      await h.rngLog(client, ch.id, `crime:${c.id}`, roll, 'success');
      await bumpFamilyTask(client, h, 'crime', 1);
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

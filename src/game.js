// M1 game actions — every formula cites spec §7 / prototype v24.
import crypto from 'node:crypto';
import { CRIMES, DISTRICTS, CONSTANTS, levelOf, rankIdxOf, cityEventOf, dayOf } from './rules.js';
import { accrue } from './accrual.js';

const uid = () => crypto.randomUUID();
export class GameError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

async function ledger(client, { characterId = null, accountId = null, currency, amount, reason, counterparty = null }) {
  await client.query(
    'INSERT INTO transactions (id, character_id, account_id, currency, amount, reason, counterparty) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [uid(), characterId, accountId, currency, amount, reason, counterparty]);
}
async function rngLog(client, characterId, action, roll, outcome) {
  await client.query('INSERT INTO rng_audit (id, character_id, action, roll, outcome) VALUES ($1,$2,$3,$4,$5)',
    [uid(), characterId, action, roll, outcome]);
}

// Load-and-lock the living character, accrue, hand to fn, persist. One transaction.
export async function withCharacter(pool, accountId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM characters WHERE account_id = $1 AND alive FOR UPDATE', [accountId]);
    if (!r.rows.length) throw new GameError('no_character', 'Create a character first.');
    const ch = accrue(r.rows[0]);
    const events = [];
    const result = await fn(ch, client, { ledger, rngLog, events });
    await client.query(
      `UPDATE characters SET respect=$2, energy=$3, nerve=$4, health=$5, cash=$6, bank=$7,
        muscle=$8, cunning=$9, speed=$10, jail_until=$11, loc=$12, streak=$13, checkin_day=$14,
        lc_crime=$15, last_accrued_at=$16 WHERE id=$1`,
      [ch.id, ch.respect, ch.energy, ch.nerve, ch.health, ch.cash, ch.bank,
       ch.muscle, ch.cunning, ch.speed, ch.jail_until, ch.loc, ch.streak, ch.checkin_day,
       ch.lc_crime, ch.last_accrued_at]);
    await client.query('COMMIT');
    return { character: view(ch), events, ...result };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

export function view(ch) {
  const lvl = levelOf(Number(ch.respect));
  return { id: ch.id, name: ch.name, generation: ch.generation, level: lvl,
    respect: Number(ch.respect), energy: Math.floor(Number(ch.energy)), nerve: Math.floor(Number(ch.nerve)),
    health: Math.floor(Number(ch.health)), cash: Math.floor(Number(ch.cash)), bank: Math.floor(Number(ch.bank)),
    stats: { muscle: ch.muscle, cunning: ch.cunning, speed: ch.speed },
    jailSeconds: ch.jail_until ? Math.max(0, Math.ceil((new Date(ch.jail_until) - Date.now()) / 1000)) : 0,
    loc: ch.loc, path: ch.path, title: ch.title, streak: ch.streak,
    maxEnergy: 50 + 2 * lvl, maxNerve: 10 + lvl,
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
      await h.rngLog(client, ch.id, `crime:${c.id}`, roll, 'success');
      return { ok: true, success: true, take, rep };
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

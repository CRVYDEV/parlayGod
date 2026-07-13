// M4 — THE KITCHEN (§7.10, §5.3). Fictional period product lines; an economy of
// risk, not a recipe. Every formula cites spec §7.10 / prototype v24.
import crypto from 'node:crypto';
import { GameError, bumpFamilyTask } from './game.js';
import {
  DRUGS, KITCHENS, TRADE_RANKS, CONSTANTS, M4,
  drugOf, kitchenOf, tradeRankIdx, cityEventOf, dayOf,
  makingsPriceOf, demandOf, effStat,
} from './rules.js';

const uid = () => crypto.randomUUID();
const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();

async function takeHouse(client, tax) {
  if (tax > 0) await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [tax]);
}

// ── THE SUPPLIER — makings (§5.3): price drifts ±25% per 4h block, rank-gated ──
export async function buyMakings(ch, drugId, qty, client, h) {
  const d = drugOf(drugId);
  if (!d) throw new GameError('bad_drug', 'No such line.');
  const n = Math.max(1, Math.floor(Number(qty) || 0));
  if (tradeRankIdx(Number(ch.trade_rep || 0)) < d.unlock)
    throw new GameError('rank', `The Supplier doesn't show ${d.name} to a ${TRADE_RANKS[tradeRankIdx(Number(ch.trade_rep || 0))].name}. Move more product first.`);
  const unit = Math.round(makingsPriceOf(drugId) * (cityEventOf(dayOf()).mkMult || 1));
  const cost = unit * n;
  if (Number(ch.cash) < cost) throw new GameError('cash', `${n} units of makings run $${cost} right now.`);
  ch.cash = Number(ch.cash) - cost;
  h.owned.makings[drugId] = (h.owned.makings[drugId] || 0) + n;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: `makings:${drugId}` });
  return { ok: true, unit, qty: n, cost };
}

// ── LAB LADDER (§5.3): sequential tiers; the top two burn $OMR ──
export async function upgradeLab(ch, client, h) {
  const curIdx = ch.lab ? KITCHENS.findIndex((k) => k.id === ch.lab) : -1;
  const next = KITCHENS[curIdx + 1];
  if (!next) throw new GameError('maxed', 'The Cathedral is as high as chemistry goes.');
  if (Number(ch.cash) < next.cost) throw new GameError('cash', `The ${next.name} runs $${next.cost}.`);
  if (Number(h.acct.omr) < (next.omr || 0)) throw new GameError('omr', `The ${next.name} also takes ${next.omr} $OMR.`);
  ch.cash = Number(ch.cash) - next.cost;
  ch.lab = next.id;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -next.cost, reason: `lab:${next.id}` });
  if (next.omr > 0) {
    h.acct.omr = Number(h.acct.omr) - next.omr;
    await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: -next.omr, reason: `lab:${next.id}` });
  }
  return { ok: true, lab: next.id, cap: next.cap };
}

// ── COOK (§7.10): rank-gated, batch cap by kitchen, 1 📦/20 units, prod = demo×12 ──
export async function cook(ch, drugId, qty, client, h) {
  const k = kitchenOf(ch.lab);
  if (!k) throw new GameError('no_lab', 'You need a Kitchen first — even a bathtub.');
  if (h.owned.batch) throw new GameError('cooking', "The Kitchen's already working. One batch at a time.");
  if (jailed(ch)) throw new GameError('jailed', 'Nothing cooks while you\'re in county.');
  const d = drugOf(drugId);
  if (!d) throw new GameError('bad_drug', 'No such line.');
  if (tradeRankIdx(Number(ch.trade_rep || 0)) < d.unlock)
    throw new GameError('rank', `You don't have the standing to move ${d.name} yet.`);
  const have = h.owned.makings[drugId] || 0;
  if (have < 1) throw new GameError('makings', `No ${d.name} makings on the shelf. See The Supplier.`);
  const n = Math.max(1, Math.min(Math.floor(Number(qty) || 0) || k.cap, k.cap, have));
  const crates = Math.ceil(n / M4.BATCH_CRATE_UNITS);
  if ((Number(ch.cb) || 0) < crates) throw new GameError('cb', `Packaging a batch of ${n} takes ${crates} crates.`);
  ch.cb = Number(ch.cb) - crates;
  h.owned.makings[drugId] = have - n;
  await h.ledger(client, { characterId: ch.id, currency: 'cb', amount: -crates, reason: `cook:${drugId}` });
  const doneAt = new Date(Date.now() + k.mins * CONSTANTS.COOK_MULT * 60 * 1000); // §9: demo mins × 12
  const id = uid();
  await client.query('INSERT INTO batches (id, character_id, drug_id, qty, done_at) VALUES ($1,$2,$3,$4,$5)',
    [id, ch.id, drugId, n, doneAt]);
  h.owned.batch = { id, character_id: ch.id, drug_id: drugId, qty: n, done_at: doneAt };
  return { ok: true, qty: n, crates, readyAt: doneAt };
}

// ── COLLECT (§7.10): fire roll first, then quality; stash merges weighted-average ──
export async function collect(ch, client, h) {
  const b = h.owned.batch;
  const k = kitchenOf(ch.lab);
  if (!b || !k) throw new GameError('no_batch', 'Nothing on the burner.');
  if (new Date(b.done_at) > new Date())
    throw new GameError('cooking', `Not done. Chemistry doesn't negotiate — ${Math.ceil((new Date(b.done_at) - Date.now()) / 60000)} min.`);
  await client.query('DELETE FROM batches WHERE character_id=$1', [ch.id]);
  h.owned.batch = null;
  const fireRoll = Math.random();
  if (fireRoll < k.fire) {
    ch.health = Math.max(1, Number(ch.health) - 20);
    ch.heat = Math.min(100, Number(ch.heat || 0) + 5);
    await h.rngLog(client, ch.id, 'cook:fire', fireRoll, 'batch lost');
    return { ok: true, fire: true, qty: 0 };
  }
  const cunning = effStat(ch.cunning, 'cunning', h.owned.assets, h.owned.gear);
  const q = Math.min(1.6, Math.max(0.6,
    0.7 + cunning * 0.004 + k.q + (ch.path === 'kitchen' ? 0.15 : 0) + (Math.random() * 0.2 - 0.1)));
  const cur = h.owned.stash.find((s) => s.drug_id === b.drug_id);
  if (cur) {
    const total = Number(cur.qty) + Number(b.qty);
    cur.quality = (Number(cur.qty) * Number(cur.quality) + Number(b.qty) * q) / total;
    cur.qty = total;
  } else {
    h.owned.stash.push({ drug_id: b.drug_id, qty: Number(b.qty), quality: q });
  }
  await h.rngLog(client, ch.id, 'cook:collect', fireRoll, `q ${q.toFixed(2)}`);
  await h.bumpDaily(client, ch.id, 'cook');
  return { ok: true, fire: false, qty: Number(b.qty), quality: Math.round(q * 100) / 100 };
}

// ── DEAL (§7.10): demand × quality × event × trade-rank bonus; heat; nerve 1/10 ──
export async function deal(ch, drugId, qty, client, h) {
  const d = drugOf(drugId);
  if (!d) throw new GameError('bad_drug', 'No such line.');
  if (jailed(ch)) throw new GameError('jailed', 'No dealing from a cell.');
  const s = h.owned.stash.find((x) => x.drug_id === drugId);
  if (!s || Number(s.qty) < 1) throw new GameError('stash', `No ${d.name} in the stash.`);
  const n = Math.max(1, Math.min(Math.floor(Number(qty) || 0) || 1, Number(s.qty)));
  const nerveCost = Math.max(1, Math.ceil(n / 10));
  if (Number(ch.nerve) < nerveCost) throw new GameError('nerve', `Moving ${n} units takes ${nerveCost} nerve.`);
  const ev = cityEventOf(dayOf());
  const unit = d.base * demandOf(drugId, ch.loc) * Number(s.quality || 1) * (ev.drugDemand || 1)
    * (1 + TRADE_RANKS[tradeRankIdx(Number(ch.trade_rep || 0))].bonus);
  const gross = Math.floor(unit * n);
  const fee = Math.ceil(gross * 0.01), tax = Math.ceil(gross * 0.01);
  const net = gross - fee - tax;
  const heatGain = d.heat * n * 0.1 * (ev.drugHeat || 1) * (ch.path === 'kitchen' ? 0.75 : 1);
  ch.nerve = Number(ch.nerve) - nerveCost;
  ch.cash = Number(ch.cash) + net;
  ch.trade_rep = Number(ch.trade_rep || 0) + gross;   // rank climbs on GROSS
  ch.heat = Math.min(100, Number(ch.heat || 0) + heatGain);
  s.qty = Number(s.qty) - n;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: net, reason: `deal:${drugId}` });
  await takeHouse(client, tax);
  await h.track(client, ch.account_id, 'deal', { drug: drugId, units: n, heat: Math.round(heatGain * 10) / 10 });
  await h.bumpDaily(client, ch.id, 'deal');
  await bumpFamilyTask(client, h, 'deal', n);
  return { ok: true, units: n, earned: net, heat: Math.round(heatGain * 10) / 10,
    tradeRank: tradeRankIdx(Number(ch.trade_rep)) };
}

// ── CREW (§5.3): $50k × (crew+1), max 5 — they sell round the clock via accrual ──
export async function hireCrew(ch, client, h) {
  const crew = Number(ch.crew || 0);
  if (crew >= M4.CREW_MAX) throw new GameError('max', 'Five corners is all one person can keep honest.');
  const cost = M4.CREW_COST_STEP * (crew + 1);
  if (Number(ch.cash) < cost) throw new GameError('cash', `The next crew member wants $${cost} up front.`);
  ch.cash = Number(ch.cash) - cost;
  ch.crew = crew + 1;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'crew:hire' });
  return { ok: true, crew: ch.crew, cost };
}

// ── HEAT MANAGEMENT (§5.3) ──
export async function layLow(ch, client, h) {
  if (Number(ch.heat || 0) < 5) throw new GameError('cold', "You're already a ghost.");
  if (Number(ch.cash) < M4.LAYLOW_CASH) throw new GameError('cash', `Laying low takes $${M4.LAYLOW_CASH}.`);
  if (Number(ch.energy) < M4.LAYLOW_ENERGY) throw new GameError('energy', `Laying low takes ${M4.LAYLOW_ENERGY} energy.`);
  ch.cash = Number(ch.cash) - M4.LAYLOW_CASH;
  ch.energy = Number(ch.energy) - M4.LAYLOW_ENERGY;
  ch.heat = Math.max(0, Number(ch.heat) - M4.LAYLOW_COOL);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -M4.LAYLOW_CASH, reason: 'laylow' });
  return { ok: true, heat: Math.round(Number(ch.heat)) };
}

export async function cleanPapers(ch, client, h) {
  if (Number(ch.heat || 0) < 1) throw new GameError('cold', 'Your papers are already spotless.');
  if (Number(h.acct.omr) < M4.CLEANPAPERS_OMR) throw new GameError('omr', `Clean Papers cost ${M4.CLEANPAPERS_OMR} $OMR.`);
  h.acct.omr = Number(h.acct.omr) - M4.CLEANPAPERS_OMR;
  ch.heat = 0;
  await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: -M4.CLEANPAPERS_OMR, reason: 'cleanpapers' });
  return { ok: true, heat: 0 };
}

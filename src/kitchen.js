// M4 — THE KITCHEN (§7.10, §5.3). Fictional period product lines; an economy of
// risk, not a recipe. Every formula cites spec §7.10 / prototype v24.
import crypto from 'node:crypto';
import { GameError, bumpFamilyTask, skillMult, trunkCap, bumpMastery, masteryFx } from './game.js';
import {
  DRUGS, KITCHENS, TRADE_RANKS, CONSTANTS, M4, COMMISSION, SKILLS, KITCHEN,
  drugOf, kitchenOf, tradeRankIdx, cityEventOf, dayOf,
  makingsPriceOf, demandOf, effStat, crewWageOwed, crewCold, HONOR,
  labModuleCost, kingpinRankOf, seasonModOf, pathFx, pathAdd , jailed, safeHoused } from './rules.js';
import { activeDecree } from './commission.js';
import { logCollect } from './collection.js';

const uid = () => crypto.randomUUID();

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
  // LAB MODULE (Tier-4) — the Yield Manifold stretches the batch cap
  const cap = Math.floor(k.cap * (1 + Number(ch.lab_yield || 0) * KITCHEN.MODULES.yield.step));
  const n = Math.max(1, Math.min(Math.floor(Number(qty) || 0) || cap, cap, have));
  const crates = Math.ceil(n / M4.BATCH_CRATE_UNITS);
  if ((Number(ch.cb) || 0) < crates) throw new GameError('cb', `Packaging a batch of ${n} takes ${crates} crates.`);
  ch.cb = Number(ch.cb) - crates;
  h.owned.makings[drugId] = have - n;
  await h.ledger(client, { characterId: ch.id, currency: 'cb', amount: -crates, reason: `cook:${drugId}` });
  // TRADES perk (chemistry): a schooled cook runs the burner faster — pacing only; throughput
  // is still nerve-bounded at the corner, so the sim-signed deal curve is untouched
  const doneAt = new Date(Date.now() + Math.round(k.mins * CONSTANTS.COOK_MULT * masteryFx(h, 'chemistry') * pathFx(ch, 'cookTime')) * 60 * 1000); // §9: demo mins × 12 · PATHS v2 — the Wheel's no-patience handicap rides here
  const id = uid();
  await client.query('INSERT INTO batches (id, character_id, drug_id, qty, done_at) VALUES ($1,$2,$3,$4,$5)',
    [id, ch.id, drugId, n, doneAt]);
  h.owned.batch = { id, character_id: ch.id, drug_id: drugId, qty: n, done_at: doneAt };
  await logCollect(client, ch.account_id, 'drugs', drugId); // THE COLLECTION — first cook of each line
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
  // LAB MODULE (Tier-4) — the Purity Rig lifts the quality floor
  const q = Math.min(1.6, Math.max(0.6,
    0.7 + cunning * 0.004 + k.q + Number(ch.lab_purity || 0) * KITCHEN.MODULES.purity.step
    + pathAdd(ch, 'cookQuality') + (Math.random() * 0.2 - 0.1))); // PATHS v2 (kitchen keeps its exact +0.15)
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
  await bumpMastery(client, h, ch, 'chemistry', 'cook'); // THE TRADES — a collected batch is the cook's craft
  return { ok: true, fire: false, qty: Number(b.qty), quality: Math.round(q * 100) / 100 };
}

// ── DEAL (§7.10): demand × quality × event × trade-rank bonus; heat; nerve 1/10 ──
export async function deal(ch, drugId, qty, client, h, play) {
  const d = drugOf(drugId);
  if (!d) throw new GameError('bad_drug', 'No such line.');
  if (jailed(ch)) throw new GameError('jailed', 'No dealing from a cell.');
  if (safeHoused(ch)) throw new GameError('safe', "No corner work while you're to ground — a safehouse hides you, it doesn't move product."); // P1.3 shield-not-bunker
  const s = h.owned.stash.find((x) => x.drug_id === drugId);
  if (!s || Number(s.qty) < 1) throw new GameError('stash', `No ${d.name} in the stash.`);
  const n = Math.max(1, Math.min(Math.floor(Number(qty) || 0) || 1, Number(s.qty)));
  // D6a step two — THE PLAY: how you move it. Deliberately NOT a price axis — the deal CASH curve is
  // sim-audited (§7.10) and untouched on every play; what you trade is THROUGHPUT (nerve, the corner's
  // real throttle) against THE LAW (heat, which feeds the RICO meter + the Bureau's kitchen raid), plus
  // a small trade-rep tilt. An omitted/unknown play resolves to 'standard' (all 1.0) — byte-identical.
  const pl = M4.DEAL_PLAYS[play] || M4.DEAL_PLAYS.standard;
  const nerveCost = Math.max(1, Math.ceil(n / 10 * pl.nerveMult));
  if (Number(ch.nerve) < nerveCost) throw new GameError('nerve', `Moving ${n} units ${pl.id === 'careful' ? 'quietly ' : ''}takes ${nerveCost} nerve.`);
  // D13 (SIGNED 2026-08-05): dealing is PHYSICAL work — moving weight costs energy, flat per deal
  // (the play axis stays on nerve/heat). The point is a substitution decision energy never had: a
  // tank funds ~17 deals OR a gym block OR a crew score, not all three. Crime stays pure-nerve
  // (the signed pacing wall untouched); energy is regen, so zero §10.4 surface.
  if (Number(ch.energy) < M4.DEAL_ENERGY)
    throw new GameError('energy', `Working the corner takes ${M4.DEAL_ENERGY} energy — it comes back on its own.`);
  const ev = cityEventOf(dayOf());
  // sim-audit KITCHEN ON-RAMP: rank-0 dealers earn the CORNER PREMIUM on gross (+50%) — small
  // quantities move at street prices, so the first risky loop beats petty crime. Phases out
  // automatically at trade-rank 1; the sim-audited mid/endgame deal curve is untouched.
  const rankIdx = tradeRankIdx(Number(ch.trade_rep || 0));
  const cornerPremium = rankIdx === 0 ? (CONSTANTS.KITCHEN_ONRAMP_BONUS || 0) : 0;
  const unit = d.base * demandOf(drugId, ch.loc) * Number(s.quality || 1) * (ev.drugDemand || 1)
    * (1 + TRADE_RANKS[rankIdx].bonus) * (1 + cornerPremium);
  const gross = Math.floor(unit * n);
  const fee = Math.ceil(gross * 0.01), tax = Math.ceil(gross * 0.01);
  const net = gross - fee - tax;
  const heatGain = d.heat * n * 0.1 * (ev.drugHeat || 1) * pathFx(ch, 'dealHeat') * pl.heatMult; // PATHS v2 (kitchen keeps its exact 0.75)
  ch.nerve = Number(ch.nerve) - nerveCost;
  ch.energy = Number(ch.energy) - M4.DEAL_ENERGY;
  ch.cash = Number(ch.cash) + net;
  // rank climbs on GROSS — the PLAY tilts it (regulars build a book, churn burns your name). The
  // fast play can only SLOW rank progression, so it never accelerates access to the rank price bonus.
  ch.trade_rep = Number(ch.trade_rep || 0) + Math.floor(gross * pl.repMult);
  ch.heat = Math.min(100, Number(ch.heat || 0) + heatGain);
  s.qty = Number(s.qty) - n;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: net, reason: `deal:${drugId}` });
  // THE KINGPIN LEGEND (Tier-4) — every dollar of gross moved counts toward the account's lifetime
  // empire (status, survives death; NUMERIC arith → pg-mem-safe; off the persistAccount column list)
  await client.query('UPDATE account_persistent SET product_moved = product_moved + $1 WHERE account_id=$2', [gross, ch.account_id]);
  if (h.acct) h.acct.product_moved = Number(h.acct.product_moved || 0) + gross;
  // Global lock order is characters → accounts → gangs → singletons: bumpFamilyTask (gang, then
  // street_tax on weekly completion) MUST precede takeHouse (the street_tax singleton). The old
  // order locked street_tax first, AB-BA deadlocking a deal-week against the 12h buyback (which
  // was itself explicitly hardened to lock gangs before street_tax — worker.js runBuyback).
  await bumpFamilyTask(client, h, 'deal', n);
  await takeHouse(client, tax);
  await h.track(client, ch.account_id, 'deal', { drug: drugId, units: n, heat: Math.round(heatGain * 10) / 10 });
  await h.bumpDaily(client, ch.id, 'deal');
  await bumpMastery(client, h, ch, 'chemistry', 'deal'); // THE TRADES — moving product works the same craft
  return { ok: true, units: n, earned: net, heat: Math.round(heatGain * 10) / 10,
    play: pl.id, nerve: nerveCost,
    cornerPremium: cornerPremium > 0,
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
  // start (or reset) the wage clock on a hire — a fresh mouth doesn't retroactively raise the nut
  // owed on the old crew; the up-front $50k×N covers the buy-in, wages start ticking now.
  ch.crew_paid_at = new Date();
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'crew:hire' });
  return { ok: true, crew: ch.crew, cost };
}

// PAY THE NUT (recurring sinks) — cover the crew's wages, a §10.4 cash SINK `crew:wages` that
// resets the clock and puts a downed crew back on the corner. All-or-nothing (a single crew, a
// single obligation): if you can't cover the week, the corner stays quiet until you can.
export async function payCrewWages(ch, client, h) {
  const crew = Number(ch.crew || 0);
  if (crew <= 0) throw new GameError('none', 'You run no crew — no nut to cover.');
  const owed = crewWageOwed(ch);
  if (owed <= 0) return { ok: true, paid: 0, message: 'The nut is covered.' };
  if (Number(ch.cash) < owed) throw new GameError('cash', `The nut runs $${owed} — the corner's short, and so are you.`);
  ch.cash = Number(ch.cash) - owed;
  ch.crew_paid_at = new Date();
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -owed, reason: 'crew:wages' });
  return { ok: true, paid: owed, crew };
}

// LET ONE GO — the door out of the nut, and it exists for the same reason the business SHUTTER
// does: a recurring sink with no exit is not a cost, it is a trap. The crew earn only while there
// is stash to move, but the wage runs on the wall clock either way, so a player who hires ahead of
// their kitchen — or takes a week off — pays $1,200/hr/head for nothing and, until now, could never
// stop paying. There was no fire button anywhere in the game.
//
// The rule is one line: a WORKING crew must be squared up before anyone walks; a crew that DOWNED
// TOOLS (cold — the nut unpaid past CREW_WAGE_COLD_MS) can be let go for nothing, because men who
// stopped working for you three days ago have already gone.
//
// That is also what closes the obvious dodge, and it closes it on the ECONOMICS rather than with a
// special rule. `crewWageOwed` is crew × elapsed and is never stored, so shedding heads retroactively
// shrinks the nut — run five for a week, lay off four, pay a fifth. But the free door is only open
// once you have gone cold, which costs three days of sales, and one hand moves ~60 units/hr at 0.8×
// base: even on the cheapest line that is ~$311k of product forgone against ~$86k of wages dodged.
// Nobody takes that trade. A warm crew's only exit is through the till.
//
// §10.4: the settle-first path is the EXISTING `crew:wages` sink; a cold walk-off moves no value at
// all (no ledger row) — the BUSINESS_SHUTTER_BPS=0 argument. The buy-in is forfeit: coming back
// costs the step price again.
export async function layOffCrew(ch, client, h) {
  const crew = Number(ch.crew || 0);
  if (crew <= 0) throw new GameError('none', 'You run no crew.');
  const cold = crewCold(ch);
  const owed = crewWageOwed(ch);
  if (!cold && owed > 0) {
    if (Number(ch.cash) < owed) throw new GameError('nut', `Square the nut first — $${owed} for the time they worked.`);
    ch.cash = Number(ch.cash) - owed;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -owed, reason: 'crew:wages' });
  }
  ch.crew = crew - 1;
  // the clock restarts for whoever is left (they were just paid, or they had already walked); with
  // nobody left the marker is cleared so a future hire starts its wages from that hire.
  ch.crew_paid_at = ch.crew > 0 ? new Date() : null;
  return { ok: true, crew: ch.crew, settled: cold ? 0 : owed, walked: cold };
}

// ── HEAT MANAGEMENT (§5.3) ──
export async function layLow(ch, client, h) {
  if (Number(ch.heat || 0) < 5) throw new GameError('cold', "You're already a ghost.");
  // Commission decree: AMNESTY — the judges are paid, laying low costs half this week
  const amnesty = (await activeDecree(client))?.id === 'amnesty';
  // FAST TALKER (skills) stacks multiplicatively with an amnesty decree — both are new levers
  // FIVE PILLARS #1: a Man of Honor lays low cheaper — the judges' benefit of the doubt
  // (stacks multiplicatively with the decree + the skill; a NEW lever, sign-off)
  // SEASONAL MODIFIER (slate #6): the season's twist composes multiplicatively like the decree
  const cost = Math.floor(M4.LAYLOW_CASH * (amnesty ? COMMISSION.AMNESTY_MULT : 1)
    * skillMult(h, 'fast_talker', SKILLS.FX.LAYLOW_MULT)
    * (Number(ch.honor || 0) >= HONOR.TRUSTED ? HONOR.LAYLOW_MULT : 1)
    * (seasonModOf().laylowMult || 1));
  if (Number(ch.cash) < cost) throw new GameError('cash', `Laying low takes $${cost}.`);
  if (Number(ch.energy) < M4.LAYLOW_ENERGY) throw new GameError('energy', `Laying low takes ${M4.LAYLOW_ENERGY} energy.`);
  ch.cash = Number(ch.cash) - cost;
  ch.energy = Number(ch.energy) - M4.LAYLOW_ENERGY;
  ch.heat = Math.max(0, Number(ch.heat) - M4.LAYLOW_COOL);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'laylow' });
  return { ok: true, heat: Math.round(Number(ch.heat)), cost, ...(amnesty ? { amnesty: true } : {}) };
}

export async function cleanPapers(ch, client, h) {
  if (Number(ch.heat || 0) < 1) throw new GameError('cold', 'Your papers are already spotless.');
  if (Number(h.acct.omr) < M4.CLEANPAPERS_OMR) throw new GameError('omr', `Clean Papers cost ${M4.CLEANPAPERS_OMR} $OMR.`);
  h.acct.omr = Number(h.acct.omr) - M4.CLEANPAPERS_OMR;
  ch.heat = 0;
  await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: -M4.CLEANPAPERS_OMR, reason: 'cleanpapers' });
  return { ok: true, heat: 0 };
}

// ═══ THE KITCHEN → Tier 4 ═══

// LAB MODULES (Tier-4) — buy the next level of a purity/yield/stealth module. Cost climbs with the
// module level AND the lab tier; the top levels also burn $OMR (the lab-ladder precedent). Written by
// direct SQL (the column is off the persistCharacter positional UPDATE → clobber-safe). One touchpoint
// each: purity→collect quality, yield→cook cap, stealth→the accrual raid probability.
export async function upgradeModule(ch, modId, client, h) {
  // `Object.hasOwn`, not truthiness — a prototype key ('__proto__', 'constructor', …) indexes as
  // TRUTHY and would reach the `lab_${modId}` column name below as a 500 (red team #8).
  const mod = Object.hasOwn(KITCHEN.MODULES, modId) ? KITCHEN.MODULES[modId] : null;
  if (!mod) throw new GameError('bad_module', 'No such lab module.');
  if (!ch.lab) throw new GameError('no_lab', 'Fit a Kitchen before you soup it up.');
  const col = `lab_${modId}`;
  const level = Number(ch[col] || 0);
  if (level >= KITCHEN.MODULE_MAX) throw new GameError('maxed', `The ${mod.name} is as far as it goes.`);
  const labIdx = KITCHENS.findIndex((k) => k.id === ch.lab);
  const { cash, omr } = labModuleCost(modId, level, labIdx);
  if (Number(ch.cash) < cash) throw new GameError('cash', `The next ${mod.name} level runs $${cash}.`);
  if (omr > 0 && Number(h.acct.omr) < omr) throw new GameError('omr', `It also takes ${omr} $OMR — bench chemistry isn't cheap.`);
  ch.cash = Number(ch.cash) - cash;
  ch[col] = level + 1;
  await client.query(`UPDATE characters SET ${col}=$1 WHERE id=$2`, [level + 1, ch.id]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cash, reason: 'kitchen:module' });
  if (omr > 0) {
    h.acct.omr = Number(h.acct.omr) - omr;
    await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: -omr, reason: 'kitchen:module' });
  }
  return { ok: true, module: modId, name: mod.name, level: level + 1, cash, omr };
}

// CUTTING AGENTS (Tier-4) — stretch a stash line: +CUT_UNITS of its own qty at a −CUT_QUALITY hit
// (floored at CUT_FLOOR; over-cut is near worthless since the deal price scales on quality). A cash
// SINK for the agent; the extra units are ownership, not a §10.4 currency (the stash isn't ledgered).
export async function cutStash(ch, drugId, client, h) {
  const d = drugOf(drugId);
  if (!d) throw new GameError('bad_drug', 'No such line.');
  if (jailed(ch)) throw new GameError('jailed', "You can't cut product from a cell.");
  const s = h.owned.stash.find((x) => x.drug_id === drugId);
  if (!s || Number(s.qty) < 1) throw new GameError('stash', `No ${d.name} in the stash to cut.`);
  if (Number(s.quality) <= KITCHEN.CUT_FLOOR)
    throw new GameError('too_weak', `That ${d.name} is already cut to nothing — step on it more and it's baby powder.`);
  if (Number(ch.cash) < KITCHEN.CUT_COST) throw new GameError('cash', `A cutting agent runs $${KITCHEN.CUT_COST}.`);
  ch.cash = Number(ch.cash) - KITCHEN.CUT_COST;
  const added = Math.max(1, Math.floor(Number(s.qty) * KITCHEN.CUT_UNITS));
  s.qty = Number(s.qty) + added;
  s.quality = Math.max(KITCHEN.CUT_FLOOR, Number(s.quality) * (1 - KITCHEN.CUT_QUALITY));
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -KITCHEN.CUT_COST, reason: 'kitchen:cut' });
  return { ok: true, drug: drugId, added, qty: Number(s.qty), quality: Math.round(s.quality * 100) / 100, cost: KITCHEN.CUT_COST };
}

// THE KINGPIN LEADERBOARD (Tier-4) — the biggest lifetime distributors by product moved (agents
// excluded, the hitmen-board precedent). Pure STATUS — account-level, survives death.
export async function kingpinLeaderboard(pool) {
  const rows = (await pool.query(
    `SELECT c.name, ap.product_moved FROM account_persistent ap
       JOIN characters c ON c.account_id = ap.account_id AND c.alive
      WHERE NOT ap.agent_flag AND NOT c.is_npc AND ap.product_moved > 0
      ORDER BY ap.product_moved DESC, c.name LIMIT 20`)).rows;
  return { kingpins: rows.map((r, i) => ({ pos: i + 1, name: r.name, moved: Number(r.product_moved),
    rank: kingpinRankOf(r.product_moved).name })) };
}

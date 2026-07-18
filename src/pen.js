// THE PEN — the prison meta-game (design omerta-the-pen-design.md). Turns `jail_until` dead time
// into a place: work the yard down (a bounded cash faucet + good-behaviour sentence cut), buy
// contraband, pay the yard boss for protection, bribe the guard for early release — and the marquee
// JAILHOUSE SHANK: reach an enemy who's ALSO inside, bypassing the street defenses (safehouse can't
// be entered from a cell; a street bodyguard isn't in the yard) but respecting paid revive insurance
// and witness-protection segregation. Every action REQUIRES being jailed. Numbers are sign-off levers.
import { GameError, bus } from './game.js';
import { PEN, penContrabandOf, jailSecondsLeft, penSafe, inHole, levelOf, effStat, witproActive,
         yardEventOf, yardEventById, dayOf } from './rules.js';
import { runEstate, claimBounty, npcHit } from './social.js';

const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const hospitalized = (ch) => ch.hosp_until && new Date(ch.hosp_until) > new Date();
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const insideOnly = (ch) => {
  if (!jailed(ch)) throw new GameError('free', "You're on the outside — the Pen is closed to you.");
  if (inHole(ch)) throw new GameError('hole', "You're in the hole — no yard, no commissary, no calls.");
};
// today's yard incident (seed-drawn, town-wide). PEN_YARD_EVENT is a TEST-ONLY override (the
// SEARCH_MS / LAW_BUST_P precedent) — never set in production.
const activeYardEvent = () => process.env.PEN_YARD_EVENT ? yardEventById(process.env.PEN_YARD_EVENT) : yardEventOf(dayOf());

// how many of a contraband item an inmate is holding
async function contrabandOf(client, chId) {
  const rows = (await client.query('SELECT item, qty FROM pen_contraband WHERE character_id=$1 AND qty>0', [chId])).rows;
  return Object.fromEntries(rows.map((r) => [r.item, Number(r.qty)]));
}
// absolute write (pg-mem mis-evaluates arithmetic UPDATEs on INT columns — the setCargo precedent)
async function setContraband(client, chId, item, qty) {
  if (qty <= 0) { await client.query('DELETE FROM pen_contraband WHERE character_id=$1 AND item=$2', [chId, item]); return; }
  const upd = await client.query('UPDATE pen_contraband SET qty=$3 WHERE character_id=$1 AND item=$2', [chId, item, qty]);
  if (!upd.rowCount) await client.query('INSERT INTO pen_contraband (character_id, item, qty) VALUES ($1,$2,$3)', [chId, item, qty]);
}

// GET /v1/pen — the yard (runs under withCharacter so it reads inside the caller's txn)
export async function penBoard(ch, client, h) {
  const held = await contrabandOf(client, ch.id);
  const roster = (await client.query(
    `SELECT c.id, c.name, c.respect, gm.gang_id FROM characters c
       LEFT JOIN gang_members gm ON gm.character_id = c.id
      WHERE c.alive AND c.jail_until > now() AND c.id <> $1
      ORDER BY c.jail_until ASC LIMIT 30`, [ch.id])).rows
    .map((r) => ({ id: r.id, name: r.name, level: levelOf(Number(r.respect)), gang: r.gang_id || null }));
  const ev = activeYardEvent();
  return {
    inside: !!jailed(ch),
    sentenceSeconds: jailSecondsLeft(ch),
    protectedSeconds: penSafe(ch) ? Math.max(0, Math.ceil((new Date(ch.pen_safe_until) - Date.now()) / 1000)) : 0,
    holeSeconds: inHole(ch) ? Math.max(0, Math.ceil((new Date(ch.hole_until) - Date.now()) / 1000)) : 0,
    contraband: held,
    armed: (held.shiv || 0) > 0,
    commissary: PEN.CONTRABAND.map((c) => ({ id: c.id, name: c.name, cost: c.cost, desc: c.desc })),
    protectionCost: Math.round(PEN.PROTECTION_COST * (ev.protMult || 1)), bribePerSecond: Math.round(PEN.BRIBE_PER_S * (ev.bribeMult || 1)),
    // step two: today's yard incident (the block-wide modifier everyone shares)
    incident: { id: ev.id, name: ev.name, desc: ev.desc },
    yard: roster,
  };
}

// POST /v1/pen/work — yard duty: energy → a little cash + shave WORK_CUT_S off the sentence
export async function workYard(ch, client, h) {
  insideOnly(ch);
  if (Number(ch.energy) < PEN.WORK_ENERGY) throw new GameError('energy', `Yard duty takes ${PEN.WORK_ENERGY} energy.`);
  ch.energy = Number(ch.energy) - PEN.WORK_ENERGY;
  const pay = rand(PEN.WORK_PAY[0], PEN.WORK_PAY[1]);
  ch.cash = Number(ch.cash) + pay;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: pay, reason: 'pen:work' });
  // good behaviour shaves time (never below "just walked")
  const cutMs = PEN.WORK_CUT_S * 1000;
  const left = new Date(ch.jail_until).getTime() - Date.now();
  ch.jail_until = new Date(Date.now() + Math.max(0, left - cutMs));
  return { ok: true, pay, cutSeconds: PEN.WORK_CUT_S, sentenceSeconds: jailSecondsLeft(ch) };
}

// POST /v1/pen/buy/:item — the commissary (a cash sink → the corrupt guard's pocket, i.e. the buyback pool)
export async function buyContraband(ch, itemId, client, h) {
  insideOnly(ch);
  if (activeYardEvent().commissaryClosed) throw new GameError('toss', "Guards are tearing the block apart — the guard won't move contraband today.");
  const item = penContrabandOf(itemId);
  if (!item) throw new GameError('bad_item', 'The guard doesn’t move that.');
  if (Number(ch.cash) < item.cost) throw new GameError('cash', `The guard wants $${item.cost}.`);
  ch.cash = Number(ch.cash) - item.cost;
  const held = await contrabandOf(client, ch.id);
  await setContraband(client, ch.id, itemId, (held[itemId] || 0) + 1);
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [item.cost]); // the guard's cut recycles into the pool
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -item.cost, reason: 'pen:commissary' });
  return { ok: true, item: itemId, cost: item.cost };
}

// POST /v1/pen/protection — pay the yard boss for a no-shank window (the in-jail safehouse)
export async function payProtection(ch, client, h) {
  insideOnly(ch);
  const cost = Math.round(PEN.PROTECTION_COST * (activeYardEvent().protMult || 1)); // a riot puts cover on sale
  if (Number(ch.cash) < cost) throw new GameError('cash', `The yard boss wants $${cost}.`);
  ch.cash = Number(ch.cash) - cost;
  const base = penSafe(ch) ? new Date(ch.pen_safe_until).getTime() : Date.now();
  ch.pen_safe_until = new Date(base + PEN.PROTECTION_MS);
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [cost]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'pen:protection' });
  return { ok: true, cost, protectedSeconds: Math.ceil((new Date(ch.pen_safe_until) - Date.now()) / 1000) };
}

// POST /v1/pen/bribe — bribe the guard to cut the remaining sentence (the fast, expensive way out)
export async function bribeGuard(ch, seconds, client, h) {
  insideOnly(ch);
  const left = jailSecondsLeft(ch);
  // ABSENT (null/undefined) means "buy the whole sentence"; an EXPLICIT number is honoured — a
  // non-positive/NaN value is a clean 400, never the silent full-sentence charge (audit LOW footgun).
  let cut;
  if (seconds === undefined || seconds === null || seconds === '') cut = left;
  else { const n = Math.floor(Number(seconds)); if (!Number.isFinite(n) || n <= 0) throw new GameError('seconds', 'Ask for a positive number of seconds to cut.'); cut = Math.min(left, n); }
  const perSecond = Math.round(PEN.BRIBE_PER_S * (activeYardEvent().bribeMult || 1)); // a visit day, the guard takes less
  const cost = cut * perSecond;
  if (Number(ch.cash) < cost) throw new GameError('cash', `Cutting ${cut}s costs $${cost}.`);
  ch.cash = Number(ch.cash) - cost;
  ch.jail_until = new Date(new Date(ch.jail_until).getTime() - cut * 1000);
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [cost]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'pen:bribe' });
  return { ok: true, cost, cutSeconds: cut, sentenceSeconds: jailSecondsLeft(ch) };
}

// POST /v1/pen/shank/:targetId — the jailhouse hit (two-party: both must be inside)
export async function shank(ch, victim, client, h) {
  insideOnly(ch);
  // shield-not-bunker (P1.3, audit): the yard boss's protection is a SHIELD — you can't hunt from
  // under it. Mirrors the street safeHoused(ch) actor-guards on fire/jump.
  if (penSafe(ch)) throw new GameError('safe', "You're under the yard boss's protection — take it or hunt, not both.");
  if (!jailed(victim)) throw new GameError('target_free', "They've walked — you can't reach them out there.");
  // family omertà holds inside too — VOID for a rat (the audit precedent)
  if (h.owned.gangId && h.victimOwned.gangId === h.owned.gangId && !h.victimAcct.rat)
    throw new GameError('family', "They're family. Even in here.");
  if (hospitalized(victim)) throw new GameError('hosp', "They're in the infirmary — out of reach.");
  if (penSafe(victim)) throw new GameError('protected', 'The yard boss has them covered right now.');
  if (inHole(victim)) throw new GameError('segregated', "They're in the hole — nobody reaches them there.");
  if (witproActive(victim)) throw new GameError('witpro', "They're in protective custody — segregated. No reach.");
  // step two: a LOCKDOWN freezes the yard — no moves on anybody today
  const ev = activeYardEvent();
  if (ev.shankBlock) throw new GameError('lockdown', "Lockdown — the guards have every tier. Not today.");
  const held = await contrabandOf(client, ch.id);
  if (!(held.shiv > 0)) throw new GameError('no_shiv', 'You need a shiv for that kind of talk.');
  if (Number(ch.energy) < PEN.SHANK_ENERGY) throw new GameError('energy', `A move like that takes ${PEN.SHANK_ENERGY} energy.`);

  ch.energy = Number(ch.energy) - PEN.SHANK_ENERGY;
  await setContraband(client, ch.id, 'shiv', held.shiv - 1); // the shiv is spent whether it lands or not
  const km = effStat(Number(ch.muscle), 'muscle', h.owned.assets || [], h.owned.gear || []);
  const vm = effStat(Number(victim.muscle), 'muscle', h.victimOwned.assets || [], h.victimOwned.gear || []);
  // SHANK_P is a TEST-ONLY knob (the LAW_BUST_P / WORLD_RAID_P precedent) — never set in production.
  const p = process.env.SHANK_P != null ? Number(process.env.SHANK_P)
    : Math.max(PEN.SHANK_MIN, Math.min(PEN.SHANK_MAX, PEN.SHANK_BASE + (km - vm) / PEN.SHANK_SCALE + (ev.shankAdd || 0))); // a riot makes blood cheap
  const roll = Math.random();
  await h.rngLog(client, ch.id, `shank:${victim.id}`, roll, roll < p ? 'landed' : 'missed');

  if (roll >= p) {
    // caught fumbling — the shiv's gone, the killer eats damage + more time, AND does a stretch in
    // THE HOLE (step two): solitary, no yard actions and untouchable, until it lifts.
    const dmg = rand(PEN.FAIL_DMG[0], PEN.FAIL_DMG[1]);
    ch.health = Math.max(1, Number(ch.health) - dmg);
    ch.jail_until = new Date(new Date(ch.jail_until).getTime() + PEN.CAUGHT_ADD_S * 1000);
    ch.hole_until = new Date(Date.now() + PEN.HOLE_MS);
    await h.notify(client, victim.id, 'shank_survived', { from: ch.name });
    return { ok: true, kill: false, caught: true, dmg, holeSeconds: Math.round(PEN.HOLE_MS / 1000), sentenceSeconds: jailSecondsLeft(ch) };
  }

  // ── the blade lands ── real-ETH revive insurance still pulls them from the brink (paid anywhere)
  if (Number(h.victimAcct.respawn_tokens || 0) > 0) {
    h.victimAcct.respawn_tokens = Number(h.victimAcct.respawn_tokens) - 1;
    victim.health = 100;
    await h.notify(client, victim.id, 'revived', { from: ch.name });
    await h.notify(client, ch.id, 'target_revived', { victim: victim.name });
    return { ok: true, kill: false, revived: true };
  }
  // a body in the yard — the full estate (heir, prestige, a sworn bloodline), but no loot/chop (you
  // can't strip a fleet from a cell) and no feared-rep (a shanking is dishonorable — the npcHit rule)
  await h.notify(client, victim.id, 'shanked', { from: ch.name });
  // a shank is a DIRECT player kill (like fire, not the hired npcHit) — it FULFILS open kill
  // contracts on the mark (audit: else a random shiv burned the funder's escrow for free). Paid
  // BEFORE the estate vacates the bounties. Cash only (still no loot, no chop, no feared-rep).
  const { total: bounty } = await claimBounty(client, h, ch, victim.id, ['hospitalize', 'kill']);
  const estate = await runEstate(client, h, victim, ch.name, { killerCh: ch, vendetta: true });
  ch.jail_until = new Date(new Date(ch.jail_until).getTime() + PEN.KILL_ADD_S * 1000); // a body means more time
  bus.emit('streets', { type: 'shank', by: ch.name, victim: victim.name });
  await h.track(client, ch.account_id, 'shank', { victim: victim.id, bounty });
  return { ok: true, kill: true, bounty, sentenceSeconds: jailSecondsLeft(ch), estate: { heirId: estate.heirId } };
}

// POST /v1/pen/burner/:targetId — the BURNER PHONE (step two): the ONE way to reach the outside from
// a cell. Consume a burner and call in an NPC hit (jail-gated everywhere else) — two-party. The
// burner is spent only if the call goes through (a bad target etc. throws → the whole txn rolls back,
// so nothing's consumed); the NPC-hit fee burns win or lose, exactly like a street npcHit.
export async function burnerHit(ch, victim, client, h, tierId) {
  insideOnly(ch);
  const held = await contrabandOf(client, ch.id);
  if (!(held.burner > 0)) throw new GameError('no_burner', 'You need a burner phone to reach the outside.');
  await setContraband(client, ch.id, 'burner', held.burner - 1); // one call, then you eat the SIM
  const res = await npcHit(ch, victim, client, h, tierId, { fromBurner: true }); // jail gate waived for the call
  return { ok: true, burner: true, ...res };
}

// THE UNDERWORLD (design: omerta-underworld-design.md). Four NAMED fixtures, one per loop —
// Doc Moretti (survival), Vinnie the Match (PvP/contracts), Bella Bang-Bang (gear), Big Tuna
// (trade). Per-character standing 0–100 (`npc_standing`) is a pure STATUS axis earned by DOING
// BUSINESS (actor-side bumps at the loop's touchpoints, via game.js `bumpStanding`); tiers at
// 25/60/90 unlock perks that are each a NEW single-touchpoint modifier (the skills/decree
// precedent), read via game.js `npcTier`/`npcMult`. Standing DIES WITH THE STREET.
//
// Money flows here are ledgered + vocabulary'd (`underworld:`): `gift` (a cash sink — money
// opens doors, but ONLY below GIFT_CAP: the top tiers are earned), `discharge` (a cash sink —
// the Doc's T2/T3 perk, priced per remaining hospital minute), `gunsale` (a small bounded
// FAUCET — Bella's T3 buyback at 30% of the gun's cash price, once per owned gun, flagged for
// the sim pass). Deliberately UNTOUCHED: $OMR burns, ammo prices (the D1-signed kill-EV
// anchor), heat deterrents, loot-exposure windows, extraction caps, income curves. All
// numbers are founder sign-off levers.
import { GameError, npcTier, bumpStanding, bestNpc } from './game.js';
import { UNDERWORLD, npcOf, GUNS, dayOf, weekOf, leadTaskOf, taskLabelOf, levelOf, assetEnergyCap , jailed } from './rules.js';


// The board — the cast, your standing with each, what the next tier buys, plus step two:
// today's LEAD (your best fixture, and whether its bonus is already claimed) and — Madame T3
// only — the WHISPERS: how many hunters currently have a search out on you (a count, never
// names; the $OMR peek stays the only name-piercing intel).
export async function underworldBoard(ch, client, h) {
  const best = bestNpc(h);
  // step three: the lead is a rotating TASK — the same draw for the whole town, claimable
  // only by doing THAT piece of business with your best fixture today
  const lead = best ? {
    npc: best, npcName: npcOf(best)?.name || best,
    task: leadTaskOf(dayOf(), best), taskLabel: taskLabelOf(leadTaskOf(dayOf(), best)),
    bonus: UNDERWORLD.STEP2.LEAD_BONUS,
    done: !!(await client.query('SELECT 1 FROM npc_leads WHERE character_id=$1 AND day=$2', [ch.id, dayOf()])).rowCount,
  } : null;
  const whispers = npcTier(h, 'madame') >= 3
    ? { asking: Number((await client.query('SELECT COUNT(*) n FROM searches WHERE target=$1', [ch.id])).rows[0].n) }
    : undefined;
  // step four: the weekly favor (taken or standing), and each fixture's open grudge count
  const favorTaken = !!(await client.query('SELECT 1 FROM npc_favors WHERE character_id=$1 AND week=$2', [ch.id, weekOf()])).rowCount;
  // step five: the active errand chain, if any
  const er = (await client.query('SELECT * FROM npc_errands WHERE character_id=$1', [ch.id])).rows[0];
  const errand = er ? {
    npc: er.npc_id, npcName: npcOf(er.npc_id)?.name || er.npc_id,
    step: Number(er.step), of: UNDERWORLD.STEP5.CHAIN_STEPS,
    task: leadTaskOf(dayOf(), er.npc_id), taskLabel: taskLabelOf(leadTaskOf(dayOf(), er.npc_id)),
    doneToday: Number(er.last_day ?? -1) === dayOf(),
  } : null;
  return {
    errand,
    thresholds: UNDERWORLD.THRESHOLDS,
    gift: { cost: UNDERWORLD.GIFT_COST, standing: UNDERWORLD.GIFT_STANDING, cap: UNDERWORLD.GIFT_CAP },
    decay: { graceDays: UNDERWORLD.STEP2.DECAY_GRACE_DAYS, perDay: UNDERWORLD.STEP2.DECAY_PER_DAY, floor: UNDERWORLD.STEP2.DECAY_FLOOR },
    penance: UNDERWORLD.STEP4.PENANCE_COST,
    favor: { taken: favorTaken },
    lead, ...(whispers ? { whispers } : {}),
    npcs: UNDERWORLD.NPCS.map((n) => ({
      id: n.id, name: n.name, earn: n.earn, perks: n.perks,
      standing: Number(h.owned.npc[n.id] || 0), tier: npcTier(h, n.id),
      grudge: Number(h.owned.grudges?.[n.id] || 0),
    })),
  };
}

// GIFT — cash buys a foot in the door, never the inner circle (standing ≥ GIFT_CAP refuses).
export async function giftNpc(ch, npcId, client, h) {
  const n = npcOf(npcId);
  if (!n) throw new GameError('bad_npc', 'Nobody by that name works this town.');
  if (jailed(ch)) throw new GameError('jailed', 'No social calls from lockup.');
  const cur = Number(h.owned.npc[npcId] || 0);
  if (cur >= UNDERWORLD.GIFT_CAP)
    throw new GameError('earned', `${n.name} doesn't want your money — the rest is earned.`);
  if (Number(ch.cash) < UNDERWORLD.GIFT_COST) throw new GameError('cash', `A proper gift runs $${UNDERWORLD.GIFT_COST}.`);
  ch.cash = Number(ch.cash) - UNDERWORLD.GIFT_COST;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -UNDERWORLD.GIFT_COST, reason: 'underworld:gift' });
  // the bump is capped at GIFT_CAP — a gift can't vault you past the door. An envelope is
  // not BUSINESS (business:false), so it never claims the daily lead bonus.
  const pts = Math.min(UNDERWORLD.GIFT_CAP, cur + UNDERWORLD.GIFT_STANDING) - cur;
  await bumpStanding(client, h, ch, npcId, pts, { business: false });
  await h.track(client, ch.account_id, 'underworld_gift', { npc: npcId });
  // npcName rides every fixture response: the id ('doc') is a key, the name ('Doc Moretti') is
  // what a player is owed — and the client has no catalog of the cast to resolve it from.
  return { ok: true, npc: npcId, npcName: n.name, standing: Number(h.owned.npc[npcId]), tier: npcTier(h, npcId) };
}

// EARLY DISCHARGE — Doc T2 halves a hospital stay, T3 releases in full. Priced per remaining
// minute (a cash sink); the Doc remembers the business (+2).
export async function discharge(ch, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'The Doc makes no house calls to lockup.');
  const tier = npcTier(h, 'doc');
  if (tier < 2) throw new GameError('standing', 'Doc Moretti signs early papers for friends, not customers.');
  const now = Date.now();
  const until = ch.hosp_until ? new Date(ch.hosp_until).getTime() : 0;
  if (until <= now) throw new GameError('healthy', "You're not in a hospital bed.");
  const remainingMs = until - now;
  const cost = Math.ceil(remainingMs / 60000) * UNDERWORLD.DISCHARGE_PER_MIN;
  if (Number(ch.cash) < cost) throw new GameError('cash', `Doc's discretion runs $${cost}.`);
  ch.cash = Number(ch.cash) - cost;
  // T3: walk out now. T2: half the remaining stay is forgiven.
  ch.hosp_until = tier >= 3 ? new Date(now) : new Date(now + Math.floor(remainingMs / 2));
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'underworld:discharge' });
  await bumpStanding(client, h, ch, 'doc', 2, { action: 'discharge' });
  await h.track(client, ch.account_id, 'underworld_discharge', { cost, full: tier >= 3 });
  return { ok: true, cost, full: tier >= 3,
    hospSeconds: Math.max(0, Math.ceil((new Date(ch.hosp_until).getTime() - now) / 1000)) };
}

// GUN BUYBACK — Bella T3 buys a piece back at GUN_BUYBACK of its cash price. A small bounded
// faucet (once per owned gun — she won't buy what you don't hold), ledgered `underworld:gunsale`.
export async function sellGunBack(ch, gunId, client, h) {
  if (npcTier(h, 'armorer') < 3) throw new GameError('standing', 'Bella only buys from family.');
  const g = GUNS.find((x) => x.id === gunId);
  if (!g || !h.owned.guns.includes(gunId)) throw new GameError('none', "You don't own that piece.");
  if (jailed(ch)) throw new GameError('jailed', 'No deals from lockup.');
  const price = Math.floor(g.cash * UNDERWORLD.GUN_BUYBACK);
  await client.query('DELETE FROM character_guns WHERE character_id=$1 AND gun_id=$2', [ch.id, gunId]);
  h.owned.guns = h.owned.guns.filter((x) => x !== gunId);
  if (ch.gun === gunId) ch.gun = h.owned.guns[0] || null; // she takes it off your hip
  ch.cash = Number(ch.cash) + price;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: price, reason: 'underworld:gunsale' });
  await bumpStanding(client, h, ch, 'armorer', 1, { action: 'sale' });
  await h.track(client, ch.account_id, 'underworld_gunsale', { gun: gunId, price });
  return { ok: true, gun: gunId, price, equipped: ch.gun };
}

// PENANCE (step four) — square ONE grudge with a fixture for PENANCE_COST (a ledgered cash
// sink, `underworld:penance` — riding the existing vocabulary prefix). Squaring buys back
// SERVICE (the tier cap lifts when the count hits 0), never friendship — no standing moves.
export async function payPenance(ch, npcId, client, h) {
  const n = npcOf(npcId);
  if (!n) throw new GameError('bad_npc', 'Nobody by that name works this town.');
  if (jailed(ch)) throw new GameError('jailed', 'No making amends from lockup.');
  const count = Number(h.owned.grudges?.[npcId] || 0);
  if (!(count > 0)) throw new GameError('clean', `${n.name} holds nothing against you.`);
  const cost = UNDERWORLD.STEP4.PENANCE_COST;
  if (Number(ch.cash) < cost) throw new GameError('cash', `Squaring it with ${n.name} runs $${cost}.`);
  ch.cash = Number(ch.cash) - cost;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'underworld:penance' });
  // absolute write from the EFFECTIVE count (pg-mem INT-arithmetic quirk + step-five healing
  // materializes here); the write restarts the healing clock, and the in-memory map keeps
  // npcTier honest within this transaction
  await client.query('UPDATE npc_grudges SET count=$3, since=now() WHERE character_id=$1 AND npc_id=$2', [ch.id, npcId, count - 1]);
  if (count - 1 > 0) h.owned.grudges[npcId] = count - 1; else delete h.owned.grudges[npcId];
  await h.track(client, ch.account_id, 'underworld_penance', { npc: npcId, remaining: count - 1 });
  return { ok: true, npc: npcId, npcName: n.name, cost, remaining: count - 1, squared: count - 1 === 0 };
}

// THE WEEKLY FAVOR (step four) — the top of a relationship finally gives something back: one
// favor a week per street, from any UN-grudged tier-3 fixture. Every favor is a RESOURCE
// package (health / repairs / energy / nerve) — never money, never a §10.4 currency — and
// Vinnie famously does not do favors. A grudge caps the tier below 3, so a grudged fixture
// refuses until penance squares it.
export async function claimFavor(ch, npcId, client, h) {
  const n = npcOf(npcId);
  if (!n) throw new GameError('bad_npc', 'Nobody by that name works this town.');
  if (jailed(ch)) throw new GameError('jailed', 'Nobody owes a man in lockup.');
  if (npcId === 'fixer') throw new GameError('debts', 'Vinnie deals in debts, not gifts.');
  if (npcTier(h, npcId) < 3) throw new GameError('standing', `${n.name} does favors for the inner circle.`);
  const week = weekOf();
  const taken = (await client.query('SELECT 1 FROM npc_favors WHERE character_id=$1 AND week=$2', [ch.id, week])).rows[0];
  if (taken) throw new GameError('taken', 'One favor a week — nobody likes a moocher.');
  const lvl = levelOf(Number(ch.respect));
  let favor;
  if (npcId === 'doc') {                       // a quiet patch-up, no questions
    ch.health = 100;
    favor = { health: 100 };
  } else if (npcId === 'armorer') {            // her boys fix your worst iron overnight
    // skip market-LISTED and loan-PLEDGED iron — the favor honours the same escrow discipline
    // findCar enforces (melt/fence/repair all refuse both; repairing pledged collateral would let
    // the borrower quietly re-value the lender's security around the lock).
    const worst = h.owned.cars.filter((c) => !c.listed && !c.pledged).sort((a, b) => Number(b.dmg) - Number(a.dmg))[0];
    if (!worst || !(Number(worst.dmg) > 0)) throw new GameError('nothing', 'Nothing in the garage needs her boys.');
    await client.query('UPDATE cars SET dmg=0 WHERE id=$1', [worst.id]);
    worst.dmg = 0;
    favor = { repaired: worst.id };
  } else if (npcId === 'harbor') {             // dock hands load for you today
    ch.energy = 50 + 2 * lvl + assetEnergyCap(h.owned.assets);
    favor = { energy: Math.floor(Number(ch.energy)) };
  } else if (npcId === 'cornerman') {          // the corner patches up your whole stable overnight
    const hurt = Number((await client.query("SELECT COUNT(*) n FROM fighters WHERE character_id=$1 AND injured_until > now()", [ch.id])).rows[0].n);
    if (hurt === 0) throw new GameError('nothing', 'None of your fighters are laid up.'); // never burns the week (the armorer precedent)
    await client.query('UPDATE fighters SET injured_until=NULL WHERE character_id=$1', [ch.id]);
    favor = { healedFighters: hurt };
  } else {                                     // madame: a night off the clock
    ch.nerve = 10 + lvl;
    favor = { nerve: Math.floor(Number(ch.nerve)) };
  }
  await client.query('INSERT INTO npc_favors (character_id, week, npc_id) VALUES ($1,$2,$3)', [ch.id, week, npcId]);
  await h.track(client, ch.account_id, 'underworld_favor', { npc: npcId, ...favor });
  return { ok: true, npc: npcId, npcName: n.name, ...favor };
}

// THE ERRAND CHAIN (step five) — a fixture's storyline: do their DRAWN daily task on
// CHAIN_STEPS separate days and the relationship jumps CHAIN_BONUS. Tier 1+ with the fixture
// to be trusted with the work; one active chain per street — starting another replaces the
// half-done job (progress dropped, no penalty: walking off an errand costs the errand).
// Steps advance inside game.js bumpStanding when the day's matching action lands.
export async function startErrand(ch, npcId, client, h) {
  const n = npcOf(npcId);
  if (!n) throw new GameError('bad_npc', 'Nobody by that name works this town.');
  if (jailed(ch)) throw new GameError('jailed', 'No running errands from lockup.');
  if (npcTier(h, npcId) < 1) throw new GameError('stranger', `${n.name} doesn't hand work to strangers.`);
  const existing = (await client.query('SELECT npc_id, step FROM npc_errands WHERE character_id=$1', [ch.id])).rows[0];
  const day = dayOf();
  if (existing) await client.query('UPDATE npc_errands SET npc_id=$2, step=0, started_day=$3, last_day=NULL WHERE character_id=$1', [ch.id, npcId, day]);
  else await client.query('INSERT INTO npc_errands (character_id, npc_id, step, started_day) VALUES ($1,$2,0,$3)', [ch.id, npcId, day]);
  await h.track(client, ch.account_id, 'underworld_errand', { npc: npcId, replaced: existing?.npc_id });
  const task = leadTaskOf(day, npcId);
  return { ok: true, npc: npcId, npcName: n.name, steps: UNDERWORLD.STEP5.CHAIN_STEPS, bonus: UNDERWORLD.STEP5.CHAIN_BONUS,
    task, taskLabel: taskLabelOf(task),
    ...(existing ? { replaced: existing.npc_id, replacedName: npcOf(existing.npc_id)?.name || existing.npc_id } : {}) };
}

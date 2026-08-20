// SMUGGLING CONVOYS (design: omerta-convoys-design.md). Bulk goods on a real clock — visible on
// the streets, ambushable, turf-sheltered. Goods are OWNERSHIP, not §10.4 currency (an
// ambush is a pure transfer, trunk-capped; scattered remainder rolls on). Money flows:
// `convoy:guards` (cash sink), `convoy:ambush` (ammo sink), and step two's `convoy:toll`
// (a TRANSFER — shipper → the destination holder's treasury, the tribute pattern),
// `convoy:insure` (premium → the insurance pool) and `convoy:payout` (pool → shipper, CAPPED
// at the pool: zero-sum among shippers, the stake_pool precedent — collusion can only
// redistribute what premiums funded). Step two also allows up to MAX_AMBUSHES attempts per
// convoy (one per character), each fight WEARING the guard tier down for the next.
// Lock notes: every action locks the convoy row FOR UPDATE under the actor's withCharacter lock
// (characters → convoys → gangs → singletons, acyclic — the OWNER's character row is never
// touched by an ambush; the manifest is the contested object, not the man. The insurance CLAIM
// therefore settles lazily in the OWNER's own collect transaction, never the ambusher's).
import crypto from 'node:crypto';
import { postPower } from './roster.js';
import { GameError, bus, skillMult, trunkCap, npcMult, bumpStanding } from './game.js';
import { CONVOY, COMMISSION, SKILLS, UNDERWORLD, NOTORIETY, guardTierOf, DISTRICTS, GOODS, goodPriceOf,
  levelOf, rigOf, rigUpgradeCost, haulerRankOf, banditRankOf, haulerTierOf, smuggleRepPerks, pathFx, M3 , jailed, hospitalized, safeHoused, usd } from './rules.js';
import { activeDecree } from './commission.js';
import { laneHeat, heatLane } from './notoriety.js';

// TIER C — the hauler's reputation (from THE TEAMSTER legend rank tier): manages route notoriety (faster
// decay / lower gain) + a destination-toll break. Pure status→access, off every faucet curve.
async function haulerRep(client, accountId) {
  const delivered = Number((await client.query('SELECT freight_delivered FROM account_persistent WHERE account_id=$1', [accountId])).rows[0]?.freight_delivered || 0);
  return smuggleRepPerks(haulerTierOf(delivered));
}
const convoyLaneKey = (origin, destination) => 'convoy:' + origin + ':' + destination;

const uid = () => crypto.randomUUID();

// THE TEAMSTER / THE HIGHWAYMAN legends (Tier-4) — lifetime clean-delivered / hijacked value. Pure
// STATUS (account-level, survives death; NUMERIC arith → pg-mem-safe; off persistAccount's list, so
// clobber-safe). Bumps the ACTOR's OWN already-actor-locked account as a leaf write (the port
// bumpSmuggled posture) + logs a haul for the read-derived weekly contest. Gated at LEGEND_MIN_LVL.
async function bumpFreight(client, ch, kind, value) {
  if (levelOf(Number(ch.respect)) < CONVOY.LEGEND_MIN_LVL) return;
  const v = Math.floor(Math.max(0, Number(value) || 0));
  if (v <= 0) return;
  const col = kind === 'hijack' ? 'freight_hijacked' : 'freight_delivered';
  await client.query(`UPDATE account_persistent SET ${col} = ${col} + $1 WHERE account_id=$2`, [v, ch.account_id]);
  await client.query('INSERT INTO convoy_hauls (id, account_id, kind, value) VALUES ($1,$2,$3,$4)', [uid(), ch.account_id, kind, v]);
}
const rand = (n) => Math.random() * n;
const convoyMs = () => Number(process.env.CONVOY_MS || CONVOY.MS); // TEST-ONLY override (SEARCH_MS pattern)
const cargoCount = (cargo) => Object.values(cargo).reduce((a, n) => a + (n || 0), 0);

async function setCargo(client, charId, goodId, qty) {
  await client.query('DELETE FROM character_cargo WHERE character_id=$1 AND good_id=$2', [charId, goodId]);
  if (qty > 0) await client.query('INSERT INTO character_cargo (character_id, good_id, qty) VALUES ($1,$2,$3)', [charId, goodId, qty]);
}
async function manifestOf(client, convoyId) {
  return (await client.query('SELECT good_id, qty FROM convoy_cargo WHERE convoy_id=$1 AND qty > 0', [convoyId])).rows;
}
function manifestValue(rows, district) {
  return rows.reduce((a, r) => a + goodPriceOf(r.good_id, district) * Number(r.qty), 0);
}
// the public feed never sees the manifest — only an order-of-magnitude band
const valueBand = (v) => v < 5000 ? 'light' : v < 50000 ? 'respectable' : v < 500000 ? 'heavy' : 'a king\'s ransom';

async function myActive(client, characterId) {
  return (await client.query(
    "SELECT * FROM convoys WHERE owner_character=$1 AND status IN ('loading','transit') FOR UPDATE", [characterId])).rows[0] || null;
}

// resolve transit → done lazily on read (arrival needs no tick — the clock is the row)
const arrived = (c) => c.status === 'transit' && c.arrives_at && new Date(c.arrives_at) <= new Date();

// OPEN + first load — at your current district, goods straight from the trunk.
export async function openConvoy(ch, to, goodId, qty, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No shipping from lockup.');
  if (!DISTRICTS.find((d) => d.id === to)) throw new GameError('bad_district', 'No such destination.');
  if (to === ch.loc) throw new GameError('same', "It's already here.");
  if (await myActive(client, ch.id)) throw new GameError('busy', 'One shipment on the road at a time.');
  const id = uid();
  await client.query('INSERT INTO convoys (id, owner_character, origin, destination) VALUES ($1,$2,$3,$4)', [id, ch.id, ch.loc, to]);
  const r = await loadConvoyRow(ch, { id, origin: ch.loc, status: 'loading' }, goodId, qty, client, h);
  return { ok: true, id, origin: ch.loc, destination: to, loaded: r.loaded, good: r.good, units: r.units, minUnits: r.minUnits };
}

async function loadConvoyRow(ch, convoy, goodId, qty, client, h) {
  if (!GOODS.find((g) => g.id === goodId)) throw new GameError('bad_good', 'No such good.');
  if (ch.loc !== convoy.origin) throw new GameError('district', 'Loading happens at the origin dock.', { district: convoy.origin });
  const have = h.owned.cargo[goodId] || 0;
  const n = Math.min(Math.max(1, Math.floor(Number(qty) || 0)), have);
  if (n <= 0) throw new GameError('none', 'Nothing of that in the trunk.');
  // ABSOLUTE writes (not `qty = qty + n`): pg-mem mis-evaluates arithmetic on INT columns — the
  // same reason setCargo is DELETE+INSERT. Safe: the convoy row lock serializes manifest access.
  const cur = (await client.query('SELECT qty FROM convoy_cargo WHERE convoy_id=$1 AND good_id=$2', [convoy.id, goodId])).rows[0];
  if (cur) await client.query('UPDATE convoy_cargo SET qty = $3 WHERE convoy_id=$1 AND good_id=$2', [convoy.id, goodId, Number(cur.qty) + n]);
  else await client.query('INSERT INTO convoy_cargo (convoy_id, good_id, qty) VALUES ($1,$2,$3)', [convoy.id, goodId, n]);
  h.owned.cargo[goodId] = have - n;
  await setCargo(client, ch.id, goodId, have - n);
  // THE MINIMUM IS A TERM, and departure is where a player used to first hear it: a convoy is for
  // BULK (CONVOY.MIN_QTY) and refuses to roll under it. The manifest total lives on the convoy, not
  // on the character, so only the server can say how far short the load is — the withheld-terms
  // class (the pad, the nut, the Port lane picker) on the one screen that spends a whole trunk.
  const units = Number((await client.query('SELECT COALESCE(SUM(qty),0) n FROM convoy_cargo WHERE convoy_id=$1', [convoy.id])).rows[0].n);
  return { ok: true, loaded: n, good: goodId, units, minUnits: CONVOY.MIN_QTY };
}

// LOAD MORE — trunk → manifest while still loading (refill the trunk from the market between loads).
export async function loadConvoy(ch, goodId, qty, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No shipping from lockup.');
  const convoy = await myActive(client, ch.id);
  if (!convoy || convoy.status !== 'loading') throw new GameError('no_convoy', 'No shipment loading.');
  return loadConvoyRow(ch, convoy, goodId, qty, client, h);
}

// DEPART — pick the guard tier (the fee is the sink; the tier is never public) and hit the road.
// Step two: `insure` buys freight insurance — a premium of INSURE_BPS of the manifest's base
// value into the shared pool (`convoy:insure`); a hijack later pays INSURE_PAYOUT_BPS of the
// LOST value back at collect, capped at whatever the pool holds. Insurance is never public.
export async function departConvoy(ch, guardTier, insure, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No shipping from lockup.');
  const convoy = await myActive(client, ch.id);
  if (!convoy || convoy.status !== 'loading') throw new GameError('no_convoy', 'No shipment loading.');
  const tier = guardTierOf(guardTier || 'none');
  if (!tier) throw new GameError('bad_guards', "Guard tiers: none, crew, heavy.");
  const manifest = await manifestOf(client, convoy.id);
  const units = manifest.reduce((a, r) => a + Number(r.qty), 0);
  if (units < CONVOY.MIN_QTY) throw new GameError('light', `A convoy is for BULK — ${CONVOY.MIN_QTY} units minimum.`);
  const value = manifestValue(manifest, convoy.destination);
  const premium = insure ? Math.ceil(value * CONVOY.INSURE_BPS / 10000) : 0;
  // BIG TUNA T1 (underworld): the Harbor Master's friends hire guards at a discount — the
  // muscle (tier.def) is unchanged, only the fee. Discounted amount is what's ledgered.
  const guardFee = Math.floor(tier.fee * npcMult(h, 'harbor', 1, UNDERWORLD.FX.GUARD_MULT));
  if (Number(ch.cash) < guardFee + premium)
    throw new GameError('cash', `${tier.id} guards run ${usd(guardFee)}${premium ? ` and the policy $${premium}` : ''}.`);
  if (guardFee > 0) {
    ch.cash = Number(ch.cash) - guardFee;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -guardFee, reason: 'convoy:guards' });
  }
  if (premium > 0) {
    ch.cash = Number(ch.cash) - premium;
    const pool = (await client.query('SELECT pool FROM convoy_insurance WHERE id=1 FOR UPDATE')).rows[0];
    await client.query('UPDATE convoy_insurance SET pool=$1 WHERE id=1', [Number(pool.pool) + premium]);
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -premium, reason: 'convoy:insure' });
  }
  // THE RIG (Tier-4): a built hauler adds ARMOR to the guard defense and an ENGINE transit-cut.
  // Composes multiplicatively with ROAD CAPTAIN (skills) + OPEN_ROADS (Commission decree, if any).
  const rig = (await client.query('SELECT * FROM rigs WHERE character_id=$1', [ch.id])).rows[0];
  const rigCfg = rig ? rigOf(rig.kind) : null;
  const rigArmor = rigCfg ? rigCfg.armor + Number(rig.armor_lvl || 0) * CONVOY.RIG_ARMOR_STEP : 0;
  const rigSpeedBps = rigCfg ? Math.min(CONVOY.RIG_SPEED_CAP_BPS, rigCfg.speedBps + Number(rig.engine_lvl || 0) * CONVOY.RIG_ENGINE_STEP_BPS) : 0;
  // OPEN_ROADS decree (Commission Tier-4): the roads move quicker for everyone this week (COMMISSION.OPEN_ROADS_MULT if armed, else 1)
  const openRoads = (await activeDecree(client))?.id === 'open_roads' ? (COMMISSION.OPEN_ROADS_MULT || 1) : 1;
  // ROAD CAPTAIN (skills): the wheelman's convoys run faster — a new modifier, sign-off lever
  const rideMs = Math.floor(convoyMs() * skillMult(h, 'road_captain', SKILLS.FX.CONVOY_MULT) * (1 - rigSpeedBps / 10000) * openRoads
    * pathFx(ch, 'convoyTime')); // PATHS v2 — the Wheel's convoys run faster (stacks with road_captain; pacing only)
  const arrivesAt = new Date(Date.now() + rideMs);
  // TIER C: a hammered LANE sheds guard defense — the bandits have it cased. Read the lane's current NOTORIETY
  // (a legend's rep cools it faster), cut the effective guards this run, then HEAT the lane for next time. The
  // stored `guards` is what an ambush's def reads, so the cut is baked in at depart. Emission-safe: an ambush
  // is a pure ownership transfer, not a §10.4 faucet — this only changes WHO holds the same bounded haul.
  const rep = await haulerRep(client, ch.account_id);
  const laneKey = convoyLaneKey(convoy.origin, convoy.destination);
  const heat = await laneHeat(client, ch.id, laneKey, rep.decayMult);
  const defCut = Math.min(NOTORIETY.CONVOY_DEF_CAP, heat * NOTORIETY.CONVOY_DEF_PER);
  const guards = Math.max(0, Math.round(tier.def + rigArmor - defCut));
  await client.query("UPDATE convoys SET status='transit', guards=$2, owner_gang=$3, insured=$4, departed_at=now(), arrives_at=$5 WHERE id=$1",
    [convoy.id, guards, h.owned.gangId || null, !!premium, arrivesAt]);
  await heatLane(client, ch.id, laneKey, rep.decayMult, rep.gainMult);
  const band = valueBand(value);
  bus.emit('streets', { type: 'convoy', from: convoy.origin, to: convoy.destination, band });
  await bumpStanding(client, h, ch, 'harbor', 2, { action: 'depart' }); // freight on the water is Big Tuna's business
  await h.track(client, ch.account_id, 'convoy_depart', { units, guards: tier.id, insured: !!premium });
  return { ok: true, id: convoy.id, arrivesSeconds: Math.ceil(rideMs / 1000), units, band, premium, notoriety: Math.round(heat), guardCut: Math.round(defCut) };
}

// CANCEL while loading — the goods come back to the trunk (they must fit).
export async function cancelConvoy(ch, client, h) {
  const convoy = await myActive(client, ch.id);
  if (!convoy || convoy.status !== 'loading') throw new GameError('no_convoy', 'No shipment loading.');
  const manifest = await manifestOf(client, convoy.id);
  const units = manifest.reduce((a, r) => a + Number(r.qty), 0);
  const cap = trunkCap(h);
  if (cargoCount(h.owned.cargo) + units > cap) throw new GameError('cargo', 'The trunk cannot take it all back — sell something first.');
  for (const m of manifest) {
    const back = (h.owned.cargo[m.good_id] || 0) + Number(m.qty);
    h.owned.cargo[m.good_id] = back;
    await setCargo(client, ch.id, m.good_id, back);
  }
  await client.query("UPDATE convoys SET status='done' WHERE id=$1", [convoy.id]);
  await client.query('DELETE FROM convoy_cargo WHERE convoy_id=$1', [convoy.id]);
  // `convoy:` NAMES THE SYSTEM, not the state — the exchange:'listed'|'pulled'|'bought' precedent.
  // A bare {ok, returned} read "done." at the player: they called off a shipment, the whole manifest
  // came back off the truck into the trunk, and the game said nothing about either half.
  return { ok: true, convoy: 'cancelled', returned: units };
}

// AMBUSH — once per convoy, win or lose. The owner's character row is never touched.
export async function ambushConvoy(ch, convoyId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No highway work from lockup.');
  if (safeHoused(ch)) throw new GameError('safe', "No ambushes while you're to ground — a safehouse is a shield, not a bunker.");
  if (hospitalized(ch)) throw new GameError('hosp', 'Not in your condition.');
  if (Number(ch.energy) < CONVOY.AMBUSH_ENERGY) throw new GameError('energy', `An ambush takes ${CONVOY.AMBUSH_ENERGY} energy.`);
  if ((Number(ch.ammo) || 0) < CONVOY.AMBUSH_AMMO) throw new GameError('ammo', `An ambush takes ${CONVOY.AMBUSH_AMMO} rounds.`);
  const c = (await client.query('SELECT * FROM convoys WHERE id=$1 FOR UPDATE', [convoyId])).rows[0];
  if (!c || c.status !== 'transit') throw new GameError('no_convoy', 'Nothing on that road.');
  if (arrived(c)) throw new GameError('arrived', 'It already reached the docks.');
  if (c.owner_character === ch.id) throw new GameError('own', "It's your own truck.");
  if (c.owner_gang && h.owned.gangId === c.owner_gang) throw new GameError('family', "That's the family's freight. Omertà.");
  // step two (audit-hardened): up to MAX_AMBUSHES HIJACKS per convoy, ONE attempt per character.
  // Only a WIN consumes the convoy-wide cap and wears the guards — a deliberate loss by a
  // throwaway alt buys the shipper nothing (slot-exhaustion, audit HIGH-2) and strips no
  // defense for the next bandit. A loss still spends the loser's one play on the run.
  const prior = Number(c.ambushes || 0); // = prior HIJACKS
  if (prior >= CONVOY.MAX_AMBUSHES) throw new GameError('spent', 'That road has seen enough — the law is thick out there now.');
  const mine = (await client.query('SELECT 1 FROM convoy_ambushes WHERE convoy_id=$1 AND character_id=$2', [convoyId, ch.id])).rows[0];
  if (mine) throw new GameError('once', 'You already made your play on that run.');

  ch.energy = Number(ch.energy) - CONVOY.AMBUSH_ENERGY;
  ch.ammo = Number(ch.ammo) - CONVOY.AMBUSH_AMMO;
  ch.heat = Math.min(100, Number(ch.heat || 0) + CONVOY.AMBUSH_HEAT);
  await h.ledger(client, { characterId: ch.id, currency: 'ammo', amount: -CONVOY.AMBUSH_AMMO, reason: 'convoy:ambush' });
  // RIVALRY pair #2 (Underworld step three): road piracy picks a side — win or lose, the
  // ATTEMPT is what the town hears. Bella loves the chaos; the Harbor Master does not.
  await bumpStanding(client, h, ch, 'armorer', UNDERWORLD.STEP3.AMBUSH_ARMORER, { action: 'ambush' });
  await bumpStanding(client, h, ch, 'harbor', -UNDERWORLD.STEP3.AMBUSH_HARBOR);
  await client.query('INSERT INTO convoy_ambushes (convoy_id, character_id) VALUES ($1,$2)', [convoyId, ch.id]);
  await client.query('UPDATE convoys SET ambushed=true WHERE id=$1', [convoyId]);

  // turf shelters its own: a run touching the owner family's districts fights harder
  let turfDef = 0;
  if (c.owner_gang) {
    const held = (await client.query('SELECT id FROM districts WHERE holder_gang=$1', [c.owner_gang])).rows.map((d) => d.id);
    if (held.includes(c.origin) || held.includes(c.destination)) turfDef = CONVOY.TURF_DEF;
  }
  // Commission decree: LOCKDOWN — every convoy on the road fights with extra guns this week
  const lockdown = (await activeDecree(client))?.id === 'lockdown' ? COMMISSION.LOCKDOWN_DEF : 0;
  // THE ROSTER — THE QUARTERMASTER: a family that keeps a freight man in the chair sends its runs
  // out better armed. Zero while the post is empty or its holder is dead/jailed/hospitalized, which
  // is how a bandit crew softens a family's whole road without touching a single shipment.
  const qm = c.owner_gang ? await postPower(client, c.owner_gang, 'quartermaster') * M3.ROSTER_QM_GUARD_DEF : 0;
  const wear = Math.min(1, prior * CONVOY.GUARD_WEAR_BPS / 10000);
  const guardDef = Number(c.guards) * (1 - wear);
  const atk = Number(ch.muscle) + Number(ch.speed) * 0.5 + rand(30);
  const def = guardDef + turfDef + lockdown + qm + rand(30);
  await h.rngLog(client, ch.id, `convoy:ambush:${convoyId}`,
    Math.round(atk * 100) / 100,
    `${atk > def ? 'hijacked' : 'repelled'} (def ${Math.round(def * 100) / 100}${lockdown ? ', lockdown' : ''}${qm ? `, quartermaster +${qm}` : ''}${prior ? `, guards worn ${prior}` : ''})`);

  if (atk > def) {
    // the WIN consumes a convoy hijack slot and wears the guards for the next crew
    await client.query('UPDATE convoys SET ambushes=$2 WHERE id=$1', [convoyId, prior + 1]);
    // take what the trunk holds — a pure ownership transfer; the rest rolls on to the docks
    const manifest = await manifestOf(client, convoyId);
    const cap = trunkCap(h);
    let space = Math.max(0, cap - cargoCount(h.owned.cargo));
    let taken = 0, lossValue = 0;
    for (const m of manifest) {
      if (space <= 0) break;
      const grab = Math.min(Number(m.qty), space);
      space -= grab; taken += grab;
      lossValue += goodPriceOf(m.good_id, c.destination) * grab;
      h.owned.cargo[m.good_id] = (h.owned.cargo[m.good_id] || 0) + grab;
      await setCargo(client, ch.id, m.good_id, h.owned.cargo[m.good_id]);
      await client.query('UPDATE convoy_cargo SET qty = $3 WHERE convoy_id=$1 AND good_id=$2', [convoyId, m.good_id, Number(m.qty) - grab]);
    }
    // insured freight: stamp the base value lost — the OWNER claims lazily at collect (their
    // own transaction; an ambush never touches the owner's character row). No money moves here.
    if (c.insured && lossValue > 0)
      await client.query('UPDATE convoys SET insured_loss=$2 WHERE id=$1', [convoyId, Number(c.insured_loss || 0) + lossValue]);
    await bumpFreight(client, ch, 'hijack', lossValue); // THE HIGHWAYMAN legend (Tier-4) — the value taken off the road
    if (c.owner_character) await h.notify(client, c.owner_character, 'convoy_hit', { from: c.origin, to: c.destination, taken }); // NPC convoys have no owner to notify (step three)
    bus.emit('streets', { type: 'convoy_hijacked', by: ch.name, from: c.origin, to: c.destination });
    await h.track(client, ch.account_id, 'convoy_ambush', { win: true, taken });
    return { ok: true, win: true, taken, trunkFull: space <= 0 };
  }
  // the guards earn their fee
  ch.health = Math.max(1, Number(ch.health) - (20 + Math.floor(rand(20))));
  ch.hosp_until = new Date(Date.now() + CONVOY.FAIL_HOSP_MS);
  if (c.owner_character) await h.notify(client, c.owner_character, 'convoy_defended', { from: c.origin, to: c.destination }); // NPC convoys have no owner (step three)
  await h.track(client, ch.account_id, 'convoy_ambush', { win: false });
  return { ok: true, win: false, hospSeconds: Math.ceil(CONVOY.FAIL_HOSP_MS / 1000) };
}

// COLLECT — after arrival, at the destination, trunk-capacity at a time. Step two settles the
// money here, in the OWNER's own transaction (lock order characters → convoys → gangs →
// singletons): the destination TOLL (holder family's cut of what lands on their docks — a
// ledgered transfer, clamped to pocket, never a gate on the freight) and the INSURANCE claim
// (payout for hijacked value, capped at whatever the pool holds — insurers' risk).
export async function collectConvoy(ch, convoyId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No collecting from lockup.');
  // D2: collection is an EXPOSED act (freight, toll, insurance settlement) — not from a safehouse
  if (safeHoused(ch)) throw new GameError('safe', "Nobody signs for freight from a safehouse — come out first.");
  const c = (await client.query('SELECT * FROM convoys WHERE id=$1 FOR UPDATE', [convoyId])).rows[0];
  if (!c || c.owner_character !== ch.id) throw new GameError('no_convoy', 'Not your shipment.');
  if (c.status !== 'transit') throw new GameError('no_convoy', 'Nothing to collect.');
  if (!arrived(c)) throw new GameError('en_route', 'Still on the road.');
  if (ch.loc !== c.destination) throw new GameError('district', `The freight lands at ${c.destination} — be there.`, { district: c.destination });
  const manifest = await manifestOf(client, convoyId);
  const cap = trunkCap(h);
  let space = Math.max(0, cap - cargoCount(h.owned.cargo));
  // A NO-OP MUST NOT READ AS A SUCCESS (the same class describe() already carries a note about, one
  // verb over). Freight comes off a trunk-load at a time, so a driver who turns up with a full trunk
  // moved NOTHING — and this returned `{ok:true, collected:0}`, a 200 with nothing behind it. A
  // tester reported it as "I can't collect my convoy", which is exactly what it looks like from the
  // outside: you press the button and the freight stays on the truck with no reason given.
  // Refuse, and say what to do about it. Only when there is actually freight to take: a convoy
  // whose whole manifest was hijacked still needs collecting to settle the insurance.
  const onBoard = manifest.reduce((s, m) => s + Number(m.qty), 0);
  if (onBoard > 0 && space <= 0) {
    throw new GameError('full', `Your trunk is full — ${cargoCount(h.owned.cargo)}/${cap}. `
      + `Sell or drop something and come back; the freight keeps at the dock.`);
  }
  let taken = 0, left = 0, collectedValue = 0;
  for (const m of manifest) {
    const grab = Math.min(Number(m.qty), space);
    space -= grab; taken += grab; left += Number(m.qty) - grab;
    if (grab > 0) {
      collectedValue += goodPriceOf(m.good_id, c.destination) * grab;
      h.owned.cargo[m.good_id] = (h.owned.cargo[m.good_id] || 0) + grab;
      await setCargo(client, ch.id, m.good_id, h.owned.cargo[m.good_id]);
      await client.query('UPDATE convoy_cargo SET qty = $3 WHERE convoy_id=$1 AND good_id=$2', [convoyId, m.good_id, Number(m.qty) - grab]);
    }
  }
  await bumpFreight(client, ch, 'deliver', collectedValue); // THE TEAMSTER legend (Tier-4) — clean freight landed
  // the destination toll: the family holding these docks takes its cut of what YOU collect
  // (unheld docks — and the family you SHIPPED UNDER (the depart snapshot, so a last-minute
  // join can't dodge it) — are free). The toll reaches pocket THEN bank (the raid-fine
  // precedent — banking before collect doesn't dodge it), never gates the freight, and is
  // charged only if the treasury credit actually lands (a holder dissolving this instant
  // must not leave a ledgered credit no treasury received — §10.4 check (b) stays exact).
  let toll = 0;
  const holder = (await client.query('SELECT holder_gang FROM districts WHERE id=$1', [c.destination])).rows[0]?.holder_gang;
  if (holder && holder !== c.owner_gang && collectedValue > 0) {
    // TIER C: a known hauler (rep T2) is tolled at half — a transfer discount (§10.4-neutral: the holder
    // treasury just receives less; nothing is created). The discounted amount is what's ledgered.
    const tollMult = (await haulerRep(client, ch.account_id)).tollMult;
    toll = Math.min(Math.floor(collectedValue * CONVOY.TOLL_BPS / 10000 * tollMult),
      Math.max(0, Math.floor(Number(ch.cash) + Number(ch.bank))));
    if (toll > 0) {
      const upd = await client.query('UPDATE gangs SET treasury = treasury + $2 WHERE id=$1', [holder, toll]);
      if (upd.rowCount) {
        const fromPocket = Math.min(toll, Math.max(0, Math.floor(Number(ch.cash))));
        ch.cash = Number(ch.cash) - fromPocket;
        ch.bank = Number(ch.bank) - (toll - fromPocket);
        await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -toll, reason: 'convoy:toll' });
      } else toll = 0;
    }
  }
  // the insurance claim: pay out the hijacked value's share — capped at the pool AND at the
  // account's own lifetime net premiums (the UNDERWRITING LIMIT, audit HIGH-1: you can never
  // claim more than your bloodline ever paid in, so a colluding ring's net extraction from
  // the pool is ≤ 0 BY CONSTRUCTION; honest shippers pay premiums every run and claim rarely,
  // so the limit never binds on them).
  let insurance = 0;
  if (c.insured && Number(c.insured_loss) > 0) {
    const pool = Number((await client.query('SELECT pool FROM convoy_insurance WHERE id=1 FOR UPDATE')).rows[0].pool);
    const paid = -Number((await client.query(
      `SELECT COALESCE(SUM(t.amount),0) s FROM transactions t JOIN characters c2 ON c2.id = t.character_id
        WHERE c2.account_id=$1 AND t.reason='convoy:insure'`, [ch.account_id])).rows[0].s);
    const got = Number((await client.query(
      `SELECT COALESCE(SUM(t.amount),0) s FROM transactions t JOIN characters c2 ON c2.id = t.character_id
        WHERE c2.account_id=$1 AND t.reason='convoy:payout'`, [ch.account_id])).rows[0].s);
    const coverage = Math.max(0, Math.floor(paid - got));
    insurance = Math.min(Math.floor(Number(c.insured_loss) * CONVOY.INSURE_PAYOUT_BPS / 10000),
      Math.max(0, Math.floor(pool)), coverage);
    if (insurance > 0) {
      ch.cash = Number(ch.cash) + insurance;
      await client.query('UPDATE convoy_insurance SET pool=$1 WHERE id=1', [pool - insurance]);
      await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: insurance, reason: 'convoy:payout' });
    }
    await client.query('UPDATE convoys SET insured_loss=0 WHERE id=$1', [convoyId]);
  }
  if (left === 0) await client.query("UPDATE convoys SET status='done' WHERE id=$1", [convoyId]);
  if (taken > 0) await bumpStanding(client, h, ch, 'harbor', 3, { action: 'collect' }); // landed freight seals the relationship
  return { ok: true, collected: taken, remaining: left, toll, insurance };
}

// The road board: everything in transit (value BAND only — scouting the tier is the gamble),
// plus my active shipment in full.
// ── step three: NPC TRUCKING — the worker keeps CONVOY.NPC.TARGET unmarked trucks on the road so the
// ambush loop is live even when no players are shipping. An NPC convoy carries real goods (a modest
// manifest); a hijack transfers them to the raider's trunk via the SAME ambushConvoy (the goods are the
// one new faucet — sold via the market — bounded by TARGET × manifest × hijack success × the trunk cap,
// sim-measured, the World-raid precedent). An unhijacked NPC convoy simply despawns on arrival. ──
export async function spawnNpcConvoys(pool) {
  const live = Number((await pool.query("SELECT COUNT(*) n FROM convoys WHERE is_npc AND status='transit'")).rows[0].n);
  let spawned = 0;
  for (let i = live; i < CONVOY.NPC.TARGET; i++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ds = [...DISTRICTS];
      const origin = ds[Math.floor(Math.random() * ds.length)].id;
      let destination = origin; while (destination === origin) destination = ds[Math.floor(Math.random() * ds.length)].id;
      const good = CONVOY.NPC.GOODS[Math.floor(Math.random() * CONVOY.NPC.GOODS.length)];
      const qty = CONVOY.NPC.MIN_QTY + Math.floor(Math.random() * (CONVOY.NPC.MAX_QTY - CONVOY.NPC.MIN_QTY + 1));
      const tierId = CONVOY.NPC.GUARDS[Math.floor(Math.random() * CONVOY.NPC.GUARDS.length)];
      const def = (guardTierOf(tierId) || CONVOY.GUARD_TIERS[0]).def;
      const id = uid(); const now = new Date(); const arrives = new Date(now.getTime() + convoyMs());
      await client.query(
        "INSERT INTO convoys (id, owner_character, is_npc, owner_gang, origin, destination, status, guards, departed_at, arrives_at) VALUES ($1,NULL,true,NULL,$2,$3,'transit',$4,$5,$6)",
        [id, origin, destination, def, now, arrives]);
      await client.query('INSERT INTO convoy_cargo (convoy_id, good_id, qty) VALUES ($1,$2,$3)', [id, good, qty]);
      await client.query('COMMIT'); spawned++;
    } catch (e) { await client.query('ROLLBACK'); console.error('[spawnNpcConvoys]', e?.code || e?.message || e); } finally { client.release(); }
  }
  return { spawned };
}
// remove NPC convoys that reached the docks (the driver delivered — the remaining freight leaves the world;
// hijacked goods already went to the raiders). Player convoys are never touched here.
export async function despawnArrivedNpc(pool) {
  const due = (await pool.query("SELECT id FROM convoys WHERE is_npc AND status='transit' AND arrives_at <= now()")).rows;
  let despawned = 0;
  for (const { id } of due) {
    const client = await pool.connect();
    try { // one txn per truck: the three deletes land together (no orphan cargo on a mid-despawn crash) — RED-TEAM hardening
      await client.query('BEGIN');
      await client.query('DELETE FROM convoy_cargo WHERE convoy_id=$1', [id]);
      await client.query('DELETE FROM convoy_ambushes WHERE convoy_id=$1', [id]);
      await client.query('DELETE FROM convoys WHERE id=$1', [id]);
      await client.query('COMMIT'); despawned++;
    } catch (e) { await client.query('ROLLBACK'); console.error('[despawnArrivedNpc]', id, e?.code || e?.message || e); } finally { client.release(); }
  }
  return { despawned };
}

// ── Tier-4 THE RIG — a buyable hauler + armor/engine upgrades (cash SINKS on the convoy: prefix) ──
export async function buyRig(ch, kind, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No shopping for trucks from lockup.');
  const cfg = rigOf(kind);
  if (!cfg) throw new GameError('bad_rig', 'No such rig — Panel Van, Box Truck, Armored Hauler, The Semi.');
  if (levelOf(Number(ch.respect)) < cfg.minLvl) throw new GameError('level', `The ${cfg.name} is for level ${cfg.minLvl}+.`);
  if ((await client.query('SELECT 1 FROM rigs WHERE character_id=$1', [ch.id])).rows[0])
    throw new GameError('already', 'You run one rig — sell the old one first (well, you would if we let you; trade up later).');
  if (Number(ch.cash) < cfg.cost) throw new GameError('cash', `The ${cfg.name} runs ${usd(cfg.cost)}.`);
  ch.cash = Number(ch.cash) - cfg.cost;
  await client.query('INSERT INTO rigs (character_id, kind) VALUES ($1,$2)', [ch.id, cfg.id]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cfg.cost, reason: 'convoy:rig' });
  return { ok: true, rig: cfg.id, name: cfg.name, cost: cfg.cost };
}

export async function upgradeRig(ch, track, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No wrenching from lockup.');
  const t = track === 'engine' ? 'engine' : 'armor';
  const rig = (await client.query('SELECT * FROM rigs WHERE character_id=$1 FOR UPDATE', [ch.id])).rows[0];
  if (!rig) throw new GameError('no_rig', 'Buy a rig first.');
  const lvlCol = t === 'engine' ? 'engine_lvl' : 'armor_lvl';
  const cur = Number(rig[lvlCol] || 0);
  if (cur >= CONVOY.RIG_UPGRADE_MAX) throw new GameError('maxed', `The ${t} is as built as it gets.`);
  const cost = rigUpgradeCost(rigOf(rig.kind), cur);
  if (Number(ch.cash) < cost) throw new GameError('cash', `The next ${t} level runs ${usd(cost)}.`);
  ch.cash = Number(ch.cash) - cost;
  await client.query(`UPDATE rigs SET ${lvlCol}=$2 WHERE character_id=$1`, [ch.id, cur + 1]); // ABSOLUTE write (pg-mem INT-arith quirk)
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'convoy:rig:up' });
  return { ok: true, track: t, level: cur + 1, cost };
}

// THE TWO LEADERBOARDS (Tier-4) — the biggest lifetime haulers + highwaymen (agents excluded). Status.
export async function convoyLeaderboard(pool) {
  const q = async (col) => (await pool.query(
    `SELECT a.${col} v, c.name FROM account_persistent a
       JOIN characters c ON c.account_id = a.account_id AND c.alive
      WHERE a.${col} > 0 AND NOT a.agent_flag AND NOT c.is_npc ORDER BY a.${col} DESC, c.name LIMIT 15`)).rows;
  const teamsters = (await q('freight_delivered')).map((r, i) => ({ pos: i + 1, name: r.name, value: Number(r.v), rank: haulerRankOf(r.v).title }));
  const highwaymen = (await q('freight_hijacked')).map((r, i) => ({ pos: i + 1, name: r.name, value: Number(r.v), rank: banditRankOf(r.v).title }));
  return { teamsters, highwaymen };
}

// worker sweep — drop stale haul-log rows (the weekly-contest reads window-filter, so a missed sweep is only bloat)
export async function sweepConvoyHauls(pool) {
  const r = await pool.query('DELETE FROM convoy_hauls WHERE at < now() - $1::interval',
    [`${Math.floor(CONVOY.HAULS_RETENTION_MS / 1000)} seconds`]);
  return { swept: r.rowCount || 0 };
}

// the read-derived weekly contest leader (Road Boss = most hijacked this week / Teamster = most delivered).
// Flat query + JS aggregate — pg-mem chokes on a GROUP BY aggregate with a joined alias (the /v1/gangs
// precedent), so sum per account in JS. Agents excluded; a line with no living character is skipped.
async function topWeek(pool, kind) {
  const since = new Date(Date.now() - CONVOY.CONTEST_WINDOW_MS);
  const rows = (await pool.query('SELECT account_id, value FROM convoy_hauls WHERE kind=$1 AND at > $2', [kind, since])).rows;
  if (!rows.length) return null;
  const agents = new Set((await pool.query('SELECT account_id FROM account_persistent WHERE agent_flag')).rows.map((a) => a.account_id));
  const tally = {};
  for (const r of rows) { if (agents.has(r.account_id)) continue; tally[r.account_id] = (tally[r.account_id] || 0) + Number(r.value); }
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  const who = (await pool.query('SELECT name FROM characters WHERE account_id=$1 AND alive LIMIT 1', [top[0]])).rows[0];
  if (!who) return null;
  return { name: who.name, value: Math.floor(top[1]) };
}

export async function convoyBoard(pool, characterId) {
  const rows = (await pool.query(
    `SELECT c.*, ch.name AS owner FROM convoys c JOIN characters ch ON ch.id = c.owner_character
      WHERE c.status='transit' AND NOT c.is_npc ORDER BY c.arrives_at ASC LIMIT 30`)).rows;
  // NPC trucks — no owner to JOIN; surfaced as ambush targets alongside the player convoys (step three)
  const npc = (await pool.query(
    "SELECT * FROM convoys WHERE is_npc AND status='transit' ORDER BY arrives_at ASC LIMIT 30")).rows;
  const cargo = (await pool.query(
    'SELECT convoy_id, good_id, qty FROM convoy_cargo WHERE qty > 0')).rows;
  const byConvoy = {};
  for (const r of cargo) (byConvoy[r.convoy_id] = byConvoy[r.convoy_id] || []).push(r);
  const mapConvoy = (c, owner) => ({ id: c.id, owner, npc: !!c.is_npc, from: c.origin, to: c.destination,
    band: valueBand(manifestValue(byConvoy[c.id] || [], c.destination)),
    ambushed: c.ambushed, ambushes: Number(c.ambushes || 0), ambushesLeft: Math.max(0, CONVOY.MAX_AMBUSHES - Number(c.ambushes || 0)),
    arrivesSeconds: Math.max(0, Math.ceil((new Date(c.arrives_at) - Date.now()) / 1000)) });
  const inTransit = [...rows.map((c) => mapConvoy(c, c.owner)),
    ...npc.map((c) => mapConvoy(c, 'an unmarked truck'))];
  const mine = (await pool.query(
    "SELECT * FROM convoys WHERE owner_character=$1 AND status IN ('loading','transit')", [characterId])).rows[0] || null;
  let my = null;
  if (mine) {
    const m = (byConvoy[mine.id]) || (await pool.query('SELECT good_id, qty FROM convoy_cargo WHERE convoy_id=$1 AND qty > 0', [mine.id])).rows;
    my = { id: mine.id, status: arrived(mine) ? 'arrived' : mine.status, from: mine.origin, to: mine.destination,
      manifest: m.map((x) => ({ good: x.good_id, qty: Number(x.qty) })), ambushed: mine.ambushed,
      ambushes: Number(mine.ambushes || 0), insured: mine.insured,
      insuranceDue: mine.insured ? Math.floor(Number(mine.insured_loss || 0) * CONVOY.INSURE_PAYOUT_BPS / 10000) : 0,
      arrivesSeconds: mine.arrives_at ? Math.max(0, Math.ceil((new Date(mine.arrives_at) - Date.now()) / 1000)) : null };
  }
  // Tier-4 — the caller's two legends + their rig + the read-derived weekly contest + the rig catalog
  const acct = (await pool.query(
    'SELECT ap.freight_delivered, ap.freight_hijacked FROM account_persistent ap JOIN characters c ON c.account_id=ap.account_id WHERE c.id=$1',
    [characterId])).rows[0] || {};
  const rigRow = (await pool.query('SELECT * FROM rigs WHERE character_id=$1', [characterId])).rows[0];
  let rig = null;
  if (rigRow) {
    const cfg = rigOf(rigRow.kind) || {};
    rig = { kind: rigRow.kind, name: cfg.name, armorLvl: Number(rigRow.armor_lvl || 0), engineLvl: Number(rigRow.engine_lvl || 0),
      armorDef: (cfg.armor || 0) + Number(rigRow.armor_lvl || 0) * CONVOY.RIG_ARMOR_STEP,
      speedBps: Math.min(CONVOY.RIG_SPEED_CAP_BPS, (cfg.speedBps || 0) + Number(rigRow.engine_lvl || 0) * CONVOY.RIG_ENGINE_STEP_BPS),
      max: CONVOY.RIG_UPGRADE_MAX,
      nextArmorCost: Number(rigRow.armor_lvl || 0) < CONVOY.RIG_UPGRADE_MAX ? rigUpgradeCost(cfg, Number(rigRow.armor_lvl || 0)) : null,
      nextEngineCost: Number(rigRow.engine_lvl || 0) < CONVOY.RIG_UPGRADE_MAX ? rigUpgradeCost(cfg, Number(rigRow.engine_lvl || 0)) : null };
  }
  const [roadBoss, teamsterOfWeek] = await Promise.all([topWeek(pool, 'hijack'), topWeek(pool, 'deliver')]);
  const delivered = Number(acct.freight_delivered || 0), hijacked = Number(acct.freight_hijacked || 0);
  // TIER C — the hauler's reputation + this shipment's LANE heat (so the player can see a lane going hot
  // and rotate). The heat sheds guard def on THIS lane; reputation manages it (cools/quiets) + halves the toll.
  const rep = smuggleRepPerks(haulerTierOf(delivered));
  if (my && mine) {
    const heat = await laneHeat(pool, characterId, convoyLaneKey(mine.origin, mine.destination), rep.decayMult);
    my.notoriety = Math.round(heat);
    my.guardCut = Math.round(Math.min(NOTORIETY.CONVOY_DEF_CAP, heat * NOTORIETY.CONVOY_DEF_PER));
  }
  return { guardTiers: CONVOY.GUARD_TIERS, minQty: CONVOY.MIN_QTY,
    maxAmbushes: CONVOY.MAX_AMBUSHES, tollBps: CONVOY.TOLL_BPS,
    insureBps: CONVOY.INSURE_BPS, insurePayoutBps: CONVOY.INSURE_PAYOUT_BPS,
    inTransit, mine: my,
    legend: { delivered, hauler: haulerRankOf(delivered).title, hijacked, bandit: banditRankOf(hijacked).title },
    reputation: { tier: rep.tier, coolsFaster: rep.decayMult > 1, tollBreak: rep.tollMult < 1, quieter: rep.gainMult < 1,
      perks: [{ tier: NOTORIETY.REP_DECAY_TIER, perk: 'your lanes cool 2× faster' }, { tier: NOTORIETY.REP_TOLL_TIER, perk: 'destination toll halved' }, { tier: NOTORIETY.REP_GAIN_TIER, perk: 'your lanes heat half as fast' }] },
    notoriety: { gain: NOTORIETY.GAIN, max: NOTORIETY.MAX, decayPerHr: NOTORIETY.DECAY_PER_HR, defPer: NOTORIETY.CONVOY_DEF_PER, defCap: NOTORIETY.CONVOY_DEF_CAP },
    rig, rigs: CONVOY.RIGS.map((r) => ({ id: r.id, name: r.name, cost: r.cost, minLvl: r.minLvl, armor: r.armor })),
    roadBoss, teamsterOfWeek };
}

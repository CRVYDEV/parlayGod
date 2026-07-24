// THE PORT — maritime smuggling (omerta-the-port-design.md). Boats are an ownable vessel class (bought
// like cars): a HOLD (cargo scale) + SPEED (Coast Guard evasion). A RUN sources contraband from an offshore
// supplier (a cash SINK), sails a real clock, and on a clean arrival lands it for the smuggling margin (a
// cash FAUCET). The COAST GUARD (a lazy interdiction roll at collect) SEIZES the cargo + FINES + may SINK
// the boat. All CASH. The lone PvE faucet (port:sale) is bounded by the run clock, interdiction, and a
// daily SUPPLY CAP (the D3 wash-cap token bucket). Boats die with the street (the runEstate wipe).
// STEP TWO: NAVAL UPGRADES (hull/engine — the car-tune twin), PIRACY (the convoy-ambush twin at sea —
// a WIN redirects the run's would-be landing to the pirate at a CUT, so port emission can only FALL), and
// the offshore RENDEZVOUS (a consensual mid-sea handoff of an active run to a partner's boat — §10.4-neutral).
import crypto from 'node:crypto';
import { GameError, bus } from './game.js';
import { PORT, COMMISSION, boatOf, portRouteOf, boatResale, interdictChance, effHold, effSpeed, boatUpgradeCost, portRankOf, fenceMultOf, levelOf, cityHourOf } from './rules.js';
import { logCollect } from './collection.js';
import { activeDecree } from './commission.js';

// THE SMUGGLER'S LEGEND — lifetime contraband value landed, account-level (survives death — the boxing/
// wheel/war-effort precedent). Direct SQL on the account (NUMERIC, arith-safe); status only, no §10.4.
const bumpSmuggled = (client, accountId, amt) =>
  client.query('UPDATE account_persistent SET smuggled = smuggled + $2 WHERE account_id=$1', [accountId, Math.max(0, Math.floor(Number(amt) || 0))]);
const fleetCapOf = (ch) => PORT.FLEET_MAX + (Number(ch.berths) || 0);   // step four: rented berths raise the cap

// THE HARBORMASTER: the family holding the docks tolls a clean landing (a §10.4 TRANSFER to their treasury).
// Returns the toll charged (0 when NPC-held / your own family / dissolution race); mutates ch.cash/ch.bank.
// Shared by the immediate collect-fence AND the warehouse fence (cash realized at the docks either way).
async function harborToll(client, h, ch, sale) {
  const holder = (await client.query('SELECT holder_gang FROM districts WHERE id=$1', [PORT.DISTRICT])).rows[0]?.holder_gang;
  if (!holder || holder === h.owned.gangId || sale <= 0) return 0;
  const toll = Math.min(Math.floor(sale * PORT.STEP3.TOLL_BPS / 10000), Math.max(0, Math.floor(Number(ch.cash) + Number(ch.bank))));
  if (toll <= 0) return 0;
  const upd = await client.query('UPDATE gangs SET treasury = treasury + $2 WHERE id=$1', [holder, toll]);
  if (!upd.rowCount) return 0;   // holder dissolved between the read and the credit — no charge, no orphan
  const fromPocket = Math.min(toll, Math.max(0, Math.floor(Number(ch.cash))));
  ch.cash = Number(ch.cash) - fromPocket;
  ch.bank = Number(ch.bank) - (toll - fromPocket);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -toll, reason: 'port:toll' });
  return toll;
}

const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const hospitalized = (ch) => ch.hosp_until && new Date(ch.hosp_until) > new Date();
const safeHoused = (ch) => ch.safe_until && new Date(ch.safe_until) > new Date();
const runMsOf = (route) => (process.env.PORT_RUN_MS != null ? Number(process.env.PORT_RUN_MS) : route.ms); // TEST-ONLY knob (CONVOY_MS precedent)
const atSea = (boat) => !!boat.run_until;                              // a run in progress OR an uncollected arrival
const outAtSea = (boat) => boat.run_until && new Date(boat.run_until) > new Date(); // genuinely sailing — piratable
const rand = (n) => Math.floor(Math.random() * n);
const clearIntercepts = (client, boatId) => client.query('DELETE FROM port_intercepts WHERE boat_id=$1', [boatId]);

// the continuous 24h supply bucket (the wash-cap pattern): how much contraband COST is still sourceable
function supplyState(ch) {
  const now = Date.now();
  const refill = ch.port_at ? (now - new Date(ch.port_at).getTime()) / 86400000 * PORT.SUPPLY_CAP_DAY : PORT.SUPPLY_CAP_DAY;
  const used = Math.max(0, Number(ch.port_used || 0) - Math.max(0, refill));
  return { used, left: Math.max(0, Math.floor(PORT.SUPPLY_CAP_DAY - used)) };
}

// POST /v1/port/boat/:kind — buy a boat at the Docks (a cash sink)
export async function buyBoat(ch, kind, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No dealing from lockup.');
  if (ch.loc !== PORT.DISTRICT) throw new GameError('district', `The boatyard is at the ${PORT.DISTRICT} — travel there.`);
  if (levelOf(Number(ch.respect)) < PORT.MIN_LEVEL) throw new GameError('level', `The harbormaster deals with level ${PORT.MIN_LEVEL}+.`);
  const spec = boatOf(kind);
  if (!spec) throw new GameError('bad_boat', 'No such vessel at the yard.');
  const n = Number((await client.query('SELECT COUNT(*) c FROM boats WHERE character_id=$1', [ch.id])).rows[0].c);
  if (n >= fleetCapOf(ch)) throw new GameError('fleet', `Your berths are full (${fleetCapOf(ch)}). Sell a boat or rent a slip.`);
  if (Number(ch.cash) < spec.cost) throw new GameError('cash', `The ${spec.name} runs $${spec.cost}.`);
  ch.cash = Number(ch.cash) - spec.cost;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -spec.cost, reason: 'port:boat' });
  const id = crypto.randomUUID();
  await client.query('INSERT INTO boats (id, character_id, kind) VALUES ($1,$2,$3)', [id, ch.id, kind]);
  await h.track(client, ch.account_id, 'port', { act: 'buy', kind });
  await logCollect(client, ch.account_id, 'boats', kind); // THE COLLECTION
  return { ok: true, boat: { id, kind, name: spec.name, hold: spec.hold, speed: spec.speed }, spent: spec.cost };
}

// POST /v1/port/boat/:boatId/sell — sell a docked boat back to the yard (a fraction of cost)
export async function sellBoat(ch, boatId, client, h) {
  const boat = (await client.query('SELECT * FROM boats WHERE id=$1 AND character_id=$2 FOR UPDATE', [boatId, ch.id])).rows[0];
  if (!boat) throw new GameError('no_boat', 'No such boat in your fleet.');
  if (atSea(boat)) throw new GameError('at_sea', "She's out on a run — bring her in first.");
  const back = boatResale(boat.kind);
  ch.cash = Number(ch.cash) + back;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: back, reason: 'port:sell' });
  await clearIntercepts(client, boatId);
  await client.query('DELETE FROM boats WHERE id=$1', [boatId]);
  await h.track(client, ch.account_id, 'port', { act: 'sell', kind: boat.kind });
  return { ok: true, refund: back };
}

// POST /v1/port/upgrade/:boatId {part} — NAVAL UPGRADE: buy a hull (+cargo) or engine (+knots) level (cash sink)
export async function upgradeBoat(ch, boatId, part, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No work on the boat from lockup.');
  if (ch.loc !== PORT.DISTRICT) throw new GameError('district', `The dry dock is at the ${PORT.DISTRICT}.`);
  if (part !== 'hull' && part !== 'engine') throw new GameError('bad_part', 'Upgrade the hull or the engine.');
  const boat = (await client.query('SELECT * FROM boats WHERE id=$1 AND character_id=$2 FOR UPDATE', [boatId, ch.id])).rows[0];
  if (!boat) throw new GameError('no_boat', 'No such boat in your fleet.');
  if (atSea(boat)) throw new GameError('at_sea', "She's out — refit her when she's docked.");
  const lvl = Number(part === 'hull' ? boat.hull : boat.engine) || 0;
  if (lvl >= PORT.STEP2.UPGRADE_MAX) throw new GameError('maxed', `The ${part} is already at the max (${PORT.STEP2.UPGRADE_MAX}).`);
  const spec = boatOf(boat.kind);
  const cost = boatUpgradeCost(boat, spec, part);
  if (Number(ch.cash) < cost) throw new GameError('cash', `That refit runs $${cost}.`);
  ch.cash = Number(ch.cash) - cost;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'port:upgrade' });
  await client.query(`UPDATE boats SET ${part === 'hull' ? 'hull' : 'engine'}=$2 WHERE id=$1`, [boatId, lvl + 1]);
  await h.track(client, ch.account_id, 'port', { act: 'upgrade', part, level: lvl + 1 });
  const nb = { ...boat, [part]: lvl + 1 };
  return { ok: true, part, level: lvl + 1, spent: cost, hold: effHold(nb, spec), speed: effSpeed(nb, spec) };
}

// POST /v1/port/run/:boatId {route, escort} — load contraband + put to sea (a cash sink; gated by the supply cap)
export async function launchRun(ch, boatId, routeId, escort, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No runs from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp', "You're in no shape to captain a run.");
  if (safeHoused(ch)) throw new GameError('safe', "You can't run contraband from a safehouse."); // P1.3 — an op
  if (ch.loc !== PORT.DISTRICT) throw new GameError('district', `Load a run at the ${PORT.DISTRICT}.`);
  const boat = (await client.query('SELECT * FROM boats WHERE id=$1 AND character_id=$2 FOR UPDATE', [boatId, ch.id])).rows[0];
  if (!boat) throw new GameError('no_boat', 'No such boat in your fleet.');
  if (atSea(boat)) throw new GameError('busy', "She's already out — she can only run one at a time.");
  const route = portRouteOf(routeId);
  if (!route) throw new GameError('bad_route', 'No such route on the charts.');
  if (levelOf(Number(ch.respect)) < route.minLvl) throw new GameError('route_level', `${route.name} runs at level ${route.minLvl}.`);
  const spec = boatOf(boat.kind);
  const hold = effHold(boat, spec), speed = effSpeed(boat, spec);
  if (speed < route.minSpeed) throw new GameError('too_slow', `The ${route.name} needs a boat that makes ${route.minSpeed}+ knots.`);
  const cost = hold * route.buy;
  const escortCost = escort ? PORT.ESCORT_COST : 0;
  const { used, left } = supplyState(ch);
  if (used + cost > PORT.SUPPLY_CAP_DAY) throw new GameError('supply', `The supplier can only move $${left} more contraband today — sail a smaller boat or wait.`);
  if (Number(ch.cash) < cost + escortCost) throw new GameError('cash', `The cargo + escort runs $${cost + escortCost}.`);
  ch.cash = Number(ch.cash) - cost - escortCost;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'port:buy' });
  if (escortCost) await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -escortCost, reason: 'port:escort' });
  ch.heat = Math.min(100, Number(ch.heat || 0) + PORT.RUN_HEAT);
  const now = Date.now();
  const until = new Date(now + runMsOf(route));
  await client.query('UPDATE boats SET run_until=$2, run_route=$3, run_hold=$4, run_cost=$5, run_escort=$6 WHERE id=$1',
    [boat.id, until, route.id, hold, cost, !!escort]);
  await clearIntercepts(client, boat.id);   // a fresh run — a new gauntlet for pirates
  // the supply token bucket — DIRECT SQL (outside persist, the wash/active_at pattern)
  await client.query('UPDATE characters SET port_used=$2, port_at=$3 WHERE id=$1', [ch.id, used + cost, new Date(now)]);
  await h.track(client, ch.account_id, 'port', { act: 'launch', route: route.id, hold });
  return { ok: true, boat: boat.id, route: route.id, hold, cost, escort: !!escort, arrivesSeconds: Math.ceil(runMsOf(route) / 1000) };
}

// POST /v1/port/collect/:boatId {warehouse} — the boat's home: roll the Coast Guard, then land the cargo
// or eat the bust. Step four: on a clean landing, WAREHOUSE the contraband (hold it as a commodity to fence
// later at a drifting price) instead of fencing it to cash now — a market-timing play (the default fences now).
export async function collectRun(ch, boatId, warehouse, client, h) {
  // (red-team R18) parity with launchRun / every other port verb — a captain in lockup or the hospital
  // can't be on the dock working a landing (collecting is a physical dockside act, like launching).
  if (jailed(ch)) throw new GameError('jailed', 'No collecting a run from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp', "You're in no shape to work the dock.");
  if (safeHoused(ch)) throw new GameError('safe', 'The take waits for a captain on the dock, not a ghost.'); // D2 collect
  if (ch.loc !== PORT.DISTRICT) throw new GameError('district', `Collect at the ${PORT.DISTRICT}.`);
  const boat = (await client.query('SELECT * FROM boats WHERE id=$1 AND character_id=$2 FOR UPDATE', [boatId, ch.id])).rows[0];
  if (!boat) throw new GameError('no_boat', 'No such boat in your fleet.');
  if (!atSea(boat)) throw new GameError('not_out', "She's docked — nothing to collect.");
  if (new Date(boat.run_until) > new Date()) throw new GameError('at_sea', 'Still out on the water — check the ETA.');
  const route = portRouteOf(boat.run_route), spec = boatOf(boat.kind);
  const patrolMod = cityHourOf(Date.now()).patrol ? 15 : -10; // the Coast Guard works patrol hours; the small hours are safer
  let p = process.env.PORT_INTERDICT_P != null ? Number(process.env.PORT_INTERDICT_P)
    : interdictChance(route, { speed: effSpeed(boat, spec) }, boat.run_escort, patrolMod);
  // SMUGGLER'S MOON (Commission decree): the Coast Guard looks the other way — interdiction ×PORT_INTERDICT_MULT
  // this week (one touchpoint; the test-pinned p is left alone so the roll knob stays deterministic).
  if (process.env.PORT_INTERDICT_P == null && (await activeDecree(client))?.id === 'smugglers_moon')
    p *= COMMISSION.PORT_INTERDICT_MULT;
  const roll = Math.random();
  await h.rngLog(client, ch.id, `port:${route.id}`, roll, roll < p ? 'interdicted' : 'clean');
  const clearRun = async () => {
    await client.query('UPDATE boats SET run_until=NULL, run_route=NULL, run_hold=0, run_cost=0, run_escort=false WHERE id=$1', [boat.id]);
    await clearIntercepts(client, boat.id);
  };
  if (roll >= p) {
    // CLEAN — the contraband slips the Coast Guard. Its BOOK VALUE = hold × the route's fence rate.
    const sale = Number(boat.run_hold) * route.sell;
    if (warehouse) {
      // WAREHOUSE (step four): hold the contraband as a commodity — no cash / toll / legend yet (those fire
      // at fence). A market-timing play: fence later when the drifting price is high (or eat it if whacked).
      await client.query('UPDATE characters SET contraband = contraband + $2 WHERE id=$1', [ch.id, sale]);
      await clearRun();
      await h.track(client, ch.account_id, 'port', { act: 'warehouse', route: route.id, value: sale });
      return { ok: true, interdicted: false, warehoused: sale, cost: Number(boat.run_cost), route: route.id };
    }
    // FENCE NOW (the default) — land it straight to cash at the route rate (a bounded faucet)
    ch.cash = Number(ch.cash) + sale;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: sale, reason: 'port:sale' });
    await bumpSmuggled(client, ch.account_id, sale);   // THE SMUGGLER'S LEGEND (status, survives death)
    const toll = await harborToll(client, h, ch, sale); // THE HARBORMASTER (step three): docks-holder toll
    await clearRun();
    if (sale >= 250000) bus.emit('streets', { type: 'port_landing', by: ch.name, route: route.name, value: sale });
    await h.track(client, ch.account_id, 'port', { act: 'land', route: route.id, sale, toll });
    return { ok: true, interdicted: false, landed: sale, cost: Number(boat.run_cost), net: sale - Number(boat.run_cost) - toll, toll, route: route.id };
  }
  // INTERDICTED — cargo seized, a fine (pocket then bank, the raid-fine precedent), heat, and maybe the boat sinks
  const fine = Math.min(Math.floor(Number(boat.run_cost) * PORT.FINE_RATE), Math.max(0, Math.floor(Number(ch.cash) + Number(ch.bank))));
  const fromPocket = Math.min(fine, Math.max(0, Math.floor(Number(ch.cash))));
  ch.cash = Number(ch.cash) - fromPocket;
  ch.bank = Number(ch.bank) - (fine - fromPocket);
  if (fine > 0) await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -fine, reason: 'port:fine' });
  ch.heat = Math.min(100, Number(ch.heat || 0) + PORT.BUST_HEAT);
  // step five — the Coast Guard bust builds a FEDERAL case: it feeds the RICO investigation meter
  // (heat_exposure), not just the volatile heat number, so repeat smuggling draws the Bureau. Persisted
  // positionally by persistCharacter (like the heat bump above) — no direct SQL needed.
  ch.heat_exposure = Number(ch.heat_exposure || 0) + PORT.STEP5.BUST_EXPOSURE;
  // a flat SINK_P sub-roll on a bust impounds/sinks the boat (PORT_SINK pins it for tests, the roll-knob precedent)
  const boatLost = process.env.PORT_SINK != null ? process.env.PORT_SINK === '1' : Math.random() < PORT.SINK_P;
  await clearIntercepts(client, boat.id);
  if (boatLost) await client.query('DELETE FROM boats WHERE id=$1', [boat.id]);
  else await client.query('UPDATE boats SET run_until=NULL, run_route=NULL, run_hold=0, run_cost=0, run_escort=false WHERE id=$1', [boat.id]);
  await h.notify(client, ch.id, 'port_bust', { route: route.id, fine, sunk: boatLost });
  await h.track(client, ch.account_id, 'port', { act: 'bust', route: route.id, fine, sunk: boatLost });
  return { ok: true, interdicted: true, seized: Number(boat.run_hold), fine, sunk: boatLost, route: route.id };
}

// POST /v1/port/fence — sell ALL warehoused contraband at today's drifting fence rate (a bounded cash faucet).
// The market-timing payoff: fence when fenceMultOf is high to beat the route rate; a bad day (or a whacking)
// is the risk. The harbormaster toll + the legend bump fire here (the cash is realized at the docks now).
export async function fenceContraband(ch, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No fencing from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp', "You're in no shape to meet the fence."); // (red-team R18) parity
  if (safeHoused(ch)) throw new GameError('safe', 'The fence deals face to face, not with a ghost.'); // D2 extraction-ish
  if (ch.loc !== PORT.DISTRICT) throw new GameError('district', `The fence works out of the ${PORT.DISTRICT}.`);
  const book = Number((await client.query('SELECT contraband FROM characters WHERE id=$1', [ch.id])).rows[0]?.contraband || 0);
  if (book <= 0) throw new GameError('nothing', "You've got no contraband warehoused.");
  const mult = fenceMultOf();
  const proceeds = Math.floor(book * mult);
  ch.cash = Number(ch.cash) + proceeds;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: proceeds, reason: 'port:fence' });
  await bumpSmuggled(client, ch.account_id, proceeds);
  const toll = await harborToll(client, h, ch, proceeds);
  await client.query('UPDATE characters SET contraband = 0 WHERE id=$1', [ch.id]);
  if (proceeds >= 250000) bus.emit('streets', { type: 'port_fence', by: ch.name, value: proceeds });
  await h.track(client, ch.account_id, 'port', { act: 'fence', book, proceeds, mult: Math.round(mult * 100) / 100 });
  return { ok: true, book, proceeds, rate: Math.round(mult * 100) / 100, toll, net: proceeds - toll };
}

// POST /v1/port/berth — rent a permanent harbor slip (+1 fleet cap), a one-time cash sink, capped
export async function rentBerth(ch, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No paperwork from lockup.');
  if (ch.loc !== PORT.DISTRICT) throw new GameError('district', `The harbormaster's office is at the ${PORT.DISTRICT}.`);
  const berths = Number(ch.berths) || 0;
  if (berths >= PORT.STEP4.BERTH_MAX) throw new GameError('maxed', `You already lease the max (${PORT.STEP4.BERTH_MAX}) slips.`);
  if (Number(ch.cash) < PORT.STEP4.BERTH_COST) throw new GameError('cash', `A slip runs $${PORT.STEP4.BERTH_COST}.`);
  ch.cash = Number(ch.cash) - PORT.STEP4.BERTH_COST;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -PORT.STEP4.BERTH_COST, reason: 'port:berth' });
  // (red-team R18) absolute INT write — `berths = berths + 1` is the pg-mem arithmetic-UPDATE quirk (mis-evaluates
  // to 0−n on a second rent); NUMERIC cols are arith-safe but berths is INT, so compute the new value in JS.
  await client.query('UPDATE characters SET berths = $2 WHERE id=$1', [ch.id, berths + 1]);
  await h.track(client, ch.account_id, 'port', { act: 'berth', berths: berths + 1 });
  return { ok: true, berths: berths + 1, fleetMax: PORT.FLEET_MAX + berths + 1, spent: PORT.STEP4.BERTH_COST };
}

// POST /v1/port/intercept/:boatId — PIRACY: a pirate with their own fast boat + guns runs down a rival's run
// at sea. A WIN seizes the cargo and lands a CUT of its value (the rest scatters) — a §10.4-safe REDIRECT of
// the existing port:sale faucet (the pirate's take < the runner's would-be landing, so total emission can only
// FALL). The runner's run is voided (their cargo is gone). A LOSS: the escort/guns hospitalize the pirate.
export async function interceptRun(ch, targetBoatId, client, h) {
  const S = PORT.STEP2;
  if (jailed(ch)) throw new GameError('jailed', 'No piracy from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp', 'Not in your condition.');
  if (safeHoused(ch)) throw new GameError('safe', 'No raids while you hide — a safehouse is a shield, not a corsair.'); // P1.3
  if (ch.loc !== PORT.DISTRICT) throw new GameError('district', `Put to sea from the ${PORT.DISTRICT}.`);
  if (levelOf(Number(ch.respect)) < S.PIRATE_MIN_LEVEL) throw new GameError('level', `Piracy is level ${S.PIRATE_MIN_LEVEL}+ work.`);
  if (Number(ch.energy) < S.PIRATE_ENERGY) throw new GameError('energy', `Running one down takes ${S.PIRATE_ENERGY} energy.`);
  if ((Number(ch.ammo) || 0) < S.PIRATE_AMMO) throw new GameError('ammo', `Boarding takes ${S.PIRATE_AMMO} rounds.`);
  // the pirate needs their OWN fast boat, docked, to give chase — their fastest is the pursuit vessel
  const mine = (await client.query('SELECT * FROM boats WHERE character_id=$1', [ch.id])).rows;
  const docked = mine.filter((b) => !atSea(b));
  if (!docked.length) throw new GameError('no_boat', 'You need a boat at the dock to give chase.');
  const pursuit = Math.max(...docked.map((b) => effSpeed(b, boatOf(b.kind))));
  const boat = (await client.query('SELECT * FROM boats WHERE id=$1 FOR UPDATE', [targetBoatId])).rows[0];
  if (!boat) throw new GameError('no_target', 'No such boat out there.');
  if (boat.character_id === ch.id) throw new GameError('own', "That's your own boat.");
  if (!outAtSea(boat)) throw new GameError('landed', 'She already made the dock — nothing to take.');
  // family omertà: you don't pirate your own family's freight
  const rg = (await client.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [boat.character_id])).rows[0];
  if (rg && h.owned.gangId && rg.gang_id === h.owned.gangId) throw new GameError('family', "That's a made man's boat. Omertà.");
  // one interception per pirate per live run — catch ONLY the known unique violation as a terminal 'once'
  // (the casino.js:256 pattern); a transient 40P01/40001 must rethrow so the wrapper's deadlockToRetry retries.
  try { await client.query('INSERT INTO port_intercepts (boat_id, character_id) VALUES ($1,$2)', [targetBoatId, ch.id]); }
  catch (e) { if (e?.code === '23505') throw new GameError('once', 'You already made your run at her.'); throw e; }

  ch.energy = Number(ch.energy) - S.PIRATE_ENERGY;
  ch.ammo = Number(ch.ammo) - S.PIRATE_AMMO;
  ch.heat = Math.min(100, Number(ch.heat || 0) + S.PIRATE_HEAT);
  await h.ledger(client, { characterId: ch.id, currency: 'ammo', amount: -S.PIRATE_AMMO, reason: 'port:piracy' });

  const route = portRouteOf(boat.run_route), spec = boatOf(boat.kind);
  const atk = Number(ch.muscle) + Number(ch.speed) * 0.5 + pursuit * 0.4 + rand(30);
  const def = effSpeed(boat, spec) * 0.6 + (boat.run_escort ? S.ESCORT_VS_PIRATE : 0) + rand(30);
  const win = process.env.PORT_PIRATE_WIN != null ? process.env.PORT_PIRATE_WIN === '1' : atk > def; // TEST-ONLY roll knob
  await h.rngLog(client, ch.id, `port:piracy:${targetBoatId}`, Math.round(atk * 100) / 100,
    `${win ? 'boarded' : 'outrun'} (def ${Math.round(def * 100) / 100}${boat.run_escort ? ', escorted' : ''})`);

  if (win) {
    // seize the cargo: land a CUT of what it would have fenced for; the run is voided (< 100% → emission falls)
    const full = Number(boat.run_hold) * (route?.sell || 0);
    const take = Math.floor(full * S.PIRATE_TAKE_BPS / 10000);
    ch.cash = Number(ch.cash) + take;
    if (take > 0) { await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: take, reason: 'port:piracy' }); await bumpSmuggled(client, ch.account_id, take); }
    await client.query('UPDATE boats SET run_until=NULL, run_route=NULL, run_hold=0, run_cost=0, run_escort=false WHERE id=$1', [targetBoatId]);
    await clearIntercepts(client, targetBoatId);
    await h.notify(client, boat.character_id, 'port_pirated', { route: boat.run_route, taken: take });
    if (take >= 250000) bus.emit('streets', { type: 'port_piracy', by: ch.name, route: route?.name });
    await h.track(client, ch.account_id, 'port', { act: 'piracy', win: true, take });
    return { ok: true, win: true, take, route: boat.run_route };
  }
  // outrun — the run's escort/guns put the pirate in the water
  ch.health = Math.max(1, Number(ch.health) - (20 + rand(20)));
  ch.hosp_until = new Date(Date.now() + S.FAIL_HOSP_MS);
  await h.notify(client, boat.character_id, 'port_defended', { route: boat.run_route });
  await h.track(client, ch.account_id, 'port', { act: 'piracy', win: false });
  return { ok: true, win: false, hospSeconds: Math.ceil(S.FAIL_HOSP_MS / 1000) };
}

// POST /v1/port/boat/:boatId/rendezvous {open} — CONSENT: flag a DOCKED boat as open to receive a mid-sea handoff
export async function setRendezvous(ch, boatId, open, client, h) {
  const boat = (await client.query('SELECT * FROM boats WHERE id=$1 AND character_id=$2 FOR UPDATE', [boatId, ch.id])).rows[0];
  if (!boat) throw new GameError('no_boat', 'No such boat in your fleet.');
  if (atSea(boat)) throw new GameError('at_sea', 'She has to be docked to take a handoff.');
  await client.query('UPDATE boats SET rendezvous=$2 WHERE id=$1', [boatId, !!open]);
  return { ok: true, rendezvous: !!open };
}

// POST /v1/port/rendezvous/:boatId {to} — offshore RENDEZVOUS: hand your active run to a partner's docked,
// rendezvous-open boat (consent-by-listing). §10.4-neutral — the run just changes vessels; port:sale fires
// for whoever finally collects. Use it to hand a hot cargo to a fast/clean captain, or to shake a pirate.
export async function rendezvous(ch, myBoatId, partnerBoatId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No radio from lockup.');
  if (String(myBoatId) === String(partnerBoatId)) throw new GameError('same', 'Pick another boat to take the load.');
  // lock BOTH boat rows in a stable (sorted) order — deadlock-safe vs a concurrent rendezvous / piracy
  const [a, b] = [String(myBoatId), String(partnerBoatId)].sort();
  const rows = (await client.query('SELECT * FROM boats WHERE id IN ($1,$2) FOR UPDATE', [a, b])).rows;
  const mine = rows.find((r) => r.id === String(myBoatId));
  const partner = rows.find((r) => r.id === String(partnerBoatId));
  if (!mine || mine.character_id !== ch.id) throw new GameError('no_boat', 'No such boat in your fleet.');
  if (!atSea(mine)) throw new GameError('not_out', "That boat isn't carrying a run.");
  if (!partner) throw new GameError('no_partner', 'No such boat to hand off to.');
  if (partner.character_id === ch.id) throw new GameError('own', 'Hand off to a partner, not yourself.');
  if (!partner.rendezvous) throw new GameError('closed', "That captain isn't waiting for a handoff.");
  if (atSea(partner)) throw new GameError('partner_busy', 'The receiving boat is already out.');
  const route = portRouteOf(mine.run_route), spec = boatOf(partner.kind);
  if (effSpeed(partner, spec) < (route?.minSpeed || 0)) throw new GameError('partner_slow', `Their boat can't make the ${route?.name} (needs ${route?.minSpeed}+ knots).`);
  // move the run mine → partner; free mine; consume the partner's rendezvous flag; reset both intercept slates
  await client.query('UPDATE boats SET run_until=$2, run_route=$3, run_hold=$4, run_cost=$5, run_escort=$6, rendezvous=false WHERE id=$1',
    [partner.id, mine.run_until, mine.run_route, mine.run_hold, mine.run_cost, mine.run_escort]);
  await client.query('UPDATE boats SET run_until=NULL, run_route=NULL, run_hold=0, run_cost=0, run_escort=false WHERE id=$1', [mine.id]);
  await clearIntercepts(client, mine.id);
  await clearIntercepts(client, partner.id);
  await h.notify(client, partner.character_id, 'port_handoff', { route: mine.run_route, hold: Number(mine.run_hold) });
  await h.track(client, ch.account_id, 'port', { act: 'rendezvous', route: mine.run_route });
  return { ok: true, to: partner.id, route: mine.run_route, hold: Number(mine.run_hold) };
}

// a public run's VALUE BAND for the piracy board (never the manifest — the convoy-board rule)
const valueBand = (v) => v >= 1000000 ? 'a fortune' : v >= 300000 ? 'a heavy load' : v >= 75000 ? 'a fair haul' : 'small-time';

// GET /v1/port — the harbor: the boat catalog, your fleet (docked / at sea + ETA + odds + upgrades), routes,
// supply left, and THE SEAS — rival runs out there right now that a pirate can run down (route + value band).
export async function portBoard(ch, client, h) {
  const now = Date.now();
  const rows = (await client.query('SELECT * FROM boats WHERE character_id=$1 ORDER BY created_at', [ch.id])).rows;
  const patrolMod = cityHourOf(now).patrol ? 15 : -10;
  const fleet = rows.map((b) => {
    const spec = boatOf(b.kind);
    const out = atSea(b);
    const arrived = out && new Date(b.run_until).getTime() <= now;
    return {
      id: b.id, kind: b.kind, name: spec?.name, hold: effHold(b, spec), speed: effSpeed(b, spec),
      baseHold: spec?.hold, baseSpeed: spec?.speed, hull: Number(b.hull) || 0, engine: Number(b.engine) || 0,
      rendezvous: !!b.rendezvous,
      hullCost: (Number(b.hull) || 0) < PORT.STEP2.UPGRADE_MAX ? boatUpgradeCost(b, spec, 'hull') : null,
      engineCost: (Number(b.engine) || 0) < PORT.STEP2.UPGRADE_MAX ? boatUpgradeCost(b, spec, 'engine') : null,
      status: !out ? 'docked' : arrived ? 'arrived' : 'at_sea',
      route: b.run_route || null,
      etaSeconds: out && !arrived ? Math.ceil((new Date(b.run_until).getTime() - now) / 1000) : 0,
    };
  });
  const routes = PORT.ROUTES.map((r) => ({
    id: r.id, name: r.name, minLvl: r.minLvl, minSpeed: r.minSpeed, buy: r.buy, sell: r.sell, margin: r.sell - r.buy,
    patrol: r.patrol,
    interdictPct: Math.round(interdictChance(r, { speed: Math.max(0, ...rows.filter((b) => !atSea(b)).map((b) => effSpeed(b, boatOf(b.kind)))) }, false, patrolMod) * 100),
  }));
  // THE SEAS — other players' runs genuinely at sea right now (piracy targets); route + value band, never the manifest
  const canPirate = levelOf(Number(ch.respect)) >= PORT.STEP2.PIRATE_MIN_LEVEL;
  const seaRows = canPirate ? (await client.query(
    `SELECT b.id, b.run_route, b.run_hold, b.run_until, c.name AS runner
       FROM boats b JOIN characters c ON c.id = b.character_id
      WHERE b.character_id <> $1 AND b.run_until > now() AND c.alive
      ORDER BY b.run_until LIMIT 30`, [ch.id])).rows : [];
  const seas = seaRows.map((s) => {
    const r = portRouteOf(s.run_route);
    return { boatId: s.id, runner: s.runner, route: s.run_route, routeName: r?.name,
      band: valueBand(Number(s.run_hold) * (r?.sell || 0)), etaSeconds: Math.ceil((new Date(s.run_until).getTime() - now) / 1000) };
  });
  // THE SMUGGLER'S LEGEND (step three) + THE HARBORMASTER: who holds the docks (a toll on a clean landing)
  const smuggled = Number((await client.query('SELECT smuggled FROM account_persistent WHERE account_id=$1', [ch.account_id])).rows[0]?.smuggled || 0);
  const holderRow = (await client.query(
    `SELECT g.name, g.tag, d.holder_gang FROM districts d LEFT JOIN gangs g ON g.id = d.holder_gang WHERE d.id=$1`, [PORT.DISTRICT])).rows[0];
  const tolled = holderRow?.holder_gang && holderRow.holder_gang !== h.owned.gangId;
  // step four: the warehouse (book value held) + today's drifting fence rate, and the berth office
  const book = Number(ch.contraband || 0), rate = fenceMultOf();
  return {
    atDocks: ch.loc === PORT.DISTRICT, district: PORT.DISTRICT,
    catalog: PORT.BOATS.map((b) => ({ id: b.id, name: b.name, cost: b.cost, hold: b.hold, speed: b.speed, resale: boatResale(b.id) })),
    fleet, fleetMax: fleetCapOf(ch), routes, escort: { cost: PORT.ESCORT_COST, def: PORT.ESCORT_DEF },
    contraband: { book, fenceRate: Math.round(rate * 100) / 100, estimate: Math.floor(book * rate) },
    berth: { count: Number(ch.berths) || 0, max: PORT.STEP4.BERTH_MAX, cost: PORT.STEP4.BERTH_COST },
    supplyLeft: supplyState(ch).left, supplyCap: PORT.SUPPLY_CAP_DAY,
    seas, piracy: { minLevel: PORT.STEP2.PIRATE_MIN_LEVEL, energy: PORT.STEP2.PIRATE_ENERGY, ammo: PORT.STEP2.PIRATE_AMMO, takeBps: PORT.STEP2.PIRATE_TAKE_BPS },
    upgrade: { max: PORT.STEP2.UPGRADE_MAX, hullStep: PORT.STEP2.HULL_STEP, engineStep: PORT.STEP2.ENGINE_STEP },
    legend: { smuggled, rank: portRankOf(smuggled).title },
    harbormaster: { holder: holderRow?.holder_gang ? { name: holderRow.name, tag: holderRow.tag } : null, tollBps: PORT.STEP3.TOLL_BPS, tolled: !!tolled },
  };
}

// GET /v1/leaderboard/port — THE SMUGGLER'S LEGEND (biggest lifetime landed value; agents excluded)
export async function portLeaderboard(pool) {
  const rows = (await pool.query(
    `SELECT a.smuggled, c.name FROM account_persistent a JOIN characters c ON c.account_id=a.account_id AND c.alive
      WHERE a.smuggled > 0 AND NOT a.agent_flag ORDER BY a.smuggled DESC LIMIT 15`)).rows;
  return { smugglers: rows.map((r) => ({ name: r.name, smuggled: Number(r.smuggled), rank: portRankOf(r.smuggled).title })) };
}

// THE PORT — maritime smuggling (omerta-the-port-design.md). Boats are an ownable vessel class (bought
// like cars): a HOLD (cargo scale) + SPEED (Coast Guard evasion). A RUN sources contraband from an offshore
// supplier (a cash SINK), sails a real clock, and on a clean arrival lands it for the smuggling margin (a
// cash FAUCET). The COAST GUARD (a lazy interdiction roll at collect) SEIZES the cargo + FINES + may SINK
// the boat. All CASH. The lone faucet (port:sale) is bounded by the per-boat run clock, interdiction, and a
// daily SUPPLY CAP (the D3 wash-cap token bucket). Boats die with the street (the runEstate wipe).
import crypto from 'node:crypto';
import { GameError, bus } from './game.js';
import { PORT, boatOf, portRouteOf, boatResale, interdictChance, levelOf, cityHourOf } from './rules.js';

const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const hospitalized = (ch) => ch.hosp_until && new Date(ch.hosp_until) > new Date();
const safeHoused = (ch) => ch.safe_until && new Date(ch.safe_until) > new Date();
const runMsOf = (route) => (process.env.PORT_RUN_MS != null ? Number(process.env.PORT_RUN_MS) : route.ms); // TEST-ONLY knob (CONVOY_MS precedent)
const atSea = (boat) => !!boat.run_until; // a run in progress OR an uncollected arrival

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
  if (n >= PORT.FLEET_MAX) throw new GameError('fleet', `Your berths are full (${PORT.FLEET_MAX}). Sell a boat first.`);
  if (Number(ch.cash) < spec.cost) throw new GameError('cash', `The ${spec.name} runs $${spec.cost}.`);
  ch.cash = Number(ch.cash) - spec.cost;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -spec.cost, reason: 'port:boat' });
  const id = crypto.randomUUID();
  await client.query('INSERT INTO boats (id, character_id, kind) VALUES ($1,$2,$3)', [id, ch.id, kind]);
  await h.track(client, ch.account_id, 'port', { act: 'buy', kind });
  return { ok: true, boat: { id, kind, name: spec.name, hold: spec.hold, speed: spec.speed }, spent: spec.cost };
}

// POST /v1/port/boat/:boatId/sell — sell a docked boat back to the yard (a fraction of cost)
export async function sellBoat(ch, boatId, client, h) {
  const boat = (await client.query('SELECT * FROM boats WHERE id=$1 AND character_id=$2', [boatId, ch.id])).rows[0];
  if (!boat) throw new GameError('no_boat', 'No such boat in your fleet.');
  if (atSea(boat)) throw new GameError('at_sea', "She's out on a run — bring her in first.");
  const back = boatResale(boat.kind);
  ch.cash = Number(ch.cash) + back;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: back, reason: 'port:sell' });
  await client.query('DELETE FROM boats WHERE id=$1', [boatId]);
  await h.track(client, ch.account_id, 'port', { act: 'sell', kind: boat.kind });
  return { ok: true, refund: back };
}

// POST /v1/port/run/:boatId {route, escort} — load contraband + put to sea (a cash sink; gated by the supply cap)
export async function launchRun(ch, boatId, routeId, escort, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No runs from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp', "You're in no shape to captain a run.");
  if (safeHoused(ch)) throw new GameError('safe', "You can't run contraband from a safehouse."); // P1.3 — an op
  if (ch.loc !== PORT.DISTRICT) throw new GameError('district', `Load a run at the ${PORT.DISTRICT}.`);
  const boat = (await client.query('SELECT * FROM boats WHERE id=$1 AND character_id=$2', [boatId, ch.id])).rows[0];
  if (!boat) throw new GameError('no_boat', 'No such boat in your fleet.');
  if (atSea(boat)) throw new GameError('busy', "She's already out — she can only run one at a time.");
  const route = portRouteOf(routeId);
  if (!route) throw new GameError('bad_route', 'No such route on the charts.');
  if (levelOf(Number(ch.respect)) < route.minLvl) throw new GameError('route_level', `${route.name} runs at level ${route.minLvl}.`);
  const spec = boatOf(boat.kind);
  if (spec.speed < route.minSpeed) throw new GameError('too_slow', `The ${route.name} needs a boat that makes ${route.minSpeed}+ knots.`);
  const cost = spec.hold * route.buy;
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
    [boat.id, until, route.id, spec.hold, cost, !!escort]);
  // the supply token bucket — DIRECT SQL (outside persist, the wash/active_at pattern)
  await client.query('UPDATE characters SET port_used=$2, port_at=$3 WHERE id=$1', [ch.id, used + cost, new Date(now)]);
  await h.track(client, ch.account_id, 'port', { act: 'launch', route: route.id, hold: spec.hold });
  return { ok: true, boat: boat.id, route: route.id, hold: spec.hold, cost, escort: !!escort, arrivesSeconds: Math.ceil(runMsOf(route) / 1000) };
}

// POST /v1/port/collect/:boatId — the boat's home: roll the Coast Guard, then land the cargo or eat the bust
export async function collectRun(ch, boatId, client, h) {
  if (safeHoused(ch)) throw new GameError('safe', 'The take waits for a captain on the dock, not a ghost.'); // D2 collect
  if (ch.loc !== PORT.DISTRICT) throw new GameError('district', `Collect at the ${PORT.DISTRICT}.`);
  const boat = (await client.query('SELECT * FROM boats WHERE id=$1 AND character_id=$2', [boatId, ch.id])).rows[0];
  if (!boat) throw new GameError('no_boat', 'No such boat in your fleet.');
  if (!atSea(boat)) throw new GameError('not_out', "She's docked — nothing to collect.");
  if (new Date(boat.run_until) > new Date()) throw new GameError('at_sea', 'Still out on the water — check the ETA.');
  const route = portRouteOf(boat.run_route), spec = boatOf(boat.kind);
  const patrolMod = cityHourOf(Date.now()).patrol ? 15 : -10; // the Coast Guard works patrol hours; the small hours are safer
  const p = process.env.PORT_INTERDICT_P != null ? Number(process.env.PORT_INTERDICT_P)
    : interdictChance(route, spec, boat.run_escort, patrolMod);
  const roll = Math.random();
  await h.rngLog(client, ch.id, `port:${route.id}`, roll, roll < p ? 'interdicted' : 'clean');
  const clearRun = () => client.query('UPDATE boats SET run_until=NULL, run_route=NULL, run_hold=0, run_cost=0, run_escort=false WHERE id=$1', [boat.id]);
  if (roll >= p) {
    // CLEAN — the contraband lands and is fenced (the smuggling margin, a bounded faucet)
    const sale = Number(boat.run_hold) * route.sell;
    ch.cash = Number(ch.cash) + sale;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: sale, reason: 'port:sale' });
    await clearRun();
    if (sale >= 250000) bus.emit('streets', { type: 'port_landing', by: ch.name, route: route.name, value: sale });
    await h.track(client, ch.account_id, 'port', { act: 'land', route: route.id, sale });
    return { ok: true, interdicted: false, landed: sale, cost: Number(boat.run_cost), net: sale - Number(boat.run_cost), route: route.id };
  }
  // INTERDICTED — cargo seized, a fine (pocket then bank, the raid-fine precedent), heat, and maybe the boat sinks
  const fine = Math.min(Math.floor(Number(boat.run_cost) * PORT.FINE_RATE), Math.max(0, Math.floor(Number(ch.cash) + Number(ch.bank))));
  const fromPocket = Math.min(fine, Math.max(0, Math.floor(Number(ch.cash))));
  ch.cash = Number(ch.cash) - fromPocket;
  ch.bank = Number(ch.bank) - (fine - fromPocket);
  if (fine > 0) await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -fine, reason: 'port:fine' });
  ch.heat = Math.min(100, Number(ch.heat || 0) + PORT.BUST_HEAT);
  // a flat SINK_P sub-roll on a bust impounds/sinks the boat (PORT_SINK pins it for tests, the roll-knob precedent)
  const boatLost = process.env.PORT_SINK != null ? process.env.PORT_SINK === '1' : Math.random() < PORT.SINK_P;
  if (boatLost) await client.query('DELETE FROM boats WHERE id=$1', [boat.id]);
  else await clearRun();
  await h.notify(client, ch.id, 'port_bust', { route: route.id, fine, sunk: boatLost });
  await h.track(client, ch.account_id, 'port', { act: 'bust', route: route.id, fine, sunk: boatLost });
  return { ok: true, interdicted: true, seized: Number(boat.run_hold), fine, sunk: boatLost, route: route.id };
}

// GET /v1/port — the harbor: the boat catalog, your fleet (docked / at sea + ETA + odds), the routes, supply left
export async function portBoard(ch, client, h) {
  const now = Date.now();
  const rows = (await client.query('SELECT * FROM boats WHERE character_id=$1 ORDER BY created_at', [ch.id])).rows;
  const patrolMod = cityHourOf(now).patrol ? 15 : -10;
  const fleet = rows.map((b) => {
    const spec = boatOf(b.kind);
    const out = atSea(b);
    const arrived = out && new Date(b.run_until).getTime() <= now;
    return {
      id: b.id, kind: b.kind, name: spec?.name, hold: spec?.hold, speed: spec?.speed,
      status: !out ? 'docked' : arrived ? 'arrived' : 'at_sea',
      route: b.run_route || null,
      etaSeconds: out && !arrived ? Math.ceil((new Date(b.run_until).getTime() - now) / 1000) : 0,
    };
  });
  const routes = PORT.ROUTES.map((r) => ({
    id: r.id, name: r.name, minLvl: r.minLvl, minSpeed: r.minSpeed, buy: r.buy, sell: r.sell, margin: r.sell - r.buy,
    patrol: r.patrol,
    // representative odds for your fastest docked boat (a guide; the real roll is at collect)
    interdictPct: Math.round(interdictChance(r, boatOf(rows.find((b) => !atSea(b) && boatOf(b.kind)?.speed >= r.minSpeed)?.kind) || { speed: 0 }, false, patrolMod) * 100),
  }));
  return {
    atDocks: ch.loc === PORT.DISTRICT, district: PORT.DISTRICT,
    catalog: PORT.BOATS.map((b) => ({ id: b.id, name: b.name, cost: b.cost, hold: b.hold, speed: b.speed, resale: boatResale(b.id) })),
    fleet, fleetMax: PORT.FLEET_MAX, routes, escort: { cost: PORT.ESCORT_COST, def: PORT.ESCORT_DEF },
    supplyLeft: supplyState(ch).left, supplyCap: PORT.SUPPLY_CAP_DAY,
  };
}

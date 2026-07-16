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
import { GameError, bus } from './game.js';
import { CONVOY, COMMISSION, guardTierOf, DISTRICTS, GOODS, goodPriceOf, cargoCapacity } from './rules.js';
import { activeDecree } from './commission.js';

const uid = () => crypto.randomUUID();
const rand = (n) => Math.random() * n;
const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const hospitalized = (ch) => ch.hosp_until && new Date(ch.hosp_until) > new Date();
const safeHoused = (ch) => ch.safe_until && new Date(ch.safe_until) > new Date();
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
  return { ok: true, id, origin: ch.loc, destination: to, loaded: r.loaded };
}

async function loadConvoyRow(ch, convoy, goodId, qty, client, h) {
  if (!GOODS.find((g) => g.id === goodId)) throw new GameError('bad_good', 'No such good.');
  if (ch.loc !== convoy.origin) throw new GameError('district', 'Loading happens at the origin dock.');
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
  return { ok: true, loaded: n, good: goodId };
}

// LOAD MORE — trunk → manifest while still loading (refill the trunk from the market between loads).
export async function loadConvoy(ch, goodId, qty, client, h) {
  const convoy = await myActive(client, ch.id);
  if (!convoy || convoy.status !== 'loading') throw new GameError('no_convoy', 'No shipment loading.');
  return loadConvoyRow(ch, convoy, goodId, qty, client, h);
}

// DEPART — pick the guard tier (the fee is the sink; the tier is never public) and hit the road.
// Step two: `insure` buys freight insurance — a premium of INSURE_BPS of the manifest's base
// value into the shared pool (`convoy:insure`); a hijack later pays INSURE_PAYOUT_BPS of the
// LOST value back at collect, capped at whatever the pool holds. Insurance is never public.
export async function departConvoy(ch, guardTier, insure, client, h) {
  const convoy = await myActive(client, ch.id);
  if (!convoy || convoy.status !== 'loading') throw new GameError('no_convoy', 'No shipment loading.');
  const tier = guardTierOf(guardTier || 'none');
  if (!tier) throw new GameError('bad_guards', "Guard tiers: none, crew, heavy.");
  const manifest = await manifestOf(client, convoy.id);
  const units = manifest.reduce((a, r) => a + Number(r.qty), 0);
  if (units < CONVOY.MIN_QTY) throw new GameError('light', `A convoy is for BULK — ${CONVOY.MIN_QTY} units minimum.`);
  const value = manifestValue(manifest, convoy.destination);
  const premium = insure ? Math.ceil(value * CONVOY.INSURE_BPS / 10000) : 0;
  if (Number(ch.cash) < tier.fee + premium)
    throw new GameError('cash', `${tier.id} guards run $${tier.fee}${premium ? ` and the policy $${premium}` : ''}.`);
  if (tier.fee > 0) {
    ch.cash = Number(ch.cash) - tier.fee;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -tier.fee, reason: 'convoy:guards' });
  }
  if (premium > 0) {
    ch.cash = Number(ch.cash) - premium;
    const pool = (await client.query('SELECT pool FROM convoy_insurance WHERE id=1 FOR UPDATE')).rows[0];
    await client.query('UPDATE convoy_insurance SET pool=$1 WHERE id=1', [Number(pool.pool) + premium]);
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -premium, reason: 'convoy:insure' });
  }
  const arrivesAt = new Date(Date.now() + convoyMs());
  await client.query("UPDATE convoys SET status='transit', guards=$2, owner_gang=$3, insured=$4, departed_at=now(), arrives_at=$5 WHERE id=$1",
    [convoy.id, tier.def, h.owned.gangId || null, !!premium, arrivesAt]);
  const band = valueBand(value);
  bus.emit('streets', { type: 'convoy', from: convoy.origin, to: convoy.destination, band });
  await h.track(client, ch.account_id, 'convoy_depart', { units, guards: tier.id, insured: !!premium });
  return { ok: true, id: convoy.id, arrivesSeconds: Math.ceil(convoyMs() / 1000), units, band, premium };
}

// CANCEL while loading — the goods come back to the trunk (they must fit).
export async function cancelConvoy(ch, client, h) {
  const convoy = await myActive(client, ch.id);
  if (!convoy || convoy.status !== 'loading') throw new GameError('no_convoy', 'No shipment loading.');
  const manifest = await manifestOf(client, convoy.id);
  const units = manifest.reduce((a, r) => a + Number(r.qty), 0);
  const cap = cargoCapacity(h.owned.assets);
  if (cargoCount(h.owned.cargo) + units > cap) throw new GameError('cargo', 'The trunk cannot take it all back — sell something first.');
  for (const m of manifest) {
    const back = (h.owned.cargo[m.good_id] || 0) + Number(m.qty);
    h.owned.cargo[m.good_id] = back;
    await setCargo(client, ch.id, m.good_id, back);
  }
  await client.query("UPDATE convoys SET status='done' WHERE id=$1", [convoy.id]);
  await client.query('DELETE FROM convoy_cargo WHERE convoy_id=$1', [convoy.id]);
  return { ok: true, returned: units };
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
  // step two: up to MAX_AMBUSHES attempts per convoy, ONE per character — each fight wears
  // the guards down for the next crew (the tier's defense only; turf + lockdown never wear).
  const prior = Number(c.ambushes || 0);
  if (prior >= CONVOY.MAX_AMBUSHES) throw new GameError('spent', 'That road has seen enough — the law is thick out there now.');
  const mine = (await client.query('SELECT 1 FROM convoy_ambushes WHERE convoy_id=$1 AND character_id=$2', [convoyId, ch.id])).rows[0];
  if (mine) throw new GameError('once', 'You already made your play on that run.');

  ch.energy = Number(ch.energy) - CONVOY.AMBUSH_ENERGY;
  ch.ammo = Number(ch.ammo) - CONVOY.AMBUSH_AMMO;
  ch.heat = Math.min(100, Number(ch.heat || 0) + CONVOY.AMBUSH_HEAT);
  await h.ledger(client, { characterId: ch.id, currency: 'ammo', amount: -CONVOY.AMBUSH_AMMO, reason: 'convoy:ambush' });
  await client.query('INSERT INTO convoy_ambushes (convoy_id, character_id) VALUES ($1,$2)', [convoyId, ch.id]);
  // absolute write (pg-mem INT arithmetic quirk) — safe under the convoy row lock
  await client.query('UPDATE convoys SET ambushed=true, ambushes=$2 WHERE id=$1', [convoyId, prior + 1]);

  // turf shelters its own: a run touching the owner family's districts fights harder
  let turfDef = 0;
  if (c.owner_gang) {
    const held = (await client.query('SELECT id FROM districts WHERE holder_gang=$1', [c.owner_gang])).rows.map((d) => d.id);
    if (held.includes(c.origin) || held.includes(c.destination)) turfDef = CONVOY.TURF_DEF;
  }
  // Commission decree: LOCKDOWN — every convoy on the road fights with extra guns this week
  const lockdown = (await activeDecree(client))?.id === 'lockdown' ? COMMISSION.LOCKDOWN_DEF : 0;
  const wear = Math.min(1, prior * CONVOY.GUARD_WEAR_BPS / 10000);
  const guardDef = Number(c.guards) * (1 - wear);
  const atk = Number(ch.muscle) + Number(ch.speed) * 0.5 + rand(30);
  const def = guardDef + turfDef + lockdown + rand(30);
  await h.rngLog(client, ch.id, `convoy:ambush:${convoyId}`,
    Math.round(atk * 100) / 100,
    `${atk > def ? 'hijacked' : 'repelled'} (def ${Math.round(def * 100) / 100}${lockdown ? ', lockdown' : ''}${prior ? `, guards worn ${prior}` : ''})`);

  if (atk > def) {
    // take what the trunk holds — a pure ownership transfer; the rest rolls on to the docks
    const manifest = await manifestOf(client, convoyId);
    const cap = cargoCapacity(h.owned.assets);
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
    await h.notify(client, c.owner_character, 'convoy_hit', { from: c.origin, to: c.destination, taken });
    bus.emit('streets', { type: 'convoy_hijacked', by: ch.name, from: c.origin, to: c.destination });
    await h.track(client, ch.account_id, 'convoy_ambush', { win: true, taken });
    return { ok: true, win: true, taken, trunkFull: space <= 0 };
  }
  // the guards earn their fee
  ch.health = Math.max(1, Number(ch.health) - (20 + Math.floor(rand(20))));
  ch.hosp_until = new Date(Date.now() + CONVOY.FAIL_HOSP_MS);
  await h.notify(client, c.owner_character, 'convoy_defended', { from: c.origin, to: c.destination });
  await h.track(client, ch.account_id, 'convoy_ambush', { win: false });
  return { ok: true, win: false, hospSeconds: Math.ceil(CONVOY.FAIL_HOSP_MS / 1000) };
}

// COLLECT — after arrival, at the destination, trunk-capacity at a time. Step two settles the
// money here, in the OWNER's own transaction (lock order characters → convoys → gangs →
// singletons): the destination TOLL (holder family's cut of what lands on their docks — a
// ledgered transfer, clamped to pocket, never a gate on the freight) and the INSURANCE claim
// (payout for hijacked value, capped at whatever the pool holds — insurers' risk).
export async function collectConvoy(ch, convoyId, client, h) {
  const c = (await client.query('SELECT * FROM convoys WHERE id=$1 FOR UPDATE', [convoyId])).rows[0];
  if (!c || c.owner_character !== ch.id) throw new GameError('no_convoy', 'Not your shipment.');
  if (c.status !== 'transit') throw new GameError('no_convoy', 'Nothing to collect.');
  if (!arrived(c)) throw new GameError('en_route', 'Still on the road.');
  if (ch.loc !== c.destination) throw new GameError('district', `The freight lands at ${c.destination} — be there.`);
  const manifest = await manifestOf(client, convoyId);
  const cap = cargoCapacity(h.owned.assets);
  let space = Math.max(0, cap - cargoCount(h.owned.cargo));
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
  // the destination toll: the family holding these docks takes its cut of what YOU collect
  // (own turf and unheld docks are free). Clamped to pocket — the freight is never held hostage.
  let toll = 0;
  const holder = (await client.query('SELECT holder_gang FROM districts WHERE id=$1', [c.destination])).rows[0]?.holder_gang;
  if (holder && holder !== h.owned.gangId && collectedValue > 0) {
    toll = Math.min(Math.floor(collectedValue * CONVOY.TOLL_BPS / 10000), Math.max(0, Math.floor(Number(ch.cash))));
    if (toll > 0) {
      ch.cash = Number(ch.cash) - toll;
      await client.query('UPDATE gangs SET treasury = treasury + $2 WHERE id=$1', [holder, toll]);
      await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -toll, reason: 'convoy:toll' });
    }
  }
  // the insurance claim: pay out the hijacked value's share, capped at the pool (zero-sum)
  let insurance = 0;
  if (c.insured && Number(c.insured_loss) > 0) {
    const pool = Number((await client.query('SELECT pool FROM convoy_insurance WHERE id=1 FOR UPDATE')).rows[0].pool);
    insurance = Math.min(Math.floor(Number(c.insured_loss) * CONVOY.INSURE_PAYOUT_BPS / 10000), Math.max(0, Math.floor(pool)));
    if (insurance > 0) {
      ch.cash = Number(ch.cash) + insurance;
      await client.query('UPDATE convoy_insurance SET pool=$1 WHERE id=1', [pool - insurance]);
      await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: insurance, reason: 'convoy:payout' });
    }
    await client.query('UPDATE convoys SET insured_loss=0 WHERE id=$1', [convoyId]);
  }
  if (left === 0) await client.query("UPDATE convoys SET status='done' WHERE id=$1", [convoyId]);
  return { ok: true, collected: taken, remaining: left, toll, insurance };
}

// The road board: everything in transit (value BAND only — scouting the tier is the gamble),
// plus my active shipment in full.
export async function convoyBoard(pool, characterId) {
  const rows = (await pool.query(
    `SELECT c.*, ch.name AS owner FROM convoys c JOIN characters ch ON ch.id = c.owner_character
      WHERE c.status='transit' ORDER BY c.arrives_at ASC LIMIT 30`)).rows;
  const cargo = (await pool.query(
    'SELECT convoy_id, good_id, qty FROM convoy_cargo WHERE qty > 0')).rows;
  const byConvoy = {};
  for (const r of cargo) (byConvoy[r.convoy_id] = byConvoy[r.convoy_id] || []).push(r);
  const inTransit = rows.map((c) => ({ id: c.id, owner: c.owner, from: c.origin, to: c.destination,
    band: valueBand(manifestValue(byConvoy[c.id] || [], c.destination)),
    ambushed: c.ambushed, ambushes: Number(c.ambushes || 0), ambushesLeft: Math.max(0, CONVOY.MAX_AMBUSHES - Number(c.ambushes || 0)),
    arrivesSeconds: Math.max(0, Math.ceil((new Date(c.arrives_at) - Date.now()) / 1000)) }));
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
  return { guardTiers: CONVOY.GUARD_TIERS, minQty: CONVOY.MIN_QTY,
    maxAmbushes: CONVOY.MAX_AMBUSHES, tollBps: CONVOY.TOLL_BPS,
    insureBps: CONVOY.INSURE_BPS, insurePayoutBps: CONVOY.INSURE_PAYOUT_BPS,
    inTransit, mine: my };
}

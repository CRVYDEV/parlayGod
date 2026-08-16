// ═══ THE SHIPMENT (omerta-scarcity-design.md §3) — the contested material ═══
// Every item in this city is infinite-supply at a deterministic price, and the one genuinely
// contested rate-limited resource (the cartel reservoirs) pays CASH — the abundant thing. This is
// the other kind: a daily quantity the catalogs cannot produce, landing where the seed says, taken
// first-come against a city-wide cap.
//
// §10.4 SURFACE: the MATERIAL is not a currency — it is an owned quantity on the character (the
// contraband / heist-loot precedent), so taking it writes NO ledger row and it never enters the
// conservation set. The one value that moves is the COMMISSION's cash, a character_id'd SINK
// (`shipment:commission`) that check (a) reconciles. There is no faucet here at all: the material
// pays nothing and exists only to gate a sink.
import { GameError, notify, bus } from './game.js';
import { SHIPMENT, DISTRICTS, commissionOf, shipmentDistrictOf, shipmentForecast, shipmentCityCap,
  dayOf, jailed } from './rules.js';
import { logCollect } from './collection.js';

const districtName = (id) => DISTRICTS.find((d) => d.id === id)?.name || id;

// living-player population — what the day's stock is sized against. NPCs and the dead excluded, or
// the population worker inflates the drop by spawning scenery (the deeds.js livingPlayers twin).
async function livingPlayers(client) {
  return Number((await client.query('SELECT COUNT(*) n FROM characters WHERE alive AND NOT is_npc')).rows[0].n);
}
// the day's stock, once. THE COUNT IS THE EXPENSIVE PART, and this board sits on a polled screen —
// the client's 30s tick re-renders whatever is open, so anything here runs once per player per half
// minute, forever. So the cap AND the population it was sized against are STAMPED when the day
// materializes and read back from the row thereafter: one count per DAY rather than one per read,
// and a cap that cannot move under a player mid-day either. A row written before the scaling shipped
// carries 0 and falls back to the floor.
const capOf = (row) => Number(row?.cap) > 0 ? Number(row.cap) : SHIPMENT.CITY_BASE;

// today's city stock. Two readers on purpose: the BOARD must never write (the read-path guard is
// right to refuse — a read that materializes state is a write wearing a read's clothes), and both
// the district and the cap are computable without the row, so an un-materialized day reads perfectly
// well as "the whole stock, nothing taken". Only the TAKE materializes, on the write path.
async function readDay(client, day) {
  const got = (await client.query('SELECT day, district, taken, cap, pop FROM shipment_days WHERE day=$1', [day])).rows[0];
  if (got) return got;
  // un-materialized: quote what the first take WILL stamp, so board and till agree (the check-5 rule).
  // This is the ONE read that counts, and it happens at most until the day's first take.
  const pop = await livingPlayers(client);
  return { day, district: shipmentDistrictOf(day), taken: 0, cap: shipmentCityCap(pop), pop };
}
// materialize for the write path. A deterministic PK on the day makes a concurrent first touch a
// 23505 the caller retries into (the world_npcs / megaproject first-touch precedent).
async function dayRow(client, day) {
  const got = (await client.query('SELECT day, district, taken, cap, pop FROM shipment_days WHERE day=$1', [day])).rows[0];
  if (got) return got;
  const pop = await livingPlayers(client);
  const cap = shipmentCityCap(pop);
  await client.query('INSERT INTO shipment_days (day, district, taken, cap, pop) VALUES ($1,$2,0,$3,$4)',
    [day, shipmentDistrictOf(day), cap, pop]);
  return { day, district: shipmentDistrictOf(day), taken: 0, cap, pop };
}

export async function shipmentBoard(ch, client, h) {
  const day = dayOf();
  const row = await readDay(client, day);
  const mine = Number((await client.query(
    'SELECT n FROM shipment_takes WHERE day=$1 AND character_id=$2', [day, ch.id])).rows[0]?.n || 0);
  const cap = capOf(row);
  const left = Math.max(0, cap - Number(row.taken || 0));
  const population = Number(row.pop || 0);   // stamped with the cap — no count on this path
  const step = SHIPMENT.CITY_STEP;
  return {
    material: SHIPMENT.MATERIAL,
    district: row.district,
    districtName: districtName(row.district),
    here: ch.loc === row.district,
    cityLeft: left,
    cityCap: cap,
    // the city grows the stock: what it is sized against, and where the next step lands
    population,
    capStep: step,
    capPerStep: SHIPMENT.CITY_PER_STEP,
    capMax: SHIPMENT.CITY_MAX,
    nextCapAt: cap >= SHIPMENT.CITY_MAX || !population ? null : (population - (population % step)) + step,
    perPlayer: SHIPMENT.PER_PLAYER,
    yourTakeToday: mine,
    yourTakeLeft: Math.max(0, SHIPMENT.PER_PLAYER - mine),
    held: Number(ch.shipment || 0),
    routUnits: SHIPMENT.ROUT_UNITS,
    lootRate: SHIPMENT.LOOT_RATE,
    forecast: shipmentForecast(5, day),
    commissions: SHIPMENT.COMMISSIONS.map((c) => ({ id: c.id, name: c.name, blurb: c.blurb,
      units: c.units, cash: c.cash,
      afford: Number(ch.shipment || 0) >= c.units && Number(ch.cash) >= c.cash })),
    mine: (h?.owned?.bespoke || []).map((b) => ({ id: b.commission_id, serial: Number(b.serial),
      name: commissionOf(b.commission_id)?.name || b.commission_id })),
  };
}

// TAKE — first-come, at the district, against BOTH caps. The city cap is claimed by the same
// conditional UPDATE that records it (`taken = taken + n WHERE taken + n <= cap`), so two players
// racing the last crates cannot both take them; whoever loses is told the truth.
export async function takeShipment(ch, client, h) {
  if (jailed(ch)) throw new GameError('jailed', "The shipment came and went while you sat in a cell.");
  const day = dayOf();
  const row = await dayRow(client, day);
  if (ch.loc !== row.district)
    throw new GameError('district', `The shipment landed at ${districtName(row.district)}. You have to be standing there.`,
      { district: row.district });
  const mine = Number((await client.query(
    'SELECT n FROM shipment_takes WHERE day=$1 AND character_id=$2', [day, ch.id])).rows[0]?.n || 0);
  const room = SHIPMENT.PER_PLAYER - mine;
  if (room <= 0) throw new GameError('taken', "You've had your share of today's shipment. Somebody else gets the rest.");
  // the city cap is the contention: claim it atomically against THE DAY'S OWN stamped cap (never the
  // live constant — a cap that moved mid-day would let a late signup hand out crates already counted
  // as gone), and take whatever the claim actually got.
  const cap = capOf(row);
  const want = room;
  let got = 0, nowTaken = Number(row.taken || 0);
  for (let n = want; n >= 1 && !got; n--) {
    const up = await client.query(
      'UPDATE shipment_days SET taken = taken + $2 WHERE day=$1 AND taken + $2 <= $3 RETURNING taken',
      [day, n, cap]);
    // the claim's OWN RETURNING is the truth, never the pre-claim read: under contention `row.taken`
    // is already stale by the time we get here, and deriving what's left from it either announces
    // "the shipment is gone" while crates remain or misses the announcement entirely (red-team F4).
    if (up.rowCount) { got = n; nowTaken = Number(up.rows[0].taken); }
  }
  if (!got) throw new GameError('gone', `Today's ${SHIPMENT.MATERIAL} is gone — the whole city's worth. Try the next one.`);
  const upd = await client.query(
    'UPDATE shipment_takes SET n = n + $3 WHERE day=$1 AND character_id=$2', [day, ch.id, got]);
  if (!upd.rowCount) await client.query(
    'INSERT INTO shipment_takes (day, character_id, n) VALUES ($1,$2,$3)', [day, ch.id, got]);
  // the material rides the character row (an owned quantity, never a currency — no ledger row)
  ch.shipment = Number(ch.shipment || 0) + got;
  const left = Math.max(0, cap - nowTaken);
  if (left === 0) bus.emit('streets', { type: 'shipment_gone', who: ch.name, district: row.district });
  return { ok: true, took: got, held: ch.shipment, cityLeft: left, material: SHIPMENT.MATERIAL };
}

// COMMISSION — the sink. Units are consumed (ownership) and cash is BURNED (a §10.4 sink); what
// comes back is a numbered, account-level, purely cosmetic piece. Serials are sequential per kind
// and uncapped: the scarcity is the MATERIAL's, not an artificial ceiling on the trophy.
export async function commissionPiece(ch, id, client, h) {
  const c = commissionOf(id);
  if (!c) throw new GameError('bad_piece', 'No craftsman in this city makes that.');
  if (jailed(ch)) throw new GameError('jailed', 'Not from a cell.');
  if (Number(ch.shipment || 0) < c.units)
    throw new GameError('units', `${c.name} takes ${c.units} of ${SHIPMENT.MATERIAL} — you hold ${Number(ch.shipment || 0)}.`);
  if (Number(ch.cash) < c.cash) throw new GameError('cash', `The craftsman wants $${c.cash.toLocaleString()}.`);
  ch.shipment = Number(ch.shipment || 0) - c.units;
  ch.cash = Number(ch.cash) - c.cash;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -c.cash, reason: 'shipment:commission' });
  const serial = Number((await client.query(
    'SELECT COUNT(*) n FROM bespoke_pieces WHERE commission_id=$1', [id])).rows[0].n) + 1;
  await client.query(
    'INSERT INTO bespoke_pieces (account_id, commission_id, serial, holder_name) VALUES ($1,$2,$3,$4)',
    [ch.account_id, id, serial, ch.name]);
  if (h?.owned) h.owned.bespoke = [...(h.owned.bespoke || []), { commission_id: id, serial }];
  await logCollect(client, ch.account_id, 'bespoke', id);
  await notify(client, ch.id, 'commissioned', { id, name: c.name, serial });
  bus.emit('streets', { type: 'commissioned', who: ch.name, piece: c.name, serial });
  return { ok: true, piece: { id, name: c.name, serial }, held: ch.shipment, spent: c.cash };
}

// the pieces an account has ever commissioned — account-keyed, so they SURVIVE DEATH and the heir
// inherits the collection (the compound / deed posture; there is no character_id to wipe)
export async function bespokeOf(client, accountId) {
  return (await client.query(
    'SELECT commission_id, serial, made_at FROM bespoke_pieces WHERE account_id=$1 ORDER BY made_at',
    [accountId])).rows;
}

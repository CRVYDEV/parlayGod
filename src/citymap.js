// THE MAP — the visible, shared, contested world in one read. Mafia IS territory, and turf was the
// game's LEAST visible system — six control states (holder / NPC occupier / sealed contest / the watch
// window / a territory racket / a sovereignty stronghold) each surfaced on a different route, none of
// them a picture you could look at and read the power structure at a glance. This is that picture:
// per-district control + the neighbour edges + a family power ranking, so a player can SEE who holds
// what, know at a glance who is winning, and point at "my family holds the docks".
//
// PURE READ — it aggregates state other systems already own (districts, gangs, territory_rackets,
// sov_structures, district_bids, world_npcs). ZERO §10.4 surface: it moves no value and writes no row.
// pg-mem posture: flat queries + JS joins (no correlated subqueries, no `= ANY($1::text[])`).
import { DISTRICTS, districtNeighbours, worldNpcOf, liberationCost,
  territoryTypeOf, territoryTierOf, SOV, M3, seasonPhaseOf, dayOf } from './rules.js';
import * as S from './social/gangs.js';
import * as World from './world.js';

// The board. `myGangId` (from h.owned.gangId) flags a district the caller's family holds, so the client
// can highlight "yours" without a second call and without leaking any account id.
export async function cityMap(client, ch, myGangId = null) {
  // ── one flat query per control table, joined in JS (the /v1/gangs pg-mem precedent) ──
  const dr = (await client.query(
    'SELECT id, holder_gang, garrison, npc_holder, watch_hour, contest_until FROM districts')).rows;
  const gangs = new Map();
  for (const g of (await client.query('SELECT id, name, tag, treasury FROM gangs')).rows) gangs.set(g.id, g);
  const rackets = new Map();
  for (const r of (await client.query('SELECT district_id, owner_gang, tier, kind FROM territory_rackets')).rows) rackets.set(r.district_id, r);
  const sovs = new Map();
  for (const s of (await client.query('SELECT district_id, gang_id, tier FROM sov_structures')).rows) sovs.set(s.district_id, s);
  const bidCounts = new Map();
  for (const b of (await client.query('SELECT district_id FROM district_bids')).rows)
    bidCounts.set(b.district_id, (bidCounts.get(b.district_id) || 0) + 1);
  // STREET DEEDS — how built-up each district is (the growing-world texture) + the caller's own deed,
  // so the map can flag "your street is here". Pure status; a deed grants no turf control (that's the
  // holder layer above). Two flat reads (the pg-mem posture).
  const deedCounts = new Map();
  for (const dd of (await client.query('SELECT district FROM street_deeds')).rows)
    deedCounts.set(dd.district, (deedCounts.get(dd.district) || 0) + 1);
  const myDeed = (await client.query('SELECT name, district FROM street_deeds WHERE account_id=$1', [ch.account_id])).rows[0] || null;

  const now = Date.now();
  const districts = [];
  const held = {};   // gangId -> count of core districts held (the power ranking basis)
  for (const cat of DISTRICTS) {
    const d = dr.find((x) => x.id === cat.id) || { id: cat.id };
    const holderGang = d.holder_gang ? gangs.get(d.holder_gang) : null;
    if (d.holder_gang) held[d.holder_gang] = (held[d.holder_gang] || 0) + 1;
    const tile = {
      id: cat.id, name: cat.name || cat.id, perk: cat.perk,
      neighbours: districtNeighbours(cat.id),
      garrison: Math.floor(Number(d.garrison || 0)),
      // who holds it (a player family), and whether it's YOURS — the identity hook
      holder: holderGang ? { gangId: d.holder_gang, name: holderGang.name, tag: holderGang.tag, mine: d.holder_gang === myGangId } : null,
      // an NPC outfit occupying it (unliberated core turf — the perk is dormant until a family frees it)
      occupier: null, contest: null, watch: null, racket: null, sov: null,
      // a one-word state for the client to colour the tile by
      state: 'open',
      // STREET DEEDS — the address count here, and your own street if it sits in this district
      deeds: deedCounts.get(cat.id) || 0,
      myDeed: myDeed && myDeed.district === cat.id ? myDeed.name : null,
    };
    if (d.npc_holder) {
      const fx = worldNpcOf(d.npc_holder);
      const frac = await World.outfitStrengthFrac(client, fx);
      tile.occupier = { npc: d.npc_holder, name: fx?.name || d.npc_holder, strengthPct: Math.round(frac * 100),
        liberationCost: liberationCost(fx, frac) };
      tile.state = 'occupied';
    }
    // THE WATCH — the holder's declared ready-hour (public: an EVE window is content because everyone reads it)
    if (d.holder_gang) {
      tile.watch = { hour: d.watch_hour == null ? null : Number(d.watch_hour),
        windowH: M3.WATCH_WINDOW_H, open: S.onWatch(d) };
      tile.state = tile.holder.mine ? 'mine' : 'held';
      // WHAT IT COSTS TO COME FOR IT. The map priced the NPC path (`liberationCost`, rendered on the
      // tile) and priced the PLAYER path nowhere — it sent a raw `garrison`, which is not the price
      // and is off by the outbid and every modifier on top: at a 200,000 garrison the door is 337,500.
      // This is the one screen built for reading the power structure at a glance, so pricing one of
      // the two ways a district changes hands and not the other is the asymmetry, not the omission.
      // The PUBLIC quote (no gang, respect 0 — the /v1/districts precedent at server.js), so it never
      // leaks a rival's charter or coalition; a specific attacker's own floor still comes from the
      // stake control on the Family tab, which is where you actually act.
      try {
        tile.claimFloor = (await S.turfQuote(client, { respect: 0 }, d, null)).cost;
      } catch { tile.claimFloor = null; }   // a level-gated quote is not a price this viewer can be shown
    }
    // THE SEALED BID — a live contest. The COUNT of families in is public (the tension); no amount is.
    if (d.contest_until && new Date(d.contest_until).getTime() > now) {
      tile.contest = { families: bidCounts.get(cat.id) || 0,
        resolvesSeconds: Math.max(0, Math.round((new Date(d.contest_until).getTime() - now) / 1000)) };
      tile.state = 'contested';
    }
    // the territory racket running on this district (income engine — who's earning off this ground)
    const rk = rackets.get(cat.id);
    if (rk) {
      const ty = territoryTypeOf(rk.kind), tr = territoryTierOf(rk.tier);
      const rg = gangs.get(rk.owner_gang);
      tile.racket = { kind: rk.kind, typeName: ty.name, tier: Number(rk.tier), tierName: tr?.name || null,
        ownerTag: rg?.tag || null };
    }
    // a sovereignty stronghold planted on the district (the deep defensive hold)
    const sv = sovs.get(cat.id);
    if (sv) {
      const sg = gangs.get(sv.gang_id);
      tile.sov = { tier: Number(sv.tier), name: SOV.TIERS[Number(sv.tier) - 1]?.name || null, ownerTag: sg?.tag || null };
    }
    districts.push(tile);
  }

  // THE POWER RANKING — who is winning the city, read at a glance: families ranked by core districts
  // held, treasury the tiebreak. This is the "read the power structure" hook the map is for.
  const powers = Object.entries(held)
    .map(([gid, count]) => { const g = gangs.get(gid); return { gangId: gid, name: g?.name || '—', tag: g?.tag || null, districts: count, treasury: Math.floor(Number(g?.treasury || 0)), mine: gid === myGangId }; })
    .sort((a, b) => b.districts - a.districts || b.treasury - a.treasury)
    .slice(0, 8);

  const phase = seasonPhaseOf(dayOf());
  return {
    districts, powers,
    season: { id: phase.id, name: phase.name, reckoning: phase.id === 'reckoning' },
    mine: { gangId: myGangId, districts: myGangId ? (held[myGangId] || 0) : 0 },
    deed: myDeed ? { name: myDeed.name, district: myDeed.district } : null, // your street, for the map header
    total: DISTRICTS.length,
  };
}

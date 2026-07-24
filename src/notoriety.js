// TIER C — ROUTE NOTORIETY (omerta-transport-depth-design.md). A per-(character, lane) heat that grows
// each run of the same lane and decays lazily, shared by convoys (the land loop) and the port (the sea
// loop). PURE RISK MODIFIER — §10.4-free: on the port it only RAISES interdiction (emission can only
// fall); on convoys it only LOWERS the shipper's guard defense (an ambush is a pure ownership transfer).
// The reputation from the smuggling legends (decayMult / gainMult) manages the heat — see rules.js.
import { NOTORIETY, notorietyNow } from './rules.js';

// the decayed heat on a lane RIGHT NOW (rep T1 cools it faster via decayMult). Read-only; no row → 0.
export async function laneHeat(client, characterId, routeKey, decayMult = 1) {
  const row = (await client.query('SELECT notoriety, noted_at FROM route_notoriety WHERE character_id=$1 AND route_key=$2',
    [characterId, routeKey])).rows[0];
  if (!row) return 0;
  return notorietyNow(row.notoriety, row.noted_at, decayMult);
}

// raise a lane's heat by GAIN×gainMult, clamped at MAX, composing with the live decay (so a lane you
// hammer climbs toward the cap and a lane you leave cools). Upsert via SELECT-then-write — notoriety is
// NUMERIC so no INT-arith quirk, but ABSOLUTE writes anyway (the decayed base is computed in JS). The
// caller holds the character/boat/convoy lock, so the per-(character, route_key) row can't race itself.
export async function heatLane(client, characterId, routeKey, decayMult = 1, gainMult = 1) {
  const cur = await laneHeat(client, characterId, routeKey, decayMult);
  const next = Math.min(NOTORIETY.MAX, cur + NOTORIETY.GAIN * gainMult);
  const exists = (await client.query('SELECT 1 FROM route_notoriety WHERE character_id=$1 AND route_key=$2',
    [characterId, routeKey])).rows[0];
  if (exists) await client.query('UPDATE route_notoriety SET notoriety=$3, noted_at=now() WHERE character_id=$1 AND route_key=$2',
    [characterId, routeKey, next]);
  else await client.query('INSERT INTO route_notoriety (character_id, route_key, notoriety, noted_at) VALUES ($1,$2,$3,now())',
    [characterId, routeKey, next]);
  return next;
}

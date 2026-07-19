// NAMED LANDMARKS — one dedicable plaque per district, held by the highest $OMR flex. Pure STATUS
// (display-only, outside §10.4 and the sim-audited balance — the family-seal / estate precedent): a
// dedication BURNS the paid $OMR (a deflationary sink via `vanity:landmark`, riding the existing
// vanity:% burn term — ZERO invariant changes), and a bigger flex takes the plaque over (no refund —
// it's a flex, not escrow). The name borne is the ACCOUNT's dynasty name (or the living street), so a
// plaque survives death (the heir keeps the family's monument). All numbers are founder sign-off levers.
import { GameError } from './game.js';
import { LANDMARKS, landmarkOf } from './rules.js';
import { spendOmr } from './vanity.js';

// POST /v1/landmarks/:districtId { amount } — dedicate the district's plaque. Runs under withCharacter.
export async function dedicateLandmark(ch, districtId, amount, client, h) {
  const place = landmarkOf(districtId);
  if (!place) throw new GameError('district', 'No landmark in that district.');
  const amt = Math.floor(Number(amount));
  if (!Number.isFinite(amt) || amt < LANDMARKS.MIN_DEDICATE)
    throw new GameError('amount', `A dedication runs at least ${LANDMARKS.MIN_DEDICATE} $OMR.`);
  // lock the plaque row (SELECT-then-write; the current flex must be strictly beaten)
  const cur = (await client.query('SELECT amount FROM landmarks WHERE district_id=$1 FOR UPDATE', [districtId])).rows[0];
  if (cur && amt <= Number(cur.amount))
    throw new GameError('outbid', `The current flex is ${Math.floor(Number(cur.amount))} $OMR — beat it to take the plaque.`);
  await spendOmr(client, h, amt, 'vanity:landmark'); // gates h.acct.omr, debits in-memory, ledgers the burn (vanity:% term)
  // the name borne: the account's dynasty (survives death) else the living street
  const acct = (await client.query('SELECT dynasty_name FROM account_persistent WHERE account_id=$1', [ch.account_id])).rows[0];
  const name = (acct?.dynasty_name || ch.name || 'A nameless outfit').slice(0, 40);
  if (cur) await client.query('UPDATE landmarks SET holder_account=$2, holder_name=$3, amount=$4, dedicated_at=now() WHERE district_id=$1', [districtId, ch.account_id, name, amt]);
  else await client.query('INSERT INTO landmarks (district_id, holder_account, holder_name, amount) VALUES ($1,$2,$3,$4)', [districtId, ch.account_id, name, amt]);
  await h.track(client, ch.account_id, 'landmark', { district: districtId, omr: amt });
  return { ok: true, district: districtId, place, name, amount: amt, spent: amt };
}

// GET /v1/landmarks — the map of dedicated plaques (every district, holder + flex, or open).
export async function landmarkBoard(pool) {
  const held = Object.fromEntries((await pool.query('SELECT district_id, holder_name, amount FROM landmarks')).rows
    .map((r) => [r.district_id, { name: r.holder_name, amount: Math.floor(Number(r.amount)) }]));
  return {
    minDedicate: LANDMARKS.MIN_DEDICATE,
    landmarks: Object.entries(LANDMARKS.PLACES).map(([district, place]) => ({
      district, place,
      holder: held[district]?.name || null,
      amount: held[district]?.amount || 0,
      nextMin: held[district] ? held[district].amount + 1 : LANDMARKS.MIN_DEDICATE,
    })),
  };
}

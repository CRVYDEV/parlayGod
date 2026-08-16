// THE SHIPMENT (omerta-scarcity-design.md §3) — the contested daily material.
//
// What this proves:
//   1. CONTENTION IS REAL — the city-wide cap is a shared quantity: what one player takes, another
//      cannot. Two players race it and the second is told the truth. That is the whole feature.
//   2. LOCATION + PER-PLAYER CAPS — it lands where the seed says (forecastable, unmanufacturable),
//      and one whale cannot take the lot.
//   3. NOT A CURRENCY — taking it writes ZERO ledger rows. It is an owned quantity: LOOTABLE on a
//      fire-kill, and it dies with the street.
//   4. AN INPUT, NEVER AN OUTPUT — the material pays nothing; its only use is a COMMISSION, which is
//      a cash SINK. So the drop is emission-safe by construction, asserted as a ledger identity.
// pg-mem, zero infra.
process.env.MOD_KEY = 'test-mod-key';
process.env.RATE_LIMIT = 'off';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { SHIPMENT, shipmentDistrictOf, dayOf, collectionCatalog } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body, key } = {}) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (key) headers['x-mod-key'] = key;
  const res = await app.inject({ method, url, headers, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const cashDrift = async () => Number((await runLedgerInvariants(pool, { alert: false }))
  .checks.find((c) => c.name === 'character cash').drift);
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const c = await meOf(token);
  return { token, id: c.id, name,
    aid: (await pool.query(`SELECT account_id a FROM characters WHERE id='${c.id}'`)).rows[0].a };
};
const ledgerRows = async () => Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n);
const heldBy = async (id) => Number((await pool.query(`SELECT shipment FROM characters WHERE id='${id}'`)).rows[0].shipment);
const standAt = (id, d) => pool.query(`UPDATE characters SET loc='${d}', jail_until=NULL WHERE id='${id}'`);

const ace = await mk('Ace Moreno');
const bo  = await mk('Bo Vitale');
const cy  = await mk('Cy Bellini');
const where = shipmentDistrictOf();
const elsewhere = ['docks', 'canal', 'neon', 'brick', 'foundry', 'cathedral'].find((d) => d !== where);

// ── the board: today's landing, forecastable, with the terms stated up front ──
let r = await call('GET', '/v1/shipment', { token: ace.token });
assert.equal(r.code, 200, 'the shipment board is readable');
assert.equal(r.body.district, where, 'the board names where the seed put it');
assert.equal(r.body.cityLeft, SHIPMENT.CITY_CAP, 'a fresh day holds the whole city cap');
assert.equal(r.body.yourTakeLeft, SHIPMENT.PER_PLAYER, 'and your whole daily take');
assert.equal(r.body.forecast.length, 5, 'the next few days are forecastable — you can plan a trip');
assert(r.body.commissions.length && r.body.commissions.every((c) => c.units > 0 && c.cash > 0),
  'every commission costs BOTH the material and cash');
assert(collectionCatalog().bespoke.items.length === SHIPMENT.COMMISSIONS.length,
  'the pieces are a collection category, derived from the catalog');

// ═══ 2. LOCATION ═══
await standAt(ace.id, elsewhere);
r = await call('POST', '/v1/shipment/take', { token: ace.token });
assert.equal(r.code, 400, 'you cannot take it from across town');
assert.equal(r.body.error, 'district', 'and the refusal is the district gate');
assert.equal(r.body.district, where, 'which carries the destination, so the client can offer the way out');

// ═══ 3. NOT A CURRENCY — the take moves no value ═══
await standAt(ace.id, where);
const beforeTake = await ledgerRows();
r = await call('POST', '/v1/shipment/take', { token: ace.token });
assert.equal(r.code, 200, 'standing in the right place, you take your share');
assert.equal(r.body.took, SHIPMENT.PER_PLAYER, 'the whole per-player take at once');
assert.equal(await heldBy(ace.id), SHIPMENT.PER_PLAYER, 'and it lands on the character');
assert.equal(await ledgerRows(), beforeTake, 'THE TAKE WROTE NO LEDGER ROW — the material is not a currency');
assert.equal((await meOf(ace.token)).shipment, SHIPMENT.PER_PLAYER, 'the sheet carries what you hold');

// the per-player cap: a second grab the same day gets nothing
r = await call('POST', '/v1/shipment/take', { token: ace.token });
assert.equal(r.body.error, 'taken', 'ONE PLAYER cannot take the lot — the daily share is spent');

// ═══ 1. CONTENTION — the city cap is a shared quantity ═══
// drain the day down to less than one full share, then prove the next player gets the REMAINDER and
// the one after that gets nothing at all.
const day = dayOf();
await pool.query(`UPDATE shipment_days SET taken=${SHIPMENT.CITY_CAP - 1} WHERE day=${day}`);
await standAt(bo.id, where);
r = await call('POST', '/v1/shipment/take', { token: bo.token });
assert.equal(r.code, 200, 'the next player takes what is left');
assert.equal(r.body.took, 1, 'CONTENTION: only the remainder — what Ace took, Bo cannot');
assert.equal(r.body.cityLeft, 0, 'and the day is now spent');
await standAt(cy.id, where);
r = await call('POST', '/v1/shipment/take', { token: cy.token });
assert.equal(r.body.error, 'gone', 'the third player is told the truth: the whole city\'s worth is gone');
assert.equal(await heldBy(cy.id), 0, 'and holds nothing');

// ═══ 4. THE SINK — the material buys a numbered piece, and cash BURNS ═══
const piece = SHIPMENT.COMMISSIONS[0];
await pool.query(`UPDATE characters SET shipment=${piece.units}, cash=${piece.cash + 500} WHERE id='${ace.id}'`);
// this suite SQL-seeds cash to reach the commissions, so the ABSOLUTE cash drift is non-zero by
// construction. What must not move is the DELTA across the sink (the scale/loadtest posture).
const driftBefore = await cashDrift();
const cashBefore = Number((await pool.query(`SELECT cash FROM characters WHERE id='${ace.id}'`)).rows[0].cash);
r = await call('POST', `/v1/shipment/commission/${piece.id}`, { token: ace.token });
assert.equal(r.code, 200, 'the craftsman takes the commission');
assert.equal(r.body.piece.serial, 1, 'the first of its kind in this city');
assert.equal(await heldBy(ace.id), 0, 'the material is consumed');
assert.equal(Number((await pool.query(`SELECT cash FROM characters WHERE id='${ace.id}'`)).rows[0].cash),
  cashBefore - piece.cash, 'and the cash is spent to the dollar');
assert.equal(Number((await pool.query(
  `SELECT COUNT(*) n FROM transactions WHERE reason='shipment:commission' AND character_id='${ace.id}'`)).rows[0].n), 1,
  'ledgered as a SINK — the material gates a sink and pays nothing itself');
assert.equal(Number((await pool.query(
  "SELECT COUNT(*) n FROM transactions WHERE reason LIKE 'shipment%' AND amount > 0")).rows[0].n), 0,
  'THE EMISSION CHECK: no shipment reason has EVER paid out — it is an input, never an output');
assert.equal(await cashDrift(), driftBefore,
  'the commission moved the per-character cash check by NOTHING — every dollar of it was ledgered');

// serials are sequential per kind, and the piece is account-level (it outlives the street)
await pool.query(`UPDATE characters SET shipment=${piece.units}, cash=${piece.cash} WHERE id='${bo.id}'`);
r = await call('POST', `/v1/shipment/commission/${piece.id}`, { token: bo.token });
assert.equal(r.body.piece.serial, 2, 'the second of its kind');
let me = await meOf(ace.token);
assert.equal(me.bespoke.length, 1, 'the sheet carries the pieces you commissioned');
const col = (await call('GET', '/v1/collection', { token: ace.token })).body;
assert(col.categories.find((c) => c.id === 'bespoke').items.find((i) => i.id === piece.id).got,
  'and the collection logged it');

// refusals when short of either half
r = await call('POST', `/v1/shipment/commission/${piece.id}`, { token: ace.token });
assert.equal(r.body.error, 'units', 'no material, no piece');
r = await call('POST', '/v1/shipment/commission/nonesuch', { token: ace.token });
assert.equal(r.body.error, 'bad_piece', 'and nobody makes what nobody makes');

// ═══ 3b. IT DIES WITH THE STREET ═══
// It lives on the CHARACTER row, so the estate takes it by construction — the heir starts clean.
await pool.query(`UPDATE characters SET shipment=8 WHERE id='${cy.id}'`);
assert.equal(await heldBy(cy.id), 8, 'Cy is holding a stockpile');
const killed = await call('POST', '/v1/mod/kill', { key: 'test-mod-key', body: { characterId: cy.id } });
assert.equal(killed.code, 200, 'the mod-kill runs the estate');
assert.equal(await heldBy(killed.body.heirId), 0,
  'the heir holds none of it — the material dies with the street');

// ═══ §10.4 ═══
const inv = await runLedgerInvariants(pool, { alert: false });
assert(inv.checks.find((c) => c.name === 'reason vocabulary').ok, 'shipment: is a known reason');

await app.close();
console.log('shipment: PASS');

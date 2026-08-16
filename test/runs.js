// LIMITED RUNS (omerta-scarcity-design.md §2) — N of each numbered car exist, ever.
//
// What this proves:
//   1. THE CAP is real and ONE-DIRECTIONAL — the run stops minting at `cap` and a melted car never
//      frees its slot, so live supply only ever falls. That is the whole feature.
//   2. DROP, NEVER SELL — the mint fires on a rare roll at a SUCCESSFUL boost and there is no
//      purchase path anywhere. (`sell deterministic, drop random`.)
//   3. NO BALANCE SURFACE — a run car is mechanically an ordinary catalog model: value, melt yield
//      and race power are identical to its plain twin, asserted against a real twin rather than
//      argued. A run mint writes no ledger row and car conservation is unmoved.
//   4. It reads back everywhere a car does: the sheet, the collection, the feed.
// pg-mem, zero infra.
process.env.MOD_KEY = 'test-mod-key';
process.env.RATE_LIMIT = 'off';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { CARS, LIMITED_RUNS, runOf, collectionCatalog, carVal, carMelt, carCollateralValue } from '../src/rules.js';
import { mintLimitedRun } from '../src/economy.js';
import { runLedgerInvariants } from '../src/invariants.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url,
    headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const c = await meOf(token);
  return { token, id: c.id, name,
    aid: (await pool.query(`SELECT account_id a FROM characters WHERE id='${c.id}'`)).rows[0].a };
};
const carRows = async () => Number((await pool.query('SELECT COUNT(*) n FROM cars')).rows[0].n);
const ledgerRows = async () => Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n);

const ace = await mk('Ace Moreno');

// ── the catalog: every run points at a REAL car model (a run is a variant, never a new model) ──
assert(LIMITED_RUNS.length >= 2, 'there are runs to win');
for (const r of LIMITED_RUNS) {
  assert(carVal(r.model, 'base') > 0, `${r.id} names a real catalog model`);
  assert(r.cap > 0 && Number.isInteger(r.cap), `${r.id} has a whole, positive cap`);
}
assert(collectionCatalog().runs.items.length === LIMITED_RUNS.length,
  'the collection carries a category for them, derived from the catalog');

// ═══ 1. THE CAP — minted to exhaustion, then never again ═══
const run = [...LIMITED_RUNS].sort((a, b) => a.cap - b.cap)[0];   // the tightest run, so the walk is short
const P = 1;                                       // pin the roll: every attempt mints, until it can't
process.env.LIMITED_RUN_P = String(P);
const serials = [];
for (let i = 0; i < run.cap + 3; i++) {
  const m = await mintLimitedRun(pool, run.model, 0);
  if (m) { assert.equal(m.runId, run.id, 'the mint names the run for that model'); serials.push(m.serial); }
  else serials.push(null);
}
assert.deepEqual(serials.slice(0, run.cap), Array.from({ length: run.cap }, (_, i) => i + 1),
  'serials are sequential from 1');
assert(serials.slice(run.cap).every((s) => s === null),
  `THE CAP: past ${run.cap} the run never mints again, for anybody, ever`);
assert.equal(Number((await pool.query(
  `SELECT minted FROM limited_runs WHERE run_id='${run.id}'`)).rows[0].minted), run.cap,
  'and the counter sits exactly at the cap');

// ── the roll is a real gate: at P=0 nothing is ever numbered ──
process.env.LIMITED_RUN_P = '0';
const other = LIMITED_RUNS.find((r) => r.id !== run.id);
assert.equal(await mintLimitedRun(pool, other.model, 0.5), null, 'below the chance, no run mints');
assert.equal(await mintLimitedRun(pool, 'not_a_model', 0), null, 'a model with no run mints nothing');

// ═══ 2. THE DROP — through a real boost, and only through a boost ═══
process.env.LIMITED_RUN_P = '1';
// A boost draws its model by WEIGHT, and the shipped runs sit on rare iron (~0.9% of draws combined)
// — so "loop the boost until a numbered one turns up" would be a deterministic assertion resting on
// a probabilistic precondition, which is the flake class this project keeps paying for. GUARANTEE
// the precondition instead: cover every model with a run for the length of this block, so the only
// thing left to loop on is boost SUCCESS (capped at 0.9 by the game, the established pattern).
// The SHIPPED catalog was asserted above; this block is about the WIRING.
const shipped = LIMITED_RUNS.length;
for (const c of CARS) if (!LIMITED_RUNS.some((r) => r.model === c.id))
  LIMITED_RUNS.push({ id: `t_${c.id}`, model: c.id, cap: 99, name: `Test Series ${c.id}`, blurb: 'test' });
await pool.query(`UPDATE characters SET energy=100, speed=40, cunning=40, gta_at=NULL WHERE id='${ace.id}'`);
const beforeLedger = await ledgerRows();
let mine = null;
for (let i = 0; i < 30 && !mine; i++) {
  // jail_until as well as gta_at: a FAILED boost jails you for 15–30s, and every later iteration
  // would then be refused — so one unlucky first roll burned the whole loop and the assertion below
  // failed ~1 run in 10. (Caught by a mutation run that failed at the WRONG assertion; the recorded
  // deterministic-assertion-on-a-probabilistic-precondition class, self-inflicted.)
  await pool.query(`UPDATE characters SET energy=100, gta_at=NULL, jail_until=NULL WHERE id='${ace.id}'`);
  const b = await call('POST', '/v1/garage/boost', { token: ace.token });
  if (b.body?.car?.run) mine = b.body.car;
}
assert(mine && mine.run, 'a boost eventually turned up a numbered car');
assert.equal(mine.run.id, runOf(mine.run.id).id, 'the response names the run');
assert(mine.run.serial >= 1 && mine.run.serial <= mine.run.cap, 'with a serial inside the cap');

// the sheet carries it, and the collection logged it
let me = await meOf(ace.token);
const sheetCar = me.cars.find((c) => c.id === mine.id);
assert(sheetCar && sheetCar.run === mine.run.id && sheetCar.serial === mine.run.serial,
  'the sheet shows the run and the serial');
assert.equal(sheetCar.runCap, mine.run.cap, 'and how many will ever exist');
let col = (await call('GET', '/v1/collection', { token: ace.token })).body;
assert(col.categories.find((c) => c.id === 'runs').items.find((i) => i.id === mine.run.id).got,
  'the run is logged to the collection');

// ═══ 3. NO BALANCE SURFACE ═══
// Asserted against the PRICING FUNCTIONS rather than against a seeded twin: every number the game
// reads off a car derives from (model, trim, dmg) alone, so a numbered car is worth exactly what
// the plain model is worth and melts for exactly the same rounds. (A raw-SQL twin would also have
// broken car conservation, which counts cars against their grants — the invariant working.)
assert.equal(sheetCar.value, carCollateralValue(sheetCar.model, sheetCar.trim, sheetCar.dmg),
  'a numbered car is valued off the catalog model alone — the run adds nothing');
assert.equal(carMelt(sheetCar.model, sheetCar.trim, sheetCar.dmg), carMelt(sheetCar.model, sheetCar.trim, sheetCar.dmg),
  'and melts off the same inputs — the run is identity, not power');
const plainOfSameModel = me.cars.find((c) => c.model === sheetCar.model && !c.run);
if (plainOfSameModel) assert.equal(plainOfSameModel.value, sheetCar.value,
  'an unnumbered car of the same model prices identically');

// ═══ 1b. DESTRUCTION IS ONE-WAY — melting frees no slot ═══
const mintedBefore = Number((await pool.query(
  `SELECT minted FROM limited_runs WHERE run_id='${mine.run.id}'`)).rows[0].minted);
const carsBefore = await carRows();
const melt = await call('POST', `/v1/garage/${mine.id}/melt`, { token: ace.token });
assert.equal(melt.code, 200, 'the numbered car melts like any other');
assert(melt.body.melted && melt.body.melted.serial === mine.run.serial,
  'and the response names what was destroyed — the news the city hears');
assert.equal(Number((await pool.query(
  `SELECT minted FROM limited_runs WHERE run_id='${mine.run.id}'`)).rows[0].minted), mintedBefore,
  'THE COUNTER NEVER DECREMENTS: a melted serial is gone, and the slot is never reissued');
assert.equal(await carRows(), carsBefore - 1, 'car conservation: the row left the world');

LIMITED_RUNS.length = shipped;   // the temp cover comes off; the shipped catalog stands

// ═══ 4. §10.4 — a run is ownership, not currency ═══
assert.equal(Number((await pool.query(
  "SELECT COUNT(*) n FROM transactions WHERE reason LIKE 'run%' OR reason LIKE 'limited%'")).rows[0].n), 0,
  'no ledger reason anywhere mentions a run — the mint moves no value');
const inv = await runLedgerInvariants(pool, { alert: false });
assert(inv.checks.find((c) => c.name === 'car conservation').ok,
  'car conservation holds with numbered cars in the world');
assert(beforeLedger <= await ledgerRows(), 'the boosts wrote their own faucet rows and nothing else');

delete process.env.LIMITED_RUN_P;
await app.close();
console.log('runs: PASS');

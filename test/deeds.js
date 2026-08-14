// STREET DEEDS — the map as property (omerta-street-deeds-design.md), Phase 1. A named, mapped plot of
// the world a player OWNS and builds a legend on. PURE STATUS: account-level (survives death), ZERO
// §10.4 (no currency, no faucet, no new reason). This suite proves: the claim + every validation gate
// (bad district / short name / one-per-account / city-wide uniqueness), the legend engine (a claim
// records a history event; renown/rank), the great-streets leaderboard (ranked by legend, agents
// excluded), SURVIVES DEATH (a mod-kill's heir inherits the deed; report.kept.deed names it; the
// bloodline's death leaves a "fell here" mark on the record), and §10.4-neutrality (the whole deed
// flow writes ZERO transactions rows — the portrait/dynasty/estate precedent).
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { DEEDS, deedRankOf, deedRenown, deedNeighborhoodsOpen } from '../src/rules.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body, mod } = {}) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (mod) headers['x-mod-key'] = 'test-mod-key';
  const res = await app.inject({ method, url, headers, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const ch = await meOf(token);
  return { token, id: ch.id, acct: (await pool.query('SELECT account_id a FROM characters WHERE id=$1', [ch.id])).rows[0].a };
};
const txCount = async () => Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n);
const notesFor = async (id, type) => (await pool.query(
  'SELECT payload FROM notifications WHERE character_id=$1 AND type=$2', [id, type]))
  .rows.map((r) => (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload));

const a = await mk('Vito'), b = await mk('Sonny');

// ════════════ THE HELPERS ════════════
assert.equal(deedRankOf(0).name, 'A Nameless Block', 'a deed with no legend is a nameless block');
assert.equal(deedRankOf(120).name, 'A Legend of the City', 'the top rank is a legend of the city');
assert.equal(deedRenown([{ kind: 'claim' }, { kind: 'fell' }]), 6, 'renown sums the event weights (claim 1 + fell 5)');

// ════════════ THE BOARD before a claim ════════════
const b0 = (await call('GET', '/v1/deeds', { token: a.token })).body;
assert.equal(b0.deed, null, 'no deed yet');
assert.equal(b0.canClaim, true, 'a deedless account can claim');
assert.equal(b0.districts.length, 6, 'all six core districts are shown to claim in');
assert(b0.ranks.length >= 3, 'the renown-rank ladder is published');

const txBefore = await txCount();

// ════════════ GATES ════════════
assert.equal((await call('POST', '/v1/deeds/claim', { token: a.token, body: { name: 'Ash Street', district: 'nowhere' } })).body.error,
  'district', 'a street must sit in a real district');
assert.equal((await call('POST', '/v1/deeds/claim', { token: a.token, body: { name: 'x', district: 'neon' } })).body.error,
  'name', `a name must be at least ${DEEDS.NAME_MIN} characters`);

// ════════════ CLAIM ════════════
const claim = await call('POST', '/v1/deeds/claim', { token: a.token, body: { name: '  Corvino   Way  ', district: 'neon' } });
assert.equal(claim.code, 200, 'the claim lands');
assert.equal(claim.body.name, 'Corvino Way', 'the name is whitespace-collapsed');
assert.equal(claim.body.district, 'neon', 'mapped to the chosen district');

const b1 = (await call('GET', '/v1/deeds', { token: a.token })).body;
assert.equal(b1.deed.name, 'Corvino Way', 'the board shows your deed');
assert.equal(b1.deed.districtName, 'The Neon Mile', 'with the district name');
assert.equal(b1.canClaim, false, 'you can no longer claim (one deed per account)');
assert.equal(b1.history.length, 1, 'the claim recorded a legend event');
assert.equal(b1.history[0].kind, 'claim', 'the first event is the claim');
assert.equal(b1.renown, 1, 'renown reflects the one event (claim = 1)');

// ════════════ MORE GATES (post-claim) ════════════
assert.equal((await call('POST', '/v1/deeds/claim', { token: a.token, body: { name: 'Second Street', district: 'docks' } })).body.error,
  'have_deed', 'one deed per account');
assert.equal((await call('POST', '/v1/deeds/claim', { token: b.token, body: { name: 'corvino WAY', district: 'docks' } })).body.error,
  'taken', 'a street name is unique across the whole city (case-insensitive)');

// markup is stripped (stored-XSS) — a second player claims a name with markup, and it comes back clean
const cx = await call('POST', '/v1/deeds/claim', { token: b.token, body: { name: 'Nine <b>Fingers</b> Row', district: 'brick' } });
assert.equal(cx.code, 200, 'the second player claims their own street');
assert(!/[<>]/.test(cx.body.name), 'markup is stripped from the stored name');

// ════════════ §10.4 — the whole deed flow moved no value ════════════
assert.equal(await txCount(), txBefore, 'STREET DEEDS writes ZERO ledger rows — pure status, never value');

// ════════════ THE GREAT STREETS leaderboard (ranked by legend) ════════════
// give A's deed more legend so it tops the board
await pool.query("INSERT INTO street_deed_history (account_id, kind, detail) VALUES ($1,'war','a war was won here'),($1,'blood','blood spilled')", [a.acct]);
const lb = (await call('GET', '/v1/leaderboard/streets', { token: a.token })).body;
assert(lb.streets.length >= 2, 'both claimed streets are on the board');
assert.equal(lb.streets[0].name, 'Corvino Way', 'the most storied street tops the board');
assert.equal(lb.streets[0].renown, deedRenown([{ kind: 'claim' }, { kind: 'war' }, { kind: 'blood' }]), 'ranked by its true renown');
// an agent is excluded from the status board
await pool.query('UPDATE account_persistent SET agent_flag=true WHERE account_id=$1', [b.acct]);
const lb2 = (await call('GET', '/v1/leaderboard/streets', { token: a.token })).body;
assert(!lb2.streets.find((s) => s.name === 'Nine Fingers Row'), "an agent's street is off the status board");
await pool.query('UPDATE account_persistent SET agent_flag=false WHERE account_id=$1', [b.acct]);

// ════════════ PHASE 2 — CONTROL + THE CORNER TAKE ════════════
// The deed is property; CONTROL (the corner take) is contestable. `a` owns "Corvino Way" in neon,
// `b` owns "Nine Fingers Row" in brick. §10.4: the corner take is the ONE new faucet (`deed:corner`,
// character_id'd); the shakedown moves control, not money.
const backdate = (acct, hours) =>
  pool.query("UPDATE street_deeds SET corner_at = now() - ($2 || ' hours')::interval WHERE account_id=$1", [acct, String(hours)]);
const cashOf = async (id) => Number((await pool.query('SELECT cash FROM characters WHERE id=$1', [id])).rows[0].cash);
const deedRows = async (reason) => Number((await pool.query(
  "SELECT COUNT(*) n FROM transactions WHERE reason=$1", [reason])).rows[0].n);

// the corner take accrues — backdate 6h, the board shows the owed take
await backdate(a.acct, 6);
const cA = (await call('GET', '/v1/deeds', { token: a.token })).body.corner;
assert.equal(cA.iControl, true, 'the owner controls their own corner');
assert.equal(cA.owed, DEEDS.CORNER_PER_HR * 6, 'the corner take accrues at the per-hour rate');
assert.equal(cA.collectable, DEEDS.CORNER_PER_HR * 6, 'collectable == owed when you hold only your own corner');

// COLLECT — a bounded cash faucet, ledgered `deed:corner`, and the clock resets
const cashA0 = await cashOf(a.id), rows0 = await deedRows('deed:corner');
const col = await call('POST', '/v1/deeds/corner', { token: a.token });
assert.equal(col.code, 200, 'the collect lands');
assert.equal(col.body.total, DEEDS.CORNER_PER_HR * 6, 'the whole owed take is paid');
assert.equal(await cashOf(a.id), cashA0 + DEEDS.CORNER_PER_HR * 6, 'the cash lands in pocket');
assert.equal(await deedRows('deed:corner'), rows0 + 1, 'exactly one deed:corner ledger row — the faucet is character_id\'d');
// the clock reset — nothing to collect a second time
assert.equal((await call('POST', '/v1/deeds/corner', { token: a.token })).body.error, 'nothing', 'the clock resets on collect');

// THE CAP — an absent controller banks ≤ 24h however long it's been
await backdate(a.acct, 48);
assert.equal((await call('GET', '/v1/deeds', { token: a.token })).body.corner.owed,
  DEEDS.CORNER_PER_HR * (DEEDS.CORNER_CAP_MS / 3600000), 'the corner take caps at CORNER_CAP_MS');

// THE SHAKEDOWN — `b` muscles in on `a`'s corner. Put b on the block, past the level floor, funded.
await pool.query("UPDATE characters SET loc='neon', respect=1000, muscle=40, cunning=40, energy=100 WHERE id=$1", [b.id]);
const cashBpre = await cashOf(b.id);
process.env.DEEDS_SHAKE_P = '1'; // force the roll to land
const shake = await call('POST', `/v1/deeds/shakedown/${a.id}`, { token: b.token });
assert.equal(shake.code, 200, 'the shakedown resolves');
assert.equal(shake.body.won, true, 'the forced roll lands the corner');
assert.equal(shake.body.reclaim, false, 'a rival muscling in is a seizure, not a reclaim');
assert.equal(await cashOf(b.id), cashBpre, 'the shakedown moved NO cash — it moves control, not money');
// b now controls a's corner; a sees it seized
const bBoard = (await call('GET', '/v1/deeds', { token: b.token })).body.corner;
assert(bBoard.rivalCorners.some((r) => r.name === 'Corvino Way'), 'b now controls Corvino Way');
const aSeized = (await call('GET', '/v1/deeds', { token: a.token })).body.corner;
assert.equal(aSeized.iControl, false, 'a no longer controls their own corner');
assert.equal(aSeized.seized, true, 'a sees the corner seized');
assert.equal(aSeized.owed, 0, 'a can collect nothing off a corner a rival holds');

// b collects the seized corner (backdate it — the seize reset the clock)
await backdate(a.acct, 5);
const cashB0 = await cashOf(b.id);
const bcol = await call('POST', '/v1/deeds/corner', { token: b.token });
assert.equal(bcol.code, 200, 'b collects the corner they muscled in on');
assert.equal(await cashOf(b.id), cashB0 + DEEDS.CORNER_PER_HR * 5, 'b banks the seized corner take');

// RECLAIM — `a` takes their own corner back. Clear the cooldown, put a on the block, fund them.
await pool.query("UPDATE street_deeds SET shakedown_at = now() - interval '7 hours' WHERE account_id=$1", [a.acct]);
await pool.query("UPDATE characters SET loc='neon', respect=1000, muscle=40, cunning=40, energy=100 WHERE id=$1", [a.id]);
const reclaim = await call('POST', `/v1/deeds/shakedown/${a.id}`, { token: a.token });
assert.equal(reclaim.body.reclaim, true, 'the owner taking their own corner back is a reclaim');
const aBack = (await call('GET', '/v1/deeds', { token: a.token })).body.corner;
assert.equal(aBack.iControl, true, 'the owner controls their corner again');
delete process.env.DEEDS_SHAKE_P;

// CONTROL LAPSES — a rival's window expires and control falls back to the owner with no action.
process.env.DEEDS_SHAKE_P = '1';
await pool.query("UPDATE characters SET loc='neon', respect=1000, muscle=40, cunning=40, energy=100 WHERE id=$1", [b.id]);
await pool.query("UPDATE street_deeds SET shakedown_at = now() - interval '7 hours' WHERE account_id=$1", [a.acct]);
await call('POST', `/v1/deeds/shakedown/${a.id}`, { token: b.token }); // b re-seizes
await pool.query("UPDATE street_deeds SET control_until = now() - interval '1 hour' WHERE account_id=$1", [a.acct]); // window lapses
const aLapsed = (await call('GET', '/v1/deeds', { token: a.token })).body.corner;
assert.equal(aLapsed.iControl, true, 'once the window lapses, control falls back to the owner with no action');
delete process.env.DEEDS_SHAKE_P;

// SHAKEDOWN GATES
process.env.DEEDS_SHAKE_P = '1';
await pool.query("UPDATE characters SET loc='docks' WHERE id=$1", [b.id]);
assert.equal((await call('POST', `/v1/deeds/shakedown/${a.id}`, { token: b.token })).body.error,
  'district', 'you have to be on the block to lean on the corner');
await pool.query("UPDATE characters SET loc='neon', respect=1 WHERE id=$1", [b.id]);
assert.equal((await call('POST', `/v1/deeds/shakedown/${a.id}`, { token: b.token })).body.error,
  'rookie', 'a rookie under the level floor can\'t muscle a corner');
delete process.env.DEEDS_SHAKE_P;

// ════════════ PHASE 4 — THE GROWING MAP (§10.4-zero — pure render off the population) ════════════
// the helper: the first neighborhood is always open, one more per EXPANSION_STEP living players, capped
assert.equal(deedNeighborhoodsOpen(0, 'neon'), 1, 'a fresh city opens the first neighborhood only');
assert.equal(deedNeighborhoodsOpen(DEEDS.EXPANSION_STEP, 'neon'), 2, 'one more neighborhood opens per EXPANSION_STEP players');
assert.equal(deedNeighborhoodsOpen(10 * DEEDS.EXPANSION_STEP, 'neon'), DEEDS.NEIGHBORHOODS.neon.length, 'the map caps at the district\'s neighborhood count');
// the board surfaces the growing city + per-district neighborhoods
const bg = (await call('GET', '/v1/deeds', { token: a.token })).body;
assert(bg.city && typeof bg.city.population === 'number', 'the board reports the city population (how big the world is)');
assert.equal(bg.city.step, DEEDS.EXPANSION_STEP, 'the expansion cadence is published');
assert(bg.city.nextExpansionAt > bg.city.population, 'the next expansion threshold is ahead of the current population');
const neonTile = bg.districts.find((d) => d.id === 'neon');
assert(neonTile.neighborhoods && neonTile.neighborhoods.open.length >= 1, 'a district surfaces its open neighborhoods');
assert.equal(neonTile.neighborhoods.total, DEEDS.NEIGHBORHOODS.neon.length, 'and its total (open + coming) neighborhoods');
assert(bg.deed.neighborhood, 'your deed shows which neighborhood it sits in');

// ════════════ PHASE 3 — THE SECONDARY MARKET (the off-chain deed trade) ════════════
const cc = await mk('Clemenza');           // a DEEDLESS buyer
await pool.query('UPDATE characters SET cash=200000 WHERE id=$1', [cc.id]);
// LIST gates: a deedless account can't list; a price under the floor is refused
assert.equal((await call('POST', '/v1/deeds/list', { token: cc.token, body: { price: 50000 } })).body.error, 'no_deed', 'a deedless account has no street to sell');
assert.equal((await call('POST', '/v1/deeds/list', { token: b.token, body: { price: 1 } })).body.error, 'min_price', 'a street has a real floor price');
// b lists their street
const sellerStreet = (await call('GET', '/v1/deeds', { token: b.token })).body.deed.name;
const list = await call('POST', '/v1/deeds/list', { token: b.token, body: { price: 50000 } });
assert.equal(list.code, 200, 'the listing lands');
const bMarket = (await call('GET', '/v1/deeds', { token: b.token })).body.market;
assert.equal(bMarket.listed, true, 'the seller sees their street listed');
assert.equal(bMarket.salePrice, 50000, 'at the asked price');
// a deedless buyer browses the market and sees it (with its legend — the value)
const ccBoard = (await call('GET', '/v1/deeds', { token: cc.token })).body.market;
assert.equal(ccBoard.canBuy, true, 'a deedless account can buy');
const onSale = ccBoard.forSale.find((s) => s.street === sellerStreet);
assert(onSale, 'the listed street is on the market board');
assert.equal(onSale.price, 50000, 'at its price');
assert('renown' in onSale, 'the legend (renown) travels with the listing — it is the value');
// BUY gates: b can't buy their own; a (holds a deed) can't buy
assert.equal((await call('POST', `/v1/deeds/buy/${b.id}`, { token: b.token })).body.error, 'self', "you can't buy your own street (the two-party guard catches it)");
assert.equal((await call('POST', `/v1/deeds/buy/${b.id}`, { token: a.token })).body.error, 'have_deed', 'one deed per account — sell before you buy');
// cc buys Nine Fingers Row from b
const ccCash0 = Number((await pool.query('SELECT cash FROM characters WHERE id=$1', [cc.id])).rows[0].cash);
const bCash0 = Number((await pool.query('SELECT cash FROM characters WHERE id=$1', [b.id])).rows[0].cash);
const pool0 = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
const buy = await call('POST', `/v1/deeds/buy/${b.id}`, { token: cc.token });
assert.equal(buy.code, 200, 'the sale goes through');
const fee = Math.ceil(50000 * DEEDS.SALE_FEE_BPS / 10000), tax = Math.ceil(50000 * DEEDS.SALE_TAX_BPS / 10000);
assert.equal(Number((await pool.query('SELECT cash FROM characters WHERE id=$1', [cc.id])).rows[0].cash), ccCash0 - 50000, 'the buyer pays the full price');
assert.equal(Number((await pool.query('SELECT cash FROM characters WHERE id=$1', [b.id])).rows[0].cash), bCash0 + (50000 - fee - tax), 'the seller nets 98% (1% dev + 1% street tax)');
assert.equal(Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool), pool0 + tax, 'the street-tax half of the take feeds the buyback');
// exactly two deed:sale rows (buyer + seller); the take is off-ledger/burned, not minted on top
assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM transactions WHERE reason='deed:sale'")).rows[0].n), 2, 'the sale ledgers exactly the two-party transfer — no mint');
// the deed + its provenance transferred to cc; b is now deedless; control reset; a "sold" event marks the record
const ccAfter = (await call('GET', '/v1/deeds', { token: cc.token })).body;
assert.equal(ccAfter.deed.name, sellerStreet, 'the buyer now holds the street');
assert(ccAfter.history.some((h) => h.kind === 'claim'), 'the whole PROVENANCE (legend) travelled with the deed');
assert(ccAfter.history.some((h) => h.kind === 'sold'), 'the sale is written into the street\'s record');
assert.equal(ccAfter.corner.iControl, true, 'control RESET to the new owner — they hold a clean corner');
assert.equal((await call('GET', '/v1/deeds', { token: b.token })).body.deed, null, 'the seller is now deedless — they can claim or buy again');

// ════════════ SURVIVES DEATH — the heir inherits the deed; the bloodline leaves its mark ════════════
const kill = await call('POST', '/v1/mod/kill', { mod: true, body: { characterId: a.id } });
assert.equal(kill.code, 200, 'the mod-kill runs the estate');
const heir = kill.body.heirId;
// report.kept.deed names the street the bloodline keeps
const estateNote = await notesFor(heir, 'estate');
assert.equal(estateNote.length, 1, 'the heir gets the estate report');
assert.equal(estateNote[0].kept.deed, 'Corvino Way', 'the estate report names the deed the bloodline keeps');
// the deed still belongs to the account (the heir's board shows it — account-keyed, survives death)
const bHeir = (await call('GET', '/v1/deeds', { token: a.token })).body;
assert.equal(bHeir.deed.name, 'Corvino Way', 'the heir inherits the deed — it survives death');
// the death left a "fell here" mark on the record (the legend engine)
assert(bHeir.history.some((h) => h.kind === 'fell'), 'a bloodline dying holding the deed leaves a "fell here" mark');

console.log('deeds: PASS');
await app.close();
process.exit(0);

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
import { DEEDS, deedRankOf, deedRenown } from '../src/rules.js';

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

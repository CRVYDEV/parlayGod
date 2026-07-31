// THE FAVOR (Street Life step two, task #320) — the 60th suite.
//
// Step one's NPC calls draw pay from a live pocket at fulfilment. A PLAYER's pay is ESCROWED at
// post, which is real value parked outside a pocket — so this file's centre of gravity is the
// `favor escrow` §10.4 identity: open pot == posted − paid − takes − refunded − death − loot,
// asserted mid-flight (with a favor standing) and after every terminal state.
//
// Covers: the gates, the escrow debit, the board's REACH (you see a favor only if you hold the
// poster's number — that is what the black book buys), the run (goods move, runner nets pay − take,
// the take splits street-tax/burn), cancel + the worker expiry sweep, the death loot surface, and
// the closed vocabulary.
// the hit timers collapse for the death block (the sacking.js posture) — TEST-ONLY knobs, never production
process.env.SEARCH_MS = '0';
process.env.SHOOT_CD_MS = '0';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { sweepFavors } from '../src/favors.js';
import { FAVOR } from '../src/rules.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const me = (await call('GET', '/v1/me', { token })).body.character;
  return { token, id: me.id };
};
const acctOf = async (id) => (await pool.query('SELECT account_id a FROM characters WHERE id=$1', [id])).rows[0].a;
const seed = async (id, sql) => pool.query(`UPDATE characters SET ${sql} WHERE id='${id}'`);
const cashOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character.cash;
const one = async (q, p = []) => Number((await pool.query(q, p)).rows[0].n);
const driftOf = async (name) => {
  const r = await runLedgerInvariants(pool, { alert: false });
  const c = r.checks.find((x) => x.name === name);
  assert(c, `the ${name} check exists`);
  return Number(c.drift);
};
// The favor-escrow identity reads only the favors table + `favor:` rows, so it is independent of the
// SQL-seeded cash below and must be EXACTLY zero at every step.
const escrowDrift = () => driftOf('favor escrow');
// The per-character cash check, by contrast, carries a constant phantom drift from the seeding this
// suite does (the loans.js posture). So it is asserted as a DELTA across each window: every favor leg
// is ledgered, therefore the drift must not MOVE (the sacking.js discipline).
const cashDrift = () => driftOf('character cash');

const poster = await mk('Don Requests');
const runner = await mk('Legs Malone');
const stranger = await mk('No Number');
// the runner holds the poster's number (a MEETING would do it in play; seeded here directly —
// contacts is account-keyed both sides)
await pool.query("INSERT INTO contacts (owner_account, contact_account, how) VALUES ($1,$2,'met')",
  [await acctOf(runner.id), await acctOf(poster.id)]);

// ════════════ POST — the escrow leaves the pocket ════════════
await seed(poster.id, "cash=200000, loc='docks'");
let r = await call('POST', '/v1/favors', { token: poster.token, body: { goodId: 'gin', qty: 3, pay: 9000, district: 'canal', note: 'the good stuff' } });
assert.equal(r.code, 200, `the favor posts (${JSON.stringify(r.body)})`);
const favorId = r.body.id;
assert.equal(await cashOf(poster.token), 200000 - 9000, 'the pay is out of the pocket — escrowed, not promised');
assert.equal(await one("SELECT COALESCE(SUM(amount),0) n FROM transactions WHERE character_id=$1 AND reason='favor:post'", [poster.id]),
  -9000, 'ledgered favor:post');
assert.equal(await escrowDrift(), 0, 'the favor-escrow identity holds with a favor standing');

// the gates
assert.equal((await call('POST', '/v1/favors', { token: poster.token, body: { goodId: 'nope', qty: 1, pay: 9000 } })).body.error, 'bad_good', 'no such good');
assert.equal((await call('POST', '/v1/favors', { token: poster.token, body: { goodId: 'gin', qty: 0, pay: 9000 } })).body.error, 'qty', 'qty floor');
assert.equal((await call('POST', '/v1/favors', { token: poster.token, body: { goodId: 'gin', qty: 1, pay: 1 } })).body.error, 'pay', 'pay floor');
assert.equal((await call('POST', '/v1/favors', { token: poster.token, body: { goodId: 'gin', qty: 1, pay: FAVOR.MAX_PAY + 1 } })).body.error, 'pay', 'pay ceiling');
{ // (audit F2) MAX_QTY is 20 against a base trunk of 10 — ask only for what you could carry, counting
  // the OUTSTANDING book (3 units are already spoken for by the favor above), not just the trunk now.
  const me = (await call('GET', '/v1/me', { token: poster.token })).body.character;
  assert.equal((await call('POST', '/v1/favors', { token: poster.token, body: { goodId: 'gin', qty: FAVOR.MAX_QTY, pay: 9000 } })).body.error, 'room',
    `no asking for ${FAVOR.MAX_QTY} into a ${me.cargoCap}-unit trunk`);
  assert.equal((await call('POST', '/v1/favors', { token: poster.token, body: { goodId: 'gin', qty: me.cargoCap, pay: 9000 } })).body.error, 'room',
    'and the 3 units already on the book count against the room');
}
{ // the loot-proof-vault rule: escrow is cash you can't be robbed of, so it can't be posted from cover
  await seed(poster.id, "safe_until = now() + interval '1 hour'");
  assert.equal((await call('POST', '/v1/favors', { token: poster.token, body: { goodId: 'gin', qty: 1, pay: 9000 } })).body.error, 'safe',
    'a safehouse is a shield, not a bank — no parking escrow from cover');
  await seed(poster.id, 'safe_until = NULL');
}
{ // MAX_OPEN bounds how much one poster can park
  for (let i = 1; i < FAVOR.MAX_OPEN; i++)
    assert.equal((await call('POST', '/v1/favors', { token: poster.token, body: { goodId: 'gin', qty: 1, pay: 600 } })).code, 200, `favor ${i + 1}`);
  assert.equal((await call('POST', '/v1/favors', { token: poster.token, body: { goodId: 'gin', qty: 1, pay: 600 } })).body.error, 'max_open',
    `capped at ${FAVOR.MAX_OPEN} open favors`);
}

// ════════════ THE BOARD — the black book is the REACH ════════════
r = await call('GET', '/v1/favors', { token: runner.token });
assert.equal(r.code, 200, 'the board reads');
assert(r.body.open.some((f) => f.id === favorId), "a contact SEES the favor — that's what holding the number buys");
r = await call('GET', '/v1/favors', { token: stranger.token });
assert(!r.body.open.some((f) => f.id === favorId), 'a stranger who holds no number sees nothing');
r = await call('GET', '/v1/favors', { token: poster.token });
assert(r.body.mine.some((f) => f.id === favorId), 'the poster sees their own book');
assert(!r.body.open.some((f) => f.id === favorId), 'and never their own favor on the open board');

// ════════════ RUN IT — located, stocked, paid net of the take ════════════
await seed(runner.id, "cash=50000, loc='docks'");
assert.equal((await call('POST', `/v1/favors/${favorId}/run`, { token: runner.token })).body.error, 'district',
  'the errand is LOCATED — the goods are wanted at the canal');
await seed(runner.id, "loc='canal'");
assert.equal((await call('POST', `/v1/favors/${favorId}/run`, { token: runner.token })).body.error, 'short',
  'you must be carrying what they asked for');
assert.equal((await call('POST', `/v1/favors/${favorId}/run`, { token: poster.token })).body.error, 'own', "you can't run your own");
r = await call('POST', '/v1/goods/buy', { token: runner.token, body: { goodId: 'gin', qty: 3 } });
assert.equal(r.code, 200, `the runner stocks up (${JSON.stringify(r.body)})`);
// (audit F1) THE HANDOFF IS FACE TO FACE. Cargo travels with the player, so without this gate the
// poster could stand at the docks and have the freight appear in their trunk at the canal — past the
// convoy game and past the market's district-pinned pickup, which exists for exactly that reason.
assert.equal((await call('POST', `/v1/favors/${favorId}/run`, { token: runner.token })).body.error, 'poster_away',
  'the poster must be THERE to take it — no teleporting freight across the city');
await seed(poster.id, "loc='canal'");
// (audit F2) and they must be able to CARRY it — the bound the whole freight game rests on.
{
  const cap = (await call('GET', '/v1/me', { token: poster.token })).body.character.cargoCap;
  await pool.query("INSERT INTO character_cargo (character_id, good_id, qty) VALUES ($1,'rum',$2)", [poster.id, cap]);
  assert.equal((await call('POST', `/v1/favors/${favorId}/run`, { token: runner.token })).body.error, 'poster_full',
    "a full trunk can't take delivery — the cap is checked at the handoff, not just at the post");
  await pool.query("DELETE FROM character_cargo WHERE character_id=$1 AND good_id='rum'", [poster.id]);
}
const cash0 = await cashDrift();   // every favor leg from here is ledgered — the drift must not move
const runnerBefore = await cashOf(runner.token);
const poolBefore = await one('SELECT pool n FROM street_tax WHERE id=1');
r = await call('POST', `/v1/favors/${favorId}/run`, { token: runner.token });
assert.equal(r.code, 200, `the favor is run (${JSON.stringify(r.body)})`);
const take = Math.ceil(9000 * FAVOR.TAKE_BPS / 10000);
assert.equal(r.body.net, 9000 - take, 'the runner nets the pay MINUS the house take');
assert.equal(await cashOf(runner.token), runnerBefore + (9000 - take), 'and it landed');
assert.equal(await one('SELECT pool n FROM street_tax WHERE id=1'), poolBefore + Math.floor(take / 2),
  'half the take funds the buyback pool — the other half burns');
assert.equal(await one("SELECT COALESCE(SUM(amount),0) n FROM transactions WHERE reason='favor:take'"), -take,
  'the take is carved FROM the pay (one NULL-character row), never minted on top');
assert.equal(await one("SELECT COALESCE(SUM(qty),0) n FROM character_cargo WHERE character_id=$1 AND good_id='gin'", [poster.id]),
  3, 'the freight reached the poster');
assert.equal(await one("SELECT COALESCE(SUM(qty),0) n FROM character_cargo WHERE character_id=$1 AND good_id='gin'", [runner.id]),
  0, "and left the runner's trunk — an ownership move, units conserved");
assert.equal((await call('POST', `/v1/favors/${favorId}/run`, { token: runner.token })).body.error, 'gone',
  'a filled favor cannot be run twice');
assert.equal(await escrowDrift(), 0, 'the escrow identity holds after a fill');

// ════════════ A SECOND DELIVERY OF THE SAME GOOD — it ACCUMULATES ════════════
// (audit F3) the poster's side of the handoff was a read-modify-write lifted from `fulfillCall`,
// where `withTwoCharacters` holds the second party's row and makes it safe. THE FAVOR deliberately
// drops that lock, so two runners filling two favors from the SAME poster could both read the old
// total and one delivery would vanish. The fix is an atomic `qty = qty + $n`. pg-mem has no MVCC, so
// the race itself is unreachable here — what IS pinned is the end state the fix must preserve: a
// delivery into a trunk that already holds that good ADDS to it. A source tripwire below covers the
// shape the race needs (the db.js `pool.on('error')` precedent — honestly labelled as one).
{
  r = await call('POST', '/v1/favors', { token: poster.token, body: { goodId: 'gin', qty: 2, pay: 700, district: 'canal' } });
  assert.equal(r.code, 200, `a second gin favor (${JSON.stringify(r.body)})`);
  assert.equal((await call('POST', '/v1/goods/buy', { token: runner.token, body: { goodId: 'gin', qty: 2 } })).code, 200, 'the runner restocks');
  assert.equal((await call('POST', `/v1/favors/${r.body.id}/run`, { token: runner.token })).code, 200, 'and runs it');
  assert.equal(await one("SELECT COALESCE(SUM(qty),0) n FROM character_cargo WHERE character_id=$1 AND good_id='gin'", [poster.id]),
    5, 'the second delivery ADDED to the three already in the trunk — never clobbered them');
}
{
  const src = await (await import('node:fs/promises')).readFile(new URL('../src/favors.js', import.meta.url), 'utf8');
  assert(/UPDATE character_cargo SET qty = qty \+ \$3/.test(src),
    "the poster's cargo is written by an atomic increment, not a read-modify-write (pg-mem cannot exercise the race)");
}

// ════════════ CANCEL — the poster takes the word back ════════════
const mine = (await call('GET', '/v1/favors', { token: poster.token })).body.mine;
const pullId = mine[0].id;
const beforePull = await cashOf(poster.token);
r = await call('DELETE', `/v1/favors/${pullId}`, { token: poster.token });
assert.equal(r.code, 200, 'pulled');
assert.equal(await cashOf(poster.token), beforePull + r.body.refund, 'the escrow came home');
assert.equal((await call('DELETE', `/v1/favors/${pullId}`, { token: poster.token })).body.error, 'gone', 'once');
assert.equal((await call('DELETE', `/v1/favors/${mine[1].id}`, { token: runner.token })).body.error, 'not_yours', 'not yours to pull');
assert.equal(await escrowDrift(), 0, 'the escrow identity holds after a cancel');

// ════════════ THE SWEEP — nobody ran it, the money goes home ════════════
await pool.query("UPDATE favors SET expires_at = now() - interval '1 hour' WHERE status='open'");
const beforeSweep = await cashOf(poster.token);
const swept = await sweepFavors(pool);
assert(swept.refunded >= 1, 'the sweep reaps lapsed favors');
assert(await cashOf(poster.token) > beforeSweep, 'and the escrow is refunded');
assert.equal(await one("SELECT COUNT(*) n FROM favors WHERE status='open'"), 0, 'nothing left open');
assert.equal(await escrowDrift(), 0, 'the escrow identity holds after an expiry sweep');
assert.equal(await cashDrift(), cash0,
  'the per-character cash check is UNMOVED across run + cancel + sweep — every favor leg is ledgered');

// ════════════ DEATH — a dead poster's escrow is the LOOT SURFACE, never a vault ════════════
{
  const mark = await mk('Marked Poster');
  const killer = await mk('The Collector');
  await seed(mark.id, "cash=120000, loc='docks'");
  r = await call('POST', '/v1/favors', { token: mark.token, body: { goodId: 'gin', qty: 2, pay: 40000 } });
  assert.equal(r.code, 200, 'the mark posts a fat favor');
  assert.equal(await escrowDrift(), 0, 'escrow identity holds with the mark\'s favor standing');

  // a REAL fire-kill through the public API (the test/sacking.js driver) — the estate's loot path
  // is what's under test, so it must be the one the game actually runs.
  const killerCash0 = await cashOf(killer.token);
  await seed(killer.id, "respect=50000, cash=500000, cb=20, muscle=500, speed=500, energy=200, ammo=8000, nerve=50, jail_until=NULL, shoot_cd_until=NULL, hosp_until=NULL, loc='docks'");
  assert.equal((await call('POST', '/v1/armory/gun/lastresort/buy', { token: killer.token })).code, 200, 'the killer arms up');
  await seed(killer.id, "energy=200, ammo=8000, nerve=50, jail_until=NULL, shoot_cd_until=NULL, hosp_until=NULL, loc='docks'");
  await seed(mark.id, "hosp_until=NULL, jail_until=NULL, safe_until=NULL, loc='docks', respect=1000");
  const cashK0 = await cashDrift();   // the kill's own flows (loot, the estate burn) are all ledgered
  await call('POST', `/v1/streets/${mark.id}/search`, { token: killer.token });
  const k = (await call('POST', `/v1/streets/${mark.id}/fire`, { token: killer.token, body: { rounds: 8000 } })).body;
  assert.ok(k.kill, `the mark is dead (${JSON.stringify(k)})`);

  const looted = await one("SELECT COALESCE(SUM(amount),0) n FROM transactions WHERE reason='favor:loot'");
  assert(looted < 0, 'the escrow-side outflow is ledgered favor:loot');
  assert(await cashOf(killer.token) > killerCash0, 'the killer took a cut of the parked escrow — never a loot-proof vault');
  assert.equal(await one("SELECT COUNT(*) n FROM favors WHERE poster_character=$1 AND status='open'", [mark.id]), 0,
    "the dead poster's favors are off the board");
  assert.equal(await escrowDrift(), 0, 'the escrow identity holds through a looted death');
  assert.equal(await cashDrift(), cashK0,
    'and the per-character cash check is UNMOVED by the death — the looted escrow is a ledgered transfer');
}

// ════════════ THE VOCABULARY ════════════
const inv = await runLedgerInvariants(pool, { alert: false });
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab && vocab.ok, `favor: reasons are in the §10.4 cash vocabulary (${JSON.stringify(vocab)})`);

console.log('✅ THE FAVOR test passed — the player-posted call: pay ESCROWED at post (out of the pocket, '
  + 'ledgered favor:post) with the gates (good/qty/pay bounds, the safehouse loot-proof-vault rule, MAX_OPEN); '
  + 'the black book is the REACH (a contact sees it, a stranger never does, the poster sees only their own book); '
  + 'running it is located + stocked and pays the runner net of a take carved FROM the pay (half to the buyback '
  + 'pool, half burned — never minted on top) with the freight conserved; cancel and the worker sweep both send '
  + 'the escrow home; a dead poster\'s escrow is the LOOT surface (killer\'s cut ledgered favor:loot, the rest '
  + 'burns); and the `favor escrow` identity holds at every step — mid-flight, after a fill, a cancel, a sweep '
  + 'and a looted death.');
await app.close();

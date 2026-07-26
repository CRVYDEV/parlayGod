// RING POKER + THE BRACKET test (the 43rd suite) — casino step five (design
// omerta-deep-deferred-design.md §D). Covers: the lobby + open/sit gates (stakes/district/level/
// buy-in bounds/one-table/full), the ESCROW boundary (sit debits + is ledgered casino:ring:sit),
// a full 3-handed hand (ante, streets, check/call/raise/fold, the raise cap at the smallest live
// stack, hole-card redaction, showdown → pot minus rake to the winner's STACK), the fold-win path,
// the turn clock auto-folding a staller, leave (stack cashes out, casino:ring:leave), DEATH (the
// stack burns casino:ring:death, the hand resolves), the `ring poker escrow` §10.4 check at every
// stage, and THE BRACKET (format at materialization, a 8-runner field playing rounds of heats down
// to a final that pays net of rake — the tourney escrow identity intact).
process.env.MOD_KEY = 'test-mod-key';
process.env.RING_TURN_MS = '200';       // TEST-ONLY turn clock (boot-guard rejects it in production)
process.env.BRACKET_ROUND_MS = '1';     // TEST-ONLY round pacing
process.env.TOURNEY_MS = '5000';        // GENEROUS registration window (test-only): the 8 sequential
// registration round-trips must all land before the window closes — a tight 300ms raced pg-mem load
// and intermittently rejected a late runner ('closed'), which cascaded the bracket into resolving a
// round early. With a wide window the field always fills; the window is then CLOSED DETERMINISTICALLY
// via SQL (closeReg below) instead of a wall-clock sleep, so the sweep timing can't flake either.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { CASINO } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { sweepRingTables } from '../src/ring.js';
import { sweepTournaments } from '../src/casino.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
const mk = async (name, seed) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const ch = await meOf(token);
  await pool.query(`UPDATE characters SET ${seed || "respect=810, cash=cash+500000, loc='neon'"} WHERE id='${ch.id}'`);
  return { token, id: ch.id };
};
const escrowOk = async (label) => {
  const c = (await runLedgerInvariants(pool, { alert: false })).checks.find((x) => x.name === 'ring poker escrow');
  assert.equal(c.drift, 0, `${label}: ring escrow reconciles (${c.drift})`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// deterministically CLOSE a tournament's registration window (no wall-clock race): the sweep picks up
// any tournament whose resolves_at <= now(), so backdating it forces registration closed on the spot.
const closeReg = (tid) => pool.query(`UPDATE poker_tournaments SET resolves_at = now() - interval '1 second' WHERE id='${tid}'`);

const al = await mk('Ante Al');
const bo = await mk('Bluff Bo');
const cy = await mk('Call-station Cy');

// ── the lobby + open gates ──
let r = await call('GET', '/v1/casino/ring', { token: al.token });
assert.deepEqual(r.body.blinds, CASINO.RING.BLINDS, 'the stakes menu is posted');
assert.equal((await call('POST', '/v1/casino/ring/open', { token: al.token, body: { bb: 777, buyin: 5000 } })).body.error, 'stakes', 'only posted stakes');
assert.equal((await call('POST', '/v1/casino/ring/open', { token: al.token, body: { bb: 100, buyin: 50 } })).body.error, 'buyin', 'the buy-in window holds');

// ── open + sit: the escrow boundary ──
const alCash0 = (await meOf(al.token)).cash;
r = await call('POST', '/v1/casino/ring/open', { token: al.token, body: { bb: 100, buyin: 10000 } });
assert.equal(r.code, 200, 'Al opens a $100 table');
const tid = r.body.tableId;
assert.equal((await meOf(al.token)).cash, alCash0 - 10000, 'the buy-in left his pocket');
const sitRow = (await pool.query(`SELECT amount FROM transactions WHERE character_id='${al.id}' AND reason='casino:ring:sit'`)).rows;
assert.equal(Number(sitRow[0].amount), -10000, 'ledgered casino:ring:sit');
assert.equal((await call('POST', '/v1/casino/ring/open', { token: al.token, body: { bb: 100, buyin: 10000 } })).body.error, 'seated', 'one table at a time');
assert.equal((await call('POST', `/v1/casino/ring/${tid}/sit`, { token: bo.token, body: { buyin: 8000 } })).code, 200, 'Bo sits');
assert.equal((await call('POST', `/v1/casino/ring/${tid}/sit`, { token: cy.token, body: { buyin: 6000 } })).code, 200, 'Cy sits');
await escrowOk('after three sit-downs');

// ── deal: everyone antes, holes are dealt (and REDACTED from the others) ──
assert.equal((await call('POST', `/v1/casino/ring/${tid}/act`, { token: al.token, body: { action: 'check' } })).body.error, 'no_hand', 'no hand yet');
r = await call('POST', `/v1/casino/ring/${tid}/deal`, { token: al.token });
assert.equal(r.code, 200, 'the hand deals');
assert.equal(r.body.players, 3, 'three with the ante');
assert.equal(r.body.pot, 300, 'three antes in the pot');
assert.equal(r.body.yourHole.length, 2, 'Al sees his own hole');
r = await call('GET', `/v1/casino/ring/${tid}`, { token: bo.token });
assert.equal(r.body.yourSeat.hole.length, 2, 'Bo sees his own hole');
assert.equal(r.body.seats.filter((s) => !s.you).every((s) => s.hole === undefined), true, 'nobody else\'s cards are on the wire');
assert.equal(r.body.table.street, 'preflop', 'preflop');

// ── the betting street: order enforced, raise capped at the smallest live stack, calls always affordable ──
const acting0 = r.body.table.actingSeat;
const seatToken = (seatNo) => [al, bo, cy][r.body.seats.findIndex((s) => s.seat === seatNo)]; // seats assigned in sit order 0,1,2
const first = [al, bo, cy][acting0]; // seat n belongs to the nth sitter at a fresh table
assert.equal((await call('POST', `/v1/casino/ring/${tid}/act`, { token: [al, bo, cy].find((p) => p !== first).token, body: { action: 'check' } })).body.error, 'not_you', 'the action order holds');
// Cy has the short stack ($6000 − $100 ante = $5900 + bet 0) → the cap is 5900 for everyone
r = await call('POST', `/v1/casino/ring/${tid}/act`, { token: first.token, body: { action: 'raise', amount: 999999 } });
assert.equal(r.code, 200, 'a monster raise lands');
assert.equal(r.body.table.currentBet, 5900, 'clamped to the smallest live stack — everyone can always call (no side pots)');
const others = [al, bo, cy].filter((p) => p !== first);
assert.equal((await call('POST', `/v1/casino/ring/${tid}/act`, { token: others[0].token, body: { action: 'check' } })).body.error, 'bet', 'no free checks facing a bet');
assert.equal((await call('POST', `/v1/casino/ring/${tid}/act`, { token: others[0].token, body: { action: 'call' } })).code, 200, 'the call is always affordable');
r = await call('POST', `/v1/casino/ring/${tid}/act`, { token: others[1].token, body: { action: 'call' } });
assert.equal(r.code, 200, 'the last call closes the street');
assert.equal(r.body.table.street, 'flop', 'the flop is out');
assert.equal(r.body.table.board.length, 3, 'three community cards');
assert.equal(r.body.table.pot, 300 + 5900 * 3, 'the pot holds every chip');
await escrowOk('mid-hand (the pot is escrow)');

// ── check it down to showdown: pot − rake to the winner's STACK (no character cash moves) ──
const checkAround = async () => {
  for (let i = 0; i < 3; i++) {
    const v = (await call('GET', `/v1/casino/ring/${tid}`, { token: al.token })).body;
    if (!v.table.street) return;
    const seat = v.table.actingSeat;
    const who = [al, bo, cy][seat];
    const res = await call('POST', `/v1/casino/ring/${tid}/act`, { token: who.token, body: { action: 'check' } });
    assert.equal(res.code, 200, `seat ${seat} checks`);
  }
};
await checkAround(); // flop
await checkAround(); // turn
await checkAround(); // river → showdown
r = await call('GET', `/v1/casino/ring/${tid}`, { token: al.token });
assert.equal(r.body.table.street, null, 'the hand is over');
const result = r.body.table.lastResult;
assert(result && result.showdown, 'a showdown result is posted');
const potWas = 300 + 5900 * 3;
const rakeWas = Math.min(Math.floor(potWas * CASINO.RING.RAKE_BPS / 10000), CASINO.RING.RAKE_CAP_BB * 100);
assert.equal(result.rake, rakeWas, 'the rake is carved from the pot, capped in bb');
const stacks = r.body.seats.reduce((a, s) => a + s.stack, 0);
assert.equal(stacks, 24000 - rakeWas, 'every chip is accounted for — buy-ins minus the rake live in the stacks');
const takeRow = (await pool.query(`SELECT amount FROM transactions WHERE reason='casino:ring:take' AND counterparty='${tid}'`)).rows;
assert.equal(-Number(takeRow[0].amount), rakeWas, 'the rake is a ledgered NULL take');
await escrowOk('after the showdown');

// ── the fold-win path + THE TURN CLOCK: a staller is folded by the deadline (the never-wedge rule) ──
r = await call('POST', `/v1/casino/ring/${tid}/deal`, { token: bo.token });
assert.equal(r.code, 200, 'a second hand deals');
let v = (await call('GET', `/v1/casino/ring/${tid}`, { token: al.token })).body;
const stallerSeat = v.table.actingSeat;
await sleep(300); // RING_TURN_MS=200 — the clock runs out on the actor
const sweep1 = await sweepRingTables(pool);
assert(sweep1.resolvedStalls >= 1, 'the sweep folds the staller');
v = (await call('GET', `/v1/casino/ring/${tid}`, { token: al.token })).body;
assert(v.table.actingSeat !== stallerSeat || !v.table.street, 'the action moved on (or the hand resolved)');
// fold the rest down to one — the last man standing takes it without a showdown
let guard = 0;
while (v.table.street && guard++ < 6) {
  const who = [al, bo, cy][v.table.actingSeat];
  await call('POST', `/v1/casino/ring/${tid}/act`, { token: who.token, body: { action: 'fold' } });
  v = (await call('GET', `/v1/casino/ring/${tid}`, { token: al.token })).body;
}
assert.equal(v.table.street, null, 'the hand resolved by folds');
assert.equal(v.table.lastResult.showdown, false, 'no showdown — the last man standing took it');
await escrowOk('after the fold-win');

// ── leave: the stack cashes out (casino:ring:leave) ──
v = (await call('GET', `/v1/casino/ring/${tid}`, { token: cy.token })).body;
const cyStack = v.yourSeat.stack, cyCash0 = (await meOf(cy.token)).cash;
r = await call('POST', `/v1/casino/ring/${tid}/leave`, { token: cy.token });
assert.equal(r.code, 200, 'Cy stands up');
assert.equal(r.body.cashedOut, cyStack, 'the whole stack comes off the table');
assert.equal((await meOf(cy.token)).cash, cyCash0 + cyStack, 'and lands in pocket');
await escrowOk('after the cash-out');

// ── DEATH: the dead man's stack BURNS; the live hand resolves to the survivor ──
r = await call('POST', `/v1/casino/ring/${tid}/deal`, { token: al.token });
assert.equal(r.code, 200, 'a heads-up hand deals');
const boStack = (await call('GET', `/v1/casino/ring/${tid}`, { token: bo.token })).body.yourSeat.stack;
await app.inject({ method: 'POST', url: '/v1/mod/kill', headers: { 'x-mod-key': 'test-mod-key' }, payload: { characterId: bo.id } });
const deathRows = (await pool.query(`SELECT amount FROM transactions WHERE reason='casino:ring:death' AND counterparty='${tid}'`)).rows;
assert.equal(deathRows.length, 1, "the dead man's stack burned");
assert.equal(-Number(deathRows[0].amount), boStack, 'exactly his stack (his ante rides to the survivor)');
v = (await call('GET', `/v1/casino/ring/${tid}`, { token: al.token })).body;
assert.equal(v.table.street, null, 'the hand resolved when the table went heads-down');
assert.equal(v.seats.length, 1, 'one seat left');
await escrowOk('after the death burn');
await call('POST', `/v1/casino/ring/${tid}/leave`, { token: al.token }); // fold the table up clean
assert.equal((await call('GET', `/v1/casino/ring/${tid}`, { token: al.token })).body.error, 'no_table', 'an empty table folds up');
await escrowOk('after the table folded');

// ── (red-team HIGH) dealHand must LEDGER a prior stalled hand's rake before dealing the next one ──
// A heads-up table: deal, let the acting player's clock expire, then poke DEAL (not the sweep). The
// deal's enforceDeadline folds the staller → the survivor wins → dealHand must settleFinish that
// rake before overwriting t._rake with the fresh hand, or the ring-escrow §10.4 identity drifts.
{
  const hx = await mk('Heads Hank'), hy = await mk('Heads Hattie');
  const ht = (await call('POST', '/v1/casino/ring/open', { token: hx.token, body: { bb: 100, buyin: 10000 } })).body.tableId;
  await call('POST', `/v1/casino/ring/${ht}/sit`, { token: hy.token, body: { buyin: 10000 } });
  await call('POST', `/v1/casino/ring/${ht}/deal`, { token: hx.token });
  const takesBefore = Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='casino:ring:take' AND counterparty='${ht}'`)).rows[0].s);
  await sleep(300); // the acting player's 200ms clock expires — the hand is a full stall (folding the actor leaves one)
  const dr = await call('POST', `/v1/casino/ring/${ht}/deal`, { token: hx.token });
  assert.equal(dr.code, 200, 'the next deal resolves the stall AND deals fresh');
  const takesAfter = Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='casino:ring:take' AND counterparty='${ht}'`)).rows[0].s);
  assert(takesAfter < takesBefore, 'the stalled hand\'s rake got ledgered by the deal (not silently dropped)');
  await escrowOk('after a deal resolved a prior stall (the HIGH regression)');
}

// ══ THE BRACKET — rounds of heats on the existing tournament escrow ══
const runners = [];
for (let i = 0; i < 8; i++) runners.push(await mk(`Bracket Runner ${i}`));
r = await call('POST', '/v1/casino/tournament', { token: runners[0].token, body: { bracket: true } });
assert.equal(r.code, 200, 'the bracket materializes');
assert.equal(r.body.format, 'bracket', 'in bracket format');
const btid = r.body.tournament;
for (let i = 1; i < 8; i++)
  assert.equal((await call('POST', '/v1/casino/tournament', { token: runners[i].token, body: {} })).code, 200, `runner ${i} seats`);
await closeReg(btid); // registration closes deterministically (was a flaky sleep vs a 300ms window)
// round 1: 8 runners → 2 heats of 4… (HEAT_SIZE 6 → heats of 6+2; ADVANCE 2 per heat → 4 remain)
let s1 = await sweepTournaments(pool);
assert.equal(s1.resolved, 1, 'round one ran');
const afterR1 = Number((await pool.query(
  `SELECT COUNT(*) n FROM poker_entries WHERE tournament_id='${btid}' AND NOT eliminated`)).rows[0].n);
assert(afterR1 < 8 && afterR1 >= 2, `the field was cut (${afterR1} remain)`);
assert.equal((await pool.query(`SELECT status FROM poker_tournaments WHERE id='${btid}'`)).rows[0].status, 'open', 'the bracket is still running');
// the survivors fit one table now → the next sweep is THE FINAL (BRACKET_ROUND_MS=1)
await sleep(10);
let s2 = await sweepTournaments(pool);
assert.equal(s2.resolved, 1, 'the final ran');
assert.equal((await pool.query(`SELECT status FROM poker_tournaments WHERE id='${btid}'`)).rows[0].status, 'resolved', 'the bracket settled');
const places = (await pool.query(
  `SELECT place FROM poker_entries WHERE tournament_id='${btid}' AND place IS NOT NULL ORDER BY place`)).rows;
assert.equal(Number(places[0].place), 1, 'a champion was crowned');
// the escrow identity: Σ buyins == wins + take (nobody died, nobody refunded)
const flow = async (reason) => Number((await pool.query(
  `SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='${reason}' AND counterparty='${btid}'`)).rows[0].s);
const bBuyins = -(await flow('casino:tourney:buyin'));
const bWins = await flow('casino:tourney:win');
const bTake = -(await flow('casino:tourney:take'));
assert.equal(bBuyins, 8 * CASINO.TOURNEY.BUYIN, 'eight buy-ins escrowed');
assert.equal(bWins + bTake, bBuyins, 'the final paid the whole pool: winners + the take == every buy-in');
const trCheck = (await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === 'poker tourney escrow');
assert.equal(trCheck.drift, 0, `the tourney escrow identity holds through the bracket (${trCheck.drift})`);

// ── (red-team HIGH) a runner who DIES mid-bracket burns their stake in a NON-terminal round, and the
// bracket COMMITS still 'open' — the pool must drop with the burn or the tourney-escrow §10.4 identity
// drifts by the burned buy-in for the life of the bracket. Seed 8, kill one BEFORE round 1 (so 7 live →
// heat 6+1 → 3 advance → still open), then assert the escrow check is exact at that open state. ──
{
  const R = [];
  for (let i = 0; i < 8; i++) R.push(await mk(`Dead-Bracket ${i}`));
  const dbid = (await call('POST', '/v1/casino/tournament', { token: R[0].token, body: { bracket: true } })).body.tournament;
  for (let i = 1; i < 8; i++) await call('POST', '/v1/casino/tournament', { token: R[i].token, body: {} });
  await app.inject({ method: 'POST', url: '/v1/mod/kill', headers: { 'x-mod-key': 'test-mod-key' }, payload: { characterId: R[3].id } });
  await closeReg(dbid); // registration closes deterministically (the kill already landed → R[3] burns in round 0)
  const s = await sweepTournaments(pool);
  assert.equal(s.resolved, 1, 'the death round ran');
  const st = (await pool.query(`SELECT status, pool FROM poker_tournaments WHERE id='${dbid}'`)).rows[0];
  assert.equal(st.status, 'open', 'the bracket is STILL OPEN after the death round (a non-terminal round)');
  const deadBurn = -Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='casino:tourney:death' AND counterparty='${dbid}'`)).rows[0].s);
  assert.equal(deadBurn, CASINO.TOURNEY.BUYIN, 'the dead runner\'s stake burned');
  assert.equal(Number(st.pool), 7 * CASINO.TOURNEY.BUYIN, 'and the pool DROPPED by the burn (the drift fix)');
  const dCheck = (await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === 'poker tourney escrow');
  assert.equal(dCheck.drift, 0, `the escrow identity holds at the OPEN mid-bracket death state (${dCheck.drift})`);
  await sleep(10); await sweepTournaments(pool); // settle the final so the one-open slot frees
}

await app.close();
console.log('✅ RING POKER + THE BRACKET test passed — the lobby + stakes/buy-in/one-table gates, the ESCROW boundary (sit/leave ledgered, stacks+pots reconciling at every stage), a full 3-handed hand (antes, order enforcement, the raise CLAMPED to the smallest live stack so every call is affordable — no side pots, hole-card redaction, showdown paying the winner\'s STACK net of a capped ledgered rake), the fold-win, THE TURN CLOCK auto-folding a staller, cash-out, DEATH (the stack burns casino:ring:death + the hand resolves), an empty table folding up, and THE BRACKET (format locked at materialization, an 8-runner field cut by heats then settled by a final paying winners + take == every buy-in — the tourney escrow §10.4 identity intact)');

// THE MENTOR (omerta-first-contact-and-events-design.md, MOVE 1) — the positive first interaction.
//
// A veteran takes a newcomer under their wing (async: offer → accept). The mentor's reward is STATUS
// ONLY (proteges_raised — Sybil-proof); the protégé gets a bounded onboarding cash faucet at level
// milestones. The centre of the test: the offer→accept tie, the milestone + graduation claim (the
// mentor's legend +1), the anti-Sybil gates, and that the ONLY value that moves is the ledgered
// `mentor:protege` faucet.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { MENTOR } from '../src/rules.js';

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
  return { token, id: me.id, name };
};
const seed = (id, sql) => pool.query(`UPDATE characters SET ${sql} WHERE id='${id}'`);
const acctOf = async (id) => (await pool.query('SELECT account_id a FROM characters WHERE id=$1', [id])).rows[0].a;
const driftOf = async (name) => {
  const r = await runLedgerInvariants(pool, { alert: false });
  return Number(r.checks.find((x) => x.name === name).drift);
};

// a VETERAN (respect 4000 → level 21 ≥ MIN_LVL 20) and a NEWCOMER (respect 160 → level 5)
const vet = await mk('Don Vito');
const kid = await mk('Young Turk');
await seed(vet.id, 'respect=4000');
await seed(kid.id, 'respect=160');

// ════════════ SEEK — a newcomer flags they're open to a wing ════════════
assert.equal((await call('POST', '/v1/mentor/seeking', { token: kid.token, body: { on: true } })).body.seeking, true, 'the newcomer puts the word out');
assert.equal((await call('GET', '/v1/mentor', { token: kid.token })).body.me.seeking, true, 'and it surfaces on their board');
// a made man is past the newcomer window — can't seek
assert.equal((await call('POST', '/v1/mentor/seeking', { token: vet.token, body: { on: true } })).body.error, 'too_high', 'a veteran can\'t seek a mentor');

// ════════════ OFFER — the veteran puts a word in ════════════
// you can't accept before an offer
assert.equal((await call('POST', `/v1/mentor/accept/${vet.id}`, { token: kid.token })).body.error, 'no_offer', 'no wing without an offer first');
assert.equal((await call('POST', `/v1/mentor/offer/${kid.id}`, { token: vet.token })).body.mentor, 'offered', 'the veteran offers to mentor the newcomer');
// a would-be mentor under the level floor can't take a protégé
{
  const green = await mk('Green Horn'); await seed(green.id, 'respect=160');
  assert.equal((await call('POST', `/v1/mentor/offer/${kid.id}`, { token: green.token })).body.error, 'level', 'a low-level player can\'t take a protégé');
}
// the offer shows on the newcomer's board
assert.equal((await call('GET', '/v1/mentor', { token: kid.token })).body.offers.some((o) => o.name === 'Don Vito'), true, 'the offer is on the newcomer\'s board to accept');

// ════════════ ACCEPT — the tie forms ════════════
assert.equal((await call('POST', `/v1/mentor/accept/${vet.id}`, { token: kid.token })).body.mentor, 'Don Vito', 'the newcomer takes the wing');
// the tie surfaces both ways
assert.equal((await call('GET', '/v1/mentor', { token: kid.token })).body.mentor.name, 'Don Vito', 'the protégé sees their mentor');
assert.equal((await call('GET', '/v1/mentor', { token: vet.token })).body.proteges.some((p) => p.name === 'Young Turk'), true, 'the mentor sees their protégé');
// one mentor ever
assert.equal((await call('POST', `/v1/mentor/accept/${vet.id}`, { token: kid.token })).body.error, 'have_mentor', 'you get one mentor, ever');
// and the seeking flag is cleared
assert.equal((await call('GET', '/v1/mentor', { token: kid.token })).body.me.seeking, false, 'accepting clears the seeking flag');

// ════════════ CLAIM — the protégé's onboarding cash, milestone by milestone ════════════
const before = await driftOf('character cash');
// at level 5 they can claim the first milestone ($2k)
let r = (await call('POST', '/v1/mentor/claim', { token: kid.token })).body;
assert.deepEqual(r.milestones, [5], 'level 5 → the first milestone');
assert.equal(r.cash, MENTOR.MILESTONES[0].cash, 'paid exactly the milestone cash');
assert.equal(r.graduated, false, 'not graduated yet');
// nothing more to claim until they climb
assert.equal((await call('POST', '/v1/mentor/claim', { token: kid.token })).body.error, 'nothing', 'no double-claim of a reached milestone');
// the payout is a ledgered mentor:protege faucet
assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM transactions WHERE reason='mentor:protege'")).rows[0].n), 1, 'the milestone paid a mentor:protege cash row');

// ════════════ GRADUATION — the protégé reaches level 20, the mentor's legend +1 ════════════
await seed(kid.id, 'respect=3610');   // level 20
r = (await call('POST', '/v1/mentor/claim', { token: kid.token })).body;
assert.deepEqual(r.milestones, [10, 15, 20], 'the remaining milestones claim at once');
assert.equal(r.graduated, true, 'reaching level 20 GRADUATES the protégé');
// the mentor's legend bumped (status, survives death)
const raised = Number((await pool.query('SELECT proteges_raised FROM account_persistent WHERE account_id=$1', [await acctOf(vet.id)])).rows[0].proteges_raised);
assert.equal(raised, 1, 'the mentor raised one protégé — the legend +1');
// re-claiming does nothing
assert.equal((await call('POST', '/v1/mentor/claim', { token: kid.token })).body.error, 'nothing', 'graduation is once-ever');

// ════════════ THE LEADERBOARD — the mentor by protégés raised ════════════
const lb = (await call('GET', '/v1/leaderboard/mentors', { token: vet.token })).body;
assert.equal(lb.some((m) => m.name === 'Don Vito' && m.raised === 1), true, 'the mentor is on the board with their count');
assert.equal(lb[0].rank !== undefined, true, 'ranked by the mentor ladder');

// ════════════ anti-Sybil — agents don't mentor ════════════
{
  const bot = await mk('Bot Boss'); await seed(bot.id, 'respect=4000');
  await pool.query('UPDATE account_persistent SET agent_flag=true WHERE account_id=$1', [await acctOf(bot.id)]);
  const kid2 = await mk('Fresh Fish'); await seed(kid2.id, 'respect=160');
  await call('POST', '/v1/mentor/seeking', { token: kid2.token, body: { on: true } });
  assert.equal((await call('POST', `/v1/mentor/offer/${kid2.id}`, { token: bot.token })).body.error, 'no', 'an agent can\'t take a protégé');
}

// ════════════ §10.4 — the only value that moves is the ledgered faucet ════════════
assert.equal(await driftOf('character cash'), before, 'the cash identity holds — every mentor payout is a ledgered faucet');
{
  const vocab = (await runLedgerInvariants(pool, { alert: false })).checks.find((x) => x.name === 'reason vocabulary');
  assert.equal(vocab.ok, true, 'mentor:protege is a recognized reason — no unknown-reason alarm');
}
// the total mentor faucet is exactly the four milestones (once-ever, level-real → bounded)
const total = Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='mentor:protege'")).rows[0].s);
assert.equal(total, MENTOR.MILESTONES.reduce((a, m) => a + m.cash, 0), 'the whole faucet is the four bounded milestones');

// ════════════ THE CARE PACKAGE (step two) — the mentor sends the protégé a stake ════════════
// a transfer (nets zero), so the seed here is baked into a fresh local before/after and can't disturb
// the §10.4 delta asserted above (which already ran with `before` captured pre-seed).
await pool.query(`UPDATE characters SET cash=cash+50000 WHERE id='${vet.id}'`);
// (red-team F1) `kid` GRADUATED at level 20 above — the care-package rail is an ONBOARDING aid, so a
// graduated protégé's gift is now REFUSED (else a maxed alt pulls $5k/day untaxed forever).
assert.equal((await call('POST', `/v1/mentor/gift/${kid.id}`, { token: vet.token })).body.error, 'graduated', 'a graduated protégé gets no more care packages (F1 — the rail is onboarding-only)');
// the happy path needs a NON-graduated protégé: vet takes a fresh newcomer (graduated kid doesn't count
// against ACTIVE_MAX, so there's room).
const kid3 = await mk('Fresh Recruit'); await seed(kid3.id, 'respect=160');
await call('POST', '/v1/mentor/seeking', { token: kid3.token, body: { on: true } });
await call('POST', `/v1/mentor/offer/${kid3.id}`, { token: vet.token });
await call('POST', `/v1/mentor/accept/${vet.id}`, { token: kid3.token });
const gBefore = await driftOf('character cash');   // nonzero (the seed), but constant across the gift
const kidCash0 = Number((await pool.query(`SELECT cash FROM characters WHERE id='${kid3.id}'`)).rows[0].cash);
const vetCash0 = Number((await pool.query(`SELECT cash FROM characters WHERE id='${vet.id}'`)).rows[0].cash);
{
  const g = (await call('POST', `/v1/mentor/gift/${kid3.id}`, { token: vet.token })).body;
  assert.equal(g.gifted, MENTOR.GIFT_CASH, 'the care package is the gift cash (a non-graduated protégé)');
}
const kidCash1 = Number((await pool.query(`SELECT cash FROM characters WHERE id='${kid3.id}'`)).rows[0].cash);
const vetCash1 = Number((await pool.query(`SELECT cash FROM characters WHERE id='${vet.id}'`)).rows[0].cash);
assert.equal(kidCash1 - kidCash0, MENTOR.GIFT_CASH, 'the protégé got the stake');
assert.equal(vetCash0 - vetCash1, MENTOR.GIFT_CASH, 'the mentor paid it out of pocket');
// one a day
assert.equal((await call('POST', `/v1/mentor/gift/${kid3.id}`, { token: vet.token })).body.error, 'cooldown', 'one care package a day');
// the transfer nets zero (both legs ledgered mentor:gift) — the cash identity is unmoved
assert.equal(await driftOf('character cash'), gBefore, 'the care package is a net-zero transfer — §10.4 holds');
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='mentor:gift'")).rows[0].s), 0, 'the gift nets zero in the ledger');
// not-mentor gate
{
  const stranger = await mk('No Wing'); await seed(stranger.id, 'respect=160');
  assert.equal((await call('POST', `/v1/mentor/gift/${stranger.id}`, { token: vet.token })).body.error, 'not_mentor', 'no care package to a non-protégé');
}

// ════════════ HAD MY BACK (step two) — an attack on the protégé rings the mentor ════════════
{
  const { alertMentor } = await import('../src/mentor.js');
  const client = await pool.connect();
  try { await alertMentor(client, await acctOf(kid.id), 'Young Turk', 'Some Thug', 'jumped'); }
  finally { client.release(); }
  const note = (await pool.query("SELECT type, payload FROM notifications WHERE character_id=$1 AND type='protege_attacked' ORDER BY id DESC LIMIT 1", [vet.id])).rows[0];
  assert.ok(note, 'the mentor was rung when their protégé was jumped');
  const p = JSON.parse(note.payload);
  assert.equal(p.protege, 'Young Turk', 'the alert names the protégé');
  assert.equal(p.from, 'Some Thug', 'and the aggressor');
  assert.equal(p.what, 'jumped', 'and what happened');
}

console.log('mentor: PASS');
await app.close();
process.exit(0);

// THE COMMISSION test — seats (top-5 standing), public votes (cast + change), the lazy weekly
// tally (majority governs, ties deadlock), and all four decree touchpoints: OPEN SEASON (half
// safehouse), THE PAX (no new wars), AMNESTY (half laylow), LOCKDOWN (+20 convoy defense, visible
// in the rng audit). No money moves — the §10.4 vocabulary check closes it out. pg-mem, zero infra.
process.env.CONVOY_MS = '600000';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { M3, M4, COMMISSION, weekOf } from '../src/rules.js';
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
  return { token, id: (await meOf(token)).id };
};
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);
const week = weekOf();

// six families — standings 600..100, so the sixth misses the table
const bosses = [];
for (let i = 1; i <= 6; i++) {
  const b = await mk(`Boss Number ${i}`);
  await seedCh(b.id, 'respect=400, cash=60000');
  const g = await call('POST', '/v1/gangs', { token: b.token, body: { name: `Family Number ${i}`, tag: `F${i}A` } });
  assert(g.body.gangId, `family ${i} founded`);
  await pool.query(`UPDATE gangs SET lifetime_tribute=${(7 - i) * 100} WHERE id='${g.body.gangId}'`);
  bosses.push({ ...b, gang: g.body.gangId });
}
const civilian = await mk('No Family Nick');

// ── seats: the top five, in standing order; the sixth watches from the street ──
let r = await call('GET', '/v1/commission');
assert.equal(r.code, 200, 'the chamber is public');
assert.equal(r.body.seats.length, 5, 'five seats');
assert.equal(r.body.seats[0].name, 'Family Number 1', 'the strongest family sits at the head');
assert(!r.body.seats.some((s) => s.name === 'Family Number 6'), 'the sixth has no seat');
assert(r.body.book.length === 4, 'the decree book is published');

// ── vote gates + cast + change ──
assert.equal((await call('POST', '/v1/commission/vote', { token: civilian.token, body: { decree: 'pax' } })).body.error, 'rank', 'no family, no voice');
assert.equal((await call('POST', '/v1/commission/vote', { token: bosses[5].token, body: { decree: 'pax' } })).body.error, 'no_seat', 'no seat, no vote');
assert.equal((await call('POST', '/v1/commission/vote', { token: bosses[0].token, body: { decree: 'martial_law' } })).body.error, 'bad_decree', 'no such motion');
r = await call('POST', '/v1/commission/vote', { token: bosses[0].token, body: { decree: 'pax' } });
assert.equal(r.code, 200, 'the head family votes'); assert.equal(r.body.takesEffectWeek, week + 1, 'effect lands NEXT week');
assert.equal((await call('POST', '/v1/commission/vote', { token: bosses[0].token, body: { decree: 'open_season' } })).code, 200, 'a vote can change all week');
r = await call('GET', '/v1/commission');
assert.equal(r.body.votes.length, 1, 'one vote per family');
assert.equal(r.body.votes[0].decree, 'open_season', 'the change stuck — and the vote is PUBLIC');

// ── the tally: majority governs; a tie deadlocks ──
// entries are 'decree' (weight 1) or ['decree', weight] — step two's seat-weighted ballots
const setLastWeek = async (...decrees) => {
  await pool.query(`DELETE FROM commission_votes WHERE week=${week - 1}`);
  for (let i = 0; i < decrees.length; i++) {
    const [d, w] = Array.isArray(decrees[i]) ? decrees[i] : [decrees[i], 1];
    await pool.query(`INSERT INTO commission_votes (week, gang_id, decree, weight) VALUES (${week - 1}, '${bosses[i].gang}', '${d}', ${w})`);
  }
};
await setLastWeek('open_season', 'open_season', 'open_season', 'pax', 'pax');
r = await call('GET', '/v1/commission');
assert.equal(r.body.decree.id, 'open_season', 'the majority of last week governs this week');
assert(r.body.decree.lapsesSeconds > 0, 'and it lapses with the week');
await setLastWeek('open_season', 'open_season', 'pax', 'pax');
assert.equal((await call('GET', '/v1/commission')).body.decree, null, 'a tied Commission deadlocks — no decree');

// ── OPEN SEASON: safehouse stays are halved ──
await setLastWeek('open_season', 'open_season', 'open_season');
await seedCh(civilian.id, 'cash=30000');
r = await call('POST', '/v1/safehouse', { token: civilian.token });
assert.equal(r.code, 200, 'went to ground'); assert.equal(r.body.openSeason, true, 'under the decree');
const safeS = (await meOf(civilian.token)).safeSeconds;
const half = M3.SAFEHOUSE_MS / 2000;
assert(Math.abs(safeS - half) <= 5, `the stay is HALVED (${safeS}s ≈ ${half}s)`);

// ── THE PAX: no new wars ──
await setLastWeek('pax', 'pax', 'pax');
await pool.query(`UPDATE gangs SET treasury=50000 WHERE id='${bosses[0].gang}'`);
assert.equal((await call('POST', `/v1/gangs/war/${bosses[1].gang}`, { token: bosses[0].token })).body.error, 'pax', 'the Commission has declared the Pax');

// ── AMNESTY: laying low costs half ──
await setLastWeek('amnesty', 'amnesty', 'amnesty');
await seedCh(civilian.id, 'heat=50, cash=50000, energy=200, safe_until=NULL');
const cashPre = (await meOf(civilian.token)).cash;
r = await call('POST', '/v1/kitchen/laylow', { token: civilian.token });
assert.equal(r.code, 200, 'laid low'); assert.equal(r.body.amnesty, true, 'under the decree');
assert.equal(r.body.cost, Math.floor(M4.LAYLOW_CASH * COMMISSION.AMNESTY_MULT), 'at half price');
assert.equal((await meOf(civilian.token)).cash, cashPre - r.body.cost, 'the ledgered sink matches the discounted price');

// ── LOCKDOWN: every convoy fights +20 — visible in the audit trail ──
await setLastWeek('lockdown', 'lockdown', 'lockdown');
const shipper = bosses[2], bandit = bosses[3];
await seedCh(shipper.id, "cash=100000, loc='docks', safe_until=NULL");
assert.equal((await call('POST', '/v1/goods/buy', { token: shipper.token, body: { goodId: 'gin', qty: 10 } })).code, 200, 'freight bought');
r = await call('POST', '/v1/convoy', { token: shipper.token, body: { to: 'neon', goodId: 'gin', qty: 10 } });
assert.equal(r.code, 200, 'shipment opened');
r = await call('POST', '/v1/convoy/depart', { token: shipper.token, body: { guards: 'none' } });
assert.equal(r.code, 200, 'on the road, cheap');
await seedCh(bandit.id, 'energy=200, ammo=100, muscle=5, speed=5, safe_until=NULL, hosp_until=NULL, jail_until=NULL');
assert.equal((await call('POST', `/v1/convoy/${r.body.id}/ambush`, { token: bandit.token })).code, 200, 'the attempt resolves');
const audit = (await pool.query("SELECT outcome FROM rng_audit WHERE action LIKE 'convoy:ambush:%' ORDER BY at DESC LIMIT 1")).rows[0];
assert(audit.outcome.includes('lockdown'), `the +${COMMISSION.LOCKDOWN_DEF} lockdown defense is in the audit trail (${audit.outcome})`);

// ── STEP TWO: seat-weighted ballots — the head of the table outweighs the tail ──
r = await call('POST', '/v1/commission/vote', { token: bosses[0].token, body: { decree: 'pax' } });
assert.equal(r.body.weight, COMMISSION.SEATS, 'the head family casts full weight');
assert.equal((await call('POST', '/v1/commission/vote', { token: bosses[4].token, body: { decree: 'pax' } })).body.weight, 1, 'the last seat casts one');
await setLastWeek(['pax', 5], ['open_season', 1], ['open_season', 1], ['open_season', 2]);
assert.equal((await call('GET', '/v1/commission')).body.decree.id, 'pax', 'one heavy voice beats three light ones (5 vs 4)');
await setLastWeek(['pax', 5], ['open_season', 2], ['open_season', 2], ['open_season', 1]);
assert.equal((await call('GET', '/v1/commission')).body.decree, null, 'a weighted tie (5 vs 5) still deadlocks');

// ── STEP TWO: the veto — the head seat's boss kills the sitting decree, once, publicly ──
await setLastWeek(); // empty chamber first: nothing in force to kill
assert.equal((await call('POST', '/v1/commission/veto', { token: bosses[0].token })).body.error, 'no_decree', 'nothing in force');
await setLastWeek('amnesty', 'amnesty', 'amnesty');
assert.equal((await call('POST', '/v1/commission/veto', { token: civilian.token })).body.error, 'rank', 'no family, no veto');
assert.equal((await call('POST', '/v1/commission/veto', { token: bosses[1].token })).body.error, 'head', 'only the head of the table');
r = await call('POST', '/v1/commission/veto', { token: bosses[0].token });
assert.equal(r.code, 200, 'the head of the table speaks'); assert.equal(r.body.vetoed, 'amnesty', 'and the decree dies');
r = await call('GET', '/v1/commission');
assert.equal(r.body.decree, null, 'nothing is in force after the veto');
assert.equal(r.body.veto.decree, 'amnesty', 'the veto is on the public record');
assert.equal(r.body.veto.family, 'Family Number 1', 'with the name on it');
// the killed decree's touchpoint is dead too: laylow is FULL price under a vetoed amnesty
await seedCh(civilian.id, 'heat=50, cash=50000, energy=200, safe_until=NULL');
r = await call('POST', '/v1/kitchen/laylow', { token: civilian.token });
assert.equal(r.code, 200, 'laid low under the veto');
assert(!r.body.amnesty && r.body.cost === M4.LAYLOW_CASH, 'FULL price — the touchpoint died with the decree');
assert.equal((await call('POST', '/v1/commission/veto', { token: bosses[0].token })).body.error, 'vetoed', 'one veto a week');

// ── no decree moves money: the vocabulary stays closed ──
const vocab = (await runLedgerInvariants(pool)).checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `no new reasons (${JSON.stringify(vocab.unknown || [])})`);

console.log('✅ Commission test passed — five seats by standing, public cast-and-change votes, lazy majority tally + tie deadlock, OPEN SEASON (half safehouse), THE PAX (war blocked), AMNESTY (half laylow, ledger exact), LOCKDOWN (+20 in the audit trail) + STEP TWO: seat-weighted ballots (5 beats 3x light, weighted ties deadlock), the head-of-table veto (rank/head/once gates, public record, touchpoint dead), vocabulary closed');
await app.close();

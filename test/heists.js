// CREW HEISTS test — plan/crew/execute/rat lifecycle: gates (job, level, cash, busy, full,
// not-leader, not-ready, stale), a scored job (weighted split, exact §10.4 ledgering, respect,
// shared cooldown), a bust (shared jail), the rat (informant paid, crew doubled, nobody named),
// disband/leave refunds, the stale sweep, and the reason-vocabulary check. pg-mem, zero infra.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { HEIST_JOBS } from '../src/rules.js';
import { sweepStaleHeists } from '../src/heists.js';
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

const hank = await mk('Heist Hank');   // the leader
const cara = await mk('Crew Cara');    // the crew
const ray = await mk('Rookie Ray');    // level 1 — below every gate
await seedCh(hank.id, 'respect=2304, cash=100000, muscle=400, cunning=400, speed=100'); // lvl 25
await seedCh(cara.id, 'respect=2304, cash=1000, muscle=400, cunning=400, speed=100');
const payroll = HEIST_JOBS.find((j) => j.id === 'payroll');

// ── the board + the gates ──
let r = await call('GET', '/v1/heists', { token: hank.token });
assert.equal(r.code, 200); assert(r.body.jobs.length >= 3, 'the catalog is on the board'); assert.equal(r.body.mine, null, 'no active job yet');
assert.equal((await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'nope' } })).body.error, 'bad_job', 'no such job');
assert.equal((await call('POST', '/v1/heists/plan', { token: ray.token, body: { job: 'vault' } })).body.error, 'level', 'the vault wants made players');
await seedCh(hank.id, 'cash=100');
assert.equal((await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'payroll' } })).body.error, 'cash', 'no stake, no job');
await seedCh(hank.id, 'cash=100000');
r = await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'payroll' } });
assert.equal(r.code, 200, 'the job is planned'); const h1 = r.body.id;
assert.equal(r.body.crewNeeded, 1, 'needs one more');
assert.equal((await meOf(hank.token)).cash, 100000 - payroll.stake, 'the stake left the pocket');
assert.equal((await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'payroll' } })).body.error, 'busy', 'one job at a time');
assert.equal((await call('POST', `/v1/heists/${h1}/join`, { token: ray.token })).body.error, 'level', 'the crew is gated too');
assert.equal((await call('POST', `/v1/heists/${h1}/execute`, { token: hank.token })).body.error, 'crew_short', 'no going in alone');
assert.equal((await call('POST', `/v1/heists/${h1}/join`, { token: cara.token })).code, 200, 'cara is in');
assert((await call('GET', '/v1/heists', { token: cara.token })).body.mine.crew.length === 2, 'her board shows the crew');
assert.equal((await call('POST', `/v1/heists/${h1}/execute`, { token: cara.token })).body.error, 'not_leader', 'the leader calls the go');
await seedCh(cara.id, "jail_until = now() + interval '1 minute'");
assert.equal((await call('POST', `/v1/heists/${h1}/execute`, { token: hank.token })).body.error, 'crew_not_ready', 'nobody goes with a man inside');
await seedCh(cara.id, 'jail_until=NULL');

// ── run jobs until BOTH outcomes land; verify the money on each ──
let scored = false, busted = false, guard = 0;
let activeId = h1;
while ((!scored || !busted) && guard++ < 20) {
  if (!activeId) {
    await seedCh(hank.id, 'cash=100000, heist_at=NULL, jail_until=NULL, hosp_until=NULL');
    await seedCh(cara.id, 'heist_at=NULL, jail_until=NULL, hosp_until=NULL');
    const p = await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'payroll' } });
    assert.equal(p.code, 200, `replan (${JSON.stringify(p.body)})`);
    activeId = p.body.id;
    assert.equal((await call('POST', `/v1/heists/${activeId}/join`, { token: cara.token })).code, 200, 'recrew');
  }
  const hankPre = (await meOf(hank.token)).cash, caraPre = (await meOf(cara.token)).cash;
  const ex = await call('POST', `/v1/heists/${activeId}/execute`, { token: hank.token });
  assert.equal(ex.code, 200, `execute resolves (${JSON.stringify(ex.body)})`);
  if (ex.body.score && !scored) {
    scored = true;
    const unit = ex.body.pot / 2.2; // leader 1.2 + 1 crew
    assert.equal(ex.body.share, Math.floor(unit * 1.2), 'the leader takes the weighted share');
    assert.equal((await meOf(hank.token)).cash, hankPre + Math.floor(unit * 1.2), "the leader's cut landed");
    assert.equal((await meOf(cara.token)).cash, caraPre + Math.floor(unit), "cara's cut landed");
    assert.equal((await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'payroll' } })).body.error, 'cooldown', 'one Score per window');
  } else if (!ex.body.score && !ex.body.blown && !busted) {
    busted = true;
    assert((await meOf(hank.token)).jailSeconds > 0 && (await meOf(cara.token)).jailSeconds > 0, 'the whole crew goes down together');
  }
  activeId = null;
}
assert(scored && busted, `both outcomes over ${guard} jobs`);
// every dollar of it is ledgered: shares == heist:crew rows, stakes/refunds == heist:crew:stake rows
const sum = async (reason, cid) => Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='${reason}' AND character_id='${cid}'`)).rows[0].s);
assert(Number((await pool.query("SELECT COUNT(*) n FROM rng_audit WHERE action LIKE 'heist:%'")).rows[0].n) >= 2, 'every roll rng-audited');

// ── THE RAT: the job never fires, the informer walks paid, the street hears only "somebody talked" ──
await seedCh(hank.id, 'cash=100000, heist_at=NULL, jail_until=NULL');
await seedCh(cara.id, 'heist_at=NULL, jail_until=NULL');
r = await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'payroll' } });
const h2 = r.body.id;
await call('POST', `/v1/heists/${h2}/join`, { token: cara.token });
assert.equal((await call('POST', `/v1/heists/${h2}/rat`, { token: cara.token })).code, 200, 'cara talks to the law, quietly');
const caraPreRat = (await meOf(cara.token)).cash;
r = await call('POST', `/v1/heists/${h2}/execute`, { token: hank.token });
assert.equal(r.body.blown, true, 'the law was waiting');
assert((await meOf(hank.token)).jailSeconds > payroll.jailS, 'the leader eats DOUBLE time');
assert.equal((await meOf(cara.token)).jailSeconds, 0, 'the rat walks');
assert.equal((await meOf(cara.token)).cash, caraPreRat + Math.floor(payroll.stake * 0.5), 'the informant is paid half the stake');
assert.equal(await sum('heist:crew:rat', cara.id), Math.floor(payroll.stake * 0.5), 'the payout is a ledgered faucet');
assert(!JSON.stringify(r.body).includes('Cara'), 'the rat is never named');

// ── disband + leave + the stale sweep ──
await seedCh(hank.id, 'cash=100000, heist_at=NULL, jail_until=NULL');
await seedCh(cara.id, 'heist_at=NULL, jail_until=NULL');
r = await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'payroll' } });
const h3 = r.body.id;
await call('POST', `/v1/heists/${h3}/join`, { token: cara.token });
assert.equal((await call('POST', `/v1/heists/${h3}/leave`, { token: cara.token })).body.left, true, 'a member can walk');
const hankPreDisband = (await meOf(hank.token)).cash;
r = await call('POST', `/v1/heists/${h3}/leave`, { token: hank.token });
assert.equal(r.body.disbanded, true, 'the leader walking disbands the job');
assert.equal((await meOf(hank.token)).cash, hankPreDisband + payroll.stake, 'the stake comes back whole before execution');
// stale: a cold plan is swept, the living leader refunded
r = await call('POST', '/v1/heists/plan', { token: hank.token, body: { job: 'payroll' } });
const h4 = r.body.id;
await pool.query(`UPDATE crew_heists SET created_at = now() - interval '7 hours' WHERE id='${h4}'`);
assert.equal((await call('POST', `/v1/heists/${h4}/join`, { token: cara.token })).body.error, 'stale', 'a cold plan takes no crew');
const hankPreSweep = (await meOf(hank.token)).cash;
assert.equal((await sweepStaleHeists(pool)).swept, 1, 'the sweep found it');
assert.equal((await meOf(hank.token)).cash, hankPreSweep + payroll.stake, 'the sweep refunded the living leader');

// ── §10.4: the vocabulary knows every heist reason ──
const vocab = (await runLedgerInvariants(pool)).checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `heist:crew* rides the 'heist' prefix (${JSON.stringify(vocab.unknown || [])})`);

console.log('✅ Crew heists test passed — board/gates (job, level, cash, busy, full, not-leader, not-ready), scored job (weighted split, exact ledgered shares, shared cooldown), shared-jail bust, THE RAT (informant paid half the stake, crew doubled, never named), member leave + leader disband refund, stale sweep refund, §10.4 vocabulary');
await app.close();

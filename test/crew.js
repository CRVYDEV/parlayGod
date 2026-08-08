// THE CREW (omerta-crew-design.md) — the lightweight 2-4 player mutual-aid pact.
//
// Status + coordination only: the whole drop writes NO ledger rows (there is no `crew:` vocabulary),
// so the centre of this file is the lifecycle + the breakable non-aggression + a zero-§10.4 proof.
// Covers: create + its gates, invite/accept/decline, the board's REACH, the member cap, leader
// succession + kick, the CREW ROOM chat, the non-aggression gate (a crewmate can't be jumped) with the
// rat/leave exceptions, and that the whole flow moves no value.
process.env.SEARCH_MS = '0';
process.env.SHOOT_CD_MS = '0';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { sweepCrewInvites } from '../src/crew.js';
import { CREW } from '../src/rules.js';
import { readFileSync as _readSrc } from 'node:fs';

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
const invite = (from, target) => call('POST', '/v1/crew/invite', { token: from.token, body: { name: target.name } });
const acctOf = async (id) => (await pool.query('SELECT account_id a FROM characters WHERE id=$1', [id])).rows[0].a;
const seed = async (id, sql) => pool.query(`UPDATE characters SET ${sql} WHERE id='${id}'`);
const one = async (q, p = []) => Number((await pool.query(q, p)).rows[0].n);
const driftOf = async (name) => {
  const r = await runLedgerInvariants(pool, { alert: false });
  const c = r.checks.find((x) => x.name === name);
  assert(c, `the ${name} check exists`);
  return Number(c.drift);
};
// a fighter kit so a jump reaches the crew gate (health/energy/ammo, same street)
const kit = (id) => seed(id, "respect=5000, health=100, energy=100, ammo=50, loc='docks', hosp_until=NULL, jail_until=NULL, safe_until=NULL");

// ════════════ A · LIFECYCLE ════════════
const boss = await mk('Big Sal');
const tony = await mk('Tony Two');
const vito = await mk('Vito Rags');
const nick = await mk('Nicky Cuts');
const rookie = await mk('Fresh Meat');   // stays level 1 for the level gate
for (const c of [boss, tony, vito, nick]) await kit(c.id);

// the level gate — a fresh street can't start a crew
assert.equal((await call('POST', '/v1/crew', { token: rookie.token, body: { name: 'The Nobodies' } })).body.error, 'level',
  `level ${CREW.MIN_LEVEL} to start a crew`);
// name bounds
assert.equal((await call('POST', '/v1/crew', { token: boss.token, body: { name: 'ab' } })).body.error, 'name', 'name floor');
// form it
let r = await call('POST', '/v1/crew', { token: boss.token, body: { name: 'The Dockside Boys' } });
assert.equal(r.code, 200, `the crew forms (${JSON.stringify(r.body)})`);
const crewId = r.body.id;
assert.equal((await call('POST', '/v1/crew', { token: boss.token, body: { name: 'Another' } })).body.error, 'in_crew', 'one crew per man');
assert.equal((await call('POST', '/v1/crew', { token: tony.token, body: { name: 'The Dockside Boys' } })).body.error, 'taken', 'unique name');

// invite → accept
assert.equal((await invite(boss, boss)).body.error, 'self', 'no inviting yourself');
assert.equal((await invite(boss, tony)).code, 200, 'Tony is asked');
assert.equal((await invite(boss, tony)).body.error, 'already', 'no double-ask');
// Tony sees the invite on his board
let tb = (await call('GET', '/v1/crew', { token: tony.token })).body;
assert.equal(tb.crew, null, 'Tony has no crew yet');
assert.equal(tb.invites.length, 1, 'and one invite waiting');
assert.equal(tb.invites[0].name, 'The Dockside Boys', 'from the right crew');
// a stranger cannot accept an invite that was not theirs
assert.equal((await call('POST', `/v1/crew/accept/${crewId}`, { token: vito.token })).body.error, 'no_invite', "you can't gatecrash");
assert.equal((await call('POST', `/v1/crew/accept/${crewId}`, { token: tony.token })).code, 200, 'Tony joins');
// the board shows both, the leader flagged
let bb = (await call('GET', '/v1/crew', { token: boss.token })).body;
assert.equal(bb.crew.members.length, 2, 'two on the board');
assert.equal(bb.crew.members.find((m) => m.isMe).leader, true, 'the boss is flagged leader');
assert.equal(bb.crew.members.find((m) => m.name === 'Tony Two').level >= 3, true, 'members carry live level');

// the cap — fill to MAX_MEMBERS, then the next invite is refused at the door
for (const c of [vito, nick]) {
  await invite(boss, c);
  await call('POST', `/v1/crew/accept/${crewId}`, { token: c.token });
}
assert.equal((await call('GET', '/v1/crew', { token: boss.token })).body.crew.members.length, CREW.MAX_MEMBERS, 'crew is full');
assert.equal((await invite(boss, rookie)).body.error, 'full', `no room past ${CREW.MAX_MEMBERS}`);

// kick — leader only, and never themselves
assert.equal((await call('DELETE', `/v1/crew/member/${nick.id}`, { token: tony.token })).body.error, 'not_leader', 'only the boss cuts a man');
assert.equal((await call('DELETE', `/v1/crew/member/${boss.id}`, { token: boss.token })).body.error, 'self', 'leave to step down');
assert.equal((await call('DELETE', `/v1/crew/member/${nick.id}`, { token: boss.token })).code, 200, 'Nicky is cut loose');
assert.equal((await call('GET', '/v1/crew', { token: nick.token })).body.crew, null, "and he's out");

// succession — the boss walks, the oldest remaining member (Tony) inherits
assert.equal((await call('POST', '/v1/crew/leave', { token: boss.token })).code, 200, 'the boss walks');
const led = (await pool.query('SELECT leader_account FROM crews WHERE id=$1', [crewId])).rows[0].leader_account;
assert.equal(led, await acctOf(tony.id), 'Tony inherits the crew');

// ════════════ B · NON-AGGRESSION (the omertà twin) ════════════
// a clean 2-man crew: A leads, B joins. A jumps B → blocked. rat forfeits it. leaving breaks it.
const a = await mk('Shooter A'); const b = await mk('Shooter B');
for (const c of [a, b]) await kit(c.id);
await call('POST', '/v1/crew', { token: a.token, body: { name: 'Two Guns' } });
await invite(a, b);
const twoGuns = (await call('GET', '/v1/crew', { token: a.token })).body.crew.id;
await call('POST', `/v1/crew/accept/${twoGuns}`, { token: b.token });

assert.equal((await call('POST', `/v1/streets/${b.id}/jump`, { token: a.token })).body.error, 'crew',
  'you do not raise a hand to your own crew');
// a RAT crewmate forfeits the shield (the omertà exception)
await pool.query('UPDATE account_persistent SET rat=true WHERE account_id=$1', [await acctOf(b.id)]);
assert.notEqual((await call('POST', `/v1/streets/${b.id}/jump`, { token: a.token })).body.error, 'crew',
  'a rat is fair game — the shield is void');
await pool.query('UPDATE account_persistent SET rat=false WHERE account_id=$1', [await acctOf(b.id)]);
await kit(b.id);   // patch him up after the rat jump
// and LEAVING breaks it — the pact is opt-in, and walking away ends it
assert.equal((await call('POST', `/v1/streets/${b.id}/jump`, { token: a.token })).body.error, 'crew', 'still shielded while crewed');
await call('POST', '/v1/crew/leave', { token: b.token });
assert.notEqual((await call('POST', `/v1/streets/${b.id}/jump`, { token: a.token })).body.error, 'crew',
  'once he walks, he is fair game again');

// ════════════ C · THE CREW ROOM (the small-group chat channel) ════════════
assert.equal((await call('POST', '/v1/crew/chat', { token: nick.token, body: { text: 'anyone home?' } })).body.error, 'no_crew',
  'no crew, no room');
assert.equal((await call('POST', '/v1/crew/chat', { token: tony.token, body: { text: 'meet at the docks' } })).code, 200, 'a crewmate talks');
const room = (await call('GET', '/v1/crew/chat', { token: vito.token })).body.messages;
assert.equal(room.some((m) => m.text === 'meet at the docks'), true, 'and the crew reads it');
assert.deepEqual((await call('GET', '/v1/crew/chat', { token: nick.token })).body.messages, [], 'an outsider reads nothing');

// ════════════ C2 · THE CREW HIT (step two) — the shared target ════════════
// tony now leads The Dockside Boys (tony + vito). nick is solo again (cut loose).
await seed(tony.id, 'cash=200000');   // to fund the standing contract
assert.equal((await call('POST', '/v1/crew/target', { token: vito.token, body: { name: 'Fresh Meat' } })).body.error, 'not_leader',
  'only the boss calls the target');
assert.equal((await call('POST', '/v1/crew/target', { token: tony.token, body: { name: 'Vito Rags' } })).body.error, 'crew',
  'the crew never calls a hit on its own');
assert.equal((await call('POST', '/v1/crew/target', { token: tony.token, body: { name: 'Fresh Meat', kind: 'kill' } })).code, 200,
  'the boss calls a hit on a rival');
let db = (await call('GET', '/v1/crew', { token: vito.token })).body.crew;
assert.equal(db.target && db.target.name, 'Fresh Meat', 'the whole crew sees the mark');
assert.equal(db.target.kind, 'kill', 'and the kind of hit');
assert.equal(typeof db.target.pot, 'number', 'with the standing pot on their head');
// the crew CHIPS IN via the EXISTING contract board (postBounty) — the audited escrow, not a new one
assert.equal((await call('POST', `/v1/streets/${db.target.characterId}/bounty`, { token: tony.token, body: { amount: 6000, kind: 'kill' } })).code, 200,
  'a crewmate funds the standing contract');
assert(Number((await call('GET', '/v1/crew', { token: tony.token })).body.crew.target.pot) >= 6000, 'the pot on the mark grows');
assert.equal((await call('DELETE', '/v1/crew/target', { token: tony.token })).code, 200, 'the boss calls it off');
assert.equal((await call('GET', '/v1/crew', { token: tony.token })).body.crew.target, null, 'and the board clears');

// non-aggression extends to the contract board — no putting a price on your own crew's head
assert.equal((await call('POST', `/v1/streets/${vito.id}/bounty`, { token: tony.token, body: { amount: 6000, kind: 'kill' } })).body.error, 'crew',
  'you do not post a contract on your own crew');

// ════════════ C3 · THE CREW LEADERBOARD — the deadliest crews (pure status) ════════════
await pool.query('UPDATE account_persistent SET kills=5 WHERE account_id=$1', [await acctOf(tony.id)]);
await pool.query('UPDATE account_persistent SET kills=3 WHERE account_id=$1', [await acctOf(vito.id)]);
const board = (await call('GET', '/v1/leaderboard/crews', { token: tony.token })).body.crews;
const dockside = board.find((c) => c.name === 'The Dockside Boys');
assert(dockside, 'the crew is on the leaderboard');
assert.equal(dockside.kills, 8, 'ranked by combined lifetime kills');
assert.equal(dockside.members, 2, 'and its size');

// ════════════ C4 · RECRUITING + JOIN REQUESTS (step two) — the push half ════════════
// tony leads The Dockside Boys (tony + vito, room for 2). rookie is solo. rookie asks to join.
const dockId = (await call('GET', '/v1/crew', { token: tony.token })).body.crew.id;
// a CLOSED crew refuses requests
assert.equal((await call('POST', `/v1/crew/request/${dockId}`, { token: rookie.token })).body.error, 'closed', "a closed crew won't take requests");
// only the boss opens the doors
assert.equal((await call('POST', '/v1/crew/recruiting', { token: vito.token, body: { on: true } })).body.error, 'not_leader', 'only the boss recruits');
assert.equal((await call('POST', '/v1/crew/recruiting', { token: tony.token, body: { on: true } })).body.crew, 'recruiting', 'the boss opens the doors');
// rookie asks, once
assert.equal((await call('POST', `/v1/crew/request/${dockId}`, { token: rookie.token })).code, 200, 'rookie asks to join');
assert.equal((await call('POST', `/v1/crew/request/${dockId}`, { token: rookie.token })).body.error, 'already', 'no double-asking');
// the request is on tony's plate (keyed by the requester's living character, no account uuid)
const tbd = (await call('GET', '/v1/crew', { token: tony.token })).body.crew;
assert.equal(tbd.recruiting, true, 'the board shows the crew is recruiting');
assert.equal((tbd.requests || []).some((r) => r.name === 'Fresh Meat'), true, 'the leader sees the join request');
assert.equal(tbd.requests.every((r) => r.accountId === undefined), true, 'and never a raw account id');
// a non-leader cannot accept; the boss can
assert.equal((await call('POST', `/v1/crew/request/${rookie.id}/accept`, { token: vito.token })).body.error, 'not_leader', 'only the boss lets a man in');
assert.equal((await call('POST', `/v1/crew/request/${rookie.id}/accept`, { token: tony.token })).code, 200, 'the boss takes rookie in');
assert.equal((await call('GET', '/v1/crew', { token: rookie.token })).body.crew.name, 'The Dockside Boys', 'rookie is in');
// decline: nick asks, tony turns him away
await call('POST', '/v1/crew/request/' + dockId, { token: nick.token });
assert.equal((await call('DELETE', `/v1/crew/request/${nick.id}`, { token: tony.token })).body.crew, 'turned_away', 'the boss can turn a man away');
assert.equal((await call('GET', '/v1/crew', { token: nick.token })).body.crew, null, 'and he stays out');

// ════════════ D · §10.4 — the whole thing moves no value ════════════
assert.equal(await one("SELECT COUNT(*) n FROM transactions WHERE reason LIKE 'crew%'"), 0,
  'THE CREW writes no ledger rows — there is no crew: vocabulary');
{ // a pure crew op (form → invite → accept → leave) must not move the character-cash identity
  const before = await driftOf('character cash');
  const x = await mk('Ledger Probe'); const y = await mk('Ledger Probe Two');
  await kit(x.id); await kit(y.id);
  await call('POST', '/v1/crew', { token: x.token, body: { name: 'No Money Here' } });
  const cid = (await call('GET', '/v1/crew', { token: x.token })).body.crew.id;
  await invite(x, y);
  await call('POST', `/v1/crew/accept/${cid}`, { token: y.token });
  await call('POST', '/v1/crew/leave', { token: y.token });
  assert.equal(await driftOf('character cash'), before, 'the cash identity did not move across the crew flow');
}

// the worker sweep — a stale invite AND a stale join request are tidied (row hygiene). nick is solo
// (declined above), so both an invite to him and a request from him are live to sweep.
await invite(tony, nick);
await call('POST', '/v1/crew/recruiting', { token: tony.token, body: { on: true } });
await call('POST', '/v1/crew/request/' + dockId, { token: nick.token });
await pool.query("UPDATE crew_invites SET at = now() - interval '10 days'");
await pool.query("UPDATE crew_requests SET at = now() - interval '10 days'");
assert.equal((await sweepCrewInvites(pool)).swept >= 2, true, 'the worker sweeps stale invites AND requests');

// ════════════ (red-team F3) OUTSTANDING-INVITE CAP — a crew of one can't blast distinct-player spam ════════════
{
  const spamBoss = await mk('Spam Boss'); await seed(spamBoss.id, 'respect=500');
  await call('POST', '/v1/crew', { token: spamBoss.token, body: { name: 'The Spammers' } });
  // fire MAX_MEMBERS invites to distinct fresh players WITHOUT any accepting — pending piles up
  for (let i = 0; i < CREW.MAX_MEMBERS; i++) {
    const tgt = await mk('Spam Target ' + i);
    assert.equal((await invite(spamBoss, tgt)).code, 200, `invite ${i} goes out`);
  }
  // the next one is refused — a 1-man crew can't have more pending invites than it could seat
  const overflow = await mk('One Too Many');
  assert.equal((await invite(spamBoss, overflow)).body.error, 'too_many_pending', `outstanding invites are capped at ${CREW.MAX_MEMBERS} (F3 — no notification spam)`);
}

// ════════════ THE CREW OBJECTIVE — the weekly shared goal ════════════
{
  const { bumpCrewObjective } = await import('../src/game.js');
  const { weekOf, crewObjectiveOf } = await import('../src/rules.js');

  // the draw is DETERMINISTIC (same crew + week → same goal) and the target scales with crew size
  const wk = weekOf();
  const a = crewObjectiveOf('crewX', wk, 3), b = crewObjectiveOf('crewX', wk, 3);
  assert.deepEqual(a, b, 'the weekly objective is deterministic per crew+week');
  assert.equal(crewObjectiveOf('crewX', wk, 4).target, crewObjectiveOf('crewX', wk, 1).target * 4, 'the target scales with crew size');

  // a fresh crew of two
  const cap = await mk('Cap One'); const hand = await mk('Hand Two'); const idle = await mk('Idle Three');
  for (const c of [cap, hand, idle]) await seed(c.id, 'respect=5000');
  const cid = (await call('POST', '/v1/crew', { token: cap.token, body: { name: 'The Weekly Job' } })).body.id;
  await invite(cap, hand); await call('POST', `/v1/crew/accept/${cid}`, { token: hand.token });
  await invite(cap, idle); await call('POST', `/v1/crew/accept/${cid}`, { token: idle.token });
  const capA = await acctOf(cap.id), handA = await acctOf(hand.id), idleA = await acctOf(idle.id);

  // a bump on a FRESH week MATERIALIZES the drawn objective (the draw path)
  const fresh = await mk('Solo Draw'); await seed(fresh.id, 'respect=5000');
  const fid = (await call('POST', '/v1/crew', { token: fresh.token, body: { name: 'Draw Test' } })).body.id;
  const fA = await acctOf(fresh.id);
  // a SMALL non-completing delta: +1 crime can never crack a 40-target crimes goal, and feeds neither
  // the kills nor earn goals — so whatever kind this crew's (random) UUID draws, it never completes
  // and never fires a spurious crew_objective_done ping (the recorded flake class: a deterministic
  // count assertion must not rest on a seed-dependent precondition).
  await bumpCrewObjective(pool, { owned: { crewId: fid } }, { id: fresh.id, account_id: fA }, { crimes: 1 });
  assert.equal(await one('SELECT COUNT(*) n FROM crew_objectives WHERE crew_id=$1 AND week=$2', [fid, wk]), 1, 'a bump materializes the week objective (the §7.11 draw)');
  assert.equal(await one('SELECT COALESCE(done,false)::int n FROM crew_objectives WHERE crew_id=$1 AND week=$2', [fid, wk]), 0, 'the small probe never completes the fresh crew (whatever kind it drew)');

  // PIN a known goal on the real crew so the cycle is deterministic (kind=crimes, target=2)
  await pool.query('INSERT INTO crew_objectives (crew_id, week, kind, target) VALUES ($1,$2,$3,$4)', [cid, wk, 'crimes', 2]);
  // a delta for the WRONG kind is a clean no-op (an `earn` job doesn't feed a `crimes` goal)
  await bumpCrewObjective(pool, { owned: { crewId: cid } }, { id: cap.id, account_id: capA }, { earn: 999999 });
  assert.equal(await one('SELECT progress n FROM crew_objectives WHERE crew_id=$1 AND week=$2', [cid, wk]), 0, 'a non-matching delta does not advance the goal');

  // TWO members each pull a job — the second crossing latches DONE, bumps the crew legend, pings everyone
  await bumpCrewObjective(pool, { owned: { crewId: cid } }, { id: cap.id, account_id: capA }, { crimes: 1 });
  let obj = (await call('GET', '/v1/crew', { token: cap.token })).body.crew.objective;
  assert.equal(obj.progress, 1, 'the crew total is the sum of contributions'); assert.equal(obj.done, false, 'not cracked at 1 of 2');
  await bumpCrewObjective(pool, { owned: { crewId: cid } }, { id: hand.id, account_id: handA }, { crimes: 1 });
  obj = (await call('GET', '/v1/crew', { token: cap.token })).body.crew.objective;
  assert.equal(obj.done, true, 'the target is cracked'); assert.equal(obj.progress, 2, 'progress at target');
  assert.equal(await one('SELECT objectives_done n FROM crews WHERE id=$1', [cid]), 1, 'the crew legend bumped once on completion');
  // the per-member contribution texture ("what your crew did")
  assert.equal(obj.contributions.length, 2, 'both contributors listed');
  assert.equal(obj.mine, 1, 'the caller sees their own contribution');
  // (red-team R28 F1) agents don't draw the crew cash faucet — its siblings streak:daily / mentor:protege
  // exclude agents, and this one didn't. A contributing agent member is refused at claim.
  await pool.query('UPDATE account_persistent SET agent_flag=true WHERE account_id=$1', [handA]);
  assert.equal((await call('POST', '/v1/crew/objective/claim', { token: hand.token })).body.error, 'agent', 'an agent member cannot draw the crew cut');
  await pool.query('UPDATE account_persistent SET agent_flag=false WHERE account_id=$1', [handA]);
  assert.equal((await call('POST', '/v1/crew/objective/claim', { token: hand.token })).body.crew, 'objective_claimed', 'a human member collects normally');
  // (red-team R28 #4) bumpCrewObjective must lock the objective row FOR UPDATE before the SUM+progress
  // write, so two crewmates bumping concurrently (each under its own char lock) can't store a stale
  // progress / delay completion a bump. pg-mem is single-caller — a labelled source tripwire.
  {
    const gameSrc = _readSrc(new URL('../src/game.js', import.meta.url), 'utf8');
    const bump = gameSrc.slice(gameSrc.indexOf('export async function bumpCrewObjective'), gameSrc.indexOf('export async function bumpCrewObjective') + 1600);
    assert(/FROM crew_objectives WHERE crew_id=\$1 AND week=\$2 FOR UPDATE/.test(bump), 'bumpCrewObjective locks the objective row FOR UPDATE');
  }
  assert.equal(obj.claimable, true, 'a contributor can claim a cracked objective');
  // everyone was pinged (the synchronous "your crew is active" moment) — scoped to THIS crew's three
  // members, so a completion on any OTHER crew in the DB can never perturb the count
  assert.equal(await one("SELECT COUNT(*) n FROM notifications WHERE type='crew_objective_done' AND character_id IN ($1,$2,$3)", [cap.id, hand.id, idle.id]), 3, 'every living member of this crew is pinged on completion');

  // capture the pre-existing per-character cash drift (earlier blocks jump + SQL-seed) so we can
  // assert the CLAIM adds none of its own
  const deltaBase = await driftOf('character cash');
  // CLAIM — a contributor collects exactly REWARD cash, ledgered `crew:objective`, once per week
  const before = Number((await call('GET', '/v1/me', { token: cap.token })).body.character.cash);
  const cl = await call('POST', '/v1/crew/objective/claim', { token: cap.token });
  assert.equal(cl.body.reward, CREW.OBJECTIVE.REWARD, 'the cut is the objective reward');
  const after = Number((await call('GET', '/v1/me', { token: cap.token })).body.character.cash);
  assert.equal(after - before, CREW.OBJECTIVE.REWARD, 'the cash landed');
  assert.equal(await one("SELECT COUNT(*) n FROM transactions WHERE character_id=$1 AND reason='crew:objective'", [cap.id]), 1, 'one ledgered crew:objective faucet row');
  assert.equal((await call('POST', '/v1/crew/objective/claim', { token: cap.token })).body.error, 'claimed', 'no second claim in a week');
  // a member who did NOTHING this week has no cut (they have no contribution row)
  assert.equal((await call('POST', '/v1/crew/objective/claim', { token: idle.token })).body.error, 'no_share', "a member who didn't work the job gets no cut");

  // §10.4 — the reward is a recognized, character_id'd faucet. Earlier blocks in this suite SQL-seed
  // and jump (a non-zero baseline by construction — the scale/loadtest posture), so we assert the
  // DELTA the objective adds is zero: a claim moves the crew's cash within the ledgered set, and the
  // `crew:objective` reason is in the vocabulary so it raises no unknown-reason alarm.
  const dBefore = deltaBase;
  const dAfter = await driftOf('character cash');
  assert.equal(dAfter - dBefore, 0, 'the crew:objective faucet reconciles (adds zero per-character cash drift)');
  // the reason is recognized — no `unknown cash reason` alarm anywhere
  assert.equal(await driftOf('reason vocabulary'), 0, 'crew:objective is a recognized cash reason');
}

console.log('crew: PASS');
await app.close();
process.exit(0);

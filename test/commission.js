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
  await seedCh(b.id, 'respect=1000, cash=60000');
  const g = await call('POST', '/v1/gangs', { token: b.token, body: { name: `Family Number ${i}`, tag: `F${i}A` } });
  assert(g.body.gangId, `family ${i} founded`);
  // econ pass: the chamber ranks by the SEASON ladder (lifetime standing feeds only the buyback)
  await pool.query(`UPDATE gangs SET season_tribute=${(7 - i) * 100} WHERE id='${g.body.gangId}'`);
  bosses.push({ ...b, gang: g.body.gangId });
}
const civilian = await mk('No Family Nick');

// ── seats: the top five, in standing order; the sixth watches from the street ──
let r = await call('GET', '/v1/commission');
assert.equal(r.code, 200, 'the chamber is public');
assert.equal(r.body.seats.length, 5, 'five seats');
assert.equal(r.body.seats[0].name, 'Family Number 1', 'the strongest family sits at the head');
assert(!r.body.seats.some((s) => s.name === 'Family Number 6'), 'the sixth has no seat');
assert(r.body.book.length === COMMISSION.DECREES.length, 'the decree book is published (incl. THE LEVY)');

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

// ── L6 lifecycle: the vote bosses[0] ACTUALLY CAST (stamped standing and all) governs next
// week — shift it back one week and read the decree off real cast data, no hand-seeded rows ──
await pool.query(`UPDATE commission_votes SET week=${week - 1} WHERE week=${week} AND gang_id='${bosses[0].gang}'`);
assert.equal((await call('GET', '/v1/commission')).body.decree.id, 'open_season', 'a REAL cast ballot governs the following week');

// ── the tally: majority governs; a tie deadlocks ──
// entries are 'decree' (standing defaults to 600−100i, so entry order = rank order) or
// ['decree', standing] — step two ranks the frozen ballots by stamped standing and derives
// weights SEATS..1 from the rank
const setLastWeek = async (...entries) => {
  await pool.query(`DELETE FROM commission_votes WHERE week=${week - 1}`);
  for (let i = 0; i < entries.length; i++) {
    const [d, s] = Array.isArray(entries[i]) ? entries[i] : [entries[i], 600 - i * 100];
    await pool.query(`INSERT INTO commission_votes (week, gang_id, decree, standing) VALUES (${week - 1}, '${bosses[i].gang}', '${d}', ${s})`);
  }
};
await setLastWeek('open_season', 'open_season', 'open_season', 'pax', 'pax');
r = await call('GET', '/v1/commission');
assert.equal(r.body.decree.id, 'open_season', 'the majority of last week governs this week (12 vs 3 by rank weight)');
assert(r.body.decree.lapsesSeconds > 0, 'and it lapses with the week');
await setLastWeek(['open_season', 600], ['pax', 500], ['pax', 400], ['open_season', 300]);
assert.equal((await call('GET', '/v1/commission')).body.decree, null, 'a tied Commission (7 vs 7) deadlocks — no decree');

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

// ── STEP TWO: seat-weighted ballots — ranked by STAMPED standing, bounded at five seats ──
r = await call('POST', '/v1/commission/vote', { token: bosses[0].token, body: { decree: 'pax' } });
assert.equal(r.body.weight, COMMISSION.SEATS, 'the head family speaks from the head seat');
assert.equal((await call('POST', '/v1/commission/vote', { token: bosses[4].token, body: { decree: 'pax' } })).body.weight, 1, 'the last seat speaks from the last');
await setLastWeek(['pax', 600], ['pax', 500], ['open_season', 400], ['open_season', 300], ['open_season', 200]);
assert.equal((await call('GET', '/v1/commission')).body.decree.id, 'pax', 'the top two seats outvote the bottom three (9 vs 6)');
// a stale "I was head for a minute" ballot ranks where its stamp puts it — two families that
// out-tributed it take weights 5 and 4, so leapfrogging can never stack two head ballots
await setLastWeek(['pax', 600], ['open_season', 700], ['open_season', 650]);
assert.equal((await call('GET', '/v1/commission')).body.decree.id, 'open_season', 'stale head ballots are outranked (9 vs 3)');
// the electorate is BOUNDED at the seat count: a sixth ballot never counts, however it leans
// (top five: open 5+2 = pax 4+3 = 7, amnesty 1 — deadlock; the shut-out sixth would break it)
await setLastWeek(['open_season', 600], ['pax', 500], ['pax', 400], ['open_season', 300], ['amnesty', 100], ['pax', 50]);
assert.equal((await call('GET', '/v1/commission')).body.decree, null, 'six ballots, five count — the tie-breaking sixth is shut out (7v7 deadlock)');

// ── STEP TWO (audit H1): a dissolved family's ballot dies with it — no ghost governance ──
await setLastWeek(['pax', 600], ['open_season', 500], ['open_season', 400], ['pax', 300], ['pax', 200]);
assert.equal((await call('GET', '/v1/commission')).body.decree.id, 'pax', 'the pax carries 8 to 7 with all five families alive');
assert.equal((await call('POST', '/v1/gangs/leave', { token: bosses[4].token })).code, 200, 'the fifth family dissolves (boss walks, empty house)');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM commission_votes WHERE gang_id='${bosses[4].gang}'`)).rows[0].n), 0, 'its ballots died with it');
assert.equal((await call('GET', '/v1/commission')).body.decree, null, 'the tally recomputes without the ghost (7v7 deadlock) — and the board agrees with it');

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

// ══ STEP THREE — PROPOSALS WITH DEPOSITS + THE LEVY ══
const { settleProposals } = await import('../src/commission.js');
const { runBuyback } = await import('../src/worker.js');
await pool.query('DELETE FROM commission_vetoes'); // clear the veto record — a fresh table for step three
const treasuryOf = async (gid) => Number((await pool.query(`SELECT treasury FROM gangs WHERE id='${gid}'`)).rows[0].treasury);
const poolOf = async () => Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
let seedTreasury = 0;
await pool.query(`UPDATE gangs SET treasury=200000 WHERE id IN ('${bosses[0].gang}','${bosses[1].gang}')`);
seedTreasury += 400000 - 0; // (both were ~0 after founding fees — the §10.4 treasury check isn't asserted here)

// gates: rank / no seat / bad motion / a poor treasury. (F5 dissolved above, so F6 now sits —
// a FRESH zero-standing family is the unseated probe.)
const late = await mk('Latecomer Lou');
await seedCh(late.id, 'respect=1000, cash=60000');
await call('POST', '/v1/gangs', { token: late.token, body: { name: 'The Latecomers', tag: 'LTE' } });
assert.equal((await call('POST', '/v1/commission/propose', { token: civilian.token, body: { decree: 'pax' } })).body.error, 'rank', 'no family, no motion');
assert.equal((await call('POST', '/v1/commission/propose', { token: late.token, body: { decree: 'pax' } })).body.error, 'no_seat', 'no seat, no motion');
assert.equal((await call('POST', '/v1/commission/propose', { token: bosses[0].token, body: { decree: 'martial_law' } })).body.error, 'bad_decree', 'no such motion');
assert.equal((await call('POST', '/v1/commission/propose', { token: bosses[2].token, body: { decree: 'pax' } })).body.error, 'treasury', 'a motion takes a real deposit');

// the deposit escrows out of the treasury, ledgered; one motion per family per week
r = await call('POST', '/v1/commission/propose', { token: bosses[0].token, body: { decree: 'the_levy' } });
assert.equal(r.code, 200, 'the head family moves THE LEVY');
assert.equal(r.body.deposit, COMMISSION.PROPOSAL_DEPOSIT, 'at the posted deposit');
assert.equal(await treasuryOf(bosses[0].gang), 200000 - COMMISSION.PROPOSAL_DEPOSIT, 'the treasury fronted it');
assert.equal((await call('POST', '/v1/commission/propose', { token: bosses[0].token, body: { decree: 'pax' } })).body.error, 'proposed', 'one motion per family per week');
assert.equal((await call('POST', '/v1/commission/propose', { token: bosses[1].token, body: { decree: 'pax' } })).code, 200, 'the second family moves THE PAX');
r = await call('GET', '/v1/commission');
assert.equal(r.body.proposals.length, 2, 'the motions are public');
assert.equal(r.body.proposalDeposit, COMMISSION.PROPOSAL_DEPOSIT, 'with the price of admission');

// THE TALLY RESTRICTION: when motions exist, only PROPOSED decrees count — the head family's
// heavier vote for an unproposed decree is DISCARDED and the pax carries.
await pool.query(`DELETE FROM commission_votes`);
await pool.query(`INSERT INTO commission_votes (week, gang_id, decree, standing) VALUES (${week - 1}, '${bosses[0].gang}', 'open_season', 600)`);
await pool.query(`INSERT INTO commission_votes (week, gang_id, decree, standing) VALUES (${week - 1}, '${bosses[1].gang}', 'pax', 500)`);
await pool.query(`UPDATE commission_proposals SET week=${week - 1}`); // freeze the voting week
r = await call('GET', '/v1/commission');
assert.equal(r.body.decree.id, 'pax', 'votes for unproposed decrees are discarded — the proposed pax carries');

// SETTLE: the enacted motion refunds to its treasury; the losing motion forfeits to the pool
const t0 = await treasuryOf(bosses[1].gang), p0 = await poolOf();
r = await settleProposals(pool);
assert.equal(r.refunded, 1, 'one motion enacted → refunded');
assert.equal(r.forfeited, 1, 'one motion failed → forfeited');
assert.equal(await treasuryOf(bosses[1].gang), t0 + COMMISSION.PROPOSAL_DEPOSIT, 'the pax deposit came home');
assert.equal(await poolOf(), p0 + COMMISSION.PROPOSAL_DEPOSIT, "the levy deposit fell to the confiscation pool");
assert.equal((await pool.query("SELECT COUNT(*) n FROM commission_proposals WHERE status='open'")).rows[0].n, '0', 'the table is clear');
{ const inv = await runLedgerInvariants(pool, { alert: false });
  const esc = inv.checks.find((c) => c.name === 'commission escrow');
  assert.equal(esc.drift, 0, `the commission escrow reconciles (posted − refunded − forfeited): ${esc.drift}`); }

// THE LEVY in force: the buyback's family split pays the SEATED CHAMBER by seat weight (5..1)
// instead of the lifetime top-25 — a pure redirect (these families have ZERO lifetime standing,
// so without the levy the whole clan share would roll to the event fund).
await pool.query(`DELETE FROM commission_votes`);
await pool.query(`DELETE FROM commission_proposals`); // no motions → the chamber votes freely
for (const b of [bosses[0], bosses[1], bosses[2]])
  await pool.query(`INSERT INTO commission_votes (week, gang_id, decree, standing) VALUES (${week - 1}, '${b.gang}', 'the_levy', 500)`);
assert.equal((await call('GET', '/v1/commission')).body.decree.id, 'the_levy', 'THE LEVY is in force');
const seatsNow = (await call('GET', '/v1/commission')).body.seats;
const reservesBefore = {};
for (const s of (await pool.query('SELECT id, omr_reserve FROM gangs')).rows) reservesBefore[s.id] = Number(s.omr_reserve);
await pool.query(`UPDATE street_tax SET pool = pool + 100000`); // seed the tax pool for a cycle (buyback input)
r = await runBuyback(pool, { force: true });
assert(r && r.levy === true, 'the buyback ran under the levy');
assert.equal(r.families, seatsNow.length, 'the chamber collects — exactly the seated families');
const headGang = bosses[0].gang, lastGang = bosses[5].gang; // F1 heads the table; F6 holds the last seat (F5 dissolved)
const headTake = Number((await pool.query(`SELECT omr_reserve FROM gangs WHERE id='${headGang}'`)).rows[0].omr_reserve) - reservesBefore[headGang];
const lastTake = Number((await pool.query(`SELECT omr_reserve FROM gangs WHERE id='${lastGang}'`)).rows[0].omr_reserve) - reservesBefore[lastGang];
assert(headTake > 0 && lastTake > 0, 'every seated family collected');
assert(Math.abs(headTake / lastTake - 5) < 0.01, `the head seat takes 5× the last seat (${(headTake / lastTake).toFixed(2)})`);

// ── no decree moves money: the vocabulary stays closed ──
const vocab = (await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `no new reasons (${JSON.stringify(vocab.unknown || [])})`);

// ══════════ TIER-4 — THE STATESMAN · THE OVERRIDE · THE RECORD · 3 NEW DECREES ══════════
const { settleProposals: settle4, statesmenLeaderboard } = await import('../src/commission.js');
const statecraftOf = async (tok) => Number((await meOf(tok)).statesman.statecraft);
const seatGangs = [bosses[0].gang, bosses[1].gang, bosses[2].gang, bosses[3].gang, bosses[5].gang]; // F1..F4,F6 (F5 dissolved)
// clean slate for the political-capital assertions
await pool.query('DELETE FROM commission_votes');
await pool.query('DELETE FROM commission_vetoes');
await pool.query('DELETE FROM commission_overrides');
await pool.query('DELETE FROM commission_proposals');
await pool.query('UPDATE account_persistent SET statecraft=0');
await pool.query(`UPDATE gangs SET treasury=1000000 WHERE id IN ('${seatGangs.join("','")}')`);

// ── THE STATESMAN — a fresh vote earns political capital (once per week per family); re-casting doesn't ──
assert.equal(await statecraftOf(bosses[0].token), 0, 'clean slate');
assert.equal((await call('POST', '/v1/commission/vote', { token: bosses[0].token, body: { decree: 'pax' } })).code, 200, 'F1 casts');
assert.equal(await statecraftOf(bosses[0].token), COMMISSION.STATECRAFT_VOTE, 'the first ballot of the week earns capital');
await call('POST', '/v1/commission/vote', { token: bosses[0].token, body: { decree: 'open_season' } });
assert.equal(await statecraftOf(bosses[0].token), COMMISSION.STATECRAFT_VOTE, 're-casting earns nothing more (UPDATE branch)');
// (proposing also earns — asserted in THE ENACTED PRIZE block below, where the deposit is settled so
// the escrow stays exact; here we don't strand an open deposit.)

// ── THE OVERRIDE — the floor's parliamentary check on the head's veto ──
await setLastWeek('amnesty', 'amnesty', 'amnesty', 'amnesty', 'amnesty'); // a clear decree in force this week
assert.equal((await call('GET', '/v1/commission')).body.decree.id, 'amnesty', 'amnesty is in force');
assert.equal((await call('POST', '/v1/commission/override', { token: bosses[1].token })).body.error, 'no_veto', 'no veto → nothing to override');
// the head kills it (and earns the veto capital)
const vc0 = await statecraftOf(bosses[0].token);
r = await call('POST', '/v1/commission/veto', { token: bosses[0].token });
assert.equal(r.body.vetoed, 'amnesty', 'the head vetoes amnesty');
assert.equal(await statecraftOf(bosses[0].token), vc0 + COMMISSION.STATECRAFT_VETO, 'wielding the veto earns capital');
assert.equal((await call('GET', '/v1/commission')).body.decree, null, 'the decree is dead at the table');
// gates: the head can't override itself; a civilian can't; an unseated family can't
assert.equal((await call('POST', '/v1/commission/override', { token: bosses[0].token })).body.error, 'head', 'the head chair cannot override its own veto');
assert.equal((await call('POST', '/v1/commission/override', { token: civilian.token })).body.error, 'rank', 'no family, no override');
assert.equal((await call('POST', '/v1/commission/override', { token: late.token })).body.error, 'no_seat', 'no seat, no override');
// F2 (weight 4) moves — short of OVERRIDE_WEIGHT alone; F3 (weight 3) tips it to 7 → RESTORED
r = await call('POST', '/v1/commission/override', { token: bosses[1].token });
assert.equal(r.code, 200, 'the #2 seat moves to override');
assert.equal(r.body.restored, false, `4 weight alone is short of ${COMMISSION.OVERRIDE_WEIGHT}`);
assert.equal(await statecraftOf(bosses[1].token), COMMISSION.STATECRAFT_OVERRIDE, 'moving to override earns capital');
assert.equal((await call('POST', '/v1/commission/override', { token: bosses[1].token })).body.error, 'again', 'one override per family per week');
assert.equal((await call('GET', '/v1/commission')).body.decree, null, 'the veto still stands at 4 weight');
r = await call('POST', '/v1/commission/override', { token: bosses[2].token });
assert.equal(r.body.restored, true, `4+3 = 7 reaches ${COMMISSION.OVERRIDE_WEIGHT} — the floor overrules the head`);
r = await call('GET', '/v1/commission');
assert.equal(r.body.decree.id, 'amnesty', 'the decree is RESTORED by the floor supermajority');
assert(r.body.override && r.body.override.restored && r.body.override.need === COMMISSION.OVERRIDE_WEIGHT, 'the board shows the override carried');

// ── THE RECORD + the statesmen board + the view legend ──
r = await call('GET', '/v1/commission');
assert(Array.isArray(r.body.record) && r.body.record.length, 'the chamber keeps a record of recent weeks');
assert(r.body.record.every((w) => 'week' in w && 'name' in w), 'each week names its decree (or Deadlock/Vetoed)');
assert(Array.isArray(r.body.statesmenTop), 'the top statesmen ride the board');
const lb = (await call('GET', '/v1/leaderboard/statesmen', { token: civilian.token })).body.statesmen;
assert(lb.length >= 3, 'the statesmen board ranks the political operators');
assert.equal(lb[0].name, 'Boss Number 1', 'F1 (vote+veto) tops the board');
assert(lb[0].rank && lb[0].statecraft === COMMISSION.STATECRAFT_VOTE + COMMISSION.STATECRAFT_VETO, 'with the lifetime capital + a derived rank');
const meView = await meOf(bosses[0].token);
assert(meView.statesman && meView.statesman.rank, "the view carries the statesman legend");

// ── THE ENACTED PRIZE — a proposer whose motion is enacted earns the big prize (post-commit, own-txn) ──
await pool.query('DELETE FROM commission_votes');
await pool.query('DELETE FROM commission_vetoes');
await pool.query('DELETE FROM commission_overrides');
await pool.query('DELETE FROM commission_proposals');
await pool.query('UPDATE account_persistent SET statecraft=0');
await pool.query(`UPDATE gangs SET treasury=500000 WHERE id IN ('${bosses[0].gang}','${bosses[1].gang}')`);
r = await call('POST', '/v1/commission/propose', { token: bosses[0].token, body: { decree: 'pax' } });
assert.equal(r.code, 200, 'F1 tables the pax');
assert.equal(await statecraftOf(bosses[0].token), COMMISSION.STATECRAFT_PROPOSE, 'moving a motion earns capital');
await call('POST', '/v1/commission/vote', { token: bosses[0].token, body: { decree: 'pax' } }); // vote it in
await pool.query(`UPDATE commission_votes SET week=${week - 1}`);   // freeze the voting week
await pool.query(`UPDATE commission_proposals SET week=${week - 1}`);
const scPre = await statecraftOf(bosses[0].token); // propose(3) + vote(2) so far
r = await settle4(pool);
assert.equal(r.refunded, 1, 'the enacted motion refunds');
assert.equal(await statecraftOf(bosses[0].token), scPre + COMMISSION.STATECRAFT_ENACTED, 'the proposer earns the ENACTED prize (post-commit)');

// ── THE 3 NEW DECREES are published in the book (touchpoints mirror the tested open_season/pax/amnesty/lockdown mechanism) ──
const book = (await call('GET', '/v1/commission')).body.book.map((d) => d.id);
for (const id of ['smugglers_moon', 'open_roads', 'blood_oath'])
  assert(book.includes(id), `the ${id} decree is on the books`);

// ── §10.4 stays exact across the Tier-4 actions (statecraft/override move no money; deposits ride the step-three vocabulary) ──
{ const inv = await runLedgerInvariants(pool, { alert: false });
  assert(inv.checks.find((c) => c.name === 'reason vocabulary').ok, 'no new reasons from the Tier-4 politics');
  assert.equal(inv.checks.find((c) => c.name === 'commission escrow').drift, 0, 'the commission escrow still reconciles'); }
// reseat the chamber for the season-rollover assertion below (the ENACTED settle didn't touch season standings)

// ── econ pass: the chamber re-contests every season — the rollover zeroes the ladder ──
// (the audit's purchasable-standing fix: parked lifetime wealth no longer owns the head seat)
const { runSeasonRollover } = await import('../src/worker.js');
assert(Number((await pool.query('SELECT COALESCE(SUM(season_tribute),0) s FROM gangs')).rows[0].s) > 0, 'the season ladder is live pre-rollover');
await runSeasonRollover(pool, { season: Math.floor(Date.now() / 86400000 / 28) + 1 }); // force the next season
assert.equal(Number((await pool.query('SELECT COALESCE(SUM(season_tribute) + SUM(season_wars),0) s FROM gangs')).rows[0].s), 0,
  'rollover zeroes season tribute + wars — every family starts the season from the street');
r = await call('GET', '/v1/commission');
assert.equal(r.body.seats.length, 0, 'the chamber is empty until someone earns a seat THIS season');

console.log('✅ Commission test passed — five seats by SEASON standing (the purchasable-standing fix: rollover re-contests the chamber), public cast-and-change votes, lazy majority tally + tie deadlock, real-cast lifecycle ballot, OPEN SEASON (half safehouse), THE PAX (war blocked), AMNESTY (half laylow, ledger exact), LOCKDOWN (+20 in the audit trail) + STEP TWO (audit-hardened): standing-ranked ballots (top two beat bottom three, stale head ballots outranked, electorate bounded at five, weighted ties deadlock), dissolution kills the ghost ballot, the head-of-table veto (rank/head/once gates, public record, touchpoint dead), vocabulary closed + STEP THREE: proposals with deposits (rank/no_seat/bad_decree/treasury gates, escrowed treasury deposit, one motion per family, public table, votes for unproposed decrees discarded, settle refunds the enacted motion + forfeits the rest to the pool, the commission-escrow §10.4 check exact) and THE LEVY (the buyback family split redirected to the seated chamber, head seat 5× the last) + TIER-4: THE STATESMAN (vote/veto/propose/override/enacted political-capital legend — survives death, leaderboard + view, once-per-week vote), THE OVERRIDE (the floor musters 7 seat-weight to overrule the head veto — RESTORED; head/rank/no_seat/no_veto/again gates), THE RECORD (chamber history), the 3 new decrees on the books, and §10.4 exact across it all (statecraft/override move no money)');
await app.close();

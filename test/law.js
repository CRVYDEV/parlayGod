// THE LAW / RICO / INFORMANTS test — the state antagonist across all four phases:
//   P1  the investigation meter builds from sustained heat + bleeds; the bribe (knock it down,
//       blocked when clean / indicted / safehoused) and the lawyer retainer (softens the bust).
//   P2  indictment (the meter crosses INDICT_AT) + the RICO bust: a conviction seizes pocket+bank
//       into the confiscation buffer (scoped §10.4: char delta == pool delta == −ledger), NOT death;
//       staked $OMR is safe; the worker sweep reaches the offline whale.
//   P3  the courtroom — plea (certain smaller loss), buy the jury ($OMR sink cuts the odds once),
//       demand trial (LAW_BUST_P pins the roll).
//   P4  the flip (drop the case, name a rival → seed their meter, earn the rat badge), the rat's
//       waived directed floor, witness protection (untargetable), and the informant collapse on
//       the witness's death.
// pg-mem, zero infra. §10.4 vocabulary stays closed.
process.env.MOD_KEY = 'test-mod-key';
// TEST-ONLY (the boot guard rejects it in production). The heat_exposure / laylow assertions here are
// deterministic values that rest on a probabilistic-by-DATE precondition: with SEASON_MODS armed, a
// day drawing The Crackdown scales lawGain ×1.25 (and laylow ×0.75) and an exact-value check fails for
// no visible reason (e.g. "a 30-day gap bleeds the case to nothing" reads 360, not 0). The recorded
// flake class — pin the season so the precondition is guaranteed rather than left to the calendar.
process.env.SEASON_MOD = 'dead_quiet';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { LAW } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { sweepLaw } from '../src/law.js';

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
  return { token, id: (await meOf(token)).id };
};
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);
const seedAcct = (id, cols) => pool.query(`UPDATE account_persistent SET ${cols} WHERE account_id=(SELECT account_id FROM characters WHERE id='${id}')`);
const rawCh = async (id) => (await pool.query(`SELECT * FROM characters WHERE id='${id}'`)).rows[0];
const ledgerOf = async (chId, reason) => Number((await pool.query(
  `SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE character_id='${chId}' AND reason='${reason}'`)).rows[0].s);
const omrLedgerOf = async (acctSubId, reason) => Number((await pool.query(
  `SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE account_id=(SELECT account_id FROM characters WHERE id='${acctSubId}') AND currency='omr' AND reason='${reason}'`)).rows[0].s);
const poolCash = async () => Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
const lawOf = async (t) => (await call('GET', '/v1/law', { token: t })).body;

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — the investigation meter
// ─────────────────────────────────────────────────────────────────────────────
const dan = await mk('Dirty Dan');
let board = await lawOf(dan.token);
assert.equal(board.stage, 'clean', 'a fresh street is clean');
assert.deepEqual(board.thresholds, { watched: LAW.WATCHED_AT, investigation: LAW.INVESTIGATE_AT, indict: LAW.INDICT_AT }, 'thresholds published');

// the meter RISES while heat is actively high…
await seedCh(dan.id, "heat_exposure=500, heat=100, last_accrued_at = now() - interval '10 minutes'");
await meOf(dan.token); // a touch runs accrual
let ch = await rawCh(dan.id);
assert(Number(ch.heat_exposure) > 500, `sustained heat builds the case (${Number(ch.heat_exposure)} > 500)`);
// …and BLEEDS when heat is cold (a spike-and-decay costs little)
await seedCh(dan.id, "heat_exposure=500, heat=0, last_accrued_at = now() - interval '30 minutes'");
await meOf(dan.token);
ch = await rawCh(dan.id);
assert(Number(ch.heat_exposure) < 500, `a cold street's case bleeds off (${Number(ch.heat_exposure)} < 500)`);

// AUDIT REGRESSION: the exposure GAIN is capped at the offline window (like income). A kitchen crew
// re-adds heat DURING accrual, so without the cap an OFFLINE dealer built a case over the whole
// multi-day gap and instant-indicted on login. Direct accrue() check (heat pins to 100 via the crew,
// so the gain is deterministic regardless of the day's event): a 2-day gap builds no MORE than an
// 8h one (gain capped — pre-fix it was ~6×), and a long AFK bleeds the case to nothing (bleed uncapped).
{
  const { accrue } = await import('../src/accrual.js');
  const hot = (await import('../src/rules.js')).DRUGS.slice(-1)[0].id;
  const run = (gapMs) => { const c = { respect: 2000, energy: 0, nerve: 0, health: 0, cash: 0, bank: 0, heat: 100,
    heat_exposure: 0, crew: 5, crew_paid_at: new Date(Date.now() - 3600000), racket_credit_ms: 0, bank_credit_ms: 0,
    last_accrued_at: new Date(Date.now() - gapMs), path: 'kitchen', loc: 'docks', indicted_at: null };
    accrue(c, { staked: 0 }, { stash: [{ drug_id: hot, qty: 100000, quality: 1 }], rackets: [], assets: [], held: [] }); return c; };
  const e8h = run(8 * 3600000).heat_exposure, e2d = run(2 * 86400000).heat_exposure, e30d = run(30 * 86400000).heat_exposure;
  assert(e2d <= e8h + 1, `a 2-day offline gap builds no more case than 8h — the gain is capped (${Math.round(e2d)} ≤ ${Math.round(e8h)})`);
  assert.equal(Math.round(e30d), 0, 'a long offline gap bleeds the case to nothing');
}

// the bribe — knock the case down a band (a wealth-scaled cash sink → the confiscation buffer)
await seedCh(dan.id, 'heat_exposure=2000, heat=50, cash=1000000, bank=0');
let pool0 = await poolCash();
let r = await call('POST', '/v1/law/bribe', { token: dan.token });
assert.equal(r.code, 200, 'bribe paid');
assert.equal(r.body.cost, 25000, 'the envelope is the floor at low exposure');
assert.equal(r.body.exposure, 2000 - LAW.BRIBE_CLEAR, 'the bribe knocks BRIBE_CLEAR off the meter');
assert.equal(await ledgerOf(dan.id, 'law:bribe'), -25000, 'the bribe is ledgered as a sink');
assert.equal((await poolCash()) - pool0, 25000, 'seized cash recycles into the buyback pool');

// bribe is refused when clean, and blocked from a safehouse (an exposed act — D2)
await seedCh(dan.id, 'heat_exposure=0');
assert.equal((await call('POST', '/v1/law/bribe', { token: dan.token })).body.error, 'clean', "nothing to bribe when you're off the radar");
await seedCh(dan.id, "heat_exposure=2000, safe_until = now() + interval '1 hour'");
assert.equal((await call('POST', '/v1/law/bribe', { token: dan.token })).body.error, 'safe', "no meeting a cop from a safehouse");
await seedCh(dan.id, 'safe_until = NULL');

// the lawyer — a time-boxed retainer that softens the coming bust
await seedCh(dan.id, 'cash=1000000');
pool0 = await poolCash();
r = await call('POST', '/v1/law/retainer', { token: dan.token });
assert.equal(r.code, 200, 'lawyer retained');
assert.equal(r.body.cost, LAW.RETAINER_COST, 'the retainer costs the sticker');
assert.equal(await ledgerOf(dan.id, 'law:retainer'), -LAW.RETAINER_COST, 'the retainer is a ledgered sink');
assert.equal((await poolCash()) - pool0, LAW.RETAINER_COST, 'the retainer feeds the pool too');
assert((await meOf(dan.token)).law.retainerSeconds > 0, 'the retainer window is live on the view');

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — indictment + the RICO bust + forfeiture
// ─────────────────────────────────────────────────────────────────────────────
// the meter CROSSES the indictment line → indicted (a latch), and the beat cop is off it
await seedCh(dan.id, "heat_exposure=2995, heat=100, retainer_until=NULL, last_accrued_at = now() - interval '10 minutes'");
await meOf(dan.token);
board = await lawOf(dan.token);
assert.equal(board.indicted, true, 'sustained recklessness files a RICO indictment');
assert.equal(board.stage, 'indicted', 'the rap sheet reads INDICTED');
assert.equal(board.bribeCost, null, 'a filed case is past the beat cop');
assert(board.convictionOdds > 0, 'the docket shows conviction odds');
assert.equal((await call('POST', '/v1/law/bribe', { token: dan.token })).body.error, 'indicted', 'bribe refused once indicted');

// buy the jury — a $OMR sink that cuts the odds once
await seedAcct(dan.id, 'omr=600');
const oddsBefore = (await lawOf(dan.token)).convictionOdds;
r = await call('POST', '/v1/law/jury', { token: dan.token });
assert.equal(r.code, 200, 'jury seen to');
assert.equal(r.body.spent, LAW.JURY_COST_OMR, 'the jury costs $OMR');
assert.equal(await omrLedgerOf(dan.id, 'law:jury'), -LAW.JURY_COST_OMR, 'the jury is a ledgered $OMR burn');
assert((await lawOf(dan.token)).convictionOdds < oddsBefore, 'a bought jury cuts the conviction odds');
assert.equal((await call('POST', '/v1/law/jury', { token: dan.token })).body.error, 'done', "the jury can't be bought twice");

// demand trial and CONVICT (LAW_BUST_P pins the roll) — forfeiture is a scoped §10.4 transfer
await seedCh(dan.id, 'cash=400000, bank=600000, heat_exposure=5000, jury_bought=false');
await seedAcct(dan.id, 'staked=50');
let before = await rawCh(dan.id);
const wealth0 = Number(before.cash) + Number(before.bank), pB = await poolCash();
process.env.LAW_BUST_P = '1';
r = await call('POST', '/v1/law/trial', { token: dan.token });
delete process.env.LAW_BUST_P;
assert.equal(r.code, 200, 'trial resolved');
assert.equal(r.body.convicted, true, 'the roll convicts');
const seized = r.body.forfeited;
assert.equal(seized, Math.floor(wealth0 * LAW.FORFEIT_RATE), 'the state seizes FORFEIT_RATE of pocket+bank');
let after = await rawCh(dan.id);
assert.equal(wealth0 - (Number(after.cash) + Number(after.bank)), seized, 'char cash+bank drops by exactly the seizure');
assert.equal((await poolCash()) - pB, seized, 'the seizure lands in the confiscation buffer');
assert.equal(await ledgerOf(dan.id, 'law:forfeit'), -seized, 'the forfeiture is one ledgered sink row');
assert.equal(Number((await pool.query(`SELECT staked FROM account_persistent WHERE account_id='${(await rawCh(dan.id)).account_id}'`)).rows[0].staked), 50, 'staked $OMR is the safe harbour — untouched');
assert(after.jail_until && new Date(after.jail_until) > new Date(), 'a conviction jails');
assert(!after.indicted_at, 'the case is spent — indictment cleared');
assert(after.alive, 'a bust is NOT death — the street survives');

// acquittal collapses the case (LAW_BUST_P=0)
await seedCh(dan.id, "heat_exposure=5000, indicted_at=now(), jail_until=NULL");
const cashPreAcquit = Number((await rawCh(dan.id)).cash);
process.env.LAW_BUST_P = '0';
r = await call('POST', '/v1/law/trial', { token: dan.token });
delete process.env.LAW_BUST_P;
assert.equal(r.body.convicted, false, 'the roll acquits');
after = await rawCh(dan.id);
assert(!after.indicted_at, 'an acquittal drops the case');
assert.equal(Number(after.cash), cashPreAcquit, 'an acquittal seizes nothing');
assert(Number(after.heat_exposure) <= LAW.ACQUIT_TO, 'exposure resets so you are not re-indicted next tick');

// ── plea: a certain, smaller loss (a scoped §10.4 transfer) ──
const pab = await mk('Plea Pete');
await seedCh(pab.id, 'cash=200000, bank=800000, indicted_at=now(), heat_exposure=4000');
before = await rawCh(pab.id);
const wealthP = Number(before.cash) + Number(before.bank), poolP = await poolCash();
r = await call('POST', '/v1/law/plea', { token: pab.token });
assert.equal(r.code, 200, 'plea accepted');
assert.equal(r.body.forfeited, Math.floor(wealthP * LAW.PLEA_FORFEIT_RATE), 'a plea forfeits the discounted rate');
assert.equal((await poolCash()) - poolP, r.body.forfeited, 'the plea forfeiture reaches the pool');
assert.equal(await ledgerOf(pab.id, 'law:plea'), -r.body.forfeited, 'the plea is a ledgered sink');
after = await rawCh(pab.id);
assert(!after.indicted_at, 'a plea clears the case');
assert(after.jail_until && new Date(after.jail_until) > new Date(), 'a plea does a short stretch');
assert.equal((await call('POST', '/v1/law/plea', { token: pab.token })).body.error, 'not_indicted', 'no case to plea once settled');

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4 — the flip, the rat, witness protection, informant collapse
// ─────────────────────────────────────────────────────────────────────────────
const rat = await mk('Ratty Ray');       // will flip
const named = await mk('Named Nick');     // the rival Ray names
// seed the named rival just under the line so the FLIP_SEED tips them over → indicted by testimony
await seedCh(named.id, `respect=500, heat_exposure=${LAW.INDICT_AT - LAW.FLIP_SEED + 200}`);
const namedExp0 = Number((await rawCh(named.id)).heat_exposure);
await seedCh(rat.id, 'indicted_at=now(), heat_exposure=4000, cash=100000');
r = await call('POST', `/v1/law/flip/${named.id}`, { token: rat.token });
assert.equal(r.code, 200, 'turned state');
assert.equal(r.body.named, 'Named Nick', 'Ray names his rival');
assert.equal(r.body.namedIndicted, true, 'the testimony indicts the named rival');
let rch = await rawCh(rat.id);
assert(!rch.indicted_at, "the rat's case is dropped");
assert.equal((await meOf(rat.token)).law.rat, true, 'the rat badge is worn');
assert(rch.jail_until && new Date(rch.jail_until) > new Date(), 'the rat does a soft stretch');
let nch = await rawCh(named.id);
assert.equal(Number(nch.heat_exposure) - namedExp0, LAW.FLIP_SEED, "the named rival's case grows by the seed");
assert(!!nch.indicted_at, 'the seeded case latched an indictment on the named rival');
const inf = (await pool.query(`SELECT * FROM informants WHERE witness_character='${rat.id}'`)).rows;
assert.equal(inf.length, 1, 'an informant record is filed');
await seedCh(rat.id, 'indicted_at=now()'); // even re-indicted, a rat has nothing left to trade
assert.equal((await call('POST', `/v1/law/flip/${named.id}`, { token: rat.token })).body.error, 'already_rat', "you can't turn twice");
await seedCh(rat.id, 'indicted_at=NULL');

// the RAT is fair game — the directed-contract floor is WAIVED on a kill contract on them
const poster = await mk('Poster Paul');
const gun4hire = await mk('Gun Four-Hire');
await seedCh(poster.id, 'cash=50000');
r = await call('POST', `/v1/streets/${rat.id}/bounty`, { token: poster.token, body: { amount: 500, kind: 'kill', hitman: gun4hire.id } });
assert.equal(r.code, 200, 'a cheap named gun on a rat is allowed (floor waived)');
// …but a non-rat still takes the full directed stake
r = await call('POST', `/v1/streets/${named.id}/bounty`, { token: poster.token, body: { amount: 500, kind: 'kill', hitman: gun4hire.id } });
assert.equal(r.body.error, 'directed_min', 'a non-rat directed contract still takes the serious stake');

// AUDIT REGRESSION: a rat FORFEITS FAMILY OMERTÀ — even their own family can contract them, while a
// loyal member is still protected. (Without the fix a rat hiding in a family defeats the magnet.)
const capo = await mk('Capo Carl');
const loyalist = await mk('Loyal Lou');
await seedCh(capo.id, 'respect=5000, cash=100000, jail_until=NULL');
await seedCh(rat.id, 'jail_until=NULL');
const gid = (await call('POST', '/v1/gangs', { token: capo.token, body: { name: 'The Carls', tag: 'CARL' } })).body.gangId;
assert.equal((await call('POST', `/v1/gangs/${gid}/join`, { token: rat.token })).code, 200, 'the rat is in the family');
assert.equal((await call('POST', `/v1/gangs/${gid}/join`, { token: loyalist.token })).code, 200, 'the loyalist is in the family');
r = await call('POST', `/v1/streets/${rat.id}/bounty`, { token: capo.token, body: { amount: 1000, kind: 'kill' } });
assert.equal(r.code, 200, 'a family contract on the RAT is allowed — omertà is void for an informant');
r = await call('POST', `/v1/streets/${loyalist.id}/bounty`, { token: capo.token, body: { amount: 1000, kind: 'kill' } });
assert.equal(r.body.error, 'family', 'a loyal family member still has omertà');

// witness protection — a one-time untargetable relocation window
await seedCh(rat.id, 'jail_until=NULL');
assert.equal((await call('POST', '/v1/law/witpro', { token: named.token })).body.error, 'not_rat', 'witpro is only for those who talked');
r = await call('POST', '/v1/law/witpro', { token: rat.token });
assert.equal(r.code, 200, 'the rat enters witness protection');
assert((await meOf(rat.token)).law.witproSeconds > 0, 'the relocation window is live');
assert.equal((await call('POST', '/v1/law/witpro', { token: rat.token })).body.error, 'done', 'relocation is one-time');
// a witpro'd rat is untouchable — an NPC hit can't reach them (the rat is over the level floor)
await seedCh(poster.id, 'cash=5000000, respect=500');
await seedCh(rat.id, 'respect=500');
const hit = await call('POST', `/v1/streets/${rat.id}/npchit`, { token: poster.token, body: { tier: 'legbreaker' } });
assert.equal(hit.body.error, 'witpro', 'the marshals put the rat beyond a contractor reach');

// the informant COLLAPSE — kill the witness (a mod-kill runs runEstate) and the seeded case lifts
const namedExpPre = Number((await rawCh(named.id)).heat_exposure);
r = await call('POST', '/v1/mod/kill', { mod: true, body: { characterId: rat.id, reason: 'witness eliminated' } });
assert.equal(r.code, 200, 'the witness is down');
nch = await rawCh(named.id);
assert.equal(Number(nch.heat_exposure), namedExpPre - LAW.FLIP_SEED, 'the seeded case collapses with the witness');
assert(!nch.indicted_at, 'AUDIT: killing the witness CLEARS the indictment his testimony caused (the case dies with him)');
assert.equal((await pool.query(`SELECT COUNT(*) c FROM informants WHERE witness_character='${rat.id}'`)).rows[0].c, 0, 'the informant record dies with the witness');

// ─────────────────────────────────────────────────────────────────────────────
// the worker sweep — force the bust on an indicted player past the grace window
// ─────────────────────────────────────────────────────────────────────────────
const whale = await mk('Offline Ollie');
await seedCh(whale.id, `cash=500000, bank=1500000, heat_exposure=6000, indicted_at = now() - interval '7 hours'`);
const whaleWealth0 = 2000000, whalePool0 = await poolCash();
process.env.LAW_BUST_P = '1';
const sweep = await sweepLaw(pool);
delete process.env.LAW_BUST_P;
assert.equal(sweep.convicted, 1, 'the sweep convicts the overdue whale');
assert(sweep.seized > 0, 'the sweep seizes');
const wch = await rawCh(whale.id);
assert.equal(whaleWealth0 - (Number(wch.cash) + Number(wch.bank)), sweep.seized, 'the offline whale is drained by exactly the seizure');
assert.equal((await poolCash()) - whalePool0, sweep.seized, 'the seizure reaches the confiscation buffer');
assert(wch.jail_until && new Date(wch.jail_until) > new Date(), 'the swept whale is jailed');
assert(!wch.indicted_at, 'the swept case is resolved');
// an indicted player still INSIDE the grace window is untouched by the sweep
const fresh = await mk('Fresh Fred');
await seedCh(fresh.id, 'cash=100000, heat_exposure=4000, indicted_at=now()');
const sweep2 = await sweepLaw(pool);
assert.equal(sweep2.cases, 0, 'the sweep leaves anyone still inside the grace window alone');
assert(!!(await rawCh(fresh.id)).indicted_at, 'Fred keeps his window to lawyer up / flip / plea');

// ─────────────────────────────────────────────────────────────────────────────
// THE ENVELOPE — the standing graft ($OMR sink) that slows the investigation meter
// ─────────────────────────────────────────────────────────────────────────────
// the gain-mult modifier: an enveloped character builds LESS of a case than a bare one from the same
// hot state (direct accrue() check — evMult cancels in the comparison; the bleed is untouched).
{
  const { accrue } = await import('../src/accrual.js');
  const base = () => ({ respect: 2000, energy: 0, nerve: 0, health: 0, cash: 0, bank: 0, heat: 100,
    heat_exposure: 0, crew: 0, racket_credit_ms: 0, bank_credit_ms: 0,
    last_accrued_at: new Date(Date.now() - 5 * 60000), path: null, loc: 'downtown', indicted_at: null });
  const plain = base(); accrue(plain, { staked: 0 }, { stash: [], rackets: [], assets: [], held: [] });
  const paid = base(); paid.envelope_until = new Date(Date.now() + 3600000);
  accrue(paid, { staked: 0 }, { stash: [], rackets: [], assets: [], held: [] });
  assert(paid.heat_exposure > 0, 'the envelope is NOT immunity — a reckless street still builds a case');
  assert(paid.heat_exposure < plain.heat_exposure,
    `the envelope slows the case build (${Math.round(paid.heat_exposure)} < ${Math.round(plain.heat_exposure)})`);
}
// STEP TWO — the accelerated BLEED: from a COLD-heat, high-exposure state (gain≈0, bleed dominates),
// an enveloped street AND a family-foundation member both shed MORE of the case than a bare one.
{
  const { accrue } = await import('../src/accrual.js');
  const cold = () => ({ respect: 2000, energy: 0, nerve: 0, health: 0, cash: 0, bank: 0, heat: 0,
    heat_exposure: 500, crew: 0, racket_credit_ms: 0, bank_credit_ms: 0,
    last_accrued_at: new Date(Date.now() - 60 * 60000), path: null, loc: 'downtown', indicted_at: null });
  const bare = cold(); accrue(bare, { staked: 0 }, { stash: [], rackets: [], assets: [], held: [] });
  const env = cold(); env.envelope_until = new Date(Date.now() + 3600000);
  accrue(env, { staked: 0 }, { stash: [], rackets: [], assets: [], held: [] });
  assert(env.heat_exposure < bare.heat_exposure,
    `the envelope bleeds the case faster (${Math.round(env.heat_exposure)} < ${Math.round(bare.heat_exposure)})`);
  const fam = cold(); accrue(fam, { staked: 0 }, { stash: [], rackets: [], assets: [], held: [], foundationTier: 5 });
  assert(fam.heat_exposure < bare.heat_exposure,
    `the family foundation keeps files thin — the case bleeds faster (${Math.round(fam.heat_exposure)} < ${Math.round(bare.heat_exposure)})`);
}
// pay it — a ledgered $OMR sink, the window live on the docket, extends on re-pay
const gil = await mk('Grifter Gil');
await seedAcct(gil.id, 'omr=600');
let lb = await lawOf(gil.token);
assert.equal(lb.envelope.active, false, 'no envelope on a fresh street');
assert.equal(lb.envelope.cost, LAW.ENVELOPE_OMR, 'the envelope quote is published');
r = await call('POST', '/v1/law/envelope', { token: gil.token });
assert.equal(r.code, 200, 'the envelope is paid');
assert.equal(r.body.spent, LAW.ENVELOPE_OMR, 'costs the sticker $OMR');
assert.equal(await omrLedgerOf(gil.id, 'law:envelope'), -LAW.ENVELOPE_OMR, 'the envelope is a ledgered $OMR burn');
lb = await lawOf(gil.token);
assert.equal(lb.envelope.active, true, 'the envelope is current on the docket');
assert(lb.envelope.seconds > 0, 'the window is live');
const secs1 = lb.envelope.seconds;
await seedAcct(gil.id, 'omr=600');
r = await call('POST', '/v1/law/envelope', { token: gil.token });
assert(r.body.envelopeSeconds > secs1, 'paying again extends the window from the current end');
// gates: broke can't pay, and no reaching the precinct from a cell
await seedAcct(gil.id, 'omr=0');
assert.equal((await call('POST', '/v1/law/envelope', { token: gil.token })).body.error, 'omr', "a broke street can't keep the envelope current");
await seedCh(gil.id, "jail_until = now() + interval '1 hour'");
await seedAcct(gil.id, 'omr=600');
assert.equal((await call('POST', '/v1/law/envelope', { token: gil.token })).body.error, 'jailed', 'no reaching the precinct from lockup');
await seedCh(gil.id, 'jail_until=NULL');

// ─────────────────────────────────────────────────────────────────────────────
// §10.4 — the law: vocabulary is closed (law:* cash sinks + law:jury/envelope $OMR burns enrolled)
// ─────────────────────────────────────────────────────────────────────────────
const vocab = (await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `law:* rides the §10.4 vocabulary (${JSON.stringify(vocab.unknown || [])})`);

console.log('✅ test/law.js — the Law/RICO/informants across all four phases + THE ENVELOPE (the standing graft: a $OMR sink that slows the case build, ledgered law:envelope burn, window extends on re-pay, jailed/broke gates)');
process.exit(0);

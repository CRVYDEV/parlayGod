// MARRIAGES & SOLDIERS (founder picks #2+#3 — omerta-marriage-soldiers-design.md).
// Covers: the marriage flow (propose/accept gates + fees + the wedding burying the feud), monogamy,
// THE SCANDAL (killing your in-law → honor hit + auto-dissolve), divorce (honor hit), the
// consigliere (name/accept/end, status both ways), Mad Dog lockout; soldiers (hire gates + sink +
// roster cap, assign/unassign, the crime assist — cut off the top + wheelman stint + xp, the risky
// bust — injury + pinned DEATH + the memorial, the heist safecracker cooldown, death-with-the-street),
// and §10.4 (dynasty:/soldier: vocabulary closed + the sinks ledger exactly — a before/after delta of 0).
// pg-mem, zero infra.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { MARRIAGE, SOLDIERS } from '../src/rules.js';
import { checkScandal } from '../src/dynasty.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body, mod } = {}) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (mod) headers['x-mod-key'] = 'test-mod-key';
  const res = await app.inject({ method, url, headers, payload: body });
  let body2; try { body2 = res.json(); } catch { body2 = null; }
  return { code: res.statusCode, body: body2 };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
let nameSeq = 0;
const mk = async (base) => {
  const name = `${base}${(nameSeq++).toString(36)}${Date.now().toString(36).slice(-3)}`;
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const ch = await meOf(token);
  return { token, id: ch.id, name, account: ch.accountId };
};
const setCash = (id, n) => pool.query(`UPDATE characters SET cash=${n} WHERE id='${id}'`);
const setHonor = (id, n) => pool.query(`UPDATE characters SET honor=${n} WHERE id='${id}'`);
const honorOf = async (id) => Number((await pool.query(`SELECT honor FROM characters WHERE id='${id}'`)).rows[0].honor);
const acctOf = async (chId) => (await pool.query(`SELECT account_id FROM characters WHERE id='${chId}'`)).rows[0].account_id;

// ═══ MARRIAGE — the flow + fees + the buried feud ═══
let a, b;
{
  a = await mk('Rom'); b = await mk('Jul');
  const aAcct = await acctOf(a.id), bAcct = await acctOf(b.id);
  // a live vendetta between the two houses (it should clear at the wedding)
  await pool.query(`INSERT INTO vendettas (avenger_account, target_account, sworn, expires_at)
    VALUES ('${aAcct}','${bAcct}','old blood', now() + interval '7 days')`);
  // broke proposer is refused BEFORE any row lands
  let r = await call('POST', `/v1/dynasty/propose/${b.id}`, { token: a.token });
  assert.equal(r.body?.error, 'cash', `broke proposer refused: ${JSON.stringify(r.body)}`);
  await setCash(a.id, 100000);
  // self-house refused
  r = await call('POST', `/v1/dynasty/propose/${a.id}`, { token: a.token });
  assert.equal(r.body?.error, 'self', 'no marrying your own house');
  // propose — the fee is a ledgered dynasty:ceremony sink
  const cash0 = (await meOf(a.token)).cash;
  r = await call('POST', `/v1/dynasty/propose/${b.id}`, { token: a.token });
  assert.equal(r.code, 200, `propose: ${JSON.stringify(r.body)}`);
  assert.equal((await meOf(a.token)).cash, cash0 - MARRIAGE.PROPOSE_COST, 'the proposer paid the ceremony half');
  const led = (await pool.query(
    `SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='dynasty:ceremony' AND character_id='${a.id}'`)).rows[0];
  assert.equal(Number(led.s), -MARRIAGE.PROPOSE_COST, 'the fee is ledgered dynasty:ceremony');
  // double-propose refused
  r = await call('POST', `/v1/dynasty/propose/${b.id}`, { token: a.token });
  assert.equal(r.body?.error, 'pending', 'one proposal at a time');
  // the board shows it pending both ways
  const boardA = (await call('GET', '/v1/dynasty', { token: a.token })).body;
  assert.ok(boardA.proposals.some((p) => p.mine), "the proposer's board shows the pending offer");
  const boardB = (await call('GET', '/v1/dynasty', { token: b.token })).body;
  assert.ok(boardB.proposals.some((p) => !p.mine), "the target's board shows the offer to accept");
  // the proposer can't accept their own offer
  r = await call('POST', `/v1/dynasty/accept/${bAcct}`, { token: a.token });
  assert.equal(r.body?.error, 'own', "you can't accept your own proposal");
  // accept — fee + the wedding buries the feud
  await setCash(b.id, 100000);
  r = await call('POST', `/v1/dynasty/accept/${aAcct}`, { token: b.token });
  assert.equal(r.code, 200, `accept: ${JSON.stringify(r.body)}`);
  const vend = (await pool.query(
    `SELECT COUNT(*) c FROM vendettas WHERE avenger_account='${aAcct}' AND target_account='${bAcct}'`)).rows[0];
  assert.equal(Number(vend.c), 0, 'the wedding buried the feud (vendetta cleared)');
  const wed = (await call('GET', '/v1/dynasty', { token: a.token })).body;
  assert.ok(wed.marriage && wed.marriage.steward, 'the board shows the marriage with the spouse steward');
  // monogamy: a third house can't propose to either
  const c = await mk('Sid'); await setCash(c.id, 100000);
  r = await call('POST', `/v1/dynasty/propose/${b.id}`, { token: c.token });
  assert.equal(r.body?.error, 'taken', 'a wed house refuses suitors');
  console.log('✓ marriage: fees ledgered + gates + buried feud + monogamy');
}

// ═══ THE SCANDAL — killing your in-law dissolves the marriage + brands the killer ═══
{
  // a (married to b) fire-kills b — drive it via a real kill: shortcut with mod-kill won't carry a
  // killer, so use the pen SHANK path? Heavy. Simplest REAL killer path: the npcHit passer also
  // carries killerCh — but simplest of all is fire. We pin the fight machinery instead: use the
  // hit-contract fire flow with test knobs. To keep this suite lean we call runEstate's front door
  // via the NPC-hit payer path: a pays for a hit on b (the payer IS killerCh for scandal purposes).
  process.env.SEARCH_MS = '1'; process.env.SHOOT_CD_MS = '1';
  await setCash(a.id, 500000);
  await pool.query(`UPDATE characters SET respect=2500, health=100 WHERE id='${a.id}'`);
  await pool.query(`UPDATE characters SET respect=2500, health=1 WHERE id='${b.id}'`);
  const h0 = await honorOf(a.id);
  // loop the npc hit until it lands (the fee burns each try; the tier roll is server-side)
  let killed = false;
  for (let i = 0; i < 60 && !killed; i++) {
    await setCash(a.id, 500000);
    // clear the payer + per-target cooldowns and keep heat/health workable between tries
    await pool.query(`DELETE FROM npc_hits WHERE payer='${a.id}'`);
    await pool.query(`UPDATE characters SET npchit_at=NULL, heat=0 WHERE id='${a.id}'`);
    await pool.query(`UPDATE characters SET health=1, hosp_until=NULL WHERE id='${b.id}'`);
    const r = await call('POST', `/v1/streets/${b.id}/npchit`, { token: a.token, body: { tier: 'legbreaker' } });
    if (r.body?.killed) killed = true;
  }
  assert.ok(killed, 'the hit eventually lands');
  const hAfter = await honorOf(a.id);
  // the scandal fired: MARRIAGE.SCANDAL on top of the npc-hit's own honor cost (HONOR.NPC_HIT −5/try);
  // assert the marriage dissolved and honor dropped by at least the scandal magnitude
  assert.ok(hAfter <= h0 + MARRIAGE.SCANDAL, `the killer eats the scandal (honor ${h0} → ${hAfter})`);
  const stillWed = (await call('GET', '/v1/dynasty', { token: a.token })).body;
  assert.equal(stillWed.marriage, null, 'the marriage dissolved in the scandal');
  delete process.env.SEARCH_MS; delete process.env.SHOOT_CD_MS;
  console.log('✓ the scandal: killing your in-law dissolves the marriage + brands you');
}

// ═══ DIVORCE + CONSIGLIERE ═══
{
  const d = await mk('Div'); const e = await mk('Eve');
  await setCash(d.id, 100000); await setCash(e.id, 100000);
  const dAcct = await acctOf(d.id), eAcct = await acctOf(e.id);
  await call('POST', `/v1/dynasty/propose/${e.id}`, { token: d.token });
  await call('POST', `/v1/dynasty/accept/${dAcct}`, { token: e.token });
  const h0 = await honorOf(d.id);
  let r = await call('POST', '/v1/dynasty/divorce', { token: d.token });
  assert.equal(r.code, 200, `divorce: ${JSON.stringify(r.body)}`);
  assert.ok(r.body.divorced, 'an accepted marriage ends in divorce (not a withdrawal)');
  assert.equal(await honorOf(d.id), h0 + MARRIAGE.DIVORCE, 'the initiator eats the divorce honor hit');
  // Mad Dog lockout — deep infamy can't propose
  await setHonor(d.id, -80);
  r = await call('POST', `/v1/dynasty/propose/${e.id}`, { token: d.token });
  assert.equal(r.body?.error, 'mad_dog', 'a mad dog can\'t marry');
  await setHonor(d.id, 0);
  // consigliere: name + accept + both boards show it
  const cash0 = (await meOf(d.token)).cash;
  r = await call('POST', `/v1/dynasty/consigliere/${e.id}`, { token: d.token });
  assert.equal(r.code, 200, `name consigliere: ${JSON.stringify(r.body)}`);
  assert.equal((await meOf(d.token)).cash, cash0 - MARRIAGE.CONSIGLIERE_COST, 'the envoy fee paid');
  r = await call('POST', `/v1/dynasty/consigliere/accept/${dAcct}`, { token: e.token });
  assert.equal(r.code, 200, `accept the chair: ${JSON.stringify(r.body)}`);
  const bd = (await call('GET', '/v1/dynasty', { token: d.token })).body;
  assert.ok(bd.consigliere?.accepted, "the house's board shows its adviser");
  const be = (await call('GET', '/v1/dynasty', { token: e.token })).body;
  assert.ok(be.advising.length === 1, "the adviser's board shows the house they counsel");
  // end it from the adviser's chair — SCOPED (audit LOW-1): resigning advising posts only
  r = await call('DELETE', '/v1/dynasty/consigliere?role=adviser', { token: e.token });
  assert.equal(r.code, 200, 'the adviser can walk');

  // ── audit MED-2 regressions: the divorce tombstone ──
  // (1) killing your RECENTLY-divorced ex still fires the FULL scandal (no divorce-first dodge)
  const dRow = (await pool.query(`SELECT * FROM characters WHERE id='${d.id}'`)).rows[0];
  const eRow = (await pool.query(`SELECT * FROM characters WHERE id='${e.id}'`)).rows[0];
  const h1 = await honorOf(d.id);
  const sc = await checkScandal(pool, dRow, eRow);
  assert.ok(sc?.scandal && sc.graced, `the grace-window scandal fires post-divorce: ${JSON.stringify(sc)}`);
  assert.equal(await honorOf(d.id), Math.max(-100, h1 + MARRIAGE.SCANDAL), 'the full -30 lands despite the divorce');
  // (2) the same pair can't re-marry inside the window (slows marry/divorce vendetta laundering)
  await setCash(d.id, 100000);
  r = await call('POST', `/v1/dynasty/propose/${e.id}`, { token: d.token });
  assert.equal(r.body?.error, 'cooling', `no re-marriage while the ink is wet: ${JSON.stringify(r.body)}`);
  console.log('✓ divorce honor + mad-dog lockout + consigliere both ways + the scandal grace window');
}

// ═══ SOLDIERS — hire/assign + the crime assist + permadeath + the memorial ═══
{
  const s = await mk('Boss');
  await pool.query(`UPDATE characters SET respect=2500, nerve=99, energy=99 WHERE id='${s.id}'`);
  // broke hire refused
  let r = await call('POST', '/v1/soldiers/hire', { token: s.token });
  assert.equal(r.body?.error, 'cash', 'broke hire refused');
  await setCash(s.id, 200000);
  const cash0 = (await meOf(s.token)).cash;
  r = await call('POST', '/v1/soldiers/hire', { token: s.token });
  assert.equal(r.code, 200, `hire: ${JSON.stringify(r.body)}`);
  const soldierId = r.body.id;
  assert.ok(r.body.name && r.body.trait, 'the soldier has a name and a trait');
  assert.equal((await meOf(s.token)).cash, cash0 - SOLDIERS.HIRE_COST, 'the hire cost was paid');
  const led = (await pool.query(
    `SELECT COALESCE(SUM(amount),0) t FROM transactions WHERE reason='soldier:hire' AND character_id='${s.id}'`)).rows[0];
  assert.equal(Number(led.t), -SOLDIERS.HIRE_COST, 'the hire is ledgered soldier:hire');
  // roster cap
  await setCash(s.id, 500000);
  await call('POST', '/v1/soldiers/hire', { token: s.token });
  await call('POST', '/v1/soldiers/hire', { token: s.token });
  r = await call('POST', '/v1/soldiers/hire', { token: s.token });
  assert.equal(r.body?.error, 'full', `the roster caps at ${SOLDIERS.MAX}`);
  // assign the first
  r = await call('POST', `/v1/soldiers/${soldierId}/assign`, { token: s.token });
  assert.equal(r.code, 200, `assign: ${JSON.stringify(r.body)}`);
  let board = (await call('GET', '/v1/soldiers', { token: s.token })).body;
  assert.equal(board.roster.filter((x) => x.onJob).length, 1, 'exactly one second on the job');
  // the crime assist: on a SUCCESS the soldier takes the cut off the top and earns xp.
  // Pin death off so the loop can't kill him while we farm a success.
  process.env.SOLDIER_DEATH_P = '0';
  let got = null;
  for (let i = 0; i < 80 && !got; i++) {
    await pool.query(`UPDATE characters SET nerve=99, jail_until=NULL WHERE id='${s.id}'`);
    // an interleaved bust injures the second (death pinned OFF) and an injured soldier sits out —
    // patch him up between tries so the success-assist is always observable (anti-flake)
    await pool.query(`UPDATE soldiers SET injured_until=NULL WHERE id='${soldierId}'`);
    const cr = await call('POST', '/v1/crimes/stereo', { token: s.token });
    if (cr.body?.success && cr.body?.soldier) got = cr.body;
  }
  assert.ok(got, 'a successful assisted crime lands');
  assert.ok(got.soldier.cut >= 0, 'the second reports his cut');
  board = (await call('GET', '/v1/soldiers', { token: s.token })).body;
  const vet = board.roster.find((x) => x.id === soldierId);
  assert.ok(vet.xp >= 1, 'the soldier earned xp');
  // ── TIER-4: the soldier carries a RANK (recruit→capo), and THE COMMANDER LEGEND banked a lifetime job ──
  assert.ok(vet.rank, 'the soldier has a rank');
  assert.ok(board.commander && board.commander.led >= 1, 'the commander legend banked a successful assisted job');
  assert.ok(board.commander.rank, 'and carries a commander rank');
  const cled = Number((await pool.query(`SELECT soldiers_led FROM account_persistent WHERE account_id=(SELECT account_id FROM characters WHERE id='${s.id}')`)).rows[0].soldiers_led);
  assert.ok(cled >= 1, 'soldiers_led is persisted (survives death)');
  const clb = (await call('GET', '/v1/leaderboard/commanders', { token: s.token })).body;
  assert.ok(clb.commanders.length >= 1 && clb.commanders[0].led >= 1, 'the commanders board lists the decorated');
  // audit regression: every assisted job pays the cut — the Score included (the safecracker was
  // the one pure-upside trait; the pre-ledger shave makes assignment a real tradeoff, §10.4-safe)
  await pool.query(`UPDATE characters SET heist_at=NULL, health=100, jail_until=NULL WHERE id='${s.id}'`);
  await pool.query(`UPDATE soldiers SET injured_until=NULL WHERE id='${soldierId}'`);
  r = await call('POST', '/v1/heist', { token: s.token });
  assert.equal(r.code, 200, `assisted Score: ${JSON.stringify(r.body)}`);
  assert.ok(r.body.soldier && r.body.soldier.cut > 0, 'the second takes his cut of the Score too');
  // the RISKY outcome: pin DEATH on and farm a bust — the soldier dies for good, onto the memorial
  process.env.SOLDIER_DEATH_P = '1';
  let died = false;
  for (let i = 0; i < 80 && !died; i++) {
    await pool.query(`UPDATE characters SET nerve=99, jail_until=NULL WHERE id='${s.id}'`);
    // keep the second FIT going into each try (a prior bust's injury would bench him and the
    // death roll would never fire — the same anti-flake as the success farm)
    await pool.query(`UPDATE soldiers SET injured_until=NULL WHERE id='${soldierId}' AND alive`);
    const cr = await call('POST', '/v1/crimes/stereo', { token: s.token });
    if (cr.body?.success === false && cr.body?.soldier?.died) died = true;
  }
  assert.ok(died, 'a busted job kills the pinned second');
  delete process.env.SOLDIER_DEATH_P;
  board = (await call('GET', '/v1/soldiers', { token: s.token })).body;
  assert.equal(board.memorial.length, 1, 'the fallen soldier is on the memorial');
  assert.ok(!board.roster.some((x) => x.id === soldierId), 'and off the roster');
  // a DEAD soldier can't be re-assigned
  r = await call('POST', `/v1/soldiers/${soldierId}/assign`, { token: s.token });
  assert.equal(r.body?.error, 'no_soldier', 'the dead don\'t work');
  console.log('✓ soldiers: hire sink + cap + assign + crime cut/xp + permadeath + memorial');
}

// ═══ SOLDIERS die with the street ═══
{
  const w = await mk('Wid');
  await setCash(w.id, 100000);
  const r = await call('POST', '/v1/soldiers/hire', { token: w.token });
  assert.equal(r.code, 200, 'hire for the doomed street');
  await call('POST', '/v1/mod/kill', { body: { characterId: w.id, reason: 'test' }, mod: true });
  const left = (await pool.query(`SELECT COUNT(*) c FROM soldiers WHERE character_id='${w.id}'`)).rows[0];
  assert.equal(Number(left.c), 0, 'soldiers die with the street (estate-wiped)');
  console.log('✓ soldiers die with the street');
}

// ═══ §10.4 — the new dynasty:/soldier: reasons reconcile (the expansion.js delta pattern) ═══
{
  const driftOf = (inv, name) => { const c = inv.checks.find((x) => x.name === name); return c.lhs - c.rhs; };
  // seed BEFORE the snapshot so the measured window holds ONLY ledgered actions
  const p = await mk('LgA'); const q = await mk('LgB');
  await setCash(p.id, 200000); await setCash(q.id, 200000);
  const before = await runLedgerInvariants(pool, { alert: false });
  assert.ok(before.checks.find((c) => c.name === 'reason vocabulary')?.ok,
    'the vocabulary stays closed with dynasty:/soldier: live');
  const cashBefore = driftOf(before, 'character cash');
  // a ceremony (propose + accept) + a consigliere + a soldier hire — four ledgered sinks
  await call('POST', `/v1/dynasty/propose/${q.id}`, { token: p.token });
  await call('POST', `/v1/dynasty/accept/${await acctOf(p.id)}`, { token: q.token });
  await call('POST', `/v1/dynasty/consigliere/${q.id}`, { token: p.token });
  const r = await call('POST', '/v1/soldiers/hire', { token: q.token });
  assert.equal(r.code, 200, 'ledger soldier hire');
  const after = await runLedgerInvariants(pool, { alert: false });
  assert.ok(after.checks.find((c) => c.name === 'reason vocabulary')?.ok, 'vocabulary still closed');
  assert.equal(driftOf(after, 'character cash') - cashBefore, 0,
    'every dynasty:/soldier: sink ledgers exactly — zero new character-cash drift');
  console.log('✓ §10.4 holds with dynasty:/soldier: in the ledger');
}

await app.close();
console.log('✅ Marriages & Soldiers test passed — the marriage flow (fees ledgered, gates, the wedding burying the feud, monogamy), THE SCANDAL (killing your in-law dissolves the marriage + the honor brand), divorce + the Mad Dog lockout, the consigliere (both chairs), soldiers (hire sink + roster cap + assign, the crime cut/xp assist, pinned permadeath + the memorial, death-with-the-street), and §10.4 conservation with the new reasons live.');

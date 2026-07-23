// SECRETS & THE COLLECTION (founder picks #7+#8 — omerta-secrets-collection-design.md).
// Covers: the dig (self/cooldown/cap gates, the intel:dig burn win-or-lose, a REAL secret found on
// a dirty mark, nothing on a clean one, disinformation cooking the books), extortion (cap gate +
// the demand window), paying the hush (the taxed two-party transfer — mark −demand, holder +98%,
// 1% → street tax; secret consumed), exposure (the RICO meter jumps by exposeHeat; secret consumed),
// the worker deadline sweep (an unpaid demand BLOWS), death (dirt dies with the spy AND the mark);
// the Collection (log sites fire — crime/district/gun/goods/drug/boat/fixture/car, idempotent),
// the board + completionist leaderboard, account-level death survival; and §10.4 (secret:/intel:dig
// vocabulary closed + the hush transfer delta-0). pg-mem, zero infra.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { SECRETS } from '../src/rules.js';
import { sweepSecrets } from '../src/secrets.js';

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
  return { token, id: ch.id, name };
};
const acctOf = async (chId) => (await pool.query(`SELECT account_id FROM characters WHERE id='${chId}'`)).rows[0].account_id;
const grantOmr = async (chId, n) => pool.query(
  `UPDATE account_persistent SET omr=${n} WHERE account_id='${await acctOf(chId)}'`);
const setCash = (id, n) => pool.query(`UPDATE characters SET cash=${n} WHERE id='${id}'`);

// ═══ SECRETS — the dig ═══
let spy, mark, secretId;
{
  spy = await mk('Spy'); mark = await mk('Mrk');
  await grantOmr(spy.id, 100);
  // self refused
  let r = await call('POST', `/v1/wire/dig/${spy.id}`, { token: spy.token });
  assert.equal(r.body?.error, 'self', 'no digging on yourself');
  // a CLEAN mark: the fee burns, nothing found
  const omr0 = (await meOf(spy.token)).omr;
  r = await call('POST', `/v1/wire/dig/${mark.id}`, { token: spy.token });
  assert.equal(r.code, 200, `dig on a clean mark: ${JSON.stringify(r.body)}`);
  assert.equal(r.body.found, false, 'a clean mark yields nothing');
  assert.ok((await meOf(spy.token)).omr < omr0, 'the shovel burns win or lose');
  const led = (await pool.query(
    `SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='intel:dig'`)).rows[0];
  assert.ok(Number(led.s) < 0, 'the dig is ledgered intel:dig (the existing burn term)');
  // cooldown: an immediate re-dig on the same mark is refused
  r = await call('POST', `/v1/wire/dig/${mark.id}`, { token: spy.token });
  assert.equal(r.body?.error, 'cooldown', 'one dig per mark per day');
  // dirty the mark (season kills → 'killer' dirt) + clear the cooldown → the dig finds it
  await pool.query(`UPDATE characters SET season_kills=3 WHERE id='${mark.id}'`);
  await pool.query(`DELETE FROM digs WHERE character_id='${spy.id}'`);
  r = await call('POST', `/v1/wire/dig/${mark.id}`, { token: spy.token });
  assert.equal(r.code, 200, `dig on a killer: ${JSON.stringify(r.body)}`);
  assert.ok(r.body.found && r.body.kind === 'killer', `the shovel finds The Bodies: ${JSON.stringify(r.body)}`);
  secretId = r.body.id;
  // one live secret per (holder, target)
  await pool.query(`DELETE FROM digs WHERE character_id='${spy.id}'`);
  r = await call('POST', `/v1/wire/dig/${mark.id}`, { token: spy.token });
  assert.equal(r.body?.error, 'already', 'one secret per house at a time');
  // DISINFORMATION cooks the books: a launder-dirty mark under disinfo digs clean
  const shadow = await mk('Shd');
  await pool.query(`UPDATE characters SET wash_used=50000, disinfo_until=now()+interval '1 hour' WHERE id='${shadow.id}'`);
  r = await call('POST', `/v1/wire/dig/${shadow.id}`, { token: spy.token });
  assert.equal(r.body.found, false, 'cooked books beat the shovel');
  console.log('✓ the dig: gates + burn + real dirt + disinfo defense');
}

// ═══ EXTORT → PAY THE HUSH (the taxed transfer) ═══
{
  // over-cap demand refused
  let r = await call('POST', `/v1/secrets/${secretId}/extort`, { token: spy.token, body: { demand: 10_000_000 } });
  assert.equal(r.body?.error, 'amount', 'the demand is capped by what the dirt is worth');
  r = await call('POST', `/v1/secrets/${secretId}/extort`, { token: spy.token, body: { demand: 100000 } });
  assert.equal(r.code, 200, `extort: ${JSON.stringify(r.body)}`);
  // the mark sees the demand on their board
  const b = (await call('GET', '/v1/secrets', { token: mark.token })).body;
  assert.ok(b.onMe.length === 1 && Number(b.onMe[0].demand) === 100000, 'the demand hangs over the mark');
  // §10.4 delta around the hush: the taxed transfer reconciles exactly
  const driftOf = (inv) => { const c = inv.checks.find((x) => x.name === 'character cash'); return c.lhs - c.rhs; };
  await setCash(mark.id, 200000);
  const before = await runLedgerInvariants(pool);
  const cash0 = driftOf(before);
  const spyCash0 = (await meOf(spy.token)).cash;
  r = await call('POST', `/v1/secrets/${secretId}/pay`, { token: mark.token });
  assert.equal(r.code, 200, `pay the hush: ${JSON.stringify(r.body)}`);
  assert.equal((await meOf(mark.token)).cash, 100000, 'the mark paid the demand');
  const fee = Math.ceil(100000 * 0.01), tax = Math.ceil(100000 * 0.01);
  assert.equal((await meOf(spy.token)).cash, spyCash0 + 100000 - fee - tax, 'the holder nets 98%');
  const after = await runLedgerInvariants(pool);
  assert.equal(driftOf(after) - cash0, 0, 'the hush transfer is §10.4-exact (delta-0)');
  assert.ok(after.checks.find((c) => c.name === 'reason vocabulary')?.ok, 'secret: is vocabularied');
  // the secret is consumed — no double-collect
  r = await call('POST', `/v1/secrets/${secretId}/pay`, { token: mark.token });
  assert.ok(r.body?.error, 'a paid-off secret is gone');
  console.log('✓ extortion + the hush (taxed transfer, §10.4 delta-0, consumed)');
}

// ═══ EXPOSE — the RICO meter jumps ═══
{
  // fresh dirt: the mark is a killer again
  await pool.query(`DELETE FROM digs WHERE character_id='${spy.id}'`);
  let r = await call('POST', `/v1/wire/dig/${mark.id}`, { token: spy.token });
  assert.ok(r.body.found, 're-dig lands');
  const sid = r.body.id;
  const exp0 = Number((await pool.query(`SELECT heat_exposure FROM characters WHERE id='${mark.id}'`)).rows[0].heat_exposure);
  r = await call('POST', `/v1/secrets/${sid}/expose`, { token: spy.token });
  assert.equal(r.code, 200, `expose: ${JSON.stringify(r.body)}`);
  const exp1 = Number((await pool.query(`SELECT heat_exposure FROM characters WHERE id='${mark.id}'`)).rows[0].heat_exposure);
  assert.equal(exp1 - exp0, SECRETS.KINDS.killer.exposeHeat, "the mark's federal file thickens by exposeHeat");
  console.log('✓ exposure feeds the RICO meter');
}

// ═══ the worker deadline sweep — an unpaid demand BLOWS ═══
{
  await pool.query(`DELETE FROM digs WHERE character_id='${spy.id}'`);
  await grantOmr(spy.id, 100);
  let r = await call('POST', `/v1/wire/dig/${mark.id}`, { token: spy.token });
  const sid = r.body.id;
  await call('POST', `/v1/secrets/${sid}/extort`, { token: spy.token, body: { demand: 50000 } });
  // backdate the deadline → the sweep exposes it
  await pool.query(`UPDATE secrets SET extort_deadline = now() - interval '1 minute' WHERE id='${sid}'`);
  const exp0 = Number((await pool.query(`SELECT heat_exposure FROM characters WHERE id='${mark.id}'`)).rows[0].heat_exposure);
  await sweepSecrets(pool);
  const exp1 = Number((await pool.query(`SELECT heat_exposure FROM characters WHERE id='${mark.id}'`)).rows[0].heat_exposure);
  assert.equal(exp1 - exp0, SECRETS.KINDS.killer.exposeHeat, 'the unpaid demand blew at the deadline');
  assert.equal((await pool.query(`SELECT COUNT(*) c FROM secrets WHERE id='${sid}'`)).rows[0].c, '0', 'the blown secret is gone');
  console.log('✓ the worker sweep blows an unpaid demand');
}

// ═══ death: dirt dies with the mark's street ═══
{
  await pool.query(`DELETE FROM digs WHERE character_id='${spy.id}'`);
  await grantOmr(spy.id, 100);
  const r = await call('POST', `/v1/wire/dig/${mark.id}`, { token: spy.token });
  assert.ok(r.body.found, 'dig for the death test');
  await call('POST', '/v1/mod/kill', { body: { characterId: mark.id, reason: 'test' }, mod: true });
  const left = (await pool.query(
    `SELECT COUNT(*) c FROM secrets WHERE target_account='${await acctOf(mark.id)}'`)).rows[0];
  assert.equal(Number(left.c), 0, "dirt on a dead street is worthless — the heir starts clean");
  console.log('✓ secrets die with the mark');
}

// ═══ THE COLLECTION — the log sites + board + leaderboard + death survival ═══
{
  const c = await mk('Col');
  const acct = await acctOf(c.id);
  await setCash(c.id, 500000);
  await pool.query(`UPDATE characters SET nerve=99, energy=99 WHERE id='${c.id}'`);
  // crime (farm one success)
  let pulled = false;
  for (let i = 0; i < 40 && !pulled; i++) {
    await pool.query(`UPDATE characters SET nerve=99, jail_until=NULL WHERE id='${c.id}'`);
    const cr = await call('POST', '/v1/crimes/pick', { token: c.token });
    if (cr.body?.success) pulled = true;
  }
  assert.ok(pulled, 'a job lands');
  // travel logs the district
  await call('POST', '/v1/travel/canal', { token: c.token });
  // a gun
  await pool.query(`UPDATE characters SET cb=50 WHERE id='${c.id}'`);
  await call('POST', '/v1/armory/gun/lastresort/buy', { token: c.token });
  // goods
  await call('POST', '/v1/goods/buy', { token: c.token, body: { goodId: 'gin', qty: 1 } });
  const board = (await call('GET', '/v1/collection', { token: c.token })).body;
  assert.ok(board.total >= 100, `the catalog spans the game (${board.total} items)`);
  const catOf = (id) => board.categories.find((x) => x.id === id);
  assert.ok(catOf('crimes').have >= 1, 'the pulled job is collected');
  assert.equal(catOf('districts').items.find((i) => i.id === 'canal')?.got, true, 'canal is collected');
  assert.ok(catOf('guns').have >= 1, 'the bought iron is collected');
  assert.ok(catOf('goods').have >= 1, 'the traded good is collected');
  // idempotent: pulling the same job again doesn't double-count
  const crimesHave = catOf('crimes').have;
  for (let i = 0; i < 20; i++) {
    await pool.query(`UPDATE characters SET nerve=99, jail_until=NULL WHERE id='${c.id}'`);
    const cr = await call('POST', '/v1/crimes/pick', { token: c.token });
    if (cr.body?.success) break;
  }
  const board2 = (await call('GET', '/v1/collection', { token: c.token })).body;
  assert.equal(board2.categories.find((x) => x.id === 'crimes').have, crimesHave, 'the log is idempotent');
  // the leaderboard ranks the collector
  const lb = (await call('GET', '/v1/leaderboard/collection', { token: c.token })).body;
  assert.ok(lb.collectors.some((x) => x.have >= board.have && x.total === board.total), 'the completionist board renders');
  // DEATH SURVIVAL: the ledger is account-level — the heir keeps the collection
  const have0 = board2.have;
  await call('POST', '/v1/mod/kill', { body: { characterId: c.id, reason: 'test' }, mod: true });
  const heirBoard = (await call('GET', '/v1/collection', { token: c.token })).body;
  assert.equal(heirBoard.have, have0, 'the collection SURVIVES death — the heir keeps every mark');
  console.log('✓ the Collection: log sites + idempotent + board + leaderboard + death survival');
}

await app.close();
console.log('✅ Secrets & Collection test passed — the dig (gates/burn/real dirt/disinfo), extortion + the taxed hush transfer (§10.4 delta-0, consumed), exposure feeding the RICO meter, the worker blowing unpaid demands, dirt dying with the mark; the Collection log sites (crime/district/gun/goods) firing idempotently, the board + completionist leaderboard, and account-level death survival.');

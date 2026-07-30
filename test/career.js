// THE CAREER test (the 60th suite) — the post-First-Week progression ladder (task #308).
// Founder: "Once you complete The First Week there should be another list of tasks in progression
// … receive bonuses upon completion … that takes them throughout the game."
//
// Covers: the board (five tiers, tier 1 open, the rest locked), the not_done gate carrying its own
// HOW, a ready→claim→ledgered→latched lifecycle, the tier_locked gate, the NEED-claims unlock, the
// capstone riding the SIXTH claim's row, bad_task, §10.4 (career: ledger rows == the pays returned;
// the vocabulary stays closed), and DEATH SURVIVAL (claims are account-keyed — the heir keeps the
// climb and cannot re-farm a claimed rung).
//
// SEEDING NOTE: ownership signals (a gun row, a discipline row, a finished hustle) are SQL-seeded —
// they are NOT currency, so §10.4 is untouched by the seeding; the one cash seed (bank) means this
// suite asserts the career LEDGER SUMS exactly, not whole-book drift (the loadtest discipline).
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { CAREER } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body, headers } = {}) => {
  const res = await app.inject({ method, url,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers || {}) }, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const me = (await call('GET', '/v1/me', { token })).body.character;
  return { token, id: me.id };
};
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);
const careerLedger = async (id) => Number((await pool.query(
  `SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE character_id='${id}' AND reason LIKE 'career:%'`)).rows[0].s);

const cli = await mk('Climber Clem');
const acctOf = async (id) => (await pool.query(`SELECT account_id a FROM characters WHERE id='${id}'`)).rows[0].a;
const clemAcct = await acctOf(cli.id);

// ── the board: five tiers, tier 1 open, the rest locked; the public catalog rides /v1/rules ──
let b = (await call('GET', '/v1/career', { token: cli.token })).body;
assert.equal(b.tiers.length, CAREER.TIERS.length, 'five tiers on the ladder');
assert.equal(b.need, CAREER.NEED, 'the board states the unlock bar');
assert.equal(b.tiers[0].open, true, 'the first tier is open from day one');
assert(b.tiers.slice(1).every((t) => !t.open), 'every later tier starts locked');
assert(b.tiers[0].tasks.every((k) => typeof k.how === 'string' && k.cash > 0), 'every task carries its HOW and its price');
const rules = (await call('GET', '/v1/rules')).body;
assert.equal(rules.career.tiers.length, CAREER.TIERS.length, 'the catalog is public on /v1/rules');

// ── the not_done gate teaches (names the HOW), and a locked tier refuses outright ──
let r = await call('POST', '/v1/career/ca_strap', { token: cli.token });
assert.equal(r.body.error, 'not_done', 'no claiming what you have not done');
assert(/armory/i.test(r.body.message), 'the refusal names the HOW');
assert.equal((await call('POST', '/v1/career/so_earner', { token: cli.token })).body.error, 'tier_locked', 'a tier-2 rung refuses while tier 1 is unclimbed');
assert.equal((await call('POST', '/v1/career/nope', { token: cli.token })).body.error, 'bad_task', 'no such rung');

// ── ready → claim → ledgered → latched ──
await pool.query(`INSERT INTO character_guns (character_id, gun_id) VALUES ('${cli.id}', 'snub38')`);
b = (await call('GET', '/v1/career', { token: cli.token })).body;
assert.equal(b.tiers[0].tasks.find((k) => k.id === 'ca_strap').ready, true, 'owning a gun makes Get Strapped ready');
r = await call('POST', '/v1/career/ca_strap', { token: cli.token });
assert.equal(r.code, 200, 'claimed');
const t1cash = CAREER.TIERS[0].tasks.find((k) => k.id === 'ca_strap').cash;
assert.equal(r.body.pay, t1cash, 'pays the tier-1 rate');
assert.equal(await careerLedger(cli.id), t1cash, 'the payout is a ledgered career: faucet row (§10.4 check (a) reconciles)');
assert.equal((await call('POST', '/v1/career/ca_strap', { token: cli.token })).body.error, 'claimed', 'once ever — the account PK latches it');

// ── climb tier 1: three more claims reach NEED and unlock tier 2 ──
await seedCh(cli.id, "path='gun', bank=30000");
await pool.query(`INSERT INTO character_disciplines (character_id, discipline, xp) VALUES ('${cli.id}', 'stamina', 10)`);
for (const id of ['ca_path', 'ca_bank', 'ca_regimen'])
  assert.equal((await call('POST', `/v1/career/${id}`, { token: cli.token })).code, 200, `${id} claims`);
b = (await call('GET', '/v1/career', { token: cli.token })).body;
assert.equal(b.tiers[0].done, 4, 'four tier-1 claims in');
assert.equal(b.tiers[1].open, true, `tier 2 opens at ${CAREER.NEED} claims — a declinable task never walls the climb`);
assert.equal(b.tiers[2].open, false, 'tier 3 still waits on tier 2');
// …and a tier-2 rung now claims (a racket makes the earner check true)
await pool.query(`INSERT INTO character_rackets (character_id, racket_id) VALUES ('${cli.id}', 'numbers')`);
r = await call('POST', '/v1/career/so_earner', { token: cli.token });
assert.equal(r.code, 200, 'a tier-2 rung claims once the tier is open');

// ── the capstone rides the SIXTH tier-1 claim (paying task cash + the whole tier bonus) ──
await pool.query(`INSERT INTO hustles (character_id, day, step, baseline) VALUES ('${cli.id}', 1, 3, '{}')`);
await pool.query(`INSERT INTO cars (id, character_id, model_id, trim_id) VALUES ('car-clem','${cli.id}','falcone','base')`);
r = await call('POST', '/v1/career/ca_hustle', { token: cli.token });
assert.equal(r.code, 200, 'the fifth tier-1 claim lands');
assert(!r.body.capstone, 'no capstone at five of six');
const before = await careerLedger(cli.id);
r = await call('POST', '/v1/career/ca_wheels', { token: cli.token });
assert.equal(r.code, 200, 'the sixth tier-1 claim lands');
assert.equal(r.body.capstone, CAREER.TIERS[0].capstone, 'the capstone rides the sixth claim');
const wheelsCash = CAREER.TIERS[0].tasks.find((k) => k.id === 'ca_wheels').cash;
assert.equal(r.body.pay, wheelsCash + CAREER.TIERS[0].capstone, 'one payout: the task + the tier bonus');
assert.equal(await careerLedger(cli.id) - before, r.body.pay, 'folded into ONE ledger row (the First-Week capstone pattern)');
b = (await call('GET', '/v1/career', { token: cli.token })).body;
assert.equal(b.tiers[0].complete, true, 'tier 1 reads complete');

// ── §10.4: every payout reconciles, and the vocabulary stays closed ──
const expected = CAREER.TIERS[0].tasks.reduce((a, k) => a + k.cash, 0) + CAREER.TIERS[0].capstone
  + CAREER.TIERS[1].tasks.find((k) => k.id === 'so_earner').cash;
assert.equal(await careerLedger(cli.id), expected, 'Σ career: ledger rows == exactly what the ladder paid');
const vocab = (await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `career: rides the §10.4 vocabulary (${JSON.stringify(vocab.unknown || [])})`);

// ── DEATH SURVIVAL: the ladder is the ACCOUNT's — the heir keeps the climb, and can't re-farm it ──
const kill = await call('POST', '/v1/mod/kill', { headers: { 'x-mod-key': 'test-mod-key' }, body: { characterId: cli.id, reason: 'test' } });
assert.equal(kill.code, 200, 'the climber dies');
const heir = (await pool.query(`SELECT id FROM characters WHERE account_id='${clemAcct}' AND alive`)).rows[0];
assert(heir, 'the heir rises');
b = (await call('GET', '/v1/career', { token: cli.token })).body;
assert.equal(b.tiers[0].complete, true, 'the heir inherits the completed tier');
assert.equal(b.tiers[1].open, true, 'and the opened tier stays open');
assert.equal((await call('POST', '/v1/career/ca_strap', { token: cli.token })).body.error, 'claimed', 'a claimed rung stays claimed across death — the faucet is bounded once per ACCOUNT');

console.log('✅ THE CAREER passed — five tiers of once-ever server-verified tasks: tier 1 open / the rest '
  + `locked, not_done refusals teach their own HOW, a claim pays a ledgered career: faucet row and latches on `
  + `the account PK, ${CAREER.NEED} claims open the next tier (a declinable task never walls a solo player), `
  + 'the capstone rides the SIXTH claim in one ledger row, Σ rows == Σ pays with the vocabulary closed, and '
  + 'the ladder SURVIVES DEATH — the heir keeps the climb and cannot re-farm a claimed rung');
process.exit(0);

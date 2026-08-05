// THE CAST & THE STORY test — the interpersonal cohesion layer (src/people.js).
//   · GET /v1/people: the nemesis (top recorded malice, enriched with the blood ledger + vendetta
//     state), the spouse, the consigliere (both directions), the family, the bodyguard pair BOTH
//     ways (the view only ever carried a raw id one way), the worked-for bonds, open vendettas
//   · GET /v1/people/history/:characterId: one merged chronological record of the pair — strikes
//     both directions, kills with the fallen street's name, marriage/divorce, peace offers, the
//     first meeting — and NEVER the rival_events detail JSONB (the info-economy rule)
//   · a dead nemesis line still shows its NAME (the ledger keeps the grudge; the face says gone)
//   · gates: self / gone; account UUIDs never leave either board
//   · pure reads: the whole suite writes ZERO transactions rows through these routes
import assert from 'node:assert';
import { buildServer } from '../src/server.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const id = (await meOf(token)).id;
  const acct = (await pool.query(`SELECT account_id a FROM characters WHERE id='${id}'`)).rows[0].a;
  return { token, id, acct };
};
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);
const uid = () => crypto.randomUUID();

const A = await mk('Sal the Reader');
const B = await mk('Two-Gun Tessio');
const C = await mk('Quiet Carmela');

// ── a fresh street has an EMPTY cast — every field present, nothing invented ──
{
  const r = await call('GET', '/v1/people', { token: A.token });
  assert.equal(r.code, 200, 'the cast reads');
  assert.equal(r.body.nemesis, null, 'no recorded malice → no nemesis');
  assert.equal(r.body.spouse, null, 'unmarried');
  assert.equal(r.body.consigliere, null, 'no adviser');
  assert.equal(r.body.advising, 0, 'counsels nobody');
  assert.equal(r.body.family, null, 'runs solo');
  assert.equal(r.body.guardedBy, null, 'unguarded');
  assert.deepEqual(r.body.guarding, [], 'guards nobody');
  assert.deepEqual(r.body.bonds, [], 'no worked-for contacts yet');
  assert.equal(r.body.vendettas, 0, 'no open vendettas');
  assert(!JSON.stringify(r.body).includes(A.acct), 'account UUIDs never leave the board');
}

// ── THE NEMESIS — top recorded malice, enriched with blood + vendetta ──
{
  // B moved on A three times, A hit back once — B is A's nemesis, not the reverse
  for (const kind of ['jump', 'rob', 'car_theft']) await pool.query(
    'INSERT INTO rival_events (id, victim_account, aggressor_account, kind, detail) VALUES ($1,$2,$3,$4,$5)',
    [uid(), A.acct, B.acct, kind, JSON.stringify({ amount: 123456 })]);
  await pool.query(
    'INSERT INTO rival_events (id, victim_account, aggressor_account, kind, detail) VALUES ($1,$2,$3,$4,$5)',
    [uid(), B.acct, A.acct, 'jump', '{}']);
  // B's bloodline once buried one of A's — blood is OWED
  await pool.query(
    "INSERT INTO kill_log (id, killer_account, victim_account, victim_name, at) VALUES ($1,$2,$3,'Old Sal', now() - interval '2 days')",
    [uid(), B.acct, A.acct]);
  // and A's line swore a vendetta over it
  await pool.query(
    "INSERT INTO vendettas (avenger_account, target_account, sworn, expires_at) VALUES ($1,$2,'Old Sal', now() + interval '5 days')",
    [A.acct, B.acct]);
  const r = (await call('GET', '/v1/people', { token: A.token })).body;
  assert(r.nemesis, 'the nemesis surfaces');
  assert.equal(r.nemesis.street?.id, B.id, "the nemesis is B's living street, keyed by characterId");
  assert.equal(r.nemesis.total, 3, 'three recorded strikes');
  assert.equal(r.nemesis.kills.theirs, 1, 'the blood ledger rides along');
  assert.equal(r.nemesis.bloodOwed, 1, 'they owe us a body');
  assert.equal(r.nemesis.vendetta.mine, true, 'my sworn vendetta shows');
  assert.equal(r.nemesis.vendetta.theirs, false, 'no vendetta the other way');
  assert.equal(r.vendettas, 1, 'the open-vendetta count agrees');
}

// ── THE ALLIANCES — spouse, consigliere (both directions), the family, the bonds ──
{
  const [x, y] = [A.acct, C.acct].sort();
  await pool.query(
    'INSERT INTO dynasty_marriages (account_a, account_b, proposed_by, accepted) VALUES ($1,$2,$3,true)', [x, y, A.acct]);
  await pool.query(
    'INSERT INTO consiglieri (dynasty_account, adviser_account, accepted) VALUES ($1,$2,true)', [A.acct, C.acct]);
  await pool.query(
    "INSERT INTO contacts (owner_account, contact_account, how, jobs, met_at) VALUES ($1,$2,'met',3, now() - interval '9 days')",
    [A.acct, C.acct]);
  await seedCh(A.id, 'cash=50000, respect=1000');
  const fg = await call('POST', '/v1/gangs', { token: A.token, body: { name: 'The Reading Room', tag: 'RDR' } });
  assert.equal(fg.code, 200, `founded a family (${JSON.stringify(fg.body)})`);
  const r = (await call('GET', '/v1/people', { token: A.token })).body;
  assert.equal(r.spouse?.street?.id, C.id, "the spouse resolves to the other house's living street");
  assert.equal(r.consigliere?.street?.id, C.id, 'my named adviser shows');
  assert.equal(r.family?.name, 'The Reading Room', 'the family rides the roster');
  assert.equal(r.family?.role, 'boss', 'with my role');
  assert.equal(r.bonds[0]?.name, 'Quiet Carmela', 'the worked-for contact is a bond');
  assert.equal(r.bonds[0]?.jobs, 3, 'with the jobs count');
  const rc = (await call('GET', '/v1/people', { token: C.token })).body;
  assert.equal(rc.advising, 1, "and C's board counts the house they counsel");
}

// ── THE MUSCLE — the bodyguard pair resolves to NAMES, both directions ──
{
  await seedCh(A.id, `guarded_by='${C.id}', guarded_until = now() + interval '2 hours'`);
  const ra = (await call('GET', '/v1/people', { token: A.token })).body;
  assert.equal(ra.guardedBy?.name, 'Quiet Carmela', 'who guards me, by name');
  const rc = (await call('GET', '/v1/people', { token: C.token })).body;
  assert.equal(rc.guarding[0]?.name, 'Sal the Reader', 'who I am guarding, by name — the direction no view carried');
}

// ── THE STORY — one merged timeline, both directions, no detail leak ──
{
  await pool.query(
    "INSERT INTO feud_peace_offers (from_account, target_account, at) VALUES ($1,$2, now() - interval '1 day')",
    [B.acct, A.acct]);
  const r = await call('GET', '/v1/people/history/' + B.id, { token: A.token });
  assert.equal(r.code, 200, 'the story reads');
  assert.equal(r.body.them.name, 'Two-Gun Tessio', 'the other party is named');
  const kinds = r.body.events.map((e) => e.kind);
  assert(kinds.includes('jump') && kinds.includes('rob'), 'their strikes are in the record');
  assert(r.body.events.some((e) => e.kind === 'jump' && e.who === 'me'), 'and mine, marked as mine');
  const kill = r.body.events.find((e) => e.kind === 'kill');
  assert.equal(kill?.who, 'them', 'the kill is theirs');
  assert.equal(kill?.fell, 'Old Sal', "with the fallen street's name");
  assert(r.body.events.some((e) => e.kind === 'peace_offer' && e.who === 'them'), 'the standing peace offer shows');
  assert.equal(r.body.bloodOwed, 1, 'the blood ledger closes the story');
  for (let i = 1; i < r.body.events.length; i++) assert(
    new Date(r.body.events[i - 1].at) >= new Date(r.body.events[i].at), 'the timeline runs newest-first');
  // THE INFO-ECONOMY RULE — the detail JSONB (which can carry amounts) never leaves
  assert(!JSON.stringify(r.body).includes('123456'), 'the rival_events detail JSONB never surfaces');
  assert(!JSON.stringify(r.body).includes(B.acct), 'no account UUIDs in the story either');
}

// ── gates + the dead-line face ──
{
  assert.equal((await call('GET', '/v1/people/history/' + A.id, { token: A.token })).body.error, 'self',
    'your own story you already know');
  assert.equal((await call('GET', '/v1/people/history/no-such-soul', { token: A.token })).body.error, 'gone',
    'a bogus id is a clean refusal');
  // kill B's street: the grudge stays, the face says gone — the NAME survives the line
  await pool.query(`UPDATE characters SET alive=false WHERE id='${B.id}'`);
  const r = (await call('GET', '/v1/people', { token: A.token })).body;
  assert.equal(r.nemesis.street?.alive, false, "a dead nemesis line reads as gone");
  assert.equal(r.nemesis.street?.name, 'Two-Gun Tessio', 'but the ledger keeps the name');
}

// ── pure reads — the whole suite moved NOTHING through these routes ──
{
  const n = Number((await pool.query(
    `SELECT COUNT(*) n FROM transactions WHERE character_id IN ('${A.id}','${B.id}','${C.id}') AND reason NOT LIKE 'gang:%'`)).rows[0].n);
  assert.equal(n, 0, 'the cast and the story are reads — zero ledger rows beyond the family founding');
}

console.log('✅ people test passed — the cast reads every relationship the game remembers (nemesis enriched with the blood ledger + vendetta state, spouse/consigliere both directions, the family, the bodyguard pair by NAME both ways, worked-for bonds), the story merges both bloodlines\' record newest-first with the fallen named and the detail JSONB withheld (the info-economy rule), a dead line keeps its name, self/gone refuse cleanly, account UUIDs never leave, and the whole layer moves zero value.');
await app.close();
process.exit(0);

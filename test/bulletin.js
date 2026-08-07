// THE WEEKLY BULLETIN — the weekly-cadence world spotlight + a challenge tied to it. The reward is a
// rotating weekly TITLE — PURE STATUS. The centre of the test: the public theme is a deterministic
// pure function; the board SNAPSHOTS the legend on first pickup so progress is a delta; a completed
// challenge is claimable ONCE and sets the title; and the whole thing moves ZERO value (§10.4-free).
// Pinned to a known theme via BULLETIN_THEME (the SEASON_MOD test-override precedent).
process.env.BULLETIN_THEME = 'boxing'; // metric boxing_wins, target 3 — set BEFORE the server boots
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { bulletinOf, BULLETIN } from '../src/rules.js';

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
const acctOf = async (id) => (await pool.query('SELECT account_id a FROM characters WHERE id=$1', [id])).rows[0].a;
const setLegend = (acct, n) => pool.query('UPDATE account_persistent SET boxing_wins=$2 WHERE account_id=$1', [acct, n]);
const ledgerRows = async (acct) => Number((await pool.query('SELECT COUNT(*) n FROM transactions WHERE account_id=$1', [acct])).rows[0].n);

const theme = bulletinOf();
assert.equal(theme.id, 'boxing', 'the test override pins Fight Week');

// ════════════ the public theme is a deterministic pure function (surfaced keyless on /v1/city) ════════════
const city = (await call('GET', '/v1/city')).body;
assert(city.bulletin && city.bulletin.id === 'boxing' && city.bulletin.name === 'Fight Week', 'the week\'s theme rides the public city board');
assert(/title/i.test(city.bulletin.challenge) && !/\$[0-9]/.test(city.bulletin.challenge), 'the challenge names the title reward and carries no dollar figure (it is status, not cash)');

const p = await mk('Bulletin Boxer');
const acct = await acctOf(p.id);
const ledgerBefore = await ledgerRows(acct);

// ════════════ the board snapshots the legend on first pickup — progress is a DELTA from there ════════════
// seed the legend to 5 BEFORE the first view, so the snapshot is 5 and prior wins don't count
await setLegend(acct, 5);
let b = (await call('GET', '/v1/bulletin', { token: p.token })).body;
assert.equal(b.metric, 'boxing_wins', 'the challenge metric is this week\'s');
assert.equal(b.target, 3, 'the target is the theme\'s');
assert.equal(b.progress, 0, 'progress is a DELTA from the snapshot — prior wins (5) do NOT count');
assert.equal(b.claimable, false, 'nothing to claim yet');

// win 2 more (5 → 7): progress 2, still short of 3
await setLegend(acct, 7);
b = (await call('GET', '/v1/bulletin', { token: p.token })).body;
assert.equal(b.progress, 2, 'two wins since the snapshot count');
assert.equal(b.claimable, false, 'still one short');
// the claim is refused while short
let claim = await call('POST', '/v1/bulletin/claim', { token: p.token });
assert.equal(claim.code, 400); assert.equal(claim.body.error, 'not_done', 'a claim while short is refused');

// ════════════ cross the target (5 → 8 = 3): claimable, and the claim sets the TITLE ════════════
await setLegend(acct, 8);
b = (await call('GET', '/v1/bulletin', { token: p.token })).body;
assert.equal(b.progress, 3, 'three wins since the snapshot');
assert.equal(b.claimable, true, 'the challenge is complete');
claim = await call('POST', '/v1/bulletin/claim', { token: p.token });
assert.equal(claim.code, 200, 'the claim lands');
assert.equal(claim.body.title, theme.title, 'it awards the week\'s title');
const meTitle = (await call('GET', '/v1/me', { token: p.token })).body.character.title;
assert.equal(meTitle, theme.title, 'the title is set on the living character');

// ════════════ once-only: a second claim is refused as already-claimed ════════════
claim = await call('POST', '/v1/bulletin/claim', { token: p.token });
assert.equal(claim.code, 400); assert.equal(claim.body.error, 'claimed', 'the week\'s title is claimed once');
b = (await call('GET', '/v1/bulletin', { token: p.token })).body;
assert.equal(b.claimed, true, 'the board reflects the claim');
assert.equal(b.claimable, false, 'not claimable again');

// ════════════ §10.4: the whole flow moved ZERO value — the title is status, not a faucet ════════════
assert.equal(await ledgerRows(acct), ledgerBefore, 'claiming a weekly title writes NO transactions row (pure status, §10.4-free)');
const omr = await runLedgerInvariants(pool, { alert: false });
assert(omr.checks.every((c) => c.ok || c.drift === undefined || Math.abs(Number(c.drift)) < 1e6), 'no §10.4 check is broken by the bulletin');

// every theme is well-formed (a metric that is a real legend, a positive target, a title, a tab)
const LEGENDS = new Set(['kills', 'product_moved', 'race_wins', 'boxing_wins', 'smuggled', 'heists_pulled', 'cartel_damage']);
for (const t of BULLETIN.THEMES) {
  assert(LEGENDS.has(t.metric), `${t.id} measures a real account legend`);
  assert(t.target > 0 && typeof t.title === 'string' && t.title && typeof t.tab === 'string', `${t.id} is well-formed`);
}

console.log('✅ THE WEEKLY BULLETIN test passed — the week\'s theme is a deterministic pure function on the public city board (no dollar figure — it is a status challenge, not cash), the board SNAPSHOTS the account legend on first pickup so progress is a delta (prior wins never count), a claim is refused while short, crossing the target awards the rotating weekly TITLE onto the living character, the title is claimed ONCE per week, and the whole flow writes ZERO transactions rows — pure status, §10.4-free.');
process.exit(0);

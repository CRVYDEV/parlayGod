// THE DISPATCH (src/dispatch.js) — the opt-in "while you were gone" email digest. DORMANT until an email
// provider key is set; OPT-IN only; one-click unsubscribe; §10.4-FREE (reads the Morning Paper, moves
// nothing). The centre of the test: prefs (bad email refused, opt-in stored), the unsubscribe token round-
// trips, the sweep emails exactly the lapsed opted-in players (and skips the active / too-long-gone /
// opted-out / no-provider), claim-then-send is idempotent, and nothing writes a ledger row.
import assert from 'node:assert';

// arm the provider BEFORE buildServer so digestConfigured() sees it (read at call time)
process.env.EMAIL_API_KEY = 'test-key';
process.env.EMAIL_FROM = 'OMERTA <noreply@omerta.fun>';
process.env.DIGEST_LAPSE_DAYS = '3';
process.env.DIGEST_COOLDOWN_DAYS = '7';
process.env.DIGEST_MAX_LAPSE_DAYS = '30';

const { buildServer } = await import('../src/server.js');
const Dispatch = await import('../src/dispatch.js');

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  let b; try { b = res.json(); } catch { b = res.body; }
  return { code: res.statusCode, body: b };
};
const meOf = async (token) => (await call('GET', '/v1/me', { token })).body.character;
const acctOf = async (id) => (await pool.query('SELECT account_id a FROM characters WHERE id=$1', [id])).rows[0].a;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const id = (await meOf(token)).id;
  return { token, id, acct: await acctOf(id) };
};
const uid = () => 'n-' + Math.random().toString(36).slice(2);
const setActive = (acct, daysAgo) => pool.query('INSERT INTO telemetry (id, account_id, event, at) VALUES ($1,$2,$3,$4)',
  [uid(), acct, 'crime', new Date(Date.now() - daysAgo * 86400000)]);
const addNote = (charId, type) => pool.query('INSERT INTO notifications (id, character_id, type, payload, created_at) VALUES ($1,$2,$3,$4,$5)',
  [uid(), charId, type, '{}', new Date(Date.now() - 2 * 86400000)]);

// ════════════ configured — the availability flag is surfaced ════════════
assert.equal(Dispatch.digestConfigured(), true, 'the provider is armed');
assert.equal((await call('GET', '/v1/rules')).body.digest.available, true, 'the client sees digest available on /v1/rules');

// ════════════ prefs: bad email refused, opt-in stored, read back ════════════
const p = await mk('Digest Guy');
assert.equal((await call('POST', '/v1/digest', { token: p.token, body: { email: 'not-an-email', optin: true } })).body.error, 'bad_email', 'a malformed address is refused');
assert.equal((await call('POST', '/v1/digest', { token: p.token, body: { optin: true } })).body.error, 'no_email', 'you cannot turn on the digest with no address');
let prefs = (await call('POST', '/v1/digest', { token: p.token, body: { email: 'Player@Example.com', optin: true } })).body;
assert.equal(prefs.optin, true, 'opt-in stored');
assert.equal(prefs.email, 'player@example.com', 'the address is normalized (lowercased)');
assert.equal((await call('GET', '/v1/digest', { token: p.token })).body.optin, true, 'the prefs read back');

// ════════════ the unsubscribe token round-trips (stateless HMAC), and a bad one is rejected ════════════
const tok = Dispatch.unsubToken(p.acct);
assert.ok(Dispatch.verifyUnsub(p.acct, tok), 'the account\'s own token verifies');
assert.ok(!Dispatch.verifyUnsub(p.acct, 'wrong-token'), 'a forged token does not');

// ════════════ THE SWEEP — email exactly the lapsed, opted-in player ════════════
const sent = [];
Dispatch.__setSender(async (to, subject, html, text) => { sent.push({ to, subject, html, text }); return true; });

// p is lapsed (last active 5 days ago) with something in the window → EMAILED
await setActive(p.acct, 5);
await addNote(p.id, 'sacked');
await addNote(p.id, 'bounty_on_you');
// an ACTIVE opted-in player (active 1 day ago) → SKIPPED (not away)
const act1 = await mk('Active Guy');
await call('POST', '/v1/digest', { token: act1.token, body: { email: 'a@b.com', optin: true } });
await setActive(act1.acct, 1);
await addNote(act1.id, 'robbed');
// a LONG-gone opted-in player (active 60 days ago) → SKIPPED (past max lapse; we stop nagging)
const gone = await mk('Ghost');
await call('POST', '/v1/digest', { token: gone.token, body: { email: 'g@b.com', optin: true } });
await setActive(gone.acct, 60);
await addNote(gone.id, 'indicted');
// an OPTED-OUT lapsed player → SKIPPED
const out = await mk('Opted Out');
await setActive(out.acct, 5);
await addNote(out.id, 'sacked');

const n = await Dispatch.sweepDispatch(pool);
assert.equal(n, 1, 'exactly one email sent — only the lapsed, opted-in, recently-enough player');
assert.equal(sent.length, 1, 'the sender saw exactly one message');
assert.equal(sent[0].to, 'player@example.com', 'to the right address');
assert.ok(/while you were gone/i.test(sent[0].subject) || /moved without you/i.test(sent[0].subject) || sent[0].subject.length > 0, 'the subject is set');
assert.ok(/seized one of your fronts|contract/i.test(sent[0].html), 'the body carries the window headlines');
assert.ok(sent[0].html.includes('/v1/digest/unsubscribe'), 'every email carries an unsubscribe link');

// ════════════ COOLDOWN + claim-then-send: a second sweep re-emails nobody ════════════
sent.length = 0;
assert.equal(await Dispatch.sweepDispatch(pool), 0, 'the cooldown (digest_at just stamped) blocks a re-send');
assert.equal(sent.length, 0, 'no second buzz');

// ════════════ DORMANT without a key — nothing sends, availability off ════════════
delete process.env.EMAIL_API_KEY;
assert.equal(Dispatch.digestConfigured(), false, 'no key → dormant');
assert.equal((await call('GET', '/v1/rules')).body.digest.available, false, 'availability off without a key');
// reset digest_at so p would be eligible again, then prove the dormant sweep sends nothing
await pool.query('UPDATE account_persistent SET digest_at=NULL WHERE account_id=$1', [p.acct]);
sent.length = 0;
assert.equal(await Dispatch.sweepDispatch(pool), 0, 'a dormant sweep sends nothing');
assert.equal(sent.length, 0, 'nothing sent while dormant');
process.env.EMAIL_API_KEY = 'test-key';

// ════════════ the unsubscribe route flips it off (keyless, token-authed) ════════════
const un = await call('GET', `/v1/digest/unsubscribe?a=${encodeURIComponent(p.acct)}&t=${tok}`);
assert.equal(un.code, 200, 'the unsubscribe page renders');
assert.ok(/unsubscribed/i.test(String(un.body)), 'it confirms the unsubscribe');
assert.equal((await call('GET', '/v1/digest', { token: p.token })).body.optin, false, 'the digest is now OFF');
// a bad token does not unsubscribe anyone
await call('POST', '/v1/digest', { token: act1.token, body: { optin: true, email: 'a@b.com' } });
await call('GET', `/v1/digest/unsubscribe?a=${encodeURIComponent(act1.acct)}&t=bad`);
assert.equal((await pool.query('SELECT digest_optin FROM account_persistent WHERE account_id=$1', [act1.acct])).rows[0].digest_optin, true, 'a forged unsubscribe link does nothing');

// ════════════ §10.4 — the digest moves no value ════════════
assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n), 0, 'THE DISPATCH writes no ledger rows — it is pure notification');

console.log('dispatch: PASS');
await app.close();
process.exit(0);

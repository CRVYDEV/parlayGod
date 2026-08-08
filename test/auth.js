// THE AUTH SURFACE — the parts security.js doesn't cover.
//
// security.js already exercises the CONCURRENCY of auth (the invite stampede, the same-identity
// create race, the agent throttle, guest sign-in, name uniqueness). What had no coverage was the
// SEMANTICS of the provider paths: the Privy JWT verifier (its `aud`-may-be-an-array acceptance and
// its fail-closed hardening — the exact lines two red-team passes tightened), the guest→provider
// UPGRADE that must preserve the account row and everything on it (§4), find-or-create's ban +
// invite gates, and the OAuth2/PKCE state machine's CSRF guard.
//
// Privy is tested with REAL crypto — a P-256 keypair, a genuinely ES256-signed token, and the app's
// JWKS served through a stubbed global fetch — so this proves signature verification, not a mock of
// it. Everything else is unit-level against a pg-mem pool: no network, no HTTP.
import assert from 'node:assert';
import crypto from 'node:crypto';
import { makeDb } from '../src/db.js';
import { buildServer } from '../src/server.js';
import { verifyPrivy, upgradeAccount, accountForIdentity, consumeInvite, xOAuthStart, xOAuthCallback } from '../src/auth.js';

process.env.PRIVY_APP_ID = 'omerta-test-app';
const APP = process.env.PRIVY_APP_ID;

// ── a real ES256 signer + its JWKS, so verifyPrivy checks a genuine signature ──
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-kid', alg: 'ES256', use: 'sig' };
const b64u = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function signPrivy(claims, { alg = 'ES256', kid = 'test-kid' } = {}) {
  const head = b64u({ alg, typ: 'JWT', kid });
  const body = b64u({ iss: 'privy.io', exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${sig.toString('base64url')}`;
}
// serve the JWKS: verifyPrivy fetches https://auth.privy.io/api/v1/apps/<id>/jwks.json
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).includes('/jwks.json')) return { ok: true, json: async () => ({ keys: [jwk] }) };
  return realFetch(url, opts);
};

// ── verifyPrivy: the aud-array gap + the fail-closed hardening ──
{
  // aud as a SCALAR matching our appId → accepted
  let id = await verifyPrivy(signPrivy({ sub: 'privy-user-1', aud: APP }));
  assert.deepEqual(id, { provider: 'privy', subject: 'privy-user-1' }, 'scalar aud accepted');

  // aud as an ARRAY containing our appId → accepted (the OIDC-both-forms feature)
  id = await verifyPrivy(signPrivy({ sub: 'privy-user-2', aud: ['other-app', APP] }));
  assert.equal(id.subject, 'privy-user-2', 'array aud containing our appId accepted');

  // aud for ANOTHER app → rejected (fail-closed, both forms)
  await assert.rejects(() => verifyPrivy(signPrivy({ sub: 'x', aud: 'someone-else' })), /another app/, 'scalar wrong-aud rejected');
  await assert.rejects(() => verifyPrivy(signPrivy({ sub: 'x', aud: ['a', 'b'] })), /another app/, 'array without our appId rejected');

  // wrong algorithm in the header → rejected (alg-confusion defense)
  await assert.rejects(() => verifyPrivy(signPrivy({ sub: 'x', aud: APP }, { alg: 'HS256' })), /algorithm/, 'non-ES256 alg rejected');

  // a token signed by a DIFFERENT key → signature check fails
  const { privateKey: evilKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const head = b64u({ alg: 'ES256', typ: 'JWT', kid: 'test-kid' });
  const body = b64u({ iss: 'privy.io', exp: Math.floor(Date.now() / 1000) + 3600, sub: 'x', aud: APP });
  const forged = `${head}.${body}.${crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: evilKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  await assert.rejects(() => verifyPrivy(forged), /signature/, 'a forged signature is rejected');

  // malformed / garbage tokens → clean auth_failed (never a raw 500)
  await assert.rejects(() => verifyPrivy('not.a.jwt'), (e) => e.code === 'auth_failed', 'garbage segments → clean error');
  await assert.rejects(() => verifyPrivy('onlyonepart'), (e) => e.code === 'auth_failed', 'truncated token → clean error');
  await assert.rejects(() => verifyPrivy(''), (e) => e.code === 'token', 'empty token rejected');

  // missing issuer → rejected (was fail-open on an absent claim)
  await assert.rejects(() => verifyPrivy(signPrivy({ sub: 'x', aud: APP, iss: undefined })), /issuer/, 'absent/mismatched iss rejected');

  // expired token → rejected
  const expired = signPrivy({ sub: 'x', aud: APP, exp: Math.floor(Date.now() / 1000) - 10 });
  await assert.rejects(() => verifyPrivy(expired), /expired/, 'expired token rejected');
  console.log('✅ verifyPrivy: scalar+array aud accepted, wrong-aud/alg/sig/iss/exp/malformed all fail-closed');
}

// ── accountForIdentity: find-or-create, ban gate, invite gate ──
const pool = await makeDb();
{
  const ip = '1.2.3.4';
  const a = await accountForIdentity(pool, { provider: 'privy', subject: 's1' }, ip, null);
  assert.equal(a.created, true, 'first sign-in creates the account');
  assert.equal((await pool.query('SELECT 1 FROM account_persistent WHERE account_id=$1', [a.accountId])).rowCount, 1, 'the persistent row is created too');
  const again = await accountForIdentity(pool, { provider: 'privy', subject: 's1' }, ip, null);
  assert.equal(again.created, false, 'a second sign-in adopts the same account row');
  assert.equal(again.accountId, a.accountId, 'the account id is stable across sign-ins');

  // banned → refused
  await pool.query("UPDATE accounts SET status='banned' WHERE id=$1", [a.accountId]);
  await assert.rejects(() => accountForIdentity(pool, { provider: 'privy', subject: 's1' }, ip, null), (e) => e.code === 'banned', 'a banned identity is refused');

  // INVITE_MODE gate: a new identity needs a valid code
  process.env.INVITE_MODE = 'on';
  await assert.rejects(() => accountForIdentity(pool, { provider: 'privy', subject: 's2' }, ip, 'nope'), (e) => e.code === 'invite', 'a bad invite code is refused under INVITE_MODE');
  assert.equal((await pool.query("SELECT 1 FROM accounts WHERE auth_subject='s2'")).rowCount, 0, 'the failed create rolled back — no orphan account');
  await pool.query("INSERT INTO invite_codes (code, uses_left) VALUES ('GOODONE', 1)");
  const c = await accountForIdentity(pool, { provider: 'privy', subject: 's2' }, ip, 'GOODONE');
  assert.equal(c.created, true, 'a valid code lets the new identity in');
  assert.equal(Number((await pool.query("SELECT uses_left FROM invite_codes WHERE code='GOODONE'")).rows[0].uses_left), 0, 'the invite use was consumed atomically');
  process.env.INVITE_MODE = 'off';
  console.log('✅ accountForIdentity: create/adopt, ban gate, and the atomic invite consume');
}

// ── consumeInvite: off is a pass, on burns exactly one use and refuses when exhausted ──
{
  assert.equal(await consumeInvite(pool, 'anything'), true, 'INVITE_MODE off is always a pass');
  process.env.INVITE_MODE = 'on';
  await pool.query("INSERT INTO invite_codes (code, uses_left) VALUES ('ONESHOT', 1)");
  assert.equal(await consumeInvite(pool, 'ONESHOT'), true, 'a fresh code is consumed');
  await assert.rejects(() => consumeInvite(pool, 'ONESHOT'), (e) => e.code === 'invite', 'the exhausted code is refused');
  assert.equal(Number((await pool.query("SELECT uses_left FROM invite_codes WHERE code='ONESHOT'")).rows[0].uses_left), 0, 'uses_left never went negative');
  process.env.INVITE_MODE = 'off';
  console.log('✅ consumeInvite: off passes, on consumes one use, exhaustion refuses without going negative');
}

// ── the guest → provider UPGRADE preserves the account row and its possessions (§4). Tested end to
// end through the server, using a genuinely signed Privy token so the whole /v1/auth/upgrade path runs.
{
  const app = await buildServer();
  const call = async (method, url, { token, body } = {}) => {
    const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
    return { code: res.statusCode, body: res.json() };
  };
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name: 'Guest Ghost' } });
  const before = (await call('GET', '/v1/me', { token })).body.character;
  await app.pool.query('UPDATE characters SET cash=77777 WHERE id=$1', [before.id]);   // put something on the account
  const acctId = (await app.pool.query('SELECT account_id FROM characters WHERE id=$1', [before.id])).rows[0].account_id;

  const good = signPrivy({ sub: 'upgrade-me', aud: APP });
  const up = await call('POST', '/v1/auth/upgrade', { token, body: { provider: 'privy', token: good } });
  assert.equal(up.code, 200, 'the upgrade succeeds');
  assert.equal(up.body.provider, 'privy', 'now a Privy account');
  const after = (await call('GET', '/v1/me', { token })).body.character;
  assert.equal(after.id, before.id, 'the SAME living character survives the upgrade');
  assert.equal((await app.pool.query('SELECT account_id FROM characters WHERE id=$1', [after.id])).rows[0].account_id, acctId, 'the SAME account row — possessions preserved (§4)');
  assert.equal(Number((await app.pool.query('SELECT cash FROM characters WHERE id=$1', [before.id])).rows[0].cash), 77777, 'the cash on the account is intact');
  assert.equal((await app.pool.query('SELECT auth_provider FROM accounts WHERE id=$1', [acctId])).rows[0].auth_provider, 'privy', 'the account row was re-provider-stamped, not replaced');

  // a second upgrade of the now-provider account is refused (only guests upgrade)
  await assert.rejects(() => upgradeAccount(app.pool, acctId, { provider: 'x', subject: 'z' }), (e) => e.code === 'not_guest', 'a non-guest account cannot upgrade again');

  // a fresh guest cannot claim an identity already linked elsewhere
  const { body: { token: t2 } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token: t2, body: { name: 'Other Guy' } });
  const g2ch = (await call('GET', '/v1/me', { token: t2 })).body.character;
  const g2 = (await app.pool.query('SELECT account_id FROM characters WHERE id=$1', [g2ch.id])).rows[0].account_id;
  await assert.rejects(() => upgradeAccount(app.pool, g2, { provider: 'privy', subject: 'upgrade-me' }), (e) => e.code === 'linked_elsewhere', 'an already-linked identity is refused');
  await app.close();
  console.log('✅ guest→provider upgrade keeps the same account+character and its cash; re-upgrade and identity-clash refused');
}

// ── the OAuth2/PKCE state machine: dormant unless configured; state persists; a mismatched state is
// a CLEAN GameError, never a 500 (the CSRF guard on the callback). ──
{
  // no X_CLIENT_ID → the flow is dormant (start refuses to mint a URL)
  delete process.env.X_CLIENT_ID;
  await assert.rejects(() => xOAuthStart(pool, {}), () => true, 'X OAuth is dormant without X_CLIENT_ID');

  process.env.X_CLIENT_ID = 'test-client';
  process.env.PUBLIC_URL = 'https://omerta.test';
  const { url, state } = await xOAuthStart(pool, { accountId: null, invite: null });
  assert(url.includes('test-client') && url.includes('code_challenge'), 'the authorize URL carries the client id + PKCE challenge');
  assert.equal((await pool.query('SELECT 1 FROM oauth_states WHERE state=$1', [state])).rowCount, 1, 'the state + verifier persisted for the callback');

  // a callback presenting a state that was never issued → clean GameError (not a crash)
  await assert.rejects(() => xOAuthCallback(pool, { code: 'x', state: 'never-issued' }), (e) => e.code && typeof e.code === 'string', 'an unknown state is a clean typed error, never a 500');
  delete process.env.X_CLIENT_ID; delete process.env.PUBLIC_URL;
  console.log('✅ X OAuth2/PKCE: dormant without config, state persists on start, an unknown state fails clean');
}

global.fetch = realFetch;
console.log('✅ auth surface suite passed');
await pool.end?.();

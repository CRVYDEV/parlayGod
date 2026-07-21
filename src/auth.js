// §4 — real auth providers alongside guest. Each verifier resolves a provider
// token to a stable (auth_provider, auth_subject) pair; account rows are
// created-or-fetched on that pair, and a guest account can upgrade in place
// (preserving every possession, since everything hangs off the account row).
import crypto from 'node:crypto';
import { GameError } from './game.js';

// X (Twitter): the client sends the user's OAuth2 access token; we resolve it
// via /2/users/me. SECURITY — an X OAuth2 *access token* carries no app-audience
// we can verify (unlike a Privy JWT with its `aud`), so trusting one a user
// pasted lets ANY app the victim ever authorized mint a session for their
// OMERTA account (a confused-deputy account-takeover). The correct production
// path is a server-side authorization-code + PKCE exchange (the token is then
// app-bound by construction) — deploy-time work. Until that's wired, this
// bearer-probe stopgap is OFF by default and only usable when an operator
// explicitly accepts the risk for a closed alpha (`X_TRUST_USER_TOKEN=on` — the
// SOCIAL_VERIFY_MODE / INVITE_MODE default-safe posture). A misconfigured or
// default production therefore never silently accepts an unbound X token.
export async function verifyX(accessToken) {
  if (!accessToken) throw new GameError('token', 'Missing X access token.');
  if ((process.env.X_TRUST_USER_TOKEN || 'off') !== 'on')
    throw new GameError('provider_unavailable', 'X sign-in is not enabled on this server.');
  const res = await fetch('https://api.x.com/2/users/me', {
    headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new GameError('auth_failed', 'X rejected that token.');
  const data = await res.json();
  if (!data?.data?.id) throw new GameError('auth_failed', 'X returned no identity.');
  return { provider: 'x', subject: String(data.data.id) };
}

// Privy: access tokens are ES256 JWTs signed by the app's key; verify against
// the app's JWKS (fetched once and cached). Requires PRIVY_APP_ID.
let privyJwks = null;
async function fetchJwks(appId) {
  const res = await fetch(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`);
  if (!res.ok) throw new GameError('provider_unavailable', 'Privy JWKS unavailable.');
  return res.json();
}
export async function verifyPrivy(token) {
  const appId = process.env.PRIVY_APP_ID;
  if (!appId) throw new GameError('provider_unavailable', 'Privy sign-in is not configured on this server.');
  if (!token) throw new GameError('token', 'Missing Privy token.');
  const [h, p, sig] = String(token).split('.');
  if (!h || !p || !sig) throw new GameError('auth_failed', 'Malformed Privy token.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  // pin the algorithm: only ES256 is accepted (defense-in-depth against alg confusion)
  if (header.alg !== 'ES256') throw new GameError('auth_failed', 'Unexpected Privy token algorithm.');
  const findKey = async () => {
    if (!privyJwks) privyJwks = await fetchJwks(appId);
    let jwk = (privyJwks.keys || []).find((k) => k.kid === header.kid);
    if (!jwk) { privyJwks = await fetchJwks(appId); jwk = (privyJwks.keys || []).find((k) => k.kid === header.kid); } // refresh on rotation
    return jwk;
  };
  const jwk = await findKey();
  if (!jwk) throw new GameError('auth_failed', 'No matching Privy signing key.'); // no blind keys[0] fallback
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const okSig = crypto.verify('sha256', Buffer.from(`${h}.${p}`),
    { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
  if (!okSig) throw new GameError('auth_failed', 'Privy signature check failed.');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  // `aud` may be a scalar or an array (OIDC allows both; some Privy app configs emit `[appId]`) — accept
  // either as long as our appId is present. Still fail-closed: an absent/mismatched audience is rejected.
  const audOk = Array.isArray(claims.aud) ? claims.aud.includes(appId) : claims.aud === appId;
  if (!audOk) throw new GameError('auth_failed', 'Privy token is for another app.');
  if (claims.iss && claims.iss !== 'privy.io') throw new GameError('auth_failed', 'Unexpected Privy issuer.');
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw new GameError('auth_failed', 'Privy token expired or non-expiring.');
  if (!claims.sub) throw new GameError('auth_failed', 'Privy token has no subject.');
  return { provider: 'privy', subject: String(claims.sub) };
}

// Find-or-create the account for a verified identity. Returns {accountId, created}.
// UNIQUE(auth_provider,auth_subject) makes the create race-safe: on a concurrent
// double sign-in one INSERT wins, the loser catches the conflict and adopts the row.
export async function accountForIdentity(pool, { provider, subject }, ip) {
  const existing = (await pool.query('SELECT id, status FROM accounts WHERE auth_provider=$1 AND auth_subject=$2', [provider, subject])).rows[0];
  if (existing) {
    if (existing.status === 'banned') throw new GameError('banned', 'This account is banned.');
    await pool.query('UPDATE accounts SET last_ip=$2 WHERE id=$1', [existing.id, ip]);
    return { accountId: existing.id, created: false };
  }
  const id = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO accounts (id, auth_provider, auth_subject, created_ip, last_ip) VALUES ($1,$2,$3,$4,$4)',
      [id, provider, subject, ip]);
    await client.query('INSERT INTO account_persistent (account_id) VALUES ($1)', [id]);
    await client.query('COMMIT');
    return { accountId: id, created: true };
  } catch (e) {
    await client.query('ROLLBACK');
    const row = (await pool.query('SELECT id, status FROM accounts WHERE auth_provider=$1 AND auth_subject=$2', [provider, subject])).rows[0];
    if (row) { // lost the create race — adopt the winner's row
      if (row.status === 'banned') throw new GameError('banned', 'This account is banned.');
      return { accountId: row.id, created: false };
    }
    throw e;
  } finally { client.release(); }
}

// Guest → provider upgrade: same account row, so possessions survive (§4). The
// UNIQUE constraint is the real guard — the pre-check is just a friendlier error.
export async function upgradeAccount(pool, accountId, { provider, subject }) {
  const acct = (await pool.query('SELECT auth_provider FROM accounts WHERE id=$1', [accountId])).rows[0];
  if (!acct) throw new GameError('no_account', 'No such account.');
  if (acct.auth_provider !== 'guest') throw new GameError('not_guest', 'Only guest accounts upgrade.');
  const taken = (await pool.query('SELECT id FROM accounts WHERE auth_provider=$1 AND auth_subject=$2', [provider, subject])).rows[0];
  if (taken) throw new GameError('linked_elsewhere', 'That identity already has an account.');
  try {
    await pool.query('UPDATE accounts SET auth_provider=$2, auth_subject=$3 WHERE id=$1', [accountId, provider, subject]);
  } catch { // lost the race to another upgrade/sign-in for the same identity
    throw new GameError('linked_elsewhere', 'That identity already has an account.');
  }
  return { ok: true, provider };
}

// Closed-alpha invite gate: atomically consume one use of a valid code (INVITE_MODE=on).
// The guarded UPDATE is the whole check — a SELECT-then-UPDATE would let concurrent
// signups all pass on a single 1-use code and drive uses_left negative.
export async function consumeInvite(pool, code) {
  if ((process.env.INVITE_MODE || 'off') !== 'on') return true;
  const r = await pool.query('UPDATE invite_codes SET uses_left = uses_left - 1 WHERE code=$1 AND uses_left > 0', [String(code || '')]);
  if (r.rowCount !== 1) throw new GameError('invite', 'This alpha is invite-only. Ask a made man for a code.');
  return true;
}

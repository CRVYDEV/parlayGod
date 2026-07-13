// §4 — real auth providers alongside guest. Each verifier resolves a provider
// token to a stable (auth_provider, auth_subject) pair; account rows are
// created-or-fetched on that pair, and a guest account can upgrade in place
// (preserving every possession, since everything hangs off the account row).
import crypto from 'node:crypto';
import { GameError } from './game.js';

// X (Twitter): the client sends the user's OAuth2 access token; we resolve it
// via /2/users/me. No app secret needed — the user token carries the identity.
export async function verifyX(accessToken) {
  if (!accessToken) throw new GameError('token', 'Missing X access token.');
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
export async function verifyPrivy(token) {
  const appId = process.env.PRIVY_APP_ID;
  if (!appId) throw new GameError('provider_unavailable', 'Privy sign-in is not configured on this server.');
  if (!token) throw new GameError('token', 'Missing Privy token.');
  const [h, p, sig] = String(token).split('.');
  if (!h || !p || !sig) throw new GameError('auth_failed', 'Malformed Privy token.');
  if (!privyJwks) {
    const res = await fetch(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`);
    if (!res.ok) throw new GameError('provider_unavailable', 'Privy JWKS unavailable.');
    privyJwks = await res.json();
  }
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const jwk = (privyJwks.keys || []).find((k) => k.kid === header.kid) || (privyJwks.keys || [])[0];
  if (!jwk) throw new GameError('auth_failed', 'No Privy signing key found.');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const okSig = crypto.verify('sha256', Buffer.from(`${h}.${p}`),
    { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
  if (!okSig) throw new GameError('auth_failed', 'Privy signature check failed.');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (claims.aud !== appId || (claims.exp && claims.exp * 1000 < Date.now()))
    throw new GameError('auth_failed', 'Privy token expired or for another app.');
  return { provider: 'privy', subject: String(claims.sub) };
}

// Find-or-create the account for a verified identity. Returns {accountId, created}.
export async function accountForIdentity(pool, { provider, subject }, ip) {
  const existing = (await pool.query('SELECT id, status FROM accounts WHERE auth_provider=$1 AND auth_subject=$2', [provider, subject])).rows[0];
  if (existing) {
    if (existing.status === 'banned') throw new GameError('banned', 'This account is banned.');
    await pool.query('UPDATE accounts SET last_ip=$2 WHERE id=$1', [existing.id, ip]);
    return { accountId: existing.id, created: false };
  }
  const id = crypto.randomUUID();
  await pool.query('INSERT INTO accounts (id, auth_provider, auth_subject, created_ip, last_ip) VALUES ($1,$2,$3,$4,$4)',
    [id, provider, subject, ip]);
  await pool.query('INSERT INTO account_persistent (account_id) VALUES ($1)', [id]);
  return { accountId: id, created: true };
}

// Guest → provider upgrade: same account row, so possessions survive (§4).
export async function upgradeAccount(pool, accountId, { provider, subject }) {
  const acct = (await pool.query('SELECT auth_provider FROM accounts WHERE id=$1', [accountId])).rows[0];
  if (!acct) throw new GameError('no_account', 'No such account.');
  if (acct.auth_provider !== 'guest') throw new GameError('not_guest', 'Only guest accounts upgrade.');
  const taken = (await pool.query('SELECT id FROM accounts WHERE auth_provider=$1 AND auth_subject=$2', [provider, subject])).rows[0];
  if (taken) throw new GameError('linked_elsewhere', 'That identity already has an account.');
  await pool.query('UPDATE accounts SET auth_provider=$2, auth_subject=$3 WHERE id=$1', [accountId, provider, subject]);
  return { ok: true, provider };
}

// Closed-alpha invite gate: consume one use of a valid code (INVITE_MODE=on).
export async function consumeInvite(pool, code) {
  if ((process.env.INVITE_MODE || 'off') !== 'on') return true;
  const c = (await pool.query('SELECT * FROM invite_codes WHERE code=$1', [String(code || '')])).rows[0];
  if (!c || Number(c.uses_left) < 1) throw new GameError('invite', 'This alpha is invite-only. Ask a made man for a code.');
  await pool.query('UPDATE invite_codes SET uses_left = uses_left - 1 WHERE code=$1', [c.code]);
  return true;
}

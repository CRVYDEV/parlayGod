// ── SOLANA VERIFICATION — the dependency-free leaf the drop's Solana leg stands on ──
//
// The founder-directed launch build (SIGN-OFF 2026-08-16: the $ANSEM-class Solana community joins
// the community drop, "build Solana support for launch"). The EVM claim rail rides SIWE + viem's
// secp256k1 `verifyMessage`; a Solana wallet signs with ed25519 over a base58 pubkey, so this module
// supplies exactly the two primitives that differ — base58 and ed25519 — and NOTHING else. Node's
// own crypto verifies ed25519 natively (the raw 32-byte pubkey wrapped in the fixed SPKI DER
// prefix), so the game takes NO new dependency for a new signature-verification surface — every
// byte of the verification path is stdlib + ~40 auditable lines here.
//
// SECURITY POSTURE (this is a signature-verification surface — the red-team rules):
//  - verify() never throws on hostile input: a malformed address, a wrong-length key, a garbage
//    signature are all a clean `false` (the walletVerify "malformed → clean 400, never a 500" rule).
//  - Base58 is CASE-SENSITIVE — callers must never lowercase a Solana address (the loader and the
//    claim path match it verbatim; the EVM lower() convention explicitly does not apply).
//  - The signature is accepted base58 OR base64 (Phantom hands clients raw bytes; base64 is the
//    cheap browser encoding, base58 the ecosystem's convention) — both decode paths must land on
//    exactly 64 bytes or the verify is false.
//
// §10.4: none — pure functions, no DB, no value.
import crypto from 'node:crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_MAP = new Map([...ALPHABET].map((c, i) => [c, BigInt(i)]));

// base58 decode (bitcoin alphabet) → Buffer, or null on any invalid character
export function base58Decode(s) {
  if (typeof s !== 'string' || !s.length || s.length > 90) return null;
  let n = 0n;
  for (const c of s) {
    const v = B58_MAP.get(c);
    if (v === undefined) return null;
    n = n * 58n + v;
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const c of s) { if (c === '1') bytes.unshift(0); else break; } // leading zeros
  return Buffer.from(bytes);
}

export function base58Encode(buf) {
  let n = 0n;
  for (const b of buf) n = (n << 8n) + BigInt(b);
  let out = '';
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b === 0) out = '1' + out; else break; }
  return out;
}

// a Solana address is a base58-encoded 32-byte ed25519 public key
export const isSolAddress = (s) => {
  const raw = base58Decode(s);
  return !!raw && raw.length === 32;
};

// ed25519 raw public key → node KeyObject (the fixed SPKI DER prefix for OID 1.3.101.112)
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

// verify an ed25519 signature over a utf8 message, signed by the wallet at `address`.
// Signature accepted as base58 or base64; every failure mode is a clean `false`.
export function verifySolSig(address, message, signature) {
  try {
    const pub = base58Decode(address);
    if (!pub || pub.length !== 32) return false;
    let sig = base58Decode(String(signature || ''));
    if (!sig || sig.length !== 64) {
      try { sig = Buffer.from(String(signature || ''), 'base64'); } catch { return false; }
    }
    if (!sig || sig.length !== 64) return false;
    const key = crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, pub]), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(String(message), 'utf8'), key, sig);
  } catch { return false; } // hostile input is a refusal, never a 500
}

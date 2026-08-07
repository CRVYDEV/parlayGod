// PROCEDURAL PLAYER PORTRAITS — a deterministic noir mugshot per seed (a character id), so a name reads
// as a PERSON on the roster/Cast/circle/leaderboards. The centre of the test: it is DETERMINISTIC (same
// seed → same face), DISTINCT (different seeds differ), well-formed SVG, has NO injection surface (the seed
// is hash-only, never rendered), and the route serves it public + cacheable + moving no value.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { avatarSvg } from '../src/avatar.js';

const app = await buildServer();
const pool = app.pool;

// ════════════ deterministic + distinct ════════════
assert.equal(avatarSvg('char-abc-123'), avatarSvg('char-abc-123'), 'the same seed always renders the same face');
assert.notEqual(avatarSvg('char-abc-123'), avatarSvg('char-xyz-789'), 'different seeds render different faces');
// a decent spread across many seeds (not all collapsing to one look)
const faces = new Set(); for (let i = 0; i < 200; i++) faces.add(avatarSvg('seed-' + i));
assert.ok(faces.size > 180, `portraits vary across seeds (got ${faces.size}/200 distinct)`);

// ════════════ well-formed SVG ════════════
const one = avatarSvg('vito');
assert.ok(one.startsWith('<svg') && one.trimEnd().endsWith('</svg>'), 'a well-formed <svg>');
assert.ok(one.includes('viewBox="0 0 100 100"'), 'the fixed portrait viewBox');
assert.ok(!/undefined|NaN/.test(one), 'no undefined/NaN leaked into the markup');

// ════════════ NO injection surface — the seed is hash-only, never rendered ════════════
const evil = avatarSvg('"><script>alert(1)</script>');
assert.ok(!evil.includes('<script>'), 'a malicious seed never reaches the markup');
assert.ok(!evil.includes('alert(1)'), 'nothing from the seed is echoed at all');

// ════════════ the route serves it public + cacheable ════════════
const res = await app.inject({ method: 'GET', url: '/v1/avatar/char-abc-123' });
assert.equal(res.statusCode, 200, 'the avatar route serves 200 with no auth (public + keyless)');
assert.match(res.headers['content-type'], /image\/svg\+xml/, 'served as SVG');
assert.match(res.headers['cache-control'], /immutable/, 'heavily cacheable — same seed, same face');
assert.equal(res.body, avatarSvg('char-abc-123'), 'the route body IS the generator output');
// a wild over-long seed is bounded, never a 500 (real seeds are 36-char UUIDs; fastify caps param
// length with a clean 4xx before the handler, and the handler itself slices to 128)
assert.ok((await app.inject({ method: 'GET', url: '/v1/avatar/' + encodeURIComponent('a'.repeat(500)) })).statusCode < 500, 'an over-long seed is bounded, never a 500');

// ════════════ §10.4 — the portrait moves no value ════════════
const tx0 = Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n);
await app.inject({ method: 'GET', url: '/v1/avatar/anyone' });
await app.inject({ method: 'GET', url: '/v1/avatar/anyone-else' });
assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n), tx0, 'serving portraits writes no ledger rows — pure cosmetic art');

console.log('avatar: PASS');
await app.close();
process.exit(0);

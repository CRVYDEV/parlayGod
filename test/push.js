// WEB PUSH — learn while away. An opt-in browser subscription + a service worker; the WORKER pushes
// URGENT, still-undelivered notifications to the phone (post-commit by construction; idempotent via a
// `pushed` flag; DORMANT unless VAPID configured). The centre of the test: subscribe/unsubscribe storage,
// the sweep pushes exactly the urgent+undelivered+unpushed rows (and marks them), non-urgent / already-
// delivered / already-pushed are skipped, and the whole thing moves no value.
import assert from 'node:assert';
import webpush from 'web-push';

// arm VAPID BEFORE buildServer so initPush() picks it up (it reads env at call time)
const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;

const { buildServer } = await import('../src/server.js');
const Push = await import('../src/push.js');

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
  return { token, id: me.id };
};
const acctOf = async (id) => (await pool.query('SELECT account_id a FROM characters WHERE id=$1', [id])).rows[0].a;
const uid = () => 'n-' + Math.random().toString(36).slice(2);
const addNote = (charId, type, payload, { delivered = false } = {}) =>
  pool.query('INSERT INTO notifications (id, character_id, type, payload, delivered) VALUES ($1,$2,$3,$4,$5)',
    [uid(), charId, type, JSON.stringify(payload), delivered]);

// ════════════ configured — the public key is surfaced for the client ════════════
assert.equal(Push.pushConfigured(), true, 'VAPID is armed');
assert.equal(Push.pushPublicKey(), keys.publicKey, 'the client subscribes with the VAPID public key');
assert.equal((await call('GET', '/v1/rules')).body.push.publicKey, keys.publicKey, 'the public key is on /v1/rules for the client');

// ════════════ subscribe / unsubscribe ════════════
const p = await mk('Push Guy');
const acct = await acctOf(p.id);
const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p256dh-key', auth: 'auth-key' } };
assert.equal((await call('POST', '/v1/push/subscribe', { token: p.token, body: { subscription: sub } })).body.subscribed, true, 'the browser subscribes');
assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM push_subscriptions WHERE account_id=$1', [acct])).rows[0].n), 1, 'the subscription is stored');
// a bad subscription is refused
assert.equal((await call('POST', '/v1/push/subscribe', { token: p.token, body: { subscription: { endpoint: 'x' } } })).body.error, 'bad_sub', 'a malformed subscription is refused');
// re-subscribing the same endpoint is idempotent (upsert)
await call('POST', '/v1/push/subscribe', { token: p.token, body: { subscription: sub } });
assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM push_subscriptions WHERE account_id=$1', [acct])).rows[0].n), 1, 'one row per endpoint');

// ════════════ THE SWEEP — push exactly the urgent+undelivered+unpushed rows ════════════
const sent = [];
Push.__setDeliver(async (_pool, s, payload) => { sent.push({ endpoint: s.endpoint, payload: JSON.parse(payload) }); });
await addNote(p.id, 'whacked', { by: 'Some Rival' });          // URGENT → pushed
await addNote(p.id, 'act', { text: 'did a job' });             // not urgent → skipped
await addNote(p.id, 'indicted', {}, { delivered: true });      // already delivered → skipped
const already = uid();
await pool.query('INSERT INTO notifications (id, character_id, type, payload, pushed) VALUES ($1,$2,$3,$4,true)', [already, p.id, 'bounty_on_you', '{}']);   // already pushed → skipped
await Push.sweepPush(pool);
assert.equal(sent.length, 1, 'exactly the one urgent+undelivered+unpushed notification was pushed');
assert.equal(sent[0].endpoint, sub.endpoint, 'pushed to the stored subscription');
assert.equal(sent[0].payload.title, 'You were killed', 'the push carries the urgent title');
assert.ok(sent[0].payload.body.includes('Some Rival'), 'the body is built from the payload');
// the pushed notification is marked so the next sweep skips it (idempotent)
assert.equal((await pool.query("SELECT pushed FROM notifications WHERE character_id=$1 AND type='whacked'", [p.id])).rows[0].pushed, true, 'the pushed row is marked pushed');
sent.length = 0;
await Push.sweepPush(pool);
assert.equal(sent.length, 0, 'a second sweep re-pushes nothing (the pushed flag is idempotent)');

// ════════════ unsubscribe ════════════
assert.equal((await call('POST', '/v1/push/unsubscribe', { token: p.token, body: { endpoint: sub.endpoint } })).body.subscribed, false, 'unsubscribe');
assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM push_subscriptions WHERE account_id=$1', [acct])).rows[0].n), 0, 'the subscription is gone');
// with no subscription, a fresh urgent note pushes to nobody (no crash)
await addNote(p.id, 'sacked', { by: 'A Rival' });
sent.length = 0; await Push.sweepPush(pool);
assert.equal(sent.length, 0, 'no subscription → nothing sent, no crash');

// ════════════ (red-team C1) CLAIM-then-notify — no duplicate buzz under concurrent workers ════════════
// The dedup property (two overlapping workers must not both push the same row) needs true concurrency,
// which pg-mem can't exercise. But the ORDERING that guarantees it — the row must be marked `pushed`
// BEFORE the send, not after (claim-then-notify, the Wire-watchdog / fees discipline) — IS observable:
// the deliver seam looks at the row's `pushed` flag AT SEND TIME. Claim-then-notify → it is already
// true when we send; a mutation back to notify-then-flag → it is still false, and this fails by name.
{
  await addNote(p.id, 'robbed', { from: 'A Rival', kind: 'laundromat' });   // a fresh urgent row to sweep
  // re-subscribe (the unsubscribe block above cleared it) so pushToAccount actually reaches the seam
  await call('POST', '/v1/push/subscribe', { token: p.token, body: { subscription: sub } });
  let pushedAtSend = null;
  Push.__setDeliver(async (_pool, _s, _payload) => {
    const r = await pool.query("SELECT pushed FROM notifications WHERE character_id=$1 AND type='robbed'", [p.id]);
    pushedAtSend = r.rows[0]?.pushed;   // claim-then-notify → true here; notify-then-flag → false
  });
  await Push.sweepPush(pool);
  assert.strictEqual(pushedAtSend, true, 'the row is claimed (pushed=true) BEFORE the send — claim-then-notify (C1); a mutation to notify-then-flag makes this false');
}

// ════════════ §10.4 — push moves no value ════════════
assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n), 0, 'web push writes no ledger rows — it is pure notification');

console.log('push: PASS');
await app.close();
process.exit(0);

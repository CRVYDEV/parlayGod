// Red-team regression suite: each test reproduces a specific exploit found in the
// game audit and asserts it is now closed. Grouped by the finding it guards.
// Runs on pg-mem — zero infra.
process.env.MOD_KEY = 'test-mod-key';
process.env.SOCIAL_VERIFY_MODE = 'trust';

import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runLedgerInvariants } from '../src/invariants.js';

const app = await buildServer();
const pool = app.pool;
const modH = { 'x-mod-key': 'test-mod-key' };
const call = async (method, url, { token, body, headers } = {}) => {
  const res = await app.inject({ method, url, payload: body,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers || {}) } });
  let json; try { json = res.json(); } catch { json = null; }
  return { code: res.statusCode, body: json, headers: res.headers };
};
const meOf = async (token) => (await call('GET', '/v1/me', { token })).body.character;
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);
let nameSeq = 0;
const mk = async (name, body = {}) => {
  const { body: b } = await call('POST', '/v1/auth/guest', { body });
  const token = b.token;
  await call('POST', '/v1/character', { token, body: { name: name || `P${nameSeq++}`, ...body } });
  return { token, id: (await meOf(token)).id };
};
// The invariant job runs over the whole DB, which this suite pollutes with direct
// currency seeds (stats aren't currency; cash/cb/ammo ARE). So instead of asserting
// absolute zero drift, we assert an ACTION adds no NEW drift on top of the baseline —
// which, combined with hardening.js proving zero drift on a fully-earned economy,
// proves the fix. Drift values are rounded to 1e-6, so unchanged state compares equal.
const driftOf = async (name) => (await runLedgerInvariants(pool)).checks.find((c) => c.name === name).drift;
const addsNoDrift = async (name, action, label) => {
  const before = await driftOf(name); await action(); const after = await driftOf(name);
  assert.equal(after, before, `${label}: ${name} drift moved ${before} → ${after}`);
};

// ═══ FINDING (social-1): exchange cb/ammo escrow must not drift §10.4 ═══
// Before the fix, an OPEN cb/ammo listing double-counted (escrow bucket + escrow
// ledger sink), and a death-with-listing drifted permanently.
{
  const seller = await mk('Escrow Ed');
  await seedCh(seller.id, 'ammo = 100, cb = 20');
  await addsNoDrift('ammo conservation', async () => {
    assert.equal((await call('POST', '/v1/exchange/list', { token: seller.token, body: { kind: 'ammo', qty: 40, unitPrice: 10 } })).code, 200, 'ammo listed');
  }, 'open ammo listing');
  await addsNoDrift('cb conservation', async () => {
    await call('POST', '/v1/exchange/list', { token: seller.token, body: { kind: 'cb', qty: 10, unitPrice: 50 } });
  }, 'open cb listing');
  // death while holding open cb/ammo listings must not leave permanent drift
  const aBefore = await driftOf('ammo conservation'), cBefore = await driftOf('cb conservation');
  await call('POST', '/v1/mod/kill', { body: { characterId: seller.id }, headers: modH });
  assert.equal(await driftOf('ammo conservation'), aBefore, 'death with open ammo listing adds no drift');
  assert.equal(await driftOf('cb conservation'), cBefore, 'death with open cb listing adds no drift');
}

// ═══ FINDING (economy-1): sub-cent bank interest must be ledgered ═══
{
  const saver = await mk('Penny Saver');
  await seedCh(saver.id, 'cash = 200000');
  await call('POST', '/v1/bank/deposit', { token: saver.token, body: { amount: 100000 } });
  // many short accruals each yield a fraction of a cent of interest; none may drift cash
  await addsNoDrift('character cash', async () => {
    for (let i = 0; i < 8; i++) { await seedCh(saver.id, "last_accrued_at = now() - interval '2 seconds'"); await meOf(saver.token); }
  }, 'sub-cent bank interest');
  const rows = Number((await pool.query(`SELECT COUNT(*) n FROM transactions WHERE reason='bank:interest' AND character_id='${saver.id}'`)).rows[0].n);
  assert(rows >= 1, 'sub-cent interest is ledgered, not silently minted');
}

// ═══ FINDING (economy-2): swap SELL must reject a net ≤ 0 (no seller debit) ═══
{
  const t = await mk('Dust Seller');
  await seedCh(t.id, 'cash = 100000');
  await call('POST', '/v1/swap', { token: t.token, body: { direction: 'buy', amount: 1000 } });
  const before = await meOf(t.token);
  // selling a dust amount would yield gross < fees → net ≤ 0; must be rejected, not paid
  const r = await call('POST', '/v1/swap', { token: t.token, body: { direction: 'sell', amount: 0.0001 } });
  assert.equal(r.code, 400, 'dust sale rejected');
  const after = await meOf(t.token);
  assert(after.cash >= before.cash, 'seller cash was not debited by a dust sale');
  assert.equal(after.omr, before.omr, 'no $OMR burned on the rejected sale');
}

// ═══ FINDING (social-3): a bounty must never pay ANY of its funders ═══
// A posts, confederate C tops up (which used to overwrite posted_by → let A claim).
{
  const A = await mk('Poster A'); const C = await mk('Confed C'); const B = await mk('Victim B');
  await seedCh(A.id, 'cash = 50000, muscle = 500, speed = 500, energy = 200');
  await seedCh(C.id, 'cash = 50000');
  await seedCh(B.id, 'respect = 400, muscle = 1, speed = 1');
  assert.equal((await call('POST', `/v1/streets/${B.id}/bounty`, { token: A.token, body: { amount: 2000, kind: 'hospitalize' } })).code, 200, 'A posts');
  assert.equal((await call('POST', `/v1/streets/${B.id}/bounty`, { token: C.token, body: { amount: 500, kind: 'hospitalize' } })).code, 200, 'C tops up');
  const r = await call('POST', `/v1/streets/${B.id}/jump`, { token: A.token });
  assert.equal(r.code, 200, 'A jumps B'); assert(r.body.win, 'A wins the jump');
  assert.equal(r.body.bounty, 0, 'A (a funder) collects NOTHING from the pot');
  assert(Number((await pool.query(`SELECT amount FROM bounties WHERE target_character='${B.id}' AND kind='hospitalize'`)).rows[0].amount) >= 2500, 'the contract stands for others');
  // a non-funder CAN collect: C's confederate D whacks B and takes the pot
  const D = await mk('Collector D');
  await seedCh(D.id, 'muscle = 500, speed = 500, energy = 200');
  await seedCh(B.id, 'hosp_until = NULL, respect = 400, muscle = 1, speed = 1');
  const r2 = await call('POST', `/v1/streets/${B.id}/jump`, { token: D.token });
  assert(r2.body.win && r2.body.bounty >= 2500, 'a non-funder collects the full pot');
}

// ═══ FINDING (contract-board): post/cancel/expiry all keep the §10.4 escrow bucket exact ═══
{
  const { sweepExpiredBounties } = await import('../src/social.js');
  const escrowDrift = async () => (await runLedgerInvariants(pool)).checks.find((c) => c.name === 'bounty escrow').drift;
  const P = await mk('Contractor P'); const T = await mk('Mark T');
  await seedCh(P.id, 'cash = 50000');
  const d0 = await escrowDrift();
  // post → escrow grows, drift unchanged (a ledgered move into the bucket)
  assert.equal((await call('POST', `/v1/streets/${T.id}/bounty`, { token: P.token, body: { amount: 3000, kind: 'kill' } })).code, 200, 'contract posted');
  assert.equal(await escrowDrift(), d0, 'escrow reconciles after a post');
  // cancel → funder refunded, drift unchanged
  const pCash = (await meOf(P.token)).cash;
  assert.equal((await call('POST', `/v1/contracts/${T.id}/kill/cancel`, { token: P.token })).body.refunded, 3000, 'own stake refunded');
  assert.equal((await meOf(P.token)).cash, pCash + 3000, 'refund landed');
  assert.equal(await escrowDrift(), d0, 'escrow reconciles after a cancel/refund');
  // expiry sweep → all funders refunded, drift unchanged
  await call('POST', `/v1/streets/${T.id}/bounty`, { token: P.token, body: { amount: 1500, kind: 'kill' } });
  await pool.query(`UPDATE bounties SET expires_at = now() - interval '1 hour' WHERE target_character='${T.id}'`);
  const beforeSweep = (await meOf(P.token)).cash;
  const sw = await sweepExpiredBounties(pool);
  assert(sw.pots === 1 && sw.refunded === 1500, 'expired pot swept + refunded');
  assert.equal((await meOf(P.token)).cash, beforeSweep + 1500, 'expiry refund landed');
  assert.equal(await escrowDrift(), d0, 'escrow reconciles after an expiry refund');
}

// ═══ FINDING (kitchen-2): mission $OMR pays once per ACCOUNT, not per character ═══
{
  const chef = await mk('One Shot');
  await seedCh(chef.id, 'respect = 1000, cunning = 40, cb = 20, cash = 500000');
  await call('POST', '/v1/armory/gun/argument/buy', { token: chef.token }); // fp 18 for m4
  const before = (await meOf(chef.token)).omr;
  let r = await call('POST', '/v1/missions/m4', { token: chef.token });
  assert.equal(r.code, 200, 'mission cleared'); assert.equal(r.body.reward.omr, 5, 'first time pays $OMR');
  assert.equal((await meOf(chef.token)).omr, before + 5, 'omr credited once');
  // kill → heir re-grinds and re-does the same mission: cash/respect re-earn, $OMR must NOT
  await call('POST', '/v1/mod/kill', { body: { characterId: chef.id }, headers: modH });
  await seedCh((await meOf(chef.token)).id, 'respect = 1000, cunning = 40, cb = 20, cash = 500000');
  await call('POST', '/v1/armory/gun/argument/buy', { token: chef.token });
  const heirOmr = (await meOf(chef.token)).omr;
  r = await call('POST', '/v1/missions/m4', { token: chef.token });
  assert.equal(r.code, 200, 'heir redoes mission'); assert.equal(r.body.reward.omr, 0, 'no $OMR re-mint on the heir');
  assert.equal((await meOf(chef.token)).omr, heirOmr, 'account $OMR unchanged the second time');
}

// ═══ FINDING (audit ux-1): legacy base58 wallet link RETIRED — it satisfied ob_wallet with
// no proof and wrote a wrong-chain address. Linking is SIWE-only now (proof of key control;
// uniqueness + malformed-sig handling are covered in test/chain.js). ═══
{
  const w1 = await mk('Wallet One');
  const r = await call('POST', '/v1/wallet', { token: w1.token, body: { address: 'So1anaAddre55Fake1111111111111111111111111' } });
  assert.equal(r.code, 400, 'legacy /v1/wallet is retired');
  assert.equal(r.body.error, 'use_siwe', 'redirects to the SIWE challenge/verify flow');
  // and ob_wallet can no longer be earned by the free base58 path (wallet_address stays null)
  assert.equal((await call('POST', '/v1/onboard/ob_wallet/claim', { token: w1.token })).code, 400, 'no ob_wallet reward without a real SIWE link');
}

// ═══ FINDING (infra CRIT-2): idempotency prevents CONCURRENT double-execution ═══
{
  const p = await mk('Double Tap');
  await seedCh(p.id, 'cash = 100000');
  const key = { 'idempotency-key': 'race-key-1' };
  const [a, b] = await Promise.all([
    call('POST', '/v1/bank/deposit', { token: p.token, body: { amount: 1000 }, headers: key }),
    call('POST', '/v1/bank/deposit', { token: p.token, body: { amount: 1000 }, headers: key }),
  ]);
  const outcomes = [a, b];
  const executed = outcomes.filter((o) => o.code === 200 && o.headers['x-idempotent-replay'] !== 'true');
  assert(executed.length <= 1, 'at most one of the concurrent duplicates executed');
  const bankNow = Math.floor((await meOf(p.token)).bank);
  assert.equal(bankNow, 1000, `deposited exactly once (bank=${bankNow})`);
}

// ═══ FINDING (infra HIGH-4): a failed request must not poison its idempotency key ═══
{
  const p = await mk('Retry Rita');
  await seedCh(p.id, "jail_until = now() + interval '60 seconds'"); // force the crime to 400
  const key = { 'idempotency-key': 'retry-key-1' };
  const fail = await call('POST', '/v1/crimes/pick', { token: p.token, headers: key });
  assert.equal(fail.code, 400, 'jailed crime fails');
  await seedCh(p.id, 'jail_until = NULL, nerve = 50, energy = 200'); // fix the state
  let ok = null;
  for (let i = 0; i < 20 && !ok; i++) { const r = await call('POST', '/v1/crimes/pick', { token: p.token, headers: key }); if (r.code === 200) ok = r; else await seedCh(p.id, 'nerve = 50, energy = 200, jail_until = NULL'); }
  assert(ok, 'the key was released after the failure — the action can succeed on retry');
  assert(ok.headers['x-idempotent-replay'] !== 'true', 'the retry actually executed (not a replayed 400)');
}

// ═══ FINDING (infra HIGH-4): key reuse with a different body is rejected ═══
{
  const p = await mk('Body Bandit');
  await seedCh(p.id, 'cash = 100000');
  const key = { 'idempotency-key': 'body-key-1' };
  assert.equal((await call('POST', '/v1/bank/deposit', { token: p.token, body: { amount: 100 }, headers: key })).code, 200, 'first body');
  const clash = await call('POST', '/v1/bank/deposit', { token: p.token, body: { amount: 999 }, headers: key });
  assert.equal(clash.code, 422, 'same key + different body → 422');
}

// ═══ FINDING (infra HIGH-3): a 1-use invite code survives a concurrent stampede ═══
{
  process.env.INVITE_MODE = 'on';
  const { body: mint } = await call('POST', '/v1/mod/invites', { body: { count: 1, uses: 1 }, headers: modH });
  const code = mint.codes[0];
  const results = await Promise.all(Array.from({ length: 8 }, () => call('POST', '/v1/auth/guest', { body: { inviteCode: code } })));
  const ok = results.filter((r) => r.code === 200);
  assert.equal(ok.length, 1, `exactly one signup consumed the 1-use code (got ${ok.length})`);
  assert(Number((await pool.query("SELECT uses_left FROM invite_codes WHERE code=$1", [code])).rows[0].uses_left) >= 0, 'uses_left never went negative');
  process.env.INVITE_MODE = 'off';
}

// ═══ FINDING (infra HIGH-2): concurrent sign-in for one identity → one account ═══
{
  process.env.X_TRUST_USER_TOKEN = 'on'; // enable the alpha stopgap for this mocked-fetch race test
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('api.x.com/2/users/me')) return { ok: true, json: async () => ({ data: { id: 'x-race-1' } }) };
    return realFetch(url, opts);
  };
  const results = await Promise.all(Array.from({ length: 5 }, () => call('POST', '/v1/auth/x', { body: { token: 'good' } })));
  assert(results.every((r) => r.code === 200), 'all sign-ins succeed');
  const n = Number((await pool.query("SELECT COUNT(*) n FROM accounts WHERE auth_provider='x' AND auth_subject='x-race-1'")).rows[0].n);
  assert.equal(n, 1, `one identity → one account (got ${n})`);
  globalThis.fetch = realFetch;
  delete process.env.X_TRUST_USER_TOKEN;
}

// ═══ FINDING (infra HIGH-1): agent throttle follows the DB flag, not the token ═══
{
  process.env.RATE_LIMIT = 'on';
  const a = await mk('Sneaky Agent');
  const originalToken = a.token;                                    // pre-flag token, no agent claim
  await call('POST', '/v1/auth/agent-key', { token: a.token });     // flags the account in the DB
  // the operator keeps using the ORIGINAL token to try to dodge the harder limit
  const r1 = await call('POST', '/v1/bank/deposit', { token: originalToken, body: { amount: 1 } });
  const r2 = await call('POST', '/v1/bank/deposit', { token: originalToken, body: { amount: 1 } });
  assert.equal(r1.code, 200, 'first agent action allowed');
  assert.equal(r2.code, 429, 'second action within 3s throttled by the DB agent flag, not the token');
  process.env.RATE_LIMIT = 'off';
}

// ═══ FINDING (red-team R1): the §10.2 agent throttle now covers authed GET reads too — an agent could
// poll GET /v1/me (a withCharacter accrual + ledger-write path) at unlimited rate to dodge the 1/3s
// cadence, since the global limiter only guarded POST/DELETE. Humans stay UNTHROTTLED on GETs so
// multi-tab console loads never 429. ═══
{
  const human = await mk('Poller Pete');
  const ag = await mk('Polling Agent');
  await call('POST', '/v1/auth/agent-key', { token: ag.token }); // flag the agent in the DB
  process.env.RATE_LIMIT = 'on';
  const h1 = await call('GET', '/v1/me', { token: human.token });
  const h2 = await call('GET', '/v1/me', { token: human.token });
  assert.equal(h1.code, 200, 'human first GET /v1/me ok');
  assert.equal(h2.code, 200, 'a human is NOT throttled on GETs — console multi-tab loads must not 429');
  const g1 = await call('GET', '/v1/me', { token: ag.token });
  const g2 = await call('GET', '/v1/me', { token: ag.token });
  assert.equal(g1.code, 200, 'agent first GET /v1/me allowed');
  assert.equal(g2.code, 429, 'agent second GET /v1/me within 3s is throttled — the §10.2 cadence now covers hidden-write reads');
  process.env.RATE_LIMIT = 'off';
}

// ═══ FINDING (infra MED-4): banned accounts lose the websocket feed ═══
{
  const banned = await mk('Doomed Don');
  const acctId = (await pool.query(`SELECT account_id FROM characters WHERE id='${banned.id}'`)).rows[0].account_id;
  await call('POST', '/v1/mod/ban', { body: { accountId: acctId }, headers: modH });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = app.server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws?token=${encodeURIComponent(banned.token)}`);
  const closed = await new Promise((res) => { ws.onclose = (e) => res(e.code); setTimeout(() => res(0), 4000); });
  assert.equal(closed, 4003, 'banned socket closed with 4003');
}

// ═══ FINDING (infra LOW-1): living-character names are unique ═══
{
  const one = await mk('The Only Sammy');
  const two = await call('POST', '/v1/auth/guest', {});
  const r = await call('POST', '/v1/character', { token: two.body.token, body: { name: 'The Only Sammy' } });
  assert.equal(r.code, 400, 'a second living character cannot take the same name');
}

// ═══ FINDING (infra CRIT-1): production refuses to boot on the dev JWT secret ═══
{
  const savedEnv = process.env.NODE_ENV, savedSecret = process.env.JWT_SECRET;
  process.env.NODE_ENV = 'production'; delete process.env.JWT_SECRET;
  let threw = false;
  try { await buildServer(); } catch { threw = true; }
  assert(threw, 'production boot refused without JWT_SECRET');
  process.env.NODE_ENV = savedEnv; if (savedSecret !== undefined) process.env.JWT_SECRET = savedSecret;
}

console.log('✅ security regression suite passed — exchange escrow §10.4, sub-cent bank interest, swap-sell dust, bounty-funder self-pay, mission $OMR re-mint, wallet validation, idempotency (concurrency/release/body-bind), invite race, identity race, agent throttle, banned websocket, name uniqueness, JWT secret guard');
await app.close();

// THE LEDGER — the Season Pass reward track test (the 26th suite). Covers: the pass gate (no pass →
// no track), the board (tier/track/cooldown), the daily claim (status title, revive tokens, energy
// refill), the ~daily cooldown gate, the BACKED $OMR stipend (paid through the prize-pool rail,
// pool-bounded, funded by the pass's own buyback share), completing the track (complete gate),
// §10.4 (prize:omr reconciles — every earned $OMR is a backed faucet, no SQL mint), DEATH SURVIVAL
// (the account-level track carries to the heir), and the fresh-season reset. pg-mem, zero infra.
process.env.MOD_KEY = 'test-mod-key';
process.env.ALLOW_MOD_REAL_REVENUE = 'on'; // QA: let the mod route drive the real-revenue flywheel (D-MED2 gate)
import assert from 'node:assert';
import { getAddress } from 'viem';
import { buildServer } from '../src/server.js';
import { PASS } from '../src/rules.js';
// the three stipend tiers, read off the track — a re-denomination moves them and this file
// must not need editing (the lever-register argument applied to a fixture)
const STIPENDS = PASS.TRACK.map((t) => Number(t.reward?.omr || 0)).filter(Boolean);
const [S1, S2, S3] = STIPENDS;
const STIPEND_TOTAL = STIPENDS.reduce((a, b) => a + b, 0);
import { runVigBuyback } from '../src/vig.js';
import { sweepPassStipends } from '../src/pass.js';
import { runLedgerInvariants } from '../src/invariants.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body, mod } = {}) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (mod) headers['x-mod-key'] = 'test-mod-key';
  const res = await app.inject({ method, url, headers, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const ch = await meOf(token);
  const aid = (await pool.query(`SELECT account_id a FROM characters WHERE id='${ch.id}'`)).rows[0].a;
  return { token, id: ch.id, aid };
};
const ethWei = (eth) => String(BigInt(Math.round(eth * 1e6)) * (10n ** 12n));
const W1 = getAddress('0x' + '33'.repeat(20));
let np = 5000; const nonce = () => np++;

const alice = await mk('Ledger Larry');

// ── no pass → no track ──
let r = await call('GET', '/v1/pass', { token: alice.token });
assert.equal(r.body.active, false, 'no pass, no track');
assert.equal((await call('POST', '/v1/pass/claim', { token: alice.token })).body.error, 'no_pass', "can't claim the Ledger without a pass");

// ── buy the Season Pass (a REAL purchase with a txHash → funds the buyback) ──
await pool.query(`UPDATE account_persistent SET wallet_address='${W1}' WHERE account_id='${alice.aid}'`);
await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: nonce(), sku: 'season_pass', payer: W1, amountWei: ethWei(0.05), txHash: '0xpass1' } });
r = await call('GET', '/v1/pass', { token: alice.token });
assert.equal(r.body.active, true, 'the pass is active');
assert.equal(r.body.tier, 0, 'the track starts at 0');
assert.equal(r.body.of, PASS.TRACK.length, 'the full track (12 tiers)');
assert.equal(r.body.claimable, true, 'the first tier is claimable now');
assert.equal(r.body.track[0].next, true, 'tier 1 is up next');
// the season_pass SKU already granted 2 revive tokens
assert.equal((await call('GET', '/v1/store', { token: alice.token })).body.owned.respawnTokens, 2, 'the pass came with two revives');

// ── claim tier 1 (a title) — then the ~daily cooldown blocks an immediate re-claim ──
r = await call('POST', '/v1/pass/claim', { token: alice.token });
assert.equal(r.body.tier, 1, 'claimed tier 1');
assert.equal(r.body.granted.title, 'Ledger Initiate', 'the title dropped');
assert.equal((await meOf(alice.token)).title, 'Ledger Initiate', 'the street wears the title');
assert.equal((await call('POST', '/v1/pass/claim', { token: alice.token })).body.error, 'cooldown', 'one mark on the Ledger per day');

// ── shrink the cooldown (test-only) and claim the consumable tiers ──
process.env.PASS_CLAIM_MS = '0';
r = await call('POST', '/v1/pass/claim', { token: alice.token }); // tier 2: +1 revive
assert.equal(r.body.tier, 2, 'tier 2');
assert.equal((await call('GET', '/v1/store', { token: alice.token })).body.owned.respawnTokens, 3, 'a third revive (2 + 1)');
r = await call('POST', '/v1/pass/claim', { token: alice.token }); // tier 3: full energy
assert.equal(r.body.granted.energy > 0, true, 'tanked up');

// ── claim the $OMR stipend tier (tier 4 = 2 $OMR) with a DRY pool → the stipend ACCRUES as OWED
// (durably recorded, never lost), the tier still advances, and $0 is paid now (the fix) ──
r = await call('POST', '/v1/pass/claim', { token: alice.token });
assert.equal(r.body.tier, 4, 'tier 4');
assert.equal(r.body.stipendOwed, S1, `the tier owes a ${S1} $OMR stipend`);
assert.equal(r.body.stipendPaid || 0, 0, 'a dry pool pays nothing NOW — but the tier is not lost');
assert.equal((await call('GET', '/v1/pass', { token: alice.token })).body.stipendOwed, S1, `the ${S1} $OMR is on the books`);
assert.equal((await meOf(alice.token)).omr, 0, 'nothing paid yet');

// ── fund the pool via the pass's OWN buyback share, then the worker sweep pays the owed stipend ──
// price the buyback off the TRACK's own stipends: 0.05 ETH × 40% = 0.02 ETH is bought, half of it
// lands in the prize pool, so this covers the whole track with headroom whatever the stipends are.
await runVigBuyback(pool, { priceOmrPerEth: STIPEND_TOTAL * 200 });
assert(Number((await pool.query('SELECT balance FROM vig_prize_pool WHERE id=1')).rows[0].balance) >= STIPEND_TOTAL,
  'the pool is funded by the pass buyback');
await sweepPassStipends(pool); // the worker net: pays down owed as the pool funds
assert.equal((await meOf(alice.token)).omr, S1, `the owed ${S1} $OMR is now paid (backed prize:omr)`);
assert.equal((await call('GET', '/v1/pass', { token: alice.token })).body.stipendOwed, 0, 'the books are square');

// ── finish the track (tiers 5–12; more stipends later in the track, now paid inline since the pool is funded) ──
for (let i = 0; i < 8; i++) await call('POST', '/v1/pass/claim', { token: alice.token });
r = await call('GET', '/v1/pass', { token: alice.token });
assert.equal(r.body.tier, PASS.TRACK.length, 'the whole Ledger is claimed');
assert.equal(r.body.complete, true, 'complete');
assert.equal(r.body.claimable, false, 'nothing left to claim');
assert.equal((await call('POST', '/v1/pass/claim', { token: alice.token })).body.error, 'complete', "can't claim past the end");
// total $OMR earned = the three stipend tiers, all from the pool
assert.equal((await meOf(alice.token)).omr, STIPEND_TOTAL, `the stipends totalled ${STIPEND_TOTAL} $OMR — funded by the pass buyback, never minted`);

// ── §10.4: every earned $OMR is a backed prize:omr faucet — conservation holds at drift-0 ──
const inv = await runLedgerInvariants(pool, { alert: false });
assert(inv.checks.every((c) => c.ok), `§10.4 holds — pass rewards move no unbacked currency (${JSON.stringify(inv.checks.filter((c) => !c.ok))})`);

// ── DEATH SURVIVAL: the account-level track carries to the heir ──
await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: alice.id }, headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal((await call('GET', '/v1/pass', { token: alice.token })).body.tier, PASS.TRACK.length, 'the heir inherits the completed track');

// ── FRESH SEASON: buying the pass after it lapsed resets the Ledger to tier 0 ──
await pool.query(`UPDATE account_persistent SET pass_until = now() - interval '1 hour' WHERE account_id='${alice.aid}'`);
await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: nonce(), sku: 'season_pass', payer: W1, amountWei: ethWei(0.05), txHash: '0xpass2' } });
r = await call('GET', '/v1/pass', { token: alice.token });
assert.equal(r.body.active, true, 'a new season is live');
assert.equal(r.body.tier, 0, 'the fresh season reset the track to 0');

console.log('✅ The Ledger (Season Pass reward track) test passed — the pass gate, the board, the daily claim (title / revive tokens / energy refill), the ~daily cooldown, the BACKED $OMR stipend (paid through the pool the pass buyback funded, pool-bounded, never minted), completing the track + the complete gate, §10.4 (prize:omr reconciles, drift-0), DEATH SURVIVAL (the heir inherits the track), and the fresh-season reset');
await app.close();

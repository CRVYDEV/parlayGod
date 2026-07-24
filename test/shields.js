// THE SHIELDS test (L3b + L3c) — the stakes/spine review's two "make the kill matter" levers.
//
// L3b — THE SHIELD CAP: the safehouse is capped at SAFEHOUSE_DAILY_CAP_MS of off-grid time per rolling
// day (a token bucket, the wash-cap twin), so a whale can't live PERMANENTLY unreachable. With a 12h cap
// and a 4h stay, three stays fill the bucket and the fourth is refused (`safe_cap`) — the rich must surface.
//
// L3c — THE CONTRACT'S BULLETS: ammo is the −EV driver on a hit, so a kill that fulfils a PAID contract
// (bounty > 0) rebates CONTRACT_AMMO_REBATE of the rounds spent (a ledgered ammo faucet `contract:rebate`)
// — the pot no longer carries the whole loss. A standalone kill (no contract) pays no rebate.
process.env.SEARCH_MS = '0';
process.env.SHOOT_CD_MS = '0';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { M3 } from '../src/rules.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (token) => (await call('GET', '/v1/me', { token })).body.character;
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);
const mk = async (name) => { const { body: { token } } = await call('POST', '/v1/auth/guest'); await call('POST', '/v1/character', { token, body: { name } }); return { token, id: (await meOf(token)).id }; };

// ════════ L3b — THE SHIELD CAP ════════
const hider = await mk('Ducking Dino');
await seedCh(hider.id, "cash=400000, loc='docks', jail_until=NULL");
const stays = Math.floor(M3.SAFEHOUSE_DAILY_CAP_MS / M3.SAFEHOUSE_MS); // 12h / 4h = 3
let capSeen = false;
for (let i = 0; i < stays + 1; i++) {
  await seedCh(hider.id, "safe_until=NULL, cash=400000"); // the last stay expired; walk back out (bucket persists)
  const r = await call('POST', '/v1/safehouse', { token: hider.token });
  if (i < stays) assert.equal(r.code, 200, `stay ${i + 1}/${stays} allowed (within the daily cap)`);
  else { assert.equal(r.body.error, 'safe_cap', 'the stay past the daily cap is refused — you have to surface'); capSeen = true; }
}
assert.ok(capSeen, 'the shield cap fired');
// the board surfaces the remaining bucket (drained to ~0 after the cap)
const hm = await meOf(hider.token);
assert.ok(typeof hm.safeCapSeconds === 'number' && hm.safeCapSeconds < M3.SAFEHOUSE_MS / 1000, 'safeCapSeconds reflects a drained bucket');

// a FRESH face has the full bucket
const fresh = await mk('Fresh Frankie');
const fm = await meOf(fresh.token);
assert.equal(fm.safeCapSeconds, Math.floor(M3.SAFEHOUSE_DAILY_CAP_MS / 1000), 'a fresh face has the full daily safehouse allowance');

// ════════ L3c — THE CONTRACT'S BULLETS ════════
const don = await mk('Don Trigger');
await seedCh(don.id, "respect=50000, cash=500000, cb=20, muscle=500, speed=500, energy=200, ammo=8000, nerve=50, jail_until=NULL, shoot_cd_until=NULL, hosp_until=NULL, loc='docks'");
assert.equal((await call('POST', '/v1/armory/gun/lastresort/buy', { token: don.token })).code, 200, 'the shooter arms up');
const funder = await mk('Paying Paulie');
await seedCh(funder.id, 'cash=200000');

const whack = async (tid, rounds) => {
  await seedCh(don.id, "energy=200, ammo=8000, nerve=50, jail_until=NULL, shoot_cd_until=NULL, hosp_until=NULL, loc='docks'");
  await seedCh(tid, "hosp_until=NULL, jail_until=NULL, safe_until=NULL, loc='docks', respect=1000");
  await call('POST', `/v1/streets/${tid}/search`, { token: don.token });
  return (await call('POST', `/v1/streets/${tid}/fire`, { token: don.token, body: { rounds } })).body;
};

// a PAID contract: Paulie posts a kill pot on the mark; Don collects it on the kill → the contract's bullets
const mark = await mk('Contracted Carl');
await seedCh(mark.id, 'respect=1000');
assert.equal((await call('POST', `/v1/streets/${mark.id}/bounty`, { token: funder.token, body: { amount: 5000, kind: 'kill' } })).code, 200, 'a kill contract is posted');
const rounds = 6000;
const k = await whack(mark.id, rounds);
assert.ok(k.kill, 'the mark is dead');
assert.ok(k.bounty > 0, 'the contract paid out on the kill');
assert.equal(k.ammoBack, Math.floor(rounds * M3.CONTRACT_AMMO_REBATE), 'the contract covered half the rounds spent');
// the rebate is a LEDGERED ammo faucet (so §10.4 reconciles it) — a contract:rebate row of exactly ammoBack
const reb = (await pool.query(`SELECT amount FROM transactions WHERE reason='contract:rebate' AND currency='ammo' AND character_id='${don.id}'`)).rows;
assert.equal(reb.length, 1, 'exactly one contract:rebate ammo row');
assert.equal(Number(reb[0].amount), k.ammoBack, 'the ledgered rebate equals the ammo returned');

// a STANDALONE kill (no contract on the head) pays NO rebate — the standalone −EV stays
const nobody = await mk('Unwanted Ugo');
await seedCh(nobody.id, 'respect=1000');
const k2 = await whack(nobody.id, rounds);
assert.ok(k2.kill, 'the standalone mark is dead');
assert.equal(k2.bounty, 0, 'no contract paid');
assert.ok(!k2.ammoBack, 'no rebate on a standalone kill');

console.log('ok - THE SHIELDS (L3b + L3c): safehouse daily cap (3 stays then refused, board surfaces the bucket) + the contract covers half the bullets on a paid kill (ledgered faucet), none on a standalone kill');
await app.close();

// THE UNDERWORLD test — the board, actor-side standing bumps at the loop touchpoints, gifts
// (sink, capped below GIFT_CAP, refused above), every NPC tier perk measured exactly (Doc heal
// ×0.9 / discharge halved / full release; Vinnie NPC-hit ×0.9 / post-fee waived / search ×0.9;
// Bella gun ×0.9 / craft ×0.9 / 30% buyback; Big Tuna guards ×0.9 / 72h listings / 4th slot),
// the estate wipe, and the §10.4 vocabulary. pg-mem, zero infra.
process.env.MOD_KEY = 'test-mod-key';
process.env.SEARCH_MS = '10000';    // 10s search (TEST-ONLY knob)
process.env.CONVOY_MS = '600000';   // 10-min road (TEST-ONLY knob)
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { UNDERWORLD, BLACK_MARKET, CONVOY, GUNS, CONSUMABLES, NPC_HITMEN } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url,
    headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  return { token, id: (await meOf(token)).id };
};
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);
const seedNpc = async (chId, npcId, standing) => {
  const upd = await pool.query(`UPDATE npc_standing SET standing=${standing} WHERE character_id='${chId}' AND npc_id='${npcId}'`);
  if (!upd.rowCount) await pool.query(`INSERT INTO npc_standing (character_id, npc_id, standing) VALUES ('${chId}','${npcId}',${standing})`);
};
const ledgerOf = async (chId, reason) => Number((await pool.query(
  `SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE character_id='${chId}' AND currency='cash' AND reason='${reason}'`)).rows[0].s);
const standingOf = async (token, npcId) => {
  const b = (await call('GET', '/v1/underworld', { token })).body;
  return b.npcs.find((n) => n.id === npcId);
};

const una = await mk('Underworld Una');   // earns standing the honest way
const ted = await mk('Tiered Ted');       // seeded standings — the perk measurements
const rob = await mk('Rob the Mark');     // search/bounty target
const mark = await mk('Marked Mel');      // NPC-hit target (level-gated)
await seedCh(una.id, "cash=1000000, cb=5, loc='docks'");
await seedCh(ted.id, "cash=3000000, cb=20, loc='docks'");
await seedCh(mark.id, 'respect=100');     // lvl 6 — over the NPC-hit floor

// ── the board: four named fixtures, all strangers at first ──
let r = await call('GET', '/v1/underworld', { token: una.token });
assert.equal(r.code, 200, 'the board is readable');
assert.equal(r.body.npcs.length, 4, 'four fixtures');
assert.deepEqual(r.body.thresholds, UNDERWORLD.THRESHOLDS, 'tier thresholds published');
assert(r.body.npcs.every((n) => n.standing === 0 && n.tier === 0), 'everyone starts a stranger');

// ── actor-side bumps: heal +2, gun +3, craft +1, ammo +1, listing +1 ──
await seedCh(una.id, 'health=90');
r = await call('POST', '/v1/heal', { token: una.token });
assert.equal(r.code, 200, 'healed');
assert.equal(r.body.cost, 150, 'stranger pays the full rate');
assert.equal((await standingOf(una.token, 'doc')).standing, 2, 'the Doc remembers a customer (+2)');
assert.equal((await call('POST', '/v1/armory/gun/lastresort/buy', { token: una.token })).code, 200, 'iron bought');
assert.equal((await call('POST', '/v1/workshop/craft/espresso', { token: una.token })).code, 200, 'crafted');
assert.equal((await call('POST', '/v1/armory/ammo', { token: una.token })).code, 200, 'a box of rounds');
assert.equal((await standingOf(una.token, 'armorer')).standing, 5, 'Bella tallies gun+craft+ammo (3+1+1)');
assert.equal(await ledgerOf(una.id, 'gun:buy:lastresort'), -GUNS.find((g) => g.id === 'lastresort').cash, 'stranger pays the sticker price');
assert.equal((await call('POST', '/v1/goods/buy', { token: una.token, body: { goodId: 'gin', qty: 5 } })).code, 200, 'trunk stocked');
r = await call('POST', '/v1/market', { token: una.token, body: { goodId: 'gin', qty: 5, price: 100, hours: 72 } });
assert.equal(r.code, 200, 'listed');
assert.equal(r.body.expiresSeconds, BLACK_MARKET.MAX_TTL_H * 3600, 'a stranger asking 72h is clamped to the 48h floor rule');
assert.equal((await standingOf(una.token, 'harbor')).standing, 1, 'Big Tuna logs the listing (+1)');

// ── gifts: a $5k sink, +5 standing, but ONLY below the cap — the top is earned ──
const cashBefore = (await meOf(una.token)).cash;
r = await call('POST', '/v1/underworld/doc/gift', { token: una.token });
assert.equal(r.code, 200, 'the gift lands');
assert.equal(r.body.standing, 7, '2 + 5');
assert.equal((await meOf(una.token)).cash, cashBefore - UNDERWORLD.GIFT_COST, 'the envelope cost $5k');
assert.equal((await call('POST', '/v1/underworld/madame/gift', { token: una.token })).body.error, 'bad_npc', 'no such fixture');
await seedNpc(una.id, 'doc', UNDERWORLD.GIFT_CAP - 2);
r = await call('POST', '/v1/underworld/doc/gift', { token: una.token });
assert.equal(r.body.standing, UNDERWORLD.GIFT_CAP, 'the bump is capped at the door (48 + 5 → 50)');
assert.equal((await call('POST', '/v1/underworld/doc/gift', { token: una.token })).body.error, 'earned', 'money stops opening doors at 50');
assert.equal(await ledgerOf(una.id, 'underworld:gift'), -2 * UNDERWORLD.GIFT_COST, 'both envelopes ledgered underworld:gift');

// ── DOC MORETTI: T1 house rates, T2 half stays, T3 walk-outs ──
await seedNpc(ted.id, 'doc', 25);
await seedCh(ted.id, 'health=40');
r = await call('POST', '/v1/heal', { token: ted.token });
assert.equal(r.body.cost, Math.floor((100 - 40) * 15 * UNDERWORLD.FX.DOC_MULT), 'a friend of the Doc heals at ×0.9');
assert.equal((await call('POST', '/v1/underworld/discharge', { token: ted.token })).body.error, 'standing', 'T1 does not sign early papers');
await seedNpc(ted.id, 'doc', 60);
assert.equal((await call('POST', '/v1/underworld/discharge', { token: ted.token })).body.error, 'healthy', 'nobody discharges a healthy man');
await seedCh(ted.id, `hosp_until='${new Date(Date.now() + 600000).toISOString()}'`);
r = await call('POST', '/v1/underworld/discharge', { token: ted.token });
assert.equal(r.code, 200, 'T2 signs the papers');
assert.equal(r.body.cost, 10 * UNDERWORLD.DISCHARGE_PER_MIN, 'priced per remaining minute (10 min × $150)');
assert.equal(r.body.full, false, 'T2 halves, never erases');
assert(r.body.hospSeconds > 285 && r.body.hospSeconds <= 300, `the 10-min stay is halved (saw ${r.body.hospSeconds}s)`);
await seedNpc(ted.id, 'doc', 90);
await seedCh(ted.id, `hosp_until='${new Date(Date.now() + 600000).toISOString()}'`);
r = await call('POST', '/v1/underworld/discharge', { token: ted.token });
assert.equal(r.body.full, true, 'T3 walks out');
assert.equal(r.body.hospSeconds, 0, 'in full');
assert.equal(await ledgerOf(ted.id, 'underworld:discharge'), -2 * 10 * UNDERWORLD.DISCHARGE_PER_MIN, 'both discharges ledgered');

// ── VINNIE THE MATCH: T1 NPC hitmen ×0.9, T2 post-fee waived, T3 searches ×0.9 ──
await seedNpc(ted.id, 'fixer', 25);
r = await call('POST', `/v1/streets/${mark.id}/npchit`, { token: ted.token, body: { tier: 'legbreaker' } });
assert.equal(r.code, 200, 'the contractor takes the job');
const legCost = Math.floor(NPC_HITMEN.find((t) => t.id === 'legbreaker').cost * UNDERWORLD.FX.NPCHIT_MULT);
assert.equal(r.body.cost, legCost, 'a friend of the Match hires at ×0.9');
assert.equal(await ledgerOf(ted.id, 'npchit:hire'), -legCost, 'the discounted fee is what burned');
assert.equal((await standingOf(ted.token, 'fixer')).standing, 29, 'arranged work is business (+4)');
await seedNpc(ted.id, 'fixer', 60);
const tedCash = (await meOf(ted.token)).cash;
r = await call('POST', `/v1/streets/${rob.id}/bounty`, { token: ted.token, body: { amount: 500, kind: 'kill' } });
assert.equal(r.code, 200, 'contract posted');
assert.equal((await meOf(ted.token)).cash, tedCash - 505, 'T2 pays amount + street tax only — the post fee is waived');
assert.equal(await ledgerOf(ted.id, 'bounty:take'), -5, 'the take row is the tax alone');
await seedNpc(ted.id, 'fixer', 90);
r = await call('POST', `/v1/streets/${rob.id}/search`, { token: ted.token });
assert.equal(r.code, 200, 'the search is out');
const eta = new Date(r.body.placedAt).getTime() - Date.now();
assert(eta > 8300 && eta <= 9050, `the 10s test search places in ~9s at T3 (saw ${Math.round(eta)}ms)`);

// ── BELLA BANG-BANG: T1 guns ×0.9 cash, T2 crafts ×0.9, T3 the 30% buyback ──
await seedNpc(ted.id, 'armorer', 25);
r = await call('POST', '/v1/armory/gun/lastresort/buy', { token: ted.token });
assert.equal(r.code, 200, 'iron bought');
const gunDeal = Math.floor(GUNS.find((g) => g.id === 'lastresort').cash * UNDERWORLD.FX.GUN_MULT);
assert.equal(r.body.price, gunDeal, 'a friend buys at ×0.9 (cash only — the crates stand)');
assert.equal(await ledgerOf(ted.id, 'gun:buy:lastresort'), -gunDeal, 'the discounted price is what is ledgered');
assert.equal((await call('POST', '/v1/underworld/gun/lastresort/sell', { token: ted.token })).body.error, 'standing', 'she only buys from family (T3)');
await seedNpc(ted.id, 'armorer', 60);
await call('POST', '/v1/workshop/craft/espresso', { token: ted.token });
assert.equal(await ledgerOf(ted.id, 'craft:espresso'),
  -Math.floor(CONSUMABLES.find((c) => c.id === 'espresso').cost * UNDERWORLD.FX.CRAFT_MULT), 'T2 crafts at ×0.9');
await seedNpc(ted.id, 'armorer', 90);
r = await call('POST', '/v1/underworld/gun/lastresort/sell', { token: ted.token });
assert.equal(r.code, 200, 'she takes it off your hip');
assert.equal(r.body.price, Math.floor(GUNS.find((g) => g.id === 'lastresort').cash * UNDERWORLD.GUN_BUYBACK), '30% of sticker');
assert.equal(await ledgerOf(ted.id, 'underworld:gunsale'), r.body.price, 'the buyback is a ledgered faucet');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM character_guns WHERE character_id='${ted.id}' AND gun_id='lastresort'`)).rows[0].n), 0, 'the piece is gone');
assert.equal((await call('POST', '/v1/underworld/gun/lastresort/sell', { token: ted.token })).body.error, 'none', 'she will not buy it twice');

// ── BIG TUNA: T1 guard fees ×0.9, T2 72h listings, T3 a fourth slot ──
await seedNpc(ted.id, 'harbor', 25);
assert.equal((await call('POST', '/v1/goods/buy', { token: ted.token, body: { goodId: 'gin', qty: 7 } })).code, 200, 'trunk stocked');
assert.equal((await call('POST', '/v1/convoy', { token: ted.token, body: { to: 'neon', goodId: 'gin', qty: 5 } })).code, 200, 'shipment opened');
r = await call('POST', '/v1/convoy/depart', { token: ted.token, body: { guards: 'crew' } });
assert.equal(r.code, 200, 'on the road');
const crewFee = Math.floor(CONVOY.GUARD_TIERS.find((t) => t.id === 'crew').fee * UNDERWORLD.FX.GUARD_MULT);
assert.equal(await ledgerOf(ted.id, 'convoy:guards'), -crewFee, 'a friend of the Harbor Master pays ×0.9 for the same muscle');
assert.equal((await standingOf(ted.token, 'harbor')).standing, 27, 'freight on the water (+2)');
await seedNpc(ted.id, 'harbor', 60);
r = await call('POST', '/v1/market', { token: ted.token, body: { goodId: 'gin', qty: 2, price: 100, hours: 72 } });
assert.equal(r.code, 200, 'listed');
assert.equal(r.body.expiresSeconds, UNDERWORLD.FX.TTL_H * 3600, 'T2 listings run the full 72h');
await seedNpc(ted.id, 'harbor', 90);
for (let i = 0; i < 3; i++)
  assert.equal((await call('POST', '/v1/market/order', { token: ted.token, body: { goodId: 'gin', qty: 1, price: 100 } })).code, 200, `order ${i + 2} of 4`);
assert.equal((await call('POST', '/v1/market/order', { token: ted.token, body: { goodId: 'gin', qty: 1, price: 100 } })).body.error, 'max_listings', 'the fifth slot does not exist');

// ── the estate: standing dies with the street ──
const kill = await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: ted.id },
  headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal(kill.statusCode, 200, 'the Commission retires ted');
r = await call('GET', '/v1/underworld', { token: ted.token });
assert(r.body.npcs.every((n) => n.standing === 0 && n.tier === 0), 'the heir is a stranger — who you knew died with the street');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM npc_standing WHERE character_id='${ted.id}'`)).rows[0].n), 0, 'the rows are gone');

// ── §10.4: the underworld: vocabulary is closed ──
const vocab = (await runLedgerInvariants(pool)).checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `underworld:* rides the vocabulary (${JSON.stringify(vocab.unknown || [])})`);

console.log('✅ Underworld test passed — four-fixture board, actor-side bumps (heal+2/gun+3/craft+1/ammo+1/listing+1), gifts ($5k sink, capped at 50, refused above), DOC heal ×0.9 + discharge $150/min (T2 half stay, T3 walk-out), VINNIE NPC-hit ×0.9 + waived post fee (tax stands) + ~9s search, BELLA gun ×0.9 cash + craft ×0.9 + 30% buyback (row gone, no double-sell), BIG TUNA guards ×0.9 + 72h listings + a fourth slot (fifth refused), estate wipes standing, vocabulary closed');
await app.close();

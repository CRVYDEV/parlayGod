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
import { UNDERWORLD, BLACK_MARKET, CONVOY, CASINO, GUNS, CONSUMABLES, NPC_HITMEN, leadTaskOf, dayOf } from '../src/rules.js';
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
assert.equal(r.body.npcs.length, 5, 'five fixtures (step two seats the Madame)');
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
assert.equal((await call('POST', '/v1/underworld/capone/gift', { token: una.token })).body.error, 'bad_npc', 'no such fixture');
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

// ── STEP TWO: THE MADAME — dice bumps, T1 comped nerve, T2 velvet rope, T3 whispers ──
const mia = await mk('Madame-friend Mia');
await seedCh(mia.id, `cash=5000000, loc='${CASINO.DISTRICT}'`);
const nerve0 = (await meOf(mia.token)).nerve;
assert.equal((await call('POST', '/v1/casino/dice', { token: mia.token, body: { amount: 100 } })).code, 200, 'a roll at the den');
assert.equal((await standingOf(mia.token, 'madame')).standing, 1, 'action on her floor is business (+1)');
assert.equal((await meOf(mia.token)).nerve, nerve0 - CASINO.DICE_NERVE, 'a stranger pays the nerve');
assert.equal((await call('POST', '/v1/casino/dice', { token: mia.token, body: { amount: CASINO.MAX_BET + 1 } })).body.error, 'max', 'no velvet rope for strangers');
await seedNpc(mia.id, 'madame', 25);
// step three: the lead is a rotating TASK — play whatever the seed drew for the Madame today
const mTask = leadTaskOf(dayOf(), 'madame');
r = mTask === 'dice'
  ? await call('POST', '/v1/casino/dice', { token: mia.token, body: { amount: 100 } })
  : await call('POST', '/v1/casino/numbers', { token: mia.token, body: { pick: 7, amount: 100 } });
assert.equal(r.code, 200, `today's drawn task (${mTask}) done`);
assert.equal((await standingOf(mia.token, 'madame')).standing, 25 + 1 + UNDERWORLD.STEP2.LEAD_BONUS, 'the drawn task with her best fixture pays the lead (+1 and +5)');
const nerve1 = (await meOf(mia.token)).nerve;
assert.equal((await call('POST', '/v1/casino/dice', { token: mia.token, body: { amount: 100 } })).code, 200, 'another roll at T1');
assert.equal((await meOf(mia.token)).nerve, nerve1, 'T1: the house comps the seat — no nerve');
await seedNpc(mia.id, 'madame', 60);
assert.equal((await call('POST', '/v1/casino/dice', { token: mia.token, body: { amount: CASINO.MAX_BET + 1 } })).code, 200, 'T2: the velvet rope opens the high-stakes room at any level');
assert.equal((await standingOf(mia.token, 'madame')).standing, 61, 'the high-stakes roll still pays +1 (lead spent)');
await seedNpc(mia.id, 'madame', 90);
r = await call('GET', '/v1/underworld', { token: mia.token });
assert.deepEqual(r.body.whispers, { asking: 0 }, 'T3: pillow talk — quiet streets read zero');
const hank = await mk('Hunter Hank');
assert.equal((await call('POST', `/v1/streets/${mia.id}/search`, { token: hank.token })).code, 200, 'a hunter starts asking around');
r = await call('GET', '/v1/underworld', { token: mia.token });
assert.deepEqual(r.body.whispers, { asking: 1 }, 'the girls hear the question — a count, never a name');
assert.equal((await call('GET', '/v1/underworld', { token: rob.token })).body.whispers, undefined, 'below T3 nobody whispers');

// ── STEP TWO+THREE: THE LEAD — a rotating TASK with your best fixture pays +5, once a day ──
const lee = await mk('Lucky Lee');
await seedCh(lee.id, "cash=100000, cb=10, loc='docks'");
await seedNpc(lee.id, 'armorer', 30); // his best relationship
r = await call('POST', '/v1/underworld/armorer/gift', { token: lee.token });
assert.equal(r.body.standing, 35, 'the envelope pays +5 flat');
const aTask = leadTaskOf(dayOf(), 'armorer'); // 'craft' or 'ammo' — the whole town gets the same draw
const aOther = aTask === 'craft' ? 'ammo' : 'craft';
const doArmorer = (t) => t === 'craft'
  ? call('POST', '/v1/workshop/craft/espresso', { token: lee.token })
  : call('POST', '/v1/armory/ammo', { token: lee.token });
r = await call('GET', '/v1/underworld', { token: lee.token });
assert.deepEqual(r.body.lead, { npc: 'armorer', task: aTask, bonus: UNDERWORLD.STEP2.LEAD_BONUS, done: false }, 'a gift is not business — the lead (with its drawn task) still stands');
assert.equal((await doArmorer(aOther)).code, 200, 'business with the right fixture, WRONG job');
assert.equal((await standingOf(lee.token, 'armorer')).standing, 36, 'off-task business pays flat (+1) — the lead is a specific ask');
assert.equal((await call('GET', '/v1/underworld', { token: lee.token })).body.lead.done, false, 'still unclaimed');
assert.equal((await doArmorer(aTask)).code, 200, 'the drawn task itself');
assert.equal((await standingOf(lee.token, 'armorer')).standing, 36 + 1 + UNDERWORLD.STEP2.LEAD_BONUS, 'the task with your best pays the lead (+1+5)');
assert.equal((await call('GET', '/v1/underworld', { token: lee.token })).body.lead.done, true, 'claimed');
assert.equal((await doArmorer(aTask)).code, 200, 'the same job again');
assert.equal((await standingOf(lee.token, 'armorer')).standing, 43, 'once a day (+1 only)');
const ned = await mk('Non-best Ned');
await seedCh(ned.id, 'cash=100000, health=90');
await seedNpc(ned.id, 'armorer', 30);
assert.equal((await call('POST', '/v1/heal', { token: ned.token })).code, 200, 'business with the WRONG fixture');
assert.equal((await standingOf(ned.token, 'doc')).standing, 2, 'no bonus off-lead (+2 flat)');
assert.equal((await call('GET', '/v1/underworld', { token: ned.token })).body.lead.done, false, 'the lead waits for Bella');
assert.equal((await call('GET', '/v1/underworld', { token: hank.token })).body.lead, null, 'strangers to everyone get no lead');

// ── STEP TWO: DECAY — idle friendships cool 1/day past a week, never below tier 1 ──
const otis = await mk('Old-Timer Otis');
await seedCh(otis.id, 'cash=100000, health=90');
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
await pool.query(`INSERT INTO npc_standing (character_id, npc_id, standing, touched_at) VALUES ('${otis.id}','doc',40,'${daysAgo(10)}')`);
await pool.query(`INSERT INTO npc_standing (character_id, npc_id, standing, touched_at) VALUES ('${otis.id}','harbor',90,'${daysAgo(100)}')`);
await pool.query(`INSERT INTO npc_standing (character_id, npc_id, standing, touched_at) VALUES ('${otis.id}','fixer',20,'${daysAgo(100)}')`);
r = await call('GET', '/v1/underworld', { token: otis.token });
const oNpc = Object.fromEntries(r.body.npcs.map((n) => [n.id, n.standing]));
assert.equal(oNpc.doc, 37, '10 idle days = 3 past grace → 40 cools to 37');
assert.equal(oNpc.harbor, 25, 'a season away cools any friendship to the tier-1 floor, never below');
assert.equal(oNpc.fixer, 20, 'below the floor nothing cools — strangers stay as they were');
assert.equal((await call('POST', '/v1/heal', { token: otis.token })).code, 200, 'business with the Doc again');
assert.equal((await standingOf(otis.token, 'doc')).standing, 44, 'the bump lands on the COOLED value (37+2, +5 lead — doc is his best)');
assert.equal(Number((await pool.query(`SELECT standing FROM npc_standing WHERE character_id='${otis.id}' AND npc_id='doc'`)).rows[0].standing), 44, 'the cooling materialized in the stored row');

// ── STEP TWO: RIVALRY — blood work costs the Doc's goodwill ──
const ray = await mk('Rival-test Ray');
await seedCh(ray.id, 'cash=100000');
await seedNpc(ray.id, 'doc', 30);
const vic2 = await mk('Poor Vic');
await seedCh(vic2.id, 'respect=100');
assert.equal((await call('POST', `/v1/streets/${vic2.id}/npchit`, { token: ray.token, body: { tier: 'legbreaker' } })).code, 200, 'ray sends the man with the bag');
assert.equal((await standingOf(ray.token, 'fixer')).standing, 4, 'Vinnie approves (+4)');
assert.equal((await standingOf(ray.token, 'doc')).standing, 28, 'the Doc does not (−2)');

// ── STEP THREE: RIVALRY #2 — road piracy: Bella loves it, Big Tuna does not ──
const sal2 = await mk('Shipper Sal Two');
await seedCh(sal2.id, "cash=500000, loc='docks'");
assert.equal((await call('POST', '/v1/goods/buy', { token: sal2.token, body: { goodId: 'gin', qty: 5 } })).code, 200, 'freight bought');
r = await call('POST', '/v1/convoy', { token: sal2.token, body: { to: 'neon', goodId: 'gin', qty: 5 } });
assert.equal(r.code, 200, 'shipment opened');
const runId = r.body.id;
assert.equal((await call('POST', '/v1/convoy/depart', { token: sal2.token, body: { guards: 'none' } })).code, 200, 'on the road');
const bo = await mk('Bandit Bo');
await seedCh(bo.id, "energy=200, ammo=100, loc='docks'");
await seedNpc(bo.id, 'harbor', 30);
r = await call('POST', `/v1/convoy/${runId}/ambush`, { token: bo.token });
assert.equal(r.code, 200, 'the play was made (win or lose — the attempt is the offense)');
assert.equal((await standingOf(bo.token, 'armorer')).standing, UNDERWORLD.STEP3.AMBUSH_ARMORER, 'Bella loves the chaos (+2)');
assert.equal((await standingOf(bo.token, 'harbor')).standing, 30 - UNDERWORLD.STEP3.AMBUSH_HARBOR, 'the Harbor Master hears who hit the road (−2)');

// ── STEP THREE: GRUDGES — whack a friend of the house and the house remembers ──
const gus = await mk('Grudge Gus');
await seedNpc(gus.id, 'doc', 80); // his best (task = heal, never performed → no lead noise)
const vip = await mk('Connected Carlo');
await seedCh(vip.id, 'respect=100');
await seedNpc(vip.id, 'doc', 70);     // a real friend of the Doc (≥ GRUDGE_MIN 60)
await seedNpc(vip.id, 'madame', 60);  // and of the Madame (exactly at the line)
await seedNpc(vip.id, 'fixer', 10);   // an acquaintance of Vinnie — no grudge for those
let attempts = 0, gRes = null;
for (let i = 0; i < 80 && !gRes?.killed; i++) {
  await seedCh(gus.id, 'cash=5000000, npchit_at=NULL');
  await pool.query('DELETE FROM npc_hits');
  await seedCh(vip.id, 'hosp_until=NULL');
  gRes = (await call('POST', `/v1/streets/${vip.id}/npchit`, { token: gus.token, body: { tier: 'professional' } })).body;
  attempts++;
}
assert(gRes?.killed, 'the contractor eventually lands it');
assert.deepEqual([...gRes.grudges].sort(), ['doc', 'madame'], 'both real friends of the dead man hold a grudge — the acquaintance does not');
assert.equal((await standingOf(gus.token, 'doc')).standing, 80 - UNDERWORLD.STEP2.RIVAL_LOSS * attempts - UNDERWORLD.STEP3.GRUDGE_LOSS,
  `the Doc: −2 rivalry per attempt (${attempts}) and −5 for killing his friend`);
assert.equal((await standingOf(gus.token, 'madame')).standing, 0, 'her grudge lands on a stranger — standing floors at 0');
assert.equal((await standingOf(gus.token, 'fixer')).standing, 4 * attempts, 'Vinnie holds no grudge — arranged work is arranged work');

// ── STEP FOUR: grudges have TEETH — the tier caps at 2 until penance squares it ──
r = await call('GET', '/v1/underworld', { token: gus.token });
assert.equal(r.body.npcs.find((n) => n.id === 'doc').grudge, 1, 'the board shows the Doc holds one');
assert.equal(r.body.npcs.find((n) => n.id === 'madame').grudge, 1, 'and the Madame');
await seedNpc(gus.id, 'doc', 95);
r = await call('GET', '/v1/underworld', { token: gus.token });
assert.equal(r.body.npcs.find((n) => n.id === 'doc').tier, UNDERWORLD.STEP4.GRUDGE_TIER_CAP, 'standing 95 reads tier 2 while the grudge stands — business, not favors');
assert.equal((await call('POST', '/v1/underworld/doc/favor', { token: gus.token })).body.error, 'standing', 'a grudged fixture does no favors');
r = await call('POST', '/v1/underworld/doc/penance', { token: gus.token });
assert.equal(r.code, 200, 'penance paid');
assert.equal(r.body.squared, true, 'the slate is clean');
assert.equal(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE character_id='${gus.id}' AND reason='underworld:penance'`)).rows[0].s), -UNDERWORLD.STEP4.PENANCE_COST, 'a ledgered underworld:penance sink');
r = await call('GET', '/v1/underworld', { token: gus.token });
assert.equal(r.body.npcs.find((n) => n.id === 'doc').tier, 3, 'the cap lifts — tier 3 again');
assert.equal(r.body.npcs.find((n) => n.id === 'doc').grudge, 0, 'no grudge on the board');
assert.equal((await call('POST', '/v1/underworld/doc/penance', { token: gus.token })).body.error, 'clean', 'nothing left to square with the Doc');

// ── STEP FOUR: the weekly favor — one per street, resources never money, Vinnie refuses ──
await seedCh(gus.id, 'health=40');
r = await call('POST', '/v1/underworld/doc/favor', { token: gus.token });
assert.equal(r.code, 200, 'the Doc owes his circle a patch-up');
assert.equal(r.body.health, 100, 'quietly made whole');
assert.equal(Math.floor((await meOf(gus.token)).health), 100, 'and the street agrees');
assert.equal((await call('POST', '/v1/underworld/doc/favor', { token: gus.token })).body.error, 'taken', 'one favor a week, house-wide');
assert.equal((await call('GET', '/v1/underworld', { token: gus.token })).body.favor.taken, true, 'the board says so');
const vlad = await mk('Vinnie-friend Vlad');
await seedNpc(vlad.id, 'fixer', 95);
assert.equal((await call('POST', '/v1/underworld/fixer/favor', { token: vlad.token })).body.error, 'debts', 'Vinnie deals in debts, not gifts');
assert.equal((await call('POST', '/v1/underworld/madame/favor', { token: vlad.token })).body.error, 'standing', 'strangers get nothing');
await seedNpc(vlad.id, 'madame', 95);
await seedCh(vlad.id, 'nerve=1');
r = await call('POST', '/v1/underworld/madame/favor', { token: vlad.token });
assert.equal(r.code, 200, 'a night off the clock');
assert.equal(r.body.nerve, 11, 'nerve refilled to the level-1 cap (10+1)');
await seedNpc(lee.id, 'harbor', 95);
await seedCh(lee.id, 'energy=10');
r = await call('POST', '/v1/underworld/harbor/favor', { token: lee.token });
assert.equal(r.code, 200, 'dock hands for the day');
assert.equal(r.body.energy, 52, 'energy refilled to the level-1 cap (50+2)');
const fay = await mk('Favored Fay');
await seedCh(fay.id, "cash=100000, energy=200, gta_at=NULL, loc='docks'");
let boosted = null;
for (let i = 0; i < 20 && !boosted; i++) {
  await seedCh(fay.id, 'gta_at=NULL, energy=200, jail_until=NULL');
  const b = (await call('POST', '/v1/garage/boost', { token: fay.token })).body;
  if (b.success) boosted = b.car;
}
assert(boosted, 'fay eventually boosts a car');
await pool.query(`UPDATE cars SET dmg=37 WHERE id='${boosted.id}'`); // deterministic scratch (dmg is not a §10.4 axis)
await seedNpc(fay.id, 'armorer', 95);
r = await call('POST', '/v1/underworld/armorer/favor', { token: fay.token });
assert.equal(r.code, 200, "Bella's boys work overnight");
assert.equal(r.body.repaired, boosted.id, 'the worst iron in the garage');
assert.equal(Number((await pool.query(`SELECT dmg FROM cars WHERE id='${boosted.id}'`)).rows[0].dmg), 0, 'not a scratch on it');
const nod = await mk('Nothing Ned Two');
await seedNpc(nod.id, 'armorer', 95);
assert.equal((await call('POST', '/v1/underworld/armorer/favor', { token: nod.token })).body.error, 'nothing', 'no garage, no job for her boys');
await seedNpc(nod.id, 'doc', 95);
await seedCh(nod.id, 'health=50');
assert.equal((await call('POST', '/v1/underworld/doc/favor', { token: nod.token })).code, 200, "the refused errand didn't burn the week");

// ── STEP FOUR: lead STREAKS — consecutive days sweeten the bonus, capped ──
const stan = await mk('Streaky Stan');
await seedCh(stan.id, "cash=20000, cb=5, loc='docks'");
await seedNpc(stan.id, 'armorer', 30);
await pool.query(`INSERT INTO npc_leads (character_id, day, npc_id, streak) VALUES ('${stan.id}', ${dayOf() - 1}, 'armorer', 2)`);
const sTask = leadTaskOf(dayOf(), 'armorer');
const doStan = () => sTask === 'craft'
  ? call('POST', '/v1/workshop/craft/espresso', { token: stan.token })
  : call('POST', '/v1/armory/ammo', { token: stan.token });
assert.equal((await doStan()).code, 200, "stan does today's drawn job");
assert.equal((await standingOf(stan.token, 'armorer')).standing, 30 + 1 + UNDERWORLD.STEP2.LEAD_BONUS + 2, 'day three of the streak pays +5+2 on top of the +1');
assert.equal(Number((await pool.query(`SELECT streak FROM npc_leads WHERE character_id='${stan.id}' AND day=${dayOf()}`)).rows[0].streak), 3, 'the streak row advanced');
const cap = await mk('Capped Cal');
await seedCh(cap.id, "cash=20000, cb=5, loc='docks'");
await seedNpc(cap.id, 'armorer', 30);
await pool.query(`INSERT INTO npc_leads (character_id, day, npc_id, streak) VALUES ('${cap.id}', ${dayOf() - 1}, 'armorer', 9)`);
const doCap = () => sTask === 'craft'
  ? call('POST', '/v1/workshop/craft/espresso', { token: cap.token })
  : call('POST', '/v1/armory/ammo', { token: cap.token });
assert.equal((await doCap()).code, 200, "cal's tenth straight day");
assert.equal((await standingOf(cap.token, 'armorer')).standing, 30 + 1 + UNDERWORLD.STEP2.LEAD_BONUS + UNDERWORLD.STEP4.STREAK_BONUS_CAP, 'the streak bonus caps at +5 extra (day 6+ pays +10)');

// ── STEP FIVE: GRUDGE DECAY — time heals what money can't, one per two weeks ──
const olga = await mk('Old-Grudge Olga');
await seedCh(olga.id, 'cash=100000');
await seedNpc(olga.id, 'doc', 95);
await seedNpc(olga.id, 'harbor', 95);
await pool.query(`INSERT INTO npc_grudges (character_id, npc_id, count, since) VALUES ('${olga.id}','doc',2,'${daysAgo(15)}')`);
await pool.query(`INSERT INTO npc_grudges (character_id, npc_id, count, since) VALUES ('${olga.id}','harbor',1,'${daysAgo(30)}')`);
r = await call('GET', '/v1/underworld', { token: olga.token });
assert.equal(r.body.npcs.find((n) => n.id === 'doc').grudge, 1, 'fifteen idle days healed one of two grudges');
assert.equal(r.body.npcs.find((n) => n.id === 'doc').tier, 2, 'the remaining one still caps the tier');
assert.equal(r.body.npcs.find((n) => n.id === 'harbor').grudge, 0, 'a month healed the single grudge entirely');
assert.equal(r.body.npcs.find((n) => n.id === 'harbor').tier, 3, 'Big Tuna forgot all about it');
r = await call('POST', '/v1/underworld/doc/penance', { token: olga.token });
assert.equal(r.code, 200, 'penance on the EFFECTIVE count');
assert.equal(r.body.remaining, 0, 'one payment squares what time left');
assert.equal(Number((await pool.query(`SELECT count FROM npc_grudges WHERE character_id='${olga.id}' AND npc_id='doc'`)).rows[0].count), 0, 'the healing materialized in the stored row');
assert.equal((await call('POST', '/v1/underworld/harbor/penance', { token: olga.token })).body.error, 'clean', 'no paying for what time already healed');

// ── STEP FIVE: THE ERRAND CHAIN — a fixture's storyline, one drawn task a day, three days ──
const erin = await mk('Errand Erin');
await seedCh(erin.id, "cash=20000, cb=10, loc='docks'");
await seedNpc(erin.id, 'armorer', 30);
assert.equal((await call('POST', '/v1/underworld/madame/errand', { token: erin.token })).body.error, 'stranger', 'no work for strangers');
r = await call('POST', '/v1/underworld/armorer/errand', { token: erin.token });
assert.equal(r.code, 200, 'Bella hands over a job');
assert.equal(r.body.task, sTask, "the errand rides the day's drawn task");
const doErin = () => sTask === 'craft'
  ? call('POST', '/v1/workshop/craft/espresso', { token: erin.token })
  : call('POST', '/v1/armory/ammo', { token: erin.token });
assert.equal((await doErin()).code, 200, 'day one of the job');
assert.equal((await standingOf(erin.token, 'armorer')).standing, 36, 'step one pays the normal bump + the lead (+1+5)');
r = await call('GET', '/v1/underworld', { token: erin.token });
assert.deepEqual(r.body.errand, { npc: 'armorer', step: 1, of: UNDERWORLD.STEP5.CHAIN_STEPS, task: sTask, doneToday: true }, 'the board tracks the chain');
assert.equal((await doErin()).code, 200, 'more of the same, same day');
assert.equal((await standingOf(erin.token, 'armorer')).standing, 37, 'no double-step in a day (+1 flat)');
assert.equal((await call('GET', '/v1/underworld', { token: erin.token })).body.errand.step, 1, 'still step one');
await pool.query(`UPDATE npc_errands SET last_day=${dayOf() - 1} WHERE character_id='${erin.id}'`); // the sun sets
assert.equal((await doErin()).code, 200, 'day two');
assert.equal((await call('GET', '/v1/underworld', { token: erin.token })).body.errand.step, 2, 'step two');
await pool.query(`UPDATE npc_errands SET last_day=${dayOf() - 1} WHERE character_id='${erin.id}'`);
assert.equal((await doErin()).code, 200, 'day three — the job is done');
assert.equal((await standingOf(erin.token, 'armorer')).standing, 38 + 1 + UNDERWORLD.STEP5.CHAIN_BONUS, 'the finished chain pays +15 on top of the bump');
assert.equal((await call('GET', '/v1/underworld', { token: erin.token })).body.errand, null, 'the slate is clear');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM notifications WHERE character_id='${erin.id}' AND type='errand_done'`)).rows[0].n), 1, 'and she heard about it');
r = await call('POST', '/v1/underworld/armorer/errand', { token: erin.token });
assert.equal(r.code, 200, 'a new job');
r = await call('POST', '/v1/underworld/armorer/errand', { token: erin.token });
assert.equal(r.body.replaced, 'armorer', 'starting another replaces the half-done one');

// ── the estate: BLOODLINE MEMORY — the heir inherits 25% of each standing, floored ──
const preDeath = (await call('GET', '/v1/underworld', { token: ted.token })).body.npcs;
const kill = await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: ted.id },
  headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal(kill.statusCode, 200, 'the Commission retires ted');
const heirNpcs = (await call('GET', '/v1/underworld', { token: ted.token })).body.npcs;
for (const n of preDeath) {
  const inherited = Math.floor(n.standing * UNDERWORLD.STEP2.MEMORY_BPS / 10000);
  assert.equal(heirNpcs.find((x) => x.id === n.id).standing, inherited,
    `${n.id}: the heir inherits floor(${n.standing} × 25%) = ${inherited}`);
}
assert(heirNpcs.some((n) => n.standing > 0), 'the heir is NOT a total stranger — the names remember the bloodline');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM npc_standing WHERE character_id='${ted.id}'`)).rows[0].n), 0, 'the dead street\'s own rows are gone');

// ── §10.4: the underworld: vocabulary is closed ──
const vocab = (await runLedgerInvariants(pool)).checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `underworld:* rides the vocabulary (${JSON.stringify(vocab.unknown || [])})`);

console.log('✅ Underworld test passed — five-fixture board, actor-side bumps (heal+2/gun+3/craft+1/ammo+1/listing+1), gifts ($5k sink, capped at 50, refused above), DOC heal ×0.9 + discharge $150/min (T2 half stay, T3 walk-out), VINNIE NPC-hit ×0.9 + waived post fee (tax stands) + ~9s search, BELLA gun ×0.9 cash + craft ×0.9 + 30% buyback (row gone, no double-sell), BIG TUNA guards ×0.9 + 72h listings + a fourth slot (fifth refused) + STEP TWO: the MADAME (den bumps, T1 comped nerve, T2 velvet rope at any level, T3 whispers count hunters — never names), the daily LEAD (+5 on first business with your best, gifts never claim it, once a day, strangers get none), DECAY (1/day past a week idle, floored at tier 1, materializes on the next bump), RIVALRY (an NPC hire costs the Doc −2), BLOODLINE MEMORY (the heir inherits floor(25%) of every standing; the dead street\'s rows are gone) + STEP THREE: rotating lead TASKS (seed-drawn per day, off-task business pays flat, the drawn job claims +5), RIVALRY #2 (an ambush attempt: Bella +2 / Big Tuna −2, win or lose), GRUDGES (whacking a T2+ friend of a fixture docks the killer 5 with that fixture — acquaintances forgive, strangers floor at 0, Vinnie never grudges) + STEP FOUR: grudges with TEETH (open grudge caps the tier at 2 — standing 95 reads tier 2, no favors — until a $25k ledgered penance squares it, once per grudge, clean refused), the WEEKLY FAVOR (one per street per week from any un-grudged T3 fixture: Doc patch-up, Madame nerve, Big Tuna energy, Bella repairs the worst iron — a refused errand never burns the week; Vinnie deals in debts, not gifts), and lead STREAKS (consecutive days pay +1 each on the +5, capped at +10 — streak rows advance, day 10 pays the cap) + STEP FIVE: GRUDGE DECAY (one grudge heals per 14 idle days — 2@15d reads 1, 1@30d reads 0 and the tier uncaps; penance settles the EFFECTIVE count and materializes it; no paying for what time healed), the ERRAND CHAIN (tier-1+ fixture hands a storyline: the drawn task on 3 separate days → +15; no double-step in a day; the board tracks step/task; done → notify + clean slate; restarting replaces the half-done job; strangers refused), vocabulary closed');
await app.close();

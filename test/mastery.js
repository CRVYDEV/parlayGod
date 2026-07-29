// THE TRADES (mastery expansion, step one) — the use-XP board, the funnel firing at real hook
// sites (a pulled job, a dice play), level-ups notified, the account-level legend mirroring every
// point, DEATH (levels die; the heir inherits HEIR_KEEP_BPS of each track's XP; the legend
// survives whole), the trades leaderboard (agents excluded), the public catalog, and §10.4
// (XP is not a currency — the whole system writes ZERO transactions rows of its own).
// pg-mem, zero infra.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { MASTERY, RACES, masteryLvlOf, masteryXpFor } from '../src/rules.js';
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
  const c = await meOf(token);
  return { token, id: c.id, aid: (await pool.query(`SELECT account_id a FROM characters WHERE id='${c.id}'`)).rows[0].a };
};
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);
const myXp = async (id, track) =>
  Number((await pool.query(`SELECT xp FROM masteries WHERE character_id='${id}' AND track_id='${track}'`)).rows[0]?.xp || 0);
const legendXp = async (aid, track) =>
  Number((await pool.query(`SELECT xp FROM mastery_legend WHERE account_id='${aid}' AND track_id='${track}'`)).rows[0]?.xp || 0);

const gus = await mk('Grinder Gus');

// ── the fresh board + the public catalog ──
let r = await call('GET', '/v1/mastery', { token: gus.token });
assert.equal(r.code, 200, 'the trades board is readable');
assert.equal(r.body.tracks.length, 10, 'ten trades');
assert(r.body.tracks.every((t) => t.xp === 0 && t.lvl === 1 && t.rank === 'Green'), 'a fresh street is Green in every trade');
assert.equal(r.body.legend.rank, 'Dabbler', 'a fresh bloodline is a Dabbler');
assert.equal(r.body.heirKeepBps, MASTERY.HEIR_KEEP_BPS, 'the death-rule dial is on the board');
const rules = (await call('GET', '/v1/rules')).body;
assert.equal(rules.mastery.tracks.length, 10, 'the catalog is public on /v1/rules');
assert.equal(rules.mastery.xp.crime, MASTERY.XP.crime, 'the XP awards are knowable');

// ── the funnel fires on a pulled job (larceny) — and the legend mirrors it exactly ──
let jobs = 0;
for (let i = 0; i < 40 && jobs === 0; i++) {
  await seedCh(gus.id, 'nerve=100');
  if ((await call('POST', '/v1/crimes/pick', { token: gus.token })).body.success) jobs++;
}
assert(jobs > 0, 'at least one clean job landed');
assert.equal(await myXp(gus.id, 'larceny'), MASTERY.XP.crime, `a clean job pays ${MASTERY.XP.crime} larceny XP`);
assert.equal(await legendXp(gus.aid, 'larceny'), MASTERY.XP.crime, 'the lifetime legend mirrors every point');

// ── the gambling hook (dice at the den) — a second track, same funnel — behind the STAKE FLOOR
// (step two): a min-bet spammer with the Madame's comped seat would otherwise farm The Gambler at
// the rate limit for ~free, so a play below GAMBLER_MIN_STAKE schools nothing.
await seedCh(gus.id, "cash=50000, nerve=100, loc='neon'");
r = await call('POST', '/v1/casino/dice', { token: gus.token, body: { amount: 100 } });
assert.equal(r.code, 200, 'a min-bet play resolved');
assert.equal(await myXp(gus.id, 'gambling'), 0, 'a play under the den floor pays NO XP (the anti-farm gate)');
r = await call('POST', '/v1/casino/dice', { token: gus.token, body: { amount: MASTERY.GAMBLER_MIN_STAKE } });
assert.equal(r.code, 200, 'a real-stake play resolved');
assert.equal(await myXp(gus.id, 'gambling'), MASTERY.XP.dice, 'a real stake schooled The Gambler');

// ── level-up: cross a threshold and the street hears about it ──
// seed just under L2 (xp 15 at DIVISOR 15) so the next clean job crosses it
const l2at = masteryXpFor(2);
await pool.query(`UPDATE masteries SET xp=$1 WHERE character_id='${gus.id}' AND track_id='larceny'`, [l2at - 1]);
jobs = 0;
for (let i = 0; i < 40 && jobs === 0; i++) {
  await seedCh(gus.id, 'nerve=100');
  if ((await call('POST', '/v1/crimes/pick', { token: gus.token })).body.success) jobs++;
}
assert(jobs > 0, 'a second clean job landed');
r = await call('GET', '/v1/mastery', { token: gus.token });
const lar = r.body.tracks.find((t) => t.id === 'larceny');
assert(lar.lvl >= 2, 'larceny crossed into L2');
const ding = await pool.query(
  `SELECT payload FROM notifications WHERE character_id='${gus.id}' AND type='mastery_up'`);
assert(ding.rows.length >= 1, 'the level-up was notified');
assert.equal(JSON.parse(ding.rows[0].payload).track, 'larceny', 'the ding names the trade'); // payload is a TEXT column — parse the string

// ── the curve helpers agree with the board ──
assert.equal(masteryLvlOf(lar.xp), lar.lvl, 'board level == curve');
assert.equal(lar.nextAt, masteryXpFor(lar.lvl + 1), 'the next-level distance is the curve');

// ── DEATH: levels die, the heir keeps HEIR_KEEP_BPS of each track, the legend survives whole ──
await pool.query(`UPDATE masteries SET xp=1000 WHERE character_id='${gus.id}' AND track_id='larceny'`);
const legendBefore = await legendXp(gus.aid, 'larceny');
const kill = await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: gus.id },
  headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal(kill.statusCode, 200, 'Gus is retired');
const heir = await meOf(gus.token);
assert.notEqual(heir.id, gus.id, 'the heir rises');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM masteries WHERE character_id='${gus.id}'`)).rows[0].n), 0,
  'the dead street\'s trades are wiped');
assert.equal(await myXp(heir.id, 'larceny'), Math.floor(1000 * MASTERY.HEIR_KEEP_BPS / 10000),
  'the heir inherits exactly HEIR_KEEP_BPS of the larceny schooling');
assert.equal(await legendXp(gus.aid, 'larceny'), legendBefore, 'the lifetime legend survives whole');
const estate = await pool.query(
  `SELECT payload FROM notifications WHERE character_id='${heir.id}' AND type='estate'`);
assert(Number(JSON.parse(estate.rows[0].payload).kept.masteries) >= 1,
  'the estate report counts the echoed trades');

// ── the trades leaderboard: ranked by lifetime XP, agents excluded ──
const bot = await mk('Bot Bertha');
await pool.query(`UPDATE account_persistent SET agent_flag=true WHERE account_id='${bot.aid}'`);
await pool.query(`INSERT INTO mastery_legend (account_id, track_id, xp) VALUES ('${bot.aid}', 'larceny', 999999)`);
r = await call('GET', '/v1/leaderboard/trades', { token: gus.token });
assert.equal(r.code, 200, 'the board is readable');
assert(r.body.trades.some((k) => k.name === 'Grinder Gus'), 'the bloodline (via the living heir) is ranked');
assert(!r.body.trades.some((k) => k.name === 'Bot Bertha'), 'agents never seat the trades board');
const gusRow = r.body.trades.find((k) => k.name === 'Grinder Gus');
assert(gusRow.bestTrade === 'Larceny', 'the deepest trade is named');

// ══ STEP TWO — MILESTONE PERKS + THE LEVEL-50 TRAIT ══
const pia = await mk('Perked Pia');
await seedCh(pia.id, "cash=1000000, respect=5760, loc='docks'"); // level 25 — clear of every content gate
const setXp = async (id, track, xp) => {
  await pool.query(`DELETE FROM masteries WHERE character_id='${id}' AND track_id='${track}'`);
  await pool.query(`INSERT INTO masteries (character_id, track_id, xp) VALUES ('${id}', '${track}', ${xp})`);
};

// the board shows the perk axis: dormant, then live at the exact milestone value
r = await call('GET', '/v1/mastery', { token: pia.token });
let wheels = r.body.tracks.find((t) => t.id === 'wheels');
assert.equal(wheels.perk.now, 1, 'no milestone yet — the perk reads neutral');
assert.equal(wheels.perk.nextAt, MASTERY.MILESTONES[0], 'the board names the first milestone');
await setXp(pia.id, 'wheels', masteryXpFor(25)); // L25 → the second rung
r = await call('GET', '/v1/mastery', { token: pia.token });
wheels = r.body.tracks.find((t) => t.id === 'wheels');
assert.equal(wheels.perk.now, MASTERY.PERKS.wheels.fx[1], 'L25 reads the second rung');

// WHEELS perk bites at a real till: the tune price is discounted and the DISCOUNTED number returned
const { body: { token: garageTok } } = await call('POST', '/v1/auth/guest');
await call('POST', '/v1/character', { token: garageTok, body: { name: 'Flat Rate Fred' } });
const fred = (await meOf(garageTok)).id;
await seedCh(fred, 'cash=1000000, energy=200');
// both boost a car (fred pays sticker, pia pays the L25 rate)
const boostUntil = async (tok, id) => {
  for (let i = 0; i < 100; i++) {
    await seedCh(id, 'gta_at=NULL, energy=200, jail_until=NULL'); // clear the boost cooldown between tries
    const b = await call('POST', '/v1/garage/boost', { token: tok });
    if ((b.body.character?.cars?.length || 0) > 0) return;
  }
  assert.fail('no car boosted in 100 tries');
};
await boostUntil(garageTok, fred);
await boostUntil(pia.token, pia.id);
const carOf = async (tok) => (await meOf(tok)).cars[0].id;
const fredTune = (await call('POST', `/v1/races/tune/${await carOf(garageTok)}`, { token: garageTok })).body;
const piaTune = (await call('POST', `/v1/races/tune/${await carOf(pia.token)}`, { token: pia.token })).body;
assert.equal(fredTune.spent, RACES.TUNE_COST, 'the unschooled pay sticker');
assert.equal(piaTune.spent, Math.floor(fredTune.spent * MASTERY.PERKS.wheels.fx[1]),
  'the L25 wheelman pays the discounted rate — and the discounted number is what was charged');

// COMMERCE perk: the listing fee is discounted (deterministic — the fee is a pure formula)
await setXp(pia.id, 'commerce', masteryXpFor(40)); // L40 → the third rung
await call('POST', '/v1/market/prices', { token: pia.token }); // warm nothing — fee math is local
const buyG = await call('POST', '/v1/goods/buy', { token: pia.token, body: { goodId: 'gin', qty: 2 } });
assert.equal(buyG.code, 200, 'goods in the trunk');
const lst = await call('POST', '/v1/market', { token: pia.token, body: { kind: 'good', goodId: 'gin', qty: 2, price: 1000 } });
assert.equal(lst.code, 200, 'listed');
// the exact fee depends on LIST_FEE_MIN + broker; assert the DISCOUNT relation instead: a fresh
// unschooled seller pays more for the same listing
await seedCh(fred, "loc='docks'");
await call('POST', '/v1/goods/buy', { token: garageTok, body: { goodId: 'gin', qty: 2 } });
const lstF = await call('POST', '/v1/market', { token: garageTok, body: { kind: 'good', goodId: 'gin', qty: 2, price: 1000 } });
assert.equal(lstF.code, 200, 'fred listed too');
assert(Number(lst.body.fee) <= Number(lstF.body.fee), 'the schooled trader never pays more than the unschooled');

// THE TRAIT: gated at 50, once, permanent
assert.equal((await call('POST', '/v1/mastery/trait/wheels', { token: pia.token, body: { trait: 'virtuoso' } })).body.error,
  'level', 'no trait below the cap');
assert.equal((await call('POST', '/v1/mastery/trait/juggling', { token: pia.token, body: { trait: 'virtuoso' } })).body.error,
  'bad_track', 'no such trade');
await setXp(pia.id, 'wheels', masteryXpFor(50));
assert.equal((await call('POST', '/v1/mastery/trait/wheels', { token: pia.token, body: { trait: 'showoff' } })).body.error,
  'bad_trait', 'virtuoso or dynast only');
r = await call('POST', '/v1/mastery/trait/wheels', { token: pia.token, body: { trait: 'virtuoso' } });
assert.equal(r.code, 200, 'the die is cast');
assert.equal((await call('POST', '/v1/mastery/trait/wheels', { token: pia.token, body: { trait: 'dynast' } })).body.error,
  'chosen', 'permanent means permanent');
// VIRTUOSO deepens the perk to fx[3] — visible on the board via the same reader the till uses
r = await call('GET', '/v1/mastery', { token: pia.token });
wheels = r.body.tracks.find((t) => t.id === 'wheels');
assert.equal(wheels.perk.now, MASTERY.PERKS.wheels.fx[3], 'the Virtuoso reads the mastered rung');
assert.equal(wheels.trait, 'virtuoso', 'the trait is on the board');

// THE DYNAST: the heir keeps HALF that trade — the others keep the quarter
await setXp(pia.id, 'chemistry', masteryXpFor(50));
assert.equal((await call('POST', '/v1/mastery/trait/chemistry', { token: pia.token, body: { trait: 'dynast' } })).code,
  200, 'the cook chooses legacy');
await setXp(pia.id, 'chemistry', 1000);
await setXp(pia.id, 'larceny', 1000);
const kill2 = await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: pia.id },
  headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal(kill2.statusCode, 200, 'Pia is retired');
const pheir = await meOf(pia.token);
assert.equal(await myXp(pheir.id, 'chemistry'), Math.floor(1000 * MASTERY.TRAIT_HEIR_BPS / 10000),
  'the DYNAST trade echoes at half');
assert.equal(await myXp(pheir.id, 'larceny'), Math.floor(1000 * MASTERY.HEIR_KEEP_BPS / 10000),
  'an untraited trade still echoes at the quarter');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM character_traits WHERE character_id='${pia.id}'`)).rows[0].n),
  0, 'the traits died with the street');
assert.equal((await call('GET', '/v1/mastery', { token: pia.token })).body.tracks.find((t) => t.id === 'wheels').trait,
  null, 'the heir chooses their own legacy');

// ── §10.4: XP is not a currency — the whole system wrote ZERO ledger rows of its own ──
const xpRows = await pool.query(
  "SELECT COUNT(*) n FROM transactions WHERE reason LIKE 'mastery%' OR reason LIKE 'trade:%'");
assert.equal(Number(xpRows.rows[0].n), 0, 'no mastery reason ever touches the ledger');
const vocab = (await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `the reason vocabulary stays closed (${JSON.stringify(vocab.unknown || [])})`);

await app.close();
console.log('✅ THE TRADES test passed — step one (the ten-track board + catalog, the funnel at real hook sites with the legend mirroring every point, the level-up ding, DEATH echo at HEIR_KEEP_BPS with the legend surviving whole, the agents-excluded leaderboard) AND step two (the den STAKE FLOOR refusing min-bet XP, the milestone perk reading neutral → the exact rung on the board, the wheels perk charging the DISCOUNTED tune price at a real till, the commerce fee relation, the trait gates level/bad_track/bad_trait/chosen, the VIRTUOSO deepening to the mastered rung, the DYNAST echoing HALF that one trade while the rest echo the quarter, and traits dying with the street), plus §10.4: zero ledger rows — XP is not a currency');

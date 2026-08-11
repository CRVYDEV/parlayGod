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
// residents excluded too — a resident who wins a duel earns wetwork legend headlessly, and the
// population rule is that any step giving residents a legend excludes them on that board
const resi = await mk('Resident Rita');
await pool.query(`UPDATE account_persistent SET npc_flag=true WHERE account_id='${resi.aid}'`);
await pool.query(`INSERT INTO mastery_legend (account_id, track_id, xp) VALUES ('${resi.aid}', 'wetwork', 888888)`);
r = await call('GET', '/v1/leaderboard/trades', { token: gus.token });
assert(!r.body.trades.some((k) => k.name === 'Resident Rita'), 'residents never seat the trades board');
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
// the STRIP quotes what the till charges (the board/till mirror — a button must not lie)
r = await call('GET', '/v1/races', { token: pia.token });
assert.equal(r.body.tune.cost, piaTune.spent, 'the races board quotes the DISCOUNTED tune price');

// SEAMANSHIP: the port board quotes the refit price the dry dock will actually charge
await setXp(pia.id, 'seamanship', masteryXpFor(10)); // L10 → the first rung
const boatBuy = await call('POST', '/v1/port/boat/dinghy', { token: pia.token });
assert.equal(boatBuy.code, 200, 'a dinghy in the fleet');
r = await call('GET', '/v1/port', { token: pia.token });
const dinghy = r.body.fleet.find((b) => b.id === boatBuy.body.boat.id);
const refit = await call('POST', `/v1/port/upgrade/${dinghy.id}`, { token: pia.token, body: { part: 'hull' } });
assert.equal(refit.body.spent, dinghy.hullCost,
  'the port board quoted exactly what the refit charged (the DISCOUNTED number, both)');

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

// ══ STEP THREE — PATHS v2: six careers, home/rival XP rates, perks WITH handicaps ══
// the catalog went 3→6 through the machine-owned seam (prototype + re-extract)
assert.equal(rules.paths.length, 6, 'six careers on the board');
assert(rules.paths.some((p) => p.id === 'shadow'), 'the new careers are real ids');
// the three ORIGINALS keep their exact pre-v2 numbers — the ternary→matrix conversion is byte-identical
const M = rules.pathFx.matrix;
assert.equal(M.gun.fx.jumpAtk, 1.1, 'gun keeps its exact 1.1 street-fight edge');
assert.equal(M.gun.fx.hitEff, 1.15, 'gun keeps its exact 1.15 hit effectiveness');
assert.equal(M.ledger.fx.racketIncome, 1.1, 'ledger keeps its exact 1.1 racket income');
assert.equal(M.ledger.fx.goodsSell, 1.05, 'ledger keeps its exact 1.05 goods sale');
assert.equal(M.kitchen.add.cookQuality, 0.15, 'kitchen keeps its exact +0.15 quality');
assert.equal(M.kitchen.fx.dealHeat, 0.75, 'kitchen keeps its exact 0.75 deal heat');

// ── HOME/RIVAL XP rates apply inside the funnel (fractional XP — the NUMERIC column carries it) ──
const kim = await mk('Kitchen Kim');
await seedCh(kim.id, `respect=${10 * 4 * 4}, cash=100000, loc='docks'`); // level 5 — the path gate
r = await call('POST', '/v1/path', { token: kim.token, body: { path: 'kitchen' } });
assert.equal(r.code, 200, 'the career is declared ($10k first pick)');
jobs = 0;
for (let i = 0; i < 40 && jobs === 0; i++) {
  await seedCh(kim.id, 'nerve=100, jail_until=NULL');
  if ((await call('POST', '/v1/crimes/pick', { token: kim.token })).body.success) jobs++;
}
assert(jobs > 0, 'a clean job landed on the path');
assert.equal(await myXp(kim.id, 'larceny'), MASTERY.XP.crime * rules.pathFx.xpHome,
  'a HOME trade schools half again as fast (larceny is the Kitchen\'s)');
await seedCh(kim.id, "cash=50000, nerve=100, loc='neon', jail_until=NULL");
r = await call('POST', '/v1/casino/dice', { token: kim.token, body: { amount: MASTERY.GAMBLER_MIN_STAKE } });
assert.equal(r.code, 200, 'a real-stake play resolved');
assert.equal(await myXp(kim.id, 'gambling'), MASTERY.XP.dice * rules.pathFx.xpRival,
  'a RIVAL trade fights you (0.6 XP — fractional, never rounded to 0 or 1)');

// ── the SWITCH COOLDOWN: hopping careers between activities is rate arbitrage; a week prices it ──
await pool.query(`UPDATE account_persistent SET omr = omr + 600 WHERE account_id='${kim.aid}'`);
assert.equal((await call('POST', '/v1/path', { token: kim.token, body: { path: 'gun' } })).body.error,
  'cooldown', 'a fresh career sticks for a week — even with the $OMR in hand');
await pool.query(`UPDATE characters SET path_at = now() - interval '8 days' WHERE id='${kim.id}'`);
assert.equal((await call('POST', '/v1/path', { token: kim.token, body: { path: 'gun' } })).code,
  200, 'past the week, the paid switch works as before');

// ── the HANDICAPS bite at real tills ──
// the Gun sells goods at 0.95 (a soldier's no merchant) — same district, same day, vs a pathless twin
const plain = await mk('Pathless Pete');
await seedCh(plain.id, "cash=100000, loc='docks'");
await seedCh(kim.id, "cash=100000, loc='docks', jail_until=NULL"); // kim is The Gun now
await call('POST', '/v1/goods/buy', { token: plain.token, body: { goodId: 'gin', qty: 1 } });
await call('POST', '/v1/goods/buy', { token: kim.token, body: { goodId: 'gin', qty: 1 } });
const sellP = (await call('POST', '/v1/goods/sell', { token: plain.token, body: { goodId: 'gin', qty: 1 } })).body;
const sellG = (await call('POST', '/v1/goods/sell', { token: kim.token, body: { goodId: 'gin', qty: 1 } })).body;
const ratio = sellG.unit / sellP.unit;
assert(ratio > 0.93 && ratio < 0.97, `the Gun's handicap prices the sale (unit ratio ${ratio.toFixed(3)})`);

// the Ring pays the Doc 15% more (a brawler's medical bills) — deterministic to the dollar
const rocky = await mk('Ring Rocky');
await pool.query(`UPDATE characters SET path='ring' WHERE id='${rocky.id}'`); // the column IS the state
await seedCh(rocky.id, 'health=50, cash=100000');
r = await call('POST', '/v1/heal', { token: rocky.token });
assert.equal(r.body.cost, Math.floor(50 * 15 * M.ring.fx.healCost), 'the Ring pays exactly ×1.15 at the Doc');

// ── the Ledger's "+10% front income" — ADVERTISED since M4, real at last ──
const lex = await mk('Ledger Lex');
await pool.query(`UPDATE characters SET path='ledger' WHERE id='${lex.id}'`);
const seedFront = (id) => pool.query(
  `INSERT INTO businesses (id, character_id, kind, tier, last_collect_at, upkeep_at)
   VALUES ('biz-${id.slice(0, 8)}', '${id}', 'laundromat', 1, now() - interval '1 hour', now())`);
await seedFront(lex.id); await seedFront(plain.id);
const incL = (await call('POST', '/v1/business/collect', { token: lex.token })).body.collected;
const incP = (await call('POST', '/v1/business/collect', { token: plain.token })).body.collected;
assert(incP > 0, 'the pathless front paid');
assert(Math.abs(incL - Math.floor(incP * M.ledger.fx.frontIncome)) <= 3,
  `the Ledger collects ×1.1 on the same front (${incL} vs ${incP} — the promise the desc made since M4)`);

// ══ STEP FOUR — STATS BY USE (founder-signed fork: "yes, tightly capped") ══
// Working a trade drips its core stat under a hard rolling daily bucket. STAT_USE_P is the
// TEST-ONLY roll knob (read per-call — the LAW_BUST_P precedent).
const ula = await mk('Use-Train Ula');
const cunOf = async (id) => Number((await pool.query(`SELECT cunning c FROM characters WHERE id='${id}'`)).rows[0].c);
const pullClean = async (who) => { // one clean job (larceny — stat: cunning), retried past busts
  for (let i = 0; i < 60; i++) {
    await seedCh(who.id, 'nerve=100, jail_until=NULL');
    const res = await call('POST', '/v1/crimes/pick', { token: who.token });
    if (res.body.success) return res.body;
  }
  throw new Error('no clean job in 60 tries');
};

process.env.STAT_USE_P = '1'; // pin the roll — every clean job builds until the bucket is dry
const cun0 = await cunOf(ula.id);
await pullClean(ula);
assert.equal(await cunOf(ula.id), cun0 + 1, 'working the trade built its stat (+1 cunning on a clean job)');
const rngRow = await pool.query(
  `SELECT outcome FROM rng_audit WHERE character_id='${ula.id}' AND action='statuse:larceny'`);
assert(rngRow.rows.length >= 1 && rngRow.rows[0].outcome.includes('+1 cunning'), 'the use-roll is rng-audited');
assert(Number((await pool.query(`SELECT statuse_used u FROM characters WHERE id='${ula.id}'`)).rows[0].u) >= 1,
  'the daily bucket charged');

// the HARD CAP: two more gains fill the CAP_DAY (3) bucket; the next clean job builds NOTHING
await pullClean(ula); await pullClean(ula);
assert.equal(await cunOf(ula.id), cun0 + MASTERY.STAT_USE.CAP_DAY, 'the bucket holds exactly CAP_DAY gains');
await pullClean(ula);
assert.equal(await cunOf(ula.id), cun0 + MASTERY.STAT_USE.CAP_DAY,
  'a spent bucket grants NOTHING — the hard daily ceiling (the gym stays the fast lane)');

// the board surfaces the headroom off the SAME rolling math the drip charges against
r = await call('GET', '/v1/mastery', { token: ula.token });
assert.equal(r.body.statUse.capDay, MASTERY.STAT_USE.CAP_DAY, 'the cap is on the board');
assert(r.body.statUse.left < 1, `a spent bucket reads ~0 left (${r.body.statUse.left})`);

// the ROLLING REFILL: a day later the full allowance is back and the drip grants again
await seedCh(ula.id, "statuse_at = now() - interval '1 day'");
r = await call('GET', '/v1/mastery', { token: ula.token });
assert.equal(r.body.statUse.left, MASTERY.STAT_USE.CAP_DAY, 'a day of refill restores the full allowance');
const cunR = await cunOf(ula.id);
await pullClean(ula);
assert.equal(await cunOf(ula.id), cunR + 1, 'the refilled bucket grants again');

// pinned to ZERO: the roll still happens (audited) but nothing lands — a roll, not a salary
process.env.STAT_USE_P = '0';
const cunZ = await cunOf(ula.id);
await pullClean(ula);
assert.equal(await cunOf(ula.id), cunZ, 'P=0 → no gain (the drip is a chance, never a grant)');
delete process.env.STAT_USE_P;

// ══ F6 — THE TRADES ON THE SHEET (omerta-early-game-design.md) ══
// The full board is GET /v1/mastery; the character view carries a compact twin so a screen can
// show "this job is schooling you" without a second round trip. Both are computed from the SAME
// helpers, so the two must AGREE — that is the whole property worth asserting.
const board = (await call('GET', '/v1/mastery', { token: ula.token })).body;
const sheet = await meOf(ula.token);
assert(Array.isArray(sheet.trades) && sheet.trades.length === MASTERY.TRACKS.length,
  'the sheet carries every track');
for (const t of board.tracks) {
  const s = sheet.trades.find((x) => x.id === t.id);
  assert(s, `the sheet carries ${t.id}`);
  assert.equal(s.xp, t.xp, `${t.id} xp agrees with the board`);
  assert.equal(s.lvl, t.lvl, `${t.id} level agrees with the board`);
  assert.equal(s.rank, t.rank, `${t.id} rank agrees with the board`);
  assert.equal(s.nextAt, t.nextAt, `${t.id} next-level threshold agrees with the board`);
}
// the bar measures progress THROUGH the current level, not from zero — sit a character EXACTLY on
// a level threshold and it must read 0%, or every bar in the game is wrong by a level's width
await pool.query(`UPDATE masteries SET xp=$1 WHERE character_id=$2 AND track_id='larceny'`,
  [masteryXpFor(5), ula.id]);
let s5 = (await meOf(ula.token)).trades.find((x) => x.id === 'larceny');
assert.equal(s5.lvl, 5, 'seeded exactly onto level 5');
assert.equal(s5.pct, 0, `a fresh level reads 0% through it (got ${s5.pct})`);
// halfway between 5 and 6 reads ~50%
await pool.query(`UPDATE masteries SET xp=$1 WHERE character_id=$2 AND track_id='larceny'`,
  [Math.round((masteryXpFor(5) + masteryXpFor(6)) / 2), ula.id]);
s5 = (await meOf(ula.token)).trades.find((x) => x.id === 'larceny');
assert(Math.abs(s5.pct - 50) <= 1, `halfway reads ~50% (got ${s5.pct})`);
// the perk the bar is climbing toward: the NEXT milestone, and what it pays
assert.equal(s5.perkNextAt, MASTERY.MILESTONES.find((m) => m > 5),
  'the sheet names the next milestone that deepens the perk');
assert.equal(s5.perkWhat, MASTERY.PERKS.larceny.what, 'and what that perk actually does');

// (the coach rung this feeds is walked in test/growth.js, where the ladder above it is cleared
// in order — a rung asserted in isolation cannot show that it is reachable.)

// ── §10.4: XP is not a currency — the whole system wrote ZERO ledger rows of its own ──
const xpRows = await pool.query(
  "SELECT COUNT(*) n FROM transactions WHERE reason LIKE 'mastery%' OR reason LIKE 'trade:%'");
assert.equal(Number(xpRows.rows[0].n), 0, 'no mastery reason ever touches the ledger');
const vocab = (await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `the reason vocabulary stays closed (${JSON.stringify(vocab.unknown || [])})`);

await app.close();
console.log('✅ THE TRADES test passed — step one (the ten-track board + catalog, the funnel at real hook sites with the legend mirroring every point, the level-up ding, DEATH echo at HEIR_KEEP_BPS with the legend surviving whole, the agents-excluded leaderboard) AND step two (the den STAKE FLOOR refusing min-bet XP, the milestone perk reading neutral → the exact rung on the board, the wheels perk charging the DISCOUNTED tune price at a real till, the commerce fee relation, the trait gates level/bad_track/bad_trait/chosen, the VIRTUOSO deepening to the mastered rung, the DYNAST echoing HALF that one trade while the rest echo the quarter, and traits dying with the street) AND step four (STATS BY USE: a clean job builds +1 cunning rng-audited, the CAP_DAY bucket fills then grants NOTHING, the board headroom reads the same rolling math, a day of refill restores the allowance, P=0 lands nothing), plus §10.4: zero ledger rows — XP is not a currency');

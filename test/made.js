// THE FLOAT (economy v3 step 5) — THE MADE MAN, the tiered loot rate and the access stake.
// The 63rd suite. Design §5 (the holding problem), §11.1, §11.2, §11.5.
//
// The step exists because of one sentence: **a consumable you should never HOLD cannot be the loot
// that makes killing worth it.** So the assertions are aimed at the ways that could fail rather than
// at the happy path:
//
//   (1) THE DUES BUY POWER. The line that keeps the game free is that operating costs stay in CASH
//       and a subscription gates no earning loop's strength. The pad-pays-itself convenience is the
//       one that could drift: it must deduct the SAME cash and write the SAME ledger row, or it has
//       quietly become a discount.
//   (2) THE SINK DESTROYS SUPPLY. Since step 2 a sink hands its $OMR to the desk. A new sink that
//       forgets to recycle silently shrinks the shelf the auction sells from.
//   (3) THE FLOAT IS STILL SAFE SOMEWHERE. Staking used to be a safe harbour and §4.1 admits no
//       fourth way for $OMR to move, so "committed" has to mean CHEAPER, never FREE.
//
// pg-mem, zero infra. SQL-granting $OMR is an unledgered mint (the estate/portfolio precedent), so
// the $OMR-conservation DRIFT stays exactly the grant — which is what proves `made:dues` reconciles.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { MADE, MADE_LADDER, madeRungIdx, ACCESS_STAKE, CASINO, DESK, recyclesToDesk, estateTierOf, SPEAKEASY,
  BUSINESSES, PACING, businessTierOf, isMade, MISSIONS, CONSTANTS, CARS, TRIMS, MINT_TRANCHES,
  mintTierOf } from '../src/rules.js';
import { upkeepBps } from '../src/business.js';
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
const seed = (id, sql) => pool.query(`UPDATE characters SET ${sql} WHERE id='${id}'`);
const grantOmr = (id, n) => pool.query(
  `UPDATE account_persistent SET omr = omr + ${n} WHERE account_id=(SELECT account_id FROM characters WHERE id='${id}')`);
const shelf = async () => Number((await pool.query('SELECT balance FROM desk_inventory WHERE id=1')).rows[0].balance);
const rowsOf = async (id, reason) => (await pool.query(   // account-scoped ($OMR rides the account)
  `SELECT amount FROM transactions WHERE account_id=(SELECT account_id FROM characters WHERE id='${id}') AND reason=$1`, [reason])).rows;
const charRowsOf = async (id, reason) => (await pool.query( // character-scoped (cash rides the street)
  `SELECT amount FROM transactions WHERE character_id=$1 AND reason=$2`, [id, reason])).rows;
const lvlRespect = (lvl) => Math.ceil(Math.pow(lvl - 1, 2) * PACING.LEVEL_DIVISOR);
let grantDrift = 0;

// ═══════════════ 1. THE CLASSIFICATION — the dues are a sink, and sinks recycle ═══════════════
assert(DESK.SINK_REASONS.some((p) => p === 'made:%'), "the dues are in the SINGLE sink list (so the burn term and the desk feed can't drift apart)");
assert(recyclesToDesk('made:dues'), 'a dues payment RECYCLES to the desk — since step 2 a sink hands the token over rather than destroying it');

// ═══════════════ 2. THE BOARD, AND PAYING THE DUES ═══════════════
const don = await mk('Don Dues');
let r = await call('GET', '/v1/made', { token: don.token });
assert.equal(r.code, 200, 'the board is readable by anyone');
assert.equal(r.body.made, false, 'a nobody is not made');
assert.equal(r.body.dues, MADE.OMR, 'the price is published');
assert.equal(r.body.days, Math.round(MADE.MS / 86400000), 'and the window it buys');
assert(r.body.opens.length >= 4, 'the board states what standing opens');
// §4.3 is retired (founder, 2026-08-02): the claim is no longer "no advantage" but "a reachable
// ceiling", and the copy has to say the true one. Pinned so a revert to the old wording fails here.
assert(!('buysNoPower' in r.body), 'the retired no-power claim is GONE from the board, not left to rot');
assert(/ceiling/i.test(r.body.buysPower), 'the board makes the CEILING claim instead');
assert(/fight/i.test(r.body.buysPower), 'and says plainly that none of it helps you fight');
assert.equal(r.body.ceiling.topRung, MADE_LADDER.RUNGS[MADE_LADDER.RUNGS.length - 1].min, 'the ceiling is published as a number');

assert.equal((await call('POST', '/v1/made', { token: don.token })).body.error, 'omr', 'you cannot be made on credit');
await grantOmr(don.id, MADE.OMR * 5); grantDrift += MADE.OMR * 5;
const shelfPre = await shelf();
r = await call('POST', '/v1/made', { token: don.token });
assert.equal(r.code, 200, 'the dues are paid');
assert.equal(r.body.made, true, "you're made");
assert.equal((await meOf(don.token)).omr, MADE.OMR * 5 - MADE.OMR, 'the burn debited exactly the dues');
assert.equal((await meOf(don.token)).made, true, 'and the badge is on the sheet');
assert(Math.abs((await meOf(don.token)).madeSeconds - MADE.MS / 1000) < 60, 'the window is the full term');
// the sink half: ledgered, and handed to the desk rather than destroyed
const duesRows = await rowsOf(don.id, 'made:dues');
assert.equal(duesRows.length, 1, 'one ledgered dues row');
assert.equal(Number(duesRows[0].amount), -MADE.OMR, 'a negative $OMR row — a burn, not a transfer to a player');
assert.equal(await shelf() - shelfPre, MADE.OMR, 'and the whole of it landed on the DESK SHELF (step 2) to be sold again');

// ── re-paying EXTENDS from the current end, it does not reset the clock ──
const endBefore = (await meOf(don.token)).madeSeconds;
r = await call('POST', '/v1/made', { token: don.token });
assert.equal(r.code, 200, 'a second month is fine');
const endAfter = (await meOf(don.token)).madeSeconds;
assert(endAfter > endBefore + MADE.MS / 1000 - 60, 'the second term stacks ON the first (later-of(now, end)) — paying early never burns the window you own');
assert.equal((await meOf(don.token)).omr, MADE.OMR * 5 - 2 * MADE.OMR, 'twice the dues');

// ═══════════════ 3. WHAT THE DUES OPEN — status and access, never power ═══════════════
// (a) THE UPPER COMPOUND. The estate is display-only, so this is status gating status.
const nobody = await mk('Nick Nobody');
// enough for every tier up to and including the gated one, read off the ladder
const ESTATE_NEED = Array.from({ length: MADE.ESTATE_TIER }, (_, i) => estateTierOf(i + 1).omr).reduce((a, b) => a + b, 0);
await grantOmr(nobody.id, ESTATE_NEED); grantDrift += ESTATE_NEED;
for (let t = 1; t < MADE.ESTATE_TIER; t++) {
  assert.equal((await call('POST', '/v1/estate/upgrade', { token: nobody.token })).code, 200,
    `tier ${t} is open to everyone — the lower compound is not a paywall`);
}
r = await call('POST', '/v1/estate/upgrade', { token: nobody.token });
assert.equal(r.body.error, 'made', `the ${estateTierOf(MADE.ESTATE_TIER).name} needs standing`);
await pool.query(`UPDATE account_persistent SET made_until = now() + interval '30 days' WHERE account_id=(SELECT account_id FROM characters WHERE id='${nobody.id}')`);
assert.equal((await call('POST', '/v1/estate/upgrade', { token: nobody.token })).body.tier, MADE.ESTATE_TIER, 'made — the upper compound opens');

// (b) A HOUSE OF YOUR OWN — GATED AGAIN. D8=C had retired this on the reasoning that a club EARNS;
// the founder then retired §4.3 itself and answered D8=D, so the gate is back. Asserted from BOTH
// sides, because "an unmade man is refused" and "a made man gets in" can each pass alone while the
// gate is broken in the other direction.
const host = await mk('Hank Hostess');
await seed(host.id, `respect=${lvlRespect(SPEAKEASY.MIN_LEVEL + 2)}, cash=${SPEAKEASY.OPEN_COST + 1000}`);
assert.equal(isMade((await pool.query(
  `SELECT * FROM account_persistent WHERE account_id=(SELECT account_id FROM characters WHERE id='${host.id}')`)).rows[0]),
false, 'Hank has never paid a dollar of dues');
assert.equal((await call('POST', '/v1/speakeasy/neon/open', { token: host.token })).body.error, 'made',
  'so the room will not hand him a house — level and cash are not enough');
await pool.query(`UPDATE account_persistent SET made_until = now() + interval '30 days' WHERE account_id=(SELECT account_id FROM characters WHERE id='${host.id}')`);
assert.equal((await call('POST', '/v1/speakeasy/neon/open', { token: host.token })).code, 200,
  'and the moment he is made, the door opens — the same level, the same cash');

// ═══════════════ 4. THE PAD PAYS ITSELF — and it is TIME, not POWER ═══════════════
// The one convenience that could quietly become a discount. A made owner's fronts settle their own
// upkeep on a touch — the SAME cash, the SAME ledger row. What is bought is not having to remember.
const kind = BUSINESSES[0].kind;
const tier1 = businessTierOf(kind, 1);
const mkOwner = async (name) => {
  const c = await mk(name);
  await seed(c.id, `respect=${lvlRespect(BUSINESSES[0].lvl + 2)}, cash=${tier1.cost * 3}`);
  assert.equal((await call('POST', `/v1/business/${kind}/buy`, { token: c.token })).code, 200, `${name} bought a front`);
  // run the clocks back so there is real income AND a real pad owed
  // The income clock is backdated PAST `BUSINESS_CAP_MS` (24h) on purpose: `collectBusiness` takes
  // `min(elapsed, CAP)`, so both owners bank exactly the capped 24h and the comparison below is
  // deterministic BY CONSTRUCTION. Backdating both to 6h looked equivalent and was not — each front's
  // elapsed runs to the moment of ITS OWN collect, so the two windows differ by the wall-clock gap
  // between the two owners being created and the two calls landing, and under load (the full suite,
  // not a lone file) that gap crosses a whole-dollar boundary and the incomes differ by $1. The
  // assertion is untouched; what changed is that its precondition is now guaranteed rather than
  // usually true. The PAD clock stays at 6h — it is a separate column, and `owed6h` is what it prices.
  await pool.query(`UPDATE businesses SET last_collect_at = now() - interval '48 hours', upkeep_at = now() - interval '6 hours' WHERE character_id='${c.id}'`);
  return c;
};
const owed6h = Math.floor(tier1.incomePerHr * (upkeepBps(1) / 10000) * 6);
const free = await mkOwner('Freddy Free');
const paid = await mkOwner('Paulie Paid');
await pool.query(`UPDATE account_persistent SET made_until = now() + interval '30 days' WHERE account_id=(SELECT account_id FROM characters WHERE id='${paid.id}')`);

const freeCollect = await call('POST', '/v1/business/collect', { token: free.token });
assert.equal(freeCollect.code, 200, 'the free man collects');
assert.equal(freeCollect.body.padPaid, undefined, "…and nobody paid his pad for him — it is still owed");
assert.equal((await charRowsOf(free.id, 'business:upkeep')).length, 0, 'no upkeep row on a free collect');

const paidCollect = await call('POST', '/v1/business/collect', { token: paid.token });
assert.equal(paidCollect.code, 200, 'the made man collects');
assert.equal(paidCollect.body.padPaid, owed6h, 'the pad settled itself out of his pocket, to the dollar');
const padRows = await charRowsOf(paid.id, 'business:upkeep');
assert.equal(padRows.length, 1, 'and it is a REAL ledgered sink — the same row the manual route writes');
assert.equal(Number(padRows[0].amount), -owed6h, 'the same amount, NOT discounted — this is TIME, not POWER');
assert.equal(paidCollect.body.collected, freeCollect.body.collected,
  'and the INCOME is identical: standing changes who has to remember the pad, not what a front earns');

// ═══════════════ 5. THE ACCESS STAKE — BACK, and BOTH conditions are asserted ═══════════════════
// D8=D restored it. The table wants LEVEL **and** a HELD stake, and the AND is the point: OR would
// let a level-30 player sit down holding nothing, so the only players who ever staked would be the
// ones with the least $OMR and the float would be worth nothing. Both directions are asserted,
// because either half can pass alone while the gate is broken in the other.
const whale = await mk('Wally Whale');
await seed(whale.id, `respect=${lvlRespect(CASINO.HIGH_LVL + 5)}, cash=5000000, nerve=50, loc='${CASINO.DISTRICT}'`);
const overTable = CASINO.MAX_BET + 1000;
assert.equal((await meOf(whale.token)).omr, 0, 'Wally holds no $OMR at all');
r = await call('POST', '/v1/casino/dice', { token: whale.token, body: { amount: overTable } });
assert.equal(r.body.error, 'max', 'level alone does NOT open the big table — the stake is the other half');
// stake it (an ordinary in-game move, no new schema — the stake rides the existing bucket)
await grantOmr(whale.id, ACCESS_STAKE.HIGH_OMR); grantDrift += ACCESS_STAKE.HIGH_OMR;
assert.equal((await call('POST', '/v1/stake', { token: whale.token, body: { amount: ACCESS_STAKE.HIGH_OMR } })).code, 200, 'he stakes the seat money');
r = await call('POST', '/v1/casino/dice', { token: whale.token, body: { amount: overTable } });
assert.equal(r.code, 200, 'and NOW the high-stakes room opens — level AND a held stake');
// the board publishes BOTH conditions, so the client renders terms rather than guessing
const den = (await call('GET', '/v1/casino', { token: whale.token })).body;
assert.equal(den.dice.highStakes.level, CASINO.HIGH_LVL, 'the board publishes the level the table wants');
assert.equal(den.dice.highStakes.stakeOmr, ACCESS_STAKE.HIGH_OMR, 'and the stake it wants');
assert.equal(den.dice.highStakes.stakeMet, true, 'and whether this player meets it');

// ═══════════════ 5b. THE LADDER — power for HOLDING, and a CEILING that is reachable free ════════
// §4.3 is retired, so this is the first place $OMR buys real power. Three properties, each of which
// could fail on its own:
//   (i)   the perks LAND — a rung has to change the number the game actually enforces, not just a board
//   (ii)  dues are a SHORTCUT, never a gate — the ladder keys on held $OMR, and being made climbs it
//   (iii) THE CEILING IS REACHABLE WITHOUT PAYING — the claim the player-facing copy now makes
const top = MADE_LADDER.RUNGS[MADE_LADDER.RUNGS.length - 1];

// (iii) first, because it is the claim and it is pinned against the LIVE mission table rather than a
// remembered figure: retune either the ladder or the $OMR missions and this fails by name.
const freeOmrLifetime = MISSIONS.reduce((n, m) => n + Number(m.reward?.omr || 0), 0);
assert(freeOmrLifetime >= top.min,
  `the top rung (${top.min}) is reachable on mission $OMR alone (${freeOmrLifetime} lifetime) — the CEILING claim in the copy is TRUE`);

// ═══ THE TRANCHE SCHEDULE (dynasty §10 Shape D) — the two row-level laws, pinned here beside the
// free-path computation they depend on. (1) THE FREE-PATH LAW: no published row's $OMR price may
// reach what the mission ladder pays lifetime, or "you can get made for free" silently dies at
// that tier — asserted against the LIVE mission table, so retuning either side fails by name.
// (2) THE LOCKSTEP LAW as a table constraint: one implied $OMR/ETH rate per row, every row — the
// effective price is the CHEAPER rail, so a row that broke rank would silently become the real
// price. Plus the shape: thresholds strictly increasing (mintTierOf's findIndex depends on it).
{
  // (1) THE FREE PATH, asserted at its MECHANISM rather than through a price proxy. This used to
  // read "the dearest published $OMR price stays under the mission ladder's lifetime payout", which
  // held only while the $OMR rail was mispriced at ~1/69th of the ETH fee. Priced correctly against
  // the genesis rate a wave-1 mint is ~2,471 $OMR against ~220 lifetime earnable, so NO amount of
  // playing buys a mint through the PLEX rail — and the promise survives anyway, because the
  // mission GRANTS the credit outright. That is the thing to pin: the proxy was always a stand-in
  // for this, and it silently stopped tracking it the moment the rail was priced honestly.
  const freeMint = MISSIONS.find((m) => Number(m.reward?.mintCredit) > 0);
  assert(freeMint, 'a mission grants a mint credit outright — the free path cannot depend on the '
    + `$OMR rail, which at the genesis rate prices a wave-1 mint at ${MINT_TRANCHES[0].omr} $OMR `
    + `against ~${freeOmrLifetime} lifetime earnable`);
  assert(freeMint.req?.lvl > 0 && freeMint.req.lvl <= 20,
    `the free mint is reachable early (${freeMint.name} at level ${freeMint.req?.lvl}) — a credit `
    + 'gated past the mid-game is not a path a new player can walk');

  // (2) ONE RAIL. The schedule is ETH and only ETH: no row may carry a $OMR price, because the mint
  // has no $OMR rail. This is the lockstep law's successor and it is strictly stronger — two rails
  // can drift and have to be checked; one cannot. Minting is the Sybil bound, so it is the price
  // that must never be ambiguous.
  for (const t of MINT_TRANCHES) {
    assert.equal(t.omr, undefined,
      `tranche row through=${t.through} carries NO $OMR price — the mint is ETH only, and a second rail is always priced by whichever side is cheaper`);
    assert(t.eth > 0, `tranche row through=${t.through} has an ETH price`);
  }
  for (let i = 1; i < MINT_TRANCHES.length; i++)
    assert(MINT_TRANCHES[i].through > MINT_TRANCHES[i - 1].through,
      'tranche thresholds are strictly increasing — mintTierOf depends on it');

  // (3) THE CEILING (founder-directed 2026-08-10: "cap it at 5 waves so by wave 5 the maximum mint
  // price anyone can pay would be .05"). The cap is the whole reason the schedule reads as a
  // founding-era discount rather than an escalator, and it is what makes the free-path law
  // structural instead of arithmetic that must be re-checked at every extension. It is only true
  // if the flat tail holds the LAST row — so assert the promise directly, at a count far past the
  // published table, in the terms a player would state it: nobody ever pays more than this.
  const CEILING_ETH = 0.05;
  const last = MINT_TRANCHES[MINT_TRANCHES.length - 1];
  assert.equal(last.eth, CEILING_ETH,
    `the published table's dearest row IS the ceiling (${CEILING_ETH} ETH) — raising it is a new promise, not a retune`);
  for (const t of MINT_TRANCHES)
    assert(t.eth <= CEILING_ETH, `tranche row through=${t.through} is at or under the ${CEILING_ETH} ETH ceiling`);
  const beyond = mintTierOf(last.through * 10);
  assert.equal(beyond.flat, true, 'past the published table the schedule is flat, not extrapolated');
  assert.equal(beyond.eth, CEILING_ETH,
    `the millionth identity still pays the ceiling (${CEILING_ETH} ETH) — the flat tail is what makes "the most anyone ever pays" true`);
  assert.equal(beyond.omr, undefined, 'and there is still no $OMR rail in the tail');
}

// (ii) the shortcut: identical stakes, one made, and the made man reads exactly MADE_RUNGS higher
const climber = await mk('Cassie Climber');
await grantOmr(climber.id, MADE_LADDER.RUNGS[1].min); grantDrift += MADE_LADDER.RUNGS[1].min;
await call('POST', '/v1/stake', { token: climber.token, body: { amount: MADE_LADDER.RUNGS[1].min } });
const acctOf = async (id) => (await pool.query(
  `SELECT * FROM account_persistent WHERE account_id=(SELECT account_id FROM characters WHERE id='${id}')`)).rows[0];
const plainIdx = madeRungIdx(await acctOf(climber.id));
assert.equal(plainIdx, 1, 'holding the second rung reads as the second rung');
await pool.query(`UPDATE account_persistent SET made_until = now() + interval '30 days' WHERE account_id=(SELECT account_id FROM characters WHERE id='${climber.id}')`);
// The lever is pinned SEPARATELY from the observation, because comparing the climb to MADE_RUNGS
// alone is vacuous — zero the lever and both sides agree. (Caught by mutation: M2 survived the first
// cut of this assertion. Same shape as the LEVEL_UP_REFILL_MAX_DAY > 0 pin.)
assert(MADE_LADDER.MADE_RUNGS >= 1,
  'dues climb the ladder AT ALL — MADE_RUNGS 0 makes the subscription powerless again, which is D8=C, not D8=D');
const madeIdx = madeRungIdx(await acctOf(climber.id));
assert(madeIdx > plainIdx, 'being made really climbs — the SAME held stake reads higher once the dues are paid');
assert.equal(madeIdx, plainIdx + MADE_LADDER.MADE_RUNGS, '…by exactly MADE_RUNGS — a shortcut on the same ladder');
// the shortcut can never raise the TOP: a made man at the top rung is still at the top.
// (staked through the REAL route, not SQL — an SQL bump would fabricate $OMR and the conservation
// check at the end of this file catches it, which is exactly what it did the first time.)
const need = top.min - MADE_LADDER.RUNGS[1].min;
await grantOmr(climber.id, need); grantDrift += need;
await call('POST', '/v1/stake', { token: climber.token, body: { amount: need } });
assert.equal(madeRungIdx(await acctOf(climber.id)), MADE_LADDER.RUNGS.length - 1,
  'and it clamps at the top — dues get you there sooner and for less held, NEVER higher');

// (i) the perks land where the game enforces them, not merely on a board
const holder = await mk('Holly Holder');
const plainSheet = await meOf(holder.token);
await grantOmr(holder.id, top.min); grantDrift += top.min;
await call('POST', '/v1/stake', { token: holder.token, body: { amount: top.min } });
const ladSheet = await meOf(holder.token);
assert.equal(ladSheet.ladder.rung, MADE_LADDER.RUNGS.length, 'the sheet reads the top rung');
assert.equal(ladSheet.ladder.name, top.name, 'by name');
assert.equal(ladSheet.cargoCap - plainSheet.cargoCap, top.trunk, 'the trunk really grew by the rung — the sheet mirrors trunkCap()');
assert.equal(ladSheet.maxEnergy - plainSheet.maxEnergy, top.energy, 'the energy CAP grew by the rung');
assert.equal(ladSheet.maxNerve - plainSheet.maxNerve, top.nerve, 'and the nerve cap');

// the fence edge, measured at a real till against an identical twin car (carVal is deterministic
// per model/trim, so two identical cars price identically and the ONLY difference is the ladder)
// a car with real value, so the fence delta is a number worth asserting rather than rounding noise
const car = [...CARS].sort((a, b) => b.val - a.val)[Math.floor(CARS.length / 2)];
const trim = TRIMS.find((t) => t.val === 1) || TRIMS[0];
const twin = await mk('Terry Twin');
const putCar = (cid) => pool.query(
  `INSERT INTO cars (id, character_id, model_id, trim_id, dmg) VALUES ('${cid}-car','${cid}','${car.id}','${trim.id}',0)`);
await putCar(twin.id); await putCar(holder.id);
const twinFence = await call('POST', `/v1/garage/${twin.id}-car/fence`, { token: twin.token });
const ladFence = await call('POST', `/v1/garage/${holder.id}-car/fence`, { token: holder.token });
assert.equal(twinFence.code, 200, 'the unstaked man fences his car');
assert.equal(ladFence.code, 200, 'and so does the top-rung man');
// ±1: the server floors ONCE over the whole chain while this expectation floors the twin's gross and
// then scales it, so a single-dollar rounding gap is arithmetic, not a mechanic. A dropped multiplier
// is a ~5% miss, which this still catches by a wide margin.
assert(Math.abs(ladFence.body.gross - Math.floor(twinFence.body.gross * (1 + top.fenceBps / 10000))) <= 1,
  `the top rung really pays ${top.fenceBps}bps more on the SAME car (${twinFence.body.gross} -> ${ladFence.body.gross}) — the one economic edge, on an ACTIVE loop`);
assert(top.fenceBps > 0, 'and the top rung HAS an economic edge (D8=D) — a capacity-only ladder is D8=C');

// the garage cap: seed the plain limit and check WHO is refused
const parked = (cid, n) => Promise.all([...Array(n)].map((_, i) => pool.query(
  `INSERT INTO cars (id, character_id, model_id, trim_id, dmg) VALUES ('${cid}-p${i}','${cid}','${car.id}','${trim.id}',0)`)));
await parked(twin.id, CONSTANTS.GARAGE_CAP); await parked(holder.id, CONSTANTS.GARAGE_CAP);
await seed(twin.id, 'energy=100, gta_at=NULL'); await seed(holder.id, 'energy=100, gta_at=NULL');
assert.equal((await call('POST', '/v1/garage/boost', { token: twin.token })).body.error, 'full',
  'a full garage refuses the unstaked man');
assert.notEqual((await call('POST', '/v1/garage/boost', { token: holder.token })).body.error, 'full',
  'and the ladder really parks more iron — the same fleet is not full for him');

// ═══════════════ 6. §10.4 — the vocabulary is closed and the dues reconcile ═══════════════
const inv = await runLedgerInvariants(pool, { alert: false });
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `every reason is enumerated: ${JSON.stringify(vocab)}`);
const cons = inv.checks.find((c) => c.name === '$OMR conservation');
assert.equal(cons.drift, grantDrift,
  `$OMR conservation drift is EXACTLY the unledgered SQL grants (${grantDrift}) — so made:dues reconciles as a burn, and its desk:recycle partner cancels inside the same term`);
const deskBacked = inv.checks.find((c) => c.name === 'desk inventory backed');
assert(deskBacked.ok, `the shelf still reconciles with the dues on it: ${JSON.stringify(deskBacked)}`);

await app.close();
console.log('✅ THE FLOAT + THE LADDER (economy v3 step 5, D8=D) test passed — the dues are a classified sink that RECYCLES to the desk, the board publishes the price/term/gates and makes the CEILING claim instead of the retired no-power one, the burn is exact and the window extends from later-of(now, end), both ACCESS gates are back and asserted from BOTH sides (an unmade man is refused a club then admitted the moment he pays; level alone will not seat a whale at the big table until he HOLDS the stake), THE PAD PAYS ITSELF still deducts the same cash for the same income (TIME, never a discount), and THE LADDER is real — the top rung grows the trunk/energy/nerve caps and the garage and pays its fence edge at a real till against an identical twin car, dues climb it by exactly MADE_RUNGS and CLAMP at the top so paying is a shortcut and never a higher ceiling, and the ceiling itself is pinned against the LIVE mission table so the copy\'s claim stays true through any retune — and §10.4 holds, vocabulary closed, drift == the SQL grants only');

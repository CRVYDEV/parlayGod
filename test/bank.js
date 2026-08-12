// THE CITY LEG — the Bank's profit buys $OMR and the players who PLAY receive it.
// (`omerta-bank-protocol-design.md` §4.1–§4.3; `src/bank.js`.)
//
// The assertions here are aimed at the four ways this could go wrong, not at the happy path:
//
//   (1) THE SPLIT PAYS. The distribution is pro-rata LINEAR and UNCAPPED, and that is not a
//       preference — this project already measured and paid for the alternative (BALANCE.md § THE
//       FARM: the Street Wage's `WAGE_CAP_OMR` was commented "anti-Sybil" and did the opposite).
//       A cap is CONCAVE, and a concave payout means splitting one player's effort across N
//       accounts EARNS MORE than keeping it on one. So the centrepiece assertion is that splitting
//       gains exactly nothing — the property an added cap would silently break, which is precisely
//       why it is asserted rather than described.
//   (2) SUPPLY IS FABRICATED. `prize:omr` is a MINT, backed by `fundReserve` — the assertion "hard
//       $OMR arrived". A comp/QA buy that credited the pool would let the server sign a real
//       withdrawal against backing that does not exist.
//   (3) MORE GOES OUT THAN CAME IN. RULE 1 (`Σ distributed ≤ Σ bought`) is the wall; everything
//       else in the runner is books.
//   (4) THE WINDOW IS CONSUMED FOR NOTHING. `UNIQUE (start_day, end_day)` means an epoch row is
//       that day's only chance, so a sweep landing before the day's buy must not close it empty.
//
// pg-mem, zero infra.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { buildServer } from '../src/server.js';
import { ACTIVITY, activityScore, dayOf } from '../src/rules.js';
import * as Bank from '../src/bank.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { runVigInvariants } from '../src/vig.js';

const round6 = (n) => Math.round(n * 1e6) / 1e6;

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body, mod } = {}) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (mod) headers['x-mod-key'] = 'test-mod-key';
  const res = await app.inject({ method, url, headers, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  const { body: ch } = await call('POST', '/v1/character', { token, body: { name } });
  const acct = (await pool.query(
    'SELECT account_id FROM characters WHERE id=$1', [ch.character?.id || ch.id])).rows[0].account_id;
  return { token, acct };
};
// Activity is a COUNTER, not a currency — no ledger row exists for it and none should, so seeding it
// directly is seeding the same thing `bumpMastery` writes rather than working around a rail.
const played = async (acct, gains, day = dayOf()) => {
  for (const [tag, n] of Object.entries(gains)) {
    await pool.query('INSERT INTO activity_log (account_id, day, tag, n) VALUES ($1,$2,$3,$4)',
      [acct, day, tag, n]);
  }
};
const revenue = async (amount, asset = 'USDC') =>
  pool.query('INSERT INTO bank_revenue (source, ref, asset, amount, tx_hash, real) VALUES ($1,$2,$3,$4,$5,true)',
    ['harvest', crypto.randomUUID(), asset, amount, '0x' + crypto.randomUUID().replace(/-/g, '')]);
const bookOf = async () => (await pool.query('SELECT * FROM bank_city_pool WHERE id=1')).rows[0] || {};
const omrOf = async (acct) =>
  Number((await pool.query('SELECT omr FROM account_persistent WHERE account_id=$1', [acct])).rows[0].omr);
const paidTo = async (acct) => Number((await pool.query(
  'SELECT COALESCE(SUM(omr),0) s FROM bank_payouts WHERE account_id=$1', [acct])).rows[0].s);
const checkOf = async (runner, name) => {
  const r = await runner(pool);
  const c = r.checks.find((x) => x.name === name);
  assert(c, `the "${name}" check exists`);
  return c;
};

// ── THE CENTREPIECE: SPLITTING GAINS NOTHING ────────────────────────────────────────────────────
// One player's effort, run two ways over the same pool: all on one account, or split evenly across
// three. Linear pro-rata means the two totals are IDENTICAL to the last unit. A per-account cap —
// the "anti-Sybil" instinct — makes the split strictly better, which is the whole finding.
//
// Both runs use their own day, so the two windows are independent epochs over the same pool size.
{
  const solo = await mk('Whole Hog Hogan');
  const a = await mk('Split A'); const b = await mk('Split B'); const c = await mk('Split C');

  // The same work either way: 3 tracks × 9 actions, once whole and once cut in three.
  const WHOLE = { crime: 9, jump: 9, cards: 9 };
  const THIRD = { crime: 3, jump: 3, cards: 3 };
  assert.equal(activityScore(WHOLE), activityScore(THIRD) * 3,
    'precondition: the split really is the same effort — three thirds sum to the whole');

  const dSolo = dayOf() - 30;
  const dSplit = dayOf() - 29;
  await played(solo.acct, WHOLE, dSolo);
  for (const x of [a, b, c]) await played(x.acct, THIRD, dSplit);

  await revenue(2000);
  // bootstrap:true seeds this asset's price reference ONCE, deliberately (the F3 wall) — every
  // later buy in this file is then walled against it, which is the point.
  await Bank.recordBankBuy(pool, { ref: 'lin-1', spent: 1000, omrBought: 600, txHash: '0xlin1', bootstrap: true });
  const soloRun = await Bank.runCityLeg(pool, { endDay: dSolo });
  const soloTook = round6(await paidTo(solo.acct));

  await Bank.recordBankBuy(pool, { ref: 'lin-2', spent: 1000, omrBought: 600, txHash: '0xlin2' });
  const splitRun = await Bank.runCityLeg(pool, { endDay: dSplit });
  const splitTook = round6((await paidTo(a.acct)) + (await paidTo(b.acct)) + (await paidTo(c.acct)));

  // THE ASSERTION COMES FIRST, deliberately. The pool-drain checks below are true and worth having,
  // but a per-account cap breaks them TOO — so with them above this line the cap mutation fails on
  // "nothing is stranded" and the centrepiece never gets to fire. An assertion an obvious mutation
  // cannot reach is not proven load-bearing, whatever the run says.
  //
  // Not "roughly" and not "no better" — identical, because linear is exact.
  assert.equal(splitTook, soloTook,
    'SPLITTING GAINS NOTHING: three accounts doing a third each take exactly what one doing all of '
    + 'it took. A per-account cap would make this number LARGER — that is the Sybil-positive shape '
    + 'the Street Wage shipped and this leg refuses.');
  // And each of the three took its own third, so the equality is not an artifact of one taking all.
  for (const x of [a, b, c]) {
    assert.equal(round6(await paidTo(x.acct)), 200, 'each split account took its own even share');
  }
  // Now the drains — both epochs handed out the whole pool, so the equality above is between two
  // FULL distributions rather than two equally-truncated ones.
  assert.equal(round6(soloRun.paid), 600, 'the whole pool goes out — nothing is stranded');
  assert.equal(soloTook, 600, 'the only qualifying player takes all of it');
  assert.equal(round6(splitRun.paid), 600, 'and the split epoch pays out the same pool');
}

// ── THE BREADTH GATE AND THE DUST FLOOR ─────────────────────────────────────────────────────────
// Neither is a cap. MIN_TRACKS is a fixed per-ACCOUNT cost (Sybil-NEGATIVE — it makes a farm dearer
// and costs an engaged player nothing); MIN_SCORE only refuses dust.
{
  const wide = await mk('Broad Church Bruno');
  const narrow = await mk('One Note Nunzio');
  const dust = await mk('Crumbs Carbone');
  const day = dayOf() - 28;

  await played(wide.acct, { crime: 9, jump: 9, cards: 9 }, day);
  // Deep in ONE track, far past MIN_SCORE — refused on breadth alone.
  await played(narrow.acct, { crime: 200 }, day);
  assert(activityScore({ crime: 200 }) > ACTIVITY.MIN_SCORE, 'precondition: the narrow player is not dust');
  // Three tracks but barely any of it — refused on the floor alone.
  await played(dust.acct, { crime: 1, jump: 1, cards: 1 }, day);
  assert(activityScore({ crime: 1, jump: 1, cards: 1 }) < ACTIVITY.MIN_SCORE,
    'precondition: the dust player really is under the floor');

  await revenue(500);
  await Bank.recordBankBuy(pool, { ref: 'gate-1', spent: 100, omrBought: 300, txHash: '0xgate1' });
  await Bank.runCityLeg(pool, { endDay: day });

  assert.equal(round6(await paidTo(wide.acct)), 300, 'the player across three trades takes the epoch');
  assert.equal(round6(await paidTo(narrow.acct)), 0, 'one deep track does not qualify — MIN_TRACKS is a breadth gate');
  assert.equal(round6(await paidTo(dust.acct)), 0, 'a dust row does not qualify — MIN_SCORE is a floor');
}

// ── AGENTS AND RESIDENTS ARE EXCLUDED AT THE SOURCE ─────────────────────────────────────────────
{
  const human = await mk('Straight Sam');
  const bot = await mk('Agent Argyle');
  const npc = await mk('Scenery Sal');
  const day = dayOf() - 27;
  await pool.query('UPDATE account_persistent SET agent_flag=true WHERE account_id=$1', [bot.acct]);
  await pool.query('UPDATE account_persistent SET npc_flag=true WHERE account_id=$1', [npc.acct]);
  for (const x of [human, bot, npc]) await played(x.acct, { crime: 9, jump: 9, cards: 9 }, day);

  await revenue(500);
  await Bank.recordBankBuy(pool, { ref: 'excl-1', spent: 100, omrBought: 120, txHash: '0xexcl1' });
  await Bank.runCityLeg(pool, { endDay: day });

  assert.equal(round6(await paidTo(human.acct)), 120, 'the human takes the whole epoch');
  assert.equal(round6(await paidTo(bot.acct)), 0, 'an agent account receives nothing');
  assert.equal(round6(await paidTo(npc.acct)), 0, 'scenery receives nothing');
}

// ── THE COMP BOOKS ZERO $OMR ────────────────────────────────────────────────────────────────────
// Stricter than the desk's comp, deliberately: this pool's only exit is a `prize:omr` MINT followed
// by `fundReserve`, which is the claim "hard $OMR arrived". A comp that credited the pool would let
// the server sign a real withdrawal against backing that never existed.
{
  const before = await bookOf();
  const r = await Bank.recordBankBuy(pool, { ref: 'comp-1', spent: 999, omrBought: 999 });   // no txHash
  const after = await bookOf();
  assert.equal(r.real, false, 'a buy with no txHash is not real');
  assert.equal(r.omrBought, 0, 'and it books ZERO $OMR, not merely zero spend');
  assert.equal(round6(Number(after.bought_total)), round6(Number(before.bought_total)),
    'the pool did not grow on a comp — fabricated backing is exactly what the txHash gate is for');
  const row = (await pool.query('SELECT * FROM bank_buys WHERE ref=$1', ['comp-1'])).rows[0];
  assert(row, 'the episode IS on the record — a comp is auditable, it just moves nothing');
  assert.equal(Number(row.spent), 0, 'and books no spend against the revenue budget either');
}

// ── THE ROOT CAP: NEVER SPEND PROFIT THAT DID NOT ARRIVE ────────────────────────────────────────
{
  const spentSoFar = Number((await pool.query(
    "SELECT COALESCE(SUM(spent),0) s FROM bank_buys WHERE real AND asset='USDC'")).rows[0].s);
  const arrived = Number((await pool.query(
    "SELECT COALESCE(SUM(amount),0) s FROM bank_revenue WHERE real AND asset='USDC'")).rows[0].s);
  const room = round6(arrived - spentSoFar);
  await assert.rejects(
    Bank.recordBankBuy(pool, { ref: 'over-1', spent: room + 1, omrBought: 5, txHash: '0xover1' }),
    (e) => e.code === 'budget',
    'a buy that outruns the revenue that actually arrived is refused');
  assert.equal((await pool.query('SELECT 1 FROM bank_buys WHERE ref=$1', ['over-1'])).rows.length, 0,
    'and leaves no row behind');
}

// ── THE WINDOW IS IDEMPOTENT, AND AN EMPTY POOL DOES NOT CONSUME IT ─────────────────────────────
{
  const p = await mk('Second Helping Sonny');
  const day = dayOf() - 26;
  await played(p.acct, { crime: 9, jump: 9, cards: 9 }, day);

  // The sweep lands before the day's buy. It must NOT write the epoch row — `UNIQUE (start_day,
  // end_day)` makes that row the window's only chance, so closing it empty would quietly cost the
  // day's players a buy that lands an hour later.
  const early = await Bank.runCityLeg(pool, { endDay: day });
  assert.equal(early.skipped, 'empty', 'an empty pool skips rather than closing the window');
  assert.equal((await pool.query(
    'SELECT 1 FROM bank_epochs WHERE end_day=$1', [day])).rows.length, 0, 'and writes no epoch row');

  await revenue(500);
  await Bank.recordBankBuy(pool, { ref: 'idem-1', spent: 100, omrBought: 90, txHash: '0xidem1' });
  const first = await Bank.runCityLeg(pool, { endDay: day });
  assert.equal(round6(first.paid), 90, 'the late buy still reaches that day — the window was left claimable');

  const again = await Bank.runCityLeg(pool, { endDay: day });
  assert.equal(again.already, true, 'a second run over the same window is a no-op');
  assert.equal(round6(await paidTo(p.acct)), 90, 'and pays nothing a second time');
}

// ── §10.4: A BACKED MINT, AND THE VIG SANDWICH KNOWS THIS LEG'S NAME ────────────────────────────
{
  // Everything the leg has paid so far, against the ledger's own account of `prize:omr`, against the
  // reserve it funded. All three are the same number or the backing claim is false somewhere.
  const book = await bookOf();
  const paidTotal = round6(Number(book.paid_total));
  const bought = round6(Number(book.bought_total));
  assert(paidTotal > 0, 'precondition: this suite has actually distributed something');

  const k = await checkOf(Bank.runBankInvariants, 'distributed ≤ bought');
  assert(k.ok, `RULE 1 — never more out than in: ${JSON.stringify(k.detail)}`);
  for (const name of ['city pool balance exact', 'bought == Σ buys', 'paid == Σ payouts', 'spend ≤ revenue']) {
    const c = await checkOf(Bank.runBankInvariants, name);
    assert(c.ok, `${name}: ${JSON.stringify(c.detail)}`);
  }
  assert.equal(round6(Number(book.balance)), round6(bought - paidTotal), 'and the pool holds the remainder');

  // The mint is enumerated and reconciles. `prize:omr` is a term `invariants.js` already carries, so
  // the city leg needed no new reason — and conservation must be exact WITH these credits in it.
  const inv = await runLedgerInvariants(pool, { alert: false });
  const conservation = inv.checks.find((c) => c.name === '$OMR conservation');
  assert(conservation?.ok, `$OMR conservation holds with the city leg's mints in it: ${JSON.stringify(conservation?.detail)}`);
  const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
  assert(vocab?.ok, 'and the vocabulary stays closed — no new reason was invented');

  // THE SANDWICH. `fundReserve` has a two-sided check in the Vig naming every legitimate funder BY
  // NAME, so a new one missing from both terms does not fail open — it fires SPURIOUSLY on BOTH
  // halves at once (AUDIT-desk F1). This is that wiring, asserted from both directions.
  // (the Vig spreads its detail onto the check itself rather than nesting it under `detail`)
  const backed = await checkOf(runVigInvariants, 'reserve fully backed');
  const under = await checkOf(runVigInvariants, 'reserve not under-funded');
  assert(backed.ok, `reserve fully backed with cityPaid in the term: ${JSON.stringify(backed)}`);
  assert(under.ok, `reserve not under-funded with cityPaid in the term: ${JSON.stringify(under)}`);
  assert.equal(round6(Number(backed.cityPaid)), paidTotal,
    'the Vig counts EXACTLY what the city leg paid — a term that drifts here breaks both halves at once');
}

// ── THE BOARD SAYS WHAT IT IS, AND PROMISES NOTHING ─────────────────────────────────────────────
{
  const p = await mk('Reader Renzo');
  const day = dayOf() - 25;
  await played(p.acct, { crime: 9, jump: 9, cards: 9 }, day);
  await revenue(500);
  await Bank.recordBankBuy(pool, { ref: 'board-1', spent: 100, omrBought: 40, txHash: '0xboard1' });
  await Bank.runCityLeg(pool, { endDay: day });
  await played(p.acct, { crime: 4, jump: 4 });                    // today, so far

  const { code, body } = await call('GET', '/v1/bank', { token: p.token });
  assert.equal(code, 200, 'the board reads');
  assert.equal(round6(body.you.payouts[0].omr), 40, 'and shows what this player was paid');
  assert.equal(body.you.today.score, activityScore({ crime: 4, jump: 4 }),
    'and today\'s standing so far, from the same function the distribution uses');
  assert.equal(body.you.today.qualifies, false, 'honestly — two tracks is under the breadth gate');
  assert.equal(body.you.today.minTracks, ACTIVITY.MIN_TRACKS, 'with the gate stated rather than implied');
  assert(body.pool.boughtTotal > 0 && body.epochs.length > 0, 'the pool and the record are public on it');

  // §3's first product rule: nothing here may imply a speed or a guaranteed return. There is no
  // rate, no projection and no APY anywhere on this surface — assert it rather than trust it.
  //
  // Scoped to the BOARD's own fields, not the whole envelope: `readCharacter` merges the character
  // sheet into every response, and the kitchen's lab has a `yield` MODULE — an unrelated word that
  // would make this read as a violation forever. The claim is about the copy this leg writes.
  const { what, pool: poolShown, epochs, you, tags } = body;
  const text = JSON.stringify({ what, pool: poolShown, epochs, you, tags });
  for (const banned of ['APY', 'apy', 'per day', 'per year', 'guaranteed', 'yield', 'return on']) {
    assert(!text.includes(banned), `the board never says "${banned}" — no rate, no promise (§3)`);
  }
}

// ── §3 THE IN-GAME SURFACE — dormant, and the two hard product rules ────────────────────────────
// The protocol is not deployed, so what is asserted here is the SHAPE of the honesty: that an
// unbuilt feature reads as unbuilt rather than as broken, that it stays a pure read, and that
// neither of §3's product rules can be walked back by an edit to the copy.
{
  const p = await mk('Reader Rocco');
  const { body } = await call('GET', '/v1/bank', { token: p.token });

  // (1) UNBUILT READS AS UNBUILT. With no CHAIN_RPC_URL / ALCHEMIST_ADDRESS the position is
  // dormant, not an error — a surface that throws when a feature is merely unshipped is
  // indistinguishable from one that is broken, and the player cannot tell which they are looking at.
  assert(body.protocol, 'the board carries the protocol position');
  assert.equal(body.protocol.dormant, true, 'and says DORMANT rather than erroring, because the market is not deployed');
  assert.equal(body.protocol.market, 'nUSD', 'naming which market it is waiting on');
  // Asserted at the SOURCE too, not only through the route: the route wraps this in a catch (so a
  // dead RPC degrades to dormant rather than 500ing the whole board), which would happily mask a
  // reader that throws on an unconfigured chain. The board's answer alone cannot tell the two apart.
  const direct = await Bank.bankPosition(pool, p.acct);
  assert.equal(direct.dormant, true, 'the reader itself returns dormant — it does not throw and get caught');
  // ONE SHAPE, dormant or live. The mirror guard found the alternative: a dormant object carrying
  // only {dormant, market} leaves every rendered field MISSING rather than null, so the card shows
  // `undefined` and the client cannot tell "no position" from "no such field".
  const liveKeys = Object.keys(Bank.positionView({ wallet: '0x1', collateral: 0n, debt: 0n, maxDebt: 0n, ltvBps: 0 }));
  for (const k of liveKeys) {
    assert(k in direct, `the dormant position carries "${k}" too — one shape, so a renderer written against one is right for both`);
  }

  // (2) THE LEDGERS STAY SEPARATE (§3, rule two). The protocol read must never move play money.
  // Asserted by counting: not one ledger row, in either currency, from the whole surface.
  const before = Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n);
  await call('GET', '/v1/bank', { token: p.token });
  await Bank.bankPosition(pool, null);
  const after = Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n);
  assert.equal(after, before, 'the protocol surface writes ZERO ledger rows — in-game cash and the protocol are separate books');

  // (3) NEVER A PHRASE IMPLYING SPEED OR A GUARANTEED RETURN (§3, rule one).
  //
  // Asserted against the object a LIVE position produces, NOT the dormant one — and that distinction
  // is not pedantry, it is a mutation that survived. Scanning `{dormant:true, market:'nUSD'}` for
  // banned words passes whatever the live path says, so the first version of this check could not
  // fail no matter what the shipped surface promised. `positionView` is the shaping split out from
  // the RPC precisely so this can reach it.
  const live = Bank.positionView({
    wallet: '0x0000000000000000000000000000000000000001',
    collateral: 1000n * 10n ** 18n, debt: 400n * 10n ** 18n, maxDebt: 500n * 10n ** 18n, ltvBps: 5000,
  });
  assert.equal(live.collateral, 1000, 'a live position reports its collateral');
  assert.equal(live.borrowable, 100, 'and what is left to borrow — the ceiling minus the debt');
  assert.strictEqual(live.payoffDays, null,
    'and NO payoff projection, because none has been realised — the rule, not a gap');
  assert.equal(live.liquidation, 'none',
    'the one forward-looking claim it does make is structural: matching denominations removes the mechanism');
  const text = JSON.stringify(live) + JSON.stringify(body.protocol);
  for (const banned of ['APY', 'apy', 'guaranteed', 'per year', 'per day', 'earn', 'yield']) {
    assert(!text.includes(banned), `neither the live nor the dormant surface says "${banned}" (§3 rule one)`);
  }
}

// ── THE PRICE WALL: THE ROOT CAP BOUNDS THE SPEND, NOT THE RATIO (AUDIT-family-buyback F3) ───────
// This ingest takes `spent` and `omrBought` as two INDEPENDENT numbers, so capping only the first
// left the implied PRICE unbounded — measured on the unfixed code, 1 USDC of real profit booked
// 1,000,000,000 $OMR with runBankInvariants green, because `distributed <= bought` compares against
// the caller's own `bought`. The consequence is sharper than the family keeper's twin: this pool's
// exit mints `prize:omr` to PLAYERS and calls fundReserve, i.e. it raises the number signVoucher
// reads before signing a real on-chain withdrawal.
//
// Placed LAST on purpose: the WETH bootstrap below credits the pool, and the empty-pool block above
// needs a pool that is genuinely empty (the community suite's block-9 ordering lesson).
{
  const poolBefore = Number((await pool.query('SELECT balance FROM bank_city_pool WHERE id=1')).rows[0].balance);
  const lastPrice = Number((await pool.query(
    "SELECT omr_bought / spent p FROM bank_buys WHERE real AND asset='USDC' AND spent > 0 ORDER BY created_at DESC LIMIT 1")).rows[0].p);
  await revenue(50);
  await assert.rejects(
    Bank.recordBankBuy(pool, { ref: 'fat-1', spent: 1, omrBought: 1e9, txHash: '0xfat1' }),
    (e) => e.code === 'price_sanity',
    'a fat-fingered price is refused however small the spend — the RATIO is walled, not just the budget');
  assert.equal(Number((await pool.query('SELECT balance FROM bank_city_pool WHERE id=1')).rows[0].balance), poolBefore,
    '...and the city pool did not move (the refusal rolls back before the credit)');
  // an ASSET with no prior real buy has nothing to be continuous with, so it is REFUSED rather than
  // trusted to set its own reference — seeded once, deliberately, never by the bot's ordinary path
  await revenue(10, 'WETH');
  await assert.rejects(
    Bank.recordBankBuy(pool, { ref: 'weth-1', asset: 'WETH', spent: 1, omrBought: 1e9, txHash: '0xweth1' }),
    (e) => e.code === 'price_unanchored',
    'a first real buy in a NEW asset is refused — the game has no price for it to be checked against');
  const seeded = await Bank.recordBankBuy(pool,
    { ref: 'weth-2', asset: 'WETH', spent: 1, omrBought: 200000, txHash: '0xweth2', bootstrap: true });
  assert.equal(seeded.omrBought, 200000, 'a deliberate bootstrap seeds the reference and books normally');
  // ...and the seeded price walls every buy after it — a bootstrap is ONE act, not a standing
  // exemption (the property that would make the flag a bypass if it were wrong)
  await assert.rejects(
    Bank.recordBankBuy(pool, { ref: 'weth-3', asset: 'WETH', spent: 1, omrBought: 200000 * 11, txHash: '0xweth3' }),
    (e) => e.code === 'price_sanity',
    'the bootstrapped price walls every buy after it');
  // the walls are per ASSET: seeding WETH left the USDC reference this file has been building alone
  const stillUsdc = Number((await pool.query(
    "SELECT omr_bought / spent p FROM bank_buys WHERE real AND asset='USDC' AND spent > 0 ORDER BY created_at DESC LIMIT 1")).rows[0].p);
  assert.equal(stillUsdc, lastPrice, 'the WETH bootstrap left the USDC reference alone (walls are per-asset)');
}

console.log('bank ok — the split gains nothing, the comp books zero, and every token paid was bought');

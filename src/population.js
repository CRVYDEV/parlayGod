// THE POPULATION — NPC residents of the city. Design: omerta-npc-population-design.md.
//
// OMERTÀ is a multiplayer game launching with ~zero players, so every board that reads `characters`
// is dead in an empty alpha: the streets roster, the contract board, the duelling ladder, the Black
// Market, the Shylock, the bodyguard market, the nightlife board, the fights, the races strip, the
// fade/poker tables, the Wire's tap targets, Secrets' dig targets. The progression harness measured
// the consequence exactly — a plausible player reaches level 128 with $51M in 30 days having never
// once met another person, because there is nobody to meet.
//
// A resident is a REAL character (the convoys.is_npc precedent): a real `accounts` +
// `account_persistent` + `characters` row, flagged on both levels. That means every interaction a
// player has with a resident — a jump, a contract, a fire-kill, a wiretap, a dig, a DM — runs the
// SAME audited code that runs against a real player. Nothing in social.js knows it's fighting a ghost.
//
// §10.4: residents hold cash, so they sit inside the per-character cash check and every dollar they
// hold must have an enumerated reason. Exactly two new ones, both under the `npc:` cash prefix:
//   npc:seed    FAUCET — the cash a resident is spawned holding (the one new faucet; sim P9.21)
//   npc:retire  SINK   — the cash burned when the worker retires a resident
// Everything else is an existing audited flow: a fire-kill loots them through `whack:loot`, the
// estate burns the remainder through the existing death rows, the heir's stake is `death:legacy`.
//
// DEATH IS DELIBERATELY NOT SPECIAL. A killed resident runs the ordinary runEstate, and the heir —
// same name, generation+1 — IS the respawn. social.js needs zero changes and the population
// self-heals. The worker only tops up headcount and retires old bloodlines.
import crypto from 'node:crypto';
import { POPULATION, NPC_FIRST, NPC_LAST, npcBandOf, DISTRICTS, PACING, dayOf,
         LOAN, loanOwed, GOODS, BLACK_MARKET, M3, DUELS, CASINO } from './rules.js';

const uid = () => crypto.randomUUID();
const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
const rndInt = (lo, hi) => Math.floor(rnd(lo, hi + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// respect for a target level, off the LIVE pacing curve (never a hardcoded copy of the inverse —
// that duplication is what silently under-seeded every sim probe when the curve last moved)
const respectFor = (lvl) => PACING.LEVEL_DIVISOR * (lvl - 1) * (lvl - 1);

/**
 * How much `npc:seed` has been emitted in the last rolling 24h — read from the LEDGER, which is the
 * only state that survives a worker restart (the wage epoch's `emittedThisEpoch` discipline).
 *
 * Sums the ledgered DELTAS, which is exactly what the faucet emitted: the `corner` band seeds below
 * the un-ledgered $500 base, so those rows are negative and correctly REFUND budget.
 */
export async function seededToday(client) {
  return Number((await client.query(
    `SELECT COALESCE(SUM(amount), 0) n FROM transactions
      WHERE reason='npc:seed' AND at > now() - interval '24 hours'`)).rows[0].n);
}

/** How many residents are currently walking around. */
export async function population(client) {
  return Number((await client.query('SELECT COUNT(*) n FROM characters WHERE alive AND is_npc')).rows[0].n);
}

/**
 * Spawn ONE resident. Returns { id, name, level, band } or null if a unique name couldn't be found
 * (living names are unique game-wide — the caller just tries again next tick).
 *
 * Runs inside the caller's transaction so a failed spawn leaves nothing behind.
 */
export async function spawnResident(client, opts = {}) {
  const band = opts.band || npcBandOf(Math.random());
  const lvl = opts.level || rndInt(band.lvl[0], band.lvl[1]);
  const cash = Math.round(rnd(band.seed[0], band.seed[1]));

  // a unique living name — retry a few times before giving up to the next tick
  let name = null;
  for (let i = 0; i < 6 && !name; i++) {
    const cand = `${pick(NPC_FIRST)} ${pick(NPC_LAST)}`;
    const taken = (await client.query('SELECT 1 FROM characters WHERE name=$1 AND alive LIMIT 1', [cand])).rows.length;
    if (!taken) name = cand;
  }
  if (!name) return null;

  const accountId = uid();
  const charId = uid();
  // the account: a real row (characters.account_id is NOT NULL), flagged npc so the human-only
  // surfaces — above all the Street Wage — can exclude it.
  await client.query('INSERT INTO accounts (id, auth_provider, auth_subject) VALUES ($1,$2,$3)',
    [accountId, 'npc', `npc:${accountId}`]);
  await client.query('INSERT INTO account_persistent (account_id, npc_flag) VALUES ($1,true)', [accountId]);

  // `season` is NOT NULL with no default — the real creation path stamps the current season and so
  // must this, or the lazy season-rollover marker is wrong for every resident.
  await client.query(
    `INSERT INTO characters (id, account_id, name, is_npc, season, respect, cash, muscle, cunning, speed, loc, health, energy, nerve)
     VALUES ($1,$2,$3,true,$4,$5,$6,$7,$8,$9,$10,100,50,10)`,
    [charId, accountId, name, Math.floor(dayOf() / 28), respectFor(lvl), cash,
     rndInt(band.stat[0], band.stat[1]), rndInt(band.stat[0], band.stat[1]), rndInt(band.stat[0], band.stat[1]),
     pick(DISTRICTS).id]);

  // THE TURNOVER: record what they ARRIVED with, so the worker can later tell a resident players
  // have picked clean from one who was simply born poor. Direct SQL, outside persistCharacter.
  await client.query('UPDATE characters SET npc_seed=$2 WHERE id=$1', [charId, cash]);

  // §10.4 — the seed is ledgered against the resident, so the per-character cash check reconciles
  // them exactly like a player. Every character row carries an un-ledgered base of 500 (that's the
  // baseline the check subtracts), so what gets ledgered is the DELTA from it — the same accounting
  // the heir's legacy stake uses. The delta can be NEGATIVE: the `corner` band seeds below 500, and
  // skipping the row for those left the books short by exactly the shortfall.
  if (cash !== 500) {
    await client.query(
      'INSERT INTO transactions (id, character_id, currency, amount, reason) VALUES ($1,$2,$3,$4,$5)',
      [uid(), charId, 'cash', cash - 500, 'npc:seed']);
  }
  return { id: charId, name, level: lvl, band: band.id, cash };
}

/**
 * Retire ONE resident — the city moves on. Burns whatever cash they were carrying (`npc:retire`, a
 * ledgered SINK) so the §10.4 books close exactly, then marks them dead WITHOUT an estate: a retired
 * resident leaves no heir, which is how headcount makes room for fresh faces.
 */
export async function retireResident(client, charId) {
  const c = (await client.query(
    'SELECT id, cash, bank FROM characters WHERE id=$1 AND alive AND is_npc FOR UPDATE', [charId])).rows[0];
  if (!c) return null;

  // STEP TWO: pull their escrows back in FIRST. A retiring resident with a live loan offer or buy
  // order would otherwise leave it standing on the board forever with nobody behind it — a player
  // could take a loan from a lender who no longer exists and never be collected from. Mirrors the
  // audited cancel paths exactly (`loan:refund` / `market:refund`), so both escrow checks stay
  // balanced and the refunded cash is burned with the rest below.
  let reclaimed = 0;
  const offers = (await client.query(
    "SELECT id, principal FROM loans WHERE lender_character=$1 AND status='open' FOR UPDATE", [charId])).rows;
  for (const o of offers) {
    await client.query("UPDATE loans SET status='cancelled' WHERE id=$1", [o.id]);
    await client.query('INSERT INTO transactions (id, character_id, currency, amount, reason) VALUES ($1,$2,$3,$4,$5)',
      [uid(), charId, 'cash', Number(o.principal), 'loan:refund']);
    reclaimed += Number(o.principal);
  }
  const orders = (await client.query(
    "SELECT id, qty, price FROM market_listings WHERE seller_character=$1 AND kind='order' AND status='live' FOR UPDATE", [charId])).rows;
  for (const o of orders) {
    const remaining = Number(o.qty) * Number(o.price);
    await client.query("UPDATE market_listings SET qty=0, status='cancelled' WHERE id=$1", [o.id]);
    if (remaining > 0) {
      await client.query('INSERT INTO transactions (id, character_id, currency, amount, reason) VALUES ($1,$2,$3,$4,$5)',
        [uid(), charId, 'cash', remaining, 'market:refund']);
      reclaimed += remaining;
    }
  }
  if (reclaimed > 0) await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [charId, reclaimed]);

  const held = Number(c.cash) + Number(c.bank) + reclaimed;
  if (held > 0) {
    await client.query(
      'INSERT INTO transactions (id, character_id, currency, amount, reason) VALUES ($1,$2,$3,$4,$5)',
      [uid(), charId, 'cash', -held, 'npc:retire']);
  }
  await client.query('UPDATE characters SET alive=false, cash=0, bank=0 WHERE id=$1', [charId]);
  return { id: charId, burned: held };
}

/**
 * THE WORKER TICK — keep the city populated.
 *
 * Tops headcount up to POPULATION.TARGET (at most SPAWN_PER_TICK per tick, so the city fills in
 * visibly rather than appearing all at once), and retires bloodlines past RETIRE_GENERATIONS so no
 * resident line accumulates prestige — and therefore an ever-growing `death:legacy` stake — forever.
 *
 * Each spawn/retire is its own transaction: one bad row can never starve the rest (the worker
 * per-job isolation discipline).
 */
export async function runPopulation(pool) {
  // (red-team F3) The day's replacement allowance is read, then spent across separate transactions,
  // so two worker replicas could each read it as untouched and each spend the full 24 — doubling
  // the day's npc:seed emission past the ceiling that is the whole point of metering it. A SESSION
  // advisory lock serializes them; a crashed run releases it when its session ends. This is the
  // wage epoch's discipline (emission.js) applied to the other metered faucet. pg-mem (no
  // DATABASE_URL) is single-process, so there is nothing to serialize there.
  let lockConn = null;
  if (process.env.DATABASE_URL) {
    lockConn = await pool.connect();
    const got = (await lockConn.query('SELECT pg_try_advisory_lock($1,$2) AS ok', [POP_LOCK_CLASS, 0])).rows[0].ok;
    if (!got) { lockConn.release(); return { spawned: 0, retired: 0, drained: 0, population: await population(pool), turnoverLeft: 0, skipped: 'locked' }; }
  }
  try {
    return await runPopulationInner(pool);
  } finally {
    if (lockConn) {
      await lockConn.query('SELECT pg_advisory_unlock($1,$2)', [POP_LOCK_CLASS, 0]).catch(() => {});
      lockConn.release();
    }
  }
}

const POP_LOCK_CLASS = 0x504f;  // 'PO' — distinct from the wage epoch's class

async function runPopulationInner(pool) {
  const out = { spawned: 0, retired: 0, drained: 0, population: 0, turnoverLeft: 0 };

  // THE CEILING (step three). Recycling makes `npc:seed` recurring, so replacements are metered —
  // a per-day HEADCOUNT, because a retirement is precisely what creates the vacancy a fresh seed
  // pays for. Metering dollars instead would let the day-one fill of an empty city (~48 seeds that
  // replace nobody) eat the whole allowance before a single resident had been robbed.
  const today = dayOf();
  const st = (await pool.query('SELECT day, retired FROM population_state WHERE id=1')).rows[0]
    || { day: today, retired: 0 };
  const usedToday = Number(st.day) === today ? Number(st.retired) : 0;
  let allowance = Math.max(0, POPULATION.TURNOVER.PER_DAY - usedToday);
  out.turnoverLeft = allowance;

  // 1. retire the old lines first, so the top-up below refills the space they leave — AND (step
  //    three) the ones players have picked clean, which is what makes the city renewable. Both go
  //    through the same retire path, and both consume the day's allowance: either way the city is
  //    buying a fresh face with a fresh seed.
  const room = Math.min(POPULATION.SPAWN_PER_TICK, allowance);
  const oldAll = room <= 0 ? [] : (await pool.query(
    'SELECT id FROM characters WHERE alive AND is_npc AND generation > $1 ORDER BY id LIMIT $2',
    [POPULATION.RETIRE_GENERATIONS, room])).rows;
  // "picked clean" is measured against what they ARRIVED with (npc_seed), never a flat cash floor —
  // a flat floor can't tell a drained boss from a corner kid born with $200, and would recycle the
  // cheap bands forever. `npc_seed > 0` also skips residents not yet stamped, so an unknown stake is
  // never mistaken for a drained one.
  const oldIds = new Set(oldAll.map((r) => r.id));
  const drainedAll = room <= 0 ? [] : (await pool.query(
    `SELECT id FROM characters WHERE alive AND is_npc AND npc_seed > 0
       AND cash < npc_seed * $1 / 10000.0 ORDER BY id LIMIT $2`,
    [POPULATION.TURNOVER.DRAINED_BPS, room])).rows.filter((r) => !oldIds.has(r.id));

  // (red-team F1) Retiring old bloodlines is bounded MAINTENANCE; retiring the picked-clean is the
  // renewal LOOP — the entire point of step three. Taking old lines first out of a shared per-tick
  // room let maintenance starve the loop indefinitely: with SPAWN_PER_TICK or more lines past
  // RETIRE_GENERATIONS (which heavy PvP sustains, since a resident's generation only rises when
  // players kill them), no drained resident is ever replaced. So the loop is guaranteed a slot
  // whenever it has a candidate, and maintenance takes what's left.
  const drained = drainedAll.slice(0, Math.max(1, room - oldAll.length));
  const old = oldAll.slice(0, room - drained.length);
  out.drained = drained.length;
  for (const r of [...old, ...drained]) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const done = await retireResident(client, r.id);
      // charge the day's allowance in the SAME transaction as the retirement, so a crash between
      // the two can't hand out a free replacement (the claim-then-act discipline)
      if (done) await client.query(
        `UPDATE population_state SET day=$1, retired = CASE WHEN day=$1 THEN retired + 1 ELSE 1 END WHERE id=1`,
        [today]);
      await client.query('COMMIT');
      if (done) { out.retired++; allowance--; out.turnoverLeft = Math.max(0, allowance); }
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[population] retire failed', r.id, e.message);
    } finally { client.release(); }
  }

  // 2. top up to target. Deliberately UNMETERED: the ceiling is charged at retirement, which is
  //    what actually creates the vacancy, so the spawn side is free to refill whatever the city is
  //    short — including the day-one fill of an empty server, which replaces nobody.
  const have = await population(pool);
  const want = Math.max(0, Math.min(POPULATION.SPAWN_PER_TICK, POPULATION.TARGET - have));
  for (let i = 0; i < want; i++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const born = await spawnResident(client);
      await client.query('COMMIT');
      if (born) out.spawned++;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[population] spawn failed', e.message);
    } finally { client.release(); }
  }
  // 3. JAILBIRDS (founder: the daily "Bust a player out of lockup" contract was uncompletable on a
  //    solo run — nobody was ever in lockup to bust). Keep TARGET residents serving a sentence so
  //    the §7.8 bust verb always has a target, the Pen roster has faces, and the bust dailies are
  //    completable. Pure jail_until pacing — zero §10.4 (no ledger row, no value moves); the
  //    behaviour picker already skips jailed residents, so a collared resident just sits it out.
  //    No bus/notify — residents emit no events (the step-two rule).
  const jb = POPULATION.JAILBIRDS;
  const inside = Number((await pool.query(
    'SELECT COUNT(*) c FROM characters WHERE alive AND is_npc AND jail_until > now()')).rows[0].c);
  out.jailed = 0;
  for (let i = inside; i < jb.TARGET; i++) {
    const pickable = (await pool.query(
      `SELECT id FROM characters WHERE alive AND is_npc
         AND (jail_until IS NULL OR jail_until < now())
         AND (hosp_until IS NULL OR hosp_until < now()) LIMIT 24`)).rows;
    if (!pickable.length) break;
    const pick = pickable[Math.floor(Math.random() * pickable.length)];
    const sentenceS = jb.MIN_S + Math.floor(Math.random() * (jb.MAX_S - jb.MIN_S + 1));
    // absolute timestamp computed in JS (the pg-mem discipline — no interval arithmetic on a param)
    await pool.query('UPDATE characters SET jail_until = $2 WHERE id=$1',
      [pick.id, new Date(Date.now() + sentenceS * 1000)]);
    out.jailed++;
  }
  out.population = await population(pool);
  return out;
}

// ════════════════════ STEP TWO — THE CITY ACTS ════════════════════
//
// THE ONE RULE: a resident may only ever RECYCLE value it already holds, never conjure it at the
// point of sale. So step two adds **no new faucet** — every behaviour either moves zero value
// (drift, consent limits) or parks cash the resident was already `npc:seed`ed with into an EXISTING
// audited escrow (`loan:offer`, `market:list`+`market:order`), which the existing worker sweeps
// refund on expiry. §10.4 needs no new reason at all.
//
// Residents deliberately emit NO telemetry and NO bus events, so `/v1/online` presence stays a true
// human count. They are present and transactable, not fake activity in the feed.

/** Cash a resident is willing to commit — never more than (1 − KEEP_FLOOR), so they stay lootable. */
const spendable = (cash) => Math.floor(Number(cash) * (1 - POPULATION.BEHAVIOUR.KEEP_FLOOR));
const bps = (n, b) => Math.floor(Number(n) * b / 10000);

/**
 * ONE resident takes ONE turn. Returns the action taken (or null). Runs inside the caller's txn.
 *
 * Deliberately at most one thing per turn: the city stirs rather than stampedes, and a single
 * failure can only cost one resident one action.
 */
export async function residentAct(client, r) {
  const B = POPULATION.BEHAVIOUR;
  const cash = Number(r.cash);

  // THE TURNOVER: an HEIR is born through the ordinary runEstate, which knows nothing about
  // `npc_seed` — so the first time we see a resident carrying an unrecorded stake, record it. Doing
  // it here rather than in social.js keeps the estate path free of population concerns, and an
  // unstamped resident is simply never eligible for the drained-retire until we've seen them once.
  if (Number(r.npc_seed || 0) <= 0 && cash > 0)
    await client.query('UPDATE characters SET npc_seed=$2 WHERE id=$1', [r.id, cash]);

  // 1. CONSENT LIMITS — what they're willing to be challenged for. Pure column writes, zero value.
  //    This is what lights up the bodyguard market, the back-room fade board and the duel ladder:
  //    all three are consent-by-listing, so an empty alpha has nobody to play against without it.
  //
  //    (red-team F1–F3) Writing these columns by direct SQL bypasses offerBodyguard / listDuel /
  //    setFadeLimit and every bound they enforce, so each limit is gated by ITS OWN system's floor
  //    rather than a population-local one. That matters most for the bodyguard: the Phase-1.3
  //    reprice set BODYGUARD_MIN_PRICE at $10,000 for safehouse parity, and an unfloored resident
  //    would have sold the same one-bullet shield for a few hundred — undercutting a signed
  //    Make-Risk-Pay lever by ~40×. A resident that can't reach a floor just doesn't offer that
  //    service: a short honest board beats a long one full of listings nobody can act on (an
  //    under-STAKE_MIN duel entry is literally unchallengeable — `amt >= STAKE_MIN && amt <= limit`
  //    is an empty window).
  //    A guard PRICE is income the resident RECEIVES, not a stake they have to cover — sizing it to
  //    their holdings was a category error copied from the two stake columns, and it left all but
  //    the richest few unable to reach the floor at all (an empty protection market, which is the
  //    thing step two exists to fix). It's the floor, or more if they're worth more.
  const duel = bps(cash, B.DUEL_BPS);
  const want = {
    guard: Math.max(M3.BODYGUARD_MIN_PRICE, bps(cash, B.GUARD_BPS)),
    duel: duel >= DUELS.STAKE_MIN ? duel : null,
    fade: Math.min(bps(cash, B.FADE_BPS), CASINO.MAX_BET) >= CASINO.MIN_BET
      ? Math.min(bps(cash, B.FADE_BPS), CASINO.MAX_BET) : null,
  };
  // Relist when a stored limit has gone STALE — a drained resident whose advertised stake no longer
  // covers is a listing that can only ever answer `their_cash`, which is the dead board step two
  // exists to kill. (A guard PRICE needs no cover — it's income — so it only moves on a relist.)
  const uncoverable = (r.fade_limit != null && Number(r.fade_limit) > cash)
    || (r.duel_limit != null && Number(r.duel_limit) > cash);
  const newlyAble = (r.guard_price == null && want.guard != null)
    || (r.fade_limit == null && want.fade != null) || (r.duel_limit == null && want.duel != null);
  if (uncoverable || newlyAble) {
    await client.query('UPDATE characters SET guard_price=$2, fade_limit=$3, duel_limit=$4 WHERE id=$1',
      [r.id, want.guard, want.fade, want.duel]);
    return 'listed';
  }

  // 2. THE SHYLOCK — a SECURED offer. Residents never call collectLoan, so an unsecured NPC loan
  //    would be free money for a defaulter; requiring collateral worth MORE than the debt means the
  //    audited grace-forfeit sweep seizes a car worth more than they borrowed. Recourse without
  //    needing an NPC to act.
  const hasOffer = Number((await client.query(
    "SELECT COUNT(*) n FROM loans WHERE lender_character=$1 AND status='open'", [r.id])).rows[0].n);
  if (!hasOffer && spendable(cash) >= LOAN.MIN) {
    const principal = Math.max(LOAN.MIN, Math.min(LOAN.MAX, bps(cash, B.LOAN_BPS), spendable(cash)));
    const rate = Math.round(rnd(B.LOAN_RATE[0], B.LOAN_RATE[1]) * 100) / 100;
    const hours = rndInt(B.LOAN_HOURS[0], B.LOAN_HOURS[1]);
    // (red-team) The recourse guarantee IS the collateral floor, so never clamp it down to
    // LOAN.COLLATERAL_MAX — that would quietly ship an UNDER-secured NPC loan, which is free money
    // for a defaulter (a resident never calls collectLoan). Unreachable at today's numbers
    // (LOAN.MAX × 1.5 vig × 1.3 = $1.95M < the $5M cap), but LOAN_COLLATERAL_MULT and the seed
    // bands are founder levers — if one ever pushes past the cap the resident simply doesn't lend.
    const collateral = Math.floor(loanOwed(principal, rate) * B.LOAN_COLLATERAL_MULT);
    if (collateral > LOAN.COLLATERAL_MAX) return null;
    await client.query('UPDATE characters SET cash = cash - $2 WHERE id=$1', [r.id, principal]);
    await client.query(
      'INSERT INTO loans (id, lender_character, principal, rate, hours, status, collateral_min) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [uid(), r.id, principal, rate, hours, 'open', collateral]);
    await client.query('INSERT INTO transactions (id, character_id, currency, amount, reason) VALUES ($1,$2,$3,$4,$5)',
      [uid(), r.id, 'cash', -principal, 'loan:offer']);
    return 'lent';
  }

  // 3. THE BLACK MARKET — a standing BUY ORDER. Gives a player a reliable cash buyer for goods they
  //    actually hold: a fair exchange, bounded by the resident's own cash, and the existing sweep
  //    refunds the unfilled escrow on expiry. Mirrors postOrder's accounting exactly (fee + escrow).
  const hasOrder = Number((await client.query(
    "SELECT COUNT(*) n FROM market_listings WHERE seller_character=$1 AND status='live'", [r.id])).rows[0].n);
  if (!hasOrder) {
    const good = pick(GOODS);
    const unit = Math.max(1, bps(good.base, rndInt(B.ORDER_PRICE_BPS[0], B.ORDER_PRICE_BPS[1])));
    const budget = Math.min(spendable(cash), bps(cash, B.ORDER_BPS));
    const qty = Math.min(BLACK_MARKET.ORDER_MAX_QTY, Math.floor(budget / unit));
    const escrow = qty * unit;
    const fee = Math.max(BLACK_MARKET.LIST_FEE_MIN, Math.floor(escrow * BLACK_MARKET.LIST_FEE_BPS / 10000));
    if (qty >= 1 && escrow >= BLACK_MARKET.MIN_PRICE && Number(r.cash) >= escrow + fee) {
      await client.query('UPDATE characters SET cash = cash - $2 WHERE id=$1', [r.id, escrow + fee]);
      await client.query('INSERT INTO transactions (id, character_id, currency, amount, reason) VALUES ($1,$2,$3,$4,$5)',
        [uid(), r.id, 'cash', -fee, 'market:list']);
      await client.query('INSERT INTO transactions (id, character_id, currency, amount, reason) VALUES ($1,$2,$3,$4,$5)',
        [uid(), r.id, 'cash', -escrow, 'market:order']);
      await client.query(
        'INSERT INTO market_listings (id, seller_character, kind, good_id, qty, district, price, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [uid(), r.id, 'order', good.id, qty, r.loc, unit,
         new Date(Date.now() + BLACK_MARKET.MAX_TTL_H * 3600 * 1000)]);
      return 'ordered';
    }
  }

  // 4. DRIFT — the city moves. Pure position, zero value (a resident isn't paying cab fare).
  const to = pick(DISTRICTS.filter((d) => d.id !== r.loc));
  if (to) { await client.query('UPDATE characters SET loc=$2 WHERE id=$1', [r.id, to.id]); return 'moved'; }
  return null;
}

/**
 * THE WORKER TICK — give a handful of residents a turn.
 *
 * Skips anyone the world has taken out of play (jailed / hospitalized / in a safehouse), so a
 * resident under a player's boot doesn't carry on trading as if nothing happened. One transaction
 * per resident: a poison row can never starve the rest.
 */
export async function runResidentBehaviour(pool) {
  const out = { acted: 0, actions: {} };
  // NOTE: shuffled in JS, not `ORDER BY random()` — pg-mem has no random() (the two-flat-queries
  // precedent). Picking whose turn it is doesn't need to be cryptographic.
  const eligible = (await pool.query(
    `SELECT id, cash, loc, npc_seed, guard_price, fade_limit, duel_limit FROM characters
      WHERE alive AND is_npc
        AND (jail_until IS NULL OR jail_until < now())
        AND (hosp_until IS NULL OR hosp_until < now())
        AND (safe_until IS NULL OR safe_until < now())
      ORDER BY id`)).rows;
  const pick_ = eligible
    .map((r) => ({ r, k: Math.random() })).sort((a, b) => a.k - b.k)
    .slice(0, POPULATION.BEHAVIOUR.ACT_PER_TICK).map((x) => x.r);
  for (const r of pick_) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // re-read under the row lock — a player may have jumped/robbed them since the pick
      const live = (await client.query(
        'SELECT id, cash, loc, npc_seed, guard_price, fade_limit, duel_limit FROM characters WHERE id=$1 AND alive AND is_npc FOR UPDATE',
        [r.id])).rows[0];
      const did = live ? await residentAct(client, live) : null;
      await client.query('COMMIT');
      if (did) { out.acted++; out.actions[did] = (out.actions[did] || 0) + 1; }
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[population] resident action failed', r.id, e.message);
    } finally { client.release(); }
  }
  return out;
}

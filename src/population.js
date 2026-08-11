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
import { ledger, notify } from './game.js';
import { wipeFighterAtDeath } from './boxing.js';
import { residentEnterTournament, residentNominateFuturity } from './casino.js';
import { residentEnterGrandPrix } from './races.js';
import { residentEnterStakes } from './stable.js';
// NPC FAMILIES: founding and joining run through the AUDITED player path, not a copy of it — the
// name/tag validation, the uniqueness clash check, the ledgered `gang:found` sink, the FOR UPDATE
// on the gang row and the GANG_MAX_MEMBERS count invariant are all the same code a player runs.
// (A parallel implementation is how the sackEmpire rake-cursor drifted; there is one founding path.)
import { createGang, joinGang, removeMember } from './social/gangs.js';
import { clearInboundPointers } from './social/estate.js';
import { POPULATION, NPC_FIRST, NPC_LAST, npcBandOf, DISTRICTS, PACING, dayOf,
         LOAN, loanOwed, GOODS, BLACK_MARKET, M3, DUELS, CASINO, CARS, goodPriceOf,
         BOXING, STABLE, stableKindOf, FIGHTER_MONIKERS, RACER_NAMES, rollRarity, FAMILY_WAR } from './rules.js';

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
  // ═══ STEP TWO of THE STREET WAR — residents OWN things worth taking (POPULATION.MARKS) ═══
  // Every grant here is a DELIBERATE bounded faucet flagged in BALANCE.md; §10.4 stays exact:
  //  · a CAR is a row — counted into the car-conservation invariant via an rng_audit 'npc:car'
  //    grant row (the boost-counting precedent; retirement writes the matching retire row);
  //  · a FRONT is ownership (no conservation check) whose income only ever realizes through the
  //    rob/shakedown/inside-job REDIRECT at the sleepy-joint scale (npcPendingScale);
  //  · a BOAT is a row with no conservation check — its resale is the flagged faucet.
  // Tests pass opts.marks to pin the rolls; production rolls the band's P.
  const M = POPULATION.MARKS;
  const P_OF = { car: M.CAR_P, front: M.FRONT_P, boat: M.BOAT_P, fighter: M.FIGHTER_P, racer: M.RACER_P };
  const wants = (key) => (opts.marks ? !!opts.marks[key] : Math.random() < ((P_OF[key] || {})[band.id] || 0));
  if (wants('car')) {
    const [lo, hi] = M.CAR_VAL[band.id] || [800, 2000];
    const models = CARS.filter((c) => c.val >= lo && c.val <= hi);
    if (models.length) {
      const model = pick(models);
      const carId = uid();
      // v3 step 7: a resident's ride carries a rolled rarity like anyone's — stealing one is EARNING
      // it in play, which is exactly the acquisition the design's "drop random" rule is about. Rolled
      // through the same helper and audited the same way (direct SQL: the worker has no `h`).
      const rrRoll = Math.random();
      const rarity = rollRarity(rrRoll);
      await client.query('INSERT INTO cars (id, character_id, model_id, trim_id, dmg, rarity) VALUES ($1,$2,$3,$4,$5,$6)',
        [carId, charId, model.id, 'stock', rndInt(0, 20), rarity]);
      await client.query('INSERT INTO rng_audit (id, character_id, action, roll, outcome) VALUES ($1,$2,$3,0,$4)',
        [uid(), charId, 'npc:car', 'grant']);
      await client.query('INSERT INTO rng_audit (id, character_id, action, roll, outcome) VALUES ($1,$2,$3,$4,$5)',
        [uid(), charId, 'rarity:car', rrRoll, rarity]);
    }
  }
  if (wants('front') && M.FRONTS[band.id]) {
    const [kind, tier] = M.FRONTS[band.id];
    await client.query('INSERT INTO businesses (id, character_id, kind, tier) VALUES ($1,$2,$3,$4)',
      [uid(), charId, kind, tier]);
  }
  if (wants('boat')) {
    const rrRoll = Math.random();
    await client.query('INSERT INTO boats (id, character_id, kind, rarity) VALUES ($1,$2,$3,$4)',
      [uid(), charId, 'dinghy', rollRarity(rrRoll)]);
  }
  // ═══ STEP THREE — the resident's STABLE, so the PvP boards are LIVE in an empty alpha ═══
  // A fighter/racer is an ownership row with no conservation check. The listing is what makes the
  // board real, and it obeys the recycle-only rule: a resident may only ever advertise a stake they
  // ALREADY HOLD (a share of their own pocket), and one who cannot reach the system's own floor
  // simply DOESN'T LIST — a limit under MIN_STAKE sits in an empty window and reads as a dead board
  // (the step-two F2 lesson). Nothing here initiates: a player always makes the match.
  const stake = Math.floor(cash * M.STAKE_BPS / 10000);
  if (wants('fighter')) {
    const lim = stake >= BOXING.MIN_STAKE ? Math.min(stake, BOXING.MAX_STAKE) : null;
    await client.query('INSERT INTO fighters (id, character_id, name, power, chin, speed, bout_limit) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [uid(), charId, `${pick(NPC_FIRST)} '${pick(FIGHTER_MONIKERS)}' ${pick(NPC_LAST)}`,
       rndInt(BOXING.STAT_MIN, BOXING.STAT_MAX), rndInt(BOXING.STAT_MIN, BOXING.STAT_MAX), rndInt(BOXING.STAT_MIN, BOXING.STAT_MAX), lim]);
  }
  if (wants('racer')) {
    const kind = Math.random() < 0.5 ? 'dog' : 'horse';
    const k = stableKindOf(kind);
    const lim = stake >= STABLE.MIN_STAKE ? Math.min(stake, STABLE.MAX_STAKE) : null;
    await client.query('INSERT INTO racers (id, character_id, kind, name, speed, stamina, heart, race_limit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [uid(), charId, kind, `${pick(RACER_NAMES)}`,
       rndInt(k.statMin, k.statMax), rndInt(k.statMin, k.statMax), rndInt(k.statMin, k.statMax), lim]);
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
    'SELECT id, account_id, cash, bank FROM characters WHERE id=$1 AND alive AND is_npc FOR UPDATE', [charId])).rows[0];
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

  // (AUDIT-street-life F1) A TAKEN loan must not outlive its lender. Retirement is not a death —
  // runEstate/voidLoansAtDeath never see this character and there is no heir — so an active loan
  // would strand pointing at a dead lender: the borrower CANNOT repay (the two-party repay needs a
  // living lender → 'gone'), yet sweepLoans would brand them welsher + WANTED for the unpayable
  // debt, and a pledged car would grace-forfeit into a dead fleet. The claim voids instead: the
  // pledge unlocks, the borrower keeps the principal (it moved at take-time — §10.4-neutral, zero
  // ledger rows), and they're told the book closed. Lock order characters → loans (the sweep's).
  const actives = (await client.query(
    "SELECT id, borrower_character, collateral_car FROM loans WHERE lender_character=$1 AND status='active' FOR UPDATE", [charId])).rows;
  for (const l of actives) {
    if (l.collateral_car) await client.query('UPDATE cars SET pledged=false WHERE id=$1', [l.collateral_car]);
    await client.query('DELETE FROM loans WHERE id=$1', [l.id]);
    if (l.borrower_character) await notify(client, l.borrower_character, 'loan_voided', { reason: 'lender_gone' }).catch(() => {});
  }
  // (F5) a pending contact call from this resident dies with them — otherwise it jams the player's
  // one-open-call slot until the TTL sweep (fulfilment would only ever find 'gone').
  await client.query('DELETE FROM contact_calls WHERE npc_character=$1', [charId]);
  // (Lens C LOW-1) and so does their line in every black book: retirement leaves NO heir (unlike a
  // death), so a kept contact row would render `street: null` FOREVER — permanent dead clutter, one
  // row per retired resident a long-lived player ever met, with no sweep to reap it. A PLAYER's
  // number surviving death is the design (the heir answers); a retired resident's number is a
  // disconnected line, so it goes with them, both directions.
  await client.query('DELETE FROM contacts WHERE owner_account=$1 OR contact_account=$1', [c.account_id]);

  const held = Number(c.cash) + Number(c.bank) + reclaimed;
  if (held > 0) {
    await client.query(
      'INSERT INTO transactions (id, character_id, currency, amount, reason) VALUES ($1,$2,$3,$4,$5)',
      [uid(), charId, 'cash', -held, 'npc:retire']);
  }
  // STEP TWO marks leave WITH the resident (retirement is not a death, so runEstate's wipe +
  // telemetry never see these rows — each class squares its own books here):
  //  · cars: one rng_audit 'npc:car' retire row PER row deleted, so the car-conservation
  //    invariant (rows == boosts + grants − melts − fences − deaths − retires) stays exact;
  //  · boats/fronts/cargo: ownership rows with no conservation check — plain deletes.
  const carRows = (await client.query('SELECT id FROM cars WHERE character_id=$1', [charId])).rows;
  for (const car of carRows) {
    await client.query('DELETE FROM cars WHERE id=$1', [car.id]);
    await client.query('INSERT INTO rng_audit (id, character_id, action, roll, outcome) VALUES ($1,$2,$3,0,$4)',
      [uid(), charId, 'npc:car', 'retire']);
  }
  await client.query('DELETE FROM boats WHERE character_id=$1', [charId]);
  await client.query('DELETE FROM businesses WHERE character_id=$1', [charId]);
  // the stable leaves with them (step three) — a retired resident's fighter must not linger on the
  // circuit board taking bouts nobody can collect, the same reason their loan escrow is reclaimed.
  //
  // (audit F2) Through `wipeFighterAtDeath`, NOT a bare DELETE: retirement is not a death, so the
  // estate hooks never run — and a resident's fighter CAN hold the belt (applyBeltResult keys on the
  // fighter, not on who manages it). A bare delete left `boxing_title` pointing at a row that no
  // longer exists and a character who is no longer alive: a phantom champion on every board until the
  // 7-day mandatory-defense clock stripped it. The estate hook already vacates the belt and any
  // pending callout, in the canonical fighter→title lock order. The same retirement-is-not-a-death
  // class as the step-two stranded-loan finding.
  await wipeFighterAtDeath(client, charId);
  await client.query('DELETE FROM racers WHERE character_id=$1', [charId]);
  await client.query('DELETE FROM character_cargo WHERE character_id=$1', [charId]);
  // NPC FAMILIES: a retiring resident LEAVES their family, through the audited removeMember. This
  // is retirement-is-not-a-death again (the stranded-loan and phantom-champion findings): runEstate
  // never sees this character, so a kept membership row would be a phantom made man on the roster,
  // counting against GANG_MAX_MEMBERS — and if they were the LAST member, a family that never
  // dissolves and never ledgers `gang:dissolved`, which is a permanent §10.4 treasury drift.
  // removeMember handles succession, dissolution and the ledger; it takes the gang lock itself, and
  // this txn already holds the character lock, so gangs-after-characters order is kept.
  const mem = (await client.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [charId])).rows[0];
  if (mem) await removeMember(client, mem.gang_id, charId);
  // AUDIT-hired-guns (retirement-is-not-a-death, again): a resident hired into a co-op op — a crew
  // heist (fillHeist) or a World raid (THE HIRED GUNS) — leaves a member row the DEATH wipe (runEstate
  // line ~202) deletes but retirement did not. A stale alive=false row makes executeHeist/executeRaid
  // lock the member `AND alive FOR UPDATE`, get nothing, and throw crew_not_ready ("in the ground") —
  // bricking the leader's op until they disband (self-heals, no §10.4: no stake on the member, the
  // heist stake sits on the LEADER and refunds whole on disband). Removing the row instead lets the
  // leader HIRE A REPLACEMENT — the graceful death-path outcome. A resident is never a leader (planning
  // is a player route), so a bare DELETE of its own membership never abandons a plan.
  await client.query('DELETE FROM crew_heist_members WHERE character_id=$1', [charId]);
  await client.query('DELETE FROM world_raid_members WHERE character_id=$1', [charId]);
  // AUDIT-street-war-street-life F1/F2/F4: retirement is not a death, so runEstate never sees this
  // resident — but OTHER players may have pointed rows at it (hired it as a bodyguard, tapped it,
  // put a search/secret/npc-hit on it, a family aggro'd it). runEstate clears those; retire must too,
  // or a player is left paid+unprotected+locked-out (the guard pointer) or a tap slot burns. Shared
  // helper so this can't drift from the death path. (Bounty pots on the resident resolve via the
  // expiry sweep's refund — deliberately not death-burned here.)
  await clearInboundPointers(client, charId, c.account_id);
  // A resident accrues mastery XP headlessly — `bumpMastery(client, null, winner, …)` fires when a
  // player loses a duel to one, and residents list duel stakes. `runEstate` wipes `masteries`;
  // retirement never did, so the rows outlived the character. Unreachable rather than harmful (the
  // Trades board ranks account-keyed `mastery_legend` and excludes residents), but a character-scoped
  // table that survives its character is the shape every retirement-vs-death bug here has taken.
  await client.query('DELETE FROM masteries WHERE character_id=$1', [charId]);
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

// A resident committed to a live CO-OP plan is INERT — never retired out from under the job, and never
// given a behaviour turn while on it (residents-in-crews). Covers BOTH co-op surfaces: a crew heist
// (fillHeist) and a World raid (THE HIRED GUNS). Without the world-raid half, the worker could retire a
// merc a leader paid the HIRE_FEE for, out from under a planning raid — retireResident deletes the
// member row, so the raid comes up short and the leader must re-hire and pay the fee AGAIN, through no
// action of their own (the crew_heist path already blocks exactly this). Both `crew_heists` and
// `world_raids` get a stale-plan sweep, so an abandoned plan can never strand a resident here forever.
// Defined ONCE (the retirement picker and the behaviour picker had separate copies — the drift risk).
const NOT_ON_A_JOB = `AND id NOT IN (SELECT m.character_id FROM crew_heist_members m
                        JOIN crew_heists ch2 ON ch2.id = m.heist_id WHERE ch2.status='planning')
                      AND id NOT IN (SELECT wm.character_id FROM world_raid_members wm
                        JOIN world_raids wr ON wr.id = wm.raid_id WHERE wr.status='planning')`;

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
    `SELECT id FROM characters WHERE alive AND is_npc AND generation > $1 ${NOT_ON_A_JOB} ORDER BY id LIMIT $2`,
    [POPULATION.RETIRE_GENERATIONS, room])).rows;
  // "picked clean" is measured against what they ARRIVED with (npc_seed), never a flat cash floor —
  // a flat floor can't tell a drained boss from a corner kid born with $200, and would recycle the
  // cheap bands forever. `npc_seed > 0` also skips residents not yet stamped, so an unknown stake is
  // never mistaken for a drained one.
  const oldIds = new Set(oldAll.map((r) => r.id));
  const drainedAll = room <= 0 ? [] : (await pool.query(
    `SELECT id FROM characters WHERE alive AND is_npc AND npc_seed > 0
       AND cash < npc_seed * $1 / 10000.0 ${NOT_ON_A_JOB} ORDER BY id LIMIT $2`,
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
  // 4. NPC FAMILIES — somewhere to belong. See runFamilies for why this is one step and not three.
  try { Object.assign(out, await runFamilies(pool)); }
  catch (e) { console.error('[population] families failed', e.message); }

  out.population = await population(pool);
  return out;
}

// ════════════════════ NPC FAMILIES (omerta-npc-families-design.md) ════════════════════
//
// The coach's first social rung — "Nobody survives alone" — held 43% of a measured 7-day solo run
// and could never be acted on: on a thin server `GET /v1/gangs` is empty, so the only actionable
// half is FOUNDING one, at level 5 and $25,000. Residents found and fill families so there is
// something to walk into, exactly as the population lit up every other board that reads
// `characters`.
//
// The founding cost comes out of the founder's own `npc:seed` cash, so this adds NO faucet — the
// resident economy can only get smaller from it. §10.4 surface is two already-audited reasons:
// `gang:found` (the sink) and, when the last member goes, the existing `gang:dissolved` burn.

/**
 * The headless context the audited gang functions want. They take an `h` for the ledger and for the
 * caller's loaded state; a resident has neither, so this supplies the ledger and an empty `owned`
 * for them to write into. `createGang` deducts `ch.cash` IN MEMORY and leaves persistence to the
 * caller (the player path's persistCharacter), so writing that back is the one thing owned here.
 */
const stubH = () => ({ owned: {}, ledger: (client, row) => ledger(client, row) });

/** Keep POPULATION.FAMILIES.TARGET families alive and populated. One family founded/filled per tick. */
export async function runFamilies(pool) {
  const F = POPULATION.FAMILIES;
  const out = { familiesFounded: 0, familiesJoined: 0 };
  if (!F || F.TARGET <= 0) return out;                        // TARGET 0 disables the feature entirely

  const live = (await pool.query('SELECT id, name FROM gangs WHERE npc_flag')).rows;
  if (live.length < F.TARGET) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (await foundNpcFamily(client)) out.familiesFounded++;
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[population] found family failed', e.message);
    } finally { client.release(); }
    // one structural change per tick — the city fills in visibly (the SPAWN_PER_TICK rule). But
    // only if founding ACTUALLY happened: returning unconditionally would let a city where nobody
    // can cover the fee starve the recruit pass FOREVER, so families under MIN_MEMBERS would never
    // be filled. That is the shared-budget starvation the JAILBIRDS-vs-turnover finding (T1) named,
    // in a second costume — two passes, one budget, the first taking priority whether or not it can
    // use it. If it could not found, fall through and spend the tick on recruiting instead.
    if (out.familiesFounded) return out;
  }

  // recruit into the thinnest family under MIN_MEMBERS. Counting MEMBERS, not residents: a player
  // who joined counts, which is the point — a family a player is already in does not need padding.
  for (const g of live) {
    const n = Number((await pool.query('SELECT COUNT(*) n FROM gang_members WHERE gang_id=$1', [g.id])).rows[0].n);
    if (n >= F.MIN_MEMBERS) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (await recruitIntoFamily(client, g.id)) out.familiesJoined++;
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[population] recruit failed', g.id, e.message);
    } finally { client.release(); }
    break;
  }
  return out;
}

/** A capo/boss-band resident with the founding fee to spare puts a name up. */
async function foundNpcFamily(client) {
  const F = POPULATION.FAMILIES;
  // a name nobody has taken — createGang's clash check would refuse it anyway, but picking a free
  // one first means a full pool reads as "no room" rather than as a failed transaction every tick
  const taken = new Set((await client.query('SELECT name FROM gangs')).rows.map((r) => r.name));
  const free = F.NAMES.filter(([name]) => !taken.has(name));
  if (!free.length) return false;
  const [name, tag] = pick(free);

  // the founder: unaffiliated, in a band that can carry the fee, and left holding enough afterwards
  // to stay worth robbing (the KEEP_FLOOR rule — a resident is scenery with a wallet)
  const lvls = F.FOUND_BANDS.map((id) => POPULATION.BANDS.find((b) => b.id === id)).filter(Boolean);
  if (!lvls.length) return false;
  const minLvl = Math.min(...lvls.map((b) => b.lvl[0]));
  // two flat queries + a JS filter, never a correlated NOT EXISTS — pg-mem cannot parse one, so the
  // whole path would be untestable and (worse) fail silently inside the worker's per-job catch,
  // producing zero families forever with nothing on screen saying why. The /v1/gangs precedent.
  const inGang = new Set((await client.query('SELECT character_id FROM gang_members')).rows.map((r) => r.character_id));
  const cand = (await client.query(
    'SELECT * FROM characters WHERE alive AND is_npc AND respect >= $1 ORDER BY cash DESC LIMIT 32',
    [respectFor(minLvl)])).rows
    .filter((c) => !inGang.has(c.id) && spendable(c.cash) >= M3.GANG_FOUND_COST);
  if (!cand.length) return false;

  // RE-READ THE CHOSEN FOUNDER UNDER A ROW LOCK, and use the LOCKED row from here on. The shortlist
  // above is an unlocked read, and `createGang` deducts the fee IN MEMORY, leaving the caller to
  // write the resulting cash back ABSOLUTELY — so without this, anything that debits this resident
  // between the two (the ordinary crime TAKE, which targets exactly these residents; a `residentAct`
  // escrow; a player robbing them) is CLOBBERED by the writeback. That is a §10.4 drift the ledger
  // check sees but nothing else does: `gang:found` books −25,000 while the row only falls 25,000
  // from a stale figure, so the take's own ledger row is left with no matching movement. Measured on
  // the seam at exactly the clobbered amount. Every other resident writer here already re-reads FOR
  // UPDATE first (retireResident, residentAct) — this is that rule, applied.
  const ch = (await client.query(
    'SELECT * FROM characters WHERE id=$1 AND alive AND is_npc FOR UPDATE', [cand[0].id])).rows[0];
  if (!ch) return false;
  // and re-verify under the lock: they may have been drained, or joined a family, since the shortlist
  if (spendable(ch.cash) < M3.GANG_FOUND_COST) return false;
  if ((await client.query('SELECT 1 FROM gang_members WHERE character_id=$1', [ch.id])).rows.length) return false;

  const h = stubH();
  await createGang(ch, name, tag, client, h);          // validates, clash-checks, ledgers `gang:found`
  await client.query('UPDATE characters SET cash=$2 WHERE id=$1', [ch.id, ch.cash]);   // createGang deducts in memory
  // THE BLOOD WAR (step two): seed the family's war_pool at full strength — a fresh outfit defends hard
  // and pays well (regen-bounded thereafter). NOT a §10.4 bucket (a strength reservoir, the world precedent).
  await client.query('UPDATE gangs SET npc_flag=true, war_pool=$2, war_pool_at=now() WHERE id=$1', [h.owned.gangId, FAMILY_WAR.POOL_MAX]);
  return true;
}

/** Put one more resident on a thin family's roster. */
async function recruitIntoFamily(client, gangId) {
  const F = POPULATION.FAMILIES;
  const n = Number((await client.query('SELECT COUNT(*) n FROM gang_members WHERE gang_id=$1', [gangId])).rows[0].n);
  if (n >= F.MAX_MEMBERS) return false;   // never near GANG_MAX_MEMBERS, so a player always has room
  const inGang = new Set((await client.query('SELECT character_id FROM gang_members')).rows.map((r) => r.character_id));
  const cand = (await client.query(
    'SELECT * FROM characters WHERE alive AND is_npc ORDER BY id LIMIT 64')).rows.find((c) => !inGang.has(c.id));
  if (!cand) return false;
  await joinGang(cand, gangId, client, stubH());       // locks the gang row; enforces the count invariant
  return true;
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

  // (audit F3) STALE STABLE LISTINGS — maintenance, not the turn. The step-two fix ("a drained
  // resident's advertised stake must trigger a relist instead of standing on the board answering only
  // `their_cash`") covered the three CHARACTER columns; step three added two MORE consent listings, on
  // the fighters/racers rows, and nothing ever re-checked them. A resident drained by THE TAKE — or by
  // losing the very bouts they advertise — kept a limit sized to the cash they used to have, so the
  // circuit and the strip advertised purses they cannot cover: the exact dead board that fix exists to
  // kill. Same `uncoverable` predicate as the three columns below, so a healthy listing never churns;
  // a resident who can no longer reach the system's own floor is DELISTED (NULL) rather than left in
  // an unchallengeable window.
  const MK = POPULATION.MARKS;
  const stakeNow = bps(cash, MK.STAKE_BPS);
  await client.query('UPDATE fighters SET bout_limit=$2 WHERE character_id=$1 AND bout_limit > $3',
    [r.id, stakeNow >= BOXING.MIN_STAKE ? Math.min(stakeNow, BOXING.MAX_STAKE) : null, cash]);
  await client.query('UPDATE racers SET race_limit=$2 WHERE character_id=$1 AND race_limit > $3',
    [r.id, stakeNow >= STABLE.MIN_STAKE ? Math.min(stakeNow, STABLE.MAX_STAKE) : null, cash]);

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

  // 1.5 FILL A SCHEDULED FIELD (step four) — a resident standing at the Neon Mile joins a human-started
  //     poker tournament so a solo player gets a real field instead of a refund. Reactive + recycle-only
  //     (the resident's own buy-in into the same escrow; §10.4 untouched), so most turns it's a no-op and
  //     the resident falls through to the boards below. Each helper is REACTIVE (a no-op unless a human has
  //     already opened that event) and gates on its own prereqs (district / a car / a racer), so most turns
  //     these are cheap no-ops. See casino.js:residentEnterTournament & residentNominateFuturity,
  //     races.js:residentEnterGrandPrix, stable.js:residentEnterStakes.
  for (const fill of [residentEnterTournament, residentEnterGrandPrix, residentEnterStakes, residentNominateFuturity]) {
    const joined = await fill(client, r);
    if (joined) return joined;
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

  // 3.5 FREIGHT (step two of THE STREET WAR) — a resident sometimes carries trade goods, so the
  //     trunk-robbery loop is live in an empty alpha. RECYCLE-ONLY: bought with the resident's OWN
  //     seed cash at the real market price + the 2% house take, mirroring buyGood's accounting
  //     exactly (`goods:buy:<id>` sink + takeHouse) — the robbery later realizes what the resident
  //     already paid, never conjures. Budget floored by spendable() + GOODS_BPS so a freighted
  //     resident can never read as picked-clean (the DRAINED_BPS margin holds).
  const carrying = Number((await client.query(
    'SELECT COALESCE(SUM(qty),0) n FROM character_cargo WHERE character_id=$1', [r.id])).rows[0].n);
  if (carrying === 0) {
    const good = pick(GOODS);
    const unit = Math.round(goodPriceOf(good.id, r.loc));
    const budget = Math.min(spendable(Number(r.cash)), bps(Number(r.cash), POPULATION.MARKS.GOODS_BPS));
    const qty = Math.min(POPULATION.MARKS.GOODS_MAX_UNITS, Math.floor(budget / (unit * 1.02)));
    if (qty >= 1) {
      const cost = unit * qty, fee = Math.ceil(cost * 0.01), tax = Math.ceil(cost * 0.01);
      await client.query('UPDATE characters SET cash = cash - $2 WHERE id=$1', [r.id, cost + fee + tax]);
      await client.query('INSERT INTO transactions (id, character_id, currency, amount, reason) VALUES ($1,$2,$3,$4,$5)',
        [uid(), r.id, 'cash', -(cost + fee + tax), `goods:buy:${good.id}`]);
      await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [tax]);
      await client.query('INSERT INTO character_cargo (character_id, good_id, qty) VALUES ($1,$2,$3)',
        [r.id, good.id, qty]);
      return 'freighted';
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
        ${NOT_ON_A_JOB}
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

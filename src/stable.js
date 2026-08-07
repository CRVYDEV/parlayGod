// THE STABLE — own the dogs & the ponies (the ownership layer under The Track's betting card).
// The boxing-stable pattern applied to racing animals: BUY a young racer (a cash SINK), TRAIN up its
// speed/stamina/heart (a cash+energy SINK, capped), then RACE it — the PvE CIRCUIT (a fee BURNS win or
// lose, a purse pays only on a win; the ONE new faucet, the boxing-exhibition twin) or a PvP MATCH RACE
// (the audited casino:pvp taxed transfer, never a new faucet, never an escrow). SPEED FORM = speed +
// stamina + heart + rand(VARIANCE). Dogs race dogs, horses race horses. Racers DIE WITH THE STREET (the
// racers rows join the runEstate wipe — the fighters precedent); the owner's lifetime wins are an
// account-level LEGEND (survives death, the boxing-legend/hitman-rep precedent). CASH ONLY (the Den's rule).
import crypto from 'node:crypto';
import { recordEventResult } from './events.js';
import { GameError, bus, ledger, notify, rngLog, bumpStanding, npcMult, npcTier } from './game.js';
import { STABLE, UNDERWORLD, POPULATION, stableKindOf, stableMeetOf, racerRankOf, racerLegendOf, levelOf , jailed, hospitalized } from './rules.js';

const stakesMs = () => Number(process.env.STAKES_MS) || STABLE.STAKES.REGISTER_MS; // TEST-ONLY env (SEARCH_MS pattern)

const injured = (r) => r.injured_until && new Date(r.injured_until) > new Date();
const onCooldown = (r) => r.circuit_at && new Date(r.circuit_at) > new Date();
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const form = (r) => Number(r.speed) + Number(r.stamina) + Number(r.heart);
const secsTo = (t) => (t && new Date(t) > new Date()) ? Math.ceil((new Date(t).getTime() - Date.now()) / 1000) : 0;

// bump the OWNER's lifetime racing wins (account-level, survives death — never through the in-memory
// acct, so persistAccount can't clobber it — the boxing-legend/kills precedent).
const bumpLegend = (client, accountId) =>
  client.query('UPDATE account_persistent SET racer_wins = racer_wins + 1 WHERE account_id=$1', [accountId]);

// a shared view of one racer
const racerView = (r) => ({
  id: r.id, kind: r.kind, kindName: stableKindOf(r.kind)?.name || r.kind, name: r.name,
  speed: Number(r.speed), stamina: Number(r.stamina), heart: Number(r.heart), form: form(r),
  record: `${Number(r.wins)}-${Number(r.losses)}`, wins: Number(r.wins), rank: racerRankOf(r.wins).name,
  raceLimit: r.race_limit == null ? null : Math.floor(Number(r.race_limit)),
  injured: !!injured(r), injuredSeconds: secsTo(r.injured_until),
  cooldownSeconds: secsTo(r.circuit_at),
});

// ── BUY a racer — level-gated, one of two kinds, stats rolled in the kind's range. A cash SINK. ──
export async function buyRacer(ch, kind, name, client, h) {
  if (jailed(ch)) throw new GameError('jailed', "You can't buy stock from a cell.");
  if (levelOf(Number(ch.respect)) < STABLE.MIN_LEVEL)
    throw new GameError('level', `Owning a racer opens up at level ${STABLE.MIN_LEVEL}.`);
  const k = stableKindOf(kind);
  if (!k) throw new GameError('kind', "Buy a 'dog' (greyhound) or a 'horse' (racehorse).");
  const n = String(name || '').trim();
  if (n.length < 3 || n.length > 24) throw new GameError('name', "A racer's name runs 3–24 characters.");
  if (!/^[\w .,'&-]+$/.test(n)) throw new GameError('name', 'Letters, numbers and simple punctuation only.');
  const count = Number((await client.query('SELECT COUNT(*) n FROM racers WHERE character_id=$1', [ch.id])).rows[0].n);
  if (count >= STABLE.STABLE_MAX) throw new GameError('stable_full', `Your stable is full (${STABLE.STABLE_MAX} racers).`);
  if (Number(ch.cash) < k.cost) throw new GameError('cash', `A ${k.name} runs $${k.cost}.`);
  ch.cash = Number(ch.cash) - k.cost;
  const id = crypto.randomUUID();
  const speed = rand(k.statMin, k.statMax), stamina = rand(k.statMin, k.statMax), heart = rand(k.statMin, k.statMax);
  await client.query('INSERT INTO racers (id, character_id, kind, name, speed, stamina, heart) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, ch.id, kind, n, speed, stamina, heart]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -k.cost, reason: 'stable:buy' });
  await bumpStanding(client, h, ch, 'cornerman', 3, { action: 'sign' }); // Mickey trains your animals too (the Underworld tie-in)
  await h.track(client, ch.account_id, 'stable_buy', { kind });
  return { ok: true, id, kind, name: n, speed, stamina, heart, stable: count + 1 };
}

// fetch one of YOUR racers by id, locked (the ownership gate for train/list/race).
async function myRacer(client, ch, racerId) {
  const r = (await client.query('SELECT * FROM racers WHERE id=$1 FOR UPDATE', [racerId])).rows[0];
  if (!r || r.character_id !== ch.id) throw new GameError('no_racer', "That's not one of your racers.");
  return r;
}

// ── TRAIN — cash + energy → +1 to a stat, capped. A cash SINK. ──
export async function trainRacer(ch, racerId, stat, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No morning workouts from a cell.');
  const s = String(stat || '').toLowerCase();
  if (!STABLE.STATS.includes(s)) throw new GameError('bad_stat', 'Train speed, stamina or heart.');
  const r = await myRacer(client, ch, racerId);
  if (injured(r)) throw new GameError('injured', 'That racer is laid up — let them heal.');
  if (Number(r[s]) >= STABLE.STAT_CAP) throw new GameError('maxed', `Their ${s} is already maxed (${STABLE.STAT_CAP}).`);
  if (Number(ch.energy) < STABLE.TRAIN_ENERGY) throw new GameError('energy', `Need ${STABLE.TRAIN_ENERGY} energy to work them.`);
  // THE CORNERMAN (Underworld tie-in): Mickey trains your animals too — his T1 discount + T3 build bonus
  // apply exactly as they do to a boxer (status axis, the discounted number is what's ledgered; the build
  // bonus never lifts the STAT_CAP ceiling → the circuit faucet EV is unchanged).
  const cost = Math.round(STABLE.TRAIN_COST * npcMult(h, 'cornerman', 1, UNDERWORLD.FX.CORNER_TRAIN_MULT));
  const gain = STABLE.TRAIN_GAIN + (npcTier(h, 'cornerman') >= 3 ? UNDERWORLD.FX.CORNER_GAIN : 0);
  if (Number(ch.cash) < cost) throw new GameError('cash', `A session runs $${cost}.`);
  ch.cash = Number(ch.cash) - cost;
  ch.energy = Number(ch.energy) - STABLE.TRAIN_ENERGY;
  const nv = Math.min(STABLE.STAT_CAP, Number(r[s]) + gain); // absolute write (pg-mem INT-arith quirk)
  await client.query(`UPDATE racers SET ${s}=$2 WHERE id=$1`, [r.id, nv]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'stable:train' });
  await bumpStanding(client, h, ch, 'cornerman', 1, { action: 'train' }); // working the animals is the corner's business (his daily lead)
  await h.track(client, ch.account_id, 'stable_train', { stat: s });
  return { ok: true, id: r.id, stat: s, value: nv };
}

// ── LIST one of your racers as TAKING MATCH RACES at a wager (consent-by-listing). null/0 clears. ──
export async function listRacer(ch, racerId, limit, client, h) {
  const r = await myRacer(client, ch, racerId);
  const v = limit == null || Number(limit) === 0 ? null : Math.floor(Number(limit));
  if (v != null && !(Number.isFinite(v) && v >= STABLE.MIN_STAKE && v <= STABLE.MAX_STAKE))
    throw new GameError('stake', `Match wagers run $${STABLE.MIN_STAKE}–$${STABLE.MAX_STAKE} (0 clears).`);
  await client.query('UPDATE racers SET race_limit=$2 WHERE id=$1', [r.id, v]);
  return { ok: true, id: r.id, raceLimit: v };
}

// ── THE CIRCUIT — your racer vs a server-rolled NPC field. The fee is a cash SINK win or lose; the
// purse a cash FAUCET only on a win (net-positive only vs a beatable field). A per-racer cooldown +
// injury-on-loss bound it. NEW faucet — sim + founder sign-off (stable:purse rides the stable: vocab). ──
export async function raceCircuit(ch, racerId, meetId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No race days from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp', "You're in no shape to run them.");
  const r = await myRacer(client, ch, racerId);
  const meet = stableMeetOf(r.kind, meetId);
  if (!meet) throw new GameError('bad_meet', 'No such meet on that card.');
  if (injured(r)) throw new GameError('injured', 'That racer is laid up — let them heal.');
  if (onCooldown(r)) throw new GameError('cooldown', `${r.name} needs to rest before another race.`);
  if (Number(ch.cash) < meet.fee) throw new GameError('cash', `The ${meet.name} entry runs $${meet.fee}.`);
  // the entry fee burns win or lose
  ch.cash = Number(ch.cash) - meet.fee;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -meet.fee, reason: 'stable:fee' });
  let mine, theirs;
  do { mine = form(r) + rand(0, STABLE.VARIANCE); theirs = meet.form + rand(0, STABLE.VARIANCE); } while (mine === theirs);
  const win = mine > theirs;
  await client.query('UPDATE racers SET circuit_at=$2 WHERE id=$1', [r.id, new Date(Date.now() + STABLE.CIRCUIT_CD_MS)]);
  if (win) {
    ch.cash = Number(ch.cash) + meet.purse;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: meet.purse, reason: 'stable:purse' });
    await client.query('UPDATE racers SET wins=$2 WHERE id=$1', [r.id, Number(r.wins) + 1]);
    await bumpLegend(client, ch.account_id);
  } else {
    await client.query('UPDATE racers SET losses=$2, injured_until=$3 WHERE id=$1', [r.id, Number(r.losses) + 1, new Date(Date.now() + STABLE.INJURY_MS)]);
  }
  await bumpStanding(client, h, ch, 'cornerman', 1, { action: 'race' }); // race day is the corner's business
  await h.rngLog(client, ch.id, `stable:circuit:${meet.id}`, mine, `${win ? 'win' : 'loss'} vs ${meet.name} (${mine} vs ${theirs})`);
  await h.track(client, ch.account_id, 'stable_circuit', { kind: r.kind, meet: meet.id, win });
  return { ok: true, game: 'circuit', win, meet: meet.name, fee: meet.fee, purse: win ? meet.purse : 0,
    net: win ? meet.purse - meet.fee : -meet.fee, you: { name: r.name, score: mine }, them: { name: meet.name, score: theirs },
    record: win ? `${Number(r.wins) + 1}-${r.losses}` : `${r.wins}-${Number(r.losses) + 1}` };
}

// ── MATCH RACE — YOUR racer vs a listed opponent racer, both owners stake the wager; the winner takes
// it minus the vig (the casino:pvp split). Two-party. Same kind only. The LOSER's racer is laid up. The
// winner's OWNER banks a lifetime win (the legend). No new faucet, no escrow — a taxed TRANSFER. ──
export async function matchRace(ch, opponent, body, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No race days from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp', "You're in no shape to run them.");
  if (opponent.id === ch.id) throw new GameError('self', "You don't race your own stable against itself.");
  if (h.owned.gangId && h.victimOwned.gangId === h.owned.gangId) throw new GameError('family', "They're family — no family matchups.");
  const amt = Math.floor(Number(body?.stake));
  if (!(Number.isFinite(amt) && amt >= STABLE.MIN_STAKE)) throw new GameError('min', `The minimum wager is $${STABLE.MIN_STAKE}.`);
  if (jailed(opponent) || hospitalized(opponent)) throw new GameError('unavailable', "Their owner can't make a match right now.");
  // lock both racer rows in sorted id order (leaf ordering; the char rows are already locked by withTwoCharacters)
  const [first, second] = [String(body?.myRacer || ''), String(body?.theirRacer || '')].sort();
  await client.query('SELECT 1 FROM racers WHERE id=$1 FOR UPDATE', [first]);
  await client.query('SELECT 1 FROM racers WHERE id=$1 FOR UPDATE', [second]);
  const r = (await client.query('SELECT * FROM racers WHERE id=$1', [body?.myRacer])).rows[0];
  const or = (await client.query('SELECT * FROM racers WHERE id=$1', [body?.theirRacer])).rows[0];
  if (!r || r.character_id !== ch.id) throw new GameError('no_racer', 'Pick one of your own racers.');
  if (!or || or.character_id !== opponent.id) throw new GameError('no_opponent', "That racer isn't in their stable.");
  if (r.kind !== or.kind) throw new GameError('kind', `A ${r.kind} races ${r.kind}s — match the kind.`);
  const limit = or.race_limit != null ? Math.floor(Number(or.race_limit)) : 0;
  if (!(limit > 0)) throw new GameError('not_listed', "Their racer isn't taking match races.");
  if (amt > limit) throw new GameError('limit', `Their racer takes matches up to $${limit}.`);
  if (injured(r)) throw new GameError('injured_self', 'Your racer is laid up — let them heal.');
  if (injured(or)) throw new GameError('injured_them', 'Their racer is laid up right now.');
  if (Number(ch.cash) < amt) throw new GameError('cash', 'Not that much in pocket for the wager.');
  if (Number(opponent.cash) < amt) throw new GameError('their_cash', "They can't cover the wager right now.");
  let mine, theirs;
  do { mine = form(r) + rand(0, STABLE.VARIANCE); theirs = form(or) + rand(0, STABLE.VARIANCE); } while (mine === theirs);
  const win = mine > theirs;
  const pot = amt * 2;
  const rake = Math.ceil(pot * STABLE.RAKE_BPS / 10000);
  const winner = win ? ch : opponent, loser = win ? opponent : ch;
  const winnerR = win ? r : or, loserR = win ? or : r;
  loser.cash = Number(loser.cash) - amt;
  winner.cash = Number(winner.cash) + amt - rake; // their own stake never left; net +stake − rake (casino:pvp accounting)
  await h.ledger(client, { characterId: loser.id, currency: 'cash', amount: -amt, reason: 'stable:race', counterparty: winner.id });
  await h.ledger(client, { characterId: winner.id, currency: 'cash', amount: amt - rake, reason: 'stable:race', counterparty: loser.id });
  // records + injury — absolute INT writes (pg-mem arithmetic-UPDATE quirk)
  await client.query('UPDATE racers SET wins=$2 WHERE id=$1', [winnerR.id, Number(winnerR.wins) + 1]);
  await client.query('UPDATE racers SET losses=$2, injured_until=$3 WHERE id=$1', [loserR.id, Number(loserR.losses) + 1, new Date(Date.now() + STABLE.INJURY_MS)]);
  // the owner LEGEND (racer_wins) only counts vs a loser at/above the floor — anti-Sybil (the RACES.WHEEL_MIN_LVL
  // precedent; a status board can't be farmed by beating a fresh throwaway alt over and over)
  if (levelOf(Number(loser.respect)) >= STABLE.LEGEND_MIN_LVL) await bumpLegend(client, winner.account_id);
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [Math.floor(rake / 2)]); // half → the buyback, half burns
  await h.rngLog(client, ch.id, `stable:race:${or.id}`, mine, `${win ? 'win' : 'loss'} $${amt} (${mine} vs ${theirs})`);
  await h.notify(client, opponent.id, 'stable_race', { from: ch.name, yours: or.name, mine: r.name, amount: amt, theyWon: !win });
  bus.emit('streets', { type: 'match_race', by: ch.name, racers: `${r.name} v ${or.name}`, amount: pot, win });
  await h.track(client, ch.account_id, 'stable_race', { amt, win });
  return { ok: true, game: 'race', win, wager: amt, rake, net: win ? amt - rake : -amt,
    you: { name: r.name, score: mine }, them: { name: or.name, score: theirs },
    yourRacer: win ? `${Number(r.wins) + 1}-${r.losses}` : `${r.wins}-${Number(r.losses) + 1}` };
}

// ── BREEDING (step two) — retire two same-kind racers into stud → a FOAL that inherits a fraction of
// the parents' average stat (a head start, NOT a cap-skip). A cash SINK; both parents are CONSUMED. ──
export async function breedRacers(ch, sireId, damId, name, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No stud farm business from a cell.');
  if (String(sireId) === String(damId)) throw new GameError('same', 'Breeding takes two different racers.');
  const n = String(name || '').trim();
  if (n.length < 3 || n.length > 24) throw new GameError('name', "A foal's name runs 3–24 characters.");
  if (!/^[\w .,'&-]+$/.test(n)) throw new GameError('name', 'Letters, numbers and simple punctuation only.');
  // lock both parents (sorted) — leaf ordering; the char row is already held by withCharacter
  const [first, second] = [String(sireId), String(damId)].sort();
  await client.query('SELECT 1 FROM racers WHERE id=$1 FOR UPDATE', [first]);
  await client.query('SELECT 1 FROM racers WHERE id=$1 FOR UPDATE', [second]);
  const sire = (await client.query('SELECT * FROM racers WHERE id=$1', [sireId])).rows[0];
  const dam = (await client.query('SELECT * FROM racers WHERE id=$1', [damId])).rows[0];
  if (!sire || sire.character_id !== ch.id || !dam || dam.character_id !== ch.id)
    throw new GameError('no_racer', 'Both parents must be your own racers.');
  if (sire.kind !== dam.kind) throw new GameError('kind', 'A dog and a horse cannot be bred — match the kind.');
  if (Number(ch.cash) < STABLE.BREED_COST) throw new GameError('cash', `The stud fee runs $${STABLE.BREED_COST}.`);
  const k = stableKindOf(sire.kind);
  const foal = (stat) => Math.max(k.statMin, Math.min(STABLE.STAT_CAP,
    Math.floor((Number(sire[stat]) + Number(dam[stat])) / 2 * STABLE.BREED_INHERIT) + rand(0, STABLE.BREED_VARIANCE)));
  const speed = foal('speed'), stamina = foal('stamina'), heart = foal('heart');
  ch.cash = Number(ch.cash) - STABLE.BREED_COST;
  await client.query('DELETE FROM racers WHERE id IN ($1,$2)', [sireId, damId]); // the parents retire to stud
  const id = crypto.randomUUID();
  await client.query('INSERT INTO racers (id, character_id, kind, name, speed, stamina, heart) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, ch.id, sire.kind, n, speed, stamina, heart]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -STABLE.BREED_COST, reason: 'stable:breed' });
  await bumpStanding(client, h, ch, 'cornerman', 2, { action: 'sign' });
  await h.track(client, ch.account_id, 'stable_breed', { kind: sire.kind });
  return { ok: true, id, kind: sire.kind, name: n, speed, stamina, heart, sire: sire.name, dam: dam.name };
}

// ── THE STAKES (step two) — a scheduled marquee race; enter your racer (CASH escrows, form snapshotted).
// The Grand-Prix twin on the animal side; the worker resolves it. §10.4-neutral (a redistribution). ──
export async function enterStakes(ch, racerId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No racing from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp', "You're in no shape to saddle up.");
  const r = await myRacer(client, ch, racerId);
  if (injured(r)) throw new GameError('injured', 'That racer is laid up — let them heal.');
  const buyin = STABLE.STAKES.BUYIN;
  if (Number(ch.cash) < buyin) throw new GameError('cash', `The stakes buy-in is $${buyin}.`);
  const f = form(r); // SNAPSHOT the form at entry (the racer isn't escrowed — race it, breed it, sell it after)
  // materialize/find the open stakes under the state singleton lock (LOCK ORDER: char → stakes_state → race)
  const st = (await client.query('SELECT current FROM stakes_state WHERE id=1 FOR UPDATE')).rows[0];
  let g = st.current ? (await client.query("SELECT * FROM stakes_races WHERE id=$1 AND status='open' FOR UPDATE", [st.current])).rows[0] : null;
  if (!g) {
    const id = crypto.randomUUID();
    const resolvesAt = new Date(Date.now() + stakesMs());
    await client.query('INSERT INTO stakes_races (id, status, resolves_at, pool) VALUES ($1,$2,$3,0)', [id, 'open', resolvesAt]);
    await client.query('UPDATE stakes_state SET current=$1 WHERE id=1', [id]);
    g = { id, status: 'open', resolves_at: resolvesAt, pool: 0 };
  } else if (new Date(g.resolves_at) <= new Date()) {
    throw new GameError('closed', 'The gate is set — this race is about to run. Try again after it settles.');
  }
  if ((await client.query('SELECT 1 FROM stakes_entries WHERE race_id=$1 AND character_id=$2', [g.id, ch.id])).rows[0])
    throw new GameError('entered', "You've already got a runner in this stakes.");
  ch.cash = Number(ch.cash) - buyin;
  await client.query('INSERT INTO stakes_entries (race_id, character_id, buyin, racer_name, kind, form) VALUES ($1,$2,$3,$4,$5,$6)',
    [g.id, ch.id, buyin, r.name, r.kind, f]);
  await client.query('UPDATE stakes_races SET pool = pool + $2 WHERE id=$1', [g.id, buyin]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -buyin, reason: 'stable:stakes:buyin', counterparty: g.id });
  const entrants = Number((await client.query('SELECT COUNT(*) n FROM stakes_entries WHERE race_id=$1', [g.id])).rows[0].n);
  await bumpStanding(client, h, ch, 'cornerman', 2, { action: 'race' });
  await h.track(client, ch.account_id, 'stable_stakes', { buyin });
  bus.emit('streets', { type: 'stakes_entry', who: ch.name, racer: r.name, entrants });
  return { ok: true, stakes: g.id, racer: r.name, form: f, buyin, pool: Number(g.pool) + buyin, entrants,
    closesSeconds: Math.max(0, Math.ceil((new Date(g.resolves_at) - Date.now()) / 1000)) };
}

// NPC RESIDENTS FILL A HUMAN-STARTED STAKES (THE POPULATION step four — the residentEnterTournament twin).
// A resident with a stable racer enters it, paying its OWN buy-in into the SAME escrow (recycle-only), so
// the 'stakes escrow' §10.4 identity is untouched and a solo owner gets a real field instead of a refund.
// REACTIVE ONLY (an open stakes a human already materialized). A retired/killed resident's entry auto-burns
// at resolve (the LEFT-JOIN dead path in resolveStakes), so retireResident needs no change. No track/emit
// (residents emit nothing to the wire); only residents that own a racer (Street War step three) qualify.
export async function residentEnterStakes(client, r) {
  const buyin = STABLE.STAKES.BUYIN;
  if (Number(r.cash) < buyin) return null;
  const st = (await client.query('SELECT current FROM stakes_state WHERE id=1 FOR UPDATE')).rows[0];
  if (!st?.current) return null;                         // REACTIVE: only a stakes a human already opened
  const g = (await client.query("SELECT id, resolves_at FROM stakes_races WHERE id=$1 AND status='open' FOR UPDATE", [st.current])).rows[0];
  if (!g || new Date(g.resolves_at) <= new Date()) return null;
  const entrants = Number((await client.query('SELECT COUNT(*) n FROM stakes_entries WHERE race_id=$1', [g.id])).rows[0].n);
  if (entrants >= POPULATION.EVENTS.STAKES_FIELD) return null;
  if ((await client.query('SELECT 1 FROM stakes_entries WHERE race_id=$1 AND character_id=$2', [g.id, r.id])).rows[0]) return null;
  const racer = (await client.query(
    'SELECT id, name, kind, speed, stamina, heart FROM racers WHERE character_id=$1 AND (injured_until IS NULL OR injured_until < now()) ORDER BY id LIMIT 1', [r.id])).rows[0];
  if (!racer) return null;                               // only a resident who owns a fit racer
  const f = Number(racer.speed) + Number(racer.stamina) + Number(racer.heart);
  await client.query('UPDATE characters SET cash = cash - $2 WHERE id=$1', [r.id, buyin]);
  await client.query('INSERT INTO stakes_entries (race_id, character_id, buyin, racer_name, kind, form) VALUES ($1,$2,$3,$4,$5,$6)',
    [g.id, r.id, buyin, racer.name, racer.kind, f]);
  await client.query('UPDATE stakes_races SET pool = pool + $2 WHERE id=$1', [g.id, buyin]);
  await ledger(client, { characterId: r.id, currency: 'cash', amount: -buyin, reason: 'stable:stakes:buyin', counterparty: g.id });
  return 'joined_stakes';
}

// Worker settle: race every LIVE entrant (snapshotted form + rand(VARIANCE)), rank, pay the top places a
// share of the pool net of the rake. Single-writer (no player-lock races), idempotent (status gate). The
// byte-faithful port of resolveGrandPrix — the same escrow accounting and lock order.
export async function resolveStakes(client, raceId) {
  const g0 = (await client.query('SELECT * FROM stakes_races WHERE id=$1', [raceId])).rows[0];
  if (!g0 || g0.status !== 'open') return null;
  // LOCK ORDER: entrant chars sorted → stakes_state → race row (state BEFORE the row — enterStakes locks
  // state → race, so locking the race first would AB-BA a concurrent entry; the resolveGrandPrix posture).
  const entChars = (await client.query('SELECT character_id FROM stakes_entries WHERE race_id=$1', [raceId])).rows.map((r) => r.character_id).sort();
  for (const cid of entChars) await client.query('SELECT 1 FROM characters WHERE id=$1 FOR UPDATE', [cid]);
  await client.query('SELECT current FROM stakes_state WHERE id=1 FOR UPDATE');
  const g = (await client.query("SELECT * FROM stakes_races WHERE id=$1 AND status='open' FOR UPDATE", [raceId])).rows[0];
  if (!g) return null;
  const pool = Number(g.pool);
  const entries = (await client.query(
    'SELECT e.character_id, e.buyin, e.form, e.racer_name, c.alive, c.name FROM stakes_entries e LEFT JOIN characters c ON c.id=e.character_id WHERE e.race_id=$1', [raceId])).rows;
  let deadBurn = 0;
  const live = [];
  for (const e of entries) {
    if (e.alive) live.push(e);
    else { deadBurn += Number(e.buyin); await ledger(client, { currency: 'cash', amount: -Number(e.buyin), reason: 'stable:stakes:death', counterparty: raceId }); }
  }
  const clearCurrent = async () => { await client.query('UPDATE stakes_state SET current=NULL WHERE id=1 AND current=$1', [raceId]); };
  if (live.length < STABLE.STAKES.MIN_ENTRANTS) { // not a full field — refund the field, burn the dead
    for (const e of live) {
      await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [e.character_id, Number(e.buyin)]);
      await ledger(client, { characterId: e.character_id, currency: 'cash', amount: Number(e.buyin), reason: 'stable:stakes:refund', counterparty: raceId });
      await notify(client, e.character_id, 'stakes_refund', { buyin: Number(e.buyin) });
    }
    await client.query("UPDATE stakes_races SET status='refunded' WHERE id=$1", [raceId]);
    await clearCurrent();
    return { stakes: raceId, refunded: live.length };
  }
  // race: snapshotted form + rand(0,VARIANCE) each; rank DESC (the best animal wins, the going is fickle)
  const ranked = live.map((e) => ({ ...e, score: Number(e.form) + rand(0, STABLE.VARIANCE) })).sort((a, b) => b.score - a.score);
  const livePool = pool - deadBurn;
  const rake = Math.floor(livePool * STABLE.STAKES.RAKE_BPS / 10000);
  const net = livePool - rake;
  const frac = STABLE.STAKES.PAYOUTS.slice(0, ranked.length);
  const denom = frac.reduce((a, b) => a + b, 0) || 1;
  const placeShare = frac.map((f) => Math.floor(net * f / denom));
  const payouts = new Array(ranked.length).fill(0);
  for (let i = 0; i < ranked.length;) { // group ties (equal final score) — split the covered places' shares
    let j = i; while (j + 1 < ranked.length && ranked[j + 1].score === ranked[i].score) j++;
    let sum = 0; for (let p = i; p <= j; p++) sum += placeShare[p] || 0;
    const each = Math.floor(sum / (j - i + 1));
    for (let p = i; p <= j; p++) payouts[p] = each;
    i = j + 1;
  }
  let handedOut = 0;
  for (let i = 0; i < ranked.length; i++) {
    const e = ranked[i], payout = payouts[i];
    if (payout > 0) {
      handedOut += payout;
      await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [e.character_id, payout]);
      await ledger(client, { characterId: e.character_id, currency: 'cash', amount: payout, reason: 'stable:stakes:win', counterparty: raceId });
    }
    await client.query('UPDATE stakes_entries SET place=$3 WHERE race_id=$1 AND character_id=$2', [raceId, e.character_id, i + 1]);
    await notify(client, e.character_id, 'stakes_result', { place: i + 1, of: ranked.length, payout, racer: e.racer_name });
  }
  const totalTake = rake + (net - handedOut); // the rake + any rounding/unpaid remainder = the house cut
  if (totalTake > 0) {
    await ledger(client, { currency: 'cash', amount: -totalTake, reason: 'stable:stakes:take', counterparty: raceId });
    await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [Math.floor(totalTake / 2)]); // half → the buyback, half burns
  }
  await client.query("UPDATE stakes_races SET status='resolved' WHERE id=$1", [raceId]);
  await clearCurrent();
  await rngLog(client, ranked[0].character_id, `stable:stakes:${raceId}`, ranked[0].score, `winner ${ranked[0].racer_name} · ${ranked.length} runners · pool $${pool}`);
  await recordEventResult(client, { kind: 'stakes', icon: '🐎', headline: `${ranked[0].racer_name} wins the Stakes (${ranked.length} ran)`, winnerName: ranked[0].racer_name, pool, detail: { runners: ranked.length } });
  bus.emit('streets', { type: 'stakes_result', winner: ranked[0].racer_name, pool, runners: ranked.length });
  return { stakes: raceId, runners: ranked.length, pool, winner: ranked[0].racer_name, take: totalTake };
}

// worker sweep — settle every open stakes race past its window (per-race txn, idempotent).
export async function sweepStakes(pool) {
  const due = (await pool.query("SELECT id FROM stakes_races WHERE status='open' AND resolves_at <= now() ORDER BY resolves_at")).rows;
  let resolved = 0;
  for (const { id } of due) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); await resolveStakes(client, id); await client.query('COMMIT'); resolved++; }
    catch (e) { await client.query('ROLLBACK'); console.error('[sweepStakes]', id, e?.code || e?.message || e); } // 40P01 / transient → next tick retries; a PERSISTENT throw freezes this stakes' escrow → log it (the sweepAuctions poison-row precedent)
    finally { client.release(); }
  }
  return { resolved };
}

// the open stakes race (if one's registering) — surfaced on the board.
async function stakesInfo(pool, characterId) {
  const st = (await pool.query('SELECT current FROM stakes_state WHERE id=1')).rows[0];
  const g = st?.current ? (await pool.query("SELECT * FROM stakes_races WHERE id=$1 AND status='open'", [st.current])).rows[0] : null;
  const base = { buyin: STABLE.STAKES.BUYIN, minEntrants: STABLE.STAKES.MIN_ENTRANTS, payouts: STABLE.STAKES.PAYOUTS };
  if (!g) return { ...base, open: false };
  const ent = (await pool.query('SELECT racer_name, kind, form, character_id FROM stakes_entries WHERE race_id=$1 ORDER BY form DESC', [g.id])).rows;
  return { ...base, open: true, id: g.id, pool: Number(g.pool),
    entrants: ent.length, mine: ent.some((e) => e.character_id === characterId),
    field: ent.map((e) => ({ racer: e.racer_name, kind: e.kind, form: Number(e.form) })),
    closesSeconds: Math.max(0, Math.ceil((new Date(g.resolves_at) - Date.now()) / 1000)) };
}

// GET /v1/stable — your stable + the field of listed racers (by kind) + the meets + your legend.
export async function stableBoard(pool, characterId) {
  const rows = (await pool.query(
    `SELECT r.*, c.name AS owner FROM racers r JOIN characters c ON c.id = r.character_id AND c.alive`)).rows;
  const field = rows.map((r) => ({
    racerId: r.id, ownerId: r.character_id, owner: r.owner, kind: r.kind, name: r.name, form: form(r),
    record: `${Number(r.wins)}-${Number(r.losses)}`, wins: Number(r.wins), rank: racerRankOf(r.wins).name,
    mine: r.character_id === characterId,
    raceLimit: r.race_limit == null ? null : Math.floor(Number(r.race_limit)), injured: !!injured(r),
    taking: r.race_limit != null && !injured(r) && r.character_id !== characterId,
  })).sort((a, b) => b.wins - a.wins || b.form - a.form);
  const legend = (await pool.query('SELECT racer_wins FROM account_persistent WHERE account_id=(SELECT account_id FROM characters WHERE id=$1)', [characterId])).rows[0];
  const lw = Number(legend?.racer_wins || 0);
  return {
    stable: rows.filter((r) => r.character_id === characterId).sort((a, b) => Number(b.wins) - Number(a.wins)).map(racerView),
    field,
    meets: STABLE.MEETS, kinds: STABLE.KINDS,
    minLevel: STABLE.MIN_LEVEL, trainCost: STABLE.TRAIN_COST, trainEnergy: STABLE.TRAIN_ENERGY,
    statCap: STABLE.STAT_CAP, stats: STABLE.STATS, stableMax: STABLE.STABLE_MAX,
    minStake: STABLE.MIN_STAKE, maxStake: STABLE.MAX_STAKE, breedCost: STABLE.BREED_COST,
    legend: { wins: lw, title: racerLegendOf(lw).name },
    stakes: await stakesInfo(pool, characterId),
  };
}

// GET /v1/leaderboard/stable — top racers by record (living owners) + the OWNER career LEGEND
// (lifetime wins across the stable, survives death — the hitman-rep precedent). Status boards.
export async function stableLeaderboard(pool) {
  const rows = (await pool.query(
    `SELECT r.name, r.kind, r.wins, r.losses, r.speed, r.stamina, r.heart, c.name AS owner
       FROM racers r JOIN characters c ON c.id = r.character_id AND c.alive`)).rows;
  const racers = rows.map((r) => ({ racer: r.name, kind: r.kind, owner: r.owner, record: `${Number(r.wins)}-${Number(r.losses)}`,
    wins: Number(r.wins), form: form(r), rank: racerRankOf(r.wins).name }))
    .filter((x) => x.wins > 0 || x.form > 0).sort((a, b) => b.wins - a.wins || b.form - a.form).slice(0, 15);
  const legend = (await pool.query(
    `SELECT a.racer_wins, c.name FROM account_persistent a JOIN characters c ON c.account_id=a.account_id AND c.alive
      WHERE a.racer_wins > 0 AND NOT a.agent_flag AND NOT a.npc_flag ORDER BY a.racer_wins DESC LIMIT 15`)).rows // agents AND residents excluded from the human status board (residents field racers since step three)
    .map((r) => ({ owner: r.name, wins: Number(r.racer_wins), title: racerLegendOf(r.racer_wins).name }));
  return { racers, legend };
}

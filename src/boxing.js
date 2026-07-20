// THE FIGHT CIRCUIT — mob boxing (omerta-fight-circuit-design.md). STEP ONE: a manager signs a
// contender, trains them, and stakes them in PvP bouts (the audited casino:pvp back-room-dice pattern
// EXACTLY — a taxed transfer with a vig, never a new cash faucet, never an escrow). STEP TWO: THE
// STABLE (many fighters per manager), NPC EXHIBITION bouts (a bounded PvE purse so a solo manager can
// build a record + earn), the world TITLE BELT (a single champion taken by beating the holder — pure
// status), and a MANAGER career LEGEND (lifetime fighter wins, account-level → SURVIVES DEATH, the
// hitman-rep precedent). Fighters die with the street (the fighters rows join the runEstate wipe).
import crypto from 'node:crypto';
import { GameError, bus, ledger, notify, rngLog } from './game.js';
import { BOXING, boxerRankOf, boxerLegendOf, npcBoxerOf, levelOf } from './rules.js';

const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const hospitalized = (ch) => ch.hosp_until && new Date(ch.hosp_until) > new Date();
const injured = (f) => f.injured_until && new Date(f.injured_until) > new Date();
const onCooldown = (f) => f.exhib_at && new Date(f.exhib_at) > new Date();
const booked = (f) => f.booked_until && new Date(f.booked_until) > new Date(); // (step three) on a MAIN EVENT card
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const form = (f) => Number(f.power) + Number(f.chin) + Number(f.speed);
const secsTo = (t) => (t && new Date(t) > new Date()) ? Math.ceil((new Date(t).getTime() - Date.now()) / 1000) : 0;
// the betting window; MAIN_EVENT_MS env is TEST-ONLY (the SEARCH_MS/CONVOY_MS precedent — never in production)
const mainEventMs = () => Number(process.env.MAIN_EVENT_MS) || BOXING.MAIN_EVENT_MS;

// bump the MANAGER's lifetime fighter wins (account-level, survives death — never through the in-memory
// acct, so persistAccount can't clobber it — the kills precedent).
const bumpLegend = (client, accountId) =>
  client.query('UPDATE account_persistent SET boxing_wins = boxing_wins + 1 WHERE account_id=$1', [accountId]);

// ── the stable: sign a contender (up to STABLE_MAX). A cash SINK; stats rolled. ──
export async function recruitFighter(ch, name, client, h) {
  if (jailed(ch)) throw new GameError('jailed', "You can't sign a fighter from a cell.");
  if (levelOf(Number(ch.respect)) < BOXING.MANAGER_MIN_LEVEL)
    throw new GameError('level', `Managing a fighter opens up at level ${BOXING.MANAGER_MIN_LEVEL}.`);
  const n = String(name || '').trim();
  if (n.length < 3 || n.length > 24) throw new GameError('name', "A fighter's name runs 3–24 characters.");
  if (!/^[\w .,'&-]+$/.test(n)) throw new GameError('name', 'Letters, numbers and simple punctuation only.');
  const count = Number((await client.query('SELECT COUNT(*) n FROM fighters WHERE character_id=$1', [ch.id])).rows[0].n);
  if (count >= BOXING.STABLE_MAX) throw new GameError('stable_full', `Your stable is full (${BOXING.STABLE_MAX} fighters).`);
  if (Number(ch.cash) < BOXING.RECRUIT_COST) throw new GameError('cash', `Signing a fighter runs $${BOXING.RECRUIT_COST}.`);
  ch.cash = Number(ch.cash) - BOXING.RECRUIT_COST;
  const id = crypto.randomUUID();
  const power = rand(BOXING.STAT_MIN, BOXING.STAT_MAX), chin = rand(BOXING.STAT_MIN, BOXING.STAT_MAX), speed = rand(BOXING.STAT_MIN, BOXING.STAT_MAX);
  await client.query('INSERT INTO fighters (id, character_id, name, power, chin, speed) VALUES ($1,$2,$3,$4,$5,$6)', [id, ch.id, n, power, chin, speed]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -BOXING.RECRUIT_COST, reason: 'boxing:recruit' });
  await h.track(client, ch.account_id, 'boxing_recruit', {});
  return { ok: true, id, name: n, power, chin, speed, stable: count + 1 };
}

// fetch one of YOUR fighters by id, locked (the ownership gate for train/list/fight/exhibition).
async function myFighter(client, ch, fighterId) {
  const f = (await client.query('SELECT * FROM fighters WHERE id=$1 FOR UPDATE', [fighterId])).rows[0];
  if (!f || f.character_id !== ch.id) throw new GameError('no_fighter', "That's not one of your fighters.");
  return f;
}

// Train a stat — a cash + energy SINK, +TRAIN_GAIN, capped at STAT_CAP.
export async function trainFighter(ch, fighterId, stat, client, h) {
  const s = String(stat || '');
  if (!BOXING.STATS.includes(s)) throw new GameError('bad_stat', 'Train power, chin or speed.');
  if (jailed(ch)) throw new GameError('jailed', 'No gym time from lockup.');
  const f = await myFighter(client, ch, fighterId);
  if (booked(f)) throw new GameError('booked', "That fighter is on a card — no changing their form before the bell."); // freeze form during the betting window
  if (Number(f[s]) >= BOXING.STAT_CAP) throw new GameError('maxed', `Their ${s} is already maxed (${BOXING.STAT_CAP}).`);
  if (Number(ch.energy) < BOXING.TRAIN_ENERGY) throw new GameError('energy', `Need ${BOXING.TRAIN_ENERGY} energy to run a session.`);
  if (Number(ch.cash) < BOXING.TRAIN_COST) throw new GameError('cash', `A training session runs $${BOXING.TRAIN_COST}.`);
  ch.cash = Number(ch.cash) - BOXING.TRAIN_COST;
  ch.energy = Number(ch.energy) - BOXING.TRAIN_ENERGY;
  const nv = Math.min(BOXING.STAT_CAP, Number(f[s]) + BOXING.TRAIN_GAIN); // absolute write (pg-mem INT-arith quirk)
  await client.query(`UPDATE fighters SET ${s}=$2 WHERE id=$1`, [f.id, nv]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -BOXING.TRAIN_COST, reason: 'boxing:train' });
  await h.track(client, ch.account_id, 'boxing_train', { stat: s });
  return { ok: true, fighter: f.name, stat: s, value: nv };
}

// List one of your fighters as TAKING BOUTS at a stake (consent-by-listing). null/0 clears.
export async function listBout(ch, fighterId, stake, client, h) {
  const f = await myFighter(client, ch, fighterId);
  const v = stake == null || Number(stake) === 0 ? null : Math.floor(Number(stake));
  if (v != null && !(Number.isFinite(v) && v >= BOXING.MIN_STAKE && v <= BOXING.MAX_STAKE))
    throw new GameError('stake', `Bout stakes run $${BOXING.MIN_STAKE}–$${BOXING.MAX_STAKE} (0 clears).`);
  await client.query('UPDATE fighters SET bout_limit=$2 WHERE id=$1', [f.id, v]);
  return { ok: true, fighter: f.name, boutLimit: v };
}

// ── NPC EXHIBITION — your fighter vs a server-rolled NPC card. The fee is a cash SINK win or lose; the
// purse a cash FAUCET only on a win (net-positive only vs a beatable NPC). A per-fighter cooldown +
// injury-on-loss bound it. NEW faucet — sim + founder sign-off (boxing:purse rides the boxing: vocab). ──
export async function exhibitionBout(ch, fighterId, tierId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No fight nights from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp', "You're in no shape to work a corner.");
  const tier = npcBoxerOf(tierId);
  if (!tier) throw new GameError('bad_tier', 'No such exhibition card.');
  const f = await myFighter(client, ch, fighterId);
  if (injured(f)) throw new GameError('injured', 'Your fighter is laid up — let them heal.');
  if (booked(f)) throw new GameError('booked', "That fighter is booked on a main event card.");
  if (onCooldown(f)) throw new GameError('cooldown', `${f.name} needs to rest before another exhibition.`);
  if (Number(ch.cash) < tier.fee) throw new GameError('cash', `The ${tier.name} card runs a $${tier.fee} sanction fee.`);
  // the sanction fee burns win or lose
  ch.cash = Number(ch.cash) - tier.fee;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -tier.fee, reason: 'boxing:fee' });
  let mine, theirs;
  do { mine = form(f) + rand(0, BOXING.VARIANCE); theirs = tier.form + rand(0, BOXING.VARIANCE); } while (mine === theirs);
  const win = mine > theirs;
  await client.query('UPDATE fighters SET exhib_at=$2 WHERE id=$1', [f.id, new Date(Date.now() + BOXING.EXHIBITION_CD_MS)]);
  if (win) {
    ch.cash = Number(ch.cash) + tier.purse;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: tier.purse, reason: 'boxing:purse' });
    await client.query('UPDATE fighters SET wins=$2 WHERE id=$1', [f.id, Number(f.wins) + 1]);
    await bumpLegend(client, ch.account_id);
  } else {
    await client.query('UPDATE fighters SET losses=$2, injured_until=$3 WHERE id=$1', [f.id, Number(f.losses) + 1, new Date(Date.now() + BOXING.INJURY_MS)]);
  }
  await h.rngLog(client, ch.id, `boxing:exhibition:${tier.id}`, mine, `${win ? 'win' : 'loss'} vs ${tier.name} (${mine} vs ${theirs})`);
  await h.track(client, ch.account_id, 'boxing_exhibition', { tier: tier.id, win });
  return { ok: true, win, opponent: tier.name, fee: tier.fee, purse: win ? tier.purse : 0, net: win ? tier.purse - tier.fee : -tier.fee,
    you: { name: f.name, score: mine }, them: { name: tier.name, score: theirs },
    record: win ? `${Number(f.wins) + 1}-${f.losses}` : `${f.wins}-${Number(f.losses) + 1}` };
}

// ── FIGHT — YOUR fighter vs a listed opponent fighter, both managers stake the purse; the winner takes
// it minus the vig (the casino:pvp split). Two-party. The LOSER's fighter is laid up. The winner's
// MANAGER banks a lifetime win (the legend), and the world BELT changes hands if they beat the champ. ──
export async function fightBout(ch, opponent, body, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No fight nights from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp', "You're in no shape to work a corner.");
  if (opponent.id === ch.id) throw new GameError('self', "You don't fight your own stable.");
  if (h.owned.gangId && h.victimOwned.gangId === h.owned.gangId) throw new GameError('family', "They're family — no family matchups.");
  const amt = Math.floor(Number(body?.stake));
  if (!(Number.isFinite(amt) && amt >= BOXING.MIN_STAKE)) throw new GameError('min', `The minimum purse is $${BOXING.MIN_STAKE}.`);
  if (jailed(opponent) || hospitalized(opponent)) throw new GameError('unavailable', "Their manager can't make a match right now.");
  // lock both fighter rows in sorted id order (leaf ordering; the char rows are already locked by withTwoCharacters)
  const [first, second] = [String(body?.myFighter || ''), String(body?.theirFighter || '')].sort();
  await client.query('SELECT 1 FROM fighters WHERE id=$1 FOR UPDATE', [first]);
  await client.query('SELECT 1 FROM fighters WHERE id=$1 FOR UPDATE', [second]);
  const f = (await client.query('SELECT * FROM fighters WHERE id=$1', [body?.myFighter])).rows[0];
  const of = (await client.query('SELECT * FROM fighters WHERE id=$1', [body?.theirFighter])).rows[0];
  if (!f || f.character_id !== ch.id) throw new GameError('no_fighter', 'Pick one of your own fighters.');
  if (!of || of.character_id !== opponent.id) throw new GameError('no_opponent', "That fighter isn't in their stable.");
  const limit = of.bout_limit != null ? Math.floor(Number(of.bout_limit)) : 0;
  if (!(limit > 0)) throw new GameError('not_listed', "Their fighter isn't taking bouts.");
  if (amt > limit) throw new GameError('limit', `Their fighter takes bouts up to $${limit}.`);
  if (injured(f)) throw new GameError('injured_self', 'Your fighter is laid up — let them heal.');
  if (injured(of)) throw new GameError('injured_them', 'Their fighter is laid up right now.');
  if (booked(f)) throw new GameError('booked_self', 'Your fighter is booked on a main event card.');
  if (booked(of)) throw new GameError('booked_them', 'Their fighter is booked on a main event card.');
  if (Number(ch.cash) < amt) throw new GameError('cash', 'Not that much in pocket for the purse.');
  if (Number(opponent.cash) < amt) throw new GameError('their_cash', "They can't cover the purse right now.");
  let mine, theirs;
  do { mine = form(f) + rand(0, BOXING.VARIANCE); theirs = form(of) + rand(0, BOXING.VARIANCE); } while (mine === theirs);
  const win = mine > theirs;
  const pot = amt * 2;
  const rake = Math.ceil(pot * BOXING.RAKE_BPS / 10000);
  const winner = win ? ch : opponent, loser = win ? opponent : ch;
  const winnerF = win ? f : of, loserF = win ? of : f;
  loser.cash = Number(loser.cash) - amt;
  winner.cash = Number(winner.cash) + amt - rake; // their own stake never left; net +stake − rake (casino:pvp accounting)
  await h.ledger(client, { characterId: loser.id, currency: 'cash', amount: -amt, reason: 'boxing:bout', counterparty: winner.id });
  await h.ledger(client, { characterId: winner.id, currency: 'cash', amount: amt - rake, reason: 'boxing:bout', counterparty: loser.id });
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [Math.floor(rake / 2)]); // half → the buyback, half burns
  // records + injury — absolute INT writes (pg-mem arithmetic-UPDATE quirk)
  await client.query('UPDATE fighters SET wins=$2 WHERE id=$1', [winnerF.id, Number(winnerF.wins) + 1]);
  await client.query('UPDATE fighters SET losses=$2, injured_until=$3 WHERE id=$1', [loserF.id, Number(loserF.losses) + 1, new Date(Date.now() + BOXING.INJURY_MS)]);
  await bumpLegend(client, winner.account_id);
  // the world TITLE BELT — the winner takes it if the belt is VACANT or they just beat the champion (pure status)
  const title = (await client.query('SELECT * FROM boxing_title WHERE id=1 FOR UPDATE')).rows[0];
  let beltWon = false;
  if (title && (title.holder_fighter == null || title.holder_fighter === loserF.id)) {
    beltWon = title.holder_fighter !== winnerF.id;
    await client.query('UPDATE boxing_title SET holder_fighter=$1, holder_char=$2, holder_name=$3, since=now() WHERE id=1', [winnerF.id, winner.id, winnerF.name]);
  }
  await h.rngLog(client, ch.id, `boxing:bout:${of.id}`, mine, `${win ? 'win' : 'loss'} $${amt} (${mine} vs ${theirs})${beltWon ? ' — TITLE' : ''}`);
  await h.notify(client, opponent.id, 'boxing_bout', { from: ch.name, yours: of.name, mine: f.name, amount: amt, theyWon: !win, belt: beltWon && winner.id === opponent.id });
  bus.emit('streets', { type: 'boxing_bout', by: ch.name, fighters: `${f.name} v ${of.name}`, amount: pot, win, belt: beltWon });
  await h.track(client, ch.account_id, 'boxing_bout', { amt, win, belt: beltWon });
  return { ok: true, win, purse: amt, rake, net: win ? amt - rake : -amt, belt: beltWon && winner.id === ch.id,
    you: { name: f.name, score: mine }, them: { name: of.name, score: theirs },
    yourFighter: win ? `${Number(f.wins) + 1}-${f.losses}` : `${f.wins}-${Number(f.losses) + 1}` };
}

// ══ STEP THREE — THE MAIN EVENT (spectator betting) ══
// A SCHEDULED prestige bout the crowd bets on. No principal cash wager — the fighters fight for the
// belt/legend/record; the money is a CASH parimutuel among spectators. The worker resolves it at
// window close (the auction-settle model: single-writer, no player lock races). Every peso is a
// TRANSFER (bettors → winning bettors + the winning manager's promoter cut + the house vig); nothing
// is minted. The `boxing:` cash reasons ride check (a) per bettor; a new escrow check reconciles the pot.

// ── announce a MAIN EVENT — the challenger books their fighter vs a LISTED opponent fighter (consent-by-
// listing, the fightBout precedent). Two-party. Locks both fighters for the betting window; NO cash moves. ──
export async function announceMainEvent(ch, opponent, body, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No promoting from a cell.');
  if (hospitalized(ch)) throw new GameError('hosp', "You're in no shape to promote a card.");
  if (opponent.id === ch.id) throw new GameError('self', "You can't headline your own stable against itself.");
  if (h.owned.gangId && h.victimOwned.gangId === h.owned.gangId) throw new GameError('family', "They're family — no family matchups.");
  if (jailed(opponent) || hospitalized(opponent)) throw new GameError('unavailable', "Their manager can't make a match right now.");
  const [first, second] = [String(body?.myFighter || ''), String(body?.theirFighter || '')].sort();
  await client.query('SELECT 1 FROM fighters WHERE id=$1 FOR UPDATE', [first]);
  await client.query('SELECT 1 FROM fighters WHERE id=$1 FOR UPDATE', [second]);
  const f = (await client.query('SELECT * FROM fighters WHERE id=$1', [body?.myFighter])).rows[0];
  const of = (await client.query('SELECT * FROM fighters WHERE id=$1', [body?.theirFighter])).rows[0];
  if (!f || f.character_id !== ch.id) throw new GameError('no_fighter', 'Pick one of your own fighters.');
  if (!of || of.character_id !== opponent.id) throw new GameError('no_opponent', "That fighter isn't in their stable.");
  if (of.bout_limit == null) throw new GameError('not_listed', "Their fighter isn't taking bouts.");
  if (injured(f)) throw new GameError('injured_self', 'Your fighter is laid up — let them heal.');
  if (injured(of)) throw new GameError('injured_them', 'Their fighter is laid up right now.');
  if (booked(f)) throw new GameError('booked_self', 'Your fighter is already on a card.');
  if (booked(of)) throw new GameError('booked_them', 'Their fighter is already on a card.');
  const id = crypto.randomUUID();
  const resolvesAt = new Date(Date.now() + mainEventMs());
  await client.query(
    `INSERT INTO boxing_bouts (id, a_char, a_fighter, a_name, b_char, b_fighter, b_name, resolves_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, ch.id, f.id, f.name, opponent.id, of.id, of.name, resolvesAt]);
  await client.query('UPDATE fighters SET booked_until=$2 WHERE id IN ($1,$3)', [f.id, resolvesAt, of.id]);
  await h.notify(client, opponent.id, 'boxing_main_event', { from: ch.name, yours: of.name, mine: f.name });
  bus.emit('streets', { type: 'boxing_main_event', card: `${f.name} v ${of.name}`, by: ch.name });
  await h.track(client, ch.account_id, 'boxing_main_event', {});
  return { ok: true, bout: id, card: `${f.name} vs ${of.name}`, closesSeconds: Math.ceil(mainEventMs() / 1000),
    form: { [f.name]: form(f), [of.name]: form(of) } };
}

// ── place a CASH bet on a fighter in an open main event (escrow → the pot). One bet per bettor per card;
// principals can't bet their own card (inside stake). The bout row is locked to serialize/one-per-bettor. ──
export async function placeBoutBet(ch, boutId, body, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No action from a cell.');
  const bout = (await client.query("SELECT * FROM boxing_bouts WHERE id=$1 FOR UPDATE", [boutId])).rows[0];
  if (!bout || bout.status !== 'booked') throw new GameError('no_bout', 'No such open card.');
  if (new Date(bout.resolves_at) <= new Date()) throw new GameError('closed', 'Betting on that card is closed.');
  if (ch.id === bout.a_char || ch.id === bout.b_char) throw new GameError('own_event', "You can't bet on your own card.");
  const fighter = String(body?.fighter || '');
  if (fighter !== bout.a_fighter && fighter !== bout.b_fighter) throw new GameError('bad_fighter', 'Bet on one of the two fighters.');
  const amt = Math.floor(Number(body?.amount));
  if (!(Number.isFinite(amt) && amt >= BOXING.BET_MIN && amt <= BOXING.BET_MAX))
    throw new GameError('amount', `Bets run $${BOXING.BET_MIN}–$${BOXING.BET_MAX}.`);
  if ((await client.query('SELECT 1 FROM boxing_bets WHERE bout_id=$1 AND bettor_char=$2', [boutId, ch.id])).rows[0])
    throw new GameError('already_bet', "You've already got action on this card.");
  if (Number(ch.cash) < amt) throw new GameError('cash', 'Not that much in pocket.');
  ch.cash = Number(ch.cash) - amt;
  await client.query('INSERT INTO boxing_bets (bout_id, bettor_char, fighter, amount) VALUES ($1,$2,$3,$4)', [boutId, ch.id, fighter, amt]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -amt, reason: 'boxing:bet', counterparty: boutId });
  await h.track(client, ch.account_id, 'boxing_bet', { amt });
  return { ok: true, bout: boutId, on: fighter === bout.a_fighter ? bout.a_name : bout.b_name, amount: amt };
}

// ── cancel a booked bout — refund LIVING bettors (escrow → back), burn DEAD bettors' stakes (the
// dead-funder precedent), unlock the surviving fighter. Shared by the estate hook + a belt-and-suspenders
// path in resolve. A bettor who is the in-memory KILLER is credited in memory (the refundPot discipline). ──
async function cancelBout(client, bout, killerCh) {
  const bets = (await client.query(
    'SELECT b.bettor_char, b.amount, c.alive FROM boxing_bets b LEFT JOIN characters c ON c.id=b.bettor_char WHERE b.bout_id=$1', [bout.id])).rows;
  for (const b of bets) {
    const amt = Number(b.amount);
    if (b.alive) {
      if (killerCh && killerCh.id === b.bettor_char) killerCh.cash = Number(killerCh.cash) + amt; // no persistCharacter clobber
      else await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [b.bettor_char, amt]);
      await ledger(client, { characterId: b.bettor_char, currency: 'cash', amount: amt, reason: 'boxing:bet:refund', counterparty: bout.id });
    } else {
      await ledger(client, { currency: 'cash', amount: -amt, reason: 'boxing:bet:death', counterparty: bout.id });
    }
  }
  await client.query('UPDATE fighters SET booked_until=NULL WHERE id IN ($1,$2)', [bout.a_fighter, bout.b_fighter]);
  await client.query("UPDATE boxing_bouts SET status='cancelled' WHERE id=$1", [bout.id]);
}

// estate hook — a dead manager's booked main events are cancelled (their fighter is gone). Refund the
// crowd. Called in runEstate; the killer, if they bet on this very card, is mirrored in memory.
export async function cancelMainEventsAtDeath(client, characterId, killerCh) {
  const bouts = (await client.query(
    "SELECT * FROM boxing_bouts WHERE status='booked' AND (a_char=$1 OR b_char=$1)", [characterId])).rows;
  for (const bout of bouts) await cancelBout(client, bout, killerCh);
}

// ── worker resolution — the fight is rolled at window close; the spectator pot pays out (parimutuel).
// CHAR→BOUT lock order (players lock char-then-bout via withCharacter/placeBoutBet) → no AB-BA with a
// live bettor. The bet set is FROZEN (placeBoutBet rejects a past-window bout), so the unlocked pre-read
// is stable. A dead principal's bout was already cancelled by runEstate (belt-and-suspenders below). ──
export async function resolveMainEvent(client, boutId) {
  const bout0 = (await client.query('SELECT * FROM boxing_bouts WHERE id=$1', [boutId])).rows[0];
  if (!bout0 || bout0.status !== 'booked') return null; // already resolved/cancelled (idempotent)
  const betChars = (await client.query('SELECT bettor_char FROM boxing_bets WHERE bout_id=$1', [boutId])).rows.map((r) => r.bettor_char);
  const chars = [...new Set([bout0.a_char, bout0.b_char, ...betChars])].sort();
  for (const cid of chars) await client.query('SELECT 1 FROM characters WHERE id=$1 FOR UPDATE', [cid]);
  const bout = (await client.query("SELECT * FROM boxing_bouts WHERE id=$1 AND status='booked' FOR UPDATE", [boutId])).rows[0];
  if (!bout) return null;
  const fa = (await client.query('SELECT * FROM fighters WHERE id=$1 FOR UPDATE', [bout.a_fighter])).rows[0];
  const fb = (await client.query('SELECT * FROM fighters WHERE id=$1 FOR UPDATE', [bout.b_fighter])).rows[0];
  if (!fa || !fb) { await cancelBout(client, bout); return { bout: boutId, cancelled: true }; } // a fighter went missing (dead manager)
  let sa, sb;
  do { sa = form(fa) + rand(0, BOXING.VARIANCE); sb = form(fb) + rand(0, BOXING.VARIANCE); } while (sa === sb);
  const aWon = sa > sb;
  const winF = aWon ? fa : fb, loseF = aWon ? fb : fa, winnerChar = aWon ? bout.a_char : bout.b_char;
  await client.query('UPDATE fighters SET wins=$2, booked_until=NULL WHERE id=$1', [winF.id, Number(winF.wins) + 1]);
  await client.query('UPDATE fighters SET losses=$2, booked_until=NULL, injured_until=$3 WHERE id=$1',
    [loseF.id, Number(loseF.losses) + 1, new Date(Date.now() + BOXING.INJURY_MS)]);
  const winnerAcct = (await client.query('SELECT account_id FROM characters WHERE id=$1', [winnerChar])).rows[0]?.account_id;
  if (winnerAcct) await client.query('UPDATE account_persistent SET boxing_wins = boxing_wins + 1 WHERE account_id=$1', [winnerAcct]);
  // the TITLE BELT — the winner takes it if vacant or they just beat the champion (pure status)
  const title = (await client.query('SELECT * FROM boxing_title WHERE id=1 FOR UPDATE')).rows[0];
  let belt = false;
  if (title && (title.holder_fighter == null || title.holder_fighter === loseF.id)) {
    belt = title.holder_fighter !== winF.id;
    await client.query('UPDATE boxing_title SET holder_fighter=$1, holder_char=$2, holder_name=$3, since=now() WHERE id=1', [winF.id, winnerChar, winF.name]);
  }
  // ── the SPECTATOR pot (a CASH parimutuel) ──
  const bets = (await client.query(
    'SELECT b.bettor_char, b.fighter, b.amount, c.alive FROM boxing_bets b LEFT JOIN characters c ON c.id=b.bettor_char WHERE b.bout_id=$1', [boutId])).rows;
  const live = [];
  for (const b of bets) {
    if (b.alive) live.push(b);
    else await ledger(client, { currency: 'cash', amount: -Number(b.amount), reason: 'boxing:bet:death', counterparty: boutId }); // dead bettor's escrow burns
  }
  const winners = live.filter((b) => b.fighter === winF.id);
  const losers = live.filter((b) => b.fighter !== winF.id);
  const totalWin = winners.reduce((a, b) => a + Number(b.amount), 0);
  const totalLose = losers.reduce((a, b) => a + Number(b.amount), 0);
  let purse = 0, houseCut = 0;
  if (totalWin === 0) {
    // no action on the winner — nobody to pay out; refund every LIVE bettor their stake (the one-sided book)
    for (const b of live) {
      await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [b.bettor_char, Number(b.amount)]);
      await ledger(client, { characterId: b.bettor_char, currency: 'cash', amount: Number(b.amount), reason: 'boxing:bet:refund', counterparty: boutId });
    }
  } else {
    const rake = Math.floor(totalLose * BOXING.BET_RAKE_BPS / 10000);
    purse = Math.floor(rake / 2);                 // the winning manager's promoter cut (from the rake)
    houseCut = rake - purse;                       // → half street-tax buyback, half burns
    const distributable = totalLose - rake;        // the losing pot, net of vig, split pro-rata among winners
    let handedOut = 0;
    for (let i = 0; i < winners.length; i++) {
      const b = winners[i];
      const share = i === winners.length - 1 ? distributable - handedOut
        : Math.floor(distributable * Number(b.amount) / totalWin); // last winner mops up the rounding remainder
      handedOut += share;
      const payout = Number(b.amount) + share;     // their stake back + their pro-rata cut of the losers
      await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [b.bettor_char, payout]);
      await ledger(client, { characterId: b.bettor_char, currency: 'cash', amount: payout, reason: 'boxing:bet:win', counterparty: boutId });
    }
    if (purse > 0) {
      await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [winnerChar, purse]);
      await ledger(client, { characterId: winnerChar, currency: 'cash', amount: purse, reason: 'boxing:purse:main', counterparty: boutId });
    }
    if (houseCut > 0) {
      await ledger(client, { currency: 'cash', amount: -houseCut, reason: 'boxing:bet:take', counterparty: boutId });
      await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [Math.floor(houseCut / 2)]); // half → the buyback, half burns
    }
  }
  await client.query("UPDATE boxing_bouts SET status='resolved', winner_fighter=$2 WHERE id=$1", [boutId, winF.id]);
  await rngLog(client, winnerChar, `boxing:main:${boutId}`, sa, `${winF.name} beat ${loseF.name} (${sa} vs ${sb})${belt ? ' — TITLE' : ''}`);
  bus.emit('streets', { type: 'boxing_main_result', card: `${fa.name} v ${fb.name}`, winner: winF.name, belt });
  await notify(client, bout.a_char, 'boxing_main_result', { won: aWon, card: `${fa.name} v ${fb.name}`, belt: belt && winnerChar === bout.a_char, purse: winnerChar === bout.a_char ? purse : 0 });
  await notify(client, bout.b_char, 'boxing_main_result', { won: !aWon, card: `${fa.name} v ${fb.name}`, belt: belt && winnerChar === bout.b_char, purse: winnerChar === bout.b_char ? purse : 0 });
  return { bout: boutId, winner: winF.name, belt, bettors: live.length, pot: totalWin + totalLose, purse, houseCut };
}

// worker sweep — resolve every past-window booked card (per-bout txn; a poison card can't starve the rest).
export async function sweepMainEvents(pool) {
  const due = (await pool.query("SELECT id FROM boxing_bouts WHERE status='booked' AND resolves_at <= now() ORDER BY resolves_at")).rows;
  let resolved = 0;
  for (const { id } of due) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await resolveMainEvent(client, id);
      await client.query('COMMIT');
      resolved++;
    } catch (e) { await client.query('ROLLBACK'); } // 40P01 / transient → the next tick retries (idempotent)
    finally { client.release(); }
  }
  return { resolved };
}

// the open cards (for the board) — the two fighters, forms, and the LIVE parimutuel pools per side.
async function openMainEvents(pool, characterId) {
  const bouts = (await pool.query("SELECT * FROM boxing_bouts WHERE status='booked' ORDER BY resolves_at")).rows;
  if (!bouts.length) return [];
  const out = [];
  for (const o of bouts) {
    const bets = (await pool.query('SELECT bettor_char, fighter, amount FROM boxing_bets WHERE bout_id=$1', [o.id])).rows;
    const poolA = bets.filter((b) => b.fighter === o.a_fighter).reduce((a, b) => a + Number(b.amount), 0);
    const poolB = bets.filter((b) => b.fighter === o.b_fighter).reduce((a, b) => a + Number(b.amount), 0);
    const mine = bets.find((b) => b.bettor_char === characterId);
    out.push({
      id: o.id, a: { fighterId: o.a_fighter, name: o.a_name, pool: poolA }, b: { fighterId: o.b_fighter, name: o.b_name, pool: poolB },
      closesSeconds: secsTo(o.resolves_at),
      isPrincipal: o.a_char === characterId || o.b_char === characterId,
      yourBet: mine ? { fighter: mine.fighter, on: mine.fighter === o.a_fighter ? o.a_name : o.b_name, amount: Number(mine.amount) } : null,
    });
  }
  return out;
}

const fighterView = (f, beltId) => ({
  id: f.id, name: f.name, power: Number(f.power), chin: Number(f.chin), speed: Number(f.speed), form: form(f),
  wins: Number(f.wins), losses: Number(f.losses), record: `${Number(f.wins)}-${Number(f.losses)}`, rank: boxerRankOf(f.wins).name,
  boutLimit: f.bout_limit == null ? null : Math.floor(Number(f.bout_limit)),
  injuredSeconds: secsTo(f.injured_until), exhibitionCdSeconds: secsTo(f.exhib_at), bookedSeconds: secsTo(f.booked_until),
  belt: !!beltId && f.id === beltId,
});

// the manager's STABLE (loadOwned + the character view). [] if they run no fighter.
export async function fightersOf(pool, characterId) {
  const beltId = (await pool.query('SELECT holder_fighter FROM boxing_title WHERE id=1')).rows[0]?.holder_fighter || null;
  const rows = (await pool.query('SELECT * FROM fighters WHERE character_id=$1 ORDER BY wins DESC, created_at', [characterId])).rows;
  return rows.map((f) => fighterView(f, beltId));
}

// GET /v1/boxing — your stable + the circuit (every listed fighter) + the world champion + the levers.
export async function boxingBoard(pool, characterId) {
  const title = (await pool.query('SELECT * FROM boxing_title WHERE id=1')).rows[0] || {};
  const beltId = title.holder_fighter || null;
  const rows = (await pool.query(
    `SELECT f.*, c.name AS manager FROM fighters f JOIN characters c ON c.id = f.character_id AND c.alive`)).rows;
  const circuit = rows.map((f) => ({
    fighterId: f.id, managerId: f.character_id, manager: f.manager, name: f.name, form: form(f),
    record: `${Number(f.wins)}-${Number(f.losses)}`, wins: Number(f.wins), rank: boxerRankOf(f.wins).name,
    mine: f.character_id === characterId, belt: f.id === beltId,
    boutLimit: f.bout_limit == null ? null : Math.floor(Number(f.bout_limit)),
    injured: !!injured(f), booked: !!booked(f),
    taking: f.bout_limit != null && !injured(f) && !booked(f) && f.character_id !== characterId,
  })).sort((a, b) => (b.belt - a.belt) || b.wins - a.wins || b.form - a.form);
  return {
    stable: rows.filter((f) => f.character_id === characterId).sort((a, b) => Number(b.wins) - Number(a.wins)).map((f) => fighterView(f, beltId)),
    circuit,
    mainEvents: await openMainEvents(pool, characterId),
    champion: beltId ? { fighter: title.holder_name, heldSeconds: title.since ? Math.floor((Date.now() - new Date(title.since).getTime()) / 1000) : null } : null,
    npcTiers: BOXING.NPC_TIERS,
    recruitCost: BOXING.RECRUIT_COST, trainCost: BOXING.TRAIN_COST, minLevel: BOXING.MANAGER_MIN_LEVEL,
    minStake: BOXING.MIN_STAKE, maxStake: BOXING.MAX_STAKE, statCap: BOXING.STAT_CAP, stats: BOXING.STATS, stableMax: BOXING.STABLE_MAX,
    betMin: BOXING.BET_MIN, betMax: BOXING.BET_MAX, betRakeBps: BOXING.BET_RAKE_BPS,
  };
}

// GET /v1/leaderboard/boxing — top fighters by record (living managers) + the MANAGER career LEGEND
// (lifetime wins across the stable, survives death — the hitman-rep precedent). Status boards.
export async function boxingLeaderboard(pool, characterId) {
  const beltId = (await pool.query('SELECT holder_fighter FROM boxing_title WHERE id=1')).rows[0]?.holder_fighter || null;
  const rows = (await pool.query(
    `SELECT f.id, f.name, f.wins, f.losses, f.power, f.chin, f.speed, c.name AS manager
       FROM fighters f JOIN characters c ON c.id = f.character_id AND c.alive`)).rows;
  const fighters = rows.map((f) => ({ fighter: f.name, manager: f.manager, record: `${Number(f.wins)}-${Number(f.losses)}`,
    wins: Number(f.wins), form: form(f), rank: boxerRankOf(f.wins).name, belt: f.id === beltId }))
    .filter((x) => x.wins > 0 || x.form > 0).sort((a, b) => b.wins - a.wins || b.form - a.form).slice(0, 15);
  const legend = (await pool.query(
    `SELECT a.boxing_wins, c.name FROM account_persistent a JOIN characters c ON c.account_id=a.account_id AND c.alive
      WHERE a.boxing_wins > 0 ORDER BY a.boxing_wins DESC LIMIT 15`)).rows
    .map((r) => ({ manager: r.name, wins: Number(r.boxing_wins), title: boxerLegendOf(r.boxing_wins).name }));
  return { fighters, legend };
}

// estate hook — a dead manager's whole stable is done (character-level). Vacate the belt if they held it.
export async function wipeFighterAtDeath(client, characterId) {
  const title = (await client.query('SELECT holder_char FROM boxing_title WHERE id=1 FOR UPDATE')).rows[0];
  if (title && title.holder_char === characterId)
    await client.query('UPDATE boxing_title SET holder_fighter=NULL, holder_char=NULL, holder_name=NULL, since=NULL WHERE id=1');
  await client.query('DELETE FROM fighters WHERE character_id=$1', [characterId]);
}

// THE FIGHT CIRCUIT — mob boxing (omerta-fight-circuit-design.md). STEP ONE: a manager signs a
// contender, trains them, and stakes them in PvP bouts (the audited casino:pvp back-room-dice pattern
// EXACTLY — a taxed transfer with a vig, never a new cash faucet, never an escrow). STEP TWO: THE
// STABLE (many fighters per manager), NPC EXHIBITION bouts (a bounded PvE purse so a solo manager can
// build a record + earn), the world TITLE BELT (a single champion taken by beating the holder — pure
// status), and a MANAGER career LEGEND (lifetime fighter wins, account-level → SURVIVES DEATH, the
// hitman-rep precedent). Fighters die with the street (the fighters rows join the runEstate wipe).
import crypto from 'node:crypto';
import { GameError, bus, ledger, notify, rngLog, bumpStanding, bumpMastery, masteryFx, npcMult, npcTier } from './game.js';
import { BOXING, UNDERWORLD, boxerRankOf, boxerLegendOf, npcBoxerOf, levelOf, pathFx } from './rules.js';

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
const calloutMs = () => Number(process.env.CALLOUT_MS) || BOXING.CALLOUT_MS; // the champ's accept window (TEST-ONLY env)

// bump the MANAGER's lifetime fighter wins (account-level, survives death — never through the in-memory
// acct, so persistAccount can't clobber it — the kills precedent).
const bumpLegend = (client, accountId) =>
  client.query('UPDATE account_persistent SET boxing_wins = boxing_wins + 1 WHERE account_id=$1', [accountId]);

// the world TITLE BELT bookkeeping — shared by PvP bouts + main events (step four adds the REIGN +
// the mandatory-defense clock). Locks the singleton (singletons-last). Returns {belt, defended}:
//   - the champ won while HOLDING the belt → a successful DEFENSE (reign++, clock reset)
//   - vacant OR they beat the champion     → the belt changes hands (fresh reign, clock starts)
async function applyBeltResult(client, winnerF, winnerChar, loserF) {
  const title = (await client.query('SELECT * FROM boxing_title WHERE id=1 FOR UPDATE')).rows[0];
  if (!title) return { belt: false, defended: false };
  if (title.holder_fighter === winnerF.id) { // the champ defended
    await client.query('UPDATE boxing_title SET defenses=$1, last_defense=now() WHERE id=1', [Number(title.defenses) + 1]);
    return { belt: false, defended: true };
  }
  if (title.holder_fighter == null || title.holder_fighter === loserF.id) { // vacant / beat the champ
    await client.query('UPDATE boxing_title SET holder_fighter=$1, holder_char=$2, holder_name=$3, since=now(), defenses=0, last_defense=now() WHERE id=1',
      [winnerF.id, winnerChar, winnerF.name]);
    return { belt: true, defended: false };
  }
  return { belt: false, defended: false };
}

// the #1 CONTENDER — the top-ranked non-champ fighter (living manager) with a real record. Earns the
// callout privilege. `rows` is the pre-fetched living-manager fighter set (board reuse) or fetched here.
function contenderOf(rows, beltFighterId) {
  return rows.filter((f) => f.id !== beltFighterId && Number(f.wins) >= 1)
    .sort((a, b) => Number(b.wins) - Number(a.wins) || form(b) - form(a))[0] || null;
}

// worker — belt enforcement. (1) a DUCKED callout past its deadline forfeits the belt straight to the
// challenger; (2) otherwise the mandatory-defense clock STRIPS an inactive champ (the belt goes vacant).
// Pure status, no §10.4.
export async function enforceBeltDefense(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = (await client.query('SELECT * FROM boxing_title WHERE id=1 AND holder_fighter IS NOT NULL FOR UPDATE')).rows[0];
    if (!t) { await client.query('ROLLBACK'); return {}; }
    // (1) a DUCKED callout — the champ ignored a mandatory challenge past the deadline → forfeit to the challenger
    if (t.callout_fighter && t.callout_deadline && Date.now() > new Date(t.callout_deadline).getTime()) {
      const chal = (await client.query('SELECT f.*, c.alive FROM fighters f LEFT JOIN characters c ON c.id=f.character_id WHERE f.id=$1', [t.callout_fighter])).rows[0];
      if (chal && chal.alive) { // crown the challenger — you can't duck the #1 contender
        await client.query('UPDATE boxing_title SET holder_fighter=$1, holder_char=$2, holder_name=$3, since=now(), defenses=0, last_defense=now(), callout_fighter=NULL, callout_char=NULL, callout_deadline=NULL WHERE id=1',
          [chal.id, chal.character_id, chal.name]);
        if (t.holder_char) await notify(client, t.holder_char, 'belt_ducked', { challenger: chal.name });
        await notify(client, chal.character_id, 'belt_won_callout', { was: t.holder_name, fighter: chal.name });
        bus.emit('streets', { type: 'belt_ducked', champion: t.holder_name, challenger: chal.name });
        await client.query('COMMIT');
        return { ducked: true, champion: t.holder_name, newChampion: chal.name };
      }
      await client.query('UPDATE boxing_title SET callout_fighter=NULL, callout_char=NULL, callout_deadline=NULL WHERE id=1'); // challenger gone — clear the stale callout
    }
    // (2) the mandatory-defense clock — an inactive champ forfeits the belt to vacancy
    const clock = t.last_defense || t.since;
    if (clock && Date.now() - new Date(clock).getTime() > BOXING.DEFENSE_MS) {
      await client.query('UPDATE boxing_title SET holder_fighter=NULL, holder_char=NULL, holder_name=NULL, since=NULL, defenses=0, last_defense=NULL, callout_fighter=NULL, callout_char=NULL, callout_deadline=NULL WHERE id=1');
      if (t.holder_char) await notify(client, t.holder_char, 'belt_stripped', { fighter: t.holder_name, defenses: Number(t.defenses) });
      bus.emit('streets', { type: 'belt_stripped', fighter: t.holder_name });
      await client.query('COMMIT');
      return { stripped: true, fighter: t.holder_name };
    }
    await client.query('ROLLBACK');
    return {};
  } catch (e) { await client.query('ROLLBACK'); return {}; }
  finally { client.release(); }
}

// ── THE CALLOUT (step five) — the #1 contender forces a mandatory title fight ──
// A challenger who owns the #1 contender calls out the champion. The champ then ACCEPTS (books a title
// main event) or DUCKS it (the worker forfeits the belt to the challenger past the deadline). No §10.4.
export async function callOutChamp(ch, fighterId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No callouts from a cell.');
  // (red-team R11 Note A) This locks boxing_title (a singleton) BEFORE a fighter row (line 107) — the
  // INVERSE of the canonical boxing fighter→title order (fightBout/acceptCallout/resolveMainEvent). It's
  // SAFE ONLY because the fighter locked here is always the caller's OWN contender (line 106 re-checks
  // `top.character_id === ch.id`), whose char is already exclusively held by withCharacter — so any
  // counter-path that would lock this fighter must first block on the held caller char (it locks the
  // owner's char before the fighter). ⚠️ If a future edit makes this (or any title-first path) touch a
  // fighter the actor does NOT already char-hold, it becomes a real AB-BA vs fightBout/resolveMainEvent —
  // lock the fighter's owner char first, or the fighter before the title.
  const title = (await client.query('SELECT * FROM boxing_title WHERE id=1 FOR UPDATE')).rows[0];
  if (!title || !title.holder_fighter) throw new GameError('no_champ', 'There is no champion to call out.');
  if (title.holder_char === ch.id) throw new GameError('self', "You hold the belt — you can't call yourself out.");
  if (title.callout_fighter) throw new GameError('callout_exists', "The champ's already been called out.");
  // the challenger must own the #1 CONTENDER (top living non-champ fighter with a record)
  const rows = (await client.query(
    'SELECT f.* FROM fighters f JOIN characters c ON c.id=f.character_id AND c.alive')).rows;
  const top = contenderOf(rows, title.holder_fighter);
  if (!top || top.character_id !== ch.id || top.id !== String(fighterId)) throw new GameError('not_contender', 'Only the #1 contender can call out the champ.');
  const f = (await client.query('SELECT * FROM fighters WHERE id=$1 FOR UPDATE', [top.id])).rows[0];
  if (injured(f)) throw new GameError('injured', 'Your fighter is laid up — heal before you call anybody out.');
  if (booked(f)) throw new GameError('booked', 'Your fighter is already on a card.');
  const deadline = new Date(Date.now() + calloutMs());
  await client.query('UPDATE boxing_title SET callout_fighter=$1, callout_char=$2, callout_deadline=$3 WHERE id=1', [f.id, ch.id, deadline]);
  await h.notify(client, title.holder_char, 'boxing_callout', { by: ch.name, challenger: f.name, champion: title.holder_name, acceptWithinSeconds: Math.ceil(calloutMs() / 1000) });
  bus.emit('streets', { type: 'boxing_callout', by: ch.name, challenger: f.name, champion: title.holder_name });
  await h.track(client, ch.account_id, 'boxing_callout', {});
  return { ok: true, champion: title.holder_name, challenger: f.name, acceptWithinSeconds: Math.ceil(calloutMs() / 1000) };
}

// the CHAMP accepts a callout — books a TITLE main event champ vs challenger (the callout IS the
// challenger's consent, so no listing needed). The main event resolves normally; applyBeltResult handles
// the belt (challenger wins → title change; champ wins → a defence). Single-party (no cash moves).
export async function acceptCallout(ch, client, h) {
  if (jailed(ch)) throw new GameError('jailed', "You can't take the fight from a cell.");
  if (hospitalized(ch)) throw new GameError('hosp', "You're in no shape to make the walk.");
  // audit F2: lock the FIGHTER rows BEFORE the boxing_title singleton (fighter→title, the fightBout/
  // resolveMainEvent order). The challenger's fighter is another player's row we don't hold the char
  // lock for, so locking it under the title lock inverted the order → an AB-BA vs a fightBout staking
  // that same listed fighter. Read the title UNLOCKED to learn the two fighters, lock them sorted, THEN
  // lock the singleton and re-verify the callout didn't shift under us (the executeHeist TOCTOU pattern).
  const t0 = (await client.query('SELECT * FROM boxing_title WHERE id=1')).rows[0];
  if (!t0 || !t0.callout_fighter) throw new GameError('no_callout', 'Nobody has called you out.');
  if (t0.holder_char !== ch.id) throw new GameError('not_champ', 'Only the champion can accept the challenge.');
  const [first, second] = [t0.holder_fighter, t0.callout_fighter].sort();
  await client.query('SELECT 1 FROM fighters WHERE id=$1 FOR UPDATE', [first]);
  await client.query('SELECT 1 FROM fighters WHERE id=$1 FOR UPDATE', [second]);
  const title = (await client.query('SELECT * FROM boxing_title WHERE id=1 FOR UPDATE')).rows[0];
  if (!title || !title.callout_fighter) throw new GameError('no_callout', 'Nobody has called you out.');
  if (title.holder_char !== ch.id) throw new GameError('not_champ', 'Only the champion can accept the challenge.');
  if (title.holder_fighter !== t0.holder_fighter || title.callout_fighter !== t0.callout_fighter)
    throw new GameError('contention', 'The card shifted under you — try again.'); // fighters changed; the locked pair is stale
  const champF = (await client.query('SELECT * FROM fighters WHERE id=$1', [title.holder_fighter])).rows[0];
  const chalF = (await client.query('SELECT * FROM fighters WHERE id=$1', [title.callout_fighter])).rows[0];
  if (!champF || champF.character_id !== ch.id) throw new GameError('no_fighter', 'You no longer hold the belt.');
  if (!chalF) { // the challenger's fighter is gone — void the callout
    await client.query('UPDATE boxing_title SET callout_fighter=NULL, callout_char=NULL, callout_deadline=NULL WHERE id=1');
    throw new GameError('gone', 'The challenger is no longer in the game.');
  }
  if (injured(champF)) throw new GameError('injured', 'Your fighter is laid up — heal before defending.');
  if (booked(champF) || booked(chalF)) throw new GameError('booked', 'A fighter is already on a card.');
  const id = crypto.randomUUID();
  const resolvesAt = new Date(Date.now() + mainEventMs());
  await client.query(
    `INSERT INTO boxing_bouts (id, a_char, a_fighter, a_name, b_char, b_fighter, b_name, a_form, b_form, resolves_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, ch.id, champF.id, champF.name, title.callout_char, chalF.id, chalF.name, form(champF), form(chalF), resolvesAt]);
  await client.query('UPDATE fighters SET booked_until=$2 WHERE id IN ($1,$3)', [champF.id, resolvesAt, chalF.id]);
  await client.query('UPDATE boxing_title SET callout_fighter=NULL, callout_char=NULL, callout_deadline=NULL WHERE id=1'); // consumed into the booked title card
  await h.notify(client, title.callout_char, 'boxing_callout_accepted', { champion: champF.name, challenger: chalF.name });
  bus.emit('streets', { type: 'boxing_title_fight', card: `${champF.name} v ${chalF.name}` });
  await h.track(client, ch.account_id, 'boxing_callout_accept', {});
  return { ok: true, bout: id, card: `${champF.name} vs ${chalF.name}`, title: true, closesSeconds: Math.ceil(mainEventMs() / 1000) };
}

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
  await bumpStanding(client, h, ch, 'cornerman', 3, { action: 'sign' }); // signing a contender is big business with the corner
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
  // the Cornerman (Underworld): T1 discounts the session; T3 makes it build harder (actor-local pacing)
  const cost = Math.round(BOXING.TRAIN_COST * npcMult(h, 'cornerman', 1, UNDERWORLD.FX.CORNER_TRAIN_MULT));
  const gain = BOXING.TRAIN_GAIN + (npcTier(h, 'cornerman') >= 3 ? UNDERWORLD.FX.CORNER_GAIN : 0);
  if (Number(ch.cash) < cost) throw new GameError('cash', `A training session runs $${cost}.`);
  ch.cash = Number(ch.cash) - cost;
  ch.energy = Number(ch.energy) - BOXING.TRAIN_ENERGY;
  const nv = Math.min(BOXING.STAT_CAP, Number(f[s]) + gain); // absolute write (pg-mem INT-arith quirk)
  await client.query(`UPDATE fighters SET ${s}=$2 WHERE id=$1`, [f.id, nv]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'boxing:train' });
  await bumpStanding(client, h, ch, 'cornerman', 1, { action: 'train' }); // gym work is the corner's business (the daily-lead task)
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
  const cd = Math.round(BOXING.EXHIBITION_CD_MS * npcMult(h, 'cornerman', 2, UNDERWORLD.FX.CORNER_CD_MULT)); // the Cornerman's cutman rests them faster
  await client.query('UPDATE fighters SET exhib_at=$2 WHERE id=$1', [f.id, new Date(Date.now() + cd)]);
  if (win) {
    ch.cash = Number(ch.cash) + tier.purse;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: tier.purse, reason: 'boxing:purse' });
    await client.query('UPDATE fighters SET wins=$2 WHERE id=$1', [f.id, Number(f.wins) + 1]);
    await bumpLegend(client, ch.account_id);
  } else {
    // TRADES perk (fists): a schooled corner patches them up faster — pacing only
    await client.query('UPDATE fighters SET losses=$2, injured_until=$3 WHERE id=$1', [f.id, Number(f.losses) + 1, new Date(Date.now() + Math.round(BOXING.INJURY_MS * masteryFx(h, 'fists')))]);
  }
  await bumpStanding(client, h, ch, 'cornerman', 1, { action: 'exhibition' }); // working the card is the corner's business
  await bumpMastery(client, h, ch, 'fists', 'exhibition');
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
  // PATHS v2 — the Ring's corner craft (or the Shadow's aversion) tilts a MANAGED fight; each side
  // reads its own manager's path column (no h needed — the withTwoCharacters rows carry .path)
  do { mine = (form(f) + rand(0, BOXING.VARIANCE)) * pathFx(ch, 'contest'); theirs = (form(of) + rand(0, BOXING.VARIANCE)) * pathFx(opponent, 'contest'); } while (mine === theirs);
  const win = mine > theirs;
  const pot = amt * 2;
  const rake = Math.ceil(pot * BOXING.RAKE_BPS / 10000);
  const winner = win ? ch : opponent, loser = win ? opponent : ch;
  const winnerF = win ? f : of, loserF = win ? of : f;
  loser.cash = Number(loser.cash) - amt;
  winner.cash = Number(winner.cash) + amt - rake; // their own stake never left; net +stake − rake (casino:pvp accounting)
  await h.ledger(client, { characterId: loser.id, currency: 'cash', amount: -amt, reason: 'boxing:bout', counterparty: winner.id });
  await h.ledger(client, { characterId: winner.id, currency: 'cash', amount: amt - rake, reason: 'boxing:bout', counterparty: loser.id });
  // records + injury — absolute INT writes (pg-mem arithmetic-UPDATE quirk)
  await client.query('UPDATE fighters SET wins=$2 WHERE id=$1', [winnerF.id, Number(winnerF.wins) + 1]);
  // TRADES perk (fists) — the LOSING fighter's OWNER's schooling decides the lay-up (both sides are
  // loaded under withTwoCharacters: the actor via h.owned, the opponent via h.victimOwned)
  const loserFx = masteryFx(win ? { owned: h.victimOwned } : h, 'fists');
  await client.query('UPDATE fighters SET losses=$2, injured_until=$3 WHERE id=$1', [loserF.id, Number(loserF.losses) + 1, new Date(Date.now() + Math.round(BOXING.INJURY_MS * loserFx))]);
  // (red-team R18) the manager LEGEND only banks vs a loser at/above the anti-Sybil floor — the wager/rake
  // still move (a taxed transfer); only the cosmetic boxing_wins credit is gated (the races/stable precedent)
  if (levelOf(Number(loser.respect)) >= BOXING.LEGEND_MIN_LVL) await bumpLegend(client, winner.account_id);
  // the world TITLE BELT — win it, or DEFEND it if you're the champ (step four: the reign + clock)
  // (audit F1: lock boxing_title BEFORE street_tax — resolveMainEvent locks them in that order, so
  // crediting the pool before applyBeltResult inverted the two singletons → an AB-BA vs the resolver)
  const { belt: beltWon, defended } = await applyBeltResult(client, winnerF, winner.id, loserF);
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [Math.floor(rake / 2)]); // half → the buyback, half burns
  await bumpStanding(client, h, ch, 'cornerman', 2, { action: 'fight' }); // fight night is the corner's business
  await bumpMastery(client, h, ch, 'fists', 'bout');
  await h.rngLog(client, ch.id, `boxing:bout:${of.id}`, mine, `${win ? 'win' : 'loss'} $${amt} (${mine} vs ${theirs})${beltWon ? ' — TITLE' : defended ? ' — TITLE DEFENDED' : ''}`);
  await h.notify(client, opponent.id, 'boxing_bout', { from: ch.name, yours: of.name, mine: f.name, amount: amt, theyWon: !win, belt: beltWon && winner.id === opponent.id });
  bus.emit('streets', { type: 'boxing_bout', by: ch.name, fighters: `${f.name} v ${of.name}`, amount: pot, win, belt: beltWon });
  await h.track(client, ch.account_id, 'boxing_bout', { amt, win, belt: beltWon });
  return { ok: true, win, purse: amt, rake, net: win ? amt - rake : -amt, belt: beltWon && winner.id === ch.id, defended: defended && winner.id === ch.id,
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
    `INSERT INTO boxing_bouts (id, a_char, a_fighter, a_name, b_char, b_fighter, b_name, a_form, b_form, resolves_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, ch.id, f.id, f.name, opponent.id, of.id, of.name, form(f), form(of), resolvesAt]);
  await client.query('UPDATE fighters SET booked_until=$2 WHERE id IN ($1,$3)', [f.id, resolvesAt, of.id]);
  await bumpStanding(client, h, ch, 'cornerman', 2, { action: 'announce' }); // booking a card is the corner's business
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
  // (red-team R15) LOCK the bout row before reading the bet set. cancelMainEventsAtDeath reads bouts
  // UNLOCKED, and the escrow funders are third-party spectators the estate never locks — so without this
  // a placeBoutBet landing between the bet-read and the status flip strands that bet's escrow (missed by
  // the refund loop, then the bout is cancelled so resolveMainEvent never pays it) → boxing bet escrow
  // §10.4 drift + burned spectator cash. Re-entrant on the resolve path (it already holds this row).
  // Re-read status under the lock and bail if another path already resolved/cancelled it (idempotent).
  const locked = (await client.query("SELECT * FROM boxing_bouts WHERE id=$1 FOR UPDATE", [bout.id])).rows[0];
  if (!locked || locked.status !== 'booked') return; // already resolved/cancelled — no double refund
  bout = locked;
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
  // (R34) resolve from the form SNAPSHOTTED at booking — NOT the live stats — so a manager can't train a
  // booked fighter up in the gap between betting-close (resolves_at) and the worker settle to rig the
  // parimutuel (the Grand-Prix/stakes/futurity precedent). Fall back to live form for a pre-migration bout.
  const baseA = bout.a_form != null ? Number(bout.a_form) : form(fa);
  const baseB = bout.b_form != null ? Number(bout.b_form) : form(fb);
  let sa, sb;
  do { sa = baseA + rand(0, BOXING.VARIANCE); sb = baseB + rand(0, BOXING.VARIANCE); } while (sa === sb);
  const aWon = sa > sb;
  const winF = aWon ? fa : fb, loseF = aWon ? fb : fa, winnerChar = aWon ? bout.a_char : bout.b_char;
  await client.query('UPDATE fighters SET wins=$2, booked_until=NULL WHERE id=$1', [winF.id, Number(winF.wins) + 1]);
  await client.query('UPDATE fighters SET losses=$2, booked_until=NULL, injured_until=$3 WHERE id=$1',
    [loseF.id, Number(loseF.losses) + 1, new Date(Date.now() + BOXING.INJURY_MS)]);
  const winnerAcct = (await client.query('SELECT account_id FROM characters WHERE id=$1', [winnerChar])).rows[0]?.account_id;
  // (red-team R18) gate the manager LEGEND on the LOSER's level, like fightBout / the races/stable twins —
  // else a ring of fresh-alt managers feeds boxing_wins by losing booked main events. Status only, no §10.4.
  const loserChar = aWon ? bout.b_char : bout.a_char;
  const loserResp = Number((await client.query('SELECT respect FROM characters WHERE id=$1', [loserChar])).rows[0]?.respect || 0);
  if (winnerAcct && levelOf(loserResp) >= BOXING.LEGEND_MIN_LVL) await client.query('UPDATE account_persistent SET boxing_wins = boxing_wins + 1 WHERE account_id=$1', [winnerAcct]);
  // the TITLE BELT — win it, or DEFEND it if the champ headlined (step four: the reign + clock)
  const { belt } = await applyBeltResult(client, winF, winnerChar, loseF);
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
    } catch (e) { await client.query('ROLLBACK'); console.error('[sweepMainEvents]', id, e?.code || e?.message || e); } // 40P01 / transient → the next tick retries; a PERSISTENT throw freezes this bout's bet escrow → log it (the sweepAuctions poison-row precedent)
    finally { client.release(); }
  }
  return { resolved };
}

// the open cards (for the board) — the two fighters, forms, and the LIVE parimutuel pools per side.
async function openMainEvents(pool, characterId, beltId) {
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
      title: !!beltId && (o.a_fighter === beltId || o.b_fighter === beltId), // the belt is on the line
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
    mainEvents: await openMainEvents(pool, characterId, beltId),
    champion: beltId ? (() => {
      const c = contenderOf(rows, beltId); // the #1 contender (top living non-champ with a record)
      return {
        fighter: title.holder_name, onMe: title.holder_char === characterId,
        heldSeconds: title.since ? Math.floor((Date.now() - new Date(title.since).getTime()) / 1000) : null,
        defenses: Number(title.defenses || 0),
        // the mandatory-defense clock — win a bout before it runs out or forfeit the belt
        defendSeconds: secsTo(new Date(new Date(title.last_defense || title.since).getTime() + BOXING.DEFENSE_MS)),
        // the #1 contender — the natural challenger; `mine` = the viewer owns them (can call out)
        contender: c ? { name: c.name, fighterId: c.id, manager: (circuit.find((x) => x.fighterId === c.id) || {}).manager, record: `${Number(c.wins)}-${Number(c.losses)}`, mine: c.character_id === characterId } : null,
        // a pending CALLOUT (step five) — the champ must accept or forfeit
        callout: title.callout_fighter ? {
          challenger: (rows.find((f) => f.id === title.callout_fighter) || {}).name || 'a contender',
          deadlineSeconds: secsTo(title.callout_deadline), byMe: title.callout_char === characterId,
        } : null,
      };
    })() : null,
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
      WHERE a.boxing_wins > 0 AND NOT a.agent_flag AND NOT a.npc_flag ORDER BY a.boxing_wins DESC LIMIT 15`)).rows // agents AND residents excluded from the human status board (F-LOW2; a resident fields fighters since step three, so a player LOSING to one must not put scenery on the board)
    .map((r) => ({ manager: r.name, wins: Number(r.boxing_wins), title: boxerLegendOf(r.boxing_wins).name }));
  return { fighters, legend };
}

// estate hook — a dead manager's whole stable is done (character-level). Vacate the belt if they held it.
export async function wipeFighterAtDeath(client, characterId) {
  // (R34) DELETE the fighters FIRST (acquiring the fighter row-locks) THEN lock the title singleton — the
  // canonical fighter→title order, so this can't AB-BA with acceptCallout (which locks a fighter it doesn't
  // char-own, then the title). The belt/callout vacate keys on the dead CHARACTER, so it's unaffected by the
  // fighter rows already being gone.
  await client.query('DELETE FROM fighters WHERE character_id=$1', [characterId]);
  const title = (await client.query('SELECT holder_char, callout_char FROM boxing_title WHERE id=1 FOR UPDATE')).rows[0];
  if (title && title.holder_char === characterId) // the champion is dead — vacate the belt + any callout
    await client.query('UPDATE boxing_title SET holder_fighter=NULL, holder_char=NULL, holder_name=NULL, since=NULL, defenses=0, last_defense=NULL, callout_fighter=NULL, callout_char=NULL, callout_deadline=NULL WHERE id=1');
  else if (title && title.callout_char === characterId) // the challenger is dead — the callout is void
    await client.query('UPDATE boxing_title SET callout_fighter=NULL, callout_char=NULL, callout_deadline=NULL WHERE id=1');
}

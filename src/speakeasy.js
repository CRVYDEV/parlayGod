// THE SPEAKEASY — the social hub (omerta-speakeasy-design.md). ONE club per district, opened by a made
// man, where rivals gather and perform status. The proprietor runs a front (base bar take, lazy + capped,
// the business pattern) and climbs a decor ladder; patrons buy ROUNDS (a taxed cash transfer to the owner
// — the bodyguard-hire pattern) and bottle service (a pure-status $OMR burn), both flexed on the guest
// list. Prestige ranks the nightlife. §10.4: `speakeasy:` is a cash SINK/FAUCET/TRANSFER vocabulary (all
// character_id'd → the per-character cash check reconciles); bottles/naming ride `vanity:%` (no omr change).
import { GameError, bus } from './game.js';
import { SPEAKEASY, DISTRICTS, speakeasyTierOf, speakeasyRoundOf, speakeasyBottleOf, levelOf } from './rules.js';
import { spendOmr } from './vanity.js';

const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const hospitalized = (ch) => ch.hosp_until && new Date(ch.hosp_until) > new Date();
const safeHoused = (ch) => ch.safe_until && new Date(ch.safe_until) > new Date();

// base bar take accrued for one club up to the cap, in whole dollars (the business/territory pattern).
// A raid sets income_at into the future (= shut_until), so a shuttered club accrues NOTHING until it reopens.
function accruedIncome(row) {
  const tier = speakeasyTierOf(row.tier);
  if (!tier) return 0;
  const elapsed = Math.min(Date.now() - new Date(row.income_at).getTime(), SPEAKEASY.INCOME_CAP_MS);
  return Math.floor(tier.incomePerHr * Math.max(0, elapsed) / 3600000);
}

// ── step two — the Prohibition raid: NOTORIETY (decays hourly), the raid roll, and the shutter ──
function decayedNotoriety(row, now = Date.now()) {
  const hrs = Math.max(0, now - new Date(row.notoriety_at).getTime()) / 3600000;
  return Math.max(0, Number(row.notoriety) - hrs * SPEAKEASY.NOTORIETY_DECAY_HR);
}
const isShut = (row, now = Date.now()) => row.shut_until && new Date(row.shut_until).getTime() > now;

// add heat to a (locked) club row — the round + the table draw the Prohibition boys (mutates row in memory)
async function bumpNotoriety(client, row, amount) {
  const now = Date.now();
  const nn = Math.min(SPEAKEASY.NOTORIETY_MAX, decayedNotoriety(row, now) + amount);
  row.notoriety = nn; row.notoriety_at = new Date(now);
  await client.query('UPDATE speakeasies SET notoriety=$2, notoriety_at=now() WHERE district_id=$1', [row.district_id, nn]);
}

// resolve the notoriety window on the owner's collect (the §7.1 business-raid pattern): decay, and if the
// club sat ABOVE the threshold, roll one raid over those minutes. A raid SEIZES pending income (clock reset,
// never minted — no ledger row, the business/territory precedent), fines the owner (`speakeasy:raid`, a
// §10.4 cash sink clamped to pocket+bank), and SHUTTERS the club (income_at → shut_until so it earns nothing
// while dark). `SPEAKEASY_RAID_P` env overrides the per-minute p for tests (the BUSINESS_RAID_P precedent).
async function resolveRaid(ch, row, client, h) {
  const now = Date.now();
  const not0 = Number(row.notoriety);
  const elapsedHrs = Math.max(0, now - new Date(row.notoriety_at).getTime()) / 3600000;
  const not = Math.max(0, not0 - elapsedHrs * SPEAKEASY.NOTORIETY_DECAY_HR);
  if (not0 >= SPEAKEASY.RAID_THRESHOLD && !isShut(row, now)) {
    const hrsAbove = Math.min(elapsedHrs, (not0 - SPEAKEASY.RAID_THRESHOLD) / SPEAKEASY.NOTORIETY_DECAY_HR);
    const minAbove = Math.min(1440, hrsAbove * 60);
    const p = Number(process.env.SPEAKEASY_RAID_P ?? SPEAKEASY.RAID_P_PER_MIN);
    const pWindow = 1 - Math.pow(1 - p, minAbove);
    const roll = Math.random();
    if (roll < pWindow) {
      const seized = accruedIncome(row);
      const tier = speakeasyTierOf(row.tier);
      // the fine scales with the value at risk (open + decor sunk), clamped to pocket then bank (the
      // business:raid discipline — the §10.4 cash check covers cash+bank, so the one row stays exact)
      const fine = Math.min(Math.floor((SPEAKEASY.OPEN_COST + (tier?.cost || 0)) * SPEAKEASY.RAID_FINE_RATE),
        Math.max(0, Math.floor(Number(ch.cash) + Number(ch.bank))));
      const fromPocket = Math.min(fine, Math.max(0, Math.floor(Number(ch.cash))));
      ch.cash = Number(ch.cash) - fromPocket;
      ch.bank = Number(ch.bank) - (fine - fromPocket);
      const shut = new Date(now + SPEAKEASY.RAID_SHUT_MS);
      row.notoriety = 0; row.notoriety_at = new Date(now); row.income_at = shut; row.shut_until = shut;
      await client.query('UPDATE speakeasies SET notoriety=0, notoriety_at=now(), income_at=$2, shut_until=$2 WHERE district_id=$1', [row.district_id, shut]);
      if (fine > 0) await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -fine, reason: 'speakeasy:raid' });
      await h.rngLog(client, ch.id, `speakeasy:raid:${row.district_id}`, Math.round(roll * 1e4) / 1e4, `raided (P ${pWindow.toFixed(4)}, seized $${seized}, fined $${fine})`);
      await h.notify(client, ch.id, 'speakeasy_raid', { district: row.district_id, seized, fine });
      await h.track(client, ch.account_id, 'speakeasy_raid', { district: row.district_id, seized, fine });
      return { raided: true, seized, fine, shutSeconds: Math.ceil(SPEAKEASY.RAID_SHUT_MS / 1000) };
    }
  }
  row.notoriety = not; row.notoriety_at = new Date(now);
  await client.query('UPDATE speakeasies SET notoriety=$2, notoriety_at=now() WHERE district_id=$1', [row.district_id, not]);
  return { raided: false };
}

// Open the district's club (one per district, first-come). Level-gated, pocket cash pays. Opens at tier 0.
export async function openSpeakeasy(ch, districtId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', "You can't cut a ribbon from a cell.");
  if (!DISTRICTS.find((d) => d.id === districtId)) throw new GameError('bad_district', 'No such district.');
  if (levelOf(Number(ch.respect)) < SPEAKEASY.MIN_LEVEL)
    throw new GameError('level', `A club of your own opens up at level ${SPEAKEASY.MIN_LEVEL}.`);
  const mine = (await client.query('SELECT district_id FROM speakeasies WHERE owner_character=$1', [ch.id])).rows[0];
  if (mine) throw new GameError('own', 'You already run a house — a man can only be in one place at a time.');
  // lock the district's club slot (SELECT-then-INSERT; a concurrent open on the same district 23505s → contention)
  const existing = (await client.query('SELECT owner_character FROM speakeasies WHERE district_id=$1 FOR UPDATE', [districtId])).rows[0];
  if (existing) throw new GameError('taken', 'Someone already runs the club in that district.');
  if (Number(ch.cash) < SPEAKEASY.OPEN_COST) throw new GameError('cash', `Opening a club runs $${SPEAKEASY.OPEN_COST}.`);
  ch.cash = Number(ch.cash) - SPEAKEASY.OPEN_COST;
  await client.query('INSERT INTO speakeasies (district_id, owner_character, tier, prestige) VALUES ($1,$2,0,$3)',
    [districtId, ch.id, speakeasyTierOf(0).prestige]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -SPEAKEASY.OPEN_COST, reason: 'speakeasy:open' });
  await h.track(client, ch.account_id, 'speakeasy_open', { district: districtId });
  bus.emit('streets', { type: 'speakeasy_open', by: ch.name, district: districtId });
  return { ok: true, district: districtId, tier: 0, name: speakeasyTierOf(0).name };
}

// Collect the base bar take → pocket cash (lazy, capped, clock reset). An EXPOSED act (D2 safehouse gate).
export async function collectSpeakeasy(ch, client, h) {
  if (safeHoused(ch)) throw new GameError('safe', 'The take waits for a man on the floor, not a ghost.');
  const row = (await client.query('SELECT * FROM speakeasies WHERE owner_character=$1 FOR UPDATE', [ch.id])).rows[0];
  if (!row) throw new GameError('no_club', "You don't run a house.");
  // step two: the Prohibition raid resolves on the owner's touch — a hot club may be seized + shuttered
  const raid = await resolveRaid(ch, row, client, h);
  if (raid.raided) return { ok: true, collected: 0, raid, district: row.district_id };
  const inc = accruedIncome(row); // 0 while shut (income_at was pushed to shut_until by the raid)
  if (inc <= 0) return { ok: true, collected: 0, ...(isShut(row) ? { shutSeconds: Math.ceil((new Date(row.shut_until).getTime() - Date.now()) / 1000) } : {}) };
  ch.cash = Number(ch.cash) + inc;
  await client.query('UPDATE speakeasies SET income_at=now() WHERE district_id=$1', [row.district_id]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: inc, reason: 'speakeasy:income' });
  return { ok: true, collected: inc, district: row.district_id };
}

// Redo the decor to the next tier — banks the pending base take at the OLD rate first (never wiped),
// then pays. Raises income + the prestige floor. Pocket cash pays.
export async function upgradeSpeakeasy(ch, client, h) {
  const row = (await client.query('SELECT * FROM speakeasies WHERE owner_character=$1 FOR UPDATE', [ch.id])).rows[0];
  if (!row) throw new GameError('no_club', "You don't run a house.");
  const next = speakeasyTierOf(Number(row.tier) + 1);
  if (!next) throw new GameError('maxed', 'The Cathedral is the top of the world — no finer room in the city.');
  const pending = accruedIncome(row);
  if (Number(ch.cash) + pending < next.cost) throw new GameError('cash', `The ${next.name} runs $${next.cost} to build out.`);
  ch.cash = Number(ch.cash) + pending - next.cost;
  // the prestige floor climbs to the new tier (never drops below what rounds/bottles already earned)
  const prestige = Math.max(Number(row.prestige), next.prestige);
  await client.query('UPDATE speakeasies SET tier=$2, prestige=$3, income_at=now() WHERE district_id=$1',
    [row.district_id, next.tier, prestige]);
  if (pending > 0) await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: pending, reason: 'speakeasy:income' });
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -next.cost, reason: 'speakeasy:decor' });
  await h.track(client, ch.account_id, 'speakeasy_upgrade', { district: row.district_id, tier: next.tier });
  return { ok: true, district: row.district_id, tier: next.tier, name: next.name, collected: pending };
}

// Name the club — a $OMR vanity burn (rides vanity:%, zero invariant change). 3–24 printable chars.
export async function nameSpeakeasy(ch, name, client, h) {
  const row = (await client.query('SELECT * FROM speakeasies WHERE owner_character=$1 FOR UPDATE', [ch.id])).rows[0];
  if (!row) throw new GameError('no_club', "You don't run a house to name.");
  const n = String(name || '').trim();
  if (n.length < 3 || n.length > 24) throw new GameError('name', 'A club name runs 3–24 characters.');
  if (!/^[\w .,'&-]+$/.test(n)) throw new GameError('name', 'Letters, numbers and simple punctuation only.');
  if (n === (row.name || null)) throw new GameError('same', 'The club already carries that name.'); // no-op re-burn guard (changeName precedent)
  await spendOmr(client, h, SPEAKEASY.NAME_OMR, 'vanity:speakeasy');
  await client.query('UPDATE speakeasies SET name=$2 WHERE district_id=$1', [row.district_id, n]);
  await h.track(client, ch.account_id, 'speakeasy_name', { district: row.district_id });
  return { ok: true, district: row.district_id, name: n, spent: SPEAKEASY.NAME_OMR };
}

// upsert the guest-list row (SELECT-then-write — pg-mem ON CONFLICT is unreliable). Returns the row's
// prior last_at (for the cooldown) or null on a first visit.
async function bumpPatron(client, districtId, charId, { cash = 0, omr = 0 }) {
  const cur = (await client.query('SELECT visits, spent_cash, spent_omr, last_at FROM speakeasy_patrons WHERE district_id=$1 AND character_id=$2 FOR UPDATE', [districtId, charId])).rows[0];
  if (cur) {
    await client.query('UPDATE speakeasy_patrons SET visits=$3, spent_cash=$4, spent_omr=$5, last_at=now() WHERE district_id=$1 AND character_id=$2',
      [districtId, charId, Number(cur.visits) + 1, Number(cur.spent_cash) + cash, Number(cur.spent_omr) + omr]);
    return { visits: Number(cur.visits) + 1, prior: cur.last_at };
  }
  await client.query('INSERT INTO speakeasy_patrons (district_id, character_id, visits, spent_cash, spent_omr) VALUES ($1,$2,1,$3,$4)',
    [districtId, charId, cash, omr]);
  return { visits: 1, prior: null };
}

// BUY A ROUND — a taxed cash transfer patron → owner (the bodyguard-hire pattern: owner nets 98%, 1%
// street tax → the buyback, 1% dev off-ledger), a flex on the guest list + prestige to the club. Runs
// under withTwoCharacters(patron, owner) — the owner arrives locked as the second row. District-pinned.
export async function visitSpeakeasy(ch, owner, districtId, roundId, client, h) {
  const round = speakeasyRoundOf(roundId);
  if (!round) throw new GameError('bad_round', 'No such round on the menu.');
  if (jailed(ch)) throw new GameError('jailed', 'No nights out from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp', "You're in no shape to be out on the town.");
  if (safeHoused(ch)) throw new GameError('safe', "You can't be seen at the club while you're supposed to be to ground.");
  if (ch.loc !== districtId) throw new GameError('travel', "You're not in that district — go there first.");
  if (owner.id === ch.id) throw new GameError('own_club', "You don't buy rounds at your own joint.");
  // re-read the club under the owner's lock: gone / owner changed (a death/reopen race) → clean retry
  const row = (await client.query('SELECT * FROM speakeasies WHERE district_id=$1 FOR UPDATE', [districtId])).rows[0];
  if (!row || row.owner_character !== owner.id) throw new GameError('gone', 'The club changed hands — try again.');
  if (isShut(row)) throw new GameError('shut', 'The place is dark — the Prohibition boys shut it down. Come back later.');
  if (Number(ch.cash) < round.cost) throw new GameError('cash', `That round runs $${round.cost}.`);
  // cooldown FIRST (ch is locked by withTwoCharacters, so same-patron rounds serialize — no TOCTOU)
  const prior = (await client.query('SELECT last_at FROM speakeasy_patrons WHERE district_id=$1 AND character_id=$2', [districtId, ch.id])).rows[0];
  if (prior && Date.now() - new Date(prior.last_at).getTime() < SPEAKEASY.VISIT_CD_MS)
    throw new GameError('cooldown', 'You were just here — give the room a while.');
  // the standard 2% house take (1% street tax → buyback + 1% dev off-ledger), the bodyguard/exchange
  // parity — an untaxed unlimited P2P transfer is the cheapest value pipe in the game. Owner nets 98%.
  const fee = Math.ceil(round.cost * 0.01), tax = Math.ceil(round.cost * 0.01);
  const net = round.cost - fee - tax;
  ch.cash = Number(ch.cash) - round.cost;
  owner.cash = Number(owner.cash) + net;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -round.cost, reason: 'speakeasy:round', counterparty: owner.id });
  await h.ledger(client, { characterId: owner.id, currency: 'cash', amount: net, reason: 'speakeasy:round', counterparty: ch.id });
  await client.query('UPDATE speakeasies SET prestige = prestige + $2 WHERE district_id=$1', [districtId, round.prestige]); // club row already locked
  await bumpNotoriety(client, row, SPEAKEASY.ROUND_NOTORIETY); // a busy bar draws the Prohibition boys (the raid tie)
  const p = await bumpPatron(client, districtId, ch.id, { cash: round.cost }); // the patron leaf row
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [tax]); // singleton LAST (audit LOW-1: keep the canonical characters→leaves→singletons order — no latent deadlock trap)
  const regular = p.visits >= SPEAKEASY.REGULAR_VISITS;
  await h.notify(client, owner.id, 'speakeasy_round', { from: ch.name, round: round.name, net });
  bus.emit('streets', { type: 'speakeasy_round', by: ch.name, at: row.name || districtId });
  await h.track(client, ch.account_id, 'speakeasy_round', { district: districtId, round: roundId, cost: round.cost });
  return { ok: true, district: districtId, round: round.name, paid: round.cost, toOwner: net, visits: p.visits, regular };
}

// BOTTLE SERVICE — the ultra-premium flex: a pure-status $OMR BURN (rides vanity:%, deflationary), big
// prestige to the club + your name up in lights on the guest list. No owner cut (a burn, not a transfer).
// Runs under withCharacter (the patron is the only party). District-pinned; allowed at your own club.
export async function bottleService(ch, districtId, bottleId, client, h) {
  const bottle = speakeasyBottleOf(bottleId);
  if (!bottle) throw new GameError('bad_bottle', 'No such bottle on the list.');
  if (jailed(ch)) throw new GameError('jailed', 'No bottle service from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp', "You're in no shape to be out on the town.");
  if (safeHoused(ch)) throw new GameError('safe', "You can't be seen at the club while you're supposed to be to ground.");
  if (ch.loc !== districtId) throw new GameError('travel', "You're not in that district — go there first.");
  const row = (await client.query('SELECT * FROM speakeasies WHERE district_id=$1 FOR UPDATE', [districtId])).rows[0];
  if (!row) throw new GameError('no_club', "There's no club in that district.");
  await spendOmr(client, h, bottle.omr, 'vanity:speakeasy'); // a $OMR burn (rides vanity:%)
  const p = await bumpPatron(client, districtId, ch.id, { omr: bottle.omr });
  await client.query('UPDATE speakeasies SET prestige = prestige + $2 WHERE district_id=$1', [districtId, bottle.prestige]);
  bus.emit('streets', { type: 'speakeasy_bottle', by: ch.name, at: row.name || districtId, bottle: bottle.name });
  await h.track(client, ch.account_id, 'speakeasy_bottle', { district: districtId, bottle: bottleId, omr: bottle.omr });
  return { ok: true, district: districtId, bottle: bottle.name, spent: bottle.omr, visits: p.visits };
}

// THE BACK-ROOM TABLE — the club hosts a house game (the wheel). The patron bets CASH, the OWNER takes a
// RAKE carved from the stake (a transfer, never minted on top — the casino discipline), the rest wagers at
// WIN_P and a win pays 2× (the edge BURNS, deflationary). Draws NOTORIETY (the raid tie). Two-party
// (patron + owner). CASH only (the Den's hard rule — no $OMR at the table). District-pinned.
export async function playTable(ch, owner, districtId, stake, client, h) {
  const bet = Math.floor(Number(stake));
  if (!Number.isFinite(bet) || bet < SPEAKEASY.TABLE.MIN_BET) throw new GameError('min', `The table takes $${SPEAKEASY.TABLE.MIN_BET} minimum.`);
  if (bet > SPEAKEASY.TABLE.MAX_BET) throw new GameError('max', `The table caps at $${SPEAKEASY.TABLE.MAX_BET} a spin.`);
  if (jailed(ch)) throw new GameError('jailed', 'No table from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp', "You're in no shape to be out on the town.");
  if (safeHoused(ch)) throw new GameError('safe', "You can't be seen at the table while you're supposed to be to ground.");
  if (ch.loc !== districtId) throw new GameError('travel', "You're not in that district — go there first.");
  const row = (await client.query('SELECT * FROM speakeasies WHERE district_id=$1 FOR UPDATE', [districtId])).rows[0];
  if (!row || row.owner_character !== owner.id) throw new GameError('gone', 'The club changed hands — try again.');
  if (isShut(row)) throw new GameError('shut', 'The place is dark — the Prohibition boys shut it down. Come back later.');
  if (Number(ch.cash) < bet) throw new GameError('cash', 'Not that much in pocket.');
  const rake = Math.ceil(bet * SPEAKEASY.TABLE.RAKE_BPS / 10000);
  const wager = bet - rake;
  const roll = Math.random();
  const win = roll < SPEAKEASY.TABLE.WIN_P;
  ch.cash = Number(ch.cash) - bet;              // the patron pays the full bet
  owner.cash = Number(owner.cash) + rake;       // the club's cut, carved from the stake (a transfer, not a mint)
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -bet, reason: 'speakeasy:table:bet' });
  await h.ledger(client, { characterId: owner.id, currency: 'cash', amount: rake, reason: 'speakeasy:table:rake', counterparty: ch.id });
  let payout = 0;
  if (win) { payout = wager * 2; ch.cash = Number(ch.cash) + payout; await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: payout, reason: 'speakeasy:table:win' }); }
  await h.rngLog(client, ch.id, `speakeasy:table:${districtId}`, Math.round(roll * 1e4) / 1e4, win ? `win $${payout}` : 'loss');
  await bumpNotoriety(client, row, SPEAKEASY.TABLE.NOTORIETY); // gambling draws the Prohibition boys
  bus.emit('streets', { type: 'speakeasy_table', by: ch.name, at: row.name || districtId, win });
  await h.track(client, ch.account_id, 'speakeasy_table', { district: districtId, bet, win });
  return { ok: true, district: districtId, bet, rake, win, payout, net: (win ? payout : 0) - bet, toOwner: rake };
}

// the owner's club summary (for loadOwned + the character view). null if they run no house.
export async function speakeasyOwnedOf(pool, characterId) {
  const row = (await pool.query('SELECT * FROM speakeasies WHERE owner_character=$1', [characterId])).rows[0];
  if (!row) return null;
  const tier = speakeasyTierOf(row.tier), next = speakeasyTierOf(Number(row.tier) + 1);
  const shut = isShut(row);
  return { district: row.district_id, name: row.name || null, tier: Number(row.tier), tierName: tier?.name || null,
    incomePerHr: tier?.incomePerHr || 0, pending: accruedIncome(row), prestige: Math.round(Number(row.prestige)),
    notoriety: Math.round(decayedNotoriety(row)), raidRisk: decayedNotoriety(row) >= SPEAKEASY.RAID_THRESHOLD,
    shutSeconds: shut ? Math.ceil((new Date(row.shut_until).getTime() - Date.now()) / 1000) : 0,
    nextTier: next ? { tier: next.tier, name: next.name, cost: next.cost } : null };
}

// GET /v1/speakeasy — the nightlife map: every district's club (owner, name, tier, prestige) + your own
// club + your standing at each. Two flat queries (pg-mem can't parse correlated subqueries — the /v1/gangs
// precedent). Ranked by prestige.
export async function speakeasyBoard(pool, characterId) {
  const clubs = (await pool.query(
    `SELECT s.district_id, s.owner_character, s.name, s.tier, s.prestige, s.shut_until, c.name AS owner_name
       FROM speakeasies s JOIN characters c ON c.id = s.owner_character`)).rows;
  const patrons = (await pool.query(
    `SELECT p.district_id, p.character_id, p.visits, p.spent_cash, p.spent_omr, c.name
       FROM speakeasy_patrons p JOIN characters c ON c.id = p.character_id AND c.alive`)).rows;
  const byClub = new Map();
  for (const p of patrons) {
    if (!byClub.has(p.district_id)) byClub.set(p.district_id, []);
    byClub.get(p.district_id).push({ name: p.name, visits: Number(p.visits),
      spent: Math.floor(Number(p.spent_cash)), omr: Math.floor(Number(p.spent_omr)),
      regular: Number(p.visits) >= SPEAKEASY.REGULAR_VISITS, you: p.character_id === characterId });
  }
  const map = clubs.map((s) => {
    const tier = speakeasyTierOf(s.tier);
    const list = (byClub.get(s.district_id) || []).sort((a, b) => (b.spent + b.omr * 500) - (a.spent + a.omr * 500));
    return { district: s.district_id, owner: s.owner_name, name: s.name || null, mine: s.owner_character === characterId,
      tier: Number(s.tier), tierName: tier?.name || null, prestige: Math.round(Number(s.prestige)),
      shut: isShut(s), regulars: list.filter((x) => x.regular).length, guestList: list.slice(0, 8) };
  }).sort((a, b) => b.prestige - a.prestige);
  // the open districts (no club yet) — where a made man could plant a flag
  const open = DISTRICTS.filter((d) => !clubs.find((c) => c.district_id === d.id)).map((d) => d.id);
  return { clubs: map, open, rounds: SPEAKEASY.ROUNDS, bottles: SPEAKEASY.BOTTLES,
    table: { minBet: SPEAKEASY.TABLE.MIN_BET, maxBet: SPEAKEASY.TABLE.MAX_BET, rakeBps: SPEAKEASY.TABLE.RAKE_BPS },
    openCost: SPEAKEASY.OPEN_COST, minLevel: SPEAKEASY.MIN_LEVEL };
}

// estate hook — a dead proprietor's club goes dark (+ its guest list); patron rows at other clubs also
// clear with the patron. Called from runEstate.
export async function wipeSpeakeasyAtDeath(client, characterId) {
  await client.query('DELETE FROM speakeasy_patrons WHERE character_id=$1', [characterId]);
  await client.query("DELETE FROM speakeasy_patrons WHERE district_id IN (SELECT district_id FROM speakeasies WHERE owner_character=$1)", [characterId]);
  await client.query('DELETE FROM speakeasies WHERE owner_character=$1', [characterId]);
}

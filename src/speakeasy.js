// THE SPEAKEASY — the social hub (omerta-speakeasy-design.md). ONE club per district, opened by a made
// man, where rivals gather and perform status. The proprietor runs a front (base bar take, lazy + capped,
// the business pattern) and climbs a decor ladder; patrons buy ROUNDS (a taxed cash transfer to the owner
// — the bodyguard-hire pattern) and bottle service (a pure-status $OMR burn), both flexed on the guest
// list. Prestige ranks the nightlife. §10.4: `speakeasy:` is a cash SINK/FAUCET/TRANSFER vocabulary (all
// character_id'd → the per-character cash check reconciles); bottles/naming ride `vanity:%` (no omr change).
import { GameError, bus, skillMult, bumpMastery } from './game.js';
import { SPEAKEASY, DISTRICTS, speakeasyTierOf, speakeasyRoundOf, speakeasyBottleOf, levelOf, renownRankOf, decorStyleOf, styleUnlockOf, assessedValueOf, effStat, SKILLS } from './rules.js';
import { spendOmr } from './vanity.js';

const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const hospitalized = (ch) => ch.hosp_until && new Date(ch.hosp_until) > new Date();
const safeHoused = (ch) => ch.safe_until && new Date(ch.safe_until) > new Date();
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

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
  // NO MADE-MAN GATE HERE — retired by founder decision D8=C (SIGN-OFF, 2026-08-02): the
  // subscription gates STATUS ONLY, and a speakeasy earns cash, so gating it put $OMR in front of an
  // earning loop. That is the line v3 §4.3 names as binding, and the design's own §11.2 sat on both
  // sides of it. Opening a club is now level + cash like every other front.
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
  // SIGN-OFF (net-EV): protection + wages come off the top — a recurring UPKEEP cut (the business-'pad'
  // 20% rate) so the passive bar take isn't a risk-free faucet. §10.4-clean: both rows character_id'd and
  // ride the existing speakeasy: cash prefix, so the per-character check reconciles with zero vocab change.
  const upkeep = Math.floor(inc * SPEAKEASY.UPKEEP_BPS / 10000);
  const net = inc - upkeep;
  ch.cash = Number(ch.cash) + net;
  await client.query('UPDATE speakeasies SET income_at=now() WHERE district_id=$1', [row.district_id]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: inc, reason: 'speakeasy:income' });
  if (upkeep > 0) await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -upkeep, reason: 'speakeasy:upkeep' });
  return { ok: true, collected: net, gross: inc, upkeep, district: row.district_id };
}

// Redo the decor to the next tier — banks the pending base take at the OLD rate first (never wiped),
// then pays. Raises income + the prestige floor. Pocket cash pays.
export async function upgradeSpeakeasy(ch, client, h) {
  if (jailed(ch)) throw new GameError('jailed', "You can't renovate from a cell.");
  // (red-team R3, D2 parity) upgrading BANKS the pending bar take at line ~143 — the income-realizing act
  // collectSpeakeasy gates. A safehoused (untargetable) owner must not run the club from the bunker.
  if (safeHoused(ch)) throw new GameError('safe', 'The take waits for a man on the floor, not a ghost.');
  const row = (await client.query('SELECT * FROM speakeasies WHERE owner_character=$1 FOR UPDATE', [ch.id])).rows[0];
  if (!row) throw new GameError('no_club', "You don't run a house.");
  const next = speakeasyTierOf(Number(row.tier) + 1);
  if (!next) throw new GameError('maxed', 'The Cathedral is the top of the world — no finer room in the city.');
  // resolve the raid FIRST (the business:upgradeBusiness precedent — audit MED-1): a hot club can't dodge
  // the raid roll by upgrading instead of collecting, and a shuttered club can't renovate to resume income.
  const raid = await resolveRaid(ch, row, client, h);
  if (raid.raided) return { ok: true, district: row.district_id, raid };
  if (isShut(row)) throw new GameError('shut', 'The place is dark — wait out the shutter before you renovate.');
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

// per-(patron,club) daily notoriety BUDGET (a token bucket — the wash/launder precedent). Charges the club
// ONLY the portion the patron still has budget for (cap < RAID_THRESHOLD), so no single account can force a
// raid (audit HIGH-1) — a hot club needs distinct traffic. Legit play is uncapped; only its heat is.
async function chargeNotoriety(client, districtId, row, charId, want) {
  const now = Date.now();
  const cur = (await client.query('SELECT noto_used, noto_at FROM speakeasy_patrons WHERE district_id=$1 AND character_id=$2 FOR UPDATE', [districtId, charId])).rows[0];
  const refill = cur ? (now - new Date(cur.noto_at).getTime()) / (24 * 3600 * 1000) * SPEAKEASY.PATRON_NOTORIETY_CAP : SPEAKEASY.PATRON_NOTORIETY_CAP;
  const usedAfter = Math.max(0, Number(cur?.noto_used || 0) - Math.max(0, refill));
  const allowed = Math.max(0, Math.min(want, SPEAKEASY.PATRON_NOTORIETY_CAP - usedAfter));
  const newUsed = usedAfter + allowed;
  if (cur) await client.query('UPDATE speakeasy_patrons SET noto_used=$3, noto_at=now() WHERE district_id=$1 AND character_id=$2', [districtId, charId, newUsed]);
  else if (allowed > 0) await client.query('INSERT INTO speakeasy_patrons (district_id, character_id, noto_used, noto_at) VALUES ($1,$2,$3,now())', [districtId, charId, newUsed]);
  if (allowed > 0) await bumpNotoriety(client, row, allowed);
  return allowed;
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
  const p = await bumpPatron(client, districtId, ch.id, { cash: round.cost }); // the patron leaf row (ensures it exists)
  await chargeNotoriety(client, districtId, row, ch.id, SPEAKEASY.ROUND_NOTORIETY); // a busy bar draws heat — capped per patron (anti-grief)
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
  await chargeNotoriety(client, districtId, row, ch.id, SPEAKEASY.TABLE.NOTORIETY); // gambling draws heat — capped per patron so a rival can't flood a club into a raid (audit HIGH-1)
  bus.emit('streets', { type: 'speakeasy_table', by: ch.name, at: row.name || districtId, win });
  await h.track(client, ch.account_id, 'speakeasy_table', { district: districtId, bet, win });
  return { ok: true, district: districtId, bet, rake, win, payout, net: (win ? payout : 0) - bet, toOwner: rake };
}

// ── step three — cross-club RENOWN (the nightlife legend, pure DERIVED status). Bottle-service ($OMR)
// is weighted heaviest — the flex is worth the most. Owning a club adds its prestige. No column, no §10.4.
function renownScore(cash, omr, ownPrestige) {
  const R = SPEAKEASY.RENOWN;
  return Math.floor(Number(cash) / R.CASH_PER + Number(omr) * R.OMR_WEIGHT + Number(ownPrestige) * R.OWNER_WEIGHT);
}

// transfer a club to a new owner — a FRESH house: guest list cleared, sale + heat reset, decor REVERTED to
// stock (a decor STYLE is an account-level owner-BOUND entitlement — the departing owner keeps their
// store_cosmetics unlock; the new owner brings/buys their own). A SHUT club (raided/dark) keeps income_at =
// shut_until so the new owner waits out the shutter (the round/table isShut gate); else the clock resets.
// Shared by the consensual BUYOUT and the hostile STANDOVER. Never touches standover_cd_until.
async function resetClubToNewOwner(client, districtId, newOwnerId, shut) {
  await client.query('DELETE FROM speakeasy_patrons WHERE district_id=$1', [districtId]);
  if (shut)
    await client.query('UPDATE speakeasies SET owner_character=$2, sale_price=NULL, decor_style=NULL, notoriety=0, notoriety_at=now() WHERE district_id=$1', [districtId, newOwnerId]);
  else
    await client.query('UPDATE speakeasies SET owner_character=$2, sale_price=NULL, decor_style=NULL, notoriety=0, notoriety_at=now(), income_at=now() WHERE district_id=$1', [districtId, newOwnerId]);
}

// ── step three — the P2P BUYOUT (a district clears without a death). The owner LISTS a sale price; a
// buyer completes a consensual TAXED cash transfer (the round pattern) to take the keys. ──
export async function listSpeakeasy(ch, price, client, h) {
  const p = Math.floor(Number(price));
  if (!Number.isFinite(p) || p < SPEAKEASY.SALE_MIN) throw new GameError('price', `Ask at least $${SPEAKEASY.SALE_MIN} for the place.`);
  if (p > SPEAKEASY.SALE_MAX) throw new GameError('price', `The most you can ask is $${SPEAKEASY.SALE_MAX}.`);
  const row = (await client.query('SELECT district_id FROM speakeasies WHERE owner_character=$1 FOR UPDATE', [ch.id])).rows[0];
  if (!row) throw new GameError('no_club', "You don't run a house to sell.");
  await client.query('UPDATE speakeasies SET sale_price=$2 WHERE district_id=$1', [row.district_id, p]);
  await h.track(client, ch.account_id, 'speakeasy_list', { district: row.district_id, price: p });
  return { ok: true, district: row.district_id, salePrice: p };
}
export async function unlistSpeakeasy(ch, client, h) {
  const row = (await client.query('SELECT district_id, sale_price FROM speakeasies WHERE owner_character=$1 FOR UPDATE', [ch.id])).rows[0];
  if (!row) throw new GameError('no_club', "You don't run a house.");
  if (row.sale_price == null) throw new GameError('not_listed', "The club isn't on the market.");
  await client.query('UPDATE speakeasies SET sale_price=NULL WHERE district_id=$1', [row.district_id]);
  return { ok: true, district: row.district_id };
}

// BUY OUT a listed club — a taxed cash transfer buyer → seller (the round/bodyguard pattern: seller nets
// 98%, 1% street tax → buyback, 1% dev off-ledger), then ownership flips to the buyer. Runs under
// withTwoCharacters(buyer, seller). The seller's pending bar take (+ any pending raid) is settled for
// THEM first (they earned it); the guest list resets (a fresh house). District-pinned (you show up).
export async function buySpeakeasy(ch, seller, districtId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', "You can't take the keys from a cell.");
  if (hospitalized(ch)) throw new GameError('hosp', "You're in no shape to be taking over a club.");
  if (safeHoused(ch)) throw new GameError('safe', "You can't do a public sit-down while you're supposed to be to ground.");
  if (levelOf(Number(ch.respect)) < SPEAKEASY.MIN_LEVEL)
    throw new GameError('level', `Running a house of your own opens up at level ${SPEAKEASY.MIN_LEVEL}.`);
  if (ch.loc !== districtId) throw new GameError('travel', "You're not in that district — go there to take over.");
  if (seller.id === ch.id) throw new GameError('own_club', 'You already run that house.');
  const mine = (await client.query('SELECT district_id FROM speakeasies WHERE owner_character=$1', [ch.id])).rows[0];
  if (mine) throw new GameError('own', 'A man runs one house at a time — sell yours first.');
  // re-read the club under the seller's lock (withTwoCharacters locked both chars): gone / changed hands → retry
  const row = (await client.query('SELECT * FROM speakeasies WHERE district_id=$1 FOR UPDATE', [districtId])).rows[0];
  if (!row || row.owner_character !== seller.id) throw new GameError('gone', 'The club changed hands — try again.');
  if (row.sale_price == null) throw new GameError('not_for_sale', "That club isn't on the market.");
  const price = Math.floor(Number(row.sale_price));
  if (Number(ch.cash) < price) throw new GameError('cash', `That club runs $${price}.`);
  // settle the SELLER's pending first (they earned it): resolve a pending raid, then bank pending income.
  // A raid at handover shutters the club (income_at → shut_until) — the buyer inherits the (shut) venue.
  const raid = await resolveRaid(seller, row, client, h);
  if (!raid.raided) {
    const inc = accruedIncome(row);
    if (inc > 0) {
      seller.cash = Number(seller.cash) + inc;
      await h.ledger(client, { characterId: seller.id, currency: 'cash', amount: inc, reason: 'speakeasy:income' });
    }
  }
  // the standard 2% house take (1% street tax → buyback + 1% dev off-ledger), the round/bodyguard parity
  const fee = Math.ceil(price * 0.01), tax = Math.ceil(price * 0.01);
  const net = price - fee - tax;
  ch.cash = Number(ch.cash) - price;
  seller.cash = Number(seller.cash) + net;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -price, reason: 'speakeasy:buyout', counterparty: seller.id });
  await h.ledger(client, { characterId: seller.id, currency: 'cash', amount: net, reason: 'speakeasy:buyout', counterparty: ch.id });
  await resetClubToNewOwner(client, districtId, ch.id, isShut(row)); // a fresh house — see the helper
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [tax]); // singleton LAST (canonical order)
  await h.notify(client, seller.id, 'speakeasy_sold', { district: districtId, net });
  bus.emit('streets', { type: 'speakeasy_buyout', by: ch.name, from: seller.name, district: districtId });
  await h.track(client, ch.account_id, 'speakeasy_buyout', { district: districtId, price });
  return { ok: true, district: districtId, paid: price, toSeller: net, tier: Number(row.tier), name: row.name || null, raid: raid.raided ? raid : undefined };
}

// the actor's cross-club RENOWN — the derived nightlife-legend score (their patronage + own club prestige).
// Single-character SUM (no GROUP BY — pg-mem handles COALESCE(SUM(col)) fine, the invariants precedent).
async function renownOfChar(client, characterId) {
  const p = (await client.query('SELECT COALESCE(SUM(spent_cash),0) sc, COALESCE(SUM(spent_omr),0) so FROM speakeasy_patrons WHERE character_id=$1', [characterId])).rows[0];
  const c = (await client.query('SELECT COALESCE(SUM(prestige),0) pr FROM speakeasies WHERE owner_character=$1', [characterId])).rows[0];
  return renownScore(p.sc, p.so, c.pr);
}

// APPLY a cosmetic decor style to your club (display-only). null clears to stock (free — you own the club).
// A style is either BOUGHT (a Store `store_cosmetics` unlock) or RENOWN-EARNED (step four — `RENOWN.STYLE_UNLOCKS`,
// gated by your nightlife renown, no purchase). Runs under withCharacter.
export async function applyDecor(ch, styleId, client, h) {
  const style = styleId == null || styleId === '' ? null : String(styleId);
  if (style !== null && !decorStyleOf(style)) throw new GameError('bad_style', 'No such decor style.');
  const row = (await client.query('SELECT district_id FROM speakeasies WHERE owner_character=$1 FOR UPDATE', [ch.id])).rows[0];
  if (!row) throw new GameError('no_club', "You don't run a house to decorate.");
  if (style !== null) {
    const need = styleUnlockOf(style); // a renown threshold → an EARNED style; undefined → a bought (Store) style
    if (need != null) {
      const renown = await renownOfChar(client, ch.id);
      if (renown < need) throw new GameError('renown', `The ${decorStyleOf(style)} style unlocks at ${need} renown — be seen more.`);
    } else {
      const owned = (await client.query('SELECT 1 FROM store_cosmetics WHERE account_id=$1 AND style=$2', [ch.account_id, style])).rows[0];
      if (!owned) throw new GameError('locked', "You don't own that decor style — buy it in the Store.");
    }
  }
  await client.query('UPDATE speakeasies SET decor_style=$2 WHERE district_id=$1', [row.district_id, style]);
  return { ok: true, district: row.district_id, decor: style, decorName: style ? decorStyleOf(style) : null };
}

// ── step four — the STANDOVER (a hostile forced-sale). A challenger pays a FEE (burns win or lose) and rolls
// a muscle/cunning contest vs the owner (the shakedown pattern). A WIN forces the owner to SELL at the club's
// ASSESSED (build) value — the owner is PAID (taxed, the buyout §10.4), so it's a forced sale, never theft;
// the challenger risks the fee + must carry the full assessed price. Two-party (challenger + owner). A
// per-club cooldown bounds spam. §10.4: the fee is a `speakeasy:standover` SINK, the win reuses `speakeasy:buyout`.
export async function standoverSpeakeasy(ch, owner, districtId, client, h) {
  const S = SPEAKEASY.STANDOVER;
  if (jailed(ch)) throw new GameError('jailed', 'No muscle work from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp_self', "You're in no shape to lean on anyone.");
  if (safeHoused(ch)) throw new GameError('safe', "You can't run a standover while you're supposed to be to ground.");
  if (hospitalized(owner)) throw new GameError('hosp', "They're under the Doc's care — even we have rules."); // audit F1: shakedown parity
  if (levelOf(Number(ch.respect)) < SPEAKEASY.MIN_LEVEL) throw new GameError('level', `Standing over a made man's club takes level ${SPEAKEASY.MIN_LEVEL}.`);
  if (ch.loc !== districtId) throw new GameError('travel', "You're not in that district — go there to lean on the place.");
  if (owner.id === ch.id) throw new GameError('own_club', "You don't stand over your own joint.");
  if (h.owned.gangId && h.victimOwned.gangId === h.owned.gangId) throw new GameError('family', "They're family. Omertà.");
  const mine = (await client.query('SELECT district_id FROM speakeasies WHERE owner_character=$1', [ch.id])).rows[0];
  if (mine) throw new GameError('own', 'A man runs one house — you already have yours.');
  const row = (await client.query('SELECT * FROM speakeasies WHERE district_id=$1 FOR UPDATE', [districtId])).rows[0];
  if (!row || row.owner_character !== owner.id) throw new GameError('gone', 'The club changed hands — try again.');
  if (isShut(row)) throw new GameError('shut', 'The place is already dark — nothing to take.');
  if (row.standover_cd_until && new Date(row.standover_cd_until) > new Date())
    throw new GameError('cooldown', 'Someone leaned on this place recently — let it cool off.');
  const price = assessedValueOf(row.tier);
  if (Number(ch.cash) < S.FEE + price)
    throw new GameError('cash', `A standover runs $${S.FEE} up front and you'd owe $${price} for the place on a win — bring $${S.FEE + price}.`);
  // the FEE BURNS win or lose (a cash sink), heat lands either way, and the club goes on cooldown (set FIRST
  // so it holds regardless of outcome — resetClubToNewOwner never touches standover_cd_until)
  ch.cash = Number(ch.cash) - S.FEE;
  ch.heat = Math.min(100, Number(ch.heat || 0) + S.HEAT);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -S.FEE, reason: 'speakeasy:standover' });
  await client.query('UPDATE speakeasies SET standover_cd_until=$2 WHERE district_id=$1', [districtId, new Date(Date.now() + S.CD_MS)]);
  const eff = (s) => effStat(ch[s], s, h.owned.assets, h.owned.gear);
  const oEff = (s) => effStat(owner[s], s, h.victimOwned.assets, h.victimOwned.gear);
  const atk = (eff('muscle') + eff('cunning') * 0.5) * skillMult(h, 'bruiser', SKILLS.FX.BRUISER_MULT) * skillMult(h, 'made_man', SKILLS.FX.MADE_MAN_MULT);
  const def = oEff('muscle') + oEff('cunning') * 0.5;
  let p = Math.max(S.MIN_P, Math.min(S.MAX_P, S.BASE_P + (atk - def) / S.STAT_SCALE));
  if (process.env.SPEAKEASY_STANDOVER_P != null) p = Number(process.env.SPEAKEASY_STANDOVER_P); // TEST-ONLY (the raid precedent)
  const roll = Math.random();
  const won = roll < p;
  await h.rngLog(client, ch.id, `speakeasy:standover:${districtId}`, Math.round(roll * 1e4) / 1e4, won ? `won (p ${p.toFixed(3)})` : `repelled (p ${p.toFixed(3)})`);
  if (!won) {
    ch.health = Math.max(1, Number(ch.health) - rand(10, 25)); // the club's security saw you off
    await h.notify(client, owner.id, 'standover_repelled', { from: ch.name, district: districtId });
    bus.emit('streets', { type: 'speakeasy_standover', by: ch.name, at: row.name || districtId, won: false });
    await h.track(client, ch.account_id, 'speakeasy_standover', { district: districtId, won: false });
    return { ok: true, won: false, feePaid: S.FEE };
  }
  await bumpMastery(client, h, ch, 'muscle', 'standover'); // THE TRADES — the hostile takeover of a whole club
  // WON — a forced sale at the assessed (build) value: the owner is PAID (taxed, the buyout pattern), loses the club.
  // Resolve the owner's pending raid FIRST (the buySpeakeasy precedent — audit F3): a WON standover must NOT wipe a
  // hot club clean, else a friendly standover would launder a pending raid (the outgoing owner escaping the fine).
  await resolveRaid(owner, row, client, h); // fines the owner + may shutter the club before handover (isShut carried below)
  const fee = Math.ceil(price * 0.01), tax = Math.ceil(price * 0.01), net = price - fee - tax;
  ch.cash = Number(ch.cash) - price;
  owner.cash = Number(owner.cash) + net;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -price, reason: 'speakeasy:buyout', counterparty: owner.id });
  await h.ledger(client, { characterId: owner.id, currency: 'cash', amount: net, reason: 'speakeasy:buyout', counterparty: ch.id });
  await resetClubToNewOwner(client, districtId, ch.id, isShut(row)); // the cooldown set above survives this
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [tax]); // singleton LAST
  await h.notify(client, owner.id, 'standover_lost', { from: ch.name, district: districtId, net });
  bus.emit('streets', { type: 'speakeasy_standover', by: ch.name, from: owner.name, at: row.name || districtId, won: true });
  await h.track(client, ch.account_id, 'speakeasy_standover', { district: districtId, won: true, price });
  return { ok: true, won: true, feePaid: S.FEE, paid: price, toOwner: net, tier: Number(row.tier), name: row.name || null };
}

// GET /v1/leaderboard/nightlife — the scene ranked by RENOWN (the hitmen-board full-scan precedent). Two
// flat queries + aggregate in JS (pg-mem GROUP BY-SUM is dicey — the /v1/gangs precedent). Living only.
export async function nightlifeLeaderboard(pool, characterId) {
  // agents are excluded from the human status board (the boxing/port/races precedent — this board also
  // GATES renown-earned cosmetic decor, so consistency matters); join the account to filter agent_flag.
  const patrons = (await pool.query(
    `SELECT p.character_id, p.spent_cash, p.spent_omr, c.name FROM speakeasy_patrons p
       JOIN characters c ON c.id = p.character_id AND c.alive
       JOIN account_persistent a ON a.account_id = c.account_id AND NOT a.agent_flag`)).rows;
  const clubs = (await pool.query(
    `SELECT s.owner_character, s.prestige, c.name FROM speakeasies s
       JOIN characters c ON c.id = s.owner_character AND c.alive
       JOIN account_persistent a ON a.account_id = c.account_id AND NOT a.agent_flag`)).rows;
  const agg = new Map();
  const bump = (id, name, f) => { const e = agg.get(id) || { name, cash: 0, omr: 0, ownPrestige: 0 }; f(e); if (name && !e.name) e.name = name; agg.set(id, e); };
  for (const p of patrons) bump(p.character_id, p.name, (e) => { e.cash += Number(p.spent_cash); e.omr += Number(p.spent_omr); });
  for (const cl of clubs) bump(cl.owner_character, cl.name, (e) => { e.ownPrestige += Number(cl.prestige); });
  const board = [...agg.entries()].map(([id, e]) => {
    const score = renownScore(e.cash, e.omr, e.ownPrestige);
    return { name: e.name, renown: score, rank: renownRankOf(score).name, you: id === characterId };
  }).filter((x) => x.renown > 0).sort((a, b) => b.renown - a.renown).slice(0, 15);
  return { board };
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
    salePrice: row.sale_price == null ? null : Math.floor(Number(row.sale_price)),
    decor: row.decor_style || null, decorName: row.decor_style ? decorStyleOf(row.decor_style) : null,
    assessedValue: assessedValueOf(row.tier), // the STANDOVER forced-sale price if a rival leans on you
    standoverCdSeconds: row.standover_cd_until && new Date(row.standover_cd_until) > new Date()
      ? Math.ceil((new Date(row.standover_cd_until).getTime() - Date.now()) / 1000) : 0,
    nextTier: next ? { tier: next.tier, name: next.name, cost: next.cost } : null };
}

// GET /v1/speakeasy — the nightlife map: every district's club (owner, name, tier, prestige) + your own
// club + your standing at each. Two flat queries (pg-mem can't parse correlated subqueries — the /v1/gangs
// precedent). Ranked by prestige.
export async function speakeasyBoard(pool, characterId) {
  const clubs = (await pool.query(
    `SELECT s.district_id, s.owner_character, s.name, s.tier, s.prestige, s.shut_until, s.sale_price, s.decor_style, s.standover_cd_until, c.name AS owner_name
       FROM speakeasies s JOIN characters c ON c.id = s.owner_character`)).rows;
  const patrons = (await pool.query(
    `SELECT p.district_id, p.character_id, p.visits, p.spent_cash, p.spent_omr, c.name
       FROM speakeasy_patrons p JOIN characters c ON c.id = p.character_id AND c.alive`)).rows;
  const byClub = new Map();
  for (const p of patrons) {
    if (Number(p.visits) <= 0) continue; // a pure table-player (no rounds/bottles) isn't "seen" on the guest list
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
      salePrice: s.sale_price == null ? null : Math.floor(Number(s.sale_price)),
      decor: s.decor_style || null, decorName: s.decor_style ? decorStyleOf(s.decor_style) : null,
      assessedValue: assessedValueOf(s.tier), // the STANDOVER forced-sale price a rival would pay to take it
      standoverProtected: !!(s.standover_cd_until && new Date(s.standover_cd_until) > new Date()),
      shut: isShut(s), regulars: list.filter((x) => x.regular).length, guestList: list.slice(0, 8) };
  }).sort((a, b) => b.prestige - a.prestige);
  // the open districts (no club yet) — where a made man could plant a flag
  const open = DISTRICTS.filter((d) => !clubs.find((c) => c.district_id === d.id)).map((d) => d.id);
  // your cross-club RENOWN (derived from your patronage + your own club's prestige) — the nightlife legend
  let myCash = 0, myOmr = 0, myPrestige = 0;
  for (const p of patrons) if (p.character_id === characterId) { myCash += Number(p.spent_cash); myOmr += Number(p.spent_omr); }
  for (const s of clubs) if (s.owner_character === characterId) myPrestige += Number(s.prestige);
  const myRenown = renownScore(myCash, myOmr, myPrestige);
  return { clubs: map, open, rounds: SPEAKEASY.ROUNDS, bottles: SPEAKEASY.BOTTLES,
    table: { minBet: SPEAKEASY.TABLE.MIN_BET, maxBet: SPEAKEASY.TABLE.MAX_BET, rakeBps: SPEAKEASY.TABLE.RAKE_BPS },
    yourRenown: { renown: myRenown, rank: renownRankOf(myRenown).name },
    decorStyles: SPEAKEASY.DECOR_STYLES, styleUnlocks: SPEAKEASY.RENOWN.STYLE_UNLOCKS,
    saleMin: SPEAKEASY.SALE_MIN, saleMax: SPEAKEASY.SALE_MAX,
    standover: { fee: SPEAKEASY.STANDOVER.FEE }, // the forced-sale challenge (assessed price is per-club)
    openCost: SPEAKEASY.OPEN_COST, minLevel: SPEAKEASY.MIN_LEVEL };
}

// estate hook — a dead proprietor's club goes dark (+ its guest list); patron rows at other clubs also
// clear with the patron. Called from runEstate.
export async function wipeSpeakeasyAtDeath(client, characterId) {
  await client.query('DELETE FROM speakeasy_patrons WHERE character_id=$1', [characterId]);
  await client.query("DELETE FROM speakeasy_patrons WHERE district_id IN (SELECT district_id FROM speakeasies WHERE owner_character=$1)", [characterId]);
  await client.query('DELETE FROM speakeasies WHERE owner_character=$1', [characterId]);
}

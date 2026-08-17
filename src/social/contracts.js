// The contract board — bounties, family contracts, escrow, and the assassin ladder.
//
// One escrow pot per (target, kind). refundPot is the single place a pot is unwound, and it is
// called from three directions — a funder cancelling, the expiry sweep, and the estate — so it
// lives here with the pot rather than beside any one caller.
//
// Split out of the 2,003-line src/social.js; every function below is byte-identical to what was
// there. Import from '../social.js' — it re-exports this package's public surface unchanged.
import { GameError, bus, ledger, track, npcTier, bumpStanding, cleanText } from '../game.js';
import { M3, M8, LOAN, hitmanRankOf, VENDETTA, LAW } from '../rules.js';
import { spendOmr } from '../vanity.js';
import { fire, jump } from './combat.js';
import { canCommand, isWanted, now, takeHouse, uid } from './shared.js';

// ═══════════════════ BOUNTIES / THE CONTRACT BOARD (§5.2, M7 Phase 1) ═══════════════════
// Escrowed at post time (a §10.4 escrow bucket); paid to the fulfiller, NEVER a funder. 2%
// house take on top. One pot per (target, kind): a 'hospitalize' pot pays on a winning jump
// or a kill; a premium 'kill' pot pays ONLY on a completed hit. Contracts carry a reason +
// expiry; a funder can cancel their own share, and expired pots refund every funder.
const BKINDS = new Set(['hospitalize', 'kill']);

const bountyReason = (r) => (r ? cleanText(r).replace(/\s+/g, ' ').trim().slice(0, 140) || null : null); // strip HTML-injection chars (stored-XSS fix, R6)


export async function postBounty(ch, targetCharacterId, amount, client, h, opts = {}) {
  if (targetCharacterId === ch.id) throw new GameError('self', 'A price on your own head? See the Doc.');
  const kind = opts.kind || 'kill';
  if (!BKINDS.has(kind)) throw new GameError('kind', "A contract is 'hospitalize' or 'kill'.");
  const t = (await client.query('SELECT id, name, account_id, welsher, wanted_until FROM characters WHERE id=$1 AND alive', [targetCharacterId])).rows[0];
  if (!t) throw new GameError('no_target', 'Nobody by that name on the streets.');
  // a rat forfeits family protection (audit): fetched once, reused for the omertà void + the waiver
  const targetRat = !!(await client.query('SELECT rat FROM account_persistent WHERE account_id=$1', [t.account_id])).rows[0]?.rat;
  // Omertà: no open contracts on your own family (parity with searches/hits) — VOID for a rat OR a
  // WANTED welsher (a defaulter under pursuit is fair game even to their own family, step 4).
  const tg = (await client.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [targetCharacterId])).rows[0];
  if (tg?.gang_id && tg.gang_id === h.owned.gangId && !targetRat && !isWanted(t)) throw new GameError('family', "They're family. Omertà.");
  // THE CREW (step two) — no putting a contract on your own crew (the non-aggression pact extended to
  // the contract board; same rat/WANTED exception). Account-keyed, so read the target's crew by account.
  if (h.owned.crewId) {
    const tcrew = (await client.query('SELECT crew_id FROM crew_members WHERE account_id=$1', [t.account_id])).rows[0]?.crew_id;
    if (tcrew === h.owned.crewId && !targetRat && !isWanted(t)) throw new GameError('crew', "They run with your crew — no contracts on your own.");
  }
  const amt = Math.floor(Number(amount) || 0);
  if (amt < M3.BOUNTY_MIN) throw new GameError('min', `Minimum contract is $${M3.BOUNTY_MIN}.`);
  // VINNIE T2 (underworld): the Match waives HIS 1% posting fee for friends — the street
  // tax always stands. The discounted total is what's ledgered (decree/skill precedent).
  const fee = npcTier(h, 'fixer') >= 2 ? 0 : Math.ceil(amt * 0.01), tax = Math.ceil(amt * 0.01);
  if (Number(ch.cash) < amt + fee + tax) throw new GameError('cash', `That contract costs $${amt + fee + tax} with the take.`);
  const ttlH = Math.min(M3.BOUNTY_MAX_TTL_H, Math.max(1, Math.floor(Number(opts.hours) || M3.BOUNTY_DEFAULT_TTL_H)));
  // directed contract: name a hitman who gets an exclusive window before it opens to all. Only
  // set on a FRESH pot (a top-up inherits the original's direction — you fund the standing job).
  let hitmanId = null, opensAt = null;
  if (opts.hitman) {
    if (opts.hitman === targetCharacterId) throw new GameError('bad_hitman', "You can't name the mark as the hitman.");
    if (opts.hitman === ch.id) throw new GameError('bad_hitman', "Name someone else — you can't collect your own contract anyway.");
    const hm = (await client.query('SELECT id FROM characters WHERE id=$1 AND alive', [opts.hitman])).rows[0];
    if (!hm) throw new GameError('no_hitman', 'No such hitman on the streets.');
    // sim-audit F1 (squat resistance): exclusivity takes a real stake and a bounded window —
    // a $500 pot can't reserve a mark, and no window outlives DIRECTED_MAX_H. EXCEPTION: an
    // active VENDETTA against the target's bloodline waives the floor for KILL pots only —
    // vengeance posts at street rates (your money, your blood debt). Hospitalize pots never
    // get the waiver (audit F2: kill pots pay ANY killer inside the window so they can't be
    // squatted, but hospitalize pots stay exclusive — a manufactured vendetta + a $500
    // friendly hospitalize pot would re-open exactly the squat DIRECTED_MIN priced out).
    const vendetta = kind === 'kill' ? (await client.query(
      'SELECT 1 FROM vendettas WHERE avenger_account=$1 AND target_account=$2 AND expires_at > now()',
      [ch.account_id, t.account_id])).rows[0] : null;
    // THE LAW Phase 4: a RAT is fair game — the directed floor is waived on a KILL contract on an
    // informant, so the whole town can put a named gun on them cheaply (the vendetta-waiver twin).
    const ratWaiver = kind === 'kill' && targetRat;
    // LOAN step 2 (the welsher hunt): a defaulter's broken word makes them cheap to hunt — the
    // directed floor is waived on a KILL contract on a WELSHER (the rat-waiver twin; status
    // consequence, not a clawback — no money returns to any lender). Their family still shields
    // them from OPEN contracts (unlike a rat) — a welsher is a lesser offense than an informant.
    const welsherWaiver = kind === 'kill' && !!t.welsher;
    if (!vendetta && !ratWaiver && !welsherWaiver && amt < M3.DIRECTED_MIN) throw new GameError('directed_min', `Naming a hitman takes a serious stake — $${M3.DIRECTED_MIN} minimum.`);
    hitmanId = hm.id;
    const exH = Math.min(ttlH, M3.DIRECTED_MAX_H, Math.max(1, Math.floor(Number(opts.exclusiveHours) || 24)));
    opensAt = new Date(Date.now() + exH * 3600 * 1000);
  }
  ch.cash = Number(ch.cash) - amt - fee - tax;

  // Lock any existing pot for (target,kind) in ANY state (pot row BEFORE funder rows — the
  // stable order). A LIVE pot is topped up (keeping its first poster/reason/expiry — expiry
  // does NOT extend, so no grief-forever contracts). An EXPIRED-but-unswept pot is refunded to
  // its old funders and replaced by a fresh pot (matching "expired = gone"). None → a fresh pot.
  // (SELECT-then-write — pg-mem's ON CONFLICT is unreliable.)
  const existing = (await client.query('SELECT amount, expires_at FROM bounties WHERE target_character=$1 AND kind=$2 FOR UPDATE', [targetCharacterId, kind])).rows[0];
  const live = existing && !(existing.expires_at && new Date(existing.expires_at) <= new Date());
  // direction is set by the FIRST poster only — a top-up can't silently redirect (or fail to)
  if (hitmanId && live) throw new GameError('directed_exists', 'That mark already has a standing contract — only the first poster names the hitman.');
  if (existing && !live) { // clear the lapsed pot first, crediting the poster's own lapsed stake in-memory
    const { selfRefund } = await refundPot(client, targetCharacterId, kind, ch.id);
    ch.cash = Number(ch.cash) + selfRefund;
  }
  if (live) {
    await client.query('UPDATE bounties SET amount = amount + $3 WHERE target_character=$1 AND kind=$2', [targetCharacterId, kind, amt]);
  } else {
    // M8: keeping your name off the board costs $OMR — charged only when the flag takes effect
    // (a fresh pot; top-ups inherit the standing pot's anonymity and are never charged). An
    // insufficient balance throws here and rolls the whole post back, cash included.
    if (opts.anon) await spendOmr(client, h, M8.BOARD_ANON_OMR, 'intel:anon');
    const expiresAt = new Date(Date.now() + ttlH * 3600 * 1000);
    await client.query('INSERT INTO bounties (target_character, kind, amount, posted_by, anon, reason, hitman, opens_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [targetCharacterId, kind, amt, ch.id, !!opts.anon, bountyReason(opts.reason), hitmanId, opensAt, expiresAt]);
  }
  // track EVERY funder's share: none can collect (anti-self-pay), and a cancel/expiry refunds
  // each exactly what they put in.
  const mine = (await client.query('SELECT amount FROM bounty_contributors WHERE target_character=$1 AND kind=$2 AND contributor=$3', [targetCharacterId, kind, ch.id])).rows[0];
  if (mine) await client.query('UPDATE bounty_contributors SET amount = amount + $4 WHERE target_character=$1 AND kind=$2 AND contributor=$3', [targetCharacterId, kind, ch.id, amt]);
  else await client.query('INSERT INTO bounty_contributors (target_character, kind, contributor, amount) VALUES ($1,$2,$3,$4)', [targetCharacterId, kind, ch.id, amt]);

  // two ledger rows so §10.4 reconciles the escrow bucket vs the 2% house take separately
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -amt, reason: 'bounty:post', counterparty: targetCharacterId });
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -(fee + tax), reason: 'bounty:take', counterparty: targetCharacterId });
  await takeHouse(client, tax);
  await bumpStanding(client, h, ch, 'fixer', 3, { action: 'post' }); // posting work is doing business with the Match
  bus.emit('streets', { type: 'bounty', on: t.name, amount: amt, kind });
  await h.notify(client, targetCharacterId, 'bounty_on_you', { kind, amount: amt }); // the mark can react (lay low, etc.)
  if (hitmanId && !live) await h.notify(client, hitmanId, 'contract_offer', { target: t.name, kind, amount: amt }); // the named hitman is tapped
  return { ok: true, kind, total: (live ? Number(existing.amount) : 0) + amt, expiresHours: ttlH, hitman: hitmanId || undefined };
}

// Collect every claimable pot on the victim: `kinds` is what this takedown fulfils — a jump
// pays ['hospitalize']; a kill pays ['hospitalize','kill']. Skips a pot the collector funded
// (lock-out), a pot still inside another hitman's exclusive window, and an expired pot (left
// for the refund sweep). Returns { total, directed } — directed=true if a pot named to `ch`
// (a directed contract they were tapped for) was among those collected → bonus assassin rep.

// Collect every claimable pot on the victim: `kinds` is what this takedown fulfils — a jump
// pays ['hospitalize']; a kill pays ['hospitalize','kill']. Skips a pot the collector funded
// (lock-out), a pot still inside another hitman's exclusive window, and an expired pot (left
// for the refund sweep). Returns { total, directed } — directed=true if a pot named to `ch`
// (a directed contract they were tapped for) was among those collected → bonus assassin rep.
export async function claimBounty(client, h, ch, victimId, kinds) {
  const pots = (await client.query('SELECT kind, amount, hitman, opens_at FROM bounties WHERE target_character=$1 AND (expires_at IS NULL OR expires_at > now()) FOR UPDATE', [victimId])).rows;
  let total = 0, directed = false;
  for (const p of pots) {
    if (!kinds.includes(p.kind)) continue;
    // directed contract still in its exclusive window → only the named hitman may collect —
    // EXCEPT on a completed KILL: the mark is dead, and the pot pays whoever did the job (the
    // named hitman keeps the exclusive 1.5× rep bonus, not the corpse). Without this, a mark's
    // confederate could squat a cheap directed pot on a friendly alt and every enemy kill would
    // refund instead of pay (sim-audit F1). Hospitalize pots (non-terminal) stay exclusive.
    if (p.kind !== 'kill' && p.hitman && p.opens_at && new Date(p.opens_at) > new Date() && p.hitman !== ch.id) continue;
    // a funder never collects; the pot stands (dies with the target). A family-funded share
    // (contributor = gang id) locks out EVERY member of that family — the family ordered the
    // job, so doing it is your duty, not a payday (and the boss can't pay himself from the pot).
    const contributed = (await client.query('SELECT 1 FROM bounty_contributors WHERE target_character=$1 AND kind=$2 AND (contributor=$3 OR contributor=$4)',
      [victimId, p.kind, ch.id, h.owned.gangId || ch.id])).rows.length;
    if (contributed) continue;
    // SIGN-OFF 2.4: and anyone who was IN the funding family when its money went in, wherever their
    // membership stands now. The current-gang test above is still needed (it catches a member who
    // joined AFTER the funding), but on its own it was defeated by leaving before the kill.
    const wasFamily = (await client.query('SELECT 1 FROM bounty_gang_roster WHERE target_character=$1 AND kind=$2 AND character_id=$3',
      [victimId, p.kind, ch.id])).rows.length;
    if (wasFamily) continue;
    if (p.hitman === ch.id) directed = true; // fulfilled a contract they were named on
    await client.query('DELETE FROM bounties WHERE target_character=$1 AND kind=$2', [victimId, p.kind]);
    await client.query('DELETE FROM bounty_contributors WHERE target_character=$1 AND kind=$2', [victimId, p.kind]);
    await client.query('DELETE FROM bounty_gang_roster WHERE target_character=$1 AND kind=$2', [victimId, p.kind]);
    total += Math.floor(Number(p.amount));
  }
  if (total > 0) {
    ch.cash = Number(ch.cash) + total;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: total, reason: 'bounty:claim', counterparty: victimId });
  }
  return { total, directed };
}

// A funder withdraws their own share of a LIVE contract (the 2% take is non-refundable).

// A funder withdraws their own share of a LIVE contract (the 2% take is non-refundable).
export async function cancelBounty(ch, targetCharacterId, kind, client, h) {
  const k = kind || 'kill';
  if (!BKINDS.has(k)) throw new GameError('kind', "A contract is 'hospitalize' or 'kill'.");
  // lock the POT row first, then the contributor row — the SAME order claim/sweep use, so a
  // cancel can never deadlock against a concurrent kill/jump or the expiry sweep. Live pots
  // only: a lapsed pot refunds itself via the sweep.
  const pot = (await client.query('SELECT amount FROM bounties WHERE target_character=$1 AND kind=$2 AND (expires_at IS NULL OR expires_at > now()) FOR UPDATE', [targetCharacterId, k])).rows[0];
  if (!pot) throw new GameError('no_contract', 'No open contract of yours there (a lapsed one refunds itself).');
  const mine = (await client.query('SELECT amount FROM bounty_contributors WHERE target_character=$1 AND kind=$2 AND contributor=$3 FOR UPDATE', [targetCharacterId, k, ch.id])).rows[0];
  if (!mine || !(Number(mine.amount) > 0)) throw new GameError('no_contract', "You haven't funded that contract.");
  const refund = Math.floor(Number(mine.amount));
  await client.query('DELETE FROM bounty_contributors WHERE target_character=$1 AND kind=$2 AND contributor=$3', [targetCharacterId, k, ch.id]);
  const remaining = Number(pot.amount) - refund;
  if (remaining > 0) await client.query('UPDATE bounties SET amount=$3 WHERE target_character=$1 AND kind=$2', [targetCharacterId, k, remaining]);
  else await client.query('DELETE FROM bounties WHERE target_character=$1 AND kind=$2', [targetCharacterId, k]);
  ch.cash = Number(ch.cash) + refund;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: refund, reason: 'bounty:refund', counterparty: targetCharacterId });
  return { ok: true, refunded: refund, potRemaining: Math.max(0, remaining) };
}

// ═══════════════════ FAMILY CONTRACTS (M7 Phase 4) — the treasury orders the hit ═══════════════════
// The boss (or underboss) posts a contract funded from the GANG TREASURY — the first sanctioned
// player-directed outflow from the roach-motel treasury, tying the social layer to the kill layer.
// It rides the SAME (target, kind) pot as player bounties: the family's share is a
// bounty_contributors row with contributor = the GANG id + funder_gang, so the proven funder
// lockout extends to the whole family (no member collects the family's own money — the family
// ordered the job; doing it is your duty, not a payday) and a cancel/expiry refunds the treasury.
// §10.4: the escrow transfer is ledgered 'gang:contract' with NO character_id (treasury bucket →
// escrow bucket; character cash never moves), the 2% take as 'gang:contract:take'. Family
// contracts are always OPEN (no directed hitman) — the family taps no one, it taps everyone.

// ═══════════════════ FAMILY CONTRACTS (M7 Phase 4) — the treasury orders the hit ═══════════════════
// The boss (or underboss) posts a contract funded from the GANG TREASURY — the first sanctioned
// player-directed outflow from the roach-motel treasury, tying the social layer to the kill layer.
// It rides the SAME (target, kind) pot as player bounties: the family's share is a
// bounty_contributors row with contributor = the GANG id + funder_gang, so the proven funder
// lockout extends to the whole family (no member collects the family's own money — the family
// ordered the job; doing it is your duty, not a payday) and a cancel/expiry refunds the treasury.
// §10.4: the escrow transfer is ledgered 'gang:contract' with NO character_id (treasury bucket →
// escrow bucket; character cash never moves), the 2% take as 'gang:contract:take'. Family
// contracts are always OPEN (no directed hitman) — the family taps no one, it taps everyone.
export async function postFamilyContract(ch, targetCharacterId, amount, client, h, opts = {}) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss spends family money.');
  const gangId = h.owned.gangId;
  if (targetCharacterId === ch.id) throw new GameError('self', 'A price on your own head? See the Doc.');
  const kind = opts.kind || 'kill';
  if (!BKINDS.has(kind)) throw new GameError('kind', "A contract is 'hospitalize' or 'kill'.");
  const t = (await client.query('SELECT id, name FROM characters WHERE id=$1 AND alive', [targetCharacterId])).rows[0];
  if (!t) throw new GameError('no_target', 'Nobody by that name on the streets.');
  const tg = (await client.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [targetCharacterId])).rows[0];
  if (tg?.gang_id && tg.gang_id === gangId) throw new GameError('family', "They're family. Omertà.");
  const amt = Math.floor(Number(amount) || 0);
  if (amt < M3.BOUNTY_MIN) throw new GameError('min', `Minimum contract is $${M3.BOUNTY_MIN}.`);
  const fee = Math.ceil(amt * 0.01), tax = Math.ceil(amt * 0.01);
  const ttlH = Math.min(M3.BOUNTY_MAX_TTL_H, Math.max(1, Math.floor(Number(opts.hours) || M3.BOUNTY_DEFAULT_TTL_H)));
  // pot row locked FIRST, THEN the gang — the stable pot → gang order every other pot path uses
  // (cancelFamilyContract, the expiry sweep). Locking the gang first (as this did) inverts that
  // order and AB-BA deadlocks a repost against a concurrent cancel/sweep under real Postgres.
  // A live pot is topped up; an expired-unswept pot is refunded (skipId = the posting BOSS: if
  // they personally funded the old pot, their refund must land in-memory or persistCharacter
  // clobbers the SQL credit).
  const existing = (await client.query('SELECT amount, expires_at, anon FROM bounties WHERE target_character=$1 AND kind=$2 FOR UPDATE', [targetCharacterId, kind])).rows[0];
  const live = existing && !(existing.expires_at && new Date(existing.expires_at) <= new Date());
  if (existing && !live) {
    const { selfRefund } = await refundPot(client, targetCharacterId, kind, ch.id);
    ch.cash = Number(ch.cash) + selfRefund;
  }
  // a top-up inherits the standing pot's anonymity — the public emit below must respect the POT's
  // flag, not just this post's option, or topping up an anon pot would out the family
  const potAnon = live ? !!existing.anon : !!opts.anon;
  // gang row AFTER the pot (and after character/account rows) — the global lock order
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [gangId])).rows[0];
  if (Number(g.treasury) < amt + fee + tax) throw new GameError('treasury', `That contract takes $${amt + fee + tax} from the treasury (2% take included).`);
  await client.query('UPDATE gangs SET treasury = treasury - $2 WHERE id=$1', [gangId, amt + fee + tax]);
  if (live) {
    await client.query('UPDATE bounties SET amount = amount + $3 WHERE target_character=$1 AND kind=$2', [targetCharacterId, kind, amt]);
  } else {
    // M8: family anonymity costs the same as anyone's — the BOSS pays it personally (the
    // treasury holds cash, not $OMR; discretion is the officer's own expense).
    if (opts.anon) await spendOmr(client, h, M8.BOARD_ANON_OMR, 'intel:anon');
    const expiresAt = new Date(Date.now() + ttlH * 3600 * 1000);
    await client.query('INSERT INTO bounties (target_character, kind, amount, posted_by, anon, reason, posted_by_gang, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [targetCharacterId, kind, amt, ch.id, !!opts.anon, bountyReason(opts.reason), gangId, expiresAt]);
  }
  const mine = (await client.query('SELECT amount FROM bounty_contributors WHERE target_character=$1 AND kind=$2 AND contributor=$3', [targetCharacterId, kind, gangId])).rows[0];
  if (mine) await client.query('UPDATE bounty_contributors SET amount = amount + $4 WHERE target_character=$1 AND kind=$2 AND contributor=$3', [targetCharacterId, kind, gangId, amt]);
  else await client.query('INSERT INTO bounty_contributors (target_character, kind, contributor, amount, funder_gang) VALUES ($1,$2,$3,$4,true)', [targetCharacterId, kind, gangId, amt]);
  // SIGN-OFF 2.4 — snapshot WHO is in the family right now. The lockout in claimBounty used to test
  // the killer's CURRENT gang, so a made man could leave, kill for the family's own pot, pocket it
  // personally, and rejoin — treasury laundered into a wallet. Membership at FUNDING time is the
  // honest test: the family ordered the job while you were in it, so doing it is duty, not payday.
  // Re-snapshotted on every top-up (ON CONFLICT DO NOTHING) so anyone who joins before the next
  // tranche of family money is covered by that tranche.
  await client.query(
    `INSERT INTO bounty_gang_roster (target_character, kind, gang_id, character_id)
     SELECT $1, $2, $3, gm.character_id FROM gang_members gm WHERE gm.gang_id=$3
     ON CONFLICT DO NOTHING`, [targetCharacterId, kind, gangId]);

  await h.ledger(client, { currency: 'cash', amount: -amt, reason: 'gang:contract', counterparty: targetCharacterId });
  await h.ledger(client, { currency: 'cash', amount: -(fee + tax), reason: 'gang:contract:take', counterparty: targetCharacterId });
  await takeHouse(client, tax);
  await h.track(client, ch.account_id, 'family_contract', { target: targetCharacterId, kind, amount: amt });
  // an anon pot must not leak the family on the PUBLIC streets feed — the 3 $OMR bought silence
  // (the board already hides it; the private gang: channel emit below may still name it)
  bus.emit('streets', { type: 'bounty', on: t.name, amount: amt, kind, ...(potAnon ? {} : { family: g.name }) });
  bus.emit(`gang:${gangId}`, { type: 'family_contract', on: t.name, amount: amt, kind });
  await h.notify(client, targetCharacterId, 'bounty_on_you', { kind, amount: amt });
  // fresh read: an expired-repost may have refunded the old pot's gang share mid-flight
  const treasury = Number((await client.query('SELECT treasury FROM gangs WHERE id=$1', [gangId])).rows[0].treasury);
  if (h.owned.gang) h.owned.gang.treasury = treasury; // keep the view honest
  return { ok: true, kind, total: (live ? Number(existing.amount) : 0) + amt, expiresHours: ttlH, treasury };
}

// The boss calls the family's contract off — the family's share goes home to the treasury
// (the 2% take is spent). Pot row locked FIRST, same order as claim/sweep/cancel.

// The boss calls the family's contract off — the family's share goes home to the treasury
// (the 2% take is spent). Pot row locked FIRST, same order as claim/sweep/cancel.
export async function cancelFamilyContract(ch, targetCharacterId, kind, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss calls off family business.');
  const gangId = h.owned.gangId;
  const k = kind || 'kill';
  if (!BKINDS.has(k)) throw new GameError('kind', "A contract is 'hospitalize' or 'kill'.");
  const pot = (await client.query('SELECT amount FROM bounties WHERE target_character=$1 AND kind=$2 AND (expires_at IS NULL OR expires_at > now()) FOR UPDATE', [targetCharacterId, k])).rows[0];
  if (!pot) throw new GameError('no_contract', 'No open family contract there (a lapsed one refunds itself).');
  const mine = (await client.query('SELECT amount FROM bounty_contributors WHERE target_character=$1 AND kind=$2 AND contributor=$3 FOR UPDATE', [targetCharacterId, k, gangId])).rows[0];
  if (!mine || !(Number(mine.amount) > 0)) throw new GameError('no_contract', "The family hasn't funded that contract.");
  const refund = Math.floor(Number(mine.amount));
  await client.query('DELETE FROM bounty_contributors WHERE target_character=$1 AND kind=$2 AND contributor=$3', [targetCharacterId, k, gangId]);
      await client.query('DELETE FROM bounty_gang_roster WHERE target_character=$1 AND kind=$2 AND gang_id=$3', [targetCharacterId, k, gangId]);
  const remaining = Number(pot.amount) - refund;
  if (remaining > 0) await client.query('UPDATE bounties SET amount=$3 WHERE target_character=$1 AND kind=$2', [targetCharacterId, k, remaining]);
  else await client.query('DELETE FROM bounties WHERE target_character=$1 AND kind=$2', [targetCharacterId, k]);
  await client.query('UPDATE gangs SET treasury = treasury + $2 WHERE id=$1', [gangId, refund]);
  await h.ledger(client, { currency: 'cash', amount: refund, reason: 'bounty:refund', counterparty: targetCharacterId });
  if (h.owned.gang) h.owned.gang.treasury = Number(h.owned.gang.treasury) + refund; // keep the view honest
  return { ok: true, refunded: refund, potRemaining: Math.max(0, remaining) };
}

// The public board — open (non-expired) contracts, richest first. A directed contract inside
// its exclusive window shows the named hitman + when it opens to everyone.

// The public board — open (non-expired) contracts, richest first. A directed contract inside
// its exclusive window shows the named hitman + when it opens to everyone.
export async function listContracts(pool) {
  const rows = (await pool.query(
    `SELECT b.target_character, b.kind, b.amount, b.anon, b.reason, b.expires_at, b.opens_at,
            t.name AS target_name, p.name AS poster_name, hm.name AS hitman_name, fg.name AS family_name
       FROM bounties b
       JOIN characters t ON t.id = b.target_character
       LEFT JOIN characters p ON p.id = b.posted_by
       LEFT JOIN characters hm ON hm.id = b.hitman
       LEFT JOIN gangs fg ON fg.id = b.posted_by_gang
      WHERE b.expires_at IS NULL OR b.expires_at > now()
      ORDER BY b.amount DESC LIMIT 100`)).rows;
  const secsTo = (t) => (t ? Math.max(0, Math.ceil((new Date(t) - Date.now()) / 1000)) : null);
  return rows.map((r) => {
    const exclusive = r.hitman_name && r.opens_at && new Date(r.opens_at) > new Date();
    return {
      target: { id: r.target_character, name: r.target_name },
      kind: r.kind, pot: Math.floor(Number(r.amount)), reason: r.reason || null,
      // a family contract shows the FAMILY on the board (unless anon) — the message is the point
      poster: r.anon ? null : (r.family_name || r.poster_name || null),
      family: r.anon ? false : !!r.family_name,
      directedTo: exclusive ? r.hitman_name : null, // only while the exclusive window is open
      opensInSeconds: exclusive ? secsTo(r.opens_at) : null,
      expiresInSeconds: secsTo(r.expires_at),
    };
  });
}

// M8 — COUNTER-INTELLIGENCE: "who wants me dead?" The mark pays $OMR to read every funder on
// every open pot on their own head — names, shares, reasons, the named hitman — INCLUDING
// anonymous posters. Anonymity is purchasable (the anon fee), and so is piercing it: the two
// sinks feed each other, and neither moves a dollar of the escrow itself. Free when there is
// nothing to learn — the ear to the ground only charges when it hears something.

// M8 — COUNTER-INTELLIGENCE: "who wants me dead?" The mark pays $OMR to read every funder on
// every open pot on their own head — names, shares, reasons, the named hitman — INCLUDING
// anonymous posters. Anonymity is purchasable (the anon fee), and so is piercing it: the two
// sinks feed each other, and neither moves a dollar of the escrow itself. Free when there is
// nothing to learn — the ear to the ground only charges when it hears something.
export async function peekContracts(ch, client, h) {
  const pots = (await client.query(
    `SELECT b.kind, b.amount, b.reason, b.expires_at, hm.name AS hitman_name
       FROM bounties b LEFT JOIN characters hm ON hm.id = b.hitman
      WHERE b.target_character=$1 AND (b.expires_at IS NULL OR b.expires_at > now())`, [ch.id])).rows;
  if (!pots.length) throw new GameError('no_contracts', 'Your ear to the ground hears nothing. Nobody has paper on you — today.');
  await spendOmr(client, h, M8.INTEL_PEEK_OMR, 'intel:peek');
  const funders = (await client.query(
    `SELECT bc.kind, bc.amount, bc.funder_gang, c.name AS char_name, g.name AS gang_name
       FROM bounty_contributors bc
       LEFT JOIN characters c ON c.id = bc.contributor
       LEFT JOIN gangs g ON g.id = bc.contributor
      WHERE bc.target_character=$1`, [ch.id])).rows;
  await h.track(client, ch.account_id, 'intel_peek', { pots: pots.length });
  return { ok: true, contracts: pots.map((p) => ({
    kind: p.kind, pot: Math.floor(Number(p.amount)), reason: p.reason || null,
    hitman: p.hitman_name || null,
    expiresInSeconds: p.expires_at ? Math.max(0, Math.ceil((new Date(p.expires_at) - Date.now()) / 1000)) : null,
    funders: funders.filter((f) => f.kind === p.kind).map((f) => ({
      name: f.funder_gang ? `${f.gang_name} (family)` : (f.char_name || 'a dead man'),
      amount: Math.floor(Number(f.amount)),
    })),
  })) };
}

// Refund one pot to its funders and delete it — shared by the expiry sweep and a repost that
// lands on an expired-unswept pot. A LIVING funder is credited (ledgered bounty:refund); a
// DEAD funder's stake is BURNED (death:bounty) rather than paid to their corpse — death
// forfeits escrowed stakes like the rest of a dead street's wealth. The caller must already
// hold the pot row lock; everyone locks the pot BEFORE funder rows (stable order).
// `skipId` is the LIVE poster's character id (postBounty): their own refund must NOT be written
// via SQL — the surrounding withCharacter txn persists the in-memory `ch` at commit and would
// clobber it — so it's returned as `selfRefund` for the caller to apply to `ch.cash`. The sweep
// passes no skipId. Returns { refunded (total leaving escrow), selfRefund }.

// Refund one pot to its funders and delete it — shared by the expiry sweep and a repost that
// lands on an expired-unswept pot. A LIVING funder is credited (ledgered bounty:refund); a
// DEAD funder's stake is BURNED (death:bounty) rather than paid to their corpse — death
// forfeits escrowed stakes like the rest of a dead street's wealth. The caller must already
// hold the pot row lock; everyone locks the pot BEFORE funder rows (stable order).
// `skipId` is the LIVE poster's character id (postBounty): their own refund must NOT be written
// via SQL — the surrounding withCharacter txn persists the in-memory `ch` at commit and would
// clobber it — so it's returned as `selfRefund` for the caller to apply to `ch.cash`. The sweep
// passes no skipId. Returns { refunded (total leaving escrow), selfRefund }.
export async function refundPot(client, target, kind, skipId = null) {
  // LEFT JOIN: a family-funded share (contributor = gang id, funder_gang) has no characters row —
  // an inner join would silently drop it from the refund and leak the escrow.
  // ORDER BY contributor (AUDIT-full-system-v2 B-M1): a stable sort makes every refundPot acquire
  // funder locks in the same order — no two reposts (or a repost vs the worker sweep) can AB-BA on an
  // overlapping funder set. R22 lock-order: but the raw contributor sort interleaved the 'HOUSE'
  // street_tax credit (a SINGLETON) and the gang treasuries among the character funders by uid order,
  // locking a singleton/gang BEFORE a character funder whose uid sorts after them — violating the
  // global characters → gangs → singletons order and AB-BA'ing vs any takeHouse (holds a char, wants
  // street_tax) or runBuyback (holds a gang, wants street_tax). So process funders in TIER order:
  // characters first, then gangs, then the single deferred 'HOUSE' street_tax write LAST. Each tier
  // still iterates contributor-sorted (the B-M1 cross-repost consistency is preserved within tier).
  const funders = (await client.query(
    'SELECT bc.contributor, bc.amount, bc.funder_gang, c.alive FROM bounty_contributors bc LEFT JOIN characters c ON c.id = bc.contributor WHERE bc.target_character=$1 AND bc.kind=$2 ORDER BY bc.contributor',
    [target, kind])).rows;
  let refunded = 0, selfRefund = 0, houseAmt = 0;
  const charFunders = funders.filter((f) => !f.funder_gang && f.contributor !== 'HOUSE');
  const gangFunders = funders.filter((f) => f.funder_gang);
  const houseFunders = funders.filter((f) => !f.funder_gang && f.contributor === 'HOUSE');
  // TIER 1 — character funders (living refund / self-refund carried in memory / dead-man burn)
  for (const f of charFunders) {
    const amt = Math.floor(Number(f.amount));
    if (amt <= 0) continue;
    if (f.contributor === skipId) {
      selfRefund += amt; // caller applies to the poster's in-memory cash
      await ledger(client, { characterId: f.contributor, currency: 'cash', amount: amt, reason: 'bounty:refund', counterparty: target });
    } else if (f.alive) {
      await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [f.contributor, amt]);
      await ledger(client, { characterId: f.contributor, currency: 'cash', amount: amt, reason: 'bounty:refund', counterparty: target });
    } else {
      await ledger(client, { currency: 'cash', amount: -amt, reason: 'death:bounty', counterparty: target }); // burn the dead man's stake
    }
    refunded += amt;
  }
  // TIER 2 — gang funders: a family's stake goes home to the treasury (a §10.4 bucket transfer,
  // character_id NULL so character-cash reconciliation is untouched); a DISSOLVED family's stake burns
  // like a dead funder's — there is no treasury left to take it home.
  for (const f of gangFunders) {
    const amt = Math.floor(Number(f.amount));
    if (amt <= 0) continue;
    const g = (await client.query('SELECT id FROM gangs WHERE id=$1', [f.contributor])).rows[0];
    if (g) {
      await client.query('UPDATE gangs SET treasury = treasury + $2 WHERE id=$1', [f.contributor, amt]);
      await ledger(client, { currency: 'cash', amount: amt, reason: 'bounty:refund', counterparty: target });
    } else {
      await ledger(client, { currency: 'cash', amount: -amt, reason: 'death:bounty', counterparty: target });
    }
    refunded += amt;
  }
  // TIER 3 (singleton, LAST) — LOAN step 4: the underworld's WANTED_BOUNTY goes home to the
  // confiscation POOL on expiry (a §10.4 bucket transfer, character_id NULL). A DISTINCT reason
  // (`bounty:wanted:refund`) — a plain `bounty:refund` NULL row is indistinguishable from a
  // family-contract refund and would drift the gang-treasuries check (b), which sums NULL
  // bounty:refund as treasury inflow (audit HIGH). One deferred street_tax write keeps the singleton
  // strictly the last lock acquired.
  for (const f of houseFunders) {
    const amt = Math.floor(Number(f.amount));
    if (amt <= 0) continue;
    houseAmt += amt;
    refunded += amt;
    await ledger(client, { currency: 'cash', amount: amt, reason: 'bounty:wanted:refund', counterparty: target });
  }
  if (houseAmt > 0) await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [houseAmt]);
  await client.query('DELETE FROM bounty_contributors WHERE target_character=$1 AND kind=$2', [target, kind]);
  await client.query('DELETE FROM bounties WHERE target_character=$1 AND kind=$2', [target, kind]);
  return { refunded, selfRefund };
}

// Worker sweep: refund every funder of an expired pot, then drop the pot. ONE POT PER TRANSACTION,
// funder character rows locked in sorted order BEFORE the pot row — the global lock order every
// player path follows (characters → pots → gangs). The old version locked all expired pots first
// and then wrote funder character rows (pots → characters), AB-BA deadlocking against a fire-kill
// or cancel that holds character locks and wants the same pot (invisible on pg-mem). If the funder
// set changes between the unlocked read and the pot lock (a racing top-up), retry once; a pot that
// won't settle keeps to the next sweep. Idempotent-safe: a pot is deleted in the txn it's refunded.

// Worker sweep: refund every funder of an expired pot, then drop the pot. ONE POT PER TRANSACTION,
// funder character rows locked in sorted order BEFORE the pot row — the global lock order every
// player path follows (characters → pots → gangs). The old version locked all expired pots first
// and then wrote funder character rows (pots → characters), AB-BA deadlocking against a fire-kill
// or cancel that holds character locks and wants the same pot (invisible on pg-mem). If the funder
// set changes between the unlocked read and the pot lock (a racing top-up), retry once; a pot that
// won't settle keeps to the next sweep. Idempotent-safe: a pot is deleted in the txn it's refunded.
export async function sweepExpiredBounties(pool) {
  const client = await pool.connect();
  let pots = 0, refunded = 0;
  try {
    const expired = (await client.query(
      'SELECT target_character, kind FROM bounties WHERE expires_at IS NOT NULL AND expires_at <= now()')).rows;
    for (const b of expired) {
      for (let attempt = 0; attempt < 2; attempt++) {
        await client.query('BEGIN');
        try {
          // NOT funder_gang — the column is NOT NULL, so the old `IS NULL` matched nothing and
          // silently pre-locked zero funders (audit: the pots→characters inversion was still live)
          const readFunders = async () => (await client.query(
            'SELECT contributor FROM bounty_contributors WHERE target_character=$1 AND kind=$2 AND NOT funder_gang',
            [b.target_character, b.kind])).rows.map((r) => r.contributor).sort();
          const funderIds = await readFunders();
          for (const id of funderIds)
            await client.query('SELECT 1 FROM characters WHERE id=$1 FOR UPDATE', [id]);
          // now the pot — and re-verify it's still there and still expired (a claim/cancel may
          // have raced us before we held any locks; then there's nothing left to refund)
          const pot = (await client.query(
            'SELECT 1 FROM bounties WHERE target_character=$1 AND kind=$2 AND expires_at IS NOT NULL AND expires_at <= now() FOR UPDATE',
            [b.target_character, b.kind])).rows[0];
          if (!pot) { await client.query('COMMIT'); break; }
          const now2 = await readFunders();
          if (JSON.stringify(now2) !== JSON.stringify(funderIds)) { await client.query('ROLLBACK'); continue; }
          refunded += (await refundPot(client, b.target_character, b.kind)).refunded;
          pots++;
          await client.query('COMMIT');
          break;
        // isolate per pot (audit L2): one genuinely-erroring expired pot must not abort the whole
        // batch and leave every OTHER expired pot unrefunded (a poison pot would block them forever)
        } catch (e) { await client.query('ROLLBACK'); console.error('bounty sweep: pot failed', b.target_character, b.kind, e?.code || e); break; }
      }
    }
    return { pots, refunded };
  } finally { client.release(); }
}

// ═══════════════════ THE ASSASSIN'S REPUTATION (M7 Phase 2) ═══════════════════
// A confirmed gameplay kill grows the killer's LEGEND (account-level lifetime kills + feared-rep,
// surviving death like prestige) and this STREET's season kill streak. Rep is a STATUS axis only
// (no gameplay power → no §10.4 / balance impact). Anti-abuse — a kill only COUNTS (kills,
// season_kills, AND rep) when the target is a real one (≥ MIN level): killing rookies/alts earns
// nothing on any board. Rep additionally: diminished 1/(prior REP-earning kills of that bloodline)
// to blunt bloodline farming, excluded for agents (they still tally kills, just not the feared
// board — like referral payouts), and ×HITMAN_DIRECTED_BONUS on a directed hit.

// ═══════════════════ THE ASSASSIN'S REPUTATION (M7 Phase 2) ═══════════════════
// A confirmed gameplay kill grows the killer's LEGEND (account-level lifetime kills + feared-rep,
// surviving death like prestige) and this STREET's season kill streak. Rep is a STATUS axis only
// (no gameplay power → no §10.4 / balance impact). Anti-abuse — a kill only COUNTS (kills,
// season_kills, AND rep) when the target is a real one (≥ MIN level): killing rookies/alts earns
// nothing on any board. Rep additionally: diminished 1/(prior REP-earning kills of that bloodline)
// to blunt bloodline farming, excluded for agents (they still tally kills, just not the feared
// board — like referral payouts), and ×HITMAN_DIRECTED_BONUS on a directed hit.
export async function awardHitmanRep(client, h, ch, victim, vicLvl, directed, vendetta = false) {
  const qualifies = vicLvl >= M3.HITMAN_MIN_TARGET_LVL; // a real target, not rookie/alt farming
  let repGain = 0;
  if (qualifies) {
    h.acct.kills = Number(h.acct.kills || 0) + 1;
    ch.season_kills = Number(ch.season_kills || 0) + 1;
    if (!h.acct.agent_flag) {
      const prior = Number((await client.query(
        'SELECT COUNT(*) n FROM kill_log WHERE killer_account=$1 AND victim_account=$2 AND rep > 0', [ch.account_id, victim.account_id])).rows[0].n);
      // a settled VENDETTA pays 2x, a directed contract 1.5x — the LARGER applies, never a stack.
      // The bloodline diminishing below still divides it, which is the vendetta anti-farm: a
      // first revenge (1 prior against you) nets exactly full base rep; kill-trading decays.
      const mult = Math.max(directed ? M3.HITMAN_DIRECTED_BONUS : 1, vendetta ? VENDETTA.REP_BONUS : 1);
      repGain = Math.max(1, Math.floor(vicLvl * M3.HITMAN_REP_PER_LVL * mult / (prior + 1)));
      const before = Number(h.acct.hitman_rep || 0);
      h.acct.hitman_rep = before + repGain;
      if (hitmanRankOf(before + repGain).title !== hitmanRankOf(before).title)
        await h.notify(client, ch.id, 'hitman_rank', { title: hitmanRankOf(before + repGain).title, rep: before + repGain });
    }
  }
  // every kill is logged for the feed; rep>0 marks the ones that count for bloodline diminishing
  await client.query('INSERT INTO kill_log (id, killer_account, victim_account, victim_name, rep) VALUES ($1,$2,$3,$4,$5)',
    [uid(), ch.account_id, victim.account_id, victim.name, repGain]);
  // (cohesion step two) the BLOOD between the two bloodlines, counted AFTER this kill is logged, so
  // the killer's toast can say "the third body between your lines" — the narrative beat at the
  // moment the history is made. Both directions, no rep filter: a body is a body.
  const bloodOurs = Number((await client.query(
    'SELECT COUNT(*) n FROM kill_log WHERE killer_account=$1 AND victim_account=$2', [ch.account_id, victim.account_id])).rows[0].n);
  const bloodTheirs = Number((await client.query(
    'SELECT COUNT(*) n FROM kill_log WHERE killer_account=$1 AND victim_account=$2', [victim.account_id, ch.account_id])).rows[0].n);
  return { repGain, qualified: qualifies, kills: Number(h.acct.kills || 0), title: hitmanRankOf(h.acct.hitman_rep).title,
    blood: { ours: bloodOurs, theirs: bloodTheirs } };
}

// The feared-assassin leaderboard: the lifetime LEGEND (accounts by hitman_rep, with rank/title)
// and the SEASON board (living streets by this season's kill streak).

// The feared-assassin leaderboard: the lifetime LEGEND (accounts by hitman_rep, with rank/title)
// and the SEASON board (living streets by this season's kill streak).
export async function hitmanLeaderboard(pool, limit = 20) {
  const legend = (await pool.query(
    `SELECT a.hitman_rep, a.kills, a.agent_flag, c.name FROM account_persistent a
       JOIN characters c ON c.account_id = a.account_id AND c.alive
      WHERE a.hitman_rep > 0 AND NOT c.is_npc ORDER BY a.hitman_rep DESC LIMIT $1`, [limit])).rows;
  const season = (await pool.query(
    `SELECT c.name, c.season_kills, a.agent_flag FROM characters c
       JOIN account_persistent a ON a.account_id = c.account_id
      WHERE c.alive AND c.season_kills > 0 AND NOT a.agent_flag AND NOT c.is_npc
      ORDER BY c.season_kills DESC LIMIT $1`, [limit])).rows;
  return {
    legend: legend.map((r) => ({ name: r.name, rep: Number(r.hitman_rep), kills: Number(r.kills),
      title: hitmanRankOf(Number(r.hitman_rep)).title, agent: !!r.agent_flag })),
    season: season.map((r) => ({ name: r.name, kills: Number(r.season_kills), agent: !!r.agent_flag })),
  };
}

// ═══════════════════ HIT CONTRACTS (§7.7) ═══════════════════

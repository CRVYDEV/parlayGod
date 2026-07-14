// M3 social systems — gangs, wars, turf, jumps, bounties, hit contracts, death,
// busting, plus the escrowed Exchange (§5.4, deferred from M2 pending notifications).
// Every formula cites spec §7 / prototype v24. Two-party actions run under
// withTwoCharacters (game.js) which locks both rows in stable order (§10.1).
import crypto from 'node:crypto';
import { GameError, bumpFamilyTask, bus, ledger } from './game.js';
import {
  DISTRICTS, CONSUMABLES, M3,
  levelOf, rankIdxOf, cityEventOf, dayOf, btkOf,
  gunObjOf, vestMultOf, fleetValue, effStat,
} from './rules.js';

const uid = () => crypto.randomUUID();
const now = () => new Date();
const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const hospitalized = (ch) => ch.hosp_until && new Date(ch.hosp_until) > new Date();
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

async function takeHouse(client, tax) {
  if (tax > 0) await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [tax]);
}

// ═══════════════════ GANGS (§5.5) ═══════════════════
export async function createGang(ch, name, tag, client, h) {
  if (h.owned.gangId) throw new GameError('in_gang', 'You already have a family.');
  if (levelOf(Number(ch.respect)) < M3.GANG_FOUND_LEVEL) throw new GameError('level', `Level ${M3.GANG_FOUND_LEVEL} to found a family.`);
  name = String(name || '').trim(); tag = String(tag || '').trim().toUpperCase();
  if (name.length < 3 || name.length > 24) throw new GameError('name', 'Family name must be 3–24 characters.');
  if (!/^[A-Z0-9]{2,4}$/.test(tag)) throw new GameError('tag', 'Tag must be 2–4 letters or numbers.');
  if (Number(ch.cash) < M3.GANG_FOUND_COST) throw new GameError('cash', `Founding a family costs $${M3.GANG_FOUND_COST}.`);
  const clash = await client.query('SELECT id FROM gangs WHERE name=$1 OR tag=$2', [name, tag]);
  if (clash.rows.length) throw new GameError('taken', 'That name or tag is already claimed.');
  ch.cash = Number(ch.cash) - M3.GANG_FOUND_COST;
  const id = uid();
  await client.query('INSERT INTO gangs (id, name, tag) VALUES ($1,$2,$3)', [id, name, tag]);
  await client.query('INSERT INTO gang_members (gang_id, character_id, role) VALUES ($1,$2,$3)', [id, ch.id, 'boss']);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -M3.GANG_FOUND_COST, reason: 'gang:found' });
  h.owned.gangId = id; h.owned.gangRole = 'boss';
  h.owned.gang = { id, name, tag, treasury: 0, ammo_bank: 0 };
  return { ok: true, gangId: id };
}

export async function joinGang(ch, gangId, client, h) {
  if (h.owned.gangId) throw new GameError('in_gang', 'Leave your current family first.');
  // lock the gang row FOR UPDATE so concurrent joiners serialize — otherwise a
  // check-then-insert race lets N accounts blow past GANG_MAX_MEMBERS at once
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [gangId])).rows[0];
  if (!g) throw new GameError('no_gang', 'That family no longer exists.');
  const n = Number((await client.query('SELECT COUNT(*) n FROM gang_members WHERE gang_id=$1', [gangId])).rows[0].n);
  if (n >= M3.GANG_MAX_MEMBERS) throw new GameError('full', `That family is full (${M3.GANG_MAX_MEMBERS} made members max).`);
  await client.query('INSERT INTO gang_members (gang_id, character_id, role) VALUES ($1,$2,$3)', [gangId, ch.id, 'soldier']);
  h.owned.gangId = gangId; h.owned.gangRole = 'soldier'; h.owned.gang = g;
  return { ok: true, gangId, name: g.name };
}

// Boss succession on departure: the underboss inherits, then seniority (v24 rule).
// An emptied family dissolves — turf released, wars cleared.
export async function removeMember(client, gangId, characterId) {
  await client.query('DELETE FROM gang_members WHERE gang_id=$1 AND character_id=$2', [gangId, characterId]);
  const left = (await client.query(
    "SELECT character_id, role FROM gang_members WHERE gang_id=$1 ORDER BY CASE role WHEN 'underboss' THEN 0 WHEN 'capo' THEN 1 ELSE 2 END, character_id", [gangId])).rows;
  if (!left.length) {
    // the family dies with its last member — remaining buckets burn, ledgered
    // so the §10.4 job can reconcile treasuries/reserves/armory exactly
    const g = (await client.query('SELECT * FROM gangs WHERE id=$1', [gangId])).rows[0];
    if (g) {
      if (Number(g.treasury) > 0) await ledger(client, { currency: 'cash', amount: -Number(g.treasury), reason: 'gang:dissolved', counterparty: gangId });
      if (Number(g.omr_reserve) > 0) await ledger(client, { currency: 'omr', amount: -Number(g.omr_reserve), reason: 'gang:dissolved', counterparty: gangId });
      if (Number(g.ammo_bank) > 0) await ledger(client, { currency: 'ammo', amount: -Number(g.ammo_bank), reason: 'gang:dissolved', counterparty: gangId });
    }
    await client.query('UPDATE districts SET holder_gang=NULL, garrison=0 WHERE holder_gang=$1', [gangId]);
    await client.query('UPDATE gangs SET war_with=NULL, war_until=NULL WHERE war_with=$1', [gangId]);
    await client.query('DELETE FROM gangs WHERE id=$1', [gangId]);
    return { dissolved: true };
  }
  const hasBoss = left.some((m) => m.role === 'boss');
  if (!hasBoss)
    await client.query('UPDATE gang_members SET role=$3 WHERE gang_id=$1 AND character_id=$2', [gangId, left[0].character_id, 'boss']);
  return { dissolved: false, newBoss: hasBoss ? null : left[0].character_id };
}

export async function leaveGang(ch, client, h) {
  if (!h.owned.gangId) throw new GameError('no_gang', "You're not in a family.");
  const r = await removeMember(client, h.owned.gangId, ch.id);
  h.owned.gangId = null; h.owned.gangRole = null; h.owned.gang = null; h.owned.held = [];
  return { ok: true, ...r };
}

const canCommand = (h) => h.owned.gangRole === 'boss' || h.owned.gangRole === 'underboss';

export async function kickMember(ch, targetCharacterId, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss kicks members.');
  if (targetCharacterId === ch.id) throw new GameError('self', 'Use leave for that.');
  const m = (await client.query('SELECT role FROM gang_members WHERE gang_id=$1 AND character_id=$2', [h.owned.gangId, targetCharacterId])).rows[0];
  if (!m) throw new GameError('no_member', 'Not one of yours.');
  if (m.role === 'boss') throw new GameError('rank', 'Nobody kicks the boss.');
  await removeMember(client, h.owned.gangId, targetCharacterId);
  return { ok: true };
}

export async function promoteMember(ch, targetCharacterId, role, client, h) {
  if (h.owned.gangRole !== 'boss') throw new GameError('rank', 'Only the boss hands out buttons.');
  if (!['underboss', 'capo', 'soldier'].includes(role)) throw new GameError('bad_role', 'Roles: underboss, capo, soldier.');
  if (targetCharacterId === ch.id) throw new GameError('self', 'The boss stays the boss.');
  const m = (await client.query('SELECT role FROM gang_members WHERE gang_id=$1 AND character_id=$2', [h.owned.gangId, targetCharacterId])).rows[0];
  if (!m) throw new GameError('no_member', 'Not one of yours.');
  if (role === 'underboss') {
    const existing = (await client.query("SELECT character_id FROM gang_members WHERE gang_id=$1 AND role='underboss'", [h.owned.gangId])).rows[0];
    if (existing && existing.character_id !== targetCharacterId) throw new GameError('underboss', 'A family has exactly one underboss.');
  }
  await client.query('UPDATE gang_members SET role=$3 WHERE gang_id=$1 AND character_id=$2', [h.owned.gangId, targetCharacterId, role]);
  return { ok: true, role };
}

export async function tribute(ch, amount, client, h) {
  if (!h.owned.gangId) throw new GameError('no_gang', "You're not in a family.");
  const amt = Math.floor(Number(amount) || 0);
  if (amt < M3.TRIBUTE_MIN) throw new GameError('min', `Minimum tribute is $${M3.TRIBUTE_MIN}.`);
  if (Number(ch.cash) < amt) throw new GameError('cash', 'Not that much in pocket.');
  await resolveWarIfDue(client, h.owned.gangId);
  ch.cash = Number(ch.cash) - amt;
  // treasury is a §10.4 cash bucket, not a sink — the ledger row keeps Σ balanced
  await client.query('UPDATE gangs SET treasury = treasury + $2, lifetime_tribute = lifetime_tribute + $2 WHERE id=$1', [h.owned.gangId, amt]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -amt, reason: 'gang:tribute', counterparty: h.owned.gangId });
  await h.bumpDaily(client, ch.id, 'tribute');
  await bumpFamilyTask(client, h, 'tribute', amt);
  bus.emit(`gang:${h.owned.gangId}`, { type: 'tribute', amount: amt });
  return { ok: true, amount: amt };
}

// ═══════════════════ WARS (§5.5) ═══════════════════
const warActive = (g) => g && g.war_with && new Date(g.war_until) > new Date();

// Lazy war resolution: first touch after war_until settles it — winner takes 20%
// of the loser's treasury and a standing bump (wars_won). Locks both gang rows in
// stable id order (same discipline as character locks, §10.1).
export async function resolveWarIfDue(client, gangId) {
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1', [gangId])).rows[0];
  if (!g || !g.war_with || new Date(g.war_until) > new Date()) return null;
  const [id1, id2] = [g.id, g.war_with].sort();
  const g1 = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [id1])).rows[0];
  const g2 = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [id2])).rows[0];
  const us = g1?.id === gangId ? g1 : g2, them = g1?.id === gangId ? g2 : g1;
  if (!us || !us.war_with || new Date(us.war_until) > new Date()) return null; // re-check under lock
  const ourScore = Number(us.war_score_us), theirScore = Number(us.war_score_them);
  let spoils = 0, winner = null;
  if (ourScore !== theirScore && them) {
    const w = ourScore > theirScore ? us : them;
    const l = w === us ? them : us;
    spoils = Math.floor(Number(l.treasury) * M3.WAR_SPOILS);
    winner = w.id;
    await client.query('UPDATE gangs SET treasury = treasury - $2 WHERE id=$1', [l.id, spoils]);
    await client.query('UPDATE gangs SET treasury = treasury + $2, wars_won = wars_won + 1 WHERE id=$1', [w.id, spoils]);
  }
  await client.query('UPDATE gangs SET war_with=NULL, war_until=NULL, war_score_us=0, war_score_them=0 WHERE id=$1 OR id=$2', [us.id, them?.id || us.id]);
  bus.emit(`gang:${us.id}`, { type: 'war_over', winner, spoils });
  if (them) bus.emit(`gang:${them.id}`, { type: 'war_over', winner, spoils });
  return { winner, spoils };
}

export async function declareWar(ch, targetGangId, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss declares war.');
  if (targetGangId === h.owned.gangId) throw new GameError('self', 'A family war with yourself is called Tuesday.');
  await resolveWarIfDue(client, h.owned.gangId);
  await resolveWarIfDue(client, targetGangId);
  const [id1, id2] = [h.owned.gangId, targetGangId].sort();
  const g1 = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [id1])).rows[0];
  const g2 = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [id2])).rows[0];
  const us = g1?.id === h.owned.gangId ? g1 : g2, them = g1?.id === h.owned.gangId ? g2 : g1;
  if (!them) throw new GameError('no_gang', 'That family no longer exists.');
  if (warActive(us) || warActive(them)) throw new GameError('at_war', 'One of you is already at war.');
  if (Number(us.treasury) < M3.WAR_COST) throw new GameError('treasury', `War takes a $${M3.WAR_COST} war chest in the treasury.`);
  const until = new Date(Date.now() + M3.WAR_MS);
  // the war chest burns — a §10.4 cash sink out of the treasury bucket
  await client.query('UPDATE gangs SET treasury = treasury - $2, war_with=$3, war_until=$4, war_score_us=0, war_score_them=0 WHERE id=$1',
    [us.id, M3.WAR_COST, them.id, until]);
  await client.query('UPDATE gangs SET war_with=$2, war_until=$3, war_score_us=0, war_score_them=0 WHERE id=$1', [them.id, us.id, until]);
  await h.ledger(client, { currency: 'cash', amount: -M3.WAR_COST, reason: 'gang:war', counterparty: us.id });
  bus.emit(`gang:${them.id}`, { type: 'war_declared', by: us.name });
  return { ok: true, until, spoilsPct: M3.WAR_SPOILS };
}

// ═══════════════════ TURF (§5.5) ═══════════════════
export async function seizeDistrict(ch, districtId, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss seizes turf.');
  if (!DISTRICTS.find((d) => d.id === districtId)) throw new GameError('bad_district', 'No such district.');
  const d = (await client.query('SELECT * FROM districts WHERE id=$1 FOR UPDATE', [districtId])).rows[0];
  if (d.holder_gang === h.owned.gangId) throw new GameError('held', 'You already hold that district.');
  const cost = d.holder_gang ? Math.max(M3.SEIZE_BASE, Math.floor(Number(d.garrison) * M3.SEIZE_OUTBID)) : M3.SEIZE_BASE;
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  if (Number(g.treasury) < cost) throw new GameError('treasury', `Seizing that district takes $${cost} from the treasury.`);
  // the garrison burns — turf costs the family real money (§10.4 sink)
  await client.query('UPDATE gangs SET treasury = treasury - $2 WHERE id=$1', [h.owned.gangId, cost]);
  await client.query('UPDATE districts SET holder_gang=$2, garrison=$3, seized_at=$4 WHERE id=$1', [districtId, h.owned.gangId, cost, now()]);
  await h.ledger(client, { currency: 'cash', amount: -cost, reason: `turf:seize:${districtId}`, counterparty: h.owned.gangId });
  if (!h.owned.held.includes(districtId)) h.owned.held.push(districtId);
  bus.emit('streets', { type: 'seize', district: districtId, gang: g.name });
  return { ok: true, district: districtId, garrison: cost };
}

// ═══════════════════ JUMPS (§7.6) ═══════════════════
export async function jump(ch, victim, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No street work from lockup.');
  if (Number(ch.health) < M3.JUMP_MIN_HEALTH) throw new GameError('health', "You're in no shape for a fight.");
  if (Number(ch.energy) < M3.JUMP_ENERGY) throw new GameError('energy', `Need ${M3.JUMP_ENERGY} energy to jump someone.`);
  if ((Number(ch.ammo) || 0) < M3.JUMP_AMMO) throw new GameError('ammo', `A jump takes ${M3.JUMP_AMMO} rounds.`);
  if (hospitalized(victim)) throw new GameError('hosp', "They're under the Doc's care. Even we have rules.");
  if (h.owned.gangId && h.victimOwned.gangId === h.owned.gangId) throw new GameError('family', "They're family. Omertà.");
  ch.energy = Number(ch.energy) - M3.JUMP_ENERGY;
  ch.ammo = Number(ch.ammo) - M3.JUMP_AMMO;
  await h.ledger(client, { characterId: ch.id, currency: 'ammo', amount: -M3.JUMP_AMMO, reason: 'jump' });

  if (h.owned.gangId) await resolveWarIfDue(client, h.owned.gangId);
  const ev = cityEventOf(dayOf());
  const myGang = h.owned.gangId ? (await client.query('SELECT * FROM gangs WHERE id=$1', [h.owned.gangId])).rows[0] : null;
  const war = warActive(myGang) && myGang.war_with === h.victimOwned.gangId;

  const rIdx = rankIdxOf(levelOf(Number(ch.respect)));
  const eff = (s) => effStat(ch[s], s, h.owned.assets, h.owned.gear);
  const vEff = (s) => effStat(victim[s], s, h.victimOwned.assets, h.victimOwned.gear);
  const atk = (eff('muscle') + eff('speed') * 0.5 + (gunObjOf(ch.gun)?.fp || 0) * 0.4 + (rIdx >= 3 ? 5 : 0))
    * (ch.path === 'gun' ? 1.1 : 1) + Math.random() * 25;
  const def = (vEff('muscle') + vEff('speed') * 0.5 + (gunObjOf(victim.gun)?.fp || 0) * 0.4) + Math.random() * 25;
  await h.rngLog(client, ch.id, `jump:${victim.id}`, Math.round(atk * 100) / 100, atk > def ? 'win' : 'loss');

  if (atk > def) {
    const stealPct = (war ? 0.25 : 0.15) + (ev.stealAdd || 0);
    const stolen = Math.min(Math.floor(Number(victim.cash) * stealPct), M3.JUMP_STEAL_CAP);
    const crates = Math.min(Number(victim.cb) || 0, rand(1, 3));
    const rival = !!(h.victimOwned.gangId && h.owned.gangId && h.victimOwned.gangId !== h.owned.gangId);
    let rep = Math.max(3, Math.floor(Number(victim.respect) * 0.01 * (rival ? 1.5 : 1))) + (rival ? 2 : 0);
    if (war) rep *= 2;
    rep = Math.floor(rep * (ev.jumpRep || 1));
    const dmg = rand(20, 40);

    ch.cash = Number(ch.cash) + stolen; ch.cb = (Number(ch.cb) || 0) + crates; ch.respect = Number(ch.respect) + rep;
    victim.cash = Number(victim.cash) - stolen; victim.cb = (Number(victim.cb) || 0) - crates;
    victim.health = Math.max(1, Number(victim.health) - dmg);
    victim.hosp_until = new Date(Date.now() + M3.JUMP_HOSP_MS);
    if (stolen > 0) {
      await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: stolen, reason: 'jump:steal', counterparty: victim.id });
      await h.ledger(client, { characterId: victim.id, currency: 'cash', amount: -stolen, reason: 'jump:stolen', counterparty: ch.id });
    }
    if (crates > 0) {
      await h.ledger(client, { characterId: ch.id, currency: 'cb', amount: crates, reason: 'jump:steal', counterparty: victim.id });
      await h.ledger(client, { characterId: victim.id, currency: 'cb', amount: -crates, reason: 'jump:stolen', counterparty: ch.id });
    }
    if (war) {
      await client.query('UPDATE gangs SET war_score_us = war_score_us + 1 WHERE id=$1', [h.owned.gangId]);
      await client.query('UPDATE gangs SET war_score_them = war_score_them + 1 WHERE id=$1', [h.victimOwned.gangId]);
    }
    const bounty = await claimBounty(client, h, ch, victim.id);
    await h.notify(client, victim.id, 'attack', { from: ch.name, stolen, cb: crates, dmg, hospMs: M3.JUMP_HOSP_MS });
    await h.bumpDaily(client, ch.id, 'jump');
    await bumpFamilyTask(client, h, 'jump', 1);
    bus.emit('streets', { type: 'jump', by: ch.name, on: victim.name, war: !!war });
    return { ok: true, win: true, stolen, crates, rep, bounty, war: !!war };
  }
  const dmg = rand(10, 25);
  ch.health = Math.max(1, Number(ch.health) - dmg);
  return { ok: true, win: false, dmg };
}

// ═══════════════════ BOUNTIES (§5.2) ═══════════════════
// Escrowed at post time (a §10.4 escrow bucket); paid to the hospitalizer/killer,
// never the poster. 2% house take on top.
export async function postBounty(ch, targetCharacterId, amount, client, h) {
  if (targetCharacterId === ch.id) throw new GameError('self', 'A price on your own head? See the Doc.');
  const t = (await client.query('SELECT id, name FROM characters WHERE id=$1 AND alive', [targetCharacterId])).rows[0];
  if (!t) throw new GameError('no_target', 'Nobody by that name on the streets.');
  const amt = Math.floor(Number(amount) || 0);
  if (amt < M3.BOUNTY_MIN) throw new GameError('min', `Minimum bounty is $${M3.BOUNTY_MIN}.`);
  const fee = Math.ceil(amt * 0.01), tax = Math.ceil(amt * 0.01);
  if (Number(ch.cash) < amt + fee + tax) throw new GameError('cash', `That bounty costs $${amt + fee + tax} with the 2% take.`);
  ch.cash = Number(ch.cash) - amt - fee - tax;
  const cur = (await client.query('SELECT * FROM bounties WHERE target_character=$1 FOR UPDATE', [targetCharacterId])).rows[0];
  // keep the FIRST poster as posted_by (do NOT overwrite on top-up); record EVERY
  // funder in bounty_contributors so none of them can collect the pot — otherwise a
  // poster funds a hit then tops it up via a confederate to flip the lock-out target
  if (cur) await client.query('UPDATE bounties SET amount = amount + $2 WHERE target_character=$1', [targetCharacterId, amt]);
  else await client.query('INSERT INTO bounties (target_character, amount, posted_by) VALUES ($1,$2,$3)', [targetCharacterId, amt, ch.id]);
  await client.query('INSERT INTO bounty_contributors (target_character, contributor) VALUES ($1,$2) ON CONFLICT (target_character, contributor) DO NOTHING', [targetCharacterId, ch.id]);
  // two rows so the §10.4 job can reconcile the escrow bucket exactly:
  // the escrowed amount vs the 2% house take
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -amt, reason: 'bounty:post', counterparty: targetCharacterId });
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -(fee + tax), reason: 'bounty:take', counterparty: targetCharacterId });
  await takeHouse(client, tax);
  bus.emit('streets', { type: 'bounty', on: t.name, amount: amt });
  return { ok: true, total: Number(cur?.amount || 0) + amt };
}

async function claimBounty(client, h, ch, victimId) {
  const b = (await client.query('SELECT * FROM bounties WHERE target_character=$1 FOR UPDATE', [victimId])).rows[0];
  if (!b) return 0;
  // no funder of the pot may collect it — checked against EVERY contributor, not just
  // the (overwriteable) posted_by. The contract stands for others; the bounty remains.
  const contributed = (await client.query('SELECT 1 FROM bounty_contributors WHERE target_character=$1 AND contributor=$2', [victimId, ch.id])).rows.length;
  if (contributed) return 0;
  await client.query('DELETE FROM bounties WHERE target_character=$1', [victimId]);
  await client.query('DELETE FROM bounty_contributors WHERE target_character=$1', [victimId]);
  const amt = Math.floor(Number(b.amount));
  ch.cash = Number(ch.cash) + amt;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: amt, reason: 'bounty:claim', counterparty: victimId });
  return amt;
}

// ═══════════════════ HIT CONTRACTS (§7.7) ═══════════════════
export async function startSearch(ch, targetCharacterId, client, h) {
  if (targetCharacterId === ch.id) throw new GameError('self', 'You know where you are.');
  const t = (await client.query('SELECT id, name FROM characters WHERE id=$1 AND alive', [targetCharacterId])).rows[0];
  if (!t) throw new GameError('no_target', 'Nobody by that name on the streets.');
  const tg = (await client.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [targetCharacterId])).rows[0];
  if (tg?.gang_id && tg.gang_id === h.owned.gangId) throw new GameError('family', "They're family. Omertà.");
  const cur = (await client.query('SELECT * FROM searches WHERE hunter=$1', [ch.id])).rows[0];
  if (cur) throw new GameError('searching', 'Your people are already out looking. Call them off first.');
  await client.query('INSERT INTO searches (hunter, target) VALUES ($1,$2)', [ch.id, targetCharacterId]);
  return { ok: true, placedAt: new Date(Date.now() + searchMs()) };
}

// §9 production timers: search 3 h, failed-shot cooldown 2 h.
// Tests may shrink them via env — never set these in production configs.
const searchMs = () => Number(process.env.SEARCH_MS || (3 * 3600 * 1000));
const shootCdMs = () => Number(process.env.SHOOT_CD_MS || (2 * 3600 * 1000));

export async function callOffSearch(ch, client) {
  await client.query('DELETE FROM searches WHERE hunter=$1', [ch.id]);
  return { ok: true };
}

export async function fire(ch, victim, client, h, rounds) {
  const s = (await client.query('SELECT * FROM searches WHERE hunter=$1', [ch.id])).rows[0];
  if (!s || s.target !== victim.id) throw new GameError('no_search', 'Your people have no fix on them. Start a search.');
  if (new Date(s.started_at).getTime() + searchMs() > Date.now())
    throw new GameError('searching', "They haven't been placed yet. Patience is a caliber.");
  if (jailed(ch)) throw new GameError('jailed', 'No wet work from lockup.');
  if (ch.shoot_cd_until && new Date(ch.shoot_cd_until) > new Date())
    throw new GameError('cooldown', "Your trigger's still hot.");
  const gun = gunObjOf(ch.gun);
  if (!gun) throw new GameError('gun', 'You need iron equipped for this kind of work.');
  if (Number(ch.energy) < M3.FIRE_ENERGY) throw new GameError('energy', `A hit takes ${M3.FIRE_ENERGY} energy.`);
  const fired = Math.max(50, Math.floor(Number(rounds) || 0)); // §7.7 rounds ≥ 50
  if ((Number(ch.ammo) || 0) < fired) throw new GameError('ammo', `Calling for ${fired} rounds with ${ch.ammo} on hand.`);
  if (hospitalized(victim)) throw new GameError('hosp', "They're under the Doc's care. Even we have rules.");
  if (h.owned.gangId && h.victimOwned.gangId === h.owned.gangId) {
    await client.query('DELETE FROM searches WHERE hunter=$1', [ch.id]);
    throw new GameError('family', "They've been made family since you took the contract. It's off.");
  }
  if (victim.loc !== ch.loc) throw new GameError('district', `They were placed in ${victim.loc} — you're in ${ch.loc}. Travel there, then fire.`);

  ch.energy = Number(ch.energy) - M3.FIRE_ENERGY;
  ch.ammo = Number(ch.ammo) - fired;
  await h.ledger(client, { characterId: ch.id, currency: 'ammo', amount: -fired, reason: 'fire' });

  const vicLvl = levelOf(Number(victim.respect));
  const btk = btkOf(vicLvl, victim.muscle, vestMultOf(victim.vest));
  const jamRoll = Math.random();
  const jammed = jamRoll > (gun.rel || 0.9);
  const effective = Math.floor(fired * (0.7 + (gun.fp || 0) / 50) * (jammed ? 0.75 : 1) * (ch.path === 'gun' ? 1.15 : 1));
  await h.rngLog(client, ch.id, `fire:${victim.id}`, jamRoll, effective >= btk ? `kill (eff ${effective} vs btk ${btk})` : `miss (eff ${effective} vs btk ${btk})`);
  await client.query('DELETE FROM searches WHERE hunter=$1', [ch.id]);

  if (effective >= btk) {
    // ── THE KILL ──
    const rep = Math.max(10, vicLvl * 2);
    // AUDIT R5 — the chop comes from the victim's ACTUAL cars rows; value transfers
    const chop = Math.floor(fleetValue(h.victimOwned.cars) * M3.CHOP_RATE);
    ch.respect = Number(ch.respect) + rep;
    if (chop > 0) {
      ch.cash = Number(ch.cash) + chop;
      await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: chop, reason: 'whack:chop', counterparty: victim.id });
    }
    const bounty = await claimBounty(client, h, ch, victim.id);
    await h.notify(client, victim.id, 'whacked', { from: ch.name });
    // witnesses: 3 random living characters saw something (§7.7)
    const wits = (await client.query('SELECT id FROM characters WHERE alive AND id<>$1 AND id<>$2 LIMIT 20', [ch.id, victim.id])).rows;
    for (const w of wits.sort(() => Math.random() - 0.5).slice(0, 3))
      await h.notify(client, w.id, 'witness', { killer: ch.name, victim: victim.name });
    await h.track(client, ch.account_id, 'kill', { rounds: fired, btk, victim: victim.id });
    const estate = await runEstate(client, h, victim, ch.name);
    bus.emit('streets', { type: 'kill', by: ch.name, victim: victim.name });
    return { ok: true, kill: true, rep, chop, bounty, jammed, estate: { heirId: estate.heirId } };
  }
  // ── THE MISS ──
  ch.shoot_cd_until = new Date(Date.now() + shootCdMs());
  const dmg = rand(5, 15);
  victim.health = Math.max(1, Number(victim.health) - dmg);
  await h.notify(client, victim.id, 'attempt', { from: ch.name, dmg });
  return { ok: true, kill: false, jammed, effective, btk };
}

// ═══════════════════ DEATH — THE ESTATE (§7.9, atomic) ═══════════════════
// The street dies: character row closed, possessions wiped, gang seat vacated,
// bounty cleared. The account survives: $OMR, staked, rewards, wallet, gear,
// prestige (+floor(level/2)), recruits, onboard, checkins, deaths+1. The heir
// row starts at generation+1 with the legacy stake.
export async function runEstate(client, h, victim, killerName) {
  const acct = h.victimAcct;
  const lvl = levelOf(Number(victim.respect));
  const legacy = Math.floor(lvl / 2);
  acct.prestige = Number(acct.prestige) + legacy;
  acct.deaths = Number(acct.deaths) + 1;

  const lostCash = Math.floor(Number(victim.cash) + Number(victim.bank));
  const report = {
    by: killerName, legacy,
    kept: { omr: Number(acct.omr), staked: Number(acct.staked), rewards: Number(acct.rewards),
            gear: h.victimOwned.gear.length, prestige: acct.prestige },
    lost: { cash: lostCash, cars: h.victimOwned.cars.length, guns: h.victimOwned.guns.length,
            rackets: h.victimOwned.rackets.length, assets: h.victimOwned.assets.length, lvl },
  };

  // §10.4: the estate burns street value — every currency leaves through a ledgered sink
  if (lostCash > 0) await h.ledger(client, { characterId: victim.id, currency: 'cash', amount: -lostCash, reason: 'death:estate' });
  if (Number(victim.cb) > 0) await h.ledger(client, { characterId: victim.id, currency: 'cb', amount: -Number(victim.cb), reason: 'death:estate' });
  if (Number(victim.ammo) > 0) await h.ledger(client, { characterId: victim.id, currency: 'ammo', amount: -Number(victim.ammo), reason: 'death:estate' });

  for (const table of ['cars', 'character_rackets', 'character_assets', 'character_cargo', 'character_items', 'character_guns', 'makings', 'stash', 'batches'])
    await client.query(`DELETE FROM ${table} WHERE character_id=$1`, [victim.id]);
  await client.query('DELETE FROM searches WHERE hunter=$1 OR target=$1', [victim.id]);
  // an unclaimed bounty dies with its target — ledgered so the escrow bucket reconciles
  const openBounty = (await client.query('SELECT amount FROM bounties WHERE target_character=$1', [victim.id])).rows[0];
  if (openBounty && Number(openBounty.amount) > 0)
    await h.ledger(client, { currency: 'cash', amount: -Number(openBounty.amount), reason: 'death:bounty', counterparty: victim.id });
  await client.query('DELETE FROM bounties WHERE target_character=$1', [victim.id]);
  await client.query('DELETE FROM bounty_contributors WHERE target_character=$1', [victim.id]);
  // Exchange escrow forfeits with the man (v24 rule) — bucket rows keep cb/ammo conservation exact
  const escrowed = (await client.query("SELECT item_kind, SUM(qty) q FROM listings WHERE seller_character=$1 AND item_kind IN ('cb','ammo') GROUP BY item_kind", [victim.id])).rows;
  for (const e of escrowed)
    await h.ledger(client, { currency: e.item_kind, amount: -Number(e.q), reason: 'death:escrow', counterparty: victim.id });
  await client.query('DELETE FROM listings WHERE seller_character=$1', [victim.id]);
  if (h.victimOwned.gangId) await removeMember(client, h.victimOwned.gangId, victim.id);

  victim.alive = false;
  await client.query('UPDATE characters SET alive=false, cash=0, bank=0, cb=0, ammo=0, gun=NULL, vest=NULL WHERE id=$1', [victim.id]);

  // the heir — same name (the bloodline), next generation, legacy stake
  const heirId = uid();
  const stake = 500 + 100 * Number(acct.prestige);
  await client.query(
    'INSERT INTO characters (id, account_id, name, generation, season, cash) VALUES ($1,$2,$3,$4,$5,$6)',
    [heirId, victim.account_id, victim.name, Number(victim.generation) + 1, Math.floor(dayOf() / 28), stake]);
  // legacy stake above the base 500 is a ledgered faucet (base 500 matches every fresh character)
  if (stake > 500) await h.ledger(client, { characterId: heirId, currency: 'cash', amount: stake - 500, reason: 'death:legacy' });
  await h.notify(client, heirId, 'estate', report);
  // §12 + §10.4: the death event carries the destroyed fleet size for car conservation
  await client.query('INSERT INTO telemetry (id, account_id, event, props) VALUES ($1,$2,$3,$4)',
    [uid(), victim.account_id, 'death', JSON.stringify({ by: killerName, cars: h.victimOwned.cars.length, lvl })]);
  return { heirId, report };
}

// ═══════════════════ BUSTING (§7.8) ═══════════════════
export async function bust(ch, victim, client, h) {
  if (jailed(ch)) throw new GameError('jailed', "You're in the same cage.");
  const remaining = victim.jail_until ? Math.max(0, (new Date(victim.jail_until) - Date.now()) / 1000) : 0;
  if (remaining <= 0) throw new GameError('free', 'They already walked.');
  const ev = cityEventOf(dayOf());
  const chance = Math.max(0.10, Math.min(0.90, 0.7 - remaining / 400 + (Number(ch.busts) || 0) * 0.03 + (ev.bustAdd || 0)));
  const roll = Math.random();
  await h.rngLog(client, ch.id, `bust:${victim.id}`, roll, roll < chance ? 'success' : 'fail');
  if (roll < chance) {
    const reward = Math.floor(500 + remaining * 15); // §7.8 faucet
    ch.cash = Number(ch.cash) + reward;
    ch.respect = Number(ch.respect) + 3;
    ch.busts = (Number(ch.busts) || 0) + 1;
    victim.jail_until = null;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: reward, reason: 'bust:reward' });
    await h.bumpDaily(client, ch.id, 'bust');
    await h.notify(client, victim.id, 'busted', { from: ch.name });
    bus.emit('streets', { type: 'bust', by: ch.name, freed: victim.name });
    return { ok: true, success: true, reward, busts: ch.busts };
  }
  ch.jail_until = new Date(Date.now() + M3.BUST_FAIL_JAIL_S * 1000);
  return { ok: true, success: false, jailSeconds: M3.BUST_FAIL_JAIL_S };
}

// ═══════════════════ THE EXCHANGE (§5.4 — escrowed order book) ═══════════════════
// cb, ammo, and crafted consumables only; product (drugs) is rejected as item_kind.
const KIND_OK = ['cb', 'ammo', 'item'];

export async function listItem(ch, kind, itemId, qty, unitPrice, client, h) {
  if (!KIND_OK.includes(kind)) throw new GameError('bad_kind', 'Sellable: cb, ammo, item. Product moves on the street, not the board.');
  const n = Math.max(1, Math.floor(Number(qty) || 0));
  const price = Math.max(1, Math.floor(Number(unitPrice) || 0));
  if (kind === 'item' && !CONSUMABLES.find((c) => c.id === itemId)) throw new GameError('bad_item', 'No such item.');
  const have = kind === 'cb' ? Number(ch.cb) : kind === 'ammo' ? Number(ch.ammo) : (h.owned.items[itemId] || 0);
  if (have < n) throw new GameError('short', "You can't sell what you don't have.");
  // Escrow moves goods character → the `listings` bucket, which the §10.4 job counts
  // as live inventory — so it is an INTERNAL transfer and must NOT be ledgered (a
  // ledger sink would double-count against the escrow bucket). Only forfeiture at
  // death removes cb/ammo from the system, and that path ledgers `death:escrow`.
  if (kind === 'cb') { ch.cb = Number(ch.cb) - n; }
  else if (kind === 'ammo') { ch.ammo = Number(ch.ammo) - n; }
  else {
    const left = (h.owned.items[itemId] || 0) - n;
    h.owned.items[itemId] = left;
    await client.query('DELETE FROM character_items WHERE character_id=$1 AND item_id=$2', [ch.id, itemId]);
    if (left > 0) await client.query('INSERT INTO character_items (character_id, item_id, qty) VALUES ($1,$2,$3)', [ch.id, itemId, left]);
  }
  const id = uid();
  await client.query('INSERT INTO listings (id, seller_character, item_kind, item_id, qty, unit_price) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, ch.id, kind, kind === 'item' ? itemId : kind, n, price]);
  return { ok: true, listingId: id };
}

export async function cancelListing(ch, listingId, client, h) {
  const l = (await client.query('SELECT * FROM listings WHERE id=$1 FOR UPDATE', [listingId])).rows[0];
  if (!l || l.seller_character !== ch.id) throw new GameError('no_listing', 'Not your listing.');
  await client.query('DELETE FROM listings WHERE id=$1', [listingId]);
  await returnEscrow(ch, l, client, h);
  return { ok: true };
}

async function returnEscrow(ch, l, client, h) {
  const n = Number(l.qty);
  // internal transfer back from the escrow bucket — not ledgered (see listItem)
  if (l.item_kind === 'cb') { ch.cb = Number(ch.cb) + n; }
  else if (l.item_kind === 'ammo') { ch.ammo = Number(ch.ammo) + n; }
  else {
    const cur = (await client.query('SELECT qty FROM character_items WHERE character_id=$1 AND item_id=$2', [ch.id, l.item_id])).rows[0];
    const total = Number(cur?.qty || 0) + n;
    await client.query('DELETE FROM character_items WHERE character_id=$1 AND item_id=$2', [ch.id, l.item_id]);
    await client.query('INSERT INTO character_items (character_id, item_id, qty) VALUES ($1,$2,$3)', [ch.id, l.item_id, total]);
    h.owned.items[l.item_id] = total;
  }
}

// Fill runs under withTwoCharacters(buyer, seller) — both rows locked (§10.1).
export async function buyListing(ch, seller, client, h, listingId) {
  const l = (await client.query('SELECT * FROM listings WHERE id=$1 FOR UPDATE', [listingId])).rows[0];
  if (!l) throw new GameError('gone', 'Too slow — someone else took that lot.');
  if (l.seller_character !== seller.id) throw new GameError('bad_seller', 'Listing/seller mismatch.');
  const total = Number(l.unit_price) * Number(l.qty);
  if (Number(ch.cash) < total) throw new GameError('cash', `That lot costs $${total}.`);
  // the 2% house take is paid by the seller (v24); on a tiny lot the take can exceed
  // the price — clamp so the seller is never DEBITED on a completed sale, and split
  // the actual take (never more than the buyer paid) between street tax and dev burn
  const fee = Math.ceil(total * 0.01), tax = Math.ceil(total * 0.01);
  const net = Math.max(0, total - fee - tax);
  const poolTax = Math.min(tax, total - net);
  await client.query('DELETE FROM listings WHERE id=$1', [listingId]);
  ch.cash = Number(ch.cash) - total;
  seller.cash = Number(seller.cash) + net;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -total, reason: 'exchange:buy', counterparty: seller.id });
  await h.ledger(client, { characterId: seller.id, currency: 'cash', amount: net, reason: 'exchange:sale', counterparty: ch.id });
  await takeHouse(client, poolTax);
  const n = Number(l.qty);
  // delivery is an internal transfer out of the escrow bucket to the buyer — not ledgered
  if (l.item_kind === 'cb') { ch.cb = Number(ch.cb) + n; }
  else if (l.item_kind === 'ammo') { ch.ammo = Number(ch.ammo) + n; }
  else {
    const cur = (await client.query('SELECT qty FROM character_items WHERE character_id=$1 AND item_id=$2', [ch.id, l.item_id])).rows[0];
    const totalQty = Number(cur?.qty || 0) + n;
    await client.query('DELETE FROM character_items WHERE character_id=$1 AND item_id=$2', [ch.id, l.item_id]);
    await client.query('INSERT INTO character_items (character_id, item_id, qty) VALUES ($1,$2,$3)', [ch.id, l.item_id, totalQty]);
    h.owned.items[l.item_id] = totalQty;
  }
  await h.bumpDaily(client, ch.id, 'trade');
  await h.notify(client, seller.id, 'sale', { what: `${n}× ${l.item_id}`, amt: net, to: ch.name });
  return { ok: true, qty: n, paid: total };
}

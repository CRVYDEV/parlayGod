// ═══ FIVE PILLARS #3 — SOVEREIGNTY (the EVE layer): turf you fight to KEEP ═══
// One stronghold per held district (the territory-racket shape). Passive: its garrison stiffens the
// district's seize outbid (one line in seizeDistrict). The catch: a daily 2h VULNERABILITY WINDOW
// (chosen at build — the EVE sov timer, a pure function of the clock, no state) in which a rival
// boss can SIEGE it down a tier (razed at 0). A siege is DESTRUCTION + status, never a transfer
// (anti-snowball): the attacker's chest burns win or lose (the npchit-fee posture) and a landed hit
// scores sov points (gangs.sov_points — the war-effort twin). Upkeep runs the pad/cold pattern with
// the EU4 OVEREXTENSION multiplier — every EXTRA district held inflates the whole empire's rate, so
// holding the city costs superlinearly (the audit's anti-snowball dial, made structural).
//
// §10.4: `sov:` is a PURE treasury-sink prefix (build/upgrade/upkeep/siege — character_id NULL,
// counterparty = the paying gang) added to the cash vocabulary + the gang-treasuries OUT terms.
// NO faucet anywhere in the pillar. Lock order: char (withCharacter) → OWN gang → the sov row
// (the territory convention — the DEFENDER's gang is never locked; the structure row is the
// contested object, exactly the convoy-manifest discipline).
import { GameError, bus } from './game.js';
import { SOV, sovRankOf, cityHourOf, DISTRICTS , jailed, hospitalized, safeHoused, usd } from './rules.js';

const canCommand = (h) => h.owned.gangRole === 'boss' || h.owned.gangRole === 'underboss';
// actor-state gates (the raidRivalRacket/P1.3 set — you can't run a siege from lockup, a hospital
// bed, or a safehouse). Local copies of the social.js one-liners (not exported there).
const tierOf = (s) => SOV.TIERS[Number(s.tier) - 1];
const crumbling = (s, now = Date.now()) => now - new Date(s.upkeep_at).getTime() > SOV.CRUMBLE_MS;
export const windowOpen = (s, now = Date.now()) => {
  if (process.env.SOV_WINDOW_OPEN === 'on') return true;   // TEST-ONLY (the SEARCH_MS knob precedent)
  // cityHourOf returns an OBJECT ({hour, patrol, phase}), not a number. Reading it as a number made
  // `hr - start` NaN, so this returned false for EVERY start hour and EVERY clock time — the
  // vulnerability window was PERMANENTLY SHUT in production and `siegeSov` threw `window` forever.
  // The siege test never caught it because it sets SOV_WINDOW_OPEN=on, which short-circuits above:
  // a TEST-ONLY override masking a dead production path is the "a check that cannot fail reads like
  // a clean bill of health" class in its live form. The sov map was also publishing
  // `vulnerable: false` on every stronghold, telling holders they could never be attacked.
  const hr = cityHourOf(now).hour;
  const start = Number(s.window_hour);
  return ((hr - start + 24) % 24) < SOV.WINDOW_H;
};

// the EU4 overextension multiplier — priced at the moment of the act (a lockless quote)
async function overextMult(client, gangId) {
  const held = Number((await client.query('SELECT COUNT(*) c FROM districts WHERE holder_gang=$1', [gangId])).rows[0].c);
  return 1 + (SOV.OVEREXT_BPS / 10000) * Math.max(0, held - 1);
}

function upkeepOwed(s, mult, now = Date.now()) {
  const elapsed = Math.min(Math.max(0, now - new Date(s.upkeep_at).getTime()), SOV.UPKEEP_CAP_MS);
  return Math.floor(tierOf(s).upkeepPerDay * (elapsed / 86400000) * mult);
}
// TIER-4 §C — the lazy income a held stronghold has accrued (capped at INCOME_CAP_MS; a crumbling
// stronghold earns nothing — pay the pad first, the sovGarrisonBonus discipline)
function incomeOwed(s, now = Date.now()) {
  if (crumbling(s)) return 0;
  const elapsed = Math.min(Math.max(0, now - new Date(s.income_at).getTime()), SOV.INCOME_CAP_MS);
  return Math.floor(tierOf(s).incomePerDay * (elapsed / 86400000));
}

// the seize touchpoint — an UNLOCKED quote (the outfitStrengthFrac precedent): a crumbling
// stronghold defends nothing (pay the pad or the walls are scenery).
export async function sovGarrisonBonus(client, districtId) {
  const s = (await client.query('SELECT * FROM sov_structures WHERE district_id=$1', [districtId])).rows[0];
  if (!s || crumbling(s)) return 0;
  return tierOf(s).garrison;
}

// a seized district's stronghold is RAZED (the victor tears it down — never inherited; anti-snowball)
export async function razeSov(client, districtId) {
  const r = await client.query('DELETE FROM sov_structures WHERE district_id=$1', [districtId]);
  // the structure is gone → the contest resets: clear every attacker's cooldown on this district
  // (a fresh stronghold built later isn't shielded by sieges of the razed one)
  await client.query('DELETE FROM sov_siege_cooldowns WHERE district_id=$1', [districtId]);
  return r.rowCount > 0;
}
export async function dissolveSov(client, gangId) {
  await client.query('DELETE FROM sov_structures WHERE gang_id=$1', [gangId]);
  // reap the dissolved family's siege cooldowns as an attacker (no ghost throttle when it re-forms)
  await client.query('DELETE FROM sov_siege_cooldowns WHERE gang_id=$1', [gangId]);
}

export async function buildSov(ch, districtId, windowHour, client, h) {
  if (!h.owned.gangId) throw new GameError('no_gang', 'Sovereignty is family business.');
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss raises walls.');
  if (!DISTRICTS.find((d) => d.id === districtId)) throw new GameError('bad_district', 'No such district.');
  const wh = Number(windowHour);
  if (!Number.isInteger(wh) || wh < 0 || wh > 23) throw new GameError('bad_window', 'Pick the vulnerability hour (0–23 UTC).');
  // DISTRICT → GANG, matching seizeDistrict (social/gangs.js) and establishRacket (territory.js) — the
  // two other paths that hold both. This used to lock gang → district on the reasoning that "no sov path
  // ever locks district THEN gang"; that analysed the wrong pair. A cycle needs ANY path in the tree to
  // take the other order, and both of those do — so a boss seizing a district while an underboss builds
  // on it was a live AB-BA (wide window: seizeDistrict does several round trips holding the district
  // lock). It was masked by the 40P01 → `contention` retry; the standing rule is to fix the order.
  // Locking the district first also still re-verifies the holder under the lock, so a build can't race
  // a seizure and orphan a stronghold on turf that just changed hands.
  const d = (await client.query('SELECT holder_gang FROM districts WHERE id=$1 FOR UPDATE', [districtId])).rows[0];
  if (d?.holder_gang !== h.owned.gangId) throw new GameError('not_yours', 'You can only build on turf your family holds.');
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  const existing = (await client.query('SELECT 1 FROM sov_structures WHERE district_id=$1', [districtId])).rows[0];
  if (existing) throw new GameError('exists', 'A stronghold already stands there.');
  const cost = SOV.TIERS[0].cost;
  if (Number(g.treasury) < cost) throw new GameError('treasury', `An ${SOV.TIERS[0].name} takes ${usd(cost)} from the treasury.`);
  await client.query('UPDATE gangs SET treasury = treasury - $2 WHERE id=$1', [g.id, cost]);
  await client.query('INSERT INTO sov_structures (district_id, gang_id, tier, window_hour) VALUES ($1,$2,1,$3)',
    [districtId, g.id, wh]);
  await h.ledger(client, { currency: 'cash', amount: -cost, reason: 'sov:build', counterparty: g.id });
  if (h.owned.gang) h.owned.gang.treasury = Number(g.treasury) - cost;
  bus.emit('streets', { type: 'sov_built', gang: g.name, district: districtId });
  return { ok: true, district: districtId, tier: 1, name: SOV.TIERS[0].name, windowHour: wh, cost };
}

export async function upgradeSov(ch, districtId, client, h) {
  if (!h.owned.gangId || !canCommand(h)) throw new GameError('rank', 'Only the boss or underboss raises walls.');
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  const s = (await client.query('SELECT * FROM sov_structures WHERE district_id=$1 FOR UPDATE', [districtId])).rows[0];
  if (!s || s.gang_id !== h.owned.gangId) throw new GameError('not_yours', 'No stronghold of yours there.');
  if (crumbling(s)) throw new GameError('crumbling', 'The walls are crumbling — settle the upkeep first.');
  const tier = Number(s.tier);
  if (tier >= SOV.TIERS.length) throw new GameError('maxed', 'The citadel is as tall as walls go.');
  const cost = SOV.TIERS[tier].cost;
  if (Number(g.treasury) < cost) throw new GameError('treasury', `A ${SOV.TIERS[tier].name} takes ${usd(cost)} from the treasury.`);
  await client.query('UPDATE gangs SET treasury = treasury - $2 WHERE id=$1', [g.id, cost]);
  await client.query('UPDATE sov_structures SET tier=$2 WHERE district_id=$1', [districtId, tier + 1]);
  await h.ledger(client, { currency: 'cash', amount: -cost, reason: 'sov:upgrade', counterparty: g.id });
  if (h.owned.gang) h.owned.gang.treasury = Number(g.treasury) - cost;
  return { ok: true, district: districtId, tier: tier + 1, name: SOV.TIERS[tier].name, cost };
}

// greedy pay-the-pad across every structure the family can afford (the business-upkeep pattern)
export async function paySovUpkeep(ch, client, h) {
  if (!h.owned.gangId || !canCommand(h)) throw new GameError('rank', 'Only the boss or underboss settles the pad.');
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  const rows = (await client.query('SELECT * FROM sov_structures WHERE gang_id=$1 ORDER BY district_id FOR UPDATE', [g.id])).rows;
  if (!rows.length) throw new GameError('nothing', 'No walls to keep.');
  const mult = await overextMult(client, g.id);
  let treasury = Number(g.treasury), paid = 0; const settled = [];
  for (const s of rows) {
    const owed = upkeepOwed(s, mult);
    if (owed <= 0 || owed > treasury) continue;
    treasury -= owed; paid += owed;
    await client.query('UPDATE sov_structures SET upkeep_at=now() WHERE district_id=$1', [s.district_id]);
    settled.push({ district: s.district_id, paid: owed });
  }
  if (!paid) return { ok: true, paid: 0, settled: [] };
  await client.query('UPDATE gangs SET treasury=$2 WHERE id=$1', [g.id, treasury]);
  await h.ledger(client, { currency: 'cash', amount: -paid, reason: 'sov:upkeep', counterparty: g.id });
  if (h.owned.gang) h.owned.gang.treasury = treasury;
  return { ok: true, paid, overextension: Math.round((mult - 1) * 100), settled };
}

// TIER-4 §C — COLLECT SOV INCOME: bank every held stronghold's accrued tribute to the treasury (the
// collectTerritory pattern). A §10.4 treasury FAUCET `sov:income` (bounded by tier + the 24h cap; a
// crumbling stronghold earns nothing). Any member may collect (the collectTerritory posture), but a
// safehoused member can't (D2 — the collect-class faucet exposure gate).
export async function collectSov(ch, client, h) {
  if (!h.owned.gangId) throw new GameError('no_gang', 'Sovereignty is family business.');
  if (safeHoused(ch)) throw new GameError('safe', "You can't run the family's books from a safehouse."); // D2
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  const rows = (await client.query('SELECT * FROM sov_structures WHERE gang_id=$1 ORDER BY district_id FOR UPDATE', [g.id])).rows;
  if (!rows.length) throw new GameError('nothing', 'No strongholds to draw tribute from.');
  let total = 0; const banked = [];
  for (const s of rows) {
    const owed = incomeOwed(s);
    if (owed <= 0) continue;
    total += owed;
    await client.query('UPDATE sov_structures SET income_at=now() WHERE district_id=$1', [s.district_id]);
    banked.push({ district: s.district_id, income: owed });
  }
  if (!total) return { ok: true, income: 0, banked: [] };
  await client.query('UPDATE gangs SET treasury = treasury + $2 WHERE id=$1', [g.id, total]);
  await h.ledger(client, { currency: 'cash', amount: total, reason: 'sov:income', counterparty: g.id });
  if (h.owned.gang) h.owned.gang.treasury = Number(g.treasury) + total;
  await h.track(client, ch.account_id, 'sov_income', { total, strongholds: banked.length });
  return { ok: true, income: total, banked };
}

// THE SIEGE — a rival boss assaults the walls during the vulnerability window. The chest burns win
// or lose; a win knocks the structure down a tier (razed at 0) and scores sov points; a loss costs
// health. Per-structure cooldown either way (the owner isn't ground down).
export async function siegeSov(ch, districtId, client, h) {
  if (!h.owned.gangId) throw new GameError('no_gang', 'A siege takes a family behind you.');
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss orders a siege.');
  if (jailed(ch)) throw new GameError('jailed', 'Not from lockup.');
  if (hospitalized(ch)) throw new GameError('hospitalized', "You're in no shape to lead a siege.");
  if (safeHoused(ch)) throw new GameError('safe', "You can't run a siege from a safehouse.");  // P1.3
  if (ch.loc !== districtId) throw new GameError('district', 'You lead a siege from their block, not from a barstool.', { district: districtId });
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  const s = (await client.query('SELECT * FROM sov_structures WHERE district_id=$1 FOR UPDATE', [districtId])).rows[0];
  if (!s) throw new GameError('no_structure', 'Nothing stands there to tear down.');
  if (s.gang_id === h.owned.gangId) throw new GameError('own', 'Those are YOUR walls.');
  if (!windowOpen(s)) throw new GameError('window', 'The walls only crack in their vulnerability window.');
  // PER-ATTACKER cooldown (audit HIGH-1): each family is throttled 24h, but one family/alt can't burn
  // the single daily slot to shield the hold from every OTHER attacker. Locked with the structure row.
  const cd = (await client.query(
    'SELECT cd_until FROM sov_siege_cooldowns WHERE district_id=$1 AND gang_id=$2 FOR UPDATE', [districtId, g.id])).rows[0];
  if (cd && new Date(cd.cd_until) > new Date()) throw new GameError('cooldown', 'Your family already moved on those walls today.');
  const tier = Number(s.tier);
  // VALUE-AT-STAKE: the assault chest scales with the target stronghold's BUILD COST (what you tear
  // down), floored at SIEGE_COST so the low-tier on-ramp is unchanged. `s` is FOR UPDATE-locked above.
  const tierCost = Number((SOV.TIERS[tier - 1] || SOV.TIERS[0]).cost);
  const siegeCost = Math.max(SOV.SIEGE_COST, Math.floor(tierCost * SOV.SIEGE_COST_BPS / 10000));
  if (Number(g.treasury) < siegeCost) throw new GameError('treasury', `A siege on those walls takes a ${usd(siegeCost)} war chest.`);
  // the chest burns WIN OR LOSE (the npchit-fee posture — aggression is never free)
  await client.query('UPDATE gangs SET treasury = treasury - $2 WHERE id=$1', [g.id, siegeCost]);
  await h.ledger(client, { currency: 'cash', amount: -siegeCost, reason: 'sov:siege', counterparty: g.id });
  if (h.owned.gang) h.owned.gang.treasury = Number(g.treasury) - siegeCost;
  const atk = Number(ch.muscle) + Number(ch.cunning) / 2;
  let p = Math.max(SOV.SIEGE_MIN_P, Math.min(SOV.SIEGE_MAX_P,
    SOV.SIEGE_BASE_P + atk / SOV.SIEGE_STAT_SCALE - (tier - 1) * SOV.SIEGE_TIER_P));
  const pEff = process.env.SOV_SIEGE_P != null ? Number(process.env.SOV_SIEGE_P) : p; // TEST-ONLY roll knob
  const roll = Math.random();
  const win = roll < pEff;
  await h.rngLog(client, ch.id, `sov:siege:${districtId}`, roll, `${win ? 'breached' : 'repelled'} (P ${pEff.toFixed(3)}, tier ${tier})`);
  // stamp THIS attacker's 24h cooldown win or lose (the npchit-cd posture — per (attacker, district))
  const cdUntil = new Date(Date.now() + SOV.SIEGE_CD_MS);
  await client.query(
    `INSERT INTO sov_siege_cooldowns (district_id, gang_id, cd_until) VALUES ($1,$2,$3)
       ON CONFLICT (district_id, gang_id) DO UPDATE SET cd_until=$3`, [districtId, g.id, cdUntil]);
  if (win) {
    const points = SOV.SOV_POINTS[tier] || 0;
    await client.query('UPDATE gangs SET sov_points=$2 WHERE id=$1', [g.id, Number(g.sov_points || 0) + points]);
    if (tier <= 1) {
      await client.query('DELETE FROM sov_structures WHERE district_id=$1', [districtId]);
      // razed → the contest resets: clear every attacker's cooldown (a rebuild isn't pre-shielded)
      await client.query('DELETE FROM sov_siege_cooldowns WHERE district_id=$1', [districtId]);
    } else await client.query('UPDATE sov_structures SET tier=$2 WHERE district_id=$1', [districtId, tier - 1]);
    bus.emit('streets', { type: 'sov_breached', gang: g.name, district: districtId, razed: tier <= 1 });
    return { ok: true, sov: true, win: true, razed: tier <= 1, newTier: tier - 1, sovPoints: points, cost: SOV.SIEGE_COST };
  }
  ch.health = Math.max(1, Number(ch.health) - SOV.SIEGE_FAIL_DMG);
  return { ok: true, sov: true, win: false, dmg: SOV.SIEGE_FAIL_DMG, cost: SOV.SIEGE_COST };
}

// the public sov map (EVE: sovereignty is VISIBLE — windows and all; the timer is the content)
export async function sovBoard(client, h) {
  const rows = (await client.query(
    `SELECT s.*, g.name AS gang_name, g.tag AS gang_tag FROM sov_structures s
       LEFT JOIN gangs g ON g.id = s.gang_id ORDER BY s.district_id`)).rows;
  const mult = h.owned.gangId ? await overextMult(client, h.owned.gangId) : 1;
  const myGang = h.owned.gangId
    ? (await client.query('SELECT sov_points FROM gangs WHERE id=$1', [h.owned.gangId])).rows[0] : null;
  // the viewer's OWN per-attacker siege cooldowns (the retired structure column is no longer read)
  const myCd = h.owned.gangId ? Object.fromEntries((await client.query(
    'SELECT district_id, cd_until FROM sov_siege_cooldowns WHERE gang_id=$1', [h.owned.gangId])).rows
    .map((r) => [r.district_id, r.cd_until])) : {};
  return {
    structures: rows.map((s) => {
      const tier = Number(s.tier);
      const t = tierOf(s);
      const cd = myCd[s.district_id];
      return {
        district: s.district_id, gang: s.gang_name, tag: s.gang_tag, holderTag: s.gang_tag,
        mine: s.gang_id === h.owned.gangId,
        tier, name: t.name, tierName: t.name, garrison: t.garrison, garrisonBonus: t.garrison,
        windowHour: Number(s.window_hour), windowH: SOV.WINDOW_H,
        windowOpen: windowOpen(s), vulnerable: windowOpen(s), crumbling: crumbling(s),
        nextTier: tier < SOV.TIERS.length ? { name: SOV.TIERS[tier].name, cost: SOV.TIERS[tier].cost } : null,
        upkeepOwed: s.gang_id === h.owned.gangId ? upkeepOwed(s, mult) : undefined,
        incomePerDay: t.incomePerDay,   // TIER-4 §C
        incomeOwed: s.gang_id === h.owned.gangId ? incomeOwed(s) : undefined,
        // VALUE-AT-STAKE: the siege chest for THIS stronghold scales with its build cost (see siegeSov)
        siegeCost: Math.max(SOV.SIEGE_COST, Math.floor(Number(t.cost) * SOV.SIEGE_COST_BPS / 10000)),
        siegeCdSeconds: cd && new Date(cd) > new Date() ? Math.floor((new Date(cd) - Date.now()) / 1000) : 0,
      };
    }),
    family: myGang ? { points: Number(myGang.sov_points || 0), rank: sovRankOf(myGang.sov_points || 0).name } : null,
    tiers: SOV.TIERS, siegeCost: SOV.SIEGE_COST, buildCost: SOV.TIERS[0].cost,
    overextensionPct: Math.round((mult - 1) * 100),
  };
}

export async function sovLeaderboard(pool) {
  const rows = (await pool.query(
    'SELECT name, tag, sov_points FROM gangs WHERE sov_points > 0 ORDER BY sov_points DESC LIMIT 20')).rows;
  return { families: rows.map((g) => ({ name: g.name, tag: g.tag, points: Number(g.sov_points), rank: sovRankOf(g.sov_points).name })) };
}

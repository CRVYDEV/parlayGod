// THE ESTATE ("the compound") — the deep PERSONAL $OMR sink + a "home" surface that displays your
// legend. Pure STATUS (display-only, no gameplay power → outside the sim-audited balance, the vanity/
// seal/Portfolio precedent). The ONLY §10.4 flow is the enumerated `estate:*` $OMR BURN, paid through
// the vanity `spendOmr` till (account bucket) so the burn discipline lives in one place. Account-level
// (keyed on account_id) → SURVIVES DEATH: the heir inherits the compound (never in the runEstate wipe).
import { GameError, cleanText, bus } from './game.js';
import { ESTATE, AUCTION, MADE, isMade, estateTierOf, estateFeatureOf, estateStaffOf, carVal, hitmanRankOf, sealOf,
  collectorRankOf, collectionSetsOf, jailed } from './rules.js';
import { spendOmr } from './vanity.js';

const featureSet = (features) => new Set(String(features || '').split(',').filter(Boolean));
const round2 = (n) => Math.round(Number(n) * 100) / 100;

// THE COLLECTOR legend (Tier-4) — bump the account's lifetime + this-season $OMR sunk into prestige
// by DIRECT SQL (NUMERIC += → pg-mem-safe; OFF persistAccount's positional list → clobber-safe, the
// tycoon_earned precedent). Called right after every estate/auction $OMR sink, on the OWN already-locked
// account (no new lock). season_sunk feeds the Patron crown (reset at rollover). Exported for auction.js.
export const bumpPrestige = (client, accountId, omr) =>
  client.query('UPDATE account_persistent SET prestige_sunk = prestige_sunk + $2, season_sunk = season_sunk + $2 WHERE account_id=$1',
    [accountId, Number(omr)]);

async function loadEstate(client, accountId) {
  return (await client.query('SELECT * FROM estates WHERE account_id=$1', [accountId])).rows[0]
    || { name: null, tier: 0, features: '', spent_omr: 0, staff_paid_at: null, gala_until: null, galas_hosted: 0, gala_best: 0 };
}

// Merge a patch onto the account's estate row (UPDATE, else INSERT) — one writer, absolute columns.
async function upsertEstate(client, accountId, patch) {
  const cur = await loadEstate(client, accountId);
  const pick = (k, dflt) => (patch[k] !== undefined ? patch[k] : (cur[k] !== undefined && cur[k] !== null ? cur[k] : dflt));
  const next = {
    name: patch.name !== undefined ? patch.name : cur.name,
    tier: patch.tier !== undefined ? patch.tier : Number(cur.tier || 0),
    features: patch.features !== undefined ? patch.features : (cur.features || ''),
    spent_omr: patch.spent_omr !== undefined ? patch.spent_omr : Number(cur.spent_omr || 0),
    staff_paid_at: pick('staff_paid_at', null),
    gala_until: pick('gala_until', null),
    galas_hosted: Number(pick('galas_hosted', 0)),
    gala_best: Number(pick('gala_best', 0)),
  };
  // (red-team MED) gala_best is bumped by a DIFFERENT session (a guest's attendGala, a direct monotonic
  // UPDATE) than this absolute row rewrite (the host's own estate mutations, from an unlocked snapshot).
  // Use GREATEST so a concurrent guest's turnout isn't clobbered back to the host's stale snapshot value.
  const upd = await client.query(
    `UPDATE estates SET name=$2, tier=$3, features=$4, spent_omr=$5, staff_paid_at=$6, gala_until=$7,
       galas_hosted=$8, gala_best=GREATEST(estates.gala_best, $9) WHERE account_id=$1`,
    [accountId, next.name, next.tier, next.features, next.spent_omr, next.staff_paid_at, next.gala_until,
      next.galas_hosted, next.gala_best]);
  if (!upd.rowCount) await client.query(
    `INSERT INTO estates (account_id, name, tier, features, spent_omr, staff_paid_at, gala_until, galas_hosted, gala_best)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [accountId, next.name, next.tier, next.features, next.spent_omr, next.staff_paid_at, next.gala_until,
      next.galas_hosted, next.gala_best]);
  return next;
}

// Trophies — your ACTUAL legend, computed from holdings. Display-only, moves nothing.
function trophies(h) {
  const owned = h.owned || {}, acct = h.acct || {};
  const cars = owned.cars || [];
  let rarest = null, best = -1;
  for (const c of cars) { const v = carVal(c.model_id, c.trim_id); if (v > best) { best = v; rarest = c; } }
  return {
    fleet: cars.length,
    rarestCar: rarest ? rarest.model_id : null,
    rarestCarValue: rarest ? best : 0,
    arsenal: (owned.guns || []).length,
    kills: Number(acct.kills || 0),
    hitmanTitle: hitmanRankOf(Number(acct.hitman_rep || 0)).title,
    crest: owned.gang ? (sealOf(owned.gang.seal)?.name || null) : null,
  };
}

// The board: your compound, the tier ladder, the feature catalog (owned / locked-by-tier), the trophies.
export async function estateBoard(ch, client, h) {
  const e = await loadEstate(client, ch.account_id);
  const owned = featureSet(e.features);
  const tier = Number(e.tier || 0);
  const next = estateTierOf(tier + 1);
  // step two: the household + the gala (read-only view of the lazy wage state — resolution happens
  // at the mutating touches; the board honestly shows a walked-out house as empty-with-a-warning)
  const staff = await staffRows(client, ch.account_id);
  const w = wageState(e, staff);
  // Tier-4 — THE COLLECTOR legend (this account's lifetime/season prestige spend + rank) + the read-derived
  // COLLECTION SETS over the archetypes you've won (h.acct carries prestige_sunk/season_sunk from the account row)
  const winArch = (await client.query('SELECT archetype FROM auction_wins WHERE account_id=$1', [ch.account_id])).rows;
  const sunk = Number(h.acct?.prestige_sunk || 0);
  const galaLive = e.gala_until && new Date(e.gala_until) > new Date();
  const guests = galaLive ? (await client.query(
    'SELECT guest_name FROM gala_guests WHERE host_account=$1 AND gala_key=$2 ORDER BY at', [ch.account_id, e.gala_until])).rows
    .map((g) => g.guest_name) : [];
  const household = {
    staff: staff.map((r) => { const s = estateStaffOf(r.staff_id); return { id: r.staff_id, name: s?.name || r.staff_id,
      wageOmrDay: s?.wageOmrDay || 0 }; }),
    catalog: ESTATE.STAFF.map((s) => ({ id: s.id, name: s.name, wageOmrDay: s.wageOmrDay, hireOmr: s.hireOmr,
      minTier: s.minTier, blurb: s.blurb, hired: staff.some((r) => r.staff_id === s.id), locked: tier < s.minTier })),
    wagePerDay: w.perDay, owed: w.owed, walked: w.walked,
    walkInSeconds: staff.length && e.staff_paid_at
      ? Math.max(0, Math.ceil((new Date(e.staff_paid_at).getTime() + ESTATE.STAFF_WALK_MS - Date.now()) / 1000)) : null,
  };
  // the season's parties — every LIVE gala in the city (host + door count), so a guest can attend
  const parties = (await client.query(
    `SELECT e2.name AS estate, e2.gala_until, c.id AS host_id, c.name AS host
       FROM estates e2 JOIN characters c ON c.account_id = e2.account_id AND c.alive
      WHERE e2.gala_until > now() ORDER BY e2.gala_until`)).rows;
  const gala = {
    parties: parties.map((p) => ({ hostId: p.host_id, host: p.host, estate: p.estate || '(an unnamed place)',
      untilSeconds: Math.max(0, Math.ceil((new Date(p.gala_until) - Date.now()) / 1000)), mine: p.host_id === ch.id })),
    live: !!galaLive, until: galaLive ? e.gala_until : null, guests,
    cost: ESTATE.GALA_OMR * Math.max(tier, ESTATE.GALA_MIN_TIER), minTier: ESTATE.GALA_MIN_TIER,
    hosted: Number(e.galas_hosted || 0), best: Number(e.gala_best || 0),
    canThrow: tier >= ESTATE.GALA_MIN_TIER && staff.some((r) => r.staff_id === 'butler') && !galaLive && !w.owed,
  };
  return {
    household, gala,
    name: e.name || null,
    tier, tierName: estateTierOf(tier)?.name || null,
    nextTier: next ? { tier: next.tier, name: next.name, omr: next.omr, blurb: next.blurb } : null,
    spent: Math.floor(Number(e.spent_omr || 0)),
    tiers: ESTATE.TIERS,
    features: ESTATE.FEATURES.map((f) => ({ id: f.id, name: f.name, omr: f.omr, minTier: f.minTier, blurb: f.blurb,
      owned: owned.has(f.id), locked: tier < f.minTier })),
    trophies: trophies(h),
    collector: { sunk: Math.floor(sunk), rank: collectorRankOf(sunk).name, seasonSunk: Math.floor(Number(h.acct?.season_sunk || 0)),
      ranks: AUCTION.COLLECTOR_RANKS },
    sets: collectionSetsOf(winArch),
    omr: Number(h.acct.omr || 0),
  };
}

// THE COLLECTORS OF THE CITY — the survives-death Collector legend board (lifetime $OMR sunk into
// prestige), plus the Patron of the Season (top this-season spend). Agents excluded (leaderboard posture).
export async function collectorLeaderboard(pool) {
  const rows = (await pool.query(
    `SELECT ap.prestige_sunk, ap.season_sunk, c.name AS steward FROM account_persistent ap
       JOIN characters c ON c.account_id = ap.account_id AND c.alive
      WHERE NOT ap.agent_flag AND ap.prestige_sunk > 0 ORDER BY ap.prestige_sunk DESC LIMIT 15`)).rows;
  return {
    collectors: rows.map((r, i) => ({ pos: i + 1, steward: r.steward, sunk: Math.floor(Number(r.prestige_sunk)),
      rank: collectorRankOf(r.prestige_sunk).name })),
    patron: await patronOfSeason(pool),
  };
}

// THE PATRON OF THE SEASON — a pure READ (no cross-account write, the architect-crown precedent):
// the account that has sunk the most $OMR into the pillar THIS season.
export async function patronOfSeason(pool) {
  const r = (await pool.query(
    `SELECT ap.season_sunk, c.name AS steward FROM account_persistent ap
       JOIN characters c ON c.account_id = ap.account_id AND c.alive
      WHERE NOT ap.agent_flag AND ap.season_sunk > 0 ORDER BY ap.season_sunk DESC LIMIT 1`)).rows[0];
  return r ? { name: r.steward, sunk: Math.floor(Number(r.season_sunk)) } : null;
}

// Buy the next tier (sequential, the seal ladder). A §10.4 $OMR burn `estate:tier`.
export async function upgradeEstate(ch, client, h) {
  const cur = await loadEstate(client, ch.account_id);
  const next = estateTierOf(Number(cur.tier || 0) + 1);
  if (!next) throw new GameError('maxed', "The Compound is the top of the world — there's nowhere higher.");
  // THE MADE MAN (v3 §11.2): the UPPER compound wants standing. Status gating status — the estate is
  // display-only, so this gates no earning loop; the lower tiers stay open to everyone.
  if (next.tier >= MADE.ESTATE_TIER && !isMade(h.acct))
    throw new GameError('made', `The ${next.name} is for made men. Pay your dues first.`);
  await spendOmr(client, h, next.omr, 'estate:tier');
  await bumpPrestige(client, ch.account_id, next.omr); // THE COLLECTOR legend
  const spent = Number(cur.spent_omr || 0) + next.omr;
  await upsertEstate(client, ch.account_id, { tier: next.tier, spent_omr: spent });
  await h.track(client, ch.account_id, 'estate_tier', { tier: next.tier, omr: next.omr });
  return { ok: true, tier: next.tier, name: next.name, spent,
    nextTier: estateTierOf(next.tier + 1) ? { name: estateTierOf(next.tier + 1).name, omr: estateTierOf(next.tier + 1).omr } : null };
}

// Unlock a feature (tier-gated, one-time). A §10.4 $OMR burn `estate:feature`.
export async function unlockFeature(ch, featureId, client, h) {
  const f = estateFeatureOf(featureId);
  if (!f) throw new GameError('feature', 'No such addition to the estate.');
  const cur = await loadEstate(client, ch.account_id);
  const set = featureSet(cur.features);
  if (set.has(f.id)) throw new GameError('owned', 'That wing is already built.');
  if (Number(cur.tier || 0) < f.minTier) throw new GameError('tier', `The ${f.name} needs a ${estateTierOf(f.minTier).name} first.`);
  await spendOmr(client, h, f.omr, 'estate:feature');
  await bumpPrestige(client, ch.account_id, f.omr);
  set.add(f.id);
  await upsertEstate(client, ch.account_id, { features: [...set].join(','), spent_omr: Number(cur.spent_omr || 0) + f.omr });
  await h.track(client, ch.account_id, 'estate_feature', { feature: f.id, omr: f.omr });
  return { ok: true, feature: f.id, name: f.name };
}

// Name / rename the compound (you can only name a place you own — tier ≥ 1). Burn `estate:name`.
export async function nameEstate(ch, name, client, h) {
  const cur = await loadEstate(client, ch.account_id);
  if (Number(cur.tier || 0) < 1) throw new GameError('no_estate', "Buy a place before you name it.");
  const n = cleanText(name).replace(/\s+/g, ' ').trim().slice(0, 32); // strip HTML-injection chars (stored-XSS fix, R6)
  if (n.length < 2) throw new GameError('name', 'Give the place a name (2–32 characters, no < > " markup).');
  await spendOmr(client, h, ESTATE.NAME_OMR, 'estate:name');
  await bumpPrestige(client, ch.account_id, ESTATE.NAME_OMR);
  await upsertEstate(client, ch.account_id, { name: n, spent_omr: Number(cur.spent_omr || 0) + ESTATE.NAME_OMR });
  return { ok: true, name: n };
}

// ── STEP TWO: THE STAFF (the recurring $OMR payroll) + THE GALA (design §A) ──
// One household wage clock (estates.staff_paid_at — the business-pad/crew-nut pattern). Wages owed
// = Σ wageOmrDay × elapsed days; arrears older than STAFF_WALK_MS → the staff WALK (rows deleted,
// arrears cleared — you stiffed them and they left; rehiring costs the hire fees again, which at
// 10× the daily wage makes the dismiss-dodge always −EV vs just paying). Everything here is PURE
// STATUS; the only §10.4 flows are `estate:staff:hire`/`estate:staff`/`estate:gala` $OMR burns
// riding the existing `estate:%` vocabulary (zero invariant changes).
async function staffRows(client, accountId) {
  return (await client.query('SELECT staff_id, hired_at FROM estate_staff WHERE account_id=$1 ORDER BY hired_at', [accountId])).rows;
}
function wageState(estate, staff, now = Date.now()) {
  const perDay = round2(staff.reduce((a, r) => a + (estateStaffOf(r.staff_id)?.wageOmrDay || 0), 0));
  if (!staff.length || !estate.staff_paid_at) return { perDay, owed: 0, elapsedMs: 0, walked: false };
  const elapsedMs = Math.max(0, now - new Date(estate.staff_paid_at).getTime());
  const walked = elapsedMs > ESTATE.STAFF_WALK_MS;
  const owed = round2(perDay * Math.min(elapsedMs, ESTATE.STAFF_WALK_MS) / 86400000);
  return { perDay, owed, elapsedMs, walked };
}
// Resolve a household in arrears past the walk window: the staff leave, the debt dies with the
// insult. Called at every mutating touch (pay/hire/dismiss/gala) — the §7.1 lazy pattern.
async function resolveWalk(client, accountId, estate, staff) {
  const w = wageState(estate, staff);
  if (!w.walked) return { estate, staff, walked: false };
  await client.query('DELETE FROM estate_staff WHERE account_id=$1', [accountId]);
  await upsertEstate(client, accountId, { staff_paid_at: null });
  return { estate: { ...estate, staff_paid_at: null }, staff: [], walked: true };
}

// Hire a staff member — tier-gated, one of each, wages must be current (no hiring onto a delinquent
// book — the clock is shared, so a mid-cycle hire would instantly owe time they never worked).
export async function hireStaff(ch, staffId, client, h) {
  const s = estateStaffOf(staffId);
  if (!s) throw new GameError('staff', 'Nobody by that trade is looking for work.');
  const cur = await loadEstate(client, ch.account_id);
  const r = await resolveWalk(client, ch.account_id, cur, await staffRows(client, ch.account_id));
  if (Number(cur.tier || 0) < s.minTier)
    throw new GameError('tier', `A ${estateTierOf(s.minTier).name} before a ${s.name} — the help needs somewhere to work.`);
  if (r.staff.some((x) => x.staff_id === s.id)) throw new GameError('hired', 'They already run your house.');
  const w = wageState(r.estate, r.staff);
  if (w.owed > 0) throw new GameError('wages', 'Settle the household wages before hiring anyone new.');
  await spendOmr(client, h, s.hireOmr, 'estate:staff:hire');
  await bumpPrestige(client, ch.account_id, s.hireOmr);
  await client.query('INSERT INTO estate_staff (account_id, staff_id) VALUES ($1,$2)', [ch.account_id, s.id]);
  // first hire starts the clock; later hires join the current (settled) cycle
  await upsertEstate(client, ch.account_id, {
    staff_paid_at: r.staff.length ? r.estate.staff_paid_at : new Date(),
    spent_omr: Number(r.estate.spent_omr || 0) + s.hireOmr });
  await h.track(client, ch.account_id, 'estate_staff_hire', { staff: s.id, omr: s.hireOmr });
  return { ok: true, staff: s.id, name: s.name, wageOmrDay: s.wageOmrDay, walked: r.walked };
}

// Dismiss — free, but wages must be settled first (no stiffing on the way out; the walk window is
// the only way wages ever vanish, and it costs you the whole household + the rehire fees).
export async function dismissStaff(ch, staffId, client, h) {
  const cur = await loadEstate(client, ch.account_id);
  const r = await resolveWalk(client, ch.account_id, cur, await staffRows(client, ch.account_id));
  if (!r.staff.some((x) => x.staff_id === staffId)) throw new GameError('not_hired', "They don't work for you.");
  const w = wageState(r.estate, r.staff);
  if (w.owed > 0) throw new GameError('wages', 'Pay what the household is owed before letting anyone go.');
  await client.query('DELETE FROM estate_staff WHERE account_id=$1 AND staff_id=$2', [ch.account_id, staffId]);
  const remaining = r.staff.length - 1;
  if (!remaining) await upsertEstate(client, ch.account_id, { staff_paid_at: null });
  await h.track(client, ch.account_id, 'estate_staff_dismiss', { staff: staffId });
  return { ok: true, dismissed: staffId };
}

// Settle the household — ALL-OR-NOTHING (the crew-nut pattern). A `estate:staff` $OMR burn.
export async function payStaffWages(ch, client, h) {
  const cur = await loadEstate(client, ch.account_id);
  const r = await resolveWalk(client, ch.account_id, cur, await staffRows(client, ch.account_id));
  // (red-team MED) if the staff WALKED, return a benign result so withCharacter COMMITS the walk
  // (resolveWalk's DELETE) — throwing here would roll the walk back on real Postgres, leaving the
  // house showing full staff + a payable-looking `owed` forever until some other action commits.
  if (r.walked && !r.staff.length) return { ok: true, walked: true, paid: 0 };
  if (!r.staff.length) throw new GameError('no_staff', 'Nobody on the payroll.');
  const w = wageState(r.estate, r.staff);
  if (!(w.owed > 0)) return { ok: true, paid: 0, perDay: w.perDay };
  await spendOmr(client, h, w.owed, 'estate:staff');
  await bumpPrestige(client, ch.account_id, w.owed);
  await upsertEstate(client, ch.account_id, { staff_paid_at: new Date(),
    spent_omr: Number(r.estate.spent_omr || 0) + w.owed });
  await h.track(client, ch.account_id, 'estate_wages', { omr: w.owed, staff: r.staff.length });
  return { ok: true, paid: w.owed, perDay: w.perDay, staff: r.staff.length };
}

// THE GALA — tier-scaled burn, Butler required, wages current, one at a time. Opens a be-seen
// window announced on the streets; anyone alive may attend once (pure status, the guest list).
export async function throwGala(ch, client, h) {
  const cur = await loadEstate(client, ch.account_id);
  const r = await resolveWalk(client, ch.account_id, cur, await staffRows(client, ch.account_id));
  const tier = Number(r.estate.tier || 0);
  if (tier < ESTATE.GALA_MIN_TIER)
    throw new GameError('tier', `A ${estateTierOf(ESTATE.GALA_MIN_TIER).name} before you host the city.`);
  if (!r.staff.some((x) => x.staff_id === 'butler'))
    throw new GameError('butler', 'Nobody throws a gala without a Butler running the door.');
  if (wageState(r.estate, r.staff).owed > 0)
    throw new GameError('wages', 'Pay the household before you make them work a party.');
  if (r.estate.gala_until && new Date(r.estate.gala_until) > new Date())
    throw new GameError('already', 'The party is already on — the doors are open.');
  const cost = ESTATE.GALA_OMR * tier;
  await spendOmr(client, h, cost, 'estate:gala');
  await bumpPrestige(client, ch.account_id, cost);
  const until = new Date(Date.now() + ESTATE.GALA_MS);
  await upsertEstate(client, ch.account_id, { gala_until: until,
    galas_hosted: Number(r.estate.galas_hosted || 0) + 1,
    spent_omr: Number(r.estate.spent_omr || 0) + cost });
  bus.emit('streets', { type: 'gala', host: ch.name, estate: r.estate.name || null, tier });
  await h.track(client, ch.account_id, 'estate_gala', { omr: cost, tier });
  return { ok: true, cost, until, hoursOpen: Math.round(ESTATE.GALA_MS / 3600000) };
}

// Attend a live gala — free, once per party, PURE STATUS (your name on the guest list). Single-party
// (the actor only); the host's estate row is written monotonically (gala_best converges under race).
export async function attendGala(ch, hostCharacterId, client, h) {
  if (hostCharacterId === ch.id) throw new GameError('self', "You can't be a guest at your own party.");
  if (jailed(ch))
    throw new GameError('jailed', 'No parties from a cell.'); // (red-team LOW) the design's 'not in lockup' gate
  const host = (await client.query('SELECT id, name, account_id, alive FROM characters WHERE id=$1', [hostCharacterId])).rows[0];
  if (!host || !host.alive) throw new GameError('gone', 'That host is gone.');
  const e = await loadEstate(client, host.account_id);
  if (!e.gala_until || new Date(e.gala_until) <= new Date())
    throw new GameError('no_gala', "There's no party at that address tonight.");
  try {
    await client.query('INSERT INTO gala_guests (host_account, guest_account, gala_key, guest_name) VALUES ($1,$2,$3,$4)',
      [host.account_id, ch.account_id, e.gala_until, ch.name]);
  } catch (err) {
    // a genuine dup (already attended) is a clean 400; a transient serialization/deadlock must retry,
    // not masquerade as 'attended' (the AUDIT-market-skills-underworld catch-all-swallow fix)
    if (String(err?.code) === '23505') throw new GameError('attended', "You've already made your entrance.");
    throw err;
  }
  const n = Number((await client.query('SELECT COUNT(*) n FROM gala_guests WHERE host_account=$1 AND gala_key=$2',
    [host.account_id, e.gala_until])).rows[0].n);
  await client.query('UPDATE estates SET gala_best=$2 WHERE account_id=$1 AND gala_best < $2', [host.account_id, n]);
  await h.notify(client, host.id, 'gala_guest', { guest: ch.name, guests: n });
  await h.track(client, ch.account_id, 'estate_gala_attend', { host: host.name });
  return { ok: true, host: host.name, estate: e.name || null, guests: n };
}

// The city's great houses — lifetime $OMR sunk (the estate's value figure). Status board: living
// steward named, agents excluded (the leaderboard posture).
export async function estateLeaderboard(pool) {
  const rows = (await pool.query(
    `SELECT e.account_id, e.name, e.tier, e.spent_omr, e.galas_hosted, e.gala_best, c.name AS steward
       FROM estates e
       JOIN account_persistent ap ON ap.account_id = e.account_id AND NOT ap.agent_flag
       JOIN characters c ON c.account_id = e.account_id AND c.alive
      WHERE e.spent_omr > 0
      ORDER BY e.spent_omr DESC, e.account_id LIMIT 15`)).rows;
  const staffCounts = {}; // counted in JS over a flat read (the pg-mem GROUP-BY-aggregate precedent)
  for (const r of (await pool.query('SELECT account_id FROM estate_staff')).rows)
    staffCounts[r.account_id] = (staffCounts[r.account_id] || 0) + 1;
  return { houses: rows.map((r, i) => ({ pos: i + 1, estate: r.name || '(an unnamed place)',
    steward: r.steward, tier: Number(r.tier), tierName: estateTierOf(Number(r.tier))?.name || null,
    value: Math.floor(Number(r.spent_omr)), staff: staffCounts[r.account_id] || 0,
    galas: Number(r.galas_hosted || 0), bestGala: Number(r.gala_best || 0) })) };
}

// The value of an account's estate (tier $OMR + feature $OMR) — for the estate report / a leaderboard.
export async function estateValue(client, accountId) {
  const e = await loadEstate(client, accountId);
  return { tier: Number(e.tier || 0), tierName: estateTierOf(Number(e.tier || 0))?.name || null,
    name: e.name || null, spent: Math.floor(Number(e.spent_omr || 0)) };
}

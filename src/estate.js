// THE ESTATE ("the compound") — the deep PERSONAL $OMR sink + a "home" surface that displays your
// legend. Pure STATUS (display-only, no gameplay power → outside the sim-audited balance, the vanity/
// seal/Portfolio precedent). The ONLY §10.4 flow is the enumerated `estate:*` $OMR BURN, paid through
// the vanity `spendOmr` till (account bucket) so the burn discipline lives in one place. Account-level
// (keyed on account_id) → SURVIVES DEATH: the heir inherits the compound (never in the runEstate wipe).
import { GameError, cleanText } from './game.js';
import { ESTATE, estateTierOf, estateFeatureOf, carVal, tickerPriceOf, hitmanRankOf, sealOf } from './rules.js';
import { spendOmr } from './vanity.js';

const featureSet = (features) => new Set(String(features || '').split(',').filter(Boolean));

async function loadEstate(client, accountId) {
  return (await client.query('SELECT name, tier, features, spent_omr FROM estates WHERE account_id=$1', [accountId])).rows[0]
    || { name: null, tier: 0, features: '', spent_omr: 0 };
}

// Merge a patch onto the account's estate row (UPDATE, else INSERT) — one writer, absolute columns.
async function upsertEstate(client, accountId, patch) {
  const cur = await loadEstate(client, accountId);
  const next = {
    name: patch.name !== undefined ? patch.name : cur.name,
    tier: patch.tier !== undefined ? patch.tier : Number(cur.tier || 0),
    features: patch.features !== undefined ? patch.features : (cur.features || ''),
    spent_omr: patch.spent_omr !== undefined ? patch.spent_omr : Number(cur.spent_omr || 0),
  };
  const upd = await client.query('UPDATE estates SET name=$2, tier=$3, features=$4, spent_omr=$5 WHERE account_id=$1',
    [accountId, next.name, next.tier, next.features, next.spent_omr]);
  if (!upd.rowCount) await client.query('INSERT INTO estates (account_id, name, tier, features, spent_omr) VALUES ($1,$2,$3,$4,$5)',
    [accountId, next.name, next.tier, next.features, next.spent_omr]);
  return next;
}

// Trophies — your ACTUAL legend, computed from holdings. Display-only, moves nothing.
function trophies(h) {
  const owned = h.owned || {}, acct = h.acct || {};
  const cars = owned.cars || [];
  let rarest = null, best = -1;
  for (const c of cars) { const v = carVal(c.model_id, c.trim_id); if (v > best) { best = v; rarest = c; } }
  const book = (owned.portfolio || []).reduce((a, r) => a + Number(r.shares) * tickerPriceOf(r.ticker), 0);
  return {
    fleet: cars.length,
    rarestCar: rarest ? rarest.model_id : null,
    rarestCarValue: rarest ? best : 0,
    arsenal: (owned.guns || []).length,
    portfolioValue: Math.round(book * 100) / 100,
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
  return {
    name: e.name || null,
    tier, tierName: estateTierOf(tier)?.name || null,
    nextTier: next ? { tier: next.tier, name: next.name, omr: next.omr, blurb: next.blurb } : null,
    spent: Math.floor(Number(e.spent_omr || 0)),
    tiers: ESTATE.TIERS,
    features: ESTATE.FEATURES.map((f) => ({ id: f.id, name: f.name, omr: f.omr, minTier: f.minTier, blurb: f.blurb,
      owned: owned.has(f.id), locked: tier < f.minTier })),
    trophies: trophies(h),
    omr: Number(h.acct.omr || 0),
  };
}

// Buy the next tier (sequential, the seal ladder). A §10.4 $OMR burn `estate:tier`.
export async function upgradeEstate(ch, client, h) {
  const cur = await loadEstate(client, ch.account_id);
  const next = estateTierOf(Number(cur.tier || 0) + 1);
  if (!next) throw new GameError('maxed', "The Compound is the top of the world — there's nowhere higher.");
  await spendOmr(client, h, next.omr, 'estate:tier');
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
  await upsertEstate(client, ch.account_id, { name: n, spent_omr: Number(cur.spent_omr || 0) + ESTATE.NAME_OMR });
  return { ok: true, name: n };
}

// The value of an account's estate (tier $OMR + feature $OMR) — for the estate report / a leaderboard.
export async function estateValue(client, accountId) {
  const e = await loadEstate(client, accountId);
  return { tier: Number(e.tier || 0), tierName: estateTierOf(Number(e.tier || 0))?.name || null,
    name: e.name || null, spent: Math.floor(Number(e.spent_omr || 0)) };
}

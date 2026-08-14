// STREET DEEDS — the map as property (omerta-street-deeds-design.md). A named, mapped plot of the
// world a player OWNS and builds a legend on — the Monopoly layer. Phase 1 is PURE STATUS: the deed,
// its name, its map plot and its provenance are all status, so NO `transactions` row is ever written,
// the reason vocabulary is unchanged, and the nightly §10.4 sweep stays drift-0 BY CONSTRUCTION (the
// test asserts zero ledger rows across the whole flow — the portrait/dynasty/estate precedent).
//
// ACCOUNT-level (keyed on account_id) → SURVIVES DEATH: your characters die, the street stays yours;
// the heir inherits it (outside the runEstate wipe by construction — the death-disposition guard scans
// character_id-keyed tables, never account_id-keyed ones). CONTROL — rent (B) and turf (C) — is earned
// and defended IN-GAME (Phase 2, sim + founder sign-off); the on-chain tradeable token is Phase 3
// (audit + counsel gated). Deliberately NOT wired into the live mint / the `minted` extraction flag,
// so the Sybil/extraction machinery is untouched (design §8).
import { GameError, cleanText } from './game.js';
import { DEEDS, DISTRICTS, deedRankOf, deedRenown, deedCornerOwed, deedController,
  deedNeighborhoodsOpen, deedNeighborhoodOf,
  effStat, levelOf, jailed, hospitalized, safeHoused } from './rules.js';

// living-player population (drives the growing map — Phase 4). NPCs/dead excluded (the ops.js count).
async function livingPlayers(client) {
  return Number((await client.query('SELECT COUNT(*) n FROM characters WHERE alive AND NOT is_npc')).rows[0].n);
}

// rules.js doesn't export a district-name helper (hustle.js/citymap.js keep it local), so map it here.
const districtName = (id) => (DISTRICTS.find((d) => d.id === id) || {}).name || id;

async function loadDeed(client, accountId) {
  return (await client.query('SELECT * FROM street_deeds WHERE account_id=$1', [accountId])).rows[0] || null;
}

async function deedHistory(client, accountId) {
  return (await client.query(
    'SELECT kind, detail, at FROM street_deed_history WHERE account_id=$1 ORDER BY at DESC LIMIT $2',
    [accountId, DEEDS.HISTORY_MAX])).rows.map((r) => ({ kind: r.kind, detail: r.detail || '', at: r.at }));
}

// Record a notable event on an account's deed — THE LEGEND ENGINE (§4). Best-effort under a SAVEPOINT
// so it can never poison the enclosing action's transaction (the logCollect discipline: a real
// SAVEPOINT under Postgres, a bare INSERT under pg-mem which cannot parse one). NO-OP if the account
// holds no deed (history is tied to a real deed; an account without one accrues nothing). Headless —
// no `h`, no §10.4. `detail` is a PRE-HUMANIZED string, markup-stripped, rendered escaped client-side.
export async function recordDeedEvent(client, accountId, kind, detail = '') {
  if (!accountId) return false;
  let sp = false;
  try { await client.query('SAVEPOINT deed_evt'); sp = true; } catch { /* pg-mem: no savepoints */ }
  try {
    const has = (await client.query('SELECT 1 FROM street_deeds WHERE account_id=$1', [accountId])).rowCount;
    if (!has) { if (sp) await client.query('RELEASE SAVEPOINT deed_evt'); return false; }
    await client.query('INSERT INTO street_deed_history (account_id, kind, detail) VALUES ($1,$2,$3)',
      [accountId, String(kind).slice(0, 24), cleanText(String(detail)).slice(0, 200)]);
    if (sp) await client.query('RELEASE SAVEPOINT deed_evt');
    return true;
  } catch {
    if (sp) { try { await client.query('ROLLBACK TO SAVEPOINT deed_evt'); } catch { /* ignore */ } }
    return false;
  }
}

// Claim a named deed, mapped to a district. One per account (the identity/Sybil model — a Monopoly
// PORTFOLIO of many streets is a Phase-3 secondary-market behavior, not a Phase-1 primitive). Name is
// validated like a living-street name: markup-stripped (stored-XSS), length-bounded, city-wide unique.
// FREE in Phase 1 (pure onboarding/collectible — the ETH mint fee attaches at Phase 3). ZERO §10.4.
export async function claimDeed(ch, body, client, h) {
  const existing = await loadDeed(client, ch.account_id);
  if (existing) throw new GameError('have_deed', `You already hold the deed to ${existing.name}.`);
  const district = String(body?.district || '');
  if (!DISTRICTS.find((d) => d.id === district)) throw new GameError('district', 'Pick a district for your street.');
  const name = cleanText(body?.name || '').replace(/\s+/g, ' ').trim().slice(0, DEEDS.NAME_MAX);
  if (name.length < DEEDS.NAME_MIN)
    throw new GameError('name', `Name your street (${DEEDS.NAME_MIN}–${DEEDS.NAME_MAX} characters, no < > " markup).`);
  const nameLc = name.toLowerCase();
  if ((await client.query('SELECT 1 FROM street_deeds WHERE name_lc=$1', [nameLc])).rowCount)
    throw new GameError('taken', 'That street is already on the map. Pick another name.');
  try {
    // corner_at starts the corner-take clock at claim (Phase 2 — the owner controls their own corner)
    await client.query('INSERT INTO street_deeds (account_id, name, name_lc, district, corner_at) VALUES ($1,$2,$3,$4,now())',
      [ch.account_id, name, nameLc, district]);
  } catch (err) {
    // a concurrent claim of the same name races on the unique index → a clean 400, not a 500
    if (String(err?.code) === '23505') throw new GameError('taken', 'That street was just claimed. Pick another name.');
    throw err;
  }
  await recordDeedEvent(client, ch.account_id, 'claim', `claimed by ${ch.name}`);
  if (h?.track) await h.track(client, ch.account_id, 'deed_claim', { district });
  return { ok: true, name, district, districtName: districtName(district) };
}

// The board: your deed (or the claim form), its legend + renown/rank, and the districts (with how
// built-up each is — the growing-world texture). Read-only; the client re-derives no game state.
export async function deedBoard(ch, client, h) {
  const deed = await loadDeed(client, ch.account_id);
  const history = deed ? await deedHistory(client, ch.account_id) : [];
  const renown = deedRenown(history);
  const counts = new Map();
  for (const r of (await client.query('SELECT district FROM street_deeds')).rows)
    counts.set(r.district, (counts.get(r.district) || 0) + 1);
  // Phase 4 — THE GROWING MAP: the city expands as users join. Neighborhoods open in order as the
  // living-player population crosses EXPANSION_STEP thresholds (§10.4-zero — pure render off the count).
  const population = await livingPlayers(client);
  const step = DEEDS.EXPANSION_STEP;
  let totalOpen = 0, totalHoods = 0;
  const hoodsFor = (d) => {
    const list = DEEDS.NEIGHBORHOODS[d] || [];
    const open = deedNeighborhoodsOpen(population, d);
    totalOpen += open; totalHoods += list.length;
    return { open: list.slice(0, open), coming: list.slice(open), openCount: open, total: list.length };
  };
  const districtHoods = Object.fromEntries(DISTRICTS.map((d) => [d.id, hoodsFor(d.id)]));
  const nextAt = (population - (population % step)) + step;   // players at which the next neighborhood opens
  const myHood = deed ? deedNeighborhoodOf(deed.name, deed.district, population) : null;
  // Phase 2 — CONTROL + THE CORNER TAKE. Your own deed: who controls it (you, or a rival who muscled in)
  // and the corner take you can collect while you do. Plus any RIVAL corners you currently control.
  const now = Date.now();
  const iControl = deed && deedController(deed, now) === ch.account_id;
  const seized = deed && deed.controller_account && deed.control_until && new Date(deed.control_until).getTime() > now
    && deed.controller_account !== ch.account_id; // a rival holds your corner
  const rivalCorners = (await client.query(
    'SELECT district, name, corner_at, control_until FROM street_deeds WHERE controller_account=$1 AND control_until > now()',
    [ch.account_id])).rows.map((r) => ({ district: r.district, districtName: districtName(r.district),
      name: r.name, owed: deedCornerOwed(r, now),
      controlSeconds: Math.max(0, Math.ceil((new Date(r.control_until).getTime() - now) / 1000)) }));
  const myOwed = deed && iControl ? deedCornerOwed(deed, now) : 0;
  // RIVAL corners on the block you're standing on — the marks you could lean on (the shakedown targets the
  // deed's OWNER, whose living character id the client passes). Excludes your own; flags ones you already run.
  const here = (await client.query(
    `SELECT d.name, d.controller_account, d.control_until, c.id AS char_id, c.name AS steward
       FROM street_deeds d JOIN characters c ON c.account_id = d.account_id AND c.alive
       WHERE d.district=$1 AND d.account_id <> $2`, [ch.loc, ch.account_id])).rows
    .map((r) => ({ street: r.name, targetId: r.char_id, steward: r.steward,
      mine: deedController(r, now) === ch.account_id }));
  const corner = {
    perHr: DEEDS.CORNER_PER_HR, capHours: DEEDS.CORNER_CAP_MS / 3600000,
    iControl: !!iControl, seized: !!seized,
    seizedForSeconds: seized ? Math.max(0, Math.ceil((new Date(deed.control_until).getTime() - now) / 1000)) : 0,
    owed: myOwed,                          // what you can collect off your OWN corner right now
    rivalCorners,                          // corners you muscled in on
    collectable: myOwed + rivalCorners.reduce((a, c) => a + c.owed, 0),
    here,                                  // rival corners at your current location you could shake down
    // you can reclaim your OWN seized corner if you're standing on the block (target your own character)
    canReclaim: !!seized && deed && String(ch.loc) === String(deed.district),
    myTargetId: ch.id,                     // the client targets this to reclaim your own corner
    shakedownMinLvl: DEEDS.SHAKEDOWN_MIN_LVL, shakedownEnergy: DEEDS.SHAKEDOWN_ENERGY,
  };
  // Phase 3 — THE MARKET: your own listing state + the streets currently for sale (a deedless buyer
  // browses these). One deed per account, so only a deedless account can buy — the "acquire a storied
  // street instead of a fresh block" entry. Two flat queries + a JS join (the /v1/gangs pg-mem posture).
  const forSaleRows = (await client.query(
    `SELECT d.account_id AS acct, d.name, d.district, d.sale_price, c.id AS seller_id, c.name AS seller
       FROM street_deeds d JOIN characters c ON c.account_id = d.account_id AND c.alive AND NOT c.is_npc
       WHERE d.sale_price IS NOT NULL AND d.account_id <> $1 ORDER BY d.sale_price ASC LIMIT 30`, [ch.account_id])).rows;
  // renown per for-sale deed — the whole-table group (the greatStreetsLeaderboard posture; pg-mem can't
  // do a correlated subquery or `= ANY`, and the legend IS the value a buyer is paying for)
  const forHist = new Map();
  for (const r of (await client.query('SELECT account_id, kind FROM street_deed_history')).rows)
    (forHist.get(r.account_id) || forHist.set(r.account_id, []).get(r.account_id)).push({ kind: r.kind });
  const forSale = forSaleRows.map((r) => ({ street: r.name, district: r.district, districtName: districtName(r.district),
    price: Number(r.sale_price), sellerId: r.seller_id, seller: r.seller,
    renown: deedRenown(forHist.get(r.acct) || []), rank: deedRankOf(deedRenown(forHist.get(r.acct) || [])).name,
    neighborhood: (deedNeighborhoodOf(r.name, r.district, population) || {}).name || null }));
  const market = {
    minPrice: DEEDS.MARKET_MIN,
    listed: !!(deed && deed.sale_price != null),
    salePrice: deed && deed.sale_price != null ? Number(deed.sale_price) : null,
    canBuy: !deed,                          // one deed per account → only a deedless player buys
    forSale,
  };
  return {
    deed: deed ? { name: deed.name, district: deed.district, districtName: districtName(deed.district),
      claimedAt: deed.claimed_at, neighborhood: myHood ? myHood.name : null, frontier: myHood ? myHood.frontier : false } : null,
    renown, rank: deedRankOf(renown).name, ranks: DEEDS.RANKS,
    history, corner, market,
    // Phase 4 — the growing map: how big the city is, and how much more opens as it grows
    city: { population, step, nextExpansionAt: nextAt, openNeighborhoods: totalOpen, totalNeighborhoods: totalHoods },
    districts: DISTRICTS.map((d) => ({ id: d.id, name: d.name, perk: d.perk, deeds: counts.get(d.id) || 0,
      neighborhoods: districtHoods[d.id] })),
    nameMin: DEEDS.NAME_MIN, nameMax: DEEDS.NAME_MAX,
    canClaim: !deed,
  };
}

// COLLECT THE CORNER TAKE — the bounded cash faucet on every deed you currently CONTROL (your own, if a
// rival hasn't muscled in, PLUS any rival corner you've seized). §10.4: `deed:corner` is a character_id'd
// cash faucet (the per-character cash check reconciles it); each deed's clock resets on collect (capped
// at 24h so an absent controller banks ≤ a day). Lock-clean: only the collector's own char is held
// (withCharacter); the deed rows are leaf writes locked FOR UPDATE, no other character is touched.
export async function collectCorner(ch, client, h) {
  // BALANCE D2, SIGNED — collecting is an EXPOSED act; a man to ground doesn't walk the district and
  // work his corner (the collectTerritory/collectBusiness/collectFrontier gate — a safehouse is a shield,
  // not a bunker). No jail/hosp gate: the corner take is passive and you can't safehouse from lockup.
  if (safeHoused(ch)) throw new GameError('safe', "Can't work the corner from a safehouse — it's a shield, not a bunker.");
  const now = Date.now();
  // every deed I effectively control: my own (when not seized) or a rival's inside my window
  const rows = (await client.query(
    `SELECT * FROM street_deeds WHERE account_id=$1 OR (controller_account=$1 AND control_until > now())
       ORDER BY account_id FOR UPDATE`, [ch.account_id])).rows;
  let total = 0; const collected = [];
  for (const d of rows) {
    if (deedController(d, now) !== ch.account_id) continue; // my own deed a rival currently holds → skip
    const owed = deedCornerOwed(d, now);
    if (owed <= 0) continue;
    ch.cash = Number(ch.cash) + owed;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: owed, reason: 'deed:corner' });
    await client.query('UPDATE street_deeds SET corner_at=now() WHERE account_id=$1', [d.account_id]);
    total += owed; collected.push({ name: d.name, district: d.district, owed });
  }
  if (total <= 0) throw new GameError('nothing', 'No corner take to collect yet.');
  await h.track(client, ch.account_id, 'deed_corner', { total, deeds: collected.length });
  return { ok: true, total, collected };
}

// THE SHAKEDOWN — muscle in on a rival's corner (or take your own back off a usurper). A stat contest
// (the territory/npcHit pattern — a probability from the attacker's edge, NO defender mutation, so it's
// lock-clean: only the attacker's char is held, the deed row is a leaf FOR UPDATE, the defender is read
// unlocked). A win seizes CONTROL for CONTROL_MS and FORFEITS the pending take (the seize precedent →
// corner_at resets). Moves control, not money → §10.4-neutral. Energy + heat win or lose; per-deed
// cooldown; you must stand at the deed's district (the location-pinned rule).
export async function shakedownCorner(ch, targetCharacterId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No street work from lockup.');
  if (safeHoused(ch)) throw new GameError('safe', "Can't lean on a corner while you're to ground — a safehouse is a shield, not a bunker.");
  if (hospitalized(ch)) throw new GameError('hosp_self', 'No leaning on anyone from a hospital bed.');
  if (levelOf(Number(ch.respect)) < DEEDS.SHAKEDOWN_MIN_LVL)
    throw new GameError('rookie', `Muscling a corner takes level ${DEEDS.SHAKEDOWN_MIN_LVL}.`);
  if (Number(ch.energy) < DEEDS.SHAKEDOWN_ENERGY) throw new GameError('energy', `Need ${DEEDS.SHAKEDOWN_ENERGY} energy for that.`);
  const target = (await client.query('SELECT account_id FROM characters WHERE id=$1', [targetCharacterId])).rows[0];
  if (!target) throw new GameError('gone', 'No such mark.');
  const deed = (await client.query('SELECT * FROM street_deeds WHERE account_id=$1 FOR UPDATE', [target.account_id])).rows[0];
  if (!deed) throw new GameError('no_deed', "They don't hold a street.");
  if (String(ch.loc) !== String(deed.district))
    throw new GameError('district', 'You have to be on the block to lean on the corner.', { district: deed.district });
  const now = Date.now();
  const controller = deedController(deed, now);
  if (controller === ch.account_id) throw new GameError('own', 'You already run this corner.');
  if (deed.account_id === ch.account_id && controller === ch.account_id)
    throw new GameError('own', 'This corner is already yours.');
  if (deed.shakedown_at && now - new Date(deed.shakedown_at).getTime() < DEEDS.SHAKEDOWN_CD_MS)
    throw new GameError('cooldown', 'That corner just changed hands — let the dust settle.');
  // the contest — attacker's effective muscle+cunning/2 vs the incumbent controller's base (read unlocked)
  const defender = (await client.query(
    'SELECT muscle, cunning FROM characters WHERE account_id=$1 AND alive ORDER BY id LIMIT 1', [controller])).rows[0]
    || { muscle: 10, cunning: 10 };
  const atk = effStat(Number(ch.muscle), 'muscle', h.owned.assets, h.owned.gear)
    + effStat(Number(ch.cunning), 'cunning', h.owned.assets, h.owned.gear) * 0.5 + Math.random() * 25;
  const def = Number(defender.muscle) + Number(defender.cunning) * 0.5 + Math.random() * 25;
  const p = Math.max(DEEDS.SHAKE_MIN_P, Math.min(DEEDS.SHAKE_MAX_P,
    DEEDS.SHAKE_BASE_P + (atk - def) / DEEDS.SHAKE_STAT_SCALE));
  const pEff = process.env.DEEDS_SHAKE_P != null ? Number(process.env.DEEDS_SHAKE_P) : p; // TEST-ONLY roll knob
  const win = Math.random() < pEff;
  ch.energy = Number(ch.energy) - DEEDS.SHAKEDOWN_ENERGY;
  ch.heat = Math.min(100, Number(ch.heat || 0) + DEEDS.SHAKEDOWN_HEAT);
  await h.rngLog(client, ch.id, `deed_shakedown:${deed.account_id}`, Math.round(atk * 100) / 100, win ? 'win' : 'loss');
  await client.query('UPDATE street_deeds SET shakedown_at=now() WHERE account_id=$1', [deed.account_id]);
  if (!win) {
    await h.notify(client, targetCharacterId, 'corner_defended', { from: ch.name, street: deed.name });
    return { ok: true, won: false, street: deed.name };
  }
  // seize CONTROL: a rival usurper OR the owner reclaiming their own corner. Pending take FORFEITS
  // (the seize precedent) — corner_at resets, so the new controller accrues fresh.
  const reclaim = deed.account_id === ch.account_id;
  await client.query(
    'UPDATE street_deeds SET controller_account=$2, control_until=$3, corner_at=now() WHERE account_id=$1',
    [deed.account_id, reclaim ? null : ch.account_id, reclaim ? null : new Date(now + DEEDS.CONTROL_MS)]);
  await h.notify(client, targetCharacterId, 'corner_seized', { from: ch.name, street: deed.name });
  await h.track(client, ch.account_id, 'deed_shakedown', { street: deed.name, reclaim });
  return { ok: true, won: true, street: deed.name, reclaim,
    controlHours: reclaim ? null : DEEDS.CONTROL_MS / 3600000 };
}

// ══════════ Phase 3 — THE SECONDARY MARKET (off-chain core) ══════════
// LIST your street for sale (cash). No escrow — the deed stays yours until a buyer takes it (the car-auction
// row-stays precedent); you keep collecting the corner while listed. Jail-gated (no dealing from lockup).
export async function listDeed(ch, price, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No dealing from lockup.');
  const deed = await loadDeed(client, ch.account_id);
  if (!deed) throw new GameError('no_deed', "You don't hold a street to sell.");
  const p = Math.floor(Number(price) || 0);
  if (!Number.isFinite(p) || p < DEEDS.MARKET_MIN)
    throw new GameError('min_price', `The floor for a street is $${DEEDS.MARKET_MIN.toLocaleString()}.`);
  await client.query('UPDATE street_deeds SET sale_price=$2 WHERE account_id=$1', [ch.account_id, p]);
  return { ok: true, name: deed.name, price: p };
}
// PULL your street off the market.
export async function unlistDeed(ch, client, h) {
  const deed = await loadDeed(client, ch.account_id);
  if (!deed) throw new GameError('no_deed', "You don't hold a street.");
  if (deed.sale_price == null) throw new GameError('not_listed', "It's not for sale.");
  await client.query('UPDATE street_deeds SET sale_price=NULL WHERE account_id=$1', [ch.account_id]);
  return { ok: true, name: deed.name };
}
// BUY a listed street. Two-party (withTwoCharacters buyer+seller). The buyer must be DEEDLESS (one deed
// per account — the identity/Sybil model; a portfolio of many streets is a deferred Phase-3 step needing
// the PK refactor). The deed + its whole PROVENANCE (the legend) transfer to the buyer; CONTROL RESETS
// (the identity-NFT lesson — the paper + legend travel, the corner-take control does NOT, the buyer must
// shake for it). §10.4: `deed:sale` is the audited bodyguard:hire non-escrow taxed transfer — seller nets
// 98% (1% dev off-ledger + 1% street tax → buyback), riding the existing `deed:` cash prefix.
export async function buyDeed(buyer, seller, client, h) {
  if (jailed(buyer)) throw new GameError('jailed', 'No dealing from lockup.');
  if (buyer.account_id === seller.account_id) throw new GameError('own', "That's your own street.");
  if (await loadDeed(client, buyer.account_id)) throw new GameError('have_deed', 'You already hold a street — sell it before buying another.');
  const deed = (await client.query('SELECT * FROM street_deeds WHERE account_id=$1 FOR UPDATE', [seller.account_id])).rows[0];
  if (!deed || deed.sale_price == null) throw new GameError('not_listed', "That street isn't for sale.");
  const price = Number(deed.sale_price);
  if (Number(buyer.cash) < price) throw new GameError('cash', `That street runs $${price.toLocaleString()}.`);
  // the standard 2% house take (1% dev off-ledger + 1% street tax → buyback) — the bodyguard:hire pattern
  const fee = Math.ceil(price * DEEDS.SALE_FEE_BPS / 10000), tax = Math.ceil(price * DEEDS.SALE_TAX_BPS / 10000);
  const net = price - fee - tax;
  buyer.cash = Number(buyer.cash) - price;
  seller.cash = Number(seller.cash) + net;
  await h.ledger(client, { characterId: buyer.id, currency: 'cash', amount: -price, reason: 'deed:sale', counterparty: seller.id });
  await h.ledger(client, { characterId: seller.id, currency: 'cash', amount: net, reason: 'deed:sale', counterparty: buyer.id });
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [tax]);
  // TRANSFER the deed + re-key its provenance to the buyer; control RESETS (the buyer earns the corner).
  await client.query(
    `UPDATE street_deeds SET account_id=$2, sale_price=NULL, controller_account=NULL, control_until=NULL, corner_at=now()
       WHERE account_id=$1`, [seller.account_id, buyer.account_id]);
  await client.query('UPDATE street_deed_history SET account_id=$2 WHERE account_id=$1', [seller.account_id, buyer.account_id]);
  await recordDeedEvent(client, buyer.account_id, 'sold', `${seller.name} sold the street to ${buyer.name} for $${price.toLocaleString()}`);
  await h.notify(client, seller.id, 'deed_sold', { street: deed.name, to: buyer.name, price });
  await h.track(client, buyer.account_id, 'deed_buy', { street: deed.name, price });
  return { ok: true, street: deed.name, price, net };
}

// THE GREAT STREETS — the status leaderboard, ranked by a deed's legend (renown). Two flat queries +
// a JS aggregate (the /v1/gangs pg-mem posture — no correlated subquery, no `= ANY`). Living steward
// named; agents excluded (the leaderboard posture). Pure status, moves nothing.
export async function greatStreetsLeaderboard(pool) {
  const deeds = (await pool.query(
    `SELECT d.account_id, d.name, d.district, c.name AS steward FROM street_deeds d
       JOIN account_persistent ap ON ap.account_id = d.account_id AND NOT ap.agent_flag
       JOIN characters c ON c.account_id = d.account_id AND c.alive`)).rows;
  const hist = new Map();
  for (const r of (await pool.query('SELECT account_id, kind FROM street_deed_history')).rows)
    (hist.get(r.account_id) || hist.set(r.account_id, []).get(r.account_id)).push({ kind: r.kind });
  const ranked = deeds.map((d) => {
    const renown = deedRenown(hist.get(d.account_id) || []);
    return { name: d.name, district: d.district, districtName: districtName(d.district),
      steward: d.steward, renown, rank: deedRankOf(renown).name };
  }).sort((a, b) => b.renown - a.renown || String(a.name).localeCompare(String(b.name))).slice(0, 15);
  return { streets: ranked.map((s, i) => ({ pos: i + 1, ...s })) };
}

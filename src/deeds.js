// STREET DEEDS — the map as property (omerta-street-deeds-design.md). A named, mapped plot of the
// world a player OWNS and builds a legend on — the Monopoly layer. Phase 1 is PURE STATUS: the deed,
// its name, its map plot and its provenance are all status, so NO `transactions` row is ever written,
// the reason vocabulary is unchanged, and the nightly §10.4 sweep stays drift-0 BY CONSTRUCTION (the
// test asserts zero ledger rows across the whole flow — the portrait/dynasty/estate precedent).
//
// ACCOUNT-level (keyed on account_id) → SURVIVES DEATH: your characters die, the street stays yours;
// the heir inherits it (outside the runEstate wipe by construction — the death-disposition guard scans
// character_id-keyed tables, never account_id-keyed ones). CONTROL — rent (B, the corner take) and
// turf (C, the controller's perks — Phase 2C, loaded in game.js/loadOwned and OR'd with family turf
// at the perk sites) — is earned and defended IN-GAME; the on-chain tradeable token is Phase 3.
// Deliberately NOT wired into the live mint / the `minted` extraction flag,
// so the Sybil/extraction machinery is untouched (design §8).
import { GameError, cleanText } from './game.js';
import { vaultHistoryFor, vaultLiveBalances } from './stockdeliver.js';
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
  const acct = (await client.query('SELECT minted, wallet_address FROM account_persistent WHERE account_id=$1', [ch.account_id])).rows[0] || {};
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
      // 2C — controlling a rival's corner carries that district's turf perk too (the control split)
      perk: DEEDS.PERK_TURF ? ((DISTRICTS.find((d) => d.id === r.district) || {}).perk || null) : null,
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
    // Phase 2C — THE CONTROLLER'S PERKS. While YOU run your own corner: the district's signed turf
    // perk (OR'd with family turf — never stacks) + one extra operation seat (capped at SLOTS_MAX).
    // A rival who muscles in takes the perk with the corner; an on-chain deed perks nobody (inert).
    perkText: DEEDS.PERK_TURF && deed ? ((DISTRICTS.find((d) => d.id === deed.district) || {}).perk || null) : null,
    perkActive: !!(DEEDS.PERK_TURF && deed && iControl && !deed.onchain_token_id),
    seatBonus: DEEDS.PERK_OP_SLOTS,
    seatActive: !!(DEEDS.PERK_OP_SLOTS && deed && iControl && !deed.onchain_token_id),
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
  // THE VAULT'S RECORD — a street's ERC-6551 account is keyed on its NAME (tokenId = keccak(name)), so
  // it survives a burn and travels with the name: re-import a street, sell it, and the buyer's next
  // extraction resolves the SAME vault. So every listing states what that vault has RECEIVED, and a
  // buyer prices it (the terms ride with the price). Never "holds" — the owner controls the account and
  // can empty it; the live figure is the buy-CONFIRM read (`deedVault`), never this polled board.
  const vaults = await vaultHistoryFor(client, [...forSaleRows.map((r) => r.name), ...(deed ? [deed.name] : [])]);
  const forSale = forSaleRows.map((r) => ({ street: r.name, district: r.district, districtName: districtName(r.district),
    price: Number(r.sale_price), sellerId: r.seller_id, seller: r.seller,
    renown: deedRenown(forHist.get(r.acct) || []), rank: deedRankOf(deedRenown(forHist.get(r.acct) || [])).name,
    vault: vaults.get(r.name) || null,
    neighborhood: (deedNeighborhoodOf(r.name, r.district, population) || {}).name || null }));
  const market = {
    minPrice: DEEDS.MARKET_MIN,
    listed: !!(deed && deed.sale_price != null),
    salePrice: deed && deed.sale_price != null ? Number(deed.sale_price) : null,
    canBuy: !deed,                          // one deed per account → only a deedless player buys
    forSale,
  };
  // Phase 3 (on-chain) — THE TRADEABLE NFT. A minted account with a linked wallet EXTRACTS its deed as a
  // StreetDeed ERC-721 (chain.js requestDeedWithdraw), tradeable on any marketplace. It goes INERT in-game
  // (the car/boat precedent — no rent/control) until someone RE-IMPORTS it (burns it back). `extractPending`
  // = a voucher signed, not yet claimed on-chain (still inert; the account can't claim a new street yet).
  const chain = {
    configured: !!(process.env.STREET_DEED_ADDRESS && process.env.CHAIN_ID),
    minted: !!acct.minted, walletLinked: !!acct.wallet_address,
    extractPending: !!(deed && deed.onchain_token_id),
    tokenId: deed && deed.onchain_token_id ? deed.onchain_token_id : null,
    canExtract: !!(deed && !deed.onchain_token_id && deed.sale_price == null && acct.minted && acct.wallet_address
      && process.env.STREET_DEED_ADDRESS && process.env.CHAIN_ID),
  };
  return {
    deed: deed ? { name: deed.name, district: deed.district, districtName: districtName(deed.district),
      claimedAt: deed.claimed_at, neighborhood: myHood ? myHood.name : null, frontier: myHood ? myHood.frontier : false,
      onChain: !!deed.onchain_token_id, vault: vaults.get(deed.name) || null } : null,
    renown, rank: deedRankOf(renown).name, ranks: DEEDS.RANKS,
    history, corner, market, chain,
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
  // `onchain_token_id IS NULL` excludes a deed that's extracted or extraction-pending — an on-chain deed
  // is INERT in-game (the car/boat precedent), so it generates no corner take until it's re-imported.
  const rows = (await client.query(
    `SELECT * FROM street_deeds WHERE (account_id=$1 OR (controller_account=$1 AND control_until > now()))
       AND onchain_token_id IS NULL ORDER BY account_id FOR UPDATE`, [ch.account_id])).rows;
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
  if (deed.onchain_token_id) throw new GameError('onchain', "That street is on-chain — there's no corner to muscle until someone brings it back into the city.");
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
  if (deed.onchain_token_id) throw new GameError('onchain', "That street is on-chain — trade the NFT on a marketplace, or re-import it first.");
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
// THE BUY-CONFIRM VAULT READ — what a listed street's vault has received, and (chain live) what it
// holds RIGHT NOW. Two halves on purpose: the RECORD is a DB read the board already carries, and the
// LIVE balance is an RPC round-trip that must run OUTSIDE the read transaction (an RPC inside a held
// txn pins a pooled connection for as long as the node takes — the bankPosition posture), which is
// also why it sits at the confirm step and not on the polled board.
//
// Keyed on the SELLER's character exactly like `buyDeed`, so the number a buyer confirms against and
// the street they actually buy are resolved by the same lookup — a confirm screen that could describe
// a different deed than the purchase is the control-that-lies class.
export async function deedVaultRecord(client, ch, sellerCharacterId) {
  const seller = (await client.query('SELECT account_id, name FROM characters WHERE id=$1', [String(sellerCharacterId)])).rows[0];
  if (!seller) throw new GameError('gone', 'That street has no living steward.');
  const deed = (await client.query('SELECT name, sale_price FROM street_deeds WHERE account_id=$1', [seller.account_id])).rows[0];
  if (!deed) throw new GameError('no_deed', "They don't hold a street.");
  const vault = (await vaultHistoryFor(client, [deed.name])).get(deed.name) || null;
  return { street: deed.name, seller: seller.name,
    price: deed.sale_price == null ? null : Number(deed.sale_price), vault };
}
// The live half, run outside the transaction (see above). Chain-dormant → `live: false`, never a
// fabricated zero — "we can't see the vault" and "the vault is empty" are different answers.
export async function deedVaultLive(street) {
  return vaultLiveBalances(street).catch(() => ({ live: false, holds: [] }));
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

// ══════════ THE ON-CHAIN NFT — the block plate (image) + the legend page (external_url) ══════════
// The StreetDeed tokenURI is on-chain (name + district), but the IMAGE and the "see its full history"
// link are off-chain because the block plate and the LIVE legend grow with play. These render them.

// Look up an extracted (or on-chain) deed by its tokenId (onchain_token_id, keccak(name)). The row
// persists through extraction (re-keyed to `onchain:<token>`) so the plate/page resolve while it's a
// tradeable NFT. Returns { name, district, renown } or null (burned/re-imported → the NFT no longer exists).
export async function deedByToken(pool, tokenId) {
  const d = (await pool.query('SELECT account_id, name, district FROM street_deeds WHERE onchain_token_id=$1', [String(tokenId)])).rows[0];
  if (!d) return null;
  const hist = (await pool.query('SELECT kind, detail, at FROM street_deed_history WHERE account_id=$1 ORDER BY at DESC LIMIT $2', [d.account_id, DEEDS.HISTORY_MAX])).rows;
  return { name: d.name, district: d.district, districtName: districtName(d.district),
    renown: deedRenown(hist), rank: deedRankOf(deedRenown(hist)).name,
    history: hist.map((r) => ({ kind: r.kind, detail: r.detail || '', at: r.at })) };
}

// esc — the two-byte structural escape for a public, keyless, marketplace-fetched document (the
// avatar.js/portrait.js discipline; the name is already cleanText-stripped of < > " at claim).
const esc = (s) => String(s == null ? '' : s).replace(/[<>&"']/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

// THE BLOCK PLATE — the deed NFT's image. A DRAWN noir street sign, deterministic from the name (no
// Math.random → stable forever), the text escaped. Reads like the map plaque a Monopoly deed carries.
export function deedPlateSvg({ name, district, districtName: dn, rank } = {}) {
  const nm = esc(String(name || 'A Street of the City'));
  const dist = esc(String(dn || district || ''));
  const rk = esc(String(rank || ''));
  // deterministic accent hue from the name (FNV-1a)
  let h = 2166136261 >>> 0;
  for (const c of String(name || '')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const hue = h % 360;
  const long = nm.length > 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0c0b0d"/><stop offset="1" stop-color="#17141a"/>
    </linearGradient>
    <linearGradient id="sign" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="hsl(${hue},42%,26%)"/><stop offset="1" stop-color="hsl(${hue},46%,18%)"/>
    </linearGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="7"/></filter>
  </defs>
  <rect width="1000" height="1000" fill="url(#bg)"/>
  <!-- a low skyline silhouette -->
  <g fill="#000" opacity="0.55">
    <rect x="0" y="820" width="120" height="180"/><rect x="130" y="760" width="90" height="240"/>
    <rect x="235" y="800" width="70" height="200"/><rect x="320" y="700" width="110" height="300"/>
    <rect x="450" y="780" width="80" height="220"/><rect x="545" y="720" width="130" height="280"/>
    <rect x="690" y="800" width="70" height="200"/><rect x="775" y="750" width="100" height="250"/>
    <rect x="885" y="810" width="115" height="190"/>
  </g>
  <!-- the sign post -->
  <rect x="486" y="470" width="28" height="360" rx="6" fill="#2a2530"/>
  <rect x="493" y="470" width="6" height="360" fill="#3a3442"/>
  <!-- the street-name sign -->
  <g transform="translate(500,300)">
    <rect x="-430" y="-70" width="860" height="150" rx="14" fill="url(#sign)" stroke="hsl(${hue},50%,40%)" stroke-width="3"/>
    <rect x="-418" y="-58" width="836" height="126" rx="10" fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="2"/>
    <text x="0" y="12" text-anchor="middle" fill="#f4f1ea" font-family="Georgia,'Times New Roman',serif"
      font-weight="700" font-size="${long ? 62 : 78}" letter-spacing="2" style="text-transform:uppercase">${nm}</text>
  </g>
  <!-- district + rank plaque -->
  <text x="500" y="470" text-anchor="middle" fill="hsl(${hue},30%,66%)" font-family="Georgia,serif"
    font-size="34" letter-spacing="6" style="text-transform:uppercase">${dist}</text>
  ${rk ? `<text x="500" y="700" text-anchor="middle" fill="#8a8290" font-family="Georgia,serif" font-size="30" letter-spacing="3" style="font-style:italic">${rk}</text>` : ''}
  <!-- the house mark -->
  <text x="500" y="930" text-anchor="middle" fill="#6a6472" font-family="Georgia,serif" font-size="26"
    letter-spacing="10">OMERTÀ · STREET DEED</text>
</svg>`;
}

// THE LEGEND PAGE — the deed NFT's external_url. A minimal public page showing the street, its district,
// and its provenance (the value). Escaped; keyless. Points into the game. Robust to a burned/unknown token.
export function deedPage(deed, { gameUrl } = {}) {
  const url = String(gameUrl || 'https://www.omerta.fun');
  if (!deed) {
    return `<!doctype html><meta charset="utf-8"><title>A Street of OMERTÀ</title>
<body style="background:#0c0b0d;color:#c9c3d0;font-family:Georgia,serif;text-align:center;padding:80px">
<h1 style="color:#f4f1ea">A Street of OMERTÀ</h1><p>This deed is not on-chain right now.</p>
<p><a href="${esc(url)}" style="color:#c99">Enter the city →</a></p></body>`;
  }
  const rows = (deed.history || []).slice(0, 20).map((e) =>
    `<li><b style="color:hsl(280,20%,70%)">${esc(e.kind)}</b> &mdash; ${esc(e.detail || '')}</li>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>${esc(deed.name)} — OMERTÀ</title>
<meta property="og:title" content="${esc(deed.name)} — a Street of OMERTÀ">
<meta property="og:description" content="${esc(deed.districtName || deed.district)} · ${esc(deed.rank)}. Property with a history.">
<body style="background:#0c0b0d;color:#c9c3d0;font-family:Georgia,serif;max-width:720px;margin:0 auto;padding:48px 20px">
<div style="text-align:center;border-bottom:1px solid #2a2530;padding-bottom:24px">
  <h1 style="color:#f4f1ea;letter-spacing:2px;text-transform:uppercase;margin:0">${esc(deed.name)}</h1>
  <p style="color:#8a8290;letter-spacing:4px;text-transform:uppercase;margin:8px 0">${esc(deed.districtName || deed.district)}</p>
  <p style="color:#a99;font-style:italic">${esc(deed.rank)}</p>
</div>
<h2 style="color:#c9c3d0;font-size:18px;letter-spacing:2px;text-transform:uppercase">The record on this block</h2>
<ul style="line-height:1.9;color:#b0aab8">${rows || '<li>Nothing has happened here yet.</li>'}</ul>
<p style="text-align:center;margin-top:40px"><a href="${esc(url)}" style="color:#c99;letter-spacing:2px">ENTER THE CITY →</a></p>
<p style="text-align:center;color:#555;font-size:13px">A Street Deed — property with a history. The market sets its price; the story is player-made.</p>
</body>`;
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

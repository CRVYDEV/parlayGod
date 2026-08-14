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
import { DEEDS, DISTRICTS, deedRankOf, deedRenown } from './rules.js';

// rules.js doesn't export a district-name helper (hustle.js/citymap.js keep it local), so map it here.
const districtName = (id) => (DISTRICTS.find((d) => d.id === id) || {}).name || id;

async function loadDeed(client, accountId) {
  return (await client.query(
    'SELECT account_id, name, district, claimed_at FROM street_deeds WHERE account_id=$1', [accountId])).rows[0] || null;
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
    await client.query('INSERT INTO street_deeds (account_id, name, name_lc, district) VALUES ($1,$2,$3,$4)',
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
  return {
    deed: deed ? { name: deed.name, district: deed.district, districtName: districtName(deed.district),
      claimedAt: deed.claimed_at } : null,
    renown, rank: deedRankOf(renown).name, ranks: DEEDS.RANKS,
    history,
    districts: DISTRICTS.map((d) => ({ id: d.id, name: d.name, perk: d.perk, deeds: counts.get(d.id) || 0 })),
    nameMin: DEEDS.NAME_MIN, nameMax: DEEDS.NAME_MAX,
    canClaim: !deed,
  };
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

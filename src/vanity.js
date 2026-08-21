// M8 — the TAILOR & ENGRAVER: the vanity/identity shop. Every purchase here is pure STATUS —
// display-only, no stat, no formula, no gameplay power — so nothing touches the sim-audited
// balance, and the only §10.4 flow is the enumerated 'vanity:*' $OMR burn itself (account
// bucket → burn, exactly like cleanpapers / path switches). Prices live in rules.js VANITY —
// new/tunable, founder sign-off before production.
//
// Rename side-effects, all verified benign: bounties/searches/contracts/kill_log/listings key
// on character or account IDs (a new name dodges nothing); heirs inherit the CURRENT name at
// estate time (the bloodline follows the rename); the one real consequence is that a referral
// code IS the recruiter's living character name (§7.13), so renaming rotates your code — the
// old one simply stops resolving, which mints nothing and strands nobody already qualified.
import { GameError, cleanText } from './game.js';
import { VANITY, GANG_SEALS, sealOf, FOUNDATION, foundationOf, carOf } from './rules.js';

// The one till: gate on the account's $OMR, debit in-memory (persistAccount commits it),
// ledger the burn. An unknown reason is itself an invariant alert, so every item gets an
// enumerated reason. Exported — the M8 sinks outside this shop (board anonymity, intel peek,
// respec) pay through the same till so the burn discipline lives in exactly one place.
export async function spendOmr(client, h, cost, reason) {
  // defense-in-depth (red-team R3): this is the single $OMR burn primitive — a negative/NaN cost would pass
  // the `omr < cost` check and then ADD $OMR (a §10.4 mint). Every caller passes a positive constant/validated
  // amount today, but guard the primitive so a future caller can never invert it.
  if (!(Number.isFinite(cost) && cost > 0)) throw new GameError('amount', 'Invalid amount.');
  if (Number(h.acct.omr) < cost) throw new GameError('omr', `That costs ${cost} $OMR. Come back flush.`);
  h.acct.omr = Number(h.acct.omr) - cost;
  await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: -cost, reason });
}

// A new street name. Same rules as creation (2–24 chars, unique among the living — referral
// codes resolve by name, §7.13; the partial unique index ux_char_name_alive is the race
// backstop). persistCharacter never writes `name`, so the direct UPDATE cannot be clobbered.
export async function changeName(ch, name, client, h) {
  name = cleanText(name).trim().slice(0, 24); // strip HTML-injection chars (stored-XSS fix, R6)
  if (name.length < 2) throw new GameError('name', 'Pick a name (2–24 chars).');
  if (!/^[\w .,'&-]+$/.test(name)) throw new GameError('name', 'Letters, numbers and simple punctuation only (no look-alike unicode).'); // R8: no homoglyph impersonation
  if (name === ch.name) throw new GameError('name', "That's already what they call you.");
  const clash = await client.query('SELECT 1 FROM characters WHERE name=$1 AND alive AND id<>$2', [name, ch.id]);
  if (clash.rows.length) throw new GameError('name_taken', 'Someone on the streets already goes by that name.');
  await spendOmr(client, h, VANITY.NAME_CHANGE_OMR, 'vanity:name');
  await client.query('UPDATE characters SET name=$2 WHERE id=$1', [ch.id, name]);
  const was = ch.name;
  ch.name = name;
  await h.track(client, ch.account_id, 'vanity_name', { was, now: name });
  return { ok: true, name, referralCodeChanged: true };
}

// A custom title — it lives in the SAME display slot the mission titles use (characters.title),
// and buying one overwrites what's there: your identity, your call. Clearing it back to nothing
// is free (we sell ink, not ransom).
export async function setTitle(ch, title, client, h) {
  const t = cleanText(title).replace(/\s+/g, ' ').trim().slice(0, VANITY.TITLE_MAX); // stored-XSS fix (R6)
  if (!t) { ch.title = null; return { ok: true, title: null }; }
  await spendOmr(client, h, VANITY.TITLE_OMR, 'vanity:title');
  ch.title = t;
  return { ok: true, title: t };
}

// A vanity plate for one car in the garage (2–8 chars, letters/digits/space/dash, engraved
// uppercase). The car must actually be yours — h.owned.cars is this transaction's loaded fleet.
export async function setPlate(ch, carId, plate, client, h) {
  const car = (h.owned.cars || []).find((c) => c.id === carId);
  if (!car) throw new GameError('no_car', 'No such car in your garage.');
  const p = String(plate || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!/^[A-Z0-9 -]{2,8}$/.test(p) || p.length > VANITY.PLATE_MAX)
    throw new GameError('plate', `A plate is 2–${VANITY.PLATE_MAX} characters: letters, digits, space, dash.`);
  await spendOmr(client, h, VANITY.PLATE_OMR, 'vanity:plate');
  await client.query('UPDATE cars SET plate=$2 WHERE id=$1', [carId, p]);
  car.plate = p; // keep this transaction's view fresh
  // The CAR's name ships with the reply because describe() has no handle on the garage: it sees a
  // carId and nothing that can turn one into iron. The price ships for the same reason every other
  // $OMR burn in this file ships one. NOTE `model_id`, not `model`: h.owned.cars holds RAW `cars`
  // rows, and it is the character VIEW that renames that column — reading `model` here is silently
  // undefined and degrades the line to a bare plate, which is the class this reply exists to close.
  return { ok: true, carId, plate: p, car: carOf(car.model_id)?.name || null, omr: VANITY.PLATE_OMR };
}

// The family crest color — the boss's call alone (an underboss commands soldiers, not the flag).
export async function recolorGang(ch, color, client, h) {
  if (h.owned.gangRole !== 'boss') throw new GameError('rank', 'Only the boss picks the family colors.');
  const c = String(color || '').trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(c)) throw new GameError('color', "A crest color is '#rrggbb'.");
  await spendOmr(client, h, VANITY.GANG_COLOR_OMR, 'vanity:gang:color');
  await client.query('UPDATE gangs SET color=$2 WHERE id=$1', [h.owned.gangId, c]);
  if (h.owned.gang) h.owned.gang.color = c;
  return { ok: true, color: c };
}

// M8 — THE FAMILY SEAL: the gang-prestige ladder, bought SEQUENTIALLY by the boss from the
// family's $OMR RESERVE (not the boss's pocket — spendOmr doesn't apply here; the reserve is
// its own §10.4 bucket, so the burn is ledgered directly against it, and 'vanity:%' already
// covers it in the invariant job's burn term). The reserve fills from buyback winnings, weekly
// bonuses, and member $OMR tribute — so the seal is the family's achievement, pooled and paid
// for together. Display-only: a badge, never a buff.
export async function buySeal(ch, client, h) {
  if (h.owned.gangRole !== 'boss') throw new GameError('rank', 'Only the boss commissions the family seal.');
  // lock the gang row: seal tier + reserve read-and-spend must be atomic under concurrent buys
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  const next = GANG_SEALS.find((s) => s.tier === Number(g.seal || 0) + 1);
  if (!next) throw new GameError('maxed', 'The family already bears the highest seal there is.');
  if (Number(g.omr_reserve) < next.omr)
    throw new GameError('reserve', `The ${next.name} takes ${next.omr} $OMR from the family reserve (${Math.floor(Number(g.omr_reserve))} on hand). Tribute $OMR to fill it.`);
  await client.query('UPDATE gangs SET omr_reserve = omr_reserve - $2, seal = $3 WHERE id=$1', [g.id, next.omr, next.tier]);
  await h.ledger(client, { currency: 'omr', amount: -next.omr, reason: 'vanity:gang:seal', counterparty: g.id });
  if (h.owned.gang) { h.owned.gang.seal = next.tier; h.owned.gang.omr_reserve = Number(g.omr_reserve) - next.omr; }
  await h.track(client, ch.account_id, 'gang_seal', { tier: next.tier, omr: next.omr });
  return { ok: true, seal: { tier: next.tier, name: next.name }, reserve: Number(g.omr_reserve) - next.omr,
           nextSeal: sealOf(next.tier + 1) || null };
}

// ── THE FOUNDATION — the family charity: a tiered institution bought SEQUENTIALLY by the boss/
// underboss from the family $OMR reserve (the buySeal precedent, exactly). Public philanthropy STATUS
// (gangs.foundation) AND it launders the family's collective RICO exposure — every member's conviction
// odds × the tier's bustMult (read in bustProbOf). A NEW Law lever, not pure vanity — its own ledger
// reason ('foundation:tier') so the audit trail stays legible; still a $OMR burn against the reserve.
export async function buyFoundation(ch, client, h) {
  if (h.owned.gangRole !== 'boss' && h.owned.gangRole !== 'underboss')
    throw new GameError('rank', 'Only the boss or underboss endows the family foundation.');
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  if (!g) throw new GameError('gang', 'No family to endow.');
  const next = FOUNDATION.TIERS.find((t) => t.tier === Number(g.foundation || 0) + 1);
  if (!next) throw new GameError('maxed', 'The family is already the highest pillar of the community there is.');
  if (Number(g.omr_reserve) < next.omr)
    throw new GameError('reserve', `The ${next.name} takes ${next.omr} $OMR from the family reserve (${Math.floor(Number(g.omr_reserve))} on hand). Tribute $OMR to fill it.`);
  await client.query('UPDATE gangs SET omr_reserve = omr_reserve - $2, foundation = $3 WHERE id=$1', [g.id, next.omr, next.tier]);
  await h.ledger(client, { currency: 'omr', amount: -next.omr, reason: 'foundation:tier', counterparty: g.id });
  if (h.owned.gang) { h.owned.gang.foundation = next.tier; h.owned.gang.omr_reserve = Number(g.omr_reserve) - next.omr; }
  await h.track(client, ch.account_id, 'gang_foundation', { tier: next.tier, omr: next.omr });
  return { ok: true, foundation: { tier: next.tier, name: next.name, bustMult: next.bustMult },
           reserve: Number(g.omr_reserve) - next.omr, nextFoundation: foundationOf(next.tier + 1) || null };
}

// The philanthropy board — families ranked by their FOUNDATION tier (a STATUS leaderboard, the
// hitmen/portfolio-board precedent). Two flat queries (pg-mem can't do the correlated count).
export async function foundationLeaderboard(pool) {
  const rows = (await pool.query(
    'SELECT id, name, tag, foundation FROM gangs WHERE foundation > 0 ORDER BY foundation DESC, name ASC LIMIT 25')).rows;
  return { board: rows.map((g) => ({ name: g.name, tag: g.tag, tier: Number(g.foundation),
    foundation: foundationOf(g.foundation)?.name || null })) };
}

// Family rename/retag — founding-rules validation (name 3–24, tag 2–4 A–Z/0–9) and the same
// uniqueness check, excluding ourselves. Pass either field or both; omitted = unchanged.
export async function renameGang(ch, name, tag, client, h) {
  if (h.owned.gangRole !== 'boss') throw new GameError('rank', 'Only the boss renames the family.');
  const newName = name != null ? cleanText(name).trim() : null; // stored-XSS fix (R6)
  const newTag = tag != null ? String(tag).trim().toUpperCase() : null;
  if (newName == null && newTag == null) throw new GameError('nothing', 'Give the engraver a name or a tag.');
  if (newName != null && (newName.length < 3 || newName.length > 24)) throw new GameError('name', 'Family name must be 3–24 characters.');
  if (newName != null && !/^[\w .,'&-]+$/.test(newName)) throw new GameError('name', 'Family name: letters, numbers and simple punctuation only (no look-alike unicode).'); // R8
  if (newTag != null && !/^[A-Z0-9]{2,4}$/.test(newTag)) throw new GameError('tag', 'Tag must be 2–4 letters or numbers.');
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  const finalName = newName ?? g.name, finalTag = newTag ?? g.tag;
  const clash = await client.query('SELECT id FROM gangs WHERE (name=$1 OR tag=$2) AND id<>$3', [finalName, finalTag, h.owned.gangId]);
  if (clash.rows.length) throw new GameError('taken', 'That name or tag is already claimed.');
  await spendOmr(client, h, VANITY.GANG_RENAME_OMR, 'vanity:gang:name');
  await client.query('UPDATE gangs SET name=$2, tag=$3 WHERE id=$1', [h.owned.gangId, finalName, finalTag]);
  if (h.owned.gang) { h.owned.gang.name = finalName; h.owned.gang.tag = finalTag; }
  await h.track(client, ch.account_id, 'vanity_gang_name', { was: g.name, now: finalName });
  return { ok: true, name: finalName, tag: finalTag };
}

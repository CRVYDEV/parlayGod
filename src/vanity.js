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
import { GameError } from './game.js';
import { VANITY } from './rules.js';

// The one till: gate on the account's $OMR, debit in-memory (persistAccount commits it),
// ledger the burn. An unknown reason is itself an invariant alert, so every item gets an
// enumerated 'vanity:*' reason.
async function spendOmr(client, h, cost, reason) {
  if (Number(h.acct.omr) < cost) throw new GameError('omr', `The Tailor's price is ${cost} $OMR. Come back flush.`);
  h.acct.omr = Number(h.acct.omr) - cost;
  await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: -cost, reason });
}

// A new street name. Same rules as creation (2–24 chars, unique among the living — referral
// codes resolve by name, §7.13; the partial unique index ux_char_name_alive is the race
// backstop). persistCharacter never writes `name`, so the direct UPDATE cannot be clobbered.
export async function changeName(ch, name, client, h) {
  name = String(name || '').trim().slice(0, 24);
  if (name.length < 2) throw new GameError('name', 'Pick a name (2–24 chars).');
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
  const t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, VANITY.TITLE_MAX);
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
  return { ok: true, carId, plate: p };
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

// Family rename/retag — founding-rules validation (name 3–24, tag 2–4 A–Z/0–9) and the same
// uniqueness check, excluding ourselves. Pass either field or both; omitted = unchanged.
export async function renameGang(ch, name, tag, client, h) {
  if (h.owned.gangRole !== 'boss') throw new GameError('rank', 'Only the boss renames the family.');
  const newName = name != null ? String(name).trim() : null;
  const newTag = tag != null ? String(tag).trim().toUpperCase() : null;
  if (newName == null && newTag == null) throw new GameError('nothing', 'Give the engraver a name or a tag.');
  if (newName != null && (newName.length < 3 || newName.length > 24)) throw new GameError('name', 'Family name must be 3–24 characters.');
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

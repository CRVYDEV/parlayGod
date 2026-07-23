// ═══ DYNASTIC MARRIAGES & THE CONSIGLIERE (CK3 — omerta-marriage-soldiers-design.md, Drop A) ═══
// Account×account ties on the Bloodline (the vendetta/feud-peace pair pattern): a marriage SURVIVES
// death (the heirs stay in-laws), is monogamous, and grants STATUS + the scandal deterrent — never
// immunity (a kill between in-laws still lands; the killer eats MARRIAGE.SCANDAL honor and the
// marriage dissolves — checkScandal is called from runEstate wherever a killerCh exists). The
// wedding buries the feud (vendettas both ways clear — the acceptPeace machinery). §10.4: the
// ceremony/consigliere fees are enumerated character_id'd `dynasty:` cash SINKS (check (a)
// reconciles); everything else is status. Lock posture: every action runs single-party under
// withCharacter (the actor's char lock); marriage rows are keyed on the SORTED account pair and
// mutated by plain row-locked UPDATE/INSERT — the account rows themselves are never a second lock,
// so no AB-BA surface (the feud_peace_offers precedent).
import { GameError, bus, notify } from './game.js';
import { MARRIAGE } from './rules.js';
import { bumpHonor, isMadDog } from './honor.js';

const pair = (a, b) => [a, b].sort();

// the accepted marriage an account is in (at most one — monogamy is enforced at propose/accept)
export async function marriageOf(client, accountId) {
  return (await client.query(
    'SELECT * FROM dynasty_marriages WHERE (account_a=$1 OR account_b=$1) AND accepted', [accountId])).rows[0] || null;
}
const pendingBetween = async (client, a, b) => {
  const [x, y] = pair(a, b);
  return (await client.query(
    'SELECT * FROM dynasty_marriages WHERE account_a=$1 AND account_b=$2', [x, y])).rows[0] || null;
};

// resolve a LIVING street to its account (the target picker works in characters, ties live on accounts)
async function accountOfCharacter(client, characterId) {
  const r = (await client.query(
    'SELECT id, account_id, name FROM characters WHERE id=$1 AND alive', [characterId])).rows[0];
  if (!r) throw new GameError('gone', 'No such soul in the city.');
  return r;
}

export async function proposeMarriage(ch, targetCharacterId, client, h) {
  if (isMadDog(ch)) throw new GameError('mad_dog', 'No house weds a mad dog. Earn some honor first.');
  const target = await accountOfCharacter(client, targetCharacterId);
  if (target.account_id === ch.account_id) throw new GameError('self', 'You can\'t marry your own house.');
  if (await marriageOf(client, ch.account_id)) throw new GameError('married', 'Your house is already wed.');
  if (await marriageOf(client, target.account_id)) throw new GameError('taken', 'That house is already wed.');
  const existing = await pendingBetween(client, ch.account_id, target.account_id);
  if (existing) throw new GameError('pending', existing.proposed_by === ch.account_id
    ? 'Your proposal is already on their table.' : 'THEIR proposal is on YOUR table — accept it.');
  if (Number(ch.cash) < MARRIAGE.PROPOSE_COST)
    throw new GameError('cash', `The envoy, the flowers, the sit-down — $${MARRIAGE.PROPOSE_COST}.`);
  ch.cash = Number(ch.cash) - MARRIAGE.PROPOSE_COST;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -MARRIAGE.PROPOSE_COST, reason: 'dynasty:ceremony' });
  const [a, b] = pair(ch.account_id, target.account_id);
  await client.query(
    'INSERT INTO dynasty_marriages (account_a, account_b, proposed_by) VALUES ($1,$2,$3)', [a, b, ch.account_id]);
  await notify(client, target.id, 'marriage_proposed', { from: ch.name });
  return { ok: true, to: target.name, cost: MARRIAGE.PROPOSE_COST };
}

export async function acceptMarriage(ch, fromAccountId, client, h) {
  if (isMadDog(ch)) throw new GameError('mad_dog', 'No house weds a mad dog — accepting doesn\'t dodge that.');
  const offer = await pendingBetween(client, ch.account_id, fromAccountId);
  if (!offer || offer.accepted) throw new GameError('no_offer', 'No proposal on the table.');
  if (offer.proposed_by === ch.account_id) throw new GameError('own', 'That\'s YOUR proposal — they accept it.');
  if (await marriageOf(client, ch.account_id)) throw new GameError('married', 'Your house is already wed.');
  if (await marriageOf(client, fromAccountId)) throw new GameError('taken', 'That house wed another while you waited.');
  if (Number(ch.cash) < MARRIAGE.ACCEPT_COST)
    throw new GameError('cash', `Your half of the ceremony is $${MARRIAGE.ACCEPT_COST}.`);
  ch.cash = Number(ch.cash) - MARRIAGE.ACCEPT_COST;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -MARRIAGE.ACCEPT_COST, reason: 'dynasty:ceremony' });
  const [a, b] = pair(ch.account_id, fromAccountId);
  await client.query('UPDATE dynasty_marriages SET accepted=true WHERE account_a=$1 AND account_b=$2', [a, b]);
  // THE WEDDING BURIES THE FEUD — vendettas both ways + any pending peace offers clear (status only)
  await client.query(
    'DELETE FROM vendettas WHERE (avenger_account=$1 AND target_account=$2) OR (avenger_account=$2 AND target_account=$1)',
    [ch.account_id, fromAccountId]);
  await client.query(
    'DELETE FROM feud_peace_offers WHERE (from_account=$1 AND target_account=$2) OR (from_account=$2 AND target_account=$1)',
    [ch.account_id, fromAccountId]);
  const spouse = (await client.query(
    'SELECT id, name FROM characters WHERE account_id=$1 AND alive', [fromAccountId])).rows[0];
  if (spouse) await notify(client, spouse.id, 'marriage_sealed', { with: ch.name });
  bus.emit('streets', { type: 'wedding', a: ch.name, b: spouse?.name || 'a quiet house' });
  return { ok: true, with: spouse?.name || null, cost: MARRIAGE.ACCEPT_COST };
}

// withdraw a PENDING offer (either side, free) or DIVORCE an accepted marriage (the initiator
// eats the honor hit — walking out on vows is a smaller oathbreak)
export async function divorceMarriage(ch, client, h) {
  const m = (await client.query(
    'SELECT * FROM dynasty_marriages WHERE account_a=$1 OR account_b=$1 ORDER BY accepted DESC LIMIT 1',
    [ch.account_id])).rows[0];
  if (!m) throw new GameError('single', 'Your house has no ties to cut.');
  await client.query('DELETE FROM dynasty_marriages WHERE account_a=$1 AND account_b=$2', [m.account_a, m.account_b]);
  if (m.accepted) {
    await bumpHonor(client, ch, MARRIAGE.DIVORCE);
    const other = m.account_a === ch.account_id ? m.account_b : m.account_a;
    const ex = (await client.query('SELECT id, name FROM characters WHERE account_id=$1 AND alive', [other])).rows[0];
    if (ex) await notify(client, ex.id, 'marriage_ended', { by: ch.name });
    bus.emit('streets', { type: 'divorce', by: ch.name });
    return { ok: true, divorced: true, honor: MARRIAGE.DIVORCE };
  }
  return { ok: true, withdrawn: true };
}

// THE SCANDAL — called from runEstate when a killerCh exists (fire / shank / npc-hit payer): killing
// your in-law dissolves the marriage and brands the killer. Runs under the killer's held char lock
// (bumpHonor is lock-safe there); reads/deletes only the pair row.
export async function checkScandal(client, killerCh, victim) {
  if (!killerCh || killerCh.account_id === victim.account_id) return null;
  const [a, b] = pair(killerCh.account_id, victim.account_id);
  const m = (await client.query(
    'SELECT accepted FROM dynasty_marriages WHERE account_a=$1 AND account_b=$2', [a, b])).rows[0];
  if (!m?.accepted) return null;
  await client.query('DELETE FROM dynasty_marriages WHERE account_a=$1 AND account_b=$2', [a, b]);
  await bumpHonor(client, killerCh, MARRIAGE.SCANDAL);
  bus.emit('streets', { type: 'scandal', killer: killerCh.name, victim: victim.name });
  return { scandal: true, honor: MARRIAGE.SCANDAL };
}

// ── THE CONSIGLIERE — each dynasty names ONE adviser (pure status both ways) ──
export async function nameConsigliere(ch, targetCharacterId, client, h) {
  const target = await accountOfCharacter(client, targetCharacterId);
  if (target.account_id === ch.account_id) throw new GameError('self', 'You can\'t counsel yourself.');
  const existing = (await client.query(
    'SELECT * FROM consiglieri WHERE dynasty_account=$1', [ch.account_id])).rows[0];
  if (existing) throw new GameError(existing.accepted ? 'has_consigliere' : 'pending',
    existing.accepted ? 'Your house already keeps an adviser — dismiss them first.' : 'Your offer is already out.');
  if (Number(ch.cash) < MARRIAGE.CONSIGLIERE_COST)
    throw new GameError('cash', `The envoy costs $${MARRIAGE.CONSIGLIERE_COST}.`);
  ch.cash = Number(ch.cash) - MARRIAGE.CONSIGLIERE_COST;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -MARRIAGE.CONSIGLIERE_COST, reason: 'dynasty:consigliere' });
  await client.query('INSERT INTO consiglieri (dynasty_account, adviser_account) VALUES ($1,$2)',
    [ch.account_id, target.account_id]);
  await notify(client, target.id, 'consigliere_offer', { from: ch.name });
  return { ok: true, to: target.name, cost: MARRIAGE.CONSIGLIERE_COST };
}

export async function acceptConsigliere(ch, dynastyAccountId, client, h) {
  const r = await client.query(
    'UPDATE consiglieri SET accepted=true WHERE dynasty_account=$1 AND adviser_account=$2 AND NOT accepted',
    [dynastyAccountId, ch.account_id]);
  if (!r.rowCount) throw new GameError('no_offer', 'No house asked for your counsel.');
  const head = (await client.query(
    'SELECT id, name FROM characters WHERE account_id=$1 AND alive', [dynastyAccountId])).rows[0];
  if (head) await notify(client, head.id, 'consigliere_sworn', { adviser: ch.name });
  return { ok: true, advising: head?.name || null };
}

// end the arrangement from either chair (the house dismisses, or the adviser walks) — free, status only
export async function endConsigliere(ch, client) {
  const r = await client.query(
    'DELETE FROM consiglieri WHERE dynasty_account=$1 OR (adviser_account=$1)', [ch.account_id]);
  if (!r.rowCount) throw new GameError('nothing', 'No arrangement to end.');
  return { ok: true };
}

// the public board — your marriage, pending proposals both ways, your consigliere + houses you counsel
export async function dynastyBoard(ch, client) {
  const stewardOf = async (accountId) => (await client.query(
    'SELECT name FROM characters WHERE account_id=$1 AND alive', [accountId])).rows[0]?.name || null;
  const dynastyOf = async (accountId) => (await client.query(
    'SELECT dynasty_name FROM account_persistent WHERE account_id=$1', [accountId])).rows[0]?.dynasty_name || null;
  const houseView = async (accountId) => ({
    accountId, dynasty: await dynastyOf(accountId), steward: await stewardOf(accountId) });
  const rows = (await client.query(
    'SELECT * FROM dynasty_marriages WHERE account_a=$1 OR account_b=$1', [ch.account_id])).rows;
  const marriage = rows.find((m) => m.accepted) || null;
  const pending = rows.filter((m) => !m.accepted);
  const cons = (await client.query('SELECT * FROM consiglieri WHERE dynasty_account=$1', [ch.account_id])).rows[0] || null;
  const advising = (await client.query(
    'SELECT * FROM consiglieri WHERE adviser_account=$1 AND accepted', [ch.account_id])).rows;
  const consOffers = (await client.query(
    'SELECT * FROM consiglieri WHERE adviser_account=$1 AND NOT accepted', [ch.account_id])).rows;
  const otherOf = (m) => (m.account_a === ch.account_id ? m.account_b : m.account_a);
  return {
    marriage: marriage ? { ...(await houseView(otherOf(marriage))), since: marriage.created_at } : null,
    proposals: await Promise.all(pending.map(async (m) => ({
      ...(await houseView(otherOf(m))), mine: m.proposed_by === ch.account_id }))),
    consigliere: cons ? { ...(await houseView(cons.adviser_account)), accepted: cons.accepted } : null,
    advising: await Promise.all(advising.map((c) => houseView(c.dynasty_account))),
    consigliereOffers: await Promise.all(consOffers.map((c) => houseView(c.dynasty_account))),
    costs: { propose: MARRIAGE.PROPOSE_COST, accept: MARRIAGE.ACCEPT_COST, consigliere: MARRIAGE.CONSIGLIERE_COST },
  };
}

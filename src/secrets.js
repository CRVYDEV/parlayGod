// ═══ BLACKMAIL & SECRETS (founder pick #7 — omerta-secrets-collection-design.md, Drop A) ═══
// CK3 intrigue on the Wire: dirt as a HELD asset. DIG burns $OMR (`intel:dig` — the existing
// intel burn term, rank-discounted, bumps the spymaster ops) and uncovers the juiciest REAL
// secret on the mark (never fabricated; DISINFORMATION cooks the books — the dig comes up empty).
// The holder EXTORTS (a demand + a 24h window), the mark PAYS THE HUSH (the audited taxed
// two-party transfer — `secret:hush` both sides, 1% street tax + 1% dev, the speakeasy-round
// mechanism byte-for-byte) or the secret is EXPOSED: the mark's RICO investigation meter jumps
// by the kind's exposeHeat (the Port BUST_EXPOSURE precedent) and the streets hear. Secrets die
// with the SPY's street (estate-wiped) AND with the MARK's street (dirt on the dead is worthless).
// Lock posture: dig/extort are single-party under withCharacter (secret rows are leaves, locked
// FOR UPDATE where mutated); pay/expose are two-party under withTwoCharacters (both char rows
// held); the worker's deadline sweep locks the mark's char row before the meter write.
import crypto from 'node:crypto';
import { GameError, bus, notify } from './game.js';
import { SECRETS, secretKindOf, WIRE, intelCost, spyPerksOf, disinfoActive, usd } from './rules.js';
import { spendOmr } from './vanity.js';

const uid = () => crypto.randomUUID();
const spyOps = async (client, accountId) => Number((await client.query(
  'SELECT intel_ops FROM account_persistent WHERE account_id=$1', [accountId])).rows[0]?.intel_ops || 0);
const bumpIntelOps = (client, accountId) => client.query(
  'UPDATE account_persistent SET intel_ops = intel_ops + 1 WHERE account_id=$1', [accountId]);

// what the shovel can actually turn up — REAL state only, priority = SECRETS.KINDS order.
// Wealth stays BANDED (the anti-precise-kill-EV rule: a secret names the ledger, not the number).
async function juiciestSecret(client, target) {
  if (Number(target.wash_used || 0) > 0 || Number(target.rwa_used || 0) > 0) return 'launderer';
  if (Number(target.season_kills || 0) >= 1) return 'killer';
  const stash = Number((await client.query(
    'SELECT COALESCE(SUM(qty),0) q FROM stash WHERE character_id=$1', [target.id])).rows[0].q);
  if (stash > 0 || target.lab) return 'cook';   // `characters.lab` is the lab id (TEXT) — non-null = a kitchen
  if (Number(target.bank || 0) >= SECRETS.MONEYBAGS_MIN) return 'moneybags';
  return null;
}

export async function digSecret(ch, targetId, client, h) {
  if (targetId === ch.id) throw new GameError('self', 'You know where your own bodies are buried.');
  const target = (await client.query('SELECT * FROM characters WHERE id=$1 AND alive', [targetId])).rows[0];
  if (!target) throw new GameError('gone', 'No such mark on the street.');
  if (target.account_id === ch.account_id) throw new GameError('self', 'Same house, same secrets.');
  const held = (await client.query(
    'SELECT target_account FROM secrets WHERE holder_character=$1 AND expires_at > now()', [ch.id])).rows;
  if (held.length >= SECRETS.MAX_HELD)
    throw new GameError('full', `You're sitting on ${SECRETS.MAX_HELD} secrets — spend one first.`);
  if (held.some((s) => s.target_account === target.account_id))
    throw new GameError('already', 'You already hold something on that house.');
  const dug = (await client.query(
    'SELECT at FROM digs WHERE character_id=$1 AND target_account=$2', [ch.id, target.account_id])).rows[0];
  if (dug && Date.now() - new Date(dug.at).getTime() < SECRETS.DIG_CD_MS)
    throw new GameError('cooldown', 'You just went through their trash — give it a day.');
  // the shovel burns win or lose (the npchit-fee posture); rank discount + spymaster credit apply
  const ops = await spyOps(client, ch.account_id);
  const cost = intelCost(SECRETS.DIG_OMR, ops);
  await spendOmr(client, h, cost, 'intel:dig');
  await client.query(
    `INSERT INTO digs (character_id, target_account, at) VALUES ($1,$2,now())
       ON CONFLICT (character_id, target_account) DO UPDATE SET at=now()`, [ch.id, target.account_id]);
  await bumpIntelOps(client, ch.account_id);
  // DISINFORMATION beats the shovel (the counter-intel triad): cooked books, nothing to find
  const kind = disinfoActive(target) ? null : await juiciestSecret(client, target);
  // deterministic — the dig finds the mark's REAL dirt (or disinfo hides it); the audit row records
  // the outcome, not a roll (roll 0 = no randomness decided this — the AUDIT LOW-2 hygiene fix)
  await h.rngLog(client, ch.id, 'secret:dig', 0, kind ? `dug ${kind} on ${target.name} (deterministic)` : `nothing on ${target.name} (deterministic)`);
  if (!kind) return { ok: true, found: false, spent: cost };
  const id = uid();
  await client.query(
    `INSERT INTO secrets (id, holder_character, target_account, target_name, kind, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)`, [id, ch.id, target.account_id, target.name, kind, new Date(Date.now() + SECRETS.TTL_MS)]);
  return { ok: true, found: true, id, kind, kindName: secretKindOf(kind).name,
    hushCap: secretKindOf(kind).hushCap, on: target.name, spent: cost,
    ttlSeconds: Math.round(SECRETS.TTL_MS / 1000) };
}

export async function extortSecret(ch, secretId, demand, client, h) {
  const s = (await client.query(
    'SELECT * FROM secrets WHERE id=$1 AND holder_character=$2 AND expires_at > now() FOR UPDATE', [secretId, ch.id])).rows[0];
  if (!s) throw new GameError('no_secret', 'No such dirt in your pocket.');
  if (s.extort_deadline) throw new GameError('pending', 'The demand is already on their table.');
  const cap = secretKindOf(s.kind).hushCap;
  const amt = Math.floor(Number(demand));
  if (!(Number.isFinite(amt) && amt >= SECRETS.DEMAND_MIN && amt <= cap))
    throw new GameError('amount', `Name a price between ${usd(SECRETS.DEMAND_MIN)} and ${usd(cap)} — that's what this dirt is worth.`);
  const deadline = new Date(Date.now() + SECRETS.EXTORT_WINDOW_MS);
  await client.query('UPDATE secrets SET demand=$2, extort_deadline=$3 WHERE id=$1', [secretId, amt, deadline]);
  const mark = (await client.query(
    'SELECT id FROM characters WHERE account_id=$1 AND alive', [s.target_account])).rows[0];
  if (mark) await notify(client, mark.id, 'extortion', {
    kind: secretKindOf(s.kind).name, demand: amt, hours: Math.round(SECRETS.EXTORT_WINDOW_MS / 3600e3), secretId });
  return { ok: true, demand: amt, deadlineSeconds: Math.round(SECRETS.EXTORT_WINDOW_MS / 1000) };
}

// the mark pays the hush — TWO-PARTY (mark = actor, holder = counterparty, both char rows held).
// The audited taxed transfer: mark −demand, holder +98%, 1% street tax → the buyback, 1% dev
// off-ledger (the bodyguard/speakeasy-round parity — no new untaxed value pipe). Consumes the secret.
export async function payHush(ch, holder, secretId, client, h) {
  const s = (await client.query('SELECT * FROM secrets WHERE id=$1 AND expires_at > now() FOR UPDATE', [secretId])).rows[0];
  if (!s || s.holder_character !== holder.id) throw new GameError('no_secret', 'That page has already turned.');
  if (s.target_account !== ch.account_id) throw new GameError('not_you', "That's not your dirt to buy.");
  if (!s.extort_deadline) throw new GameError('no_demand', 'Nobody has named a price.');
  const demand = Number(s.demand);
  if (Number(ch.cash) < demand) throw new GameError('cash', `The hush money is ${usd(demand)} — in cash.`);
  const fee = Math.ceil(demand * 0.01), tax = Math.ceil(demand * 0.01);
  const net = demand - fee - tax;
  ch.cash = Number(ch.cash) - demand;
  holder.cash = Number(holder.cash) + net;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -demand, reason: 'secret:hush', counterparty: holder.id });
  await h.ledger(client, { characterId: holder.id, currency: 'cash', amount: net, reason: 'secret:hush', counterparty: ch.id });
  await client.query('DELETE FROM secrets WHERE id=$1', [secretId]);
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [tax]); // singleton LAST
  await notify(client, holder.id, 'hush_paid', { by: ch.name, net });
  await h.track(client, ch.account_id, 'hush_paid', { kind: s.kind, demand });
  return { ok: true, paid: demand, kind: secretKindOf(s.kind).name };
}

// expose the dirt — the leverage burns publicly: the mark's RICO meter jumps, the streets hear.
// TWO-PARTY (holder = actor, the mark's living street = counterparty — both char rows held, so
// the meter bump rides the mark's positional persist with no clobber risk). A mark with no living
// street has no secret left to expose (runEstate deletes dirt on the dead).
export async function exposeSecret(ch, mark, secretId, client, h) {
  const s = (await client.query(
    'SELECT * FROM secrets WHERE id=$1 AND holder_character=$2 AND expires_at > now() FOR UPDATE', [secretId, ch.id])).rows[0];
  if (!s) throw new GameError('no_secret', 'No such dirt in your pocket.');
  if (s.target_account !== mark.account_id) throw new GameError('wrong_mark', "That dirt isn't on them.");
  const k = secretKindOf(s.kind);
  mark.heat_exposure = Number(mark.heat_exposure || 0) + k.exposeHeat;
  await client.query('DELETE FROM secrets WHERE id=$1', [secretId]);
  await notify(client, mark.id, 'exposed', { kind: k.name, by: 'the wire' }); // the holder stays unnamed — the feed tells the story
  bus.emit('streets', { type: 'exposed', on: mark.name, kind: k.name });
  await h.track(client, ch.account_id, 'secret_exposed', { kind: s.kind });
  return { ok: true, kind: k.name, exposeHeat: k.exposeHeat };
}

// the board — dirt you hold + demands hanging over YOUR head
export async function secretsBoard(ch, client) {
  const held = (await client.query(
    'SELECT * FROM secrets WHERE holder_character=$1 AND expires_at > now() ORDER BY created_at', [ch.id])).rows;
  const onMe = (await client.query(
    `SELECT s.*, c.name AS holder_name FROM secrets s
       JOIN characters c ON c.id = s.holder_character AND c.alive
      WHERE s.target_account=$1 AND s.extort_deadline IS NOT NULL AND s.expires_at > now()`, [ch.account_id])).rows;
  const secondsTo = (t) => Math.max(0, Math.floor((new Date(t) - Date.now()) / 1000));
  return {
    // windowHours is what the extortion card quotes as the deadline. /v1/rules also publishes it,
    // but the Wire tab reads it off THIS board — and got undefined, so it rendered a hardcoded 24
    // and would have gone on saying "24h" whatever EXTORT_WINDOW_MS was retuned to.
    digOmr: SECRETS.DIG_OMR, maxHeld: SECRETS.MAX_HELD, windowHours: SECRETS.EXTORT_WINDOW_MS / 3600e3,
    kinds: Object.fromEntries(Object.entries(SECRETS.KINDS).map(([id, k]) => [id, { name: k.name, hushCap: k.hushCap, exposeHeat: k.exposeHeat }])),
    held: held.map((s) => ({
      id: s.id, on: s.target_name, kind: s.kind, kindName: secretKindOf(s.kind)?.name || s.kind,
      hushCap: secretKindOf(s.kind)?.hushCap || 0,
      demand: s.demand != null ? Number(s.demand) : null,
      deadlineSeconds: s.extort_deadline ? secondsTo(s.extort_deadline) : null,
      ttlSeconds: secondsTo(s.expires_at),
    })),
    // demands on YOUR head — the extortionist's NAME shows (a demand is a face-to-face threat);
    // an un-extorted secret stays invisible to the mark (they don't know what you know)
    onMe: onMe.map((s) => ({
      id: s.id, holder: s.holder_name, holderId: s.holder_character,
      kind: s.kind, kindName: secretKindOf(s.kind)?.name || s.kind,
      demand: Number(s.demand), deadlineSeconds: secondsTo(s.extort_deadline),
    })),
  };
}

// the worker's deadline sweep: an unpaid demand past its window BLOWS — the meter bump runs under
// the mark's char row lock (an absolute write; the lock serializes vs any in-flight withCharacter
// so the positional persist can't clobber it) — then stale secrets are reaped.
// LOCK ORDER (the bounty-sweep pattern, AUDIT MED-1): the mark's CHARACTER row locks FIRST, then the
// secret — matching payHush/exposeSecret/runEstate (chars → secret), so a buzzer-beating pay or a
// concurrent kill can't AB-BA the sweep. target_account is immutable, so the pre-scan value is safe.
export async function sweepSecrets(pool) {
  const due = (await pool.query(
    `SELECT * FROM secrets WHERE extort_deadline IS NOT NULL AND extort_deadline <= now() AND expires_at > now()`)).rows;
  for (const s of due) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const mark = (await client.query(
        'SELECT * FROM characters WHERE account_id=$1 AND alive FOR UPDATE', [s.target_account])).rows[0];
      const row = (await client.query('SELECT * FROM secrets WHERE id=$1 FOR UPDATE', [s.id])).rows[0];
      if (!row || !row.extort_deadline || new Date(row.extort_deadline) > new Date()) { await client.query('ROLLBACK'); continue; }
      const k = secretKindOf(row.kind);
      if (mark && k) {
        await client.query('UPDATE characters SET heat_exposure=$2 WHERE id=$1',
          [mark.id, Number(mark.heat_exposure || 0) + k.exposeHeat]);
        await notify(client, mark.id, 'exposed', { kind: k.name, by: 'the wire' });
        bus.emit('streets', { type: 'exposed', on: mark.name, kind: k.name });
      }
      await client.query('DELETE FROM secrets WHERE id=$1', [row.id]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error('[secrets] sweep', e.message); }
    finally { client.release(); }
  }
  await pool.query('DELETE FROM secrets WHERE expires_at <= now()');
  await pool.query(`DELETE FROM digs WHERE at < now() - interval '7 days'`); // row hygiene
}

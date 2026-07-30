// THE FAVOR (STREET LIFE step two, task #320) — the PLAYER-posted call.
//
// Step one gave you calls FROM NPC contacts: they ring, you haul, they pay out of their own live
// pocket (recycle-only — nothing is conjured at the point of sale). This is the multiplayer half:
// a PLAYER posts the request, and the people who hold their number can run it.
//
// The one structural difference is the whole reason this is its own file. An NPC's pay is drawn at
// FULFILMENT, so it can quietly evaporate if the NPC gets robbed first (step one voids the request
// and says so). A player's pay is ESCROWED AT POST: the runner who carries six crates across town
// cannot arrive to find the money gone. That escrow is real value parked outside a pocket, so it
// gets the same treatment as every other escrow in the game — its own §10.4 check (`favor escrow`),
// death handling on the loot surface, and a worker sweep that gives it back when nobody runs it.
//
// §10.4 (`favor:` vocabulary + the `favor escrow` check), the market-escrow shape verbatim:
//   favor:post    escrow IN  (poster, negative)
//   favor:pay     the runner's NET (pay − take)
//   favor:take    the 2% carved FROM the pay — NULL character, half street tax, half burns.
//                 Never minted on top, so posting to your own alt is strictly lossy.
//   favor:refund  cancel / expiry — back to the poster
//   favor:loot    a fire-kill takes CASH_LOOT_RATE of a dead poster's open escrow (NULL, the
//                 escrow-side outflow; the killer's matching +row is `whack:loot`)
//   favor:death   whatever the killer didn't take burns (the dead-funder precedent)
//   escrow == posted − paid − takes − refunded − death − loot
//
// Locks: poster/runner via withCharacter (single-party — the poster is never locked while a runner
// fills, because the money is already OUT of their pocket and sitting in the row). The favor row is
// the pot: FOR UPDATE on it serializes two runners racing the same request.
import crypto from 'node:crypto';
import { GameError, bus, notify, trunkCap } from './game.js';
import { FAVOR, GOODS, DISTRICTS, M3 } from './rules.js';
const districtName = (id) => (DISTRICTS.find((d) => d.id === id) || {}).name || id;

const uid = () => crypto.randomUUID();
const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const safeHoused = (ch) => ch.safe_until && new Date(ch.safe_until) > new Date();

// the house cut, carved FROM the pay (the market paySeller shape): half to the street tax that
// funds the buyback, half burns. One NULL-character row is what closes the escrow identity.
async function payRunner(client, h, ch, pay) {
  const take = Math.ceil(pay * FAVOR.TAKE_BPS / 10000);
  const net = pay - take;
  ch.cash = Number(ch.cash) + net;                       // the runner IS the actor — in memory, never SQL
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: net, reason: 'favor:pay' });
  await h.ledger(client, { currency: 'cash', amount: -take, reason: 'favor:take' });
  if (take > 0) await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [Math.floor(take / 2)]);
  return { net, take };
}

// ── POST — escrow the pay, put the word out to everyone holding your number ──
export async function postFavor(ch, opts, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No putting the word out from lockup.');
  // the loot-proof-vault rule (the offerLoan / market-order precedent): escrow is cash parked
  // outside your pocket, so posting from a safehouse would be a shelter a killer can't reach.
  if (safeHoused(ch)) throw new GameError('safe', "Can't put work out while you're to ground — a safehouse is a shield, not a bank.");
  const good = GOODS.find((g) => g.id === opts.goodId);
  if (!good) throw new GameError('bad_good', 'No such trade good.');
  const qty = Math.floor(Number(opts.qty) || 0);
  if (!Number.isFinite(qty) || qty < 1 || qty > FAVOR.MAX_QTY)
    throw new GameError('qty', `Ask for 1–${FAVOR.MAX_QTY} units.`);
  const pay = Math.floor(Number(opts.pay) || 0);
  if (!Number.isFinite(pay) || pay < FAVOR.MIN_PAY || pay > FAVOR.MAX_PAY)
    throw new GameError('pay', `The pay runs $${FAVOR.MIN_PAY}–$${FAVOR.MAX_PAY}.`);
  const district = DISTRICTS.find((d) => d.id === (opts.district || ch.loc))?.id;
  if (!district) throw new GameError('bad_district', 'No such district.');
  const open = Number((await client.query(
    "SELECT COUNT(*) n FROM favors WHERE poster_character=$1 AND status='open'", [ch.id])).rows[0].n);
  if (open >= FAVOR.MAX_OPEN) throw new GameError('max_open', `You've got ${FAVOR.MAX_OPEN} favors out already.`);
  if (Number(ch.cash) < pay) throw new GameError('cash', `You need $${pay} in your pocket to put it up front.`);

  ch.cash = Number(ch.cash) - pay;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -pay, reason: 'favor:post' });
  const id = uid();
  const note = String(opts.note || '').replace(/[<>]/g, '').slice(0, FAVOR.NOTE_MAX) || null;
  await client.query(
    `INSERT INTO favors (id, poster_character, good_id, qty, pay, district, note, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, ch.id, good.id, qty, pay, district, note, new Date(Date.now() + FAVOR.TTL_MS)]);
  // tell the people who hold your number — that is what the black book BUYS you
  const holders = (await client.query(
    `SELECT c.id FROM contacts ct
       JOIN characters c ON c.account_id = ct.owner_account AND c.alive AND NOT c.is_npc
      WHERE ct.contact_account = $1 LIMIT 50`, [ch.account_id])).rows;
  for (const holder of holders)
    await notify(client, holder.id, 'favor_posted', { from: ch.name, good: good.id, qty, pay, district }).catch(() => {});
  bus.emit('streets', { type: 'favor', by: ch.name, good: good.id, qty, district });
  return { ok: true, favor: 'posted', id, good: good.id, qty, pay, district,
    expiresSeconds: Math.floor(FAVOR.TTL_MS / 1000) };
}

// ── THE BOARD — what the people whose numbers you hold are asking for, plus your own book ──
export async function favorBoard(ch, client) {
  const acct = (await client.query('SELECT account_id FROM characters WHERE id=$1', [ch.id])).rows[0]?.account_id;
  // you see a favor if YOU hold the POSTER's number (the book is the reach). Flat query + JOIN —
  // never `= ANY($1::uuid[])` (pg-mem returns zero rows for it — the rivalsBoard lesson).
  const open = (await client.query(
    `SELECT f.*, c.name AS poster_name FROM favors f
       JOIN characters c ON c.id = f.poster_character AND c.alive
       JOIN contacts ct ON ct.contact_account = c.account_id AND ct.owner_account = $1
      WHERE f.status='open' AND f.expires_at > now() AND f.poster_character <> $2
      ORDER BY f.pay DESC LIMIT 40`, [acct, ch.id])).rows;
  const mine = (await client.query(
    "SELECT * FROM favors WHERE poster_character=$1 AND status='open' AND expires_at > now() ORDER BY posted_at DESC", [ch.id])).rows;
  const shape = (f) => ({
    id: f.id, good: f.good_id, qty: Number(f.qty), pay: Number(f.pay), district: f.district,
    districtName: districtName(f.district), note: f.note || null,
    expiresSeconds: Math.max(0, Math.ceil((new Date(f.expires_at) - Date.now()) / 1000)),
  });
  return {
    takeBps: FAVOR.TAKE_BPS, maxOpen: FAVOR.MAX_OPEN, minPay: FAVOR.MIN_PAY, maxPay: FAVOR.MAX_PAY,
    maxQty: FAVOR.MAX_QTY,
    open: open.map((f) => ({ ...shape(f), from: f.poster_name, here: f.district === ch.loc })),
    mine: mine.map(shape),
  };
}

// ── RUN IT — deliver the goods where they're wanted, take the money ──
// Single-party: the pay is already out of the poster's pocket and sitting in the row, so the
// poster's character is NEVER locked here (no two-party lock, no AB-BA surface). The favor row is
// the pot — FOR UPDATE on it is what serializes two runners racing the same request.
export async function runFavor(ch, favorId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No running errands from lockup.');
  const f = (await client.query('SELECT * FROM favors WHERE id=$1 FOR UPDATE', [favorId])).rows[0];
  if (!f) throw new GameError('no_favor', 'No such favor.');
  if (f.status !== 'open' || new Date(f.expires_at) <= new Date())
    throw new GameError('gone', 'Somebody else already ran that one.');
  if (f.poster_character === ch.id) throw new GameError('own', "It's your own favor.");
  if (ch.loc !== f.district)
    throw new GameError('district', `They want it at ${districtName(f.district)} — travel there first.`);
  const qty = Number(f.qty);
  const have = Number(h.owned.cargo[f.good_id] || 0);
  if (have < qty) throw new GameError('short', `They want ${qty} ${f.good_id} — you're carrying ${have}.`);

  // the goods change hands — absolute writes both sides (the setCargo discipline, pg-mem INT quirk)
  const mineLeft = have - qty;
  await client.query('DELETE FROM character_cargo WHERE character_id=$1 AND good_id=$2', [ch.id, f.good_id]);
  if (mineLeft > 0) await client.query('INSERT INTO character_cargo (character_id, good_id, qty) VALUES ($1,$2,$3)', [ch.id, f.good_id, mineLeft]);
  h.owned.cargo[f.good_id] = mineLeft;
  const theirs = Number((await client.query(
    'SELECT COALESCE(SUM(qty),0) n FROM character_cargo WHERE character_id=$1 AND good_id=$2', [f.poster_character, f.good_id])).rows[0].n);
  await client.query('DELETE FROM character_cargo WHERE character_id=$1 AND good_id=$2', [f.poster_character, f.good_id]);
  await client.query('INSERT INTO character_cargo (character_id, good_id, qty) VALUES ($1,$2,$3)', [f.poster_character, f.good_id, theirs + qty]);

  const { net, take } = await payRunner(client, h, ch, Number(f.pay));
  await client.query("UPDATE favors SET status='filled', runner_character=$2 WHERE id=$1", [f.id, ch.id]);
  await notify(client, f.poster_character, 'favor_filled', { by: ch.name, good: f.good_id, qty, pay: Number(f.pay) }).catch(() => {});
  await h.track(client, ch.account_id, 'favor_run', { good: f.good_id, qty, pay: Number(f.pay) });
  return { ok: true, favor: 'ran', good: f.good_id, qty, pay: Number(f.pay), net, take, for: f.poster_character };
}

// ── PULL IT — the poster takes the word back, escrow returns ──
export async function cancelFavor(ch, favorId, client, h) {
  const f = (await client.query('SELECT * FROM favors WHERE id=$1 FOR UPDATE', [favorId])).rows[0];
  if (!f) throw new GameError('no_favor', 'No such favor.');
  if (f.poster_character !== ch.id) throw new GameError('not_yours', 'Not your favor to pull.');
  if (f.status !== 'open') throw new GameError('gone', 'That one is already settled.');
  ch.cash = Number(ch.cash) + Number(f.pay);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: Number(f.pay), reason: 'favor:refund' });
  await client.query("UPDATE favors SET status='cancelled' WHERE id=$1", [f.id]);
  return { ok: true, favor: 'pulled', refund: Number(f.pay) };
}

// ── the worker sweep — nobody ran it, the money goes home. Per-favor txn (poster row locked before
// the favor row: the characters→pots order every sweep in the tree uses). ──
export async function sweepFavors(pool) {
  const stale = (await pool.query(
    "SELECT id, poster_character FROM favors WHERE status='open' AND expires_at < now() ORDER BY id")).rows;
  let refunded = 0;
  for (const { id, poster_character } of stale) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM characters WHERE id=$1 FOR UPDATE', [poster_character]);
      const f = (await client.query("SELECT pay, status FROM favors WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!f || f.status !== 'open') { await client.query('ROLLBACK'); continue; }
      // a DEAD poster's escrow was already resolved at the estate (looted/burned) — the row is
      // never left 'open' behind a corpse, so an alive-check here would be belt on braces; the
      // status re-read under the lock is what makes this safe against that race.
      await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [poster_character, Number(f.pay)]);
      await client.query(
        'INSERT INTO transactions (id, character_id, currency, amount, reason) VALUES ($1,$2,$3,$4,$5)',
        [uid(), poster_character, 'cash', Number(f.pay), 'favor:refund']);
      await client.query("UPDATE favors SET status='expired' WHERE id=$1", [id]);
      await notify(client, poster_character, 'favor_expired', { refund: Number(f.pay) }).catch(() => {});
      await client.query('COMMIT');
      refunded++;
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error('[favors] sweep failed', id, e.message); }
    finally { client.release(); }
  }
  return { refunded };
}

// ── DEATH — a dead poster's open escrow is the loot surface (the market-order / loan-offer
// precedent, AUDIT-market-skills-underworld #1): a PLAYER fire-kill takes CASH_LOOT_RATE of it,
// the rest burns. Parked liquid must never be a loot-proof vault. NPC/mod kills pass lootRate 0.
export async function voidFavorsAtDeath(client, victimId, killerCh, lootRate = 0) {
  const rows = (await client.query(
    "SELECT id, pay FROM favors WHERE poster_character=$1 AND status='open' FOR UPDATE", [victimId])).rows;
  let looted = 0;
  for (const f of rows) {
    const pay = Number(f.pay);
    const loot = killerCh && lootRate > 0 ? Math.floor(pay * lootRate) : 0;
    if (loot > 0) {
      killerCh.cash = Number(killerCh.cash) + loot;      // the killer is the in-memory actor (persist-clobber rule)
      looted += loot;
      await client.query('INSERT INTO transactions (id, character_id, currency, amount, reason, counterparty) VALUES ($1,$2,$3,$4,$5,$6)',
        [uid(), killerCh.id, 'cash', loot, 'whack:loot', victimId]);
      await client.query('INSERT INTO transactions (id, character_id, currency, amount, reason, counterparty) VALUES ($1,NULL,$2,$3,$4,$5)',
        [uid(), 'cash', -loot, 'favor:loot', victimId]);
    }
    const burn = pay - loot;
    if (burn > 0) await client.query('INSERT INTO transactions (id, character_id, currency, amount, reason, counterparty) VALUES ($1,NULL,$2,$3,$4,$5)',
      [uid(), 'cash', -burn, 'favor:death', victimId]);
    await client.query("UPDATE favors SET status='cancelled' WHERE id=$1", [f.id]);
  }
  return { looted };
}

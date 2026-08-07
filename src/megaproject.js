// THE MEGAPROJECT (founder pick #1 — the WoW Ahn'Qiraj-gate server event, design
// omerta-megaproject-design.md). The city announces a MONUMENT; the whole base pools value
// toward a massive target; completion PERMANENTLY changes the city (the skyline) and the
// contributors' names go on the plaque forever, tiered by share.
//
// The economics are the whole point: every contribution is a SINK — §10.4-POSITIVE by
// construction, zero new faucet, nothing minted ever:
//   cash  → `megaproject:cash`  (character_id'd cash burn — check (a) reconciles)
//   $OMR  → `megaproject:omr`   (through the ONE audited burn primitive, vanity.js:spendOmr —
//                                account bucket; joins the omrBurns term)
//   goods → deleted from the trunk (goods are NOT a §10.4 currency — a pure ownership sink),
//           credited at the CATALOG BASE value (never the district-shocked price — donations are
//           location-free, so the §7.11 arbitrage surface can't leak in)
// $OMR credit rides the FIXED `MEGAPROJECT.OMR_RATE` (the genesis AMM rate) — deliberately not
// the live spot, so the credit is deterministic and unmanipulable.
//
// One monument under construction at a time, drawn in order from MEGAPROJECT.MONUMENTS. The row
// materializes on the FIRST contribution (the poker-tournament pattern; the deterministic PK
// '<monument>:<seq>' turns a concurrent double-materialize into a clean 23505 → `contention`
// retry — the auction-F1 precedent). Contributions CLAMP to what the wall still needs. The
// crossing contribution completes it in the SAME transaction (lazy — no worker), fires the
// streets celebration, and notifies THE ARCHITECT (the top contributor).
//
// The plaque is ACCOUNT-level (megaproject_contributions — survives death, a DYNASTY raised
// this; the Portfolio precedent; no character_id → outside the estate wipe by construction).
// Tiers (Architect/Foreman/Patron/Builder) are computed at read — pure status, zero power.
//
// Lock order: withCharacter (actor char + account) → the megaprojects row FOR UPDATE (a
// singleton-class row, locked LAST — the canonical characters → … → singletons order).
import { GameError, bus, notify } from './game.js';
import { recordEventResult } from './events.js';
import { spendOmr } from './vanity.js';
import { MEGAPROJECT, megaMonumentAt, megaTierOf, builderRankOf, GOODS , jailed } from './rules.js';

const round6 = (x) => Math.round(Number(x) * 1e6) / 1e6;

async function completedCount(client) {
  return Number((await client.query(`SELECT COUNT(*) c FROM megaprojects WHERE status='complete'`)).rows[0].c);
}

// the one 'building' row, locked — materialized on first touch (deterministic PK → 23505 on a race)
async function lockProject(client) {
  const cur = (await client.query(`SELECT * FROM megaprojects WHERE status='building' FOR UPDATE`)).rows[0];
  if (cur) return cur;
  const seq = await completedCount(client);
  const mon = megaMonumentAt(seq);
  if (!mon) throw new GameError('skyline_complete', 'The skyline is finished — the city rests. For now.');
  const id = `${mon.id}:${seq}`;
  await client.query('INSERT INTO megaprojects (id, monument, seq, target) VALUES ($1,$2,$3,$4)',
    [id, mon.id, seq, mon.target]);
  return (await client.query('SELECT * FROM megaprojects WHERE id=$1 FOR UPDATE', [id])).rows[0];
}

// credit a $-value to the locked project + the actor's plaque row; handles milestones + completion.
// gangId (Tier-4): the contributor's family at contribution time gets the FAMILY-BUILD credit.
async function credit(client, ch, p, value, gangId) {
  const before = Number(p.progress);
  const after = Math.min(Number(p.target), before + value);
  await client.query('UPDATE megaprojects SET progress=$2 WHERE id=$1', [p.id, after]);
  // THE BUILDER LEGEND (Tier-4) — lifetime $-value contributed (account-level, survives death; the
  // contributor's own account is already locked by withCharacter → no new lock. NUMERIC arith-safe).
  await client.query('UPDATE account_persistent SET monument_built = monument_built + $1 WHERE account_id=$2',
    [value, ch.account_id]);
  // THE FAMILY BUILD (Tier-4) — the family that put up the money (dies with the family). A plain
  // UPDATE row-lock; nothing locks gangs-then-megaprojects, so holding the singleton here is cycle-free.
  if (gangId) await client.query('UPDATE gangs SET monument_built = monument_built + $1 WHERE id=$2', [value, gangId]);
  // the plaque (account-level upsert under the project lock — concurrent donors serialize on it)
  const row = (await client.query(
    'SELECT contributed FROM megaproject_contributions WHERE project_id=$1 AND account_id=$2',
    [p.id, ch.account_id])).rows[0];
  const total = (row ? Number(row.contributed) : 0) + value;
  if (row) await client.query('UPDATE megaproject_contributions SET contributed=$3 WHERE project_id=$1 AND account_id=$2',
    [p.id, ch.account_id, total]);
  else await client.query('INSERT INTO megaproject_contributions (project_id, account_id, contributed) VALUES ($1,$2,$3)',
    [p.id, ch.account_id, total]);
  const mon = megaMonumentAt(p.seq) || { name: p.monument };
  // scaffolding milestones — announced once, at the contribution that crosses them
  for (const m of MEGAPROJECT.MILESTONES) {
    if (before < Number(p.target) * m && after >= Number(p.target) * m && after < Number(p.target))
      bus.emit('streets', { type: 'megaproject_milestone', monument: mon.name, pct: Math.round(m * 100) });
  }
  let completed = false;
  if (after >= Number(p.target)) {
    completed = true;
    await client.query(`UPDATE megaprojects SET status='complete', completed_at=now() WHERE id=$1`, [p.id]);
    // THE ARCHITECT — the top contributor's living street gets the word (a notification, never a
    // currency; the title/perk option is deliberately deferred to founder sign-off)
    const top = (await client.query(
      'SELECT account_id FROM megaproject_contributions WHERE project_id=$1 ORDER BY contributed DESC, account_id LIMIT 1',
      [p.id])).rows[0];
    const arch = top && (await client.query(
      'SELECT id, name FROM characters WHERE account_id=$1 AND alive', [top.account_id])).rows[0];
    if (arch) await notify(client, arch.id, 'megaproject_architect', { monument: mon.name });
    // (red-team B2) no living street at the completion instant → the dynasty/last-street name
    // still headlines the celebration (skylineOf will name them correctly on every later read)
    const archName = arch?.name
      || (top && (await nameAccounts(client, [top.account_id])).get(top.account_id))
      || 'an unknown hand';
    await recordEventResult(client, { kind: 'megaproject', icon: '🏛', headline: `The city finished ${mon.name} — ${archName} laid the most`, winnerName: archName, pool: Number(p.target), detail: { monument: mon.name } });
    bus.emit('streets', { type: 'megaproject_complete', monument: mon.name, architect: archName });
  }
  return { credited: value, progress: after, target: Number(p.target), completed,
    yourTotal: total, monument: mon.name };
}

// ── the three contribution rails ──
export async function giveCash(ch, amount, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No writing checks from lockup.');
  const amt = Math.floor(Number(amount));
  if (!Number.isFinite(amt) || amt < MEGAPROJECT.MIN_CASH)
    throw new GameError('amount', `The smallest brick is $${MEGAPROJECT.MIN_CASH}.`);
  const p = await lockProject(client);
  const need = Number(p.target) - Number(p.progress);
  // clamp — nobody pays into a finished wall. (red-team A1, accepted) fractional $OMR progress can
  // leave a sub-dollar `need`; Math.ceil charges at most $1 of dust on the very last brick — the
  // ledger row always equals exactly what left the player, so §10.4 is bit-exact either way.
  const give = Math.min(amt, Math.ceil(need));
  if (Number(ch.cash) < give) throw new GameError('cash', 'Not enough pocket cash.');
  ch.cash = Number(ch.cash) - give;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -give, reason: 'megaproject:cash' });
  await h.track(client, ch.account_id, 'megaproject_give', { kind: 'cash', value: give });
  return credit(client, ch, p, give, h.owned.gang?.id);
}

export async function giveGoods(ch, goodId, qty, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No hauling freight from lockup.');
  const g = GOODS.find((x) => x.id === goodId);
  if (!g) throw new GameError('bad_good', 'No such good.');
  const n0 = Math.floor(Number(qty));
  if (!Number.isFinite(n0) || n0 < 1) throw new GameError('amount', 'How many units?'); // (red-team A2) reject, never coerce
  const have = h.owned.cargo[goodId] || 0;
  let n = Math.min(n0, have);
  if (n <= 0) throw new GameError('none', 'Nothing of that in the trunk.');
  const p = await lockProject(client);
  const need = Number(p.target) - Number(p.progress);
  n = Math.min(n, Math.max(1, Math.ceil(need / g.base))); // the fewest units that cover the wall
  const value = Math.min(n * g.base, Math.ceil(need));    // credit never overshoots the target
  // (red-team C5) the goods rail carries the same $-value floor as the cash rail — one cheap unit
  // (~$40) used to buy a plaque row the $100 cash floor would refuse, so dust-spam could farm the
  // wall's contributor list. Freight worth less than a cash brick isn't a contribution.
  if (value < MEGAPROJECT.MIN_CASH)
    throw new GameError('amount', `That freight is worth $${value} — the smallest brick is $${MEGAPROJECT.MIN_CASH}.`);
  const left = have - n;
  h.owned.cargo[goodId] = left;
  // goods are not a §10.4 currency — deleting them from the trunk is a pure ownership sink
  await client.query('DELETE FROM character_cargo WHERE character_id=$1 AND good_id=$2', [ch.id, goodId]);
  if (left > 0) await client.query('INSERT INTO character_cargo (character_id, good_id, qty) VALUES ($1,$2,$3)', [ch.id, goodId, left]);
  await h.track(client, ch.account_id, 'megaproject_give', { kind: 'goods', good: goodId, qty: n, value });
  return { ...(await credit(client, ch, p, value, h.owned.gang?.id)), qty: n, unit: g.base };
}

export async function giveOmr(ch, amount, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No moving tokens from lockup.');
  const amt = round6(Number(amount));
  if (!Number.isFinite(amt) || amt < MEGAPROJECT.MIN_OMR)
    throw new GameError('amount', `The smallest $OMR brick is ${MEGAPROJECT.MIN_OMR}.`);
  const p = await lockProject(client);
  const need = Number(p.target) - Number(p.progress);
  const give = Math.min(amt, round6(Math.ceil(need) / MEGAPROJECT.OMR_RATE)); // clamp at the rate
  await spendOmr(client, h, give, 'megaproject:omr'); // the audited burn primitive (balance-gated)
  const value = Math.min(round6(give * MEGAPROJECT.OMR_RATE), Math.ceil(need));
  await h.track(client, ch.account_id, 'megaproject_give', { kind: 'omr', omr: give, value });
  return { ...(await credit(client, ch, p, value, h.owned.gang?.id)), omr: give };
}

// ── the board (authed read): the monument, the plaque, your share, the skyline ──
export async function megaBoard(pool, accountId) {
  const cur = (await pool.query(`SELECT * FROM megaprojects WHERE status='building'`)).rows[0];
  const seq = cur ? Number(cur.seq) :
    Number((await pool.query(`SELECT COUNT(*) c FROM megaprojects WHERE status='complete'`)).rows[0].c);
  const mon = megaMonumentAt(seq);
  let current = null;
  if (mon) {
    const target = cur ? Number(cur.target) : mon.target;
    const progress = cur ? Number(cur.progress) : 0;
    // the plaque — flat query, named + tiered in JS (the /v1/gangs two-flat-queries precedent)
    let plaque = [], you = null;
    if (cur) {
      // bounded top slice for the plaque (never a full-table scan on a big base)
      const rows = (await pool.query(
        'SELECT account_id, contributed FROM megaproject_contributions WHERE project_id=$1 ORDER BY contributed DESC, account_id LIMIT 12',
        [cur.id])).rows;
      const named = await nameAccounts(pool, rows.map((r) => r.account_id));
      plaque = rows.map((r, i) => ({ name: named.get(r.account_id) || 'a quiet benefactor',
        contributed: Number(r.contributed), tier: megaTierOf(i + 1) }));
      // your exact rank via two cheap indexed reads (row + count-above), not a full ordering
      const mine = (await pool.query(
        'SELECT contributed FROM megaproject_contributions WHERE project_id=$1 AND account_id=$2',
        [cur.id, accountId])).rows[0];
      if (mine) {
        // (red-team C1) the SAME total ordering as the plaque + the Architect pick
        // (contributed DESC, account_id ASC) — so ties resolve identically on every surface
        const above = Number((await pool.query(
          `SELECT COUNT(*) c FROM megaproject_contributions
            WHERE project_id=$1 AND (contributed > $2 OR (contributed = $2 AND account_id < $3))`,
          [cur.id, Number(mine.contributed), accountId])).rows[0].c);
        you = { contributed: Number(mine.contributed), rank: above + 1,
          tier: megaTierOf(above + 1), share: Number(mine.contributed) / Math.max(1, progress) };
      }
    }
    current = { monument: mon.id, name: mon.name, district: mon.district, blurb: mon.blurb,
      target, progress, remaining: Math.max(0, target - progress),
      pct: Math.min(100, Math.round((progress / target) * 100)),
      started: !!cur, plaque, you,
      omrRate: MEGAPROJECT.OMR_RATE, minCash: MEGAPROJECT.MIN_CASH, minOmr: MEGAPROJECT.MIN_OMR };
  }
  // Tier-4 — the caller's BUILDER legend + how many monuments this dynasty ARCHITECTED (read-derived)
  const built = Number((await pool.query('SELECT monument_built FROM account_persistent WHERE account_id=$1', [accountId])).rows[0]?.monument_built || 0);
  const architected = (await architectTally(pool)).get(accountId) || 0;
  return { current, skyline: await skylineOf(pool),
    builder: { built, rank: builderRankOf(built).name, architected } };
}

// THE ARCHITECT CROWN (Tier-4) — read-derived (no cross-account write under the singleton lock): for
// every COMPLETED monument, the top contributor. Bounded by the (small) number of finished monuments.
async function architectTally(pool) {
  const done = (await pool.query(`SELECT id FROM megaprojects WHERE status='complete'`)).rows;
  const tally = new Map();
  for (const p of done) {
    const top = (await pool.query(
      'SELECT account_id FROM megaproject_contributions WHERE project_id=$1 ORDER BY contributed DESC, account_id LIMIT 1',
      [p.id])).rows[0];
    if (top) tally.set(top.account_id, (tally.get(top.account_id) || 0) + 1);
  }
  return tally;
}

// THE BUILDERS' BOARD (Tier-4) — the biggest lifetime monument builders (agents excluded), each with
// how many monuments they architected. Pure STATUS — account-level, survives death.
export async function builderLeaderboard(pool) {
  const rows = (await pool.query(
    `SELECT account_id, monument_built, dynasty_name FROM account_persistent
      WHERE NOT agent_flag AND monument_built > 0
      ORDER BY monument_built DESC, account_id LIMIT 20`)).rows;
  const named = await nameAccounts(pool, rows.map((r) => r.account_id)); // living street / House / late-name
  const crowns = await architectTally(pool);
  return { builders: rows.map((r, i) => ({ pos: i + 1,
    name: named.get(r.account_id) || (r.dynasty_name ? `House ${r.dynasty_name}` : 'a quiet benefactor'),
    built: Number(r.monument_built), rank: builderRankOf(r.monument_built).name,
    architected: crowns.get(r.account_id) || 0 })) };
}

// THE FAMILY-BUILD BOARD (Tier-4) — the families that put up the most for the city (dies with the family).
export async function familyBuildLeaderboard(pool) {
  const rows = (await pool.query(
    `SELECT name, tag, monument_built FROM gangs WHERE monument_built > 0
      ORDER BY monument_built DESC, name LIMIT 20`)).rows;
  return { families: rows.map((r, i) => ({ pos: i + 1, name: r.name, tag: r.tag, built: Number(r.monument_built) })) };
}

// THE SKYLINE — every monument the city ever raised, with its Architect (permanent, public)
export async function skylineOf(pool) {
  const done = (await pool.query(
    `SELECT * FROM megaprojects WHERE status='complete' ORDER BY completed_at`)).rows;
  const out = [];
  for (const p of done) {
    const mon = megaMonumentAt(Number(p.seq)) || { name: p.monument, district: '?' };
    // (red-team C4) "the plaque is forever" — every completed monument keeps its top names visible
    const rows = (await pool.query(
      'SELECT account_id, contributed FROM megaproject_contributions WHERE project_id=$1 ORDER BY contributed DESC, account_id LIMIT 8',
      [p.id])).rows;
    const named = await nameAccounts(pool, rows.map((r) => r.account_id));
    const plaque = rows.map((r, i) => ({ name: named.get(r.account_id) || 'a quiet benefactor',
      contributed: Number(r.contributed), tier: megaTierOf(i + 1) }));
    out.push({ monument: mon.id || p.monument, name: mon.name, district: mon.district,
      completedAt: p.completed_at, architect: plaque[0]?.name || null, plaque });
  }
  return out;
}

// resolve display names for accounts: the living street, else the dynasty name (never a UUID out)
async function nameAccounts(pool, accountIds) {
  const out = new Map();
  if (!accountIds.length) return out;
  const ph = accountIds.map((_, i) => `$${i + 1}`).join(',');
  for (const c of (await pool.query(
    `SELECT name, account_id FROM characters WHERE alive AND account_id IN (${ph})`, accountIds)).rows)
    out.set(c.account_id, c.name);
  for (const a of (await pool.query(
    `SELECT account_id, dynasty_name FROM account_persistent WHERE account_id IN (${ph})`, accountIds)).rows)
    if (!out.has(a.account_id) && a.dynasty_name) out.set(a.account_id, `House ${a.dynasty_name}`);
  // (red-team C2) no living street, no dynasty name → the LAST KNOWN street of the line
  const missing = accountIds.filter((a) => !out.has(a));
  if (missing.length) {
    const ph2 = missing.map((_, i) => `$${i + 1}`).join(',');
    for (const c of (await pool.query(
      `SELECT name, account_id, generation FROM characters WHERE account_id IN (${ph2}) ORDER BY generation DESC`, missing)).rows)
      if (!out.has(c.account_id)) out.set(c.account_id, `the late ${c.name}`);
  }
  return out;
}

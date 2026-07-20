// THE WIRE — the intelligence terminal (design omerta-the-wire-and-revenue-design.md). Information as
// a spendable resource. WIRETAPS surveil a rival for a window (a $OMR sink); SWEEP clears bugs on you;
// the STREET WIRE is a recurring $OMR subscription that upgrades the feed into an intelligence service
// (forecasts, threat chatter, the ticker tape, the war room). Off-chain, §10.4-clean — every burn is an
// intel:* $OMR sink through the vanity spendOmr till (rides the existing intel: vocabulary, so ZERO
// invariant changes). A tap READ is an UNLOCKED point-in-time lookup (surveillance, not a two-party
// action) — no lock complexity; reads filter expires_at and JOIN to `alive`, so a dead party's wire
// goes silent, and the worker sweeps expired rows. The layered intel economy: the SUB warns you (a
// hunter COUNT), a TAP identifies whether a SPECIFIC rival is hunting you, the peek names funders.
import { GameError } from './game.js';
import { WIRE, wireActive, spyRankOf, rapStageOf, cityForecast, tickerPriceOf, PORTFOLIO, levelOf, dayOf } from './rules.js';
import { spendOmr } from './vanity.js';

// THE SPYMASTER (step two): bump the account's lifetime intel-ops count (status, survives death — the
// war-effort/kills precedent; direct SQL on account_persistent so persistAccount can't clobber it).
const bumpIntelOps = (client, accountId) =>
  client.query('UPDATE account_persistent SET intel_ops = intel_ops + 1 WHERE account_id=$1', [accountId]);

const heatBand = (h) => { const n = Number(h || 0); return n >= 80 ? 'red hot' : n >= 50 ? 'hot' : n >= 25 ? 'warm' : 'cold'; };
const wealthBand = (v) => {
  const n = Number(v || 0);
  if (n >= 5_000_000) return 'a whale — deep pockets';
  if (n >= 1_000_000) return 'flush';
  if (n >= 200_000) return 'comfortable';
  if (n >= 25_000) return 'getting by';
  return 'broke';
};

// fresh intel on ONE tapped mark (a point-in-time read of their CURRENT state — never exact books)
async function tapIntel(client, watcherId, t) {
  const biz = Number((await client.query('SELECT COUNT(*) n FROM businesses WHERE character_id=$1', [t.id])).rows[0].n);
  const rackets = Number((await client.query('SELECT COUNT(*) n FROM character_rackets WHERE character_id=$1', [t.id])).rows[0].n);
  const gm = (await client.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [t.id])).rows[0];
  let territory = 0, family = null;
  if (gm) {
    territory = Number((await client.query(
      'SELECT COUNT(*) n FROM territory_rackets WHERE owner_gang=$1', [gm.gang_id])).rows[0].n);
    family = (await client.query('SELECT name FROM gangs WHERE id=$1', [gm.gang_id])).rows[0]?.name || null;
  }
  // the money signal a tap is worth: is this mark HUNTING the watcher right now?
  const huntingYou = !!(await client.query('SELECT 1 FROM searches WHERE hunter=$1 AND target=$2', [t.id, watcherId])).rows[0];
  return {
    target: t.id, name: t.name, level: levelOf(Number(t.respect)), loc: t.loc,
    law: { stage: rapStageOf(t.heat_exposure, t.indicted_at), indicted: !!t.indicted_at, heat: heatBand(t.heat) },
    wealth: wealthBand(Number(t.cash) + Number(t.bank)),
    ops: { businesses: biz, rackets, territory, family },
    huntingYou,
    wanted: !!(t.wanted_until && new Date(t.wanted_until) > new Date()),
  };
}

// POST /v1/wire/tap/:targetId — place (or refresh) a wiretap. A $OMR sink, time-boxed, capped concurrent.
export async function placeTap(ch, targetId, client, h) {
  if (targetId === ch.id) throw new GameError('self', "You don't need a wire to know your own business.");
  const t = (await client.query('SELECT id FROM characters WHERE id=$1 AND alive', [targetId])).rows[0];
  if (!t) throw new GameError('gone', 'No such mark on the street.');
  const active = (await client.query(
    'SELECT target_character FROM wiretaps WHERE watcher_character=$1 AND expires_at > now()', [ch.id])).rows.map((r) => r.target_character);
  if (!active.includes(targetId) && active.length >= WIRE.TAP_MAX)
    throw new GameError('capped', `You're already running ${WIRE.TAP_MAX} wires — pull one before you set another.`);
  await spendOmr(client, h, WIRE.TAP_OMR, 'intel:wiretap');
  const exp = new Date(Date.now() + WIRE.TAP_MS);
  const upd = await client.query('UPDATE wiretaps SET expires_at=$3, created_at=now() WHERE watcher_character=$1 AND target_character=$2', [ch.id, targetId, exp]);
  if (!upd.rowCount) await client.query('INSERT INTO wiretaps (watcher_character, target_character, expires_at) VALUES ($1,$2,$3)', [ch.id, targetId, exp]);
  await bumpIntelOps(client, ch.account_id);
  await h.track(client, ch.account_id, 'wiretap', { target: targetId });
  return { ok: true, target: targetId, spent: WIRE.TAP_OMR, expiresSeconds: Math.ceil(WIRE.TAP_MS / 1000) };
}

// POST /v1/wire/sweep — sweep your lines clean of bugs. A $OMR sink; FREE (uncharged) when you're clean.
export async function sweepBugs(ch, client, h) {
  // count only LIVE watchers' bugs (join alive — parity with the huntersCount threat read, so a dead
  // surveiller's un-swept row isn't a phantom bug the victim pays to clear)
  const bugs = Number((await client.query(
    `SELECT COUNT(*) n FROM wiretaps w JOIN characters c ON c.id = w.watcher_character AND c.alive
       WHERE w.target_character=$1 AND w.expires_at > now()`, [ch.id])).rows[0].n);
  if (bugs === 0) return { ok: true, bugsFound: 0, clean: true, spent: 0 }; // nothing to sweep — no charge (the peek precedent)
  await spendOmr(client, h, WIRE.SWEEP_OMR, 'intel:sweep');
  await client.query('DELETE FROM wiretaps WHERE target_character=$1', [ch.id]);
  await bumpIntelOps(client, ch.account_id);
  await h.track(client, ch.account_id, 'wire_sweep', { bugs });
  return { ok: true, spent: WIRE.SWEEP_OMR, bugsFound: bugs };
}

// POST /v1/wire/trace — THE BUG TRACE (step two): NAME every live watcher bugging you (counter-intel —
// the defensive sweep's offensive twin: now you know WHO to tap back or hit). A bigger $OMR sink; does
// NOT clear the bugs (that's the cheaper sweep's job) — the layered intel economy. FREE when clean.
export async function traceBugs(ch, client, h) {
  const watchers = (await client.query(
    `SELECT c.id, c.name, w.expires_at FROM wiretaps w JOIN characters c ON c.id = w.watcher_character AND c.alive
       WHERE w.target_character=$1 AND w.expires_at > now() ORDER BY w.created_at`, [ch.id])).rows;
  if (!watchers.length) return { ok: true, bugsFound: 0, clean: true, spent: 0, watchers: [] }; // nothing to trace — no charge (the sweep/peek precedent)
  await spendOmr(client, h, WIRE.TRACE_OMR, 'intel:trace');
  await bumpIntelOps(client, ch.account_id);
  await h.track(client, ch.account_id, 'wire_trace', { bugs: watchers.length });
  return { ok: true, spent: WIRE.TRACE_OMR, bugsFound: watchers.length,
    watchers: watchers.map((w) => ({ id: w.id, name: w.name, expiresSeconds: Math.max(0, Math.ceil((new Date(w.expires_at) - Date.now()) / 1000)) })) };
}

// POST /v1/wire/dossier/:targetId — THE DOSSIER (step two): a one-shot DEEP read on a mark — their kill
// record, their flags, their family role, and WHO THEY'RE WATCHING (counter-intel). Deliberately NO exact
// cash (the banded wealth read holds — the audit's anti-precise-kill-EV rule). A $OMR sink; pay to know.
export async function pullDossier(ch, targetId, client, h) {
  if (targetId === ch.id) throw new GameError('self', "You don't compile a dossier on yourself.");
  const t = (await client.query('SELECT * FROM characters WHERE id=$1 AND alive', [targetId])).rows[0];
  if (!t) throw new GameError('gone', 'No such mark on the street.');
  await spendOmr(client, h, WIRE.DOSSIER_OMR, 'intel:dossier');
  await bumpIntelOps(client, ch.account_id);
  const kills = Number((await client.query('SELECT COUNT(*) n FROM kill_log WHERE killer_account=$1', [t.account_id])).rows[0].n);
  const deaths = Number((await client.query('SELECT COUNT(*) n FROM kill_log WHERE victim_account=$1', [t.account_id])).rows[0].n);
  const rat = !!(await client.query('SELECT rat FROM account_persistent WHERE account_id=$1', [t.account_id])).rows[0]?.rat;
  const gm = (await client.query(
    'SELECT g.name, m.role FROM gang_members m JOIN gangs g ON g.id = m.gang_id WHERE m.character_id=$1', [t.id])).rows[0];
  const watching = (await client.query(
    `SELECT c.name FROM wiretaps w JOIN characters c ON c.id = w.target_character AND c.alive
       WHERE w.watcher_character=$1 AND w.expires_at > now()`, [t.id])).rows.map((r) => r.name);
  await h.track(client, ch.account_id, 'wire_dossier', { target: targetId });
  return { ok: true, spent: WIRE.DOSSIER_OMR,
    dossier: {
      name: t.name, level: levelOf(Number(t.respect)), loc: t.loc,
      law: { stage: rapStageOf(t.heat_exposure, t.indicted_at), indicted: !!t.indicted_at, heat: heatBand(t.heat) },
      wealth: wealthBand(Number(t.cash) + Number(t.bank)), // banded, never exact (the audit rule)
      record: { kills, deaths },
      flags: { wanted: !!(t.wanted_until && new Date(t.wanted_until) > new Date()), welsher: !!t.welsher, rat, indicted: !!t.indicted_at },
      family: gm ? { name: gm.name, role: gm.role } : null,
      watching, // who this mark has wires on — counter-intel
    } };
}

// POST /v1/wire/subscribe — the Street Wire premium feed (a recurring $OMR subscription). Extends from
// the later of now / the current end (the retainer/envelope precedent).
export async function subscribeWire(ch, client, h) {
  await spendOmr(client, h, WIRE.SUB_OMR, 'intel:wire');
  const base = wireActive(ch) ? new Date(ch.wire_until).getTime() : Date.now();
  ch.wire_until = new Date(base + WIRE.SUB_MS);
  await bumpIntelOps(client, ch.account_id);
  await h.track(client, ch.account_id, 'wire_sub', {});
  return { ok: true, spent: WIRE.SUB_OMR, wireSeconds: Math.ceil((new Date(ch.wire_until) - Date.now()) / 1000) };
}

// GET /v1/wire — the terminal: your live taps + intel, the ticker tape, and (if subscribed) the
// intelligence service (forecasts, threat chatter, the war room). Runs under withCharacter.
export async function wireBoard(ch, client, h) {
  const sub = wireActive(ch);
  const taps = (await client.query(
    `SELECT t.*, w.expires_at AS tap_expires FROM wiretaps w
       JOIN characters t ON t.id = w.target_character AND t.alive
      WHERE w.watcher_character=$1 AND w.expires_at > now() ORDER BY w.created_at DESC`, [ch.id])).rows;
  const intel = [];
  for (const t of taps) {
    const i = await tapIntel(client, ch.id, t);
    i.expiresSeconds = Math.max(0, Math.ceil((new Date(t.tap_expires) - Date.now()) / 1000));
    intel.push(i);
  }
  const day = dayOf();
  const tape = PORTFOLIO.TICKERS.map((tk) => {
    const price = tickerPriceOf(tk.id, day), prev = tickerPriceOf(tk.id, day - 1);
    return { ticker: tk.id, name: tk.name, price, dayChange: prev ? Math.round(((price - prev) / prev) * 10000) / 100 : 0 };
  });
  const mover = tape.slice().sort((a, b) => Math.abs(b.dayChange) - Math.abs(a.dayChange))[0] || null;
  const bugsOnYou = Number((await client.query(
    `SELECT COUNT(*) n FROM wiretaps w JOIN characters c ON c.id = w.watcher_character AND c.alive
       WHERE w.target_character=$1 AND w.expires_at > now()`, [ch.id])).rows[0].n);
  // THE SPYMASTER — your lifetime intel ops + rank (account-level, survives death)
  const ops = Number((await client.query('SELECT intel_ops FROM account_persistent WHERE account_id=$1', [ch.account_id])).rows[0]?.intel_ops || 0);
  const board = {
    subscribed: sub, subSeconds: sub ? Math.max(0, Math.ceil((new Date(ch.wire_until) - Date.now()) / 1000)) : 0,
    costs: { tap: WIRE.TAP_OMR, sweep: WIRE.SWEEP_OMR, sub: WIRE.SUB_OMR, trace: WIRE.TRACE_OMR, dossier: WIRE.DOSSIER_OMR }, tapMax: WIRE.TAP_MAX,
    spymaster: { ops, rank: spyRankOf(ops).name },
    taps: intel, bugsOnYou, tape, mover,
  };
  if (sub) {
    // threat chatter — a COUNT of who has a search out on you (never names; a tap IDs a specific rival,
    // the peek names funders — the layered intel economy) + open contracts on your head.
    const huntersCount = Number((await client.query(
      'SELECT COUNT(*) n FROM searches s JOIN characters c ON c.id = s.hunter AND c.alive WHERE s.target=$1', [ch.id])).rows[0].n);
    const contracts = (await client.query(
      'SELECT kind, amount FROM bounties WHERE target_character=$1 AND (expires_at IS NULL OR expires_at > now())', [ch.id])).rows
      .map((b) => ({ kind: b.kind, pot: Math.floor(Number(b.amount)) }));
    board.premium = {
      forecast: cityForecast(),
      threats: { huntersCount, contracts },
      warRoom: h.owned.gang
        ? { name: h.owned.gang.name, held: h.owned.held || [],
            war: h.owned.gang.war_with ? { with: h.owned.gang.war_with, us: h.owned.gang.war_score_us, them: h.owned.gang.war_score_them } : null }
        : null,
    };
  }
  return board;
}

// GET /v1/leaderboard/wire — THE SPYMASTER board: the base's busiest intel operators by lifetime
// intel ops (living stewards of an account-level, death-surviving status axis). Pure status.
export async function wireLeaderboard(pool) {
  const rows = (await pool.query(
    `SELECT a.intel_ops, c.name FROM account_persistent a JOIN characters c ON c.account_id=a.account_id AND c.alive
      WHERE a.intel_ops > 0 ORDER BY a.intel_ops DESC LIMIT 15`)).rows;
  return { spies: rows.map((r) => ({ name: r.name, ops: Number(r.intel_ops), rank: spyRankOf(r.intel_ops).name })) };
}

// Worker: sweep expired wiretaps (row hygiene — reads already filter expires_at, this just tidies).
export async function sweepWire(pool) {
  const r = await pool.query('DELETE FROM wiretaps WHERE expires_at <= now()');
  return { swept: r.rowCount || 0 };
}

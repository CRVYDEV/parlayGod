// THE WIRE — the intelligence terminal (design omerta-the-wire-and-revenue-design.md). Information as
// a spendable resource. WIRETAPS surveil a rival for a window (a $OMR sink); SWEEP clears bugs on you;
// the STREET WIRE is a recurring $OMR subscription that upgrades the feed into an intelligence service
// (forecasts, threat chatter, the ticker tape, the war room). Off-chain, §10.4-clean — every burn is an
// intel:* $OMR sink through the vanity spendOmr till (rides the existing intel: vocabulary, so ZERO
// invariant changes). A tap READ is an UNLOCKED point-in-time lookup (surveillance, not a two-party
// action) — no lock complexity; reads filter expires_at and JOIN to `alive`, so a dead party's wire
// goes silent, and the worker sweeps expired rows. The layered intel economy: the SUB warns you (a
// hunter COUNT), a TAP identifies whether a SPECIFIC rival is hunting you, the peek names funders.
import { GameError, notify, ledger } from './game.js';
import { WIRE, wireActive, wireTierOf, wireSubTier, disinfoActive, spyRankOf, spyPerksOf, intelCost, rapStageOf, cityForecast, tickerPriceOf, PORTFOLIO, levelOf, dayOf, hash01 } from './rules.js';
import { spendOmr } from './vanity.js';

// STEP FOUR — the account's lifetime intel-ops (the SPYMASTER rank basis) → its TRADECRAFT perks
const spyOps = async (client, accountId) =>
  Number((await client.query('SELECT intel_ops FROM account_persistent WHERE account_id=$1', [accountId])).rows[0]?.intel_ops || 0);

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

// step three — DISINFORMATION: a mark running disinfo feeds any WIRETAP cooked PRIVATE signals
// (wealth/law/heat/ops/hunting), deterministic-but-wrong so the tap can't tell it's fake — but PUBLIC
// bulletins (wanted, family name, level, location) stay true (you can cook your books, not the street's
// eyes). An INFORMANT (a human source) pierces this — it never scrambles. Silent by design: the counter
// is to run an informant or pull a dossier (hard records), not a "this is fake" flag.
const WEALTH_BANDS = ['broke', 'getting by', 'comfortable', 'flush', 'a whale — deep pockets'];
const HEAT_BANDS = ['cold', 'warm', 'hot', 'red hot'];
const LAW_STAGES = ['clean', 'watched', 'investigation'];
function scrambleTap(intel, t) {
  const s = hash01('disinfo:' + t.id + ':' + dayOf());   // stable within a day, wrong on purpose
  return {
    ...intel,
    law: { stage: LAW_STAGES[Math.floor(s * 300) % 3], indicted: false, heat: HEAT_BANDS[Math.floor(s * 400) % 4] },
    wealth: WEALTH_BANDS[Math.floor(s * 500) % 5],
    ops: { ...intel.ops, businesses: Math.floor(s * 7) % 5, rackets: Math.floor(s * 70) % 4, territory: 0 }, // family (public record) stays true
    huntingYou: false,   // the disinfo hides the hunt from a bug
  };
}

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
  const ops = await spyOps(client, ch.account_id);            // step four: your spymaster tradecraft
  const cap = WIRE.TAP_MAX + spyPerksOf(ops).tapBonus;         // a higher rank runs more wires
  const active = (await client.query(
    'SELECT target_character FROM wiretaps WHERE watcher_character=$1 AND expires_at > now()', [ch.id])).rows.map((r) => r.target_character);
  if (!active.includes(targetId) && active.length >= cap)
    throw new GameError('capped', `You're already running ${cap} wires — pull one before you set another.`);
  const cost = intelCost(WIRE.TAP_OMR, ops);                   // rank discount (the discounted amount is ledgered)
  await spendOmr(client, h, cost, 'intel:wiretap');
  const exp = new Date(Date.now() + WIRE.TAP_MS);
  // reset the watchdog alert flags on a place/refresh — a fresh surveillance gives fresh alerts
  const upd = await client.query('UPDATE wiretaps SET expires_at=$3, created_at=now(), alerted_hunt=false, alerted_wanted=false, alerted_indicted=false WHERE watcher_character=$1 AND target_character=$2', [ch.id, targetId, exp]);
  if (!upd.rowCount) await client.query('INSERT INTO wiretaps (watcher_character, target_character, expires_at) VALUES ($1,$2,$3)', [ch.id, targetId, exp]);
  await bumpIntelOps(client, ch.account_id);
  await h.track(client, ch.account_id, 'wiretap', { target: targetId });
  return { ok: true, target: targetId, spent: cost, expiresSeconds: Math.ceil(WIRE.TAP_MS / 1000) };
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

// POST /v1/wire/disinfo — STEP THREE, DISINFORMATION: plant false intel so any WIRETAP reading you gets
// cooked private signals for a window (defensive counter-intel). A $OMR sink. `disinfo_until` is written
// by DIRECT SQL (outside persistCharacter's positional UPDATE — the wire_until/active_at pattern) so the
// write survives the persist; ch.disinfo_until (loaded via SELECT *) reads it back in-txn.
export async function plantDisinfo(ch, client, h) {
  await spendOmr(client, h, WIRE.DISINFO_OMR, 'intel:disinfo');
  const until = new Date(Date.now() + WIRE.DISINFO_MS);
  await client.query('UPDATE characters SET disinfo_until=$2 WHERE id=$1', [ch.id, until]);
  ch.disinfo_until = until;
  await bumpIntelOps(client, ch.account_id);
  await h.track(client, ch.account_id, 'wire_disinfo', {});
  return { ok: true, spent: WIRE.DISINFO_OMR, disinfoSeconds: Math.ceil(WIRE.DISINFO_MS / 1000) };
}

// POST /v1/wire/informant/:targetId — STEP THREE, THE INFORMANT: put a standing HUMAN source on a rival.
// A recurring $OMR retainer (extends from the later of now / current end — the sub precedent), capped
// concurrent. Reads DEEPER than a tap (who they're hunting, not just you) and PIERCES disinfo (a mole
// isn't fooled by cooked books). One per (watcher, target).
export async function recruitInformant(ch, targetId, client, h) {
  if (targetId === ch.id) throw new GameError('self', "You don't need an informant on yourself.");
  const t = (await client.query('SELECT id FROM characters WHERE id=$1 AND alive', [targetId])).rows[0];
  if (!t) throw new GameError('gone', 'No such mark on the street.');
  const active = (await client.query(
    'SELECT target_character FROM wire_informants WHERE watcher_character=$1 AND paid_until > now()', [ch.id])).rows.map((r) => r.target_character);
  if (!active.includes(targetId) && active.length >= WIRE.INFORMANT_MAX)
    throw new GameError('capped', `You keep ${WIRE.INFORMANT_MAX} informants on retainer — let one lapse first.`);
  const infCost = intelCost(WIRE.INFORMANT_OMR, await spyOps(client, ch.account_id)); // step four: rank discount
  await spendOmr(client, h, infCost, 'intel:informant');
  const cur = (await client.query('SELECT paid_until FROM wire_informants WHERE watcher_character=$1 AND target_character=$2', [ch.id, targetId])).rows[0];
  const base = cur && new Date(cur.paid_until) > new Date() ? new Date(cur.paid_until).getTime() : Date.now();
  const until = new Date(base + WIRE.INFORMANT_MS);
  const upd = await client.query('UPDATE wire_informants SET paid_until=$3 WHERE watcher_character=$1 AND target_character=$2', [ch.id, targetId, until]);
  if (!upd.rowCount) await client.query('INSERT INTO wire_informants (watcher_character, target_character, paid_until) VALUES ($1,$2,$3)', [ch.id, targetId, until]);
  await bumpIntelOps(client, ch.account_id);
  await h.track(client, ch.account_id, 'wire_informant', { target: targetId });
  return { ok: true, target: targetId, spent: infCost, paidSeconds: Math.ceil((until - Date.now()) / 1000) };
}

// the deeper HUMAN-source read — the TRUE intel (never scrambled) + who the mark is hunting (anyone)
async function informantIntel(client, watcherId, t) {
  const i = await tapIntel(client, watcherId, t);   // the unscrambled truth (the caller never applies scrambleTap to this)
  const huntingAnyone = Number((await client.query('SELECT COUNT(*) n FROM searches WHERE hunter=$1', [t.id])).rows[0].n);
  return { ...i, huntingAnyone, source: 'informant' };
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
  const dosCost = intelCost(WIRE.DOSSIER_OMR, await spyOps(client, ch.account_id)); // step four: rank discount
  await spendOmr(client, h, dosCost, 'intel:dossier');
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
  return { ok: true, spent: dosCost,
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

// POST /v1/wire/subscribe {tier} — the Street Wire premium feed (a recurring $OMR subscription). STEP
// FIVE: a TIERED ladder — a higher tier costs more $OMR, unlocks the war room, and grants STANDING-WATCH
// slots (the auto-tap automation). Extends the window from the later of now / the current end (the
// retainer/envelope precedent); buying a tier SETS that tier (wire_tier by direct SQL — off the persist
// positional UPDATE, the disinfo_until pattern). A lower tier bought while a higher one is live downgrades
// the tier but still extends the window (the player's call).
export async function subscribeWire(ch, tier, client, h) {
  const t = wireSubTier(tier == null ? 1 : tier);
  await spendOmr(client, h, t.omr, 'intel:wire');
  const base = wireActive(ch) ? new Date(ch.wire_until).getTime() : Date.now();
  ch.wire_until = new Date(base + t.ms);
  await client.query('UPDATE characters SET wire_tier=$2 WHERE id=$1', [ch.id, t.tier]);
  ch.wire_tier = t.tier;
  await bumpIntelOps(client, ch.account_id);
  await h.track(client, ch.account_id, 'wire_sub', { tier: t.tier });
  return { ok: true, spent: t.omr, tier: t.tier, tierName: t.name, watchSlots: t.watchSlots,
    wireSeconds: Math.ceil((new Date(ch.wire_until) - Date.now()) / 1000) };
}

// POST /v1/wire/watch/:targetId — STEP FIVE, THE STANDING WATCH: enroll a mark so the worker AUTO-RENEWS
// the wiretap on them (the surveillance runs while you're offline — no manual re-tapping). Requires an
// active subscription; capped at the sub TIER's watchSlots. Places the tap NOW (charged through the
// normal placeTap sink) and records the enrollment; the worker keeps it live (burning intel:watch each
// cycle, bounded by your $OMR). A pure automation over the existing tap — no new value flow at enroll.
export async function enrollWatch(ch, targetId, client, h) {
  if (targetId === ch.id) throw new GameError('self', "You don't stand a watch on your own line.");
  const tierN = wireTierOf(ch);
  if (!tierN) throw new GameError('no_sub', 'A standing watch needs an active Street Wire subscription.');
  const slots = wireSubTier(tierN).watchSlots;
  if (slots <= 0) throw new GameError('tier', 'Upgrade the Wire (tier 2+) to run standing watches.');
  const t = (await client.query('SELECT id FROM characters WHERE id=$1 AND alive', [targetId])).rows[0];
  if (!t) throw new GameError('gone', 'No such mark on the street.');
  const already = !!(await client.query('SELECT 1 FROM wire_watches WHERE watcher_character=$1 AND target_character=$2', [ch.id, targetId])).rows[0];
  if (!already) {
    const n = Number((await client.query('SELECT COUNT(*) n FROM wire_watches WHERE watcher_character=$1', [ch.id])).rows[0].n);
    if (n >= slots) throw new GameError('watch_full', `Your Wire runs ${slots} standing watch${slots === 1 ? '' : 'es'} — drop one first.`);
  }
  await placeTap(ch, targetId, client, h);   // place/refresh the tap now (the normal intel:wiretap sink)
  if (!already) await client.query('INSERT INTO wire_watches (watcher_character, target_character) VALUES ($1,$2)', [ch.id, targetId]);
  await h.track(client, ch.account_id, 'wire_watch', { target: targetId });
  return { ok: true, target: targetId, standing: true, watchSlots: slots };
}

// DELETE /v1/wire/watch/:targetId — drop a standing watch (the tap lapses on its own; you keep the wire
// until it expires, it just won't auto-renew).
export async function cancelWatch(ch, targetId, client, h) {
  const r = await client.query('DELETE FROM wire_watches WHERE watcher_character=$1 AND target_character=$2', [ch.id, targetId]);
  if (!r.rowCount) throw new GameError('no_watch', "You've no standing watch on that mark.");
  await h.track(client, ch.account_id, 'wire_watch_cancel', { target: targetId });
  return { ok: true, target: targetId, standing: false };
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
    let i = await tapIntel(client, ch.id, t);
    if (disinfoActive(t)) i = scrambleTap(i, t);   // step three: a mark running disinfo feeds the bug lies
    i.expiresSeconds = Math.max(0, Math.ceil((new Date(t.tap_expires) - Date.now()) / 1000));
    intel.push(i);
  }
  // step three — THE INFORMANTS: your standing human sources (the TRUE read, unscrambled — a mole pierces disinfo)
  const infoRows = (await client.query(
    `SELECT t.*, wi.paid_until FROM wire_informants wi
       JOIN characters t ON t.id = wi.target_character AND t.alive
      WHERE wi.watcher_character=$1 AND wi.paid_until > now() ORDER BY wi.created_at DESC`, [ch.id])).rows;
  const informants = [];
  for (const t of infoRows) {
    const i = await informantIntel(client, ch.id, t);
    i.paidSeconds = Math.max(0, Math.ceil((new Date(t.paid_until) - Date.now()) / 1000));
    informants.push(i);
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
  // THE SPYMASTER — your lifetime intel ops + rank (account-level, survives death) + step-four TRADECRAFT
  const ops = Number((await client.query('SELECT intel_ops FROM account_persistent WHERE account_id=$1', [ch.account_id])).rows[0]?.intel_ops || 0);
  const perks = spyPerksOf(ops);
  const disinfo = disinfoActive(ch);
  // STEP FIVE — the subscription TIER + the STANDING WATCHES (auto-renewed taps)
  const tierN = wireTierOf(ch);
  const tierCfg = tierN ? wireSubTier(tierN) : null;
  const liveTapSet = new Set(intel.map((i) => i.target));
  const watchRows = (await client.query(
    `SELECT c.id, c.name FROM wire_watches wa JOIN characters c ON c.id = wa.target_character AND c.alive
       WHERE wa.watcher_character=$1 ORDER BY wa.created_at`, [ch.id])).rows;
  const watches = watchRows.map((w) => ({ target: w.id, name: w.name, live: liveTapSet.has(w.id) }));
  const board = {
    subscribed: sub, subSeconds: sub ? Math.max(0, Math.ceil((new Date(ch.wire_until) - Date.now()) / 1000)) : 0,
    subTier: tierN, subTierName: tierCfg ? tierCfg.name : null,
    subTiers: WIRE.SUB_TIERS.map((t) => ({ tier: t.tier, name: t.name, omr: t.omr, watchSlots: t.watchSlots, warRoom: t.warRoom })),
    watchSlots: tierCfg ? tierCfg.watchSlots : 0, watches,
    // step four: intel-read costs are the DISCOUNTED (rank-adjusted) prices; defensive/sub costs are flat
    costs: { tap: intelCost(WIRE.TAP_OMR, ops), sweep: WIRE.SWEEP_OMR, sub: WIRE.SUB_OMR, trace: WIRE.TRACE_OMR, dossier: intelCost(WIRE.DOSSIER_OMR, ops), disinfo: WIRE.DISINFO_OMR, informant: intelCost(WIRE.INFORMANT_OMR, ops) },
    tapMax: WIRE.TAP_MAX + perks.tapBonus, informantMax: WIRE.INFORMANT_MAX,
    spymaster: { ops, rank: spyRankOf(ops).name, tapBonus: perks.tapBonus, discountBps: perks.discountBps },
    // step four THE WATCHDOG: a subscriber gets pushed 'wire_alert' notifications when a tapped mark turns hot
    watchdog: sub && intel.length > 0,
    taps: intel, informants, bugsOnYou, tape, mover,
    // step three: your own disinformation window (you feed anyone tapping you cooked private signals)
    disinfo: { active: disinfo, seconds: disinfo ? Math.max(0, Math.ceil((new Date(ch.disinfo_until) - Date.now()) / 1000)) : 0 },
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
      // the war room is a TIER-2+ perk (the Wire Room / Switchboard) — tier 1 gets forecast + threats + tape
      warRoom: (tierCfg && tierCfg.warRoom && h.owned.gang)
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

// Worker: sweep expired wiretaps + informant retainers (row hygiene — reads already filter, this tidies).
export async function sweepWire(pool) {
  const r = await pool.query('DELETE FROM wiretaps WHERE expires_at <= now()');
  const i = await pool.query('DELETE FROM wire_informants WHERE paid_until <= now()');
  return { swept: (r.rowCount || 0) + (i.rowCount || 0) };
}

// STEP FIVE — THE STANDING WATCH: the worker keeps enrolled taps LIVE by auto-renewing them from the
// watcher's $OMR. For each subscribed, alive watcher, take their first `watchSlots` enrollments (the sub
// tier's cap — so letting the sub drop to a lower tier renews fewer) and, if a watch's tap is at/near
// lapse, burn the (rank-discounted) tap cost and (re)place/EXTEND the tap — WITHOUT resetting the
// watchdog alert flags (an auto-renew keeps the wire live but doesn't re-arm spent alerts, so no spam).
// Bounded by the watcher's $OMR: broke → the watch pauses (the tap lapses; a re-fund/re-sub resumes it).
// §10.4-clean: intel:watch is a $OMR BURN under the existing intel: vocabulary (no new bucket/faucet).
// LOCK ORDER: account_persistent[watcher] FOR UPDATE (serializes vs withCharacter/persistAccount so the
// omr decrement can't be clobbered), then the leaf tap row — no character rows locked, so no cycle.
export async function sweepStandingWatches(pool, renewWithinMs = 30 * 60 * 1000) {
  // subscribed, alive watchers who hold at least one standing watch
  const watchers = (await pool.query(
    `SELECT DISTINCT wc.id, wc.account_id, wc.wire_tier
       FROM wire_watches wa
       JOIN characters wc ON wc.id = wa.watcher_character AND wc.alive AND wc.wire_until > now()`)).rows;
  let renewed = 0, paused = 0;
  for (const w of watchers) {
    const cfg = wireSubTier(w.wire_tier || 1);
    if (cfg.watchSlots <= 0) continue;                     // tier 1 (or a bad tier) runs no standing watches
    // the enrollments this sub tier actually covers (oldest first), only against LIVE targets
    const rows = (await pool.query(
      `SELECT wa.target_character AS target, t.name
         FROM wire_watches wa JOIN characters t ON t.id = wa.target_character AND t.alive
        WHERE wa.watcher_character=$1 ORDER BY wa.created_at LIMIT $2`, [w.id, cfg.watchSlots])).rows;
    if (!rows.length) continue;
    const ops = Number((await pool.query('SELECT intel_ops FROM account_persistent WHERE account_id=$1', [w.account_id])).rows[0]?.intel_ops || 0);
    const cost = intelCost(WIRE.TAP_OMR, ops);
    for (const r of rows) {
      // is the tap missing or lapsing within the renew window? (only renew when it needs it — not every tick)
      const tap = (await pool.query('SELECT expires_at FROM wiretaps WHERE watcher_character=$1 AND target_character=$2', [w.id, r.target])).rows[0];
      if (tap && new Date(tap.expires_at).getTime() - Date.now() > renewWithinMs) continue; // still comfortably live
      // affordability + burn under the account lock (serializes vs persistAccount — no clobber)
      const bal = (await pool.query('SELECT omr FROM account_persistent WHERE account_id=$1 FOR UPDATE', [w.account_id])).rows[0];
      if (!bal || Number(bal.omr) < cost) { paused++; continue; }  // broke — the watch pauses (tap lapses)
      await pool.query('UPDATE account_persistent SET omr = omr - $2 WHERE account_id=$1', [w.account_id, cost]);
      await ledger(pool, { accountId: w.account_id, currency: 'omr', amount: -cost, reason: 'intel:watch' });
      const exp = new Date(Date.now() + WIRE.TAP_MS);
      const upd = await pool.query('UPDATE wiretaps SET expires_at=$3 WHERE watcher_character=$1 AND target_character=$2', [w.id, r.target, exp]);
      if (!upd.rowCount) await pool.query('INSERT INTO wiretaps (watcher_character, target_character, expires_at) VALUES ($1,$2,$3)', [w.id, r.target, exp]);
      await pool.query('UPDATE account_persistent SET intel_ops = intel_ops + 1 WHERE account_id=$1', [w.account_id]);
      renewed++;
    }
  }
  return { renewed, paused };
}

// STEP FOUR — THE WATCHDOG: the push layer the pull-only intel service lacked. A SUBSCRIBED watcher
// (the premium Street Wire) gets a live `wire_alert` the moment a mark they're tapping crosses into a
// noteworthy state — starts HUNTING them (a search on the watcher), goes WANTED, or gets INDICTED. Fired
// ONCE per event per tap (per-tap flags, reset on a place/refresh), so no spam. Self-contained (no
// cross-module hooks) — the worker re-derives the mark's state each tick. §10.4-untouched (pushes a
// notification, moves no value). Only LIVE taps whose watcher is alive AND subscribed qualify.
export async function sweepWireAlerts(pool) {
  const taps = (await pool.query(
    `SELECT w.watcher_character, w.target_character, t.name, t.wanted_until, t.indicted_at
       FROM wiretaps w
       JOIN characters t  ON t.id  = w.target_character  AND t.alive
       JOIN characters wc ON wc.id = w.watcher_character AND wc.alive
      WHERE w.expires_at > now() AND wc.wire_until > now()`)).rows;
  let fired = 0;
  // CLAIM-then-notify (the fees/store idempotency discipline): the flag-set is the ATOMIC guard —
  // `AND <col>=false` means only the first pass to flip false→true wins the row, so a concurrent
  // worker / retry can't double-fire the alert. The notify fires ONLY for the claim winner.
  const claim = async (w, col) =>
    (await pool.query(`UPDATE wiretaps SET ${col}=true WHERE watcher_character=$1 AND target_character=$2 AND ${col}=false`,
      [w.watcher_character, w.target_character])).rowCount > 0;
  for (const w of taps) {
    const wanted = !!(w.wanted_until && new Date(w.wanted_until) > new Date());
    const indicted = !!w.indicted_at;
    const hunting = !!(await pool.query('SELECT 1 FROM searches WHERE hunter=$1 AND target=$2', [w.target_character, w.watcher_character])).rows[0];
    if (hunting && await claim(w, 'alerted_hunt')) { await notify(pool, w.watcher_character, 'wire_alert', { target: w.target_character, name: w.name, event: 'hunting_you' }); fired++; }
    if (wanted && await claim(w, 'alerted_wanted')) { await notify(pool, w.watcher_character, 'wire_alert', { target: w.target_character, name: w.name, event: 'wanted' }); fired++; }
    if (indicted && await claim(w, 'alerted_indicted')) { await notify(pool, w.watcher_character, 'wire_alert', { target: w.target_character, name: w.name, event: 'indicted' }); fired++; }
  }
  return { fired };
}

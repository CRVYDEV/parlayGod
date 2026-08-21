// TONIGHT IN THE CITY (omerta-first-contact-and-events-design.md, MOVE 2) — the live-events aggregator.
//
// The game has genuinely anticipation-worthy SCHEDULED events — the boxing main event, the poker
// tournament, the grand prix, the stakes, the futurity, the server-wide megaproject — but every one was
// buried inside its own tab, so nothing told a player "a title fight is closing in 20 minutes, put money
// on it." Retention lives on anticipation; this surfaces it. A read-only aggregator: each event system
// already carries an open/booked/building status + a `resolves_at` (or progress/target), so this is a
// handful of cheap queries. §10.4-FREE by construction — reads only, no ledger vocabulary; the test
// proves it by counting rows.
import crypto from 'node:crypto';
import { megaMonumentAt } from './rules.js';
import { primeTimeSummary } from './primetime.js';   // events.js → primetime.js → game.js is acyclic (game.js imports neither)

const secsTo = (ts) => Math.max(0, Math.floor((new Date(ts).getTime() - Date.now()) / 1000));

// ── THE RESULTS SHOW — the payoff beat that TONIGHT IN THE CITY was missing. The marquee events (the
// title fight, the tournament, the grand prix, the futurity, the stakes) all resolve SILENTLY in the
// worker and land as a one-line feed entry; a spectator who bet gets cash with no moment. `recordEventResult`
// writes a server-wide log row (the public "what just happened" board) — the resolvers separately notify
// each stakeholder their personalized outcome, which is where the emotion is. A LOG, §10.4-FREE (no ledger).
export async function recordEventResult(client, { kind, icon, headline, winnerName = null, pool = 0, detail = {} }) {
  await client.query(
    'INSERT INTO event_results (id, kind, icon, headline, winner_name, pool, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [crypto.randomUUID(), kind, icon, String(headline).slice(0, 200), winnerName, Math.round(Number(pool) || 0), JSON.stringify(detail || {})]);
}

// the public spectator board — recent marquee results, newest first. No private data (a payout is per-player
// and rides the notification stream, never this board), so it can be keyless like the events board.
export async function resultsBoard(client, limit = 12) {
  const rows = (await client.query(
    'SELECT kind, icon, headline, winner_name, pool, resolved_at FROM event_results ORDER BY resolved_at DESC LIMIT $1', [limit])).rows;
  return rows.map((r) => ({
    kind: r.kind, icon: r.icon, headline: r.headline, winner: r.winner_name,
    pool: Number(r.pool) || 0, agoSeconds: Math.max(0, Math.floor((Date.now() - new Date(r.resolved_at).getTime()) / 1000)),
  }));
}

// ── THE BOARD — the open scheduled events, ranked soonest-closing first (the megaproject, which has
// progress rather than a clock, trails). Each is a compact card the Home strip renders with a live
// countdown + a jump to its tab. A live pool is real money already escrowed — the "be there" hook. ──
export async function cityEventBoard(client) {
  const events = [];
  const q = (sql) => client.query(sql).then((r) => r.rows).catch(() => []);

  // BOXING MAIN EVENT — a booked title/grudge card the crowd bets on, betting closes at resolves_at
  for (const b of await q("SELECT id, a_name, b_name, resolves_at FROM boxing_bouts WHERE status='booked' AND resolves_at > now() ORDER BY resolves_at LIMIT 4")) {
    events.push({ kind: 'boxing', icon: '🥊', title: 'Main Event',
      subtitle: `${b.a_name} vs ${b.b_name} — bet the card`, closesSeconds: secsTo(b.resolves_at), tab: 'boxing' });
  }
  // THE POKER TOURNAMENT — buy-ins escrow into the pool, the worker deals the field at close
  for (const t of await q("SELECT id, pool, resolves_at FROM poker_tournaments WHERE status='open' AND resolves_at > now() ORDER BY resolves_at LIMIT 2")) {
    events.push({ kind: 'poker', icon: '🃏', title: 'Poker Tournament',
      subtitle: `$${Number(t.pool || 0).toLocaleString()} pool — buy in at the Den`, closesSeconds: secsTo(t.resolves_at), tab: 'den' });
  }
  // THE GRAND PRIX — a car field, buy-ins escrow, the worker races them at close
  for (const g of await q("SELECT id, pool, resolves_at FROM grand_prix WHERE status='open' AND resolves_at > now() ORDER BY resolves_at LIMIT 2")) {
    events.push({ kind: 'grandprix', icon: '🏁', title: 'The Grand Prix',
      subtitle: `$${Number(g.pool || 0).toLocaleString()} pool — enter a car`, closesSeconds: secsTo(g.resolves_at), tab: 'races' });
  }
  // THE STAKES — a stable field, owners buy in
  for (const s of await q("SELECT id, pool, resolves_at FROM stakes_races WHERE status='open' AND resolves_at > now() ORDER BY resolves_at LIMIT 2")) {
    events.push({ kind: 'stakes', icon: '🐎', title: 'The Stakes',
      subtitle: `$${Number(s.pool || 0).toLocaleString()} pool — run a racer`, closesSeconds: secsTo(s.resolves_at), tab: 'stable' });
  }
  // THE FUTURITY — owners nominate racers, the whole town bets parimutuel on the field
  for (const f of await q("SELECT id, pool, resolves_at FROM futurities WHERE status='open' AND resolves_at > now() ORDER BY resolves_at LIMIT 2")) {
    events.push({ kind: 'futurity', icon: '🎠', title: 'The Futurity',
      subtitle: `$${Number(f.pool || 0).toLocaleString()} on the field — bet a runner`, closesSeconds: secsTo(f.resolves_at), tab: 'stable' });
  }
  // sort the clocked events soonest-first
  events.sort((a, b) => a.closesSeconds - b.closesSeconds);

  // THE MEGAPROJECT — no clock, a progress bar the whole server fills. Trails the clocked events.
  const mp = (await q("SELECT monument, seq, target, progress FROM megaprojects WHERE status='building' LIMIT 1"))[0];
  if (mp) {
    const mon = megaMonumentAt(Number(mp.seq));
    const target = Number(mp.target) || 1, progress = Number(mp.progress) || 0;
    events.push({ kind: 'megaproject', icon: '🏛', title: mon?.name || 'The Monument',
      subtitle: 'the city is building it — chip in', progress: Math.min(1, progress / target),
      pct: Math.round((progress / target) * 100), tab: 'city' });
  }

  // ALSO TODAY — the recurring den draws (always available: a daily numbers draw, today's race card, the
  // weekly fight). Not clocked events, so they ride a separate lighter list the console shows as "also today."
  // THE VIG POT rides the Numbers' own line — a live progressive figure is exactly the kind of
  // anticipation this strip exists to surface (a pure read; the pot is a den-book reservation).
  const jp = Math.floor(Number((await client.query('SELECT jackpot FROM den_volume WHERE id=1')).rows[0]?.jackpot || 0));
  const daily = [
    { kind: 'numbers', icon: '🔢', title: 'The Numbers', jackpot: jp,
      subtitle: `pick 0–999, pays 600:1 — one ticket a day${jp > 0 ? ` · THE VIG POT rides at $${jp.toLocaleString('en-US')}` : ''}`, tab: 'den' },
    { kind: 'track', icon: '🏇', title: 'The Track', subtitle: "today's dogs & ponies — bet the card", tab: 'den' },
    { kind: 'fight', icon: '🥊', title: 'The Weekly Fight', subtitle: 'back a fighter before the bell', tab: 'den' },
  ];

  // PRIME TIME — the nightly synchronous window. Always present (a pure function of the clock, no DB
  // row), so it rides its own `primetime` field; when it's LIVE it also leads the clocked strip (the
  // most time-sensitive thing on the board — the whole city is out right now).
  const pt = primeTimeSummary();
  if (pt.live) events.unshift({ kind: pt.kind, icon: pt.icon, title: pt.title, subtitle: pt.subtitle, closesSeconds: pt.closesSeconds, tab: pt.tab });

  return { events, daily, primetime: pt };
}

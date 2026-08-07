// TONIGHT IN THE CITY (omerta-first-contact-and-events-design.md, MOVE 2) — the live-events aggregator.
//
// The game has genuinely anticipation-worthy SCHEDULED events — the boxing main event, the poker
// tournament, the grand prix, the stakes, the futurity, the server-wide megaproject — but every one was
// buried inside its own tab, so nothing told a player "a title fight is closing in 20 minutes, put money
// on it." Retention lives on anticipation; this surfaces it. A read-only aggregator: each event system
// already carries an open/booked/building status + a `resolves_at` (or progress/target), so this is a
// handful of cheap queries. §10.4-FREE by construction — reads only, no ledger vocabulary; the test
// proves it by counting rows.
import { megaMonumentAt } from './rules.js';

const secsTo = (ts) => Math.max(0, Math.floor((new Date(ts).getTime() - Date.now()) / 1000));

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
  const daily = [
    { kind: 'numbers', icon: '🔢', title: 'The Numbers', subtitle: 'pick 0–999, pays 600:1 — one ticket a day', tab: 'den' },
    { kind: 'track', icon: '🏇', title: 'The Track', subtitle: "today's dogs & ponies — bet the card", tab: 'den' },
    { kind: 'fight', icon: '🥊', title: 'The Weekly Fight', subtitle: 'back a fighter before the bell', tab: 'den' },
  ];

  return { events, daily };
}

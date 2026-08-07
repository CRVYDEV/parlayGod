// STILL ON THE TABLE — the cross-system pull the coach's queue can't carry.
//
// The coach (game.js coachLadder) names the SINGLE next step, priority-ordered, five deep — so for a
// mid/late player five more urgent rungs fill the queue and a whole system they've never touched (the
// Den, the Wire, the Stable) never surfaces. And the coach's one-time cross-system rungs stop at level
// 30. This board is the complement: it shows EVERY system the player has UNLOCKED by level and NEVER
// engaged with, all at once, at any level — a browsable "rackets you haven't worked yet" grid plus an
// explorer progress line (you've tried X of the N systems open to you). Completion-compulsion, pointed
// at the depth players don't know they have.
//
// PURE READ — no ledger row, no faucet, no new lever, ZERO §10.4 surface. It reads the same owned/acct
// state view() already holds, so it costs no extra query on the hot path (the route hands it loadOwned).
// The engagement signal for each system is either OWNERSHIP (owned.businesses/fighters/speakeasy/…), a
// mastery TRACK (any single action stamps it), or an account-level LEGEND that survives death — so a
// veteran heir is never told to "try" a system their bloodline mastered (the coach's self-clear rule).
import { levelOf, isMade } from './rules.js';

// The catalog lives HERE, not in a rules const: these are display copy + the honest player-facing gate
// (mirrored from coachLadder, the surface a player actually meets), not a signed economy lever — the
// coach's own rung copy lives in game.js and is not lever-pinned either. `at` is the unlock level; `hook`
// is the one-line pitch; `tab` is where the button jumps; `seen(ctx)` is true once the player has
// engaged. Ordered loosely by unlock so the EARLIEST ignored system leads (the most overdue).
const num = (v) => Number(v || 0);
const mastery = (owned, id) => num(owned?.mastery?.[id]);

export const SYSTEMS = [
  { id: 'family',    name: 'A Family',        at: 3,  tab: 'family',    hook: 'Join a family or found your own — turf, tribute, wars, and men at your back.',
    seen: (c) => !!c.owned.gangId },
  { id: 'empire',    name: 'The Empire',      at: 3,  tab: 'empire',    hook: 'Buy a racket — cheap passive income that pays while you sleep, no energy spent.',
    seen: (c) => (c.owned.rackets || []).length > 0 || (c.owned.assets || []).length > 0 },
  { id: 'crew',      name: 'A Crew',          at: 3,  tab: 'family',    hook: 'Run with a crew — a small band with a shared chat, mutual non-aggression, and a weekly job.',
    seen: (c) => !!c.owned.crewId },
  { id: 'skills',    name: 'Skills',          at: 4,  tab: 'life',      hook: 'Spend your skill points — hit harder, lay low cheaper, haul more. Free power you\'ve already earned.',
    seen: (c) => (c.owned.skills?.size || 0) > 0 },
  { id: 'trade',     name: 'The Trade Winds', at: 7,  tab: 'streets',   hook: 'Buy goods cheap where you stand, haul them where they\'re dear. The on-ramp to convoys and the market.',
    seen: (c) => mastery(c.owned, 'commerce') > 0 },
  { id: 'kitchen',   name: 'The Kitchen',     at: 8,  tab: 'kitchen',   hook: 'Cook and move product — the deepest earner in the city, and the one they can raid.',
    seen: (c) => !!c.ch.lab || mastery(c.owned, 'chemistry') > 0 },
  { id: 'heists',    name: 'Crew Heists',     at: 9,  tab: 'scores',    hook: 'Plan a big score or join one off the board. One roll pays the whole crew — bigger than any solo job.',
    seen: (c) => num(c.acct.heists_pulled) > 0 || mastery(c.owned, 'scores') > 0 },
  { id: 'den',       name: 'The Den',         at: 10, tab: 'den',       hook: 'Craps, blackjack, the numbers, the tables at the Neon Mile. Bring a real stake.',
    seen: (c) => mastery(c.owned, 'gambling') > 0 },
  { id: 'boxing',    name: 'The Fights',      at: 12, tab: 'boxing',    hook: 'Sign a contender, train them, stake them against other managers. The crowd bets your main events.',
    seen: (c) => (c.owned.fighters || []).length > 0 || num(c.acct.boxing_wins) > 0 || mastery(c.owned, 'fists') > 0 },
  { id: 'races',     name: 'Street Races',    at: 14, tab: 'races',     hook: 'Tune a car and run the circuit — fee up front, purse on a win. Fast iron finally earns.',
    seen: (c) => num(c.acct.race_wins) > 0 || mastery(c.owned, 'wheels') > 0 },
  { id: 'front',     name: 'Legit Fronts',    at: 15, tab: 'empire',    hook: 'Open a front — a business that farms cash around the clock and launders through its own books.',
    seen: (c) => (c.owned.businesses || []).length > 0 },
  { id: 'legit',     name: 'Going Legit',     at: 15, tab: 'portfolio', hook: 'Stake your $OMR for the Made ladder — a bigger trunk, deeper tanks, and looted at the safe rate when you die.',
    seen: (c) => num(c.acct.staked) > 0 || !!c.acct.minted || isMade(c.acct) },
  { id: 'port',      name: 'The Port',        at: 16, tab: 'port',      hook: 'Buy a boat and run contraband in from offshore. The margins beat the streets; the Coast Guard is the risk.',
    seen: (c) => num(c.acct.smuggled) > 0 || mastery(c.owned, 'seamanship') > 0 },
  { id: 'wire',      name: 'The Wire',        at: 18, tab: 'wire',      hook: 'Burn a little $OMR to tap a rival — their heat, their wealth, whether they\'re hunting YOU. Information is a weapon.',
    seen: (c) => num(c.acct.intel_ops) > 0 },
  { id: 'wetwork',   name: 'Wet Work',        at: 22, tab: 'pvp',       hook: 'The contract board pays real pots for real bodies. Start on the Dueling Circuit and build the name.',
    seen: (c) => mastery(c.owned, 'wetwork') > 0 || num(c.acct.kills) > 0 },
  { id: 'convoys',   name: 'Convoys',         at: 24, tab: 'scores',    hook: 'Send a shipment of trade goods across the map — bulk freight beats anything your trunk can carry.',
    seen: (c) => num(c.acct.freight_delivered) > 0 },
  { id: 'stable',    name: 'The Stable',      at: 25, tab: 'stable',    hook: 'Buy a racer, train its legs, run the circuit. Your animal can run in the town\'s daily card — the city bets on it.',
    seen: (c) => num(c.acct.racer_wins) > 0 },
  { id: 'speakeasy', name: 'The Speakeasy',   at: 26, tab: 'speakeasy', hook: 'Open a nightclub in a free district. The bar take drips around the clock and every round buys YOUR prestige.',
    seen: (c) => !!c.owned.speakeasy },
  { id: 'estate',    name: 'The Estate',      at: 30, tab: 'estate',    hook: 'Buy a compound — a home that survives death, mounts your trophies, and gives your $OMR something permanent to become.',
    seen: (c) => !!c.owned.estate },
];

// The board: the systems this player has UNLOCKED (level) but NEVER touched, plus an explorer tally.
// `untapped` is capped for the client card (earliest-unlocked first — the most overdue); `progress`
// carries the full X-of-N so a completionist reads how much of the city they've worked.
export function exploreBoard(ch, acct = {}, owned = {}) {
  const ctx = { ch, acct, owned, lvl: levelOf(Number(ch.respect)) };
  const unlocked = SYSTEMS.filter((s) => ctx.lvl >= s.at);
  const tried = unlocked.filter((s) => { try { return !!s.seen(ctx); } catch { return false; } });
  const untapped = unlocked.filter((s) => !tried.includes(s));
  return {
    // the browsable grid — what to go try, most overdue first
    untapped: untapped.map((s) => ({ id: s.id, name: s.name, hook: s.hook, tab: s.tab, at: s.at })),
    // the completion line: how much of the unlocked city you've actually worked
    progress: { tried: tried.length, unlocked: unlocked.length, remaining: untapped.length },
    // a flourish for the completionist (client can celebrate an all-clear)
    allTried: untapped.length === 0 && unlocked.length > 0,
  };
}

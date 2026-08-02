// THE MADE MAN — the recurring $OMR subscription that buys STANDING (economy v3 step 5, design §5 i
// and §11.2). This is the float mechanism that matters most, because it creates CONTINUOUS demand for
// $OMR rather than the one-off demand every other sink creates: a consumable you should never HOLD
// cannot be the loot that makes killing worth it, and a subscription is the simplest reason to hold.
//
// WHAT IT DELIBERATELY IS NOT. The obvious version of "make them hold $OMR" is to re-denominate
// operating costs — business upkeep, crew wages, territory upkeep — from cash into $OMR. §11.2 rejects
// that outright and the reasoning is the whole design: it would mean a player MUST buy real money to
// keep earning, which is a subscription wall on the core loop rather than a premium tier, and it turns
// a free game into a rented one. **Operating costs stay in cash. All of them.**
//
// So what the dues buy is the SOCIAL AND PRESTIGE layer plus pure convenience, and no power anywhere:
//   • the BADGE                — pure status, on the sheet and the public dossier
//   • the UPPER ESTATE tiers   — the estate is display-only, so this is status gating status
//   • a HOUSE OF YOUR OWN      — a speakeasy is the game's social venue; running one is standing
//   • the PAD PAID WHILE AWAY  — your fronts settle their own CASH upkeep when you touch them, so
//                                absence stops being punishing. The same cash still leaves your pocket
//                                and the same ledger row is written; what you buy is not having to
//                                remember. That is TIME, which §4.3 permits, not POWER, which it does not.
//
// A free player runs a complete empire — streets, crime, kitchen, family, PvP, the Law, the Pen, the
// market, the fronts — at full strength, and can hunt made men for their $OMR. That is RuneScape
// membership and EVE PLEX, and it is the honest answer to "is this pay-to-win": paying buys you a seat
// at tables where you can LOSE money. It buys no advantage at any of them.
//
// §10.4: the dues are an ordinary ledgered $OMR BURN through the vanity `spendOmr` till (`made:dues`),
// and `made:%` is in `DESK.SINK_REASONS`, so — like every sink since step 2 — the value goes to THE
// DESK to be sold again rather than being destroyed. `made_until` is not a bucket and holds no value.
import { GameError, bus } from './game.js';
import { MADE, isMade, madeSeconds } from './rules.js';
import { spendOmr } from './vanity.js';

const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();

// Written by DIRECT SQL: `made_until` is absent from persistAccount's positional UPDATE, so this is
// clobber-safe (the wire_until / disinfo_until precedent). The in-memory account is mirrored so the
// same request's view already reads as made.
async function setMadeUntil(client, h, until) {
  await client.query('UPDATE account_persistent SET made_until=$2 WHERE account_id=$1', [h.accountId, until]);
  h.acct.made_until = until;
}

// Pay the dues. Extends from the LATER of now and the current end — so paying early never burns the
// window you already own (the lawyer-retainer / Street Wire precedent).
export async function payDues(ch, client, h) {
  if (jailed(ch)) throw new GameError('jailed', "You can't be made from a cell.");
  const now = Date.now();
  const from = isMade(h.acct, now) ? new Date(h.acct.made_until).getTime() : now;
  await spendOmr(client, h, MADE.OMR, 'made:dues');
  const until = new Date(from + MADE.MS);
  await setMadeUntil(client, h, until);
  await h.track(client, ch.account_id, 'made_dues', { omr: MADE.OMR });
  bus.emit('me', { account: h.accountId, type: 'made' });
  return { ok: true, omr: MADE.OMR, made: true, madeSeconds: madeSeconds(h.acct, now),
    until: until.toISOString(),
    message: from > now ? 'Another thirty days on the book.' : "You're made. The room knows your name." };
}

// The board — what standing costs, what it opens, and whether you have it.
export function madeBoard(ch, h) {
  const now = Date.now();
  return {
    made: isMade(h.acct, now),
    madeSeconds: madeSeconds(h.acct, now),
    dues: MADE.OMR,
    days: Math.round(MADE.MS / 86400000),
    omr: Number(h.acct.omr || 0),
    // stated in full so the client renders the terms rather than restating them (the catalog precedent)
    opens: [
      { id: 'badge', what: 'The badge', note: 'Your name reads MADE everywhere it is shown.' },
      { id: 'estate', what: `The upper compound (tier ${MADE.ESTATE_TIER} and above)`,
        note: 'The Country Estate and beyond are for men with standing.' },
      { id: 'upkeep', what: 'The pad pays itself', note: 'Your fronts settle their own cash upkeep when you touch them — the same money, one less thing to remember.' },
    ],
    // D8=C (founder, 2026-08-02) retired the speakeasy gate and the high-stakes access stake. Both
    // sat in front of something that EARNS or WINS, which is the line the design names as binding,
    // so what is left is a badge, a display-only compound tier, and one convenience that moves the
    // same money. That is a thinner product than the design imagined and it is stated rather than
    // dressed up — BALANCE.md carries the consequence.
    // said plainly, because it is the thing players will want to know
    buysNoPower: 'Dues buy standing and convenience. No earning loop is gated, no odds move, no stat changes. A free man runs the whole city — and can hunt you for your $OMR.',
  };
}

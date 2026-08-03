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
// §4.3 IS RETIRED — $OMR MAY BUY POWER (founder directive, 2026-08-02), and D8=D restored the two
// ACCESS gates D8=C had briefly removed. So what the dues buy is:
//   • the BADGE                — pure status, on the sheet and the public dossier
//   • the UPPER ESTATE tiers   — the estate is display-only, so this is status gating status
//   • a HOUSE OF YOUR OWN      — a speakeasy is the game's social venue; running one is standing
//   • the HIGH-STAKES TABLE    — with ACCESS_STAKE held. A place to LOSE money faster at unchanged
//                                odds: the seat is the product, never an edge
//   • the PAD PAID WHILE AWAY  — your fronts settle their own CASH upkeep when you touch them. The
//                                same cash, the same ledger row; what you buy is not having to remember
//   • ONE RUNG ON THE LADDER   — MADE_LADDER.MADE_RUNGS. Real power (carry, capacity, the fence), and
//                                a SHORTCUT rather than a gate: the ladder itself keys on held $OMR,
//                                so dues get you there sooner and for less held — never higher
//
// THE HONEST ANSWER TO "IS THIS PAY-TO-WIN" HAS CHANGED, and the copy below says so rather than
// repeating a claim that stopped being true. It is no longer "paying buys no advantage." It is:
// **there is a ceiling, and it is reachable without paying.** That is checkable, not rhetorical —
// the top rung is 150 staked and the mission ladder alone pays 220 lifetime, which `test/made.js`
// pins against the live MISSIONS table. Paying is a shortcut up a ladder that ends in the same place.
// What stays true untouched: OPERATING COSTS ARE CASH (§11.2), so nobody must pay to keep earning,
// and there is no combat power on the ladder at any price — see the rules-tail note for why that is
// a loop argument rather than a fairness one.
//
// §10.4: the dues are an ordinary ledgered $OMR BURN through the vanity `spendOmr` till (`made:dues`),
// and `made:%` is in `DESK.SINK_REASONS`, so — like every sink since step 2 — the value goes to THE
// DESK to be sold again rather than being destroyed. `made_until` is not a bucket and holds no value.
import { GameError, bus } from './game.js';
import { MADE, MADE_LADDER, ACCESS_STAKE, isMade, madeSeconds , jailed } from './rules.js';
import { spendOmr } from './vanity.js';


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
      { id: 'speakeasy', what: 'A house of your own', note: 'Only a made man opens a club.' },
      { id: 'table', what: 'The high-stakes room',
        note: `With ${ACCESS_STAKE.HIGH_OMR} $OMR staked. Bigger limits at the same odds — a faster way to lose it, not a better one.` },
      { id: 'ladder', what: `${MADE_LADDER.MADE_RUNGS} rung up the ladder`,
        note: 'The ladder runs on $OMR you HOLD. Dues climb it — they never raise its ceiling.' },
    ],
    // THE CEILING, stated where a player will read it. Dues are a shortcut, so the top of the ladder
    // is reachable by holding alone — which is what makes this claim true rather than marketing.
    ceiling: { topRung: MADE_LADDER.RUNGS[MADE_LADDER.RUNGS.length - 1].min,
      note: `Everything dues unlock has a ceiling, and holding ${MADE_LADDER.RUNGS[MADE_LADDER.RUNGS.length - 1].min} $OMR reaches it without paying a subscription.` },
    // said plainly, because it is the thing players will want to know — and it is no longer "no advantage"
    buysPower: 'Dues buy standing, access and a rung on the ladder. There IS a ceiling and it is reachable without paying — and nothing on the ladder helps you fight. A free man runs the whole city, and can still hunt you for your $OMR.',
  };
}

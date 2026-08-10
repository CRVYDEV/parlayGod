// THE CITY LEG'S ACTIVITY METRIC (THE BANK, omerta-bank-protocol-design.md §4.2).
// Protocol profit buys $OMR on the open market and gives it to "the players who play". This file
// pins what that phrase means, and every assertion here is a property the distribution's safety
// rests on rather than a happy path:
//
//   (1) LINEARITY — splitting one player's effort across N accounts must yield the IDENTICAL total.
//       A concave score (a per-account cap, log-share) makes splitting profitable, which is the
//       measured Street Wage bug (BALANCE § THE FARM: "concentration is the OPPOSITE of Sybil").
//   (2) THE SEVERANCE WALL — tokenomics v2 severed cash from $OMR. The Madame's T1 perk comps the
//       nerve on dice AND blackjack (src/casino.js:116/:844) and sellGood has no throttle, so an
//       unthrottled tag in TAGS would let cash buy a share of the bought-$OMR pool.
//   (3) THE GATE IS NOT A CAP — MIN_TRACKS charges a fixed cost per ACCOUNT (Sybil-negative) and
//       never clips an honest player's payout (which would be Sybil-positive).
//
// Pure arithmetic over the live constants. No server, no database.
import assert from 'node:assert';
import test from 'node:test';
import { ACTIVITY, MASTERY, activityScore, activityTracks, activityQualifies } from '../src/rules.js';

test('the activity metric', async (t) => {
  await t.test('LINEARITY: splitting effort across accounts gains nothing', () => {
    const whole = { crime: 120, jump: 12, heist: 3, race: 6 };
    const shard = { crime: 40, jump: 4, heist: 1, race: 2 };
    assert.equal(activityScore(whole), 3 * activityScore(shard),
      'the score must be LINEAR — a farm splitting effort must not out-earn one honest player');
    // and doubling effort exactly doubles the score (no cap anywhere in the curve)
    assert.equal(activityScore({ crime: 200 }), 2 * activityScore({ crime: 100 }),
      'no per-account cap may exist: a cap makes the score concave and rewards Sybils');
  });

  await t.test('THE SEVERANCE WALL: cash-bounded actions score nothing', () => {
    // Verified in src/casino.js — the Madame comps the nerve on both, so neither is game-throttled.
    for (const tag of ['dice', 'blackjack']) {
      assert.ok(!ACTIVITY.TAGS.includes(tag), `${tag} is not game-throttled and must not score`);
      assert.equal(activityScore({ [tag]: 9999 }), 0, `${tag} must contribute ZERO`);
    }
    // sellGood carries no nerve/energy/cooldown check — a cash-funded loop.
    for (const tag of ['sell', 'fill']) {
      assert.ok(!ACTIVITY.TAGS.includes(tag), `${tag} has no per-action throttle and must not score`);
    }
    assert.ok(!activityQualifies({ blackjack: 99999, dice: 99999, sell: 99999 }),
      'a den whale with no throttled play must not qualify at all');
  });

  await t.test('FAIL-CLOSED: an unlisted tag scores zero', () => {
    assert.equal(activityScore({ some_future_action: 100000 }), 0,
      'a tag absent from TAGS must contribute nothing until deliberately added');
  });

  await t.test('THE GATE: breadth is required, and it is a gate rather than a cap', () => {
    const oneLoop = { crime: 200 };                       // enormous, but a single trade
    assert.ok(activityScore(oneLoop) > 0, 'the grind still scores');
    assert.equal(activityTracks(oneLoop), 1);
    assert.ok(!activityQualifies(oneLoop), 'one trade must not qualify');
    const broad = { crime: 60, jump: 5, heist: 1 };
    assert.ok(activityTracks(broad) >= ACTIVITY.MIN_TRACKS);
    assert.ok(activityQualifies(broad), 'breadth qualifies');
    // the gate does not clip: the qualified broad player's score is still linear in effort
    assert.equal(activityScore({ crime: 120, jump: 10, heist: 2 }),
      2 * activityScore({ crime: 60, jump: 5, heist: 1 }),
      'qualifying must not cap what a player earns — the gate is eligibility only');
  });

  await t.test('every scoring tag is real, mapped, and every mapped track exists', () => {
    const tracks = new Set(MASTERY.TRACKS.map((x) => x.id));
    for (const tag of ACTIVITY.TAGS) {
      assert.ok(MASTERY.XP[tag] > 0, `${tag} must be a real MASTERY.XP tag with a positive award`);
      const tr = ACTIVITY.TRACK_OF[tag];
      // yardtale is deliberately unmapped — it schools the teller's own (variable) track.
      if (tag === 'yardtale') { assert.ok(!tr, 'yardtale must stay unmapped'); continue; }
      assert.ok(tracks.has(tr), `${tag} maps to '${tr}', which is not a trade`);
    }
    assert.ok(ACTIVITY.EXCLUDE_AGENTS && ACTIVITY.EXCLUDE_NPC,
      'agents and NPC residents are excluded from every legend surface, and from this one');
  });

  await t.test('the dust floor is a floor, never a ceiling', () => {
    assert.ok(!activityQualifies({ crime: 1, jump: 1, boost: 1 }), 'dust does not qualify');
    assert.ok(ACTIVITY.MIN_SCORE > 0);
    // the decisive property: nothing in the module names a maximum
    const src = ACTIVITY;
    for (const k of Object.keys(src)) {
      assert.ok(!/^(MAX|CAP)_/.test(k), `ACTIVITY.${k} looks like a cap — a cap is Sybil-POSITIVE`);
    }
  });
});

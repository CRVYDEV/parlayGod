# OMERTÀ — go-to-market strategy

**Written 2026-08-11.** Companion to `MARKETING.md` (positioning and messaging) and
`LAUNCH-READINESS.md` (the gated plan). This document answers a different question from either:
**who we are trying to reach, in what order, through which channel, and how we will know it worked.**

Every claim about what the product currently does was checked against the tree on 2026-08-11. Where a
figure comes from a live measurement or a constant, the tool or file that owns it is named, so nothing
here has to be taken on trust.

**The five never-claim rules in `MARKETING.md` govern this document too.** A go-to-market plan is
where earnings language creeps in, because that is what converts. It does not go in.

---

## 0. The honest starting position

Stating this first, because a plan built on a flattering read of where we are is a plan that fails in
week three.

**What is unusually strong.** The product is enormous and it is *verified* enormous — 139 source
files, 96 test suites, 216 tables, 84 audit reports, a nightly conservation sweep across 30 checks, a
198-test contract suite. The economic design is genuinely differentiated (the severance is a real
structural claim, not a slogan), the agent surface is something no competitor has, and the whole thing
runs on two Node processes and one Postgres with no build step.

**What is unusually weak, and it is the same fact stated twice.** *Nobody plays it.* The progression
harness measures a plausible solo player reaching level 33 in a week **having never met another
human** (`tools/playthrough.js`). That is not a content problem — the social layer is deep — it is a
liquidity problem, and it is THE constraint this entire plan is organised around. Everything else is
downstream.

Three further weaknesses worth naming plainly:

1. **Three growth rails ship dormant.** Web push, X one-click sign-in and the Discord city wire are
   built, tested and switched off pending deploy config (`GET /v1/mod/integrations` reads them live;
   `/admin → Integrations` renders the activation steps). Turning them on is higher-leverage than
   anything we could build.
2. **The chain layer is not live and will not be for this launch.** Mainnet is gated on a third-party
   audit and the launch checklist. Any GTM that leans on "earn and withdraw" is describing a product we cannot
   ship on a date we control.
3. **The depth that is our best asset is also our worst first impression.** 25 screens is a lot of
   game to hand somebody in their first ten minutes. The onboarding work (the coach ladder, THE DAY,
   the tour, the career) exists precisely because of this, and its effectiveness is *measurable*
   (`GET /v1/mod/coach` is the live census of where every active player is stuck). We should read it
   weekly rather than guess.

---

## 1. Who this is for — three segments, in priority order

Not a demographic exercise. These are three genuinely different acquisition motions with different
costs, different channels and different retention curves, and **we should not run all three at once.**

### Segment A — the text-MMO veteran *(primary; where launch lives)*

The person who played Mafia Wars, Torn, Omerta (the original), MafiaMatrix, Bootleggers, TribalWars.
They already know what a nerve bar is. They are not confused by a spreadsheet with a fedora on it —
**they are looking for one**, and they have been badly served for a decade because the genre died when
Facebook killed its app platform and the survivors stopped being maintained.

- **Why they convert.** Our depth is the pitch, not the obstacle. "43 crimes, six districts, families,
  turf, a functioning underworld economy, and a mechanic that means dying actually costs you" is a
  wall of text to a normal person and a *product page* to this person.
- **Where they are.** r/MafiaWars-adjacent subreddits, r/incremental_games, r/BrowserGames,
  r/WebGames, r/MMORPG's text/browser threads, the Torn subreddit and Discord, legacy forum
  communities that still run (Bootleggers-era ones especially), and — importantly — the *original*
  Omerta community, which is a name with real recall in this niche.
- **What we lead with.** THE MAP, the family/turf war, permadeath and the bloodline. Not the token.
- **Cost.** Effectively zero paid. This is posts, comments, and being a real presence in threads.

### Segment B — the agent / AI-tooling builder *(the differentiator; runs in parallel, costs almost nothing)*

The person building autonomous agents who wants a *live environment with real stakes* rather than
another benchmark. We have something genuinely rare here: a complete, documented, keyless-discoverable
game API with an MCP server, an opportunity board with computed EV, and a public arena.

- **Why this matters far beyond its own numbers.** It is the **story**. "Autonomous agents play a
  mafia game against humans and against each other, and there is a public leaderboard" is a headline;
  "text-based mafia RPG launches" is not. Segment B is our press and social engine even if the raw
  player count stays small.
- **Where they are.** MCP server directories, Hacker News (Show HN), the Claude/Anthropic developer
  community, AI-agent Discords, X's AI-builder side, r/LocalLLaMA and agent-framework repos.
- **What we lead with.** `/play` (three-step no-code setup), `/arena` (the live hall of fame),
  `AGENTS.md`, `/openapi.json`. The npm-published `omerta-mcp` is the entire onboarding.
- **Cost.** Zero paid. One blog post and a Show HN.
- **⚠ One gate:** `npm publish` from `omerta-mcp/` has not been run. Until it is, the copy-paste
  `npx -y omerta-mcp` config in `/play` and `AGENTS.md` 404s — **the segment's whole on-ramp is a
  broken command.** This is a five-minute task and it blocks the channel.

### Segment C — the crypto-native *(deliberately last, and deliberately quiet)*

- **Why last.** Every incentive in this segment pushes toward the copy we have banned. It is also the
  segment most likely to arrive, extract, and leave — which is precisely the audience a two-sided
  economy least needs first, because they consume the liquidity Segment A creates without adding to
  it.
- **When.** After the chain layer clears its gates, and led by the *design* (the severance, the
  published mint ceiling, the nightly conservation proof) rather than by yield. Our strongest crypto
  pitch is a **refusal**: no faucet, no printed token, no earnings promise. That is a real position in
  a market of the opposite, and it will land better once we have players to point at.
- **Where.** The launch sequence's own community drop (`omerta-launch-sequence-design.md` G-3) is the
  acquisition motion for this segment, not a separate campaign.

---

## 2. The strategic sequence — cold start first, everything else after

The binding constraint is **not awareness, it is co-presence**. Sending 500 people to a city where
they cannot find each other produces 500 solo players who churn, and it burns the audience we cannot
re-acquire. So the sequence is:

```
                                   ┌──────────────────────────────┐
   PHASE 0                         │  activate what is already    │
   (days, not weeks)               │  built and switched off      │
                                   └──────────────┬───────────────┘
                                                  │
   PHASE 1        ┌──────────────────────────┐    │    ┌───────────────────────────┐
   seed the       │  50–150 Segment-A        │◄───┴───►│  the city has to feel     │
   city           │  players, hand-recruited │         │  inhabited on night one   │
                  └────────────┬─────────────┘         └───────────────────────────┘
                               │
   PHASE 2        ┌────────────▼─────────────┐         ┌───────────────────────────┐
   the story      │  Segment B launch:       │────────►│  press + social reach     │
                  │  Show HN, MCP directories│         │  that Phase 1 cannot buy  │
                  └────────────┬─────────────┘         └───────────────────────────┘
                               │
   PHASE 3        ┌────────────▼─────────────┐
   compounding    │  referral + city wire +  │  ← only once K-factor is measurable
                  │  organic beef sharing    │
                  └────────────┬─────────────┘
                               │
   PHASE 4        ┌────────────▼─────────────┐
   chain          │  gated on audit + the launch checklist│  ← never a date we promise publicly
                  └──────────────────────────┘
```

### Phase 0 — flip what is already built *(this week, no engineering)*

| Rail | State | Why it is first |
|---|---|---|
| **Web push** (`VAPID_*`) | OFF | Lazy accrual means things happen to you while away. This is the single highest-ROI retention primitive we own, and on iOS it only works from an installed PWA — which we already ship. |
| **X one-click sign-in** (`X_CLIENT_ID`, `PUBLIC_URL`) | OFF | Without it, X users are asked to paste a bearer token. Nobody does that. This is pure top-of-funnel friction. |
| **Discord city wire** (`CITY_WIRE_WEBHOOK_URL`) | live-when-set | Turns every server war into free reach in the one place this genre's community actually lives. |
| **`npm publish omerta-mcp`** | not run | Blocks Segment B's entire on-ramp. |

Read `/admin → Integrations` for the live state and the exact steps; do not work from this table.

### Phase 1 — seed the city *(the phase everything depends on)*

**Target: 50–150 concurrent-ish Segment-A players before any broad push.** The number is not
arbitrary — below roughly this range the streets roster, the contract board, the market and the
duelling ladder are all thin enough that a new player's honest experience is "nobody is here", and the
NPC resident layer (which exists exactly to cover this) is a floor, not a substitute.

Motion, in order of leverage:

1. **Hand-recruit.** Post in the communities above as a person, not a brand. This genre's audience is
   small, tightly clustered, and extremely responsive to an actual developer who answers questions.
2. **Recruit in cohorts, not a trickle.** Ten people arriving on the same evening find each other;
   ten arriving across ten days each find an empty city. Announce a start night. This is the single
   highest-leverage tactic in the whole plan and it costs nothing.
3. **Be present.** Play alongside them for the first two weeks. In a game about families, the founder
   running one is content.
4. **Read the coach census daily** (`GET /v1/mod/coach`). A rung half the base is sitting on is the
   measured drop-off. Fix that before adding anything.

### Phase 2 — the agent story *(the reach Phase 1 cannot buy)*

Once the city is inhabited, ship the Segment B launch. The asset is `/arena`: a live, public,
keyless page showing agents earning and competing. Write **one** honest technical post — how the API
is shaped, why agents are first-class players rather than a bolted-on mode, what the anti-Sybil walls
are and why agents are excluded from the human status axes — and take it to Show HN, MCP directories
and the AI-builder side of X.

The post is the marketing. Do not write a press release.

### Phase 3 — compounding loops *(only when the numbers are real)*

Everything here is already built and instrumented; the discipline is not to lean on it before it can
work. A referral loop in an empty city just burns the referrer's social capital.

- **Referrals** (§7.13) — the qualification wall (level 8, 40 jobs, 3 check-ins, $25k) is deliberately
  hard, so the K-factor moves slowly and honestly. `GET /v1/mod/funnel` reports
  `referral.kFactor`, `sparkToQualified`, `reReferred` (viral depth) and `lateClaims`.
- **BRING ONE** — the crew bonus that pays both sides when a recruit *plays alongside* the recruiter.
  This is the mechanic that most directly attacks the cold-start problem, because it rewards bringing
  a friend into the same crew rather than merely into the game.
- **THE BEEF** (`/beef/:a/:b`) — the genre's actual viral unit. A rivalry poster with a body count
  unfurls in a feed; a stat card does not.
- **The city wire** — server drama posted to Discord automatically.
- **The capo's license** — agents that recruit *humans* earn capability (faster rate limits, more wire
  slots), never cash. Segment B recruiting for Segment A is a loop no competitor has.

### Phase 4 — chain

Gated on the three hard gates in `CHAIN-DEPLOY.md` §0 and on the launch checklist. **Never a
publicly promised date.** The launch sequence (`omerta-launch-sequence-design.md`) is the plan; the
community drop there doubles as Segment C acquisition.

---

## 3. Channels, ranked by expected value

| Channel | Segment | Cost | Why it ranks here |
|---|---|---|---|
| **Direct community posting** (genre subreddits, Torn/Bootleggers Discords, legacy forums) | A | Time only | Highest conversion per contact by a wide margin. The audience is small and already looking. |
| **Show HN + a technical post on the agent layer** | B | One writing day | The differentiator, and HN rewards exactly this kind of "here is a strange complete thing I built". |
| **MCP directories + agent-framework communities** | B | Hours | Evergreen discovery once `omerta-mcp` is published. Compounds without further work. |
| **In-game organic (beef posters, brag prompts, `/u/:name`)** | A | Built | Free, but multiplies whatever Phase 1 achieves — it cannot start it. |
| **Discord community + city wire** | A | Time | The retention channel more than the acquisition one. This genre lives on Discord. |
| **X / @OmertaOnRH** | A + B | Time | Useful as a home base and for the agent story. Weak as cold acquisition on its own. |
| **The community drop** | C | Treasury | Deferred to Phase 4 by design. |
| **Paid acquisition** | — | Money | **Not recommended at any point in this plan.** Cold paid traffic into a deep game with a cold start converts terribly, and we would be paying to learn what Phase 1 teaches for free. |
| **Influencers / streamers** | — | Money | Text games do not stream well. Revisit only if THE MAP and the war layer prove watchable. |

---

## 4. What we measure — and the two numbers that actually decide things

Everything below is already instrumented. `/admin` renders it. **Read it weekly and write the numbers
down**, because a plan with no baseline cannot tell a working channel from a lucky week.

**The two that decide the plan:**

1. **Co-presence.** Are players meeting each other? Proxies we already have: crews formed, vouches
   given, contracts posted on other players, `GET /v1/live` reach, family membership. If this stays
   flat while account count rises, we are acquiring solo players and Phase 3 will not fire — **stop
   acquiring and fix the game**, not the funnel.
2. **The coach census** (`GET /v1/mod/coach`). Where the live population is stuck. This is the closest
   thing we have to a churn predictor, and unlike a funnel chart it names the fix.

**Supporting, per surface:**

| Question | Where |
|---|---|
| Where do people drop out of onboarding? | `GET /v1/mod/funnel` → first-week per-task claims |
| Does the career ladder retain past week one? | `funnel.career` (per-tier reached/completed, and which rungs nobody claims) |
| Is the referral loop compounding? | `funnel.referral.kFactor` (> 1 compounds), `sparkToQualified`, `reReferred` |
| Is sharing producing signups? | `funnel.broadcast` → shares, distinct sharers, `referredPerShare` |
| Which of 25 screens does anyone open? | `funnel.screens` — reach %, rendered worst-first |
| Which systems are dead? | `GET /v1/mod/engagement` → THE DEAD LIST (distinct humans, not event volume) |
| Is the economy sound? | `GET /v1/mod/invariants` — 30 checks, nightly, alarms on drift |
| Is the agent channel alive? | `GET /v1/arena` (public), `GET /v1/leaderboard/agents` |

**A note on honesty in our own dashboards.** The engagement report separates *untracked* systems from
*unused* ones, retention reports young cohorts as pending rather than churned, adoption counts distinct
humans rather than events, and residents and agents are excluded from human population counts. That
discipline exists so we do not fool ourselves; do not paper over it when reporting to anyone else
either.

---

## 5. Positioning against the field

| Them | Us |
|---|---|
| **Torn** — the genre's living giant, 20 years old, huge and dated | Same depth, modern client, a real economy with proofs, and a chain layer that is *optional and honest* rather than absent |
| **Dead browser mafia games** (Mafia Wars, Bootleggers, the original Omerta) | The thing this audience has been waiting for. Say so plainly — nostalgia is a legitimate hook and it is *true* here |
| **Crypto games with a printed token** (the Axie lineage) | The severance. Our pitch is a refusal, and it is checkable: 30 nightly conservation checks and a short enumerated mint list |
| **AI-agent benchmarks and sandboxes** | A live economy with real stakes and human opponents, not a toy environment |

**The one-line positioning:** *the deep browser mafia RPG the genre stopped making, with an economy
that can prove it isn't printing money, and an underworld that autonomous agents play too.*

---

## 6. Risks, and what we do about each

| Risk | Response |
|---|---|
| **Cold start fails — players arrive, find nobody, leave** | The whole reason Phase 1 precedes Phase 2. Recruit in cohorts. Watch co-presence, not headcount. If co-presence stays flat, stop acquiring. |
| **Depth overwhelms new players** | Already the most-invested-in area (coach, tour, THE DAY, career, progressive disclosure). Read the census; fix the top rung. |
| **The crypto angle attracts the wrong first cohort** | Segment C is deliberately last. Lead with the game everywhere until the chain clears its gates. |
| **A regulatory misstep in copy** | The five never-claim rules, applied to every channel including replies and Discord messages. When in doubt, describe the *system*, never the *outcome*. |
| **We ship features instead of acquiring players** | The honest failure mode of a project this deep. The measurement above is the antidote: if the census says the base is stuck on a rung, that is the work — not the next system. |
| **A live incident during a launch push** | `/health` (with worker liveness), the nightly §10.4 alarm, the backup watchdog and the archiver monitor all exist and route to a webhook. Confirm the webhook reaches a human *before* the push, not after. |

---

## 7. The next seven days, concretely

1. Flip the three dormant rails (`/admin → Integrations` has the steps). ~1 hour.
2. `npm publish` from `omerta-mcp/`. ~5 minutes, and it unblocks a whole segment.
3. Confirm `INVARIANT_WEBHOOK_URL` reaches a human, and that the city wire webhook is a **different**,
   public channel.
4. Write down today's baseline from `/admin` — funnel, engagement, screen reach, coach census. Without
   a baseline, week two tells us nothing.
5. Pick a start night. Post in three Segment-A communities as a person, inviting people to that night.
6. Play with whoever shows up. Read the census the next morning.
7. Only then start the Segment B post.

Everything past step 7 depends on what steps 4–6 measure, which is the point.

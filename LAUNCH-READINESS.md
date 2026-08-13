# OMERTÀ — launch readiness checklist and plan

**Written 2026-08-11.** The gated plan. `GTM.md` says who we are reaching and in what order;
`MARKETING.md` says what we say; this says **what has to be true before each door opens, and who
decides.**

Two rules govern the whole document:

1. **A gate is not a task.** Tasks can be worked around under pressure; gates cannot. Where something
   is a gate it says so, and the correct response to a red gate is to move the date, never the gate.
2. **Verified state only.** Everything marked ✅ was checked against the tree on 2026-08-11 with the
   command named beside it. Anything unverified is marked ⬜ even where it is probably fine — an
   unchecked box that "should be OK" is how a launch finds out at 3am.

---

## THE THREE DOORS

There are three distinct launches here and conflating them is the main way this goes wrong.

| | What opens | Gated on | Status |
|---|---|---|---|
| **DOOR 1 — the game** | Real players in a live city. No chain, no token sale, no real-money extraction. | Engineering + ops readiness only | **Effectively open.** Blocked only by the Phase-0 activation items below. |
| **DOOR 2 — the agent channel** | Segment B: MCP directories, Show HN, `/arena`. | `npm publish omerta-mcp` + Door 1 populated | **One 5-minute task from open.** |
| **DOOR 3 — the chain** | Genesis window, pool, community drop, on-chain extraction. | Third-party audit **and** the launch checklist **and** `forge test` | **Hard-blocked.** Two of three gates are red and neither is ours to close alone. |

**Doors 1 and 2 do not wait for Door 3.** That separation is the single most important structural
decision in this plan: it means we can launch a game, learn from real players, and fix what they
find, months before anything touches real money — and it means a slipped audit does not slip the
product.

---

# DOOR 1 — the game

## 1.1 Engineering gates ✅ *(all verified 2026-08-11)*

| Gate | Command | State |
|---|---|---|
| Full suite green | `npm test` | ✅ 96 suites |
| §10.4 conservation drift-0 | `node tools/sim.js` | ✅ ends `§10.4 holds exactly` |
| Every SQL string parses on **real** Postgres | `npm run pgquery` | ✅ (pg-mem cannot see the `uuid = text` class that took production down on 2026-07-30) |
| Loop / lock / ledger integrity on real Postgres | `npm run pgcheck` | ✅ 43/43 |
| Mobile layout, real Chromium, two viewports | `npm run mobile` | ✅ |
| Client wiring — every button reaches a real route, sends fields the handler reads, and reads fields the board sends | `node test/client.js` | ✅ 7 checks |
| Contracts | `omerta-contracts/run-forge-test-sandboxed.sh` | ✅ 198/198, 7 fuzzes |
| Docs match the tree | `node test/docs.js` | ✅ |
| Signed levers pinned + register complete | `node test/levers.js` | ✅ |

**Ground rule #8 applies to all of it: a green `npm test` is not a green build.** The suite runs on
pg-mem. Before any push that touches SQL, run `pgquery` + `pgcheck` locally, and **after every push,
read CI** — a red build that nobody reads manufactures confidence, which is how seven commits once
landed on top of a broken one.

## 1.2 Phase-0 activation ⬜ *(no engineering — this is deploy config, and it is the whole gap)*

Read `/admin → Integrations` for live state and exact steps. Do not work from this table; work from
that screen.

- [ ] **Web push** — `node tools/vapid.js`, set `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` on **both**
      the API (serves the public key) and the worker (does the sending), redeploy.
      *Highest-ROI retention item we own. On iOS it works only from the installed PWA, which we ship.*
- [ ] **X one-click sign-in** — register an X app; set `X_CLIENT_ID`, `X_CLIENT_SECRET`, `PUBLIC_URL`;
      register the callback as `PUBLIC_URL + /v1/auth/x/callback`.
      *Without it we are asking X users to paste a bearer token. Nobody does that.*
- [ ] **Discord city wire** — create a **public community channel** webhook, set
      `CITY_WIRE_WEBHOOK_URL` on the API.
      ⚠ **Must be a different webhook from `INVARIANT_WEBHOOK_URL`.** Preflight hard-errors if they
      match — city drama on the ops-alarm channel is both a leak and an alarm nobody will read.
- [ ] **Confirm `INVARIANT_WEBHOOK_URL` reaches a human.** Preflight warns when unset; nothing can
      warn that the channel is muted. Post a test alert and watch someone receive it.

## 1.3 Ops readiness ⬜

- [ ] `npm run preflight` **on the box, with the real environment loaded.** Green means it will boot.
- [ ] `/health` returns 200 **and** `worker.stale` is false. The worker is a separate process and the
      sole source of every proactive alarm and every timed settlement — its silence is
      indistinguishable from a quiet night, which is exactly why the heartbeat exists.
- [ ] Backups: `npm run backup` completes and **verifies** (it restores the dump and counts rows — a
      schema-only dump passes a size check and holds nothing).
- [ ] The archiver watchdog reads `ok` on `/admin`, not `failing`/`off`. `archive_mode=off` means
      there is no WAL chain at all, which the first cut of that check reported as healthy.
- [ ] `autoDeployTrigger: checksPass` is set in `render.yaml` ✅ *(verified)* — a red CI cannot
      auto-ship.
- [ ] Decide and write down: who is on call, and what they do when the §10.4 alarm fires at 3am. The
      answer is "read `/admin → invariants`, find the check that is red, and page the developer" —
      but it needs to be written before it is needed.

## 1.4 Content and copy ⬜

- [ ] `/wiki` and `docs/WIKI.md` agree with the tree ✅ *(drift detector + the `$OMR` figure guard in
      `test/docs.js`)*
- [ ] The five never-claim rules are on the wall for whoever writes public copy — including Discord
      replies, which is where an earnings claim actually happens.
- [ ] The landing page, `/arena`, `/play` and `/agents` all resolve and describe the current build ✅
- [ ] `SOCIAL_GAME_URL` / `PUBLIC_URL` point at the live host. *(The default fallback pointed at a
      dead domain until 2026-08-09; every brag/referral link derives from it.)*

## 1.5 The launch night itself ⬜

- [ ] **Pick a start night and recruit toward it.** Ten players arriving together find each other; ten
      arriving across ten days each find an empty city. This is the highest-leverage tactic in the
      plan and it costs nothing.
- [ ] Baseline written down **before** anyone arrives: `/admin` funnel, engagement, screen reach,
      coach census. Week two tells us nothing without week one.
- [ ] `INVITE_MODE` decided. On = a controlled cohort and a real Sybil bound; off = open doors. For a
      seeded first night, **on** is the better answer.
- [ ] Founder present and playing. In a game about families, running one is content.
- [ ] Read the coach census the next morning (`GET /v1/mod/coach`). A rung half the base is sitting on
      is the drop-off, and it names its own fix.

---

# DOOR 2 — the agent channel

- [ ] **`npm publish` from `omerta-mcp/`.** ⚠ Until this runs, the copy-paste `npx -y omerta-mcp`
      config in `/play`, `AGENTS.md` and the MCP README **404s** — the segment's entire on-ramp is a
      broken command. Five minutes, and it is the only real blocker.
- [x] `omerta-mcp` is publish-shaped ✅ — `files`, `repository`, `homepage`, `keywords`,
      `publishConfig.access: public`, `bin` + shebang all present.
- [x] `/play` — three-step no-code setup, vendor-neutral (MCP is an open protocol; ChatGPT, Cursor,
      Cline, Zed and the OpenAI Agents SDK all speak it) ✅
- [x] `/arena` + `GET /v1/arena` — public, keyless, wealth **banded** so a public indexed page can
      never be scanned for an agent's exact liquid ✅
- [x] `/openapi.json` — derived from the live route registry (so it cannot drift), `/v1/mod` excluded
      ✅
- [x] `robots.txt` welcomes every crawler and agent explicitly, pointing at `/llms.txt` ✅
- [ ] Write the technical post. One honest piece: how the API is shaped, why agents are first-class
      players, what the anti-Sybil walls are, and why agents are excluded from human status axes. Take
      it to Show HN and the MCP directories.
- [ ] Verify the published package end-to-end from a clean machine before posting anywhere.

---

# DOOR 3 — the chain

**Hard-gated. Nothing below ships until all three gates are green, and two of them are not ours to
close alone.** `CHAIN-DEPLOY.md` §0 is the authority; this is the summary.

| Gate | State | Owner |
|---|---|---|
| **1 — `forge test` green** | ✅ 198/198, 7 fuzzes | us |
| **2 — third-party audit of contracts AND the signer** | ❌ **not started** | external |
| **3 — the launch review** | ⚠ **partial** | external |

### Gate 2 — the audit

- The batch is assembled: `OMR`, `VoucherClaim`, `GearVault`, `OMRStaking`, `OmertaFees`,
  `OmertaBond`, `OmrTwapOracle`, `GenesisOracle`, `OmertaHook`, and THE BANK
  (`Denari`/`CollateralEscrow`/`Alchemist`/`Transmuter`/`FlashGuard`).
- **Point the auditor at the deleted property.** Until tokenomics v2 step 4, every prior review of
  this suite rested on "nothing mints". That is no longer true — bonds mint — and what replaced it is
  four walls (`dailyCapOMR`, `MAX_DISCOUNT_BPS`, `maxOmrPerEth`, the accretion oracle). An auditor who
  reads the old sentence will review the wrong contract.
- Also brief them on: no oracle on THE BANK's borrow path and no `liquidate()` anywhere (the design's
  central claim, and the class that cost Inverse ~$21M twice); the hook's pool gate (without it anyone
  can emit fabricated revenue wearing a real tx hash); and the accrue-don't-forward rule in both the
  hook and the Alchemist.
- Hand over the 84 audit reports as context, with the standing caveat that they are **point-in-time**
  and `SPEC.md` is what is current.
- **The clock has been reset twice** (v2 step 4; the bond's fourth slice). Do not start it a third
  time with a contract change unless the change is worth the delay.

### Gate 3 — the launch checklist

The checklist is kept **outside this repo** — see the founder. It is the review of every surface that
moves real value, and it is what blocks Door 3. The surfaces it covers are the ones this repo builds
chain-dormant and never arms on its own: treasury stock purchases, transferable TBA drops, the claim
rail, NFT proceeds, the play-pool redistribution, the free community distribution, provenance traits,
the activator's leg, and THE BANK's four (synthetic issuance, yield-bearing deposits, revenue
distribution, custody).

**Do not read a green build as a green checklist.** Every one of those surfaces already exists in the
tree behind an env flag, and the tests prove they *work* — not that they are cleared to run.

### If both gates go green — the sequence

`omerta-launch-sequence-design.md` is the plan; `CHAIN-DEPLOY.md` §2 is the exact call order.

- **G-0 pre-flight** — every item there is a gate. Note the snapshot rule: it must be a **historical
  block predating every committed document that names the target communities**, because those targets
  are already enumerated in this repo, so snapshot-before-announce alone no longer closes the farm.
- **G-1 the genesis window (1–3 days)** — bonding at the genesis price on a `GenesisOracle`, throttled
  per day by THE DAILY OFFERING (live). The 120h bond vest outlasts the longest window, so **nobody
  can dump the genesis at the bell, by construction.**
- **G-2 the pool** — pair POL ETH with Safe genesis OMR at the genesis price, deploy the canonical v4
  pool with `OmertaHook`, warm the TWAP one full period, then cut `OmertaBond.setOracle` over to the
  real TWAP. **The cutover is one operation** — a gap between them is a bond outage.
- **G-3 the community drop** — snapshot-before-announce, published merkle roots, claims-never-pushes,
  90–180 day window, unclaimed reverts to the Safe.

### Deploy items that fail *silently* — the ones to double-check

Three configuration steps produce a market that looks healthy and is not:

1. **Seed THE BANK's buffer before arming it.** At zero supply the required buffer is zero, so the
   first borrow always passes and every one after it deadlocks. `test_an_unseeded_market_bricks_after_one_borrow`
   pins it.
2. **Set `alchemist.setMintCaps`.** Zero means *unlimited* here — these fail OPEN, unlike
   `maxOmrPerEth` and the gear caps.
3. **Set `dailyCapOMR` on `OmertaBond` and `VoucherClaim`.** Zero means unlimited; with no tranche,
   `dailyCapOMR` is the entire blast radius of a leaked quote-signer.

Plus: **arm the mint last** (`OMR.setMinter(bond)` only after both caps and the oracle hold real
values), and **start the oracle keeper** — `update()` is permissionless and must be poked at least
once per `maxOracleAge` or bonding halts. That failure direction is deliberate, but it makes the
keeper a production dependency; the worker watches it and alerts on `keeper-late` while bonding still
works, which is the lead time.

---

## THE KILL SWITCHES — know these before you need them

| Situation | Switch |
|---|---|
| Supply is being inflated | `OMR.setMinter(address(0))` — one transaction, minting off |
| The sell tax needs to stop | `setSellTax(0,0,0)` — the fee stops, the pool keeps trading. **There is no pause, deliberately:** a hook that can revert `beforeSwap` can halt a public market |
| THE BANK is issuing against a bad sleeve | `Denari.setMinter(0)` — halts issuance **without** touching redemption. The asymmetry is the point: stop issuing before you stop paying |
| A player token is compromised | `POST /v1/mod/revoke` (lighter than a ban) or `POST /v1/auth/logout-all` |
| The game itself | `INVITE_MODE=on` closes the doors without touching anyone already inside |

---

## WHAT WE ARE DELIBERATELY NOT DOING AT LAUNCH

Written down so it is a decision on the record rather than something that quietly creeps back in.

- **No paid acquisition.** Cold paid traffic into a deep game with a cold start converts terribly, and
  we would be paying to learn what Phase 1 teaches free.
- **No promised chain date.** Two of three gates are external.
- **No earnings, yield, or price messaging.** In any channel, including replies.
- **No leading with crypto.** Segment C is last, by design, and its acquisition motion is the
  community drop rather than a campaign.
- **No new systems until the census says the base is not stuck.** The honest failure mode of a project
  this deep is shipping feature 40 while nobody has found feature 3.

---

## THE ONE-PAGE VERSION

**Ready now:** the game. Every engineering gate is green and verified.

**Blocking Door 1:** four deploy-config items and a launch night. No engineering.

**Blocking Door 2:** one `npm publish`.

**Blocking Door 3:** a third-party audit that has not started and six open launch-checklist rows. Neither is
ours to close alone, and neither should hold the game.

**The real risk is not any of the above.** It is launching into a city where nobody meets anybody.
Recruit in cohorts, read the coach census, and watch co-presence rather than headcount.

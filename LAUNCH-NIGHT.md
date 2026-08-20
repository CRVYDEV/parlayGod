# LAUNCH NIGHT — the ops runbook

**Written 2026-08-13 for the first live weekend.** `LAUNCH-READINESS.md` says what must be true
before the doors open; this says **what a person does on the night, and the morning after.** It is
written so the founder can run it alone, phone in hand, without a developer awake.

One rule governs it: **every answer here is "read an instrument, then act"** — never "guess". The
instruments were built for exactly this weekend; the whole document is pointers into them.

---

## T-minus (the afternoon before)

- [ ] `npm run preflight` on the box with the real environment → green. Green means it will boot.
- [ ] `/health` → 200, `worker.stale: false`. The worker is a separate process and the sole source
      of every alarm and every timed settlement; its silence looks exactly like a quiet night.
- [ ] `/admin → Integrations` — confirm which switches are LIVE (push / X sign-in / city wire).
      Whatever is off on launch night stays off; do not flip switches under pressure.
- [ ] Post a **test alert** to `INVARIANT_WEBHOOK_URL` and watch a human receive it. An alarm
      channel nobody has ever seen fire is an alarm channel that is muted.
- [ ] `npm run backup` completes and says **verified** with real row counts. Keep the file.
- [ ] **Capture the baseline** (this is the one that cannot be done later):

      MOD_KEY=<key> node tools/baseline.js https://www.omerta.fun

      It snapshots health, players, the funnel, the coach census, engagement, §10.4, token health
      and the integration switches into `./baselines/`, and prints a one-screen summary. Week two
      tells us nothing without week one — this file IS week zero.
- [ ] `INVITE_MODE` decided and set. For a seeded first night, **on**: a controlled cohort and a
      real Sybil bound. Mint codes ahead of time (`tools/invites.md` has the exact commands).
- [ ] **Sweep the test debris out of the player population.** Every smoke run, probe and deploy
      check that ever created a character left one behind, and they are indistinguishable from
      players to anything that counts heads. The 2026-08-20 rehearsal found the live box carrying
      enough of them that a brand-new player's "real players near you" board was **10 of 12 dead
      accounts**. `DISCOVERY.SEEN_DAYS` now hides anyone untouched for 30 days from the discovery
      and collision boards, so this is no longer visible to players — but the debris still inflates
      every population figure the baseline is about to freeze, and the baseline is the one thing
      that cannot be redone later. Needs `MOD_KEY`. Then make it a policy: a smoke run that creates
      a character deletes it, or names it so it can be swept in one query.
- [ ] **Walk the funnel yourself, as a first player, on the real box.** Not the suite — the suite
      proves the code does what it says; this asks whether a stranger arriving cold has a good
      first ten minutes. Sign up fresh, read what you are shown, pull a job, open the ten screens
      the coach points at. Every defect this has found was invisible to green tests, because each
      was a screen telling the truth about the wrong thing.

## The night

- **Founder present and playing.** In a game about families, running one is content. Recruit into
  it from the city chat; the first family on the map is the first story.
- Keep `/admin` open in a tab. It refreshes itself every 15s. The three things worth glancing at:
  the **§10.4 banner** (must stay OK), **Backups** (must not go red), and the **activity feed**
  (is anyone stuck — the same error repeating from many players is a wall, not a coincidence).
- The Discord **city wire** (if live) is the pulse: kills, wars, breakouts posting themselves is
  the game working. Quiet wire + players online = everyone is grinding solo; nudge them together
  (post a contract, start a war, throw a gala — conflict is content and the founder can seed it).
- **Do not retune levers on launch night.** Every number is founder-signed and sim-measured; a
  live-fire retune bypasses both. Write the itch down for the morning instead.

## When something breaks (the 3am page)

**The §10.4 alarm fires** (webhook says a conservation check is drifting):
1. Open `/admin → invariants`. Find the check that is red and the drift amount.
2. **A stable drift** (same number every sweep) is a misclassified ledger reason — ugly, not
   urgent. Write down the check name + amount; it can wait for daylight.
3. **A growing drift** is live value creation/destruction. This is the one real emergency the
   game defines. Page the developer; if unreachable and it is growing fast, the blunt correct
   move is to scale the API service to zero (Render dashboard) — a stopped game loses a night,
   a mint loop loses the economy. The worker can stay up (it only sweeps).

**Players report "Internal error" / THE LINE'S DEAD:**
1. `/health` first. 503 + `db_down` = the database, not the app — check the Render Postgres
   dashboard; the app self-heals when the DB returns (no redeploy needed).
2. `/health` 200 but errors persist = read the API logs for the named error code. A `500
   internal` with a stack is a real bug: capture the stack, tell players it is being looked at,
   page the developer. Do NOT restart-loop the service on a database problem — it adds a restart
   to an outage.
3. Slow everything + `db_down` flickering under load = the pool cliff (`DEPLOY.md` measured it:
   a starved pool queues into 10s timeouts that read as an outage). The dial is the **database
   plan** first, `PG_POOL_MAX` second. This is a scale-up, not a bug.

**The worker goes stale** (`/health` shows `worker.stale: true`):
- Restart the worker service. Everything it does is idempotent by design (twenty sweeps have
  been SIGKILLed mid-run by the chaos harness and paid exactly once); a restart is always safe.

**A player found an exploit** (or claims to):
- Ban is reversible; economy damage is not. `POST /v1/mod/ban` from `/admin`, write down exactly
  what they did, let daylight sort truth from bluff. The ledger records everything — nothing a
  player does is unaccounted, so there is no need to act beyond containment.

## The morning after

1. Run the baseline again and put the two summaries side by side:
   `MOD_KEY=<key> node tools/baseline.js https://www.omerta.fun`
2. **Read the coach census** (`/admin`, "Where the Coach Has Them"). The rung half the base is
   sitting on IS the drop-off, and it names its own fix. This one number decides what gets
   worked on next week.
3. Read the funnel: signups → pulled-a-job → declared-path → in-a-family. The first big cliff is
   the thing to fix; everything downstream of it is noise until it moves.
4. Read `/v1/mod/engagement` for the returning-vs-churned split, and the screen-reach table for
   which screens nobody found (worst-first — the bottom of that list is a nav decision).
5. §10.4 sweep + backup watchdog both clean. If the night left a stable drift (see above), now
   is when it gets diagnosed.
6. Write down, in one paragraph: what surprised us. That paragraph is next week's plan.

## What NOT to do this weekend

- No lever retunes, no new features, no schema changes, no chain arming. Door 3 stays shut
  behind the security audit regardless of how well the night goes.
- No earnings/price/APY language in any reply anywhere, including Discord — the five never-claim
  rules (`MARKETING.md` §READ FIRST) bind casual replies hardest, because that is where such a
  claim actually happens.

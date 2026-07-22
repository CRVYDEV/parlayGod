# OMERTÀ — the DO-IT-YOURSELF deploy checklist (no coding, no terminal)

This gets the **game** live at a real website in about 30–45 minutes, using **Render** (a host built for apps
like this). You'll click through dashboards — no commands. When you're ready for the real-money/mainnet layer,
jump to the last section.

> Why not Vercel? Vercel runs tiny serverless functions + static pages. OMERTÀ is a *full always-on server* +
> a *background worker* + a *live database*. Render (or Railway) is built for exactly that. Vercel would fail.

---

## PART A — get the game live (Wave 1)

### Step 1 — put the code on GitHub's main branch (5 min)
The code already lives at your GitHub repo. This deploy config (`render.yaml`) is on a working branch, so first
get it onto your **main** branch:
- On GitHub, open the repo → the Pull Requests tab → find/open the PR for branch `claude/new-session-7ufca0`
  (or "New pull request" → base `main`, compare that branch) → **Merge**.
- (If you'd rather not merge yet, you can instead tell Render in Step 3 to deploy *that branch* — there's a
  "Branch" dropdown. Either works.)

### Step 2 — make a Render account (2 min)
- Go to **render.com** → **Sign up** → choose **"Sign in with GitHub"** (so Render can see your repo).
- Authorize Render to access the OMERTÀ repository when it asks.

### Step 3 — deploy the whole stack from the Blueprint (5 min + a build wait)
- In Render: **New +** (top right) → **Blueprint**.
- Pick your OMERTÀ repository. Render finds the `render.yaml` file and shows it will create **three things**:
  `omerta-api` (the website), `omerta-worker` (the background engine), and `omerta-db` (the database).
- (If you skipped the merge in Step 1, set the **Branch** to `claude/new-session-7ufca0` here.)
- Click **Apply**. Render generates the secret values automatically and starts building. First build ≈ 2–5 min.
- When `omerta-api` shows **"Live"**, click its URL (looks like `https://omerta-api.onrender.com`). **The game
  loads.** 🎉 That's your site.

### Step 4 — confirm it's healthy (3 min)
- **Get your admin key:** Render → the **omerta-secrets** environment group (left nav) → reveal **`MOD_KEY`** →
  copy it.
- Visit **`your-url/admin`** → paste the `MOD_KEY` → the ops dashboard opens.
- Look at the big **"§10.4 / integrity" banner** — it should read **OK** (green). That's the built-in accountant
  confirming no money is leaking in the economy. It re-checks every night.
- Back on the game URL: tap **guest / play** → create a character → **pull a job**. If cash goes up, the whole
  loop works end to end.

### Step 5 — put it on your own domain (10 min + DNS wait)
- Buy a domain at **Namecheap** or **Cloudflare** (~$12/yr). ⚑ Pick your name.
- Render → **omerta-api** → **Settings** → **Custom Domains** → **Add** `yourdomain.com`. Render shows you a
  DNS record to add (a CNAME).
- At your registrar, add that record. HTTPS (the padlock) turns on automatically once DNS propagates (minutes
  to a couple hours).
- Optional but nice: in **omerta-api → Environment**, set `PUBLIC_URL` and `SOCIAL_GAME_URL` to your domain
  (makes share links + link previews use it), then **Save** (it redeploys).

### Step 6 — run it as a closed alpha (recommended)
- In **omerta-api → Environment**, add `INVITE_MODE` = `on` → **Save**.
- Mint invite codes: on the `/admin` dashboard use the **"mint invites"** action, hand the codes to your first
  players. New sign-ups now need a code; you control who's in.
- To open to everyone later: delete `INVITE_MODE` (or set it to `off`) and save.

**You now have a live game on your own domain.** Total real cost so far: ~$20/month (two small services + a
database) + your domain. No blockchain, minimal risk.

---

## PART B — day-to-day running (yours, ongoing)
- **Watch the numbers:** `your-url/admin` is your control room — player counts, the economy gauges, the
  onboarding funnel (who's dropping off), and the mod actions (ban, mint invites, etc.).
- **Get alerted:** set `INVARIANT_WEBHOOK_URL` (a Slack or Discord "incoming webhook" URL) in the api service's
  Environment, and the nightly job pings you if the economy ever drifts. Recommended.
- **Ship updates:** any change pushed to your connected branch auto-redeploys (a minute or two). Your data
  survives — the database back-fills new columns automatically on boot (no migration step).
- **The economy dials** live in `SIGN-OFF.md`. The game ships fine on the defaults; only change them
  deliberately, and re-run the checks after (that's a developer task if you ever want it).

---

## PART C — when you're ready for real money (Wave 2 / mainnet)
You said the legal side is cleared — good, that's the biggest gate. **But "legal-approved" is not the same as
"safe to hold funds."** Two technical safety steps still genuinely protect you (and your players' money):

1. **Run the contract tests once, for real.** The blockchain code compiles clean but its full test run
   (`forge test`) has never actually executed here (the build tool was network-blocked). Have it run green on a
   normal machine first. It's free and fast.
2. **Strongly consider the third-party audit anyway.** Even with legal clearance, a bug in the withdrawal
   contract or the signing key means real money can be lost or stolen — that's not a legal risk, it's a
   *theft/loss* risk. An audit is the standard insurance. Your call, but I'd urge it before real ETH flows.

Then the mechanics (a developer or a careful, methodical you following **`CHAIN-DEPLOY.md`** step by step):
- **Rehearse the entire flow FREE first** on a test network — the repo has a one-command prover
  (`tools/chain-e2e.js`) that deploys everything and does a fake withdrawal end to end. Do this before mainnet.
- **The treasury lives in a Safe** (a shared multi-signature vault at **safe.global**). Set it up, make yourself
  (and ideally one trusted other) signers with **hardware wallets** (a Ledger, ~$80). This owns the contracts +
  the OMR supply. Don't put the keys on a laptop.
- **The signing key** (`VOUCHER_SIGNER_PK`) authorizes withdrawals — it belongs in a key-management service, not
  a plain setting. Treat it like the vault combination.
- **Deploy the contracts** to Robinhood Chain and **fund them** from the Safe (the system can never pay out more
  than you fund — that's by design).
- **Seed liquidity** (real ETH in an OMR↔ETH pool) so withdrawn OMR has value, and stand up the two small bots
  the design references (not built yet — a scoped dev task).
- **Flip it on:** add the `CHAIN_*` values (see `CHAIN-DEPLOY.md` §4 and `.env.example`) to your **existing**
  Render services. The game was already live; these *activate* the dormant crypto rail. Do one small real
  round-trip first, watch the dashboards, then announce.

Realistically, Wave 2 is where you may still want a developer for a few days even if you run Wave 1 solo —
deploying contracts and custodying keys is unforgiving work. Wave 1, above, you can absolutely do yourself.

---

## Alternative host: Railway (if you prefer it to Render)
Railway also works (persistent apps + Postgres). It reads the included `Procfile` (`web` + `worker`).
Roughly: railway.app → New Project → Deploy from GitHub → add a **PostgreSQL** plugin → create **two services**
from the repo, one running `npm start` (web) and one `npm run worker` → set the env vars from `.env.example`
(Railway won't auto-generate them like Render's Blueprint does, so you paste your own long random strings for
`JWT_SECRET` / `MARKET_SEED` / `MOD_KEY`, and make sure `MARKET_SEED` is IDENTICAL on both services) → attach a
domain. Render's Blueprint is the more hands-off path, which is why it's the primary one above.

---

*Files this references: `render.yaml` (the Blueprint), `.env.example` (every setting explained), `Procfile`
(Railway/other hosts), `DEPLOY.md` (full technical runbook), `CHAIN-DEPLOY.md` (mainnet), `LAUNCH.md` (the
strategy), `SIGN-OFF.md` (economy dials).*

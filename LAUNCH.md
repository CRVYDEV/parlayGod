# OMERTÀ — the launch plan (founder's master guide)

**Who this is for:** you, Jorge — the non-technical founder. This is the map from "it's built" to "it's live
on the internet, and eventually on mainnet with real money." It sits *above* the two technical runbooks:
`DEPLOY.md` (the game) and `CHAIN-DEPLOY.md` (the blockchain). You hand those to the people you hire; you read
this one.

**Honest framing first.** I'm the AI that helped build this. This plan is a solid framework, but it is **not**
a substitute for three humans you will need to pay: a **developer/operator**, a **smart-contract auditor**, and
a **crypto/securities lawyer**. With zero technical ability you cannot (and should not) deploy smart contracts,
run a production server, or custody the treasury key yourself. Your job is to be the CEO: hire the right people,
make the decisions marked ⚑ below, hold the money, and own the timeline. Everything technical is delegable.

---

## The one big idea: launch in TWO WAVES, not one

The single most important thing to understand: **the game and the money are separable, on purpose.** The whole
system was built so the blockchain layer is *dormant by default* — the game runs completely without it, and you
switch the crypto on later by setting a few config values. So don't try to launch everything at once. That
would chain your fast, low-risk game launch to your slow, expensive, legally-gated crypto launch.

| | **WAVE 1 — The Game** | **WAVE 2 — The Money (mainnet)** |
|---|---|---|
| **What goes live** | The full game at a real website. $OMR is an in-game currency you earn and spend. | Real ETH in, real on-chain OMR out. Withdrawals, bonds, the Store paywall. |
| **Risk** | Low. It's a game. No real-money extraction. | High. Real value + securities-adjacent (RWA stocks) + custody of a signing key. |
| **What blocks it** | Nothing technical — it's built and tested (34/34). Just needs hosting + a domain. | THREE hard gates: an audit, a lawyer's sign-off, and a security-audited signing key. |
| **Time to live** | Days to ~2 weeks (mostly hiring + setup). | 2–4+ months (audit queues + legal are the long poles). |
| **Rough cost** | Low — hosting is ~$20–70/month; setup is a few hours of a contractor. | High — audit $15k–$80k+, legal $10k–$50k+, plus liquidity you seed. |
| **Runbook** | `DEPLOY.md` | `CHAIN-DEPLOY.md` |

**Recommendation:** ship Wave 1 as a **closed alpha** (invite-only) in the next few weeks. Get real people
playing, find the fun, watch the economy with the built-in dashboards. Run Wave 2 in parallel on a slower
track (start the audit + lawyer conversations *now*, because they take months). Turn the money on only when
all three gates are green. The game already tells players the crypto rail is "coming at launch," so this is the
intended path, not a compromise.

---

## The team you hire (you can't do this alone — and that's fine)

You need three roles. They can be three people, or a technical co-founder who covers the first two, plus a law
firm. Ranges are rough US/EU market rates in 2026 — adjust for freelancers/regions.

1. **A developer / DevOps operator** — *the most important hire.* Sets up the hosting, deploys the game,
   operates it, and later deploys the contracts. Does NOT need to have written the game (it's done + documented);
   they need to be competent with Node.js, Postgres, a cloud host, and (for Wave 2) EVM/Foundry/a hardware
   wallet. **Part-time is fine** to start. *Cost: a few hours for Wave-1 setup; an ongoing part-time retainer
   to operate + do Wave 2.* Where to find one: a referral, Toptal/Gun.io/Contra, or a crypto-dev community.
   ⚑ **Vet them for smart-contract + key-management experience specifically** before Wave 2.

2. **A smart-contract auditor** — *a firm, not a freelancer, for the money layer.* Audits the Solidity
   contracts **and** the off-chain signer (`src/chain.js`) — both, because the signer mints withdrawal
   authority. *Cost: ~$15k–$80k+ depending on firm + scope. Queues are weeks–months — book early.* Names to get
   quotes from: Trail of Bits, OpenZeppelin, Spearbit, Zellic, Cantina, Sherlock/Code4rena (contest-style).

3. **A crypto/securities lawyer** — *non-negotiable for Wave 2.* This project touches real-money extraction,
   **tokenized real-world stocks (RWA)**, geofencing/KYC for US persons, and a **two-level referral bonus**
   that must stay on the right side of the MLM line. *Cost: ~$10k–$50k+ for an opinion + structure.* This is
   the **#1 gate on Wave 2** and the slowest — start these conversations *this month*, before the audit.

Optional later: a part-time **community manager / marketer** for the alpha, and a **designer** if you want a
marketing landing page beyond the in-game one.

> **You are not qualified to make the legal or securities calls, and neither am I.** Nothing in this repo is
> legal or financial advice. The lawyer decides what's allowed, in which countries, for whom. Build to their
> guidance.

---

## WAVE 1 — get the game live (the fast, cheap, low-risk win)

Goal: a real person can visit a URL, sign in, and play. No real money. Follow `DEPLOY.md` for the exact knobs;
this is the founder-level view of who does what.

### Step 1.1 — Buy the pieces (you can do most of this yourself)
- ⚑ **Pick a name + buy a domain** (~$10–15/yr). Namecheap or Cloudflare are the easy ones. *You do this.*
- **Pick a host.** Recommend a "Platform-as-a-Service" that runs a Node app + a managed Postgres database from
  your GitHub with almost no config: **Railway** (friendliest), **Render**, or **Fly.io**. *~$20–70/month at
  alpha scale.* Your developer picks + sets it up; you own the account + the billing card.
- **Create a GitHub account** if you don't have one, and make sure your developer has access to the code. *You
  own the repo; you grant access.*

### Step 1.2 — Your developer deploys it (a few hours of their time)
They follow `DEPLOY.md`. In plain English, they will:
- Run the app as **two processes** on the host — the **game server** (`npm start`) and a **background worker**
  (`npm run worker`) — both pointed at **one Postgres database** the host provides.
- Set a handful of **secret config values** (the runbook lists them): a database URL, a couple of random
  secret strings (`JWT_SECRET`, `MARKET_SEED`), a moderator key (`MOD_KEY`), and `NODE_ENV=production`. The
  server *refuses to start* without the important ones — a safety feature, not a bug.
- Point your **domain** at the host and turn on **HTTPS** (the padlock) — hosts do this in a click or two.
- **The website is the game.** The server serves the playable console at your domain's home page (`/`), plus
  an admin dashboard at `/admin` and a rulebook at `/wiki`. You do **not** need a separate website built.

### Step 1.3 — Decide how open the alpha is ⚑
- **Recommended: closed/invite-only.** Set `INVITE_MODE=on`; you mint invite codes from the admin dashboard and
  hand them out. Lets you control load, gather feedback, and fix things before the crowd. You can flip to open
  anytime.
- Sign-in options work out of the box: **guest** (one tap, great for trying it), plus X/Twitter and Privy if
  you set those up (optional, deploy-time work — guest is enough to start).

### Step 1.4 — Confirm it's healthy (your developer runs the smoke check)
`DEPLOY.md` §8 is the checklist. The important ones for you to *see*:
- The **admin dashboard** (`/admin`) loads and its **"§10.4" banner reads OK** — that's the built-in accountant
  proving no money is leaking in the economy. It runs nightly forever; if it ever flips to DRIFT you (or the
  developer) get alerted (set `INVARIANT_WEBHOOK_URL`).
- A fresh guest can **create a character and pull a job.** That's the loop working end to end.

### Step 1.5 — Run the alpha (this is the real work — your part)
- Recruit your first players (the game has built-in **referral + "Spread the Word"** mechanics — lean on them).
- Watch the **admin dashboard** (`/admin`) and the **funnel** (`/v1/mod/funnel`): who signs up, who gets
  stuck, where they drop off. Use it to tune the onboarding, not the economy numbers (those are sim-audited —
  see `SIGN-OFF.md`; change them only deliberately).
- Collect feedback, fix rough edges, decide the balance sign-offs in `SIGN-OFF.md` that are still open.

**At the end of Wave 1 you have:** a live game, real players, real feedback, and a running economy you can
watch — all with essentially zero legal/financial risk, because no real money moves. This alone is a shippable
product.

---

## WAVE 2 — turn on the money (mainnet), the slow careful track

Run this **in parallel** with Wave 1, but it goes live only after all three gates below are green. `CHAIN-DEPLOY.md`
is the technical runbook; here's the founder view + the order that actually matters.

### The three HARD GATES (nothing touches mainnet until all three are ✅)
1. **The contract test suite passes on a real toolchain.** The Solidity was written + compiles clean, but the
   full `forge test` has never actually *run* here (the build sandbox blocked the tool's downloads). Your
   developer runs it on any normal machine first (`cd omerta-contracts && ./run-forge-test.sh`). Cheap, fast,
   and it must be green before you pay an auditor to look.
2. **A third-party audit of the contracts AND the signer** comes back clean (or you fix what it finds). *This
   is what you're paying the auditor for.* Book it early — queues are long.
3. **Your lawyer signs off** on the Risk-to-Earn model, the RWA/tokenized-stock feature, KYC/geofencing, and
   the referral structure — and tells you which countries/users you can serve. *The longest pole. Start now.*

### Step 2.1 — Start the legal + audit conversations (MONTH 1 of Wave 2)
Do this *before* any deployment. Get quotes + timelines from 2–3 auditors and 1–2 law firms. The lawyer's
guidance may change what you launch (e.g. geofence US persons out of RWA extraction), so you want it early.

### Step 2.2 — Rehearse the whole thing on a test network (free, no risk)
Your developer can dry-run the *entire* chain flow on a free test network **today** — the repo has a one-command
end-to-end prover (`tools/chain-e2e.js`) that deploys the contracts, links a wallet, pays a fee, mints, and does
a real withdrawal, all on a throwaay chain. This proves the machinery works and trains your operator, at zero
cost, while the audit + legal run. **Do this during Step 2.1.**

### Step 2.3 — Set up the treasury "vault" (the Gnosis Safe) ⚑
The contracts, the OMR token supply, and the treasury are owned by a **Safe** — a shared multi-signature wallet
(like a vault that needs 2-of-3 keys to move anything). This is the **root of trust** for the whole money layer.
- ⚑ **You decide the signers** (e.g. you + a trusted co-founder + your developer, 2-of-3). Each signer needs a
  **hardware wallet** (a Ledger/Trezor, ~$60–150 each). Do NOT make it a single key on someone's laptop.
- The Safe is a web app (safe.global) — you can be a signer even though you're non-technical; you just approve
  transactions by clicking + confirming on your hardware wallet.

### Step 2.4 — Deploy the contracts + fund the reserves (after gates 1+2)
Your developer follows `CHAIN-DEPLOY.md` §2–§5: deploys the six contracts, hands ownership to the Safe, and the
**Safe funds them** with OMR (this backs withdrawals — the system can *never* mint more than you fund, by
design). The **signing key** (`VOUCHER_SIGNER_PK`) — the thing that authorizes withdrawals — must live in a
proper key-management service (HSM/KMS), *not* a plain environment variable. This is the single most
security-critical operational decision; it's part of what the audit covers.

### Step 2.5 — Seed the liquidity + the bots (the last mile)
For withdrawals to have real value, there must be an **OMR ↔ ETH market** with liquidity you provide, plus two
small automated bots (a "buyback" bot and a "liquidity-pairing" bot) that the design references but that are
**not built yet** — a scoped piece of Wave-2 developer work. Budget for the liquidity itself (this is real ETH
you put in) and for building/running the bots.

### Step 2.6 — Flip the switch
Only now: your developer sets the `CHAIN_*` config values on the live game (the runbook's env table). The game
was already running; setting these *activates* the dormant crypto rail — withdrawals, bonds, the wallet-connect
flow all come alive. Do a real end-to-end round-trip on mainnet with a small amount first (§6 of the runbook),
watch the dashboards, then announce.

---

## The critical path (what blocks what)

```
WAVE 1 (game):   hire dev ──► buy domain+host ──► deploy game ──► closed alpha ──► (open when ready)
                                                                     │
WAVE 2 (money):  ┌─ hire lawyer  ─────────(months)─────────────┐    │
   start now ──► ├─ hire auditor ─► forge test ─► AUDIT ────────┤──► set up Safe ─► deploy contracts
                 └─ testnet rehearsal (free, anytime) ──────────┘         + fund + key mgmt ─► seed liquidity
                                                                          + build bots ─► FLIP THE CRYPTO ON
```
The two waves are independent until the very end. Wave 1 can launch and run for months before Wave 2 is ready.
**The gate that will actually decide your mainnet date is the lawyer + the audit queue — so start those first.**

---

## What YOU personally own (the ⚑ decisions)

Everything else is delegable, but these are yours:
- ⚑ **The two-wave call:** ship the game first (recommended), or hold for a big-bang launch. (You can change
  your mind; I recommend shipping the game first.)
- ⚑ **The name + domain.**
- ⚑ **Closed vs open alpha** for Wave 1 (recommend closed/invite-only first).
- ⚑ **Who you hire** (dev, auditor, lawyer) and the budget you'll spend.
- ⚑ **The Safe signers** (who holds the keys to the treasury) — pick trustworthy people; use hardware wallets.
- ⚑ **The economy sign-offs** in `SIGN-OFF.md` (the game ships fine on the built-in defaults; these are dials).
- ⚑ **The legal boundaries** your lawyer defines (which countries, KYC, US persons, RWA) — you enforce them.

---

## Rough budget (order-of-magnitude, not a quote)

| Item | When | Rough cost |
|---|---|---|
| Domain | Wave 1 | ~$15/yr |
| Hosting (server + database) | Wave 1 | ~$20–70/month |
| Developer — Wave 1 setup | Wave 1 | a few hours' rate |
| Developer — ongoing operator + Wave 2 build | both | part-time retainer (varies widely) |
| Smart-contract audit (contracts + signer) | Wave 2 | ~$15k–$80k+ |
| Crypto/securities legal opinion | Wave 2 | ~$10k–$50k+ |
| Hardware wallets for the Safe signers | Wave 2 | ~$60–150 each |
| Liquidity you seed (real ETH) | Wave 2 | your call — a launch-economics decision |

**Wave 1 is cheap enough to do now.** Wave 2 is where the real money goes — which is exactly why you de-risk it
behind the game launch and the two gates.

---

## The next three things to do this week
1. **Decide the two-wave plan** (⚑) and pick a working name + domain.
2. **Find your developer/operator.** They do the Wave-1 deploy from `DEPLOY.md` and run the free testnet
   rehearsal from `CHAIN-DEPLOY.md`/`tools/chain-e2e.js`.
3. **Email 2 auditors and 1 crypto lawyer for quotes + timelines.** These are the long poles for Wave 2; the
   sooner they're in motion, the sooner "mainnet" has a real date.

*Runbooks referenced: `DEPLOY.md` (the game), `CHAIN-DEPLOY.md` (mainnet), `SIGN-OFF.md` (economy decisions),
`CLAUDE.md` (the full system-of-record). Hand the runbooks to your developer; keep this file as your map.*

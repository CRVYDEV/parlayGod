# AUDIT — Full-Product Max-Effort Red-Team (2026-07-23 → overnight)

Founder ask: *"Run an entire audit over the entire product from the game to smart contracts.
Consider every factor and interaction. Find areas where the game doesn't seem complete or flow
smooth. Critique UI/UX. Check the economy makes sense. Max-effort red-team playthrough & audit."*

**Method.** Eight independent parallel lenses across two rounds, every finding re-verified against
source before any fix, a regression/verification per fix, suite kept **30/30 + sim drift-0**
throughout. Baseline `a2ece85`. Focus: the freshest, least-audited surfaces (the value-creation
pivot + the overnight UX drop) in round 1; the founder's broader "flow / completeness / economy"
asks in round 2.

**Headline: no CRITICAL, no §10.4 leak, no auth bypass, no contract-parity drift.** The backend is
enormous and correct; the defects were concentrated in the newest robustness edges and — most of all
— in the **guidance/UX layer**, exactly where the founder suspected the game "doesn't feel finished."

---

## ROUND 1 — the value-creation pivot + the overnight UX drop (5 lenses)

| Lens | Verdict | Fixed |
|---|---|---|
| **A — economy / §10.4** | no leak | **A1** wage epoch cross-process advisory lock (a 2nd worker replica could silently double-emit an epoch's budget) |
| **B — concurrency / locks** | clean | **B2** invite consumed atomically in the account-create txn (no double-burn under a race); **B3** bounded two in-process caches |
| **D — auth / OAuth** | CSRF/token-leak vectors clean | **D1** rate-limit the OAuth callback GET; **D2** bind the tweet author on the Spread-the-Word payout |
| **E — cross-system + contracts** | **no defects** | — exit toll / surcharge / bond split / OMR sell-tax all parity-clean; no extraction dodge; no new loot vault |
| **C — UI/UX** (founder top lens) | many gaps | **HIGH** the 10 payoff-screen `\n` bug + 7 MED/LOW (see below) |

**Lens C client fixes shipped:** the literal-`\n` dialog bug on every leaderboard/dossier/trace
screen; a curated **Extraction** card (Mint + Withdraw — the earn thesis was deck-only); the mobile
bottom-nav (was 3 stops → the 5 starter screens); the FAMILY-chat dead-end; den fight labels;
empty-feed placeholder; undefined CSS vars; deck convoy templates; the 🌐 language affordance.

## ROUND 2 — flow / completeness / economy / broad correctness (3 lenses)

| Lens | Verdict | Fixed |
|---|---|---|
| **F — gameplay flow** | 2 HIGH | **F1** the coach ladder; **F2** the death moment (see below) |
| **G — economy balance** | coherent, one systemic tension | recommendations only (ground rule #1 — numbers are your levers) |
| **H — broad correctness sweep** | **CLEAN** (no bugs) | — the core modules are genuinely hardened by prior passes |

**F1 (HIGH) — the coach self-destructed for the whole population.** `coachOf`'s "Finish your First
Week" rung sat ahead of every mid-game rung and required all 9 onboard tasks — but 3 are socials +
1 is the wallet link, and the socials throw `verify_unavailable` whenever `SOCIAL_VERIFY_MODE` is
`off` (the default). So the single most-used "what next" advisor pinned at "Finish your First Week"
forever and never surfaced the kitchen / skills / go-legit guidance. **Fixed:** gate on the five
completable *gameplay* tasks only; broaden the earner check; add an early lvl-3 racket nudge; stop
promising fronts before L15.

**F2 (HIGH) — death was invisible to the player it happened to.** The estate txn auto-creates the
heir, so the client never hit the create screen; the rich `report.kept/lost` was notified but had
zero consumer. The victim's central "play for keeps" beat was a silent flip to a weak gen-2 sheet.
**Fixed:** a death/heir modal (YOUR STREET IS DEAD · killed by X · the heir KEEPS vs the street LOST
· the bloodline rises), driven off the estate event through the feed (delivery-once safe, deduped
per generation), + estate/vendetta feed lines. Verified end-to-end.

---

## FOR FOUNDER SIGN-OFF (ground rule #1 — NOT changed, ranked recommendations)

These are economy levers (Lens G) — measured, not touched. Decide, then I'll apply + re-sim.

1. **Passive fronts ≫ active loops (systemic).** A maxed 5-front stack nets **~$49M/day** at
   near-zero risk vs every active skill loop at **$200–420k/day** (boxing/racing/port/heists) — a
   ~100× gap that inverts Risk-to-Earn at the top. Already on your radar (AUDIT-sim #1) but
   **under-measured**: the sim only probes laundromat t1 ($288k/day), so the true ceiling has never
   been surfaced. *Rec:* add a business-ladder sim probe (net-of-pad + maxed-stack $/day), then
   decide steeper pad / shared income bucket / passive cap — or accept it as the "capital works for
   you" endgame (it's *cash*, throttled at ~$5.2M/day of wash caps before it can extract).
2. **Port "Deep Run" is a trap route (MED, easy dial).** L32 gate, highest nominal margin, but the
   **lowest realized $/day** ($131k @ 30% caught) — strictly dominated by Open Water (L16, $303k @
   3%). Unlocking it is a downgrade. *Rec:* raise `PORT.ROUTES` deeprun `sell` (~$2,400+) or drop
   its `patrol` so the deepest route rewards the level + risk it demands.
3. **Territory racket TYPES: Numbers lazy-dominates (MED).** For a once-a-day collector, Numbers
   ×1.0 ($1.44M/day, never raided) beats Protection ($376k) and Smuggling ($280k) — the "higher-
   take" hot types only win if collected inside their heat window. Partly addressed (the
   `protection.scrutinyPerHr 6→10` retune). *Rec:* surface "collect actively or pick Numbers"
   guidance, or narrow the lazy-EV gap.
4. **Stable vs Boxing cap asymmetry (LOW).** `STABLE.STABLE_MAX 4` vs `BOXING.STABLE_MAX 3` → +33%
   racing ceiling for the identical faucet mechanic. *Rec:* align the caps.
5. **i18n honesty (LOW, product call).** The 15 language packs translate the chrome; game **prose
   stays English** (documented design). The picker slightly over-promises, worst in RTL Arabic
   (layout mirrors, content doesn't). *Rec:* either label the picker "(menus only)" or commission a
   first-minute-prose translation pass (welcome/glossary/coach/Streets) — a sizable content task
   with real quality risk, so I left it for you rather than shipping machine translation overnight.

**Also flagged (accepted / prior-signed, no action):** kill-EV −$72k standalone (signed D1 —
contract-driven by design); bank-interest per-character Sybil split (D5, accepted); `pen:work` no
floor (self-limiting); trade-goods arbitrage (WATCH). The sim's NOS comment string contradicts its
own +EV — cosmetic doc nit.

**Coverage boundary (Lens H, honest):** did not exhaustively re-line-trace casino stateful
blackjack/heads-up-poker in-hand branches, `pen.executeBreak`, world co-op-raid internals, or
economy swap/stake internals — all within prior audit coverage; the residual surface for a future
focused pass.

---

## Commits (branch `claude/new-session-7ufca0`)
- `023fb4b` backend hardening (A1, B2, B3, D1, D2)
- `f43eddf` + `5b6a474` client UX batch (C1, C9, C10, C5, C6, C13, C14, C2, C15)
- `14d490b` gameplay flow (F1 coach, F2 death moment)

Suite **30/30 + sim drift-0** at every commit. Contracts unchanged (round-1 Lens E verified
parity-clean; `forge test` 73/73 still stands from the prior session).

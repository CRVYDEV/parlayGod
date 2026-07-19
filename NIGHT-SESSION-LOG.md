# Night session log — autonomous build + shakedown

Founder asleep; running autonomously per the "build 4 features + audit MAX EFFORT + loop shakedowns
until I wake" directive. Guardrails: no legal-gated R2/R3, no Foundry contract work; `npm test`
(26 suites) + `node tools/sim.js` drift-0 stay green after every change; push only to
`claude/new-session-7ufca0`; nothing destructive/outward-facing beyond branch pushes.

Every feature: design → build → test → §10.4 + sim green → commit → max-effort red-team → fix → commit.

## Plan
- F1 — Family-book dividend (Dynasty step two)
- F2 — PLEX-for-packages (Store SKUs in earned $OMR)
- F3 — Named landmarks (district dedications, $OMR status sink)
- F4 — Family dynasty (gang-book naming + crest + leaderboard)
- Then: shakedown loop (adversarial exploit hunt + gameplay walkthroughs + fixes) until you're back.

## Ledger (newest last)
- Session start. Suite 26/26, sim drift-0 baseline. Beginning F1.
- F1 DONE: family-book dividend. Gang RWA book yields a ~daily $OMR dividend to the treasury reserve, funded by the shared sink-fed pool (family invests fund it 15%). §10.4 transfer (pool→reserve), pool-bounded, boss/underboss, gang→pool lock order. Route /v1/gangs/portfolio/dividend, board+console surface, test green. Suite 26/26, sim drift-0. Red-team launched.
- F1 RED-TEAM: CLEAN, no CRITICAL/HIGH/MED. §10.4 exact (transfer, pool-bounded, never mints), locks acyclic, no persist-clobber, dissolution clean. 2 LOW (accepted): shared global dividend pool contested by families+individuals (balance note — no reserve→personal extraction path, so safe); cosmetic stale board hint. No fix needed.
- F2 DONE: PLEX-for-packages. Pay a Store SKU from EARNED $OMR (plex:<sku> burn via the plex:% term — same non-§10.4 entitlement an ETH payer gets; ETH funds the Vig, $OMR burns supply). Market-linked quote (feeEth × buyback oracle × premium, static floor). In-context grant routes persisted cols (mint_credits/respawn_tokens via h.acct, wire_until via ch) to avoid persist-clobber; patron/pass_* direct SQL. Route /v1/store/plex/:sku, board plexOmr, console PLEX buttons, describe(). Test: burn ledgered + entitlement granted + insufficient/bad-sku gates. Suite 26/26, sim drift-0.
- F2 RED-TEAM: CLEAN, no CRITICAL/HIGH/MED. Grant/clobber discipline correct (persisted cols via memory, non-persisted via SQL — committed once, no drift), the plex burn §10.4-exact, concurrency safe. 4 LOW: LOW-1 latent NaN-oracle (not player-reachable) FIXED (Number.isFinite guard in plexPackageQuote + storeBoard); LOW-2 duplicated grant logic (flagged, comment), LOW-3 no jail gate (consistent w/ payPlex, accepted), LOW-4 display-vs-charge drift (server-authoritative, accepted).
- F3 DONE: named landmarks. One dedicable plaque per district, held by the biggest $OMR flex; dedicating BURNS the $OMR (vanity:landmark → vanity:% term, deflationary, zero invariant change), a bigger flex takes it over (no refund — a flex, not escrow). Bears the account dynasty name → survives death. Routes GET /v1/landmarks + POST /v1/landmarks/:district, City-tab console section, test/landmarks.js (27th suite). Suite 27/27, sim drift-0.

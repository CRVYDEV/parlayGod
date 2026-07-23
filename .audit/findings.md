# Full-product red-team — findings tracker (session claude/new-session-7ufca0)
Baseline: a2ece85, suite 30/30, sim drift-0.

## Lens D — auth/OAuth (DONE, no CRIT/HIGH)
- [ ] LOW-D1: GET /v1/auth/x/callback bypasses all 3 rate limiters (auth limiter is POST-only; authed limiter returns on jwtVerify fail; public allowlist omits it). Fix: add '/v1/auth/x/callback' to checkPublicRateLimit prefix list (server.js ~265). Does real per-hit work (DELETE oauth_states + outbound X fetch).
- [ ] LOW-D2 (free hardening): verifyPostUp (verify.js:54-65) checks only that a tweet id EXISTS — not author. For auth_provider==='x' accounts, request tweet.fields=author_id and require data.author_id===acct.auth_subject. Upgrades "a post exists" → "this player's post exists". Cash-only/bounded so accepted, but cheap win.
- VERIFIED CLEAN: account-linking CSRF (both directions), token/secret leak (fragment redirects, same-origin), PKCE, state single-use+TTL, token exchange SSRF, verifyX confused-deputy gate default-off, other auth rate-limits, link-status info leak, 4h claim replay.

## Smoke (runtime) — all fresh surfaces OK
guest/create/wage/online/chat(text)/social/coach all 200. chat field is `text` (client + server agree). oauth start → 400 oauth_unconfigured (correct, dormant).

## Lens B — concurrency/locks (DONE, no CRIT/HIGH/MED)
- [ ] LOW-B1: emission.js:56 emittedThisEpoch scopes to UTC-day window but rows dated by `at DEFAULT now()`; a resume with explicit past opts.epoch reads consumed=0 → could re-pay full budget. NOT production-reachable (worker uses current epoch). Optional: stamp transactions.at in-window when opts.epoch given, OR derive consumed from wage_snapshots. Per-char FOR UPDATE stamp still prevents double-pay; endowment invariant still bounds lifetime.
- [ ] LOW-B2: server.js:404 OAuth login consumeInvite runs before accountForIdentity; two concurrent callbacks for same NEW identity burn 2 invites for 1 account. Safe direction (wastes invites, never bypasses). Fix: consumeInvite only when accountForIdentity returns created:true.
- [ ] LOW-B3: server.js:1587,1611 unbounded Maps actorNames + lastChatAt never evicted → slow mem growth. Fix: periodic prune / LRU cap.
- B4 (design call, not defect): activity wire reveals district-pinned presence (casino/speakeasy/world/races are venue-pinned). Public-by-design venues, no exact loc. Accept.
- VERIFIED CLEAN: wage epoch double-pay/budget (char→acct FOR UPDATE stamp), OAuth single-use state, two-phase social claim, troll box (no locks, joined_at gate, member-gated WS), activity onResponse (post-send, try/catch), standing-watch sweep (acct-only lock), persist-clobber of wire_tier/disinfo_until/wire_until, worker sweeps.

## Lens A — economy/§10.4 (DONE, no CRIT/HIGH leak)
- [ ] LOW-MED-A1: emission.js runWageEpoch has NO DB-level single-execution guard across worker PROCESSES (guardedTick is in-process only). Concurrent replicas / a mod-fired run alongside the scheduled tick → epoch emits ~2× budget, breaching the halving schedule, SILENT (lifetime endowment invariant still holds, per-epoch shape unchecked). Fix: pg_advisory_xact_lock(hash('wage'||epoch)) OR a wage_epochs(epoch) unique-row latch at top of runWageEpoch; optionally add per-epoch budget assertion to nightly invariant.
- A2 (informational, not §10.4): crossed-UTC-boundary crash-resume abandons the partial epoch (liveness/fairness, never over-emit). No fix needed for §10.4.
- VERIFIED CLEAN: exit toll reconciliation (net+dev+buy==gross exact), swap-sell surcharge (net-0 transfer, no crumb), reason classification (emission mint / tax transfer / dividend transfer / withdraw burn all correct, buckets present), dev-fund claim, single-run wage bound + idempotency + heir fresh, early-surcharge dodges (LIFO both replay+pricing, split/wash/stake non-dodge), bond ETH split (on-chain vs comp txHash gate, sum-to-10000, nonce dedup), faucet magnitude (wage ≤500/day, ≤1M lifetime, ≤5/acct/epoch).

## Runtime note
- Browser playthrough: simple mode 6 tabs (5 core + expander), mobile no h-overflow, sheet/Start-Here render clean. ONE 400 console error to trace (possible bodyless-POST regression in fresh code).

## Lens C — UI/UX/flow (DONE) — founder top priority
BROKEN:
- [ ] HIGH-C1: 10 alert() dialogs use double-escaped \\n → render literal "\n" on the PAYOFF screens (leaderboards/dossier/trace). L1444 Territory Empire, L1769 War Effort, L1772 Frontier, L2324 Wire Trace, L2332 Dossier, L2343 Spymaster, L2640-2642 Boxing, L2706-2708 Stable, L2772 Races Wheel, L2821 Port Legend. Fix: \\n → \n (Nightlife L2565 + feud L2102 do it right). VERIFY FIRST.
- [ ] LOW-C2: deck convoy-open template missing first goodId/qty load (L1910).
CONFUSING:
- [ ] MED-C3: i18n chrome-only; RTL Arabic reads broken (95% English body). Fix: label picker "(beta — menus only)" AND/OR translate first-minute surfaces (welcome, glossary, Streets headers, coach).
- [ ] MED-C4: secondary content via native alert/confirm/prompt (fixes C1 too if moved to .modal). Bigger refactor — minimal is C1.
- [ ] MED-C5: FAMILY chat tab silent dead-end for family-less → 400 no_gang blank pane. Hide/disable tab when !me.gang.
- [ ] LOW-C6: Den fight buttons "back favorite/dog" don't label which of A/B. renderDen L1797.
- [ ] LOW-C7: feed flavor uneven — boxing_bout/shakedown/track_entry/tourney_result/commission_veto/belt_stripped fall to terse stitcher; tribute drops actor. Confirm wage_paid uses d.omr.
- [ ] LOW-C8: Last Word raw JSON panel — rename/collapse.
INCOMPLETE:
- [ ] MED-C9: Withdraw + Mint deck-only (the earn thesis). Add curated buttons (dormant note). Going Legit has swap/stake/bonds/wallet but no Withdraw; Store says mint credit "spend on chain" but no button.
- [ ] MED-C10: mobile BNAV collapses to 3 stops in simple mode, omits Garage+City (never in BNAV). Map bottom nav to SIMPLE_TABS in simple mode. L1143/1149/1151.
- [ ] LOW-C11: cb/ammo Exchange deck-only.
- [ ] LOW-C12: Stable breed foal dropdowns allow identical/cross-kind. renderStable L2670.
- [ ] LOW-C13: empty live feed blank for new player — add placeholder. L1036.
POLISH:
- [ ] P-C14: undefined CSS vars --fg (no fallback, chat input + own-feed line), --gold. Define in :root.
- [ ] P-C15: lang picker bare unlabeled select — add 🌐.
- [ ] P-C16: prompt() for garrison reinforce (L1766) — inline input.
SOLID (verified): coach never dead-ends, Path card fixed, route/field names match, feedText no raw-JSON leak, describe/ERRMAP ~40 codes, in-flight lock + idempotency, renderActive skips focused input, cooldowns tick live.

## Lens E — cross-system + contracts (DONE) — NO CRIT/HIGH/MED/LOW
- Value-creation layer §10.4-exact, parity-clean. All ruled out: wage Sybil (minted wall binds, per-acct cap), surcharge/toll dodges (stake-wash/split/un-ledgered all fresh-priced), new loot vault (wage/dividend $OMR loots as liquid; buckets aren't balances), extraction≤inflow (txHash-gated real revenue, comps book zero POL/Vig), dividend/pool drains (separate pools, bounded+locked), OMR.sol sell-tax (registered-pair only, exempt list), OmertaBond split parity (event-booked, no drift), voucher toll parity (gross debit/net sign).
- Notes (intentional): 48h-held surcharge-free exit (D2 intent); staker over-tax fail-safe (player-unfavorable, not exploit); OMR taxExempt + V2 liquidity deploy-time (flagged).

## FIXES APPLIED (batch 1, backend)
- [x] A1: wage epoch pg_try_advisory_lock(0x5741, epoch) cross-process guard (emission.js).
- [x] B2: invite consumed atomically inside accountForIdentity create txn (auth.js + 2 callers server.js).
- [x] D1: /v1/auth/x/callback added to public rate-limit allowlist (server.js).
- [x] D2: verifyPostUp binds tweet author_id for x-provider accounts (verify.js).
- [ ] B3: bound actorNames + lastChatAt Maps (server.js). ← doing now

## CLIENT UX FIXES APPLIED (batch 2, public/index.html) — commit f43eddf + C15
- [x] C1 (HIGH): \\n → \n in 44 dialog sites (leaderboards/dossier/trace). Verified render.
- [x] C9 (MED): curated Extraction card (Mint + Withdraw) in Going Legit. Browser-verified.
- [x] C10 (MED): mobile bnav = 5 SIMPLE_TABS in simple mode (was 3, omitted garage/city). Verified 5 stops.
- [x] C5 (MED): FAMILY chat tab hides when no gang, falls back to feed.
- [x] C6 (LOW): den fight names the fighter + labels favorite/underdog + odds.
- [x] C13 (LOW): empty-feed placeholder.
- [x] C14 (POLISH): defined --fg/--gold/--warn.
- [x] C2 (LOW): deck convoy templates (open needs goodId/qty; load was `good`→`goodId`).
- [x] C15 (POLISH): 🌐 affordance on lang picker.
DEFERRED (flagged for founder): C3 (i18n prose translation — large content task ×15 langs, quality risk; chrome is translated, body/prose is English by documented design), C7 (feed templates — stitcher already legible), C8 (Last Word raw JSON — power-user surface), C11 (cb/ammo Exchange deck-only), C12 (breed foal dropdowns — clean server reject), C16 (garrison prompt() → inline).

## ROUND 2 LENSES (launched): F gameplay-flow/completeness, G economy-balance, H broad correctness sweep.

## ROUND 2 RESULTS
### Lens F — gameplay flow/completeness (2 HIGH, fixed)
- [x] F1 (HIGH): coach First-Week rung (game.js:523) masked all mid-game rungs + was uncompletable on default SOCIAL_VERIFY_MODE=off (3 socials + wallet throw). FIXED: gate on the 5 gameplay onboard tasks only; socials/wallet optional; broadened the earner check (rackets/assets/fighters/speakeasy) + added a lvl-3 racket rung + reworded so fronts aren't promised before L15.
- [x] F2 (HIGH): death moment invisible — heir auto-created in the estate txn, client never hit screen-create, report.kept/lost had no consumer, no estate/vendetta feedText. FIXED: death/heir modal driven off the estate event through feedLine (delivery-once safe, deduped per generation) + estate/vendetta feedText handlers. Verified e2e (mod-kill → modal).
### Lens G — economy balance (all founder sign-off, ground rule #1 — RECOMMENDATIONS not changes)
- HIGH: passive fronts ~$49M/day maxed stack ≫ active loops ($200-420k/day) — already flagged (AUDIT-sim #1), under-measured (sim only probes laundromat t1). REC: add business-ladder sim probe; founder decides pad/cap.
- MED: Port Deep Run (L32) strictly dominated by Open Water (L16) — $131k/day @30% caught vs $303k/day @3%. REC: raise deeprun.sell or drop patrol.
- MED: territory types — Numbers ×1.0 lazy-dominates Protection/Smuggling for a daily collector. Partly addressed (protection retune). REC: client guidance "collect actively or pick Numbers".
- LOW: STABLE_MAX 4 vs BOXING.STABLE_MAX 3 → +33% racing ceiling, same faucet. REC: align caps.
- LOW/NOTE: Street Wage in-game trivial ($2.5k/day) — significance is real-money $OMR only.
- Cosmetic: sim NOS comment contradicts its own +EV (doc fix).
### Lens H — broad correctness sweep: CLEAN (no bugs). Coverage boundary: didn't exhaustively re-trace casino blackjack/poker in-hand, pen executeBreak, world co-op internals, economy swap/stake — flagged for a future pass.

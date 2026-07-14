# OMERTÀ Security & Exploit Audit — 2026-07

An adversarial red-team pass over the whole backend (M1–M5). Four specialists swept
the economy, the social/PvP layer, the Kitchen/growth systems, and core
infrastructure/auth; every finding below was re-verified against the source before
patching. Each patched item has a regression test in `test/security.js` (or an
existing suite) that reproduces the exploit and asserts it is closed.

`npm test` runs all six suites green: smoke, economy, social, growth, hardening, security.

## Patched

| # | Severity | Area | Finding | Fix |
|---|----------|------|---------|-----|
| 1 | **CRITICAL** | auth | Server booted on a hardcoded fallback JWT secret; if `JWT_SECRET` were unset in prod, anyone could forge a token for any account. | `buildServer` refuses to boot when `NODE_ENV=production` and `JWT_SECRET` is unset. |
| 2 | **CRITICAL** | infra | Idempotency only *read* in preHandler and *wrote* in onSend, so two concurrent requests with the same key both executed — the exact double-spend the key exists to stop. | Key is now **reserved** transactionally before the handler runs (INSERT status=0); concurrent duplicate → 409, completed → replay. |
| 3 | HIGH | economy | Sub-cent bank interest was applied to `bank` but only ledgered at ≥ $0.01 — a pervasive un-ledgered mint that slowly poisons the §10.4 monitor. | Ledger the exact interest on any positive delta. |
| 4 | HIGH | social | Exchange cb/ammo escrow was double-counted: ledgered as a sink **and** counted as a live listing bucket by §10.4. Any resting listing drifted; death-with-listing drifted permanently. | cb/ammo escrow/refund/delivery are now un-ledgered internal bucket transfers; only `death:escrow` (real forfeiture) is ledgered. |
| 5 | HIGH | infra | The harder agent rate limit was selected from a client-presented token claim; an agent-flagged account kept using its pre-flag token to get human limits. | Agent status is read from `account_persistent.agent_flag` (DB), never the token. |
| 6 | HIGH | auth | No `UNIQUE(auth_provider, auth_subject)`; concurrent sign-in/upgrade created duplicate accounts for one identity. | Added the unique constraint; create/upgrade catch the conflict and adopt the winning row. |
| 7 | HIGH | auth | Invite-code consume was SELECT-then-UPDATE — a 1-use code minted unbounded accounts under a stampede. | Single atomic `UPDATE … WHERE uses_left > 0`; `rowCount` is the gate. |
| 8 | HIGH | infra | Idempotency stored/replayed 4xx and 429, permanently poisoning a key after a transient failure; different bodies replayed silently. | Only 2xx is stored; 4xx/5xx release the reservation; the key is bound to a body hash (mismatch → 422). |
| 9 | MED | growth | `missions_done` is per-character, so mission **$OMR** (minted, not fund-drawn) re-minted on every heir/season. | $OMR half pays once per **account** (`mission_omr_claimed`); cash/respect/title still re-earn per life. |
| 10 | MED | social | `joinGang` counted members then inserted without locking the gang → concurrent joiners exceed the 20-member cap. | Lock the gang row `FOR UPDATE` before counting. |
| 11 | MED | social | A bounty top-up overwrote `posted_by`, so a poster could fund a hit then reclaim it via a confederate top-up. | Every funder is recorded in `bounty_contributors`; none may collect the pot. |
| 12 | MED | economy | Swap **sell** had no minimum; a dust sale (ceil fees > gross) debited the seller's cash and burned $OMR. | Reject a sale whose net ≤ 0. |
| 13 | MED | auth | Privy JWT: `exp` optional (non-expiring tokens), no alg/iss pinning, JWKS cached forever, blind `keys[0]` fallback. | Require `exp`, pin `alg=ES256`, check `iss`, refresh JWKS on `kid` miss, drop the fallback. |
| 14 | MED | infra | Banned accounts kept a live WebSocket intel feed until token expiry. | WS connect checks `accounts.status` and closes 4003 if banned. |
| 15 | MED | growth | `linkWallet` accepted any 32–44 char string, so the `ob_wallet` reward paid for junk, and one wallet could bind many accounts. | Base58 validation + a unique index on `wallet_address`; the reward is flagged unverified pending the M6 signature/DAS check. |
| 16 | MED | infra | `maybeQualifyReferral` locked accounts before characters, unsorted — a lock-order cycle vs `withTwoCharacters` → deadlock aborting a post-commit referral. | Locks now follow the global order: characters (sorted) then accounts (sorted), with a self-referral guard. |
| 17 | LOW | social | `buyListing` could produce a negative net on a tiny lot, debiting the seller. | Clamp net ≥ 0 and cap the house take at what the buyer paid. |
| 18 | LOW | infra | `/v1/notifications` did SELECT-then-UPDATE; a notification inserted between could be marked delivered but never returned. | Single `UPDATE … RETURNING *`. |
| 19 | LOW | growth | `SOCIAL_VERIFY_MODE=trust` is an honor-system cash faucet if ever run in production. | `trust` throws under `NODE_ENV=production`. |
| 20 | LOW | data | No uniqueness on living-character names; referral codes (resolved by name) were ambiguous. | Partial unique index `WHERE alive` + a friendly pre-check at creation. |
| 21 | perf/DoS | infra | No indexes; the Streets board, gang rosters, exchange, and the nightly §10.4 sweep full-scanned. | Added indexes on the hot paths; the worker prunes stale idempotency rows daily. |

## Reviewed and found sound (no change)

- Swap **buy**, staking, melt tithe, buyback ordering, income/heat/crew/raid accrual caps, goods/asset/racket/gun qty & id validation, the fee/tax/street-tax split — no minting.
- Jump steal symmetry + dual ledger, bounty double-claim serialization, two-party lock order in `withTwoCharacters`, the death/estate (victim zeroed, killer safe, heir baseline), fire/search/bust gates, kick/promote authorization.
- SQL injection (all values parameterized), `view()` / `/v1/streets` exposure (coarse district position only, no wealth leak).

## Design calls flagged for the founder (intentionally NOT patched)

These are balance/design decisions, not defects — changing them would violate ground
rule #1 ("do not invent mechanics or improve balance — the numbers were sim-audited").
They're value-conserving (no §10.4 break) and want a design decision, not a code fix:

1. **Turf goods round-trip arbitrage.** Holding the district you stand in gives buy ×0.95 / sell ×1.05 on the same 4-hour block price — a ~6.5% risk-free per-round-trip loop after the 2% take. This is the documented "better prices both ways" turf perk (§5.4); confirm the sim-audit modeled the *loop*, not just the one-way discount. If unintended: lag the sell-price block or add a per-good buy→sell cooldown.
2. **Daily contracts.** Progress counters are keyed by *kind*, so a day that draws three same-kind jobs (e.g. crime5/crime10/crime20) earns the all-three bonus far more cheaply than "three diverse contracts" implies. Separately, the pool still contains `dice3`/`dice6` with no dice endpoint in spec §5 — those days make the all-three bonus unclaimable. Draw distinct kinds and add/remove dice.
3. **Sybil / per-IP throttle.** Guest-account creation is unthrottled when `INVITE_MODE=off`, and GETs aren't rate-limited. Proper per-IP limits depend on the proxy/deployment (real client IP); recommend adding them at the edge or once the IP source is trusted.

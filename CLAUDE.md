# CLAUDE.md — project context for Claude Code sessions

You are building the production backend for OMERTÀ, a multiplayer noir mafia RPG with Solana integration. The founder (Jorge) is non-technical: explain decisions plainly, and never assume he can debug — tests must prove things work.

## Ground rules
1. **`omerta-backend-spec.md` is the contract.** Every formula, table, and timer is specified there with production values. Do not invent mechanics or "improve" balance — the numbers were sim-audited.
2. **`src/rules.js` is generated, never edited.** Regenerate from the prototype via `tools/extract-rules.js` if v25+ ships.
3. **Server-authoritative always.** Client input is a choice, never a value. All randomness server-side and logged to `rng_audit`.
4. **Every value movement writes to `transactions`.** The §10.4 invariants are sacred: value transfers, it is never minted. Add invariant checks to tests when you add faucets/sinks.
5. **Lazy accrual, no global ticks** (§7.1). Any new time-based mechanic extends `src/accrual.js` inside the same pattern.
6. **One DB transaction per action**, row-locked via `withCharacter` (extend it for two-party actions in M3: lock both rows in a stable order to avoid deadlock).
7. Run `npm test` after every change; extend `test/smoke.js` (or add files) for every new endpoint — both success and gate-rejection paths.

## Where things stand
M1–M4 complete and tested (`npm test` runs all four journeys). M2 shipped the
economy: garage, workshop + consumables, trade goods on the deterministic price hash
(§7.11, SEED via `MARKET_SEED` env), rackets/assets with lazy income accrual, the
row-locked AMM swap, staking (real 14% APY), NFT gear mint, 12h buyback worker.

M3 shipped the social layer (`src/social.js`): gangs (found/join/leave/kick/promote,
roles are the command truth in `gang_members`), tribute + weekly family contracts
(`bumpFamilyTask` in game.js), wars (declare $10k / 30 min / lazy resolution on read,
winner takes 20% spoils + standing), turf seizure with live perks (docks/canal/brick
in crime, neon+cathedral in accrual, foundry in craft, ±5% goods prices), jumps (§7.6),
bounty escrow (never pays its poster), hit contracts (§7.7: search 3h → fire, chop = 40%
of the victim's REAL fleet), server-side death + estate (§7.9: heir row, prestige,
account survives, street dies — all one transaction), busting (§7.8), the escrowed
Exchange (deferred from M2; product rejected), notifications table + websocket gateway
(`/v1/ws`, channels me/streets/gang via the in-process `bus` in game.js), armory, and
the buyback's 50% family split by standing. `withTwoCharacters` locks both character
rows then both account rows, each in sorted-id order — keep that global lock order
(characters → accounts → gangs → singletons) for anything new.

M4 shipped the Kitchen + growth. `src/kitchen.js`: makings (rank-gated, drifting
prices), the lab ladder (top tiers burn $OMR), cook → collect (one batch, crates
1/20 units, prod = demo×12, fire vs weighted-avg quality), deal (demand × quality ×
event × trade-rank bonus, heat, nerve 1/10, trade_rep on gross), crew hire, laylow,
clean papers. Crew sales + Bureau raids run inside §7.1 accrual (crew sells cheapest
lines at 80% of base×quality offline; raids roll 1−(1−p)^minutes past heat 60).
`src/growth.js`: paths ($10k first / 25 $OMR switch), the Daily Score (8h), missions
(pay once; $OMR rewards are an enumerated legal faucet; titles), daily contracts
(3 drawn by `(day+2i) mod pool`, all-three bonus pays 0.5 $OMR from the fund),
First Week with server-side checks (`src/verify.js` — SOCIAL_VERIFY_MODE off|trust|live,
production must run `live`), wallet link. Referrals (§7.13) qualify post-commit in
their own sorted-lock transaction (all four gates, once ever, milestones, gang
`recruit` progress, agent_flag excluded, same-IP flagged). Telemetry (§12) via
`track()`. Mod tools (§10.3) behind the `MOD_KEY` header: ban (blocks at auth),
mod-kill (estate without a killer), confiscate (→ buyback pool), audit view.

Discrepancies raised (prototype wins per ground rule #1): asset sell-back is **80%**
not spec's 70% (`economy.js:sellAsset`); gang joining is **immediate** (no apply/accept
queue — v24 `joinGang`); war duration **30 min** pending the §9 design call; the daily
pool draws **dice** contracts but there is no dice endpoint in spec §5 (undrawable-day
gap — needs a design call). Test-only env knobs `SEARCH_MS`/`SHOOT_CD_MS` shrink the
§9 hit timers — never set them in production.

M5 shipped alpha hardening. `src/invariants.js` is the §10.4 job: seven checks
(character cash, gang treasuries, bounty escrow, $OMR, cars, cb, ammo — each bucket
reconciled against a per-currency reason vocabulary; an unknown reason is itself an
alert) with telemetry + optional `INVARIANT_WEBHOOK_URL` alerting; the worker runs it
nightly and `GET /v1/mod/invariants` on demand. Every faucet/sink now has a row —
M5 closed the gaps (bank interest, bounty escrow split, death-cleared bounties,
forfeited exchange escrow, gang dissolution). `src/ratelimit.js`: §10.2 token buckets
(human 1/s burst 5, agent 1/3s hard, swaps 6/min; in-memory, Redis via `REDIS_URL`),
enabled in production or `RATE_LIMIT=on`; rates are read per-call, not at import.
Idempotency-Key is honored on all mutating player routes (stored responses replay
with `x-idempotent-replay`). `src/auth.js`: X sign-in (bearer → /2/users/me), Privy
(ES256 JWT vs app JWKS, needs `PRIVY_APP_ID`), guest→provider upgrade preserving the
account row, agent keys (`POST /v1/auth/agent-key` — permanent agent_flag + throttled
token), and the `INVITE_MODE=on` closed-alpha gate (codes minted via
`POST /v1/mod/invites`). Season rollover (§8) is `runSeasonRollover` in the worker:
level→prestige (floor(lvl/2)), respect reset, batched, telemetered. `tools/backup.sh`
is the nightly pg_dump. The hardening test's invariant scenario earns every dollar
through ledgered faucets — never SQL-seed cash/cb/ammo/$OMR in it.

A full red-team audit (`AUDIT.md`) hardened M1–M5: two §10.4 leaks closed (sub-cent
bank interest now ledgered; exchange cb/ammo escrow is an un-ledgered internal bucket
transfer, only `death:escrow` forfeiture is ledgered), concurrency-safe idempotency
(reserve-before-execute, 2xx-only, body-bound), DB-driven agent throttle, atomic
invite consume, `UNIQUE(auth_provider,auth_subject)`, mission $OMR once-per-account
(`mission_omr_claimed`), bounty `bounty_contributors` (no funder can collect), gang
row-lock on join, swap-sell/buyListing net-≤0 guards, referral lock order fixed,
banned-WS close, Privy JWT hardening, base58 wallet + uniqueness, living-name
uniqueness, and hot-path indexes. `test/security.js` has a regression per finding.
Three items left as design calls (turf goods arbitrage, daily same-kind draw + dice
contracts, per-IP throttle) — flagged in AUDIT.md, not patched per ground rule #1.

**M6 moved from Solana to Robinhood Chain (Arbitrum Orbit L2, EVM)** — see
`omerta-chain-migration-evm.md`. The spec §11 intent is unchanged (off-chain stays
authoritative; the chain settles withdrawals + ownership proofs; nothing mints), but
the mechanism is now EVM: EIP-712 signed vouchers (not Ed25519), ERC-1155 gear (not
Bubblegum cNFTs), ERC-20 OMR, an EVM DEX buyback (not Jupiter), and `balanceOf`/SIWE
holdings checks (not DAS).

M6-A (on-chain) is delivered in `omerta-contracts/` — a Foundry/Solidity suite:
`OMR` (inert fixed-supply ERC-20 + Permit), `VoucherClaim` (the only bridge —
EIP-712, replay-proof via nonce, deadline-bound, daily-capped, pausable,
tranche-funded), `GearVault` (ERC-1155, mint gated to VoucherClaim), `OMRStaking`
(pre-funded pool, 50% APY ceiling, principal always withdrawable). 15 Foundry tests
incl. fuzz. Its own `CLAUDE.md`/`README.md` govern that subtree (`forge test` must
pass; nothing mints; no owner mint paths; no hardcoded chainIds).

M6-B (backend chain service) is **built** in `src/chain.js` — the isolated service
whose only DB writes are `vouchers`, `chain_reserve`, `wallet_challenges`, and the
one `withdraw:omr` ledger row. It signs EIP-712 `Voucher`s on **viem** in exact
parity with `VOUCHER_TYPEHASH` (fields `to,amount,kind,gearId,nonce,deadline`;
domain `OmertaVoucherClaim`/`1`, chainId from `CHAIN_ID`, `verifyingContract` =
`VOUCHER_CLAIM_ADDRESS`). `POST /v1/withdraw` debits $OMR through the ledger
(`withdraw:omr` is a §10.4-legal burn, added to `invariants.js`), allocates a nonce
from `chain_reserve`, and — per the **full-reserve queue** (D1) — signs only if
`signedOutstanding + amt ≤ funded_omr`, else marks the voucher `queued` (debited but
unsigned, no double-spend); `POST /v1/mod/reserve/fund` tops up the tranche and
`drainQueue` signs queued vouchers FIFO. Deadlines are `now + 24h` (< contract
`MAX_VOUCHER_TTL`). Gear withdrawal (`POST /v1/gear/:id/withdraw`) signs immediately
(kind 1 — the contract's per-`gearId` cap bounds supply, not the reserve) and flips
`account_gear.minted_onchain`. Wallet linking is **SIWE**: `POST /v1/wallet/challenge`
→ sign → `POST /v1/wallet/verify` (viem `verifyMessage`, malformed sig → clean 400,
base58→0x wallet uniqueness enforced). The worker runs a `Claimed(nonce,…)` watcher
(viem `watchEvent`, dormant unless `CHAIN_RPC_URL` + `VOUCHER_CLAIM_ADDRESS` set) that
calls `markClaimed` to free reserve. `test/chain.js` proves signing parity
(`recoverTypedDataAddress` == the server signer), the debit→queue→fund→drain→sign
cycle, $OMR ledger conservation, gear vouchers, and reserve release. Still pending:
devnet deploy + wiring, the buyback bot, and third-party audit of contracts **and**
signer before mainnet.

M6-C added **inbound real-ETH fees** (§11) — the first value that flows *into* the
chain boundary, not out. `omerta-contracts/src/OmertaFees.sol` is a metered tollbooth
(Safe-owned, ReentrancyGuard): `payMintFee()` / `payRespawnFee()` enforce the exact fee,
forward the ETH **straight to the dev wallet** in the same tx (the contract custodies
nothing, mints nothing), and emit `MintFeePaid`/`RespawnFeePaid` with a monotonic nonce.
`src/fees.js` is the backend half — the worker's fee sync (dormant unless
`CHAIN_RPC_URL` + `OMERTA_FEES_ADDRESS`) calls `recordFeePayment`, which idempotently
(nonce PK) credits the paying account an in-game entitlement. Two mechanics: **(1) the
two-tier mint** — a **0.01 ETH** fee grants a mint credit; `POST /v1/character/mint`
spends it to set `account_persistent.minted` (mirrored onto the living character + carried
to heirs in `runEstate`); **only a minted account can withdraw $OMR or take gear on-chain**
(`chain.js` gate — free trial characters play fully, just can't extract). **(2) pre-paid
revive insurance** — a **0.10 ETH** fee grants a `respawn_token`; the hit kill-branch in
`social.js` consumes one to absorb a killing blow (full heal, keeps everything, no rep/
chop/bounty/estate for the shooter) *before* the estate runs — mod-kills call `runEstate`
directly and bypass it. Fees agents too (they pay from a funded wallet like anyone). Real
ETH is **out-of-band value** — `fees.js` writes zero `transactions` rows and adds nothing
to the §10.4 set; a revive simply skips the estate (no value moves). Pay-before-link is
reconciled: `walletVerify` sweeps parked payments for the freshly-linked address.
`test/chain.js` proves the mint gate + idempotent credit + reconcile; `test/social.js`
proves a respawn token turns a lethal hit into a survival with no heir. `OmertaFees` has
Foundry tests (exact-fee, forward-to-dev, monotonic nonce, owner-only admin) but — like
the rest of the suite — **`forge test` was not run this session** (no toolchain/egress);
run it before audit. Product note: "free trial" is enforced only as the extract-gate today
(no character expiry yet); the fee amounts live at deploy time (`MINT_FEE_WEI` /
`RESPAWN_FEE_WEI`), owner-settable on-chain.

A full five-lens audit (`AUDIT-gameplay-chain.md`: economy, social/PvP, UX, chain,
contracts) confirmed the system sound (no §10.4 leak, D2b correct, revive concurrency-
safe, contracts mint nothing) and fixed the confirmed bugs: a HIGH concurrent fee
double-credit (`reconcileFees` is now atomic claim-then-credit), the retired Solana
`POST /v1/wallet` free-reward path (linking is SIWE-only; `ob_wallet` needs the proven 0x),
a revive that wiped all hunters' searches (now only the shooter's), silent fee credits
(now `notify('fee_credited')`/`'made'`), `OmertaFees` zero-fee floor + `sweep`→owner, the
weekly-family $OMR ledger row (`family:weekly`), and a `GET /v1/session` probe. Balance
items left for founder sign-off: bank interest ~4%/day online asymmetry, trade-goods
arbitrage. `src/watcher.js` then replaced the reorg-fragile `watchEvent` with a polled
`getLogs` sync over a persisted `chain_cursor`, `CHAIN_CONFIRMATIONS` behind head
(downtime backfill + reorg safety; `test/watcher.js`).

M7 (Contracts & Hitmen) is underway on the `social.js` PvP layer (design in
`omerta-hitman-contracts-design.md`, grounded by `AUDIT-core-loop.md`). **Phase 1 — the
Contract Board**: bounties became browsable, lifecycle-managed contracts — one escrow pot per
`(target, kind)` where `hospitalize` pays on a jump or kill and `kill` pays only on a completed
hit, each with a reason/expiry/anon poster; a funder cancels their own tracked share (2% take
kept) and expired pots refund every funder via the worker sweep (dead funders' stakes burn as
`death:bounty`, not to their corpse); `GET /v1/contracts` is the board; the mark is notified.
Escrow reconciles `posted − claimed − refunded − death` (`bounty:refund` under the `bounty:`
vocabulary). A red-team fixed a `cancelBounty` lock-order inversion (deadlock vs kills), a
500-on-repost of an expired pot, and the dead-funder corpse-refund. **Phase 2 — Player-hitmen +
the assassin's reputation**: directed contracts (`postBounty` `hitman`+`exclusiveHours` → a named
hitman's exclusive window on the `(target,kind)` pot, auto-opening at `opens_at`; +1.5× rep on
fulfilment); a hybrid legend — account-level lifetime `hitman_rep` + `kills` (survive death like
prestige) plus this street's per-season `season_kills` (resets on rollover, dies with the man);
the Associate→Button Man→Mechanic→Ghost→The Undertaker ladder (`HITMAN_RANKS`/`hitmanRankOf`,
rules.js tail); `GET /v1/leaderboard/hitmen` (legend + season). Rep is a **status axis with no
gameplay power**, so it's outside §10.4 and the sim-audited balance. Anti-abuse: rep only from
targets ≥ `HITMAN_MIN_TARGET_LVL`, diminished `1/(prior bloodline kills+1)` (via `kill_log` keyed
on killer×victim account), and agents earn `kills` but not leaderboard `hitman_rep` (excluded like
referral payouts). `test/social.js` covers the split, board, cancel/refund, expired-repost,
dead-funder burn, directed bonus, level floor, bloodline diminishing, and the leaderboard. A
red-team pass on Phases 1+2 (`AUDIT-contracts.md` covers the contracts; the hitman findings are
in-commit) fixed a `cancelBounty` deadlock, an expired-repost 500, a dead-funder corpse-refund
(Phase 1) and, for Phase 2, a farmable kills/season board (kills now share the rep level-floor),
a silently-dropped directed top-up (now a clean `directed_exists` error), and a directed-window
outsider-kill that burned the poster's escrow — `runEstate` now refunds still-exclusive pots
(threading the killer so a killer-funder's refund can't drift §10.4). **Phase 3 — NPC-hitmen**
(`social.js:npcHit`, `NPC_HITMEN` tiers in the rules.js tail): pay a fixed fee for a server-rolled
hit — success `tier.base − targetLvl×NPC_DEF_PER_LVL` clamped `[MIN,MAX]` (the weak buy a *chance*
at the strong, never a certainty). The fee **burns win or lose** (`npchit:hire`, a §10.4 cash sink
in `invariants.js`), draws law heat + a 6h cooldown, pays **zero rep** (no player killer), and on a
landed hit runs the estate (no chop/bounty) unless pre-paid revive insurance absorbs it like a
player hit. `POST /v1/streets/:id/npchit`; blocks family/self/jailed/rookie(<lvl 5)/hospitalized.
NPC-hit numbers are new/tunable — sim + founder sign-off before production. `test/social.js` covers
the fee-burn, heat, cooldown, level floor, a looped roll to a kill (estate, zero rep), and revive
absorption. A red-team fixed one HIGH: `npcHit` called `runEstate` without `killerCh`, so a payer
who'd funded a still-exclusive directed pot on the victim had their refund SQL-credited then
clobbered by `persistCharacter` (§10.4 drift + stolen escrow) — now threads `{ killerCh: ch }` like
`fire`; regression added. Flagged for founder sign-off (not silently retuned per ground rule #1):
NPC-hit heat is a weak deterrent for non-kitchen whales, so repeat-resetting one rival wants a
per-target cooldown or post-death grace. **Phase 4 — earnable defense + interlocks** (`social.js`):
the **safehouse** (`enterSafehouse`, `POST /v1/safehouse`) is the in-game survival shield — pay
`SAFEHOUSE_COST` ($25k, a §10.4 `safehouse` cash sink) to go to ground for `SAFEHOUSE_MS` (4h),
untargetable by `fire` AND `npcHit` (both throw `safe`) but still jumpable (non-lethal), so real-ETH
revive insurance isn't the only way to weather a contract on your head; blocks in lockup / while
already safe. Two interlocks close the loops: **fire-heat** — every `fire` now adds `FIRE_HEAT` (20)
to the shooter's law heat (wet work is no longer heat-free vs the Kitchen's deals), and **war-kill
scoring** — a `fire` kill on a family you're actively at war with scores `WAR_KILL_POINTS` (3) to
your war chest (vs a jump's 1), so the lethal layer finally decides wars, not just jump-spam; scored
before the estate vacates the seat, returned as `warKill`. `test/social.js` covers the fee-burn,
fire+npc block, lapse (fair game again), fire-heat, and war-kill scoring. Safehouse/fire-heat/war-kill
numbers are new/tunable — sim + founder sign-off before production. Phase 4 remainder left design-only:
treasury-funded family contracts and two-party bodyguard protection.

Content: the car catalog was expanded 40→60 via the prototype + re-extract (ground rule #2 —
`reference-prototype-v24.jsx` edited, `tools/extract-rules.js` regenerates `rules.js`). New
cars are on-curve with modest drop weights: the GTA-boost faucet moved only −1.5% E[val] /
+1.1% E[melt] — content, not a rebalance. `test/economy.js` guards catalog integrity.

An internal red-team pass on the contracts (`AUDIT-contracts.md`) closed the one hole
that broke the suite's own thesis — **uncapped gear minting** (gear is now fail-closed
behind a per-`gearId` supply cap the Safe sets) — removed the **hot-deployer
mint-authority window** (GearVault is Safe-owned from deploy), added a
`MAX_VOUCHER_TTL` deadline backstop, and fixed the README signer snippet's hardcoded
chainId. The OMR rail, EIP-712/replay, reentrancy, and staking pool-separation were
verified sound. `forge` was egress-blocked in that session; the suite was compiled clean
(solc 0.8.26 + OZ 5.6.1 + forge-std, 0 warnings) but the Foundry VM was **not run**, so
`forge test` must pass locally before the third-party audit. Accepted-as-designed
(Safe = root of trust): sweep/pause, global daily-cap contention, APY-change retroactivity.

## Sensitive design notes
- $OMR framing is utility-only; never add mechanics implying price appreciation.
- Social/onboarding rewards pay in-game cash only, never $OMR (v24 rule).
- Agent-flagged accounts: excluded from referral payouts, harder rate limits, public badge.

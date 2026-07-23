# CLAUDE.md — project context for Claude Code sessions

You are building the production backend for OMERTÀ, a multiplayer noir mafia RPG with Solana integration. The founder (Jorge) is non-technical: explain decisions plainly, and never assume he can debug — tests must prove things work.

## Ground rules
1. **`omerta-backend-spec.md` is the contract.** Every formula, table, and timer is specified there with production values. Do not invent mechanics or "improve" balance — the numbers were sim-audited.
2. **`src/rules.js` is generated, never edited.** Regenerate from the prototype via `tools/extract-rules.js` if v25+ ships.
3. **Server-authoritative always.** Client input is a choice, never a value. All randomness server-side and logged to `rng_audit`.
4. **Every value movement writes to `transactions`.** The §10.4 invariants are sacred. AMENDED by the
   founder-directed VALUE-CREATION pivot (2026-07-23, `omerta-value-creation-design.md`): value transfers,
   OR is minted through ENUMERATED, SCHEDULED emission faucets only (today: `emission:wage`, bounded per-epoch
   by `epochBudget` and lifetime by the `emission within endowment` check). Discretionary/unbudgeted minting
   remains forbidden and is the loudest alarm. Add invariant checks to tests when you add faucets/sinks.
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
numbers are new/tunable — sim + founder sign-off before production. **Phase 4 remainder — family
contracts + bodyguards** (`social.js`): a boss/underboss posts a contract funded from the **gang
treasury** (`postFamilyContract`, `POST /v1/gangs/contract/:targetId`) — it rides the same
`(target,kind)` pot; the family's share is a `bounty_contributors` row with contributor = the GANG id
+ `funder_gang`, so no member of the funding family collects (the boss can't pay himself), and
cancel/expiry refunds the **treasury** (a dissolved family's stake burns like a dead funder's).
§10.4: escrow transfer ledgered `gang:contract` with NO character_id + `gang:contract:take` (2%);
`invariants.js` treasury check subtracts `gang:contract%` and adds character_id-NULL `bounty:refund`
rows; the escrow check adds `gang:contract` to posted. The board shows the FAMILY as poster
(`posted_by_gang`). **Bodyguards** are the two-party defense market: a guard lists a price
(`POST /v1/bodyguard/offer`, consent-by-listing), a principal hires via `withTwoCharacters`
(`POST /v1/bodyguard/hire/:guardId` — a pure ledgered transfer `bodyguard:hire`, paid up front, no
escrow). While guarded, ONE lethal `fire`/`npcHit` is absorbed (`bodyguardAbsorbs`): the guard is
hospitalized in the principal's place (a third-character relative UPDATE — the refundPot discipline,
no clobber) and the contract is consumed. Checked BEFORE the real-ETH respawn token (earnable shield
burns first); the guard's own shot (or NPC hire) is never absorbed — betrayal beats protection; a
jailed/hospitalized/dead guard can't step in. `test/social.js` covers rank gate, treasury debit+take,
board attribution, member lockout (boss collects $0), cancel/expiry→treasury refunds, outsider
collect via jump, offer/hire transfer, absorb+consume, token ordering, betrayal, NPC absorb, and the
escrow reconciliation with family money in the mix. Bodyguard/family-contract numbers
(BODYGUARD_MIN_PRICE/MS/HOSP_MS) are new/tunable — sim + founder sign-off before production.

M8 (token sinks) opened with the **Tailor & Engraver** (`src/vanity.js`) — the recurring,
utility-only $OMR sinks the late game lacked (every prior burn was one-time; a kitted veteran
had nothing left to spend on, so supply pooled into staking). Five items, all pure STATUS
(display-only, zero gameplay power → outside the sim-audited balance, same argument as hitman
rep): street name change (5 $OMR — creation rules + living-name uniqueness; renames dodge
nothing since bounties/searches/kill_log key on ids, but the referral code rotates since codes
resolve by living name), custom title (10, writes the same `characters.title` slot mission
titles use; clearing is free), car vanity plate (2, `cars.plate`, owner-checked via
`h.owned.cars`), family crest color (10, `gangs.color`, boss-only, `#rrggbb`), family
rename/retag (25, boss-only, founding validation + uniqueness excluding self). Every burn is
an account-bucket debit ledgered `vanity:*` (cleanpapers/path pattern) — vocabulary + omrBurns
in `invariants.js` extended. Routes: `POST /v1/vanity/name|title`, `/v1/vanity/plate/:carId`,
`/v1/gangs/vanity/color|name`. `test/social.js` covers prices, uniqueness rejections, rank
gates, uppercase plates, view/board surfacing, free title-clear, and spends==ledgered-burns.
Prices are new/tunable — founder sign-off before production.

M8's second drop tied sinks into the game's loops (constants in the `M8` rules.js tail block,
all through vanity.js's exported `spendOmr` till): **board anonymity** — `anon` on a FRESH
contract pot (player `postBounty` or family `postFamilyContract` — the boss pays personally;
the treasury holds cash, not $OMR) burns 3 $OMR as `intel:anon`; top-ups inherit the pot's
flag and are never charged; an insufficient balance rolls the whole post back. **Counter-intel
peek** (`POST /v1/contracts/peek`, `social.js:peekContracts`) — the mark burns 5 $OMR
(`intel:peek`) to read every funder (names + shares, families as "X (family)", the named
hitman) on every open pot on their own head — it PIERCES anonymity, so the two sinks feed
each other; free (`no_contracts`, checked before charging) when nothing's posted. **Stat
respec** (`POST /v1/respec`, `growth.js:respec`) — 15 $OMR (`respec`) redistributes
muscle/cunning/speed with the total conserved exactly, each ≥ RESPEC_STAT_MIN (5, the creation
base), no-ops refused unpaid — convenience-not-power, the path-switch precedent. Vocabulary +
omrBurns extended (`intel:`, `respec`). Tests: social (anon fee/rollback/top-up-free,
peek pierce + family attribution + free-silence), growth (sum/floor/same gates, ledgered burn).
Prices new/tunable — founder sign-off.

M8's third drop is **family seals** — the gang-level $OMR sink (rules.js tail: `GANG_SEALS`
ladder Wax 25 → Brass 75 → Silver 200 → Gold 500 → Obsidian 1500, `sealOf`). Pure STATUS
(`gangs.seal`, a badge on the family everywhere it's shown: me.gang, `GET /v1/gangs`,
`GET /v1/gangs/:id` incl. `nextSeal`). Bought SEQUENTIALLY by the boss
(`vanity.js:buySeal`, `POST /v1/gangs/vanity/seal`, gang row locked) from the family's
**$OMR reserve** — the bucket buyback splits + weekly bonuses feed, which finally has a spend
path. New with it: **$OMR tribute** (`social.js:tributeOmr`, `POST /v1/gangs/tribute/omr`) —
any member pools tokens into the reserve (a §10.4 bucket TRANSFER, account → reserve, ledgered
`gang:tribute` currency-omr, in the vocabulary but in neither the mint nor burn term; it does
NOT bump the weekly tribute task, which counts dollars). The seal burn is ledgered
`vanity:gang:seal` against the reserve bucket (no account id) and rides the existing `vanity:%`
burn term — check (d) stays exact with zero formula changes. So a seal is a cooperative family
purchase: pool → commission → badge. `GET /v1/gangs` was also rewritten from a correlated
subquery (which pg-mem can't parse — the route had been untestable) to two flat queries, same
response. Tests: boss-only gate, empty-reserve rejection, tribute min + transfer, sequential
Wax→Brass with exact reserve deltas, seal on all three views, spends==ledgered burns. Prices
new/tunable — founder sign-off. The M8 sink list is now fully built; the 14% staking APY
remains the deepest lever (standing sign-off item).

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

A full five-lens audit (`AUDIT-full-game.md`: code red-team, economy, loops, new-player) then
ran over everything. Fixed in-commit (code correctness, behavior-preserving): three real-Postgres
deadlock cycles (a `postFamilyContract` gang-before-pot lock inversion; unsorted two-gang war-kill
score updates in `fire`+`jump`, now one `WHERE id IN` CASE statement; the buyback worker locking
`street_tax` before gangs, now gangs-first with an unlocked due-check), an `offerBodyguard` Infinity
guard, and the undiscoverable bodyguard market (`guardPrice` now on `GET /v1/streets`). §10.4 came
back clean across every M8 path. The rest (staking APY, bank interest, cheap defenses, kill-economy
on-ramp, family-contract laundering, etc.) were flagged as founder balance/design calls, NOT patched.

**RISK-TO-EARN PIVOT (founder-directed — overrides the utility-only note below).** The founder
chose to move $OMR from utility-only toward a genuine EVE/Axie/DFK-style Risk-to-Earn economy
where a skilled, risk-taking player can theoretically earn a small living. Design docs:
`omerta-risk-to-earn-design.md` (parent — four pillars, the "spenders fund earners" sustainability
model, the honest legal/financial flags), `omerta-phase2-vig-design.md` (the Vig — real-revenue
redistribution + PLEX bridge + the "extraction ≤ inflow" invariant enforced by the existing
full-reserve queue), `omerta-phase1-riskpay-design.md` (the off-chain first step).

**Phase 1 (Make Risk Pay) is BUILT** — a pure off-chain rebalance, no chain work, no new extraction,
so zero new regulatory surface. Numbers are proposed defaults (founder sim + sign-off, ground rule #1):
**P1.1 Loot the living** (`social.js` `fire` kill branch) — a PLAYER fire-kill loots
`CASH_LOOT_RATE` (0.25) of the victim's POCKET cash (bank untouched) + `OMR_LOOT_RATE` (0.20) of
their LIQUID unstaked $OMR (staked untouched), both ledgered `whack:loot` TRANSFERS (cash carved
out of what `runEstate` would burn — reduce `victim.cash` first; $OMR account→account, heir keeps the
rest). Only `fire` loots — NPC/mod kills don't — so skill+risk earns. `OMR_LOOT_RATE` is the dial
(0 ships cash-only). Makes killing +EV, the rich into targets, staking a real safe harbour.
**P1.2 Laundering** (`economy.js` `swap` buy) — cash→$OMR is now located (a wash-house district in
`LAUNDER_DISTRICTS` docks/canal, or your family's turf) + draws `LAUNDER_HEAT` (15) + blocked from a
safehouse; the sell direction stays ungated. Extraction prep is a deliberate, exposed act.
**P1.3 Shield, not bunker** — a safe-housed player can no longer `fire`/`jump`/`deal`/launder (added
`safeHoused(ch)` actor-guards); bodyguard repriced toward safehouse parity (`BODYGUARD_MIN_PRICE`
1000→10000, `BODYGUARD_HOSP_MS` 2h→4h). **B2 Bank daily cap** (`accrual.js`) — bank interest metered
by a `bank_credit_ms` token bucket (`BANK_DAILY_CAP_MS` 12h/day) exactly like racket income, so
continuous online play can't compound ~4%/day risk-free. `whack:loot` added to the cash + $OMR
`invariants.js` vocabularies (the $OMR one a transfer, in neither mint nor burn term — §10.4 exact).
Tests: social (loot amounts to killer, heir keeps the rest, safehouse blocks offense/extraction,
bodyguard reprice), economy (launder gate/heat + ungated sell + the bank daily cap). Full suite 8/8.
**Phase 2 (the Vig) — off-chain CORE is BUILT** (`src/vig.js`, `test/vig.js`), chain dormant (M6
pattern), no mainnet extraction, so still no new regulatory surface until wired. It re-sources the
existing full-reserve withdrawal queue from real spender revenue instead of team charity, so
"extraction ≤ inflow" holds BY CONSTRUCTION (the reserve is fed only by Vig buybacks; the queue
can't sign beyond it). Flow: `recordFeePayment` routes each fee's Vig share (`VIG_BPS` 60%) into
`vig_revenue`; `runVigBuyback` spends the UNSPENT Vig revenue on hard $OMR at a price (mainnet: the
DEX bot's TWAP; here a param) — `ethToSpend ≤ revenue−alreadySpent` is the root cap — and splits it
`RESERVE_BPS` (50%) to `fundReserve` (backs withdrawals) + the rest to `vig_prize_pool`. `payPrizes`
credits a winner in-game $OMR (`prize:omr`, a §10.4 mint BACKED by hard $OMR moved to the reserve).
The **PLEX bridge** (`payPlex`, `POST /v1/plex/mint|respawn`) lets a player pay a real-money fee from
EARNED $OMR — burns it (`plex:*`, a §10.4 sink) for the same entitlement an ETH payer gets (the EVE
"pay your rent in ISK" path; ETH payers fund the pool, $OMR payers shrink supply). `runVigInvariants`
(`GET /v1/mod/vig`) is the second §10.4, on the real-value side: spend≤revenue, buyback-split-exact,
reserve-fully-backed (`funded ≤ toReserve+prizePaid`), extraction≤reserve, prizes≤bought. `invariants.js`
gained `prize:omr` (mint) + `plex:%` (burn) so in-game §10.4 stays exact. Config is env (`VIG_BPS`,
`VIG_RESERVE_BPS`, `PLEX_MINT_OMR` 5, `PLEX_RESPAWN_OMR` 50 — sign-off levers). Retired nothing: the
legacy `POST /v1/mod/reserve/fund` still exists but the Vig invariant flags any reserve it can't
back. Still design-only in Phase 2: the on-chain `OmertaFees` fee-split, the real DEX buyback bot,
new ETH revenue sources (cosmetics/rent/pass), and wiring prize distribution into season rollover —
all **gated on legal counsel + a third-party audit** before mainnet.

**Phase 3 (Productive assets) — the seizable-capital CORE is BUILT** (`src/territory.js`,
`test/social.js`). Founder directed "assume legal counsel approved all architecture going forward,"
so the pivot proceeds; numbers are proposed defaults (sim + sign-off, ground rule #1). **Territory
rackets** are productive, SEIZABLE capital: ONE per district (`territory_rackets`, district_id PK),
owned by whoever holds the turf. A boss/underboss `establishRacket` on a district the family holds
(cost from the treasury, `TERRITORY_RACKETS` ladder Numbers $50k → Protection $200k → Smuggling
$750k), income accrues lazily (`incomePerHr`, capped at `TERRITORY_CAP_MS` 24h) and `collectTerritory`
banks it to the treasury; `upgradeRacket` climbs tiers (collecting pending at the old rate first).
The point: on a district `seizeDistrict`, `seizeTerritoryRackets` **transfers the operation to the
victor** (uncollected income forfeits, clock resets) — so wars finally fight over income streams, not
just a one-time treasury cut (closes the audit's B4/B7). A dissolved family's operations die with it
(`releaseTerritoryRackets`). §10.4: `territory:establish` is a treasury cash SINK, `territory:income`
a treasury cash FAUCET (both character_id NULL like gang:war; the treasury check adds income and
subtracts establish; vocabulary extended). Routes `POST /v1/territory/:id/establish|upgrade`,
`/v1/territory/collect`, `GET /v1/territory`; surfaced on `GET /v1/gangs/:id` (`territory`).
`test/social.js` covers the rank/turf gates, one-per-district, income + the 24h cap, upgrade, the
SEIZURE transfer to the victor, and a treasury §10.4 reconcile. **Gear-looting (Phase 3 remainder)
is BUILT**: a player `fire`-kill has a `GEAR_LOOT_CHANCE` (0.15, env-overridable for tests) to strip
ONE piece of the victim's IN-GAME gear to the killer — but **on-chain-minted gear (`minted_onchain`)
is SAFE** (it's been extracted to the player's own ERC-1155, out of the game's reach). So gear is a
real risk tradeoff: keep it in-game to use it (losable) or extract it on-chain (safe + tradeable via
the existing GearVault/M6 rail, but it leaves play). Gear isn't a §10.4 currency, so the loot is a
pure ownership move (DELETE+INSERT, count conserved); the in-memory `h.victimOwned.gear`/`h.owned.gear`
are kept honest so the estate report + killer effStat stay right; test forces the roll via env.
**Design note:** gear IS the tradeable on-chain NFT (GearVault, already delivered in M6); territory
rackets are intentionally NOT independently tradeable NFTs — that would conflict with in-game seizure,
so they stay seizable in-game capital (the two asset types serve different Risk-to-Earn roles).
**Territory step two — the ladder + THE EMPIRE — BUILT** (`src/territory.js`, `src/rules.js`,
`test/social.js`; a content expansion for the thinnest income catalog). **(1) Ladder 3→5** — two on-curve
operations (`Vice Empire` t4 $4M/200k/hr, `The Syndicate` t5 $15M/600k/hr) on the continuing ROI taper (the
car-catalog precedent — `upgradeRacket`/`territoryTierOf` already handle any tier, so the extension is
**zero-code**: content, not a rebalance). **(2) THE EMPIRE** — `gangs.territory_earned` (lifetime
territory-racket income, bumped alongside the treasury on every `territory:income` collect + the
upgrade-pending, NUMERIC = arith-safe) + `TERRITORY_RANKS` (Corner Crew → The Cosa Nostra, `territoryRankOf`)
+ `GET /v1/leaderboard/territory` (`territoryLeaderboard` — the biggest territorial families; the
world/wire status-board twin). PURE STATUS — **zero §10.4 surface** (`territory_earned` isn't a currency;
the income still rides `territory:income`, so the sim's `gang treasuries` check stays drift-0; the test
asserts `empire.earned == the family's lifetime collect`). Gang-level → dies with the family. Surfaced on
`GET /v1/gangs/:id` (`empire {earned, rank}`) + the console Family tab (an Empire banner + leaderboard).
`test/social.js` proves the 5-tier ladder + the two new operations, the empire earned/rank, and the
leaderboard (both territorial families, §10.4-clean). Suite 30/30 + sim drift-0. All numbers are founder
sign-off levers.
**Step three — per-district racket TYPE + the BUREAU CRACKDOWN — BUILT** (`src/territory.js`, `src/rules.js`,
`test/social.js`; the two deferred items). The tier ladder is now the operation's SCALE (renamed Corner →
Neighborhood → District → Citywide → The Syndicate; incomes UNCHANGED — the sim-signed curve), and a new
orthogonal **TYPE** axis is the BUSINESS, chosen at establish (`TERRITORY_TYPES`, `establishRacket(kind)`,
`POST /v1/territory/:id/establish {kind}`): **numbers** (Numbers Game — ×1.0 income, `scrutinyPerHr` 0, never
raided — the safe baseline that keeps parity with the signed curve), **protection** (Protection Racket —
×1.15, medium heat), **smuggling** (Smuggling Ring — ×1.35, hot). Income = `tier.incomePerHr × type.incomeMult`
(via `ratePerHr`; upkeep scales with it too). **The Bureau crackdown** is the business-scrutiny pattern at the
GANG level: scrutiny GROWS from operating a hot type (net of `TERRITORY_SCRUTINY_DECAY_HR`, so numbers never
heats up), resolved LAZILY at the collect touch (`resolveTerritoryRaid` in `collectTerritory` — the §7.1
kitchen/business precedent); above `TERRITORY_RAID_THRESHOLD` it rolls `1−(1−p)^(minutes-above)` and a raid
SEIZES the pending income (never banked, never ledgered — the seize precedent) + FINES the treasury
`TERRITORY_RAID_FINE_RATE` (10%) of the operation's build cost (a §10.4 treasury cash sink `territory:raid`,
character_id NULL, counterparty=gang — added to the treasury check's `territoryOut`), then scrutiny→0.
`TERRITORY_RAID_P` is a TEST-ONLY roll knob (the BUSINESS_RAID_P precedent). The type CARRIES on seizure
(the victor inherits the smuggling ring) but scrutiny resets (a seized op isn't born hot). New columns
`territory_rackets.kind/scrutiny/scrutiny_at`; `territoryOf` surfaces `kind`/`typeName`/`scrutiny`/`raidRisk`;
console Family tab gained a type picker on establish + a FEDS-WATCHING chip + Bureau-heat line. `test/social.js`
proves the bad-kind gate, smuggling's ×1.35 income, a forced crackdown (seize + ledgered treasury fine +
§10.4 treasury reconcile), and a numbers op never drawing the Bureau. Suite 30/30 + sim drift-0. **Founder
sign-off flag (BALANCE.md):** the income mults (protection ×1.15 / smuggling ×1.35) INCREASE the
`territory:income` faucet for the hot types — §10.4-safe (still a ledgered faucet) but a balance change,
offset by the raid risk; numbers (×1.0) preserves the signed baseline; sim the net EV per type before
production. `TERRITORY_TYPES`/scrutiny/raid numbers are all sign-off levers.
**Step four — the RACKET-WARS layer (FORTIFICATION + RIVAL RAIDS) — BUILT** (`src/territory.js`,
`src/rules.js`, `schema.sql`, `test/social.js`; the between-war contestability + a treasury defense sink
territory lacked — rackets only changed hands via a full district seizure). New columns
`territory_rackets.fortitude/raid_cd_until`. **(1) FORTIFY** (`fortifyRacket`, `POST /v1/territory/:id/
fortify`, boss/underboss): buy a defense level from the treasury (`territory:fortify` cash SINK,
`territoryFortCost` = base × (level+1) × tier, capped `TERRITORY_FORT_MAX` 5) — a recurring late-game
treasury drain. Each level lowers a RIVAL raid's success; it does NOT touch the signed Bureau-crackdown
math. **(2) RIVAL RAID** (`raidRivalRacket`, `POST /v1/territory/:id/raid`, any made man of ANOTHER
family): muscle a held operation for `TERRITORY_RIVAL_CUT_BPS` (30%) of its PENDING income — a
muscle+cunning/2 contest vs the fortitude (`TERRITORY_RIVAL_RAID_P` TEST-ONLY roll knob). A landed raid
REDIRECTS the cut to the raider's treasury (`territory:muscle`, a treasury FAUCET — the owner's clock
advances so they keep the rest pending, exactly the **business-shakedown pattern**, so total
`territory:income + territory:muscle` emission stays bounded by the SAME signed income curve →
**§10.4-neutral**), draws law heat, and sets a per-racket `TERRITORY_RIVAL_CD_MS` (8h) cooldown win OR
lose (the owner isn't ground down); a failed raid costs the raider `TERRITORY_RIVAL_FAIL_DMG` health.
Gated level ≥ `TERRITORY_RIVAL_MIN_LVL` (8) / energy / not jailed·hospitalized·safehoused (P1.3) / not
your own family / not on cooldown / has pending income. §10.4: `territory:fortify` joined `territoryOut`
(SINK) and `territory:muscle` a new treasury IN term (`territoryMuscleIn`) in the gang-treasuries check —
both ride the `territory:` vocabulary (no vocab change). Seizure/dissolution reset fortitude + cooldown
(a seized op isn't born fortified). Lock order: attacker char → attacker gang → target racket (the
territory gang-before-racket convention; the DEFENDER gang is never locked — only the contested racket
row, so it can't AB-BA a concurrent collect/seize). `territoryOf` surfaces `fortitude`/`fortMax`/
`fortCost`/`raidCdSeconds`; the console Family tab gained a per-op fortify button + a shield chip + a
raid-a-rival input; `describe()` humanizes both. `test/social.js` covers the fortify rank/not-yours
gates + ledgered sink + view, the raid own/no_gang gates + a pinned WIN (cut → treasury, owner keeps the
rest pending) + the cooldown + a pinned LOSS (health hit, no cut), and the gang-treasuries §10.4
reconcile with both new reasons. All `TERRITORY_FORT_*`/`TERRITORY_RIVAL_*` numbers are founder sign-off
levers (the fortify sink + the muscle faucet is a redirect, not new emission). Deferred (step five):
racket specialists (assigning members) + racket-specific special operations. A focused three-lens
red-team (`AUDIT-territory-racket-wars.md`: §10.4/emission, locks, exploit/grief) returned **no
CRITICAL/HIGH** and fixed one MED: the rival raid had **no location gate** (the console said "at their
district" but the server didn't enforce it — a raid could launch from anywhere, breaking the
convoy/shakedown location-pinned pattern + counterplay); now `ch.loc !== districtId` throws `district`
(regression added). Verified CLEAN: the emission-neutral clock-advance (`last_income_at = now −
(pending−cut)/rate` leaves the owner exactly `pending−cut`, total income+muscle bounded by the signed
rate), the attacker-gang→racket lock order (defender gang never locked → no cycle vs collect/seize/
establish/fortify/upgrade), the 8h per-racket cooldown bounding grief, and Sybil self-raid gaining
nothing (§10.4-neutral redirect between your own families).

**FAUCET MEASUREMENT PASS — `tools/sim.js` P9.8–P9.10 (measured this session's three drops).** The three
"sim + sign-off" faucets (co-op apex raids, boxing exhibition purse, territory type mults) are now measured
analytically in the sim (the den/kill-EV precedent; §10.4 stays drift-0). Recorded in BALANCE.md with
recommendations; two real FINDINGS surfaced (flagged for founder sign-off, NOT retuned per ground rule #1):
**(1)** the **exhibition purse** is a large sustained faucet (+$41k/bout / **~$495k/day for a maxed 3-stable**,
+EV at every form) — rec: scale the fee toward the purse or cap bouts/day; **(2)** the **Protection Racket
type is a STRICT +15% upgrade at daily cadence** (hot-in-30h dodges a daily collect → 0% realized raid risk),
violating the "higher-variance not higher-EV" intent — rec: raise `protection.scrutinyPerHr` 6→~10 so a daily
collector faces real raid risk (like smuggling, which measured correctly: lazy-collected → ~80% raided → net
worse than numbers, active-collected → the full ×1.35). World apex emission is regen-bounded (base-wide
ceilings $960k–$4.32M/day; the B1 solo-floor is ~$90k–$300k/day for one min-level whale). The sim now prints
all three every run so any retune is re-measured.
**RETUNES APPLIED (founder-directed 2026-07-21, re-measured, §10.4 drift-0):** (1) **Protection
`scrutinyPerHr` 6→10** — now hot-in-10h so a daily collector faces P(raid) 72% → net ~$376k/day (was a
strict +15% free upgrade), a real higher-variance play (active collection ≤10h still banks the full ×1.15).
(2) **Exhibition fees journeyman $10k→$15k / gatekeeper $30k→$45k** (clubfighter untouched — cheap entry) —
maxed-fighter best EV +$41k→+$26k/bout (~$495k→~$315k/day for a maxed 3-stable), a genuine risk/reward
(9% chance of −$45k) still worth a ~$1M stable; fresh-signee EV unchanged. Both now the recommended defaults
(sim-signed, not yet production-signed). Also fixed a PRE-EXISTING date-flaky `test/growth.js` kitchen-raid
test uncovered en route (a 30-min accrual window decayed heat below the raid threshold on `heatDecay=2`
city-event days — now a 5-min window keeps heat ≥90). Suite 30/30 + sim drift-0.

**Phase 4 (Backed emission) — BUILT** (`src/economy.js`, `src/worker.js`, `test/economy.js`;
design `omerta-phase4-emission-design.md`). Closes the audit's #1 finding — the fixed 14% staking
APY was the only unbounded $OMR mint. Now staking rewards are **paid from a funded pool, not
minted**: a new soft-$OMR singleton `stake_pool` (in the §10.4 $OMR set) that the 12h buyback funds
with a `STAKE_POOL_BPS` (30%) slice of what it buys off the AMM — so cash sinks (street tax → buyback)
pay staker yield by REDISTRIBUTION, bounded by economic activity. `claimRewards`/`unstake` pay
`min(rewards, pool)` from the pool (a §10.4 TRANSFER `stake:reward`, **removed from the mint term**);
the unpaid remainder stays pending (no forfeit), payable when the buyback refills; **principal always
returns whole** (never pool-gated). A dry pool throttles yield (`pool` error) — `APY` is now the
CEILING on a backed rate, not an unbounded promise. `invariants.js`: `stake_pool` added to `omrBuckets`,
`stake:reward` dropped from `omrMints` → staking contributes **zero** to net supply. Ops: `GET
/v1/mod/emission` (pool gauge + backed ratio), `POST /v1/mod/emission/fund` (moves event-fund $OMR →
pool, a §10.4 transfer, never a mint). `test/economy.js` proves the empty-pool throttle, the buyback's
30% funding, a claim paid from the pool (balance drops by exactly what paid), principal-whole unstake,
and `$OMR conservation` holding with `stake:reward` as a transfer. Deferred (sim-gated) Phase-4
option: territory rent as a recurring $OMR sink (`TERRITORY_RENT_OMR`, ship-at-0). Numbers
(`STAKE_POOL_BPS`, the APY ceiling) are founder sign-off levers. **The Risk-to-Earn pivot's four
pillars are now all built** (off-chain; chain layer dormant, gated on legal + third-party audit).

**Business Empire (step one) — BUILT** (`src/business.js`, `test/economy.js`; design
`omerta-business-empire-design.md`). The PREMIUM, acquired-later personal front layer — distinct from
the flat mid-game `ASSETS`/`RACKETS` (buy-once, drip-forever): level-gated, UPGRADEABLE venues
(`BUSINESSES` catalog in rules.js tail — laundromat lvl15 → casino lvl58, each a 3-tier ladder of
`{cost, incomePerHr, launderCapDay}`) that farm pocket cash AND double as PRIVATE laundering infra —
the endgame engine of the Risk-to-Earn loop. Per-INSTANCE state in the new `businesses` table (one row
per owned front, `UNIQUE(character_id, kind)`), loaded into `h.owned.businesses` and surfaced in the
character view. Three actions (the territory-racket lazy-income pattern): **buyBusiness** (level-gated,
one per kind, cash sink `business:buy`), **collectBusiness** (lazy income → pocket cash, capped at
`BUSINESS_CAP_MS` 24h, faucet `business:income`), **upgradeBusiness** (collects pending at the OLD rate
first, then pays the next tier, sink `business:upgrade`). **launderAtBusiness** is the integration: cash→$OMR
through the SAME AMM as Phase-1's public wash house (rides the existing `swap:buy` ledger, no new reason),
but gated by the front's per-tier DAILY capacity (`launderCapDay`, a rolling 24h window on `launder_used`)
instead of the wash-house district, and drawing LESS heat (`BUSINESS_LAUNDER_HEAT` 8 < street `LAUNDER_HEAT`
15) — your own books are safer than the street; still an extraction act, so blocked from a safehouse (P1.3).
§10.4: all three cash reasons carry a `character_id`, so the per-character cash check reconciles them (the
`business:` prefix joined the cash vocabulary). Routes: `GET /v1/catalog` (public discoverable catalog —
also closes the audit's API-discoverability gap), `POST /v1/business/:kind/buy|/:id/upgrade|/:id/launder`,
`POST /v1/business/collect`, `GET /v1/business`. `test/economy.js` covers the catalog, the level gate, buy/
collect/upgrade with the income cap, private lower-heat laundering + the daily cap + window reset + safehouse
block, and the faucet/sink ledgering. All numbers (catalog costs, income curves, `launderCapDay`,
`BUSINESS_CAP_MS`, `BUSINESS_LAUNDER_HEAT`, level gates) are proposed defaults — sim + founder sign-off
before production (ground rule #1). **Step two (risk layer) — BUILT**: passive income you must protect.
**Scrutiny** (`scrutiny`/`scrutiny_at` on the row) comes ONLY from laundering (`BUSINESS_SCRUTINY_PER_CAP`
25/day-cap washed, decays `BUSINESS_SCRUTINY_DECAY_HR` 2/hr) — income-only fronts never get raided (their
risk is PvP), so PvE risk tracks extraction, PvP tracks wealth. **Bureau raids** resolve lazily on owner
touch (`resolveScrutiny` in collect/upgrade/launder — the §7.1 kitchen pattern): above
`BUSINESS_RAID_THRESHOLD` (60), one roll over the minutes-above at `BUSINESS_RAID_P_PER_MIN` (0.002);
a raid seizes ALL pending income (clock reset, never minted — no ledger row, the territory-seizure
precedent) + fines `BUSINESS_RAID_FINE_RATE` (10%) of the tier cost clamped to pocket (`business:raid`,
a ledgered §10.4 sink), then scrutiny→0. `BUSINESS_RAID_P` is a TEST-ONLY env knob (GEAR_LOOT_CHANCE
precedent) — never set in production. **Shakedowns** (`shakedownBusiness`, `POST /v1/business/:id/shakedown`,
withTwoCharacters): a rival extorts `SHAKEDOWN_RATE` (30%) of a front's PENDING income in a muscle/cunning
contest — the cut is the same bounded income faucet redirected (`business:shakedown`, attacker character_id;
owner keeps the rest pending, clock advances by only the stolen share); per-venue `SHAKEDOWN_CD_MS` (8h)
cooldown, `SHAKEDOWN_ENERGY` (15), `SHAKEDOWN_HEAT` (10) win or lose, family/hospitalized-owner blocked,
attacker safehouse-blocked (P1.3), failed attempts cost health. Fronts die with the street (`businesses`
joined the runEstate wipe). Owner view surfaces `scrutiny`/`raidRisk`/`shakedownCdSeconds`. Tests cover
scrutiny accrual/decay, the threshold gate, a forced raid (seize + ledgered fine), shakedown gates/contest/
cooldown, and the owner's ~70% remainder. Step-two numbers are founder sign-off levers too.
**RECURRING SINKS — "the pad" (business upkeep) — BUILT** (`src/business.js`,
`omerta-recurring-sinks-design.md`; the economy's first recurring, wealth-scaling drain, closing
the sim-audit's safehoused-landlord passive-stack gap). Every front owes protection + wages =
`BUSINESS_UPKEEP_BPS` (2000 = 20%) of its `incomePerHr`, accrued lazily on its OWN clock
(`businesses.upkeep_at`) up to `BUSINESS_UPKEEP_CAP_MS` (7d) — distinct from the 24h income cap, so
an ABSENT owner earns ≤24h but owes ≤7d (neglect bleeds). `payBusinessUpkeep`
(`POST /v1/business/upkeep`) settles the pad on every front you can afford (greedy) — a §10.4 cash
SINK `business:upkeep` riding the existing `business:` vocabulary (zero invariant changes,
character_id reconciles check (a)) — resetting that front's clock. A front unpaid past
`BUSINESS_UPKEEP_COLD_MS` (3d) goes COLD (`isCold`): `collectBusiness` skips it (withheld take lost
to the 24h cap, not banked), `launder`/`upgrade` throw `cold`, until the pad thaws it; upgrade
resets `upkeep_at` (squares the books, no retroactive rate bump). View surfaces `upkeepPerHr`/
`upkeepOwed`/`cold`. `test/economy.js`: rate+owed in the view, ledgered pay resetting the clock,
the cold gate (no income/launder/upgrade) + thaw. All numbers founder sign-off levers.
**Step two — TERRITORY-RACKET upkeep — BUILT** (`src/territory.js`): the same pattern at the GANG
level — every operation owes `TERRITORY_UPKEEP_BPS` (20%) of its income, accrued on
`territory_rackets.upkeep_at` up to 7d; a boss/underboss pays it from the TREASURY
(`POST /v1/territory/upkeep`, greedy) — a §10.4 treasury sink `territory:upkeep` (character_id
NULL, counterparty=gang; invariants treasury check subtracts it with `territory:establish`;
`territory:` prefix already vocabularied). Unpaid past 3d → COLD (`collectTerritory` skips it,
`upgradeRacket` throws `cold`); upgrade squares the clock; **seizure resets it** (a seized racket
is never born cold, old arrears don't follow the turf). `territoryOf` view surfaces
`upkeepPerHr`/`upkeepOwed`/`cold`. `test/social.js`: rank gate, view fields, ledgered treasury pay
resetting the clock, cold gate + thaw, treasury §10.4 reconcile.
**Step three — CREW WAGES ("the nut") — BUILT** (`src/kitchen.js`, `src/accrual.js`,
`crewWageOwed`/`crewCold` in the rules tail): the pattern applied to the KITCHEN crew (the offline
drug-selling workforce). Each member draws `CREW_WAGE_PER_HR` ($1,200) whether the stash moves or
not, accrued on `characters.crew_paid_at` (stamped/reset on hire + on pay) up to `CREW_WAGE_CAP_MS`
(7d). `payCrewWages` (`POST /v1/kitchen/crew/wages`) is all-or-nothing — a §10.4 cash sink
`crew:wages` (added to the cash vocabulary). Unpaid past `CREW_WAGE_COLD_MS` (3d) the crew goes
COLD: the §7.1 accrual crew-sales block skips them (`crewCold(ch)` gate — the ONLY recurring sink
gating an OFFLINE/accrual faucet, not an on-demand collect); the stash sits untouched until the nut
is paid. View surfaces `crewWagePerHr`/`crewWageOwed`/`crewCold`; persistCharacter carries
`crew_paid_at` ($46). `test/growth.js`: view fields, ledgered pay resetting the clock, a cold crew
moving NOTHING across a big accrual window + thaw. Roadmap (deferred): the heat-scaled city
pad/bribery (a founder call — touches signed heat surfaces). Suite 16/16 + sim drift-0.

**Full sim audit (`AUDIT-sim.md`)** — four red-team lenses + a real simulation harness
(`tools/sim.js`: drives the live server through the public API only, seeds NO value, warps clocks,
asserts the full §10.4 sweep at the end — run it after any economy change; non-zero exit on drift).
Result: 8/8 §10.4 checks drift-0 over an entirely earned economy. Fixed in-commit (regressions
added): jump war-score AB-BA deadlock (the fire fix had missed jump), bounty-sweep lock inversion
(now per-pot txns, characters-before-pot), anon family contract leaking the family on the streets
feed (incl. top-ups), dead-code Bureau raids (scrutiny retuned PER_CAP 45 / decay 1hr / cap 100 /
p .0005 — the risk layer is now reachable; founder lever), raid fine now reaches bank after pocket,
launder cap now a continuous token bucket (was 2× at every window boundary), raid window
pacing-neutral (unfloored exponent), `path:` added to the cash vocabulary (every player tripped a
permanent false §10.4 alarm), launder route joined the swap rate bucket, dead bodyguard now
releases principals at estate (in-memory killer-as-principal handled), bodyguard hires carry the
standard 2% house take (was the game's only untaxed unlimited transfer), vig invariant two-sided
(`reserve not under-funded` catches a crash-lost fundReserve), worker sweep re-reconciles stranded
fee credits, shakedown hospitalized/health gates, ownership-scoped business locks. NOT patched
(founder sign-off, ranked in the report): the safehoused-landlord passive stack (~25× the riskiest
loop), kill EV measured NEGATIVE even vs careless marks (−$75k), PLEX pricing starving the vig,
AMM depth vs endgame faucets, territory ROI/seizure snowball, business/racket bucket additivity,
directed-contract squatting, kitchen on-ramp margin.

**Make-Risk-Pay package (founder-approved from the sim audit; numbers are sign-off levers).**
Four levers, all built + tested: **(1) loot surfaces** — bank deposits ride IN TRANSIT for
`BANK_CLEAR_MS` (2h; stacking deposits reset the clock, withdrawals clamp the marker) and unstaked
principal UNBONDS for `UNSTAKE_CD_MS` (6h, no yield; staking in stays instant) — a fire-kill's
`whack:loot` now takes `CASH_LOOT_RATE` of pocket + in-transit (one ledger pair spans cash+bank)
and `OMR_LOOT_RATE` of liquid + unbonding (liquid drained first), so banking is a timed act and
the stake→extract path always crosses an exposure window. New columns `characters.bank_intransit/
_at`, `account_persistent.unbonding/unbond_at`; releases run on the WALL CLOCK above accrual's
1-second early-return; `unbonding` joined the §10.4 omr bucket sum. **(2) wealth-scaled safehouse**
— cost = max($25k, cash+bank × `SAFEHOUSE_NW_BPS`/10⁴ (1%)) per 4h stay; live quote in the view
(`safehouseCost`). **(3) market-linked PLEX** — `plexQuote`: fee-ETH (`MINT_FEE_ETH`/`RESPAWN_FEE_ETH`)
× the latest vig buyback's `price_omr_per_eth` (mainnet: the DEX TWAP) × `PLEX_PREMIUM_BPS` (1.2),
static `PLEX_*_OMR` as the pre-market floor; `GET /v1/plex/price` is the public quote — $OMR stays
the premium rail, ETH the economical one (that asymmetry feeds the vig). **(4) organic AMM depth** —
each 12h buyback carves `AMM_LP_BPS` (25%) of the tax pool into PROTOCOL-OWNED LIQUIDITY: cash
paired with event-fund $OMR at spot into BOTH reserves (a §10.4 bucket transfer, nothing minted,
price unmoved, k grows with real activity); skipped (falls through to the buyback) when the fund
can't match the pair. Tests: social (in-transit + unbonding looted on a kill, release after the
window, scaled safehouse quote+charge), economy (unbond→release whole, deposit clears, LP carve +
fund pairing + k growth), vig (market quotes, mint at 24 not 5, respawn gated at 240).

**Sim-audit balance drop 2 (founder-directed; numbers are sign-off levers).** Three fixes from the
audit's ranked list: **(1) directed-contract squatting** — naming a hitman now takes `DIRECTED_MIN`
($10k, 20× the open floor) and the exclusive window caps at `DIRECTED_MAX_H` (24h, was the full
7-day TTL); decisively, `claimBounty` now pays a completed KILL to *whoever* did the job even inside
the window (`p.kind !== 'kill'` guards the skip — hospitalize pots stay exclusive; the named hitman
keeps the 1.5× rep bonus; runEstate's exclusive-refund still covers NPC/mod deaths where no player
claimed). A friendly squat pot now funds the mark's enemies. **(2) territory ROI taper + seizure
premium** — `TERRITORY_RACKETS` t2 $250k / t3 $1M (marginal ROI 192%→115%→106%/day instead of flat),
`territoryBuildCost` helper, and `seizeDistrict` adds a war premium of `TERRITORY_SEIZE_BPS` (50%)
of the operation's cumulative build cost on top of the garrison outbid (ledgered in the same
`turf:seize:` sink; only the garrison part becomes the new defense budget; response now
`{garrison, premium, cost}`). **(3) kitchen on-ramp** — rank-0 dealers get `KITCHEN_ONRAMP_BONUS`
(+50%) on deal gross (the "corner premium", response flag `cornerPremium`), phasing out at
trade-rank 1 so the sim-audited mid/endgame deal curve is untouched. Tests updated/added across
social (directed floor + window cap + outsider-collects + seize premium) and growth (corner
premium). Suite 9/9 + sim drift-0.

**The Gambling Den (step one) — BUILT** (`src/casino.js`, `test/casino.js`; design
`omerta-gambling-den-design.md`). Player-vs-house games at the Neon Mile — the recurring,
voluntary, entertainment-priced cash sink the genre demanded. HARD RULES baked in: **CASH ONLY,
never $OMR** (the regulatory line — no den route touches `account_persistent.omr`); every roll
server-side + `rng_audit`'d; every stake a §10.4 sink (`casino:bet:<game>`), every payout a faucet
(`casino:win:<game>`), both character_id'd so check (a) reconciles; 1% of every stake → street-tax
pool via takeHouse (the buyback/yield loop), the rest of the edge burns. Games: **street craps**
(`POST /v1/casino/dice` — the full pass line resolved in ONE stateless call, pays 1:1, edge ~1.41%,
costs 1 nerve, $100–$250k table) and **the Numbers** (`POST /v1/casino/numbers` — pick 0–999,
$10–$1k, ONE ticket per street per day in `numbers_tickets`, drawn from
`hash01('numbers:'+day+':'+MARKET_SEED)` — the §7.11 machinery — pays the historically accurate
600:1 ≈ 40% edge; `POST /v1/casino/numbers/claim` settles matured tickets lazily + idempotently;
`GET /v1/casino` is the front window). `CASINO` block in the rules tail = founder sign-off levers.
`test/casino.js` (10th suite file, wired into npm test) proves: district/limit/jail gates, a
60-round craps session with stakes/payouts/1%-street-cut ledgered EXACTLY, $OMR untouched across
the session, ticket lifecycle (one/day, early-claim refused, 600:1 hit, losing settle, idempotent),
and the per-character §10.4 identity + vocabulary. **Step two — BUILT**: **back-room PvP dice**
(consent-by-listing via `characters.fade_limit` — the bodyguard-market pattern; challenger rolls a
fader under withTwoCharacters, symmetric 2d6 ties-reroll, winner takes pot − `PVP_RAKE_BPS` 5%,
half the rake → street tax + half burns; ledgered `casino:pvp` ±, a pure §10.4 transfer with a
take; no escrow — one atomic txn), **the weekly fight** (`fight_bets` one capped bet/street/week —
`FIGHT_MAX` $5k is the fix's structural abuse bound; favorite at `FIGHT_FAV_P` .65 off the seed
draw, pays 1.45/2.6; lazy claim) **+ THE FIX** (`fight_fixes`: the boss of the family holding neon
buys the result once/week for `FIGHT_FIX_COST` $50k from the TREASURY — `casino:fix`, a
character_id-NULL treasury sink added to invariant check (b)), **casino-front rakeback** (owners of
a `casino` business split `RAKEBACK_BPS` 1% of den stake volume — `den_volume` counter singleton +
per-front `rake_cursor` stamped at buy so new owners never claim history; paid at business collect,
ledgered `casino:rakeback`), and **the high-stakes room** (level ≥ `HIGH_LVL` 30 raises the PvE
table to `HIGH_MAX` $2M; pots ≥ `HIGH_FEED` $250k hit the streets feed). `numbers_tickets` +
`fight_bets` joined the runEstate wipe. Tests: fade gates/board, exact PvP transfer + rake split
both directions, fight side/cap/one-per-week gates, fix rank/turf/once/treasury paths, fixed +
seed-drawn settlements, rakeback cursor exactness + no-double-claim, and the treasury §10.4 check
reconciling `casino:fix`. All step-two numbers are founder sign-off levers. **Step three — the TABLE
GAMES — BUILT** (`src/casino.js`, `test/casino.js`; on the audited den-book accounting, so **NO new
emission** — both games are house-favorable in expectation, a NET SINK): **BLACKJACK** (stateful PvE)
— `POST /v1/casino/blackjack {amount}` deals (bet taken + profit-booked at deal, `casino:bet:blackjack`);
the hand persists in `blackjack_hands` (one live hand per street, joined the runEstate wipe) across
`hit|stand|double` — each its own atomic txn under withCharacter — until it resolves and the payout
credits (`casino:win:blackjack`). Infinite deck (independent draws, rng-audited); dealer stands on
`BJ_DEALER_MIN` 17 + hits SOFT 17 (`BJ_HIT_SOFT_17`, the authentic ~0.6% edge); a natural pays 3:2
(`BJ_PAYS_BPS` 15000); double = a first-two-cards second stake + one card + auto-stand. Same book
plumbing as dice (bumpProfit / profit-capped takeHouse / bumpVolume) so the `den profit` §10.4 identity
(profit == PvE bets − wins) stays exact. **HEADS-UP HOLD'EM** (PvP showdown) — consent-by-listing: a
dealer posts a `characters.poker_limit` (`POST /v1/casino/poker/deal {limit}` — the fade pattern, a
new persisted column at `persistCharacter` $61 + the view); a challenger antes an equal stake
(`POST /v1/casino/poker/:targetId {amount}`, withTwoCharacters), both are dealt 2 hole + a shared
5-card board (a real 52-card shuffle, a 7-card best-hand evaluator), best hand takes the pot − 5%
`PVP_RAKE_BPS` (half → street tax / half burns — the back-room-dice `casino:pvp` mechanism, §10.4-exact
per character); a tie SPLITS (stakes returned, no rake, no money moves); one atomic showdown (multi-
street betting deferred). §10.4: `casino:bet:blackjack`/`casino:win:blackjack` ride the existing
`casino:` prefix (zero invariant/vocab change; they join the den-book bet/win LIKE patterns); poker is
the audited `casino:pvp` transfer. `denInfo` (`GET /v1/casino`) surfaces the live blackjack hand + the
open poker tables; `/v1/rules` gained a `casino` block; the console Den tab gained blackjack (deal/hit/
stand/double + the live-hand render) + a Hold'em table (open/play); `describe()` humanizes both.
`test/casino.js` proves a mixed session (deal/hit/stand/double, cash-delta==net per hand, the
bet/win ledger sums, the one-live-hand + no-double-after-hit gates, rng-audit) + heads-up poker
(the taxed transfer + rake split both ways + a split, valid hand names + a 5-card board) with the
den-profit identity + $OMR-untouched holding. Suite 32/32 + sim drift-0. All step-three numbers
(`CASINO.BJ_*`, `POKER_MIN`) are founder sign-off levers (BALANCE.md — a net sink, no signed faucet
touched). Deferred (step four): true multi-way ring poker + a live TOURNAMENT prize pool (both need
turn-based session state this atomic architecture defers), blackjack splits/insurance. A focused
three-lens red-team (`AUDIT-casino-tables.md`: §10.4/den-book, stateful-hand concurrency, exploit/
grief) returned **no CRITICAL/HIGH** and fixed one MED (regression added): `openLiability` reserved
the numbers/fight exposure but NOT a live blackjack hand's pending payout, so the street could be
tipped against an unresolved hand (parity gap, not a §10.4 drift — the den identities hold either
way + the cap is soft) — now each live hand's max gross payout (`bet × (dbl?2:1) × 2`) is reserved.
Verified CLEAN: the den-profit identity + per-character cash exactness, the `blackjack_hands` direct-
SQL/char-lock discipline (no persist-clobber, deals serialize → `hand` gate, the PK-23505 path
unreachable), `poker_limit` persist parity + `playPoker`'s den_volume→street_tax lock order (the
B-H1 posture), infinite-deck un-countability, −EV poker collusion, no hole-card leak (only the
dealer up-card is exposed until resolve), and abandonment being pure self-forfeit. **Step four — THE
POKER TOURNAMENT — BUILT** (`src/casino.js`, `test/casino.js`; the scheduled, escrow-funded,
worker-resolved SHOWDOWN — the boxing main-event pattern, since the atomic model can't hold
turn-based hands). A fixed `TOURNEY.BUYIN` ($5k) cash ESCROWS into a pool during an open window
(`POST /v1/casino/tournament`; `poker_tournaments`/`poker_entries`/`poker_state` tables; one open
tournament at a time, a new one materializes on the next entry after the last settles; `TOURNEY_MS`
env TEST-ONLY). The worker (`sweepTournaments`→`resolveTournament`, wired in worker.js) deals every
LIVE entrant an INDEPENDENT 7-card hand (a fresh shuffle each — scales to any field), ranks best-5-
of-7, and pays the top `min(field, PAYOUTS.length)` places a RENORMALIZED share of the pool net of
`RAKE_BPS` (5%, half → street tax / half burns) — so the house edge stays the rake at any turnout
(no unpaid-place leak); ties split the covered shares. A dead entrant's stake burns
(`casino:tourney:death`); a field < `MIN_ENTRANTS` (2) is refunded. §10.4: all ride the `casino:`
prefix (no vocab change) + a NEW **`poker tourney escrow`** check (the boxing-bet-escrow twin: open
pool == Σ buyin − win − refund − take − death) — and the exact-reason matches sit UNDER the den-book
`casino:bet:%`/`casino:win:%` LIKE patterns, so a tournament never touches the PvE house book. A pure
competitive REDISTRIBUTION (no new emission). Lock order: char → `poker_state` → tournament (enter);
entrant chars sorted → tournament (settle) — acyclic. `denInfo`/`/v1/rules` surface it; the console
Den tab gained a tournament card; `describe()` humanizes the buy-in. `test/casino.js` proves the
district gate, the short-field refund + closed-window + double-entry gates, a 3-handed settle with a
dead entrant's stake burned + the top places splitting net of rake, and the escrow §10.4 check.
Suite 32/32 + sim drift-0. All `TOURNEY.*` numbers are founder sign-off levers. Deferred (step five):
true multi-way ring poker with live betting streets + a bracketed multi-table tournament (both need
turn-based session state). A focused three-lens red-team (`AUDIT-casino-tournament.md`: §10.4/escrow,
enter→settle concurrency, exploit/grief) returned **no CRITICAL/HIGH** and fixed one MED: an
enter-vs-settle deadlock — `resolveTournament` locked the tournament row before `poker_state` (via
`clearCurrent`) while `enterTournament` locks `poker_state`→tournament (AB-BA, masked by the standard
40P01 retry); `resolveTournament` now locks `poker_state` before the tournament row, acyclic. Verified
CLEAN: the escrow identity exactness (open/resolved/refunded each reconcile), the half-take→street_tax
+ full-NULL-row being the audited casino:pvp pattern (`street_tax.pool` cash isn't a §10.4 bucket),
the materialization/settle serialization + idempotency + no-persist-clobber + poker_entries kept out of
the estate wipe, and alt-stuffing being −EV (renormalized `−rake/N` for every entrant, no dilution).
Design note (flagged, not a defect): the tournament is a chance-based pooled lottery (server-dealt
random hands), not skill poker — matches the den's other games.
**THE TRACK — the dogs & the ponies — BUILT** (`src/casino.js`, `test/casino.js`; the weekly-FIGHT twin,
the classic day at the track). A DAILY race card (greyhounds + horses), each race a `TRACK.FIELD` (6)
of runners drawn off the §7.11 seed (`trackFieldOf(race, day)`) — each runner gets a true win
probability `p` (seeded weights, normalized) and POSTED decimal odds = `(1/p)×(1−EDGE)`, so the book
takes a UNIFORM `TRACK.EDGE` (15%) takeout on every runner (the historically accurate track vig). The
winner is drawn from the seed weighted by the TRUE `p` (`trackWinnerOf` — the odds carry the vig, the
draw does not → fair + verifiable; `p` never leaks — `trackCardOf` strips it). One WIN bet per race per
street per day (up to 2/day — dogs + horses; `track_bets` PK `(character_id, day, race)`), settled
lazily the next day (`betTrack`/`claimTrack`, the numbers/fight pattern). CASH ONLY (the Den's rule) —
`casino:bet:track` sink / `casino:win:track` faucet ride the EXISTING `casino:bet:%`/`casino:win:%`
den-book LIKE patterns (bumpProfit + profit-capped takeHouse 1% + bumpVolume; the open ticket's
`stake × TRACK.MAX_ODDS` exposure joins `openLiability`), so **ZERO invariants.js change** — the
per-character cash check + `den profit`/`den distributions` identities reconcile it automatically. A
bounded faucet that's a NET SINK in expectation (every den game is), small-capped (`MIN_BET` $50 /
`MAX_BET` $10k). Joined the runEstate wipe (`track_bets`). Routes `POST /v1/casino/track|/track/claim`;
surfaced on `denInfo` (`GET /v1/casino` — the card + your open tickets), `/v1/rules`, the console Den
tab (the two race cards with posted odds + a bet-the-race form + claim), and `describe()`. `test/casino.js`
covers the field/odds board (no `p` leak), the bad-race/min/max/runner gates, a WINNING dog backdated +
claimed at the posted odds, a LOSING horse settling to nothing, the one-bet-per-race-per-day gate, and
the §10.4 per-character reconcile ($OMR untouched). Suite 32/32 + sim drift-0 (17 checks). All `TRACK`
numbers are founder sign-off levers — a net-sink book, no signed faucet touched (BALANCE.md).
**THE STABLE — own the dogs & the ponies — BUILT** (`src/stable.js`, `test/stable.js` — the 33rd suite;
the ownership layer under The Track's betting card, the boxing-stable pattern applied to racing animals).
An owner BUYS a young racer — a `STABLE.KINDS` dog (`Greyhound` $30k) or horse (`Racehorse` $120k, pricier +
rolls higher; a cash SINK `stable:buy`, level-gated `MIN_LEVEL` 6, one-of-two-kinds, stats rolled in the
kind's range), TRAINS its speed/stamina/heart (cash+energy SINK `stable:train`, capped `STAT_CAP` 25), and
RACES it. SPEED FORM = speed+stamina+heart+rand(`VARIANCE`). Two loops, both CASH (the Den's rule): the PvE
**CIRCUIT** (`raceCircuit`, `POST /v1/stable/circuit/:racerId` — a `STABLE.MEETS[kind]` tier: the fee BURNS
win/lose `stable:fee`, the purse pays only on a win `stable:purse` — **the ONE new faucet, the boxing-
exhibition twin**, bounded by the per-racer `CIRCUIT_CD_MS` 6h cooldown + injury-on-loss + needing the FORM),
and the PvP **MATCH RACE** (`matchRace`, `POST /v1/stable/match/:opponentId`, two-party — consent-by-listing
via `racers.race_limit`, **same kind only**, the audited **casino:pvp** taxed transfer `stable:race`: winner
nets wager − 5% rake, half rake → street tax/buyback, half burns — NO escrow, NO new faucet; the loser's
racer laid up `INJURY_MS` 4h). Run up to `STABLE_MAX` 4. Racers **DIE WITH THE STREET** (`racers` joined the
runEstate wipe — the fighters precedent); the owner's lifetime wins are an account-level LEGEND
(`account_persistent.racer_wins`, bumped by direct SQL — SURVIVES DEATH, the boxing-legend/hitman-rep
precedent) ranked `STABLE.LEGEND_RANKS` on `GET /v1/leaderboard/stable`; per-racer records ride
`STABLE.RANKS`. §10.4: `stable:` joined the cash `KNOWN_REASONS` (buy/train/fee SINKS + purse FAUCET + the
race PvP transfer, all character_id'd → the per-character cash check reconciles; the PvP rake→pool/burn is
the audited casino:pvp mechanism). New `racers` table (+ indices) + `racer_wins` legend col; racer stat/record
writes are ABSOLUTE INT (the pg-mem quirk). Routes `POST /v1/stable/buy|/train/:id|/list/:id|/circuit/:id|
/match/:opp`, `GET /v1/stable|/leaderboard/stable`; `/v1/rules` gained a `stable` catalog; a **"The Stable"**
console tab (Vice group — your stable with train/list/circuit buttons, the field with match-a-rival, the owner
legend) + `describe()`. `test/stable.js` covers the buy gates + sink, train (bad-stat/energy/cap/ownership +
sink), the circuit (bad-meet/cooldown gates, a win's purse faucet + a loss's fee-only burn + injury + the
legend), the match (self/kind/limit gates, the casino:pvp taxed transfer + the rake split, injury-on-loss, the
legend), the board + leaderboard, DEATH (the stable wiped, the legend survives), and the §10.4 per-character
reconcile + vocabulary. Suite 33/33 + sim drift-0. All `STABLE` numbers are founder sign-off levers — the
`stable:purse` circuit faucet is the one new emission surface (sim + sign-off, BALANCE.md, the boxing-
exhibition precedent).
**Step two — BREEDING + THE CORNERMAN + THE STAKES — BUILT** (`src/stable.js`, `test/stable.js`; the three
"build off that" items). **(1) BREEDING** (`breedRacers`, `POST /v1/stable/breed`): retire TWO same-kind
racers into a FOAL that inherits a fraction of the parents' average stat — `floor(avg × BREED_INHERIT 0.6) +
rand(0,BREED_VARIANCE 5)`, clamped to the kind's `[statMin, STAT_CAP]`: a HEAD START, deliberately NOT a
cap-skip (two maxed parents → a ~15-20 foal, saving grind but well under the 25 ceiling). A `stable:breed`
cash SINK; both parents are CONSUMED (2 racers + cash → 1 foal — a build-consolidation lever, bounded). Locks
both parents sorted, same-kind + ownership gated. **(2) THE CORNERMAN** (the Underworld tie-in — no new
fixture): Mickey the Corner trains your ANIMALS too — his T1 training discount (×0.9 cash) + T3 build bonus
apply to `trainRacer` exactly as to a boxer (status axis, the discounted number ledgered; the build bonus
never lifts `STAT_CAP` → the circuit faucet EV is unchanged), and stable buy/train/circuit/stakes bump his
standing (train is his daily lead). **(3) THE STAKES** (`enterStakes`/`resolveStakes`/`sweepStakes`,
`POST /v1/stable/stakes/:racerId`): the marquee — enter your racer into a scheduled race the town's best
animal wins (the Grand-Prix/poker-tournament escrow twin on the animal side). A CASH buy-in ESCROWS into a
purse (`stable:stakes:buyin`); the worker races every LIVE entrant's SNAPSHOTTED form + rand(VARIANCE), ranks,
and pays the top `PAYOUTS` places a share net of `RAKE_BPS` (half → buyback, half burns) — a pure competitive
REDISTRIBUTION, **no new faucet**. The racer isn't escrowed (only the cash) → race the form you entered, then
run/breed/sell it. One open stakes at a time (`stakes_state.current`); a short field (< MIN_ENTRANTS 3) refunds;
a dead entrant's stake burns (`stable:stakes:death`). §10.4: all `stable:stakes:*` ride the `stable:` cash
vocabulary + a NEW **`stakes escrow`** check (pool == Σ buyin − win − refund − take − death — the grand-prix-
escrow twin). LOCK ORDER = the Grand-Prix posture exactly (enter: char → stakes_state → race; resolve: entrant
chars sorted → stakes_state → race, state before the row so a concurrent entry can't AB-BA). New `stakes_races`/
`stakes_entries`/`stakes_state` tables; the worker wires `sweepStakes`; the board surfaces the open stakes;
console gained a Breed-a-foal card + a Stakes card; `describe()` + `/v1/rules` catalog + a P9.18 sim probe (the
circuit faucet, boxing-exhibition parity). `test/stable.js` covers breeding (same/kind gates, the foal's
head-start range, parents consumed, the ledgered sink) + the stakes (buy-in escrow, a short-field refund,
one-per-owner gate, a full-field worker settle to the top places net of rake, and the `stakes escrow` §10.4
check). Suite 33/33 + sim drift-0 (18 checks). All `BREED_*`/`STAKES.*` numbers are founder sign-off levers
(the stakes is a redistribution — no signed faucet touched). **Step three — RUN IN THE CARD — BUILT** (`src/casino.js`, `test/casino.js`; the last racing piece — a
player's own racer runs in The Track's DAILY seed-drawn card so the whole town bets on player-owned animals).
`enterTrackRace` (`POST /v1/casino/track/enter/:racerId`) enters a FIT racer (its kind → the dogs/horses race)
into today's card, taking one of the last `TRACK.PLAYER_SLOTS` (2) posts; a cash `ENTRY_FEE` ($5k) nomination
sink (`casino:track:entry` → the buyback, the pen:commissary precedent). The racer's FORM is SNAPSHOTTED into
`track_entries` (self-contained — race/breed/sell it after). `trackFieldOf(race, day, entries)` MERGES player
entries into the field (a form-derived weight `0.2 + (form/75)×1.8`, the NPC band → a maxed racer is the
short-priced favorite), and `trackWinnerOf` draws the winner from the merged p. The town bets via the SAME
`betTrack` — now **fixed-odds**: the odds are LOCKED on the ticket at bet time (`track_bets.odds`, a
bookmaker's board that shifts as runners enter), and `claimTrack` pays the locked odds (falls back to the
field odds for pre-step-three tickets). §10.4: the entry fee is a character_id'd `casino:` cash sink (check (a)
reconciles); the betting is the UNCHANGED den book (`casino:bet:track`/`casino:win:track`); **no owner purse
in step three** (status only — deferred sim-gated option) so the racer running is §10.4-neutral on the owner
side. The worker `sweepTrackEntries` banks each entered racer's card win the next day (its record + the
account `racer_wins` legend — direct SQL, survives death), idempotent (`settled` flag), per-(day,race) txn.
`track_entries` is EXCLUDED from the estate wipe (the snapshot must survive so the frozen field/winner
resolve — the stakes_entries precedent). New `track_entries` table + `track_bets.odds` column; `denInfo`
surfaces the merged card (player runners flagged) + your entries; console Den-tab Track section shows ★
player runners + a run-in-the-card control; `describe()` + `/v1/rules` + a defensive `FIELD ≥ 4` comment.
`test/casino.js` covers the district/one-per-card gates + the ledgered entry sink, the merged card (the maxed
racer as the flagged favorite), a bet paid at the LOCKED odds, and the worker banking the win (record + legend,
idempotent). Suite 33/33 + sim drift-0 (18 checks). All `TRACK.PLAYER_SLOTS`/`ENTRY_FEE` numbers are founder
sign-off levers. Deferred (sim-gated): an owner PURSE for a card win (a den-book-capped
faucet, the rakeback discipline). **Step four — THE FUTURITY — BUILT** (`src/casino.js`, `test/casino.js`;
the marquee where the Stable and The Track finally MEET — the boxing-main-event twin on the racing side,
DISTINCT from THE STAKES: The Stakes is the poker-tournament twin (owners buy in, compete for the pooled
buy-ins); the Futurity is spectator PARIMUTUEL — owners NOMINATE player-owned racers and the WHOLE TOWN
bets on the field). `nominateFuturity` (`POST /v1/casino/futurity/nominate/:racerId`) enters a fit racer
into the open futurity (`CASINO.FUTURITY.FIELD_MAX` 8), form snapshotted; a burned `NOMINATE_FEE` ($5k)
cash SINK (`casino:futurity:nom` → the buyback, the track-entry precedent — NON-refundable, NOT escrow).
Spectators `betFuturity` (`POST /v1/casino/futurity/bet`) escrow CASH on one runner (one bet/bettor;
an owner with a runner can't bet — `own_event`; `[MIN_BET,MAX_BET]`); the worker `sweepFuturity`
(`resolveFuturity`) races the field (`form + rand(VARIANCE)`, ranked DESC — the resolveStakes draw) at
window close and pays PARIMUTUEL: the winner's backers get their stake back + a pro-rata cut of the LOSING
pool net of `RAKE_BPS` (5% — half → buyback, half burns, the boxing vig), the winning OWNER a promoter
purse (from the rake, only if alive), the winner's racer a record win + the account `racer_wins` legend
(status, survives death). A dead owner's runner SCRATCHES (its backers refunded); a dead bettor's escrow
BURNS (`casino:futurity:death`); a card with < `MIN_RUNNERS` (3) live is SCRAPPED (every bet refunded); a
one-sided book (no action on the winner) refunds every live bet. **One open futurity at a time**
(`futurity_state.current`; a new one materializes on the next nomination after the last settles — the
Stakes/Grand-Prix pattern; `FUTURITY_MS` env is TEST-ONLY). §10.4: every `casino:futurity:*` reason rides
the existing `casino:` cash vocabulary (**ZERO invariants.js reason change**) + a NEW **`futurity escrow`**
check (the boxing-bet-escrow twin: open pool == posted − wins − refunds − purse − take − death); the
exact-reason matches sit UNDER the den-book `casino:bet:%`/`casino:win:%` LIKE patterns, so a futurity
never touches the PvE house book (a pure competitive REDISTRIBUTION — no new faucet). **Lock order** = the
tournament posture: nominate locks char → racer → `futurity_state` → the card row; `resolveFuturity` locks
runner-owner + bettor chars sorted → `futurity_state` → the card row (state BEFORE the row, so a concurrent
nomination can't AB-BA). New `futurities`/`futurity_runners`/`futurity_bets`/`futurity_state` tables
(runners/bets EXCLUDED from the estate wipe — self-contained snapshots). `denInfo` surfaces the open card
(field + live per-runner pools + your bet); the console Den tab gained a Futurity section (nominate + bet-
the-field); `describe()` + `/v1/rules`. `test/casino.js` covers the district/own_event/bad_runner/
already_bet gates, the ledgered nomination sink, a 3-runner card with a maxed favorite winning, the
parimutuel payout (winner's backer +net, loser's stake gone, the owner's promoter purse, the NULL house
take), and the `futurity escrow` §10.4 check mid-window ($2000) + closing to 0. Suite 33/33 + sim drift-0
(19 checks). All `CASINO.FUTURITY.*` numbers are founder sign-off levers (a redistribution, no signed faucet
touched). The Stable + Track racing pillar is now feature-complete (own → train → circuit/match →
breed/stakes → run in the town's card → the crowd-bet Futurity).

**Balance sign-off pass — `BALANCE.md` is the single source of truth for every economy lever.**
The sim was extended (mid-deposit kill EV probe, safehouse wealth-tier quotes, realized den edge,
analytic extraction risk) and re-run: §10.4 drift-0; the Make-Risk-Pay surfaces verified live
(in-transit deposits ARE looted; kill break-even ≈ victim liquid ≥ kill-cost ÷ CASH_LOOT_RATE ≈
$344k for a mid mark — "hunt whales" economics). BALANCE.md tables every PROPOSED lever with its
measurement and a KEEP recommendation, and ranks the open items as D1–D8 (kill prey threshold,
safehoused collection D2-(b) rec, public-wash cap, NPC per-target cd, bank taper, kitchen margin
watch, respec cd, leftovers). **SIGNED 2026-07-16 — founder approved all recs, all built same
day**: D2 safehouse now blocks bank deposits + business/territory collection (exposed acts; the
`safe` error), D3 `PUBLIC_WASH_CAP_DAY` $2.6M/day token bucket on swap-buy (columns
`characters.wash_used/wash_at`), D4 `NPC_HIT_TARGET_CD_MS` 24h per (payer,target) (`npc_hits`
table), D5 bank interest tapers above `BANK_TAPER_ABOVE` $10M to `BANK_TAPER_KEEP` 10% of the rate
(an explicit founder override of the prototype flat rate), D7 `RESPEC_CD_MS` 24h
(`characters.respec_at`); D1 (whale-hunting kill economics) + D6 (kitchen margin) signed as-is;
D8 leftovers accepted for alpha. THE ECONOMY IS SIGNED — every KEEP row in BALANCE.md is
production balance. After ANY retune: `node tools/sim.js` + `npm test` must stay green.

**Vendettas & blood feuds — BUILT** (`omerta-vendetta-design.md`; social.js/estate + `vendettas`
table, account×account, PK pair, sworn = the dead street's name). A player FIRE-kill (never NPC/mod)
makes `runEstate` swear the victim's bloodline against the killer's for `VENDETTA.TTL_MS` (7d; a
repeat kill refreshes; the heir is notified at birth; active vendettas ride the view via loadOwned,
joined to the target bloodline's CURRENT street). Grants (status + access, ZERO money flows — §10.4
untouched): (1) settlement — a revenge fire-kill inside the window closes the row, feeds the streets
(`vendetta_settled`), returns `vendetta: true`, and pays `VENDETTA.REP_BONUS` (2×) feared-rep; the
diminishing divisor counts the AVENGER's own prior kills of that bloodline (0 on a first revenge),
so a first revenge pays a ONE-TIME 2× base per feud direction and repeat trading decays 2/k —
audit-corrected description (founder dial: `priors+2` on vendetta kills makes revenge rep-neutral);
max(directed 1.5×, vendetta 2×), never a stack; (2) the `DIRECTED_MIN` floor is WAIVED posting a
directed KILL contract on your vendetta target (kill-ONLY per the audit — a waived hospitalize pot
would re-open the exclusivity squat; vengeance means a body). Refresh is UPDATE-then-INSERT (sweep-
race-proof).
`GET /v1/feud/:characterId` is the public blood-feud ledger (kill_log both ways, net `bloodOwed`,
active vendettas both directions). Worker sweeps lapsed rows (reads filter anyway). Tests: heir
inheritance + notification, ledger, waiver, 66-rep settlement (2× with 0 priors), the reverse debt,
lapsed-grants-nothing. TTL/bonus are cosmetic-axis founder levers (outside the signed economy).
**Step two — ESCALATION + THE SIT-DOWN + the blood-debt board — BUILT** (`src/social.js`, `src/rules.js`
`VENDETTA.TIERS`/`feudTierOf`, `schema.sql`, `test/social.js`; the deferred deepen — PURE STATUS,
§10.4-untouched by construction, conflict-forward). **(1) ESCALATION** — `vendettas.kills` counts how many
times the target's line has bled the avenger's; a repeat fire-kill in `runEstate` bumps it (`kills++`) and a
deeper feud carries a higher TIER (`VENDETTA.TIERS`: Vendetta → Blood Feud → War of Extinction, `feudTierOf`)
+ a longer TTL (`tier.ttlMult` 1 / 1.5 / 2 — access/timing only, off §10.4 + the sim-audited balance) so a
War of Extinction won't lapse from waiting — you must SETTLE it or sue for peace. The settlement `REP_BONUS`
(2×) is unchanged (the signed status lever). **(2) THE SIT-DOWN** (`proposePeace`/`acceptPeace`,
`POST /v1/feud/:targetId/peace` + `/peace/accept`) — a consensual, non-violent exit: one bloodline offers,
the other accepts to clear BOTH-direction vendettas + all offers between the pair (a fresh kill DELETEs any
pending offer — blood reopens the books). New `feud_peace_offers` table (account×account, both survive
death); gates `no_feud`/`no_offer`/`self`. **(3) THE BLOOD-DEBT LEADERBOARD** (`GET /v1/leaderboard/feuds`,
`feudLeaderboard`) — the deadliest ACTIVE feuds ranked by kills, each side the bloodline's CURRENT living
street (a line with no living character is skipped). The feud ledger (`GET /v1/feud/:characterId`) gained
`myVendetta.tier`/`.kills`, `theirVendetta {tier,kills}` (was a bool — the one existing test assertion
updated), and `peace {iOffered, theyOffered}`; the console Wet Work "feud" button became a sit-down UI
(offer/accept from the ledger popup) + `describe()` + the glossary. §10.4: zero money moves (the sim +
per-character checks stay drift-0); `feud_peace_offers`/`vendettas.kills` are account-level status.
`test/social.js` proves a real repeat-kill escalation (kills 1→2, Blood Feud tier, a stretched window), the
sit-down (propose/accept gates + the both-direction clear), and the leaderboard (the deadliest feud tops it
at its tier). Suite 31/31 + sim drift-0. All `VENDETTA.TIERS`/`ttlMult` numbers are cosmetic-axis founder
sign-off levers.

**Crew heists (THE BIG SCORE, step one) — BUILT** (`src/heists.js`, `test/heists.js` — the 11th
suite file; design `omerta-crew-heists-design.md`). The game's first CO-OP content: a leader picks
a job off `HEIST_JOBS` (rules tail: payroll 2-crew lvl8 → vault 3 lvl20 → fedtrain 4 lvl40) and
fronts the STAKE (`heist:crew:stake` sink, refunded whole only on pre-execution disband/stale-sweep
to a LIVING leader — corpse stakes stay sunk); crew joins off the open board (`GET /v1/heists`;
level-gated, one active heist per character, shares the solo `heist_at` cooldown); leader-only
execute rolls ONCE for everyone — `P = base + (avg crew stats − 30)/1000` clamp [.15,.92],
rng-audited. Success: pot = `rand(takePerLvl) × AVG crew level` (alt-dragging shrinks everyone's
take), split evenly with `HEIST_LEADER_WEIGHT` 1.2× to the leader, each share a per-character
`heist:crew` faucet (rides the existing `heist` cash-vocabulary prefix — check (a) reconciles);
fail: the WHOLE crew eats `jailS` together. **THE RAT**: any member silently flags during planning
(`POST /v1/heists/:id/rat`) — a ratted job auto-blows: the rat walks with `HEIST_RAT_BPS` (50% of
the stake, `heist:crew:rat` faucet — self-ratting is −EV by construction), the rest eat DOUBLE
jail, and the feed only ever says "somebody talked" (the rat is never named). Lock discipline:
leader (withCharacter) → member rows sorted → heist row; one-active-heist makes concurrent
executes disjoint (acyclic); members are paid/jailed by direct row updates under lock (never
in-memory — no clobber). Estate: memberships wiped, dead-leader plans abandoned. Worker sweeps
stale plans (per-heist txn, leader-before-heist lock order). The board uses two flat queries
(pg-mem can't parse correlated subqueries — the /v1/gangs precedent). NEW FAUCET: numbers are
sign-off levers (BALANCE.md addendum); per-member EV ~1.3–2.1× solo heist at the same cadence.
Suite 11/11 + sim drift-0. **Step two — BUILT**: every crew slot is a named ROLE (`HEIST_ROLES`
brains/muscle/wheelman/gun → stats; crew == roles length; plan/join take `role`, default first
open seat, `bad_role`/`role_taken` gates) and the success roll reads each member's stat FOR
THEIR ROLE (×3 — specialist crews match generalists, cheaper; respec gets a use). **The Inside
Job** (`inside`, crew 2 lvl 12, `crew_heists.target_business`): a co-op raid on a PLAYER's
business — pot = `rateBps` (60%) of the front's PENDING income redirected (`heist:inside`,
rides the `heist` cash prefix; the shakedown argument — owner keeps the rest, venue clock
advances by only the stolen share, NOT a new faucet); mark can't crew, family fronts omertà,
`businesses.inside_at` 24h venue lockdown win or lose (`HEIST_INSIDE_CD_MS`), mark notified
both ways. Audit-hardened: safehouse blocks plan/join/execute AND crew readiness (P1.3/D2); a
raid-eligible front (`scrutiny ≥ threshold`) refuses the job (`feds_watching` — no alt-crew
laundering of a hot front's pending income past the Bureau); execute locks member characters
SORTED **before** the heist row (re-verifying the crew under the lock, `crew_changed` on a
race) so characters-before-pots holds vs leave/join; the residual leader-first-vs-pairwise-PvP
deadlock maps 40P01 → a clean retryable `contention` error (game.js); THE RAT is now hauled in
WITH the crew (same double stretch — the public jail roster no longer outs the only free man;
the pay still lands); zero-pot inside jobs pay zero rep; the board joins `status='planning'`;
`UNIQUE(heist_id, role)`; member writes are absolute; a dead leader's stranded crew is
notified. Lock order: members → heist row → business row (terminal — the mark's CHARACTER row
is never locked, the convoy-manifest discipline). Deferred: timed windows, the fence phase.

**Smuggling convoys (step one) — BUILT** (`src/convoy.js`, `test/convoy.js` — the 12th suite file;
design `omerta-convoys-design.md`). Bulk goods on a real clock: `POST /v1/convoy` opens a shipment
at your district loading FROM the trunk (then `/load` — refill from the market between loads: the
manifest beats the trunk cap, the bulk unlock), `POST /v1/convoy/depart {guards}` picks a
`CONVOY.GUARD_TIERS` tier (none/crew $5k/heavy $20k — `convoy:guards` cash sink; the tier is never
public) and rides for `CONVOY.MS` (30 min; `CONVOY_MS` env is TEST-ONLY, the SEARCH_MS pattern).
The streets feed + `GET /v1/convoys` announce route + a VALUE BAND (never the manifest). ONE
ambush per convoy (win or lose): `POST /v1/convoy/:id/ambush` — energy + ammo (`convoy:` joined
the ammo vocabulary) + heat; owner/family/safehoused/jailed/hospitalized blocked; contest
`muscle + speed/2 + rand(30)` vs `guards + CONVOY.TURF_DEF (route touches the owner family's
turf) + rand(30)`; win takes goods up to the HIJACKER's trunk capacity (a pure ownership
transfer — goods aren't §10.4 currency; the remainder rolls on), lose = guards hospitalize the
attacker (`FAIL_HOSP_MS`). Arrival is lazy (`arrives_at`); the owner collects AT the destination,
trunk-capacity at a time. The ambush never touches the OWNER's character row (the manifest is the
contested object) — locks are characters → convoys, acyclic. Estate: a dead shipper's freight
scatters (`status='lost'`, cargo deleted). **pg-mem quirk discovered here: arithmetic UPDATEs on
INT columns (`SET qty = qty - $n`) mis-evaluate to `0 − n` — use absolute writes computed in JS
(the setCargo DELETE+INSERT precedent); NUMERIC columns are fine.** Numbers are sign-off levers.
Suite 12/12 + sim drift-0. **Step two — BUILT**: **destination tolls** — collecting at docks
held by ANOTHER family pays `TOLL_BPS` (5%) of the collected goods' base value from the
shipper's pocket to the holder's treasury (`convoy:toll`, a ledgered transfer on the tribute
pattern; treasury check (b) gained the term; clamped to pocket, never gates the freight);
**degrading multi-ambush** — up to `MAX_AMBUSHES` (3) HIJACKS per convoy, ONE attempt per
character (`convoy_ambushes` PK); only a WIN consumes a slot or wears `GUARD_WEAR_BPS` (25%)
off the guard tier's defense (audit: deliberate losses by throwaway alts must neither exhaust
the slots for real bandits nor strip the guards; turf/lockdown never wear; wear visible in the
rng-audit outcome; errors `once`/`spent`); **insured freight** — `depart {insure:true}` pays
`INSURE_BPS` (10%) of manifest value into the `convoy_insurance` pool singleton
(`convoy:insure`); a hijack stamps the lost value on `convoys.insured_loss` and the OWNER
claims `INSURE_PAYOUT_BPS` (50%) of it lazily AT COLLECT, capped at the pool AND at **the
UNDERWRITING LIMIT** — the account's lifetime premiums minus payouts (audit HIGH: pool-capping
alone let alt-hijack collusion skim honest premiums at 80%/cycle; with the limit a ring's net
extraction is ≤ 0 BY CONSTRUCTION; new §10.4 check `convoy insurance pool` = premiums −
payouts; the claim settles in the owner's txn because an ambush never touches the owner's row).
The toll reaches pocket THEN bank (banking doesn't dodge it), exempts by the DEPART snapshot,
and is charged only if the treasury credit lands (dissolution race). Jail gates
load/depart/collect; D2 blocks collect from a safehouse. Lock order: characters → convoys →
gangs → singletons. Deferred: NPC trucking. Step-two numbers are sign-off levers.
**Step three — NPC TRUCKING — BUILT** (`src/convoy.js`, `src/rules.js` `CONVOY.NPC`, `schema.sql`,
`src/worker.js`, `tools/sim.js` P9.17, `test/convoy.js`; the deferred item — gives the ambush loop a PvE
target so it's LIVE even when no players are shipping). The worker keeps `CONVOY.NPC.TARGET` (2) unmarked
NPC trucks on the road: `spawnNpcConvoys` tops the road up (a random route + a modest goods manifest
`NPC.MIN_QTY`..`MAX_QTY` of a `NPC.GOODS` line + a random guard tier), `despawnArrivedNpc` removes an
arrived NPC truck (the driver delivered — its remaining freight leaves the world, no faucet on a delivered
truck; both wired into worker.js). An NPC convoy is an `owner_character=NULL, is_npc=true` `convoys` row —
players hijack it through the SAME **`ambushConvoy`** (the NULL owner already passes the own/family gates;
only the two owner-`notify` calls needed a NULL guard). A hijack transfers the goods to the raider's trunk
(the existing ambush transfer) — **the goods are the one new faucet** (sold via the market), bounded by
`TARGET × lifetime × the manifest × hijack-success × the trunk cap`, **measured (P9.17): ~$216k/day
base-wide realistic (50% hijacked) / ~$433k ceiling** — at boxing/territory parity, the World-raid
precedent (a bounded shared PvE faucet). §10.4: NO new reason — NPC goods ride the existing goods economy
(goods aren't a §10.4 currency; the sale is the existing market faucet; the sweep stays drift-0). Schema:
`convoys.owner_character` is now NULLable + `is_npc BOOLEAN`. The board (`GET /v1/convoys`) surfaces NPC
trucks as ambush targets (`npc:true`, owner "an unmarked truck") alongside player convoys; the console
Big Scores tab renders them (a 🚚 unmarked-truck card with the NPC chip). `test/convoy.js` covers the
worker topping the road to TARGET (no over-spawn), an NPC truck on the public board, a deterministic hijack
landing goods in the raider's trunk with no owner to notify (the NULL-owner path never crashes), and an
arrived NPC convoy despawning with its cargo. Suite 31/31 + sim drift-0. All `CONVOY.NPC.*` are founder
SIM sign-off levers — the one new (bounded) faucet (BALANCE.md); `TARGET`/manifest size are the dials if
the base-wide magnitude wants trimming. The Convoy pillar is now feature-complete (bulk shipping → tolls +
multi-ambush + insurance → NPC trucking).
A focused red-team (`AUDIT-convoy-npc-trucking.md`: §10.4/faucet, NULL-owner ambush, spawn/despawn
concurrency, cross-system) returned **no CRITICAL/HIGH** — §10.4 invisible + bounded (no goods-conservation
check, `goods:` already vocabularied; the faucet is one-manifest-per-convoy × TARGET/lifetime turnover ×
trunk cap, the real per-player bound being ENERGY not the base-wide ceiling), the NULL-owner ambush path
crash-free (every owner ref NULL-safe), and cross-system contained (an NPC convoy can't be collected/tolled/
insured, doesn't count against the one-convoy cap, needs no estate handling, and the sweeps filter strictly
on `is_npc`). Fixed one **LOW** (hardening): `despawnArrivedNpc` did three non-atomic deletes → now one txn
per truck. Clarified the P9.17 measurement (the base-wide ceiling vs the real per-player ENERGY throttle;
`MAX_AMBUSHES` raiders split one manifest so contention dilutes). Flagged (sign-off): the faucet magnitude +
the single-worker spawn TOCTOU (self-correcting, the world-raid precedent).

**The Commission (step one) — BUILT** (`src/commission.js`, `test/commission.js` — the 13th suite
file; design `omerta-commission-design.md`). Server-wide player politics with ZERO money flows —
pure status + rule modifiers, so §10.4 is untouched by construction. The top `COMMISSION.SEATS` (5)
families by standing (`lifetime_tribute + 10000×wars_won`) hold seats — seats are recomputed live
on every read, never stored. Each seated family's boss/underboss casts ONE PUBLIC vote per week
(`POST /v1/commission/vote`, upsert on `commission_votes (week, gang_id)` — changeable all week,
visible on the board). The decree governing week W is the MAJORITY of week W−1's votes, tallied
LAZILY on read (`activeDecree` — the §7.1 pattern, no cron); a tie or silence deadlocks (no decree).
Four decrees, each exactly ONE touchpoint: **open_season** (safehouse stays ×`OPEN_SEASON_MULT` 0.5
in `enterSafehouse`), **pax** (`declareWar` throws `'pax'` — existing wars run on), **amnesty**
(`layLow` cost ×`AMNESTY_MULT` 0.5, the discounted number is what's ledgered), **lockdown**
(`ambushConvoy` defense +`LOCKDOWN_DEF` 20, surfaced in the rng_audit outcome string).
`GET /v1/commission` is public: seats, this week's votes, the active decree (+`lapsesSeconds`), the
decree book. Decree modifiers are NEW founder sign-off levers — they're temporary weekly modifiers
ON signed BALANCE.md levers, not retunes. Tests: seat order + the sixth family shut out, vote gates
(rank/no_seat/bad_decree), cast + public change, majority tally + tie deadlock, all four touchpoints
(safehouse halved, war blocked, laylow half-price ledger-exact, lockdown visible in the audit trail),
vocabulary closed. Suite 13/13 + sim drift-0. **Step two — BUILT (audit-hardened)**:
**standing-ranked ballots** — a vote stamps the family's STANDING at cast
(`commission_votes.standing`; re-cast refreshes; the tally freezes with the week); `activeDecree`
ranks the week's frozen ballots by the stamp, counts only the top SEATS of them, and derives
weights 5..1 from the rank — the electorate is BOUNDED at the seat count (audit: weight-at-cast
let transit families keep counted ballots and leapfrogging stack multiple 5s), stale head
ballots rank where they belong, weighted ties deadlock; a DISSOLVED family's ballots are deleted
with it (no ghost governance; the board and tally always agree); seat sort tiebreaks on id;
vote/veto upserts race-safe (clean `again`/`vetoed`, no PK 500s); **the veto** — the head seat's
BOSS (only; not the underboss) kills the decree in force once per week (`commission_vetoes`
week-PK; `POST /v1/commission/veto`; errors rank/head/no_decree/vetoed), public on the board
(`veto`, LEFT JOIN — a vetoing family that later dissolves stays on the record) + the streets
feed, and the dead decree's touchpoints go inert immediately. Zero money, §10.4 untouched.
Founder flag (audit): standing = lifetime tribute is purchasable at ~zero net cost and never
decays — the head seat + veto monopoly are a wealth ladder. Deferred: proposals with deposits,
the Commission tax.

**Content-drop audit (`AUDIT-content-drops.md`)** — five red-team lenses over everything shipped
after AUDIT-sim (vendettas, heists, convoys, Commission + step twos, cross-system). Fixed
in-commit (regressions added): Commission ghost votes + unbounded electorate (→ the
standing-ranked tally above), convoy insurance collusion (→ the underwriting limit), ambush
slot-exhaustion (→ wins-only cap/wear), toll bank-dodge + dissolution-race drift + snapshot
exemption, heist safehouse gates + `feds_watching` + execute lock order + rat anonymity
(jailed with the crew) + zero-pot rep, vendetta waiver kill-only + sweep-race refresh, and the
bounty sweep's dead funder-pre-lock predicate (`funder_gang IS NULL` on a NOT NULL column —
the pots→characters inversion was still live). 40P01 now maps to a clean retryable
`contention` error in both game.js wrappers. NOT patched (founder calls, ranked in the
report): purchasable Commission standing, vendetta first-revenge 2× (docs corrected to match
code; dial = priors+2), insurance remainder forfeiture, omertà gang-churn, open-season
entry-time semantics, leader-rat griefing. The sim's P9.7 heist probe measured the co-op
faucet at 1.46× solo per member (design band 1.3–2.1×) — BALANCE.md marked KEEP. `forge test`
STILL never executed (Foundry hosts 403-blocked here) — must run before the third-party audit.

**Full-system max-effort audit (`AUDIT-full-system.md`)** — six independent red-team lenses over
the ENTIRE codebase (§10.4/economy, PvP/death/locks, income loops/casino, chain+contracts,
auth/infra/limits, cross-system exploit chains). No §10.4 drift, no auth bypass, no injection, no
reserve double-spend, no forgeable voucher; extraction ≤ inflow holds. Fixed in-commit (regressions
added): **zombie gang** (`removeMember` now `SELECT … FROM gangs FOR UPDATE` before the last-member
check — concurrent 2-member departures could orphan a family: stranded treasury/turf/territory,
never `gang:dissolved`-ledgered = permanent treasury drift); **expired-voucher reclaim**
(`reclaimExpiredVouchers`, a worker sweep — refunds a signed-unclaimed OMR voucher's burned $OMR and
frees its permanently-stuck reserve capacity, and restores optimistically-removed gear to play;
grace window > watcher lag, `markClaimed` guards `status<>'expired'`, `+withdraw:omr` reverses the
burn net-0); **post-commit referral masking** (`maybeQualifyReferral` wrapped so a post-commit throw
can't surface a non-2xx after the action committed → idempotency-release → retry double-spend);
**`mod/confiscate` negative-amount mint** (clamped `[0,pocket]`; §10.4-invisible into the unaudited
`street_tax.pool`); **worker per-job isolation** (`safe()` — a poison row no longer starves the
nightly §10.4 drift monitor); **mod-kill 40P01→contention** (`deadlockToRetry` exported + applied to
the hand-rolled txn, matching the war-partner AB-BA the wrapped paths already handle); **estate
floored cash+bank** (now ledgers the EXACT `cash+bank` — the sub-cent bank-interest drift class,
reintroduced at the death boundary; sim is the regression); plus LOWs (timing-safe `MOD_KEY`,
per-pot bounty-sweep isolation, `walletVerify` uniqueness→clean `wallet_taken`, launder/shakedown
heat clamp). NOT patched (founder calls, ranked): purchasable standing × family-contract cashout
(~2% cost for head-seat/veto), casino unbacked faucets (street-tax mint-on-top + rakeback), the
Sybil-scalable fight fix, SIWE/X replay surface. `forge test` STILL not run (Foundry egress-blocked)
— must pass before the third-party audit. Suite 13/13 + sim drift-0.

**The Black Market (step one) — BUILT** (`src/market.js`, `test/market.js` — the 14th suite file;
design `omerta-market-design.md`). P2P trade at last: **cars by AUCTION** (one standing bid per
listing, raises beat it by `MIN_RAISE_BPS` 5%, optional buy-now instant settle; the outbid player
is refunded inline via the heist-execute lock pattern — counterparty read-unlocked → locked →
re-verified under the listing lock, `again` on a race) and **trade goods FIXED-PRICE with
DISTRICT-PINNED pickup** (buyer must stand at the listing's dock with trunk space, partial buys —
the market must NOT teleport freight past the convoy game). GEAR deliberately excluded (its market
IS the on-chain GearVault rail); cb/ammo stay on the M3 Exchange. Escrow: cars flag `cars.listed`
(the ROW stays — car conservation counts rows; melt/fence/repair refuse listed iron via findCar;
CHOP still values it, else a marked man warehouses his fleet pre-hit); goods deduct from the trunk
into the listing (the freed space is priced by the `LIST_FEE_BPS` 1% listing fee and bounded by
`MAX_LISTINGS` 3; reclaim is trunk-space-gated, the convoy-cancel rule). §10.4: `market:` cash
vocabulary (`list` sink; `bid` in; `refund`/`sale`/`take`/`death` out) + the new **market escrow**
check — standing bids on live listings == posted − refunded − sales − takes − deaths; the 2% take
is carved FROM the hammer (half street tax, half burns, ONE character_id-NULL `market:take` row)
— never minted on top (the audited casino pattern is the anti-precedent). Death: `voidListingsAtDeath`
(bids refunded; killer-as-bidder threads killerCh — the refundPot discipline) + `burnBidsAtDeath`
(`market:death` NULL rows, the dead-funder precedent) in runEstate. Worker `sweepMarket` hammers
expired auctions (chars sorted → listing, per-listing txn) and lapses the rest for pull-based
reclaim. Routes: `GET /v1/market` (public), `POST /v1/market`, `/v1/market/:id/bid|buy|cancel`.
Jail gates all mutations; no safehouse gate (shopping is neither offense nor extraction — P1.3/D2
untouched). `BLACK_MARKET` rules-tail block (NOT `MARKET` — that's the generated goods catalog);
all numbers founder sign-off levers. Tests: gates/fees/floors, escrow guards, full auction
lifecycle (floor/raise/outbid-refund-exact/self-raise-diff/buy-now/expiry-hammer), goods
dock+clamp+partial+reclaim, death both sides, escrow check + vocabulary. Suite 14/14 + sim
drift-0. **Step-one levers SIGNED 2026-07-17. Step two — BUILT**: **hidden reserves** (cars —
between minBid and buyNow; under it the sweep refunds the bidder and lapses for reclaim; the
board shows only `reserveMet`, never the amount), **anti-snipe soft close** (a bid inside
`SNIPE_WINDOW_MS` 5 min resets the clock to a full window), and **standing BUY ORDERS** (WTB,
kind='order' on the same table): the buyer escrows qty×price at THEIR dock (`market:order`, +
the 1% fee; orders share MAX_LISTINGS), sellers standing there fill from the trunk and are paid
on the spot (`market:fill` via paySeller's `inMemoryCh` — the seller IS the actor, an SQL credit
would clobber), delivered goods wait in `filled_qty` (the WAREHOUSE) until the buyer claims into
trunk space — claimable even after cancel/expiry (paid for; they scatter only with the estate).
Cancel/expiry refund the UN-FILLED escrow (`market:refund`); a dead poster's escrow burns
(`market:death`, voidListingsAtDeath). The escrow check gained the order side: live bids + live
order balances (qty×price summed in JS — pg-mem SUM-over-expression is dicey) == posted
(bid+order) − refunds − nets (sale+fill) − takes − deaths. Fill locks only actor + order row
(the buyer's character is never touched). Routes: `POST /v1/market/order`,
`/v1/market/:id/fill|claim`. Step-two numbers are sign-off levers. Still deferred: goods
auctions proper, the gear-market design call. Suite 14/14 + sim drift-0.

**Skills & Specializations — BUILT** (`src/skills.js`, `test/skills.js` — the 15th suite file;
design `omerta-skills-design.md`). The character BUILD layer: three branches × three tiers
(`SKILLS.TREE` rules tail — Enforcer: bruiser/doctors_friend/executioner; Operator:
fast_talker/fence_network/broker; Wheelman: pack_mule/getaway/road_captain), tier costs 1/2/3
points with the previous tier as prerequisite; points DERIVE from level (`floor(lvl/4)` — never
stored, no currency, no §10.4 surface), so one maxed branch = lvl 24, two = lvl 48. Skills DIE
WITH THE STREET (`character_skills` joined the estate wipe — like stats, unlike prestige);
respec burns `RESPEC_OMR` 10 (`respec:skills`, the omr burn term widened to `respec%`) on the
SHARED M8 respec cooldown (`characters.respec_at`, M8.RESPEC_CD_MS). Every effect is a NEW
single-touchpoint modifier read via game.js `hasSkill`/`skillMult`/`trunkCap`, deliberately OFF
the audit-locked surfaces (no heat-deterrent discounts, no loot-exposure windows, no extraction
caps, no kill economics, no signed accrual curves): bruiser ×1.08 on jump+shakedown attack;
doctors_friend heal ×0.75; executioner search clock ×0.8 (applied at BOTH the hunter's clock
sites — startSearch placedAt AND fire's readiness — so they agree, composing with the TEST-ONLY
SEARCH_MS knob); fast_talker laylow ×0.8 (stacks multiplicatively with the amnesty decree);
fence_network fence+melt yields ×1.08; broker Black Market listing fees ×0.5; pack_mule trunk
+3 (via `trunkCap(h)` — swapped in at every player-trunk site: goods buy, market buy/claim/
reclaim, convoy load/hijack/collect); getaway crime stints ×0.8; road_captain own convoys ×0.8
time. `GET /v1/skills` (board), `POST /v1/skills/:id`, `POST /v1/skills/respec`; view carries
`skills` + `skillPoints` + skill-aware `cargoCap`. ALL numbers (FX + costs + LVL_PER_POINT) are
founder sign-off levers — sim before production. Suite 15/15 + sim drift-0.
**Step two — BUILT** (`src/skills.js`, `test/skills.js`; three of the four deferred items — everything
but prestige-carried slots, which stays a founder call since it would soften death). **TIER-4 CAPSTONES**
(`SKILLS.TREE` grew 9→12, `CAPSTONE_COST` 4 → the tier-3 skill is the prereq, so a full branch = lvl 40 /
10 points): `made_man` (jumps+shakedowns another ×`MADE_MAN_MULT` 1.08 — stacked at the jump/shakedown/
standover atk sites), `kingpin` (fence+melt another ×`KINGPIN_MULT` 1.08 — stacked in economy.js), `road_boss`
(trunk +`ROAD_BOSS_TRUNK` 3 via `trunkCap`) — each a straight multiplicative stack on its branch's signature,
the prereq chain guaranteeing the base skill is owned (the same `skillMult` mechanism as tier-1). **ACTIVE
ABILITIES** (the new mechanic, `SKILLS.ACTIVES` + `activeOf`): a capstone unlocks a resource/cooldown BURST
on a SHARED cooldown (`ACTIVE_CD_MS` 8h, `characters.active_at`, written by DIRECT SQL so it survives the
60-param `persistCharacter` positional UPDATE) — `adrenaline` (made_man → energy to the level-scaled cap),
`moxie` (kingpin → nerve to cap), `hot_wire` (road_boss → clears `heist_at`+`world_raid_at`, which DO ride
persist). Deliberately OFF every §10.4 + audit-locked surface (energy/nerve are pure regen; heist/world
cooldowns are op pacing, never `jail_until`) → zero ledger surface. **PER-SKILL RESPEC** (`respecOne`,
`POST /v1/skills/respec/:id`): unlearn ONE skill LEAF-FIRST (a dependent tier+1 in the branch blocks it) for
`RESPEC_ONE_OMR` 5 (< the full `RESPEC_OMR` 10 wipe), on the SHARED M8 `respec_at` cooldown, ledgered
`respec:skills` (rides the existing respec omr vocabulary — zero invariant change). Routes
`POST /v1/skills/active/:ability`, `POST /v1/skills/respec/:id`; the board gained `actives` (with `unlocked`)
+ `activeCooldownSeconds` + `respecOneOmr`; console: capstones auto-render (t4 chip), per-skill unlearn
buttons on known skills, an Active Abilities card (unlocked-only, cooldown-gated). `test/skills.js` covers the
12-skill board, the capstone's level-40/10-point gate, the active-ability gates (bad_active/locked/cooldown) +
the energy burst to the level-scaled cap, and per-skill respec (leaf-first `dependent`, `not_known`, ledgered,
shared cooldown). Suite 30/30 + sim drift-0. `MADE_MAN_MULT`/`KINGPIN_MULT`/`ROAD_BOSS_TRUNK`/`CAPSTONE_COST`/
`ACTIVE_CD_MS`/`RESPEC_ONE_OMR` are founder sign-off levers. Still deferred: prestige-carried skill slots (the
founder call — it would soften death).
**Step three — PRESTIGE CARRIES INTO THE BUILD — BUILT** (`src/skills.js`, `src/social.js`, `src/rules.js`
`SKILLS` tail, `test/skills.js`; the deferred founder call — it softens death, so a SIGN-OFF lever, not pure
status). Prestige (the account-level death legend) now grants a small BUILD head start on a new street — NO
currency, NO §10.4 surface (skill points are derived/never stored; carried skills are a pure ownership move).
**(1) PRESTIGE POINTS** — `pointsOf(ch, owned, prestige)` adds `min(PRESTIGE_POINT_MAX 3, floor(prestige/
PRESTIGE_PER_POINT 10))` bonus skill points on top of the level-derived budget (surfaced as
`points.prestigeBonus`/`fromLevel`); a small edge (≤3 extra points = one extra tier-3 skill), NOT a level
skip (the tier prereq chain still gates a maxed branch at lvl 40). Threaded through `learnSkill`/`respecOne`/
`respecSkills`/`skillsBoard` via `h.acct?.prestige`. **(2) MUSCLE MEMORY** — `runEstate` (social.js) captures
the deceased's loaded `h.victimOwned.skills` BEFORE the `character_skills` wipe and, after the heir INSERT,
carries a **lowest-tier-first PREFIX** (`rememberedSkills` in skills.js — `min(MEMORY_MAX 3, floor(priorPrestige/
PRESTIGE_PER_SLOT 8))` slots, sorted tier-ASC so the prefix is prereq-safe by construction). Read from the
bloodline's **PRE-death accumulated prestige** (`priorPrestige`, captured before the `+legacy` bump) — so a
FRESH line's skills still fully die (the first death of a lvl-25 street inherits 0 memory since prestige is 0
then). `report.kept.skills` on the estate report; the board surfaces `prestige`/`memorySlots`/`memoryMax`/
`prestigePerSlot`/`prestigePerPoint` + a console "Bloodline" line on The Life tab. Skills still DIE with the
street (this is a head start, not survival); `MEMORY_MAX 0` / `PRESTIGE_POINT_MAX 0` reverts to the hard rule.
`test/skills.js` proves the bonus points (prestige 24 → +2, total 8 @ lvl 25), the 3-slot muscle-memory carry
(the heir born knowing the three tier-1 basics — the tier-2s die), and that a prestige-0 line stays unschooled
(the `wil` estate case). Suite 32/32 + sim drift-0. `MEMORY_MAX`/`PRESTIGE_PER_SLOT`/`PRESTIGE_PER_POINT`/
`PRESTIGE_POINT_MAX` are founder sign-off levers (they soften death — flagged in BALANCE.md).

**RANDOMIZED BUILDS + THE PAID RE-ROLL (0.01 ETH) — BUILT** (`src/rules.js`, `src/server.js`, `src/fees.js`,
`schema.sql`, `omerta-contracts/`, `public/index.html`, `test/chain.js`; founder-directed 2026-07-21).
**(1) Randomized starting stats** — every fresh character now `rollStats()`s a UNIQUE muscle/cunning/speed
distribution instead of the flat 5/5/5 (server-authoritative, rng_audit'd `roll_stats`). **Total-conserved**
(`CONSTANTS.CREATE_STAT_MIN` 3 / `CREATE_STAT_TOTAL` 15 — each stat floors at 3, always sums to 15) → ZERO
power creep (same budget, only the SHAPE varies → the sim-audited stat economy is untouched; sim drift-0,
suite 32/32). No two characters the same. The M8 `/v1/respec` still conserves the character's OWN total
(a 9/3/3 build respecs toward the ≥5-floored middle — the documented rebalance). **(2) The paid re-roll** —
`POST /v1/character/reroll` spends a `reroll_credit` to re-roll the living build (total-conserved, rng_audit'd
`reroll_stats`, **infinitely repeatable** — each needs a fresh paid credit). Credits come from a 0.01-ETH
on-chain fee following the EXACT mint/respawn machinery: `fees.js:recordFeePayment` accepts the new `reroll`
kind → `reroll_credits += 1` (idempotent on `fee_payments.nonce`, pay-before-link reconciled); the on-chain
`OmertaFees.payRerollFee()` mirrors `payMintFee` (exact-value, CEI + nonReentrant, ETH straight to the dev
wallet, monotonic nonce; `rerollFee` defaults to `mintFee` 0.01 ETH, owner-tunable via `setRerollFee`); the
watcher (`watcher.js`) reads `RerollFeePaid`. **§10.4-NEUTRAL by construction** — a re-roll writes ZERO
`transactions` rows (it only redistributes a fixed stat budget; the ETH is out-of-band, the fees.js
precedent — no new reason/bucket/vocabulary). `rerollCharacter` locks the CHARACTER row first then the
account (canonical `characters→accounts` order — a red-team MED fix: the original account-first lock risked
a lost-update clobber + an AB-BA vs `withCharacter`). `feeStatus`/the view surface `rerollCredits` +
`statTotal`; the console sheet shows the base build + a re-roll button (when a credit is in hand) +
`describe()` humanization; the raw deck gained `/v1/character/reroll`. `OmertaFees` compiles clean (solc
0.8.26) with new Foundry tests (`forge test` the pre-mainnet gate, egress-blocked here). `test/chain.js`
covers the randomized 15-point creation, the paid re-roll (credit → spend → total conserved → consumed →
next needs another payment) + fee idempotency. A red-team (`AUDIT-skills-prestige-and-reroll.md`) returned
no CRITICAL/HIGH — the one MED (the re-roll lock order) fixed in-commit. `CREATE_STAT_MIN`/`CREATE_STAT_TOTAL`
+ the 0.01-ETH fee are founder sign-off levers (total-conserved → no §10.4/sim change; the spread is a
build-identity dial, not a power dial).

**Skills step four — GRANDMASTERY — BUILT** (`src/rules.js`, `src/skills.js`, `test/skills.js`,
`public/index.html`; the capstone-of-capstones endgame). Owning BOTH tier-4 capstones of a pair (the
deepest build — two fully-maxed branches, ~lvl 48 for 20 points) DERIVES a **Grandmastery** (no cost —
the natural reward, `SKILLS.GRANDMASTERIES`: The Boss = made_man+kingpin, The Warlord = made_man+road_boss,
The Shadow = kingpin+road_boss) that unlocks a combined ULTIMATE active (`useActive` extended:
`kingpins_rush` energy+nerve, `full_throttle` energy+op-cds, `ghost_protocol` nerve+op-cds — both bursts in
ONE cast, where the two single actives share a cooldown so you'd otherwise pick just one) AND cuts the
shared active cooldown (`GRANDMASTER_CD_MS` 4h < `ACTIVE_CD_MS` 8h, via `activeCdFor`). Pure QoL/pacing on
the step-two active mechanic — energy/nerve are regen resources, heist/world cooldowns are op pacing → ZERO
section-10.4, off every audit-locked surface (sim drift-0, suite 32/32). DERIVED from OWNED capstones, so the
heir only gets it by re-earning both (muscle memory carries tier-1 only) — no death-softening. Helpers
`grandmasteriesFor`/`ultimateOf`/`activeCdFor`; the board surfaces `grandmasteries` (with `unlocked` + the
ultimate), `grandmaster`/`grandmasterTitles`, `activeCdSeconds`; the console Life tab renders unlocked
ultimates (gold cards) + a locked-grandmastery hint. `test/skills.js` proves the two-maxed-branch unlock
(The Boss), the locked-ultimate gate (The Warlord without road_boss), the combined burst (energy AND nerve
to the level-80 cap), and the shorter grandmaster cooldown. `GRANDMASTER_CD_MS` + the pairings are founder
sign-off levers (pure pacing — `GRANDMASTER_CD_MS = ACTIVE_CD_MS` reverts the edge). The Skills pillar is now
feature-complete (3×3 tree → capstones + actives + per-skill respec → prestige carry → grandmastery).

**The Underworld (step one) — BUILT** (`src/underworld.js`, `test/underworld.js` — the 16th suite
file; design `omerta-underworld-design.md`). Named NPCs as RELATIONSHIPS — skills are what you are,
the Underworld is who you know. Four fixtures, one per loop (`UNDERWORLD` rules tail: Doc Moretti /
survival, Vinnie the Match / PvP-contracts, Bella Bang-Bang / gear, Big Tuna / trade). Per-character
standing 0–100 (`npc_standing`, loaded into `h.owned.npc`), a pure STATUS axis earned ACTOR-SIDE at
the loop's touchpoints via game.js `bumpStanding` (heal +2, gun +3, craft +1, ammo box +1, contract
post +3, NPC hit +4, fire-kill +5, convoy depart +2 / collect +3, listing/order +1); **gifts**
($5k `underworld:gift` sink, +5) work ONLY below GIFT_CAP 50 — the top tiers are earned (the
purchasable-standing critique answered structurally). Tiers at 25/60/90 read via `npcTier`/`npcMult`;
every perk is a NEW single-touchpoint modifier (skills/decree precedent), the DISCOUNTED number
always the one ledgered: Doc T1 heal ×0.9 (stacks with doctors_friend ×0.75), T2 **early discharge**
(`underworld:discharge` sink, remaining-minutes × $150, stay halved), T3 discharges release in full;
Vinnie T1 NPC hitmen ×0.9, T2 contract-post FEE waived (street tax stands; postBounty line only,
never postFamilyContract), T3 searches place ×0.9 (composed with executioner at BOTH clock sites via
`hunterSearchMs` → 0.72 stack, flagged); Bella T1 guns ×0.9 cash (crates stand), T2 crafts ×0.9
(stacks with foundry 0.75), T3 **gun buyback** at 30% of sticker (`underworld:gunsale` — the only
new FAUCET, small + bounded (once per owned gun), flagged for the sim pass); Big Tuna T1 convoy
guard fees ×0.9 (tier.def unchanged), T2 Black Market listings/orders run 72h (vs 48), T3 a fourth
listing slot. Deliberately UNTOUCHED: $OMR burns, ammo prices (D1 kill-EV anchor), heat deterrents,
loot-exposure windows, extraction caps, income curves. Standing DIES WITH THE STREET (`npc_standing`
joined the estate wipe); `underworld:` joined the cash vocabulary (all rows character_id'd — check
(a) reconciles). Routes: `GET /v1/underworld`, `POST /v1/underworld/:npc/gift`,
`/v1/underworld/discharge`, `/v1/underworld/gun/:gunId/sell`. One pre-existing test rewired:
social.js's looped NPC-hit refund probe now asserts `res.cost` (the hirer legitimately earned
Vinnie T1 across ~100 hires). ALL numbers are founder sign-off levers — sim before production.
Suite 16/16 + sim drift-0. **Step two — BUILT** (`UNDERWORLD.STEP2` rules tail; zero new money
flows — status/access/pacing only, §10.4 untouched by construction): **the Madame** (fifth
fixture, den loop — dice +1/numbers +1/fade +3/fight bet +2 actor-side in casino.js; T1 comped
seat = dice cost no nerve (a sink amplifier), T2 velvet rope = high-stakes room at any level
(access only, odds untouched), T3 pillow talk = the board counts hunters with a search out on
you — a COUNT, never a name, so the $OMR peek stays the only name-piercer); **the daily LEAD**
(`npc_leads` day-PK; the first business bump each day with your BEST fixture (≥ LEAD_MIN 25)
pays +5, once — gifts pass `business:false` and never claim it, implemented inside game.js
`bumpStanding` so all 20 touchpoints participate); **standing DECAY** (lazy §7.1 —
`npc_standing.touched_at`; past 7 idle days standing cools 1/day toward floor 25 = tier 1,
never below; the EFFECTIVE value is computed at loadOwned and is what perks read; the stored
row catches up on the next bump — writes are absolute-from-effective); **RIVALRY** (fire-kill
and NPC hire cost the Doc −2 — one legible pair); **BLOODLINE MEMORY** (runEstate captures
standings pre-wipe and the heir inherits floor(25%) each, sub-1 forgotten, `kept.memory` in
the estate report — MEMORY_BPS 0 restores hard death; at 25% a maxed street hands down ~22,
below tier 1). Board (`GET /v1/underworld`) gained `lead`, `decay`, and (Madame T3 only)
`whispers.asking`. Tests: madame tiers, lead (gift-doesn't-claim, once/day, off-lead pays
flat, strangers get none), decay (37/floor-25/below-floor-inert + materialize-on-bump),
rivalry, memory (heir standings computed from pre-death board). Suite 16/16 + sim drift-0.
**Step three — BUILT** (`UNDERWORLD.STEP3` + `tasks` on the cast; zero money, §10.4 untouched):
**rotating lead TASKS** — the daily lead is a specific job drawn per day per fixture off the
§7.11 seed (`leadTaskOf`, same draw town-wide); `bumpStanding` gained an `action` tag at every
touchpoint call site and the bonus claims only when the bump's action matches the draw;
task lists hold only always-repeatable actions (heal; post/hire; craft/ammo; depart/list;
dice/numbers) so no day draws a dead lead; board `lead.task`. **Rivalry #2** — a convoy ambush
ATTEMPT (win or lose) pays Bella +2 / costs Big Tuna −2 (`convoy.js:ambushConvoy`). **GRUDGES**
— `social.js:bearGrudges`: killing a victim whose effective standing with a fixture ≥
GRUDGE_MIN 60 docks the killer (fire) or the PAYER (npcHit) GRUDGE_LOSS 5 with that fixture
(read from `h.victimOwned.npc` BEFORE the estate wipe; mod-kills bear none; `grudges` on the
kill response; losses echo down the killer's bloodline via step-two memory). Tests: drawn-task
lead (off-task pays flat, task claims, once/day), ambush rivalry both directions, grudge kill
(friends ≥60 grudge / acquaintance forgives / stranger floors at 0 / Vinnie never grudges /
exact −2×attempts−5 arithmetic). Suite 16/16 + sim drift-0. **Step four — BUILT**
(`UNDERWORLD.STEP4`): **grudges with teeth** — `npc_grudges` (count per fixture, loaded into
`h.owned.grudges`) caps `npcTier` at GRUDGE_TIER_CAP 2 while any grudge is open (standing 95
reads tier 2 — business yes, favors no; every T3 perk site inherits the cap), recorded by
`bearGrudges` (absolute count writes — the pg-mem INT-arithmetic quirk), wiped at estate (the
fixtures forgive the dead; the standing loss still echoes via memory); **penance**
(`POST /v1/underworld/:npc/penance`, `underworld.js:payPenance`) squares ONE grudge for
PENANCE_COST $25k — a ledgered `underworld:penance` sink riding the existing vocabulary
prefix (zero invariant changes), no standing moves; **the weekly favor**
(`POST /v1/underworld/:npc/favor`, `claimFavor`; `npc_favors` week-PK, one per street per
week, tier-3 required POST-cap so a grudged fixture refuses): resource packages only — doc
health→100, madame nerve→cap, harbor energy→cap, armorer repairs the WORST car (throws
'nothing' BEFORE consuming the week), fixer always 'debts' — never money, no §10.4 surface;
**lead streaks** — `npc_leads.streak` (yesterday's + 1), bonus = LEAD_BONUS + min(streak−1,
STREAK_BONUS_CAP 5), so day 6+ pays +10; notify carries bonus+streak. Board gained `penance`,
`favor.taken`, per-fixture `grudge`. Tests: board grudge counts, tier-cap at 95, penance
(ledgered/squared/clean), favor (all four packages, one-per-week, refused-errand keeps the
week, debts, stranger gate), streak (+2 on day 3, capped +5 on day 10, row advance).
Suite 16/16 + sim drift-0. **Step five — BUILT** (`UNDERWORLD.STEP5`; zero new money):
**grudge decay** — `npc_grudges.since`; one grudge forgiven per GRUDGE_DECAY_DAYS 14 since the
last write (fresh offense or penance restarts the clock); lazy — loadOwned computes the
EFFECTIVE count (what the tier cap reads), writes materialize it, penance settles the
effective count so you never pay for what time healed; **the errand chain**
(`npc_errands` character-PK; `POST /v1/underworld/:npc/errand`, `startErrand`): a tier-1+
fixture hands a storyline — do their DRAWN daily task on CHAIN_STEPS 3 separate days (one
step/day via `last_day`, advanced inside `bumpStanding` for ANY fixture you took the job
from, not just your best) → CHAIN_BONUS +15 + streets feed; one active chain per street,
restarting replaces the half-done job; board `errand {npc, step, of, task, doneToday}`;
**rivalry #3** — `fixFight` costs the boss FIX_LOSS 5 with the Madame (a status tax on the
Sybil-flagged fix; den money untouched). Honest calls: favor MENUS absorbed (the step-four
favor already is one — no fake strict-upgrade choices), vendetta-refusal deferred (hot-path
join + poor legibility; documented in the design doc). Tests: decay (2@15d→1, 1@30d→0,
uncapped tier, penance-on-effective + materialized row, clean), errand (stranger gate, task
match, no double-step/day, 3-day completion +15, notify, replace), fix rivalry (in
test/casino.js, −5 exact). Suite 16/16 + sim drift-0.

A four-lens red-team over the Black Market / Skills / Underworld drops
(`AUDIT-market-skills-underworld.md`) then closed a CRITICAL (`buyListing` had no kind guard —
buying a buy-ORDER fell into the goods-sale branch and MINTED un-escrowed goods + drifted the
market-escrow check; now `kind!=='good'` throws `not_for_sale`) and six correctness fixes
(`decayedGrudges` clock-skew phantom grudge → days clamped ≥0; Broker undercut `LIST_FEE_MIN` →
floor re-asserted after the discount; `discharge` missing the jail gate; the armorer favor
free-repairing a market-LISTED car; "Vinnie never grudges" was docs-only → `bearGrudges` skips
`fixer`; a capped-100 bump not re-stamping `touched_at`). The ledger + concurrency lenses found no
new HIGH/CRITICAL (market escrow, lock order, persist-clobber, death paths all verified clean).
The founder then approved a five-item balance package (all BUILT, sign-off levers): **#5** a seller
can cancel a car under an unmet-reserve bid (refunding the bidder — no more free TTL-lock grief);
**#2** `BLACK_MARKET.ORDER_MAX_QTY` 200 + cancelled orders holding `filled_qty` count against
`MAX_LISTINGS` (bounds the warehouse); **#3** `UNDERWORLD.STANDING_DAILY_CAP` 25 on RAW bumps via a
new `npc_gain` table (lead/streak/errand bonuses exempt) — restores "top tiers are EARNED" and
moots the whispers auto-safehouse worry; **#1** a fire-kill loots `CASH_LOOT_RATE` (25%) of the
victim's live buy-order escrow (`whack:loot` + NULL `market:loot` outflow, remainder burns
`market:death`, a new §10.4 market-escrow term) + posting an order is safehouse-blocked — closes
the loot-proof cash vault that undercut Make-Risk-Pay. `npc_gain` joined the estate wipe. Fixes
committed across `2caec07`/`a20954b`/`4ad4a18` + the package; regressions per fix; Suite 16/16 +
sim drift-0.

**THE LAW / RICO / INFORMANTS — BUILT, all four phases** (`src/law.js`, `test/law.js` — the 17th
suite file; design `omerta-law-rico-design.md`). The state-run PvE antagonist: everything DOWNSTREAM
of the `heat` number (heat's ACCRUAL is untouched — sim-audited surfaces stay put, ground rule #1).
The `LAW` rules-tail block holds every lever. **Phase 1 — the investigation meter**: `heat_exposure`
banks lazily in `accrual.js` (the business-scrutiny precedent — `+(heat−WATCH)×min×event-mult`, bleeds
passively, so a spike-and-decay costs little and a long offline gap builds ~nothing since accrual
decays heat first); `rapStageOf` reads clean→watched→investigation; crackdown/sweep weather build it
faster, a commissioner's visit bleeds it (keyed on the CITY_EVENTS id — the table's generated, hands
off). The two escapes are cash SINKS: **bribe** (`law:bribe`, wealth-scaled `bribeCostOf`, knocks
`BRIBE_CLEAR` off the meter; blocked when clean / indicted / safehoused — D2 exposed act) and the
**lawyer retainer** (`law:retainer`, time-boxed, softens the bust P + forfeiture). `GET /v1/law` is the
public docket. **Phase 2 — the RICO bust + forfeiture**: crossing `INDICT_AT` files an indictment (a
LATCH — `indicted_at`, surfaced as `ch._indicted`, game.js notifies with the grace window); `resolveBust`
rolls `bustProbOf` (exposure over the line, × retainer × jury) and on conviction seizes `FORFEIT_RATE`
of **pocket+bank** into the confiscation buffer (`street_tax.pool` — the exact `mod:confiscate` §10.4
pattern, one `law:forfeit` row spanning cash+bank, reaching pocket then bank) + jails; **staked $OMR +
minted gear are SAFE**; it is **NOT death** (the street survives — the Law is an economic antagonist,
death stays PvP). The `sweepLaw` worker force-busts anyone past `INDICT_GRACE_MS` (reaches the OFFLINE
whale — closes the safehoused-hoard gap the sim flagged). **Phase 3 — the courtroom**: `plea` (a certain
`PLEA_FORFEIT_RATE` loss + short jail, `law:plea`), `buyJury` (a `law:jury` $OMR BURN that cuts
conviction P once), `demandTrial` (resolve now). **Phase 4 — informants** (status-only, §10.4 untouched):
`flip` (two-party — drop your case, name a rival seeding `FLIP_SEED` onto THEIR meter, earn the permanent
account-level `rat` badge that follows the bloodline), the rat's **waived directed-contract floor** on a
KILL pot (`postBounty`, the vendetta-waiver twin), **witness protection** (`witpro_until` — a one-time
untargetable relocation window; `fire`/`npcHit` throw `witpro`), and the **informant collapse** in
`runEstate` (killing a witness lifts the seed off every target they named, via a bounded `GREATEST`
NUMERIC update, and clears the `informants` row). §10.4: `law:` joined the cash vocabulary (all sinks →
the pool, the mod:confiscate precedent — the Law only DRAINS, no new faucet, so extraction-vs-inflow is
helped) and `law:jury` joined `omrBurns`. `LAW_BUST_P` is a TEST-ONLY roll knob (the BUSINESS_RAID_P
precedent — never in production). `test/law.js` proves the meter (build+bleed), all Phase-1 gates, the
indictment, the bust as a scoped char==pool==−ledger transfer with staked $OMR untouched and not-death,
acquittal, plea, jury, the flip + rat waiver, witpro untargetability, the collapse, the worker sweep +
grace window, and the closed vocabulary. Suite 17/17 + sim drift-0. ALL numbers are founder sign-off
levers — sim + sign-off into BALANCE.md before production.

**THE LIVING WORLD — BUILT, all four phases** (`src/world.js`, `test/world.js` — the 18th suite file;
design `omerta-living-world-design.md`). The city breathes. `CITY_EVENTS`/`cityEventOf` already drove
every economy loop; the `LIVING`/`WORLD` rules-tail blocks layer everything the design called for, all
keyed off the event id (CITY_EVENTS is GENERATED — hands off, ground rule #2). **Phase 1 — the city
you can SEE**: `GET /v1/city` publishes today's TWO event tracks (`cityEventOf` + the independent
`cityLawEventOf(day+OFFSET)`), the intraday clock, per-district weather, and a **7-day forecast** (all
pure functions of the day — knowable, so players plan); the character `view` carries a `city` summary.
**Phase 2 — NPC RIVAL FAMILIES** (the one emission surface, sim sign-off): `WORLD_NPCS` fixtures, each
a SERVER-WIDE shared cash reservoir (`world_npcs.strength`) the whole base grinds down together
(positive-sum co-op, distinct from zero-sum turf war), regenerating lazily toward its max; `raidNpc`
(`POST /v1/world/:id/raid`) loots a bounded slice (`GRAB_BPS` capped) as a ledgered `world:raid` cash
FAUCET (bounded by the reservoir/regen — a metered world quantity, §10.4-safe) + a `world:raid` ammo
SINK, drains the reservoir, and on a rout (drained below the floor) pays a one-time bonus + a streets
event; gated by level/energy/ammo + a per-character cooldown (`characters.world_raid_at`); repel →
hospitalize. `GET /v1/world` is the level-gated odds board. **Phase 3 — economic weather**:
`regionShockOf` (deterministic §7.11 hash, MEAN-NEUTRAL 0.9–1.1 so it adds texture not inflation, and
deliberately NARROW so it can't widen the audited trade-goods arbitrage) folds INTO `goodPriceOf` — so
the prices board, buy/sell, and convoy value all read ONE consistent shocked surface, per-district,
stable within a day; surfaced as the `weather` map on `/v1/city` (the arbitrage map). **Phase 4 — the
day/night clock**: `cityHourOf` (UTC-hour patrol window, no state); the Bureau works business hours so
a trial/bust in the patrol window convicts harder (`bustProbOf` × `PATROL_BUST_MULT`), and the small
hours ease an NPC raid's defense — both on NEW levers only (never a signed BALANCE surface); surfaced
on `/v1/city`, `/v1/law`, the view. §10.4: `world:` joined the cash vocabulary (a bounded faucet,
drift-0) + the ammo vocabulary (the raid sink); no other pillar moves value. `WORLD_RAID_P` is a
TEST-ONLY roll knob (the LAW_BUST_P precedent). Deferred: the NPC-held-district "seizable frontier"
(invasive — the raid loot + rout stand in) and a cross-process streets-weather emit (the board/view
is the surface). `test/world.js` proves the forecast/clock/weather board, the mean-neutral shock (folded
into the price, floor holds, per-district variance), the raid (bounded faucet, ammo sink, drain, regen,
rout, all gates), the patrol conviction premium, and the closed vocabulary. Suite 18/18 + sim drift-0.
ALL numbers are founder sim sign-off levers — sign into BALANCE.md before production.
**Step two — THE WAR EFFORT + roster + enraged cartels — BUILT** (`src/world.js`, `test/world.js`; a
content expansion for the thin one-verb pillar). **(1) Roster 3→5** — two on-curve fixtures (a lvl-4
`dockrats` starter + a lvl-55 `volkov` apex, each ~2-3× the prior tier; the car-catalog precedent —
content, not a rebalance). **(2) THE WAR EFFORT** — `account_persistent.cartel_damage` (lifetime cash
looted from NPC outfits, bumped by loot + rout bonus via direct SQL on the account row, NUMERIC so the
arithmetic UPDATE is pg-mem-safe; account-level → SURVIVES DEATH, the kills/boxing-legend precedent) +
`WORLD.WAR_RANKS` (Civilian → The Scourge, `worldRankOf`) + `GET /v1/leaderboard/world` (`worldLeaderboard`
— the base's most feared cartel-hunters, the hitman-rep board twin). PURE STATUS — **zero §10.4 surface**
(damage isn't a currency; the loot still rides the existing `world:raid` faucet, so the test proves
`warEffort.damage == the account's world:raid cash`). Surfaced on `GET /v1/world` (`warEffort {damage,
rank}`) + the console City tab (a war-effort banner + the leaderboard). **(3) ENRAGED CARTELS** — routing
an outfit sets `world_npcs.enraged_until` (`WORLD.ENRAGE_MS` 3h); while enraged it defends `+ENRAGE_DEF`
(60) — **EMISSION-SAFE by construction** (a higher defense LOWERS raid odds → REDUCES throughput, so §10.4
is helped, never widened; the shared reservoir can't be farmed to the floor over and over). `raidChance`
reads it, the board flags `enraged`, and it lapses on its own (surfaced as an ON ALERT chip). §10.4
untouched — the sim's `reason vocabulary` + `character cash` stay drift-0. `test/world.js` proves the
five-outfit roster, the war-effort damage/rank/leaderboard identity, and the enrage odds-drop + lapse. All
numbers are founder sim sign-off levers.
**Step three — CO-OP CREW RAIDS + THE FRONTIER — BUILT** (`src/world.js`, `test/world.js`; the two deferred
items — the crew-heist machinery applied to a WORLD raid + a family-conquest status axis). **(1) CO-OP
CREW RAIDS** on the apex outfits (`coop: true` on kryl/moreau/volkov — too well-defended to solo reliably;
`world_raids`+`world_raid_members` tables, the `crew_heists` twin): a leader `planRaid`s
(`POST /v1/world/:npcId/plan`), made raiders `joinRaid` off `GET /v1/world/raids`, the leader `executeRaid`s
(`POST /v1/world/raids/:id/go`) and ONE roll pays the whole crew. NO stake — each raider pays their OWN
energy/ammo/heat at execute (the solo-raid cost), so the loot is the SAME bounded reservoir slice, just
SPLIT (leader-weighted, the heist pot); §10.4-NEUTRAL vs solo (every share/ammo row rides the existing
`world:raid` cash faucet + ammo sink, character_id'd → check (a) reconciles; the sim stays drift-0). The
crew's COMBINED firepower (SUM of raider power over `COOP_SCALE` 600, clamped `COOP_MAX_P` 0.85) is how you
crack an apex def a soloist can't — but never a sure thing. Lock discipline is the `executeHeist` twin
(leader via withCharacter → member char rows SORTED → the raid row → `world_npcs` singleton; one-active-raid
keeps concurrent executes disjoint/acyclic; the residual leader-vs-pairwise-PvP 40P01 → the existing
`contention` retry; members paid/costed by absolute UPDATE under lock — no persist-clobber). **(2) THE
FRONTIER** (family conquest, PURE STATUS — zero §10.4): whoever lands the ROUT (solo OR co-op) plants their
FAMILY's flag on the outfit's turf (`world_npcs.held_by_gang`/`held_since`); the next rout topples it; a
gangless router leaves it open. `GET /v1/leaderboard/frontier` (`frontierLeaderboard`) ranks families by
outfits held (weighted by the outfit's reservoir scale — holding Volkov > the Dock Rats). The board's
`heldBy {name,tag,mine}` per outfit + a streets `frontier_seized` event. A dissolved family drops its holds
(`releaseFrontierHolds`, called from gang dissolution under the gang lock — `world_npcs` is a singleton, no
cycle). Estate: a dead co-op leader's plan is abandoned (`abandonRaidsAtDeath`, the crew_heists precedent;
`world_raid_members` joined the estate wipe). Worker `sweepStaleRaids` clears stale plans (no stake to
refund). Console: the City tab gained frontier-control chips per outfit, a "plan a crew raid" button on apex
outfits, a Crew Raids board (join/leave/go), and a frontier leaderboard link. `test/world.js` proves the
solo-outfit + crew_short + not_leader gates, a crew ROUTING an apex outfit, leader-weighted `world:raid`
shares ledgered per head + the ammo sink, war effort banked to both, and the frontier flag on the board +
leaderboard. Suite 30/30 + sim drift-0. **Emission note (founder sim sign-off):** co-op raids make the apex
reservoirs (moreau 5M / volkov 12M) a REALIZED faucet that solo raiders essentially couldn't tap — total
emission is still bounded by REGEN (you can't extract past the reservoir), but previously-locked reservoirs
now flow, so sim + sign-off the apex `regenPerHr`/`GRAB` before production (the only new emission surface;
`COOP_*` numbers are all sign-off levers). Still deferred: NPC outfits holding actual player-map DISTRICTS
(the fully-invasive turf-model rewire — the status frontier stands in). [Per-district racket-type choice: BUILT — see Territory step three.]
**Step four — THE FRONTIER MADE REAL (productive + contestable outposts) — BUILT** (`src/world.js`,
`src/rules.js`, `test/world.js`; `WORLD.FRONTIER` rules-tail block, new `world_npcs.garrison`/`tribute_at`).
Turns the status frontier flag into REAL turf without rewiring the signed 6-district turf-perk map. A held
outfit is now a conquered VASSAL: **(1) TRIBUTE** — it pays its overlord family a bounded, lazy-accrued
tribute to the treasury (`frontierTribute` — `regenPerHr × FRONTIER.TRIBUTE_BPS/10000`, NOT drawn from the
shared reservoir — the vassal's protection money — capped at `TRIBUTE_CAP_MS` 24h); `collectFrontier`
(`POST /v1/world/collect`, any member — the collectTerritory precedent) banks it, a §10.4 treasury FAUCET
`world:tribute` (character_id NULL, counterparty=gang; added to the gang-treasuries check's IN terms). Base-
wide max ~$157k/day across all 5 outfits (regen-metered + capped + requires routing to hold), a small
well-defended faucet. **(2) GARRISON + INVASION** — routing installs a base `FRONTIER.ROUT_GARRISON`; a
rival boss/underboss `invadeOutpost` (`POST /v1/world/:npcId/invade`) takes a RIVAL-held outpost by
outbidding the garrison from the treasury (`max(INVADE_BASE, garrison × INVADE_OUTBID)` — the seizeDistrict
pattern), a §10.4 treasury SINK `world:invade` (added to the OUT terms); the flag/garrison/tribute-clock
transfer, the incumbent's uncollected tribute forfeits (the territory-seizure precedent). You take an UNHELD
outfit by ROUTING it (`unheld` gate); you can't invade your own (`held`). Both rout branches (solo `raidNpc`
+ co-op `executeRaid`) now install the garrison + start the tribute clock; `releaseFrontierHolds` (gang
dissolution) resets garrison + tribute_at too. Lock order: own gang → world_npcs (singleton, last) — no
cycle vs a concurrent raid (everyone locks the singleton last). `world:` was already in the cash vocabulary,
so no vocab change — only the gang-treasuries check gained the two terms. Board (`GET /v1/world`) surfaces
`tributePerHr`/`tributePending`/`garrison`/`invadeCost` per outfit + a `frontier {held, tributePending,
canCommand}` summary; console City tab gained a frontier-tribute collect card + an invade button on
rival-held outfits. `test/world.js` proves the rout installs the garrison + clock, tribute accrual + the 24h
cap + the ledgered `world:tribute` faucet, the invade gates (rank/unheld/held) + the outbid cost +
`world:invade` sink + flag/garrison transfer, and the gang-treasuries §10.4 reconcile (drift == the seeded
rival treasury only). Suite 30/30 + sim drift-0. `FRONTIER.TRIBUTE_BPS`/`_CAP_MS`/`ROUT_GARRISON`/
`INVADE_BASE`/`INVADE_OUTBID` are founder SIM sign-off levers — a NEW (small, bounded) emission surface
(BALANCE.md). Still deferred: literal NPC occupation of the 6 signed core districts (the fullest turf-model
rewire — this outpost layer makes the frontier real turf without touching the signed district perks).
A **three-lens red-team over step four** (`AUDIT-world-frontier.md`: §10.4+emission, concurrency/locks,
exploit/grief) returned **no CRITICAL/HIGH/MED**: §10.4 exact (tribute faucet + invade sink reconcile in
the gang-treasuries check; the faucet is reservoir-independent, 24h-capped, `tribute_at`-metered so
collect-spam yields ~0, and every flag transfer forfeits + resets the clock so no stale-accrual
inheritance), lock order sound (own-gang → world_npcs-singleton-last, all pairs acyclic incl. invade-vs-
dissolution and two-rival-invade with an EvalPlanQual outbid re-read; mirrors exact), and no unbounded/
free extraction or free grief. Fixed in-commit (regression added): **F1 (LOW)** `collectFrontier` was
missing the SIGNED **D2 "shield, not bunker"** safehouse gate its sibling `collectTerritory` enforces —
a safehoused member could bank frontier tribute while untargetable; now `safeHoused(ch)` throws `safe`
(closing a hole in a signed anti-abuse bound, matching territory/business/convoy collection).
**B1 (founder-directed follow-up) — invasion now level-gated:** `invadeOutpost` gates
`levelOf(ch.respect) < fixture.minLvl` (you can only HOLD turf you could RAID), closing the consistency
gap where a rookie family could buy an apex outpost with treasury alone; regression added (a lvl-10 boss
can't invade kryl/lvl-20). Still flagged for founder sign-off (NOT patched, ground rule #1): **B2** the
garrison ratchet (×1.5/invasion, no decay/cooldown) can price a sub-apex family out of an apex outpost —
a pure sink, rout-resettable, so never permanent, but a garrison-decay or invade-cooldown is the dial.
Suite 30/30 + sim drift-0.
**Step five — THE OCCUPATION (NPC outfits garrison the CORE districts) — BUILT** (`src/rules.js`,
`src/social.js`, `schema.sql`, `test/social.js`; the deferred "fullest turf-model rewire"). The 5 apex
outfits now literally OCCUPY 5 of the 6 signed core districts (`WORLD.OCCUPATION` mapping dockrats→docks …
volkov→neon; `cathedral` stays FREE as the on-ramp), seeded on a fresh map via idempotent schema UPDATEs
(only a PRISTINE district is occupied, so a re-run never re-occupies a liberated/held one). An occupied
district can't be freely seized — a family **LIBERATES** it through the SAME `seizeDistrict` (a new
`npc_holder` branch), and the cost SCALES WITH THE OCCUPYING OUTFIT'S LIVE STRENGTH (`outfitStrengthFrac`
in world.js — a LOCKLESS quote; `liberationCost` = `outfit.max × OCCUPY_BPS/10000 × strengthFrac`, floored
`OCCUPY_MIN` $30k) — so **the World raid loop is the path to core turf**: beat an outfit down (rout its
reservoir) and its district goes from the full garrison (docks $45k … neon $3.6M at full strength) to the
$30k floor. **The signed district PERKS are UNTOUCHED** (dormant while occupied — `holder_gang` NULL gives
no perk, exactly as an unowned district — active the moment a family holds it); liberation clears
`npc_holder`, sets `holder_gang`, and the paid cost becomes the new player garrison. §10.4: liberation is
the EXISTING `turf:seize:<district>` treasury sink (already in the gang-treasuries check) — ZERO invariant
change; a dissolved family's district goes unowned (not re-occupied); NPC districts carry no territory
racket (the transfer is skipped). `GET /v1/districts` surfaces `occupiedBy {npc,name,strengthPct}` +
`liberationCost`; the console Family "War & Turf" section shows every core district's occupier/holder + the
live liberation cost + a stand-here liberate button. `test/social.js` proves the occupation seed (canal by
kryl), the full-strength cost ($450k), the strength interlock (a floored outfit → $30k), the ledgered
liberation, `npc_holder` cleared + the perk now held; the existing docks-seize test became a liberation
($45k). Suite 30/30 + sim drift-0. **Founder SIM sign-off flag (BALANCE.md):** this changes the signed turf
ON-RAMP — 5/6 core districts start NPC-held, so a fresh family's cheap free-seize is now a small liberation
(the weak outfits' districts are ~$45k–$120k, effectively a soft on-ramp that teaches the World loop;
`cathedral` stays free). Perk VALUES unchanged; `OCCUPATION`/`OCCUPY_BPS`/`OCCUPY_MIN` + the mapping are
all sign-off levers. The World pillar is now feature-complete (visible city → rival outfits + co-op raids →
war-effort/frontier → productive+contestable outposts → **NPC-occupied core turf**). A **three-lens
red-team over step five** (`AUDIT-world-occupation.md`: §10.4/emission, concurrency/locks, exploit/grief)
returned **no CRITICAL/HIGH** — §10.4 exact (liberation reuses the existing `turf:seize:` sink, zero
invariant change; an NPC district carries no racket so the transfer is skipped; perks dormant while
occupied), lock order sound (`outfitStrengthFrac` is a lockless quote, no cycle vs a raid's
`world_npcs`-last lock) — and closed two MED consistency fixes (regression each): **E1** the schema
occupation seed re-occupied a liberated-then-DISSOLVED district (dissolution leaves `seized_at` set but
resets `holder_gang`/`garrison`, so the pristine-guard matched on a re-boot and the outfit re-took turf
players had fought the World loop to free) — all five seed UPDATEs now also require `AND seized_at IS
NULL`, so a district ever fought over stays player-controllable forever; **E2** the liberation branch
was missing the frontier-B1 outfit level gate (a rookie could free-ride others' rout of an apex outfit
to liberate its APEX core district — neon/canal/foundry — for the $30k floor) — now `levelOf(ch.respect)
< fixture.minLvl` throws `level`, mirroring `invadeOutpost`. Flagged for founder sign-off (NOT patched):
the on-ramp shift (5/6 core districts start NPC-held), the carried garrison-ratchet (frontier B2), and
the carried apex-solo-raid floor (the 0.1 clamp). Suite 30/30 + sim drift-0.
**Step six — THE UPRISING (the world PUSHES BACK, its first proactive threat) — BUILT** (`src/world.js`,
`src/rules.js` `WORLD.UPRISING`, `schema.sql` `world_uprisings`, `test/world.js`; the deepen-a-thin-system
drop — the World only ever REACTED before, so conquered frontier turf was grab-and-forget). A seed-drawn,
FORECAST-able event (`cartelUprisingOf(day)` off the §7.11 hash — `CHANCE` 28% of days, unpredictable
without the seed, verifiable after; surfaced on `cityForecast`, `GET /v1/city`, `GET /v1/world`): on some
days ONE outfit RISES UP. While rising it defends `+UPRISING.DEF` (50 — can't be farmed during its own
revolt, the ENRAGE precedent, folded into `raidChance`) and its frontier TRIBUTE is SUSPENDED (a rebelling
vassal pays nothing — `collectFrontier` skips it). **The reckoning** (the worker, once the uprising's day
has passed — `sweepUprisings`→`resolveUprising`, the materialize-then-resolve-when-the-window-passes
pattern; `world_uprisings` PK-on-day for idempotency): a rising outfit HELD by a family attempts to BREAK
FREE — if the outpost garrison is below `outfit.max × THRESHOLD_BPS/10000 (3%) × its LIVE strength
fraction`, it RECLAIMS its turf (`held_by_gang`→NULL, garrison reset, uncollected tribute forfeits — the
`releaseFrontierHolds`/seizure precedent, a §10.4-NEUTRAL ownership move); a REINFORCED outpost REPELS it
(the family keeps it). **The interlock**: the threshold scales with the outfit's live strength, so keeping
it BEATEN DOWN via the raid loop (low strength → low threshold) means even a thin garrison holds — the raid
loop and the frontier now defend each other. **The defense** — `reinforceOutpost` (`POST /v1/world/:npcId/
reinforce {amount}`, boss/underboss) pays the TREASURY to stiffen a held outpost's garrison (a §10.4
treasury cash SINK `world:reinforce`, character_id NULL/counterparty=gang — the territory-fortify twin);
the garrison defends against BOTH the uprising's reckoning AND a rival family's `invadeOutpost` (which
outbids it), so it's never wasted. §10.4: NO new faucet — `world:reinforce` joined the gang-treasuries
check's OUT terms (`world:` already vocabularied); the reclaim moves no value. `WORLD_UPRISING` (test-only
override — `'none'`/an outfit id, the SEARCH_MS knob precedent). `worldBoard` surfaces the day's `uprising`,
a per-outfit `rising` flag + suspended tribute + `upriseNeed`/`reinforceMin` on your held outpost; the
console City tab gained an UPRISING banner + a RISING chip + a reinforce-garrison button; `describe()`
humanizes the reinforce; the worker logs resolutions. `test/world.js` proves the forecast track, the board
surfacing + tribute-suspend (driven by the override), the reinforce sink + gates (`not_held`/`amount`), the
reckoning BREAK (garrison 0 < need → reclaimed) + REPEL (reinforced → held) + idempotency, and the
gang-treasuries §10.4 reconcile with `world:reinforce`. Suite 33/33 + sim drift-0. The World pillar's
antagonist is now two-way (you raid the cartels; the cartels raid you back). All `UPRISING.*` numbers are
founder sign-off levers (pacing + a sink — no emission surface). Deferred (step seven): the uprising also
reclaiming an occupied CORE district (step five) if undefended; a repel paying a bounded morale/war-effort
bonus; a cross-outfit cartel war. A **three-lens red-team** (`AUDIT-world-uprising.md`: §10.4/emission,
concurrency/locks, exploit/grief) returned **no CRITICAL/HIGH/MED** — §10.4 exact (`world:reinforce` a
correctly-subtracted treasury sink; the reclaim writes zero ledger rows since garrison is a `world_npcs`
number never a treasury balance; the tribute suspension a 24h-capped DEFERRAL that can only reduce
emission), lock order sound (`world_npcs` locked last everywhere, `world_uprisings` single-writer so no
AB-BA; materialize idempotent via the day PK, resolve latched via `FOR UPDATE`+status), and the schedule
server-authoritative + grief-proof (strength moves down-only via raids, so a rival can't inflate a
holder's `need`). Fixed two LOWs (regression each): the board's `upriseNeed` was computed from view-time
strength but the reckoning uses resolve-time strength (higher after regen) — it now surfaces the
FULL-STRENGTH worst-case need (reinforce to it and regen can't trap you); and the silent per-row sweep
catch now logs (the `sweepAuctions` precedent). Flagged (NOT patched, ground rule #1): sub-apex uprisings
are toothless (dockrats/zappa full-strength need < `ROUT_GARRISON` 25k, so their outposts always repel —
the `THRESHOLD_BPS`/garrison-floor dial), and worker-downtime skips a missed day's reckoning (accepted for
a scheduled event). Suite 33/33 + sim drift-0.

**Session red-team (`AUDIT-session-drops.md`)** — a four-lens max-effort audit (§10.4, concurrency/locks,
death/estate/PvP, exploit/grief) over everything shipped this session (Boxing 3–5, Skills 2, Wire 2, World
2–3), every finding re-verified vs source. **No CRITICAL/HIGH.** Fixed in-commit (regression each): **F1
(MED)** `fightBout` credited `street_tax` BEFORE `applyBeltResult`'s `boxing_title` lock while
`resolveMainEvent` locks them in the reverse order — an AB-BA between two singletons needing only temporal
overlap (frequent fight vs the timer resolver); now `fightBout` credits the pool AFTER the belt result, so
both paths lock `fighters → boxing_title → street_tax`. **F2 (MED)** `acceptCallout` locked the CHALLENGER's
fighter (a row it doesn't hold the char lock for) UNDER the `boxing_title` lock — reversed vs `fightBout`'s
fighter→title; now it reads the title unlocked, locks the two fighters sorted, THEN locks+re-verifies the
title (the executeHeist TOCTOU pattern → clean `contention` on a shifted card). **LOW-1** a dead co-op raid
leader left orphan `world_raid_members` rows the sweep never reaps → `abandonRaidsAtDeath` now deletes the
stranded crew's rows (the pen-break precedent). Verified CLEAN: the boxing-bet escrow §10.4 identity (exact
on every terminal state; the house cut is the audited `casino:pvp` NULL-row/half-pool/half-burn pattern),
the co-op raid §10.4-neutrality + lock order, skills `active_at` no-clobber + cap-set actives + leaf-first
respec, the death/estate belt/callout/main-event handling, and every gate (co-op level, one-active-raid,
rout-crossing, own_event, callout one-at-a-time, duck→forfeit, booked-form freeze, banded dossier).
`callOutChamp`/`wipeFighterAtDeath` (title-before-fighter but serialized behind the caller/dying char lock)
are non-reachable cycles. Flagged for founder sign-off (NOT patched, ground rule #1): the apex-solo raid
floor (0.1 min-clamp lets a min-level whale solo an apex for the full un-split `GRAB_MAX` — the dial is the
clamp or a coop-only `raidNpc` gate for `fixture.coop`), the exhibition purse faucet, and symmetric-cost
announce/co-op-ready grief (design-consistent). Suite 30/30 + sim drift-0.

A **five-lens red-team over the Law + Living World** (`AUDIT-law-world.md`: §10.4, concurrency/locks,
death/estate/PvP, Law internals, World internals) closed two HIGH correctness defects + four MED/LOW
(regression per fix): the NPC-raid **rout bonus re-farmed** while the shared reservoir sat pinned below
the floor (an unbounded mint the §10.4 sweep was blind to — now fires only on the CROSSING); the
investigation meter **instant-indicted an OFFLINE kitchen dealer** because the exposure GAIN used
uncapped `dtMin` while the crew re-adds heat mid-accrual (now capped at the offline window like income,
bleed left uncapped); the informant collapse **never cleared the indictment it caused AND clobbered the
killer's own relief** when the killer was the named target (now a `CASE`-clear + in-memory killer mirror);
a rat **didn't actually forfeit family protection** (now omertà is VOID for a rat target in
fire/npcHit/postBounty); plus the raid hosp-gate, a forfeiture/plea sub-cent bank clamp, the first-touch
`world_npcs` INSERT race, and a dead-target notify. Verified CLEAN: the `goodPriceOf` shock ripple
(convoy toll atomic, insurance frozen-snapshot + underwriting cap, market untouched, `floor(blk/6)==dayOf`),
forfeiture-vs-kill serialization, witpro/respawn/bodyguard ordering, flip/sweepLaw persist discipline, the
meter/courtroom math, and the vocabulary. Flagged for founder sign-off (NOT patched, ground rule #1):
`demandTrial` 0.15-floor cheap reset, the raid loot $/day magnitude, the collapse's contention-mapped
out-of-order lock. Suite 18/18 + sim drift-0.

**THE PEN — BUILT, step one** (`src/pen.js`, `test/pen.js` — the 19th suite file; design
`omerta-the-pen-design.md`). Turns `jail_until` dead time into a place. The `PEN` rules-tail block holds
every lever; every Pen action REQUIRES being jailed (`insideOnly`). **The yard** (`GET /v1/pen`): your
sentence, the inmate roster (level/family), your contraband, protection window, commissary. **Work the
yard** (`POST /v1/pen/work`) — energy → a bounded cash FAUCET (`pen:work`, `WORK_PAY` band) + shaves
`WORK_CUT_S` off the sentence (good behaviour, the honest grind out). **The commissary**
(`POST /v1/pen/buy/:item`) — buy contraband from the corrupt guard (a cash SINK `pen:commissary` → the
buyback pool, the mod:confiscate precedent); step one stocks the **shiv**. **Protection**
(`POST /v1/pen/protection`) — pay the yard boss `PROTECTION_COST` for a `pen_safe_until` no-shank window
(the in-jail safehouse, a `pen:protection` sink). **Bribe the guard** (`POST /v1/pen/bribe`) — `$BRIBE_PER_S`
per second off the remaining sentence (the fast expensive exit, `pen:bribe`). **The jailhouse SHANK**
(`POST /v1/pen/shank/:targetId`, `withTwoCharacters`) — the marquee: BOTH must be jailed; the killer
spends a shiv + energy in a muscle contest (`SHANK_P` is a TEST-ONLY roll knob — the LAW_BUST_P
precedent). It BYPASSES the street defenses (a safehouse can't be entered from a cell, a street bodyguard
isn't inside) but RESPECTS paid revive insurance (a `respawn_token` absorbs it, the mark lives) and
witness-protection segregation (`witpro` throws); family omertà holds unless the target is a rat (the
audit precedent); a protected mark (`penSafe`) or hospitalized mark is off-limits. A landed shank runs
`runEstate({ killerCh, vendetta: true })` — a real death (heir, prestige, a sworn bloodline) but NO
loot/chop (you can't strip a fleet from a cell) and NO feared-rep (a shanking is dishonorable — the
npcHit rule); the killer's sentence extends by `KILL_ADD_S`. A caught miss spends the shiv, costs the
killer health + `CAUGHT_ADD_S` more time. §10.4: `pen:` joined the cash vocabulary (`pen:work` faucet +
`pen:commissary`/`pen:protection`/`pen:bribe` sinks, all character_id'd — check (a) reconciles); the
shank moves no currency (contraband is ownership; the death is the existing ledgered estate);
`pen_contraband` joined the runEstate wipe; `pen_safe_until` is a new character column. Gives the Law's
RICO conviction a destination and makes a jailed rival briefly reachable. `test/pen.js` proves the board,
the free-player gate, work (faucet + cut + energy gate), the commissary (sink + pool + bad-item), the
protection window, the bribe (per-second sink), and the shank (both-inside/no-shiv/protected gates, a
landed kill with the estate + no loot + sentence extension, revive-token absorption, the caught miss),
plus the closed vocabulary. Suite 19/19 + sim drift-0. Step two (deferred): prison factions/shot-callers,
the burner phone (one tethered outside move), the co-op break-out, seed-drawn yard incidents, the hole.
ALL numbers are founder sign-off levers — sim + sign-off into BALANCE.md before production.

A **three-lens red-team over The Pen** (`AUDIT-the-pen.md`: the shank/death vector, §10.4+locks, Pen
internals+cross-system) found no CRITICAL/HIGH and closed two MED + two LOW (regression per fix): a
PROTECTED inmate could **shank with impunity** (the `payProtection` "in-jail safehouse" had no
`penSafe(ch)` ACTOR guard — now shield-not-bunker like the street P1.3); a shank **burned open bounty
escrow** instead of paying it (a shank is a DIRECT player kill like `fire`, so it now
`claimBounty`s open kill contracts — the wet work is paid, not griefed away for a $5k shiv;
`claimBounty` was exported for this); `bribeGuard` treated `seconds:0` as "buy the whole sentence"
(now a clean 400); the yard roster ordered furthest-first (now closest-to-walking). Verified CLEAN:
the shank's respawn ordering / persist-clobber / shiv-consume race / under-lock gate re-check /
vendetta / zero-farmable-rep, the §10.4 conservation + closed vocabulary, the sentence math + races
+ heir freshness, and the lock order. Flagged for founder sign-off (NOT patched): the `pen:work`
faucet magnitude, a shank scoring 0 war-points + applying no NPC-standing consequences (a quiet
dishonorable killing — a design call), and the missing shank cooldown. Suite 19/19 + sim drift-0.

**THE PEN — step two BUILT** (`src/pen.js`, `test/pen.js`; `PEN` rules-tail additions). Three drops,
all leaning on existing machinery. **THE HOLE** (solitary): a CAUGHT shank now also throws the killer
in the hole (`characters.hole_until`, `PEN.HOLE_MS`) — while `inHole`, every Pen action throws `hole`
(no yard/commissary/calls) AND they can't be shanked (`segregated`); gives the caught-shank real teeth,
board surfaces `holeSeconds`. **YARD INCIDENTS**: a deterministic block-wide daily draw (`yardEventOf`,
the §7.11 seed / cityEventOf shape; `PEN_YARD_EVENT` is a TEST-ONLY override) — **lockdown** (no shanks),
**riot** (shank odds +0.2 + protection cost halved), **visit** (bribe rate halved), **toss** (commissary
closed); each ONE touchpoint, the discounted number ledgered (the decree precedent), surfaced as
`incident` on the board — ties the Pen into the Living World's weather. **THE BURNER PHONE**: a
contraband item (`burner`, a `pen:commissary` sink) — the ONE way to reach the outside from a cell:
`POST /v1/pen/burner/:targetId` consumes it to call in an NPC hit (`npcHit` is jail-gated everywhere
else — the burner threads `opts.fromBurner` to waive ONLY the actor jail gate; every other npcHit gate
stands, the fee still burns win/lose, the burner is spent only if the call goes through). §10.4: no new
reasons (burner rides `pen:commissary`, the burner hit rides `npchit:hire`); `hole_until` is a new
character column. `test/pen.js` covers the hole (caught → solitary, actions blocked, untouchable), every
incident touchpoint (discounted charges ledgered), and the burner (jail-gated npcHit refused without it,
one call consumes it). Suite 19/19 + sim drift-0.
**THE PEN — step three: THE BREAKOUT — BUILT** (`src/pen.js:attemptBreak`, `POST /v1/pen/break`;
`PEN` rules-tail additions; NO schema change). A solo high-risk escape that closes the Law→conviction→
Pen arc without trivialising the RICO sink — you trade a cell for a MANHUNT. Buy a **cutkit** (Hacksaw &
Rope, $50k — a normal `pen:commissary` cash sink → pool), burn it win or lose. A LOCKDOWN blocks it; a
riot's `shankAdd` chaos helps; roll `PEN.BREAK_P` (0.35; `PEN_BREAK_P` TEST-ONLY, the SHANK_P precedent).
**Win** → the sentence CLEARS (`jail_until=null`) but you walk out a **WANTED fugitive**
(`characters.wanted_until = now + FUGITIVE_MS` 2d) — the existing loan-WANTED machinery already enforces
it: omertà stripped (`isWanted` in fire/jump/npcHit/postBounty) + NPC bounty hunters (`huntWanted`
worker), plus a heat spike. Clear it by lying low `FUGITIVE_MS` or the existing `POST /v1/loans/square`
($50k → pool, which handles a bounty-less fugitive cleanly — verified live). **Loss** → caught: the hole
(capped at the sentence), `BREAK_CAUGHT_ADD_S` (15min) added stretch, a beating (`BREAK_FAIL_DMG`), the
kit spent, no fugitive mark. §10.4: **clean** — `attemptBreak` moves no currency (the cutkit was the
ledgered sink; wanted/heat/jail aren't §10.4); NO pool bounty posted (kept §10.4-clean; players may still
post their own on a wanted man). Console: an "Over the Wall" card in the Pen tab (fugitive warning);
`describe()` humanizes escaped/caught; the raw deck gained `/v1/pen/break`. `test/pen.js` covers the
free/no-kit/lockdown gates, the cutkit sink→pool, a forced fail (hole + longer stretch + beating + kit
spent + NOT wanted), and a forced win (sentence cleared + WANTED + heat spike + the sheet reads wanted).
Suite 23/23 + sim drift-0. All numbers are founder sign-off levers.
**THE PEN — step four: THE CO-OP BREAKOUT — BUILT** (`src/pen.js` planBreak/joinBreak/leaveBreak/
executeBreak/breakBoard/sweepStaleBreaks; `pen_breaks` + `pen_break_members` tables; the crew-heist
pattern INSIDE). A jailed **leader stakes a cutkit** (`POST /v1/pen/break/plan`); jailed inmates join off
the board (`GET /v1/pen/breaks`, `POST /v1/pen/break/:id/join`); the leader calls the go
(`POST /v1/pen/break/:id/go`) — ONE roll for the whole crew, `p = COOP_BASE 0.4 + (crew−1)×COOP_PER_EXTRA
0.12 + riot`, clamped `[.05, COOP_MAX_P .9]` (`PEN_BREAK_P` pins it for tests); crew `COOP_MIN 2`…`COOP_MAX
4`. **Win** → EVERYONE's sentence clears + EVERYONE walks out **WANTED** (the solo-break bound, crew-wide)
+ a heat spike; **loss** → the whole crew eats the hole + `BREAK_CAUGHT_ADD_S` + a beating. Lock discipline
mirrors `executeHeist` exactly (leader → member char rows SORTED → the break row; one-active-break makes
concurrent executes disjoint/acyclic; the residual leader-vs-PvP 40P01 → `contention`; members written by
absolute UPDATEs under lock — no persist-clobber). The cutkit is **contraband, not currency** — staked at
plan, spent win/lose at go, refunded to a LIVING leader on disband/stale (a dead leader's kit stays sunk —
the heist-stake rule); `pen_break_members` joined the runEstate wipe; the worker `sweepStaleBreaks`
(`COOP_TTL_MS` 1h, leader-before-break lock order) refunds stale plans. §10.4-clean (no currency moves —
the only ledgered event was buying the cutkit). Console: a "Crew Break" section in the Pen tab. `test/pen.js`
covers the gates (free/no-kit/crew_short/not_leader), the staked-kit lifecycle, a forced win (whole crew out
+ WANTED + heat), a forced fail (whole crew in the hole + longer stretch), and the disband + stale-sweep kit
refund. Suite 23/23 + sim drift-0. Step five deferred: prison factions/shot-callers, richer yard incidents,
the break RAT (the heist-rat twin).
**THE PEN — step five: PRISON FACTIONS + THE BREAK RAT + richer yard incidents — BUILT** (`src/pen.js`,
`test/pen.js`; `PEN` rules-tail additions; new `characters.pen_faction` col + `pen_break_members.ratted`).
Three drops, all leaning on existing machinery, §10.4-untouched (status/pacing only — no currency moves).
**(1) PRISON FACTIONS + SHOT-CALLERS** (`PEN.FACTIONS` — Northside/Dixie/Muertos/Brand): a jailed inmate
`joinFaction` (`POST /v1/pen/faction/:id`, insideOnly, `bad_faction`/`already` gates) / `leaveFaction`
(`POST /v1/pen/faction`) runs with a yard crew. `factionCover(client, target)` (a point-in-time read,
never stored) counts the target's LIVE jailed same-crew mates → `cover = min(FACTION_COVER_CAP 0.24,
mates × FACTION_COVER 0.08)`, and the most-feared (highest `season_kills`, ties count) is the SHOT-CALLER
(`+SHOTCALLER_COVER 0.10`). Two effects: **shank cover** — a shank's success `p` subtracts the VICTIM's
`factionCover` (a crew watches its own back), and **yard omertà** — you can't shank your own crew (a `crew`
gate before the shiv check; a rat target voids it, the family-omertà precedent). Pure derived status —
`pen_faction` is written by DIRECT SQL (outside persistCharacter's positional UPDATE, the `active_at`
pattern) so the write survives persist; the board surfaces `factions`/`faction {id,name,mates,cover%,
shotCaller}` + a per-roster-inmate crew chip. **(2) THE BREAK RAT** (the heist-rat twin) — `ratBreak`
(`POST /v1/pen/break/:id/rat`, `pen_break_members.ratted`, `no_break`/`not_crew` gates): any crew member
silently tips the guards. `executeBreak` reads the ratted flags under the crew lock and, if any, the break
BLOWS regardless of the roll — the rat's deal is **relief-only** (they dodge the crew's added stretch +
beating, but serve their OWN sentence unchanged — never a cut below it, so join-and-rat is never better than
abstaining and a Sybil main+alt can't farm a cheap trim — the AUDIT-session-drops-2 F1 fix; `BREAK_RAT_CUT_S`
retired), the honest crew eats `BREAK_CAUGHT_ADD_S` more time + a beating, and EVERYONE (incl. the rat) goes
to the hole so the public roster never outs the only free man; the feed only ever says "somebody talked"
(never named — the heist-rat anonymity precedent). **(3) RICHER YARD INCIDENTS** — `YARD_EVENTS` gained
`gangwar` (shankAdd +0.15, bribeMult 1.5) + `newfish` (protMult 1.5), each ONE touchpoint (the decree
precedent). §10.4: no new reasons (factions/rat move no currency; the ratted break's only ledgered event is
the already-spent cutkit). Console: a "Yard Crews" section (your crew + cover% + SHOT-CALLER chip + join/leave,
crew chips on the roster) + a dimmed "rat it out" button on your crew-break card. `test/pen.js` covers the
faction join/leave/gates, the board cover + shot-caller derivation moving to the most-feared (Bo's kills
flip it off Al), the yard-omertà shank block (`crew`) vs a rival staying fair game (`no_shiv`), and the
break rat (the break BLOWS at a guaranteed-success roll, the honest leader holed + longer stretch, the rat
holed but serving their own sentence — no cut below it — the feed says "talked"). Suite 30/30 + sim drift-0.
All numbers (`FACTION_COVER`/`_CAP`, `SHOTCALLER_COVER`, the two yard incidents) are founder sign-off levers.
**The Pen is now feature-complete** (yard/work/commissary/protection/bribe/shank → the hole/yard incidents/
burner → the solo + co-op breakout → factions/shot-callers + the break rat).

A **four-lens red-team over the un-audited session drops** (`AUDIT-session-drops-2.md`: §10.4, concurrency/
locks, death/estate/PvP, exploit/grief — over Territory step three, Pen steps four–five, and the faucet
retunes) returned **no CRITICAL/HIGH**: §10.4 exact (territory establish/income/upkeep/raid reconcile,
seized pending never ledgered, factions/break-rat move zero currency), lock order sound (co-op break
leader→sorted-members→row with the leader-vs-PvP AB-BA mapped to `contention`; `ratBreak`'s flag read
transitively char-locked; `factionCover` a lockless read; territory district→gang→racket consistent), and
death/estate clean (no break orphan, dead-man gives no cover, the `SHANK_MIN` 0.15 floor keeps a
max-0.34-faction-stacked mark always killable). Fixed in-commit (regression each): **F1 (LOW-MED)** the
co-op-break self-rat farm — the ratted branch's absolute sentence cut let a Sybil pair trim ~1h for a $50k
kit (~14× under the bribe sink), falsifying "self-rat is −EV by construction" → the rat's deal is now
**relief-only** (dodge the added stretch + beating, no cut below their sentence; `BREAK_RAT_CUT_S` retired);
**F2 (LOW)** `ratBreak` missing the `insideOnly` gate (benign — `executeBreak` already rejects walked/hole'd
crew — fixed for consistency). Flagged for founder sign-off (NOT patched, ground rule #1): `upgradeRacket`
dodges a pending Bureau raid (the speakeasy `upgradeSpeakeasy` fix is the parity dial), the frequent-collect
raid-dodge (by-design tradeoff), and the flat pen `PROTECTION_COST` (wealth-scale it if it bites).

A **three-lens red-team over Pen step two** (`AUDIT-the-pen-step-two.md`: the burner bypass, the hole,
yard incidents + §10.4) closed one HIGH + three MED/LOW (regression per fix): a $25k burner **defeated
the Pen's own defenses** — `npcHit`'s victim gates knew the street safehouse + witpro but NOT the
in-jail `penSafe`/`inHole`, so a burner-called (or street-hired) hit killed a yard-boss-protected or
hole'd ("untouchable") inmate → `npcHit` now gates `penSafe(victim)`/`inHole(victim)` parallel to the
existing safeHoused/witpro gates (closes both routes); `burnerHit` was missing the `penSafe(ch)`
shield-not-bunker actor guard (a protected inmate hunting from cover) and didn't honour a `lockdown`
for an inside kill — both added; `hole_until` was bounded only by wall-clock so a re-jail within 30min
reactivated a stale hole → capped at `jail_until`; and `burnerHit` was restructured to consume the
burner AFTER the call goes through (rollback-independent). Verified CLEAN: burner atomicity/persist/
idempotency, the §10.4 discounted-ledger exactness + clamps + closed vocabulary, the hole's persist +
heir-freshness + self-defeating "immunity". Flagged for founder sign-off (NOT patched): yard-incident
weighting (~40% of days hard-block the loop), the hole toothless near release. Suite 19/19 + sim drift-0.

**LOAN SHARKING — the Shylock, step one — BUILT** (`src/loans.js`, `test/loans.js` — the 20th suite
file; design `omerta-loan-sharking-design.md`). Player-to-player predatory lending: the first PvP CREDIT
market. A lender **offers** (`POST /v1/loans`, `offerLoan`) — escrows the principal out of pocket
(`loan:offer` sink into the loan bucket, the bounty/market-escrow precedent), setting rate (≤ `RATE_MAX`
0.5) + term (`TERM_MIN/MAX_H` 1–72h); a borrower **takes** it off the open board (`GET /v1/loans`,
`takeLoan` — escrow → borrower pocket `loan:take`, gated own/welsher/`MAX_ACTIVE` 1 so no debt-stacking),
owing `loanOwed` = principal × (1 + rate) by `due_at`. **Repay** (`POST /v1/loans/:id/repay`,
two-party `withTwoCharacters`) transfers the full debt back — borrower −owed, lender +owed−vig, the
`VIG_BPS` (5%) **vig → the buyback pool** (`loan:vig`, the confiscation-buffer sink — the ONLY value the
loan game removes, so it's a taxed transfer, never a free alt-funding rail). **Cancel** pulls an untaken
offer (`loan:refund`). **Default → collect** (`POST /v1/loans/:id/collect`, two-party, only past due):
the shark seizes pocket + in-transit cash up to the debt (CLEARED bank + staked $OMR are SAFE — the
Make-Risk-Pay loot-surface precedent), pays the vig, leg-breaks the deadbeat (`COLLECT_HOSP_MS` 30min),
and brands them a **welsher** (`characters.welsher`, dies with the street) — a permanent "nobody lends to
you again" mark (the real default deterrent, since the shark eats any shortfall). The worker
`sweepLoans` refunds expired offers (`OFFER_TTL_MS` 48h) + flags overdue borrowers welsher. Death:
`voidLoansAtDeath` in `runEstate` burns a dead lender's OPEN escrow (`loan:death`, the dead-funder
precedent) + voids active loans (a debt dies with either party). §10.4: `loan:` joined the cash
vocabulary + a NEW **loan-escrow check** (open-offer principal == offered − taken − refunded − death —
the bounty-escrow twin; repay/collect are check-(a)-neutral by construction). `LOAN` rules-tail block +
`loanVig`/`loanOwed` helpers; all numbers founder sign-off levers. `test/loans.js` proves the gates
(amount/rate/term/own/welsher/maxed/not_due), the full lifecycle, the scoped repay/collect transfers
(vig → pool exactly), the welsher block + worker sweep, death both sides, and the closed vocabulary +
escrow check. Suite 20/20 + sim drift-0. Step two deferred: directed/trust-line loans, an auto-contract
posted on a welsher, debt trading (selling the paper), collateralized loans (car/gear as security).
A **four-lens red-team** (`AUDIT-loan-sharking.md`: §10.4, concurrency/locks, gameplay/economy,
cross-system) verified the core sound (no drift, no deadlock, no persist-clobber, no double-settle;
welsher round-trips, all death paths clean, idempotency/rate-limit inherited) and fixed five in-commit
(regression each): a **HIGH loot-proof cash vault** — a lender's OPEN-offer escrow was BURNED at death
so a fire-kill looted none of it (the market buy-order hole, reopened); now `offerLoan` is safehouse-
blocked and `voidLoansAtDeath` on a PLAYER fire-kill loots `CASH_LOOT_RATE` of the escrow to the killer
(`whack:loot` + a NULL `loan:loot` outflow, remainder burns `loan:death`, the `market:loot` §10.4 twin);
a **MED missing actor gate** (a dead `hospitalized` helper betrayed the dropped intent) — `collectLoan`
now gates the actor `jailed`+`safeHoused`+`hospitalized` (the `shakedownBusiness` set — the borrower
stays reachable, a civil recovery), `offerLoan`/`takeLoan` gate `jailed`; a **sweep welsher TOCTOU**
(a set-based UPDATE re-scoped to a STILL-active overdue loan, so a late-but-paid debt keeps a clean
name); the **in-transit loot-marker over-retention** on collect; and **death-void notifications**
(`loan_defaulted`/`loan_voided`). Flagged for founder sign-off (NOT patched, ground rule #1): first-
loan-default +EV for alts (the core balance call), the untaxed A→B collusion rail, the permanent
welsher lockout with no built "square your name" route, no per-target collect cooldown, collect
reaching a safehoused/witpro borrower (the civil-vs-attack call), killing-your-lender-erases-the-debt
moral hazard, and the latent sweep/`alive=false` coupling. **Balance SIGNED 2026-07-18: "the lender
vets their counterparties"** — default risk stays with the lender by design (loan-sharking is a trust
market; the welsher mark is a reputation signal, not a clawback), recorded in BALANCE.md; step two is
framed as how trust gets PRICED, not retroactive lender protection.
**Step two — secured credit & enforcement — BUILT** (`src/loans.js`, `test/loans.js`): three mechanics
answering the sign-off's counterparty-risk framing. **(1) Directed (trust-line) loans** — `offerLoan {to}`
names a living borrower who ALONE can take the offer (`loans.offered_to`; the board hides a directed
offer from outsiders and flags `forMe` to the named borrower; `takeLoan` throws `directed` for anyone
else) — the vetted-counterparty market made concrete. **(2) Collateralized loans** — `offerLoan {collateral}`
sets a min car value (`loans.collateral_min`, ≤ `LOAN.COLLATERAL_MAX` $5M); the borrower pledges a car at
`take {carId}` worth ≥ it by `carCollateralValue` (its damage-adjusted `carVal` book value, deterministic).
The car LOCKS (`cars.pledged` — the `cars.listed` escrow precedent; `findCar` + market-list refuse a
pledged car, so melt/fence/repair/list can't dodge it; CHOP still values it so a marked man can't
warehouse his fleet by pledging). Repay/lender-death UNLOCKS it; a default `collectLoan` SEIZES it to the
lender (`UPDATE cars SET character_id=lender` — a pure ownership move, §10.4-NEUTRAL since cars conserve
by ROW COUNT, no ledger — the market/chop precedent; `carSeized` in the response). Secured lending lets
credit cross trust gaps, priced up front (consensual, not retroactive). A dead BORROWER's pledged car
dies with the fleet (the lender must collect BEFORE the borrower dies — "the debt dies with either party").
**(3) The welsher hunt** — `postBounty` waives the `DIRECTED_MIN` floor on a KILL contract on a WELSHER
(the rat/vendetta-waiver twin — a defaulter's broken word makes them cheap to put a named gun on); pure
status consequence (no clawback, no money to any lender), kill-only, and — unlike a rat — a welsher KEEPS
family omertà (a lesser offense). §10.4 untouched (collateral is ownership, not currency; no new reason).
`test/loans.js` covers directed visibility+gate, the full collateral lifecycle (pledge/lock/melt-refused/
repay-unlock/default-seize/dead-lender-unlock + car-count stability), and `test/social.js` the welsher
kill-waiver (+ hospitalize-pot refusal). Suite 20/20 + sim drift-0. Numbers (`COLLATERAL_MAX`, the
waiver) are founder sign-off levers. Step three deferred: debt trading (selling the paper), NPC lenders.
A **three-lens red-team** (`AUDIT-loan-sharking-step-two.md`: collateral mechanics, directed+welsher-hunt,
regression risk) verified the three mechanics sound (car conservation clean across all four collateral
exits; the pledge-lock airtight — melt/fence/repair/list all refuse a pledged car; the seize can never
dangle since a pledged car's only pre-collect exit is death, which voids the loan; no §10.4 drift, no
lock cycle — cars are leaf writes never `FOR UPDATE`'d — no signature/schema regression) and fixed two
LOW consistency defects (regression each): **F2** `collectLoan` pushed a bare `{id}` stub into the
lender's view (seized car rendered null model/trim) — now `SELECT *`s the full row (the market
auction-settle precedent); **F3** the armorer weekly favor filtered `!listed` but not `!pledged`, so a
pledged car could be repaired around the lock — now `!c.pledged` too. **F1 (the audit's one MED) is now
BUILT**: a SECURED loan left un-collected past `due_at + LOAN.GRACE_MS` (24h) auto-forfeits its collateral
car to the lender via the worker sweep (`sweepLoans` third pass) — so an absent/spiteful lender can't
freeze the borrower's car forever (the borrower always had the grace to repay; the lender had it to
`collectLoan` cash+car manually). COLLATERAL-ONLY (no cash seized — the car changes hands, a pure
ownership move, §10.4-neutral), the loan resolves to `collected`; the sweep locks the loan (serializes vs
a manual collect/repay), car+loan are the only writes (no character rows → no lock cycle). `test/loans.js`
covers within-grace (not forfeited) vs past-grace (car → lender, loan resolved). Still flagged for founder
sign-off (NOT patched): directed loans make the untaxed A→B collusion rail deterministic (one-shot per alt, `MAX_ACTIVE=1`); a
welsher is a cheap perpetual named-kill target (intended); collateral seizure bypasses `GARAGE_CAP` (the
market-win precedent).
**Step three — the paper market (debt trading) — BUILT** (`src/loans.js`, `test/loans.js`): a secondary
market for loan CLAIMS, the natural completion of the loan economy and the sharpest expression of "trust
gets priced." A lender lists an ACTIVE loan's claim for sale (`sellPaper`, `POST /v1/loans/:id/sell
{price}` → `loans.for_sale`, no escrow — a claim, not cash; `unsell` pulls it); `GET /v1/loans` gains a
`paper` section showing every listing with `owed`, `collateral`, `overdue`, and **`borrowerWelsher`** so
buyers price default risk (a welsher's paper trades far below face; a collector with muscle buys risky
paper cheap and enforces it). `buyPaper` (`POST /v1/loans/:id/buy`, two-party) pays the ask minus
`PAPER_TAKE_BPS` (2%) → the buyback pool and reassigns `lender_character` — the debt + any collateral
carry over unchanged; the borrower can't buy the paper on their own debt (`own_debt`). §10.4: a pure
taxed cash transfer (`loan:paper` — buyer −price, seller +net, NULL take → pool — riding the existing
`loan:` vocabulary; the loan-escrow check is untouched since paper is ACTIVE loans, not open escrow; the
loan's principal/vig still fire on repay/collect whoever holds it, so no new faucet). Death needs no new
handling (paper escrows nothing; a dead party's loan voids, taking the listing). `PAPER_TAKE_BPS` + price
bounds are founder sign-off levers. `test/loans.js` covers the sell/unsell/board/own_debt gates, the buy
transfer (ask − take → pool, new lender), and the new lender collecting the claim they bought. Suite
20/20 + sim drift-0. **NPC lenders DEFERRED (step four decision)** — an always-available house lender that
MINTS cash to lend is a net inflation faucet on default; doing it §10.4-clean needs a BACKED sink-funded
`loan_house` pool (the Phase-4 stake-pool pattern), its own build — flagged, not hand-waved as a mint.
A **two-lens red-team** (`AUDIT-loan-sharking-step-three.md`: §10.4/concurrency/persist-clobber, cross-
system/exploits) found **NO code bug** — the paper mechanic is §10.4-clean (the take nets exactly, the
loan-escrow check is untouched since paper is active loans not open escrow), deadlock-free (two buyers
serialize on the seller's char lock; buy-vs-repay/collect share the old-lender lock so a repayment can't
land on the old lender post-sale; buy-vs-sweep-forfeit is acyclic), persist-clobber-free, and the
collateral carryover (car → the NEW lender on collect/forfeit), directed×paper, death, and idempotency
paths are all sound. Two DESIGN-CALLs flagged for founder sign-off (NOT patched, ground rule #1): **F1
(MED)** `buyPaper` lacks `offerLoan`'s safehouse gate — but buying paper is a PURCHASE (cash → a live
lootable seller, not reclaimable escrow — the vault the gate blocks), the shelter is self-defeating
(disperses cash across alts at 2%/hop for an unrealizable claim), and Make-Risk-Pay already intends
wealth shelterable in safe harbours; a one-line `if (safeHoused(ch)) throw` gives offerLoan-parity if the
founder wants it. **F2 (LOW)** the public paper board discloses the borrower (inherent to a receivables
market; only edge is a once-private directed loan's borrower surfacing on listing). Suite 20/20 + sim drift-0.
**Step four — WANTED (the defaulter's pursuit) — BUILT** (`src/loans.js`, `src/social.js`; founder-directed
"a hit put on them / become wanted"). A default (collect OR the overdue sweep) marks the borrower WANTED
for `LOAN.WANTED_MS` (3d) on top of the permanent welsher mark, via `characters.wanted_until`. Three teeth:
**(1) omertà stripped** — `isWanted(target)` joins the rat exception in `fire`/`startSearch`/`npcHit`/
`postBounty` family gates, so even the mark's OWN family can hunt/contract them (a defaulter under pursuit
is fair game). **(2) a pool-funded player bounty** — `postWantedBounty` fronts `WANTED_BOUNTY` ($25k) from
the confiscation pool as a `'HOUSE'`-contributor share on the (target,'kill') pot, so ANY player who kills
them collects it through the EXISTING `claimBounty` (the HOUSE share never locks out a killer); §10.4: pool
→ escrow ledgered `bounty:wanted` (NULL char), the bounty-escrow check gained the term, `refundPot`'s new
`'HOUSE'` branch returns it to the pool on expiry, and the estate burns it (`death:bounty`) on an NPC/mod
kill; guarded so it never drives the pool negative. **(3) NPC bounty hunters** — the worker's `huntWanted`
sweep rolls `WANTED_HUNT_P` (0.05/tick; env-overridable, the LAW_BUST_P precedent) per wanted mark and, on a
landed hit, runs the estate with NO killer (no chop/loot/rep, the mod-kill precedent) — a safehouse/witpro/
pen shield/hospital/lockup blocks the hunter that tick, a bodyguard or a pre-paid revive token absorbs it
(the earned shields still hold; hide or square up). **Square your name** (`POST /v1/loans/square`,
`squareWanted`) — pay `SQUARE_COST` ($50k, a `loan:square` cash sink → pool) to clear WANTED **and** the
welsher mark (borrow again) and refund the pool's bounty — the "square your name" route the step-one audit
flagged as missing (a founder-approved change to the "welsher is permanent" step-one sign-off). §10.4:
`loan:square` rides the `loan:` prefix, `bounty:wanted` the `bounty:` prefix (no vocab change). Tests: loans
(default marks wanted + pool bounty + the escrow reconcile, square clears both + refunds the bounty + borrow-
again), social (omertà strip lets family contract a wanted member, `huntWanted` whacks a mark, a safehoused
mark survives). Suite 20/20 + sim drift-0. ALL numbers (WANTED_MS/BOUNTY/HUNT_P/SQUARE_COST) are founder
sign-off levers. Deferred: NPC lenders still need the backed `loan_house` pool (step-five decision).
A **three-lens red-team** (`AUDIT-loan-wanted.md`: §10.4/bounty-escrow, the headless huntWanted death
path/locks, omertà-strip/cross-system) fixed a **HIGH §10.4 drift** — the HOUSE bounty refund was
ledgered plain `bounty:refund` (NULL char), byte-identical to a family-contract treasury refund, so the
gang-treasuries check (b) drifted −$25k per square/expiry (reproduced); now a DISTINCT `bounty:wanted:refund`
reason (excluded from check (b), added to escrow check (c)) — and a **MED pardon-trap** (a sweep-marked
welsher who squared got re-marked next tick since the debt stayed active; `squareWanted` now refuses while
an active overdue loan exists — settle the debt first), plus a **LOW lock-order hardening** (square locks
the pot before the contributor, matching refundPot). The death path (headless persist, shields, heir),
the escrow integration (post/claim/burn/refund all reconcile), and the omertà-strip scoping were verified
CLEAN. Flagged for founder sign-off (NOT patched): alt-farming the pool bounty (a per-account/day cap or
principal-funding if it bites), disproportion vs a $5k loan, the jump-vs-family asymmetry, WANTED_HUNT_P
tick-dependence. Suite 20/20 + sim drift-0. **Alt-farm mitigation BUILT**: the pool cash bounty now only lands on a defaulter at/above `LOAN.WANTED_MIN_LVL` (10) — a throwaway rookie alt (the cheap farm fodder) gets NO price (still WANTED: omertà stripped + NPC hunters), the npcHit rookie-floor precedent; `test/loans.js` proves a rookie default posts no bounty + leaves the pool untouched. A **max-effort concurrency pass** (a fourth lens over the whole WANTED value path — real-Postgres lock cycles + §10.4 under concurrency, findings in `AUDIT-loan-wanted.md`) then closed three defects pg-mem can't exercise: a **HIGH estate/sweep §10.4 double-resolution** (`runEstate` summed the dying mark's bounty pots UN-locked, so the expiry sweep's `refundPot` could refund a pot between the SUM and the DELETE — both `death:bounty` and `bounty:refund` firing on the same escrow; now a plain `SELECT … FOR UPDATE` locks the pot rows before the aggregate SUM, serializing with the sweep's characters→pot order), a **MED street_tax-before-pot AB-BA** across all three WANTED value paths (`postWantedBounty`/`collectLoan`/`squareWanted` touched the `street_tax` singleton before locking the `(target,'kill')` pot — now the pot, and the `HOUSE` contributor, lock FIRST, restoring the canonical characters→pots→singletons order), and a **MED forfeit-vs-estate deadlock** (`sweepLoans`' secured-collateral forfeit locked only the loan while a dead borrower's estate held the char lock + deleted the pledged car + voided the loan — a cycle; the forfeit now locks the counterparty characters sorted before the loan, blocking behind any death, with a paper-sale re-verify). The residual alt-farm (Sybil rings mass-producing disposable alts — no per-account cap fixes Sybil) is flagged as an accepted, §10.4-clean, bounded redistribution (the fight-fix/referral posture), `WANTED_MIN_LVL` the founder dial — **raised 10→20** (founder call): the borrower alt DIES each farm cycle, so a higher floor is a recurring ~4.5× respect-grind tax on the ring (level 20 = respect 1444 vs level 10 = 324), while a real predatory-lending target is comfortably past it. Below the floor a defaulter is still WANTED (omertà stripped + NPC hunters), just with no pool cash bounty.

**THE ECON PASS (founder-directed 2026-07-18)** — the audits' three standing economy flags, measured then
structurally fixed (no signed numeric lever retuned; the full record is the BALANCE.md econ-pass addendum).
**(1) The den's mint-on-top — FIXED**: PvE `takeHouse` had credited the street pool 1%/stake un-ledgered and
results-independent, and `casino:rakeback` minted from nowhere — together ~2%/volume against dice's 1.41%
edge (dice volume net-inflationary +0.59%/unit). Now **the house tips only out of REALIZED profit**:
`den_volume` gained `profit` (Σ PvE stakes − payouts, mirrors the ledger exactly) + `distributed`; every
street cut and rakeback caps at `profit − distributed − open liability` (600:1 numbers + dog-odds fight
exposure held in reserve — `denAvailable` in casino.js, FOR UPDATE on the singleton), each pool credit is
a ledgered NULL `casino:take` row (rides the `casino:` vocabulary), and an uncoverable rakeback WAITS
(cursor holds, nothing forfeits — all-or-nothing per collect). PvP untouched (rake already carved from
the winner; its half-rake pool credit is direct and must NOT touch the PvE book). `invariants.js` gained
two exact identities: `den profit` == PvE bets − wins and `den distributions` == takes + rakeback (the CAP
is enforced at pay time + regression-tested, not an end-state identity — a later jackpot can legitimately
drive lifetime profit below what was already tipped). `test/casino.js`: the craps session now mirrors the
house book per-round, an under-water round tips nothing, the rakeback waits while negative then pays
exactly after honest losing-ticket profit refills the book. **(2) Purchasable Commission standing — FIXED**:
the chamber now ranks by THIS SEASON's showing — `gangs.season_tribute`/`season_wars` (bumped alongside
lifetime at all three sites: tribute, weekly task, war win), reset in `runSeasonRollover` via the lazy
`gangs.season` marker (founders stamped at creation so a mid-season founder's ladder isn't zeroed);
`commission.js:seatedGangs` reads the seasonal formula. A seat must be re-bought every season with the
parked treasury war-lootable all the while. The buyback family split keeps the LIFETIME formula (signed,
untouched — worker.js). `test/commission.js` seeds season_tribute + proves rollover empties the chamber.
**(3) Kill EV (D1) — CONFIRMED as signed**: standalone loot-EV vs a careless mid mark re-measured at
−$72k (ammo $82k dominates; break-even liquid ≈ $328k — whale-hunting). By design: the kill economy is
CONTRACT-driven (pots + the WANTED house bounty + war points + vendettas pay; loot is the tip). The sim
now prints a standing `contract break-even` probe (~$72k pot turns a mid-mark job +EV) so the number is
tracked at every economy change. Suite 20/20 + sim drift-0.

**THE CONSOLE (playable client, step one) — BUILT** (`public/index.html`, served at `GET /` by
server.js; screenshot-verified in Chromium). One static file, zero new deps, zero build step — the
deploy story is unchanged. Guest auth → character creation → the SHEET (live vitals/status chips
incl. wanted/welsher/indicted/law stage), the Streets tab (all 29 crimes off `GET /v1/rules`, train,
bank with the in-transit warning, travel), the City board (`/v1/city` events/weather/forecast/clock),
the Den (craps/numbers/fight/back-room off `/v1/casino`), THE WIRE (live `/v1/ws` websocket feed with
auto-reconnect + auto-refresh on `me` events), a Last-Word response viewer, and the **Everything Else
deck** — a grouped registry of ~150 routes covering every system (`:params` become inputs, JSON bodies
prefilled + editable), each entry VERIFIED against server.js registrations (two were fixed by the
check: `/v1/contracts/:targetId/:kind/cancel`, `/v1/convoy/:id/collect`). New backend surface:
`GET /v1/rules` (the public rulebook — curated CRIMES/DISTRICTS/GUNS/VESTS/DRUGS/GOODS constants, the
/v1/catalog discoverability precedent; server stays authoritative — odds knowledge moves no roll) and
the `GET /` static route (file read once at boot, headless-safe fallback). Client bug found by the
end-to-end probe and fixed: `content-type: application/json` on a bodyless POST 400s in Fastify —
the header now rides only with a body. Verified live: serve → guest → create → crime → bank
(in-transit visible) → travel → dice at neon → WS hello + feed, plus four Chromium screenshots.
Deferred (client step two): kitchen/family/market curated screens (the deck reaches them raw today),
mobile layout polish, the X/Privy sign-in buttons (guest + upgrade path works).

**THE CONSOLE step two — Kitchen / Family / Black Market curated screens — BUILT** (public/index.html;
all three verified live in Chromium with a two-account scenario, zero page errors). **The Kitchen tab**:
trade rank card (server-computed `me.tradeRank` — the client never re-derives game math) with
next-rank threshold, the lab with the NEXT-tier upgrade button (cost + $OMR off the new `/v1/rules`
`kitchens` ladder), the Supplier (per-unlocked-drug makings price from `/v1/market/prices` + shelf qty +
buy form; locked lines shown as rank chips), the Burner (live batch countdown / collect, or the cook
form with the crates hint), the Corner (stash lines with quality + district demand + deal form), the
Crew (hire cost from `rules.crew.costStep`, wages owed, COLD warning, pay-the-nut), laylow/cleanpapers.
**The Family tab**: two states — no gang → the families board (standing-sorted, join buttons) + the
found form; in a gang → the dashboard: treasury/$OMR reserve/wars/turf cards, made-men roster, territory
operations (income/pending/upkeep/COLD per district) with boss-gated collect/upkeep/establish-here,
tribute (cash + $OMR pool), war & turf (seize-here + declare-war, boss-only), the Commission (seats,
decree in force, veto record; vote/veto UI only when seated + boss — correctly hidden otherwise), leave.
**The Black Market tab**: the board rendered per kind — car auctions (bid/floor/buy-now/reserve-met/
countdown + bid/buy-now forms, pull-it on own listings), goods (unit price vs the district SPOT price
from `/v1/market/prices`, district-pinned buy form gated by where you stand), WTB orders (fill-from-
trunk at the pinned dock, claim-delivered on own orders) — plus the sell side: auction a car (unlisted+
unpledged only), list trunk goods at your district, post a buy order (spot prices in the pickers).
`/v1/rules` gained `kitchens`/`tradeRanks`/`family` (found cost, tribute min)/`crew` (cost step, max).
The verification pass caught FOUR wrong deck body templates against the real handlers (`drugId` not
`drug` for cook/deal; `goodId` not `good`/`id` for goods buy/sell + market listings/orders) and an
`[object Object]` decree render — all fixed; the probe also confirmed `com.book` = `{id,name,desc}`,
`territoryOf` fields, and that establish takes no body (sequential tiers). Suite 20/20.

**THE CONSOLE step three — Wet Work + The Law curated screens — BUILT** (public/index.html; both
verified live in Chromium — a $60k kill contract posted and a search started through the UI, the
indicted courtroom rendered off a warped case — zero page errors). **Wet Work**: the CONTRACT BOARD
(`GET /v1/contracts` — pot/kind/poster-or-"somebody"/family attribution/directed-exclusive window/
expiry + pull-my-stake per pot), the post-a-contract form (target picker off `GET /v1/streets`,
kill/hospitalize, anon 3-$OMR checkbox, public reason, optional named gun + exclusive window), YOUR
HUNT (the client remembers the search it started — `{targetId, placedAt}` per-character in
localStorage since the view doesn't surface searches; FIRE disabled until placed; the server stays
the referee: any resolved shot or a stale `no_search` clears it; call-it-off wired to the DELETE),
YOUR DEFENSES (safehouse with the live wealth-scaled quote, bodyguard offer/status, the 5-$OMR peek,
and a square-your-name card that appears only when wanted/welsher), and THE STREETS roster (level/
tag/district/lockup/hospital chips + jump, search, tiered NPC hit, hire-guard when a price is
listed, and the blood-feud ledger per mark). **The Law**: the RAP SHEET (stage-colored meter with
watched/investigation/indictment thresholds off `GET /v1/law`, the heat-feeds-the-case line, city-
event multiplier, PATROL-hours chip, RAT badge), THE CASE AGAINST YOU (indicted only — grace
countdown, live conviction odds, forfeit terms + plea/buy-jury/demand-trial), THE ESCAPES (bribe
with the wealth-scaled cost — correctly refused once a case is FILED, the retainer with its active
countdown, a pointer to laylow/cleanpapers), and THE INFORMANT'S DOOR (flip-on-a-rival picker with
the permanent-rat warning, witpro button only when available). Deck fixes caught by the pass: the
npchit/burner `tier` templates used a nonexistent `'local'` → `'legbreaker'` (the real
NPC_HITMEN ladder). Suite 20/20. Client now covers: core loop, PvP, Law, Kitchen, Family, Market,
City, Den + the full raw deck.

**THE CONSOLE step four — the FULL screen set — BUILT** (public/index.html; all six new tabs verified
live in Chromium with a two-account scenario, zero page errors — the probe even organically demonstrated
the jail gates when a failed boost locked the driver up mid-run and the loan-take toasted "No taking a
loan from lockup"). **The Garage**: the fleet (boost/repair/fence/melt per car, ON-THE-BLOCK/PLEDGED
escrow chips) + the armory (full gun catalog with owned/carrying states + equip/unequip, vests, ammo).
**The Empire**: owned fronts (income/pending/pad-owed, COLD + FEDS-WATCHING chips, scrutiny + wash
headroom, tier upgrades, per-front laundering) + the discoverable catalog with level gates. **Big
Scores**: the solo score (cooldown-aware), crew heists (plan with job+role — the businessId field
appears only for the inside job; the open board with role-select crew-up; the my-job card with
leader-gated EXECUTE, disband/walk-away, and the deliberately-dimmed rat button), smuggling convoys
(open-with-first-load — the probe caught that openConvoy REQUIRES an initial good, load/depart with
guard tiers + insurance, arrived-collect, and the road board with AMBUSH per shipment). **The Shylock**:
open offers (directed FOR-YOU/spoken-for chips, secured pledge-a-car input), the offer form (directed-to
picker + collateral min), your book (repay / past-due COLLECT / sell-the-paper), the paper market
(welsher-debtor + overdue + secured risk chips), square-your-name when marked. **The Life**: the
three-branch skill tree (known/learnable, tier costs, respec) + all five fixtures (effective standing,
tier, grudges, tier-gated perk lists, gift-below-cap, penance, the weekly favor, errand chains, the
daily lead + Doc discharge when hospitalized). **The Pen**: outside teaser vs inside yard (sentence/
hole/protection chips, the day's incident, work/protection/bribe, the commissary, the inmate roster
with shank + burner-phone outside hits). Shape fixes caught by the pass: the pen roster maps
`{id,name,level,gang}` (no tag/sentence fields), and `openConvoy` requires a first load. The console
now curates EVERY major system — the raw deck remains for mod/chain/edge routes only. Suite 20/20.

**THE CONSOLE step five — production auth + polish — BUILT** (public/index.html + one server.js
addition; verified live in Chromium under `INVITE_MODE=on`, zero page errors). **Auth**: the entry
screen now carries the FULL production surface — the ghost door (guest), an invite-code field that
REVEALS itself when the server answers `invite` (closed-alpha ready; retry with the code proceeds),
and provider sign-in (X / Privy token → `POST /v1/auth/x|privy`, invite-gated for new accounts;
bogus tokens surface the server's own flavor — "X rejected that token."). **The claim card**: a
guest sees CLAIM YOUR ACCOUNT on the sheet — `POST /v1/auth/upgrade` in place (same account row,
same street, §4); keyed off the new `provider` field on `GET /v1/session` (the one backend line).
The hosted OAuth REDIRECT flow (X app + Privy embed) is deploy-time work — the paste-token flow is
honest about that on-screen. **The street talks back**: `describe()` humanizes every action response
("clean job — $103, +2 respect" / "BUSTED — 4m in lockup" / "THEY'RE DONE. looted $10,250" / "the
batch is on the burner") with the raw JSON still in the Last Word viewer for the deck. **Freshness**:
the sheet self-refreshes every 30s + on tab-visibility return (countdowns stop going stale), and the
wire BACKFILLS the last 20 undelivered notifications at boot so a returning player sees what happened
while they were gone. **Mobile**: ≤760px pass — wrapped top bar, horizontally scrolling tab rail,
thumb-sized targets, two-then-one column card grids, calmer feed/viewer heights. Suite 20/20.

**CHAIN GO-LIVE (the devnet proof) — DONE.** The §11 rail has now EXECUTED end-to-end on a real EVM
for the first time: `tools/compile-contracts.js` (solc-js 0.8.26 + OZ 5.1, mirrors foundry.toml,
evmVersion shanghai — the no-Foundry path since Foundry's GitHub-release binaries are egress-blocked
while npm isn't; ad-hoc deps, never project ones; output gitignored — artifacts must never drift from
source) + `tools/chain-e2e.js` (the go-live prover — viem only, runs against ANY RPC incl. the
Robinhood testnet). **27 asserted steps, all green** on a ganache devnet: deploy OMR/GearVault/
VoucherClaim/OMRStaking/OmertaFees → setMinter + gear cap + 1000-OMR tranche → boot the REAL backend
against the chain → SIWE link (real signature) → `payMintFee()` 0.01 ETH on-chain (inexact fee
REVERTS) → the getLogs cursor watcher credits it → `POST /v1/character/mint` spends the credit →
$OMR earned in-game through the docks wash → `POST /v1/mod/reserve/fund` → `POST /v1/withdraw`
signs the EIP-712 voucher (nonce 1, ledger debited `withdraw:omr`) → `claim()` on-chain from the
player wallet → **25 real ERC-20 OMR held** → replay REVERTS, tampered voucher REVERTS → the
`Claimed` watcher (polled, as in production) marks the voucher claimed and the reserve closes exact
(committed 25 / available 475) → a server-signed gear voucher mints the ERC-1155, an UNCAPPED gearId
fails closed even with a valid signature, `GearVault.mint` from a non-minter REVERTS → §10.4 $OMR
conservation holds with the chain live. Two latent bugs caught by the run: the swap body is
`direction` not `dir` (the console deck had it wrong too — fixed), and the prover now POLLS the
Claimed sync like the real worker (dev nodes index logs a beat after the receipt). HONEST RESIDUAL:
the Foundry unit+fuzz suite (`omerta-contracts/test`, 15 tests) still needs a Foundry-capable
environment — the REAL bytecode + core security properties have now run on a real EVM, but `forge
test` remains a pre-audit gate; and mainnet stays gated on legal counsel + the third-party audit of
contracts AND signer. Suite 20/20.

**THE PORTFOLIO — "going legit" (R1, off-chain, ZERO regulatory surface) — BUILT** (`src/portfolio.js`,
`test/portfolio.js` — the 21st suite; design `omerta-rwa-portfolio-design.md`). Founder-directed:
incorporate Robinhood Chain's RWA stocks (AAPL/TSLA/SPCX) as something players ACQUIRE by playing —
the narrative apex of the game's own laundering arc (dirty cash → laundered $OMR → legitimate,
death-proof equity; the mob "goes legit"). Model **C** (earn-in-game → graduate-to-real, the exact
$OMR architecture): R1 is the in-game layer only. **Pure STATUS** — a ticker-denominated collectible
with a deterministic server-authoritative price (`tickerPriceOf` off the §7.11 seed hash — display-
only, moves no value), **no sell, no cash-out** — so it touches NO securities/derivative law (the
hitman-rep / family-seal precedent: outside §10.4 on the reward side and outside the sim-audited
balance). Holdings live at the **ACCOUNT level** (`portfolios (account_id,ticker)` PK), so they
SURVIVE DEATH — never in the runEstate wipe; the heir inherits the book (the retirement fantasy,
surfaced as `kept.portfolio`). **`invest`** (`POST /v1/portfolio/invest`) burns clean $OMR → fractional
`shares = omr/price` — the ONLY §10.4 flow, an enumerated **`rwa:invest` $OMR BURN** through the vanity
`spendOmr` till (personal → account bucket; family → gang omr_reserve). **`familyInvest`**
(`POST /v1/gangs/portfolio/invest`, boss/underboss from the **reserve**, gang row locked — the buySeal
pattern) builds a seize-resistant family book (dies with a dissolved family). `GET /v1/portfolio` is the
board (market price + day-change, your book, the family book); `GET /v1/leaderboard/portfolio` the biggest
legit books (a status board); surfaced on the character `view`, `GET /v1/gangs/:id`, and the estate report.
§10.4: `rwa:` joined the `omr` vocabulary + `omrBurns` (shares are not a currency → zero new bucket, zero
faucet; the deterministic price moves no value), so `$OMR conservation` stays exact — the test proves the
burn reconciles by asserting the only drift is the SQL grant itself. A deep, UNCAPPED, **deflationary $OMR
sink** the late game lacked (helps extraction-≤-inflow), a death-proof endgame store + graceful exit, and
family politics (a war-proof book). Suite 21/21 + sim drift-0. ALL numbers (tickers, base/drift,
MIN_INVEST_OMR) are founder sign-off levers. **R2** (a real ETH-fee `RWA_BPS` slice → a buy bot → a real
RWA reserve backing the shares via the full-reserve invariant) and **R3** (the KYC'd on-chain extraction
through Robinhood's broker-dealer rails — the one securities event) are **legal-gated** (Robinhood
partnership + securities counsel + the third-party audit that already gates mainnet) and NOT built. The
three hard rules the design respects so R3 stays inside the lines: never distribute securities by CHANCE
(every RNG/loot/casino layer stays in cash/$OMR; RWA is purchase/earned/vested only), receiving stock is a
taxable KYC-gated event (Robinhood's KYC is the enabling asset), and the regulated surface is confined to
one gated extraction boundary. Deferred R1 step-two (never-by-chance earn hooks): the big-score cut,
skill/season leaderboard payouts, the laundering-graduation tier that draws RICO scrutiny, an automatic
"Envelope" tithe on taxed flows.

**THE PORTFOLIO — R1 step-two (EARNED exposure) + the console screen — BUILT** (`src/portfolio.js`,
`src/heists.js`, `src/worker.js`, `public/index.html`; `test/portfolio.js` + `test/heists.js`). Three
earn hooks, each **earned/vested/skill, never a chance draw for stock** (so the R3 "never distribute
securities by chance" rule holds by construction), plus a curated client tab. New shared helper
`portfolio.js:grantShares(client, accountId, ticker, omrWorth)` — a $OMR-worth-denominated STATUS
grant (`shares = omrWorth/price`, **cost basis 0** — a free legit kickback), no `h`, headless-safe, no
§10.4 (shares aren't a currency). **(1) THE BIG-SCORE CUT** (`heists.js` success branch): a completed
STANDARD crew heist (not the shakedown-style inside job) parks a legit AAPL sliver for every crewman,
`SCORE_CUT_PER_LVL × avg crew level` $OMR-worth — granted ON TOP of the audited cash pot (a status
kickback, so the sim-audited payout is untouched), account-level so it survives death; the leader's
in-memory `owned.portfolio` is refreshed (portfolio is never persist-clobbered) so their own view stays
honest; `rwaCut` on the response + members' `heist_score` notify. **(2) THE SEASON PRIZE**
(`worker.js:runSeasonRollover`): the top `SEASON_PRIZES.length` season grinders by respect —
snapshotted BEFORE the reset zeroes it — win the champion's moonshot (SPCX), a skill-RANKED status
grant (rank 1/2/3 → 500/250/100 $OMR-worth), notified `season_prize`. **(3) THE RICO GRADUATION**
(`portfolio.js:invest`): a BIG legit move (invest ≥ `SCRUTINY_MIN_OMR` 1000 at once) is the classic
laundering red flag — it adds `SCRUTINY_HEAT` (12) to the actor's heat (the launder-heat precedent,
feeds the Law meter) and is **safehouse-blocked** (P1.3 — hiding, not moving money); small buys fly
under the radar; `scrutiny` flag on the response. All numbers are `PORTFOLIO` rules-tail founder
sign-off levers; §10.4 untouched (grants aren't currency; invest's `rwa:invest` burn is unchanged).
**The console** (`public/index.html`): a new **"Going Legit"** tab — your book (value + cost basis +
liquid $OMR + the death-proof note), the market board (live price + day-change chips + per-ticker
invest, with the ≥1000-$OMR heat warning), the family book (reserve + boss/underboss invest), the
biggest-books leaderboard, and an earned-exposure/cash-out-is-a-later-phase footnote; `describe()`
humanizes invest + the heist cut; `GET /v1/rules` gained a `portfolio` block (tickers + thresholds,
the /v1/catalog discoverability precedent). Verified live end-to-end (guest → rules → board → big
invest draws heat → leaderboard). Suite 21/21 + sim drift-0.

A **max-effort five-lens red-team over the Portfolio + all contract interactions**
(`AUDIT-portfolio.md`: §10.4, concurrency/locks, death/estate, internals/exploit, chain+contracts)
found **no CRITICAL/HIGH**. Confirmed sound: the status/currency split (§10.4 exact on both the
account and gang-reserve burn buckets), full CHAIN CONTAINMENT (the Portfolio has zero reach into
`chain.js`/`fees.js`/`watcher.js`/vouchers — a share is structurally incapable of becoming a voucher;
no dormant R2/R3 hook — the legal line holds), death/estate survival (`portfolios` never wiped, heir
inherits; no sell/withdraw path exists), and the contract interactions (EIP-712 parity, full-reserve
queue, fee idempotency, no owner-mint/reentrancy — `forge test` 39/39 in CI). The flagged NaN-through-
`validAmount` vector was RULED OUT (`!Number.isFinite` short-circuits first). Fixed in-commit
(regression each): **F1 MED — structuring defeated the RICO graduation** (a per-call-only ≥1000 $OMR
threshold let 999-on-repeat convert unlimited $OMR heat-free + safehouse-free; now CUMULATIVE over a
rolling window via new `characters.rwa_used`/`rwa_at` — the D3 `wash_used` token-bucket twin,
`SCRUTINY_WINDOW_MS` 24h a new lever); **F3/F4 LOW — the season prize was the only `portfolios` writer
without a character lock** (a latent lost-update/deadlock vs a same-ticker invest, guarded only by
`SCORE_TICKER≠SEASON_TICKER`; the grant now runs UNDER the winner's `char FOR UPDATE` in the reset
loop, restoring char→portfolios order — a naive `FOR UPDATE` on grantShares would have INTRODUCED the
deadlock); **F2 LOW** — `familyInvest` `if (!g)` guard; **F4b LOW** — `invest` jailed gate (consistency
+ R3 forward-safety); **F7 LOW** — the graduation heat add now `Math.min(100,…)`-clamped. Accepted
(flagged, status-only / fail-closed): the leaderboard full-scan (matches the hitmen board), free-grant
farmability (status axis, Sybil posture), the chain daily-cap liveness + `OmertaFees` forward-DoS.
Suite 21/21 + sim drift-0.

**NEW-PLAYER ONBOARDING — the guided funnel surfaced — BUILT** (`src/growth.js`, `src/server.js`,
`public/index.html`). The First-Week checklist (`ONBOARD_TASKS` / `claimOnboard` — nine tasks: pull a
job, boost a car, bank cash, declare a Path, join a family, link a wallet + three social) was fully
built and tested since M4 but had **zero client surface**, so no new player ever saw it — the deepest
retention lever sat dark behind the 15-tab console. This drop is purely additive (no schema, no new
faucet, no balance change, §10.4 untouched — reuses the tested `onboard:` cash faucet): a read-only
`onboardBoard(ch, h)` (`growth.js`) + `GET /v1/onboard` return each task's server-authoritative
`ready`/`claimed`/`social` state (the client never re-derives game state), and the console gained a
**"Start Here"** guided tab (`public/index.html`) — the FIRST tab, auto-selected for any player who
isn't `allDone` (veterans land on Streets). It renders the checklist with reward-ready (neon) vs
do-it-first (grey → jumps to the relevant tab) states, claim buttons on the existing route, social
links, live progress + the capstone bonus; `describe()` humanizes the claim toast. `test/growth.js`
gained board assertions (nine tasks, readiness flips on the first job, claimed marks). Verified live
end-to-end in Chromium (fresh guest → lands on Start Here → job → board flips ready → claim pays
$500 +10 energy → 1/9). Suite 21/21 + sim drift-0.

**ONBOARDING POLISH — "the On-Ramp" — BUILT** (`src/game.js`, `src/growth.js`, `src/server.js`,
`public/index.html`). A max-effort package turning the deep-but-overwhelming console into something a
first-timer can navigate. All additive: no schema, no new faucet, no §10.4 surface (a status view
field + read endpoints). **(1) THE COACH** — `coachOf(ch, acct, owned)` in `game.js`, surfaced as
`view.coach = { label, hint, tab }`: a server-authoritative priority ladder for the single highest-value
next step (emergencies: lockup/hospital/bleeding → pull your first job (`lc_crime<1`) → declare a Path at
5 → join a family at 3 → bank a big pocket → finish the First Week → set up an earner at 8 → full-tank
nudge → silent for vets). The client renders it as a neon "▸ …" banner on the sheet with a "take me
there →" jump. **(2) FIRST-SESSION WELCOME** — a one-time modal (localStorage `omerta_welcomed`) that
orients a brand-new player (the loop, respect=level, the account-survives-death rule, the Start Here
pointer). **(3) THE GLOSSARY** — a "?" in the top bar opens a jargon panel (respect/energy/nerve/heat/
cash-vs-bank-vs-$OMR/omertà/kitchen/going-legit/prestige). **(4) EMPTY-STATE COACHING** — a `coachCard`
helper drops a "what this is / do this first" card into the Kitchen (no lab), Garage (no iron/guns),
Empire (no fronts), Black Market (empty board), and Shylock (nothing posted) instead of a blank grid.
**(5) START HERE "DO THIS NEXT"** — the guided tab now leads with the single most actionable task
(claim-ready first, else the next thing to go do). **(6) FOUNDER FUNNEL** — `GET /v1/mod/funnel`
(`growth.js:funnelStats`, mod-gated): character counts, alive/dead, respect-band level buckets, the
progression funnel (pulled-a-job / declared-path / in-a-family / linked-wallet), and per-task First-Week
claim tallies from the `first_week_step` telemetry — so the alpha can be run and drop-off watched without
a developer. `test/growth.js` covers the coach (fresh → "pull your first job", advances after a job) and
the funnel (counts + mod-gate). Verified live end-to-end in Chromium. Suite 21/21 + sim drift-0.

**LIVE-OPS DASHBOARD — "the Books" — BUILT** (`src/ops.js`, `public/admin.html`, `src/server.js`).
The founder-facing console to run the alpha without a developer — one screen for integrity, the
economy, players, and moderation. All read-only aggregation + the existing mod actions; no schema,
no §10.4 surface. Served at **`GET /admin`** (a second static file, the index.html pattern), mod-key
gated CLIENT-side — every call carries the `x-mod-key` header (stored in sessionStorage), so it
reuses the same `modAuth` the mod endpoints already enforce (no player token). Two new read
endpoints in `ops.js`: **`GET /v1/mod/overview`** (`opsOverview` — players: accounts/alive/dead/
active-24h/jailed/indicted/agents/banned; economy: AMM spot + reserves, street-tax pool, event
fund, stake pool, den book, gang-treasury total, player-wealth total, the true `$OMR` supply = the
invariants `omrBuckets`; top-8 players by respect + gangs by treasury) and **`GET /v1/mod/activity`**
(`opsActivity` — the last N telemetry rows as a live feed). The dashboard fans out to those plus the
EXISTING mod endpoints — `/v1/mod/invariants` (the §10.4 sweep, rendered as a big OK/DRIFT banner +
per-check drift), `/v1/mod/funnel` (onboarding drop-off bars), `/v1/mod/reserve` + `/v1/mod/vig`
(extraction≤inflow) + `/v1/mod/emission` (backed ratio) — and wires the mod ACTIONS behind confirm
dialogs (mint invites, confiscate, mod-kill, ban, fund reserve). Auto-refreshes every 15s.
`test/hardening.js` covers the two new endpoints (mod-gate + shape); verified live end-to-end
(genesis reads $500/$OMR + 20k supply, activity feed, a mint-invites action). Suite 21/21 + sim
drift-0. Deferred: per-player drill-down (the `/v1/mod/audit` tx/rng view exists — not yet surfaced),
charts/history (telemetry rows are there), a lever-tuning surface (BALANCE.md is still the source of
truth; live retune needs a config store).

**THE ESTATE ("the compound") — BUILT** (`src/estate.js`, `test/estate.js` — the 22nd suite; design
`omerta-estate-auction-design.md`, which also specs the paired Auction House, NOT yet built). A deep
PERSONAL $OMR sink + a new "home" surface — the first answer to the standing economy flag (every prior
burn was one-time; supply pools into staking). PURE STATUS (display-only, no gameplay power → outside
the sim-audited balance, the vanity/seal/Portfolio precedent); the ONLY §10.4 flow is the enumerated
`estate:*` $OMR BURN through the vanity `spendOmr` till (account bucket). **Account-level** (`estates
(account_id)` PK) → SURVIVES DEATH: the heir inherits the compound (never in the runEstate wipe;
`kept.estate` in the report, the Portfolio precedent). **Tiers** (`ESTATE.TIERS`, sequential like family
seals — Safe House 40 → Row House 120 → Uptown Brownstone 350 → Country Estate 900 → The Compound 2500
$OMR; `upgradeEstate` `estate:tier`); **features** (`ESTATE.FEATURES`, 10 one-time tier-gated unlocks —
Trophy Room, Wine Cellar, …, The Menagerie; `unlockFeature` `estate:feature`, `minTier`-gated + no
double-buy); **name it** (`nameEstate` `estate:name`, needs a place first); **trophies** — the board
computes a display of your ACTUAL legend from holdings (rarest car, arsenal, portfolio book value,
kills + hitman rank, family seal — display-only, moves nothing); **estate value** = lifetime $OMR sunk
(`spent_omr`). §10.4: `estate:` joined the `omr` vocabulary + `omrBurns` (status, no new bucket/faucet —
`$OMR conservation` exact with one burn term). Routes `GET /v1/estate`, `POST /v1/estate/upgrade|feature/
:id|name`; surfaced on the view (a one-line summary) + `/v1/rules` (the catalog); console gained a "The
Estate" tab (the deed, the tier ladder, the Legend trophies, the wings, naming). `test/estate.js` proves
the ladder + gates, trophies from real holdings, DEATH SURVIVAL (heir inherits), spends == ledgered
`estate:*` burns, and the §10.4 vocabulary + conservation. Suite 22/22 + sim drift-0. All numbers are
founder sign-off levers. Deferred (Estate step two): recurring **staff & upkeep** (a $OMR wage roster,
the pad/nut precedent), the gala, an estate leaderboard. **NEXT: the Auction House** — the paired
competitive/recurring $OMR sink (weekly lots, $OMR bid escrow → its own §10.4 escrow check → burn the
winning bid; design already written, build + red-team the new $OMR-escrow surface before it's done).

**THE AUCTION HOUSE ("the sit-down") — BUILT** (`src/auction.js`, `test/auction.js` — the 23rd suite;
completes the pair in `omerta-estate-auction-design.md`). The COMPETITIVE, RECURRING $OMR sink — the
economically strongest of the pair (whales bid each other up; fresh lots weekly; scales with wealth).
Server-run weekly auctions of UNIQUE numbered prestige items — highest $OMR bid wins, the winning bid
BURNS (deflationary). Status-only (won lots are account-level trophies, no gameplay power → outside the
sim-audited balance). **Lots** (`auctionLotsOf(week)` — `AUCTION.LOTS_PER_WEEK` 3 drawn deterministically
off the §7.11 seed from `AUCTION.ARCHETYPES`; each a unique numbered instance, id `<week>:<slot>`, serial
`W<week>-<n>`). **Bids ESCROW $OMR** — the bounty/loan/market-escrow twin on the $OMR side: `auction:bid`
(account→escrow) + `auction:refund` (escrow→account, the outbid player refunded EXACTLY inline) are
TRANSFERS, `auction:win` (escrow→burn, at settle) is the only deflation. A self-raise refunds in-memory
(persistAccount commits the actor); an outbid to a DIFFERENT account is a direct SQL credit (third party,
no clobber). The auction row is `FOR UPDATE`-locked (serializes same-lot bids); the cross-lot cross-refund
AB-BA maps to a clean `contention` retry. **$OMR is account-level (survives death) → a live bid needs NO
death handling** (unlike cash escrow); won trophies survive death (the heir inherits the collection).
**Settle** is worker-only (`sweepAuctions` — lots whose week is over: top bidder wins the account trophy,
winning bid burns, `status='settled'`, per-lot txn, lot row locked; the loser was already refunded on
every outbid). §10.4: `auction:` joined the `omr` vocabulary; `auctionEscrow` (SUM `current_bid` on live
lots) ADDED to `omrBuckets` so `$OMR conservation` stays exact; `auction:win` joined `omrBurns`; a NEW
**auction escrow** check (escrow == bid − refunded − won). Routes `GET /v1/auction`, `POST /v1/auction/
:lotId/bid`; `/v1/rules` catalog; console: an "Auction Block" in the Estate tab (this week's lots, bid
forms, your trophies). `test/auction.js` proves lot determinism, the floor + min-raise, outbid-refund-
exact, the self-raise net, the escrow §10.4 check mid-auction, settle (burn + grant, no extra debit),
death survival, and the closed vocabulary. Suite 23/23 + sim drift-0. All numbers are sign-off levers.
A focused red-team of the $OMR-escrow surface (escrow §10.4 exactness + the cross-refund deadlock/
lost-update, the two highest-risk surfaces) returned CLEAN — no CRITICAL/HIGH — and closed two
correctness fixes (regression each): **F1** the concurrent-first-bid materialize race (two FIRST bids
on a fresh lot both lock nothing under `FOR UPDATE`, both INSERT, the loser `23505`'d into a raw 500 —
now `deadlockToRetry` maps `23505` → clean `contention` retry, the world_npcs first-touch precedent;
the loser rolled back so no §10.4 impact, and the retry finds the row and raises), and **F2** the ops
dashboard `$OMR supply` gauge omitting the live auction escrow (now `+ SUM(current_bid) WHERE
status='live'`). **F3** (accepted-as-designed, founder call, NOT patched per ground rule #1, recorded in
BALANCE.md): the bid escrow is a windowless loot-shelter for the P1.1 $OMR loot surface — self-limiting
(no cancel; a win burns 100%), a future `auction:refund` exposure window is the sign-off lever if
whale-sheltering via outbid-churn is seen in the alpha.

**THE ENVELOPE & THE FOUNDATION — going-legit $OMR sinks on the Law surface — BUILT**
(`omerta-envelope-foundation-design.md`; founder-directed 2026-07-19). Two recurring $OMR sinks that
buy LEGITIMACY — the counterweight to the RICO antagonist, a personal/collective pair (the Law-side
Estate+Auction). Both are NEW Law levers (real power, not pure status) → founder sign-off levers, sim
+ BALANCE.md before production; NOT retunes of any signed surface. **The Envelope** (`law.js:payEnvelope`,
`POST /v1/law/envelope`) — the standing graft: a personal recurring $OMR sink (`law:envelope` burn
through the `spendOmr` till, `LAW.ENVELOPE_OMR` 15) that keeps `ch.envelope_until` current for
`ENVELOPE_MS` (7d); while current, the investigation-meter GAIN in `accrual.js` scales by
`ENVELOPE_GAIN_MULT` (0.5) — the cops bury half your file, so a case builds slower (NOT immunity — a
reckless street still indicts, and the bleed is untouched). PROACTIVE, unlike the reactive one-shot
bribe. Gated `jailed`; deliberately NOT safehouse-gated (a wire, not a face-to-face sit-down — the D2
gate is for *meeting* the man). Surfaced on `GET /v1/law` (`envelope {cost,gainMult,active,seconds}`)
+ the console Law tab "The Escapes". `persistCharacter` carries `envelope_until` ($59);
`characters.envelope_until` new column. **The Foundation** (`vanity.js:buyFoundation`,
`POST /v1/gangs/foundation`) — the family charity: a tiered institution the boss/underboss buys
SEQUENTIALLY from the gang `omr_reserve` (the `buySeal` precedent — `FOUNDATION.TIERS` Community Fund
60 → Youth League 180 → City Trust 500 → The Institute 1200 → The Legacy 3000 $OMR, `foundation:tier`
burn against the reserve, counterparty=gang, no character_id). Two faces: (1) public philanthropy
STATUS (`gangs.foundation` int, a badge on `me.gang`/`GET /v1/gangs`/`GET /v1/gangs/:id` incl.
`nextFoundation`/`foundationBustMult` + a `GET /v1/leaderboard/foundation` status board — the
hitmen/portfolio precedent); (2) it launders the family's collective RICO exposure — the tier's
`bustMult` (0.97 → 0.75) multiplies EVERY member's conviction odds in `bustProbOf(ch, now,
foundationTier)` (the one gameplay touchpoint). The tier is sourced at the two bust sites: online
(`lawBoard`/`buyJury` from `h.owned.gang.foundation`) and — crucially — offline (`resolveBust`, shared
by `demandTrial` + the `sweepLaw` worker, via a small `familyFoundationTier(client, charId)` lookup so
the offline whale the worker force-busts is covered). The `bustProbOf` min-clamp is unchanged, so the
discount bottoms out at the existing floor (composes with retainer/jury); the `LAW_BUST_P` test knob
still pins the roll (bypassing `bustProbOf`). §10.4: `law:envelope` (account bucket) + `foundation:`
(gang-reserve bucket, already in `omrBuckets`) joined the `omr` KNOWN_REASONS + `omrBurns` — both pure
deflationary burns, no new faucet/bucket, so `$OMR conservation` stays exact (the Law only DRAINS —
both help extraction-≤-inflow). A dissolved family's foundation dies with the row (`gang:dissolved`,
no orphan). Console: the Envelope card in the Law "Escapes" grid, a "The Foundation" section in the
Family dashboard (tier ladder + boss/underboss endow, badge on the header + gang list). `test/law.js`
covers the envelope (gain-mult slows the build via direct `accrue()`, ledgered `law:envelope` burn,
window extends on re-pay, jailed/broke gates, closed vocabulary); `test/social.js` covers the
foundation (rank gate, empty-reserve rejection, sequential tiers with exact reserve deltas, badge on
all three views + the philanthropy leaderboard, the monotonic `bustProbOf` odds drop, ledgered
`foundation:tier` burns). Suite 23/23 + sim drift-0. All numbers are founder sign-off levers. A
focused four-lens red-team returned CLEAN — **no CRITICAL/HIGH**: §10.4 conservation exact on both
burns (account bucket + gang-reserve bucket, no cross-contamination with the cash treasury check, no
orphan on dissolution), lock order sound (`buyFoundation`'s `FOR UPDATE` is the FIRST gang lock since
`loadOwned` reads the gang unlocked — no self-deadlock; `familyFoundationTier` is an unlocked MVCC read
so no cycle on the bust path), persist paths clobber-free, and the `bustProbOf` math correct (mults
&lt;1, clamped, `LAW_BUST_P` bypasses). Three lower findings, all DESIGN/BALANCE calls (flagged for
founder sign-off, NOT patched per ground rule #1): **(MED)** an indicted player can freeload a
high-tier family's bust-soften by joining right before `demandTrial` (an instance of the already-flagged
immediate-join posture that every family perk shares; a real gate needs join-timestamp state — a
schema+design call); **(LOW)** the `bustProbOf` min-clamp floor omits `foundationBustMult`, so a
maxed foundation delivers zero marginal reduction to a member already stacking retainer+jury at extreme
exposure (a narrow corner; the dial is whether the charity composes below the standard-defense floor);
**(LOW)** the envelope is payable while indicted where it can't help the FILED case — but it's not
wasted (an active window still slows the post-acquittal exposure rebuild), so left as-is. Deferred
(step two): a per-precinct envelope; the Foundation bleeding members' heat passively + a
Commission-standing angle + naming; a foundation-freeload gate (join timestamps) if the alpha shows abuse.
**Step two — BUILT** (three touchpoints; §10.4 untouched — all meter-rate/conviction-odds modifiers,
Law sign-off levers): **(1) the FREELOAD GATE** (closes the step-one MED) — `gang_members.joined_at`
(new column) + the Foundation's trial-soften now applies ONLY to a member who was in the family when
the case was FILED (`joined_at <= indicted_at`); joining a high-tier family after being indicted buys
nothing. Threaded through `resolveBust` (async `familyFoundationTier(client, id, indictedAt)` — the
offline whale) and the online display (`lawBoard`/`buyJury` via the sync `appliedFoundationTier(ch, h)`
off the loaded `h.owned.gangJoinedAt`). **(2) the Foundation PASSIVE HEAT-BLEED** — `FOUNDATION.TIERS[]`
gained `bleedMult` (1.15 → 2.0, `foundationBleedMult`); `accrual.js` speeds every member's
investigation-meter BLEED by it (via the new `ctx.foundationTier` threaded from `loadOwned`'s
`owned.gang.foundation`), so the charity now PREVENTS the case, not just softens a filed one
(continuous accrual → a momentary freeload join gets ~nothing, so this needs no gate). **(3) the
Envelope ACCELERATED BLEED** — `LAW.ENVELOPE_BLEED_MULT` (2); while current, the meter also bleeds 2×
faster (same accrual touchpoint), so it both builds slower AND cools faster. Surfaced on `/v1/rules`
(`envelope.bleedMult`, `foundation[].bleedMult`), `GET /v1/gangs/:id` (`foundationBleedMult`), and the
console cards. Tests: `test/law.js` (envelope + foundation accrue-bleed via direct `accrue()`),
`test/social.js` (the freeload gate — joined-before is softened, joined-after is not). Suite 23/23 +
sim drift-0. A focused four-lens red-team over the step-two deltas returned CLEAN — **no
CRITICAL/HIGH/MED**: the freeload gate is airtight (leave/rejoin only LOSES the soften, the heir starts
fresh with no membership, acquittal→re-indict is per-current-case, `joined_at` is `NOT NULL` so the
`&&` guards fail open only for a legit member, the offline `sweepLaw` path passes `ch.indicted_at`); the
×4-max bleed can't drive exposure negative (the `max(0,…)` floor) or un-file the latched case; §10.4
moves zero value (pure rate/read modifiers, no ledger rows); the `familyFoundationTier` join is an
unlocked MVCC read (no new lock edge); and the new `NOT NULL DEFAULT now()` column doesn't regress the
two explicit-column `gang_members` INSERTs. Three sign-off items flagged (NOT patched, ground rule #1):
**(L1)** the foundation bleed accelerates the meter even while indicted, so a maxed-foundation offline
whale's exposure bleeds toward `INDICT_AT` (lower `bustProbOf`) AND stacks the step-one `bustMult` on
the same trial — bounded by the min-clamp, a founder dial; **(L2)** the gate keys on join-time vs
indict-time only, so a family can upgrade the foundation AFTER a still-member is indicted and soften
that trial (consistent with "a made man in the family when the case was filed" — confirm intent); **(L3
deploy note)** there's no migration script (fresh-DB alpha + pg-mem unaffected), but an `ALTER TABLE ADD
joined_at NOT NULL DEFAULT now()` on a LIVE DB backfills existing members with the migration timestamp,
so anyone indicted before the migration transiently loses their soften for that in-flight case.
Deferred (step three): a per-precinct envelope; naming the Foundation (the Commission-standing angle is
intentionally NOT built — it would reintroduce purchasable Commission standing, which the econ-pass fix closed).

**THE DYNASTY FUND + more tickers — BUILT** (`src/portfolio.js`, `src/rules.js`; design
`omerta-the-wire-and-revenue-design.md`, which also specs THE WIRE + the ETH-revenue toolbox — NOT yet
built, pending founder direction). Pure off-chain, §10.4-clean expansion of the R1 Portfolio.
**Tickers 3 → 8** — a real risk spread, all status-only/deterministic-price (drop-in; board/leaderboard/
view iterate `TICKERS`): GLD The Vault (.05) · AAPL · AMZN (.10) · TSLA · HOOD The Green House (.16, the
Robinhood nod) · NVDA (.18) · SPCX · BTC Digital Gold (.30). **The Dynasty** — the account-level book
already survives death (the heir inherits), so it's a generational fund; now you `POST /v1/dynasty/name`
(a `PORTFOLIO.DYNASTY_NAME_OMR` 5 $OMR vanity sink, reason `rwa:dynasty` — rides the existing `rwa:%`
omr burn term + vocab, ZERO invariant changes). `account_persistent.dynasty_name` (new col); the board
surfaces `dynasty {name, generation (deaths+1), nameCost}`; `portfolioLeaderboard` now ranks DYNASTIES
(name = dynasty || street, with the living `steward` beneath). Console: a name-your-dynasty card on the
Going Legit tab. `test/portfolio.js`: the ledgered `rwa:dynasty` burn, the board/leaderboard surface,
the length gate, and the §10.4 vocabulary + conservation (drift == the test grant only; the naming burn
is conservation-neutral). The existing "no such stock" gate ticker was retargeted (NVDA is now real).
Suite 23/23 + sim drift-0. All numbers sign-off levers.

**THE WIRE — the intelligence terminal — BUILT** (`src/wire.js`, `test/wire.js` — the 24th suite;
design `omerta-the-wire-and-revenue-design.md`, design fork **A** — surveillance + premium feed —
founder-approved). Information as a spendable resource: pay to KNOW (surveil a rival) and pay to NOT be
known (sweep bugs). Off-chain, §10.4-clean — every burn is an `intel:*` $OMR sink through the vanity
`spendOmr` till, riding the EXISTING `intel:` omr vocabulary + burn term (ZERO invariant changes). The
`WIRE` rules-tail block holds every lever (`wireActive` helper). Three layers: **(1) WIRETAPS** (the
offensive sink) — `placeTap` (`POST /v1/wire/tap/:targetId`) burns `WIRE.TAP_OMR` (8) to run a
time-boxed (`TAP_MS` 12h), concurrent-capped (`TAP_MAX` 5) wire on ONE living rival (self/gone/capped
gates; upsert via SELECT-then-write, pg-mem-safe). While live it reveals — via `tapIntel`, a
point-in-time read, never exact books — the mark's **Law stage** (`rapStageOf`) + heat band, a **wealth
band**, their **ops counts** (businesses / character_rackets / territory_rackets / family), whether
they're **WANTED**, and the money signal: **are they HUNTING you** (a search on `(their id → your id)` —
pierces the intel-peek space). **(2) SWEEP** (the defensive sink) — `sweepBugs` (`POST /v1/wire/sweep`)
shows `bugsOnYou` and clears every tap on you for `WIRE.SWEEP_OMR` (5); **FREE when clean** (the peek
precedent — no charge, no-op). **(3) THE STREET WIRE** (the recurring premium sink) — `subscribeWire`
(`POST /v1/wire/subscribe`) burns `WIRE.SUB_OMR` (12) for a `SUB_MS` (7d) window (extends from the later
of now / current end — the retainer/envelope precedent), upgrading `GET /v1/wire` into an intelligence
service: the **ticker tape** (RWA prices + the day's mover — the Dynasty tie-in, free to all), plus
(subscribers only) **Law forecasts** (`cityForecast`), **threat chatter** (a COUNT of hunters with a
search on you + open contracts on your head — a COUNT never a NAME: the layered intel economy — the SUB
warns, a TAP IDs a specific rival, the $OMR peek names funders), and the **war room** (your family's
turf + war score). A tap READ is UNLOCKED (surveillance, not a two-party action — no lock complexity);
reads filter `expires_at` + JOIN `alive`, so a dead party's wire goes silent; the worker `sweepWire`
tidies expired rows (row hygiene — the reads already filter). New `characters.wire_until` column
(persisted, $60) + `wiretaps` table (`PK(watcher,target)`, `ix_wiretaps_target`). §10.4: `intel:*` is
already a recognized burn — the test proves the ONLY $OMR drift is the SQL grant, so every wire spend
reconciles as a burn. Console: a new **"The Wire"** tab (the WS side-panel renamed "Live Feed" to
disambiguate) — the Street Wire subscribe card, the ticker tape, a run-a-wire target picker + live
intel cards, the sweep-your-lines card, and (subscribed) the war room + Law forecast; `describe()`
humanizes tap/sweep/subscribe; `/v1/rules` gained a `wire` block; the raw deck gained a Wire group.
`test/wire.js` covers the terminal, the tap sink + gates + INTEL (law/wealth/ops/huntingYou), bugs +
sweep (free-clean vs charged-clears), the subscription + premium feed, the worker sweep, and the §10.4
vocabulary + conservation. Suite 24/24 + sim drift-0. All numbers are founder sign-off levers.
**Step two — THE BUG TRACE + THE DOSSIER + THE SPYMASTER — BUILT** (`src/wire.js`, `test/wire.js`; a
content expansion for the flat terminal — progression + counter-intel + a premium read, all $OMR sinks
through the EXISTING `intel:` vocabulary, so **ZERO invariant changes**). **(1) THE BUG TRACE** (`traceBugs`,
`POST /v1/wire/trace`) — the sweep's offensive twin: NAMES every live watcher on your line (counter-intel —
now you know who to tap back or hit) for `WIRE.TRACE_OMR` (15, `intel:trace`), and — unlike the sweep — does
NOT clear them (the layered intel economy: sweep clears cheap+anonymous, trace names but leaves them). FREE
when clean (the sweep/peek precedent). **(2) THE DOSSIER** (`pullDossier`, `POST /v1/wire/dossier/:targetId`)
— a one-shot DEEP read (`WIRE.DOSSIER_OMR` 20, `intel:dossier`) beyond a standing tap: the mark's KILL
RECORD (from `kill_log`), their flags (wanted/welsher/rat/indicted), their family ROLE, and — the
counter-intel payload — WHO THEY'RE TAPPING. Deliberately keeps wealth BANDED (never exact cash — the
audit's anti-precise-kill-EV rule holds). **(3) THE SPYMASTER** — `account_persistent.intel_ops` (lifetime
intel actions, bumped by every tap/sweep/trace/dossier/sub via direct SQL, INT + 1 literal — the
boxing-legend precedent; account-level → SURVIVES DEATH) + `WIRE.SPY_RANKS` (Eavesdropper → The Oracle,
`spyRankOf`) + `GET /v1/leaderboard/wire` (`wireLeaderboard` — the hitman-rep board twin). Pure STATUS.
Surfaced on `GET /v1/wire` (`spymaster {ops, rank}` + the trace/dossier costs) + the console Wire tab (the
Spymaster banner + leaderboard, a trace button on the sweep card, a dossier target-picker → a deep-read
popup). §10.4 untouched — the sim's `reason vocabulary` + `$OMR conservation` stay drift-0 (every wire
spend reconciles as an `intel:*` burn). `test/wire.js` proves the trace (names watchers, doesn't clear,
free-clean), the dossier (kill record + flags + who-they-tap, banded wealth, self-gate), and the spymaster
ops + leaderboard. Suite 30/30 + sim drift-0. All numbers are founder sign-off levers.
**Step three — THE COUNTER-INTEL TRIAD (DISINFORMATION + THE INFORMANT) — BUILT** (`src/wire.js`,
`test/wire.js`; the surveillance rock-paper-scissors — all $OMR sinks through the EXISTING `intel:`
vocabulary, so **ZERO invariant changes**). A cheap WIRETAP is machine surveillance → foiled by
DISINFORMATION; an expensive INFORMANT is a HUMAN source → SEES THROUGH the disinfo (a mole can't be fed
lies). **(1) DISINFORMATION** (`plantDisinfo`, `POST /v1/wire/disinfo`): a defensive `WIRE.DISINFO_OMR`
(10, `intel:disinfo`) sink sets `characters.disinfo_until` (12h; written by DIRECT SQL — the
wire_until/active_at pattern, off persistCharacter's positional UPDATE so it survives persist). While
current, any WIRETAP reading you (`scrambleTap`) gets deterministic-but-wrong PRIVATE signals (cooked
wealth/law-stage/heat/ops + `huntingYou` forced false, `indicted` false) — SILENT (no "this is fake"
flag; the counter is a human source or a records-based dossier). PUBLIC bulletins stay TRUE (wanted, the
family name, level, location — you can cook your books, not the street's eyes). **(2) THE INFORMANT**
(`recruitInformant`, `POST /v1/wire/informant/:targetId`): a standing HUMAN source — a recurring
`WIRE.INFORMANT_OMR` (25, `intel:informant`) retainer (extends from later-of-now/current-end, the sub
precedent), capped `INFORMANT_MAX` (3), one per (watcher, target), in the new `wire_informants` table. It
reads DEEPER than a tap (`huntingAnyone` — who they're hunting, not just you) and **PIERCES disinfo** (the
board applies `scrambleTap` only to taps, never to informant reads — a mole isn't fooled by cooked books).
So the layered economy completes: the SUB warns (a COUNT), a TAP IDs a rival (foilable), the DOSSIER reads
records, an INFORMANT is the reliable standing source, and DISINFO is the counter to the cheap tap. Death:
`wire_informants` rows die with either party (the wiretap precedent in runEstate); `disinfo_until` rides
the character row. The worker `sweepWire` now also reaps lapsed retainers. Board (`GET /v1/wire`) gained
`informants` (the true reads), `disinfo {active,seconds}` (your own smokescreen), and the step-three costs;
`/v1/rules` + the console Wire tab (an Informants section + a Disinformation card) surface them.
`test/wire.js` proves disinfo cooks a tap (the hunt hidden, indicted false), the informant PIERCES it (true
`huntingYou`/wealth + `huntingAnyone`), the self/gone/cap gates, the worker sweep, and §10.4 ($OMR
conservation drift == the test grant only — every wire spend an `intel:*` burn). Suite 30/30 + sim drift-0.
All numbers are founder sign-off levers. A **three-lens red-team over step three**
(`AUDIT-wire-step-three.md`: §10.4/persist/$OMR, concurrency/locks, exploit/info-leak/grief) returned
**no CRITICAL/HIGH/MED — CLEAN**: every `intel:*` spend rides both the omr vocabulary and the burn term
(zero faucet); `disinfo_until`/`intel_ops` are direct-SQL columns absent from the persist positional
UPDATE (no clobber); all routes single-party under withCharacter (the upsert serializes on the actor lock,
reads never lock a second character → no AB-BA); wealth stays BANDED everywhere (the anti-precise-kill-EV
rule); `scrambleTap` is non-invertible (hashes on target+day, fully replaces the private fields) and keeps
`wanted`/family/level/loc TRUE (a wanted man can't hide); self/dead/heir gates + `alive`-JOINs sound; a tap
is a read so grief is cost-bounded. Two LOW notes left as-is (ground rule #1): the scramble's hardcoded
`indicted:false`/`huntingYou:false` are the DOCUMENTED, TESTED "cook the private signals / hide the hunt"
behavior (disinfo is a bluff, countered by the informant/dossier), and the unlabeled Spymaster leaderboard
matches the world/territory boards (a $OMR-bought, payout-free status axis — agent inclusion is consistent).
A persist-clobber regression was added (disinfo survives a later persisting action). Suite 30/30 + sim
drift-0.
**Step four — THE SPYMASTER'S TRADECRAFT + THE WATCHDOG — BUILT** (`src/wire.js`, `src/rules.js`,
`src/worker.js`, `schema.sql`, `test/wire.js`; the progression + push layer the flat intel loop lacked —
every action was a one-shot flat cost, and all intel was PULL). **(1) TRADECRAFT** — the earned
`SPY_RANKS` ladder (lifetime `intel_ops`, account-level, survives death) now GRANTS PERKS (the
Underworld-tier / skills precedent; single-touchpoint modifiers OFF §10.4 — the DISCOUNTED amount is what's
`spendOmr`'d/ledgered): `tapBonus` (Eavesdropper 0 → The Oracle +5 concurrent WIRE slots) + `discountBps`
(0 → 30% off every offensive intel READ — tap/informant/dossier). `spyPerksOf`/`intelCost` helpers;
placeTap uses `TAP_MAX + tapBonus` for the cap + `intelCost(TAP_OMR, ops)` for the charge; recruitInformant/
pullDossier discount too (defensive sweep/trace/disinfo + the sub stay flat). So working the wires makes
you a better spymaster — deeper reach + cheaper tradecraft. **(2) THE WATCHDOG** — a SUBSCRIBED watcher (the
premium Street Wire) is PUSHED a live `wire_alert` the moment a mark they're tapping crosses into a
noteworthy state — starts HUNTING them (a search on the watcher), goes WANTED, or gets INDICTED — via a new
worker sweep `sweepWireAlerts` (self-contained, re-derives state each tick, NO cross-module hooks). Fired
ONCE per event per tap (new `wiretaps.alerted_hunt/_wanted/_indicted` flags, RESET on a tap place/refresh),
gated on the watcher being alive AND `wire_until > now` — so it's a real reason to keep the recurring sub
(the pull-only terminal becomes an active intelligence service). §10.4-UNTOUCHED (the discount rides the
existing `intel:` burns — the discounted number is the burn; the watchdog pushes a notification, moves no
value). `intel_ops` is read inline (`spyOps`) so the perk applies under withCharacter. The board surfaces
`spymaster {tapBonus, discountBps}` + `tapMax` (raised) + `watchdog` + the discounted `costs`; `/v1/rules`
gained `wire.spyRanks`; the console Wire tab shows the tradecraft line + a WATCHDOG-live banner. `test/wire.js`
proves the rank perks (Spymaster → +2 slots / −10%, the discounted tap burn), the raised cap surfaced, and
the watchdog (fires on wanted, once-per-event, un-subscribers get nothing, a re-tap re-alerts). Suite 32/32
+ sim drift-0. All `SPY_RANKS` perk numbers are founder sign-off levers (status-axis modifiers, off the
signed economy — the hitman-rep/Underworld precedent). Deferred (step five): an auto-tap/standing-watch
automation + a tiered subscription ladder. A focused three-lens red-team (`AUDIT-wire-step-four.md`:
§10.4/economy, watchdog worker concurrency, exploit/grief/info-leak) returned **no CRITICAL/HIGH** and
applied one MED hardening: the watchdog's notify-then-flag wasn't idempotent under concurrent workers/
retries → converted to **claim-then-notify** (the fees/store discipline — the per-flag `UPDATE … AND
<col>=false` atomically guards the notify, so exactly one pass alerts per event). Verified CLEAN: the
discount stays a burn (recomputed server-side, no client-set price, floors at 1, no free rank-grind
since sweep/trace early-return before the ops bump), the subscribe-gated alive-JOIN'd watchdog (no
stale/lapsed-sub alerts, flags off persistCharacter), and no new info-leak (the push only surfaces what
a paid live tap already reveals).

**THE STORE — ETH revenue packages — BUILT** (`src/store.js`, `test/store.js` — the 25th suite; design
`omerta-eth-store-design.md`). Real-money packages, off-chain-first / chain-dormant (the M6 pattern),
**§10.4-neutral BY CONSTRUCTION**, mainnet gated on legal + a third-party audit of contracts AND the
payment signer. **The one design decision that makes it safe: the Store grants ONLY non-§10.4 things** —
entitlements (`mint_credit`/`respawn_token`), access windows (`pass_until`/`wire_until`), and status
(`patron`); **never** cash / $OMR / gear / sim-audited power. So it writes ZERO `transactions` rows (the
`fees.js` out-of-band precedent — those entitlements were always outside the conservation set), needs no
new §10.4 reason/bucket/vocabulary, and a full purchase run leaves EVERY §10.4 check at drift-0 (proven
in the test). Also anti-pay-to-win (a skilled free player still tops the boards) and legally clean (ETH
buys cosmetics/access/consumables, never tokens/securities/RWA-by-chance). **The three-way revenue split**
(`STORE.SPLIT_BPS`, env `REVENUE_{FOUNDER,BUYBACK,RWA}_BPS`, default 4000/4000/2000, validated to sum to
10000 at load): each payment's ETH already hit the dev wallet on-chain (the `OmertaFees` tollbooth); the
Store records the *earmark* — **founder** (profit, recorded), **buyback** (→ the EXISTING `vig_revenue`,
source `store`, so `runVigBuyback` buys $OMR → funds the reserve + season prize pool — this is how
"spenders fund earners", and `runVigInvariants` `spend ≤ revenue` absorbs Store revenue unchanged), and
**rwa** (→ a new `rwa_revenue` bucket, **R2 DORMANT** — recorded, never spent until the legal-gated real-
RWA reserve ships). The existing mint/respawn gameplay fees keep their legacy `VIG_BPS` posture (they're
gameplay fees, not Store SKUs). **Packages** (`STORE.PACKAGES`, all sign-off levers): `made_man` (0.01 →
mint credit), `revive_3`/`revive_5` (0.25/0.40 → respawn tokens), `wire_month` (0.03 → +30d Street Wire),
`season_pass` (0.05 → +30d `pass_until` + 2 revives + the `patron` badge), `patron` (0.10 → permanent
patron badge). `pass_until`/`patron` are `account_persistent` (SURVIVE DEATH — a paid benefit carries to
the heir, the `minted` precedent). **The mechanism** (`recordStorePurchase`, the `recordFeePayment` twin):
idempotent on `store_payments.nonce` (a re-delivered event is a no-op; non-23505 rethrows so the watcher
cursor never advances past an unrecorded payment — the fees.js F1 discipline); `splitRevenue` records the
three-way earmark same-txn; grant now if the wallet's linked + value carried, else the row waits for
`reconcileStore` (claim-then-grant, exactly-once, case-insensitive — run at SIWE link in `walletVerify`
+ swept by `sweepUncreditedStore`). Grants are headless direct-SQL (the fees.js no-clobber discipline).
**Chain layer DORMANT** (the on-chain `OmertaFees.payForPackage` + a `StorePaid` watcher are the mainnet
milestone, unbuilt — Foundry-gated); this drop ships the full backend + a mod comp/simulate route
(`POST /v1/mod/store/grant`, mod-key, synthetic nonce) for comps/QA/until-the-paywall-ships, which the
test drives directly (the test/chain.js fee precedent). Routes: `GET /v1/store` (catalog + your
entitlements), `GET /v1/mod/revenue` (the founder's three-way split — also on the admin dashboard's
chain panel), `POST /v1/mod/store/grant`. Console: a **"The Store"** tab (the anti-p2w pitch, what you
hold, the shelf, the pay-before-link note); `/v1/rules` gained a `store` catalog; the raw deck's Chain
group gained store + PLEX routes. `test/store.js` covers the board, exact split math, idempotency,
per-SKU grants, pay-before-link reconcile (exactly-once), zero-value no-grant, §10.4 NEUTRALITY (every
check drift-0), and the buyback share funding the Vig flywheel (spend ≤ revenue holds; RWA recorded-only).
Suite 25/25 + sim drift-0. All prices/splits are founder sign-off levers.

**THE LEDGER — the Season Pass reward track — BUILT** (`src/pass.js`, `test/pass.js` — the 26th suite;
finishes the Store's flagship recurring product, the deferred item from the Store drop). A daily-claim
"battle pass": while the Season Pass is active (bought in the Store for ETH), `POST /v1/pass/claim`
grants the NEXT tier once per `passClaimMs()` (~20h; `PASS_CLAIM_MS` is a TEST-ONLY knob read per-call,
the SEARCH_MS precedent), escalating up a 12-tier `PASS.TRACK` (rules tail). **Anti-pay-to-win +
§10.4-safe by construction:** rewards are STATUS (a street title into the `characters.title` slot),
CONSUMABLES (revive tokens — out-of-band account entitlements; an energy refill — not currency), and a
small **$OMR STIPEND** on three tiers (2/3/5, capstone) — a redistribution the pass's OWN buyback share
funds, NEVER an unbacked mint. So the pass closes the "spenders fund earners" loop end-to-end: the
buyer's ETH → buyback → prize pool → their own stipend (bounded below what the pass contributed).
**The stipend is ACCRUED as OWED at claim** (`account_persistent.pass_owed`, in the SAME txn as the tier
advance — so the reward is never lost) and paid down by **`settlePassStipend`** from the backed prize
pool (credits `prize:omr` + moves the same $OMR pool→reserve via `fundReserve` — pool-bounded, always
backed). `settlePassStipend` is STANDALONE (not nested in the withCharacter claim txn), so it locks the
pool singleton FIRST then the account — the SAME order as `payPrizes`/`runVigBuyback` → **no AB-BA
deadlock**. The claim route pays it best-effort (a failure/dry-pool leaves it owed, never fails the claim
or mis-advances the track — the **red-team HIGH/MED fix**: the post-commit-payout seam is replaced by a
durable owe + the stake-pool "pending, no forfeit" pattern), and the worker `sweepPassStipends` is the
net that pays every owed stipend as the pool funds. **Self-contained** — the track advances only on claim
(zero touchpoints in other modules). Account-level state (`account_persistent.pass_tier`/
`pass_at`) → **the track SURVIVES DEATH** (the heir keeps claiming what the pass paid for), and buying the
pass while LAPSED starts a **fresh season** (`store.js:grantPackage` resets the track; renewing an ACTIVE
pass keeps progress). Routes: `GET /v1/pass` (the board — tier/track/cooldown/stipend pool), `POST
/v1/pass/claim`; `/v1/rules` gained a `pass` block; console: a **"The Ledger"** section on the Store tab
(progress bar + the tier grid + claim); `describe()` humanizes the claim; raw deck gained the pass routes.
`test/pass.js` covers the no-pass gate, the board, the daily claim (title/revives/energy), the ~daily
cooldown, the **owed-stipend path** (a DRY pool accrues the owe + advances the tier + pays $0 now; a
buyback funds the pool; `sweepPassStipends` pays the owed — never lost), the rest of the track's stipends
paid inline (totalling 10 $OMR, pool-bounded, never minted), the complete gate, §10.4 (`prize:omr`
reconciles at drift-0), DEATH SURVIVAL, and the fresh-season reset. Suite 26/26 + sim drift-0. A focused
red-team confirmed the critical property (the stipend can never mint unbacked $OMR / extraction ≤ inflow
holds end-to-end through the backed rail) and flagged the post-commit-payout seam (lost stipend + track
mis-advance on a payout failure or dry pool) — fixed by the owed-accrual + `settlePassStipend` +
worker-sweep design above. All numbers are sign-off levers.

**THE DYNASTY FUND (dividends + tiers) — BUILT** (`src/portfolio.js`, `test/portfolio.js`; the RWA "going
legit" endgame turned from pure status into a PRODUCTIVE, generational asset — the deferred Dynasty vision).
RWA holders now earn a **~daily $OMR DIVIDEND** on their book, paid from a sink-fed pool — §10.4-clean via
the **stake-pool pattern** (a transfer, never a mint). **Funding:** a `PORTFOLIO.DIVIDEND_BPS` (15%) slice
of every PERSONAL `invest` is redirected from the burn into the new `rwa_dividend_pool` singleton (a §10.4
$OMR bucket, added to `omrBuckets`) — ledgered `dividend:fund` (a TRANSFER, account→pool, in neither the
mint nor burn term), the rest still burns `rwa:invest`. So **new capital pays existing holders' yield, like
a real fund** ("spenders fund holders"). **Claim** (`claimDividend`, `POST /v1/portfolio/dividend`): pays
`min(bookValue × DIVIDEND_DAILY_BPS (0.30%), pool)` — POOL-BOUNDED (the stake-pool "backed emission" rule —
the fund pays only what investment funded it), ledgered `dividend:omr` (a TRANSFER, pool→account), on a
~daily cooldown (`DIVIDEND_MS`); a dry pool is a clean `dry` refusal that doesn't burn the cooldown, a
no-book is `nothing`. Locks the pool singleton under the withCharacter account lock (canonical singletons-
last; concurrent claims serialize on it, no AB-BA — nothing else locks pool-then-account). **TIERS:**
`DYNASTY_TIERS` (Nest Egg 100 → Trust Fund 500 → Blue Blood 2500 → Old Money 10000 → The Dynasty 50000
$OMR) is pure STATUS on the monotonic `account_persistent.rwa_invested` (bumped each personal invest — the
estate/seal precedent, outside §10.4). Both survive death (account-level → the heir keeps the fund + the
tier). §10.4: `dividend:` joined the omr `KNOWN_REASONS` (a transfer prefix, in NEITHER `omrMints` nor
`omrBurns`) + `rwa_dividend_pool` joined `omrBuckets` — so `$OMR conservation` stays exact (the test proves
the ONLY drift is the SQL grants; the dividend split + claim reconcile as transfers). Board (`GET
/v1/portfolio`) gained `dividend {pool, rateBps, estimate, claimable, cooldown}` + `dynasty {invested,
tier, nextTier}`; console: a "The Dynasty Fund" card on the Going Legit tab (tier badge + the daily
dividend claim); `describe()` humanizes the payout. `test/portfolio.js`: the invest split (85% burns / 15%
funds the pool, both ledgered), the tier ladder, the dividend claim (pool→account transfer, exact pool
decrement), the ~daily cooldown, the dry-pool refusal (drained the §10.4-clean way — a whale claims it
empty), and §10.4 conservation holding with the dividend transfers in the mix. Suite 26/26 + sim drift-0.
All numbers (`DIVIDEND_BPS`, `DIVIDEND_DAILY_BPS`, `DIVIDEND_MS`, the tier floors) are founder sign-off
levers. Deferred (Dynasty step two): the FAMILY dividend (the gang book earns too), dividend compounding/
auto-reinvest, a dynasty crest cosmetic.

**STILL NEXT (deferred, ranked):** the on-chain `OmertaFees.payForPackage` + the `StorePaid` watcher
wiring (the mainnet milestone, Foundry + audit gated); PLEX-for-packages (pay a SKU from earned $OMR, the
`payPlex` pattern); named landmarks / Founder's charter numbers; R2 (the `rwa_revenue` → real-RWA-buy bot
+ the reserve backing Dynasty shares — legal-gated); and the Dynasty Fund's family-book dividend + crest.

**NIGHT-SESSION FEATURES F1–F4 — BUILT** (`src/portfolio.js`, `src/store.js`, `src/landmarks.js` — the
27th suite `test/landmarks.js`; all off-chain, §10.4-clean, numbers are founder sign-off levers). Clears
four items off the STILL-NEXT list. **F1 — family-book dividend** (`portfolio.js:claimFamilyDividend`,
`POST /v1/gangs/portfolio/dividend`): the gang RWA book yields a ~daily $OMR dividend to the treasury
RESERVE, paid from the shared sink-fed `rwa_dividend_pool` (a §10.4 TRANSFER pool→reserve, pool-bounded,
never a mint; boss/underboss; gang→pool lock order). **F2 — PLEX-for-packages** (`store.js:payPackagePlex`,
`POST /v1/store/plex/:sku`): pay a Store SKU from EARNED $OMR — a `plex:<sku>` burn (the plex:% term) for
the SAME non-§10.4 entitlement an ETH payer gets ($OMR shrinks supply, ETH funds the Vig). Market-linked
quote (`plexPackageQuote` = max(floor, feeEth × latest-buyback-oracle × `PLEX_PREMIUM_BPS` 1.2); floor
`PLEX_FLOOR_OMR_PER_ETH` 5000 before a first buyback prints). In-context grant routes persisted columns
through memory (mint_credits/respawn_tokens via h.acct, wire_until via ch) — no clobber; patron/pass_*
direct SQL. **F3 — named landmarks** (`src/landmarks.js:dedicateLandmark`, `GET /v1/landmarks` +
`POST /v1/landmarks/:districtId`): ONE dedicable plaque per district (`LANDMARKS.PLACES`), held by the
biggest $OMR flex; dedicating BURNS the $OMR (`vanity:landmark` → vanity:% term, deflationary, a flex not
escrow — no refund on takeover), bears the account dynasty name → survives death (a monument). **F4 —
family dynasty** (`portfolio.js:nameFamilyDynasty`, `POST /v1/gangs/portfolio/name`; `familyPortfolioLeaderboard`,
`GET /v1/leaderboard/family-portfolio`): the boss/underboss names the family RWA book from the reserve
(`FAMILY_DYNASTY_NAME_OMR` 15, `rwa:dynasty` burn — rides rwa:%, zero invariant change); the crest tier
(`dynastyTierOf` on monotonic `gangs.rwa_invested`) + a family-legit leaderboard. Console: F1 dividend
button, F2 PLEX buttons, F3 City-tab Landmarks section, F4 fund-naming + crest + family board on the Going
Legit tab. `TICKERS` also went 3→8 and BTC→GME (the Robinhood-tradeable set). Suite 27/27 + sim drift-0.

A **four-lens max-effort SHAKEDOWN** (F4 dynasty; dividend-pool + PLEX economics; death/estate +
dissolution across every new surface; walkthrough softlock/gate) found **no CRITICAL/HIGH** and fixed
three real bugs in-commit (regression each): **F4 MED-1** — `nameFamilyDynasty`/`nameDynasty` gained a
same-name no-op guard (the `changeName` precedent) so an accidental double-click / same-name spam no
longer re-burns $OMR (the family one drained the SHARED reserve); **Store PLEX MED-1** — `payPackagePlex`
now refuses `made_man` while already `minted` (a dead, unspendable credit) and a pure `patron` re-buy,
BEFORE the burn (the `vig.js:116` precedent it had dropped), so the player keeps their earned $OMR;
**Estate L2** — a dead break-leader's co-op plan is abandoned AT DEATH (the crew_heists precedent), and
the regression uncovered a latent brick — abandonment left orphaned `pen_break_members` rows that blocked
stranded crew from planning a fresh break (UNIQUE collision); now DELETEs them like disband/sweep already
do. §10.4 verified exact across all death/dissolution paths (every new account-level holding survives the
estate wipe + heir inherits; every gang-level holding burns/releases on dissolution, no orphan). Flagged
for founder sign-off (NOT patched, ground rule #1, in BALANCE.md): **A1** the shared dividend-pool has no
per-account allocation so the biggest book can starve small funders (§10.4-CLEAN redistribution, not a
leak — a per-contributor cap is the dial); uncapped underboss fund-renames (boss-only is the dial); and
the dormant on-chain Store `grantPackage` guard + wire_month-before-character reconcile + concurrent
extension lost-update (the on-chain Store wiring milestone, mainnet-gated). Shakedown loop continues.

**THE SPEAKEASY (step one) — BUILT** (`src/speakeasy.js`, `test/speakeasy.js` — the 28th suite; design
`omerta-speakeasy-design.md`). The game's first SOCIAL HUB — a place to *be seen*. A scarce, prestigious
nightclub a made man opens and runs; ties **business** (a front that farms cash), **casino** (hosts the
games — deferred), and **social** (where you're seen with your family). Founder-directed; numbers are
sign-off levers; off-chain, §10.4-clean. **ONE club per district** (`speakeasies.district_id` PK — the
territory-racket pattern), owned by a character (`MIN_LEVEL` 15, `OPEN_COST` $750k cash SINK
`speakeasy:open`); **dies with the proprietor's street** (the business precedent — a marked man's club is
at stake; `wipeSpeakeasyAtDeath` in runEstate wipes the club + its guest list), which frees the district.
No turf/seizure in step one. **The proprietor**: `collectSpeakeasy` banks the base bar take (lazy, capped
`INCOME_CAP_MS` 24h, faucet `speakeasy:income`, safehouse-blocked D2); `upgradeSpeakeasy` climbs the decor
ladder (`TIERS` Backroom → Lounge → Blue Room → Copa → Cathedral — income + prestige, collects pending at
the old rate first, sink `speakeasy:decor`); `nameSpeakeasy` is a $OMR vanity burn `vanity:speakeasy`
(rides vanity:%, no-op guard). **The patron (being seen)**: `visitSpeakeasy` — **buy a round**, district-
pinned (`ch.loc`), a two-party CASH transfer patron→owner (the `bodyguard:hire` pattern EXACTLY: owner
nets 98%, 1% street tax → buyback, 1% dev off-ledger; `speakeasy:round` both sides), joining the club's
**guest list** + bumping its prestige; gates own-club (withTwoCharacters `self`) / owner-alive (re-read
under lock) / jailed / hospitalized / safe-housed / per-(patron,club) cooldown `VISIT_CD_MS` 1h.
`bottleService` — the ultra-premium **$OMR** flex: a pure-status deflationary BURN `vanity:speakeasy`
(no owner cut) + big prestige, prominent on the guest list (allowed at your own club). `REGULAR_VISITS`
(10) makes a patron a **regular** (status); the club's stored **prestige** (tier floor + round/bottle
bumps) ranks the nightlife on `GET /v1/speakeasy`. §10.4: `speakeasy:` joined the cash `KNOWN_REASONS`
(all character_id'd — check (a) reconciles; the tax/dev split is the audited `bodyguard:hire` mechanism),
bottles/naming ride `vanity:%` (zero omr change). Routes `POST /v1/speakeasy/:district/open|round|bottle`,
`/v1/speakeasy/collect|upgrade|name`, `GET /v1/speakeasy`; surfaced on the view + `/v1/rules` + a "The
Speakeasy" console tab (your club, the nightlife map, buy-a-round/bottle where you stand). `test/speakeasy.js`
covers the open gates, the capped bar take + safehouse gate, the decor ladder, naming + no-op, the round
(two-party taxed transfer + guest list + cooldown/travel/self/jail gates), the regular status, bottle
service, the board, DEATH (club goes dark + guest list clears + district reopens), and §10.4 (per-character
cash reconciles + vocabulary + the $OMR burns). A focused red-team returned CLEAN (no CRITICAL/HIGH/MED —
§10.4 exact, the round IS the audited `bodyguard:hire` transfer verbatim); the one LOW fixed was the
round's lock order (singleton-last restored). **Step two — BUILT** (the living gaming venue): **(1) the
back-room TABLE** (`playTable`, `POST /v1/speakeasy/:district/table`) — the club hosts the wheel; a patron
bets CASH (district-pinned, `TABLE.MIN_BET`..`MAX_BET`), the **owner takes a RAKE** carved from the stake
(`TABLE.RAKE_BPS` 3%, `speakeasy:table:rake` — a transfer, never minted on top; the casino discipline), the
wager plays at `WIN_P` 0.48 and a win pays 2× (`speakeasy:table:win` faucet / `:bet` sink, the edge burns);
two-party, CASH only (the Den's rule), collusion is −EV (lose ~7% to funnel 3%), draws notoriety.
**(2) the PROHIBITION RAID** (`resolveRaid`, the business-raid pattern) — **notoriety** accrues from the
table (`TABLE.NOTORIETY` 8) + patronage (`ROUND_NOTORIETY` 2), decays hourly; past `RAID_THRESHOLD` (60)
the owner's `collectSpeakeasy` rolls a lazy raid that SEIZES pending (never minted), FINES the owner
`RAID_FINE_RATE` (15%) of the value sunk clamped to pocket+bank (`speakeasy:raid` sink), and SHUTTERS the
club `RAID_SHUT_MS` (2h — no rounds/table/income while dark, `income_at` pushed to `shut_until`);
`SPEAKEASY_RAID_P` is a TEST-ONLY roll knob (the BUSINESS_RAID_P precedent). New `speakeasies` columns
`notoriety`/`notoriety_at`/`shut_until` (estate-wiped). §10.4: `speakeasy:table:*` + `speakeasy:raid` ride
the existing `speakeasy:` cash prefix (zero invariant change — the rake is a transfer, the win a faucet,
all character_id'd; the fine a sink; seized pending never ledgered). Console: the table + notoriety/raid
status on the tab. `test/speakeasy.js` extended (table rake/win/notoriety/gates + the forced raid seize+
fine+shutter + the shut gate). A focused step-two red-team then closed two findings (regression each):
**HIGH-1 (anti-grief)** — unlike the business raid (owner-only scrutiny), a club's notoriety comes from
OTHER players' patronage, so a rival could flood the table/rounds to force ~$300k raids on the owner at
~$70/play; now each `(patron, club)` pair adds at most `PATRON_NOTORIETY_CAP` (24, deliberately <
`RAID_THRESHOLD`) notoriety per rolling 24h via a `chargeNotoriety` token bucket (the D3-wash pattern,
new `speakeasy_patrons.noto_used`/`noto_at`) — legit play stays uncapped, only the HEAT one account can
generate is bounded, so a hot club needs genuinely distinct traffic; **MED-1** — `upgradeSpeakeasy` now
resolves a pending raid first + refuses while shuttered (an owner had dodged the raid roll, and resumed
income mid-shutter, by upgrading instead of collecting). Suite 28/28 + sim drift-0. **Step three — the
revenue layer + the endgame social loop — BUILT** (`src/speakeasy.js`/`src/store.js`; all off-chain,
§10.4-clean, numbers sign-off levers). **(A) cross-club RENOWN** — a personal nightlife-legend axis, pure
DERIVED status (no column, dies with the street — the Commission-seats "recompute on read" precedent):
`floor(Σ spent_cash / RENOWN.CASH_PER + Σ spent_omr × OMR_WEIGHT + ownClubPrestige × OWNER_WEIGHT)` over
every `speakeasy_patrons` row + own club (bottle-$OMR weighted heaviest — the flex pays the most);
`RENOWN.RANKS` ladder (Nobody → King of the Night); `GET /v1/leaderboard/nightlife` (the hitmen-board
full-scan); board `yourRenown`. Outside §10.4 + the sim-audited balance (the hitman-rep argument). **(B)
the P2P BUYOUT** (a district clears without a death) — `listSpeakeasy(price)`/`unlistSpeakeasy` set
`speakeasies.sale_price` (bounds `SALE_MIN`/`SALE_MAX`); `buySpeakeasy` (two-party
`withTwoCharacters(buyer, seller)`) transfers ownership for a TAXED cash transfer buyer → seller (the
round/bodyguard pattern EXACTLY — seller nets 98%, 1% tax → buyback, 1% dev off-ledger; `speakeasy:buyout`
both sides, already vocabularied). The seller's pending take (+ any pending raid) settles for THEM first;
the guest list resets (a fresh house); the club keeps its build (tier/name/prestige) but decor REVERTS to
stock (a style is an account-level owner-bound entitlement — the seller keeps the unlock, the buyer brings
their own). Buyer gated `MIN_LEVEL`/one-per-man/at-district/jailed/hospitalized/safehoused/cash. A SHUT
club (raided-at-handover or already dark) keeps
`income_at = shut_until` so the buyer waits out the shutter (consistent with the round/table `isShut`
gate). §10.4: a taxed transfer + a normal income collect — zero invariant change. **(C) the ETH COSMETIC
DECOR tier** (the revenue foothold) — cosmetic club *decor styles* (display-only skins) sold through the
EXISTING Store rail (the whole revenue mechanism — three-way split, PLEX-in-earned-$OMR, idempotency,
reconcile-at-link — already built + audited): new `STORE.PACKAGES` SKUs (`decor_deco`/`decor_gilded`/
`decor_midnight`, grant `{cosmetic}`) grant an account-level unlock (`store_cosmetics (account_id, style)`
PK — SURVIVES DEATH, the patron-badge precedent); the owner `applyDecor(style)` swaps an OWNED style onto
`speakeasies.decor_style` (free to re-apply; null clears to stock). §10.4-NEUTRAL (the Store writes ZERO
`transactions` rows; the PLEX path burns the existing `plex:<sku>` term); a re-buy of an owned cosmetic is
refused before the burn (the mint-credit precedent). Console: renown banner + leaderboard, a decor picker
(owned cosmetics), list/unlist + buy-it-out on the nightlife board, decor/sale chips. `test/speakeasy.js`
extended (renown, the cosmetic tier, the buyout — all gates + the taxed transfer + ownership/guest-list
reset + survives death). Suite 28/28 + sim drift-0. **Step four — the hostile takeover + the renown perk —
BUILT** (`src/speakeasy.js`; off-chain, §10.4-clean, sign-off levers). **The STANDOVER** (`standoverSpeakeasy`,
`POST /v1/speakeasy/:district/standover`, two-party) — the hostile forced-sale, deliberately an INSTANT
muscle contest (the shakedown pattern) NOT a windowed escrow auction, so it adds NO new §10.4 escrow surface:
the challenger pays `STANDOVER.FEE` ($250k, a `speakeasy:standover` cash SINK that BURNS win or lose — the
npcHit-fee precedent), rolls `p = clamp(BASE_P + (atk−def)/STAT_SCALE, MIN_P, MAX_P)` (the muscle+cunning/2
effStat contest, BRUISER-boosted); a WIN forces the owner to SELL at the club's ASSESSED build value
(`assessedValueOf(tier)` = open cost + every tier climbed) — the owner is PAID (taxed, IDENTICAL to
`speakeasy:buyout`), a forced SALE not theft; the challenger risks the fee AND must carry the full assessed
price (so a Cathedral standover commits ~$19M — griefing is economically bounded), a LOSS burns only the fee
+ costs health. Per-club `STANDOVER.CD_MS` (24h) cooldown (`standover_cd_until`) win or lose. Gated
`MIN_LEVEL`/at-district/jailed/hosp/safe/one-per-man/not-owner/family-omertà; club exists/not shut/not on
cooldown. `SPEAKEASY_STANDOVER_P` is a TEST-ONLY roll knob (the raid precedent). §10.4: fee SINK + on-win the
existing `speakeasy:buyout` transfer — both under the `speakeasy:` prefix → **no escrow bucket, no invariant,
no vocab change**; the forced-out owner forfeits pending take (the raid/territory-seize precedent, never
minted); no new death surface (instant). **The renown PERK** — renown-EARNED decor styles (access/status,
never power): `RENOWN.STYLE_UNLOCKS` (`house` 800 / `crown` 2000) gate two new `DECOR_STYLES`; `applyDecor`
accepts a style if you OWN it (store_cosmetics) OR your renown clears the threshold — a cosmetic earned by
being seen, no ETH/PLEX. §10.4 untouched. New column `speakeasies.standover_cd_until`; the buyout's
ownership-transfer is refactored into a shared `resetClubToNewOwner` helper (used by buyout + standover).
Console: a "stand over it" button on the nightlife board (fee + assessed price shown; hidden while protected)
+ earned decor (★) in the picker. `test/speakeasy.js` covers the standover (cash gate, fee-burns-win/lose, a
loss keeps the club + cooldown, a win forces a taxed sale + ownership/guest-list reset) + renown-earned decor.
Suite 28/28 + sim drift-0. **Deferred (step five)**: the cosmetics-as-NFT + resale-royalty market (the
GearVault/chain rail — mainnet-gated, the M6 dormant pattern; the step-3 `store_cosmetics` unlock is exactly
what that NFT represents, so it's forward-compatible), the WINDOWED contested-auction takeover variant
(escrow the owner can defend/outbid — deferred for the leaner instant Standover), and deeper renown perks
(access/status only).

**THE FIGHT CIRCUIT (step one) — BUILT** (`src/boxing.js`, `test/boxing.js` — the 29th suite; design
`omerta-fight-circuit-design.md`). Mob boxing — a new competitive loop distinct from the casino's spectator
FIGHT bet (that's gambling on an NPC card; this is MANAGING YOUR OWN fighter). A manager signs ONE contender
(`fighters.character_id` PK — power/chin/speed + a W/L record + an injury clock + a `bout_limit`
consent-listing), trains them up, and stakes them against other managers' fighters. The bout is the AUDITED
`casino:pvp` back-room-dice pattern EXACTLY — a taxed TRANSFER with a vig (half → the buyback pool, half
burns), so §10.4 stays exact with **NO new cash faucet** (no PvE purse minting) and **NO escrow**. The
fighter DIES WITH THE STREET (`fighters` joins the runEstate wipe — the business/club precedent). Loop:
**recruit** (`recruitFighter`, `BOXING.RECRUIT_COST` cash SINK `boxing:recruit`, level-gated, stats rolled
`[STAT_MIN,STAT_MAX]`, one-per-man), **train** (`trainFighter`, cash+energy SINK `boxing:train`, +`TRAIN_GAIN`
to one stat, capped `STAT_CAP`), **list** (`listBout` — set `bout_limit`, the fade/bodyguard consent pattern),
**fight** (`fightBout`, two-party `withTwoCharacters`: score = `power+chin+speed + rand(VARIANCE)` each, ties
reroll, rng-audited; the winner takes `2×stake − rake` (`RAKE_BPS` vig, half → street_tax via a direct UPDATE,
half burns implicitly since the winner nets `stake − rake` — the `casino:pvp` split, NO NULL take row, NO
faucet); the LOSER's fighter is laid up `INJURY_MS` so it's not spam). `GET /v1/boxing` is the circuit (your
fighter + every fighter taking bouts, ranked by record); `GET /v1/leaderboard/boxing` ranks the whole circuit;
`BOXING.RANKS` (Prospect → Hall of Famer, by wins) is a status ladder. Gates: both own a fighter, opponent
listing, neither injured, stake ≤ limit, both cover it, not self, family omertà, not jailed/hospitalized.
§10.4: `boxing:` joined the cash `KNOWN_REASONS` — recruit/train character_id'd SINKS + `boxing:bout` the
taxed PvP TRANSFER (the `casino:pvp` twin), all character_id'd → check (a) reconciles per character exactly
like the back-room dice; the fighter row uses ABSOLUTE INT writes for wins/losses (the pg-mem arithmetic-UPDATE
quirk). Surfaced on the view (`fighter`) + `/v1/rules` + a "The Fights" console tab (sign/train/list + the
circuit board with make-the-match + the leaderboard). `test/boxing.js` covers recruit/train/list gates + sinks,
a deterministic strong-vs-weak bout (the taxed transfer + the rake split + records + injury + no-rematch), the
board/leaderboard, DEATH, and §10.4. Suite 29/29 + sim drift-0. All numbers are founder sign-off levers.
Deferred (step two): a STABLE (multiple fighters), NPC exhibition bouts (a bounded PvE purse — sim-gated like
the world-raid faucet), title belts, spectator betting on bouts (→ the den book), an account-level career-wins
LEGEND surviving death (the hitman-rep precedent), and cornerman/trainer NPCs (the Underworld tie-in).
**Step two — BUILT** (`src/boxing.js` rewrite, `test/boxing.js`): four of the deferred items. **THE STABLE** —
a manager now runs up to `BOXING.STABLE_MAX` (3) fighters (`fighters.id` PK, `character_id` NON-unique + an
`ix_fighters_char` index; `myFighter(client,ch,fighterId)` is the ownership gate on every action; `fightersOf`
returns the array into `h.owned.fighters` + the view; `recruitFighter` caps the stable). **NPC EXHIBITION
BOUTS** (`exhibitionBout`, `POST /v1/boxing/exhibition {fighter,tier}`) — the one NEW faucet: a bounded PvE
purse over `BOXING.NPC_TIERS` (clubfighter/journeyman/gatekeeper). The `fee` BURNS win or lose (a cash SINK
`boxing:fee`), the `purse` pays only on a WIN (a cash FAUCET `boxing:purse`) where win = your fighter's
`power+chin+speed + rand(VARIANCE)` beats the tier `form` — so net-positive requires genuine form, bounded by
the fee + a per-fighter `EXHIBITION_CD_MS` (6h) cooldown (`fighters.exhib_at`); a loss lays the fighter up
`INJURY_MS`; a win bumps the manager legend. **THE TITLE BELT** (`boxing_title` singleton — `holder_fighter/
holder_char/holder_name/since`, locked `FOR UPDATE` singletons-last) — pure STATUS: a PvP win takes the belt
if it's vacant OR held by the loser's fighter; `wipeFighterAtDeath` vacates it if the dead street held it.
**THE MANAGER LEGEND** (`account_persistent.boxing_wins`, bumped via direct SQL `bumpLegend` — the kills
precedent, so persistAccount can't clobber it) — lifetime stable wins across exhibition + PvP, SURVIVES DEATH
(the hitman-rep precedent), ranked `BOXING.LEGEND_RANKS` (Unknown → The Don of the Ring) on
`GET /v1/leaderboard/boxing` (`{fighters, legend}`). §10.4: `boxing:fee`/`boxing:purse` ride the existing
`boxing:` cash vocabulary (ZERO `invariants.js` change — the exhibition fee a sink, the purse a faucet, both
character_id'd → check (a) reconciles); the PvP `boxing:bout` transfer + belt/legend status are unchanged.
Fighter rows use ABSOLUTE INT writes (wins/losses, the pg-mem quirk). Console: `renderBoxing` rewritten for
the stable (per-fighter cards with train/list/exhibition, the belt chip + champion banner, sign-if-under-max)
+ the circuit board (per-opponent fighter-select + purse) + the legend leaderboard. `test/boxing.js` covers
the stable + cap, train-by-id + ownership, the exhibition (bad-tier gate, fee-sink + purse-faucet on a win,
the career-win bank, the cooldown), the PvP bout + rake split, the belt (claimed vacant, chip, vacated on
death), the manager legend (survives death), and §10.4. Suite 30/30 + sim drift-0. The exhibition purse is
the ONLY new faucet — flagged in BALANCE.md for sim + founder sign-off (the fee/purse/form spread keeps a
losing fighter net-negative); STABLE_MAX/EXHIBITION_CD_MS/NPC_TIERS/LEGEND_RANKS are sign-off levers.
**Step three — THE MAIN EVENT (spectator betting) — BUILT** (`src/boxing.js`, `test/boxing.js`; the
"my guy vs your guy — the oldest bet there is" fantasy the design doc called out). A SCHEDULED prestige
card the CROWD bets on — a CASH **parimutuel** with an escrow (the bounty/market/loan/auction-escrow twin,
on the cash side). A manager `announceMainEvent` (`POST /v1/boxing/announce/:opponentId`, two-party) books
their fighter vs a LISTED opponent fighter (consent-by-listing, the fightBout precedent); **NO principal
cash wager** — the fighters fight for the belt/legend/record, the money is the spectators'. Both fighters
LOCK (`fighters.booked_until`) for the betting window (`BOXING.MAIN_EVENT_MS` 30 min; `MAIN_EVENT_MS` env
is TEST-ONLY, the SEARCH_MS precedent) and their form FREEZES (train/fight/exhibition all throw `booked`, so
bettors bet on stable form). Spectators `placeBoutBet` (`POST /v1/boxing/bout/:id/bet`) escrow CASH on one
fighter (`boxing:bet` sink → the pot; one bet per (bout,bettor) via PK + bout-row lock; principals can't bet
their own card — `own_event`; `[BET_MIN,BET_MAX]`; betting closes at `resolves_at`). **The worker resolves**
(`sweepMainEvents` → `resolveMainEvent`, the auction-settle model — single-writer, no player lock races):
the fight rolls (form + rand(VARIANCE), ties reroll, rng-audited), records/injury/belt/legend update (reusing
the step-two logic), and the pot pays PARIMUTUEL — winning-side bettors get their stake back + a pro-rata cut
of the losing pot net of vig (`boxing:bet:win`), the winning MANAGER banks a promoter purse from the vig
(`boxing:purse:main`), the house vig splits half → the buyback pool / half burns (NULL `boxing:bet:take`), a
DEAD bettor's escrow burns (NULL `boxing:bet:death`, the dead-funder precedent), and a one-sided book (no
bets on the winner) refunds every live bettor (`boxing:bet:refund`). **Lock discipline:** `resolveMainEvent`
reads the (frozen) bet set unlocked, then locks all involved character rows SORTED **before** the bout row —
the canonical char→bout order players use via withCharacter → no AB-BA with a live bettor; the pathological
principal-death-mid-resolve overlap maps 40P01 → the worker's per-bout retry (idempotent) + `deadlockToRetry`
(the codebase-standard posture). **Death:** `cancelMainEventsAtDeath` (runEstate, BEFORE `wipeFighterAtDeath`)
cancels a dead principal's booked cards — refunds living bettors, burns dead ones, unlocks the surviving
fighter; a bettor who is the in-memory KILLER is credited in memory (the refundPot discipline). §10.4: every
`boxing:bet*`/`boxing:purse:main` reason rides the existing `boxing:` cash vocabulary (**zero
`invariants.js` reason change**); a NEW **boxing bet escrow** check reconciles the live-bout pot ==
posted − wins − refunds − purse − take − death (the bounty-escrow twin). Board (`GET /v1/boxing`) gained
`mainEvents` (the two fighters, live parimutuel pools per side, your bet, closesSeconds); `/v1/rules` gained
betMin/betMax/betRakeBps; console: a "The Main Event" section (open cards + live pools + bet-on-either-fighter)
+ a "headline it" button on the circuit. `test/boxing.js` covers the announce gates + consent-by-listing, the
booked-form freeze, the betting gates + escrow, the worker resolution (winners split the losers net of vig /
the promoter purse / half-vig→buyback / the manager legend / the board pools), DEATH cancels a booked card +
refunds the crowd, and the boxing-bet-escrow §10.4 check (mid-window == Σ bets, empties after resolve).
Suite 30/30 + sim drift-0 (15 §10.4 checks incl. `boxing bet escrow`). `BOXING.MAIN_EVENT_MS`/`BET_MIN`/
`BET_MAX`/`BET_RAKE_BPS` are founder sign-off levers (BALANCE.md; the parimutuel is a pure redistribution —
no new faucet, unlike the step-two exhibition purse).
**Step four — THE CORNERMAN + BELT DEFENSE — BUILT** (`src/boxing.js`, `src/underworld.js`, `test/boxing.js`,
`test/underworld.js`). Two coherent pieces, both status/pacing — ZERO new §10.4 surface. **(A) THE CORNERMAN**
— a SIXTH Underworld fixture (`Mickey the Corner`, `UNDERWORLD.NPCS`; the whole Underworld machinery —
daily cap, lead, streak, decay, memory, board — auto-includes him). Standing is earned ACTOR-SIDE at the
boxing touchpoints via game.js `bumpStanding` (sign +3, train +1, exhibition +1, fight +2, announce +2;
`train` is his daily-lead task). Three perks, all **actor-local** (single-party paths with `h`, so no
two-party tier reads, no fight-outcome tampering — the skills/decree precedent): T1 training ×0.9 cash
(`CORNER_TRAIN_MULT`, the DOC_MULT precedent — the discounted number ledgered `boxing:train`), T2 exhibition
cooldown ×0.8 (`CORNER_CD_MULT`), T3 training builds +2 a session (`CORNER_GAIN`, the STAT_CAP ceiling
unchanged — pacing, not power creep). His weekly FAVOR (the step-four Underworld favor menu) patches up the
whole stable (clears every fighter's injury; `nothing` if none laid up — never burns the week, the armorer
precedent). §10.4-neutral (standing is a pure status axis; the training discount rides the existing
`boxing:train` sink). **(B) BELT DEFENSE** (`boxing_title` gained `defenses` + `last_defense`): the belt now
carries a REIGN + a mandatory-defense clock. A shared `applyBeltResult` (used by both `fightBout` and
`resolveMainEvent`) makes a champ's win while HOLDING the belt a DEFENSE (`defenses++`, clock reset) vs a
challenger's win a title CHANGE (fresh reign); the worker `enforceBeltDefense` STRIPS an inactive champion
who hasn't won a bout within `BOXING.DEFENSE_MS` (7d — the belt goes vacant, hold it or fight). Pure status,
no §10.4. The board's `champion` gained `defenses` + `defendSeconds` + the `#1 contender` (top non-champ
fighter); `/v1/rules` gained `defenseMs`; console: the champion banner shows the reign + defense clock +
contender. `test/boxing.js` covers the cornerman discount (T1) + build bonus (T3) + the stable-patch favor,
and belt defense (a defence grows the reign, the clock + contender surface, an inactive champ is stripped);
`test/underworld.js` asserts the six-fixture cast. Suite 30/30 + sim drift-0. All numbers
(`CORNER_*`, `DEFENSE_MS`) are founder sign-off levers.
**Step five — THE CALLOUT — BUILT** (`src/boxing.js`, `test/boxing.js`; the mandatory #1-contender
challenge, the last boxing idea). The **#1 contender** (the top living non-champ fighter with a record,
`contenderOf`) forces a title fight: `callOutChamp` (`POST /v1/boxing/callout/:fighterId`) sets a pending
callout on the `boxing_title` singleton (`callout_fighter`/`callout_char`/`callout_deadline`, `now +
BOXING.CALLOUT_MS` 48h; `CALLOUT_MS` env is TEST-ONLY) — gated self / not-contender / one-at-a-time /
injured / booked; the champ is notified + a streets shout. The champ then either **ACCEPTS**
(`acceptCallout`, `POST /v1/boxing/callout/accept`) — books a TITLE main event champ-vs-challenger (the
callout IS the challenger's consent, so no listing needed; reuses the entire step-three machinery — the
belt rides on the result via the shared `applyBeltResult`: challenger wins → title change, champ wins → a
defence) and consumes the callout — or **DUCKS** it: the worker `enforceBeltDefense` (now two-tier) forfeits
the belt STRAIGHT to the challenger past the deadline (you can't duck the #1 contender), else falls through
to the step-four mandatory-defense strip. Single-party throughout (no cash moves — the champ locks the two
fighter rows + the singleton; the challenger's char is never locked). Death: `wipeFighterAtDeath` clears the
callout if the dead man is the champ (belt vacates) OR the challenger (callout voids); an accepted title
bout is a normal booked main event, so a champ's death cancels + refunds it via `cancelMainEventsAtDeath`.
Board: `champion` gained `onMe` + `contender.mine`/`.fighterId` + a `callout` block (challenger + accept
clock + `byMe`); `openMainEvents` flags a `title` bout; `/v1/rules` gained `calloutMs`; console: the
champion banner shows a pending callout + an **accept** button (champ) / **call out** button (the #1
contender). §10.4 untouched (pure status — the belt is a status singleton, the accepted fight is the
already-§10.4-clean main event). `test/boxing.js` covers the gates (self / not-contender / one-at-a-time),
the board callout surface, the DUCK forfeit (belt → challenger), and ACCEPT (title main event booked + the
callout consumed + both fighters locked + the board title flag). Suite 30/30 + sim drift-0.
`BOXING.CALLOUT_MS` is a founder sign-off lever. **The boxing pillar is COMPLETE** (recruit/train/PvP →
stable/exhibition/belt/legend → the main event → the cornerman + belt defense → the callout) — every idea
in the design + the four deferred lists is now built.

**THE RESERVE BOND (Protocol-Owned Liquidity) — off-chain CORE BUILT, chain DORMANT** (`src/bonds.js`,
`test/bonds.js` — the 30th suite; design `omerta-reserve-bond-design.md`; founder-directed "Option C").
The durable half of OlympusDAO bonding (POL acquisition) WITHOUT the discredited half (a reflexive
inflationary mint). A bonder deposits real ETH → receives DISCOUNTED treasury OMR, vested; the ETH deepens
the OMR-ETH pool (POL) + feeds the Vig. Fits OMERTÀ's three walls: **(1)** OMR is fixed-supply on-chain, so
the payout is a SALE from a **budgeted tranche** (`bond_reserve.capacity_omr`), NEVER a mint —
`committed_omr ≤ capacity_omr` is enforced at bond time (the full-reserve-queue discipline; `over_capacity`
past it), so emission is HARD-CAPPED and never reflexive; **(2)** §10.4 UNTOUCHED — `bonds.js` writes only
`bonds`/`bond_reserve`/`vig_revenue(source='bond')`, ZERO `transactions` rows (the fees.js out-of-band
precedent), so the in-game sweep stays drift-0 (the test proves it end-to-end); **(3)** legal — it ships
off-chain-first / chain-DORMANT (the M6 pattern), the on-chain `OmertaBond` contract + a `Bonded` watcher +
the POL-pairing bot **mainnet-gated on legal + a third-party audit**, and NO APY/price marketing.
`bondPayout = principal × oracle_price / (1 − DISCOUNT)` (the DEX TWAP on mainnet, a param here). The ETH
SPLITS (the Store precedent): `POL_BPS` (60%) → POL (`bond_reserve.pol_eth`, paired into the pool on
mainnet), `VIG_BPS` (40%) → `vig_revenue(source='bond')` → the EXISTING buyback → reserve + prize pool (so
bonds ALSO strengthen extraction-≤-inflow). `recordBond` (the recordFeePayment/Store twin — idempotent on
nonce, tranche-capped, chain-dormant/mod-driven), `claimBond` (linear vesting; account-level "Treasury
Backer" STATUS derived from holding a bond — no gameplay power, no §10.4), `fundBondTranche` (the treasury
tops up the budget), `bondBoard` (`GET /v1/bonds` — offering + remaining capacity + oracle + your bonds),
`bondStatus` (`GET /v1/mod/bonds` ops view), and **`runBondInvariants`** — the real-value-side invariant
(the runVigInvariants twin): committed==Σpayout, committed≤capacity (the anti-Ponzi cap), claimed≤committed,
POL+Vig==principal (the split reconciles), discounts≤MAX. Routes: `GET /v1/bonds`, `POST /v1/bonds/:id/claim`,
`GET /v1/mod/bonds`, `POST /v1/mod/bond/fund`, `POST /v1/mod/bond/simulate` (QA/comp until the paywall — the
Store `mod/store/grant` precedent). `test/bonds.js` proves the funded tranche, the discounted payout + the
60/40 split, the anti-Ponzi cap, idempotency, the bond invariant, the Vig integration, claim vesting, and —
crucially — **§10.4 IN-GAME UNTOUCHED** (drift-0 through the whole lifecycle). Suite 30/30 + sim drift-0.
Numbers (`DISCOUNT_BPS`, `VEST_HOURS`, `POL_BPS`/`VIG_BPS`, the tranche capacity) are founder sign-off levers.
The on-chain **`OmertaBond` contract is now WRITTEN** (`omerta-contracts/src/OmertaBond.sol` + Foundry tests
`test/OmertaBond.t.sol`): EIP-712 server-signed `BondQuote`s (the VoucherClaim signer discipline), the
tranche cap on-chain (`committedOMR + payout ≤ omr.balanceOf(this)` — NEVER mints, the pre-funded-transfer
discipline), linear vesting `claim`, the ETH split forwarded in-tx (POL + Vig, custodies no ETH — the
OmertaFees pattern), immutable `polBps` + `MAX_DISCOUNT_BPS`/`MAX_VEST` backstops kept in lockstep with the
backend `BONDS.*`, Safe-owned + pausable, and `sweep` that can pull only the UNCOMMITTED tranche (never OMR
backing outstanding bonds). It **compiles clean** (solc 0.8.26 + OZ 5.1, 0 warnings, via
`tools/compile-contracts.js` — the no-Foundry path); the README carries the viem quote-signing parity
snippet. A focused Solidity red-team verified the five central invariants SOUND (no-mint tranche cap,
CEI/reentrancy on the ETH split, vesting clamp, EIP-712 replay, payout math) — **no CRITICAL/HIGH** —
and fixed two in-commit (mirroring the sister contracts, regression + fuzz tests each): **MED-1** a
missing future-bound on `deadline` (a leaked-then-rotated signer's `deadline=2100` quotes stayed
bondable) → `MAX_QUOTE_TTL` 30d + `DeadlineTooFar` (the `VoucherClaim.MAX_VOUCHER_TTL` mirror); **LOW-1**
no ETH-rescue → an `onlyOwner sweepETH()` to the Safe (the `OmertaFees.sweep` pattern). Added tests: the
deadline backstop (+ exact-boundary accept), the ETH sweep (+ owner-gate), a reentrant-recipient
re-entry (guard blocks → forward fails → the bond rolls back), and a **fuzz** of the anti-Ponzi
invariant (`committedOMR ≤ balanceOf` after any bond). Still deferred (mainnet milestone, legal + audit
gated): **`forge test` must run** (Foundry egress-blocked here — the established suite residual), the
POL-pairing bot, and **liquidity bonds** (LP-token deposits). NOTE (Sensitive design): a bond is a financial
primitive — no APY/appreciation marketing until counsel signs off, same wall as R2/R3/mainnet.
**CHAIN GO-LIVE (2026-07-22): the `Bonded` → `recordBond` watcher wiring is now BUILT** (`src/watcher.js`
`syncBondEvents` + `bondLogs` in `makeViemSource`; wired into the worker's chain-sync tick; dormant unless
`OMERTA_BOND_ADDRESS` is set). The event is AUTHORITATIVE: `recordBond` gained an on-chain path
(`onchainPayout`/`onchainPol`/`onchainVig`) that books the event's actual payout + POL/Vig split (wei→units via
viem `formatUnits`, so 1 in-game $OMR = 1e18 on-chain, matching `chain.js` `parseUnits(_,18)`) rather than
re-deriving from a price+discount the event doesn't carry, and BYPASSES the backend tranche cap (the contract
enforced its own — so a real bond always records and can't stall the sync cursor; keep `bond_reserve.capacity`
funded to match, `runBondInvariants` flags a gap). Idempotent on nonce; zero `transactions` rows (§10.4
untouched); real-ETH accounting (`vig_revenue` source='bond') only from a real Bonded tx. `test/watcher.js`
covers the reserve-bond stream (confirmation gating, event-authoritative booking, cap-bypass, idempotency).
The mainnet go-live sequence is in **`CHAIN-DEPLOY.md`** (the on-chain counterpart to DEPLOY.md — the three
hard gates: `forge test` green, third-party contract+signer audit, legal counsel).
**The EIP-712 bond QUOTE SIGNER is now BUILT** (`src/chain.js:quoteBond` + `POST /v1/bond/quote`; the piece
`OmertaBond.bond()` needs, so real bonds can flow once mainnet clears): a player requests a signed `BondQuote`
BOUND to their linked wallet (`Chain.BOND_QUOTE_TYPES`/`bondChainConfig()` in exact parity with
`OmertaBond.QUOTE_TYPEHASH` — fields `payer,principal,priceOmrPerEth,discountBps,vestSeconds,nonce,deadline`;
domain `OmertaBond`/`1`; `verifyingContract` = `OMERTA_BOND_ADDRESS`), submits `bond(quote, sig)` on-chain, and
the wired `Bonded` watcher recovers the quote's EXACT price/discount from the persisted `bond_quotes` row (the
event omits them — the watcher previously stored only the effective payout/eth rate; `recordBond` now enriches
`oracle_price`/`discount_bps` from the quote and marks it `bonded`). Signed by the SAME crown-jewel
`VOUCHER_SIGNER_PK` (`signTypedData` via `signerAccount()` — parity with `signVoucher`), priced at the live
oracle (latest Vig-buyback TWAP) × `BONDS.DISCOUNT_BPS`, nonce'd from a NEW `bond_reserve.next_nonce`
(independent of the withdrawal `chain_reserve` nonce space), and PRE-CHECKED against the backend tranche
(`bond_reserve.capacity_omr`) so a player never gets a quote whose `bond()` would revert `TrancheExhausted`.
`price` uses `parseUnits(price,18)` (OMR-wei per ETH) + `principal` `parseUnits(eth,18)` — exact parity with
the contract's `principal × priceOmrPerEth / 1e18` payout math. Deadline `now + BOND_QUOTE_TTL_SEC` (1h,
< contract `MAX_QUOTE_TTL`). **Chain-dormant** (400s `chain_unconfigured` unless `CHAIN_ID` + `OMERTA_BOND_ADDRESS`
+ `VOUCHER_SIGNER_PK` are set). §10.4 untouched (quotes are out-of-band real-value plumbing — zero `transactions`
rows; the new `bond_quotes` table + `next_nonce` column are chain-only). `test/chain.js` proves the signing
PARITY (`recoverTypedDataAddress` == the server signer), the payout math, the wallet/min gates, the watcher
enrichment (the recorded bond's `oracle_price`/`discount_bps` come from the quote, not the effective rate/0),
and `bondChainConfig` failing closed. `POST /v1/bond/quote` + a "request a signed quote" control on the console
Going Legit tab; the deck's Chain group gained it.

**WALLET INTEGRATION (MetaMask & Robinhood Wallet & any injected wallet) — BUILT** (`public/index.html`,
`src/chain.js:bondCalldata` + `POST /v1/bond/calldata`). The console's wallet layer moved from the legacy
single-`window.ethereum` provider to **EIP-6963 multi-wallet discovery**: it collects every announced injected
wallet (MetaMask `io.metamask`, Robinhood Wallet, Coinbase, Rabby, …), and `linkWallet()` shows a **picker**
when >1 is installed (auto-uses the single one; falls back to `window.ethereum` legacy). The chosen provider is
remembered (`connectedProvider`) and reused for on-chain actions. **The bond flow is now completable in-browser**:
after signing a quote, `submitBondOnChain(nonce)` fetches server-encoded `bond(quote, sig)` calldata
(`bondCalldata` uses viem's `encodeFunctionData` — the zero-dep client never hand-rolls ABI), switches the wallet
to the quote's chain (`wallet_switchEthereumChain`), and `eth_sendTransaction`s it (the wallet shows the tx +
value; the server custodies nothing). `bondCalldata` reads the player's OWN persisted quote by nonce (a stranger
gets `no_quote`), rebuilds the exact signed tuple, and returns `{to, value, data, chainIdHex}`; selector
`0x606262a5` (`bond((address,uint256×6),bytes)`) verified against viem. Chain-dormant (the submit only works once
the bond chain is configured — mainnet-gated). `test/chain.js` decodes the calldata and asserts it's a `bond()`
call carrying the right nonce/payer/sig, targets OmertaBond with the principal as `value`, and is account-scoped.
**WalletConnect (mobile) — BUILT** (`public/index.html`, `src/server.js` `/v1/rules`): the picker gained a
**WalletConnect (mobile)** option that LAZY-LOADS `@walletconnect/ethereum-provider` from a CDN only when chosen
(so the console stays a single zero-dep file otherwise) and `.connect()`s — the SDK renders its own QR (desktop) /
deep-link (mobile) modal, so scanning with **Robinhood Wallet / MetaMask Mobile / any WC wallet** drops into the
SAME EIP-1193 flow (`connectedProvider`) as an injected wallet — SIWE link + bond submit both work over it. It's
**DORMANT unless `WALLETCONNECT_PROJECT_ID` is set** — `/v1/rules` surfaces `walletConnect {projectId, chainId}`
(the projectId is public/client-embedded by design; `chainId` = `CHAIN_ID` or 1) and the console hides the option
when null. `test/chain.js` asserts the config surface (null without the env, the public id + chainId with it).
STILL deferred before real bonds flow: the POL-pairing + DEX buyback bots, the on-chain Store paywall.

**UX / FLOW AUDIT + ONBOARDING REFRESH + THE CODEX — BUILT** (`AUDIT-ux-gameplay-flow.md`, `docs/WIKI.md`,
`public/wiki.html`, `public/index.html`, `src/game.js`, `src/server.js`; UI/docs only — no mechanic retuned,
§10.4 untouched, suite 30/30 + sim drift-0). A three-lens max-effort review (console UX, onboarding + flow,
full feature inventory) found the backend enormous and correct but the CLIENT barely legible to a new player.
Fixed in this pass: **(1)** the Path dead-end (a BLOCKER) — the coach + First-Week checklist sent a lvl-5
player to Streets to declare a Path, but no Path control existed there and the raw deck shipped an invalid
`{path:'earner'}` → `bad_path`; now a curated **Declare Your Path** card on Streets (live from a new
`rules.paths` catalog), a "at level 5" teaser below it, deck template fixed, and `data-do` buttons honor an
optional `data-body`. **(2)** the trade-goods economy had no UI while the Black Market + Convoys both say
"buy goods on the Streets first" — added a **Trade Goods** buy/sell grid to Streets (unblocks the smuggling
pillar). **(3)** raw error codes (`safe`/`pax`/`contention`/`feds_watching`/`cold`/`witpro`…) leaked to
players — added a 40-code `ERRMAP` humanizer in `describe()`. **(4)** the coach went silent at ~lvl 8 and
ignored urgent threats — added top-of-ladder **wanted/indicted/welsher** rungs and a late-game bridge toward
**skills** + **going legit** (all false for a fresh street, so the tested first-job→path flow is unchanged).
**(5)** the M4-era onboarding copy — expanded the glossary 9→21 terms (safehouse, wanted/welsher, the Law,
the Pen, in-transit/unbonding, skills, family/Commission, vendetta, the Underworld, renown/notoriety/
scrutiny, the Wire) and refreshed the welcome (depth warning, "watch the coach line", two survival rules).
**THE CODEX** — a served, navigable in-game wiki at **`GET /wiki`** (`public/wiki.html`, 32 sections over
every system + loop, noir-themed, sidebar + search; the `/admin` static-file precedent), linked from the
console top bar, plus `docs/WIKI.md` as the canonical text. Verified live (`/wiki` serves, `/v1/rules`
carries `paths`, the console shows the CODEX link) + `test/growth.js` (coach) green. The remaining
UI/UX/flow findings are RANKED in `AUDIT-ux-gameplay-flow.md` as the backlog (the biggest: the 22 flat tabs
need grouping/reordering; the deck-only core loops — swap/stake/rackets/dailies/missions — and the invisible
endgame sinks — Bonds, family seals — need curated screens; idempotency-key + disable-in-flight on money
actions; active-tab re-render on WS events; a real wallet-link widget) — flagged, not all built, since they
touch no mechanic and are founder-prioritizable.

**CONSOLE TAB RESTRUCTURE + DECK-ONLY SURFACING — BUILT** (`public/index.html`, `src/server.js`,
`test/portfolio.js`; UI + read-only catalogs only, no mechanic retuned, §10.4 untouched, suite 30/30 + sim
drift-0). Cleared the top two UX-audit backlog items. **(1) Tab restructure** — the 22 flat tabs are now
rendered in labeled, journey-ordered clusters (`TAB_GROUPS` + a `.tabgrp` separator): Start · **Streets**
(streets/garage/life/city) · **Earners** (kitchen/empire/scores/market) · **Vice** (den/speakeasy/boxing) ·
**Blood** (pvp/loans/law/pen/wire) · **Family** · **Legit** (portfolio/estate/store) · deck — so the wall of
tabs reads as groups, core screens lead, niche endgame trails. **(2) Deck-only systems surfaced** into curated
screens (all were reachable only through the raw "Everything Else" deck, or not at all): **swap/stake/claim +
Reserve Bonds** → "Going Legit" (The Exchange + The Vault + a Bonds card, claim wired); **rackets + assets** →
"The Empire" (buy-once passive-income catalogs from the new `rules.rackets`/`rules.assets`); **daily contracts
+ the Daily Score** → Streets ("Daily Work" — the repeatable early faucet); **NPC rival-family raids** → "The
City" (odds board + raid); **family seals + crest color + rename** → "The Family" ("Family Regalia", boss-gated,
from the reserve); **missions** → "Start Here" (level-eligible list from the new `rules.missions`). `/v1/rules`
gained `rackets`/`assets`/`missions`/`seals` catalogs; `data-do` already honors `data-body`. **Also fixed a
pre-existing BLOCKER**: `renderBoxing` had `managers\\'` (double-backslash-quote) — a hard JS syntax error that
broke the ENTIRE console script in a browser (it was in HEAD; the earlier "verified live" only string-checked
the served HTML, never parsed the script). Fixed to `\'`; the client script now parses clean (verified via
node --check on the extracted script + a live boot exercising every new screen's data endpoint). One
pre-existing **date-flaky test** fixed en route: `test/portfolio.js` "shares accumulate" compared
`round6(total/price)` to the server's `round6(cur + round6(amt/price))` — a 1-ULP mismatch on some days'
prices; the expectation now models the server's per-buy rounding (date-independent). Still deferred (backlog):
idempotency-key + disable-in-flight, active-tab re-render on WS events, the wallet-link widget, and the
street-vanity (name/title/plate) tail — all flagged, none touch a mechanic.

**CONSOLE UX BACKLOG — CLEARED** (`public/index.html`; UI-only, §10.4 untouched, suite 30/30). The four
remaining UX-audit items: **(1) idempotency + double-submit guard** — `api()` sends a fresh
`Idempotency-Key` on every mutation (the server already honors it), and `act()` holds a global in-flight
lock (money moves one at a time; a double-tap toasts "easy — one move at a time" instead of firing twice).
**(2) active-tab re-render on live events** — `setTab` now dispatches through a `RENDERERS` map + tracks
`currentTab`; a debounced `renderActive()` re-renders the OPEN board on a WS event (your own OR streets/gang)
and on the 30s poll / visibility-return, so a board you're staring at (contracts, nightlife, the market)
doesn't go stale — skipped while you're focused in an input so it never nukes a half-typed amount. **(3) the
wallet-link widget** — a "Your Wallet" card in Going Legit runs the real SIWE flow (`eth_requestAccounts` →
`POST /v1/wallet/challenge` → `personal_sign` → `POST /v1/wallet/verify`); no `window.ethereum` → a clean
"install a browser wallet" pointer; `ob_wallet`'s First-Week task now routes here instead of the raw deck,
closing the last onboarding dead-end. **(4) street vanity** — a "Vanity" card on The Life tab (name change /
custom title / car plate — the `vanity:*` $OMR sinks). Verified in Chromium: all 22 tabs render with **zero
page errors**, the grouped tab bar shows (Streets · Earners · Vice · Blood · Family · Legit), and every tab
GET returns 2xx for a fresh guest. The UX-audit backlog is now empty.

**DAILY SOCIAL TASKS — "Spread the Word" (organic-growth petty-cash faucet) — BUILT** (`src/growth.js`,
`src/rules.js` tail, `schema.sql`, `src/server.js`, `src/invariants.js`, `public/index.html`,
`test/growth.js`; founder-directed to grow organic word-of-mouth + referral volume; numbers are sign-off
levers). Three recurring daily tasks (`SOCIAL_TASKS`: **sw_post** tweet about us, **sw_invite** share your
code, **sw_boost** follow/RT the pinned post) each paying **petty cash** (`CASH` $300, `ALL_BONUS` $500 for
all three in a day). **CASH ONLY** (the v24 social-reward rule — farmed cash must be laundered past heat +
the $2.6M/day wash cap to extract, which bounds its value); **once per (account, day)** via the new
`social_claims (account_id, day, task_id)` PK table (withCharacter's per-character lock serializes claims,
the PK backstops); **agent-flagged accounts EXCLUDED** (the referral precedent); and the reward is **gated
behind `SOCIAL_VERIFY_MODE!=='off'`** (the verify.js philosophy — a default/misconfigured server never
leaks; alpha runs `trust`). The share URLs (`socialShareUrl`) are **prefilled X intents carrying the
player's LIVING NAME as their referral code** (referrals resolve by name, §7.13) — so a recruit who uses it
pays the sharer real referral cash + $OMR on qualification, closing the loop into the existing referral
system. §10.4: `social:` joined the cash faucet vocabulary (`invariants.js`); every payout is a ledgered
`social:<taskId>` cash faucet (the all-done bonus folds into the last row, the onboard-capstone precedent),
so the per-character cash check reconciles exactly. `track('social_task', {task, allDone, proof})` gives
the founder volume + a spot-check trail on the ops activity feed. Routes: `GET /v1/social`, `POST
/v1/social/:taskId/claim`; the client surfaces a **"Spread the Word"** section on the Start Here tab (share
↗ opens the intent, then claim) — browser-verified rendering with share links + claim buttons, no page
errors. `test/growth.js` covers the board + share code, a paid claim (ledgered), the once/day gate, the
all-done bonus, bad-task, the §10.4 per-character reconcile, agent exclusion, and the off-mode gate. Suite
30/30 + sim drift-0. Levers (`CASH`, `ALL_BONUS`, the task set, `SOCIAL_GAME_URL`/`SOCIAL_X_HANDLE`) are
founder sign-off; the honest note: "post a tweet" is inherently unverifiable, so this is a bounded,
agent-excluded, cash-only, once/day, proof-logged TRUST faucet — petty by design so farming is barely worth
it while genuine sharing brings in real referrals.

**REFERRAL-FUNNEL EXPANSION (founder-directed — grow the organic/referral loop) — BUILT** (`src/game.js`,
`src/rules.js` tail, `schema.sql`, `src/server.js`, `src/growth.js`, `public/index.html`, `public/admin.html`,
`test/growth.js`; numbers are sign-off levers; §10.4 exact — suite 30/30 + sim drift-0). Three additions on
top of §7.13. **(1) Stepped payout — "the spark"** (`game.js:maybeSparkReferral`, `M4.REF_SPARK`): a small
EARLY cash payout ($2500 recruiter / $1500 recruit) the moment a recruit shows real early engagement (level
3 + 10 jobs) — long before the full qualification (L8/40 jobs/3 check-ins/$25k) — so the referrer gets fast
feedback and keeps referring. CASH ONLY (never $OMR — that stays on the full gate), ONCE ever (new
`account_persistent.ref_spark`), agent-excluded, same sorted two-party lock as `maybeQualifyReferral` (no
deadlock); wired post-commit non-fatal into BOTH withCharacter + withTwoCharacters hooks (spark before
qualify; a fast-forward recruit crosses both gates at once and collects both). §10.4: `referral:spark` rides
the existing `referral:` cash prefix (zero vocab change). Still Sybil-bounded — it requires real playtime,
not a raw signup. **(2) Share-a-win prompts** (`public/index.html`): a dismissible "brag on X ↗" prompt
fires after a genuinely brag-worthy result (a kill, a prison break, a big-score crew cut, a boxing purse, a
standover, the First-Week capstone) — a one-tap prefilled X intent carrying the player's LIVING NAME as
their referral code (turns highlights into reach → the §7.13 loop). `/v1/rules` gained a `share {gameUrl,
xHandle}` block; `bragText(body)`/`showBrag(line)` in `act()`; only fires on rare wins so it never nags.
**(3) Referral funnel + K-factor** (`growth.js:funnelStats` → `GET /v1/mod/funnel`, rendered on
`public/admin.html`): `referral { accounts, referred, sparked, qualified, recruiters, totalRecruits,
reReferred (viral depth), kFactor (qualified recruits/account — >1 compounds), sparkToQualified }` — so the
organic loop is measurable. `test/growth.js` covers the spark (early payout, cash-only, ladder unaffected,
once-ever, the fast-forward-collects-both assertion, `referral_spark` telemetry) + the funnel referral block.
All numbers (`REF_SPARK.*`, the brag trigger set) are founder sign-off levers. Deferred from the funnel-plan
(flagged, ranked): a Recruiters status leaderboard + family recruitment drives (status, §10.4-free), a
time-boxed double-referral push, and the higher-risk 2-level "family tree" referral (cash-only + counsel-
gated — held until the single-level loop is measured).

**THE RECRUITERS BOARDS (§7.13 status hall of fame) — BUILT** (`src/growth.js`, `src/rules.js`,
`src/server.js`, `public/index.html`, `test/growth.js`). The first deferred funnel item — makes recruiting a
VISIBLE competition (drives the loop without touching the economy). Two read-only boards, PURE STATUS
(recruit COUNT — display-only, outside §10.4 and the sim-audited balance, the hitmen-board precedent), so
ZERO ledger surface. **`recruiterLeaderboard`** ranks accounts by lifetime QUALIFIED recruits with the
living name, family, and a milestone `rank` (new `recruitRankOf` helper off `RECRUIT_MILESTONES` — the
highest milestone name reached; display-only, the payout still fires per-milestone in
`maybeQualifyReferral`); agent recruiters never bump `recruits` (the qualify txn rolls back on
`recruiterAcct.agent_flag`) so they never appear. **`recruitingFamilyLeaderboard`** ranks families by the
total recruits their CURRENT roster has brought in (a collective drive — a member who leaves takes their
count with them; aggregated in JS over a flat 4-table JOIN, the `/v1/gangs` two-flat-queries pg-mem
precedent). One route `GET /v1/leaderboard/recruiters` returns `{recruiters, families}`; the console
surfaces both on the Start Here tab under "The Recruiters" (below Spread the Word). `test/growth.js` covers
the recruiter appearing with count + milestone rank, agent exclusion, and the family board summing a
roster's recruits. Suite 30/30 + sim drift-0. Still deferred (flagged): the time-boxed double-referral
push, and the counsel-gated 2-level "family tree" referral.

**THE RECRUITMENT DRIVE + TIER-2 "FAMILY TREE" (§7.13 addendum) — BUILT** (`src/game.js`, `src/rules.js`,
`schema.sql`, `src/server.js`, `public/index.html`, `public/admin.html`, `test/growth.js`; founder green-lit
both). Clears the last two deferred funnel items. **(1) The recruitment DRIVE ("the push")** — a mod starts
a time-boxed window (`POST /v1/mod/referral/push {hours, mult}`, clamped `REF_PUSH_MAX_HOURS` 336 /
`REF_PUSH_MAX_MULT` 5; a `referral_push` singleton) during which EVERY referral CASH payout multiplies —
`referralPushMult(client)` reads the singleton and `maybeSparkReferral`/`maybeQualifyReferral` scale the
spark + full recruiter/recruit + milestone cash by it (the credited amount == the ledgered amount). **$OMR
is UNTOUCHED** (fund-bounded — the drive never widens the $OMR faucet). Bounded by REAL qualified recruits
(each needs L8/40 jobs/3 check-ins/$25k) → Sybil-bounded like the base loop. Publicly visible on
`GET /v1/leaderboard/recruiters` (`push`) + a "🔥 RECRUITMENT DRIVE" banner on the console's Recruiters
section + a founder control on the admin dashboard. **(2) TIER-2 "the family tree"** — when a recruit YOU
brought in (R) then brings in their OWN qualified recruit (R2), you — the grandrecruiter (A) — earn a
BOUNDED, ONE-TIME finder's fee (`REF_TIER2_CASH` $5k). Deliberately a FLAT one-shot cash bonus, **NOT an
ongoing percentage of R2's earnings — the anti-MLM line** (a referral bonus, not a revenue-share pyramid);
**CASH ONLY**, capped at **DEPTH 2** (no third level), **agents excluded at EVERY level** (A, R, R2), once
ever per R2 (`account_persistent.ref_l2_paid`, an atomic claim-then-credit). `maybeGrandReferral(pool, r2)`
runs post-commit non-fatal in BOTH game.js hooks right after `maybeQualifyReferral` (the hook only fires
while R2 is unpaid, so the tier-2 fires in the same turn R2 qualifies); its OWN transaction locks A's char
then the two accounts sorted (characters → accounts — the qualify path's order, no AB-BA). §10.4:
`referral:tier2` rides the existing `referral:` cash prefix (zero vocab change); the drive's larger payouts
are still ordinary ledgered `referral:*` cash. `test/growth.js` proves the drive doubles both sides (ledger-
exact) with $OMR untouched, and the tier-2 fee lands once to the grandrecruiter (cash-only, ledgered,
latched). Suite 30/30 + sim drift-0. All numbers (`REF_TIER2_CASH`, `REF_PUSH_MAX_*`) are founder sign-off
levers. **Sensitive: the tier-2 is recorded counsel-gated** (a 2-level referral has MLM-resemblance) — kept
a bounded one-time cash finder's fee, not a revenue share, per the founder's blanket "assume counsel
approved architecture" directive + this explicit green-light; do NOT extend it to a 3rd level or an ongoing
percentage without counsel.

**THE BROADCAST (organic-growth layer on §7.13 referrals) — BUILT** (`src/cards.js`, `src/server.js`,
`public/index.html`, `test/hardening.js`; design `omerta-broadcast-design.md`; founder-directed "make
guerrilla organic marketing so effective users champion the game — no marketing budget"). Closes the two
leaks that throttled word-of-mouth: **(1) attribution friction** — a recruit had to TYPE the referrer's
name as a code (nobody does), so real word-of-mouth credited no one; now every share links to
`/u/<name>?ref=<name>`, the console captures `?ref=` on load (`localStorage.omerta_ref`, 40-char clamped)
and character creation auto-fills it as `referralCode` (then clears it) — the shared link IS the code, §7.13
credits the sharer on qualification exactly as before, zero typing. **(2) no shareable content** — a
referral was a bare text link; now `GET /card/:type/:name` renders a 1200×630 noir SVG poster (the OG-image
ratio, unfurls in a feed): **legend** (the proud-player flex — fedora, name, assassin rank OR "gone legit"
dynasty tier, LVL/KILLS/STANDING, teal when legit), **wanted** (red poster + the bounty POT on their head —
public by design, not wealth), **whacked** (a kill notice), **join** (the unknown-name fallback).
`GET /u/:name` is the champion destination — the public profile page (`Cards.profilePage`): OG/Twitter
unfurl tags → the legend card, the card inline, a gold ENTER THE CITY → CTA to `/?ref=<name>`, and the
"your referrer gets credit" line. A 📣 broadcast button on the console sheet builds the share (X intent +
profile URL); the existing share-a-win prompts fire the same flow after a brag-worthy result. **Safety
rails (why it ships everywhere):** `publicDossier` returns BANDED status only — level/kills/assassin
rank/family/wanted-welsher flags/dynasty tier + the public bounty pot; **NEVER an exact cash/bank/$OMR
figure** (preserves the audit's anti-precise-kill-EV rule — a card can't become a wealth scanner). Every
route is PUBLIC + keyless + read-only, ZERO §10.4 surface (status/marketing only — no ledger row, no
currency, no faucet); a card never 500s / never emits undefined/NaN; an unknown name falls back to a clean
"join the city" card/page (a stale share link is harmless); HTML/SVG is escaped (a living name can't inject
markup); fictional names only (no real brand anywhere — the standing legal posture). A shipped bug was
regression-guarded here: `hitmanRankOf(...).title` (was `.name` → `undefined` on every legend card).
`test/hardening.js` (THE BROADCAST block) seeds a wanted, blooded character and asserts the dossier bands
rank/level/flags with no exact-wealth field, the assassin rank resolves to a real title, all four card types
are well-formed `<svg>` with no undefined/NaN served as `image/svg+xml`, the profile carries the OG unfurl
image + the `?ref=` CTA, and an unknown name falls back cleanly on all three routes. Suite green + sim
drift-0. **RASTERIZATION — BUILT** (`src/cardpng.js`): X/feeds won't unfurl an SVG og:image, so
`GET /card/:type/:name.png` rasterizes the card via **`@resvg/resvg-js`** (a lightweight native SVG→PNG
pass — no headless browser in the game backend), an **`optionalDependency`**: if it's absent / fails the
native build, `renderPng` returns null and the route falls back to serving SVG (never 500s). PNGs are
cached by the SVG's content hash (5-min TTL, 256-cap); the profile `og:image`/`twitter:image` now point at
the `.png`. `test/hardening.js` asserts the .png route returns a valid PNG (magic bytes) when resvg is
present, else the SVG fallback. **FUNNEL INSTRUMENTATION — BUILT**: `POST /v1/broadcast/shared {kind}`
(authed beacon — bounded by real accounts + rate limits, NOT an unauthenticated write; the client hits it
on 📣/brag) records `track('broadcast_share')` (zero §10.4); `funnelStats` gained a `broadcast` block
(shares, byKind, distinct sharers, `referredPerShare`) so `GET /v1/mod/funnel` + the admin dashboard read
the whole organic loop — shares → referred signups → qualified recruits → K-factor. Deliberately NOT
tracking the keyless `GET /u`/`GET /card` hits (OG-crawler-dominated + an unauthenticated write amplifier —
raw views are an edge/CDN concern). Deferred: an obituary card type + richer triggers; a bundled brand
font (resvg falls back to a system serif — cosmetic).

**THE AGENT GATEWAY (agent onboarding + machine discovery) — BUILT** (`AGENTS.md`, `src/agentgateway.js`,
`src/server.js`, `public/index.html`, `test/hardening.js`; founder-directed "improve the agent experience /
market to agents"). The first deliberate agent-facing surface — agents are already first-class players
(`POST /v1/auth/agent-key` → permanent 🤖 flag + 90-day token throttled 1/3s; 279 routes; stable string
error codes; keyless `/v1/rules` + `/v1/catalog`), but had NO onboarding guide, no OpenAPI, no discovery
plumbing. This drop adds all four, read-only + keyless, ZERO §10.4 surface. **`AGENTS.md`** (served at
`GET /agents` + the conventional `GET /AGENTS.md`, text/markdown) — the agent quickstart: why an agent
should play (the Risk-to-Earn thesis — agents earn by SKILL, the anti-Sybil faucets stay human-only), the
rules of the road (agent key, 1/3s throttle, Idempotency-Key, the stable error-code contract,
server-authoritative), a curl quickstart (auth → agent-key → create → the loop → `/v1/me` coach), the
agent-native EARN loops table (crime/kitchen/arbitrage/AMM/convoy/contracts/heists/loans/passive-income
with their real endpoints), the EXTRACT path (SIWE → mint → `/v1/withdraw` EIP-712 voucher), and the fair-
play contract (what `agent_flag` excludes + why). **`GET /openapi.json`** — an OpenAPI 3.1 doc
AUTO-DERIVED from the live route registry (an `onRoute` hook collects every mounted `{method,url}` into
`routeRegistry`, so the contract never drifts from what's actually served — 271 API paths, 74 system tags
with per-tag descriptions, correct per-route security: keyless public allowlist / `bearerAuth` player token
/ `modKey` x-mod-key). **`GET /llms.txt`** — the LLM-discovery-standard markdown index pointing agents at
`/agents`, `/openapi.json`, `/v1/rules`, the earn/extract loops, and the fair-play note. **schema.org
JSON-LD** (`VideoGame` block + a `<meta name="description">` + a `<link rel="alternate">` to `/agents`) in
the landing page head — SEO so agents/LLMs crawling the site discover the machine surfaces. `src/agentgateway.js`
holds `buildOpenApi(routes, {baseUrl})` + `llmsTxt({baseUrl})` (baseUrl from `PUBLIC_URL || SOCIAL_GAME_URL`).
`test/hardening.js` covers the openapi doc (3.1, >100 paths, key routes present, the three security postures
exact, both schemes declared) + `/agents` + `/AGENTS.md` + `/llms.txt` serving the right content-type +
indexing the machine surfaces. Suite 30/30 + sim drift-0. **Deferred (the ranked agent-economy roadmap,
flagged for founder go-ahead):** the **Opportunity Board** (`GET /v1/opportunities` — every open economic
action with computed EV/risk in ONE call, the killer agent-liquidity feature) + an **Agent Leaderboard**
(`GET /v1/leaderboard/agents` — a SEPARATE machine hall of fame, competition without touching the human
status axes), and an **MCP server** (`omerta-mcp` — expose the game as MCP tools so any Claude/agent plays
natively; the biggest distribution lever, a new package). All three are §10.4-safe (read-only / new
package) and were scoped in the agent-experience strategy discussion.

**THE AGENT ECONOMY (Opportunity Board + Agent Leaderboard + MCP server) — BUILT** (`src/opportunities.js`,
`src/growth.js`, `src/server.js`, `omerta-mcp/`, `AGENTS.md`, `src/agentgateway.js`, `public/wiki.html`,
`test/hardening.js`; founder-directed "create all 3"). The three deferred agent-economy items, all §10.4-safe
(read-only aggregation / a separate status board / a standalone package). **(1) The Opportunity Board**
(`GET /v1/opportunities`, `src/opportunities.js:opportunityBoard(pool, ch)`) — the agent-liquidity feature:
ONE keyless read that aggregates every open economic action (kill/hospitalize CONTRACTS with the pot as
reward, CONVOYS to ambush by value band, open LOANS to take, WTB market ORDERS to fill) ranked by reward,
PLUS the standing skill-loops (`niches`): today's widest cross-district trade-goods **arbitrage spreads**
(computed from the deterministic §7.11 `goodPriceOf` hash — a solved optimization, the single highest-signal
agent niche), the live **AMM spot**, loan-funding demand, convoy-running + passive-income notes. Pure
aggregation over the existing boards + price math (reuses `listContracts`/`convoyBoard`/`loanBoard`/
`marketBoard`) — moves no value. **(2) The Agent Leaderboard** (`GET /v1/leaderboard/agents`,
`growth.js:agentLeaderboard`) — a SEPARATE machine hall of fame for `agent_flag` players (ranked by net
worth = cash+bank, with kills + **$OMR extracted on-chain** summed from the `withdraw:omr` ledger — the
"earned a living" metric). Agents are excluded from the HUMAN status axes (referral/assassin-rep) by design;
this is their OWN board, so competition drives the agent economy without touching the human game. Pure
STATUS, read-only. **(3) The MCP server** (`omerta-mcp/` — a standalone package, `@modelcontextprotocol/sdk`,
its own `package.json`/`README.md`/`.gitignore`) — exposes the game as MCP tools so any MCP-capable agent
(Claude Desktop/Code, an SDK agent) plays natively: `omerta_start` (guest→agent-key→create), `omerta_me`,
`omerta_rules`, `omerta_opportunities`, and the universal `omerta_request {method,path,body}` escape hatch
over all ~279 routes (mutations auto-carry an idempotency key; errors are the stable string codes). A thin
stateful stdio proxy over the HTTP API (low-level `Server` API, zero-zod, version-tolerant); config via
`OMERTA_BASE_URL`/`OMERTA_TOKEN`/`OMERTA_INVITE`. The biggest distribution lever — list it in MCP registries.
`AGENTS.md` now points agents at `/v1/opportunities` (the "poll this" surface) + `/v1/leaderboard/agents`,
with a **niches playbook** subsection; the OpenAPI `opportunities` tag + `llms.txt` + the wiki's "For agents"
section reference both. `test/hardening.js` covers the board (arbitrage spreads computed, ranked opportunities
+ counts + AMM spot) + the agent leaderboard (agent-flag players listed with net worth + extracted). Suite
30/30 + sim drift-0. **The full agent-experience roadmap is now built** (Gateway + Economy); deferred
next-tier ideas (not requested): agent-specific rate-tier tuning, a sandbox/testnet flag, and listing
`omerta-mcp` in public MCP directories (a deploy/marketing step, not code).

**THE VALUE-CREATION PIVOT — "THE STREET WAGE" (founder-directed 2026-07-23) — E1 BUILT**
(`omerta-value-creation-design.md` is the new economic constitution; `src/emission.js`,
`test/emission.js` — the 35th suite). The founder retired "the game never creates value": the game
now CREATES $OMR on a fixed, transparent, DECAYING schedule so playing well is a real income stream
(the side-hustle vision), built the anti-Axie way — supply is INELASTIC: **(1) the Emission
Endowment** (`EMISSION.ENDOWMENT_OMR` 1M — lifetime ceiling, mirrored as a Safe-held tranche in E2)
+ **(2) halvings** (`EPOCH_OMR` 500/day × `DECAY` 0.5 every `DECAY_EVERY` 180 epochs from
`EPOCH0`; `epochBudget` is a CEILING not an obligation — unearned budget is never minted) +
**(3) earned, never by chance**: the daily worker epoch (`runWageEpoch`, the runSeasonRollover
per-char-txn twin — chars→accounts lock order, pre-computed shares so a crash-resume can't inflate,
snapshot-epoch stamp = idempotency) pays pro-rata on RESPECT GAINED that epoch (energy-bounded),
per-account-capped (`WAGE_CAP_OMR` 5), level-floored (`WAGE_MIN_LVL` 5), min-score-gated
(`WAGE_MIN_SCORE` 25), agents + banned EXCLUDED (the referral posture). §10.4: `emission:` joined
the omr vocabulary + the MINT term, plus a NEW **`emission within endowment`** check (overrun =
alarm); `wage_snapshots` (new table) is estate-WIPED (heir enrolls fresh; migrate.js DISPOSITION).
Board `GET /v1/wage` + a public `rules.emission` block (the schedule is verifiable by anyone) + a
Street Wage card on Going Legit. The Vig/full-reserve/extraction rails are UNTOUCHED — the endowment
is the wage FLOOR, revenue the upside; the invariant generalizes to extraction ≤ endowment released +
revenue inflow. E2 (chain, mainnet-gated): scheduled endowment tranche → `fundReserve` so wages are
extractable 1:1; E3 (product): low-minimum withdrawals, sponsored claims, localization, wage
statements. Suite 35/35 + sim drift-0. ALL `EMISSION.*` numbers are founder sign-off levers —
re-derive real-money sizing before ANY launch copy mentions earning (see Sensitive notes).
**THE EXIT TOLL (same directive):** every \$OMR withdrawal now pays \`WITHDRAW_TAX_BPS\` (2%, env,
read per-call — the RATE_LIMIT precedent) split \`TAX.DEV_BPS\` (50%) → the new \`dev_fund\` bucket
(founder revenue, claimed via \`POST /v1/mod/dev/claim\` — a transfer, never a mint) and 50% →
\`stake_pool\` (the buyback/yield pool). Gross debited, NET signed on the voucher (reserve/daily-cap
checks use net); the toll is NON-refundable (cancel/reclaim refund the net only). §10.4: \`tax:\` in
the omr vocabulary (neither mint nor burn), \`dev_fund\` in omrBuckets — conservation exact.
test/chain.js gained the EXIT TOLL block (legacy exact-amount blocks pin WITHDRAW_TAX_BPS=0);
tools/chain-e2e.js asserts the on-chain delta against the voucher NET. Deliberately not a
fee-on-transfer token (breaks DEX composability) — the toll sits at the game boundary. The full
tax map (in-game takes → street-tax buyback; Store 40/40/20; bonds POL/Vig; the toll) is §8 of
the value-creation design doc.

## Sensitive design notes
- **The Street Wage pays players on a schedule — legal surface (counsel-gated messaging).** Paying
  players real-value $OMR at scale can trigger money-transmission / employment / securities questions
  by jurisdiction. The MECHANICS ship under the standing counsel-approval directive; the MESSAGING
  does not: no earnings promises, no income claims, no "side hustle" language in official copy until
  counsel clears exact wording. Describe the schedule factually only. The wage must NEVER become
  discretionary or chance-based (it would break both the anti-Axie wall and the RWA no-chance rule).
- **Utility-only is being retired** by the founder's Risk-to-Earn pivot (above). $OMR is becoming a
  losable/extractable asset (Phase 1 makes it lootable; Phase 2 makes it a real living). Still do NOT
  add explicit price-appreciation *marketing/messaging* — that stays out for legal reasons until
  counsel signs off on Phase 2. The mechanics change; the promises don't.
- Social/onboarding rewards pay in-game cash only, never $OMR (v24 rule) — unchanged.
- Agent-flagged accounts: excluded from referral payouts, harder rate limits, public badge.
- **The tier-2 "family tree" referral is intentionally a FLAT, one-time cash finder's fee — NOT an
  ongoing percentage of the grandrecruit's earnings.** That distinction is the anti-MLM line and it is
  load-bearing: a bounded per-recruit bonus is a referral incentive, an ongoing revenue share down a
  multi-level tree is a pyramid. Keep it CASH ONLY, DEPTH 2 (never a 3rd level), agent-excluded at every
  level, once ever per recruit. The founder green-lit it under the blanket "assume counsel approved
  architecture" directive; do NOT deepen the tree or convert the fee to a percentage without counsel.
- **The RWA tickers are REAL Robinhood tokenized stocks trading on Uniswap** (ERC-20s, `stocks`
  category, Arbitrum / Robinhood Chain) — founder clarification 2026-07-19, recorded in
  `omerta-rwa-portfolio-design.md`. Implications: R2's buy-bot swaps ETH → the actual stock-token on
  Uniswap into the reserve (backing price = the live Uniswap TWAP, the oracle the Vig bot already
  reads); R3's extraction delivers that real token to the player's wallet (the one KYC'd securities
  event). **R1's in-game price stays the deterministic §7.11 hash proxy — NOT the live Uniswap price —
  on purpose** (a price tracking a real security weakens the "pure status" posture that keeps R1
  shippable everywhere; the real oracle only appears in R2 behind the KYC line). **Jurisdiction is a
  hard gate:** Robinhood tokenized stocks are EU-facing and NOT for US persons (counsel/Robinhood
  confirm current status), so R3 must be KYC'd AND geofenced — a US-person account plays/earns/holds
  the status fully but can never extract. R1 (status only) ships to everyone. Never distribute the
  token by chance (RNG/loot/casino stay in cash/$OMR) — unchanged, now with a real security at stake.

**FULL-SURFACE RED-TEAM (`AUDIT-full-surface.md`, 2026-07-20)** — a max-effort whole-project audit,
FIVE independent lenses in parallel (§10.4/economy, concurrency/locks, smart-contracts+chain,
auth/infra/agent-surface, wiki-gaps/completeness), every finding re-verified against source before any
fix. **No CRITICAL.** Fixed in-commit (regression each): **HIGH** — a two-party post-commit
double-spend seam (`game.js:443` `maybeQualifyReferral` was a bare await in the withTwoCharacters hook
vs the wrapped solo path — a 40P01/DB error after COMMIT → idempotency release → retry re-runs the
two-party action; now swallowed non-fatal); **MED (auth)** — the public `/openapi.json` enumerated the
whole `/v1/mod/*` surface + declared the `x-mod-key` header (now excluded; 249 paths) AND derived
security from a URL heuristic instead of the real preHandler (the onRoute hook now captures
`auth`/`modAuth` by name; `buildOpenApi` derives security + mod-exclusion from those flags); **MED
(chain)** — `mod/bond/simulate` fabricated unbacked Vig revenue (`recordBond` injected
`vig_revenue(source='bond')` unconditionally → `runVigBuyback` spends it → unbacked withdrawal reserve,
invisible to `runVigInvariants`; the Store fixed this exact class via a txHash gate — bonds now mirror
it: a new `bonds.tx_hash` column + a `real` gate books the OMR tranche for QA but ZERO pol/vig for a
comp, and `runBondInvariants` reconciles the ETH split over real bonds only); **LOW (chain)** — a
`queued` withdrawal burned $OMR with no reclaim if the reserve never funds (new
`POST /v1/withdraw/:id/cancel` → `cancelQueuedWithdraw` reverses the burn net-0, safe since a queued
voucher was never signed; locks account→reserve, serializes with drainQueue); **docs/client** — Spread
the Word + the referral-funnel expansion were undocumented in BOTH codices (now in `docs/WIKI.md` +
`public/wiki.html`), the Agent Gateway was missing from the canonical doc (now in both), and
`GET /v1/leaderboard/foundation` had no console surface (added to the Family tab). Verified SOUND: the
chain core walls (EIP-712 parity, full-reserve queue, no owner-mint, CEI/reentrancy, the minted-only
extraction gate), the referral once-ever latches + atomic tier-2 claim + push-can't-mint + the
grand-referral lock order, and the read-only agent aggregators. Flagged for founder sign-off (NOT
patched, ground rule #1): OmertaBond per-day cap (Solidity — the pre-mainnet contract pass), a
`CHAIN_ID`-vs-RPC boot assert (deploy hardening), the `wire_month` grant dropped in the death→heir gap,
tier-2 paying a grandrecruiter whose middle link never qualified, the agent leaderboard's exact-net-worth
disclosure, and the two-drifting-codices process gap. Suite 30/30 + sim drift-0.

**AUDIT FLAGGED-ITEMS — ALL ADDRESSED** (founder-directed "address all the flagged items"). The six
sign-off items from AUDIT-full-surface.md, now built + tested: **(1)** OmertaBond gained a per-UTC-day
OMR cap (`dailyCapOMR` + `bondedOnDay`, owner-settable, `require("OB: daily cap")` in `bond()`) — the
`VoucherClaim.dailyCapOMR` twin bounding a leaked signer's daily blast radius; constructor takes
`dailyCapOMR_`, a Foundry test (`test_daily_cap_blocks_over_budget`) added, suite **compiles clean**
(solc 0.8.26, 0 warnings — `forge test` still the pre-mainnet gate). **(2)** `assertChainId()` (chain.js)
compares `CHAIN_ID` to the RPC's real `getChainId()` and the worker refuses to start the chain sync on a
mismatch — a wrong-but-nonzero CHAIN_ID can no longer sign vouchers under the wrong EIP-712 domain.
**(3)** the `wire_month` grant is no longer dropped in the death→heir/pre-creation gap: with no living
character it PARKS on `account_persistent.wire_pending_days`, and `store.js:claimPendingWire` applies it
at the next character's birth (wired into `POST /v1/character`); `test/store.js` covers park→apply.
**(4)** tier-2 "family tree" now requires the MIDDLE LINK to be a qualified recruit (`r.ref_paid`) — every
level of the tree must be a real made man; `test/growth.js` qualifies the middle link first. **(5)** the
agent leaderboard now publishes WEALTH BANDS (`wealthBand`/`omrBand`), not exact liquid, so a hunter can't
compute precise kill-EV on a named agent (the convoy value-band precedent; rank still uses the exact
figure server-side). **(6)** the two-codices drift is now guarded by a `test/hardening.js` drift-detector
that fails if a re-synced system falls out of EITHER `docs/WIKI.md` or `public/wiki.html`. Suite 30/30 +
sim drift-0; contracts compile clean.

**CONTENT-DEPTH SURVEY (2026-07-20)** — a build-depth ranking of every gameplay system to find expansion
candidates. **Thinnest (most due for a content drop), ranked:** (1) **Boxing** — 1 fighter/manager,
recruit/train/list/fight only; defers stable, belts, NPC exhibition bouts, spectator betting, career
legend. (2) **World / rival families** — one `raid` verb over 3 shared-reservoir NPCs; the seizable-NPC
frontier is deferred. (3) **The Wire** — tap/sweep/subscribe are flat, no progression/tiers/leaderboard.
(4) **Territory rackets** — the thinnest income catalog (3 kinds vs businesses' 5, assets' 30). (5)
**Skills** — a clean 3×3 tree capped at tier 3; defers tier-4 capstones + active abilities. Stubs:
Landmarks (one-shot flex), Dynasty naming, Vanity (complete for their narrow cosmetic role). Deep / need
nothing: Social-PvP core (29 crimes + contracts/hitmen/vendettas), Economy (60 cars/30 assets/18 rackets),
Kitchen, Casino, Pen (4 steps), Speakeasy (4 steps), Loans (4 steps), Law/RICO (4 phases), Underworld (5
steps), Gangs, Market, Portfolio. The sharpest thin-vs-deep signal is catalog size: `TERRITORY_RACKETS`=3
and `WORLD_NPCS`=3 and boxing's zero fighter-catalog vs `CARS`=60 / `ASSETS`=30 / `CRIMES`=29.

**THE SIGN-OFF PASS — `SIGN-OFF.md` (founder decision sheet) — BUILT** (`SIGN-OFF.md`, `tools/sim.js`
P9.11, `BALANCE.md` pointer; founder-directed 2026-07-21). Consolidated every OPEN founder sign-off lever
+ design call scattered across `BALANCE.md` (~50 sections) and the 25 `AUDIT-*.md` residuals into ONE
ranked, plain-English decision sheet — each row a what/risk/measured-number/recommendation/dial with a
SHIP / CHANGE / WATCH verdict (Tier 0 the two applied-but-not-production-signed retunes; Tier 1 the biggest
faucets/levers; Tier 2 real balance risks; Tier 3 the Pen tuning set; Tier 4 loan-sharking calls; Tier 5
accept-for-alpha; Tier 6 the SEPARATE legal+audit-gated chain track). Gathered via three parallel extractor
subagents (BALANCE open flags / audit residuals / sim-coverage catalog), each cross-checked. Closed the
sim-measurement gap the pass surfaced: `tools/sim.js` gained **P9.11** — analytic probes (the P9.8/9.10
precedent, zero value seeded, §10.4 untouched) for the previously-unmeasured founder-flagged faucets:
**frontier tribute ≤ $157k/day base-wide** (World step four), **speakeasy bar take $3.12M/day/club at top
tier** (newly surfaced as a territory-scale front — the one row flagged to sim net-of-upkeep-and-raid before
production), **pen yard-work ~$400/work** (self-limiting, jailed-only), and the **World step-five liberation
on-ramp** ($45k docks → $3.6M neon at full outfit strength, flooring to $30k once routed). Sim stays drift-0
+ suite 30/30. The headline recommendations flagged for a real-money economy: speakeasy bar-take net EV,
the apex solo-raid floor (gate to crews), the fight-fix Sybil cap, and the Tier-6 chain gates (run
`forge test`). Nothing was unilaterally retuned (ground rule #1) — the sheet is decision-ready, awaiting the
founder's SHIP/CHANGE/WATCH per row.

**SIGN-OFF SHIPPED (founder-directed 2026-07-21, "ship all recommendations").** The `SIGN-OFF.md` CHANGE
rows applied + tested (suite 30/30, sim drift-0): **(1.3)** apex World outfits are now CREW-ONLY —
`raidNpc` refuses `fixture.coop` (kryl/moreau/volkov), board `canRaid && !f.coop`; closes the apex
solo-raid floor B1 (the crew path already gated the inverse `solo`, so the symmetry is closed).
**(2.5)** `CASINO.FIGHT_BET_MIN_LVL` (5) — an anti-alt floor on fight bets (the WANTED_MIN_LVL/npcHit
rookie-floor precedent) that raises a fight-fix Sybil ring's per-alt cost. **(Pen T3)** `PEN.QUIET_WEIGHT`
(0.45) reweights `yardEventOf` so hard-block yard days (lockdown/toss) fall below ~25% (was ~40%);
distributional regression in `test/pen.js`. **(Loans Tier 4)** THE DEBT SURVIVES THE LENDER —
`voidLoansAtDeath` reassigns a dead lender's ACTIVE loan (+ pledged collateral) to the HEIR instead of
voiding it (§10.4-neutral, the claim just changes hands; `runEstate` hoists `heirId` above the loan-void
to pass it), closing the kill-your-lender-to-erase-the-debt moral hazard; the collateral-death test now
asserts survival-to-heir. **(2.7, deploy-config)** production must run `SOCIAL_VERIFY_MODE=live` for the
Spread-the-Word faucet (alpha keeps `trust`). Regressions added across world/casino/pen/loans. Everything
else on the sheet is SIGNED at the recommended verdict or on the alpha WATCH-list; the Tier-6 chain/legal
items stay a separate gate. `SIGN-OFF.md` + `BALANCE.md` record the resolution.

**SPEAKEASY UPKEEP — the sign-off's one open number, DIALED (founder-directed 2026-07-21).** The net-EV
measurement pass (sim P9.12) surfaced the passive bar take as the richest low-risk earner (top tier
$3.12M/day, ~6d payback) and corrected two of the doc's own assumptions — there was NO "pad" upkeep on a
speakeasy, and raid notoriety is patron-driven (table/rounds), NOT the owner's passive collect, so a
bar-take-only owner drew ~0 raid tax. Founder's call: apply the upkeep drip (over trimming the income
curve). Shipped: **`SPEAKEASY.UPKEEP_BPS` (2000 = 20%)** comes off the top of every `collectSpeakeasy` as a
`speakeasy:upkeep` §10.4 cash SINK (the business-'pad' rate) — the bar take is no longer risk-free. Both the
income faucet + the upkeep sink are character_id'd under the existing `speakeasy:` cash prefix → ZERO
invariant/vocab change (the per-character check reconciles). Top-tier net $3.12M → $2.496M/day, payback
~6.0d → ~7.5d; every tier keeps 80% gross. `test/speakeasy.js` asserts gross/upkeep/net + the ledgered
sink; sim P9.12 prints net-of-upkeep by tier + the verdict. Suite 30/30 + sim drift-0. The `incomePerHr`
curve remains a further founder dial; SIGN-OFF.md row 1.2 marked RESOLVED.

**STREET RACES — a new content drop (`src/races.js`, `test/races.js` — the 31st suite).** The deep 60-car
catalog (`CARS`) had barely mattered beyond melt/fence value; racing turns it into a competitive loop. A
car's RACE POWER = `sqrt(carVal) + tune×TUNE_POWER + wheelman speed/2 − damage` (`rules.js:carPower`), so
fast/valuable iron wins but tuning + the driver's speed stat decide close races. Three loops, all CASH (the
Den's rule), built on the audited boxing/casino architecture: **(1) the PvE CIRCUIT** (`raceNpc`,
`POST /v1/races/npc`) — pay a tier fee (BURNS win/lose, a §10.4 `race:fee` cash sink), beat the NPC field
(`carPower + rand(VARIANCE)` vs `tier.fieldPower + rand`) for a bounded PURSE (a `race:purse` faucet, only
on a win — the boxing-exhibition precedent); a loss dings the car (the existing damage mechanic). **(2) PvP
WAGER races** (`raceChallenge`, `POST /v1/races/challenge/:ownerId`, two-party) — consent-by-listing
(`cars.race_limit`, the fade/bout pattern), the audited **casino:pvp** taxed transfer (`race:wager`: winner
nets wager − 5% rake, loser −wager, half rake → street tax/buyback, half burns — NO escrow, one atomic txn),
the loser's car takes damage; challenger cooled down. **(3) TUNING** (`tuneCar`, `POST /v1/races/tune/:carId`)
— a `race:tune` cash sink (+power, capped `TUNE_MAX` 5) that gives the car catalog progression. **THE WHEEL**
— `account_persistent.race_wins` (lifetime wins, SURVIVES DEATH — the boxing-legend precedent) +
`RACES.RANKS` + `GET /v1/leaderboard/races`. New columns `cars.tune`/`cars.race_limit`,
`characters.race_at` (per-driver cooldown, DIRECT SQL — the active_at pattern, outside persist),
`account_persistent.race_wins`. §10.4: `race:` joined the cash `KNOWN_REASONS` — every fee/purse/wager/tune
row is character_id'd, so the per-character cash check reconciles (the PvP rake→pool/burn is the audited
casino:pvp mechanism, outside the character-cash set); cars die with the street (already in the runEstate
garage wipe — no new estate code). `RACE_CD_MS` is a TEST-ONLY cooldown knob (the SEARCH_MS precedent).
Routes + `GET /v1/races` board + `/v1/rules` catalog + a **"Street Races"** console tab (Vice group: your
garage with power/tune/list, the PvE circuit, the PvP strip with value BANDS, THE WHEEL leaderboard) +
`describe()` humanization. `test/races.js` proves car power, the PvE circuit (fee-burn + bounded purse +
level/tier gates), tuning (sink + cap), the PvP taxed transfer (winner nets wager − rake, half → street tax,
loser's car damaged, all gates), the legend + leaderboard, and §10.4 (per-character cash reconciles).
**The PvE purse is the drop's ONLY new faucet** — sim P9.13 measures it (a tuned contender +$60k/day, a
premium monster +$216k/day at the 2h-cooldown/12-per-day cadence — bounded, in boxing-exhibition parity;
the initial 30-min/48-per-day defaults measured a $3.12M/day printer and were retuned DOWN before ship).
Suite 31/31 + sim drift-0. All `RACES` numbers (tiers/fees/purses/`CD_MS`/`TUNE_*`/`RAKE_BPS`/`VARIANCE`)
are founder sign-off levers — flagged in BALANCE.md (the exhibition-purse precedent). A **three-lens
red-team** (`AUDIT-street-races.md`: §10.4/persist, concurrency/locks, exploit/grief) returned **no
CRITICAL/HIGH**: §10.4 exact (the PvP transfer is the audited casino:pvp pattern byte-for-byte, no mint;
`race_at`/`tune`/`race_limit`/`race_wins` are direct-SQL, no persist-clobber), lock order sound (races.js
is the ONLY `cars … FOR UPDATE` in the tree, so the uniform chars-before-cars order is acyclic), and the
gates/estate/cross-system (Black-Market-listed + loan-pledged cars rejected both sides) are tight. Fixed
one **LOW** (regression added): `raceChallenge` cooled the challenger but credited THE WHEEL to the winner —
so an owner-account could be fed status wins by alt challengers with no throttle of its own; now the WINNER
is cooled too (a losing owner isn't — no farm, no grief-lockout), bounding WHEEL accrual to the per-driver
cap on either side. The "thin edge" comment was corrected to the real figure (an over-powered car nets up
to +60% of the fee at the top tier). Accepted balance flags (founder sign-off): the PvE purse faucet
magnitude (boxing-exhibition parity), the casino:pvp-posture collusion rail, consent-by-listing owner
spam, no safehouse gate on a consensual cash game. Suite 31/31 + sim drift-0.
**Step two — PINK SLIPS + NITROUS — BUILT** (`src/races.js`, `src/rules.js` `RACES` tail, `schema.sql`,
`test/races.js`; the deepen-a-thin-system drop — step one was the thinnest recently-built loop). **(1) PINK
SLIPS** (the iconic street-racing fantasy — race for the car itself): a car offered for pinks (consent-by-
listing via `cars.pink_slip`, `pinkSlipList`/`POST /v1/races/pinkslip/:carId {on}`) can be raced for the
TITLE (`pinkSlipRace`, `POST /v1/races/pinks/:ownerId {myCar,theirCar,nos}`, two-party) — the winner TAKES
the loser's raced car, a **§10.4-NEUTRAL ownership transfer** (`UPDATE cars SET character_id=winner` — cars
conserve by ROW COUNT, no ledger row, no cash moves — the chop/market-seize/loan-collateral precedent) that
can push the winner past `GARAGE_CAP` (the market-win precedent). It rides the SAME power/variance/cooldown/
WHEEL machinery as a cash wager race (gates self/family/jailed/hosp/not_offered + the two-car sorted `FOR
UPDATE` lock, the raceChallenge pattern); the loser's car resets `race_limit`/`pink_slip`/`nos` on transfer;
the WHEEL credit keeps the `WHEEL_MIN_LVL` anti-Sybil floor on the loser. **(2) NITROUS (NOS)** — a per-car
consumable (`cars.nos`, `RACES.NOS_COST` $15k / `NOS_MAX` 3 / `NOS_POWER` +60): `buyNos`
(`POST /v1/races/nos/:carId`, a §10.4 cash SINK `race:nos`, capped) arms a charge; the actor may burn ONE on
a race (`{nos:true}` on npc/challenge/pinks — their OWN car only, never the passive owner's without consent)
for a one-race power bump (rng-audited, consumed win/lose — absolute INT writes, the pg-mem quirk). §10.4:
`race:nos` rides the existing `race:` cash prefix (**zero invariants.js change** — a character_id'd sink →
the per-character cash check reconciles); pink-slip transfers are car-conservation-neutral (row count
unchanged). The board (`GET /v1/races`) surfaces `nos`/`pinkSlip` per car + `forPinks` on the strip +
the NOS config; `/v1/rules` gained `nos`/`pinkSlips`; the console Street Races tab gained NOS buy/burn +
put-up/pull-pinks + a 🎀 for-pinks race button (with a "your car is GONE if you lose" confirm) +
`describe()` humanization. `test/races.js` covers the NOS buy (sink + cap + board) + consume, and the
pink-slip race (the not_offered gate, the strip surface, the ownership transfer to the winner, car
conservation holding, NO `race:pink` ledger row / no cash moved, the shark holding both cars + the mark
walking home). Suite 31/31 + sim drift-0. All numbers (`NOS_*`) are founder sign-off levers; pink slips
add no lever (they ride the audited race machinery). Deferred (step three): THE GRAND PRIX (a scheduled,
worker-resolved cash parimutuel — the boxing-main-event/poker-tournament escrow twin).
A focused three-lens red-team (`AUDIT-street-races-step-two.md`: §10.4/conservation, concurrency/locks,
death/PvP/cross-system) returned **no CRITICAL/HIGH** and fixed one **MED consent-bypass** (a pre-existing
step-one class, amplified by step two): the race flags SURVIVED an ownership change — `listCar` rejects
only `listed`/`pledged` cars (not a `race_limit`/`pink_slip`-flagged one), and the four car-transfer sites
(market buy-now + auction-settle, loan collateral collect + sweep-forfeit) cleared only `listed`/`pledged`,
so a car flagged for a wager/pinks, then SOLD or SEIZED, arrived at the new owner still on the strip —
raceable without their consent (and for a wager, exposing them to a cash loss up to a limit they never
set). Fixed: every `UPDATE cars SET character_id=…` transfer site now also clears `race_limit=NULL,
pink_slip=false` (mirroring `pinkSlipRace`'s own transfer); regression added (a flagged car bought on the
market arrives with both flags cleared + off the strip). Verified CLEAN: §10.4 (pink transfer moves no
currency, car-conservation-neutral; `race:nos` a character_id'd sink on the existing prefix), lock order
(chars→accounts→cars, acyclic, TOCTOU-safe under the car lock), death (flags are row fields not pointers),
and grief (both-consent, WHEEL floor, no warehouse). Accepted (flagged): a deliberate pink loss is a
near-tax-free car gift — but the market already allows that (list at the min bid), §10.4-clean.
**Step three — THE GRAND PRIX — BUILT** (`src/races.js`, `src/rules.js` `RACES.GP`, `schema.sql`,
`src/invariants.js`, `src/worker.js`, `test/races.js`; the deferred centerpiece — a scheduled,
worker-resolved CASH parimutuel, the **poker-tournament escrow twin** on the races side). Drivers
`enterGrandPrix` (`POST /v1/races/gp {car}`) — a `GP.BUYIN` ($25k) cash ESCROWS into a pool during an open
window (`GP.REGISTER_MS` 30 min; `GRAND_PRIX_MS` env TEST-ONLY, the SEARCH_MS pattern); the car isn't
escrowed (only the cash is) so its race POWER is SNAPSHOTTED at entry (`grand_prix_entries.power`) — you
race the form you entered, and the car is free to use/sell after. One open GP at a time
(`grand_prix_state.current`), a fresh one materializing on the next entry after the last settles (the
tournament pattern). The worker (`sweepGrandPrix`→`resolveGrandPrix`, wired in worker.js) races every LIVE
entrant (`power + rand(VARIANCE)`), ranks DESC (fast/tuned iron wins, the road is fickle), and pays the top
`min(field, PAYOUTS.length)` places a RENORMALIZED share of the pool net of `GP.RAKE_BPS` (5%, half →
street tax/buyback, half burns) — so the house edge stays the rake at any turnout; ties split; a dead
entrant's stake burns (`race:gp:death`); a field < `GP.MIN_ENTRANTS` (3) refunds the grid. A pure
competitive REDISTRIBUTION — **no new faucet** (unlike the PvE purse), skill+gear decides (distinct from
the poker tournament's pure chance). §10.4: every `race:gp:*` reason rides the existing `race:` cash
vocabulary (**zero reason change**) + a NEW **`grand prix escrow`** check (open pool == Σ buyin − win −
refund − take − death — the poker-tourney-escrow twin). **Lock order** = the tournament posture exactly:
enter locks char → `grand_prix_state` → gp row; `resolveGrandPrix` locks entrant chars sorted →
`grand_prix_state` → gp row (state BEFORE the gp row, so a concurrent entry can't AB-BA — the
AUDIT-casino-tournament fix, mirrored). Board (`GET /v1/races`) surfaces the open GP (pool/grid/clock/your
entry); `/v1/rules` gained `grandPrix`; the console Street Races tab gained a Grand Prix card + `describe()`.
`test/races.js` covers the enter gates (level/no-car/double-entry), the buy-in escrow + the §10.4
grand-prix-escrow check mid-open, a full grid settled by the worker (a dead entrant's stake burned + the
top places splitting net of rake, escrow closing to `wins+take+death==Σbuyin`), a short-grid refund, and
the state clearing for the next race. Suite 31/31 + sim drift-0. All `GP.*` numbers are founder sign-off
levers (a redistribution, no signed faucet touched). **Red-team:** the escrow surface is a faithful port
of the already-audited poker tournament — §10.4 escrow identity exact (open == posted; resolved nets 0),
the enter-vs-settle lock order acyclic (state-before-row), single-writer worker settle (no player-lock
races, idempotent status gate), the power SNAPSHOT sidesteps a "car gone at resolve" bug, alt-stuffing is
−EV (renormalized −rake/N), and a dead/estated entrant burns cleanly (the §10.4 death row is NULL-character,
excluded from the per-character check). The Street Races pillar is now feature-complete (PvE circuit + PvP
wager + tuning + THE WHEEL → pink slips + nitrous → the Grand Prix).
**FAUCET MEASUREMENT (`tools/sim.js` P9.13 addendum + P9.16, this session's races drops; zero value seeded,
§10.4 drift-0 — the P9.8/9.13 precedent):** **(1) NITROUS** — the first probe flagged it as "never +EV,
−$11.3k" but that was a PROBE ARTIFACT (it modeled a mid-tier FAVORITE, whom NOS can't help — NOS is FOR an
underdog); the corrected probe (power = field − 20) shows NOS is strongly +EV as a comeback (flip a likely
loss to a win on a mid/high-purse race) and correctly wasted for a favorite. **TUNED (founder-directed):
`NOS_COST` $15k→$8k** so the Ghost comeback is genuinely rewarding (an underdog-with-NOS: +$600→+$7.6k
absolute) + viable on Midnight, still a sink for favorites/cheap races (no faucet, no farm). **(2) THE GRAND PRIX** —
**ZERO new emission** (a redistribution: the field funds the winners; the only §10.4 effect is the burned
half of a flat 5% rake, ~$1.9k–$5k/race) — the ideal for a competitive mechanic, a net sink, no signed
faucet touched. **(3) PINK SLIPS** add no faucet/lever (a §10.4-neutral car transfer). The sim prints all
three every run so any retune is re-measured.

**THE PORT — maritime smuggling (step one) — BUILT** (`src/port.js`, `test/port.js` — the 32nd suite;
design `omerta-the-port-design.md`). The SEA counterpart to convoys — deliberately distinct: convoys move
YOUR trade goods over LAND in trucks that other PLAYERS hijack (internal arbitrage); the Port brings
CONTRABAND in from OFFSHORE by BOAT, and the antagonist is the LAW (the Coast Guard, a PvE interdiction),
not a rival. **Boats are a new buyable asset, bought like cars** (`boats` table, `boatOf`/`PORT.BOATS` —
Dinghy $40k → Cigarette Boat $12M, each with a cargo `hold` + a `speed` that slips patrols; `FLEET_MAX` 5,
resale `RESALE_BPS` 60%, `port:boat` cash SINK to buy / `port:sell` faucet back — and they **DIE WITH THE
STREET**, joined to the runEstate wipe like cars). **The run** (`launchRun`, `POST /v1/port/run/:boatId`):
at the docks (`PORT.DISTRICT`), pick a route (`PORT.ROUTES` — Coastal Hop lvl6 → The Deep Run lvl32, each a
per-unit buy/sell + a `patrol` rating + a `minSpeed` gate), the boat's full hold is sourced as contraband
(`port:buy` cash SINK), optionally hire an ESCORT (`port:escort` sink, +`ESCORT_DEF` vs patrols), and she's
at sea for the route's clock (`PORT_RUN_MS` env is TEST-ONLY, the SEARCH_MS precedent). Gates:
jailed/hospitalized/safehoused (D2)/wrong-district/busy/bad_route/route-level/too_slow (boat speed <
route minSpeed)/supply-cap. **The lazy collect** (`collectRun`, `POST /v1/port/collect/:boatId`): rolls
INTERDICTION (`interdictChance` = clamp[`INTERDICT_MIN` .03, `INTERDICT_MAX` .85] of `(patrol ± cityHour
patrolMod − boat speed − escort def)/100`, rng-audited; `PORT_INTERDICT_P` TEST-ONLY) — **CLEAN** → the
haul fences for the route's sell rate (`port:sale` cash FAUCET; net = landed − cost = the smuggling margin);
**INTERDICTED** → the Coast Guard SEIZES the cargo (never banked), FINES `FINE_RATE` (50%) of the cargo
cost clamped to pocket+bank (`port:fine` cash SINK, the raid-fine precedent, pocket-then-bank), spikes heat,
and rolls `SINK_P` (15%; `PORT_SINK` TEST-ONLY) to IMPOUND/SINK the boat (deleted). **The one new faucet is
bounded three ways**: the per-boat run clock, interdiction eating runs, and a daily **SUPPLY CAP**
(`SUPPLY_CAP_DAY` $400k, the wash-cap continuous token bucket on `characters.port_used`/`port_at`) — sim-
measured to ~$303k/day best-route-maxed (**Open Water ×1.83 margin / 3% caught**), at boxing-exhibition /
territory parity; the safe Coastal Hop pays less (×1.67) and the Deep Run is high-variance (×2.11 margin /
30% caught / 33% net). §10.4: `port:` joined the cash `KNOWN_REASONS` (buy/escort/fine/boat SINKS +
sale/sell FAUCETS, all character_id'd → the per-character cash check reconciles); the seized cargo + a sunk
boat move no currency (ownership). Routes `GET /v1/port`, `POST /v1/port/boat/:kind|/:boatId/sell|
/run/:boatId|/collect/:boatId`; surfaced on the view + `/v1/rules` + a "The Port" console tab (the supplier
headroom, your fleet with collect/sell/run-it + escort, the boatyard). `test/port.js` covers buy/sell gates,
a clean run (the sale faucet + margin), an interdicted run (fine + heat + boat survives), the boat SINKING,
the supply cap, too_slow, the safehouse block, resale, the board, DEATH, and §10.4. Suite 32/32 + sim
drift-0. ALL numbers (boat catalog, route curves, `INTERDICT_*`/`FINE_RATE`/`SINK_P`, `SUPPLY_CAP_DAY`) are
founder sign-off levers — the `port:sale` faucet is the one new emission surface (BALANCE.md; measured at
parity).
**Step two — NAVAL UPGRADES + PIRACY + the offshore RENDEZVOUS — BUILT** (`src/port.js`, `src/rules.js`
`PORT.STEP2`, `schema.sql`, `test/port.js`; the deferred step-two items). **(1) NAVAL UPGRADES** (the car-`tune`
twin): new `boats.hull`/`boats.engine` levels (each capped `UPGRADE_MAX` 5, a `port:upgrade` cash SINK whose
cost climbs with the level + the boat's tier); `effHold`/`effSpeed` (+`HULL_STEP` 15 cargo / +`ENGINE_STEP` 8
knots per level) fold into every run (cost/hold, the `minSpeed` gate, interdiction) + the board. Upgrades buy
efficiency toward the daily `SUPPLY_CAP_DAY`, NOT a higher ceiling (the cap still bounds daily sourcing → no
new emission). **(2) PIRACY** (`interceptRun`, `POST /v1/port/intercept/:boatId` — the convoy-ambush twin at
sea): a pirate with their OWN fast docked boat + guns runs down a rival's genuinely-at-sea run; the board's new
**THE SEAS** section lists targets as a route + value BAND (never the manifest — the convoy-board rule). Energy
+ ammo (`port:piracy` ammo SINK, `port:` joined the ammo vocab) + heat; a muscle/speed + pursuit-boat contest
vs the runner's `effSpeed` + escort (`PORT_PIRATE_WIN` TEST-ONLY roll knob). A WIN seizes the cargo: the pirate
lands a CUT (`PIRATE_TAKE_BPS` 60%) of its would-be fence value (`port:piracy` cash FAUCET) and the run is
VOIDED — since the take is < 100% and the run dies, **piracy is a §10.4-SAFE REDIRECT of the existing
`port:sale` faucet: total port emission can only FALL**. A LOSS hospitalizes the pirate. One attempt per pirate
per live run (`port_intercepts`, cleared when a boat's run starts/ends/moves); family omertà holds; needs your
own boat → a Port-native PvP loop (+ a use for fast boats). Lock order: pirate char → target boat `FOR UPDATE`
(all run-mutating paths now lock the boat, so piracy + the owner's collect serialize — no double-realize).
**(3) The offshore RENDEZVOUS** (`rendezvous`, `POST /v1/port/rendezvous/:boatId {to}`): a consensual mid-sea
handoff — a runner hands an active run to a partner's docked, rendezvous-flagged boat
(`POST /v1/port/boat/:boatId/rendezvous`, consent-by-listing); the run moves vessel-to-vessel, the runner's
boat frees, the flag is consumed. Use it to hand a hot cargo to a fast/clean captain, or to shake a pirate
tracking your boat. **§10.4-neutral** (no currency; `port:sale` fires for whoever collects); both boat rows
lock `FOR UPDATE` sorted (deadlock-safe vs a concurrent rendezvous/piracy). `port_intercepts` joined the
runEstate wipe; boats already die with the street. Console: the Port tab gained per-boat hull/engine upgrade
buttons + a rendezvous toggle + **THE SEAS** piracy board. `test/port.js` covers the upgrade ladder + effective
hold/speed on the board, piracy (the seas band, level + once gates, a WIN's redirected cut + voided run, a LOSS
hospitalization), and the rendezvous (closed-boat gate + the handoff moving the run + consuming the flag).
Suite 32/32 + sim drift-0. All `STEP2.*` numbers are founder sign-off levers — sim the piracy faucet before
production (it can only reduce emission, but the ammo cost + PvP gate keep it a skill play, not a farm).
**Step three — THE SMUGGLER'S LEGEND + THE HARBORMASTER — BUILT** (`src/port.js`, `src/rules.js` `PORT.STEP3`,
`schema.sql`, `src/invariants.js`, `test/port.js`). **(1) THE SMUGGLER'S LEGEND** — `account_persistent.smuggled`
(lifetime contraband value landed = every clean collect + piracy take, bumped by direct SQL, NUMERIC arith-safe;
account-level → SURVIVES DEATH, the boxing-wins/wheel/war-effort precedent) + `LEGEND_RANKS` (Deckhand → The
Kingpin of the Coast, `portRankOf`) + `GET /v1/leaderboard/port` (`portLeaderboard`, agents excluded). PURE
STATUS — **zero §10.4** (landed value isn't a currency; the cash rides `port:sale`/`port:piracy`, so the test
asserts `legend.smuggled == the account's lifetime port:sale + port:piracy`). Surfaced on `GET /v1/port`
(`legend {smuggled, rank}`) + a console banner. **(2) THE HARBORMASTER** — the family HOLDING the docks tolls
every clean landing there: `port:toll` = `TOLL_BPS` (5%) of the sale, a §10.4 TRANSFER (shipper pocket→bank →
holder treasury, the convoy-toll twin — clamped to pocket+bank, never gates the freight, charged only if the
credit lands; NPC-held / your own family = free). The gang-treasuries check gained `portTollIn`. Ties the solo
Port into turf/family AND synergizes with the World-occupation loop (docks start NPC-occupied → a family
LIBERATES it, then earns tolls). Surfaced on `GET /v1/port` (`harbormaster {holder, tollBps, tolled}`) + a
console warning chip. `test/port.js` covers the legend (the identity + rank + leaderboard + DEATH survival) and
the harbormaster (a held-docks 5% toll → treasury, the net reflects it, the gang-treasuries §10.4 reconcile).
`PORT.STEP3.*` are founder sign-off levers. Suite 32/32 + sim drift-0.
**Step four — THE CONTRABAND MARKET + HARBOR BERTHS — BUILT** (`src/port.js`, `src/rules.js` `PORT.STEP4`,
`schema.sql`, `test/port.js`). **(1) THE CONTRABAND MARKET** — a clean landing can now WAREHOUSE the
contraband as a commodity (`collectRun {warehouse:true}` → `characters.contraband` holds its BOOK VALUE =
hold × route.sell) instead of auto-fencing; `fenceContraband` (`POST /v1/port/fence`) sells the whole
warehouse at a DRIFTING daily rate (`fenceMultOf` — a §7.11 hash, 0.85–1.25, mean ~1.05): a market-timing
play (warehouse a landing, fence high, or eat a bad day / lose it if whacked). `port:fence` cash faucet; the
harbormaster toll + the legend bump fire at fence (cash realized at the docks then). The DEFAULT collect
still fences immediately (`port:sale`) — warehousing is opt-in, the tested flow unchanged. **§10.4-safe:**
contraband is a NON-currency resource (like cargo, not in the §10.4 set), sourced via the supply-capped run
→ the fence faucet is bounded by what was sourced; dying while holding contraband just never fences it (the
`port:buy` sink stands with no owed faucet — the risk of warehousing, §10.4-clean). Contraband + berths DIE
WITH THE STREET automatically (the heir is a fresh character row, cols default 0). **(2) HARBOR BERTHS** —
`rentBerth` (`POST /v1/port/berth`) leases a permanent slip (a `port:berth` cash SINK) that raises the fleet
cap by 1 (`fleetCapOf = FLEET_MAX + berths`, capped `BERTH_MAX` 3). Direct-SQL columns (`characters.contraband`
/`berths` — never in persistCharacter's positional UPDATE, so clobber-safe, the port_used pattern). Console:
a warehouse toggle on collect + a Warehouse & Fence card + a rent-a-slip button. `test/port.js` covers the
warehouse (holds book value, no cash), the fence (proceeds == book × the daily mult, empties, nothing-gate),
and the berth (+1 cap). `PORT.STEP4.*` (FENCE_LO/SPAN 0.85/0.40, BERTH_COST/MAX) are founder sign-off levers
— the fence is a higher-variance faucet than auto-sell (savvy market-timing beats the route rate, bounded by
the supply cap); sim before production. Suite 32/32 + sim drift-0. Deferred (step five): Coast-Guard heat
into the Law meter, warehoused contraband as a LOOTABLE resource on a fire-kill (P1.1).

**OVERNIGHT FULL-SYSTEM RED-TEAM (`AUDIT-full-system-v2.md`, 2026-07-21)** — a max-effort audit, SIX
parallel independent lenses over the ENTIRE codebase (47 src modules) + all 6 Solidity contracts
(§10.4/economy, concurrency/locks, death/estate/PvP, chain+contracts, auth/infra/agent-surface,
cross-system economic exploits), every CONFIRMED finding re-verified against source before any fix, a
regression per behavioural fix, suite 32/32 + sim drift-0 after each batch. **No CRITICAL. No §10.4
drift.** Fixed in-commit: **E-H1 (HIGH)** `verifyX` trusted any X OAuth2 bearer token with no
app-audience binding (a confused-deputy account takeover) → gated behind `X_TRUST_USER_TOKEN=on`
(default-off, the `SOCIAL_VERIFY_MODE`/`INVITE_MODE` posture; the real path is a server-side auth-code
exchange, deploy-time); **C-HIGH-1** `fire()` ignored the Pen shields (`penSafe`/`inHole`) AND `jailed`
on the victim, so a jailed/yard-boss-protected/hole'd inmate was assassinatable from the street (jail
never changes `loc`, and a jailed player can't safehouse — jail was strictly MORE lethal than freedom;
the exact class `npcHit` was patched for, never applied to fire) → the three victim gates added,
mirroring npcHit/huntWanted; **C-MED-1** `npcHit` missing the bare `jailed(victim)` gate; **D-MED2
(HIGH-effort)** mod comp/QA routes could fabricate backed `vig_revenue` via a caller-supplied `txHash`
(and fees.js booked it unconditionally) → unbacked withdrawal reserve, blinding `runVigInvariants`; now
real-ETH revenue is booked ONLY by the on-chain watcher — mod routes strip `txHash` unless
`ALLOW_MOD_REAL_REVENUE=on` (a QA-only flag, default off), fees.js gates on `txHash` like store/bonds
(regression: flag-off + a fabricated txHash books ZERO revenue); **D-MED1** `assertChainId` guarded only
the WORKER but the API process signs the vouchers → asserted in the API listen path (a wrong `CHAIN_ID`
would sign every voucher under the wrong EIP-712 domain); **B-L8** a `CHAIN_ID` mismatch crashed the whole
worker (taking the §10.4 monitor down) → now disables chain sync fail-closed, worker survives; **B-H1**
casino `pvpDice` locked `street_tax` before `den_volume`, inverting the PvE trio (AB-BA on the two hottest
den paths) → reordered `den_volume`-first; **B-M1** `refundPot` iterated funders unsorted (bounty AB-BA
root) → `ORDER BY contributor`; **F-MED1** the Street-Races WHEEL status board was Sybil-farmable (the
winner cooldown was inert — the gate checks the challenger, the bump fired unconditionally) → a level
floor on the LOSER (`WHEEL_MIN_LVL` 10, the WANTED_MIN_LVL anti-Sybil pattern); **E-M1** unthrottled auth
endpoints (guest-mint Sybil / X-Privy fetch amplification) → a per-IP auth bucket (generous burst 20,
production-only); plus LOWs (`runEstate` wipes convoy_ambushes+npc_hits; race+boxing leaderboards exclude
agents; bank/swap guards reject Infinity via `Number.isFinite`; `sweepAuctions` logs poison lots; gear
tokenId append-only pin strengthened with the tail class). **Flagged (not patched — retry-masked /
unreachable / accepted / founder-call, ranked in the report):** B-H2 (bounty repost-vs-sweep — a "fix"
risks a worse deadlock since the repost holds the actor), B-M2/M3/L4 (unreachable/no-clean-fix lock
inversions), F-MED2 (speakeasy notoriety Sybil — the accepted per-account-cap residual), F-LOW1 (port
fine wallet-dodge — a pure sink), D-LOW1/2/3 (deploy-checklist config drift, Safe = root of trust),
E-M2/M3/L1/L2 (infra-hardening backlog). Verified CLEAN: §10.4 across every module, the chain core walls
(EIP-712/replay/reentrancy/full-reserve-queue/minted-gate/no-owner-mint), all persist-clobber &
pg-mem-quirk classes, route-auth coverage & no-SQL-injection, loot/shield-ordering/estate-survival, and
the casino:pvp taxed-transfer family. `forge test` STILL not run (Foundry egress-blocked) — the pre-audit
gate stands. Suite 32/32 + sim drift-0.

**FULL-SYSTEM RED-TEAM v3 (`AUDIT-full-system-v3.md`)** — a max-effort whole-codebase audit, FIVE
independent lenses in parallel (§10.4/economy, concurrency/locks/persist-clobber, death/estate/PvP,
chain+contracts+auth+infra, cross-system exploits), every reported finding re-verified against source
before any fix, a regression per behavioural change. **No CRITICAL. No §10.4 drift.** Fixed in-commit:
**HIGH (config-gated) — chain reclaim double-spend**: voucher signing is gated on {signer,CHAIN_ID,
claim-addr} but the on-chain double-spend guard needs CHAIN_RPC_URL, so `reclaimExpiredVouchers` on a
signing-enabled-but-RPC-less box took the wall-clock branch and REFUNDED burned $OMR for a voucher that
may already be claimed on-chain (double-spend, §10.4-blind); now WITHOUT a reader it never refunds —
skips + retries (the code's own "a delayed refund is recoverable, a double-spend is not" principle), a
refund proceeds only when `usedNonce===false` is confirmed (`test/chain.js` asserts the skip + the
reader-confirmed refund). **MED — `jump` missing victim gates**: `fire`/`npcHit`/`shank` gate an
unreachable target but `jump` gated only hospitalized+omertà, so a JAILED/witpro/penSafe/inHole rival
could be robbed + hospitalized while unable to flee (jail strictly more dangerous than the street, the
class the v2 audit closed on the lethal paths); added `jailed`/`witproActive`/`penSafe`/`inHole` gates
(safehouse stays jumpable by design). **MED — `store.js:grantPackage` wire_until lost-update**: the
headless ETH-Street-Wire grant read-then-wrote the persist-list `wire_until` column absolute WITHOUT the
char lock, so a concurrent `subscribeWire` could be clobbered (a shortened paid window); now
`SELECT … FOR UPDATE`s the char row (char-first, no lock-order inversion). **LOW — `nightlifeLeaderboard`
agent exclusion** (renown gates cosmetic unlocks; both subqueries now `NOT a.agent_flag`, the boxing/port/
races precedent); **Privy `aud` array** (fail-closed compat — accept a scalar OR an array containing the
appId); **`port_intercepts` dead-runner orphan** (swept by the runner's boats before the wipe loop
removes them — the npc_hits both-sides precedent). Verified CLEAN: §10.4 across ~260 ledger sites + every
escrow, the 27-table estate wipe + survivors + shield ordering, boxing/territory/casino/vig/loan/
speakeasy lock order + mint/reroll char→account, EIP-712 parity + the full-reserve queue + fee/store/bond
txHash-gated revenue + the Solidity invariants + OpenAPI /v1/mod exclusion. Flagged for founder sign-off
(NOT patched): the market bidListing AB-BA (retry-masked, the auction accepted class), VoucherClaim.sweep
lacking OmertaBond's over-sweep guard (Safe = root of trust), port warehouse→fence variance, purchasable
Commission seasonal standing, and the shared-dividend-pool allocation — all previously-known/accepted.
`forge test` STILL not run (Foundry egress-blocked) — the pre-mainnet gate stands. Suite 32/32 + sim
drift-0.

**Territory step five — RACKET SPECIALISTS + SPECIAL OPERATIONS — BUILT** (`src/territory.js`,
`src/rules.js`, `schema.sql`, `test/social.js`; the deferred step-five items — the roster-involvement +
active-play depth the income layer lacked). New columns `territory_rackets.specialist`/`spec_power`/
`op_at`/`op_ghost_until`. **(1) SPECIALISTS** (`assignSpecialist`/`unassignSpecialist`, `POST`/`DELETE
/v1/territory/:id/specialist`): a boss/underboss assigns a LIVING family made-man (level ≥
`SPECIALIST_MIN_LVL` 5) to a held operation — one racket per specialist. Passive, PURELY DEFENSIVE (no
§10.4): a FORTITUDE bonus (`specFort` = the member's muscle+cunning snapshot / `SPECIALIST_FORT_DIV` 8,
so assigning your muscle matters) folded into `raidRivalRacket`'s P, AND SCRUTINY resistance (net Bureau
growth × `SPECIALIST_SCRUTINY_MULT` 0.6 via the new `scrutinyNet` helper threaded into `decayedScrutiny`
+ `resolveTerritoryRaid`). **(2) SPECIAL OPERATIONS** (`runTerritoryOp`, `POST /v1/territory/:id/op`,
requires a specialist, per-racket `TERRITORY_OP_CD_MS` 12h cooldown) — racket-TYPE-specific, ALL
§10.4-clean (scrutiny/fortitude only, zero cash / zero faucet / zero invariant change): **numbers →
"Cook the Books"** clears scrutiny; **protection → "Show of Force"** +`TERRITORY_OP_FORT` 1 fortitude
(capped at `FORT_MAX`); **smuggling → "Ghost the Route"** clears scrutiny AND suppresses accrual for
`TERRITORY_OP_GHOST_MS` 6h (`op_ghost_until` → `scrutinyNet` returns 0 in the window; robust vs a collect
resetting `scrutiny_at`). Seizure/dissolution scatter the crew (specialist + op state reset in
`seizeTerritoryRackets`; `releaseTerritoryRackets` deletes the rows). Lock order: the actor's char
(withCharacter) → the racket row only (the ops touch no treasury, so no gang lock, no cycle). Snapshot
`spec_power` (re-assign to refresh — the consent-by-listing precedent). `territoryOf` surfaces
`specialist`/`specFortBonus`/`opId`/`opReady`/`opCdSeconds`/`ghostSeconds`; the console Family tab gained a
specialist picker (from the roster) + pull + a type-labelled special-op button + specialist/ghost chips.
`test/social.js` covers the rank/member/level gates, the assign + fort-bonus (floor((20+12)/8)=4), all
three type ops + the cooldown, the no-specialist gate, and unassign. Suite 32/32 + sim drift-0. All
`SPECIALIST_*`/`TERRITORY_OP_*` numbers are founder sign-off levers (defensive/pacing, off the signed
income + Bureau surfaces — the `TERRITORY_OP_FORT` free fortitude level is the one minor lever, bounded
by the cooldown + `FORT_MAX`). The Territory pillar is now feature-complete (rackets → types + the Bureau
→ empire/leaderboard → fortify + rival raids + upkeep → specialists + special ops).

**FULL-SYSTEM RED-TEAM v4 (`AUDIT-full-system-v4.md`)** — a max-effort whole-codebase audit over the
session's racing/world drops (THE TRACK steps three–four incl. THE FUTURITY, THE STABLE, THE WORLD step
six THE UPRISING) + the systems they touch, SIX independent lenses in parallel (§10.4, concurrency/
locks/persist-clobber, death/estate/PvP, racing internals, world internals, cross-system exploits),
every finding re-verified vs source, a regression per fix. **No CRITICAL. No §10.4 drift.** Fixed
in-commit: **HIGH — THE TRACK "swap the runner under the bet" exploit** (`casino.js`): the Track pays
FIXED odds LOCKED at bet time, but the winner is drawn from the MERGED field, and a ticket stored only
the post INDEX — so you could bet an outside post at a weak NPC's LONGSHOT odds, then `enterTrackRace` a
MAXED racer onto that post (it becomes the favorite), and collect the favorite's near-certain win at the
locked longshot price (a large +EV skim off the den book). Now the bet SNAPSHOTS which runner it backed
(`track_bets.bet_racer_id` — a player racerId or NULL for an NPC); `claimTrack` runs a SCRATCH check
first — if the identity at the post changed, the ticket refunds 1:1 (`casino:win:track` +
`bumpProfit(-refund)`, den book nets 0), never the stale price (regression: a swapped-post ticket
REFUNDS not pays). **MED — the racer-legend AB-BA**: `sweepTrackEntries` + `resolveFuturity` locked a
`racers` row then bumped the owner's `account_persistent` (racer→account), inverting the player-side
account→racer order (withCharacter holds the account, then locks the racer) → an AB-BA masked by the
40P01 retry; both now lock account BEFORE racer, and `nominateFuturity` locks `futurity_state` before the
racer to match resolve. **LOW-MED — the racer-legend Sybil floor**: `matchRace` bumped the owner LEGEND
(`racer_wins`, the survives-death leaderboard) on every PvP win with no loser level floor →
`STABLE.LEGEND_MIN_LVL` (10, the `RACES.WHEEL_MIN_LVL`/npcHit-rookie-floor precedent; regression: a
maxed dog beating a lvl-9 runt banks no legend). **LOW** — deleted the dead `wipeRacersAtDeath` (racers
already in the runEstate wipe). Verified CLEAN: §10.4 across every racing/world reason (the scratch
refund reconciles, escrow identities hold, sim drift-0), the Futurity/Uprising worker settles
(single-writer, idempotent, NULL-char death rows), the two-party lock order (acyclic after the MED fix),
and death/estate survival of the account-level legends + frozen-field snapshots. Flagged (NOT patched):
the cosmetic LOWs (raceChallenge ternary, berth INT-arith — proven working, RPC-less assertChainId
warning, claimPendingWire heir), the racing faucet magnitudes (BALANCE.md sign-off levers at parity), and
the carried/accepted items (market bidListing AB-BA, VoucherClaim.sweep, Commission seasonal standing,
dividend-pool allocation). `forge test` STILL not run (Foundry egress-blocked). Suite 33/33 + sim drift-0.

**THE WIRE — step five: THE TIERED SUBSCRIPTION LADDER + THE STANDING WATCH — BUILT** (`src/wire.js`,
`src/rules.js` `WIRE.SUB_TIERS`, `schema.sql`, `src/worker.js`, `test/wire.js`; the deferred step-five
items — automation + a subscription ladder for the flat pull-only terminal). All $OMR sinks through the
EXISTING `intel:` vocabulary, so **ZERO invariant changes**. **(1) THE TIERED LADDER** — the flat Street
Wire becomes `WIRE.SUB_TIERS` (Street Wire 12 → The Wire Room 30 → The Switchboard 60 $OMR/7d); a higher
tier is a bigger `intel:wire` burn and unlocks the WAR ROOM (tier 2+) + STANDING-WATCH slots (0/2/5).
`subscribeWire(ch, tier)` sets `characters.wire_tier` (a new col, written by DIRECT SQL — the
`disinfo_until` pattern, off the persist positional UPDATE) + extends `wire_until` from later-of-now/end;
`wireTierOf`/`wireSubTier` helpers; the board surfaces `subTier`/`subTiers`/`watchSlots`, and the war room
now gates on `tierCfg.warRoom`. **(2) THE STANDING WATCH** (the auto-tap automation) — `enrollWatch`
(`POST /v1/wire/watch/:targetId`) places the tap NOW (the normal `intel:wiretap` sink) and records a
`wire_watches (watcher,target)` enrollment; the worker `sweepStandingWatches` (wired in worker.js)
AUTO-RENEWS an enrolled mark's lapsing tap by burning the rank-discounted tap cost from the watcher's
$OMR (`intel:watch` — a burn under the existing `intel:` term, ZERO new bucket/faucet), **bounded by
balance + the sub tier's watchSlots** (oldest enrollments first, so dropping to a lower tier renews
fewer) — so surveillance runs while you're OFFLINE without manual re-tapping. Renews only within 30min of
lapse (a comfortably-live tap isn't re-burned) and does NOT reset the watchdog alert flags (no re-alert
spam). Broke → the watch PAUSES (the tap lapses; a re-fund/re-sub resumes); `cancelWatch`
(`DELETE /v1/wire/watch/:targetId`) drops it. Gates: `self`/`no_sub`/`tier` (tier 1 runs no watches)/
`watch_full`. §10.4: `intel:watch` is a $OMR BURN under the existing `intel:%` KNOWN_REASONS + `omrBurns`
term — the test proves the ONLY $OMR drift is the SQL grant (every wire spend, incl. the worker's
auto-renew, reconciles as an `intel:*` burn). **Lock order** (worker): `account_persistent[watcher] FOR
UPDATE` (serializes vs withCharacter/persistAccount so the omr decrement can't be clobbered) → the leaf
tap row (no character rows locked → no cycle). `wire_watches` dies with either party (the wiretap
precedent in runEstate). Console: the Wire tab's Street Wire card became a tier-picker (subscribe at a
tier) + a Standing Watches section (enroll/drop, live/lapsed chips); `/v1/rules` gained
`wire.subTiers`; `describe()` humanizes the tier + the standing watch. `test/wire.js` covers the tiered
ladder (tier set + surfaced + catalog), the standing watch (enroll places the tap + records it, the
self/no_sub/tier/watch_full gates, the worker renewing ONLY a near-lapse tap as a ledgered `intel:watch`
burn while a live tap isn't re-burned, a broke watcher pausing, and cancel), and §10.4. Suite 33/33 + sim
drift-0. All `WIRE.SUB_TIERS`/watch numbers are founder sign-off levers (status/access/pacing — no faucet).
The Wire pillar is now feature-complete (tap/sweep/subscribe → trace/dossier/spymaster → disinfo/informant
→ tradecraft/watchdog → the tiered ladder + the standing watch).

**THE PORT — step five: the Coast Guard feeds the LAW meter + warehoused contraband is a LOOT surface —
BUILT** (`src/port.js`, `src/rules.js` `PORT.STEP5`, `src/social.js`, `test/port.js`, `test/social.js`;
the deferred step-five items). **(1) THE COAST GUARD BUILDS A FEDERAL CASE** — a Port interdiction (bust)
now also adds `PORT.STEP5.BUST_EXPOSURE` (25) to the RICO investigation meter (`heat_exposure`), not just
the volatile `heat` number — so repeat smuggling draws the Bureau, tying the Port's PvE antagonist into
the Law/RICO system. `ch.heat_exposure` is bumped in memory (persisted positionally by persistCharacter,
param $47 — the existing `ch.heat` bust bump precedent; no direct SQL). A NEW Law lever (off the signed
heat curve), founder sign-off. **(2) WAREHOUSED CONTRABAND IS LOOTABLE** (the P1.1 loot-surface twin) — a
player FIRE-kill now loots `PORT.STEP5.CONTRA_LOOT_RATE` (0.5) of the victim's warehoused `contraband`
(the step-four commodity awaiting fence) to the killer's warehouse. A **pure ownership move** — contraband
is a cash-book-value COMMODITY, NOT a §10.4 currency (the gear-loot precedent: `UPDATE … contraband -/+`,
no ledger row, §10.4-untouched), bounded by what was legitimately sourced under the supply cap; the
remainder dies with the victim. So warehousing to fence-high is now a RISK for a marked man (fence promptly
or hold and gamble). Placed in `fire`'s loot block right after the gear loot (absolute NUMERIC reads,
arith-safe); the killer's contraband is direct-SQL (outside the persist positional UPDATE — clobber-safe,
the step-four discipline); `contraLoot` on the kill response. §10.4: **ZERO change** — the bust
`heat_exposure` bump moves no value; the contraband loot is a non-currency ownership transfer (the sim +
per-character cash check stay drift-0). Console: the kill toast reports the seized contraband; the Port
warehouse card warns "at risk — a killer loots half your stash". `test/port.js` proves the bust feeds the
Law meter (`heat_exposure += BUST_EXPOSURE`); `test/social.js` proves a fire-kill seizes half the victim's
warehoused contraband to the killer (a pure ownership move, no ledger, the victim loses exactly the looted
share). Suite 33/33 + sim drift-0. `BUST_EXPOSURE`/`CONTRA_LOOT_RATE` are founder sign-off levers (the loot
is a bounded transfer of already-capped commodity, the P1.1 argument — flagged in BALANCE.md). The Port
pillar is now feature-complete (buy/run/collect → upgrades/piracy/rendezvous → legend/harbormaster →
warehouse/berths → the Coast-Guard Law tie-in + the contraband loot surface).

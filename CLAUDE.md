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
reconciling `casino:fix`. All step-two numbers are founder sign-off levers.

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
founder sign-off levers — sim before production. Step two (deferred): ACTIVE abilities with
cooldowns, tier-4 capstones, prestige-carried skill slots (a founder call — it would soften
death), per-skill respec. Suite 15/15 + sim drift-0.

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
Suite 23/23 + sim drift-0. All numbers sign-off levers. **NEXT (needs founder call — spec'd in the
design doc):** THE WIRE (the surveillance + premium-feed intelligence terminal), and the ETH-revenue
packages (Season Pass / Vanity Store / Premium Wire sub / revive bundles / Made-Man tiers / named
landmarks) with a configurable Founder/Buyback/RWA-reserve split — all off-chain-first / chain-dormant,
mainnet gated on legal + audit.

## Sensitive design notes
- **Utility-only is being retired** by the founder's Risk-to-Earn pivot (above). $OMR is becoming a
  losable/extractable asset (Phase 1 makes it lootable; Phase 2 makes it a real living). Still do NOT
  add explicit price-appreciation *marketing/messaging* — that stays out for legal reasons until
  counsel signs off on Phase 2. The mechanics change; the promises don't.
- Social/onboarding rewards pay in-game cash only, never $OMR (v24 rule) — unchanged.
- Agent-flagged accounts: excluded from referral payouts, harder rate limits, public badge.

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
Step three (deferred): rotating lead tasks, more rivalry pairs, grudge memory.

## Sensitive design notes
- **Utility-only is being retired** by the founder's Risk-to-Earn pivot (above). $OMR is becoming a
  losable/extractable asset (Phase 1 makes it lootable; Phase 2 makes it a real living). Still do NOT
  add explicit price-appreciation *marketing/messaging* — that stays out for legal reasons until
  counsel signs off on Phase 2. The mechanics change; the promises don't.
- Social/onboarding rewards pay in-game cash only, never $OMR (v24 rule) — unchanged.
- Agent-flagged accounts: excluded from referral payouts, harder rate limits, public badge.

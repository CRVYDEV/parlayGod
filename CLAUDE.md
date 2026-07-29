# CLAUDE.md — project context for Claude Code sessions

You are building the production backend for OMERTÀ, a multiplayer noir mafia RPG that settles on an EVM
chain (Robinhood Chain, an Arbitrum Orbit L2 — M6 moved off Solana; see `omerta-chain-migration-evm.md`).
The founder (Jorge) is non-technical: explain decisions plainly, and never assume he can debug — tests
must prove things work.

**How to read this file.** The ground rules below are binding and short. Everything after "Where things
stand" is a CHRONOLOGICAL LOG of every drop, in build order — it is history, not a spec, and later
entries supersede earlier ones. Its job is precedent lookup: ~414 comments in `src/` cite a pattern by
name ("the fade pattern", "the refundPot discipline", "the casino:pvp transfer"), and this log is where
those names are defined. Read it that way — search it for the precedent you need, don't read it front to
back. For current architecture, the invariants, and the open technical-debt register, read `SPEC.md`
(~450 lines); for the balance levers, `BALANCE.md` and `SIGN-OFF.md`; for the audit trail,
`docs/AUDITS.md`, which indexes all 57 reports and states that they are point-in-time.

## Ground rules
1. **`omerta-backend-spec.md` is the contract.** Every formula, table, and timer is specified there with production values. Do not invent mechanics or "improve" balance — the numbers were sim-audited.
2. **The rules live in two files and the seam is enforced, not remembered.**
   `src/rules.generated.js` is MACHINE-OWNED — only the prototype's 22 data tables, overwritten
   wholesale by `node tools/extract-rules.js <prototype>.jsx`. `src/rules.tail.js` is HAND-WRITTEN —
   every helper, catalog, ladder and founder-signed lever — and the extractor never opens it.
   `src/rules.js` re-exports both, so every import site is unchanged. To change a TABLE, edit the
   PROTOTYPE and re-extract (the car-catalog precedent); to change anything else, edit the tail.
   `test/rules.js` fails if hand-written code appears in the generated half, if it grows an import,
   if the extractor addresses any other file, or if both halves export the same name.
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
INT columns mis-evaluate — use absolute writes computed in JS (the setCargo DELETE+INSERT
precedent).** *(MEASURED PRECISELY by AUDIT-full-sweep 2026-07-27 — the original wording here said
"`SET qty = qty - $n` mis-evaluates to `0 − n`", which is wrong in both directions. The quirk is
narrow: **INT column, SUBTRACTION, bound PARAMETER**, and the result is SIGN-FLIPPED (`100−5` → `−95`),
not `0−n`. `col = col + $1` is FINE, literals are FINE, NUMERIC and BIGINT are FINE. The genuinely
dangerous form the old note failed to warn about: `GREATEST(0, col - $1)` silently returns **0** —
it reads exactly like a clamp working. Swept: zero affected sites in the tree.)* Numbers are sign-off levers.
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
**THE WALLET PICKER — hardened + widened (2026-07-26).** Coinbase, Trust, Rabby, Phantom, Crypto.com, Rainbow,
OKX, Zerion and Robinhood Wallet all speak EIP-6963, so they were ALREADY supported — the discovery layer covers
wallets that don't exist yet, and hardcoding a vendor list would have been a REGRESSION from that. What was
actually missing, all fixed: **(1)** a WalletConnect session proposal REQUIRED the OMERTÀ chain, which is a veto —
a phone wallet that has never heard of an Orbit L2 rejects the whole session, and linking only ever needs a
SIGNATURE — so every chain is now `optionalChains` (dormant today with `CHAIN_ID` unset, but it would have broken
exactly the mobile wallets on mainnet); **(2)** no wallet detected was a dead-end toast ("install MetaMask") — the
picker now opens in a "here's where to get one" mode listing `KNOWN_WALLETS` install links (the catalog is ONLY
for hints — matched loosely by rdns OR name so a wrong rdns still suppresses its own hint; nothing needs an entry
to work); **(3)** a **real bug**: callers `await pickProvider()` OUTSIDE their try, and the single-option shortcut
auto-fired WalletConnect, so a failed connect (blocked CDN, closed QR) escaped as an unhandled rejection and the
button looked simply DEAD. Now WC alone still shows the picker (a QR on a tap deserves consent), and every failure
path routes through `walletFailed()` → a toast. Also: `eip6963:requestProvider` is re-dispatched when the picker
opens (extensions that inject after our script), and an in-app wallet browser's bare `window.ethereum` is used
directly. Verified in Chromium against real Postgres across five scenarios — nothing detected, two wallets, in-app
`window.ethereum`, WC-only, and a **full SIWE happy path** (real viem signature through the picker's SECOND wallet
→ server-verified → linked, correct address, zero page errors) — plus both failure paths toasting with zero
unhandled errors. Desktop needs no config; **mobile is dormant until `WALLETCONNECT_PROJECT_ID` is set** (a free
public id from dashboard.reown.com — documented in `render.yaml` / `.env.example` / `CHAIN-DEPLOY.md`).

**THE MOBILE PASS — driven and looked at (2026-07-26).** Prior mobile work was a CSS breakpoint pass; this
one drove a real phone viewport in Chromium across all 33 screens, measured each (horizontal overflow,
tap-target height, text size) and READ the screenshots. The measurement alone would not have found the
headline defect, and the screenshots alone would not have found the overflow — both were needed.
**The headline: on a 375×667 phone a brand-new player's "Start Here" screen showed NONE of its own
content above the fold** — ~370px of top chrome (masthead, five buttons, a full-width language select,
the identity line), then the character sheet, the claim card and a raw-JSON debug viewer. The guided
checklist that exists to tell a new player what to do was entirely below the fold with no cue it was
there. Cause: `#layout` is a 3-column grid whose LEFT column (the ~1000px sheet) stacks ABOVE the tab
content on a phone. Fixed by **ordering the tab panel first on mobile** (`#tabpanel{order:-1}`), hoisting
the coach out of the sheet into a full-width `#coachwrap` banner (better on desktop too), and adding a
phone-only sticky **`#vitals` strip** (cash/health/energy/nerve/heat) so moving the sheet down costs no
at-a-glance numbers. Top chrome trimmed to one compact row. Also fixed: **two horizontal-overflow bugs** —
the Collection's `◇◇◇` tracker (+187px; the spans were `.join('')`, giving the layout engine NO legal
break point in the run — fixed at the source with a U+200B joiner, not a CSS hack) and a Big Scores
`<select>` sized to its longest option (+259px → `select,input,textarea{max-width:100%}`); section
headings squeezed to a few characters by their own "— what this is" note (`h2{flex-wrap:wrap}`); and the
32px group rail (the primary phone navigation) raised to 40px. **A regression I introduced and the
screenshot caught:** `overflow-wrap:anywhere` also shrinks min-content, which collapsed a flex heading to
ONE LETTER PER LINE — `break-word` breaks long runs without that side effect, and the real fix was the
zero-width joiner. Verified after: **0 horizontal overflow across 33 screens at 375×667 and 360×780, zero
page errors**, desktop unchanged (3 columns, vitals correctly absent, coach present).
**Made permanent — `tools/mobile.js` (`npm run mobile`, the SIXTH harness, wired into CI's pg-mem job).**
Boots the real server on pg-mem, drives real Chromium at 375×667 and 360×780 through every screen (54
checks) and fails the build on exactly the classes that shipped undetected: **(A)** any screen that
scrolls sideways (naming the offending elements), **(B)** a picked screen whose own content starts below
the fold — the headline defect stated as an assertion, **(C)** a PRIMARY nav target (group rail / tabs /
thumb bar only — deliberately not every button, or the guard nags and gets deleted, the `test/docs.js`
argument) under 36px, **(D)** any page error. **Mutation-verified against all three fixes**: revert the
phone tab order → 45 failures naming each screen and its fold offset; revert the ◇ joiner → the estate
overflow; revert the 40px rail → 48 nav-target failures. The first mutation attempt was WRONG and passed
(removing `#tabpanel{order:-1}` still leaves `#leftcol{order:1}`, and a default order of 0 sorts first) —
worth remembering, since a bad mutation reads exactly like a vacuous check. Dependency is
`playwright-core` (downloads NO browser on install); the browser is resolved from `CHROMIUM_PATH` → a
Playwright cache glob → system paths, and with none the harness **fails loudly and exits non-zero rather
than skipping** — a layout guard that quietly does nothing still goes green. Honest scope, stated in the
file: layout only. Whether a screen reads WELL still needs a person opening it.
**THE CLIENT'S WIRING — `test/client.js` (the 53rd suite) — and FOUR dead buttons it found on its first
run.** The mobile harness proves screens LAY OUT; nothing proved the buttons WORK. This checks the two
ways a control dies silently, both of which had shipped: **(1) the route does not exist** — every
`METHOD /v1/...` the console can issue (`data-do`, `api()`/`act()` calls, the raw deck's tuples; 481 of
them) must resolve to a really-mounted route, matched SEGMENT-WISE against fastify's own registry so
`/v1/streets/:id/jump` cannot match `/v1/streets/roster`; **(2) the value is not real** — every
catalog-backed literal the client hardcodes (`approach`/`intent`/`play`/`path`/`tier`/`role`/`job`/
`drugId`/`goodId`/`to`/`direction`) must be an id the server recognises, which is the `{path:'earner'}`
and npchit-`tier:'local'` class. **Found + fixed, all live in production:** `POST /v1/diplomacy/pact/:id/break`
(the server mounts `DELETE …/pact/:gangId`), `POST /v1/diplomacy/coalition/:id/leave` (`DELETE …/coalition/:id`),
`POST /v1/sov/:district/upkeep` (upkeep is family-wide: `POST /v1/sov/upkeep`), and the Speakeasy tab's
`POST /v1/travel {district}` (the district rides the PATH). Each was verified to point at the RIGHT
handler (`breakPact`/`leaveCoalition`/`paySovUpkeep`), not merely an existing one — the test explicitly
does not check that. Deliberately STATIC (no side effects, no flake): firing every control at a live
server cannot tell "the client sent nonsense" from "you can't afford it", and a check that can't tell
those apart reports noise until someone deletes it. Three extraction traps, each of which had produced a
false alarm before being handled: a template literal with quotes inside `${}` truncates under a naive
regex (so paths are read by a balanced-brace scan), `'/v1/phone/dm/' + id` concatenation reads as the
parent route (a trailing `/` becomes `:p`), and a runtime-chosen ACTION segment (`/v1/garage/${id}/${act}`)
is unverifiable — those are counted and REPORTED (5 of 481), never silently passed. Mutation-verified on
both checks. The catalog reader handles arrays-of-`{id}` AND id-keyed objects and asserts the result is
non-trivial, because `Object.keys()` on an array yields `0,1,2` and would have made every value look bogus.
**Step two — the THIRD way a button dies, and `/admin`.** The first cut could not see a field the handler
never READS (`{price:50}` when it reads `req.body?.unitPrice` — route exists, value is sane, server gets
undefined every call). Now each route registration's source is sliced out and scanned for this codebase's
actual read shapes (`req.body?.x`, `req.body.x`, destructuring), and every client body field is checked
against ITS OWN route — not a global pool, since `qty` being read *somewhere* says nothing about whether
THIS handler reads it. Routes handed the whole `req.body` to a module (5) are unresolvable here and are
COUNTED, never silently passed. **`/admin` is now covered too** (its own `j(method,path)` helper) — the
dashboard is what the founder holds during an incident, so a dead button there surfaces at the worst
moment; all 15 of its calls check out. **Found + fixed:** `POST /v1/exchange/list` sent `price` where the
handler reads `unitPrice` (a genuinely broken action), and four bodies advertised fields the handler
ignores — `unstake {amount:1}` the worst of them, since unstake takes no amount and returns the WHOLE
position, so the deck read as "unstake 1". Both new checks mutation-verified (re-introduce the
price/unitPrice mismatch → caught; point an /admin button at `/v1/mod/banish` → caught). 496 routes,
50 bodies, suite 53 green.

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
tax map (in-game takes → street-tax buyback; Store 40/40/20; bonds POL/Dev/Vig; the toll) is §8 of
the value-creation design doc. **BONDS now carry a DEV CUT (founder-directed):** the ETH split is
three-way — `BONDS.POL_BPS` 5000 / `DEV_BPS` 2000 / `VIG_BPS` 3000 (sum-validated at load) — in BOTH
layers: `OmertaBond.sol` gained an immutable `devBps` + `devRecipient` (forwarded in-tx, remainder math
→ zero dust; `Bonded` event now emits `toPol, toDev, toVig`; `setRecipients` is three-way; compiles
clean 0.8.26, 0 warnings — `forge test` still the pre-mainnet gate) and `recordBond` books `devEth`
(new `bond_reserve.dev_eth` accumulator, surfaced on the board/status; the event-authoritative on-chain
path passes `onchainDev`; the watcher ABI updated). `runBondInvariants` check (4) is now
POL + Dev + Vig == principal. tests: bonds (50/20/30 exact, comps book zero dev) + watcher (toDev lands).
**THE EARLY-EXIT SURCHARGE (anti-dump, founder-directed):** $OMR younger than \`FRESH_WINDOW_MS\` (48h)
pays an extra toll at BOTH exits — the AMM sell (\`economy.js:swap\` sell: the pool receives amt −
surcharge) and the withdrawal (joins the flat toll) — \`EARLY_SELL_TAX_BPS\` (5000 = 50%) at age 0,
LINEAR to 0 at 48h, NO exemptions, split 50/50 dev_fund/stake_pool on the same tax:dev/tax:buyback
rail (zero invariant change). \`src/tax.js:earlySurcharge\` prices age by an EXACT FIFO REPLAY of the
account's omr ledger window (credits append lots, debits consume oldest-first, opening balance = an
aged lot) — the ledger IS the lot table: no new schema, unfakeable, and an SQL-granted balance reads
as aged (why legacy tests never feel it). Differences of 6-dp amounts ROUND (never floor — a floored
crumb leaks conservation). Accepted seam (doc'd): stake→unstake is bucket-internal (no rows) → re-
enters aged; throttled by the 6h loot-exposed unbond (dial: UNSTAKE_CD_MS / ledger the release). An
on-chain wallet version was REJECTED (wallet-hop dodge / fee-on-transfer breaks DEXes). Tests: chain
(clean account: ~50% at age 0, ~25% at 24h — chronology-real FIFO; conservation unmoved), emission
(fresh wage sold on the AMM pays ~50%, split lands both buckets, conservation exact); legacy suites
pin the rate 0 (chain/economy). Suite 35/35 + sim drift-0 (surcharge live at default).
**THE ON-CHAIN DEX SELL TAX (founder-directed):** \`OMR.sol\` is no longer fully inert — it gained an
owner-armed FLAT sell tax on transfers INTO registered \`ammPairs\` (a sell / non-exempt LP add),
split 50/50 dev/buyback wallets IN-TRANSFER; buys, wallet→wallet, and every protocol flow stay 1:1.
Guardrails: \`MAX_SELL_TAX_BPS\` 1000 (10%) compile-time hard cap, default 0 until armed, registered-
pools-only, exempt list, everything evented, Ownable(Safe) (renounce = freeze forever). AGE-BASED
rates are IMPOSSIBLE at the ERC-20 level (routers hide the seller → the token only sees router→pool),
so the 48h decay stays at the game boundary — the layers stack. HARD deploy requirement (CHAIN-
DEPLOY.md): canonical liquidity must be Uniswap V2-COMPATIBLE (V3 rejects fee-on-transfer; swaps use
the *SupportingFeeOnTransferTokens router path) — verify Robinhood Chain's DEX before seeding.
Constructor signature unchanged (\`OMR(treasurySafe)\`, now Ownable(treasurySafe)). Foundry tests:
\`test/OMRTax.t.sol\` (off-by-default, taxed split exact, buy/wallet/unregistered clean, exempt,
hard cap + recipients-required, onlyOwner, a conservation fuzz — redirected never minted). Compiles
clean (solc 0.8.26, 0 warnings); \`forge test\` remains the pre-mainnet gate.

**VALUE-CREATION RED-TEAM (`AUDIT-value-creation.md`, 2026-07-23)** — a max-effort four-lens pass
(§10.4/emission, concurrency/locks, exploit/economic, Solidity) over the five pivot drops (Street
Wage, Exit Toll, Early-Exit Surcharge, bond dev cut, OMR sell tax), every finding re-verified vs
source. **No CRITICAL/HIGH, no §10.4 drift, no conservation leak; both contracts CLEAN** (every
`_update` edge, exact conservation incl. odd-wei dust, no reentrancy surface, anti-rug guardrails
enforced in code; OmertaBond's three-way split exact with event↔watcher↔bonds.js parity
byte-for-byte, tranche/EIP-712/daily-cap walls intact). Fixed in-commit (regression added): **F1
(MED)** — a mid-epoch worker crash re-granted the FULL per-epoch wage budget to the unpaid
remainder (the in-memory share pre-compute doesn't survive a restart; endowment-bounded but a
silent breach of the signed halving schedule, invisible to the endowment invariant) →
`emittedThisEpoch` (the epoch window's ledgered `emission:wage` sum — the ledger is the resume
state) now caps `payable = min(budget − consumed, room)`, so a resume TOPS UP toward the budget;
the same guard closes the dormant concurrent-run seam. Exit toll / surcharge / dev claim / bond
split all verified conservation-exact to 6-dp; the surcharge replay is race-free (runs under the
caller's held account lock). Flagged for founder sign-off (NOT patched, ground rule #1 — recorded
in BALANCE.md as coupled rows D1/D2): **D1** the wage's Sybil gate — the agent flag is voluntary
and guest alts clear the floors for ~a minute of automation each, so ~100 alts capture the whole
daily budget (dials: INVITE_MODE=on, gate the wage on a linked+MINTED wallet, floors, diminishing
shares — THE launch-gating decision); **D2** the surcharge's FIFO drains AGED lots first, so a
patient extractor's daily exit is surcharge-free after a 48h ramp (as built it's anti-INSTANT-dump
only; the fresh-end pricing flip is one ordering change if "every fresh token pays once" is the
intent). The doc's stake→unstake wash seam RE-MEASURED as a non-dodge (fresh tokens washed through
staking still price fresh) — design doc corrected. Suite 35/35 + sim drift-0.
**D1 + D2 APPLIED (founder-directed same day, regression each; suite + sim green):** **D1** — the
wage pays only **MINTED** accounts (`rules.js:wageRequireMinted()`, env `WAGE_REQUIRE_MINTED`
default on; the scoring filter in `runWageEpoch` + `mintedRequired`/`minted`/`eligible` on the
board, `/v1/rules.emission`, and the console wage card) — every wage-drawing identity costs the
0.01-ETH mint fee (or its PLEX price in earned $OMR), so a Sybil farm pays the house per alt;
free-trial players still play and earn everything else (minting was already the extraction gate).
**D2** — `tax.js:earlySurcharge` now consumes NEWEST-first in BOTH the historical-debit replay and
the exit pricing (was oldest-first), so an aged buffer can no longer absorb a fresh dump: every
fresh token pays on its first exit at its own age's rate, exactly once (a taxed exit is itself
consumed newest-first in later replays, so the aged remainder then exits free); the only free exit
is genuinely holding a token 48h. In-game spends consuming fresh first is deliberate (spending
fresh IN the economy is deflationary and earns a cheaper aged exit). Codices + design doc updated.

**`forge test` — THE GATE IS GREEN (first execution ever, 2026-07-23): 73/73 PASS** incl. both
512-run fuzzes (OMR sell-tax conservation, OmertaBond anti-Ponzi). The egress wall fell to the
official npm distribution of forge (`@foundry-rs/forge` 1.7.1) + npm forge-std/OZ + a solc-js
0.8.26 stdio shim (same compiler version+commit as native; forge talks --standard-json with all
sources inlined, so the shim needs no fs; output must be fs.writeSync — async pipe writes truncate
at 64 KiB). Reproducible: `omerta-contracts/run-forge-test-sandboxed.sh`. The first run failed 14
OmertaBond tests + exposed one silently false-passing fuzz — ONE latent test-harness class, not a
contract bug: an inline `_sign(q, pk)` argument makes a `bond.hashQuote()` STATICCALL that consumes
the pending `vm.prank`/`vm.expectRevert`, so bond() ran as the test contract (`NotPayer`) and
expected reverts landed on the innocent view call. Fixed by hoisting `bytes memory sig = _sign(…)`
above the cheatcodes at every site (the pattern the passing tests already used); the fuzz now
genuinely exercises `bond()`. Contracts themselves needed ZERO changes — consistent with the lens-D
audit. Residual for mainnet: the third-party audit re-runs with NATIVE solc (CHAIN-DEPLOY.md gate 1
updated; gates 2 legal + 3 audit stand).

**THE OVERNIGHT UX DROP (founder's 11-item list, 2026-07-23 night)** — all eleven built, a commit
per item, suite green + sim drift-0 throughout, each client change browser-verified. **(1) Live
Feed humanized** — feedText() renders one sentence per event (never raw JSON; the WS hello is a
quiet status line), color-coded by category (combat red / law blue / den purple / racing yellow /
market green / family gold / world cyan). **(2) THE ACTION WIRE** — a new 'activity' bus channel
broadcasts an ALLOWLISTED set of public-safe acts via an onResponse hook (+60s actor-name cache);
deliberately an allowlist so covert acts (searches, taps, bank moves, kitchen deals, port runs,
laundering) never leak — the audited info economy stands; no amounts. **(3) THE TROLL BOX** —
public city chat + a family-only room (chat_messages table, name snapshots, 7-day retention,
cleanText + 240 clamp + 2s flood brake, gang-channel WS fanout, member-gated reads; zero §10.4).
**(4) PRESENCE** — keyless GET /v1/online (live sockets + active15m, cached) → the "N in the city"
badge. **(5) LIVE COOLDOWNS** — mins() now emits a ticking [data-until] span (1s global ticker);
minsTxt for plain-text contexts. **(6) THE 4-HOUR STAND** — Spread-the-Word pays in two phases:
register (posted_at/paid/proof on social_claims) → pay only after SOCIAL_MATURE_MS (4h; env test
knob) with live-mode re-verification that the post still stands (verify.js verifyPostUp; deleted →
post_gone); 48h pending TTL; board states todo/pending/ready/claimed. **(7) ONE-CLICK X SIGN-IN**
— OAuth2 PKCE with SERVER-SIDE code exchange (the E-H1 real path): POST /v1/auth/x/start mints a
single-use state (oauth_states, 15-min TTL, worker-swept; an authed start binds the guest for a
claim-in-place upgrade — the bearer never rides a URL), GET /v1/auth/x/callback exchanges + reads
/2/users/me, results ride the URL FRAGMENT; DORMANT unless X_CLIENT_ID + PUBLIC_URL (register the
callback as PUBLIC_URL + /v1/auth/x/callback); rules.auth.xOAuth gates the console buttons; token
pasting collapsed to an advanced fallback. **(8) THE CITY clarified** — a what-this-is lead card,
plain-language law/patrol lines, the weather table upgraded to TRADE WINDS (the shock multipliers
become "cheapest in X, richest in Y — a ~N% spread" + cheap/fair/rich labels), a human forecast,
the cartel loop stated in one line. **(9) PROGRESSIVE DISCLOSURE** — a fresh player sees FIVE
screens (start/streets/garage/city/family) + a "+ the whole city…" expander; level 8 or any
deliberate jump to a hidden screen opens everything (sticky); veterans untouched. **(10) THE
TYPE-SCALE LIFT** — one single-pass map bumped all 173 declared px font sizes a step (root 15→16)
with no double-bumping, plus a larger masthead, 31px money figure, roomier panels/cards/grids,
line-height 1.5. **(11) LANGUAGE PACKS** — an I18N layer with 15 packs (en es pt fr de ru ar hi id
vi tl tr zh ja ko), browser-locale auto-detect + a sticky 🌐 picker (top bar + landing), T(key)
with English fallback, Arabic flips RTL; coverage = the chrome (all tab/group labels, the sheet,
the street panel, core buttons, entry CTAs) with noir-correct local flavor (Мокрые дела, El
Usurero, 闇金, Ang 5-6…); game PROSE stays English — each further surface is a pure dictionary
add. Client-patch lesson recorded: String.replace substitution patterns ($$→$) corrupted a
first pass — patchers must use replacement FUNCTIONS. Deferred (flagged): activity/chat i18n,
translating game prose + describe(), the /wiki codex translation, a Privy one-click embed.

**THE ART PASS — 42 generated plates, and the landing/console rebuilt around them (2026-07-28).**
The game had no art. `tools/art.js` now generates every image it needs from one manifest against
fal.ai's Flux endpoints — 42 plates for **$2.08** — with the model, seed, aspect, the *job the image
has to do*, the exact prompt and the running spend recorded per-image in `public/art/manifest.json`,
so any plate can be explained or reproduced. Spend is bounded by a hard `ART_CAP_USD`. Served by a new
**`GET /art/:file`**: the directory is read into an ALLOWLIST at boot and a request is only ever a Map
lookup, so there is **no path-traversal surface by construction** (`/art/../../etc/passwd` is a key
that is not in the Map, not a path that gets sanitised).

**Where it went.** The landing hero, a full-bleed mid-page break, the six feature pills, the four
broadcast-card backgrounds (embedded as data URIs by `src/cards.js` — these are what unfurl on X), and
— the largest win — **a header plate on every one of the 24 console screens** (`TAB_ART` +
`#tabart`), each carrying that system's own art *and its name*. Until now the only thing telling you
which of twenty-four screens you were on was which rail button happened to be lit.

**Five things this pass got wrong first, all caught by looking at the output rather than the code:**
**(1)** the art 404'd — there was no static route at all, and the "hero is mispositioned" diagnosis
that preceded it was confidently wrong. **(2)** The pills stacked the photo TWICE at full opacity: an
inline `style="background-image:url(…)"` beats the stylesheet's `background:` shorthand for the
background-image longhand, so the card's own background became the photo and `::before{opacity:.22}`
laid a second copy on top — three of six cards were genuinely unreadable, worse than no art. The url
now rides a `--art` custom property that only `::before` reads. **(3)** A 108px band on a 16:9 source
is a horizontal STRIPE, not a scene (the courtroom rendered as a row of window tops); 150px fixed it.
**(4)** The hero image generated *for* the hero job lost it on the merits to one generated for drama —
`hero-backdrop` has letterbox bars baked in and is too dark and too blue to read against a near-black
page. **(5)** Five generations were rejected on review and re-rolled: a "1940s telephone exchange with
patch panels and indicator lamps" came back a **modern server room**, and "one hard lamp" on a table
came back a mid-century designer lamp shot like product photography. Prompt review does not catch
these; a contact sheet does.

**Two test assertions broke, and both were false positives worth understanding.** Cards now embed a
~260KB base64 plate, and *every one of the four payloads contains the literal three characters "NaN"*
— so `assert(!/undefined|NaN/.test(body))` failed on random binary rather than on anything rendered.
It now scans the markup with data URIs stripped. Separately, `assert(body.length < 4000)` was a PROXY
for "the oversized `?ref` was clamped" that only worked while a card was ~2KB of markup; it now
measures the actual claim as a DELTA against a normal ref (clamped ⇒ grows ~48 bytes, unclamped ⇒
~5000). Both repaired assertions were mutation-verified — and the first mutation attempt was VACUOUS
(`sed` silently failed on a `||` inside a `|`-delimited expression and I read the resulting pass as a
result), which is the same trap `tools/mobile.js` and `tools/scale.js` each sprang. Suite green, sim
drift-0. Art direction, the prompts, and what went wrong in the real runs: `docs/ART.md`.

**GAME FEEL — haptics, cutscenes, and the confirmations that were missing (2026-07-28).** Five parallel
audits over all 24 screens, then a build pass. The single highest-leverage finding appeared in two of them
independently: **`body[data-group]` sets an `--accent` per group and not one screen inside a tab read it** —
every heading, chip and gauge hardcoded amber, so the whole group colour system was a 1px detail on the rail.
It now carries into headings, gauges and card hover. Alongside it, one **real CSS bug**: `.row` was defined
only as `#sheet .row`, and seven renderers use it — outside the sheet it had no flex and no
justify-content, so the Street Races Circuit, Garage and Strip collapsed into run-on text.

**The engagement layer** (`shake`/`flash`/`floatVal`/`cine`): a short vocabulary of physical feedback so a
result *lands* instead of appearing. A cinematic title card fires for the handful of moments worth stopping
for — a kill, an indictment, going over the wall, a payday over $25k, the first week — read off the SAME
response body `describe()` reads, so it needs no new server surface. Everything is a no-op under
`prefers-reduced-motion`, which means off, not shortened. Deliberately rare: fire it on every crime and
players learn to look away from the one tool you had for the moments that matter. Levelling up now gets the
beat the money tick has had since M1, and the sheet leads with a **respect bar against the real next-level
threshold** (`rules.pacing.levelDivisor` is published, so the client can show the distance rather than a
number with no scale) instead of a parenthetical next to four gauges for things that refill by themselves.

**The dialogs.** Eleven `alert()`s, one `prompt()` and six `confirm()`s rendered in the OS font on a white
slab — the loudest thing on a 1940s ledger. Replaced with `sheetModal` / `ask` / `askNum` in the game's own
type; leaderboards became ranked rows and the Wire's dossier became a case file. More importantly, **six
irreversible actions had no confirmation at all** — FIRE (ends a street for good and swears a vendetta), the
shank (permadeath from a cell), the loan collect (hospitalize + seize the car + brand them WANTED), demand
trial, flip (a permanent RAT brand), and expose. `data-do` buttons carry a `data-confirm` so the guard lives
in one place rather than being hand-wired per site.

**Threat visibility, which was inverted on three screens:** a $500k kill order on your own head rendered
identically to a stranger's $5k job (now a breathing card above the board); the extortion demand with a
countdown on your money was the *tenth* section of the Wire; WANTED — NPC hunters rolling for your life
every worker tick — was the last line of the Shylock. The RICO meter was byte-identical to the energy bar
and now carries the three thresholds as marks on the track. The Pen roster showed none of the state that
decides whether a shank is even legal, so most attempts failed on an invisible gate — `penBoard` now sends
`protected`/`inHole`/`crew` and the button disables itself with the reason.

Also: the Den had **no `.card` anywhere** — eleven games as one flat run of `<h2>` + bare inputs, the
flashiest room in the city the only tab with no surfaces (fixed structurally after render, so games can be
added without anyone remembering to open a div); blackjack renders pasteboards with a face-down hole card
instead of the letters `A 7 K`; the Main Event's crowd money is a tug-of-war bar; NOS went from a checkbox
to a bottle that arms and hums. Two loops had **no feedback at all**: `describe()` had no boxing branch
though the server sends both scores, and the races line printed neither power nor margin — so a $25k tune
was a coin-flip purchase you could never evaluate. Three hand-typed-UUID inputs (pledge a car, declare war,
propose a pact) became pickers; `me.cars` gained the same `carCollateralValue` the server checks a pledge
against, so client and server can't disagree about what a car is worth.

**What the guards caught, and what they missed.** `test/client.js` failed my own change twice — once for a
path threaded through a variable it cannot read (fixed at the source), once demanding the fixture cover
three leaderboards I had rewritten. Then a `Promise.all` restructure **silently dropped 8 boards from
coverage**: `GETBIND` only reads `const x = (await api('GET','/p')).body`, so the boards fell out while the
run still printed a pass. Taught the checker the idiom, and the derived-list idiom (`const onMe =
board.filter(...)`) beside it. **The mutation that should then have failed still passed** — and chasing that
found a *pre-existing* hole: `bodyAfter` stops at the first `;` or `,` at depth 0, which inside a template
literal is ordinary text (`style="color:var(--bad);font-size:17px"`, `&nbsp;`, a comma in prose), so every
lambda body was **silently truncated** and reads past that point were never checked. Made it
template-literal aware; recovered 10 reads immediately and the mutation now fails correctly, naming the
screen and the field. Suite green, mobile 54/54, sim drift-0, wiring 504 routes / 287 board fields / 421
element fields. **A note on process: `git checkout public/index.html` to revert a mutation wiped the whole
session's client work** — recovered from a scratchpad copy, but the lesson is to mutate on a copy or restore
from a backup, never from git, while there are uncommitted changes.

**Step two — the referral landing and the arbitrage board.** `GET /u/:name` is the page every share
link points at, and it was a flat gradient that showed a stranger their friend's stats and a button
while **never saying what the game is** — that copy only existed on the not-found fallback, so the
one visitor who most needed it was the one who never saw it. It now carries the hero plate as a
backdrop plus a short what-this-is paragraph, on the FOUND path only (rendering it on both duplicated
the fallback's own line). The backdrop is **root-relative on purpose**, unlike the `og:image` two
lines above it: og:image is fetched by a crawler with no page context so it must be absolute off
`baseUrl`, but the backdrop is fetched by the visitor's own browser from the origin it is already on,
where a relative path cannot point at a different host and works whether or not `PUBLIC_URL` is set.
The first cut used `baseUrl` for both and the backdrop simply failed to load. The City tab's Trade
Winds board — the arbitrage map, six districts that were six identical grey boxes — now carries the
six district plates on the same art-in-`::before` / scrim-in-`::after` recipe, since the same failure
applies: a photo behind a price reading is worthless if you cannot read the price.

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

**FULL-PRODUCT MAX-EFFORT RED-TEAM (`AUDIT-full-product.md`, 2026-07-23 overnight)** — eight
independent lenses over two rounds (R1: economy/§10.4, concurrency/locks, auth/OAuth,
cross-system+contracts, UI/UX over the value-creation pivot + the overnight UX drop; R2:
gameplay-flow/completeness, economy-balance, broad correctness sweep over the older core modules),
every finding re-verified vs source, suite 30/30 + sim drift-0 at every commit. **No CRITICAL, no
§10.4 leak, no auth bypass, no contract-parity drift.** Fixed in-commit (regression/verification
each): **A1** `runWageEpoch` now takes a SESSION advisory lock `pg_try_advisory_lock(0x5741,epoch)`
so two worker PROCESSES can't each read `emittedThisEpoch=0` and both pay the epoch budget — a
silent per-epoch over-emission the lifetime endowment invariant can't see (releases on crash, so a
resume still tops up); **B2** the invite is consumed ATOMICALLY inside `accountForIdentity`'s create
txn (one invite per new account even under a concurrent same-new-identity OAuth/login race — an
exhausted invite rolls the create back, gate never bypassed); **D1** `GET /v1/auth/x/callback` joined
the keyless-heavy-GET per-IP limiter (the POST-only auth limiter + the token-gated read limiter both
skipped it); **D2** `verifyPostUp` binds the tweet `author_id` for X-linked accounts (blocks a
Spread-the-Word payout for registering someone else's permanent tweet); **B3** bounded the
`actorNames`/`lastChatAt` in-process caches. **UI/UX (Lens C, founder top lens):** the **HIGH**
literal-`\n` bug on every leaderboard/dossier/trace payoff screen (44 double-escaped sites), a
curated **Extraction** card (Mint + Withdraw — the earn thesis was deck-only), the mobile bottom-nav
(3 stops → the 5 starter screens in simple mode), the FAMILY-chat dead-end, den fight labels,
empty-feed placeholder, undefined CSS vars, deck convoy templates, the 🌐 language affordance — all
browser-verified. **Gameplay flow (Lens F, 2 HIGH):** **F1** the coach's First-Week rung masked all
mid-game guidance AND was uncompletable on a default `SOCIAL_VERIFY_MODE=off` server (socials throw
`verify_unavailable`), pinning the coach for the whole population → now gates on the five gameplay
onboard tasks only, broadens the earner check (rackets/assets/fighters/speakeasy), adds a lvl-3
racket nudge, stops promising fronts before L15; **F2** the death moment was invisible (heir
auto-created, `report.kept/lost` had no consumer) → a death/heir modal driven off the estate event
through `feedLine` (delivery-once safe, deduped per generation) + estate/vendetta feed lines,
verified e2e (mod-kill → the modal). **Lens H (correctness sweep): CLEAN** — the core modules
(kitchen/casino/social/territory/market/loans/boxing/port/races + accrual/estate) are genuinely
hardened by the prior passes; the estate wipe covers every character-scoped table, lock order is
acyclic, no persist-clobber, no pg-mem arith bug, worker settles are idempotent (residual un-traced
surface flagged: casino stateful blackjack/poker in-hand, pen.executeBreak, world co-op internals,
economy swap/stake). **Economy (Lens G): coherent + conservation-clean; recommendations for founder
sign-off (NOT changed, ground rule #1)** — the passive-fronts-≫-active-loops shape (~$49M/day maxed
stack, under-measured — needs a business-ladder sim probe), the Port Deep Run trap route (L32
dominated by L16 Open Water — raise deeprun.sell/drop patrol), territory Numbers lazy-dominance, the
Stable(4)-vs-Boxing(3) cap asymmetry, and the i18n prose-translation product call — all in
`AUDIT-full-product.md` for decision.

**Round 3 (the coverage boundary, closed):** a dedicated lens exhaustively traced the four surfaces Lens H had not line-traced — casino stateful blackjack + heads-up poker (paid-once, den-book identity exact, 7-card evaluator verified, no hole-card leak), pen.executeBreak (lock order acyclic, rat relief-only, self-healing), world co-op raid + frontier (cartel_damage==Σ world:raid, §10.4-neutral), economy swap/stake (AMM k both ways, sell surcharge net-0 no rounding leak, pool-capped stake). **CLEAN — no bug.** Net across 3 rounds / 9 lenses: no CRITICAL, no HIGH open, every confirmed finding fixed; remaining opens are founder economy sign-offs + the i18n prose-translation call.

**THE FIVE PILLARS — a five-system content expansion (Fable / EU4 / EVE / RuneScape) — BUILT**
(`omerta-five-pillars-design.md`; `src/honor.js` `src/diplomacy.js` `src/sov.js` `src/campaigns.js`
`src/bloodline.js`; `test/expansion.js` — the 34th suite; suite 34/34 + sim drift-0). Five interlocking
systems, honor first since the others gate on it. **#1 HONOR ↔ INFAMY** (Fable) — a `characters.honor`
NUMERIC identity axis (−100..+100) moved by DEEDS: repay a loan +2, save a principal as a bodyguard +8,
settle a vendetta +10; welsh −15, rat −30, shank −12, npc-hit −5, oathbreak −20. Two TEETH:
**Man of Honor** (≥60) lays low cheaper (`HONOR.LAYLOW_MULT` 0.9 in `kitchen.js`); **Mad Dog** (≤−60)
gets no bodyguard (`hireBodyguard` throws `mad_dog`) AND is locked out of diplomacy. The heir echoes
`HEIR_KEEP` (0.25) of the dead street's honor. Honor is written by DIRECT SQL (`bumpHonor` — absolute
clamped, off persistCharacter's positional UPDATE, the active_at discipline; NUMERIC → pg-mem-safe) and
is a PURE STATUS axis outside §10.4. **#2 DIPLOMACY & COALITIONS** (EU4, `src/diplomacy.js`) — family
PACTS (`proposePact`/`acceptPact` block `declareWar` with `pact`; `breakPact` = the OATHBREAK: an honor
hit + a marked `oathbreaker_until` window) + anti-hegemon COALITIONS (`formCoalition`/`join`/`leave`)
against a DOMINANT family (≥`DOMINANCE_DISTRICTS` core turf OR ≥2× the runner-up's standing) — a coalition
member fights the hegemon at `COALITION_WAR_MULT` 0.5 war-chest + `COALITION_SEIZE_MULT` 0.85 seize (the
discounted number is the one ledgered). Mad Dog can't pact or coalition. `sweepDiplomacy` reaps lapsed
rows. Two-party pact locks are sorted; the discounts fold into `social.js` declareWar/seizeDistrict.
**#3 SOVEREIGNTY** (EVE, `src/sov.js`) — one STRONGHOLD per held district (build/upgrade from the
treasury — `sov:` treasury SINKS, NO faucet) with a chosen daily 2h UTC **vulnerability window**; a rival
boss `siegeSov`s a vulnerable hold (chest burns win or lose — the npchit-fee posture; a win knocks a tier
off + scores `sov_points`, razed at 0 — DESTRUCTION, never a transfer, anti-snowball). EU4
**overextension** upkeep (every extra district inflates the whole empire's pad rate superlinearly). Seize
razes the stronghold; dissolution cleans it. `sov_points` is a status leaderboard. Lock order: char → OWN
gang → the sov row (the DEFENDER's gang never locked — the convoy-manifest discipline). **#4 UNDERWORLD
CAMPAIGNS** (RuneScape+Fable, `src/campaigns.js`) — the game's first AUTHORED narrative: 5 quest chains
(`CAMPAIGNS`, one per fixer) with task-steps that advance on the Underworld ACTION stream
(`advanceCampaignsInline` in `game.js` bumpStanding — the errand-chain precedent) + Fable honor-vs-cash
CHOICE branches; a once-per-street reward (`campaign:reward` — a character_id'd cash FAUCET at mission
scale + the branch's cash sweetener, honor, fixer standing, a title). `campaign_progress` dies with the
street (a fresh street re-walks the stories). **#5 THE BLOODLINE** (Fable+EU4, `src/bloodline.js`) — a
death record per generation (`recordDeath` in `runEstate` BEFORE the wipe, account-level → survives), an
ancestral hall (`bloodlineBoard` — Roman numerals + epithets + cause + a dynasty SCORE) and a great-houses
leaderboard. §10.4: `sov:`/`campaign:` joined the cash `KNOWN_REASONS`; the treasury check gained `sovOut`
(sink). Honor / sov points / bloodline score are pure STATUS axes (outside the conservation set). Fixed a
real faucet bug the reconcile test caught — `campaign:reward` was ledgered with a NULL character_id
(excluded from the per-character cash check); now carries `characterId`. pg-mem: the coalition correlated
subqueries + the bloodline GROUP-BY aggregate rewritten as flat queries (the /v1/gangs precedent).
Console: The Life tab gained an honor line + THE FIXERS' STORIES + THE BLOODLINE hall; the Family
dashboard gained DIPLOMACY (pacts/coalitions) + SOVEREIGNTY (strongholds/sieges/leaderboard). `/v1/rules`
gained honor/diplomacy/sov/campaigns blocks; routes after `/v1/wage`; `test/migrate.js` DISPOSITION guards
`campaign_progress`. ALL numbers (honor deltas/tiers, DIPLOMACY/SOV/CAMPAIGN levers) are founder sign-off
levers. `test/expansion.js` proves the honor axis+tiers+teeth+echo, pacts (propose/accept/block-war/
oathbreak), coalitions (dominance gate + halved war chest), sovereignty (build/upgrade/siege-in-window +
sov points), campaigns (gate/action-advance/choose/claim-once), the bloodline (record + heir echo + hall),
and §10.4 (vocabulary closed + the sink/faucet ledger exactly — a before/after delta of 0). A
**three-lens red-team** (`AUDIT-five-pillars.md`: §10.4/economy, concurrency/locks, exploit/grief/death)
returned **no CRITICAL**. Lens A (§10.4) CLEAN. Fixed in-commit (regression each): **HIGH** — the siege
cooldown was per-STRUCTURE (shared across all attackers), so with a 2h window + 24h cooldown one
family/alt could throw a losing siege at window-open for ~$50k/day and SHIELD a hold from every real
attacker (and legit multi-attacker contests were broken) → a new `sov_siege_cooldowns(district_id,
gang_id)` table scopes it PER (attacker, district) — each family throttled 24h, nobody denies the slot
to all; cleared on raze/dissolution; **MED** — `siegeSov` lacked the jailed/hospitalized/safehoused
actor gates its `raidRivalRacket` sibling enforces (P1.3), now added; **LOW** — the Mad Dog lockout
gated propose/form but not accept/join (dodgeable), `isMadDog` added to both; **LOW** — `claimCampaign`'s
branch-cash sweetener now keyed to the choice STEP not a global id scan; **LOW** — `buildSov` now locks
the district row FOR UPDATE (build-vs-seize TOCTOU). Verified CLEAN: persist-clobber (honor is off the
persistCharacter positional list), honor write-races (all under the row lock), two-gang sorted locks,
sweep-vs-dissolution, the campaign advance, `recordDeath` idempotency, and estate/death completeness
(campaign_progress wiped + in the DISPOSITION map, bloodline survives, dissolution cleans diplomacy+sov).
Flagged (ground rule #1, Sybil posture): the honor-repay laylow farm + the dominant-alt coalition farm.
Suite 36/36 + sim drift-0.

**MARRIAGES & SOLDIERS (founder picks #2+#3) — BUILT** (`omerta-marriage-soldiers-design.md`;
`src/dynasty.js`, `src/soldiers.js`, assist helpers in `game.js`; `test/dynasty.js` — the 35th suite).
**Drop A — DYNASTIC MARRIAGES & THE CONSIGLIERE (CK3):** account×account ties on the Bloodline
(the vendetta-pair pattern — SURVIVE DEATH, the heirs stay in-laws), monogamous, never self.
Flow: `POST /v1/dynasty/propose/:characterId` (targets a LIVING street; proposer pays
`MARRIAGE.PROPOSE_COST` $25k at propose, non-refundable) → `POST /v1/dynasty/accept/:accountId`
(acceptor pays $25k) — both halves character_id'd `dynasty:ceremony` cash SINKS. **The wedding
buries the feud** (vendettas + peace offers both ways clear — the acceptPeace machinery). Grants
STATUS + the deterrent, never immunity: **THE SCANDAL** — a direct player kill on your in-law
(`checkScandal` in runEstate wherever `killerCh` exists: fire/shank/npcHit payer; never mod/NPC
kills) dissolves the marriage on the spot + brands the killer `MARRIAGE.SCANDAL` (−30 honor) +
tells the streets. Divorce: either side walks (`POST /v1/dynasty/divorce`), the initiator eats
`DIVORCE` (−10); withdrawing a pending offer is free. Mad Dog can't propose OR accept. **The
Consigliere** — each dynasty names ONE adviser (another account, `dynasty:consigliere` $10k sink
at propose; the named party accepts; either side ends it free) — pure status both ways (the
appointer's hall shows their adviser; the adviser's hall shows every house they counsel).
`GET /v1/dynasty` is the board; console: "The Alliance" card on the Life tab (Bloodline section).
Schema: `dynasty_marriages` (sorted account pair PK), `consiglieri` (dynasty_account PK).
**Drop B — NAMED SOLDIERS with PERMADEATH (XCOM):** recruited muscle with a rolled noir NAME +
ONE trait (`SOLDIERS.TRAITS` — wheelman/safecracker/gunner/lucky/lookout; rng-audited at hire).
`POST /v1/soldiers/hire` (`soldier:hire` $25k cash sink, roster cap `MAX` 3); ONE assigned
"second" (`/:id/assign`, injured sits out) assists three loops via `assignedSoldier`/
`soldierResult` in game.js (the advanceCampaignsInline one-way-import pattern): **§7.2 crime**
(wheelman cuts busted stints; success = +1 xp AND the soldier takes `CUT_BPS` 5% of the gross —
shaved BEFORE the ledger row, so the crime faucet strictly SHRINKS, zero new reason), **The Score**
(safecracker shortens the cooldown — pacing, never the pot), **world raids** (gunner +power on the
reservoir-BOUNDED faucet — sim flag). A busted crime / repelled raid is the RISKY outcome: the
soldier is INJURED (`INJURY_MS` 4h; lookout halves the chance) and rolls `DEATH_P` (0.12;
`SOLDIER_DEATH_P` TEST-ONLY env; lucky halves it) — dead is DEAD, the row stays on **the memorial**
(`GET /v1/soldiers`). Levels: xp/job, trait strength scales `SCALE_PER_LVL` +10%/level (cap 10) —
a veteran is genuinely better and genuinely painful to lose. Soldiers DIE WITH THE STREET
(estate-wiped + migrate DISPOSITION). §10.4: `dynasty:`/`soldier:` joined the cash vocabulary
(all sinks character_id'd — check (a) reconciles; the cut is a pre-ledger shave). Console: "Your
Second" card on Streets (roster/hire/assign/memorial). `test/dynasty.js` proves the marriage flow
(fees ledgered + gates + the buried feud + monogamy), the scandal (via a looped NPC hit — dissolve
+ brand), divorce honor + the Mad Dog lockout, the consigliere both ways, soldiers (hire sink +
cap + assign + the crime cut/xp + pinned permadeath + the memorial + death-with-the-street), and
§10.4 (vocabulary closed, sinks delta-0). ALL numbers (`MARRIAGE.*`, `SOLDIERS.*`) are founder
sign-off levers; the gunner raid bump is the one emission-adjacent lever (sim before production).
A **two-lens red-team** (`AUDIT-marriage-soldiers.md`: §10.4+locks, exploit/grief/death) returned
**no CRITICAL/HIGH — §10.4 verified EXACT** (four sinks, all character_id'd; the cut a verified
pre-ledger shave). Fixed in-commit (regression each): **MED — bigamy race** (monogamy was
unlocked-read enforced; two accepts sharing one proposer could seal TWO marriages → `lockMarriageRows`,
a deterministic ORDER-BY FOR UPDATE read of every row touching either account, is now the source
of truth in propose/accept); **MED — accept-vs-withdraw race** (an acceptor could pay $25k + clear
vendettas for a marriage that no longer existed, or a sealed marriage could be unwound as a free
"withdrawal" → the pair row is locked in both paths + the accept UPDATE is `AND NOT accepted` with
a rowCount assert); **MED — the divorce-first scandal dodge** (instant recordless divorce converted
−30 into −10 one action before any premeditated in-law kill → a `dynasty_divorces` tombstone +
`MARRIAGE.SCANDAL_GRACE_MS` 48h: the kill still fires the FULL scandal inside the window and the
pair can't RE-marry in it — which also chokes the marry/divorce vendetta-laundering cycle);
**economy flag — the safecracker was the one pure-upside trait** (zero risk/cost, +40% heist
cadence → every assisted Score now pays the same 5% pre-ledger cut as crime — the faucet shrinks,
assignment is a real tradeoff); **LOW** — `endConsigliere` scoped by role (was a shotgun);
**LOW** — a withdrawn/declined proposal now notifies the counterparty. Verified CLEAN: lock posture
(single-party, leaf rows, no AB-BA), checkScandal race-safety, absolute soldier writes,
estate/dispositions, spam bounds, wheelman non-dominance. Flagged (ground rule #1): Mad-Dog
consigliere flavor call, the wheelman jail-floor stack + gunner magnitude (sim levers), the
multi-offer withdraw UX. Suite green + sim drift-0.

**BLACKMAIL & SECRETS + THE COLLECTION (founder picks #7+#8) — BUILT** (`omerta-secrets-collection-design.md`;
`src/secrets.js`, `src/collection.js`; `test/intrigue.js` — the 36th suite). **Drop A — BLACKMAIL & SECRETS
(CK3 intrigue):** information as leverage with money on the line. `digSecret` (`POST /v1/wire/dig/:targetId`)
burns `SECRETS.DIG_OMR` (10 $OMR, `intel:dig` through the spymaster till — rank-DISCOUNTED via `intelCost`,
bumps `intel_ops`, burns win or lose — the npchit-fee posture) to pull the mark's REAL dirt: `juiciestSecret`
derives the KIND from actual state (launderer via `wash_used`/`rwa_used` → hushCap $250k / exposeHeat 25;
killer via `season_kills` → 200k/20; cook via stash/lab → 150k/20; moneybags via bank ≥ `MONEYBAGS_MIN`
$500k → 100k/12 — a boolean, coarser than the wire's wealth bands, so the anti-precise-kill-EV rule holds);
a CLEAN mark yields nothing (the burn stands), and **disinformation defeats the shovel** (`disinfo_until`
checked before the derive — the counter-intel triad extends to secrets). Anti-grief bounds: per-(digger,
target) 24h cooldown (`digs` PK table), `MAX_HELD` 5, one secret per holder per target, `TTL_MS` 7d.
`extortSecret` names a price (`DEMAND_MIN` $100 ≤ demand ≤ the kind's hushCap, validated under the secret's
FOR UPDATE, once — `pending` on a re-extort) opening a `EXTORT_WINDOW_MS` 24h window and notifying the mark —
**an un-extorted secret stays invisible to the mark** (the layered info economy: the demand IS the reveal).
The mark `payHush` (`POST /v1/secrets/:id/pay`, two-party) — the audited bodyguard/speakeasy-round TAXED
transfer byte-for-byte (`secret:hush` both sides, mark −demand / holder +98%, 1% street tax → buyback
singleton locked LAST, 1% dev off-ledger; capped + dirt-gated, so a strictly-worse collusion rail than the
existing 2% rails) and the secret is CONSUMED; or the holder `exposeSecret` — the kind's `exposeHeat` lands
on the mark's RICO investigation meter (`heat_exposure`, the Port BUST_EXPOSURE precedent — in-memory on the
locked second char, riding the positional persist) + a streets feed; the worker `sweepSecrets` BLOWS unpaid
demands past the window (mark char locked FIRST then the secret — the bounty-sweep order, audit MED-1 fix).
Secrets hold ZERO escrow (a demand is just a number → estate/sweep/expiry move no value); death kills dirt
in BOTH directions (`runEstate` deletes holder-side + target-side; a dead holder's demand also drops off the
board via the `alive` JOIN — the heir starts clean; target-side dig cooldowns deliberately persist as a
bloodline throttle). §10.4: `secret:` joined the cash vocabulary (the transfer reconciles per character);
`intel:dig` rides the existing `intel:%` omr burn term — zero invariant shape changes. **Drop B — THE
COLLECTION (the completion compulsion pointed at content that already exists):** an account-level
"ever done / ever owned" ledger (`collection_log` PK triple, idempotent ON CONFLICT insert under a probed
SAVEPOINT so it can never poison the enclosing action txn — audit LOW-1) spanning 8 categories / 140 items:
crimes pulled, districts walked, cars owned (all five transfer sites — GTA, market buy-now + auction settle,
loan collect + sweep-forfeit, pink slips — via `logCarCollect`), guns bought, drugs cooked, boats bought,
goods traded, fixtures befriended (standing ≥ 25). PURE STATUS, zero §10.4 surface, **SURVIVES DEATH**
(account-keyed, outside the estate wipe — the heir keeps every mark). `GET /v1/collection` (per-category
got flags + pct), `GET /v1/leaderboard/collection` (catalog-filtered tally so board and leaderboard always
agree — audit F1; agents excluded, dynasty names). Console: "Dirty Laundry" on the Wire tab (dig/extort/
pay/expose), "The Collection" on the Estate tab. A **two-lens red-team** (`AUDIT-secrets-collection.md`:
§10.4+locks, exploit/grief/death) returned **no CRITICAL/HIGH**; fixed in-commit (regression each): the
MED-1 sweep lock inversion, the F1 leaderboard catalog filter, the LOW-1 savepoint guard, a fake rng_audit
roll on the deterministic dig (now roll-0 "(deterministic)"), the `DEMAND_MIN` floor (a $1 demand netted the
holder ≤ 0 through the ceil'd takes), and the estate digs comment; plus a dead-holder board regression.
Flagged for founder sign-off (NOT patched): instant expose-without-extort (bounded — 5 rings ≈ 125 exposure
vs INDICT_AT 3000, real dirt required), the late-window quiet expiry, no actor gates (the Wire remote-
surveillance posture; payHush is defensive), and multi-holder demand stacking (the pressure is the point —
`MAX_HELD`/`DIG_OMR` the dials). Suite 36/36 + sim drift-0. All `SECRETS.*` numbers are founder sign-off
levers.

**THE FLOAT — the full-reserve RWA rebuild (R2 redesigned, founder-directed 2026-07-23) — BUILT**
(`omerta-rwa-float-design.md`; `src/rwa.js`; the FLOAT block in `test/portfolio.js`). The founder's
diagnosis — "the OMR→tokenized-stocks conversion doesn't really work" — was CORRECT and is now the
architecture: a burn funds nothing, the hash price vs real backing = arbitrage or an unfunded
liability, and on-demand securities conversion collapses the legal containment. Rebuilt on the
principle already load-bearing in the withdrawal queue + OmertaBond: **THE GAME ONLY EVER OWES STOCK
IT ALREADY OWNS.** Flow: ETH tax slices → `rwa_revenue` (the Store's 20% earmark goes live; gameplay
fees gained `FEE_RWA_BPS` 10% carved from the FOUNDER share — Vig 60% untouched, txHash-gated,
idempotent, load-time `VIG_BPS+FEE_RWA_BPS ≤ 10000` assert) → the buy-bot seat (`runRwaBuyback`,
`POST /v1/mod/rwa/buy` — mod-driven until the mainnet Uniswap bot, the runVigBuyback twin: spend ≤
unspent revenue under a cross-ticker advisory lock, `RWA_MAX_PRICE_JUMP` 10× continuity bound,
real-vs-simulated flagged via the `modRealTxHash` gate) → `rwa_reserve` (the float, per-ticker UNITS
+ cost basis) → the claim rail (`claimVaulted`, `POST /v1/vault/claim`): burn earned $OMR at the
REAL oracle price (last buy price × the Vig OMR/ETH TWAP, PLEX floor pre-market) to claim units —
**$OMR is the rationing ticket, ETH was the funding**. Clamps to available (never an IOU; zero-unit
asks refused before the burn), per-account rolling-24h `CLAIM_DAILY_OMR` bucket
(`account_persistent.vault_used/vault_at`, outside persistAccount — clobber-safe), the RICO
graduation on the SHARED `rwa_used` window (structuring-proof across both books) + safehouse block +
heat + jailed gate, reserve-row FOR UPDATE serializing same-ticker claims. **Two-tier book:** the
legacy hash-priced holdings are the PAPER tier (status — dynasty/crest/landmarks/dividends
unchanged, no retroactive liability); `rwa_vault` is the VAULTED tier (account-level, SURVIVES
DEATH). §10.4: the only in-game flow is the `rwa:vault` burn riding the existing `rwa:%` vocabulary
— ZERO invariants.js change; everything else is out-of-band real-value accounting (zero
transactions rows). `runRwaInvariants` (`GET /v1/mod/rwa`) is the real-value invariant: spend ≤
revenue, **allocated ≤ held per ticker (THE anti-Ponzi check)**, held == Σ buys, cost basis exact,
real-vs-simulated units. Console: "The Float" card on Going Legit (claim + BACKED chip; the legacy
board relabeled "The Paper Book"); `/v1/rules.vault`. A **two-lens red-team** (`AUDIT-rwa-float.md`)
returned **no CRITICAL** — the legal wall verified airtight (NOTHING decrements
`rwa_vault`/`reserve.units`, no transfer, no redeem affordance, zero RNG grants) — and fixed
in-commit (regression each): the zero-unit burn (an ask under the round6 grid burned the full amt
for 0 units), the unbounded `priceEth` (a dust/typo buy repriced the whole float; the degenerate
`omrPerUnit→0` edge would have swept it for 1 $OMR — now a continuity bound + a claim guard), the
`modRealTxHash` route-parity gap (a comp could stamp `real=true`), the cross-ticker budget race
(advisory lock), the fee-split sum assert, the buyback 23505→contention mapping, and an end-to-end
FEE_RWA_BPS fee-slice test. Flagged for founder sign-off (mainnet-gate items, NOT patched): the
stale-oracle free option (refresh-at-claim / PREMIUM_BPS spread — **the #1 economics item before
the real bot ships**), minted-only claims (the Wage D1 precedent + R3 dead-allocation), FCFS
sniping (pro-rata/per-buyback caps), and the R3 precondition that simulated units reconcile to the
Safe before any extraction. The chain layer (Uniswap bot + Safe custody + the KYC'd/geofenced R3)
stays mainnet/legal-gated — this drop is the complete off-chain core with zero new regulatory
surface. Deliberately NOT built: direct ETH→shares purchase (securities-dealer-at-point-of-sale —
entry stays in-game). All `RWA_FLOAT.*` numbers are founder sign-off levers. Suite 38/38 + sim
drift-0.

**THE CELLPHONE (founder request) + tester-feedback fixes — BUILT** (`src/phone.js`, `schema.sql`
`dm_messages`, `src/server.js`, `src/worker.js`, `public/index.html`, `test/hardening.js`, both codices).
**The Cellphone** — a personal INBOX + player-to-player DMs, pure talk with **ZERO §10.4 surface** (the
test proves the whole exchange writes no `transactions` rows). The inbox half is the EXISTING
`notifications` stream surfaced as a PEEK that never flips `delivered` (that flag belongs to the WS
backfill — `GET /v1/notifications` stays the one delivery-marking read). The DM half is the new
`dm_messages` table — **ACCOUNT-keyed on both sides** (no character_id column → never estate-wiped, the
DISPOSITION guard doesn't even see it): threads SURVIVE DEATH, the heir picks up the phone; name
snapshots per line (the troll-box discipline); the counterpart's CURRENT living street is resolved for
display + reply targeting, and **account UUIDs are stripped from every response** (the
closeSocketsOnKill discipline — threads are client-keyed by living characterId; a dead line reads
"line dead" until the heir rises). Discipline = the postChat trio verbatim: `cleanText` + 240-char
clamp + a 2s per-account flood brake (gates before the brake, only a landed line arms it); self/gone
gates; sending to a DEAD street still lands (addressed to the line, the heir reads it); a send rings
the recipient's living character via the normal `notify()` (inbox row + live WS push, best-effort
post-insert). Routes `GET /v1/phone` (threads + unread + the inbox peek), `GET /v1/phone/thread/
:characterId` (marks seen), `POST /v1/phone/dm/:characterId`; worker 30-day retention (the troll-box
7-day twin). Console: a 📱 top-bar button with a live unread badge (lit at boot from the board, bumped
by the WS `dm` ring, cleared on thread read), THE CELL modal (compose off the streets roster, threads,
a thread view with reply, the humanized inbox via `feedText`), and a `dm` feed line. `test/hardening.js`
covers send/sanitize, self/empty/gone/flood gates, threads + unread + seen lifecycle, the peek NOT
flipping delivered, both directions of a conversation, and the zero-ledger-rows assertion.
**Tester-feedback fixes shipped with it:** (1) "says I'm in the hospital but still running jobs" — the
MECHANIC is signed v24 design (hospital = protection, "rivals can't touch you", never actor incapacity;
ground rule #1 — not changed); the LEGIBILITY was the bug: the coach line claimed "nothing to do but
wait" → now says you're untouchable and can still work; the sheet chip `HOSPITAL` (bad) → `DOC'S CARE`
(cold); the glossary explains "protection, not prison". (2) X sign-in confusion ("can't find the
X-provider token") — a **"How do I sign in with X?" FAQ** on the entry screen (one-click PKCE is the
way, there is NO token to find on x.com, the paste box is developers/agents-only and now labeled so)
+ the claim card explains the one-tap flow / says clearly when one-click isn't configured on the
server. (3) the live feed's generic "pulled a job" now names the SPECIFIC job (`ACTIVITY_WIRE` values
may be `(req) => text` functions; the crime id is already public on /v1/rules, no amounts ride the
line — "pulled a job — Pickpocket a tourist"). Chromium-probed end-to-end (FAQ renders; DM round-trip;
badge lights over WS + clears on read; the feed rings 📱 and names the job; ZERO page errors). Suite
green + sim drift-0. Deferred (step two, flagged): block/mute lists, DM-from-the-streets-roster
shortcut buttons, unread-DM chip on mobile nav.
**Cellphone step two — BLOCKED LINES + the roster shortcut + the mobile chip — BUILT** (`src/phone.js`,
`schema.sql` `dm_blocks`, `src/server.js`, `public/index.html`, `test/hardening.js`, both codices; the
three deferred step-one items). **(1) BLOCKED LINES** — `dm_blocks (blocker_account, blocked_account,
name-snapshot)` PK pair, **account-level both sides** (a block outlives death: you blocked the BLOODLINE,
the heir stays blocked until you relent; no character_id → outside the estate wipe + DISPOSITION guard by
construction). `sendDm` gates BOTH directions before the flood brake: a blocked sender gets an honest
`blocked` dead tone (no silent drop — they can know you hung up), the blocker gets `you_blocked` (unblock
to talk). Blocks gate ONLY DMs — game events (a jump, a contract) still notify: you mute a man's mouth,
never the city. History stands (blocking never deletes the thread). `POST`/`DELETE
/v1/phone/block/:characterId` (idempotent insert / clean `not_blocked` on a double-lift); the board gains
a per-thread `blocked` flag + a `blocks` list (client-keyed by the blocked line's LIVING characterId — the
no-account-UUID discipline; a dead blocked line shows its snapshot name); the thread view gains
`with.blocked` (+ `replyable:false` while blocked). Console: a 🚫 block/unblock button in the thread
header (with a what-it-does confirm), BLOCKED chips on threads, a BLOCKED LINES card with unblock buttons,
ERRMAP entries. **(2) THE ROSTER SHORTCUT** — every street in Wet Work's roster carries a 📱 button that
opens THE CELL straight onto that thread (an empty thread doubles as compose — the reply box is the
composer). **(3) THE MOBILE CHIP** — the mobile thumb bar (`#bnav`) gained a **cell** stop (visible in
BOTH simple + full modes — the visibility loop skips no-`data-go` stops) that opens the phone, with its
own unread badge mirrored by `phoneBadge()` (top-bar + bnav always agree). Zero §10.4 (pure talk; the
step-one zero-ledger-rows assertion still covers the whole exchange). Deck gained a 'The Cellphone' group.
`test/hardening.js` (STEP TWO block): block → dead tone before the brake, `you_blocked` the other way,
board/thread surfacing + history stands, self/double-unblock gates, unblock → the line takes calls again.
Chromium-probed end-to-end (roster 📱 opens compose, both badges light '1', block flips the thread to
read-only + B's send returns `blocked`, board-list unblock works; ZERO page errors). Suite 38/38 green.
Deferred (step three, if ever): a mute-without-tone variant (silent drop — rejected for now: honesty is
cheaper than paranoia), per-thread notification muting.

**THE MEGAPROJECT (founder pick #1 — the collective monument) — BUILT** (`omerta-megaproject-design.md`;
`src/megaproject.js`, `test/megaproject.js` — the 39th suite; schema `megaprojects` +
`megaproject_contributions`; the `MEGAPROJECT` rules tail). The WoW Ahn'Qiraj-gate server event: the city
announces a MONUMENT (the authored `MONUMENTS` catalog, raised in order — Cathedral Restoration $25M →
Grand Casino $60M → Founder's Bridge $150M → Colossus $400M) and the whole base pools value toward the
target; completion PERMANENTLY changes the city and the contributors' names go on the plaque forever.
**§10.4-POSITIVE by construction — every contribution is a SINK, nothing ever minted**: cash burns
(`megaproject:cash`, character_id'd — check (a) reconciles), $OMR burns through the audited `spendOmr`
primitive (`megaproject:omr`, joined the omr vocabulary + omrBurns), goods are deleted from the trunk
(non-currency ownership sink) credited at CATALOG BASE value (location-free — the §7.11 arbitrage surface
can't leak in); $OMR credits at the FIXED `OMR_RATE` $500 (deliberately not live spot — deterministic,
unmanipulable). One 'building' row at a time, materialized on the first contribution (deterministic PK →
23505 → `contention`, the auction-F1 pattern), locked FOR UPDATE singleton-last; contributions CLAMP to
what the wall needs; the crossing brick COMPLETES it in the same txn (lazy, no worker) — streets
celebration, THE ARCHITECT (top contributor) notified, the monument joins **THE SKYLINE** (a permanent
section on the keyless `GET /v1/city`, 30s-cached) carrying its top-8 plaque forever. The plaque
(`megaproject_contributions`) is ACCOUNT-level — survives death, the dynasty keeps its glory (no
character_id → outside the estate wipe by construction); tiers computed at read (The Architect →
Foreman → Patron → Builder — pure status, zero power; the completion district-perk option is DELIBERATELY
DEFERRED to founder sign-off since it would touch the signed turf surface). Milestones at 25/50/75% feed
the streets. Routes `GET /v1/megaproject`, `POST /v1/megaproject/cash|goods|omr`; `/v1/rules.megaproject`;
console: the City tab leads with the monument card (progress bar + three contribute rails + the plaque +
your share) + THE SKYLINE; `describe()` + feed lines humanize bricks/milestones/completion; deck group
added. `test/megaproject.js` proves the announced-unstarted board, all three rails (ledger-exact burns,
trunk deletion at base value, the fixed rate), the floors/jailed/bad-good/qty-0 gates, the plaque +
Architect tier + your-rank, the CLAMP + COMPLETION (no overpay; skyline WITH the kept plaque; the next
monument announced), death survival, and §10.4 (both vocabularies closed; cash + $OMR drift == the SQL
seeds only). A focused three-lens red-team (`AUDIT-megaproject.md`) returned **no CRITICAL/HIGH/MED** —
§10.4/locks/UUID hygiene verified sound (incl. the safehouse-ungated argument holding: a burn is
scorched-earth denial, not shelter) — and fixed six LOWs in-commit (qty coercion → clean refusal; the
"plaque forever" surface on the skyline; tie determinism across all three rank surfaces; the
last-known-street name fallback; the completion-feed name fallback; the plaque index) with one accepted
dust note (≤$1 on the final brick, ledger bit-exact). Flagged for founder sign-off (BALANCE.md): agent
inclusion on the plaque (every other status board excludes agents; here the plaque is bought with burned
value), a goods $-value floor if dust spam shows. All `MEGAPROJECT.*` numbers (targets, OMR_RATE, floors,
tiers) are founder sign-off levers. Suite 39/39 + sim drift-0.

**THE SLATE TRIO (founder picks #5+#4+#6) — BUILT** (`omerta-ladder-clues-seasons-design.md`;
`src/duels.js`, `src/clues.js` + the `doCrime` drop hook in `src/game.js`, the `SEASON_MODS` rules tail;
`test/duels.js`/`test/clues.js`/`test/seasons.js` — the 40th–42nd suites). **#5 THE DUELING LADDER** — ranked
ELO PvP (`DUELS` rules tail: ELO_START 1200 / K 32 / floor 100 / MIN_LVL 5): consent-by-listing
(`characters.duel_limit`, the fade/bout pattern), the duel a stat contest (muscle+cunning/2+speed/4 +
rand(VARIANCE)) settling a CASH stake as the audited **casino:pvp taxed transfer** byte-for-byte (`duel:wager`
both sides, winner nets stake − 5% rake, half the rake → street_tax — **ZERO new emission**); `duel_elo` a
per-street seasonal rating (DIRECT SQL, reset to 1200 in `runSeasonRollover`), `duel_wins` the account-level
lifetime legend (survives death, loser ≥ `LEGEND_MIN_LVL` 10). Anti-Sybil stack: per-account-pair daily
K-diminishing (`duels` log table, K/(1+priorToday)), level floors both sides, ELO floor, the rake taxing
every feed, a challenger cooldown (`CHALLENGE_CD_MS` 10min on `characters.duel_at`; `DUEL_CD_MS` TEST-ONLY).
`GET /v1/duels` board + `GET /v1/leaderboard/duels` (agents excluded); a Dueling Circuit section on Wet Work.
**#4 CLUE SCROLLS** — the RuneScape treasure trail: a 2% drop on a successful crime (`CLUE_DROP_P` TEST-ONLY;
SAVEPOINT-probed + rng-audited hook in doCrime — never poisons the action txn) starts a 3–5 step riddle hunt,
each step a DISTRICT (+ sometimes a city-hour window) derived from the scroll's salt via the §7.11 hash (no
stored answers); stand right, `POST /v1/clues/dig` (5 energy win or lose; safehouse-gated D2), the final dig
opens THE CASKET — **the one new faucet** (`clue:casket` $3k–$12k, character_id'd, bounded by drop × one
active scroll × an 8h `clue_at` cooldown ≈ $22.5k/day hard ceiling, sim P9.19 — petty by design). Scrolls die
with the street (`clue_scrolls` wiped + DISPOSITION); `caskets` is the account legend +
`GET /v1/leaderboard/clues`; a clue-slot card on Streets. **#6 SEASONAL LEAGUE MODIFIERS** — the PoE season
twist, THE ONE DROP THAT TOUCHES SIGNED LEVERS BY DESIGN: `seasonModOf(seasonIdx)` draws one of `SEASON_MODS`
(Dead Quiet vanilla / The Crackdown lawGain ×1.25 + laylow ×0.75 / Blood in the Streets loot ×1.15 +
safehouse ×1.25 / The Gold Rush trade-sell ×1.05) per 28-day season off the §7.11 seed — **DORMANT unless
`SEASON_MODS=on`** (read per call, the SOCIAL_VERIFY_MODE posture; arming is itself the founder sign-off,
`SEASON_MOD` TEST-ONLY pins it). Five touchpoints, each composing multiplicatively on an EXISTING modifier
site with the MODIFIED number ledgered (the decree discipline): kitchen laylow, accrual law gain, social
kill-loot rate (all five loot surfaces incl. the estate's escrow legs) + safehouse cost (charge AND view
quote), economy goods sell. `/v1/city` carries the season + countdown; a season banner on the City tab.
§10.4: `duel:`/`clue:` joined the cash vocabulary; seasons add no reason (modified numbers ride the normal
rails). A six-lens ultracode red-team (`AUDIT-slate-drops.md`, 34 agents, 2-refuter adversarial verification)
returned **no CRITICAL/HIGH** and fixed 1 MED + 12 LOW in-commit (regression each): the MED — renderPvp's
duels fetch blanking the whole Wet Work tab on any /v1/duels error (now graceful); the LOWs — the view
safehouse quote omitting the season mult, lootMult missing the two escrow-loot legs, the un-SAVEPOINTed +
un-audited clue drop hook, listDuel's stale in-memory limit, floor-clamped elo deltas misreported, the
missing challenger cooldown, zero lawGainMult test coverage, no duels-log retention (60d sweep added), the
codex drift-detector unextended, and dig() unguarded from a safehouse. Accepted: the their_cash probe
(fade/bout parity), pre-commit bus emits (codebase norm). Flagged for sign-off (BALANCE.md): the Gold Rush
round-trip (+~1%/cycle past the 4% fee wall — moot while unarmed), duel_wins farmable vs one funded lvl-10
alt (the fight-fix posture), the latent sub-1 safehouseMult outside the max() floor, crackdown retroactivity
at a boundary, and the two textually-duplicated 28-day season clocks (linking comments added). ALL
`DUELS.*`/`CLUES.*`/`SEASON_MODS` numbers are founder sign-off levers. Suite 42/42 + sim drift-0.

**THE DEEP-SYSTEM DEFERRED FOUR (founder-directed 2026-07-24) — BUILT** (`omerta-deep-deferred-design.md`;
`src/estate.js`, `src/commission.js`, `src/loans.js`, `src/casino.js` + new `src/ring.js`; the 43rd suite
`test/ring.js`). Integrated the four deferred items sitting on otherwise-deep systems — each rides an
already-audited pattern, no new money surface invented. **(A) Estate step two — THE STAFF & THE GALA**:
`ESTATE.STAFF` (5-trade catalog, daily $OMR wages accrued lazily on one household clock — the pad/nut
pattern; unpaid past `STAFF_WALK_MS` 7d the staff WALK, arrears cleared) settled all-or-nothing via
`payStaffWages` (`estate:staff` burn); `throwGala` (a tier-scaled `estate:gala` burn opening a 4h be-seen
window anyone alive can `attendGala` once — guest lists, `galas_hosted`/`gala_best`); `GET /v1/leaderboard/
estates` (great houses by lifetime $OMR sunk, agents excluded). PURE STATUS; all burns ride the existing
`estate:%` omr vocabulary → zero invariant change. **(B) Commission step three — PROPOSALS + THE LEVY**: a
seated boss stakes a `COMMISSION.PROPOSAL_DEPOSIT` ($100k) treasury deposit (`commission:proposal` escrow)
to put a motion on the week's ballot (when motions exist, only proposed decrees tally); the worker
`settleProposals` refunds the enacted motion (`commission:refund`) + forfeits the rest to the pool
(`commission:forfeit`) — a NEW **commission escrow** §10.4 check + gang-treasuries terms. **THE LEVY** (a
fifth decree) redirects the 12h buyback's existing family split to the seated chamber (weighted
`COMMISSION.SEATS − i`) instead of the lifetime top-25 — a PURE REDIRECT in `runBuyback` (zero new money,
seasonal-seat-gated). **(C) THE LOAN HOUSE (Shylock step five)**: the backed NPC lender — `loan_house`
singleton fed by half of every P2P vig (`LOAN.HOUSE_VIG_BPS`) + mod funding from the confiscation pool;
`takeHouseLoan` lends ONLY what the pool holds (full-reserve — never a mint; `HOUSE_RATE` 0.35 / 24h /
level-scaled cap ≤ $50k / welsher-blocked / one-debt / `HOUSE_MIN_LVL` 3), `repayHouseLoan` grows the pool,
the sweep auto-collects defaults (`loan:house:seize` → pool + welsher + WANTED). A NEW **loan house pool**
§10.4 check; all `loan:house:*` ride the `loan:` prefix. **(D) Casino step five — RING POKER + THE
BRACKET** (`src/ring.js`): true multi-way hold'em with betting streets, made atomic-architecture-native by
one rule — **THE TABLE IS AN ESCROW** (cash moves only at sit/leave; stacks/bets/pots live in
`poker_tables`/`poker_ring_seats` rows, so no action ever locks another player's character; the table row
lock is the mutex). Ante-poker streets (preflop→river), raises CAPPED at the smallest live stack (no side
pots), a 90s turn clock + never-wedge sweep, rake carved from the pot (half → street tax; `casino:ring:take`
NULL), a dead player's stack burns (`casino:ring:death`, runEstate). A NEW **ring poker escrow** §10.4 check
(`Σ stacks + Σ pots == sit − leave − take − death`); `casino:ring:*` rides the `casino:` prefix OUTSIDE the
den-book LIKE patterns (the PvE house book never sees ring money). **THE BRACKET**: multi-table elimination
on the EXISTING tournament escrow (`{bracket:true}` at materialization; the worker runs rounds of heats down
to a final paying `TOURNEY.PAYOUTS` net of the same 5% rake — the escrow identity untouched). Console:
household/gala/great-houses (Estate), motions (Family), the House Window (Shylock), a live ring room +
bracket toggle (Den); feed lines. `RING_TURN_MS`/`BRACKET_ROUND_MS` env are TEST-ONLY. Suite 43/43 + sim
drift-0. All numbers are founder sign-off levers (BALANCE.md). A **six-lens ultracode red-team**
(`AUDIT-deep-deferred.md`; the 2-refuter verify phase aborted on a model-credit limit, so all
crashed-unverified findings were re-verified BY HAND) returned **no CRITICAL** and fixed **2 HIGH §10.4
drifts + 6 MED/LOW** (regression each): **HIGH** — `dealHand` dropped a resolved-stall's rake (missing
`settleFinish` before dealing fresh → ring-escrow drift on commit); **HIGH** — a mid-bracket death burn
didn't reduce the pool while the bracket stayed open (tourney-escrow drift; the pool reduction is an
ABSOLUTE write — the pg-mem `pool = pool - $n` quirk mis-evaluated); **MED** — `leaveTable` didn't resolve
the last-man-standing when the leaver wasn't acting (the survivor's pot could wrongly burn); a zero-runner
bracket final crashed on `ranked[0]`; `settleProposals` refunded a dissolved winner (treasury drift) + the
buyback credited a dissolved payee ($OMR drift) — both now re-verify existence under the lock; `payStaffWages`
now COMMITS the walk (was rolled back by the throw); `gala_best` clobber → `GREATEST` in the upsert; plus
LOWs (attendGala jail gate + 23505-only catch, the veto-forfeits-all rule, the levy weight formula →
`COMMISSION.SEATS − i`, a `gala_guests` 7d retention sweep, the design-doc `STAFF_CAP_MS` drift). Flagged
for founder sign-off (NOT patched): estate walk economics (the recurring sink floors at the rehire fee), the
levy self-deal + proposal agenda-control, last-second proposal sniping, the loan-house death cycle,
ring soft-play collusion (all bounded/status-posture or ground-rule-#1 balance calls).

**TIER-1 → TIER-4 DEEPENING PROGRAM (founder-directed 2026-07-24: "expand every single tier 1 system into
tier 4 level systems") — ALL SIX BUILT** (`omerta-tier1-deepening-design.md`; red-team `AUDIT-tier1-deepening.md`
— no CRITICAL/HIGH; BALANCE.md sign-off flags; §10.4 drift-0 + the 43-suite green after every drop). The six
thinnest systems, each deepened to the depth bar (multiple orthogonal mechanics + a scaling catalog + a
competitive/meta layer + a status legend + a console screen), all on already-audited patterns.
**(1) THE DUELING LADDER** (`src/duels.js`, `test/duels.js`) — DIVISIONS (Bronze→Master, a ladder over raw
ELO), WEAPON STYLES (Brawler>Gunslinger>Fencer, a rock-paper-scissors `DUELS.STYLE_EDGE` +15% combat mult so
the BUILD isn't the only axis; `pickStyle`, direct-SQL `duel_style`), THE SEASON BELT (highest-ELO listed
duelist, recomputed on read — the Commission-seats precedent) crowned at rollover into account-level
`duel_titles` (survives death, the boxing-belt legend) ranked `DUEL_TITLE_RANKS`, and GRUDGE REMATCHES
(challenging whoever last beat you cools ~⅓ as long). Status/combat only — the wager stays the audited
casino:pvp transfer, §10.4 UNTOUCHED. `POST /v1/duels/style`; the leaderboard gained divisions + a death-proof
champions board. **(2) CREW HEISTS** (`src/heists.js`, `test/heists.js`) — the JOB LADDER 4→12 (corner-store
$4k lvl4 → the Federal Reserve $320k lvl80 5-man, on the sim-signed ROI curve; two new roles lookout/hacker
for the 5-man crews; the marquee jobs `minPulled`-gated), THE CASING PHASE (`caseJob` — energy for a bounded
success bonus, capped), THE FENCE (a standard score taken HOT banks fenceable `heist_loot` book value — NOT a
§10.4 currency, the Port contraband twin — fenced at a drifting rate centered BELOW 1.0, so a variance play
never a net faucet increase; `heist:fence` rides the `heist` prefix; loot-able on a fire-kill via
`HEIST_LOOT_RATE`, the P1.1 twin), and CREW NOTORIETY (`account_persistent.heists_pulled`, survives death,
`HEIST_RANKS` + `/v1/leaderboard/heists`; the count soft-gates the marquee jobs). **(3) CLUE SCROLLS**
(`src/clues.js`, `src/rules.js`, `test/clues.js`) — TRAIL TIERS (`CLUES.TIERS` easy→master, rolled at drop by
weight, sets step count + casket band + relic rarity; the master casket $55k–120k is the one flagged faucet,
≤3/day-capped), PUZZLE VARIETY (`clueStepOf` gains anagram/cipher KINDS — the same answer dressed richer, zero
dig-logic change), CASKET RELICS (a rare casket yields a status Collection trophy via `logCollect` to a new
`relics` category — never $OMR-by-chance, the RWA rule), and a deeper `Master of the Trail` rank +
per-digger relic tally. `CLUE_RELIC_P` is a TEST-ONLY roll knob. §10.4 unchanged (the casket still rides
`clue:casket`, tiered band). **(4) TERRITORY RACKETS** (`src/territory.js`, `src/rules.js`, `test/social.js`)
— the TYPE catalog 3→6 (loansharking ×1.20 / chop-shop ×1.25 / counterfeiting ×1.45, zero territory.js code —
the type is data, riding the existing `incomeMult`/scrutiny; the income mults flagged for sim) + THE SYNDICATE
(`syndicateOf` — a family running ≥`TERRITORY_SYNDICATE_MIN` (3) operations of ONE type earns that type's
syndicate title, PURE STATUS on `GET /v1/territory` + the public family view — the Empire precedent).
**(5) SOVEREIGNTY** (`src/sov.js`, `src/rules.js`, `src/invariants.js`, `test/expansion.js`) — the stronghold
ladder 3→6 (Outpost→The Iron Capital, on the cost/garrison/upkeep curve; `SOV_POINTS`/RANKS extended) + SOV
INCOME (each tier yields a lazy `incomePerDay` to the treasury — a held stronghold is now a PRODUCTIVE,
defensible asset; `collectSov`, `POST /v1/sov/collect`, any member, D2 safehouse-gated, 24h-capped,
crumbling-gated). §10.4: `sov:income` is a treasury FAUCET EXCLUDED from the `sov:%` sink sum + carried as its
own `sovIncomeIn` IN term in the gang-treasuries check — proven neutral by a before/after drift-delta in the
test (the territory:income precedent). **(6) SOLDIERS** (`src/soldiers.js`, `src/game.js`, `src/rules.js`,
`test/dynasty.js`; the thin sub-system of the Marriages/Soldiers/Secrets trio) — the recruit→capo RANK ladder
(`SOLDIERS.RANKS`, `soldierRankOf`, derived status on the roster + memorial) + THE COMMANDER LEGEND
(`account_persistent.soldiers_led`, lifetime successful assisted jobs bumped in `soldierResult`, survives
death, `COMMANDER_RANKS` + `/v1/leaderboard/commanders`). Zero §10.4 (a status counter). Persist-clobber
verified clean across all six (every new direct-SQL column absent from the persist positional UPDATEs); lock
order acyclic (belt/grudge/syndicate/strength are unlocked reads; collectSov = gang→structures matching
upgradeSov/siege; the crown/legend bumps run under the actor's char lock). Each drop: schema → rules → module
→ routes → console → tests → suite+sim → commit. Deferred (flagged): the duel bracket-tournament + spectator
betting (§C), the sov multi-stage siege + coalition co-defence (§B/§D), and Marriages (dowries/betrothal) +
Secrets (types/network/market) — the two already feature-complete for their role. All numbers are founder
sign-off levers; the new faucets (heist fence, master casket, sov income, territory hot-type mults) are
sim-before-production flagged in BALANCE.md.

**TIER-2 → TIER-4 DEEPENING PROGRAM (founder-directed 2026-07-24: "upgrade all the systems in tier 2 to
tier 4 complexity") — ALL FOUR BUILT** (`omerta-tier2-deepening-design.md`; red-team
`AUDIT-tier2-deepening.md` — no CRITICAL/HIGH; §10.4 drift-0 + the 43-suite green after every drop). The
companion to the Tier-1 program, walking DOWN the build-depth ranking: the second-thinnest systems
(a single built level, no step-two, thin catalog) deepened to the depth bar (multiple orthogonal
mechanics + a scaling catalog + a competitive/meta layer + a status legend + a console screen). Note:
"Tier 2" is a reconstruction of the earlier tiered inventory (founder can course-correct the membership).
**(1) THE KITCHEN** (`src/kitchen.js`, `src/accrual.js`, `KITCHEN` rules tail) — **LAB MODULES** (a
purity/yield/stealth upgrade axis on the lab tier, `characters.lab_purity/lab_yield/lab_stealth` direct-SQL;
purity→cook quality, yield→batch cap, stealth→the accrual Bureau-raid probability; cash SINK + top-level
$OMR BURN `kitchen:module`), **CUTTING AGENTS** (`cutStash` — stretch a stash line +40% units at −15%
quality floored at CUT_FLOOR, cash SINK `kitchen:cut`; units are ownership not currency), and **THE KINGPIN
LEGEND** (`account_persistent.product_moved` lifetime gross moved across deal + offline crew sales, survives
death, `KINGPIN_RANKS` + `GET /v1/leaderboard/kingpins`). `kitchen:` joined the cash + omr KNOWN_REASONS
(+ the omr burn term). **(2) ASSETS & RACKETS** (`src/economy.js`, `RACKET_EMPIRE` rules tail) — **RACKET
UPGRADES** (`character_rackets.level` 0..5, `upgradeRacket`, a per-racket income multiplier folded into
§7.1 accrual via `owned.racketLevels`; cash SINK `racket:upgrade` — a faucet-widen bounded by the daily
income cap + level cap, flagged), **THE TYCOON LEGEND** (`account_persistent.tycoon_earned` lifetime racket+
front income, bumped at the `racket:income` ledger site, survives death, `TYCOON_RANKS` +
`GET /v1/leaderboard/tycoons`), and **EMPIRE SETS** (own a full category → a pure-status title,
`empireTitles`). **(3) THE MEGAPROJECT** (`src/megaproject.js`) — **CATALOG 4→8** (Opera House 900M → the
Eternal Flame 12B, on-curve, zero-code — `megaMonumentAt` indexes), **THE BUILDER LEGEND**
(`account_persistent.monument_built` lifetime $-value laid, bumped in `credit` under the own locked account,
survives death, `BUILDER_RANKS` + `GET /v1/leaderboard/builders`), **THE FAMILY BUILD** (`gangs.monument_built`,
the family that put up the money, dies with the family, `GET /v1/leaderboard/family-build`), and **THE
ARCHITECT CROWN** (how many monuments a dynasty topped — READ-DERIVED from the skyline via `architectTally`,
so NO cross-account write under the megaprojects singleton lock → no deadlock surface). All status axes;
the contribution cash/goods/$OMR still rides the `megaproject:` sink. **(4) THE FIVE PILLARS** (`src/honor.js`,
`HONOR` rules tail; the honor pillar — the unifying reputation; Bloodline was already Tier-4-deep) — **THE
HONOR LEGEND** (`account_persistent.honor_peak/honor_low` the bloodline's high-water honor + deepest infamy,
bumped in `bumpHonor` under the caller's char lock, survives death — honor itself dies with the street +
echoes 25% to the heir), **THE REPUTATION BOARDS** (`GET /v1/leaderboard/honor` → menOfHonor + mostFeared),
and **THE LADDER 5→7** (Monster + The Untouchable at the extremes; the middle five unchanged so the DREADED
−60 / TRUSTED 60 teeth land on the same tiers). Each drop: schema → rules → module → routes → console →
tests → suite+sim → commit. Persist-clobber verified clean (every new direct-SQL column absent from the
persist positional UPDATEs); lock order acyclic (the megaproject gang-bump-under-singleton is cycle-free
since nothing locks gangs-then-megaprojects; the architect crown is read-derived; honor/legend bumps run
under the actor's own locked account). Suite 43/43 + sim drift-0. Deferred (flagged): the kitchen
distribution/corner network, a per-racket PvP shakedown (rackets feed the global lazy accrual, not a
per-instance clock — a rearchitecture), monument wings + completion district perks, and honor decay +
deeper diplomacy. All numbers are founder sign-off levers; the faucet-widening levers (racket upgrades,
the kitchen lab modules/cut) are sim-before-production flagged in BALANCE.md.

**TIER-3 → TIER-4 DEEPENING PROGRAM (founder-directed 2026-07-24: "build everything in the tier 3
system into tier 4") — ALL SIX BUILT** (red-team `AUDIT-tier3-deepening.md` — no CRITICAL/HIGH/MED;
BALANCE.md sign-off flags; §10.4 drift-0 + the 45-suite green after each drop). The six mid-depth
systems deepened to the depth bar (multiple orthogonal mechanics + a scaling catalog + a competitive/
meta layer + a SURVIVES-DEATH status legend on a new `/v1/leaderboard/*` + a console screen), all on
already-audited patterns. **(1) BUSINESS EMPIRE** (`src/business.js`) — THE LAUNDERER legend
(`account_persistent.laundered_lifetime`, bumped in launderAtBusiness), THE ACCOUNTANT front
specialization (`businesses.spec`, a `business:spec` $OMR burn halving scrutiny), the TYCOON fold-in
on collect, read-derived front-set titles, and THE HOSTILE TAKEOVER (`takeoverBusiness`, two-party —
a `business:takeover` fee SINK that burns win/lose + the audited taxed buyout transfer, `p`-pinned
roll knob, reset-to-new-owner handover). **(2) CONVOYS** (`src/convoy.js`) — THE TEAMSTER / THE
HIGHWAYMAN survives-death legends (`freight_delivered`/`freight_hijacked`, direct-SQL) + a
`convoy_hauls` weekly-contest log (worker-swept) + the read-derived Teamster/Road-Boss-of-the-Week +
`GET /v1/leaderboard/convoy`. **(3) THE COMMISSION** (`src/commission.js`) — THE STATESMAN legend
(`account_persistent.statecraft`, earned by vote/propose/veto/override + the post-commit ENACTED
prize), THE OVERRIDE (a seated FLOOR family musters `OVERRIDE_WEIGHT` 7 seat-weight to overrule the
head veto; `commission_overrides` table; settleProposals single-sourced through `activeDecree(week+1)`
so a vetoed-then-overridden motion enacts), THE RECORD (chamber history), + 3 new one-touchpoint
decrees (`smugglers_moon` port interdiction ×0.75, `open_roads` convoy arrival ×0.8, `blood_oath`
fire-kill CASH loot ×1.25 threaded into BOTH loot sites clamped ≤0.5). `GET /v1/leaderboard/statesmen`.
**(4) THE RESERVE BOND** (`src/bonds.js`) — THE PLEDGE (`pledgeTreasury`, a `bond:pledge` $OMR BURN +
a `pledged_omr` status score — NOT a reserve fund, so no unbacked extraction path), THE CHARTER
(`commissionCharter`, a sequential `bond:charter` $OMR seal), the read-derived Underwriters' League +
backer tiers + THE FINANCIER crown. **(5) THE STORE & THE LEDGER** (`src/store.js`/`src/pass.js`) —
THE BENEFACTOR legend (`patron_spent`), the PATRON ladder + prestige ranks, `pass_seasons`, the
benefactors board — all off the ETH-revenue rail (zero new §10.4 surface). **(6) THE ESTATE & AUCTION
HOUSE** (`src/estate.js`/`src/auction.js`) — THE COLLECTOR legend (`prestige_sunk`/`season_sunk`
direct-SQL bumpPrestige at every estate/auction sink, ranked + the PATRON OF THE SEASON read-crown),
PLAYER CONSIGNMENT (the flagship resale market — `auction_consignments`, a $OMR bidder→seller TRANSFER
with a house TAKE that burns; the batch's §10.4-riskiest change), read-derived COLLECTION SETS, and
catalog growth (a LEGENDARY weekly MARQUEE lot, 3 rare archetypes, the Palazzo tier-6, Gallery/
Observatory/Archivist). **§10.4 — the escrow extension (invariants.js):** `auctionEscrow` now spans
BOTH `auctions` + `auction_consignments` live bids; `omrBurns` gained EXACT `auction:take` +
`auction:consign:fee` matches (never a blanket `auction:%` — the trap that would misclassify the
bid/refund/consign transfers); the `auction escrow` check became `bids − refunds − wins − consign −
take`. `season_sunk` resets in `runSeasonRollover`'s per-char txn (gated `season<current`, the
duel-elo precedent). All ten new `account_persistent` legend columns are direct-SQL + NUMERIC +
ABSENT from `persistAccount`'s positional list (clobber-safe). **The combined red-team**
(`AUDIT-tier3-deepening.md`, six lenses, source-verified) returned **no CRITICAL/HIGH/MED** — the
consignment escrow is exact (proven mid-listing + post-settle in `test/auction.js`), the Bond pledge
touches no reserve (the flagged high-risk item is a non-issue), every legend survives death by
construction, and the touchpoints (blood_oath dual-site clamped, business-takeover `p`-pinned) are
sound. Founder sign-off flags (BALANCE.md, not defects): the `blood_oath` ×1.25 decree modifier on the
signed loot rate (clamped, the open_season precedent), the new net-deflationary consignment P2P $OMR
rail (collusion −EV by the take), and the Sybil-inflatable status boards (no payout — the hitman-rep
posture). Suite 45/45 + sim drift-0. All Tier-4 numbers are founder sign-off levers.

**TRANSPORT DEPTH — Tier C: ROUTE NOTORIETY + THE SMUGGLER'S REPUTATION — BUILT** (`omerta-transport-depth-design.md`
Tier C; `src/notoriety.js` — a shared helper module, `route_notoriety` table, the `NOTORIETY` rules block +
`haulerTierOf`/`smugglerTierOf`/`notorietyNow`/`smuggleRepPerks`; `test/port.js`/`test/convoy.js`). Answers the
tester's "transport farming is repetitive" — the trade-goods/convoy/port loops resolved to a single optimal lane
you then farmed. Now **running the SAME lane HEATS it** (a per-`(character, lane)` heat, the business-scrutiny
pattern: `GAIN` 8/run, decays `DECAY_PER_HR` 4 toward 0, capped `MAX` 40) — pushing route variety.
**EMISSION-SAFE by construction:** on the PORT the heat only RAISES interdiction (`+p` capped at `PORT_P_CAP` 0.16 →
FEWER clean landings → LESS emission; bumped at `launchRun`, applied at `collectRun`, re-clamped to the signed
`INTERDICT_MAX`); on CONVOYS it only LOWERS the shipper's own guard defense (`−def` capped at `CONVOY_DEF_CAP` 24,
baked into `convoys.guards` at `departConvoy` so an ambush's def calc reads it — bandits case a farmed lane; an
ambush is a pure ownership TRANSFER, not a §10.4 faucet, so only WHO holds the same bounded haul changes). Lane
keys: `port:<routeId>` / `convoy:<origin>:<dest>` (a directional land lane). **THE SMUGGLER'S REPUTATION** — the
existing Teamster (`freight_delivered`) / Smuggler (`smuggled`) LEGENDS (pure status until now) grant, off the rank
TIER (the Underworld-tier status→access precedent): **T1** (≥$250k) your lanes cool 2× faster (`REP_DECAY_MULT`);
**T2** (≥$2M) the docks/destination toll is HALVED (`REP_TOLL_MULT` — a §10.4-neutral TRANSFER discount, the
convoy/harbormaster `port:toll`/`convoy:toll` row is just smaller, the treasury receives less, nothing created);
**T3** (≥$10M) low profile — your lanes heat half as fast (`REP_GAIN_MULT`). So reputation MANAGES the very
notoriety the mechanic adds — a self-referential progression. **§10.4: ZERO new reason/bucket/faucet** — the only
value-touching change is the toll DISCOUNT (a smaller existing transfer); notoriety is a pure risk/ownership
surface. `route_notoriety` DIES WITH THE STREET (joined the runEstate wipe + the migrate DISPOSITION map — the
heir runs clean lanes). NO new player routes — it's all folded into `depart`/`run`/`collect` + board surfacing:
`GET /v1/port` gains per-route `notoriety`/`hot` + a `reputation` block; `GET /v1/convoys` gains `mine.notoriety`/
`guardCut` + `reputation`; `/v1/rules` a `smuggling` block. Console: a Sea Lanes card + HOT LANE chips in the
route picker (Port), a lane-heat chip on the active shipment + a reputation line (Big Scores). `test/port.js`
proves a run heats the lane + the board surfaces it + hammering climbs it + a cold lane stays cold + the interdiction
rises above the floor + rep T2 halves the docks toll; `test/convoy.js` proves a cold first depart (no cut) → a hot
second depart (reduced stored guards) → climbing → a fresh lane cold + rep T2 halves the destination toll + the
board reputation/lane-heat surface + the discounted `convoy:toll` transfer reconciles the gang-treasuries §10.4
check. All `NOTORIETY.*` numbers are founder sign-off levers (risk/status modifiers, off every signed faucet curve —
the toll discount reduces family toll income, flagged). Deferred (Tier A/B, founder call): the surface hot-markets
board + daily directed orders (Tier A), and the per-run seed-drawn EVENT + pre-committed choice (Tier B).

**REFERRAL + X-RECRUITMENT FIXES (founder-directed "fix the referral and Twitter recruitment system")** —
an inventory pass (Explore agent) over §7.13 referrals + Spread-the-Word + THE BROADCAST + X OAuth surfaced
five real bugs/gaps behind the mature, audited machinery; all fixed + regression-tested (suite 45/45 + sim
drift-0). **HIGH — Spread-the-Word was silently DEAD in production**: the console posted the claim with an
EMPTY body (no post link), so in the production-mandated `SOCIAL_VERIFY_MODE=live` the matured claim called
`verifyPostUp(null)` → `need_proof` and NOBODY was ever paid (untested — the suite only ran `trust`). And
the D2 author-binding (`not_your_post`, bind the tweet to the player's linked X handle) was DEAD CODE off the
real path — `claimSocial` called `verifyPostUp` with no `ctx`. **Fixed**: the client now captures the tweet
URL (a `sw-proof` input on the register/collect card) and sends `{proof}`; `growth.js:claimSocial` passes
`{client, accountId}` so author-binding activates on the real path. `test/growth.js` proves it with a
stubbed X API: a proof-less share can never pay (`need_proof`), a matured post from the linked X account
pays, and registering a celebrity's tweet earns `not_your_post`. **MED — attribution leak**: the
Spread-the-Word share URLs carried the bare domain (recruit had to TYPE the code) while THE BROADCAST used
the auto-crediting `/u/<name>?ref=<name>` deep link; `socialShareUrl` now emits the frictionless `?ref`
link (a tapped daily-task tweet auto-credits the sharer, feeding the §7.13 loop). **MED — lost tier-2 fee**:
`maybeGrandReferral` fires ONCE from the post-commit hook, so a grandrecruiter with no living street at the
qualifying instant lost the "family tree" fee forever; new worker `sweepGrandReferrals` reconciles it
idempotently (pays the moment they have a living heir — a regression proves the dead-at-qualify → sweep-pays
→ once path). **LOW — First-Week links**: `ob_x`/discord/repo pointed at bare `x.com`/`discord.com`/
`github.com` homepages; new `SOCIAL_LINKS` (rules.js) resolves `ob_x` to the OMERTÀ handle (discord/repo
deploy-configurable via `SOCIAL_DISCORD_URL`/`GITHUB_REPO`). **LOW — housekeeping**: `sweepSocialClaims`
worker sweep drops spent `social_claims` rows (paid > 7d, unpaid > the 48h pending TTL). Accepted as-is
(env-gated-dormant, working-as-designed, or deferred): X OAuth PKCE (fail-safe until `X_CLIENT_ID`+
`PUBLIC_URL`), the paste-token X path (already demoted to a collapsed "Developers only" affordance with a
clear FAQ), `ob_repo` GitHub-star (needs a linked GitHub login — a deferred client feature), the recruitment
DRIVE (mod-armed), and the broadcast beacon's unused `wanted`/`whacked` kinds. All numbers unchanged
(§10.4-untouched — the fixes are plumbing/attribution/reconcile, no new faucet).

**THE FIRST-WEEK GITHUB STAR — RETIRED** (founder-directed "Remove the GitHub Star"). The `ob_repo`
"Star the repo" First-Week onboarding task (never live — `verify.js` rejected it as an unbuilt
"needs a linked GitHub login" stub) is removed: dropped from `ONBOARD_TASKS` + `SOCIAL_LINKS`
(`rules.js`), its live-mode branch deleted from `verify.js`, and its First-Week board total dropped
9→8 with `ob_discord` now the capstone claim (`test/growth.js` updated). Pure removal of dead onboarding
surface — zero §10.4, no gameplay change.

**UI/UX "THE CITY BREATHES" — a max-effort ALIVE pass** (`public/index.html`; founder-directed
"TUNE UP THE UI / UX DESIGN FOR THE ENTIRE GAME. MAX EFFORT. Make the game feel more alive"). A
client-only atmosphere + state-reactivity layer — zero backend, zero §10.4, zero new deps (the
single static file stays CSP-safe/self-contained). Everything is transform/opacity-only (GPU-cheap),
pauses when the tab is hidden (`body.paused`, battery), and DIES COMPLETELY under
`prefers-reduced-motion` (a `#atmo { display:none }` killswitch inside the existing media query +
the `REDUCED` guard on the money count-up). **(1) THE ATMOSPHERE LAYER** — a fixed `#atmo` behind all
content (`z-index:0`, `contain:strict`, `pointer-events:none`): an inline-SVG `feTurbulence` FILM GRAIN
(4% opacity, a 5-step jitter), a slow NEON FOG (two soft radial glows drifting on a 30s breath), and a
MOOD RING (edge box-shadow). **(2) STATE-REACTIVE MOOD** — `renderSheet` reads the live `me` and stamps
`body[data-mood]`: **danger** (wanted/welsher/indicted/rat/jailed/health≤25) → a red edge-glow that
BREATHES (`moodPulse`), **safe** (safehoused) → a cool blue glow; plus `body[data-tod]` from the in-game
city hour (night/dawn/day/dusk falls back to the wall clock) tinting the fog. **(3) LIVING VITALS** —
`bar()` now flags a critically-low vital (`<25%` → `.bar.low`, a red-gradient THROB) and a hot heat
(`≥60%` → `.bar.hot` glow); every fill gets a slow sheen sliding across it. **(4) MONEY COUNT-UP** —
`countUp()` fills the pocket figure with an eased tween on change (paired with the existing tick flash +
toast haptic; instant under reduced-motion). **(5) LIVING DETAILS** — a breathing masthead title
(`titleBreath`), a HEARTBEAT on the live WS dot (`#ws-dot.live`, added on `onopen` / dropped on
`onclose`), and a one-shot NEON WASH down a fresh feed line (`.ev.fresh`, dropped after 1.6s so
re-renders don't re-flash). Screenshot-verified in Chromium (main + a forced danger/night state: the
health bar goes red-throb, the money counts to $1.28M, layout intact, zero page errors). Client script
parses clean; suite untouched (UI-only). Deferred: nothing — the pass is a self-contained polish layer.

**CRITICAL-READ REVIEW — stakes/spine/economy (founder-directed "address all of these") — MEASURE +
BUILD + PROPOSE.** A structural read of the whole game after the content-accretion phase surfaced seven
gaps; the response split by ground rule #1 into diagnostic MEASUREMENT, additive §10.4-free BUILDS, and
founder-gated PROPOSALS (never a unilateral retune of signed numbers). **MEASURED (#1 — the headline):**
`tools/sim.js` gained **P9.20 THE PASSIVE STACK** — the prior probes measure faucets one at a time, but
the passive earners DON'T compete for energy (the active-loop bound), so P9.20 sums what a single maxed
operator collects in parallel. Result (analytic, from the signed constants, sweep still drift-0): the
**5-front personal business stack is $48.96M/day NET** (gross $61.2M − the 20% pad, ~$110M to build,
**~2.2-day payback**), **ENERGY-FREE from 5 collect clicks**, ~6× the top-tier crime grind ($7.9M/day,
~200 energy-bounded attempts); territory adds ~$20.9M/day per district (family-side, up to 6). §10.4 is
CLEAN (every front is a ledgered faucet) — this is a **balance dial** (the front `incomePerHr` curve),
not a leak. `omerta-stakes-and-spine-review.md` is the founder decision sheet: **#1** the passive stack
(levers L1a flatten the top-tier curve / L1b wealth-scaled pad / L1c income cap / L1d territory), **#2**
death costs nothing for the established (~35 tables wiped vs 25+ account-level legends + portfolio/estate/
dynasty/marriages/honor-echo/collection survive → lever L2a an **inheritance/estate death-tax**), **#3**
PvP is −EV (−$72k standalone) AND has EIGHT untouchable states → **the keystone L3a: make passive wealth
PvP-LOSABLE** (the territory-seizure precedent extended to personal fronts), which converges #1/#2/#3 into
one fix, and **#6** breadth ≫ depth (D6a deepen the crime verb / D6b embrace the collection game). All
proposals are levers for Jorge to accept/decline — NOT applied. **BUILT (#4 — the spine):** `src/standing.js`
+ `GET /v1/leaderboard/city` — **THE CITY STANDING**, one aggregate "who's winning" metric over the 35
scattered leaderboards. Six PILLARS (Blood/Empire/Power/Legit/Hustle/Honor), each summing its
account-level survives-death legends then scored LOG-SHARE vs the population max (so BREADTH across pillars
beats maxing one axis, and a linear whale can't swamp the board); City Standing = the sum (0–600),
RELATIVE + recomputed on every read, nothing stored. PURE STATUS — read-only SELECTs over
`account_persistent`, **ZERO §10.4** (no currency/faucet/ledger — the hitman-rep/portfolio-board
precedent); agents + banned excluded. `myStanding` gives a player their own score + pillar breakdown + real
rank; the console Start Here tab now LEADS with a City Standing card (your score + pillar bars + the top of
the board) so the endgame finally has a single legible goal. `test/standing.js` (the 44th suite) proves the
board rank order, breadth>depth, the pillar breakdown, agent+banned exclusion, the personal rank, and a
no-legend account reading 0-but-ranked. Suite 44/44 + sim drift-0. (#5 free-path legibility + #7 consistency
snags: in progress.)

**THE SACKING (L3a — the review's keystone lever, founder-directed "L3a first") — BUILT** (`src/social.js`,
`src/rules.js` `M3.SACK_ON_KILL`, `test/sacking.js` — the 45th suite). The stakes/spine review found #1
(too much safe passive wealth), #2 (death costs the established nothing), and #3 (PvP is −EV with eight
opt-outs) are ONE problem — a safe idle-collector with no threat model — and that making passive wealth
**PvP-LOSABLE** fixes all three. THE SACKING does exactly that: a PLAYER fire-kill (never NPC/mod — the
whack:loot precedent) lets the killer **SEIZE one of the victim's business fronts** (the $49M/day-stack
endgame income engine measured in P9.20) instead of it dying with the street. `sackEmpire` picks the MOST
VALUABLE front the killer can actually HOLD — level ≥ the front's `lvl` gate AND an empty kind slot
(`UNIQUE(character_id,kind)`; the frontier-B1 "hold only what you could run" rule) — and transfers it
(`businesses.character_id` → killer) with clocks/scrutiny reset (the takeover `resetFrontToNewOwner`
precedent; pending forfeits — the territory-seize precedent). If the killer can hold NONE of the victim's
fronts, nothing extra happens (the empire dies with the street as normal). Runs in the loot block BEFORE
runEstate's `DELETE businesses WHERE character_id=victim`, so the seized front (now killer-owned) survives
the wipe while the rest die. **§10.4-NEUTRAL by construction** — a front is an ownership object, NOT a
§10.4 currency (no business-conservation check; the gear/contraband-loot precedent), so the seize writes
ZERO ledger rows and the sim stays drift-0; `test/sacking.js` proves it via a stable-bucket (cash/$OMR/
cars/cb) drift-delta across the sacking-kill (every real kill flow is a ledgered transfer/burn; the seize
adds nothing). Now the passive empire is genuine RISK CAPITAL and the kill economy has a prize worth far
more than the ammo — the rich must defend (a safehouse/bodyguard — sinks) or fight for their fronts.
Response `empireLoot {kind, tier, name}` + a `sacked` notify + a streets `sacked` event; the console kill
toast reads "🏢 TOOK OVER their Casino" and the Empire tab now leads with a "⚠ YOUR EMPIRE IS RISK CAPITAL"
warning. `test/sacking.js` covers the seize (most-valuable holdable front survives the wipe, the rest die,
clocks reset), the occupied-slot gate (killer already runs that kind → no seize), the level gate (a rookie
can't hold a casino front → no seize), and §10.4-neutrality on every path. Suite 45/45 + sim drift-0.
`M3.SACK_ON_KILL` (default on) is a founder sign-off lever — flagged in BALANCE.md to sim the
wealth-concentration effect (a seized front is a zero-sum transfer between players, no new base-wide
emission, but it concentrates the passive stack in fewer hands) before production. Deferred (the review's
other #3 levers, founder call): L3b (cap the eight untouchable states — mutually-exclusive shields / a
max-uptime) and L3c (a cheaper contracted-kill ammo floor). #7 consistency snags done; the review's #1/#2
economy levers (L1a/L1b flatten the front curve + progressive pad; L2a the death/estate tax) remain
founder picks.

**THE SHIELDS (L3b + L3c — the review's #3 remainder, founder-directed "build them all out") — BUILT**
(`src/social.js`, `src/rules.js`, `src/game.js`, `schema.sql`, `src/invariants.js`, `test/shields.js` —
the 46th suite). The stakes/spine review's #3 (PvP is −EV AND has eight opt-outs) had three levers; L3a
(the Sacking) shipped the prize, these two close the loop. **L3b — THE SHIELD CAP**: the safehouse is now
a rolling-window token bucket (`M3.SAFEHOUSE_DAILY_CAP_MS` 12h/day — the D3 wash-cap twin, new
`characters.safehouse_used`/`safehouse_at`): entering charges the granted stay against the bucket BEFORE
the cash spend, so with a 4h stay three stays fill it and the fourth is refused (`safe_cap`) — a whale
can't live permanently off-grid, the rich must surface (closes "eight untouchable states"). §10.4-untouched
(a gate on the existing `safehouse` cash sink — moves no value). `safeCapSeconds` surfaced on the view +
a "daily allowance left" line on the console defense card; the two columns joined `persistCharacter` ($62/
$63). **L3c — THE CONTRACT'S BULLETS**: ammo is the −EV driver on a hit, so a `fire` kill that fulfils a
PAID contract (any pool/directed/family/WANTED bounty → `bounty > 0` from `claimBounty`) rebates
`M3.CONTRACT_AMMO_REBATE` (0.5) of the rounds spent — a bounded, ledgered ammo FAUCET (`contract:rebate`,
added to the ammo §10.4 vocabulary in `invariants.js`) — so the pot no longer carries the whole ammo loss
and a smaller contract turns a hit +EV; a STANDALONE kill pays no rebate (the −$72k standalone EV / the D1
anchor is untouched). The kill toast reads "the contract covered N rounds". `test/shields.js` proves the
cap (3 stays allowed, the 4th refused, the board bucket drained vs a fresh face's full allowance) and the
rebate (a paid kill returns exactly `floor(rounds×0.5)` as a ledgered `contract:rebate` row; a standalone
kill pays none). Suite 46/46 + sim drift-0 (the rebate faucet reconciles). Both are founder sign-off levers
(BALANCE.md — sim the contract break-even shift; `SAFEHOUSE_DAILY_CAP_MS`/`CONTRACT_AMMO_REBATE` = 0
disable each). **The review's #3 is now fully addressed** (L3a Sacking + L3b Shield Cap + L3c Contract's
Bullets); the remaining founder picks are the #1/#2 economy levers (L1a/L1b front-curve flatten + progressive
pad; L2a the death/estate tax) and #6 (D6a deepen crime / D6b embrace the collection game).

**THE L1/L2 ECONOMY BALANCE PACKAGE (stakes/spine review #1 + #2, founder-directed "Balance the economy")
— BUILT** (`src/rules.js`, `src/business.js`, `src/social.js`, `src/server.js`, `src/invariants.js`,
`tools/sim.js` P9.20; the review's economy remainder after L3a/b/c shipped the PvP-stakes fixes). The
founder's "Balance the economy" pick IS the sign-off for these signed levers (ground rule #1's
don't-unilaterally-retune is overridden by the explicit direction). **L1a — FLATTEN THE APEX FRONT CURVE:**
the two endgame personal fronts (`hotel` lvl42 / `casino` lvl58) had `incomePerHr` HALVED at every tier in
the `BUSINESSES` catalog (the casino alone was $36M/day gross); the on-ramp fronts (laundromat/restaurant/
nightclub) are UNTOUCHED so a new player is unaffected — only the top of the curve is trimmed, every front
still a ledgered `business:income` faucet (§10.4 drift-0). **L1b — THE PROGRESSIVE PAD:**
`CONSTANTS.BUSINESS_UPKEEP_PROG_BPS` (500 = +5%) is added per EXTRA front owned (`business.js:upkeepBps(count)`
threaded through `upkeepOwed` + the empire view + the P9.20 probe), so a 1-front operator pays the base 20%
pad and a full 5-front stack pays 40% — the 5th front costs twice the 1st to run, so stacking every kind has
diminishing returns; still a ledgered `business:upkeep` sink (§10.4 untouched). **L2a — THE DEATH DUTY:**
every death (`runEstate`) burns `M3.DEATH_DUTY_RATE` (25%) of the heir's inherited **LIQUID $OMR** — a §10.4
`death:duty` $OMR BURN (joined the omr `KNOWN_REASONS` + `omrBurns`), applied AFTER the P1.1 loot (killer's
cut first, then the estate taxes the remainder). **Staked $OMR, the RWA portfolio/vault, and the Estate are
UNTOUCHED** (the "go legit / retire in safe harbours" pitch stays intact — the duty bites only the
extractable, un-committed hoard), so dying finally costs the bloodline something without touching the wealth
it was told is safe. A respawn-token save skips the estate → no duty. Runs on all five death paths: fire/
shank/npc-hit persist via the wrapped `persistAccount`; the two HAND-ROLLED headless persists (`server.js`
mod-kill + `social.js` `huntWanted` NPC-hunter, which wrote only `prestige`/`deaths`) now also carry the
`omr` decrement — else the death:duty ledger row drifts §10.4 on those paths (the bug the portfolio test
caught). **Measured (P9.20, drift-0):** the personal 5-front stack drops **~$48.96M/day → $21.6M/day NET**
(L1a halves the gross to $36M, L1b's 40% progressive pad keeps 60%) → a firm **2.27× cut** to the stack;
the passive:active ratio (vs the sim's floating grind baseline) lands **~2–3.5×**, down from ~6×: a maxed
empire still out-earns the grind (as it should) but no longer dwarfs it. Tests:
`test/economy.js` (L1b upkeep view/pay unchanged — no hardcoded apex income), `test/social.js` (the heir
keeps 7→6 after loot→5 after the 25% duty). Remaining founder dials (NOT applied): the full front
`incomePerHr` curve (L1a touched only the apex two kinds), a global personal-income cap (L1c), the family-
side territory stack (L1d), and legend-decay/succession-friction (L2b/L2c). Suite 46/46 + sim drift-0. All
numbers (`DEATH_DUTY_RATE`, `BUSINESS_UPKEEP_PROG_BPS`, the halved apex incomes) are founder sign-off levers
(BALANCE.md).

**THE APPROACH — deepening the core crime verb (stakes/spine review #6 / D6a) — BUILT** (`src/rules.js`
`M3.CRIME_APPROACHES`, `src/game.js` `doCrime`, `src/server.js`, `public/index.html`, `test/smoke.js`;
the review's last open finding). The core crime loop was one click + RNG; every job now takes a per-job
risk/reward CHOICE — **Case It** (quiet: successMult 1.12 / payMult 0.89, no heat, jailMult 0.8 — the safe
play when you're near a RICO indictment or can't afford lockup), **Standard** (the signed baseline), or
**Go Loud** (successMult 0.82 / payMult 1.22, crateMult 1.6 / makingsMult 1.5, repMult 1.15, +6 law heat on
the attempt, jailMult 1.4 — a bigger single score + more materials, but it draws the Law and a harder bust).
**The CASH faucet is EV-NEUTRAL by construction** (`payMult ≈ 1/successMult`), so the sim-signed §7.2 crime
cash curve is UNTOUCHED — and an omitted/unknown approach resolves to `standard`, byte-identical to the old
one-click behaviour (the sim measures standard → drift-0; every existing crime test/harness passes unchanged).
The decision bites on the SECONDARY axes (variance, contraband/makings, rep, heat, bust severity) and teaches
the Law/RICO interaction — going loud is how a new player *feels* the heat system in the entry loop.
`POST /v1/crimes/:id {approach}` (threaded through the existing route); `/v1/rules.crimeApproaches` surfaces
the three-way picker; the console Streets tab renders **case it / do it / go loud** buttons per job (loud in
a warning color) + `describe()` humanizes 🤫/🔊/BUSTED-went-loud. `M3.CRIME_APPROACHES` lives with the other
stakes/spine levers (SACK_ON_KILL / DEATH_DUTY_RATE / SAFEHOUSE_DAILY_CAP_MS / CONTRACT_AMMO_REBATE);
`CRIME_LOUD_CASH_PREMIUM` (default 1.0 = EV-neutral) is the dial if Go Loud should pay a real cash premium
(>1 = a faucet change → its own sign-off). §10.4-clean (the take rides the same `crime:<id>` faucet,
ledgered==credited; the cb crate shift stays fully ledgered so conservation holds). `test/smoke.js` proves
the three approaches surface on `/v1/rules`, a loud job draws the exact law heat, an unknown approach falls
back to standard (no 400) and adds no heat, and the response echoes the chosen approach. Suite 46/46 + sim
drift-0. The materials/rep/heat/jail shifts are founder sign-off levers (BALANCE.md — sim the loud cb/makings
emission delta, bounded by nerve + bust risk + heat, before production). **This closes the stakes/spine
review** (#1 economy, #2 death, #3 PvP stakes, #4 the City Standing spine, #5 legibility, #6 the crime verb,
#7 consistency — all addressed); D6b (the game is largely an idle/collection economy) remains the honest
framing, so the endgame collect/bet verbs stay idle-shaped by design.

**D6a step two — THE MESSAGE + THE PLAY (the other two entry verbs) — BUILT** (`src/rules.js`
`M3.JUMP_INTENTS` + `M4.DEAL_PLAYS`, `src/social.js` `jump`, `src/kitchen.js` `deal`, `src/server.js`,
`public/index.html`, `test/social.js`, `test/growth.js`). THE APPROACH proved the pattern on crime; the
game's other two shallow entry verbs (a mugging and a corner sale — both one click + a roll) now carry
real decisions too, each with its OWN thematic axis rather than a copy of the crime picker. Both keep
the discipline that made THE APPROACH safe: **`standard` is the identity**, so an omitted/unknown
choice is byte-identical to the pre-choice behaviour (every existing harness passes unchanged), and
**neither touches a signed CASH curve**. **(1) JUMP → THE MESSAGE** (`POST /v1/streets/:id/jump
{intent}`): what you came for — money or reputation. *Roll Them* (stealMult 1.35 / repMult 0.6 /
dmgMult 0.7 / hospMult 0.7) takes a bigger cut but nobody's impressed; *Send a Message* (stealMult 0.4 /
repMult 1.5 / dmgMult 1.4 / hospMult 1.5 / +5 law heat) is big respect + a real beating, but you're not
there to rob them and the Law hears about it. **§10.4-free**: the steal is a pure zero-sum TRANSFER
(`jump:steal`/`jump:stolen`, still `JUMP_STEAL_CAP`-bounded — scaling it moves who holds the cash, never
creates any), rep is status, damage/hospital is pacing, heat is a Law lever. Built-in self-limiter: the
hospital is PROTECTION here, so `message`'s longer stay shields the mark **from you** too. **(2) DEAL →
THE PLAY** (`POST /v1/kitchen/deal {play}`): how you move it — deliberately **NOT** a price axis, because
the §7.10 deal cash curve is sim-audited and ground rule #1 stands, so **the cash paid is IDENTICAL on
every play** (a regression asserts `careful.earned == standard.earned == flood.earned`). What you trade
is THROUGHPUT against THE LAW: *careful* (heatMult 0.5 / nerveMult 2.0 / repMult 1.10) works your
regulars — half the heat, but nerve is the corner's real throttle so patience costs you volume; *flood*
(heatMult 2.0 / nerveMult 0.5 / repMult 0.90) moves weight fast but doubles the heat feeding the RICO
meter + the Bureau's kitchen raid, and churn burns your name (the `repMult` is arranged so the fast play
can only SLOW rank progression, never accelerate access to the rank price bonus). `/v1/rules` gained
`jumpIntents` + `dealPlays`; the console Wet Work roster renders roll-them / jump / send-a-message and
the Kitchen corner renders quiet / deal / move-weight; `describe()` humanizes both. `test/social.js`
proves the intents surface, a stick-up draws no heat, a message takes less cash + more rep + the exact
heat + a longer lay-up, and an unknown intent falls back to standard; `test/growth.js` proves the plays
surface, **the cash is identical across all three**, the heat/nerve tradeoffs both directions, that
flooding builds less of a name, and the unknown-play fallback. Suite 46/46 + sim drift-0. All
`JUMP_INTENTS`/`DEAL_PLAYS` numbers are founder sign-off levers (BALANCE.md). **All three entry verbs
now carry a real decision** — the review's #6/D6a is complete in both steps.

**RED-TEAM over the stakes/spine session (`AUDIT-stakes-spine-session.md`)** — a focused four-lens pass
(§10.4/economy, concurrency/locks/persist-clobber, death/estate/PvP, exploit/grief/Sybil) over the nine
drops built after the review doc was written and never adversarially checked (L3a Sacking, L3b Shield Cap,
L3c Contract's Bullets, L2a Death Duty, L1a/L1b economy, THE APPROACH/MESSAGE/PLAY, City Standing). Every
finding re-verified against source before any change. **No CRITICAL, no HIGH.** Fixed in-commit
(regression added): **F1 (MED)** — a seized business front claimed den rakeback on the **entire lifetime**
den volume. `buyBusiness` stamps `rake_cursor` at today's volume precisely so "a new owner earns against
future action, not history", but BOTH ownership-transfer sites set it to `0`: `social.js:sackEmpire` (this
session) and `business.js:resetFrontToNewOwner` (pre-existing Tier-3 takeover, whose reset block sackEmpire
had copied). Not a mint and no §10.4 drift (every payout is `denAvailable()`-capped at realized profit and
`casino:rakeback` is ledgered), but a **queue-jump that drains the shared profit-bounded rakeback pool**
ahead of every honest casino-front owner. Both sites now stamp the current den volume (read in JS, passed
as a param — pg-mem-safe); `test/economy.js` seeds a $5M lifetime volume before the hostile takeover and
asserts the seized front's cursor is the volume, not 0. **Verified CLEAN:** the L1b pad is per-owner (all
`businesses` reads are `character_id`-scoped and both `upkeepOwed(row,count)` callers pass `rows.length`);
death-duty persist coverage is complete across all five `runEstate` sites (`worker.js:210` checked — a
season conversion, not a death); the sack runs before the estate wipe with both character rows locked; the
L3c ammo rebate is provably net-negative (`fired` is ammo-gated and fully consumed, rebate is half); the
shield-cap bucket charges before the cash spend and persists; and all three verb axes are §10.4-clean with
`standard` proven to be the exact identity. Flagged for founder sign-off (NOT patched): the death duty
spares `unbonding` $OMR while the sibling P1.1 loot takes it (a narrow inconsistency; fixing it *raises*
what death costs → a signed-lever change), "jump-to-shield" being 50% more effective under THE MESSAGE
(design-consistent with the signed "hospital = protection" rule), and THE MESSAGE's rep being rate-neutral
per-mark but ~1.5× per-energy across many marks (paid for in law heat). Process note: sackEmpire
reproduced F1 by copying a column list instead of calling the helper — the two reset blocks should be
collapsed into one exported helper next time either is touched. Suite 46/46 + sim drift-0.

**THE FINAL SWEEP — every open flagged item resolved (founder-directed 2026-07-24: "Do what you recommend
for all 3 / bring up a list of all not patched items and apply your game balancing recommendations to
all").** Two passes. **(1) The three AUDIT-stakes-spine-session flags**: the **DEATH DUTY** now taxes
liquid **+ unbonding** $OMR (the exact base the sibling P1.1 `whack:loot` uses — dying inside the 6h
unbond window had sheltered the whole hoard; both hand-rolled headless persists carry `unbonding` or the
burn drifts §10.4), and **THE MESSAGE gained `energyMult` 1.5** (`M3.JUMP_INTENTS`) — one change closing
BOTH remaining flags, since rep ×1.5 with hospital ×1.5 was rate-neutral per mark-clock but a straight
1.5× rep-per-ENERGY lever AND a 1.5×-better ally-shield; charging 1.5× energy restores neutrality on both
axes, so the intent buys CONCENTRATION + damage paid in law heat, never a free multiplier. **(2) The full
sweep** over `BALANCE.md`, `SIGN-OFF.md` and all 56 `AUDIT-*.md` reports: every open item is now APPLIED,
ACCEPTED (recorded as a decision), or filed to the legal/chain track — the complete ranked ledger is
**`SIGN-OFF.md` § FINAL SWEEP**, the moved numbers are the **`BALANCE.md` § FINAL SWEEP** table. Applied:
`PORT.ROUTES.deeprun.sell` 1900→**2700** (the trap route — realized/day is `cap × [(m−1)·P(clean) −
1.5·P(caught)]`, so the audit's own "~$2,400" still lost to Open Water; ×3.0 → ~$380k/day vs $303k),
`STABLE.STABLE_MAX` 4→**3** (Boxing parity — identical bounded-purse mechanic), Gold Rush `tradeSellMult`
1.05→**1.03** (back under the 4% round-trip fee wall), `LOAN.HOUSE_MIN_LVL` 3→**10** (the loan-house death
cycle), new **`M3.LOOT_MIN_LVL` 10** (a fire-kill loots NOTHING off a rookie — closes the disposable-alt
value funnel; the estate still runs, D1 whale-hunting untouched), new **`PEN.PROTECTION_NW_BPS` 50**
(wealth-scaled yard-boss cover; the riot's protMult stays a designed sub-floor discount) + **`PEN.SHANK_CD_MS`
30min** per attacker (`PEN_SHANK_CD_MS` test knob, `characters.shank_at` direct-SQL), the safehouse floor
re-asserted AFTER the season mult (both `enterSafehouse` and the view quote — a future sub-1 season can't
breach the signed $25k), `duel_wins` now needs a NEW opponent bloodline each day (`prior === 0`, reusing the
ELO K-decay's pair/day counter — the level floor bounded WHO, this bounds HOW OFTEN), the crew-sale Bureau
raid reads **clamped** heat (S1 parity, player-favourable), `upgradeRacket` resolves a pending crackdown
before banking the pending take (the speakeasy precedent), safehouse gates on `fenceLoot` + `buyPaper`, the
megaproject goods rail floored at `MIN_CASH`, `claimVaulted` **minted-only** (rwa-float #2 — the Wage D1
Sybil precedent + R3 dead-allocation), and TERRITORY_TYPES descriptions now state each type's collection
cadence (Numbers lazy-dominates — the fix is an informed choice, NOT a curve retune). Accepted-as-designed
(now decisions, not to-dos): the megaproject plaque stays agent-inclusive (it's BOUGHT with burned value,
unlike the free-to-farm status boards), jump-to-shield (hospital = protection is signed; A2 removed the
amplification), the secrets pressure mechanics, status-board Sybil inflation (no payout attaches — the
hitman-rep posture), estate staff walking, the Commission levy/proposal leverage, ring-poker soft play, and
the whole previously-WATCHed Tier 5. Left on the separate track: the third-party contract+signer audit and
legal counsel (`forge test` is GREEN 73/73 since 2026-07-23, so gate 1 is closed), and the RWA float's
stale-oracle free option (#1 — the single most important economics decision before the real buy bot ships).
Regressions per fix across social/pen/portfolio/seasons. All moved numbers remain founder sign-off levers.

**THE PACING PASS — "level 240 in two hours" (founder-directed 2026-07-24, from live alpha).** An alpha
tester hit **level 240 in a couple of hours**. Measured, not guessed — one chain, not a broadly-fast
curve: **(1)** `train` had NO cooldown and no cash cost (10 energy vs a 40/min regen = ~240 sessions/hr),
so every mission STAT gate (up to 155 in three stats) fell in one sitting; **(2)** MISSIONS had no
cooldown and the ladder **SELF-UNLOCKS** — from ~m6 each reward overshoots the NEXT mission's level gate
by 30–100 levels; **(3)** the ladder pays **239,200 respect** and `levelOf` needed only 228,484 for L240,
so **the mission chain alone was levels 1→245** (the best sustained crime grind is ~3,257 respect/hr —
the ladder handed over ~3 days of grinding in one sitting). Fixed with a single **`PACING` block**
(`src/rules.js`) holding every dial: **`LEVEL_DIVISOR` 4→10** (respect(L)=D×(L−1)², so every level costs
2.5× more — `levelOf` lives in the AUTO-GENERATED section and now reads it, a deliberate founder override
of the prototype's `/4` like the D5 bank taper; **re-apply that one line after any extract-rules run**),
**`ENERGY_REGEN_PER_MIN` 40→12 / `_RANK_BONUS` 20→4 / `NERVE_REGEN_PER_MIN` 20→6** (the master clock — a
tank refilled in ~75s and paced nothing; now ~15-20 min, so you play in bursts), **`MISSION_CD_MS` 4h** +
**`MISSION_RESPECT_MULT` 0.25** (the ladder can't cascade — 28 jobs ≈ 4.7 days minimum — and is worth a
level ~78 character instead of the whole game; **cash/$OMR/titles UNTOUCHED**, the story still pays), and
**`TRAIN_CD_MS` 3 min** (~240→~20 sessions/hr; the ~500 sessions the top gates need is now ~25h). New
direct-SQL columns `characters.train_at`/`mission_at` (outside persistCharacter's positional UPDATE — the
active_at pattern), surfaced as `trainSeconds`/`missionSeconds` on the view + live timers in the console
(the gym button disables with "gym reopens in…", the mission button reads "next job in…") + a public
`rules.pacing` block. **Measured: 2 hours of play now reaches level ~11 (was 245); level 40 ≈ 16-28h,
level 100 ≈ 100-180h, level 240 ≈ 600-1,000h.** §10.4 untouched (no value moves — this changes how fast a
player may act and what a level costs). Test fallout was handled by a **provably level-preserving**
transform: every seeded `respect=N` in the suites/sim scaled ×2.5 (since `2.5r/10 == r/4`, each seeded
character's level is identical), plus four hardcoded copies of the old inverse (`tools/sim.js` +
test/boxing|speakeasy|stable `lvlRespect`) now read `PACING.LEVEL_DIVISOR` instead of a stale `4` — that
duplication is what silently under-seeded the probes when the curve moved. Regressions: the mission
cooldown gate + the sheet's next-job timer (`test/growth.js`). **Suite 45/45 + sim drift-0.** Deploy note:
existing characters keep their respect so their displayed LEVEL drops (the intended correction). All
`PACING.*` numbers are founder sign-off levers (BALANCE.md § THE PACING PASS, with the follow-on levers if
it still runs hot or cold).

**THE PROGRESSION HARNESS — `tools/playthrough.js` (`npm run playthrough`, the 2nd harness).** The
PLAYER-EXPERIENCE twin of `tools/sim.js`: the sim answers "does the economy conserve and how big is
each faucet", the harness answers "what does a person actually experience" — what they can do in a
sitting, what gates them, where they stall, how long a level takes. Same discipline (PUBLIC API ONLY,
**no value seeded**; the only SQL is the CLOCK — this character's timestamps pulled back N minutes,
the §7.1 lazy-accrual contract). The simulated player is **plausible, not optimal**: a fixed priority
ladder (checklist → Path → bank → boost+melt → the Score → the mission ladder → arm up at the armory
when an `fp` gate blocks → the gym, training the biggest deficit on the mission being chased → grind
the best crime the nerve pool covers → claim dailies). Built because the level-240 alpha speedrun was
a **progression** bug that the §10.4 sweep was structurally blind to (drift-0 throughout). **Measured
result: the speedrun is closed** — 3 hours straight in ONE sitting now reaches **level 17** (was 240);
2h ≈ level 14–16, 10.5h ≈ 44 (the earlier analytic "~11 at 2h" is corrected upward by the sim — it had
omitted the Score + mission ladder + checklist). **What throttles a sitting, measured:** NERVE is the
real limiter (pool at 21% of cap on average, full only 3% of minutes, funding ~60 crimes/hr — a
continuous drip, never burst-then-wait); the GYM is hard-capped at 15 sessions/sitting by the 3-min
cooldown; the MISSION ladder's 4h cooldown is LONGER than a sitting so it advances ~once per session
no matter how long you play (the cascade is now structurally impossible); lockup is 0% of played
minutes. Two founder calls flagged (NOT patched, ground rule #1, in BALANCE.md): **(1)** ENERGY is
vestigial for a street player — full 94% of minutes, since only the gym and the garage spend it
against 12/min regen (a resource bar with no bite on the core loop); **(2)** CASH OUTRUNS PROGRESSION
— a solo grinder nets $11k in session 1 and $360k in session 14 (30× in a week), holding $1.9M by day
7 at level 44, far past the level-15 business-front entry, so the passive stack is affordable long
before the content gating it (couples to the L1a/L1b front-curve levers). The **solo ceiling** (crime
+ gym + garage + Score + missions ONLY, zero contact with another player) is level 44 / $1.9M / 14 of
28 missions in 7 days. **Re-run it after ANY pacing, cooldown, regen, mission or level-curve change** —
it's the only tool that measures what a player feels rather than what the ledger conserves.

**THE TWO HARNESS FINDINGS — APPLIED (founder-directed 2026-07-25).** The progression harness's two
findings, resolved: one was a real defect chain, the other was a claim of mine that measurement
DISPROVED. **(1) Energy is vestigial → FIXED as legibility, not a retune.** Adding an energy cost to
crime was rejected (it would double-throttle the signed core loop). The real defect was that the game
MISLABELS the resource: crime runs on NERVE; energy is what the PHYSICAL work costs (gym, garage,
heist crews, cartel raids, convoy ambushes, shakedowns, races), so a full bar is unspent ACCESS, not
idle capacity. The in-game glossary was factually WRONG ("Energy fuels most actions (crimes,
training)") — split into two honest entries; the sheet's bars are now labelled `energy (gym · garage ·
crews)` / `nerve (crime)` with hover detail; the coach's `Full tank` rung names the content the tank
is for. **THE COACH DEAD-END CHAIN (the harness's real catch)** — the harness reported the SAME coach
line for a whole 7-day run, and a 30-day run was still stuck at "Finish your First Week" at **level
128**. Three separate rungs could never clear for a solo player, each masking every rung below it:
**(a)** `Nobody survives alone` is DECLINABLE forever yet sat above every one-time milestone — now
banded to lvl 3–`M3.COACH_FAMILY_BAND_LVL` (12) where it's genuinely the next thing, and demoted to
the tail after; **(b)** `ob_family` sat in the First-Week coach gate, so that rung was uncompletable
too — now excluded alongside the socials and the wallet (the audit-F1 exclusion was incomplete), so
the gate is the four tasks any player can finish alone; **(c)** a REAL BUG — `owned.skills` is a `Set`
(loadOwned:159), so the skills rung tested `.length` → `undefined` → `!undefined` → fired forever no
matter how many skills you owned. All three fixed, plus the recurring `$25k` bank nudge (a mid-game
session nets ~$360k, so it re-armed on every read) raised to `CONSTANTS.COACH_BANK_NUDGE` ($250k) and
moved to the tail. **The general rule, now enforced twice over:** a rung that never clears must never
sit above a rung that does — including WITHIN the tail (most-clearable first, the permanent decline
LAST, or the solo nudge would mask the bank nudge). `test/growth.js` walks the whole ladder and
asserts each rung advances. **(2) "Cash outruns progression" → MEASURED, and my claim was WRONG.** The
harness now reports net worth at the first minute a player is AT each business-front level gate: a
solo grinder covers **70% / 94% / 85% / 88% / 74%** of the entry cost at laundromat / restaurant /
nightclub / hotel / casino (a full 30-day run, all five gates reached — level 128, $51.3M, 25/28
missions at 45h played). Every gate is a short save, with no runaway trend — the cash curve and the
front cost curve are MATCHED, so **no retune was warranted and nothing was changed.** My claim had
confused "a level-44 player can afford a level-15 front" (trivially true, and fine) with "the gate is
meaningless" (false). The harness prints the gate table every run; if a gate ever goes over 100%, that
front's entry cost is the dial. §10.4 untouched throughout (the coach reads state and moves nothing).

**THE POPULATION — NPC residents of the city (step one) — BUILT** (`src/population.js`,
`test/population.js` — the 47th suite; design `omerta-npc-population-design.md`; founder-directed
2026-07-25, picking **"full residents"** + **"living population"**). OMERTÀ is a multiplayer game
launching with ~zero players, so every board that reads `characters` is dead in an empty alpha —
streets roster, contract board, duelling ladder, Black Market, Shylock, bodyguard market, nightlife,
fights, races strip, fade/poker tables, Wire tap targets, Secrets dig targets. The progression
harness measured the consequence exactly: a plausible player reaches **level 128 with $51M in 30
days having never once met another person**. A resident is a **REAL character** (the `convoys.is_npc`
precedent) — real `accounts` + `account_persistent` + `characters` rows, flagged `characters.is_npc`
+ `account_persistent.npc_flag` (the `agent_flag` twin) — so ONE population lights up every board at
once and **every interaction runs the same audited code that runs against a player**. `runPopulation`
(worker, dormant under `POPULATION_OFF=on`) tops headcount to `POPULATION.TARGET` (48) at
`SPAWN_PER_TICK` (4) a tick across four weighted `BANDS` (corner/made/capo/boss — level, stat and
seed-cash ranges), and retires bloodlines past `RETIRE_GENERATIONS` (6) so no line accrues prestige —
and therefore an ever-growing `death:legacy` — forever. **DEATH IS DELIBERATELY NOT SPECIAL:** a
killed resident runs the ORDINARY `runEstate` and the heir (same name, generation+1) **IS the
respawn**, so social.js needed no NPC branch and the population self-heals. §10.4: residents hold
cash, so they sit inside the per-character check and every dollar is enumerated — exactly two new
reasons under a new `npc:` cash prefix, `npc:seed` (FAUCET, the spawn balance) and `npc:retire`
(SINK, burned at retirement); a fire-kill loots them through the existing `whack:loot` and the estate
burns the rest. **The faucet measured (sim P9.21): $20,798 seed per resident, ~$998k standing
city-wide, a killer nets $5,140 per kill against an ~$82k ammo cost — strongly −EV, not a farm** (the
same conclusion the econ pass reached for player kills: contracts pay, loot is the tip). Exclusions:
**the Street Wage** (`emission.js` — the critical one; a resident drawing emission is theft from the
endowment, enforced even when enrolled AND minted), **City Standing**, **ops** (real-player counts,
with `residents` reported separately) and **the onboarding funnel**; most other leaderboards need no
change since they rank by legend columns a resident never accrues — **a future step that gives
residents a legend must exclude them on that board at the same time**. Two bugs the test earned: the
`corner` band seeds BELOW the un-ledgered $500 base so the seed row must carry a NEGATIVE delta (a
silent −$235/resident §10.4 hole otherwise), and `runEstate`'s heir INSERT didn't carry `is_npc`, so
a killed resident's heir was born a "player" — headcount never self-healed and the ops/funnel
real-player counts quietly started counting scenery. **The `npc` flag is EXPOSED on `GET /v1/streets`
(console shows a `RESIDENT` chip), not hidden** — residents are mechanically indistinguishable, but
in a game with real-money extraction, passing scenery off as people isn't a call to make silently
(presentation only, trivially reversible). Deferred (step two): **behaviours** — residents listing on
the Black Market, posting loan offers, taking fade/duel/bout listings, opening clubs, drifting
between districts. Each moves value, so each needs its own §10.4 reasoning; the discipline is that a
resident may only ever RECYCLE value it already holds, never conjure it at the point of sale. Also
deferred: NPC families (so the Commission and turf stay untouched) and any resident telemetry (so
`/v1/online` presence stays a true human count). All `POPULATION.*` numbers are founder sign-off
levers (BALANCE.md).

**THE POPULATION — step two: THE CITY ACTS — BUILT** (`src/population.js` `residentAct`/
`runResidentBehaviour`, `POPULATION.BEHAVIOUR` rules block, `test/population.js`). Residents now DO
things, under one rule that makes the whole step §10.4-free: **a resident may only ever RECYCLE value
it already holds, never conjure it at the point of sale** — so step two adds **NO new faucet and NO
new §10.4 reason**. `runResidentBehaviour` (worker, after the top-up) gives `ACT_PER_TICK` (6)
residents ONE turn each, skipping anyone the world has taken out of play (jailed/hospitalized/
safehoused) and re-reading each under the row lock (a player may have robbed them since the pick).
Four behaviours: **(1) CONSENT LIMITS** — `guard_price`/`fade_limit`/`duel_limit` sized in bps of
their own cash (never advertising a stake bigger than they hold), which is what actually lights up
the bodyguard market, the back-room fade board and the duelling ladder — all three are
consent-by-listing, so an empty alpha has literally nobody to play against without them; zero value
moved. **(2) THE SHYLOCK** — a **SECURED** loan offer (`loan:offer`, the existing escrow). Secured
ONLY, and that's load-bearing: a resident never calls `collectLoan`, so an unsecured NPC loan would
be free money for a defaulter (`LOAN.MAX` $1M vs a $50k square cost); requiring collateral worth
`LOAN_COLLATERAL_MULT` (1.3) × what's OWED means the **already-audited grace-forfeit sweep** seizes a
pledged car worth more than they borrowed — recourse without an NPC ever acting. **(3) THE BLACK
MARKET** — a standing BUY ORDER (`market:list` + `market:order`, the existing escrow), giving players
a reliable cash buyer for goods they actually hold (a fair exchange, bounded by the resident's own
cash, refunded by the existing sweep on expiry). **(4) DRIFT** — move district, pure position.
`retireResident` now pulls escrow back FIRST (cancelling open offers/orders via `loan:refund`/
`market:refund`, mirroring the audited cancel paths) before the burn — otherwise an offer would stand
on the board forever with nobody behind it and a player could take a loan from a lender who no longer
exists. **Measured before → after** (empty alpha, then the city filled in): streets roster 1 → **49**,
loan offers 0 → **12**, market listings 0 → **11**, duelling ladder 0 → **20**, bodyguards for hire
0 → **21**, §10.4 clean throughout. pg-mem note: the turn picker shuffles in JS, not `ORDER BY
random()` (pg-mem has no `random()` — the two-flat-queries precedent). Residents still emit NO
telemetry and NO bus events, so `/v1/online` presence stays a true human count and the feed isn't
padded with fake activity; they post their own listings but never TAKE the other side of a player's,
so every interaction stays player-initiated. `test/population.js` asserts the consent limits are
always covered by held cash, every resident offer is secured above what's owed, the escrows
reconcile, retirement-with-live-escrow closes the books, and — the core claim — that the set of
reasons by which a resident can RECEIVE cash is exactly {npc:seed, death:legacy, loan:refund,
market:refund}, i.e. nothing was conjured. Suite 47/47 + sim drift-0. All `POPULATION.BEHAVIOUR.*`
numbers are founder sign-off levers. Still deferred: NPC families (Commission/turf untouched) and
residents opening speakeasies or fielding fighters/racers.
A focused four-lens red-team over both steps (`AUDIT-population.md`: §10.4/faucet, concurrency/locks,
exploit/grief, cross-system) returned **no CRITICAL/HIGH and no §10.4 drift** — the seed/retire
accounting (incl. the negative-delta corner band), the escrow mirroring, the ordinary-runEstate death
path, the characters→leaf lock order and every exclusion verified sound — and closed **one class of
defect with four faces**: the three consent columns are written by **direct SQL, which bypasses
`offerBodyguard`/`listDuel`/`setFadeLimit` and every bound those routes enforce**. **F1 (MED)** —
residents were selling a lethal-hit absorb for a few hundred dollars against `M3.BODYGUARD_MIN_PRICE`,
a floor Phase 1.3 deliberately repriced 1000→**10000** for safehouse parity; that also exposed a
category error in the build — a guard PRICE is income the resident *receives*, not a stake they must
*cover*, so sizing it to holdings was wrong and left all but the richest ~3% unable to reach the floor
at all (an empty protection market, the exact thing step two exists to fix) → now
`max(BODYGUARD_MIN_PRICE, bps(cash, GUARD_BPS))`. **F2 (LOW-MED)** — a `duel_limit` under
`DUELS.STAKE_MIN` sits inside an **empty window** (`amt >= STAKE_MIN && amt <= limit`), so a majority
of the ladder was unchallengeable decoration → listed only when it clears the floor. **F3 (LOW)** —
`fade_limit` now bounded by `CASINO.MIN_BET/MAX_BET`. **F4 (LOW)** — a drained resident's stale stake
now triggers a relist instead of standing on the board answering only `their_cash`. **F5 (LOW,
defensive)** — the secured-loan collateral floor was clamped down to `LOAN.COLLATERAL_MAX`, which
would ship an UNDER-secured (free-money) NPC loan the moment the clamp bound; unreachable today, but
`LOAN_COLLATERAL_MULT` is a founder lever, so the resident now simply doesn't lend rather than lend
under-secured. Each limit is gated by **its own system's constant** so those stay the single source of
truth. The audit also **corrected the sim's own P9.21 claim**: "the worker refills so it can't be
drained faster than it's topped up" was WRONG — the top-up refills **headcount, not cash**, so the
seed pool is a **stock, not a flow** (~$998k lifetime), and step two moved it from ~25%-realized (a
kill burns the rest) to ~100%-realized (a duel/fade/order-fill transfers the whole stake) — still
petty against the $21.6M/day passive stack, and no new faucet, but the honest figure now prints every
run. Flagged for founder sign-off (NOT patched): **the city DEPLETES** — residents have no income, so
once drained the boards go quiet again; making it renewable (resident income, or
retire-and-respawn-on-broke) turns a one-shot ~$998k into a recurring faucet, which is a balance call.
Suite 47/47 + sim drift-0.
**THE POPULATION — step three: THE TURNOVER — BUILT** (founder-directed 2026-07-25, closing the audit's
one open flag; `src/population.js`, `POPULATION.TURNOVER` rules block, new `characters.npc_seed` column +
`population_state` singleton, `test/population.js`). The city now RENEWS itself: the worker retires a
resident players have **picked clean** alongside the old-bloodline rule, and the existing top-up puts a
fresh face in the vacancy (both through the same `retireResident` path, so the escrow-reclaim + `npc:retire`
burn already hold). **"Picked clean" is measured against what they ARRIVED with** (`characters.npc_seed`,
stamped at spawn, lazily backfilled for heirs in `residentAct`) — **never a flat cash floor**, which is the
whole design: a flat floor can't tell a drained boss from a corner kid BORN with $200, so it would retire
the cheap bands the instant they spawned, respawn them, and loop forever (an unbounded faucet).
`DRAINED_BPS` (15%) carries deliberate margin — a resident with the maximum parked in escrow (a loan offer
plus a buy order) still holds ~52% of their stake. This deliberately makes `npc:seed` a RECURRING faucet,
so it ships with an explicit ceiling — and **the ceiling meters RETIREMENTS, not dollars seeded**, because a
retirement is exactly what creates the vacancy a fresh seed pays for. Metering dollars was the first cut and
the test killed it: the day-one fill of an empty city is ~48 seeds that replace NOBODY and ate ~$998k of a
$1M budget before anyone had been robbed. So the rule reads plainly: **at most `TURNOVER.PER_DAY` (24)
residents are replaced in a day** — a headcount in the new `population_state` singleton, charged in the SAME
transaction as the retirement (the claim-then-act discipline, so a crash between the two can't hand out a
free replacement), bounding the faucet at **≈$499k/day** at the weighted mean seed (territory-racket /
boxing-purse band, ~2.3% of the passive stack). Spent, the city keeps its drained residents until the day
rolls — surfaced in the worker log and on the ops dashboard (`residentTurnoverToday`/`residentTurnoverCap`/
`residentSeedToday`) so an under-strength city reads as a ceiling rather than a bug. §10.4 unchanged (no new
reason — the recycle just fires the existing `npc:seed` faucet and `npc:retire` sink more than once). The
pool also recycles unaided, off-faucet: `hireBodyguard` and loan repayment pay player cash INTO residents.
`test/population.js` proves every resident records its arrival stake, THE TRAP (the poorest resident in the
city is still not "drained" — born poor ≠ picked clean; a city nobody has robbed retires nobody), the
picked-clean retire + replacement, the per-retirement allowance charge, and the ceiling holding (a drained
resident STAYS on the streets, broke, once the day's replacements are spent). Suite 47/47 + sim drift-0.
`TURNOVER.PER_DAY`/`DRAINED_BPS` are founder sign-off levers — `PER_DAY` is the direct faucet dial (BALANCE.md).
A **round-two red-team over step three** (`AUDIT-population.md`, same four lenses) returned **no CRITICAL/
HIGH and no §10.4 drift** (the recycle adds no reason; the allowance charge shares the retirement's
transaction so a crash can't hand out a free replacement; bodyguards are self-correcting since a hired
guard has just RECEIVED ≥$10k and so sits well clear of the drained line) and fixed four: **T1 (LOW-MED)**
old-bloodline retirement and the drained pass shared one per-tick room with old lines taken FIRST, so
≥`SPAWN_PER_TICK` lines past `RETIRE_GENERATIONS` starved the renewal loop indefinitely — and heavy PvP is
exactly what sustains that backlog, since a resident's generation only rises when players kill them; the
loop is now guaranteed a slot whenever it has a candidate and maintenance takes what's left. **T2
(LOW-MED)** an HEIR was born unstamped and `npc_seed` was backfilled on its first worker turn (a ~8h window
on a 48-body city at `ACT_PER_TICK` 6 hourly) — drain the heir inside it and the backfill recorded the
DRAINED cash as their arrival stake, making them permanently un-recyclable (a broke body occupying a slot,
manufacturable at will by a griefer); the stake is known at the heir's INSERT, so `runEstate` now records
it there alongside the `is_npc` flag already on that row. **T3 (LOW)** `runPopulation` had no advisory lock
though it's the second metered faucet — two replicas could each spend the full daily allowance; added the
`runWageEpoch` session-lock pattern (distinct class). **T4** `seededToday` was production-dead (ops
duplicated the query inline) — ops now uses the helper. Flagged as accepted-by-design: **the reroll** —
draining a cheap corner resident forces a replacement drawn from the full band distribution (E $20,798 vs
their ~$700), so cheap drains convert into richer targets; the player receives nothing directly and total
extraction stays bounded by `PER_DAY × mean seed`, but the ceiling is the only thing bounding it.

**SURVIVING A DATABASE OUTAGE — the crash, the legibility, and the verified backup (2026-07-25).**
The founder reported "omerta-db is down and I don't know", and a tester reported "Internal error on
every crime". Investigating both turned up ONE severe defect and a class of illegibility around it.
**THE DEFECT (the important part): the API process DIED every time Postgres restarted.** `pg.Pool`
emits `'error'` when an IDLE pooled connection drops (a DB restart, a failover, an idle reaper), and
an EventEmitter with no `'error'` listener THROWS — an uncaught exception that kills Node. `makeDb()`
never attached one. So a database bounce did not degrade the server, it killed it; on a platform that
auto-restarts, the visible symptom is exactly "every button returns Internal for a while", which is
very likely what the tester actually hit (the crime path itself was proven fine by curl, a real
Chromium click, and real Postgres). Found by stopping a real Postgres under a running server —
**pg-mem cannot surface this class at all**, so no suite would ever have caught it. Fixed with a
`pool.on('error')` handler in `db.js` (log + carry on; node-pg discards the dead connection and the
next request opens a fresh one, so recovery is automatic and needs no redeploy). `test/hardening.js`
carries a SOURCE-LEVEL tripwire for it, honestly labelled as such, since pg-mem can't reach the path.
**THE LEGIBILITY (why nobody could tell what was happening):** every DB problem surfaced as
`500 {"error":"internal"}` — byte-identical to a null-dereference, so an outage and a bug were
indistinguishable. New `src/dbhealth.js` classifies connectivity failures (`isDbDown` — SQLSTATE 08*/
57P0*/53300, errnos, `syscall==='connect'` which is what catches a stopped unix-socket Postgres's
ENOENT, aggregate connect errors, and message fallbacks) and `pingDb` (bounded by a timeout, since a
pinned pool would otherwise hang the health check itself). The classifier is deliberately CONSERVATIVE:
laundering a real bug into "try again shortly" would hide it, so anything not clearly connectivity
stays a 500 — the test pins BOTH directions. Wired up: the error handler returns **503 `db_down`** with
Retry-After; **`GET /health`** answers "is it up?" keyless for a human or an uptime monitor (200/503 +
latency + uptime); the **worker** pings once per tick and skips with ONE line instead of ~60 stack
traces from `safe()`-isolated jobs (every sweep is idempotent, so skipping loses nothing); the
**console** maps `db_down` and a new `offline` to plain English — `api()` now catches a REJECTED
fetch (server entirely gone), which previously escaped `act()` (no catch) as an unhandled rejection so
the button silently did nothing. Verified end-to-end in Chromium against a real Postgres across all
three states (up → success; DB stopped → "the city's records are unreachable…"; server killed →
"couldn't reach the city…"), zero page errors. **THE BACKUP:** the incident's root cause was a SILENT
failure of managed WAL archiving (pgbackrest `archive-push` exit 82, retried ~11 min, everything
looking healthy), and `tools/backup.sh` had the same shape of flaw — `pg_dump > "$OUT"` wrote straight
to the final filename (a half-finished dump left a plausible-looking corpse) and nothing ever read a
dump back. Now it dumps to a temp name, VERIFIES, and only then moves it into place; retention runs
only after a good dump so bad nights can't age out the last known-good backup. The verification that
matters most is **actual rows**: measured, a schema-only database dumps to 161 table entries and
~194 KB, clearing the table count and any sane size floor while holding not one account — so only
reading the data section back proves there is data in there (`BACKUP_MIN_ROWS=0` for a genuinely cold
DB). 29 assertions against a real Postgres 16 (happy path, empty DB, schema-only DB, truncated dump via
a stub `pg_dump`, size floor, missing tables, unreachable DB, no `.part` left on any failure path,
retention holding fire after a failure); two of them caught defects in the change before it shipped —
a missing `pg_restore -f -` that would have failed EVERY backup, and the schema-only hole above.
DEPLOY.md §7b/§7c document what an outage looks like, the uptime-monitor recommendation (and the
warning NOT to make `/health` the platform's own health check — restarting the API doesn't fix a
database, it just adds a restart loop). §10.4 untouched throughout — nothing here moves value.

**THE BACKUP WATCHDOG — the game now watches its own backups (2026-07-25, same incident).** The WAL
archiving failure recurred that evening (segment `FD`, ~7 min, after the morning's `A8`, ~11 min —
both self-healed), which made the real problem plain: this is the ONE failure invisible from inside
the game, and the founder could only learn of it by reading the host's log stream. So the game now
reads Postgres's own account of it. `dbhealth.js:archiverHealth` queries `pg_stat_archiver` +
`archive_mode` and returns a FIVE-state verdict, each state earning its place: **ok** (the newest
event was a successful ship), **failing** (the newest event was a FAILURE — the alarm; deliberately
compared against `last_archived_time`, because Postgres retries a stuck segment until it lands and a
HEALED outage leaves its failure timestamps in that view forever, so reading `last_failed_time` alone
would alarm about an incident that ended hours ago), **stale** (nothing shipped lately — normal on an
idle database, a note not an alarm), **off** (`archive_mode=off`: no chain to break because no chain
exists — **found by probing a real Postgres that had archiving disabled, which the first cut reported
as "ok"**, since zero failures reads as healthy right up until you need a backup), and **unsupported**
(pg-mem or a restricted role — not knowing is not the same as broken). Wired: the **worker** checks
EVERY tick (not nightly) and alerts through the existing `alertDrift` channel (telemetry +
`INVARIANT_WEBHOOK_URL`) latched once per episode, so a healed-then-broken-again outage alerts again
while a still-broken one doesn't re-nag hourly; **`/admin`** leads with a Backups panel + its own red
banner above the §10.4 one (browser-verified in both alarm states, zero page errors); `npm run backup`
wraps the verified dump. §10.4 untouched — read-only, moves no value. DEPLOY.md §7c documents the
five states, the webhook requirement, and the `pg_stat_archiver` query for checking by hand.

**ONE AUTHED REQUEST AT A TIME (client) — 2026-07-25, found in the founder's production logs.** The
same log that finally named the archiving root cause (`[103] … Temporary failure in name resolution`
— DNS to the pgbackrest repo host, the *cause* behind the earlier exit-82 timeouts) also showed
FOUR of one player's requests queued on that player's own character row: `SELECT * FROM characters
WHERE account_id=$1 AND alive FOR UPDATE`, waits of 1.0s/2.1s/2.3s/4.3s, sessions 15–24s. Nothing was
broken — that is `withCharacter`'s lock working — but EVERY authed request takes it (even a read: the
§7.1 lazy accrual persists), so same-account calls serialize at the DATABASE whether or not the
browser fires them together, and firing them together is strictly worse: each waits holding a pooled
connection, and `PG_POOL_MAX` is what runs out first. `api()` now queues authed calls on a promise
chain (the chain `.catch()`es so one failure can't wedge it); KEYLESS calls (`/v1/rules`, `/v1/city`,
`/v1/online`) stay parallel since they take no lock. **Measured in a real browser over a 10-tab sweep
with refresh+renderActive forced: peak authed in-flight 6 → 1 across 65 requests, zero page errors**
(the before-number taken by stashing the fix and re-running, so the improvement is measured rather
than assumed). Total latency is unchanged — the wait just moves from the database to the browser,
where it costs no connection. Deeper fix NOT taken (flagged): read endpoints could accrue in memory
without persisting and skip the exclusive lock entirely, but that touches the most heavily-audited
function in the codebase and was not worth doing reactively at speed.


**POSTGRES SAFETY VALVES + the lock-free read path INVESTIGATED AND REJECTED (2026-07-25).** The
founder asked for the correct long-term fix to the read-lock contention. Two outcomes, both worth
recording. **SHIPPED — the safety valves** (`db.js`): the pool now sets `statement_timeout` (15s),
`lock_timeout` (8s) and `idle_in_transaction_session_timeout` (30s) server-side, plus
`connectionTimeoutMillis`/`idleTimeoutMillis`. Nothing may wait forever: no query outlives its
timeout, a request waiting on a busy row GIVES UP instead of queueing behind it indefinitely, and a
transaction leaked by a crashed handler is killed rather than holding its row locks until the pool
recycles (which for a player means a permanently frozen character). `55P03` (lock_timeout) joined
`deadlockToRetry` alongside 40P01/23505 — to a caller it is the same thing: transient, nothing
committed, safe to retry, never a 500. Verified against real Postgres: the settings reach the server
(`current_setting` confirms 15s/2s/30s under an override) and a blocked lock gave up after 2002ms
with 55P03 instead of hanging. All five knobs classified in `preflight.js` (the env-drift guard
caught them itself). **REJECTED — routing the 24 pure-read GET routes through a lock-free
`withCharacterRead`.** It was built and it very nearly worked: `accrue()` is verifiably pure (zero
writes in accrual.js) and idempotent from unchanged clocks, and all 22 board handlers were checked
mechanically to be side-effect free, so a read genuinely can show accrued income truthfully while
writing nothing. Two problems surfaced, the second fatal. (1) Reads rolled the §7.1 Bureau raid and
discarded it — a PHANTOM raid the player sees then refreshes away; fixable with a `ctx.preview` flag
that skips non-deterministic accrual. (2) **THE KILLER: with reads no longer persisting, a raid can
only fire during an ACTION — and the raid sets `jail_until`, so that same action's own jail gate
throws `GameError`, which ROLLBACKs the transaction and undoes the raid that just rolled.** The
Bureau becomes unreachable. The old design worked only because reads (whose `fn` is `async () =>
({})` and never throws) were doing the persisting. Making this correct requires accrual side-effects
to survive a failed action — i.e. restructuring the accrual-vs-action transaction boundary in the
most heavily audited function in the codebase. That is a designed change, not a same-night patch, so
the read path was reverted whole. The production symptom it targeted is already addressed by the
client-side serialization (measured peak 6 → 1). **If it is picked up again**, the shape is: keep
`withCharacterRead` + `ctx.preview`, and give `withCharacter` a two-phase commit where accrual's
side-effects (raid, income, interest) commit even when `fn` rejects — then the read path is safe.

**THE MAINTENANCE SESSION — five harnesses, and the other half of the outage bug (2026-07-26).** A
run of non-feature work; the full record is in `SPEC.md` (debt register) and `DEPLOY.md`, so this is
the precedent index. **(1) D7 — the docs are now machine-checked** (`test/docs.js`, the 52nd suite):
stale prose does not fail loudly, it makes the next maintainer confidently do the wrong thing, and
the pass found five live examples including a comment telling the reader to re-apply a line by hand
after every extractor run (a hazard that had not existed since the rules split). Every figure in
SPEC §1 is now asserted against the tree — file COUNTS exactly, line TOTALS within 2%, because a
test that asserts its own line count chases itself. `docs/AUDITS.md` indexes all 57 audit reports as
point-in-time. **(2) The alarm reaches a human**: `INVARIANT_WEBHOOK_URL` posted `{alert, failed}`,
which has neither `text` nor `content`, so Slack AND Discord both 400 it and the error is swallowed
— the §10.4 drift alarm was firing into nothing. Now `webhookText()` renders a readable message on
both keys, clamped under 2000 chars. **(3) The growth loop paid nobody**: `SOCIAL_VERIFY_MODE=live`
without `X_BEARER_TOKEN` means every Spread-the-Word claim fails verification forever. Now
`socialProviders()` degrades honestly — unavailable tasks are hidden from the board rather than
offered and refused — and the ops dashboard reads PAYING / NOT PAYING. Deliberately a preflight
WARNING, not an error: making it fatal would take a live server down on its next deploy. **(4)
`tools/loadtest.js` (4th harness, `npm run loadtest`)** — 5–50 concurrent players against real
Postgres, reading `pg_stat_database.deadlocks` before and after, since `40P01` is retried as
`contention` and a lock-order bug is otherwise invisible. Zero deadlocks at every level; throughput
FLAT ~175 req/s from 5 to 50 players with linear latency — CPU-bound, not a lock wall. It also
produced three false findings before it produced a true one: 94 deadlocks that were the harness's
OWN bulk `WHERE id = ANY(...)` medic locking rows in Postgres's order instead of the game's sorted
order; a singleton-contention leg that measured nothing because the players stood in the wrong
district; and a PvP leg where 531/722 calls died on an ammo gate INSIDE `withTwoCharacters`, so the
locks were taken and released before anything contended. **A harness that measures nothing reads
exactly like a harness that passes.** **(5) `loadOwned`: 16 sequential round trips → one UNION ALL**
(+31% throughput, measured). pg-mem's UNION type unification is pairwise left-to-right and types a
bare `NULL` as `text`, where Postgres infers from the first branch — so EVERY branch carries an
explicit cast. A 4-branch spike passed only because its timestamp branch happened to be last.
**(6) `tools/chaos.js` (5th harness, `npm run chaos`)** — the first thing here that interrupts
anything: SIGKILL the worker mid-sweep and check the resumed run pays exactly once, terminate ~80
backends mid-transaction under load, stop and start Postgres under a live server. Twenty sweeps
claim to be idempotent in comments; that claim only becomes true when something kills them in the
middle. **It found the other half of the 2026-07-25 outage.** `pool.on('error')` covers IDLE pooled
clients. A CHECKED-OUT client (`pool.connect()`, ~73 sites, every transaction in the game) emits
`'error'` on ITSELF when its connection dies mid-transaction — no listener, unhandled throw, process
dead, exactly as before the earlier fix. Not exotic: it fires on any failover landing mid-request,
on `pg_terminate_backend`, and pointedly on our OWN `idle_in_transaction_session_timeout`, the valve
that exists to kill leaked transactions. Fixed in `src/db.js` — a logging handler attached ONCE per
client (re-attaching leaks listeners); node-pg still rejects the in-flight query so the request 503s
normally. Verified by removing the handler and confirming chaos fails loudly and non-zero — the
harness installs `uncaughtException`/`unhandledRejection` handlers that NAME the crash and then
`process.exit(1)`, never swallow it, since swallowing would convert the one finding this harness has
made into a green run. `runLedgerInvariants(pool, {alert:false})` is new for the two measurement
harnesses: they SQL-seed, so their baseline drift is non-zero by construction and they assert a
before/after DELTA — firing the production alarm on a measurement buried the real result.

**AUDITING MY OWN CHECKS — and the four real bugs that fell out (2026-07-27).** After a run of
sessions that each found "an insane number of bugs", the founder asked for a line-by-line pass over
everything written recently. The most productive part was not re-reading the product code — it was
auditing the two NEW GUARDS, because both had holes that made them report a pass over surface they
never looked at. **`test/client.js` (the wiring test) had three:** two `api()` sites choose their
path with a TERNARY, so `readLiteral` returned null and four chat routes went unchecked while the
run still printed "passed" (now the whole argument expression is walked for every `/v1` literal it
can produce, and anything still unreadable is COUNTED and asserted zero); eight literal routes are
shadowed by a param route (`/v1/skills/respec` by `/v1/skills/:id`), and the body check resolved
with `find` — the FIRST match — so it could compare against the wrong handler entirely, passing
today only because server.js happens to register the literal first (now most-specific wins, the same
one fastify serves; verified EXERCISED, not defensive — two real bodies match two handlers each);
and — the one that mattered — bodies were read from the raw deck and `data-body` attributes but NOT
from the `api()/act()` calls the curated screens actually use, so **a third of the surface was
unchecked**. Closing that took bodies 50 → 172 and immediately found two live defects: **THE VAULT**
sent `{amount}` to `/v1/unstake`, whose handler takes no body and always unstakes EVERYTHING (type
100, lose your whole stake, silently), and **THE ARMORY** showed a "rounds" input and sent `{qty}` to
`buyAmmo`, which sells a fixed box of 50 for $2,000 and reads no quantity. Both controls lied about
what they did; both are fixed and browser-verified. The test also stopped ADMITTING gaps: the 5
runtime-built routes (`/v1/garage/${id}/${what}`) are now expanded over every value the client can
pick (18 concrete routes, all mounted, and an unlisted one fails the run), the 5 whole-body routes
are followed a file deeper to the parameter the body lands in — through a barrel re-export, and
through a computed read over a literal list, both unit-checked against synthetic sources since the
tree contains neither shape — and the 25 unchecked literal fields are now either catalog-backed (5
were real API values) or declared not-an-API-value. **`tools/mobile.js` had three:** `MIN_TAP` was
declared, quoted in the failure message, and DEAD (the check used a literal 36 inside the page, so
changing the knob changed nothing); groups were selected by their button TEXT, which is both a
substring match and an i18n-translated string on a client that auto-detects browser locale — an
unpinned run in another language would have walked zero screens and still passed; and check D was
never proven to fire at all, so `weberror` was confirmed empirically for both an uncaught throw and
an unhandled rejection, plus end-to-end with a real error injected into the client. **The fourth bug
was in the product, found by RUNTIME-verifying the session's client fixes instead of trusting the
static pass:** `POST /v1/exchange/list` read `Math.max(1, Math.floor(Number(unitPrice) || 0))`, so a
caller who misnamed the field (the console's own deck did), omitted it, or sent something negative
or non-numeric got a 200 and their goods on the board **at $1 a unit**, escrowed, for anyone to
sweep — 10 rounds meant for $500 listed at $1 each, a 500× loss reported as success. Swept the tree:
it was the only one — every sibling setter (`listRace`, `listSpeakeasy`, `listBout`, `listDuel`,
`listRacer`, `setFadeLimit`, `setPokerLimit`, `offerBodyguard`, `sellPaper`) already validates and
throws, and the other `Math.max` floors are server-COMPUTED costs, not user input. $1 stays a legal
price; not naming one is refused. **The lesson worth keeping: a coverage test that silently skips
what it cannot parse is worse than no test, because the green run is read as proof. Every extraction
in both guards now counts what it could not read and asserts that count is zero.** Every new
assertion mutation-verified. Suite 53/53, mobile 54/54, sim drift-0.

**THE MIRROR — checking what the client READS, not just what it sends (2026-07-27).** The wiring
test covered the three ways a control dies on the way OUT. The way back was unguarded: 442 distinct
field reads across 96 boards, and if a server field is renamed or a board stops returning one,
nothing throws — the screen renders `undefined`, or silently takes a hardcoded fallback, or shows
its "nothing here yet" card on a screen that is full. Check 4 closes it, and found both of those
live: **THE SHYLOCK** tested `b.book` for emptiness against a board that returns `active`, so a
lender with active loans and no open offers got the beginner coaching card on a screen full of their
own book; **THE WIRE**'s extortion card read `SEC.windowHours` off a board that never had it (it is
published by `/v1/rules`), so it rendered a hardcoded `|| 24` and would have gone on saying "24h"
whatever `EXTORT_WINDOW_MS` was retuned to. The check is **RUNTIME by necessity** — a response shape
is assembled across many lines with spreads and conditionals, so reading it out of the source is
guesswork, and guesswork here reports confident nonsense; it boots the server on pg-mem, builds its
own fixture, and looks at the actual JSON. **Four extraction disciplines, each added only after it
produced a FALSE finding, and any one missing turns the check into noise:** innermost-BLOCK scope
rather than the enclosing named function (a `const b` inside one arrow is block-scoped, and reusing
the name in a sibling arrow is ordinary JS — this alone accounted for 3 of the first 8 "findings");
shadow blanking for `.map((b) => …)` / `for (const b of …)` re-binding the same short names (which
is why `onclick` and `dataset` were being reported as missing leaderboard fields); a `(?<![\w$.])`
lookbehind, because without it `m.b.pool` reads as `b.pool` and a main-event fighter's fields get
charged to whatever the outer `b` holds; and excluding JS builtins, since `.map`/`.length` are not
response fields. Two further traps cost real time: the shared `readLiteral` stops at a newline —
correct for a path, fatal for a block scanner in a client made of multi-line template literals — and
the replacement must also track `${}` depth, or a NESTED template ends the outer literal mid-way and
its braces corrupt every scope. Nothing is left admitted-but-unchecked: bindings that cannot be
scoped, shadows that cannot be resolved, param routes with no fixture, and boards that resolve to an
empty list are each COUNTED and asserted to be zero, so the fixture has to be enriched rather than
the gap tolerated. Mutation-verified three ways (restore either real bug, or invent a field, and the
run names the screen, the field, and what the route actually returns). **Honest scope, stated in
the file and in the pass line: 275 TOP-LEVEL fields across 57 boards — list ELEMENT fields
(`b.paper.map((p) => p.owed)`) are NOT covered yet.** Those reads sit inside a lambda whose
parameter the shadow blanking removes by design, and 12 of the 16 list boards come back EMPTY for
a single-character fixture, so there is nothing to compare against; covering them needs a fixture
rich enough that every list has a row in it. That is the next step and it is where most board
rendering lives — the check must not be read as "every read is verified".

**THE FLAKE WAS A MONEY BUG — ring poker's all-in rule (2026-07-27).** A ~1-in-20 failure in
`test/ring.js` was chased on the assumption it was a test artifact. It was two separate things, and
the more interesting one was in the product. **The bug: an ALL-IN player was handed the action.**
`advance()` picked the next actor from every un-acted seat regardless of stack. A player with no
chips has no decision to make and no reason to click, so the turn clock reached him and
`enforceDeadline` set `in_hand = false` — **folding him out of a pot he had put his entire stack
into**, while an opponent simply waited him out. Reproduced deterministically before any fix: three
seats, one short, the preflop raise capped at the smallest live stack (which is exactly what puts the
short stack all-in), a $9,000 pot, and the short stack folded off it by the clock. **The first fix
was incomplete and its regression passed anyway** — filtering the *pending* list left the next-street
assignment picking `live[0]` unconditionally, so the bug survived whenever the all-in player sat at
the lowest seat, and the test only went green because the short stack happened to sit second. Probing
the shapes the regression did *not* cover then found a worse one: **with every seat all-in, the clock
folded them one by one and the last seat standing took the pot with no showdown** — the cards never
decided it. `dealHand` had the same hole from the first card (a seat whose whole stack was the ante).
The rule is now stated once and applied everywhere: **a seat with no chips is never asked to act, and
a betting round only opens while at least TWO live seats have chips** — the raise cap is the smallest
live stack, so the moment anyone is all-in the cap is 0 and `check` is the only legal action for
anybody; real poker runs the board out there, and now so does this (`openBetting`/`runOut`/
`dealStreet`, plus a `settleFinish` after a deal that resolves instantly, or its rake never reaches
the ledger and the ring-escrow §10.4 identity drifts on COMMIT). Five shapes are regression-tested and
each was mutation-verified against its own distinct assertion. **The other half — the actual flake —
was the test's own clock:** `RING_TURN_MS` was 200ms while every hand is a dozen sequential HTTP
round-trips against pg-mem, so any pair that straddled 200ms had the clock fold the actor mid-hand and
the next check came back `400 folded`. The failure message named the seat, not the cause, which is why
it read as a state-machine bug. Fixed by running the suite on a generous clock and **backdating
`act_deadline`** where the clock is under test (`expireTurn` — the `closeReg` pattern already in the
file): same `act_deadline < now()` predicate the sweep really uses, deterministic, no wall clock in
the loop. Mutation-verified that the clock is still genuinely exercised, because a flake silenced by
making its test vacuous is worse than the flake. 111 consecutive runs green, from ~7% failing.

**IS ANYONE ON THE OTHER SIDE? — `tools/scale.js` (`npm run scale`, the 7th harness), and the census
that nearly lied.** Every economic proof in the repo is about ONE player or about CONSERVATION —
`sim.js` sizes each faucet and proves §10.4, `playthrough.js` measures what a person experiences.
Neither can see the failure the whole Risk-to-Earn thesis rests on: **a market with perfect accounting
and no counterparty.** A dead market conserves value beautifully. The progression harness had already
measured the shape of it from the other end — a plausible player reaches level 128 and $51M in thirty
days having never once met another human. So this drives a TOWN (36 players over six archetypes —
grinder/trader/lender/killer/gambler/idler, the idler load-bearing because a town where everyone plays
optimally is not a town — five warped days, NPC residents acting alongside) through every
player-to-player market and takes a census: how many have a live counterparty, and of what got POSTED,
what got TAKEN. It asserts three things and REPORTS the rest, because liquidity is a finding for
balance, not a pass/fail: **(1)** §10.4 drift DELTA is zero (the loadtest discipline — the harness
seeds starting cash so players can reach the markets at all, so the baseline is non-zero by
construction and what must not move is the delta); **(2)** every driven market is REACHABLE — one that
took zero posts with 36 funded, levelled players trying is a gate bug, not a quiet town; **(3)** the
CENSUS reconciles with the FLOW. That third check exists because it caught its own author: a first cut
queried the loans table for `status='offered'` when the word is `'open'`, counted zero every run, and
was one commit from publishing "the Shylock ended EMPTY" as a finding about the GAME rather than about
a typo in a SQL string. The rule that catches it is simple — if more went in than came out, something
must still be standing. Mutation-verified, and **the first mutation attempt PASSED**: at 12 players
every loan offer gets taken, `posted == taken`, and the check is vacuous — a bad mutation reads exactly
like a clean bill of health (the same trap `tools/mobile.js` sprang). CI runs 18×2, the smallest size
where it bites. The same "counted, never silently nothing" discipline found three dead branches before
they could report zeroes as findings: a `goods[0]` read against an id-keyed map, a district read as a
commodity (`prices.goods` is keyed by DISTRICT then good), and a `unitPrice` body field the market
handler does not read — it takes `price`; the neighbouring `/v1/exchange/list` is the one taking
`unitPrice`, which is precisely the class `test/client.js` check 3 exists for. **Measured at 36 players
/ 5 days:** every market reachable, §10.4 exact across 23 checks, liquidity real but thin — goods lots
100% taken (CLEARED, not dead — the output now says which, since a market that sold out and a market
nobody wanted both read as "empty"), loan offers 20%, bodyguards 20%, duels 19%, contracts 12%, and
wealth flat (top 10% hold 12%). Honest scope, stated in the output: car auctions and speakeasies are
censused but NOT driven, and are labelled so an undriven zero never reads as a finding.

**TOKENOMICS v2 — THE EXCHANGE + THE FAMILY YIELD (founder-directed 2026-07-27; step 1 of
`omerta-tokenomics-v2-design.md`).** The founder ruled: cash → OMR is severed, OMR supply becomes
unbounded with **bonds as the only mint**, individual yield is repurposed to a **family** yield,
the sell tax is **9% sell-only** (LP / stock-buying / founder), and burn-to-redeem of real stock
tokens is **legal-cleared and Robinhood-approved** (recorded as a founder assertion; the mechanical
`allocated ≤ held` anti-Ponzi wall is kept regardless). The thesis: today every cash faucet is
secretly a token-price decision, because cash converts to OMR — a measured **$21.6M/day** maxed
passive stack sits one swap from sell pressure. Sever the link and cash becomes purely internal.
This drop is the off-chain core, `src/exchange.js` + `test/tokenomics.js` (the **57th suite**).
**THE EXCHANGE** replaces the AMM rather than half-disabling it — a one-directional constant-product
AMM is not a market but a draining bucket (every trade removes cash, nothing refills it, reserves
skew monotonically until the price nears zero). So: **burn X $OMR → X × `RATE` cash, out of a pool
only real cash SINKS fill** (`EXCHANGE.FUND_BPS` of the street take, carved inside the buyback's own
transaction so the 12h due-check and the `street_tax` lock are already held — ONE implementation,
`carveExchange`, shared with the standalone path). The Phase-4 stake-pool discipline applied to cash:
**a dry pool refuses cleanly and burns NOTHING** — a claim on what was funded, never a promise. Per-
account rolling-24h cap (the D3 wash bucket). §10.4: `window:burn` an $OMR BURN, `window:payout` a
character_id'd cash FAUCET, plus a new real-value invariant **`exchange pool backed`** (paid ≤
funded) proving the cash side is a redistribution, not inflation (the `runVigInvariants` shape). The
prefix is `window:` NOT `exchange:` — the M3 cb/ammo barter board already owns that, and two systems
sharing a reason prefix is how a vocabulary check stops meaning anything. **THE FAMILY YIELD**
(`family_yield_pool` → `gangs.omr_reserve`, ledgered `yield:family`) is a pure TRANSFER between two
buckets already inside `omrBuckets`, weighted 5-4-3-2-1 across the top `SEATS` families by **this
season's** standing (the econ-pass formula that made seats re-contestable), skipping a family that
dissolved between the read and the write so its share stays in the pot. So standing stops being only
a badge, and $OMR gains a reason to be held by an ORGANISATION rather than sold by a person.
**THE INTERLOCK — found while building, and load-bearing.** The design's claim that arbitrage is
impossible "by construction" holds only ONCE cash → $OMR is gone; while the AMM buy side is live, a
fixed-rate window is a **money pump** whenever spot sits below `RATE` (buy low, redeem at `RATE`). So
the window ships **SHUT** (`EXCHANGE.OPEN: false`) and opens in the same change that retires the buy
direction — and that is ENFORCED, not remembered: the test performs a swap buy and, if it succeeds,
asserts the window is closed, so opening it early fails the suite rather than quietly printing money.
`EXCHANGE_OPEN=on` (the test override) is classified TEST_ONLY in `preflight.js`, so it cannot reach
production by being forgotten either. **Nothing signed was retuned:** `carveExchange` returns 0 while
shut (the 30% buyback diversion arrives with step 2, and wants a re-sim then), and
`FAMILY_YIELD.FUND_BPS` ships at **0** — the buyback splits exactly as before. That zero is the
MIGRATION DIAL: raise it as `stake:reward`/`dividend:omr` retire, or the yield pays twice. Four
mutations, four caught at their own assertion (burn-before-the-dry-gate; `window:burn` dropped from
`omrBurns` → drift reads 190 not 200, i.e. the exact number proves the burn is accounted; the family
yield minting instead of transferring; the interlock). One thing worth remembering from the mutation
run: **under pg-mem ROLLBACK is a no-op**, so a burn written before a gate leaves its ledger row
behind even though the balance looks untouched — the dry-pool check therefore asserts the LEDGER, not
just the balance, or it would pass for the wrong reason. Two guards caught their own classes en route
(`test/routes.js` on the new public `/v1/yield`; `test/preflight.js` on the unclassified knob). Suite
57/57 + sim drift-0. Console: a Window + Family Yield card on Going Legit; both codices updated and
`the family yield` added to the drift detector. **NEXT** (design §7): retire cash → OMR and the
laundering surface (this is what opens the window), re-source the RWA float from the tax + bond
slices, then the contracts (`OMR.mint()` + the 9% three-way tax; `OmertaBond` minting behind the
daily cap / discount ceiling / accretive-only walls) — both reset the audit clock. Then **re-sim
everything**: the entire cash economy was balanced against an extraction threat model that v2 removes.

**RED-TEAM over tokenomics v2 step 1 (`AUDIT-tokenomics-v2.md`).** Five lenses (§10.4, locks,
exploit, cross-system, and the tests themselves). **No CRITICAL/HIGH, no §10.4 drift.** Verified
sound: the burn cannot mint (`spendOmr` guards finite-and-positive AND balance, and runs BEFORE the
pool decrement), the window's cash side is doubly bounded, `yield:family` is a real transfer, and —
importantly — the window's LACK of a jail/safehouse gate is CORRECT, not an omission: `economy.js`
documents the sell direction ($OMR → cash) as deliberately ungated ("bringing money back in-game…
only extraction prep carries risk"), and the window IS that direction. Fixed in-commit, each
mutation-verified: **F1 (MED)** `payFamilyYield` locked the pool BEFORE the gangs while `runBuyback`
holds gangs and then writes the pool — an AB-BA between two functions on the same worker tick, and
one **armed by the migration itself** (with FUND_BPS at 0 the buyback skips the pool write, so the
cycle appears exactly when the founder raises the dial the design says to raise); now ranks unlocked
→ locks gangs in id order → pool LAST. **F2 (LOW-MED)** per-share `round2` across the 5-4-3-2-1
weights could sum to a cent MORE than the pot (measured: 53 of the first 400 cent-values; a 0.23 pot
paid 0.24 and went NEGATIVE) → each share now clamps to `bal − paid`. **F7 (LOW-MED)** and the
invariant could not SEE F2: `family yield backed` carries a `+0.01` tolerance, exactly the size of the
overpay, so a negative pot read `ok:true`; added `family yield balance` (identity + never-negative),
the check the exchange pool already had. **F3 (MED)** `/v1/window` passed the connection POOL to a
function running inside a held transaction — a second connection acquired while the first is held,
which deadlocks the pool against itself under load — and took a write lock for a pure read the console
polls every render; now `readCharacter` + `client`, matching every sibling board. **F5 (LOW)** the
buyback had its own inline funding UPDATE beside the exported `fundFamilyYield` — the exact drift
hazard avoided for `carveExchange` and reintroduced next to it; now one implementation. **F6**
(hardening, NOT a bug) the only `localeCompare` id-sort before a `FOR UPDATE` in the tree — tested
rather than assumed (**200,000/200,000 canonical-UUID pairs agree with codepoint order**, so never
reachable), unified anyway. **F4 — against MY OWN TEST:** the §10.4 assertion ran AFTER distribution,
when the $OMR had already moved to gangs (also counted), so it could not see bucket membership —
**mutation-verified: deleting `family_yield_pool` from `invariants.js` left the file GREEN**;
conservation is now asserted with the $OMR parked in the pot and nowhere else. Two further
self-inflicted lessons recorded in the report: a verification probe that MISREPORTED because
`sed 's/a/b/'` without `/g` replaced only the first of two occurrences on a line (the printed label
said one check while the code read another), and a first F2 regression that was **vacuous** because it
seeded ONE family when the overpay needs five — it passed under the mutation. Same lesson the harnesses
keep teaching: a check that cannot fail reads exactly like a clean bill of health. Flagged, not changed
(ground rule #1): `payFamilyYield` runs hourly rather than on the 12h buyback cadence (harmless, but
tail seats fall under MIN_PAYOUT on a tiny pot), the fixed `EXCHANGE.RATE` against cash inflation, and
the 30% buyback diversion that lands when the window opens.

**TOKENOMICS v2 STEP 2 — cash → $OMR is SEVERED, and the window is open.** The retirements are
deletions, not disables: `swap` (both directions), `launderAtBusiness`, `claimRewards` and
`claimDividend` all throw a `retired` GameError that explains what replaced them; the AMM's cash
reserve is dead weight and the two individual-yield pools are DRAINED into `family_yield_pool` by
`mergeLegacyYieldPools` on the buyback tick (idempotent by construction — it moves a balance to zero,
so a second run moves nothing). The 12h buyback's job changed completely: it no longer buys $OMR off
an AMM, it carves the street take into the redemption window (`carveExchange`) and merges the legacy
pools. `EXCHANGE.OPEN false → true` and `FUND_BPS 3000 → 10000` are the two signed levers that moved,
recorded in BALANCE.md as `test/levers.js` demands. Business specs `accountant`/`fixer` (both scrutiny
plays) now throw `retired` — with no laundering there is no scrutiny for them to work on. **The
interlock test went VACUOUS when this landed** and that is the lesson worth keeping: `buySideLive`
went false, the whole conditional block was skipped, and the file still printed a pass. It is now an
unconditional assertion that the window and the buy side are never both live, plus a branch that
asserts all four retirements really are retired. Mutation-verified twice. Fallout in the tail was
~46 laundering-dependent assertions across economy/portfolio/social/chain/emission, and two of the
fixes were real findings rather than mechanical edits: the `not_maxed` spec-gate test was pointed at
`fixer`, which now throws before reaching the gate, so the gate had silently stopped being checked;
and the Launderer leaderboard had nothing to rank, so it now seeds a historical `laundered_lifetime`,
which is exactly the shape of a post-migration database. Suite 57/57 + sim drift-0 + mobile 54/54.

**TOKENOMICS v2 STEP 3 — the float re-sourced (design §6/§7.3).** `rwa_revenue` — the pot the
stock-buy bot draws on — was fed only by the Store earmark and `FEE_RWA_BPS`. Step 3 adds the two
sources §6 names, and the reason it is TWO is the whole point: the DEX sell tax scales with TRADING
VOLUME, bond ETH with PRIMARY INFLOW, and a one-way conversion is designed to produce a quiet market,
so a tax-only float grows fastest exactly when it is needed least. **(1) The sell tax** —
`rwa.js:recordSellTax` books one row per taxed episode in the new `sell_tax_events` (a `SellTaxTaken`
log on mainnet; `POST /v1/mod/rwa/tax` until step 4 arms the contract), splits the ETH by the new
`SELL_TAX` rules block (900 bps = dev 200 / rwa 400 / lp 300, load-time sum-validated against the
contract's `MAX_SELL_TAX_BPS` 1000), and mirrors ONLY the RWA slice into `rwa_revenue` (source
`tax`). The remainder rule sits on the LP slice — two of three slices round down at six decimals, so
three "natural" slices of a 0.1-ETH gross sum to 0.099999; the test uses a gross that actually
produces dust, because a gross that divides cleanly (0.18) proves nothing about the rule and my first
cut used exactly that. **(2) Bond ETH** — a fourth slice (`BONDS.RWA_BPS` 2500) mirrored into
`rwa_revenue` (source `bond`); `runBondInvariants` now reconciles POL + Dev + Vig + RWA == principal
plus a new check that the slice reached the bucket, since the accumulator alone is not what gets
spent. **The load-bearing property is the anti-fabrication gate**: a comp/QA episode records the
episode and books ZERO revenue, because fake revenue buys real-looking units and `allocated ≤ held`
compares allocation to HELD units — so fabricated backing is invisible to the very check that makes
"the game only ever owes stock it already owns" true. Mutation-verified: drop the gate and the suite
names the assertion. §10.4 is untouched by construction (zero `transactions` rows, no new reason —
the suite asserts it by counting ledger rows across a full re-sourcing cycle), and both the invariant
and the public `GET /v1/vault` board now publish revenue BY SOURCE, because "backed" is a claim a
player is entitled to audit. **The one judgement call, flagged (BALANCE.md + design §7.3):** §4's
table gives the whole remaining 6000 bps to LP and shows NO Vig slice — but the sentence directly
under it names `BONDS.POL/VIG/DEV_BPS`, so the omission reads as an oversight, and taking it
literally would defund the withdrawal reserve (`vig_revenue` → `runVigBuyback` → `fundReserve` → the
full-reserve queue), which after step 2 is the only real-value exit anyone has. RWA 2500 / DEV 1500
are the design's numbers as written; the remaining 6000 keeps the signed 5:3 POL:VIG (3750/2250)
rather than zeroing one side. If the Vig slice really is meant to go it is one line
(`BOND_POL_BPS=6000 BOND_VIG_BPS=0`). Both codices also had a stale "the window is shut right now"
from step 2 — corrected in the same pass. **Still owed: the step-5 RE-SIM.**

**RED-TEAM over tokenomics v2 steps 2+3 (`AUDIT-tokenomics-v2-steps-2-3.md`).** Step 1 had its own
five-lens pass and it found a lock cycle **armed by the migration itself** — reachable only once
`FUND_BPS` was raised off zero, which is exactly what step 2 then did. Steps 2 and 3 had shipped
without one, so this ran before step 4 goes near `OMR.sol`. **No CRITICAL/HIGH, no §10.4 drift.** The
central claim was checked at the source rather than by inspecting the retired routes: `omrMints` is
the enumerated set of everything that can create $OMR (`mission:%`, `prize:omr`, `emission:%`) and
**none of them takes cash as an input** — there is no path, direct or laundered through a third
asset, from cash to token supply. Fixed, each mutation-verified: **A1 (MED)** the legacy-pool merge
was gated on the buyback's CASH due-check, and step 2 had removed every other drain from
`stake_pool`/`rwa_dividend_pool` — so on a server whose take is quiet, real player-earned $OMR would
sit stranded forever while **nothing alarmed**, because both pools are inside `omrBuckets` and
conservation stays exact the whole time the money is unreachable; the merge is now its own worker
step (`mergeLegacyPools`). **C1 (MED)** `GET /v1/opportunities` — the surface AGENTS.md tells agents
to POLL — still advertised `Cash→$OMR via POST /v1/swap` and published an AMM spot price for a market
that no longer trades; an agent has no way to tell a dead niche from a live one except by burning
calls on it. Replaced with a `redemption` niche carrying the window's live rate and till; AGENTS.md's
earn-loops table fixed. **The test that should have caught C1 asserted the wrong property** —
`typeof niches.laundering.ammSpot === 'number'` stayed TRUE for a whole release after the rail
retired, because a stale niche still has a shape; it now asserts no niche anywhere sends an agent to
`/v1/swap`. Plus three LOWs: `payStakeRewards` was dead code that read as the live drain for
`stake_pool` (and A1 is exactly the bug you get from believing it), `STAKE_POOL_BPS`/`AMM_LP_BPS` are
orphaned but PINNED levers so they are marked DEAD in place rather than deleted (a pin dangling at a
deleted constant fails the register), and `chain.js` documented the exit toll as `tax:buyback →
stake_pool` when step 2 had repointed it to `family_yield_pool`. Verified clean: `rwa_revenue` cannot
be double-fed (PK `(source, ref)`, distinct sources, each idempotent), the window's clamp cannot be
raced (pool locked before the check, burn after), no cycle around `family_yield_pool` (every other
writer takes it last), and the whole re-sourcing writes zero ledger rows. Flagged not changed: the
ops dashboard still shows AMM reserves (the founder's own screen, and the number is real — just no
longer a price), and `/v1/rules` still lists the two retired business specs (a clean refusal, and
removing them would erase the record of what an existing `accountant` front is). Suite 57/57 + sim
drift-0. **The step-5 RE-SIM is unchanged by this pass and still the largest open item.**

**TOKENOMICS v2 STEP 4 — OMR MINTS NOW, AND THAT DELETED THE SUITE'S OLDEST PROPERTY**
(`omerta-contracts/src/OMR.sol` + `OmertaBond.sol`, `test/OMRTax.t.sol` + `OmertaBond.t.sol`;
design §4). Until this drop the token had **no mint function at all**, and "nothing mints" is the
single sentence every prior contract audit of this suite rested on. The founder retired it: supply
becomes unbounded and **bonds are the only mint**. What replaces a fixed cap is not a promise, it is
walls, and the whole review value of the change is whether they hold. **`OMR.mint()`** is callable
only by a single `minter` address, owner-set and evented, shipping **unset (= minting off)**; there
is deliberately **no owner mint**, so "the Safe was compromised" and "supply was inflated" stay two
separate events, and `setMinter(0)` is a one-transaction emergency stop that needs no pause and no
change to the bond contract. **`OmertaBond`** dropped the Safe-funded tranche and now mints each
payout **at bond time** (not at claim) — which is what keeps `committedOMR <= omr.balanceOf(this)`
true at every instant, so `sweep` still cannot touch OMR backing an outstanding bond and a claim can
never fail for want of balance. Three walls replace the tranche: **(1) `dailyCapOMR`** — with no
tranche bounding the total, this is now the entire blast radius of a leaked quote-signer and the most
load-bearing number in the system (and **0 means UNLIMITED**, so a deploy that forgets it has no wall);
**(2) `MAX_DISCOUNT_BPS`** 2000, compile-time — a discount is a mint at a price; **(3) `maxOmrPerEth`**,
the post-discount mint-RATE ceiling, **fail-closed at 0** (the GearVault gear-cap precedent) so
forgetting it turns the product off rather than open. **The design finding worth keeping:** §4's
"accretive-only" wall, read literally ("mint only when the ETH received is worth at least the OMR
issued"), forbids *every discounted bond* — a discount is by definition issuing OMR worth more than
the ETH paid, so the literal wording and the product contradict each other. The real (Olympus)
meaning is treasury-BACKING accretion, which needs reserves ÷ supply — unknowable in a contract that
custodies nothing and forwards every wei in-tx, and an oracle on the mint path would make that feed
the thing standing between a leaked key and unbounded supply. So wall 3 is a hard Safe-set rate
ceiling: weaker as economics, stronger as a wall, and documented in-contract as a deliberate
deviation, flagged for the founder and for the third-party audit. Backing accretion belongs in the
off-chain policy that decides what price to sign, where it can read the whole treasury. Also landed:
the **9% three-way sell tax** (dev 200 / rwa 400 / lp 300 bps of a 900 total) replacing the old
50/50 dev/buyback split, in lockstep with the backend `SELL_TAX` constants, with the **remainder rule
on the LP slice** so the three shares sum to the tax EXACTLY (two of three round down; a "natural"
third slice strands a wei belonging to nobody — the same discipline the backend ingest uses).
**77/77 forge green** (from a 73/73 baseline), incl. both 512-run fuzzes. Two process notes: a first
cut of the anti-Ponzi fuzz asserted `totalSupply() == 100_000_000e18`, i.e. the property this drop
deliberately deletes (rewritten to `supply0 + expect`); and three tests failed `NotPayer()` because I
hit the subtree's own documented cheatcode footgun — inserting `uint256 supply0 = omr.totalSupply();`
*between* `vm.prank(bonder)` and the guarded call makes a staticcall that consumes the prank. Hoist
reads above cheatcodes. Docs: the subtree `CLAUDE.md` rules 2/5/6 rewritten (they described the
deleted invariants while sitting next to the changed code), `omerta-contracts/README.md`,
`CHAIN-DEPLOY.md` (deploy order now ends at `setMinter` — arm the mint LAST, after both caps are real
values — plus the two kill switches and a note that **the third-party-audit clock is RESET**: any
auditor must be pointed at the deleted property and at what replaced it). **Mainnet is unchanged and
still blocked on gates 2 + 3** (third-party audit of contracts AND signer, legal counsel); gate 1
(`forge test`) stays green. **Still owed: the design's step-5 RE-SIM** — the entire cash economy was
balanced against an extraction threat model that v2 removes.

**SIZING THE BOND DIALS — `tools/bond-dials.js` (`npm run dials`, the 8th harness).** The four walls
step 4 + the oracle introduced (`dailyCapOMR`, `maxOmrPerEth`, `priceToleranceBps`,
`OmrTwapOracle.PERIOD`) were all unset and all blocking a deploy, with CHAIN-DEPLOY.md saying "set them
small" — advice, not a number. This derives them: pure arithmetic over the real constants, no server, no
chain. The threat model is one attacker, the leaked quote-signer, who can sign anything but must still
PAY the ETH and still SELL the OMR. **Two findings changed my own first answer.** (1) I initially sized
the daily cap as a share of supply (0.05% = 50,000/day) — but a 50,000 dump into a 100-ETH pool makes OMR
**19% cheaper in a day**, and 100,000 makes it **40% cheaper**, while both are a rounding error against
supply. **Price impact, not dilution, is the damage, and it is a function of POOL DEPTH** — so the
recommendation is a RULE (≈5% of the pool's OMR reserve, ~27,000/day at 100 ETH) sized so a full day's
cap dumped moves the price ≤10%, re-derived whenever POL deepens. "% of supply" would have been ~4× too
loose. (2) The attack goes **loss-making** at larger caps (a 500,000-OMR haul realises **−32 ETH** — the
exit craters the price it sells into) and it is tempting to call the cap self-limiting. **It is not**: a
griefer needs no profit, and anyone short elsewhere profits from the crash. Size on damage, never on
attacker P&L. Two more: `MAX_DISCOUNT_BPS` is FIRST-order and the oracle tolerance second (at the 20% cap
a leaked signer already buys 25% under market before touching any feed, so beating the TWAP by 5% adds a
few points on top — `maxOmrPerEth` and the cap are the walls that matter); and **the 9% DEX sell tax is
also an anti-manipulation tax**, since moving the oracle UP requires SELLING, and the round trip never
recovers the tax — most tokens' TWAP-manipulation cost is slippage alone, here it is slippage plus a hard
9%, which was not its purpose and matters if anyone proposes lowering it. Recommendations are in
BALANCE.md and inline in CHAIN-DEPLOY.md's deploy order. **Flagged, not changed:** there is no MINIMUM
vest (`vestSeconds >= 1` is legal and the ATTACKER's quote picks it; `claim()` is also not
`whenNotPaused`) — so the daily cap is realised IMMEDIATELY, which is the assumption the sizing uses; for
an honest bonder the server sets the full 120h, so vesting is a product feature and not a security
control, and the point is not to count it as one. Also `quoteBond` clamps to the CEILING rather than the
oracle price, so drift always resolves toward more OMR per ETH — defensible, worth deciding deliberately.
**The thing that is not a dial:** every number scales with pool depth, so the strongest action available
for these walls is POL, not a setting.

**RED-TEAMING THE ORACLE — and both findings were about a number being published, not stolen
(2026-07-29).** Tokenomics v2 step 4 deleted the property every prior contract audit of this suite
rested on ("nothing mints") and replaced it with four walls. Wall 4 — the accretion oracle — is the
newest, the only one that reads state it does not own, and the only one with a moving part off-chain,
and it had shipped without an adversarial pass. Report: `AUDIT-oracle.md`. **No CRITICAL. Two real
findings, one per layer, both fixed and mutation-verified. forge 107/107.**

**F1 (MED, backend) — the clamp rounded ITSELF over the ceiling.** `quoteBond` clamps a too-high price
down to something the contract will accept, specifically so a player never receives a quote whose
`bond()` reverts. It clamped to the **ceiling** and then `round6`'d it — and `round6` ROUNDS, so it
rounds *up* whenever the seventh decimal is ≥ 5. **Measured at 50.0% over 200,000 samples**, which is
also what theory says (a uniformly-distributed residue rounds up exactly half the time). So roughly
every OTHER clamped quote would have reverted `PriceAboveOracle` on-chain — on the exact code path
whose only job is to prevent exactly that, and it would have surfaced on mainnet as intermittent,
price-dependent, apparently random bond failures. Fixed by clamping to the oracle **price**, which
leaves the whole tolerance band as headroom so rounding cannot breach it — and which also resolves the
dials pass's open question about clamp direction in the conservative one: the ceiling is the most
GENEROUS price the wall permits, so clamping there resolved every disagreement between our feed and the
chain's toward MORE OMR per ETH. The clamp only runs against a live bond chain (dormant in the suite),
so the regression pins the ARITHMETIC that makes the fix correct rather than faking a chain.

**F2 (MED, contract) — an unbounded window let a dead price be published as fresh.** `PERIOD` was a
MINIMUM with no maximum, so `update()` closed whatever interval had elapsed and stamped
`lastUpdate = now`. The consumer's defence is `maxOracleAge` — but **that measures when the average was
COMPUTED, not what period it COVERS**, so a multi-day interval closed one second ago is one second old
by that measure. Measured on the real contract: after a nine-day keeper outage spanning a run to 20,000
that then crashed back to 5,000, it reported **19,998.84** — four times spot, stamped fresh, invisible
to the staleness check. Three things made it exploitable rather than merely wrong: `update()` is
permissionless (deliberately — a keeper-gated poke means a lost key freezes the product), so whoever
pokes **chooses when the window closes**; the high price **costs the attacker nothing to create**,
since ordinary volatility during an outage does the work; and a keeper outage is exactly when nobody is
watching. Wall 3 (`maxOmrPerEth`) still bound absolutely — that is the composition argument, and why
this is MED — but wall 4 would have stopped contributing at the moment it was most needed. Fixed by
bounding the window on BOTH sides: an interval longer than `PERIOD × MAX_WINDOW_MULT` (4) is
**DISCARDED, not averaged** — re-baseline, `priceAverage = 0` so `consult()` reports "no usable
reading" and the bond reverts, and emit `Rebaselined` so the outage is visible rather than silent.
Fail-closed; recovery is one honest period.

**The process lesson, in a new costume.** The F2 mutation appeared to SURVIVE. It had not: the
regressions had never been written, because I ran `cd omerta-contracts && python3 - <<'PY'` from
*inside* `omerta-contracts` — the `cd` failed and `&&` short-circuited the edit away. `grep -c` showed
zero. The three tests that did run were exploratory probes that only `emit`, so they survive any
mutation. **A check that cannot fail reads exactly like a clean bill of health**, and this is now the
fourth distinct way that has happened (mobile.js's dead `MIN_TAP`, scale.js's vacuous liquidity assert,
the client wiring test's unreadable ternaries, this). Every edit-by-heredoc now asserts its own marker
landed. Separately, my first F2 probe scenario was simply WRONG — a ten-day window at a *sustained*
price reports correctly, because the average of a constant is that constant; the finding needs an
outage that SPANS a move and then reverts, and constructing that was most of the work.

**The MIN_VEST question, decided: do NOT add one** (it had been left hanging by the dials pass). The
tempting reasoning is that a minimum vest slows an attacker and buys response time. It does not, for
two reasons found by reading the contract rather than reasoning about it: **`claim()` is deliberately
not `whenNotPaused`**, so pausing stops new bonds but never stops already-vested OMR being claimed — a
vest is not a window in which the Safe can intervene, only one in which the attacker waits; and **the
blast radius is `dailyCapOMR` whatever the vest is** — a vest changes WHEN the capped amount lands, not
HOW MUCH, and the sizing already assumes immediate realisation, which is the conservative reading.
Adding one would buy a false sense of a security control while making honest bonds worse. **Vesting is
a product feature here, not a security control, and the value of writing that down is that nobody later
counts it as one** (recorded in CHAIN-DEPLOY.md next to the dials).

Verified clean: the composition (`maxOmrPerEth` and `priceCeiling()` are checked independently in
`bond()`, so a manipulated oracle can only ever TIGHTEN the bound), fail-closed at all four oracle
failure modes (unset / zero / stale / reverting), the `mulDiv` decode (fuzzed to `type(uint112).max/2`,
not a point test), the wrapping cumulative arithmetic, V2 counterfactual accrual on an idle pool,
derived-not-trusted pair-side selection, and no §10.4 surface anywhere in the oracle path. Flagged, not
changed: **the keeper is an operational dependency with no in-repo monitor** — a silent halt is
indistinguishable from low demand, and the backup watchdog (`archiverHealth` → `alertDrift`) is the
precedent for how it should eventually be watched. Mainnet still blocked on gate 2 (third-party audit,
whose clock step 4 reset) and gate 3 (legal counsel); this report is part of that packet.

**THE MIGRATION SWEEP — the levers nothing read, and the guard that now reads for them (2026-07-29).**
Tokenomics v2 ran five steps with no completeness pass, so this traced every dangling end. The method
became the deliverable: **`test/levers.js` check 4** — every one of the 379 pinned levers must be READ
by something in src/, alias-resolved (`BLACK_MARKET as MARKET`, `const R = SPEAKEASY.RENOWN`,
destructuring — without alias resolution a third of the register reads as dead), comments stripped (a
lever "mentioned" in prose is not wired — that is exactly what let the headline finding hide), with 8
deliberately-inert levers exempted each WITH a stated reason, and the exempt list itself asserted (a
listed-dead lever something now reads fails the run). **The headline: `FAMILY_YIELD.FUND_BPS` had zero
readers** — its documented source ("a share of each 12h buyback's bought $OMR") was deleted by step 2,
so the family yield — shipped, tested, audited — paid out of the one-time legacy drain and then nothing,
forever. Founder chose re-homing over retirement: **the family's cut of every Window redemption** (5%,
`yield:window`, a TRANSFER replacing a slice of the `window:burn` — zero new reasons, §10.4-neutral by
reclassification; the remainder rule sits on the burn so cut+burn == what the player spent exactly).
The honest cost is less deflation, recorded in BALANCE.md. Two more real findings: **the console still
SOLD laundering** (the Empire catalog's headline, per-tier wash figures, per-front "wash headroom", the
coach card, and a "launderable" glossary entry — all false since step 2; a player was buying fronts for
a capability that does not exist) and **an entire risk layer went dark as a side effect** — business
scrutiny grew ONLY from laundering, so nothing writes it and no front can ever be Bureau-raided again
(`business:raid` unreachable; fronts are now strictly safer than the L1a/L1b curve assumed — flagged for
founder sign-off, not patched). Four decorative levers were wired to the code duplicating their values
(the 3h search clock in combat.js, the capstone cost hardcoded per tree entry — hoisted so tree and
lever are ONE const, ring poker's idle timeout as a SQL literal — now parameterised) and six step-2
orphans marked DEAD in place. **Three lessons paid for:** (1) my own sweep produced two false positives
before it produced the truth — excluding rules.tail.js wholesale hid `heistFenceMultOf`'s read of
HEIST_FENCE_LO, and single-segment levers (every HEIST_*) were never checked at all because the dotted
suffix loop cannot run on one segment — a guard's false positive is as corrosive as its false pass;
(2) the full-balance redemption edge fires on only ~13% of 6dp values (the float remainder dips below
the rounded burn), so my first fixture (12.345678) tested nothing and the mutation survived — the
regression now uses a MEASURED-triggering value (10.011) with the survivorship written into the comment;
(3) the guard's honest scope is REFERENCED, not GOVERNS — unwiring the lever from `redeem` alone left it
green because the board still displayed it; only zero references fire it. Suite green + sim drift-0;
mutation-verified ×4 (over-burn, cut-never-delivered, re-round dropped, lever unwired).

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
M1 + M2 + M3 complete and tested (`npm test` runs all three journeys). M2 shipped the
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

M2/M3 discrepancies raised (prototype wins per ground rule #1): asset sell-back is
**80%** not spec's 70% (`economy.js:sellAsset`); gang joining is **immediate** (no
apply/accept queue — v24 `joinGang`); war duration **30 min** pending the §9 design
call. Test-only env knobs `SEARCH_MS`/`SHOOT_CD_MS` shrink the §9 hit timers — never
set them in production.

Next: **M4 (Kitchen + growth)** — full §7.10 (makings/cook/collect/deal, crew, raids
in accrual), paths, trade ranks, heist + missions + daily jobs, First Week with real
OAuth verifies, referrals (§7.13), telemetry, mod tools.

## Sensitive design notes
- $OMR framing is utility-only; never add mechanics implying price appreciation.
- Social/onboarding rewards pay in-game cash only, never $OMR (v24 rule).
- Agent-flagged accounts: excluded from referral payouts, harder rate limits, public badge.

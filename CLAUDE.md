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
M1 + M2 complete and tested (`npm test` runs both journeys). M2 shipped: the garage
(boost/melt/repair/fence), workshop (craft/ammo) + consumable use, trade goods on the
deterministic price hash (§7.11, `hash01`/`goodPriceOf` in the rules.js tail, SEED via
`MARKET_SEED` env), rackets/assets with lazy income accrual (§7.1), the row-locked AMM
swap (§7.12), staking (real 14% APY, lazily accrued on the account row), NFT gear mint,
and the 12h buyback worker (`src/worker.js`). `withCharacter` now row-locks the character
**and** its account and accrues both. Ledger invariants tested: cash faucets/sinks all
ledgered, and car conservation (boost is the only faucet; melt/fence the only sinks).

Two things deferred to M3 by design (flagged in code): the melt **tithe** to a family
armory and family-turf **price discounts** need gangs, and the buyback's 50% family split
routes wholly to the event fund until families exist. One spec/prototype discrepancy
raised: asset sell-back is **80%** (prototype `sellAsset`) not 70% (spec §5.4) — prototype
wins per ground rule #1; flip the constant in `economy.js:sellAsset` if design says 70%.

Next: **M3 (social)** — gangs, wars, turf, jumps, bounties, notifications, websocket, hit
contracts + death, busting. Extend `withCharacter` to lock **both** parties in a stable
order (§10.1) for the two-party actions.

## Sensitive design notes
- $OMR framing is utility-only; never add mechanics implying price appreciation.
- Social/onboarding rewards pay in-game cash only, never $OMR (v24 rule).
- Agent-flagged accounts: excluded from referral payouts, harder rate limits, public badge.

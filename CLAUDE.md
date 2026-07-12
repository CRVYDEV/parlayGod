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
M1 complete and tested. Next: **M2 (economy)** — garage/melt/tithe, workshop, exchange escrow, trade goods with the deterministic price hash (§7.11 — keep SEED server-side), rackets/assets accrual, the AMM swap with row lock (§7.12), and the 12h buyback worker. The prototype implementations to port live in `omerta-game-v24.jsx` (search for `boostCar`, `meltCar`, `ammSwap`, `runBuyback`).

## Sensitive design notes
- $OMR framing is utility-only; never add mechanics implying price appreciation.
- Social/onboarding rewards pay in-game cash only, never $OMR (v24 rule).
- Agent-flagged accounts: excluded from referral payouts, harder rate limits, public badge.

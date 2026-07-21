# AUDIT — The Port step four (the contraband market + berths)

A focused three-lens red-team (§10.4/persist, concurrency/locks, exploit/grief) over the warehouse +
fence + berths. **No CRITICAL/HIGH/MED — no code fix required.** The highest-risk vector (a persist
double-dip) was verified safe against the exact column list; the rest checks out.

## Verified CLEAN

**Persist double-dip (the CRITICAL vector) — SAFE.** `collectRun`'s warehouse branch does
`UPDATE characters SET contraband = contraband + sale` by direct SQL and does NOT mutate `ch.contraband`;
`fenceContraband` does `UPDATE characters SET contraband = 0` by direct SQL while crediting `ch.cash`. If
`persistCharacter` wrote `contraband` from the stale in-memory `ch`, it would (a) erase a warehouse
increment, or WORSE (b) on fence, re-set contraband to its pre-fence value AFTER the cash was already
credited — a §10.4 cash+goods double-dip. **Verified against source:** `persistCharacter` (game.js:458) is a
fixed 60-column positional UPDATE (`$2`…`$60`, ending `wire_until`) that includes NEITHER `contraband` nor
`berths` (they follow the `port_used`/`port_at` direct-SQL, persist-exempt pattern). So both direct-SQL
writes stick; `ch.cash` (which IS persisted) carries the fence proceeds correctly. No double-dip.

**§10.4 — the fence faucet is bounded.** `port:fence` = `floor(book × fenceMultOf())`, `book` = accumulated
`hold × route.sell` from warehoused runs, each sourced under the daily `SUPPLY_CAP`. So the faucet is bounded
by supply-capped sourcing × the fence band (≤ 1.25), a ledgered `port:` cash faucet — the per-character
`character cash` check reconciles (the test proves drift-0). Contraband itself is a NON-currency resource
(like cargo, not in the §10.4 set). **Death is §10.4-clean:** a smuggler killed holding contraband never
fences it — the `port:buy` sink stands with NO owed faucet (the risk of warehousing), so nothing leaks;
`contraband`/`berths` die with the street automatically (the heir is a fresh `INSERT` with cols defaulting
to 0 — social.js:1462).

**Concurrency — serialized.** `fenceContraband` is single-party under `withCharacter` (the char row is
`FOR UPDATE`-locked), so two concurrent fences serialize — the second reads `contraband = 0` → `nothing`; no
double-spend. `collectRun`'s warehouse branch locks the boat `FOR UPDATE`, so a warehouse-collect and a
concurrent piracy serialize on the boat exactly like the fence-now collect (no double-realize). `rentBerth`
and `buyBoat` both run under the char lock, so the berth increment + the fleet-cap read serialize. The
fence's `harborToll` locks `char → gang` (the step-three helper, unchanged — dissolution-race guarded,
own-family exempt, clamped), acyclic.

**Exploit / grief — bounded.** No transfer path for contraband (it can't be handed to an alt to dodge the
supply cap or death). The `warehouse` flag only applies inside the CLEAN branch, so an interdicted run can't
be "warehoused" to dodge the seizure. Fence gates match collect (jailed / safehoused-D2 / at-docks). Berths
are capped (`BERTH_MAX` 3). Hoarding contraband forever just defers the cash (and the death risk).

## Flagged for founder sign-off (balance, NOT a bug)

**The fence is a higher-variance faucet than auto-sell.** `fenceMultOf` drifts 0.85–1.25 (mean ~1.05), but a
savvy player who fences ONLY on high days realizes ABOVE the route rate — so skilled-play REALIZED emission
sits above the guaranteed auto-sell, bounded by the supply cap and offset by the death-loss risk + the
exposure window. This is the intended Risk-to-Earn market-timing reward; `FENCE_LO`/`FENCE_SPAN` are the
dials (drop the mean to 1.0 for a pure gamble, or narrow the span). Recorded in BALANCE.md — **sim the
realized $/day for a market-timer before production.**

Suite 32/32 + sim drift-0.

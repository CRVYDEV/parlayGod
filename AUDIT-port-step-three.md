# AUDIT — The Port step three (the Smuggler's Legend + the Harbormaster)

A focused three-lens red-team (§10.4/persist, concurrency/locks, exploit/grief) over the step-three
surface. The drop faithfully reuses two battle-tested patterns — the **convoy destination toll** and the
**account-level legend** (boxing-wins/wheel/war-effort) — so it comes back **CLEAN: no CRITICAL/HIGH/MED,
no code fix required.** Verified point by point below; one status-only balance item flagged.

## Verified CLEAN

**Persist-clobber (the highest-risk vector) — SAFE.** `bumpSmuggled` updates `account_persistent.smuggled`
by direct SQL inside `collectRun`/`interceptRun` (both under `withCharacter`). `persistAccount`
(game.js:388) writes a FIXED column list — `omr, staked, rewards, prestige, deaths, recruits,
checkins_lifetime, ref_paid, onboard, wallet_address, minted, mint_credits, respawn_tokens, hitman_rep,
kills, unbonding, unbond_at, rat` — which does **not** include `smuggled` (nor any legend axis:
boxing_wins/race_wins/cartel_damage/intel_ops are all direct-SQL for exactly this reason). So the bump is
never clobbered by a stale in-memory account value. Confirmed against source.

**§10.4 — the toll is the convoy-toll twin, exact.** `port:toll` = 5% of a clean landing: one shipper
negative row (`character_id`'d → the per-character `character cash` check reconciles) mirrored by a direct
`UPDATE gangs SET treasury += toll` credit (accounted by the new `portTollIn` in the `gang treasuries`
check). The test drives it end-to-end and both checks reconcile drift-0. Guards inherited from the convoy
pattern all present: **dissolution race** (`if (upd.rowCount)` → `toll=0`, no ledger row, no shipper charge
if the holder gang vanished between the district read and the treasury UPDATE); **own-family exempt**
(`holder !== h.owned.gangId` → no self-tolling to move treasury); **clamped to pocket+bank, pocket-then-
bank** (and the shipper just received the sale, so the 5% toll is always affordable and bank never goes
negative); **NPC-held / unheld = free** (holder NULL → no toll). The legend bump is **zero §10.4** (landed
value isn't a currency; the cash rides the existing `port:sale`/`port:piracy` faucets — the test asserts
`smuggled == the account's lifetime port:sale + port:piracy`).

**Lock order acyclic.** `collectRun` locks `own char (withCharacter) → boat (FOR UPDATE) → holder gang
(UPDATE lock)`. Nothing in the tree locks a gang *then* a boat (territory/gang ops never touch boats;
piracy never touches gangs), so char→boat→gang has no reverse path — no cycle. The district holder read is
unlocked (a benign stale read → the toll goes to whatever real gang holds it, or none; the convoy toll has
the identical pattern). The leaderboard is a read-only full scan matching the other legend boards.

**Death / survival correct.** `smuggled` is account-level and never in the `runEstate` wipe, so the legend
outlives the street (the heir inherits it — the test kills the captain and asserts `smuggled` persists). A
piracy take counts once (for the pirate; the runner's voided run yields no `port:sale`, so no double-count).

**Grief / exploit bounded.** No self-toll (own-family exempt). A family farming tolls by holding the docks
is *intended* turf income, bounded by shippers' supply-capped landings, and requires liberating the docks
from the NPC occupation (World step five) + defending it — a real cost. The toll is a known 5% cost the
runner opts into by landing there.

## Flagged for founder sign-off (status-only, NOT patched)

**Legend vanity via self-piracy.** A Sybil pair can inflate the pirate's `smuggled` legend via self-piracy
(step-two's flagged loop). This is **pure vanity** — the legend is a status axis with no gameplay power, no
§10.4 surface, and agents are excluded from the leaderboard; it's the same posture as every account-level
legend (hitman-rep, the wheel, boxing). The `TOLL_BPS` (5%) + `LEGEND_RANKS` thresholds are the founder
sign-off levers; the toll adds a small treasury faucet that makes holding the docks more valuable (a turf
balance note in BALANCE.md), bounded by Port activity.

Suite 32/32 + sim drift-0.

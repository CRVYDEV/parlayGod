# OMERTÀ — the Tier-1 deepening program (design)

**Founder directive (2026-07-24):** expand every thin (Tier-1) system into a deep, feature-complete
(Tier-4-class) system. Six systems, each gets a coherent multi-step deepening — new mechanics +
catalog + a competitive/meta layer + a legend axis — riding already-audited patterns (no new money
surface invented). All numbers are founder sign-off levers (ground rule #1). Each drop: schema →
rules → module → routes → console → tests → suite+sim → commit; a combined red-team at the end.

The depth bar per system: **multiple orthogonal mechanics, a catalog that scales, a competitive/meta
layer, a status legend, and a console screen** — the shape of the deep systems (Casino, Pen, Wire).

---

## 1. THE DUELING LADDER → Tier 4

- **Step A — DIVISIONS + the season championship belt.** ELO maps to `DUELS.DIVISIONS` (Bronze →
  Diamond → Champion). A per-season `duel_belt` singleton: the highest-ELO active duelist holds THE
  BELT (status, recomputed on read — the Commission-seats precedent); a season-end worker crowns the
  champion into an account-level `duel_titles` legend (survives death, the boxing-belt pattern).
- **Step B — WEAPON STYLES (rock-paper-scissors depth).** Each duelist picks a `DUELS.STYLES` stance
  (Brawler / Fencer / Gunslinger) that beats one and loses to another — a `styleEdge` multiplier on
  the contest, so the BUILD isn't the only axis; counter-picking a listed opponent's stance rewards
  reading the board. Pure combat modifier, no §10.4.
- **Step C — THE DUEL TOURNAMENT (bracket) + spectator betting.** A scheduled cash-buy-in bracket
  (the poker-bracket escrow twin, but contests resolve on eff-stat+style+rand) — rounds of heats to a
  final paying `PAYOUTS` net of rake. Spectators bet parimutuel on the field (the boxing main-event
  twin). Reuses the audited escrow machinery → the escrow identities hold by construction.
- **Step D — THE GYM (Mickey tie-in) + grudge rematches.** The cornerman trains duel prowess
  (a status stance-mastery axis); a `duel_grudges` ledger (auto-tracked from losses) unlocks a
  reduced-cooldown REMATCH so a beaten duelist can chase redemption.

## 2. CREW HEISTS → Tier 4

- **Step A — the JOB LADDER 4 → 12.** `HEIST_JOBS` grows on-curve (corner-store → the Federal
  Reserve), each with crew size / level gate / take band / role requirements — the car-catalog
  precedent (content, `executeHeist` already handles any job).
- **Step B — THE CASING PHASE.** Before execute, the crew can `caseJob` (spend energy/time to raise
  the success roll) — a prep mechanic that rewards patience, bounded (caps at a max bonus).
- **Step C — THE FENCE PHASE (the deferred item).** A successful heist's take is now HOT GOODS
  (`heist_loot`, a value band) that must be moved through a FENCE — `fenceLoot` sells it at a
  fence-rate (heat + a cut) or a player can hold for a better rate at their own risk (a marked man's
  take can be looted). Turns the one-shot payout into a laundering mini-loop.
- **Step D — CREW LEGEND + notoriety.** `account_persistent.heists_pulled` + a crew notoriety board
  (the hitman-rep twin); notoriety draws bigger scores but more Law heat.

## 3. CLUE SCROLLS → Tier 4

- **Step A — TRAIL TIERS.** `CLUES.TIERS` (easy/medium/hard/elite/master) — longer trails, bigger
  caskets, rarer drops; the tier is rolled at drop by the crime's difficulty. Master clues drop only
  from elite content.
- **Step B — PUZZLE VARIETY.** Steps gain kinds beyond district+window: `anagram` (unscramble a
  district), `cipher` (a shifted clue), `coordinate` (a district+hour pair), `emote` (be-at-an-NPC).
  Deterministic off the §7.11 seed — server-verifiable, no stored answers.
- **Step C — CASKET RARITY + collectibles.** Caskets roll a rarity (`CLUES.CASKET_TIERS`) that can
  yield — besides the cash faucet — a STATUS collectible (a cosmetic trophy into the Collection, never
  $OMR-by-chance, the RWA rule). The rare-drop chase without touching the sim-audited economy.
- **Step D — THE CLUE-HUNTER LEGEND.** `caskets` already survives death; add `clue_master` tier ranks
  + a `GET /v1/leaderboard/clues` deepening (per-tier caskets) + a meta "casket log" (which archetypes
  you've opened — the Collection tie-in).

## 4. TERRITORY RACKETS → Tier 4

- **Step A — SPECIALISTS + SPECIAL OPERATIONS (the deferred step).** Assign a made-man specialist to a
  racket (a defensive fort/scrutiny bonus); each racket TYPE unlocks a special op (numbers → "cook the
  books" clears scrutiny; protection → "show of force" +fortitude; smuggling → "ghost the route").
- **Step B — the TYPE catalog 3 → 6 + a PRESTIGE tier.** More racket types (loansharking, chop-shop,
  counterfeiting) on the signed income curve; a post-max PRESTIGE upgrade (a status "Empire" flourish).
- **Step C — RACKET SPECIALIZATION TREE.** Per-racket upgrades (a small tree: yield / defense /
  stealth) bought from the treasury — recurring $OMR/cash sinks that tune the risk/reward.
- **Step D — THE SYNDICATE meta.** A family holding N rackets of the same type earns a syndicate bonus
  (status + a small signed-safe income multiplier flagged for sim) — rewards specialization.

## 5. SOVEREIGNTY → Tier 4

- **Step A — the STRONGHOLD tiers 3 → 6 + DEFENSE STRUCTURES.** More tiers; buildable defense
  structures (walls/towers/garrison) that stack siege resistance — treasury sinks.
- **Step B — MULTI-STAGE SIEGE.** A siege becomes a windowed campaign: declare → the vulnerability
  window → assault rounds (attacker chips structures) → the hold falls or repels. Reinforcement lets
  the defender pour treasury in mid-siege.
- **Step C — SOV INCOME + the frontier tie-in.** A held stronghold yields lazy tribute to the treasury
  (the territory pattern, bounded/capped); ties into the World frontier.
- **Step D — the SOVEREIGNTY meta leaderboard + alliances.** A `sov_points` board (already stubbed)
  deepened; coalition members can co-defend (the diplomacy tie-in).

## 6. MARRIAGES / SOLDIERS / SECRETS → Tier 4

- **Marriages:** betrothal politics (a proposal→courtship→wedding arc), dowries, the in-law alliance
  perk depth, a dynasty tree, divorce/annulment consequences.
- **Soldiers:** a BARRACKS (roster depth), soldier RANKS (recruit→capo) that grow with jobs,
  SPECIALIZATIONS (a small tree), squad assignment to multiple loops, a fallen-soldiers memorial
  legend.
- **Secrets:** secret TYPES (financial/criminal/personal), a blackmail NETWORK (chain secrets),
  counter-intel (buy silence / plant false secrets), a secrets MARKET (sell dirt to a third party).

---

**Build order (by leverage):** Duels (machinery exists) → Heists → Territory → Clue Scrolls →
Sovereignty → Marriages/Soldiers/Secrets. Commit per system. Combined red-team + docs at the end
(`AUDIT-tier1-deepening.md`, BALANCE flags, CLAUDE.md, codex). §10.4 stays drift-0 throughout; every
new faucet is bounded + flagged for the sim.

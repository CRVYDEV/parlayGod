# Tier-2 → Tier-4 deepening program (design)

**Directive (founder, 2026-07-24):** "Upgrade all the systems in tier 2 to tier 4 complexity."
The companion to `omerta-tier1-deepening-design.md`, walking DOWN the build-depth ranking: the
Tier-1 band (Duels, Heists, Clues, Territory, Sovereignty, Soldiers) is done; this is the Tier-2 band.

## What "Tier 4" means (the depth bar, unchanged)

A Tier-4 system has, at minimum: **multiple orthogonal mechanics**, a **catalog that scales**, a
**competitive / meta layer**, a **status legend** (account-level, survives death), and a **console
screen**. The deep exemplars are Casino, Boxing, the Pen, the Wire.

## The Tier-2 set (reconstructed from a module-size + step-count survey)

The second-thinnest systems with clear headroom — a single built "level," no step-two, thin catalog:

1. **THE KITCHEN** — one M4 level (makings → cook → collect → deal, crew, laylow). Deep catalog
   (8 drugs, 5 labs) but no orthogonal upgrade axis, no risk lever beyond raids, no legend.
2. **ASSETS & RACKETS** — buy-once/drip-forever passive income; no management, no upgrade, no risk,
   no meta.
3. **THE MEGAPROJECT** — the collective monument; one project at a time, no wings, no perks.
4. **THE FIVE PILLARS social layer** (Honor / Diplomacy / Campaigns / Bloodline) — each pillar a
   single mechanic; the honor axis has teeth but no ladder/meta.

> Note: "Tier 2" is a reconstruction of an earlier tiered inventory not in the working context. The
> founder can course-correct the membership. The Kitchen is the clearest, highest-leverage candidate
> and is built first.

## Discipline (per system, unchanged from Tier-1)

schema → rules → module → routes → console → tests → `npm test` + `node tools/sim.js` drift-0 → commit.
§10.4 sacred; every new faucet flagged for sim (ground rule #1); numbers are founder sign-off levers;
new state written by direct SQL stays OFF the persist positional UPDATEs (clobber-safe). Combined
red-team + docs at the end.

---

## #1 THE KITCHEN → Tier 4

Three orthogonal additions on the M4 loop, all §10.4-clean:

- **(A) LAB MODULES** — a purity/yield/stealth upgrade axis layered on the lab tier (`KITCHEN.MODULES`,
  each leveled 0..5, cost climbing with level + the lab tier; the top levels burn $OMR — the lab-ladder
  precedent). ONE touchpoint each: **purity** → cook quality, **yield** → batch cap, **stealth** → the
  accrual Bureau-raid probability. New `characters.lab_purity/lab_yield/lab_stealth` columns (direct-SQL,
  clobber-safe; read off the character row in cook/collect/accrual). Cash SINK `kitchen:module`
  (character_id'd) + an $OMR BURN `kitchen:module` at the top levels.
- **(B) CUTTING AGENTS** — `cutStash`: stretch a stash line by `CUT_UNITS` of its own qty at a
  `CUT_QUALITY` hit (floored at `CUT_FLOOR` — over-cut product is near worthless since the deal price
  scales on quality). A cash SINK `kitchen:cut` to buy the agent; units aren't a §10.4 currency (the
  stash is ownership). The risk/reward lever the drug loop lacked.
- **(C) THE KINGPIN LEGEND** — `account_persistent.product_moved` (lifetime GROSS moved across deal +
  offline crew sales), account-level → SURVIVES DEATH (the boxing-wins/wheel precedent), ranked
  `KITCHEN.KINGPIN_RANKS` (Nobody → The Kingpin of the City) on `GET /v1/leaderboard/kingpins`. Pure
  STATUS, outside §10.4 (`product_moved` isn't a currency; the cash still rides `deal:`/`crew:sales`).

§10.4: `kitchen:` joins the cash + omr `KNOWN_REASONS` (+ the omr burn term). The distribution/corner
network is a documented deferred step-two (it would touch turf).

## #2 ASSETS & RACKETS → Tier 4 (planned)

Management (assign/upgrade), a risk layer (shakedowns already exist on businesses — mirror for rackets),
a tycoon status legend. Details on build.

## #3 THE MEGAPROJECT → Tier 4 (planned)

Multiple concurrent projects / wings, district perks on completion (founder-gated — touches signed turf),
a builder legend. Details on build.

## #4 THE FIVE PILLARS → Tier 4 (planned)

Honor ladder + titles, deeper diplomacy (dowries/alliances), campaign chains, a bloodline meta.
Details on build.

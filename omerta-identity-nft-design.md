# THE MADE MAN — the identity NFT

*Founder-directed 2026-08-01. Design only; nothing here is built. The mint fee stays at **0.01 ETH**
(founder's call — the raise was considered and declined).*

> **EXTENDED 2026-08-09 by `omerta-dynasty-machine-design.md`** — founder-directed: the identity
> NFT is an uncapped **ERC-721** carrying an **ERC-6551 token-bound account** (the standard's
> mechanics verified against the EIP text), which holds the Stock Machine's activated allocations.
> The trophy/entitlement wall below STANDS — the entitlement stays account-bound in the DB — with
> one knowing, gated exception recorded there: the TBA makes the trophy a
> transferable container of on-chain value. **And §9 there adds THE PROVENANCE TRAITS**
> (holdings-derived generative markers off the launch snapshots — opt-in, once per wallet,
> banded, cosmetic only; this doc's layered-composition + review-the-layers + banded-traits rules
> bind it, and its opt-in stamp is how the wealth rule below survives the feature).
>
> **Three adversarial-pass corrections to THIS doc (2026-08-10, before the Phase-2 metadata
> freeze):** (1) **the portrait is dynamic while held by the minting account's linked wallet and
> FREEZES at first transfer away from it** — "ages with the bloodline" as written re-renders a
> SOLD token from the seller's ongoing play (the seller rats post-sale and the buyer's asset
> acquires the broken frame); a sold portrait is a photograph, which is this doc's own thesis.
> (2) **the on-chain metadata must not engrave the mutable STREET NAME, nor the exact
> Generation/Rank/Assassin conjunction** — a wallet-held public token mapping wallet → street
> name → an exact-field conjunction breaks the wallet↔character firewall the game guards
> everywhere else (the anti-precise-kill-EV rule must be re-run against the FULL permanent
> metadata vector plus the wallet linkage, not field by field; serial/generation on the plate,
> the name as an off-chain opt-in overlay at most). (3) **the §4 trait table's Dynasty-tier row
> references the retired Portfolio system (D11)** — drop or re-source it against a live system
> before any metadata is frozen.
>
> **AMENDED 2026-08-10 by `omerta-brokers-design.md` §3.3 — the exception is now recurring, and the
> word "trophy" no longer describes the whole token.** The founder decided that treasury-bought
> tokenized stock lands **straight in the token-bound account with no claim gate**. The 2026-08-09
> banner above called the TBA "one knowing, gated exception" to the trophy/entitlement wall;
> that framing assumed a bounded, one-off container. With no gate it is a **standing pipe**: every
> epoch adds real assets to the token, so the token is a **bearer instrument for real-world assets**,
> continuously, by design.
>
> **What survives, precisely, and what does not.** §1's wall still holds *for the game entitlement* —
> `account_persistent.minted` is a DB flag, nothing reads `balanceOf`, and selling the NFT does not
> sell the right to withdraw $OMR or draw the wage. That half is unchanged and should not be softened.
> What does NOT survive is the *one-line summary* as written: the NFT is no longer only a trophy, and
> a reader who takes "tradeable trophy" at face value will underestimate what a secondary sale
> transfers. It transfers real assets held in the token's own account, to a buyer with no identity verification and
> no eligibility check — which is the sharpest form of the concern §6 of the brokers design records,
> and the specific item flagged there as the thing to put on the launch checklist *before* delivery ships.
>
> **The consequence this doc owns.** §1's floor-vs-utility reasoning gets sharper and should be read
> with the brokers §3.3 note beside it: once the token carries contents, the cheap end of the order
> book becomes drained tokens and contents-versus-floor arbitrage, which is a different market from
> the one a portrait alone would have.
>
> **SUPERSEDED 2026-08-14 by `omerta-brokers-design.md` §3.4 — the stock moved OFF this token, and the
> wall is intact again.** The founder redirected treasury-bought stock into the **Street Deed** NFT's
> token-bound account, not this identity NFT's. So the "standing pipe" the 2026-08-10 amendment
> described is gone from this token: the Dynasty NFT holds **no** stock, `balanceOf` still gates
> nothing, and the one-line summary — **a tradeable trophy; the entitlement is not transferable** —
> is once again true of the whole token, with no bearer-instrument caveat. The contents-vs-floor and
> bearer-instrument concerns now live entirely on the Street Deed (`omerta-brokers-design.md` §3.4),
> which was already a tradeable, self-contained asset built to be sold. `DynastyNFT.sol` gates nothing
> on `balanceOf` — this decision keeps it that way, and it is the reason it was written that way.

---

## 0. What this is, in one paragraph

Being MADE costs 0.01 ETH and today buys an entitlement: the right to withdraw $OMR and to draw the
Street Wage. That is a **toll**, and tolls invite the question "how do I avoid paying this" — which
is exactly the frame a farmer arrives with. This design gives the fee something to *be*: a dynamic,
generative, mafia-noir **portrait of your bloodline** that changes as your street earns its reputation
and passes down through your heirs. Same price, same entitlement, but you get a thing.

**The one-line summary of every decision below:** the NFT is a **tradeable trophy**; the
**entitlement is not transferable**. Everything else follows from that.

---

## 1. Why the trophy and the entitlement must separate

This is the decision that matters and it is not obvious, so it goes first.

Minting is the **Sybil bound**. `BALANCE.md § THE FARM` measures what that bound is worth: 100
identities capture the entire daily wage budget for **1 ETH one-time**, and the mint fee is the only
thing charging for them. So the per-identity cost is load-bearing, and anything that lowers it in
practice matters more than anything that raises it on paper.

Now suppose the NFT is transferable *and* carries the entitlement. Then:

- the real per-identity cost stops being the **mint price** and becomes the **secondary floor price**;
- a farm does not mint at 0.01 — it buys the cheap end of the order book;
- and the cheap end of the order book is, by construction, **the dead alts of the last farm**.

The mechanism is self-feeding: farms create the cheap supply that makes the next farm cheaper. We
would have shipped a collectible whose most reliable buyer is the exact actor the fee exists to
price out, and the Sybil bound would decay toward whatever the floor is — silently, with nothing in
the game looking wrong.

**Three ways to resolve it, ranked:**

| | shape | Sybil bound | collectible value |
|---|---|---|---|
| **A ✅** | tradeable NFT, **non-transferable entitlement** | pinned to the primary mint — the only way to a *new* made account is to pay 0.01 ETH | full: real ownership, real secondary market, real royalties |
| B | soulbound NFT | pinned, trivially | weak — a non-transferable collectible is a badge, and badges do not carry the emotional weight this is being built for |
| C | tradeable, entitlement rides along | **decays to the secondary floor** | full |

**A is the recommendation and the assumed shape for the rest of this document.** Buying someone's
portrait gets you their art and their legend; it does not get you their standing with the house. That
is also the more *thematically* correct answer: you can buy a dead man's photograph, you cannot buy
his reputation.

**Implementation note.** The entitlement already lives in the right place —
`account_persistent.minted` is an account flag, not a token. So A is the *default* behaviour of the
system as built: it requires us to **not** wire the entitlement to the token, rather than to add
anything. Worth stating explicitly in the contract comments, because the natural instinct when
writing an ERC-721 gate is to check `balanceOf`, and that one line is the whole difference between A
and C.

---

## 2. "Dynamic" and "generative" pull against each other

Both words are right about the *intent* and they imply opposite implementations, so this needs
deciding before any art is generated.

**Generation is expensive and slow.** `tools/art.js` runs against fal.ai at roughly **$0.05 and
several seconds** per plate. `tokenURI` is polled relentlessly by marketplaces, wallets and
aggregators. Generating on read is therefore not on the table at any scale — it would be a per-view
cost with a multi-second latency, on an endpoint that must answer in milliseconds.

That leaves three candidate architectures:

| | approach | dynamic? | cost per read | verdict |
|---|---|---|---|---|
| 1 | fixed image at mint, dynamic **traits** only | traits yes, art no | ~0 | safe but it is not what was asked for — the art is the point |
| 2 | **layered composition** — a pre-generated parts library, assembled live from game state | **yes, fully** | ~0 (an SVG/PNG composite) | **recommended** |
| 3 | pre-generate N variants, swap on state change | coarse | ~0, but N× the generation spend and it visibly "steps" | worse than 2 for more money |

**Approach 2 is how essentially every real dynamic NFT works**, and it happens to solve a second
problem we already know we have.

### The art-review argument, which is the stronger one

The art pass generated **147 plates and every one was reviewed by eye**. That review caught things no
prompt inspection would have: a "1940s telephone exchange" that came back a **modern server room**, a
**fully black frame** from a silently-failed generation, a designer lamp shot like product
photography, and — in the action pass — fal's safety checker returning *identical black frames* for
every dark card-table scene. The recorded lesson is blunt: **prompt review does not catch these; a
contact sheet does.**

A generative identity NFT means thousands of unique outputs. **Nobody can eyeball thousands.** So the
review discipline has to change shape:

> **Review the LAYERS, not the composites.** ~60 hand-picked, hand-reviewed parts; every composite is
> then safe *by construction* because it is only ever an arrangement of approved pieces.

This is not a compromise forced by cost — it is the only version of this whose output we can honestly
stand behind. Approach 1 cannot be dynamic; approach 3 multiplies the review burden by N.

---

## 3. The layers

> **BUILT 2026-08-10 — `src/portrait.js`, `test/portrait.js`, `GET /v1/identity/:characterId/portrait.svg`.**
> Phase 1 shipped, and the table below is the DESIGN; three of its slots were changed in the build for
> reasons that are corrections rather than compromises, and §4's own rule is what forced them.
>
> **THE BRIGHT LINE, as built: the portrait encodes only what `publicDossier` already discloses, plus
> per-character deterministic art variety.** §4 states the constraint exactly right — a free,
> permanently-public, marketplace-indexed surface must be *at most* as revealing as the paid one — and
> then this table breaks it twice:
> - **backdrop ← "home district"**: there is no home district in this game, only live `loc`, which is
>   precisely what the Wire's PAID tap sells. A keyless image keyed on it is a position tracker a
>   hunter can poll. **Built as deterministic from the character id** — the corner this street came up
>   on, fixed at birth. Same eight-way variety, zero leak.
> - **figure ← "build"**: `muscle`/`cunning`/`speed` are on no public surface and not even on the paid
>   dossier. **Built as deterministic too.**
> - **effects ← "…a broken frame for a rat"**: `rat` is a PAID Wire flag. **Dropped** — the build
>   asserts a rat's portrait is byte-identical to his portrait the moment before he flipped.
> - **frame ← "dynasty tier + estate tier"**: **`dynastyTierOf` DOES NOT EXIST** — it went with the
>   Portfolio at D11, exactly as the 2026-08-10 banner above warned. **Re-sourced to GENERATION**
>   (public, account-level, survives death), which is the better answer anyway: the frame is the
>   bloodline's age, pawn-shop pine deepening to gilt as the generations stack.
>
> The line is enforced STRUCTURALLY rather than by spot check: the route's only data source is
> `portraitRow`, and the suite asserts it may return no field `publicDossier` does not. Add `loc` and
> it fails by name — which it did, on its first run, catching the route parameter (allowed, with the
> reason stated: the caller supplied it).
>
> **The parts are DRAWN, not generated.** §2 assumed a pre-generated library; the art budget stands at
> $11.12 of a $12 cap (38 plates ≈ $1.90) and there is no `FAL_KEY`, so that was not on the table. The
> ARCHITECTURE is unchanged — layered composition, assembled live, ~0 per read — and the compositor
> does not care where a part came from, so any slot can take a generated plate later without touching
> the assembly. Open question 2 ("faces or silhouettes?") is answered in the build the way it leaned:
> **silhouette-forward**, the brim's shadow across the eyes doing the work. Two cuts were discarded on
> review — a lit oval with two dots reads as a smiley, and a hard-edged shadow band with glints in it
> reads as a domino mask; the shipped version fades the shadow, which is what light actually does.
>
> **ONE KNOWN GAP, flagged rather than half-closed.** §5 phase 1 says *"the heir inherits a
> recognisably related one"* — the build does not do that yet. The portrait is keyed on the CHARACTER
> id, so an heir is a new row, a new seed, and a visually unrelated man; only the frame and the
> engraved generation carry the bloodline. Closing it means seeding the *inherited* half (skin, the
> corner) off something stable per BLOODLINE while keeping the figure per-street — and the obvious
> key, the account id, must not reach a public surface, so the clean answer is the **dynasty name**
> (already public, already on the dossier, already the line's identity), with un-named lines keeping
> per-street variety. That also gives the dynasty-naming $OMR sink something visible to buy. It is a
> small change with a real disclosure dimension (any stable cross-character key is a linkage
> primitive), so it is a founder call, not a tidy-up. **Related, and for the CONTRACT phase:** §7's
> open question 3 asks whether the portrait survives death. Keying on the character answers it for
> phase 1 only — a token that persists across deaths must resolve its `tokenURI` to the ACCOUNT's
> current street, not to a character, and that is a decision the contract makes, not this.
>
> Six slots, composited back-to-front. Counts are a starting point, not a commitment.

| slot | ~parts | driven by | notes |
|---|---|---|---|
| **backdrop** | 8 | home district | the six core districts + two for unaffiliated/incarcerated |
| **figure** | 6 | build (`muscle`/`cunning`/`speed` dominant), path | silhouette + posture, not a face at this layer |
| **attire** | 10 | level band / rank (`RANKS`) | overcoat → three-piece → the boss's camel coat |
| **effects** | 8 | reputation axes — hitman rank, `wanted`, `welsher`, `rat`, honor tier | cigarette smoke, a shadow, a broken frame for a rat |
| **frame** | 6 | dynasty tier + estate tier | pawn-shop wood → gilt |
| **plate** | — | generation, dynasty name, street name | engraved text, rendered not generated |

Combinatorially that is 8 × 6 × 10 × 8 × 6 ≈ **23,000** distinct portraits from **38 reviewed
parts** — before the engraved plate makes each one literally unique.

**Faces.** The action-art pass established that the shared NOIR vocabulary says *"unpeopled"*, which
is exactly wrong for a portrait — the Underworld fixture portraits needed their own PORTRAIT
vocabulary. The same applies here, with the same hard rule that has held across every art pass:
**fictional faces only, never a real or recognisable person.** That is the standing Broadcast
posture and it does not relax for a token.

---

## 4. The traits, and what they must not leak

Traits derive from state the game already computes. The temptation is to expose everything; the
constraint is that **a public token must not become a wealth scanner.**

This is settled precedent, not a new worry. `publicDossier` returns **banded** status only — level,
kills, assassin rank, family, flags, dynasty tier — and *never* an exact cash/bank/$OMR figure,
specifically to preserve the audit's anti-precise-kill-EV rule. The Wire's paid dossier keeps wealth
banded too, and that is a rail a player **pays $OMR** for. A free, permanently-public, indexed-by-
every-marketplace JSON blob must be **at most** as revealing as the paid one.

| trait | source | exposure |
|---|---|---|
| Generation | `bloodline` deaths + 1 | exact — already public |
| Rank | `RANKS[rankIdxOf(level)]` | exact — already public |
| Assassin | `hitmanRankOf` | exact — already public |
| Standing | City Standing pillars | **banded** |
| Dynasty | `dynastyTierOf` | exact — already public |
| Estate | tier name | exact — already public |
| Notoriety | `wanted` / `welsher` / `rat` | boolean — already public |
| Trades | deepest mastery track | name only, not XP |
| Wealth | — | **never, in any form** |

**No trait may be a number a hunter can price a kill from.** If in doubt, band it.

---

## 5. Sequencing — off-chain first, chain dormant

The M6 pattern, for a specific reason: **a new contract resets the third-party audit clock**, and
tokenomics v2 step 4 already reset it once (`OMR.mint` deleted the "nothing mints" property every
prior audit rested on). Mainnet is gated on `forge test` (green), third-party audit (not run), and
the launch checklist (not done). None of that should block the part players can actually see.

**Phase 1 — the portrait, entirely off-chain (no gates).**
Parts library, compositor, `GET /v1/identity/:characterId.svg`, a console card on the sheet, traits
on `publicDossier`. Every player has a portrait that visibly changes as they play, and the heir
inherits a recognisably related one. **This is most of the value and it needs no token, no wallet and
no chain.** It also generates the thing the token would point at, so the ordering is not a compromise.

**Phase 2 — metadata, still dormant.**
`GET /v1/identity/:tokenId` in ERC-721 metadata shape, served but pointing at nothing. Lets the exact
JSON be reviewed and argued about before a contract exists to be stuck with it.

**Phase 3 — the contract (gated).**
`OmertaIdentity`, ERC-721, minted by the existing `OmertaFees.payMintFee()` path so the fee rail is
unchanged. Safe-owned. **The entitlement stays on `account_persistent.minted` and the contract must
not gate anything on `balanceOf`** — see §1. Foundry tests; then the audit and launch gates like
everything else on the chain track.

---

## 6. What selling this changes

Recorded plainly because it genuinely moves, and the standing copy rules are strict.

**What does not change:** the fee is still out-of-band. `fees.js` writes zero `transactions` rows and
adds nothing to the §10.4 set. The entitlement it grants is unchanged. §10.4 is untouched by this
entire design.

**What does change:** we would be selling a **tradeable asset** for real money, where before we sold
an in-game entitlement. That is a different thing to sell, and the standing copy rules apply with
*more* force rather than less:

- **no appreciation language, ever** — not in the shop copy, not in the docs, not in a tweet. The rule
  already covers $OMR; it covers this identically and for the same reason;
- market it as what it is: a **collectible portrait of a character you played**;
- royalties are ordinary and fine; a **revenue-share or "floor support" framing is not** — that is a
  promise about future value and it is out;
- **the founder reviews the copy** before any of it is public, on the same basis as the R2/R3 and mainnet
  gates.

---

## 7. Open questions for the founder — ANSWERED (founder sign-off, 2026-08-16)

All four questions were put to the founder as explicit options and answered. The standing decisions:

1. **§1 shape A CONFIRMED** — layered composition (~38 reviewed parts assembled live), tradeable
   trophy, non-transferable entitlement. Per-mint generated images rejected (unreviewable at scale,
   per-render cost, a content-safety surface on every mint).
2. **Silhouette-forward CONFIRMED** — the brim's shadow doing the work, matching the shipped
   off-chain portrait and the genre; also sidesteps the same-face-syndrome risk a drawn-face part
   library carries at thousands of mints.
3. **Bloodline-continuous CONFIRMED** — the portrait is the dynasty, not the street: it keeps living
   as the heir plays (generation deepens the frame) and freezes only at the token's first
   owner→owner transfer, exactly as the shipped Transfer watcher already enforces.
4. **Retrofit CONFIRMED** — every existing minted account gets a Dynasty NFT in the retrofit batch
   the stamp-eligibility window already assumes.

---

## 8. What this does *not* do

Stated so nobody reads a solution into it later.

**It does not fix the farm.** A collectible attached to the mint does not change the per-identity
cost, which `BALANCE.md § THE FARM` measures as one day of the budget it gates. If anything a
*liquid* secondary market makes the farm's exit easier, which is precisely why §1 is not optional.
The Sybil question is answered by the levers in that decision sheet — F1 (cap on a durable identity
rather than per account) chief among them — not by this.

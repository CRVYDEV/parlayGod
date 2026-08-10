# THE MADE MAN — the identity NFT

*Founder-directed 2026-08-01. Design only; nothing here is built. The mint fee stays at **0.01 ETH**
(founder's call — the raise was considered and declined).*

> **EXTENDED 2026-08-09 by `omerta-dynasty-machine-design.md`** — founder-directed: the identity
> NFT is an uncapped **ERC-721** carrying an **ERC-6551 token-bound account** (the standard's
> mechanics verified against the EIP text), which holds the Stock Machine's activated allocations.
> The trophy/entitlement wall below STANDS — the entitlement stays account-bound in the DB — with
> one knowing, counsel-gated exception recorded there (memo row A2): the TBA makes the trophy a
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

Six slots, composited back-to-front. Counts are a starting point, not a commitment.

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
**fictional faces only, never a real or recognisable person.** That is the standing Broadcast legal
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
legal counsel (not done). None of that should block the part players can actually see.

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
not gate anything on `balanceOf`** — see §1. Foundry tests; then the audit and counsel gates like
everything else on the chain track.

---

## 6. Legal posture — what changes and what does not

Recorded plainly because this genuinely moves, and the standing constraints are strict.

**What does not change:** the fee is still out-of-band. `fees.js` writes zero `transactions` rows and
adds nothing to the §10.4 set. The entitlement it grants is unchanged. §10.4 is untouched by this
entire design.

**What does change:** we would be selling a **tradeable asset** for real money, where before we sold
an in-game entitlement. That is a different thing to sell, and the standing compliance line applies
with *more* force rather than less:

- **no appreciation language, ever** — not in the shop copy, not in the docs, not in a tweet. The rule
  already covers $OMR; it covers this identically and for the same reason;
- market it as what it is: a **collectible portrait of a character you played**;
- royalties are ordinary and fine; a **revenue-share or "floor support" framing is not** — that is a
  security-shaped promise and it is out;
- **counsel reviews the copy** before any of it is public, on the same basis as the R2/R3 and mainnet
  gates.

---

## 7. Open questions for the founder

1. **§1 — confirm shape A** (tradeable trophy, non-transferable entitlement). Everything above assumes it.
2. **Faces or silhouettes?** Faces are stronger art and carry more identity; silhouettes sidestep the
   likeness question entirely and composite far more cleanly. My lean is **silhouette-forward with
   face-adjacent framing** (hat brim, turned collar, shadow) — noir does this anyway, and it is the
   genre's signature rather than a dodge.
3. **Does the portrait survive death, or does the heir get a new one?** My lean: **the token persists
   and the portrait ages** — generation is engraved on the plate, so the token becomes a record of the
   whole bloodline rather than one street. That is the stronger collectible *and* the stronger fit
   with a game whose central rule is that the account survives while the street dies.
4. **Retrofit?** Everyone already minted paid the same 0.01 ETH for strictly less. Granting them a
   portrait costs nothing and is obviously right; worth confirming.

---

## 8. What this does *not* do

Stated so nobody reads a solution into it later.

**It does not fix the farm.** A collectible attached to the mint does not change the per-identity
cost, which `BALANCE.md § THE FARM` measures as one day of the budget it gates. If anything a
*liquid* secondary market makes the farm's exit easier, which is precisely why §1 is not optional.
The Sybil question is answered by the levers in that decision sheet — F1 (cap on a durable identity
rather than per account) chief among them — not by this.

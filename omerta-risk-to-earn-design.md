# OMERTÀ — Risk-to-Earn Design Proposal

**Status: DRAFT / proposal. Nothing here is built.** This document proposes moving $OMR from
the current *utility-only* framing to a genuine **Risk-to-Earn** economy in the spirit of
**EVE Online**, **Axie Infinity**, and **DeFi Kingdoms** — where a skilled, risk-taking player
can *theoretically make a small living*, and a careless one can lose it all.

This explicitly overrides the CLAUDE.md "Sensitive design notes" ($OMR utility-only; no
appreciation framing; onboarding pays cash only). If we build this, those notes get rewritten.
Two things I owe you up front, plainly, because they decide whether this succeeds or blows up:

1. **Sustainability is the entire game.** Every P2E that died — Axie ($0.35 → $0.001), most of
   DeFi Kingdoms' JEWEL — died the same way: **reward emission outran sinks**, the token
   hyperinflated, earners cashed out faster than value came in, growth stalled, spiral. The
   iron rule of this design is therefore: **a player can only extract value that someone else
   put in.** We make that *structural*, not hopeful — an invariant as sacred as §10.4.
2. **This has real-world weight.** Real-money earning + a token = potential securities, money-
   transmission, tax, and gambling exposure that varies by jurisdiction. I am not your lawyer
   and this is not legal advice — but you should not ship mainnet extraction without one. Flagging
   once, then moving on to the design.

---

## 1. The core question: where does the "living" actually come from?

For any player to earn a living, **someone else must be putting in more than they take out.**
There are only three sources of that value. Pick wrong and the game dies.

| Funding source | How it works | Verdict |
|---|---|---|
| **(a) New-player buy-in** | Newcomers' money pays earlier players (the Axie model) | ☠️ **The death spiral.** Works only while growth accelerates; collapses the instant it stalls. Do NOT build on this. |
| **(b) Team/treasury subsidy** | The team funds the withdrawal pool (OMERTÀ *today* — `chain_reserve` tranches) | ⚠️ Fine as *marketing spend*, but it's a cost center, not a business. Unbounded team liability. |
| **(c) Spender-funded redistribution** | Whales spend real money for **status / convenience / power** (not to extract); that revenue funds the earners | ✅ **The only sustainable model.** EVE's PLEX, a healthy free-to-play economy. The game must be *fun enough to spend on for reasons other than cashing out.* |

**This proposal is built entirely on (c).** The spenders fund the earners; the team's job is to
make the game worth spending on, not to subsidize withdrawals forever. Every proposal below
serves that: give whales compelling things to buy, route that real revenue into a pool, and let
skilled/risky players extract *from that pool* in proportion to the risk they take.

---

## 2. What OMERTÀ already has (the good news)

OMERTÀ is closer to EVE than to Axie already — that's a real advantage:

- **Full-loss death** (the estate, §7.9): when a street dies, its cash, cars, and gear are
  destroyed and the killer chops a share. This is EVE's ship-destruction sink — the thing Axie
  never had. **Risk is already real; it's just not rewarded enough.**
- **A destruction economy**: cars melt into ammo, the estate burns wealth, wars cost treasuries.
  Sinks exist and are ledgered (§10.4).
- **A scarce token** (20k genesis) with an AMM, staking, and an on-chain withdrawal rail that's
  already **gated on real inflow** (the tranche) — the containment is half-built.
- **Territory, families, contracts, a hitman economy** — the PvP scaffolding EVE-style conflict
  needs.

The audit (`AUDIT-full-game.md`) found the gap precisely: **the safe play dominates, and risk
isn't paid.** So Pillar 1 is a rebalance, and Pillars 2–4 build the earning engine on top.

---

## 3. The proposals

Four pillars, each shippable and testable on its own, sequenced so the game gets more
Risk-to-Earn at every step without ever risking the death spiral.

### PILLAR 1 — Make risk pay (rebalance; off-chain; no new infrastructure)

*The foundation. Without this, more token flow just means "extract safely" — pay-to-win, not
Risk-to-Earn. This is mostly the audit's B3/B4, turned from "flag" into "design."*

- **P1.1 · Loot the living, not just the dead.** Extend the kill: today the chop is 40% of the
  victim's *car fleet*, which is ≈$0 because nobody garages cars. Add a **cut of the victim's
  carried (unbanked) cash and unstaked $OMR** to the killer. Now *carrying extractable value is
  the risk* — EVE's central tension ("do I undock with the expensive fitting?"). The rest still
  burns as the estate sink, so §10.4 holds. **This single change makes killing +EV and makes the
  rich into targets** — the on-ramp the kill economy is missing.
- **P1.2 · The vault tradeoff.** Banked cash is safe from looting but should trade something for
  that safety: either it earns the (reduced, see P4) interest while *carried* cash earns none, or
  **conversion to $OMR requires carrying it to a "front" in contested turf** — so *extraction
  itself is a risky act*, not a safe menu click. Safety, yield, and extractability become three
  corners you can't all have at once.
- **P1.3 · Shield, not bunker.** The safehouse becomes a *shield*: while safe you cannot `fire`,
  `jump`, `deal`, or extract — you're hiding, not farming behind glass. Reprice the bodyguard
  toward safehouse parity (or make the absorbed hit cost the guard more). Defense stops being a
  free "opt out of PvP while still earning."

**Effect:** risk becomes rewarded and unavoidable for the wealthy. All numbers are levers for
your sim + sign-off. Ships with zero new infrastructure.

### PILLAR 2 — Productive, ownable, *losable* assets (the Axie/DFK "hero" + EVE loss)

*The thing you own, that earns for you, that someone can take. Axie's Axies and DFK's Heroes are
productive NFTs; EVE's ships and structures are losable. OMERTÀ's rackets are productive but
today they're just DB rows that die with you.*

- **P2.1 · Rackets & fronts become tradeable NFTs** (ERC-1155/721, extending the existing
  `GearVault` pattern). A racket is an on-chain asset that **generates $OMR-convertible income**,
  can be **sold on a secondary market**, and — critically — **is seizable**: if your family loses
  the district it operates in, the racket and its income stream transfer to the victor. Territory
  war now fights over *productive capital*, not just a slice of treasury (audit B4/B7). This is
  the deepest single injection of "a reason to fight and a reason to defend."
- **P2.2 · Gear you can lose.** Equipped gear (already ERC-1155) gets a drop-chance to the killer
  on death. The best gear becomes risk-carried capital — you fight better with it, and you can
  lose it. Makes the gear market real and the kill loot meaningful.

**Effect:** wealth becomes *productive and contestable*. This is what turns a grind into an
economy people fight wars over. Requires contract work + a season of balancing; Pillar 3-tier.

### PILLAR 3 — The Vig: where the living actually comes from (the sustainability engine)

*This is the pillar that makes "make a living" both real and safe from collapse.*

- **P3.1 · The Vig — a real-revenue redistribution pool.** A fixed share of **all real-ETH
  revenue** flows into a **Prize Reserve**. Revenue sources (all things whales buy for
  status/convenience/power, not to extract): the existing mint (0.01 ETH) and respawn (0.10 ETH)
  fees, **plus new ones** — cosmetic packs, a season battle-pass, territory "rent" paid to hold
  premium districts, vanity for ETH, faster-cooldown convenience. The Vig funds two things: (a)
  the **$OMR withdrawal tranche** (so extraction is backed by real money in, not team charity),
  and (b) **seasonal PvP/territory/trader prize pools** paid to the leaderboards.
- **P3.2 · The structural invariant (the anti-death-spiral rule).** *Withdrawal + prize capacity
  in a period ≤ real revenue received in the prior period × payout ratio (e.g. 70%).* The other
  30% is the business. **Extraction can never exceed inflow** — enforced in code like §10.4, with
  its own nightly invariant check and alert. This is the single most important line in this
  document: it is why OMERTÀ doesn't become Axie. If revenue dips, the payout pool shrinks
  automatically; the token doesn't hyperinflate, it just pays out less that season.
- **P3.3 · The PLEX bridge (EVE's masterstroke).** Make the mint, respawn, cosmetics, and rent
  payable in **either real ETH or in-game $OMR** (bought off the AMM). A *skilled* player pays
  their "rent" from earnings and never spends a dollar; a *whale* pays real ETH → into the Vig →
  which funds the skilled player's withdrawal. The loop closes: **the spender's convenience is
  the earner's income.** This is exactly how a top EVE player funds their subscription with ISK
  while someone else pays cash for PLEX.

**Effect:** a real, bounded, sustainable "living" — funded by spenders, capped by inflow,
distributed by skill and risk. This is the heart of the pivot.

### PILLAR 4 — Sustainable tokenomics (so it lasts more than one season)

*The audit's B1/B2, plus the Axie lesson baked in.*

- **P4.1 · Backed emission, not fixed APY.** Replace the fixed 14% staking *mint* (the audit's #1
  concern — the sole unbounded inflation source) with **rewards paid from a pre-funded pool** (the
  on-chain `OMRStaking` contract *already works this way* — a pool with a ceiling, principal always
  withdrawable; we reconcile the in-game staking to it). The pool is topped by the Vig. **Emission
  tracks real inflow instead of printing forever.**
- **P4.2 · Recurring sinks that scale with supply.** Extraction already burns $OMR (`withdraw:omr`).
  Add **territory rent** (hold a premium district → recurring $OMR burn, fail to pay → lose it: a
  sink *and* a risk), and make racket/gear minting a $OMR sink. As more $OMR exists, more is burned
  — the sink breathes with the faucet, which is exactly what Axie lacked.
- **P4.3 · Fix the safe-income dominance** (audit B2/B5): the bank-interest daily bucket and the
  endgame-crime success cap, so that *safe* income stops out-earning *risky* income. Risk-to-Earn
  only means something if not-risking earns less.

---

## 4. Suggested sequencing

Each phase is independently shippable, testable (extend the suite, both success and gate paths),
and gated on your sim + sign-off for every number. Nothing later depends on mainnet.

1. **Phase 1 — Reward the risk (Pillar 1).** Pure off-chain rebalance. Immediate Risk-to-Earn
   *feel*, no infrastructure, low regulatory surface (no new extraction). Ship first, validate that
   PvP comes alive and the safe play stops dominating.
2. **Phase 2 — The Vig + PLEX bridge (Pillar 3).** The sustainability engine and the actual
   "living." Build the Prize Reserve, the P3.2 invariant, and pay-fees-in-$OMR-or-ETH. This is where
   extraction becomes real *and* safe from collapse. **Highest legal-review priority.**
3. **Phase 3 — Productive NFTs (Pillar 2).** Rackets/territory as tradeable, seizable assets. The
   deep end-game that gives wars and markets their teeth. Contract work + heavy balancing.
4. **Phase 4 — Tokenomics hardening (Pillar 4).** Backed emission, scaling sinks, safe-income fix.
   Makes the whole thing durable past season one.

---

## 5. The honest risks (read before committing)

- **If P3.2 is not enforced, this becomes Axie.** The extraction-≤-inflow invariant is not
  optional garnish; it is the mechanism that prevents the death spiral. Build it first in Phase 2,
  test it like §10.4.
- **Regulatory:** real-money earning + a token invites securities / money-transmitter / tax /
  gambling scrutiny that differs by jurisdiction (and can gate which users you can serve). Get
  counsel before Phase 2 mainnet. Non-negotiable given the stakes.
- **It changes the game's soul.** Utility-only kept the game about *playing*; Risk-to-Earn makes it
  partly about *money*, which attracts extractors, bots, and RMT pressure, and raises the stakes of
  every balance bug (a §10.4 leak is now a real-money leak). The agent-flag / anti-abuse machinery
  becomes load-bearing, and the audit discipline becomes existential, not hygienic.
- **"Small living" must stay *small and skill-gated*.** The healthy version pays a *dedicated,
  skilled, risk-taking* player a modest amount — like the top fraction of EVE players who run
  industry/PvP at scale — funded by the many who spend for fun. If the median casual can extract a
  wage, the math doesn't close and it collapses. Design the payout curve steep: risk and skill earn,
  clicking safely does not.

---

## 6. What I'd build first, if you greenlight

**Phase 1 (Pillar 1)** — it's the cheapest, safest, highest-signal step: it makes the game *feel*
Risk-to-Earn immediately, needs no chain work or legal sign-off, and validates the core loop before
you invest in the Vig. Concretely: loot-on-kill (P1.1), the vault/extraction tradeoff (P1.2), and
shield-not-bunker defense (P1.3) — all off-chain, all behind founder-signed numbers, all with
tests. Then we design Phase 2's Vig in detail with the extraction-≤-inflow invariant at its core.

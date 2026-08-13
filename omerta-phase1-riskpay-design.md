# OMERTÀ Risk-to-Earn — Phase 1: Make Risk Pay (detailed design)

**Status: DRAFT / proposal. Nothing built.** Parent: `omerta-risk-to-earn-design.md`.
This is the foundation and the thing to build **first**: a pure **off-chain rebalance** that
makes risk rewarded and safe play stop dominating. It needs **no chain work and no outside
sign-off** (it changes no real-money extraction — that's Phase 2), so it's the cheapest, safest,
highest-signal step. If Phase 1 lands, PvP comes alive and you can validate the core Risk-to-Earn
loop before investing a dollar in the Vig.

Everything here is numbers on existing systems (`social.js`, `economy.js`, `accrual.js`,
`rules.js`). Every number is a **founder sim + sign-off lever** (ground rule #1). Every value
movement stays inside §10.4 — I give the exact ledger handling per change.

---

## 1. The frame: a value-risk ladder

Today OMERTÀ already splits wealth into two layers by what death does to it:

- **Street-level — dies with you:** pocket cash, bank, cars, contraband, ammo (`runEstate`
  burns `cash + bank` as `death:estate`).
- **Account-level — survives to the heir:** $OMR, staked, gear, prestige (`runEstate` "kept" set).

Phase 1 turns that flat split into a **risk ladder you climb by taking risk**, and makes the
climb — and everything on the lower rungs — genuinely losable:

```
  SAFEST / illiquid                                          RISKIEST / liquid
  staked $OMR ──► liquid $OMR ──► bank cash ──► pocket cash
  (yield, death-safe)  (extractable,   (safe from jumps &   (spendable now, but
                        partly lootable) looters, dies to    JUMPABLE + fully
                        on death)        the void on death)   LOOTABLE on death)
```

The Risk-to-Earn thesis in one line: **to move value up the ladder toward safe, extractable
$OMR you must expose it to risk along the way — and carrying value low on the ladder makes you
a target worth killing.** The three sub-designs below build exactly that.

---

## 2. P1.1 — Loot the living (the on-ramp the kill economy is missing)

**The problem (audit B4):** a `fire` kill today pays the killer a chop of **40% of the victim's
car fleet** (`CHOP_RATE 0.40` on `fleetValue`) — but almost nobody garages cars, so chop ≈ $0.
The victim's actual wealth (cash, bank, $OMR) is **burned** to the void or **kept** by the heir —
the killer gets nothing worth the 3-hour search. So no rational earner ever initiates a kill, and
nothing routes players into the entire M7 layer.

**The change:** the killer loots a cut of the victim's *carried* value; the rest still burns/
survives as today. Concretely, in the `fire` **kill branch** (player kills only — see §2.3):

- **Cash loot.** Killer takes `CASH_LOOT_RATE` of the victim's **pocket** cash (not bank — you
  can't grab banked money in a street hit). Ledgered as a transfer, exactly like the existing
  chop: `whack:loot` (killer `+loot`, counterparty victim). The victim's remaining pocket + all
  bank still burn as `death:estate`. **Net §10.4: zero** — the loot is simply carved out of what
  would have burned (`lostCash` shrinks by `loot`, a new transfer row balances it).
- **$OMR loot.** Killer takes `OMR_LOOT_RATE` of the victim's **liquid (unstaked) account $OMR**;
  the remainder still survives to the heir; **staked $OMR is untouched.** This is the first time
  the earning token itself is losable — the core EVE tension applied to $OMR. Ledgered as a
  cross-account transfer `whack:loot` currency `omr` (victim account `−`, killer account `+`);
  a transfer, in neither the mint nor burn term, so `$OMR conservation` stays exact.

**Why this is the highest-leverage change in Phase 1:** it simultaneously (a) makes killing +EV,
giving the kill economy its on-ramp; (b) makes the *rich* into targets, so wealth carries risk;
(c) creates a reason to **stake $OMR** (safe + yield) rather than hold it liquid — which is good
for tokenomics (locks supply) and sets up Phase 4; and (d) makes the bank-vs-pocket choice
finally matter for cash.

### 2.1 Starting numbers (sign-off levers)
- `CASH_LOOT_RATE = 0.25` — killer takes 25% of the victim's pocket cash.
- `OMR_LOOT_RATE = 0.20` — killer takes 20% of the victim's liquid $OMR.
- **Dial:** `OMR_LOOT_RATE = 0` ships a **cash-only** version first (gentlest — no token loss yet),
  and you enable $OMR looting later once the cash version is validated. I recommend shipping cash
  loot on, $OMR loot **behind this dial at a low value** so you control the "your earnings are
  losable" moment deliberately.

### 2.2 Interaction with existing absorbs (verified against `social.js`)
Loot fires **only on an actual kill** — so it is correctly skipped when a bodyguard absorbs, when
a respawn token absorbs, and when the target is safe-housed (all of which return before the kill
branch). No change needed there; loot slots into the same block as the existing chop.

### 2.3 What does NOT loot (design boundary)
- **NPC-hit kills** stay a pay-to-remove tool: zero rep, no chop, no bounty **and no loot** — the
  payer buys a removal, not a payday. (Keeps the NPC hitman as an equalizer, not a wealth pump.)
- **Mod-kills** never loot (they bypass the estate-with-killer path entirely).
- Only a **player `fire` kill** loots — so *player skill and risk* (the search + the shot + the
  retaliation exposure) is what earns, which is the whole point.

---

## 3. P1.2 — Make extraction a risky act (laundering)

**The problem:** converting cash → $OMR (the `swap:buy` direction — the first step of turning
in-game grind into extractable value) is a **safe menu click** from anywhere. Risk-to-Earn wants
the *act of extracting* to carry risk, EVE-style (you have to undock and move the goods).

**The change:** the cash→$OMR swap becomes **laundering at a wash house** — it requires being
physically in a **launder district** and it **draws heat**:

- **Located.** `swap` in the `buy` direction (cash→$OMR) requires `ch.loc` ∈ the launder
  districts (a small set, or the turf a family holds — a natural family perk). You must travel
  there carrying the cash, exposed to jumps and hits en route and while parked. (Same district-gate
  pattern `fire` already uses.)
- **Heat.** Laundering adds `LAUNDER_HEAT` to the launderer — it draws law attention (Bureau raid
  risk via the existing heat machinery) and, combined with P1.1, marks you as someone carrying
  value worth killing. Large launders could scale heat with size.
- *(Optional, richer — defer to Phase 3):* a settling timer where the laundered $OMR is "pending"
  and lootable if you're killed mid-wash. Phase 1 keeps it simple: located + heat is enough risk.

**§10.4:** unchanged — the swap already ledgers `swap:buy` (cash out / $OMR in through the AMM).
We only add gates (`district`, `heat`); no new reason. The reverse direction (`swap:sell`,
$OMR→cash, bringing money *in*) is **not** gated — only *extraction prep* is risky.

**Starting numbers:** `LAUNDER_HEAT = 15`; launder districts = a fixed set of 2–3 (or "any district
your family holds," which makes turf more valuable — recommend the family-turf version as it feeds
Pillar 2). Sign-off levers.

**Effect:** you can grind safely, but the moment you convert grind into extractable value you
expose yourself — travel + heat + becoming a lootable target. Extraction is a deliberate risk,
not a free click.

---

## 4. P1.3 — Shield, not bunker (defense stops cancelling PvP)

**The problem (audit B3):** the safehouse ($25k / 4h) grants total `fire`+`npcHit` immunity
**while you keep earning** — crime, deals, laundering, everything. So a wealthy target opts out of
PvP for ~$150k/day and keeps farming behind glass. Bodyguard ($1k / 24h) is a tenth the price for
comparable cover. Cheap defense *cancels* the risk economy instead of creating tension in it.

**The change — the safehouse becomes a genuine shield, not a bunker:** while `safe_until` is
active you are untargetable **but** you cannot `fire`, `jump`, `deal`, or **launder** (extract).
You're hiding — laying low, not farming. Passive racket/crew accrual still ticks (you can't stop
your rackets by hiding), but all *active* offense and *extraction* are locked. Safety now costs
you tempo and income, which is the tradeoff it should always have been.

Implementation: add a `safeHoused(ch)` guard (already exists) to the `fire`/`jump`/`deal`/launder
entry points that throws `safe` ("Not while you're to ground."). One-line gates, mirror the
existing pattern.

**Bodyguard reprice** (pick one or both, sign-off):
- Raise `BODYGUARD_MIN_PRICE` toward safehouse parity (e.g. `1000 → 10000`), and/or
- Make the guard's absorbed-hit cost heavier (longer `BODYGUARD_HOSP_MS`, or the guard also drops
  loot to the killer) — so being a bullet-catcher is a real risk priced accordingly.

**§10.4:** none — these are gates and a constant change, no value movement.

---

## 5. Supporting rebalances (same thesis: safe income shouldn't dominate)

These aren't strictly PvP but they serve Phase 1's goal — *stop the safe play from out-earning the
risky play* (audit B2/B5). Include as much as you want; each is independent.

- **B2 · Bank-interest daily cap.** `BANK_RATE 0.02`/12h is capped only *per-accrual* at 8h
  offline, with **no daily token bucket** like rackets have (`racket_credit_ms`). A continuously-
  active player compounds ~4%/day risk-free — the best risk-adjusted return in the game. Fix:
  mirror the racket bucket with a `bank_credit_ms` daily budget so interest tracks intended daily
  rate regardless of poke frequency. **Recommended for Phase 1** — banking is the #1 "safe beats
  risky" offender and this is a clean, contained fix.
- **B5 · Endgame crime success cap** (optional): additive stat/gang/turf/rank bonuses lift a built
  veteran's success on 0.10-base top crimes back to the 0.97 ceiling, so top-tier "risky" crime
  isn't risky. Consider a lower cap on high-tier jobs. Bigger balance surface — defer unless you
  want it.

---

## 6. §10.4 impact summary (all conserved)

| Change | Ledger handling | Conservation |
|---|---|---|
| Cash loot on kill | new transfer `whack:loot` (cash): killer `+loot`, counterparty victim; `death:estate` burn shrinks by `loot` | net zero — carved from the burn |
| $OMR loot on kill | new transfer `whack:loot` (omr): victim acct `−`, killer acct `+` | transfer, in neither mint nor burn term |
| Laundering | existing `swap:buy` (unchanged) + added gates | no new value movement |
| Shield-not-bunker | gates only | none |
| Bank daily cap | caps an existing faucet (`bank:interest`) | tightens, never mints |

`whack:loot` joins the cash **and** omr `KNOWN_REASONS` in `invariants.js`; the omr entry is a
transfer (added to neither the mint nor the burn term), so `$OMR conservation` stays exact. The
`character cash` and `$OMR conservation` checks both continue to reconcile — extend the audit
scenarios in `test/hardening.js`/`test/social.js` to prove a looted kill nets zero drift.

---

## 7. Build plan (concrete, grafts onto existing code)

Each step shippable + tested (success and gate paths), behind founder-signed numbers.

1. **`rules.js` M3 tail:** add `CASH_LOOT_RATE`, `OMR_LOOT_RATE`, `LAUNDER_HEAT`, launder-district
   set, bodyguard reprice; keep all as named constants for one-line tuning.
2. **`social.js` `fire` kill branch:** compute `loot` (cash) + `omrLoot` from the victim, credit
   the killer (`ch`/`h.acct`) in-memory, ledger `whack:loot` both currencies, and pass the reduced
   figure so `runEstate` burns only the remainder. Guard against the clobber pattern exactly as the
   chop already does (killer is `ch`, in-memory credit + ledger, no third-row SQL).
3. **`runEstate`:** accept the already-looted amounts so `lostCash`/omr burn/keep math nets right;
   heir still gets the legacy stake unchanged.
4. **`economy.js` `swap`:** add the `buy`-direction district gate + `LAUNDER_HEAT`.
5. **`social.js`:** add `safeHoused` guards to `jump` and (in `kitchen.js`) `deal`, plus the
   launder gate; `fire`/`npcHit` already have them.
6. **`accrual.js`:** the `bank_credit_ms` daily bucket for interest (mirror `racket_credit_ms`);
   `schema.sql` gets the column.
7. **`invariants.js`:** `whack:loot` into both vocabularies (omr as a transfer).
8. **Tests:** loot-on-kill nets zero drift and the killer is paid (cash + $OMR); NPC/mod kills do
   **not** loot; laundering rejected outside a wash house + draws heat; safehouse blocks
   fire/jump/deal/launder; bank daily cap holds an active grinder to the intended rate.

---

## 8. The numbers (sign-off levers)

| Constant | Proposed | What it controls |
|---|---|---|
| `CASH_LOOT_RATE` | 0.25 | killer's cut of victim pocket cash on a fire-kill |
| `OMR_LOOT_RATE` | 0.20 (dial to 0 to ship cash-only first) | killer's cut of victim liquid $OMR |
| `LAUNDER_HEAT` | 15 | heat drawn by a cash→$OMR launder |
| launder districts | family-held turf (recommended) or a fixed 2–3 | where extraction prep is legal |
| `BODYGUARD_MIN_PRICE` | 1000 → 10000 | floor toward safehouse parity |
| `BODYGUARD_HOSP_MS` | 2h → (raise) | the guard's cost for catching a bullet |
| bank daily cap | ~2×`BANK_PERIOD` of interest/day | ends the ~4%/day risk-free compounding |

---

## 9. What Phase 1 delivers — and deliberately doesn't

**Delivers:** killing becomes +EV and the rich become targets (P1.1); carrying and extracting
value becomes risky (P1.1 + P1.2); defense costs tempo instead of cancelling PvP (P1.3); and safe
passive income stops dominating (B2). The game *feels* Risk-to-Earn — risk is finally paid, and
where you keep your wealth is a real decision.

**Deliberately doesn't:** change real-money extraction at all. No new withdrawal, no token
appreciation mechanic, no Vig — so Phase 1 carries **no new extraction surface** and needs no
chain work. It's the safe way to prove the loop before Phase 2 turns earned $OMR into a real,
sustainable living. Ship this, watch whether PvP and the wealth-carry tension come alive, tune the
seven numbers, *then* commit to the Vig.

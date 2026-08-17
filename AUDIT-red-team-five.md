# AUDIT — RED TEAM #5 (2026-08-17)

**Scope.** The fifth max-effort pass, run immediately after RT#4 merged. Aimed, like RT#4, at what the
prior reports leave open by construction — modules that appear in **zero** audit report, and classes the
earlier passes established without sweeping to their edge. This one is a game half and a contract half.

**Method.** First-hand throughout; no fan-out. Nothing was called a finding before it was reproduced
against a running engine or a real EVM, and nothing was fixed before it was reproduced. Two of the three
findings needed real infrastructure (real Postgres for the concurrency half of F1's meter, a real Foundry
VM for F3) because pg-mem is single-caller and a Solidity default cannot be reasoned about from prose.

**Result. No CRITICAL. Three findings — one per uncovered surface — and three lenses that came back
clean.** Eight mutations, each failing at its own named assertion.

---

## F1 (MED) — the game emailed addresses nobody had proved they owned

`src/dispatch.js` is the opt-in "while you were gone" digest. A player typed an address into a text
field, flipped a checkbox, and the worker mailed that address on a lapse. There was **no confirmation
step anywhere in the flow** — the typed string was treated as proved.

**Reproduced:** three free guest accounts, one third-party address typed into all three, three unsolicited
digests to a person who had never touched the game. The multiplier is bounded only by how many accounts a
spammer opens, and guest accounts are free by design (the launch posture is doors-open; the paid mint is
the *extraction*-side Sybil bound, not the signup-side one). The unsubscribe link in each message is
one-click and honest — which makes it worse, not better: it confirms to the recipient that the address is
live, and they never asked to be in the loop to begin with.

This also sat one layer above a real obligation. The system already carries a one-click unsubscribe and an
opt-in checkbox precisely because sending mail for a real-money-adjacent game has consent requirements; a
consent flow whose "opt-in" can be performed by a stranger on your behalf is not one.

**Fixed — double opt-in, with three walls rather than one:**

1. **`account_persistent.email_verified` gates the SWEEP.** An address is deliverable only after somebody
   proved they read the inbox. This is the load-bearing half: everything else is about making the proof
   hard to forge or spam.
2. **The token is an HMAC bound over the account AND the address.** Binding the account alone would let a
   stale link confirm a *changed* address — retype the field after a confirmation and the old link would
   silently re-verify the new one. Retyping now drops the proof, by construction, because the token no
   longer matches.
3. **A per-ADDRESS confirmation meter, across accounts** (`email_confirm_sent`, 24h). Without it the
   confirmation mail is itself the spam vector — one address, N accounts, N unsolicited "please confirm"
   messages. The meter is **claimed before the send** (the push C1 discipline), so a race sends once, not
   twice.
4. **One proved owner per address**, enforced on both the set and the confirm path. Enforcing it only at
   set time leaves the race open at confirm time.

`0` is not a concept here, so there is no fail-open default to get wrong: an unverified address is simply
not deliverable, which is the conservative direction.

Four mutations, four named failures: the meter removed (three accounts → three confirmations); the sweep's
`email_verified` gate removed (an unverified address gets a digest); the token bound to the account only (a
stale link confirms a changed address); the one-proved-owner reservation removed (a second account
confirms an address the first had proved).

**Test note worth keeping.** The existing suite broke on the new gate — correctly, since the sweep now
sends nothing to an unverified address — and it would have made a **real network call**, because the
delivery seam was installed *after* the first prefs set. The seam moved to the top of the file. A test
that reaches the network on a code path the author did not expect is a test that will one day mail a real
person.

---

## F2 (MED) — `/health` was keyless, DB-heavy and unthrottled

The BLUE-TEAM H4 fix made the keyless throttle a **denylist by default** so a new keyless route could never
ship unthrottled by omission — but it is scoped to `/v1`, and `/health` is not under `/v1`. It runs two DB
queries per hit (`pingDb` plus the worker-heartbeat read).

**Reproduced:** a burst of 400 requests. `/v1/city` was cut off at 30. `/health` served all 400, two DB
queries each.

**Fixed with a 2-second TTL and single-flight, NOT a 429**, and the reasoning is the point: a health
endpoint's audience is a monitor, and **a 429 misleads it in both directions** — it looks like an outage
when the service is fine, and a monitor that learns to ignore 429 will ignore the one that matters.
Caching answers the actual problem (unbounded DB work per hit) while every caller still gets a truthful
answer, at most 2s stale, which is well inside any sane check interval. Single-flight bounds the
concurrent case, where a TTL alone does not: 200 requests arriving in the same millisecond all miss a cold
cache.

Verified: 200 concurrent → **2** DB queries; a serial flood inside the window → **0**; past the TTL → a
real check. Two mutations, two named failures.

**The vacuity lesson, twice in one finding.** The single-flight mutation **survived its first two runs.**
The first attempt was too fast to overlap, so 5ms of artificial query latency was added — and it survived
again. A direct probe showed the mutation costs **400** queries against **2**, so the fix was plainly
load-bearing and the *test* was wrong: earlier `/health` assertions in the same file leave the cache
**warm**, so the burst landed inside the 2s TTL and never reached the single-flight branch at all. Split
into two independent assertions, one pinning each mechanism, with `HEALTH_TTL_MS='1'` on the single-flight
leg so it is genuinely cold. Both mutations now fail by name.

*A mutation that survives is a claim about the test before it is a claim about the code.*

---

## F3 (MED) — two of the four contracts sharing one signer key deployed with no rate wall, and the runbook called one of them optional

RT#2's contract lens established the shape: **one `VOUCHER_SIGNER_PK` signs four contracts**, so that key's
blast radius is the **sum of their four daily caps**, and CHAIN-DEPLOY gained a rotation runbook plus a
guard. Following that to its edge asks a different question — is every one of those four caps actually
*set*?

Two are constructor arguments (`VoucherClaim`, `OmertaBond`), so they cannot be forgotten. Two were
**setter-only, defaulting to `0` = unlimited** (`StreetDeed`, `DynastyNFT`) — their walls existed only as a
line in a deploy checklist, and for `StreetDeed` that line read **"Optional rate-cap."**

**Reproduced on a real Foundry VM**, fresh deploys of both, no operator error:

```
deeds minted in ONE day from a fresh deploy:      500
identities minted in ONE day from a fresh deploy: 500
```

The loop bound was arbitrary — nothing stops it. It matters more than a raw number suggests on both
contracts: `DynastyNFT` has **no supply cap at all**, so an unset wall there is unbounded by construction;
and a `StreetDeed`'s ERC-6551 vault is where real tokenized stock lands, on a token whose id is
`keccak(name)` and which trades on a secondary market.

**Fixed by making the cap a CONSTRUCTOR argument on both**, matching the two siblings. `0` is still legal
and still means unlimited — the constructor does not force a *number*, it forces a **decision at deploy**,
which is exactly what was missing (the `freeMint` precedent: when both defaults are wrong to guess at, the
config must state it). The deploy script reads `DEED_DAILY_MINT_CAP` / `DYNASTY_DAILY_MINT_CAP`, and its
post-deploy note now says plainly that 0 means uncapped and that the key's radius is the sum.

Doing it now is free: the audit batch has not run. After it, the same change costs a re-audit — the same
argument that justified the bond's fourth slice.

**Guarded**, because this is the second time the shared-key class has produced a finding: `test/docs.js`'s
existing signer-rotation block (which already extracts the bearer set, with an anti-vacuity floor) now also
requires each bearer to take a daily cap in its constructor. A fifth signer-bearing contract that ships
setter-only fails the build.

Two mutations, two named failures: both contracts demoted back to setter-only (`the constructor arg IS the
wall: 0 != 1`, in each suite); and the guard's own mutation, `DynastyNFT` demoted, naming the file and the
consequence.

Runbook, deploy script, both contracts' NatSpec and the subtree `CLAUDE.md` rule list all carry it.

---

## Clean lenses (recorded, because a red team that publishes only its hits cannot be audited)

**`brokers.js` — the activation burn.** Reads the row `FOR UPDATE` before the read-modify-write and burns
through the audited `spendOmr` under the caller's lock. The classic gap — `SELECT … FOR UPDATE` on a row
that does not exist locks nothing, so two concurrent *first* activations both miss and race the INSERT — is
**unreachable here**: `withCharacter` holds the account's single living character, so two activations from
one account serialize on that lock (the `giveVouch` argument from RT#3). The residual PK collision maps to
a clean `contention` retry, and the loser's burn rolls back with it.

**Every non-`/v1` route.** Enumerated all 22. The five that touch the DB (`/card/*`, `/u/`, `/beef/`,
`/deed/`) are throttled by explicit prefix, and every keyless `/v1` GET is covered by the H4
denylist-by-default. `/health` was the only DB-touching route in neither set — which is F2, and this lens
is what confirms F2's scoping was complete rather than merely plausible.

**`OMR` sell-tax and NFT cap semantics.** `setSellTax` / `setTaxRecipients` already guard zero-address
recipients in both directions (the C1 burn-on-sweep class from RT#2, closed and holding). The
`0 = unlimited` convention on the two NFT caps is consistent with `VoucherClaim`/`OmertaBond` and
documented at each site — the defect was that two of them had no deploy-time home, not that the convention
disagreed.

---

## Process

Probe files (`test/zzProbe.t.sol`) written and **deleted before committing** — RT#2 left a reproduced HIGH
in an untracked scratch file for a whole session and found it only by reading `git status`, so that is a
fixed step now rather than a lesson. All mutations ran on scratchpad copies (`cp` out, `cp` back), never
`git checkout`, with uncommitted work in the same files.

The docs guard caught the stale SPEC counts (Foundry tests 301→303, tables 238→239) on the first run after
these changes, which is that guard doing its job rather than a finding.

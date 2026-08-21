# OMERTÀ — launch hype videos

One tool (`tools/hype.js`), one library of AI motion clips (Seedance 2.5, fal.ai), **six cuts** —
five short hype cuts, each with its **own footage set and its own music track**, plus the long-form
**money explainer** (`hype-money.mp4`), built from the same library.

## Build

```
FAL_KEY=… node tools/hype.js --fal --cap 150     # generate the Seedance 2.5 motion library (once)
node tools/hype.js --cut hype   --music /tmp/music/hype.wav      # build one cut with its track
node tools/hype.js --cut streets --music /tmp/music/streets.wav
node tools/hype.js --cut flywheel --music /tmp/music/flywheel.wav
node tools/hype.js --cut earn   --music /tmp/music/earn.wav
node tools/hype.js --cut short  --music /tmp/music/short.wav
node tools/hype.js --cut money  --music public/art/hype/bed-legit.m4a   # the fees/flows explainer
node tools/hype.js --all                          # rebuild all cuts (one shared track / synth bed)
node tools/hype.js                                # no key → free Ken-Burns montage → hype.mp4
```

`--fal` runs each noir plate through **Seedance 2.5 image-to-video** (real camera + scene motion — rain,
smoke, neon, fire, the figure walking). Jobs run in **parallel** with a hard `--cap` + a spend ledger.
Each cut is a **fast edit** of that shared library, so every video costs **one** round of generation.

**Seedance keeps the (landscape) source aspect** regardless of the requested ratio — the plates are all
16:9, so every clip lands landscape. The four landscape cuts cover-crop to 1920×1080 (near no-op); the
vertical short **cover-crops to 1080×1920** (the noir plates are centre-weighted, so the subject fills
the phone frame edge-to-edge — cleaner than a blur-fill of near-black footage).

## The cuts

| file | size | ~len | job | angle |
|---|---|---|---|---|
| `hype.mp4` | 1920×1080 | ~13s | the trailer | the city / world, earnings closer |
| `hype-streets.mp4` | 1920×1080 | ~12s | crime/action | the jobs — hitman, heist, arson, cars |
| `hype-flywheel.mp4` | 1920×1080 | ~15s | tokenomics | the $OMR value flywheel, mechanism-true |
| `hype-earn.mp4` | 1920×1080 | ~13s | acquisition | risk-to-earn: play, take it, cash out |
| `hype-short.mp4` | 1080×1920 | ~10s | social | vertical, fastest cut for X/TikTok/Reels |
| `hype-money.mp4` | 1920×1080 | ~77s | explainer | the FULL money map — every fee, every flow, the RWA arc |

The five hype cuts have **distinct footage** (no reused shots between cuts except the shared OMERTÀ
end-plate) so they don't feel repetitive when posted together; the explainer, being ~5× longer, draws
freely on the whole library.

## Music

Five distinct dark-phonk / mafia-trap beds (one per cut), generated on fal (stable-audio). The tool's
`--music` path treats the track as the **bed** and layers a synth **riser + sub-bass IMPACT** on the
OMERTÀ title reveal — the classic trailer "music bed + logo BRAAAM", so every cut lands a payoff even
when the track's own dynamics don't. The bed is loudness-normalized (loudnorm I=-15) and the whole mix
is compressed + limited. **Founder swaps a licensed track before public** (`--music track.mp3`).

## Copy — earnings + the flywheel (founder-directed 2026-08-14)

The founder lifted the standing no-earnings rule and asked for earnings language + the $OMR value
flywheel. The copy is **mechanism-true** and carries **no fabricated numbers**:

- **flywheel** (all true per the design): *$OMR isn't printed, it's bought* · *every sink buys $OMR off
  the market* · *buybacks from real revenue* · *fund the players who play* · *spenders fund earners*.
- **earn**: *play, take risks* · *take it off somebody who didn't* · *turn the streets into a living* ·
  *cash out — on-chain, for real*.

### The money explainer (`hype-money.mp4`, v2 2026-08-21)

The fees/flows cut walks the WHOLE economy, and its scene list is sourced from the money router's own
declared waterfall (`src/router.js` — the single authority on "miss no flows"), so the video and the
books cannot disagree about what the flows ARE:

- **Cold open** — the running man + the ledger slam ("every dollar is on the books").
- **Act I — every live inflow, in waterfall order**: identity fees (mint/respawn/reroll) · the Store ·
  reserve bonds · the DEX sell tax · the desk's daily auction proceeds · POL trading fees · the Bank's
  harvest fee · the $OMR exit toll + early-exit surcharge. The one declared source deliberately
  OMITTED is `trade` — it is RETIRED (the sell tax is the one hook), and filming a dead flow would be
  the empty-state honesty rule broken on camera.
- **Act II — the destinations + the $OMR loop**: the four declared destinations · the Vig buyback →
  withdrawal reserve + prize pool · the full-reserve rule (extraction ≤ inflow) · the retired printer ·
  the severance (cash can never buy $OMR) · sinks recycling to the desk · the Bank's city leg paying
  by activity · held/staked $OMR as lootable power.
- **Act III — the crews & the families** (founder-directed, v2): crew → family (recruit made men,
  tribute, turf) → family wars → **the community pot**: a declared cut of the city's real revenue
  buys $OMR for the families, and the top families split it by SEASONAL standing (tribute + wars
  won — every seat re-fought each season).
- **Act IV — the RWA arc**: treasury ETH accumulation · the Commission's daily ticker ballot · the
  walled treasury stock buys · play-weighted broker splits (idle money takes nothing) · delivery into
  the Street Deed's on-chain vault (the deed trades with its book) · the ETH vault's burn rail
  (`allocated ≤ held`).

**v2 (same day):** the founder's verdict on v1 was "not alive or captivating enough", and the cause
was structural — v1 reused the library's slow atmospheric push-ins at a uniform 2.8s cadence. v2
leads with **12 bespoke Seedance 2.5 TEXT-to-video clips** (`mm-*` in the library — footage written
for ACTION: the sprint, the ledger slam, the burning-card initiation, the gavel-to-paddles whip, the
tollgate, the halted press, the crew handshake, the family toast, the council-table pot, the five
seats), generated by `--bespoke` (parallel, ledgered against the same `hype-manifest.json`, cached
forever; t2v needs no source still, so it depends on neither the production deploy nor the art
budget). A **$30 budget cap** on this pass kept 12 of the 23 prompts written in `BESPOKE` — the rest
are future options that cost nothing until a shot table references them (`falBespoke` only generates
what a cut actually names), and the mid-list beats those trims vacated ride the strongest existing
library clips. Shot lengths vary 2.0–2.8s, and every act-boundary chapter card lands a small
sub-bass impact (the title keeps the full BRAAAM), so the long cut keeps a pulse instead of one
payoff 80 seconds in.

**The narration.** Five segments timed to the ACT boundaries (not per shot — a voice that chases
every caption reads as a caption reader), side-chain-ducking the music bed under every line. The
script lives in `tools/hype.js` (`NARRATION.money`) under the same copy rules as everything else
here, and each segment is FIT-CHECKED against its window (tempo-compressed up to a cap; past that
the build fails rather than talking over the next act). Two backends: `--vo` — the REAL voice
(fal.ai MiniMax `speech-02-hd`, `Deep_Voice_Man`, cached in the library so a rebuild never re-buys
a segment) — and `--vo-local`, the timing-true piper placeholder for judging the edit at zero spend.
**The committed v2 master carries the real MiniMax voice.** The founder signs the spoken wording
exactly as they sign the on-screen copy, before anything goes public.

Same copy rules as the rest of the file: mechanism-true, number-free (no bps, no prices, no
value-per-$OMR figure — mechanism counts like "eight ways" and "four destinations" are fine), and
the closer states plainly that **extraction opens at launch** — the rail is built and devnet-proven
but not open, and marketing must not claim otherwise. Operational note: fal's balance gate is FLAKY
under a queue of reserving jobs — a 403 "Exhausted balance" can be followed seconds later by a clean
accept — so the bespoke submitter retries through 403s with backoff and only a submit that stays
locked through the whole ladder is a real out-of-money stop.

**Legal note (flagged to the founder):** earnings/income + "OMR value" framing in *public* marketing is
the Howey-test surface. Kept defensible by staying mechanism-true and number-free, but **have counsel
eyeball the wording, and note extraction is not live until the chain layer opens (audit + launch gate)**,
before anything goes public.

## Review

The tool verifies each render is well-formed (resolution, non-black frames, audio, text paints) — but
**cannot watch them**. A person watches each `.mp4` end-to-end, and the founder signs the wording + the
tracks, before anything goes public.

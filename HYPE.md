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

### The money explainer (`hype-money.mp4`, 2026-08-21)

The fees/flows cut walks the WHOLE economy, and its scene list is sourced from the money router's own
declared waterfall (`src/router.js` — the single authority on "miss no flows"), so the video and the
books cannot disagree about what the flows ARE:

- **Act I — every live inflow, in waterfall order**: identity fees (mint/respawn/reroll) · the Store ·
  reserve bonds · the DEX sell tax · the desk's daily auction proceeds · POL trading fees · the Bank's
  harvest fee · the $OMR exit toll + early-exit surcharge. The one declared source deliberately
  OMITTED is `trade` — it is RETIRED (the sell tax is the one hook), and filming a dead flow would be
  the empty-state honesty rule broken on camera.
- **Act II — the destinations + the $OMR loop**: the four declared destinations · the Vig buyback →
  withdrawal reserve + prize pool · the full-reserve rule (extraction ≤ inflow) · the retired printer ·
  the severance (cash can never buy $OMR) · sinks recycling to the desk · family buybacks → the
  seasonal family pool · the Bank's city leg paying by activity · held/staked $OMR as lootable power.
- **Act III — the RWA arc**: treasury ETH accumulation · the Commission's daily ticker ballot · the
  walled treasury stock buys · play-weighted broker splits (idle money takes nothing) · delivery into
  the Street Deed's on-chain vault (the deed trades with its book) · the ETH vault's burn rail
  (`allocated ≤ held`).

Same copy rules as the rest of the file: mechanism-true, number-free (no bps, no prices, no
value-per-$OMR figure), and the closer states plainly that **extraction opens at launch** — the rail
is built and devnet-proven but not open, and marketing must not claim otherwise. This cut was
assembled entirely from the existing fal.ai library (no `FAL_KEY` in the build environment, and none
needed — zero new generation spend).

**Legal note (flagged to the founder):** earnings/income + "OMR value" framing in *public* marketing is
the Howey-test surface. Kept defensible by staying mechanism-true and number-free, but **have counsel
eyeball the wording, and note extraction is not live until the chain layer opens (audit + launch gate)**,
before anything goes public.

## Review

The tool verifies each render is well-formed (resolution, non-black frames, audio, text paints) — but
**cannot watch them**. A person watches each `.mp4` end-to-end, and the founder signs the wording + the
tracks, before anything goes public.

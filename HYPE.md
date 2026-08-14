# OMERTÀ — launch hype videos

One tool (`tools/hype.js`), one library of AI motion clips (Seedance 2.5, fal.ai), **five unique cuts**,
each with its **own footage set and its own music track**.

## Build

```
FAL_KEY=… node tools/hype.js --fal --cap 150     # generate the Seedance 2.5 motion library (once)
node tools/hype.js --cut hype   --music /tmp/music/hype.wav      # build one cut with its track
node tools/hype.js --cut streets --music /tmp/music/streets.wav
node tools/hype.js --cut flywheel --music /tmp/music/flywheel.wav
node tools/hype.js --cut earn   --music /tmp/music/earn.wav
node tools/hype.js --cut short  --music /tmp/music/short.wav
node tools/hype.js --all                          # rebuild all 5 (one shared track / synth bed)
node tools/hype.js                                # no key → free Ken-Burns montage → hype.mp4
```

`--fal` runs each noir plate through **Seedance 2.5 image-to-video** (real camera + scene motion — rain,
smoke, neon, fire, the figure walking). Jobs run in **parallel** with a hard `--cap` + a spend ledger.
Each cut is a **fast edit** of that shared library, so five videos cost **one** round of generation.

**Seedance keeps the (landscape) source aspect** regardless of the requested ratio — the plates are all
16:9, so every clip lands landscape. The four landscape cuts cover-crop to 1920×1080 (near no-op); the
vertical short **cover-crops to 1080×1920** (the noir plates are centre-weighted, so the subject fills
the phone frame edge-to-edge — cleaner than a blur-fill of near-black footage).

## The five cuts

| file | size | ~len | job | angle |
|---|---|---|---|---|
| `hype.mp4` | 1920×1080 | ~13s | the trailer | the city / world, earnings closer |
| `hype-streets.mp4` | 1920×1080 | ~12s | crime/action | the jobs — hitman, heist, arson, cars |
| `hype-flywheel.mp4` | 1920×1080 | ~15s | tokenomics | the $OMR value flywheel, mechanism-true |
| `hype-earn.mp4` | 1920×1080 | ~13s | acquisition | risk-to-earn: play, take it, cash out |
| `hype-short.mp4` | 1080×1920 | ~10s | social | vertical, fastest cut for X/TikTok/Reels |

Every cut has **distinct footage** (no reused shots between cuts except the shared OMERTÀ end-plate) so
the five don't feel repetitive when posted together.

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

**Legal note (flagged to the founder):** earnings/income + "OMR value" framing in *public* marketing is
the Howey-test surface. Kept defensible by staying mechanism-true and number-free, but **have counsel
eyeball the wording, and note extraction is not live until the chain layer opens (audit + launch gate)**,
before anything goes public.

## Review

The tool verifies each render is well-formed (resolution, non-black frames, audio, text paints) — but
**cannot watch them**. A person watches each `.mp4` end-to-end, and the founder signs the wording + the
tracks, before anything goes public.

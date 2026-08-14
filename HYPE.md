# OMERTÀ — launch hype videos

One tool (`tools/hype.js`), one library of AI motion clips, **four cuts** for different jobs.

## Build

```
FAL_KEY=… node tools/hype.js --fal --cap 9   # generate the motion library (once) + build all 4 cuts
node tools/hype.js --all                     # rebuild all 4 from the library (no spend)
node tools/hype.js --cut flywheel            # rebuild one
node tools/hype.js --music track.mp3 --all   # swap the placeholder synth bed for a licensed track
node tools/hype.js                           # no key → the free Ken-Burns montage (stills) → hype.mp4
```

`--fal` image-to-videos each of the game's 11 noir plates through Kling (fal.ai) — **real camera + scene
motion** (rain, smoke, neon, the figure walking) — into `public/art/hype/<plate>.mp4`. Jobs run in
**parallel** (Kling is ~4 min/clip; serial would be ~45 min) with a **hard `--cap`** and a spend ledger.
Every cut is a **fast edit** of that shared library — short shots, hard cuts, a driving synth bed — so
3–4 videos cost **one** round of generation (~$3 total at the current model).

## The four cuts

| file | size | ~len | job | angle |
|---|---|---|---|---|
| `hype.mp4` | 1920×1080 | ~16s | the trailer | world first, earnings closer |
| `hype-flywheel.mp4` | 1920×1080 | ~20s | tokenomics | the $OMR value flywheel, mechanism-true |
| `hype-earn.mp4` | 1920×1080 | ~14s | acquisition | risk-to-earn: play, take it, cash out |
| `hype-short.mp4` | 1080×1920 | ~10s | social | vertical, fastest cut for X/TikTok/Reels |

## Copy — earnings + the flywheel (founder-directed 2026-08-14)

The founder lifted the standing no-earnings rule and asked for earnings language + the $OMR value
flywheel. The copy is written **mechanism-true** and carries **no fabricated numbers**:

- **flywheel** (all true per the design): *$OMR isn't printed, it's bought* · *every sink buys $OMR off
  the market* · *buybacks from real revenue* · *fund the players who play* · *spenders fund earners* ·
  *more players → more volume → more demand*.
- **earn**: *play, take risks* · *take it off somebody who didn't* · *turn the streets into a living* ·
  *cash out — on-chain, for real*.

**Legal note (flagged to the founder):** earnings/income + "OMR value" framing in *public* marketing is
the Howey-test surface (an investment sold on profit from others' efforts). Kept defensible by staying
mechanism-true and number-free, but **have counsel eyeball the wording before it goes public.**

## Audio

Placeholder rights-free **driving synth bed** (kick + sub + a riser into the finale + an impact on the
title). Swap a licensed noir/trap/orchestral cue with `--music track.mp3` before shipping.

## Review

The tool verifies each render is well-formed (duration, non-black frames, audio present, text paints) —
but **cannot watch them**. A person watches each `.mp4` end-to-end, and the founder signs the wording +
the track, before anything goes public.

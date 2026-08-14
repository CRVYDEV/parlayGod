# OMERTÀ — launch hype video

Two ways to make it, one tool (`tools/hype.js`):

1. **`node tools/hype.js`** — the **motion montage** (default). A ~30s noir trailer built entirely from
   the game's own 245 noir plates with Ken-Burns motion, condensed-display title cards, cross-dissolves
   and a synthesized atmospheric bed. **No `FAL_KEY`, no spend** — assembled locally with a bundled
   `ffmpeg-static` + `@resvg/resvg-js` (the same rasteriser `src/cardpng.js` uses). Output:
   `public/art/hype.mp4`. This can BE the launch video, or the animatic the AI clips upgrade.

2. **`FAL_KEY=… node tools/hype.js --fal --cap 20`** — the **AI upgrade path**. For each shot it
   image-to-videos the seed plate through a fal.ai video model (Kling/Wan/Luma-class), so the pan/push
   becomes real camera motion. Hard USD cap, a `hype-manifest.json` ledger (the `tools/art.js`
   discipline). Clips land in `public/art/hype/` for **human review** (video can't be reviewed by the
   agent — someone watches each clip), then `node tools/hype.js --assemble` stitches the approved ones
   over the same title cards + audio.

## The cut (storyboard)

Marketing-rules-compliant by construction: **no earnings / income / appreciation / "play-to-earn"
language** — the copy is about the WORLD and the distinctive mechanics (permadeath, the bloodline,
going legit). **Fictional only** (no real brands/people). **The founder signs the final wording + the
tagline before this ships.**

| # | plate | motion | on-screen copy |
|---|-------|--------|----------------|
| 1 | hero-poster | push in | **OMERTÀ** |
| 2 | district-neon | pan → | A city that runs on silence. |
| 3 | interior-kitchen | push in | Build an empire. |
| 4 | interior-den | push in | Or bleed for one. |
| 5 | district-docks | pan ← | *(breathe — no text)* |
| 6 | hitman-legbreaker | punch in | Every street remembers. |
| 7 | crest | slow push | Family is leverage. |
| 8 | interior-estate | slow reveal | Go legit — or go down. |
| 9 | interior-pen | push in | Death is permanent. |
| 10 | citymap | pull back | The bloodline isn't. |
| 11 | hero-backdrop | slow push | **OMERTÀ** · enter the city — omerta.fun |

~29s. Every line is about the game, none is a money promise.

## Audio

The default bed is a synthesized noir drone + a slow pulse that builds to the final card — a rights-free
PLACEHOLDER so the cut isn't silent. **Swap in a licensed track for the real thing**
(`node tools/hype.js --music path/to/track.mp3`) — a noir/trap/orchestral cue, or one generated via a
music service. Do not ship the placeholder as the final without the founder's ear on it.

## Review before shipping

The agent can verify the render is well-formed (duration, frames, no black output) but **cannot watch it**.
A person watches `public/art/hype.mp4` end-to-end before it goes anywhere public.

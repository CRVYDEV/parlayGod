# OMERTÀ — item art pipeline (SVG now, AI later)

How the game's item icons work today, and how to upgrade them to painted art without
touching game code. Written so a non-technical founder can follow the decisions and a
developer can run the batch.

## The rule that keeps us safe (read this first)

**Fictional names, real *forms*.** Every item keeps its invented name ("The Tsarina's
Ghost", "Drum-Fed 'Orchestra'"). The *art* is allowed to look like a specific 1930s
machine — a boattail speedster, a Tommy gun, a fishing trawler — because period designs
are out of design-patent protection. What we never put anywhere (art or names) is a
**brand name, model name, logo, or badge**. This is the GTA playbook: the "Cheetah" *is*
a Ferrari to look at, but it's never called one. It matters more for us than a normal
game because OMERTÀ has real-money/crypto extraction — a trademark fight is a fight we
don't want. If anyone ever asks to use real brand names, that is a conversation to have with somebody qualified,
not a code change.

## Layer 1 — the SVG set (live today, free)

`src/assets.js` draws one vector icon per catalog item, deterministically from the
item's real fields + a hash of its id. It's served by **`GET /v1/art/:kind/:id`** and
shown in the Garage, Armory, Kitchen, Streets goods, and Port. Each item is assigned a
**period archetype** by its name then its value tier:

- **cars** (`carArchetype`): junker · sedan · coupe · truck (panel van / stakebed) ·
  limo (town car) · speedster (boattail) · armored. Rarity glows teal.
- **guns** (`gunArchetype`): pocket · auto · revolver · suppressed · shotgun · tommy
  (drum SMG) · rifle.
- **boats** (`BOAT_FORM`): dinghy · skiff · trawler · cutter · freighter · runner.
- **drugs** (`DRUG_FORM`): vial · ampoule · brick · pills · powder · blotter · jar · baggie.
- **vests / goods**: plated torso / stamped crate.

To restyle the whole set at once, edit the palette constants at the top of
`src/assets.js`. `test/hardening.js` verifies all 105 render valid SVG.

## Layer 2 — the AI-painted set (drop-in upgrade, when you want it)

Because everything is addressed by `/v1/art/:kind/:id`, swapping in painted art per item
needs **zero game-code change** — same id, same slot. The prompts are already generated:

### 1. Generate the prompts (done)
```
node tools/art-prompts.js      # → art/art-prompts.json  +  art/art-prompts.md
```
This emits **one prompt per catalog item, in lockstep with the SVG archetype** (same id
→ same body form, so a painted set matches the vector set). Each prompt = a locked shared
style + a real-*form* subject description + the item's flavor mood + (for rare items) a
"finest of its kind, teal glow" cue. `art/art-prompts.md` is the human-readable table to
skim or tweak; `art-prompts.json` is what a batch runner reads. **No brand/model/logo
text appears in any prompt.**

### 2. Run a batch (your call which model)
Feed `art-prompts.json` to whichever image model you like — GPT-image, Flux / Stable
Diffusion (via Replicate or a local ComfyUI), or Midjourney. Save each result as
`public/art/<kind>/<id>.png`. A thin runner is ~30 lines against an image API; hand me an
API key + budget and I'll write it and run the batch, or you run it yourself.

### 3. Flip the switch (one line)
Have `GET /v1/art/:kind/:id` prefer a painted file when one exists, else fall back to the
generated SVG:
```js
// in the art route: if public/art/<kind>/<id>.png exists → send it; else itemArt(...)
```
That's the whole swap. You can do it **per item** — paint the 60 cars first, leave the
goods as SVG, whatever. Nothing else moves.

## Practical notes
- **Consistency is the hard part of AI art**, not any single image. The locked shared
  style string in every prompt is what holds the set together; keep it identical across a
  batch, and fix the seed/model version so re-runs match.
- **Jurisdiction / brand check on the output**: spot-check a batch for accidental badges
  or text and regenerate those (the negative prompt already pushes against it).
- **Cost**: ~105 images. At typical per-image API prices that's a few dollars to a few
  tens of dollars for one full pass — cheap enough to iterate the style a couple of times.
- Keep the SVG set forever as the **fallback** — new items you add get an icon instantly
  without waiting on a paint pass.

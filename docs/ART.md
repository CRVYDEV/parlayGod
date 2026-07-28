# OMERTÀ — art direction and generation prompts

Every prompt here is **complete and copy-paste ready**. There are no placeholders to substitute —
an earlier draft used a `[STYLE BLOCK]` shorthand and that was a mistake, because it is not obvious
whether you are meant to send it separately. You are not. One image = one prompt = one message.

## Scope — what gets generated, and what does not

**Item icons stay procedural SVG.** `GET /v1/art/:kind/:id` (`src/server.js`) already renders one per
catalog entry — cars, boats, drugs, guns, vests, goods — keyless and cached a week. They are tiny,
deterministic, and every id already resolves. Replacing 60 cars with generated PNGs would be a real
regression in page weight and caching for no gain.

Generated art targets what has no solution today, in priority order:

1. **The landing hero** — the first thing anyone sees.
2. **Broadcast card backgrounds** — the highest-leverage art in the game, because these are what
   unfurl on X when a player shares a kill or a profile (`src/cards.js`, 1200×630). Currently
   procedural SVG.
3. **District plates** — six core districts, used as tab backdrops.
4. **System interiors** — Kitchen, Speakeasy, Pen, Estate, the Den, the Track.

## The house style

Two rules do most of the work:

- **`no text`** on every prompt. Model lettering is gibberish, and every one of these has real UI copy
  over it anyway.
- **`no people`** on backdrops. A face fights the interface. The hero is the deliberate exception.

The palette is not decorative. The console runs **teal and amber on charcoal, with red for danger**,
so keeping that phrasing in each prompt is what makes the art sit *inside* the game rather than beside
it. To shift mood per screen, change the accent and leave everything else: red for Wet Work, gold for
Going Legit, cold blue for The Pen.

## Consistency across a set

Generate the hero first. When you have one you like, take its URL/job reference and add `--sref <url>`
(Midjourney) or the equivalent style-reference input (fal/Flux) to every subsequent prompt. That holds
a set together far more reliably than shared style words — without it, fifteen images share a
vocabulary but not a look.

Parameters differ by tool. On Midjourney append `--ar 16:9 --style raw --v 7` (adjust `--ar` per
prompt below, and only ever one `--ar`). On fal/Flux set the aspect via `image_size`
(`landscape_16_9`, `square_hd`, and so on) — there are no `--` flags.

Note the icon sheet deliberately drops `--style raw` and the cinematic language: raw mode fights flat
graphic work. Photographic scenes want it; icons and crests do not.

---

## 1. Hero — the landing image

`--ar 21:9` / ultrawide

```
a lone made man in a charcoal double-breasted suit and fedora standing at the mouth of a rain-flooded
alley, back to camera, city skyline of 1940s tenements behind him, a single amber streetlamp above,
wet cobblestone reflecting neon, cigarette smoke curling, 1940s American noir, hard chiaroscuro, deep
shadow, teal and amber neon bleeding into wet asphalt, film grain, anamorphic haze, muted desaturated
palette with one hot accent, cinematic wide lens, no text
```

## 2. Broadcast card backgrounds

1200×630. These need a **quiet middle** — a name, rank and stat line render on top.

```
an empty rain-slicked noir street at night seen in deep perspective, tenement silhouettes either side,
amber streetlamps receding into fog, the centre of frame dark and uncluttered, no people, no text,
1940s American noir, hard chiaroscuro, teal and amber neon on wet asphalt, film grain, anamorphic
haze, muted desaturated palette, cinematic wide lens
```

Wanted-poster variant — swap the accent to red:

```
a rain-soaked brick wall under a bare bulb at night, torn paper and peeling paste, harsh raking light,
the centre of frame flat and uncluttered, no people, no text, 1940s American noir, hard chiaroscuro,
deep shadow, a hot red accent against charcoal and amber, film grain, muted desaturated palette
```

## 3. District plates

All `--ar 16:9`. Each ends with the same tail: *no people, no text, 1940s American noir, rain-slicked
streets, hard chiaroscuro, deep shadow, teal and amber neon bleeding into wet asphalt, film grain,
anamorphic haze, muted desaturated palette with one hot accent, cinematic wide lens*

- **THE DOCKS** — `cargo cranes and stacked crates in fog, a freighter's silhouette, oil-slick water, lantern light`
- **THE NEON MILE** — `a wet boulevard of jazz-club marquees and casino signage, reflections doubling every bulb, one parked black sedan`
- **THE CATHEDRAL** — `a soot-blackened gothic church over an empty square, pigeons, a single lit rose window`
- **THE FOUNDRY** — `an ironworks exterior at night, orange furnace glare through grated windows, chains and catwalks`
- **THE CANAL** — `a narrow waterway between tenement backs, a low stone bridge, mist on black water, a single moored skiff`
- **THE BRICK** — `a tight residential street of walk-ups and fire escapes, stoops wet with rain, washing lines overhead`

## 4. System interiors

All `--ar 16:9`, same tail as above.

- **THE KITCHEN** — `a cramped backroom drug lab, brass scales and glass flasks on a stained table, one bare bulb, steam, a cigarette burning in a tin ashtray`
- **THE SPEAKEASY** — `a red velvet basement club, brass rail, a roulette wheel mid-spin, smoke layered in the beam of a single pendant lamp, empty chairs`
- **THE PEN** — `a prison tier at night, iron catwalks receding, one cell door open, cold blue light against amber` *(swap the accent to cold blue)*
- **THE ESTATE** — `a grand old-money study, oak panelling, a wall of trophies and a covered portrait, firelight, an empty leather chair`
- **THE DEN** — `a back-room card table under a low lamp, chips and a cut deck, cigar smoke, empty chairs pushed back`
- **THE TRACK** — `an empty greyhound track at night under floodlights, wet sand, rails receding into darkness`

## 5. Flat graphic work

Icon sheet — `--ar 1:1`, no `--style raw`:

```
a set of noir crime-game iconography on flat charcoal: fedora, revolver, brass knuckles, stack of
banded cash, dice, pocket watch, wax-sealed envelope, engraved as 1940s letterpress line art in amber
ink, clean, evenly spaced, no text
```

Family crest — `--ar 1:1`, no `--style raw`:

```
an art-deco mafia family crest, engraved 1940s letterpress style in amber and black, laurel and dagger
and playing card motifs, circular seal with a blank banner, no text, flat charcoal background
```

City map — `--ar 1:1`:

```
overhead god's-eye view of a noir city at night carved into six districts, docks and canal and
cathedral and foundry and neon mile, rivers of amber light between black rooftops, rain, illustrated
like a hand-inked 1940s tourist map crossed with a crime scene diagram, no text, muted desaturated
palette, film grain
```

---

## Workflow — it is automated now

`tools/art.js` generates every image in this document from one manifest, against fal.ai's Flux endpoints.
The prompts here and the prompts in that file are the same prompts; the file is the source of truth,
because it is what actually runs.

```
FAL_KEY=... node tools/art.js            # everything missing
FAL_KEY=... node tools/art.js --list     # what exists and what each image has to survive
FAL_KEY=... node tools/art.js --force interior-pvp   # re-roll one
```

Spend is tracked in `public/art/manifest.json` (which also records every prompt and seed, so any image
can be reproduced or explained) against a hard `ART_CAP_USD` so an unattended run cannot drain the
account. At Flux-pro rates a full 42-image set costs about $2.

Two environment notes, both paid for the hard way:

- **Node's `fetch` ignores `HTTPS_PROXY`.** Behind a proxy every request 403s while `curl` to the same
  host at the same moment returns 200 — which reads exactly like a network-policy problem and is not
  one. `tools/art.js` re-execs itself once with `NODE_USE_ENV_PROXY=1` because undici reads that
  variable at initialisation, before any line of the script runs, so assigning it in-process is too late.
- **The generation endpoints are outbound HTTPS to `fal.run`.** If the environment's egress policy
  blocks it, the run fails loudly rather than silently producing nothing.

## Reviewing

Generate, then *look at the images* — in a contact sheet, at the size they will actually appear, against
the console's real palette. Prompts that read well produce images that are wrong in ways no prompt review
catches. From the real runs behind this document: a "1940s telephone exchange with patch panels and
indicator lamps" produced a **modern server room**, because those words have a contemporary meaning the
model reaches for first; "one hard lamp" on a table produced a **mid-century designer desk lamp** shot
like product photography; and an image generated specifically to sit behind a headline lost the job to
one generated for drama, because it was too dark and too blue to read against a near-black page.

Name files after what they are and what they are for. The `job` field in the manifest states what each
image has to survive, and that is the thing to judge it against — not whether it is pretty.

# OMERTÀ — THE BROADCAST (organic-growth layer on §7.13 referrals)

The goal the founder set: make guerrilla, organic marketing so effective that **players
champion the game for us** — no paid acquisition budget. The referral machinery (§7.13)
already pays a recruiter when their recruit qualifies, but it had two leaks that throttled
word-of-mouth. THE BROADCAST closes both. It is **public, keyless, read-only, and touches
ZERO §10.4 surface** (status/marketing only — no ledger row, no currency, no new faucet).

## The two leaks it closes

1. **Attribution friction.** A recruit had to *type* their referrer's name as a code on
   sign-up. Almost nobody does. So real word-of-mouth — "come play this with me" — usually
   credited no one, which quietly kills the incentive to keep referring.
2. **No shareable content.** A referral was a bare text link. Text links don't travel. What
   travels in a feed is an *image* that unfurls — a WANTED poster, a legend card, a kill
   notice — the kind of thing a proud player *wants* to post.

## The mechanism

- **Frictionless `?ref=`.** Every share links to `/u/<name>?ref=<name>`. The console captures
  `?ref=` on load and stashes it (`localStorage.omerta_ref`, 40-char clamped); character
  creation auto-fills it as `referralCode`, then clears it. So a shared link *is* the code —
  the recruit types nothing, and §7.13 credits the sharer on qualification exactly as before.
- **Shareable noir posters** (`src/cards.js` → `GET /card/:type/:name`, 1200×630 SVG, the
  OG-image ratio). Four types, all drawn from the safe public dossier:
  - **legend** — the proud-player flex (fedora, name, assassin rank *or* "gone legit" dynasty
    tier, LVL / KILLS / STANDING). Teal-tinted when the player has gone legit.
  - **wanted** — a red WANTED poster with the bounty on their head (a real dollar figure here
    is fine — it's the *contract pot*, public by design, not the player's wealth).
  - **whacked** — a kill notice ("ANOTHER BODY", the victim, "put in the river by <killer>").
  - **join** — the fallback for an unknown name ("runs with <family> · think you can take the
    city?").
- **The public profile page** (`GET /u/:name` → `Cards.profilePage`) — the champion
  destination a shared link lands on: OG/Twitter unfurl tags pointing at the legend card, the
  card rendered inline, a gold **ENTER THE CITY →** CTA to `/?ref=<name>`, and a line telling
  the visitor their referrer gets credit for bringing them in.
- **The 📣 broadcast button** on the console sheet builds the share (X intent + the profile
  URL); **share-a-win prompts** already fire the same flow after a brag-worthy result (a kill,
  a prison break, a big-score cut, a boxing purse, a standover, the First-Week capstone).

## The safety rails (why this is shippable everywhere)

- **`publicDossier` never leaks an exact wealth figure.** It returns banded status only —
  level, kills, assassin rank, family, wanted/welsher flags, dynasty tier, and the *bounty
  pot* (already public). Exact cash/bank/$OMR are never in the payload. This preserves the
  audit's **anti-precise-kill-EV rule** — a shared card can't become a wealth scanner.
- **Every route is public + keyless + read-only.** No token, no mutation, no §10.4 row. A card
  must never 500 and never emit `undefined`/`NaN`; an unknown name falls back to a clean "join
  the city" card/page, so a stale or malformed share link is harmless.
- **HTML/SVG output is escaped** (`esc`) — a player's living name can't inject markup.
- **Fictional names only.** The cards carry the game's invented family/player names; no real
  brand appears anywhere (the standing legal posture — matters more here because of real-money
  extraction).

## The test (`test/hardening.js`, THE BROADCAST block)

Seeds a wanted, blooded character, then asserts: the dossier finds the living bearer by name
and bands rank/level/flags **with no exact wealth field**; the assassin rank resolves to a
real title (the `.title` vs `.name` bug that shipped `undefined` is now regression-guarded);
all four card types are well-formed `<svg>` with no `undefined`/`NaN`, served as
`image/svg+xml`; the profile page carries the OG unfurl image + the `?ref=` CTA; and an unknown
name falls back cleanly on all three routes (never a 500).

## Deferred

- An **obituary** card type and richer share triggers.
- **Rasterization** — X/Twitter doesn't reliably render an SVG `og:image`; a PNG snapshot of
  the card is a production concern (a headless-Chromium or a resvg pass at deploy time).
- **Funnel instrumentation** — track profile views and card shares alongside the existing
  referral funnel (`GET /v1/mod/funnel`) to measure the loop's lift.

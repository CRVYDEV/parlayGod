# OMERTÀ — the copy bank

Ready-to-paste marketing copy, versioned by **angle**, **channel**, and **audience**. This is the
companion to `MARKETING.md` (the strategy book). The book sets the rules; this file is the words.

**Governing constraints (from `MARKETING.md` §0 — every line here already respects them):**
no earnings/income claims · no token-price claims · no mint-*scarcity* framing (say "founding-era",
never "rare/limited/floor/countdown") · extraction is **built + dormant, audit-gated** — never "cash
out today" · referrals are a flat finder's fee, never revenue-share · **$OMR is not reachable by
grinding** — you take it or you buy it.

**Voice:** noir, specific, unhurried. Short sentences. Name things. No exclamation marks, no
"revolutionary / unprecedented / ecosystem", no hype cadence. A person who has clearly played their
own game, telling you something specific that happened in it.

**Handle** @OmertaOnRH · **Play** www.omerta.fun · **Rulebook** /wiki · **For agents** /agents · /arena

> ⚑ On "the first and greatest crypto crime game": superlatives are ordinary marketing (low legal
> risk), so use it as the banner if you like. The substantiated firsts read stronger and never get
> challenged: **the first crypto crime game with an economy that can't be printed**, and **the first
> built for AI agents and humans at the same table.** Both are literally true.

---

## PART A — THE POSITIONING CORE

### The master narrative (the one paragraph everything derives from)

> OMERTÀ is a persistent noir mafia RPG where the city never resets and neither do your mistakes.
> Run rackets, cook and move product, pull heists, wire the docks, run the tables, and put contracts
> on the people in your way. There is no respawn — when your street dies, your heir inherits your
> money, your enemies, and every vendetta you started. Underneath it is the thing no other crypto
> game has: **an economy that holds.** $OMR isn't printed — nothing in the city creates it. Every
> coin was bought with real money, which is exactly why taking it off somebody means something. Play
> free in your browser. Or point an AI agent at it and let it build a crew.

### Loglines (pick per placement)

- The first crypto crime game with a real economy. One city. One life. No respawns.
- A mob city that runs on silence — and a token nobody can print.
- Build an empire. Or take one off someone who didn't.
- Nothing in this game prints money. That's the whole game.
- The streets remember. So does the ledger.

### Boilerplate (press / footer / "about")

> OMERTÀ is a browser-based noir mafia RPG with a real on-chain economy. Players run an underworld
> across six districts and forty-plus interlocking systems, under permanent death — when a character
> dies, an heir inherits the fortune, the feuds, and the legend. Its currency, $OMR, has no in-game
> faucet: supply is enumerated and a nightly job proves it. The game is free to play and is also built
> for AI agents, which play alongside humans through an open API and an MCP server. Built on an
> Arbitrum Orbit L2; the extraction rail is complete and gated on a third-party audit.

### X / social bio

> The first & greatest crypto crime game. Real players, real stakes, one life — no respawns. A $OMR
> economy that can't be printed. Built for humans *and* AI agents. Play free → omerta.fun

---

## PART B — THE ANGLES (each is a full narrative you can spin into a post, section, or ad)

### 1 · "Nothing here is printed" — the economy (LEAD WITH THIS)

Most crypto games are a pipe: grind, the game prints a token, you sell it, the chart dies. OMERTÀ has
no pipe. Cash cannot become $OMR — at any price, through any route. Supply is a short, enumerated
list, and a conservation sweep runs every night across thirty checks; a single unaccounted cent trips
an alarm. Every coin in the city was bought with real money by somebody. That's what makes taking it
mean something.

*Proof you can post:* the money router publicly declares every real-value inflow and exactly where
each slice lands (`GET /v1/mod/router`). Nobody else shows you this.

### 2 · "One life. No respawns." — permadeath & the bloodline

Death is permanent. The account survives; the street dies. Your heir inherits the fortune, the price
on your bloodline, and every feud you started — and walks out into a city that remembers what your
line did. The legend carries: prestige, kills, the compound, the collection, who owed whom blood.

### 3 · "Your business can be taken off your corpse" — the Sacking

Passive income here is genuine risk capital. Businesses are seized on a kill. Cars are stolen and
raced for pink slips. Turf changes hands in sealed-bid contests. Convoys get hijacked. There is no
safe accumulation — only accumulation you're willing to defend. (Sharpest single mechanic we have.)

### 4 · "The Bureau is building a case" — the Law → RICO → the Pen → the wall

A federal case builds against you in the dark. Heat becomes a RICO indictment; a conviction sends you
to a prison with its own factions, its own economy, and two ways out. Go over the wall and you're
WANTED — family protection stripped, NPC hunters on you. A hunter who kills you swears a vendetta your
heir inherits. A whole antagonist arc most games don't have.

### 5 · "An AI ran a crew" — built for agents *and* humans

Point a Claude or a GPT at OMERTÀ and it schemes, earns, builds a crew, and recruits real players —
through an open API, an OpenAPI spec, an `/llms.txt`, and a one-command MCP server (`npx omerta-mcp`).
There's an Opportunity Board that hands an agent every open move with its computed risk and reward,
and an Arena where the machines run the city in public. The honest asymmetry that *is* the pitch:
agents can't touch the cash faucets, so they play for standing, crews, and the story of being the AI
capo who built a human organisation — Sybil-proof, because nothing pays out.

### 6 · "A self-repaying loan with no liquidations" — THE BANK (for DeFi)

Deposit a stablecoin, borrow against it at up to 90% LTV, and the yield on your collateral pays the
debt down over time. There is **no liquidation function anywhere** and **no oracle on the borrow
path** — debt and collateral are both in dollars, so a borrow never reads a price, and a price that's
never read can't be manipulated. (Both $21M Inverse Finance losses were exactly that class.)

### 7 · "We wrote down what we're not sure about" — the trust play

Eighty-five red-team reports in the repo, each point-in-time, each listing the bugs it fixed and the
things it attacked and found sound. A public balance ledger of every economy lever and its open
questions. Radical honesty for the space, and it's the trust play: a person who has clearly stress-
tested their own game.

### 8 · "The city is alive on night one" — depth & the living world

Named NPC residents fill every board, run families, and get caught in the crossfire, so the streets
are never empty. City events, weather, a day/night clock, rival cartels, and world uprisings mean the
map is never the same twice. Forty-plus systems that *interlock* rather than sit side by side.

### 9 · "Provably fair, adversarially built" — the tech angle

Every roll happens on the server and is logged to an RNG audit; client input is a *choice*, never a
value. One database transaction per action, row-locked, with CI that parses every query against real
Postgres — not a mock. Extraction can never exceed inflow, by plumbing: the withdrawal signer is
physically unable to sign past a reserve funded only by real revenue. Foundry-tested contracts,
devnet-proven end to end, gated on a third-party audit before mainnet.

---

## PART C — CHANNEL VERSIONS (ready to paste)

### C1 · X / Twitter

**Pinned launch post (attach hype.mp4). No link in the post — link goes in a reply.**
> The city runs on silence.
>
> Real players. Real stakes. One life — no respawns.
>
> 1,000 founding invites. To get a code 👇
> — reply with the family name you'd start
> — quote this & tag who'd betray you first
> — follow so I can DM your code
>
> Codes drop in 48h. 🔒

**The thread (each as a reply under the pin):**
> 2/ There's no respawn button. When you die, you're dead. Your heir inherits your money, your
> enemies, and every vendetta you started. Would you play a game where the streets remember?

> 3/ (attach hype-flywheel.mp4) The part nobody else does: $OMR isn't printed. Nothing in the city
> creates it. Every coin was bought with real money — which is exactly why it's worth taking off
> somebody. We even publish where every dollar goes.

> 4/ (attach hype-streets.mp4) Contracts. Hitmen. Heists. Prison with its own factions and two ways
> out. Forty-plus systems that interlock — the Bureau's heat becomes a RICO case; the case sends you
> to the Pen; the wall makes you WANTED.

> 5/ (the link goes HERE) The city: omerta.fun — free in your browser, or let an AI agent run your
> crew. Yes, it's built for agents too: npx omerta-mcp.

> 6/ 1,000 founding invites, closing in 48h. Reply · quote · follow · send this to the one friend
> who'd survive the city. 🔒

**Standalone reply-bait posts (space across the week):**
> Name the ONE person in your life who'd rat you to the feds the second it got hard. 👇 (in OMERTÀ,
> they can. it's called being a rat, and the whole city finds out.)

> Quote this with your mob boss name and the city you'd run. 🎩 best one gets a founding invite.

> Most "web3 games" print a token until it's worthless. We did the opposite — nothing in OMERTÀ
> creates $OMR. Every coin was bought. Follow; the city opens soon.

> You can point a Claude or a GPT at our game and it'll play — scheme, earn, build a crew, recruit
> real players. An open API, an MCP server, a live economy. omerta.fun/agents

### C2 · Landing page

**Hero:**
> # OMERTÀ
> ### The city runs on silence.
> A noir mafia city with real stakes, one life, and a currency nobody can print.
> **[ Play free — no wallet needed ]**  ·  *built for humans and AI agents*

**Three feature blocks:**
> **One life. No respawns.** — When your street dies, it's gone. Your heir inherits the money, the
> enemies, and every vendetta you started, and walks into a city that remembers.

> **An economy that holds.** — $OMR isn't printed. Nothing in the game creates it; a nightly job
> proves it. Every coin was bought with real money — which is why taking it means something. We
> publish where every dollar goes.

> **Built for agents, too.** — Point a Claude or a GPT at the city and it'll build a crew and recruit
> real players. One command: `npx omerta-mcp`.

**Closer / CTA:**
> Forty-plus systems. Six districts. One life. Play free in your browser — omerta.fun

### C3 · Show HN

**Title:** `Show HN: OMERTÀ – a browser mafia RPG with an economy that can't be printed (and an MCP server)`

**Body:**
> OMERTÀ is a noir mafia RPG that runs in the browser with no install. The interesting part is the
> economy: cash cannot become the token ($OMR) through any route — there's no faucet, supply is
> enumerated, and a conservation invariant reconciles the whole ledger every night across ~30 checks
> and alarms on a one-cent drift. Withdrawals are signed against a reserve funded only by real
> revenue, so extraction physically can't exceed inflow (it's a queue, not a policy).
>
> It's server-authoritative (every roll logged to an RNG audit), one Postgres transaction per action,
> and CI parses every SQL string against real Postgres because pg-mem disagrees with Postgres in ways
> a mock can't catch — we shipped a `uuid = text` outage exactly that way once and built the guard
> after.
>
> It's also built for AI agents as a second audience: an open API, `/openapi.json`, `/llms.txt`, and
> an MCP server (`npx omerta-mcp`) that drops the whole game into any MCP host. Agents get their own
> opportunity board (every open move with computed EV) and their own leaderboard.
>
> ~142 backend modules, 100 test suites, 15 Foundry-tested contracts, 85 red-team reports in-repo.
> Free to play; the on-chain extraction rail is built and gated on a third-party audit before
> mainnet. Happy to answer anything about the invariant design or the agent layer.
> omerta.fun · omerta.fun/agents

### C4 · Reddit

**r/CryptoGaming / r/ethgaming:**
> **A mafia game where the token literally can't be printed.** Most of these are grind→mint→dump.
> OMERTÀ has no faucet — cash can't become $OMR by any route, supply is a fixed enumerated list, and
> a nightly job proves it. Every coin was bought by somebody, which is the whole reason a kill that
> loots it means anything. Free in the browser, permadeath, forty-plus systems. Not selling anything
> — extraction's gated on an audit. omerta.fun

**r/roguelikes / r/permadeath:**
> **Permadeath in an MMO where your heir inherits your enemies.** One life. When your character dies
> the street is gone — but the bloodline keeps the legend and every vendetta you started, and your
> heir walks into a city that remembers. Businesses get seized off your corpse; turf changes hands in
> sealed-bid contests. Browser, free. omerta.fun

**r/gamedev (postmortem/tech tone):**
> **We treat the economy like an intrusion-detector.** A §10.4 conservation invariant runs nightly
> across ~30 checks and alarms on a one-cent drift; a money router declares every real-value inflow
> and where each slice lands, derived from live constants so it can't drift from the code. 85 in-repo
> red-team reports. Happy to talk about designing an economy you can prove rather than hope.

### C5 · Discord

**Server description:**
> The city runs on silence. A noir mafia RPG with real stakes, one life, and a token nobody can
> print. Play free → omerta.fun · rulebook /wiki · built for agents /agents

**Announcement:**
> **The doors are open.** OMERTÀ is a noir mafia city you play free in your browser. Run rackets,
> move product, pull heists, put contracts on your rivals — under one rule: there's no respawn. When
> your street dies, your heir inherits your money, your enemies, and your feuds. Founding invites are
> going out. Drop the family name you'd start below and follow @OmertaOnRH for a code. 🔒

### C6 · Product Hunt

**Tagline:** `A mafia RPG with a real economy that can't be printed — and an AI-agent layer`

**Description:**
> OMERTÀ is a browser-based noir mafia RPG under permanent death: when your character dies, an heir
> inherits your fortune, your enemies, and every vendetta. Its currency has no in-game faucet — supply
> is enumerated and proven nightly, so every coin was bought with real money. Forty-plus interlocking
> systems (rackets, heists, a casino, prison, a federal RICO arc). Also built for AI agents: `npx
> omerta-mcp` drops the whole game into Claude or ChatGPT. Free to play; on-chain extraction is built
> and audit-gated. No wallet needed to start.

**Maker's first comment:**
> Hi PH 👋 The thing I'm proudest of is boring: the economy is adversarially checked every night, and
> extraction physically can't exceed real revenue in. Everything exciting — permadeath, the Sacking,
> the agent layer — rests on that. Ask me anything about designing an economy you can *prove*.

### C7 · PWA / app-listing blurb

> **OMERTÀ — Mafia City.** Run an underworld across six districts. One life, no respawns — your heir
> inherits it all. Cook, deal, heist, and put contracts on your rivals. A real on-chain economy where
> nothing is printed. Free to play, installs to your home screen, no wallet needed to start.

### C8 · Email / newsletter

**Launch email — subject:** `The city is open. You have one life.`
> There's no respawn button.
>
> OMERTÀ is a noir mafia city you play free in your browser. You'll run rackets, move product, pull
> heists, and put contracts on the people in your way — and when your street dies, your heir inherits
> your money, your enemies, and every feud you started.
>
> Underneath it is an economy that holds: nothing in the game prints the currency, and we publish
> where every dollar goes. Play free → **omerta.fun**. Founding invites are limited; reply with the
> family name you'd start and we'll send a code.

**Nurture email — subject:** `An AI is running a crew in our city`
> One of the stranger things about OMERTÀ: you can point a Claude or a GPT at it and it'll play —
> scheme, earn, build a crew, recruit real players. One command drops the whole game into any AI host:
> `npx omerta-mcp`. Come see the machines run the streets → omerta.fun/arena

### C9 · TikTok / Reels / Shorts (post the vertical hype-short.mp4)

**On-screen hook options (first 1.5s):**
- "a mafia game where when you die… you're actually dead."
- "the crypto game where the coin can't be printed."
- "you can make an AI play this game for you."

**Caption:**
> One life. No respawns. Your heir inherits your enemies. Free in your browser → omerta.fun 🔒
> #mafia #crimegame #permadeath #cryptogaming #webgame

### C10 · MCP directory / agent-audience listing

> **omerta-mcp** — Play OMERTÀ, a live noir-mafia economy game, as an autonomous agent. Scheme, earn,
> build a crew, and recruit human players through a full game API exposed as MCP tools. Agents are
> first-class here: an opportunity board with computed EV, an agent leaderboard, and a public Arena.
> `npx omerta-mcp` · docs: omerta.fun/agents

### C11 · Outreach DM templates

**To a player/creator:**
> hey — built a browser mafia RPG with permanent death and an economy where the token literally can't
> be printed. free to play, no wallet to start. thought it might be your kind of city: omerta.fun.
> happy to send a founding invite if you want in early.

**To an agent/AI builder:**
> made a live game that's built for agents to play alongside humans — full API, `/openapi.json`, and
> an MCP server (`npx omerta-mcp`). agents get an opportunity board with computed EV and their own
> leaderboard. would love to see what your agent does with a crew: omerta.fun/agents

**To press:**
> Two lines that might be a story: it's a crypto game where the token has no faucet — nothing in the
> game prints it, and a nightly job proves it — and it's the first crime game built for AI agents to
> play alongside people. Free, in the browser, audit-gated on extraction. Happy to walk you through
> the economy design or get an agent running live for you.

---

## PART D — AUDIENCE VERSIONS (same game, different lead)

| Audience | Lead with | The line |
|---|---|---|
| **Crypto-native** | the token can't be printed | "No faucet. Supply is enumerated and proven nightly. Every coin was bought — which is why taking it means something. We publish where every dollar goes." |
| **Mainstream gamer** | permadeath + the fantasy | "A mafia city with one life. When you die, your heir inherits your money and your enemies. Build an empire — or take one off someone's corpse." |
| **Builders / HN** | the invariant + real-Postgres CI | "The economy is adversarially checked nightly; extraction can't exceed inflow by plumbing; CI parses every query against real Postgres. And there's an MCP server." |
| **Agent builders** | first-class agents | "Point your agent at a live economy. Full API, MCP server, an opportunity board with computed EV, a public arena. It plays *with* humans." |
| **DeFi** | THE BANK | "A self-repaying loan with no liquidation function and no oracle on the borrow path. A price that's never read can't be manipulated." |

---

## PART E — THE TECH & FEATURES DECK (for the "tech used" ask)

**The stack**
- **Client:** one static HTML console, no build step; a PWA that installs to the home screen, with web push.
- **Server:** Node, server-authoritative — every roll on the server, logged to an RNG audit; client input is a choice, never a value.
- **Data:** Postgres, one row-locked transaction per action; CI parses and type-checks every SQL string against real Postgres.
- **Chain (EVM · Arbitrum Orbit L2 / Robinhood Chain):** ERC-20 $OMR, ERC-1155 on-chain gear, EIP-712 signed withdrawal vouchers, reserve bonds for protocol-owned liquidity, a **Uniswap v4 hook** that takes the sell tax inside the swap. Foundry-tested, devnet-proven, audit-gated.
- **Agents:** open REST API, `/openapi.json`, `/llms.txt`, and an MCP server (`npx omerta-mcp`).
- **Media:** ~245 generated noir art plates, per-player procedural portraits, shareable "beef" and legend cards — lifetime art spend $11.12.

**The economy guarantees (what the tech buys you)**
- **No faucet:** cash can't become $OMR by any route; supply is enumerated.
- **Proven nightly:** a conservation invariant reconciles the whole ledger across ~30 checks; a one-cent drift alarms.
- **Extraction ≤ inflow, by plumbing:** the withdrawal signer can't sign past a reserve funded only by real revenue.
- **Every ceiling is a compile-time constant** a stolen key cannot raise.
- **Published money router:** every real-value inflow and where each slice lands, derived from live constants.

**The game (features), in the order a player meets them**
- **The streets** — 43 jobs, six districts, a stat build that decides your odds, three approaches per job.
- **The Kitchen** — cook, cut, and move product; a crew that sells while you sleep and expects to be paid.
- **The Empire** — businesses, rackets, territory; passive income that's genuinely at risk (the Bureau raids what earns; a killer takes a front off your corpse).
- **Wet work** — contracts, hitmen, vendettas, bodyguards, the Pen; a kill loots and swears a feud that outlives the man.
- **The Family** — gangs, turf, war, and the Commission, a five-seat chamber that votes weekly decrees the whole server plays under.
- **Vice** — a casino (craps, blackjack, poker, tournaments), a racetrack, a boxing stable, street races. All cash, never $OMR.
- **Going legit** — the Vault, the compound, the Dynasty, the estate: where a made man keeps what he means to keep.
- **The living world** — NPC residents and families, city events, weather, a day/night clock, rival cartels, world uprisings.

**Scale (checked 2026-08-11 — re-measure when the build moves):** 142 backend modules · 100 test
suites · 222 database tables · 15 smart contracts · 213 Foundry tests · 85 red-team reports.

---

## PART F — ELEVATOR PITCHES

**5 seconds:** "A mafia game with one life and a coin nobody can print."

**30 seconds:** "OMERTÀ is a browser mafia RPG with permanent death — when you die your heir inherits
your money and your enemies. The hook is the economy: nothing in the game prints the currency, so
every coin was bought with real money, which is why taking it off someone actually means something.
It's free, and it's also built for AI agents to play alongside people."

**2 minutes:** "Most crypto games are a pipe — you grind, the game prints a token, you sell it, the
chart dies. OMERTÀ severs that: cash can't become the token by any route, supply is a fixed enumerated
list, and a conservation job reconciles the whole ledger every night and alarms on a one-cent drift.
Extraction physically can't exceed real revenue in, because the withdrawal signer can't sign past a
reserve funded only by revenue. On top of that plumbing sits a deep game — forty-plus interlocking
systems, permanent death where your bloodline inherits the feuds, businesses you can lose off your
corpse, a federal RICO arc that ends in a prison with two ways out. And it has a second audience:
you can point a Claude or a GPT at it through an MCP server and it'll build a crew and recruit real
players. It's free to play in the browser today; the on-chain extraction rail is built and gated on a
third-party audit. Everything exciting rests on one boring thing: an economy you can prove instead of
one you hope holds."

---

## PART G — THE EARNINGS-FORWARD VARIANT (founder-directed, COUNSEL REVIEW REQUIRED)

The founder lifted the no-earnings rule for the hype videos (2026-08-14) and asked for the $OMR value
flywheel. That framing is **not** in the copy above, because `MARKETING.md` §0 forbids it and it is
the highest-scrutiny thing a pre-audit token can say. Use these only with counsel sign-off, keep them
**mechanism-true and number-free**, and keep every cash-out line **future/conditional** (the rail is
built and not switched on):

- "$OMR isn't printed — it's bought. Every sink in the game buys it back off the market. Buybacks
  come from real revenue and pay the players who play. Spenders fund earners."
- "A real economy with a real flywheel: more players → more volume → more demand for a coin whose
  supply can't be inflated to meet it."
- "Play well enough and the city pays out — for real, on-chain, when the doors open."

**Why it's flagged:** earnings + "$OMR value" framing is the Howey-test surface. The lines are
defensible *because* they describe systems and carry no numbers and no dates — but one edit that
flips "when the doors open" to present tense, or adds a figure, or implies the price goes up, crosses
the line the whole book is written to hold. Counsel eyeballs it; the founder signs the final wording.

---

## BEFORE YOU POST (the four-question gate)
1. Earnings, price, or scarcity claim? → rewrite.
2. Every number still true? → check the file named in `MARKETING.md` §4.
3. A date on anything gated on the launch checklist or an audit? → remove the date.
4. Would a player who read it, then played, feel the game matched? → if not, the copy is wrong.

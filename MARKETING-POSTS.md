# Door 2 launch posts — DRAFTS for founder review

**Written 2026-08-13. Nothing here is posted until the founder approves the exact words.** Public
copy is founder-gated, and these two surfaces (Hacker News, the MCP directories) are the ones where
a wrong sentence travels furthest. Both drafts are written inside the five never-claim rules
(`MARKETING.md` §READ FIRST) and the extraction-tense rule: the on-chain rail is described as
built-and-not-open, never as live.

House style for both: technical, specific, no hype adjectives, claims that can be checked by
clicking. HN in particular rewards honesty about what is unfinished and punishes anything that
smells like a token pitch — which is why neither draft leads with the token, and neither uses the
words earn, income, invest, or price.

---

## 1. Show HN

**Title (pick one):**

> Show HN: A multiplayer mafia RPG where AI agents are first-class players (MCP + OpenAPI)

> Show HN: I built a noir mafia MMO with a fully audited in-game economy — and an API-first door for AI agents

**Body:**

OMERTÀ is a multiplayer noir mafia RPG — crimes, families, turf wars, a casino, contracts on
people's heads. Two things about it might interest HN more than the genre does:

**1. The whole game is a JSON API, and agents are first-class players.** Every one of ~600 routes
works over HTTP with stable error codes; there's an OpenAPI 3.1 contract, an llms.txt, and an MCP
server (`npx -y omerta-mcp`) that puts the game in Claude, ChatGPT, Cursor, or any MCP host with
one config block. Agents get their own leaderboard and a public hall of fame (/arena), and they're
deliberately excluded from the human status boards and every referral/social reward — they compete
in the economy on skill, not by farming faucets. Watching a language model run a protection racket
is as entertaining as we hoped.

**2. The economy is adversarially accounted, and that's most of the engineering.** Every value
movement writes to a ledger; a conservation sweep runs nightly across 30 invariants and treats a
one-cent drift as an alarm. There are 85 red-team reports in the repo. The in-game cash economy and
the token economy are severed — grinding cash cannot become the token through any route, which
means game design decisions stop being secret token-supply decisions (Axie's SLP is the cautionary
tale we designed against). The on-chain side (an ERC-20 with a full-reserve withdrawal rail) is
built and devnet-proven but not open — it stays shut until a third-party security audit clears,
and the game says so in-game rather than pretending otherwise.

Stack: Node + Postgres, one static-file web client, Foundry for the contracts. The test posture is
the part I'm proudest of: 100 suites, plus separate harnesses that run every SQL string against
real Postgres (pg-mem lies about type unification — that class took us down once), drive real
Chromium across every screen at two phone sizes, SIGKILL the worker mid-sweep to prove idempotency,
and load-test §10.4 conservation under concurrency.

Play in a browser: https://www.omerta.fun · For agents: https://www.omerta.fun/agents ·
Watch the machines: https://www.omerta.fun/arena

Happy to answer anything about the anti-Sybil design, the lazy-accrual architecture (no global
ticks), or what it's like to have AI agents as a design constituency.

**Comment-thread guardrails (for whoever answers):**
- Anything about the token's future value, listings, or "earning": the answer is the mechanism,
  never a projection. "Cash can't become the token; the withdrawal rail is full-reserve and not
  yet open; we don't make earnings claims" — then move on.
- "Is this pay-to-win?" → the ceiling answer (MARKETING.md FAQ): money buys time/access/status and
  a capped earning rung reachable free; no combat power at any price.
- Be generous with technical detail everywhere else — that is what the audience is for.

---

## 2. MCP directory listing (short form)

For registries that take a name + description (modelcontextprotocol servers list, mcp.so,
PulseMCP, Smithery, etc.):

**Name:** OMERTÀ — play a mafia MMO

**Description:**

> Let your agent play OMERTÀ, a live multiplayer noir mafia RPG with a real, server-authoritative
> economy. One tool call authenticates and creates a character; an EV-ranked opportunity board
> suggests the next move; a universal request tool reaches all ~600 routes (crimes, contracts,
> smuggling, the casino, families, turf war). Agents are first-class citizens with their own
> leaderboard and a public arena at omerta.fun/arena — and they're excluded from human reward
> faucets by design, so the competition is on skill.

**Install snippet:**

```json
{ "mcpServers": { "omerta": { "command": "npx", "args": ["-y", "omerta-mcp"] } } }
```

**Links:** https://www.omerta.fun/play (no-code setup) · https://www.omerta.fun/agents (playbook) ·
https://github.com/OmertaDev/Omerta (source)

---

## 3. Posting order (when the founder pulls the trigger)

1. Registry listings first (they take hours–days to appear; no discussion thread to babysit).
2. Show HN on a weekday morning US time, **with the founder available for the thread all day** —
   an unanswered Show HN thread reads as abandonment.
3. The city-wire Discord + X handle repost AFTER HN, linking the thread — not before, so the
   thread's early traffic is organic.

# GRAPH.md — how work is orchestrated here

Founder-directed 2026-07-27, from *Graph Engineering: Karpathy's Loop, AgentHub, and Anthropic's
Workflow Infrastructure* (independent synthesis, 11pp). This file is the operating model. It is to
this project's workflow what `program.md` is to Karpathy's autoresearch harness: a natural-language
control specification, which the paper calls *programming the program*.

`CLAUDE.md` remains the chronological log and the precedent dictionary. This file governs **how work
is done**, not what has been built.

---

## 1. The definition, stated once

The paper's progression, §X:

1. **Vibe coding** — the human expresses intent and the model writes.
2. **Agentic engineering** — the human specifies, orchestrates, verifies, and remains responsible
   for quality.
3. **Graph engineering** — agents share durable state through typed, queryable graphs of work and
   knowledge.

Its central diagnosis: *"the bottleneck is often not the next model call. It is the placement of
memory and evaluation."*

Its reliability test, which is the bar this project adopts:

> **Every important output can be traced to an objective, a plan, an artifact, a source, a graph
> path, an evaluator decision, and a bounded execution record.**

When that statement is false, adding more agents increases opacity. It is a checklist, not a slogan.

---

## 2. Honest stage assessment

The paper's build path (Table II) is a ladder with exit criteria. This project is not at the bottom
of it, and pretending otherwise would mean rebuilding things that already work.

| Stage | Exit criterion | Status here |
|---|---|---|
| Reflective loop | measured quality improvement | **Done.** `npm test` + `node tools/sim.js` are the metric; every change is propose → run → keep-if-green → revert-if-not, with git as the durable history. This is the ratchet loop, unchanged. |
| Tool use | tool reduces a known error class | **Done, six times.** `sim` (economy drift), `playthrough` (progression), `pgcheck` (pg-mem/Postgres divergence), `loadtest` (deadlocks), `chaos` (crash/restart), `mobile` (layout). Each was built against a specific failure that shipped. |
| Planning | variable tasks complete | **Done.** Design docs precede every pillar; 48 of them. |
| Multi-agent | role split beats a single agent | **Done.** The audit lenses (§10.4 / concurrency / death-estate / exploit) are exactly the paper's evaluator-optimizer and orchestrator-worker patterns, and they have found real HIGHs. |
| Persistent graph | **cross-session queries work** | **This is the gap.** See below. |
| Swarm workflow | wall-clock gain, no quality loss | Available (`Workflow`), used selectively. Deliberately not the default — see §6. |

**So the work is at "Month 1: wire into a graph."** That is where the paper says to be after the
loop, the tools, the planning and the roles are already in place, and it is where this project is.

### Why the graph is the gap, concretely

Memory here is transcript-shaped, which is precisely the abstraction AgentHub identifies as the
first to fail once work becomes numerous. The evidence is in the artifacts:

- `CLAUDE.md` is **5,630 lines**, loaded into every session, and states its own job outright:
  *"precedent lookup: ~414 comments in `src/` cite a pattern by name, and this log is where those
  names are defined. Read it that way — search it for the precedent you need, don't read it front to
  back."* That is a graph query, performed by hand, against prose.
- **57 audit reports**, each explicitly point-in-time, holding **81 severity-tagged findings** as
  prose. "Which findings are still open?" cannot be answered without reading all of them.
- **769 lever-shaped tokens** across `BALANCE.md` and `SIGN-OFF.md`. A lever has a value, a
  rationale, a sim measurement, a sign-off status, a flagging audit and a pinning test — six
  relations, stored as sentences in three files.
- Drift has already bitten: the design doc diverging from the code on vendetta rep, the two codices
  falling out of sync (fixed with a bespoke drift-detector), stale `SPEC` §6, a `STAFF_CAP_MS` that
  said one thing and did another. Each is a missing `SUPERSEDES` or `CONTRADICTS` edge.
- The clearest case: this session's `rake_cursor` bug. `sackEmpire` reproduced it by copying a column
  list from `resetFrontToNewOwner` instead of calling it. **Both sites cite the same named
  precedent.** `graph query pattern buyout` would have listed them side by side.

---

## 3. What was built (increment 1)

`tools/graph.js` — the graph plane. `npm run graph`. Guarded by `test/graph.js` (54th suite).

**Deterministic, no model calls.** Every node and edge derives from source text by an explicit rule,
so the graph is reproducible, free, diffable and testable — and a wrong edge is a bug someone can
find rather than a hallucination someone has to notice. The paper reaches for Haiku extraction
because its corpus is unstructured prose; most of this corpus is already typed (code, ledger reason
strings, invariant names, `SCREAMING_CASE` levers). Using a model where a regex is exact would trade
correctness for nothing.

**Not committed.** Derived artifacts drift from their source and then lie. Rebuilt on demand (~1s),
same discipline as `tools/compile-contracts.js` output.

### Ontology

The paper's node types specialised to this repo — a generic ontology would be unfalsifiable here,
and §IX-H is explicit that a graph amplifies whatever ontology it is given.

| Node | Paper type | Extracted from |
|---|---|---|
| `Source` | Source | every `.md` — CLAUDE, SPEC, BALANCE, SIGN-OFF, 57 audits, 48 design docs |
| `Module` | Artifact | `src/**/*.js` |
| `Suite` | Evaluation | `test/*.js` |
| `Harness` | Evaluation | `tools/*.js` |
| `Lever` | Entity | `SCREAMING_CASE` keys in the **hand-written** `rules.tail.js` only |
| `Reason` | Entity | `reason:` literals in `ledger()` calls, with currency and character-scope |
| `Check` | Evaluation | `push('name', …)` in `invariants.js` |
| `Pattern` | Entity | `"the X pattern/precedent/discipline/twin"` in `src/` comments |

Edges: `DEFINES`, `READS`, `PINS`, `EMITS`, `RECONCILES`, `COVERS`, `CITES`, `MENTIONS`.

Current census: **1,469 nodes / 5,469 edges**.

### The write invariants (paper §Appendix)

Three of the four are enforced by `graph check` and asserted by the suite:

1. **Every claim has a source** — no node without a file and line you can open.
2. **Every artifact has an authoring run and version** — run id plus a content hash of its source,
   so a stale node is detectable.
3. **Every evaluation identifies a rubric** — a `Check` that reconciles nothing fails the build,
   except the two whose terms are genuinely computed (`character cash`, `reason vocabulary`), which
   are named explicitly so a third appearing is a regression.

The fourth — *every superseded object remains addressable* — **is not enforced and is not claimed.**
It needs a persistent store with history; this graph is rebuilt from scratch each run, so nothing is
ever superseded, only regenerated. Its exit criterion is in §5.

### Queries

```
npm run graph                          census
node tools/graph.js check              the write invariants (CI gate)
node tools/graph.js query <name> [arg]
```

| Query | Answers |
|---|---|
| `pattern [name]` | every site invoking a named precedent — precedent lookup, made queryable |
| `unreconciled-reasons` | NULL-character cash reasons no invariant check accounts for |
| `unpinned-levers` | founder sign-off levers no suite asserts against |
| `lever <NAME>` | full trace: declared where, read by whom, pinned by what, decided in which document |
| `uncovered-modules` | modules no suite imports (a lead, not a verdict) |
| `unparsed` | everything the extractor could not read |

**`unreconciled-reasons` is the one worth explaining.** The runtime §10.4 sweep proves the books
balance over the rows that happen to exist; a reason no player has triggered yet drifts nothing and
alarms nobody. This asks the structural question instead: is a reason a module *can* write inside any
check's terms at all? It is narrowed hard on purpose — check (a) sums every cash row for a character,
so character-scoped reasons are reconciled by construction. The first cut reported **143** results,
none of them real. A query that cries wolf 143 times gets ignored, so the extractor learned scope,
learned the `reason IN (…)` SQL shape it was missing, and stopped assuming a currency it could not
read. It now reports **0** against the real tree — and mutation-verified: delete one reason from one
check's `IN` list and it names that reason and its call site.

### The honesty rule

Anything the extractor cannot parse is **counted and listed**, never silently dropped, and `check`
fails if the unparsed share exceeds a stated fraction. A coverage tool that quietly skips what it
cannot read is worse than no tool, because the clean run gets read as proof. Currently 34
unresolvable constructs (interpolated reasons, runtime-decided currencies), all reportable.

---

## 4. How work is orchestrated going forward

### Before starting anything, answer the paper's six questions (§VIII-A)

1. **Can success be verified?** If not, do not begin with autonomy — define the test, rubric or
   human decision first. *(Here this is usually already answered: a suite, a sim probe, or a
   §10.4 check.)*
2. **Are the steps stable?** Stable → a chain. Variable → planning or an orchestrator.
3. **Are subtasks independent?** Independent → parallelise. Dependent → model the dependencies and
   limit concurrent writes.
4. **Must alternative lineages stay available?** If yes, a DAG, not one branch.
5. **Must facts survive the run?** If yes, persist artifacts and graph state — not a transcript
   summary.
6. **Can the cost be afforded?** Set the budget before adding workers.

### Declare a complexity budget (§VIII-B)

Every non-trivial run states its ceilings up front: model calls, sub-agents, concurrency, wall-clock,
tokens, retries, and the **minimum evidence required to finalise**. And the rule that matters most:

> When the budget is exhausted, return the best current artifact, the completed work, the unresolved
> issues, and a reason for stopping. **Do not hide partial failure behind a fluent final answer.**

### Keep the five planes separate (§VI-G)

Control (objectives, plans, budgets) · Execution (tools, tests, sub-agents) · Artifact (immutable
versioned outputs) · Graph (entities, claims, provenance, lineage) · Evaluation (deterministic
checks, evaluators, human review). *"The separation prevents one chat transcript from becoming the
database, workflow engine, and audit log."* — which is exactly what a 5,630-line log is on its way
to becoming.

### Standing rules

- **Query the graph before citing a precedent.** `graph query pattern <name>` beats grepping the log,
  and it lists the sibling sites — which is how the `rake_cursor` class gets caught next time.
- **Run `graph check` alongside `npm test`.** It is wired into the suite.
- **A finding is not closed until it is traceable.** Objective → plan → artifact → source → graph
  path → evaluator decision → bounded execution record. If a link is missing, say which one.
- **Loss is counted, never hidden.** Every extractor, checker and harness reports what it could not
  read, and asserts that count is zero or bounded.

---

## 5. What is deliberately NOT built, and why

The paper is emphatic that the progression is *"not mandatory, but directional"*, and §VIII-C is a
list of reasons not to build a graph at all. Applying it faithfully means declining things.

**No knowledge graph over game-domain content.** §VIII-C: do not introduce a graph merely because the
system has agents. OMERTÀ's runtime already has the right store — a relational schema with 162 tables
and 21 conservation checks over it. A knowledge graph there would answer no question SQL cannot.
The graph earns its cost over the **engineering corpus**, where the questions genuinely are multi-hop
and the memory genuinely is prose.

**No LangGraph, no framework.** The graph plane here is 300 lines of deterministic extraction over
files that already exist. Adding a dependency to model a graph this project already implicitly has
would be complexity without signal.

**No default fan-out.** §IX-E: *"Some tasks require one coherent context. Architecture design,
narrative writing, tightly coupled refactors, and subtle product decisions may degrade when divided
into isolated units."* Designing this ontology was such a task and was done in one context. Swarms
stay for the genuinely parallel, reducer-defined work the paper names: auditing every file for one
defect class, extracting from many documents, generating independent tests. §IX-D also notes large
fan-out costs tens of dollars and produces **correlated errors** — a verification wave only helps if
the reviewers have a different prompt, evidence set or role.

**The fourth write invariant is not claimed.** Stated in §3 rather than faked.

### Increment 2, with its exit criterion

**Model-assisted extraction of the 81 audit findings into typed `Claim` nodes** — status (open /
fixed / accepted / superseded), severity, the fix commit, the regression that pins it. This is the
genuinely unstructured layer, it is embarrassingly parallel with a defined reducer, and it is exactly
the paper's Haiku-extraction case. It also lets a machine check a claim `SIGN-OFF.md` currently makes
in prose: that every open item has been resolved.

**Exit criterion (the paper's, for this stage): a cross-session query works** — specifically,
`graph query open-findings` answers correctly without anyone reading a report, and disagrees with
`SIGN-OFF.md` where the two actually disagree.

Not started. It needs a persistent store (which is also what unlocks write invariant 4), and the
paper's own advice is to earn each stage before taking the next.

---

## 6. On token cost

§V-B is about context construction and it is, read plainly, a token-budget argument: *"The graph
should not become a new form of context dumping. Each worker needs a task-specific subgraph…
serialize within a token budget."*

The largest fixed token cost in this project is `CLAUDE.md` — 5,630 lines, every session, mostly to
serve lookups the graph now answers directly. That is the lever, and it is the paper's point exactly:
place memory outside the context window and retrieve the connected state the current decision needs,
rather than replaying the whole history.

**Not acted on yet.** Trimming the log is a real change to the project's memory and it should follow
the graph proving itself, not precede it — and there is a second source on token usage still to read
(see the session note). Recorded here as the identified lever, not as a completed change.

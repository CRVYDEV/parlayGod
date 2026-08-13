#!/usr/bin/env node
// OMERTÀ — Model Context Protocol server. Exposes the game as MCP tools so ANY MCP-capable agent
// (Claude Desktop, Claude Code, an SDK agent, …) can play natively. It is a thin, stateful proxy
// over the OMERTÀ HTTP API: it holds the session token in memory and forwards tool calls as JSON
// requests. The universal `omerta_request` tool reaches every one of the game's ~279 routes; the
// convenience tools cover the hot path (start → look around → act). Uses the low-level Server API
// (raw JSON Schema, no zod) so it works across SDK versions.
//
// Config (env): OMERTA_BASE_URL (default https://www.omerta.fun), OMERTA_TOKEN (optional pre-set
// token), OMERTA_INVITE (optional closed-alpha invite code used by omerta_start).
//
// Install:  nothing — an MCP client runs it via `npx -y omerta-mcp`. (For local dev: npm install.)
// Run:      OMERTA_BASE_URL=https://www.omerta.fun node index.js   (or via an MCP client config)

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'node:crypto';

const BASE = (process.env.OMERTA_BASE_URL || 'https://www.omerta.fun').replace(/\/$/, '');
let token = process.env.OMERTA_TOKEN || null;

// One HTTP call to the game. Sends the bearer token if we have one + a fresh idempotency key on
// mutations (the server replays a repeated key instead of double-spending). Never throws — returns
// { status, body } so the agent can branch on the game's stable string error codes.
async function api(method, path, body) {
  // (red-team R13 HIGH) `path` is agent-controlled and reaches this proxy via prompt-injection through the
  // attacker-controlled game content agents are told to poll (names, contract reasons, the feed). A raw
  // `BASE + path` string concat lets a crafted path steer the request OFF-ORIGIN — `@evil.com/x` →
  // `https://www.omerta.fun@evil.com/x` (host evil.com), `//evil.com/x`, or a full `https://…` — and since
  // we attach the PERMANENT agent bearer to every call, that exfiltrates the account key (→ takeover +
  // on-chain extraction). Resolve against BASE and HARD-ASSERT same origin: never fetch, and never attach
  // the token to, any host but ours.
  let url;
  try { url = new URL(path, BASE + '/'); } catch { return { status: 0, body: { error: 'bad_path', message: 'unparseable path' } }; }
  if (url.origin !== new URL(BASE).origin) return { status: 0, body: { error: 'bad_path', message: 'path must stay on the OMERTA origin' } };
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  // (red-team R20) redirect:'manual' — the origin hard-assert above validates only the initial URL; an
  // on-origin open redirect would otherwise be FOLLOWED off-origin (undici strips Authorization cross-origin,
  // so no token leak, but keep it defense-in-depth). A real route never 3xx-redirects.
  const opts = { method, headers, redirect: 'manual' };
  if (body !== undefined && method !== 'GET') {
    headers['content-type'] = 'application/json';
    // (red-team R20) DETERMINISTIC idempotency key = hash of {method,path,body}, NOT a fresh UUID per call.
    // A fresh UUID meant a downstream-LLM retry of a money mutation (re-calling omerta_request with the same
    // {method,path,body} after an ambiguous/timed-out result) sent a NEW key → the server executed it as a
    // fresh action = accidental double withdraw/swap, contradicting the retry-safety AGENTS.md promises.
    // Content-hash → a logical retry replays the stored response; a genuinely-different request gets a
    // distinct key. (An intentional identical repeat replays too — the safe default for money moves.)
    headers['idempotency-key'] = createHash('sha256').update(`${method} ${path} ${JSON.stringify(body)}`).digest('hex').slice(0, 32);
    opts.body = JSON.stringify(body);
  }
  let res, text;
  try { res = await fetch(url, opts); text = await res.text(); }
  catch (e) { return { status: 0, body: { error: 'network', message: String(e?.message || e) } }; }
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

const ok = (data) => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });

const TOOLS = [
  {
    name: 'omerta_start',
    description: 'Authenticate as an AGENT and optionally create a character. Gets a guest token, '
      + 'upgrades it to a permanent agent key (🤖 badge, 1 action/3s throttle), and — if `name` is '
      + 'given — creates your character. Call this first. Read GET /agents (omerta_request) for the '
      + 'full player guide.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Character name to create (2–24 chars, unique among the living). Omit to only authenticate.' },
        inviteCode: { type: 'string', description: 'Closed-alpha invite code, if required (else set OMERTA_INVITE).' },
        referralCode: { type: 'string', description: "The recruiter's character name, if you were referred." },
      },
    },
  },
  { name: 'omerta_me', description: 'Your full character sheet: vitals, status, holdings, and the server\'s `coach` hint (the single highest-value next step).', inputSchema: { type: 'object', properties: {} } },
  { name: 'omerta_rules', description: 'The machine rulebook: crimes, districts, guns, drugs, goods, catalogs, thresholds, paths.', inputSchema: { type: 'object', properties: {} } },
  { name: 'omerta_opportunities', description: 'THE OPPORTUNITY BOARD — every open economic action (contracts, convoys, loans, buy-orders) ranked by reward + the standing skill-loops (trade-goods arbitrage spreads, the $OMR→cash redemption window, loan sharking) with live signals. Carries a `best` recommended move. Poll this to decide what to do.', inputSchema: { type: 'object', properties: {} } },
  { name: 'omerta_arena', description: 'THE ARENA — the public agent hall of fame + the agent-economy meta (how many agents, collective wealth band, total $OMR extracted, top hunter). The "how are other machines doing" read.', inputSchema: { type: 'object', properties: {} } },
  { name: 'omerta_leaderboard', description: 'Read any public status board, e.g. "agents" (the machine hall of fame), "hitmen", "crews", "recruiters". Defaults to the agent board.', inputSchema: { type: 'object', properties: { board: { type: 'string', description: 'Board name, e.g. agents, hitmen, crews, recruiters, city. Default: agents.' } } } },
  {
    name: 'omerta_request',
    description: 'The universal escape hatch: make ANY request to the OMERTÀ API (all ~279 routes). '
      + 'Use the OpenAPI spec (GET /openapi.json) to discover routes. Mutations auto-carry an '
      + 'idempotency key. Errors come back as { error: <stable code>, message }.',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['GET', 'POST', 'DELETE', 'PUT'], description: 'HTTP method.' },
        path: { type: 'string', description: 'Route path, e.g. "/v1/crimes/pick" or "/v1/window/redeem".' },
        body: { type: 'object', description: 'JSON body for a mutation (optional).' },
      },
      required: ['method', 'path'],
    },
  },
];

const server = new Server({ name: 'omerta', version: '1.0.1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  switch (name) {
    case 'omerta_start': {
      const invite = args.inviteCode || process.env.OMERTA_INVITE;
      const guest = await api('POST', '/v1/auth/guest', invite ? { inviteCode: invite } : {});
      if (guest.status !== 200) return ok({ step: 'guest', ...guest });
      token = guest.body.token;
      const key = await api('POST', '/v1/auth/agent-key', {});
      if (key.status === 200 && key.body.token) token = key.body.token; // switch to the agent token
      let character = null;
      if (args.name) {
        const c = await api('POST', '/v1/character', { name: args.name, referralCode: args.referralCode });
        character = c.body;
      }
      return ok({ authed: true, agent: key.status === 200, base: BASE, character,
        next: 'Call omerta_me, then omerta_opportunities. See GET /agents for the full guide.' });
    }
    case 'omerta_me': return ok(await api('GET', '/v1/me'));
    case 'omerta_rules': return ok(await api('GET', '/v1/rules'));
    case 'omerta_opportunities': return ok(await api('GET', '/v1/opportunities'));
    case 'omerta_arena': return ok(await api('GET', '/v1/arena'));
    case 'omerta_leaderboard': return ok(await api('GET', `/v1/leaderboard/${encodeURIComponent(args.board || 'agents')}`));
    case 'omerta_request': {
      if (!args.path || !args.method) return ok({ error: 'need method + path' });
      return ok(await api(args.method, args.path, args.body));
    }
    default: return ok({ error: 'unknown_tool', name });
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[omerta-mcp] connected — base ${BASE}${token ? ' (token preset)' : ''}`);

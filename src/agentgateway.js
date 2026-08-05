// THE AGENT GATEWAY — the machine-discovery layer. Agents are first-class players (see AGENTS.md),
// so the game publishes a standard OpenAPI 3.1 contract + an llms.txt index, both auto-derived from
// the live route registry (server.js collects routes via an onRoute hook, so this never drifts from
// what's actually mounted). Read-only, keyless, zero §10.4 surface.

// Routes reachable WITHOUT a player token (the discovery + auth surface). Everything else under
// /v1 needs the bearer JWT; anything under /v1/mod/ needs the x-mod-key header instead.
const PUBLIC_PATHS = new Set([
  '/', '/wiki', '/admin', '/agents', '/AGENTS.md', '/llms.txt', '/openapi.json',
  '/v1/rules', '/v1/catalog',
  '/v1/auth/guest', '/v1/auth/x', '/v1/auth/privy',
]);

// Human/asset routes we don't advertise in the machine API contract (they serve HTML/markdown).
const DOC_PATHS = new Set(['/', '/wiki', '/admin', '/agents', '/AGENTS.md', '/llms.txt', '/openapi.json']);

// A short, human-legible summary per top-level system (the OpenAPI tag). Anything unmapped falls
// through to a generic line — the contract stays complete even as new systems land.
const TAG_DESC = {
  auth: 'Authentication: guest, X/Privy sign-in, guest→provider upgrade, and the agent key.',
  character: 'Create/read your character; the on-chain mint that unlocks extraction.',
  crimes: 'The core cash+respect grind.', train: 'Spend energy to raise a stat.',
  bank: 'Deposit/withdraw pocket cash (banked cash is safer but rides in transit).',
  travel: 'Move between districts.', kitchen: 'The drug lab: makings, cook, collect, deal, crew.',
  swap: 'RETIRED — cash and $OMR no longer trade; the Exchange window (window) is the one-way $OMR→cash exit.',
  stake: 'The Vault: stake $OMR to keep it loot-proof (principal only — the old yield pays the families now).',
  market: 'The black market: car auctions, goods, buy orders.', goods: 'Buy/sell trade goods.',
  convoy: 'Bulk smuggling on a real clock; ambush rivals\' freight.',
  contracts: 'The contract board: browse/fund/cancel kill & hospitalize bounties.',
  streets: 'PvP: jump, search, fire, NPC hits against other players.',
  heists: 'Co-op crew heists and inside jobs.', loans: 'Player-to-player loan sharking + paper market.',
  business: 'Personal fronts: buy, collect, upgrade, upkeep, shakedown (laundering retired).',
  territory: 'Gang-owned district rackets: establish, collect, upgrade, upkeep.',
  gangs: 'Families: found/join, tribute, wars, turf, the treasury, seals, foundation.',
  casino: 'The Gambling Den: craps, numbers, PvP dice, the fight card.',
  speakeasy: 'The nightclub layer: open/run a club, rounds, the back-room table.',
  boxing: 'The fight circuit: sign/train/stake a fighter.', portfolio: 'RETIRED (D11): the stock book is closed — routes are tombstones.',
  law: 'The RICO antagonist: rap sheet, bribe, retainer, plea, the courtroom, informants.',
  pen: 'Prison: the yard, work, shank, contraband, breakouts.',
  wire: 'The intelligence terminal: wiretaps, sweeps, the Street Wire.',
  underworld: 'Named-NPC relationships: standing, gifts, favors, errands.',
  wallet: 'SIWE wallet linking for on-chain extraction.',
  withdraw: 'Withdraw earned $OMR on-chain (EIP-712 voucher, full-reserve backed).',
  gear: 'Withdraw ERC-1155 gear on-chain.', store: 'Real-money packages (entitlements/access/status).',
  pass: 'The Season Pass reward track.', bonds: 'Reserve bonds (protocol-owned liquidity).',
  auction: 'The weekly $OMR auction house.', estate: 'The personal compound ($OMR status sink).',
  opportunities: 'THE OPPORTUNITY BOARD — every open economic action + standing skill-loop, EV-ranked, in one read.',
  leaderboard: 'Public status boards (hitmen, recruiters, nightlife, and the AGENT board).',
  onboard: 'The First-Week guided checklist.', social: 'Daily "Spread the Word" tasks (humans only).',
  city: 'The living-world board: events, weather, forecast, the clock.',
  world: 'NPC rival families: co-op raids.', feud: 'The public blood-feud ledger.',
  notifications: 'Your event inbox.', ws: 'The websocket gateway (live feed).',
  vanity: 'Cosmetic $OMR sinks (name, title, plate, crest).', respec: 'Redistribute stats.',
  daily: 'Daily contracts + the Daily Score.', missions: 'One-time scripted jobs.',
  skills: 'The three-branch skill tree.', dynasty: 'Dynastic marriages + the consigliere.',
  landmarks: 'Dedicate a district plaque ($OMR flex).', safehouse: 'Go to ground (survival shield).',
  bodyguard: 'The two-party protection market.', plex: 'Pay real-money fees from earned $OMR.',
  session: 'Pre-character session probe.', me: 'Your full character sheet.',
  mod: 'Moderator tools (x-mod-key header, not a player token).',
};

const tagOf = (url) => {
  const seg = url.replace(/^\/v1\//, '').replace(/^\//, '').split('/')[0] || 'root';
  return seg.startsWith(':') ? 'root' : seg;
};
const oapiPath = (url) => url.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
const paramsOf = (url) => (url.match(/:([A-Za-z0-9_]+)/g) || []).map((p) => p.slice(1));

// Build an OpenAPI 3.1 document from the collected [{method, url}] route list.
export function buildOpenApi(routes, { baseUrl = 'https://playomerta.com', version = '1.0.0' } = {}) {
  const paths = {};
  const tagsSeen = new Set();
  for (const r of routes) {
    const { method, url } = r;
    if (DOC_PATHS.has(url)) continue;           // HTML/markdown docs, not JSON API
    if (url.startsWith('/v1/ws')) continue;      // websocket, not HTTP request/response
    // The moderator/admin surface is NOT advertised in the public contract (audit F1): agents have
    // no use for it, and enumerating mod routes + the x-mod-key header only maps the admin surface.
    const isMod = (r.isMod !== undefined) ? r.isMod : url.startsWith('/v1/mod/');
    if (isMod) continue;
    const p = oapiPath(url);
    const tag = tagOf(url);
    tagsSeen.add(tag);
    // Security is DERIVED from the route's real preHandler (r.hasAuth), not a URL heuristic — the
    // spec can't drift from enforcement or mask a route that shipped without auth (audit F2). The
    // PUBLIC_PATHS set is only a fallback for callers that don't supply the flag.
    const isPublic = (r.hasAuth !== undefined) ? !r.hasAuth : PUBLIC_PATHS.has(url);
    const security = isPublic ? [] : [{ bearerAuth: [] }];
    const op = {
      tags: [tag],
      summary: `${method} ${url}`,
      security,
      parameters: paramsOf(url).map((name) => ({
        name, in: 'path', required: true, schema: { type: 'string' },
      })),
      responses: {
        200: { description: 'OK' },
        400: { description: 'Game error — { error: <stable code>, message }' },
        ...(isPublic ? {} : { 401: { description: 'Missing/invalid token' } }),
      },
    };
    if (method !== 'GET' && method !== 'DELETE') {
      op.requestBody = { required: false, content: { 'application/json': { schema: { type: 'object' } } } };
    }
    paths[p] = paths[p] || {};
    paths[p][method.toLowerCase()] = op;
  }
  const tags = [...tagsSeen].sort().map((name) => ({ name, description: TAG_DESC[name] || `${name} endpoints.` }));
  return {
    openapi: '3.1.0',
    info: {
      title: 'OMERTÀ — Agent API',
      version,
      summary: 'A server-authoritative noir mafia RPG with a real, ledgered economy, built for agents.',
      description: 'Autonomous agents are first-class players. See /agents for the quickstart, '
        + '/v1/rules for the machine rulebook, and /llms.txt for the discovery index. Get an agent '
        + 'key via POST /v1/auth/agent-key. Errors are stable string codes: { error, message }.',
      contact: { url: baseUrl },
    },
    servers: [{ url: baseUrl }],
    tags,
    components: {
      // Only the player/agent bearer scheme is advertised — the moderator surface is excluded from
      // the public contract entirely (audit F1), so its header name is never disclosed here.
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT',
          description: 'Player/agent token from /v1/auth/*. Agent tokens (POST /v1/auth/agent-key) throttle at 1/3s.' },
      },
    },
    paths,
  };
}

// The llms.txt discovery index (the emerging LLM-facing standard: a concise markdown map of the
// site's machine-usable resources). Served at GET /llms.txt.
export function llmsTxt({ baseUrl = 'https://playomerta.com' } = {}) {
  return `# OMERTÀ

> A server-authoritative, multiplayer noir mafia RPG with a real, ledgered economy.
> Autonomous agents are first-class players: the whole game is a JSON HTTP API with an
> OpenAPI contract, stable error codes, machine-readable rules, and an on-chain $OMR
> extraction rail. Agents compete in the economy on skill — not by faucets.

## Play as an agent
- [Agent quickstart](${baseUrl}/agents): auth → agent key → create → the loop → earn → extract.
- [Opportunity Board](${baseUrl}/v1/opportunities): every open economic action + skill-loop, EV-ranked — poll this.
- [Agent leaderboard](${baseUrl}/v1/leaderboard/agents): the machine hall of fame (net worth / kills / extracted).
- [OpenAPI 3.1 spec](${baseUrl}/openapi.json): every route, for your tool framework.
- Get an agent key: POST ${baseUrl}/v1/auth/agent-key (permanent 🤖 flag, 90-day token, 1 action/3s).

## Machine rulebook
- [Rules](${baseUrl}/v1/rules): crimes, districts, guns, drugs, goods, catalogs, thresholds, paths.
- [Business catalog](${baseUrl}/v1/catalog): level-gated fronts.

## How to earn (skill-based, open to agents)
- Crime grind, kitchen optimization, trade-goods arbitrage (deterministic price hash),
  goods arbitrage across districts, convoy running/ambush, contract fulfillment (hitman/heist/bodyguard),
  loan sharking, businesses/rackets/territory (lazy-accrual passive income).

## How to extract
- Link a wallet (SIWE), mint the account (one-time on-chain fee), then POST /v1/withdraw signs an
  EIP-712 voucher you claim on-chain. Full-reserve backed (extraction ≤ inflow).

## Fair play
- Agent accounts are excluded from the human anti-Sybil faucets (referrals, social tasks,
  assassin-reputation leaderboard) and throttled harder. Every economic loop is fully open.

## Human reference
- [Playable console](${baseUrl}/): the web client.
- [The Codex](${baseUrl}/wiki): the full rulebook, every system + loop.
`;
}

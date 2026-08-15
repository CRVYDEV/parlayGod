// PREFLIGHT — the deploy perimeter. Every environment variable this server reads, classified, plus
// the boot checks that enforce the classification.
//
// WHY THIS EXISTS. The guards themselves are old and good — refuse to boot on the dev JWT secret, on
// the public MARKET_SEED, on a leaked test-only roll knob. What was missing is anything keeping the
// LIST honest. It was a literal in buildServer(), so every drop that added a knob had to remember to
// go update it, and several didn't: the pacing pass shipped TRAIN_CD_MS and MISSION_CD_MS — the two
// knobs that exist precisely to collapse the timers that stopped "level 240 in two hours" — and
// neither was ever added, so either one could have ridden into production and quietly reinstated the
// speedrun. Same for SOV_SIEGE_P, SOV_WINDOW_OPEN, SOLDIER_DEATH_P, BUSINESS_TAKEOVER_P,
// PEN_SHANK_CD_MS and SOCIAL_MATURE_MS.
//
// So the classification lives here as DATA, and `test/preflight.js` fails if ANY `process.env.X` in
// src/ is missing from it. A new knob can't be forgotten — it can only be classified. That's the
// `test/migrate.js` DISPOSITION guard applied to config instead of tables.
//
// The other half is the silent-failure class. SOCIAL_VERIFY_MODE defaults to 'off', which is the
// safe default for a dev box — and is exactly how Spread-the-Word paid NOBODY on a live server for
// weeks with a green test suite. A default that is safe in development and wrong in production must
// not be reachable by omission, so production has to state it.

// ── TEST-ONLY: pinned rolls and collapsed timers. Safe by default (each needs an active misconfig)
//    but a money roll becomes an always-win switch, or a §9/pacing timer collapses, server-wide.
export const TEST_ONLY_ENV = [
  // pinned probability rolls — an always-win switch on a money or death outcome
  'BUSINESS_RAID_P', 'BUSINESS_TAKEOVER_P', 'CAR_THEFT_P', 'CLUE_DROP_P', 'CLUE_RELIC_P', 'FAMILY_RAID_P', 'FAMILY_COUNTER', 'FAMILY_RETAL_P', 'GEAR_LOOT_CHANCE',
  'HEIST_P', 'LAW_BUST_P', 'PEN_BREAK_P', 'PORT_INTERDICT_P', 'PORT_PIRATE_WIN', 'PORT_SINK', 'SHANK_P', 'STAT_USE_P',
  'SOLDIER_DEATH_P', 'SOV_SIEGE_P', 'SPEAKEASY_RAID_P', 'SPEAKEASY_STANDOVER_P', 'TERRITORY_RAID_P',
  'TERRITORY_RIVAL_RAID_P', 'WANTED_HUNT_P', 'WORLD_RAID_P', 'DEEDS_SHAKE_P',
  // forced draws — a seed-drawn event pinned to a chosen outcome
  'PEN_YARD_EVENT', 'SEASON_MOD', 'SEASON_PHASE', 'BULLETIN_THEME', 'SOV_WINDOW_OPEN', 'WORLD_UPRISING', 'WORLD_UPRISING_FORCE',
  // PRIME TIME — the nightly synchronous window: force the window live / the mechanic / the mode for tests
  'PRIME_TIME_LIVE', 'PRIME_TIME_MECH', 'PRIME_TIME_MODE',
  // collapsed timers — cooldowns and windows that exist to PACE the game
  'BRACKET_ROUND_MS', 'CALLOUT_MS', 'CONVOY_MS', 'DUEL_CD_MS', 'FUTURITY_MS', 'GRAND_PRIX_MS',
  'MAIN_EVENT_MS', 'MISSION_CD_MS', 'NPC_AGGRO_MS', 'NPC_WAR_MS', 'PASS_CLAIM_MS', 'PEN_SHANK_CD_MS', 'PORT_RUN_MS', 'RACE_CD_MS',
  'RING_TURN_MS', 'SEARCH_MS', 'SHOOT_CD_MS', 'SOCIAL_MATURE_MS', 'STAKES_MS', 'TOURNEY_MS',
  'TRAIN_CD_MS',
  // QA escape hatches — these let a mod route fabricate value or bypass an auth check
  'ALLOW_MOD_REAL_REVENUE', 'X_TRUST_USER_TOKEN',
  // TOKENOMICS v2 — opens the redemption window while cash can still BUY $OMR, which is a money
  // pump (buy under RATE, redeem at RATE). The interlock exists precisely to stop that reaching
  // production, so the override must never boot there. Production opens the window via
  // EXCHANGE.OPEN, in the same change that retires the buy side.
  'EXCHANGE_OPEN',
];

// ── REQUIRED in production. Each one fails CLOSED today (the server refuses to boot, or the feature
//    is inert) — listing them here is what makes the failure legible instead of mysterious.
export const REQUIRED_ENV = {
  JWT_SECRET: 'signs player tokens — the dev fallback is public, so anyone could forge a session',
  MARKET_SEED: 'the §7.11 secret behind every seeded draw (Numbers 600:1, the Track, the Fight, goods prices)',
  MOD_KEY: 'the only credential on the mod perimeter; unset means every mod route 401s and the admin dashboard is unusable',
};

// ── MUST BE STATED in production. These have a default that is correct for a dev box and WRONG for a
//    live one, so production must choose explicitly rather than inherit it. (Setting the value the
//    default would have given is fine — the point is that a human decided.)
export const EXPLICIT_ENV = {
  SOCIAL_VERIFY_MODE: {
    values: ['off', 'trust', 'live'],
    why: "defaults to 'off', where Spread-the-Word registers posts and pays nobody. Production wants 'live' (real X verification); 'off' is a legitimate choice, but it has to be a choice",
  },
};

// ── Everything else, classified so nothing can be added without a decision. `test/preflight.js`
//    fails on any src/ env var missing from this file entirely.
export const OPERATIONAL_ENV = [
  // infrastructure
  'DATABASE_URL', 'NODE_ENV', 'PORT', 'PG_POOL_MAX', 'REDIS_URL', 'TRUST_PROXY', 'PUBLIC_URL',
  // Postgres safety valves (db.js). Operational, not gameplay: they bound how long anything may hold
  // a connection or wait on a row so one stuck query cannot freeze a player. Sane defaults ship; these
  // exist to tune them per host, never to disable them.
  'PG_STATEMENT_TIMEOUT_MS', 'PG_LOCK_TIMEOUT_MS', 'PG_IDLE_TX_TIMEOUT_MS',
  'PG_CONNECT_TIMEOUT_MS', 'PG_IDLE_TIMEOUT_MS',
  'WS_PING_MS', 'INVARIANT_WEBHOOK_URL', 'CITY_WIRE_WEBHOOK_URL',
  // access posture
  'INVITE_MODE', 'RATE_LIMIT', 'RATE_AUTH_BURST', 'RATE_AUTH_PER_SEC', 'RATE_HUMAN_BURST',
  'RATE_HUMAN_PER_SEC', 'RATE_PUBLIC_BURST', 'RATE_PUBLIC_PER_SEC', 'RATE_READ_BURST',
  'RATE_READ_PER_SEC', 'WS_ALLOW_QUERY_TOKEN',
  // identity providers (dormant until configured)
  'PRIVY_APP_ID', 'X_BEARER_TOKEN', 'X_CLIENT_ID', 'X_CLIENT_SECRET', 'X_TARGET_USER_ID',
  // web push (dormant until VAPID keys are set; the client hides the 🔔 button when absent).
  // PUSH_SKIP_ACTIVE_MIN: minutes of telemetry inactivity before an account is "away" and pushable
  // (default 3; 0 disables the skip so even a live tab is buzzed — test-only).
  'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'PUSH_SKIP_ACTIVE_MIN',
  // THE DISPATCH — the opt-in email digest (dormant until EMAIL_API_KEY is set). EMAIL_FROM / EMAIL_API_URL
  // (default Resend); DIGEST_* tune the lapse/cooldown windows. All dormant/defaulted until configured.
  'EMAIL_API_KEY', 'EMAIL_FROM', 'EMAIL_API_URL', 'DIGEST_LAPSE_DAYS', 'DIGEST_COOLDOWN_DAYS', 'DIGEST_MAX_LAPSE_DAYS',
  // marketing / share surfaces
  'SOCIAL_GAME_URL', 'SOCIAL_X_HANDLE', 'WALLETCONNECT_PROJECT_ID', 'X_CHECK_CD_MS', 'X_FOLLOW_PAGES',
  // the chain layer — every one dormant unless set (mainnet is launch + audit gated regardless)
  'CHAIN_CONFIRMATIONS', 'CHAIN_ID', 'CHAIN_POLL_MS', 'CHAIN_RPC_URL', 'CHAIN_START_BLOCK',
  'DAILY_CAP_OMR', 'OMERTA_BOND_ADDRESS', 'OMERTA_FEES_ADDRESS',
  // GearVault (Redeemed events) — the NFT re-import watcher (Option A). Dormant unless set on the worker.
  'GEARVAULT_ADDRESS',
  // StreetDeed (Extracted/Redeemed events) — the on-chain tradeable deed NFT. Dormant unless set.
  'STREET_DEED_ADDRESS',
  // THE STOCK DELIVERY RAIL (brokers §3.4) — deliver treasury-bought stock into the player's on-chain
  // Street Deed's ERC-6551 TBA. Dormant unless STOCK_VAULT_ADDRESS is set (the Delivered watcher) +
  // the ERC-6551 config (the canonical registry is the default; the account impl + salt are deploy
  // config; the TBA resolver reads all three). None of it moves value; all launch + audit gated.
  'STOCK_VAULT_ADDRESS', 'ERC6551_REGISTRY', 'ERC6551_ACCOUNT_IMPL', 'ERC6551_SALT',
  // THE DELIVERY KEEPER — the tx sender that drives StockVault.deliver. STOCK_KEEPER_PK is a SECRET
  // (the vault's Safe-set keeper key; leaked-key blast radius bounded by the vault's own walls);
  // STOCK_TOKEN_ADDRESSES is a JSON ticker→ERC-20 map; decimals default 18. Dormant unless all of
  // CHAIN_RPC_URL + STOCK_VAULT_ADDRESS + STOCK_KEEPER_PK are set on the worker.
  'STOCK_KEEPER_PK', 'STOCK_TOKEN_ADDRESSES', 'STOCK_TOKEN_DECIMALS',
  // THE TWO DEX BOTS (src/dexbot.js) — the buyback bot (swaps unspent Vig revenue for hard OMR on
  // the canonical v4 pool, books the ACHIEVED price through the audited runVigBuyback) + the
  // POL-pairing bot (pairs bond-delivered POL ETH into the pool, root-capped at bond_reserve.pol_eth).
  // DEX_BOT_PK is a SECRET (the hot bot key — it holds the POL ETH the bond forwards + the swap
  // budget; a leak is bounded by the module's own caps + the Safe owning the LP position via
  // POL_POSITION_OWNER). The router/position-manager/pool params are deploy addresses; the dials
  // (max per-run ETH, slippage floor, TWAP max age, cadence) default sanely and are ops knobs.
  // Both bots dormant unless the full env is set on the WORKER.
  // OMR_ADDRESS + OMERTA_HOOK_ADDRESS were previously only chainparams DATA strings; the bots read
  // them directly (the pool key), so they classify here — deploy addresses, dormant until set.
  'OMR_ADDRESS', 'OMERTA_HOOK_ADDRESS',
  'DEX_BOT_PK', 'UNIVERSAL_ROUTER_ADDRESS', 'POSITION_MANAGER_ADDRESS', 'STATE_VIEW_ADDRESS',
  'POL_POSITION_OWNER', 'DEX_POOL_FEE', 'DEX_POOL_TICK_SPACING',
  'DEX_BUYBACK_MAX_ETH', 'POL_PAIR_MAX_ETH', 'DEX_MAX_SLIPPAGE_BPS', 'DEX_TWAP_MAX_AGE_S', 'DEX_BOT_EVERY_MS',
  // DynastyNFT (Minted/Transfer events) — the identity token registry + the portrait FREEZE at first
  // transfer. Dormant unless set on the worker.
  'DYNASTY_NFT_ADDRESS',
  // THE BANK's Alchemist — the harvest-fee stream. Dormant unless set; the asset symbol + decimals
  // are config because the market's underlying is not always 18-decimal (USDC is 6).
  'ALCHEMIST_ADDRESS', 'ALCHEMIST_ASSET', 'ALCHEMIST_ASSET_DECIMALS',
  'VOUCHER_CLAIM_ADDRESS', 'VOUCHER_RECLAIM_GRACE_SEC', 'VOUCHER_SIGNER_PK',
  // economy levers — founder sign-off dials, deliberately operator-settable (BALANCE.md)
  'BOND_DEV_BPS', 'BOND_DISCOUNT_BPS', 'BOND_ETH_SCORE_OMR', 'BOND_LP_SCORE_PER_ETH_DAY', 'BOND_PLEDGE_MIN', 'BOND_POL_BPS',
  'BOND_QUOTE_TTL_SEC', 'BOND_RWA_BPS', 'BOND_VEST_HOURS', 'BOND_VIG_BPS', 'EARLY_SELL_TAX_BPS',
  'FEE_RWA_BPS', 'FRESH_WINDOW_MS', 'MINT_FEE_ETH',
  // the PLEX rail — the respawn + the Store SKUs, priced in earned $OMR. NOT the mint: that is ETH
  // only, so there is deliberately no $OMR knob for it here to forget (a rail behind an env var is one
  // env var from live). The genesis rate is the pre-market anchor; the two STORE_* derive from it.
  'PLEX_GENESIS_OMR_PER_ETH', 'PLEX_PREMIUM_BPS', 'PLEX_RESPAWN_OMR',
  'STORE_PLEX_FLOOR', 'STORE_PLEX_PREMIUM_BPS',
  'RESPAWN_FEE_ETH', 'REVENUE_BUYBACK_BPS', 'REVENUE_FOUNDER_BPS',
  'REVENUE_RWA_BPS', 'SEASON_MODS', 'SELL_TAX_BPS', 'SELL_TAX_DEV_BPS',
  'SELL_TAX_LP_BPS', 'SELL_TAX_RWA_BPS',
  'VIG_BPS', 'VIG_MAX_PRICE_JUMP', 'VIG_RESERVE_BPS',
  'WITHDRAW_TAX_BPS',
  // the community earmark + family buyback (omerta-treasury-to-family-design.md — Phase 1 ships
  // every slice at 0; the Phase-2 flip sets the locked targets, BALANCE.md § THE FAMILY BUYBACK)
  'FEE_COMMUNITY_BPS', 'STORE_COMMUNITY_BPS', 'SELL_TAX_COMMUNITY_BPS',
  'HARVEST_COMMUNITY_BPS', 'POL_FEES_VIG_BPS', 'FAMILY_MAX_PRICE_JUMP', 'BANK_MAX_PRICE_JUMP',
  'TAX_MAX_PRICE_JUMP', 'STOCK_MAX_PRICE_JUMP',
  // content toggles
  'POPULATION_OFF',
];

/**
 * BLUE-TEAM M1: the security-critical preflight subset for a NON-API process (the worker). The worker
 * never ran preflight, yet it CONSUMES test-only roll/timer knobs at call time — WANTED_HUNT_P drives
 * the NPC-hunter kill sweep, LAW_BUST_P the RICO force-bust, every *_MS a sweep window. A knob set
 * only on the worker's env (not the shared group, where the API would refuse and make it visible)
 * would reach production unseen. The API-only checks (JWT/SOCIAL_VERIFY_MODE the worker doesn't need)
 * don't apply, so this is the subset that does: the TEST_ONLY leak. Returns the offending keys.
 */
export function testOnlyLeaks(env = process.env) {
  return isHardened(env) ? TEST_ONLY_ENV.filter((k) => env[k] != null) : [];
}

/** Every variable this file knows about — the set `test/preflight.js` checks src/ against. */
export const CLASSIFIED = new Set([
  ...TEST_ONLY_ENV, ...Object.keys(REQUIRED_ENV), ...Object.keys(EXPLICIT_ENV), ...OPERATIONAL_ENV,
]);

/**
 * Is this a real deployment? A real DATABASE_URL is the unforgeable "there is persistent value at
 * stake" signal — `npm start` never sets NODE_ENV, so hinging solely on it meant a deploy that
 * forgot the one variable most likely to be forgotten silently reverted every guard at once.
 */
export const isHardened = (env = process.env) =>
  env.NODE_ENV === 'production' || !!env.DATABASE_URL;

/**
 * Run the deploy checks. Returns `{ errors, warnings }` — the caller decides what to do with them
 * (buildServer throws on errors). Pure over `env`, so the test can drive it without touching the
 * real process.
 */
export function preflight(env = process.env) {
  const errors = [], warnings = [];
  if (!isHardened(env)) return { errors, warnings };  // dev/CI keeps the convenient fallbacks

  for (const [key, why] of Object.entries(REQUIRED_ENV))
    if (!env[key]) errors.push(`${key} must be set for a real deployment — ${why}.`);

  // the dev JWT fallback and the public seed are worse than absent: they LOOK configured
  if (env.JWT_SECRET === 'dev-secret-change-me')
    errors.push('JWT_SECRET is still the public dev fallback — anyone could forge a token for any account.');
  // BLUE-TEAM H1: a weak-but-non-default JWT_SECRET boots clean today — the ONE secret without an
  // entropy floor, while MARKET_SEED below gets one. HS256 over a low-entropy secret is
  // brute-forceable OFFLINE; once recovered, an attacker forges a token for ANY account (incl.
  // minted accounts that withdraw $OMR on-chain) — the exact "forge a token for any account"
  // outcome the dev-fallback names, reached through a weak secret. Mirror the MARKET_SEED rule.
  // (Render's generateValue produces a strong value, so a real deploy passes.)
  if (env.JWT_SECRET && env.JWT_SECRET !== 'dev-secret-change-me') {
    const s = String(env.JWT_SECRET);
    if (s.length < 24 || new Set(s).size < 8)
      errors.push('JWT_SECRET is too weak — HS256 over a low-entropy secret is offline-brute-forceable, after which anyone can forge a token for any account. Use a long, high-entropy random secret (≥24 chars, ≥8 distinct).');
  }
  if (env.MARKET_SEED === 'omerta-server-seed')
    errors.push('MARKET_SEED is the public default, which makes every seeded draw (Numbers/Track/Fight/goods) predictable.');
  if (env.MARKET_SEED) {
    // the seeded draws are FNV-1a mod 1000 and the prices board publishes many known-prefix pairs, so
    // a short/low-entropy seed is recoverable offline — after which every money draw is computable
    const seed = String(env.MARKET_SEED);
    if (seed.length < 24 || new Set(seed).size < 8)
      errors.push('MARKET_SEED is too weak — use a long, high-entropy random secret (≥24 chars, ≥8 distinct). A short seed is offline-recoverable from the public prices board.');
  }

  const leaked = TEST_ONLY_ENV.filter((k) => env[k] != null);
  if (leaked.length)
    errors.push(`Test-only roll/timer overrides must not be set in production (they pin money rolls to always-win and collapse the pacing timers): ${leaked.join(', ')}`);

  for (const [key, spec] of Object.entries(EXPLICIT_ENV)) {
    if (env[key] == null)
      errors.push(`${key} must be set explicitly in production — ${spec.why}. Valid: ${spec.values.join(' | ')}.`);
    else if (!spec.values.includes(env[key]))
      errors.push(`${key}="${env[key]}" is not valid. Valid: ${spec.values.join(' | ')}.`);
  }

  // warnings: not wrong, but the operator probably didn't mean it
  if (env.SOCIAL_VERIFY_MODE === 'trust')
    warnings.push("SOCIAL_VERIFY_MODE=trust pays the Spread-the-Word faucet without verifying anything — fine for a closed alpha, not for an open server.");
  // …and the mirror case, which is what actually shipped: `live` is the correct production setting,
  // but it needs a provider token to be able to VERIFY anything. Without one, every claim threw and
  // the whole word-of-mouth loop paid nobody, silently — no boot error, nothing in the game.
  //
  // A WARNING, deliberately, not an error. preflight errors are fatal (`Refusing to boot`), so making
  // this an error would take a running production server DOWN on its next deploy to fix a dormant
  // faucet — strictly worse than the faucet being dormant. The game now degrades honestly instead
  // (an unconfigured provider's tasks are not offered), and /admin carries the live state, which is
  // the answer to "a warning nobody reads".
  if (env.SOCIAL_VERIFY_MODE === 'live') {
    if (!env.X_BEARER_TOKEN)
      warnings.push('SOCIAL_VERIFY_MODE=live but X_BEARER_TOKEN is not set — the Spread-the-Word cash faucet '
        + 'reports itself OFF and pays nobody, and "Follow on X" is dropped from the First-Week checklist. '
        + 'Set X_BEARER_TOKEN (and X_TARGET_USER_ID for the follow check) to turn the growth loop on.');
    else if (!env.X_TARGET_USER_ID)
      warnings.push('SOCIAL_VERIFY_MODE=live with X_BEARER_TOKEN but no X_TARGET_USER_ID — post checks work, '
        + 'but "Follow on X" cannot be verified, so it is dropped from the First-Week checklist.');
  }
  // WHERE DO SHARE LINKS POINT? With neither var set, every referral link, brag prompt and social
  // card is built from a hardcoded default domain that is almost certainly not yours — which is
  // exactly what a live server did, mailing every recruit to a domain that did not resolve while
  // looking perfectly healthy from the inside. Nothing in-process can detect it: the URL is
  // well-formed and only DNS disagrees. So say it at boot, where someone is already reading.
  if (!env.SOCIAL_GAME_URL && !env.PUBLIC_URL)
    warnings.push('Neither PUBLIC_URL nor SOCIAL_GAME_URL is set — every referral link, share prompt '
      + 'and social card will point at the built-in default domain, not yours. Set PUBLIC_URL to this '
      + "server's own origin (it is also what one-click X sign-in derives its callback from).");
  if (env.WS_ALLOW_QUERY_TOKEN === 'on')
    warnings.push('WS_ALLOW_QUERY_TOKEN=on puts player tokens in URLs, where proxies and access logs keep them.');
  // BLUE-TEAM H5: the money-drift alarm channel. Every proactive alarm (nightly §10.4 drift,
  // backup-failure, oracle-keeper, desk-dark, and the vig/bond/treasury/desk real-value invariants)
  // fires from the WORKER and posts here; unset, it reaches only a log line nobody reads — the
  // "the guard worked; nobody looked" failure. A WARNING (not fatal) so it can't take a live server
  // down, matching the SOCIAL_VERIFY_MODE reasoning; /admin also surfaces the live state.
  if (!env.INVARIANT_WEBHOOK_URL)
    warnings.push('INVARIANT_WEBHOOK_URL is not set — the §10.4 economy-drift, backup-failure, oracle-halt '
      + 'and real-value-invariant alarms have nowhere to shout and reach only a log line. Set it (a Slack/'
      + 'Discord webhook) — it must be on the WORKER process, which is where the alarms fire.');
  // BLUE-TEAM M8: the public city-drama feed and the private ops alarm must be DISTINCT channels. If
  // they collide, throttled marketing drama (up to 20 posts/10 min) buries a §10.4 drift line — the
  // exact "alarm nobody reads" failure this system exists to prevent. Fires only on the real
  // misconfiguration (both set AND equal), so it can never trip a legitimate deploy.
  if (env.CITY_WIRE_WEBHOOK_URL && env.CITY_WIRE_WEBHOOK_URL === env.INVARIANT_WEBHOOK_URL)
    errors.push('CITY_WIRE_WEBHOOK_URL and INVARIANT_WEBHOOK_URL point at the SAME channel — public city '
      + 'drama would bury the private §10.4/backup/oracle alarms. Use two distinct webhooks.');
  if (!env.TRUST_PROXY && env.RATE_LIMIT !== 'off')
    warnings.push('TRUST_PROXY is off: behind a load balancer every request looks like one IP, so the per-IP auth throttle collapses to a single shared bucket.');
  if (!env.MOD_KEY || (env.MOD_KEY || '').length < 24)
    warnings.push('MOD_KEY is short — it is the only credential on the mod perimeter (ban, mod-kill, confiscate, comp grants). Use a long random secret.');

  // THE TRANCHE SCHEDULE (Shape D, adopted 2026-08-10; five waves capped at 0.05 ETH): the mint fee
  // has to sit ON a published wave. A price off the table is one the published commitment never
  // promised, which is exactly the drift a published commitment exists to prevent.
  //
  // THE TWO-RAILS CHECK BELOW COVERS THE RESPAWN AND NOT THE MINT, and that asymmetry is the whole
  // rule rather than an oversight. A fee payable two ways — real ETH, or the same fee in EARNED $OMR
  // through PLEX — is always priced by the CHEAPER rail, so two rails have to agree or the cheap one
  // simply IS the price. Minting is the SYBIL BOUND (it gates extraction), so it has one rail and
  // nothing here to compare: the surest way to keep two rails in lockstep is to have one, and
  // `payPlex` refuses a mint. The respawn is a repeatable CONSUMABLE, not the bound, so "pay your
  // rent in ISK" applies to it cleanly — but its $OMR price is env-settable, so it can still drift.
  // `plexQuote` prices the $OMR side at `max(static_floor, feeEth × oracle × premium)`, and
  // PRE-MARKET there is no oracle row, so it returns the static floor and ignores the ETH fee
  // completely — raise RESPAWN_FEE_ETH without raising PLEX_RESPAWN_OMR and they diverge in silence.
  // Checked as a RATIO so it holds at any fee level.
  {
    // Restated from vig.js (which imports game.js, so preflight cannot import it — the one-way rule).
    // test/preflight.js feeds this guard vig.js's ACTUAL default and requires silence, so the
    // restatement cannot rot. The PREMIUM is read rather than baked in: it is the deliberate wedge
    // between the two rails, so a guard that hardcodes it fires spuriously the moment the lever moves
    // — and the fix somebody reaches for then is widening the tolerance, which kills the guard.
    const PREMIUM = Number(env.PLEX_PREMIUM_BPS ?? 10000) / 10000;
    const GENESIS_RATE = Number(env.PLEX_GENESIS_OMR_PER_ETH ?? 205882) * PREMIUM;
    const eth = Number(env.RESPAWN_FEE_ETH ?? 0.10);
    const omr = Number(env.PLEX_RESPAWN_OMR ?? Math.round(0.10 * GENESIS_RATE));
    const implied = eth > 0 ? omr / eth : null;
    if (implied && Math.abs(implied - GENESIS_RATE) / GENESIS_RATE > 0.05)
      warnings.push('The respawn\'s PLEX and ETH rails disagree on what value is worth: it implies '
        + `${Math.round(implied)} $OMR/ETH against the genesis rate's ${Math.round(GENESIS_RATE)}. `
        + 'Pre-market the $OMR price is the STATIC floor and ignores the ETH fee entirely, so whichever '
        + 'rail is cheap is the one people will use. Move PLEX_RESPAWN_OMR with RESPAWN_FEE_ETH.');
  }
  //
  // The waves are RESTATED here because preflight cannot import rules.js (the one-way rule);
  // test/preflight.js pins them to MINT_TRANCHES so the restatement cannot rot. A WARNING, not an
  // error, for the reason recorded above SOCIAL_VERIFY_MODE: taking a live server down over a
  // mispriced fee is strictly worse than the mispricing. The admin chain panel shows the same
  // expected-vs-live comparison against the CURRENT wave for whoever is actually looking.
  {
    const WAVES = [0.01, 0.025, 0.035, 0.045, 0.05];
    const fee = Number(env.MINT_FEE_ETH ?? 0.01);
    if (!WAVES.some((w) => Math.abs(fee - w) < 1e-9))
      warnings.push(`The live mint fee (${fee} ETH) is OFF the published tranche schedule `
        + `(${WAVES.join(' / ')} ETH). The schedule is a published commitment — set the fee to a `
        + 'MINT_TRANCHES wave, or publish a new table.');
  }

  // THE SELL TAX IS WHAT MAKES A BOND A HOLD RATHER THAN AN ARBITRAGE, and nothing else in the
  // system relates those two numbers — the discount is signed into a bond quote, the tax is charged
  // by a different contract at a different moment. At the shipped values a bond flipped straight back
  // through the pool returns 1.08 x 0.91 = 0.983, so it LOSES ~1.7% before five days of vest exposes
  // it to price risk. Let the discount reach the tax and that inverts: bonding stops being capital
  // formation and becomes a subsidy on selling, paid to the one counterparty who holds known size on
  // a known schedule and is therefore the most motivated bypass-seeker OMR will have.
  //
  // A WARNING for the same reason as the rail check above — this is an economic own-goal, not an
  // unsafe state, and a live server should not fall over because someone lowered the tax. The Foundry
  // suite asserts the same rule from the contract side (`test/OmertaHook.t.sol`), where the two
  // constants genuinely live in different places.
  {
    const disc = Number(env.BOND_DISCOUNT_BPS ?? 800); // rules.tail.js BONDS.DISCOUNT_BPS
    const tax = Number(env.SELL_TAX_BPS ?? 900); // rules.tail.js SELL_TAX.BPS
    if (disc >= tax)
      warnings.push(`BOND_DISCOUNT_BPS (${disc}) is not below SELL_TAX_BPS (${tax}) — a bond flipped `
        + 'straight back through the pool now makes money, so bonding is a subsidy on selling rather '
        + 'than capital formation. Keep the discount strictly under the sell tax.');
  }

  // RETIRED RAILS — a var that no longer means anything is worse than an unknown one, because it
  // LOOKS configured. The classification guard only sees vars src/ still reads, so a retired rail
  // leaves its config behind silently; this says so. A warning, not an error: an operator with a
  // stale value has a stale value, not a broken server.
  for (const [k, why] of Object.entries(RETIRED_ENV)) if (env[k]) warnings.push(`${k} is set but ${why}`);

  return { errors, warnings };
}

// Vars that USED to do something. Keep the entry when a rail retires — deleting it turns "this does
// nothing now" into "we have never heard of this", which is the same silence in a different costume.
export const RETIRED_ENV = {
  TRADE_FEE_HOOK_ADDRESS: 'the swap trade fee is retired (2026-08-11) — a PoolKey holds one hook, and '
    + "the canonical pool's is the four-slice sell tax. Nothing reads this; unset it.",
  TRADE_FEE_BPS: 'the swap trade fee is retired (2026-08-11). Nothing reads this; unset it.',
  TRADE_VIG_BPS: 'the swap trade fee is retired (2026-08-11). Nothing reads this; unset it.',
};

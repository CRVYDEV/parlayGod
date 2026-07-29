// The status boards — every survives-death legend ranked
// Extracted verbatim from server.js — handler bodies are unchanged. The registrar takes the shared
// closure it used to read directly (pool, auth), so nothing about what is mounted or how it is
// authenticated moves with it; test/routes.js asserts the mounted surface is identical either way.
import * as Bloodline from '../bloodline.js';
import * as Bonds from '../bonds.js';
import * as Boxing from '../boxing.js';
import * as Business from '../business.js';
import * as Clues from '../clues.js';
import * as Collection from '../collection.js';
import * as Commission from '../commission.js';
import * as Convoy from '../convoy.js';
import * as Duels from '../duels.js';
import * as E from '../economy.js';
import * as Estate from '../estate.js';
import * as G from '../game.js';
import * as Heists from '../heists.js';
import * as Honor from '../honor.js';
import * as K from '../kitchen.js';
import * as Mega from '../megaproject.js';
import * as Mastery from '../mastery.js';
import * as Port from '../port.js';
import * as Portfolio from '../portfolio.js';
import * as Races from '../races.js';
import * as S from '../social.js';
import * as Soldiers from '../soldiers.js';
import * as Sov from '../sov.js';
import * as Speakeasy from '../speakeasy.js';
import * as Stable from '../stable.js';
import * as Standing from '../standing.js';
import * as Store from '../store.js';
import * as Territory from '../territory.js';
import * as V from '../vanity.js';
import * as W from '../growth.js';
import * as Wire from '../wire.js';
import * as World from '../world.js';

export function register(app, { pool, auth, modAuth }) {
    app.get('/v1/leaderboard/tycoons', { preHandler: auth }, async () => E.tycoonLeaderboard(pool));
    app.get('/v1/leaderboard/territory', { preHandler: auth }, async () => Territory.territoryLeaderboard(pool)); // THE EMPIRE board
    app.get('/v1/leaderboard/launderers', { preHandler: auth }, async () => ({ launderers: await Business.laundererLeaderboard(pool) }));
    app.get('/v1/leaderboard/nightlife', { preHandler: auth }, async (req) => {
      const cid = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0]?.id;
      return Speakeasy.nightlifeLeaderboard(pool, cid || '');
    });
    app.get('/v1/leaderboard/boxing', { preHandler: auth }, async (req) => {
      const cid = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0]?.id;
      return Boxing.boxingLeaderboard(pool, cid || '');
    });
    app.get('/v1/leaderboard/stable', { preHandler: auth }, async () => Stable.stableLeaderboard(pool));
    app.get('/v1/leaderboard/races', { preHandler: auth }, async () => Races.raceLeaderboard(pool));
    app.get('/v1/leaderboard/port', { preHandler: auth }, async () => Port.portLeaderboard(pool)); // THE SMUGGLER'S LEGEND board
    app.get('/v1/leaderboard/statesmen', { preHandler: auth }, async () => Commission.statesmenLeaderboard(pool)); // the survives-death political legend
    app.get('/v1/leaderboard/family-portfolio', { preHandler: auth }, async () => Portfolio.familyPortfolioLeaderboard(pool));
    app.get('/v1/leaderboard/portfolio', { preHandler: auth }, async () => Portfolio.portfolioLeaderboard(pool));
    app.get('/v1/leaderboard/foundation', { preHandler: auth }, async () => V.foundationLeaderboard(pool));
    app.get('/v1/leaderboard/estates', { preHandler: auth }, async () => Estate.estateLeaderboard(pool));
    app.get('/v1/leaderboard/collectors', { preHandler: auth }, async () => Estate.collectorLeaderboard(pool)); // the survives-death Collector legend + the Patron
    app.get('/v1/leaderboard/wire', { preHandler: auth }, async () => Wire.wireLeaderboard(pool));
    // Wire step three: DISINFORMATION (feed your tappers lies) + THE INFORMANT (a standing human source)
    app.get('/v1/leaderboard/convoy', { preHandler: auth }, async () => Convoy.convoyLeaderboard(pool));
    app.get('/v1/leaderboard/heists', { preHandler: auth }, async () => Heists.heistLeaderboard(pool));
    // The feared-assassin leaderboard (M7 Phase 2): lifetime legend + this season's kill streak.
    app.get('/v1/leaderboard/hitmen', { preHandler: auth }, async () => S.hitmanLeaderboard(pool));
    // THE CITY STANDING — the unifying "who's winning" spine over the 35 status axes. One aggregate metric
    // (six pillars, log-share of the population) so the endgame finally has a single answer. Status only, §10.4-free.
    app.get('/v1/leaderboard/city', { preHandler: auth }, async (req) => ({
      board: await Standing.cityStanding(pool), you: await Standing.myStanding(pool, req.user.sub) }));
    // The RECRUITERS (§7.13): the organic-growth hall of fame + the family recruitment board. Status only.
    app.get('/v1/leaderboard/recruiters', { preHandler: auth }, async () => ({
      recruiters: await W.recruiterLeaderboard(pool), families: await W.recruitingFamilyLeaderboard(pool),
      push: await G.referralPushStatus(pool) })); // the active recruitment DRIVE (2×… payouts), publicly visible
    // THE AGENT LEADERBOARD: a SEPARATE machine hall of fame (net worth / kills / $OMR extracted). See AGENTS.md.
    app.get('/v1/leaderboard/agents', { preHandler: auth }, async () => ({ agents: await W.agentLeaderboard(pool) }));
    // THE OPPORTUNITY BOARD (the agent-liquidity feature): every open economic action + standing
    // skill-loop with EV/risk signals, in ONE read. Read-only; the caller's character scopes filters.
    app.get('/v1/leaderboard/feuds', { preHandler: auth }, async () => S.feudLeaderboard(pool));
    // M7 Phase 3: hire an NPC contractor for a rolled hit on a target (a ledgered cash sink).
    app.get('/v1/leaderboard/kingpins', { preHandler: auth }, async () => K.kingpinLeaderboard(pool));
    app.get('/v1/leaderboard/trades', { preHandler: auth }, async () => Mastery.tradesLeaderboard(pool)); // THE TRADES lifetime legend
    app.get('/v1/leaderboard/sov', { preHandler: auth }, async () => Sov.sovLeaderboard(pool));
    app.get('/v1/leaderboard/bloodline', { preHandler: auth }, async () => Bloodline.bloodlineLeaderboard(pool));
    // FIVE PILLARS → Tier 4 — THE REPUTATION BOARDS (the honor legend: Men of Honor + the Most Feared)
    app.get('/v1/leaderboard/honor', { preHandler: auth }, async () => Honor.honorLeaderboard(pool));
    // DYNASTIC MARRIAGES & THE CONSIGLIERE (CK3 — account-level ties on the Bloodline)
    app.get('/v1/leaderboard/commanders', { preHandler: auth }, async () => Soldiers.commanderLeaderboard(pool));
    app.get('/v1/leaderboard/collection', { preHandler: auth }, async () => Collection.collectionLeaderboard(pool));
    app.get('/v1/leaderboard/underwriters', { preHandler: auth }, async () => Bonds.underwriterLeaderboard(pool));
    // the EIP-712 bond QUOTE SIGNER — a player requests a signed BondQuote (bound to their linked wallet),
    // then submits bond(quote, signature) to the on-chain OmertaBond contract; the Bonded watcher books it.
    // Chain-dormant: 400s chain_unconfigured unless the bond chain (CHAIN_ID + OMERTA_BOND_ADDRESS + signer) is set.
    // THE PATRON PROGRAM (Tier-4) — the read-derived Benefactors league + Patron Families + The House's Favor
    app.get('/v1/leaderboard/patrons', { preHandler: auth }, async () => Store.benefactorLeaderboard(pool));
    // PLEX-for-packages — buy a Store SKU with EARNED $OMR (burns $OMR for the same entitlement)
    app.get('/v1/leaderboard/builders', { preHandler: auth }, async () => Mega.builderLeaderboard(pool));
    app.get('/v1/leaderboard/family-build', { preHandler: auth }, async () => Mega.familyBuildLeaderboard(pool));
    app.get('/v1/leaderboard/duels', { preHandler: auth }, async () => Duels.duelLeaderboard(pool));
    app.get('/v1/leaderboard/clues', { preHandler: auth }, async () => Clues.clueLeaderboard(pool));
    // NPC RIVAL FAMILIES — the server-wide common enemy. GET is the board (odds tonight); raid is co-op.
    app.get('/v1/leaderboard/world', { preHandler: auth }, async () => World.worldLeaderboard(pool)); // THE WAR EFFORT board
    // step three — CO-OP CREW RAIDS on the apex outfits + THE FRONTIER (family conquest leaderboard)
    app.get('/v1/leaderboard/frontier', { preHandler: auth }, async () => World.frontierLeaderboard(pool)); // THE FRONTIER board
    // step four — THE FRONTIER MADE REAL: collect a held outpost's tribute + invade a rival-held outpost
}

// ── src/portfolio.js — THE PORTFOLIO, RETIRED (D11, founder-directed 2026-08-05) ──
// "Remove all tickers and RWA assets." The in-game stock book — tickers, personal + family invests,
// the Dynasty Fund dividends, the dynasty naming sinks, the legit-book leaderboards — is gone. The
// reasons, in order of weight:
//
//   1. The real rail behind it was already retired (omerta-stock-layer-retirement.md, 2026-07-31):
//      nothing buys stock, nothing owes stock, the treasury holds ETH. What remained here was a
//      fictional collectible wearing REAL ticker symbols (AAPL, TSLA, GLD…) with a made-up price —
//      defensible while a real rail existed behind it, a standing question once it didn't. The
//      founder answered the question by removing the surface.
//   2. Economy v3's walls made its money flows anachronisms: the personal dividend was retired in
//      v2 step 2, the invest was a burn feeding a family-yield slice — a sink the desk now serves
//      better, without implying anybody owns a security.
//
// WHAT STAYS: THE ETH VAULT (`src/treasury.js`) — it is neither a ticker nor an RWA asset; the
// stock-layer retirement already re-denominated it to ETH on both sides of `allocated <= held`.
// It shares this system's old RICO-graduation window (`PORTFOLIO.SCRUTINY_*`, `ch.rwa_used/rwa_at`)
// and the `rwa:` reason prefix (`rwa:vault` is LIVE) — which is why the slimmed PORTFOLIO block and
// the `rwa:` vocabulary entry survive the cull.
//
// §10.4 — READ THIS BEFORE "CLEANING UP" THE REASONS: `rwa:` and `dividend:` stay in the omr
// vocabulary; `rwa:invest`/`rwa:dynasty` stay burns; `dividend:fund`/`dividend:omr` stay transfers;
// `rwa_dividend_pool` + `rwa_family_dividend_pool` stay in `omrBuckets`. A live database holds the
// rows this system already wrote, and conservation is a claim about the WHOLE ledger — drop any of
// them and every server that ever ran the Portfolio drifts by exactly what it moved. What changes is
// that nothing writes a NEW one, and `invariants.js` asserts that directly ('portfolio retired' —
// the emission-faucet-retired shape). The stranded family dividend pool is DRAINED into the family
// yield by `exchange.js:mergeLegacyYieldPools` (a bucket-to-bucket transfer, the stake-pool
// precedent), so no value is orphaned behind a retired claim route.
//
// Historical DATA (portfolios / gang_portfolios rows, dynasty_name, rwa_invested) is kept, not
// deleted — retirement never rewrites history. Nothing reads it into gameplay any more.
import { GameError } from './game.js';

const gone = () => {
  throw new GameError('retired',
    'The city sells no shares. Your $OMR works at the Window, the Vault, the stake ladder and the Made Man.');
};

// Tombstones, not 404s (the emission.js / v2 swap-launder precedent): a client or agent that has
// been polling these learns what happened instead of guessing.
export async function nameDynasty() { gone(); }
export async function nameFamilyDynasty() { gone(); }
export async function invest() { gone(); }
export async function familyInvest() { gone(); }
export async function claimDividend() { gone(); }        // retired earlier (tokenomics v2 step 2)
export async function claimFamilyDividend() { gone(); }
export async function portfolioBoard() { gone(); }
export async function portfolioLeaderboard() { gone(); }
export async function familyPortfolioLeaderboard() { gone(); }

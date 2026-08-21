// §10.4 — the nightly ledger-invariant job. Value transfers, it is never minted:
// every bucket of value must reconcile against the enumerated faucet/sink reasons
// in the transactions ledger. Any drift beyond $1 (or one unit) — or any ledger
// row with a reason outside the known vocabulary — is an alert.
import crypto from 'node:crypto';
import { DESK, DESK_RECYCLE_REASON } from './rules.js';

// The complete reason vocabulary, by currency. A row whose reason matches no
// prefix here is an unenumerated faucet/sink — the loudest possible §10.4 alarm.
const KNOWN_REASONS = {
  cash: ['crime:', 'racket:income', 'racket:upgrade', 'bank:interest', 'bank:', 'heal', 'checkin', 'travel', 'heist',
    // `racket:retire:` is the walk-away refund (economy.js `retireRacket`, the `business:shutter` twin). It
    // ships behind RACKET_RETIRE_BPS 0 and so has never written a row — but the day that lever is raised the
    // first refund would be an unknown reason, and check (g) has ZERO tolerance and reads the whole ledger,
    // so the alarm would latch red forever and bury a real drift under it (the recorded `path:` precedent).
    // Kept as its own entry rather than collapsing the four into a blanket `racket:` — the individual
    // entries are what make an unexpected `racket:*` loud.
    'melt:tithe', 'fence', 'repair', 'craft:', 'goods:', 'racket:buy:', 'racket:retire:', 'asset:', 'swap:', 'gun:buy:',
    'ammo:buy', 'gang:found', 'gang:tribute', 'gang:war', 'gang:dissolved', 'turf:seize:', 'turf:claim', 'jump:',
    'bounty:', 'bust:reward', 'whack:chop', 'whack:loot', 'death:', 'exchange:', 'crew:sales', 'deal:', 'makings:',
    'lab:', 'crew:hire', 'crew:wages', 'crew:objective', 'crew:bringone', 'laylow', 'kitchen:', 'mission:', 'daily:', 'onboard:', 'social:', 'referral:', 'firstblood:', 'mod:confiscate', 'npchit:', 'safehouse',
    // TOKENOMICS v2 — THE EXCHANGE: the one-way window's cash side. An honest FAUCET, bounded by
    // the pool and proven a redistribution by `exchange pool backed` (paid <= funded) in exchange.js.
    // `window:` not `exchange:` — the M3 cb/ammo barter board already owns that prefix.
    'window:',
    'gang:contract', 'bodyguard:', 'territory:', 'business:', 'path:', 'casino:', 'convoy:', 'market:', 'underworld:',
    'law:', 'world:', 'pen:', 'loan:', 'speakeasy:', 'boxing:', 'race:', 'port:', 'stable:', 'family:',
    // FIVE PILLARS: `sov:` — pure treasury sinks (build/upgrade/upkeep/siege, gang-level, no faucet);
    // `campaign:` — the authored-chain reward, a once-per-street-per-chain character_id'd faucet
    // (the missions precedent — check (a) reconciles it per character).
    'sov:', 'campaign:',
    // THE POPULATION: NPC residents are REAL characters, so they sit inside the per-character cash
    // check and every dollar they hold needs a reason. `npc:seed` is the cash a resident spawns
    // holding (the one new FAUCET — bounded by TARGET × band seed × turnover, sim P9.21) and
    // `npc:retire` burns what a retired resident was carrying (a SINK). A resident KILLED by a
    // player needs nothing new: the loot rides `whack:loot` and the estate burns the rest.
    'npc:',
    // MARRIAGES & SOLDIERS: dynasty ceremony/consigliere fees + the soldier hire — all
    // character_id'd cash SINKS (check (a) reconciles); the soldier's 5% crime cut is a
    // pre-ledger shave (the faucet shrinks — no reason of its own)
    'dynasty:', 'soldier:',
    // SECRETS: the hush payment is the audited taxed two-party transfer (mark −demand w/ character_id,
    // holder +98% w/ character_id — check (a) reconciles; the 1% tax rides the non-§10.4 street_tax
    // pool, the 1% dev is off-ledger — the bodyguard/speakeasy-round mechanism)
    'secret:',
    // THE MEGAPROJECT: `megaproject:cash` — a character_id'd cash BURN into the monument
    // (check (a) reconciles it per character; nothing is ever paid back out — no faucet)
    'megaproject:',
    // THE DUELING LADDER: `duel:wager` — the audited casino:pvp taxed transfer (both rows
    // character_id'd; the rake's pool half rides the non-§10.4 street_tax, the rest burns)
    'duel:',
    // CLUE SCROLLS: `clue:casket` — the treasure-trail faucet (character_id'd; bounded by the
    // 2% drop × one-active-hunt × the 8h post-casket cooldown — sim P9.19)
    'clue:',
    // THE HUSTLE: `hustle:payoff` — the daily three-stop chain's completion faucet (character_id'd;
    // bounded ONCE a day per street by the (character, day) PK — the clue-casket posture)
    'hustle:',
    // THE CAREER: `career:<taskId>` — the post-First-Week ladder's task rewards (character_id'd;
    // bounded ONCE EVER per account per task by the career_claims PK — a fixed lifetime total)
    'career:',
    // THE SHIPMENT (scarcity §3): `shipment:commission` — a pure cash SINK. The MATERIAL itself is
    // NOT a currency (an owned quantity on the character, like contraband — no reason, no rows), and
    // its only economic role is to gate this sink, so the whole system is emission-NEGATIVE.
    'shipment:',
    // THE MENTOR: `mentor:protege` — a protégé's onboarding cash at level milestones (character_id'd;
    // once-ever per milestone via mentorships.claimed_mask, level-real → ~$20k lifetime, petty & bounded)
    'mentor:',
    // THE STREAK: `streak:daily` (the daily-login reward, capped ~$4k/day) + `streak:milestone` (the
    // run-unlock ladder — once-ever per milestone, keyed off monotonic `best`, Σ bonus = 560k lifetime).
    // Both character_id'd → the per-character cash check reconciles. Petty vs the passive stack, BALANCE.md.
    'streak:',
    // PRIME TIME: `primetime:rally` — the co-present nightly faucet (character_id'd; once/night per street
    // on a `value` night, bounded BASE + PER×min(turnout−1, CAP), level-floored, agent-excluded; settled
    // by the worker at final turnout — check (a) reconciles it per character). BALANCE.md, sim-flagged.
    'primetime:',
    // WORD ON THE STREET: `corner:job` — the district quest board's envelope (character_id'd;
    // hard-bounded CORNER.MAX_DAY claims per street per day — a petty located faucet, BALANCE.md)
    'corner:',
    // STREET DEEDS (Phase 2): `deed:corner` — the corner take on every deed you CONTROL (your own, or a
    // rival's you muscled in on). Character_id'd → the per-character cash check reconciles it; bounded by
    // CORNER_CAP_MS (≤24h banked) × the deeds one controls. A located, contestable faucet, BALANCE.md.
    'deed:',
    // THE CALL: `contact:freight` / `contact:visit` — a contact's request settled from THEIR OWN
    // pocket (both legs character_id'd with counterparty — a pure transfer, the recycle-only rule)
    'contact:',
    // THE FAVOR (step two): a PLAYER-posted call. `favor:post` escrows the pay, `favor:pay` is the
    // runner's net, `favor:take` the 2% carved from it (NULL char — half street tax, half burns),
    // `favor:refund` cancel/expiry, `favor:loot`/`favor:death` the dead poster's escrow. Reconciled
    // by the per-character check (a) AND its own `favor escrow` identity below.
    'favor:',
    // COMMISSION step three: proposal deposits — treasury→escrow (`commission:proposal`, NULL char),
    // refunded on an enacted motion (`commission:refund`) or forfeited to the confiscation pool
    // (`commission:forfeit`) — reconciled by the treasury check (b) + the commission-escrow check
    'commission:'],
  omr: ['swap:', 'stake:reward', 'gear:mint:', 'vest:', 'lab:', 'cleanpapers', 'path:', 'mission:',
    'daily:all', 'referral:', 'family:weekly', 'gang:dissolved', 'withdraw:omr', 'vanity:', 'intel:', 'respec',
    'gang:tribute', 'whack:loot', 'plex:', 'prize:omr', 'law:jury', 'law:envelope', 'foundation:', 'rwa:', 'estate:', 'auction:', 'dividend:', 'emission:', 'tax:', 'megaproject:', 'kitchen:', 'bond:', 'business:spec', 'death:duty',
    // Drop 5 (B — $OMR-collateralized loans): loan:pledge (borrower → escrow), loan:pledge:return
    // (escrow → borrower on repay/void), loan:seize:omr (escrow → lender on default/forfeit) and
    // loan:pledge:loot (escrow → the killer's fire-kill cut at the borrower's death) — ALL transfers
    // (the loans.collateral_omr active rows are a §10.4 bucket), in NEITHER the mint nor burn term.
    'loan:',
    // TOKENOMICS v2 — `window:burn` is the redemption window's $OMR burn; `yield:family` is the
    // family-yield distribution, a pool -> gangs.omr_reserve TRANSFER (both sides in omrBuckets,
    // so it is in NEITHER the mint nor the burn term).
    // ECONOMY v3 step 2 — `desk:recycle` is the desk's side of a recycled sink (a TRANSFER: it rides
    // inside the burn term so the pair cancels, and desk_inventory holds the value).
    // ECONOMY v3 step 5 — `made:dues` is THE MADE MAN's subscription burn (it is in DESK.SINK_REASONS,
    // so like every sink since step 2 it recycles to the desk rather than being destroyed).
    // ECONOMY v3 step 7 — `rarity:upgrade` is the deterministic one-tier NFT upgrade: a $OMR SINK
    // in DESK.SINK_REASONS, so it recycles to the shelf. No new bucket and no faucet — the item's
    // rarity is status, not currency.
    'window:', 'yield:', 'desk:', 'made:', 'rarity:', 'brokers:',
    // THE COMMUNITY DROP (G-3): drop:claim is an enumerated MINT (the mission:% shape — backed by
    // the Safe's genesis reserve, reconciled by the 'drop claims ledgered' check below).
    'drop:'],
  cb: ['crime:', 'craft:', 'gun:buy:', 'jump:', 'death:', 'exchange:', 'onboard:', 'cook:'],
  ammo: ['melt', 'melt:tithe', 'craft:ammo', 'ammo:buy', 'jump', 'fire', 'death:', 'exchange:', 'gang:dissolved', 'convoy:', 'world:', 'port:', 'contract:', 'family:'],
};

// The $OMR burn/sink predicate, generated from the single source in rules.js (economy v3 step 2).
// Trailing '%' = a LIKE prefix, otherwise an exact reason — mechanically identical to the string
// this replaced. `desk:recycle` is appended so a recycled sink's two legs cancel inside the term.
const burnSql = () => "currency='omr' AND ("
  + [...DESK.SINK_REASONS, DESK_RECYCLE_REASON]
    .map((p) => (p.endsWith('%') ? `reason LIKE '${p}'` : `reason='${p}'`)).join(' OR ') + ')';

const sum = async (pool, where) =>
  Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE ${where}`)).rows[0].s);
const one = async (pool, q) => Number((await pool.query(q)).rows[0].s);

// (red-team R6 B) Consistent-snapshot wrapper: the ~40 aggregate-vs-ledger reads must see ONE point
// in time. Without it, a player action committing between the two halves of a check (e.g. charWealth
// SUM then charLedger SUM) tears the read into a FALSE drift → a false webhook alarm at the founder.
// Run every read inside a single REPEATABLE READ, READ ONLY transaction; alert AFTER, on the pool.
// `opts.alert` exists for the MEASUREMENT harnesses (tools/loadtest.js, tools/chaos.js). They seed cash
// and ammo by SQL, so their baseline drift is non-zero BY CONSTRUCTION and they assert a before/after
// DELTA instead — but every read still fired the production alarm, burying the actual ✓/✗ lines under
// 🚨 banners that are true and irrelevant. A harness measuring is not a production drift; the alarm's
// job is production, so it stays on by default and only a deliberate caller turns it off.
export async function runLedgerInvariants(pool, { alert = true } = {}) {
  let client = pool.connect ? await pool.connect() : null;
  if (client) {
    // best-effort snapshot — real Postgres runs every read in one MVCC snapshot; pg-mem (single-
    // threaded, no concurrency to tear a read) can't parse the isolation syntax, so fall back cleanly.
    try { await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY'); }
    catch { try { client.release(); } catch { /* gone */ } client = null; }
  }
  try {
    const res = await collectLedgerChecks(client || pool);
    if (client) await client.query('COMMIT');
    if (alert && !res.ok) await alertDrift(pool, res.checks.filter((c) => !c.ok));
    return res;
  } catch (e) {
    if (client) { try { await client.query('ROLLBACK'); } catch { /* already gone */ } }
    throw e;
  } finally { if (client) client.release(); }
}

async function collectLedgerChecks(pool) {
  const checks = [];
  const push = (name, lhs, rhs, tolerance = 1, extra = {}) =>
    checks.push({ name, lhs: Math.round(lhs * 1e6) / 1e6, rhs: Math.round(rhs * 1e6) / 1e6,
      drift: Math.round((lhs - rhs) * 1e6) / 1e6, ok: Math.abs(lhs - rhs) <= tolerance, ...extra });

  // (a) CHARACTER CASH: every character starts with an unledgered $500; everything
  // after that has a row. Dead rows are zeroed and their estate burn is ledgered.
  const charWealth = await one(pool, 'SELECT COALESCE(SUM(cash+bank),0) s FROM characters');
  const charCount = await one(pool, 'SELECT COUNT(*) s FROM characters');
  const charLedger = await sum(pool, "currency='cash' AND character_id IS NOT NULL");
  push('character cash', charWealth, 500 * charCount + charLedger);

  // (b) GANG TREASURIES: inflows are tribute (mirrored off character rows) and the
  // melt tithe; sinks are war chests, garrisons, and dissolution; spoils are internal.
  const treasuries = await one(pool, 'SELECT COALESCE(SUM(treasury),0) s FROM gangs');
  const tributeIn = -(await sum(pool, "currency='cash' AND reason='gang:tribute'"));
  const titheIn = await sum(pool, "currency='cash' AND reason='melt:tithe'");
  const warOut = -(await sum(pool, "currency='cash' AND reason='gang:war'"));
  const seizeOut = -(await sum(pool, "currency='cash' AND reason LIKE 'turf:seize:%'"));
  // THE SEALED BID: a stake is treasury -> escrow ('turf:claim', an OUT); a loser's kept share comes
  // home ('turf:claim:refund', an IN). The winner's stake and every forfeited share leave the escrow
  // for good ('turf:claim:burn') and reach no treasury, so they are counted only by the escrow check.
  const claimOut = -(await sum(pool, "currency='cash' AND reason='turf:claim'"));
  const claimRefund = await sum(pool, "currency='cash' AND reason='turf:claim:refund'");
  const dissolvedCash = -(await sum(pool, "currency='cash' AND reason='gang:dissolved'"));
  // M7 Phase 4 family contracts: treasury → escrow ('gang:contract' + its 2% ':take') is an
  // outflow; a cancel/expiry refund comes home as a character_id-NULL 'bounty:refund' row
  // (character refunds carry a character_id, so the split is exact).
  const contractOut = -(await sum(pool, "currency='cash' AND reason LIKE 'gang:contract%'"));
  const treasuryRefunds = await sum(pool, "currency='cash' AND reason='bounty:refund' AND character_id IS NULL");
  // COMMISSION step three: a proposal deposit is treasury→escrow (out); an enacted motion's refund
  // comes home (in). Forfeits go to the confiscation pool, never a treasury — excluded here, counted
  // in the commission-escrow check below.
  const proposalOut = -(await sum(pool, "currency='cash' AND reason='commission:proposal'"));
  const proposalRefund = await sum(pool, "currency='cash' AND reason='commission:refund'");
  // Phase 3 territory rackets: `territory:income` is a treasury FAUCET, `territory:establish` a SINK,
  // and (recurring sinks) `territory:upkeep` a treasury SINK too — all character_id NULL (gang-level).
  const territoryIncome = await sum(pool, "currency='cash' AND reason='territory:income'");
  const territoryOut = -(await sum(pool, "currency='cash' AND reason IN ('territory:establish','territory:upkeep','territory:raid','territory:fortify')"));
  // FIVE PILLARS #3: sovereignty's sinks (build/upgrade/upkeep/siege). TIER-4 §C added `sov:income` —
  // a held stronghold's lazy tribute, a treasury FAUCET (the territory:income precedent) — so it's
  // EXCLUDED from the sink sum and carried as its own IN term below. All character_id NULL, counterparty = gang.
  const sovOut = -(await sum(pool, "currency='cash' AND reason LIKE 'sov:%' AND reason <> 'sov:income'"));
  const sovIncomeIn = await sum(pool, "currency='cash' AND reason='sov:income'");
  // STEP FOUR — a RIVAL raid muscles a held operation for a CUT of its pending income: `territory:muscle`
  // is a treasury FAUCET (character_id NULL, counterparty = the RAIDER's gang) that REDIRECTS uncollected
  // income (the owner's clock advances so they collect that much less — the business-shakedown pattern),
  // so total territory:income+muscle emission stays bounded by the signed curve. A treasury IN term.
  const territoryMuscleIn = await sum(pool, "currency='cash' AND reason='territory:muscle'");
  // Den step 2: the neon family's fight fix is a treasury sink (character_id NULL, like gang:war)
  const fixOut = -(await sum(pool, "currency='cash' AND reason='casino:fix'"));
  // Convoy step 2: the destination toll is a TRANSFER — the shipper's negative row mirrors the
  // holder treasury's credit (the gang:tribute pattern).
  const tollIn = -(await sum(pool, "currency='cash' AND reason='convoy:toll'"));
  // Port step 3 THE HARBORMASTER: a clean landing at docks held by another family tolls the shipper —
  // a TRANSFER (the shipper's negative port:toll row mirrors the holder treasury's direct credit).
  const portTollIn = -(await sum(pool, "currency='cash' AND reason='port:toll'"));
  // World step 4 THE FRONTIER: a held outfit's tribute is a treasury FAUCET (character_id NULL, like
  // territory:income); invading a held outpost is a treasury SINK (like a turf seize). Both counterparty=gang.
  const worldTributeIn = await sum(pool, "currency='cash' AND reason='world:tribute'");
  const worldInvadeOut = -(await sum(pool, "currency='cash' AND reason='world:invade'"));
  const worldReinforceOut = -(await sum(pool, "currency='cash' AND reason='world:reinforce'")); // step six: garrison-stiffen treasury SINK
  // BLOOD WAR conquest: a routed NPC family held as a vassal pays a bounded tribute to the holder's
  // treasury (a FAUCET, character_id NULL, counterparty=gang — the world:tribute twin; family:raid loot
  // is character_id'd and rides the per-character cash check, so it is NOT double-counted here).
  const familyTributeIn = await sum(pool, "currency='cash' AND reason='family:tribute'");
  push('gang treasuries', treasuries,
    tributeIn + titheIn + territoryIncome + territoryMuscleIn + tollIn + portTollIn + worldTributeIn + sovIncomeIn + familyTributeIn - warOut - seizeOut - dissolvedCash - contractOut - territoryOut - sovOut - fixOut - worldInvadeOut - worldReinforceOut + treasuryRefunds - proposalOut + proposalRefund - claimOut + claimRefund);

  // COMMISSION ESCROW (step three): open proposal deposits == posted − refunded − forfeited
  // (the bounty-escrow twin on the chamber's table; a dissolved family's deposit forfeits at settle).
  const commissionEscrow = await one(pool, "SELECT COALESCE(SUM(deposit),0) s FROM commission_proposals WHERE status='open'");
  const commissionForfeited = -(await sum(pool, "currency='cash' AND reason='commission:forfeit'"));
  push('commission escrow', commissionEscrow, proposalOut - proposalRefund - commissionForfeited);

  // (c) BOUNTY/CONTRACT ESCROW: posted (escrow rows, player 'bounty:post' + family 'gang:contract')
  // − claimed − refunded (cancel/expiry) − cleared at death.
  const escrow = await one(pool, 'SELECT COALESCE(SUM(amount),0) s FROM bounties');
  const posted = -(await sum(pool, "currency='cash' AND reason='bounty:post'"));
  const gangPosted = -(await sum(pool, "currency='cash' AND reason='gang:contract'"));
  // LOAN step 4: the underworld's WANTED_BOUNTY on a defaulter is funded from the confiscation pool —
  // a NULL-char 'bounty:wanted' post into escrow. It pays a player killer (claimed), refunds to the
  // pool on square/expiry (refunded, the HOUSE branch), or burns on an NPC/mod kill (deadBounties).
  const wantedPosted = -(await sum(pool, "currency='cash' AND reason='bounty:wanted'"));
  const claimed = await sum(pool, "currency='cash' AND reason='bounty:claim'");
  const refunded = await sum(pool, "currency='cash' AND reason='bounty:refund'");
  // the wanted HOUSE-share refund uses a DISTINCT reason (→ the pool, not a treasury) so it stays out
  // of check (b)'s treasuryRefunds; it IS an escrow outflow here, so the escrow check must count it.
  const wantedRefunded = await sum(pool, "currency='cash' AND reason='bounty:wanted:refund'");
  const deadBounties = -(await sum(pool, "currency='cash' AND reason='death:bounty'"));
  push('bounty escrow', escrow, posted + gangPosted + wantedPosted - claimed - refunded - wantedRefunded - deadBounties);

  // (d) $OMR CONSERVATION: buckets = accounts (omr + staked; unclaimed rewards mint
  // at claim time) + AMM reserve + event fund + family reserves. Genesis is the
  // 20,000-token pool seed. Legal mints: staking-reward claims, mission rewards.
  // Legal burns: vests, clean papers, lab tiers, gear mints, path switches,
  // dissolution. Swaps, buybacks, and fund-sourced payouts are transfers — they
  // move between buckets and cancel inside the total.
  // (unbonding = unstaked principal in its exposure window — same account bucket, still conserved)
  // THE AUCTION HOUSE: live $OMR bids sit in escrow (the bounty/loan/market-escrow twin, on $OMR).
  // The escrow is a genuine bucket — add it so conservation stays exact (bid = account→escrow and
  // refund = escrow→account are TRANSFERS inside omrBuckets; only auction:win escapes as a burn).
  // Tier-4 — the escrow now spans BOTH the server weekly auctions AND live player CONSIGNMENTS (a
  // resale bid escrows $OMR the same way; miss the consignments term and every live consignment bid drifts).
  const auctionEscrow = await one(pool, "SELECT COALESCE(SUM(current_bid),0) s FROM auctions WHERE status='live'")
    + await one(pool, "SELECT COALESCE(SUM(current_bid),0) s FROM auction_consignments WHERE status='live'");
  const omrBuckets = await one(pool, 'SELECT COALESCE(SUM(omr+staked+unbonding),0) s FROM account_persistent')
    + await one(pool, 'SELECT COALESCE(SUM(omr_reserve),0) s FROM amm_pool')
    + await one(pool, 'SELECT COALESCE(SUM(fund),0) s FROM street_tax')
    + await one(pool, 'SELECT COALESCE(SUM(omr_reserve),0) s FROM gangs')
    + await one(pool, 'SELECT COALESCE(SUM(balance),0) s FROM stake_pool')   // Phase 4 backed-emission pool
    + await one(pool, 'SELECT COALESCE(SUM(omr),0) s FROM dev_fund')          // the exit toll's dev share (tax:dev — a transfer bucket)
    + await one(pool, 'SELECT COALESCE(SUM(pool),0) s FROM rwa_dividend_pool') // Dynasty Fund personal dividend pool (fed by invests, paid to holders — both dividend: transfers)
    + await one(pool, 'SELECT COALESCE(SUM(pool),0) s FROM rwa_family_dividend_pool') // the SEPARATE family dividend pool (reserve→pool→reserve; keeps reserve $OMR off personal accounts)
    // TOKENOMICS v2: what individual staking rewards and personal dividends were repurposed into.
    // Holds soft $OMR between funding and the 12h distribution, so it MUST sit inside the bucket sum
    // or `yield:family` (a pool→reserve TRANSFER) would read as a burn.
    + await one(pool, 'SELECT COALESCE(SUM(balance),0) s FROM family_yield_pool')
    // ECONOMY v3 STEP 2 — THE DESK'S INVENTORY. A sink no longer destroys the token, it hands it here
    // for the daily auction to sell back. This bucket is what turns the sink from a BURN into a
    // TRANSFER without changing the identity below: the sink's own row and the paired `desk:recycle`
    // row are BOTH inside the burn term, so they cancel, and the value shows up here instead.
    + await one(pool, 'SELECT COALESCE(SUM(balance),0) s FROM desk_inventory')
    // Drop 5 (B) — the $OMR PLEDGE ESCROW: a $OMR-secured loan holds the borrower's pledge in the
    // loan row itself (collateral_omr on ACTIVE rows only — on an open row it is just the lender's
    // demand, nothing has moved). pledge/return/seize/loot are transfers into and out of this bucket.
    + await one(pool, "SELECT COALESCE(SUM(collateral_omr),0) s FROM loans WHERE status='active'")
    + auctionEscrow;
  // prize:omr is a Phase-2 mint: an in-game $OMR credit BACKED by hard $OMR the Vig moved into the
  // withdrawal reserve (src/vig.js payPrizes) — admissible because real revenue backs every token.
  // Phase 4: stake:reward is NO LONGER a mint — rewards are paid from stake_pool (a transfer, both
  // sides inside omrBuckets), so staking contributes zero to net supply. It's out of the mint term.
  // THE STREET WAGE, RETIRED (economy v3 step 1 — the "no faucet" wall). `emission:%` STAYS in the
  // mint term and STAYS in the vocabulary, and that is not an oversight: a live database holds the
  // rows the wage already wrote, and conservation is a statement about the WHOLE ledger. Drop the
  // reason and every server that ever paid a wage drifts by exactly what it paid. Nothing writes a
  // new one — the `emission faucet retired` check below asserts that directly.
  // ECONOMY v3 STEP 4 — `desk:buyback` is a mint, and it is the EXACT INVERSE of `withdraw:omr`.
  // A withdrawal is an in-game burn paired with hard OMR leaving the reserve: supply exits the game.
  // The buyback is an in-game mint paired with hard OMR ENTERING the reserve: supply re-enters. It
  // credits the DESK'S SHELF and never a player, so wall 1 ("no faucet") is untouched — nobody is
  // paid, and the token only reaches a player by being bought at the auction for ETH. It is
  // admissible exactly to the extent that the hard token really arrived, which conservation cannot
  // see (it counts the mint and moves on) — so `runDeskInvariants` asserts the soft credit equals the
  // hard purchase, and the Vig's two-sided reserve-backing pair carries the desk's contribution.
  // yield:buyback (the family buyback, src/community.js) is the desk:buyback shape one pool over:
  // an in-game mint into family_yield_pool paired with a hard $OMR purchase off the DEX, admissible
  // exactly to the extent the hard token arrived — which runFamilyBuybackInvariants asserts
  // (credited == bought, real rows only). The EXACT reason, never the yield:% prefix: yield:window
  // and yield:family are genuine transfers and must stay out of both terms.
  const omrMints = await sum(pool, "currency='omr' AND (reason LIKE 'mission:%' OR reason='prize:omr' OR reason LIKE 'emission:%' OR reason='desk:buyback' OR reason='yield:buyback' OR reason='drop:claim')");
  // plex:* was a Phase-2 burn: a player paid a real-money fee from earned $OMR instead of ETH (the
  // PLEX bridge). RETIRED 2026-08-10 (fees are ETH only) — the rows are real, so the reason stays in
  // the burn term forever; only new writes stopped ('plex bridge retired' below asserts that).
  // law:jury is a Phase-3 sink: the war chest reaches the jury box. It is in DESK.SINK_REASONS, so
  // since v3 step 2 it RECYCLES to the desk's shelf like every other sink — it does not leave the
  // game and it is not deflationary. (That word was left here from before the recycle shipped; a
  // stale internal claim is exactly what licenses a false player-facing one later — the retired
  // `ammSpot` class. Its neighbour two lines down gets it right for `auction:win`.)
  // rwa:* is a $OMR BURN. Live: rwa:vault (THE VAULT — treasury.js). HISTORICAL: rwa:invest /
  // rwa:dynasty (the retired Portfolio, D11 2026-08-05) — the rows are real, so the reason stays in
  // the burn term forever; only new writes stopped ('portfolio retired' below asserts that).
  // estate:* (THE ESTATE) is a $OMR BURN — the deep personal compound sink, account bucket, pure
  // status (like rwa:/vanity:); no new §10.4 bucket, only the burn term.
  // auction:win (THE AUCTION HOUSE) is a $OMR SINK — the winning bid leaves escrow for good. It sits
  // in the burn TERM so conservation stays exact, but it is in DESK.SINK_REASONS, so the value goes
  // to the shelf (revenue), not to the fire. bid/refund are transfers (escrow ↔ account, both inside
  // omrBuckets), NOT here.
  // law:envelope (THE ENVELOPE) is a $OMR BURN — the standing graft (account bucket, the law:jury twin).
  // foundation:tier (THE FOUNDATION) is a $OMR BURN — the family charity, against the gang reserve bucket
  // (the vanity:gang:seal precedent; the reserve is already in omrBuckets, so only the burn term is new).
  // Tier-4 consignment: auction:take (the house cut) + auction:consign:fee (the listing fee) are $OMR
  // BURNS — added as EXACT matches. Do NOT widen reason='auction:win' to LIKE 'auction:%': that would
  // wrongly classify auction:bid/auction:refund/auction:consign (transfers) as burns and break conservation.
  // Built from `DESK.SINK_REASONS` — the ONE list, shared with the ledger's recycle hook (rules.js),
  // so the set of things that are a sink and the set of things that feed the desk can never drift.
  // `desk:recycle` rides INSIDE this same term on purpose: the sink's −X and the desk's +X then sum
  // to zero, the value shows up in the desk_inventory bucket, and conservation holds with no new
  // term. A HISTORICAL burn row (written before the recycle shipped) has no partner and still counts
  // as the burn it was — which is what makes this change safe on a database that already has rows.
  const omrBurns = -(await sum(pool, burnSql()));
  push('$OMR conservation', omrBuckets, 20000 + omrMints - omrBurns, 0.001);

  // THE FAUCET IS RETIRED (economy v3 wall 1, made CHECKABLE). The wage used to be bounded by an
  // endowment; now it is bounded by not existing, which is a much stronger claim — so assert the
  // strong one. Any `emission:%` row dated inside the last day means somebody re-armed the printer
  // (a reverted retirement, a stray worker still running the old build), and that is worth waking
  // someone for: it is the difference between "$OMR is only ever bought" and "$OMR is printed".
  // Historical rows are deliberately NOT in scope — they are real, they are in `omrMints`, and
  // conservation depends on them staying there.
  //
  // HONEST SCOPE: this covers the wage. Two mint reasons survive into later migration steps —
  // `mission:%` (the one-off mission $OMR ladder) and `prize:omr` (the Vig's backed prize credit).
  // Wall 1 is not fully true until those retire with their own systems (design §9 steps 2–4).
  const freshEmission = await sum(pool, "currency='omr' AND reason LIKE 'emission:%' AND at >= now() - interval '1 day'");
  const lifetimeEmission = await sum(pool, "currency='omr' AND reason LIKE 'emission:%'");
  push('emission faucet retired', freshEmission, 0, 0.001, { lifetimeEmission, since: 'v3 step 1' });

  // (d1a1b) THE PLEX BRIDGE IS RETIRED (founder-directed 2026-08-10: "Make plex items and consumables
  // eth only"). Every real-money price — the identity mint, the respawn token, every Store SKU — is
  // ETH now. Two arguments carried it: a fee with two rails is always priced by the CHEAPER one (fatal
  // for the mint, which is the Sybil bound), and since v3 step 2 the $OMR rail did not even burn —
  // `plex:%` is in `DESK.SINK_REASONS`, so it RECYCLED to the desk shelf, which is what the bridge was
  // sold as an alternative to.
  //
  // The reason STAYS in the vocabulary and the burn term forever: real `plex:*` rows exist and
  // conservation is a claim about the WHOLE ledger (the emission.js lesson, in its second costume).
  //
  // What is checked is FRESHNESS, on the EXACT reason `plex:mint` and never on `plex:%`. The whole
  // prefix was briefly right — for the hours the entire bridge was retired — and is WRONG now that
  // the founder pulled that back to the mint alone: `plex:respawn` and `plex:<sku>` are LIVE rails,
  // so a prefix check would alarm on ordinary play. This is the `rwa:vault` distinction exactly: a
  // retirement check must name the dead thing, not the family it belonged to, or it fires on its
  // living siblings.
  const freshPlexMint = await sum(pool, "currency='omr' AND reason='plex:mint' AND at >= now() - interval '1 day'");
  const lifetimePlex = await sum(pool, "currency='omr' AND reason LIKE 'plex:%'");
  push('plex mint retired', freshPlexMint, 0, 0.001,
    { lifetimePlex, since: 'the mint is ETH only; respawn + Store SKUs are payable in earned $OMR' });

  // (d1a2) THE PORTFOLIO IS RETIRED (D11, 2026-08-05). The in-game stock book — invests, dynasty
  // naming, the Dynasty Fund dividends — writes nothing new. EXACT reasons, not `rwa:%`, because
  // `rwa:vault` (THE VAULT) is live and must never trip this. Historical rows stay in the
  // vocabulary + terms above; a fresh row here means somebody re-opened a retired till.
  const freshPortfolio = await sum(pool,
    "currency='omr' AND reason IN ('rwa:invest','rwa:dynasty','dividend:fund','dividend:omr') AND at >= now() - interval '1 day'");
  push('portfolio retired', freshPortfolio, 0, 0.001, { since: 'D11 2026-08-05' });

  // (d1b) THE DESK'S INVENTORY (economy v3 step 2). The shelf must hold exactly what the sinks handed
  // over minus what the auction has sold — the stake-pool/exchange-till shape, on the supply side.
  // Two claims, because they fail differently: the BALANCE can drift from its own books (a write that
  // moved the bucket without a ledger row, or the reverse), and the books can drift from the LEDGER
  // (a recycle credited without its row, which would be a silent mint).
  const desk = (await pool.query('SELECT balance, lifetime_in, lifetime_sold, lifetime_bought FROM desk_inventory WHERE id=1')).rows[0]
    || { balance: 0, lifetime_in: 0, lifetime_sold: 0, lifetime_bought: 0 };
  push('desk inventory backed', Number(desk.balance),
    Number(desk.lifetime_in) + Number(desk.lifetime_bought) - Number(desk.lifetime_sold), 0.001,
    { lifetimeIn: Number(desk.lifetime_in), lifetimeSold: Number(desk.lifetime_sold),
      lifetimeBought: Number(desk.lifetime_bought) });
  // The reason is a LITERAL rather than interpolated from DESK_RECYCLE_REASON so the term extractor
  // (tools/graph.js) can see which reason this check reconciles — it reads the predicates lexically
  // above each push, which is also why this sum sits BELOW the check before it rather than with it.
  // Drift between literal and constant is self-catching: change one and lifetime_in stops matching
  // the summed rows, which is precisely what this check reports.
  const recycled = await sum(pool, "currency='omr' AND reason='desk:recycle'");
  push('desk inventory ledgered', Number(desk.lifetime_in), recycled, 0.001, { recycled });
  // (d1c) THE OUTBOUND HALF (economy v3 step 3). The sale is a TRANSFER — shelf down, buyer up, both
  // inside omrBuckets — so conservation above never moves and cannot catch a sale that credited a
  // buyer without decrementing the shelf. This does: what the desk says it has sold must equal what
  // the ledger says it handed over. (The `desk:sale` row is also what makes a purchase VEST, since
  // tax.js replays credits as FIFO lots — so a missing row is two defects, not one.)
  const sold = await sum(pool, "currency='omr' AND reason='desk:sale'");
  push('desk sales ledgered', Number(desk.lifetime_sold), sold, 0.001, { sold });

  // (d2) AUCTION ESCROW ($OMR): live standing bids == bid − refunded − won (the bounty-escrow twin,
  // on the $OMR side). bid rows are negative (escrowed in); refund rows positive (out); auction:win
  // negative (burned out of escrow). No death term — $OMR is account-level and survives death.
  // Tier-4 — the escrow identity now also drains at a CONSIGNMENT settle: auction:consign is the
  // escrow→seller TRANSFER (a positive seller credit, subtracted here, NOT a burn), auction:take the
  // escrow→burn house cut (subtracted here AND in omrBurns). aucBids/aucRefunds already span both
  // tables (they sum by reason). auction:consign:fee is a DIRECT seller burn, never in escrow — absent here.
  const aucBids = -(await sum(pool, "currency='omr' AND reason='auction:bid'"));
  const aucRefunds = await sum(pool, "currency='omr' AND reason='auction:refund'");
  const aucWins = -(await sum(pool, "currency='omr' AND reason='auction:win'"));
  const aucConsign = await sum(pool, "currency='omr' AND reason='auction:consign'");
  const aucTake = -(await sum(pool, "currency='omr' AND reason='auction:take'"));
  push('auction escrow', auctionEscrow, aucBids - aucRefunds - aucWins - aucConsign - aucTake, 0.001);

  // (e) CAR CONSERVATION: boost is the only faucet; melt, fence, and death the only
  // sinks (death events carry the destroyed fleet size in telemetry).
  const carsHeld = await one(pool, 'SELECT COUNT(*) s FROM cars');
  const boosts = await one(pool, "SELECT COUNT(*) s FROM rng_audit WHERE action='gta' AND outcome='success'");
  const melts = await one(pool, "SELECT COUNT(*) s FROM transactions WHERE reason='melt' AND currency='ammo' AND character_id IS NOT NULL");
  const fences = await one(pool, "SELECT COUNT(*) s FROM transactions WHERE reason='fence'");
  const deaths = (await pool.query("SELECT props FROM telemetry WHERE event='death'")).rows;
  const deathCars = deaths.reduce((a, r) => a + (JSON.parse(r.props).cars || 0), 0);
  // STREET WAR step two (residents-as-marks): a RESIDENT's spawn car is a second, explicitly
  // counted faucet (an rng_audit 'npc:car' grant row per car — the boost-counting mechanism), and
  // its retirement the matching sink (a retire row per car deleted). A resident KILLED by a player
  // goes through the ordinary runEstate, so the death telemetry term already covers that exit; a
  // STOLEN resident car just changes hands (rows conserve). PvP theft itself moves rows, never counts.
  const npcCarGrants = await one(pool, "SELECT COUNT(*) s FROM rng_audit WHERE action='npc:car' AND outcome='grant'");
  const npcCarRetires = await one(pool, "SELECT COUNT(*) s FROM rng_audit WHERE action='npc:car' AND outcome='retire'");
  push('car conservation', carsHeld, boosts + npcCarGrants - melts - fences - deathCars - npcCarRetires, 0);

  // (f) CONTRABAND & AMMO: characters + exchange escrow (+ the family armories);
  // ammo starts at 25/character, crates at 0.
  for (const cur of ['cb', 'ammo']) {
    const held = await one(pool, `SELECT COALESCE(SUM(${cur}),0) s FROM characters`);
    const inEscrow = await one(pool, `SELECT COALESCE(SUM(qty),0) s FROM listings WHERE item_kind='${cur}'`);
    const banked = cur === 'ammo' ? await one(pool, 'SELECT COALESCE(SUM(ammo_bank),0) s FROM gangs') : 0;
    const ledgered = await sum(pool, `currency='${cur}'`);
    const start = cur === 'ammo' ? 25 * charCount : 0;
    push(`${cur} conservation`, held + inEscrow + banked, start + ledgered);
  }

  // (f2) CONVOY INSURANCE POOL (step two): a zero-sum cash bucket — premiums in
  // ('convoy:insure', negative character rows), pool-capped payouts out ('convoy:payout').
  const insurancePool = await one(pool, 'SELECT COALESCE(SUM(pool),0) s FROM convoy_insurance');
  const premiumsIn = -(await sum(pool, "currency='cash' AND reason='convoy:insure'"));
  const payoutsOut = await sum(pool, "currency='cash' AND reason='convoy:payout'");
  push('convoy insurance pool', insurancePool, premiumsIn - payoutsOut);

  // (f3) BLACK MARKET ESCROW: standing bids on live listings PLUS un-filled buy-order balances
  // (step two: qty×price of live orders) == posted ('market:bid' + 'market:order') − refunds −
  // seller nets ('market:sale' + 'market:fill') − takes (NULL 'market:take': half street tax +
  // half burn) − dead-poster burns (NULL 'market:death'). The 'market:list' fee is a plain
  // sink — NOT in here. Order balances summed in JS (pg-mem SUM over an expression is dicey).
  const bidEscrow = await one(pool,
    "SELECT COALESCE(SUM(bid),0) s FROM market_listings WHERE status='live' AND bidder IS NOT NULL");
  const orderRows = (await pool.query(
    "SELECT qty, price FROM market_listings WHERE status='live' AND kind='order'")).rows;
  const orderEscrow = orderRows.reduce((a, r) => a + Number(r.qty) * Number(r.price), 0);
  const mPosted = -(await sum(pool, "currency='cash' AND reason IN ('market:bid','market:order')"));
  const mRefunded = await sum(pool, "currency='cash' AND reason='market:refund'");
  const mSales = await sum(pool, "currency='cash' AND reason IN ('market:sale','market:fill')");
  const mTakes = -(await sum(pool, "currency='cash' AND reason='market:take'"));
  const mDead = -(await sum(pool, "currency='cash' AND reason='market:death'"));
  // audit #1: a fire-kill LOOTS CASH_LOOT_RATE of the victim's live order escrow — the killer's
  // matching +row is a `whack:loot` credit (in check (a)); this NULL-char `market:loot` row is
  // the escrow-side outflow (the rest of the looted order burns as market:death). Net 0.
  const mLoot = -(await sum(pool, "currency='cash' AND reason='market:loot'"));
  push('market escrow', bidEscrow + orderEscrow, mPosted - mRefunded - mSales - mTakes - mDead - mLoot);

  // (f4) LOAN ESCROW (loan sharking): an OPEN offer holds the principal in escrow (the bounty-escrow
  // twin). escrow == offered − taken (escrow → borrower) − refunded (cancel/expiry) − deathBurned.
  // repay/collect are transfers (character rows, in check (a)); the vig is the only value that LEAVES
  // (a NULL-character sink → the pool, the market-take precedent).
  const loanEscrow = await one(pool, "SELECT COALESCE(SUM(principal),0) s FROM loans WHERE status='open'");
  const loanOffered = -(await sum(pool, "currency='cash' AND reason='loan:offer'"));
  const loanTaken = await sum(pool, "currency='cash' AND reason='loan:take'");
  const loanRefunded = await sum(pool, "currency='cash' AND reason='loan:refund'");
  const loanDeath = -(await sum(pool, "currency='cash' AND reason='loan:death'"));
  // audit (loot-proof vault): a fire-kill loots CASH_LOOT_RATE of the dead lender's OPEN escrow — the
  // killer's matching +row is a `whack:loot` credit (in check (a)); this NULL-char `loan:loot` row is
  // the escrow-side outflow (the rest of the escrow burns as loan:death). The market:loot precedent.
  const loanLoot = -(await sum(pool, "currency='cash' AND reason='loan:loot'"));
  push('loan escrow', loanEscrow, loanOffered - loanTaken - loanRefunded - loanDeath - loanLoot);

  // (f4b) Drop 5 (B) — THE $OMR PLEDGE ESCROW: active pledged $OMR == pledged in − returned − seized
  // − death-looted. Every pledge row is a single-leg transfer (the auction:bid shape): loan:pledge is
  // the borrower's negative debit into the row, the three exits are positive credits out of it
  // (return → borrower, seize → lender, loot → the killer's fire-kill cut). Exact-reason matches on
  // purpose — the cash-side loan:* reasons above must never leak in (currency scopes them anyway).
  const omrPledged = await one(pool, "SELECT COALESCE(SUM(collateral_omr),0) s FROM loans WHERE status='active'");
  const plIn = -(await sum(pool, "currency='omr' AND reason='loan:pledge'"));
  const plBack = await sum(pool, "currency='omr' AND reason='loan:pledge:return'");
  const plSeized = await sum(pool, "currency='omr' AND reason='loan:seize:omr'");
  const plLooted = await sum(pool, "currency='omr' AND reason='loan:pledge:loot'");
  push('loan omr pledge escrow', omrPledged, plIn - plBack - plSeized - plLooted, 0.001);

  // THE COMMUNITY DROP (G-3) — every `drop:claim` mint must be matched by a CLAIMED allocation row:
  // the dataset is the authority on what a wallet was owed, so a credit with no claimed row behind
  // it (or a claimed row whose credit never landed) trips the sweep. Zero-$OMR whitelist-only rows
  // claim without a ledger row and sum identically on both sides.
  const dropMinted = await sum(pool, "currency='omr' AND reason='drop:claim'");
  const dropClaimed = await one(pool, 'SELECT COALESCE(SUM(omr),0) s FROM drop_allocations WHERE claimed');
  push('drop claims ledgered', dropMinted, dropClaimed, 0.001);

  // (f4b) THE FAVOR ESCROW (Street Life step two) — the market-escrow twin. A player's posted pay
  // sits in the row, not a pocket, so the open pot must equal what was posted minus everything that
  // has left it: the runner's net, the house take carved from the pay (never minted on top), the
  // refunds (cancel/expiry) and — because parked liquid is never a loot-proof vault — a dead
  // poster's escrow split into the killer's cut (`favor:loot`, matched by a `whack:loot` credit in
  // check (a)) and the burn.
  const favorEscrow = await one(pool, "SELECT COALESCE(SUM(pay),0) s FROM favors WHERE status='open'");
  const fvPosted = -(await sum(pool, "currency='cash' AND reason='favor:post'"));
  const fvPaid = await sum(pool, "currency='cash' AND reason='favor:pay'");
  const fvTakes = -(await sum(pool, "currency='cash' AND reason='favor:take'"));
  const fvRefunded = await sum(pool, "currency='cash' AND reason='favor:refund'");
  const fvDeath = -(await sum(pool, "currency='cash' AND reason='favor:death'"));
  const fvLoot = -(await sum(pool, "currency='cash' AND reason='favor:loot'"));
  push('favor escrow', favorEscrow, fvPosted - fvPaid - fvTakes - fvRefunded - fvDeath - fvLoot);

  // (f4c) THE TURF CONTEST ESCROW (the strategy package's sealed bid) — the market-escrow shape on
  // the family side. Every open stake sits in district_bids, not a treasury, so the open pot must
  // equal what was staked minus everything that has left it: the losers' kept share going home
  // ('turf:claim:refund') and everything that burns — the winner's whole stake (it becomes the
  // garrison) plus each loser's forfeited CONTEST_LOSS_BPS ('turf:claim:burn'). A family that
  // dissolves mid-contest burns its whole stake, which is the same term.
  const contestEscrow = await one(pool, 'SELECT COALESCE(SUM(amount),0) s FROM district_bids');
  const claimStaked = -(await sum(pool, "currency='cash' AND reason='turf:claim'"));
  const claimHome = await sum(pool, "currency='cash' AND reason='turf:claim:refund'");
  const claimBurn = -(await sum(pool, "currency='cash' AND reason='turf:claim:burn'"));
  push('turf contest escrow', contestEscrow, claimStaked - claimHome - claimBurn);

  // (f4b) THE LOAN HOUSE (step 5 — the backed NPC lender): the window's pool == funded (mod, from the
  // confiscation pool) + the vig share + repayments + seizures − principal lent. Every flow is a
  // ledgered `loan:house:*` row; the house lends only what the pool holds (full-reserve — a dead
  // borrower's shortfall is eaten by the pool, bounded by what sinks already funded, NEVER a mint).
  const housePool = await one(pool, 'SELECT COALESCE(SUM(pool),0) s FROM loan_house');
  const houseFund = await sum(pool, "currency='cash' AND reason='loan:house:fund'");
  const houseVig = await sum(pool, "currency='cash' AND reason='loan:house:vig'");
  const houseRepay = -(await sum(pool, "currency='cash' AND reason='loan:house:repay'"));
  const houseSeize = -(await sum(pool, "currency='cash' AND reason='loan:house:seize'"));
  const houseTake = await sum(pool, "currency='cash' AND reason='loan:house:take'");
  push('loan house pool', housePool, houseFund + houseVig + houseRepay + houseSeize - houseTake);

  // (f6) BOXING BET ESCROW (the Fight Circuit step three — THE MAIN EVENT): CASH bets on a booked card sit
  // in escrow (the bounty/market/loan-escrow twin). escrow == posted ('boxing:bet') − winner payouts
  // ('boxing:bet:win': stake back + pro-rata cut) − refunds ('boxing:bet:refund': one-sided book / cancel)
  // − the winning manager's promoter purse ('boxing:purse:main') − the house vig (NULL 'boxing:bet:take':
  // half street tax + half burn) − dead-bettor burns (NULL 'boxing:bet:death'). recruit/train/fee/purse
  // (exhibition) and the PvP 'boxing:bout' transfer are check-(a) rows, NOT escrow — the exact-reason
  // matches below keep them out.
  const boxEscrow = await one(pool,
    "SELECT COALESCE(SUM(b.amount),0) s FROM boxing_bets b JOIN boxing_bouts o ON o.id=b.bout_id WHERE o.status='booked'");
  const boxPosted = -(await sum(pool, "currency='cash' AND reason='boxing:bet'"));
  const boxWins = await sum(pool, "currency='cash' AND reason='boxing:bet:win'");
  const boxRefunds = await sum(pool, "currency='cash' AND reason='boxing:bet:refund'");
  const boxPurse = await sum(pool, "currency='cash' AND reason='boxing:purse:main'");
  const boxTake = -(await sum(pool, "currency='cash' AND reason='boxing:bet:take'"));
  const boxDeath = -(await sum(pool, "currency='cash' AND reason='boxing:bet:death'"));
  push('boxing bet escrow', boxEscrow, boxPosted - boxWins - boxRefunds - boxPurse - boxTake - boxDeath);

  // (f5) THE DEN'S BOOK (econ pass — the mint-on-top fix): the house's realized-profit accumulator
  // and its tip-outs each mirror the ledger EXACTLY. profit == PvE stakes − PvE payouts; distributed
  // == street cuts (NULL `casino:take` rows) + rakeback. The profit CAP itself (distributions never
  // exceed profit net of open 600:1/dog-odds liability) is enforced at pay time (denAvailable) and
  // regression-tested — a later jackpot can legitimately drive lifetime profit below what was
  // already tipped out, so the cap is not an end-state identity; these two are.
  const denRow = (await pool.query('SELECT profit, distributed FROM den_volume WHERE id=1')).rows[0];
  if (denRow) {
    const denBets = -(await sum(pool, "currency='cash' AND reason LIKE 'casino:bet:%'"));
    const denWins = await sum(pool, "currency='cash' AND reason LIKE 'casino:win:%'");
    push('den profit', Number(denRow.profit), denBets - denWins);
    const denTakes = -(await sum(pool, "currency='cash' AND reason='casino:take'"));
    const denRake = await sum(pool, "currency='cash' AND reason='casino:rakeback'");
    push('den distributions', Number(denRow.distributed), denTakes + denRake);
  }

  // (f6) THE POKER TOURNAMENT escrow (the boxing-bet-escrow twin, den step four): the pool held on
  // OPEN tournaments == buy-ins posted − prizes won − the house take (NULL 'casino:tourney:take':
  // half street tax + half burn) − refunds (a short field) − dead-entrant burns (NULL
  // 'casino:tourney:death'). These exact-reason matches sit UNDER the 'casino:bet:%'/'casino:win:%'
  // den-profit LIKE patterns, so a tournament's buyin/win never touch the PvE house book.
  const trEscrow = await one(pool, "SELECT COALESCE(SUM(pool),0) s FROM poker_tournaments WHERE status='open'");
  const trPosted = -(await sum(pool, "currency='cash' AND reason='casino:tourney:buyin'"));
  const trWins = await sum(pool, "currency='cash' AND reason='casino:tourney:win'");
  const trRefunds = await sum(pool, "currency='cash' AND reason='casino:tourney:refund'");
  const trTake = -(await sum(pool, "currency='cash' AND reason='casino:tourney:take'"));
  const trDeath = -(await sum(pool, "currency='cash' AND reason='casino:tourney:death'"));
  push('poker tourney escrow', trEscrow, trPosted - trWins - trRefunds - trTake - trDeath);

  // RING POKER ESCROW (casino step five): THE TABLE IS AN ESCROW — cash crosses the boundary only
  // at sit (in), leave (out), the rake (out, half → street tax / half burns), and a dead player's
  // stack burn (out). Pots pay seat STACKS internally, so Σ stacks + Σ live pots reconciles exactly.
  const ringEscrow = await one(pool, 'SELECT COALESCE(SUM(stack),0) s FROM poker_ring_seats')
    + await one(pool, 'SELECT COALESCE(SUM(pot),0) s FROM poker_tables');
  const ringSit = -(await sum(pool, "currency='cash' AND reason='casino:ring:sit'"));
  const ringLeave = await sum(pool, "currency='cash' AND reason='casino:ring:leave'");
  const ringTake = -(await sum(pool, "currency='cash' AND reason='casino:ring:take'"));
  const ringDeath = -(await sum(pool, "currency='cash' AND reason='casino:ring:death'"));
  push('ring poker escrow', ringEscrow, ringSit - ringLeave - ringTake - ringDeath);

  // (f7) THE GRAND PRIX escrow (the poker-tourney twin, street-races step three): the pool held on OPEN
  // grand prix == buy-ins posted − prizes won − refunds (a short grid) − the house take (NULL
  // 'race:gp:take': half street tax + half burn) − dead-entrant burns (NULL 'race:gp:death'). All ride
  // the 'race:' cash vocabulary; a pure competitive REDISTRIBUTION (no new faucet — unlike the PvE purse).
  const gpEscrow = await one(pool, "SELECT COALESCE(SUM(pool),0) s FROM grand_prix WHERE status='open'");
  const gpPosted = -(await sum(pool, "currency='cash' AND reason='race:gp:buyin'"));
  const gpWins = await sum(pool, "currency='cash' AND reason='race:gp:win'");
  const gpRefunds = await sum(pool, "currency='cash' AND reason='race:gp:refund'");
  const gpTake = -(await sum(pool, "currency='cash' AND reason='race:gp:take'"));
  const gpDeath = -(await sum(pool, "currency='cash' AND reason='race:gp:death'"));
  push('grand prix escrow', gpEscrow, gpPosted - gpWins - gpRefunds - gpTake - gpDeath);

  // (f8) THE STAKES escrow (the grand-prix twin, Stable step two): the pool held on OPEN stakes races ==
  // buy-ins posted − prizes won − refunds − the house take (NULL 'stable:stakes:take') − dead-entrant
  // burns (NULL 'stable:stakes:death'). All ride the 'stable:' cash vocabulary; a pure REDISTRIBUTION.
  const skEscrow = await one(pool, "SELECT COALESCE(SUM(pool),0) s FROM stakes_races WHERE status='open'");
  const skPosted = -(await sum(pool, "currency='cash' AND reason='stable:stakes:buyin'"));
  const skWins = await sum(pool, "currency='cash' AND reason='stable:stakes:win'");
  const skRefunds = await sum(pool, "currency='cash' AND reason='stable:stakes:refund'");
  const skTake = -(await sum(pool, "currency='cash' AND reason='stable:stakes:take'"));
  const skDeath = -(await sum(pool, "currency='cash' AND reason='stable:stakes:death'"));
  push('stakes escrow', skEscrow, skPosted - skWins - skRefunds - skTake - skDeath);

  // (f9) THE FUTURITY escrow (the boxing-bet-escrow twin, Track step four): the parimutuel BET pool held
  // on OPEN futurities == posted ('casino:futurity:bet') − winner payouts ('casino:futurity:win': stake
  // back + pro-rata cut) − refunds ('casino:futurity:refund': a scratched runner / one-sided book /
  // scrapped card) − the winning owner's promoter purse ('casino:futurity:purse') − the house vig (NULL
  // 'casino:futurity:take': half street tax + half burn) − dead-bettor burns (NULL 'casino:futurity:death').
  // The nomination fee ('casino:futurity:nom', a char'd sink → the buyback) is NOT escrow — a check-(a) row.
  // These exact-reason matches sit UNDER the den-book 'casino:bet:%'/'casino:win:%' LIKE patterns, so a
  // futurity never touches the PvE house book.
  const fuEscrow = await one(pool, "SELECT COALESCE(SUM(pool),0) s FROM futurities WHERE status='open'");
  const fuPosted = -(await sum(pool, "currency='cash' AND reason='casino:futurity:bet'"));
  const fuWins = await sum(pool, "currency='cash' AND reason='casino:futurity:win'");
  const fuRefunds = await sum(pool, "currency='cash' AND reason='casino:futurity:refund'");
  const fuPurse = await sum(pool, "currency='cash' AND reason='casino:futurity:purse'");
  const fuTake = -(await sum(pool, "currency='cash' AND reason='casino:futurity:take'"));
  const fuDeath = -(await sum(pool, "currency='cash' AND reason='casino:futurity:death'"));
  push('futurity escrow', fuEscrow, fuPosted - fuWins - fuRefunds - fuPurse - fuTake - fuDeath);

  // (g) UNKNOWN REASONS — any row outside the vocabulary is an unenumerated faucet/sink
  const unknown = [];
  for (const [cur, prefixes] of Object.entries(KNOWN_REASONS)) {
    const rows = (await pool.query('SELECT DISTINCT reason FROM transactions WHERE currency=$1', [cur])).rows;
    for (const r of rows)
      if (!prefixes.some((p) => r.reason === p || r.reason.startsWith(p))) unknown.push(`${cur}:${r.reason}`);
  }
  push('reason vocabulary', unknown.length, 0, 0, { unknown });

  const ok = checks.every((c) => c.ok);
  return { ok, checks }; // alerting is done by the runLedgerInvariants snapshot wrapper (on the pool)
}

// Alerting: a telemetry row always; a webhook when INVARIANT_WEBHOOK_URL is set. Exported + `kind`-tagged
// (red-team R6 A) so the worker can route the real-VALUE invariants (Vig extraction≤reserve, Bond
// anti-Ponzi) through the SAME founder alarm as the in-game §10.4 sweep — they had no automated alert.
export async function alertDrift(pool, failed, kind = 'ledger', retryDelaysMs = [1000, 4000]) {
  // preserve the original ledger telemetry event name (dashboards/ops key on it); tag vig/bond distinctly
  const event = kind === 'ledger' ? 'invariant_drift' : `${kind}_invariant_drift`;
  await pool.query('INSERT INTO telemetry (id, event, props) VALUES ($1,$2,$3)',
    [crypto.randomUUID(), event, JSON.stringify(failed)]);
  console.error(`🚨 ${kind === 'ledger' ? '§10.4 LEDGER' : kind.toUpperCase()} INVARIANT DRIFT:`, JSON.stringify(failed));
  if (process.env.INVARIANT_WEBHOOK_URL) {
    // RETRIED, with backoff (bulletproof pass, 2026-08-21). This is the single most important
    // outbound POST in the app — the alarm the whole invariant machinery exists to deliver — and it
    // was one transient Discord 502 away from being lost: the telemetry row and the console line
    // survive, but the thing a HUMAN sees does not, and the whole 2026-07-25 incident class is that
    // a line in a log nobody reads is not an alarm. Three attempts, 1s then 4s apart, still
    // swallowed at the end (an alarm must never take the worker's tick down with it — the safe()
    // argument, one layer in). `retryDelaysMs` is a parameter ONLY so the test can drive the retry
    // path without sleeping through real backoff (the getDaily `day` precedent); production callers
    // never pass it.
    const attempts = retryDelaysMs.length + 1;
    for (let i = 0; i < attempts; i++) {
      try {
        // `text` is what Slack incoming webhooks require; `content` is what Discord requires. Both REJECT
        // a body carrying neither (400) — and this function swallows that, so the original payload of
        // `{alert, failed}` alone meant the two services the deploy docs recommend would silently deliver
        // NOTHING: configured, no visible error, no alerts. The structured fields are kept alongside for
        // anything custom. test/hardening.js asserts both keys are present, since a missing one fails
        // exactly where nobody is looking.
        // AbortSignal.timeout (the verify.js pattern): a HUNG webhook endpoint would otherwise hold this
        // await for undici's ~300s default header timeout — and this runs inside worker sweeps, so one
        // hung endpoint stalls the whole tick behind an alarm that was supposed to be best-effort.
        const res = await fetch(process.env.INVARIANT_WEBHOOK_URL, { method: 'POST',
          headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({ alert: `${kind}_invariant_drift`, failed, text: webhookText(kind, failed), content: webhookText(kind, failed) }) });
        // fetch does NOT throw on an HTTP error status — a Discord 502 or a Slack 429 comes back as a
        // resolved response with ok=false, which is precisely the transient failure this loop exists
        // for. A non-retryable 400 gets retried too (twice, ~5s total): telling the codes apart buys
        // nothing worth the branch, and the payload-shape 400s have their own regression above.
        if (res && res.ok === false && i < attempts - 1) { await new Promise((r) => setTimeout(r, retryDelaysMs[i])); continue; }
        if (res && res.ok === false) console.error(`invariant webhook failed after ${attempts} attempts`, `HTTP ${res.status}`);
        break;
      } catch (e) {
        if (i === attempts - 1) console.error(`invariant webhook failed after ${attempts} attempts`, e.message);
        else await new Promise((r) => setTimeout(r, retryDelaysMs[i]));
      }
    }
  }
}

// One human-readable line per failed check, clamped under Discord's 2,000-char message limit. Every alert
// shape passed to alertDrift carries a `name`; the ledger ones add lhs/rhs/drift, so those are named
// explicitly and anything else falls back to its own JSON rather than printing "[object Object]".
export function webhookText(kind, failed = []) {
  // A drill must not read like an emergency. Without this the test alert arrives as "🚨 OMERTÀ — test
  // invariant drift", which is exactly the message someone would panic at — and the point of the drill
  // is to learn what a REAL one looks like, so it has to be unmistakably distinguishable from one.
  const head = kind === 'test' ? '✅ OMERTÀ — alert test. This is a DRILL: alerting works, nothing is wrong.'
    : kind === 'backup' ? '🚨 OMERTÀ — BACKUPS ARE NOT RUNNING'
      : `🚨 OMERTÀ — ${kind === 'ledger' ? '§10.4 ledger' : kind} invariant drift`;
  const lines = (Array.isArray(failed) ? failed : [failed]).map((f) => {
    if (!f || typeof f !== 'object') return `• ${String(f)}`;
    if (f.drift !== undefined) return `• ${f.name}: drift ${f.drift} (balances ${f.lhs} vs ledger ${f.rhs})`;
    const rest = Object.entries(f).filter(([k]) => k !== 'name').map(([k, v]) => `${k}=${v}`).join(', ');
    return `• ${f.name || 'check'}${rest ? `: ${rest}` : ''}`;
  });
  const body = `${head}\n${lines.join('\n')}`;
  return body.length > 1900 ? `${body.slice(0, 1880)}\n… (truncated)` : body;
}

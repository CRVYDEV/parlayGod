// §10.4 — the nightly ledger-invariant job. Value transfers, it is never minted:
// every bucket of value must reconcile against the enumerated faucet/sink reasons
// in the transactions ledger. Any drift beyond $1 (or one unit) — or any ledger
// row with a reason outside the known vocabulary — is an alert.
import crypto from 'node:crypto';
import { EMISSION } from './rules.js';

// The complete reason vocabulary, by currency. A row whose reason matches no
// prefix here is an unenumerated faucet/sink — the loudest possible §10.4 alarm.
const KNOWN_REASONS = {
  cash: ['crime:', 'racket:income', 'racket:upgrade', 'bank:interest', 'bank:', 'heal', 'checkin', 'travel', 'heist',
    'melt:tithe', 'fence', 'repair', 'craft:', 'goods:', 'racket:buy:', 'asset:', 'swap:', 'gun:buy:',
    'ammo:buy', 'gang:found', 'gang:tribute', 'gang:war', 'gang:dissolved', 'turf:seize:', 'jump:',
    'bounty:', 'bust:reward', 'whack:chop', 'whack:loot', 'death:', 'exchange:', 'crew:sales', 'deal:', 'makings:',
    'lab:', 'crew:hire', 'crew:wages', 'laylow', 'kitchen:', 'mission:', 'daily:', 'onboard:', 'social:', 'referral:', 'mod:confiscate', 'npchit:', 'safehouse',
    'gang:contract', 'bodyguard:', 'territory:', 'business:', 'path:', 'casino:', 'convoy:', 'market:', 'underworld:',
    'law:', 'world:', 'pen:', 'loan:', 'speakeasy:', 'boxing:', 'race:', 'port:', 'stable:',
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
    // COMMISSION step three: proposal deposits — treasury→escrow (`commission:proposal`, NULL char),
    // refunded on an enacted motion (`commission:refund`) or forfeited to the confiscation pool
    // (`commission:forfeit`) — reconciled by the treasury check (b) + the commission-escrow check
    'commission:'],
  omr: ['swap:', 'stake:reward', 'gear:mint:', 'vest:', 'lab:', 'cleanpapers', 'path:', 'mission:',
    'daily:all', 'referral:', 'family:weekly', 'gang:dissolved', 'withdraw:omr', 'vanity:', 'intel:', 'respec',
    'gang:tribute', 'whack:loot', 'plex:', 'prize:omr', 'law:jury', 'law:envelope', 'foundation:', 'rwa:', 'estate:', 'auction:', 'dividend:', 'emission:', 'tax:', 'megaproject:', 'kitchen:', 'bond:', 'business:spec', 'death:duty'],
  cb: ['crime:', 'craft:', 'gun:buy:', 'jump:', 'death:', 'exchange:', 'onboard:', 'cook:'],
  ammo: ['melt', 'melt:tithe', 'craft:ammo', 'ammo:buy', 'jump', 'fire', 'death:', 'exchange:', 'gang:dissolved', 'convoy:', 'world:', 'port:', 'contract:'],
};

const sum = async (pool, where) =>
  Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE ${where}`)).rows[0].s);
const one = async (pool, q) => Number((await pool.query(q)).rows[0].s);

// (red-team R6 B) Consistent-snapshot wrapper: the ~40 aggregate-vs-ledger reads must see ONE point
// in time. Without it, a player action committing between the two halves of a check (e.g. charWealth
// SUM then charLedger SUM) tears the read into a FALSE drift → a false webhook alarm at the founder.
// Run every read inside a single REPEATABLE READ, READ ONLY transaction; alert AFTER, on the pool.
export async function runLedgerInvariants(pool) {
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
    if (!res.ok) await alertDrift(pool, res.checks.filter((c) => !c.ok));
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
  push('gang treasuries', treasuries,
    tributeIn + titheIn + territoryIncome + territoryMuscleIn + tollIn + portTollIn + worldTributeIn + sovIncomeIn - warOut - seizeOut - dissolvedCash - contractOut - territoryOut - sovOut - fixOut - worldInvadeOut - worldReinforceOut + treasuryRefunds - proposalOut + proposalRefund);

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
    + auctionEscrow;
  // prize:omr is a Phase-2 mint: an in-game $OMR credit BACKED by hard $OMR the Vig moved into the
  // withdrawal reserve (src/vig.js payPrizes) — legal because real revenue backs every token.
  // Phase 4: stake:reward is NO LONGER a mint — rewards are paid from stake_pool (a transfer, both
  // sides inside omrBuckets), so staking contributes zero to net supply. It's out of the mint term.
  // THE STREET WAGE (value-creation pivot): emission:% is an enumerated, SCHEDULED mint —
  // the epoch budget + the endowment check below bound it; it is never discretionary.
  const omrMints = await sum(pool, "currency='omr' AND (reason LIKE 'mission:%' OR reason='prize:omr' OR reason LIKE 'emission:%')");
  // plex:* is a Phase-2 burn: a player paid a real-money fee from earned $OMR instead of ETH (the
  // PLEX bridge), so the $OMR leaves the game (deflationary, offsets emission).
  // law:jury is a Phase-3 burn: the war chest reaching the jury box leaves the game (deflationary).
  // rwa:invest (R1 — the Portfolio) is a $OMR BURN: clean $OMR washed into legit, death-proof
  // status holdings (personal → account bucket; family → gang omr_reserve). The shares are not a
  // §10.4 currency (a status collectible, the hitman-rep/seal precedent), so only the burn is here.
  // estate:* (THE ESTATE) is a $OMR BURN — the deep personal compound sink, account bucket, pure
  // status (like rwa:/vanity:); no new §10.4 bucket, only the burn term.
  // auction:win (THE AUCTION HOUSE) is a $OMR BURN — the winning bid leaves escrow and the game
  // (deflationary). bid/refund are transfers (escrow ↔ account, both inside omrBuckets), NOT here.
  // law:envelope (THE ENVELOPE) is a $OMR BURN — the standing graft (account bucket, the law:jury twin).
  // foundation:tier (THE FOUNDATION) is a $OMR BURN — the family charity, against the gang reserve bucket
  // (the vanity:gang:seal precedent; the reserve is already in omrBuckets, so only the burn term is new).
  // Tier-4 consignment: auction:take (the house cut) + auction:consign:fee (the listing fee) are $OMR
  // BURNS — added as EXACT matches. Do NOT widen reason='auction:win' to LIKE 'auction:%': that would
  // wrongly classify auction:bid/auction:refund/auction:consign (transfers) as burns and break conservation.
  const omrBurns = -(await sum(pool, "currency='omr' AND (reason LIKE 'vest:%' OR reason='cleanpapers' OR reason LIKE 'lab:%' OR reason LIKE 'gear:mint:%' OR reason LIKE 'path:%' OR reason='gang:dissolved' OR reason='withdraw:omr' OR reason LIKE 'vanity:%' OR reason LIKE 'intel:%' OR reason LIKE 'respec%' OR reason LIKE 'plex:%' OR reason='law:jury' OR reason='law:envelope' OR reason LIKE 'foundation:%' OR reason LIKE 'rwa:%' OR reason LIKE 'estate:%' OR reason='auction:win' OR reason='auction:take' OR reason='auction:consign:fee' OR reason='megaproject:omr' OR reason LIKE 'bond:%' OR reason LIKE 'business:spec%' OR reason='death:duty')"));
  push('$OMR conservation', omrBuckets, 20000 + omrMints - omrBurns, 0.001);

  // THE STREET WAGE — lifetime emission may NEVER exceed the fixed Emission Endowment
  // (the anti-Axie wall: the printer is hard-capped; overrun == the loudest alarm).
  const emitted = await sum(pool, "currency='omr' AND reason LIKE 'emission:%'");
  push('emission within endowment', Math.max(0, emitted - EMISSION.ENDOWMENT_OMR), 0, 0.001, { emitted, endowment: EMISSION.ENDOWMENT_OMR });

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
  push('car conservation', carsHeld, boosts - melts - fences - deathCars, 0);

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
export async function alertDrift(pool, failed, kind = 'ledger') {
  // preserve the original ledger telemetry event name (dashboards/ops key on it); tag vig/bond distinctly
  const event = kind === 'ledger' ? 'invariant_drift' : `${kind}_invariant_drift`;
  await pool.query('INSERT INTO telemetry (id, event, props) VALUES ($1,$2,$3)',
    [crypto.randomUUID(), event, JSON.stringify(failed)]);
  console.error(`🚨 ${kind === 'ledger' ? '§10.4 LEDGER' : kind.toUpperCase()} INVARIANT DRIFT:`, JSON.stringify(failed));
  if (process.env.INVARIANT_WEBHOOK_URL) {
    try {
      await fetch(process.env.INVARIANT_WEBHOOK_URL, { method: 'POST',
        headers: { 'content-type': 'application/json' },
        // `text` is what Slack incoming webhooks require; `content` is what Discord requires. Both REJECT
        // a body carrying neither (400) — and this function swallows that, so the original payload of
        // `{alert, failed}` alone meant the two services the deploy docs recommend would silently deliver
        // NOTHING: configured, no visible error, no alerts. The structured fields are kept alongside for
        // anything custom. test/hardening.js asserts both keys are present, since a missing one fails
        // exactly where nobody is looking.
        body: JSON.stringify({ alert: `${kind}_invariant_drift`, failed, text: webhookText(kind, failed), content: webhookText(kind, failed) }) });
    } catch (e) { console.error('invariant webhook failed', e.message); }
  }
}

// One human-readable line per failed check, clamped under Discord's 2,000-char message limit. Every alert
// shape passed to alertDrift carries a `name`; the ledger ones add lhs/rhs/drift, so those are named
// explicitly and anything else falls back to its own JSON rather than printing "[object Object]".
export function webhookText(kind, failed = []) {
  const head = kind === 'backup' ? '🚨 OMERTÀ — BACKUPS ARE NOT RUNNING'
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

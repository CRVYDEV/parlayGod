// THE LEDGER — the Season Pass reward track (design omerta-eth-store-design.md deferred item). A
// daily-claim "battle pass": while the pass is active (bought in the Store for ETH), claim the NEXT
// tier once per ~daily window, escalating rewards. Anti-pay-to-win + §10.4-safe: rewards are STATUS (a
// street title), CONSUMABLES (revive tokens out-of-band, an energy refill — not currency), and a small
// $OMR STIPEND on a few tiers paid through the EXISTING backed prize-pool rail (payPrizes → `prize:omr`,
// pool-bounded — a redistribution the pass's own buyback share funds, never an unbacked mint).
//
// Self-contained: the track advances only on claim (no touchpoints in other modules — lowest risk).
// The $OMR stipend is paid by the ROUTE post-commit via Vig.payPrizes (its own connection, backed +
// pool-bounded) — claimPass returns the owed amount, so no vig_prize_pool lock nests inside the
// withCharacter txn (which would invert payPrizes' singleton→account lock order). Account-level state
// (pass_tier/pass_at) → the track SURVIVES DEATH (the heir keeps claiming what the pass paid for).
import { GameError, ledger } from './game.js';
import { fundReserve } from './chain.js';
import { PASS, passClaimMs, passActive, passPrestigeOf, levelOf, assetEnergyCap } from './rules.js';

const round6 = (x) => Math.round(x * 1e6) / 1e6;

const rewardText = (r) => {
  const bits = [];
  if (r.title) bits.push(`the title "${r.title}"`);
  if (r.respawnTokens) bits.push(`${r.respawnTokens} revive${r.respawnTokens > 1 ? 's' : ''}`);
  if (r.energy) bits.push('a full tank');
  if (r.omr) bits.push(`${r.omr} $OMR`);
  return bits.join(' + ');
};

// GET /v1/pass — the Ledger: your tier, the track, the claim cooldown, the stipend pool.
export async function passBoard(pool, accountId) {
  const a = (await pool.query(
    'SELECT pass_until, pass_tier, pass_at, pass_owed, pass_seasons FROM account_persistent WHERE account_id=$1', [accountId])).rows[0] || {};
  const now = Date.now();
  const active = passActive(a, now);
  const tier = Number(a.pass_tier || 0);
  const cd = a.pass_at ? Math.max(0, Math.ceil((new Date(a.pass_at).getTime() + passClaimMs() - now) / 1000)) : 0;
  const complete = tier >= PASS.TRACK.length;
  const poolBal = Number((await pool.query('SELECT balance FROM vig_prize_pool WHERE id=1')).rows[0]?.balance || 0);
  const seasons = Number(a.pass_seasons || 0);   // THE LEDGER PRESTIGE — lifetime tracks completed (Tier-4)
  const prIdx = passPrestigeOf(seasons);
  return {
    active, passSeconds: a.pass_until ? Math.max(0, Math.ceil((new Date(a.pass_until).getTime() - now) / 1000)) : 0,
    tier, of: PASS.TRACK.length, complete,
    claimable: active && !complete && cd === 0,
    cooldownSeconds: cd,
    track: PASS.TRACK.map((t, i) => ({ tier: t.tier, reward: rewardText(t.reward), claimed: i < tier, next: i === tier })),
    stipendPoolOmr: Math.round(poolBal * 100) / 100,
    stipendOwed: round6(Number(a.pass_owed || 0)), // accrued $OMR not yet paid (paid as the pool funds)
    seasons, prestigeRank: prIdx, prestigeName: PASS.PRESTIGE_RANKS[prIdx].name, // the Ledger prestige axis
    note: active ? null : 'Buy a Season Pass in the Store to unlock the Ledger track.',
  };
}

// POST /v1/pass/claim — claim the next tier (once per ~daily window). Grants status/consumables in the
// caller's txn; the $OMR stipend (if any) is returned as `stipendOmr` and paid by the route via the
// backed prize rail post-commit. Runs under withCharacter (h.acct is the account row).
export async function claimPass(ch, client, h) {
  const a = h.acct;
  if (!passActive(a)) throw new GameError('no_pass', 'The Ledger is for pass holders — grab a Season Pass in the Store.');
  const tier = Number(a.pass_tier || 0);
  const entry = PASS.TRACK[tier]; // TRACK is 0-indexed: tier 0 claimed → next is TRACK[0]
  if (!entry) throw new GameError('complete', "You've claimed the whole Ledger this season.");
  const now = Date.now();
  if (a.pass_at && new Date(a.pass_at).getTime() + passClaimMs() > now)
    throw new GameError('cooldown', 'Come back later for the next mark on the Ledger.');
  const r = entry.reward, granted = {};
  if (r.title) { ch.title = r.title; granted.title = r.title; }                          // status (character title slot)
  if (r.respawnTokens) { a.respawn_tokens = Number(a.respawn_tokens || 0) + r.respawnTokens; granted.respawnTokens = r.respawnTokens; } // account (persistAccount commits)
  if (r.energy) {                                                                          // consumable (not §10.4)
    const maxE = 50 + 2 * levelOf(Number(ch.respect)) + assetEnergyCap(h.owned.assets || []);
    ch.energy = maxE; granted.energy = maxE;
  }
  // advance the track + stamp the daily cooldown + ACCRUE any $OMR stipend as OWED — all in ONE txn
  // (direct SQL; persistAccount manages none of these columns, so no clobber). The owe is a durable
  // promise, NOT currency (no bucket) — the actual backed mint is settlePassStipend's prize:omr. So a
  // dry/contended pool never consumes the reward and a payout failure never mis-advances the track.
  const owe = r.omr || 0, nt = tier + 1;
  await client.query('UPDATE account_persistent SET pass_tier=$2, pass_at=$3, pass_owed = pass_owed + $4 WHERE account_id=$1',
    [ch.account_id, nt, new Date(now), owe]);
  a.pass_tier = nt; a.pass_at = new Date(now); a.pass_owed = round6(Number(a.pass_owed || 0) + owe);
  await h.track(client, ch.account_id, 'pass_claim', { tier: nt, owe });
  return { ok: true, tier: nt, reward: rewardText(r), granted, stipendOwed: owe, owed: a.pass_owed, complete: nt >= PASS.TRACK.length };
}

// Pay down an account's accrued Ledger stipend from the BACKED prize pool (the payPrizes body + an
// owed-decrement, atomic). Standalone (not nested in withCharacter), so it locks the pool singleton
// FIRST then the account — the SAME order as payPrizes/runVigBuyback, so no AB-BA deadlock. Pool-
// bounded (pays min(owed, balance)); credits prize:omr (a §10.4-legal, backed faucet) and moves the
// same $OMR pool→reserve (fundReserve, post-commit) so it stays fully backed + extractable. Called
// best-effort by the claim route + swept by the worker, so an owed stipend is ALWAYS eventually paid.
export async function settlePassStipend(pool, accountId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pp = (await client.query('SELECT balance FROM vig_prize_pool WHERE id=1 FOR UPDATE')).rows[0];
    const acct = (await client.query('SELECT pass_owed FROM account_persistent WHERE account_id=$1 FOR UPDATE', [accountId])).rows[0];
    if (!acct) { await client.query('COMMIT'); return { paid: 0, owed: 0 }; }
    const owed = round6(Number(acct.pass_owed || 0));
    const pay = round6(Math.min(owed, round6(Number(pp?.balance || 0))));
    if (!(pay > 0)) { await client.query('COMMIT'); return { paid: 0, owed }; } // nothing owed, or the pool is dry — try again when it funds
    await client.query('UPDATE account_persistent SET omr = omr + $2, pass_owed = pass_owed - $2 WHERE account_id=$1', [accountId, pay]);
    await ledger(client, { accountId, currency: 'omr', amount: pay, reason: 'prize:omr' }); // backed below
    await client.query('UPDATE vig_prize_pool SET balance = balance - $1, paid_total = paid_total + $1 WHERE id=1', [pay]);
    await client.query('COMMIT');
    await fundReserve(pool, pay); // back the freshly-credited $OMR so it stays extractable (the payPrizes pattern)
    return { paid: pay, owed: round6(owed - pay) };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// Worker sweep: pay down every account's outstanding Ledger stipend as the pool funds (the safety net
// so an owed stipend is paid even if the claim-time settle failed or the pool was dry then).
export async function sweepPassStipends(pool) {
  const rows = (await pool.query('SELECT account_id FROM account_persistent WHERE pass_owed > 0')).rows;
  let paid = 0;
  for (const r of rows) paid = round6(paid + (await settlePassStipend(pool, r.account_id)).paid);
  return { paid, accounts: rows.length };
}

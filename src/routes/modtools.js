// Mod tools — §10.3 moderation, the ops dashboard reads and the chain/revenue levers
// Extracted verbatim from server.js — handler bodies are unchanged. The registrar takes the shared
// closure it used to read directly (pool, auth), so nothing about what is mounted or how it is
// authenticated moves with it; test/routes.js asserts the mounted surface is identical either way.
import crypto from 'node:crypto';
import { runLedgerInvariants, alertDrift } from '../invariants.js';
import { TAX, withdrawTaxBps } from '../rules.js';
import * as Bonds from '../bonds.js';
import * as Chain from '../chain.js';
import * as Desk from '../desk.js';
import * as Fees from '../fees.js';
import * as G from '../game.js';
import * as Loans from '../loans.js';
import * as Ops from '../ops.js';
import { opsEngagement } from '../engagement.js';
import * as Treasury from '../treasury.js';
import * as S from '../social.js';
import * as Store from '../store.js';
import * as Vig from '../vig.js';
import * as W from '../growth.js';

export function register(app, { pool, auth, modAuth, closeAccountSockets }) {
  // AUDIT-full-system-v2 D-MED2: real-ETH revenue (vig/pol/rwa) is booked ONLY from the on-chain
  // watcher observing a genuine event — a mod comp/QA route must never fabricate it. So mod routes
  // pass their caller-supplied txHash through this gate: it survives only when ALLOW_MOD_REAL_REVENUE=on
  // (a QA-only escape hatch, default OFF), so a production comp can't book unbacked withdrawal reserve.
  const modRealTxHash = (req) => (process.env.ALLOW_MOD_REAL_REVENUE === 'on' ? (req.body?.txHash || null) : null);

    app.post('/v1/mod/loanhouse/fund', { preHandler: modAuth }, async (req) =>
      Loans.fundLoanHouse(pool, req.body?.amount));
    app.post('/v1/mod/ban', { preHandler: modAuth }, async (req) => {
      const { accountId, reason } = req.body || {};
      if (!accountId) throw new G.GameError('args', 'accountId required.');
      await pool.query("UPDATE accounts SET status='banned' WHERE id=$1", [accountId]);
      await pool.query('INSERT INTO bans (account_id, kind, reason, by_mod) VALUES ($1,$2,$3,$4)',
        [accountId, 'ban', reason || null, 'mod']);
      closeAccountSockets(accountId, 4003, 'banned'); // red-team R4 F1: cut the live intel feed now, not at their leisure
      return { ok: true };
    });
    // BLUE-TEAM M3: revoke an account's outstanding tokens WITHOUT a full ban — the lighter tool for a
    // compromised or abusive account (bump token_version so every token issued before now is invalidated
    // on the mutating auth path). The account can still sign in fresh; a ban is the heavier hammer.
    app.post('/v1/mod/revoke', { preHandler: modAuth }, async (req) => {
      const { accountId } = req.body || {};
      if (!accountId) throw new G.GameError('args', 'accountId required.');
      await pool.query('UPDATE accounts SET token_version = token_version + 1 WHERE id=$1', [accountId]);
      closeAccountSockets(accountId, 4008, 'token_revoked'); // cut any live socket too
      return { ok: true };
    });
    app.post('/v1/mod/kill', { preHandler: modAuth }, async (req) => {
      // runs the §7.9 estate without a killer ("THE COMMISSION")
      const { characterId, reason } = req.body || {};
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const victim = (await client.query('SELECT * FROM characters WHERE id=$1 AND alive FOR UPDATE', [characterId])).rows[0];
        if (!victim) throw new G.GameError('no_target', 'No living character by that id.');
        const victimAcct = (await client.query('SELECT * FROM account_persistent WHERE account_id=$1 FOR UPDATE', [victim.account_id])).rows[0];
        const victimOwned = await G.loadOwned(client, victim);
        const h = { ledger: G.ledger, notify: G.notify, victimAcct, victimOwned };
        const estate = await S.runEstate(client, h, victim, 'THE COMMISSION'); // tracks the death itself
        // this hand-rolled txn isn't wrapped by persistAccount, so it must persist every account field
        // runEstate mutates in memory: prestige, deaths, and (L2a) the death-duty $OMR burn (the ledger
        // row is written inside runEstate; without omr here the burn drifts §10.4 on a mod-kill). The duty
        // reaches liquid AND unbonding, so both columns ride.
        await client.query('UPDATE account_persistent SET prestige=$2, deaths=$3, omr=$4, unbonding=$5 WHERE account_id=$1',
          [victim.account_id, victimAcct.prestige, victimAcct.deaths, victimAcct.omr, victimAcct.unbonding ?? 0]);
        if (reason) await G.track(client, victim.account_id, 'mod_kill_reason', { reason });
        await client.query('COMMIT');
        closeAccountSockets(victim.account_id, 4009, 'gang_changed'); // R26 WS: the heir is gangless — cut the dead street's stale gang: feed
        return { ok: true, heirId: estate.heirId };
      // runEstate → removeMember can hit a war-partner AB-BA (40P01); this hand-rolled txn isn't
      // wrapped by withCharacter, so map it to a clean retry here too (audit MED) instead of a 500.
      } catch (e) { await client.query('ROLLBACK'); throw G.deadlockToRetry(e); }
      finally { client.release(); }
    });
    app.post('/v1/mod/confiscate', { preHandler: modAuth }, async (req) => {
      // seized cash recycles into the street-tax pool (next buyback)
      const { characterId, amount } = req.body || {};
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const ch = (await client.query('SELECT * FROM characters WHERE id=$1 AND alive FOR UPDATE', [characterId])).rows[0];
        if (!ch) throw new G.GameError('no_target', 'No living character by that id.');
        // clamp to [0, pocket] (audit M2): a negative `amount` was truthy, so `cash - (-x)` MINTED
        // cash to the player and drained the street-tax pool below zero (a §10.4-invisible mint into
        // an unaudited buffer). A MISSING amount keeps the documented "confiscate all" default;
        // an explicit invalid/negative amount confiscates NOTHING (never mints, never "all" on a typo).
        const pocket = Math.max(0, Math.floor(Number(ch.cash)));
        let want;
        if (amount === undefined || amount === null || amount === '') want = pocket; // "confiscate all"
        else { const n = Number(amount); want = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; }
        const amt = Math.max(0, Math.min(want, pocket));
        await client.query('UPDATE characters SET cash = cash - $2 WHERE id=$1', [characterId, amt]);
        await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [amt]);
        await G.ledger(client, { characterId, currency: 'cash', amount: -amt, reason: 'mod:confiscate' });
        await client.query('COMMIT');
        return { ok: true, confiscated: amt };
      } catch (e) { await client.query('ROLLBACK'); throw e; }
      finally { client.release(); }
    });
    app.post('/v1/mod/invites', { preHandler: modAuth }, async (req) => {
      const count = Math.min(100, Math.max(1, Math.floor(Number(req.body?.count) || 1)));
      const uses = Math.max(1, Math.floor(Number(req.body?.uses) || 1));
      const codes = [];
      for (let i = 0; i < count; i++) {
        const code = crypto.randomBytes(6).toString('hex');
        await pool.query('INSERT INTO invite_codes (code, uses_left, created_by) VALUES ($1,$2,$3)', [code, uses, 'mod']);
        codes.push(code);
      }
      return { codes, uses };
    });
    // Start a time-boxed RECRUITMENT DRIVE — referral CASH payouts multiply for the window. Also readable.
    app.post('/v1/mod/referral/push', { preHandler: modAuth }, async (req) =>
      G.startReferralPush(pool, req.body?.hours, req.body?.mult));
    app.get('/v1/mod/referral/push', { preHandler: modAuth }, async () => G.referralPushStatus(pool));
    app.get('/v1/mod/invariants', { preHandler: modAuth }, async () => runLedgerInvariants(pool));
    // FIRE A TEST ALERT. Setting INVARIANT_WEBHOOK_URL is otherwise unverifiable: you find out whether
    // it works the night the economy actually drifts, which is the worst possible moment to discover a
    // typo. This posts through the SAME alertDrift path the real alarms use — same payload, same Slack
    // `text` / Discord `content` keys, same swallowed-error behaviour — so a message arriving in the
    // channel proves the whole chain, not just that the URL is a valid URL. It writes a telemetry row
    // like any alert (visible in the activity feed) and moves no value.
    app.post('/v1/mod/alert/test', { preHandler: modAuth }, async () => {
      const configured = !!process.env.INVARIANT_WEBHOOK_URL;
      await alertDrift(pool, [{ name: 'test alert', note: 'fired from /admin — this is a drill, nothing is wrong' }], 'test');
      // `configured` is the honest answer to "did anything actually leave the building". alertDrift
      // swallows a failed POST on purpose (an alarm must never take down the caller), so a 200 here
      // means "we tried", not "it arrived" — say so rather than implying delivery.
      return { ok: true, configured,
        message: configured ? 'Test alert sent. If nothing arrives within a few seconds the URL is wrong or the channel was deleted — check the service logs for "invariant webhook failed".'
          : 'INVARIANT_WEBHOOK_URL is not set on THIS service, so the alert only reached the log. Set it and redeploy.' };
    });
    app.get('/v1/mod/funnel', { preHandler: modAuth }, async () => W.funnelStats(pool)); // new-player onboarding drop-off
    app.get('/v1/mod/overview', { preHandler: modAuth }, async () => Ops.opsOverview(pool)); // live-ops economy + player snapshot
    app.get('/v1/mod/activity', { preHandler: modAuth }, async (req) => Ops.opsActivity(pool, req.query?.limit)); // the live event feed
    app.get('/v1/mod/coach', { preHandler: modAuth }, async () => Ops.opsCoach(pool)); // the live coach census — where every active player is stuck
    app.get('/v1/mod/integrations', { preHandler: modAuth }, async () => Ops.integrationsStatus()); // the dormant retention/funnel wiring: live-vs-off + activation steps (env presence only, no secrets)
    // which systems anyone actually uses + whether players come back. Reads telemetry that was
    // already being written — the reader was the missing half, not the instrumentation.
    app.get('/v1/mod/engagement', { preHandler: modAuth }, async (req) => opsEngagement(pool, req.query?.days));
    app.get('/v1/mod/audit', { preHandler: modAuth }, async (req) => {
      const cid = req.query?.characterId;
      const tx = await pool.query('SELECT * FROM transactions WHERE ($1::text IS NULL OR character_id=$1) ORDER BY at DESC LIMIT 100', [cid || null]);
      const rng = await pool.query('SELECT * FROM rng_audit WHERE ($1::text IS NULL OR character_id=$1) ORDER BY at DESC LIMIT 100', [cid || null]);
      return { transactions: tx.rows, rng: rng.rows };
    });
    // the ops/invariant view + the oracle keeper watchdog's live verdict (the /admin surface —
    // a silent keeper halt must read as a state on the founder's screen, not just a webhook)
    app.get('/v1/mod/bonds', { preHandler: modAuth }, async () =>
      ({ ...(await Bonds.bondStatus(pool)), oracle: await Chain.bondOracleHealth() }));
    // THE TREASURY (omerta-stock-layer-retirement.md). The float's buy-bot seat is GONE with the
    // stock layer — nothing buys units, so there is nothing to spend and no `allocated <= held` to
    // reconcile. What is left is the ETH inflow ledger and the sell-tax ingest that feeds it.
    app.get('/v1/mod/treasury', { preHandler: modAuth }, async () => Treasury.runTreasuryInvariants(pool));
    // ingest a DEX sell-tax episode (a `SellTaxTaken` log on mainnet). The modRealTxHash gate stands:
    // a simulate records the episode for QA but books ZERO revenue, so a comp can never assert the
    // treasury received ETH it did not.
    app.post('/v1/mod/treasury/tax', { preHandler: modAuth }, async (req) =>
      Treasury.recordSellTax(pool, { ref: req.body?.ref, omrTaxed: req.body?.omrTaxed, priceOmrPerEth: req.body?.price, txHash: modRealTxHash(req) }));
    // THE DESK (economy v3 step 3). `/desk` is the real-value invariant — the ETH side of the daily
    // auction (the $OMR side is §10.4's `desk sales ledgered`). `/desk/open` forces today's auction
    // rather than waiting for the worker tick, and `/desk/fill` is the QA/comp purchase path until
    // the on-chain leg is wired (the Store's `mod/store/grant` precedent). The modRealTxHash gate
    // stands on the fill for exactly the same reason it stands on the bond: the $OMR side of a comp
    // is real (a transfer off a shelf we hold, so it can be), but "the desk received this much ETH"
    // must never be assertable by a mod call.
    app.get('/v1/mod/desk', { preHandler: modAuth }, async () => Desk.runDeskInvariants(pool));
    app.post('/v1/mod/desk/open', { preHandler: modAuth }, async () => Desk.openAuction(pool));
    app.post('/v1/mod/desk/fill', { preHandler: modAuth }, async (req) =>
      Desk.recordAuctionBuy(pool, { ref: req.body?.ref, accountId: req.body?.account,
        omr: req.body?.omr, txHash: modRealTxHash(req) }));
    // THE BUY SIDE (step 4). `/desk/fees` ingests a POL-fee collection — the buyback's ONLY budget,
    // and a comp books ZERO, because that budget is precisely what bounds the buy side. `/desk/buy`
    // is the bot's seat until the DEX leg is wired: it refuses above the band's LOWER edge, refuses
    // below the fat-finger floor, and never spends more than the pool earned.
    app.post('/v1/mod/desk/fees', { preHandler: modAuth }, async (req) =>
      Desk.recordPolFees(pool, { ref: req.body?.ref, eth: req.body?.eth, txHash: modRealTxHash(req) }));
    app.post('/v1/mod/desk/buy', { preHandler: modAuth }, async (req) =>
      Desk.runDeskBuyback(pool, { ref: req.body?.ref, ethToSpend: req.body?.eth,
        priceEthPerOmr: req.body?.price, txHash: modRealTxHash(req) }));
    app.post('/v1/mod/bond/fund', { preHandler: modAuth }, async (req) => Bonds.fundBondTranche(pool, req.body?.omr)); // top up the tranche
    app.post('/v1/mod/bond/simulate', { preHandler: modAuth }, async (req) => // QA/comp until the paywall (the Store precedent)
      // No txHash = a pure comp: books the bond + OMR tranche but NO real-ETH Vig/POL accounting (audit
      // MED — else a comp fabricates Vig revenue the buyback spends, unbacking the withdrawal reserve).
      // AUDIT-full-system-v2 D-MED2: real-ETH revenue must ONLY come from the on-chain watcher observing
      // a genuine event — never a caller-supplied txHash on a mod route. So the route STRIPS txHash unless
      // ALLOW_MOD_REAL_REVENUE=on (a QA-only escape hatch, default OFF — the X_TRUST_USER_TOKEN posture),
      // making the production comp path incapable of booking real revenue no matter what the caller sends.
      Bonds.recordBond(pool, { nonce: req.body?.nonce, accountId: req.body?.account, payer: req.body?.payer, principalEth: req.body?.principalEth, priceOmrPerEth: req.body?.price, discountBps: req.body?.discountBps, txHash: modRealTxHash(req) }));
    // Mod/ops: mirror an on-chain tranche funding into the reserve (drains the queue),
    // read the reserve gauge, and (for tests/ops) mark a voucher claimed.
    app.post('/v1/mod/reserve/fund', { preHandler: modAuth }, async (req) => Chain.fundReserve(pool, req.body?.amount));
    app.get('/v1/mod/reserve', { preHandler: modAuth }, async () => Chain.reserveStatus(pool));
    app.post('/v1/mod/reserve/claimed', { preHandler: modAuth }, async (req) => Chain.markClaimed(pool, Number(req.body?.nonce)));
    // Ops/manual reconciliation of an on-chain payment (the worker's watcher does this live from
    // MintFeePaid/RespawnFeePaid events; this endpoint is the manual + test path for the same call).
    app.post('/v1/mod/fees/record', { preHandler: modAuth }, async (req) =>
      Fees.recordFeePayment(pool, { nonce: req.body?.nonce, kind: req.body?.kind,
        payer: req.body?.payer, amountWei: req.body?.amountWei, txHash: modRealTxHash(req) })); // D-MED2: strip caller txHash unless the QA flag is set
    // Mod/ops: the Vig gauge + the extraction-≤-inflow invariant, and the buyback trigger (on
    // mainnet the DEX bot runs this with a TWAP price; here it's the manual/test path).
    app.get('/v1/mod/vig', { preHandler: modAuth }, async () =>
      ({ status: await Vig.vigStatus(pool), invariants: await Vig.runVigInvariants(pool) }));
    app.post('/v1/mod/vig/buyback', { preHandler: modAuth }, async (req) =>
      Vig.runVigBuyback(pool, { priceOmrPerEth: req.body?.priceOmrPerEth, maxEth: req.body?.maxEth }));
    app.post('/v1/mod/vig/prizes', { preHandler: modAuth }, async (req) => Vig.payPrizes(pool, req.body?.winners));
    // Mod/ops: the founder's three-way revenue split (founder / buyback / RWA), and the comp/simulate
    // path — drives recordStorePurchase with a synthetic nonce (for comps, QA, and until the paywall
    // ships). `nonce` must be unique; a duplicate is the idempotent no-op.
    app.get('/v1/mod/revenue', { preHandler: modAuth }, async () => Store.revenueStatus(pool));
    app.post('/v1/mod/store/grant', { preHandler: modAuth }, async (req) =>
      Store.recordStorePurchase(pool, { nonce: req.body?.nonce, sku: req.body?.sku,
        payer: req.body?.payer, amountWei: req.body?.amountWei, txHash: modRealTxHash(req) })); // D-MED2: strip caller txHash unless the QA flag is set
    // Gauge: pool balance + effective-APY runway; and an ops/test top-up (the buyback funds it live).
    // THE DEV FUND — the founder's revenue bucket (fed by the withdrawal exit toll's tax:dev share).
    app.get('/v1/mod/dev', { preHandler: modAuth }, async () => {
      const d = (await pool.query('SELECT omr, lifetime FROM dev_fund WHERE id=1')).rows[0] || { omr: 0, lifetime: 0 };
      return { omr: Number(d.omr), lifetime: Number(d.lifetime), taxBps: withdrawTaxBps(), devBps: TAX.DEV_BPS };
    });
    // claim the dev fund to an account (a bucket TRANSFER — tax:dev:claim rides the tax: vocabulary,
    // never a mint); the founder then withdraws like any player (paying the toll like anyone).
    app.post('/v1/mod/dev/claim', { preHandler: modAuth }, async (req) => {
      const accountId = String(req.body?.accountId || '');
      if (!accountId) return { error: 'account', message: 'accountId required' };
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const acct = (await client.query('SELECT account_id FROM account_persistent WHERE account_id=$1 FOR UPDATE', [accountId])).rows[0];
        if (!acct) { await client.query('ROLLBACK'); return { error: 'no_account' }; }
        const d = (await client.query('SELECT omr FROM dev_fund WHERE id=1 FOR UPDATE')).rows[0];
        const amt = Number(d?.omr || 0);
        if (!(amt > 0)) { await client.query('ROLLBACK'); return { error: 'empty', message: 'nothing to claim' }; }
        await client.query('UPDATE dev_fund SET omr = 0 WHERE id=1');
        await client.query('UPDATE account_persistent SET omr = omr + $2 WHERE account_id=$1', [accountId, amt]);
        await client.query('INSERT INTO transactions (id, account_id, currency, amount, reason, counterparty) VALUES ($1,$2,$3,$4,$5,$6)',
          [crypto.randomUUID(), accountId, 'omr', amt, 'tax:dev:claim', 'dev_fund']);
        await client.query('COMMIT');
        return { claimed: amt };
      } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
      finally { client.release(); }
    });
    app.get('/v1/mod/emission', { preHandler: modAuth }, async () => {
      const sp = (await pool.query('SELECT balance, lifetime_funded, lifetime_paid FROM stake_pool WHERE id=1')).rows[0] || {};
      const staked = Number((await pool.query('SELECT COALESCE(SUM(staked),0) s FROM account_persistent')).rows[0].s);
      const pending = Number((await pool.query('SELECT COALESCE(SUM(rewards),0) s FROM account_persistent')).rows[0].s);
      return { poolBalance: Number(sp.balance || 0), lifetimeFunded: Number(sp.lifetime_funded || 0),
        lifetimePaid: Number(sp.lifetime_paid || 0), totalStaked: staked, pendingRewards: pending,
        backed: pending > 0 ? Math.min(1, Number(sp.balance || 0) / pending) : 1 };
    });
    // Ops top-up: MOVE $OMR from the event fund into the staking pool (a §10.4 transfer, both
    // buckets inside the $OMR conservation set — never a mint). The buyback funds the pool live;
    // this is the manual twin for moving surplus event-fund $OMR into staker yield.
    app.post('/v1/mod/emission/fund', { preHandler: modAuth }, async (req) => {
      const amt = Number(req.body?.amount);
      if (!(amt > 0)) throw new G.GameError('amount', 'Positive amounts only.');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const f = (await client.query('SELECT fund FROM street_tax WHERE id=1 FOR UPDATE')).rows[0];
        if (Number(f.fund) < amt) throw new G.GameError('fund', `The event fund holds ${Math.floor(Number(f.fund))} $OMR — not ${amt}.`);
        await client.query('UPDATE street_tax SET fund = fund - $1 WHERE id=1', [amt]);
        await client.query('UPDATE stake_pool SET balance = balance + $1, lifetime_funded = lifetime_funded + $1 WHERE id=1', [amt]);
        await client.query('COMMIT');
        return { ok: true, funded: amt, fromEventFund: true };
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    });
}

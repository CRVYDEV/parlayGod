// ── THE COMMUNITY DROP — G-3's claim rail (D1 variant b: in-game credit via SIWE) ──
//
// The launch sequence's airdrop (omerta-launch-sequence-design.md G-3), built as the RECOMMENDED
// variant: the claim page links a wallet (the SIWE rail, live today), verifies it against the
// published allocation dataset, and credits IN-GAME $OMR — which converts the drop from a token
// scatter into USER ACQUISITION (every claimant is a registered account standing inside the game,
// and the claimed value is extractable only through the audited rail: mint gate → toll → surcharge).
// "Unclaimed" never left the Safe at all, which is also why THE CLAWBACK needs no function here —
// it is the window closing (`drop_state.closes_at` passing), the design's own argument for (b).
//
// THE WHITELIST rides the same row: a snapshotted wallet's claim also grants ONE free identity mint
// (`mint_credits += 1`), consumed on use, never repeated — and the grant marks the account
// (`drop_free_mint`, direct SQL, off persistAccount's positional list) so the TRANCHE COUNTER can
// exclude it: the published schedule indexes PAID mints only (G-3 rule 2 — a whitelist wave must
// not push paid minters up tiers). An already-minted claimant gets the $OMR and no dead credit
// (the payPackagePlex MED-1 lesson: never grant an unspendable entitlement).
//
// §10.4: `drop:claim` is an enumerated $OMR MINT (in `omrMints` + the `drop:` vocabulary), backed
// by the Safe's genesis reserve exactly like `mission:%` — hard $OMR that never entered the in-game
// buckets until the claim. The `drop claims ledgered` check (invariants.js) reconciles the minted
// total against the claimed allocation rows, so a credit with no allocation behind it trips the
// §10.4 sweep. The free-mint waiver moves no value (an entitlement — the fees.js precedent).
//
// Anti-Sybil: the SNAPSHOT is the bound (a historical block cannot be farmed), so there is no
// agent/level gate here — eligibility is the wallet, once, ever. Amounts stay SEALED until the
// window opens (the board reveals your row only while claims are open, or after you claimed).
import { GameError } from './game.js';

const num = (v) => Number(v || 0);
const isWallet = (w) => /^0x[0-9a-f]{40}$/.test(w);

const state = async (client) =>
  (await client.query('SELECT opens_at, closes_at FROM drop_state WHERE id=1')).rows[0] || {};
const windowOf = (st, now = Date.now()) => {
  const opens = st.opens_at ? new Date(st.opens_at).getTime() : null;
  const closes = st.closes_at ? new Date(st.closes_at).getTime() : null;
  const announced = opens != null && closes != null;
  return { announced, opens, closes, open: announced && now >= opens && now < closes };
};
const parseCommunities = (s) => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };

// ── THE BOARD (GET /v1/drop, readCharacter) — a STABLE key set in every state (the dormantView
// lesson: a missing key and a null key are different things to a client). Your row is revealed only
// while the window is OPEN, or after YOU claimed it (your own history); before open it stays sealed. ──
export async function dropBoard(ch, client, h) {
  const w = windowOf(await state(client));
  const now = Date.now();
  const base = {
    announced: w.announced, open: w.open,
    opensSeconds: w.opens ? Math.max(0, Math.ceil((w.opens - now) / 1000)) : null,
    closesSeconds: w.closes ? Math.max(0, Math.ceil((w.closes - now) / 1000)) : null,
    wallet: !!h.acct.wallet_address,
    eligible: null, amount: null, freeMint: null, claimed: false, communities: [],
  };
  if (!h.acct.wallet_address) return base;
  const row = (await client.query(
    'SELECT omr, free_mint, communities, claimed, claimed_by FROM drop_allocations WHERE wallet_address=lower($1)',
    [h.acct.wallet_address])).rows[0];
  if (!row) { if (w.open) base.eligible = false; return base; }
  if (row.claimed) {
    base.claimed = true; base.eligible = true; base.amount = num(row.omr);
    base.freeMint = !!row.free_mint; base.communities = parseCommunities(row.communities);
  } else if (w.open) {
    base.eligible = true; base.amount = num(row.omr);
    base.freeMint = !!row.free_mint; base.communities = parseCommunities(row.communities);
  }
  return base;
}

// ── THE CLAIM (POST /v1/drop/claim, withCharacter — the write path; the account row is locked, so
// persistAccount commits the credit with the action). The latch is the atomic claim-then-credit
// discipline: `UPDATE … WHERE NOT claimed RETURNING` — exactly one caller ever wins the row, and a
// rollback undoes latch and credit together. ──
export async function claimDrop(ch, client, h) {
  const wallet = h.acct.wallet_address;
  if (!wallet) throw new GameError('wallet', 'Link your wallet first — the envelope pays the wallet the snapshot saw.');
  const w = windowOf(await state(client));
  if (!w.open) throw new GameError('closed', w.announced
    ? 'The claim window is not open. What goes unclaimed stays in the vault — it never left.'
    : 'No community drop is open.');
  const row = (await client.query(
    `UPDATE drop_allocations SET claimed=true, claimed_by=$2, claimed_at=now()
      WHERE wallet_address=lower($1) AND NOT claimed RETURNING omr, free_mint, communities`,
    [wallet, h.accountId])).rows[0];
  if (!row) {
    const exists = (await client.query(
      'SELECT 1 FROM drop_allocations WHERE wallet_address=lower($1)', [wallet])).rows.length;
    if (!exists) throw new GameError('not_snapshotted', 'That wallet is not in any snapshot — the blocks are history.');
    throw new GameError('already', 'This wallet already opened its envelope.');
  }
  const omr = num(row.omr);
  if (omr > 0) {
    // the enumerated mint (the mission:% shape): in-memory bump + the ledger row, committed together
    h.acct.omr = Number(h.acct.omr) + omr;
    await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: omr, reason: 'drop:claim' });
  }
  let freeMint = false;
  if (row.free_mint && !h.acct.minted) {
    h.acct.mint_credits = Number(h.acct.mint_credits || 0) + 1; // rides persistAccount ($13)
    // the mint-source mark (direct SQL — off the positional list, clobber-safe): the tranche
    // counter excludes this account so the free mint never advances the published PAID price
    await client.query('UPDATE account_persistent SET drop_free_mint=true WHERE account_id=$1', [h.accountId]);
    freeMint = true;
  }
  return { drop: 'claimed', omr, freeMint, communities: parseCommunities(row.communities) };
}

// ── MOD: load the published allocation dataset (idempotent by wallet; a CLAIMED row is history and
// is never rewritten — re-loading a corrected dataset cannot un-claim or re-price what already paid). ──
export async function loadAllocations(pool, rows) {
  if (!Array.isArray(rows) || !rows.length) throw new GameError('rows', 'Provide allocation rows.');
  if (rows.length > 200000) throw new GameError('rows', 'Load the dataset in batches of at most 200,000 rows.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let loaded = 0, skippedClaimed = 0;
    for (const r of rows) {
      const wallet = String(r.wallet || '').toLowerCase();
      if (!isWallet(wallet)) throw new GameError('wallet', `Bad wallet address: ${r.wallet}`);
      const omr = Number(r.omr);
      if (!Number.isFinite(omr) || omr < 0) throw new GameError('amount', `Bad omr amount for ${wallet}`);
      const communities = JSON.stringify((Array.isArray(r.communities) ? r.communities : [])
        .map((c) => Number(c)).filter(Number.isFinite));
      // SELECT-then-write under the row lock (pg-mem lies about ON CONFLICT — the recordReckoning lesson)
      const cur = (await client.query(
        'SELECT claimed FROM drop_allocations WHERE wallet_address=$1 FOR UPDATE', [wallet])).rows[0];
      if (cur?.claimed) { skippedClaimed += 1; continue; }
      if (cur) await client.query(
        'UPDATE drop_allocations SET omr=$2, free_mint=$3, communities=$4 WHERE wallet_address=$1',
        [wallet, omr, !!r.freeMint, communities]);
      else await client.query(
        'INSERT INTO drop_allocations (wallet_address, omr, free_mint, communities) VALUES ($1,$2,$3,$4)',
        [wallet, omr, !!r.freeMint, communities]);
      loaded += 1;
    }
    await client.query('COMMIT');
    return { ok: true, loaded, skippedClaimed };
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

// ── MOD: set the claim window. Both timestamps required and ordered; closing early is setting
// closes_at to now — the clawback is exactly this, nothing else (design b: nothing to sweep). ──
export async function setDropWindow(pool, opensAt, closesAt) {
  const opens = new Date(opensAt), closes = new Date(closesAt);
  if (Number.isNaN(opens.getTime()) || Number.isNaN(closes.getTime()))
    throw new GameError('window', 'opensAt and closesAt must be timestamps.');
  if (closes <= opens) throw new GameError('window', 'The window must close after it opens.');
  await pool.query('UPDATE drop_state SET opens_at=$1, closes_at=$2 WHERE id=1', [opens, closes]);
  return { ok: true, opensAt: opens.toISOString(), closesAt: closes.toISOString() };
}

// ── MOD: the drop's books — allocated vs claimed vs lapsed (the clawback REPORT: what goes
// unclaimed never left the Safe, so "reverted" is just this number once the window closes). ──
export async function dropStatus(pool) {
  const w = windowOf(await state(pool));
  // a JS fold over one flat read (pg-mem parses no FILTER — the arena-aggregate posture); the
  // dataset is bounded by the whitelist headcount, and this is a mod instrument, not a hot path
  const rows = (await pool.query('SELECT omr, free_mint, claimed FROM drop_allocations')).rows;
  const t = { wallets: rows.length, omr: 0, freeMints: 0, claimedWallets: 0, omrClaimed: 0, freeMintsClaimed: 0 };
  for (const r of rows) {
    t.omr += num(r.omr);
    if (r.free_mint) t.freeMints += 1;
    if (r.claimed) {
      t.claimedWallets += 1; t.omrClaimed += num(r.omr);
      if (r.free_mint) t.freeMintsClaimed += 1;
    }
  }
  return {
    window: { announced: w.announced, open: w.open,
      opensAt: w.opens ? new Date(w.opens).toISOString() : null,
      closesAt: w.closes ? new Date(w.closes).toISOString() : null },
    wallets: t.wallets, omrAllocated: t.omr, freeMints: t.freeMints,
    claimedWallets: t.claimedWallets, omrClaimed: t.omrClaimed,
    freeMintsClaimed: t.freeMintsClaimed,
    omrUnclaimed: t.omr - t.omrClaimed,
  };
}

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
import crypto from 'node:crypto';
import { GameError } from './game.js';
import { PROVENANCE, wardOf } from './rules.js';
import { isSolAddress, verifySolSig } from './sol.js';

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
  return settleEnvelope(client, h, row);
}

// ── the ONE settle (the extortFront one-core discipline): both claim legs — the SIWE-linked EVM
// wallet and the verify-at-claim Solana wallet — credit through exactly this, so the mint, the
// free-mint waiver and the tranche exclusion cannot drift between rails. ──
async function settleEnvelope(client, h, row) {
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

// ── THE SOLANA LEG (founder-directed launch build, 2026-08-16) — verify-at-claim, never linked. ──
//
// The EVM rail rides the account's ONE SIWE-linked wallet; a Solana wallet has no home on
// `account_persistent.wallet_address` (that column is the EVM extraction identity), so the Solana
// claim proves control AT THE CLAIM: a server-issued challenge (the wallet_challenges machinery,
// its own message string so it can never be confused with a SIWE link), signed by the wallet's
// ed25519 key, verified dependency-free (src/sol.js), then the SAME latch + settle as the EVM leg.
//
// Consequences, each deliberate:
//  - One account may claim SEVERAL Solana envelopes (a holder with three wallets claims all three
//    into their one account). That multiplies nothing — each envelope is its own allocation row
//    with its own once-ever latch, and extra free-mint credits are dead past the account's one
//    `minted` (the payPackagePlex rule already guards the grant).
//  - Base58 is CASE-SENSITIVE: the latch matches the address VERBATIM (never lower() — the EVM
//    convention explicitly does not apply), and the loader stores it verbatim.
//  - The challenge binds the ACCOUNT (accountId + nonce in the message), so a signature cannot be
//    replayed to claim into someone else's account; it is consumed on success and expires in 10min.
export async function solanaChallenge(pool, accountId) {
  const nonce = crypto.randomBytes(16).toString('hex');
  await pool.query(
    `INSERT INTO wallet_challenges (account_id, nonce, issued_at) VALUES ($1,$2,now())
       ON CONFLICT (account_id) DO UPDATE SET nonce=$2, issued_at=now()`, [accountId, nonce]);
  return { message: `OMERTÀ drop claim\naccount: ${accountId}\nnonce: ${nonce}` };
}

export async function claimDropSolana(ch, client, h, { address, signature } = {}) {
  if (!isSolAddress(String(address || ''))) throw new GameError('bad_address', 'Not a valid Solana address.');
  const w = windowOf(await state(client));
  if (!w.open) throw new GameError('closed', w.announced
    ? 'The claim window is not open. What goes unclaimed stays in the vault — it never left.'
    : 'No community drop is open.');
  const chal = (await client.query(
    'SELECT nonce, issued_at FROM wallet_challenges WHERE account_id=$1', [h.accountId])).rows[0];
  if (!chal) throw new GameError('no_challenge', 'Request a challenge first.');
  if (Date.now() - new Date(chal.issued_at).getTime() > 10 * 60 * 1000)
    throw new GameError('expired', 'Challenge expired — request a new one.');
  const message = `OMERTÀ drop claim\naccount: ${h.accountId}\nnonce: ${chal.nonce}`;
  if (!verifySolSig(address, message, signature))
    throw new GameError('bad_signature', 'Signature does not match that address.');
  // VERBATIM match — base58 is case-sensitive, so there is no lower() on either side
  const row = (await client.query(
    `UPDATE drop_allocations SET claimed=true, claimed_by=$2, claimed_at=now()
      WHERE wallet_address=$1 AND NOT claimed RETURNING omr, free_mint, communities`,
    [address, h.accountId])).rows[0];
  if (!row) {
    const exists = (await client.query(
      'SELECT 1 FROM drop_allocations WHERE wallet_address=$1', [address])).rows.length;
    if (!exists) throw new GameError('not_snapshotted', 'That wallet is not in any snapshot — the blocks are history.');
    throw new GameError('already', 'This wallet already opened its envelope.');
  }
  // consume the challenge on SUCCESS only (a failed gate keeps it live for a retry inside the TTL)
  await client.query('DELETE FROM wallet_challenges WHERE account_id=$1', [h.accountId]);
  const settled = await settleEnvelope(client, h, row);
  return { ...settled, wallet: address };
}

// ── THE PROVENANCE COLORS (dynasty §9) — the portrait carries the colors of the tribe you came
// from, derived from the SAME snapshots the drop pays from (one dataset, two uses). The rules, each
// load-bearing: OPT-IN (§9.2 — this POST is the consent; the default is a clean portrait), ONE stamp
// per snapshot WALLET EVER (§9.3 — the `stamped` latch, per wallet-event never per community; the
// minter chooses WHICH qualifying communities to record, anything unclaimed at the event is forfeit),
// DISPLAY-ONLY FOREVER (§9.4 — the account columns are read by the portrait/dossier and nothing
// else; the whole flow writes ZERO ledger rows, test-pinned), and FICTIONAL vocabulary (§9.5 — the
// response and every surface speak ward names, never a community's). The visible pick defaults to
// the SCARCEST claimed community (fewest snapshotted wallets), computed ONCE at stamp and stored AS
// the pick (a live-scarcest would flip cached art — the design's own warning).
export async function claimColors(ch, client, h, { communities, pick } = {}) {
  // TWO proof sources, both already-proven control (never a fresh assertion): the SIWE-linked EVM
  // wallet, and any allocation row this account CLAIMED (the Solana leg's ed25519 claim was the
  // proof — a Solana-only community must not be silently excluded from its own colors).
  const wallet = h.acct.wallet_address;
  let row = null;
  if (wallet) row = (await client.query(
    `UPDATE drop_allocations SET stamped=true WHERE wallet_address=lower($1) AND NOT stamped RETURNING communities`,
    [wallet])).rows[0];
  if (!row) {
    // a wallet this account claimed (deterministic pick, then the same atomic latch)
    const mine = (await client.query(
      'SELECT wallet_address FROM drop_allocations WHERE claimed_by=$1 AND NOT stamped ORDER BY wallet_address LIMIT 1',
      [h.accountId])).rows[0];
    if (mine) row = (await client.query(
      `UPDATE drop_allocations SET stamped=true WHERE wallet_address=$1 AND NOT stamped RETURNING communities`,
      [mine.wallet_address])).rows[0];
  }
  if (!row) {
    // name the true refusal: a stamped wallet (either proof source) is 'already', an unknown one is
    // 'not_snapshotted', and only a player with NEITHER source is told to link
    const owned = (await client.query(
      'SELECT 1 FROM drop_allocations WHERE claimed_by=$1', [h.accountId])).rows.length;
    const linked = wallet ? (await client.query(
      'SELECT 1 FROM drop_allocations WHERE wallet_address=lower($1)', [wallet])).rows.length : 0;
    if (!owned && !linked) {
      if (!wallet) throw new GameError('wallet', 'Link your wallet first — the colors belong to the wallet the snapshot saw.');
      throw new GameError('not_snapshotted', 'That wallet is not in any snapshot — the blocks are history.');
    }
    throw new GameError('already', 'That wallet already claimed its colors — a birth certificate is issued once.');
  }
  const qualifying = parseCommunities(row.communities).filter((c) => wardOf(c));
  if (!qualifying.length) throw new GameError('no_colors', 'No colors ride that wallet.');
  // the minter chooses WHICH to record (per-community consent); default = all qualifying
  const want = Array.isArray(communities) && communities.length
    ? communities.map(Number).filter((c) => qualifying.includes(c)) : qualifying;
  if (!want.length) throw new GameError('no_colors', 'None of those colors ride that wallet.');
  // the scarcest claimed community: fewest snapshotted wallets carry it (a JS fold — pg-mem/FILTER)
  let visible = Number(pick);
  if (!want.includes(visible)) {
    const rows = (await client.query('SELECT communities FROM drop_allocations')).rows;
    const counts = new Map(want.map((c) => [c, 0]));
    for (const r of rows) for (const c of parseCommunities(r.communities)) if (counts.has(c)) counts.set(c, counts.get(c) + 1);
    visible = [...want].sort((a, b) => counts.get(a) - counts.get(b) || a - b)[0];
  }
  // account-level, direct SQL (both columns are off persistAccount's positional list — clobber-safe)
  await client.query('UPDATE account_persistent SET provenance=$2, provenance_pick=$3 WHERE account_id=$1',
    [h.accountId, JSON.stringify(want), visible]);
  return { colors: 'claimed', communities: want, pick: visible, ward: wardOf(visible).name };
}

// the colors board (GET /v1/provenance) — a stable key set (the dormantView lesson)
export async function colorsBoard(ch, client, h) {
  const base = { wallet: !!h.acct.wallet_address, stamped: false, eligible: false, wards: [], ward: null };
  const mine = h.acct.provenance_pick != null ? wardOf(h.acct.provenance_pick) : null;
  if (mine) { base.stamped = true; base.ward = mine.name; return base; }
  // the same two proof sources as claimColors: the linked EVM wallet, or a row this account CLAIMED
  // (the Solana leg — a base58 wallet never lives on account_persistent.wallet_address)
  let row = null;
  if (h.acct.wallet_address) row = (await client.query(
    'SELECT communities, stamped FROM drop_allocations WHERE wallet_address=lower($1)', [h.acct.wallet_address])).rows[0];
  if (!row || row.stamped) {
    const claimed = (await client.query(
      'SELECT communities, stamped FROM drop_allocations WHERE claimed_by=$1 AND NOT stamped ORDER BY wallet_address LIMIT 1',
      [h.accountId])).rows[0];
    if (claimed) row = claimed;
  }
  if (!row) return base;
  const qualifying = parseCommunities(row.communities).filter((c) => wardOf(c));
  if (row.stamped || !qualifying.length) { base.stamped = !!row.stamped; return base; }
  base.eligible = true;
  base.wards = qualifying.map((c) => ({ id: c, name: wardOf(c).name }));
  return base;
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
      // EVM addresses normalize to lowercase; Solana addresses (base58, 32-byte) are CASE-SENSITIVE
      // and stored VERBATIM — lowercasing one would orphan the allocation forever.
      const raw = String(r.wallet || '');
      const wallet = /^0x/i.test(raw) ? raw.toLowerCase() : raw;
      if (!isWallet(wallet) && !isSolAddress(wallet)) throw new GameError('wallet', `Bad wallet address: ${r.wallet}`);
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

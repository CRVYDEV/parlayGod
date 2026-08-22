// ── THE WALLET FORGE (founder-signed 2026-08-21, depth B — omerta-wallet-forged-stats-design.md §6) ──
// A SIWE-proven wallet's on-chain HISTORY forges the living street's build: the wallet decides the
// stat SHAPE (one of TWELVE archetypes — four history families × three wallet-hashed variants,
// founder-directed 2026-08-21 — each also schooling its regimen-discipline AFFINITY with banded
// head-start XP), grants a small banded BONUS (≤ WALLET_FORGE.BONUS_MAX on the
// archetype's boost stat), and — founder-directed 2026-08-21 ("I want the wallet to decide the
// budget as well for an extra perk") — a banded BUDGET perk (≤ BUDGET_MAX extra whole-budget
// points, spread evenly, never re-aimed) — the founder-signed, bounded retirement of "outside
// wealth must not buy power" on the stat layer, recorded in BALANCE.md § THE LEDGER-BORN and
// SIGN-OFF § THE 2026-08-21 PAIR. Ceiling: 15 + BONUS_MAX + BUDGET_MAX = 21.
//
// The walls, each load-bearing:
//   • ONCE PER WALLET, EVER (`wallet_rolls`, lowercased-wallet PK) — a wallet forges ONE build,
//     whoever links it later; wallet-shopping across accounts buys nothing new, and a farmed wallet
//     gains zero POWER beyond the capped bonus (Sybil-bounded by the SIWE link + the latch).
//   • The BAND leaves the reader, never the feature — we store archetype + tiers + bonus only
//     (no raw balance / tx count / age: the anti-precise-kill-EV rule on a permanent table).
//   • Features are read by COST-TO-FAKE: wallet AGE is unfakeable after the fact, lifetime TX
//     COUNT (nonce) costs real gas per unit. Balances are deliberately NOT read — a balance is
//     borrowable the block before the call.
//   • The RPC read runs OUTSIDE the transaction (never hold a row lock across a network call —
//     the bankPosition/quoteBond pool-exhaustion lesson), and FAIL-CLOSED: no reader, or a read
//     that throws, refuses the forge — it never falls back to a guessed history.
//   • Free at/below WALLET_FORGE.FREE_LVL (an onboarding identity moment); above it, it consumes a
//     paid reroll credit like any other re-shape (the fees.js rail — an established street
//     re-forging is a re-roll with a pedigree, priced the same).
//
// §10.4: ZERO surface — a forge redistributes the stat budget (+ the capped bonus, a founder-signed
// stat grant, not a currency) and writes NOT ONE `transactions` row (test-pinned). Lock order is
// rerollCharacter's exactly: character FOR UPDATE → account FOR UPDATE (the canonical
// characters→accounts order), with the rare AB-BA vs account-first paths surfacing as a clean
// retryable `contention` via deadlockToRetry.
import crypto from 'node:crypto';
import { GameError, notify, deadlockToRetry } from './game.js';
import { WALLET_FORGE, REGIMEN, walletBands, forgeArchetype, forgeBonus, forgeBudgetExtra, rollStats, levelOf, disciplineLvlOf } from './rules.js';
import { addXp } from './regimen.js';

// ── the feature reader seam (the __setDeliver/__setReader discipline) ──
// A reader takes a 0x wallet and resolves { ageDays, txCount } — or throws. Tests inject one;
// production builds a viem reader off CHAIN_RPC_URL. With neither, the forge refuses (fail-closed).
let customReader = null;
export function __setReader(fn) { customReader = fn; }

// Production reader: lifetime tx count = the account nonce (one eth_getTransactionCount), wallet
// age = the timestamp of the first block where the nonce was already > 0, found by binary search
// over historic nonce reads (~log2(head) RPC calls). Both are the cheapest reads that carry the
// cost-to-fake property; neither touches a balance.
async function viemReader(wallet) {
  const { createPublicClient, http } = await import('viem');
  const client = createPublicClient({ transport: http(process.env.CHAIN_RPC_URL) });
  // wrong-chain guard (the makeChainReader posture): a same-address wallet on another chain would
  // answer confidently and wrongly, and this figure forges a permanent build.
  if (process.env.CHAIN_ID) {
    const rpcChain = await client.getChainId();
    if (Number(process.env.CHAIN_ID) !== Number(rpcChain))
      throw new Error(`wallet forge reader: CHAIN_ID ${process.env.CHAIN_ID} != RPC chain ${rpcChain}`);
  }
  const head = await client.getBlockNumber();
  const txCount = await client.getTransactionCount({ address: wallet, blockNumber: head });
  if (txCount === 0) return { ageDays: 0, txCount: 0 }; // never sent a tx — no history to date
  let lo = 1n, hi = head; // first block where nonce > 0
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const n = await client.getTransactionCount({ address: wallet, blockNumber: mid }).catch(() => null);
    if (n === null) { lo = mid + 1n; continue; } // pruned history — age reads conservatively young
    if (n > 0) hi = mid; else lo = mid + 1n;
  }
  const blk = await client.getBlock({ blockNumber: lo });
  const ageDays = Math.max(0, (Date.now() / 1000 - Number(blk.timestamp)) / 86400);
  return { ageDays, txCount };
}

async function readFeatures(wallet) {
  if (customReader) return customReader(wallet);
  if (process.env.CHAIN_RPC_URL) return viemReader(wallet);
  return null; // unconfigured — the caller refuses
}

// The client's card: is the forge reachable, and on what terms. A pure read.
export async function forgeBoard(pool, accountId) {
  const acct = (await pool.query(
    'SELECT wallet_address, reroll_credits FROM account_persistent WHERE account_id=$1', [accountId])).rows[0] || {};
  const wallet = acct.wallet_address ? String(acct.wallet_address).toLowerCase() : null;
  const spent = wallet
    ? (await pool.query('SELECT 1 FROM wallet_rolls WHERE wallet=$1', [wallet])).rowCount > 0 : false;
  const ch = (await pool.query('SELECT respect, forged FROM characters WHERE account_id=$1 AND alive', [accountId])).rows[0];
  const free = ch ? levelOf(Number(ch.respect)) <= WALLET_FORGE.FREE_LVL : true;
  return {
    available: !!(customReader || process.env.CHAIN_RPC_URL),
    linked: !!wallet,
    walletForged: spent,               // this wallet's one forge is already spent (by anyone, ever)
    forged: ch?.forged || null,        // the living street's archetype, if it was forged
    free,                              // at/below FREE_LVL the forge costs nothing
    freeLvl: WALLET_FORGE.FREE_LVL,
    costsCredit: !free,                // above it: one paid reroll credit (the fees.js rail)
    rerollCredits: Number(acct.reroll_credits || 0),
    bonusMax: WALLET_FORGE.BONUS_MAX,
    budgetMax: WALLET_FORGE.BUDGET_MAX,  // the budget perk's ceiling (extra whole-budget points)
    archetypes: Object.fromEntries(Object.entries(WALLET_FORGE.ARCHETYPES)
      .map(([k, a]) => [k, { name: a.name, muscle: a.muscle, cunning: a.cunning, speed: a.speed, boost: a.boost, affinity: a.affinity }])),
  };
}

// POST /v1/character/forge — forge the living build from the linked wallet's history.
export async function forgeCharacter(pool, accountId) {
  // 1) resolve the wallet + cheap pre-checks UNLOCKED (the maybeQualifyReferral discipline: no
  //    lock is held while we talk to a chain). Everything is re-verified under the locks.
  const pre = (await pool.query(
    'SELECT wallet_address FROM account_persistent WHERE account_id=$1', [accountId])).rows[0];
  if (!pre?.wallet_address)
    throw new GameError('wallet', 'Link a wallet first — the forge reads its history, and only a proven wallet counts.');
  const wallet = String(pre.wallet_address).toLowerCase();
  if ((await pool.query('SELECT 1 FROM wallet_rolls WHERE wallet=$1', [wallet])).rowCount > 0)
    throw new GameError('wallet_spent', 'That wallet already forged a build — one forge per wallet, ever.');

  // 2) read the features OUTSIDE any transaction — fail-closed, never a guessed history.
  let features;
  try { features = await readFeatures(wallet); }
  catch (e) { console.error('wallet forge read failed', e?.message || e); features = undefined; }
  if (features === null) throw new GameError('chain_unconfigured', 'The forge is not lit on this server yet.');
  if (features === undefined) throw new GameError('read_failed', "Couldn't read that wallet's history — try again shortly.");

  const tiers = walletBands(features);
  // twelve archetypes (founder-directed 2026-08-21): the FAMILY is the bands' answer, the VARIANT
  // a stable hash of the wallet itself — deterministic per wallet, never a roll. null = a fresh
  // empty wallet → a real random roll.
  const arche = forgeArchetype(tiers, wallet);
  const bonus = arche ? forgeBonus(tiers) : 0;
  const budgetExtra = arche ? forgeBudgetExtra(tiers) : 0; // the budget perk — extra WHOLE-budget points

  // 3) the transaction: character FOR UPDATE → account FOR UPDATE (rerollCharacter's canonical order).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ch = (await client.query(
      'SELECT id, respect FROM characters WHERE account_id=$1 AND alive FOR UPDATE', [accountId])).rows[0];
    if (!ch) throw new GameError('no_character', 'Create a character first — the forge shapes a living street.');
    const acct = (await client.query(
      'SELECT wallet_address, reroll_credits FROM account_persistent WHERE account_id=$1 FOR UPDATE', [accountId])).rows[0];
    if (!acct?.wallet_address || String(acct.wallet_address).toLowerCase() !== wallet)
      throw new GameError('wallet', 'The linked wallet changed mid-forge — link it and try again.');
    const free = levelOf(Number(ch.respect)) <= WALLET_FORGE.FREE_LVL;
    if (!free) {
      if (Number(acct.reroll_credits) < 1)
        throw new GameError('no_reroll_credit',
          `Past level ${WALLET_FORGE.FREE_LVL} a forge is a re-roll with a pedigree — it takes one paid re-roll credit.`);
      await client.query('UPDATE account_persistent SET reroll_credits = reroll_credits - 1 WHERE account_id=$1', [accountId]);
    }
    // the once-per-wallet-EVER latch: SELECT-then-INSERT under the account lock (two forges from
    // one account serialize on the char lock; a cross-account race on the SAME wallet is backstopped
    // by the PK — 23505 → a clean retryable `contention` via deadlockToRetry).
    if ((await client.query('SELECT 1 FROM wallet_rolls WHERE wallet=$1', [wallet])).rowCount > 0)
      throw new GameError('wallet_spent', 'That wallet already forged a build — one forge per wallet, ever.');
    await client.query(
      'INSERT INTO wallet_rolls (wallet, account_id, archetype, age_tier, vel_tier, bonus, budget) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [wallet, accountId, arche || 'unknown', tiers.ageTier, tiers.velTier, bonus, budgetExtra]);

    let stats, roll = 0, outcome;
    if (arche) {
      const a = WALLET_FORGE.ARCHETYPES[arche];
      stats = { muscle: a.muscle, cunning: a.cunning, speed: a.speed };
      // the BUDGET perk first (founder-directed 2026-08-21): extra whole-budget points spread
      // DETERMINISTICALLY round-robin across the three stats — the wallet widens the build, it
      // never re-aims it (the boost stat is the bonus's job, below).
      const keys = ['muscle', 'cunning', 'speed'];
      for (let i = 0; i < budgetExtra; i++) stats[keys[i % keys.length]] += 1;
      stats[a.boost] += bonus;                     // the depth-B grant, capped at BONUS_MAX
      outcome = `${arche}+${bonus}+b${budgetExtra} (deterministic)`; // pure function of the bands
    } else {
      roll = Math.random();                        // an empty wallet earns an honest random roll
      stats = rollStats();
      outcome = `unknown ${stats.muscle}/${stats.cunning}/${stats.speed}`;
    }
    await client.query('UPDATE characters SET muscle=$2, cunning=$3, speed=$4, forged=$5 WHERE id=$1',
      [ch.id, stats.muscle, stats.cunning, stats.speed, arche || 'unknown']);
    // THE AFFINITY (founder-directed 2026-08-21, "add more stats"): each archetype schools its
    // regimen discipline with banded head-start XP — status/pacing through the regimen's own
    // audited addXp (XP is not a currency; zero §10.4 surface). Max 5 bands = 200 XP ≈ level 4
    // against a cap of 25: schooling, never mastery.
    let affinity = null;
    if (arche) {
      const a = WALLET_FORGE.ARCHETYPES[arche];
      const affXp = WALLET_FORGE.AFFINITY_XP_PER_BAND * (tiers.ageTier + tiers.velTier);
      if (affXp > 0) {
        const total = await addXp(client, ch.id, a.affinity, affXp);
        // the display NAME rides the reply (the F12 rule — a raw discipline key never reaches a player)
        const dName = REGIMEN.DISCIPLINES.find((d) => d.id === a.affinity)?.name || a.affinity;
        affinity = { discipline: a.affinity, name: dName, xp: affXp, level: disciplineLvlOf(total) };
      }
    }
    await client.query('INSERT INTO rng_audit (id, character_id, action, roll, outcome) VALUES ($1,$2,$3,$4,$5)',
      [crypto.randomUUID(), ch.id, 'wallet_forge', roll, outcome]);
    await notify(client, ch.id, 'forged', { archetype: arche || 'unknown', name: arche ? WALLET_FORGE.ARCHETYPES[arche].name : null, bonus, budgetExtra, affinity, ...stats });
    await client.query('COMMIT');
    return {
      forged: arche || 'unknown',
      name: arche ? WALLET_FORGE.ARCHETYPES[arche].name : null,
      bonus, budgetExtra, stats,
      affinity,                                    // { discipline, xp, level } or null
      tiers,                                       // the BANDS only — the raw features never leave
      spentCredit: !free,
    };
  } catch (e) { await client.query('ROLLBACK'); throw deadlockToRetry(e); }
  finally { client.release(); }
}

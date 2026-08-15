#!/usr/bin/env node
// ── THE ALLOCATION BUILDER — snapshot datasets + a config → the drop_allocations rows ──
//
// Turns tools/snapshot.js outputs into the dataset `POST /v1/mod/drop/load` ingests, under the two
// RULED shapes (omerta-launch-sequence-design.md G-3, the exploit lens):
//   • COIN communities are NEVER flat-per-wallet — proportional to the snapshotted balance among
//     wallets clearing the DUST FLOOR, with a hard PER-WALLET CAP. Proportional is Sybil-neutral to
//     wallet-splitting, the floor kills dust spam, the cap bounds whales. A capped wallet's surplus
//     is NOT redistributed (deterministic + conservative — it stays in the Safe, the distribution
//     precedent's "the remainder stays unallocated").
//   • NFT communities are per-NFT (the NFT itself is the Sybil bound): amount × held count.
// Amounts floor to the game's 6dp grid; a wallet in several communities SUMS its envelopes and
// records every community id (numeric ids only — the guessability rule). `freeMint` marks the
// whitelist (one free identity mint, ever — the claim rail consumes it).
//
// CLI (flags only — nothing for preflight):
//   node tools/allocate-drop.js --config drop-config.json --out drop-dataset.json
// config: { "communities": [
//   { "id": 1, "snapshot": "punks.json",  "kind": "nft",  "perNft": 100,  "freeMint": true },
//   { "id": 4, "snapshot": "pepe.json",   "kind": "coin", "pool": 250000,
//     "dustFloor": "1000000000000000000000", "cap": 500, "freeMint": true } ] }
//
// §10.4: none — pure arithmetic over published snapshots, writing a JSON file.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const floor6 = (v) => Math.floor(v * 1e6) / 1e6;
const byWallet = (a, b) => (a.wallet < b.wallet ? -1 : 1);

// ── COIN: proportional + dust floor + cap (the RULED shape). Shares are computed against the
// ELIGIBLE total (post-floor), at 6dp precision via BigInt ppm — deterministic on any machine. ──
export function allocateCoin({ holders, pool, dustFloor, cap }) {
  const floorWei = BigInt(dustFloor ?? 0);
  const eligible = holders.filter((h) => BigInt(h.balance) >= floorWei && BigInt(h.balance) > 0n);
  const total = eligible.reduce((a, h) => a + BigInt(h.balance), 0n);
  if (total === 0n) return [];
  return eligible.map((h) => {
    const shareMicro = Number((BigInt(h.balance) * 1000000n) / total); // µ-shares, exact in BigInt
    const omr = floor6(Math.min(Number(cap ?? Infinity), floor6((Number(pool) * shareMicro) / 1e6)));
    return { wallet: h.wallet.toLowerCase(), omr };
  }).filter((r) => r.omr > 0).sort(byWallet);
}

// ── NFT: per-NFT × held count (the token is the Sybil bound — no floor or cap needed). ──
export function allocateNft({ holders, perNft }) {
  return holders.map((h) => ({ wallet: h.wallet.toLowerCase(), omr: floor6(Number(perNft) * Number(h.count)) }))
    .filter((r) => r.omr > 0).sort(byWallet);
}

// ── MERGE: a wallet in several communities sums its envelopes and records every community id;
// freeMint is the OR across its communities (one waiver ever, however many colors you carry). ──
export function mergeAllocations(perCommunity) {
  const map = new Map();
  for (const c of perCommunity) {
    for (const r of c.rows) {
      const cur = map.get(r.wallet) || { wallet: r.wallet, omr: 0, freeMint: false, communities: [] };
      cur.omr = floor6(cur.omr + r.omr);
      cur.freeMint = cur.freeMint || !!c.freeMint;
      if (!cur.communities.includes(c.id)) cur.communities.push(c.id);
      map.set(r.wallet, cur);
    }
  }
  return [...map.values()].sort(byWallet);
}

const flag = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
};

function main() {
  const configPath = flag('config'), out = flag('out');
  if (!configPath || !out) {
    console.error('usage: node tools/allocate-drop.js --config drop-config.json --out drop-dataset.json');
    process.exit(1);
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const perCommunity = [];
  const summary = [];
  for (const c of config.communities || []) {
    const snap = JSON.parse(readFileSync(c.snapshot, 'utf8'));
    if (snap.meta?.partialReplay) console.error(`[allocate] WARNING: ${c.snapshot} is a PARTIAL replay — the holder set is a weaker claim`);
    const rows = c.kind === 'coin'
      ? allocateCoin({ holders: snap.holders, pool: c.pool, dustFloor: c.dustFloor, cap: c.cap })
      : allocateNft({ holders: snap.holders, perNft: c.perNft });
    perCommunity.push({ id: Number(c.id), freeMint: c.freeMint !== false, rows });
    summary.push({ community: Number(c.id), kind: c.kind, snapshotHolders: snap.holders.length,
      eligible: rows.length, omr: floor6(rows.reduce((a, r) => a + r.omr, 0)) });
  }
  const rows = mergeAllocations(perCommunity);
  const totalOmr = floor6(rows.reduce((a, r) => a + r.omr, 0));
  const dataset = {
    meta: {
      wallets: rows.length, omr: totalOmr,
      freeMints: rows.filter((r) => r.freeMint).length,
      commitment: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
      communities: summary,
    },
    rows,
  };
  writeFileSync(out, JSON.stringify(dataset, null, 1));
  console.log(`[allocate] ${rows.length} wallets, ${totalOmr} $OMR, ${dataset.meta.freeMints} free mints → ${out}`);
  console.log(`[allocate] commitment ${dataset.meta.commitment} — publish the dataset (a commitment is only verifiable if outsiders can reproduce the set)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();

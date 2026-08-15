#!/usr/bin/env node
// ── THE SNAPSHOT — holder-set enumeration at a fixed historical block (G-0's "real, currently-
// unowned engineering task", omerta-launch-sequence-design.md) ──
//
// ERC-20 communities have NO on-chain holder enumeration at any block, so the only way to know who
// held what at block N is to replay every Transfer log from the contract's genesis and fold. ERC-721
// enumerates the same way (fold ownership per tokenId, then count per wallet). The output is a
// CANONICAL, SORTED dataset — a root is only "verifiable" if outsiders can reproduce the set, so the
// dataset (or this exact tool + its arguments) publishes with it; `meta.commitment` is the sha256 of
// the canonical holder rows, the publishable commitment.
//
// Discipline: the snapshot block must be a HISTORICAL block that PREDATES every committed document
// naming the target communities (the adversarial-by-default rule — a past block cannot be farmed,
// leak or no leak). Verify the RPC serves full-history getLogs BEFORE fixing block heights (a
// $PEPE-class token is millions of events; use an archive node and a sane --chunk).
//
// CLI flags ONLY — no process.env reads, so there is nothing for preflight to classify:
//   node tools/snapshot.js --rpc <url> --contract 0x… --type erc20|erc721 --block <N> \
//        [--from-block 0] [--chunk 5000] [--community <numeric id>] --out punks.json
//
// §10.4: none — this reads a foreign chain and writes a JSON file.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ZERO = '0x0000000000000000000000000000000000000000';

// ── the pure fold, exported for tests: logs are viem-decoded Transfer events ({args:{from,to,value}}
// for erc20, {args:{from,to,tokenId}} for erc721). A full-genesis replay can never go negative; a
// PARTIAL replay (--from-block > 0) can, so negatives are COUNTED and surfaced in meta rather than
// silently dropped — a dataset built on a partial replay must say so. ──
export function foldTransfers(logs, type) {
  if (type === 'erc20') {
    const bal = new Map();
    for (const l of logs) {
      const from = String(l.args.from).toLowerCase(), to = String(l.args.to).toLowerCase();
      const v = BigInt(l.args.value);
      if (from !== ZERO) bal.set(from, (bal.get(from) || 0n) - v);
      if (to !== ZERO) bal.set(to, (bal.get(to) || 0n) + v);
    }
    let negatives = 0;
    const holders = [];
    for (const [wallet, v] of bal) {
      if (v < 0n) { negatives += 1; continue; }
      if (v > 0n) holders.push({ wallet, balance: v.toString() });
    }
    holders.sort((a, b) => (a.wallet < b.wallet ? -1 : 1));
    return { holders, negatives };
  }
  if (type !== 'erc721') throw new Error(`unknown type: ${type}`);
  const owner = new Map(); // tokenId -> wallet (a mint sets it, a burn deletes it, a transfer moves it)
  for (const l of logs) {
    const to = String(l.args.to).toLowerCase();
    const id = BigInt(l.args.tokenId).toString();
    if (to === ZERO) owner.delete(id); else owner.set(id, to);
  }
  const counts = new Map();
  for (const w of owner.values()) counts.set(w, (counts.get(w) || 0) + 1);
  const holders = [...counts].map(([wallet, count]) => ({ wallet, count }))
    .sort((a, b) => (a.wallet < b.wallet ? -1 : 1));
  return { holders, negatives: 0 };
}

// the publishable commitment: sha256 over the canonical (sorted) holder rows
export function commitmentOf(holders) {
  return createHash('sha256').update(JSON.stringify(holders)).digest('hex');
}

const flag = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
};

async function main() {
  const rpc = flag('rpc'), contract = flag('contract'), type = flag('type');
  const block = Number(flag('block')), fromBlock = Number(flag('from-block', '0'));
  const chunk = Number(flag('chunk', '5000'));
  const community = flag('community') ? Number(flag('community')) : null;
  const out = flag('out');
  if (!rpc || !contract || !['erc20', 'erc721'].includes(type) || !Number.isFinite(block) || !out) {
    console.error('usage: node tools/snapshot.js --rpc <url> --contract 0x… --type erc20|erc721 --block <N> [--from-block 0] [--chunk 5000] [--community <id>] --out file.json');
    process.exit(1);
  }
  const { createPublicClient, http, parseAbiItem } = await import('viem');
  const client = createPublicClient({ transport: http(rpc) });
  // erc20 and erc721 share topic0 but index differently (tokenId IS indexed, value is NOT) — the
  // event signature has to say which, or decoding silently mangles the third field
  const event = type === 'erc20'
    ? parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
    : parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');
  const logs = [];
  for (let from = fromBlock; from <= block; from += chunk) {
    const to = Math.min(from + chunk - 1, block);
    const batch = await client.getLogs({ address: contract, event, fromBlock: BigInt(from), toBlock: BigInt(to) });
    logs.push(...batch);
    process.stderr.write(`\r[snapshot] blocks ${from}..${to} — ${logs.length} transfers`);
  }
  process.stderr.write('\n');
  const { holders, negatives } = foldTransfers(logs, type);
  const dataset = {
    meta: {
      contract: contract.toLowerCase(), type, block, fromBlock, community,
      transfers: logs.length, holders: holders.length,
      // a partial replay is a different (weaker) claim than a full one — the dataset says which it is
      partialReplay: fromBlock > 0, negatives,
      commitment: commitmentOf(holders),
    },
    holders,
  };
  writeFileSync(out, JSON.stringify(dataset, null, 1));
  console.log(`[snapshot] ${holders.length} holders at block ${block} → ${out} (commitment ${dataset.meta.commitment.slice(0, 16)}…)`);
}

// run only as a CLI (the file is also imported for its pure folds by the test suite)
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });

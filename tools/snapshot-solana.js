#!/usr/bin/env node
// ── THE SOLANA SNAPSHOT — SPL token holder enumeration (the $ANSEM-class community's leg of G-3) ──
//
// The founder-directed launch build (2026-08-16). The EVM tool (tools/snapshot.js) REPLAYS Transfer
// logs to a historical block; Solana's public RPC has no equivalent cheap historical-state read, so
// this tool takes the snapshot AT RUN TIME from the FINALIZED state (`getProgramAccounts` over the
// SPL Token program filtered by mint) and records the slot. That is a DIFFERENT, weaker
// reproducibility claim than the EVM tool's — an outsider cannot re-derive the set later without an
// archive indexer — so the dataset SAYS SO (`meta.liveSnapshot: true`) and the discipline shifts:
// where the EVM rule is "a historical block cannot be farmed", the Solana rule is RUN THE TOOL
// BEFORE ANY ANNOUNCEMENT NAMES THE TARGET (the same adversarial-by-default posture, enforced by
// operational order instead of block height). The sha256 commitment publishes exactly like the EVM
// dataset's.
//
// Aggregation is BY OWNER — a wallet holds its balance across any number of token accounts, so the
// fold sums per owner and drops zero-balance accounts (rent-exempt empties are common).
//
// CLI flags ONLY — no process.env reads, nothing for preflight to classify:
//   node tools/snapshot-solana.js --rpc <url> --mint <base58> [--program <base58>] \
//        [--community <numeric id>] --out ansem.json
//
// §10.4: none — this reads a foreign chain and writes a JSON file.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { base58Encode } from '../src/sol.js';

// the classic SPL Token program (token-2022 communities pass --program)
export const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// ── the pure parse, exported for tests: an SPL token ACCOUNT is a fixed 165-byte layout —
// mint [0..32), owner [32..64), amount u64 LE [64..72). Anything else is not a token account. ──
export function parseTokenAccount(dataB64) {
  const buf = Buffer.from(dataB64, 'base64');
  if (buf.length !== 165) return null;
  const owner = base58Encode(buf.subarray(32, 64));
  const amount = buf.readBigUInt64LE(64).toString();
  return { owner, amount };
}

// ── the pure fold, exported for tests: token accounts → per-OWNER balances, zeros dropped,
// canonical sort (case-SENSITIVE — base58 addresses are never case-folded). ──
export function foldTokenAccounts(accounts) {
  const bal = new Map();
  for (const a of accounts) {
    if (!a) continue;
    const v = BigInt(a.amount);
    if (v <= 0n) continue;
    bal.set(a.owner, (bal.get(a.owner) || 0n) + v);
  }
  const holders = [...bal].map(([wallet, v]) => ({ wallet, balance: v.toString() }))
    .sort((a, b) => (a.wallet < b.wallet ? -1 : 1));
  return { holders };
}

export function commitmentOf(holders) {
  return createHash('sha256').update(JSON.stringify(holders)).digest('hex');
}

const flag = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
};

const rpcCall = async (rpc, method, params) => {
  const res = await fetch(rpc, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
};

async function main() {
  const rpc = flag('rpc'), mint = flag('mint'), out = flag('out');
  const program = flag('program', SPL_TOKEN_PROGRAM);
  const community = flag('community') ? Number(flag('community')) : null;
  if (!rpc || !mint || !out) {
    console.error('usage: node tools/snapshot-solana.js --rpc <url> --mint <base58> [--program <base58>] [--community <id>] --out file.json');
    process.exit(1);
  }
  // the slot is recorded FIRST (finalized commitment) — the dataset's "when" claim
  const slot = await rpcCall(rpc, 'getSlot', [{ commitment: 'finalized' }]);
  // decimals off the mint account (mint layout: decimals is the u8 at offset 44)
  const mintInfo = await rpcCall(rpc, 'getAccountInfo', [mint, { encoding: 'base64', commitment: 'finalized' }]);
  const decimals = mintInfo?.value?.data?.[0]
    ? Buffer.from(mintInfo.value.data[0], 'base64').readUInt8(44) : null;
  // every token account for this mint (dataSize 165 + memcmp mint at offset 0)
  const accounts = await rpcCall(rpc, 'getProgramAccounts', [program, {
    commitment: 'finalized', encoding: 'base64',
    filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mint } }],
  }]);
  process.stderr.write(`[snapshot-solana] ${accounts.length} token accounts for ${mint}\n`);
  const { holders } = foldTokenAccounts(accounts.map((a) => parseTokenAccount(a.account.data[0])));
  const dataset = {
    meta: {
      chain: 'solana', mint, program, slot, decimals, community,
      tokenAccounts: accounts.length, holders: holders.length,
      // the honest reproducibility claim: this is the finalized state AT RUN TIME, keyed by slot —
      // not a historical replay. Run before any announcement names the target.
      liveSnapshot: true,
      commitment: commitmentOf(holders),
    },
    holders,
  };
  writeFileSync(out, JSON.stringify(dataset, null, 1));
  console.log(`[snapshot-solana] ${holders.length} holders at slot ${slot} → ${out} (commitment ${dataset.meta.commitment.slice(0, 16)}…)`);
}

// run only as a CLI (the pure halves are imported by the test suite)
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });

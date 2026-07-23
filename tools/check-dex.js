// ── tools/check-dex.js — verify the Uniswap deployment on a chain, from the chain itself ──
// The definitive answer to "which Uniswap version does this chain support" is the chain's own
// state, not a blog post. Given an RPC and candidate addresses (from Uniswap's published
// deployment docs), this probes each: is there bytecode, and does it answer the right calls?
//
// Usage:
//   CHAIN_RPC_URL=https://... \
//   V2_FACTORY=0x... V2_ROUTER=0x... V3_FACTORY=0x... V4_POOL_MANAGER=0x... \
//   node tools/check-dex.js
//
// Why this matters for OMR: the token carries a DEX sell tax (fee-on-transfer from a pool's
// view). Uniswap V2 pools support that (swaps via the *SupportingFeeOnTransferTokens router
// functions); V3 does NOT. So the go/no-go for seeding canonical liquidity is "does the V2
// deployment exist and answer" — this script proves it against the live chain.
import { createPublicClient, http, parseAbi } from 'viem';

const rpc = process.env.CHAIN_RPC_URL;
if (!rpc) { console.error('Set CHAIN_RPC_URL (the chain RPC to probe).'); process.exit(1); }
const client = createPublicClient({ transport: http(rpc) });

const targets = [
  { name: 'Uniswap V2 Factory', env: 'V2_FACTORY',
    probe: (a) => client.readContract({ address: a, abi: parseAbi(['function allPairsLength() view returns (uint256)']), functionName: 'allPairsLength' }),
    describe: (v) => `${v} pairs` },
  { name: 'Uniswap V2 Router02', env: 'V2_ROUTER',
    probe: (a) => client.readContract({ address: a, abi: parseAbi(['function factory() view returns (address)']), functionName: 'factory' }),
    describe: (v) => `factory ${v}` },
  { name: 'Uniswap V3 Factory', env: 'V3_FACTORY',
    probe: (a) => client.readContract({ address: a, abi: parseAbi(['function feeAmountTickSpacing(uint24) view returns (int24)']), functionName: 'feeAmountTickSpacing', args: [3000] }),
    describe: (v) => `0.3% tick spacing ${v}` },
  { name: 'Uniswap V4 PoolManager', env: 'V4_POOL_MANAGER',
    probe: async (a) => (await client.getCode({ address: a }))?.length ?? 0,
    describe: (v) => `bytecode present` },
];

const chainId = await client.getChainId();
console.log(`chain id ${chainId} via ${rpc}\n`);
let v2ok = false;
for (const t of targets) {
  const addr = process.env[t.env];
  if (!addr) { console.log(`— ${t.name}: no ${t.env} provided, skipped`); continue; }
  try {
    const code = await client.getCode({ address: addr });
    if (!code || code === '0x') { console.log(`✗ ${t.name}: NO BYTECODE at ${addr}`); continue; }
    const v = await t.probe(addr);
    console.log(`✓ ${t.name}: deployed at ${addr} (${t.describe(v)})`);
    if (t.env === 'V2_FACTORY' || t.env === 'V2_ROUTER') v2ok = true;
  } catch (e) {
    console.log(`✗ ${t.name}: bytecode at ${addr} but the probe call failed — wrong address or a different contract (${e.shortMessage || e.message})`);
  }
}
console.log(v2ok
  ? '\nVERDICT: a V2 deployment answers — the sell-taxed OMR can pool here (use the *SupportingFeeOnTransferTokens router path).'
  : '\nVERDICT: no verified V2 deployment — do NOT seed sell-taxed liquidity yet (V3 rejects fee-on-transfer tokens). Find the V2 addresses in Uniswap\'s deployment docs, or arm the tax at 0.');

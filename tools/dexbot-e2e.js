// THE DEX BOTS, PROVEN ON A REAL UNISWAP v4 POOL — the ⚠ VERIFY AT LAUNCH flag, closed.
//
// `src/dexbot.js` shipped with a warning in its own header: the raw v4 encodings (the Universal
// Router's V4_SWAP command bytes, and PositionManager.modifyLiquidities' MINT_POSITION actions)
// "cannot be tested against a real pool in this environment — no v4 pool exists to swap against."
// Everything AROUND them is covered by `test/dexbot.js` — the fail-closed oracle, the slippage
// floor, the swap-then-book journal, the POL root cap, the §10.4 posture — because those run
// behind the `__set*` seams. The bytes themselves had never executed, and real ETH rides them.
//
// This is the missing half, and it is the project's own standard: every other chain rail here was
// devnet-proven end to end (`tools/chain-e2e.js`, 27 asserted steps) before it was trusted.
//
// WHAT IT PROVES. It stands up a REAL Uniswap v4 — the actual PoolManager, PositionManager,
// StateView, Universal Router and Permit2 bytecode, not mocks — initializes the canonical OMR/ETH
// pool behind the REAL OmertaHook, seeds it with real liquidity, and then calls `runDexBuyback`
// and `runPolPairing` **with their senders UNSEAMED**, so the encoders in `src/dexbot.js` are what
// build the calldata that executes. A mis-shaped action list, a wrong constant, a struct field in
// the wrong order, or ETH left stranded in a periphery contract all surface here as a failure.
//
// WHAT IT DELIBERATELY DOES NOT PROVE. Nothing about game state: no §10.4 surface is touched (the
// whole layer is out-of-band real value — the fees.js precedent), and `test/dexbot.js` remains the
// place the orchestration and walls are asserted. This file exists for the bytes.
//
// HOW THE PIECES ARE OBTAINED, since none of it is a project dependency (the compile-contracts
// posture — the deploy story stays zero-build):
//   • our own OMR / OmertaHook / OmertaBond / GenesisOracle — `omerta-contracts/out` (forge)
//   • PoolManager / PositionManager / StateView / PoolModifyLiquidityTest — the PREBUILT artifacts
//     `@uniswap/v4-periphery` ships in `foundry-out`
//   • UniversalRouter — the prebuilt artifact `@uniswap/universal-router` ships in `artifacts`
//   • Permit2 — the precompiled runtime bytecode v4-periphery's own test helper etches, placed
//     with `anvil_setCode` at the canonical address exactly as that helper does
//   • the node — `@foundry-rs/anvil`
//
//   npm i --no-save --prefix /tmp/v4deps @uniswap/v4-periphery@1.0.3 \
//       @uniswap/universal-router@2.1.0 @foundry-rs/anvil
//   V4_DEPS=/tmp/v4deps/node_modules node tools/dexbot-e2e.js
//
// A HOOK ADDRESS CARRIES ITS PERMISSIONS IN ITS LOW 14 BITS, so the hook cannot simply be deployed
// — the address has to be mined. Real deployments mine a CREATE2 salt; here we mine a throwaway
// DEPLOYER instead (its nonce-0 address is a pure keccak of sender+nonce), which needs no factory
// and no cheatcode. Same result, ~16k hashes.
//
// Exit 0 = the encodings are real.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const DEPS = process.env.V4_DEPS || '/tmp/v4deps/node_modules';
const PORT = Number(process.env.ANVIL_PORT || 8547);
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN_ID = 31337;                    // Permit2's precompiled bytecode has this chainId baked in

const steps = [];
const step = (name, detail = '') => { steps.push(name); console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ''}`); };

// ── artifacts ────────────────────────────────────────────────────────────────────────────────────
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const ours = (name) => {
  const a = readJson(path.join(ROOT, 'omerta-contracts', 'out', `${name}.sol`, `${name}.json`));
  return { abi: a.abi, bytecode: a.bytecode.object };
};
const v4 = (rel, name) => {
  const a = readJson(path.join(DEPS, '@uniswap/v4-periphery/foundry-out', rel));
  return { abi: a.abi, bytecode: a.bytecode.object, name };
};
const ur = () => {
  const a = readJson(path.join(DEPS, '@uniswap/universal-router/artifacts/contracts/UniversalRouter.sol/UniversalRouter.json'));
  return { abi: a.abi, bytecode: a.bytecode };
};
// Permit2's runtime bytecode, lifted from the helper v4-periphery itself uses to avoid a viaIR
// compile. Read out of the .sol rather than pasted here, so it cannot drift from the package.
function permit2Runtime() {
  const src = fs.readFileSync(path.join(DEPS, '@uniswap/v4-periphery/lib/permit2/test/utils/DeployPermit2.sol'), 'utf8');
  const m = src.match(/hex"([0-9a-fA-F]+)"/);
  assert(m, 'could not find the precompiled Permit2 bytecode in DeployPermit2.sol');
  return '0x' + m[1];
}
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

// ── boot ─────────────────────────────────────────────────────────────────────────────────────────
// anvil comes from wherever it is: an explicit ANVIL_BIN, a Foundry toolchain already on PATH (CI
// installs one for `forge test`, so nothing extra is fetched there), or the npm package.
function anvilBin() {
  if (process.env.ANVIL_BIN) return process.env.ANVIL_BIN;
  const npmBin = path.join(DEPS, '@foundry-rs/anvil-linux-amd64/bin/anvil');
  if (fs.existsSync(npmBin)) return npmBin;
  for (const dir of (process.env.PATH || '').split(':')) {
    const c = path.join(dir, 'anvil');
    if (dir && fs.existsSync(c)) return c;
  }
  assert(false, 'anvil not found — set ANVIL_BIN, install Foundry, or see the install line in this file\'s header');
}
function startAnvil() {
  return spawn(anvilBin(), ['--port', String(PORT), '--chain-id', String(CHAIN_ID), '--silent'], { stdio: 'ignore' });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const anvil = startAnvil();
process.on('exit', () => { try { anvil.kill(); } catch {} });

const { createPublicClient, createWalletClient, http, parseEther, parseUnits, formatEther, formatUnits,
  getAddress, getContractAddress, encodeAbiParameters, keccak256 } = await import('viem');
const { privateKeyToAccount, generatePrivateKey } = await import('viem/accounts');

const chain = { id: CHAIN_ID, name: 'anvil', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });

for (let i = 0; i < 60; i++) { try { await pub.getChainId(); break; } catch { await sleep(250); } }
step('anvil up', `chain ${await pub.getChainId()} on ${RPC}`);

// anvil's first funded account
const DEPLOYER_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const deployer = createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(DEPLOYER_PK) });
const SAFE = deployer.account.address;              // treasury Safe, hook owner, POL position owner

// the DEX bot's own hot key — the one src/dexbot.js signs with
const BOT_PK = generatePrivateKey();
const BOT = privateKeyToAccount(BOT_PK).address;

const rpc = (method, params) => fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json());

async function deploy(art, args, from = deployer) {
  const hash = await from.deployContract({ abi: art.abi, bytecode: art.bytecode, args });
  const r = await pub.waitForTransactionReceipt({ hash });
  assert(r.status === 'success', 'deploy reverted');
  return getAddress(r.contractAddress);
}
async function send(w, address, abi, functionName, args, opts = {}) {
  const hash = await w.writeContract({ address, abi, functionName, args, ...opts });
  const r = await pub.waitForTransactionReceipt({ hash });
  assert(r.status === 'success', `${functionName} reverted`);
  return r;
}

// ── the real v4 stack ────────────────────────────────────────────────────────────────────────────
await rpc('anvil_setCode', [PERMIT2, permit2Runtime()]);
assert((await pub.getCode({ address: PERMIT2 }))?.length > 2, 'Permit2 not etched');
step('Permit2 etched at its canonical address');

const poolManager = await deploy(v4('PoolManager.sol/PoolManager.default.json'), [SAFE]);
const omrArt = ours('OMR');
const omr = await deploy(omrArt, [SAFE]);
const stateView = await deploy(v4('StateView.sol/StateView.json'), [poolManager]);
const posmArt = v4('PositionManager.sol/PositionManager.json');
const posm = await deploy(posmArt, [poolManager, PERMIT2, 100000n, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000']);
const urArt = ur();
const router = await deploy(urArt, [{
  permit2: PERMIT2, weth9: '0x0000000000000000000000000000000000000000',
  v2Factory: '0x0000000000000000000000000000000000000000', v3Factory: '0x0000000000000000000000000000000000000000',
  pairInitCodeHash: '0x' + '00'.repeat(32), poolInitCodeHash: '0x' + '00'.repeat(32),
  v4PoolManager: poolManager, v3NFTPositionManager: '0x0000000000000000000000000000000000000000',
  v4PositionManager: posm, spokePool: '0x0000000000000000000000000000000000000000',
}]);
step('real v4 deployed', `PoolManager ${poolManager.slice(0, 10)}… PositionManager ${posm.slice(0, 10)}… UniversalRouter ${router.slice(0, 10)}…`);

// ── the hook, at an address that carries its own permissions ──────────────────────────────────────
const hookArt = ours('OmertaHook');
const FLAG_MASK = 0x3fffn;
const FLAGS = (1n << 13n) | (1n << 12n) | (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n); // before/afterInitialize, before/afterSwap (+returns-delta)
let minerPk, hookAddr, tries = 0;
for (;;) {
  minerPk = generatePrivateKey();
  const a = privateKeyToAccount(minerPk).address;
  const candidate = getContractAddress({ from: a, nonce: 0n });
  tries++;
  if ((BigInt(candidate) & FLAG_MASK) === FLAGS) { hookAddr = getAddress(candidate); break; }
  assert(tries < 4_000_000, 'could not mine a hook address');
}
await rpc('anvil_setBalance', [privateKeyToAccount(minerPk).address, '0x' + parseEther('10').toString(16)]);
const miner = createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(minerPk) });
const deployed = await deploy(hookArt, [poolManager, omr, SAFE], miner);
assert(deployed === hookAddr, 'hook landed at an unexpected address');
step('OmertaHook mined + deployed', `${hookAddr} (flags 0x${(BigInt(hookAddr) & FLAG_MASK).toString(16)}, ${tries} tries)`);

// the hook's beforeInitialize gate: one side OMR, the other an APPROVED quote currency
await send(deployer, hookAddr, hookArt.abi, 'setAllowedQuote', ['0x0000000000000000000000000000000000000000', true]);

// ── the canonical pool ────────────────────────────────────────────────────────────────────────────
const FEE = 3000, TICK_SPACING = 60;
const key = { currency0: '0x0000000000000000000000000000000000000000', currency1: getAddress(omr),
  fee: FEE, tickSpacing: TICK_SPACING, hooks: hookAddr };
assert(BigInt(key.currency0) < BigInt(key.currency1), 'currency ordering: ETH must sort below OMR');

// 1 ETH = 1000 OMR  →  sqrtPriceX96 = sqrt(price1/price0) · 2^96
const PRICE = 1000;                                     // OMR per ETH, the whole run's anchor
const sqrtPriceX96 = BigInt(Math.floor(Math.sqrt(PRICE) * 2 ** 96 / 2 ** 48)) * (1n << 48n);
const pmAbi = v4('PoolManager.sol/PoolManager.default.json').abi;
await send(deployer, poolManager, pmAbi, 'initialize', [key, sqrtPriceX96]);
step('OMR/ETH pool initialized behind the hook', `~${PRICE} OMR per ETH`);

// seed it with real liquidity through v4-core's own test router
const liqArt = v4('PoolModifyLiquidityTest.sol/PoolModifyLiquidityTest.default.json');
const liqRouter = await deploy(liqArt, [poolManager]);
await send(deployer, omr, omrArt.abi, 'approve', [liqRouter, 2n ** 255n]);
const MIN_TICK = -887220, MAX_TICK = 887220;
await send(deployer, liqRouter, liqArt.abi, 'modifyLiquidity',
  [key, { tickLower: MIN_TICK, tickUpper: MAX_TICK, liquidityDelta: parseEther('30000'), salt: '0x' + '00'.repeat(32) }, '0x'],
  { value: parseEther('2000') });
const poolEth = await pub.getBalance({ address: poolManager });
step('pool seeded with real liquidity', `${Number(formatEther(poolEth)).toFixed(2)} ETH in the PoolManager`);

// ── the oracle the bots actually read (through the bond's own getter) ─────────────────────────────
const oracleArt = ours('GenesisOracle');
const oracle = await deploy(oracleArt, [SAFE, parseUnits(String(PRICE), 18), BigInt(Math.floor(Date.now() / 1000) + 86400)]);
const bondArt = ours('OmertaBond');
const bond = await deploy(bondArt, [SAFE, SAFE, omr, 3750n, 1500n, 2500n, BOT, SAFE, SAFE, SAFE, parseUnits('1000000', 18), parseUnits('10000', 18)]);
await send(deployer, bond, bondArt.abi, 'setOracle', [oracle, 500n, 172800n]);
step('GenesisOracle wired into OmertaBond', `the bots resolve it through bond.oracle()`);

// ── fund the bot ──────────────────────────────────────────────────────────────────────────────────
await rpc('anvil_setBalance', [BOT, '0x' + parseEther('50').toString(16)]);
await send(deployer, omr, omrArt.abi, 'transfer', [BOT, parseUnits('500000', 18)]);
const bot = createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(BOT_PK) });
// the OMR side of a mint is pulled through Permit2 (PositionManager._pay), so both legs are needed
await send(bot, omr, omrArt.abi, 'approve', [PERMIT2, 2n ** 255n]);
const permit2Abi = [{ type: 'function', name: 'approve', stateMutability: 'nonpayable',
  inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint160' }, { type: 'uint48' }], outputs: [] }];
await send(bot, PERMIT2, permit2Abi, 'approve', [omr, posm, (1n << 160n) - 1n, 2 ** 48 - 1]);
step('bot wallet funded + approved', `${BOT.slice(0, 10)}… 50 ETH / 500k OMR`);

// ── the backend, pointed at this chain ────────────────────────────────────────────────────────────
Object.assign(process.env, {
  CHAIN_RPC_URL: RPC, CHAIN_ID: String(CHAIN_ID), DEX_BOT_PK: BOT_PK,
  OMERTA_BOND_ADDRESS: bond, OMR_ADDRESS: omr, OMERTA_HOOK_ADDRESS: hookAddr,
  UNIVERSAL_ROUTER_ADDRESS: router, POSITION_MANAGER_ADDRESS: posm, STATE_VIEW_ADDRESS: stateView,
  POL_POSITION_OWNER: SAFE, DEX_POOL_FEE: String(FEE), DEX_POOL_TICK_SPACING: String(TICK_SPACING),
});
const { makeDb } = await import('../src/db.js');
const pool = await makeDb();
const Dex = await import('../src/dexbot.js');

// ══ 1. THE BUYBACK — the Universal Router's V4_SWAP, for real ═════════════════════════════════════
await pool.query("INSERT INTO vig_revenue (source, ref, gross_eth, vig_eth) VALUES ('fee','e2e-1',5,2)");
const omrBefore = await pub.readContract({ address: omr, abi: omrArt.abi, functionName: 'balanceOf', args: [BOT] });
const buy = await Dex.runDexBuyback(pool, { maxEth: 1 });

assert(!buy.dormant, 'the buyback read as dormant — the env is incomplete');
assert(!buy.skipped?.length, `the buyback refused: ${JSON.stringify(buy.skipped)}`);
assert(buy.swap, 'no swap recorded');
const omrAfter = await pub.readContract({ address: omr, abi: omrArt.abi, functionName: 'balanceOf', args: [BOT] });
const gained = Number(formatUnits(omrAfter - omrBefore, 18));
assert(gained > 0, 'the bot received no OMR');
step('V4_SWAP executed on the real pool', `${buy.swap.ethSpent} ETH → ${gained.toFixed(2)} OMR @ ${buy.swap.priceOmrPerEth}`);

// the slippage floor is the wall only a real fill can test: the achieved price must clear it, and
// the run must not be flagging a breach it silently tolerated.
assert(!buy.slippageBreach, `the fill came in under the floor: ${JSON.stringify(buy.slippageBreach)}`);
assert(buy.swap.priceOmrPerEth > PRICE * 0.90 && buy.swap.priceOmrPerEth < PRICE * 1.10,
  `achieved price ${buy.swap.priceOmrPerEth} is nowhere near the oracle's ${PRICE}`);
step('the achieved price cleared the slippage floor', `${buy.swap.priceOmrPerEth} vs oracle ${PRICE}`);

// the sell tax is armed at zero for launch, so a BUY must cost nothing extra either way
assert(buy.booked.length === 1 && !buy.booked[0].bookedShort, 'the fill did not book cleanly');
step('the fill booked through runVigBuyback', `${buy.booked[0].omrBought} OMR credited`);

// ══ 2. POL PAIRING — PositionManager.modifyLiquidities, for real ══════════════════════════════════
await pool.query('UPDATE bond_reserve SET pol_eth = 2 WHERE id=1');
const botEthBefore = await pub.getBalance({ address: BOT });
const pair = await Dex.runPolPairing(pool, { maxEth: 1 });

assert(!pair.dormant, 'the POL pairing read as dormant');
assert(!pair.skipped?.length, `the POL pairing refused: ${JSON.stringify(pair.skipped)}`);
assert(pair.paired, 'no pairing recorded');
step('MINT_POSITION executed on the real pool', `${pair.paired.ethPaired} ETH + ${pair.paired.omrPaired} OMR`);

// the position belongs to the SAFE, never the hot bot key — POL is the treasury's
const posBal = await pub.readContract({ address: posm, abi: posmArt.abi, functionName: 'balanceOf', args: [SAFE] });
assert(posBal === 1n, `expected exactly one position minted to the Safe, got ${posBal}`);
const botPos = await pub.readContract({ address: posm, abi: posmArt.abi, functionName: 'balanceOf', args: [BOT] });
assert(botPos === 0n, 'the hot bot key holds a POL position — it must never');
step('the position is owned by the Safe', 'the bot key holds none');

// THE ONE A REAL FILL IS THE ONLY WAY TO CATCH. `modifyLiquidities` is payable and v4's DeltaResolver
// settles native ETH out of the periphery contract's OWN balance — it does NOT refund the remainder.
// Liquidity is min(ETH-side, OMR-side), so whichever side is not binding is UNDER-consumed, and any
// over-sent ETH stays in the PositionManager: unreachable, permanently, by anybody. It is bonded POL
// ETH, so the loss is real money.
let strandedEth = await pub.getBalance({ address: posm });
assert(strandedEth === 0n,
  `${formatEther(strandedEth)} ETH is stranded in the PositionManager after a balanced pairing — over-sent ` +
  'msg.value is never refunded; the mint needs a SWEEP action to return the remainder to the bot wallet');
step('no ETH stranded after a balanced pairing', 'the remainder came back');

// AND THE CASE THAT ACTUALLY BITES. The OMR side is sized at the ORACLE price while the liquidity is
// derived from the pool's LIVE sqrtPrice — and a TWAP lags spot by design, so the two disagree in
// normal operation. When the OMR side is the binding one, the ETH side is UNDER-consumed and the
// remainder of msg.value stays in the PositionManager. Drift the oracle under spot and pair again.
await send(deployer, oracle, oracleArt.abi, 'setPrice', [parseUnits(String(Math.round(PRICE * 0.85)), 18), BigInt(Math.floor(Date.now() / 1000) + 86400)]);
await pool.query('UPDATE bond_reserve SET pol_eth = 4 WHERE id=1');
const pair2 = await Dex.runPolPairing(pool, { maxEth: 1 });
assert(pair2.paired, `the second pairing refused: ${JSON.stringify(pair2.skipped)}`);
strandedEth = await pub.getBalance({ address: posm });
assert(strandedEth === 0n,
  `${formatEther(strandedEth)} ETH is stranded in the PositionManager — the oracle lagging spot makes the OMR ` +
  'side bind, the ETH side is under-consumed, and v4 never refunds over-sent msg.value. Real bonded POL ETH, ' +
  'unreachable by anyone. The mint needs a SWEEP action returning the remainder to the bot wallet.');
step('no ETH stranded when the oracle lags spot', 'the remainder came back from the binding-OMR case too');

// THE BOOKS HALF OF THE SAME BUG. `pol_pairings` is the root cap's ONLY book, so recording what was
// SENT rather than what the position actually CONSUMED retires bond budget that never became
// liquidity — the ETH is back in the wallet but can never be paired again. The swept case must book
// materially less than the 1 ETH it was handed.
assert(pair2.paired.ethPaired < 0.99,
  `the pairing booked ${pair2.paired.ethPaired} ETH of the 1 ETH it was handed, but the position consumed less — ` +
  'the swept remainder must not be booked as paired, or the root cap retires budget that never became liquidity');
const bookedPaired = Number((await pool.query('SELECT COALESCE(SUM(eth_paired),0) s FROM pol_pairings WHERE real')).rows[0].s);
step('the books record what the position consumed', `${pair2.paired.ethPaired} ETH booked, ${bookedPaired} ETH paired lifetime`);

const botEthAfter = await pub.getBalance({ address: BOT });
assert(botEthAfter < botEthBefore, 'the bot spent no ETH pairing');
step('POL pairing settled from the bot wallet', `${Number(formatEther(botEthBefore - botEthAfter)).toFixed(4)} ETH out (incl. gas)`);

// ══ 3. the journals + the invariants, over real fills ═════════════════════════════════════════════
const inv = await Dex.runDexBotInvariants(pool);
assert(inv.ok, `dex bot invariants failed over real fills: ${JSON.stringify(inv.checks.filter((c) => !c.ok))}`);
const ledger = Number((await pool.query('SELECT COUNT(*)::int n FROM transactions')).rows[0].n);
assert(ledger === 0, `the chain layer wrote ${ledger} ledger rows — it must write none`);
step('invariants hold over real fills; §10.4 untouched', `${inv.checks.length} checks, 0 ledger rows`);

console.log(`\n✅ dexbot-e2e passed — ${steps.length} asserted steps. The v4 encodings are real:\n` +
  '   the Universal Router accepted V4_SWAP and filled on the canonical pool, PositionManager accepted\n' +
  '   MINT_POSITION and minted POL to the Safe, and no ETH was left behind in either.\n');
anvil.kill();
process.exit(0);

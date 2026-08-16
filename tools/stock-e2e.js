// ── PROVE THE STOCK-DELIVERY RAIL ON A REAL CHAIN ────────────────────────────────────────────────
//
// `src/stockdeliver.js` resolves a Street Deed's ERC-6551 token-bound account and pushes real
// tokenized stock into it. Both legs were BUILT, dormant, and had never executed against a chain —
// the same gap `tools/dexbot-e2e.js` closed for the v4 encodings, and a sharper one, because the
// failure mode is not a wasted remainder but REAL STOCK DELIVERED TO THE WRONG ADDRESS, from which
// nothing recovers it. §3.3's founder decision (gateless push, no claim step) is what makes the
// address the only thing standing between the treasury and a permanent loss.
//
// So this stands the whole rail up on anvil and runs it UNSEAMED — `resolveTbaOnchain` and
// `sendDeliverOnchain` are what execute:
//
//   • the REAL ERC-6551 registry (the reference implementation, vendored unmodified at
//     omerta-contracts/test/vendor — same source as the canonical 0x000000006551… deployment)
//   • our own StreetDeed + StockVault + OMR, off the forge build
//   • a deed minted by a server-signed EIP-712 voucher, so `StreetDeed.claim` runs from JS too
//
// THE ASSERTION THAT MATTERS: the address the BACKEND computed is the address the REGISTRY returns,
// and the account deployed at it reports the deed as its token. Everything else is downstream of
// that being right.
//
//   npm i --no-save --prefix /tmp/v4deps @foundry-rs/anvil       (shared with dexbot-e2e)
//   node tools/stock-e2e.js
//
// Needs the forge build (`omerta-contracts/out`). Exit 0 = the rail is real.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const DEPS = process.env.V4_DEPS || '/tmp/v4deps/node_modules';
const PORT = Number(process.env.ANVIL_PORT || 8549);
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN_ID = 31337;

const steps = [];
const step = (name, detail = '') => { steps.push(name); console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ''}`); };

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const ours = (name, file = name) => {
  const a = readJson(path.join(ROOT, 'omerta-contracts', 'out', `${file}.sol`, `${name}.json`));
  return { abi: a.abi, bytecode: a.bytecode.object };
};

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
const anvil = spawn(anvilBin(), ['--port', String(PORT), '--chain-id', String(CHAIN_ID), '--silent'], { stdio: 'ignore' });
process.on('exit', () => { try { anvil.kill(); } catch {} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { createPublicClient, createWalletClient, http, parseEther, parseUnits, formatUnits,
  getAddress, keccak256, toBytes } = await import('viem');
const { privateKeyToAccount, generatePrivateKey } = await import('viem/accounts');

const chain = { id: CHAIN_ID, name: 'anvil', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });

for (let i = 0; i < 60; i++) { try { await pub.getChainId(); break; } catch { await sleep(250); } }
assert(Number(await pub.getChainId()) === CHAIN_ID, 'anvil did not come up');
step('anvil up', `chain ${CHAIN_ID} on ${RPC}`);

const DEPLOYER_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const deployer = createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(DEPLOYER_PK) });
const SAFE = deployer.account.address;

// the server's voucher signer — the same key the backend signs with, so `claim()` is verifying a
// signature this process produced through the production code path's own domain
const SIGNER_PK = generatePrivateKey();
const SIGNER = privateKeyToAccount(SIGNER_PK);
// the player: a linked wallet that will own the deed and, through it, the vault
const PLAYER_PK = generatePrivateKey();
const PLAYER = privateKeyToAccount(PLAYER_PK).address;
// the delivery keeper — its own key, never the Safe's (the hot/cold split the vault assumes)
const KEEPER_PK = generatePrivateKey();
const KEEPER = privateKeyToAccount(KEEPER_PK).address;

async function deploy(art, args = []) {
  const hash = await deployer.deployContract({ abi: art.abi, bytecode: art.bytecode, args });
  const r = await pub.waitForTransactionReceipt({ hash });
  assert(r.contractAddress, 'deploy produced no address');
  return getAddress(r.contractAddress);
}
async function send(w, address, abi, functionName, args, opts = {}) {
  const hash = await w.writeContract({ address, abi, functionName, args, ...opts });
  const r = await pub.waitForTransactionReceipt({ hash });
  assert(r.status === 'success', `${functionName} reverted`);
  return r;
}

// ── the stack ────────────────────────────────────────────────────────────────────────────────────
const regArt = ours('ERC6551Registry');
const registry = await deploy(regArt);
const acctArt = ours('ERC6551Account');
const accountImpl = await deploy(acctArt);
step('the real ERC-6551 registry deployed', `${registry.slice(0, 10)}… impl ${accountImpl.slice(0, 10)}…`);

const deedArt = ours('StreetDeed');
const deed = await deploy(deedArt, [SAFE, SIGNER.address, 'https://omerta.fun/v1/deeds/plate/', 'https://omerta.fun/deed/']);
const vaultArt = ours('StockVault');
const vault = await deploy(vaultArt, [SAFE, KEEPER, 0n]);   // 0 = no default cap; set a real one below
const omrArt = ours('OMR');
const stock = await deploy(omrArt, [SAFE]);                 // a plain ERC-20 standing in for a stock token
step('StreetDeed + StockVault deployed', `vault keeper ${KEEPER.slice(0, 10)}…`);

// the vault delivers only what it HOLDS — pre-fund it, and cap the token (C2's defaultDailyCap is 0
// here on purpose, so an unconfigured token would be UNLIMITED; the cap is what bounds a leaked key)
await send(deployer, stock, omrArt.abi, 'transfer', [vault, parseUnits('10000', 18)]);
await send(deployer, vault, vaultArt.abi, 'setDailyCap', [stock, parseUnits('1000', 18)]);
await rpcCall('anvil_setBalance', [KEEPER, '0x' + parseEther('10').toString(16)]);
await rpcCall('anvil_setBalance', [PLAYER, '0x' + parseEther('10').toString(16)]);
step('the vault pre-funded and capped', '10000 units held, 1000/day cap');

async function rpcCall(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return (await r.json()).result;
}

// ── the deed, minted by a server-signed voucher ───────────────────────────────────────────────────
const STREET = 'Vermilion Row';
const tokenId = BigInt(keccak256(toBytes(STREET)));
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
const voucher = { to: PLAYER, name: STREET, district: 'neon', nonce: 1n, deadline };
const sig = await SIGNER.signTypedData({
  domain: { name: 'OmertaStreetDeed', version: '1', chainId: CHAIN_ID, verifyingContract: deed },
  types: { DeedVoucher: [
    { name: 'to', type: 'address' }, { name: 'name', type: 'string' }, { name: 'district', type: 'string' },
    { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
  primaryType: 'DeedVoucher', message: voucher });
const player = createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(PLAYER_PK) });
await send(player, deed, deedArt.abi, 'claim', [voucher, sig]);
const deedOwner = await pub.readContract({ address: deed, abi: deedArt.abi, functionName: 'ownerOf', args: [tokenId] });
assert(getAddress(deedOwner) === getAddress(PLAYER), 'the deed did not land with the player');
step('StreetDeed.claim accepted a server-signed voucher', `"${STREET}" → ${PLAYER.slice(0, 10)}…`);

// the tokenId the backend derives must be the one the contract minted — a mismatch here would make
// every vault address wrong downstream, silently
const Chain = await import('../src/chain.js');
assert(Chain.deedTokenId(STREET) === tokenId.toString(),
  `the backend derives tokenId ${Chain.deedTokenId(STREET)} but the contract minted ${tokenId}`);
step('the backend derives the contract\'s own tokenId', `keccak("${STREET}")`);

// ── the backend, pointed at this chain ────────────────────────────────────────────────────────────
Object.assign(process.env, {
  CHAIN_RPC_URL: RPC, CHAIN_ID: String(CHAIN_ID),
  STREET_DEED_ADDRESS: deed, STOCK_VAULT_ADDRESS: vault, STOCK_KEEPER_PK: KEEPER_PK,
  ERC6551_REGISTRY: registry, ERC6551_ACCOUNT_IMPL: accountImpl,
  STOCK_TOKEN_ADDRESSES: JSON.stringify({ TSLA: stock }), STOCK_TOKEN_DECIMALS: '18',
});
const { makeDb } = await import('../src/db.js');
const pool = await makeDb();
const Stock = await import('../src/stockdeliver.js');

// the DB state a delivered allocation needs: a linked wallet, an extracted deed, an owed allocation
const ACCOUNT = '00000000-0000-4000-8000-00000000beef';
await pool.query('INSERT INTO accounts (id, auth_provider, auth_subject) VALUES ($1,$2,$3)', [ACCOUNT, 'guest', 'stock-e2e']);
await pool.query('INSERT INTO account_persistent (account_id, wallet_address, minted) VALUES ($1,$2,true)',
  [ACCOUNT, PLAYER.toLowerCase()]);
// the post-extraction shape: the row is re-keyed to the synthetic on-chain owner, and
// `extracted_by_account` is what still ties it to the player (chain.js:markDeedExtracted)
await pool.query(
  `INSERT INTO street_deeds (account_id, name, name_lc, district, onchain_token_id, extracted_by_account, extracted_at)
   VALUES ($1,$2,$3,$4,$5,$6,now())`,
  [`onchain:${tokenId}`, STREET, STREET.toLowerCase(), 'neon', tokenId.toString(), ACCOUNT]);
await pool.query(
  "INSERT INTO stock_allocations (epoch_id, account_id, ticker, units, delivered) VALUES (1,$1,'TSLA',25,false)",
  [ACCOUNT]);

// ══ 1. THE ADDRESS — the leg a mistake makes unrecoverable ════════════════════════════════════════
const tba = await Stock.resolveTba(tokenId.toString());
assert(tba && /^0x[0-9a-fA-F]{40}$/.test(tba), `the resolver returned ${tba}`);

// the registry, asked directly, must agree — this is the whole assertion
const registryAnswer = await pub.readContract({ address: registry, abi: regArt.abi, functionName: 'account',
  args: [accountImpl, '0x' + '00'.repeat(32), BigInt(CHAIN_ID), deed, tokenId] });
assert(getAddress(tba) === getAddress(registryAnswer),
  `the backend computed ${tba} but the canonical registry says ${registryAnswer} — stock would go somewhere unrecoverable`);
step('the backend\'s TBA is the registry\'s TBA', `${tba.slice(0, 14)}…`);

// and it is genuinely THIS deed's account: deploy it and ask what token it belongs to
await send(player, registry, regArt.abi, 'createAccount',
  [accountImpl, '0x' + '00'.repeat(32), BigInt(CHAIN_ID), deed, tokenId]);
const bound = await pub.readContract({ address: getAddress(tba), abi: acctArt.abi, functionName: 'token' });
assert(Number(bound[0]) === CHAIN_ID && getAddress(bound[1]) === getAddress(deed) && BigInt(bound[2]) === tokenId,
  `the account at ${tba} is bound to ${JSON.stringify(bound.map(String))}, not to this deed`);
step('the account at that address is bound to the deed', `token(${CHAIN_ID}, StreetDeed, ${STREET})`);

// ══ 2. THE DELIVERY — StockVault.deliver, for real ════════════════════════════════════════════════
const before = await pub.readContract({ address: stock, abi: omrArt.abi, functionName: 'balanceOf', args: [getAddress(tba)] });
assert(before === 0n, 'the vault address already held stock');
const run = await Stock.runStockDeliveryKeeper(pool);
assert(!run.dormant, 'the delivery keeper read as dormant — the env is incomplete');
assert(run.sent?.length === 1, `expected one delivery, got ${JSON.stringify(run)}`);
const after = await pub.readContract({ address: stock, abi: omrArt.abi, functionName: 'balanceOf', args: [getAddress(tba)] });
assert(after === parseUnits('25', 18), `the TBA holds ${formatUnits(after, 18)} units, expected 25`);
step('StockVault.deliver landed the units in the deed\'s vault', `${formatUnits(after, 18)} TSLA`);

// the tokens are there whether or not anything was ever deployed at that address — worth stating,
// because it is why an undeployed account is not a reason to withhold a delivery
step('delivery does not require the account to exist first', 'the address is counterfactual; the balance is not');

// ══ 3. SEND AND SETTLE ARE TWO AUTHORITIES ════════════════════════════════════════════════════════
// The keeper NEVER confirms: only the `Delivered` watcher may flip an allocation, so a sent tx that
// never lands cannot mark stock delivered.
const staged = (await pool.query('SELECT status, tx_hash, tba FROM stock_deliveries')).rows;
assert(staged.length === 1 && staged[0].status === 'pending', `expected one pending row, got ${JSON.stringify(staged)}`);
assert(getAddress(staged[0].tba) === getAddress(tba), 'the staged row recorded a different address than it delivered to');
const undelivered = (await pool.query('SELECT delivered FROM stock_allocations')).rows[0];
assert(undelivered.delivered === false, 'the keeper marked the allocation delivered — only the watcher may');
step('the keeper sends but never settles', 'the allocation is still owed until the log lands');

// now the watcher, over the real log. It deliberately stays CHAIN_CONFIRMATIONS behind head (a
// shallow reorg must never settle a delivery), so the fresh tx is NOT yet visible to it — mine past
// the depth, which is what waiting a few blocks does in production.
const { makeViemSource, syncStockDeliveredEvents } = await import('../src/watcher.js');
const source = await makeViemSource();
assert(source, 'the watcher source read as dormant');
const early = await syncStockDeliveredEvents(pool, source, { startBlock: 0 });
assert(!early.processed, 'the watcher settled a delivery that is not yet confirmation-deep');
await rpcCall('anvil_mine', ['0x8']);
// a fresh source, because viem caches the block number per client (a worker tick is minutes apart,
// so the cache never matters in production — here two syncs land inside one cache window)
const deep = await syncStockDeliveredEvents(pool, await makeViemSource(), { startBlock: 0 });
assert(deep.processed === 1, `the confirmation-deep sync processed ${deep.processed} logs, expected 1`);
const settled = (await pool.query('SELECT status, tx_hash FROM stock_deliveries')).rows[0];
assert(settled.status === 'delivered', `the watcher left the row ${settled.status}`);
assert(settled.tx_hash && /^0x[0-9a-f]{64}$/i.test(settled.tx_hash), 'the confirmed row carries no tx hash');
const done = (await pool.query('SELECT delivered FROM stock_allocations')).rows[0];
assert(done.delivered === true, 'the watcher did not flip the allocation');
step('the Delivered log confirmed it', `${settled.tx_hash.slice(0, 12)}…`);

// a second run must not re-send: the delivery id is deterministic and the row is no longer pending
const again = await Stock.runStockDeliveryKeeper(pool);
assert(!again.sent?.length, `the keeper re-sent a settled delivery: ${JSON.stringify(again.sent)}`);
const rows = (await pool.query('SELECT COUNT(*)::int n FROM stock_deliveries')).rows[0].n;
assert(rows === 1, `a second run created ${rows} rows — the delivery id is not deterministic`);
step('a settled delivery is never re-sent', 'the deterministic id holds across runs');

// ══ 4. the walls, over a real fill ════════════════════════════════════════════════════════════════
const inv = await (await import('../src/treasury.js')).runTreasuryInvariants(pool);
const wall = inv.checks.find((c) => /delivered <= allocated/.test(c.name));
assert(wall && wall.ok, `the delivered-vs-allocated wall failed over a real delivery: ${JSON.stringify(wall)}`);
const ledger = Number((await pool.query('SELECT COUNT(*)::int n FROM transactions')).rows[0].n);
assert(ledger === 0, `the stock rail wrote ${ledger} ledger rows — it is out-of-band real value`);
step('the walls hold over a real delivery; §10.4 untouched', `${inv.checks.length} checks, 0 ledger rows`);

console.log(`\n✅ stock-e2e passed — ${steps.length} asserted steps. The stock rail is real:\n` +
  '   the deed minted from a server-signed voucher, the backend computed the same token-bound account\n' +
  '   the canonical registry does, StockVault delivered into it, and only the log settled it.\n');
anvil.kill();
process.exit(0);

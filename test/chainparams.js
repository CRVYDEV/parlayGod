// THE CONTROL ROOM — the on-chain parameter panel.
//
// The property this file exists to defend is not "the panel renders". It is that the panel CANNOT
// SIGN. Every setter it knows about is `onlyOwner` with owner = the multisig Safe, and if a mod-key
// session could execute them, that shared bearer header would be equivalent to the multisig — so
// "the Safe owns everything" would become a false statement in front of an auditor. The first block
// below is therefore a structural check on the module's own surface, not a behavioural one: a route
// or an export that could send a transaction must not appear, and no test can prove that after the
// fact if one is added.
//
// The second thing worth testing is the CALLDATA, because a wrong encoding handed to a Safe is the
// one failure here with no recovery: it is signed by humans who are trusting this output, and it
// executes a different call than the one on screen. So the selector and the decoded arguments are
// checked against viem independently rather than against the same encoder that produced them.

import assert from 'node:assert';
import fs from 'node:fs';
import { CHAIN_PARAMS, readChainParams, buildParamTx } from '../src/chainparams.js';
import { BONDS, SELL_TAX, MINT_TRANCHES } from '../src/rules.js';

// ── IT CANNOT SIGN, AND IT MUST NOT BECOME ABLE TO ───────────────────────────────────────────────
{
  // Comments stripped first, the levers-guard discipline: a signing symbol NAMED in prose is not a
  // signing path, and this file necessarily talks about the signer key it must never touch. Without
  // this the check fires on its own documentation — and a guard that cries wolf gets deleted.
  const src = fs.readFileSync('src/chainparams.js', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/[^\n'"`]*$/gm, '');
  // Every token here is a viem symbol or env name that CONSTITUTES a signing path — none can appear
  // innocently. `_PK` was tried and dropped: it matches VOUCHER_SIGNER_PK, which this module names in
  // its own on-screen copy for a good reason ("the contract's signer must equal the backend's"), so
  // it fired on the very sentence telling the founder what the field means. A guard that flags
  // correct prose teaches people to ignore it.
  for (const forbidden of ['walletClient', 'createWalletClient', 'writeContract', 'sendTransaction',
    'privateKeyToAccount', 'signTransaction', 'PRIVATE_KEY']) {
    assert(!src.includes(forbidden),
      `src/chainparams.js references ${forbidden} — this module must be incapable of executing a `
      + 'transaction. Every setter it knows is onlyOwner/Safe, so a signing path here would make the '
      + 'shared MOD_KEY equivalent to the multisig.');
  }
  const routes = fs.readFileSync('src/routes/modtools.js', 'utf8');
  assert(!/\/v1\/mod\/chain\/(send|execute|write)/.test(routes),
    'no execute route may be mounted for chain parameters — the panel prepares, the Safe signs');
}

// ── THE REGISTRY IS COMPLETE ENOUGH TO BE TRUSTED ────────────────────────────────────────────────
// A control room that silently omits a parameter is worse than none: the founder reads it as the
// whole surface. So every row must carry the four things that make it usable by a human who did not
// write the contract — what it does, what breaks, what the contract itself refuses, and the setter.
{
  assert(CHAIN_PARAMS.length >= 15, `the registry covers ${CHAIN_PARAMS.length} parameters — too few to be the control room`);
  const seen = new Set();
  for (const p of CHAIN_PARAMS) {
    assert(!seen.has(p.key), `duplicate parameter key: ${p.key}`);
    seen.add(p.key);
    assert(p.contract && p.env && p.label, `${p.key} is missing contract/env/label`);
    assert(p.write?.fn && Array.isArray(p.write.args) && p.write.args.length, `${p.key} has no setter`);
    assert(p.why && p.why.length > 40, `${p.key} does not say what breaks if it is wrong — a number without its consequence is how a wrong one gets typed confidently`);
    assert(p.wall && p.wall.length > 10, `${p.key} does not state what the contract itself refuses`);
  }
  // The four walls that replaced "nothing mints" must each be reachable here, by name.
  for (const k of ['bond.dailyCap', 'bond.maxRate', 'bond.oracle', 'omr.minter'])
    assert(seen.has(k), `${k} is missing — it is one of the walls that replaced the fixed supply cap`);
  // …and THE BANK, which is in the audit batch and was absent from the working record for a while.
  for (const k of ['alchemist.ltv', 'transmuter.buffer', 'nusd.minter'])
    assert(seen.has(k), `${k} is missing — THE BANK's parameters are as load-bearing as the token's`);
}

// ── LOCKSTEP: the check no single layer can perform on itself ─────────────────────────────────────
// This is the feature that earns the panel's place. The bond's ETH split was three-way on-chain and
// four-way in the backend, so the treasury's slice was ZERO on every real bond — and BOTH bond
// invariants stayed green, because the Vig remainder absorbed it exactly. Nothing inside either
// layer could see it. The mirror text is what puts the two numbers side by side.
{
  const bondRow = CHAIN_PARAMS.find((p) => p.key === 'bond.recipients');
  assert(bondRow.mirror().value.includes(String(BONDS.POL_BPS)), 'the bond split mirror quotes the POL bps');
  // …and that it READS the lever rather than restating a literal that happens to match today. The
  // containment check above cannot tell those apart — it passed against a hardcoded 3750 — so
  // perturb the source and require the mirror to follow. Same shape as preflight's rot check: the
  // only comparison that means anything is the one that crosses the copy.
  {
    const was = BONDS.POL_BPS;
    try {
      BONDS.POL_BPS = 4242;
      assert(bondRow.mirror().value.includes('4242'),
        'the bond split mirror must READ BONDS.POL_BPS — a literal that matches today silently stops '
        + 'tracking the lever the moment it moves, which is exactly the drift the mirror exists to catch');
    } finally { BONDS.POL_BPS = was; }
  }

  const feeRow = CHAIN_PARAMS.find((p) => p.key === 'fees.fees');
  const fm = feeRow.mirror();
  for (const w of MINT_TRANCHES.map((t) => t.eth))
    assert(fm.value.includes(String(w)), `the fee mirror must show published wave ${w} — the tranche boundary IS this transaction`);

  // The bond-discount / sell-tax RELATION, surfaced as an alert rather than a number. At 800 vs 900
  // an immediate flip returns 1.08 x 0.91 = 0.983 and loses money; let the discount reach the tax and
  // bonding becomes a subsidy on selling, paid to the most motivated bypass-seeker OMR will have.
  const hook = CHAIN_PARAMS.find((p) => p.key === 'hook.sellTax');
  assert.equal(hook.relation(), null, 'at the shipped values a bond is a hold, so no alert fires');
  const shipped = SELL_TAX.BPS;
  assert(BONDS.DISCOUNT_BPS < shipped, `the discount (${BONDS.DISCOUNT_BPS}) must sit strictly below the tax (${shipped})`);
}

// ── THE CALLDATA IS RIGHT, CHECKED AGAINST A SECOND ENCODER ──────────────────────────────────────
// A wrong encoding is the only unrecoverable failure this panel has: a human signs it in the Safe
// believing the screen. So decode it back rather than trusting the encoder that produced it.
{
  process.env.OMERTA_BOND_ADDRESS = '0x1111111111111111111111111111111111111111';
  const tx = await buildParamTx('bond.dailyCap', { cap: '27000000000000000000000' });
  assert.equal(tx.to, process.env.OMERTA_BOND_ADDRESS);
  assert.equal(tx.value, '0', 'a parameter change never carries ETH');

  const { toFunctionSelector, decodeFunctionData } = await import('viem');
  assert.equal(tx.data.slice(0, 10), toFunctionSelector('setDailyCap(uint256)'),
    'the selector must be setDailyCap(uint256) — a wrong one calls a different function entirely');
  const decoded = decodeFunctionData({
    abi: [{ type: 'function', name: 'setDailyCap', inputs: [{ name: 'cap', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' }],
    data: tx.data,
  });
  assert.equal(decoded.functionName, 'setDailyCap');
  assert.equal(decoded.args[0].toString(), '27000000000000000000000',
    'the encoded argument must be exactly what was typed — this is the number a human signs');
  assert(tx.next.includes('Safe'), 'every build says where it has to go, because this is not the last step');
}

// ── IT REFUSES BEFORE THE SAFE HAS TO ────────────────────────────────────────────────────────────
// A reverted Safe transaction is an expensive, confusing way to learn you typed the wrong thing.
{
  const rejects = async (key, values, needle) => {
    await assert.rejects(() => buildParamTx(key, values), (e) => {
      assert(String(e.message).includes(needle), `expected "${needle}", got "${e.message}"`);
      return true;
    });
  };
  await rejects('bond.dailyCap', {}, 'missing argument');
  await rejects('bond.dailyCap', { cap: '-5' }, 'cannot be negative');
  await rejects('bond.dailyCap', { cap: '1.5' }, 'whole number');
  await rejects('bond.signer', { signer: '0xnothex' }, 'not a valid address');
  await rejects('nope.nothing', {}, 'unknown parameter');

  delete process.env.OMR_ADDRESS;
  await rejects('omr.minter', { minter: '0x2222222222222222222222222222222222222222' },
    'OMR_ADDRESS is unset');
}

// ── CHAIN-DORMANT, AND HONEST ABOUT IT ───────────────────────────────────────────────────────────
// The whole chain layer is dormant by default. A panel that reported "no getter" for a value it
// simply could not reach would be stating something false about the contract — the class this
// project keeps finding (a screen that withholds or misstates its own terms).
{
  const saved = process.env.CHAIN_RPC_URL;
  delete process.env.CHAIN_RPC_URL;
  const board = await readChainParams();
  assert.equal(board.configured, false, 'with no RPC the board reports dormant rather than erroring');
  assert(board.why.includes('dormant'), 'and says why');
  assert(board.rows.length === CHAIN_PARAMS.length, 'every row is still listed — the walls and mirrors do not need a chain');
  assert(board.rows.every((r) => r.live === null), 'no row invents a value it could not read');
  const withGetter = board.rows.find((r) => r.key === 'bond.dailyCap');
  assert.equal(withGetter.hasGetter, true,
    'the row says it HAS a getter, so the panel can distinguish "chain dormant" from "no getter" — '
    + 'reporting the second when the first is true states something false about the contract');
  if (saved) process.env.CHAIN_RPC_URL = saved;
}

console.log('✅ THE CONTROL ROOM passed — the panel can read every on-chain parameter and prepare a '
  + 'change, and is structurally incapable of executing one: no signing client, no key, no execute '
  + 'route, so a compromised admin session is still bounded by the Safe. The calldata is decoded back '
  + 'with an independent encoder because a human signs it believing the screen; the walls refuse a bad '
  + 'value before the Safe has to; the lockstep mirrors quote LIVE backend levers rather than restated '
  + 'literals (the drift that made the bond treasury slice zero on every real bond while both '
  + 'invariants stayed green); and with no RPC it reports dormant rather than misstating the contract.');

// THE CONTROL ROOM — every on-chain parameter, what it is set to, and what it must agree with.
//
// Founder-directed 2026-08-11: "a GUI on the admin panel where I can edit all the variables of the
// smart contracts like bond discount etc."
//
// ── WHAT THIS DOES NOT DO, AND WHY THAT IS THE DESIGN ─────────────────────────────────────────────
// It does not execute anything. It READS the live values, VALIDATES a proposed change against the
// walls, and EMITS the calldata for the Safe to sign.
//
// Every setter below is `onlyOwner`, owner = the multisig Safe, and that is load-bearing rather than
// ceremonial: `OmertaBond.dailyCapOMR` is "the entire blast radius of a leaked signer key", `OMR`'s
// tax cannot be raised past a compile-time wall, and `omerta-contracts/CLAUDE.md` rule 2 calls these
// "audit-surface decisions for humans". If this panel could sign, the shared `MOD_KEY` — a bearer
// header, held in a browser's sessionStorage, logged only to IP granularity — would become
// EQUIVALENT TO THE MULTISIG. The entire security model would collapse into one HTTP header, and an
// auditor pointed at "the Safe owns everything" would be reading a false statement.
//
// There is deliberately no "safe subset" carve-out either. Every setter here is load-bearing by
// construction — that is precisely why the contracts give none of them a second, lesser role.
//
// So the flow is: SEE everything (impossible today without a developer), get told what disagrees
// with what, get the exact calldata, and take it to the Safe. The Safe still signs. That is a
// smaller change to the trust model than a "read-only dashboard" sounds — because the thing that
// was actually missing was VISIBILITY, not authority.
//
// ── THE FEATURE THAT EARNS ITS PLACE: LOCKSTEP ────────────────────────────────────────────────────
// Several of these numbers are DUPLICATED in the backend, in a different language, in a different
// process, deployed separately. That has already gone wrong twice:
//   - the bond's ETH split was three-way on-chain and four-way in the backend, so the treasury's
//     slice was ZERO on every real bond and both bond invariants stayed green (the Vig remainder
//     absorbed it exactly) — it would have surfaced months after mainnet as "why is the float empty".
//   - the mint fee follows a published five-wave schedule executed BY HAND, one Safe tx per boundary,
//     and nothing but a preflight warning relates the two.
// Each row below names its backend counterpart, so the panel shows both numbers side by side and
// says which disagree. That is the check no single layer can perform on itself.

import { BONDS, SELL_TAX, MINT_TRANCHES, STORE } from './rules.js';

const bps = { unit: 'bps', hint: '100 = 1%' };
const wei = { unit: 'wei', hint: 'ETH in wei (1 ETH = 1e18)' };
const omr = { unit: 'OMR', hint: 'OMR in 18dp base units' };
const secs = { unit: 'seconds' };

/// The registry. One row per owner-only parameter that is worth a human decision.
///
/// `read`   — the view function that returns the live value (null = write-only, no getter).
/// `write`  — the setter, with its argument list. `args` maps the form's fields onto the call.
/// `wall`   — what the contract itself refuses. Stated so the panel can refuse it FIRST, with the
///            reason, instead of letting the founder discover it as a reverted Safe transaction.
/// `mirror` — the backend value this must equal, and where it lives. The lockstep check.
/// `why`    — what breaks if this is wrong. Shown on the row; this is a control room, and a number
///            without its consequence is how a wrong one gets typed confidently.
export const CHAIN_PARAMS = [
  // ── ISSUANCE: the four walls that replaced "nothing mints" ──────────────────────────────────────
  {
    key: 'bond.dailyCap', contract: 'OmertaBond', env: 'OMERTA_BOND_ADDRESS',
    label: 'Daily mint cap', ...omr,
    read: 'dailyCapOMR', write: { fn: 'setDailyCap', args: ['cap'] },
    wall: '0 means UNLIMITED — a deploy that leaves this at 0 has no wall at all.',
    why: 'WALL 1. With no tranche, this is the entire blast radius of a leaked quote-signer key, and '
      + 'therefore the most load-bearing number in the system. Size it against POOL DEPTH, not supply '
      + '(npm run dials): a full day of it dumped should move the price no more than ~10%.',
  },
  {
    key: 'bond.maxRate', contract: 'OmertaBond', env: 'OMERTA_BOND_ADDRESS',
    label: 'Max OMR per ETH (post-discount)', ...omr,
    read: 'maxOmrPerEth', write: { fn: 'setMaxRate', args: ['maxOmrPerEth'] },
    wall: 'FAIL-CLOSED at 0 — zero refuses every bond rather than allowing any rate.',
    why: 'WALL 3, the absolute ceiling. It is checked INDEPENDENTLY of the oracle, which is what makes '
      + 'a price feed on a mint path safe: a manipulated oracle can only ever TIGHTEN the bound, never '
      + 'raise it. Do not collapse walls 3 and 4 into one.',
  },
  {
    key: 'bond.oracle', contract: 'OmertaBond', env: 'OMERTA_BOND_ADDRESS',
    label: 'Accretion oracle + tolerance + max age', unit: 'address, bps, seconds',
    read: 'oracle', write: { fn: 'setOracle', args: ['oracle', 'toleranceBps', 'maxAge'] },
    wall: 'Tolerance is hard-capped at 2000 bps. maxAge 0 = unset = every bond refuses.',
    why: 'WALL 4, and the launch\'s one cutover: the genesis window runs on GenesisOracle, then this '
      + 'is repointed at OmrTwapOracle when the pool exists. A gap between the two is a bond outage. '
      + 'maxAge should be ~3x the keeper interval — enough to survive two missed pokes and no more.',
  },
  {
    key: 'bond.recipients', contract: 'OmertaBond', env: 'OMERTA_BOND_ADDRESS',
    label: 'ETH split recipients (POL / dev / treasury / vig)', unit: 'addresses',
    read: 'polBps', write: { fn: 'setRecipients', args: ['pol', 'dev', 'rwa', 'vig'] },
    wall: 'No zero addresses. The treasury and Vig recipients MUST be different keys — setting them '
      + 'equal silently re-creates the custody defect the four-way split was built to fix.',
    why: 'The bps themselves are IMMUTABLE on purpose (on-chain/off-chain drift), so this is the only '
      + 'part of the split that can move. The backend books four slices; the contract forwards four. '
      + 'The read shows polBps so the immutable side is VISIBLE beside the mirror; the worker checks '
      + 'all four hourly (vig.js:chainParity) because an eyeball nobody uses is not a check.',
    mirror: () => ({
      label: 'backend BONDS.*_BPS (the split these addresses receive)',
      value: `POL ${BONDS.POL_BPS} / dev ${BONDS.DEV_BPS} / treasury ${BONDS.RWA_BPS} / vig ${
        10000 - BONDS.POL_BPS - BONDS.DEV_BPS - BONDS.RWA_BPS} bps`,
    }),
  },
  {
    key: 'bond.signer', contract: 'OmertaBond', env: 'OMERTA_BOND_ADDRESS',
    label: 'Quote signer', unit: 'address',
    read: 'signer', write: { fn: 'setSigner', args: ['signer'] },
    wall: 'Must match the backend\'s VOUCHER_SIGNER_PK address, or every honest quote reverts.',
    why: 'The crown jewel. Rotating it here is the response to a suspected key compromise — and it is '
      + 'the cheap half: the expensive half is that in-flight signed quotes stop working.',
  },
  {
    key: 'genesis.price', contract: 'GenesisOracle', env: 'GENESIS_ORACLE_ADDRESS',
    label: 'Genesis price + window end', unit: 'OMR per ETH, unix seconds',
    read: 'price', write: { fn: 'setPrice', args: ['price', 'validUntil'] },
    wall: 'validUntil must be in the future unless price is 0. price 0 = the window is CLOSED (the '
      + 'kill switch — zero is already the interface\'s "no usable reading").',
    why: 'The administered price the genesis bonding window runs on, before the pool its TWAP would '
      + 'read exists. The window is the ONLY thing bounding this feed, so set validUntil to the real '
      + 'close and no further.',
  },

  // ── THE MARKET: the sell tax, in two layers that must agree ──────────────────────────────────────
  {
    key: 'hook.sellTax', contract: 'OmertaHook', env: 'OMERTA_HOOK_ADDRESS',
    label: 'v4 pool sell tax (total / dev / treasury / community)', ...bps,
    read: 'sellTaxBps', write: { fn: 'setSellTax', args: ['bps', 'devBps', 'rwaBps', 'communityBps'] },
    wall: 'Hard-capped at MAX_SELL_TAX_BPS (1000). The LP slice is the REMAINDER — do not pass it, or '
      + 'three independent divisions leave a wei owned by nobody.',
    why: 'The live tax on the canonical pool. There is deliberately NO pause on the hook, so '
      + 'setSellTax(0,0,0,0) IS the off switch: the fee stops and the pool keeps trading.',
    mirror: () => ({ label: 'backend SELL_TAX', value: `${SELL_TAX.BPS} total / ${SELL_TAX.DEV_BPS} dev / ${SELL_TAX.RWA_BPS} treasury / ${Number(process.env.SELL_TAX_COMMUNITY_BPS ?? 0)} community bps` }),
    relation: () => (BONDS.DISCOUNT_BPS >= SELL_TAX.BPS
      ? `BOND DISCOUNT (${BONDS.DISCOUNT_BPS}) IS NOT BELOW THE TAX (${SELL_TAX.BPS}) — a bond flipped `
        + 'straight back through the pool now makes money, so bonding is a subsidy on selling rather '
        + 'than capital formation. The bonder holds known size on a known schedule and is the most '
        + 'motivated bypass-seeker OMR will have.'
      : null),
  },
  {
    key: 'omr.sellTax', contract: 'OMR', env: 'OMR_ADDRESS',
    label: 'ERC-20 sell tax — THE BACKSTOP (total / dev / treasury / community)', ...bps,
    read: 'sellTaxBps', write: { fn: 'setSellTax', args: ['bps', 'devBps', 'rwaBps', 'communityBps'] },
    wall: 'Hard-capped at MAX_SELL_TAX_BPS (1000) — the anti-rug wall. LP is the remainder.',
    why: 'ARMED AT ZERO on purpose. A hook tax is a property of ONE pool and anyone may open an '
      + 'unhooked one; this one is universal. The trigger to arm it is not "we lost some tax" — it is '
      + '"bonds have become an arbitrage".',
  },
  {
    key: 'omr.pair', contract: 'OMR', env: 'OMR_ADDRESS',
    label: 'Register / unregister an AMM pair', unit: 'address, bool',
    read: null, write: { fn: 'setPair', args: ['pair', 'isPair'] },
    wall: 'Only transfers INTO a registered pair are taxed. Buys and wallet transfers never are.',
    why: 'Which pools the ERC-20 backstop applies to. Registering the wrong address taxes nothing; '
      + 'it does not break anything.',
  },
  {
    key: 'omr.minter', contract: 'OMR', env: 'OMR_ADDRESS',
    label: 'Minter (the bond contract)', unit: 'address',
    read: 'minter', write: { fn: 'setMinter', args: ['minter'] },
    wall: 'There is NO owner mint. address(0) is minting OFF.',
    why: 'setMinter(0) is the one-transaction emergency stop for ALL issuance, and the reason "the '
      + 'Safe was compromised" and "supply was inflated" stay two separate events. Arm it LAST at '
      + 'deploy, after both caps are real values.',
  },

  // ── FEES: the published schedule, executed by hand ───────────────────────────────────────────────
  {
    key: 'fees.fees', contract: 'OmertaFees', env: 'OMERTA_FEES_ADDRESS',
    label: 'Mint fee + respawn fee', ...wei,
    read: 'mintFee', write: { fn: 'setFees', args: ['mintFee', 'respawnFee'] },
    wall: 'Zero-fee floor: a fee of 0 is refused.',
    why: 'THE TRANCHE BOUNDARY IS THIS TRANSACTION. The mint price is a published five-wave schedule '
      + 'and each boundary is executed by hand — one setFees, plus the backend env. The panel shows '
      + 'the wave you should be on against the wave you are on.',
    mirror: () => ({
      label: 'published MINT_TRANCHES + the backend MINT_FEE_ETH',
      value: `waves ${MINT_TRANCHES.map((t) => t.eth).join(' / ')} ETH; backend is at ${
        Number(process.env.MINT_FEE_ETH ?? MINT_TRANCHES[0].eth)} ETH`,
    }),
  },
  {
    key: 'fees.reroll', contract: 'OmertaFees', env: 'OMERTA_FEES_ADDRESS',
    label: 'Re-roll fee', ...wei,
    read: 'rerollFee', write: { fn: 'setRerollFee', args: ['rerollFee'] },
    wall: 'Zero-fee floor.', why: 'Defaults to the mint fee. A paid build re-roll, infinitely repeatable.',
  },

  // ── THE BRIDGE + THE ASSET CAPS ─────────────────────────────────────────────────────────────────
  {
    key: 'voucher.dailyCap', contract: 'VoucherClaim', env: 'VOUCHER_CLAIM_ADDRESS',
    label: 'Withdrawal daily cap', ...omr,
    read: 'dailyCapOMR', write: { fn: 'setDailyCap', args: ['cap'] },
    wall: 'Bounds a leaked signer on the WITHDRAWAL rail, the same way the bond cap bounds issuance.',
    why: 'The bridge transfers pre-funded OMR only — it mints nothing — so this caps how fast a '
      + 'compromised signer could drain the funded tranche, not how much can exist.',
  },
  {
    key: 'gear.cap', contract: 'GearVault', env: 'GEAR_VAULT_ADDRESS',
    label: 'Per-gearId lifetime supply cap', unit: 'gearId, count',
    read: null, write: { fn: 'setGearCap', args: ['gearId', 'cap'] },
    wall: 'FAIL-CLOSED at 0 — an unset cap mints nothing, even with a valid signature.',
    why: 'The authoritative supply bound lives on the durable ASSET, not the swappable bridge, so it '
      + 'survives a minter swap. Every new tokenId needs one set before it can be claimed.',
  },
  {
    key: 'staking.apy', contract: 'OMRStaking', env: 'OMR_STAKING_ADDRESS',
    label: 'Staking APY', ...bps,
    read: 'apyBps', write: { fn: 'setApy', args: ['bps'] },
    wall: 'Hard-capped at MAX_APY_BPS.',
    why: 'Pays only from the funded pool — it cannot mint, so a high APY drains the pool faster '
      + 'rather than inflating supply.',
  },

  // ── THE BANK ────────────────────────────────────────────────────────────────────────────────────
  {
    key: 'alchemist.ltv', contract: 'Alchemist', env: 'ALCHEMIST_ADDRESS',
    label: 'Max LTV', ...bps,
    read: 'ltvBps', write: { fn: 'setLtvBps', args: ['bps'] },
    wall: 'Compile-time ceiling.',
    why: 'There is NO oracle on the borrow path and no liquidate() anywhere — the market is '
      + 'denomination-matched, so a borrow decision never reads a price. Raising LTV raises how much '
      + 'of a SLEEVE loss the buffer must absorb, not price risk.',
  },
  {
    key: 'alchemist.caps', contract: 'Alchemist', env: 'ALCHEMIST_ADDRESS',
    label: 'Mint caps (per block / per day)', unit: 'DNR',
    read: null, write: { fn: 'setMintCaps', args: ['perBlock', 'perDay'] },
    wall: 'Flow caps bound worst-case issuance without gating who may borrow.',
    why: 'The atomicity defense: a per-block cap is what makes a flash-loan-scale borrow impossible '
      + 'without an allowlist that would also block honest contract users.',
  },
  {
    key: 'transmuter.buffer', contract: 'Transmuter', env: 'TRANSMUTER_ADDRESS',
    label: 'Buffer floor', ...bps,
    read: 'bufferFloorBps', write: { fn: 'setBufferFloorBps', args: ['bps'] },
    wall: 'Compile-time minimum. Gates MINT, never REDEEM — the protocol must stop issuing before it '
      + 'stops paying.',
    why: '⚠ SEED THE BUFFER BEFORE ARMING THE MARKET. At zero supply the required buffer is zero, so '
      + 'the first borrow always passes; the instant supply is non-zero the floor demands real '
      + 'backing, and reserves come only from repay/harvest. An unseeded market takes ONE borrow and '
      + 'deadlocks, looking like a healthy config.',
  },
  {
    key: 'transmuter.caps', contract: 'Transmuter', env: 'TRANSMUTER_ADDRESS',
    label: 'Redeem caps (per block / per day)', unit: 'DNR',
    read: null, write: { fn: 'setRedeemCaps', args: ['perBlock', 'perDay'] },
    wall: 'Redemption has NO same-block guard and NO caller allowlist, deliberately.',
    why: 'Redemption arbitrage is what repairs the peg, and most of it is executed by contracts — an '
      + 'allowlist there would block the defense while claiming to be one. Flow caps bound a drain '
      + 'without gating who may repair the peg.',
  },
  {
    key: 'denari.minter', contract: 'Denari', env: 'DENARI_ADDRESS',
    label: 'Denari (DNR) minter', unit: 'address',
    read: 'minter', write: { fn: 'setMinter', args: ['minter'] },
    wall: 'setMinter(0) halts ISSUANCE without touching redemption — and that asymmetry is the point.',
    why: 'The Bank\'s emergency stop. Do not "simplify" it into a pause that covers both directions.',
  },
];

/// Minimal ABI fragments, derived from the registry rather than hand-maintained beside it — a second
/// list is a second thing to drift (the restatement lesson).
function abiFor(p) {
  const out = [];
  if (p.read) out.push({ type: 'function', name: p.read, stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] });
  return out;
}

/// Reads every parameter that HAS a getter. Chain-dormant: with no RPC configured it reports that
/// plainly rather than erroring, and a single unreachable contract degrades to `null` for its own
/// rows instead of taking the panel down (the address may simply not be deployed yet).
export async function readChainParams() {
  const rpc = process.env.CHAIN_RPC_URL;
  const rows = CHAIN_PARAMS.map((p) => ({
    key: p.key,
    contract: p.contract,
    label: p.label,
    unit: p.unit,
    hint: p.hint || null,
    wall: p.wall,
    why: p.why,
    setter: p.write.fn,
    hasGetter: !!p.read,
    args: p.write.args,
    address: process.env[p.env] || null,
    live: null,
    mirror: p.mirror ? p.mirror() : null,
    alert: p.relation ? p.relation() : null,
  }));
  if (!rpc) return { configured: false, why: 'CHAIN_RPC_URL is unset — the chain layer is dormant, so there is nothing live to read. The walls, the mirrors and the calldata builder all still work.', rows };

  const { createPublicClient, http, isAddress } = await import('viem');
  const client = createPublicClient({ transport: http(rpc) });
  await Promise.all(rows.map(async (r, i) => {
    const p = CHAIN_PARAMS[i];
    if (!p.read || !r.address || !isAddress(r.address)) return;
    try {
      const v = await client.readContract({ address: r.address, abi: abiFor(p), functionName: p.read });
      r.live = typeof v === 'bigint' ? v.toString() : String(v);
    } catch (e) {
      // Not deployed, wrong address, RPC hiccup — all report as "could not read" rather than
      // pretending a value, because a control room that invents a number is worse than a blank one.
      r.readError = String(e?.shortMessage || e?.message || e).slice(0, 140);
    }
  }));
  return { configured: true, rows };
}

/// Validates a proposed change and returns the CALLDATA for the Safe. Never signs, never sends.
export async function buildParamTx(key, values) {
  const p = CHAIN_PARAMS.find((x) => x.key === key);
  if (!p) throw new Error(`unknown parameter: ${key}`);
  const to = process.env[p.env];
  const { encodeFunctionData, isAddress } = await import('viem');
  if (!to || !isAddress(to)) throw new Error(`${p.env} is unset or not an address — deploy ${p.contract} first`);

  // Shape the arguments the same way the setter declares them, so a missing field is a named error
  // rather than an encoded call with a silent zero in it.
  const args = p.write.args.map((name) => {
    const raw = values?.[name];
    if (raw === undefined || raw === null || raw === '') throw new Error(`missing argument: ${name}`);
    if (typeof raw === 'string' && raw.startsWith('0x')) {
      if (!isAddress(raw)) throw new Error(`${name} is not a valid address`);
      return raw;
    }
    if (raw === true || raw === false || raw === 'true' || raw === 'false') return raw === true || raw === 'true';
    let n;
    try { n = BigInt(String(raw)); } catch { throw new Error(`${name} must be a whole number (base units, no decimals)`); }
    if (n < 0n) throw new Error(`${name} cannot be negative`);
    return n;
  });

  const abi = [{
    type: 'function', name: p.write.fn, stateMutability: 'nonpayable', outputs: [],
    inputs: p.write.args.map((name) => {
      const v = values[name];
      if (typeof v === 'string' && v.startsWith('0x')) return { name, type: 'address' };
      if (v === true || v === false || v === 'true' || v === 'false') return { name, type: 'bool' };
      return { name, type: 'uint256' };
    }),
  }];

  return {
    to,
    value: '0',
    data: encodeFunctionData({ abi, functionName: p.write.fn, args }),
    contract: p.contract,
    setter: p.write.fn,
    hasGetter: !!p.read,
    args: Object.fromEntries(p.write.args.map((n, i) => [n, String(values[n])])),
    wall: p.wall,
    why: p.why,
    // Said on every build, because the whole point is that this is not the last step.
    next: 'Execute this from the Safe (New transaction → Contract interaction → paste the address, '
      + 'then the raw calldata). This panel cannot and must not send it — the Safe owning these '
      + 'setters is what bounds a compromised admin session.',
  };
}

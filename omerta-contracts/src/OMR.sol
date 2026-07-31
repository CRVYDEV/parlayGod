// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title OMR — OMERTÀ's utility token.
/// @notice An initial supply minted once to the treasury Safe, plus ONE mint path: a single
///         `minter` address, which on mainnet is the OmertaBond contract.
///
///         ⚠ THIS DELETED THE SUITE'S OLDEST PROPERTY. Until tokenomics v2 step 4 this token had
///         no mint function at all, and "nothing mints" was the sentence every prior audit of this
///         suite leaned on. Founder ruling (omerta-tokenomics-v2-design.md §4): supply becomes
///         unbounded and BONDS ARE THE ONLY MINT. What replaces the fixed cap is not a promise but
///         FOUR walls, ALL of which live in OmertaBond and must all survive review:
///           1. `dailyCapOMR`  — a per-UTC-day ceiling on OMR issued. With no tranche to bound the
///                               total, this is now the blast radius of a leaked signer key, which
///                               makes it the single most load-bearing number in the system.
///           2. `MAX_DISCOUNT_BPS` (2000) — a discount is a mint at a price; an unbounded discount
///                               is a mint at any price.
///           3. `maxOmrPerEth`  — an ABSOLUTE mint-RATE ceiling, fail-closed at 0 (the GearVault cap
///                               precedent). The number a manipulated oracle cannot raise.
///           4. `oracle`        — the ACCRETION wall: a TWAP the signed quote's claimed market price
///                               must agree with, so the ceiling TRACKS the market instead of going
///                               stale. Also fail-closed. Composed with wall 3 it can only ever
///                               TIGHTEN what may be minted, never loosen it — read OmertaBond's
///                               header for why that asymmetry is what makes a price feed safe on a
///                               mint path at all.
///         This contract itself keeps exactly one rule, and it is the one that matters here: the
///         minter is a single address, set only by the owner, and every change is evented. There is
///         no owner mint, no mint-to-self, no second path.
///
///         THE DEX SELL TAX (founder-directed): transfers INTO a registered AMM pair
///         (a sell, or a non-exempt LP add) pay `sellTaxBps`, split THREE ways — dev
///         (founder revenue), rwa (the treasury — a stock float until 2026-07-31) and lp (depth/buybacks) — IN THE
///         SAME TRANSFER, in lockstep with the backend's `SELL_TAX` constants so the two
///         layers can never disagree about where the money went. Everything else is clean:
///         buys (pair -> wallet), wallet -> wallet transfers, and every protocol flow
///         (VoucherClaim payouts, staking deposits, bond funding) move 1:1 — the
///         minimum possible honeypot-scanner surface for a sell-taxed token.
///
///         WHY FLAT (not age-based): every Uniswap trade routes through a router, so
///         the token only ever sees `router -> pool` — the real seller's identity and
///         holding time are invisible at the ERC-20 level. The 48h linearly-decaying
///         early-exit tax therefore lives at the GAME boundary (backend src/tax.js);
///         this flat on-chain layer stacks on top of it at the DEX.
///
///         GUARDRAILS (the anti-rug posture, for the auditor and token scanners):
///         - `MAX_SELL_TAX_BPS` (10%) is a compile-time hard cap — the owner can never
///           set a confiscatory rate.
///         - The tax defaults to 0 and applies only to pools the owner explicitly
///           registers; unregistered venues and plain transfers are never touched.
///         - Every knob emits an event; the Safe can renounce ownership to freeze the
///           configuration forever.
///
///         COMPOSABILITY (deploy-time requirement, see CHAIN-DEPLOY.md): a token that
///         taxes transfers into a pool is "fee-on-transfer" from that pool's view.
///         Uniswap V2-style pools support this (swaps must use the
///         *SupportingFeeOnTransferTokens router functions); Uniswap V3 does NOT —
///         canonical liquidity must live on a V2-compatible DEX (or a V4 hook pool).
contract OMR is ERC20Permit, Ownable {
    /// @notice The founding mint to the treasury Safe. NO LONGER the total supply — bonds mint on
    ///         top of it (see the header). Kept under its original name so deploy scripts, the
    ///         explorer and every prior audit note still resolve; `totalSupply()` is the live number.
    uint256 public constant SUPPLY = 100_000_000e18;
    uint256 public constant MAX_SELL_TAX_BPS = 1000; // hard cap: 10%

    /// @notice The ONLY address that may mint (the OmertaBond contract on mainnet). Zero = minting
    ///         is off entirely, which is the deploy default: the token ships inert and the Safe arms
    ///         it deliberately, so a mis-sequenced deploy fails closed rather than open.
    address public minter;

    uint256 public sellTaxBps;                    // 0 = off (the deploy default). the TOTAL rate
    address public taxDevRecipient;               // founder revenue
    address public taxRwaRecipient;               // the treasury (v2 §6; was the stock float)
    address public taxLpRecipient;                // LP depth / buybacks
    /// @notice How the total rate splits. dev + rwa must be <= sellTaxBps; LP takes the remainder,
    ///         so the three shares always sum to the tax EXACTLY and no dust is stranded.
    uint256 public taxDevBps;
    uint256 public taxRwaBps;
    mapping(address => bool) public ammPairs;     // registered pools (sell detection)
    mapping(address => bool) public taxExempt;    // protocol contracts / the POL manager

    event MinterSet(address indexed minter);
    event Minted(address indexed to, uint256 amount);
    event SellTaxSet(uint256 bps, uint256 devBps, uint256 rwaBps);
    event PairSet(address indexed pair, bool isPair);
    event ExemptSet(address indexed account, bool exempt);
    event TaxRecipientsSet(address indexed dev, address indexed rwa, address indexed lp);
    event SellTaxTaken(address indexed from, address indexed pair, uint256 tax);

    error BadBps();
    error ZeroAddress();
    error NotMinter();

    constructor(address treasurySafe) ERC20("OMERTA", "OMR") ERC20Permit("OMERTA") Ownable(treasurySafe) {
        _mint(treasurySafe, SUPPLY);
    }

    // ── the mint (tokenomics v2 §4) ──────────────────────────────────────────────────────────────

    /// @notice Point the single mint path at the bond contract. Setting it to the zero address turns
    ///         minting OFF, which is both the deploy default and the emergency stop: the Safe can
    ///         freeze issuance in one transaction without touching the bond contract at all.
    function setMinter(address m) external onlyOwner {
        minter = m;
        emit MinterSet(m);
    }

    /// @notice Mint OMR. Callable ONLY by `minter` — on mainnet the OmertaBond contract, whose three
    ///         walls (daily cap, discount ceiling, mint-rate ceiling) are what bound issuance. There
    ///         is deliberately no owner mint: the Safe chooses WHO may mint and can revoke it, but
    ///         cannot itself print, so "the Safe was compromised" and "supply was inflated" stay two
    ///         separate events rather than one.
    function mint(address to, uint256 amount) external {
        if (msg.sender != minter || minter == address(0)) revert NotMinter();
        if (to == address(0)) revert ZeroAddress();
        _mint(to, amount);
        emit Minted(to, amount);
    }

    // ── the sell tax ─────────────────────────────────────────────────────────────────────────────

    /// @notice Arm/tune the DEX sell tax (<= 10% total) and how it splits. Recipients must be set
    ///         first. `devBps + rwaBps <= bps`; LP takes the remainder.
    function setSellTax(uint256 bps, uint256 devBps, uint256 rwaBps) external onlyOwner {
        if (bps > MAX_SELL_TAX_BPS) revert BadBps();
        if (devBps + rwaBps > bps) revert BadBps();
        if (bps > 0 && (taxDevRecipient == address(0) || taxRwaRecipient == address(0) || taxLpRecipient == address(0))) revert ZeroAddress();
        sellTaxBps = bps;
        taxDevBps = devBps;
        taxRwaBps = rwaBps;
        emit SellTaxSet(bps, devBps, rwaBps);
    }

    function setTaxRecipients(address dev, address rwa, address lp) external onlyOwner {
        if (sellTaxBps > 0 && (dev == address(0) || rwa == address(0) || lp == address(0))) revert ZeroAddress();
        taxDevRecipient = dev;
        taxRwaRecipient = rwa;
        taxLpRecipient = lp;
        emit TaxRecipientsSet(dev, rwa, lp);
    }

    /// @notice Register/unregister an AMM pool. Only transfers INTO registered pools are taxed.
    function setPair(address pair, bool isPair) external onlyOwner {
        if (pair == address(0)) revert ZeroAddress();
        ammPairs[pair] = isPair;
        emit PairSet(pair, isPair);
    }

    /// @notice Exempt a protocol address (the POL manager, bond/claim contracts, the Safe).
    function setExempt(address account, bool exempt) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        taxExempt[account] = exempt;
        emit ExemptSet(account, exempt);
    }

    function _update(address from, address to, uint256 value) internal override {
        // a SELL (or a non-exempt LP add): carve the tax to the two revenue wallets in-transfer
        if (sellTaxBps > 0 && ammPairs[to] && from != address(0) && !taxExempt[from]) {
            uint256 tax = (value * sellTaxBps) / 10000;
            if (tax > 0) {
                // The remainder rule sits on the LP slice, so dev + rwa + lp == tax EXACTLY however
                // the bps divide — the same discipline the backend's sell-tax ingest uses, for the
                // same reason: two of three shares round down, and a "natural" third slice would
                // leave a wei belonging to nobody stranded in the seller's balance.
                uint256 dev = (tax * taxDevBps) / sellTaxBps;
                uint256 rwa = (tax * taxRwaBps) / sellTaxBps;
                uint256 lp = tax - dev - rwa;
                if (dev > 0) super._update(from, taxDevRecipient, dev);
                if (rwa > 0) super._update(from, taxRwaRecipient, rwa);
                if (lp > 0) super._update(from, taxLpRecipient, lp);
                emit SellTaxTaken(from, to, tax);
                value -= tax;
            }
        }
        super._update(from, to, value);
    }
}

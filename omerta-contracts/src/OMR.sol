// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title OMR — OMERTÀ's utility token.
/// @notice Fixed supply, minted once to the treasury Safe. No mint function, no pause.
///
///         THE DEX SELL TAX (founder-directed): transfers INTO a registered AMM pair
///         (a sell, or a non-exempt LP add) pay `sellTaxBps`, split 50/50 to the dev
///         wallet and the buyback wallet IN THE SAME TRANSFER. Everything else is clean:
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
    uint256 public constant SUPPLY = 100_000_000e18;
    uint256 public constant MAX_SELL_TAX_BPS = 1000; // hard cap: 10%

    uint256 public sellTaxBps;                    // 0 = off (the deploy default)
    address public taxDevRecipient;               // half the tax -> founder revenue
    address public taxBuybackRecipient;           // half the tax -> the buyback wallet
    mapping(address => bool) public ammPairs;     // registered pools (sell detection)
    mapping(address => bool) public taxExempt;    // protocol contracts / the POL manager

    event SellTaxSet(uint256 bps);
    event PairSet(address indexed pair, bool isPair);
    event ExemptSet(address indexed account, bool exempt);
    event TaxRecipientsSet(address indexed dev, address indexed buyback);
    event SellTaxTaken(address indexed from, address indexed pair, uint256 tax);

    error BadBps();
    error ZeroAddress();

    constructor(address treasurySafe) ERC20("OMERTA", "OMR") ERC20Permit("OMERTA") Ownable(treasurySafe) {
        _mint(treasurySafe, SUPPLY);
    }

    /// @notice Arm/tune the DEX sell tax (<= 10%). Recipients must be set first.
    function setSellTax(uint256 bps) external onlyOwner {
        if (bps > MAX_SELL_TAX_BPS) revert BadBps();
        if (bps > 0 && (taxDevRecipient == address(0) || taxBuybackRecipient == address(0))) revert ZeroAddress();
        sellTaxBps = bps;
        emit SellTaxSet(bps);
    }

    function setTaxRecipients(address dev, address buyback) external onlyOwner {
        if (sellTaxBps > 0 && (dev == address(0) || buyback == address(0))) revert ZeroAddress();
        taxDevRecipient = dev;
        taxBuybackRecipient = buyback;
        emit TaxRecipientsSet(dev, buyback);
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
                uint256 dev = tax / 2;
                super._update(from, taxDevRecipient, dev);
                super._update(from, taxBuybackRecipient, tax - dev);
                emit SellTaxTaken(from, to, tax);
                value -= tax;
            }
        }
        super._update(from, to, value);
    }
}

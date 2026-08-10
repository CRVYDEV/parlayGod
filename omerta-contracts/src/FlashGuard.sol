// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title FlashGuard — atomicity defenses for THE BANK
/// @notice Founder-directed 2026-08-10: "figure out how to write in the smart contract ways to kill
///         flash loans from happening completely."
///
///         ── THE HONEST FRAMING, BECAUSE IT CHANGES WHAT TO BUILD ──────────────────────────────
///         A flash loan cannot be blocked. It is not a feature of any one lender; it is a property
///         of EVM atomicity — a transaction either fully succeeds or fully reverts, so anyone can
///         borrow inside one, and the source can be Aave, Balancer, Morpho, Uniswap, or a whale's
///         own balance. There is no switch.
///
///         There is also no need for one, because **a flash loan is never the vulnerability — it is
///         the amplifier.** Every flash-loan "exploit" on record is really one of three bugs:
///           (1) a price read from a source the caller can move inside the same transaction;
///           (2) a state you can ENTER and EXIT in one transaction and profit from the round trip
///               (same-block deposit→borrow, reward accrual, a governance snapshot);
///           (3) reentrancy.
///         The loan only makes the attacker briefly rich enough to do (1) or (2) at scale. Remove
///         those and a flash loan buys nothing — which is a far stronger position than trying to
///         detect and reject borrowed capital, a thing that cannot be reliably observed on-chain.
///
///         ── AND WE MUST NOT BLOCK ALL OF THEM ANYWAY ─────────────────────────────────────────
///         The Transmuter's 1:1 redemption is DEFENDED by arbitrage: someone who flash-loans to buy
///         nUSD at 0.98 and redeem it at 1.00 is repairing our peg at their own gas risk. Blanket
///         "no flash loans" would disable the mechanism that keeps the peg honest. So the guards
///         here are SURGICAL — they attach to the paths where atomicity creates an advantage, and
///         deliberately not to the paths where it creates a service.
///
///         ── THE LAYERS, STRONGEST FIRST ───────────────────────────────────────────────────────
///         L0  REMOVE THE TARGET. THE BANK's markets are denomination-matched (USD debt against USD
///             collateral, ETH against ETH — see the design's §2.1), so there is **no oracle on the
///             borrow path at all.** A price that is never read cannot be manipulated, at any size.
///             This is the FiRM lesson ("the best oracle is the one you removed") and it is worth
///             more than everything below combined. The two Inverse losses (~$21M) were both this.
///         L1  SAME-BLOCK SEPARATION  ← this contract. Enter and exit cannot share a block, so the
///             atomic round trip is impossible by construction.
///         L2  CONTRACT ALLOWLIST (not `tx.origin` — see the note on `onlyAllowedCaller`).
///         L3  TIME-WEIGHTED ACCRUAL — rewards/shares/voting accrue over elapsed time, so a
///             position held for zero blocks earns exactly zero. Implemented in the Alchemist.
///         L4  ORACLE HARDENING where an oracle genuinely is needed (the redemption price only):
///             Chainlink rather than a DEX TWAP, read pessimistically, with staleness and
///             single-block deviation circuit breakers.
///         L5  FLOW CAPS  ← this contract. Bounds the damage of everything above failing at once.
///         L6  REENTRANCY — `nonReentrant` plus strict checks-effects-interactions everywhere.
///         L7  SHARE-INFLATION / DONATION — track assets in a variable, never `balanceOf(this)`,
///             so a direct transfer cannot move the share price. (OZ 5.x ERC4626 virtual shares
///             cover the classic first-depositor case; internal accounting covers the rest.)
///
/// @dev    Inherit and use. This contract holds no funds and has no owner.
abstract contract FlashGuard {
    // ── L1: SAME-BLOCK SEPARATION ────────────────────────────────────────────────────────────────
    /// @dev Block number of the last position-INCREASING action per account.
    mapping(address => uint256) private _lastEntry;

    error SameBlockAsEntry();
    error PerBlockCapExceeded();
    error DailyCapExceeded();
    error CallerNotAllowed();

    /// @notice Record an entry. Call this on EVERY action that increases a position (deposit, mint
    ///         collateral, add to escrow). Cheap: one SSTORE to a warm-ish slot.
    function _recordEntry(address account) internal {
        _lastEntry[account] = block.number;
    }

    /// @notice Guard an EXIT. Apply to every action that extracts value against a position
    ///         (borrow, withdraw, claim, redeem-against-own-position).
    /// @dev    The whole atomic-attack class needs deposit and extract in ONE transaction. One block
    ///         of separation is therefore not a mitigation, it is a proof: a flash loan must be
    ///         repaid in the transaction that took it, and this makes the profitable half of the
    ///         round trip land in a later block, by which time the loan cannot exist.
    ///         Cost to an honest user on an Orbit L2: one block (~250ms). Not a real cost.
    modifier notSameBlockAsEntry(address account) {
        if (_lastEntry[account] == block.number) revert SameBlockAsEntry();
        _;
    }

    /// @notice The block an account last entered in (0 = never). Exposed for off-chain monitoring.
    function lastEntryBlock(address account) external view returns (uint256) {
        return _lastEntry[account];
    }

    // ── L5: FLOW CAPS ────────────────────────────────────────────────────────────────────────────
    // Defense in depth. These do not prevent an attack; they bound one. A flash loan is BY
    // DEFINITION confined to a single block, so a per-block cap is the tightest possible bound on
    // any atomic exploit — and the daily cap (FiRM's) bounds the patient, multi-block version that
    // the per-block cap would otherwise just spread out.

    struct Flow {
        uint256 blockNumber;   // the block `inBlock` refers to
        uint256 inBlock;       // amount moved during that block
        uint256 dayStart;      // unix ts of the current 24h window's start
        uint256 inDay;         // amount moved during that window
    }

    /// @dev Meter a flow against both caps. `perBlockCap == 0` or `perDayCap == 0` disables that
    ///      cap — deliberately, so a market can be deployed with metering off and tightened later
    ///      by the Safe without a redeploy. Both caps ON is the intended production posture.
    function _meter(Flow storage f, uint256 amount, uint256 perBlockCap, uint256 perDayCap) internal {
        if (f.blockNumber != block.number) {
            f.blockNumber = block.number;
            f.inBlock = 0;
        }
        // Rolling 24h window, restarted rather than smoothed: the cheap version is the right one
        // here because this is a backstop, not an accounting surface.
        if (block.timestamp >= f.dayStart + 1 days) {
            f.dayStart = block.timestamp;
            f.inDay = 0;
        }
        // checked arithmetic on purpose: these are backstop counters, and a silent wrap here would
        // turn the last line of defense into a no-op.
        f.inBlock += amount;
        f.inDay += amount;
        if (perBlockCap != 0 && f.inBlock > perBlockCap) revert PerBlockCapExceeded();
        if (perDayCap != 0 && f.inDay > perDayCap) revert DailyCapExceeded();
    }

    // ── L2: CALLER ALLOWLIST ─────────────────────────────────────────────────────────────────────
    /// @dev Contracts permitted to call guarded entry points. EOAs are always permitted.
    mapping(address => bool) internal _allowedContract;

    /// @notice Restrict contract callers to an allowlist, while letting every EOA through.
    ///
    /// @dev    **THIS IS DELIBERATELY NOT `require(msg.sender == tx.origin)`,** and the reason
    ///         matters for this chain in particular. That check is the classic anti-flash-loan
    ///         one-liner and it is now an anti-pattern: it breaks ERC-4337 account abstraction,
    ///         Safe multisigs, and every smart-contract wallet — and Robinhood Chain's
    ///         self-custody story is Privy-style embedded wallets, so a blanket `tx.origin` check
    ///         risks locking out exactly the users we are built for. It also does not even achieve
    ///         the goal: an attacker can flash-loan, then have an EOA call us within the same
    ///         transaction via a callback.
    ///
    ///         So the allowlist is a *composability* control (which integrators may build on us),
    ///         and the ACTUAL atomic defense is L0 + L1 above, which no wallet type can bypass.
    ///         `code.length == 0` is a deliberately loose check — it is false inside a
    ///         constructor — but nothing security-critical rests on it.
    modifier onlyAllowedCaller() {
        if (msg.sender.code.length != 0 && !_allowedContract[msg.sender]) revert CallerNotAllowed();
        _;
    }
}

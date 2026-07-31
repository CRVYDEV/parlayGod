// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IOmrOracle} from "./IOmrOracle.sol";

/// @dev The single mint path on OMR. Held as a narrow interface on purpose: this contract needs
///      exactly one privilege on the token and should be readable as having exactly one.
interface IOMRMintable {
    function mint(address to, uint256 amount) external;
}

/// @title OmertaBond — the disciplined treasury bond for Protocol-Owned Liquidity (design
///        omerta-reserve-bond-design.md; the OlympusDAO "Option C").
/// @notice A bonder deposits ETH → receives DISCOUNTED OMR, vested linearly; the ETH is split
///         (POL share + Vig share) and forwarded in the SAME tx, so this contract custodies no ETH.
///         ⚠ THIS CONTRACT MINTS (tokenomics v2 §4, founder ruling: "supply becomes unbounded;
///         bonds are the only mint"). Until step 4 it transferred from a Safe-funded tranche and
///         "nothing mints" was the property every prior audit of this suite rested on. That property
///         is GONE and FOUR walls replace it. All four must survive review; none is optional:
///
///           1. `dailyCapOMR` — OMR issuable per UTC day. The tranche used to bound the TOTAL a
///              leaked signer could extract; with no tranche, this bounds the DAY, and it is now the
///              single most load-bearing number in the system. Zero means unlimited, so a deploy that
///              forgets it is a deploy with no daily wall — set it.
///           2. `MAX_DISCOUNT_BPS` (2000, compile-time) — a discount is a mint at a price, and an
///              unbounded discount is a mint at any price.
///           3. `maxOmrPerEth` — an ABSOLUTE Safe-set ceiling on OMR minted per ETH, FAIL-CLOSED AT
///              ZERO (the GearVault gear-cap precedent): an unset ceiling means no bond can be struck
///              at all, so the failure mode of forgetting it is "the product is off", not "prints".
///           4. `oracle` — THE ACCRETION WALL (founder-directed, v2 §4). A TWAP that the signed
///              quote's claimed market price must agree with. Also fail-closed: unset, stale, zero,
///              or reverting each REVERT the bond.
///
///         WHY 3 AND 4 ARE BOTH HERE. This composition is the point, and deleting either half to
///         "simplify" removes the guarantee. Wall 3 alone is STATIC — it cannot track the market, so
///         it is either too loose (once OMR appreciates) or blocks honest bonds (once OMR falls).
///         Wall 4 alone puts a price feed on a MINT path, which is the classic route from an oracle
///         bug to unbounded supply. A bond must pass BOTH, so the real ceiling is:
///
///             effective rate ceiling = MIN( maxOmrPerEth , oracle x (1+tolerance) / (1-discount) )
///
///         **A MANIPULATED ORACLE CAN ONLY EVER TIGHTEN THIS, NEVER LOOSEN IT.** Push the oracle
///         down and bonding halts — a liveness problem, recoverable, no supply created. Push it up
///         and `maxOmrPerEth` still binds, because that is the Safe's number and no oracle can raise
///         it. That asymmetry is the entire reason a price feed is safe to put here.
///
///         ON "ACCRETIVE-ONLY", HONESTLY. Read literally — mint only when the ETH received is worth
///         at least the OMR issued — the rule forbids every DISCOUNTED bond, since a discount IS
///         issuing OMR worth more than the ETH paid; the literal rule and the product contradict
///         each other. What is implemented is that same inequality with two dials: the quote's
///         claimed price may not exceed the oracle by more than `priceToleranceBps`, and the discount
///         is capped by `MAX_DISCOUNT_BPS`. **Set both to zero and this becomes the literal rule
///         exactly** — so the literal case is a SETTING here, not something dropped. At non-zero
///         values it is a bounded, market-tracking dilution ceiling: the treasury always receives ETH
///         worth at least `(1-maxDiscount)/(1+tolerance)` of the OMR issued at market. Say that
///         number out loud when tuning these; do not call it accretion.
///
///         WHAT THE ORACLE STILL CANNOT SEE: true treasury BACKING (reserves / supply). This contract
///         custodies nothing — every wei is forwarded in the same transaction — so backing accretion
///         remains the job of the off-chain policy deciding what price to sign, where it can read the
///         whole treasury and where a mistake costs one bad bond instead of the token.
///
///         Prices/discounts come in a server-signed EIP-712 quote (the VoucherClaim signer
///         discipline); a compromised signer is bounded by all four walls and revoked by the Safe.
///         `sweep` can pull only OMR that is not backing an outstanding vested bond.
contract OmertaBond is EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Rogue-discount backstop (a leaked signer can't quote a near-infinite payout). The
    ///         server quotes far less; must equal the backend's BONDS.MAX_DISCOUNT_BPS.
    uint256 public constant MAX_DISCOUNT_BPS = 2000; // 20%
    /// @notice Vesting-window backstop, so a leaked (then-rotated) signer's pre-signed quotes can't
    ///         lock OMR in a decade-long vest. The server signs much shorter windows.
    uint256 public constant MAX_VEST = 30 days;
    /// @notice Deadline backstop (the VoucherClaim MAX_VOUCHER_TTL mirror): a quote can't be signed
    ///         with a deadline arbitrarily far in the future, so a leaked-then-rotated signer's
    ///         pre-signed `deadline=2100` quotes can't stay bondable at a stale favorable price. The
    ///         server signs minute/hour-scale deadlines; this only bounds abuse.
    uint256 public constant MAX_QUOTE_TTL = 30 days;

    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "BondQuote(address payer,uint256 principal,uint256 priceOmrPerEth,uint256 discountBps,uint256 vestSeconds,uint256 nonce,uint256 deadline)"
    );

    struct BondQuote {
        address payer;            // the bonder (must be msg.sender — a quote is not transferable)
        uint256 principal;        // ETH (wei) the bonder deposits; must equal msg.value
        uint256 priceOmrPerEth;   // OMR (wei) per 1 ETH (1e18 wei) at quote time (the DEX TWAP)
        uint256 discountBps;      // the bonder's incentive (<= MAX_DISCOUNT_BPS)
        uint256 vestSeconds;      // linear vesting window (<= MAX_VEST)
        uint256 nonce;            // server-unique; replay protection
        uint256 deadline;         // unix seconds
    }

    struct Bond {
        address owner;            // who may claim
        uint256 payout;           // total OMR owed (discounted)
        uint256 claimed;          // OMR released so far
        uint64 start;             // vesting start (block.timestamp)
        uint64 vestSeconds;       // vesting window
    }

    IERC20 public immutable omr;
    /// @dev The same token, held as the narrow mint interface (see IOMRMintable).
    IOMRMintable private immutable omrMint;
    /// @notice POL share of every bond's ETH, in basis points. IMMUTABLE — set once at deploy in
    ///         lockstep with the backend's BONDS.POL_BPS so on-chain and off-chain never drift.
    uint256 public immutable polBps;
    uint256 public immutable devBps;   // the founder-revenue share of every bond's ETH
    /// @notice The TREASURY's share of every bond's ETH (tokenomics v2 §6). Bond ETH is PRIMARY
    ///         inflow — it arrives whether or not anyone is trading — so it is what keeps the treasury
    ///         growing when DEX volume is thin, which is exactly what a one-way conversion produces.
    ///         The Vig takes whatever remains after POL + Dev + RWA. (This slice was earmarked to buy
    ///         real tokenized stock until that layer was retired 2026-07-31; the bps and the split are
    ///         unchanged, only the destination — `rwaRecipient` is now a treasury Safe, not a buy bot.)
    uint256 public immutable rwaBps;
    address public signer;              // the game server's quote signer (rotatable by the Safe)
    address payable public polRecipient; // where the POL ETH share is forwarded (the pairing manager)
    address payable public devRecipient; // where the dev ETH share is forwarded (founder revenue — the OmertaFees dev-wallet pattern)
    address payable public rwaRecipient; // where the treasury's ETH share is forwarded (a cold Safe; this
                                         // slice funded a stock float until that layer was retired 2026-07-31 —
                                         // the bps and the plumbing are unchanged, only the destination)
    address payable public vigRecipient; // where the Vig ETH share is forwarded (the Vig wallet)

    /// @notice OMR promised to outstanding (unclaimed) bonds. INVARIANT: <= omr.balanceOf(this).
    uint256 public committedOMR;
    /// @notice Max OMR bondable per UTC day (0 = unlimited). Bounds a COMPROMISED SIGNER's per-day
    ///         blast radius the way the tranche cap bounds it in total — the VoucherClaim.dailyCapOMR
    ///         twin (audit: OmertaBond otherwise gave weaker containment than its sibling for the same
    ///         leaked-key threat). Owner-settable; keep in step with the backend BONDS daily budget.
    uint256 public dailyCapOMR;
    /// @notice WALL 3 — the maximum OMR this contract will ever mint per 1 ETH received, measured
    ///         AFTER the discount (the rate actually issued, not the quoted market rate). FAIL-CLOSED
    ///         AT ZERO: until the Safe sets it, every bond reverts. This is the ABSOLUTE ceiling that
    ///         a manipulated oracle cannot raise — see the header on why walls 3 and 4 compose.
    uint256 public maxOmrPerEth;

    /// @notice WALL 4 — the price feed the accretion check reads. FAIL-CLOSED AT ZERO ADDRESS.
    IOmrOracle public oracle;
    /// @notice How far above the oracle's TWAP a signed quote's claimed market price may sit, in bps.
    ///         Non-zero because a TWAP LAGS spot by construction: in a fast market an honest quote
    ///         priced at spot is legitimately above a 30-minute average, and a zero-tolerance wall
    ///         would reject honest bonds precisely when the market is moving. Zero makes the wall
    ///         literal (see the header); the compile-time cap keeps any setting defensible.
    uint256 public priceToleranceBps;
    uint256 public constant MAX_PRICE_TOLERANCE_BPS = 2000; // hard cap: 20%
    /// @notice How old the oracle's reading may be before a bond refuses. Bounds how long a dead
    ///         keeper can leave the mint running on a price nobody is maintaining. Zero = unset =
    ///         every bond reverts, so this too is fail-closed.
    uint256 public maxOracleAge;
    mapping(uint256 => uint256) public bondedOnDay; // UTC day => OMR payout bonded that day
    mapping(uint256 => bool) public usedNonce; // quote replay protection
    mapping(uint256 => Bond) public bonds;     // bondId => Bond
    uint256 public nextBondId = 1;

    event Bonded(uint256 indexed bondId, address indexed payer, uint256 indexed nonce, uint256 principal, uint256 payout, uint256 toPol, uint256 toDev, uint256 toRwa, uint256 toVig);
    event BondClaimed(uint256 indexed bondId, address indexed owner, uint256 amount);
    event SignerSet(address indexed signer);
    event RecipientsSet(address indexed pol, address indexed dev, address indexed rwa, address vig);
    event DailyCapSet(uint256 cap);
    event MaxRateSet(uint256 maxOmrPerEth);
    event OracleSet(address indexed oracle, uint256 priceToleranceBps, uint256 maxOracleAge);
    event Swept(address indexed to, uint256 amount);

    error ZeroAddress();
    error BadBps();
    error NotPayer();
    error WrongValue(uint256 sent, uint256 required);
    error Expired();
    error DeadlineTooFar();
    error VestTooLong();
    error Replay();
    error BadSignature();
    error RateCeiling();           // the post-discount mint rate exceeds maxOmrPerEth (0 = unset, fails closed)
    error OracleUnset();           // wall 4 not configured — fails closed rather than skipping the check
    error OracleUnavailable();     // the feed reverted or reported no usable reading
    error OracleStale(uint256 updatedAt, uint256 maxAge);
    error PriceAboveOracle(uint256 quoted, uint256 ceiling); // the accretion wall
    error NotOwner();
    error NothingVested();
    error ForwardFailed();
    error OverSweep();             // would dip into OMR backing outstanding bonds

    constructor(
        address owner_,
        address signer_,
        IERC20 omr_,
        uint256 polBps_,
        uint256 devBps_,
        uint256 rwaBps_,
        address payable polRecipient_,
        address payable devRecipient_,
        address payable rwaRecipient_,
        address payable vigRecipient_,
        uint256 dailyCapOMR_,
        uint256 maxOmrPerEth_
    ) EIP712("OmertaBond", "1") Ownable(owner_) {
        if (signer_ == address(0) || address(omr_) == address(0)) revert ZeroAddress();
        if (polBps_ + devBps_ + rwaBps_ > 10000) revert BadBps();
        if (polBps_ > 0 && polRecipient_ == address(0)) revert ZeroAddress();
        if (devBps_ > 0 && devRecipient_ == address(0)) revert ZeroAddress();
        if (rwaBps_ > 0 && rwaRecipient_ == address(0)) revert ZeroAddress();
        if (polBps_ + devBps_ + rwaBps_ < 10000 && vigRecipient_ == address(0)) revert ZeroAddress();
        signer = signer_;
        omr = omr_;
        omrMint = IOMRMintable(address(omr_));
        polBps = polBps_;
        devBps = devBps_;
        rwaBps = rwaBps_;
        polRecipient = polRecipient_;
        devRecipient = devRecipient_;
        rwaRecipient = rwaRecipient_;
        vigRecipient = vigRecipient_;
        dailyCapOMR = dailyCapOMR_;
        maxOmrPerEth = maxOmrPerEth_;
        // WALL 4 is deliberately NOT a constructor argument. A TWAP oracle cannot exist before the
        // pool it reads, and the pool cannot exist before this token — so the honest deploy order is
        // token, bond, pool, oracle, `setOracle`, `setMinter`. Leaving it unset here means the
        // contract is born refusing every bond, which is the correct state for a contract that can
        // mint and has not yet been told what the market price is.
        emit SignerSet(signer_);
        emit RecipientsSet(polRecipient_, devRecipient_, rwaRecipient_, vigRecipient_);
        emit DailyCapSet(dailyCapOMR_);
        emit MaxRateSet(maxOmrPerEth_);
    }

    /// @notice The Safe tunes the per-day OMR bond cap (0 = unlimited) — the leaked-signer backstop.
    function setDailyCap(uint256 cap) external onlyOwner {
        dailyCapOMR = cap;
        emit DailyCapSet(cap);
    }

    /// @notice The Safe sets WALL 3 — the ceiling on OMR minted per ETH, after the discount. Setting
    ///         it to 0 stops all bonding (the fail-closed default), which doubles as a kill switch
    ///         that needs no pause and no token-side change.
    function setMaxRate(uint256 maxOmrPerEth_) external onlyOwner {
        maxOmrPerEth = maxOmrPerEth_;
        emit MaxRateSet(maxOmrPerEth_);
    }

    /// @notice The Safe configures WALL 4 — the accretion oracle, how far a quote may sit above it,
    ///         and how stale a reading may be. Setting `o` to the zero address stops all bonding: a
    ///         third kill switch, and the reason a swapped-out feed can never mean "skip the check".
    ///         Swappable so the feed can follow the canonical pool (V2 → V3 → a Chainlink-style
    ///         aggregator) without ever touching the mint path itself.
    function setOracle(IOmrOracle o, uint256 toleranceBps, uint256 maxAge) external onlyOwner {
        if (toleranceBps > MAX_PRICE_TOLERANCE_BPS) revert BadBps();
        oracle = o;
        priceToleranceBps = toleranceBps;
        maxOracleAge = maxAge;
        emit OracleSet(address(o), toleranceBps, maxAge);
    }

    /// @notice The live accretion ceiling on a quote's claimed market price: what the oracle says,
    ///         plus the tolerance. A quote above this is refused. Exposed so the quote signer can
    ///         price against the same number the chain will judge it by — a server that signs blind
    ///         against its own TWAP will have honest quotes revert whenever the two feeds drift.
    /// @return ceiling the highest `priceOmrPerEth` a quote may carry right now
    /// @return oraclePrice the raw TWAP reading behind it
    function priceCeiling() public view returns (uint256 ceiling, uint256 oraclePrice) {
        oraclePrice = _oraclePrice();
        ceiling = (oraclePrice * (10000 + priceToleranceBps)) / 10000;
    }

    /// @dev Reads the feed and enforces every fail-closed condition. Kept in one place so there is
    ///      exactly one path to a price and no way to accidentally add a second that skips a check.
    function _oraclePrice() private view returns (uint256) {
        if (address(oracle) == address(0) || maxOracleAge == 0) revert OracleUnset();
        // try/catch so a reverting or non-conforming feed surfaces as a clean, named error instead
        // of an opaque bubble — and, more importantly, so "the oracle broke" can never be mistaken
        // in review for a path that proceeds.
        try oracle.consult() returns (uint256 price, uint256 updatedAt) {
            if (price == 0) revert OracleUnavailable();
            if (block.timestamp > updatedAt + maxOracleAge) revert OracleStale(updatedAt, maxOracleAge);
            return price;
        } catch {
            revert OracleUnavailable();
        }
    }

    // ── the bond ──
    function hashQuote(BondQuote calldata q) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            QUOTE_TYPEHASH, q.payer, q.principal, q.priceOmrPerEth, q.discountBps, q.vestSeconds, q.nonce, q.deadline
        )));
    }

    /// @notice Deposit ETH against a server-signed quote → book a vesting OMR bond. The ETH is split
    ///         (POL + Dev + Vig) and forwarded in this tx, so the contract custodies no ETH. It DOES
    ///         mint the OMR payout — see the header's three walls for what bounds that.
    function bond(BondQuote calldata q, bytes calldata sig) external payable nonReentrant whenNotPaused returns (uint256 bondId) {
        if (msg.sender != q.payer) revert NotPayer();
        if (msg.value != q.principal || msg.value == 0) revert WrongValue(msg.value, q.principal);
        if (block.timestamp > q.deadline) revert Expired();
        if (q.deadline > block.timestamp + MAX_QUOTE_TTL) revert DeadlineTooFar();
        if (q.discountBps > MAX_DISCOUNT_BPS) revert BadBps();
        if (q.vestSeconds == 0 || q.vestSeconds > MAX_VEST) revert VestTooLong();
        if (usedNonce[q.nonce]) revert Replay();
        if (ECDSA.recover(hashQuote(q), sig) != signer) revert BadSignature();
        usedNonce[q.nonce] = true;

        // WALL 4 — THE ACCRETION WALL. The signer says what OMR is worth; the oracle says whether
        // that is true. Checked on the CLAIMED price rather than the post-discount rate on purpose:
        // the discount is separately bounded by MAX_DISCOUNT_BPS, so splitting the two means each
        // wall guards one lie (an inflated market price / an excessive discount) and neither can be
        // used to hide the other. Reverts if the feed is unset, stale, zero or broken.
        (uint256 ceiling, ) = priceCeiling();
        if (q.priceOmrPerEth > ceiling) revert PriceAboveOracle(q.priceOmrPerEth, ceiling);

        // discounted payout: principal's market OMR value, scaled UP by the discount (cheaper OMR)
        uint256 marketOmr = (q.principal * q.priceOmrPerEth) / 1e18;
        uint256 payout = (marketOmr * 10000) / (10000 - q.discountBps);

        // WALL 3 — THE ABSOLUTE MINT-RATE CEILING, checked on the POST-DISCOUNT rate, which is the
        // rate actually issued. FAIL-CLOSED at zero. This is deliberately INDEPENDENT of wall 4: it
        // is the number a manipulated oracle cannot raise, so the two together bound the mint at
        // MIN(this, oracle-derived) and an oracle can only ever tighten. Do not fold them together.
        if (maxOmrPerEth == 0 || (payout * 1e18) / q.principal > maxOmrPerEth) revert RateCeiling();
        committedOMR += payout;

        // WALL 1 — the per-UTC-day cap. It used to be the second line of defence behind the tranche;
        // with no tranche it is the only thing bounding a compromised signer's TOTAL extraction over
        // time, which is why the header calls it the most load-bearing number in the system.
        if (dailyCapOMR != 0) {
            uint256 day = block.timestamp / 1 days;
            uint256 dayTotal = bondedOnDay[day] + payout;
            require(dayTotal <= dailyCapOMR, "OB: daily cap");
            bondedOnDay[day] = dayTotal;
        }

        bondId = nextBondId++;
        bonds[bondId] = Bond({ owner: q.payer, payout: payout, claimed: 0, start: uint64(block.timestamp), vestSeconds: uint64(q.vestSeconds) });

        // MINT the payout to this contract, which then releases it on the vesting schedule. Minting
        // here rather than at claim keeps `committedOMR <= omr.balanceOf(this)` true at all times —
        // so `sweep` still cannot touch OMR backing an outstanding bond, and a bonder's claim can
        // never fail for want of balance no matter what else the Safe does.
        omrMint.mint(address(this), payout);

        // split + forward the ETH in this tx (the OmertaFees custody-nothing pattern):
        // POL (liquidity) + DEV (founder revenue) + Vig (buybacks) — the remainder math means the
        // three shares always sum EXACTLY to msg.value (no dust stranded in the contract).
        uint256 toPol = (msg.value * polBps) / 10000;
        uint256 toDev = (msg.value * devBps) / 10000;
        uint256 toRwa = (msg.value * rwaBps) / 10000;
        // the REMAINDER rule sits on the Vig: three of four shares round down, so a "natural" fourth
        // share would strand wei belonging to nobody. Vig takes what is left, exactly.
        uint256 toVig = msg.value - toPol - toDev - toRwa;
        if (toPol > 0) { (bool okP, ) = polRecipient.call{value: toPol}(""); if (!okP) revert ForwardFailed(); }
        if (toDev > 0) { (bool okD, ) = devRecipient.call{value: toDev}(""); if (!okD) revert ForwardFailed(); }
        if (toRwa > 0) { (bool okR, ) = rwaRecipient.call{value: toRwa}(""); if (!okR) revert ForwardFailed(); }
        if (toVig > 0) { (bool okV, ) = vigRecipient.call{value: toVig}(""); if (!okV) revert ForwardFailed(); }

        emit Bonded(bondId, q.payer, q.nonce, msg.value, payout, toPol, toDev, toRwa, toVig);
    }

    /// @notice Claim the vested (linear) OMR of a bond you own. Releases from the pre-funded balance.
    function claim(uint256 bondId) external nonReentrant returns (uint256 amount) {
        Bond storage b = bonds[bondId];
        if (b.owner != msg.sender) revert NotOwner();
        uint256 vested = _vested(b);
        amount = vested - b.claimed;
        if (amount == 0) revert NothingVested();
        b.claimed = vested;
        committedOMR -= amount;         // the released OMR leaves the outstanding commitment
        omr.safeTransfer(b.owner, amount); // releases OMR minted at bond time; claim itself never mints
        emit BondClaimed(bondId, b.owner, amount);
    }

    function _vested(Bond storage b) private view returns (uint256) {
        uint256 elapsed = block.timestamp - b.start;
        if (elapsed >= b.vestSeconds) return b.payout;
        return (b.payout * elapsed) / b.vestSeconds;
    }

    /// @notice The claimable OMR of a bond right now (a convenience read for the UI/watcher).
    function claimable(uint256 bondId) external view returns (uint256) {
        Bond storage b = bonds[bondId];
        return _vested(b) - b.claimed;
    }

    // ── admin (the Safe) ──
    function setSigner(address s) external onlyOwner {
        if (s == address(0)) revert ZeroAddress();
        signer = s;
        emit SignerSet(s);
    }

    function setRecipients(address payable pol, address payable dev, address payable rwa, address payable vig) external onlyOwner {
        if (polBps > 0 && pol == address(0)) revert ZeroAddress();
        if (devBps > 0 && dev == address(0)) revert ZeroAddress();
        if (rwaBps > 0 && rwa == address(0)) revert ZeroAddress();
        if (polBps + devBps + rwaBps < 10000 && vig == address(0)) revert ZeroAddress();
        polRecipient = pol;
        devRecipient = dev;
        rwaRecipient = rwa;
        vigRecipient = vig;
        emit RecipientsSet(pol, dev, rwa, vig);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice The Safe can pull back only OMR that is NOT backing an outstanding vested bond. With
    ///         the payout minted at bond time, `committedOMR` is always covered by the balance, so
    ///         this is exactly the surplus — a sweep can never strand a bonder's claim.
    function sweep(address to, uint256 amount) external onlyOwner {
        if (amount > omr.balanceOf(address(this)) - committedOMR) revert OverSweep();
        omr.safeTransfer(to, amount);
        emit Swept(to, amount);
    }

    /// @notice Rescue any ETH that somehow lands here outside `bond()` (e.g. a selfdestruct push) —
    ///         the bond path forwards its full msg.value in-tx and never leaves a balance behind.
    ///         Routes to `owner()` (the Safe), NOT a recipient, so a misconfigured recipient can't
    ///         also trap the rescue (the OmertaFees.sweep pattern).
    function sweepETH() external onlyOwner nonReentrant {
        uint256 bal = address(this).balance;
        if (bal > 0) {
            (bool ok, ) = payable(owner()).call{value: bal}("");
            if (!ok) revert ForwardFailed();
        }
    }
}

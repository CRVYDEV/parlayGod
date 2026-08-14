// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title DynastyNFT — OMERTÀ's identity NFT (omerta-dynasty-machine-design.md §4, omerta-identity-nft-design.md §5).
/// @notice The player's on-chain bloodline identity: the tradeable trophy an account mints, and the future
///         host for an ERC-6551 token-bound account that stock is DELIVERED into (StockVault). Deliberately
///         "the plainest possible ERC-721" — 6551 layers onto any already-deployed NFT, so this contract
///         carries no 6551 code and needs none.
///
///         THE WALL (identity §1, dynasty §2.2): the game ENTITLEMENT (`account_persistent.minted`, the
///         wage/withdraw gates) stays ACCOUNT-BOUND in the backend and is NEVER read off `balanceOf`. This
///         contract therefore gates NOTHING on a balance — the trophy transfers, the entitlement does not.
///         Selling this token sells the delivered contents of its token-bound account + the portrait; it
///         never sells the account, the login, the legends, or the extraction entitlement.
///
///         SUPPLY IS UNCAPPED (founder rule 1: a cap on the identity would cap the player count). tokenId is
///         a plain sequential counter — a dynasty is not named at mint, and the backend maps tokenId → the
///         owning account off-chain. Minting is a SERVER-SIGNED voucher self-mint (the StreetDeed / OmertaBond
///         precedent): the player pays the ETH mint fee at `OmertaFees.payMintFee()` (the fee rail is
///         unchanged, wave-priced off-chain), the backend then signs a mint voucher, and the player claims
///         their trophy (paying their own gas). There is deliberately NO owner-mint, so "the Safe was
///         compromised" and "identities were minted" stay two separate events (the OMR.minter discipline).
///         A compromised signer is bounded by the daily mint cap (rate), the nonce (no replay), the short
///         deadline (+ a MAX_VOUCHER_TTL backstop), the Safe rotating the signer — and, decisively, that the
///         token carries NO extraction entitlement, so a signer minting trophies to itself steals nothing.
///
///         tokenURI is OFF-CHAIN (the layered portrait compositor), because the portrait is LIVE game history
///         that must resolve to the OWNING ACCOUNT'S CURRENT STREET — a thing the contract cannot know — and
///         it FREEZES at the first transfer away from the minting wallet (a sold portrait is a photograph;
///         the backend owns that semantics off the standard Transfer log + the `Minted` event's minter). No
///         mutable street name, no exact field-conjunction and no wealth is engraved on-chain (the
///         wallet↔character firewall + the anti-precise-kill-EV rule); provenance traits are an OPT-IN,
///         DISPLAY-ONLY off-chain metadata attribute and touch nothing here.
contract DynastyNFT is ERC721, ERC2981, EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using Strings for uint256;

    /// @notice Deadline backstop (VoucherClaim.MAX_VOUCHER_TTL mirror) — a leaked-then-rotated signer key's
    ///         pre-signed vouchers can't stay claimable for months. The server signs far shorter deadlines.
    uint256 public constant MAX_VOUCHER_TTL = 30 days;

    bytes32 public constant MINT_VOUCHER_TYPEHASH = keccak256(
        "MintVoucher(address to,uint256 nonce,uint256 deadline)"
    );

    struct MintVoucher {
        address to;       // the wallet that mints (the paying player's linked wallet)
        uint256 nonce;    // server-unique; replay protection (also the backend's mint-request key)
        uint256 deadline; // unix seconds
    }

    address public signer;
    uint256 public dailyMintCap;   // max identities mintable per UTC day, 0 = unlimited (a leaked-signer rate wall)
    uint256 public nextId = 1;     // sequential tokenId; uncapped collection
    mapping(uint256 => bool) public usedNonce;
    mapping(uint256 => uint256) public mintedOnDay; // day => identities minted

    // Off-chain metadata pointer (the layered portrait + LIVE legend). Set by the Safe. tokenURI = <base><id>.
    string private _baseUri;

    event SignerSet(address indexed signer);
    event DailyMintCapSet(uint256 cap);
    event BaseUriSet(string base);
    // `minter` is the wallet the token was minted to — the backend's freeze anchor (dynamic while the current
    // owner still equals `minter`, frozen once it transfers away). `nonce` ties the mint to the backend request.
    event Minted(uint256 indexed nonce, address indexed minter, uint256 indexed tokenId);

    constructor(address owner_, address signer_, string memory baseUri_, address royaltyRecipient_, uint96 royaltyBps_)
        ERC721("OMERTA Dynasty", "OMERTA")
        EIP712("OmertaDynasty", "1")
        Ownable(owner_)
    {
        require(signer_ != address(0), "DN: zero signer");
        require(royaltyRecipient_ != address(0), "DN: zero royalty recipient");
        signer = signer_;
        _baseUri = baseUri_;
        _setDefaultRoyalty(royaltyRecipient_, royaltyBps_); // EIP-2981; ERC2981 caps bps at 10000
    }

    // ── admin (the Safe) ──
    function setSigner(address s) external onlyOwner {
        require(s != address(0), "DN: zero signer");
        signer = s;
        emit SignerSet(s);
    }

    function setDailyMintCap(uint256 cap) external onlyOwner {
        dailyMintCap = cap;
        emit DailyMintCapSet(cap);
    }

    function setBaseUri(string calldata base_) external onlyOwner {
        _baseUri = base_;
        emit BaseUriSet(base_);
    }

    /// @notice Rotate the EIP-2981 royalty (recipient + bps). "Royalties are ordinary and fine" (design §6);
    ///         a revenue-share / floor-support framing is not — that is a COPY rule, enforced off-chain.
    function setDefaultRoyalty(address recipient, uint96 bps) external onlyOwner {
        require(recipient != address(0), "DN: zero royalty recipient");
        _setDefaultRoyalty(recipient, bps); // ERC2981 reverts if bps > 10000
    }

    // Pausing stops new MINTS only; it can never trap a holder's token (there is no vault here — the token
    // lives in the holder's wallet, and its 6551 account's contents are the account's, not this contract's).
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ── the mint (a server-signed, fee-gated-off-chain voucher self-mint) ──
    function hashVoucher(MintVoucher calldata v) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            MINT_VOUCHER_TYPEHASH, v.to, v.nonce, v.deadline
        )));
    }

    /// @notice Mint one identity to `v.to` on a server signature. The tokenId is the next sequential id; the
    ///         backend learns it from the `Minted` event (keyed by nonce → its mint request → the account).
    ///         The extraction entitlement (`minted`) is set in the backend the moment the ETH fee is paid and
    ///         does NOT depend on this trophy being claimed — so a player who never claims still plays fully.
    function claim(MintVoucher calldata v, bytes calldata sig) external nonReentrant whenNotPaused returns (uint256) {
        require(block.timestamp <= v.deadline, "DN: expired");
        require(v.deadline <= block.timestamp + MAX_VOUCHER_TTL, "DN: deadline too far");
        require(v.to != address(0), "DN: zero recipient");
        require(!usedNonce[v.nonce], "DN: replay");
        require(ECDSA.recover(hashVoucher(v), sig) == signer, "DN: bad signature");
        usedNonce[v.nonce] = true;

        uint256 day = block.timestamp / 1 days;
        uint256 newTotal = mintedOnDay[day] + 1;
        require(dailyMintCap == 0 || newTotal <= dailyMintCap, "DN: daily cap");
        mintedOnDay[day] = newTotal;

        uint256 id = nextId++;
        _safeMint(v.to, id);
        emit Minted(v.nonce, v.to, id);
        return id;
    }

    // ── metadata (off-chain, resolves to the OWNING ACCOUNT'S current street + freezes on transfer) ──
    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id); // reverts for a nonexistent token (ERC721NonexistentToken)
        return string.concat(_baseUri, id.toString());
    }

    // ERC721 + ERC2981 both declare supportsInterface — combine them.
    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}

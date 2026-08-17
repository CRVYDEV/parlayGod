// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @title StreetDeed — the on-chain half of OMERTÀ's Street Deeds (omerta-street-deeds-design.md §2/§3).
/// @notice A named, mapped plot of the city, extracted from the game as a tradeable ERC-721 collectible.
///
///         THE ONE STRUCTURAL RULE (design §0): the DEED transfers on-chain, the game's EXTRACTION
///         ENTITLEMENT and the rent/turf CONTROL do NOT. Provenance (the legend) travels with the
///         token — it is the value — and it is served off-chain because it is LIVE game history that
///         grows. Control is earned in-game; buying this token buys a collectible with a history, never
///         game power, so a liquid secondary market is safe (the v3-step-7 rarity-NFT posture: an
///         extracted item is INERT in-game). To play the rent/turf game with a deed again, its holder
///         RE-IMPORTS it (`redeem` → the burn is the proof; the backend re-creates the in-game deed).
///
///         Minting is by a SERVER-SIGNED voucher only — there is deliberately no owner-mint, so "the
///         Safe was compromised" and "deeds were minted" stay two separate events (the OMR.minter
///         discipline). A compromised signer is bounded by: the daily mint cap (rate), the nonce
///         (no replay), the short deadline (+ a MAX_VOUCHER_TTL backstop), the Safe rotating the
///         signer — and, decisively, that a deed carries NO extraction value (the `minted` flag does
///         not travel), so a signer that mints trophies to itself steals nothing a player can cash out.
///
///         tokenId = uint256(keccak256(bytes(name))). The server signs the canonical street NAME and
///         the contract DERIVES the tokenId, so the name↔tokenId map is a bijection enforced on-chain:
///         a voucher can never claim one tokenId for a different name, and a name can be minted at most
///         once (ERC-721 `_safeMint` reverts on an existing token). After a `redeem` burns it the token
///         no longer exists, so a fresh voucher (new nonce) can re-extract the SAME street — the id is
///         stable across round-trips because the name never changes.
contract StreetDeed is ERC721, EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using Strings for uint256;

    /// @notice Deadline backstop, mirroring VoucherClaim.MAX_VOUCHER_TTL — a leaked-then-rotated
    ///         signer key's pre-signed vouchers can't stay claimable for months. The server signs
    ///         much shorter deadlines in practice.
    uint256 public constant MAX_VOUCHER_TTL = 30 days;

    bytes32 public constant DEED_VOUCHER_TYPEHASH = keccak256(
        "DeedVoucher(address to,string name,string district,uint256 nonce,uint256 deadline)"
    );

    struct DeedVoucher {
        address to;
        string name;     // the canonical street name; tokenId = uint256(keccak256(bytes(name)))
        string district; // the mapped district (display string) — on-chain identity, immutable
        uint256 nonce;   // server-unique; replay protection
        uint256 deadline; // unix seconds
    }

    address public signer;
    uint256 public dailyMintCap; // max deeds mintable per UTC day, 0 = unlimited (a leaked-signer rate wall)
    mapping(uint256 => bool) public usedNonce;
    mapping(uint256 => uint256) public mintedOnDay; // day => deeds minted

    // ── on-chain identity (immutable per token; survives the game server being down) ──
    mapping(uint256 => string) public deedName;
    /// @notice THE LISTING LOCK (design 5, drain-before-sale) — every deed is NON-TRANSFERABLE by
    ///         default: minted locked, and RE-LOCKED on every transfer, so each new owner starts
    ///         locked too. Selling is a deliberate two-step — the OWNER (never an approved operator:
    ///         a marketplace approval must not be able to unlock, that is the drain vector) calls
    ///         setTransferLock(id, false), which emits a public event a buyer can anchor on: check
    ///         the deed's ERC-6551 vault CONTENTS after the unlock block — anything drained between
    ///         unlock and sale is visible on-chain in that window. Not an escrow and not airtight
    ///         (an unlocked deed can still be drained pre-sale — the event makes it VISIBLE, which
    ///         is the design's stated preference over a custody scheme); redeem() is NEVER blocked
    ///         by the lock — a lock that trapped the holder's own burn-back would violate the
    ///         never-trap rule the pause already honors.
    mapping(uint256 => bool) public transferLocked;
    mapping(uint256 => string) public deedDistrict;

    // Off-chain pointers for the rich, LIVE parts (the block plate + the legend page). Set by the Safe.
    // The identity (name/district) is on-chain; only the image and the "see its full history" link are
    // off-chain, which is correct: the legend GROWS with play and cannot be immutable.
    string private _imageBase;    // e.g. "https://www.omerta.fun/v1/deeds/plate/" → <base><id>.svg
    string private _externalBase; // e.g. "https://www.omerta.fun/deed/"            → <base><id>

    event SignerSet(address indexed signer);
    event DailyMintCapSet(uint256 cap);
    event ImageBaseSet(string base);
    event ExternalBaseSet(string base);
    event TransferLockSet(uint256 indexed tokenId, bool locked, address indexed by);
    event Extracted(uint256 indexed nonce, address indexed to, uint256 indexed tokenId, string name, string district);
    event Redeemed(address indexed from, uint256 indexed tokenId);

    /// @dev `dailyMintCap_` is a CONSTRUCTOR argument rather than a setter-only field on purpose: this
    ///      contract self-mints on the SAME signer key as VoucherClaim/OmertaBond/DynastyNFT, so that key's
    ///      blast radius is the SUM of the four daily caps — and a wall that lives only in a deploy
    ///      checklist is one a deploy can forget. Both siblings that take theirs at construction cannot be
    ///      forgotten; these two could, and were. 0 still means unlimited (the suite-wide convention), so
    ///      this forces a DECISION at deploy, not a particular number.
    constructor(
        address owner_,
        address signer_,
        string memory imageBase_,
        string memory externalBase_,
        uint256 dailyMintCap_
    )
        ERC721("OMERTA Street Deed", "STREET")
        EIP712("OmertaStreetDeed", "1")
        Ownable(owner_)
    {
        require(signer_ != address(0), "SD: zero signer");
        signer = signer_;
        _imageBase = imageBase_;
        _externalBase = externalBase_;
        dailyMintCap = dailyMintCap_;
        emit DailyMintCapSet(dailyMintCap_);
    }

    // ── admin (the Safe) ──
    function setSigner(address s) external onlyOwner {
        require(s != address(0), "SD: zero signer");
        signer = s;
        emit SignerSet(s);
    }

    function setDailyMintCap(uint256 cap) external onlyOwner {
        dailyMintCap = cap;
        emit DailyMintCapSet(cap);
    }

    function setImageBase(string calldata base_) external onlyOwner {
        _imageBase = base_;
        emit ImageBaseSet(base_);
    }

    function setExternalBase(string calldata base_) external onlyOwner {
        _externalBase = base_;
        emit ExternalBaseSet(base_);
    }

    // Pausing stops new EXTRACTIONS (claims) only; `redeem` is never pausable so a holder can always
    // bring their property back into the game — a pause that traps property is a rug the design forbids.
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ── the extraction (claim) ──
    function tokenIdFor(string memory name) public pure returns (uint256) {
        return uint256(keccak256(bytes(name)));
    }

    function hashVoucher(DeedVoucher calldata v) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            DEED_VOUCHER_TYPEHASH, v.to, keccak256(bytes(v.name)), keccak256(bytes(v.district)), v.nonce, v.deadline
        )));
    }

    /// @notice Mint (extract) the deed named `v.name` to `v.to`, on a server signature. tokenId is
    ///         derived from the name, so a name is minted at most once (a duplicate reverts in
    ///         `_safeMint`). The extraction entitlement (`minted`) and the rent/turf control stay in
    ///         the game — this only issues the collectible.
    function claim(DeedVoucher calldata v, bytes calldata sig) external nonReentrant whenNotPaused {
        require(block.timestamp <= v.deadline, "SD: expired");
        require(v.deadline <= block.timestamp + MAX_VOUCHER_TTL, "SD: deadline too far");
        require(v.to != address(0), "SD: zero recipient");
        require(bytes(v.name).length != 0, "SD: empty name");
        require(!usedNonce[v.nonce], "SD: replay");
        require(ECDSA.recover(hashVoucher(v), sig) == signer, "SD: bad signature");
        usedNonce[v.nonce] = true;

        uint256 day = block.timestamp / 1 days;
        uint256 newTotal = mintedOnDay[day] + 1;
        require(dailyMintCap == 0 || newTotal <= dailyMintCap, "SD: daily cap");
        mintedOnDay[day] = newTotal;

        uint256 id = tokenIdFor(v.name);
        deedName[id] = v.name;
        deedDistrict[id] = v.district;
        _safeMint(v.to, id); // reverts if the name (tokenId) already exists — one deed per name, ever

        emit Extracted(v.nonce, v.to, id, v.name, v.district);
    }

    /// @notice Burn the deed back toward the game — the on-chain half of re-import. The burn IS the
    ///         ownership proof (only the holder can call it), so no server signature is needed (the
    ///         event is the authority, exactly like GearVault.redeem). The backend watcher re-creates
    ///         the in-game deed on whoever burned it after CHAIN_CONFIRMATIONS. After the burn the token
    ///         no longer exists, so the same street can be re-extracted later with a fresh voucher.
    /// @notice Lock or unlock a deed for transfer. Owner-only — deliberately NOT approved
    ///         operators (see transferLocked). Unlocking is the public "listing" act.
    function setTransferLock(uint256 tokenId, bool locked) external {
        require(ownerOf(tokenId) == msg.sender, "SD: not owner");
        transferLocked[tokenId] = locked;
        emit TransferLockSet(tokenId, locked, msg.sender);
    }

    function redeem(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "SD: not owner"); // reverts if nonexistent — clean
        _burn(tokenId);
        // Keep the name/district for a possible re-extraction's metadata; they are immutable and
        // re-derive identically from the same name anyway, so leaving them is harmless and cheaper.
        emit Redeemed(msg.sender, tokenId);
    }

    /// @dev The lock's enforcement point. Mint (from == 0) and burn (to == 0) pass — a claim must
    ///      land and redeem() must never be blocked — but an owner-to-owner transfer requires the
    ///      current owner to have unlocked first, and the deed RE-LOCKS the moment it arrives so
    ///      the default-ON invariant holds for every owner, not just the first.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0))
            require(!transferLocked[tokenId], "SD: locked - unlock before transfer");
        address prev = super._update(to, tokenId, auth);
        if (to == address(0)) delete transferLocked[tokenId];          // burn: clear the slot
        else transferLocked[tokenId] = true;                            // mint OR arrival: locked
        return prev;
    }

    // ── on-chain metadata ────────────────────────────────────────────────────────────────────────
    // Identity (name + district) is assembled ON-CHAIN, so a marketplace shows the real street even if
    // the game server is down. The image (the block plate) and external_url (the legend page) are the
    // off-chain pointers, which is correct: the plate and the LIVE legend grow with play. Marketing
    // guardrails (design §6) bind this string: property with a history, never "scarce/appreciating land".
    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id); // reverts for a nonexistent/burned token (ERC721NonexistentToken)
        string memory nm = _json(deedName[id]);
        string memory dt = _json(deedDistrict[id]);
        string memory json = string.concat(
            '{"name":"', nm, '",',
            '"description":"A Street Deed \\u2014 a named, mapped plot in the city of OMERT\\u00c0. Its worth is the story on it: everything that ever happened here. Property with a history.",',
            '"image":"', _imageBase, id.toString(), '.svg",',
            '"external_url":"', _externalBase, id.toString(), '",',
            '"attributes":[',
            '{"trait_type":"Type","value":"Street Deed"},',
            '{"trait_type":"District","value":"', dt, '"}',
            "]}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    // Minimal JSON string sanitizer: a deed name is player-chosen, and the backend already strips
    // < > " at claim (cleanText), but a marketplace parses this document, so we escape the two bytes
    // that could break the JSON regardless — a backslash and a double-quote. Control bytes are not
    // reachable (the name filter drops them), so this is belt-and-braces on the two structural chars.
    function _json(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(b.length * 2);
        uint256 n = 0;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == '"' || c == "\\") { out[n++] = "\\"; out[n++] = c; }
            else { out[n++] = c; }
        }
        bytes memory trimmed = new bytes(n);
        for (uint256 i = 0; i < n; i++) trimmed[i] = out[i];
        return string(trimmed);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @title GearVault — OMERTÀ extractable items as ERC-1155 (gear, cars, boats).
/// @notice One tokenId per item VARIANT. The tokenId is a SELF-DESCRIBING key — every scarcity trait
///         is derivable from it on-chain, with no per-token storage (this is what makes the metadata
///         "provably the token's, not a server's claim"; see `uri`):
///           * gear:  id 1..CAR_BASE-1        — a 1-based gear-class index, no rarity dimension
///           * cars:  CAR_BASE  + idx*STRIDE + rarityIndex
///           * boats: BOAT_BASE + idx*STRIDE + rarityIndex
///         These three constants MIRROR `RARITY.TOKEN` in src/rules.tail.js and the `nftTokenId`
///         helper there — they are the on-chain half of that encoding and must move in lockstep
///         (the contract/backend parity discipline used across this suite).
///
///         Minting is restricted to the VoucherClaim contract: an item enters the chain only when the
///         game server signed for it. Transfers are open — an extracted item is real property, it
///         survives the character, and (per the v3-step-7 rule) it is INERT in-game, so a liquid
///         secondary market is safe: buying one gets you a trophy, never game power.
contract GearVault is ERC1155, Ownable2Step {
    using Strings for uint256;

    // ── tokenId encoding (MIRRORS RARITY.TOKEN in rules.tail.js) ─────────────────────────────────
    uint256 public constant CAR_BASE = 100000;
    uint256 public constant BOAT_BASE = 200000;
    uint256 public constant STRIDE = 10;

    address public minter; // VoucherClaim
    string private _imageBase; // e.g. "ipfs://<CID>/" — the per-tokenId plate lives at <base><id>.png

    // AUDIT (full-system-v2 G-MED-1): the per-tokenId LIFETIME supply cap is enforced HERE, at the
    // asset layer, NOT only in the minter (VoucherClaim). The minter is a swappable slot; if the cap
    // + minted-count lived only in the bridge, a Safe minter swap (VC-v1 -> VC-v2) would reset the
    // count and let every id mint its cap AGAIN (2x+ the intended lifetime supply). GearVault
    // persists across bridge upgrades, so tracking `minted` here makes "gear is fail-closed and
    // bounded by a per-id supply cap" (CLAUDE.md #5) actually hold. cap 0 => class can't mint.
    mapping(uint256 => uint256) public cap;    // tokenId => max LIFETIME supply (0 = mint blocked)
    mapping(uint256 => uint256) public minted; // tokenId => minted so far (survives a minter swap)

    // OPTIONAL marketplace readability: a Safe-set display name per CLASS (rarity-independent), keyed
    // by the class's base tokenId (rarity digit stripped — see _classKey). Unset falls back to a
    // derived "Car #<idx>" / "Boat #<idx>" / "Gear #<id>", so the vault renders fine with none set;
    // set them at deploy so "GTO · Legendary" shows instead of "Car #3 · Legendary". Safe is root of
    // trust, so the name is not JSON-escaped here — do not set a name containing a double-quote.
    mapping(uint256 => string) public className;

    event MinterSet(address indexed minter);
    event ImageBaseSet(string base);
    event GearCapSet(uint256 indexed tokenId, uint256 cap);
    event ClassNameSet(uint256 indexed classKey, string name);

    constructor(address owner_, string memory imageBase_) ERC1155("") Ownable(owner_) {
        _imageBase = imageBase_;
    }

    function setMinter(address m) external onlyOwner {
        // AUDIT hardening: never let the minter be zeroed — a mis-set/zero minter silently bricks
        // claims. To retire minting, pause VoucherClaim; don't strand the slot. (The lifetime cap
        // now lives here, so a minter swap can never reset the per-id supply.)
        require(m != address(0), "GearVault: zero minter");
        minter = m;
        emit MinterSet(m);
    }

    /// @notice The Safe sets each token's authoritative LIFETIME supply cap here. It can only be
    ///         raised or held — never lowered below what's already minted — so the bound is monotone
    ///         and a swapped-in minter inherits the real remaining headroom.
    function setGearCap(uint256 tokenId, uint256 c) external onlyOwner {
        require(c >= minted[tokenId], "GearVault: below minted");
        cap[tokenId] = c;
        emit GearCapSet(tokenId, c);
    }

    function setImageBase(string calldata base_) external onlyOwner {
        _imageBase = base_;
        emit ImageBaseSet(base_);
    }

    /// @notice Set the display name for a whole class (all rarities of a car/boat, or a gear class).
    ///         Pass the class's BASE tokenId (rarity digit 0 for cars/boats; the gear id itself).
    ///         Optional — the vault renders a derived name when unset.
    function setClassName(uint256 classKey, string calldata name_) external onlyOwner {
        className[classKey] = name_;
        emit ClassNameSet(classKey, name_);
    }

    /// @notice Batch form of setClassName for a cheap deploy of the whole catalog.
    function setClassNames(uint256[] calldata classKeys, string[] calldata names) external onlyOwner {
        require(classKeys.length == names.length, "GearVault: length");
        for (uint256 i = 0; i < classKeys.length; i++) {
            className[classKeys[i]] = names[i];
            emit ClassNameSet(classKeys[i], names[i]);
        }
    }

    function mint(address to, uint256 tokenId, uint256 amount) external {
        require(msg.sender == minter, "GearVault: not minter");
        // asset-layer lifetime cap — fail-closed (cap 0 blocks) and survives a minter swap (G-MED-1)
        uint256 m = minted[tokenId] + amount;
        require(cap[tokenId] != 0 && m <= cap[tokenId], "GearVault: cap");
        minted[tokenId] = m;
        _mint(to, tokenId, amount, "");
    }

    // ── on-chain metadata ────────────────────────────────────────────────────────────────────────
    // The type/rarity/class attributes are DERIVED from the tokenId here, so a marketplace shows the
    // real, provable scarcity of the item — not a claim a server could change or fail to serve. The
    // image is the one off-chain pointer (an IPFS-pinned plate), which is correct for the rich
    // photographic art (see omerta-onchain-items-design.md §3/§4): a 260KB JPEG can't live on-chain,
    // but IPFS pins it permanently and the traits that matter for scarcity are on-chain regardless.

    function _isCar(uint256 id) internal pure returns (bool) { return id >= CAR_BASE && id < BOAT_BASE; }
    function _isBoat(uint256 id) internal pure returns (bool) { return id >= BOAT_BASE; }

    /// @dev The class's base tokenId (rarity digit stripped). Gear ids are already unique class keys.
    function _classKey(uint256 id) internal pure returns (uint256) {
        if (_isCar(id)) return id - ((id - CAR_BASE) % STRIDE);
        if (_isBoat(id)) return id - ((id - BOAT_BASE) % STRIDE);
        return id;
    }

    /// @dev 0-based index of the class within its catalog (car/boat), or the gear id itself.
    function _classIdx(uint256 id) internal pure returns (uint256) {
        if (_isCar(id)) return (id - CAR_BASE) / STRIDE;
        if (_isBoat(id)) return (id - BOAT_BASE) / STRIDE;
        return id;
    }

    /// @dev The rarity index (cars/boats only). Mirrors RARITY.TIERS ordering in rules.tail.js.
    function _rarityIdx(uint256 id) internal pure returns (uint256) {
        if (_isCar(id)) return (id - CAR_BASE) % STRIDE;
        if (_isBoat(id)) return (id - BOAT_BASE) % STRIDE;
        return 0;
    }

    function _typeName(uint256 id) internal pure returns (string memory) {
        if (_isCar(id)) return "Car";
        if (_isBoat(id)) return "Boat";
        return "Gear";
    }

    /// @dev The four rarity names, mirroring RARITY.TIERS. A 5th tier (STRIDE leaves headroom) would
    ///      add one line here — same parity discipline as the encoding constants.
    function _rarityName(uint256 i) internal pure returns (string memory) {
        if (i == 0) return "Common";
        if (i == 1) return "Rare";
        if (i == 2) return "Legendary";
        if (i == 3) return "Epic";
        return string.concat("Tier ", i.toString());
    }

    function _displayName(uint256 id) internal view returns (string memory) {
        string memory set = className[_classKey(id)];
        if (bytes(set).length != 0) return set;
        return string.concat(_typeName(id), " #", _classIdx(id).toString());
    }

    /// @notice ERC-1155 metadata: an on-chain-assembled JSON data URI. `name`/`attributes` are
    ///         derived from the tokenId (provable on-chain); `image` points to the IPFS-pinned plate.
    function uri(uint256 id) public view override returns (string memory) {
        string memory disp = _displayName(id);
        bool rarityBearing = _isCar(id) || _isBoat(id);

        // name: "<class> · <Rarity>" for cars/boats, "<class>" for gear. Every non-ASCII glyph
        // is a JSON \u escape so the whole document is ASCII bytes (unambiguous, trivially testable;
        // marketplaces decode the escapes).
        string memory title = rarityBearing
            ? string.concat(disp, " \\u00b7 ", _rarityName(_rarityIdx(id)))
            : disp;

        // attributes: Type + Class(number) always; Rarity for cars/boats.
        string memory attrs = string.concat(
            '[{"trait_type":"Type","value":"', _typeName(id), '"},',
            '{"trait_type":"Class","value":', _classIdx(id).toString(), "}"
        );
        if (rarityBearing) {
            attrs = string.concat(
                attrs,
                ',{"trait_type":"Rarity","value":"', _rarityName(_rarityIdx(id)), '"}'
            );
        }
        attrs = string.concat(attrs, "]");

        string memory json = string.concat(
            '{"name":"OMERT\\u00c0 ', title, '",',
            '"description":"An extracted OMERT\\u00c0 item \\u2014 real on-chain property that survives the character. It is inert in-game (a trophy, not an advantage), which is what makes it safe to trade.",',
            '"image":"', _imageBase, id.toString(), '.png",',
            '"attributes":', attrs, "}"
        );

        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}

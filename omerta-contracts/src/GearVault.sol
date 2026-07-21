// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title GearVault — OMERTÀ NFT gear as ERC-1155.
/// @notice One tokenId per gear class (Brass Knuckles = 1, ... 51 classes at
///         launch; ids are assigned by the game server's rules table).
///         Minting is restricted to the VoucherClaim contract: gear enters
///         the chain only when the game server signed for it. Transfers are
///         open — gear is real property and survives the character.
contract GearVault is ERC1155, Ownable2Step {
    using Strings for uint256;

    address public minter; // VoucherClaim
    string private _base;

    // AUDIT (full-system-v2 G-MED-1): the per-gearId LIFETIME supply cap is enforced HERE, at the
    // asset layer, NOT only in the minter (VoucherClaim). The minter is a swappable slot; if the cap
    // + minted-count lived only in the bridge, a Safe minter swap (VC-v1 -> VC-v2) would reset the
    // count and let every gearId mint its cap AGAIN (2x+ the intended lifetime supply). GearVault
    // persists across bridge upgrades, so tracking `minted` here makes "gear is fail-closed and
    // bounded by a per-gearId supply cap" (CLAUDE.md #5) actually hold. cap 0 => class can't mint.
    mapping(uint256 => uint256) public cap;    // gearId => max LIFETIME supply (0 = mint blocked)
    mapping(uint256 => uint256) public minted; // gearId => minted so far (survives a minter swap)

    event MinterSet(address indexed minter);
    event BaseURISet(string base);
    event GearCapSet(uint256 indexed gearId, uint256 cap);

    constructor(address owner_, string memory base_) ERC1155("") Ownable(owner_) {
        _base = base_;
    }

    function setMinter(address m) external onlyOwner {
        // AUDIT hardening: never let the minter be zeroed — a mis-set/zero minter silently bricks
        // gear claims. To retire minting, pause VoucherClaim; don't strand the slot. (The lifetime
        // cap now lives here, so a minter swap can never reset the per-gearId supply.)
        require(m != address(0), "GearVault: zero minter");
        minter = m;
        emit MinterSet(m);
    }

    /// @notice The Safe sets each gear class's authoritative LIFETIME supply cap here. It can only be
    ///         raised or held — never lowered below what's already minted — so the bound is monotone
    ///         and a swapped-in minter inherits the real remaining headroom.
    function setGearCap(uint256 gearId, uint256 c) external onlyOwner {
        require(c >= minted[gearId], "GearVault: below minted");
        cap[gearId] = c;
        emit GearCapSet(gearId, c);
    }

    function setBaseURI(string calldata base_) external onlyOwner {
        _base = base_;
        emit BaseURISet(base_);
    }

    function uri(uint256 id) public view override returns (string memory) {
        return string.concat(_base, id.toString(), ".json");
    }

    function mint(address to, uint256 gearId, uint256 amount) external {
        require(msg.sender == minter, "GearVault: not minter");
        // asset-layer lifetime cap — fail-closed (cap 0 blocks) and survives a minter swap (G-MED-1)
        uint256 m = minted[gearId] + amount;
        require(cap[gearId] != 0 && m <= cap[gearId], "GearVault: cap");
        minted[gearId] = m;
        _mint(to, gearId, amount, "");
    }
}

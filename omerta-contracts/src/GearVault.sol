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

    event MinterSet(address indexed minter);
    event BaseURISet(string base);

    constructor(address owner_, string memory base_) ERC1155("") Ownable(owner_) {
        _base = base_;
    }

    function setMinter(address m) external onlyOwner {
        // AUDIT hardening: never let the minter be zeroed — a mis-set/zero minter silently bricks
        // gear claims (GearVault has no cap of its own; all fail-closed cap logic lives in the
        // minter, VoucherClaim). To retire minting, pause VoucherClaim; don't strand the slot.
        require(m != address(0), "GearVault: zero minter");
        minter = m;
        emit MinterSet(m);
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
        _mint(to, gearId, amount, "");
    }
}

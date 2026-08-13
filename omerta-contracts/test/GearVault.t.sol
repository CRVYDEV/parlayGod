// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {GearVault} from "../src/GearVault.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// GearVault's on-chain metadata rail (omerta-onchain-items-design.md §4). The claim under test is
/// the one that makes "sell items on marketplaces" true rather than aspirational: `uri(id)` returns
/// a self-contained JSON data URI whose scarcity traits (Type / Class / Rarity) are DERIVED from the
/// tokenId on-chain — provably the token's, not a server's claim — with the image the one off-chain
/// (IPFS) pointer, which is correct for the rich photographic art.
///
/// The tests pin the EXACT bytes rather than substrings: the return value IS what OpenSea parses, so
/// re-encoding the expected JSON with the same Base64 lib and asserting equality is the honest test,
/// and it doubles as executable documentation of the metadata a buyer sees.
contract GearVaultTest is Test {
    using Strings for uint256;

    GearVault gear;
    address safe = makeAddr("safe");
    string constant IMG = "ipfs://CID/";

    // The three constants that MUST mirror RARITY.TOKEN in rules.tail.js — asserted below so a drift
    // in the contract breaks the suite (the encoding is the whole basis of the derived traits).
    uint256 constant CAR_BASE = 100000;
    uint256 constant BOAT_BASE = 200000;
    uint256 constant STRIDE = 10;

    // The common description body, shared by every token (À and — as JSON \u escapes → ASCII bytes).
    string constant DESC =
        "An extracted OMERT\\u00c0 item \\u2014 real on-chain property that survives the character. It is inert in-game (a trophy, not an advantage), which is what makes it safe to trade.";

    function setUp() public {
        gear = new GearVault(safe, IMG);
    }

    // Rebuild the exact data URI the contract should return, so equality pins the real bytes.
    function _uriFor(string memory title, string memory attrs, uint256 id) internal pure returns (string memory) {
        string memory json = string.concat(
            '{"name":"OMERT\\u00c0 ', title, '",',
            '"description":"', DESC, '",',
            '"image":"', IMG, id.toString(), '.png",',
            '"attributes":', attrs, "}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function test_encoding_constants_mirror_rules() public view {
        assertEq(gear.CAR_BASE(), CAR_BASE, "CAR_BASE drifted from RARITY.TOKEN");
        assertEq(gear.BOAT_BASE(), BOAT_BASE, "BOAT_BASE drifted from RARITY.TOKEN");
        assertEq(gear.STRIDE(), STRIDE, "STRIDE drifted from RARITY.TOKEN");
    }

    function test_gear_has_no_rarity_trait() public view {
        // Gear id 7, no class name set → derived "Gear #7", Type+Class only, no Rarity.
        string memory attrs = '[{"trait_type":"Type","value":"Gear"},{"trait_type":"Class","value":7}]';
        assertEq(gear.uri(7), _uriFor("Gear #7", attrs, 7), "gear metadata");
    }

    function test_car_derives_class_and_rarity_from_tokenId() public view {
        // class idx 3, rarity idx 2 (Legendary). No name → "Car #3".
        uint256 id = CAR_BASE + 3 * STRIDE + 2; // 100032
        string memory attrs = string.concat(
            '[{"trait_type":"Type","value":"Car"},',
            '{"trait_type":"Class","value":3},',
            '{"trait_type":"Rarity","value":"Legendary"}]'
        );
        assertEq(gear.uri(id), _uriFor("Car #3 \\u00b7 Legendary", attrs, id), "car metadata");
    }

    function test_boat_epic() public view {
        // class idx 0, rarity idx 3 (Epic).
        uint256 id = BOAT_BASE + 0 * STRIDE + 3; // 200003
        string memory attrs = string.concat(
            '[{"trait_type":"Type","value":"Boat"},',
            '{"trait_type":"Class","value":0},',
            '{"trait_type":"Rarity","value":"Epic"}]'
        );
        assertEq(gear.uri(id), _uriFor("Boat #0 \\u00b7 Epic", attrs, id), "boat metadata");
    }

    function test_every_rarity_index_decodes() public view {
        // Sweep the four tiers on one car class; the name half must track the rarity digit exactly.
        string[4] memory names = ["Common", "Rare", "Legendary", "Epic"];
        for (uint256 r = 0; r < 4; r++) {
            uint256 id = CAR_BASE + 5 * STRIDE + r;
            string memory attrs = string.concat(
                '[{"trait_type":"Type","value":"Car"},',
                '{"trait_type":"Class","value":5},',
                '{"trait_type":"Rarity","value":"', names[r], '"}]'
            );
            assertEq(
                gear.uri(id),
                _uriFor(string.concat("Car #5 \\u00b7 ", names[r]), attrs, id),
                "rarity digit"
            );
        }
    }

    function test_class_name_override_is_used_and_shared_across_rarities() public {
        // Name the class (base tokenId, rarity digit 0); every rarity variant of it must pick it up.
        uint256 classKey = CAR_BASE + 3 * STRIDE; // 100030 — the class base for idx 3
        vm.prank(safe);
        gear.setClassName(classKey, "GTO");

        uint256 legendary = CAR_BASE + 3 * STRIDE + 2;
        string memory attrs = string.concat(
            '[{"trait_type":"Type","value":"Car"},',
            '{"trait_type":"Class","value":3},',
            '{"trait_type":"Rarity","value":"Legendary"}]'
        );
        assertEq(gear.uri(legendary), _uriFor("GTO \\u00b7 Legendary", attrs, legendary), "named car");

        // A DIFFERENT rarity of the same class shares the name (the name is class-, not variant-keyed).
        uint256 common = CAR_BASE + 3 * STRIDE + 0;
        string memory attrsC = string.concat(
            '[{"trait_type":"Type","value":"Car"},',
            '{"trait_type":"Class","value":3},',
            '{"trait_type":"Rarity","value":"Common"}]'
        );
        assertEq(gear.uri(common), _uriFor("GTO \\u00b7 Common", attrsC, common), "shared name");
    }

    function test_batch_class_names() public {
        uint256[] memory keys = new uint256[](2);
        string[] memory names = new string[](2);
        keys[0] = CAR_BASE; names[0] = "Beater";
        keys[1] = BOAT_BASE; names[1] = "Dinghy";
        vm.prank(safe);
        gear.setClassNames(keys, names);
        assertEq(gear.className(CAR_BASE), "Beater");
        assertEq(gear.className(BOAT_BASE), "Dinghy");
    }

    function test_only_owner_sets_names_and_base() public {
        vm.expectRevert();
        gear.setClassName(CAR_BASE, "hax");
        vm.expectRevert();
        gear.setImageBase("ipfs://evil/");
    }

    function test_image_base_flows_into_metadata() public {
        vm.prank(safe);
        gear.setImageBase("ipfs://NEWCID/");
        // Just assert the new base appears in the (decoded-invariant) output for a simple gear id.
        string memory got = gear.uri(1);
        // Re-derive with the new base.
        string memory json = string.concat(
            '{"name":"OMERT\\u00c0 Gear #1",',
            '"description":"', DESC, '",',
            '"image":"ipfs://NEWCID/1.png",',
            '"attributes":[{"trait_type":"Type","value":"Gear"},{"trait_type":"Class","value":1}]}'
        );
        assertEq(got, string.concat("data:application/json;base64,", Base64.encode(bytes(json))), "new base");
    }
}

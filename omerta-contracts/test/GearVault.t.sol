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
    address minter = makeAddr("minter");
    address holder = makeAddr("holder");
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

    // ── NFT RE-IMPORT (Option A, omerta-nft-reimport-design.md): the redeem/burn-back path ──────────
    // The on-chain half of turning an extracted car/boat back into a live in-game item. The invariant
    // that matters is that LIVE on-chain supply (`minted - redeemed`) never exceeds the cap, and that a
    // redeem vacates EXACTLY one slot — no more, no fewer — so scarcity is conserved across round-trips.

    function _arm(uint256 id, uint256 c) internal {
        vm.startPrank(safe);
        gear.setMinter(minter);
        gear.setGearCap(id, c);
        vm.stopPrank();
    }

    function _mintTo(address to, uint256 id, uint256 amount) internal {
        vm.prank(minter);
        gear.mint(to, id, amount);
    }

    function test_redeem_burns_the_token_emits_and_does_NOT_decrement_minted() public {
        uint256 id = CAR_BASE + 1 * STRIDE + 0; // a common car
        _arm(id, 5);
        _mintTo(holder, id, 1);
        assertEq(gear.balanceOf(holder, id), 1, "minted to holder");

        vm.expectEmit(true, true, false, true, address(gear));
        emit GearVault.Redeemed(holder, id, 1);
        vm.prank(holder);
        gear.redeem(id, 1);

        assertEq(gear.balanceOf(holder, id), 0, "token burned");
        assertEq(gear.redeemed(id), 1, "redeemed counter incremented");
        assertEq(gear.minted(id), 1, "minted (lifetime) is NOT decremented");
    }

    function test_redeem_reverts_without_the_token() public {
        uint256 id = CAR_BASE + 2 * STRIDE + 0;
        _arm(id, 5);
        // holder holds nothing → _burn reverts (ERC1155InsufficientBalance). The burn IS the proof.
        vm.prank(holder);
        vm.expectRevert();
        gear.redeem(id, 1);
    }

    function test_redeem_zero_reverts() public {
        vm.prank(holder);
        vm.expectRevert(bytes("GearVault: zero"));
        gear.redeem(CAR_BASE, 0);
    }

    // GEAR JOINED THE ROUND TRIP (nft-reimport §7, founder-signed 2026-08-21). A gear burn works and
    // vacates a live-supply slot — but ONE AT A TIME (amount==1), because gear's in-game form is
    // account-level SET MEMBERSHIP: each Redeemed event must map to exactly one membership change,
    // or a batch burn collapses N tokens into one membership and silently destroys the rest.
    function test_gear_redeems_one_at_a_time() public {
        _arm(7, 5);
        _mintTo(holder, 7, 2);
        vm.prank(holder);
        vm.expectRevert(bytes("GearVault: gear one at a time"));
        gear.redeem(7, 2);
        vm.prank(holder);
        gear.redeem(7, 1);
        assertEq(gear.balanceOf(holder, 7), 1, "one burned, one still held");
        assertEq(gear.redeemed(7), 1, "gear burn vacates a live-supply slot");
        // gearId 0 stays reserved — never mintable, never redeemable.
        vm.prank(holder);
        vm.expectRevert(bytes("GearVault: not redeemable"));
        gear.redeem(0, 1);
    }

    function test_redeem_credit_lets_EXACTLY_one_re_extraction_bypass_the_cap() public {
        uint256 id = CAR_BASE + 4 * STRIDE + 3; // an epic car
        _arm(id, 2); // cap 2
        _mintTo(holder, id, 2); // at cap: minted 2, live 2

        // with no credit, a third mint reverts — live supply cannot exceed the cap
        vm.prank(minter);
        vm.expectRevert(bytes("GearVault: cap"));
        gear.mint(holder, id, 1);

        // holder redeems one → one slot of re-extract credit (minted 2, redeemed 1, live 1)
        vm.prank(holder);
        gear.redeem(id, 1);

        // now EXACTLY one more mint succeeds, reusing the slot the redeem vacated (live back to 2 ≤ 2)
        _mintTo(holder, id, 1); // minted 3, live 3-1 = 2
        assertEq(gear.balanceOf(holder, id), 2, "two live on-chain, never more than the cap");

        // and a further mint reverts: the credit was exactly one slot, live can never exceed the cap
        vm.prank(minter);
        vm.expectRevert(bytes("GearVault: cap"));
        gear.mint(holder, id, 1);
    }

    function test_setGearCap_floor_is_LIVE_supply_not_lifetime_minted() public {
        uint256 id = CAR_BASE + 6 * STRIDE + 1;
        _arm(id, 2);
        _mintTo(holder, id, 2); // minted 2
        vm.prank(holder);
        gear.redeem(id, 1); // redeemed 1, live 1

        // the cap can be TIGHTENED down to live supply (1) even though lifetime-minted is 2...
        vm.prank(safe);
        gear.setGearCap(id, 1);
        assertEq(gear.cap(id), 1, "cap tightened to live supply");

        // ...but not below it — 0 would strand the one live token above the cap
        vm.prank(safe);
        vm.expectRevert(bytes("GearVault: below live"));
        gear.setGearCap(id, 0);
    }
}

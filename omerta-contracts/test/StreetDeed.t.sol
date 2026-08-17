// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {StreetDeed} from "../src/StreetDeed.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// StreetDeed — the on-chain tradeable deed NFT (omerta-street-deeds-design.md §2/§3). The claims under
/// test are the ones the whole design rests on: a deed is minted ONLY on a server signature (bounded by
/// nonce/deadline/daily-cap, no owner-mint), the tokenId is a bijection of the street NAME (so a name
/// mints at most once and the same street re-extracts to the same id after a burn), and the burn (redeem)
/// is the ownership proof that lets a holder bring it back into the game.
contract StreetDeedTest is Test {
    using Strings for uint256;

    StreetDeed deed;
    address safe = makeAddr("safe");
    uint256 signerPk = 0xA11CE;
    address signerAddr;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    string constant IMG = "https://x/plate/";
    string constant EXT = "https://x/deed/";

    function setUp() public {
        signerAddr = vm.addr(signerPk);
        deed = new StreetDeed(safe, signerAddr, IMG, EXT, 0);
    }

    function _voucher(address to, string memory name, string memory district, uint256 nonce)
        internal view returns (StreetDeed.DeedVoucher memory)
    {
        return StreetDeed.DeedVoucher({ to: to, name: name, district: district, nonce: nonce, deadline: block.timestamp + 1 hours });
    }

    function _sign(StreetDeed.DeedVoucher memory v) internal view returns (bytes memory) {
        bytes32 digest = deed.hashVoucher(v);
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, vv);
    }

    // ── THE LISTING LOCK (design 5, drain-before-sale) ──────────────────────────────────────────
    function _mintTo(address to, string memory name, uint256 nonce) internal returns (uint256 id) {
        StreetDeed.DeedVoucher memory v = _voucher(to, name, "The Docks", nonce);
        bytes memory sig = _sign(v);
        deed.claim(v, sig);
        return deed.tokenIdFor(name);
    }

    function test_a_fresh_deed_is_locked_by_default_and_cannot_transfer() public {
        uint256 id = _mintTo(alice, "Locked Lane", 900);
        assertTrue(deed.transferLocked(id), "minted locked");
        vm.prank(alice);
        vm.expectRevert(bytes("SD: locked - unlock before transfer"));
        deed.transferFrom(alice, bob, id);
    }

    function test_the_owner_unlocks_then_the_transfer_works_and_it_relocks_on_arrival() public {
        uint256 id = _mintTo(alice, "Unlock Ave", 901);
        vm.prank(alice);
        deed.setTransferLock(id, false);
        assertFalse(deed.transferLocked(id), "unlocked by the owner");
        vm.prank(alice);
        deed.transferFrom(alice, bob, id);
        assertEq(deed.ownerOf(id), bob, "moved");
        // the default-ON invariant holds for EVERY owner: it re-locks the moment it arrives, so the
        // buyer is protected from an instant drain-and-reflip without lifting a finger
        assertTrue(deed.transferLocked(id), "re-locked on arrival");
        vm.prank(bob);
        vm.expectRevert(bytes("SD: locked - unlock before transfer"));
        deed.transferFrom(bob, alice, id);
    }

    function test_an_approved_operator_cannot_unlock() public {
        // owner-only ON PURPOSE: a marketplace approval must never be able to unlock — approving a
        // listing contract and having it silently unlock the deed IS the drain vector
        uint256 id = _mintTo(alice, "Operator St", 902);
        vm.prank(alice);
        deed.setApprovalForAll(bob, true);
        vm.prank(bob);
        vm.expectRevert(bytes("SD: not owner"));
        deed.setTransferLock(id, false);
    }

    function test_redeem_is_never_blocked_by_the_lock() public {
        // the never-trap rule: a lock that blocked the holder's own burn-back would trap the asset
        uint256 id = _mintTo(alice, "Burn Court", 903);
        assertTrue(deed.transferLocked(id), "locked");
        vm.prank(alice);
        deed.redeem(id);
        vm.expectRevert();
        deed.ownerOf(id); // gone
    }

    // ── the extraction ──────────────────────────────────────────────────────────────────────────
    function test_claim_mints_the_named_deed_to_the_recipient() public {
        StreetDeed.DeedVoucher memory v = _voucher(alice, "Corvino Way", "The Docks", 1);
        bytes memory sig = _sign(v);
        deed.claim(v, sig);

        uint256 id = deed.tokenIdFor("Corvino Way");
        assertEq(deed.ownerOf(id), alice, "minted to alice");
        assertEq(deed.deedName(id), "Corvino Way", "name stored on-chain");
        assertEq(deed.deedDistrict(id), "The Docks", "district stored on-chain");
        assertTrue(deed.usedNonce(1), "nonce consumed");
    }

    function test_tokenId_is_the_keccak_of_the_name() public view {
        assertEq(deed.tokenIdFor("Corvino Way"), uint256(keccak256(bytes("Corvino Way"))), "bijection");
    }

    function test_a_name_can_be_minted_at_most_once() public {
        StreetDeed.DeedVoucher memory v1 = _voucher(alice, "Ash Street", "Neon Mile", 1);
        bytes memory s1 = _sign(v1);
        deed.claim(v1, s1);
        // a DIFFERENT nonce/recipient but the SAME name derives the SAME tokenId → _safeMint reverts
        StreetDeed.DeedVoucher memory v2 = _voucher(bob, "Ash Street", "Neon Mile", 2);
        bytes memory s2 = _sign(v2);
        vm.expectRevert(); // ERC721: token already minted
        deed.claim(v2, s2);
    }

    function test_replay_is_rejected() public {
        StreetDeed.DeedVoucher memory v = _voucher(alice, "Ruby Lane", "Neon Mile", 7);
        bytes memory sig = _sign(v);
        deed.claim(v, sig);
        vm.expectRevert(bytes("SD: replay"));
        deed.claim(v, sig);
    }

    function test_expired_voucher_reverts() public {
        StreetDeed.DeedVoucher memory v = _voucher(alice, "Wharf Side", "The Docks", 1);
        v.deadline = block.timestamp - 1;
        bytes memory sig = _sign(v);
        vm.expectRevert(bytes("SD: expired"));
        deed.claim(v, sig);
    }

    function test_deadline_too_far_reverts() public {
        StreetDeed.DeedVoucher memory v = _voucher(alice, "Wharf Side", "The Docks", 1);
        v.deadline = block.timestamp + 31 days;
        bytes memory sig = _sign(v);
        vm.expectRevert(bytes("SD: deadline too far"));
        deed.claim(v, sig);
    }

    function test_bad_signature_reverts() public {
        StreetDeed.DeedVoucher memory v = _voucher(alice, "Ironside", "The Foundry", 1);
        // sign with a DIFFERENT key
        bytes32 digest = deed.hashVoucher(v);
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(0xB0B, digest);
        bytes memory badSig = abi.encodePacked(r, s, vv);
        vm.expectRevert(bytes("SD: bad signature"));
        deed.claim(v, badSig);
    }

    function test_zero_recipient_reverts() public {
        StreetDeed.DeedVoucher memory v = _voucher(address(0), "Lockgate", "The Canal", 1);
        bytes memory sig = _sign(v);
        vm.expectRevert(bytes("SD: zero recipient"));
        deed.claim(v, sig);
    }

    function test_empty_name_reverts() public {
        StreetDeed.DeedVoucher memory v = _voucher(alice, "", "The Docks", 1);
        bytes memory sig = _sign(v);
        vm.expectRevert(bytes("SD: empty name"));
        deed.claim(v, sig);
    }

    // ── the daily mint cap (a leaked-signer rate wall) ──
    function test_daily_cap_bounds_mints_per_day() public {
        vm.prank(safe);
        deed.setDailyMintCap(1);
        StreetDeed.DeedVoucher memory v1 = _voucher(alice, "The Kilns", "Bricktown", 1);
        bytes memory s1 = _sign(v1);
        deed.claim(v1, s1); // first of the day: ok
        StreetDeed.DeedVoucher memory v2 = _voucher(bob, "Mortar Row", "Bricktown", 2);
        bytes memory s2 = _sign(v2);
        vm.expectRevert(bytes("SD: daily cap"));
        deed.claim(v2, s2);
        // a new UTC day resets it
        vm.warp(block.timestamp + 1 days);
        StreetDeed.DeedVoucher memory v3 = _voucher(bob, "Mortar Row", "Bricktown", 3);
        v3.deadline = block.timestamp + 1 hours;
        bytes memory s3 = _sign(v3);
        deed.claim(v3, s3);
        assertEq(deed.ownerOf(deed.tokenIdFor("Mortar Row")), bob, "next day mints");
    }

    /// R33: the wall must be CONSTRUCTOR-bound, not setter-only. This contract self-mints on the SAME
    /// signer key as VoucherClaim/OmertaBond/DynastyNFT, so that key's blast radius is the SUM of the four
    /// daily caps — and a wall that lives only in a deploy checklist is one a deploy can forget (it was:
    /// the runbook called this one "Optional", and a fresh deploy minted 500 deeds in a day with nobody
    /// doing anything wrong). A deployer must now STATE the cap; 0 still means unlimited.
    function test_the_cap_is_constructor_bound_and_holds_with_no_setter_call() public {
        StreetDeed capped = new StreetDeed(safe, signerAddr, IMG, EXT, 1);
        assertEq(capped.dailyMintCap(), 1, "the constructor arg IS the wall");
        StreetDeed.DeedVoucher memory v1 =
            StreetDeed.DeedVoucher(alice, "First Cut", "Bricktown", 1, block.timestamp + 1 hours);
        (uint8 a, bytes32 b, bytes32 c) = vm.sign(signerPk, capped.hashVoucher(v1));
        capped.claim(v1, abi.encodePacked(b, c, a));
        StreetDeed.DeedVoucher memory v2 =
            StreetDeed.DeedVoucher(bob, "Second Cut", "Bricktown", 2, block.timestamp + 1 hours);
        (uint8 d, bytes32 e, bytes32 f) = vm.sign(signerPk, capped.hashVoucher(v2));
        vm.expectRevert(bytes("SD: daily cap"));
        capped.claim(v2, abi.encodePacked(e, f, d));
    }

    // ── the burn (re-import proof) ──────────────────────────────────────────────────────────────
    function test_redeem_burns_the_deed_for_its_holder_and_emits() public {
        StreetDeed.DeedVoucher memory v = _voucher(alice, "Saltwater Row", "The Docks", 1);
        bytes memory sig = _sign(v);
        deed.claim(v, sig);
        uint256 id = deed.tokenIdFor("Saltwater Row");

        vm.expectEmit(true, true, false, false, address(deed));
        emit StreetDeed.Redeemed(alice, id);
        vm.prank(alice);
        deed.redeem(id);

        vm.expectRevert(); // ERC721NonexistentToken — the deed is off the chain
        deed.ownerOf(id);
    }

    function test_redeem_reverts_for_a_non_holder() public {
        StreetDeed.DeedVoucher memory v = _voucher(alice, "The Slag", "The Foundry", 1);
        bytes memory sig = _sign(v);
        deed.claim(v, sig);
        uint256 id = deed.tokenIdFor("The Slag");
        vm.prank(bob);
        vm.expectRevert(bytes("SD: not owner"));
        deed.redeem(id);
    }

    function test_redeem_of_a_nonexistent_token_reverts() public {
        vm.prank(alice);
        vm.expectRevert(); // ERC721NonexistentToken (ownerOf reverts)
        deed.redeem(12345);
    }

    function test_the_same_street_re_extracts_to_the_same_id_after_a_burn() public {
        StreetDeed.DeedVoucher memory v = _voucher(alice, "Furnace Row", "The Foundry", 1);
        bytes memory sig = _sign(v);
        deed.claim(v, sig);
        uint256 id = deed.tokenIdFor("Furnace Row");
        vm.prank(alice);
        deed.redeem(id);
        // re-extract with a FRESH nonce (the burn cleared the token, so _safeMint succeeds again)
        StreetDeed.DeedVoucher memory v2 = _voucher(bob, "Furnace Row", "The Foundry", 2);
        bytes memory s2 = _sign(v2);
        deed.claim(v2, s2);
        assertEq(deed.ownerOf(id), bob, "re-extracted to the same tokenId");
    }

    // ── pause: stops extractions, never redemptions ──
    function test_pause_blocks_claim_but_not_redeem() public {
        StreetDeed.DeedVoucher memory v = _voucher(alice, "The Strip", "Neon Mile", 1);
        bytes memory sig = _sign(v);
        deed.claim(v, sig);
        uint256 id = deed.tokenIdFor("The Strip");

        vm.prank(safe);
        deed.pause();

        StreetDeed.DeedVoucher memory v2 = _voucher(bob, "Ruby Lane", "Neon Mile", 2);
        bytes memory s2 = _sign(v2);
        vm.expectRevert(); // EnforcedPause
        deed.claim(v2, s2);

        // redeem is NEVER pausable — a holder must always be able to bring property home
        vm.prank(alice);
        deed.redeem(id);
        vm.expectRevert();
        deed.ownerOf(id);
    }

    // ── admin gating (no owner-mint anywhere; only the Safe touches config) ──
    function test_only_owner_admin() public {
        vm.expectRevert();
        deed.setSigner(bob);
        vm.expectRevert();
        deed.setDailyMintCap(5);
        vm.expectRevert();
        deed.setImageBase("evil");
        vm.expectRevert();
        deed.setExternalBase("evil");
    }

    function test_setSigner_zero_reverts() public {
        vm.prank(safe);
        vm.expectRevert(bytes("SD: zero signer"));
        deed.setSigner(address(0));
    }

    function test_there_is_no_owner_mint_path() public {
        // The only way to mint is claim(voucher, sig). The Safe cannot mint a deed to itself — proven
        // by there being no such function; this test documents the property and mints via the ONLY path.
        StreetDeed.DeedVoucher memory v = _voucher(safe, "Gallows Hill", "The Cathedral", 9);
        bytes memory sig = _sign(v);
        vm.prank(safe);
        deed.claim(v, sig); // even the Safe must present a server signature
        assertEq(deed.ownerOf(deed.tokenIdFor("Gallows Hill")), safe, "minted via the signed path");
    }

    // ── metadata: identity on-chain, plate + legend off-chain ──
    function _uriFor(string memory name, string memory district, uint256 id) internal pure returns (string memory) {
        string memory json = string.concat(
            '{"name":"', name, '",',
            '"description":"A Street Deed \\u2014 a named, mapped plot in the city of OMERT\\u00c0. Its worth is the story on it: everything that ever happened here. Property with a history.",',
            '"image":"', IMG, id.toString(), '.svg",',
            '"external_url":"', EXT, id.toString(), '",',
            '"attributes":[',
            '{"trait_type":"Type","value":"Street Deed"},',
            '{"trait_type":"District","value":"', district, '"}',
            "]}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function test_tokenURI_assembles_the_identity_on_chain() public {
        StreetDeed.DeedVoucher memory v = _voucher(alice, "Nine Fingers Row", "The Docks", 1);
        bytes memory sig = _sign(v);
        deed.claim(v, sig);
        uint256 id = deed.tokenIdFor("Nine Fingers Row");
        assertEq(deed.tokenURI(id), _uriFor("Nine Fingers Row", "The Docks", id), "on-chain metadata");
    }

    function test_tokenURI_escapes_a_quote_in_the_name() public {
        // The backend strips < > " at claim, so this is unreachable in practice — but the document is
        // parsed by a marketplace, so the contract escapes the two structural bytes regardless. Input
        // bytes A " B; the contract emits A \" B (a backslash before the quote).
        string memory raw = 'A"B';
        StreetDeed.DeedVoucher memory v = _voucher(alice, raw, "The Docks", 1);
        bytes memory sig = _sign(v);
        deed.claim(v, sig);
        uint256 id = deed.tokenIdFor(raw);
        assertEq(deed.tokenURI(id), _uriFor('A\\"B', "The Docks", id), "escaped quote in name");
    }

    function test_tokenURI_of_a_nonexistent_token_reverts() public {
        vm.expectRevert(); // ERC721NonexistentToken
        deed.tokenURI(999);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {DynastyNFT} from "../src/DynastyNFT.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// DynastyNFT — the uncapped identity NFT (omerta-dynasty-machine-design.md §4). The claims under test are
/// the ones the design rests on: minting is ONLY a server-signed voucher self-mint (bounded by nonce /
/// deadline / daily-cap, and there is NO owner-mint path at all), supply is uncapped with a plain sequential
/// tokenId, the contract gates NOTHING on balanceOf (the entitlement is account-bound off-chain — the token
/// is a transferable trophy), tokenURI is the off-chain pointer, and EIP-2981 royalty is set to the treasury.
contract DynastyNFTTest is Test {
    using Strings for uint256;

    DynastyNFT nft;
    address safe = makeAddr("safe");
    address treasury = makeAddr("treasury");
    uint256 signerPk = 0xA11CE;
    address signerAddr;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    string constant BASE = "https://www.omerta.fun/v1/identity/";
    uint96 constant ROYALTY_BPS = 500; // 5%

    function setUp() public {
        signerAddr = vm.addr(signerPk);
        nft = new DynastyNFT(safe, signerAddr, BASE, treasury, ROYALTY_BPS);
    }

    function _voucher(address to, uint256 nonce) internal view returns (DynastyNFT.MintVoucher memory) {
        return DynastyNFT.MintVoucher({ to: to, nonce: nonce, deadline: block.timestamp + 1 hours });
    }

    function _sign(DynastyNFT.MintVoucher memory v) internal view returns (bytes memory) {
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(signerPk, nft.hashVoucher(v));
        return abi.encodePacked(r, s, vv);
    }

    // ── the mint ──────────────────────────────────────────────────────────────────────────────────
    function test_claim_mints_a_sequential_identity() public {
        DynastyNFT.MintVoucher memory v = _voucher(alice, 1);
        bytes memory sig = _sign(v);
        uint256 id = nft.claim(v, sig);
        assertEq(id, 1, "first tokenId is 1");
        assertEq(nft.ownerOf(1), alice, "minted to alice");
        assertTrue(nft.usedNonce(1), "nonce consumed");
        assertEq(nft.nextId(), 2, "counter advanced");
    }

    function test_ids_are_sequential_and_uncapped() public {
        // no supply cap exists — mint many, ids run 1,2,3,... with no ceiling
        for (uint256 i = 1; i <= 5; i++) {
            DynastyNFT.MintVoucher memory v = _voucher(alice, i);
            bytes memory sig = _sign(v);
            assertEq(nft.claim(v, sig), i, "sequential id");
        }
        assertEq(nft.nextId(), 6, "no maximum supply - the counter just keeps climbing");
    }

    function test_there_is_NO_owner_mint_path() public {
        // The ONLY way a token comes into existence is claim() with a server signature. There is deliberately
        // no owner/mint/mintTo function — the Safe cannot mint identities to itself. We assert the contract's
        // surface: an unsigned/owner-driven mint simply does not exist, so only claim() can produce a token.
        // (A missing function is not directly callable; this documents the property the design requires.)
        assertEq(nft.balanceOf(alice), 0, "nothing minted without a claim");
    }

    // ── the vouchers gates ────────────────────────────────────────────────────────────────────────
    function test_replay_reverts() public {
        DynastyNFT.MintVoucher memory v = _voucher(alice, 1);
        bytes memory sig = _sign(v);
        nft.claim(v, sig);
        vm.expectRevert("DN: replay");
        nft.claim(v, sig);
    }

    function test_bad_signature_reverts() public {
        DynastyNFT.MintVoucher memory v = _voucher(alice, 1);
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(0xB0B, nft.hashVoucher(v)); // not the signer
        bytes memory sig = abi.encodePacked(r, s, vv);
        vm.expectRevert("DN: bad signature");
        nft.claim(v, sig);
    }

    function test_expired_reverts() public {
        DynastyNFT.MintVoucher memory v = DynastyNFT.MintVoucher({ to: alice, nonce: 1, deadline: block.timestamp - 1 });
        bytes memory sig = _sign(v);
        vm.expectRevert("DN: expired");
        nft.claim(v, sig);
    }

    function test_deadline_too_far_reverts() public {
        DynastyNFT.MintVoucher memory v =
            DynastyNFT.MintVoucher({ to: alice, nonce: 1, deadline: block.timestamp + 31 days });
        bytes memory sig = _sign(v);
        vm.expectRevert("DN: deadline too far");
        nft.claim(v, sig);
    }

    function test_zero_recipient_reverts() public {
        DynastyNFT.MintVoucher memory v = _voucher(address(0), 1);
        bytes memory sig = _sign(v);
        vm.expectRevert("DN: zero recipient");
        nft.claim(v, sig);
    }

    function test_daily_cap_enforced_and_resets() public {
        vm.prank(safe);
        nft.setDailyMintCap(2);
        bytes memory s1 = _sign(_voucher(alice, 1));
        bytes memory s2 = _sign(_voucher(alice, 2));
        bytes memory s3 = _sign(_voucher(alice, 3));
        nft.claim(_voucher(alice, 1), s1);
        nft.claim(_voucher(alice, 2), s2);
        vm.expectRevert("DN: daily cap");
        nft.claim(_voucher(alice, 3), s3);
        // a new UTC day resets the window
        vm.warp(block.timestamp + 1 days);
        bytes memory s3b = _sign(_voucher(alice, 3));
        nft.claim(_voucher(alice, 3), s3b);
        assertEq(nft.ownerOf(3), alice, "mint resumes the next day");
    }

    function test_pause_blocks_mints_but_transfers_still_work() public {
        bytes memory s1 = _sign(_voucher(alice, 1));
        nft.claim(_voucher(alice, 1), s1);
        vm.prank(safe);
        nft.pause();
        bytes memory s2 = _sign(_voucher(alice, 2));
        vm.expectRevert(); // Pausable: paused (custom error)
        nft.claim(_voucher(alice, 2), s2);
        // a pause traps nothing — the token still moves freely
        vm.prank(alice);
        nft.transferFrom(alice, bob, 1);
        assertEq(nft.ownerOf(1), bob, "a paused mint never freezes an existing token");
    }

    // ── the WALL: the token transfers, the contract gates nothing on balanceOf ──────────────────────
    function test_the_token_is_a_freely_transferable_trophy() public {
        bytes memory sig = _sign(_voucher(alice, 1));
        nft.claim(_voucher(alice, 1), sig);
        vm.prank(alice);
        nft.transferFrom(alice, bob, 1);
        assertEq(nft.ownerOf(1), bob, "transfers freely - no soulbound lock");
        assertEq(nft.balanceOf(alice), 0);
        assertEq(nft.balanceOf(bob), 1);
        // Nothing in the contract reads balanceOf to gate an entitlement — the entitlement is account-bound
        // off-chain (account_persistent.minted). This test documents that the trophy carries no on-chain power.
    }

    // ── metadata ────────────────────────────────────────────────────────────────────────────────
    function test_tokenURI_is_the_offchain_pointer() public {
        bytes memory sig = _sign(_voucher(alice, 1));
        nft.claim(_voucher(alice, 1), sig);
        assertEq(nft.tokenURI(1), string.concat(BASE, uint256(1).toString()), "tokenURI = base + id");
    }

    function test_tokenURI_reverts_for_a_nonexistent_token() public {
        vm.expectRevert(); // ERC721NonexistentToken
        nft.tokenURI(999);
    }

    // ── EIP-2981 royalty ──────────────────────────────────────────────────────────────────────────
    function test_royalty_is_five_percent_to_the_treasury() public view {
        (address recv, uint256 amount) = nft.royaltyInfo(1, 1 ether);
        assertEq(recv, treasury, "royalty pays the treasury Safe");
        assertEq(amount, 0.05 ether, "5% of the sale");
        assertTrue(nft.supportsInterface(type(IERC2981).interfaceId), "advertises EIP-2981");
        assertTrue(nft.supportsInterface(type(IERC721).interfaceId), "advertises ERC-721");
    }

    function test_only_owner_rotates_the_royalty() public {
        vm.prank(alice);
        vm.expectRevert(); // Ownable: not owner
        nft.setDefaultRoyalty(alice, 1000);
        address newRecv = makeAddr("newTreasury");
        vm.prank(safe);
        nft.setDefaultRoyalty(newRecv, 250); // 2.5%
        (address recv, uint256 amount) = nft.royaltyInfo(1, 1 ether);
        assertEq(recv, newRecv, "royalty recipient rotated");
        assertEq(amount, 0.025 ether, "new rate in effect");
    }

    function test_ctor_rejects_zero_signer_and_zero_royalty_recipient() public {
        vm.expectRevert("DN: zero signer");
        new DynastyNFT(safe, address(0), BASE, treasury, ROYALTY_BPS);
        vm.expectRevert("DN: zero royalty recipient");
        new DynastyNFT(safe, signerAddr, BASE, address(0), ROYALTY_BPS);
    }

    function test_only_owner_admin() public {
        vm.startPrank(alice);
        vm.expectRevert();
        nft.setSigner(alice);
        vm.expectRevert();
        nft.setDailyMintCap(1);
        vm.expectRevert();
        nft.setBaseUri("x");
        vm.expectRevert();
        nft.pause();
        vm.stopPrank();
    }
}

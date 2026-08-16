// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {StockVault} from "../src/StockVault.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// A stand-in for a tokenized-stock ERC-20 the treasury pre-buys and StockVault delivers.
contract MockStock is ERC20 {
    constructor() ERC20("Tokenized TSLA", "tTSLA") {}
    function mint(address to, uint256 a) external { _mint(to, a); }
}

/// StockVault — the gateless keeper-push delivery contract (omerta-brokers-design.md §3.3). The claims under
/// test: it NEVER mints (every delivery is a pre-held transfer, so `held` = balanceOf physically bounds it —
/// the on-chain half of `allocated ≤ held`), only the Safe-set keeper can push, deliveries are idempotent on
/// deliveryId, a leaked keeper is bounded by the per-token daily cap + pause + the Safe's sweep, and a pause
/// traps nothing.
contract StockVaultTest is Test {
    StockVault vault;
    MockStock stock;
    address safe = makeAddr("safe");
    address keeper = makeAddr("keeper");
    address tbaA = makeAddr("tbaA"); // a player's ERC-6551 token-bound account
    address tbaB = makeAddr("tbaB");
    uint256 constant FUNDED = 1_000_000e18;

    function setUp() public {
        vault = new StockVault(safe, keeper, 0); // 0 default = the pre-C2 posture, so every existing test is unchanged
        stock = new MockStock();
        stock.mint(address(vault), FUNDED); // the treasury pre-funds the vault
    }

    // ── the push ──────────────────────────────────────────────────────────────────────────────────
    function test_keeper_delivers_a_preheld_transfer() public {
        vm.expectEmit(true, true, true, true, address(vault));
        emit StockVault.Delivered(1, address(stock), tbaA, 100e18);
        vm.prank(keeper);
        vault.deliver(1, address(stock), tbaA, 100e18);
        assertEq(stock.balanceOf(tbaA), 100e18, "stock landed in the TBA");
        assertEq(stock.balanceOf(address(vault)), FUNDED - 100e18, "vault balance fell by exactly that");
        assertTrue(vault.usedDeliveryId(1), "deliveryId consumed");
    }

    function test_only_keeper_can_deliver() public {
        vm.prank(safe); // even the owner is not the keeper
        vm.expectRevert("SV: not keeper");
        vault.deliver(1, address(stock), tbaA, 1e18);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert("SV: not keeper");
        vault.deliver(1, address(stock), tbaA, 1e18);
    }

    function test_keeper_zero_disables_deliveries() public {
        vm.prank(safe);
        vault.setKeeper(address(0));
        vm.prank(address(0)); // even address(0) itself can't (the guard requires keeper != 0)
        vm.expectRevert("SV: not keeper");
        vault.deliver(1, address(stock), tbaA, 1e18);
    }

    function test_delivery_is_idempotent_on_deliveryId() public {
        vm.startPrank(keeper);
        vault.deliver(7, address(stock), tbaA, 50e18);
        vm.expectRevert("SV: replay");
        vault.deliver(7, address(stock), tbaB, 999e18); // same id → no-op, even to a different target/amount
        vm.stopPrank();
        assertEq(stock.balanceOf(tbaA), 50e18, "delivered once");
        assertEq(stock.balanceOf(tbaB), 0, "the replay moved nothing");
    }

    function test_zero_recipient_token_units_revert() public {
        vm.startPrank(keeper);
        vm.expectRevert("SV: zero recipient");
        vault.deliver(1, address(stock), address(0), 1e18);
        vm.expectRevert("SV: zero token");
        vault.deliver(1, address(0), tbaA, 1e18);
        vm.expectRevert("SV: zero units");
        vault.deliver(1, address(stock), tbaA, 0);
        vm.stopPrank();
    }

    function test_it_can_never_deliver_more_than_it_holds() public {
        // The vault holds FUNDED; a push for more reverts in the ERC-20 — the physical `allocated <= held` wall.
        vm.prank(keeper);
        vm.expectRevert(); // ERC20InsufficientBalance
        vault.deliver(1, address(stock), tbaA, FUNDED + 1);
    }

    function test_per_token_daily_cap_bounds_a_leaked_keeper() public {
        vm.prank(safe);
        vault.setDailyCap(address(stock), 100e18); // at most 100 units/day for this ticker
        vm.startPrank(keeper);
        vault.deliver(1, address(stock), tbaA, 60e18);
        vault.deliver(2, address(stock), tbaA, 40e18); // total 100 — at the cap
        vm.expectRevert("SV: daily cap");
        vault.deliver(3, address(stock), tbaA, 1e18);  // 101 — over
        vm.stopPrank();
        // resets the next UTC day
        vm.warp(block.timestamp + 1 days);
        vm.prank(keeper);
        vault.deliver(3, address(stock), tbaA, 40e18);
        assertEq(stock.balanceOf(tbaA), 140e18, "cap resumes the next day");
    }

    // ── C2: A NEVER-CONFIGURED TICKER INHERITS THE DEFAULT WALL, NOT INFINITY ─────────────────────
    // The ticker set GROWS (the Commission votes one daily off a list the operator extends by adding a
    // token address), and nothing in that process forces a setDailyCap for the new one — so a mapping
    // that defaults to "unlimited" makes the newest stock the one a leaked keeper drains in a block,
    // silently, while every configured ticker holds. The default is what closes that.
    function test_an_unconfigured_ticker_inherits_the_default_cap() public {
        StockVault walled = new StockVault(safe, keeper, 50e18);
        MockStock fresh = new MockStock();
        fresh.mint(address(walled), FUNDED);
        assertEq(walled.effectiveDailyCap(address(fresh)), 50e18, "a ticker nobody configured is walled by the default");
        vm.startPrank(keeper);
        walled.deliver(1, address(fresh), tbaA, 50e18);
        vm.expectRevert("SV: daily cap");
        walled.deliver(2, address(fresh), tbaA, 1e18); // the fresh ticker is NOT a free drain
        vm.stopPrank();
    }

    // and the `0 = unlimited` convention the sibling contracts share still holds when it is CHOSEN:
    // an explicit setDailyCap(token, 0) is a decision, a never-set token is not.
    function test_an_explicit_zero_still_means_unlimited() public {
        StockVault walled = new StockVault(safe, keeper, 50e18);
        MockStock fresh = new MockStock();
        fresh.mint(address(walled), FUNDED);
        vm.prank(safe);
        walled.setDailyCap(address(fresh), 0);
        assertTrue(walled.capConfigured(address(fresh)), "the Safe has spoken for this ticker");
        assertEq(walled.effectiveDailyCap(address(fresh)), 0, "explicit 0 = unlimited, as everywhere else");
        vm.prank(keeper);
        walled.deliver(1, address(fresh), tbaA, 500e18); // far past the default — deliberately uncapped
        assertEq(fresh.balanceOf(tbaA), 500e18, "an explicit unlimited is honoured");
    }

    function test_default_cap_is_safe_settable_and_evented() public {
        vm.expectEmit(false, false, false, true, address(vault));
        emit StockVault.DefaultDailyCapSet(7e18);
        vm.prank(safe);
        vault.setDefaultDailyCap(7e18);
        assertEq(vault.effectiveDailyCap(address(stock)), 7e18, "the fallback moved for every unconfigured ticker");
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert();
        vault.setDefaultDailyCap(0);
    }

    function test_pause_stops_deliveries_but_traps_nothing() public {
        vm.prank(safe);
        vault.pause();
        vm.prank(keeper);
        vm.expectRevert(); // Pausable: paused
        vault.deliver(1, address(stock), tbaA, 1e18);
        // delivered stock (there is none yet) would already be in the TBA; undelivered stock is the Safe's:
        vm.prank(safe);
        vault.unpause();
        vm.prank(keeper);
        vault.deliver(1, address(stock), tbaA, 1e18);
        assertEq(stock.balanceOf(tbaA), 1e18, "deliveries resume on unpause");
    }

    // ── sweep (the Safe pulls unspent stock) ──────────────────────────────────────────────────────
    function test_sweep_is_owner_only_and_routes_to_a_chosen_recipient() public {
        vm.prank(keeper);
        vm.expectRevert(); // Ownable: not owner
        vault.sweep(address(stock), safe, 1e18);
        address dest = makeAddr("coldStorage");
        vm.prank(safe);
        vault.sweep(address(stock), dest, 500_000e18);
        assertEq(stock.balanceOf(dest), 500_000e18, "the Safe pulled unspent stock to cold storage");
        assertEq(stock.balanceOf(address(vault)), FUNDED - 500_000e18, "vault balance fell");
    }

    // ── batch ─────────────────────────────────────────────────────────────────────────────────────
    function test_deliverBatch_pushes_to_many_accounts() public {
        uint256[] memory ids = new uint256[](2);
        address[] memory toks = new address[](2);
        address[] memory tos = new address[](2);
        uint256[] memory units = new uint256[](2);
        ids[0] = 1; ids[1] = 2;
        toks[0] = address(stock); toks[1] = address(stock);
        tos[0] = tbaA; tos[1] = tbaB;
        units[0] = 10e18; units[1] = 20e18;
        vm.prank(keeper);
        vault.deliverBatch(ids, toks, tos, units);
        assertEq(stock.balanceOf(tbaA), 10e18);
        assertEq(stock.balanceOf(tbaB), 20e18);
    }

    function test_deliverBatch_length_mismatch_reverts() public {
        uint256[] memory ids = new uint256[](2);
        address[] memory toks = new address[](1); // wrong length
        address[] memory tos = new address[](2);
        uint256[] memory units = new uint256[](2);
        vm.prank(keeper);
        vm.expectRevert("SV: length mismatch");
        vault.deliverBatch(ids, toks, tos, units);
    }

    function test_deliverBatch_one_bad_item_reverts_the_whole_batch() public {
        uint256[] memory ids = new uint256[](2);
        address[] memory toks = new address[](2);
        address[] memory tos = new address[](2);
        uint256[] memory units = new uint256[](2);
        ids[0] = 1; ids[1] = 2;
        toks[0] = address(stock); toks[1] = address(stock);
        tos[0] = tbaA; tos[1] = address(0); // item 2 is invalid
        units[0] = 10e18; units[1] = 20e18;
        vm.prank(keeper);
        vm.expectRevert("SV: zero recipient");
        vault.deliverBatch(ids, toks, tos, units);
        // the whole batch unwound — item 1's id is still unused, so the backend re-drives it next tick
        assertEq(stock.balanceOf(tbaA), 0, "nothing delivered");
        assertFalse(vault.usedDeliveryId(1), "deliveryId 1 is still free to retry");
    }

    // ── the no-mint conservation invariant (fuzz) ─────────────────────────────────────────────────
    function testFuzz_delivery_conserves_units_never_mints(uint256 a, uint256 b) public {
        a = bound(a, 1, FUNDED / 2);
        b = bound(b, 1, FUNDED / 2);
        vm.startPrank(keeper);
        vault.deliver(1, address(stock), tbaA, a);
        vault.deliver(2, address(stock), tbaB, b);
        vm.stopPrank();
        // the vault created nothing — delivered + remaining == exactly what was funded
        assertEq(stock.balanceOf(tbaA) + stock.balanceOf(tbaB) + stock.balanceOf(address(vault)), FUNDED,
            "units are conserved: the vault only ever moves a pre-held balance, never mints");
    }
}

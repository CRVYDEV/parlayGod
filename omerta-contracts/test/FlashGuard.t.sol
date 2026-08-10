// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {FlashGuard} from "../src/FlashGuard.sol";

/// A minimal concrete subclass. FlashGuard is abstract, and an abstract contract with no test file
/// is exactly the shape that reads as verified while being untested — this file exists because the
/// PR that introduced FlashGuard shipped with a green `forge` run whose test COUNT was unchanged.
contract Harness is FlashGuard {
    Flow private _flow;
    uint256 public perBlockCap;
    uint256 public perDayCap;

    function enter() external { _recordEntry(msg.sender); }
    function exit_() external notSameBlockAsEntry(msg.sender) {}
    function gated() external onlyAllowedCaller {}
    function allow(address who, bool ok) external { _allowedContract[who] = ok; }

    function setCaps(uint256 b, uint256 d) external { perBlockCap = b; perDayCap = d; }
    function flow(uint256 amount) external { _meter(_flow, amount, perBlockCap, perDayCap); }
    function inBlock() external view returns (uint256) { return _flow.inBlock; }
    function inDay() external view returns (uint256) { return _flow.inDay; }
}

/// Calls the harness from a CONTRACT, to exercise the allowlist's contract branch.
contract Caller {
    Harness immutable h;
    constructor(Harness h_) { h = h_; }
    function callGated() external { h.gated(); }
    /// The atomic round trip the whole guard exists to forbid: enter and exit in one transaction.
    function roundTrip() external { h.enter(); h.exit_(); }
}

contract FlashGuardTest is Test {
    Harness h;
    address alice = address(0xA11CE);

    function setUp() public {
        h = new Harness();
        vm.roll(100);
    }

    // ── L1: SAME-BLOCK SEPARATION ────────────────────────────────────────────────────────────────

    function test_exit_in_the_same_block_as_entry_reverts() public {
        vm.startPrank(alice);
        h.enter();
        vm.expectRevert(FlashGuard.SameBlockAsEntry.selector);
        h.exit_();
        vm.stopPrank();
    }

    function test_exit_in_a_later_block_is_allowed() public {
        vm.prank(alice);
        h.enter();
        vm.roll(block.number + 1);
        vm.prank(alice);
        h.exit_(); // must not revert
    }

    /// THE PROPERTY THE GUARD IS FOR. A flash loan must be repaid in the transaction that took it,
    /// so forcing the profitable half into a later block means the loan cannot still exist. A
    /// single contract call doing both halves is precisely the attack shape.
    function test_the_atomic_round_trip_is_impossible() public {
        Caller c = new Caller(h);
        h.allow(address(c), true);
        vm.expectRevert(FlashGuard.SameBlockAsEntry.selector);
        c.roundTrip();
    }

    /// The guard is PER ACCOUNT — one user's entry must not freeze another's exit, or a griefer
    /// could stall the protocol for everyone by entering every block.
    function test_the_guard_is_per_account_not_global() public {
        vm.prank(alice);
        h.enter();
        vm.prank(address(0xB0B));
        h.exit_(); // bob never entered; his exit is unaffected in the same block
    }

    function test_an_account_that_never_entered_may_exit() public {
        assertEq(h.lastEntryBlock(alice), 0, "never entered");
        vm.prank(alice);
        h.exit_();
    }

    // ── L2: THE ALLOWLIST ────────────────────────────────────────────────────────────────────────

    /// EOAs always pass. This is the deliberate rejection of `require(msg.sender == tx.origin)`,
    /// which would break ERC-4337, Safe, and every smart-contract wallet — and on a chain whose
    /// self-custody story is embedded wallets, that would lock out exactly our users.
    function test_an_EOA_is_always_allowed() public {
        vm.prank(alice);
        h.gated();
    }

    function test_an_unlisted_contract_is_refused() public {
        Caller c = new Caller(h);
        vm.expectRevert(FlashGuard.CallerNotAllowed.selector);
        c.callGated();
    }

    function test_an_allowlisted_contract_passes() public {
        Caller c = new Caller(h);
        h.allow(address(c), true);
        c.callGated();
    }

    // ── L5: FLOW CAPS ────────────────────────────────────────────────────────────────────────────

    function test_per_block_cap_bounds_a_single_block() public {
        h.setCaps(100, 0);
        h.flow(60);
        h.flow(40); // exactly at the cap is allowed
        assertEq(h.inBlock(), 100);
        vm.expectRevert(FlashGuard.PerBlockCapExceeded.selector);
        h.flow(1);
    }

    /// A flash loan is BY DEFINITION confined to one block, so this is the tightest possible bound
    /// on any atomic exploit — and the reason it is worth having even behind L0 and L1.
    function test_the_block_counter_resets_next_block() public {
        h.setCaps(100, 0);
        h.flow(100);
        vm.roll(block.number + 1);
        h.flow(100); // a fresh block starts from zero
        assertEq(h.inBlock(), 100);
    }

    function test_per_day_cap_bounds_the_patient_version() public {
        h.setCaps(0, 150);
        h.flow(100);
        vm.roll(block.number + 1);
        h.flow(50);
        vm.roll(block.number + 1);
        // spreading it across blocks does not escape the daily cap — which is the point: without
        // it, a per-block cap merely sets the attacker's pace.
        vm.expectRevert(FlashGuard.DailyCapExceeded.selector);
        h.flow(1);
    }

    function test_the_day_window_resets_after_24h() public {
        h.setCaps(0, 150);
        h.flow(150);
        vm.warp(block.timestamp + 1 days);
        h.flow(150); // must not revert
        assertEq(h.inDay(), 150);
    }

    /// Zero disables a cap, deliberately, so a market can deploy with metering off and be
    /// tightened later by the Safe without a redeploy. Asserted because "0 means unlimited" is the
    /// kind of default that silently ships a missing wall — OmertaBond's `dailyCapOMR` has the
    /// identical footgun and it is called out in that contract for the same reason.
    function test_zero_disables_a_cap() public {
        h.setCaps(0, 0);
        h.flow(type(uint128).max);
        h.flow(type(uint128).max); // no bound at all
    }

    function test_both_caps_apply_together() public {
        h.setCaps(100, 120);
        h.flow(100);
        vm.roll(block.number + 1);
        vm.expectRevert(FlashGuard.DailyCapExceeded.selector); // block is fresh, the day is not
        h.flow(100);
    }

    // ── fuzz: the counters must never under-report ───────────────────────────────────────────────

    /// The failure mode that matters is a metered flow the counter does not see — a wrap, a reset
    /// at the wrong moment, an off-by-one at the boundary — because that turns the last line of
    /// defense into a no-op while every test above still passes.
    function testFuzz_block_counter_equals_the_sum_metered(uint96 a, uint96 b, uint96 c) public {
        h.setCaps(0, 0); // caps off: we are testing the accounting, not the bound
        h.flow(a);
        h.flow(b);
        h.flow(c);
        assertEq(h.inBlock(), uint256(a) + uint256(b) + uint256(c), "block counter must be exact");
        assertEq(h.inDay(), uint256(a) + uint256(b) + uint256(c), "day counter must be exact");
    }

    /// Anything at or below the cap must pass; anything above must revert. No gap, no overlap.
    function testFuzz_the_cap_is_exactly_the_boundary(uint96 cap, uint96 amount) public {
        vm.assume(cap > 0);
        h.setCaps(cap, 0);
        if (amount <= cap) {
            h.flow(amount);
            assertEq(h.inBlock(), amount);
        } else {
            vm.expectRevert(FlashGuard.PerBlockCapExceeded.selector);
            h.flow(amount);
        }
    }
}

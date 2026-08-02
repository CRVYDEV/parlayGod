// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/types/PoolOperation.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {OMR} from "../src/OMR.sol";
import {OmertaHook, IOmrHookObserver} from "../src/OmertaHook.sol";

/// A quote token that is NOT on the hook's allow-list, for the pool gate.
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract Junk is ERC20 {
    constructor() ERC20("Junk", "JUNK") {
        _mint(msg.sender, 1_000_000e18);
    }
}

/// Refuses ETH. Stands in for a recipient that breaks — a multisig mid-upgrade, a contract with no
/// `receive`, an address that starts reverting after the fact.
contract Deadbeat {
    receive() external payable {
        revert("no");
    }
}

contract RevertingObserver is IOmrHookObserver {
    function observe(PoolKey calldata) external pure {
        revert("nope");
    }
}

contract GreedyObserver is IOmrHookObserver {
    uint256 public sink;

    function observe(PoolKey calldata) external {
        // Burn everything it is given. If the stipend were not bounded this would eat the swap.
        while (true) sink++;
    }
}

contract CountingObserver is IOmrHookObserver {
    uint256 public calls;

    function observe(PoolKey calldata) external {
        calls++;
    }
}

/// @title OmertaHook — the sell tax charged inside the swap.
///
/// @notice These run against the REAL `PoolManager` and the REAL v4 test routers: a real pool is
///         initialized, real liquidity is added, and real swaps move real balances. Nothing here is
///         mocked, so the fee arithmetic is measured against what a swapper actually received rather
///         than against a re-derivation of it.
///
///         What the suite is for, in the order the design (§11.2) asks for it:
///           - `MAX_SELL_TAX_BPS` survives as a compile-time cap
///           - the remainder rule leaves no dust (fuzzed through real swaps)
///           - BUYS ARE FREE
///           - `DISCOUNT_BPS < sellTaxBps` — the §9.6 operating rule, asserted here because the two
///             constants live in different contracts and nothing else relates them
///         plus the properties this contract adds on its own: the pool gate that makes its events
///         unforgeable, and pool liveness under a broken recipient or a broken observer.
contract OmertaHookTest is Test {
    // The flag set is restated here rather than read off the contract ON PURPOSE: this is the test's
    // independent statement of which permissions the hook is allowed to hold. Changing HOOK_FLAGS
    // then fails here instead of being silently followed.
    uint160 constant FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    int24 constant TICK_SPACING = 60;
    int24 constant MIN_TICK = -887220;
    int24 constant MAX_TICK = 887220;

    // The shipped rates (tokenomics v2 §4 / rules.tail.js SELL_TAX), 9% split 2/4/3.
    uint256 constant TAX_BPS = 900;
    uint256 constant DEV_BPS = 200;
    uint256 constant RWA_BPS = 400;

    address safe = address(0x5AFE);
    address dev = address(0xD3F);
    address rwa = address(0x67A);
    address lp = address(0x1BB);
    address trader = address(0x7EAD);

    PoolManager manager;
    OMR omr;
    OmertaHook hook;
    PoolSwapTest swapRouter;
    PoolModifyLiquidityTest lpRouter;
    PoolKey key;
    Currency eth = Currency.wrap(address(0));
    Currency omrC;

    function setUp() public {
        manager = new PoolManager(address(this));
        omr = new OMR(safe);
        omrC = Currency.wrap(address(omr));

        address hookAddr = address(uint160((uint256(0xBEEF) << 144) | uint256(FLAGS)));
        deployCodeTo("OmertaHook.sol:OmertaHook", abi.encode(manager, address(omr), safe), hookAddr);
        hook = OmertaHook(payable(hookAddr));

        vm.startPrank(safe);
        hook.setRecipients(dev, rwa, lp);
        hook.setAllowedQuote(eth, true);
        hook.setSellTax(TAX_BPS, DEV_BPS, RWA_BPS);
        omr.transfer(address(this), 10_000_000e18);
        omr.transfer(trader, 1_000_000e18);
        vm.stopPrank();

        swapRouter = new PoolSwapTest(manager);
        lpRouter = new PoolModifyLiquidityTest(manager);

        // Native ETH is address(0), so it always sorts first: currency0 = ETH, currency1 = OMR.
        key = PoolKey(eth, omrC, 3000, TICK_SPACING, IHooks(hookAddr));
        manager.initialize(key, SQRT_PRICE_1_1);

        vm.deal(address(this), 10_000 ether);
        vm.deal(trader, 1_000 ether);
        omr.approve(address(lpRouter), type(uint256).max);
        omr.approve(address(swapRouter), type(uint256).max);
        vm.prank(trader);
        omr.approve(address(swapRouter), type(uint256).max);

        lpRouter.modifyLiquidity{value: 5_000 ether}(
            key, ModifyLiquidityParams(MIN_TICK, MAX_TICK, 1_000e18, bytes32(0)), ""
        );
    }

    /// The v4 test routers refund unspent ETH to their caller.
    receive() external payable {}

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────

    function _swap(bool zeroForOne, int256 amountSpecified) internal returns (BalanceDelta) {
        uint256 value = zeroForOne && amountSpecified < 0 ? uint256(-amountSpecified) : 0;
        vm.prank(trader);
        return swapRouter.swap{value: zeroForOne ? (value == 0 ? 100 ether : value) : 0}(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? SQRT_PRICE_1_1 / 2 : SQRT_PRICE_1_1 * 2
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    /// A SELL is OMR in, ETH out — OMR is currency1 here, so `zeroForOne` is false.
    function _sellExactIn(uint256 omrIn) internal returns (BalanceDelta) {
        return _swap(false, -int256(omrIn));
    }

    function _sellExactOut(uint256 ethOut) internal returns (BalanceDelta) {
        return _swap(false, int256(ethOut));
    }

    function _buyExactIn(uint256 ethIn) internal returns (BalanceDelta) {
        return _swap(true, -int256(ethIn));
    }

    function _owed(Currency c) internal view returns (uint256 d, uint256 r, uint256 l) {
        (d, r, l) = hook.owed(c);
    }

    // ── the permission set lives in the address ──────────────────────────────────────────────────

    function test_the_hook_refuses_to_exist_at_an_address_that_does_not_carry_its_flags() public {
        // An ordinary `new` lands wherever CREATE puts it, which will not carry the mined bits. This
        // is why deployment needs a CREATE2 salt search rather than an assumption.
        vm.expectRevert(OmertaHook.HookAddressMismatch.selector);
        new OmertaHook(manager, address(omr), safe);
    }

    function test_the_deployed_address_carries_exactly_the_permissions_it_implements() public view {
        assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, FLAGS, "flag set drifted from the address");
        assertEq(hook.HOOK_FLAGS(), FLAGS, "HOOK_FLAGS drifted from what this suite permits");
    }

    // ── THE POOL GATE — what makes `SellTaxTaken` unforgeable ────────────────────────────────────

    function test_a_pool_without_omr_cannot_use_this_hook() public {
        Junk a = new Junk();
        Junk b = new Junk();
        (Currency c0, Currency c1) = address(a) < address(b)
            ? (Currency.wrap(address(a)), Currency.wrap(address(b)))
            : (Currency.wrap(address(b)), Currency.wrap(address(a)));
        PoolKey memory bad = PoolKey(c0, c1, 3000, TICK_SPACING, IHooks(address(hook)));
        vm.expectRevert();
        manager.initialize(bad, SQRT_PRICE_1_1);
    }

    function test_a_pool_against_an_unapproved_quote_cannot_use_this_hook() public {
        Junk j = new Junk();
        (Currency c0, Currency c1) = address(j) < address(omr)
            ? (Currency.wrap(address(j)), omrC)
            : (omrC, Currency.wrap(address(j)));
        PoolKey memory bad = PoolKey(c0, c1, 3000, TICK_SPACING, IHooks(address(hook)));

        // Nobody can stand up an (OMR, WORTHLESS) pool, swap against themselves and emit a real
        // `SellTaxTaken` with a real transaction hash — fabricated revenue wearing the credential
        // the backend's anti-fabrication gate trusts.
        vm.expectRevert();
        manager.initialize(bad, SQRT_PRICE_1_1);

        // ...until the Safe chooses to hold that asset.
        vm.prank(safe);
        hook.setAllowedQuote(Currency.wrap(address(j)), true);
        manager.initialize(bad, SQRT_PRICE_1_1);
    }

    // ── the fee ──────────────────────────────────────────────────────────────────────────────────

    function test_buys_are_free() public {
        uint256 before = omr.balanceOf(trader);
        _buyExactIn(1 ether);
        assertGt(omr.balanceOf(trader), before, "the buy did not go through");
        (uint256 d, uint256 r, uint256 l) = _owed(eth);
        assertEq(d + r + l, 0, "a buy was taxed");
        (d, r, l) = _owed(omrC);
        assertEq(d + r + l, 0, "a buy was taxed in OMR");
    }

    function test_an_exact_input_sell_pays_in_the_quote_currency() public {
        uint256 ethBefore = trader.balance;
        BalanceDelta delta = _sellExactIn(100e18);

        // `delta.amount0()` is what the SWAPPER got in ETH, already net of the hook's cut.
        uint256 received = uint256(int256(delta.amount0()));
        assertEq(trader.balance - ethBefore, received, "the trader did not receive the net delta");

        (uint256 d, uint256 r, uint256 l) = _owed(eth);
        uint256 total = d + r + l;
        assertGt(total, 0, "no fee was taken on a sell");

        // gross = what the pool paid out = the trader's share + ours. The rate applies to the gross.
        uint256 gross = received + total;
        assertEq(total, (gross * TAX_BPS) / 10000, "the fee is not 9% of the gross output");

        // THE FEE ARRIVES AS ETH — the whole point of the migration. Nothing accrued in OMR.
        (uint256 od, uint256 orr, uint256 ol) = _owed(omrC);
        assertEq(od + orr + ol, 0, "an exact-input sell should never accrue OMR");

        assertEq(d, (total * DEV_BPS) / TAX_BPS, "dev slice");
        assertEq(r, (total * RWA_BPS) / TAX_BPS, "rwa slice");
        assertEq(l, total - d - r, "lp takes the remainder");
        assertEq(address(hook).balance, total, "the hook did not take what it charged");
    }

    function test_an_exact_output_sell_is_taxed_at_the_same_rate_in_omr() public {
        uint256 omrBefore = omr.balanceOf(trader);
        BalanceDelta delta = _sellExactOut(1 ether);

        // The swapper's OMR delta is negative — what they paid, already including the hook's cut.
        uint256 paid = uint256(int256(-delta.amount1()));
        assertEq(omrBefore - omr.balanceOf(trader), paid, "the trader did not pay the net delta");

        (uint256 d, uint256 r, uint256 l) = _owed(omrC);
        uint256 total = d + r + l;
        assertGt(total, 0, "an exact-output sell escaped the tax");
        // Charged on the input the pool actually consumed — which is `paid` less our own charge.
        assertEq(total, ((paid - total) * TAX_BPS) / 10000, "the exact-output rate does not match");

        // This path is at parity with the ERC-20 tax it replaces: taxed, in OMR. It is documented
        // rather than hidden, and it is emphatically not a bypass.
        (uint256 ed, uint256 er, uint256 el) = _owed(eth);
        assertEq(ed + er + el, 0, "an exact-output sell should not accrue the quote");
        assertEq(omr.balanceOf(address(hook)), total, "the hook did not take what it charged");
    }

    function test_the_remainder_rule_leaves_no_dust(uint96 amount) public {
        amount = uint96(bound(amount, 1e15, 500e18));
        _sellExactIn(amount);
        (uint256 d, uint256 r, uint256 l) = _owed(eth);
        uint256 total = d + r + l;
        // The property: whatever the bps division does, the three slices reconstruct the total
        // EXACTLY. Two of them round down; a "natural" third would strand a wei belonging to nobody.
        assertEq(d, (total * DEV_BPS) / TAX_BPS, "dev");
        assertEq(r, (total * RWA_BPS) / TAX_BPS, "rwa");
        assertEq(d + r + l, total, "the slices do not reconstruct the total");
        assertEq(address(hook).balance, total, "held != charged");
    }

    function test_the_fee_is_off_until_the_safe_arms_it() public {
        vm.prank(safe);
        hook.setSellTax(0, 0, 0);
        _sellExactIn(100e18);
        (uint256 d, uint256 r, uint256 l) = _owed(eth);
        assertEq(d + r + l, 0, "a disarmed hook still charged");
    }

    // ── the hard cap, mirrored from OMR.sol ──────────────────────────────────────────────────────

    function test_the_safe_can_never_set_a_confiscatory_rate() public {
        vm.startPrank(safe);
        vm.expectRevert(OmertaHook.BadBps.selector);
        hook.setSellTax(1001, 200, 400);

        hook.setSellTax(1000, 200, 400); // exactly at the cap is allowed
        assertEq(hook.sellTaxBps(), 1000);

        // The slices can never exceed the total either — LP's remainder can be zero, never negative.
        vm.expectRevert(OmertaHook.BadBps.selector);
        hook.setSellTax(900, 600, 400);
        vm.stopPrank();

        assertEq(hook.MAX_SELL_TAX_BPS(), 1000, "the compile-time cap moved");
    }

    function test_only_the_safe_can_tune_it() public {
        vm.expectRevert();
        hook.setSellTax(0, 0, 0);
        vm.expectRevert();
        hook.setRecipients(address(1), address(2), address(3));
        vm.expectRevert();
        hook.setAllowedQuote(eth, false);
        vm.expectRevert();
        hook.setObserver(IOmrHookObserver(address(0)));
    }

    // ── the sweep ────────────────────────────────────────────────────────────────────────────────

    function test_sweep_pays_the_three_wallets_and_nobody_else() public {
        _sellExactIn(100e18);
        (uint256 d, uint256 r, uint256 l) = _owed(eth);

        // Permissionless: a stalled Safe must not be able to strand fees, and there is nowhere else
        // for them to go.
        vm.prank(address(0xCAFE));
        hook.sweep(eth);

        assertEq(dev.balance, d, "dev");
        assertEq(rwa.balance, r, "rwa");
        assertEq(lp.balance, l, "lp");
        assertEq(address(hook).balance, 0, "the hook kept something");

        (d, r, l) = _owed(eth);
        assertEq(d + r + l, 0, "the counters did not clear");
        vm.expectRevert(OmertaHook.NothingToSweep.selector);
        hook.sweep(eth);
    }

    /// The reason the fee accrues instead of being pushed to three addresses mid-swap.
    function test_a_recipient_that_reverts_cannot_brick_the_pool() public {
        Deadbeat bad = new Deadbeat();
        vm.prank(safe);
        hook.setRecipients(address(bad), rwa, lp);

        // Swaps keep working — a broken wallet is a treasury problem, not a market outage.
        _sellExactIn(100e18);
        (uint256 d, uint256 r, uint256 l) = _owed(eth);
        assertGt(d + r + l, 0, "the swap did not go through");

        vm.expectRevert();
        hook.sweep(eth);

        // ...and the Safe repoints and the money moves. Nothing was lost in the meantime.
        vm.prank(safe);
        hook.setRecipients(dev, rwa, lp);
        hook.sweep(eth);
        assertEq(dev.balance, d, "the repointed sweep did not pay");
    }

    // ── liveness: no pause, and no observer can stop a trade ─────────────────────────────────────

    function test_there_is_no_pause_only_an_off_switch() public {
        // A hook that could revert `beforeSwap` could halt a public market. This one cannot: the
        // only lever is the rate, and setting it to zero stops the fee, not the pool.
        vm.prank(safe);
        hook.setSellTax(0, 0, 0);
        uint256 before = trader.balance;
        _sellExactIn(50e18);
        assertGt(trader.balance, before, "an unarmed hook stopped a trade");
    }

    function test_a_broken_observer_cannot_stop_a_swap() public {
        // Deployed ABOVE the prank on purpose: an inline `new` in the argument list makes its own
        // call and consumes the pending prank (the cheatcode footgun this subtree already records
        // against `OmertaBond._sign`).
        RevertingObserver rev = new RevertingObserver();
        vm.prank(safe);
        hook.setObserver(rev);
        uint256 before = trader.balance;
        _sellExactIn(50e18);
        assertGt(trader.balance, before, "a reverting observer stopped a trade");

        // The gas stipend is the other half: an observer that tries to burn the whole budget is cut
        // off at OBSERVER_GAS rather than taking the swap down with it.
        GreedyObserver greedy = new GreedyObserver();
        vm.prank(safe);
        hook.setObserver(greedy);
        before = trader.balance;
        _sellExactIn(50e18);
        assertGt(trader.balance, before, "a gas-hungry observer stopped a trade");
    }

    function test_a_working_observer_sees_every_swap_and_the_pool_opening() public {
        CountingObserver obs = new CountingObserver();
        vm.prank(safe);
        hook.setObserver(obs);
        _sellExactIn(10e18);
        _buyExactIn(1 ether);
        assertEq(obs.calls(), 2, "the oracle seam did not fire on both swaps");

        // ...and on initialize, which is how a fresh oracle gets its first observation.
        PoolKey memory k2 = PoolKey(eth, omrC, 500, 10, IHooks(address(hook)));
        manager.initialize(k2, SQRT_PRICE_1_1);
        assertEq(obs.calls(), 3, "the oracle seam did not fire on initialize");
    }

    // ── access ───────────────────────────────────────────────────────────────────────────────────

    function test_only_the_pool_manager_may_call_the_hooks() public {
        vm.expectRevert(OmertaHook.NotPoolManager.selector);
        hook.beforeInitialize(address(this), key, SQRT_PRICE_1_1);
        vm.expectRevert(OmertaHook.NotPoolManager.selector);
        hook.afterInitialize(address(this), key, SQRT_PRICE_1_1, 0);
        vm.expectRevert(OmertaHook.NotPoolManager.selector);
        hook.beforeSwap(address(this), key, SwapParams(false, -1, 0), "");
        vm.expectRevert(OmertaHook.NotPoolManager.selector);
        hook.afterSwap(address(this), key, SwapParams(false, -1, 0), BalanceDelta.wrap(0), "");
    }

    function test_the_callbacks_it_does_not_implement_refuse_loudly() public {
        ModifyLiquidityParams memory p = ModifyLiquidityParams(MIN_TICK, MAX_TICK, 1, bytes32(0));
        vm.expectRevert(OmertaHook.HookNotImplemented.selector);
        hook.beforeAddLiquidity(address(this), key, p, "");
        vm.expectRevert(OmertaHook.HookNotImplemented.selector);
        hook.afterAddLiquidity(address(this), key, p, BalanceDelta.wrap(0), BalanceDelta.wrap(0), "");
        vm.expectRevert(OmertaHook.HookNotImplemented.selector);
        hook.beforeRemoveLiquidity(address(this), key, p, "");
        vm.expectRevert(OmertaHook.HookNotImplemented.selector);
        hook.afterRemoveLiquidity(address(this), key, p, BalanceDelta.wrap(0), BalanceDelta.wrap(0), "");
        vm.expectRevert(OmertaHook.HookNotImplemented.selector);
        hook.beforeDonate(address(this), key, 0, 0, "");
        vm.expectRevert(OmertaHook.HookNotImplemented.selector);
        hook.afterDonate(address(this), key, 0, 0, "");
    }

    // ── §9.6, the operating rule ─────────────────────────────────────────────────────────────────

    /// @notice **The sell tax is what makes a bond a HOLD rather than an arbitrage**, and nothing
    ///         else in the system relates the two numbers — `BONDS.DISCOUNT_BPS` lives in the
    ///         backend (`src/rules.tail.js`) and feeds `OmertaBond`'s signed quotes; the tax lives
    ///         here. A bonder is the most motivated bypass-seeker OMR will have: known size, known
    ///         schedule, capital raised for the purpose. If the discount ever exceeds the tax, a
    ///         bond stops being capital formation and becomes a subsidy on selling.
    function test_a_bond_flipped_straight_back_through_the_pool_must_lose_money() public pure {
        uint256 discountBps = 800; // rules.tail.js BONDS.DISCOUNT_BPS (env BOND_DISCOUNT_BPS)
        assertLt(discountBps, TAX_BPS, "DISCOUNT_BPS must stay strictly below the sell tax");

        // 1 ETH bonds (1 + discount) ETH-worth of OMR; selling it back pays the tax.
        uint256 out = ((10000 + discountBps) * (10000 - TAX_BPS)) / 10000;
        assertLt(out, 10000, "an immediate bond flip is profitable at these numbers");

        // The 20% MAX_DISCOUNT_BPS is deliberately ABOVE the tax: it is a rogue-signer backstop, not
        // a setting. Stated here so the relationship is a decision on the record rather than an
        // accident of two independently-chosen constants.
        assertGt(uint256(2000), TAX_BPS, "MAX_DISCOUNT_BPS is a backstop, above the operating rate");
    }
}

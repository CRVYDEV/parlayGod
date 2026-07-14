// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {OMR} from "../src/OMR.sol";
import {GearVault} from "../src/GearVault.sol";
import {VoucherClaim, IGearVault} from "../src/VoucherClaim.sol";
import {OMRStaking} from "../src/OMRStaking.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Deploy order: OMR -> GearVault -> VoucherClaim -> Staking -> wire minter.
/// env: SAFE (owner/treasury), SIGNER (server voucher key), DAILY_CAP_OMR (wei), BASE_URI
/// Testnet (Robinhood Chain 46630):
///   forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --private-key $DEPLOYER_PK
contract Deploy is Script {
    function run() external {
        address safe = vm.envAddress("SAFE");
        address signer = vm.envAddress("SIGNER");
        uint256 cap = vm.envOr("DAILY_CAP_OMR", uint256(50_000e18));
        string memory baseUri = vm.envOr("BASE_URI", string("https://omerta.example/gear/"));

        vm.startBroadcast();
        OMR omr = new OMR(safe);
        // Own GearVault to the Safe from birth — never leave a hot deployer key as the
        // mint-authority gatekeeper (setMinter). Minter stays unset (mint impossible)
        // until the Safe wires it, and gear can't mint until the Safe sets supply caps.
        GearVault gear = new GearVault(safe, baseUri);
        VoucherClaim vc = new VoucherClaim(safe, signer, IERC20(address(omr)), IGearVault(address(gear)), cap);
        OMRStaking staking = new OMRStaking(safe, IERC20(address(omr)), 1400);
        vm.stopBroadcast();

        console.log("OMR:         ", address(omr));
        console.log("GearVault:   ", address(gear));
        console.log("VoucherClaim:", address(vc));
        console.log("OMRStaking:  ", address(staking));
        console.log("NEXT (all Safe txs): gear.setMinter(VoucherClaim); vc.setGearSupplyCap(id,cap) per class;");
        console.log("  fund VoucherClaim OMR tranche; omr.approve(staking) + staking.fundRewards(...).");
    }
}

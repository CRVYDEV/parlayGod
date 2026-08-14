// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {OMR} from "../src/OMR.sol";
import {GearVault} from "../src/GearVault.sol";
import {VoucherClaim, IGearVault} from "../src/VoucherClaim.sol";
import {OMRStaking} from "../src/OMRStaking.sol";
import {OmertaFees} from "../src/OmertaFees.sol";
import {StreetDeed} from "../src/StreetDeed.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Deploy order: OMR -> GearVault -> VoucherClaim -> Staking -> OmertaFees -> wire minter.
/// env: SAFE (owner/treasury), SIGNER (server voucher key), DAILY_CAP_OMR (wei), BASE_URI,
///      DEV_WALLET (fee recipient), MINT_FEE_WEI (0.01 eth), RESPAWN_FEE_WEI (0.10 eth)
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
        // §11 fee tollbooth — splits each fee dev/Vig and forwards straight to those wallets,
        // owned by the Safe. VIG_BPS MUST equal the backend's VIG_BPS (src/vig.js) so on- and
        // off-chain revenue accounting never drift. VIG_WALLET defaults to the dev wallet with a
        // 0-bps split (100% dev) so a deploy without Phase-2 config keeps the pre-split behaviour.
        address payable devWallet = payable(vm.envAddress("DEV_WALLET"));
        address payable vigWallet = payable(vm.envOr("VIG_WALLET", devWallet));
        uint256 vigBps = vm.envOr("VIG_BPS", uint256(0));
        uint256 mintFee = vm.envOr("MINT_FEE_WEI", uint256(0.01 ether));
        uint256 respawnFee = vm.envOr("RESPAWN_FEE_WEI", uint256(0.10 ether));
        OmertaFees fees = new OmertaFees(safe, devWallet, vigWallet, vigBps, mintFee, respawnFee);
        // StreetDeed — the on-chain tradeable Street Deed NFT (omerta-street-deeds-design.md §2/§3).
        // Self-minting ERC-721 on the SAME server signer as VoucherClaim (no owner-mint), Safe-owned.
        // deedImageBase → the game's block-plate route; deedExternalBase → the deed's legend page.
        string memory deedImg = vm.envOr("DEED_IMAGE_BASE", string("https://www.omerta.fun/v1/deeds/plate/"));
        string memory deedExt = vm.envOr("DEED_EXTERNAL_BASE", string("https://www.omerta.fun/deed/"));
        StreetDeed deed = new StreetDeed(safe, signer, deedImg, deedExt);
        vm.stopBroadcast();

        console.log("OMR:         ", address(omr));
        console.log("GearVault:   ", address(gear));
        console.log("VoucherClaim:", address(vc));
        console.log("OMRStaking:  ", address(staking));
        console.log("OmertaFees:  ", address(fees));
        console.log("StreetDeed:  ", address(deed));
        console.log("NEXT (all Safe txs): gear.setMinter(VoucherClaim); vc.setGearSupplyCap(id,cap) per class;");
        console.log("  fund VoucherClaim OMR tranche; omr.approve(staking) + staking.fundRewards(...).");
        console.log("  StreetDeed: no wiring needed (self-minting on SIGNER); set deed.setDailyMintCap(n) to rate-cap.");
    }
}

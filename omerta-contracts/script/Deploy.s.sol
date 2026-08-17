// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {OMR} from "../src/OMR.sol";
import {GearVault} from "../src/GearVault.sol";
import {VoucherClaim, IGearVault} from "../src/VoucherClaim.sol";
import {OMRStaking} from "../src/OMRStaking.sol";
import {OmertaFees} from "../src/OmertaFees.sol";
import {StreetDeed} from "../src/StreetDeed.sol";
import {DynastyNFT} from "../src/DynastyNFT.sol";
import {StockVault} from "../src/StockVault.sol";
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
        // (Env reads are block-scoped so their locals drop off the stack — Deploy.s.sol is stack-tight.)
        OmertaFees fees;
        {
            address payable devWallet = payable(vm.envAddress("DEV_WALLET"));
            address payable vigWallet = payable(vm.envOr("VIG_WALLET", devWallet));
            fees = new OmertaFees(
                safe, devWallet, vigWallet,
                vm.envOr("VIG_BPS", uint256(0)),
                vm.envOr("MINT_FEE_WEI", uint256(0.01 ether)),
                vm.envOr("RESPAWN_FEE_WEI", uint256(0.10 ether))
            );
        }
        // StreetDeed — the on-chain tradeable Street Deed NFT (omerta-street-deeds-design.md §2/§3).
        // Self-minting ERC-721 on the SAME server signer as VoucherClaim (no owner-mint), Safe-owned.
        // deedImageBase → the game's block-plate route; deedExternalBase → the deed's legend page.
        StreetDeed deed = new StreetDeed(
            safe, signer,
            vm.envOr("DEED_IMAGE_BASE", string("https://www.omerta.fun/v1/deeds/plate/")),
            vm.envOr("DEED_EXTERNAL_BASE", string("https://www.omerta.fun/deed/")),
            // The leaked-signer rate wall. Constructor-bound so a deploy must STATE it (0 = unlimited).
            vm.envOr("DEED_DAILY_MINT_CAP", uint256(0))
        );
        // DynastyNFT — the uncapped identity NFT (omerta-dynasty-machine-design.md §4). Self-minting
        // ERC-721 on the SAME server signer (no owner-mint), Safe-owned. tokenURI resolves to the
        // account's metadata endpoint off-chain; the game entitlement stays account-bound (no balanceOf
        // gate on-chain). EIP-2981 royalty pays the treasury Safe by default.
        DynastyNFT dynasty = new DynastyNFT(
            safe, signer,
            vm.envOr("DYNASTY_BASE_URI", string("https://www.omerta.fun/v1/identity/")),
            vm.envOr("DYNASTY_ROYALTY_RECIPIENT", safe),
            uint96(vm.envOr("DYNASTY_ROYALTY_BPS", uint256(500))), // 5%
            // The leaked-signer rate wall. With NO supply cap here an unset wall is unbounded, so this is
            // constructor-bound: a deploy must STATE it (0 = unlimited).
            vm.envOr("DYNASTY_DAILY_MINT_CAP", uint256(0))
        );
        // StockVault — the gateless keeper-push tokenized-stock delivery vault (omerta-brokers-design.md
        // §3.3). NEVER mints (pre-held transfer only). Keeper unset (0) at deploy = deliveries OFF until
        // the Safe wires the push bot; the Safe pre-funds the vault with bought stock and sets per-token
        // daily caps before arming the keeper. STOCK_DEFAULT_DAILY_CAP is the wall a ticker inherits
        // before anyone sets its own — the ticker set GROWS (the Commission votes one daily off a list
        // the operator extends), and nothing in adding a token forces a setDailyCap, so this is what
        // keeps a freshly-added stock from being the one a leaked keeper drains in a block.
        StockVault vault = new StockVault(
            safe, vm.envOr("STOCK_KEEPER", address(0)), vm.envOr("STOCK_DEFAULT_DAILY_CAP", uint256(0)));
        vm.stopBroadcast();

        console.log("OMR:         ", address(omr));
        console.log("GearVault:   ", address(gear));
        console.log("VoucherClaim:", address(vc));
        console.log("OMRStaking:  ", address(staking));
        console.log("OmertaFees:  ", address(fees));
        console.log("StreetDeed:  ", address(deed));
        console.log("DynastyNFT:  ", address(dynasty));
        console.log("StockVault:  ", address(vault));
        console.log("NEXT (all Safe txs): gear.setMinter(VoucherClaim); vc.setGearSupplyCap(id,cap) per class;");
        console.log("  fund VoucherClaim OMR tranche; omr.approve(staking) + staking.fundRewards(...).");
        console.log("  StreetDeed/DynastyNFT: self-minting on SIGNER. Their daily mint caps are now CONSTRUCTOR");
        console.log("    args (DEED_DAILY_MINT_CAP / DYNASTY_DAILY_MINT_CAP) - if you left them 0 they are UNCAPPED,");
        console.log("    and the shared signer key's blast radius is the SUM of all four contracts' daily caps.");
        console.log("  StockVault: pre-fund with bought stock, vault.setDailyCap(token,cap) per ticker, THEN vault.setKeeper(bot).");
    }
}

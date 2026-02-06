// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SessionFiHook} from "../src/SessionFiHook.sol";

/**
 * @title DeploySessionFiHook
 * @notice Deployment script for the SessionFiHook contract
 * @dev Run with: forge script script/DeploySessionFiHook.s.sol --rpc-url $RPC_URL --broadcast
 */
contract DeploySessionFiHook is Script {
    function run() external returns (SessionFiHook) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        console.log("Deploying SessionFiHook...");
        console.log("Deployer:", vm.addr(deployerPrivateKey));
        
        vm.startBroadcast(deployerPrivateKey);
        
        SessionFiHook hook = new SessionFiHook();
        
        vm.stopBroadcast();
        
        console.log("SessionFiHook deployed to:", address(hook));
        console.log("Base Fee:", hook.BASE_FEE());
        console.log("High Volume Fee:", hook.HIGH_VOLUME_FEE());
        console.log("High Volume Threshold:", hook.HIGH_VOLUME_THRESHOLD());
        
        return hook;
    }
}

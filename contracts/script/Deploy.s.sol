// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../YellowSessionCustodian.sol";

contract DeployScript is Script {
    function run() external {
        // Load private key from environment
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy the custodian contract
        YellowSessionCustodian custodian = new YellowSessionCustodian();
        
        console.log("YellowSessionCustodian deployed at:", address(custodian));
        
        vm.stopBroadcast();
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {GHBounties} from "../src/GHBounties.sol";

contract Deploy is Script {
    function run() external returns (GHBounties deployed) {
        uint64 defaultLock = uint64(vm.envOr("DEFAULT_LOCK_SECONDS", uint256(7 days)));

        vm.startBroadcast();
        deployed = new GHBounties(defaultLock);
        vm.stopBroadcast();
    }
}

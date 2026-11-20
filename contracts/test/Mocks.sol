// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Test-only stand-in for the Agent ID registry (balanceOf only).
contract MockAgentID {
    mapping(address => uint256) public balanceOf;

    function set(address a, uint256 b) external {
        balanceOf[a] = b;
    }
}

/// Test-only USDT (18 decimals, like BSC USDT).
contract MockUSDT is ERC20 {
    constructor() ERC20("Mock USDT", "USDT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Test-only "hackathon project" contract that testers interact with.
contract MockTarget {
    mapping(address => uint256) public pings;

    function ping() external {
        pings[msg.sender] += 1;
    }
}

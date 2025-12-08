// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./AMM.sol";

/// @title Flash Loan Receiver for Testing
/// @notice Simple contract that implements IFlashLoanReceiver for testing flash loans
contract FlashLoanReceiver {
    AMM public immutable amm;
    
    // Track flash loan calls
    address public lastToken;
    uint256 public lastAmount;
    uint256 public lastFee;
    bytes public lastData;
    
    // Control repayment behavior
    bool public shouldRepay = true;
    uint256 public repayAmountOverride = 0; // 0 means use calculated amount
    
    constructor(address _amm) {
        amm = AMM(_amm);
    }
    
    /// @notice Set whether to repay flash loan
    function setShouldRepay(bool _shouldRepay) external {
        shouldRepay = _shouldRepay;
    }
    
    /// @notice Set custom repay amount (0 = use calculated amount)
    function setRepayAmountOverride(uint256 _amount) external {
        repayAmountOverride = _amount;
    }
    
    /// @notice Flash loan callback
    function onFlashLoan(
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external {
        // Store call info
        lastToken = token;
        lastAmount = amount;
        lastFee = fee;
        lastData = data;
        
        // Repay if configured to do so
        if (shouldRepay) {
            uint256 repayAmount = repayAmountOverride > 0 ? repayAmountOverride : (amount + fee);
            
            if (token == address(0)) {
                // ETH repayment
                require(address(this).balance >= repayAmount, "insufficient ETH");
                (bool success, ) = payable(msg.sender).call{value: repayAmount}("");
                require(success, "ETH transfer failed");
            } else {
                // ERC20 repayment
                require(IERC20(token).balanceOf(address(this)) >= repayAmount, "insufficient tokens");
                require(IERC20(token).transfer(msg.sender, repayAmount), "transfer failed");
            }
        }
    }
    
    /// @notice Execute flash loan
    function executeFlashLoan(
        bytes32 poolId,
        address token,
        uint256 amount,
        bytes calldata data
    ) external {
        amm.flashLoan(poolId, token, amount, data);
    }
    
    // Allow contract to receive ETH
    receive() external payable {}
}


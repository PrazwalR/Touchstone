// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolId} from "v4-core/types/PoolId.sol";

/// @title TransientLib
/// @notice PoolId-keyed transient slots for the swap path, and the reentrancy lock.
/// @dev Slots are keyed by pool so swaps on different pools inside one unlock never overwrite each
/// other. Transient storage clears at the end of every transaction (EIP-1153), so nothing here can
/// see block boundaries; the first-touch rule pairs FIRST_TOUCH_TX with the persistent lastTouchBlock.
/// Assembly is used only for TSTORE and TLOAD, which Solidity 0.8.26 exposes no other way for
/// value types; a transient-storage write costs 100 gas against 2,900 or more for SSTORE.
library TransientLib {
    bytes32 internal constant PRE_SQRT_PRICE = keccak256("touchstone.transient.preSqrtPrice");
    bytes32 internal constant PRE_LIQUIDITY = keccak256("touchstone.transient.preLiquidity");
    bytes32 internal constant PRE_SWAP_FEE = keccak256("touchstone.transient.preSwapFee");
    bytes32 internal constant FIRST_TOUCH_TX = keccak256("touchstone.transient.firstTouchTx");
    bytes32 internal constant LAST_DEPOSIT = keccak256("touchstone.transient.lastDeposit");
    bytes32 internal constant LAST_RECORD = keccak256("touchstone.transient.lastRecord");
    bytes32 internal constant LOCK = keccak256("touchstone.transient.lock");
    /// @dev GuardedRouter: the trader for the length of its lock, read by msgSender. Keyed with the zero PoolId.
    bytes32 internal constant ROUTER_CALLER = keccak256("touchstone.transient.routerCaller");

    /// @notice The slot for `label` on pool `id`.
    function slot(bytes32 label, PoolId id) internal pure returns (bytes32) {
        return keccak256(abi.encode(label, id));
    }

    /// @notice Write `value` to `label` for pool `id`.
    function set(bytes32 label, PoolId id, uint256 value) internal {
        bytes32 s = slot(label, id);
        assembly ("memory-safe") {
            tstore(s, value)
        }
    }

    /// @notice Read `label` for pool `id`; zero if never written in this transaction.
    function get(bytes32 label, PoolId id) internal view returns (uint256 value) {
        bytes32 s = slot(label, id);
        assembly ("memory-safe") {
            value := tload(s)
        }
    }

    /// @notice True while the lock is held in this transaction.
    function locked() internal view returns (bool held) {
        bytes32 s = LOCK;
        assembly ("memory-safe") {
            held := tload(s)
        }
    }

    /// @notice Take or release the lock.
    function setLock(bool held) internal {
        bytes32 s = LOCK;
        assembly ("memory-safe") {
            tstore(s, held)
        }
    }
}

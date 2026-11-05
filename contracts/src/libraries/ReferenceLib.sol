// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AggregatorV3Interface} from "../interfaces/external/AggregatorV3Interface.sol";

/// @title ReferenceLib
/// @notice Reads the Chainlink reference, treating failed or malformed responses as absent.
/// @dev The reference affects both the drift trigger and the gap-based deposit rate. A failed read,
/// malformed response, stale answer, non-positive answer or down sequencer returns ok = false,
/// and the caller treats the reference as absent (decision 0003). The feed's answer is read as the
/// risky token's price in whole quote tokens, so the pool's quote token must track its denomination (USD for a
/// USDC-quoted pool); decision 0022 records this.
library ReferenceLib {
    uint256 internal constant PRICE_SCALE_DECIMALS = 36;
    /// @dev 10**76 is the largest power of ten below 2**256.
    uint256 internal constant MAX_POW10 = 76;

    /// @notice Reference price in quote base units per risky base unit, times 1e36.
    /// @param aggregator Chainlink aggregator; zero means no reference.
    /// @param maxAge Oldest acceptable answer, in seconds.
    /// @param decRisky Risky token decimals.
    /// @param decQuote Quote token decimals.
    /// @return ok True if the answer is fresh, positive and convertible.
    /// @return priceX36 The converted price; zero when ok is false.
    function readX36(address aggregator, uint32 maxAge, uint8 decRisky, uint8 decQuote)
        internal
        view
        returns (bool ok, uint256 priceX36)
    {
        if (aggregator == address(0)) return (false, 0);
        (bool roundOk, uint256[5] memory words) = _roundData(aggregator);
        if (!roundOk) return (false, 0);
        int256 answer = int256(words[1]);
        uint256 updatedAt = words[3];
        if (answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp) return (false, 0);
        if (block.timestamp - updatedAt > maxAge) return (false, 0);
        (bool decimalsOk, bytes memory data) = aggregator.staticcall(abi.encodeCall(AggregatorV3Interface.decimals, ()));
        if (!decimalsOk || data.length < 32) return (false, 0);
        uint256 feedDecimals = abi.decode(data, (uint256));
        if (feedDecimals > type(uint8).max) return (false, 0);
        return _scale(uint256(answer), uint8(feedDecimals), decRisky, decQuote);
    }

    /// @notice True if the L2 sequencer uptime feed reports the sequencer up for at least `grace` seconds.
    /// @param feed Chainlink sequencer uptime feed; zero means the chain has none, which counts as up.
    /// @param grace Seconds the sequencer must have been up.
    function sequencerUp(address feed, uint32 grace) internal view returns (bool) {
        if (feed == address(0)) return true;
        (bool ok, uint256[5] memory words) = _roundData(feed);
        if (!ok) return false;
        uint256 startedAt = words[2];
        // Chainlink's uptime feeds report 0 for up and 1 for down; startedAt is the last status change.
        if (words[1] != 0 || startedAt == 0 || startedAt > block.timestamp) return false;
        return block.timestamp - startedAt >= grace;
    }

    /// @dev Decode whole words only after checking length, so malformed narrow fields cannot raise
    /// a caller-side ABI error outside a typed external call's catch block.
    function _roundData(address feed) private view returns (bool ok, uint256[5] memory words) {
        (bool success, bytes memory data) = feed.staticcall(abi.encodeCall(AggregatorV3Interface.latestRoundData, ()));
        if (!success || data.length < 160) return (false, words);
        words = abi.decode(data, (uint256[5]));
        if (words[0] > type(uint80).max || words[4] > type(uint80).max) return (false, words);
        return (true, words);
    }

    /// @dev answer * 10^(36 + decQuote - decRisky - feedDecimals), or ok = false if the exponent is out of range.
    function _scale(uint256 answer, uint8 feedDecimals, uint8 decRisky, uint8 decQuote)
        private
        pure
        returns (bool, uint256)
    {
        int256 k = int256(PRICE_SCALE_DECIMALS) + int256(uint256(decQuote)) - int256(uint256(decRisky))
            - int256(uint256(feedDecimals));
        if (k >= 0) {
            if (uint256(k) > MAX_POW10) return (false, 0);
            uint256 factor = 10 ** uint256(k);
            // answer is an int256 below 2^255; the product overflows only for absurd feeds.
            if (answer > type(uint256).max / factor) return (false, 0);
            return (true, answer * factor);
        }
        if (uint256(-k) > MAX_POW10) return (false, 0);
        uint256 price = answer / 10 ** uint256(-k);
        return (price != 0, price);
    }
}

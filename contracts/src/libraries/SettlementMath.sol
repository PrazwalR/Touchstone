// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FullMath} from "v4-core/libraries/FullMath.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";
import {Payout} from "../types/Payout.sol";
import {ITouchstoneErrors} from "../interfaces/ITouchstoneErrors.sol";

/// @title SettlementMath
/// @notice Markout, regime, clawback and split. Pure functions, shared by the Settler, the lens and
/// the tests, so the contract and the research replay compute the same numbers.
/// @dev R rounds down and the refund is D - R, so refund + R = D exactly (invariant I3).
library SettlementMath {
    uint256 internal constant PRICE_SCALE = 1e36;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant PIPS = 1_000_000;
    uint8 internal constant MODE_CLOSED = 1;

    /// @notice Inputs to the split, all in the deposit currency.
    struct SplitParams {
        uint16 tipBps;
        uint128 tipCap;
        uint16 protocolShareBps;
        uint16 rhoBps;
    }

    /// @notice m = x_r * P* + x_q, from the trader's signed receipts, rounded toward negative infinity.
    /// @param xRisky Risky base units the trader received (negative if paid).
    /// @param xQuote Quote base units the trader received (negative if paid).
    /// @param priceX36 P*, quote base units per risky base unit, times 1e36.
    /// @return Markout in quote units; positive means the trader beat P* after the fee.
    function markout(int256 xRisky, int256 xQuote, uint256 priceX36) internal pure returns (int256) {
        // |x_r| * P* needs 512 bits in the worst case, so the product goes through mulDiv.
        // Rounding is toward negative infinity: down for receipts, up in magnitude for payments.
        if (xRisky >= 0) {
            return SafeCast.toInt256(FullMath.mulDiv(uint256(xRisky), priceX36, PRICE_SCALE)) + xQuote;
        }
        uint256 paid = FullMath.mulDivRoundingUp(uint256(-xRisky), priceX36, PRICE_SCALE);
        return xQuote - SafeCast.toInt256(paid);
    }

    /// @notice The LPs' share for a record.
    /// @param mode 0 continuous, 1 closure.
    /// @param licenceActive A lease was live when the swap executed.
    /// @param byHolder The swap was the holder's first touch in its block.
    /// @param inBand |p_pre - P*| <= G * P*.
    function alphaBps(
        uint8 mode,
        bool licenceActive,
        bool byHolder,
        bool inBand,
        uint16 alpha,
        uint16 alphaLicensed,
        uint16 alphaClosed
    ) internal pure returns (uint16) {
        if (mode == MODE_CLOSED) return alphaClosed;
        if (!licenceActive || !inBand) return alpha;
        return byHolder ? 0 : alphaLicensed;
    }

    /// @notice R = min(D, alpha * max(0, m+ - eps_eff * N+)), in quote units, rounded down.
    /// @param depositQuote The deposit's value in quote units.
    /// @param mPlus Markout of the in-the-money part, quote units.
    /// @param nPlus Notional of the in-the-money part, quote units.
    /// @param epsBps Margin eps.
    /// @param confBps Pyth confidence c*, added to eps.
    /// @param alpha LPs' share for this record.
    function clawback(uint256 depositQuote, int256 mPlus, uint256 nPlus, uint256 epsBps, uint256 confBps, uint256 alpha)
        internal
        pure
        returns (uint256)
    {
        if (mPlus <= 0 || alpha == 0) return 0;
        uint256 margin = FullMath.mulDiv(nPlus, epsBps + confBps, BPS);
        uint256 m = uint256(mPlus);
        if (m <= margin) return 0;
        uint256 r = FullMath.mulDiv(alpha, m - margin, BPS);
        return r < depositQuote ? r : depositQuote;
    }

    /// @notice Split a retained amount. Tip first, then the protocol share, then rho to the rebate pool.
    /// @param deposit Record deposit, deposit currency.
    /// @param retained R, deposit currency.
    /// @param p Split parameters; tipCap already converted to the deposit currency.
    /// @param tipTo The settlement caller.
    function splitRetained(uint128 deposit, uint128 retained, SplitParams memory p, address tipTo)
        internal
        pure
        returns (Payout memory out)
    {
        if (retained > deposit) revert ITouchstoneErrors.Touchstone__RetainedAboveDeposit(retained, deposit);
        uint256 tip = FullMath.mulDiv(retained, p.tipBps, BPS);
        if (tip > p.tipCap) tip = p.tipCap;
        // With tipBps, protocolShareBps and rhoBps each at most BPS (the factory bounds them far lower, and
        // this precondition is the caller's), tip <= retained, toProtocol <= rest and toRebate <= rest, so
        // nothing underflows, and every amount is at most deposit < 2^128, so the uint128 casts cannot
        // truncate. finalize re-checks conservation in uint256 (audit MATH-3).
        unchecked {
            uint256 rest = retained - tip;
            uint256 toProtocol = FullMath.mulDiv(rest, p.protocolShareBps, BPS);
            rest -= toProtocol;
            uint256 toRebate = FullMath.mulDiv(rest, p.rhoBps, BPS);
            out = Payout({
                benign: false,
                refund: uint128(deposit - retained),
                tip: uint128(tip),
                toProtocol: uint128(toProtocol),
                toRebatePool: uint128(toRebate),
                toLPs: uint128(rest - toRebate),
                rebate: 0,
                tipTo: tipTo
            });
        }
    }

    /// @notice Benign record: full refund and a rebate of min(kappa * f * N, pool), with the tip taken from it.
    /// @param deposit Record deposit.
    /// @param notional Record notional, converted to the deposit currency.
    /// @param feePips The pool's static LP fee in pips.
    /// @param kappaBps Rebate as a share of the fee.
    /// @param rebatePool Rebate pool balance in the deposit currency.
    function benign(
        uint128 deposit,
        uint256 notional,
        uint24 feePips,
        uint16 kappaBps,
        uint128 rebatePool,
        uint16 tipBps,
        uint128 tipCap,
        address tipTo
    ) internal pure returns (Payout memory out) {
        uint256 gross = FullMath.mulDiv(notional, uint256(feePips) * kappaBps, PIPS * BPS);
        // gross <= rebatePool < 2^128 and tip <= gross, so the casts below cannot truncate.
        if (gross > rebatePool) gross = rebatePool;
        uint256 tip = FullMath.mulDiv(gross, tipBps, BPS);
        if (tip > tipCap) tip = tipCap;
        out = Payout({
            benign: true,
            refund: uint128(deposit),
            tip: uint128(tip),
            toProtocol: 0,
            toRebatePool: 0,
            toLPs: 0,
            rebate: uint128(gross - tip),
            tipTo: tipTo
        });
    }

    /// @notice The conservation check finalize runs before it pays anything.
    function conserves(Payout memory p, uint256 deposit, uint256 rebatePool) internal pure returns (bool) {
        if (p.benign) {
            return p.refund == deposit && p.toProtocol == 0 && p.toRebatePool == 0 && p.toLPs == 0
                && uint256(p.tip) + p.rebate <= rebatePool;
        }
        return p.rebate == 0 && uint256(p.refund) + p.tip + p.toProtocol + p.toRebatePool + p.toLPs == deposit;
    }
}

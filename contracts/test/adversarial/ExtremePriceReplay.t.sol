// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TouchstoneFixture} from "../utils/TouchstoneFixture.sol";
import {Handler} from "../invariant/Touchstone.invariant.t.sol";

/// @notice The shrunk 25-swap sequence with which the deep invariant run (2,000 x 1,000) broke I10:
/// a run of large buys drove the pool to v4's price bound, after which afterSwap overflowed computing
/// the drift gap and every swap in that direction reverted (decision 0031). Kept as a fixed replay.
contract ExtremePriceReplayTest is TouchstoneFixture {
    Handler internal handler;

    function setUp() public {
        _setUp(18, 6);
        handler = new Handler(
            Handler.Env({
                manager: manager,
                hook: hook,
                settler: settler,
                ledger: ledger,
                swapRouter: swapRouter,
                pyth: pyth,
                feed: feed,
                key: key,
                quoteIs0: quoteIs0,
                decRisky: decRisky,
                decQuote: decQuote,
                baseId: BASE_ID,
                quoteId: QUOTE_ID
            })
        );
    }

    function test_Replay_DeepInvariantI10() public {
        handler.swap(97623805307133908674748, true, true, 1035445046849877022422849644948831786088543);
        handler.swap(
            885935266219729681323096938, true, true, 50208354037250582125759389335114573879553917120378078631996
        );
        handler.swap(25, true, false, 247179551671285396095020904026818);
        handler.swap(20679899, true, false, 36);
        handler.swap(1471112128, true, true, 195195);
        handler.swap(
            6934542859248921184440019863414351360172305588656789763718805,
            true,
            false,
            15405501761422275020736789860610327012792382
        );
        handler.swap(25, true, true, 285882447515542039);
        handler.swap(43775282, true, false, 234);
        handler.swap(1101808078, true, false, 146097);
        handler.swap(
            115792089237316195423570985008687907853269984665640564039457419374522100711249,
            true,
            false,
            2553107026040000000000000000
        );
        handler.swap(6464317375108740201171, true, false, 17018586450740077017133235474420495);
        handler.swap(1165050401914384124349566649500174012, true, false, 8149161508452774826364);
        handler.swap(
            115792089237316195423570985008687907853269984665640564039457584007913129639935,
            true,
            false,
            275588850170265399392732
        );
        handler.swap(415102229211256137, true, false, 2553107026040000000000000000);
        handler.swap(10581632635642, true, false, 476854936360670854);
        handler.swap(22853103364, true, false, 363727651182956519547227428539249696);
        handler.swap(3514649356, true, false, 12311232594342354);
        handler.swap(1563960575144924158, true, false, 29243654);
        handler.swap(
            180009311139973436624202134162308099245573301283356704391360,
            true,
            false,
            2517430998633652608778049698042504497965
        );
        handler.swap(3644409352446, true, false, 43183638392038805353768146807255515950);
        handler.swap(24, true, false, 208412132626308091414452451822875373187836895583766734949334);
        handler.swap(164289333333333333334, true, false, 2722719740210000000000000000);
        handler.swap(269821818619527898, true, false, 302907068);
        handler.swap(
            168532770649399720397588301745924702370755291,
            true,
            false,
            9857252504495998722386099621695073388278900574479257284428418096596
        );
        handler.swap(
            56352367890303105975690739761294130813172543723994804079091301719,
            true,
            false,
            87461565613453944776500487949522616383
        ); // The swap that then overflowed: an exact-input sell of about 84 risky into the pool at its bound.
        handler.swap(252_448, false, true, 0);

        assertFalse(handler.swapRevertedOnDependency(), "I10");
    }
}

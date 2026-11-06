// Copy for the illustrated acts. Figures are the research report's worked example unless a line says otherwise.
// Code excerpts are verbatim lines of contracts/src, in source order, with "…" marking skipped lines;
// test/excerpts.test.ts fails if any line drifts from the source.

export interface Caption {
  act: string;
  title: string;
  body: string;
  note: string;
}

export const CAPS: Caption[] = [
  {
    act: "Act I · The swap",
    title: "A flagged swap arrives.",
    body: "A flagged swap executes normally. Touchstone opens a record so it can settle against a later signed price.",
    note: "FlowBucketLib.update()",
  },
  {
    act: "Act I · The mark",
    title: "It leaves a mark and a deposit.",
    body: "The swap posts a refundable deposit. In this worked example, a $500,000 trade leaves $1,500 with the hook.",
    note: "DepositLib.rateBps() · quoteAmount() · toRisky()",
  },
  {
    act: "Act II · The interval",
    title: "The record waits for a reference.",
    body: "The deposit waits for a signed Pyth price published at or after the record’s settlement time. An earlier update cannot settle it.",
    note: "The 3 s pulse is the page’s rhythm, not protocol timing",
  },
  {
    act: "Act II · The reference",
    title: "A signed price arrives.",
    body: "The signed price becomes the reference, P*. Its confidence widens the margin, giving uncertain prices more room.",
    note: "PriceLib.fairPriceX36() · confBpsUp() · illustrated",
  },
  {
    act: "Act III · The judgment",
    title: "The mark is measured.",
    body: "The trade’s $500 markout clears a $100 margin. Touchstone retains 80% of the $400 excess: $320, capped at the deposit.",
    note: "ItmLib.leg() · SettlementMath.clawback()",
  },
  {
    act: "Act III · The settlement",
    title: "Value moves accordingly.",
    body: "The trader receives $1,180 back. The retained $320 splits into a $5 settlement tip, $31.50 for rebates and $283.50 for LPs, vested.",
    note: "splitRetained() · conserves() · VestingLib",
  },
];

export const RAIL = [
  "Swap",
  "Deposit",
  "Reference pending",
  "Signed price",
  "Judgment",
  "Allocation",
];
/** Scroll progress at which each rail stage and caption begins. */
export const RAILP = [0, 0.2, 0.34, 0.6, 0.66, 0.82];
export const CAPP = [0, 0.12, 0.34, 0.58, 0.66, 0.8];

export const FACETS = [
  "Clawback",
  "Arbitrage licence",
  "Benign-flow rebates",
  "Quote integrity",
];

export const CLOSED_TICKS: [string, number][] = [
  ["Close", 0],
  ["Closure records", 0.15],
  ["Reopen", 0.8],
  ["Signed price", 0.86],
  ["Settle", 0.92],
];

export const LAB_STEPS = [
  "Trade",
  "Deposit",
  "Interval",
  "Signed price",
  "Judgment",
  "Allocation",
  "Outcome",
];

export type ChipClass = "chip-impl" | "chip-spec" | "chip-illu" | "chip-none";

export interface Excerpt {
  /** Path under contracts/. */
  file: string;
  /** Shown in the code header. */
  label: string;
  lines: string[];
}

export interface PipeNode {
  name: string;
  title: string;
  where: string;
  status: string;
  statusCls: ChipClass;
  role: string;
  excerpt: Excerpt;
}

export const NODES: PipeNode[] = [
  {
    name: "Swap",
    title: "A swap through a Touchstone pool.",
    where: "On-chain",
    status: "Hook · deployed on testnet",
    statusCls: "chip-impl",
    role: "The swap executes in a Uniswap v4 pool whose hook is Touchstone; in beforeSwap and afterSwap the hook decides whether to open a record. BlockLib supplies the block number for the first-touch rule: Arbitrum’s L2 number through ArbSys, because block.number there approximates the parent chain.",
    excerpt: {
      file: "src/libraries/BlockLib.sol",
      label: "src/libraries/BlockLib.sol",
      lines: [
        "/// @notice The block number for `source`.",
        "/// @param source SOURCE_EVM or SOURCE_ARBSYS.",
        "/// @return The block number, truncated to 64 bits, which no chain will exceed.",
        "function number(uint8 source) internal view returns (uint64) {",
        "    if (source == SOURCE_ARBSYS) return uint64(ARBSYS.arbBlockNumber());",
        "    return uint64(block.number);",
        "}",
      ],
    },
  },
  {
    name: "Flag",
    title: "Flow buckets catch split arbitrage.",
    where: "On-chain",
    status: "Implemented · tested",
    statusCls: "chip-impl",
    role: "Two leaky buckets per pool, one per direction, drain at nMin per horizon and fill with each swap’s notional. A swap that leaves its bucket at or above nMin is flagged. Splitting a trade into pieces inside one second fills the bucket exactly as the whole trade would, a fuzzed property. First touch in a block, reference drift and a closed reference market are the other triggers.",
    excerpt: {
      file: "src/libraries/FlowBucketLib.sol",
      label: "src/libraries/FlowBucketLib.sol · update()",
      lines: [
        "uint256 drained = (nMin * (nowTs - lastTime)) / horizon;",
        "uint256 buy = _drain(storedBuy, drained);",
        "uint256 sell = _drain(storedSell, drained);",
        "if (isBuy) {",
        "    buy = _add(buy, notional);",
        "    hit = buy >= nMin;",
        "} else {",
        "    sell = _add(sell, notional);",
        "    hit = sell >= nMin;",
        "}",
      ],
    },
  },
  {
    name: "Deposit",
    title: "A refundable deposit, priced without an oracle.",
    where: "On-chain",
    status: "Implemented · tested",
    statusCls: "chip-impl",
    role: "D = N · min(δmax, max(δ, β·g⁺)), or N · δc for a closure record. The rate scales with the pre-swap gap toward the reference so the cap does not bind on large dislocations, where most toxic markout sits. The deposit converts to the risky token at the swap’s own execution price, and previewDeposit quotes it with the same code.",
    excerpt: {
      file: "src/libraries/DepositLib.sol",
      label: "src/libraries/DepositLib.sol · rateBps()",
      lines: [
        "if (mode == MODE_CLOSED) return deltaClosedBps;",
        "uint256 gPlus = gapBps > 0 ? uint256(gapBps) : 0;",
        "uint256 scaled = (uint256(betaX100) * gPlus) / 100;",
        "uint256 rate = scaled > deltaBps ? scaled : deltaBps;",
        "return rate < deltaMaxBps ? rate : deltaMaxBps;",
      ],
    },
  },
  {
    name: "Reference pending",
    title: "The record waits for a signed price.",
    where: "On-chain state",
    status: "Settler · deployed on testnet",
    statusCls: "chip-impl",
    role: "Settling before the record’s t₀ reverts with TooEarly. The Settler then asks Pyth for the first update published in [t₀, t₀ + maxLag], so a caller cannot pick a convenient later price. Past the window anyone may expire the record, which refunds the deposit in full.",
    excerpt: {
      file: "src/Settler.sol",
      label: "src/Settler.sol · settle()",
      lines: [
        "_checkOpen(record);",
        "PoolConfig memory cfg = FACTORY.poolConfig(record.poolId);",
        "(uint256 t0, uint256 latest,) = _settleTime(record, cfg);",
        "if (block.timestamp < t0) revert Touchstone__TooEarly(t0);",
        "…",
        "PythStructs.PriceFeed[] memory feeds =",
        "    PYTH.parsePriceFeedUpdatesUnique{value: fee}(pythUpdate, ids, uint64(t0), uint64(latest));",
      ],
    },
  },
  {
    name: "Signed price",
    title: "A signed Pyth price becomes P*.",
    where: "Off-chain signed → on-chain",
    status: "Implemented · fork-tested",
    statusCls: "chip-impl",
    role: "Two Pyth USD prices (price, exponent) and the token decimals give P* in quote base units per risky base unit, times 1e36, fuzzed against an exact rational implementation. Updates are signed off-chain, fetched from Hermes by any keeper, and verified on-chain by the Pyth contract; a fork test replays recorded updates against Pyth on Arbitrum Sepolia.",
    excerpt: {
      file: "src/libraries/PriceLib.sol",
      label: "src/libraries/PriceLib.sol · fairPriceX36()",
      lines: [
        "if (pBase <= 0 || pQuote <= 0) revert ITouchstoneErrors.Touchstone__NonPositivePrice();",
        "int256 k = int256(eBase) - int256(eQuote) + int256(uint256(decQuote)) - int256(uint256(decRisky)) + 36;",
        "if (k > MAX_POW10 || k < -MAX_POW10) revert ITouchstoneErrors.Touchstone__ExponentOutOfRange(k);",
        "uint256 base = uint256(int256(pBase));",
        "uint256 quote = uint256(int256(pQuote));",
        "if (k >= 0) return FullMath.mulDiv(base, 10 ** uint256(k), quote);",
      ],
    },
  },
  {
    name: "Judgment",
    title: "The markout is measured against the margin.",
    where: "On-chain",
    status: "Implemented · tested",
    statusCls: "chip-impl",
    role: "Only the in-the-money leg counts, so padding a swap past P* cannot dilute its markout. m = x_r·P* + x_q rounds toward negative infinity. R = min(D, α·max(0, m⁺ − (ε + c*)·N⁺)), rounded down; the cap and the zero floor are fuzzed. A record is benign when R = 0 and m ≤ 0.",
    excerpt: {
      file: "src/libraries/SettlementMath.sol",
      label: "src/libraries/SettlementMath.sol · clawback()",
      lines: [
        "if (mPlus <= 0 || alpha == 0) return 0;",
        "uint256 margin = FullMath.mulDiv(nPlus, epsBps + confBps, BPS);",
        "uint256 m = uint256(mPlus);",
        "if (m <= margin) return 0;",
        "uint256 r = FullMath.mulDiv(alpha, m - margin, BPS);",
        "return r < depositQuote ? r : depositQuote;",
      ],
    },
  },
  {
    name: "Conservation",
    title: "Nothing is paid unless it adds up.",
    where: "On-chain",
    status: "Implemented · tested",
    statusCls: "chip-impl",
    role: "Before paying anything, the hook’s finalize checks that refund, tip, protocol share, rebate pool and LP share add up to the deposit exactly, or, for a benign record, that the deposit is refunded in full and tip plus rebate fit the pool. A mismatch reverts with PayoutMismatch.",
    excerpt: {
      file: "src/libraries/SettlementMath.sol",
      label: "src/libraries/SettlementMath.sol · conserves()",
      lines: [
        "/// @notice The conservation check finalize runs before it pays anything.",
        "function conserves(Payout memory p, uint256 deposit, uint256 rebatePool) internal pure returns (bool) {",
        "    if (p.benign) {",
        "        return p.refund == deposit && p.toProtocol == 0 && p.toRebatePool == 0 && p.toLPs == 0",
        "            && uint256(p.tip) + p.rebate <= rebatePool;",
        "    }",
        "    return p.rebate == 0 && uint256(p.refund) + p.tip + p.toProtocol + p.toRebatePool + p.toLPs == deposit;",
        "}",
      ],
    },
  },
  {
    name: "Allocation",
    title: "Value reaches its owners.",
    where: "On-chain",
    status: "Implemented · tested",
    statusCls: "chip-impl",
    role: "The refund is credited to the beneficiary in the RebateLedger and pushed after the unlock, the tip goes to the settlement caller, ρ to the rebate pool, and the LPs’ share into a buffer that drip donates to in-range LPs over the vesting period. The donation reaches whoever is in range when drip runs; it does not stop a just-in-time position from sharing.",
    excerpt: {
      file: "src/libraries/VestingLib.sol",
      label: "src/libraries/VestingLib.sol",
      lines: [
        "/// @notice Computes the release from the remaining buffer for one drip interval.",
        "/// @dev Donation recipients are the LPs in range when drip executes; this does not enforce a",
        "/// holding period or prevent JIT capture. Repeated drips change the remaining-balance schedule.",
        "library VestingLib {",
        "    /// @notice Amount to donate now: vest * min(1, elapsed / period), rounded down.",
        "    /// @param vest Buffer balance not yet donated.",
        "    /// @param elapsed Seconds since the last drip.",
        "    /// @param period vestPeriod from PoolConfig.",
        "    function releasable(uint256 vest, uint256 elapsed, uint256 period) internal pure returns (uint256) {",
        "        if (elapsed >= period) return vest;",
        "        return FullMath.mulDiv(vest, elapsed, period);",
        "    }",
        "}",
      ],
    },
  },
];

/** TriggerLib bits, as previewDeposit reports them. */
export const TRIGGERS: [number, string][] = [
  [1, "First touch"],
  [2, "Flow"],
  [4, "Drift"],
  [8, "Closed market"],
];

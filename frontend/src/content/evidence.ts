// The research and engineering evidence the Docs view shows. Every figure carries its label (spec §0.8) and its
// source. The research figures are copied from research/results/*.json; test/evidence.test.ts re-reads those files
// and fails if a number here drifts from them. Gas comes straight from the contracts' snapshot files.
import licenceGas from "../../../contracts/snapshots/LicenceGasTest.json" with { type: "json" };
import quoteGas from "../../../contracts/snapshots/QuoteGasTest.json" with { type: "json" };
import swapGas from "../../../contracts/snapshots/SwapGasTest.json" with { type: "json" };

export type Label = "measured" | "historical backtest" | "simulation" | "testnet demonstration" | "target";

export interface Figure {
  label: string;
  value: string;
  kind: Label;
  source: string;
}

/** E1: where toxic markout sits, and the trigger chosen on the development window. */
export const E1 = {
  window: "Ethereum mainnet, Uniswap v3 USDC/WETH 0.05%, 30 Aug to 27 Sep 2026 (development)",
  swaps: 209_406,
  prereg: "2c68d43d252da12790e5d1efc8524be325d5c6a48e51c9b263f2ede30e86e81a",
  code: "40041d0c9d7e078aacce4a1aeee36135bc6fe385304b6db08d36b08135de64c6",
  selected: { n0: 5_000, nMin: 50_000, h: 6, tauBps: 2 },
  devRecall: 0.9959782013560641,
  devPhiCount: 0.2928426119595427,
  devPhiVolume: 0.9445108447168143,
  findings: [
    "Swaps of $25,000 and above carry 97% of toxic markout; the 70 swaps above $500,000 alone carry 46%.",
    "Swaps below $5,000, 72% of all swaps, carry 0.3% of toxic markout.",
    "Swaps trading toward the Chainlink reference by 20 bp or more carry 55%.",
    "43% of toxic markout is first in its block and 57% later, so on 12-second blocks first touch alone would not suffice; size and flow carry the rest.",
  ],
} as const;

/** E2: held-out recall of the chosen trigger, gate G1. */
export const E2 = {
  window: "Ethereum mainnet, same pool, 27 Sep to 25 Oct 2026 (held out)",
  swaps: 184_145,
  prereg: "148795c21609f8d526429b8de49ed1ba588dd852d7b5e1036ff6f130d3bdaf1a",
  code: "40041d0c9d7e078aacce4a1aeee36135bc6fe385304b6db08d36b08135de64c6",
  verdict: "pass",
  recall: 0.9893875018556911,
  recallCi: [0.9863488006791796, 0.9915007449104039] as const,
  phiCount: 0.23394607510385837,
  phiVolume: 0.8962691356455802,
  rStar: -0.3118807034660406,
  reportAverageRStar: 0.451,
  lpNetUsd: 62_654,
  weeklyRecall: [0.985363855725556, 0.9929902060995052, 0.9908627470240365, 0.986664441642323],
  weeklyPhiCount: [0.22507714462044848, 0.16225552538411303, 0.2711240572641467, 0.32335238786558995],
  caveats: [
    "LPs did not lose at 3 s or 15 s net of fees in the held-out weeks, so the break-even recall r* is negative: the pass is real but the comparison is uninformative on this window.",
    "About 90% of volume would post a refundable deposit. Locked capital, router friction and quote gaps on that volume are what E3, E6 and E12 must price.",
    "One held-out week exceeded the phi_count line of 0.30 (0.323); the gate is the window as a whole, as pre-registered.",
    "One pool, one chain, eight weeks. Arbitrum, Base and longer windows are separate pre-registrations.",
  ],
} as const;

/** E6 simulation, expressed as ratios to the static pool's mean absolute error. */
/** E5: no scenario formally falls below r*, but r* is negative on this window, so recall is the number that
 * matters. The worst evasion scenario (splitting under a tenth of N_min, 24 s delay) drops held-out recall to
 * single digits. */
export const E5 = {
  cases: 11,
  heldoutKills: 0,
  worstHeldoutRecall: 0.09735737910165194,
  worstHeldoutRecallCi: [0.004898247769959127, 0.24316027830093828] as const,
  unchangedHeldoutRecall: 0.9893875061842689,
  rStar: -0.3118807034660406,
  prereg: "7fb7db7aae565b11f8f5858009f65b77f044937cc417abc83f2857ec9d02c9c1",
} as const;

export const E6 = {
  cases: 21,
  developmentKills: 21,
  heldoutKills: 21,
  heldoutRange: [1.3923125970479913, 1.7330536226223376],
  prereg: "36cd1a109596b725a229ef435a38597d1d54f0eef8d61f859743c0dcfd380a1c",
} as const;

export type Status = "killed" | "passed" | "pre-registered" | "drafted" | "not started" | "skipped" | "partly measured";

export interface Experiment {
  id: string;
  name: string;
  kind: string;
  question: string;
  line: string;
  status: Status;
  note: string;
}

/** Spec §16.2, with each experiment's status in this repository on 3 November 2026. */
export const EXPERIMENTS: Experiment[] = [
  { id: "E1", name: "Markout census", kind: "Backtest", question: "Where does toxic markout sit: by block position, size, signed drift?", line: "Descriptive; sets N0, N_min, h and tau on development windows only", status: "passed", note: "Run 28 Oct 2026 on Ethereum mainnet; the trigger it selected is above." },
  { id: "E2", name: "Trigger recall (gate G1)", kind: "Backtest", question: "Does the trigger reach the pool's break-even recall?", line: "Kill if held-out recall is below break-even at phi <= 0.30", status: "passed", note: "Held-out recall 0.989; G1 met on one chain." },
  { id: "E3", name: "Settlement replay", kind: "Backtest", question: "LP net, retail fee, refunds against retentions, how often the cap binds", line: "Pass if the cap binds on under 5% of toxic markout and the retail fee stays within 0.1 bp", status: "pre-registered", note: "Frozen again on 1 Nov 2026 after the repair (prereg/FROZEN.md). Both Binance series match the published hashes. Waiting for the swap and reference logs, legacy Pyth chunks and their source manifest." },
  { id: "E4", name: "Oracle basis", kind: "Backtest, then live", question: "How far do Pyth-settled markouts sit from Binance ones at 2 to 12 s?", line: "Kill if the median gap exceeds epsilon / 2", status: "pre-registered", note: "Frozen with E3 on 1 Nov 2026; waiting for the same inputs. 12,100 of 44,476 Pyth times were downloaded under the earlier freeze and have not been read." },
  { id: "E5", name: "Evasion", kind: "Simulation", question: "Recall when arbitrageurs split, spread across blocks, switch to exact output, or pad into the margin", line: "Kill if recall under evasion falls below r*", status: "partly measured", note: "Run 6 Nov 2026: no scenario formally falls below r* (r* is negative on this window). Splitting under a tenth of N_min collapses held-out recall to under 10%; the formal line does not catch it. See results/README.md." },
  { id: "E6", name: "Freshness", kind: "Simulation", question: "Do entry and trade size match a plain pool, and how much padding appears?", line: "Kill if mean |pool - P*| rises more than 10% over the static fee", status: "killed", note: `All ${E6.cases} simulations exceeded the 10% line in both windows. Held-out mean price error rose ${((E6.heldoutRange[0] - 1) * 100).toFixed(1)}% to ${((E6.heldoutRange[1] - 1) * 100).toFixed(1)}% relative to static (results/E6.json).` },
  { id: "E7", name: "Baselines", kind: "Backtest and simulation", question: "Static 5 bp, VolatilePair, oracle-gap fees, a Detox-style tax, Hindsight-style settlement, a first-swap premium, perfect clawback", line: "Must beat static on LP net and match it on retail fee and freshness", status: "drafted", note: "Draft design in prereg/E7.md." },
  { id: "E8", name: "Engineering", kind: "Testnet and fuzzing", question: "Gas and every invariant, end to end with real Pyth updates", line: "Every invariant holds; 20k gas pass line for an unflagged swap", status: "partly measured", note: "Invariants hold under Foundry's invariant runs and gas is measured below; the testnet run with real Pyth updates is pending the redeploy." },
  { id: "E9", name: "Weekend replay", kind: "Backtest", question: "Do closure-time markouts against the reopen carry information?", line: "Drop closed-market mode if markouts look like noise or the tax exceeds the recovery", status: "skipped", note: "Skipped for now: no verified Robinhood Chain stock-token pools to replay." },
  { id: "E10", name: "Licence", kind: "Simulation, then testnet", question: "LP income under the plain clawback, one bidder and two or more; idle-holder freshness", line: "Keep the licence off unless two bidders beat the plain clawback by 10%", status: "drafted", note: "Race and auction models drafted in prereg/E10.md. The licence has no economic verdict." },
  { id: "E11", name: "Rebates", kind: "Backtest and simulation", question: "Rebate cost and coverage; profit of wash and split-arbitrage farming", line: "Kill rebates on any pool where a wash strategy profits", status: "drafted", note: "Draft design in prereg/E11.md." },
  { id: "E12", name: "Quote integrity", kind: "Fork test", question: "Does depositNow equal the executed deposit? Does getIndicativeQuote match V4Quoter?", line: "Any mismatch in the first two blocks release", status: "partly measured", note: "Both equalities hold in 2,000-run fuzz tests on a local PoolManager; the fork run is pending." },
];

const gas = (n: string) => Number(n).toLocaleString("en-US");

/** Engineering figures, all measured by this repository's tests (3 November 2026). */
export const ENGINEERING: Figure[] = [
  { label: "Hook gas, unflagged swap below N0", value: gas(swapGas.hook_added_unflagged_below_n0), kind: "measured", source: "contracts/snapshots/SwapGasTest.json; target 20,000 (E8)" },
  { label: "Hook gas, unflagged swap at or above N0", value: gas(swapGas.hook_added_unflagged_at_or_above_n0), kind: "measured", source: "contracts/snapshots/SwapGasTest.json" },
  { label: "Hook gas, flagged swap (deposit taken)", value: gas(swapGas.hook_added_flagged), kind: "measured", source: "contracts/snapshots/SwapGasTest.json" },
  { label: "Settlement that retains", value: gas(swapGas.settle_retaining), kind: "measured", source: "contracts/snapshots/SwapGasTest.json" },
  { label: "Licence holder's exempt swap", value: gas(licenceGas.hook_added_licence_exempt), kind: "measured", source: "contracts/snapshots/LicenceGasTest.json" },
  { label: "URC-4 quote, worst layout at 64 ticks", value: gas(quoteGas.quote_64_ticks_one_per_word), kind: "measured", source: "contracts/snapshots/QuoteGasTest.json; maxGas() reports 1,193,000; the 300,000 target is not met (decision 0057)" },
  { label: "TouchstoneHook runtime size", value: "23,993 of 24,576 bytes", kind: "measured", source: "forge build --sizes" },
  { label: "Contract tests", value: "254 passing without RPC; all 3 fork tests passed with the archive RPC", kind: "measured", source: "forge test" },
  { label: "Line and branch coverage of src/", value: "88.9% and 85.9% measured; 95% gate passes after a reviewed attribution list", kind: "measured", source: "forge coverage --ir-minimum; decision 0059" },
];

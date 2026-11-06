# Lesson 13: the four-view dashboard and its wallet

## 1. Concept

A judge or an LP should be able to see the mechanism do its job, not take it on trust. The dashboard therefore
does what a trader does: it quotes a swap, shows what Touchstone will do to it, sends it from the user's own
wallet, and follows the deposit to its settlement. Everything shown is read from the chain or from a recorded
result file, and labelled: *measured*, *historical backtest*, *testnet demonstration*.

The one number a DEX page shows that Touchstone changes is "you receive". Here it is the output **net of any
deposit**, because the deposit leaves the trader's output in the swap transaction and comes back (in full, or
less the part retained for LPs) only at settlement.

## 2. Design decisions

| Chosen | Rejected | Trade-off |
| --- | --- | --- |
| viem over EIP-1193, EIP-6963 discovery | wagmi, RainbowKit | No new dependency or relay; we own about 150 lines of wallet code |
| Approve exactly the input | Unlimited approval | One more signature per swap; never an open allowance |
| Guard from a fresh simulation | Trust the quote | A state change between preview and inclusion reverts on chain instead of filling worse |
| V4Quoter for the output, then an exact `swapGuarded` eth_call | Lens quote only | Works on the live deployment, which predates the lens |
| Own markdown renderer building React elements | A library that injects HTML | With a wallet connected, docs must not be able to run script |
| Spec linked, not bundled | Embed it | The spec is private; a hosted build publishes what it contains |

## 3. Code walkthrough

- `frontend/src/swap/swap.ts`
  - `previewSwap` reads the pool price from PoolManager storage (`extsload` of slot0), the hook's
    `previewDeposit`, V4Quoter's output and, once the input is approved, an exact `swapGuarded` simulation.
  - `guardFor` turns a preview into the four guard limits.
  - `executeSwap` simulates again, sends, and measures what was paid and received from balances around the
    transaction.
  - `recordFromReceipt` decodes `DepositTaken`, and `recordOutcome` finds `Settled` or `Expired`.
- `frontend/src/swap/useSwapFlow.ts`: the page's state machine: idle, approving, signing, done or failed.
- `frontend/src/wallet/`: discovery, connect, chain switch with `wallet_addEthereumChain` fallback, and
  listeners for account and chain changes.
- `frontend/src/views/`: `OverviewView`, `SwapView`, `SimulationView`, `DocsView`. The last three load lazily.
- `frontend/src/docs/markdown.tsx`: block parser, inline tokens, and a link allowlist (http, https, mailto,
  in-page anchors).

## 4. Failure modes

| Failure | Blast radius | Caught by |
| --- | --- | --- |
| Preview read at a cached block right after an approval | Swap button stays on "Approve", or the guard comes from stale state | `getBlockNumber({ cacheTime: 0 })`; `swap.anvil.test.ts` |
| Flagged deposit converted at net instead of gross output | Guard's deposit cap too low; swap reverts | Fixed formula `d * net / (N - d)`; the same test |
| Wallet on the wrong chain | A transaction to a contract that does not exist there | `onRightChain` gates every button; the client is only built on the right chain |
| Malicious markdown in a doc | Script running beside a connected wallet | `markdown.test.ts`: script tags escaped, javascript: and data: links rendered as text |
| A research figure drifting from its result file | A false claim on the page | `evidence.test.ts` re-reads `research/results/*.json` |

## 5. Audit questions

1. *Can the page move funds without the user?* No. It holds no key; every transaction is the wallet's, after the
   user confirms it.
2. *What stops a worse fill than the preview?* The guard, enforced on chain by GuardedRouter: `minNetOut`,
   `minGrossOut`, `maxDeposit` and the deadline.
3. *Why does the guard accept a deposit even when the preview says "not flagged"?* Another swap landing first in
   the block can make this one the first touch. The deposit is held and settled, not lost; refusing it would
   only turn that case into a revert.
4. *Is "price impact" the deposit?* No. It is measured on the gross output; the deposit is shown separately.
5. *Why is the live testnet impact so large?* The demo pool holds about 10 USDC of liquidity. Seed the
   redeployed pool deeper before a recorded demo.

## 6. Exercises

1. Run `pnpm -C frontend vitest run test/swap.anvil.test.ts` and explain each assertion in the first test.
2. With N = 20,000 USDC, d = 444 USDC and a net output of 6.5 ETH, compute the cap `guardFor` puts on the deposit
   at 0.5% slippage.
3. Open `#/docs/research` and match each E2 figure to its field in `research/results/E2.json`.

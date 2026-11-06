# 0060: A wallet-connected Swap and Simulation in the dashboard

Status: accepted by the owners on 3 November 2026. Reverses, for two views only, the standing rule of spec §0.7
that "the dashboard is read-only and has no wallet connection".

## Context

The owners want a demonstration that a judge, an LP or a router can run themselves: a swap page like any DEX's,
and a live arbitrage walkthrough that signs a real testnet swap and follows its record to settlement. Asked on
3 November whether the swap page should stay a read-only `eth_call` simulation or connect a wallet, they chose a
real wallet-connected swap.

## Decision

1. **The dashboard becomes four views**: Overview, Swap, Simulation and Docs, behind hash routes. Overview and
   Docs never ask for a connection and build no transaction; the connect button and every transaction live in
   Swap and Simulation, which load lazily. Wallet discovery (listening for EIP-6963 announcements) is passive and
   runs app-wide so a connection survives switching between the two working views.
2. **Swap and Simulation may connect an injected wallet** (EIP-1193, discovered through EIP-6963: MetaMask, Rabby,
   Coinbase Wallet, Brave). The page never holds a key: the wallet signs. No wallet library is added; the layer
   is viem, already a pinned dependency, plus about 150 lines of our own (`src/wallet/`). No WalletConnect, so no
   relay origin joins the CSP and no project id is needed.
3. **Only two transactions are ever built**: `approve(GuardedRouter, amount)` on the input token, for exactly the
   swap's input, never unlimited; and `GuardedRouter.swapGuarded`. Both are simulated with `eth_call` from the
   connected account first; a failing simulation disables the button and shows the reason.
4. **The guard is the safety net, not the page.** Every swap carries `maxDeposit`, `minNetOut`, `minGrossOut` and a
   deadline computed from a fresh simulation and the user's slippage, so a quote that moves between preview and
   inclusion reverts on chain instead of filling worse.
5. **Testnet only.** The wallet must be on the deployment's chain; any other chain shows a switch prompt and no
   transaction button. The deployment file names one testnet; mainnet ids are rejected.
6. **Exact input only** in this version. Exact output works in the contracts and the guard; the UI adds it later.

## Consequences

- The bundle now contains transaction-building code. It stays small (viem actions, no signer), and `connect-src`
  is unchanged: an injected wallet talks to the page through `window.ethereum`, not over the network.
- XSS on the dashboard could now ask a connected wallet to sign. The CSP (`script-src 'self'`, no inline scripts),
  React's escaping, and a docs renderer that builds elements instead of injecting HTML are the defences; every
  request still needs the user's confirmation in the wallet.
- Labels follow §0.8: anything the page reads or does is a *testnet demonstration*; it says nothing about LP
  returns.

## Rejected

- wagmi or RainbowKit: more dependencies and a WalletConnect relay for no gain in a testnet demo.
- A read-only swap page: what the owners declined.
- Unlimited approvals: one extra click per swap is the price of never leaving an open allowance.

## Verification

`frontend/test/swap.anvil.test.ts` runs the page's swap module against LocalStack on Anvil with a real signer: the
V4Quoter quote equals the exact `swapGuarded` simulation, the approval is exactly the input and is fully spent,
the executed swap pays and receives what the preview said and opens the record, the record's settlement is
detected, and a guard the swap cannot meet reverts before anything moves. Every view was also rendered in
headless Chrome against the production build and the live Arbitrum Sepolia deployment.

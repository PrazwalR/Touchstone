# 0063 Guarded exact-output swaps and deployment selection

Use the pinned V4Quoter at the same block as the deposit preview and balance reads. On exact output the user specifies the receiving token amount. The deposit increases the payment token leg, so approval, native value and the guard all use the input cap. The cap includes slippage and rounds up one fractional unit. The connected-account simulation and final pre-sign simulation check that the requested leg is filled. On chain the existing exact-output guard checks maxNetIn and maxDeposit. A changed pool can fill partially. The form discloses that limitation.

Use the same synced deployment selection for the wallet, all read clients and the Vite CSP. Building with an unavailable VITE_CHAIN fails. A deployment without an NYSE calendar can still serve continuous pools. Base Sepolia needs the owner's actual deployment file before use.

The Anvil test runs exact-output buys and sells against the local PoolManager and hook. It checks output received, deposit currency, and rejection of a cap below the simulated payment. No testnet receipts were produced by those tests.

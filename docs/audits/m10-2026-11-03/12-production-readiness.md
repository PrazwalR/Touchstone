# Production readiness

Milestone M10 (TouchstoneLens, StaticQuoteLib, URC-4 through the hook's fallback), 3 November 2026. Scope: `src/periphery/TouchstoneLens.sol`, `src/libraries/StaticQuoteLib.sol`, `src/interfaces/ITouchstoneLens.sol`, the M10 changes to `src/TouchstoneHook.sol`, `script/base/CoreDeployer.sol`, `script/DeployCore.s.sol`, the chain configs, and their tests. Decision 0057 records the design.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| Info | `script/base/CoreDeployer.sol` | Lens deployed at nonce + 5, predicted before the hook, checked after | | Done; LocalStack and the Anvil e2e suites deploy through it |
| Info | `backend/shared/abi`, `frontend/abi` | `TouchstoneLens` and `IALFHook` ABIs exported; frontend deployment schema has `lens` (null until redeploy) | URC-4 functions are not in the hook ABI | Done |
| Medium | testnet | Arbitrum Sepolia runs the pre-M9 deployment; the lens and auction need the redeploy | Owner signs deploys | Open: release step, not part of M10 |
| Medium | `backend/keeper/src/wiring.ts` | The keeper could start against a mismatched set of addresses | No startup check | Fixed: `checkWiring` at startup and in `pnpm preflight`; each view read separately so a pre-M9 deployment is not misreported (decision 0058) |
| Info | `src/LicenceAuction.sol` `terms` | Bots and the dashboard need the lease terms | No view existed | Added a read of existing storage; `test_Terms_ReportsTheRegisteredLease` |
| Info | `backend/bots` | Holder and bidder modes | Testnet demonstration | Simulate-only by default, no approvals, deposit and rent limits; Anvil e2e |

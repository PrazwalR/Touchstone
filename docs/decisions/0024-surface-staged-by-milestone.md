# 0024 External surface staged by milestone

Status: decided.

The spec's `ITouchstoneHook` (§13.2) extends `IALFHook` and includes `creditRent` and `previewDeposit`; the
spec's `createPool` takes `LeaseParams`. Shipping those members before their milestones would mean functions that
do nothing or parameters nobody reads, which §0.2 forbids. They join the interfaces with their milestones:
`previewDeposit` and `GuardedRouter` in M7, `creditRent`, `LeaseParams` and the licence events in M9, the URC-4
forwarders and ERC-165 in M10. `IALFHook` itself exists now because the hook raises its `MalformedHookData`.

Consequence: the deployed bytecode and ABI change at those milestones. Nothing is deployed before M8.

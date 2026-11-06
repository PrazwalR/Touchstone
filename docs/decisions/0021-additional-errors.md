# 0021 Errors added in M2 and M3

Status: decided. Following D-16, six errors join `ITouchstoneErrors`:
`Touchstone__NotHook` (ledger credit), `Touchstone__NotPoolManager` (ledger unlock callback),
`Touchstone__NotSelf` (`TouchstoneHook.pushOut`), `Touchstone__AlreadyRegistered` (second registration of a
pool), `Touchstone__Reentrant` (transient lock), `Touchstone__LedgerShortfall` (I2 checked after every credit) and
`Touchstone__FeeRefundFailed` (excess Pyth fee could not be returned to the settler's caller).

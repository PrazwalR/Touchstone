# 0027 The factory holds the canonical config

Status: decided, forced by the 24,576-byte limit.

The hook stores the config it needs and the factory stores the full canonical copy, exposes
`poolConfig(PoolId)`, and emits `PoolRegistered`. The Settler reads the config from the factory. Removing the
`poolConfig` view and the event from the hook saved about 3.3 KB. The factory is already one of the hook's
trusted immutables, and the two copies are written in the same transaction from the same validated struct.

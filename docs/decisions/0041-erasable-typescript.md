# 0041 Erasable TypeScript only

Status: decided.

The keeper and indexer run as `node src/main.ts` under Node 24's type stripping, which removes types but does
not transform syntax. Constructor parameter properties (`constructor(private readonly x: T)`) are not erasable,
so `HermesError`, `Keeper` and `Indexer` would have thrown `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` at start-up.
vitest compiles through esbuild, which accepts the syntax, so every test passed and the bug was invisible until
a module was loaded directly by Node.

Fixed by declaring the fields explicitly and setting `erasableSyntaxOnly` in `backend/tsconfig.base.json`, so
`tsc --noEmit` now rejects parameter properties, enums and namespaces. Rejected alternative: a build step with
`tsc` emitting JavaScript, which adds an artefact to keep in sync for no gain on Node 24.

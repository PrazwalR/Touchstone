# 0018 Who emits Settled (spec D-18)

Status: implemented as the spec decides. `Settler.settle` emits `Settled` and `Settler.expire` emits `Expired`
after `finalize` returns; the hook never sees the markout, fair price or alpha. Indexers watch both contracts,
which `indexer/src/main.ts` does.

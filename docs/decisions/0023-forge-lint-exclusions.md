# 0023 forge-lint exclusions

Status: triaged.

- `unsafe-typecast`: every narrowing cast in `src/` sits behind a bound that rules out truncation, stated in the
  comment above the cast or the enclosing `unchecked` block. The lint cannot see those bounds, and it fired 40
  times on the reference pack alone.
- `asm-keccak256`: suggests assembly for hashing. §0.4 allows assembly only in transient-storage helpers.
- `incorrect-shift`: false positive on `1 << n` in `PriceLib._sqrt`, which is the intended order.

Every other lint stays on, and the tree builds with none.

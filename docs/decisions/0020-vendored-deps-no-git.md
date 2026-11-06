# 0020 Vendored dependencies, no git until publication

Status: decided by the owners on 25 October 2026.

Context: the owners want the project built locally and pushed to GitHub only when they choose. Submodules need a
repository.

Choice: each dependency was cloned at its pin and stripped of `.git`, nested `lib/` and `.github/`. Nested
dependencies (OpenZeppelin contracts, permit2, solmate) are flattened to one copy each, at the commits their
parents pin. Only the Solidity SDK subtree of pyth-crosschain is vendored. Pins are in `contracts/lib/PINS.md`.

Consequence: before the first push, convert each directory back into a submodule at the same commit, run
`gitleaks detect` on the history. (The ETHGlobal commit-history requirement this file once cited was withdrawn
with the hackathon entry, decision 0050.)

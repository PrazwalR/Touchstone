# 0050 A private project, not a hackathon entry

Date: 31 October 2026. Status: decided by the owners. Superseded on 7 November 2026 for the hackathon point only:
the project is now submitted to a hackathon. The milestone order and the practices recorded below still hold.

The owners are not entering ETHGlobal Mumbai. Touchstone is built for its own sake, kept in a private repository,
and deployed to testnets when a milestone needs it.

## What changes

- **Rules removed:**
  - the ETHGlobal compliance checklist (`docs/hackathon-checklist.md`, deleted);
  - the Continuity-track plan;
  - the demo script;
  - "the licence is the Mumbai feature, not before 5 November".
- **Specs edited:** the hackathon sections were cut from `docs/developer-spec-2026-10-25.md`, which now carries a
  dated note. The specification's §0 was edited to match.
- **The licence (M9)** is an ordinary milestone after the M8 testnet deployment. Until it is built,
  `licenceActive` and `byHolder` stay false and the factory rejects the `LICENCE` flag.
- **Gates.** G4 (submission) is withdrawn. G1 to G3, G5 and G6 remain, without event dates.
- **Kept, because they are good practice rather than event rules:** small reviewable commits, the lessons (§0.10),
  the honesty rules for numbers (§0.8), secret scanning, and the pre-registration
  discipline.
- **Historical records are not rewritten.** The repair audit still mentions the hackathon, as
  they did when they were written.

## Plan

Two developers, as in the spec: D1 owns contracts and deployment, D2 owns research and off-chain services. Each
phase ends with the §0.5 validation and a lesson.

| Phase | D1: contracts and deployment | D2: research and services |
| --- | --- | --- |
| A. Testnet core | M8 on Arbitrum Sepolia: DeployCore, CreatePool and verification (scripts ready, dry-run on a fork). Record addresses in DEPLOYMENTS.md | Owners decide 0043 and 0049. Freeze and commit E3/E4, re-key the cached Pyth data, resume the download. Run the keeper and indexer on the testnet pool |
| B. Quote integrity | M7: `previewDeposit`, `GuardedRouter`, the `HookSwap` rule, and E12's first check fuzzed | E3/E4 runs when the data is complete. E9 pre-registration and weekend data for a stock-token pool |
| C. Closed market on testnet | Calendar deployment and a closure pool (a stock-token stand-in with a Pyth equity feed); settle a weekend record at a Monday open | E9 run, which decides whether closed-market mode stays. Read-only dashboard and demo bots |
| D. Release blockers | Coverage to 95% lines and branches; settlement and expiry gas against an approved baseline; swap-path gas targets | E5 and E6 simulations; results write-up with every window |
| E. Licence | M9: `LicenceAuction`, the hook's fast path, the Settler's band regime, invariants I11 to I13 | E10 simulation, holder and bidder bots, the licence page |
| F. Hardening and release | M10: lens, Base Sepolia; M12: the twelve audit passes | M11: E7, E8, E11, E12 and bytecode replay; lessons for every component |

Phases A and B run in parallel. C needs A. D can start any time. E needs A and B. F needs everything before it.

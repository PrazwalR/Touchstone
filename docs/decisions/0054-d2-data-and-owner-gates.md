# 0054 D2 data and owner gates

Date: 1 November 2026.

- The owner explicitly requested **skip E9 for now**. Do not download stock-token data or produce an E9 pass/kill result. This does not establish closed-market economics and does not remove implemented calendar support.
- The owner selected a **keeper startup runbook for the other developer**, whose machine holds the existing cast wallet. Do not create a replacement signing identity or claim the keeper is running locally. The public deployment addresses already exist in the repo.
- E3/E4 retain their existing formulas and thresholds under 0052 and are renewed in a standalone freeze commit. Their raw inputs and 12,100 legacy cache timestamps are not present locally. A cache migration requires source hashes and feed provenance, not filenames alone.
- E5/E6 now have explicit sensitivity-model code and draft preregistrations. Their tapes, configurations and hashes must be registered before a run. They are not finished experiments or a release-gate pass. In particular detection-only padding does not prove settlement-margin resistance.
- E10, licence bots and the licence dashboard depend on D1's M9 contract; no fake lease state or placeholder auction is introduced. E11 needs measured in-range concentration and owner decisions on profitable self-wash pools. E7 needs reproducible baseline definitions/data, E8 needs real end-to-end engineering evidence, and E12 needs quote/fork samples rather than fabricated percentages.
- The sibling `../Vane/sim` referenced in the track is absent from this workspace, and `sim/` contains only a README. Bytecode replay cannot be honestly described as an adaptation yet. Options: provide the versioned VANE source for a licence/dependency review, or register a separate minimal revm runner against pinned dependencies before replacing that plan.

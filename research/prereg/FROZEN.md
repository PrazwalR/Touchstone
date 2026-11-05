# Freeze ledger

The initial entries below were recorded locally before repository history existed (decision 0020). They are retained as historical provenance; Git history now exists. Renewed freezes below are committed separately after their analysis code and before local historical data access.

| File | SHA-256 | Frozen (UTC) | Analysis code SHA-256 |
| --- | --- | --- | --- |
| E1.md | 2c68d43d252da12790e5d1efc8524be325d5c6a48e51c9b263f2ede30e86e81a | 2026-10-27T18:48:43Z | 40041d0c9d7e078aacce4a1aeee36135bc6fe385304b6db08d36b08135de64c6 |
| E2.md | 148795c21609f8d526429b8de49ed1ba588dd852d7b5e1036ff6f130d3bdaf1a | 2026-10-27T18:48:43Z | 40041d0c9d7e078aacce4a1aeee36135bc6fe385304b6db08d36b08135de64c6 |
| E3.md | deb8b2639595a5594fd086feb5d388b0facc3420fd2403003fac6aca0d134696 | 2026-10-28T17:18:42Z | cb29e86b5b0484b4e269b4660c2082e0227cf896f7859276a7bb7ebe6cfce569 (E3/E4 file set, experiments/e34_common.py) |
| E4.md | 4ec01c5a6e3b91769d1c878424aa02385486d8dc62273f244b784225b35e6eb4 | 2026-10-28T17:18:42Z | cb29e86b5b0484b4e269b4660c2082e0227cf896f7859276a7bb7ebe6cfce569 (E3/E4 file set) |

Data downloads for the E1 and E2 window started after these rows were written.
The Pyth download for E3 and E4 (held-out window only) started after the E3 and E4 rows were written.

Amendment, 2026-10-28T17:21:30Z: one line of research/tsr/settle.py (in the E3/E4 file set) was changed so the port's bound on
the in-the-money leg rounds exactly as the contract's ItmLib.bounded (a floored comparison instead of an exact
one). The download was in progress and none of its output had been read. E3/E4 analysis code SHA-256 from this
point: d659de1c867735704ab4a158c1549c0f77b68b34e6cd97e62fe7608246f70ac8. results/E3.json and E4.json carry the hash they ran under.

Amendment, 2026-10-28T17:34:59Z: research/tsr/hermes.py (download client only) was changed to pace Hermes better (gentler
back-off on 429, 100-time chunks, progress logging). It decides how the Pyth data is fetched, not what is
analysed; the first download attempt had written no chunk and nothing had been read. E3/E4 analysis code SHA-256
from this point: 283dbd82276cefee6d3a7bcfae13d63a8c01d2967ee78ea2bb7aafe0133a80de.

Superseded, 31 October 2026: the E3 and E4 rows and amendments above no longer match the analysis code, which
the repair of 30 October changed (decision 0046) and the merge of 31 October reconciled (decision 0049). E3 and
E4 are drafts again until the owners freeze them in a commit. Under the stale freeze, 12,100 of the 44,476
requested Pyth times were downloaded to research/data/cache/pyth; none of that data has been read.

## Runs

| Experiment | Run (UTC) | Result | Verdict |
| --- | --- | --- | --- |
| E1 | 2026-10-28 | results/E1.json | descriptive; selected (5,000, 50,000, 6, 2) |
| E2 | 2026-10-28 | results/E2.json | pass (G1 met on Ethereum), with the caveats in results/README.md |

## Renewed E3/E4 freeze, 1 November 2026

Owner decision 0052 preserves formulas and explicitly accepts the disclosed approximate-replay scope. Analysis and cache-migration code were committed in `02e29dc` before these renewed preregistrations. No dataset or legacy chunk exists locally; no migration or download is claimed. The existing E3 disclosure is unchanged.

| File | SHA-256 | Frozen (UTC) | Analysis code SHA-256 |
| --- | --- | --- | --- |
| E3.md | ed394863b66b982e565cb036b0b3342892391e5b83cd363b013025ead49901c3 | 2026-11-01T18:08:15+00:00 | 5e53b1b5cc17984c74877d61867ba1635c753c9bdcafd322cac2da75d2590726 |
| E4.md | 21e65c2ef5dde267e78ef2bd7522b034ed9e7b024e782cbf62455a0a72421dbd | 2026-11-01T18:08:15+00:00 | 5e53b1b5cc17984c74877d61867ba1635c753c9bdcafd322cac2da75d2590726 |

Prospective cache migration: `experiments.rekey_pyth` is part of this analysis hash. It requires a source-manifest attesting feed IDs and chunk hashes; validates the current timestamp partition and row ranges; preserves original chunks; refuses conflicting targets; and writes a receipt. Append that receipt and its hash only after the migration actually runs. No held-out metric is evaluated during migration.

## E5/E6 sensitivity simulations

Analysis and sensitivity grids committed in `584628a`. Input identity comes from the published E2 hashes.

| File | SHA-256 | Frozen (UTC) | Analysis code SHA-256 |
| --- | --- | --- | --- |
| E5.md | 7fb7db7aae565b11f8f5858009f65b77f044937cc417abc83f2857ec9d02c9c1 | 2026-11-03T17:41:15+00:00 (amended 2026-11-06T00:00:00Z) | 6557132480a90ccc7fd7c6c4c92f7c28dd119ee5afe6d7d7f98f9625987c82d8 |
| E6.md | 96be564c3ac92e5b8aafffb18ff7413d9f3ec0797583ddcf55e160ce2b872967 | 2026-11-03T17:41:15+00:00 (amended 2026-11-06T00:00:00Z) | 6557132480a90ccc7fd7c6c4c92f7c28dd119ee5afe6d7d7f98f9625987c82d8 |

This table always shows the file as currently committed. The original frozen hashes, before the amendment below,
were E5.md `93f974180c06e79f446ddf8ce331f2cda19375f594d6671d1e704fa8c1954d17` and E6.md
`36cd1a109596b725a229ef435a38597d1d54f0eef8d61f859743c0dcfd380a1c`, both under analysis code
`1a461bdcc036e0e9892ce5c65b9bbc902590a523ceb04155285a6cde8cd7c6a2`.

Run on 3 November 2026 UTC: E6, `results/E6.json`, simulation, under the original code above. Each of the 21
registered cases hit the kill line in both windows. The original normalization manifest is
`results/E6.manifest.json`. E5 had not run.

Amendment, 2026-11-06T00:00:00Z: the first attempt to prepare E5's input tape (`experiments.prepare_behaviour E5`)
failed `simulations.evasion.flags`'s ordering guard. Inspection (no experiment metric was read; only the raw
rejected tape's own fields were examined) found 6 of 393,551 rows with notional 0, not a timestamp or block
ordering fault. Looking up two of the six by transaction hash against the raw swap log showed one Ethereum
Uniswap V3 swap where the quote-token leg visibly transferred (for example $212.34 of USDC) while the
risky-token leg's integer delta rounded to exactly zero and the pool's tick was unchanged before and after a
textbook signature of a swap too small to move an extremely deep concentrated-liquidity position by even one
wei of the other side, not a parsing fault. `experiments/prepare_behaviour.py`'s `e5_rows` was changed to
exclude rows with notional at or below zero, with a guard refusing the exclusion if it ever exceeds 0.1% of
the tape. These rows carry zero toxic weight by construction and cannot be classified as buy or sell exposure
under the registered trigger; excluding them is a data-normalization fix, not a change to the registered
thresholds, trigger formula, windows, or kill line, all of which are unchanged. No E5 experiment metric
existed before this fix. E6 had already run on 3 November under the original code hash (see above). `prereg/E5.md` and `prereg/E6.md` (which share the same hashed file set) were updated
in place to the new analysis code hash; their current hashes are in the table above. `results/E6.json` is
unaffected and keeps the hash it ran under; it is not rerun.

Run on 6 November 2026 UTC: E5, `results/E5.json`, simulation, under the corrected code above. No scenario is
below r* under the literal registered rule (r* is negative on this window); heavy splitting (pieces under a
tenth of N_min, any delay) still drops held-out recall to 9.74%-11.15%. See `results/README.md` for the full
table and the caveat.

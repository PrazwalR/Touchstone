# 0038 Hermes client contract

Status: decided.

- The API-key header name is configuration (`HERMES_API_KEY_HEADER`), not a literal, because it was not
  verifiable from this environment: Hermes returned 401 without a key on 28 October 2026 and the docs are behind
  the same change.
- Responses are validated with zod, and fields the keeper does not read are stripped rather than rejected
  (§0.7 says reject unknown fields). Hermes adds fields over time, and rejecting them would stop settlement; the
  fields the keeper uses are all checked, and the blob itself is verified on chain by Pyth.
- 404, 429 and 5xx are retried until the record's latest usable time; 401 and malformed responses are errors.
- The parsed price is used only to check the publish time and to value a tip against gas, never as an amount.

Update, 28 October 2026, with a key in hand: `hermes.pyth.network` accepts the key as
`Authorization: Bearer <key>` and rejects it as `x-api-key` (401). `HERMES_API_KEY_HEADER=Authorization` and the
key value carries the `Bearer ` scheme, so the client needs no change. A live check of `firstAtOrAfter` for
ETH/USD and USDC/USD a week back returned updates published at exactly the requested second, 631-byte blobs.

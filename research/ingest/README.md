# Ingest

Swap and liquidity logs over RPC (Ethereum, Arbitrum, Base), Binance 1-second klines, Pyth history from Hermes'
timestamp endpoint, and Chainlink `AnswerUpdated` logs (spec §16.2). The first pass reuses Assay's
`calibration/fetch_data.py`; every dataset written here records its source, range and SHA-256.

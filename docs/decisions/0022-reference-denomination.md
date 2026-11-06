# 0022 The reference feed is read in quote units

Status: decided; implementation detail under §0.11.

`ReferenceLib.readX36` converts the Chainlink answer to quote base units per risky base unit as
answer x 10^(36 + decQuote - decRisky - feedDecimals). That treats the feed's denomination (USD for ETH/USD) as
the quote token. For a USDC-quoted pool the error is USDC's deviation from USD; it is not bounded to a few basis points
during a depeg. It affects both drift flagging and the gap-based deposit rate (and therefore the cap on
possible retention), although settlement fair value comes from Pyth and risky conversion uses execution receipts. A pool whose quote token does not
track the feed's denomination must set `referenceFeed` to zero (drift off) or use a feed denominated in its quote.

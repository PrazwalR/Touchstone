-- Raw events, keyed by (chain, tx hash, log index) and written idempotently (spec §15.2).
CREATE TABLE IF NOT EXISTS events (
  chain        TEXT    NOT NULL,
  tx_hash      TEXT    NOT NULL,
  log_index    INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  contract     TEXT    NOT NULL,
  name         TEXT    NOT NULL,
  args_json    TEXT    NOT NULL,
  PRIMARY KEY (chain, tx_hash, log_index)
);

-- One row per record; status moves open -> settled | expired, deferred refunds flagged separately.
CREATE TABLE IF NOT EXISTS records (
  chain        TEXT    NOT NULL,
  pool_id      TEXT    NOT NULL,
  record_id    TEXT    NOT NULL,
  opened_block INTEGER NOT NULL,
  deposit      TEXT    NOT NULL,
  deposit_in0  INTEGER NOT NULL,
  beneficiary  TEXT    NOT NULL,
  status       TEXT    NOT NULL CHECK (status IN ('open', 'settled', 'expired')),
  refund_deferred INTEGER NOT NULL DEFAULT 0,
  closed_block INTEGER,
  PRIMARY KEY (chain, pool_id, record_id)
);

-- Touchstone pools, from the factory's PoolRegistered; PoolManager events are read only for these ids.
CREATE TABLE IF NOT EXISTS pools (
  chain            TEXT    NOT NULL,
  pool_id          TEXT    NOT NULL,
  registered_block INTEGER NOT NULL,
  PRIMARY KEY (chain, pool_id)
);

-- Where indexing resumes, and the hash of the last block indexed, to detect a reorg below the confirmation depth.
CREATE TABLE IF NOT EXISTS cursors (
  chain      TEXT PRIMARY KEY,
  next_block INTEGER NOT NULL,
  last_hash  TEXT    NOT NULL
);

-- Confirmed closure-block headers support measured settlement lag; rewound with event history.
CREATE TABLE IF NOT EXISTS blocks (
  chain TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  block_hash TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  PRIMARY KEY (chain, block_number)
);
CREATE INDEX IF NOT EXISTS events_history ON events (chain, name, block_number, log_index);

CREATE INDEX IF NOT EXISTS records_status ON records (chain, status, closed_block);
CREATE INDEX IF NOT EXISTS records_deferred ON records (chain, refund_deferred);
CREATE INDEX IF NOT EXISTS events_record ON events (chain, name, lower(json_extract(args_json, '$.id')), CAST(json_extract(args_json, '$.recordId') AS TEXT));
CREATE INDEX IF NOT EXISTS events_recipient ON events (chain, name, lower(json_extract(args_json, '$.recipient')), block_number, log_index);

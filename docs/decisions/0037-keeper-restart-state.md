# 0037 The keeper restarts from its own state file

Status: decided; implementation detail.

Spec §15.1 step 1 backfills from the indexer on restart. The M5 keeper instead persists its log cursor and open
records to `KEEPER_STATE_PATH` (atomic rename on every tick) and re-checks each record's hash on chain before
acting, so a record someone else settled while the keeper was down is dropped. This keeps the keeper runnable
without the indexer; a third party running only the keeper needs nothing else. If the state file is lost, the
keeper rescans from `KEEPER_START_BLOCK`, which is safe because ingestion is idempotent.

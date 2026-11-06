import { logger, loadEnv } from "@touchstone/shared";
import { apiEnvSchema, historyServer } from "./api.ts";
import { History } from "./history.ts";

const cfg = loadEnv(apiEnvSchema);
const history = new History(cfg.INDEXER_DATABASE_PATH, cfg.INDEXER_CHAIN);
const server = historyServer(history, cfg);
const log = logger("history-api");
server.on("error", () => {
  log.error("history API listener failed");
  history.close();
  process.exitCode = 1;
});
server.listen(cfg.INDEXER_API_PORT, cfg.INDEXER_API_HOST, () =>
  log.info("history API started", {
    host: cfg.INDEXER_API_HOST,
    port: cfg.INDEXER_API_PORT,
  }),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => server.close(() => history.close()));

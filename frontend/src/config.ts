// Build-time settings. Every value ships in the public bundle, so nothing here may be a secret (spec §0.7).
import { z } from "zod";
import { deployment } from "./chain/deployment.ts";

const blankToUndefined = (v: unknown) => (v === "" ? undefined : v);

const Env = z.object({
  VITE_HISTORY_URL: z.preprocess(blankToUndefined, z.url().refine((u) => /^https?:/.test(u)).optional()),
  VITE_RPC_URL: z.preprocess(blankToUndefined, z.url().refine((u) => u.startsWith("https://"), "https only").optional()),
  VITE_POLL_SECONDS: z.preprocess(blankToUndefined, z.coerce.number().int().min(5).max(600).optional()),
});

const env = Env.parse({ VITE_HISTORY_URL: import.meta.env.VITE_HISTORY_URL, VITE_RPC_URL: import.meta.env.VITE_RPC_URL, VITE_POLL_SECONDS: import.meta.env.VITE_POLL_SECONDS });

/** The read RPC: an explicit override, else the chain's public endpoint from the deployment. */
export const RPC_URL: string = env.VITE_RPC_URL ?? deployment.publicRpc;
/** Live-read interval. */
export const POLL_MS: number = (env.VITE_POLL_SECONDS ?? 15) * 1000;
/** Event history is heavier than state, so it refreshes on every fourth poll. */
export const EVENTS_EVERY = 4;
/** Rows shown in the record table. */
export const EVENT_ROWS = 12;

/** Public read-only indexer API; unset means history is explicitly unavailable. */
export const HISTORY_URL: string | undefined = env.VITE_HISTORY_URL;

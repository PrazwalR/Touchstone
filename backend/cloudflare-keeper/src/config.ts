import { z } from "zod";
import { keeperEnvSchema } from "../../keeper/src/config.ts";

export interface Env extends Record<string, unknown> {
  KEEPER: DurableObjectNamespace;
  KEEPER_PRIVATE_KEY?: string;
  ADMIN_TOKEN?: string;
}

export function configuration(env: Env) {
  // These paths satisfy the shared validator; Cloudflare never reads local files.
  const keeper = keeperEnvSchema.parse({ ...env,
    KEEPER_KEYSTORE_PATH: "cloudflare-secret", KEEPER_KEYSTORE_PASSWORD_FILE: "cloudflare-secret",
    KEEPER_STATE_PATH: "durable-object-storage",
  });
  const cf = z.object({
    KEEPER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    KEEPER_EXPECTED_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    ADMIN_TOKEN: z.string().min(32),
    CF_IDLE_POLL_MS: z.coerce.number().int().min(10000),
    CF_ACTIVE_POLL_MS: z.coerce.number().int().min(3000),
    CF_ERROR_POLL_MS: z.coerce.number().int().min(10000),
    CF_HOUSEKEEPING: z.enum(["true", "false"]).transform(v => v === "true"),
  }).parse(env);
  return { keeper, cf };
}

// Errors from providers can contain credential-bearing URLs. Do not store or log raw messages.
export function failureCode(error: unknown): string {
  if (error instanceof z.ZodError) return "invalid_configuration";
  if (error instanceof Error && ["signer_mismatch", "deployment_wiring_invalid", "deployment_changed_use_new_worker_namespace"].includes(error.message)) return error.message;
  return "keeper_tick_failed";
}

export function safeErrorDetail(detail: string, env: Record<string, unknown>): string {
  let result = detail;
  const secrets = Object.values(env).filter((v): v is string => typeof v === "string" && v.length >= 6)
    .flatMap(v => /^Bearer\s+/i.test(v) ? [v, v.replace(/^Bearer\s+/i, "")] : [v]).sort((a, b) => b.length - a.length);
  for (const secret of secrets) result = result.split(secret).join("[redacted]");
  return result.replace(/https?:\/\/[^\s"'<>]+/g, "[url]").replace(/0x[0-9a-fA-F]{64}/g, "[hex]").slice(0, 300);
}

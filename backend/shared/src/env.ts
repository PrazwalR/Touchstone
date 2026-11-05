import { z } from "zod";

/** Parses `source` with `schema` once at startup and fails fast with every problem listed. */
export function loadEnv<T extends z.ZodType>(schema: T, source: NodeJS.ProcessEnv = process.env): z.infer<T> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid environment: ${problems}`);
  }
  return parsed.data;
}

export const httpUrl = z.url({ protocol: /^https?$/ });
export const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 20-byte hex address");
export const positiveInt = z.coerce.number().int().positive();
export const boolFlag = z.enum(["true", "false"]).transform((v) => v === "true");

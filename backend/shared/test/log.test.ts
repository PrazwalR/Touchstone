import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../src/log.ts";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe("structured log redaction", () => {
  it("redacts configured credentials inside messages, URLs and nested fields", () => {
    const secret = "fixture-credential-123";
    vi.stubEnv("HERMES_API_KEY", `Bearer ${secret}`);
    vi.stubEnv("TEST_API_KEY", "short6");
    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      output.push(String(chunk));
      return true;
    });
    logger("keeper").error(`request denied with Bearer ${secret}`, {
      error: `at https://provider.example/v3/${secret}`,
      nested: {
        headers: { authorization: `Bearer ${secret}` },
        messages: [secret, "short6"],
        balance: 10n ** 25n,
      },
    });
    expect(output.join("")).not.toContain(secret);
    expect(output.join("")).not.toContain("short6");
    const body = JSON.parse(output[0]!);
    expect(body.error).toBe("at [redacted URL]");
    expect(body.nested.balance).toBe((10n ** 25n).toString());
    expect(body.nested.headers.authorization).toBe("[redacted]");
  });
  it("handles cyclic fields and prevents overriding trusted log metadata", () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      output.push(String(chunk));
      return true;
    });
    const fields: Record<string, unknown> = { level: "fake", msg: "fake" };
    fields.self = fields;
    logger("api").info("started", fields);
    expect(JSON.parse(output[0]!)).toMatchObject({
      level: "info",
      msg: "started",
      self: "[redacted]",
    });
  });
});

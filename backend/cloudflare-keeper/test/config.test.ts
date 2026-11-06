import { it, expect } from "vitest";
import { safeErrorDetail } from "../src/config.ts";

it("redacts credentials and provider URLs from persisted diagnostics", () => {
  const key = `0x${"ab".repeat(32)}`;
  const detail = `request failed: https://provider.test/key/secret-value Bearer abcdefghij abcdefghij ${key}`;
  const scrubbed = safeErrorDetail(detail, { HERMES_API_KEY: "Bearer abcdefghij", KEEPER_PRIVATE_KEY: key });
  expect(scrubbed).not.toContain("abcdefghij"); expect(scrubbed).not.toContain("secret-value");
  expect(scrubbed).not.toContain(key); expect(scrubbed).toContain("request failed:");
});

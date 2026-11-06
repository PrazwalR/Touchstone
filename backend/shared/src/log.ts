const SECRET_KEYS =
  /key|secret|password|token|private|authorization|credential/i;
const MIN_SECRET_LENGTH = 1;
const MAX_LOG_DEPTH = 8;
const MAX_LOG_TEXT = 2048;
const REDACTED = "[redacted]";
type Fields = Record<string, unknown>;

function scrub(text: string, secrets: string[]): string {
  // Provider credentials often live in URL paths, not in a field named 'key'.
  let safe = text.replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted URL]");
  for (const secret of secrets) safe = safe.split(secret).join(REDACTED);
  return safe.slice(0, MAX_LOG_TEXT);
}

function redact(
  value: unknown,
  secrets: string[],
  seen: WeakSet<object>,
  depth = 0,
): unknown {
  if (typeof value === "string") return scrub(value, secrets);
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_LOG_DEPTH || seen.has(value)) return REDACTED;
  seen.add(value);
  if (Array.isArray(value))
    return value.map((v: unknown) => redact(v, secrets, seen, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      SECRET_KEYS.test(k) ? REDACTED : redact(v, secrets, seen, depth + 1),
    ]),
  );
}

/** Structured logs mask nested credentials, configured secret values and provider URLs. */
export function logger(service: string) {
  const emit = (
    level: "info" | "warn" | "error",
    msg: string,
    fields: Fields = {},
  ) => {
    const secrets = Object.entries(process.env)
      .filter(
        (entry): entry is [string, string] => {
          const [name, value] = entry;
          return (
            SECRET_KEYS.test(name) &&
            !name.endsWith("_HEADER") &&
            typeof value === "string" &&
            value.length >= MIN_SECRET_LENGTH
          );
        },
      )
      .flatMap(([, value]) => {
        const v = value!;
        return /^Bearer\s+/i.test(v) ? [v, v.replace(/^Bearer\s+/i, "")] : [v];
      })
      .filter((v) => v.length > 0)
      .sort((a, b) => b.length - a.length);
    const safe = redact(fields, secrets, new WeakSet()) as Fields;
    process.stdout.write(
      `${JSON.stringify({
        ...safe,
        t: new Date().toISOString(),
        level,
        service: scrub(service, secrets),
        msg: scrub(msg, secrets),
      })}\n`,
    );
  };
  return {
    info: (msg: string, fields?: Fields) => emit("info", msg, fields),
    warn: (msg: string, fields?: Fields) => emit("warn", msg, fields),
    error: (msg: string, fields?: Fields) => emit("error", msg, fields),
  };
}

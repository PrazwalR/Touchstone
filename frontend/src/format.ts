// Display formatting. Every amount stays a bigint until this point.

/** Quote base units with 6 decimals as dollars, two places. */
export function usd(v: bigint): string {
  const n = Number(v) / 1e6;
  return `${n < 0 ? "−$" : "$"}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A token amount in base units, with a fixed number of places shown. */
export function units(v: bigint, decimals: number, places = 4): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = a / base;
  const frac = (a % base).toString().padStart(decimals, "0").slice(0, places);
  const body = places > 0 ? `${whole.toLocaleString("en-US")}.${frac}` : whole.toLocaleString("en-US");
  return `${neg ? "−" : ""}${body}`;
}

export function int(v: bigint | number): string {
  return v.toLocaleString("en-US");
}

export function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** A UTC timestamp, minute precision, for on-chain times. */
export function utc(seconds: bigint | number): string {
  const d = new Date(Number(seconds) * 1000);
  return `${d.toLocaleString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} UTC`;
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

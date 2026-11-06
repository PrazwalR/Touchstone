// Polls the testnet while the page is visible. Errors are shown as errors; stale data stays labelled stale.
import { useEffect, useRef, useState } from "react";
import { EVENTS_EVERY, POLL_MS, HISTORY_URL } from "../config.ts";
import { checkChain, readEvents, readSnapshot, type RecordEvent, type Snapshot } from "./reads.ts";

export interface Live {
  snapshot: Snapshot | null;
  events: RecordEvent[] | null;
  eventsError: string | null;
  readAt: number | null;
  error: string | null;
  loading: boolean;
}

function message(e: unknown): string {
  // viem errors carry a short message first and request details after; only the short form is shown.
  const m = e instanceof Error ? (("shortMessage" in e && typeof e.shortMessage === "string" ? e.shortMessage : e.message) || "read failed") : "read failed";
  return m.split("\n")[0].slice(0, 160);
}

export function useLive(enabled: boolean): Live {
  const [live, setLive] = useState<Live>({ snapshot: null, events: null, eventsError: null, readAt: null, error: null, loading: true });
  const tick = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let chainChecked = false;

    const run = async () => {
      if (document.visibilityState === "hidden") {
        timer = setTimeout(run, POLL_MS);
        return;
      }
      try {
        if (!chainChecked) {
          await checkChain();
          chainChecked = true;
        }
        const withEvents = !HISTORY_URL && tick.current % EVENTS_EVERY === 0;
        // A failed event read keeps the last history and reports itself; it never blanks the state read.
        const [snapshot, events] = await Promise.all([
          readSnapshot(),
          withEvents ? readEvents().then((ev) => ({ ev, err: null }), (e: unknown) => ({ ev: null, err: message(e) })) : Promise.resolve({ ev: null, err: null }),
        ]);
        tick.current += 1;
        if (!cancelled) {
          setLive((prev) => ({ snapshot, events: events.ev ?? prev.events, eventsError: events.err ?? (withEvents ? null : prev.eventsError), readAt: Date.now(), error: null, loading: false }));
        }
      } catch (e) {
        if (!cancelled) setLive((prev) => ({ ...prev, error: message(e), loading: false }));
      }
      if (!cancelled) timer = setTimeout(run, POLL_MS);
    };
    void run();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        void run();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);

  return live;
}

export { message as errorMessage };

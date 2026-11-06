// Hash routes for the four views. "#/swap" names a view; any other hash ("#mechanism") is an anchor inside
// Overview, so the narrative's existing in-page links keep working.
import { useEffect, useState } from "react";

export type View = "overview" | "swap" | "simulation" | "docs";

export const VIEWS: [View, string][] = [
  ["overview", "Overview"],
  ["swap", "Swap"],
  ["simulation", "Simulation"],
  ["docs", "Docs"],
];

export interface Route {
  view: View;
  /** The rest of a view route, for Docs ("#/docs/lessons/03"), or the Overview anchor. */
  rest: string;
}

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#/, "");
  if (h.startsWith("/")) {
    const [view, ...rest] = h.slice(1).split("/");
    const found = VIEWS.find(([v]) => v === view);
    if (found) return { view: found[0], rest: rest.join("/") };
  }
  return { view: "overview", rest: h };
}

export const href = (view: View, rest = ""): string => `#/${view}${rest ? `/${rest}` : ""}`;

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

import { lazy, Suspense, useEffect, useState } from "react";
import { useLive } from "./chain/useLive.ts";
import { useMotion } from "./hooks/useMotion.ts";
import { useRoute } from "./router.ts";
import { Nav } from "./sections/Nav.tsx";
import { OverviewView } from "./views/OverviewView.tsx";

// The three working views load on first visit, so the Overview does not ship transaction or docs code.
const SwapView = lazy(() =>
  import("./views/SwapView.tsx").then((m) => ({ default: m.SwapView })),
);
const SimulationView = lazy(() =>
  import("./views/SimulationView.tsx").then((m) => ({
    default: m.SimulationView,
  })),
);
const DocsView = lazy(() =>
  import("./views/DocsView.tsx").then((m) => ({ default: m.DocsView })),
);
import { WalletProvider } from "./wallet/WalletContext.tsx";

/** Re-renders once a second so "read N s ago" stays true. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function App() {
  const route = useRoute();
  const motion = useMotion();
  const live = useLive(true);
  const now = useNow();
  const [marks, setMarks] = useState(0);
  // A new view starts at its top; Overview anchors scroll themselves.
  useEffect(() => {
    if (route.view !== "overview" || !route.rest) window.scrollTo(0, 0);
  }, [route.view, route.rest]);

  return (
    <WalletProvider>
      <div className="ts">
        <a className="skip" href="#main">
          Skip to the content
        </a>
        <Nav view={route.view} />
        <main id="main">
          {route.view === "overview" && (
            <OverviewView
              live={live}
              motion={motion}
              onMarks={setMarks}
              marks={marks}
              anchor={route.rest}
            />
          )}
          <Suspense fallback={<p className="wrap empty view">Loading…</p>}>
            {route.view === "swap" && <SwapView live={live} now={now} />}
            {route.view === "simulation" && <SimulationView live={live} />}
            {route.view === "docs" && <DocsView rest={route.rest} />}
          </Suspense>
        </main>
      </div>
    </WalletProvider>
  );
}

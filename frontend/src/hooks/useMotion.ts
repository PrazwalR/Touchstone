// Cinematic or still. The page is still under reduced motion, and on very tall viewports where the scroll
// theatre would not fit its track.
import { useEffect, useState } from "react";

const TALL_VIEWPORT = 1500;

export interface Motion {
  /** Scroll theatre and animated stages. */
  cine: boolean;
  reduced: boolean;
  viewportH: number;
}

function read(mq: MediaQueryList | null): Motion {
  const reduced = mq?.matches ?? false;
  const viewportH = window.innerHeight;
  return { cine: !reduced && viewportH <= TALL_VIEWPORT, reduced, viewportH };
}

export function useMotion(): Motion {
  const [m, setM] = useState<Motion>(() => read(window.matchMedia("(prefers-reduced-motion: reduce)")));
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setM(read(mq));
    window.addEventListener("resize", update);
    mq.addEventListener("change", update);
    return () => {
      window.removeEventListener("resize", update);
      mq.removeEventListener("change", update);
    };
  }, []);
  return m;
}

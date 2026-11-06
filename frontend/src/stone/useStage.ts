// Binds a canvas to the shared engine for the lifetime of a component.
import { useEffect, useRef, type RefObject } from "react";
import { engine, type Stage, type StageDef } from "./engine.ts";

/**
 * Registers `def` on the canvas while it is mounted. The definition is read once; scenes read changing
 * inputs through refs and call `redraw` when they change.
 */
export function useStage(canvas: RefObject<HTMLCanvasElement | null>, def: StageDef, animating: boolean): RefObject<Stage | null> {
  const stage = useRef<Stage | null>(null);
  const defRef = useRef(def);
  const animRef = useRef(animating);
  animRef.current = animating;

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const eng = engine();
    const s = eng.add(el, defRef.current, animRef.current && !defRef.current.fixed);
    stage.current = s;
    return () => {
      eng.remove(s);
      stage.current = null;
    };
  }, [canvas]);

  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    s.animating = animating && !s.fixed;
    s.dirty = true;
    engine().kick();
  }, [animating]);

  return stage;
}

/** Marks a stage for one more frame. */
export function redraw(stage: RefObject<Stage | null>): void {
  if (!stage.current) return;
  stage.current.dirty = true;
  engine().kick();
}

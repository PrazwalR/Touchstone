import type { Project, V2 } from "./engine.ts";

type Box = { x: number; y: number; w: number; h: number };
type Layout = { boxes: Box[]; top: number; bottom: number };
const placed = new WeakMap<CanvasRenderingContext2D, Layout>();
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

export interface TagOptions {
  alpha?: number;
  dot?: string | null;
  color?: string | null;
}

export function beginAnnotations(
  ctx: CanvasRenderingContext2D,
  insets: { top?: number; bottom?: number } = {},
): void {
  placed.set(ctx, {
    boxes: [],
    top: insets.top ?? 12,
    bottom: insets.bottom ?? 12,
  });
}

/** Screen-space annotations stay readable as the camera and render quality change. */
export function tag(
  ctx: CanvasRenderingContext2D,
  pt: ReturnType<Project>,
  dx: number,
  dy: number,
  text: string,
  opts: TagOptions = {},
): void {
  if (!pt || (opts.alpha ?? 1) <= 0.01) return;
  const transform = ctx.getTransform();
  const width = ctx.canvas.width / transform.a;
  const height = ctx.canvas.height / transform.d;
  const narrow = width < 600;
  const fontSize = narrow ? 13 : 14;
  const lineHeight = 20;
  const pad = 12;
  const dotWidth = opts.dot ? 14 : 0;
  const margin = 12;
  const layout = placed.get(ctx) ?? { boxes: [], top: margin, bottom: margin };
  const anchor: V2 = [
    clamp(pt[0], margin, width - margin),
    clamp(pt[1], layout.top, height - layout.bottom),
  ];
  ctx.save();
  ctx.font = `500 ${fontSize}px "Geist Variable", "Geist", system-ui, sans-serif`;
  ctx.letterSpacing = "0px";
  const maxTextWidth = Math.min(
    narrow ? 224 : 278,
    width - margin * 2 - pad * 2 - dotWidth,
  );
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxTextWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  const w =
    Math.max(...lines.map((l) => ctx.measureText(l).width)) +
    pad * 2 +
    dotWidth;
  const h = lines.length * lineHeight + 16;
  const preferredX = dx >= 0 ? anchor[0] + dx + 8 : anchor[0] + dx - w - 8;
  const initial: Box = {
    x: clamp(preferredX, margin, width - w - margin),
    y: clamp(anchor[1] + dy - h / 2, layout.top, height - h - layout.bottom),
    w,
    h,
  };
  const boxes = layout.boxes;
  const overlap = (b: Box) =>
    boxes.some(
      (p) =>
        b.x < p.x + p.w + 8 &&
        b.x + b.w + 8 > p.x &&
        b.y < p.y + p.h + 8 &&
        b.y + b.h + 8 > p.y,
    );
  let box = initial;
  // Try the nearest clear row instead of covering an earlier annotation.
  for (
    let distance = 1;
    overlap(box) && distance <= boxes.length + 1;
    distance++
  ) {
    const below = {
      ...initial,
      y: clamp(
        initial.y + distance * (h + 10),
        layout.top,
        height - h - layout.bottom,
      ),
    };
    const above = {
      ...initial,
      y: clamp(
        initial.y - distance * (h + 10),
        layout.top,
        height - h - layout.bottom,
      ),
    };
    box = !overlap(below) ? below : above;
  }
  boxes.push(box);
  placed.set(ctx, layout);
  const end: V2 = [
    clamp(anchor[0], box.x + 8, box.x + w - 8),
    clamp(anchor[1], box.y, box.y + h),
  ];
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.strokeStyle = "rgba(194,193,203,.65)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(anchor[0], anchor[1]);
  ctx.lineTo(end[0], end[1]);
  ctx.stroke();
  ctx.fillStyle = opts.color ?? "#e8b44a";
  ctx.beginPath();
  ctx.arc(anchor[0], anchor[1], 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = "rgba(0,0,0,.25)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = "rgba(20,20,24,.94)";
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, w, h, 9);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(210,210,220,.19)";
  ctx.stroke();
  if (opts.dot) {
    ctx.fillStyle = opts.dot;
    ctx.beginPath();
    ctx.arc(box.x + pad + 3, box.y + h / 2, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = opts.color ?? "#f4f4f5";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  lines.forEach((label, i) =>
    ctx.fillText(
      label,
      box.x + pad + dotWidth,
      box.y + 8 + lineHeight * (i + 0.5),
    ),
  );
  ctx.restore();
}

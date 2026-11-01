import Konva from "konva";
import type { ShapeTool } from "../types";

export interface Pt {
  x: number;
  y: number;
}
export interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const arrowSize = (width: number) => 10 + width * 3;

/** Sommets d'un triangle dans son cadre : x1, y1, x2, y2, x3, y3. */
export const trianglePoints = (w: number, h: number) => [w / 2, 0, w, h, 0, h];

export function computeShape(shape: ShapeTool, a: Pt, b: Pt, constrain: boolean): Geometry {
  let dx = b.x - a.x;
  let dy = b.y - a.y;

  if (constrain) {
    if (shape === "line" || shape === "arrow") {
      const step = Math.PI / 4;
      const ang = Math.round(Math.atan2(dy, dx) / step) * step;
      const len = Math.hypot(dx, dy);
      dx = Math.cos(ang) * len;
      dy = Math.sin(ang) * len;
    } else {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      dx = (dx < 0 ? -1 : 1) * m;
      dy = (dy < 0 ? -1 : 1) * m;
    }
  }

  if (shape === "line" || shape === "arrow") return { x: a.x, y: a.y, w: dx, h: dy };
  if (shape === "rect")
    return { x: Math.min(a.x, a.x + dx), y: Math.min(a.y, a.y + dy), w: Math.abs(dx), h: Math.abs(dy) };
  return { x: a.x + dx / 2, y: a.y + dy / 2, w: Math.abs(dx), h: Math.abs(dy) }; // ellipse
}

/** Points du triangle de pointe de flèche (pour les vignettes SVG). */
export function arrowHeadPoints(w: number, h: number, size: number): string {
  const a = Math.atan2(h, w);
  const spread = Math.atan(0.5);
  const p1 = [w - size * Math.cos(a - spread), h - size * Math.sin(a - spread)];
  const p2 = [w - size * Math.cos(a + spread), h - size * Math.sin(a + spread)];
  return `${w},${h} ${p1.join(",")} ${p2.join(",")}`;
}

export function createPreviewNode(shape: ShapeTool, color: string, width: number): Konva.Shape {
  const base = { stroke: color, strokeWidth: width, lineCap: "round", lineJoin: "round", listening: false } as const;
  switch (shape) {
    case "line":
      return new Konva.Line({ ...base, points: [0, 0, 0, 0] });
    case "arrow":
      return new Konva.Arrow({
        ...base,
        fill: color,
        points: [0, 0, 0, 0],
        pointerLength: arrowSize(width),
        pointerWidth: arrowSize(width),
      });
    case "rect":
      return new Konva.Rect({ ...base });
    case "ellipse":
      return new Konva.Ellipse({ ...base, radiusX: 0, radiusY: 0 });
  }
}

export function updatePreviewNode(node: Konva.Shape, shape: ShapeTool, g: Geometry) {
  node.position({ x: g.x, y: g.y });
  switch (shape) {
    case "line":
    case "arrow":
      (node as Konva.Line).points([0, 0, g.w, g.h]);
      break;
    case "rect":
      (node as Konva.Rect).size({ width: g.w, height: g.h });
      break;
    case "ellipse":
      (node as Konva.Ellipse).radius({ x: g.w / 2, y: g.h / 2 });
      break;
  }
}

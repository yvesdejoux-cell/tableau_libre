export const PAGE_W = 1920;
export const PAGE_H = 1080;

/** s = échelle page → écran ; (x, y) = position de la page dans le conteneur, en px écran. */
export interface View {
  s: number;
  x: number;
  y: number;
}

/** Vue « ajuster à l'écran » : page entière visible et centrée. */
export function fitView(w: number, h: number): View {
  const s = Math.max(0.05, Math.min(w / PAGE_W, h / PAGE_H));
  return { s, x: (w - PAGE_W * s) / 2, y: (h - PAGE_H * s) / 2 };
}

/** Sur un axe : page centrée si elle tient dans la fenêtre, sinon sans vide sur les bords. */
function clampAxis(pos: number, page: number, view: number): number {
  return page <= view ? (view - page) / 2 : Math.min(0, Math.max(view - page, pos));
}

/** Borne le zoom (de l'ajustement à 10× l'ajustement) et garde la page dans la fenêtre. */
export function clampView(v: View, vw: number, vh: number): View {
  const f = fitView(vw, vh).s;
  const s = Math.min(f * 10, Math.max(f, v.s));
  return { s, x: clampAxis(v.x, PAGE_W * s, vw), y: clampAxis(v.y, PAGE_H * s, vh) };
}

/** Zoom de `factor` en gardant le point écran (cx, cy) fixe. */
export function zoomViewAt(v: View, factor: number, cx: number, cy: number): View {
  const s = v.s * factor;
  const px = (cx - v.x) / v.s;
  const py = (cy - v.y) / v.s;
  return { s, x: cx - px * s, y: cy - py * s };
}

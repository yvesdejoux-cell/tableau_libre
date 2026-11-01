import { useWidgetStore, type Widget } from "../store/useWidgetStore";
import { RULER_H, clamp, rotateVec, toWorld, type Frame } from "./rulerGeometry";
import type { Pt } from "./shapes";

/**
 * Segment guide en coordonnées écran.
 * n = normale unitaire dirigée vers l'extérieur : le stylo s'accroche du côté de n.
 */
export interface Segment {
  a: Pt;
  b: Pt;
  n: Pt;
  snap: number;
}

export const SQUARE_K = { 45: 1, 60: Math.tan(Math.PI / 6) } as const; // hauteur / base
export const PROTRACTOR_STRIP = 40; // bande sous le diamètre (mode 180°)

const SNAP = 28;
const ARM_SNAP = 18;

const seg = (f: Frame, a: Pt, b: Pt, n: Pt, snap = SNAP): Segment => ({
  a: toWorld(f, a),
  b: toWorld(f, b),
  n: rotateVec(f, n),
  snap,
});

export function widgetSegments(w: Widget): Segment[] {
  switch (w.type) {
    case "ruler": {
      const hl = w.length / 2;
      const hh = RULER_H / 2;
      return [
        seg(w, { x: -hl, y: -hh }, { x: hl, y: -hh }, { x: 0, y: -1 }),
        seg(w, { x: -hl, y: hh }, { x: hl, y: hh }, { x: 0, y: 1 }),
      ];
    }

    case "square": {
      const s = w.size;
      const h = s * SQUARE_K[w.variant];
      const len = Math.hypot(s, h);
      return [
        seg(w, { x: 0, y: 0 }, { x: s, y: 0 }, { x: 0, y: 1 }), // base
        seg(w, { x: 0, y: 0 }, { x: 0, y: -h }, { x: -1, y: 0 }), // côté vertical
        seg(w, { x: s, y: 0 }, { x: 0, y: -h }, { x: h / len, y: -s / len }), // hypoténuse
      ];
    }

    case "protractor": {
      const R = w.radius;
      const t = (w.arm * Math.PI) / 180;
      const d = { x: Math.cos(t), y: -Math.sin(t) };
      const tip = { x: R * d.x, y: R * d.y };
      const origin = { x: 0, y: 0 };
      return [
        // Bras de mesure : les deux côtés
        seg(w, origin, tip, { x: -d.y, y: d.x }, ARM_SNAP),
        seg(w, origin, tip, { x: d.y, y: -d.x }, ARM_SNAP),
        // Diamètre, côté intérieur
        seg(w, { x: -R, y: 0 }, { x: R, y: 0 }, { x: 0, y: -1 }),
        // 180° : bord inférieur de la bande ; 360° : diamètre, côté bas
        w.full
          ? seg(w, { x: -R, y: 0 }, { x: R, y: 0 }, { x: 0, y: 1 })
          : seg(w, { x: -R, y: PROTRACTOR_STRIP }, { x: R, y: PROTRACTOR_STRIP }, { x: 0, y: 1 }),
      ];
    }

    default:
      return [];
  }
}

/** Segment guide le plus proche (côté extérieur) du point p, ou null. */
export function findGuide(p: Pt): Segment | null {
  let best: { s: Segment; d: number } | null = null;
  for (const w of useWidgetStore.getState().widgets) {
    for (const s of widgetSegments(w)) {
      const dx = s.b.x - s.a.x;
      const dy = s.b.y - s.a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const rx = p.x - s.a.x;
      const ry = p.y - s.a.y;
      const along = (rx * dx + ry * dy) / len;
      const off = rx * s.n.x + ry * s.n.y;
      if (along < -s.snap || along > len + s.snap) continue;
      if (off < 0 || off > s.snap) continue;
      if (!best || off < best.d) best = { s, d: off };
    }
  }
  return best ? best.s : null;
}

/** Projette p sur le segment (borné), décalé de `offset` vers l'extérieur. */
export function projectOnGuide(s: Segment, p: Pt, offset: number): Pt {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const t = clamp(((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / (dx * dx + dy * dy), 0, 1);
  return { x: s.a.x + dx * t + s.n.x * offset, y: s.a.y + dy * t + s.n.y * offset };
}

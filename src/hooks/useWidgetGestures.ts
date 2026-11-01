import { useRef } from "react";
import { clamp } from "../lib/rulerGeometry";
import type { Pt } from "../lib/shapes";
import { useWidgetStore } from "../store/useWidgetStore";

export interface Pose {
  cx: number;
  cy: number;
  rotation: number;
  size: number;
}

interface Options {
  id: string;
  read: () => Pose | undefined;
  write: (patch: Partial<Pose>) => void;
  minSize: number;
  maxSize: number;
}

type PtrEvt = React.PointerEvent<Element>; // Element : valable pour un <div> comme pour un élément SVG

export function useWidgetGestures(opts: Options) {
  const o = useRef(opts);
  o.current = opts; // toujours les dernières valeurs

  const pts = useRef(new Map<number, Pt>());
  const base = useRef<(Pose & { mid: Pt; angle: number; dist: number }) | null>(null);

  const snapshot = () => {
    const pose = o.current.read();
    const [a, b] = [...pts.current.values()].slice(0, 2);
    if (!pose || !a) {
      base.current = null;
      return;
    }
    base.current = b
      ? {
          ...pose,
          mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          angle: Math.atan2(b.y - a.y, b.x - a.x),
          dist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
        }
      : { ...pose, mid: a, angle: 0, dist: 1 };
  };

  const release = (e: PtrEvt) => {
    pts.current.delete(e.pointerId);
    snapshot(); // repart proprement avec les pointeurs restants
  };

  return {
    onPointerDown: (e: PtrEvt) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      useWidgetStore.getState().bringToFront(o.current.id);
      snapshot();
    },

    onPointerMove: (e: PtrEvt) => {
      const b = base.current;
      if (!b || !pts.current.has(e.pointerId)) return;
      pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [p, q] = [...pts.current.values()].slice(0, 2);
      const maxX = window.innerWidth;
      const maxY = window.innerHeight;

      if (!q) {
        o.current.write({
          cx: clamp(b.cx + p.x - b.mid.x, 0, maxX),
          cy: clamp(b.cy + p.y - b.mid.y, 0, maxY),
        });
        return;
      }

      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      const dTheta = Math.atan2(q.y - p.y, q.x - p.x) - b.angle;
      const dist = Math.hypot(q.x - p.x, q.y - p.y);
      // L'origine du widget tourne autour du point médian des deux doigts
      const vx = b.cx - b.mid.x;
      const vy = b.cy - b.mid.y;

      o.current.write({
        cx: clamp(mid.x + vx * Math.cos(dTheta) - vy * Math.sin(dTheta), 0, maxX),
        cy: clamp(mid.y + vx * Math.sin(dTheta) + vy * Math.cos(dTheta), 0, maxY),
        rotation: b.rotation + (dTheta * 180) / Math.PI,
        size: clamp(b.size * (dist / b.dist), o.current.minSize, o.current.maxSize),
      });
    },

    onPointerUp: release,
    onPointerCancel: release,
  };
}

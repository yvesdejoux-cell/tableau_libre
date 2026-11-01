import type { Pt } from "./shapes";

/** Repère d'un widget : origine (cx, cy) et rotation en degrés (sens horaire). */
export interface Frame {
  cx: number;
  cy: number;
  rotation: number;
}

export const RULER_H = 72;

export const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Aimante l'angle sur les multiples de 45° (à ±3°). */
export function snapAngle(a: number) {
  const n = Math.round(a / 45) * 45;
  return Math.abs(a - n) < 3 ? n : a;
}

export function toLocal(f: Frame, p: Pt): Pt {
  const a = -rad(f.rotation);
  const dx = p.x - f.cx;
  const dy = p.y - f.cy;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}

export function toWorld(f: Frame, l: Pt): Pt {
  const a = rad(f.rotation);
  return { x: f.cx + l.x * Math.cos(a) - l.y * Math.sin(a), y: f.cy + l.x * Math.sin(a) + l.y * Math.cos(a) };
}

/** Tourne un vecteur (sans translation). */
export function rotateVec(f: Frame, v: Pt): Pt {
  const a = rad(f.rotation);
  return { x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) };
}

/**
 * Rotation du widget pour qu'une poignée située (en repère local) en `handleLocal`
 * se retrouve sous le pointeur `p`.
 */
export function rotationFromPoint(f: Frame, p: Pt, handleLocal: Pt): number {
  return deg(Math.atan2(p.y - f.cy, p.x - f.cx)) - deg(Math.atan2(handleLocal.y, handleLocal.x));
}

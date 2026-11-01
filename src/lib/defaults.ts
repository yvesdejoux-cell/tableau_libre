import type { WidthKey } from "../types";

/** Épaisseur « normale » souhaitée, en cm physiques, et bornes d'affichage en px écran. */
const BASE_CM: Record<WidthKey, number> = { pen: 0.15, highlighter: 0.9, eraser: 2.2, shape: 0.15 };
const SCREEN_PX: Record<WidthKey, [number, number]> = {
  pen: [2.5, 8],
  highlighter: [14, 40],
  eraser: [24, 90],
  shape: [2.5, 8],
};
const FACTORS = [0.5, 1, 2, 3.5];

/**
 * Épaisseurs par défaut en pixels de PAGE. On part de la taille physique (px/cm calibré),
 * on la borne en pixels écran, puis on convertit en pixels de page avec l'échelle `scale`.
 */
export function baseWidths(pxPerCm: number, scale: number): Record<WidthKey, number> {
  const out = {} as Record<WidthKey, number>;
  for (const k of Object.keys(BASE_CM) as WidthKey[]) {
    const [lo, hi] = SCREEN_PX[k];
    const screenPx = Math.min(hi, Math.max(lo, BASE_CM[k] * pxPerCm));
    out[k] = Math.max(1, Math.round((screenPx / scale) * 2) / 2); // au demi-pixel de page
  }
  return out;
}

/** Les quatre préréglages proposés dans la barre d'outils. */
export const presets = (base: number): number[] => FACTORS.map((f) => Math.max(1, Math.round(base * f * 2) / 2));

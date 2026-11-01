import { create } from "zustand";
import { nanoid } from "nanoid";

/** 1 cm en pixels CSS à 96 dpi. Valeur par défaut, ajustable par le calibrage. */
export const CM_PX = 96 / 2.54;

const PX_PER_CM_KEY = "iwc.pxPerCm";
const PX_PER_CM_MIN = 15;
const PX_PER_CM_MAX = 200;

function loadPxPerCm(): number {
  try {
    const v = Number(localStorage.getItem(PX_PER_CM_KEY));
    return Number.isFinite(v) && v >= PX_PER_CM_MIN && v <= PX_PER_CM_MAX ? v : CM_PX;
  } catch {
    return CM_PX;
  }
}

interface Base {
  id: string;
  z: number;
}

/** Règle : origine = centre. */
export interface RulerWidget extends Base {
  type: "ruler";
  cx: number;
  cy: number;
  rotation: number;
  length: number;
}

/** Rideau : rectangle en fractions de l'écran (0..1). */
export interface ShadeWidget extends Base {
  type: "shade";
  l: number;
  t: number;
  r: number;
  b: number;
}

/** Rapporteur : origine = sommet (centre de la base). arm = angle du bras, 0° à droite, sens trigonométrique. */
export interface ProtractorWidget extends Base {
  type: "protractor";
  cx: number;
  cy: number;
  rotation: number;
  radius: number;
  full: boolean; // true = 360°, false = 180°
  arm: number;
}

/** Équerre : origine = sommet de l'angle droit. size = longueur de la base. */
export interface SquareWidget extends Base {
  type: "square";
  cx: number;
  cy: number;
  rotation: number;
  size: number;
  variant: 45 | 60;
}

/** Compas : origine = pointe. rotation = direction de la mine. draw = trace pendant la rotation. */
export interface CompassWidget extends Base {
  type: "compass";
  cx: number;
  cy: number;
  rotation: number;
  radius: number;
  draw: boolean;
}

export type Widget = RulerWidget | ShadeWidget | ProtractorWidget | SquareWidget | CompassWidget;

interface WidgetState {
  widgets: Widget[];
  zTop: number;
  pxPerCm: number;

  toggleRuler: () => void;
  toggleShade: () => void;
  toggleProtractor: () => void;
  toggleSquare: () => void;
  toggleCompass: () => void;

  updateRuler: (id: string, patch: Partial<RulerWidget>) => void;
  updateShade: (id: string, patch: Partial<ShadeWidget>) => void;
  updateProtractor: (id: string, patch: Partial<ProtractorWidget>) => void;
  updateSquare: (id: string, patch: Partial<SquareWidget>) => void;
  updateCompass: (id: string, patch: Partial<CompassWidget>) => void;

  bringToFront: (id: string) => void;
  setPxPerCm: (v: number) => void;
}

export const useWidgetStore = create<WidgetState>((set, get) => {
  const toggle = (type: Widget["type"], make: (id: string, z: number, pxPerCm: number) => Widget) => {
    const { widgets, zTop, pxPerCm } = get();
    if (widgets.some((w) => w.type === type)) {
      set({ widgets: widgets.filter((w) => w.type !== type) });
      return;
    }
    set({ widgets: [...widgets, make(nanoid(), zTop + 1, pxPerCm)], zTop: zTop + 1 });
  };

  const patcher =
    <T extends Widget>(type: T["type"]) =>
    (id: string, patch: Partial<T>) =>
      set((s) => ({
        widgets: s.widgets.map((w) => (w.id === id && w.type === type ? ({ ...w, ...patch } as Widget) : w)),
      }));

  return {
    widgets: [],
    zTop: 1,
    pxPerCm: loadPxPerCm(),

    toggleRuler: () =>
      toggle("ruler", (id, z, ppc) => {
        const cm = Math.max(10, Math.floor(Math.min(30 * ppc, window.innerWidth * 0.7) / ppc));
        return {
          id,
          z,
          type: "ruler",
          cx: window.innerWidth / 2,
          cy: window.innerHeight / 2,
          rotation: 0,
          length: cm * ppc,
        };
      }),

    toggleShade: () => toggle("shade", (id, z) => ({ id, z, type: "shade", l: 0, t: 0, r: 1, b: 1 })),

    toggleProtractor: () =>
      toggle("protractor", (id, z) => ({
        id,
        z,
        type: "protractor",
        cx: window.innerWidth / 2,
        cy: window.innerHeight * 0.65,
        rotation: 0,
        radius: Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.3),
        full: false,
        arm: 45,
      })),

    toggleSquare: () =>
      toggle("square", (id, z, ppc) => ({
        id,
        z,
        type: "square",
        cx: window.innerWidth * 0.3,
        cy: window.innerHeight * 0.65,
        rotation: 0,
        size: Math.max(6, Math.round((Math.min(window.innerWidth, window.innerHeight) * 0.5) / ppc)) * ppc,
        variant: 45,
      })),

    toggleCompass: () =>
      toggle("compass", (id, z, ppc) => ({
        id,
        z,
        type: "compass",
        cx: window.innerWidth * 0.4,
        cy: window.innerHeight * 0.55,
        rotation: 0,
        radius: Math.round(6 * ppc),
        draw: true,
      })),

    updateRuler: patcher<RulerWidget>("ruler"),
    updateShade: patcher<ShadeWidget>("shade"),
    updateProtractor: patcher<ProtractorWidget>("protractor"),
    updateSquare: patcher<SquareWidget>("square"),
    updateCompass: patcher<CompassWidget>("compass"),

    bringToFront: (id) =>
      set((s) => {
        const top = s.widgets.reduce((m, w) => Math.max(m, w.z), 0);
        const target = s.widgets.find((w) => w.id === id);
        if (!target || target.z === top) return s;
        return { widgets: s.widgets.map((w) => (w.id === id ? { ...w, z: top + 1 } : w)), zTop: top + 1 };
      }),

    setPxPerCm: (v) => {
      const pxPerCm = Math.min(PX_PER_CM_MAX, Math.max(PX_PER_CM_MIN, v));
      try {
        localStorage.setItem(PX_PER_CM_KEY, String(pxPerCm));
      } catch {
        /* stockage indisponible : la valeur reste valable pour la session */
      }
      set({ pxPerCm });
    },
  };
});

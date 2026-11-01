import { create } from "zustand";
import type { Pt } from "../lib/shapes";
import { clampView, fitView, zoomViewAt, type View } from "../lib/view";

interface ViewState extends View {
  vw: number; // taille du conteneur
  vh: number;
  fitted: boolean; // vue « ajustée » : suit le redimensionnement de la fenêtre

  setSize: (w: number, h: number) => void; // appelée par Board
  setView: (v: View) => void; // geste utilisateur
  zoomAt: (factor: number, cx: number, cy: number) => void;
  fit: () => void;
  actualSize: () => void; // 100 % : 1 px de page = 1 px d'écran
}

export const useViewStore = create<ViewState>((set, get) => {
  const w = window.innerWidth;
  const h = window.innerHeight;

  return {
    ...fitView(w, h),
    vw: w,
    vh: h,
    fitted: true,

    setSize: (vw, vh) => {
      const { fitted, s, x, y } = get();
      set(fitted ? { vw, vh, ...fitView(vw, vh) } : { vw, vh, ...clampView({ s, x, y }, vw, vh) });
    },

    setView: (v) => {
      const { vw, vh } = get();
      const c = clampView(v, vw, vh);
      set({ ...c, fitted: c.s <= fitView(vw, vh).s });
    },

    zoomAt: (factor, cx, cy) => {
      const { s, x, y, vw, vh } = get();
      const c = clampView(zoomViewAt({ s, x, y }, factor, cx, cy), vw, vh);
      set({ ...c, fitted: c.s <= fitView(vw, vh).s });
    },

    fit: () => {
      const { vw, vh } = get();
      set({ ...fitView(vw, vh), fitted: true });
    },

    actualSize: () => {
      const { s, x, y, vw, vh } = get();
      set({ ...clampView(zoomViewAt({ s, x, y }, 1 / s, vw / 2, vh / 2), vw, vh), fitted: false });
    },
  };
});

export function screenToPage(p: Pt): Pt {
  const { s, x, y } = useViewStore.getState();
  return { x: (p.x - x) / s, y: (p.y - y) / s };
}

export function pageToScreen(p: Pt): Pt {
  const { s, x, y } = useViewStore.getState();
  return { x: p.x * s + x, y: p.y * s + y };
}

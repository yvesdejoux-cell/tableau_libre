import { create } from "zustand";
import { nanoid } from "nanoid";
import { baseWidths } from "../lib/defaults";
import { DEFAULT_TEXT_SIZE } from "../lib/text";
import type { BackgroundType, BoardObject, EraserMode, Page, ShapeObject, TextObject, Tool, WidthKey } from "../types";
import { fitView } from "../lib/view";
import { useWidgetStore } from "./useWidgetStore";

const MAX_HISTORY = 50;

interface Snapshot {
  pages: Page[];
  currentPageId: string;
}

interface BoardState extends Snapshot {
  past: Snapshot[];
  future: Snapshot[];

  tool: Tool;
  eraserMode: EraserMode;
  color: string;
  baseWidths: Record<WidthKey, number>; // épaisseur « normale » : sert de base aux préréglages
  widths: Record<WidthKey, number>;
  selectedId: string | null;
  textSize: number;

  // Édition de texte : le contenu est écrit dans la page au fil de la frappe (enregistrement et
  // récupération le voient), et toute l'édition ne compte que pour un point d'historique.
  editingId: string | null;
  editBase: Snapshot | null; // état d'avant l'édition

  // Vidéo dont les commandes reçoivent les clics (le tableau les laisse alors passer)
  interactingId: string | null;

  setInteracting: (id: string | null) => void;
  setTool: (t: Tool) => void;
  setEraserMode: (m: EraserMode) => void;
  setColor: (c: string) => void;
  setWidth: (key: WidthKey, w: number) => void;
  applyDefaultWidths: () => void;
  setTextSize: (n: number) => void;
  select: (id: string | null) => void;

  startNewText: (o: TextObject) => void;
  startEditText: (id: string) => void;
  patchEditedText: (patch: Partial<TextObject>) => void;
  endTextEdit: () => void;

  checkpoint: () => void;
  addObject: (o: BoardObject) => void;
  removeObject: (id: string, record?: boolean) => void;
  updateObject: (id: string, patch: Partial<BoardObject>) => void;
  clear: () => void;

  addPage: () => void;
  duplicatePage: (id: string) => void;
  selectPage: (id: string) => void;
  removePage: (id: string) => void;
  reorderPages: (from: number, to: number) => void;
  setBackground: (bg: BackgroundType) => void;

  loadSession: (pages: Page[], currentPageId: string) => void;
  resetSession: () => void;

  undo: () => void;
  redo: () => void;
}

const snap = (s: Snapshot): Snapshot => ({ pages: s.pages, currentPageId: s.currentPageId });
const pushPast = (s: BoardState) => [...s.past.slice(-(MAX_HISTORY - 1)), snap(s)];
const mapCurrent = (s: BoardState, fn: (p: Page) => Page) =>
  s.pages.map((p) => (p.id === s.currentPageId ? fn(p) : p));

export const selectCurrentPage = (s: BoardState): Page =>
  s.pages.find((p) => p.id === s.currentPageId) ?? s.pages[0];

/** Zone de texte en cours d'édition, sinon zone sélectionnée : c'est elle que visent couleur et taille. */
export const selectActiveText = (s: BoardState): TextObject | undefined => {
  const id = s.editingId ?? s.selectedId;
  const o = id ? selectCurrentPage(s).objects.find((x) => x.id === id) : undefined;
  return o?.kind === "text" ? o : undefined;
};

/** Objet dont la palette modifie la couleur : texte actif ou forme sélectionnée. */
export const selectColorTarget = (s: BoardState): TextObject | ShapeObject | undefined => {
  const o = s.selectedId ? selectCurrentPage(s).objects.find((x) => x.id === s.selectedId) : undefined;
  return selectActiveText(s) ?? (o?.kind === "shape" ? o : undefined);
};

const firstPage: Page = { id: nanoid(), objects: [], background: "blank" };

// Échelle de la page ajustée à l'écran entier : ni la taille de la fenêtre ni le zoom ne changent les épaisseurs
const defaultWidths = () =>
  baseWidths(useWidgetStore.getState().pxPerCm, fitView(window.screen.width, window.screen.height).s);

const initialBase = defaultWidths();

export const useBoardStore = create<BoardState>((set, get) => ({
  pages: [firstPage],
  currentPageId: firstPage.id,
  past: [],
  future: [],

  tool: "select",
  eraserMode: "object",
  color: "#111827",
  baseWidths: initialBase,
  widths: { ...initialBase },
  selectedId: null,
  textSize: DEFAULT_TEXT_SIZE,
  editingId: null,
  editBase: null,
  interactingId: null,

  setInteracting: (interactingId) => set({ interactingId }),
  setTool: (tool) => set((s) => ({ tool, selectedId: tool === "select" ? s.selectedId : null, interactingId: null })),
  setEraserMode: (eraserMode) => set({ eraserMode }),
  setColor: (color) => {
    const s = get();
    const target = selectColorTarget(s);
    set({ color });
    if (target && s.editingId) s.patchEditedText({ color });
    else if (target) s.updateObject(target.id, { color });
  },
  setTextSize: (textSize) => {
    const s = get();
    const target = selectActiveText(s);
    set({ textSize });
    if (target && s.editingId) s.patchEditedText({ fontSize: textSize });
    else if (target) s.updateObject(target.id, { fontSize: textSize });
  },
  setWidth: (key, w) => set((s) => ({ widths: { ...s.widths, [key]: w } })),
  applyDefaultWidths: () => {
    const b = defaultWidths();
    set({ baseWidths: b, widths: { ...b } });
  },
  select: (selectedId) => set((s) => ({ selectedId, interactingId: selectedId === s.interactingId ? s.interactingId : null })),

  // --- Édition de texte
  startNewText: (o) =>
    set((s) => ({
      editBase: snap(s),
      editingId: o.id,
      pages: mapCurrent(s, (p) => ({ ...p, objects: [...p.objects, o] })),
    })),

  startEditText: (id) =>
    set((s) => {
      const o = selectCurrentPage(s).objects.find((x) => x.id === id);
      if (o?.kind !== "text") return s;
      return { editBase: snap(s), editingId: id, color: o.color, textSize: o.fontSize };
    }),

  patchEditedText: (patch) =>
    set((s) => ({
      pages: mapCurrent(s, (p) => ({
        ...p,
        objects: p.objects.map((o) => (o.id === s.editingId ? ({ ...o, ...patch } as BoardObject) : o)),
      })),
    })),

  endTextEdit: () =>
    set((s) => {
      const { editingId: id, editBase: base } = s;
      if (!id || !base) return s;
      const closed = { editingId: null, editBase: null };
      const o = selectCurrentPage(s).objects.find((x) => x.id === id);
      const empty = o?.kind === "text" && !o.text.trim();
      const existed = base.pages.some((p) => p.objects.some((x) => x.id === id));

      // Zone neuve restée vide : comme si rien ne s'était passé
      if (empty && !existed) return { ...closed, pages: base.pages, selectedId: null };
      if (s.pages === base.pages) return closed; // rien de modifié
      const past = [...s.past.slice(-(MAX_HISTORY - 1)), base];
      if (empty) {
        return {
          ...closed,
          past,
          future: [],
          pages: mapCurrent(s, (p) => ({ ...p, objects: p.objects.filter((x) => x.id !== id) })),
          selectedId: null,
        };
      }
      return { ...closed, past, future: [] };
    }),

  checkpoint: () => set((s) => ({ past: pushPast(s), future: [] })),

  addObject: (o) =>
    set((s) => ({
      past: pushPast(s),
      future: [],
      pages: mapCurrent(s, (p) => ({ ...p, objects: [...p.objects, o] })),
    })),

  removeObject: (id, record = true) =>
    set((s) => ({
      past: record ? pushPast(s) : s.past,
      future: record ? [] : s.future,
      pages: mapCurrent(s, (p) => ({ ...p, objects: p.objects.filter((o) => o.id !== id) })),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  updateObject: (id, patch) =>
    set((s) => ({
      past: pushPast(s),
      future: [],
      pages: mapCurrent(s, (p) => ({
        ...p,
        objects: p.objects.map((o) => (o.id === id ? ({ ...o, ...patch } as BoardObject) : o)),
      })),
    })),

  clear: () =>
    set((s) => {
      if (!selectCurrentPage(s).objects.length) return s;
      return {
        past: pushPast(s),
        future: [],
        pages: mapCurrent(s, (p) => ({ ...p, objects: [] })),
        selectedId: null,
      };
    }),

  // --- Pages
  addPage: () =>
    set((s) => {
      const page: Page = { id: nanoid(), objects: [], background: selectCurrentPage(s).background };
      const idx = s.pages.findIndex((p) => p.id === s.currentPageId);
      return {
        past: pushPast(s),
        future: [],
        pages: [...s.pages.slice(0, idx + 1), page, ...s.pages.slice(idx + 1)],
        currentPageId: page.id,
        selectedId: null,
      };
    }),

  duplicatePage: (id) =>
    set((s) => {
      const idx = s.pages.findIndex((p) => p.id === id);
      if (idx < 0) return s;
      const src = s.pages[idx];
      const copy: Page = { ...src, id: nanoid(), objects: src.objects.map((o) => ({ ...o, id: nanoid() })) };
      return {
        past: pushPast(s),
        future: [],
        pages: [...s.pages.slice(0, idx + 1), copy, ...s.pages.slice(idx + 1)],
        currentPageId: copy.id,
        selectedId: null,
      };
    }),

  selectPage: (id) => set({ currentPageId: id, selectedId: null, interactingId: null }),

  removePage: (id) =>
    set((s) => {
      if (s.pages.length <= 1) return s;
      const idx = s.pages.findIndex((p) => p.id === id);
      const pages = s.pages.filter((p) => p.id !== id);
      const currentPageId =
        s.currentPageId === id ? pages[Math.max(0, idx - 1)].id : s.currentPageId;
      return { past: pushPast(s), future: [], pages, currentPageId, selectedId: null };
    }),

  reorderPages: (from, to) =>
    set((s) => {
      if (from === to || from < 0 || to < 0) return s;
      const pages = [...s.pages];
      const [moved] = pages.splice(from, 1);
      pages.splice(to, 0, moved);
      return { past: pushPast(s), future: [], pages };
    }),

  setBackground: (background) =>
    set((s) => {
      // Évite le "stylo noir sur tableau noir"
      let color = s.color;
      if (background === "black" && color === "#111827") color = "#ffffff";
      if (background !== "black" && color === "#ffffff") color = "#111827";
      return {
        past: pushPast(s),
        future: [],
        pages: mapCurrent(s, (p) => ({ ...p, background })),
        color,
      };
    }),

  // --- Session
  loadSession: (pages, currentPageId) =>
    set({ pages, currentPageId, past: [], future: [], selectedId: null, editingId: null, editBase: null }),

  resetSession: () => {
    const page: Page = { id: nanoid(), objects: [], background: "blank" };
    set({ pages: [page], currentPageId: page.id, past: [], future: [], selectedId: null, editingId: null, editBase: null });
  },

  // --- Historique
  undo: () => {
    const s = get();
    const prev = s.past[s.past.length - 1];
    if (!prev) return;
    set({
      pages: prev.pages,
      currentPageId: prev.currentPageId,
      past: s.past.slice(0, -1),
      future: [snap(s), ...s.future],
      selectedId: null,
    });
  },

  redo: () => {
    const s = get();
    const next = s.future[0];
    if (!next) return;
    set({
      pages: next.pages,
      currentPageId: next.currentPageId,
      past: [...s.past, snap(s)],
      future: s.future.slice(1),
      selectedId: null,
    });
  },
}));

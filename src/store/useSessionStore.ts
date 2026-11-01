import { create } from "zustand";

export const DEFAULT_NAME = "Sans titre";

interface SessionState {
  path: string | null; // fichier courant (null = jamais enregistré)
  name: string; // sans extension
  dirty: boolean; // modifications non enregistrées
  busy: string | null; // message d'opération longue (export…)
  cancelBusy: (() => void) | null; // si cette opération peut être annulée

  setDirty: (dirty: boolean) => void;
  setSaved: (path: string | null, name: string, dirty?: boolean) => void;
  setBusy: (busy: string | null, cancel?: () => void) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  path: null,
  name: DEFAULT_NAME,
  dirty: false,
  busy: null,
  cancelBusy: null,

  setDirty: (dirty) => set({ dirty }),
  setSaved: (path, name, dirty = false) => set({ path, name, dirty }),
  setBusy: (busy, cancel) => set({ busy, cancelBusy: cancel ?? null }),
  reset: () => set({ path: null, name: DEFAULT_NAME, dirty: false }),
}));

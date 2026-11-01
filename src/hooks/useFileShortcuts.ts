import { useEffect } from "react";
import { newSession, openSession, saveSession } from "../lib/fileActions";
import { toggleFullscreen } from "../lib/windowing";

export function useFileShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();

      if (e.key === "F11") {
        e.preventDefault();
        void toggleFullscreen();
        return;
      }
      // Version installée : pas de rechargement de la page (la session en mémoire serait perdue)
      if (import.meta.env.PROD && (e.key === "F5" || (mod && k === "r"))) {
        e.preventDefault();
        return;
      }
      if (!mod) return;

      if (k === "s") {
        e.preventDefault();
        void saveSession(e.shiftKey); // Ctrl+Maj+S = Enregistrer sous
      } else if (k === "o") {
        e.preventDefault();
        void openSession();
      } else if (k === "n") {
        e.preventDefault();
        void newSession();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

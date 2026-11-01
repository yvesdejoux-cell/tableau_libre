import { useEffect } from "react";
import { IS_TAURI } from "../lib/files";
import { getMedia, mediaPath, usedMediaIds } from "../lib/media";
import { writeRecovery } from "../lib/recovery";
import { serializeSession } from "../lib/session";
import { useBoardStore } from "../store/useBoardStore";
import { useSessionStore } from "../store/useSessionStore";
import type { Page } from "../types";

const AUTOSAVE_MS = 20_000;

export function useAutosave() {
  useEffect(() => {
    if (!IS_TAURI) return; // pas de récupération en mode navigateur
    let lastSaved: Page[] | null = null;
    let running = false;

    const tick = async () => {
      const sess = useSessionStore.getState();
      const board = useBoardStore.getState();
      // Rien à faire si rien n'a changé depuis la dernière sauvegarde automatique
      if (running || !sess.dirty || board.pages === lastSaved) return;
      running = true;
      try {
        const ids = usedMediaIds(board.pages);
        const media = ids.flatMap((id) => {
          const blob = getMedia(id);
          return blob ? [{ id, blob }] : [];
        });
        const mediaPaths = Object.fromEntries(ids.flatMap((id) => {
          const path = mediaPath(id);
          return path ? [[id, path]] : [];
        }));
        await writeRecovery(
          serializeSession(board.pages, board.currentPageId),
          { name: sess.name, path: sess.path, at: new Date().toISOString(), mediaPaths },
          media
        );
        lastSaved = board.pages;
      } catch (e) {
        console.warn("Sauvegarde automatique impossible :", e);
      } finally {
        running = false;
      }
    };

    const id = window.setInterval(tick, AUTOSAVE_MS);
    window.addEventListener("blur", tick); // aussi quand la fenêtre perd le focus
    return () => {
      window.clearInterval(id);
      window.removeEventListener("blur", tick);
    };
  }, []);
}

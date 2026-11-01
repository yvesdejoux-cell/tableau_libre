import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { APP_NAME, APP_VERSION } from "../lib/app";
import { IS_TAURI, confirmDiscard } from "../lib/files";
import { clearRecovery } from "../lib/recovery";
import { useBoardStore } from "../store/useBoardStore";
import { useSessionStore } from "../store/useSessionStore";

export function useSessionLifecycle() {
  // Toute modification des pages marque la session comme non enregistrée
  useEffect(
    () =>
      useBoardStore.subscribe((s, prev) => {
        if (s.pages !== prev.pages) useSessionStore.getState().setDirty(true);
      }),
    []
  );

  // Titre de la fenêtre : « • Nom — Tableau Libre v0.1.0 »
  useEffect(() => {
    const apply = () => {
      const { name, dirty } = useSessionStore.getState();
      const title = `${dirty ? "• " : ""}${name} — ${APP_NAME} v${APP_VERSION}`;
      document.title = title;
      if (IS_TAURI) void getCurrentWindow().setTitle(title).catch(() => {});
    };
    apply();
    return useSessionStore.subscribe(apply);
  }, []);

  // Fermeture : confirmation s'il reste des modifications
  useEffect(() => {
    if (!IS_TAURI) {
      const onUnload = (e: BeforeUnloadEvent) => {
        if (useSessionStore.getState().dirty) e.preventDefault();
      };
      window.addEventListener("beforeunload", onUnload);
      return () => window.removeEventListener("beforeunload", onUnload);
    }

    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (useSessionStore.getState().dirty) {
          const ok = await confirmDiscard("Les modifications non enregistrées seront perdues. Quitter quand même ?");
          if (!ok) {
            event.preventDefault();
            return;
          }
          await clearRecovery(); // abandon volontaire : plus rien à récupérer
        }
      })
      .then((u) => (cancelled ? u() : (unlisten = u)));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}

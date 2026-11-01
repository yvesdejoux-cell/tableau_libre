import { invoke } from "@tauri-apps/api/core";
import { openPath } from "./fileActions";
import { IS_TAURI, confirmChoice, showError } from "./files";
import { replaceMedia, usedMediaIds } from "./media";
import { allowDirOf } from "./mediaFiles";
import { clearRecovery, readRecovery, readRecoveryMedia } from "./recovery";
import { parseSession } from "./session";
import { useBoardStore } from "../store/useBoardStore";
import { useSessionStore } from "../store/useSessionStore";

let started = false; // évite le double appel en mode développement (React StrictMode)

export async function runStartup() {
  if (!IS_TAURI || started) return;
  started = true;

  // 1. Fichier passé en argument (double-clic dans l'explorateur de fichiers)
  try {
    const path = await invoke<string | null>("launch_file");
    if (path) {
      await openPath(path);
      return; // une éventuelle récupération sera proposée au prochain lancement normal
    }
  } catch (e) {
    await showError(e instanceof Error ? e.message : "Ouverture du fichier impossible.");
  } finally {
    useSessionStore.getState().setBusy(null);
  }

  // 2. Session retrouvée après un arrêt anormal
  const rec = await readRecovery();
  if (!rec) return;

  const when = new Date(rec.meta.at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  const restore = await confirmChoice(
    `Une session non enregistrée a été retrouvée (« ${rec.meta.name} », ${when}).\n\nVoulez-vous la restaurer ?`,
    "Restaurer",
    "Ignorer"
  );

  if (!restore) {
    await clearRecovery();
    return;
  }
  try {
    const { pages, currentPageId } = parseSession(rec.text);
    // Un média déjà sur le disque y est retrouvé ; seuls les autres sont dans la sauvegarde
    const paths = new Map(Object.entries(rec.meta.mediaPaths ?? {}));
    for (const path of paths.values()) await allowDirOf(path);
    replaceMedia(await readRecoveryMedia(usedMediaIds(pages).filter((id) => !paths.has(id))), paths);
    useBoardStore.getState().loadSession(pages, currentPageId);
    // « modifiée » : elle n'est pas encore enregistrée dans son fichier d'origine
    useSessionStore.getState().setSaved(rec.meta.path, rec.meta.name, true);
  } catch {
    await showError("La session récupérée est illisible.");
    await clearRecovery();
  }
}

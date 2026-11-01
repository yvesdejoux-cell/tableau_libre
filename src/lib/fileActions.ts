import { exists } from "@tauri-apps/plugin-fs";
import { useBoardStore } from "../store/useBoardStore";
import { useSessionStore } from "../store/useSessionStore";
import { APP_NAME } from "./app";
import { buildPdf, canvasToPng, exportPixelRatio, renderPage } from "./exporter";
import { IS_TAURI, basename, chooseOpenPath, chooseSavePath, confirmChoice, confirmDiscard, openBinaryFile, readFileBlob, saveFile, showError, showInfo } from "./files";
import { isGwb } from "./gwb";
import { loadGwbFile } from "./importGwb";
import { replaceMedia } from "./media";
import { allowDirOf, findMediaBeside } from "./mediaFiles";
import { clearRecovery } from "./recovery";
import { parseSession } from "./session";
import { decodeSessionFile } from "./sessionFile";
import { openUbzFile, readUbzBlob, ubzBlob, writeUbzFile } from "./ubzFile";
import { PAGE_H, PAGE_W } from "./view";

const UBZ = [{ name: "Document OpenBoard", extensions: ["ubz"] }];
const IWB = { name: `Ancienne session ${APP_NAME}`, extensions: ["iwb"] };
const GWB = { name: "Interwrite Workspace", extensions: ["gwb"] };
const OPENABLE = [{ name: "Documents et fichiers Workspace", extensions: ["ubz", "iwb", "gwb"] }, ...UBZ, IWB, GWB];
const MAX_NOTES = 12;
const DISCARD = "Les modifications non enregistrées seront perdues. Continuer ?";
export const stripExt = (n: string) => n.replace(/\.[^.]+$/, "");
const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const isUbzPath = (path: string) => /\.ubz$/i.test(path);
const isZip = (head: Uint8Array) => head[0] === 0x50 && head[1] === 0x4b;
const notesOf = (warnings: string[]) =>
  warnings.length ? `\n\nÀ vérifier :\n${warnings.slice(0, MAX_NOTES).map((w) => `• ${w}`).join("\n")}${warnings.length > MAX_NOTES ? `\n… et ${warnings.length - MAX_NOTES} autres remarques.` : ""}` : "";

const guardDiscard = async () => !useSessionStore.getState().dirty || (await confirmDiscard(DISCARD));

export async function newSession() {
  if (!(await guardDiscard())) return;
  useBoardStore.getState().resetSession();
  replaceMedia();
  useSessionStore.getState().reset();
  void clearRecovery();
}

/** Un ancien .iwb (JSON) : ses médias sont à l'intérieur ou dans son dossier. */
async function loadOldSession(blob: Blob, path: string | null) {
  const { text, media } = await decodeSessionFile(blob);
  const { pages, currentPageId } = parseSession(text);
  const beside = path && IS_TAURI ? await findMediaBeside(path, pages, media) : undefined;
  replaceMedia(media, beside);
  useBoardStore.getState().loadSession(pages, currentPageId);
}

/** Ouvre un .ubz du disque ; renvoie les remarques de lecture. */
async function loadUbzPath(path: string, name: string): Promise<string[]> {
  useSessionStore.getState().setBusy(`Ouverture de ${name}…`);
  const doc = await openUbzFile(path);
  replaceMedia(new Map(), doc.paths);
  useBoardStore.getState().loadSession(doc.pages, doc.currentPageId);
  useSessionStore.getState().setSaved(path, stripExt(name)); // remet dirty à false
  return doc.warnings;
}

/** Tout ce qui n'est pas un .ubz du disque : le contenu décide du format, pas l'extension. */
async function loadBlob(blob: Blob, name: string, path: string | null): Promise<void> {
  const { setSaved, setBusy } = useSessionStore.getState();
  const head = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
  if (isGwb(head)) {
    const { count, warnings } = await loadGwbFile(blob, path);
    // Sans chemin : le prochain enregistrement demandera où créer le .ubz, le .gwb reste intact
    setSaved(null, stripExt(name), true);
    setBusy(null);
    await showInfo(`« ${name} » importé : ${count} pages. Il sera enregistré au format .ubz.${notesOf(warnings)}`);
    return;
  }
  if (isZip(head)) {
    if (/\.iwb$/i.test(name)) throw new Error("Ce fichier est au format IWB standard, que Tableau Libre ne sait pas encore ouvrir.");
    const doc = await readUbzBlob(blob);
    replaceMedia(doc.blobs);
    useBoardStore.getState().loadSession(doc.pages, doc.currentPageId);
    setSaved(path, stripExt(name));
    setBusy(null);
    if (doc.warnings.length) await showInfo(`À vérifier :${notesOf(doc.warnings)}`);
    return;
  }
  await loadOldSession(blob, path);
  // Sans chemin, comme un .gwb : l'ancien fichier reste intact
  setSaved(null, stripExt(name), true);
  setBusy(null);
  await showInfo(`« ${name} » est à l'ancien format. Il sera enregistré au format .ubz, et l'ancien fichier restera intact.`);
}

/** Ouvre un fichier du disque, choisi ou passé en argument. */
export async function openPath(path: string) {
  const name = basename(path);
  if (isUbzPath(path)) {
    const warnings = await loadUbzPath(path, name);
    useSessionStore.getState().setBusy(null);
    if (warnings.length) await showInfo(`À vérifier :${notesOf(warnings)}`);
    return;
  }
  await loadBlob(await readFileBlob(path), name, path);
}

export async function openSession() {
  if (!(await guardDiscard())) return;
  const { setBusy } = useSessionStore.getState();
  try {
    if (IS_TAURI) {
      const path = await chooseOpenPath(OPENABLE);
      if (!path) return;
      setBusy("Ouverture…");
      await openPath(path);
    } else {
      const file = await openBinaryFile(OPENABLE);
      if (!file) return;
      setBusy("Ouverture…");
      await loadBlob(file.blob, file.name, null);
    }
    void clearRecovery();
  } catch (e) {
    await showError(errMsg(e, "Ouverture impossible."));
  } finally {
    setBusy(null);
  }
}

export async function saveSession(saveAs = false): Promise<boolean> {
  const board = useBoardStore.getState();
  const sess = useSessionStore.getState();
  const defaultName = `${sess.name}.ubz`;
  const currentIndex = Math.max(0, board.pages.findIndex((p) => p.id === board.currentPageId));
  try {
    let saved;
    let warnings: string[];
    if (IS_TAURI) {
      // Une session restaurée peut encore désigner un ancien .iwb : il n'est jamais remplacé
      const known = !saveAs && sess.path && isUbzPath(sess.path) ? sess.path : null;
      const path = known ?? (await chooseSavePath(defaultName, UBZ));
      if (!path) return false;
      await allowDirOf(path);
      warnings = await writeUbzFile(path, stripExt(basename(path)), board.pages, currentIndex, (m) => sess.setBusy(m));
      saved = { path, name: basename(path) };
    } else {
      const built = await ubzBlob(sess.name, board.pages, currentIndex);
      warnings = built.warnings;
      saved = await saveFile({ defaultName, filters: UBZ, content: built.blob });
    }
    if (!saved) return false;
    // Si l'utilisateur a modifié le tableau pendant la boîte de dialogue, la session reste « modifiée »
    const changedMeanwhile = useBoardStore.getState().pages !== board.pages;
    useSessionStore.getState().setSaved(saved.path, stripExt(saved.name), changedMeanwhile);
    if (!changedMeanwhile) void clearRecovery();
    sess.setBusy(null);
    if (warnings.length) await showInfo(`« ${saved.name} » est enregistré.${notesOf(warnings)}`);
    return true;
  } catch (e) {
    await showError(errMsg(e, "Enregistrement impossible."));
    return false;
  } finally {
    sess.setBusy(null);
  }
}

export async function exportPdf() {
  const { pages } = useBoardStore.getState();
  const { name, setBusy } = useSessionStore.getState();
  const w = PAGE_W;
  const h = PAGE_H;
  try {
    setBusy("Export PDF…");
    const bytes = await buildPdf(pages, w, h, (i, n) => setBusy(`Export PDF : page ${i}/${n}`));
    await saveFile({ defaultName: `${name}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }], content: bytes });
  } catch (e) {
    await showError(errMsg(e, "Export PDF impossible."));
  } finally {
    setBusy(null);
  }
}

/** Une image par page, numérotées d'après le nom choisi ; une session d'une page garde ce nom tel quel. */
export async function exportPng() {
  const { pages } = useBoardStore.getState();
  const { name, setBusy } = useSessionStore.getState();
  const w = PAGE_W;
  const h = PAGE_H;
  const filters = [{ name: "Image PNG", extensions: ["png"] }];
  const nameFor = (base: string, i: number) => (pages.length > 1 ? `${base}-page${i + 1}.png` : `${base}.png`);
  try {
    let base: string | null = null; // chemin sans extension (version bureau)
    if (IS_TAURI) {
      const chosen = await chooseSavePath(`${name}.png`, filters);
      if (!chosen) return;
      base = chosen.replace(/\.png$/i, "");
      if (pages.length > 1) {
        // La boîte de dialogue n'a vérifié que le nom choisi, pas ceux des pages
        await allowDirOf(chosen);
        const taken = await Promise.all(pages.map((_, i) => exists(nameFor(base!, i))));
        if (taken.some(Boolean) && !(await confirmChoice("Des images de ces pages existent déjà dans ce dossier. Les remplacer ?", "Remplacer", "Annuler", "warning"))) return;
      }
    }
    for (let i = 0; i < pages.length; i++) {
      setBusy(`Export PNG : page ${i + 1}/${pages.length}`);
      const canvas = await renderPage(pages[i], w, h, exportPixelRatio(w));
      await saveFile({
        defaultName: nameFor(name, i),
        filters,
        content: await canvasToPng(canvas),
        path: base && nameFor(base, i),
      });
    }
  } catch (e) {
    await showError(errMsg(e, "Export PNG impossible."));
  } finally {
    setBusy(null);
  }
}

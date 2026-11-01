import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open as openFile, writeFile, writeTextFile, type BaseDirectory } from "@tauri-apps/plugin-fs";
import { APP_NAME } from "./app";

const READ_CHUNK = 8 * 1024 * 1024;

/** Flux par gros morceaux : `Blob.stream()` en donne de si petits que chaque appel à Tauri ralentit l'écriture. */
export function blobChunks(blob: Blob): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream({
    async pull(controller) {
      if (at >= blob.size) return controller.close();
      controller.enqueue(new Uint8Array(await blob.slice(at, at + READ_CHUNK).arrayBuffer()));
      at += READ_CHUNK;
    },
  });
}

export const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface Saved {
  path: string | null; // null en mode navigateur (téléchargement)
  name: string;
}

export const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;

function download(content: string | Uint8Array | Blob, name: string) {
  const url = URL.createObjectURL(new Blob([content as BlobPart]));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Boîte « Enregistrer sous » de la version bureau ; null si l'utilisateur annule. */
export const chooseSavePath = (defaultPath: string, filters: FileFilter[]) => save({ defaultPath, filters });

/**
 * Enregistre un fichier. Si `path` est fourni (Tauri), écrit directement dessus ;
 * sinon ouvre la boîte « Enregistrer sous ». Renvoie null si l'utilisateur annule.
 */
export async function saveFile(opts: {
  defaultName: string;
  filters: FileFilter[];
  content: string | Uint8Array | Blob;
  path?: string | null;
}): Promise<Saved | null> {
  if (!IS_TAURI) {
    download(opts.content, opts.defaultName);
    return { path: null, name: opts.defaultName };
  }
  const path = opts.path ?? (await save({ defaultPath: opts.defaultName, filters: opts.filters }));
  if (!path) return null;
  if (typeof opts.content === "string") await writeTextFile(path, opts.content);
  else if (opts.content instanceof Blob) await writeFile(path, blobChunks(opts.content));
  else await writeFile(path, opts.content);
  return { path, name: basename(path) };
}

/** Lit un fichier par morceaux : Chromium range les gros Blob sur le disque plutôt qu'en mémoire. */
export async function readFileBlob(path: string, opts?: { baseDir: BaseDirectory }, type = ""): Promise<Blob> {
  const file = await openFile(path, { read: true, ...opts });
  try {
    const parts: Blob[] = [];
    for (;;) {
      const buf = new Uint8Array(READ_CHUNK);
      const n = await file.read(buf);
      if (n === null) break;
      parts.push(new Blob([buf.subarray(0, n)]));
    }
    return new Blob(parts, { type });
  } finally {
    await file.close();
  }
}

/** Boîte « Ouvrir » de la version bureau, sans lire le fichier : il peut être très gros. */
export const chooseOpenPath = (filters: FileFilter[]) => open({ multiple: false, directory: false, filters });

export async function openBinaryFile(
  filters: FileFilter[]
): Promise<{ path: string | null; name: string; blob: Blob } | null> {
  if (!IS_TAURI) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = filters.flatMap((f) => f.extensions.map((e) => "." + e)).join(",");
      input.onchange = () => {
        const f = input.files?.[0];
        resolve(f ? { path: null, name: f.name, blob: f } : null);
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  }
  const path = await open({ multiple: false, directory: false, filters });
  if (!path) return null;
  return { path, name: basename(path), blob: await readFileBlob(path) };
}

export async function openExternal(url: string): Promise<void> {
  if (IS_TAURI) await openUrl(url);
  else window.open(url, "_blank", "noopener");
}

export async function confirmChoice(
  text: string,
  okLabel: string,
  cancelLabel: string,
  kind: "info" | "warning" = "info"
): Promise<boolean> {
  if (IS_TAURI) return ask(text, { title: APP_NAME, kind, okLabel, cancelLabel });
  return window.confirm(text);
}

export const confirmDiscard = (text: string) => confirmChoice(text, "Continuer", "Annuler", "warning");

export async function showInfo(text: string): Promise<void> {
  if (IS_TAURI) await message(text, { title: APP_NAME, kind: "info" });
  else window.alert(text);
}

export async function showError(text: string): Promise<void> {
  if (IS_TAURI) await message(text, { title: APP_NAME, kind: "error" });
  else window.alert(text);
}

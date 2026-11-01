import { BaseDirectory, exists, mkdir, readTextFile, remove, rename, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { IS_TAURI, blobChunks, readFileBlob } from "./files";

const DIR = "recovery";
const MEDIA_DIR = `${DIR}/media`;
const SESSION = `${DIR}/autosave.iwb`;
const META = `${DIR}/autosave.meta.json`;
const base = { baseDir: BaseDirectory.AppData };

export interface RecoveryMeta {
  name: string;
  path: string | null; // fichier d'origine, s'il y en avait un
  at: string; // date de la dernière sauvegarde automatique (ISO)
  mediaPaths?: Record<string, string>; // médias déjà sur le disque : id → chemin
}

/** Écriture atomique : fichier temporaire puis renommage. */
async function atomicWrite(path: string, content: string) {
  const tmp = `${path}.tmp`;
  await writeTextFile(tmp, content, base);
  await rename(tmp, path, { oldPathBaseDir: BaseDirectory.AppData, newPathBaseDir: BaseDirectory.AppData });
}

/** Une vidéo ne change jamais : elle n'est écrite qu'une fois, et non à chaque sauvegarde automatique. */
async function writeMedia(media: { id: string; blob: Blob }[]) {
  for (const { id, blob } of media) {
    const path = `${MEDIA_DIR}/${id}`;
    if (await exists(path, base)) continue;
    await writeFile(`${path}.tmp`, blobChunks(blob), base);
    await rename(`${path}.tmp`, path, { oldPathBaseDir: BaseDirectory.AppData, newPathBaseDir: BaseDirectory.AppData });
    await writeTextFile(`${path}.type`, blob.type, base);
  }
}

export async function writeRecovery(session: string, meta: RecoveryMeta, media: { id: string; blob: Blob }[] = []) {
  if (!IS_TAURI) return;
  await mkdir(MEDIA_DIR, { ...base, recursive: true });
  await writeMedia(media);
  await atomicWrite(SESSION, session);
  await atomicWrite(META, JSON.stringify(meta)); // les métadonnées en dernier : leur présence valide la sauvegarde
}

export async function readRecovery(): Promise<{ meta: RecoveryMeta; text: string } | null> {
  if (!IS_TAURI) return null;
  try {
    if (!(await exists(META, base)) || !(await exists(SESSION, base))) return null;
    const meta = JSON.parse(await readTextFile(META, base)) as RecoveryMeta;
    const text = await readTextFile(SESSION, base);
    return { meta, text };
  } catch {
    return null;
  }
}

/** Vidéos retrouvées ; une vidéo absente s'affichera comme introuvable, sans bloquer la restauration. */
export async function readRecoveryMedia(ids: string[]): Promise<Map<string, Blob>> {
  const media = new Map<string, Blob>();
  for (const id of ids) {
    try {
      const path = `${MEDIA_DIR}/${id}`;
      const type = await readTextFile(`${path}.type`, base);
      media.set(id, await readFileBlob(path, base, type));
    } catch (e) {
      console.warn("Vidéo non récupérée :", id, e);
    }
  }
  return media;
}

export async function clearRecovery() {
  if (!IS_TAURI) return;
  for (const p of [META, SESSION, `${SESSION}.tmp`, `${META}.tmp`, MEDIA_DIR]) {
    try {
      if (await exists(p, base)) await remove(p, { ...base, recursive: p === MEDIA_DIR });
    } catch {
      /* rien à faire : au pire, une proposition de restauration en trop */
    }
  }
}

import { invoke } from "@tauri-apps/api/core";
import { exists, readTextFile, writeFile } from "@tauri-apps/plugin-fs";
import { unzipSync, zipSync, type Zippable } from "fflate";
import { nanoid } from "nanoid";
import type { Page } from "../types";
import { basename, blobChunks, readFileBlob } from "./files";
import { getMedia, mediaPath, setMediaPath, usedMediaIds } from "./media";
import { joinPath } from "./mediaFiles";
import { buildUbz } from "./ubz";
import { readUbz, type UbzPages, type UbzSource } from "./ubzRead";
import { PAGE_H, PAGE_W } from "./view";

/** Déjà compressés : les recompresser ne gagne rien. */
const STORED = /\.(png|jpe?g|gif)$/i;

const MIME: Record<string, string> = { jpg: "jpeg", jpeg: "jpeg", png: "png", gif: "gif", bmp: "bmp", webp: "webp" };
const imageType = (name: string) => `image/${MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "png"}`;

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** Le zip des pages et images, où `extra` s'ajoute (les médias, dans le navigateur). */
function packFiles(files: Map<string, Uint8Array>, extra: Zippable = {}) {
  const all: Zippable = { ...extra };
  for (const [name, data] of files) all[name] = [data, { level: STORED.test(name) ? 0 : 6 }];
  return zipSync(all);
}

const mediaIds = (pages: Page[]) => {
  const names = new Map<string, string>();
  for (const p of pages) for (const o of p.objects) if (o.kind === "video" && o.source.type === "file") names.set(o.source.mediaId, o.source.name);
  return names;
};

/**
 * Écrit le document (version bureau). Pages et images vont dans un zip partiel, et Rust y ajoute les médias
 * à partir du disque, sans passer par la mémoire, puis remplace le fichier d'un seul coup.
 */
export async function writeUbzFile(path: string, title: string, pages: Page[], currentIndex: number, onStep?: (m: string) => void): Promise<string[]> {
  const names = mediaIds(pages);
  const available = new Map<string, { name: string }>();
  const sources = new Map<string, string>();
  for (const id of usedMediaIds(pages)) {
    const blob = getMedia(id);
    if (blob) {
      // Converti ou déposé : pas encore de fichier
      const name = names.get(id) ?? "media";
      onStep?.(`Préparation de ${name}…`);
      const dir = await invoke<string>("media_cache_dir");
      const file = joinPath(dir, `${nanoid()}${/\.[^.\\/]+$/.exec(name)?.[0] ?? ""}`);
      await writeFile(file, blobChunks(blob));
      setMediaPath(id, file);
    }
    const source = mediaPath(id);
    if (source && (await exists(source))) {
      sources.set(id, source);
      available.set(id, { name: basename(source) });
    }
  }
  const { files, media, warnings } = buildUbz({ title, size: { w: PAGE_W, h: PAGE_H }, pages, currentIndex, media: available });
  const part = `${path}.part`;
  onStep?.("Enregistrement…");
  await writeFile(part, packFiles(files));
  await invoke("ubz_finish", {
    part,
    target: path,
    media: [...media].map(([id, name]) => ({ name, path: sources.get(id)! })),
  });
  return warnings;
}

/** Le même document, en mémoire (navigateur). */
export async function ubzBlob(title: string, pages: Page[], currentIndex: number): Promise<{ blob: Blob; warnings: string[] }> {
  const available = new Map<string, { name: string }>();
  const names = mediaIds(pages);
  const blobs = new Map<string, Blob>();
  for (const id of usedMediaIds(pages)) {
    const blob = getMedia(id);
    if (blob) {
      blobs.set(id, blob);
      available.set(id, { name: names.get(id) ?? "media" });
    }
  }
  const { files, media, warnings } = buildUbz({ title, size: { w: PAGE_W, h: PAGE_H }, pages, currentIndex, media: available });
  const extra: Zippable = {};
  for (const [id, name] of media) extra[name] = [new Uint8Array(await blobs.get(id)!.arrayBuffer()), { level: 0 }];
  return { blob: new Blob([packFiles(files, extra) as BlobPart]), warnings };
}

/** Ouvre un .ubz du disque : Rust l'extrait dans le cache, et les médias y sont lus sans passer par la mémoire. */
export async function openUbzFile(path: string): Promise<UbzPages & { paths: Map<string, string> }> {
  const { dir, files } = await invoke<{ dir: string; files: string[] }>("ubz_open", { path });
  const at = (name: string) => joinPath(dir, name.replace(/\//g, "\\"));
  const source: UbzSource = {
    names: files,
    text: (name) => readTextFile(at(name)),
    image: async (name) => blobToDataUrl(await readFileBlob(at(name), undefined, imageType(name))),
  };
  const doc = await readUbz(source);
  const paths = new Map<string, string>();
  for (const [id, name] of doc.media) {
    if (files.includes(name)) paths.set(id, at(name));
    else doc.warnings.push(`« ${basename(name)} » manque dans le fichier`);
  }
  return { ...doc, paths };
}

/** Ouvre un .ubz en mémoire (navigateur). */
export async function readUbzBlob(blob: Blob): Promise<UbzPages & { blobs: Map<string, Blob> }> {
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const source: UbzSource = {
    names: Object.keys(entries),
    text: async (name) => new TextDecoder().decode(entries[name]),
    image: (name) => blobToDataUrl(new Blob([entries[name] as BlobPart], { type: imageType(name) })),
  };
  const doc = await readUbz(source);
  const blobs = new Map<string, Blob>();
  for (const [id, name] of doc.media) if (entries[name]) blobs.set(id, new Blob([entries[name] as BlobPart]));
  return { ...doc, blobs };
}

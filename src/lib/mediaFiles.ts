import { invoke } from "@tauri-apps/api/core";
import { exists } from "@tauri-apps/plugin-fs";
import type { Page, VideoObject } from "../types";
import { basename } from "./files";

export const dirOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")));
export const joinPath = (dir: string, name: string) => `${dir}${dir.includes("\\") ? "\\" : "/"}${name}`;

/** Résout « ..\..\son.wma » à partir d'un dossier. */
export function resolveFrom(dir: string, target: string): string {
  if (/^([a-zA-Z]:)?[\\/]/.test(target)) return target;
  const parts = dir.split(/[\\/]/);
  for (const part of target.split(/[\\/]/)) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("\\");
}

/** Nom de fichier lu dans un .iwb ou un import : jamais de chemin, pour rester dans le dossier de la session. */
export function safeMediaName(name: string): string | null {
  const base = basename(name).replace(/[<>:"|?*\u0000-\u001f]/g, "_").trim();
  return base && base !== "." && base !== ".." ? base : null;
}

export const allowDirOf = (path: string) => invoke("allow_media_dir", { dir: dirOf(path) });

function fileVideos(pages: Page[]) {
  return pages.flatMap((p) => p.objects).filter((o): o is VideoObject => o.kind === "video" && o.source.type === "file");
}

/** À l'ouverture d'un ancien .iwb : cherche dans son dossier les médias qu'il ne contient pas. */
export async function findMediaBeside(iwbPath: string, pages: Page[], embedded: Map<string, Blob>): Promise<Map<string, string>> {
  await allowDirOf(iwbPath);
  const found = new Map<string, string>();
  for (const o of fileVideos(pages)) {
    if (o.source.type !== "file" || embedded.has(o.source.mediaId) || found.has(o.source.mediaId)) continue;
    const name = safeMediaName(o.source.name);
    if (!name) continue;
    const path = joinPath(dirOf(iwbPath), name);
    if (await exists(path)) found.set(o.source.mediaId, path);
  }
  return found;
}

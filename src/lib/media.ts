import { convertFileSrc } from "@tauri-apps/api/core";
import { nanoid } from "nanoid";
import type { Page } from "../types";

/**
 * Fichiers vidéo et son de la session. Ils restent hors de l'état du tableau : les objets ne portent
 * qu'un identifiant. Dans la version bureau, un média est un chemin sur le disque ; il n'est un Blob
 * que tant qu'il n'a pas de fichier (conversion, glisser-déposer, ancien .iwb) ou dans le navigateur.
 */
const blobs = new Map<string, Blob>();
const paths = new Map<string, string>();
const urls = new Map<string, string>();

export function addMedia(blob: Blob): string {
  const id = nanoid();
  blobs.set(id, blob);
  return id;
}

export function addMediaPath(path: string): string {
  const id = nanoid();
  paths.set(id, path);
  return id;
}

/** Contenu d'un média qui n'a pas encore de fichier. */
export const getMedia = (id: string) => (paths.has(id) ? undefined : blobs.get(id));
export const mediaPath = (id: string) => paths.get(id);

/** L'adresse déjà donnée au lecteur reste valable : une lecture en cours n'est pas interrompue. */
export function setMediaPath(id: string, path: string) {
  paths.set(id, path);
}

/** Le média n'a plus de fichier : son contenu sera écrit au prochain enregistrement. */
export function setMediaBlob(id: string, blob: Blob) {
  paths.delete(id);
  blobs.set(id, blob);
}

export function mediaUrl(id: string): string | null {
  const cached = urls.get(id);
  if (cached) return cached;
  const path = paths.get(id);
  const blob = blobs.get(id);
  if (!path && !blob) return null;
  const url = path ? convertFileSrc(path) : URL.createObjectURL(blob!);
  urls.set(id, url);
  return url;
}

/** Oublie l'adresse d'un média qu'on vient de retrouver ailleurs. */
export function forgetMediaUrl(id: string) {
  const url = urls.get(id);
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
  urls.delete(id);
}

/** Remplace tous les médias (nouvelle session, ouverture). */
export function replaceMedia(nextBlobs: Map<string, Blob> = new Map(), nextPaths: Map<string, string> = new Map()) {
  for (const url of urls.values()) if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  urls.clear();
  blobs.clear();
  paths.clear();
  for (const [id, blob] of nextBlobs) blobs.set(id, blob);
  for (const [id, path] of nextPaths) paths.set(id, path);
}

export function usedMediaIds(pages: Page[]): string[] {
  const ids = new Set<string>();
  for (const p of pages) {
    for (const o of p.objects) if (o.kind === "video" && o.source.type === "file") ids.add(o.source.mediaId);
  }
  return [...ids];
}

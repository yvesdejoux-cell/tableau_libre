import { exists } from "@tauri-apps/plugin-fs";
import { nanoid } from "nanoid";
import { useBoardStore } from "../store/useBoardStore";
import { useSessionStore } from "../store/useSessionStore";
import { IS_TAURI, basename } from "./files";
import { type GwbConvertTools, type GwbImageFormat, type GwbTextStyle, gwbToPages, parseGwb } from "./gwb";
import { importedMedia, isAudioName, isMediaName } from "./importVideo";
import { replaceMedia } from "./media";
import { allowDirOf, dirOf, joinPath, resolveFrom } from "./mediaFiles";
import { textFont } from "./text";

const BYTES_CHUNK = 0x8000;

function dataUrl(data: Uint8Array, format: GwbImageFormat): string {
  let bin = "";
  for (let i = 0; i < data.length; i += BYTES_CHUNK) bin += String.fromCharCode(...data.subarray(i, i + BYTES_CHUNK));
  return `data:image/${format};base64,${btoa(bin)}`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image illisible"));
    img.src = url;
  });
}

/** PNG et JPEG sont gardés tels quels ; le reste, ou une couleur de transparence, passe par un canvas. */
async function usableImage(data: Uint8Array, format: GwbImageFormat, colorKey: string | null): Promise<string | null> {
  const url = dataUrl(data, format);
  if (!colorKey && (format === "png" || format === "jpeg")) return url;
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    if (colorKey) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(colorKey.slice(i, i + 2), 16));
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = pixels.data;
      for (let i = 0; i < d.length; i += 4) if (d[i] === r && d[i + 1] === g && d[i + 2] === b) d[i + 3] = 0;
      ctx.putImageData(pixels, 0, 0);
    }
    return canvas.toDataURL("image/png");
  } catch (err) {
    console.error("Image du GWB illisible :", err);
    return null;
  }
}

/** Le média lié : à son chemin enregistré, sinon à côté du GWB. */
async function findLinked(target: string, gwbPath: string): Promise<string | null> {
  const dir = dirOf(gwbPath);
  for (const path of [resolveFrom(dir, target), joinPath(dir, basename(target))]) {
    try {
      await allowDirOf(path);
      if (await exists(path)) return path;
    } catch {
      /* dossier inaccessible : on essaie l'emplacement suivant */
    }
  }
  return null;
}

/** Lit un .gwb et le charge dans le tableau ; le fichier d'origine n'est jamais modifié. Renvoie les remarques d'import. */
export async function loadGwbFile(blob: Blob, path: string | null): Promise<{ count: number; warnings: string[] }> {
  const { setBusy } = useSessionStore.getState();
  const doc = parseGwb(new Uint8Array(await blob.arrayBuffer()));
  const ctx = document.createElement("canvas").getContext("2d")!;
  const blobs = new Map<string, Blob>();
  const paths = new Map<string, string>();

  const tools: GwbConvertTools = {
    image: usableImage,
    measure(text: string, p: GwbTextStyle, size: number) {
      ctx.font = `${p.italic ? "italic " : ""}${p.bold ? "bold " : ""}${size}px ${textFont(p.font ?? undefined)}`;
      return ctx.measureText(text).width;
    },
    async media(target, page) {
      const name = basename(target.replace(/\\/g, "/"));
      if (!isMediaName(name)) {
        doc.warnings.push(`page ${page} : lien vers « ${target} » non repris`);
        return null;
      }
      const audio = isAudioName(name);
      const found = path && IS_TAURI ? await findLinked(target, path) : null;
      if (found) {
        setBusy(`Import de ${name}…`);
        const loaded = await importedMedia(found, audio, (r) => setBusy(`Conversion de ${name} : ${Math.round(r * 100)} %`));
        if (loaded) {
          const mediaId = nanoid();
          if (loaded.blob) blobs.set(mediaId, loaded.blob);
          else paths.set(mediaId, found);
          return { mediaId, name: loaded.name, audio };
        }
      }
      doc.warnings.push(`page ${page} : « ${name} » introuvable ou illisible ; placez-le à côté du fichier, ou utilisez « Retrouver le fichier »`);
      return { mediaId: nanoid(), name, audio };
    },
  };

  setBusy("Import du fichier Workspace…");
  const pages = await gwbToPages(doc, tools);
  replaceMedia(blobs, paths);
  useBoardStore.getState().loadSession(pages, pages[0].id);
  return { count: pages.length, warnings: doc.warnings };
}

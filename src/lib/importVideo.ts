import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { nanoid } from "nanoid";
import { useBoardStore } from "../store/useBoardStore";
import { useSessionStore } from "../store/useSessionStore";
import { screenToPage } from "../store/useViewStore";
import type { VideoObject } from "../types";
import { basename, showError } from "./files";
import { addMedia, addMediaPath } from "./media";
import { allowDirOf } from "./mediaFiles";
import { PAGE_H, PAGE_W } from "./view";

const POSTER_W = 480;
const PROBE_MS = 15_000;

/** Tout ce que la conversion sait lire ; ce que le moteur web lit déjà n'est pas converti. */
const VIDEO_EXTS = ["mp4", "m4v", "webm", "ogv", "mov", "avi", "mkv", "wmv", "flv", "mpg", "mpeg", "3gp", "ts", "vob"];
const AUDIO_EXTS = ["mp3", "wav", "flac", "ogg", "oga", "opus", "m4a", "aac", "wma", "aif", "aiff", "amr", "ac3", "mka"];
const extRegex = (exts: string[]) => new RegExp(`\\.(${exts.join("|")})$`, "i");
const VIDEO_EXT = extRegex(VIDEO_EXTS);
const AUDIO_EXT = extRegex(AUDIO_EXTS);

export const MEDIA_ACCEPT = ["video/*", "audio/*", ...[...VIDEO_EXTS, ...AUDIO_EXTS].map((e) => `.${e}`)].join(",");
const MEDIA_FILTERS = [
  { name: "Vidéos et sons", extensions: [...VIDEO_EXTS, ...AUDIO_EXTS] },
  { name: "Vidéos", extensions: VIDEO_EXTS },
  { name: "Sons", extensions: AUDIO_EXTS },
];

const isAudio = (f: { name: string; type?: string }) => f.type?.startsWith("audio/") || AUDIO_EXT.test(f.name);
export const isAcceptedMedia = (f: File) => f.type.startsWith("video/") || VIDEO_EXT.test(f.name) || isAudio(f);

interface Probe {
  w: number;
  h: number;
  poster?: string;
}

/** Proportions du cadre d'un son : une bande assez haute pour ses commandes. */
const AUDIO_SIZE: Probe = { w: 5, h: 1 };

function probeAudio(url: string): Promise<Probe | null> {
  return new Promise((resolve) => {
    const a = new Audio();
    const timer = window.setTimeout(() => done(null), PROBE_MS);
    const done = (r: Probe | null) => {
      window.clearTimeout(timer);
      a.onloadedmetadata = a.onerror = null;
      a.removeAttribute("src");
      a.load();
      resolve(r);
    };
    a.preload = "metadata";
    a.onerror = () => done(null);
    a.onloadedmetadata = () => done(AUDIO_SIZE);
    a.src = url;
  });
}

/** Essaie de lire la vidéo ; null si le moteur web ne sait pas la décoder. */
function probeVideo(url: string): Promise<Probe | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    let info: Probe | null = null;
    let timer = 0;
    const done = () => {
      window.clearTimeout(timer);
      v.onloadeddata = v.onseeked = v.onerror = null;
      v.removeAttribute("src");
      v.load();
      resolve(info);
    };
    timer = window.setTimeout(done, PROBE_MS);
    v.muted = true;
    v.preload = "auto";
    v.crossOrigin = "anonymous"; // l'adresse d'un fichier du disque est d'une autre origine : l'aperçu reste lisible
    v.onerror = done;
    v.onloadeddata = () => {
      if (!v.videoWidth || !v.videoHeight) return done();
      info = { w: v.videoWidth, h: v.videoHeight };
      // La première image est souvent noire : l'aperçu est pris un peu plus loin
      v.currentTime = Number.isFinite(v.duration) ? Math.min(1, v.duration / 10) : 0;
    };
    v.onseeked = () => {
      try {
        const k = Math.min(1, POSTER_W / info!.w);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(info!.w * k));
        canvas.height = Math.max(1, Math.round(info!.h * k));
        canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
        info!.poster = canvas.toDataURL("image/jpeg", 0.75);
      } catch (err) {
        console.warn("Aperçu de la vidéo impossible :", err); // la vidéo reste utilisable sans aperçu
      }
      done();
    };
    v.src = url;
  });
}

async function probeBlob(blob: Blob, audio: boolean): Promise<Probe | null> {
  const url = URL.createObjectURL(blob);
  try {
    return await (audio ? probeAudio(url) : probeVideo(url));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Convertit en MP4 (H.264/AAC) ou M4A dans l'application : aucun logiciel à installer. */
async function convert(file: File, audio: boolean, signal: AbortSignal, onProgress: (ratio: number) => void): Promise<Blob> {
  const [{ FFmpeg, FFFSType }, core, wasm] = await Promise.all([
    import("./ffmpegLoader"),
    import("@ffmpeg/core?url"),
    import("@ffmpeg/core/wasm?url"),
  ]);
  const ff = new FFmpeg();
  ff.on("progress", ({ progress }) => onProgress(Math.min(1, Math.max(0, progress))));
  signal.addEventListener("abort", () => ff.terminate());
  const output = audio ? "sortie.m4a" : "sortie.mp4";
  try {
    await ff.load({
      coreURL: new URL(core.default, location.href).href,
      wasmURL: new URL(wasm.default, location.href).href,
    });
    // Monté plutôt que copié : un gros fichier n'a pas à tenir deux fois en mémoire
    const ext = (audio ? AUDIO_EXT : VIDEO_EXT).exec(file.name)?.[0] ?? ".media";
    const input = new File([file], `source${ext}`);
    await ff.createDir("/in");
    await ff.mount(FFFSType.WORKERFS, { files: [input] }, "/in");
    const code = await ff.exec([
      "-i", `/in/${input.name}`,
      ...(audio
        ? ["-vn"]
        : [
            "-vf", "scale='min(1280,iw)':-2,format=yuv420p",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "24", // sans fil d'exécution multiple : la vitesse d'abord
            "-movflags", "+faststart",
          ]),
      "-c:a", "aac", "-b:a", audio ? "192k" : "128k",
      output,
    ]);
    if (code !== 0) throw new Error("conversion refusée");
    const data = (await ff.readFile(output)) as Uint8Array<ArrayBuffer>;
    return new Blob([data], { type: audio ? "audio/mp4" : "video/mp4" });
  } finally {
    ff.terminate();
  }
}

/** Taille d'affichage : 60 % de la page au maximum, proportions conservées. */
function fitted(w: number, h: number) {
  const k = Math.min((PAGE_W * 0.6) / w, (PAGE_H * 0.6) / h);
  return { w: w * k, h: h * k };
}

function place(
  source: VideoObject["source"],
  w: number,
  h: number,
  center: { x: number; y: number },
  extra: { poster?: string; audio?: true } = {}
) {
  const size = fitted(w, h);
  const id = nanoid();
  const st = useBoardStore.getState();
  st.addObject({
    id,
    kind: "video",
    source,
    ...extra,
    ...size,
    x: center.x - size.w / 2,
    y: center.y - size.h / 2,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  });
  st.setTool("select");
  st.select(id);
}

const convertedName = (name: string, audio: boolean) => `${name.replace(/\.[^.]+$/, "")}${audio ? ".m4a" : ".mp4"}`;

export const isAudioName = (name: string) => AUDIO_EXT.test(name);
export const isMediaName = (name: string) => AUDIO_EXT.test(name) || VIDEO_EXT.test(name);

/**
 * Prépare un fichier du disque sans le placer sur une page : lu sur place si le moteur web le sait,
 * sinon converti (`blob`). Null si le fichier est illisible. Son dossier doit déjà être autorisé.
 */
export async function importedMedia(path: string, audio: boolean, onProgress: (ratio: number) => void): Promise<{ name: string; blob?: Blob } | null> {
  const name = basename(path);
  const url = convertFileSrc(path);
  if (await (audio ? probeAudio(url) : probeVideo(url))) return { name };
  try {
    const file = new File([await (await fetch(url)).blob()], name);
    const blob = await convert(file, audio, new AbortController().signal, onProgress);
    return (await probeBlob(blob, audio)) ? { name: convertedName(name, audio), blob } : null;
  } catch (err) {
    console.error("Conversion impossible :", name, err);
    return null;
  }
}

const importError = (name: string) =>
  showError(`Impossible d'importer « ${name} » : le fichier est endommagé ou son format n'est pas pris en charge.`);

/** Boucle commune : `load` essaie la lecture directe, `read` donne le fichier à convertir si besoin. */
async function importEach<T extends { name: string; type?: string }>(
  items: T[],
  center: { x: number; y: number },
  direct: (item: T, audio: boolean) => Promise<{ info: Probe; mediaId: () => string } | null>,
  read: (item: T) => Promise<File>
) {
  const { setBusy } = useSessionStore.getState();
  const abort = new AbortController();
  const cancel = () => abort.abort();
  let i = 0;

  for (const item of items) {
    const audio = !!isAudio(item);
    const at = { x: center.x + i * 24, y: center.y + i * 24 };
    const add = (mediaId: string, name: string, info: Probe) =>
      place({ type: "file", mediaId, name }, info.w, info.h, at, audio ? { audio: true } : info.poster ? { poster: info.poster } : {});
    try {
      setBusy(`Import de ${item.name}…`);
      const ok = await direct(item, audio);
      if (ok) {
        add(ok.mediaId(), item.name, ok.info);
      } else {
        setBusy(`Conversion de ${item.name}…`, cancel);
        const blob = await convert(await read(item), audio, abort.signal, (r) =>
          setBusy(`Conversion de ${item.name} : ${Math.round(r * 100)} %`, cancel)
        );
        const info = await probeBlob(blob, audio);
        if (!info) throw new Error("fichier converti illisible");
        add(addMedia(blob), convertedName(item.name, audio), info);
      }
      i++;
    } catch (err) {
      if (abort.signal.aborted) break; // annulé par l'utilisateur : ni message, ni fichiers suivants
      console.error("Import impossible :", item.name, err);
      await importError(item.name);
    }
  }
  setBusy(null);
}

const centerOf = (atScreen?: { x: number; y: number }) => (atScreen ? screenToPage(atScreen) : { x: PAGE_W / 2, y: PAGE_H / 2 });

/** Fichiers déposés (ou choisis dans le navigateur) : leur chemin est inconnu, leur contenu sera écrit à l'enregistrement. */
export async function importMediaFiles(files: File[], atScreen?: { x: number; y: number }) {
  await importEach(
    files.filter(isAcceptedMedia),
    centerOf(atScreen),
    async (file, audio) => {
      const info = await probeBlob(file, audio);
      return info && { info, mediaId: () => addMedia(file) };
    },
    async (file) => file
  );
}

/** Fichiers désignés par leur chemin (version bureau) : lus sur place, sans les charger en mémoire. */
export async function importMediaPaths(paths: string[]) {
  const items = paths.map((path) => ({ path, name: basename(path) }));
  await importEach(
    items,
    centerOf(),
    async ({ path }, audio) => {
      await allowDirOf(path);
      const url = convertFileSrc(path);
      const info = await (audio ? probeAudio(url) : probeVideo(url));
      return info && { info, mediaId: () => addMediaPath(path) };
    },
    async ({ path, name }) => new File([await (await fetch(convertFileSrc(path))).blob()], name)
  );
}

/** Boîte de dialogue d'import de la version bureau. */
export async function pickAndImportMedia() {
  const picked = await open({ multiple: true, directory: false, filters: MEDIA_FILTERS });
  if (picked?.length) await importMediaPaths(picked);
}

/** Boîte de dialogue pour retrouver un média déplacé ; renvoie son nouveau chemin. */
export async function pickMediaFile(name: string): Promise<string | null> {
  const picked = await open({ multiple: false, directory: false, title: `Retrouver ${name}`, filters: MEDIA_FILTERS });
  if (picked) await allowDirOf(picked);
  return picked;
}

/** Insère une vidéo en ligne (au format 16:9, redimensionnable ensuite). */
export function insertVideoLink(url: string) {
  place({ type: "url", url }, 16, 9, { x: PAGE_W / 2, y: PAGE_H / 2 });
}

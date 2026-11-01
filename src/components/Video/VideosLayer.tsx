import { useEffect, useReducer } from "react";
import { ExternalLink, Film, FolderSearch, Link2Off, Music, Pause, Play } from "lucide-react";
import { IS_TAURI, basename, openExternal, showError } from "../../lib/files";
import { importedMedia, pickMediaFile } from "../../lib/importVideo";
import { forgetMediaUrl, mediaUrl, setMediaBlob, setMediaPath } from "../../lib/media";
import { useSessionStore } from "../../store/useSessionStore";
import { parseVideoLink } from "../../lib/videoLinks";
import { PAGE_H, PAGE_W, type View } from "../../lib/view";
import { useBoardStore } from "../../store/useBoardStore";
import type { VideoObject } from "../../types";

/** Position provisoire pendant un déplacement ou un redimensionnement au Transformer. */
export type LiveVideo = Pick<VideoObject, "id" | "x" | "y" | "w" | "h" | "rotation">;

function Message({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 overflow-hidden bg-slate-800 p-3 text-center text-sm text-slate-200">
      {icon}
      <span className="max-w-full truncate">{text}</span>
    </div>
  );
}

function Player({ o, active }: { o: VideoObject; active: boolean }) {
  const cover = "block h-full w-full bg-black";
  if (o.source.type === "file") {
    const src = mediaUrl(o.source.mediaId);
    if (!src) {
      return <Message icon={o.audio ? <Music size={28} /> : <Film size={28} />} text={`Fichier introuvable : ${o.source.name}`} />;
    }
    if (o.audio) {
      return (
        <div className={`flex h-full w-full flex-col justify-center gap-2 overflow-hidden rounded-lg bg-slate-800 pr-4 text-slate-100 ${active ? "pl-4" : "pl-[20%]"}`}>
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <Music size={20} className="shrink-0" />
            <span className="truncate">{o.source.name}</span>
          </div>
          <audio data-video-player={o.id} className="w-full" src={src} controls={active} preload="metadata" />
        </div>
      );
    }
    return <video data-video-player={o.id} className={cover} src={src} poster={o.poster} controls={active} playsInline preload="metadata" />;
  }
  const link = parseVideoLink(o.source.url);
  if (link?.kind === "embed") {
    return (
      <iframe
        className={cover}
        src={link.src}
        title="Vidéo en ligne"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    );
  }
  if (link?.kind === "direct") {
    return <video data-video-player={o.id} className={cover} src={link.src} controls={active} playsInline preload="metadata" />;
  }
  return <Message icon={<Link2Off size={28} />} text={o.source.url} />;
}

/** Les vidéos, sous le canvas transparent : les annotations restent par-dessus, même en lecture. */
export function VideosLayer(props: { videos: VideoObject[]; view: View; live: LiveVideo | null; interactingId: string | null }) {
  const { videos, view, live, interactingId } = props;
  if (!videos.length) return null;
  return (
    <div
      className="pointer-events-none absolute overflow-hidden"
      style={{ left: view.x, top: view.y, width: PAGE_W * view.s, height: PAGE_H * view.s }}
    >
      {videos.map((o) => {
        const g = live?.id === o.id ? live : o;
        const active = interactingId === o.id;
        return (
          <div
            key={o.id}
            className="absolute"
            style={{
              left: g.x * view.s,
              top: g.y * view.s,
              width: g.w * view.s,
              height: g.h * view.s,
              transform: `rotate(${g.rotation}deg)`,
              transformOrigin: "0 0",
              pointerEvents: active ? "auto" : "none",
            }}
          >
            <Player o={o} active={active} />
          </div>
        );
      })}
    </div>
  );
}

const isPlayable = (o: VideoObject) =>
  o.source.type === "file" ? !!mediaUrl(o.source.mediaId) : parseVideoLink(o.source.url)?.kind !== "page";

const mediaElement = (id: string) => document.querySelector<HTMLMediaElement>(`[data-video-player="${id}"]`);

/** Boutons lecture/pause, au-dessus du canvas : un clic suffit, sans sélectionner le média. */
export function PlayButtons({ videos, view, live, interactingId }: { videos: VideoObject[]; view: View; live: LiveVideo | null; interactingId: string | null }) {
  const [, refresh] = useReducer((n: number) => n + 1, 0);

  // Ces événements ne remontent pas : on les écoute en phase de capture
  useEffect(() => {
    const events = ["play", "pause", "ended"];
    events.forEach((n) => document.addEventListener(n, refresh, true));
    return () => events.forEach((n) => document.removeEventListener(n, refresh, true));
  }, []);

  const start = (o: VideoObject, el: HTMLMediaElement | null) => {
    void el?.play().catch(() => {});
    const st = useBoardStore.getState();
    // Avec un outil de dessin, le tableau reste actif pour annoter pendant la lecture
    if (st.tool === "select" || !el) {
      st.select(o.id);
      st.setInteracting(o.id);
    }
  };

  return (
    <>
      {videos.filter(isPlayable).map((o) => {
        if (interactingId === o.id) return null;
        const g = live?.id === o.id ? live : o;
        const el = mediaElement(o.id);
        const playing = !!el && !el.paused && !el.ended;
        const box = Math.min(g.w, g.h) * view.s;
        const size = Math.max(32, Math.min(playing ? 40 : 64, box * 0.7));
        // Son : à gauche ; vidéo : au centre, puis dans le coin pour ne pas masquer l'image en lecture
        const m = (size / 2 + 8) / view.s;
        const px = o.audio ? g.h / 2 : playing ? g.w - m : g.w / 2;
        const py = o.audio ? g.h / 2 : playing ? g.h - m : g.h / 2;
        const a = (g.rotation * Math.PI) / 180;
        return (
          <button
            key={o.id}
            type="button"
            title={playing ? "Pause" : "Lecture"}
            aria-label={playing ? "Pause" : "Lecture"}
            className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-blue-600/90 text-white shadow-lg hover:bg-blue-700"
            style={{
              left: view.x + (g.x + px * Math.cos(a) - py * Math.sin(a)) * view.s,
              top: view.y + (g.y + px * Math.sin(a) + py * Math.cos(a)) * view.s,
              width: size,
              height: size,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => (playing ? el.pause() : start(o, el))}
          >
            {playing ? <Pause size={size * 0.5} /> : <Play size={size * 0.5} />}
          </button>
        );
      })}
    </>
  );
}

/** Boutons sous la vidéo sélectionnée (au-dessus du canvas). */
export function VideoBar({ o, view, live }: { o: VideoObject; view: View; live: LiveVideo | null }) {
  const updateObject = useBoardStore((s) => s.updateObject);
  const g = live?.id === o.id ? live : o;
  const a = (g.rotation * Math.PI) / 180;
  const corners = [[0, 0], [g.w, 0], [0, g.h], [g.w, g.h]].map(([x, y]) => ({
    x: view.x + (g.x + x * Math.cos(a) - y * Math.sin(a)) * view.s,
    y: view.y + (g.y + x * Math.sin(a) + y * Math.cos(a)) * view.s,
  }));
  const cx = (Math.min(...corners.map((c) => c.x)) + Math.max(...corners.map((c) => c.x))) / 2;
  const bottom = Math.max(...corners.map((c) => c.y)) + 12;
  const url = o.source.type === "url" ? o.source.url : null;
  const missing = o.source.type === "file" && !mediaUrl(o.source.mediaId);
  const relocate = async () => {
    if (o.source.type !== "file") return;
    const path = await pickMediaFile(o.source.name);
    if (!path) return;
    // Un WMA retrouvé (fréquent après un import GWB) doit être converti pour être lu
    const { setBusy } = useSessionStore.getState();
    setBusy(`Import de ${basename(path)}…`);
    try {
      const loaded = await importedMedia(path, !!o.audio, (r) => setBusy(`Conversion de ${basename(path)} : ${Math.round(r * 100)} %`));
      if (!loaded) {
        await showError(`Impossible de lire « ${basename(path)} ».`);
        return;
      }
      forgetMediaUrl(o.source.mediaId);
      if (loaded.blob) setMediaBlob(o.source.mediaId, loaded.blob);
      else setMediaPath(o.source.mediaId, path);
      updateObject(o.id, { source: { ...o.source, name: loaded.name } });
    } finally {
      setBusy(null);
    }
  };
  const button = "flex h-11 items-center gap-2 whitespace-nowrap rounded-xl px-3 text-sm font-medium";
  if (!url && !(missing && IS_TAURI)) return null;

  return (
    <div
      className="absolute z-10 flex -translate-x-1/2 gap-1 rounded-2xl border border-slate-200 bg-white/95 p-1 shadow-xl"
      style={{ left: cx, top: `min(${bottom}px, calc(100% - 64px))` }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {missing && IS_TAURI && (
        <button type="button" className={`${button} text-slate-700 hover:bg-slate-100`} onClick={() => void relocate()}>
          <FolderSearch size={20} />
          Retrouver le fichier
        </button>
      )}
      {url && (
        <button type="button" className={`${button} text-slate-700 hover:bg-slate-100`} onClick={() => void openExternal(url)}>
          <ExternalLink size={20} />
          Ouvrir dans le navigateur
        </button>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { insertVideoLink } from "../../lib/importVideo";
import { parseVideoLink } from "../../lib/videoLinks";

export default function VideoLinkDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const link = parseVideoLink(text);

  useEffect(() => inputRef.current?.focus(), []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!link) return;
    insertVideoLink(link.kind === "page" ? link.src : text.trim().replace(/^(?!https?:\/\/)/i, "https://"));
    onClose();
  };

  // Rendu hors de la barre d'outils, dont le flou d'arrière-plan piégerait un élément « fixed »
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onPointerDown={onClose}>
      <form
        className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
        onSubmit={submit}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <label htmlFor="video-link" className="block text-lg font-semibold text-slate-800">
          Lien vidéo
        </label>
        <input
          id="video-link"
          ref={inputRef}
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          className="mt-3 h-12 w-full rounded-xl border border-slate-300 px-3 text-base text-slate-900 outline-none focus:border-blue-600"
        />
        <p className="mt-2 min-h-10 text-sm text-slate-500">
          {link?.kind === "page"
            ? "Ce site ne peut pas être lu dans le tableau : le lien s'ouvrira dans le navigateur."
            : "YouTube, Vimeo, Dailymotion ou adresse directe d'un fichier vidéo. La lecture demande une connexion Internet."}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-11 rounded-xl px-4 font-medium text-slate-600 hover:bg-slate-100">
            Annuler
          </button>
          <button type="submit" disabled={!link} className="h-11 rounded-xl bg-blue-600 px-4 font-medium text-white disabled:opacity-40">
            Insérer
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

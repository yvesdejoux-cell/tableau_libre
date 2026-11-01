import { nanoid } from "nanoid";
import { SHAPE_TOOLS, type BackgroundType, type BoardObject, type Page } from "../types";
import { APP_NAME } from "./app";
import { BACKGROUND_LABELS } from "./backgrounds";
import { DEFAULT_TEXT_SIZE, MIN_TEXT_W, clampFontSize } from "./text";
import { PAGE_H, PAGE_W } from "./view";

const ASSET_PREFIX = "asset:";
const BACKGROUNDS = Object.keys(BACKGROUND_LABELS) as BackgroundType[];

export interface SessionFile {
  format: "iwb";
  version: 2;
  savedAt: string;
  pageSize: { w: number; h: number };
  currentPageIndex: number;
  pages: { id: string; background: BackgroundType; objects: BoardObject[] }[];
  assets: Record<string, string>; // id → data URL
}

/** Sérialise la session. Les images sont dédoublonnées dans `assets`. */
export function serializeSession(pages: Page[], currentPageId: string): string {
  const assets: Record<string, string> = {};
  const idBySrc = new Map<string, string>();
  const ref = (src: string) => {
    let id = idBySrc.get(src);
    if (!id) {
      id = `a${idBySrc.size + 1}`;
      idBySrc.set(src, id);
      assets[id] = src;
    }
    return ASSET_PREFIX + id;
  };

  const file: SessionFile = {
    format: "iwb",
    version: 2,
    savedAt: new Date().toISOString(),
    pageSize: { w: PAGE_W, h: PAGE_H },
    currentPageIndex: Math.max(0, pages.findIndex((p) => p.id === currentPageId)),
    pages: pages.map((p) => ({
      id: p.id,
      background: p.background,
      objects: p.objects.map((o) => (o.kind === "image" ? { ...o, src: ref(o.src) } : o)),
    })),
    assets,
  };
  return JSON.stringify(file);
}

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);

/** Valide et reconstruit un objet ; un objet invalide est simplement ignoré. */
export function sanitizeObject(o: unknown, assets: Record<string, string> = {}): BoardObject[] {
  if (!o || typeof o !== "object") return [];
  const r = o as Record<string, unknown>;
  const base = {
    id: str(r.id, nanoid()),
    x: num(r.x, 0),
    y: num(r.y, 0),
    scaleX: num(r.scaleX, 1),
    scaleY: num(r.scaleY, 1),
    rotation: num(r.rotation, 0),
  };

  switch (r.kind) {
    case "stroke": {
      const points = Array.isArray(r.points)
        ? r.points.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
        : [];
      if (points.length < 4) return [];
      const tool = r.tool === "highlighter" || r.tool === "eraser" ? r.tool : "pen";
      return [{ ...base, kind: "stroke", tool, points, color: str(r.color, "#111827"), width: num(r.width, 4), ...(r.closed === true ? { closed: true as const } : {}) }];
    }
    case "shape": {
      const shape = r.shape === "triangle" ? "triangle" : SHAPE_TOOLS.find((s) => s === r.shape);
      if (!shape) return [];
      return [
        {
          ...base,
          kind: "shape",
          shape,
          w: num(r.w, 0),
          h: num(r.h, 0),
          color: str(r.color, "#111827"),
          width: num(r.width, 4),
          ...(typeof r.fill === "string" ? { fill: r.fill } : {}),
        },
      ];
    }
    case "image": {
      const ref = str(r.src, "");
      const src = ref.startsWith(ASSET_PREFIX) ? assets[ref.slice(ASSET_PREFIX.length)] : ref;
      // Uniquement des images embarquées : jamais d'URL externe
      if (typeof src !== "string" || !src.startsWith("data:image/")) return [];
      return [{ ...base, kind: "image", src, w: num(r.w, 100), h: num(r.h, 100) }];
    }
    case "text": {
      const text = str(r.text, "");
      if (!text.trim()) return [];
      return [
        {
          ...base,
          kind: "text",
          text,
          w: Math.max(MIN_TEXT_W, num(r.w, 700)),
          fontSize: clampFontSize(num(r.fontSize, DEFAULT_TEXT_SIZE)),
          color: str(r.color, "#111827"),
          scaleX: 1,
          scaleY: 1,
          ...(typeof r.font === "string" && r.font ? { font: r.font } : {}),
          ...(r.bold === true ? { bold: true as const } : {}),
          ...(r.italic === true ? { italic: true as const } : {}),
          ...(r.underline === true ? { underline: true as const } : {}),
          ...(r.align === "center" || r.align === "right" ? { align: r.align } : {}),
        },
      ];
    }
    case "video": {
      const s = r.source as Record<string, unknown> | null | undefined;
      const poster = typeof r.poster === "string" && r.poster.startsWith("data:image/") ? r.poster : undefined;
      const video = {
        ...base,
        kind: "video" as const,
        w: num(r.w, 640),
        h: num(r.h, 360),
        ...(poster ? { poster } : {}),
        ...(r.audio === true ? { audio: true as const } : {}),
      };
      if (s?.type === "file" && typeof s.mediaId === "string" && /^[\w-]+$/.test(s.mediaId)) {
        return [{ ...video, source: { type: "file", mediaId: s.mediaId, name: str(s.name, "") } }];
      }
      // Uniquement des adresses web : jamais de javascript: ni de fichier local
      if (s?.type === "url" && typeof s.url === "string" && /^https?:\/\//i.test(s.url)) {
        return [{ ...video, source: { type: "url", url: s.url } }];
      }
      return [];
    }
    default:
      return [];
  }
}

export function parseSession(text: string): { pages: Page[]; currentPageId: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Fichier illisible : ce n'est pas une session valide.");
  }

  const f = raw as Omit<Partial<SessionFile>, "version"> & { version?: number } | null;
  if (!f || f.format !== "iwb" || typeof f.version !== "number") {
    throw new Error(`Ce fichier n'est pas une session ${APP_NAME}.`);
  }
  if (f.version > 2) {
    throw new Error("Cette session a été créée avec une version plus récente de l'application.");
  }
  if (!Array.isArray(f.pages) || f.pages.length === 0) {
    throw new Error("La session ne contient aucune page.");
  }

  const assets = f.assets && typeof f.assets === "object" ? f.assets : {};
  const pages: Page[] = f.pages.map((p) => ({
    id: str(p?.id, nanoid()),
    background: BACKGROUNDS.includes(p?.background as BackgroundType) ? (p.background as BackgroundType) : "blank",
    objects: (Array.isArray(p?.objects) ? p.objects : []).flatMap((o) => sanitizeObject(o, assets)),
  }));

  const idx = Math.min(Math.max(0, num(f.currentPageIndex, 0)), pages.length - 1);
  return { pages, currentPageId: pages[idx].id };
}

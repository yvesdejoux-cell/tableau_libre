import { nanoid } from "nanoid";
import type { BackgroundType, BoardObject, Page } from "../types";
import { sanitizeObject } from "./session";
import { BACKGROUND_LABELS } from "./backgrounds";
import { MIN_TEXT_W, clampFontSize } from "./text";
import { HIGHLIGHT_OPACITY, TEXT_MARGIN, TL_NS, UB_NS } from "./ubz";
import { parseVideoLink } from "./videoLinks";
import { PAGE_H, PAGE_W } from "./view";

/**
 * Lecture du format UBZ. Un objet écrit par Tableau Libre et non réécrit par OpenBoard est repris tel quel
 * (`tl:object`) ; sinon, il est reconstruit depuis le SVG, comme pour un document créé dans OpenBoard.
 */
export interface UbzSource {
  names: string[];
  text(name: string): Promise<string>;
  /** Contenu d'une image, en data URL. */
  image(name: string): Promise<string>;
}

export interface UbzPages {
  pages: Page[];
  currentPageId: string;
  /** Emplacement dans le zip de chaque son ou vidéo, par mediaId. */
  media: Map<string, string>;
  warnings: string[];
}

const XLINK_NS = "http://www.w3.org/1999/xlink";
const LINK_W = 640;
const LINK_H = 360;
const PX_PER_PT = 96 / 72;
const tf = { scaleX: 1, scaleY: 1 };
const MISSING_MEDIA = /^Fichier introuvable : (.+\.\w+)$/;
const AUDIO_NAME = /\.(mp3|wav|flac|ogg|oga|opus|m4a|aac|wma|aif|aiff|amr|ac3|mka)$/i;

type Matrix = [number, number, number, number, number, number];
type Pt = [number, number];

const num = (v: string | null | undefined, d: number) => {
  const n = v == null ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

function parseMatrix(s: string | null): Matrix {
  const m = s && /matrix\(([^)]+)\)/.exec(s);
  const v = m ? m[1].split(/[\s,]+/).map(Number) : [];
  return v.length === 6 && v.every(Number.isFinite) ? (v as Matrix) : [1, 0, 0, 1, 0, 0];
}
const apply = (m: Matrix, x: number, y: number): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function parsePoints(s: string | null, m: Matrix): Pt[] {
  const v = (s ?? "").trim().split(/[\s,]+/).map(Number);
  const out: Pt[] = [];
  for (let i = 0; i + 1 < v.length; i += 2) if (Number.isFinite(v[i]) && Number.isFinite(v[i + 1])) out.push(apply(m, v[i], v[i + 1]));
  return out;
}

const area = (r: Pt[]) => r.reduce((s, [x, y], i) => {
  const [nx, ny] = r[(i + 1) % r.length];
  return s + x * ny - nx * y;
}, 0);

/**
 * Plusieurs polygones en un seul contour : même sens de parcours et liaisons sans surface,
 * pour que leurs recouvrements restent pleins. OpenBoard découpe un trait en polygones de ce genre.
 */
export function mergeRings(rings: Pt[][]): number[] {
  const out: number[] = [];
  for (const ring of rings) {
    const r = area(ring) < 0 ? [...ring].reverse() : ring;
    for (const [x, y] of r) out.push(x, y);
    out.push(r[0][0], r[0][1]);
  }
  if (rings.length > 1) out.push(out[0], out[1]);
  return out;
}

interface TextStyle {
  font?: string;
  fontSize?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

function styleOf(css: string | null): TextStyle {
  const s = css ?? "";
  const get = (re: RegExp) => re.exec(s)?.[1];
  const size = /font-size:\s*([\d.]+)(px|pt)/.exec(s);
  const weight = get(/font-weight:\s*(\d+|bold)/);
  return {
    font: get(/font-family:\s*'?([^;']+)'?/),
    fontSize: size ? parseFloat(size[1]) * (size[2] === "pt" ? PX_PER_PT : 1) : undefined,
    color: get(/(?:^|[;\s])color:\s*(#[0-9a-fA-F]{6})/),
    bold: weight ? weight === "bold" || Number(weight) >= 600 : undefined,
    italic: /font-style:\s*italic/.test(s) ? true : undefined,
    underline: /text-decoration:[^;]*underline/.test(s) ? true : undefined,
  };
}

/** Le texte d'une zone OpenBoard : un style par zone, celui du premier passage écrit. */
function parseQtText(content: string): { text: string; style: TextStyle; align?: "center" | "right"; link: string | null; mixed: boolean } {
  const doc = new DOMParser().parseFromString(content, "text/html");
  const paragraphs = [...doc.body.querySelectorAll("p")];
  const lineOf = (p: Element) => {
    const clone = p.cloneNode(true) as Element;
    clone.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
    return clone.textContent ?? "";
  };
  const text = paragraphs.length ? paragraphs.map(lineOf).join("\n") : doc.body.textContent ?? "";
  const spans = [...doc.body.querySelectorAll("span")].filter((s) => s.textContent?.trim());
  const body = styleOf(doc.body.getAttribute("style"));
  const first = styleOf(spans[0]?.getAttribute("style") ?? null);
  const style: TextStyle = { ...body };
  for (const [k, v] of Object.entries(first)) if (v !== undefined) (style as Record<string, unknown>)[k] = v;
  const a = paragraphs[0]?.getAttribute("align");
  const links = [...doc.body.querySelectorAll("a[href]")];
  const href = links.length === 1 ? links[0].getAttribute("href") : null;
  return {
    text,
    style,
    align: a === "center" || a === "right" ? a : undefined,
    link: href && text.trim() === (links[0].textContent ?? "").trim() ? href : null,
    mixed: new Set(spans.map((s) => s.getAttribute("style"))).size > 1,
  };
}

const BACKGROUND_TYPES = Object.keys(BACKGROUND_LABELS) as BackgroundType[];

function backgroundOf(root: Element): BackgroundType {
  const own = root.getAttributeNS(TL_NS, "background") as BackgroundType | null;
  if (own && BACKGROUND_TYPES.includes(own)) return own;
  const on = (name: string) => root.getAttributeNS(UB_NS, name) === "true";
  if (on("dark-background")) return "black";
  if (on("crossed-background")) return num(root.getAttributeNS(UB_NS, "intermediate-lines"), 0) ? "seyes" : "grid";
  return on("ruled-background") ? "lines" : "blank";
}

/** Fichier d'un lien du SVG : OpenBoard retire parfois les accolades, jamais le dossier. */
const hrefOf = (el: Element) => el.getAttributeNS(XLINK_NS, "href") ?? el.getAttribute("href");

async function readPage(svg: string, source: UbzSource, pg: number, media: Map<string, string>, warn: (m: string) => void): Promise<{ page: Page; current: boolean }> {
  const dom = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = dom.documentElement;
  if (root.localName !== "svg" || dom.querySelector("parsererror")) throw new Error(`Page ${pg} illisible : ce n'est pas un fichier UBZ valide.`);

  const [w0, h0] = (root.getAttributeNS(UB_NS, "nominal-size") ?? `${PAGE_W}x${PAGE_H}`).split("x").map(Number);
  const W = w0 > 0 ? w0 : PAGE_W;
  const H = h0 > 0 ? h0 : PAGE_H;
  // Origine au centre de la page ; une page d'une autre taille est mise à l'échelle et centrée, comme à l'import GWB
  const k = Math.min(PAGE_W / W, PAGE_H / H);
  const mapX = (x: number) => PAGE_W / 2 + x * k;
  const mapY = (y: number) => PAGE_H / 2 + y * k;
  const toPage = (r: Pt[]): Pt[] => r.map(([x, y]) => [mapX(x), mapY(y)]);

  const mediaIdFor = (href: string) => {
    for (const [id, at] of media) if (at === href) return id;
    const id = nanoid();
    media.set(id, href);
    return id;
  };

  /** L'objet tel que Tableau Libre l'a écrit. */
  const stored = async (el: Element): Promise<BoardObject[] | null> => {
    const raw = el.getAttributeNS(TL_NS, "object");
    if (!raw) return null;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
    const href = hrefOf(el);
    if (data.kind === "image" && href && source.names.includes(href)) data.src = await source.image(href);
    const mediaId = (data.source as { mediaId?: unknown } | undefined)?.mediaId;
    if (data.kind === "video" && href && typeof mediaId === "string") media.set(mediaId, href);
    return sanitizeObject(data);
  };

  const fromGroup = (g: Element): BoardObject[] => {
    const out: BoardObject[] = [];
    const polygons = new Map<string, { fill: string; soft: boolean; rings: Pt[][] }>();
    for (const el of g.children) {
      const m = parseMatrix(el.getAttribute("transform"));
      if (el.localName === "polyline" || el.localName === "line") {
        const pts = el.localName === "line"
          ? [apply(m, num(el.getAttribute("x1"), 0), num(el.getAttribute("y1"), 0)), apply(m, num(el.getAttribute("x2"), 0), num(el.getAttribute("y2"), 0))]
          : parsePoints(el.getAttribute("points"), m);
        if (pts.length < 2) continue;
        out.push({
          ...tf,
          id: nanoid(),
          kind: "stroke",
          tool: num(el.getAttribute("stroke-opacity"), 1) < 1 ? "highlighter" : "pen",
          x: 0,
          y: 0,
          rotation: 0,
          points: toPage(pts).flat(),
          color: el.getAttribute("stroke") ?? "#000000",
          width: Math.max(1, num(el.getAttribute("stroke-width"), 2) * k),
        });
      } else if (el.localName === "polygon") {
        const ring = parsePoints(el.getAttribute("points"), m);
        if (ring.length < 3) continue;
        const fill = el.getAttribute("fill") ?? "#000000";
        const soft = num(el.getAttribute("fill-opacity"), 1) <= HIGHLIGHT_OPACITY + 0.2;
        const key = `${fill}|${soft}`;
        const e = polygons.get(key) ?? { fill, soft, rings: [] };
        e.rings.push(toPage(ring));
        polygons.set(key, e);
      }
    }
    const filled: BoardObject[] = [...polygons.values()].map((p) => ({
      ...tf,
      id: nanoid(),
      kind: "stroke",
      tool: p.soft ? "highlighter" : "pen",
      closed: true,
      x: 0,
      y: 0,
      rotation: 0,
      points: mergeRings(p.rings),
      color: p.fill,
      width: 0,
    }));
    return [...filled, ...out];
  };

  const place = (el: Element) => {
    const m = parseMatrix(el.getAttribute("transform"));
    const sx = Math.hypot(m[0], m[1]) || 1;
    const sy = Math.hypot(m[2], m[3]) || 1;
    return {
      ...tf,
      id: nanoid(),
      x: mapX(m[4]),
      y: mapY(m[5]),
      rotation: (Math.atan2(m[1], m[0]) * 180) / Math.PI,
      sx,
      sy,
    };
  };

  const fromElement = async (el: Element): Promise<BoardObject[]> => {
    if (el.getAttributeNS(TL_NS, "decor")) return []; // lignes de la portée, redessinées par le fond
    const own = await stored(el);
    if (own) return own;
    switch (el.localName) {
      case "g":
        return fromGroup(el);
      case "polygon":
      case "polyline":
      case "line": {
        const wrap = dom.createElementNS(root.namespaceURI, "g");
        wrap.appendChild(el.cloneNode());
        return fromGroup(wrap);
      }
      case "image": {
        const href = hrefOf(el);
        if (!href || !source.names.includes(href)) {
          warn(`page ${pg} : image manquante dans le fichier, ignorée`);
          return [];
        }
        const { sx, sy, ...at } = place(el);
        return [{
          ...at,
          kind: "image",
          src: await source.image(href),
          w: num(el.getAttribute("width"), 100) * sx * k,
          h: num(el.getAttribute("height"), 100) * sy * k,
        }];
      }
      case "audio":
      case "video": {
        const href = hrefOf(el);
        if (!href) return [];
        const { sx, sy, ...at } = place(el);
        const name = href.split("/").pop() ?? href;
        return [{
          ...at,
          kind: "video",
          ...(el.localName === "audio" ? { audio: true as const } : {}),
          source: { type: "file", mediaId: mediaIdFor(href), name },
          w: num(el.getAttribute("width"), 320) * sx * k,
          h: num(el.getAttribute("height"), 64) * sy * k,
        }];
      }
      case "foreignObject": {
        if (el.getAttributeNS(UB_NS, "type") !== "text") {
          warn(`page ${pg} : contenu OpenBoard non pris en charge (widget ou PDF), ignoré`);
          return [];
        }
        const q = parseQtText(el.textContent ?? "");
        const { sx, sy, ...at } = place(el);
        const pos = { ...at, x: at.x + TEXT_MARGIN * k, y: at.y + TEXT_MARGIN * k };
        // Le lien d'une vidéo, conservé par OpenBoard sous forme de texte
        if (q.link && parseVideoLink(q.link)) {
          const video = sanitizeObject({ ...pos, kind: "video", w: LINK_W, h: LINK_H, source: { type: "url", url: q.link } });
          if (video.length) return video;
        }
        if (!q.text.trim()) return [];
        // Le remplaçant d'un média introuvable, réécrit par OpenBoard : il reste à retrouver
        const lost = MISSING_MEDIA.exec(q.text.trim());
        if (lost) {
          const audio = AUDIO_NAME.test(lost[1]);
          return [{
            ...pos,
            kind: "video",
            ...(audio ? { audio: true as const } : {}),
            source: { type: "file", mediaId: nanoid(), name: lost[1] },
            w: audio ? 320 : 480,
            h: audio ? 64 : 270,
          }];
        }
        if (q.mixed) warn(`page ${pg} : un texte à plusieurs styles a été simplifié`);
        return [{
          ...pos,
          kind: "text",
          text: q.text,
          w: Math.max(MIN_TEXT_W, num(el.getAttribute("width"), 700) * sx * k - 2 * TEXT_MARGIN * k),
          fontSize: clampFontSize((q.style.fontSize ?? 24) * sy * k),
          color: q.style.color ?? "#000000",
          ...(q.style.font ? { font: q.style.font } : {}),
          ...(q.style.bold ? { bold: true as const } : {}),
          ...(q.style.italic ? { italic: true as const } : {}),
          ...(q.style.underline ? { underline: true as const } : {}),
          ...(q.align ? { align: q.align } : {}),
        }];
      }
      default:
        return []; // fond, et instruments d'OpenBoard (règle, compas…) laissés sur la page
    }
  };

  const zOf = (el: Element) => num(el.getAttributeNS(UB_NS, "z-value"), 0);
  // Tri stable : à z égal, l'ordre du fichier
  const ordered = [...root.children].map((el, i) => ({ el, i })).sort((a, b) => zOf(a.el) - zOf(b.el) || a.i - b.i);
  const read: { o: BoardObject; index: number | null }[] = [];
  for (const { el } of ordered) {
    const at = el.getAttributeNS(TL_NS, "index");
    for (const o of await fromElement(el)) read.push({ o, index: at === null ? null : Number(at) });
  }
  // Page non réécrite : l'ordre d'origine, que le premier plan des lecteurs dans OpenBoard a changé
  if (read.every((r) => r.index !== null)) read.sort((a, b) => a.index! - b.index!);
  const objects = read.map((r) => r.o);
  return {
    page: { id: nanoid(), background: backgroundOf(root), objects },
    current: root.getAttributeNS(TL_NS, "current-page") === "true",
  };
}

export async function readUbz(source: UbzSource): Promise<UbzPages> {
  const pageNames = source.names.filter((n) => /^page\d+\.svg$/.test(n)).sort((a, b) => parseInt(a.slice(4), 10) - parseInt(b.slice(4), 10));
  if (!pageNames.length) throw new Error("Ce fichier ne contient aucune page OpenBoard.");
  const warnings: string[] = [];
  const warn = (m: string) => {
    if (!warnings.includes(m)) warnings.push(m);
  };
  const media = new Map<string, string>();
  const pages: Page[] = [];
  let currentPageId: string | null = null;
  for (const [i, name] of pageNames.entries()) {
    const { page, current } = await readPage(await source.text(name), source, i + 1, media, warn);
    pages.push(page);
    if (current) currentPageId = page.id;
  }
  return { pages, currentPageId: currentPageId ?? pages[0].id, media, warnings };
}

import { nanoid } from "nanoid";
import type { BoardObject, Page } from "../types";
import { MIN_TEXT_W, TEXT_LINE_HEIGHT, clampFontSize } from "./text";
import { PAGE_H, PAGE_W } from "./view";

/**
 * Lecture des fichiers Interwrite Workspace (.gwb, établi sur GWB 6.09).
 * Structure déterminée par analyse de fichiers réels (voir gwb2ubz.py, dossier « conversion workspace »).
 * Ce module ne dépend pas du navigateur : images et mesures de texte lui sont fournies par importGwb.ts.
 */
const OBJ_STROKE = 0x12d;
const OBJ_TEXT = 0x12e;
const OBJ_LINE = 0x12f;
const OBJ_IMAGE = 0x132;
const OBJ_GROUP = 0x133;
const OBJ_SHAPE = 0x138;
const OBJ_HIGHLIGHT = 0x13b;

const BG_IMAGE = 1001;
const BG_COLOR = 1002;

const SHAPE_ELLIPSE = 112;
const SHAPE_TRIANGLE = 115;

const TRAILER_SIZE = 4256; // bloc commun de propriétés en fin de chaque objet
const PX_PER_PT = 96 / 72; // tailles RTF en points ; une page Workspace est en pixels à 96 dpi

export type GwbImageFormat = "png" | "jpeg" | "gif" | "bmp";

export interface GwbTextStyle {
  font: string | null;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export interface GwbParagraph extends GwbTextStyle {
  text: string;
  align: "left" | "center" | "right" | "justify";
  mixed: boolean; // plusieurs styles dans le paragraphe
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type GwbLink = { target: string };

export type GwbObject = { link?: GwbLink } & (
  | ({ type: "image"; data: Uint8Array; format: GwbImageFormat; rot: number; colorKey: string | null } & Box)
  | ({ type: "text"; paragraphs: GwbParagraph[] } & Box)
  | { type: "stroke"; points: [number, number][]; color: string; width: number; highlighter: boolean }
  | ({ type: "shape"; kind: "rect" | "ellipse" | "triangle"; color: string; width: number; fill: string | null; rot: number } & Box)
);

export interface GwbPage {
  width: number;
  height: number;
  bgColor: string;
  bgImage: Uint8Array | null;
  objects: GwbObject[];
  hiddenObjects: number;
  thumbnail: Uint8Array | null; // seule image d'une page illisible
  fallback: boolean;
}

export interface GwbDocument {
  version: string;
  pages: GwbPage[];
  warnings: string[];
}

export const isGwb = (head: Uint8Array) => head[0] === 0x47 && head[1] === 0x57 && head[2] === 0x42;

const colorref = (v: number) =>
  `#${[v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff].map((c) => c.toString(16).padStart(2, "0")).join("")}`;

export function imageFormat(d: Uint8Array): GwbImageFormat | null {
  if (d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) return "png";
  if (d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff) return "jpeg";
  if (d[0] === 0x47 && d[1] === 0x49 && d[2] === 0x46) return "gif";
  if (d[0] === 0x42 && d[1] === 0x4d) return "bmp";
  return null;
}

// ---------------------------------------------------------------- RTF (sous-ensemble utilisé par Workspace)

const CHARSET_ENCODING: Record<number, string> = {
  77: "macintosh", 128: "shift_jis", 129: "euc-kr", 134: "gbk", 136: "big5", 161: "windows-1253", 162: "windows-1254",
  163: "windows-1258", 177: "windows-1255", 178: "windows-1256", 186: "windows-1257", 204: "windows-1251",
  222: "windows-874", 238: "windows-1250",
};
const SKIP_DESTINATIONS = new Set([
  "stylesheet", "info", "pict", "object", "header", "footer", "listtable", "listoverridetable", "rsidtbl", "generator",
  "xmlnstbl", "themedata", "colorschememapping", "latentstyles", "datastore", "filetbl", "revtbl", "nonshppict", "shp",
]);
const SPECIAL_CHARS: Record<string, string> = {
  emdash: "\u2014", endash: "\u2013", bullet: "\u2022", lquote: "\u2018", rquote: "\u2019", ldblquote: "\u201c", rdblquote: "\u201d",
};

interface CharStyle {
  f: number;
  fs: number;
  cf: number;
  b: boolean;
  i: boolean;
  ul: boolean;
}
const newChar = (f = 0): CharStyle => ({ f, fs: 24, cf: 0, b: false, i: false, ul: false });

function decodeByte(byte: number, encoding: string): string {
  try {
    return new TextDecoder(encoding).decode(new Uint8Array([byte]));
  } catch {
    return new TextDecoder("windows-1252").decode(new Uint8Array([byte]));
  }
}

/** Le RTF d'une zone de texte, ramené à un style par paragraphe : le plus long du paragraphe. */
export function parseRtf(rtf: string): GwbParagraph[] {
  const fonts = new Map<number, { name: string; charset: number }>();
  const colors: ([number, number, number] | null)[] = [];
  const raw: { align: GwbParagraph["align"]; runs: { text: string; style: CharStyle }[]; style: CharStyle }[] = [];
  let runs: { text: string; style: CharStyle }[] = [];
  let defaultEncoding = "windows-1252";
  let state = { char: newChar(), align: "left" as GwbParagraph["align"], uc: 1, dest: null as string | null };
  const stack: (typeof state)[] = [];
  let skip = 0;
  let fontEntry: { name: string; charset: number } | null = null;

  const emit = (text: string) => {
    if (state.dest === "fonttbl") {
      if (fontEntry) fontEntry.name += text;
      return;
    }
    if (state.dest !== null) return;
    const clean = text.replace(/[\u0000-\u0008\u000b-\u001f]/g, "");
    if (clean) runs.push({ text: clean, style: { ...state.char } });
  };
  const encoding = () => {
    const charset = fonts.get(state.char.f)?.charset;
    return (charset !== undefined && CHARSET_ENCODING[charset]) || defaultEncoding;
  };
  const endParagraph = () => {
    raw.push({ align: state.align, runs, style: { ...state.char } });
    runs = [];
  };

  let i = 0;
  const n = rtf.length;
  while (i < n) {
    const c = rtf[i];
    if (c === "{") {
      stack.push({ ...state, char: { ...state.char } });
      i++;
    } else if (c === "}") {
      if (state.dest === "fonttbl" && stack[stack.length - 1]?.dest === "fonttbl") fontEntry = null;
      const top = stack.pop();
      if (top) state = top;
      i++;
    } else if (c === "\\") {
      i++;
      if (i >= n) break;
      const d = rtf[i];
      if (d === "\\" || d === "{" || d === "}") {
        if (skip) skip--;
        else emit(d);
        i++;
      } else if (d === "'") {
        const hex = parseInt(rtf.slice(i + 1, i + 3), 16);
        i += 3;
        if (skip) skip--;
        else if (!Number.isNaN(hex)) emit(decodeByte(hex, encoding()));
      } else if (d === "*") {
        state.dest = "skip";
        i++;
      } else if (d === "~") {
        emit("\u00a0");
        i++;
      } else if (d === "-") {
        i++;
      } else if (d === "_") {
        emit("\u2011");
        i++;
      } else if (d === "\r" || d === "\n") {
        if (state.dest === null) endParagraph();
        i++;
      } else {
        const m = /^([a-zA-Z]*)(-?\d*) ?/.exec(rtf.slice(i, i + 40))!;
        const word = m[1];
        const param = m[2] && m[2] !== "-" ? parseInt(m[2], 10) : null;
        i += Math.max(1, m[0].length);
        const ch = state.char;

        if (word === "fonttbl") state.dest = "fonttbl";
        else if (word === "colortbl") {
          state.dest = "colortbl";
          colors.push(null);
        } else if (SKIP_DESTINATIONS.has(word)) state.dest = "skip";
        else if (word === "ansicpg" && param) defaultEncoding = `windows-${param}`;
        else if (state.dest === "fonttbl") {
          if (word === "f") {
            fontEntry = { name: "", charset: 0 };
            fonts.set(param ?? 0, fontEntry);
          } else if (word === "fcharset" && fontEntry) fontEntry.charset = param ?? 0;
        } else if (state.dest === "colortbl") {
          const at = ["red", "green", "blue"].indexOf(word);
          if (at >= 0) {
            const last = colors[colors.length - 1] ?? [0, 0, 0];
            last[at] = param ?? 0;
            colors[colors.length - 1] = last;
          }
        } else if (state.dest !== null) {
          /* destination ignorée */
        } else if (word === "par") endParagraph();
        else if (word === "line") emit("\n");
        else if (word === "tab") emit("\t");
        else if (word === "pard" || word === "ql") state.align = "left";
        else if (word === "qj") state.align = "justify";
        else if (word === "qc") state.align = "center";
        else if (word === "qr") state.align = "right";
        else if (word === "plain") state.char = newChar(ch.f);
        else if (word === "f") ch.f = param ?? 0;
        else if (word === "fs") ch.fs = param ?? 24;
        else if (word === "cf") ch.cf = param ?? 0;
        else if (word === "b") ch.b = param !== 0;
        else if (word === "i") ch.i = param !== 0;
        else if (word === "ul") ch.ul = param !== 0;
        else if (word === "ulnone") ch.ul = false;
        else if (word === "uc") state.uc = param ?? 0;
        else if (word === "u") {
          emit(String.fromCharCode((param ?? 0) < 0 ? (param ?? 0) + 65536 : param ?? 0));
          skip = state.uc;
        } else if (SPECIAL_CHARS[word]) emit(SPECIAL_CHARS[word]);
      }
    } else if (c === "\r" || c === "\n") {
      i++;
    } else if (c === ";" && state.dest === "colortbl") {
      colors.push(null);
      i++;
    } else {
      let j = i;
      while (j < n && !"\\{}\r\n".includes(rtf[j]) && !(rtf[j] === ";" && state.dest === "colortbl")) j++;
      let text = rtf.slice(i, j);
      if (skip) {
        const drop = Math.min(skip, text.length);
        text = text.slice(drop);
        skip -= drop;
      }
      emit(text);
      i = j;
    }
  }
  if (runs.length) endParagraph();
  // Le dernier paragraphe produit par Workspace est vide (police System 10 pt)
  const blank = (p: (typeof raw)[number]) => !p.runs.map((r) => r.text).join("").trim();
  while (raw.length && blank(raw[raw.length - 1])) raw.pop();

  const colorOf = (idx: number) => {
    const col = idx > 0 ? colors[idx] : null;
    return col ? `#${col.map((v) => v.toString(16).padStart(2, "0")).join("")}` : "#000000";
  };
  const key = (s: CharStyle) => `${s.f}|${s.fs}|${s.cf}|${s.b}|${s.i}|${s.ul}`;
  return raw.map((p) => {
    const lengths = new Map<string, { style: CharStyle; len: number }>();
    for (const r of p.runs) {
      if (!r.text.trim()) continue;
      const e = lengths.get(key(r.style)) ?? { style: r.style, len: 0 };
      e.len += r.text.length;
      lengths.set(key(r.style), e);
    }
    const main = [...lengths.values()].sort((a, b) => b.len - a.len)[0]?.style ?? p.style;
    return {
      text: p.runs.map((r) => r.text).join(""),
      align: p.align,
      mixed: lengths.size > 1,
      font: fonts.get(main.f)?.name.replace(/;/g, "").trim() || null,
      size: (main.fs / 2) * PX_PER_PT,
      color: colorOf(main.cf),
      bold: main.b,
      italic: main.i,
      underline: main.ul,
    };
  });
}

// ---------------------------------------------------------------- Structure binaire

class Reader {
  readonly view: DataView;
  constructor(readonly d: Uint8Array) {
    this.view = new DataView(d.buffer, d.byteOffset, d.byteLength);
  }
  u32 = (o: number) => this.view.getUint32(o, true);
  i32 = (o: number) => this.view.getInt32(o, true);
  f32 = (o: number) => this.view.getFloat32(o, true);
  /** Chaîne UTF-16LE préfixée par sa longueur en caractères. */
  ustr(o: number): [string, number] {
    const len = this.u32(o);
    if (len > 100000) throw new Error(`longueur de chaîne invalide à l'offset ${o}`);
    const end = o + 4 + 2 * len;
    return [new TextDecoder("utf-16le").decode(this.d.subarray(o + 4, end)), end];
  }
  /** Chaîne UTF-16LE terminée par un zéro, dans un tampon fixe. */
  zstr16(o: number, limit: number): string {
    let end = o;
    while (end + 1 < limit && (this.d[end] || this.d[end + 1])) end += 2;
    return new TextDecoder("utf-16le").decode(this.d.subarray(o, end));
  }
  points(o: number, count: number, limit: number): [number, number][] {
    const avail = Math.floor((limit - o) / 8);
    const out: [number, number][] = [];
    for (let k = 0; k < Math.max(0, Math.min(count, avail)); k++) {
      const x = this.f32(o + 8 * k);
      const y = this.f32(o + 8 * k + 4);
      const last = out[out.length - 1];
      if (Number.isFinite(x) && Number.isFinite(y) && (!last || Math.abs(x - last[0]) > 0.01 || Math.abs(y - last[1]) > 0.01)) out.push([x, y]);
    }
    return out;
  }
}

function decodeObject(r: Reader, warn: (m: string) => void, pg: number, t: number, o: number, size: number): GwbObject | GwbObject[] | null {
  const box = (at: number): Box => ({ x: r.f32(at), y: r.f32(at + 4), w: r.f32(at + 8), h: r.f32(at + 12) });
  const trailer = o + size - TRAILER_SIZE;
  switch (t) {
    case OBJ_IMAGE: {
      const n = r.u32(o + 32);
      const data = r.d.subarray(o + 64, o + 64 + n);
      const format = imageFormat(data);
      if (!format) {
        warn(`page ${pg} : format d'image inconnu, image ignorée`);
        return null;
      }
      return { type: "image", data, format, rot: r.f32(o + 60), colorKey: r.u32(o + 52) ? colorref(r.u32(o + 56)) : null, ...box(o + 36) };
    }
    case OBJ_TEXT: {
      const n = r.u32(o + 8);
      // Le RTF est de l'ASCII ; les caractères accentués y sont échappés
      const rtf = new TextDecoder("latin1").decode(r.d.subarray(o + 12, o + 12 + n)).split("\0")[0];
      return { type: "text", paragraphs: parseRtf(rtf), ...box(o + 12 + n + 4) };
    }
    case OBJ_STROKE:
      return { type: "stroke", points: r.points(o + 456, Infinity, trailer), color: colorref(r.u32(o + 12)), width: r.u32(o + 20), highlighter: false };
    case OBJ_HIGHLIGHT:
      return { type: "stroke", points: r.points(o + 28, 2 * r.u32(o + 24), trailer), color: colorref(r.u32(o + 12)), width: r.u32(o + 16), highlighter: true };
    case OBJ_LINE:
      return {
        type: "stroke",
        points: [[r.f32(o + 468), r.f32(o + 472)], [r.f32(o + 476), r.f32(o + 480)]],
        color: colorref(r.u32(o + 8)),
        width: r.u32(o + 16),
        highlighter: false,
      };
    case OBJ_SHAPE: {
      const kind = r.u32(o + 8);
      return {
        type: "shape",
        kind: kind === SHAPE_ELLIPSE ? "ellipse" : kind === SHAPE_TRIANGLE ? "triangle" : "rect",
        color: colorref(r.u32(o + 12)),
        width: r.u32(o + 16),
        fill: r.u32(o + 28) ? colorref(r.u32(o + 36)) : null,
        rot: r.f32(o + 452),
        ...box(o + 456),
      };
    }
    case OBJ_GROUP: {
      const children: GwbObject[] = [];
      let q = o + 12;
      for (let k = r.u32(o + 8); k > 0; k--) q = readObject(r, warn, pg, q, o + size, children);
      return children;
    }
    default:
      warn(`page ${pg} : type d'objet ${t} non pris en charge, ignoré`);
      return null;
  }
}

function readObject(r: Reader, warn: (m: string) => void, pg: number, q: number, limit: number, out: GwbObject[]): number {
  const t = r.u32(q);
  const size = r.u32(q + 4);
  const o = q + 8;
  if (o + size > limit) throw new Error(`objet de taille invalide à l'offset ${q}`);
  try {
    const obj = decodeObject(r, warn, pg, t, o, size);
    if (Array.isArray(obj)) out.push(...obj);
    else if (obj) {
      const tr = o + size - TRAILER_SIZE;
      const target = tr >= o && r.u32(tr) ? r.zstr16(tr + 4, o + size) : "";
      out.push(target ? { ...obj, link: { target } } : obj);
    }
  } catch (e) {
    warn(`page ${pg} : objet de type ${t} illisible, ignoré (${e instanceof Error ? e.message : e})`);
  }
  return o + size;
}

function readPage(r: Reader, warn: (m: string) => void, pg: number, start: number, end: number): GwbPage {
  const width = r.u32(start);
  const height = r.u32(start + 4);
  const ts = r.u32(start + 8);
  if (width < 100 || width > 20000 || height < 100 || height > 20000) throw new Error(`dimensions de page invalides ${width}x${height}`);
  const page: GwbPage = { width, height, bgColor: "#ffffff", bgImage: null, objects: [], hiddenObjects: 0, thumbnail: null, fallback: false };
  let q = start + 12 + ts;
  [, q] = r.ustr(q); // date de création de la page
  q += 28; // zoom, défilement, options (non utilisés)
  const bg = r.u32(q);
  q += 4;
  if (bg === BG_COLOR) {
    page.bgColor = colorref(r.u32(q));
    q += 4;
  } else if (bg === BG_IMAGE) {
    const n = r.u32(q);
    page.bgImage = r.d.subarray(q + 4, q + 4 + n);
    q += 4 + n;
  } else throw new Error(`type de fond inconnu ${bg}`);

  const layers = r.u32(q);
  q += 4;
  if (layers > 1000) throw new Error("nombre de calques invalide");
  // Calques et objets sont stockés de l'arrière-plan vers le premier plan
  for (let l = 0; l < layers; l++) {
    [, q] = r.ustr(q);
    const visible = r.u32(q) !== 0;
    const count = r.u32(q + 12);
    q += 16;
    const objs: GwbObject[] = [];
    for (let k = 0; k < count; k++) q = readObject(r, warn, pg, q, end, objs);
    if (visible) page.objects.push(...objs);
    else page.hiddenObjects += objs.length;
  }
  if (q !== end) warn(`page ${pg} : ${end - q} octets non interprétés`);
  return page;
}

export function parseGwb(data: Uint8Array): GwbDocument {
  if (!isGwb(data)) throw new Error("Ce fichier n'est pas un fichier Workspace GWB.");
  const r = new Reader(data);
  const warnings: string[] = [];
  const warn = (m: string) => void warnings.push(m);
  const version = new TextDecoder("ascii").decode(data.subarray(0, 8)).trim();
  if (!version.startsWith("GWB6")) warn(`version ${version} non testée (l'import a été établi sur GWB6.09)`);
  if (data.length < 12) throw new Error("Fichier GWB tronqué.");
  const count = r.u32(8);
  if (count < 1 || count >= 10000) throw new Error(`Fichier GWB illisible : nombre de pages incohérent (${count}).`);

  const pages: GwbPage[] = [];
  let o = 12;
  for (let p = 0; p < count; p++) {
    if (o + 4 > data.length) throw new Error(`Fichier GWB tronqué : page ${p + 1} manquante.`);
    const start = o + 4;
    const end = start + r.u32(o);
    if (end > data.length) throw new Error(`Fichier GWB tronqué dans la page ${p + 1}.`);
    try {
      pages.push(readPage(r, warn, p + 1, start, end));
    } catch (e) {
      warn(`page ${p + 1} : structure non reconnue (${e instanceof Error ? e.message : e}), remplacée par sa miniature`);
      const ts = r.u32(start + 8);
      pages.push({
        width: r.u32(start) || PAGE_W,
        height: r.u32(start + 4) || PAGE_H,
        bgColor: "#ffffff",
        bgImage: null,
        objects: [],
        hiddenObjects: 0,
        thumbnail: data.subarray(start + 12, start + 12 + ts),
        fallback: true,
      });
    }
    o = end;
  }
  return { version, pages, warnings };
}

// ---------------------------------------------------------------- Conversion vers les pages du tableau

export interface GwbConvertTools {
  /** Rend une image utilisable : data URL, couleur de transparence appliquée. Null si elle est illisible. */
  image(data: Uint8Array, format: GwbImageFormat, colorKey: string | null): Promise<string | null>;
  /** Largeur d'une ligne de texte, en pixels de page. */
  measure(text: string, p: GwbTextStyle, size: number): number;
  /** Prépare le média lié et renvoie de quoi le lire ; null si ce lien n'est pas un média. */
  media(target: string, page: number): Promise<{ mediaId: string; name: string; audio: boolean } | null>;
}

const AUDIO_W = 320;
const AUDIO_H = 64;
const VIDEO_W = 480;
const VIDEO_H = 270;

const tf = { scaleX: 1, scaleY: 1 };
const degrees = (rot: number) => (rot ? (-rot * 180) / Math.PI : 0); // GWB : radians, sens trigonométrique ; écran : y vers le bas

/** Coin haut-gauche d'une boîte tournée autour de son centre, puisque Konva tourne autour de ce coin. */
function rotatedCorner(x: number, y: number, w: number, h: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  const cx = x + w / 2;
  const cy = y + h / 2;
  return { x: cx - (w / 2) * Math.cos(a) + (h / 2) * Math.sin(a), y: cy - (w / 2) * Math.sin(a) - (h / 2) * Math.cos(a) };
}

/** Nombre de lignes d'un paragraphe une fois coupé à la largeur de sa zone. */
function lineCount(p: GwbParagraph, size: number, w: number, measure: GwbConvertTools["measure"]): number {
  let lines = 0;
  for (const part of p.text.split("\n")) {
    let cur = "";
    lines++;
    for (const word of part.split(" ")) {
      const trial = cur ? `${cur} ${word}` : word;
      if (cur && measure(trial, p, size) > w) {
        lines++;
        cur = word;
      } else cur = trial;
    }
  }
  return lines;
}

const sameStyle = (a: GwbParagraph, b: GwbParagraph) =>
  a.font === b.font && Math.round(a.size) === Math.round(b.size) && a.color === b.color && a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.align === b.align;

function textObjects(o: Extract<GwbObject, { type: "text" }>, map: (x: number, y: number) => [number, number], k: number, tools: GwbConvertTools): BoardObject[] {
  const paragraphs = o.paragraphs;
  if (!paragraphs.some((p) => p.text.trim())) return [];
  // Un objet du tableau n'a qu'un style : des paragraphes différents deviennent des zones superposées
  const blocks: GwbParagraph[][] = [];
  for (const p of paragraphs) {
    const cur = blocks[blocks.length - 1];
    if (cur && (!p.text.trim() || sameStyle(cur[0], p))) cur.push(p);
    else blocks.push([p]);
  }
  const [x, y0] = map(o.x, o.y);
  const w = Math.max(MIN_TEXT_W, (o.w * 1.03 + 4) * k); // un peu plus large : la police de rendu peut différer d'un pixel
  let y = y0;
  const out: BoardObject[] = [];
  for (const block of blocks) {
    const p = block[0];
    const fontSize = clampFontSize(p.size * k);
    if (block.some((b) => b.text.trim())) {
      out.push({
        ...tf,
        id: nanoid(),
        kind: "text",
        x,
        y,
        rotation: 0,
        text: block.map((b) => b.text).join("\n"),
        w,
        fontSize,
        color: p.color,
        ...(p.font ? { font: p.font } : {}),
        ...(p.bold ? { bold: true as const } : {}),
        ...(p.italic ? { italic: true as const } : {}),
        ...(p.underline ? { underline: true as const } : {}),
        ...(p.align === "center" || p.align === "right" ? { align: p.align } : {}),
      });
    }
    for (const b of block) y += lineCount(b, fontSize, w, tools.measure) * fontSize * TEXT_LINE_HEIGHT;
  }
  return out;
}

/** Convertit le document : chaque page est mise à l'échelle et centrée dans la feuille du tableau. */
export async function gwbToPages(doc: GwbDocument, tools: GwbConvertTools): Promise<Page[]> {
  const warn = (m: string) => void doc.warnings.push(m);
  const pages: Page[] = [];
  for (const [index, gp] of doc.pages.entries()) {
    const pg = index + 1;
    const k = Math.min(PAGE_W / gp.width, PAGE_H / gp.height);
    const ox = (PAGE_W - gp.width * k) / 2;
    const oy = (PAGE_H - gp.height * k) / 2;
    const map = (x: number, y: number): [number, number] => [ox + x * k, oy + y * k];
    const objects: BoardObject[] = [];
    const players: BoardObject[] = []; // au premier plan, pour rester cliquables

    const fullPage = async (data: Uint8Array) => {
      const format = imageFormat(data);
      const src = format && (await tools.image(data, format, null));
      if (src) objects.push({ ...tf, id: nanoid(), kind: "image", src, x: ox, y: oy, w: gp.width * k, h: gp.height * k, rotation: 0 });
      else warn(`page ${pg} : image de fond illisible`);
    };

    if (gp.fallback) {
      if (gp.thumbnail) await fullPage(gp.thumbnail);
    } else {
      if (gp.bgColor !== "#ffffff") {
        objects.push({ ...tf, id: nanoid(), kind: "shape", shape: "rect", x: 0, y: 0, w: PAGE_W, h: PAGE_H, color: gp.bgColor, fill: gp.bgColor, width: 0, rotation: 0 });
      }
      if (gp.bgImage) await fullPage(gp.bgImage);
    }
    if (gp.hiddenObjects) warn(`page ${pg} : ${gp.hiddenObjects} objets de calques masqués dans Workspace n'ont pas été importés`);

    for (const o of gp.objects) {
      if (o.type === "image") {
        const src = await tools.image(o.data, o.format, o.colorKey);
        if (!src) {
          warn(`page ${pg} : image illisible, ignorée`);
        } else {
          const [x, y] = map(o.x, o.y);
          const rotation = degrees(o.rot);
          objects.push({ ...tf, id: nanoid(), kind: "image", src, w: o.w * k, h: o.h * k, rotation, ...rotatedCorner(x, y, o.w * k, o.h * k, rotation) });
        }
      } else if (o.type === "text") {
        if (o.paragraphs.some((p) => p.mixed)) warn(`page ${pg} : un texte à plusieurs styles dans une même ligne a été simplifié`);
        objects.push(...textObjects(o, map, k, tools));
      } else if (o.type === "stroke") {
        if (o.points.length) {
          const pts = o.points.length === 1 ? [o.points[0], [o.points[0][0] + 0.01, o.points[0][1]] as [number, number]] : o.points;
          objects.push({
            ...tf,
            id: nanoid(),
            kind: "stroke",
            tool: o.highlighter ? "highlighter" : "pen",
            x: 0,
            y: 0,
            rotation: 0,
            points: pts.flatMap(([x, y]) => map(x, y)),
            color: o.color,
            width: Math.max(1, o.width * k),
          });
        }
      } else {
        const [x, y] = map(o.x, o.y);
        const w = o.w * k;
        const h = o.h * k;
        const rotation = degrees(o.rot);
        const at = o.kind === "ellipse" ? { x: x + w / 2, y: y + h / 2 } : rotatedCorner(x, y, w, h, rotation);
        objects.push({
          ...tf,
          ...at,
          id: nanoid(),
          kind: "shape",
          shape: o.kind,
          w,
          h,
          color: o.color,
          width: o.width * k,
          rotation,
          ...(o.fill ? { fill: o.fill } : {}),
        });
      }

      if (o.link) {
        const media = await tools.media(o.link.target, pg);
        if (media) {
          const box = "x" in o ? o : { x: o.points[0]?.[0] ?? 0, y: o.points[0]?.[1] ?? 0, w: 0 };
          const [right, top] = map(box.x + box.w, box.y);
          const w = media.audio ? AUDIO_W : VIDEO_W;
          const h = media.audio ? AUDIO_H : VIDEO_H;
          players.push({
            ...tf,
            id: nanoid(),
            kind: "video",
            source: { type: "file", mediaId: media.mediaId, name: media.name },
            ...(media.audio ? { audio: true as const } : {}),
            x: Math.max(0, Math.min(PAGE_W - w, right)),
            y: Math.max(0, Math.min(PAGE_H - h, top)),
            w,
            h,
            rotation: 0,
          });
        }
      }
    }
    pages.push({ id: nanoid(), background: "blank", objects: [...objects, ...players] });
  }
  return pages;
}

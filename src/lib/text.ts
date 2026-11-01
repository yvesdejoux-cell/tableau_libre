import type { TextObject } from "../types";
import type { Pt } from "./shapes";
import { PAGE_H, PAGE_W } from "./view";

export const TEXT_FONT = "Arial, Helvetica, sans-serif";
export const TEXT_LINE_HEIGHT = 1.2;

/** Tailles proposées dans la barre d'outils, en pixels de page. */
export const TEXT_SIZES = [32, 48, 72, 112];
export const DEFAULT_TEXT_SIZE = 48;

const DEFAULT_W = 700;
export const MIN_TEXT_W = 80;
const MIN_FONT = 8;
const MAX_FONT = 600;

export const clampFontSize = (n: number) => Math.min(MAX_FONT, Math.max(MIN_FONT, Math.round(n)));

/** Géométrie d'une nouvelle zone : la première ligne est centrée sur le point cliqué, dans la page. */
export function newTextBox(p: Pt, fontSize: number) {
  const lineH = fontSize * TEXT_LINE_HEIGHT;
  const x = Math.min(PAGE_W - MIN_TEXT_W, Math.max(0, p.x));
  const y = Math.min(PAGE_H - lineH, Math.max(0, p.y - lineH / 2));
  return { x, y, w: Math.min(DEFAULT_W, PAGE_W - x) };
}

/** Police d'un texte importé, avec repli si elle n'est pas installée. */
export const textFont = (font?: string) => (font ? `"${font.replace(/["\\]/g, "")}", ${TEXT_FONT}` : TEXT_FONT);

/** Paramètres Konva communs à l'écran (Board.tsx) et à l'export (exporter.ts). */
export const textAttrs = (o: TextObject) => ({
  text: o.text,
  width: o.w,
  fontSize: o.fontSize,
  fontFamily: textFont(o.font),
  fontStyle: [o.italic && "italic", o.bold && "bold"].filter(Boolean).join(" ") || "normal",
  textDecoration: o.underline ? "underline" : "",
  align: o.align ?? "left",
  lineHeight: TEXT_LINE_HEIGHT,
  fill: o.color,
  wrap: "word",
});

/** Les mêmes, pour le champ de saisie et les vignettes. */
export const textCss = (o: TextObject) => ({
  fontFamily: textFont(o.font),
  fontWeight: o.bold ? 700 : 400,
  fontStyle: o.italic ? "italic" : "normal",
  textDecoration: o.underline ? "underline" : "none",
  textAlign: o.align ?? ("left" as const),
});

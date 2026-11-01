import type { BackgroundType, BoardObject, Page, TextObject, VideoObject } from "../types";

/**
 * Écriture du format UBZ d'OpenBoard : un zip avec metadata.rdf, une page SVG par fichier (origine au centre)
 * et les ressources dans images/, audios/ et videos/. Le format n'a pas de spécification publiée :
 * la référence est UBSvgSubsetAdaptor.cpp, dans le code d'OpenBoard.
 * Chaque objet porte aussi `tl:object` : ce qu'OpenBoard ne sait pas représenter y reste intact pour Tableau Libre.
 * OpenBoard ignore ces attributs et les retire des pages qu'il réécrit ; ubzRead.ts repart alors du SVG.
 * Ce module ne dépend pas du navigateur.
 */
export const UB_NS = "http://uniboard.mnemis.com/document";
export const TL_NS = "urn:tableau-libre:ubz";
const UB_VERSION = "4.8.0";
const GRID_SIZE = 40;
const STAFF_STEP = 120;
const STAFF_LINE = 10;
export const TEXT_MARGIN = 4; // marge interne de Qt
export const HIGHLIGHT_OPACITY = 0.4;

export interface UbzInput {
  title: string;
  size: { w: number; h: number };
  pages: Pick<Page, "objects" | "background">[];
  currentIndex?: number;
  /** Sons et vidéos dont le fichier est disponible, par mediaId : leur nom donne l'extension. */
  media?: Map<string, { name: string }>;
  now?: Date;
}

export interface UbzResult {
  /** Tout sauf les sons et vidéos, écrits à part pour ne pas les charger en mémoire. */
  files: Map<string, Uint8Array>;
  /** Emplacement de chaque son ou vidéo dans le zip, par mediaId. */
  media: Map<string, string>;
  warnings: string[];
}

type Matrix = [number, number, number, number, number, number];

const fmt = (v: number) => {
  const s = v.toFixed(3).replace(/\.?0+$/, "");
  return s === "-0" || s === "" ? "0" : s;
};
const matrix = (m: Matrix) => `matrix(${m.map(fmt).join(", ")})`;
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const html = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const utf8 = (s: string) => new TextEncoder().encode(s);

/** Konva : translation, puis rotation (degrés), puis échelle. */
function transformOf(o: BoardObject): Matrix {
  const a = (o.rotation * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * o.scaleX, s * o.scaleX, -s * o.scaleY, c * o.scaleY, o.x, o.y];
}
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function decodeDataUrl(src: string): { data: Uint8Array; ext: string } | null {
  const m = /^data:image\/([\w+.-]+);base64,(.*)$/s.exec(src);
  if (!m) return null;
  const bin = atob(m[2]);
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  return { data, ext: m[1] === "jpeg" ? "jpg" : m[1] };
}

/** Dimensions réelles d'une image PNG, JPEG ou GIF. */
export function imageSize(d: Uint8Array): { w: number; h: number } | null {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  if (d[0] === 0x89 && d[1] === 0x50) return { w: v.getUint32(16), h: v.getUint32(20) };
  if (d[0] === 0x47 && d[1] === 0x49) return { w: v.getUint16(6, true), h: v.getUint16(8, true) };
  if (d[0] === 0xff && d[1] === 0xd8) {
    for (let i = 2; i + 9 < d.length; ) {
      if (d[i] !== 0xff) return null;
      const marker = d[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { w: v.getUint16(i + 7), h: v.getUint16(i + 5) };
      }
      i += 2 + v.getUint16(i + 2);
    }
  }
  return null;
}

/** Contour de la forme en coordonnées de page ; `closed` : à refermer. */
function shapeOutline(o: Extract<BoardObject, { kind: "shape" }>): { paths: [number, number][][]; closed: boolean } {
  const m = transformOf(o);
  const at = (pts: [number, number][]) => pts.map(([x, y]) => apply(m, x, y));
  const { w, h } = o;
  switch (o.shape) {
    case "line":
      return { paths: [at([[0, 0], [w, h]])], closed: false };
    case "arrow": {
      const len = Math.hypot(w, h) || 1;
      const size = Math.max(o.width * 3, 12);
      const ux = w / len;
      const uy = h / len;
      const barb = (sign: number): [number, number] => [w - ux * size - sign * uy * size * 0.6, h - uy * size + sign * ux * size * 0.6];
      return { paths: [at([[0, 0], [w, h]]), at([barb(1), [w, h], barb(-1)])], closed: false };
    }
    case "rect":
      return { paths: [at([[0, 0], [w, 0], [w, h], [0, h]])], closed: true };
    case "triangle":
      return { paths: [at([[w / 2, 0], [w, h], [0, h]])], closed: true };
    case "ellipse": {
      const pts: [number, number][] = [];
      for (let i = 0; i < 72; i++) {
        const a = (i * Math.PI) / 36;
        pts.push([(Math.cos(a) * w) / 2, (Math.sin(a) * h) / 2]);
      }
      return { paths: [at(pts)], closed: true };
    }
  }
}

const BLOCK = "margin-top:0px; margin-bottom:0px; margin-left:0px; margin-right:0px; -qt-block-indent:0; text-indent:0px;";
const qtDocument = (paragraphs: string) =>
  '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0//EN" "http://www.w3.org/TR/REC-html40/strict.dtd">' +
  '<html><head><meta name="qrichtext" content="1" /><style type="text/css">p, li { white-space: pre-wrap; }</style></head>' +
  `<body style=" font-family:'Arial'; font-size:24px; font-weight:400; font-style:normal;">${paragraphs}</body></html>`;

/** Le texte au format de Qt, seul format lu par OpenBoard dans itemTextContent. */
function textHtml(o: TextObject): string {
  const css = [
    `font-family:'${(o.font ?? "Arial").replace(/'/g, "")}'`,
    `font-size:${o.fontSize}px`,
    `font-weight:${o.bold ? 700 : 400}`,
    `font-style:${o.italic ? "italic" : "normal"}`,
    `color:${o.color}`,
    ...(o.underline ? ["text-decoration: underline"] : []),
  ].join("; ");
  const align = o.align ? ` align="${o.align}"` : "";
  return qtDocument(
    o.text
      .split("\n")
      .map((line) => `<p${align} style="${BLOCK}"><span style=" ${css};">${html(line)}</span></p>`)
      .join("")
  );
}

/** OpenBoard n'a pas de lecteur de lien : ce texte cliquable, qu'il conserve, garde l'adresse quoi qu'il arrive. */
export const linkHtml = (url: string) =>
  qtDocument(`<p style="${BLOCK}"><a href="${xml(url)}"><span style=" font-size:24px; text-decoration: underline; color:#0000ff;">${html(url)}</span></a></p>`);

const noteHtml = (text: string) => qtDocument(`<p style="${BLOCK}"><span style=" font-size:24px; color:#b91c1c;">${html(text)}</span></p>`);

const textHeight = (o: TextObject) => o.text.split("\n").length * o.fontSize * 1.2 + 2 * TEXT_MARGIN;

const BACKGROUNDS: Record<BackgroundType, { dark?: boolean; crossed?: boolean; ruled?: boolean; intermediate?: boolean }> = {
  blank: {},
  black: { dark: true },
  grid: { crossed: true },
  seyes: { crossed: true, intermediate: true },
  lines: { ruled: true },
  staff: {},
};

/** L'objet tel que Tableau Libre le relira ; le contenu d'une image est dans son fichier. */
function objectAttr(o: BoardObject, index: number): string {
  const data: Partial<BoardObject> & { src?: string } = { ...o };
  if (o.kind === "image") delete data.src;
  return ` tl:index="${index}" tl:object="${xml(JSON.stringify(data))}"`;
}

function pageSvg(input: UbzInput, page: UbzInput["pages"][number], index: number, out: UbzResult, warn: (m: string) => void): string {
  const W = input.size.w;
  const H = input.size.h;
  const ox = W / 2;
  const oy = H / 2;
  const dark = page.background === "black";
  const paper = dark ? "#000000" : "#ffffff";
  let z = 0;
  const nz = () => `${++z}.000000`;
  const pointsAttr = (pts: [number, number][]) => pts.map(([x, y]) => `${fmt(x - ox)},${fmt(y - oy)}`).join(" ");
  const parts: string[] = [];

  const group = (color: string, body: (gid: string, zv: string) => string, extra = "", locked = false) => {
    const gid = crypto.randomUUID();
    const zv = nz();
    const onDark = color === "#000000" ? "#ffffff" : color;
    parts.push(
      `<g ub:z-value="${zv}" ub:fill-on-dark-background="${onDark}" ub:fill-on-light-background="${color}" ub:uuid="{${gid}}" ub:layer="2"${locked ? ' ub:locked="true"' : ""} ub:hidden-on-display="false"${extra}>${body(gid, zv)}</g>`
    );
  };
  const polyline = (gid: string, pts: [number, number][], color: string, width: number, opacity = 1) =>
    `<polyline points="${pointsAttr(pts)}" fill="none" stroke-width="${fmt(Math.max(width, 1))}" stroke="${color}" stroke-opacity="${fmt(opacity)}" stroke-linecap="round" ub:uuid="{${crypto.randomUUID()}}" ub:parent="{${gid}}"/>`;
  // OpenBoard donne au groupe le z du premier polygone qu'il lit, pas celui du <g> : il doit figurer sur le polygone
  const polygon = (gid: string, zv: string, pts: [number, number][], fill: string, opacity = 1, rule = "evenodd") =>
    `<polygon points="${pointsAttr(pts)}" transform="matrix(1, 0, 0, 1, 0, 0)" fill="${fill}" fill-opacity="${opacity.toFixed(2)}" fill-rule="${rule}" ub:z-value="${zv}" ub:uuid="{${crypto.randomUUID()}}" ub:parent="{${gid}}"/>`;
  const textBox = (html: string, width: number, height: number, t: Matrix, color: string, extra: string) => {
    const w = fmt(width);
    const h = fmt(height);
    const onDark = color === "#000000" ? "#ffffff" : color;
    parts.push(
      `<foreignObject ub:type="text" x="0" y="0" width="${w}" height="${h}" transform="${matrix(t)}" ub:z-value="${nz()}" ub:background="false" ub:uuid="{${crypto.randomUUID()}}" ub:layer="1" ub:hidden-on-display="false" ub:editable="true" ub:width="${w}" ub:height="${h}" ub:fill-on-dark-background="${onDark}" ub:fill-on-light-background="${color}"${extra}><itemTextContent>${xml(html)}</itemTextContent></foreignObject>`
    );
  };

  if (page.background === "staff") {
    for (let top = STAFF_STEP / 2; top + 4 * STAFF_LINE < H; top += STAFF_STEP) {
      group("#94a3b8", (gid) => [0, 1, 2, 3, 4].map((k) => polyline(gid, [[0, top + k * STAFF_LINE], [W, top + k * STAFF_LINE]], "#94a3b8", 1)).join(""), ' tl:decor="true"', true);
    }
  }

  const writeObject = (o: Exclude<BoardObject, VideoObject>, index: number) => {
    const m = transformOf(o);
    const placed: Matrix = [m[0], m[1], m[2], m[3], m[4] - ox, m[5] - oy];
    switch (o.kind) {
      case "stroke": {
        const pts: [number, number][] = [];
        for (let i = 0; i + 1 < o.points.length; i += 2) pts.push(apply(m, o.points[i], o.points[i + 1]));
        if (pts.length < 2) return;
        const opacity = o.tool === "highlighter" ? HIGHLIGHT_OPACITY : 1;
        const color = o.tool === "eraser" ? paper : o.color;
        if (o.closed) group(color, (gid, zv) => polygon(gid, zv, pts, color, opacity, "winding"), objectAttr(o, index));
        else group(color, (gid) => polyline(gid, pts, color, o.width, opacity), objectAttr(o, index));
        return;
      }
      case "shape": {
        const { paths, closed } = shapeOutline(o);
        group(
          o.color,
          (gid, zv) => {
            const fill = o.fill ? polygon(gid, zv, paths[0], o.fill) : "";
            const lines = o.width > 0 ? paths.map((p) => polyline(gid, closed ? [...p, p[0]] : p, o.color, o.width)).join("") : "";
            return fill + lines;
          },
          objectAttr(o, index)
        );
        return;
      }
      case "image": {
        const img = decodeDataUrl(o.src);
        if (!img) {
          warn(`page ${index + 1} : image illisible, non enregistrée`);
          return;
        }
        const size = imageSize(img.data) ?? { w: Math.max(1, Math.round(o.w)), h: Math.max(1, Math.round(o.h)) };
        const uid = crypto.randomUUID();
        const href = `images/{${uid}}.${img.ext}`;
        out.files.set(href, img.data);
        const k: Matrix = [(placed[0] * o.w) / size.w, (placed[1] * o.w) / size.w, (placed[2] * o.h) / size.h, (placed[3] * o.h) / size.h, placed[4], placed[5]];
        parts.push(
          `<image xlink:href="${xml(href)}" x="0" y="0" width="${size.w}" height="${size.h}" transform="${matrix(k)}" ub:z-value="${nz()}" ub:background="false" ub:uuid="{${uid}}" ub:layer="1" ub:hidden-on-display="false"${objectAttr(o, index)}/>`
        );
        return;
      }
      case "text":
        textBox(
          textHtml(o),
          o.w + 2 * TEXT_MARGIN,
          textHeight(o),
          [placed[0], placed[1], placed[2], placed[3], placed[4] - TEXT_MARGIN, placed[5] - TEXT_MARGIN],
          o.color,
          objectAttr(o, index)
        );
        return;
    }
  };

  const players: { o: VideoObject; index: number }[] = [];
  page.objects.forEach((o, index) => {
    if (o.kind === "video") players.push({ o, index });
    else writeObject(o, index);
  });

  // Lecteurs au premier plan, pour rester cliquables dans OpenBoard
  for (const { o, index } of players) {
    const m = transformOf(o);
    const t: Matrix = [m[0], m[1], m[2], m[3], m[4] - ox, m[5] - oy];
    if (o.source.type === "url") {
      textBox(linkHtml(o.source.url), Math.max(o.w, 320), 44, t, "#0000ff", objectAttr(o, index));
      continue;
    }
    const { mediaId, name } = o.source;
    const media = input.media?.get(mediaId);
    if (!media) {
      // Pas de fichier à écrire : le texte le dit dans OpenBoard, et Tableau Libre garde son lecteur à retrouver
      warn(`page ${index + 1} : « ${name} » est introuvable, son contenu n'est pas dans le fichier enregistré`);
      textBox(noteHtml(`Fichier introuvable : ${name}`), Math.max(o.w, 320), 44, t, "#b91c1c", objectAttr(o, index));
      continue;
    }
    const folder = o.audio ? "audios" : "videos";
    // Un même média sur plusieurs pages : un seul fichier, il peut être très gros
    let href = out.media.get(mediaId);
    if (!href) {
      const ext = /\.[^.\\/]+$/.exec(media.name)?.[0].toLowerCase() ?? "";
      href = `${folder}/{${crypto.randomUUID()}}${ext}`;
      out.media.set(mediaId, href);
    }
    const tag = o.audio ? "audio" : "video";
    parts.push(
      `<${tag} x="0" y="0" width="${fmt(o.w)}" height="${fmt(o.h)}" transform="${matrix(t)}" ub:z-value="${nz()}" ub:background="false" ub:uuid="{${crypto.randomUUID()}}" ub:layer="1" ub:hidden-on-display="false" xlink:href="${xml(href)}"${objectAttr(o, index)}/>`
    );
  }

  const bg = BACKGROUNDS[page.background];
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:ub="${UB_NS}" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:tl="${TL_NS}" ` +
    `version="1.1" ub:version="${UB_VERSION}" ub:uuid="${crypto.randomUUID()}" viewBox="${fmt(-ox)} ${fmt(-oy)} ${W} ${H}" ub:nominal-size="${W}x${H}" ` +
    `ub:dark-background="${!!bg.dark}" ub:crossed-background="${!!bg.crossed}" ub:ruled-background="${!!bg.ruled}" ub:grid-size="${GRID_SIZE}"` +
    // OpenBoard lit un entier : « true » vaudrait 0
    `${bg.intermediate ? ' ub:intermediate-lines="1"' : ""} tl:background="${page.background}"${index === input.currentIndex ? ' tl:current-page="true"' : ""} pageDpi="96">\n` +
    `    <rect fill="${dark ? "black" : "white"}" x="${fmt(-ox)}" y="${fmt(-oy)}" width="${W}" height="${H}"/>\n` +
    parts.map((p) => `    ${p}\n`).join("") +
    `</svg>\n`
  );
}

/** Les fichiers du document, sans les miniatures : OpenBoard les recrée quand elles manquent. */
export function buildUbz(input: UbzInput): UbzResult {
  const out: UbzResult = { files: new Map(), media: new Map(), warnings: [] };
  const warn = (m: string) => {
    if (!out.warnings.includes(m)) out.warnings.push(m);
  };
  const now = (input.now ?? new Date()).toISOString().replace(/\.\d+Z$/, "Z");
  const id = crypto.randomUUID();
  out.files.set(
    "metadata.rdf",
    utf8(
      `<?xml version="1.0" encoding="UTF-8"?>\n<RDF xmlns="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:ub="${UB_NS}">\n` +
        `    <Description about="${UB_NS}/${id}">\n        <dc:title>${xml(input.title)}</dc:title>\n        <dc:type></dc:type>\n        <dc:date>${now}</dc:date>\n` +
        `        <dc:format>image/svg+xml</dc:format>\n        <dc:identifier>${UB_NS}/${id}</dc:identifier>\n        <ub:version>${UB_VERSION}</ub:version>\n` +
        `        <ub:size>${input.size.w}x${input.size.h}</ub:size>\n        <ub:updated-at>${now}</ub:updated-at>\n    </Description>\n</RDF>\n`
    )
  );
  input.pages.forEach((page, i) => {
    out.files.set(`page${String(i).padStart(3, "0")}.svg`, utf8(pageSvg(input, page, i, out, warn)));
  });
  return out;
}

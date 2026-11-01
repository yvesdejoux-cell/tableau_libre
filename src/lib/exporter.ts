import Konva from "konva";
import { PDFDocument } from "pdf-lib";
import type { BoardObject, Page, VideoObject } from "../types";
import { drawBackground } from "./backgroundCanvas";
import { arrowSize, trianglePoints } from "./shapes";
import { textAttrs } from "./text";

/** Limite la taille du rendu (~4000 px de large) pour rester sûr sur tous les moteurs web. */
export const exportPixelRatio = (w: number) => Math.min(2, 4000 / w);

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image illisible"));
    img.src = src;
  });
}

async function loadImages(objects: BoardObject[]) {
  const map = new Map<string, HTMLImageElement>();
  const srcs = new Set<string>();
  for (const o of objects) {
    if (o.kind === "image") srcs.add(o.src);
    else if (o.kind === "video" && o.poster) srcs.add(o.poster);
  }
  await Promise.all(
    [...srcs].map(async (src) => {
      try {
        map.set(src, await loadImage(src));
      } catch {
        /* image ignorée plutôt que d'échouer tout l'export */
      }
    })
  );
  return map;
}

/** Triangle « lecture » centré dans une vidéo de w × h : x1, y1, x2, y2, x3, y3. */
export function playIcon(w: number, h: number): number[] {
  const r = Math.min(w, h) * 0.12;
  const cx = w / 2;
  const cy = h / 2;
  return [cx - r * 0.7, cy - r, cx - r * 0.7, cy + r, cx + r, cy];
}

/** Une vidéo ne s'imprime pas : on exporte son aperçu, ou un cadre avec l'adresse du lien. */
function videoNode(o: VideoObject, images: Map<string, HTMLImageElement>): Konva.Group {
  const group = new Konva.Group({ x: o.x, y: o.y, rotation: o.rotation, listening: false });
  const poster = o.poster ? images.get(o.poster) : undefined;
  group.add(new Konva.Rect({ width: o.w, height: o.h, fill: "#1e293b" }));
  if (poster) group.add(new Konva.Image({ image: poster, width: o.w, height: o.h }));
  group.add(new Konva.Line({ points: playIcon(o.w, o.h), closed: true, fill: "#ffffff", opacity: 0.9 }));
  if (o.source.type === "url" || o.audio) {
    const fontSize = Math.max(16, o.h * (o.audio ? 0.2 : 0.05));
    group.add(
      new Konva.Text({
        text: o.source.type === "url" ? o.source.url : o.source.name,
        fill: "#e2e8f0",
        fontSize,
        width: o.w - fontSize * 2,
        x: fontSize,
        y: o.h - fontSize * 2,
        wrap: "none",
        ellipsis: true,
      })
    );
  }
  return group;
}

/** Mêmes paramètres que le rendu à l'écran (Board.tsx). */
function nodeFor(o: Exclude<BoardObject, VideoObject>, images: Map<string, HTMLImageElement>): Konva.Shape | null {
  const common = { x: o.x, y: o.y, scaleX: o.scaleX, scaleY: o.scaleY, rotation: o.rotation, listening: false };

  if (o.kind === "stroke") {
    const eraser = o.tool === "eraser";
    return new Konva.Line({
      ...common,
      points: o.points,
      stroke: eraser ? "#000" : o.closed ? undefined : o.color,
      fill: o.closed ? o.color : undefined,
      closed: o.closed,
      strokeWidth: o.width,
      strokeScaleEnabled: false,
      lineCap: "round",
      lineJoin: "round",
      tension: o.closed ? 0 : 0.4,
      opacity: o.tool === "highlighter" ? 0.4 : 1,
      globalCompositeOperation: eraser ? "destination-out" : "source-over",
    });
  }

  if (o.kind === "shape") {
    const base = {
      ...common,
      stroke: o.color,
      strokeWidth: o.width,
      strokeScaleEnabled: false,
      lineCap: "round" as const,
      lineJoin: "round" as const,
    };
    switch (o.shape) {
      case "line":
        return new Konva.Line({ ...base, points: [0, 0, o.w, o.h] });
      case "arrow":
        return new Konva.Arrow({
          ...base,
          points: [0, 0, o.w, o.h],
          fill: o.color,
          pointerLength: arrowSize(o.width),
          pointerWidth: arrowSize(o.width),
        });
      case "rect":
        return new Konva.Rect({ ...base, width: o.w, height: o.h, fill: o.fill });
      case "ellipse":
        return new Konva.Ellipse({ ...base, radiusX: o.w / 2, radiusY: o.h / 2, fill: o.fill });
      case "triangle":
        return new Konva.Line({ ...base, points: trianglePoints(o.w, o.h), closed: true, fill: o.fill });
    }
  }

  if (o.kind === "text") return new Konva.Text({ ...common, ...textAttrs(o) });

  const img = images.get(o.src);
  return img ? new Konva.Image({ ...common, image: img, width: o.w, height: o.h }) : null;
}

/** Rend une page (fond + objets) sur un canvas de taille w×h × pixelRatio. */
export async function renderPage(page: Page, w: number, h: number, pixelRatio: number): Promise<HTMLCanvasElement> {
  const images = await loadImages(page.objects);

  // Stage hors écran : la gomme « pixels » (destination-out) n'agit que sur ce calque,
  // le fond est dessiné séparément et reste intact.
  const stage = new Konva.Stage({ container: document.createElement("div"), width: w, height: h });
  const videoLayer = new Konva.Layer({ listening: false }); // sous le dessin, comme à l'écran
  const layer = new Konva.Layer({ listening: false });
  stage.add(videoLayer, layer);
  for (const o of page.objects) {
    if (o.kind === "video") {
      videoLayer.add(videoNode(o, images));
      continue;
    }
    const node = nodeFor(o, images);
    if (node) layer.add(node);
  }
  stage.draw();

  const out = document.createElement("canvas");
  out.width = Math.round(w * pixelRatio);
  out.height = Math.round(h * pixelRatio);
  const ctx = out.getContext("2d")!;

  ctx.save();
  ctx.scale(pixelRatio, pixelRatio);
  drawBackground(ctx, page.background, w, h);
  ctx.restore();

  ctx.drawImage(stage.toCanvas({ pixelRatio }), 0, 0);
  stage.destroy();
  return out;
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (blob) resolve(new Uint8Array(await blob.arrayBuffer()));
      else reject(new Error("Encodage PNG impossible."));
    }, "image/png");
  });
}

/** PDF : une page par page du tableau, à la taille de l'écran (px CSS → points : × 0,75). */
export async function buildPdf(
  pages: Page[],
  w: number,
  h: number,
  onProgress?: (done: number, total: number) => void
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const pw = w * 0.75;
  const ph = h * 0.75;
  const ratio = exportPixelRatio(w);

  for (let i = 0; i < pages.length; i++) {
    onProgress?.(i + 1, pages.length);
    await new Promise((r) => setTimeout(r, 0)); // laisse l'interface se rafraîchir
    const png = await canvasToPng(await renderPage(pages[i], w, h, ratio));
    const img = await pdf.embedPng(png);
    pdf.addPage([pw, ph]).drawImage(img, { x: 0, y: 0, width: pw, height: ph });
  }
  return pdf.save();
}

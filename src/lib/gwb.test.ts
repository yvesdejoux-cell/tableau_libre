import { describe, expect, it } from "vitest";
import { type GwbConvertTools, type GwbDocument, gwbToPages, isGwb, parseGwb, parseRtf } from "./gwb";
import { resolveFrom } from "./mediaFiles";
import { parseSession, serializeSession } from "./session";

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const TRAILER = 4256;

/** Petit écrivain binaire pour fabriquer des fichiers GWB. */
class W {
  bytes: number[] = [];
  u32(v: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, true);
    this.bytes.push(...b);
    return this;
  }
  f32(...vs: number[]) {
    for (const v of vs) {
      const b = new Uint8Array(4);
      new DataView(b.buffer).setFloat32(0, v, true);
      this.bytes.push(...b);
    }
    return this;
  }
  raw(...vs: number[]) {
    this.bytes.push(...vs);
    return this;
  }
  zero(n: number) {
    return this.raw(...new Array<number>(n).fill(0));
  }
  ustr(s: string) {
    this.u32(s.length);
    for (const c of s) this.raw(c.charCodeAt(0), 0);
    return this;
  }
}

const object = (type: number, body: W) => new W().u32(type).u32(body.bytes.length).raw(...body.bytes);

function pageBytes(w: number, h: number, objects: W[], extra?: { hidden?: W[] }) {
  const p = new W().u32(w).u32(h).u32(0).ustr("date").zero(28).u32(1002).u32(0xffffff);
  const layers = [{ visible: 1, objs: objects }, ...(extra?.hidden ? [{ visible: 0, objs: extra.hidden }] : [])];
  p.u32(layers.length);
  for (const l of layers) {
    p.ustr("Couche").u32(l.visible).u32(0).u32(0).u32(l.objs.length);
    for (const o of l.objs) p.raw(...o.bytes);
  }
  return p;
}

function gwbFile(pages: W[]) {
  const f = new W().raw(..."GWB6.09 ".split("").map((c) => c.charCodeAt(0))).u32(pages.length);
  for (const p of pages) f.u32(p.bytes.length).raw(...p.bytes);
  return new Uint8Array(f.bytes);
}

function imageObject(colorKey = 0) {
  const b = new W().zero(24).f32(10, 10).u32(PNG_HEAD.length).f32(100, 200, 300, 150);
  b.u32(colorKey ? 1 : 0).u32(colorKey).f32(0).raw(...PNG_HEAD);
  return object(0x132, b.zero(TRAILER));
}

function strokeObject(points: number[], withLink?: string) {
  const b = new W().zero(12).u32(0x0000ff).zero(4).u32(2).zero(456 - 24).f32(...points);
  const tr = new W();
  if (withLink) {
    tr.u32(0x193);
    for (const c of withLink) tr.raw(c.charCodeAt(0), 0);
  }
  tr.zero(TRAILER - tr.bytes.length);
  return object(0x12d, b.raw(...tr.bytes));
}

function shapeObject(kind: number, fill: number | null, rot = 0) {
  const b = new W().zero(8).u32(kind).u32(0xff0000).u32(3).zero(8).u32(fill === null ? 0 : 1).zero(4).u32(fill ?? 0);
  b.zero(452 - 40).f32(rot).f32(100, 100, 200, 100);
  return object(0x138, b.zero(TRAILER));
}

function textObject(rtf: string) {
  const b = new W().zero(8).u32(rtf.length);
  for (const c of rtf) b.raw(c.charCodeAt(0));
  return object(0x12e, b.zero(4).f32(50, 60, 400, 100).zero(TRAILER));
}

const tools = (media: GwbConvertTools["media"] = async () => null): GwbConvertTools => ({
  image: async () => "data:image/png;base64,AAAA",
  measure: (text, _p, size) => text.length * size * 0.5,
  media,
});

const convert = async (doc: GwbDocument, t = tools()) => gwbToPages(doc, t);

describe("parseRtf", () => {
  const head = String.raw`{\rtf1\ansi\ansicpg1252{\fonttbl{\f0\fnil\fcharset0 Comic Sans MS;}{\f1\fswiss Arial;}}{\colortbl ;\red255\green0\blue0;}`;

  it("lit texte, police, taille, couleur et styles", () => {
    const [p] = parseRtf(String.raw`${head}\pard\qc\cf1\b\i\ul\f0\fs48 \'c9t\'e9 \u233?a\par}`);
    expect(p).toMatchObject({ text: "Été éa", font: "Comic Sans MS", color: "#ff0000", bold: true, italic: true, underline: true, align: "center", mixed: false });
    expect(p.size).toBeCloseTo(32);
  });

  it("retire le dernier paragraphe vide et garde les vides intérieurs", () => {
    const ps = parseRtf(String.raw`${head}\f0\fs24 a\par\par b\par\plain\fs20\par}`);
    expect(ps.map((p) => p.text)).toEqual(["a", "", "b"]);
  });

  it("garde le style dominant d'un paragraphe à styles mêlés", () => {
    const [p] = parseRtf(String.raw`${head}\f0\fs24 court\f1\fs48 beaucoup plus long\par}`);
    expect(p).toMatchObject({ font: "Arial", mixed: true, text: "courtbeaucoup plus long" });
  });
});

describe("parseGwb", () => {
  it("reconnaît la signature et refuse les autres fichiers", () => {
    expect(isGwb(new TextEncoder().encode("GWB6.09"))).toBe(true);
    expect(isGwb(new TextEncoder().encode('{"format"'))).toBe(false);
    expect(() => parseGwb(new TextEncoder().encode("PK\u0003\u0004"))).toThrow(/Workspace/);
  });

  it("lit pages, objets et liens, et compte les calques masqués", () => {
    const doc = parseGwb(gwbFile([pageBytes(1920, 1080, [imageObject(0xff00ff), strokeObject([1, 2, 3, 4], "son.wma")], { hidden: [shapeObject(110, null)] })]));
    expect(doc.warnings).toEqual([]);
    const [page] = doc.pages;
    expect(page.hiddenObjects).toBe(1);
    expect(page.objects[0]).toMatchObject({ type: "image", format: "png", colorKey: "#ff00ff", x: 100, y: 200, w: 300, h: 150 });
    expect(page.objects[1]).toMatchObject({ type: "stroke", points: [[1, 2], [3, 4]], color: "#ff0000", width: 2, link: { target: "son.wma" } });
  });

  it("remplace par sa miniature une page illisible, sans perdre les suivantes", () => {
    const bad = new W().u32(1920).u32(1080).u32(PNG_HEAD.length).raw(...PNG_HEAD).ustr("d").zero(28).u32(9999);
    const doc = parseGwb(gwbFile([bad, pageBytes(1920, 1080, [])]));
    expect(doc.pages[0].fallback).toBe(true);
    expect(doc.pages).toHaveLength(2);
    expect(doc.warnings[0]).toMatch(/page 1.*miniature/);
  });

  it("signale un fichier tronqué", () => {
    const whole = gwbFile([pageBytes(1920, 1080, [])]);
    expect(() => parseGwb(whole.subarray(0, whole.length - 5))).toThrow(/tronqué/);
  });

  it("ignore un objet inconnu sans perdre le reste de la page", () => {
    const doc = parseGwb(gwbFile([pageBytes(1920, 1080, [object(0x999, new W().zero(8)), strokeObject([1, 2, 3, 4])])]));
    expect(doc.pages[0].objects).toHaveLength(1);
    expect(doc.warnings[0]).toMatch(/non pris en charge/);
  });
});

describe("gwbToPages", () => {
  it("met une page 1920 × 1200 à l'échelle et la centre dans la feuille", async () => {
    const doc = parseGwb(gwbFile([pageBytes(1920, 1200, [strokeObject([0, 0, 1920, 1200])])]));
    const [page] = await convert(doc);
    const s = page.objects[0];
    if (s.kind !== "stroke") throw new Error("trait attendu");
    expect(s.points).toEqual([96, 0, 1824, 1080]);
    expect(s.width).toBeCloseTo(1.8);
  });

  it("tourne une forme autour de son centre", async () => {
    const doc = parseGwb(gwbFile([pageBytes(1920, 1080, [shapeObject(110, null, -Math.PI / 2)])]));
    const [page] = await convert(doc);
    const r = page.objects[0];
    if (r.kind !== "shape") throw new Error("forme attendue");
    expect(r.rotation).toBeCloseTo(90);
    // Centre (200, 150) : le coin haut-gauche de 200 × 100 tourné de 90° arrive en (250, 50)
    expect(r.x).toBeCloseTo(250);
    expect(r.y).toBeCloseTo(50);
  });

  it("garde triangle et remplissage, y compris après enregistrement", async () => {
    const doc = parseGwb(gwbFile([pageBytes(1920, 1080, [shapeObject(115, 0x00ff00), shapeObject(112, null)])]));
    const pages = await convert(doc);
    expect(pages[0].objects[0]).toMatchObject({ shape: "triangle", fill: "#00ff00", x: 100, y: 100 });
    expect(pages[0].objects[1]).toMatchObject({ shape: "ellipse", x: 200, y: 150 });
    expect(parseSession(serializeSession(pages, pages[0].id)).pages).toEqual(pages);
  });

  it("sépare les paragraphes de styles différents, l'un sous l'autre", async () => {
    const rtf = String.raw`{\rtf1{\fonttbl{\f0 Gigi;}{\f1 Arial;}}\f0\b\fs60 Titre\par\f1\b0\fs30 Corps\par Suite\par}`;
    const pages = await convert(parseGwb(gwbFile([pageBytes(1920, 1080, [textObject(rtf)])])));
    const [a, b] = pages[0].objects;
    if (a.kind !== "text" || b.kind !== "text") throw new Error("textes attendus");
    expect(pages[0].objects).toHaveLength(2);
    expect(a).toMatchObject({ text: "Titre", font: "Gigi", bold: true, fontSize: 40 });
    expect(b).toMatchObject({ text: "Corps\nSuite", font: "Arial", fontSize: 20 });
    expect(b.y).toBeCloseTo(a.y + 40 * 1.2);
    expect(parseSession(serializeSession(pages, pages[0].id)).pages).toEqual(pages);
  });

  it("garde en lien un média non retrouvé et signale les autres liens", async () => {
    const doc = parseGwb(gwbFile([pageBytes(1920, 1080, [strokeObject([1800, 1000, 1900, 1050], "son.wma")])]));
    const [page] = await convert(doc, tools(async () => ({ mediaId: "m1", name: "son.wma", audio: true })));
    const player = page.objects[page.objects.length - 1];
    if (player.kind !== "video") throw new Error("lecteur attendu");
    expect(player).toMatchObject({ audio: true, source: { type: "file", mediaId: "m1", name: "son.wma" } });
    expect(player.x + player.w).toBeLessThanOrEqual(1920);
    expect(player.y + player.h).toBeLessThanOrEqual(1080);
  });

  it("signale les objets de calques masqués", async () => {
    const doc = parseGwb(gwbFile([pageBytes(1920, 1080, [], { hidden: [shapeObject(110, null)] })]));
    await convert(doc);
    expect(doc.warnings[0]).toMatch(/page 1 : 1 objets de calques masqués/);
  });
});

describe("resolveFrom", () => {
  it("résout un chemin relatif ou absolu", () => {
    expect(resolveFrom("C:\\a\\b\\c", "..\\..\\d\\son.wma")).toBe("C:\\a\\d\\son.wma");
    expect(resolveFrom("C:\\a", "D:\\son.wma")).toBe("D:\\son.wma");
  });
});

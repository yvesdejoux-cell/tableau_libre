// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { BoardObject, Page } from "../types";
import { buildUbz } from "./ubz";
import { mergeRings, readUbz, type UbzSource } from "./ubzRead";

const size = { w: 1920, h: 1080 };
const tf = { scaleX: 1, scaleY: 1, rotation: 0 };
const PNG_1X2 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAAD0lEQVR4nGP4z8DAwMAAAAQAAf8KjF0AAAAASUVORK5CYII=";

function sourceOf(files: Map<string, Uint8Array>): UbzSource {
  return {
    names: [...files.keys()],
    text: async (name) => new TextDecoder().decode(files.get(name)),
    image: async () => PNG_1X2,
  };
}

/** Une page telle qu'OpenBoard l'écrit, sans rien de propre à Tableau Libre. */
function openBoardPage(body: string, attrs = 'ub:nominal-size="1920x1080"') {
  const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:ub="http://uniboard.mnemis.com/document" ${attrs}>${body}</svg>`;
  return new Map([["page000.svg", new TextEncoder().encode(svg)]]);
}

const everyObject: BoardObject[] = [
  { ...tf, id: "a", kind: "stroke", tool: "pen", x: 5, y: 6, points: [1, 2, 3, 4], color: "#ff0000", width: 6 },
  { ...tf, id: "b", kind: "stroke", tool: "highlighter", x: 0, y: 0, points: [1, 2, 3, 4], color: "#ffff00", width: 30 },
  { ...tf, id: "c", kind: "stroke", tool: "eraser", x: 0, y: 0, points: [1, 2, 3, 4], color: "#000000", width: 20 },
  { ...tf, id: "d", kind: "shape", shape: "arrow", x: 1, y: 2, w: 30, h: 40, color: "#008000", width: 5 },
  { ...tf, rotation: 30, id: "e", kind: "shape", shape: "rect", x: 1, y: 2, w: 30, h: 40, color: "#800080", width: 5, fill: "#ffc0cb" },
  { ...tf, id: "f", kind: "shape", shape: "ellipse", x: 100, y: 100, w: 30, h: 40, color: "#ff8000", width: 5 },
  { ...tf, id: "g", kind: "text", x: 10, y: 20, w: 600, fontSize: 48, color: "#c00000", bold: true, align: "center", font: "Times New Roman", text: "é & <b>\nligne 2" },
  { ...tf, scaleX: 2, id: "h", kind: "image", x: 10, y: 20, w: 300, h: 200, src: PNG_1X2 },
];

describe("aller-retour dans Tableau Libre", () => {
  it("retrouve exactement chaque objet et le fond de chaque page", async () => {
    const pages: Page[] = [
      { id: "p1", background: "staff", objects: everyObject },
      { id: "p2", background: "seyes", objects: [] },
    ];
    const { files } = buildUbz({ title: "T", size, pages, currentIndex: 1 });
    const doc = await readUbz(sourceOf(files));
    expect(doc.pages[0].objects).toEqual(everyObject);
    expect(doc.pages.map((p) => p.background)).toEqual(["staff", "seyes"]);
    expect(doc.currentPageId).toBe(doc.pages[1].id);
    expect(doc.warnings).toEqual([]);
  });

  it("retrouve un lien vidéo à sa taille, et un son avec son identifiant", async () => {
    const lien: BoardObject = { ...tf, id: "v", kind: "video", x: 40, y: 50, w: 480, h: 270, source: { type: "url", url: "https://www.youtube.com/watch?v=abc" } };
    const son: BoardObject = { ...tf, id: "s", kind: "video", audio: true, x: 0, y: 0, w: 320, h: 64, source: { type: "file", mediaId: "m1", name: "a.mp3" } };
    const { files, media } = buildUbz({ title: "T", size, pages: [{ background: "blank", objects: [lien, son] }], media: new Map([["m1", { name: "a.mp3" }]]) });
    const doc = await readUbz(sourceOf(files));
    expect(doc.pages[0].objects).toEqual(expect.arrayContaining([lien, son]));
    expect(doc.media.get("m1")).toBe(media.get("m1"));
  });

  it("garde l'ordre d'un trait dessiné après une vidéo", async () => {
    const lien: BoardObject = { ...tf, id: "v", kind: "video", x: 0, y: 0, w: 480, h: 270, source: { type: "url", url: "https://www.youtube.com/watch?v=abc" } };
    const trait: BoardObject = { ...tf, id: "t", kind: "stroke", tool: "pen", x: 0, y: 0, points: [1, 2, 3, 4], color: "#ff0000", width: 6 };
    const { files } = buildUbz({ title: "T", size, pages: [{ background: "blank", objects: [lien, trait] }] });
    expect((await readUbz(sourceOf(files))).pages[0].objects).toEqual([lien, trait]);
  });

  it("garde un média absent, pour pouvoir le retrouver plus tard", async () => {
    const son: BoardObject = { ...tf, id: "s", kind: "video", audio: true, x: 0, y: 0, w: 320, h: 64, source: { type: "file", mediaId: "m1", name: "a.wma" } };
    const { files } = buildUbz({ title: "T", size, pages: [{ background: "blank", objects: [son] }] });
    const doc = await readUbz(sourceOf(files));
    expect(doc.pages[0].objects).toEqual([son]);
    expect(doc.media.size).toBe(0);
  });
});

describe("page réécrite par OpenBoard", () => {
  it("refait une vidéo à partir du lien gardé en texte", async () => {
    const html = `&lt;html&gt;&lt;body&gt;&lt;p&gt;&lt;a href="https://www.youtube.com/watch?v=abc"&gt;&lt;span&gt;https://www.youtube.com/watch?v=abc&lt;/span&gt;&lt;/a&gt;&lt;/p&gt;&lt;/body&gt;&lt;/html&gt;`;
    const doc = await readUbz(sourceOf(openBoardPage(`<foreignObject ub:type="text" width="488" height="44" transform="matrix(1, 0, 0, 1, -360, 160)"><itemTextContent>${html}</itemTextContent></foreignObject>`)));
    expect(doc.pages[0].objects[0]).toMatchObject({ kind: "video", source: { type: "url", url: "https://www.youtube.com/watch?v=abc" } });
  });

  it("garde en texte un lien qui n'est pas une vidéo ou un texte qui en contient un", async () => {
    const html = `&lt;p&gt;Voir &lt;a href="https://www.youtube.com/watch?v=abc"&gt;&lt;span&gt;ici&lt;/span&gt;&lt;/a&gt;&lt;/p&gt;`;
    const doc = await readUbz(sourceOf(openBoardPage(`<foreignObject ub:type="text" width="400" height="44"><itemTextContent>${html}</itemTextContent></foreignObject>`)));
    expect(doc.pages[0].objects[0]).toMatchObject({ kind: "text", text: "Voir ici" });
  });

  it("n'accepte jamais une adresse dangereuse comme vidéo", async () => {
    const html = `&lt;p&gt;&lt;a href="javascript:alert(1)"&gt;javascript:alert(1)&lt;/a&gt;&lt;/p&gt;`;
    const doc = await readUbz(sourceOf(openBoardPage(`<foreignObject ub:type="text" width="400" height="44"><itemTextContent>${html}</itemTextContent></foreignObject>`)));
    expect(doc.pages[0].objects[0]).toMatchObject({ kind: "text" });
  });

  it("refait le lecteur d'un média introuvable, à retrouver", async () => {
    const html = `&lt;p&gt;&lt;span&gt;Fichier introuvable : 16. NO SCHOOL TODAY.wma&lt;/span&gt;&lt;/p&gt;`;
    const doc = await readUbz(sourceOf(openBoardPage(`<foreignObject ub:type="text" width="320" height="44"><itemTextContent>${html}</itemTextContent></foreignObject>`)));
    expect(doc.pages[0].objects[0]).toMatchObject({ kind: "video", audio: true, source: { type: "file", name: "16. NO SCHOOL TODAY.wma" } });
    expect(doc.media.size).toBe(0);
  });

  it("réunit les polygones d'un trait en un seul objet plein", async () => {
    const doc = await readUbz(sourceOf(openBoardPage(
      `<g ub:z-value="1"><polygon points="0,0 10,0 10,10" fill="#ff0000" fill-opacity="1.00"/><polygon points="20,20 20,30 30,30" fill="#ff0000" fill-opacity="1.00"/></g>`
    )));
    expect(doc.pages[0].objects).toHaveLength(1);
    expect(doc.pages[0].objects[0]).toMatchObject({ kind: "stroke", closed: true, color: "#ff0000", tool: "pen" });
  });

  it("respecte l'ordre des z, pas l'ordre du fichier", async () => {
    const doc = await readUbz(sourceOf(openBoardPage(
      `<g ub:z-value="2"><polyline points="0,0 1,1" stroke="#000002" stroke-width="2"/></g><g ub:z-value="1"><polyline points="0,0 1,1" stroke="#000001" stroke-width="2"/></g>`
    )));
    expect(doc.pages[0].objects.map((o) => (o.kind === "stroke" ? o.color : ""))).toEqual(["#000001", "#000002"]);
  });

  it("reconnaît le fond et remet à l'échelle une page d'une autre taille", async () => {
    const doc = await readUbz(sourceOf(openBoardPage(
      `<polyline points="0,0 960,600" stroke="#000000" stroke-width="10"/>`,
      'ub:nominal-size="1920x1200" ub:crossed-background="true" ub:intermediate-lines="1"'
    )));
    expect(doc.pages[0].background).toBe("seyes");
    expect(doc.pages[0].objects[0]).toMatchObject({ points: [960, 540, 1824, 1080], width: 9 });
  });

  it("lit le texte, ses styles et sa taille en points", async () => {
    const html = `&lt;html&gt;&lt;body style=" font-family:'Segoe UI'; font-size:9pt;"&gt;&lt;p align="center"&gt;&lt;span style=" font-family:'Arial'; font-size:48pt; font-weight:700; font-style:italic; text-decoration: underline; color:#c00000;"&gt;Bonjour&lt;/span&gt;&lt;/p&gt;&lt;/body&gt;&lt;/html&gt;`;
    const doc = await readUbz(sourceOf(openBoardPage(`<foreignObject ub:type="text" width="608" height="44" transform="matrix(1, 0, 0, 1, -364, -24)"><itemTextContent>${html}</itemTextContent></foreignObject>`)));
    expect(doc.pages[0].objects[0]).toMatchObject({ kind: "text", text: "Bonjour", x: 600, y: 520, w: 600, fontSize: 64, color: "#c00000", font: "Arial", bold: true, italic: true, underline: true, align: "center" });
  });

  it("signale un widget au lieu de l'ignorer en silence", async () => {
    const doc = await readUbz(sourceOf(openBoardPage(`<foreignObject src="widgets/x.wgt" width="10" height="10"/>`)));
    expect(doc.warnings).toHaveLength(1);
  });

  it("refuse un fichier sans page", async () => {
    await expect(readUbz(sourceOf(new Map()))).rejects.toThrow("aucune page");
  });
});

describe("mergeRings", () => {
  it("met les contours dans le même sens et les relie", () => {
    const cw: [number, number][] = [[0, 0], [0, 10], [10, 10]];
    const ccw: [number, number][] = [[20, 20], [30, 20], [30, 30]];
    const merged = mergeRings([cw, ccw]);
    expect(merged.slice(0, 8)).toEqual([10, 10, 0, 10, 0, 0, 10, 10]);
    expect(merged.slice(-2)).toEqual([10, 10]);
  });
});

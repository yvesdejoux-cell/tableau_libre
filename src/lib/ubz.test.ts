import { describe, expect, it } from "vitest";
import type { BoardObject, Page } from "../types";
import { buildUbz, imageSize } from "./ubz";

const size = { w: 1920, h: 1080 };
const tf = { scaleX: 1, scaleY: 1, rotation: 0 };
const PNG_1X2 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAAD0lEQVR4nGP4z8DAwMAAAAQAAf8KjF0AAAAASUVORK5CYII=";

function pageText(objects: BoardObject[], background: Page["background"] = "blank", media?: Parameters<typeof buildUbz>[0]["media"]) {
  const { files, media: built, warnings } = buildUbz({ title: "T & <x>", size, pages: [{ objects, background }], media });
  return { svg: new TextDecoder().decode(files.get("page000.svg")), files, media: built, warnings };
}

describe("buildUbz", () => {
  it("écrit les métadonnées et une page par fichier, titre échappé", () => {
    const { files } = buildUbz({ title: "T & <x>", size, pages: [{ objects: [], background: "blank" }, { objects: [], background: "blank" }] });
    expect([...files.keys()]).toEqual(["metadata.rdf", "page000.svg", "page001.svg"]);
    expect(new TextDecoder().decode(files.get("metadata.rdf"))).toContain("<dc:title>T &amp; &lt;x&gt;</dc:title>");
  });

  it("place l'origine au centre de la page", () => {
    const { svg } = pageText([{ ...tf, id: "a", kind: "stroke", tool: "pen", x: 0, y: 0, points: [960, 540, 970, 550], color: "#ff0000", width: 4 }]);
    expect(svg).toContain('viewBox="-960 -540 1920 1080"');
    expect(svg).toContain('points="0,0 10,10"');
  });

  it("applique le déplacement et la rotation d'un trait", () => {
    const { svg } = pageText([{ ...tf, rotation: 90, id: "a", kind: "stroke", tool: "pen", x: 960, y: 540, points: [0, 0, 10, 0], color: "#000000", width: 4 }]);
    expect(svg).toContain('points="0,0 0,10"');
  });

  it("met le z d'une forme remplie sur son polygone, seul lu par OpenBoard", () => {
    const { svg } = pageText([{ ...tf, id: "a", kind: "shape", shape: "rect", x: 0, y: 0, w: 10, h: 10, color: "#000000", width: 2, fill: "#00ff00" }]);
    expect(svg).toMatch(/<polygon [^>]*fill="#00ff00"[^>]*ub:z-value="1\.000000"/);
  });

  it("écrit le fond Seyès avec un entier, seule valeur comprise par OpenBoard", () => {
    const { svg } = pageText([], "seyes");
    expect(svg).toContain('ub:crossed-background="true"');
    expect(svg).toContain('ub:intermediate-lines="1"');
  });

  it("échappe le texte deux fois : dans le HTML, puis dans le XML", () => {
    const { svg } = pageText([{ ...tf, id: "a", kind: "text", x: 0, y: 0, w: 100, fontSize: 20, color: "#000000", text: "a & b" }]);
    expect(svg).toContain("a &amp;amp; b");
  });

  it("range l'image dans images/, à sa taille réelle", () => {
    const { svg, files } = pageText([{ ...tf, id: "a", kind: "image", x: 960, y: 540, w: 10, h: 40, src: PNG_1X2 }]);
    expect([...files.keys()].some((k) => /^images\/\{.+\}\.png$/.test(k))).toBe(true);
    expect(svg).toContain('width="1" height="2"');
    expect(svg).toContain('transform="matrix(10, 0, 0, 20, 0, 0)"');
  });

  it("range le son à part, garde le lien en texte et signale le fichier absent", () => {
    const son: BoardObject = { ...tf, id: "s", kind: "video", audio: true, x: 0, y: 0, w: 320, h: 64, source: { type: "file", mediaId: "m", name: "a.MP3" } };
    const absent: BoardObject = { ...son, id: "t", source: { type: "file", mediaId: "n", name: "b.mp3" } };
    const lien: BoardObject = { ...tf, id: "v", kind: "video", x: 0, y: 0, w: 480, h: 270, source: { type: "url", url: "https://example.org/v" } };
    const { svg, media, warnings } = pageText([son, absent, lien], "blank", new Map([["m", { name: "a.MP3" }]]));
    expect(media.get("m")).toMatch(/^audios\/\{.+\}\.mp3$/);
    expect(svg.match(/<audio /g)).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(svg).toContain("Fichier introuvable : b.mp3");
    expect(svg).toContain("&lt;a href=&quot;https://example.org/v&quot;&gt;");
  });

  it("n'écrit qu'une fois un média présent sur deux pages", () => {
    const son: BoardObject = { ...tf, id: "s", kind: "video", audio: true, x: 0, y: 0, w: 320, h: 64, source: { type: "file", mediaId: "m", name: "a.mp3" } };
    const { media } = buildUbz({ title: "T", size, pages: [{ objects: [son], background: "blank" }, { objects: [son], background: "blank" }], media: new Map([["m", { name: "a.mp3" }]]) });
    expect(media.size).toBe(1);
  });
});

describe("imageSize", () => {
  it("lit les dimensions d'un PNG", () => {
    const bin = atob(PNG_1X2.split(",")[1]);
    expect(imageSize(Uint8Array.from(bin, (c) => c.charCodeAt(0)))).toEqual({ w: 1, h: 2 });
  });
  it("refuse un format inconnu", () => {
    expect(imageSize(new Uint8Array(20))).toBeNull();
  });
});

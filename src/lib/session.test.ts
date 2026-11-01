import { describe, expect, it } from "vitest";
import type { BoardObject, Page } from "../types";
import { parseSession, serializeSession } from "./session";

const tf = { x: 10, y: 20, scaleX: 1, scaleY: 1, rotation: 30 };
const PNG = "data:image/png;base64,AAAA";

const stroke: BoardObject = { ...tf, id: "s", kind: "stroke", tool: "pen", points: [0, 0, 5, 5], color: "#111111", width: 4 };
const shape: BoardObject = { ...tf, id: "f", kind: "shape", shape: "arrow", w: 100, h: -50, color: "#222222", width: 3 };
const image: BoardObject = { ...tf, id: "i", kind: "image", src: PNG, w: 200, h: 100 };
const text: BoardObject = { ...tf, id: "t", kind: "text", text: "Été\nà l'école", w: 500, fontSize: 72, color: "#ef4444" };

const video: BoardObject = {
  ...tf, id: "v", kind: "video", source: { type: "file", mediaId: "m1", name: "film.avi" }, poster: "data:image/jpeg;base64,AA", w: 640, h: 360,
};
const link: BoardObject = { ...tf, id: "l", kind: "video", source: { type: "url", url: "https://youtu.be/dQw4w9WgXcQ" }, w: 640, h: 360 };

const sound: BoardObject = { ...tf, id: "a", kind: "video", audio: true, source: { type: "file", mediaId: "m2", name: "cours.flac" }, w: 500, h: 100 };

const page = (objects: BoardObject[], id = "p1"): Page => ({ id, objects, background: "seyes" });

/** Enveloppe de fichier minimale autour d'objets bruts, éventuellement invalides. */
const fileWith = (objects: unknown[], assets: Record<string, string> = {}) =>
  JSON.stringify({ format: "iwb", version: 2, currentPageIndex: 0, pages: [{ id: "p1", background: "blank", objects }], assets });

describe("serializeSession / parseSession", () => {
  it("retrouve à l'identique tous les types d'objets", () => {
    const pages = [page([stroke, shape, image, text, video, link, sound]), { ...page([], "p2"), background: "black" as const }];
    const back = parseSession(serializeSession(pages, "p2"));
    expect(back.pages).toEqual(pages);
    expect(back.currentPageId).toBe("p2");
  });

  it("ne stocke qu'une fois une image utilisée plusieurs fois", () => {
    const json = serializeSession([page([image, { ...image, id: "i2" }])], "p1");
    const file = JSON.parse(json);
    expect(Object.values(file.assets)).toEqual([PNG]);
    expect(file.pages[0].objects[0].src).toBe(file.pages[0].objects[1].src);
    expect(file.pages[0].objects[0].src).not.toContain("data:");
  });
});

describe("parseSession : fichiers invalides", () => {
  it.each([
    ["pas du JSON", "{oups", /illisible/],
    ["un autre format", JSON.stringify({ format: "autre", version: 1 }), /n'est pas une session/],
    ["une version future", JSON.stringify({ format: "iwb", version: 3, pages: [{}] }), /plus récente/],
    ["aucune page", JSON.stringify({ format: "iwb", version: 2, pages: [] }), /aucune page/],
  ])("refuse %s", (_nom, contenu, message) => {
    expect(() => parseSession(contenu)).toThrow(message);
  });

  it("ignore les objets invalides et garde les autres", () => {
    const { pages } = parseSession(
      fileWith([
        null,
        { kind: "inconnu" },
        { kind: "stroke", points: [1, 2] }, // trop peu de points
        { kind: "shape", shape: "hexagone" },
        { kind: "text", text: "   " }, // texte vide
        { kind: "text", text: 12 },
        text,
      ])
    );
    expect(pages[0].objects.map((o) => o.id)).toEqual(["t"]);
  });

  it("refuse les images externes et les références inconnues", () => {
    const { pages } = parseSession(
      fileWith([
        { kind: "image", src: "https://exemple.org/a.png" },
        { kind: "image", src: "asset:absent" },
        { id: "ok", kind: "image", src: "asset:a1" },
      ], { a1: PNG })
    );
    expect(pages[0].objects.map((o) => o.id)).toEqual(["ok"]);
  });

  it("refuse les vidéos aux sources dangereuses", () => {
    const { pages } = parseSession(
      fileWith([
        { kind: "video", source: { type: "url", url: "javascript:alert(1)" } },
        { kind: "video", source: { type: "url", url: "file:///c:/a.mp4" } },
        { kind: "video", source: { type: "file", mediaId: "../../secret" } },
        { kind: "video" },
        { id: "ok", kind: "video", source: { type: "url", url: "https://youtu.be/dQw4w9WgXcQ" }, poster: "https://exemple.org/a.png" },
      ])
    );
    expect(pages[0].objects.map((o) => o.id)).toEqual(["ok"]);
    expect(pages[0].objects[0]).not.toHaveProperty("poster");
  });

  it("borne un texte aux valeurs aberrantes et remet son échelle à 1", () => {
    const { pages } = parseSession(fileWith([{ kind: "text", text: "a", w: 1, fontSize: 99999, scaleX: 3, scaleY: 3 }]));
    expect(pages[0].objects[0]).toMatchObject({ w: 80, fontSize: 600, scaleX: 1, scaleY: 1 });
  });

  it("remplace un fond inconnu et ramène l'index de page dans les bornes", () => {
    const json = JSON.stringify({
      format: "iwb",
      version: 2,
      currentPageIndex: 9,
      pages: [{ id: "a", background: "martien", objects: [] }, { id: "b", background: "grid", objects: [] }],
    });
    const { pages, currentPageId } = parseSession(json);
    expect(pages[0].background).toBe("blank");
    expect(currentPageId).toBe("b");
  });
});

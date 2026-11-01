import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TextObject } from "../types";
import { selectCurrentPage, useBoardStore } from "./useBoardStore";

// Les épaisseurs par défaut sont calculées dès le chargement, d'après la taille de l'écran
vi.hoisted(() => vi.stubGlobal("window", { innerWidth: 1920, innerHeight: 1080, screen: { width: 1920, height: 1080 } }));

const state = () => useBoardStore.getState();
const objects = () => selectCurrentPage(state()).objects;

const box = (id = "t"): TextObject => ({
  id, kind: "text", text: "", x: 0, y: 0, w: 500, fontSize: 48, color: "#111827", scaleX: 1, scaleY: 1, rotation: 0,
});

/** Crée une zone contenant `text` et termine son édition. */
function writeText(text: string, id = "t") {
  state().startNewText(box(id));
  state().patchEditedText({ text });
  state().endTextEdit();
}

describe("édition de texte et historique", () => {
  beforeEach(() => state().resetSession());

  it("une édition entière ne compte que pour une annulation", () => {
    state().startNewText(box());
    for (const text of ["a", "ab", "abc"]) state().patchEditedText({ text });
    state().patchEditedText({ color: "#ef4444" });
    expect(state().past).toHaveLength(0);
    state().endTextEdit();
    expect(state().past).toHaveLength(1);
    state().undo();
    expect(objects()).toEqual([]);
    state().redo();
    expect(objects()[0]).toMatchObject({ text: "abc", color: "#ef4444" });
  });

  it("le contenu est dans la page dès la frappe", () => {
    state().startNewText(box());
    state().patchEditedText({ text: "en cours" });
    expect(objects()[0]).toMatchObject({ text: "en cours" });
  });

  it("une zone neuve laissée vide ne laisse aucune trace", () => {
    const before = state().pages;
    state().startNewText(box());
    state().patchEditedText({ text: "   " });
    state().endTextEdit();
    expect(state().pages).toBe(before);
    expect(state().past).toHaveLength(0);
    expect(state().editingId).toBeNull();
  });

  it("rouvrir une zone sans la changer n'ajoute pas d'annulation", () => {
    writeText("abc");
    state().startEditText("t");
    state().endTextEdit();
    expect(state().past).toHaveLength(1);
  });

  it("vider une zone existante la supprime, et l'annulation la rend", () => {
    writeText("abc");
    state().startEditText("t");
    state().patchEditedText({ text: "" });
    state().endTextEdit();
    expect(objects()).toEqual([]);
    state().undo();
    expect(objects()[0]).toMatchObject({ text: "abc" });
  });

  it("rouvrir une zone reprend sa couleur et sa taille comme réglages", () => {
    state().startNewText({ ...box(), color: "#22c55e", fontSize: 112 });
    state().patchEditedText({ text: "abc" });
    state().endTextEdit();
    state().setColor("#111827");
    state().setTextSize(32);
    state().startEditText("t");
    expect([state().color, state().textSize]).toEqual(["#22c55e", 112]);
  });
});

describe("couleur et taille appliquées au texte", () => {
  beforeEach(() => {
    state().resetSession();
    state().select(null);
    writeText("abc");
  });

  it("sélectionné : la zone change, avec une annulation par réglage", () => {
    state().select("t");
    state().setColor("#3b82f6");
    state().setTextSize(72);
    expect(objects()[0]).toMatchObject({ color: "#3b82f6", fontSize: 72 });
    expect(state().past).toHaveLength(3);
  });

  it("en édition : la zone change sans annulation supplémentaire", () => {
    state().startEditText("t");
    state().setColor("#3b82f6");
    state().setTextSize(72);
    expect(state().past).toHaveLength(1);
    state().endTextEdit();
    expect(state().past).toHaveLength(2);
    expect(objects()[0]).toMatchObject({ color: "#3b82f6", fontSize: 72 });
  });

  it("sans zone active : seuls les réglages changent", () => {
    state().setColor("#3b82f6");
    expect(objects()[0]).toMatchObject({ color: "#111827" });
    expect(state().color).toBe("#3b82f6");
  });
});

describe("couleur appliquée aux formes", () => {
  const shape = {
    id: "f", kind: "shape", shape: "rect", w: 100, h: 50, color: "#111827", width: 4, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
  } as const;
  const stroke = {
    id: "s", kind: "stroke", tool: "pen", points: [0, 0, 5, 5], color: "#111827", width: 4, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
  } as const;

  beforeEach(() => {
    state().resetSession();
    state().addObject({ ...shape });
    state().addObject({ ...stroke, points: [...stroke.points] });
    state().setColor("#111827");
  });

  it("sélectionnée : la forme change, et l'annulation rend sa couleur", () => {
    state().select("f");
    state().setColor("#ef4444");
    expect(objects()[0]).toMatchObject({ color: "#ef4444" });
    state().undo();
    expect(objects()[0]).toMatchObject({ color: "#111827" });
  });

  it("non sélectionnée : la forme ne change pas", () => {
    state().select(null);
    state().setColor("#ef4444");
    expect(objects()[0]).toMatchObject({ color: "#111827" });
  });

  it("un trait de stylo sélectionné ne change pas", () => {
    state().select("s");
    state().setColor("#ef4444");
    expect(objects()[1]).toMatchObject({ color: "#111827" });
  });
});

describe("session", () => {
  it("charger une session interrompt l'édition en cours", () => {
    state().resetSession();
    state().startNewText(box());
    state().loadSession([{ id: "p", objects: [], background: "blank" }], "p");
    expect([state().editingId, state().editBase]).toEqual([null, null]);
  });
});

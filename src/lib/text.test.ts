import { describe, expect, it } from "vitest";
import { TEXT_LINE_HEIGHT, clampFontSize, newTextBox } from "./text";
import { PAGE_H, PAGE_W } from "./view";

describe("newTextBox", () => {
  it("centre la première ligne sur le point touché", () => {
    expect(newTextBox({ x: 100, y: 200 }, 50)).toEqual({ x: 100, y: 200 - (50 * TEXT_LINE_HEIGHT) / 2, w: 700 });
  });

  it("reste dans la page quand on touche la marge", () => {
    const hautGauche = newTextBox({ x: -50, y: -50 }, 50);
    expect([hautGauche.x, hautGauche.y]).toEqual([0, 0]);
    const basDroite = newTextBox({ x: 5000, y: 5000 }, 50);
    expect(basDroite.x + basDroite.w).toBe(PAGE_W);
    expect(basDroite.y).toBe(PAGE_H - 50 * TEXT_LINE_HEIGHT);
  });

  it("réduit la largeur près du bord droit", () => {
    expect(newTextBox({ x: PAGE_W - 300, y: 100 }, 50).w).toBe(300);
  });
});

describe("clampFontSize", () => {
  it("arrondit et borne la taille", () => {
    expect(clampFontSize(47.6)).toBe(48);
    expect(clampFontSize(1)).toBe(8);
    expect(clampFontSize(5000)).toBe(600);
  });
});

import { describe, expect, it } from "vitest";
import { PAGE_H, PAGE_W, clampView, fitView, zoomViewAt } from "./view";

describe("fitView", () => {
  it("remplit un écran de même format que la page", () => {
    expect(fitView(960, 540)).toEqual({ s: 0.5, x: 0, y: 0 });
  });

  it("centre la page quand le format diffère", () => {
    const v = fitView(1000, 1000);
    expect(v.s).toBeCloseTo(1000 / PAGE_W);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo((1000 - PAGE_H * v.s) / 2);
  });

  it("garde une échelle positive pour une fenêtre minuscule", () => {
    expect(fitView(0, 0).s).toBe(0.05);
  });
});

describe("clampView", () => {
  const [vw, vh] = [960, 540];

  it("ne touche pas à une vue correcte", () => {
    expect(clampView({ s: 0.5, x: 0, y: 0 }, vw, vh)).toEqual({ s: 0.5, x: 0, y: 0 });
  });

  it("borne le zoom entre l'ajustement et 10× l'ajustement", () => {
    expect(clampView({ s: 100, x: 0, y: 0 }, vw, vh).s).toBe(5);
    expect(clampView({ s: 0.01, x: 0, y: 0 }, vw, vh).s).toBe(0.5);
  });

  it("au dézoom maximal, donne la vue ajustée quelle que soit la position", () => {
    const v = clampView({ s: 0.01, x: 500, y: -300 }, 1000, 1000);
    const f = fitView(1000, 1000);
    expect(v.s).toBe(f.s);
    expect(v.x).toBeCloseTo(f.x);
    expect(v.y).toBeCloseTo(f.y);
  });

  it("ne laisse pas de vide autour d'une page zoomée", () => {
    const loin = clampView({ s: 1, x: 99999, y: 99999 }, vw, vh);
    expect([loin.x, loin.y]).toEqual([0, 0]);
    const autre = clampView({ s: 1, x: -99999, y: -99999 }, vw, vh);
    expect([autre.x, autre.y]).toEqual([vw - PAGE_W, vh - PAGE_H]);
  });
});

describe("zoomViewAt", () => {
  it("laisse immobile le point de page sous le centre du zoom", () => {
    const v = { s: 0.5, x: 30, y: -20 };
    const z = zoomViewAt(v, 2, 400, 300);
    expect(z.s).toBe(1);
    expect((400 - z.x) / z.s).toBeCloseTo((400 - v.x) / v.s);
    expect((300 - z.y) / z.s).toBeCloseTo((300 - v.y) / v.s);
  });
});

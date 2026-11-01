import { describe, expect, it } from "vitest";
import { EDGE_TAB_H, stackEdgeTabs } from "./edgeTabs";

describe("stackEdgeTabs", () => {
  it("garde chaque repère à la hauteur de sa boîte quand il y a la place", () => {
    const r = stackEdgeTabs([{ id: "a", side: "left", y: 16 }, { id: "b", side: "left", y: 200 }], 768);
    expect(r).toEqual({ a: 16, b: 200 });
  });

  it("ne superpose pas deux repères du même bord", () => {
    const r = stackEdgeTabs([{ id: "a", side: "right", y: 16 }, { id: "b", side: "right", y: 20 }], 768);
    expect(r.b - r.a).toBeGreaterThanOrEqual(EDGE_TAB_H);
  });

  it("laisse indépendants les deux bords", () => {
    const r = stackEdgeTabs([{ id: "a", side: "left", y: 16 }, { id: "b", side: "right", y: 16 }], 768);
    expect(r).toEqual({ a: 16, b: 16 });
  });

  it("remonte les repères qui sortiraient par le bas", () => {
    const r = stackEdgeTabs([{ id: "a", side: "left", y: 760 }, { id: "b", side: "left", y: 765 }], 768);
    expect(r.b).toBe(768 - EDGE_TAB_H);
    expect(r.b - r.a).toBeGreaterThanOrEqual(EDGE_TAB_H);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { useWidgetStore, type Widget } from "../store/useWidgetStore";
import { SQUARE_K, findGuide, projectOnGuide, widgetSegments } from "./guides";
import { RULER_H, rotateVec, rotationFromPoint, snapAngle, toLocal, toWorld } from "./rulerGeometry";

const ruler = (rotation = 0): Widget => ({ id: "r", z: 1, type: "ruler", cx: 500, cy: 300, rotation, length: 400 });
const HH = RULER_H / 2;

describe("repère des widgets", () => {
  it("toWorld et toLocal sont réciproques", () => {
    const f = { cx: 120, cy: -40, rotation: 37 };
    const back = toLocal(f, toWorld(f, { x: 15, y: 80 }));
    expect(back.x).toBeCloseTo(15);
    expect(back.y).toBeCloseTo(80);
  });

  it("tourne dans le sens horaire à l'écran (y vers le bas)", () => {
    const v = rotateVec({ cx: 0, cy: 0, rotation: 90 }, { x: 1, y: 0 });
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(1);
  });

  it("aimante l'angle à moins de 3° d'un multiple de 45°", () => {
    expect(snapAngle(46)).toBe(45);
    expect(snapAngle(-88)).toBe(-90);
    expect(snapAngle(50)).toBe(50);
  });

  it("place la poignée sous le pointeur après rotation", () => {
    const f = { cx: 100, cy: 100, rotation: 0 };
    const handle = { x: 50, y: 20 };
    const p = { x: 40, y: 170 };
    const moved = toWorld({ ...f, rotation: rotationFromPoint(f, p, handle) }, handle);
    expect(Math.atan2(moved.y - 100, moved.x - 100)).toBeCloseTo(Math.atan2(p.y - 100, p.x - 100));
  });
});

describe("widgetSegments", () => {
  it("donne les deux bords de la règle, normales vers l'extérieur", () => {
    const [haut, bas] = widgetSegments(ruler());
    expect(haut.a).toEqual({ x: 300, y: 300 - HH });
    expect(haut.n.y).toBe(-1);
    expect(bas.b).toEqual({ x: 700, y: 300 + HH });
    expect(bas.n.y).toBe(1);
  });

  it.each([45, 60] as const)("équerre %i° : normales unitaires et sortantes", (variant) => {
    const w: Widget = { id: "e", z: 1, type: "square", cx: 0, cy: 0, rotation: 0, size: 300, variant };
    const segments = widgetSegments(w);
    expect(segments).toHaveLength(3);
    const h = 300 * SQUARE_K[variant];
    const centre = { x: 100, y: -h / 3 }; // centre de gravité du triangle
    for (const s of segments) {
      expect(Math.hypot(s.n.x, s.n.y)).toBeCloseTo(1);
      expect((centre.x - s.a.x) * s.n.x + (centre.y - s.a.y) * s.n.y).toBeLessThan(0);
    }
  });

  it("le rideau ne guide rien", () => {
    expect(widgetSegments({ id: "c", z: 1, type: "shade", l: 0, t: 0, r: 1, b: 1 })).toEqual([]);
  });
});

describe("findGuide", () => {
  beforeEach(() => useWidgetStore.setState({ widgets: [ruler()] }));

  it("s'accroche au bord le plus proche, seulement côté extérieur", () => {
    expect(findGuide({ x: 500, y: 300 + HH + 10 })?.n.y).toBe(1);
    expect(findGuide({ x: 500, y: 300 - HH - 10 })?.n.y).toBe(-1);
    expect(findGuide({ x: 500, y: 300 })).toBeNull(); // sur la règle
  });

  it("ne s'accroche pas trop loin du bord ni au-delà de ses extrémités", () => {
    expect(findGuide({ x: 500, y: 300 + HH + 40 })).toBeNull();
    expect(findGuide({ x: 760, y: 300 + HH + 5 })).toBeNull();
  });

  it("ne trouve rien sans widget", () => {
    useWidgetStore.setState({ widgets: [] });
    expect(findGuide({ x: 500, y: 300 })).toBeNull();
  });
});

describe("projectOnGuide", () => {
  const bas = widgetSegments(ruler())[1];

  it("projette sur le bord et décale vers l'extérieur", () => {
    expect(projectOnGuide(bas, { x: 450, y: 900 }, 3)).toEqual({ x: 450, y: 300 + HH + 3 });
  });

  it("reste entre les extrémités du bord", () => {
    expect(projectOnGuide(bas, { x: 9000, y: 0 }, 0).x).toBe(700);
    expect(projectOnGuide(bas, { x: -9000, y: 0 }, 0).x).toBe(300);
  });
});

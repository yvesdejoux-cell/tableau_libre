import { describe, expect, it, vi } from "vitest";
import { baseWidths } from "../lib/defaults";
import { useBoardStore } from "./useBoardStore";
import { useViewStore } from "./useViewStore";
import { useWidgetStore } from "./useWidgetStore";

// Démarrage dans une fenêtre étroite, sur un écran 1920 × 1080
vi.hoisted(() => vi.stubGlobal("window", { innerWidth: 200, innerHeight: 300, screen: { width: 1920, height: 1080 } }));

const expected = () => baseWidths(useWidgetStore.getState().pxPerCm, 1);

describe("épaisseurs par défaut", () => {
  it("ne dépendent pas de la taille de la fenêtre au démarrage", () => {
    expect(useViewStore.getState().s).toBeLessThan(0.2);
    expect(useBoardStore.getState().widths).toEqual(expected());
  });

  it("ne dépendent pas du zoom lors d'une calibration", () => {
    useViewStore.getState().zoomAt(3, 100, 100);
    useBoardStore.getState().applyDefaultWidths();
    expect(useBoardStore.getState().baseWidths).toEqual(expected());
  });
});

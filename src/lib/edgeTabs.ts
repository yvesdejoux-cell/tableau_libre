export const EDGE_TAB_H = 48;
const GAP = 4;

export type EdgeTabPlace = { id: string; side: "left" | "right"; y: number };

/** Hauteur de chaque repère : à celle de sa boîte, sans en recouvrir un autre du même bord ni sortir de la fenêtre. */
export function stackEdgeTabs(tabs: EdgeTabPlace[], windowH: number): Record<string, number> {
  const result: Record<string, number> = {};
  for (const side of ["left", "right"] as const) {
    const sorted = tabs.filter((t) => t.side === side).sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));
    const ys: number[] = [];
    sorted.forEach((t, i) => ys.push(i ? Math.max(t.y, ys[i - 1] + EDGE_TAB_H + GAP) : t.y));
    let limit = windowH - EDGE_TAB_H;
    for (let i = sorted.length - 1; i >= 0; i--) {
      result[sorted[i].id] = Math.max(0, Math.min(ys[i], limit));
      limit = result[sorted[i].id] - EDGE_TAB_H - GAP;
    }
  }
  return result;
}

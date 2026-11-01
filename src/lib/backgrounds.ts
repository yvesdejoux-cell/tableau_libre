import type { CSSProperties } from "react";
import type { BackgroundType } from "../types";

export const BACKGROUND_LABELS: Record<BackgroundType, string> = {
  blank: "Blanc",
  black: "Noir",
  grid: "Carreaux",
  seyes: "Seyès",
  lines: "Lignes",
  staff: "Portée",
};

const staffSvg = encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 120' preserveAspectRatio='none'>${[30, 42, 54, 66, 78]
    .map((y) => `<line x1='0' x2='100' y1='${y}' y2='${y}' stroke='#334155' stroke-width='1.5' vector-effect='non-scaling-stroke'/>`)
    .join("")}</svg>`
);

const h = (color: string) => `linear-gradient(to bottom, ${color} 1px, transparent 1px)`;
const v = (color: string) => `linear-gradient(to right, ${color} 1px, transparent 1px)`;

export function backgroundStyle(bg: BackgroundType, scale = 1): CSSProperties {
  const u = 32 * scale; // grand carreau
  switch (bg) {
    case "black":
      return { backgroundColor: "#1a1a1a" };
    case "grid":
      return {
        backgroundColor: "#fff",
        backgroundImage: `${h("#cbd5e1")}, ${v("#cbd5e1")}`,
        backgroundSize: `${u}px ${u}px`,
      };
    case "seyes":
      // Grands carreaux + 3 lignes fines intermédiaires par carreau
      return {
        backgroundColor: "#fff",
        backgroundImage: `${v("#c4b5fd")}, ${h("#a78bfa")}, ${h("#ddd6fe")}`,
        backgroundSize: `${u}px ${u}px, ${u}px ${u}px, ${u}px ${u / 4}px`,
      };
    case "lines":
      return {
        backgroundColor: "#fff",
        backgroundImage: h("#bfdbfe"),
        backgroundSize: `${40 * scale}px ${40 * scale}px`,
      };
    case "staff":
      return {
        backgroundColor: "#fff",
        backgroundImage: `url("data:image/svg+xml,${staffSvg}")`,
        backgroundSize: `100% ${120 * scale}px`,
      };
    default:
      return { backgroundColor: "#fff" };
  }
}

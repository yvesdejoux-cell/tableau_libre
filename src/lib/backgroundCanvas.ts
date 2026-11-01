import type { BackgroundType } from "../types";

function hLines(ctx: CanvasRenderingContext2D, step: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  for (let y = 0; y <= h; y += step) ctx.fillRect(0, y, w, 1);
}

function vLines(ctx: CanvasRenderingContext2D, step: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  for (let x = 0; x <= w; x += step) ctx.fillRect(x, 0, 1, h);
}

export function drawBackground(ctx: CanvasRenderingContext2D, bg: BackgroundType, w: number, h: number) {
  ctx.fillStyle = bg === "black" ? "#1a1a1a" : "#ffffff";
  ctx.fillRect(0, 0, w, h);

  switch (bg) {
    case "grid":
      hLines(ctx, 32, w, h, "#cbd5e1");
      vLines(ctx, 32, w, h, "#cbd5e1");
      break;
    case "seyes":
      hLines(ctx, 8, w, h, "#ddd6fe"); // interlignes fins
      hLines(ctx, 32, w, h, "#a78bfa"); // lignes principales
      vLines(ctx, 32, w, h, "#c4b5fd"); // marges verticales
      break;
    case "lines":
      hLines(ctx, 40, w, h, "#bfdbfe");
      break;
    case "staff":
      ctx.fillStyle = "#334155";
      for (let y0 = 0; y0 < h; y0 += 120) {
        for (const dy of [30, 42, 54, 66, 78]) ctx.fillRect(0, y0 + dy - 0.75, w, 1.5);
      }
      break;
    default:
      break; // blank, black : déjà remplis
  }
}

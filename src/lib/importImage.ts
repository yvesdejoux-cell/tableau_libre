import { nanoid } from "nanoid";
import { useBoardStore } from "../store/useBoardStore";
import { screenToPage } from "../store/useViewStore";
import { PAGE_H, PAGE_W } from "./view";

const MAX_PX = 2048;
const isSvg = (f: File) => f.type === "image/svg+xml" || /\.svg$/i.test(f.name);

export const isAcceptedImage = (f: File) =>
  ["image/png", "image/jpeg", "image/svg+xml"].includes(f.type) || /\.(png|jpe?g|svg)$/i.test(f.name);

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image illisible"));
    img.src = url;
  });
}

async function rasterize(file: File): Promise<{ src: string; w: number; h: number }> {
  const svg = isSvg(file);
  // Certains OS ne renseignent pas le type MIME d'un SVG déposé : on le force.
  const blob = svg ? new Blob([file], { type: "image/svg+xml" }) : file;
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const nw = img.naturalWidth || 512;
    const nh = img.naturalHeight || 512;
    const longest = Math.max(nw, nh);
    const k = svg ? MAX_PX / longest : Math.min(1, MAX_PX / longest);
    const cw = Math.max(1, Math.round(nw * k));
    const ch = Math.max(1, Math.round(nh * k));

    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    canvas.getContext("2d")!.drawImage(img, 0, 0, cw, ch);

    const src = file.type === "image/jpeg" ? canvas.toDataURL("image/jpeg", 0.9) : canvas.toDataURL("image/png");
    return { src, w: cw, h: ch };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Insère les images sur la page courante. `atScreen` : point de dépôt en pixels écran (sinon centre de la page). */
export async function importImageFiles(files: File[], atScreen?: { x: number; y: number }) {
  const center = atScreen ? screenToPage(atScreen) : { x: PAGE_W / 2, y: PAGE_H / 2 };
  let i = 0;

  for (const file of files.filter(isAcceptedImage)) {
    try {
      const { src, w, h } = await rasterize(file);
      const fit = Math.min(1, (PAGE_W * 0.6) / w, (PAGE_H * 0.6) / h);
      const dw = w * fit;
      const dh = h * fit;
      const cx = center.x + i * 24;
      const cy = center.y + i * 24;
      const id = nanoid();

      const st = useBoardStore.getState();
      st.addObject({
        id,
        kind: "image",
        src,
        w: dw,
        h: dh,
        x: cx - dw / 2,
        y: cy - dh / 2,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
      });
      st.setTool("select");
      st.select(id);
      i++;
    } catch (err) {
      console.error("Import d'image impossible :", file.name, err);
    }
  }
}

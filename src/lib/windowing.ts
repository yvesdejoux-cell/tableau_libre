import { getCurrentWindow } from "@tauri-apps/api/window";
import { IS_TAURI } from "./files";

export async function toggleFullscreen() {
  if (IS_TAURI) {
    const w = getCurrentWindow();
    await w.setFullscreen(!(await w.isFullscreen()));
  } else if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await document.documentElement.requestFullscreen();
  }
}

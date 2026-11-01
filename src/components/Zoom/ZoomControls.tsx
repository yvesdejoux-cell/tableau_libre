import { Maximize2, Minus, Plus, ZoomIn } from "lucide-react";
import { useDraggable } from "../../hooks/useDraggable";
import { useViewStore } from "../../store/useViewStore";
import { DragGrip, EdgeTab, RetractButton } from "../FloatingBox/BoxControls";

export default function ZoomControls() {
  const s = useViewStore((st) => st.s);
  const fitted = useViewStore((st) => st.fitted);
  const { zoomAt, fit, actualSize } = useViewStore.getState();
  const drag = useDraggable("zoom", (w, h) => ({
    x: window.innerWidth - w - 16,
    y: window.innerHeight - h - 16,
  }));

  const zoomCenter = (factor: number) => {
    const { vw, vh } = useViewStore.getState();
    zoomAt(factor, vw / 2, vh / 2);
  };

  const btn = "flex h-12 w-12 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 active:bg-slate-200";

  return (
    <>
      <EdgeTab drag={drag} id="zoom" name="le zoom" icon={<ZoomIn size={20} />} />
      <div
        {...drag.boxProps}
        className="fixed z-50 flex select-none items-center gap-0.5 rounded-2xl border border-slate-200 bg-white/95 p-1 shadow-xl backdrop-blur"
      >
        <DragGrip handlers={drag.handlers} vertical className="h-12 w-8" />
        <button type="button" className={btn} title="Zoom arrière (Ctrl −)" aria-label="Zoom arrière" onClick={() => zoomCenter(1 / 1.25)}>
          <Minus size={20} />
        </button>
        <button
          type="button"
          className="h-12 min-w-[64px] rounded-xl px-2 text-sm font-medium text-slate-700 hover:bg-slate-100 active:bg-slate-200"
          title="Taille réelle (100 %)"
          onClick={actualSize}
        >
          {Math.round(s * 100)} %
        </button>
        <button type="button" className={btn} title="Zoom avant (Ctrl +)" aria-label="Zoom avant" onClick={() => zoomCenter(1.25)}>
          <Plus size={20} />
        </button>
        <button
          type="button"
          className={`${btn} ${fitted ? "bg-blue-50 text-blue-700" : ""}`}
          title="Ajuster à l'écran (Ctrl 0)"
          aria-label="Ajuster à l'écran"
          onClick={fit}
        >
          <Maximize2 size={20} />
        </button>
        <RetractButton drag={drag} name="le zoom" className="h-12 w-8" />
      </div>
    </>
  );
}

import { useRef } from "react";
import { X } from "lucide-react";
import { clamp } from "../../lib/rulerGeometry";
import { useWidgetStore, type ShadeWidget } from "../../store/useWidgetStore";

type Side = "t" | "b" | "l" | "r";

const POS: Record<Side, string> = {
  t: "left-0 right-0 top-0 h-10 cursor-ns-resize",
  b: "left-0 right-0 bottom-0 h-10 cursor-ns-resize",
  l: "bottom-0 left-0 top-0 w-10 cursor-ew-resize",
  r: "bottom-0 right-0 top-0 w-10 cursor-ew-resize",
};

function EdgeHandle(props: { side: Side; edgePx: number; onEdge: (px: number) => void }) {
  const { side, edgePx, onEdge } = props;
  const horizontal = side === "t" || side === "b";
  const grab = useRef(0);
  const coord = (e: React.PointerEvent) => (horizontal ? e.clientY : e.clientX);

  return (
    <div
      className={`absolute flex items-center justify-center bg-slate-600/70 ${POS[side]}`}
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        grab.current = coord(e) - edgePx;
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) onEdge(coord(e) - grab.current);
      }}
    >
      <span className={`rounded-full bg-slate-300 ${horizontal ? "h-1.5 w-20" : "h-20 w-1.5"}`} />
    </div>
  );
}

const MIN = 0.06; // taille minimale du rideau (fraction de l'écran)

export default function ShadeView({ w }: { w: ShadeWidget }) {
  const { updateShade, toggleShade, bringToFront } = useWidgetStore.getState();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  return (
    <div
      className="pointer-events-auto absolute bg-slate-800"
      style={{
        left: `${w.l * 100}%`,
        top: `${w.t * 100}%`,
        width: `${(w.r - w.l) * 100}%`,
        height: `${(w.b - w.t) * 100}%`,
        zIndex: w.z,
        touchAction: "none",
      }}
      onPointerDown={() => bringToFront(w.id)}
    >
      <div className="pointer-events-none absolute inset-0 flex select-none items-center justify-center px-14 text-center text-sm text-slate-500">
        Faites glisser un bord pour révéler le contenu
      </div>

      <button
        type="button"
        aria-label="Retirer le rideau"
        title="Retirer le rideau"
        onClick={toggleShade}
        className="absolute right-14 top-14 flex h-10 w-10 items-center justify-center rounded-full bg-slate-700 text-slate-300 hover:bg-slate-600"
      >
        <X size={18} />
      </button>

      <EdgeHandle side="t" edgePx={w.t * vh} onEdge={(px) => updateShade(w.id, { t: clamp(px / vh, 0, w.b - MIN) })} />
      <EdgeHandle side="b" edgePx={w.b * vh} onEdge={(px) => updateShade(w.id, { b: clamp(px / vh, w.t + MIN, 1) })} />
      <EdgeHandle side="l" edgePx={w.l * vw} onEdge={(px) => updateShade(w.id, { l: clamp(px / vw, 0, w.r - MIN) })} />
      <EdgeHandle side="r" edgePx={w.r * vw} onEdge={(px) => updateShade(w.id, { r: clamp(px / vw, w.l + MIN, 1) })} />
    </div>
  );
}

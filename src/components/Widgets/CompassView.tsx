import { useRef, useState } from "react";
import { MoveHorizontal, Pencil, PencilOff, RotateCw, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useWidgetGestures } from "../../hooks/useWidgetGestures";
import { clamp, toLocal, toWorld } from "../../lib/rulerGeometry";
import type { Pt } from "../../lib/shapes";
import { useBoardStore } from "../../store/useBoardStore";
import { screenToPage, useViewStore } from "../../store/useViewStore";
import { useWidgetStore, type CompassWidget } from "../../store/useWidgetStore";
import Handle from "./Handle";

const PAD = 40;
const GRAB = { pointerEvents: "stroke", touchAction: "none" } as const; // zone de prise sur les jambes
const STEP = (1.5 * Math.PI) / 180; // pas d'échantillonnage de l'arc : 1,5°

const getCompass = (id: string) =>
  useWidgetStore.getState().widgets.find((w): w is CompassWidget => w.id === id && w.type === "compass");

interface Trace {
  prev: number; // dernier angle du pointeur autour de la pointe (rad)
  total: number; // angle cumulé balayé depuis le début (rad)
  rot0: number; // rotation du compas au début (deg)
  pts: number[]; // points de l'arc, en coordonnées écran
  color: string;
  width: number;
  tool: "pen" | "highlighter";
}

interface Preview {
  pts: number[];
  color: string;
  width: number;
  opacity: number;
}

export default function CompassView({ w }: { w: CompassWidget }) {
  const pxPerCm = useWidgetStore((s) => s.pxPerCm);
  const penColor = useBoardStore((s) => s.color);
  const { updateCompass, toggleCompass, bringToFront } = useWidgetStore.getState();

  const trace = useRef<Trace | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const r = w.radius;
  const hh = Math.sqrt(160 * (r + 160)); // hauteur de l'articulation (jambes de longueur r/2 + 160)
  const minR = 2 * pxPerCm;
  const maxR = Math.min(window.innerWidth, window.innerHeight) * 0.9;

  const body = useWidgetGestures({
    id: w.id,
    read: () => {
      const c = getCompass(w.id);
      return c && { cx: c.cx, cy: c.cy, rotation: c.rotation, size: c.radius };
    },
    write: ({ size, ...rest }) => updateCompass(w.id, size === undefined ? rest : { ...rest, radius: size }),
    minSize: minR,
    maxSize: maxR,
  });

  // --- Tracé d'un arc : le rayon est constant, seul l'angle suit le pointeur
  const startTrace = (p: Pt) => {
    bringToFront(w.id);
    const st = useBoardStore.getState();
    const tool = st.tool === "highlighter" ? "highlighter" : "pen";
    const q = toWorld(w, { x: r, y: 0 }); // position de la mine
    const width = st.widths[tool];

    trace.current = {
      prev: Math.atan2(p.y - w.cy, p.x - w.cx),
      total: 0,
      rot0: w.rotation,
      pts: w.draw ? [q.x, q.y] : [],
      color: st.color,
      width,
      tool,
    };
    if (w.draw) {
      const s = useViewStore.getState().s;
      setPreview({
        pts: [q.x, q.y, q.x, q.y],
        color: st.color,
        width: width * s, // l'aperçu est en pixels écran ; le trait validé gardera `width` (pixels de page)
        opacity: tool === "highlighter" ? 0.4 : 1,
      });
    }
  };

  const moveTrace = (p: Pt) => {
    const t = trace.current;
    if (!t) return;

    const ang = Math.atan2(p.y - w.cy, p.x - w.cx);
    let d = ang - t.prev;
    if (d > Math.PI) d -= 2 * Math.PI;
    else if (d < -Math.PI) d += 2 * Math.PI;
    t.prev = ang;

    const from = t.total;
    // Avec le tracé actif, on s'arrête à un tour complet : cercle propre, pas de surimpression
    const total = w.draw ? clamp(from + d, -2 * Math.PI, 2 * Math.PI) : from + d;
    t.total = total;

    if (w.draw && Math.abs(total - from) > 1e-6) {
      const base = (t.rot0 * Math.PI) / 180;
      const steps = Math.max(1, Math.ceil(Math.abs(total - from) / STEP));
      for (let i = 1; i <= steps; i++) {
        const a = base + from + ((total - from) * i) / steps;
        t.pts.push(w.cx + r * Math.cos(a), w.cy + r * Math.sin(a));
      }
      setPreview((prev) => (prev ? { ...prev, pts: t.pts.slice() } : prev));
    }
    updateCompass(w.id, { rotation: t.rot0 + (total * 180) / Math.PI });
  };

  const endTrace = () => {
    const t = trace.current;
    trace.current = null;
    if (!t) return;

    if (t.pts.length >= 4 && Math.abs(t.total) > 0.02) {
      const points: number[] = [];
      for (let i = 0; i < t.pts.length; i += 2) {
        const q = screenToPage({ x: t.pts[i], y: t.pts[i + 1] });
        points.push(q.x, q.y);
      }
      useBoardStore.getState().addObject({
        id: nanoid(),
        kind: "stroke",
        tool: t.tool,
        points,
        color: t.color,
        width: t.width,
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
      });
    }
    // Laisse Konva dessiner le trait définitif avant de retirer l'aperçu
    requestAnimationFrame(() => requestAnimationFrame(() => setPreview(null)));
  };

  const cm = (r / pxPerCm).toFixed(1).replace(".", ",");
  const lead = (k: number) => ({ x: r + k * (r / 2 - r), y: k * -hh }); // point à la fraction k de la mine vers l'articulation
  const needleEnd = { x: 0.14 * (r / 2), y: 0.14 * -hh };
  const leadEnd = lead(0.14);
  const pencilHandle = lead(0.28);

  return (
    <>
      {/* Aperçu de l'arc en cours (coordonnées écran) */}
      {preview && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" style={{ zIndex: w.z }}>
          <polyline
            points={preview.pts.join(" ")}
            fill="none"
            stroke={preview.color}
            strokeWidth={preview.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={preview.opacity}
          />
        </svg>
      )}

      {/* Repère local : origine = pointe, axe x = direction de la mine */}
      <div
        className="pointer-events-none absolute"
        style={{ left: w.cx, top: w.cy, width: 0, height: 0, transform: `rotate(${w.rotation}deg)`, zIndex: w.z }}
      >
        <svg
          className="absolute select-none"
          style={{ left: -PAD, top: -hh - PAD, pointerEvents: "none" }}
          width={r + 2 * PAD}
          height={hh + PAD + 50}
          viewBox={`${-PAD} ${-hh - PAD} ${r + 2 * PAD} ${hh + PAD + 50}`}
        >
          {/* Zones de prise (déplacement / rotation à deux doigts) */}
          <line x1={0} y1={0} x2={r / 2} y2={-hh} stroke="transparent" strokeWidth={36} strokeLinecap="round" style={GRAB} {...body} />
          <line x1={r} y1={0} x2={r / 2} y2={-hh} stroke="transparent" strokeWidth={36} strokeLinecap="round" style={GRAB} {...body} />

          {/* Rayon et sa valeur (toujours lisible : contre-pivoté) */}
          <line x1={0} y1={0} x2={r} y2={0} stroke="#2563eb" strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="6 6" />
          <text
            x={r / 2}
            y={22}
            textAnchor="middle"
            fontSize={14}
            fontWeight={600}
            fill="#1d4ed8"
            transform={`rotate(${-w.rotation} ${r / 2} 22)`}
          >
            {cm} cm
          </text>

          {/* Jambes */}
          <line x1={0} y1={0} x2={r / 2} y2={-hh} stroke="#64748b" strokeWidth={7} strokeLinecap="round" />
          <line x1={r} y1={0} x2={r / 2} y2={-hh} stroke="#64748b" strokeWidth={7} strokeLinecap="round" />
          <line x1={0} y1={0} x2={needleEnd.x} y2={needleEnd.y} stroke="#0f172a" strokeWidth={3} strokeLinecap="round" />
          <line x1={r} y1={0} x2={leadEnd.x} y2={leadEnd.y} stroke={penColor} strokeWidth={5} strokeLinecap="round" />

          <circle cx={r / 2} cy={-hh} r={12} fill="#475569" stroke="#1e293b" strokeWidth={2} />
          <circle cx={0} cy={0} r={6} fill="white" fillOpacity={0.8} stroke="#0f172a" strokeWidth={2} />
        </svg>

        {/* Ouverture : l'articulation règle le rayon */}
        <Handle
          x={r / 2}
          y={-hh}
          title="Ouverture du compas"
          onStart={() => bringToFront(w.id)}
          onPoint={(p) => updateCompass(w.id, { radius: clamp(2 * toLocal(w, p).x, minR, maxR) })}
        >
          <MoveHorizontal size={20} />
        </Handle>

        {/* Crayon : tracé d'un arc (ou simple rotation si le tracé est coupé) */}
        <Handle
          x={pencilHandle.x}
          y={pencilHandle.y}
          tone={w.draw ? "primary" : "light"}
          title={w.draw ? "Tracer un arc" : "Faire pivoter le compas"}
          onStart={startTrace}
          onPoint={moveTrace}
          onEnd={endTrace}
        >
          {w.draw ? <Pencil size={20} /> : <RotateCw size={20} />}
        </Handle>

        {/* Commandes, contre-pivotées pour rester droites */}
        <div
          className="pointer-events-auto absolute flex gap-2"
          style={{ left: r / 2, top: 58, transform: `translate(-50%, -50%) rotate(${-w.rotation}deg)` }}
        >
          <button
            type="button"
            title={w.draw ? "Couper le tracé" : "Activer le tracé"}
            aria-label={w.draw ? "Couper le tracé" : "Activer le tracé"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => updateCompass(w.id, { draw: !w.draw })}
            className={`flex h-9 w-9 items-center justify-center rounded-full border shadow ${
              w.draw ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-600"
            }`}
          >
            {w.draw ? <Pencil size={16} /> : <PencilOff size={16} />}
          </button>
          <button
            type="button"
            title="Retirer le compas"
            aria-label="Retirer le compas"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={toggleCompass}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 shadow hover:text-red-600"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </>
  );
}

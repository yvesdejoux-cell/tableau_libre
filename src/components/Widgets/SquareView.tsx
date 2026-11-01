import { useMemo } from "react";
import { MoveHorizontal, RotateCw, X } from "lucide-react";
import { useWidgetGestures } from "../../hooks/useWidgetGestures";
import { SQUARE_K } from "../../lib/guides";
import { clamp, rotationFromPoint, snapAngle, toLocal } from "../../lib/rulerGeometry";
import { useWidgetStore, type SquareWidget } from "../../store/useWidgetStore";
import Handle from "./Handle";

const GAP = 30;
const HOLE = 0.55; // taille de l'évidement par rapport au triangle extérieur
const AUTO = { pointerEvents: "auto", touchAction: "none" } as const;

const getSquare = (id: string) =>
  useWidgetStore.getState().widgets.find((w): w is SquareWidget => w.id === id && w.type === "square");

type P = { x: number; y: number };
const poly = (ps: P[]) => "M" + ps.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("L") + "Z";

function buildTicks(S: number, h: number, pxPerCm: number) {
  const mm = pxPerCm / 10;
  const len = (i: number) => (i % 10 === 0 ? 24 : i % 5 === 0 ? 16 : 10);
  let d = "";
  for (let i = 0; i * mm <= S; i++) d += `M${(i * mm).toFixed(1)} ${h}V${h - len(i)}`; // base
  for (let i = 1; i * mm <= h; i++) d += `M0 ${(h - i * mm).toFixed(1)}H${len(i)}`; // côté vertical
  return d;
}

export default function SquareView({ w }: { w: SquareWidget }) {
  const pxPerCm = useWidgetStore((s) => s.pxPerCm);
  const { updateSquare, toggleSquare, bringToFront } = useWidgetStore.getState();
  const minSize = 5 * pxPerCm;
  const maxSize = Math.max(window.innerWidth, window.innerHeight);

  const S = w.size;
  const h = S * SQUARE_K[w.variant];

  const body = useWidgetGestures({
    id: w.id,
    read: () => {
      const q = getSquare(w.id);
      return q && { cx: q.cx, cy: q.cy, rotation: q.rotation, size: q.size };
    },
    write: (p) => updateSquare(w.id, p),
    minSize,
    maxSize,
  });

  // Triangle extérieur (repère haut-gauche du widget) : A = angle droit, B, C
  const { outline, ticks, labels } = useMemo(() => {
    const A = { x: 0, y: h };
    const B = { x: S, y: h };
    const C = { x: 0, y: 0 };
    const a = Math.hypot(S, h);
    const per = a + h + S;
    const I = { x: (h * S) / per, y: (a * h + h * h) / per }; // centre du cercle inscrit
    const inner = [A, B, C].map((v) => ({ x: I.x + HOLE * (v.x - I.x), y: I.y + HOLE * (v.y - I.y) }));

    const labs: { x: number; t: number }[] = [];
    for (let i = 1; i * pxPerCm < S; i++) {
      const x = i * pxPerCm;
      if (h * (1 - x / S) > 46) labs.push({ x, t: i }); // seulement là où le triangle est assez haut
    }
    return { outline: `${poly([A, B, C])} ${poly(inner)}`, ticks: buildTicks(S, h, pxPerCm), labels: labs };
  }, [S, h, pxPerCm]);

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: w.cx,
        top: w.cy - h,
        width: S,
        height: h,
        transformOrigin: `0px ${h}px`,
        transform: `rotate(${w.rotation}deg)`,
        zIndex: w.z,
      }}
    >
      <svg width={S} height={h} className="absolute inset-0 select-none overflow-visible text-slate-800" style={{ pointerEvents: "none" }}>
        <path
          d={outline}
          fillRule="evenodd"
          fill="rgba(254,243,199,0.9)"
          stroke="#d97706"
          strokeWidth={1.5}
          style={AUTO}
          {...body}
        />
        <path d={ticks} stroke="currentColor" strokeWidth={1} fill="none" />
        {labels.map((l) => (
          <text key={l.t} x={l.x} y={h - 30} textAnchor="middle" fontSize={12} fill="currentColor">
            {l.t}
          </text>
        ))}
      </svg>

      {/* Poignée du haut : rotation autour de l'angle droit */}
      <Handle
        x={0}
        y={-GAP}
        tone="primary"
        title="Pivoter"
        onStart={() => bringToFront(w.id)}
        onPoint={(p) => updateSquare(w.id, { rotation: snapAngle(rotationFromPoint(w, p, { x: 0, y: -h - GAP })) })}
      >
        <RotateCw size={20} />
      </Handle>

      {/* Poignée de la base : taille (l'angle droit reste fixe) */}
      <Handle
        x={S + GAP}
        y={h}
        title="Ajuster la taille"
        onStart={() => bringToFront(w.id)}
        onPoint={(p) => updateSquare(w.id, { size: clamp(toLocal(w, p).x - GAP, minSize, maxSize) })}
      >
        <MoveHorizontal size={20} />
      </Handle>

      <div className="pointer-events-auto absolute flex gap-2" style={{ left: S / 2 - 62, top: h + 10 }}>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => updateSquare(w.id, { variant: w.variant === 45 ? 60 : 45 })}
          className="h-9 rounded-full border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 shadow hover:bg-slate-50"
          title="Changer d'équerre"
        >
          {w.variant === 45 ? "45°" : "30° / 60°"}
        </button>
        <button
          type="button"
          aria-label="Retirer l'équerre"
          title="Retirer l'équerre"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={toggleSquare}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 shadow hover:text-red-600"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

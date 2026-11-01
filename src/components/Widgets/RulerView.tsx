import { useMemo, useState } from "react";
import { MoveHorizontal, RotateCw, X } from "lucide-react";
import { useWidgetGestures } from "../../hooks/useWidgetGestures";
import { RULER_H, clamp, rotationFromPoint, snapAngle } from "../../lib/rulerGeometry";
import { useWidgetStore, type RulerWidget } from "../../store/useWidgetStore";
import Handle from "./Handle";

const GAP = 30; // distance centre de poignée ↔ extrémité

const getRuler = (id: string) =>
  useWidgetStore.getState().widgets.find((w): w is RulerWidget => w.id === id && w.type === "ruler");

function buildTicks(length: number, pxPerCm: number) {
  const mm = pxPerCm / 10;
  const n = Math.floor(length / mm);
  let cm = "";
  let half = "";
  let tiny = "";
  for (let i = 0; i <= n; i++) {
    const x = (i * mm).toFixed(2);
    if (i % 10 === 0) cm += `M${x} 0V26`;
    else if (i % 5 === 0) half += `M${x} 0V18`;
    else tiny += `M${x} 0V11`;
  }
  return { cm, half, tiny };
}

export default function RulerView({ w }: { w: RulerWidget }) {
  const pxPerCm = useWidgetStore((s) => s.pxPerCm);
  const { updateRuler, toggleRuler, bringToFront } = useWidgetStore.getState();
  const [showAngle, setShowAngle] = useState(false);
  const minLen = 3 * pxPerCm;
  const maxLen = Math.max(window.innerWidth, window.innerHeight) * 1.5;

  const body = useWidgetGestures({
    id: w.id,
    read: () => {
      const r = getRuler(w.id);
      return r && { cx: r.cx, cy: r.cy, rotation: r.rotation, size: r.length };
    },
    write: ({ size, ...rest }) => updateRuler(w.id, size === undefined ? rest : { ...rest, length: size }),
    minSize: minLen,
    maxSize: maxLen,
  });

  const { cm, half, tiny } = useMemo(() => buildTicks(w.length, pxPerCm), [w.length, pxPerCm]);

  const labels = [];
  for (let i = 0; i * pxPerCm <= w.length - 10; i++) {
    labels.push(
      <text
        key={i}
        x={i === 0 ? 4 : i * pxPerCm}
        y={46}
        textAnchor={i === 0 ? "start" : "middle"}
        fontSize={13}
        fill="currentColor"
        className="select-none"
      >
        {i}
      </text>
    );
  }

  const angle = ((Math.round(w.rotation) % 180) + 180) % 180;

  return (
    <div
      {...body}
      className="pointer-events-auto absolute"
      style={{
        left: w.cx,
        top: w.cy,
        width: w.length,
        height: RULER_H,
        transform: `translate(-50%, -50%) rotate(${w.rotation}deg)`,
        touchAction: "none",
        zIndex: w.z,
      }}
    >
      <div className="relative h-full w-full rounded-md border border-amber-500/70 bg-amber-100/90 shadow-lg">
        <svg width={w.length} height={RULER_H} className="pointer-events-none absolute inset-0 text-slate-800">
          <path d={cm} stroke="currentColor" strokeWidth={1.5} fill="none" />
          <path d={half} stroke="currentColor" strokeWidth={1.2} fill="none" />
          <path d={tiny} stroke="currentColor" strokeWidth={1} fill="none" />
          {labels}
        </svg>

        <button
          type="button"
          aria-label="Retirer la règle"
          title="Retirer la règle"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={toggleRuler}
          className="absolute bottom-1.5 left-1/2 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full bg-white/80 text-slate-500 hover:bg-white hover:text-red-600"
        >
          <X size={16} />
        </button>

        {showAngle && (
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 rounded-full bg-slate-900/85 px-3 py-1 text-sm font-semibold text-white"
            style={{ transform: `translate(-50%, -50%) rotate(${-w.rotation}deg)` }}
          >
            {angle}°
          </div>
        )}

        <Handle
          x={-GAP}
          y={RULER_H / 2}
          title="Ajuster la longueur"
          onStart={() => bringToFront(w.id)}
          onPoint={(p) =>
            updateRuler(w.id, { length: clamp(2 * (Math.hypot(p.x - w.cx, p.y - w.cy) - GAP), minLen, maxLen) })
          }
        >
          <MoveHorizontal size={20} />
        </Handle>

        <Handle
          x={w.length + GAP}
          y={RULER_H / 2}
          tone="primary"
          title="Pivoter"
          onStart={() => {
            bringToFront(w.id);
            setShowAngle(true);
          }}
          onEnd={() => setShowAngle(false)}
          onPoint={(p) =>
            updateRuler(w.id, { rotation: snapAngle(rotationFromPoint(w, p, { x: w.length / 2 + GAP, y: 0 })) })
          }
        >
          <RotateCw size={20} />
        </Handle>
      </div>
    </div>
  );
}

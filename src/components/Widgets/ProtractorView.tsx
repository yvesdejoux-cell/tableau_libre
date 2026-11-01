import { useMemo } from "react";
import { MoveHorizontal, RotateCw, X } from "lucide-react";
import { useWidgetGestures } from "../../hooks/useWidgetGestures";
import { PROTRACTOR_STRIP as STRIP } from "../../lib/guides";
import { clamp, rotationFromPoint, snapAngle, toLocal } from "../../lib/rulerGeometry";
import { useWidgetStore, type ProtractorWidget } from "../../store/useWidgetStore";
import Handle from "./Handle";

const BAND = 48; // épaisseur de l'anneau gradué
const GAP = 30;
const AUTO = { pointerEvents: "auto", touchAction: "none" } as const;
const FILL = "rgba(254,243,199,0.9)";

const getProt = (id: string) =>
  useWidgetStore.getState().widgets.find((w): w is ProtractorWidget => w.id === id && w.type === "protractor");

function buildTicks(R: number, full: boolean) {
  const max = full ? 359 : 180;
  let d = "";
  for (let a = 0; a <= max; a++) {
    const len = a % 10 === 0 ? 18 : a % 5 === 0 ? 13 : 8;
    const c = Math.cos((a * Math.PI) / 180);
    const s = Math.sin((a * Math.PI) / 180);
    d += `M${(R + R * c).toFixed(1)} ${(R - R * s).toFixed(1)}L${(R + (R - len) * c).toFixed(1)} ${(R - (R - len) * s).toFixed(1)}`;
  }
  return d;
}

export default function ProtractorView({ w }: { w: ProtractorWidget }) {
  const { updateProtractor, toggleProtractor, bringToFront } = useWidgetStore.getState();
  const R = w.radius;
  const full = w.full;
  const Ri = R - BAND;
  const W = 2 * R;
  const H = full ? 2 * R : R + STRIP;
  const midY = R + (full ? 0 : STRIP / 2); // hauteur des poignées latérales
  const minR = 60;
  const maxR = Math.max(window.innerWidth, window.innerHeight) / 2;

  const body = useWidgetGestures({
    id: w.id,
    read: () => {
      const p = getProt(w.id);
      return p && { cx: p.cx, cy: p.cy, rotation: p.rotation, size: p.radius };
    },
    write: ({ size, ...rest }) => updateProtractor(w.id, size === undefined ? rest : { ...rest, radius: size }),
    minSize: minR,
    maxSize: maxR,
  });

  const ticks = useMemo(() => buildTicks(R, full), [R, full]);

  const labels = useMemo(() => {
    const out = [];
    const max = full ? 350 : 180;
    for (let a = 0; a <= max; a += 10) {
      const c = Math.cos((a * Math.PI) / 180);
      const s = Math.sin((a * Math.PI) / 180);
      out.push(
        <text key={`o${a}`} x={R + (R - 31) * c} y={R - (R - 31) * s + 4} textAnchor="middle" fontSize={10} fill="#1e293b">
          {a}
        </text>
      );
      if (!full) {
        out.push(
          <text key={`i${a}`} x={R + (R - 43) * c} y={R - (R - 43) * s + 4} textAnchor="middle" fontSize={10} fill="#2563eb">
            {180 - a}
          </text>
        );
      }
    }
    return out;
  }, [R, full]);

  const bandPath = full
    ? `M0 ${R}A${R} ${R} 0 0 1 ${W} ${R}A${R} ${R} 0 0 1 0 ${R}Z M${R - Ri} ${R}A${Ri} ${Ri} 0 0 1 ${R + Ri} ${R}A${Ri} ${Ri} 0 0 1 ${R - Ri} ${R}Z`
    : `M0 ${R}A${R} ${R} 0 0 1 ${W} ${R}L${R + Ri} ${R}A${Ri} ${Ri} 0 0 0 ${R - Ri} ${R}Z`;

  // Bras de mesure
  const t = (w.arm * Math.PI) / 180;
  const armTip = { x: R + R * Math.cos(t), y: R - R * Math.sin(t) };
  const rho = R - BAND / 2;
  const armHandle = { x: R + rho * Math.cos(t), y: R - rho * Math.sin(t) };

  const toggleMode = () => {
    const next = !w.full;
    updateProtractor(w.id, { full: next, arm: !next && w.arm > 180 ? 180 : w.arm });
  };

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: w.cx - R,
        top: w.cy - R,
        width: W,
        height: H,
        transformOrigin: `${R}px ${R}px`, // on tourne autour du sommet
        transform: `rotate(${w.rotation}deg)`,
        zIndex: w.z,
      }}
    >
      <svg width={W} height={H} className="absolute inset-0 select-none overflow-visible" style={{ pointerEvents: "none" }}>
        <path d={bandPath} fillRule="evenodd" fill={FILL} stroke="#d97706" strokeWidth={1.5} style={AUTO} {...body} />
        {!full && <rect x={0} y={R} width={W} height={STRIP} fill={FILL} stroke="#d97706" strokeWidth={1.5} style={AUTO} {...body} />}

        <path d={ticks} stroke="#1e293b" strokeWidth={1} fill="none" />
        {labels}

        <line x1={R} y1={R} x2={armTip.x} y2={armTip.y} stroke="#2563eb" strokeWidth={2} />
        <circle cx={R} cy={R} r={22} fill={FILL} stroke="#d97706" strokeWidth={1.5} style={AUTO} {...body} />
        <circle cx={R} cy={R} r={3} fill="#2563eb" />

        <text
          x={R}
          y={full ? R + 54 : R + STRIP - 11}
          textAnchor="middle"
          fontSize={18}
          fontWeight={700}
          fill="#1d4ed8"
        >
          {w.arm}°
        </text>
      </svg>

      {/* Poignée du bras de mesure */}
      <Handle
        x={armHandle.x}
        y={armHandle.y}
        size={36}
        tone="primary"
        title="Régler l'angle"
        onStart={() => bringToFront(w.id)}
        onPoint={(p) => {
          const l = toLocal(w, p); // relatif au sommet
          let a = (Math.atan2(-l.y, l.x) * 180) / Math.PI;
          if (a < 0) a += 360;
          if (!full && a > 180) a = a > 270 ? 0 : 180;
          updateProtractor(w.id, { arm: Math.round(a) % 360 || (a >= 359.5 ? 0 : Math.round(a)) });
        }}
      >
        <span className="h-2.5 w-2.5 rounded-full bg-white" />
      </Handle>

      {/* Rayon */}
      <Handle
        x={-GAP}
        y={midY}
        title="Ajuster la taille"
        onStart={() => bringToFront(w.id)}
        onPoint={(p) => updateProtractor(w.id, { radius: clamp(Math.abs(toLocal(w, p).x) - GAP, minR, maxR) })}
      >
        <MoveHorizontal size={20} />
      </Handle>

      {/* Rotation autour du sommet */}
      <Handle
        x={W + GAP}
        y={midY}
        tone="primary"
        title="Pivoter"
        onStart={() => bringToFront(w.id)}
        onPoint={(p) =>
          updateProtractor(w.id, {
            rotation: snapAngle(rotationFromPoint(w, p, { x: R + GAP, y: full ? 0 : STRIP / 2 })),
          })
        }
      >
        <RotateCw size={20} />
      </Handle>

      <div className="pointer-events-auto absolute flex gap-2" style={{ left: R - 62, top: H + 10 }}>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={toggleMode}
          className="h-9 rounded-full border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 shadow hover:bg-slate-50"
          title="Basculer 180° / 360°"
        >
          {full ? "→ 180°" : "→ 360°"}
        </button>
        <button
          type="button"
          aria-label="Retirer le rapporteur"
          title="Retirer le rapporteur"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={toggleProtractor}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 shadow hover:text-red-600"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

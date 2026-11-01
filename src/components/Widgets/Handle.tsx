import type { ReactNode } from "react";
import type { Pt } from "../../lib/shapes";

interface Props {
  x: number;
  y: number;
  title: string;
  tone?: "primary" | "light";
  size?: number;
  onStart?: (p: Pt) => void;
  onEnd?: () => void;
  onPoint: (p: Pt) => void;
  children: ReactNode;
}

export default function Handle({ x, y, title, tone = "light", size = 44, onStart, onEnd, onPoint, children }: Props) {
  return (
    <div
      title={title}
      aria-label={title}
      className={`pointer-events-auto absolute flex items-center justify-center rounded-full shadow ${
        tone === "primary" ? "bg-blue-600 text-white" : "border border-slate-300 bg-white text-slate-700"
      }`}
      style={{ left: x - size / 2, top: y - size / 2, width: size, height: size, touchAction: "none" }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        onStart?.({ x: e.clientX, y: e.clientY });
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) onPoint({ x: e.clientX, y: e.clientY });
      }}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
    >
      {children}
    </div>
  );
}

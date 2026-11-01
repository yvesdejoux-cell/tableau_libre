import { memo, useEffect, useState } from "react";
import {
  DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, GripVertical, Layers, Plus, Trash2 } from "lucide-react";
import { useDraggable } from "../../hooks/useDraggable";
import { BACKGROUND_LABELS, backgroundStyle } from "../../lib/backgrounds";
import { DragGrip, EdgeTab, RetractButton } from "../FloatingBox/BoxControls";
import { playIcon } from "../../lib/exporter";
import { arrowHeadPoints, arrowSize, trianglePoints } from "../../lib/shapes";
import { TEXT_LINE_HEIGHT, textCss } from "../../lib/text";
import { PAGE_H, PAGE_W } from "../../lib/view";
import { selectCurrentPage, useBoardStore } from "../../store/useBoardStore";
import type { BackgroundType, BoardObject, Page, StrokeObject } from "../../types";

const THUMB_W = 150;

const tf = (o: BoardObject) =>
  `translate(${o.x} ${o.y}) rotate(${o.rotation}) scale(${o.scaleX} ${o.scaleY})`;

const strokeAttrs = (o: StrokeObject) => ({
  points: o.points.join(" "),
  transform: tf(o),
  fill: "none",
  strokeWidth: o.width / (Math.sqrt(Math.abs(o.scaleX * o.scaleY)) || 1),
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

function ThumbObject({ o }: { o: BoardObject }) {
  if (o.kind === "stroke") {
    if (o.closed) return <polygon points={o.points.join(" ")} transform={tf(o)} fill={o.color} fillOpacity={o.tool === "highlighter" ? 0.4 : 1} />;
    return <polyline {...strokeAttrs(o)} stroke={o.color} strokeOpacity={o.tool === "highlighter" ? 0.4 : 1} />;
  }
  if (o.kind === "image") {
    return <image href={o.src} width={o.w} height={o.h} transform={tf(o)} preserveAspectRatio="none" />;
  }
  if (o.kind === "video") {
    return (
      <g transform={tf(o)}>
        <rect width={o.w} height={o.h} fill="#1e293b" />
        {o.poster && <image href={o.poster} width={o.w} height={o.h} preserveAspectRatio="none" />}
        <polygon points={playIcon(o.w, o.h).join(" ")} fill="white" fillOpacity={0.9} />
      </g>
    );
  }
  if (o.kind === "text") {
    return (
      <foreignObject width={o.w} height={PAGE_H} transform={tf(o)}>
        <div
          style={{
            ...textCss(o),
            color: o.color,
            fontSize: o.fontSize,
            lineHeight: TEXT_LINE_HEIGHT,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {o.text}
        </div>
      </foreignObject>
    );
  }
  const common = {
    transform: tf(o),
    stroke: o.color,
    strokeWidth: o.width,
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (o.shape) {
    case "line":
      return <line {...common} x1={0} y1={0} x2={o.w} y2={o.h} />;
    case "arrow":
      return (
        <g {...common}>
          <line x1={0} y1={0} x2={o.w} y2={o.h} />
          <polygon points={arrowHeadPoints(o.w, o.h, arrowSize(o.width))} fill={o.color} strokeWidth={1} />
        </g>
      );
    case "rect":
      return <rect {...common} fill={o.fill ?? "none"} width={Math.abs(o.w)} height={Math.abs(o.h)} />;
    case "ellipse":
      return <ellipse {...common} fill={o.fill ?? "none"} rx={Math.abs(o.w) / 2} ry={Math.abs(o.h) / 2} />;
    case "triangle":
      return <polygon {...common} fill={o.fill ?? "none"} points={trianglePoints(o.w, o.h).join(" ")} />;
  }
}

const PageThumb = memo(function PageThumb({ page }: { page: Page }) {
  const bw = PAGE_W;
  const bh = PAGE_H;
  const scale = THUMB_W / bw;
  const thumbH = Math.round(bh * scale);
  const maskId = `mask-${page.id}`;

  const isEraser = (o: BoardObject): o is StrokeObject => o.kind === "stroke" && o.tool === "eraser";
  const erasers = page.objects.filter(isEraser);
  // Comme au tableau : les vidéos sous le dessin, et hors d'atteinte de la gomme
  const videos = page.objects.filter((o) => o.kind === "video");
  const visible = page.objects.filter((o) => !isEraser(o) && o.kind !== "video");

  return (
    <div
      className="relative overflow-hidden rounded-md border border-slate-300"
      style={{ width: THUMB_W, height: thumbH, ...backgroundStyle(page.background, scale) }}
    >
      <svg width={THUMB_W} height={thumbH} viewBox={`0 0 ${bw} ${bh}`} className="absolute inset-0">
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={bw} height={bh}>
            <rect width={bw} height={bh} fill="white" />
            {erasers.map((o) => (
              <polyline key={o.id} {...strokeAttrs(o)} stroke="black" />
            ))}
          </mask>
        </defs>
        {videos.map((o) => (
          <ThumbObject key={o.id} o={o} />
        ))}
        <g mask={`url(#${maskId})`}>
          {visible.map((o) => (
            <ThumbObject key={o.id} o={o} />
          ))}
        </g>
      </svg>
    </div>
  );
});

function PageItem(props: { page: Page; index: number; active: boolean; canDelete: boolean }) {
  const { page, index, active, canDelete } = props;
  const selectPage = useBoardStore((s) => s.selectPage);
  const duplicatePage = useBoardStore((s) => s.duplicatePage);
  const removePage = useBoardStore((s) => s.removePage);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
        opacity: isDragging ? 0.85 : 1,
      }}
      className={`flex items-center gap-1 rounded-xl border p-1.5 ${
        active ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white"
      }`}
    >
      {/* Poignée : seule zone qui déclenche le drag (le reste reste scrollable au doigt) */}
      <button
        type="button"
        aria-label="Réordonner"
        className="flex h-16 w-7 shrink-0 cursor-grab items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
        style={{ touchAction: "none" }}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={18} />
      </button>

      <button type="button" onClick={() => selectPage(page.id)} className="flex flex-col items-start gap-1">
        <PageThumb page={page} />
        <span className="px-0.5 text-xs font-semibold text-slate-600">Page {index + 1}</span>
      </button>

      <div className="ml-auto flex flex-col gap-1">
        <button
          type="button"
          aria-label="Dupliquer la page"
          title="Dupliquer"
          onClick={() => duplicatePage(page.id)}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
        >
          <Copy size={16} />
        </button>
        <button
          type="button"
          aria-label="Supprimer la page"
          title="Supprimer"
          disabled={!canDelete}
          onClick={() => removePage(page.id)}
          className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

export default function PageSorter() {
  const [open, setOpen] = useState(false);
  const pages = useBoardStore((s) => s.pages);
  const currentPageId = useBoardStore((s) => s.currentPageId);
  const background = useBoardStore((s) => selectCurrentPage(s).background);
  const addPage = useBoardStore((s) => s.addPage);
  const reorderPages = useBoardStore((s) => s.reorderPages);
  const setBackground = useBoardStore((s) => s.setBackground);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const currentIndex = pages.findIndex((p) => p.id === currentPageId);
  const bar = useDraggable("bouton-pages", () => ({ x: 16, y: 16 }));
  // à droite de la barre d'outils à sa place par défaut ; le bouton Pages l'ouvre et le ferme
  const panel = useDraggable("pages", () => ({ x: 104, y: 80 }), { shrinks: true });

  // --- Fermeture : Échap, ou clic commencé hors du panneau (un glisser de vignette ne ferme pas)
  useEffect(() => {
    if (!open) return;
    let startedOutside = false;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      startedOutside = !panel.box?.contains(t) && !bar.box?.contains(t);
    };
    const onClick = () => {
      if (startedOutside) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, panel.box, bar.box]);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    reorderPages(
      pages.findIndex((p) => p.id === active.id),
      pages.findIndex((p) => p.id === over.id)
    );
  };

  return (
    <>
      {/* Sous la barre d'outils : le clic de fermeture ne dessine pas sur la feuille */}
      {open && <div className="fixed inset-0 z-[45]" />}

      <EdgeTab drag={bar} id="bouton-pages" name="le bouton Pages" icon={<Layers size={20} />} />
      <div
        {...bar.boxProps}
        className="fixed z-50 flex h-12 select-none items-center rounded-xl border border-slate-200 bg-white/95 shadow-lg backdrop-blur"
      >
        <DragGrip handlers={bar.handlers} vertical className="h-full w-7" />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-full items-center gap-2 whitespace-nowrap rounded-lg px-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <Layers size={18} />
          Pages {currentIndex + 1}/{pages.length}
        </button>
        <RetractButton drag={bar} name="le bouton Pages" className="h-full w-7" onRetract={() => setOpen(false)} />
      </div>

      {open && (
        <div
          {...panel.boxProps}
          // au-dessus de la barre d'outils si elle a été déplacée ici
          className="fixed z-[55] flex w-[260px] flex-col gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur"
          style={{ ...panel.boxProps.style, maxHeight: `calc(100vh - ${panel.pos.y}px - 16px)` }}
        >
          <DragGrip handlers={panel.handlers} className="h-8 w-full" />

          <button
            type="button"
            onClick={addPage}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-medium text-white shadow hover:bg-blue-700"
          >
            <Plus size={16} /> Nouvelle page
          </button>

          <div>
            <div className="mb-1.5 text-xs font-medium text-slate-500">Fond de la page</div>
            <div className="grid grid-cols-3 gap-1.5">
              {(Object.keys(BACKGROUND_LABELS) as BackgroundType[]).map((bg) => (
                <button
                  key={bg}
                  type="button"
                  onClick={() => setBackground(bg)}
                  className={`h-10 rounded-lg border text-xs font-medium ${
                    background === bg
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {BACKGROUND_LABELS[bg]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 overflow-y-auto pr-0.5">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={pages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                {pages.map((p, i) => (
                  <PageItem key={p.id} page={p} index={i} active={p.id === currentPageId} canDelete={pages.length > 1} />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </div>
      )}
    </>
  );
}

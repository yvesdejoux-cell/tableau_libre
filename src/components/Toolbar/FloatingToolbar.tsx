import { useRef, useState, type ReactNode } from "react";
import {
  Circle, Clapperboard, DraftingCompass, Eraser, EyeOff, Gauge, Hand, Highlighter,
  ImagePlus, Link2, MousePointer2, MoveUpRight, Pen, Redo2, Ruler, Shapes, Slash, Square, Trash2, Type, Undo2,
} from "lucide-react";
import { DragGrip, EdgeTab, RetractButton } from "../FloatingBox/BoxControls";
import VideoLinkDialog from "../Video/VideoLinkDialog";
import { useDraggable } from "../../hooks/useDraggable";
import { presets } from "../../lib/defaults";
import { importImageFiles } from "../../lib/importImage";
import { IS_TAURI } from "../../lib/files";
import { MEDIA_ACCEPT, importMediaFiles, pickAndImportMedia } from "../../lib/importVideo";
import { TEXT_SIZES } from "../../lib/text";
import { selectActiveText, selectColorTarget, selectCurrentPage, useBoardStore } from "../../store/useBoardStore";
import { useViewStore } from "../../store/useViewStore";
import { useWidgetStore } from "../../store/useWidgetStore";
import { SHAPE_TOOLS, isShapeTool, widthKeyOf, type ShapeTool } from "../../types";

const COLORS = ["#111827", "#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#ffffff"];

const SHAPE_META: Record<ShapeTool, { label: string; icon: ReactNode }> = {
  line: { label: "Ligne", icon: <Slash size={22} /> },
  arrow: { label: "Flèche", icon: <MoveUpRight size={22} /> },
  rect: { label: "Rectangle", icon: <Square size={22} /> },
  ellipse: { label: "Ellipse", icon: <Circle size={22} /> },
};

/** Équerre : triangle rectangle évidé (lucide n'en propose pas), dans le style de ses icônes. */
function SetSquareIcon() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 3v18h17Z" />
      <path d="M8.5 11.5v5h5Z" />
    </svg>
  );
}

function ToolButton(props: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className={`flex h-12 w-12 items-center justify-center rounded-xl transition disabled:opacity-30 ${
        props.active ? "bg-blue-600 text-white shadow" : "text-slate-700 hover:bg-slate-100 active:bg-slate-200"
      }`}
    >
      {props.children}
    </button>
  );
}

export default function FloatingToolbar() {
  const drag = useDraggable("outils", () => ({ x: 24, y: 80 }), { shrinks: true });
  const [lastShape, setLastShape] = useState<ShapeTool>("rect");
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);

  const s = useBoardStore();
  const hasObjects = useBoardStore((st) => selectCurrentPage(st).objects.length > 0);
  const widthKey = widthKeyOf(s.tool);
  const shapeActive = isShapeTool(s.tool);
  const activeText = useBoardStore(selectActiveText);
  const textControls = s.tool === "text" || !!activeText;
  const colorTarget = useBoardStore(selectColorTarget);
  const shownColor = colorTarget?.color ?? s.color;
  const shownSize = activeText?.fontSize ?? s.textSize;

  const scale = useViewStore((st) => st.s);
  // Épaisseur à l'écran ; si la plus grande (`top`) ne tient pas dans le bouton, toutes sont réduites d'autant
  const dot = (w: number, top: number) => Math.max(3, w * scale * Math.min(1, 24 / (top * scale)));

  const rulerOn = useWidgetStore((st) => st.widgets.some((w) => w.type === "ruler"));
  const shadeOn = useWidgetStore((st) => st.widgets.some((w) => w.type === "shade"));
  const squareOn = useWidgetStore((st) => st.widgets.some((w) => w.type === "square"));
  const protractorOn = useWidgetStore((st) => st.widgets.some((w) => w.type === "protractor"));
  const compassOn = useWidgetStore((st) => st.widgets.some((w) => w.type === "compass"));
  const toggleRuler = useWidgetStore((st) => st.toggleRuler);
  const toggleShade = useWidgetStore((st) => st.toggleShade);
  const toggleSquare = useWidgetStore((st) => st.toggleSquare);
  const toggleProtractor = useWidgetStore((st) => st.toggleProtractor);
  const toggleCompass = useWidgetStore((st) => st.toggleCompass);

  return (
    <>
    <EdgeTab drag={drag} id="outils" name="la barre d'outils" icon={<Pen size={20} />} />
    <div
      {...drag.boxProps}
      className="fixed z-50 w-[72px] select-none overflow-y-auto overflow-x-hidden rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-xl backdrop-blur"
      style={{
        ...drag.boxProps.style,
        maxHeight: `calc(100vh - ${drag.pos.y}px - 12px)`,
        touchAction: "pan-y",
        scrollbarWidth: "none", // une barre de défilement mangerait la largeur des boutons
      }}
    >
      {/* Poignée de déplacement + bouton pour rentrer la barre */}
      <div className="flex flex-col items-center">
        <DragGrip handlers={drag.handlers} className="h-8 w-full" />
        <RetractButton drag={drag} name="la barre d'outils" className="h-8 w-full" />
      </div>

        <div className="mt-1 flex flex-col items-center gap-1">
          <ToolButton label="Sélection" active={s.tool === "select"} onClick={() => s.setTool("select")}>
            <MousePointer2 size={24} />
          </ToolButton>
          <ToolButton label="Déplacer la page" active={s.tool === "pan"} onClick={() => s.setTool("pan")}>
            <Hand size={24} />
          </ToolButton>
          <ToolButton label="Texte" active={s.tool === "text"} onClick={() => s.setTool("text")}>
            <Type size={24} />
          </ToolButton>
          <ToolButton label="Stylo" active={s.tool === "pen"} onClick={() => s.setTool("pen")}>
            <Pen size={24} />
          </ToolButton>
          <ToolButton label="Surligneur" active={s.tool === "highlighter"} onClick={() => s.setTool("highlighter")}>
            <Highlighter size={24} />
          </ToolButton>
          <ToolButton label="Gomme" active={s.tool === "eraser"} onClick={() => s.setTool("eraser")}>
            <Eraser size={24} />
          </ToolButton>
          <ToolButton
            label="Formes"
            active={shapeActive}
            onClick={() => s.setTool(shapeActive ? s.tool : lastShape)}
          >
            <Shapes size={24} />
          </ToolButton>

          {s.tool === "eraser" && (
            <div className="flex w-full flex-col gap-1 pt-1">
              {(["object", "pixel"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => s.setEraserMode(m)}
                  className={`rounded-lg py-1.5 text-xs font-medium ${
                    s.eraserMode === m ? "bg-blue-100 text-blue-700" : "text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  {m === "object" ? "Objet" : "Pixels"}
                </button>
              ))}
            </div>
          )}

          {shapeActive && (
            <div className="grid grid-cols-2 gap-1 pt-1">
              {SHAPE_TOOLS.map((sh) => (
                <button
                  key={sh}
                  type="button"
                  title={SHAPE_META[sh].label}
                  aria-label={SHAPE_META[sh].label}
                  onClick={() => {
                    setLastShape(sh);
                    s.setTool(sh);
                  }}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                    s.tool === sh ? "bg-blue-100 text-blue-700" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {SHAPE_META[sh].icon}
                </button>
              ))}
            </div>
          )}

          <hr className="my-1 w-full border-slate-200" />

          {/* Couleurs */}
          {(textControls || colorTarget || (s.tool !== "select" && s.tool !== "pan" && s.tool !== "eraser")) && (
            <div data-text-ui className="flex w-full flex-col items-center">
              <div className="grid grid-cols-2 gap-1.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Couleur ${c}`}
                    onClick={() => s.setColor(c)}
                    className={`h-8 w-8 rounded-full border ${
                      shownColor === c ? "ring-2 ring-blue-600 ring-offset-1" : "border-slate-300"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <label className="mt-1 flex h-8 w-full cursor-pointer items-center justify-center rounded-lg text-[11px] text-slate-500 hover:bg-slate-100">
                Autre
                <input type="color" value={shownColor} onChange={(e) => s.setColor(e.target.value)} className="sr-only" />
              </label>
            </div>
          )}

          {/* Tailles de texte */}
          {textControls && (
            <div data-text-ui className="grid grid-cols-2 gap-1.5 pt-1">
              {TEXT_SIZES.map((n, i) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`Taille de texte ${n}`}
                  onClick={() => s.setTextSize(n)}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg font-semibold text-slate-800 ${
                    shownSize === n ? "bg-blue-100" : "hover:bg-slate-100"
                  }`}
                  style={{ fontSize: 11 + i * 4 }}
                >
                  A
                </button>
              ))}
            </div>
          )}

          {/* Épaisseurs */}
          {widthKey && (
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              {presets(s.baseWidths[widthKey]).map((w, _, all) => (
                <button
                  key={w}
                  type="button"
                  aria-label={`Épaisseur ${w}`}
                  onClick={() => s.setWidth(widthKey, w)}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                    s.widths[widthKey] === w ? "bg-blue-100" : "hover:bg-slate-100"
                  }`}
                >
                  <span
                    className="rounded-full bg-slate-800"
                    style={{
                      width: dot(w, all[all.length - 1]),
                      height: dot(w, all[all.length - 1]),
                      opacity: s.tool === "highlighter" ? 0.5 : 1,
                    }}
                  />
                </button>
              ))}
            </div>
          )}

          <hr className="my-1 w-full border-slate-200" />

          <ToolButton label="Règle" active={rulerOn} onClick={toggleRuler}>
            <Ruler size={22} />
          </ToolButton>
          <ToolButton label="Équerre" active={squareOn} onClick={toggleSquare}>
            <SetSquareIcon />
          </ToolButton>
          <ToolButton label="Rapporteur" active={protractorOn} onClick={toggleProtractor}>
            <Gauge size={22} />
          </ToolButton>
          <ToolButton label="Compas" active={compassOn} onClick={toggleCompass}>
            <DraftingCompass size={22} />
          </ToolButton>
          <ToolButton label="Rideau" active={shadeOn} onClick={toggleShade}>
            <EyeOff size={22} />
          </ToolButton>

          <ToolButton label="Importer une image" onClick={() => fileRef.current?.click()}>
            <ImagePlus size={22} />
          </ToolButton>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg"
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = ""; // permet de réimporter le même fichier
              if (files.length) void importImageFiles(files);
            }}
          />
          <ToolButton
            label="Importer une vidéo ou un son"
            onClick={() => (IS_TAURI ? void pickAndImportMedia() : videoRef.current?.click())}
          >
            <Clapperboard size={22} />
          </ToolButton>
          <input
            ref={videoRef}
            type="file"
            multiple
            accept={MEDIA_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) void importMediaFiles(files);
            }}
          />
          <ToolButton label="Insérer un lien vidéo" onClick={() => setLinkOpen(true)}>
            <Link2 size={22} />
          </ToolButton>
          {linkOpen && <VideoLinkDialog onClose={() => setLinkOpen(false)} />}

          <ToolButton label="Annuler" onClick={s.undo} disabled={!s.past.length}>
            <Undo2 size={22} />
          </ToolButton>
          <ToolButton label="Rétablir" onClick={s.redo} disabled={!s.future.length}>
            <Redo2 size={22} />
          </ToolButton>
          <ToolButton label="Tout effacer" onClick={s.clear} disabled={!hasObjects}>
            <Trash2 size={22} />
          </ToolButton>
        </div>
    </div>
    </>
  );
}

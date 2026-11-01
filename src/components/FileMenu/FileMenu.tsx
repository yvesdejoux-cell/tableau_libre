import { useState, type ReactNode } from "react";
import {
  ChevronDown, FileDown, FilePlus, FileText, FolderOpen, ImageDown, Loader2, Maximize, Ruler, Save, SaveAll,
} from "lucide-react";
import { useDraggable } from "../../hooks/useDraggable";
import { exportPdf, exportPng, newSession, openSession, saveSession } from "../../lib/fileActions";
import { toggleFullscreen } from "../../lib/windowing";
import { useSessionStore } from "../../store/useSessionStore";
import CalibrationDialog from "../Calibration/CalibrationDialog";
import { DragGrip, EdgeTab, RetractButton } from "../FloatingBox/BoxControls";

const MENU_W = 288;

function Item(props: { icon: ReactNode; label: string; hint?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm text-slate-700 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40"
    >
      {props.icon}
      <span className="flex-1">{props.label}</span>
      {props.hint && <span className="text-xs text-slate-400">{props.hint}</span>}
    </button>
  );
}

export default function FileMenu() {
  const [open, setOpen] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const drag = useDraggable("bouton-fichier", (w) => ({ x: window.innerWidth - w - 16, y: 16 }));
  const name = useSessionStore((s) => s.name);
  const dirty = useSessionStore((s) => s.dirty);
  const busy = useSessionStore((s) => s.busy);
  const cancelBusy = useSessionStore((s) => s.cancelBusy);

  const run = (fn: () => Promise<unknown>) => () => {
    setOpen(false);
    void fn();
  };

  // Menu et indicateur d'activité suivent le bouton : alignés sur son bord droit, dessous, ou dessus s'il est en bas
  const boxBottom = drag.pos.y + 48;
  const right = Math.max(16, window.innerWidth - drag.pos.x - (drag.box?.offsetWidth ?? 0));
  const below = drag.pos.y < window.innerHeight / 2;
  const attached = below
    ? { right: Math.min(right, window.innerWidth - MENU_W - 8), top: boxBottom + 4 }
    : { right: Math.min(right, window.innerWidth - MENU_W - 8), bottom: window.innerHeight - drag.pos.y + 4 };

  return (
    <>
      <EdgeTab drag={drag} id="fichier" name="le bouton Fichier" icon={<FileText size={20} />} />
      <div
        {...drag.boxProps}
        className="fixed z-50 flex h-12 select-none items-center rounded-xl border border-slate-200 bg-white/95 shadow-lg backdrop-blur"
      >
        <DragGrip handlers={drag.handlers} vertical className="h-full w-7" />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-full items-center gap-2 rounded-lg px-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <FileText size={18} />
          <span className="max-w-[200px] truncate">
            {name}
            {dirty && " •"}
          </span>
          <ChevronDown size={16} />
        </button>
        <RetractButton drag={drag} name="le bouton Fichier" className="h-full w-7" onRetract={() => setOpen(false)} />
      </div>

      {busy && (
        <div
          className="fixed z-50 flex items-center gap-2 rounded-lg bg-slate-900/90 px-3 py-1.5 text-sm text-white shadow-lg"
          style={drag.collapsed ? { right: 48, top: 16 } : attached}
        >
          <Loader2 size={16} className="animate-spin" />
          {busy}
          {cancelBusy && (
            <button type="button" onClick={cancelBusy} className="ml-1 rounded-md bg-white/15 px-2 py-1 font-medium hover:bg-white/25">
              Annuler
            </button>
          )}
        </div>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-40" onPointerDown={() => setOpen(false)} />
          <div className="fixed z-50 rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-xl backdrop-blur" style={{ ...attached, width: MENU_W }}>
            <Item icon={<FilePlus size={20} />} label="Nouveau" hint="Ctrl+N" onClick={run(newSession)} />
            <Item icon={<FolderOpen size={20} />} label="Ouvrir…" hint="Ctrl+O" onClick={run(openSession)} />
            <Item icon={<Save size={20} />} label="Enregistrer" hint="Ctrl+S" onClick={run(() => saveSession(false))} />
            <Item icon={<SaveAll size={20} />} label="Enregistrer sous…" hint="Ctrl+Maj+S" onClick={run(() => saveSession(true))} />
            <hr className="my-1 border-slate-200" />
            <Item icon={<FileDown size={20} />} label="Exporter en PDF" disabled={!!busy} onClick={run(exportPdf)} />
            <Item icon={<ImageDown size={20} />} label="Exporter en PNG" disabled={!!busy} onClick={run(exportPng)} />
            <hr className="my-1 border-slate-200" />
            <Item icon={<Maximize size={20} />} label="Plein écran" hint="F11" onClick={run(toggleFullscreen)} />
            <Item
              icon={<Ruler size={20} />}
              label="Calibrer la règle…"
              onClick={() => {
                setOpen(false);
                setCalibrating(true);
              }}
            />
          </div>
        </>
      )}

      {calibrating && <CalibrationDialog onClose={() => setCalibrating(false)} />}
    </>
  );
}

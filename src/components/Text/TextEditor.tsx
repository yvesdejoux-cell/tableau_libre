import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Keyboard, Type } from "lucide-react";
import { useDraggable } from "../../hooks/useDraggable";
import { TEXT_LINE_HEIGHT, textCss } from "../../lib/text";
import { DragGrip, EdgeTab, RetractButton } from "../FloatingBox/BoxControls";
import { selectActiveText, useBoardStore } from "../../store/useBoardStore";
import { useViewStore } from "../../store/useViewStore";
import ScreenKeyboard from "./ScreenKeyboard";

/**
 * Champ de saisie posé exactement sur la zone de texte en cours d'édition.
 * L'édition se termine dès qu'on touche autre chose que le champ, le clavier, ou les réglages
 * de couleur et de taille (marqués `data-text-ui`). Le tableau (`data-board`) s'en charge lui-même,
 * pour que ce même geste ne crée pas aussitôt une nouvelle zone.
 */
export default function TextEditor() {
  const editing = useBoardStore((s) => (s.editingId ? selectActiveText(s) : undefined));
  const patch = useBoardStore((s) => s.patchEditedText);
  const end = useBoardStore((s) => s.endTextEdit);
  const view = useViewStore();

  const ref = useRef<HTMLTextAreaElement>(null);
  const lastPointer = useRef("mouse");
  const [kbChoice, setKbChoice] = useState<boolean | null>(null); // choix explicite de l'utilisateur
  const kbOpen = kbChoice ?? lastPointer.current !== "mouse"; // par défaut : ouvert au doigt ou au stylet

  const id = editing?.id;

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      lastPointer.current = e.pointerType;
      const inside = (e.target as Element).closest?.("[data-text-ui],[data-board]");
      if (!inside) useBoardStore.getState().endTextEdit();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, []);

  useEffect(() => {
    if (!id) return;
    const el = ref.current!;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);

    // Le curseur reste dans le champ quand on touche un bouton (clavier écran, couleurs…)
    const keepFocus = (e: MouseEvent) => {
      if (e.target !== el) e.preventDefault();
    };
    window.addEventListener("mousedown", keepFocus, true);
    return () => window.removeEventListener("mousedown", keepFocus, true);
  }, [id]);

  // La hauteur du champ suit le contenu
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing?.text, editing?.fontSize, editing?.w, view.s]);

  if (!editing) return null;

  return (
    <>
      <textarea
        ref={ref}
        data-text-ui
        aria-label="Texte"
        rows={1}
        spellCheck={false}
        inputMode={kbOpen ? "none" : undefined} // pas de clavier système par-dessus le nôtre
        value={editing.text}
        onChange={(e) => patch({ text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
            e.preventDefault();
            end();
          }
        }}
        className="fixed z-40 m-0 block resize-none overflow-hidden border-0 bg-transparent p-0"
        style={{
          left: view.x + editing.x * view.s,
          top: view.y + editing.y * view.s,
          width: editing.w * view.s,
          transform: `rotate(${editing.rotation}deg)`,
          transformOrigin: "0 0",
          color: editing.color,
          caretColor: editing.color,
          ...textCss(editing),
          fontSize: editing.fontSize * view.s,
          lineHeight: TEXT_LINE_HEIGHT,
          overflowWrap: "anywhere",
          outline: "2px dashed #2563eb",
          outlineOffset: 3,
          touchAction: "none",
        }}
      />

      <TextBar kbOpen={kbOpen} onToggleKeyboard={() => setKbChoice(!kbOpen)} onEnd={end} />

      {kbOpen && <ScreenKeyboard target={ref} onText={(text) => patch({ text })} />}
    </>
  );
}

function TextBar(props: { kbOpen: boolean; onToggleKeyboard: () => void; onEnd: () => void }) {
  const drag = useDraggable("texte", (w) => ({
    x: (window.innerWidth - w) / 2,
    y: 16,
  }));

  return (
    <>
      <EdgeTab drag={drag} id="texte" name="les réglages du texte" icon={<Type size={20} />} textUi />
      <div
        {...drag.boxProps}
        data-text-ui
        className="fixed z-50 flex select-none gap-1 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-lg backdrop-blur"
      >
        <DragGrip handlers={drag.handlers} vertical className="h-10 w-8" />
        <button
          type="button"
          onClick={props.onToggleKeyboard}
          className={`flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium ${
            props.kbOpen ? "bg-blue-100 text-blue-700" : "text-slate-700 hover:bg-slate-100"
          }`}
        >
          <Keyboard size={18} /> Clavier
        </button>
        <button
          type="button"
          onClick={props.onEnd}
          className="flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Check size={18} /> Terminer
        </button>
        <RetractButton drag={drag} name="les réglages du texte" className="h-10 w-8" />
      </div>
    </>
  );
}

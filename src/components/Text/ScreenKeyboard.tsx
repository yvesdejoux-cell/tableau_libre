import { useState, type ReactNode, type RefObject } from "react";
import { ArrowBigUp, CornerDownLeft, Delete, Keyboard } from "lucide-react";
import { useDraggable } from "../../hooks/useDraggable";
import { DragGrip, EdgeTab, RetractButton } from "../FloatingBox/BoxControls";

const KB_W = 780;

const LETTERS = [
  ["é", "è", "ê", "à", "â", "ç", "ù", "û", "î", "ô", "œ"],
  ["a", "z", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["q", "s", "d", "f", "g", "h", "j", "k", "l", "m"],
  ["w", "x", "c", "v", "b", "n", "'", ",", "."],
];
const SYMBOLS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["+", "-", "×", "÷", "=", "<", ">", "≤", "≥", "≠"],
  ["(", ")", "/", "%", "²", "³", "°", "€", "π", "√"],
  ["?", "!", ":", ";", "\"", "«", "»", "_", "&", "@"],
];

function Key(props: { label: string; onPress: () => void; children: ReactNode; grow?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      onClick={props.onPress}
      className={`flex h-12 min-w-0 items-center justify-center rounded-lg border text-lg font-medium ${
        props.grow ? "flex-[2]" : "flex-1"
      } ${
        props.active
          ? "border-blue-600 bg-blue-100 text-blue-700"
          : "border-slate-200 bg-white text-slate-800 hover:bg-slate-100 active:bg-slate-200"
      }`}
    >
      {props.children}
    </button>
  );
}

/** Clavier AZERTY intégré : ne dépend ni d'un clavier physique ni du clavier tactile du système. */
export default function ScreenKeyboard(props: {
  target: RefObject<HTMLTextAreaElement | null>;
  onText: (text: string) => void;
}) {
  const drag = useDraggable("clavier", (w, h) => ({
    x: (window.innerWidth - w) / 2,
    y: window.innerHeight - h - 16,
  }));
  const [shift, setShift] = useState(false);
  const [symbols, setSymbols] = useState(false);

  /** Remplace le caractère sélectionné (ou les `before` caractères avant le curseur) par `str`. */
  const edit = (str: string, before = 0) => {
    const el = props.target.current;
    if (!el) return;
    const collapsed = el.selectionStart === el.selectionEnd;
    const start = collapsed ? Math.max(0, el.selectionStart - before) : el.selectionStart;
    el.setRangeText(str, start, el.selectionEnd, "end");
    props.onText(el.value);
  };

  const press = (ch: string) => {
    edit(shift ? ch.toLocaleUpperCase("fr") : ch);
    setShift(false);
  };

  return (
    <>
      <EdgeTab drag={drag} id="clavier" name="le clavier" icon={<Keyboard size={20} />} textUi />
      <div
        {...drag.boxProps}
        data-text-ui
        className="fixed z-50 flex select-none flex-col gap-1 rounded-2xl border border-slate-200 bg-slate-100/95 p-2 shadow-2xl backdrop-blur"
        style={{ ...drag.boxProps.style, width: `min(${KB_W}px, 100vw)` }}
      >
        <div className="flex gap-1">
          <DragGrip handlers={drag.handlers} className="h-8 flex-1" />
          <RetractButton drag={drag} name="le clavier" className="h-8 w-12" />
        </div>

        {(symbols ? SYMBOLS : LETTERS).map((row, i) => (
          <div key={i} className="flex gap-1">
            {row.map((ch) => {
              const shown = shift && !symbols ? ch.toLocaleUpperCase("fr") : ch;
              return (
                <Key key={ch} label={shown} onPress={() => press(ch)}>
                  {shown}
                </Key>
              );
            })}
            {i === 3 && (
              <Key label="Effacer" grow onPress={() => edit("", 1)}>
                <Delete size={20} />
              </Key>
            )}
          </div>
        ))}

        <div className="flex gap-1">
          <Key label="Majuscule" active={shift} onPress={() => setShift((v) => !v)}>
            <ArrowBigUp size={20} />
          </Key>
          <Key label={symbols ? "Lettres" : "Chiffres et symboles"} active={symbols} onPress={() => setSymbols((v) => !v)}>
            <span className="text-sm">{symbols ? "abc" : "123"}</span>
          </Key>
          <button
            type="button"
            aria-label="Espace"
            onClick={() => press(" ")}
            className="h-12 min-w-0 flex-[6] rounded-lg border border-slate-200 bg-white hover:bg-slate-100 active:bg-slate-200"
          />
          <Key label="Nouvelle ligne" grow onPress={() => press("\n")}>
            <CornerDownLeft size={20} />
          </Key>
        </div>
      </div>
    </>
  );
}

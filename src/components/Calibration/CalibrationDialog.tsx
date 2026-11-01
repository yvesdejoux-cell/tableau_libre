import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useBoardStore } from "../../store/useBoardStore";
import { CM_PX, useWidgetStore } from "../../store/useWidgetStore";

const REF_CM = 20; // la barre représente 20 cm

export default function CalibrationDialog({ onClose }: { onClose: () => void }) {
  const current = useWidgetStore((s) => s.pxPerCm);
  const setPxPerCm = useWidgetStore((s) => s.setPxPerCm);

  const maxBar = Math.max(200, Math.min(2400, window.innerWidth - 140));
  const [bar, setBar] = useState(Math.min(maxBar, Math.round(current * REF_CM)));
  const [inches, setInches] = useState("");

  const pxPerCm = bar / REF_CM;
  const set = (v: number) => setBar(Math.min(maxBar, Math.max(100, Math.round(v))));

  // Estimation à partir de la diagonale de l'écran (en pixels CSS)
  const fromDiagonal = () => {
    const d = Number(inches.replace(",", "."));
    if (!Number.isFinite(d) || d < 5 || d > 200) return;
    const diagPx = Math.hypot(window.screen.width, window.screen.height);
    set((diagPx / (d * 2.54)) * REF_CM);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl" onPointerDown={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-slate-800">Calibrer l'échelle</h2>
        <p className="mt-1 text-sm text-slate-600">
          Posez une vraie règle contre l'écran et ajustez la barre bleue pour qu'elle mesure exactement{" "}
          <strong>{REF_CM} cm</strong>. La règle et le compas afficheront alors de vrais centimètres.
        </p>

        {/* Barre de référence : ses deux bords doivent coïncider avec 0 et 20 cm */}
        <div className="mt-6 overflow-hidden">
          <div className="relative h-8 bg-blue-500/80" style={{ width: bar }}>
            <span className="absolute inset-y-0 left-0 w-0.5 bg-slate-900" />
            <span className="absolute inset-y-0 right-0 w-0.5 bg-slate-900" />
          </div>
        </div>
        <div className="mt-1 text-sm text-slate-500">
          {bar} px = {REF_CM} cm → <strong className="text-slate-700">{pxPerCm.toFixed(2)} px/cm</strong>
        </div>

        <input
          type="range"
          min={100}
          max={maxBar}
          value={bar}
          onChange={(e) => set(Number(e.target.value))}
          className="mt-4 h-8 w-full"
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {[-10, -1, 1, 10].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => set(bar + d)}
              className="flex h-11 min-w-[56px] items-center justify-center gap-1 rounded-xl border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {d < 0 ? <Minus size={14} /> : <Plus size={14} />}
              {Math.abs(d)} px
            </button>
          ))}
          <button
            type="button"
            onClick={() => set(CM_PX * REF_CM)}
            className="ml-auto h-11 rounded-xl border border-slate-300 px-3 text-sm text-slate-600 hover:bg-slate-50"
          >
            Valeur par défaut (96 dpi)
          </button>
        </div>

        {/* Première estimation par la diagonale de l'écran */}
        <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3">
          <span className="text-sm text-slate-600">Pas de règle sous la main ? Diagonale de l'écran :</span>
          <input
            inputMode="decimal"
            placeholder="ex. 75"
            value={inches}
            onChange={(e) => setInches(e.target.value)}
            className="h-11 w-24 rounded-xl border border-slate-300 px-3 text-sm"
          />
          <span className="text-sm text-slate-600">pouces</span>
          <button
            type="button"
            onClick={fromDiagonal}
            className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Estimer
          </button>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-12 rounded-xl px-5 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Annuler
          </button>
          <button
            type="button"
            onClick={() => {
              setPxPerCm(pxPerCm);
              useBoardStore.getState().applyDefaultWidths(); // les préréglages suivent la taille physique
              onClose();
            }}
            className="h-12 rounded-xl bg-blue-600 px-5 text-sm font-medium text-white shadow hover:bg-blue-700"
          >
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

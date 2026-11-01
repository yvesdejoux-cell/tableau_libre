import { ChevronLeft, ChevronRight } from "lucide-react";
import { useDraggable } from "../../hooks/useDraggable";
import { useBoardStore } from "../../store/useBoardStore";

/** Flèches page précédente / suivante, attachées l'une à l'autre : un clic change de page, un glissement les déplace. */
function Arrows() {
  const pages = useBoardStore((s) => s.pages);
  const currentPageId = useBoardStore((s) => s.currentPageId);
  const selectPage = useBoardStore((s) => s.selectPage);
  const drag = useDraggable("fleches", (w, h) => ({
    x: (window.innerWidth - w) / 2,
    y: window.innerHeight - h - 16,
  }));
  const index = pages.findIndex((p) => p.id === currentPageId);

  // Pas d'attribut `disabled` : une flèche pâle doit rester une prise pour déplacer le bloc
  const arrow = (label: string, target: number, icon: React.ReactNode) => {
    const page = pages[target];
    return (
      <button
        type="button"
        aria-label={label}
        aria-disabled={!page}
        title={label}
        {...drag.handlers}
        onClick={() => {
          if (page && !drag.dragged.current) selectPage(page.id);
        }}
        style={{ touchAction: "none" }}
        className={`flex h-14 w-14 cursor-pointer items-center justify-center rounded-full text-white ${
          page ? "bg-slate-800/40 hover:bg-slate-800/60 active:bg-slate-800/75" : "bg-slate-800/15"
        }`}
      >
        {icon}
      </button>
    );
  };

  return (
    <div {...drag.boxProps} className="fixed z-40 flex select-none gap-2">
      {arrow("Page précédente", index - 1, <ChevronLeft size={32} />)}
      {arrow("Page suivante", index + 1, <ChevronRight size={32} />)}
    </div>
  );
}

export default function PageArrows() {
  const several = useBoardStore((s) => s.pages.length > 1);
  return several ? <Arrows /> : null;
}

import { useLayoutEffect, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, GripHorizontal, GripVertical } from "lucide-react";
import { create } from "zustand";
import type { Draggable } from "../../hooks/useDraggable";
import { EDGE_TAB_H, stackEdgeTabs, type EdgeTabPlace } from "../../lib/edgeTabs";

const HOVER = "hover:bg-slate-500/10";

export function DragGrip(props: { handlers: Draggable["handlers"]; vertical?: boolean; className: string }) {
  const Icon = props.vertical ? GripVertical : GripHorizontal;
  return (
    <div
      {...props.handlers}
      style={{ touchAction: "none" }}
      className={`flex shrink-0 cursor-grab items-center justify-center rounded-lg text-slate-400 active:cursor-grabbing ${HOVER} ${props.className}`}
      title="Déplacer"
    >
      <Icon size={20} />
    </div>
  );
}

export function RetractButton(props: { drag: Draggable; name: string; className: string; onRetract?: () => void }) {
  const Icon = props.drag.side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={() => {
        props.onRetract?.();
        props.drag.toggleCollapsed();
      }}
      className={`flex shrink-0 items-center justify-center rounded-lg text-slate-500 ${HOVER} ${props.className}`}
      title="Rentrer sur le côté"
      aria-label={`Rentrer ${props.name}`}
    >
      <Icon size={18} />
    </button>
  );
}

const useEdgeTabs = create<{ tabs: Record<string, EdgeTabPlace> }>(() => ({ tabs: {} }));

/**
 * Repère collé au bord de l'écran : un clic fait ressortir la boîte retirée.
 * À rendre à côté de la boîte, et non dedans : son flou d'arrière-plan piégerait un élément « fixed ».
 */
export function EdgeTab(props: { drag: Draggable; id: string; name: string; icon: ReactNode; textUi?: boolean }) {
  const { collapsed, side, pos, toggleCollapsed } = props.drag;
  const { id } = props;

  useLayoutEffect(() => {
    if (!collapsed) return;
    useEdgeTabs.setState((s) => ({ tabs: { ...s.tabs, [id]: { id, side, y: pos.y } } }));
    return () =>
      useEdgeTabs.setState((s) => {
        const { [id]: _, ...tabs } = s.tabs;
        return { tabs };
      });
  }, [collapsed, id, side, pos.y]);

  const y = useEdgeTabs((s) => stackEdgeTabs(Object.values(s.tabs), window.innerHeight)[id]);
  if (!collapsed) return null;

  return (
    <button
      type="button"
      data-text-ui={props.textUi ? "" : undefined}
      onClick={toggleCollapsed}
      title={`Afficher ${props.name}`}
      aria-label={`Afficher ${props.name}`}
      className={`fixed z-50 flex w-10 items-center justify-center border border-slate-200 bg-white/95 text-slate-600 shadow-lg hover:bg-slate-50 active:bg-slate-200 ${
        side === "left" ? "left-0 rounded-r-xl border-l-0" : "right-0 rounded-l-xl border-r-0"
      }`}
      style={{ top: y ?? pos.y, height: EDGE_TAB_H }}
    >
      {props.icon}
    </button>
  );
}

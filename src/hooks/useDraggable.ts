import { useLayoutEffect, useRef, useState } from "react";

type Pos = { x: number; y: number };
type Saved = { pos?: Pos; collapsed?: boolean };
export type Side = "left" | "right";

const STORAGE_KEY = "tableau-libre:boites";
const DRAG_THRESHOLD = 5; // en dessous, le geste reste un simple clic
const SLIDE_MS = 200;

const load = (): Record<string, Saved> => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
};

const saved = load();

const save = (name: string, patch: Saved) => {
  saved[name] = { ...saved[name], ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // la boîte reste utilisable, elle reprendra sa place par défaut au prochain démarrage
  }
};

const clamp = (v: number, min: number, max: number) => Math.max(Math.min(v, max), min);

/**
 * Boîte flottante déplaçable, qui se retire hors de l'écran par le bord le plus proche ; sa place et son état
 * sont retrouvés d'une ouverture à l'autre. `initial` reçoit la taille de la boîte : tant qu'elle n'a pas été
 * déplacée, elle suit sa place par défaut (par exemple le coin de la fenêtre). `shrinks` : la boîte réduit
 * sa hauteur et peut déborder vers le bas, seule sa poignée doit rester visible.
 */
export function useDraggable(name: string, initial: (w: number, h: number) => Pos, options?: { shrinks?: boolean }) {
  const [box, boxRef] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState<Pos>(() => saved[name]?.pos ?? initial(0, 0));
  const [collapsed, setCollapsed] = useState(!!saved[name]?.collapsed);
  const [sliding, setSliding] = useState(false); // animation réservée au retrait : ni au démarrage, ni pendant un glissement
  const moved = useRef(!!saved[name]?.pos);
  const dragged = useRef(false); // le geste en cours ou le dernier a déplacé la boîte : ce n'est pas un clic
  const drag = useRef<{ dx: number; dy: number; startX: number; startY: number; id: number } | null>(null);

  const inWindow = (p: Pos, el: HTMLElement): Pos => ({
    x: clamp(p.x, 0, window.innerWidth - el.offsetWidth),
    y: clamp(p.y, 0, window.innerHeight - (options?.shrinks ? 56 : el.offsetHeight)),
  });

  // Fenêtre redimensionnée, boîte qui grandit près d'un bord : elle reste entièrement atteignable
  useLayoutEffect(() => {
    if (!box) return;
    const update = () =>
      setPos((p) => {
        const next = inWindow(moved.current ? p : initial(box.offsetWidth, box.offsetHeight), box);
        return next.x === p.x && next.y === p.y ? p : next;
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(box);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [box]);

  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragged.current = false;
      drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, startX: e.clientX, startY: e.clientY, id: e.pointerId };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId || !box) return;
      if (!dragged.current && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
      dragged.current = true;
      moved.current = true;
      setPos(inWindow({ x: e.clientX - d.dx, y: e.clientY - d.dy }, box));
    },
    onPointerUp: () => {
      drag.current = null;
      if (dragged.current) save(name, { pos });
    },
  };

  const toggleCollapsed = () => {
    save(name, { collapsed: !collapsed });
    setCollapsed(!collapsed);
    setSliding(true);
    setTimeout(() => setSliding(false), SLIDE_MS + 50);
  };

  const width = box?.offsetWidth ?? 0;
  const side: Side = pos.x + width / 2 < window.innerWidth / 2 ? "left" : "right";
  const outside = side === "left" ? -width - 12 : "calc(100vw + 12px)"; // 12 px : l'ombre sort aussi

  const boxProps = {
    ref: boxRef,
    inert: collapsed,
    style: { left: collapsed ? outside : pos.x, top: pos.y, transition: sliding ? `left ${SLIDE_MS}ms ease` : undefined },
  };

  return { pos, handlers, box, boxProps, collapsed, toggleCollapsed, side, dragged };
}

export type Draggable = ReturnType<typeof useDraggable>;

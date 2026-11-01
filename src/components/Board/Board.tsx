import { useEffect, useMemo, useRef, useState } from "react";
import Konva from "konva";
import { Arrow, Ellipse, Image as KImage, Layer, Line, Rect, Stage, Text as KText, Transformer } from "react-konva";
import { nanoid } from "nanoid";
import { backgroundStyle } from "../../lib/backgrounds";
import { findGuide, projectOnGuide, type Segment } from "../../lib/guides";
import { importImageFiles } from "../../lib/importImage";
import { importMediaFiles, insertVideoLink } from "../../lib/importVideo";
import { parseVideoLink } from "../../lib/videoLinks";
import { PlayButtons, VideoBar, VideosLayer, type LiveVideo } from "../Video/VideosLayer";
import { arrowSize, computeShape, createPreviewNode, trianglePoints, updatePreviewNode, type Pt } from "../../lib/shapes";
import { MIN_TEXT_W, clampFontSize, newTextBox, textAttrs } from "../../lib/text";
import { PAGE_H, PAGE_W, type View } from "../../lib/view";
import { selectCurrentPage, useBoardStore } from "../../store/useBoardStore";
import { screenToPage, useViewStore } from "../../store/useViewStore";
import { isShapeTool, type BoardObject, type ShapeTool, type VideoObject } from "../../types";

// Les points de start / end des formes et des tracés guidés sont en coordonnées de PAGE.
type Drawing =
  | {
      kind: "draw";
      pointerId: number;
      line: Konva.Line;
      points: number[];
      tool: "pen" | "highlighter" | "eraser";
      color: string;
      width: number;
    }
  | { kind: "erase"; pointerId: number; recorded: boolean }
  | {
      kind: "shape";
      pointerId: number;
      shape: ShapeTool;
      node: Konva.Shape;
      start: Pt;
      end: Pt;
      constrain: boolean;
      color: string;
      width: number;
    }
  | {
      kind: "ruled";
      pointerId: number;
      line: Konva.Line;
      guide: Segment; // en pixels écran
      offset: number; // décalage hors du bord, en pixels écran
      start: Pt;
      end: Pt;
      tool: "pen" | "highlighter";
      color: string;
      width: number;
    };

type Preview = Exclude<Drawing, { kind: "erase" }>;
const previewOf = (d: Preview): Konva.Node => (d.kind === "shape" ? d.node : d.line);

type KEvt = Konva.KonvaEventObject<Event>;

const viewNow = (): View => {
  const { s, x, y } = useViewStore.getState();
  return { s, x, y };
};
const TEXT_ANCHORS = ["top-left", "top-right", "bottom-left", "bottom-right", "middle-left", "middle-right"];
const ALL_ANCHORS = [...TEXT_ANCHORS, "top-center", "bottom-center"];
const midOf = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distOf = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

/** Charge les images des objets (cache par src) ; `version` change quand une image est prête. */
function useImages(objects: BoardObject[]) {
  const cache = useRef(new Map<string, HTMLImageElement>());
  const [version, bump] = useState(0);
  useEffect(() => {
    for (const o of objects) {
      if (o.kind !== "image" || cache.current.has(o.src)) continue;
      const img = new window.Image();
      cache.current.set(o.src, img);
      img.onload = () => bump((n) => n + 1);
      img.src = o.src;
    }
  }, [objects]);
  return { images: cache.current, version };
}

export default function Board() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const drawing = useRef<Drawing | null>(null);
  const lastPenTime = useRef(0);

  // Gestes de vue
  const touches = useRef(new Map<number, Pt>()); // doigts posés (pixels écran)
  const pinch = useRef<{ mid: Pt; dist: number; view: View } | null>(null);
  const panning = useRef<{ pointerId: number; start: Pt; view: View } | null>(null);
  const spaceDown = useRef(false);

  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [pinching, setPinching] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const view = useViewStore();

  const page = useBoardStore(selectCurrentPage);
  const objects = page.objects;
  const tool = useBoardStore((s) => s.tool);
  const selectedId = useBoardStore((s) => s.selectedId);
  const editingId = useBoardStore((s) => s.editingId);
  const interactingId = useBoardStore((s) => s.interactingId);
  const [liveVideo, setLiveVideo] = useState<LiveVideo | null>(null);
  const videos = useMemo(() => objects.filter((o): o is VideoObject => o.kind === "video"), [objects]);
  const { images, version: imgVersion } = useImages(objects);

  const isSelect = tool === "select";
  const isPan = tool === "pan";
  const selectedObj = objects.find((o) => o.id === selectedId);

  // --- Taille du conteneur (la vue « ajustée » se recalcule dans le store)
  useEffect(() => {
    const el = containerRef.current!;
    const update = () => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
      useViewStore.getState().setSize(el.clientWidth, el.clientHeight);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- Molette seule : la feuille ne bouge pas ; Ctrl/Cmd + molette (ou pincement de pavé tactile) : zoom
  useEffect(() => {
    const el = containerRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); // pas de défilement de la fenêtre
      if (!e.ctrlKey && !e.metaKey) return;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dy = e.deltaY * unit;
      const { zoomAt } = useViewStore.getState();
      const r = el.getBoundingClientRect();
      // petits deltas (pincement de pavé tactile) : plus sensibles qu'un cran de molette
      const k = Math.abs(dy) < 40 ? 0.012 : 0.0015;
      zoomAt(Math.exp(-dy * k), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // --- Changement de page : on abandonne un tracé en cours
  useEffect(() => {
    abortDrawing();
  }, [page.id]);

  // --- Transformer attaché à l'objet sélectionné
  useEffect(() => {
    const tr = trRef.current;
    const layer = layerRef.current;
    if (!tr || !layer) return;
    const node =
      selectedId && isSelect && selectedId !== editingId && selectedId !== interactingId
        ? layer.getChildren((n) => n.id() === selectedId)[0]
        : undefined;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, editingId, interactingId, isSelect, objects, view.s, view.x, view.y]);

  // --- Raccourcis clavier + collage d'images
  useEffect(() => {
    const zoomCenter = (factor: number) => {
      const { zoomAt, vw, vh } = useViewStore.getState();
      zoomAt(factor, vw / 2, vh / 2);
    };

    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;

      const st = useBoardStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();

      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) {
          spaceDown.current = true;
          setSpaceHeld(true);
        }
      } else if (mod && k === "z") {
        e.preventDefault();
        e.shiftKey ? st.redo() : st.undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        st.redo();
      } else if (mod && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        zoomCenter(1.25);
      } else if (mod && e.key === "-") {
        e.preventDefault();
        zoomCenter(1 / 1.25);
      } else if (mod && e.key === "0") {
        e.preventDefault();
        useViewStore.getState().fit();
      } else if ((e.key === "Delete" || e.key === "Backspace") && st.selectedId) {
        st.removeObject(st.selectedId);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceDown.current = false;
        setSpaceHeld(false);
      }
    };
    const onBlur = () => {
      spaceDown.current = false;
      setSpaceHeld(false);
    };
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        void importImageFiles(files);
        return;
      }
      // Un lien vidéo collé sur le tableau s'y insère (mais pas pendant une saisie)
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      const text = e.clipboardData?.getData("text") ?? "";
      const link = parseVideoLink(text);
      if (link && link.kind !== "page") {
        e.preventDefault();
        insertVideoLink(text.trim().replace(/^(?!https?:\/\/)/i, "https://"));
      }
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  /** Position du pointeur en pixels écran (repère du conteneur). */
  const getPos = (clientX: number, clientY: number): Pt => {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };

  function abortDrawing() {
    const d = drawing.current;
    if (d && d.kind !== "erase") previewOf(d).destroy();
    drawing.current = null;
    layerRef.current?.batchDraw();
  }

  // --- Gomme "objet" : teste le centre + un anneau autour du pointeur (en pixels écran)
  const eraseAt = (d: Extract<Drawing, { kind: "erase" }>, sx: number, sy: number) => {
    const stage = stageRef.current!;
    const { widths, checkpoint, removeObject } = useBoardStore.getState();
    const r = (widths.eraser * useViewStore.getState().s) / 2;
    const probes: Pt[] = [{ x: sx, y: sy }];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      probes.push({ x: sx + Math.cos(a) * r, y: sy + Math.sin(a) * r });
    }
    for (const p of probes) {
      const node = stage.getIntersection(p);
      if (node && node.name() === "obj") {
        if (!d.recorded) {
          checkpoint(); // un seul point d'historique par geste
          d.recorded = true;
        }
        removeObject(node.id(), false);
      }
    }
  };

  /** Début d'un geste à deux doigts : le trait en cours est abandonné. */
  const beginPinch = (e: React.PointerEvent<HTMLDivElement>) => {
    abortDrawing();
    panning.current = null;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [a, b] = [...touches.current.values()];
    pinch.current = { mid: midOf(a, b), dist: distOf(a, b) || 1, view: viewNow() };
    setPinching(true);
  };

  // --- Pointer Events (stylet / tactile / souris)
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = useBoardStore.getState();
    const t = st.tool;
    const mouse = e.pointerType === "mouse";
    const sp = getPos(e.clientX, e.clientY); // écran

    // Les commandes d'une vidéo reçoivent leurs clics ; toucher ailleurs rend la main au tableau et désélectionne
    if (st.interactingId) {
      if (!(e.target instanceof Element && e.target.closest("[data-video-player]"))) st.select(null);
      return;
    }

    // Toucher le tableau pendant une édition de texte la termine, et ne fait rien d'autre
    if (st.editingId) {
      st.endTextEdit();
      return;
    }

    if (e.pointerType === "touch") {
      // Rejet de paume : on ignore le toucher juste après un stylet
      if (performance.now() - lastPenTime.current < 800) return;
      touches.current.set(e.pointerId, sp);
      if (touches.current.size === 2) {
        beginPinch(e);
        return;
      }
      if (touches.current.size > 2) return;
    } else if (e.pointerType === "pen") {
      lastPenTime.current = performance.now();
    }

    // Déplacement de la page : outil Main, bouton du milieu, Espace + clic
    if (t === "pan" || (mouse && (e.button === 1 || (e.button === 0 && spaceDown.current)))) {
      if (mouse && e.button === 1) e.preventDefault(); // pas d'autodéfilement du navigateur
      e.currentTarget.setPointerCapture(e.pointerId);
      panning.current = { pointerId: e.pointerId, start: sp, view: viewNow() };
      return;
    }

    if (t === "select") return; // Konva gère sélection / déplacement
    if (mouse && e.button !== 0) return;
    if (drawing.current) return; // un seul pointeur actif à la fois

    // Texte : sur une zone existante on la modifie, ailleurs on en crée une
    if (t === "text") {
      const hitNode = stageRef.current!.getIntersection(sp);
      const hitObj = hitNode && selectCurrentPage(st).objects.find((o) => o.id === hitNode.id());
      if (hitObj?.kind === "text") {
        st.startEditText(hitObj.id);
      } else {
        st.startNewText({
          id: nanoid(),
          kind: "text",
          text: "",
          ...newTextBox(screenToPage(sp), st.textSize),
          fontSize: st.textSize,
          color: st.color,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
        });
      }
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    const p = screenToPage(sp); // page
    const scale = useViewStore.getState().s;

    // Formes géométriques
    if (isShapeTool(t)) {
      const width = st.widths.shape;
      const node = createPreviewNode(t, st.color, width);
      layerRef.current!.add(node);
      drawing.current = {
        kind: "shape",
        pointerId: e.pointerId,
        shape: t,
        node,
        start: p,
        end: p,
        constrain: e.shiftKey,
        color: st.color,
        width,
      };
      return;
    }

    // Gomme par objet
    if (t === "eraser" && st.eraserMode === "object") {
      const d: Drawing = { kind: "erase", pointerId: e.pointerId, recorded: false };
      drawing.current = d;
      eraseAt(d, sp.x, sp.y);
      return;
    }

    // Tracé guidé par un widget (règle, équerre, rapporteur)
    if (t === "pen" || t === "highlighter") {
      const guide = findGuide(sp);
      if (guide) {
        const width = st.widths[t];
        const offset = (width * scale) / 2;
        const a = screenToPage(projectOnGuide(guide, sp, offset));
        const line = new Konva.Line({
          points: [a.x, a.y, a.x, a.y],
          stroke: st.color,
          strokeWidth: width,
          lineCap: "round",
          lineJoin: "round",
          opacity: t === "highlighter" ? 0.4 : 1,
          listening: false,
        });
        layerRef.current!.add(line);
        drawing.current = {
          kind: "ruled",
          pointerId: e.pointerId,
          line,
          guide,
          offset,
          start: a,
          end: a,
          tool: t,
          color: st.color,
          width,
        };
        layerRef.current!.batchDraw();
        return;
      }
    }

    // Crayon, surligneur, gomme pixel
    const width = st.widths[t];
    const isEraser = t === "eraser";
    const line = new Konva.Line({
      points: [p.x, p.y, p.x, p.y],
      stroke: isEraser ? "#000" : st.color,
      strokeWidth: width,
      lineCap: "round",
      lineJoin: "round",
      tension: 0.4,
      opacity: t === "highlighter" ? 0.4 : 1,
      globalCompositeOperation: isEraser ? "destination-out" : "source-over",
      listening: false,
    });
    layerRef.current!.add(line);
    drawing.current = {
      kind: "draw",
      pointerId: e.pointerId,
      line,
      points: [p.x, p.y, p.x, p.y],
      tool: t,
      color: st.color,
      width,
    };
    layerRef.current!.batchDraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const sp = getPos(e.clientX, e.clientY);
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, sp);

    // Deux doigts : zoom + déplacement, ancrés sur le milieu des doigts
    const pz = pinch.current;
    if (pz) {
      if (touches.current.size >= 2) {
        const [a, b] = [...touches.current.values()];
        const m = midOf(a, b);
        const v0 = pz.view;
        const s = v0.s * (distOf(a, b) / pz.dist);
        const px = (pz.mid.x - v0.x) / v0.s; // point de page sous le milieu initial
        const py = (pz.mid.y - v0.y) / v0.s;
        useViewStore.getState().setView({ s, x: m.x - px * s, y: m.y - py * s });
      }
      return;
    }

    // Outil Main / Espace / bouton du milieu
    const pn = panning.current;
    if (pn && e.pointerId === pn.pointerId) {
      useViewStore.getState().setView({
        s: pn.view.s,
        x: pn.view.x + sp.x - pn.start.x,
        y: pn.view.y + sp.y - pn.start.y,
      });
      return;
    }

    const d = drawing.current;
    if (!d || e.pointerId !== d.pointerId) return;

    const coalesced = e.nativeEvent.getCoalescedEvents?.();
    const events = coalesced && coalesced.length ? coalesced : [e.nativeEvent];
    const last = events[events.length - 1];

    if (d.kind === "shape") {
      d.end = screenToPage(getPos(last.clientX, last.clientY));
      d.constrain = e.shiftKey;
      updatePreviewNode(d.node, d.shape, computeShape(d.shape, d.start, d.end, d.constrain));
      layerRef.current!.batchDraw();
      return;
    }

    if (d.kind === "ruled") {
      d.end = screenToPage(projectOnGuide(d.guide, getPos(last.clientX, last.clientY), d.offset));
      d.line.points([d.start.x, d.start.y, d.end.x, d.end.y]);
      layerRef.current!.batchDraw();
      return;
    }

    const minStep = 1.5 / useViewStore.getState().s; // ≈ 1,5 px à l'écran
    for (const ev of events) {
      const pos = getPos(ev.clientX, ev.clientY);
      if (d.kind === "erase") {
        eraseAt(d, pos.x, pos.y);
      } else {
        const { x, y } = screenToPage(pos);
        const n = d.points.length;
        if (Math.hypot(x - d.points[n - 2], y - d.points[n - 1]) > minStep) d.points.push(x, y);
      }
    }
    if (d.kind === "draw") {
      d.line.points(d.points.slice());
      layerRef.current!.batchDraw();
    }
  };

  const endStroke = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drawing.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drawing.current = null;
    if (d.kind === "erase") return;

    const preview = previewOf(d);

    if (!cancelled) {
      const { addObject } = useBoardStore.getState();
      const base = { id: nanoid(), x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };

      if (d.kind === "draw") {
        addObject({ ...base, kind: "stroke", tool: d.tool, points: d.points, color: d.color, width: d.width });
      } else if (d.kind === "ruled") {
        if (Math.hypot(d.end.x - d.start.x, d.end.y - d.start.y) >= 2) {
          addObject({
            ...base,
            kind: "stroke",
            tool: d.tool,
            points: [d.start.x, d.start.y, d.end.x, d.end.y],
            color: d.color,
            width: d.width,
          });
        }
      } else {
        const g = computeShape(d.shape, d.start, d.end, d.constrain);
        if (Math.hypot(g.w, g.h) >= 4) {
          addObject({ ...base, kind: "shape", shape: d.shape, ...g, color: d.color, width: d.width });
        }
      }
    }
    // On retire le nœud provisoire une fois le rendu React effectué
    requestAnimationFrame(() => {
      preview.destroy();
      layerRef.current?.batchDraw();
    });
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (e.pointerType === "touch") {
      touches.current.delete(e.pointerId);
      if (pinch.current) {
        if (touches.current.size < 2) {
          pinch.current = null;
          setPinching(false);
        }
        return; // un doigt restant après un pincement ne dessine rien
      }
    }
    if (panning.current && e.pointerId === panning.current.pointerId) {
      panning.current = null;
      return;
    }
    endStroke(e, cancelled);
  };

  // --- Drag & drop de fichiers image
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  // --- Props communes à tous les objets
  const { select, updateObject, startEditText } = useBoardStore.getState();

  const common = (o: BoardObject) => ({
    id: o.id,
    name: "obj",
    x: o.x,
    y: o.y,
    scaleX: o.scaleX,
    scaleY: o.scaleY,
    rotation: o.rotation,
    draggable: isSelect && !pinching,
    onMouseDown: () => isSelect && select(o.id),
    onTouchStart: () => isSelect && select(o.id),
    onDragEnd: (e: KEvt) => updateObject(o.id, { x: e.target.x(), y: e.target.y() }),
    onTransformEnd: (e: KEvt) => {
      const n = e.target;
      if (o.kind === "stroke") {
        updateObject(o.id, {
          x: n.x(),
          y: n.y(),
          scaleX: n.scaleX(),
          scaleY: n.scaleY(),
          rotation: n.rotation(),
        });
        return;
      }
      const sx = n.scaleX();
      const sy = n.scaleY();
      n.scaleX(1);
      n.scaleY(1);
      if (o.kind === "text") {
        // Coins : la police grandit avec la zone (les poignées latérales n'ont changé que la largeur)
        updateObject(o.id, {
          x: n.x(),
          y: n.y(),
          rotation: n.rotation(),
          w: Math.max(MIN_TEXT_W, n.width() * sx),
          fontSize: clampFontSize(o.fontSize * sy),
        });
        return;
      }
      // Formes et images : l'échelle est intégrée dans w/h
      updateObject(o.id, { x: n.x(), y: n.y(), rotation: n.rotation(), w: o.w * sx, h: o.h * sy, scaleX: 1, scaleY: 1 });
    },
  });

  // strokeScaleEnabled = false : Konva trace en pixels écran, sans l'échelle du calque ni celle de l'objet.
  // L'épaisseur (pixels de page) est donc convertie ici, pour rester celle de l'aperçu et de l'export.
  const screenWidth = (width: number) => width * view.s;
  const hit = (width: number) => Math.max(screenWidth(width), 24); // zone de saisie ≥ 24 px à l'écran

  const renderObject = (o: BoardObject) => {
    const c = common(o);

    if (o.kind === "stroke") {
      const isEraserStroke = o.tool === "eraser";
      return (
        <Line
          key={o.id}
          {...c}
          name={isEraserStroke ? "eraser" : "obj"}
          points={o.points}
          stroke={isEraserStroke ? "#000" : o.closed ? undefined : o.color}
          fill={o.closed ? o.color : undefined}
          closed={o.closed}
          strokeWidth={screenWidth(o.width)}
          strokeScaleEnabled={false}
          hitStrokeWidth={hit(o.width)}
          lineCap="round"
          lineJoin="round"
          tension={o.closed ? 0 : 0.4}
          opacity={o.tool === "highlighter" ? 0.4 : 1}
          globalCompositeOperation={isEraserStroke ? "destination-out" : "source-over"}
          listening={!isEraserStroke}
          draggable={isSelect && !pinching && !isEraserStroke}
        />
      );
    }

    if (o.kind === "shape") {
      const base = {
        ...c,
        stroke: o.color,
        strokeWidth: screenWidth(o.width),
        strokeScaleEnabled: false,
        hitStrokeWidth: hit(o.width),
        lineCap: "round" as const,
        lineJoin: "round" as const,
      };
      // Intérieur saisissable uniquement en mode Sélection
      const hitFill = isSelect ? "transparent" : undefined;

      switch (o.shape) {
        case "line":
          return <Line key={o.id} {...base} points={[0, 0, o.w, o.h]} />;
        case "arrow":
          return (
            <Arrow
              key={o.id}
              {...base}
              points={[0, 0, o.w, o.h]}
              fill={o.color}
              pointerLength={arrowSize(o.width)}
              pointerWidth={arrowSize(o.width)}
            />
          );
        case "rect":
          return <Rect key={o.id} {...base} width={o.w} height={o.h} fill={o.fill ?? hitFill} />;
        case "ellipse":
          return <Ellipse key={o.id} {...base} radiusX={o.w / 2} radiusY={o.h / 2} fill={o.fill ?? hitFill} />;
        case "triangle":
          return <Line key={o.id} {...base} points={trianglePoints(o.w, o.h)} closed fill={o.fill ?? hitFill} />;
      }
    }

    if (o.kind === "text") {
      return (
        <KText
          key={o.id}
          {...c}
          {...textAttrs(o)}
          visible={o.id !== editingId} // pendant l'édition, c'est le champ de saisie qui s'affiche
          onDblClick={() => isSelect && startEditText(o.id)}
          onDblTap={() => isSelect && startEditText(o.id)}
          onTransform={(e: KEvt) => {
            // Poignées latérales : on change la largeur de retour à la ligne, sans étirer les lettres
            const anchor = trRef.current?.getActiveAnchor();
            if (anchor !== "middle-left" && anchor !== "middle-right") return;
            const n = e.target;
            n.setAttrs({ width: Math.max(MIN_TEXT_W, n.width() * n.scaleX()), scaleX: 1 });
          }}
        />
      );
    }

    if (o.kind === "video") {
      // Le lecteur est sous le canvas (VideosLayer) : ce rectangle sert à la saisie et aux poignées
      const follow = (e: KEvt) => {
        const n = e.target;
        setLiveVideo({ id: o.id, x: n.x(), y: n.y(), w: o.w * n.scaleX(), h: o.h * n.scaleY(), rotation: n.rotation() });
      };
      const enter = () => isSelect && useBoardStore.getState().setInteracting(o.id);
      return (
        <Rect
          key={o.id}
          {...c}
          width={o.w}
          height={o.h}
          fill="transparent"
          onDragMove={follow}
          onTransform={follow}
          onDragEnd={(e: KEvt) => {
            c.onDragEnd(e);
            setLiveVideo(null);
          }}
          onTransformEnd={(e: KEvt) => {
            c.onTransformEnd(e);
            setLiveVideo(null);
          }}
          onDblClick={enter}
          onDblTap={enter}
        />
      );
    }

    // image
    const img = images.get(o.src);
    if (!img || !img.complete || !img.naturalWidth) return null;
    return <KImage key={o.id} {...c} image={img} width={o.w} height={o.h} />;
  };

  // Les éléments ne sont recalculés que si le contenu, le mode ou le zoom changent
  // (un simple déplacement de la page ne les touche pas).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const elements = useMemo(() => objects.map(renderObject), [objects, isSelect, pinching, editingId, view.s, imgVersion]);

  return (
    <div
      ref={containerRef}
      data-board
      className="absolute inset-0 bg-slate-300"
      style={{
        touchAction: "none",
        cursor: isPan || spaceHeld ? "grab" : isSelect ? "default" : tool === "text" ? "text" : "crosshair",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => onPointerEnd(e, false)}
      onPointerCancel={(e) => onPointerEnd(e, true)}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files);
        const at = getPos(e.clientX, e.clientY);
        void importImageFiles(files, at);
        void importMediaFiles(files, at);
      }}
    >
      {/* La page : fond à l'échelle d'affichage, marges grises autour */}
      <div
        className="pointer-events-none absolute shadow-2xl"
        style={{
          left: view.x,
          top: view.y,
          width: PAGE_W * view.s,
          height: PAGE_H * view.s,
          ...backgroundStyle(page.background, view.s),
        }}
      />

      <VideosLayer videos={videos} view={view} live={liveVideo} interactingId={interactingId} />

      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        style={{ position: "relative", pointerEvents: interactingId ? "none" : undefined }}
        onMouseDown={(e) => e.target === e.target.getStage() && select(null)}
        onTouchStart={(e) => e.target === e.target.getStage() && select(null)}
      >
        {/* Calque des objets : coordonnées de page, mis à l'échelle et rogné aux bords de la page.
            La gomme "pixel" n'agit que sur ce calque. */}
        <Layer
          ref={layerRef}
          x={view.x}
          y={view.y}
          scaleX={view.s}
          scaleY={view.s}
          clipX={0}
          clipY={0}
          clipWidth={PAGE_W}
          clipHeight={PAGE_H}
        >
          {elements}
        </Layer>

        {/* Calque UI à l'échelle 1 : les poignées gardent une taille tactile constante */}
        <Layer>
          <Transformer
            ref={trRef}
            rotateEnabled
            flipEnabled={false}
            keepRatio={selectedObj?.kind === "image" || selectedObj?.kind === "text" || selectedObj?.kind === "video"}
            enabledAnchors={selectedObj?.kind === "text" ? TEXT_ANCHORS : ALL_ANCHORS}
            anchorSize={22}
            rotateAnchorOffset={36}
            borderStroke="#2563eb"
            anchorStroke="#2563eb"
            anchorCornerRadius={11}
          />
        </Layer>
      </Stage>

      <PlayButtons videos={videos} view={view} live={liveVideo} interactingId={interactingId} />

      {isSelect && selectedObj?.kind === "video" && interactingId !== selectedObj.id && (
        <VideoBar o={selectedObj} view={view} live={liveVideo} />
      )}
    </div>
  );
}

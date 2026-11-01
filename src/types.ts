export type ShapeTool = "line" | "arrow" | "rect" | "ellipse";
export type Tool = "select" | "pan" | "text" | "pen" | "highlighter" | "eraser" | ShapeTool;
export type EraserMode = "object" | "pixel";
export type BackgroundType = "blank" | "black" | "grid" | "seyes" | "lines" | "staff";

/** Clé de la largeur de trait mémorisée dans le store (les 4 formes partagent "shape"). */
export type WidthKey = "pen" | "highlighter" | "eraser" | "shape";

export const SHAPE_TOOLS: ShapeTool[] = ["line", "arrow", "rect", "ellipse"];
export const isShapeTool = (t: Tool): t is ShapeTool => (SHAPE_TOOLS as string[]).includes(t);
export const widthKeyOf = (t: Tool): WidthKey | null =>
  t === "select" || t === "pan" || t === "text" ? null : isShapeTool(t) ? "shape" : t;

interface Transform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export interface StrokeObject extends Transform {
  id: string;
  kind: "stroke";
  tool: "pen" | "highlighter" | "eraser";
  points: number[];
  color: string;
  width: number;
  closed?: true; // contour plein, sans trait : ce que devient un tracé réécrit par OpenBoard
}

/**
 * Forme vectorielle.
 * - line / arrow : (x, y) = point de départ, (w, h) = vecteur vers le point d'arrivée
 * - rect         : (x, y) = coin haut-gauche, w × h
 * - ellipse      : (x, y) = centre, w × h = diamètres
 * - triangle     : (x, y) = coin haut-gauche de son cadre, w × h ; pas d'outil, vient des fichiers importés
 */
export interface ShapeObject extends Transform {
  id: string;
  kind: "shape";
  shape: ShapeTool | "triangle";
  w: number;
  h: number;
  color: string;
  width: number;
  fill?: string; // absent : forme vide
}

export interface ImageObject extends Transform {
  id: string;
  kind: "image";
  src: string; // data URL (PNG/JPEG), les SVG sont rastérisés à l'import
  w: number;
  h: number;
}

/** Zone de texte : (x, y) = coin haut-gauche, w = largeur de retour à la ligne (la hauteur suit le contenu). */
export interface TextObject extends Transform {
  id: string;
  kind: "text";
  text: string;
  w: number;
  fontSize: number;
  color: string;
  // Style d'un texte importé ; l'outil Texte n'utilise que les valeurs par défaut
  font?: string;
  bold?: true;
  italic?: true;
  underline?: true;
  align?: "center" | "right";
}

/**
 * Vidéo ou son : (x, y) = coin haut-gauche, w × h. L'objet s'affiche sous le calque de dessin,
 * donc les annotations restent visibles par-dessus pendant la lecture.
 * Le contenu d'un fichier est rangé dans le document enregistré ; `name` reste son nom d'origine.
 */
export interface VideoObject extends Transform {
  id: string;
  kind: "video";
  source: { type: "file"; mediaId: string; name: string } | { type: "url"; url: string };
  audio?: true; // fichier son : un cadre avec ses commandes plutôt qu'une image
  poster?: string; // data URL JPEG : aperçu, vignette et export
  w: number;
  h: number;
}

export type BoardObject = StrokeObject | ShapeObject | ImageObject | TextObject | VideoObject;

export interface Page {
  id: string;
  objects: BoardObject[];
  background: BackgroundType;
}

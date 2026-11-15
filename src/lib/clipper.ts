/** Envoltorio de Clipper (booleanos y offsets robustos) en milímetros. */

import ClipperLib from "clipper-lib";
import type { Contour, Pt, SvgFillRule } from "../types";
import { contourArea, dedupe, simplifyRDP } from "./geom";

export const SCALE = 1000; // 1 µm de precisión

export type ClipperPath = Array<{ X: number; Y: number }>;
export type ClipperPaths = ClipperPath[];

export function toClipper(cs: Contour[]): ClipperPaths {
  return cs
    .filter((c) => c.length >= 3)
    .map((c) => c.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })));
}

export function fromClipper(paths: ClipperPaths, simplifyTol = 0): Contour[] {
  return paths
    .map((path) => {
      const pts: Pt[] = path.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE }));
      return simplifyTol > 0 ? simplifyRDP(pts, simplifyTol) : dedupe(pts, 1e-5);
    })
    .filter((c) => c.length >= 3 && Math.abs(contourArea(c)) > 1e-5);
}

const CLIPPER_ENUMS: Record<string, string> = {
  ptSubject: "PolyType",
  ptClip: "PolyType",
  ctUnion: "ClipType",
  ctIntersection: "ClipType",
  ctDifference: "ClipType",
  pftNonZero: "PolyFillType",
  pftEvenOdd: "PolyFillType",
  jtRound: "JoinType",
  jtMiter: "JoinType",
  etClosedPolygon: "EndType",
  etClosedLine: "EndType",
  etOpenRound: "EndType",
  etOpenSquare: "EndType",
  etOpenButt: "EndType",
};

function clipperConst(name: string): any {
  const group = CLIPPER_ENUMS[name];
  if (group && (ClipperLib as any)[group]) return (ClipperLib as any)[group][name];
  return (ClipperLib as any)[name];
}

/** Unión de varios conjuntos de contornos. */
export function unionContours(sets: Contour[][], rule: SvgFillRule = "nonzero"): Contour[] {
  const all: ClipperPaths = [];
  for (const cs of sets) all.push(...toClipper(cs));
  if (!all.length) return [];
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(all, clipperConst("ptSubject"), true);
  const solution: ClipperPaths = [];
  clipper.Execute(
    clipperConst("ctUnion"),
    solution,
    rule === "evenodd" ? clipperConst("pftEvenOdd") : clipperConst("pftNonZero"),
    clipperConst("pftNonZero"),
  );
  return fromClipper(solution);
}

/** Limpia un conjunto de contornos respetando su regla de relleno. */
export function cleanContours(cs: Contour[], rule: SvgFillRule = "nonzero"): Contour[] {
  const paths = toClipper(cs);
  if (!paths.length) return [];
  try {
    const simplified = ClipperLib.Clipper.SimplifyPolygons(
      paths,
      rule === "evenodd" ? clipperConst("pftEvenOdd") : clipperConst("pftNonZero"),
    ) as ClipperPaths;
    const cleaned = ClipperLib.Clipper.CleanPolygons(simplified, 0.005 * SCALE) as ClipperPaths;
    return fromClipper(cleaned, 0.002);
  } catch {
    return fromClipper(paths, 0.002);
  }
}

/** Área real (con huecos) de un conjunto normalizado. */
export function clipperArea(cs: Contour[]): number {
  return Math.abs(ClipperLib.Clipper.Area(toClipper(cs)) / (SCALE * SCALE));
}

/** Asegura exterior positivo y huecos negativos usando el árbol de Clipper. */
export function normalizeOrientation(cs: Contour[]): Contour[] {
  const paths = toClipper(cs);
  if (!paths.length) return [];
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(paths, clipperConst("ptSubject"), true);
  const tree = new ClipperLib.PolyTree();
  clipper.Execute(clipperConst("ctUnion"), tree, clipperConst("pftNonZero"), clipperConst("pftNonZero"));
  const out: Contour[] = [];
  const walk = (node: any, depth: number) => {
    const contour = node.Contour ? node.Contour() : [];
    if (contour && contour.length >= 3) {
      const c = fromClipper([contour], 0.002)[0];
      if (c) out.push(ensureWinding(c, depth % 2 === 0));
    }
    const childs = node.Childs ? node.Childs() : [];
    for (const ch of childs) walk(ch, depth + 1);
  };
  const childs = tree.Childs ? tree.Childs() : [];
  for (const ch of childs) walk(ch, 0);
  if (!out.length) return fromClipper(paths, 0.002);
  return out;
}

function ensureWinding(c: Contour, positive: boolean): Contour {
  const a = contourArea(c);
  if ((positive && a < 0) || (!positive && a > 0)) return c.slice().reverse();
  return c;
}

/**
 * Expande (delta > 0) o contrae (delta < 0) un conjunto de contornos.
 * Los huecos se contrarrestan automáticamente si su orientación es la correcta.
 * `join` redondeado o inglete.
 */
export function offsetContours(
  cs: Contour[],
  delta: number,
  join: "round" | "miter" = "round",
  arcTolerance = 0.05,
): Contour[] {
  if (!cs.length || Math.abs(delta) < 1e-6) return cs;
  const normalized = normalizeOrientation(cs);
  const co = new ClipperLib.ClipperOffset(
    join === "miter" ? 3 : 2.5,
    Math.max(0.01, arcTolerance) * SCALE,
  );
  co.AddPaths(
    toClipper(normalized),
    join === "miter" ? clipperConst("jtMiter") : clipperConst("jtRound"),
    clipperConst("etClosedPolygon"),
  );
  const solution: ClipperPaths = [];
  co.Execute(solution, delta * SCALE);
  return normalizeOrientation(fromClipper(solution, 0.003));
}

function toClipperOpen(cs: Contour[]): ClipperPaths {
  return cs
    .filter((c) => c.length >= 2)
    .map((c) => c.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })));
}

/** Contorno del trazo de una polilínea (para SVG con stroke y sin relleno). */
export function strokeOutline(
  polylines: Contour[],
  widthMm: number,
  closed = false,
  cap: "round" | "square" | "butt" = "round",
): Contour[] {
  if (widthMm <= 0 || !polylines.length) return [];
  const co = new ClipperLib.ClipperOffset(2.5, 0.02 * SCALE);
  const endType =
    cap === "round"
      ? clipperConst("etOpenRound")
      : cap === "square"
        ? clipperConst("etOpenSquare")
        : clipperConst("etOpenButt");
  co.AddPaths(
    toClipperOpen(polylines),
    clipperConst("jtRound"),
    closed ? clipperConst("etClosedLine") : endType,
  );
  const sol: ClipperPaths = [];
  co.Execute(sol, (widthMm / 2) * SCALE);
  return unionContours([fromClipper(sol, 0.003)]);
}

/** Intersección de dos conjuntos (para recortar solapes). */
export function intersectContours(a: Contour[], b: Contour[]): Contour[] {
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(toClipper(a), clipperConst("ptSubject"), true);
  clipper.AddPaths(toClipper(b), clipperConst("ptClip"), true);
  const sol: ClipperPaths = [];
  clipper.Execute(clipperConst("ctIntersection"), sol, clipperConst("pftNonZero"), clipperConst("pftNonZero"));
  return fromClipper(sol);
}

/** Diferencia a menos b. */
export function differenceContours(a: Contour[], b: Contour[]): Contour[] {
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(toClipper(a), clipperConst("ptSubject"), true);
  clipper.AddPaths(toClipper(b), clipperConst("ptClip"), true);
  const sol: ClipperPaths = [];
  clipper.Execute(clipperConst("ctDifference"), sol, clipperConst("pftNonZero"), clipperConst("pftNonZero"));
  return fromClipper(sol);
}

export function contoursIntersect(a: Contour[], b: Contour[]): boolean {
  return intersectContours(a, b).length > 0;
}

/** Simplifica contornos para el archivo final, conservando la forma. */
export function simplifyForExport(cs: Contour[], tolerance = 0.03): Contour[] {
  return cs
    .map((c) => simplifyRDP(c, tolerance))
    .filter((c) => c.length >= 3 && Math.abs(contourArea(c)) > 1e-5);
}

/** Convierte cualquier conjunto en una representación con huecos correctos. */
export function canonical(cs: Contour[]): Contour[] {
  if (!cs.length) return [];
  return normalizeOrientation(cleanContours(cs, "nonzero"));
}

/** Infla una pieza por kerf (mitad por lado). */
export function applyKerf(cs: Contour[], kerf: number): Contour[] {
  if (kerf <= 0) return cs;
  return offsetContours(cs, kerf / 2, "round", 0.03);
}

export function pointInPolygons(p: Pt, cs: Contour[]): boolean {
  let inside = false;
  for (const c of cs) {
    const poly: ClipperPath = c.map((q) => ({ X: q.x * SCALE, Y: q.y * SCALE }));
    if (ClipperLib.Clipper.PointInPolygon({ X: p.x * SCALE, Y: p.y * SCALE }, poly) !== 0) {
      inside = !inside;
    }
  }
  return inside;
}

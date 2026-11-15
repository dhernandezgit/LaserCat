/** Piezas de ejemplo para que la primera visita no esté vacía. */

import type { Contour, Part, Pt } from "../types";
import { cleanContours, normalizeOrientation } from "./clipper";
import {
  circleContour,
  contoursBounds,
  dedupe,
  rectContour,
  smoothClosed,
  translateContours,
} from "./geom";

export function uid(prefix = "id"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizePart(contours: Contour[]): { contours: Contour[]; width: number; height: number } {
  const clean = normalizeOrientation(cleanContours(contours, "nonzero"));
  const b = contoursBounds(clean);
  const shifted = translateContours(clean, -b.x, -b.y);
  return { contours: shifted, width: b.w, height: b.h };
}

function catSilhouette(): Contour {
  const raw: Pt[] = [
    { x: 0, y: 48 },
    { x: 20, y: 42 },
    { x: 34, y: 28 },
    { x: 40, y: 6 },
    { x: 37, y: -16 },
    { x: 28, y: -30 },
    { x: 26, y: -44 }, // oreja derecha
    { x: 13, y: -34 },
    { x: 4, y: -36 },
    { x: 0, y: -35 },
    { x: -4, y: -36 },
    { x: -13, y: -34 },
    { x: -26, y: -44 }, // oreja izquierda
    { x: -28, y: -30 },
    { x: -37, y: -16 },
    { x: -40, y: 6 },
    { x: -34, y: 28 },
    { x: -20, y: 42 },
  ];
  // más resolución en el contorno para un corte suave
  const denser: Pt[] = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    const b = raw[(i + 1) % raw.length];
    denser.push(a);
    denser.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  return smoothClosed(denser, 1);
}

function star(points: number, rOuter: number, rInner: number): Contour {
  const out: Contour = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const r = i % 2 === 0 ? rOuter : rInner;
    out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return dedupe(out);
}

function roundedRect(w: number, h: number, r: number): Contour {
  const pts: Pt[] = [];
  const steps = 10;
  const arc = (cx: number, cy: number, a0: number, a1: number) => {
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
  };
  arc(w - r, r, -Math.PI / 2, 0);
  arc(w - r, h - r, 0, Math.PI / 2);
  arc(r, h - r, Math.PI / 2, Math.PI);
  arc(r, r, Math.PI, (3 * Math.PI) / 2);
  return pts;
}

function makePart(
  name: string,
  contours: Contour[],
  operation: "cut" | "engrave" | "score",
  offsetMm: number,
  copies: number,
  color: string,
): Part {
  const norm = normalizePart(contours);
  return {
    id: uid("demo"),
    name,
    kind: "vector",
    contours: norm.contours,
    width: norm.width,
    height: norm.height,
    operation,
    offsetMm,
    separateBorder: false,
    copies,
    source: "demo",
    color,
  };
}

/** Devuelve las piezas de la plancha de bienvenida. */
export function demoParts(): Part[] {
  const cat = catSilhouette();
  const catPart = makePart("Pegatina gatito", [cat], "cut", 2.5, 3, "#b5651d");

  const tag = roundedRect(58, 24, 5);
  const tagHole = circleContour(8, 12, 2.4, 32);
  const plaque = makePart("Placa grabada", [tag, tagHole], "engrave", 2.5, 2, "#2e6f6b");

  const s = star(5, 23, 10);
  const starPart = makePart("Llavero estrella", [s], "cut", 1.5, 5, "#8a4f7d");

  const hex: Contour = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    hex.push({ x: Math.cos(a) * 42, y: Math.sin(a) * 42 });
  }
  const hexPart = makePart("Posavasos hexágono", [hex], "cut", 0, 2, "#4b6b8a");
  return [catPart, plaque, starPart, hexPart];
}

/** Rectángulo sencillo como pieza (útil para botones "añadir forma"). */
export function shapePart(kind: "rect" | "circle" | "hex" | "star", w = 50, h = 40): Part {
  let c: Contour;
  if (kind === "circle") c = circleContour(w / 2, w / 2, w / 2, 64);
  else if (kind === "hex") {
    c = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      c.push({ x: w / 2 + (Math.cos(a) * w) / 2, y: h / 2 + (Math.sin(a) * h) / 2 });
    }
  } else if (kind === "star") {
    c = star(5, w / 2, w / 4);
  } else {
    c = rectContour(0, 0, w, h);
  }
  return makePart(
    kind === "rect" ? "Rectángulo" : kind === "circle" ? "Círculo" : kind === "hex" ? "Hexágono" : "Estrella",
    [c],
    "cut",
    0,
    1,
    "#7a5230",
  );
}

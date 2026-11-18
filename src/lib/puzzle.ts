/**
 * Puzzle de madera de ejemplo.
 *
 * La plancha se divide en una rejilla y las celdas se agrupan en piezas
 * conectadas. Al cubrir todas las celdas exactamente, la solución siempre
 * ocupa el 100 % de la plancha, sin márgenes, huecos ni solapes.
 */

import type { Contour, Part, Placement } from "../types";
import { cleanContours, normalizeOrientation, unionContours } from "./clipper";
import { uid } from "./demo";
import { contoursBounds, rectContour, translateContours } from "./geom";

const COLS = 10;
const ROWS = 10;
const CELL = 30;
const PIECES_MIN = 14;
const PIECES_MAX = 26;

const COLORS = ["#8a5a32", "#a87343", "#74482a", "#b98a58", "#90653c", "#6d4526", "#c09a6b"];

export interface PuzzleDemo {
  seed: number;
  parts: Part[];
  placements: Placement[];
  /** Número de piezas que finalmente forman el puzzle. */
  pieceCount: number;
}

function randomSeed(): number {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] & 0x7fffffff;
  }
  return Math.floor(Math.random() * 0x7fffffff);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Tiling {
  cells: number[][];
}

/**
 * Reparte la rejilla con un crecimiento aleatorio desde varias semillas.
 * Cada celda se asigna a una semilla vecina, así que todas las piezas son
 * conexas y, al cubrir toda la rejilla, encajan sin dejar huecos.
 */
function makeTiling(rnd: () => number): Tiling {
  const count = COLS * ROWS;
  const target = PIECES_MIN + Math.floor(rnd() * (PIECES_MAX - PIECES_MIN + 1));
  const cells = Array.from({ length: count }, (_, i) => i);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  const seeds = cells.slice(0, target);
  const owner = new Int32Array(count).fill(-1);
  const regions: number[][] = seeds.map((cell, region) => {
    owner[cell] = region;
    return [cell];
  });
  const frontiers: number[][] = seeds.map((cell) => [cell]);
  const active = new Set(regions.map((_, i) => i));
  let assigned = target;

  const neighbors = (i: number): number[] => {
    const c = i % COLS;
    const r = Math.floor(i / COLS);
    const out: number[] = [];
    if (c > 0) out.push(i - 1);
    if (c + 1 < COLS) out.push(i + 1);
    if (r > 0) out.push(i - COLS);
    if (r + 1 < ROWS) out.push(i + COLS);
    return out;
  };

  while (assigned < count && active.size) {
    const ids = Array.from(active);
    const region = ids[Math.floor(rnd() * ids.length)];
    const frontier = frontiers[region];
    // A veces se alarga la última rama en vez de rellenar el contorno: así
    // salen piezas en L, T, U y serpientes, no solo bloques redondos.
    const from = rnd() < 0.45 && frontier.length ? frontier[frontier.length - 1] : frontier[Math.floor(rnd() * frontier.length)];
    const free = neighbors(from).filter((n) => owner[n] < 0);
    if (!free.length) {
      // Quita de la frontera las celdas ya rodeadas.
      const next = frontier.filter((f) => neighbors(f).some((n) => owner[n] < 0));
      frontiers[region] = next;
      if (!next.length) active.delete(region);
      continue;
    }
    const nextCell = free[Math.floor(rnd() * free.length)];
    owner[nextCell] = region;
    regions[region].push(nextCell);
    frontier.push(nextCell);
    assigned++;
  }

  // Cualquier celda que haya quedado encerrada se une a una región vecina.
  if (assigned < count) {
    for (let i = 0; i < count; i++) {
      if (owner[i] >= 0) continue;
      const near = neighbors(i).find((n) => owner[n] >= 0);
      if (near === undefined) continue;
      const region = owner[near];
      owner[i] = region;
      regions[region].push(i);
    }
  }

  return { cells: regions.filter((r) => r.length > 0) };
}

function pieceContours(cells: number[]): { contours: Contour[]; width: number; height: number; x: number; y: number } {
  const squares: Contour[][] = [];
  for (const i of cells) {
    const c = i % COLS;
    const r = Math.floor(i / COLS);
    squares.push([rectContour(c * CELL, r * CELL, CELL, CELL)]);
  }
  let contours = unionContours(squares, "nonzero");
  contours = normalizeOrientation(cleanContours(contours, "nonzero"));
  const b = contoursBounds(contours);
  const shifted = translateContours(contours, -b.x, -b.y);
  return { contours: shifted, width: b.w, height: b.h, x: b.x, y: b.y };
}

/** Comprueba que al menos una pieza tenga un entrante, no solo rectángulos. */
function hasWeirdPiece(cells: number[][]): boolean {
  return cells.some((piece) => {
    let minC = COLS;
    let maxC = -1;
    let minR = ROWS;
    let maxR = -1;
    for (const i of piece) {
      const c = i % COLS;
      const r = Math.floor(i / COLS);
      minC = Math.min(minC, c);
      maxC = Math.max(maxC, c);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
    }
    // Si la caja contiene más celdas que la pieza, tiene un entrante o un
    // hueco: no es un simple rectángulo.
    return (maxC - minC + 1) * (maxR - minR + 1) > piece.length;
  });
}

/**
 * Genera un puzzle resuelto. El mismo seed produce siempre el mismo puzzle.
 * Cada pieza encaja con las demás y juntas llenan la plancha de 300 × 300 mm.
 */
export function makePuzzleDemo(seed = randomSeed()): PuzzleDemo {
  const s = seed & 0x7fffffff;
  const rnd = mulberry32(s);
  let tiling = makeTiling(rnd);
  for (let attempt = 0; attempt < 6 && !hasWeirdPiece(tiling.cells); attempt++) {
    tiling = makeTiling(rnd);
  }
  // Mezcla el orden de las piezas para que las tarjetas no sigan la rejilla.
  for (let i = tiling.cells.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [tiling.cells[i], tiling.cells[j]] = [tiling.cells[j], tiling.cells[i]];
  }

  const parts: Part[] = [];
  const placements: Placement[] = [];
  tiling.cells.forEach((cells, index) => {
    const geo = pieceContours(cells);
    const id = uid("puzzle");
    parts.push({
      id,
      name: `Pieza ${String(index + 1).padStart(2, "0")}`,
      kind: "vector",
      contours: geo.contours,
      width: geo.width,
      height: geo.height,
      operation: "cut",
      offsetMm: 0,
      separateBorder: false,
      copies: 1,
      source: "demo",
      color: COLORS[index % COLORS.length],
      notes: `${cells.length} celdas · encaje exacto`,
    });
    placements.push({
      id: uid("pl"),
      partId: id,
      page: 0,
      x: geo.x,
      y: geo.y,
      angle: 0,
      mirror: false,
      pinned: false,
    });
  });

  return { seed: s, parts, placements, pieceCount: parts.length };
}

export const PUZZLE_SIZE = { cols: COLS, rows: ROWS, cell: CELL, width: COLS * CELL, height: ROWS * CELL };

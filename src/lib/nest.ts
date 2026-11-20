/**
 * Nesting real por forma (no por caja): rasteriza cada pieza a la resolución
 * elegida, dilata el espaciado y prueba posiciones con varias rotaciones y
 * órdenes. Es suficientemente rápido para decenas de piezas en el navegador.
 */

import type {
  Contour,
  NestOptions,
  NestRequestPart,
  NestResult,
  Placement,
  Quality,
  RotationMode,
  PlacementMethod,
} from "../types";
import { clipperArea, intersectContours } from "./clipper";
import { contoursBounds, rotateContours, rotatedSize, translateContours } from "./geom";

export const QUALITY_CELL: Record<Quality, number> = {
  rapida: 2,
  equilibrada: 1.25,
  maxima: 0.95,
};

const QUALITY_BUDGET: Record<Quality, number> = {
  rapida: 2500,
  equilibrada: 7000,
  maxima: 12000,
};

const QUALITY_RUNS: Record<Quality, number> = {
  rapida: 2,
  equilibrada: 5,
  maxima: 8,
};

interface RotShape {
  angle: number;
  contours: Contour[];
  width: number;
  height: number;
  area: number;
  gridW: number;
  gridH: number;
  bits: Uint8Array;
  bitsList: number[];
  pad: number;
  fullW: number;
  fullH: number;
}

interface Instance {
  partIndex: number;
  area: number;
  maxSide: number;
  width: number;
  height: number;
  copies: number;
}

interface BoxRot {
  angle: number;
  w: number;
  h: number;
}

interface BoxPlacement {
  partIndex: number;
  page: number;
  x: number;
  y: number;
  angle: number;
  area: number;
}

interface BoxResult {
  placements: BoxPlacement[];
  pages: number;
  unplaced: number;
  usedArea: number;
  bboxArea: number;
}

interface FreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const BOX_EPS = 1e-6;

function subtractFree(free: FreeRect[], ux: number, uy: number, uw: number, uh: number): FreeRect[] {
  const out: FreeRect[] = [];
  for (const f of free) {
    if (ux >= f.x + f.w - BOX_EPS || ux + uw <= f.x + BOX_EPS ||
        uy >= f.y + f.h - BOX_EPS || uy + uh <= f.y + BOX_EPS) {
      out.push(f);
      continue;
    }
    if (ux > f.x) out.push({ x: f.x, y: f.y, w: ux - f.x, h: f.h });
    if (ux + uw < f.x + f.w) out.push({ x: ux + uw, y: f.y, w: f.x + f.w - (ux + uw), h: f.h });
    if (uy > f.y) out.push({ x: f.x, y: f.y, w: f.w, h: uy - f.y });
    if (uy + uh < f.y + f.h) out.push({ x: f.x, y: uy + uh, w: f.w, h: f.y + f.h - (uy + uh) });
  }
  const kept: FreeRect[] = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    if (a.w <= BOX_EPS || a.h <= BOX_EPS) continue;
    let contained = false;
    for (let j = 0; j < out.length; j++) {
      if (i === j) continue;
      const b = out[j];
      if (a.x >= b.x - BOX_EPS && a.y >= b.y - BOX_EPS &&
          a.x + a.w <= b.x + b.w + BOX_EPS && a.y + a.h <= b.y + b.h + BOX_EPS) {
        contained = true;
        break;
      }
    }
    if (!contained) kept.push(a);
  }
  return kept;
}

function boxRotations(contours: Contour[], angles: number[]): BoxRot[] {
  const out: BoxRot[] = [];
  const b = contoursBounds(contours);
  for (const angle of angles) {
    if (Math.abs(angle % 360) < 1e-6) {
      out.push({ angle, w: b.w, h: b.h });
      continue;
    }
    const rc = rotateContours(contours, angle, b.x + b.w / 2, b.y + b.h / 2);
    const rb = contoursBounds(rc);
    out.push({ angle, w: rb.w, h: rb.h });
  }
  return out;
}

/** MaxRects de cajas: rápido, exacto con 0 separación y sin solapes. */
function packBoxes(
  instances: Instance[],
  rotations: BoxRot[][],
  sheetW: number,
  sheetH: number,
  gap: number,
  sheetsAllowed: number,
): BoxResult {
  const pages: FreeRect[][] = [];
  const placements: BoxPlacement[] = [];
  let unplaced = 0;
  let usedArea = 0;
  const maxPage = (): number => (pages.length ? Math.max(1, pages.length) : 1);
  const open = (): FreeRect[] => {
    const page: FreeRect[] = [{ x: 0, y: 0, w: sheetW, h: sheetH }];
    pages.push(page);
    return page;
  };
  if (!pages.length) open();

  for (const inst of instances) {
    const rots = rotations[inst.partIndex] || [];
    if (!rots.length) {
      unplaced += inst.copies;
      continue;
    }
    for (let copy = 0; copy < inst.copies; copy++) {
      let best: { page: number; rot: BoxRot; x: number; y: number; score: [number, number, number, number] } | null = null;
      for (let p = 0; p < pages.length; p++) {
        const free = pages[p];
        for (const rot of rots) {
          const iw = rot.w + gap;
          const ih = rot.h + gap;
          if (iw > sheetW + BOX_EPS || ih > sheetH + BOX_EPS) continue;
          for (const f of free) {
            if (f.w + BOX_EPS < iw || f.h + BOX_EPS < ih) continue;
            const slackX = f.w - iw;
            const slackY = f.h - ih;
            const score: [number, number, number, number] = [Math.min(slackX, slackY), f.w * f.h, f.y, f.x];
            if (!best || score < best.score) best = { page: p, rot, x: f.x, y: f.y, score };
          }
        }
      }
      if (!best && pages.length < sheetsAllowed) {
        const free = open();
        const p = pages.length - 1;
        for (const rot of rots) {
          const iw = rot.w + gap;
          const ih = rot.h + gap;
          if (iw > sheetW + BOX_EPS || ih > sheetH + BOX_EPS) continue;
          for (const f of free) {
            if (f.w + BOX_EPS < iw || f.h + BOX_EPS < ih) continue;
            const score: [number, number, number, number] = [Math.min(f.w - iw, f.h - ih), f.w * f.h, f.y, f.x];
            if (!best || score < best.score) best = { page: p, rot, x: f.x, y: f.y, score };
          }
        }
      }
      if (!best) {
        unplaced++;
        continue;
      }
      const iw = best.rot.w + gap;
      const ih = best.rot.h + gap;
      pages[best.page] = subtractFree(pages[best.page], best.x, best.y, iw, ih);
      placements.push({
        partIndex: inst.partIndex,
        page: best.page,
        x: best.x,
        y: best.y,
        angle: best.rot.angle,
        area: inst.area,
      });
      usedArea += inst.area;
    }
  }

  // Páginas vacías fuera.
  while (pages.length > 1) {
    const last = pages.length - 1;
    if (placements.some((p) => p.page === last)) break;
    pages.pop();
  }
  const pagesUsed = Math.max(1, pages.length);
  let bboxArea = 0;
  for (let p = 0; p < pagesUsed; p++) {
    let maxX = 0;
    let maxY = 0;
    for (const pl of placements) {
      if (pl.page !== p) continue;
      maxX = Math.max(maxX, pl.x + (rotations[pl.partIndex]?.find((r) => r.angle === pl.angle)?.w || 0));
      maxY = Math.max(maxY, pl.y + (rotations[pl.partIndex]?.find((r) => r.angle === pl.angle)?.h || 0));
    }
    bboxArea += maxX * maxY;
  }
  return { placements, pages: pagesUsed, unplaced, usedArea, bboxArea };
}

interface GridSheet {
  cells: Uint16Array;
  gw: number;
  gh: number;
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

function rasterize(contours: Contour[], cell: number): { gw: number; gh: number; bits: Uint8Array } | null {
  const b = contoursBounds(contours);
  if (b.w <= 0 || b.h <= 0) return null;
  // Evita rejillas absurdas si una pieza es enorme; se marcará sin colocar.
  if (b.w / cell > 4000 || b.h / cell > 4000) return null;
  const gw = Math.max(1, Math.ceil(b.w / cell));
  const gh = Math.max(1, Math.ceil(b.h / cell));
  const bits = new Uint8Array(gw * gh);
  const edges: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const c of contours) {
    for (let i = 0; i < c.length; i++) {
      const a = c[i];
      const d = c[(i + 1) % c.length];
      if (a.y !== d.y) edges.push({ x1: a.x, y1: a.y, x2: d.x, y2: d.y });
    }
  }
  for (let gy = 0; gy < gh; gy++) {
    const y = (gy + 0.5) * cell;
    const xs: number[] = [];
    for (const e of edges) {
      if ((e.y1 <= y && e.y2 > y) || (e.y2 <= y && e.y1 > y)) {
        xs.push(e.x1 + ((y - e.y1) * (e.x2 - e.x1)) / (e.y2 - e.y1));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const from = Math.max(0, Math.ceil(xs[i] / cell - 0.5));
      const to = Math.min(gw - 1, Math.floor(xs[i + 1] / cell - 0.5));
      for (let gx = from; gx <= to; gx++) bits[gy * gw + gx] = 1;
    }
  }
  // Piezas más finas que una celda: al menos ocupan una celda para poder
  // colocarlas y avisar si no caben, en lugar de desaparecer del cálculo.
  if (!bits.some((v) => v)) bits[Math.floor(gh / 2) * gw + Math.floor(gw / 2)] = 1;
  return { gw, gh, bits };
}

function dilateSquare(bits: Uint8Array, gw: number, gh: number, r: number): Uint8Array {
  if (r <= 0) return bits;
  const out = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!bits[y * gw + x]) continue;
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(gh - 1, y + r);
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(gw - 1, x + r);
      for (let yy = y0; yy <= y1; yy++) {
        const off = yy * gw;
        for (let xx = x0; xx <= x1; xx++) out[off + xx] = 1;
      }
    }
  }
  return out;
}

function buildRotation(contours: Contour[], angle: number, cell: number, radiusCells: number): RotShape | null {
  const b = contoursBounds(contours);
  if (b.w <= 0 || b.h <= 0) return null;
  let rotated: Contour[];
  if (Math.abs(angle % 360) < 1e-6) {
    rotated = contours.map((c) => c.map((p) => ({ x: p.x - b.x, y: p.y - b.y })));
  } else {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const rc = rotateContours(contours, angle, cx, cy);
    const rb = contoursBounds(rc);
    rotated = translateContours(rc, -rb.x, -rb.y);
  }
  const rb = contoursBounds(rotated);
  const raster = rasterize(rotated, cell);
  if (!raster) return null;
  const pad = Math.max(1, radiusCells);
  const fullW = raster.gw + pad * 2;
  const fullH = raster.gh + pad * 2;
  const full = new Uint8Array(fullW * fullH);
  for (let y = 0; y < raster.gh; y++) {
    for (let x = 0; x < raster.gw; x++) {
      if (raster.bits[y * raster.gw + x]) full[(y + pad) * fullW + x + pad] = 1;
    }
  }
  const dilated = dilateSquare(full, fullW, fullH, radiusCells);
  const list: number[] = [];
  for (let i = 0; i < dilated.length; i++) if (dilated[i]) list.push(i);
  return {
    angle,
    contours: rotated,
    width: rb.w,
    height: rb.h,
    area: Math.max(1e-4, clipperArea(rotated)),
    gridW: raster.gw,
    gridH: raster.gh,
    bits: dilated,
    bitsList: list,
    pad,
    fullW,
    fullH,
  };
}

function normalAnglesFor(mode: RotationMode): number[] {
  if (mode === "no") return [0];
  return [0, 90, 180, 270];
}

function broadAnglesFor(mode: RotationMode): number[] {
  if (mode === "no") return [0];
  if (mode === "90") return [0, 90, 180, 270];
  // Cualquier ángulo: pasos de 15°, incluyendo diagonales y cuadrantes.
  return Array.from({ length: 24 }, (_, i) => i * 15);
}

interface RunPlacement {
  partIndex: number;
  angle: number;
  gx: number; // celda del origen del bbox de la pieza
  gy: number;
  sheet: number;
  rot: RotShape;
}

interface PinnedRaster {
  partIndex: number;
  angle: number;
  gx: number;
  gy: number;
  x: number;
  y: number;
  page: number;
  rot: RotShape;
}

interface RunResult {
  placements: RunPlacement[];
  sheets: number;
  unplaced: number;
  score: number;
  efficiency: number;
  usedArea: number;
  bboxArea: number;
}

/**
 * La rejilla es una aproximación: una silueta muy fina o inclinada puede
 * colarse entre celdas. Antes de devolver el resultado se comprueban las
 * siluetas vectoriales reales y se retiran las piezas que se solapen.
 */
function guardVectorOverlaps(
  result: RunResult,
  pinned: PinnedRaster[],
  margin: number,
  cell: number,
): RunResult {
  const fresh = result.placements.map((p, i) => {
    const x = Math.round((margin + p.gx * cell) * 100) / 100;
    const y = Math.round((margin + p.gy * cell) * 100) / 100;
    const contours = translateContours(p.rot.contours, x, y);
    const b = contoursBounds(contours);
    return { key: `f${i}`, index: i, page: p.sheet, x, y, contours, b, area: p.rot.area, pinned: false };
  });
  const fixed = pinned.map((p, i) => {
    const contours = translateContours(p.rot.contours, p.x, p.y);
    const b = contoursBounds(contours);
    return { key: `p${i}`, index: i, page: p.page, x: p.x, y: p.y, contours, b, area: p.rot.area, pinned: true };
  });
  const all = [...fresh, ...fixed];
  const removedFresh = new Set<number>();

  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    if (!a.pinned && removedFresh.has(a.index)) continue;
    for (let j = i + 1; j < all.length; j++) {
      const c = all[j];
      if (!c.pinned && removedFresh.has(c.index)) continue;
      if (a.page !== c.page) continue;
      const ox = Math.min(a.b.x + a.b.w, c.b.x + c.b.w) - Math.max(a.b.x, c.b.x);
      const oy = Math.min(a.b.y + a.b.h, c.b.y + c.b.h) - Math.max(a.b.y, c.b.y);
      if (ox <= 0.01 || oy <= 0.01) continue;
      if (clipperArea(intersectContours(a.contours, c.contours)) <= 0.01) continue;
      if (a.pinned && c.pinned) continue;
      // Se retira la pieza móvil; si ambas lo son, la más pequeña.
      if (a.pinned) removedFresh.add(c.index);
      else if (c.pinned) removedFresh.add(a.index);
      else removedFresh.add(a.area <= c.area ? a.index : c.index);
    }
  }

  if (!removedFresh.size) return result;
  const placements = result.placements.filter((_, i) => !removedFresh.has(i));
  const removedArea = result.placements.reduce((sum, p, i) => sum + (removedFresh.has(i) ? p.rot.area : 0), 0);
  const sheets = Math.max(1, ...placements.map((p) => p.sheet + 1), ...pinned.map((p) => p.page + 1));
  const usedArea = Math.max(0, result.usedArea - removedArea);
  return {
    placements,
    sheets,
    unplaced: result.unplaced + removedFresh.size,
    score: result.score,
    efficiency: result.efficiency,
    usedArea,
    bboxArea: result.bboxArea,
  };
}

function placeRun(
  instances: Instance[],
  rotations: RotShape[][],
  sheetW: number,
  sheetH: number,
  cell: number,
  sheetsAllowed: number,
  pinned: PinnedRaster[],
  pinnedArea: number,
  compact: boolean,
  budgetEnd: number,
): RunResult {
  const gw = Math.max(1, Math.floor(sheetW / cell));
  const gh = Math.max(1, Math.floor(sheetH / cell));
  const sheets: GridSheet[] = [];
  const placements: RunPlacement[] = [];
  let unplaced = 0;
  const failed: number[] = [];
  let usedArea = pinnedArea;

  const ensureSheet = (index: number): GridSheet => {
    while (sheets.length <= index) sheets.push({ cells: new Uint16Array(gw * gh), gw, gh });
    return sheets[index];
  };
  const maxPinnedPage = pinned.reduce((m, p) => Math.max(m, p.page), -1);
  if (maxPinnedPage >= 0) ensureSheet(maxPinnedPage);

  const fits = (sheet: GridSheet, rot: RotShape, sx: number, sy: number): boolean => {
    if (sx + rot.pad < 0 || sy + rot.pad < 0) return false;
    if (sx + rot.pad + rot.gridW > sheet.gw || sy + rot.pad + rot.gridH > sheet.gh) return false;
    const cells = sheet.cells;
    const list = rot.bitsList;
    for (let k = 0; k < list.length; k++) {
      const idx = list[k];
      const dx = idx % rot.fullW;
      const dy = (idx / rot.fullW) | 0;
      const x = sx + dx;
      const y = sy + dy;
      if (x < 0 || y < 0 || x >= sheet.gw || y >= sheet.gh) continue;
      if (cells[y * sheet.gw + x]) return false;
    }
    return true;
  };

  const mark = (sheet: GridSheet, rot: RotShape, sx: number, sy: number) => {
    const list = rot.bitsList;
    for (let k = 0; k < list.length; k++) {
      const idx = list[k];
      const dx = idx % rot.fullW;
      const dy = (idx / rot.fullW) | 0;
      const x = sx + dx;
      const y = sy + dy;
      if (x >= 0 && y >= 0 && x < sheet.gw && y < sheet.gh) sheet.cells[y * sheet.gw + x] += 1;
    }
  };

  const unmark = (sheet: GridSheet, rot: RotShape, sx: number, sy: number) => {
    const list = rot.bitsList;
    for (let k = 0; k < list.length; k++) {
      const idx = list[k];
      const dx = idx % rot.fullW;
      const dy = (idx / rot.fullW) | 0;
      const x = sx + dx;
      const y = sy + dy;
      if (x >= 0 && y >= 0 && x < sheet.gw && y < sheet.gh) sheet.cells[y * sheet.gw + x] = Math.max(0, sheet.cells[y * sheet.gw + x] - 1);
    }
  };

  for (const pin of pinned) {
    mark(ensureSheet(pin.page), pin.rot, pin.gx - pin.rot.pad, pin.gy - pin.rot.pad);
  }

  /**
   * Detecta huecos cerrados (por ejemplo el interior de un anillo o una U).
   * Son las zonas libres que no se alcanzan desde el borde de la plancha.
   */
  const findHoles = (sheet: GridSheet): { x0: number; y0: number; x1: number; y1: number; size: number }[] => {
    const { gw: w, gh: h, cells } = sheet;
    const seen = new Uint8Array(w * h);
    const queue: number[] = [];
    const push = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = y * w + x;
      if (seen[i] || cells[i]) return;
      seen[i] = 1;
      queue.push(i);
    };
    for (let x = 0; x < w; x++) {
      push(x, 0);
      push(x, h - 1);
    }
    for (let y = 1; y < h - 1; y++) {
      push(0, y);
      push(w - 1, y);
    }
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head];
      const x = i % w;
      const y = (i / w) | 0;
      push(x - 1, y);
      push(x + 1, y);
      push(x, y - 1);
      push(x, y + 1);
    }

    const holes: { x0: number; y0: number; x1: number; y1: number; size: number }[] = [];
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] || seen[i]) continue;
      const start = i;
      let qh = 0;
      const q: number[] = [start];
      seen[start] = 1;
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      while (qh < q.length) {
        const j = q[qh++];
        const x = j % w;
        const y = (j / w) | 0;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
        const around = [j - 1, j + 1, j - w, j + w];
        for (const n of around) {
          if (n < 0 || n >= cells.length) continue;
          if (seen[n] || cells[n]) continue;
          const nx = n % w;
          if (Math.abs(nx - x) > 1) continue;
          seen[n] = 1;
          q.push(n);
        }
      }
      holes.push({ x0, y0, x1, y1, size: q.length });
    }
    holes.sort((a, b) => a.size - b.size);
    return holes;
  };

  /** Intenta meter una pieza en un hueco cerrado antes de abrir sitio nuevo. */
  const findHoleSpot = (sheet: GridSheet, rots: RotShape[], deadline: number): { rot: RotShape; sx: number; sy: number } | null => {
    if (Date.now() > deadline) return null;
    const holes = findHoles(sheet);
    if (!holes.length) return null;
    for (const hole of holes) {
      for (const rot of rots) {
        if (Date.now() > deadline) return null;
        const minX = hole.x0 - rot.pad;
        const maxX = hole.x1 - rot.pad - rot.gridW + 1;
        const minY = hole.y0 - rot.pad;
        const maxY = hole.y1 - rot.pad - rot.gridH + 1;
        if (minX > maxX || minY > maxY) continue;
        for (let sy = minY; sy <= maxY; sy++) {
          for (let sx = minX; sx <= maxX; sx++) {
            if (fits(sheet, rot, sx, sy)) return { rot, sx, sy };
          }
        }
      }
    }
    return null;
  };

  /**
   * Busca el mejor hueco probando TODAS las rotaciones, no la primera que
   * quepa. Antes, el ángulo 0 casi siempre encontraba un sitio y los demás
   * ángulos nunca se usaban; por eso el aprovechamiento era pobre.
   */
  const findSpot = (sheet: GridSheet, rots: RotShape[], deadline: number): { rot: RotShape; sx: number; sy: number } | null => {
    let best: { rot: RotShape; sx: number; sy: number } | null = null;
    let bestScore = Infinity;
    for (const rot of rots) {
      if (Date.now() > deadline) return best;
      const minX = -rot.pad;
      const minY = -rot.pad;
      const maxX = sheet.gw - rot.pad - rot.gridW;
      const maxY = sheet.gh - rot.pad - rot.gridH;
      let found = false;
      for (let sy = minY; sy <= maxY && !found; sy++) {
        if ((sy & 31) === 0 && Date.now() > deadline) return best;
        for (let sx = minX; sx <= maxX; sx++) {
          if (!fits(sheet, rot, sx, sy)) continue;
          // Prioriza arriba/izquierda; a igualdad, prefiere el ángulo más simple.
          const anglePenalty = rot.angle === 0 ? 0 : rot.angle % 90 === 0 ? 0.25 : 0.5;
          const score = sy * 100000 + sx * 100 + anglePenalty;
          if (score < bestScore) {
            bestScore = score;
            best = { rot, sx, sy };
          }
          found = true;
          break;
        }
      }
    }
    return best;
  };

  for (const inst of instances) {
    const rots = rotations[inst.partIndex];
    if (!rots || !rots.length) {
      unplaced += inst.copies;
      continue;
    }
    for (let copy = 0; copy < inst.copies; copy++) {
      let placed = false;
      for (let s = 0; s < sheets.length; s++) {
        const spot = findHoleSpot(sheets[s], rots, budgetEnd) || findSpot(sheets[s], rots, budgetEnd);
        if (spot) {
          mark(sheets[s], spot.rot, spot.sx, spot.sy);
          placements.push({
            partIndex: inst.partIndex,
            angle: spot.rot.angle,
            gx: spot.sx + spot.rot.pad,
            gy: spot.sy + spot.rot.pad,
            sheet: s,
            rot: spot.rot,
          });
          usedArea += spot.rot.area;
          placed = true;
          break;
        }
      }
      if (!placed && sheets.length < sheetsAllowed) {
        const sheet = ensureSheet(sheets.length);
        const spot = findSpot(sheet, rots, budgetEnd);
        if (spot) {
          mark(sheet, spot.rot, spot.sx, spot.sy);
          placements.push({
            partIndex: inst.partIndex,
            angle: spot.rot.angle,
            gx: spot.sx + spot.rot.pad,
            gy: spot.sy + spot.rot.pad,
            sheet: sheets.length - 1,
            rot: spot.rot,
          });
          usedArea += spot.rot.area;
          placed = true;
        } else {
          sheets.pop();
        }
      }
      if (!placed) failed.push(inst.partIndex);
    }
  }

  // Recoger piezas de planchas extra que quepan en huecos de planchas anteriores.
  if (!pinned.length && sheets.length > 1) {
    for (let s = sheets.length - 1; s > 0; s--) {
      const list = placements.filter((p) => p.sheet === s);
      list.sort((a, b) => a.rot.area - b.rot.area);
      for (const p of list) {
        if (Date.now() > budgetEnd) break;
        const oldSheet = sheets[s];
        unmark(oldSheet, p.rot, p.gx - p.rot.pad, p.gy - p.rot.pad);
        let moved = false;
        for (let t = 0; t < s; t++) {
          const spot = findSpot(sheets[t], rotations[p.partIndex] || [], budgetEnd);
          if (!spot) continue;
          mark(sheets[t], spot.rot, spot.sx, spot.sy);
          p.sheet = t;
          p.angle = spot.rot.angle;
          p.gx = spot.sx + spot.rot.pad;
          p.gy = spot.sy + spot.rot.pad;
          p.rot = spot.rot;
          moved = true;
          break;
        }
        if (!moved) mark(oldSheet, p.rot, p.gx - p.rot.pad, p.gy - p.rot.pad);
      }
    }
    while (sheets.length > 1) {
      const last = sheets.length - 1;
      if (placements.some((p) => p.sheet === last)) break;
      sheets.pop();
    }
  }

  const pages = sheets.length;
  if (compact) {
    // Empuja cada pieza hacia arriba/izquierda sin mover las fijadas.
    for (let s = 0; s < sheets.length; s++) {
      const sheet = sheets[s];
      const list = placements.filter((p) => p.sheet === s);
      for (let pass = 0; pass < 2; pass++) {
        if (Date.now() > budgetEnd) break;
        list.sort((a, b) => b.gy - a.gy || b.gx - a.gx);
        let movedAny = false;
        for (const p of list) {
          if (Date.now() > budgetEnd) break;
          const rot = p.rot;
          let sx = p.gx - rot.pad;
          let sy = p.gy - rot.pad;
          unmark(sheet, rot, sx, sy);
          let moved = false;
          while (sy > -rot.pad && fits(sheet, rot, sx, sy - 1)) { sy--; moved = true; }
          while (sx > -rot.pad && fits(sheet, rot, sx - 1, sy)) { sx--; moved = true; }
          while (sy > -rot.pad && fits(sheet, rot, sx, sy - 1)) { sy--; moved = true; }
          mark(sheet, rot, sx, sy);
          p.gx = sx + rot.pad;
          p.gy = sy + rot.pad;
          if (moved) movedAny = true;
        }
        if (!movedAny) break;
      }
    }
  }
  // Segunda oportunidad: tras compactar, los huecos que han quedado libres
  // se prueban otra vez, empezando por las piezas más pequeñas.
  if (failed.length) {
    failed.sort((a, b) => (instances.find((i) => i.partIndex === a)?.area || 0) - (instances.find((i) => i.partIndex === b)?.area || 0));
    const still: number[] = [];
    for (const partIndex of failed) {
      if (Date.now() > budgetEnd) {
        still.push(partIndex);
        continue;
      }
      const rots = rotations[partIndex] || [];
      let placedAgain = false;
      for (let s = 0; s < sheets.length && !placedAgain; s++) {
        const spot = findHoleSpot(sheets[s], rots, budgetEnd) || findSpot(sheets[s], rots, budgetEnd);
        if (!spot) continue;
        mark(sheets[s], spot.rot, spot.sx, spot.sy);
        placements.push({
          partIndex,
          angle: spot.rot.angle,
          gx: spot.sx + spot.rot.pad,
          gy: spot.sy + spot.rot.pad,
          sheet: s,
          rot: spot.rot,
        });
        usedArea += spot.rot.area;
        placedAgain = true;
      }
      if (!placedAgain) still.push(partIndex);
    }
    unplaced = still.length;
  } else {
    unplaced = 0;
  }

  // Mueve piezas ya colocadas que hayan quedado fuera hacia huecos cerrados
  // que hayan quedado vacíos (por ejemplo, el interior de un anillo).
  if (Date.now() < budgetEnd) {
    for (let s = 0; s < sheets.length && Date.now() < budgetEnd; s++) {
      const sheet = sheets[s];
      const holes = findHoles(sheet);
      if (!holes.length) continue;
      const list = placements.filter((p) => p.sheet === s).sort((a, b) => a.rot.area - b.rot.area);
      for (const p of list) {
        if (Date.now() > budgetEnd) break;
        const oldX = p.gx;
        const oldY = p.gy;
        const oldRot = p.rot;
        unmark(sheet, oldRot, oldX - oldRot.pad, oldY - oldRot.pad);
        const spot = findHoleSpot(sheet, rotations[p.partIndex] || [], budgetEnd);
        const same = spot && spot.rot.angle === oldRot.angle && spot.sx + spot.rot.pad === oldX && spot.sy + spot.rot.pad === oldY;
        if (spot && !same) {
          mark(sheet, spot.rot, spot.sx, spot.sy);
          p.angle = spot.rot.angle;
          p.gx = spot.sx + spot.rot.pad;
          p.gy = spot.sy + spot.rot.pad;
          p.rot = spot.rot;
        } else {
          mark(sheet, oldRot, oldX - oldRot.pad, oldY - oldRot.pad);
        }
      }
    }
  }

  const usable = sheetW * sheetH;
  const efficiency = pages > 0 ? usedArea / (usable * pages) : 0;
  let bboxArea = 0;
  for (let s = 0; s < pages; s++) {
    let maxX = 0;
    let maxY = 0;
    for (const p of placements) {
      if (p.sheet !== s) continue;
      maxX = Math.max(maxX, p.gx * cell + p.rot.width);
      maxY = Math.max(maxY, p.gy * cell + p.rot.height);
    }
    for (const pin of pinned) {
      if (pin.page !== s) continue;
      maxX = Math.max(maxX, pin.gx * cell + pin.rot.width);
      maxY = Math.max(maxY, pin.gy * cell + pin.rot.height);
    }
    bboxArea += maxX * maxY;
  }
  const score = unplaced * 1e9 + pages * 1e7 + bboxArea;
  return { placements, sheets: pages, unplaced, score, efficiency, usedArea, bboxArea };
}

function ordering(instances: Instance[], kind: number, rand: () => number): Instance[] {
  const arr = instances.map((i) => ({ ...i }));
  switch (kind) {
    case 0: return arr.sort((a, b) => b.area - a.area);
    case 1: return arr.sort((a, b) => b.maxSide - a.maxSide);
    case 2: return arr.sort((a, b) => b.height - a.height || b.width - a.width);
    case 3: return arr.sort((a, b) => b.width - a.width || b.height - a.height);
    case 4: return arr.sort((a, b) => b.width * b.height - a.width * a.height);
    default:
      return arr
        .sort((a, b) => b.area - a.area)
        .map((x) => ({ x, r: rand() }))
        .sort((a, b) => a.r - b.r || b.x.area - a.x.area)
        .map((x) => x.x);
  }
}

/**
 * Calcula la colocación óptima. Devuelve posiciones en mm.
 * Las piezas fijadas se conservan y el resto se coloca alrededor.
 */
export function nestParts(parts: NestRequestPart[], options: NestOptions): NestResult {
  const started = Date.now();
  const report = (value: number) => options.onProgress?.(Math.max(0, Math.min(1, value)));
  report(0.01);
  const { sheet } = options;
  let cell = QUALITY_CELL[options.quality];
  if (parts.length > 120) cell = Math.max(cell, 1.2);
  const usableW = Math.max(1, sheet.width - sheet.margin * 2);
  const usableH = Math.max(1, sheet.height - sheet.margin * 2);
  const sheetsAllowed = sheet.singlePage ? 1 : 999;
  const budgetEnd = started + QUALITY_BUDGET[options.quality];
  const comfortable = options.packStyle === "comfortable" || (options.packStyle === undefined && options.compact === false);
  const totalPartArea = parts.reduce((sum, p) => sum + (p.contours.length ? clipperArea(p.contours) : 0) * p.copies, 0);
  const fillRatio = totalPartArea / Math.max(1, usableW * usableH);
  // En trabajos holgados dejamos aire entre piezas; si están apretadas no
  // añadimos separación artificial que podría dejar cosas fuera.
  const comfortMm = comfortable && fillRatio < 0.55
    ? Math.min(8, Math.max(2, Math.min(usableW, usableH) * 0.015))
    : 0;
  // Al menos una celda de seguridad: la rejilla no debe ser la única barrera
  // entre dos vectores que casi se tocan.
  const radius = Math.max(1, Math.ceil((sheet.spacing + sheet.kerf + comfortMm) / 2 / cell));
  const normalAngles = normalAnglesFor(options.rotation);
  const broadAngles = broadAnglesFor(options.rotation);

  const instances: Instance[] = [];
  const rotationCache: RotShape[][] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p.contours.length || p.width <= 0 || p.height <= 0 || p.copies <= 0) continue;
    const angles = p.angles && p.angles.length ? p.angles : normalAngles;
    const rots: RotShape[] = [];
    for (const a of angles) {
      const r = buildRotation(p.contours, a, cell, radius);
      if (r) rots.push(r);
    }
    rotationCache[i] = rots;
    instances.push({
      partIndex: i,
      area: rots[0]?.area || 1,
      maxSide: Math.max(rots[0]?.width || p.width, rots[0]?.height || p.height),
      width: rots[0]?.width || p.width,
      height: rots[0]?.height || p.height,
      copies: Math.max(0, Math.floor(p.copies)),
    });
  }

  // Alternativa por cajas (MaxRects). Es exacta con separación 0 y sirve de
  // red de seguridad para piezas rectangulares o muy grandes que la rejilla
  // no puede representar sin inventarse un hueco.
  const boxCache: BoxRot[][] = [];
  if (!options.pinned.length) {
    const boxAngles = normalAngles;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p.contours.length || p.width <= 0 || p.height <= 0 || p.copies <= 0) continue;
      const angles = p.angles && p.angles.length ? p.angles : boxAngles;
      boxCache[i] = boxRotations(p.contours, angles);
    }
  }

  report(0.1);

  // fijadas: se rasterizan una vez y se marcan en su plancha
  const pinned: PinnedRaster[] = [];
  let pinnedArea = 0;
  for (const pin of options.pinned) {
    const idx = parts.findIndex((p) => p.partId === pin.partId);
    if (idx < 0) continue;
    const rot = buildRotation(parts[idx].contours, pin.angle, cell, radius);
    if (!rot) continue;
    pinned.push({
      partIndex: idx,
      angle: pin.angle,
      gx: Math.round((pin.x - sheet.margin) / cell),
      gy: Math.round((pin.y - sheet.margin) / cell),
      x: pin.x,
      y: pin.y,
      page: Math.max(0, pin.page),
      rot,
    });
    pinnedArea += rot.area;
  }

  const method = options.method ?? "auto";
  const runs = QUALITY_RUNS[options.quality];
  const totalBudget = QUALITY_BUDGET[options.quality];

  const runStage = (cache: RotShape[][], deadline: number, base = 0.12, span = 0.4): RunResult | null => {
    let best: RunResult | null = null;
    const rand = mulberry32(0x1a5e4ca7);
    for (let run = 0; run < runs; run++) {
      if (run > 0 && Date.now() > deadline) break;
      const ordered = method === "greedy"
        ? ordering(instances, 0, rand)
        : method === "largest"
          ? ordering(instances, 1, rand)
          : method === "voronoi"
            ? ordering(instances, 2 + (run % 3), rand)
            : ordering(instances, run, rand);
      const res = placeRun(
        ordered,
        cache,
        usableW,
        usableH,
        cell,
        sheetsAllowed,
        pinned,
        pinnedArea,
        options.compact !== false && options.quality !== "rapida" && pinned.length === 0,
        deadline,
      );
      if (!best || res.score < best.score) best = res;
      report(base + span * ((run + 1) / runs));
    }
    return best;
  };

  // Fase 1: ángulos normales (0/90/180/270). Es la más rápida.
  let bestRun = runStage(rotationCache, started + totalBudget * (options.rotation === "libre" ? 0.45 : 1), 0.12, 0.32);

  // Fase 2: en modo libre probamos también ángulos intermedios de 15°, no
  // solo cuando quede algo sin colocar: a veces mejoran el encaje y el bbox.
  if (options.rotation === "libre" && broadAngles.length > normalAngles.length) {
    const broadCache: RotShape[][] = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p.contours.length || p.width <= 0 || p.height <= 0 || p.copies <= 0) continue;
      const angles = p.angles && p.angles.length ? p.angles : broadAngles;
      const rots: RotShape[] = [];
      for (const a of angles) {
        const r = buildRotation(p.contours, a, cell, radius);
        if (r) rots.push(r);
      }
      if (rots.length) broadCache[i] = rots;
    }
    report(0.52);
    const broad = runStage(broadCache, started + totalBudget, 0.54, 0.4);
    if (broad) {
      const sameScore = bestRun && broad.unplaced === bestRun.unplaced && broad.sheets === bestRun.sheets;
      const preferBroad = !!bestRun && options.rotation === "libre" && sameScore &&
        (comfortable ? broad.bboxArea <= bestRun.bboxArea * 1.6 : broad.bboxArea <= bestRun.bboxArea);
      if (!bestRun || broad.score < bestRun.score || preferBroad) bestRun = broad;
    }
  }

  if (!bestRun) {
    bestRun = {
      placements: [],
      sheets: 0,
      unplaced: instances.reduce((s, i) => s + i.copies, 0),
      score: Infinity,
      efficiency: 0,
      usedArea: pinnedArea,
      bboxArea: 0,
    };
  }
  report(0.94);
  bestRun = guardVectorOverlaps(bestRun, pinned, sheet.margin, cell);

  let boxBest: BoxResult | null = null;
  if (!options.pinned.length && boxCache.some((r) => r && r.length)) {
    const gap = sheet.spacing + sheet.kerf + comfortMm;
    const rand = mulberry32(0x7b0c0de);
    for (let kind = 0; kind < 5; kind++) {
      const ordered = ordering(instances, kind, rand);
      const candidate = packBoxes(ordered, boxCache, usableW, usableH, gap, sheetsAllowed);
      if (
        !boxBest ||
        candidate.unplaced < boxBest.unplaced ||
        (candidate.unplaced === boxBest.unplaced && candidate.pages < boxBest.pages)
      ) {
        boxBest = candidate;
      }
    }
  }
  const shapePages = Math.max(1, bestRun.sheets);
  let shapeBoxArea = 0;
  for (let page = 0; page < shapePages; page++) {
    let maxX = 0;
    let maxY = 0;
    for (const p of bestRun.placements) {
      if (p.sheet !== page) continue;
      maxX = Math.max(maxX, sheet.margin + p.gx * cell + p.rot.width);
      maxY = Math.max(maxY, sheet.margin + p.gy * cell + p.rot.height);
    }
    shapeBoxArea += maxX * maxY;
  }
  const shapeHasBroad = bestRun.placements.some((p) => Math.abs(p.angle % 90) > 0.01);
  const useBox = !!boxBest && (
    boxBest.unplaced < bestRun.unplaced ||
    (boxBest.unplaced === bestRun.unplaced && boxBest.pages < shapePages) ||
    (!shapeHasBroad && boxBest.unplaced === bestRun.unplaced && boxBest.pages === shapePages && boxBest.bboxArea < shapeBoxArea - 0.5)
  );

  const placed: Omit<Placement, "id" | "pinned">[] = [];
  if (useBox && boxBest) {
    for (const p of boxBest.placements) {
      placed.push({
        partId: parts[p.partIndex].partId,
        page: p.page,
        x: Math.round((sheet.margin + p.x) * 100) / 100,
        y: Math.round((sheet.margin + p.y) * 100) / 100,
        angle: p.angle,
        mirror: false,
      });
    }
  } else {
    for (const p of bestRun.placements) {
      placed.push({
        partId: parts[p.partIndex].partId,
        page: p.sheet,
        x: Math.round((sheet.margin + p.gx * cell) * 100) / 100,
        y: Math.round((sheet.margin + p.gy * cell) * 100) / 100,
        angle: p.angle,
        mirror: false,
      });
    }
    for (const pin of options.pinned) {
      placed.push({
        partId: pin.partId,
        page: pin.page,
        x: pin.x,
        y: pin.y,
        angle: pin.angle,
        mirror: pin.mirror,
      });
    }
  }

  const pages = Math.max(1, ...placed.map((p) => p.page + 1));
  const usableArea = usableW * usableH * pages;
  const usedArea = useBox && boxBest ? boxBest.usedArea : bestRun.usedArea;
  if (comfortable && !options.pinned.length && placed.length) {
    const byPart = new Map(parts.map((part) => [part.partId, part]));
    const pageShift = new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>();
    for (const p of placed) {
      const req = byPart.get(p.partId);
      if (!req) continue;
      const size = rotatedSize({ width: req.width, height: req.height }, p.angle);
      const box = pageShift.get(p.page) || { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      box.minX = Math.min(box.minX, p.x);
      box.minY = Math.min(box.minY, p.y);
      box.maxX = Math.max(box.maxX, p.x + size.w);
      box.maxY = Math.max(box.maxY, p.y + size.h);
      pageShift.set(p.page, box);
    }
    for (const p of placed) {
      const box = pageShift.get(p.page);
      if (!box || !Number.isFinite(box.minX)) continue;
      const dx = sheet.margin + (usableW - (box.maxX - box.minX)) / 2 - box.minX;
      const dy = sheet.margin + (usableH - (box.maxY - box.minY)) / 2 - box.minY;
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        p.x = Math.round((p.x + dx) * 100) / 100;
        p.y = Math.round((p.y + dy) * 100) / 100;
      }
    }
  }
  report(1);
  return {
    placements: placed,
    pages,
    unplaced: useBox && boxBest ? boxBest.unplaced : bestRun.unplaced,
    efficiency: Math.min(1, usedArea / Math.max(1e-6, usableArea)),
    usedArea,
    elapsedMs: Date.now() - started,
  };
}

/** Área real de una pieza con huecos descontados. */
export function partArea(contours: Contour[]): number {
  return clipperArea(contours);
}

/** Solo para pruebas: inspecciona la máscara de una pieza. */
export function debugRaster(contours: Contour[], cell: number, radius: number, angle = 0) {
  const rot = buildRotation(contours, angle, cell, radius);
  if (!rot) return null;
  const rowCounts: number[] = [];
  for (let y = 0; y < rot.fullH; y++) {
    let n = 0;
    for (let x = 0; x < rot.fullW; x++) if (rot.bits[y * rot.fullW + x]) n++;
    rowCounts.push(n);
  }
  return {
    gridW: rot.gridW,
    gridH: rot.gridH,
    fullW: rot.fullW,
    fullH: rot.fullH,
    pad: rot.pad,
    bits: rot.bitsList.length,
    rowCounts,
    width: rot.width,
    height: rot.height,
  };
}

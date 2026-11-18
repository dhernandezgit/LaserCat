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
import { clipperArea } from "./clipper";
import { contoursBounds, rotateContours, translateContours } from "./geom";

export const QUALITY_CELL: Record<Quality, number> = {
  rapida: 2,
  equilibrada: 1.25,
  maxima: 0.95,
};

const QUALITY_BUDGET: Record<Quality, number> = {
  rapida: 600,
  equilibrada: 1800,
  maxima: 3200,
};

const QUALITY_RUNS: Record<Quality, number> = {
  rapida: 1,
  equilibrada: 3,
  maxima: 4,
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
  // Si los ángulos normales no bastan, probamos también diagonales.
  return [0, 45, 90, 135, 180, 225, 270, 315];
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
        const spot = findSpot(sheets[s], rots, budgetEnd);
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
      if (!placed) unplaced++;
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
  return { placements, sheets: pages, unplaced, score, efficiency, usedArea };
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
  const { sheet } = options;
  let cell = QUALITY_CELL[options.quality];
  if (parts.length > 120) cell = Math.max(cell, 1.2);
  const usableW = Math.max(1, sheet.width - sheet.margin * 2);
  const usableH = Math.max(1, sheet.height - sheet.margin * 2);
  const sheetsAllowed = sheet.singlePage ? 1 : 999;
  const budgetEnd = started + QUALITY_BUDGET[options.quality];
  const radius = Math.max(0, Math.ceil((sheet.spacing + sheet.kerf) / 2 / cell));
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
      page: Math.max(0, pin.page),
      rot,
    });
    pinnedArea += rot.area;
  }

  const method = options.method ?? "auto";
  const runs = QUALITY_RUNS[options.quality];
  const totalBudget = QUALITY_BUDGET[options.quality];

  const runStage = (cache: RotShape[][], deadline: number): RunResult | null => {
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
    }
    return best;
  };

  // Fase 1: ángulos normales (0/90/180/270). Es la más rápida.
  let bestRun = runStage(rotationCache, started + totalBudget * (options.rotation === "libre" ? 0.62 : 1));

  // Fase 2: si aún queda algo sin colocar, probar diagonales (45/135/225/315).
  if ((!bestRun || bestRun.unplaced > 0) && options.rotation === "libre" && broadAngles.length > normalAngles.length) {
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
    const broad = runStage(broadCache, started + totalBudget);
    if (broad && (!bestRun || broad.score < bestRun.score)) bestRun = broad;
  }

  if (!bestRun) {
    bestRun = {
      placements: [],
      sheets: 0,
      unplaced: instances.reduce((s, i) => s + i.copies, 0),
      score: Infinity,
      efficiency: 0,
      usedArea: pinnedArea,
    };
  }

  const placed: Omit<Placement, "id" | "pinned">[] = [];
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

  const pages = Math.max(1, ...placed.map((p) => p.page + 1));
  const usableArea = usableW * usableH * pages;
  return {
    placements: placed,
    pages,
    unplaced: bestRun.unplaced,
    efficiency: Math.min(1, bestRun.usedArea / Math.max(1e-6, usableArea)),
    usedArea: bestRun.usedArea,
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

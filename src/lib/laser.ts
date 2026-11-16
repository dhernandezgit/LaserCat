/** Máquinas, materiales, capas LightBurn y estimación de tiempos. */

import type {
  Contour,
  Doc,
  LaserPreset,
  MaterialPreset,
  Machine,
  Part,
  Placement,
  SheetStats,
} from "../types";
import { offsetContours, normalizeOrientation, unionContours, clipperArea } from "./clipper";
import {
  contoursBounds,
  contourArea,
  contoursLength,
  rectContour,
  shapeArea,
  translateContours,
} from "./geom";

export const MACHINES: Machine[] = [
  { id: "s30", name: "SculpFun S30 · 10 W", watt: 10, workWidth: 400, workHeight: 400 },
  { id: "s30pro", name: "SculpFun S30 Pro · 20 W", watt: 20, workWidth: 400, workHeight: 400 },
  { id: "s30ultra", name: "SculpFun S30 Ultra · 22 W", watt: 22, workWidth: 600, workHeight: 600 },
  { id: "diode5", name: "Diodo genérico · 5 W", watt: 5, workWidth: 400, workHeight: 400 },
  { id: "co2", name: "CO₂ genérica · 40 W", watt: 40, workWidth: 500, workHeight: 300 },
];

export const MACHINE_BY_ID: Record<string, Machine> = Object.fromEntries(MACHINES.map((m) => [m.id, m]));

/** Factor de velocidad respecto al S30 de 10 W (valores conservadores). */
export function machineSpeedFactor(machineId: string): number {
  switch (machineId) {
    case "s30pro": return 1.75;
    case "s30ultra": return 1.9;
    case "diode5": return 0.55;
    case "co2": return 2.4;
    default: return 1;
  }
}

export function machinePowerFactor(machineId: string): number {
  switch (machineId) {
    case "s30pro": return 0.62;
    case "s30ultra": return 0.55;
    case "diode5": return 1.35;
    case "co2": return 0.4;
    default: return 1;
  }
}

function preset(power: number, speed: number, passes: number, interval: number, notes: string): LaserPreset {
  return { id: "", name: "", power, speed, passes, interval, airAssist: true, notes };
}

export interface MaterialDef extends Omit<MaterialPreset, "cut" | "engrave" | "score"> {
  cut: LaserPreset;
  engrave: LaserPreset;
  score: LaserPreset;
  grain: "fine" | "medium" | "coarse" | "none";
}

export const MATERIALS: MaterialDef[] = [
  {
    id: "tilo",
    name: "Tilo / basswood",
    species: "tilo",
    thickness: 3,
    grain: "fine",
    cut: preset(100, 300, 1, 0.1, "Corte limpio con aire. Baja a 240 mm/min si no atraviesa."),
    engrave: preset(35, 3600, 1, 0.1, "Grabado claro y cálido; ideal para retratos y line art."),
    score: preset(18, 4200, 1, 0.1, "Marca fina sin quemar el borde."),
  },
  {
    id: "abedul",
    name: "Abedul / contrachapado",
    species: "abedul",
    thickness: 3,
    grain: "medium",
    cut: preset(100, 280, 1, 0.1, "El contrachapado puede tener cola; 2 pasadas si hay vetas duras."),
    engrave: preset(38, 3300, 1, 0.1, "Contraste alto; reduce potencia al 30 % para degradados."),
    score: preset(20, 3900, 1, 0.1, "Veta marcada: prueba primero una esquina."),
  },
  {
    id: "roble",
    name: "Roble",
    species: "roble",
    thickness: 4,
    grain: "coarse",
    cut: preset(100, 180, 2, 0.1, "Madera dura: 2 pasadas y aire a tope."),
    engrave: preset(45, 2600, 1, 0.1, "La veta abierta da grabados rústicos muy bonitos."),
    score: preset(25, 3000, 1, 0.1, "Puede astillarse; usa cinta de transferencia."),
  },
  {
    id: "nogal",
    name: "Nogal",
    species: "nogal",
    thickness: 3,
    grain: "medium",
    cut: preset(100, 250, 1, 0.1, "Aceite ligero después del corte para realzar el color."),
    engrave: preset(40, 3000, 1, 0.1, "El grabado se lee mejor con potencia media; evita quemar."),
    score: preset(22, 3600, 1, 0.1, "Marca discreta sobre madera oscura."),
  },
  {
    id: "cerezo",
    name: "Cerezo",
    species: "cerezo",
    thickness: 3,
    grain: "medium",
    cut: preset(100, 260, 1, 0.1, "Corte dulce, con olor característico."),
    engrave: preset(38, 3100, 1, 0.1, "El calor oscurece mucho; prueba 30 %."),
    score: preset(20, 3800, 1, 0.1, "Ideal para marcar nombres y fechas."),
  },
  {
    id: "bambu",
    name: "Bambú",
    species: "bambu",
    thickness: 3,
    grain: "fine",
    cut: preset(100, 200, 2, 0.1, "Denso y fibroso: 2 pasadas, aire constante."),
    engrave: preset(35, 3400, 1, 0.1, "Grabado muy uniforme; cuidado con el charco de calor."),
    score: preset(18, 4000, 1, 0.1, "Marca fina y regular."),
  },
  {
    id: "mdf",
    name: "DM / MDF",
    species: "mdf",
    thickness: 3,
    grain: "none",
    cut: preset(100, 350, 1, 0.1, "Polvo abundante: extrae y limpia la lente después."),
    engrave: preset(42, 3500, 1, 0.1, "Grabado muy oscuro; reduce a 30 % para texto."),
    score: preset(22, 4200, 1, 0.1, "Buen contraste sin quemar."),
  },
  {
    id: "pino",
    name: "Pino",
    species: "pino",
    thickness: 3,
    grain: "coarse",
    cut: preset(100, 380, 1, 0.1, "Blando y resinoso; la resina puede manchar."),
    engrave: preset(32, 4000, 1, 0.1, "Grabado rápido; la resina oscurece las líneas."),
    score: preset(18, 4500, 1, 0.1, "Marca rápida; revisa la veta."),
  },
  {
    id: "carton",
    name: "Cartón",
    species: "carton",
    thickness: 2,
    grain: "none",
    cut: preset(70, 900, 1, 0.1, "Corte rápido y limpio; sin aire para no volar la pieza."),
    engrave: preset(25, 5000, 1, 0.1, "Grabado suave, ideal para prototipos."),
    score: preset(15, 5200, 1, 0.1, "Marca ligera."),
  },
  {
    id: "cuero",
    name: "Cuero vegetal",
    species: "cuero",
    thickness: 2,
    grain: "none",
    cut: preset(60, 500, 1, 0.1, "Olor fuerte; ventila. Prueba retales."),
    engrave: preset(20, 3000, 1, 0.1, "Grabado oscuro y definido."),
    score: preset(12, 3600, 1, 0.1, "Marca sin perforar."),
  },
  {
    id: "acrilico",
    name: "Acrílico negro 3 mm",
    species: "acrilico",
    thickness: 3,
    grain: "none",
    cut: preset(100, 200, 1, 0.1, "Retira el film protector antes de cortar."),
    engrave: preset(30, 3000, 1, 0.1, "El acrílico negro grabado queda gris claro."),
    score: preset(18, 3800, 1, 0.1, "Marca mate."),
  },
];

export const MATERIAL_BY_ID: Record<string, MaterialDef> = Object.fromEntries(MATERIALS.map((m) => [m.id, m]));

export function laserPresetFor(
  materialId: string,
  operation: "cut" | "engrave" | "score",
  machineId: string,
  overrides?: Partial<LaserPreset>,
): LaserPreset {
  const mat = MATERIAL_BY_ID[materialId] || MATERIAL_BY_ID.tilo;
  const base = mat[operation];
  const speed = Math.max(10, Math.round(base.speed * machineSpeedFactor(machineId)));
  const power = Math.max(1, Math.min(100, Math.round(base.power * machinePowerFactor(machineId))));
  return { ...base, speed, power, ...overrides };
}

// ------------------------------------------------------------------ capas --

export const LAYERS = [
  {
    id: "engrave" as const,
    name: "GRABADO",
    color: "#0000ff",
    fill: true,
    description: "Relleno grabado. LightBurn: modo Relleno (Fill).",
  },
  {
    id: "score" as const,
    name: "MARCADO",
    color: "#008000",
    fill: false,
    description: "Línea fina sin atravesar. LightBurn: modo Línea.",
  },
  {
    id: "cut" as const,
    name: "CORTE",
    color: "#000000",
    fill: false,
    description: "Corte pasante. LightBurn: modo Línea, 1 pasada.",
  },
  {
    id: "border" as const,
    name: "BORDE",
    color: "#ff00ff",
    fill: false,
    description: "Corte interior de bordes separados (pegatinas de dos capas).",
  },
  {
    id: "marks" as const,
    name: "MARCAS",
    color: "#ff0000",
    fill: false,
    description: "Marco y marcas de referencia. Puedes ignorar esta capa.",
  },
];

/** Color exacto para que LightBurn cree las capas con nombres claros. */
export const LAYER_COLORS: Record<string, string> = {
  engrave: "#0000FF",
  score: "#008000",
  cut: "#000000",
  border: "#FF00FF",
  marks: "#FF0000",
};

// --------------------------------------------------------------- geometría --

export interface EffectiveGeometry {
  /** Contornos base (diseño original), en el marco del borde exterior. */
  base: Contour[];
  /** Contorno que se corta (con borde de pegatina si lo hay). */
  outer: Contour[];
  /** Caja del diseño base dentro del marco. */
  baseBounds: { x: number; y: number; w: number; h: number };
  width: number;
  height: number;
  hasOffset: boolean;
  /** Solo si separateBorder: el corte interior. */
  innerCut: Contour[];
}

const geomCache = new WeakMap<Part, EffectiveGeometry>();

/** Geometría efectiva de una pieza (borde incluido), cacheada por objeto. */
export function effectiveGeometry(part: Part): EffectiveGeometry {
  const cached = geomCache.get(part);
  if (cached) return cached;
  let base: Contour[];
  if (part.kind === "raster") {
    base = [rectContour(0, 0, Math.max(0.1, part.width), Math.max(0.1, part.height))];
  } else {
    base = part.contours;
  }
  const bb = contoursBounds(base);
  let outer = base;
  let hasOffset = false;
  if (part.offsetMm > 0.01) {
    // El borde expande solo los contornos exteriores: los agujeros
    // (ojos, asas, ventanas) conservan su tamaño original.
    const outers = base.filter((c) => contourArea(c) >= 0);
    const holes = base.filter((c) => contourArea(c) < 0);
    const grown = outers.length ? offsetContours(outers, part.offsetMm, "round", 0.03) : [];
    outer = normalizeOrientation([...grown, ...holes]);
    hasOffset = true;
  }
  const ob = contoursBounds(outer);
  const dx = -ob.x;
  const dy = -ob.y;
  const shiftedBase = translateContours(base, dx, dy);
  const shiftedOuter = translateContours(outer, dx, dy);
  const bb2 = contoursBounds(shiftedBase);
  const result: EffectiveGeometry = {
    base: shiftedBase,
    outer: shiftedOuter,
    baseBounds: bb2,
    width: ob.w,
    height: ob.h,
    hasOffset,
    innerCut: part.separateBorder && hasOffset ? shiftedBase : [],
  };
  geomCache.set(part, result);
  return result;
}

/** Contornos que deben colocarse en la plancha (borde exterior). */
export function packingContours(part: Part): Contour[] {
  return effectiveGeometry(part).outer;
}

export function packingSize(part: Part): { width: number; height: number } {
  const g = effectiveGeometry(part);
  return { width: g.width, height: g.height };
}

export function partOuterArea(part: Part): number {
  return shapeArea(effectiveGeometry(part).outer);
}

// ------------------------------------------------------------------ tiempo --

export interface TimeBreakdown {
  cutSeconds: number;
  engraveSeconds: number;
  scoreSeconds: number;
  travelSeconds: number;
  totalSeconds: number;
  cutLengthMm: number;
  engraveAreaMm2: number;
  intervals: number;
}

export function estimateTime(
  parts: Part[],
  placements: Placement[],
  materialId: string,
  machineId: string,
): TimeBreakdown {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const cut = laserPresetFor(materialId, "cut", machineId);
  const eng = laserPresetFor(materialId, "engrave", machineId);
  const score = laserPresetFor(materialId, "score", machineId);
  const cutMmMin = cut.speed;
  const engMmMin = eng.speed;
  const scoreMmMin = score.speed;
  const travelMmMin = Math.max(4000, engMmMin * 1.4);

  let cutLen = 0;
  let engArea = 0;
  let scoreLen = 0;
  let engraveLines = 0;
  let travels = 0;

  for (const pl of placements) {
    const part = byId.get(pl.partId);
    if (!part) continue;
    const g = effectiveGeometry(part);
    if (part.kind === "raster" || part.operation === "engrave") {
      if (part.kind === "raster") {
        engArea += g.width * g.height;
        engraveLines += Math.ceil(g.height / Math.max(0.02, eng.interval));
      } else {
        engArea += shapeArea(g.base);
        engraveLines += Math.ceil(g.baseBounds.h / Math.max(0.02, eng.interval));
      }
      if (g.hasOffset) cutLen += contoursLength(g.outer);
      if (g.innerCut.length) cutLen += contoursLength(g.innerCut);
    } else if (part.operation === "score") {
      scoreLen += contoursLength(g.base);
      if (g.hasOffset) cutLen += contoursLength(g.outer);
    } else {
      cutLen += contoursLength(g.outer);
      if (g.innerCut.length) cutLen += contoursLength(g.innerCut);
    }
    travels += 2;
  }

  // área / (intervalo × velocidad) -> minutos; para rellenos
  const engraveMinutes = engraveLines > 0 ? engArea / (Math.max(0.04, eng.interval) * engMmMin) : 0;
  const cutMinutes = (cutLen / cutMmMin) * Math.max(1, cut.passes);
  const scoreMinutes = scoreLen / scoreMmMin;
  const travelMinutes = (travels * 7 + placements.length * 3 + 40) / travelMmMin;
  const totalMinutes = (cutMinutes + engraveMinutes + scoreMinutes + travelMinutes) * 1.12;
  return {
    cutSeconds: cutMinutes * 60,
    engraveSeconds: engraveMinutes * 60,
    scoreSeconds: scoreMinutes * 60,
    travelSeconds: travelMinutes * 60,
    totalSeconds: totalMinutes * 60,
    cutLengthMm: cutLen,
    engraveAreaMm2: engArea,
    intervals: engraveLines,
  };
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m} min ${r.toString().padStart(2, "0")} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${(m % 60).toString().padStart(2, "0")} min`;
}

// ------------------------------------------------------------------ stats --

export function computeStats(doc: Doc): SheetStats {
  const byId = new Map(doc.parts.map((p) => [p.id, p]));
  const pages = Math.max(1, ...doc.placements.map((p) => p.page + 1));
  const usableW = Math.max(1, doc.sheet.width - doc.sheet.margin * 2);
  const usableH = Math.max(1, doc.sheet.height - doc.sheet.margin * 2);
  const groups = doc.groups || [];
  const groupedPartIds = new Set<string>();
  let used = 0;
  for (const group of groups) {
    const members = group.members
      .map((m) => {
        const part = byId.get(m.partId);
        if (!part) return null;
        groupedPartIds.add(part.id);
        return { m, part };
      })
      .filter(Boolean) as { m: { partId: string; dx: number; dy: number }; part: Part }[];
    if (!members.length) continue;
    const all = members.flatMap(({ m, part }) =>
      translateContours(effectiveGeometry(part).outer, m.dx, m.dy),
    );
    const contours = unionContours([all]);
    used += clipperArea(contours) * Math.max(1, group.copies);
  }
  let cutLength = 0;
  let engraveArea = 0;
  for (const pl of doc.placements) {
    const part = byId.get(pl.partId);
    if (!part) continue;
    if (!groupedPartIds.has(part.id)) used += partOuterArea(part);
    const g = effectiveGeometry(part);
    if (part.operation === "cut") cutLength += contoursLength(g.outer);
    else if (part.operation === "score") cutLength += contoursLength(g.base);
    else {
      engraveArea += shapeArea(g.base);
      if (g.hasOffset) cutLength += contoursLength(g.outer);
    }
  }
  const t = estimateTime(doc.parts, doc.placements, doc.settings.materialId, doc.settings.machineId);
  return {
    pages,
    placed: doc.placements.length,
    unplaced: 0,
    efficiency: Math.min(1, used / Math.max(1e-6, usableW * usableH * pages)),
    usedArea: used,
    sheetArea: usableW * usableH * pages,
    cutLength,
    engraveArea,
    timeSeconds: t.totalSeconds,
  };
}

/** Resumen por capa para la interfaz y el SVG. */
export function layerCounts(doc: Doc): Record<string, number> {
  const counts: Record<string, number> = { cut: 0, engrave: 0, score: 0, border: 0 };
  for (const pl of doc.placements) {
    const part = doc.parts.find((p) => p.id === pl.partId);
    if (!part) continue;
    if (part.operation === "engrave") counts.engrave++;
    if (part.operation === "score") counts.score++;
    if (part.operation === "cut") counts.cut++;
    if (part.offsetMm > 0) counts.cut++;
    if (part.separateBorder && part.offsetMm > 0) counts.border++;
  }
  return counts;
}

// ------------------------------------------------------- colocación fina --

export interface PlacedGeometry {
  outer: Contour[];
  base: Contour[];
  inner: Contour[];
  /** Rectángulo del diseño dentro del marco, para imágenes. */
  baseBounds: { x: number; y: number; w: number; h: number };
  frameW: number;
  frameH: number;
  angle: number;
  mirror: boolean;
  x: number;
  y: number;
  rotatedW: number;
  rotatedH: number;
  /** Matriz local (mm) → plancha (mm): a b c d e f. */
  matrix: { a: number; b: number; c: number; d: number; e: number; f: number };
  /** Bounds locales del diseño (antes de transformar). */
  localBaseBounds: { x: number; y: number; w: number; h: number };
}

/**
 * Coloca la geometría efectiva de una pieza en la plancha. La rotación se
 * hace alrededor del centro del marco y luego se alinea el bbox girado.
 */
export function placeEffective(part: Part, placement: Placement): PlacedGeometry {
  const g = effectiveGeometry(part);
  const fw = Math.max(0.01, g.width);
  const fh = Math.max(0.01, g.height);
  const cx = fw / 2;
  const cy = fh / 2;
  const rad = (placement.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rw = Math.abs(fw * cos) + Math.abs(fh * sin);
  const rh = Math.abs(fw * sin) + Math.abs(fh * cos);
  const minx = cx - rw / 2;
  const miny = cy - rh / 2;
  const tfP = (p: { x: number; y: number }) => {
    let x = p.x;
    if (placement.mirror) x = fw - x;
    const dx = x - cx;
    const dy = p.y - cy;
    return {
      x: dx * cos - dy * sin + cx - minx + placement.x,
      y: dx * sin + dy * cos + cy - miny + placement.y,
    };
  };
  const tf = (cs: Contour[]) => cs.map((c) => c.map(tfP));
  const bb = g.baseBounds;
  const corners = [
    { x: bb.x, y: bb.y },
    { x: bb.x + bb.w, y: bb.y },
    { x: bb.x + bb.w, y: bb.y + bb.h },
    { x: bb.x, y: bb.y + bb.h },
  ].map(tfP);
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const imgBB = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
  const origin = tfP({ x: 0, y: 0 });
  const ex = tfP({ x: 1, y: 0 });
  const ey = tfP({ x: 0, y: 1 });
  return {
    outer: tf(g.outer),
    base: tf(g.base),
    inner: tf(g.innerCut),
    baseBounds: imgBB,
    frameW: fw,
    frameH: fh,
    angle: placement.angle,
    mirror: placement.mirror,
    x: placement.x,
    y: placement.y,
    rotatedW: rw,
    rotatedH: rh,
    matrix: {
      a: ex.x - origin.x,
      b: ex.y - origin.y,
      c: ey.x - origin.x,
      d: ey.y - origin.y,
      e: origin.x,
      f: origin.y,
    },
    localBaseBounds: bb,
  };
}

export function placedBounds(part: Part, placement: Placement): { x: number; y: number; w: number; h: number } {
  const p = placeEffective(part, placement);
  return { x: placement.x, y: placement.y, w: p.rotatedW, h: p.rotatedH };
}


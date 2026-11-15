/**
 * Exportador SVG para LightBurn: milímetros reales, sin transformaciones en
 * los vectores, capas por color, kerf, puentes y orden de recorrido.
 */

import { strToU8, zipSync } from "fflate";
import type { Contour, Doc, Part, Placement, Pt } from "../types";
import { offsetContours } from "./clipper";
import { contoursBounds, contourArea, contoursToPath, fmt } from "./geom";
import {
  effectiveGeometry,
  LAYER_COLORS,
  laserPresetFor,
  MATERIAL_BY_ID,
  MACHINE_BY_ID,
  placeEffective,
} from "./laser";

export interface SvgExportOptions {
  kerf: boolean;
  bridges: boolean;
  bridgeCount: number;
  bridgeWidth: number;
  frame: boolean;
  order: boolean;
  notes: boolean;
}

export const DEFAULT_EXPORT: SvgExportOptions = {
  kerf: true,
  bridges: false,
  bridgeCount: 4,
  bridgeWidth: 2.5,
  frame: false,
  order: true,
  notes: true,
};

const RUN_NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"';

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Divide un contorno cerrado en arcos, dejando huecos (puentes). */
export function bridgeRuns(contour: Contour, count: number, gapWidth: number): Pt[][] {
  const pts = contour.slice();
  if (pts.length < 4 || count <= 0 || gapWidth <= 0) return [pts];
  const lens: number[] = [0];
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
    lens.push(total);
  }
  if (total < count * gapWidth * 1.8) return [pts];
  const gap = Math.min(gapWidth, total / count / 2.2);
  const runs: Pt[][] = [];

  const pointAt = (s: number): Pt => {
    let t = Math.max(0, Math.min(total, s));
    let lo = 0;
    let hi = lens.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (lens[mid] <= t) lo = mid;
      else hi = mid;
    }
    const edgeLen = lens[lo + 1] - lens[lo] || 1;
    const u = (t - lens[lo]) / edgeLen;
    const a = pts[lo % pts.length];
    const b = pts[(lo + 1) % pts.length];
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  };

  const extract = (start: number, end: number): Pt[] => {
    const out: Pt[] = [pointAt(start)];
    for (let i = 0; i < pts.length; i++) {
      const s = lens[i];
      if (s > start && s < end) out.push(pts[i]);
    }
    out.push(pointAt(end));
    const clean: Pt[] = [];
    for (const p of out) {
      const prev = clean[clean.length - 1];
      if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 0.02) clean.push(p);
    }
    return clean;
  };

  for (let i = 0; i < count; i++) {
    const a = (i * total) / count + gap / 2;
    const b = ((i + 1) * total) / count - gap / 2;
    if (b - a > 0.2) {
      const run = extract(a, b);
      if (run.length >= 2) runs.push(run);
    }
  }
  return runs;
}

function openPath(runs: Pt[][]): string {
  let d = "";
  for (const run of runs) {
    if (run.length < 2) continue;
    d += `M${fmt(run[0].x)} ${fmt(run[0].y)}`;
    for (let i = 1; i < run.length; i++) d += `L${fmt(run[i].x)} ${fmt(run[i].y)}`;
  }
  return d;
}

function closedPath(contours: Contour[]): string {
  return contoursToPath(contours, true);
}

/** Prepara los contornos de corte con kerf y puentes. */
function prepareCut(
  contours: Contour[],
  options: SvgExportOptions,
  kerf: number,
): string {
  let work = contours;
  if (options.kerf && kerf > 0) {
    work = offsetContours(work, kerf / 2, "round", 0.025);
  }
  // separar huecos (negativos) de exteriores (positivos)
  const holes = work.filter((c) => contourArea(c) < 0);
  const outers = work.filter((c) => contourArea(c) >= 0);
  let d = "";
  // primero los huecos: así el láser corta lo interior antes de liberar la pieza
  if (holes.length) d += closedPath(holes);
  for (const c of outers) {
    if (options.bridges && options.bridgeCount > 0 && options.bridgeWidth > 0) {
      const runs = bridgeRuns(c, options.bridgeCount, options.bridgeWidth);
      if (runs.length) d += openPath(runs);
    } else {
      d += closedPath([c]);
    }
  }
  if (!outers.length && holes.length) {
    // geometría rara sin orientación: cortar todo cerrado
    d = closedPath(work);
  }
  return d;
}

interface Item {
  id: string;
  name: string;
  center: Pt;
  d: string;
  fill: boolean;
  image?: string;
}

function sortNearest(items: Item[], start: Pt): Item[] {
  const remaining = items.slice();
  const out: Item[] = [];
  let cur = start;
  while (remaining.length) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = Math.hypot(remaining[i].center.x - cur.x, remaining[i].center.y - cur.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const it = remaining.splice(best, 1)[0];
    out.push(it);
    cur = it.center;
  }
  return out;
}

function rasterImageTag(part: Part, placement: Placement): string {
  if (!part.raster) return "";
  const g = effectiveGeometry(part);
  const pg = placeEffective(part, placement);
  const bb = g.baseBounds;
  const m = pg.matrix;
  const dpi = part.raster.dpi || 300;
  return (
    `<g transform="matrix(${fmt(m.a)} ${fmt(m.b)} ${fmt(m.c)} ${fmt(m.d)} ${fmt(m.e)} ${fmt(m.f)})">` +
    `<image x="${fmt(bb.x)}" y="${fmt(bb.y)}" width="${fmt(Math.max(0.01, bb.w))}" height="${fmt(Math.max(0.01, bb.h))}" ` +
    `preserveAspectRatio="none" xlink:href="${part.raster.dataUrl}" data-dpi="${dpi}"/>` +
    `</g>`
  );
}

/**
 * Genera el SVG de una plancha. Las capas se ordenan de grabado a corte para
 * que el trabajo se pueda lanzar sin tocar el orden en LightBurn.
 */
export function buildSheetSvg(doc: Doc, page: number, options: SvgExportOptions = DEFAULT_EXPORT): string {
  const partsById = new Map(doc.parts.map((p) => [p.id, p]));
  const placements = doc.placements.filter((p) => p.page === page);
  const layers: Record<"engrave" | "score" | "border" | "cut", Item[]> = {
    engrave: [],
    score: [],
    border: [],
    cut: [],
  };
  const sheetW = doc.sheet.width;
  const sheetH = doc.sheet.height;

  for (const pl of placements) {
    const part = partsById.get(pl.partId);
    if (!part) continue;
    const geo = effectiveGeometry(part);
    const placed = placeEffective(part, pl);
    const center = {
      x: pl.x + placed.rotatedW / 2,
      y: pl.y + placed.rotatedH / 2,
    };
    const addCut = (contours: Contour[], layer: "cut" | "border") => {
      const d = prepareCut(contours, options, doc.sheet.kerf);
      if (d) layers[layer].push({ id: pl.id, name: part.name, center, d, fill: false });
    };
    const addEngrave = (contours: Contour[]) => {
      if (!contours.length) return;
      layers.engrave.push({
        id: pl.id,
        name: part.name,
        center,
        d: closedPath(contours),
        fill: true,
      });
    };

    if (part.kind === "raster" || part.operation === "engrave") {
      if (part.kind === "raster") {
        const tag = rasterImageTag(part, pl);
        if (tag) {
          layers.engrave.push({ id: pl.id, name: part.name, center, d: "", fill: false, image: tag });
        }
      } else {
        addEngrave(placed.base);
      }
      if (geo.hasOffset) addCut(placed.outer, "cut");
      if (geo.innerCut.length) addCut(placed.inner, "border");
    } else if (part.operation === "score") {
      const d = closedPath(placed.base);
      if (d) layers.score.push({ id: pl.id, name: part.name, center, d, fill: false });
      if (geo.hasOffset) addCut(placed.outer, "cut");
    } else {
      addCut(placed.outer, "cut");
      if (geo.innerCut.length) addCut(placed.inner, "border");
    }
  }

  const start = { x: 0, y: sheetH };
  const ordered: Record<string, Item[]> = {};
  for (const key of Object.keys(layers) as (keyof typeof layers)[]) {
    ordered[key] = options.order ? sortNearest(layers[key], start) : layers[key];
  }

  const title = `LaserCat · ${doc.name || "proyecto"} · plancha ${page + 1}`;
  const mat = MATERIAL_BY_ID[doc.settings.materialId] || MATERIAL_BY_ID.tilo;
  const machine = MACHINE_BY_ID[doc.settings.machineId] || MACHINE_BY_ID.s30;
  const cutP = laserPresetFor(mat.id, "cut", machine.id);
  const engP = laserPresetFor(mat.id, "engrave", machine.id);
  const scoreP = laserPresetFor(mat.id, "score", machine.id);
  const desc = options.notes
    ? `LaserCat. Plancha ${page + 1}. ${fmt(sheetW)}x${fmt(sheetH)} mm. Material: ${mat.name} ${mat.thickness} mm. Máquina: ${machine.name}. ` +
      `Corte: ${cutP.power}% / ${cutP.speed} mm/min / ${cutP.passes} pasada(s). ` +
      `Grabado: ${engP.power}% / ${engP.speed} mm/min / intervalo ${engP.interval} mm. ` +
      `Kerf: ${doc.sheet.kerf} mm. Capas: azul=grabado, verde=marcado, negro=corte, magenta=borde, rojo=marcas.`
    : "LaserCat";

  const layerMeta: Record<string, { color: string; fill: boolean; desc: string }> = {
    engrave: { color: LAYER_COLORS.engrave, fill: true, desc: "GRABADO" },
    score: { color: LAYER_COLORS.score, fill: false, desc: "MARCADO" },
    border: { color: LAYER_COLORS.border, fill: false, desc: "BORDE" },
    cut: { color: LAYER_COLORS.cut, fill: false, desc: "CORTE" },
  };

  let body = "";
  for (const key of ["engrave", "score", "border", "cut"] as const) {
    const items = ordered[key];
    if (!items.length) continue;
    const meta = layerMeta[key];
    body += `<g id="layer-${key}" data-layer="${key}" inkscape:groupmode="layer" inkscape:label="${meta.desc}" fill="${meta.color}" stroke="none">\n`;
    for (const item of items) {
      body += `<g id="p-${esc(item.id)}-${key}" data-name="${esc(item.name)}">\n`;
      if (item.image) body += item.image + "\n";
      if (item.d) {
        if (meta.fill) {
          body += `<path d="${item.d}" fill="${meta.color}" fill-rule="evenodd" stroke="${meta.color}" stroke-width="0.05"/>\n`;
        } else {
          body += `<path d="${item.d}" fill="none" stroke="${meta.color}" stroke-width="0.1" stroke-linejoin="round" stroke-linecap="round"/>\n`;
        }
      }
      body += `</g>\n`;
    }
    body += `</g>\n`;
  }

  if (options.frame) {
    const m = Math.max(1, Math.min(doc.sheet.margin, Math.min(sheetW, sheetH) / 4));
    const len = Math.min(8, m * 1.6);
    const lw = 0.15;
    let d = "";
    // esquinas en L
    const corners = [
      [m, m, 1, 1],
      [sheetW - m, m, -1, 1],
      [m, sheetH - m, 1, -1],
      [sheetW - m, sheetH - m, -1, -1],
    ];
    for (const [x, y, sx, sy] of corners) {
      d += `M${fmt(x)} ${fmt(y)}L${fmt(x + sx * len)} ${fmt(y)}M${fmt(x)} ${fmt(y)}L${fmt(x)} ${fmt(y + sy * len)}`;
    }
    body += `<g id="layer-marks" data-layer="marks" inkscape:label="MARCAS" fill="none" stroke="${LAYER_COLORS.marks}" stroke-width="${lw}" stroke-linecap="round">\n`;
    body += `<path d="${d}"/>\n</g>\n`;
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg ${RUN_NS} width="${fmt(sheetW)}mm" height="${fmt(sheetH)}mm" viewBox="0 0 ${fmt(sheetW)} ${fmt(sheetH)}" version="1.1" data-lasercat="1" shape-rendering="geometricPrecision">\n` +
    `<title>${esc(title)}</title>\n<desc>${esc(desc)}</desc>\n` +
    body +
    `</svg>\n`
  );
}

export interface SheetExport {
  page: number;
  name: string;
  svg: string;
}

export function buildAllSheets(doc: Doc, options: SvgExportOptions): SheetExport[] {
  const pages = Math.max(1, ...doc.placements.map((p) => p.page + 1));
  const safe = (doc.name || "lasercat").replace(/[^\w\-áéíóúñü ]+/gi, "").trim().replace(/\s+/g, "-").toLowerCase();
  return Array.from({ length: pages }, (_, i) => ({
    page: i,
    name: `${safe}-plancha-${String(i + 1).padStart(2, "0")}.svg`,
    svg: buildSheetSvg(doc, i, options),
  }));
}

export function buildSettingsCsv(doc: Doc): string {
  const mat = MATERIAL_BY_ID[doc.settings.materialId] || MATERIAL_BY_ID.tilo;
  const machine = MACHINE_BY_ID[doc.settings.machineId] || MACHINE_BY_ID.s30;
  const cut = laserPresetFor(mat.id, "cut", machine.id);
  const eng = laserPresetFor(mat.id, "engrave", machine.id);
  const score = laserPresetFor(mat.id, "score", machine.id);
  const rows = [
    ["capa", "color", "modo LightBurn", "potencia %", "velocidad mm/min", "pasadas", "intervalo mm", "notas"],
    ["GRABADO", LAYER_COLORS.engrave, "Relleno (Fill)", String(eng.power), String(eng.speed), String(eng.passes), String(eng.interval), "Imagen/vector de grabado"],
    ["MARCADO", LAYER_COLORS.score, "Línea", String(score.power), String(score.speed), String(score.passes), String(score.interval), "Marca sin atravesar"],
    ["BORDE", LAYER_COLORS.border, "Línea", String(cut.power), String(cut.speed), String(cut.passes), "", "Corte interior de bordes separados"],
    ["CORTE", LAYER_COLORS.cut, "Línea", String(cut.power), String(cut.speed), String(cut.passes), "", "Corte pasante"],
    ["MARCAS", LAYER_COLORS.marks, "Línea", String(Math.max(5, Math.round(cut.power * 0.2))), String(cut.speed), "1", "", "Solo referencia; se puede omitir"],
  ];
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n") + "\r\n";
}

export function buildLightburnReadme(doc: Doc): string {
  const mat = MATERIAL_BY_ID[doc.settings.materialId] || MATERIAL_BY_ID.tilo;
  const machine = MACHINE_BY_ID[doc.settings.machineId] || MACHINE_BY_ID.s30;
  const cut = laserPresetFor(mat.id, "cut", machine.id);
  const eng = laserPresetFor(mat.id, "engrave", machine.id);
  const score = laserPresetFor(mat.id, "score", machine.id);
  const pages = Math.max(1, ...doc.placements.map((p) => p.page + 1));
  return `LaserCat → LightBurn
===================

Archivo: ${doc.name}
Planchas: ${pages}
Tamaño: ${doc.sheet.width} × ${doc.sheet.height} mm (1 unidad SVG = 1 mm)
Margen: ${doc.sheet.margin} mm · Separación: ${doc.sheet.spacing} mm · Kerf: ${doc.sheet.kerf} mm
Máquina: ${machine.name}
Material: ${mat.name} (${mat.thickness} mm)

CAPAS (los colores del SVG crean capas en LightBurn)
---------------------------------------------------
· AZUL   #0000FF  GRABADO → modo Relleno (Fill)
· VERDE  #008000  MARCADO → modo Línea
· NEGRO  #000000  CORTE   → modo Línea
· MAGENTA #FF00FF BORDE   → modo Línea (solo si hay bordes separados)
· ROJO   #FF0000  MARCAS  → referencia; desactívala o ponla en Marcado

AJUSTES DE PARTIDA (SculpFun S30 / 10 W)
---------------------------------------
GRABADO: potencia ${eng.power} %, velocidad ${eng.speed} mm/min, ${eng.passes} pasada(s), intervalo ${eng.interval} mm
MARCADO: potencia ${score.power} %, velocidad ${score.speed} mm/min, ${score.passes} pasada(s)
CORTE:   potencia ${cut.power} %, velocidad ${cut.speed} mm/min, ${cut.passes} pasada(s)
Aire: ${cut.airAssist ? "ON" : "OFF"} para corte.

Estos valores son un punto de partida. Haz siempre una prueba pequeña:
cada máquina, lente y madera cambia. Si no atraviesa, baja velocidad antes
de subir potencia; si quema demasiado, sube velocidad o baja potencia.

PASOS
-----
1. En LightBurn: Archivo → Importar (o arrastra el SVG a la mesa).
2. Comprueba que el tamaño es exacto: 300 × 300 mm si es la plancha por defecto.
3. Las capas se crean por color. Asigna a cada una el modo y los valores de arriba.
4. Orden recomendado: GRABADO → MARCADO → BORDE → CORTE → MARCAS.
   (En LightBurn, arrastra las capas en el panel de Capas para ordenarlas).
5. Coloca la pieza: Usar origen de usuario o Coordenadas absolutas.
   El SVG tiene el origen arriba-izquierda; LightBurn lo convierte a su mesa.
6. Enfoca a la superficie, enciende el aire y lanza el trabajo.

CONSEJOS
--------
· El kerf ya está aplicado a las piezas de corte (si la opción estaba activa).
  Si tu haz es más fino o más grueso, ajusta "Kerf" y vuelve a exportar.
· Los puentes (si los activaste) dejan la pieza sujeta; córtalos con cuter.
· Las imágenes de grabado van incrustadas en el SVG como PNG. Si tu versión de
  LightBurn no las importa, usa los PNG incluidos en el ZIP e insértalos a la
  misma posición y tamaño.
· Las líneas son de 0,1 mm para que LightBurn las trate como trazados finos.
· No cambies el tamaño al importar: LaserCat ya calcula todo en milímetros.
`;
}

export function buildProjectFile(doc: Doc): string {
  return JSON.stringify({ ...doc, updatedAt: Date.now() }, null, 2);
}

export interface ZipFile {
  name: string;
  data: Uint8Array | string;
}

export function makeZip(files: ZipFile[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) {
    entries[f.name] = typeof f.data === "string" ? strToU8(f.data) : f.data;
  }
  return zipSync(entries, { level: 6 });
}

export function buildExportFiles(doc: Doc, options: SvgExportOptions): ZipFile[] {
  const sheets = buildAllSheets(doc, options);
  const files: ZipFile[] = sheets.map((s) => ({ name: s.name, data: s.svg }));
  files.push({ name: "lasercat-proyecto.json", data: buildProjectFile(doc) });
  files.push({ name: "LEEME-LightBurn.txt", data: buildLightburnReadme(doc) });
  files.push({ name: "ajustes-capas.csv", data: buildSettingsCsv(doc) });
  return files;
}

/** Datos URL para una vista previa PNG sin pasar por el ZIP. */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

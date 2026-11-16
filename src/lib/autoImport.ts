/** Importación rápida: suelta archivos y se añaden sin abrir diálogos. */

import type { Assembly, ImageDropMode, Part } from "../types";
import { importSvg, type SvgImportResult } from "./svgImport";
import { normalizeOrigin, contoursBounds } from "./geom";
import { loadImageData, traceImage, imageDataToDataUrl } from "./trace";
import { uid } from "./demo";
import { readFileText } from "./download";

export interface ImportPayload {
  parts: Part[];
  groups: Assembly[];
  names: string[];
}

/** Convierte un resultado del importador SVG en piezas y figuras listas para el documento. */
export function partsFromSvgResult(result: SvgImportResult): ImportPayload {
  const idMap = new Map<string, string>();
  const parts: Part[] = result.parts.map((p) => {
    const id = uid("part");
    idMap.set(p.id, id);
    if (p.kind === "raster") {
      return {
        id,
        name: p.name || "Imagen SVG",
        kind: "raster",
        contours: [],
        width: p.width,
        height: p.height,
        operation: "engrave",
        offsetMm: 0,
        separateBorder: false,
        copies: 1,
        source: "svg",
        color: p.color,
        raster: p.raster,
        groupId: p.groupLabel,
      };
    }
    return {
      id,
      name: p.name || "Pieza SVG",
      kind: "vector",
      contours: p.contours,
      width: p.width,
      height: p.height,
      operation: p.operation || "cut",
      offsetMm: 0,
      separateBorder: false,
      copies: 1,
      source: "svg",
      color: p.color,
      groupId: p.groupLabel,
    };
  });
  const groups: Assembly[] = [];
  const scale = result.scale || 1;
  for (const g of result.groups) {
    const members = g.memberIds
      .map((id) => result.parts.find((p) => p.id === id))
      .filter(Boolean) as SvgImportResult["parts"];
    if (!members.length) continue;
    const xs = members.map((p) => p.sourceBounds.x * scale);
    const ys = members.map((p) => p.sourceBounds.y * scale);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const asm: Assembly = {
      id: uid("asm"),
      name: g.name || "Figura",
      members: members.map((p, i) => ({
        partId: idMap.get(p.id)!,
        dx: Math.round((xs[i] - minX) * 1000) / 1000,
        dy: Math.round((ys[i] - minY) * 1000) / 1000,
      })),
      copies: 1,
      color: g.color,
    };
    groups.push(asm);
  }
  return { parts, groups, names: [result.parts[0]?.name || "SVG"] };
}

export async function svgFileToParts(file: File): Promise<ImportPayload> {
  const text = await readFileText(file);
  const result = importSvg(text, {
    tolerance: 1,
    mode: "inteligente",
    strokeMode: "cut",
    simplify: 0.02,
    whiteAsHoles: true,
  });
  return partsFromSvgResult(result);
}

export async function imageFileToPart(file: File, mode: ImageDropMode = "cut"): Promise<Part> {
  if (!/^image\//.test(file.type) && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) {
    throw new Error("Formato de imagen no soportado.");
  }
  if (file.size > 18 * 1024 * 1024) throw new Error("La imagen supera los 18 MB.");
  const data = await loadImageData(file, 1400, true);
  const image = data.image;
  const base = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Imagen";
  const widthMm = Math.max(12, Math.min(140, Math.round((image.width / 300) * 25.4) || 80));
  const heightMm = (image.height / image.width) * widthMm;

  if (mode === "engrave-gray") {
    return {
      id: uid("img"),
      name: base,
      kind: "raster",
      contours: [],
      width: widthMm,
      height: heightMm,
      operation: "engrave",
      offsetMm: 0,
      separateBorder: false,
      copies: 1,
      source: "image",
      color: "#8a4f7d",
      raster: {
        dataUrl: imageDataToDataUrl(image),
        width: image.width,
        height: image.height,
        dpi: (image.width / widthMm) * 25.4,
        mode: "grayscale",
        threshold: 160,
        invert: false,
      },
    };
  }

  const dpi = (image.width / widthMm) * 25.4;
  const res = traceImage(image, {
    threshold: 160,
    invert: false,
    alphaThreshold: 40,
    simplifyPx: 0.55,
    minAreaMm2: 0.4,
    dpi,
    smooth: 1,
    removeBackground: true,
  });
  const normalized = normalizeOrigin(res.contours);
  const b = contoursBounds(normalized);
  if (!normalized.length || b.w < 0.1 || b.h < 0.1) {
    throw new Error("La imagen no tiene una silueta clara. Prueba a grabarla desde el diálogo de imagen.");
  }
  return {
    id: uid("img"),
    name: base,
    kind: "vector",
    contours: normalized,
    width: b.w,
    height: b.h,
    operation: mode === "engrave-threshold" ? "engrave" : "cut",
    offsetMm: 0,
    separateBorder: false,
    copies: 1,
    source: "image",
    color: mode === "engrave-threshold" ? "#8a4f7d" : "#b5651d",
  };
}

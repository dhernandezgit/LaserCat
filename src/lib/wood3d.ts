/**
 * Vista 3D de las piezas cortadas (no del tablero sobrante), inspirada en el
 * visor de CONector. Permite orbitar, inclinar, acercar y ver el grosor.
 */

import type { Contour, Doc, Part, Placement } from "../types";
import { clipperArea } from "./clipper";
import { effectiveGeometry, placeEffective } from "./laser";
import { renderWoodPreview, SPECIES_BY_ID, type WoodPreviewOptions } from "./wood";

export interface Wood3DOptions extends WoodPreviewOptions {
  depthMm: number;
  yaw?: number;
  tilt?: number;
  zoom?: number;
}

function pathContours(ctx: CanvasRenderingContext2D, contours: Contour[]) {
  ctx.beginPath();
  for (const c of contours) {
    if (c.length < 3) continue;
    ctx.moveTo(c[0].x, c[0].y);
    for (let i = 1; i < c.length; i++) ctx.lineTo(c[i].x, c[i].y);
    ctx.closePath();
  }
}

function outermost(contours: Contour[]): Contour[] {
  const sorted = contours.slice().sort((a, b) => Math.abs(clipperArea([b])) - Math.abs(clipperArea([a])));
  const out: Contour[] = [];
  for (const c of sorted) {
    const inside = out.some((o) => {
      // Centro aproximado del contorno; suficiente para descartar el borde
      // interior de un trazo fino.
      let sx = 0;
      let sy = 0;
      for (const p of c) { sx += p.x; sy += p.y; }
      const cx = sx / c.length;
      const cy = sy / c.length;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of o) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
      return cx > minX && cx < maxX && cy > minY && cy < maxY;
    });
    if (!inside) out.push(c);
  }
  return out;
}

/** Elige el relleno de una pieza: conserva huecos reales, pero no el hueco interno de un trazo. */
function pieceContours(part: Part): { contours: Contour[]; evenOdd: boolean } {
  const g = effectiveGeometry(part);
  const area = Math.abs(g.base.reduce((s, c) => s + Math.abs(clipperArea([c])), 0));
  const box = Math.max(0.01, g.width * g.height);
  if (part.kind === "raster") return { contours: g.base, evenOdd: true };
  if (area / box < 0.18) return { contours: outermost(g.outer), evenOdd: false };
  return { contours: g.outer, evenOdd: true };
}

function fillPart(
  ctx: CanvasRenderingContext2D,
  part: Part,
  pl: Placement,
  style: string,
) {
  const chosen = pieceContours(part);
  if (!chosen.contours.length) return;
  const pg = placeEffective(part, pl);
  ctx.save();
  ctx.transform(pg.matrix.a, pg.matrix.b, pg.matrix.c, pg.matrix.d, pg.matrix.e, pg.matrix.f);
  pathContours(ctx, chosen.contours);
  ctx.fillStyle = style;
  ctx.fill(chosen.evenOdd ? "evenodd" : "nonzero");
  ctx.restore();
}

function contentBounds(canvas: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 3) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX >= minX ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null;
}

interface Scene3D {
  key: string;
  top: HTMLCanvasElement;
  pieceCanvas: HTMLCanvasElement;
  dark: HTMLCanvasElement;
  bounds: { x: number; y: number; w: number; h: number };
  pieces: Placement[];
  placements: Placement[];
  partById: Map<string, Part>;
}

let sceneCache: Scene3D | null = null;

function buildScene(
  doc: Doc,
  page: number,
  options: Wood3DOptions,
  images: Map<string, HTMLImageElement>,
  W: number,
  H: number,
  sp: (typeof SPECIES_BY_ID)[string],
): Scene3D {
  const top = document.createElement("canvas");
  top.width = Math.min(1400, Math.max(600, Math.round(1000 * (W / Math.max(W, H)))));
  top.height = Math.max(200, Math.round(top.width * (H / W)));
  renderWoodPreview(top, doc, page, options, images);

  const groups = doc.groups || [];
  const partById = new Map(doc.parts.map((p) => [p.id, p]));
  const cutGroups = new Set(
    groups
      .filter((g) => g.members.some((m) => partById.get(m.partId)?.operation === "cut"))
      .map((g) => g.id),
  );
  const placements = doc.placements.filter((p) => p.page === page);
  const pieces = placements.filter((pl) => {
    const part = partById.get(pl.partId);
    return !!part && (part.operation === "cut" || (pl.assemblyId && cutGroups.has(pl.assemblyId)));
  });

  const mask = document.createElement("canvas");
  mask.width = top.width;
  mask.height = top.height;
  const mctx = mask.getContext("2d")!;
  mctx.scale(top.width / W, top.height / H);
  if (pieces.length) {
    for (const pl of pieces) {
      const part = partById.get(pl.partId);
      if (part) fillPart(mctx, part, pl, "#ffffff");
    }
  } else {
    mctx.fillStyle = "#ffffff";
    mctx.fillRect(0, 0, W, H);
  }

  const pieceCanvas = document.createElement("canvas");
  pieceCanvas.width = top.width;
  pieceCanvas.height = top.height;
  const pctx = pieceCanvas.getContext("2d")!;
  pctx.drawImage(top, 0, 0);
  pctx.globalCompositeOperation = "destination-in";
  pctx.drawImage(mask, 0, 0);
  pctx.globalCompositeOperation = "source-over";

  const dark = document.createElement("canvas");
  dark.width = top.width;
  dark.height = top.height;
  const dctx = dark.getContext("2d")!;
  dctx.drawImage(mask, 0, 0);
  dctx.globalCompositeOperation = "source-in";
  dctx.fillStyle = sp.char;
  dctx.fillRect(0, 0, dark.width, dark.height);

  const bounds = contentBounds(mask) || { x: 0, y: 0, w: top.width, h: top.height };
  return { key: "", top, pieceCanvas, dark, bounds, pieces, placements, partById };
}

export function renderWood3D(
  canvas: HTMLCanvasElement,
  doc: Doc,
  page: number,
  options: Wood3DOptions,
  images: Map<string, HTMLImageElement> = new Map(),
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const cw = canvas.width;
  const ch = canvas.height;
  const W = doc.sheet.width;
  const H = doc.sheet.height;
  const depth = Math.max(0.1, Math.min(20, options.depthMm || 3));
  const yaw = ((options.yaw ?? 28) * Math.PI) / 180;
  const tilt = ((options.tilt ?? 56) * Math.PI) / 180;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const st = Math.sin(tilt), ct = Math.cos(tilt);
  const sp = SPECIES_BY_ID[options.speciesId] || SPECIES_BY_ID.tilo;

  // Fondo de estudio, como el visor de CONector.
  const bg = ctx.createRadialGradient(cw * 0.5, ch * 0.42, 0, cw * 0.5, ch * 0.5, Math.max(cw, ch) * 0.7);
  bg.addColorStop(0, "#3a3549");
  bg.addColorStop(1, "#201d2a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cw, ch);

  const sceneKey = [
    doc.updatedAt, page, W, H, images.size,
    options.speciesId, options.burnTone, options.power, options.speed, options.passes,
    options.showCut, options.showEngrave,
  ].join("|");
  if (!sceneCache || sceneCache.key !== sceneKey) {
    sceneCache = buildScene(doc, page, options, images, W, H, sp);
    sceneCache.key = sceneKey;
  }
  const { top, pieceCanvas, dark, bounds, pieces, placements, partById } = sceneCache;

  // Zona visible: las piezas, no todo el tablero.
  const sxPx = top.width / W;
  const syPx = top.height / H;
  let wx = bounds.x / sxPx;
  let wy = bounds.y / syPx;
  let ww = bounds.w / sxPx;
  let wh = bounds.h / syPx;
  const pad = Math.max(6, Math.max(ww, wh) * 0.08);
  wx -= pad; wy -= pad; ww += pad * 2; wh += pad * 2;

  const project = (x: number, y: number, z: number) => {
    const xr = x * cy - y * sy;
    const yr = x * sy + y * cy;
    return { x: xr, y: yr * st - z * ct };
  };
  const corners = [
    project(wx, wy, 0), project(wx + ww, wy, 0),
    project(wx + ww, wy + wh, 0), project(wx, wy + wh, 0),
    project(wx, wy, -depth), project(wx + ww, wy, -depth),
    project(wx + ww, wy + wh, -depth), project(wx, wy + wh, -depth),
  ];
  const minX = Math.min(...corners.map((p) => p.x));
  const maxX = Math.max(...corners.map((p) => p.x));
  const minY = Math.min(...corners.map((p) => p.y));
  const maxY = Math.max(...corners.map((p) => p.y));
  const fit = Math.min((cw - 44) / Math.max(1, maxX - minX), (ch - 44) / Math.max(1, maxY - minY));
  const scale = fit * (options.zoom ?? 1);
  const ox = cw / 2 - ((minX + maxX) / 2) * scale;
  const oy = ch / 2 - ((minY + maxY) / 2) * scale;

  const topTransform = (dy = 0) => {
    // x/y de la plancha -> coordenadas de pantalla.
    const a = (top.width / W) ** -1 * scale * cy;
    const c = (top.height / H) ** -1 * scale * -sy;
    const b = (top.width / W) ** -1 * scale * sy * st;
    const d = (top.height / H) ** -1 * scale * cy * st;
    return { a, b, c, d, e: ox, f: oy + dy };
  };

  const drawPlane = (image: HTMLCanvasElement, dy: number, alpha = 1) => {
    const t = topTransform(dy);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
    ctx.drawImage(image, 0, 0);
    ctx.restore();
  };

  // Sombra difusa bajo el conjunto.
  ctx.save();
  ctx.filter = "blur(14px)";
  ctx.globalAlpha = 0.5;
  drawPlane(dark, depth * ct * scale + 22, 0.55);
  ctx.restore();

  // Canto por capas: da volumen real sin dibujar el tablero sobrante.
  const layers = 10;
  for (let i = layers; i >= 1; i--) {
    drawPlane(dark, (depth * ct * scale * i) / layers, 1);
  }
  drawPlane(pieceCanvas, 0, 1);

  // Líneas de corte/grabado sobre las piezas.
  const topCtx = ctx;
  topCtx.save();
  topCtx.setTransform(scale * cy, scale * sy * st, -scale * sy, scale * cy * st, ox, oy);
  for (const pl of pieces) {
    const part = partById.get(pl.partId);
    if (!part) continue;
    const pg = placeEffective(part, pl);
    const g = effectiveGeometry(part);
    topCtx.save();
    topCtx.transform(pg.matrix.a, pg.matrix.b, pg.matrix.c, pg.matrix.d, pg.matrix.e, pg.matrix.f);
    pathContours(topCtx, part.operation === "cut" ? g.outer : g.base);
    topCtx.lineWidth = 0.32;
    topCtx.strokeStyle = part.operation === "cut" ? "rgba(35, 18, 7, .8)" : "rgba(70, 38, 18, .35)";
    topCtx.stroke();
    topCtx.restore();
  }
  topCtx.restore();

  // Etiqueta e instrucciones.
  ctx.fillStyle = "rgba(250, 244, 235, .82)";
  ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(`Piezas recortadas · ${sp.name} · ${depth.toFixed(1)} mm`, 14, ch - 14);
}

/** Vista 3D aproximada de la plancha y del corte. */

import type { Contour, Doc, Part, Placement } from "../types";
import { effectiveGeometry, placeEffective } from "./laser";
import { contourArea, pointInContour } from "./geom";
import { renderWoodPreview, SPECIES_BY_ID, type WoodPreviewOptions } from "./wood";

export interface Wood3DOptions extends WoodPreviewOptions {
  depthMm: number;
  cutAway: boolean;
}

function addContours(ctx: CanvasRenderingContext2D, contours: Contour[]) {
  ctx.beginPath();
  for (const c of contours) {
    if (c.length < 3) continue;
    ctx.moveTo(c[0].x, c[0].y);
    for (let i = 1; i < c.length; i++) ctx.lineTo(c[i].x, c[i].y);
    ctx.closePath();
  }
}

/** Contornos exteriores de un trazo: el hueco interior del trazo no es un agujero de la pieza. */
function outermost(contours: Contour[]): Contour[] {
  const sorted = contours.slice().sort((a, b) => Math.abs(contourArea(b)) - Math.abs(contourArea(a)));
  const out: Contour[] = [];
  for (const c of sorted) {
    if (out.some((o) => pointInContour(c[0], o))) continue;
    out.push(c);
  }
  return out;
}

function erasePart(ctx: CanvasRenderingContext2D, part: Part, pl: Placement, rasterRect = false) {
  const g = effectiveGeometry(part);
  const pg = placeEffective(part, pl);
  const contours = rasterRect ? g.base : outermost(g.outer);
  if (!contours.length) return;
  ctx.save();
  ctx.transform(pg.matrix.a, pg.matrix.b, pg.matrix.c, pg.matrix.d, pg.matrix.e, pg.matrix.f);
  addContours(ctx, contours);
  ctx.fill();
  ctx.restore();
}

export function renderWood3D(
  canvas: HTMLCanvasElement,
  doc: Doc,
  page: number,
  options: Wood3DOptions,
  images: Map<string, HTMLImageElement> = new Map(),
): void {
  const cw = canvas.width;
  const ch = canvas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, cw, ch);

  const W = doc.sheet.width;
  const H = doc.sheet.height;
  const depth = Math.max(0.2, Math.min(20, options.depthMm || 3));
  const sp = SPECIES_BY_ID[options.speciesId] || SPECIES_BY_ID.tilo;

  // 1) Textura cenital, reutilizando el render en madera.
  const top = document.createElement("canvas");
  const topW = Math.min(1400, Math.max(600, Math.round(1000 * (W / Math.max(W, H)))));
  top.width = topW;
  top.height = Math.max(200, Math.round(topW * (H / W)));
  renderWoodPreview(top, doc, page, options, images);

  // 2) Quitar las piezas que se cortan para simular el tablero recortado.
  if (options.cutAway) {
    const tctx = top.getContext("2d");
    if (tctx) {
      tctx.save();
      tctx.globalCompositeOperation = "destination-out";
      tctx.scale(top.width / W, top.height / H);
      const placements = doc.placements.filter((p) => p.page === page);
      for (const pl of placements) {
        const part = doc.parts.find((p) => p.id === pl.partId);
        if (!part) continue;
        if (part.operation === "cut") {
          erasePart(tctx, part, pl, false);
        }
      }
      tctx.restore();
    }
  }

  // 3) Proyección oblicua.
  const kx = 0.36;
  const ky = 0.62;
  const kz = 0.9;
  const margin = 22;
  const boardW = W + H * kx;
  const boardH = H * ky + depth * kz;
  const scale = Math.max(
    0.01,
    Math.min((cw - margin * 2) / boardW, (ch - margin * 2) / boardH),
  );
  const ox = (cw - boardW * scale) / 2;
  const oy = (ch - boardH * scale) / 2;
  const P = (x: number, y: number, z: number) => ({
    x: ox + (x + y * kx) * scale,
    y: oy + (y * ky - z * kz) * scale,
  });

  // Sombra.
  ctx.save();
  ctx.filter = "blur(12px)";
  ctx.fillStyle = "rgba(30, 18, 10, .28)";
  const top0 = P(0, 0, 0);
  const top1 = P(W, 0, 0);
  const top2 = P(W, H, 0);
  const top3 = P(0, H, 0);
  ctx.beginPath();
  const sh = 13;
  ctx.moveTo(top0.x + sh, top0.y + sh);
  ctx.lineTo(top1.x + sh, top1.y + sh);
  ctx.lineTo(top2.x + sh, top2.y + sh);
  ctx.lineTo(top3.x + sh, top3.y + sh);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const bot0 = P(0, 0, -depth);
  const bot1 = P(W, 0, -depth);
  const bot2 = P(W, H, -depth);
  const bot3 = P(0, H, -depth);

  // Cara inferior y cantos.
  ctx.fillStyle = sp.char;
  ctx.beginPath();
  ctx.moveTo(bot0.x, bot0.y);
  ctx.lineTo(bot1.x, bot1.y);
  ctx.lineTo(bot2.x, bot2.y);
  ctx.lineTo(bot3.x, bot3.y);
  ctx.closePath();
  ctx.fill();

  const sideGrad = ctx.createLinearGradient(0, top2.y, 0, bot2.y);
  sideGrad.addColorStop(0, sp.dark);
  sideGrad.addColorStop(0.45, sp.base);
  sideGrad.addColorStop(1, sp.char);
  ctx.fillStyle = sideGrad;
  ctx.beginPath();
  ctx.moveTo(top3.x, top3.y);
  ctx.lineTo(top2.x, top2.y);
  ctx.lineTo(bot2.x, bot2.y);
  ctx.lineTo(bot3.x, bot3.y);
  ctx.closePath();
  ctx.fill();

  const rightGrad = ctx.createLinearGradient(top1.x, 0, bot1.x, 0);
  rightGrad.addColorStop(0, sp.base);
  rightGrad.addColorStop(1, sp.char);
  ctx.fillStyle = rightGrad;
  ctx.beginPath();
  ctx.moveTo(top1.x, top1.y);
  ctx.lineTo(top2.x, top2.y);
  ctx.lineTo(bot2.x, bot2.y);
  ctx.lineTo(bot1.x, bot1.y);
  ctx.closePath();
  ctx.fill();

  // Veta lateral sencilla.
  ctx.strokeStyle = "rgba(62, 36, 16, .25)";
  ctx.lineWidth = 0.8;
  for (let i = 1; i < 7; i++) {
    const t = i / 7;
    const a = { x: top3.x + (top2.x - top3.x) * t, y: top3.y + (top2.y - top3.y) * t };
    const b = { x: bot3.x + (bot2.x - bot3.x) * t, y: bot3.y + (bot2.y - bot3.y) * t };
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // 4) Cara superior con la textura y los huecos recortados.
  const sx = top.width / W;
  const sy = top.height / H;
  ctx.save();
  ctx.setTransform(
    (scale / sx),
    0,
    (kx * scale) / sy,
    (ky * scale) / sy,
    ox,
    oy,
  );
  ctx.drawImage(top, 0, 0);
  ctx.restore();

  // 5) Bordes de corte y grabado por encima de la textura.
  ctx.save();
  ctx.setTransform(scale, 0, kx * scale, ky * scale, ox, oy);
  const placements = doc.placements.filter((p) => p.page === page);
  for (const pl of placements) {
    const part = doc.parts.find((p) => p.id === pl.partId);
    if (!part) continue;
    if (!options.showCut && part.operation === "cut") continue;
    const pg = placeEffective(part, pl);
    const g = effectiveGeometry(part);
    ctx.save();
    ctx.transform(pg.matrix.a, pg.matrix.b, pg.matrix.c, pg.matrix.d, pg.matrix.e, pg.matrix.f);
    addContours(ctx, part.operation === "cut" ? g.outer : g.base);
    ctx.lineWidth = part.operation === "cut" ? 0.42 : 0.2;
    ctx.strokeStyle = part.operation === "cut" ? "rgba(40, 20, 8, .9)" : "rgba(70, 38, 18, .38)";
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // 6) Etiqueta de profundidad.
  ctx.fillStyle = "rgba(80, 55, 35, .75)";
  ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(`${depth.toFixed(1)} mm de grosor`, 12, ch - 12);
}

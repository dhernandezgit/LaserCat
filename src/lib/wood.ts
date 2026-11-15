/**
 * Simulación de grabado y corte sobre madera: textura procedural, quema
 * según potencia/velocidad y previsualización realista de la plancha.
 */

import type { Contour, Doc, Part } from "../types";
import { contoursToPath } from "./geom";
import { effectiveGeometry, placeEffective } from "./laser";

export interface Species {
  id: string;
  name: string;
  base: string;
  light: string;
  dark: string;
  grain: string;
  char: string;
  grainStrength: number;
  scale: number;
  knots: number;
  speckle: number;
  flat?: boolean;
}

export const SPECIES: Species[] = [
  { id: "tilo", name: "Tilo", base: "#e7cda0", light: "#f2e0bd", dark: "#d3af7a", grain: "#b88b50", char: "#3a2312", grainStrength: 0.35, scale: 1, knots: 0.25, speckle: 0.05 },
  { id: "abedul", name: "Abedul", base: "#e9d3af", light: "#f4e5c9", dark: "#d2b184", grain: "#b08a57", char: "#382112", grainStrength: 0.55, scale: 1.3, knots: 0.15, speckle: 0.07 },
  { id: "roble", name: "Roble", base: "#c9975f", light: "#ddb481", dark: "#a97640", grain: "#7f5428", char: "#2e1a0b", grainStrength: 0.8, scale: 0.8, knots: 0.5, speckle: 0.09 },
  { id: "nogal", name: "Nogal", base: "#704a2d", light: "#8d603c", dark: "#4b301c", grain: "#382213", char: "#160b04", grainStrength: 0.7, scale: 0.95, knots: 0.35, speckle: 0.06 },
  { id: "cerezo", name: "Cerezo", base: "#bd7d4f", light: "#d29564", dark: "#94572f", grain: "#71411f", char: "#2b1307", grainStrength: 0.6, scale: 1.1, knots: 0.3, speckle: 0.06 },
  { id: "bambu", name: "Bambú", base: "#d8b479", light: "#e7c997", dark: "#bd9354", grain: "#9d753c", char: "#3a2610", grainStrength: 0.25, scale: 2.2, knots: 0.05, speckle: 0.03 },
  { id: "mdf", name: "DM / MDF", base: "#cbb08b", light: "#d8c1a0", dark: "#b99971", grain: "#a88963", char: "#332414", grainStrength: 0.08, scale: 1, knots: 0, speckle: 0.1, flat: true },
  { id: "pino", name: "Pino", base: "#e8c894", light: "#f3dbb0", dark: "#d0a96f", grain: "#b48a4f", char: "#3a2410", grainStrength: 0.7, scale: 0.7, knots: 0.8, speckle: 0.08 },
  { id: "carton", name: "Cartón", base: "#c8a26e", light: "#d6b384", dark: "#b28b58", grain: "#94703f", char: "#3a2411", grainStrength: 0.15, scale: 1.5, knots: 0, speckle: 0.12, flat: true },
];

export const SPECIES_BY_ID: Record<string, Species> = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

export interface WoodPreviewOptions {
  speciesId: string;
  power: number; // %
  speed: number; // mm/min
  passes: number;
  showCut: boolean;
  showEngrave: boolean;
  showGuides: boolean;
}

export const DEFAULT_PREVIEW: WoodPreviewOptions = {
  speciesId: "tilo",
  power: 35,
  speed: 3600,
  passes: 1,
  showCut: true,
  showEngrave: true,
  showGuides: true,
};

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

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function noise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf;
}

function fbm(x: number, y: number, seed: number, octaves = 3): number {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    v += noise2(x * f, y * f, seed + i * 17) * amp;
    f *= 2.03;
    amp *= 0.5;
  }
  return v;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const textureCache = new Map<string, HTMLCanvasElement>();

/** Textura de madera procedural cacheada. */
export function woodTexture(speciesId: string, width = 1100, height = 1100): HTMLCanvasElement {
  const sp = SPECIES_BY_ID[speciesId] || SPECIES[0];
  const key = `${sp.id}-${width}x${height}`;
  const hit = textureCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(width, height);
  const base = hexToRgb(sp.base);
  const light = hexToRgb(sp.light);
  const dark = hexToRgb(sp.dark);
  const grain = hexToRgb(sp.grain);
  const rnd = mulberry32(sp.id.length * 9176 + 13);
  const knots = Array.from({ length: Math.round(sp.knots * 4) }, () => ({
    x: rnd() * 0.9 + 0.05,
    y: rnd() * 0.9 + 0.05,
    r: 0.03 + rnd() * 0.06,
    strength: 0.35 + rnd() * 0.5,
  }));
  const scale = sp.scale;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;
      const i = (y * width + x) * 4;
      let col = base;
      if (!sp.flat) {
        const warp = (fbm(u * 1.4 * scale, v * 0.3 * scale, 7) - 0.5) * 0.3;
        const figure = (fbm(u * 0.8, v * 1.2, 3) - 0.5) * 0.5;
        const rings = Math.sin((v * 68 * scale + u * 1.1 + warp * 18 + figure * 3) * Math.PI * 2);
        const fine = (fbm(u * 12 * scale, v * 90 * scale, 19) - 0.5) * 2;
        const broad = (fbm(u * 0.9 * scale, v * 2.6 * scale, 3) - 0.5) * 2;
        const tone = Math.max(0, Math.min(1, 0.5 + rings * 0.1 * sp.grainStrength + fine * 0.14 * sp.grainStrength + broad * 0.08));
        col = mix(light, dark, tone);
        if (rings > 0.9) {
          col = mix(col, grain, Math.min(0.34, (rings - 0.9) * 2.1 * sp.grainStrength));
        }
        // poros alargados en el sentido de la veta
        const pore = fbm(u * 2.4 * scale, v * 150 * scale, 41);
        if (pore > 0.8) col = mix(col, grain, (pore - 0.8) * 1.2 * sp.grainStrength);
        // vetas largas suaves
        const streak = fbm(u * 4.5 * scale, v * 16 * scale, 61);
        if (streak > 0.76) col = mix(col, grain, (streak - 0.76) * 0.7);
        // nudos
        for (const k of knots) {
          const dx = (u - k.x) * width;
          const dy = (v - k.y) * height * 2.2;
          const d = Math.sqrt(dx * dx + dy * dy) / (k.r * width);
          if (d < 2.5) {
            const ring = Math.sin(d * 18 + fbm(u * 8, v * 8, 5) * 4) * 0.5 + 0.5;
            const f = Math.max(0, 1 - d / 2.5) * k.strength;
            col = mix(col, mix(grain, dark, ring), f * 0.55);
          }
        }
      }
      const sp2 = (rnd() - 0.5) * sp.speckle * 34;
      const shade = ((x / width - 0.5) ** 2 + (y / height - 0.5) ** 2) * 12;
      img.data[i] = Math.max(0, Math.min(255, col[0] + sp2 - shade));
      img.data[i + 1] = Math.max(0, Math.min(255, col[1] + sp2 - shade));
      img.data[i + 2] = Math.max(0, Math.min(255, col[2] + sp2 - shade));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  textureCache.set(key, canvas);
  return canvas;
}

function fillContours(ctx: CanvasRenderingContext2D, contours: Contour[], scale: number): void {
  if (!contours.length) return;
  ctx.beginPath();
  for (const c of contours) {
    if (c.length < 2) continue;
    ctx.moveTo(c[0].x * scale, c[0].y * scale);
    for (let i = 1; i < c.length; i++) ctx.lineTo(c[i].x * scale, c[i].y * scale);
    ctx.closePath();
  }
  ctx.fill("evenodd");
}

function strokeContours(ctx: CanvasRenderingContext2D, contours: Contour[], scale: number): void {
  if (!contours.length) return;
  ctx.beginPath();
  for (const c of contours) {
    if (c.length < 2) continue;
    ctx.moveTo(c[0].x * scale, c[0].y * scale);
    for (let i = 1; i < c.length; i++) ctx.lineTo(c[i].x * scale, c[i].y * scale);
    ctx.closePath();
  }
  ctx.stroke();
}

/** Fuerza de quemado 0..1.5 según potencia, velocidad y pasadas. */
export function burnStrength(power: number, speed: number, passes: number): number {
  const p = Math.max(0, Math.min(1, power / 100));
  const v = Math.max(0.1, speed) / 3000;
  return Math.max(0.04, Math.min(1.5, Math.pow(p, 1.25) * Math.pow(1 / v, 0.55) * Math.pow(Math.max(1, passes), 0.45)));
}

/** Máscara de la imagen raster teñida de color de quemado. */
const rasterMaskCache = new Map<string, HTMLCanvasElement>();

function rasterMask(part: Part, image: HTMLImageElement, char: string): HTMLCanvasElement | null {
  if (!part.raster) return null;
  const key = `${part.id}-${part.raster.dataUrl.length}-${char}`;
  const hit = rasterMaskCache.get(key);
  if (hit) return hit;
  const w = Math.min(1600, image.naturalWidth || image.width);
  const h = Math.min(1600, image.naturalHeight || image.height);
  if (!w || !h) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const [cr, cg, cb] = hexToRgb(char);
  for (let i = 0; i < data.data.length; i += 4) {
    const a = data.data[i + 3] / 255;
    const lum = (0.2126 * data.data[i] + 0.7152 * data.data[i + 1] + 0.0722 * data.data[i + 2]) / 255;
    const burn = Math.max(0, Math.min(1, (1 - lum) * a));
    data.data[i] = cr;
    data.data[i + 1] = cg;
    data.data[i + 2] = cb;
    data.data[i + 3] = Math.round(burn * 255);
  }
  ctx.putImageData(data, 0, 0);
  rasterMaskCache.set(key, canvas);
  return canvas;
}

/**
 * Dibuja la previsualización en un canvas ya dimensionado.
 * `images` contiene las imágenes cargadas de las piezas raster.
 */
export function renderWoodPreview(
  canvas: HTMLCanvasElement,
  doc: Doc,
  page: number,
  options: WoodPreviewOptions,
  images: Map<string, HTMLImageElement> = new Map(),
): void {
  const sp = SPECIES_BY_ID[options.speciesId] || SPECIES[0];
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext("2d")!;
  const scale = Math.min(W / doc.sheet.width, H / doc.sheet.height);
  const offX = (W - doc.sheet.width * scale) / 2;
  const offY = (H - doc.sheet.height * scale) / 2;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#241a12";
  ctx.fillRect(0, 0, W, H);

  // textura y sombra de canto
  ctx.save();
  ctx.translate(offX, offY);
  const tex = woodTexture(sp.id, 1100, 1100);
  ctx.drawImage(tex, 0, 0, doc.sheet.width * scale, doc.sheet.height * scale);
  ctx.strokeStyle = "rgba(0,0,0,.55)";
  ctx.lineWidth = 6;
  ctx.strokeRect(0, 0, doc.sheet.width * scale, doc.sheet.height * scale);
  ctx.restore();

  const burn = document.createElement("canvas");
  burn.width = W;
  burn.height = H;
  const bctx = burn.getContext("2d")!;
  bctx.translate(offX, offY);
  bctx.scale(scale, scale);
  bctx.globalCompositeOperation = "source-over";
  bctx.fillStyle = sp.char;

  const partsById = new Map(doc.parts.map((p) => [p.id, p]));
  for (const pl of doc.placements.filter((p) => p.page === page)) {
    const part = partsById.get(pl.partId);
    if (!part) continue;
    const placed = placeEffective(part, pl);
    if (options.showEngrave && (part.operation === "engrave" || part.kind === "raster")) {
      if (part.kind === "raster") {
        const img = images.get(part.id);
        const mask = img ? rasterMask(part, img, sp.char) : null;
        if (mask) {
          const m = placed.matrix;
          bctx.save();
          bctx.setTransform(
            scale * m.a,
            scale * m.b,
            scale * m.c,
            scale * m.d,
            scale * m.e + offX,
            scale * m.f + offY,
          );
          bctx.globalAlpha = 1;
          bctx.drawImage(mask, placed.localBaseBounds.x, placed.localBaseBounds.y, placed.localBaseBounds.w, placed.localBaseBounds.h);
          bctx.restore();
        } else {
          bctx.save();
          bctx.globalAlpha = 0.55;
          fillContours(bctx, placed.base, 1);
          bctx.restore();
        }
      } else {
        fillContours(bctx, placed.base, 1);
      }
    }
    if (options.showEngrave && part.operation === "score") {
      bctx.globalAlpha = 0.7;
      bctx.lineWidth = 0.18;
      strokeContours(bctx, placed.base, 1);
      bctx.globalAlpha = 1;
    }
  }

  const strength = burnStrength(options.power, options.speed, options.passes);
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = Math.min(1, 0.16 + strength * 0.94);
  ctx.filter = "blur(0.35px)";
  ctx.drawImage(burn, 0, 0);
  // segunda pasada cálida para que el quemado tenga color de carbón
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = Math.min(0.32, strength * 0.3);
  ctx.drawImage(burn, 0, 0);
  ctx.restore();

  // líneas de corte nítidas con halo de quemado
  if (options.showCut) {
    ctx.save();
    ctx.translate(offX, offY);
    ctx.scale(scale, scale);
    ctx.strokeStyle = sp.char;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const pl of doc.placements.filter((p) => p.page === page)) {
      const part = partsById.get(pl.partId);
      if (!part) continue;
      const placed = placeEffective(part, pl);
      const geo = effectiveGeometry(part);
      const cut = part.operation === "cut" || geo.hasOffset;
      if (!cut) continue;
      // halo
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = Math.max(0.9, 2.6 / Math.max(0.5, scale));
      ctx.shadowColor = "rgba(44,22,5,.95)";
      ctx.shadowBlur = Math.max(3, scale * 1.8);
      strokeContours(ctx, placed.outer, 1);
      ctx.restore();
      // trazo nítido
      ctx.lineWidth = Math.max(0.3, 1.15 / Math.max(0.5, scale));
      ctx.strokeStyle = "#231307";
      strokeContours(ctx, placed.outer, 1);
      if (part.separateBorder && placed.inner.length) {
        ctx.save();
        ctx.globalAlpha = 0.7;
        strokeContours(ctx, placed.inner, 1);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  if (options.showGuides) {
    ctx.save();
    ctx.translate(offX, offY);
    ctx.strokeStyle = "rgba(255,246,225,.35)";
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    const m = doc.sheet.margin * scale;
    ctx.strokeRect(m, m, doc.sheet.width * scale - m * 2, doc.sheet.height * scale - m * 2);
    ctx.restore();
  }

  // borde de la pieza
  ctx.strokeStyle = "rgba(20,12,6,.3)";
  ctx.lineWidth = 1;
  ctx.strokeRect(offX, offY, doc.sheet.width * scale, doc.sheet.height * scale);
}

/** Exporta la previsualización como PNG. */
export function woodPreviewDataUrl(doc: Doc, page: number, options: WoodPreviewOptions, images: Map<string, HTMLImageElement>, width = 1600): string {
  const canvas = document.createElement("canvas");
  const aspect = doc.sheet.height / doc.sheet.width;
  canvas.width = width;
  canvas.height = Math.round(width * aspect);
  renderWoodPreview(canvas, doc, page, options, images);
  return canvas.toDataURL("image/png");
}

export function previewSvgPaths(doc: Doc, page: number): string {
  let out = "";
  for (const pl of doc.placements.filter((p) => p.page === page)) {
    const part = doc.parts.find((p) => p.id === pl.partId);
    if (!part) continue;
    const placed = placeEffective(part, pl);
    const geo = effectiveGeometry(part);
    const cut = part.operation === "cut" || geo.hasOffset;
    out += `<path d="${contoursToPath(placed.base, true)}" fill="none" stroke="#333" stroke-width=".2"/>`;
    if (cut) out += `<path d="${contoursToPath(placed.outer, true)}" fill="none" stroke="#000" stroke-width=".3"/>`;
  }
  return out;
}

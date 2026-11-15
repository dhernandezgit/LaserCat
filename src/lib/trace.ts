/** Trazado de imágenes a vectores, tramado y semitonos para grabado láser. */

import type { Contour, EngraveMode, Pt } from "../types";
import { cleanContours, simplifyForExport } from "./clipper";
import { contourArea, dedupe, smoothClosed } from "./geom";

export interface TraceOptions {
  threshold: number; // 0..255
  invert: boolean;
  alphaThreshold: number; // 0..255
  simplifyPx: number;
  minAreaMm2: number;
  dpi: number;
  smooth: number; // pasadas Chaikin
  removeBackground: boolean;
}

export const DEFAULT_TRACE: TraceOptions = {
  threshold: 160,
  invert: false,
  alphaThreshold: 40,
  simplifyPx: 0.6,
  minAreaMm2: 0.35,
  dpi: 300,
  smooth: 0,
  removeBackground: false,
};

export interface TraceResult {
  contours: Contour[];
  widthMm: number;
  heightMm: number;
  loops: number;
}

/** Luminancia 0..255 teniendo en cuenta alfa y fondo. */
export function luminanceAt(data: Uint8ClampedArray, i: number, bg: "white" | "black" = "white"): number {
  const a = data[i + 3] / 255;
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const base = bg === "white" ? 255 : 0;
  return lum * a + base * (1 - a);
}

export function buildMask(
  img: ImageData,
  options: Pick<TraceOptions, "threshold" | "invert" | "alphaThreshold" | "removeBackground">,
): Uint8Array {
  const { width, height, data } = img;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      let lum = luminanceAt(data, i);
      if (options.removeBackground) {
        // blanco de fondo o píxeles casi transparentes -> vacío
        if (a < options.alphaThreshold) lum = 255;
      }
      let on = lum < options.threshold;
      if (options.invert) on = !on;
      if (a < options.alphaThreshold) on = false;
      mask[y * width + x] = on ? 1 : 0;
    }
  }
  return mask;
}

/** Marching squares con padding: devuelve bucles en píxeles. */
export function marchingSquares(mask: Uint8Array, width: number, height: number): Pt[][] {
  const w = width + 2;
  const h = height + 2;
  const sample = (x: number, y: number): number => {
    const sx = x - 1;
    const sy = y - 1;
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) return 0;
    return mask[sy * width + sx];
  };

  const edges = new Map<string, { to: string; pt: Pt }[]>();
  const addEdge = (a: Pt, b: Pt) => {
    const ka = key(a);
    const kb = key(b);
    if (!edges.has(ka)) edges.set(ka, []);
    if (!edges.has(kb)) edges.set(kb, []);
    edges.get(ka)!.push({ to: kb, pt: b });
    edges.get(kb)!.push({ to: ka, pt: a });
  };
  const key = (p: Pt) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
  const mid = (x: number, y: number): Pt => ({ x, y });

  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const tl = sample(x, y);
      const tr = sample(x + 1, y);
      const br = sample(x + 1, y + 1);
      const bl = sample(x, y + 1);
      const c = tl * 8 + tr * 4 + br * 2 + bl;
      if (c === 0 || c === 15) continue;
      const top = mid(x + 0.5, y);
      const right = mid(x + 1, y + 0.5);
      const bottom = mid(x + 0.5, y + 1);
      const left = mid(x, y + 0.5);
      switch (c) {
        case 1: case 14: addEdge(left, bottom); break;
        case 2: case 13: addEdge(bottom, right); break;
        case 3: case 12: addEdge(left, right); break;
        case 4: case 11: addEdge(right, top); break;
        case 6: case 9: addEdge(top, bottom); break;
        case 7: case 8: addEdge(left, top); break;
        case 5: {
          // silla: decidir por el centro
          const center = (sample(x, y) + sample(x + 1, y) + sample(x, y + 1) + sample(x + 1, y + 1)) / 4;
          if (center >= 0.5) {
            addEdge(left, top);
            addEdge(bottom, right);
          } else {
            addEdge(left, bottom);
            addEdge(top, right);
          }
          break;
        }
        case 10: {
          const center = (sample(x, y) + sample(x + 1, y) + sample(x, y + 1) + sample(x + 1, y + 1)) / 4;
          if (center >= 0.5) {
            addEdge(left, bottom);
            addEdge(top, right);
          } else {
            addEdge(left, top);
            addEdge(bottom, right);
          }
          break;
        }
        default: break;
      }
    }
  }

  const used = new Set<string>();
  const loops: Pt[][] = [];
  const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  for (const [start, list] of edges) {
    for (const first of list) {
      const ek = edgeKey(start, first.to);
      if (used.has(ek)) continue;
      const loop: Pt[] = [];
      let current = start;
      let prev = "";
      let guard = 0;
      while (guard++ < 500000) {
        const options = edges.get(current) || [];
        let next: { to: string; pt: Pt } | null = null;
        let best = Infinity;
        for (const opt of options) {
          const k = edgeKey(current, opt.to);
          if (used.has(k)) continue;
          // preferir no volver por donde vinimos salvo que sea la única opción
          if (opt.to === prev) continue;
          next = opt;
          break;
        }
        if (!next) {
          for (const opt of options) {
            const k = edgeKey(current, opt.to);
            if (!used.has(k)) { next = opt; break; }
          }
        }
        if (!next) break;
        used.add(edgeKey(current, next.to));
        loop.push(parseKey(current));
        prev = current;
        current = next.to;
        if (current === start) break;
      }
      if (loop.length >= 3 && current === start) loops.push(dedupe(loop, 0.01));
    }
  }
  return loops;
}

function parseKey(k: string): Pt {
  const [x, y] = k.split(",").map(Number);
  return { x, y };
}

/** Traza una imagen completa a contornos en mm. */
export function traceImage(img: ImageData, options: TraceOptions): TraceResult {
  const mask = buildMask(img, options);
  let loops = marchingSquares(mask, img.width, img.height);
  const scale = 25.4 / options.dpi;
  const pxToMm2 = scale * scale;
  loops = loops
    .map((l) => l.map((p) => ({ x: (p.x + 0.5) * scale, y: (p.y + 0.5) * scale })))
    .filter((l) => Math.abs(contourArea(l)) * 1 >= options.minAreaMm2);
  if (options.simplifyPx > 0) {
    loops = loops.map((l) => simplifyForExport([l], options.simplifyPx * scale)[0]).filter(Boolean) as Contour[];
  }
  if (options.smooth > 0) {
    loops = loops.map((l) => smoothClosed(l, Math.min(2, options.smooth)));
  }
  const cleaned = cleanContours(loops, "evenodd");
  return {
    contours: cleaned,
    widthMm: img.width * scale,
    heightMm: img.height * scale,
    loops: cleaned.length,
  };
}

/** Umbral simple: devuelve una copia B/N (para PNG de grabado). */
export function thresholdImage(img: ImageData, threshold: number, invert = false): ImageData {
  const out = new ImageData(img.width, img.height);
  for (let i = 0; i < img.data.length; i += 4) {
    let on = luminanceAt(img.data, i) < threshold;
    if (invert) on = !on;
    const v = on ? 0 : 255;
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
    out.data[i + 3] = 255;
  }
  return out;
}

export function invertImage(img: ImageData): ImageData {
  const out = new ImageData(img.width, img.height);
  for (let i = 0; i < img.data.length; i += 4) {
    out.data[i] = 255 - img.data[i];
    out.data[i + 1] = 255 - img.data[i + 1];
    out.data[i + 2] = 255 - img.data[i + 2];
    out.data[i + 3] = img.data[i + 3];
  }
  return out;
}

/** Floyd–Steinberg; `strength` 0..1 amortigua el error. */
export function ditherFloydSteinberg(img: ImageData, threshold = 128, strength = 1): ImageData {
  const { width, height } = img;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const j = i * 4;
    gray[i] = luminanceAt(img.data, j);
  }
  const out = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = gray[i];
      const v = old < threshold ? 0 : 255;
      out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
      out.data[i * 4 + 3] = 255;
      const err = (old - v) * strength;
      if (x + 1 < width) gray[i + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) gray[i + width - 1] += (err * 3) / 16;
        gray[i + width] += (err * 5) / 16;
        if (x + 1 < width) gray[i + width + 1] += err / 16;
      }
    }
  }
  return out;
}

/** Atkinson: más contraste y menos puntos que Floyd–Steinberg. */
export function ditherAtkinson(img: ImageData, threshold = 128): ImageData {
  const { width, height } = img;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) gray[i] = luminanceAt(img.data, i * 4);
  const out = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = gray[i];
      const v = old < threshold ? 0 : 255;
      out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
      out.data[i * 4 + 3] = 255;
      const err = (old - v) / 8;
      if (x + 1 < width) gray[i + 1] += err;
      if (x + 2 < width) gray[i + 2] += err;
      if (y + 1 < height) {
        if (x > 0) gray[i + width - 1] += err;
        gray[i + width] += err;
        if (x + 1 < width) gray[i + width + 1] += err;
      }
      if (y + 2 < height) gray[i + 2 * width] += err;
    }
  }
  return out;
}

const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];

/** Tramado ordenado 8×8 determinista. */
export function ditherOrdered(img: ImageData, threshold = 128): ImageData {
  const out = new ImageData(img.width, img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      const lum = luminanceAt(img.data, i);
      const b = (BAYER8[(y % 8) * 8 + (x % 8)] + 0.5) / 64;
      const v = lum / 255 < b ? 0 : 255;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
      out.data[i + 3] = 255;
    }
  }
  return out;
}

export function prepareEngraveImage(img: ImageData, mode: EngraveMode, threshold = 128, invert = false): ImageData {
  let src = invert ? invertImage(img) : img;
  if (mode === "threshold") return thresholdImage(src, threshold, false);
  if (mode === "dither") return ditherFloydSteinberg(src, threshold);
  return src;
}

export interface HalftoneOptions {
  dotsPerMm: number;
  maxDots?: number;
  gamma?: number;
}

/** Semitono vectorial: puntos de radio proporcional a la oscuridad. */
export function halftoneDots(img: ImageData, mmW: number, mmH: number, options: HalftoneOptions): Contour[] {
  const dpm = Math.max(0.8, options.dotsPerMm);
  const cell = 1 / dpm;
  const cols = Math.max(1, Math.min(1400, Math.floor(mmW / cell)));
  const rows = Math.max(1, Math.min(1400, Math.floor(mmH / cell)));
  const sx = img.width / cols;
  const sy = img.height / rows;
  const gamma = options.gamma ?? 1;
  const out: Contour[] = [];
  const maxDots = options.maxDots ?? 26000;
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      let sum = 0;
      let n = 0;
      const x0 = Math.floor(gx * sx);
      const x1 = Math.min(img.width, Math.ceil((gx + 1) * sx));
      const y0 = Math.floor(gy * sy);
      const y1 = Math.min(img.height, Math.ceil((gy + 1) * sy));
      const step = Math.max(1, Math.floor(Math.max(1, (x1 - x0) * (y1 - y0)) / 30));
      for (let y = y0; y < y1; y += step) {
        for (let x = x0; x < x1; x += step) {
          sum += luminanceAt(img.data, (y * img.width + x) * 4);
          n++;
        }
      }
      if (!n) continue;
      const lum = sum / n;
      const ink = Math.pow(1 - lum / 255, gamma);
      if (ink < 0.06) continue;
      const r = Math.min(cell * 0.62, Math.sqrt(ink) * cell * 0.7);
      const cx = gx * cell + cell / 2;
      const cy = gy * cell + cell / 2;
      const seg = Math.max(6, Math.min(18, Math.ceil((r * Math.PI * 2) / 0.35)));
      const contour: Contour = [];
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        contour.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
      out.push(contour);
      if (out.length >= maxDots) return cleanContours(out, "nonzero");
    }
  }
  return cleanContours(out, "nonzero");
}

// ------------------------------------------------------------ canvas helpers --

export function imageDataToCanvas(img: ImageData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext("2d")!.putImageData(img, 0, 0);
  return canvas;
}

export function imageDataToDataUrl(img: ImageData): string {
  return imageDataToCanvas(img).toDataURL("image/png");
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo abrir la imagen."));
    img.src = src;
  });
}

export function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("No se pudo leer el archivo."));
    fr.readAsDataURL(file);
  });
}

/** Carga y reduce una imagen para trabajar cómodamente en el navegador. */
export async function loadImageData(
  file: File,
  maxDim = 2200,
  keepAlpha = true,
): Promise<{ image: ImageData; originalWidth: number; originalHeight: number; dataUrl: string }> {
  const dataUrl = await fileToDataUrl(file);
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  if (!keepAlpha) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(img, 0, 0, w, h);
  return {
    image: ctx.getImageData(0, 0, w, h),
    originalWidth: img.naturalWidth,
    originalHeight: img.naturalHeight,
    dataUrl: canvas.toDataURL("image/png"),
  };
}

export { dedupe };

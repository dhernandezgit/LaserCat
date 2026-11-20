/**
 * Recorta automáticamente el espacio transparente de las imágenes incrustadas
 * en un SVG. Se hace sobre el propio SVG, antes de importarlo, para que la caja
 * de la imagen, sus grupos y su posición en la plancha usen solo la parte que
 * realmente tiene opacidad.
 *
 * Todo ocurre en el navegador. Si no hay canvas (por ejemplo en un test de
 * Node) se devuelve el SVG original sin tocar.
 */

import { loadImage } from "./trace";

const SCAN_MAX = 1200;
const OUT_MAX = 4096;
const ALPHA_THRESHOLD = 1;

function getHref(el: Element): string {
  return (
    el.getAttribute("href") ||
    el.getAttributeNS("http://www.w3.org/1999/xlink", "href") ||
    el.getAttribute("xlink:href") ||
    ""
  );
}

function setHref(el: Element, href: string): void {
  if (el.hasAttribute("href")) el.setAttribute("href", href);
  if (el.hasAttributeNS("http://www.w3.org/1999/xlink", "href")) {
    el.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", href);
  } else if (el.hasAttribute("xlink:href")) {
    el.setAttribute("xlink:href", href);
  } else if (!el.hasAttribute("href")) {
    el.setAttribute("href", href);
  }
}

function numberValue(el: Element, name: string, fallback = NaN): { value: number; unit: string } {
  const raw = (el.getAttribute(name) || "").trim();
  const match = raw.match(/^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i);
  if (!match) return { value: fallback, unit: "" };
  return { value: parseFloat(match[1]), unit: match[2] || "" };
}

function setNumberValue(el: Element, name: string, value: number, unit: string): void {
  el.setAttribute(name, `${Math.round(value * 1000) / 1000}${unit}`);
}

interface Crop {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  transparent: boolean;
}

/**
 * Devuelve el rectángulo opaco en fracciones 0..1.
 * `transparent` indica que no hay ningún píxel visible.
 */
async function alphaRect(dataUrl: string): Promise<Crop | null> {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  const sw = Math.max(1, Math.min(SCAN_MAX, w));
  const sh = Math.max(1, Math.min(SCAN_MAX, h));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.clearRect(0, 0, sw, sh);
  ctx.drawImage(img, 0, 0, sw, sh);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, sw, sh).data;
  } catch {
    return null;
  }
  let minX = sw;
  let minY = sh;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (data[(y * sw + x) * 4 + 3] <= ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) {
    return { x0: 0, y0: 0, x1: 1, y1: 1, transparent: true };
  }
  return {
    x0: minX / sw,
    y0: minY / sh,
    x1: (maxX + 1) / sw,
    y1: (maxY + 1) / sh,
    transparent: false,
  };
}

function cropDataUrl(img: HTMLImageElement, crop: Crop): string {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const sx = Math.floor(crop.x0 * w);
  const sy = Math.floor(crop.y0 * h);
  const sw = Math.max(1, Math.ceil((crop.x1 - crop.x0) * w));
  const sh = Math.max(1, Math.ceil((crop.y1 - crop.y0) * h));
  const factor = Math.min(1, OUT_MAX / Math.max(sw, sh));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(sw * factor));
  out.height = Math.max(1, Math.round(sh * factor));
  const ctx = out.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

/**
 * Recorta las imágenes con transparencia y elimina las que son totalmente
 * transparentes. Las imágenes opacas se dejan intactas.
 */
export async function trimSvgImages(svgText: string): Promise<string> {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof DOMParser === "undefined" ||
    typeof XMLSerializer === "undefined"
  ) {
    return svgText;
  }
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  } catch {
    return svgText;
  }
  const images = Array.from(doc.querySelectorAll("image"));
  let changed = false;
  for (const el of images) {
    const href = getHref(el).trim();
    if (!/^data:image\//i.test(href)) continue;
    const x = numberValue(el, "x", 0);
    const y = numberValue(el, "y", 0);
    const width = numberValue(el, "width", 0);
    const height = numberValue(el, "height", 0);
    if (width.value <= 0 || height.value <= 0) continue;
    let crop: Crop | null = null;
    let img: HTMLImageElement | null = null;
    try {
      crop = await alphaRect(href);
      if (crop && !crop.transparent) img = await loadImage(href);
    } catch {
      continue;
    }
    if (!crop) continue;
    if (crop.transparent) {
      el.parentNode?.removeChild(el);
      changed = true;
      continue;
    }
    if (crop.x0 <= 0 && crop.y0 <= 0 && crop.x1 >= 1 && crop.y1 >= 1) continue;
    if (!img) continue;
    const dataUrl = cropDataUrl(img, crop);
    if (!dataUrl) continue;
    setHref(el, dataUrl);
    setNumberValue(el, "x", x.value + width.value * crop.x0, x.unit);
    setNumberValue(el, "y", y.value + height.value * crop.y0, y.unit);
    setNumberValue(el, "width", width.value * (crop.x1 - crop.x0), width.unit);
    setNumberValue(el, "height", height.value * (crop.y1 - crop.y0), height.unit);
    changed = true;
  }
  if (!changed) return svgText;
  try {
    return new XMLSerializer().serializeToString(doc);
  } catch {
    return svgText;
  }
}

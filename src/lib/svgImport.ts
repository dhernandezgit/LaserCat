/**
 * Importador SVG propio: unidades, transformaciones, trazos, huecos y
 * separación inteligente de piezas.
 *
 * Estrategia: cada SVG se convierte a contornos en mm. Los subpaths se
 * agrupan en "islas" (exterior + huecos) y luego se unen por cercanía y por
 * los grupos explícitos del archivo. Así un único <path> con 40 iconos se
 * separa en 40 piezas, pero las partes de un mismo icono siguen juntas.
 */

import type { Bounds, Contour, Operation, Pt, RasterData, SvgFillRule } from "../types";
import { cleanContours, differenceContours, strokeOutline, unionContours } from "./clipper";
import {
  boundsGap,
  boundsContains,
  boundsOf,
  contoursBounds,
  contourArea,
  dedupe,
  distancePointToSegment,
  fmt,
  pointInContour,
  rectContour,
  simplifyRDP,
} from "./geom";

export interface ImportOptions {
  /** mm de separación máxima para considerar que dos islas son una pieza. */
  tolerance: number;
  mode: "inteligente" | "grupos" | "formas" | "todo";
  /** Ancho final en mm; si falta, se usa el tamaño real del SVG. */
  targetWidth?: number;
  targetHeight?: number;
  /** Trazo sin relleno: contorno de corte o línea de grabado. */
  strokeMode: "cut" | "engrave";
  /** Simplificación final en mm (0 = sin simplificar). */
  simplify: number;
  /** Interpreta blancos interiores como huecos (por defecto sí). */
  whiteAsHoles?: boolean;
}

export interface ImportIsland {
  id: string;
  contours: Contour[];
  bbox: { x: number; y: number; w: number; h: number };
  chain: string[];
  labels: Record<string, string>;
  elementId: string;
  sourceIndex: number;
  /** Forma blanca: se trata como hueco dentro de una pieza oscura. */
  negative: boolean;
}

export interface ImportedPart {
  id: string;
  name: string;
  contours: Contour[];
  width: number;
  height: number;
  islandIds: string[];
  groupLabel?: string;
  color: string;
  /** Contornos en su posición original del SVG (para el mapa de piezas). */
  sourceContours: Contour[];
  sourceBounds: { x: number; y: number; w: number; h: number };
  kind: "vector" | "raster";
  raster?: RasterData;
  operation?: Operation;
}

export interface ImportedGroup {
  id: string;
  name: string;
  memberIds: string[];
  color?: string;
}

export interface SvgImportResult {
  parts: ImportedPart[];
  groups: ImportedGroup[];
  islands: ImportIsland[];
  widthMm: number;
  heightMm: number;
  warnings: string[];
  hasGroups: boolean;
  groupCount: number;
  units: "mm" | "cm" | "in" | "pt" | "px" | "viewbox";
  elementCount: number;
  textCount: number;
  scale: number;
}

const PALETTE = [
  "#b5651d", "#2e6f6b", "#8a4f7d", "#4b6b8a", "#96702c", "#7a5230",
  "#5b7f4b", "#a24e3f", "#6d5b9a", "#3f7d8c", "#9c6b3f", "#7d7d3f",
];

const INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape";

function labelOf(el: Element): string {
  return (
    el.getAttributeNS(INKSCAPE_NS, "label") ||
    el.getAttribute("inkscape:label") ||
    el.getAttribute("data-name") ||
    el.getAttribute("aria-label") ||
    ""
  );
}

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
type Style = { fill: string; stroke: string; strokeWidth: number; fillRule: SvgFillRule; opacity: number };

interface RawShape {
  contours: Contour[];
  chain: string[];
  labels: Record<string, string>;
  elementId: string;
  groupLabel?: string;
  index: number;
  negative: boolean;
}

interface RawImage {
  dataUrl: string;
  label: string;
  elementId: string;
  chain: string[];
  labels: Record<string, string>;
  bbox: Bounds;
  index: number;
}

/** Lee ancho/alto de un PNG en data URL sin decodificar toda la imagen. */
function pngPixelSize(dataUrl: string): { w: number; h: number } | null {
  try {
    const comma = dataUrl.indexOf(",");
    if (comma < 0 || !/^data:image\/png;base64,/i.test(dataUrl.slice(0, comma + 1))) return null;
    const head = dataUrl.slice(comma + 1, comma + 80);
    const bin = atob(head);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (bytes.length < 24) return null;
    if (!(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) return null;
    const w = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const h = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    if (!w || !h) return null;
    return { w, h };
  } catch {
    return null;
  }
}

/** ¿El relleno es blanco (o casi)? Un blanco interior suele ser un hueco. */
export function isWhiteFill(fill: string): boolean {
  const f = fill.trim().toLowerCase();
  if (!f || f === "none" || f === "transparent" || f.startsWith("url(")) return false;
  if (f === "white" || f === "#fff" || f === "#ffffff") return true;
  if (f.startsWith("#") && (f.length === 7 || f.length === 4)) {
    let r: number, g: number, b: number;
    if (f.length === 4) {
      r = parseInt(f[1] + f[1], 16);
      g = parseInt(f[2] + f[2], 16);
      b = parseInt(f[3] + f[3], 16);
    } else {
      r = parseInt(f.slice(1, 3), 16);
      g = parseInt(f.slice(3, 5), 16);
      b = parseInt(f.slice(5, 7), 16);
    }
    return r > 245 && g > 245 && b > 245;
  }
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(f);
  if (m) return Number(m[1]) > 245 && Number(m[2]) > 245 && Number(m[3]) > 245;
  return false;
}

function mul(m1: Matrix, m2: Matrix): Matrix {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

function apply(m: Matrix, p: Pt): Pt {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

function matScale(m: Matrix): number {
  return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
}

export function parseTransform(text: string | null): Matrix {
  let m = { ...IDENTITY };
  if (!text) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const name = match[1].toLowerCase();
    const vals = match[2]
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    let t: Matrix = { ...IDENTITY };
    if (name === "matrix" && vals.length >= 6) {
      t = { a: vals[0], b: vals[1], c: vals[2], d: vals[3], e: vals[4], f: vals[5] };
    } else if (name === "translate") {
      t.e = vals[0] || 0;
      t.f = vals[1] || 0;
    } else if (name === "scale") {
      t.a = vals[0] ?? 1;
      t.d = vals[1] ?? t.a;
    } else if (name === "rotate") {
      const a = ((vals[0] || 0) * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const cx = vals[1] || 0;
      const cy = vals[2] || 0;
      t = { a: cos, b: sin, c: -sin, d: cos, e: cx - cos * cx + sin * cy, f: cy - sin * cx - cos * cy };
    } else if (name === "skewx") {
      t.c = Math.tan(((vals[0] || 0) * Math.PI) / 180);
    } else if (name === "skewy") {
      t.b = Math.tan(((vals[0] || 0) * Math.PI) / 180);
    }
    m = mul(m, t);
  }
  return m;
}

export function parseLength(value: string | null, fallback = NaN): number {
  if (!value) return fallback;
  const s = value.trim().toLowerCase();
  if (!s || s === "auto" || s === "100%") return fallback;
  const m = /^(-?[\d.]+(?:e[-+]?\d+)?)\s*(mm|cm|in|pt|pc|px)?$/.exec(s);
  if (!m) return fallback;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return fallback;
  switch (m[2]) {
    case "mm": return n;
    case "cm": return n * 10;
    case "in": return n * 25.4;
    case "pt": return (n * 25.4) / 72;
    case "pc": return (n * 25.4) / 6;
    case "px":
    case undefined:
      return (n * 25.4) / 96;
    default:
      return n;
  }
}

/** Convierte declaraciones style="..." en un mapa. */
function parseStyle(text: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!text) return out;
  for (const part of text.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}

function attrOrStyle(el: Element, name: string, style: Record<string, string>): string | null {
  return style[name] ?? el.getAttribute(name);
}

function inheritedStyle(el: Element, parent: Style): Style {
  const style = parseStyle(el.getAttribute("style"));
  const fill = attrOrStyle(el, "fill", style);
  const stroke = attrOrStyle(el, "stroke", style);
  const sw = attrOrStyle(el, "stroke-width", style);
  const rule = attrOrStyle(el, "fill-rule", style);
  return {
    fill: fill ?? parent.fill,
    stroke: stroke ?? parent.stroke,
    strokeWidth: sw ? parseFloat(sw.replace(/[a-z%]+$/i, "")) || 0 : parent.strokeWidth,
    fillRule: (rule === "evenodd" ? "evenodd" : rule === "nonzero" ? "nonzero" : parent.fillRule) as SvgFillRule,
    opacity: (() => {
      const op = attrOrStyle(el, "opacity", style);
      const fo = attrOrStyle(el, "fill-opacity", style);
      const o = op !== null ? parseFloat(op) : 1;
      const f = fo !== null ? parseFloat(fo) : 1;
      return Math.max(0, Math.min(1, (Number.isFinite(o) ? o : 1) * (Number.isFinite(f) ? f : 1)));
    })(),
  };
}

function hidden(el: Element): boolean {
  const style = parseStyle(el.getAttribute("style"));
  const display = attrOrStyle(el, "display", style);
  const visibility = attrOrStyle(el, "visibility", style);
  const opacity = attrOrStyle(el, "opacity", style);
  return display === "none" || visibility === "hidden" || opacity === "0";
}

// ------------------------------------------------------------------ paths --

const NUM = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

export interface PathCmd {
  cmd: string;
  args: number[];
}

export function tokenizePath(d: string): PathCmd[] {
  const cmds: PathCmd[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/g;
  let current: PathCmd | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    if (m[1]) {
      current = { cmd: m[1], args: [] };
      cmds.push(current);
    } else if (current) {
      current.args.push(parseFloat(m[2]));
    }
  }
  return cmds;
}

/** Aplana una curva cúbica en puntos (incluye el punto final). */
export function flattenCubic(
  p0: Pt,
  p1: Pt,
  p2: Pt,
  p3: Pt,
  tol: number,
  out: Pt[],
): void {
  const len =
    Math.hypot(p1.x - p0.x, p1.y - p0.y) +
    Math.hypot(p2.x - p1.x, p2.y - p1.y) +
    Math.hypot(p3.x - p2.x, p3.y - p2.y);
  const n = Math.max(2, Math.min(160, Math.ceil(len / Math.max(tol, 0.01))));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const x = u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x;
    const y = u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y;
    out.push({ x, y });
  }
}

/** Arco SVG a puntos intermedios (sin incluir el punto inicial). */
export function arcPoints(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  rotation: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
  tol: number,
): Pt[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx < 1e-9 || ry < 1e-9) return [{ x: x2, y: y2 }];
  const phi = (rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const sign = largeArc !== sweep ? 1 : -1;
  let num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  num = Math.max(0, num);
  const coef = sign * Math.sqrt(num / den || 0);
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1;
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const theta1 = angle(1, 0, ux, uy);
  let dtheta = angle(ux, uy, vx, vy);
  if (!sweep && dtheta > 0) dtheta -= Math.PI * 2;
  else if (sweep && dtheta < 0) dtheta += Math.PI * 2;
  const r = Math.max(rx, ry);
  const n = Math.max(2, Math.min(256, Math.ceil(Math.abs(dtheta) * r / Math.max(tol, 0.02))));
  const out: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = theta1 + (dtheta * i) / n;
    out.push({
      x: cx + cos * rx * Math.cos(t) - sin * ry * Math.sin(t),
      y: cy + sin * rx * Math.cos(t) + cos * ry * Math.sin(t),
    });
  }
  return out;
}

/** Devuelve subpaths abiertos/cerrados en unidades del SVG. */
export function parsePathData(d: string, tol = 0.05): { points: Pt[]; closed: boolean }[] {
  const cmds = tokenizePath(d);
  const subs: { points: Pt[]; closed: boolean }[] = [];
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  let prevCtrl: Pt | null = null;
  let prevQCtrl: Pt | null = null;
  let sub: Pt[] | null = null;
  let subClosed = false;

  const ensure = () => {
    if (!sub) {
      sub = [{ ...cur }];
      subs.push({ points: sub, closed: false });
    }
    return sub;
  };
  const flush = () => {
    if (sub && sub.length > 0) {
      const last = subs[subs.length - 1];
      last.points = dedupe(sub, 1e-5);
      last.closed = subClosed;
    }
    sub = null;
    subClosed = false;
  };

  for (const { cmd, args } of cmds) {
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    let i = 0;
    const num = () => args[i++];
    if (C === "M") {
      flush();
      if (args.length < 2) continue;
      const x = num();
      const y = num();
      cur = rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
      start = { ...cur };
      sub = [{ ...cur }];
      subs.push({ points: sub, closed: false });
      prevCtrl = null;
      prevQCtrl = null;
      while (i + 1 < args.length) {
        const lx = num();
        const ly = num();
        cur = rel ? { x: cur.x + lx, y: cur.y + ly } : { x: lx, y: ly };
        ensure().push({ ...cur });
      }
      continue;
    }
    if (C === "Z") {
      if (sub) {
        subClosed = true;
        flush();
      }
      cur = { ...start };
      prevCtrl = null;
      prevQCtrl = null;
      continue;
    }
    if (!sub) {
      sub = [{ ...cur }];
      subs.push({ points: sub, closed: false });
    }
    if (C === "L") {
      while (i + 1 < args.length) {
        const x = num();
        const y = num();
        cur = rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
        ensure().push({ ...cur });
      }
      prevCtrl = null;
      prevQCtrl = null;
    } else if (C === "H") {
      while (i < args.length) {
        const x = num();
        cur = { x: rel ? cur.x + x : x, y: cur.y };
        ensure().push({ ...cur });
      }
      prevCtrl = null;
      prevQCtrl = null;
    } else if (C === "V") {
      while (i < args.length) {
        const y = num();
        cur = { x: cur.x, y: rel ? cur.y + y : y };
        ensure().push({ ...cur });
      }
      prevCtrl = null;
      prevQCtrl = null;
    } else if (C === "C") {
      while (i + 5 < args.length) {
        const p1 = rel ? { x: cur.x + num(), y: cur.y + num() } : { x: num(), y: num() };
        const p2 = rel ? { x: cur.x + num(), y: cur.y + num() } : { x: num(), y: num() };
        const p3 = rel ? { x: cur.x + num(), y: cur.y + num() } : { x: num(), y: num() };
        flattenCubic(cur, p1, p2, p3, tol, ensure());
        cur = p3;
        prevCtrl = p2;
        prevQCtrl = null;
      }
    } else if (C === "S") {
      while (i + 3 < args.length) {
        const p1 = prevCtrl ? { x: 2 * cur.x - prevCtrl.x, y: 2 * cur.y - prevCtrl.y } : { ...cur };
        const p2 = rel ? { x: cur.x + num(), y: cur.y + num() } : { x: num(), y: num() };
        const p3 = rel ? { x: cur.x + num(), y: cur.y + num() } : { x: num(), y: num() };
        flattenCubic(cur, p1, p2, p3, tol, ensure());
        cur = p3;
        prevCtrl = p2;
        prevQCtrl = null;
      }
    } else if (C === "Q") {
      while (i + 3 < args.length) {
        const q = rel ? { x: cur.x + num(), y: cur.y + num() } : { x: num(), y: num() };
        const p = rel ? { x: cur.x + num(), y: cur.y + num() } : { x: num(), y: num() };
        const p1 = { x: cur.x + (2 / 3) * (q.x - cur.x), y: cur.y + (2 / 3) * (q.y - cur.y) };
        const p2 = { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) };
        flattenCubic(cur, p1, p2, p, tol, ensure());
        cur = p;
        prevCtrl = null;
        prevQCtrl = q;
      }
    } else if (C === "T") {
      while (i + 1 < args.length) {
        const q: Pt = prevQCtrl ? { x: 2 * cur.x - prevQCtrl.x, y: 2 * cur.y - prevQCtrl.y } : { ...cur };
        const p = rel ? { x: cur.x + num(), y: cur.y + num() } : { x: num(), y: num() };
        const p1 = { x: cur.x + (2 / 3) * (q.x - cur.x), y: cur.y + (2 / 3) * (q.y - cur.y) };
        const p2 = { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) };
        flattenCubic(cur, p1, p2, p, tol, ensure());
        cur = p;
        prevCtrl = null;
        prevQCtrl = q;
      }
    } else if (C === "A") {
      while (i + 6 < args.length) {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = num() !== 0;
        const sweep = num() !== 0;
        const p = rel ? { x: cur.x + num(), y: cur.y + num() } : { x: num(), y: num() };
        const pts = arcPoints(cur.x, cur.y, rx, ry, rot, large, sweep, p.x, p.y, tol);
        ensure().push(...pts);
        cur = p;
        prevCtrl = null;
        prevQCtrl = null;
      }
    }
  }
  // no cerramos el último subpath si el usuario no lo pidió
  if (sub) {
    const last = subs[subs.length - 1];
    last.points = dedupe(sub, 1e-5);
    last.closed = subClosed;
  }
  return subs.filter((s) => s.points.length >= 2);
}

// ------------------------------------------------------------- element ops --

function contourFromPoints(points: Pt[], matrix: Matrix): Contour {
  return dedupe(points.map((p) => apply(matrix, p)), 1e-4);
}

function shapeToContours(el: Element, matrix: Matrix, tol: number): { contours: Contour[]; closed: boolean }[] {
  const tag = el.tagName.toLowerCase();
  const num = (n: string, d = 0) => {
    const v = parseFloat(el.getAttribute(n) || "");
    return Number.isFinite(v) ? v : d;
  };
  if (tag === "path") {
    const d = el.getAttribute("d") || "";
    const subs = parsePathData(d, tol);
    if (!subs.length) return [];
    // Un <path> puede tener varios subpaths que forman huecos entre sí:
    // se procesan juntos para respetar fill-rule.
    return [{
      contours: subs.map((s) => contourFromPoints(s.points, matrix)),
      closed: subs.every((s) => s.closed),
    }];
  }
  if (tag === "rect") {
    const x = num("x");
    const y = num("y");
    const w = num("width");
    const h = num("height");
    if (w <= 0 || h <= 0) return [];
    let rx = num("rx", -1);
    let ry = num("ry", -1);
    if (rx < 0 && ry >= 0) rx = ry;
    if (ry < 0 && rx >= 0) ry = rx;
    rx = Math.min(Math.max(0, rx), w / 2);
    ry = Math.min(Math.max(0, ry), h / 2);
    const pts: Pt[] = [];
    if (rx <= 0 || ry <= 0) {
      pts.push({ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h });
    } else {
      const steps = 10;
      const arc = (cx: number, cy: number, a0: number, a1: number) => {
        for (let i = 0; i <= steps; i++) {
          const a = a0 + ((a1 - a0) * i) / steps;
          pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
        }
      };
      arc(x + w - rx, y + ry, -Math.PI / 2, 0);
      arc(x + w - rx, y + h - ry, 0, Math.PI / 2);
      arc(x + rx, y + h - ry, Math.PI / 2, Math.PI);
      arc(x + rx, y + ry, Math.PI, (3 * Math.PI) / 2);
    }
    return [{ contours: [contourFromPoints(pts, matrix)], closed: true }];
  }
  if (tag === "circle" || tag === "ellipse") {
    const cx = num("cx");
    const cy = num("cy");
    const rx = tag === "circle" ? num("r") : num("rx");
    const ry = tag === "circle" ? num("r") : num("ry");
    if (rx <= 0 || ry <= 0) return [];
    const n = Math.max(24, Math.min(256, Math.ceil((Math.PI * Math.max(rx, ry)) / Math.max(tol, 0.02)) * 2));
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    }
    return [{ contours: [contourFromPoints(pts, matrix)], closed: true }];
  }
  if (tag === "line") {
    const pts = [
      { x: num("x1"), y: num("y1") },
      { x: num("x2"), y: num("y2") },
    ];
    return [{ contours: [contourFromPoints(pts, matrix)], closed: false }];
  }
  if (tag === "polyline" || tag === "polygon") {
    const raw = (el.getAttribute("points") || "").match(NUM)?.map(Number) ?? [];
    const pts: Pt[] = [];
    for (let i = 0; i + 1 < raw.length; i += 2) pts.push({ x: raw[i], y: raw[i + 1] });
    if (pts.length < 2) return [];
    return [{ contours: [contourFromPoints(pts, matrix)], closed: tag === "polygon" }];
  }
  return [];
}

/** Islas = contorno exterior + sus huecos. */
export function extractIslands(contours: Contour[]): Contour[][] {
  const items = contours
    .filter((c) => c.length >= 3 && Math.abs(contourArea(c)) > 1e-4)
    .map((c) => ({ c, b: boundsOf(c), area: Math.abs(contourArea(c)), depth: 0, parent: -1 }));
  if (!items.length) return [];
  // Unir solapes primero para que la jerarquía sea limpia.
  const merged = cleanContours(items.map((i) => i.c), "nonzero");
  return groupIslands(merged);
}

function groupIslands(contours: Contour[]): Contour[][] {
  const items = contours
    .filter((c) => c.length >= 3)
    .map((c) => ({ c, b: boundsOf(c), area: Math.abs(contourArea(c)), parent: -1, depth: 0 }));
  const pointInside = (p: Pt, c: Contour) => pointInContour(p, c);
  for (let i = 0; i < items.length; i++) {
    const inner = items[i];
    let best = -1;
    let bestArea = Infinity;
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      const outer = items[j];
      if (outer.area <= inner.area * 1.0001) continue;
      if (
        inner.b.x < outer.b.x - 0.01 ||
        inner.b.y < outer.b.y - 0.01 ||
        inner.b.x + inner.b.w > outer.b.x + outer.b.w + 0.01 ||
        inner.b.y + inner.b.h > outer.b.y + outer.b.h + 0.01
      ) {
        continue;
      }
      // punto interior del contorno pequeño, desplazado hacia su centro
      const c = inner.c;
      let samples = 0;
      let hits = 0;
      for (let k = 0; k < Math.min(c.length, 12); k += Math.max(1, Math.floor(c.length / 12))) {
        const p = c[k];
        const q = { x: p.x + (inner.b.x + inner.b.w / 2 - p.x) * 0.01, y: p.y + (inner.b.y + inner.b.h / 2 - p.y) * 0.01 };
        samples++;
        if (pointInside(q, outer.c)) hits++;
      }
      if (samples && hits / samples > 0.6 && outer.area < bestArea) {
        bestArea = outer.area;
        best = j;
      }
    }
    inner.parent = best;
  }
  // calcular profundidad y raíz
  for (let i = 0; i < items.length; i++) {
    let depth = 0;
    let p = items[i].parent;
    const guard = new Set<number>();
    while (p >= 0 && !guard.has(p)) {
      guard.add(p);
      depth++;
      p = items[p].parent;
    }
    items[i].depth = depth;
  }
  const roots = new Map<number, Contour[]>();
  for (let i = 0; i < items.length; i++) {
    // La isla es el ancestro de profundidad par más cercano: un hueco
    // pertenece a su exterior, pero una isla dentro de un hueco es nueva.
    let r = i;
    let guard = 0;
    while (items[r].parent >= 0 && items[r].depth % 2 === 1 && guard++ < 1000) {
      r = items[r].parent;
    }
    if (!roots.has(r)) roots.set(r, []);
    roots.get(r)!.push(items[i].c);
  }
  return Array.from(roots.values());
}

function chainId(chain: string[], depth: number): string {
  return chain.slice(0, depth).join("/");
}

function labelForChain(chain: string[], labels: Record<string, string>): string {
  for (let i = chain.length - 1; i >= 0; i--) {
    const l = labels[chain[i]];
    if (l && !/^(layer|group|g|svg|path|capa)$/i.test(l)) return l;
  }
  return "";
}

// --------------------------------------------------------------- main entry --

export function importSvg(svgText: string, options: ImportOptions): SvgImportResult {
  const warnings: string[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("El archivo no es un SVG válido.");
  }
  const root = doc.documentElement;
  if (root.tagName.toLowerCase() !== "svg") throw new Error("Falta el elemento <svg>.");

  const vbAttr = root.getAttribute("viewBox");
  const vb = (vbAttr || "")
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  const vbW = vb.length === 4 ? vb[2] : 0;
  const vbH = vb.length === 4 ? vb[3] : 0;
  const wAttr = root.getAttribute("width");
  const hAttr = root.getAttribute("height");
  const wMm = parseLength(wAttr, NaN);
  const hMm = parseLength(hAttr, NaN);
  let units: SvgImportResult["units"] = "mm";
  if (/in\s*$/i.test(wAttr || "")) units = "in";
  else if (/cm\s*$/i.test(wAttr || "")) units = "cm";
  else if (/pt\s*$/i.test(wAttr || "")) units = "pt";
  else if (/px\s*$/i.test(wAttr || "") || (!/[a-z]/i.test(wAttr || "") && wAttr)) units = "px";
  if (!wAttr && !hAttr) units = "viewbox";

  let baseW = Number.isFinite(wMm) ? wMm : vbW ? (vbW * 25.4) / 96 : 100;
  let baseH = Number.isFinite(hMm) ? hMm : vbH ? (vbH * 25.4) / 96 : 100;
  if (!Number.isFinite(baseW) || baseW <= 0) baseW = 100;
  if (!Number.isFinite(baseH) || baseH <= 0) baseH = 100;

  // Escala del viewBox, respetando preserveAspectRatio (meet por defecto)
  let sx = 1;
  let sy = 1;
  let tx = 0;
  let ty = 0;
  if (vbW > 0 && vbH > 0) {
    const par = root.getAttribute("preserveAspectRatio") || "xMidYMid meet";
    const meet = !/slice/.test(par);
    if (meet) {
      const s = Math.min(baseW / vbW, baseH / vbH);
      sx = sy = s;
      tx = (baseW - vbW * s) / 2;
      ty = (baseH - vbH * s) / 2;
    } else {
      sx = baseW / vbW;
      sy = baseH / vbH;
    }
    if (/xMin/.test(par)) tx = 0;
    if (/xMax/.test(par)) tx = baseW - vbW * sx;
    if (/YMin/.test(par)) ty = 0;
    if (/YMax/.test(par)) ty = baseH - vbH * sy;
  } else if (vb.length === 4) {
    sx = baseW / (vbW || baseW);
    sy = baseH / (vbH || baseH);
  }
  const rootMatrix: Matrix = {
    a: sx,
    b: 0,
    c: 0,
    d: sy,
    e: tx - (vb[0] || 0) * sx,
    f: ty - (vb[1] || 0) * sy,
  };

  const rawShapes: RawShape[] = [];
  const rawImages: RawImage[] = [];
  const labels: Record<string, string> = {};
  let groupCount = 0;
  let textCount = 0;
  let elementCount = 0;
  let shapeIndex = 0;

  const walk = (el: Element, parentMatrix: Matrix, chain: string[], groupLabel: string, inherited: Style, depth: number) => {
    if (depth > 60) return;
    if (hidden(el)) return;
    const tag = el.tagName.toLowerCase();
    if (tag === "defs" || tag === "clippath" || tag === "mask" || tag === "filter" || tag === "metadata" || tag === "title" || tag === "desc") {
      return;
    }
    if (tag === "text" || tag === "tspan" || tag === "textpath") {
      textCount++;
      return;
    }
    const style = inheritedStyle(el, inherited);
    const elChain = chain;
    const elLabel = groupLabel;
    const local = mul(parentMatrix, parseTransform(el.getAttribute("transform")));

    if (tag === "image") {
      const href =
        el.getAttribute("href") ||
        el.getAttributeNS("http://www.w3.org/1999/xlink", "href") ||
        el.getAttribute("xlink:href") ||
        "";
      if (!/^data:image\//i.test(href)) {
        warnings.push("Una imagen del SVG no está incrustada (data URL) y no se puede importar.");
        return;
      }
      const num = (name: string, fallback = 0) => {
        const v = parseFloat(el.getAttribute(name) || "");
        return Number.isFinite(v) ? v : fallback;
      };
      const x = num("x");
      const y = num("y");
      const w = num("width");
      const h = num("height");
      if (w <= 0 || h <= 0) return;
      const corners = [
        apply(local, { x, y }),
        apply(local, { x: x + w, y }),
        apply(local, { x: x + w, y: y + h }),
        apply(local, { x, y: y + h }),
      ];
      const bbox = boundsOf(corners);
      if (bbox.w < 0.05 || bbox.h < 0.05) return;
      elementCount++;
      rawImages.push({
        dataUrl: href,
        label: labelOf(el) || el.getAttribute("id") || "",
        elementId: el.getAttribute("id") || `image${rawImages.length}`,
        chain: elChain,
        labels,
        bbox,
        index: shapeIndex++,
      });
      return;
    }

    if (tag === "g" || tag === "svg" || tag === "symbol" || tag === "a" || tag === "switch") {
      const id = el.getAttribute("id") || `g${groupCount}`;
      const label = labelOf(el) || el.getAttribute("id") || "";
      labels[id] = label;
      const isRealGroup = tag === "g";
      if (isRealGroup) groupCount++;
      const nextChain = isRealGroup ? [...elChain, id] : elChain;
      const nextLabel = label || elLabel;
      for (const child of Array.from(el.children)) {
        walk(child, local, nextChain, nextLabel, style, depth + 1);
      }
      return;
    }
    if (tag === "use") {
      const href = el.getAttribute("href") || el.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      if (href && href.startsWith("#")) {
        const target = doc.getElementById(href.slice(1));
        if (target) {
          const useMatrix = mul(local, {
            ...IDENTITY,
            e: parseFloat(el.getAttribute("x") || "0") || 0,
            f: parseFloat(el.getAttribute("y") || "0") || 0,
          });
          walk(target, useMatrix, elChain, elLabel, style, depth + 1);
        } else {
          warnings.push(`<use> sin destino: ${href}`);
        }
      }
      return;
    }

    if (!["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"].includes(tag)) return;
    elementCount++;
    const tol = 0.04 / Math.max(0.01, matScale(local));
    const shapes = shapeToContours(el, local, tol);
    if (!shapes.length) return;
    const fills: Contour[] = [];
    const strokes: Contour[] = [];
    const fillNone = style.fill === "none" || style.fill === "transparent" || style.opacity <= 0.02;
    const strokeNone = style.stroke === "none" || style.stroke === "transparent" || style.strokeWidth <= 0;
    for (const s of shapes) {
      if (!fillNone) {
        const clean = cleanContours(s.contours, style.fillRule);
        fills.push(...clean);
      }
      if (!strokeNone) strokes.push(...s.contours);
    }
    let contours = fills;
    if (strokes.length) {
      const w = Math.max(0.08, style.strokeWidth * matScale(local));
      const out = strokeOutline(strokes, w, shapes.every((s) => s.closed), "round");
      contours = contours.length ? unionContours([contours, out]) : out;
    }
    if (!contours.length) return;
    contours = cleanContours(contours, "nonzero");
    const b = contoursBounds(contours);
    if (b.w <= 1e-4 && b.h <= 1e-4) return;

    const id = el.getAttribute("id") || `shape${shapeIndex}`;
    const shapeLabel = labelOf(el);
    const groupLabel2 = shapeLabel || elLabel;
    const negative = !fillNone && options.whiteAsHoles !== false && isWhiteFill(style.fill);
    rawShapes.push({
      contours,
      chain: elChain,
      labels,
      elementId: id,
      groupLabel: groupLabel2,
      index: shapeIndex++,
      negative,
    });
  };

  const rootStyle: Style = { fill: "#000000", stroke: "none", strokeWidth: 1, fillRule: "nonzero", opacity: 1 };
  walk(root, rootMatrix, [], "", rootStyle, 0);

  if (!rawShapes.length && !rawImages.length) {
    throw new Error(
      textCount
        ? "El SVG solo contiene texto. Convierte el texto a trazados en tu editor y vuelve a importar."
        : "No se encontró geometría importable en el SVG.",
    );
  }
  if (groupCount === 0 && rawImages.length === 0) warnings.push("El SVG no tenía grupos; se agruparon las piezas por cercanía.");
  if (textCount) warnings.push(`${textCount} texto(s) ignorados: conviértelos a trazados antes de exportar.`);
  if (rawImages.length) warnings.push(`${rawImages.length} imagen(es) incrustadas detectadas; se importarán como grabado.`);

  // 1) islas por elemento
  const islands: ImportIsland[] = [];
  const islandKeys = new Set<string>();
  for (const shape of rawShapes) {
    for (const group of extractIslands(shape.contours)) {
      const b = contoursBounds(group);
      if (b.w * b.h < 0.002) continue;
      const key = `${shape.elementId}:${fmt(b.x)}:${fmt(b.y)}:${fmt(b.w)}:${fmt(b.h)}`;
      if (islandKeys.has(key)) continue;
      islandKeys.add(key);
      islands.push({
        id: `isl-${islands.length}`,
        contours: group,
        bbox: b,
        chain: shape.chain,
        labels: shape.labels,
        elementId: shape.elementId,
        sourceIndex: shape.index,
        negative: shape.negative,
      });
    }
  }
  if (!islands.length && !rawImages.length) throw new Error("El SVG no contiene formas cerradas utilizables.");

  // 2) agrupar islas. Si hay imágenes, cada isla se asigna primero a su figura.
  rawImages.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  const overlapArea = (a: Bounds, b: Bounds) => {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  };
  const assignedByImage: ImportIsland[][] = rawImages.map(() => []);
  const assignedIslandIds = new Set<string>();
  if (rawImages.length && options.mode !== "formas") {
    for (const island of islands) {
      let best = -1;
      let bestScore = 0;
      for (let i = 0; i < rawImages.length; i++) {
        const ab = rawImages[i].bbox;
        const center = { x: island.bbox.x + island.bbox.w / 2, y: island.bbox.y + island.bbox.h / 2 };
        const contains =
          center.x >= ab.x - 0.6 &&
          center.x <= ab.x + ab.w + 0.6 &&
          center.y >= ab.y - 0.6 &&
          center.y <= ab.y + ab.h + 0.6;
        const overlap = overlapArea(island.bbox, ab);
        const ratio = overlap / Math.max(0.01, island.bbox.w * island.bbox.h);
        const score = contains ? 1e6 + overlap : ratio;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      if (best < 0) {
        let bestGap = Infinity;
        for (let i = 0; i < rawImages.length; i++) {
          const gap = boundsGap(island.bbox, rawImages[i].bbox);
          if (gap < bestGap) {
            bestGap = gap;
            best = i;
          }
        }
        if (bestGap > 8) best = -1;
      }
      if (best >= 0) {
        assignedByImage[best].push(island);
        assignedIslandIds.add(island.id);
      }
    }
  }

  let islandGroups: IslandGroup[];
  if (rawImages.length && options.mode !== "formas") {
    // Cada pieza de corte se mantiene separada dentro de su figura. Así una
    // puerta, una ranura y su imagen no se fusionan en una sola geometría.
    const perIsland: IslandGroup[] = [];
    for (const arr of assignedByImage) {
      for (const island of arr) perIsland.push({ islands: [island] });
    }
    const leftover = islands.filter((i) => !assignedIslandIds.has(i.id));
    islandGroups = leftover.length
      ? [...perIsland, ...groupIslandsSmart(leftover, options)]
      : perIsland;
  } else {
    islandGroups = groupIslandsSmart(islands, options);
  }

  // 3) contornos finales y escala
  const made: ImportedPart[] = [];
  const allPoints: Pt[] = islands.flatMap((i) => i.contours.flat());
  for (const img of rawImages) {
    allPoints.push(
      { x: img.bbox.x, y: img.bbox.y },
      { x: img.bbox.x + img.bbox.w, y: img.bbox.y + img.bbox.h },
    );
  }
  const allBounds = boundsOf(allPoints);
  const naturalW = allBounds.w || 1;
  const naturalH = allBounds.h || 1;
  let factor = 1;
  if (options.targetWidth && options.targetWidth > 0) factor = options.targetWidth / naturalW;
  else if (options.targetHeight && options.targetHeight > 0) factor = options.targetHeight / naturalH;

  for (const islandGroup of islandGroups) {
    const source = islandGroup.islands;
    const positives = source.filter((i) => !i.negative);
    if (!positives.length) continue;
    let contours = unionContours([positives.flatMap((i) => i.contours)]);
    const negatives = source.filter((i) => i.negative);
    if (negatives.length) {
      const holes = unionContours([negatives.flatMap((i) => i.contours)]);
      if (holes.length) contours = differenceContours(contours, holes);
    }
    if (!contours.length) contours = positives.flatMap((i) => i.contours);
    if (options.simplify > 0) contours = contours.map((c) => simplifyRDP(c, options.simplify)).filter((c) => c.length >= 3);
    const b = contoursBounds(contours);
    const scaled = contours.map((c) => c.map((p) => ({ x: (p.x - b.x) * factor, y: (p.y - b.y) * factor })));
    const sb = contoursBounds(scaled);
    if (sb.w < 0.05 || sb.h < 0.05) continue;
    const label = labelForChain(source[0].chain, source[0].labels) || source[0].elementId || `Pieza ${made.length + 1}`;
    made.push({
      id: `part-${made.length}`,
      name: label,
      contours: scaled,
      width: sb.w,
      height: sb.h,
      islandIds: source.map((s) => s.id),
      groupLabel: label,
      color: PALETTE[made.length % PALETTE.length],
      sourceContours: contours,
      sourceBounds: b,
      kind: "vector",
      operation: "cut",
    });
  }

  // 4) imágenes incrustadas → piezas raster de grabado
  const vectorParts = made.slice();
  const imageParts: ImportedPart[] = [];
  for (let i = 0; i < rawImages.length; i++) {
    const img = rawImages[i];
    const name = img.label && !/^(image|imagen|figura)\s*\d*$/i.test(img.label)
      ? img.label
      : `Figura ${i + 1}`;
    const px = pngPixelSize(img.dataUrl);
    const width = img.bbox.w * factor;
    const height = img.bbox.h * factor;
    const raster: RasterData = {
      dataUrl: img.dataUrl,
      width: px?.w || Math.max(1, Math.round(width * (300 / 25.4))),
      height: px?.h || Math.max(1, Math.round(height * (300 / 25.4))),
      dpi: px && img.bbox.w > 0 ? (px.w * 25.4) / img.bbox.w : 300,
      mode: "grayscale",
      threshold: 128,
      invert: false,
    };
    imageParts.push({
      id: `part-img-${i}`,
      name,
      contours: [],
      width,
      height,
      islandIds: [],
      color: PALETTE[(vectorParts.length + i) % PALETTE.length],
      sourceContours: [rectContour(img.bbox.x, img.bbox.y, img.bbox.w, img.bbox.h)],
      sourceBounds: img.bbox,
      kind: "raster",
      raster,
      operation: "engrave",
      groupLabel: name,
    });
  }
  made.push(...imageParts);

  // 5) agrupaciones automáticas: cada imagen grande "engloba" sus piezas
  const assemblies: ImportedGroup[] = [];
  if (imageParts.length && options.mode !== "formas") {
    if (options.mode === "todo") {
      if (made.length > 1) {
        assemblies.push({
          id: "grp-todo",
          name: "Figura completa",
          memberIds: made.map((p) => p.id),
          color: PALETTE[0],
        });
      }
    } else {
      const islandToPart = new Map<string, ImportedPart>();
      for (const part of vectorParts) {
        for (const islandId of part.islandIds) islandToPart.set(islandId, part);
      }
      for (let i = 0; i < imageParts.length; i++) {
        const members = imageParts[i].id ? [imageParts[i].id] : [];
        for (const island of assignedByImage[i]) {
          const part = islandToPart.get(island.id);
          if (part && !members.includes(part.id)) members.push(part.id);
        }
        if (!members.length) continue;
        // Nombres legibles para las piezas de corte de la figura.
        let cutNo = 0;
        for (const id of members) {
          const part = made.find((p) => p.id === id);
          if (part && part.kind === "vector" && /^shape\d*$/i.test(part.name)) {
            part.name = `Corte ${++cutNo}`;
          }
        }
        assemblies.push({
          id: `grp-img-${i}`,
          name: imageParts[i].name,
          memberIds: members,
          color: PALETTE[i % PALETTE.length],
        });
      }
    }
  }

  if (!made.length) throw new Error("No quedaron piezas tras agrupar.");
  // nombrar duplicados
  const counts: Record<string, number> = {};
  for (const p of made) {
    counts[p.name] = (counts[p.name] || 0) + 1;
    if (counts[p.name] > 1) p.name = `${p.name} ${counts[p.name]}`;
  }

  return {
    parts: made,
    groups: assemblies,
    islands,
    widthMm: naturalW * factor,
    heightMm: naturalH * factor,
    warnings,
    hasGroups: groupCount > 0 || assemblies.length > 0,
    groupCount: groupCount + assemblies.length,
    units,
    elementCount,
    textCount,
    scale: factor,
  };
}

interface IslandGroup {
  islands: ImportIsland[];
}

/** Muestras y aristas para medir la distancia real entre islas. */
function islandSamples(cs: Contour[], maxPoints = 140): { points: Pt[]; edges: [Pt, Pt][] } {
  const points: Pt[] = [];
  const edges: [Pt, Pt][] = [];
  const perContour = Math.max(12, Math.floor(maxPoints / Math.max(1, cs.length)));
  for (const c of cs) {
    if (c.length < 2) continue;
    const step = Math.max(1, Math.ceil(c.length / perContour));
    for (let i = 0; i < c.length; i += step) {
      const a = c[i];
      const b = c[(i + step) % c.length];
      points.push(a);
      edges.push([a, b]);
    }
  }
  return { points, edges };
}

/** Distancia mínima aproximada entre dos islas (punto a arista). */
export function islandDistance(a: ImportIsland, b: ImportIsland): number {
  const sa = islandSamples(a.contours);
  const sb = islandSamples(b.contours);
  let best = Infinity;
  for (const p of sa.points) {
    for (const [c, d] of sb.edges) {
      const dist = distancePointToSegment(p, c, d);
      if (dist < best) best = dist;
    }
  }
  for (const p of sb.points) {
    for (const [c, d] of sa.edges) {
      const dist = distancePointToSegment(p, c, d);
      if (dist < best) best = dist;
    }
  }
  return best;
}

/** Agrupa islas en piezas según el modo y la tolerancia. */
export function groupIslandsSmart(islands: ImportIsland[], options: ImportOptions): IslandGroup[] {
  if (options.mode === "formas") return islands.map((i) => ({ islands: [i] }));
  if (options.mode === "todo") return [{ islands: islands.slice() }];
  const n = islands.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const tol = Math.max(0, options.tolerance);
  const groupOf = (i: number) => chainId(islands[i].chain, islands[i].chain.length);

  if (options.mode === "grupos") {
    const firstByGroup = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const key = groupOf(i) || `__${i}`;
      const first = firstByGroup.get(key);
      if (first !== undefined) union(first, i);
      else firstByGroup.set(key, i);
    }
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = islands[i];
      const b = islands[j];
      // Los blancos interiores son huecos del positivo que los contiene.
      if (a.negative !== b.negative) {
        const pos = a.negative ? b : a;
        const neg = a.negative ? a : b;
        if (boundsContains(pos.bbox, neg.bbox, Math.max(0.4, tol))) {
          union(i, j);
          continue;
        }
      }
      if (options.mode !== "inteligente") continue;
      if (a.negative !== b.negative) continue;
      const gap = boundsGap(a.bbox, b.bbox);
      if (gap > tol) continue;
      // La caja puede tocarse aunque las formas estén lejos: medir de verdad.
      if (islandDistance(a, b) <= tol) union(i, j);
    }
  }
  const buckets = new Map<number, ImportIsland[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!buckets.has(r)) buckets.set(r, []);
    buckets.get(r)!.push(islands[i]);
  }
  return Array.from(buckets.values()).map((is) => ({ islands: is }));
}

/** Pares de piezas cercanas, para el mapa de emparejamiento. */
export function closestPairs(
  parts: ImportedPart[],
  maxGap = 12,
): { a: number; b: number; gap: number }[] {
  const out: { a: number; b: number; gap: number }[] = [];
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const bi = parts[i].sourceBounds || boundsOf(parts[i].contours.flat());
      const bj = parts[j].sourceBounds || boundsOf(parts[j].contours.flat());
      const gap = boundsGap(bi, bj);
      if (gap <= maxGap) out.push({ a: i, b: j, gap });
    }
  }
  return out.sort((a, b) => a.gap - b.gap).slice(0, 80);
}

/** Une varias piezas de la previsualización del importador. */
export function mergeImported(parts: ImportedPart[], indices: number[]): ImportedPart {
  const chosen = indices.map((i) => parts[i]).filter(Boolean);
  const vector = chosen.filter((p) => p.kind !== "raster");
  const sourceChosen = vector.length ? vector : chosen;
  const sourceContours = unionContours([sourceChosen.flatMap((p) => p.sourceContours || p.contours)]);
  const sourceBounds = contoursBounds(sourceContours);
  const contours = unionContours([vector.flatMap((p) => p.contours)]);
  const b = contoursBounds(contours);
  return {
    id: chosen[0]?.id || `merged-${Date.now()}`,
    name: chosen.map((p) => p.name).join(" + ").slice(0, 60) || "Pieza unida",
    contours: contours.map((c) => c.map((p) => ({ x: p.x - b.x, y: p.y - b.y }))),
    width: b.w,
    height: b.h,
    islandIds: chosen.flatMap((p) => p.islandIds),
    color: chosen[0]?.color,
    sourceContours,
    sourceBounds,
    kind: "vector",
    operation: chosen[0]?.operation || "cut",
  };
}

/** Separa una pieza en sus islas originales. */
export function splitImported(part: ImportedPart, islands: ImportIsland[]): ImportedPart[] {
  const chosen = islands.filter((i) => part.islandIds.includes(i.id) && !i.negative);
  return chosen.map((island, idx) => {
    const b = contoursBounds(island.contours);
    return {
      id: `${part.id}-${idx}`,
      name: `${part.name} ${idx + 1}`,
      contours: island.contours.map((c) => c.map((p) => ({ x: p.x - b.x, y: p.y - b.y }))),
      width: b.w,
      height: b.h,
      islandIds: [island.id],
      color: PALETTE[(partsColorIndex(part) + idx) % PALETTE.length],
      sourceContours: island.contours,
      sourceBounds: island.bbox,
      kind: "vector",
      operation: part.operation || "cut",
    };
  });
}

function partsColorIndex(part: ImportedPart): number {
  return Math.max(0, PALETTE.indexOf(part.color || ""));
}

/** Mini SVG de una pieza para las tarjetas del importador. */
export function partPreviewSvg(part: ImportedPart, size = 72): string {
  if (part.kind === "raster" && part.raster) {
    return `<img src="${part.raster.dataUrl}" width="${size}" height="${size}" style="object-fit:contain;width:100%;height:100%" alt=""/>`;
  }
  const b = boundsOf(part.contours.flat());
  const pad = Math.max(b.w, b.h) * 0.06 + 0.4;
  const vb = `${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`;
  const d = part.contours
    .map((c) => `M${c.map((p) => `${fmt(p.x)} ${fmt(p.y)}`).join("L")}Z`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${size}" height="${size}"><path d="${d}" fill="${part.color || "#8a5a2b"}" fill-rule="evenodd" opacity=".85"/></svg>`;
}

/** Vista completa de un grupo (imágenes + cortes) en su posición original. */
export function groupPreviewSvg(parts: ImportedPart[], size = 96): string {
  const members = parts.filter((p) => p);
  if (!members.length) return "";
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of members) {
    xs.push(p.sourceBounds.x, p.sourceBounds.x + p.sourceBounds.w);
    ys.push(p.sourceBounds.y, p.sourceBounds.y + p.sourceBounds.h);
  }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const w = Math.max(0.1, maxX - minX);
  const h = Math.max(0.1, maxY - minY);
  const pad = Math.max(w, h) * 0.04 + 0.4;
  let body = "";
  for (const p of members) {
    if (p.kind === "raster" && p.raster) {
      body += `<image x="${fmt(p.sourceBounds.x)}" y="${fmt(p.sourceBounds.y)}" width="${fmt(p.sourceBounds.w)}" height="${fmt(p.sourceBounds.h)}" preserveAspectRatio="none" href="${p.raster.dataUrl}"/>`;
    } else {
      const d = p.sourceContours
        .map((c) => `M${c.map((q) => `${fmt(q.x)} ${fmt(q.y)}`).join("L")}Z`)
        .join("");
      body += `<path d="${d}" fill="${p.color || "#8a5a2b"}" fill-rule="evenodd" opacity=".45" stroke="${p.color || "#6b4625"}" stroke-width="${Math.max(w, h) * 0.002}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet">${body}</svg>`;
}

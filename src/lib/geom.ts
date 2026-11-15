/** Geometría 2D en mm: contornos, transformaciones, simplificación y trazos. */

import type { Bounds, Contour, Part, Placement, Pt } from "../types";

export const EPS = 1e-6;
export const TAU = Math.PI * 2;

export function pt(x: number, y: number): Pt {
  return { x, y };
}

export function cloneContour(c: Contour): Contour {
  return c.map((p) => ({ x: p.x, y: p.y }));
}

export function cloneContours(cs: Contour[]): Contour[] {
  return cs.map(cloneContour);
}

/** Área con signo. Positiva = sentido horario en pantalla (y hacia abajo). */
export function contourArea(c: Contour): number {
  if (c.length < 3) return 0;
  let a = 0;
  for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
    a += c[j].x * c[i].y - c[i].x * c[j].y;
  }
  return a / 2;
}

export function shapeArea(contours: Contour[]): number {
  return contours.reduce((s, c) => s + Math.abs(contourArea(c)), 0);
}

export function signedArea(contours: Contour[]): number {
  return contours.reduce((s, c) => s + contourArea(c), 0);
}

export function boundsOf(points: Pt[]): Bounds {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function contoursBounds(contours: Contour[]): Bounds {
  const all: Pt[] = [];
  for (const c of contours) all.push(...c);
  return boundsOf(all);
}

export function contourPerimeter(c: Contour, closed = true): number {
  let len = 0;
  for (let i = 0; i < c.length - 1; i++) {
    len += Math.hypot(c[i + 1].x - c[i].x, c[i + 1].y - c[i].y);
  }
  if (closed && c.length > 1) {
    len += Math.hypot(c[0].x - c[c.length - 1].x, c[0].y - c[c.length - 1].y);
  }
  return len;
}

export function contoursLength(contours: Contour[]): number {
  return contours.reduce((s, c) => s + contourPerimeter(c), 0);
}

export function translateContour(c: Contour, dx: number, dy: number): Contour {
  return c.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function translateContours(cs: Contour[], dx: number, dy: number): Contour[] {
  return cs.map((c) => translateContour(c, dx, dy));
}

export function scaleContours(cs: Contour[], sx: number, sy = sx): Contour[] {
  return cs.map((c) => c.map((p) => ({ x: p.x * sx, y: p.y * sy })));
}

export function rotatePt(p: Pt, cx: number, cy: number, deg: number): Pt {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const x = p.x - cx;
  const y = p.y - cy;
  return { x: cx + x * cos - y * sin, y: cy + x * sin + y * cos };
}

export function rotateContours(cs: Contour[], deg: number, cx = 0, cy = 0): Contour[] {
  if (!deg) return cloneContours(cs);
  return cs.map((c) => c.map((p) => rotatePt(p, cx, cy, deg)));
}

/** Normaliza un grupo de contornos para que su bbox empiece en (0,0). */
export function normalizeOrigin(cs: Contour[]): Contour[] {
  const b = contoursBounds(cs);
  return translateContours(cs, -b.x, -b.y);
}

/** Contornos de una pieza rotada, normalizados a (0,0). */
export function rotatedPartContours(part: Part, angle: number, mirror = false): Contour[] {
  let cs = cloneContours(part.contours);
  if (mirror) cs = cs.map((c) => c.map((p) => ({ x: part.width - p.x, y: p.y })));
  cs = rotateContours(cs, angle, part.width / 2, part.height / 2);
  return normalizeOrigin(cs);
}

export function rotatedSize(part: Pick<Part, "width" | "height">, angle: number): { w: number; h: number } {
  const a = (Math.abs(angle) % 180) * (Math.PI / 180);
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  return { w: part.width * c + part.height * s, h: part.width * s + part.height * c };
}

/** Transforma los contornos locales de una pieza a coordenadas de plancha. */
export function placementContours(part: Part, p: Placement): Contour[] {
  const rot = rotatedPartContours(part, p.angle, p.mirror);
  const b = contoursBounds(rot);
  return translateContours(rot, p.x - b.x, p.y - b.y);
}

/** Rotación 90° alrededor del centro del bbox de una pieza. */
export function rotatePlacementInPlace(
  part: Part,
  p: Placement,
  delta = 90,
): { x: number; y: number; angle: number } {
  const before = rotatedSize(part, p.angle);
  const after = rotatedSize(part, p.angle + delta);
  const cx = p.x + before.w / 2;
  const cy = p.y + before.h / 2;
  return { x: cx - after.w / 2, y: cy - after.h / 2, angle: (p.angle + delta + 360) % 360 };
}

export function simplifyRDP(points: Pt[], tolerance: number, closed = true): Pt[] {
  if (points.length <= 4 || tolerance <= 0) return points.slice();
  const toleranceSq = tolerance * tolerance;
  const pts = closed ? points.concat([points[0]]) : points.slice();

  function getSqDist(p1: Pt, p2: Pt): number {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return dx * dx + dy * dy;
  }

  function getSqSegDist(p: Pt, p1: Pt, p2: Pt): number {
    let x = p1.x;
    let y = p1.y;
    let dx = p2.x - x;
    let dy = p2.y - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = p2.x;
        y = p2.y;
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }
    return getSqDist(p, { x, y });
  }

  function simplifyStep(first: number, last: number, out: Pt[]): void {
    let maxSq = toleranceSq;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const sq = getSqSegDist(pts[i], pts[first], pts[last]);
      if (sq > maxSq) {
        index = i;
        maxSq = sq;
      }
    }
    if (index > 0) {
      if (index - first > 1) simplifyStep(first, index, out);
      out.push(pts[index]);
      if (last - index > 1) simplifyStep(index, last, out);
    }
  }

  // Para contornos cerrados se parte por el punto más lejano al primero.
  if (closed) {
    let far = 0;
    let farD = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = getSqDist(pts[0], pts[i]);
      if (d > farD) {
        farD = d;
        far = i;
      }
    }
    const out: Pt[] = [pts[0]];
    simplifyStep(0, far, out);
    out.push(pts[far]);
    simplifyStep(far, pts.length - 1, out);
    if (out.length > 2 && getSqDist(out[out.length - 1], out[0]) < toleranceSq) out.pop();
    return dedupe(out);
  }
  const out: Pt[] = [pts[0]];
  simplifyStep(0, pts.length - 1, out);
  out.push(pts[pts.length - 1]);
  return dedupe(out);
}

export function dedupe(points: Pt[], minDist = 1e-4): Pt[] {
  if (points.length < 2) return points.slice();
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    if (Math.hypot(points[i].x - prev.x, points[i].y - prev.y) > minDist) {
      out.push(points[i]);
    }
  }
  if (out.length > 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= minDist) out.pop();
  }
  return out;
}

/** Chaikin suaviza un contorno cerrado. iterations=1..3. */
export function smoothClosed(points: Pt[], iterations = 1): Pt[] {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 4) break;
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    pts = out;
  }
  return pts;
}

export function distancePointToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function boundsGap(a: Bounds, b: Bounds): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)));
  return Math.hypot(dx, dy);
}

export function boundsContains(a: Bounds, b: Bounds, slack = 0): boolean {
  return (
    b.x >= a.x - slack &&
    b.y >= a.y - slack &&
    b.x + b.w <= a.x + a.w + slack &&
    b.y + b.h <= a.y + a.h + slack
  );
}

export function pointInContour(p: Pt, contour: Contour): boolean {
  let inside = false;
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
    const a = contour[i];
    const b = contour[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Punto representativo dentro de la pieza (centro del bbox o centroide). */
export function representativePoint(cs: Contour[]): Pt {
  const b = contoursBounds(cs);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Distancia mínima aproximada entre dos conjuntos de contornos. */
export function shapesDistance(a: Contour[], b: Contour[]): number {
  const ba = contoursBounds(a);
  const bb = contoursBounds(b);
  const gap = boundsGap(ba, bb);
  const sa = sampleContourPoints(a, 12);
  const sb = sampleContourPoints(b, 12);
  let best = Infinity;
  for (const p of sa) {
    for (let i = 0; i < sb.length; i += 2) {
      const q = sb[i];
      const q2 = sb[(i + 1) % sb.length];
      const d = Math.min(distancePointToSegment(p, q, q2), Math.hypot(p.x - q.x, p.y - q.y));
      if (d < best) best = d;
    }
  }
  return Math.min(best, gap + 10);
}

export function sampleContourPoints(cs: Contour[], step = 8): Pt[] {
  const out: Pt[] = [];
  for (const c of cs) {
    for (let i = 0; i < c.length; i += step) out.push(c[i]);
  }
  return out;
}

/** Añade un contorno rectangular (útil para piezas raster y marcos). */
export function rectContour(x: number, y: number, w: number, h: number): Contour {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

export function circleContour(cx: number, cy: number, r: number, segments = 64): Contour {
  const out: Contour = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * TAU;
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return out;
}

/** Convierte contornos a un path SVG (mm). */
export function contoursToPath(cs: Contour[], close = true): string {
  let d = "";
  for (const c of cs) {
    if (c.length < 2) continue;
    d += `M${fmt(c[0].x)} ${fmt(c[0].y)}`;
    for (let i = 1; i < c.length; i++) d += `L${fmt(c[i].x)} ${fmt(c[i].y)}`;
    if (close) d += "Z";
  }
  return d;
}

export function fmt(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
}

/** Longitud de un arco de contorno (para puentes). */
export function contourArcLength(c: Contour): number {
  return contourPerimeter(c);
}

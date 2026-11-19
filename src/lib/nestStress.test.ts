import { describe, it, expect } from "vitest";
import type { Contour, NestRequestPart, NestResult, Sheet } from "../types";
import { clipperArea, intersectContours } from "./clipper";
import {
  circleContour,
  contoursBounds,
  rectContour,
  rotateContours,
  translateContours,
} from "./geom";
import { nestParts } from "./nest";

const SHEET: Sheet = {
  width: 300,
  height: 300,
  margin: 0,
  spacing: 0,
  kerf: 0,
  rotation: "libre",
  quality: "equilibrada",
  method: "auto",
  packMode: "shape",
  singlePage: true,
};

function placedContours(part: NestRequestPart, pl: { x: number; y: number; angle: number }): Contour[] {
  const b = contoursBounds(part.contours);
  const rotated = pl.angle
    ? rotateContours(part.contours, pl.angle, b.x + b.w / 2, b.y + b.h / 2)
    : part.contours;
  const rb = contoursBounds(rotated);
  return translateContours(rotated, pl.x - rb.x, pl.y - rb.y);
}

function assertNoOverlaps(parts: NestRequestPart[], result: NestResult, label: string) {
  const byId = new Map(parts.map((p) => [p.partId, p]));
  const placed = result.placements.map((pl) => {
    const part = byId.get(pl.partId);
    if (!part) throw new Error(`${label}: pieza desconocida ${pl.partId}`);
    return {
      id: pl.partId,
      page: pl.page,
      contours: placedContours(part, pl),
    };
  });
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i];
    const ab = contoursBounds(a.contours);
    expect(ab.x, `${label}: izquierda ${a.id}`).toBeGreaterThanOrEqual(-0.05);
    expect(ab.y, `${label}: arriba ${a.id}`).toBeGreaterThanOrEqual(-0.05);
    expect(ab.x + ab.w, `${label}: derecha ${a.id}`).toBeLessThanOrEqual(300.05);
    expect(ab.y + ab.h, `${label}: abajo ${a.id}`).toBeLessThanOrEqual(300.05);
    for (let j = i + 1; j < placed.length; j++) {
      const b = placed[j];
      if (a.page !== b.page) continue;
      const bb = contoursBounds(b.contours);
      const ox = Math.min(ab.x + ab.w, bb.x + bb.w) - Math.max(ab.x, bb.x);
      const oy = Math.min(ab.y + ab.h, bb.y + bb.h) - Math.max(ab.y, bb.y);
      if (ox <= 0.01 || oy <= 0.01) continue;
      const overlap = clipperArea(intersectContours(a.contours, b.contours));
      expect(overlap, `${label}: ${a.id} / ${b.id}`).toBeLessThan(0.05);
    }
  }
}

function rectRequest(id: string, w: number, h: number, copies = 1): NestRequestPart {
  return { partId: id, copies, contours: [rectContour(0, 0, w, h)], width: w, height: h };
}

function mixedPart(i: number): NestRequestPart {
  const kind = i % 5;
  if (kind === 0) return rectRequest(`r${i}`, 26 + (i % 4) * 5, 20 + (i % 3) * 4);
  if (kind === 1) {
    const w = 32 + (i % 4) * 4;
    const h = 26 + (i % 3) * 4;
    return {
      partId: `L${i}`,
      copies: 1,
      contours: [[
        { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h * 0.3 },
        { x: w * 0.35, y: h * 0.3 }, { x: w * 0.35, y: h }, { x: 0, y: h },
      ]],
      width: w,
      height: h,
    };
  }
  if (kind === 2) {
    const r = 13 + (i % 4) * 3;
    return { partId: `c${i}`, copies: 1, contours: [circleContour(r, r, r, 36)], width: r * 2, height: r * 2 };
  }
  if (kind === 3) {
    const w = 34 + (i % 4) * 4;
    const h = 28 + (i % 3) * 4;
    return {
      partId: `ring${i}`,
      copies: 1,
      contours: [rectContour(0, 0, w, h), circleContour(w / 2, h / 2, Math.min(w, h) * 0.24, 28).reverse()],
      width: w,
      height: h,
    };
  }
  return rectRequest(`long${i}`, 64 + (i % 3) * 6, 9 + (i % 3) * 2);
}

function run(parts: NestRequestPart[], patch: Partial<Sheet> = {}, extra: Partial<Parameters<typeof nestParts>[1]> = {}) {
  const sheet = { ...SHEET, ...patch };
  return nestParts(parts, {
    sheet,
    rotation: sheet.rotation,
    quality: sheet.quality,
    method: sheet.method,
    packMode: sheet.packMode,
    compact: true,
    pinned: [],
    ...extra,
  });
}

describe("nesting de estrés", () => {
  it("coloca 120 piezas medianas en una sola plancha de 300 × 300 sin solapes", () => {
    const parts = Array.from({ length: 120 }, (_, i) => rectRequest(`p${i}`, 22, 22));
    const started = Date.now();
    const result = run(parts, { quality: "equilibrada", singlePage: true });
    expect(result.unplaced).toBe(0);
    expect(result.placements).toHaveLength(120);
    expect(result.pages).toBe(1);
    assertNoOverlaps(parts, result, "120 piezas");
    expect(Date.now() - started).toBeLessThan(8000);
  });

  it("coloca 100 piezas grandes de 28 mm en una sola plancha al 87 % sin solapes", () => {
    const parts = Array.from({ length: 100 }, (_, i) => rectRequest(`big${i}`, 28, 28));
    const result = run(parts, { quality: "maxima", singlePage: true });
    expect(result.unplaced).toBe(0);
    expect(result.placements).toHaveLength(100);
    expect(result.pages).toBe(1);
    expect(result.efficiency).toBeGreaterThan(0.85);
    assertNoOverlaps(parts, result, "100 grandes");
  });

  it("no devuelve solapes vectoriales con 100 piezas mixtas y huecos", () => {
    const parts = Array.from({ length: 100 }, (_, i) => mixedPart(i));
    const result = run(parts, { quality: "maxima", singlePage: true });
    expect(result.pages).toBe(1);
    assertNoOverlaps(parts, result, "100 mixtas");
    // La superficie total de este set supera la plancha: debe avisar.
    expect(result.unplaced).toBeGreaterThan(0);
  });

  it("avisa si 100 piezas de 30 mm no caben y no inventa solapes", () => {
    const parts = Array.from({ length: 100 }, (_, i) => rectRequest(`full${i}`, 30, 30));
    const result = run(parts, { quality: "equilibrada", singlePage: true });
    expect(result.unplaced).toBeGreaterThan(0);
    expect(result.pages).toBe(1);
    assertNoOverlaps(parts, result, "100 de 30 mm");
  });

  it("funciona con todas las calidades, métodos, rotaciones, modos y márgenes", () => {
    const base = Array.from({ length: 12 }, (_, i) => mixedPart(i));
    const qualities = ["rapida", "equilibrada", "maxima"] as const;
    const methods = ["auto", "greedy", "largest", "voronoi", "genetic"] as const;
    const rotations = ["no", "90", "libre"] as const;

    for (const quality of qualities) {
      const result = run(base, { quality });
      assertNoOverlaps(base, result, `calidad ${quality}`);
    }
    for (const method of methods) {
      const result = run(base, { quality: "rapida", method });
      assertNoOverlaps(base, result, `método ${method}`);
    }
    for (const rotation of rotations) {
      const result = run(base, { quality: "rapida", rotation });
      assertNoOverlaps(base, result, `rotación ${rotation}`);
    }
    for (const spacing of [0, 1, 3]) {
      for (const kerf of [0, 0.15]) {
        const result = run(base, { quality: "rapida", spacing, kerf });
        assertNoOverlaps(base, result, `espaciado ${spacing}/${kerf}`);
      }
    }
    // Modo rectángulos: el empaquetador recibe cajas, como hace la tienda.
    const boxes = base.map((p) =>
      rectRequest(p.partId, p.width, p.height, p.copies),
    );
    const result = run(boxes, { quality: "rapida", packMode: "box" });
    assertNoOverlaps(boxes, result, "modo rectángulos");
  });

  it("rellena el hueco interior de un anillo antes de ocupar el exterior", () => {
    const parts: NestRequestPart[] = [
      {
        partId: "ring",
        copies: 1,
        contours: [rectContour(0, 0, 120, 120), rectContour(30, 30, 60, 60).reverse()],
        width: 120,
        height: 120,
      },
      rectRequest("inside", 50, 50),
      rectRequest("small1", 20, 20),
      rectRequest("small2", 20, 20),
    ];
    const result = run(parts, { quality: "rapida" });
    expect(result.unplaced).toBe(0);
    const inner = result.placements.find((p) => p.partId === "inside");
    expect(inner).toBeDefined();
    expect(inner!.x).toBeGreaterThan(20);
    expect(inner!.y).toBeGreaterThan(20);
    expect(inner!.x + 50).toBeLessThan(100);
    expect(inner!.y + 50).toBeLessThan(100);
    assertNoOverlaps(parts, result, "anillo relleno");
  });

  it("detecta y evita solapes en vectores finos e inclinados", () => {
    const parts: NestRequestPart[] = [];
    for (let i = 0; i < 18; i++) {
      parts.push({
        partId: `thin${i}`,
        copies: 1,
        contours: [rectContour(0, 0, 80 + (i % 3) * 10, 0.35)],
        width: 80 + (i % 3) * 10,
        height: 0.35,
        angles: [15, 45, 75, 105],
      });
    }
    const result = run(parts, { quality: "rapida" });
    assertNoOverlaps(parts, result, "vectores finos");
  });

  it("respeta una pieza fijada y valida el resultado vectorial", () => {
    const parts = Array.from({ length: 10 }, (_, i) => rectRequest(`pin${i}`, 30, 24));
    parts[0] = { ...parts[0], copies: 0 };
    const pinned = [{
      id: "fixed",
      partId: "pin0",
      page: 0,
      x: 20,
      y: 20,
      angle: 0,
      mirror: false,
      pinned: true,
    }];
    const result = run(parts, { quality: "equilibrada" }, { pinned });
    expect(result.placements.some((p) => p.partId === "pin0" && p.x === 20 && p.y === 20)).toBe(true);
    assertNoOverlaps(parts, result, "con fijada");
  });
});

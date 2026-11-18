import { describe, expect, it } from "vitest";
import { nestParts } from "./nest";
import { contoursBounds, rectContour, rotateContours, translateContours } from "./geom";
import { clipperArea, intersectContours } from "./clipper";
import type { Contour, NestRequestPart, Sheet } from "../types";

function sheet(partial: Partial<Sheet> = {}): Sheet {
  return {
    width: 300, height: 300, margin: 5, spacing: 2, kerf: 0.15,
    rotation: "libre", quality: "maxima", singlePage: false,
    method: "auto", packMode: "shape", ...partial,
  };
}

const circle = (r: number, cx = 0, cy = 0, n = 40): Contour =>
  Array.from({ length: n }, (_, i) => ({
    x: cx + r * Math.cos((i / n) * Math.PI * 2),
    y: cy + r * Math.sin((i / n) * Math.PI * 2),
  }));

function placedContours(contours: Contour[], pl: { x: number; y: number; angle: number }): Contour[] {
  const b = contoursBounds(contours);
  const rotated = pl.angle
    ? rotateContours(contours, pl.angle, b.x + b.w / 2, b.y + b.h / 2)
    : contours;
  const rb = contoursBounds(rotated);
  return translateContours(rotated, pl.x - rb.x, pl.y - rb.y);
}

describe("nesting geométrico", () => {
  it("usa un giro cuando una pieza alargada no cabe recta", () => {
    const parts: NestRequestPart[] = [{
      partId: "long", copies: 1,
      contours: [rectContour(0, 0, 160, 30)], width: 160, height: 30,
    }];
    const result = nestParts(parts, {
      sheet: sheet({ width: 100, height: 180, singlePage: true }),
      rotation: "libre", quality: "maxima", method: "auto", compact: true, pinned: [],
    });
    expect(result.pages).toBe(1);
    expect(result.unplaced).toBe(0);
    expect(result.placements[0].angle).toBe(90);
  });

  it("prueba diagonales si la pieza no cabe a 0/90/180/270", () => {
    const parts: NestRequestPart[] = [{
      partId: "diagonal", copies: 1,
      contours: [rectContour(0, 0, 260, 20)], width: 260, height: 20,
    }];
    const result = nestParts(parts, {
      sheet: sheet({ width: 230, height: 230, singlePage: true }),
      rotation: "libre", quality: "maxima", method: "auto", compact: true, pinned: [],
    });
    expect(result.unplaced).toBe(0);
    expect(result.pages).toBe(1);
    expect(result.placements[0].angle % 90).not.toBe(0);
  });

  it("anida huecos, L, círculos y piezas alargadas sin solapes ni piezas perdidas", () => {
    const parts: NestRequestPart[] = [
      { partId: "long", copies: 3, contours: [rectContour(0, 0, 220, 18)], width: 220, height: 18 },
      { partId: "tall", copies: 2, contours: [rectContour(0, 0, 25, 180)], width: 25, height: 180 },
      { partId: "hollow", copies: 4, contours: [rectContour(0, 0, 70, 70), rectContour(15, 15, 40, 40).reverse()], width: 70, height: 70 },
      { partId: "L", copies: 4, contours: [[{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 80 }, { x: 0, y: 80 }]], width: 90, height: 80 },
      { partId: "circle", copies: 6, contours: [circle(28)], width: 56, height: 56 },
    ];
    const started = Date.now();
    const result = nestParts(parts, { sheet: sheet(), rotation: "libre", quality: "maxima", method: "auto", compact: true, pinned: [] });
    expect(result.unplaced).toBe(0);
    expect(result.pages).toBeLessThanOrEqual(2);
    expect(result.placements.length).toBe(19);
    expect(result.placements.some((p) => p.angle !== 0)).toBe(true);
    expect(result.efficiency).toBeGreaterThan(0.3);
    expect(Date.now() - started).toBeLessThan(12000);
  });

  it("no produce solapes entre piezas distintas", () => {
    const parts: NestRequestPart[] = [
      { partId: "hollow", copies: 2, contours: [rectContour(0, 0, 100, 100), rectContour(20, 20, 60, 60).reverse()], width: 100, height: 100 },
      { partId: "long", copies: 2, contours: [rectContour(0, 0, 130, 16)], width: 130, height: 16 },
      { partId: "circle", copies: 3, contours: [circle(24)], width: 48, height: 48 },
      { partId: "L", copies: 2, contours: [[{ x: 0, y: 0 }, { x: 70, y: 0 }, { x: 70, y: 18 }, { x: 18, y: 18 }, { x: 18, y: 65 }, { x: 0, y: 65 }]], width: 70, height: 65 },
    ];
    const result = nestParts(parts, { sheet: sheet({ width: 220, height: 220 }), rotation: "libre", quality: "equilibrada", method: "auto", compact: true, pinned: [] });
    expect(result.unplaced).toBe(0);
    const byPart = new Map(parts.map((p) => [p.partId, p]));
    const shapes = result.placements.map((p) => ({ id: p.partId, contours: placedContours(byPart.get(p.partId)!.contours, p) }));
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        const overlap = intersectContours(shapes[i].contours, shapes[j].contours);
        expect(clipperArea(overlap)).toBeLessThan(0.05);
      }
    }
  });

  it("coloca piezas minúsculas sin perderlas", () => {
    const parts: NestRequestPart[] = [{
      partId: "tiny", copies: 40,
      contours: [rectContour(0, 0, 0.6, 0.6)], width: 0.6, height: 0.6,
    }];
    const result = nestParts(parts, { sheet: sheet({ width: 80, height: 80 }), rotation: "no", quality: "rapida", method: "auto", compact: true, pinned: [] });
    expect(result.unplaced).toBe(0);
    expect(result.placements).toHaveLength(40);
  });

  it("avisa de una pieza enorme sin romper el cálculo", () => {
    const parts: NestRequestPart[] = [{
      partId: "huge", copies: 1,
      contours: [rectContour(0, 0, 500, 500)], width: 500, height: 500,
    }];
    const result = nestParts(parts, { sheet: sheet(), rotation: "libre", quality: "rapida", method: "auto", compact: true, pinned: [] });
    expect(result.unplaced).toBe(1);
    expect(result.placements).toHaveLength(0);
  });
});

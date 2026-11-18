import { describe, expect, it } from "vitest";
import { nestParts } from "./nest";
import { rectContour } from "./geom";
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
});

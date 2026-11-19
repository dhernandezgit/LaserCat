import { describe, it, expect } from "vitest";
import type { Doc, Part } from "../types";
import { clipperArea, intersectContours } from "./clipper";
import { createEmptyDoc, nestDoc } from "./store";
import { effectiveGeometry, placeEffective } from "./laser";
import { rectContour } from "./geom";
import { nestParts } from "./nest";

function part(id: string, w: number, h: number, offsetMm = 0): Part {
  return {
    id,
    name: id,
    kind: "vector",
    contours: [rectContour(0, 0, w, h)],
    width: w,
    height: h,
    operation: "cut",
    offsetMm,
    separateBorder: false,
    copies: 1,
    source: "svg",
  };
}

describe("regresiones de optimización", () => {
  it("coloca cuatro piezas de 150 mm que llenan exactamente la plancha", () => {
    const parts = Array.from({ length: 4 }, (_, i) => ({
      partId: `q${i}`,
      copies: 1,
      contours: [rectContour(0, 0, 150, 150)],
      width: 150,
      height: 150,
    }));
    const result = nestParts(parts, {
      sheet: {
        width: 300,
        height: 300,
        margin: 0,
        spacing: 0,
        kerf: 0,
        rotation: "libre",
        quality: "maxima",
        method: "auto",
        packMode: "shape",
        singlePage: true,
      },
      rotation: "libre",
      quality: "maxima",
      method: "auto",
      packMode: "shape",
      compact: true,
      pinned: [],
    });
    expect(result.unplaced).toBe(0);
    expect(result.placements).toHaveLength(4);
    expect(result.placements.map((p) => [p.x, p.y])).toEqual(
      expect.arrayContaining([[0, 0], [150, 0], [0, 150], [150, 150]]),
    );
  });

  it("respeta offsets reales al calcular el borde de corte", () => {
    const base = createEmptyDoc();
    const parts = [part("a", 140, 140, 5), part("b", 140, 140, 5), part("c", 140, 140, 5), part("d", 140, 140, 5)];
    const doc: Doc = {
      ...base,
      parts,
      sheet: { ...base.sheet, margin: 0, spacing: 0, kerf: 0, singlePage: true },
    };
    const res = nestDoc(doc);
    expect(res.nest.unplaced).toBe(0);
    expect(res.doc.placements).toHaveLength(4);
    for (const pl of res.doc.placements) {
      const p = parts.find((x) => x.id === pl.partId)!;
      const g = effectiveGeometry(p);
      expect(g.width).toBeCloseTo(150, 1);
      expect(g.height).toBeCloseTo(150, 1);
      const pg = placeEffective(p, pl);
      expect(pg.x).toBeGreaterThanOrEqual(-0.05);
      expect(pg.y).toBeGreaterThanOrEqual(-0.05);
      expect(pg.x + pg.rotatedW).toBeLessThanOrEqual(300.05);
      expect(pg.y + pg.rotatedH).toBeLessThanOrEqual(300.05);
    }
    const placed = res.doc.placements.map((pl) => {
      const p = parts.find((x) => x.id === pl.partId)!;
      return placeEffective(p, pl);
    });
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(clipperArea(intersectContours(placed[i].outer, placed[j].outer))).toBeLessThan(0.05);
      }
    }
  });
});

import { describe, it, expect } from "vitest";
import { nestParts } from "./nest";
import { demoParts } from "./demo";
import { effectiveGeometry, placeEffective } from "./laser";
import { rectContour } from "./geom";
import { intersectContours } from "./clipper";

const SHEET = {
  width: 300,
  height: 300,
  margin: 5,
  spacing: 3,
  kerf: 0.15,
  rotation: "90" as const,
  quality: "equilibrada" as const,
  singlePage: false,
};

describe("nest", () => {
  it("places two squares without overlap", () => {
    const parts = [0, 1].map((i) => ({
      partId: `s${i}`,
      copies: 1,
      contours: [rectContour(0, 0, 50, 50)],
      width: 50,
      height: 50,
    }));
    const res = nestParts(parts, { sheet: SHEET, rotation: "90", quality: "equilibrada", pinned: [] });
    const [a, b] = res.placements;
    const overlapX = Math.min(a.x + 50, b.x + 50) - Math.max(a.x, b.x);
    const overlapY = Math.min(a.y + 50, b.y + 50) - Math.max(a.y, b.y);
    expect(overlapX <= 0 || overlapY <= 0).toBe(true);
  });

  it("demo parts keep true-shape separation", () => {
    const parts = demoParts();
    const req = parts.map((p) => {
      const g = effectiveGeometry(p);
      return { partId: p.id, copies: p.copies, contours: g.outer, width: g.width, height: g.height };
    });
    const res = nestParts(req, { sheet: SHEET, rotation: "90", quality: "equilibrada", pinned: [] });
    expect(res.unplaced).toBe(0);
    expect(res.placements.length).toBe(parts.reduce((s, p) => s + p.copies, 0));
    const placed = res.placements.map((pl) => {
      const part = parts.find((p) => p.id === pl.partId)!;
      const plFull = { ...pl, id: "x", pinned: false };
      return { name: part.name, outer: placeEffective(part, plFull).outer };
    });
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const overlap = intersectContours(placed[i].outer, placed[j].outer);
        const area = overlap.reduce((s, c) => s + Math.abs(c.reduce((a, p, k, arr) => {
          const q = arr[(k + 1) % arr.length];
          return a + p.x * q.y - q.x * p.y;
        }, 0) / 2), 0);
        if (area > 0.05) console.log("TRUE OVERLAP", placed[i].name, placed[j].name, area);
        expect(area).toBeLessThan(0.05);
      }
    }
  });
});

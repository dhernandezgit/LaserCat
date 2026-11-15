import { describe, it, expect } from "vitest";
import { nestParts } from "./nest";
import { demoParts } from "./demo";
import { effectiveGeometry } from "./laser";

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

describe("nest margin", () => {
  it("starts exactly at the margin", () => {
    const p = demoParts()[3];
    const g = effectiveGeometry(p);
    const res = nestParts(
      [{ partId: p.id, copies: 1, contours: g.outer, width: g.width, height: g.height }],
      { sheet: SHEET, rotation: "90", quality: "equilibrada", pinned: [] },
    );
    expect(res.placements[0].x).toBeCloseTo(5, 1);
    expect(res.placements[0].y).toBeCloseTo(5, 1);
  });

  it("respects the right and bottom margin", () => {
    const p = demoParts()[2];
    const g = effectiveGeometry(p);
    const res = nestParts(
      [{ partId: p.id, copies: 8, contours: g.outer, width: g.width, height: g.height }],
      { sheet: SHEET, rotation: "90", quality: "equilibrada", pinned: [] },
    );
    for (const pl of res.placements) {
      expect(pl.x).toBeGreaterThanOrEqual(5 - 0.01);
      expect(pl.y).toBeGreaterThanOrEqual(5 - 0.01);
      expect(pl.x + g.width).toBeLessThanOrEqual(295 + 0.01);
      expect(pl.y + g.height).toBeLessThanOrEqual(295 + 0.01);
    }
  });
});

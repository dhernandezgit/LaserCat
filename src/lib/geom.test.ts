import { describe, it, expect } from "vitest";
import { contourArea, contoursBounds, rotateContours, simplifyRDP } from "./geom";
import { offsetContours, normalizeOrientation } from "./clipper";
import { demoParts } from "./demo";
import { effectiveGeometry, placeEffective, computeStats } from "./laser";
import type { Placement } from "../types";

describe("geometry", () => {
  it("computes signed area", () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(contourArea(sq)).toBeCloseTo(100);
    expect(contourArea(sq.slice().reverse())).toBeCloseTo(-100);
  });

  it("simplifies collinear points", () => {
    const pts = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((x) => ({ x, y: 0 }));
    pts.push({ x: 10, y: 10 }, { x: 0, y: 10 });
    const s = simplifyRDP(pts, 0.1);
    expect(s.length).toBeLessThan(pts.length);
  });

  it("rotates around the center", () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const r = rotateContours([sq], 90, 5, 5)[0];
    const b = contoursBounds([r]);
    expect(b.w).toBeCloseTo(10, 4);
    expect(b.h).toBeCloseTo(10, 4);
  });
});

describe("offset", () => {
  it("expands outer and shrinks holes", () => {
    const outer = [
      { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 },
    ];
    const hole = [
      { x: 5, y: 5 }, { x: 5, y: 15 }, { x: 15, y: 15 }, { x: 15, y: 5 },
    ];
    const off = offsetContours([outer, hole], 2);
    const b = contoursBounds(off);
    expect(b.w).toBeCloseTo(24, 0);
    const area = Math.abs(off.reduce((s, c) => s + contourArea(c), 0));
    expect(area).toBeGreaterThan(500);
    expect(area).toBeLessThan(600);
  });

  it("normalizes winding", () => {
    const rev = [
      { x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 },
    ];
    const n = normalizeOrientation([rev]);
    expect(contourArea(n[0])).toBeGreaterThan(0);
  });

  it("effective geometry shifts the design inside the border", () => {
    const part = demoParts()[0];
    expect(part.contours.length).toBe(3); // gato + dos ojos
    const g = effectiveGeometry(part);
    expect(g.hasOffset).toBe(true);
    expect(g.width).toBeGreaterThan(part.width);
    expect(g.baseBounds.x).toBeCloseTo(part.offsetMm, 0);
    expect(g.outer.length).toBe(3);
  });

  it("keeps hole size when expanding a sticker border", () => {
    const outer = [
      { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 },
    ];
    const hole = [
      { x: 5, y: 5 }, { x: 5, y: 15 }, { x: 15, y: 15 }, { x: 15, y: 5 },
    ];
    const part = {
      id: "h", name: "Con hueco", kind: "vector" as const,
      contours: normalizeOrientation([outer, hole]),
      width: 20, height: 20, operation: "cut" as const, offsetMm: 2,
      separateBorder: false, copies: 1, source: "demo" as const,
    };
    const g = effectiveGeometry(part);
    expect(g.width).toBeCloseTo(24, 0);
    const holes = g.outer.filter((c) => contourArea(c) < 0);
    expect(holes.length).toBe(1);
    expect(Math.abs(contourArea(holes[0]))).toBeCloseTo(100, 0);
  });

  it("mirrors and rotates placements", () => {
    const part = demoParts()[3];
    const p: Placement = { id: "x", partId: part.id, page: 0, x: 10, y: 20, angle: 90, mirror: true, pinned: false };
    const placed = placeEffective(part, p);
    const b = contoursBounds(placed.outer);
    expect(b.x).toBeCloseTo(10, 1);
    expect(b.y).toBeCloseTo(20, 1);
    expect(placed.rotatedW).toBeGreaterThan(part.width);
  });
});

describe("stats", () => {
  it("computes efficiency and time", () => {
    const parts = demoParts();
    const doc = {
      version: 1 as const,
      name: "x",
      parts,
      placements: parts.map((p, i) => ({
        id: `pl${i}`,
        partId: p.id,
        page: 0,
        x: 10 + i * 5,
        y: 10,
        angle: 0,
        mirror: false,
        pinned: false,
      })),
      sheet: { width: 300, height: 300, margin: 5, spacing: 3, kerf: 0.15, rotation: "90" as const, quality: "equilibrada" as const, singlePage: false },
      settings: {
        machineId: "s30", materialId: "tilo", expert: false, autoNest: true,
        exportBridges: false, bridgeCount: 4, bridgeWidth: 2.5, exportKerf: true,
        exportFrame: false, exportOrder: true, exportNotes: true,
        engraveOutput: "raster" as const, ditherDotsPerMm: 3,
        previewSpecies: "tilo", previewPower: 35, previewSpeed: 3600, previewPasses: 1,
      },
      createdAt: 1,
      updatedAt: 1,
    };
    const s = computeStats(doc);
    expect(s.efficiency).toBeGreaterThan(0);
    expect(s.timeSeconds).toBeGreaterThan(0);
    expect(s.pages).toBe(1);
  });
});

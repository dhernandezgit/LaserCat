import { describe, it, expect } from "vitest";
import type { Part } from "../types";
import { clipperArea, intersectContours } from "./clipper";
import { makePuzzleDemo, PUZZLE_SIZE, PUZZLE_VERSION } from "./puzzle";
import { computeStats } from "./laser";
import { placeEffective } from "./laser";
import { createInitialDoc, createInitialState, createPuzzleDoc, nestDoc, normalizeDoc, reducer, STORAGE_KEY } from "./store";

function coverage(parts: Part[]): number {
  return parts.reduce((sum, part) => {
    const area = clipperArea(part.contours);
    return sum + area;
  }, 0);
}

describe("puzzle de madera de ejemplo", () => {
  it("cubre la plancha exactamente y sin solapes", () => {
    for (let seed = 1; seed <= 24; seed++) {
      const puzzle = makePuzzleDemo(seed * 7919);
      expect(puzzle.pieceCount).toBeGreaterThanOrEqual(18);
      expect(puzzle.pieceCount).toBeLessThanOrEqual(30);
      expect(puzzle.placements).toHaveLength(puzzle.parts.length);
      expect(coverage(puzzle.parts)).toBeGreaterThan(PUZZLE_SIZE.width * PUZZLE_SIZE.height * 0.999);

      const placed = puzzle.parts.map((part, i) => placeEffective(part, puzzle.placements[i]));
      for (const g of placed) {
        expect(g.x).toBeGreaterThanOrEqual(-0.01);
        expect(g.y).toBeGreaterThanOrEqual(-0.01);
        expect(g.x + g.rotatedW).toBeLessThanOrEqual(PUZZLE_SIZE.width + 0.01);
        expect(g.y + g.rotatedH).toBeLessThanOrEqual(PUZZLE_SIZE.height + 0.01);
      }
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          const overlap = clipperArea(intersectContours(placed[i].outer, placed[j].outer));
          expect(overlap, `seed ${seed}: piezas ${i + 1} y ${j + 1}`).toBeLessThan(0.05);
        }
      }
    }
  });

  it("varía el número de piezas y tiene formas irregulares", () => {
    const counts = new Set<number>();
    let irregular = 0;
    for (let seed = 1; seed <= 18; seed++) {
      const puzzle = makePuzzleDemo(seed * 1013);
      counts.add(puzzle.pieceCount);
      for (const part of puzzle.parts) {
        if (part.contours.some((contour) => contour.length >= 6)) irregular++;
      }
    }
    expect(counts.size).toBeGreaterThan(2);
    expect(irregular).toBeGreaterThan(0);
  });

  it("arranca resuelto al 100 % y Optimizar conserva la solución", () => {
    const doc = createInitialDoc();
    expect(doc.sheet.margin).toBe(0);
    expect(doc.sheet.spacing).toBe(0);
    expect(doc.sheet.kerf).toBe(0);
    expect(doc.placements).toHaveLength(doc.parts.length);
    expect(doc.parts.every((part) => part.source === "demo")).toBe(true);
    expect(computeStats(doc).efficiency).toBeGreaterThan(0.9995);
    expect(Math.round(computeStats(doc).efficiency * 100)).toBe(100);

    const res = nestDoc(doc);
    expect(res.nest.unplaced).toBe(0);
    expect(res.nest.efficiency).toBeGreaterThan(0.9995);
    expect(res.doc.placements).toEqual(doc.placements);

    for (const seed of [7, 21, 99, 2024, 77777]) {
      const seeded = createPuzzleDoc(seed);
      const solved = nestDoc(seeded);
      expect(solved.nest.unplaced).toBe(0);
      expect(solved.nest.efficiency).toBeGreaterThan(0.9995);
      expect(solved.doc.placements).toEqual(seeded.placements);
    }
  });

  it("el botón de nuevo puzzle genera otra solución exacta", () => {
    const state = createInitialState();
    const next = reducer(state, { type: "LOAD_PUZZLE", seed: 424242 });
    expect(next.doc.parts.length).toBeGreaterThanOrEqual(18);
    expect(next.doc.parts.length).toBeLessThanOrEqual(30);
    expect(next.doc.sheet.margin).toBe(0);
    expect(computeStats(next.doc).efficiency).toBeGreaterThan(0.9995);
    expect(next.lastNest?.unplaced).toBe(0);
  });

  it("sigue al 100 % después de guardar y volver a cargar", () => {
    const doc = createPuzzleDoc(13579);
    const loaded = normalizeDoc(JSON.parse(JSON.stringify(doc)));
    expect(loaded).not.toBeNull();
    expect(loaded!.puzzleSeed).toBe(13579);
    expect(loaded!.puzzleVersion).toBe(PUZZLE_VERSION);
    expect(computeStats(loaded!).efficiency).toBeGreaterThan(0.9995);
    const res = nestDoc(loaded!);
    expect(res.nest.unplaced).toBe(0);
    expect(res.nest.efficiency).toBeGreaterThan(0.9995);
  });

  it("actualiza un puzzle de demostración antiguo sin tocar proyectos reales", () => {
    const old = createPuzzleDoc(98765);
    delete old.puzzleVersion;
    localStorage.clear();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(old));
    const next = createInitialState();
    expect(next.doc.puzzleVersion).toBe(PUZZLE_VERSION);
    expect(next.doc.parts.length).toBeGreaterThanOrEqual(18);
    localStorage.clear();
  });
});

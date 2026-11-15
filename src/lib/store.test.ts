import { describe, it, expect } from "vitest";
import {
  createEmptyDoc,
  createInitialState,
  normalizeDoc,
  reducer,
  type AppState,
} from "./store";
import { shapePart } from "./demo";
import { rectContour } from "./geom";
import type { Part } from "../types";

function emptyState(): AppState {
  return {
    doc: createEmptyDoc(),
    selection: { partIds: [], placementIds: [] },
    past: [],
    future: [],
    lastKey: "",
    lastAt: 0,
    lastNest: null,
    ui: {
      page: 0,
      tab: "diseno",
      view: "plan",
      showSvgDialog: false,
      showImageDialog: false,
      showExportDialog: false,
      showHelpDialog: false,
      pendingSvgFile: null,
      pendingImageFile: null,
      pendingImageMode: "threshold",
      pendingImageCut: true,
      toast: null,
    },
  };
}

const basePart = (over: Partial<Part> = {}): Part => ({
  id: "p1",
  name: "Rect",
  kind: "vector",
  contours: [rectContour(0, 0, 50, 40)],
  width: 50,
  height: 40,
  operation: "cut",
  offsetMm: 0,
  separateBorder: false,
  copies: 1,
  source: "demo",
  ...over,
});

describe("store", () => {
  it("adds parts and nests them", () => {
    let state = emptyState();
    state = reducer(state, { type: "ADD_PARTS", parts: [basePart()] });
    expect(state.doc.parts.length).toBe(1);
    expect(state.doc.placements.length).toBe(1);
    expect(state.past.length).toBe(1);
  });

  it("undoes and redoes", () => {
    let state = emptyState();
    state = reducer(state, { type: "ADD_PARTS", parts: [basePart()] });
    const withPart = state.doc;
    state = reducer(state, { type: "UNDO" });
    expect(state.doc.parts.length).toBe(0);
    state = reducer(state, { type: "REDO" });
    expect(state.doc.parts.length).toBe(1);
    expect(state.doc.placements.length).toBe(withPart.placements.length);
  });

  it("creates copies", () => {
    let state = emptyState();
    state = reducer(state, { type: "ADD_PARTS", parts: [basePart()] });
    state = reducer(state, { type: "SET_COPIES", id: "p1", copies: 3 });
    expect(state.doc.parts[0].copies).toBe(3);
    expect(state.doc.placements.length).toBe(3);
  });

  it("keeps pinned placements on re-nest", () => {
    let state = emptyState();
    state = reducer(state, { type: "ADD_PARTS", parts: [basePart()] });
    const pl = state.doc.placements[0];
    state = reducer(state, { type: "SET_POSITIONS", positions: [{ id: pl.id, x: 40, y: 50 }] });
    state = reducer(state, { type: "PIN_PLACEMENT", id: pl.id, pinned: true });
    state = reducer(state, { type: "NEST" });
    const pinned = state.doc.placements.find((p) => p.id === pl.id);
    expect(pinned?.x).toBeCloseTo(40, 1);
    expect(pinned?.y).toBeCloseTo(50, 1);
  });

  it("deletes a placement and decrements copies", () => {
    let state = emptyState();
    state = reducer(state, { type: "ADD_PARTS", parts: [basePart({ copies: 2 })] });
    const pl = state.doc.placements[0];
    state = reducer(state, { type: "DELETE_PLACEMENT", id: pl.id });
    expect(state.doc.parts[0].copies).toBe(1);
    expect(state.doc.placements.length).toBe(1);
  });

  it("validates projects", () => {
    const bad = normalizeDoc({ parts: "nope" });
    expect(bad).toBeNull();
    const good = normalizeDoc({
      name: "Carga",
      parts: [basePart()],
      placements: [],
      sheet: { width: 300, height: 300 },
      settings: {},
    });
    expect(good?.parts.length).toBe(1);
    expect(good?.sheet.margin).toBeGreaterThanOrEqual(0);
  });

  it("starts with a demo", () => {
    const state = createInitialState();
    expect(state.doc.parts.length).toBeGreaterThan(0);
    expect(state.doc.placements.length).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from "vitest";
import { buildSheetSvg, buildExportFiles, bridgeRuns, makeZip } from "./export";
import type { Doc, Part } from "../types";
import { effectiveGeometry } from "./laser";
import { circleContour, rectContour } from "./geom";
import { normalizeOrientation } from "./clipper";

function part(overrides: Partial<Part> = {}): Part {
  return {
    id: "p1",
    name: "Pieza",
    kind: "vector",
    contours: [rectContour(0, 0, 40, 30)],
    width: 40,
    height: 30,
    operation: "cut",
    offsetMm: 0,
    separateBorder: false,
    copies: 1,
    source: "demo",
    ...overrides,
  };
}

function doc(parts: Part[], overrides: Partial<Doc> = {}): Doc {
  return {
    version: 1,
    name: "Prueba",
    parts,
    placements: parts.map((p, i) => ({
      id: `pl${i}`,
      partId: p.id,
      page: 0,
      x: 20 + i * 10,
      y: 20,
      angle: 0,
      mirror: false,
      pinned: false,
    })),
    sheet: { width: 300, height: 300, margin: 5, spacing: 3, kerf: 0.15, rotation: "90", quality: "equilibrada", singlePage: false },
    settings: {
      machineId: "s30",
      materialId: "tilo",
      expert: false,
      autoNest: true,
      exportBridges: false,
      bridgeCount: 4,
      bridgeWidth: 2.5,
      exportKerf: true,
      exportFrame: false,
      exportOrder: true,
      exportNotes: true,
      engraveOutput: "raster",
      ditherDotsPerMm: 3,
      previewSpecies: "tilo",
      previewPower: 35,
      previewSpeed: 3600,
      previewPasses: 1,
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("bridgeRuns", () => {
  it("splits a closed contour into open runs", () => {
    const runs = bridgeRuns(rectContour(0, 0, 40, 30), 4, 3);
    expect(runs.length).toBe(4);
    for (const r of runs) expect(r.length).toBeGreaterThan(1);
  });

  it("does nothing if gaps are too large", () => {
    const runs = bridgeRuns(rectContour(0, 0, 5, 5), 20, 5);
    expect(runs.length).toBe(1);
  });
});

describe("buildSheetSvg", () => {
  it("uses real mm and layer colors", () => {
    const d = doc([part()]);
    const svg = buildSheetSvg(d, 0);
    expect(svg).toContain('width="300mm"');
    expect(svg).toContain('height="300mm"');
    expect(svg).toContain('viewBox="0 0 300 300"');
    expect(svg).toContain('id="layer-cut"');
    expect(svg).toContain("#000000");
    expect(svg).toContain("mm");
  });

  it("creates engrave, score, border and cut layers as needed", () => {
    const cut = part({ id: "c", name: "Corte", offsetMm: 2, separateBorder: true });
    const eng = part({ id: "e", name: "Grabado", operation: "engrave", offsetMm: 2 });
    const score = part({ id: "s", name: "Marcado", operation: "score" });
    const svg = buildSheetSvg(doc([cut, eng, score]), 0);
    expect(svg).toContain('id="layer-engrave"');
    expect(svg).toContain('id="layer-score"');
    expect(svg).toContain('id="layer-cut"');
    expect(svg).toContain('id="layer-border"');
    expect(svg).toContain("#0000FF");
    expect(svg).toContain("#008000");
    expect(svg).toContain("#FF00FF");
  });

  it("adds kerf to the cut outline and changes geometry", () => {
    const p = part();
    const noKerf = buildSheetSvg(doc([p]), 0, { kerf: false, bridges: false, bridgeCount: 4, bridgeWidth: 2.5, frame: false, order: false, notes: false });
    const withKerf = buildSheetSvg(doc([p]), 0, { kerf: true, bridges: false, bridgeCount: 4, bridgeWidth: 2.5, frame: false, order: false, notes: false });
    expect(noKerf).not.toBe(withKerf);
    const areaNo = effectiveGeometry(p).width * effectiveGeometry(p).height;
    expect(areaNo).toBeCloseTo(1200, 0);
  });

  it("creates open paths when bridges are enabled", () => {
    const d = doc([part()]);
    const svg = buildSheetSvg(d, 0, { kerf: false, bridges: true, bridgeCount: 4, bridgeWidth: 2.5, frame: false, order: false, notes: false });
    const cutGroup = svg.split('id="layer-cut"')[1] || "";
    expect((cutGroup.match(/M/g) || []).length).toBe(4);
    // los tramos no se cierran
    expect(cutGroup.split("</g>")[0]).not.toContain("Z");
  });

  it("adds the optional outer frame", () => {
    const svg = buildSheetSvg(doc([part()]), 0, { kerf: true, bridges: false, bridgeCount: 4, bridgeWidth: 2.5, frame: true, order: true, notes: true });
    expect(svg).toContain('id="layer-marks"');
    expect(svg).toContain("#FF0000");
  });

  it("deja dibujos debajo y líneas encima, con el recuadro exterior al final", () => {
    const cut = part({ id: "c2", name: "Corte" });
    const eng = part({ id: "e2", name: "Grabado", operation: "engrave" });
    const svg = buildSheetSvg(doc([cut, eng]), 0);
    const engAt = svg.indexOf('id="layer-engrave"');
    const cutAt = svg.indexOf('id="layer-cut"');
    const frameAt = svg.indexOf('id="layer-marks"');
    expect(engAt).toBeGreaterThanOrEqual(0);
    expect(cutAt).toBeGreaterThan(engAt);
    expect(frameAt).toBeGreaterThan(cutAt);
    expect(svg).toContain("M0 0H300V300H0Z");
  });

  it("mantiene los grupos originales y no mete todo en un único grupo", () => {
    const a = part({ id: "a", name: "A", assemblyId: "asm1" });
    const b = part({ id: "b", name: "B", assemblyId: "asm1" });
    const c = part({ id: "c", name: "C" });
    const d = doc([a, b, c], {
      groups: [{ id: "asm1", name: "Figura A", copies: 1, members: [{ partId: "a", dx: 0, dy: 0 }, { partId: "b", dx: 10, dy: 0 }] }],
      placements: [
        { id: "pl1", partId: "a", page: 0, x: 20, y: 20, angle: 0, mirror: false, pinned: false, assemblyId: "asm1" },
        { id: "pl2", partId: "b", page: 0, x: 30, y: 20, angle: 0, mirror: false, pinned: false, assemblyId: "asm1" },
        { id: "pl3", partId: "c", page: 0, x: 70, y: 20, angle: 0, mirror: false, pinned: false },
      ],
    });
    const svg = buildSheetSvg(d, 0, { kerf: true, bridges: false, bridgeCount: 4, bridgeWidth: 2.5, frame: true, order: true, notes: true });
    expect(svg).toContain('data-group-id="asm1"');
    expect(svg).toContain('data-group-name="Figura A"');
    expect(svg).toContain('id="group-asm1-cut"');
    expect((svg.match(/data-group-id="asm1"/g) || []).length).toBe(1);
    expect(svg).toContain('id="p-pl3-cut"');
  });

  it("embeds raster images as data URLs", () => {
    const r = part({
      id: "r",
      kind: "raster",
      contours: [],
      width: 30,
      height: 20,
      operation: "engrave",
      raster: { dataUrl: "data:image/png;base64,AAAA", width: 100, height: 60, dpi: 300, mode: "grayscale", threshold: 128, invert: false },
    });
    const svg = buildSheetSvg(doc([r]), 0);
    expect(svg).toContain("<image");
    expect(svg).toContain("data:image/png;base64,AAAA");
    expect(svg).toContain("<g transform=\"matrix(");
  });

  it("packages all files in a zip", () => {
    const d = doc([part()]);
    const files = buildExportFiles(d, { kerf: true, bridges: false, bridgeCount: 4, bridgeWidth: 2.5, frame: false, order: true, notes: true });
    expect(files.some((f) => f.name.endsWith(".svg"))).toBe(true);
    expect(files.some((f) => f.name.endsWith(".json"))).toBe(true);
    expect(files.some((f) => f.name.includes("LightBurn"))).toBe(true);
    const zip = makeZip(files);
    expect(zip.length).toBeGreaterThan(100);
  });
});

describe("circle helper", () => {
  it("makes a closed circle", () => {
    const c = circleContour(10, 10, 5, 24);
    expect(c.length).toBe(24);
    expect(normalizeOrientation([c]).length).toBe(1);
  });
});

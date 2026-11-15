import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { importSvg, parseLength, parsePathData, parseTransform } from "./svgImport";
import { contourArea, contoursBounds } from "./geom";

const OPTS = {
  tolerance: 1.5,
  mode: "inteligente" as const,
  strokeMode: "cut" as const,
  simplify: 0,
};

function svg(body: string, attrs = 'width="100mm" height="100mm" viewBox="0 0 100 100"'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
}

describe("parseLength", () => {
  it("converts units", () => {
    expect(parseLength("10mm")).toBe(10);
    expect(parseLength("2cm")).toBe(20);
    expect(parseLength("1in")).toBeCloseTo(25.4);
    expect(parseLength("72pt")).toBeCloseTo(25.4);
    expect(parseLength("96px")).toBeCloseTo(25.4);
  });
});

describe("parseTransform", () => {
  it("combines transforms", () => {
    const m = parseTransform("translate(10 5) scale(2)");
    expect(m.a).toBe(2);
    expect(m.e).toBe(10);
    expect(m.f).toBe(5);
  });
});

describe("parsePathData", () => {
  it("parses curves and relative commands", () => {
    const subs = parsePathData("M0 0 h10 v10 h-10 z M20 20 l5 0 0 5 z", 0.1);
    expect(subs.length).toBe(2);
    expect(subs[0].closed).toBe(true);
    expect(contoursBounds([subs[0].points]).w).toBeCloseTo(10, 1);
  });
});

describe("importSvg", () => {
  it("separates two far rectangles", () => {
    const res = importSvg(
      svg('<rect x="0" y="0" width="20" height="20"/><rect x="70" y="70" width="20" height="20"/>'),
      OPTS,
    );
    expect(res.parts.length).toBe(2);
    expect(res.parts[0].width).toBeCloseTo(20, 0);
    expect(res.parts[1].width).toBeCloseTo(20, 0);
  });

  it("splits a single path with two islands", () => {
    const res = importSvg(
      svg('<path d="M0 0H20V20H0Z M60 60H80V80H60Z"/>'),
      { ...OPTS, mode: "formas" },
    );
    expect(res.parts.length).toBe(2);
    expect(res.islands.length).toBe(2);
  });

  it("keeps holes inside one part", () => {
    const res = importSvg(
      svg('<path fill-rule="evenodd" d="M0 0H100V100H0Z M30 30H70V70H30Z"/>'),
      { ...OPTS, mode: "formas" },
    );
    expect(res.parts.length).toBe(1);
    expect(res.parts[0].contours.length).toBe(2);
    const b = contoursBounds(res.parts[0].contours);
    expect(b.w).toBeCloseTo(100, 0);
    expect(Math.abs(contourArea(res.parts[0].contours.find((c) => Math.abs(contourArea(c)) < 2000)!))).toBeCloseTo(1600, 0);
  });

  it("uses viewBox scale in mm", () => {
    const res = importSvg(
      svg('<rect width="50" height="50"/>', 'width="50mm" height="50mm" viewBox="0 0 100 100"'),
      OPTS,
    );
    expect(res.parts[0].width).toBeCloseTo(25, 2);
  });

  it("groups nearby details but not distant pieces", () => {
    const near = svg(
      '<rect x="10" y="10" width="20" height="20"/><circle cx="35" cy="20" r="4"/>',
    );
    const grouped = importSvg(near, { ...OPTS, tolerance: 2 });
    expect(grouped.parts.length).toBe(1);
    const loose = importSvg(near, { ...OPTS, tolerance: 0.1 });
    expect(loose.parts.length).toBe(2);
  });

  it("respects explicit groups in group mode", () => {
    const res = importSvg(
      svg('<g id="a"><rect x="0" y="0" width="10" height="10"/><rect x="60" y="0" width="10" height="10"/></g>'),
      { ...OPTS, mode: "grupos" },
    );
    expect(res.parts.length).toBe(1);
    expect(res.hasGroups).toBe(true);
  });

  it("converts strokes without fill to outlines", () => {
    const res = importSvg(
      svg('<path d="M10 50H90" fill="none" stroke="#000" stroke-width="2"/>'),
      OPTS,
    );
    expect(res.parts.length).toBe(1);
    expect(res.parts[0].height).toBeCloseTo(2, 0);
    expect(res.parts[0].width).toBeCloseTo(82, 0);
  });

  it("applies transforms and scaling", () => {
    const res = importSvg(
      svg('<rect x="0" y="0" width="10" height="10" transform="translate(20 20) scale(2)"/>'),
      { ...OPTS, targetWidth: 80 },
    );
    expect(res.parts.length).toBe(1);
    expect(res.parts[0].width).toBeCloseTo(80, 1);
  });

  it("warns about text", () => {
    const res = importSvg(svg('<rect width="10" height="10"/><text x="0" y="0">Hola</text>'), OPTS);
    expect(res.warnings.join(" ")).toMatch(/texto/i);
    expect(res.textCount).toBe(1);
  });

  it("imports the bundled sample with groups, names and holes", () => {
    const sample = readFileSync("examples/muestra-pegatinas.svg", "utf8");
    const res = importSvg(sample, { ...OPTS, tolerance: 1 });
    const names = res.parts.map((p) => p.name);
    expect(res.parts.length).toBe(5);
    expect(names).toContain("Gato");
    expect(names).toContain("Marco");
    const cat = res.parts.find((p) => p.name === "Gato")!;
    const moon = res.parts.find((p) => p.name === "Luna")!;
    expect(cat.contours.length).toBe(3); // exterior + dos ojos
    expect(moon.contours.length).toBe(1); // media luna: un solo contorno abierto
    expect(contourArea(cat.contours.find((c) => contourArea(c) < 0)!)).toBeLessThan(0);
  });
});

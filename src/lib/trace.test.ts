import { describe, it, expect, beforeAll } from "vitest";
import {
  buildMask,
  ditherFloydSteinberg,
  halftoneDots,
  luminanceAt,
  marchingSquares,
  traceImage,
} from "./trace";
import { contourArea, contoursBounds } from "./geom";

function blank(w: number, h: number): ImageData {
  const img = new ImageData(w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = 255;
    img.data[i + 1] = 255;
    img.data[i + 2] = 255;
    img.data[i + 3] = 255;
  }
  return img;
}

function fillRect(img: ImageData, x0: number, y0: number, x1: number, y1: number, v: number): void {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
}

describe("trace", () => {
  beforeAll(() => {
    if (typeof ImageData === "undefined") {
      // jsdom no implementa ImageData
      (globalThis as any).ImageData = class {
        data: Uint8ClampedArray;
        width: number;
        height: number;
        constructor(w: number, h: number) {
          this.width = w;
          this.height = h;
          this.data = new Uint8ClampedArray(w * h * 4);
        }
      };
    }
  });

  it("reads luminance with alpha", () => {
    const img = blank(1, 1);
    img.data[0] = 0; img.data[1] = 0; img.data[2] = 0; img.data[3] = 255;
    expect(luminanceAt(img.data, 0)).toBe(0);
  });

  it("builds a binary mask", () => {
    const img = blank(10, 10);
    fillRect(img, 2, 2, 8, 8, 0);
    const mask = buildMask(img, { threshold: 128, invert: false, alphaThreshold: 10, removeBackground: false });
    expect(mask[2 * 10 + 2]).toBe(1);
    expect(mask[0]).toBe(0);
  });

  it("marching squares returns closed loops", () => {
    const mask = new Uint8Array(20 * 20);
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) mask[y * 20 + x] = 1;
    const loops = marchingSquares(mask, 20, 20);
    expect(loops.length).toBe(1);
    const b = contoursBounds(loops);
    expect(b.x).toBeCloseTo(5.5, 0);
    expect(b.y).toBeCloseTo(5.5, 0);
    expect(b.w).toBeCloseTo(10, 0);
    expect(b.h).toBeCloseTo(10, 0);
  });

  it("traces a square to mm", () => {
    const img = blank(20, 20);
    fillRect(img, 5, 5, 15, 15, 0);
    const res = traceImage(img, {
      threshold: 128, invert: false, alphaThreshold: 10, simplifyPx: 0,
      minAreaMm2: 0, dpi: 25.4, smooth: 0, removeBackground: false,
    });
    expect(res.contours.length).toBe(1);
    const b = contoursBounds(res.contours);
    expect(b.w).toBeCloseTo(10, 0);
    expect(b.h).toBeCloseTo(10, 0);
  });

  it("keeps holes", () => {
    const img = blank(20, 20);
    fillRect(img, 0, 0, 20, 20, 0);
    fillRect(img, 5, 5, 15, 15, 255);
    const res = traceImage(img, {
      threshold: 128, invert: false, alphaThreshold: 10, simplifyPx: 0,
      minAreaMm2: 0, dpi: 25.4, smooth: 0, removeBackground: false,
    });
    expect(res.contours.length).toBe(2);
    const area = res.contours.reduce((s, c) => s + contourArea(c), 0);
    expect(Math.abs(area)).toBeCloseTo(300, 0);
  });

  it("dithers deterministically", () => {
    const img = blank(16, 16);
    for (let i = 0; i < 256; i++) {
      const v = Math.round((i / 256) * 255);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    }
    const a = ditherFloydSteinberg(img, 128);
    const b = ditherFloydSteinberg(img, 128);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it("creates halftone dots", () => {
    const img = blank(40, 40);
    fillRect(img, 0, 0, 40, 40, 0);
    const dots = halftoneDots(img, 20, 20, { dotsPerMm: 2 });
    expect(dots.length).toBeGreaterThan(10);
    const b = contoursBounds(dots);
    expect(b.w).toBeLessThanOrEqual(20.5);
  });
});

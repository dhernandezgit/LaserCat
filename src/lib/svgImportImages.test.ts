import { describe, expect, it } from "vitest";
import { importSvg } from "./svgImport";
import { partsFromSvgResult } from "./autoImport";

/**
 * Prueba propia y sintética: una imagen PNG incrustada (1×1) y un contorno de
 * corte a su alrededor. No usa archivos de ejemplo del usuario.
 */
describe("importSvg con imágenes incrustadas", () => {
  it("crea una pieza raster y una figura que engloba su corte", () => {
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="60mm" viewBox="0 0 60 60">
      <image x="10" y="10" width="40" height="40" href="${png}" />
      <rect x="7" y="7" width="46" height="46" rx="4" fill="none" stroke="#000" stroke-width="0.2" />
    </svg>`;

    const res = importSvg(svg, {
      tolerance: 1,
      mode: "inteligente",
      strokeMode: "cut",
      simplify: 0,
      whiteAsHoles: true,
    });

    const raster = res.parts.filter((p) => p.kind === "raster");
    expect(raster).toHaveLength(1);
    expect(raster[0].raster?.dataUrl).toBe(png);
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].memberIds).toContain(raster[0].id);
    expect(res.parts.some((p) => p.kind === "vector")).toBe(true);
    expect(res.scale).toBeGreaterThan(0);
    expect(Number.isFinite(res.widthMm)).toBe(true);

    const payload = partsFromSvgResult(res);
    expect(payload.parts).toHaveLength(res.parts.length);
    expect(payload.groups).toHaveLength(1);
    expect(payload.groups[0].members).toHaveLength(2);
    expect(payload.groups[0].members.some((m) => payload.parts.find((p) => p.id === m.partId)?.kind === "raster")).toBe(true);
  });

  it("conserva giros y espejos de la imagen respecto a los cortes", () => {
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="60mm" viewBox="0 0 60 60">
      <image x="10" y="10" width="40" height="40" transform="rotate(180 30 30)" href="${png}" />
      <rect x="7" y="7" width="46" height="46" fill="none" stroke="#000" stroke-width="0.2" />
    </svg>`;
    const res = importSvg(svg, { tolerance: 1, mode: "inteligente", strokeMode: "cut", simplify: 0, whiteAsHoles: true });
    const image = res.parts.find((p) => p.kind === "raster")!;
    expect(image.raster?.matrix?.[0]).toBeLessThan(0);
    expect(image.raster?.matrix?.[3]).toBeLessThan(0);
    const payload = partsFromSvgResult(res);
    expect(payload.groups[0].members).toHaveLength(2);
  });
});

import { describe, it, expect } from "vitest";
import { buildTestCard, testCardReadme } from "./testcard";
import { createEmptyDoc } from "./store";

describe("test card", () => {
  it("builds 24 cells with distinct colors", () => {
    const doc = createEmptyDoc();
    const card = buildTestCard(doc);
    expect(card.cells.length).toBe(24);
    expect(new Set(card.cells.map((c) => c.color)).size).toBe(24);
    expect(card.powers.length).toBe(6);
    expect(card.speeds.length).toBe(4);
    expect(card.svg).toContain('width="200mm"');
    expect((card.svg.match(/id="prueba-/g) || []).length).toBe(24);
    expect(card.csv).toContain("potencia %");
  });

  it("is valid XML", () => {
    const card = buildTestCard(createEmptyDoc());
    const parsed = new DOMParser().parseFromString(card.svg, "image/svg+xml");
    expect(parsed.querySelector("parsererror")).toBeNull();
    expect(parsed.querySelectorAll("g[id^='prueba-']").length).toBe(24);
  });

  it("includes usage instructions", () => {
    const doc = createEmptyDoc();
    const card = buildTestCard(doc);
    const readme = testCardReadme(doc, card);
    expect(readme).toMatch(/LightBurn/);
    expect(readme).toMatch(/24 celdas/);
  });
});

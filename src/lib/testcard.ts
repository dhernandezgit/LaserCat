/**
 * Tarjeta de pruebas de grabado: 24 celdas con la misma geometría y un color
 * distinto por celda. Al importarla en LightBurn, cada color se convierte en
 * una capa y el CSV indica qué potencia/velocidad asignar a cada una.
 */

import type { Doc } from "../types";
import { fmt } from "./geom";
import { laserPresetFor, MATERIAL_BY_ID, MACHINE_BY_ID } from "./laser";

const PALETTE = [
  "#0000FF", "#FF0000", "#00A000", "#FF8000", "#8000FF", "#00A0A0",
  "#C00060", "#808000", "#000080", "#800000", "#008000", "#804080",
  "#FF0080", "#00C0FF", "#A06000", "#6000A0", "#006060", "#A00000",
  "#00FF80", "#C0C000", "#606060", "#004080", "#804000", "#400080",
];

// Segmentos de un display de 7 segmentos para numerar las celdas.
const SEGMENTS: Record<string, string> = {
  "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc",
  "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg",
};

function digit(x: number, y: number, value: string, w = 2.4, h = 4): string {
  const t = 0.55;
  const half = h / 2;
  const rects: string[] = [];
  const seg = (key: string) => {
    if (!SEGMENTS[value]?.includes(key)) return;
    let sx = x;
    let sy = y;
    let sw = w;
    let sh = t;
    if (key === "a") { sx = x; sy = y; }
    if (key === "b") { sx = x + w - t; sy = y; sw = t; sh = half; }
    if (key === "c") { sx = x + w - t; sy = y + half; sw = t; sh = half; }
    if (key === "d") { sx = x; sy = y + h - t; }
    if (key === "e") { sx = x; sy = y + half; sw = t; sh = half; }
    if (key === "f") { sx = x; sy = y; sw = t; sh = half; }
    if (key === "g") { sx = x; sy = y + half - t / 2; }
    rects.push(`M${fmt(sx)} ${fmt(sy)}h${fmt(sw)}v${fmt(sh)}h${fmt(-sw)}Z`);
  };
  for (const key of "abcdefg") seg(key);
  return rects.join("");
}

function numberPath(n: number, x: number, y: number): string {
  const s = String(n);
  if (s.length === 1) return digit(x + 1, y, s);
  return digit(x, y, s[0]) + digit(x + 2.8, y, s[1]);
}

function cellPattern(color: string, index: number): string {
  let d = "";
  // marco de la celda
  d += `<rect x="0" y="0" width="26" height="26" fill="none" stroke="${color}" stroke-width="0.35"/>`;
  // número de celda
  d += `<path d="${numberPath(index, 2, 1.6)}" fill="${color}" stroke="none"/>`;
  // bloque sólido para medir oscurecimiento
  d += `<rect x="2.5" y="8.5" width="10" height="5.5" fill="${color}" stroke="none"/>`;
  // círculo de línea fina
  d += `<circle cx="19.5" cy="11" r="4.8" fill="none" stroke="${color}" stroke-width="0.28"/>`;
  // peine de líneas de distinto grosor
  for (let i = 0; i < 5; i++) {
    d += `<rect x="2.5" y="${16.5 + i * 1.25}" width="${4 + i * 1.8}" height="${0.18 + i * 0.12}" fill="${color}" stroke="none"/>`;
  }
  // damero para comprobar resolución
  for (let yy = 0; yy < 3; yy++) {
    for (let xx = 0; xx < 3; xx++) {
      if ((xx + yy) % 2 === 0) {
        d += `<rect x="${16.5 + xx * 2.2}" y="${17 + yy * 2.2}" width="2.1" height="2.1" fill="${color}" stroke="none"/>`;
      }
    }
  }
  return d;
}

export interface TestCard {
  svg: string;
  csv: string;
  powers: number[];
  speeds: number[];
  cells: { index: number; color: string; power: number; speed: number }[];
}

export function buildTestCard(doc: Doc): TestCard {
  const mat = MATERIAL_BY_ID[doc.settings.materialId] || MATERIAL_BY_ID.tilo;
  const machine = MACHINE_BY_ID[doc.settings.machineId] || MACHINE_BY_ID.s30;
  const base = laserPresetFor(mat.id, "engrave", machine.id);
  const powers = [20, 35, 50, 65, 80, 100];
  const speeds = [
    Math.max(200, Math.round((base.speed * 0.5) / 100) * 100),
    Math.max(300, Math.round((base.speed * 0.75) / 100) * 100),
    Math.round(base.speed / 100) * 100,
    Math.round((base.speed * 1.3) / 100) * 100,
  ];
  const cols = powers.length;
  const rows = speeds.length;
  const cell = 26;
  const gap = 4;
  const marginX = (200 - (cols * cell + (cols - 1) * gap)) / 2;
  const marginY = (150 - (rows * cell + (rows - 1) * gap)) / 2 + 3;

  let body = "";
  const cells: TestCard["cells"] = [];
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      idx++;
      const color = PALETTE[(idx - 1) % PALETTE.length];
      const x = marginX + c * (cell + gap);
      const y = marginY + r * (cell + gap);
      cells.push({ index: idx, color, power: powers[c], speed: speeds[r] });
      body +=
        `<g id="prueba-${String(idx).padStart(2, "0")}" data-power="${powers[c]}" data-speed="${speeds[r]}" ` +
        `transform="translate(${fmt(x)} ${fmt(y)})">${cellPattern(color, idx)}</g>\n`;
    }
  }

  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="150mm" viewBox="0 0 200 150" version="1.1">\n` +
    `<title>LaserCat · tarjeta de pruebas · ${mat.name}</title>\n` +
    `<desc>6 potencias (columnas 20-100%) x 4 velocidades (filas ${speeds.join(", ")} mm/min). ` +
    `Cada celda tiene un color distinto: en LightBurn asigna la potencia y velocidad del CSV a cada capa. ` +
    `Máquina: ${machine.name}. Material: ${mat.name} ${mat.thickness} mm.</desc>\n` +
    body +
    `<rect x="2" y="2" width="196" height="146" fill="none" stroke="#000000" stroke-width="0.15" stroke-dasharray="2 2"/>\n` +
    `</svg>\n`;

  const csvRows = [
    ["celda", "color", "potencia %", "velocidad mm/min", "pasadas", "columna", "fila"],
    ...cells.map((c) => [
      String(c.index),
      c.color,
      String(c.power),
      String(c.speed),
      "1",
      String(powers.indexOf(c.power) + 1),
      String(speeds.indexOf(c.speed) + 1),
    ]),
    ["", "CORTE", "", "", "", "marco discontinuo", "opcional"],
  ];
  const csv =
    `# Tarjeta de pruebas LaserCat · ${mat.name} · ${machine.name}\n` +
    `# Columnas: potencia ${powers.join(" / ")} %. Filas: velocidad ${speeds.join(" / ")} mm/min.\n` +
    csvRows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n") +
    "\r\n";

  return { svg, csv, powers, speeds, cells };
}

export function testCardReadme(doc: Doc, card: TestCard): string {
  const mat = MATERIAL_BY_ID[doc.settings.materialId] || MATERIAL_BY_ID.tilo;
  const machine = MACHINE_BY_ID[doc.settings.machineId] || MACHINE_BY_ID.s30;
  return `TARJETA DE PRUEBAS · LaserCat
=============================

Máquina: ${machine.name}
Material: ${mat.name} (${mat.thickness} mm)

La tarjeta tiene ${card.cells.length} celdas: ${card.powers.length} potencias × ${card.speeds.length} velocidades.
Cada celda usa un color distinto. Al importar el SVG en LightBurn, cada color
se convierte en una capa.

1. Importa "tarjeta-pruebas-grabado.svg" en LightBurn.
2. Abre "tarjeta-pruebas-ajustes.csv": cada fila dice el color de la celda,
   la potencia y la velocidad que debes poner en esa capa.
3. Desactiva o ignora el marco discontinuo negro (capa CORTE) si solo quieres
   probar el grabado.
4. Graba en un retal del mismo material y compara las 24 celdas.
5. Elige la combinación que te guste y copia esos valores en tu proyecto.

Potencias: ${card.powers.join(", ")} %
Velocidades: ${card.speeds.join(", ")} mm/min

La celda tiene un número para identificarla. Haz una foto de la tarjeta y
apunta los ajustes ganadores: así no repetirás pruebas la próxima vez.
`;
}

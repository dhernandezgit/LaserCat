/** Biblioteca de grupos: guardar figuras con sus imágenes y reinsertarlas. */

import type { Assembly, Doc, Part, Placement } from "../types";
import { assemblyGeometry } from "./assembly";
import { dataUrlToBytes } from "./download";
import { buildExportFiles, makeZip, type SvgExportOptions } from "./export";
import { effectiveGeometry } from "./laser";

const KEY = "lasercat-groups-v1";

export interface SavedGroup {
  id: string;
  name: string;
  createdAt: number;
  parts: Part[];
  group: Assembly;
  thumbnail?: string;
}

export function loadGroupLibrary(): SavedGroup[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((g) => g && Array.isArray(g.parts) && g.group) : [];
  } catch {
    return [];
  }
}

export function saveGroupToLibrary(group: Assembly, parts: Part[], thumbnail?: string): boolean {
  try {
    const library = loadGroupLibrary();
    const entry: SavedGroup = {
      id: group.id,
      name: group.name,
      createdAt: Date.now(),
      parts: parts.map((p) => ({ ...p, assemblyId: undefined, copies: 1 })),
      group: { ...group, members: group.members.map((m) => ({ ...m })) },
      thumbnail,
    };
    const next = [entry, ...library.filter((g) => g.id !== group.id)].slice(0, 40);
    localStorage.setItem(KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export function deleteSavedGroup(id: string): void {
  try {
    const next = loadGroupLibrary().filter((g) => g.id !== id);
    localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("lasercat:groups-changed"));
  } catch {
    /* ignore */
  }
}

export function notifyGroupsChanged(): void {
  window.dispatchEvent(new CustomEvent("lasercat:groups-changed"));
}

export function groupParts(doc: Doc, group: Assembly): Part[] {
  const ids = new Set(group.members.map((m) => m.partId));
  return doc.parts.filter((p) => ids.has(p.id));
}

/** Miniatura: usa la imagen del grupo si la hay; si no, un SVG de sus cortes. */
export function groupThumbnail(doc: Doc, group: Assembly): string {
  const parts = groupParts(doc, group);
  const image = parts.find((p) => p.kind === "raster" && p.raster);
  if (image?.raster) return image.raster.dataUrl;
  const geo = assemblyGeometry(group, parts);
  if (!geo.contours.length) return "";
  const pad = Math.max(geo.width, geo.height) * 0.05 + 0.5;
  let body = "";
  for (const member of geo.members) {
    const part = parts.find((p) => p.id === member.partId);
    if (!part) continue;
    const g = effectiveGeometry(part);
    const d = g.base
      .map((c) => `M${c.map((p) => `${round(p.x + member.dx)} ${round(p.y + member.dy)}`).join("L")}Z`)
      .join("");
    body += `<path d="${d}" fill="${part.color || "#b5651d"}" fill-rule="evenodd" opacity=".55" stroke="#5a3a1c" stroke-width="0.4"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${geo.width + pad * 2} ${geo.height + pad * 2}">${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function groupExportOptions(doc: Doc): SvgExportOptions {
  return {
    kerf: doc.settings.exportKerf,
    bridges: doc.settings.exportBridges,
    bridgeCount: doc.settings.bridgeCount,
    bridgeWidth: doc.settings.bridgeWidth,
    frame: doc.settings.exportFrame,
    order: doc.settings.exportOrder,
    notes: doc.settings.exportNotes,
  };
}

/** Documento temporal con una sola figura, para exportarla por separado. */
export function buildGroupDoc(doc: Doc, group: Assembly): Doc | null {
  const parts = groupParts(doc, group);
  if (!parts.length) return null;
  const geo = assemblyGeometry(group, parts);
  const margin = 5;
  const width = Math.max(40, Math.ceil(geo.width + margin * 2));
  const height = Math.max(40, Math.ceil(geo.height + margin * 2));
  const placements: Placement[] = [];
  for (const member of geo.members) {
    if (!parts.some((p) => p.id === member.partId)) continue;
    placements.push({
      id: `pl-${member.partId}`,
      partId: member.partId,
      page: 0,
      x: margin + member.dx,
      y: margin + member.dy,
      angle: 0,
      mirror: false,
      pinned: true,
    });
  }
  return {
    ...doc,
    name: group.name,
    parts: parts.map((p) => ({ ...p, assemblyId: undefined, copies: 1 })),
    placements,
    groups: [],
    sheet: { ...doc.sheet, width, height, margin, singlePage: true },
    updatedAt: Date.now(),
  };
}

export function groupJson(group: Assembly, parts: Part[]): string {
  return JSON.stringify(
    {
      format: "lasercat-group",
      version: 1,
      name: group.name,
      createdAt: Date.now(),
      group: { ...group, members: group.members.map((m) => ({ ...m })) },
      parts: parts.map((p) => ({ ...p, assemblyId: undefined, copies: 1 })),
    },
    null,
    2,
  );
}

export function buildGroupZip(doc: Doc, group: Assembly): { name: string; bytes: Uint8Array } | null {
  const gdoc = buildGroupDoc(doc, group);
  if (!gdoc) return null;
  const files = buildExportFiles(gdoc, groupExportOptions(doc));
  files.push({ name: "grupo-lasercat.json", data: groupJson(group, groupParts(doc, group)) });
  for (const part of groupParts(doc, group)) {
    if (part.kind === "raster" && part.raster) {
      files.push({
        name: `imagenes/${part.name.replace(/[^\w\- ]+/g, "").trim() || part.id}.png`,
        data: dataUrlToBytes(part.raster.dataUrl),
      });
    }
  }
  const safe = (group.name || "figura").replace(/[^\w\-áéíóúñü ]+/gi, "").trim().replace(/\s+/g, "-").toLowerCase();
  return { name: `${safe || "figura"}-lightburn.zip`, bytes: makeZip(files) };
}

/** Reinserta un grupo guardado con IDs nuevos. */
export function cloneSavedGroup(saved: SavedGroup): { parts: Part[]; group: Assembly } {
  const idMap = new Map<string, string>();
  const parts: Part[] = saved.parts.map((p) => {
    const id = `part-${Math.random().toString(36).slice(2, 10)}`;
    idMap.set(p.id, id);
    return { ...p, id, assemblyId: undefined, copies: 1 };
  });
  const group: Assembly = {
    ...saved.group,
    id: `asm-${Math.random().toString(36).slice(2, 10)}`,
    copies: Math.max(1, saved.group.copies || 1),
    members: saved.group.members
      .filter((m) => idMap.has(m.partId))
      .map((m) => ({ ...m, partId: idMap.get(m.partId)! })),
  };
  for (const p of parts) p.assemblyId = group.id;
  return { parts, group };
}

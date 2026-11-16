/** Ensamblajes: grupos de piezas que se mueven, giran y anidan como una unidad. */

import type { Assembly, AssemblyMember, Doc, Part, Placement } from "../types";
import { unionContours } from "./clipper";
import { contoursBounds, rotatedSize, translateContours } from "./geom";
import { effectiveGeometry } from "./laser";

export function getGroups(doc: Doc): Assembly[] {
  return doc.groups || [];
}

export function groupById(doc: Doc, id: string): Assembly | undefined {
  return getGroups(doc).find((g) => g.id === id);
}

export function groupOfPart(doc: Doc, partId: string): Assembly | undefined {
  return getGroups(doc).find((g) => g.members.some((m) => m.partId === partId));
}

export interface AssemblyGeometry {
  contours: ReturnType<typeof unionContours>;
  width: number;
  height: number;
  members: AssemblyMember[];
  area: number;
}

/** Geometría combinada del grupo, normalizada a (0,0), con offsets ajustados. */
export function assemblyGeometry(group: Assembly, parts: Part[]): AssemblyGeometry {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const memberParts: { member: AssemblyMember; part: Part; geo: ReturnType<typeof effectiveGeometry> }[] = [];
  for (const member of group.members) {
    const part = byId.get(member.partId);
    if (!part) continue;
    memberParts.push({ member, part, geo: effectiveGeometry(part) });
  }
  if (!memberParts.length) {
    return { contours: [], width: 0, height: 0, members: [], area: 0 };
  }
  const all = memberParts.flatMap((m) =>
    translateContours(m.geo.outer, m.member.dx, m.member.dy),
  );
  const b = contoursBounds(all);
  const contours = unionContours([translateContours(all, -b.x, -b.y)]);
  return {
    contours,
    width: b.w,
    height: b.h,
    members: memberParts.map((m) => ({
      partId: m.member.partId,
      dx: m.member.dx - b.x,
      dy: m.member.dy - b.y,
    })),
    area: contours.reduce((sum, c) => sum + Math.abs(c.reduce((a, p, i, arr) => {
      const q = arr[(i + 1) % arr.length];
      return a + p.x * q.y - q.x * p.y;
    }, 0) / 2), 0),
  };
}

/** Normaliza los offsets para que el grupo empiece en (0,0). */
export function normalizeMembers(members: AssemblyMember[], parts: Part[]): AssemblyMember[] {
  const byId = new Map(parts.map((p) => [p.id, p]));
  let minX = Infinity;
  let minY = Infinity;
  for (const m of members) {
    const part = byId.get(m.partId);
    if (!part) continue;
    minX = Math.min(minX, m.dx);
    minY = Math.min(minY, m.dy);
  }
  if (!Number.isFinite(minX)) return [];
  return members.map((m) => ({ ...m, dx: m.dx - minX, dy: m.dy - minY }));
}

/** Caja del grupo a partir de sus colocaciones actuales. */
export function groupBounds(
  parts: Part[],
  placements: Placement[],
): { x: number; y: number; w: number; h: number } {
  const byId = new Map(parts.map((p) => [p.id, p]));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pl of placements) {
    const part = byId.get(pl.partId);
    if (!part) continue;
    const geo = effectiveGeometry(part);
    const size = rotatedSize({ width: geo.width, height: geo.height }, pl.angle);
    minX = Math.min(minX, pl.x);
    minY = Math.min(minY, pl.y);
    maxX = Math.max(maxX, pl.x + size.w);
    maxY = Math.max(maxY, pl.y + size.h);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Rota un conjunto de colocaciones alrededor del centro de su caja común. */
export function rotatePlacements(
  parts: Part[],
  placements: Placement[],
  delta: number,
): Placement[] {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const box = groupBounds(parts, placements);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rad = (delta * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return placements.map((pl) => {
    const part = byId.get(pl.partId);
    if (!part) return pl;
    const geo = effectiveGeometry(part);
    const before = rotatedSize({ width: geo.width, height: geo.height }, pl.angle);
    const after = rotatedSize({ width: geo.width, height: geo.height }, pl.angle + delta);
    const px = pl.x + before.w / 2;
    const py = pl.y + before.h / 2;
    const dx = px - cx;
    const dy = py - cy;
    const nx = cx + dx * cos - dy * sin;
    const ny = cy + dx * sin + dy * cos;
    return {
      ...pl,
      angle: (pl.angle + delta + 360) % 360,
      x: Math.round((nx - after.w / 2) * 100) / 100,
      y: Math.round((ny - after.h / 2) * 100) / 100,
    };
  });
}

/** Miembros de un grupo que tienen colocación. */
export function groupPlacements(doc: Doc, groupId: string): Placement[] {
  return doc.placements.filter((p) => p.assemblyId === groupId);
}

/** Construye un ensamblaje a partir de colocaciones independientes. */
export function assemblyFromPlacements(
  parts: Part[],
  placements: Placement[],
  name: string,
): { group: Assembly; parts: Part[] } {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const ids = Array.from(new Set(placements.map((p) => p.partId))).filter((id) => byId.has(id));
  const minX = Math.min(...placements.map((p) => p.x));
  const minY = Math.min(...placements.map((p) => p.y));
  const members: AssemblyMember[] = ids.map((partId) => {
    const pl = placements.find((p) => p.partId === partId)!;
    return { partId, dx: pl.x - minX, dy: pl.y - minY };
  });
  return {
    group: { id: `asm-${Math.random().toString(36).slice(2, 9)}`, name, members, copies: 1 },
    parts,
  };
}

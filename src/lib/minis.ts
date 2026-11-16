/** Copias pequeñas de relleno, como los «minis» de CryCat. */

import type { Assembly, Doc, Part } from "../types";
import { uid } from "./demo";
import { getGroups } from "./assembly";

export function buildMiniPayload(doc: Doc, scale = 0.5): { parts: Part[]; groups: Assembly[] } {
  const s = Math.max(0.2, Math.min(0.8, scale));
  const parts: Part[] = [];
  const groups: Assembly[] = [];
  const sourceParts = doc.parts.filter((p) => p.source !== "demo");
  if (!sourceParts.length) return { parts, groups };
  const byId = new Map(sourceParts.map((p) => [p.id, p]));

  const clonePart = (source: Part): Part => {
    const id = uid("mini");
    return {
      ...source,
      id,
      name: `${source.name} mini`,
      width: source.width * s,
      height: source.height * s,
      contours: source.contours.map((c) => c.map((p) => ({ x: p.x * s, y: p.y * s }))),
      copies: 1,
      assemblyId: undefined,
      raster: source.raster
        ? { ...source.raster, width: source.raster.width, height: source.raster.height, dpi: source.raster.dpi / s }
        : undefined,
    };
  };

  const grouped = new Set<string>();
  for (const group of getGroups(doc)) {
    const members = group.members.map((m) => byId.get(m.partId)).filter(Boolean) as Part[];
    if (!members.length) continue;
    const clones = members.map(clonePart);
    members.forEach((m) => grouped.add(m.id));
    const gid = uid("asm");
    groups.push({
      id: gid,
      name: `${group.name} mini`,
      copies: 1,
      color: group.color,
      members: group.members
        .map((m, i) => ({ partId: clones[i].id, dx: m.dx * s, dy: m.dy * s }))
        .filter((m) => clones.some((c) => c.id === m.partId)),
    });
    for (const c of clones) c.assemblyId = gid;
    parts.push(...clones);
  }
  for (const p of sourceParts) {
    if (grouped.has(p.id)) continue;
    parts.push(clonePart(p));
  }
  return { parts, groups };
}

/** Estado global, historial y colocación automática. */

import type {
  Assembly,
  Doc,
  DocSettings,
  EngraveMode,
  NestRequestPart,
  Part,
  Placement,
  SelectionState,
  Sheet,
} from "../types";
import { demoParts } from "./demo";
import { rotatedSize, rotatePt, rectContour } from "./geom";
import { effectiveGeometry } from "./laser";
import { nestParts } from "./nest";
import type { NestResult } from "../types";
import { assemblyGeometry, assemblyFromPlacements, getGroups, normalizeMembers, rotatePlacements } from "./assembly";

export const STORAGE_KEY = "lasercat-doc-v1";

export const DEFAULT_SHEET: Sheet = {
  width: 300,
  height: 300,
  margin: 5,
  spacing: 3,
  kerf: 0.15,
  rotation: "libre",
  quality: "maxima",
  method: "auto",
  packMode: "shape",
  singlePage: false,
};

export const DEFAULT_SETTINGS: DocSettings = {
  machineId: "s30",
  materialId: "tilo",
  expert: false,
  autoNest: true,
  imageDropMode: "cut",
  compact: true,
  wood3dDepth: 3,
  wood3dCut: true,
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
  previewBurnTone: "miel",
  previewPower: 35,
  previewSpeed: 3600,
  previewPasses: 1,
};

export interface LastNest {
  at: number;
  unplaced: number;
  efficiency: number;
  pages: number;
  elapsedMs: number;
}

export interface UiState {
  page: number;
  tab: "diseno" | "plancha" | "grabado" | "material";
  view: "plan" | "wood" | "wood3d";
  showSvgDialog: boolean;
  showImageDialog: boolean;
  showExportDialog: boolean;
  showHelpDialog: boolean;
  pendingSvgFile: File | null;
  pendingImageFile: File | null;
  pendingImageMode: EngraveMode;
  pendingImageCut: boolean;
  toast: { text: string; kind: "ok" | "warn" | "error" } | null;
}

export interface AppState {
  doc: Doc;
  selection: SelectionState;
  past: Doc[];
  future: Doc[];
  lastKey: string;
  lastAt: number;
  lastNest: LastNest | null;
  ui: UiState;
}

export type Action =
  | { type: "ADD_PARTS"; parts: Part[]; groups?: Assembly[]; nest?: boolean }
  | { type: "SET_ALL_OFFSET"; value: number; nest?: boolean }
  | { type: "UPDATE_PART"; id: string; patch: Partial<Part>; nest?: boolean; key?: string }
  | { type: "RESIZE_PART"; id: string; width: number; height: number; nest?: boolean }
  | { type: "RESIZE_ASSEMBLY"; id: string; width: number; height: number; nest?: boolean }
  | { type: "REMOVE_PARTS"; ids: string[] }
  | { type: "SET_COPIES"; id: string; copies: number }
  | { type: "NEST" }
  | { type: "MOVE_PLACEMENT"; id: string; x: number; y: number }
  | { type: "SET_POSITIONS"; positions: { id: string; x: number; y: number }[]; key?: string }
  | { type: "SET_PLACEMENT"; id: string; patch: Partial<Placement> }
  | { type: "ROTATE_PLACEMENT"; id: string; delta: number }
  | { type: "ROTATE_SELECTION"; placementIds: string[]; delta: number; key?: string }
  | { type: "PIN_PLACEMENT"; id: string; pinned: boolean }
  | { type: "DELETE_PLACEMENT"; id: string }
  | { type: "DUPLICATE_PLACEMENT"; id: string }
  | { type: "DUPLICATE_PART"; id: string }
  | { type: "ADD_SHAPE"; shape: Part }
  | { type: "SET_ASSEMBLY_COPIES"; id: string; copies: number }
  | { type: "RENAME_ASSEMBLY"; id: string; name: string }
  | { type: "ROTATE_ASSEMBLY"; id: string; delta: number }
  | { type: "PIN_ASSEMBLY"; id: string; pinned: boolean }
  | { type: "UNGROUP"; id: string }
  | { type: "GROUP_PLACEMENTS"; placementIds: string[]; name?: string }
  | { type: "CLEAR" }
  | { type: "RENAME"; name: string }
  | { type: "LOAD_PROJECT"; doc: Doc }
  | { type: "SELECT"; partIds?: string[]; placementIds?: string[] }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SET_UI"; patch: Partial<UiState> }
  | { type: "SET_PAGE"; page: number }
  | { type: "TOAST"; text: string; kind?: "ok" | "warn" | "error" }
  | { type: "DISMISS_TOAST" }
  | { type: "SET_SHEET"; patch: Partial<Sheet>; nest?: boolean }
  | { type: "SET_SETTINGS"; patch: Partial<DocSettings> };

function now(): number {
  return Date.now();
}

function nextId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36).slice(-4)}`;
}

/** Recoloca todas las piezas no fijadas y devuelve el documento y el aviso. */
export function nestDoc(doc: Doc): { doc: Doc; nest: LastNest } {
  if (!doc.parts.length) {
    return {
      doc: { ...doc, placements: [], updatedAt: now() },
      nest: { at: now(), unplaced: 0, efficiency: 0, pages: 1, elapsedMs: 0 },
    };
  }
  const partsById = new Map(doc.parts.map((p) => [p.id, p]));
  const groups = getGroups(doc);
  const groupedPartIds = new Set(groups.flatMap((g) => g.members.map((m) => m.partId)));
  const pinned = doc.placements.filter((p) => p.pinned && partsById.has(p.partId));
  const pinnedCount = new Map<string, number>();
  for (const p of pinned) pinnedCount.set(p.partId, (pinnedCount.get(p.partId) || 0) + 1);

  // Un grupo se considera fijado si todos sus miembros tienen una colocación fijada.
  const pinnedGroups = new Set<string>();
  for (const group of groups) {
    const gp = pinned.filter((p) => p.assemblyId === group.id || group.members.some((m) => m.partId === p.partId));
    const ids = new Set(gp.map((p) => p.partId));
    if (group.members.length > 0 && group.members.every((m) => ids.has(m.partId))) {
      pinnedGroups.add(group.id);
    }
  }

  const request: NestRequestPart[] = [];
  const boxMode = doc.sheet.packMode === "box";
  const boxFor = (w: number, h: number) => [rectContour(0, 0, Math.max(0.1, w), Math.max(0.1, h))];
  // Piezas reales con copies 0: sirven para que el packer encuentre las fijadas.
  for (const part of doc.parts) {
    const grouped = groupedPartIds.has(part.id);
    const g = effectiveGeometry(part);
    const already = pinnedCount.get(part.id) || 0;
    request.push({
      partId: part.id,
      copies: grouped ? 0 : Math.max(0, part.copies - already),
      contours: boxMode ? boxFor(g.width, g.height) : g.outer,
      width: g.width,
      height: g.height,
      raster: part.kind === "raster",
      angles: grouped ? [0] : undefined,
    });
  }
  // Groups as synthetic nestable units, axis-aligned to keep exact registration.
  const groupGeo = new Map<string, ReturnType<typeof assemblyGeometry>>();
  for (const group of groups) {
    const geo = assemblyGeometry(group, doc.parts);
    if (!geo.contours.length) continue;
    groupGeo.set(group.id, geo);
    const already = pinnedGroups.has(group.id) ? 1 : 0;
    request.push({
      partId: `asm:${group.id}`,
      copies: Math.max(0, group.copies - already),
      contours: boxMode ? boxFor(geo.width, geo.height) : geo.contours,
      width: geo.width,
      height: geo.height,
    });
  }

  let result: NestResult;
  try {
    result = nestParts(request, {
      sheet: doc.sheet,
      rotation: doc.sheet.rotation,
      quality: doc.sheet.quality,
      method: doc.sheet.method,
      packMode: doc.sheet.packMode,
      compact: doc.settings.compact !== false,
      pinned,
    });
  } catch (err) {
    console.error(err);
    return {
      doc,
      nest: { at: now(), unplaced: 0, efficiency: 0, pages: 1, elapsedMs: 0 },
    };
  }
  const fresh = result.placements.slice(0, Math.max(0, result.placements.length - pinned.length));
  const freshPlacements: Placement[] = [];
  for (const p of fresh) {
    if (p.partId.startsWith("asm:")) {
      const groupId = p.partId.slice(4);
      const group = groups.find((g) => g.id === groupId);
      const geo = groupGeo.get(groupId);
      if (!group || !geo) continue;
      const rw = rotatedSize({ width: geo.width, height: geo.height }, p.angle).w;
      const rh = rotatedSize({ width: geo.width, height: geo.height }, p.angle).h;
      const cx = geo.width / 2;
      const cy = geo.height / 2;
      const localMinX = cx - rw / 2;
      const localMinY = cy - rh / 2;
      for (const member of geo.members) {
        const part = partsById.get(member.partId);
        if (!part) continue;
        const pg = effectiveGeometry(part);
        const center = rotatePt(
          { x: member.dx + pg.width / 2, y: member.dy + pg.height / 2 },
          cx,
          cy,
          p.angle,
        );
        const size = rotatedSize({ width: pg.width, height: pg.height }, p.angle);
        freshPlacements.push({
          id: nextId("pl"),
          partId: member.partId,
          page: p.page,
          x: Math.round((p.x + center.x - localMinX - size.w / 2) * 100) / 100,
          y: Math.round((p.y + center.y - localMinY - size.h / 2) * 100) / 100,
          angle: p.angle,
          mirror: false,
          pinned: false,
          assemblyId: group.id,
        });
      }
    } else {
      freshPlacements.push({
        ...p,
        id: nextId("pl"),
        pinned: false,
        assemblyId: undefined,
      });
    }
  }
  const preserved = doc.placements.filter((p) => p.pinned);
  const placements: Placement[] = [...freshPlacements, ...preserved];
  const existingIds = new Set(doc.parts.map((p) => p.id));
  const valid = placements.filter((p) => existingIds.has(p.partId));
  const pages = Math.max(1, ...valid.map((p) => p.page + 1));
  const clamped = valid.map((p) => ({ ...p, page: Math.min(pages - 1, Math.max(0, p.page)) }));
  return {
    doc: { ...doc, placements: clamped, updatedAt: now() },
    nest: {
      at: now(),
      unplaced: result.unplaced,
      efficiency: result.efficiency,
      pages: result.pages,
      elapsedMs: result.elapsedMs,
    },
  };
}

function ensurePage(state: AppState): number {
  const pages = Math.max(1, ...state.doc.placements.map((p) => p.page + 1));
  return Math.min(state.ui.page, pages - 1);
}

function record(state: AppState, key: string): Partial<AppState> {
  const coalesce = key !== "" && state.lastKey === key && now() - state.lastAt < 2200;
  return {
    past: coalesce ? state.past : [...state.past, state.doc].slice(-60),
    future: [],
    lastKey: key,
    lastAt: now(),
  };
}

function withDoc(state: AppState, doc: Doc, key: string, recordHistory = true): AppState {
  const base = recordHistory ? record(state, key) : {};
  const next = { ...state, ...base, doc: { ...doc, updatedAt: now() } };
  const validParts = new Set(next.doc.parts.map((p) => p.id));
  const validPlacements = new Set(next.doc.placements.map((p) => p.id));
  next.selection = {
    partIds: next.selection.partIds.filter((id) => validParts.has(id)),
    placementIds: next.selection.placementIds.filter((id) => validPlacements.has(id)),
  };
  next.ui = { ...next.ui, page: ensurePage(next) };
  return next;
}

function autoNestOrKeep(state: AppState, doc: Doc, key: string): AppState {
  if (doc.settings.autoNest) {
    const res = nestDoc(doc);
    const next = withDoc(state, res.doc, key);
    return { ...next, lastNest: res.nest };
  }
  return withDoc(state, doc, key);
}

export function createInitialDoc(): Doc {
  const parts = demoParts();
  const doc: Doc = {
    version: 1,
    name: "Primera plancha",
    parts,
    placements: [],
    sheet: { ...DEFAULT_SHEET },
    settings: { ...DEFAULT_SETTINGS },
    createdAt: now(),
    updatedAt: now(),
  };
  const res = nestDoc(doc);
  return res.doc;
}

export function createEmptyDoc(): Doc {
  return {
    version: 1,
    name: "Plancha nueva",
    parts: [],
    placements: [],
    groups: [],
    sheet: { ...DEFAULT_SHEET },
    settings: { ...DEFAULT_SETTINGS },
    createdAt: now(),
    updatedAt: now(),
  };
}

export function createInitialState(): AppState {
  const stored = loadStoredDoc();
  const doc = stored || createInitialDoc();
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const tabParam = params?.get("tab");
  const viewParam = params?.get("view");
  const tab = ["diseno", "plancha", "grabado", "material"].includes(tabParam || "")
    ? (tabParam as UiState["tab"])
    : "diseno";
  return {
    doc,
    selection: { partIds: [], placementIds: [] },
    past: [],
    future: [],
    lastKey: "",
    lastAt: 0,
    lastNest: stored
      ? null
      : {
          at: now(),
          unplaced: 0,
          efficiency: 0,
          pages: Math.max(1, ...doc.placements.map((p) => p.page + 1)),
          elapsedMs: 0,
        },
    ui: {
      page: 0,
      tab,
      view: viewParam === "wood" || viewParam === "wood3d" ? viewParam : "plan",
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

function placeNewParts(doc: Doc, parts: Part[]): Doc {
  const placements = [...doc.placements];
  let x = doc.sheet.margin;
  let y = doc.sheet.margin;
  let rowH = 0;
  for (const part of parts) {
    const g = effectiveGeometry(part);
    for (let c = 0; c < Math.max(0, part.copies); c++) {
      if (x + g.width > doc.sheet.width - doc.sheet.margin) {
        x = doc.sheet.margin;
        y += rowH + doc.sheet.spacing;
        rowH = 0;
      }
      placements.push({
        id: nextId("pl"),
        partId: part.id,
        page: 0,
        x,
        y,
        angle: 0,
        mirror: false,
        pinned: false,
      });
      x += g.width + doc.sheet.spacing;
      rowH = Math.max(rowH, g.height);
    }
  }
  return { ...doc, placements };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "ADD_PARTS": {
      if (!action.parts.length) return state;
      const incomingGroups = action.groups || [];
      const groupOf = new Map<string, Assembly>();
      for (const g of incomingGroups) for (const m of g.members) groupOf.set(m.partId, g);
      const parts = action.parts.map((p) => {
        const g = groupOf.get(p.id);
        return g ? { ...p, assemblyId: g.id, copies: 1 } : p;
      });
      // Como en CryCat: las figuras de ejemplo desaparecen al añadir material propio.
      const addingReal = action.parts.some((p) => p.source === "svg" || p.source === "image");
      const demoIds = addingReal
        ? new Set(state.doc.parts.filter((p) => p.source === "demo").map((p) => p.id))
        : new Set<string>();
      const baseParts = demoIds.size ? state.doc.parts.filter((p) => !demoIds.has(p.id)) : state.doc.parts;
      const basePlacements = demoIds.size ? state.doc.placements.filter((p) => !demoIds.has(p.partId)) : state.doc.placements;
      const baseGroups = demoIds.size
        ? getGroups(state.doc).filter((g) => !g.members.some((m) => demoIds.has(m.partId)))
        : getGroups(state.doc);
      let doc: Doc = {
        ...state.doc,
        parts: [...baseParts, ...parts],
        placements: basePlacements,
        groups: [...baseGroups, ...incomingGroups.map((g) => ({
          ...g,
          members: normalizeMembers(g.members, parts),
          copies: Math.max(1, g.copies || 1),
        }))],
      };
      if (action.nest === false && !incomingGroups.length) doc = placeNewParts(doc, parts);
      return autoNestOrKeep(state, doc, "add-parts");
    }
    case "ADD_SHAPE": {
      const doc = { ...state.doc, parts: [...state.doc.parts, action.shape] };
      return autoNestOrKeep(state, doc, "add-shape");
    }
    case "SET_ALL_OFFSET": {
      const value = Math.max(0, Math.min(20, Math.round(action.value * 2) / 2));
      const parts = state.doc.parts.map((p) => ({ ...p, offsetMm: value }));
      const doc = { ...state.doc, parts };
      return action.nest === false
        ? withDoc(state, doc, "all-offset")
        : autoNestOrKeep(state, doc, "all-offset");
    }
    case "UPDATE_PART": {
      const parts = state.doc.parts.map((p) => (p.id === action.id ? { ...p, ...action.patch } : p));
      const doc = { ...state.doc, parts };
      return action.nest
        ? autoNestOrKeep(state, doc, action.key || `part-${action.id}`)
        : withDoc(state, doc, action.key || `part-${action.id}`);
    }
    case "RESIZE_ASSEMBLY": {
      const group = getGroups(state.doc).find((g) => g.id === action.id);
      if (!group) return state;
      const members = new Set(group.members.map((m) => m.partId));
      const geo = assemblyGeometry(group, state.doc.parts);
      if (!geo.width || !geo.height) return state;
      const sx = Math.max(0.1, action.width) / geo.width;
      const sy = Math.max(0.1, action.height) / geo.height;
      const parts = state.doc.parts.map((p) => {
        if (!members.has(p.id)) return p;
        return {
          ...p,
          width: Math.max(0.1, p.width * sx),
          height: Math.max(0.1, p.height * sy),
          contours: p.contours.map((c) => c.map((pt) => ({ x: pt.x * sx, y: pt.y * sy }))),
          raster: p.raster
            ? {
                ...p.raster,
                dpi: p.raster.dpi / Math.max(0.01, (sx + sy) / 2),
                matrix: p.raster.matrix
                  ? ([
                      p.raster.matrix[0] * sx,
                      p.raster.matrix[1] * sx,
                      p.raster.matrix[2] * sy,
                      p.raster.matrix[3] * sy,
                      p.raster.matrix[4] * sx,
                      p.raster.matrix[5] * sy,
                    ] as [number, number, number, number, number, number])
                  : undefined,
              }
            : undefined,
        };
      });
      const groups = getGroups(state.doc).map((g) =>
        g.id === action.id
          ? { ...g, members: g.members.map((m) => ({ ...m, dx: m.dx * sx, dy: m.dy * sy })) }
          : g,
      );
      const doc = { ...state.doc, parts, groups };
      return action.nest === false ? withDoc(state, doc, `resize-group-${action.id}`) : autoNestOrKeep(state, doc, `resize-group-${action.id}`);
    }
    case "RESIZE_PART": {
      const parts = state.doc.parts.map((p) => {
        if (p.id !== action.id) return p;
        const sx = p.width > 0 ? Math.max(0.1, action.width) / p.width : 1;
        const sy = p.height > 0 ? Math.max(0.1, action.height) / p.height : 1;
        return {
          ...p,
          width: Math.max(0.1, action.width),
          height: Math.max(0.1, action.height),
          contours: p.contours.map((c) => c.map((pt) => ({ x: pt.x * sx, y: pt.y * sy }))),
          raster: p.raster
            ? {
                ...p.raster,
                matrix: p.raster.matrix
                  ? ([
                      p.raster.matrix[0] * sx,
                      p.raster.matrix[1] * sx,
                      p.raster.matrix[2] * sy,
                      p.raster.matrix[3] * sy,
                      p.raster.matrix[4] * sx,
                      p.raster.matrix[5] * sy,
                    ] as [number, number, number, number, number, number])
                  : undefined,
              }
            : undefined,
        };
      });
      return autoNestOrKeep(state, { ...state.doc, parts }, `resize-${action.id}`);
    }
    case "REMOVE_PARTS": {
      const ids = new Set(action.ids);
      const parts = state.doc.parts.filter((p) => !ids.has(p.id));
      const groups = getGroups(state.doc)
        .map((g) => {
          const members = g.members.filter((m) => !ids.has(m.partId));
          return { ...g, members };
        })
        .filter((g) => g.members.length >= 2);
      const validGroup = new Set(groups.map((g) => g.id));
      const cleanedParts = parts.map((p) =>
        p.assemblyId && !validGroup.has(p.assemblyId) ? { ...p, assemblyId: undefined } : p,
      );
      const placements = state.doc.placements
        .filter((p) => !ids.has(p.partId))
        .map((p) => (p.assemblyId && !validGroup.has(p.assemblyId) ? { ...p, assemblyId: undefined, pinned: false } : p));
      return autoNestOrKeep(state, { ...state.doc, parts: cleanedParts, placements, groups }, "remove-parts");
    }
    case "SET_COPIES": {
      const copies = Math.max(0, Math.min(999, Math.round(action.copies)));
      const part = state.doc.parts.find((p) => p.id === action.id);
      if (part?.assemblyId) {
        const groups = getGroups(state.doc).map((g) =>
          g.id === part.assemblyId ? { ...g, copies: Math.max(0, copies) } : g,
        );
        if (!state.doc.settings.autoNest) {
          return withDoc(state, { ...state.doc, groups }, `copies-${part.assemblyId}`);
        }
        const res = nestDoc({ ...state.doc, groups });
        const next = withDoc(state, res.doc, `copies-${part.assemblyId}`);
        return { ...next, lastNest: res.nest };
      }
      const parts = state.doc.parts.map((p) => (p.id === action.id ? { ...p, copies } : p));
      const doc = { ...state.doc, parts };
      if (!state.doc.settings.autoNest) return withDoc(state, doc, `copies-${action.id}`);
      const res = nestDoc(doc);
      const next = withDoc(state, res.doc, `copies-${action.id}`);
      return { ...next, lastNest: res.nest };
    }
    case "NEST": {
      const res = nestDoc(state.doc);
      const next = withDoc(state, res.doc, "nest");
      return { ...next, lastNest: res.nest };
    }
    case "MOVE_PLACEMENT": {
      const placements = state.doc.placements.map((p) =>
        p.id === action.id
          ? { ...p, x: Math.round(action.x * 100) / 100, y: Math.round(action.y * 100) / 100 }
          : p,
      );
      return withDoc(state, { ...state.doc, placements }, `move-${action.id}`);
    }
    case "SET_POSITIONS": {
      const map = new Map(action.positions.map((p) => [p.id, p]));
      const placements = state.doc.placements.map((p) => {
        const next = map.get(p.id);
        return next ? { ...p, x: Math.round(next.x * 100) / 100, y: Math.round(next.y * 100) / 100 } : p;
      });
      return withDoc(state, { ...state.doc, placements }, action.key || "move-selection");
    }
    case "SET_PLACEMENT": {
      const placements = state.doc.placements.map((p) =>
        p.id === action.id ? { ...p, ...action.patch } : p,
      );
      return withDoc(state, { ...state.doc, placements }, `set-${action.id}`);
    }
    case "ROTATE_PLACEMENT": {
      const placement = state.doc.placements.find((p) => p.id === action.id);
      if (!placement) return state;
      if (placement.assemblyId) {
        const groupPlacements = state.doc.placements.filter((p) => p.assemblyId === placement.assemblyId);
        const rotated = rotatePlacements(state.doc.parts, groupPlacements, action.delta);
        const map = new Map(rotated.map((p) => [p.id, p]));
        return withDoc(
          state,
          { ...state.doc, placements: state.doc.placements.map((p) => map.get(p.id) || p) },
          `rotate-${action.id}`,
        );
      }
      const placements = state.doc.placements.map((p) => {
        if (p.id !== action.id) return p;
        const part = state.doc.parts.find((x) => x.id === p.partId);
        if (!part) return p;
        const g = effectiveGeometry(part);
        const before = rotatedSize({ width: g.width, height: g.height }, p.angle);
        const after = rotatedSize({ width: g.width, height: g.height }, p.angle + action.delta);
        return {
          ...p,
          angle: (p.angle + action.delta + 360) % 360,
          x: Math.round((p.x + before.w / 2 - after.w / 2) * 100) / 100,
          y: Math.round((p.y + before.h / 2 - after.h / 2) * 100) / 100,
        };
      });
      return withDoc(state, { ...state.doc, placements }, `rotate-${action.id}`);
    }
    case "ROTATE_SELECTION": {
      const chosen = state.doc.placements.filter((p) => action.placementIds.includes(p.id));
      if (!chosen.length) return state;
      const rotated = rotatePlacements(state.doc.parts, chosen, action.delta);
      const map = new Map(rotated.map((p) => [p.id, p]));
      return withDoc(
        state,
        { ...state.doc, placements: state.doc.placements.map((p) => map.get(p.id) || p) },
        action.key || "rotate-selection",
      );
    }
    case "PIN_PLACEMENT": {
      const placement = state.doc.placements.find((p) => p.id === action.id);
      if (!placement) return state;
      const ids = placement.assemblyId
        ? new Set(state.doc.placements.filter((p) => p.assemblyId === placement.assemblyId).map((p) => p.id))
        : new Set([action.id]);
      const placements = state.doc.placements.map((p) =>
        ids.has(p.id) ? { ...p, pinned: action.pinned } : p,
      );
      return withDoc(state, { ...state.doc, placements }, `pin-${action.id}`);
    }
    case "DELETE_PLACEMENT": {
      const placement = state.doc.placements.find((p) => p.id === action.id);
      if (!placement) return state;
      if (placement.assemblyId) {
        const group = getGroups(state.doc).find((g) => g.id === placement.assemblyId);
        const placements = state.doc.placements.filter((p) => p.assemblyId !== placement.assemblyId);
        const groups = getGroups(state.doc).filter((g) => g.id !== placement.assemblyId);
        const parts = state.doc.parts.map((p) =>
          group?.members.some((m) => m.partId === p.id) ? { ...p, assemblyId: undefined, copies: 0 } : p,
        );
        return withDoc(state, { ...state.doc, placements, groups, parts }, `delete-group-${placement.assemblyId}`);
      }
      const placements = state.doc.placements.filter((p) => p.id !== action.id);
      const parts = state.doc.parts.map((p) =>
        p.id === placement.partId ? { ...p, copies: Math.max(0, p.copies - 1) } : p,
      );
      return withDoc(state, { ...state.doc, placements, parts }, `delete-${action.id}`);
    }
    case "DUPLICATE_PLACEMENT": {
      const placement = state.doc.placements.find((p) => p.id === action.id);
      if (!placement) return state;
      if (placement.assemblyId) {
        const groups = getGroups(state.doc).map((g) =>
          g.id === placement.assemblyId ? { ...g, copies: g.copies + 1 } : g,
        );
        const res = nestDoc({ ...state.doc, groups });
        const next = withDoc(state, res.doc, `duplicate-${placement.assemblyId}`);
        return { ...next, lastNest: res.nest };
      }
      const parts = state.doc.parts.map((p) =>
        p.id === placement.partId ? { ...p, copies: p.copies + 1 } : p,
      );
      const doc = {
        ...state.doc,
        parts,
        placements: [
          ...state.doc.placements,
          { ...placement, id: nextId("pl"), x: placement.x + 8, y: placement.y + 8, pinned: false },
        ],
      };
      return autoNestOrKeep(state, doc, "duplicate-placement");
    }
    case "DUPLICATE_PART": {
      const part = state.doc.parts.find((p) => p.id === action.id);
      if (!part) return state;
      if (part.assemblyId) {
        const group = getGroups(state.doc).find((g) => g.id === part.assemblyId);
        if (!group) return state;
        const idMap = new Map<string, string>();
        const copies: Part[] = [];
        for (const member of group.members) {
          const source = state.doc.parts.find((p) => p.id === member.partId);
          if (!source) continue;
          const nid = nextId("part");
          idMap.set(source.id, nid);
          copies.push({
            ...source,
            id: nid,
            name: `${source.name} copia`,
            copies: 1,
            assemblyId: undefined,
            contours: source.contours.map((c) => c.map((p) => ({ ...p }))),
          });
        }
        const ng: Assembly = {
          ...group,
          id: nextId("asm"),
          name: `${group.name} copia`,
          copies: 1,
          members: group.members
            .filter((m) => idMap.has(m.partId))
            .map((m) => ({ ...m, partId: idMap.get(m.partId)! })),
        };
        const doc = {
          ...state.doc,
          parts: [...state.doc.parts, ...copies.map((p) => ({ ...p, assemblyId: ng.id }))],
          groups: [...getGroups(state.doc), ng],
        };
        return autoNestOrKeep(state, doc, "duplicate-group");
      }
      const copy: Part = {
        ...part,
        id: nextId("part"),
        name: `${part.name} copia`,
        copies: 1,
        contours: part.contours.map((c) => c.map((p) => ({ ...p }))),
      };
      const doc = { ...state.doc, parts: [...state.doc.parts, copy] };
      return autoNestOrKeep(state, doc, "duplicate-part");
    }
    case "SET_ASSEMBLY_COPIES": {
      const groups = getGroups(state.doc).map((g) =>
        g.id === action.id ? { ...g, copies: Math.max(0, Math.min(999, Math.round(action.copies))) } : g,
      );
      if (!state.doc.settings.autoNest) return withDoc(state, { ...state.doc, groups }, `group-copies-${action.id}`);
      const res = nestDoc({ ...state.doc, groups });
      const next = withDoc(state, res.doc, `group-copies-${action.id}`);
      return { ...next, lastNest: res.nest };
    }
    case "RENAME_ASSEMBLY": {
      const groups = getGroups(state.doc).map((g) =>
        g.id === action.id ? { ...g, name: action.name.trim() || g.name } : g,
      );
      return withDoc(state, { ...state.doc, groups }, `group-name-${action.id}`);
    }
    case "ROTATE_ASSEMBLY": {
      const chosen = state.doc.placements.filter((p) => p.assemblyId === action.id);
      if (!chosen.length) return state;
      const rotated = rotatePlacements(state.doc.parts, chosen, action.delta);
      const map = new Map(rotated.map((p) => [p.id, p]));
      return withDoc(
        state,
        { ...state.doc, placements: state.doc.placements.map((p) => map.get(p.id) || p) },
        `group-rotate-${action.id}`,
      );
    }
    case "PIN_ASSEMBLY": {
      const placements = state.doc.placements.map((p) =>
        p.assemblyId === action.id ? { ...p, pinned: action.pinned } : p,
      );
      return withDoc(state, { ...state.doc, placements }, `group-pin-${action.id}`);
    }
    case "UNGROUP": {
      const group = getGroups(state.doc).find((g) => g.id === action.id);
      if (!group) return state;
      const memberIds = new Set(group.members.map((m) => m.partId));
      const counts = new Map<string, number>();
      for (const p of state.doc.placements) {
        if (memberIds.has(p.partId)) counts.set(p.partId, (counts.get(p.partId) || 0) + 1);
      }
      const parts = state.doc.parts.map((p) =>
        memberIds.has(p.id)
          ? { ...p, assemblyId: undefined, copies: Math.max(1, counts.get(p.id) || 1) }
          : p,
      );
      const placements = state.doc.placements.map((p) =>
        p.assemblyId === action.id ? { ...p, assemblyId: undefined } : p,
      );
      const groups = getGroups(state.doc).filter((g) => g.id !== action.id);
      return withDoc(state, { ...state.doc, parts, placements, groups }, `ungroup-${action.id}`);
    }
    case "GROUP_PLACEMENTS": {
      const chosen = state.doc.placements.filter((p) => action.placementIds.includes(p.id));
      const partIds = Array.from(new Set(chosen.map((p) => p.partId)));
      if (partIds.length < 2) return state;
      // Solo se agrupan piezas que tengan una única colocación.
      const usable = partIds.filter((id) => state.doc.placements.filter((p) => p.partId === id).length === 1);
      if (usable.length < 2) {
        return { ...state, ui: { ...state.ui, toast: { text: "Para agrupar, cada pieza debe tener una sola copia colocada.", kind: "warn" } } };
      }
      const selected = chosen.filter((p) => usable.includes(p.partId));
      const { group } = assemblyFromPlacements(
        state.doc.parts.filter((p) => usable.includes(p.id)),
        selected,
        action.name || "Grupo",
      );
      const minX = Math.min(...selected.map((p) => p.x));
      const minY = Math.min(...selected.map((p) => p.y));
      group.members = selected.map((p) => ({ partId: p.partId, dx: p.x - minX, dy: p.y - minY }));
      const parts = state.doc.parts.map((p) =>
        usable.includes(p.id) ? { ...p, assemblyId: group.id, copies: 1 } : p,
      );
      const placements = state.doc.placements.map((p) =>
        usable.includes(p.partId) && selected.some((s) => s.id === p.id)
          ? { ...p, assemblyId: group.id }
          : p,
      );
      // Eliminar grupos anteriores de esas piezas.
      const groups = getGroups(state.doc)
        .map((g) => ({ ...g, members: g.members.filter((m) => !usable.includes(m.partId)) }))
        .filter((g) => g.members.length >= 2);
      groups.push(group);
      return withDoc(state, { ...state.doc, parts, placements, groups }, "group-placements");
    }
    case "CLEAR": {
      const doc = {
        ...state.doc,
        parts: [],
        placements: [],
        groups: [],
        name: state.doc.name,
        updatedAt: now(),
      };
      return withDoc(state, doc, "clear");
    }
    case "RENAME": {
      return withDoc(state, { ...state.doc, name: action.name }, "rename");
    }
    case "LOAD_PROJECT": {
      const clean = normalizeDoc(action.doc);
      if (!clean) {
        return { ...state, ui: { ...state.ui, toast: { text: "El proyecto no es válido.", kind: "error" } } };
      }
      const res = clean.placements.length ? null : nestDoc(clean);
      return {
        ...state,
        doc: res ? res.doc : clean,
        past: [],
        future: [],
        lastKey: "",
        lastAt: 0,
        lastNest: res ? res.nest : null,
        selection: { partIds: [], placementIds: [] },
        ui: { ...state.ui, page: 0, toast: { text: "Proyecto cargado.", kind: "ok" } },
      };
    }
    case "SELECT": {
      return {
        ...state,
        selection: {
          partIds: action.partIds ?? [],
          placementIds: action.placementIds ?? [],
        },
      };
    }
    case "UNDO": {
      if (!state.past.length) return state;
      const previous = state.past[state.past.length - 1];
      return {
        ...state,
        doc: previous,
        past: state.past.slice(0, -1),
        future: [state.doc, ...state.future].slice(0, 60),
        lastKey: "",
        lastAt: 0,
      };
    }
    case "REDO": {
      if (!state.future.length) return state;
      const next = state.future[0];
      return {
        ...state,
        doc: next,
        past: [...state.past, state.doc].slice(-60),
        future: state.future.slice(1),
        lastKey: "",
        lastAt: 0,
      };
    }
    case "SET_SHEET": {
      const sheet = { ...state.doc.sheet, ...action.patch };
      const doc = { ...state.doc, sheet };
      if (action.nest === false) return withDoc(state, doc, "sheet");
      return autoNestOrKeep(state, doc, "sheet");
    }
    case "SET_SETTINGS": {
      const settings = { ...state.doc.settings, ...action.patch };
      return withDoc(state, { ...state.doc, settings }, "settings");
    }
    case "SET_UI":
      return { ...state, ui: { ...state.ui, ...action.patch } };
    case "SET_PAGE":
      return { ...state, ui: { ...state.ui, page: Math.max(0, action.page) } };
    case "TOAST":
      return { ...state, ui: { ...state.ui, toast: { text: action.text, kind: action.kind || "ok" } } };
    case "DISMISS_TOAST":
      return { ...state, ui: { ...state.ui, toast: null } };
    default:
      return state;
  }
}

// ---------------------------------------------------------- persistencia --

export function saveStoredDoc(doc: Doc): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    return true;
  } catch {
    return false;
  }
}

export function loadStoredDoc(): Doc | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const clean = normalizeDoc(parsed);
    if (clean && !parsed?.sheet?.method && parsed?.sheet?.rotation === "90" && (parsed?.sheet?.packMode ?? "shape") === "shape") {
      clean.sheet.rotation = "libre";
    }
    return clean;
  } catch {
    return null;
  }
}

const OPS = new Set(["cut", "engrave", "score"]);

/** Valida y repara un proyecto venido de JSON o localStorage. */
export function normalizeDoc(input: any): Doc | null {
  if (!input || typeof input !== "object") return null;
  if (!Array.isArray(input.parts) || !input.sheet) return null;
  const parts: Part[] = [];
  for (const raw of input.parts.slice(0, 500)) {
    if (!raw || typeof raw !== "object") continue;
    const contours = Array.isArray(raw.contours)
      ? raw.contours
          .filter((c: any) => Array.isArray(c) && c.length >= 3)
          .map((c: any[]) =>
            c
              .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
              .map((p) => ({ x: Number(p.x), y: Number(p.y) })),
          )
          .filter((c: any[]) => c.length >= 3)
      : [];
    if (!contours.length && raw.kind !== "raster") continue;
    const operation = OPS.has(raw.operation) ? raw.operation : "cut";
    parts.push({
      id: String(raw.id || nextId("part")),
      name: String(raw.name || "Pieza"),
      kind: raw.kind === "raster" ? "raster" : "vector",
      contours,
      width: Number(raw.width) > 0 ? Number(raw.width) : 10,
      height: Number(raw.height) > 0 ? Number(raw.height) : 10,
      operation,
      offsetMm: Math.max(0, Math.min(50, Number(raw.offsetMm) || 0)),
      separateBorder: Boolean(raw.separateBorder),
      copies: Math.max(0, Math.min(999, Math.round(Number(raw.copies) || 1))),
      source: ["svg", "image", "demo"].includes(raw.source) ? raw.source : "svg",
      raster: raw.raster && typeof raw.raster.dataUrl === "string" ? raw.raster : undefined,
      color: typeof raw.color === "string" ? raw.color : undefined,
      groupId: typeof raw.groupId === "string" ? raw.groupId : undefined,
      assemblyId: typeof raw.assemblyId === "string" ? raw.assemblyId : undefined,
      notes: typeof raw.notes === "string" ? raw.notes : undefined,
      lockedSize: Boolean(raw.lockedSize),
    });
  }
  if (!parts.length && input.parts.length > 0) return null;
  const ids = new Set(parts.map((p) => p.id));
  const placements: Placement[] = Array.isArray(input.placements)
    ? input.placements
        .slice(0, 3000)
        .filter((p: any) => p && ids.has(String(p.partId)))
        .map((p: any, i: number) => ({
          id: String(p.id || `pl-${i}`),
          partId: String(p.partId),
          page: Math.max(0, Math.round(Number(p.page) || 0)),
          x: Number.isFinite(Number(p.x)) ? Number(p.x) : 0,
          y: Number.isFinite(Number(p.y)) ? Number(p.y) : 0,
          angle: Number.isFinite(Number(p.angle)) ? Number(p.angle) : 0,
          mirror: Boolean(p.mirror),
          pinned: Boolean(p.pinned),
          assemblyId: typeof p.assemblyId === "string" ? p.assemblyId : undefined,
        }))
    : [];
  const sheet: Sheet = {
    width: Math.max(20, Math.min(2000, Number(input.sheet.width) || 300)),
    height: Math.max(20, Math.min(2000, Number(input.sheet.height) || 300)),
    margin: Math.max(0, Math.min(100, Number(input.sheet.margin) || 0)),
    spacing: Math.max(0, Math.min(100, Number(input.sheet.spacing) || 0)),
    kerf: Math.max(0, Math.min(3, Number(input.sheet.kerf) || 0)),
    rotation: ["no", "90", "libre"].includes(input.sheet.rotation) ? input.sheet.rotation : "libre",
    quality: ["rapida", "equilibrada", "maxima"].includes(input.sheet.quality)
      ? input.sheet.quality
      : "equilibrada",
    method: ["auto", "greedy", "largest", "voronoi", "genetic"].includes(input.sheet.method)
      ? input.sheet.method
      : "auto",
    packMode: ["shape", "box"].includes(input.sheet.packMode) ? input.sheet.packMode : "shape",
    singlePage: Boolean(input.sheet.singlePage),
  };
  const rs = input.settings || {};
  const settings: DocSettings = {
    ...DEFAULT_SETTINGS,
    ...(typeof rs === "object" ? rs : {}),
    machineId: String(rs.machineId || DEFAULT_SETTINGS.machineId),
    materialId: String(rs.materialId || DEFAULT_SETTINGS.materialId),
  };
  const rawGroups = Array.isArray(input.groups) ? input.groups.slice(0, 200) : [];
  const usedParts = new Set<string>();
  const groups: Assembly[] = [];
  for (const raw of rawGroups) {
    if (!raw || !Array.isArray(raw.members)) continue;
    const members = raw.members
      .filter((m: any) => m && ids.has(String(m.partId)) && !usedParts.has(String(m.partId)))
      .map((m: any) => ({ partId: String(m.partId), dx: Number(m.dx) || 0, dy: Number(m.dy) || 0 }));
    if (members.length < 2) continue;
    for (const m of members) usedParts.add(m.partId);
    groups.push({
      id: String(raw.id || `asm-${groups.length}`),
      name: String(raw.name || `Grupo ${groups.length + 1}`),
      members,
      copies: Math.max(1, Math.min(999, Math.round(Number(raw.copies) || 1))),
      color: typeof raw.color === "string" ? raw.color : undefined,
    });
  }
  const groupIds = new Set(groups.map((g) => g.id));
  const partGroup = new Map<string, string>();
  for (const g of groups) for (const m of g.members) partGroup.set(m.partId, g.id);
  for (const p of parts) {
    const gid = partGroup.get(p.id) || (p.assemblyId && groupIds.has(p.assemblyId) ? p.assemblyId : undefined);
    if (gid) {
      p.assemblyId = gid;
      p.copies = 1;
    } else {
      p.assemblyId = undefined;
    }
  }
  for (const pl of placements) {
    if (pl.assemblyId && !groupIds.has(pl.assemblyId)) pl.assemblyId = undefined;
  }
  return {
    version: 1,
    name: String(input.name || "Proyecto"),
    parts,
    placements,
    groups,
    sheet,
    settings,
    createdAt: Number(input.createdAt) || now(),
    updatedAt: Number(input.updatedAt) || now(),
  };
}

export function cloneSelectionState(): SelectionState {
  return { partIds: [], placementIds: [] };
}

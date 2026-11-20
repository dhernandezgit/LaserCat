import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch } from "react";
import type { Assembly, Operation, Part } from "../types";
import type { Action } from "../lib/store";
import {
  closestPairs,
  groupPreviewSvg,
  importSvg,
  mergeImported,
  partPreviewSvg,
  splitImported,
  type ImportedPart,
  type SvgImportResult,
} from "../lib/svgImport";
import { trimSvgImages } from "../lib/svgImageTrim";
import { pickFiles, readFileText } from "../lib/download";
import { uid } from "../lib/demo";
import { contoursBounds, boundsOf, fmt } from "../lib/geom";
import { Badge, Button, Callout, Icon, Modal, NumberField, Segmented, Slider, Stepper, Toggle } from "./UI";

interface EditablePart extends ImportedPart {
  include: boolean;
  operation: Operation;
  offsetMm: number;
  copies: number;
}

interface EditableGroup {
  id: string;
  name: string;
  memberIds: string[];
  include: boolean;
  copies: number;
  color?: string;
}

interface Options {
  mode: "inteligente" | "grupos" | "formas" | "todo";
  tolerance: number;
  scaleMode: "natural" | "width" | "height";
  scaleValue: number;
  simplify: boolean;
  defaultOperation: Operation;
  defaultOffset: number;
  defaultCopies: number;
  whiteAsHoles: boolean;
}

const DEFAULT_OPTIONS: Options = {
  mode: "inteligente",
  tolerance: 1,
  scaleMode: "natural",
  scaleValue: 100,
  simplify: true,
  defaultOperation: "cut",
  defaultOffset: 0,
  defaultCopies: 1,
  whiteAsHoles: true,
};

export function SvgImportDialog({
  open,
  initialFile,
  dispatch,
  onClose,
}: {
  open: boolean;
  initialFile: File | null;
  dispatch: Dispatch<Action>;
  onClose: () => void;
}) {
  const [fileName, setFileName] = useState("");
  const [svgText, setSvgText] = useState("");
  const [options, setOptions] = useState<Options>(DEFAULT_OPTIONS);
  const [result, setResult] = useState<SvgImportResult | null>(null);
  const [editable, setEditable] = useState<EditablePart[]>([]);
  const [importGroups, setImportGroups] = useState<EditableGroup[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [pasteMode, setPasteMode] = useState(false);
  const [pasted, setPasted] = useState("");
  const [view, setView] = useState<"grupos" | "piezas" | "mapa" | "parejas">("piezas");
  const [showWarnings, setShowWarnings] = useState(false);
  const fileLoaded = useRef<string>("");

  const loadFile = async (file: File) => {
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error("El SVG supera los 8 MB.");
      const text = await readFileText(file);
      setFileName(file.name);
      setSvgText(text);
      setPasteMode(false);
      setError("");
      setResult(null);
      setEditable([]);
      setImportGroups([]);
      setSelected(new Set());
      fileLoaded.current = file.name + file.size;
    } catch (e: any) {
      setError(e?.message || "No se pudo leer el archivo.");
    }
  };

  useEffect(() => {
    if (!open) return;
    if (initialFile && fileLoaded.current !== initialFile.name + initialFile.size) {
      void loadFile(initialFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFile]);

  useEffect(() => {
    if (!open) {
      fileLoaded.current = "";
    }
  }, [open]);

  // Reimportar al cambiar las opciones (con un pequeño retardo).
  useEffect(() => {
    if (!open || !svgText) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        let prepared = svgText;
        try {
          prepared = await trimSvgImages(svgText);
        } catch {
          /* si el navegador no puede decodificar, se importa el SVG original */
        }
        if (cancelled) return;
        const res = importSvg(prepared, {
          tolerance: options.tolerance,
          mode: options.mode,
          targetWidth: options.scaleMode === "width" ? Math.max(1, options.scaleValue) : undefined,
          targetHeight: options.scaleMode === "height" ? Math.max(1, options.scaleValue) : undefined,
          strokeMode: "cut",
          simplify: options.simplify ? 0.02 : 0,
          whiteAsHoles: options.whiteAsHoles,
        });
        setResult(res);
        const next: EditablePart[] = res.parts.map((p) => ({
          ...p,
          include: true,
          operation: p.operation || options.defaultOperation,
          offsetMm: options.defaultOffset,
          copies: options.defaultCopies,
        }));
        setEditable((prev) => {
          // conservar ajustes si el número de piezas no cambia y ya había una edición
          if (prev.length === next.length && prev.length > 0) {
            return next.map((n, i) => ({
              ...n,
              name: prev[i]?.name || n.name,
              operation: n.kind === "raster" ? "engrave" : prev[i]?.operation || n.operation,
              offsetMm: prev[i]?.offsetMm ?? n.offsetMm,
              copies: prev[i]?.copies ?? n.copies,
              include: prev[i]?.include ?? true,
            }));
          }
          return next;
        });
        const nextGroups: EditableGroup[] = res.groups.map((g) => ({
          id: g.id,
          name: g.name,
          memberIds: g.memberIds,
          include: true,
          copies: 1,
          color: g.color,
        }));
        setImportGroups((prev) => {
          if (
            prev.length === nextGroups.length &&
            prev.every((g, i) => g.id === nextGroups[i].id && g.memberIds.join("|") === nextGroups[i].memberIds.join("|"))
          ) {
            return prev;
          }
          return nextGroups;
        });
        if (res.groups.length) setView((v) => (v === "piezas" ? "grupos" : v));
        setSelected(new Set());
        setError("");
      } catch (e: any) {
        setError(e?.message || "No se pudo interpretar el SVG.");
        setResult(null);
        setEditable([]);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, svgText, options]);

  const included = editable.filter((p) => p.include);
  const totalCopies = included.reduce((s, p) => s + p.copies, 0);
  const pairs = useMemo(() => closestPairs(editable, Math.max(20, options.tolerance * 4)), [editable, options.tolerance]);
  const mapBounds = useMemo(() => {
    const pts: { x: number; y: number }[] = [];
    for (const p of editable) {
      pts.push(
        { x: p.sourceBounds.x, y: p.sourceBounds.y },
        { x: p.sourceBounds.x + p.sourceBounds.w, y: p.sourceBounds.y },
        { x: p.sourceBounds.x + p.sourceBounds.w, y: p.sourceBounds.y + p.sourceBounds.h },
        { x: p.sourceBounds.x, y: p.sourceBounds.y + p.sourceBounds.h },
      );
      for (const c of p.sourceContours) pts.push(...c);
    }
    return boundsOf(pts);
  }, [editable]);

  const updateGroupsAfterMerge = (oldIds: string[], newId: string) => {
    setImportGroups((prev) =>
      prev
        .map((g) => {
          const hit = g.memberIds.some((id) => oldIds.includes(id));
          const members = g.memberIds.filter((id) => !oldIds.includes(id));
          if (hit) members.push(newId);
          return { ...g, memberIds: members };
        })
        .filter((g) => g.memberIds.length > 0),
    );
  };

  const mergeSelected = () => {
    if (selected.size < 2) return;
    const indices = Array.from(selected);
    if (indices.some((i) => editable[i]?.kind === "raster")) return;
    const merged = mergeImported(editable, indices);
    const at = Math.min(...indices);
    const base = editable[at];
    const next: EditablePart[] = [...editable];
    const set = new Set(indices);
    const filtered = next.filter((_, i) => !set.has(i));
    filtered.splice(Math.min(at, filtered.length), 0, {
      ...merged,
      include: true,
      operation: base.operation,
      offsetMm: base.offsetMm,
      copies: base.copies,
      name: merged.name,
    });
    setEditable(filtered);
    updateGroupsAfterMerge(indices.map((i) => editable[i].id), merged.id);
    setSelected(new Set());
  };

  const mergePair = (a: number, b: number) => {
    if (editable[a]?.kind === "raster" || editable[b]?.kind === "raster") return;
    const merged = mergeImported(editable, [a, b]);
    const at = Math.min(a, b);
    const base = editable[at];
    const filtered = editable.filter((_, i) => i !== a && i !== b);
    filtered.splice(Math.min(at, filtered.length), 0, {
      ...merged,
      include: true,
      operation: base.operation,
      offsetMm: base.offsetMm,
      copies: base.copies,
      name: merged.name,
    });
    setEditable(filtered);
    updateGroupsAfterMerge([editable[a].id, editable[b].id], merged.id);
    setSelected(new Set());
  };

  const splitOne = (index: number) => {
    if (!result) return;
    const part = editable[index];
    if (part.kind === "raster") return;
    const pieces = splitImported(part, result.islands);
    if (pieces.length < 2) return;
    const next = [...editable];
    next.splice(index, 1, ...pieces.map((p) => ({
      ...p,
      include: part.include,
      operation: part.operation,
      offsetMm: part.offsetMm,
      copies: part.copies,
    })));
    setEditable(next);
    const newIds = pieces.map((p) => p.id);
    setImportGroups((prev) =>
      prev
        .map((g) => {
          if (!g.memberIds.includes(part.id)) return g;
          return {
            ...g,
            memberIds: [...g.memberIds.filter((id) => id !== part.id), ...newIds],
          };
        })
        .filter((g) => g.memberIds.length > 0),
    );
  };

  const groupSelected = () => {
    const ids = Array.from(selected).map((i) => editable[i]?.id).filter(Boolean);
    if (ids.length < 2) return;
    setImportGroups((prev) => {
      const cleaned = prev
        .map((g) => ({ ...g, memberIds: g.memberIds.filter((id) => !ids.includes(id)) }))
        .filter((g) => g.memberIds.length > 0);
      return [
        ...cleaned,
        {
          id: uid("grp"),
          name: `Grupo ${cleaned.length + 1}`,
          memberIds: ids,
          include: true,
          copies: 1,
        },
      ];
    });
    setSelected(new Set());
  };

  const removeGroup = (id: string) => {
    setImportGroups((prev) => prev.filter((g) => g.id !== id));
  };

  const removeFromGroup = (groupId: string, partId: string) => {
    setImportGroups((prev) =>
      prev
        .map((g) => (g.id === groupId ? { ...g, memberIds: g.memberIds.filter((id) => id !== partId) } : g))
        .filter((g) => g.memberIds.length > 0),
    );
  };

  const toggleGroupInclude = (groupId: string, include: boolean) => {
    setImportGroups((prev) => {
      const group = prev.find((g) => g.id === groupId);
      if (group) {
        setEditable((parts) =>
          parts.map((p) => (group.memberIds.includes(p.id) ? { ...p, include } : p)),
        );
      }
      return prev.map((g) => (g.id === groupId ? { ...g, include } : g));
    });
  };

  const confirm = (nest: boolean) => {
    if (!included.length) return;
    const newId = new Map<string, string>();
    const parts: Part[] = included.map((p) => {
      const id = uid("part");
      newId.set(p.id, id);
      if (p.kind === "raster") {
        return {
          id,
          name: p.name || "Imagen SVG",
          kind: "raster",
          contours: [],
          width: p.width,
          height: p.height,
          operation: "engrave",
          offsetMm: 0,
          separateBorder: false,
          copies: 1,
          source: "svg",
          color: p.color,
          raster: p.raster,
          groupId: p.groupLabel,
        };
      }
      return {
        id,
        name: p.name || "Pieza SVG",
        kind: "vector",
        contours: p.contours,
        width: p.width,
        height: p.height,
        operation: p.operation,
        offsetMm: Math.max(0, p.offsetMm),
        separateBorder: false,
        copies: Math.max(0, Math.round(p.copies)),
        source: "svg",
        color: p.color,
        groupId: p.groupLabel,
      };
    });

    const scale = result?.scale || 1;
    const assemblies: Assembly[] = [];
    for (const g of importGroups) {
      if (!g.include) continue;
      const memberParts = g.memberIds
        .map((id) => editable.find((p) => p.id === id))
        .filter((p): p is EditablePart => Boolean(p && p.include && newId.has(p.id)));
      if (memberParts.length < 2) continue;
      const xs = memberParts.map((p) => p.sourceBounds.x * scale);
      const ys = memberParts.map((p) => p.sourceBounds.y * scale);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const members = memberParts.map((p, i) => ({
        partId: newId.get(p.id)!,
        dx: Math.round((xs[i] - minX) * 1000) / 1000,
        dy: Math.round((ys[i] - minY) * 1000) / 1000,
      }));
      assemblies.push({
        id: uid("asm"),
        name: g.name || "Grupo",
        members,
        copies: Math.max(1, Math.round(g.copies || 1)),
        color: g.color,
      });
    }

    dispatch({ type: "ADD_PARTS", parts, groups: assemblies, nest });
    dispatch({
      type: "TOAST",
      text: `${parts.length} pieza${parts.length === 1 ? "" : "s"} importada${parts.length === 1 ? "" : "s"}${assemblies.length ? ` en ${assemblies.length} grupo${assemblies.length === 1 ? "" : "s"}` : ""}${nest ? " y colocada" : ""}.`,
      kind: "ok",
    });
    reset();
    onClose();
  };

  const reset = () => {
    setFileName("");
    setSvgText("");
    setResult(null);
    setEditable([]);
    setImportGroups([]);
    setSelected(new Set());
    setError("");
    setPasteMode(false);
    setPasted("");
    setOptions(DEFAULT_OPTIONS);
    setView("piezas");
    setShowWarnings(false);
  };

  const setAll = (patch: Partial<EditablePart>) => {
    setEditable((prev) =>
      prev.map((p) => (p.kind === "raster" && patch.operation ? p : { ...p, ...patch })),
    );
  };

  const mapPairs = useMemo(() => pairs.slice(0, 40), [pairs]);
  const gapFor = (i: number) => {
    const b = editable[i]?.sourceBounds;
    if (!b) return "";
    return `${fmt(b.w)}×${fmt(b.h)} mm`;
  };

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title={svgText ? "Revisar piezas del SVG" : "Importar SVG"}
      subtitle={svgText ? fileName || "SVG pegado" : "LaserCat separa grupos, huecos y piezas automáticamente."}
      width="1180px"
      className="svg-modal"
      footer={
        <>
          <div className="footer-info">
            {result && (
              <>
                <Badge kind="neutral">{included.length} de {editable.length} piezas</Badge>
                {importGroups.length > 0 && <Badge kind="ok">{importGroups.filter((g) => g.include).length} grupos</Badge>}
                <Badge kind="neutral">{totalCopies} copias</Badge>
                {result && <span className="muted-text">{fmt(result.widthMm)} × {fmt(result.heightMm)} mm</span>}
              </>
            )}
          </div>
          <div className="footer-buttons">
            <Button variant="ghost" onClick={() => { reset(); onClose(); }}>Cancelar</Button>
            {editable.length > 0 && (
              <>
                <Button variant="secondary" icon="move" onClick={() => confirm(false)} disabled={!included.length}>
                  Añadir sin mover
                </Button>
                <Button variant="primary" icon="sparkles" onClick={() => confirm(true)} disabled={!included.length}>
                  Añadir y colocar
                </Button>
              </>
            )}
          </div>
        </>
      }
    >
      {!svgText ? (
        <div className="svg-choose">
          <div
            className="svg-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void loadFile(f);
            }}
            onClick={async () => {
              const [f] = await pickFiles(".svg,image/svg+xml");
              if (f) void loadFile(f);
            }}
          >
            <div className="drop-icon"><Icon name="layers" size={34} /></div>
            <b>Arrastra tu SVG aquí</b>
            <span>o haz clic para elegirlo</span>
            <em>Se conservan grupos, huecos y trazados. Todo en local.</em>
          </div>
          <button type="button" className="link-btn" onClick={() => setPasteMode(!pasteMode)}>
            {pasteMode ? "Ocultar pegado de texto" : "Pegar el código SVG"}
          </button>
          {pasteMode && (
            <div className="paste-box">
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">…</svg>'
                spellCheck={false}
              />
              <Button
                variant="secondary"
                icon="check"
                onClick={() => {
                  if (!pasted.trim()) return;
                  setFileName("SVG pegado");
                  setSvgText(pasted);
                  setError("");
                }}
              >
                Analizar SVG
              </Button>
            </div>
          )}
          {error && <Callout kind="warn">{error}</Callout>}
          <div className="choose-tips">
            <div><b>Grupos</b><span>Detecta si el SVG viene agrupado y respeta sus capas.</span></div>
            <div><b>Huecos</b><span>Los agujeros se mantienen dentro de cada pieza, no como piezas sueltas.</span></div>
            <div><b>Unidades</b><span>mm, cm, pulgadas y viewBox se convierten a tamaño real.</span></div>
          </div>
        </div>
      ) : (
        <div className="svg-review">
          <div className="review-top">
            <div className="file-chip">
              <Icon name="file" size={16} />
              <b>{fileName || "SVG pegado"}</b>
              <span>{result ? `${result.elementCount} formas · ${result.islands.length} islas · ${result.groupCount} grupos` : "…"}</span>
            </div>
            <div className="top-actions">
              <Button size="sm" variant="ghost" icon="upload" onClick={async () => {
                const [f] = await pickFiles(".svg,image/svg+xml");
                if (f) void loadFile(f);
              }}>Cambiar</Button>
              <button type="button" className="link-btn" onClick={() => { reset(); }}>Empezar de cero</button>
            </div>
          </div>

          <div className="review-layout">
            <aside className="review-options">
              <h3>Escala</h3>
              <Segmented
                compact
                value={options.scaleMode}
                onChange={(v) => setOptions((o) => ({ ...o, scaleMode: v, scaleValue: v === "natural" ? o.scaleValue : (result ? (v === "width" ? Math.round(result.widthMm) : Math.round(result.heightMm)) : 100) }))}
                options={[
                  { value: "natural", label: "Real" },
                  { value: "width", label: "Ancho" },
                  { value: "height", label: "Alto" },
                ]}
              />
              {options.scaleMode !== "natural" && (
                <NumberField
                  value={options.scaleValue}
                  min={1}
                  max={2000}
                  step={1}
                  suffix="mm"
                  onChange={(v) => setOptions((o) => ({ ...o, scaleValue: v }))}
                />
              )}
              <div className="option-note">
                {result ? <>Tamaño final: <b>{fmt(result.widthMm)} × {fmt(result.heightMm)} mm</b> · {result.units}</> : "Calculando…"}
              </div>

              <h3>Separación de piezas</h3>
              <Segmented
                compact
                value={options.mode}
                onChange={(v) => setOptions((o) => ({ ...o, mode: v }))}
                options={[
                  { value: "inteligente", label: "Auto" },
                  { value: "grupos", label: "Grupos" },
                  { value: "formas", label: "Formas" },
                  { value: "todo", label: "Todo" },
                ]}
              />
              <Slider
                label="Cercanía"
                min={0}
                max={8}
                step={0.5}
                value={options.tolerance}
                onChange={(v) => setOptions((o) => ({ ...o, tolerance: v }))}
                format={(v) => `${v} mm`}
              />
              <p className="option-help">
                Islas a menos de esta distancia se consideran la misma pieza. Baja el valor para separar detalles; súbelo para unir iconos.
              </p>

              <h3>Al añadir</h3>
              <div className="two-col">
                <label className="mini-field">
                  <span>Operación</span>
                  <select
                    className="select"
                    value={options.defaultOperation}
                    onChange={(e) => {
                      const op = e.target.value as Operation;
                      setOptions((o) => ({ ...o, defaultOperation: op }));
                      setAll({ operation: op });
                    }}
                  >
                    <option value="cut">Cortar</option>
                    <option value="engrave">Grabar</option>
                    <option value="score">Marcar</option>
                  </select>
                </label>
                <label className="mini-field">
                  <span>Borde</span>
                  <NumberField
                    value={options.defaultOffset}
                    min={0}
                    max={20}
                    step={0.5}
                    suffix="mm"
                    onChange={(v) => {
                      setOptions((o) => ({ ...o, defaultOffset: v }));
                      setAll({ offsetMm: v });
                    }}
                  />
                </label>
              </div>
              <Toggle checked={options.simplify} onChange={(v) => setOptions((o) => ({ ...o, simplify: v }))} label="Simplificar curvas" hint="0,02 mm: reduce nodos sin perder detalle." />
              <Toggle checked={options.whiteAsHoles} onChange={(v) => setOptions((o) => ({ ...o, whiteAsHoles: v }))} label="Blancos como huecos" hint="Los rellenos blancos interiores se recortan." />

              {result?.warnings.length ? (
                <button type="button" className="warn-toggle" onClick={() => setShowWarnings(!showWarnings)}>
                  <Icon name="alert" size={15} /> {result.warnings.length} aviso(s)
                </button>
              ) : null}
              {showWarnings && result && (
                <div className="warn-list small">
                  {result.warnings.map((w, i) => <div key={i}><Icon name="alert" size={13} /> {w}</div>)}
                </div>
              )}
            </aside>

            <section className="review-main">
              <div className="view-tabs">
                <button type="button" className={view === "grupos" ? "active" : ""} onClick={() => setView("grupos")}>
                  <Icon name="shapes" size={15} /> Grupos ({importGroups.length})
                </button>
                <button type="button" className={view === "piezas" ? "active" : ""} onClick={() => setView("piezas")}>
                  <Icon name="layers" size={15} /> Piezas ({editable.length})
                </button>
                <button type="button" className={view === "mapa" ? "active" : ""} onClick={() => setView("mapa")}>
                  <Icon name="target" size={15} /> Mapa
                </button>
                <button type="button" className={view === "parejas" ? "active" : ""} onClick={() => setView("parejas")}>
                  <Icon name="magnet" size={15} /> Parejas ({pairs.length})
                </button>
              </div>

              {view === "grupos" && (
                <div className="import-groups">
                  <p className="map-help">
                    Cada figura es un grupo: se mueve, gira y se anida como una unidad, con su imagen de grabado
                    y sus piezas de corte. Puedes renombrarla, cambiar copias o separarla.
                  </p>
                  {importGroups.map((g) => {
                    const members = g.memberIds
                      .map((id) => editable.find((p) => p.id === id))
                      .filter((p): p is EditablePart => Boolean(p));
                    if (!members.length) return null;
                    return (
                      <div className={`import-group-card ${g.include ? "" : "off"}`} key={g.id}>
                        <div className="group-head">
                          <div className="group-preview" dangerouslySetInnerHTML={{ __html: groupPreviewSvg(members, 96) }} />
                          <div className="group-title">
                            <input
                              className="inline-name"
                              value={g.name}
                              onChange={(e) =>
                                setImportGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)))
                              }
                              aria-label="Nombre del grupo"
                            />
                            <span>
                              {members.length} pieza{members.length === 1 ? "" : "s"} ·{" "}
                              {members.filter((p) => p.kind === "raster").length} imagen(es)
                            </span>
                          </div>
                          <div className="group-copies">
                            <span>Copias</span>
                            <Stepper
                              value={g.copies}
                              min={1}
                              max={99}
                              onChange={(v) =>
                                setImportGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, copies: v } : x)))
                              }
                            />
                          </div>
                          <label className="include-check" title={g.include ? "Incluir figura" : "No incluir figura"}>
                            <input
                              type="checkbox"
                              checked={g.include}
                              onChange={(e) => toggleGroupInclude(g.id, e.target.checked)}
                            />
                            <Icon name={g.include ? "eye" : "eyeOff"} size={16} />
                          </label>
                          <button type="button" className="link-btn" onClick={() => removeGroup(g.id)}>
                            Separar
                          </button>
                        </div>
                        <div className="group-members">
                          {members.map((p) => {
                            const index = editable.findIndex((x) => x.id === p.id);
                            return (
                              <div className={`group-member ${p.include ? "" : "off"}`} key={p.id}>
                                <div className="group-thumb" dangerouslySetInnerHTML={{ __html: partPreviewSvg(p, 40) }} />
                                <div className="group-member-name">
                                  <b>{p.name}</b>
                                  <span>{fmt(p.width)} × {fmt(p.height)} mm</span>
                                </div>
                                <select
                                  className="select mini"
                                  value={p.operation}
                                  disabled={p.kind === "raster"}
                                  onChange={(e) =>
                                    setEditable((prev) =>
                                      prev.map((x) => (x.id === p.id ? { ...x, operation: e.target.value as Operation } : x)),
                                    )
                                  }
                                >
                                  <option value="cut">Cortar</option>
                                  <option value="engrave">Grabar</option>
                                  <option value="score">Marcar</option>
                                </select>
                                <button
                                  type="button"
                                  className="tiny-btn"
                                  title="Quitar del grupo"
                                  onClick={() => removeFromGroup(g.id, p.id)}
                                >
                                  <Icon name="x" size={13} />
                                </button>
                                <label className="include-check" title={p.include ? "Incluir pieza" : "No incluir pieza"}>
                                  <input
                                    type="checkbox"
                                    checked={p.include}
                                    onChange={(e) =>
                                      setEditable((prev) =>
                                        prev.map((x, j) => (j === index ? { ...x, include: e.target.checked } : x)),
                                      )
                                    }
                                  />
                                  <Icon name={p.include ? "eye" : "eyeOff"} size={13} />
                                </label>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {!importGroups.length && (
                    <Callout kind="info">
                      Este SVG no tiene grupos automáticos. En <b>Piezas</b>, selecciona varias y pulsa
                      <b> Agrupar seleccionadas</b>.
                    </Callout>
                  )}
                  <div className="bulk-bar">
                    <Button size="sm" variant="secondary" icon="shapes" disabled={selected.size < 2} onClick={groupSelected}>
                      Agrupar seleccionadas ({selected.size})
                    </Button>
                    <span className="muted-text">Selecciona piezas en la pestaña Piezas.</span>
                  </div>
                </div>
              )}

              {view === "piezas" && (
                <>
                  <div className="bulk-bar">
                    <button type="button" className="link-btn" onClick={() => setEditable((p) => p.map((x) => ({ ...x, include: true })))}>Incluir todas</button>
                    <button type="button" className="link-btn" onClick={() => setEditable((p) => p.map((x) => ({ ...x, include: false })))}>Quitar todas</button>
                    <span className="spacer" />
                    <Button size="sm" variant="secondary" icon="shapes" disabled={selected.size < 2} onClick={groupSelected}>
                      Agrupar ({selected.size})
                    </Button>
                    <Button size="sm" variant="secondary" icon="magnet" disabled={selected.size < 2} onClick={mergeSelected}>
                      Fusionar formas ({selected.size})
                    </Button>
                  </div>
                  <div className="parts-import-list">
                    {editable.map((p, i) => {
                      const group = importGroups.find((g) => g.memberIds.includes(p.id));
                      return (
                      <div key={`${p.id}-${i}`} className={`import-row ${p.include ? "" : "off"} ${selected.has(i) ? "sel" : ""}`}>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={selected.has(i)}
                            onChange={(e) => {
                              const next = new Set(selected);
                              if (e.target.checked) next.add(i); else next.delete(i);
                              setSelected(next);
                            }}
                            aria-label={`Seleccionar ${p.name}`}
                          />
                        </label>
                        <div className="import-thumb" dangerouslySetInnerHTML={{ __html: partPreviewSvg(p, 52) }} />
                        <div className="import-main">
                          <input
                            className="inline-name"
                            value={p.name}
                            onChange={(e) => setEditable((prev) => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                            aria-label="Nombre de la pieza"
                          />
                          <div className="import-sub">
                            <span>{fmt(p.width)} × {fmt(p.height)} mm</span>
                            <span>{p.kind === "raster" ? "imagen de grabado" : `${p.islandIds.length} isla${p.islandIds.length === 1 ? "" : "s"}`}</span>
                            {group && <span className="group-tag"><Icon name="shapes" size={10} /> {group.name}</span>}
                          </div>
                        </div>
                        <select
                          className="select mini"
                          value={p.operation}
                          disabled={p.kind === "raster"}
                          onChange={(e) => setEditable((prev) => prev.map((x, j) => j === i ? { ...x, operation: e.target.value as Operation } : x))}
                        >
                          <option value="cut">Cortar</option>
                          <option value="engrave">Grabar</option>
                          <option value="score">Marcar</option>
                        </select>
                        <div className="mini-input with-suffix">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={String(p.offsetMm).replace(".", ",")}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value.replace(",", "."));
                              setEditable((prev) => prev.map((x, j) => j === i ? { ...x, offsetMm: Number.isFinite(v) ? Math.max(0, v) : 0 } : x));
                            }}
                            aria-label="Borde en mm"
                          />
                          <span>mm</span>
                        </div>
                        <Stepper value={p.copies} min={1} max={999} onChange={(v) => setEditable((prev) => prev.map((x, j) => j === i ? { ...x, copies: v } : x))} />
                        <div className="row-tools">
                          <button type="button" className="tiny-btn" title="Separar en islas" onClick={() => splitOne(i)} disabled={p.kind === "raster" || p.islandIds.length < 2}>
                            <Icon name="scissors" size={14} />
                          </button>
                          <label className="include-check" title={p.include ? "Incluir" : "No incluir"}>
                            <input
                              type="checkbox"
                              checked={p.include}
                              onChange={(e) => setEditable((prev) => prev.map((x, j) => j === i ? { ...x, include: e.target.checked } : x))}
                            />
                            <Icon name={p.include ? "eye" : "eyeOff"} size={15} />
                          </label>
                        </div>
                      </div>
                    )})}
                  </div>
                </>
              )}

              {view === "mapa" && (
                <div className="map-view">
                  <p className="map-help">
                    Cada imagen y cada corte conservan su posición original. Los recuadros discontinuos son los
                    grupos que se moverán y anidarán juntos. Haz clic para seleccionar piezas y agrúpalas o sepáralas.
                  </p>
                  <div className="map-canvas">
                    <svg
                      viewBox={`${mapBounds.x - 5} ${mapBounds.y - 5} ${Math.max(1, mapBounds.w) + 10} ${Math.max(1, mapBounds.h) + 10}`}
                      preserveAspectRatio="xMidYMid meet"
                    >
                      {importGroups.map((g, gi) => {
                        const members = g.memberIds
                          .map((id) => editable.find((p) => p.id === id))
                          .filter((p): p is EditablePart => Boolean(p));
                        if (!members.length) return null;
                        const x = Math.min(...members.map((p) => p.sourceBounds.x));
                        const y = Math.min(...members.map((p) => p.sourceBounds.y));
                        const x2 = Math.max(...members.map((p) => p.sourceBounds.x + p.sourceBounds.w));
                        const y2 = Math.max(...members.map((p) => p.sourceBounds.y + p.sourceBounds.h));
                        return (
                          <g key={g.id} pointerEvents="none">
                            <rect x={x - 1.5} y={y - 1.5} width={x2 - x + 3} height={y2 - y + 3} fill="none" stroke={g.color || "#8a5a2b"} strokeWidth={0.55} strokeDasharray="1.6 1.2" opacity={0.8} />
                            <text x={x} y={y - 3} fontSize={Math.max(2.4, Math.min(6, Math.max(mapBounds.w, mapBounds.h) * 0.018))} fill={g.color || "#6b4625"} fontFamily="var(--font-ui)" fontWeight={700}>
                              {gi + 1}. {g.name}
                            </text>
                          </g>
                        );
                      })}
                      {mapPairs.map((pair, i) => {
                        const a = editable[pair.a];
                        const b = editable[pair.b];
                        if (!a || !b) return null;
                        const ca = { x: a.sourceBounds.x + a.sourceBounds.w / 2, y: a.sourceBounds.y + a.sourceBounds.h / 2 };
                        const cb = { x: b.sourceBounds.x + b.sourceBounds.w / 2, y: b.sourceBounds.y + b.sourceBounds.h / 2 };
                        return (
                          <line
                            key={`l${i}`}
                            x1={ca.x} y1={ca.y} x2={cb.x} y2={cb.y}
                            stroke="#9a6a3a" strokeWidth={0.35} strokeDasharray="1.4 1.2" opacity={0.35}
                          />
                        );
                      })}
                      {editable.map((p, i) => {
                        const d = p.sourceContours.map((c) => `M${c.map((q) => `${fmt(q.x)} ${fmt(q.y)}`).join("L")}Z`).join("");
                        return (
                          <g
                            key={`${p.id}-${i}`}
                            onClick={() => {
                              const next = new Set(selected);
                              if (next.has(i)) next.delete(i); else next.add(i);
                              setSelected(next);
                            }}
                            style={{ cursor: "pointer" }}
                          >
                            {p.kind === "raster" && p.raster ? (
                              <image
                                x={p.sourceBounds.x}
                                y={p.sourceBounds.y}
                                width={p.sourceBounds.w}
                                height={p.sourceBounds.h}
                                href={p.raster.dataUrl}
                                preserveAspectRatio="none"
                                opacity={p.include ? 0.82 : 0.18}
                              />
                            ) : (
                              <path
                                d={d}
                                fill={p.color}
                                opacity={p.include ? 0.45 : 0.1}
                                stroke={selected.has(i) ? "#1f4d43" : "#5a3a1c"}
                                strokeWidth={selected.has(i) ? 0.9 : 0.25}
                                fillRule="evenodd"
                              />
                            )}
                            <text
                              x={p.sourceBounds.x + p.sourceBounds.w / 2}
                              y={p.sourceBounds.y + p.sourceBounds.h / 2}
                              textAnchor="middle"
                              dominantBaseline="middle"
                              fontSize={Math.max(2, Math.min(8, Math.max(mapBounds.w, mapBounds.h) * 0.022))}
                              fill="#2d1c0e"
                              fontWeight={600}
                              pointerEvents="none"
                            >
                              {i + 1}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                  <div className="map-legend">
                    {editable.map((p, i) => (
                      <button
                        type="button"
                        key={`${p.id}-leg-${i}`}
                        className={selected.has(i) ? "active" : ""}
                        onClick={() => {
                          const next = new Set(selected);
                          if (next.has(i)) next.delete(i); else next.add(i);
                          setSelected(next);
                        }}
                      >
                        <span style={{ background: p.color }} /> {i + 1}. {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {view === "parejas" && (
                <div className="pairs-view">
                  <p className="map-help">
                    Estas son las piezas que están más cerca en el archivo original. Si crees que forman un solo dibujo,
                    únelas. Si son piezas distintas que solo estaban juntas, déjalas separadas: el optimizador las colocará igual.
                  </p>
                  <div className="pairs-list">
                    {pairs.slice(0, 40).map((pair, i) => {
                      const a = editable[pair.a];
                      const b = editable[pair.b];
                      if (!a || !b) return null;
                      return (
                        <div className="pair-row" key={i}>
                          <div className="pair-thumbs">
                            <div dangerouslySetInnerHTML={{ __html: partPreviewSvg(a, 36) }} />
                            <div dangerouslySetInnerHTML={{ __html: partPreviewSvg(b, 36) }} />
                          </div>
                          <div className="pair-names">
                            <b>{a.name}</b>
                            <span>{b.name}</span>
                          </div>
                          <Badge kind={pair.gap < 0.2 ? "warn" : "neutral"}>
                            {pair.gap < 0.2 ? "se tocan" : `${fmt(pair.gap)} mm`}
                          </Badge>
                          <Button size="sm" variant="secondary" icon="magnet" onClick={() => mergePair(pair.a, pair.b)}>
                            Unir
                          </Button>
                        </div>
                      );
                    })}
                    {!pairs.length && <p className="muted-text">No hay piezas lo bastante cerca. Buena señal: están bien separadas.</p>}
                  </div>
                </div>
              )}
            </section>
          </div>

          {error && <Callout kind="warn">{error}</Callout>}
        </div>
      )}
    </Modal>
  );
}

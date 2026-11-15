import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch } from "react";
import type { Operation, Part } from "../types";
import type { Action } from "../lib/store";
import {
  closestPairs,
  importSvg,
  mergeImported,
  partPreviewSvg,
  splitImported,
  type ImportedPart,
  type SvgImportResult,
} from "../lib/svgImport";
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
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [pasteMode, setPasteMode] = useState(false);
  const [pasted, setPasted] = useState("");
  const [view, setView] = useState<"piezas" | "mapa" | "parejas">("piezas");
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
    const t = setTimeout(() => {
      try {
        const res = importSvg(svgText, {
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
          operation: options.defaultOperation,
          offsetMm: options.defaultOffset,
          copies: options.defaultCopies,
        }));
        setEditable((prev) => {
          // conservar ajustes si el número de piezas no cambia y ya había una edición
          if (prev.length === next.length && prev.length > 0) {
            return next.map((n, i) => ({
              ...n,
              name: prev[i]?.name || n.name,
              operation: prev[i]?.operation || n.operation,
              offsetMm: prev[i]?.offsetMm ?? n.offsetMm,
              copies: prev[i]?.copies ?? n.copies,
              include: prev[i]?.include ?? true,
            }));
          }
          return next;
        });
        setSelected(new Set());
        setError("");
      } catch (e: any) {
        setError(e?.message || "No se pudo interpretar el SVG.");
        setResult(null);
        setEditable([]);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [open, svgText, options]);

  const included = editable.filter((p) => p.include);
  const totalCopies = included.reduce((s, p) => s + p.copies, 0);
  const pairs = useMemo(() => closestPairs(editable, Math.max(20, options.tolerance * 4)), [editable, options.tolerance]);
  const mapBounds = useMemo(() => {
    const all = editable.flatMap((p) => p.sourceContours.flat());
    return boundsOf(all);
  }, [editable]);

  const mergeSelected = () => {
    if (selected.size < 2) return;
    const indices = Array.from(selected);
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
    setSelected(new Set());
  };

  const mergePair = (a: number, b: number) => {
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
    setSelected(new Set());
  };

  const splitOne = (index: number) => {
    if (!result) return;
    const part = editable[index];
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
  };

  const confirm = (nest: boolean) => {
    if (!included.length) return;
    const parts: Part[] = included.map((p) => ({
      id: uid("part"),
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
    }));
    dispatch({ type: "ADD_PARTS", parts, nest });
    dispatch({
      type: "TOAST",
      text: `${parts.length} pieza${parts.length === 1 ? "" : "s"} importada${parts.length === 1 ? "" : "s"}${nest ? " y colocada" : ""}.`,
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
    setSelected(new Set());
    setError("");
    setPasteMode(false);
    setPasted("");
    setOptions(DEFAULT_OPTIONS);
    setView("piezas");
    setShowWarnings(false);
  };

  const setAll = (patch: Partial<EditablePart>) => {
    setEditable((prev) => prev.map((p) => ({ ...p, ...patch })));
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

              {view === "piezas" && (
                <>
                  <div className="bulk-bar">
                    <button type="button" className="link-btn" onClick={() => setEditable((p) => p.map((x) => ({ ...x, include: true })))}>Incluir todas</button>
                    <button type="button" className="link-btn" onClick={() => setEditable((p) => p.map((x) => ({ ...x, include: false })))}>Quitar todas</button>
                    <span className="spacer" />
                    <Button size="sm" variant="secondary" icon="magnet" disabled={selected.size < 2} onClick={mergeSelected}>
                      Unir seleccionadas ({selected.size})
                    </Button>
                  </div>
                  <div className="parts-import-list">
                    {editable.map((p, i) => (
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
                            <span>{p.islandIds.length} isla{p.islandIds.length === 1 ? "" : "s"}</span>
                            <span>{gapFor(i)}</span>
                          </div>
                        </div>
                        <select
                          className="select mini"
                          value={p.operation}
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
                        <Stepper value={p.copies} min={0} max={999} onChange={(v) => setEditable((prev) => prev.map((x, j) => j === i ? { ...x, copies: v } : x))} />
                        <div className="row-tools">
                          <button type="button" className="tiny-btn" title="Separar en islas" onClick={() => splitOne(i)} disabled={p.islandIds.length < 2}>
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
                    ))}
                  </div>
                </>
              )}

              {view === "mapa" && (
                <div className="map-view">
                  <p className="map-help">
                    Cada color es una pieza detectada. Las líneas discontinuas unen las más cercanas.
                    Haz clic para seleccionar y usa <b>Unir seleccionadas</b> si deben ser una sola.
                  </p>
                  <div className="map-canvas">
                    <svg
                      viewBox={`${mapBounds.x - 5} ${mapBounds.y - 5} ${Math.max(1, mapBounds.w) + 10} ${Math.max(1, mapBounds.h) + 10}`}
                      preserveAspectRatio="xMidYMid meet"
                    >
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
                            stroke="#9a6a3a" strokeWidth={0.35} strokeDasharray="1.4 1.2" opacity={0.55}
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
                            <path
                              d={d}
                              fill={p.color}
                              opacity={p.include ? 0.55 : 0.12}
                              stroke={selected.has(i) ? "#1f4d43" : "#5a3a1c"}
                              strokeWidth={selected.has(i) ? 0.9 : 0.25}
                              fillRule="evenodd"
                            />
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

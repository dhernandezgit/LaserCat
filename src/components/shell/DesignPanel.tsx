import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch } from "react";
import type { Assembly, Doc, Operation, Part, SelectionState } from "../../types";
import type { Action } from "../../lib/store";
import { assemblyGeometry, getGroups } from "../../lib/assembly";
import { groupParts, groupThumbnail } from "../../lib/groupLibrary";
import { fmt } from "../../lib/geom";
import { PartThumb } from "../PartThumb";
import { Icon } from "../UI";

const OP_LABEL: Record<Operation, string> = { cut: "Corte", engrave: "Grabado", score: "Marcado" };

export function DesignPanel({
  doc,
  dispatch,
  selection,
  onDropFiles,
  onOpenSvgDialog,
  onOpenImageDialog,
  onOpenProject,
  onSaveGroup,
  onExportGroup,
  onOpenLibrary,
}: {
  doc: Doc;
  dispatch: Dispatch<Action>;
  selection: SelectionState;
  onDropFiles: (files: File[]) => void;
  onOpenSvgDialog: () => void;
  onOpenImageDialog: () => void;
  onOpenProject: () => void;
  onSaveGroup: (group: Assembly) => void;
  onExportGroup: (group: Assembly) => void;
  onOpenLibrary: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openFold, setOpenFold] = useState<Record<string, "size" | "offset" | null>>({});
  const groups = getGroups(doc);
  const groupedIds = useMemo(() => new Set(groups.flatMap((g) => g.members.map((m) => m.partId))), [groups]);
  const ungrouped = doc.parts.filter((p) => !groupedIds.has(p.id));
  const sel = new Set(selection.partIds);
  const selectedGroups = groups.filter((g) => g.members.some((m) => sel.has(m.partId)));
  const selectedCount = selection.partIds.length;
  const singleGroupSelected =
    selectedGroups.length === 1 &&
    selectedGroups[0].members.length === selection.partIds.length &&
    selectedGroups[0].members.every((m) => sel.has(m.partId));
  const showBulk = selectedCount > 1 && !singleGroupSelected;

  useEffect(() => {
    const id = selection.partIds[0];
    if (!id) return;
    const group = groups.find((g) => g.members.some((m) => m.partId === id));
    const el = group
      ? document.querySelector(`[data-group="${group.id}"]`)
      : document.querySelector(`[data-part="${id}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selection.partIds.join("|")]);

  const pinGroup = (group: Assembly) => {
    const pls = doc.placements.filter((p) => p.assemblyId === group.id);
    const pinned = pls.length > 0 && pls.every((p) => p.pinned);
    dispatch({ type: "PIN_ASSEMBLY", id: group.id, pinned: !pinned });
  };
  const rotateGroup = (group: Assembly) => dispatch({ type: "ROTATE_ASSEMBLY", id: group.id, delta: 90 });
  const pinPart = (part: Part) => {
    const pls = doc.placements.filter((p) => p.partId === part.id);
    const pinned = pls.length > 0 && pls.every((p) => p.pinned);
    pls.forEach((p) => dispatch({ type: "PIN_PLACEMENT", id: p.id, pinned: !pinned }));
  };
  const rotatePart = (part: Part) => {
    const pls = doc.placements.filter((p) => p.partId === part.id);
    if (pls.length) dispatch({ type: "ROTATE_SELECTION", placementIds: pls.map((p) => p.id), delta: 90 });
  };

  const selectGroup = (group: Assembly, additive = false) => {
    const ids = group.members.map((m) => m.partId);
    const pls = doc.placements.filter((p) => p.assemblyId === group.id);
    const already = ids.every((id) => selection.partIds.includes(id));
    const nextPartIds = additive
      ? already
        ? selection.partIds.filter((id) => !ids.includes(id))
        : Array.from(new Set([...selection.partIds, ...ids]))
      : ids;
    const removePl = new Set(pls.map((p) => p.id));
    const nextPl = additive
      ? already
        ? selection.placementIds.filter((id) => !removePl.has(id))
        : Array.from(new Set([...selection.placementIds, ...pls.map((p) => p.id)]))
      : pls.map((p) => p.id);
    dispatch({ type: "SELECT", partIds: nextPartIds, placementIds: nextPl });
    if (pls[0] && !already) dispatch({ type: "SET_PAGE", page: pls[0].page });
  };

  const selectPart = (part: Part, additive = false) => {
    const pl = doc.placements.find((p) => p.partId === part.id);
    const already = selection.partIds.includes(part.id);
    const nextPartIds = additive
      ? already
        ? selection.partIds.filter((id) => id !== part.id)
        : Array.from(new Set([...selection.partIds, part.id]))
      : [part.id];
    const nextPl = additive
      ? already
        ? selection.placementIds.filter((id) => id !== pl?.id)
        : Array.from(new Set([...selection.placementIds, ...(pl ? [pl.id] : [])]))
      : pl
        ? [pl.id]
        : [];
    dispatch({ type: "SELECT", partIds: nextPartIds, placementIds: nextPl });
    if (pl && !already) dispatch({ type: "SET_PAGE", page: pl.page });
  };

  const selectAll = () =>
    dispatch({
      type: "SELECT",
      partIds: doc.parts.map((p) => p.id),
      placementIds: doc.placements.map((p) => p.id),
    });

  const invert = () => {
    const current = new Set(selection.partIds);
    const partIds = doc.parts.map((p) => p.id).filter((id) => !current.has(id));
    const allowed = new Set(partIds);
    dispatch({
      type: "SELECT",
      partIds,
      placementIds: doc.placements.filter((p) => allowed.has(p.partId)).map((p) => p.id),
    });
  };

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleFold = (id: string, which: "size" | "offset") =>
    setOpenFold((prev) => ({ ...prev, [id]: prev[id] === which ? null : which }));

  const setAllCopies = (delta: number) => {
    if (selectedGroups.length === 1 && selectedGroups[0].members.every((m) => sel.has(m.partId))) {
      const g = selectedGroups[0];
      dispatch({ type: "SET_ASSEMBLY_COPIES", id: g.id, copies: Math.max(1, g.copies + delta) });
      return;
    }
    for (const id of selection.partIds) {
      const part = doc.parts.find((p) => p.id === id);
      if (part && !part.assemblyId) dispatch({ type: "SET_COPIES", id, copies: Math.max(0, part.copies + delta) });
    }
  };

  const setBulkOffset = (mm: number) => {
    const value = Math.max(0, Math.min(20, Math.round(mm * 2) / 2));
    const ids = new Set<string>();
    for (const g of selectedGroups) for (const m of g.members) ids.add(m.partId);
    for (const id of selection.partIds) ids.add(id);
    for (const id of ids) dispatch({ type: "UPDATE_PART", id, patch: { offsetMm: value }, nest: false });
    if (doc.settings.autoNest) window.setTimeout(() => dispatch({ type: "NEST" }), 30);
  };

  const setBulkOperation = (op: Operation) => {
    for (const id of selection.partIds) {
      const part = doc.parts.find((p) => p.id === id);
      if (part?.kind === "vector") dispatch({ type: "UPDATE_PART", id, patch: { operation: op }, nest: false });
    }
  };

  const allPlaced = (group: Assembly) => {
    const count = doc.placements.filter((p) => p.assemblyId === group.id).length;
    return `${count}/${groupParts(doc, group).length * Math.max(1, group.copies)}`;
  };

  const onPick = () => {
    inputRef.current?.click();
  };

  return (
    <div className="file-panel">
      <div className="file-head">
        <h2>Piezas</h2>
        <span className="sub" title="Clic = seleccionar una figura; Shift + clic = añadir a la selección.">
          Ctrl/Shift+clic = varios
        </span>
        <span className="count-badge">{groups.length + ungrouped.length}</span>
      </div>

      <div
        className={`dropzone${over ? " over" : ""}`}
        onClick={onPick}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onDropFiles(Array.from(e.dataTransfer.files || []));
        }}
        title="Arrastra SVG o imágenes y se añaden y colocan automáticamente"
      >
        <span className="plus">+</span>
        <span>
          Arrastra tus diseños aquí
          <br />
          <small>svg · png · jpg · webp · gif · bmp</small>
        </span>
        <span className="dz-actions">
          <button type="button" onClick={(e) => { e.stopPropagation(); onOpenSvgDialog(); }} title="Revisar grupos, escala y operaciones antes de añadir">
            Revisar SVG
          </button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onOpenImageDialog(); }} title="Importar imagen con más opciones">
            Imagen
          </button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onOpenProject(); }} title="Abrir proyecto o figura .json">
            <Icon name="folder" size={11} />
          </button>
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept=".svg,image/*"
          onChange={(e) => {
            if (e.target.files) onDropFiles(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
      </div>

      <div className="sel-tools">
        <button type="button" className="cc-btn" onClick={selectAll} title="Seleccionar todas las piezas y figuras">
          Seleccionar todo
        </button>
        <button type="button" className="cc-btn" onClick={invert} title="Invertir la selección">
          Invertir
        </button>
        <button type="button" className="cc-btn" onClick={() => dispatch({ type: "SELECT", partIds: [], placementIds: [] })}>
          Quitar selección
        </button>
      </div>
      <div className="sel-hint">
        Clic en una figura para moverla entera · Shift + clic para sumar · Ctrl+G agrupa · R gira · Supr quita.
      </div>

      <div
        className="asset-list"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onDropFiles(Array.from(e.dataTransfer.files || []));
        }}
      >
        {showBulk && (
          <div className="bulk-card">
            <div className="bulk-head">
              <Icon name="layers" size={14} /> {selectedCount} piezas seleccionadas
              <span className="count">en bloque</span>
            </div>
            <div className="bulk-row">
              <span>Copias</span>
              <button className="cc-icon" type="button" onClick={() => setAllCopies(-1)}>−</button>
              <button className="cc-icon" type="button" onClick={() => setAllCopies(1)}>+</button>
              <span style={{ marginLeft: 6 }}>Borde</span>
              <input
                className="cc-input"
                type="number"
                min={0}
                max={20}
                step={0.5}
                placeholder="mm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") setBulkOffset(Number((e.target as HTMLInputElement).value));
                }}
                onBlur={(e) => setBulkOffset(Number(e.target.value) || 0)}
              />
              <span>mm</span>
            </div>
            <div className="bulk-row">
              <span>Operación</span>
              {(["cut", "engrave", "score"] as Operation[]).map((op) => (
                <button key={op} type="button" className="chip" onClick={() => setBulkOperation(op)}>
                  {OP_LABEL[op]}
                </button>
              ))}
              <button type="button" className="chip" onClick={() => {
                const pls = doc.placements.filter((p) => selection.placementIds.includes(p.id));
                const pinned = pls.length > 0 && pls.every((p) => p.pinned);
                pls.forEach((p) => dispatch({ type: "PIN_PLACEMENT", id: p.id, pinned: !pinned }));
              }}>Fijar</button>
              <button type="button" className="chip" onClick={() => dispatch({ type: "ROTATE_SELECTION", placementIds: selection.placementIds, delta: 90 })}>Girar</button>
              <button
                type="button"
                className="cc-btn"
                style={{ marginLeft: "auto" }}
                onClick={() => dispatch({ type: "GROUP_PLACEMENTS", placementIds: selection.placementIds, name: "Figura" })}
              >
                Agrupar
              </button>
            </div>
          </div>
        )}

        {!doc.parts.length && (
          <div className="asset-empty">
            <span className="big">✧</span>
            <b>La mesa está esperando</b>
            <span>Arrastra un SVG con imágenes o una imagen, o crea una forma desde Ajustes.</span>
            <button type="button" className="cc-btn" onClick={onOpenSvgDialog}>
              Elegir un SVG
            </button>
          </div>
        )}

        {groups.map((group) => {
          const parts = groupParts(doc, group);
          const thumb = groupThumbnail(doc, group);
          const geo = assemblyGeometry(group, parts);
          const active = group.members.some((m) => sel.has(m.partId));
          const isOpen = expanded.has(group.id);
          const fold = openFold[group.id];
          const ops = Array.from(new Set(parts.map((p) => p.operation)));
          const border = parts.length ? Math.max(...parts.map((p) => p.offsetMm)) : 0;
          return (
            <div
              className={`asset-card${active ? " sel" : ""}`}
              key={group.id}
              data-group={group.id}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("button,input,select")) return;
                selectGroup(group, e.shiftKey || e.ctrlKey || e.metaKey);
              }}
            >
              <div className="preview">
                {thumb ? <img src={thumb} alt={group.name} /> : <Icon name="shapes" size={30} />}
              </div>
              <div className="info">
                <div className="name-row">
                  <input
                    className="name-input"
                    value={group.name}
                    onChange={(e) => dispatch({ type: "RENAME_ASSEMBLY", id: group.id, name: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    title="Nombre de la figura"
                  />
                  <div className="asset-actions">
                    <button className="cc-icon" title="Guardar figura con sus imágenes" onClick={() => onSaveGroup(group)}>
                      <Icon name="save" size={13} />
                    </button>
                    <button className="cc-icon" title="Exportar figura para LightBurn (ZIP)" onClick={() => onExportGroup(group)}>
                      <Icon name="download" size={13} />
                    </button>
                    <button
                      className="cc-icon"
                      title="Duplicar figura"
                      onClick={() => parts[0] && dispatch({ type: "DUPLICATE_PART", id: parts[0].id })}
                    >
                      <Icon name="copy" size={13} />
                    </button>
                    <button
                      className="cc-icon danger"
                      title="Eliminar figura"
                      onClick={() => dispatch({ type: "REMOVE_PARTS", ids: parts.map((p) => p.id) })}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </div>
                <div className="chip-row">
                  <span className="chip on">{parts.length} piezas</span>
                  {ops.map((op) => (
                    <span className={`chip ${op}`} key={op}>
                      {OP_LABEL[op]}
                    </span>
                  ))}
                  {parts.some((p) => p.kind === "raster") && <span className="chip engrave">imagen</span>}
                </div>
                <div className="copies-row">
                  <span className="cap">Copias</span>
                  <button className="step" type="button" onClick={() => dispatch({ type: "SET_ASSEMBLY_COPIES", id: group.id, copies: Math.max(1, group.copies - 1) })}>−</button>
                  <span className="n">{group.copies}</span>
                  <button className="step" type="button" onClick={() => dispatch({ type: "SET_ASSEMBLY_COPIES", id: group.id, copies: Math.min(99, group.copies + 1) })}>+</button>
                  <span className="placed">{allPlaced(group)} en plancha</span>
                </div>
                <div className="fold">
                  <button className="fold-head" type="button" onClick={() => toggleFold(group.id, "size")}>
                    <span className={`chev ${fold === "size" ? "open" : ""}`}>›</span> Tamaño
                    <span className="fold-val">{fmt(geo.width)} × {fmt(geo.height)} mm</span>
                  </button>
                  {fold === "size" && (
                    <div className="fold-body">
                      <div className="fold-line">
                        <span>Ancho</span>
                        <input
                          key={`gw-${group.id}-${geo.width.toFixed(2)}`}
                          className="cc-input"
                          type="number"
                          min={1}
                          max={2000}
                          step={1}
                          defaultValue={Number(geo.width.toFixed(1))}
                          onBlur={(e) => {
                            const w = Math.max(1, Number(e.target.value) || geo.width);
                            dispatch({ type: "RESIZE_ASSEMBLY", id: group.id, width: w, height: geo.height * (w / geo.width) });
                          }}
                        />
                        <span>Alto</span>
                        <input
                          key={`gh-${group.id}-${geo.height.toFixed(2)}`}
                          className="cc-input"
                          type="number"
                          min={1}
                          max={2000}
                          step={1}
                          defaultValue={Number(geo.height.toFixed(1))}
                          onBlur={(e) => {
                            const h = Math.max(1, Number(e.target.value) || geo.height);
                            dispatch({ type: "RESIZE_ASSEMBLY", id: group.id, width: geo.width * (h / geo.height), height: h });
                          }}
                        />
                        <span>mm</span>
                      </div>
                      <div className="fold-line">
                        <button type="button" className="chip" onClick={() => toggleExpand(group.id)}>
                          {isOpen ? "Ocultar" : "Ver"} composición
                        </button>
                        <button type="button" className="chip" onClick={() => rotateGroup(group)}>
                          Girar 90°
                        </button>
                        <button type="button" className="chip" onClick={() => pinGroup(group)}>
                          Fijar / liberar
                        </button>
                        <button type="button" className="chip" onClick={() => dispatch({ type: "UNGROUP", id: group.id })}>
                          Desagrupar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="fold">
                  <button className="fold-head" type="button" onClick={() => toggleFold(group.id, "offset")}>
                    <span className={`chev ${fold === "offset" ? "open" : ""}`}>›</span> Borde adicional
                    <span className="fold-val">{fmt(border)} mm</span>
                  </button>
                  {fold === "offset" && (
                    <div className="fold-body">
                      <div className="fold-line">
                        <input
                          className="cc-input"
                          type="number"
                          min={0}
                          max={20}
                          step={0.5}
                          value={border}
                          onChange={(e) => {
                            const v = Math.max(0, Math.min(20, Number(e.target.value) || 0));
                            for (const p of parts) dispatch({ type: "UPDATE_PART", id: p.id, patch: { offsetMm: v }, nest: false });
                          }}
                          onBlur={() => { if (doc.settings.autoNest) dispatch({ type: "NEST" }); }}
                        />
                        <span>mm en todas las piezas de la figura</span>
                      </div>
                    </div>
                  )}
                </div>
                {isOpen && (
                  <div className="group-members">
                    {parts.map((part) => (
                      <div className="group-member" key={part.id}>
                        <span className="gthumb"><PartThumb part={part} size={25} /></span>
                        <span className="gname" title={part.name}>{part.name}</span>
                        <select
                          value={part.operation}
                          onChange={(e) =>
                            dispatch({
                              type: "UPDATE_PART",
                              id: part.id,
                              patch: { operation: e.target.value as Operation },
                              nest: false,
                            })
                          }
                          disabled={part.kind === "raster"}
                          title={part.kind === "raster" ? "Una imagen SVG siempre se graba" : "Operación de esta pieza"}
                        >
                          <option value="cut">Cortar</option>
                          <option value="engrave">Grabar</option>
                          <option value="score">Marcar</option>
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {ungrouped.map((part) => {
          const active = sel.has(part.id);
          const count = doc.placements.filter((p) => p.partId === part.id).length;
          const fold = openFold[part.id];
          return (
            <div
              className={`asset-card${active ? " sel" : ""}`}
              key={part.id}
              data-part={part.id}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("button,input,select")) return;
                selectPart(part, e.shiftKey || e.ctrlKey || e.metaKey);
              }}
            >
              <div className="preview">
                <PartThumb part={part} size={72} />
              </div>
              <div className="info">
                <div className="name-row">
                  <input
                    className="name-input"
                    value={part.name}
                    onChange={(e) => dispatch({ type: "UPDATE_PART", id: part.id, patch: { name: e.target.value } })}
                    onClick={(e) => e.stopPropagation()}
                    title="Nombre de la pieza"
                  />
                  <div className="asset-actions">
                    <button className="cc-icon" title="Duplicar pieza" onClick={() => dispatch({ type: "DUPLICATE_PART", id: part.id })}>
                      <Icon name="copy" size={13} />
                    </button>
                    <button className="cc-icon danger" title="Eliminar pieza" onClick={() => dispatch({ type: "REMOVE_PARTS", ids: [part.id] })}>
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </div>
                <div className="chip-row">
                  <span className={`chip ${part.operation}`}>{OP_LABEL[part.operation]}</span>
                  {part.kind === "raster" && <span className="chip engrave">imagen</span>}
                  {part.offsetMm > 0 && <span className="chip">+{fmt(part.offsetMm)} borde</span>}
                </div>
                <div className="copies-row">
                  <span className="cap">Copias</span>
                  <button className="step" type="button" onClick={() => dispatch({ type: "SET_COPIES", id: part.id, copies: Math.max(0, part.copies - 1) })}>−</button>
                  <span className="n">{part.copies}</span>
                  <button className="step" type="button" onClick={() => dispatch({ type: "SET_COPIES", id: part.id, copies: Math.min(999, part.copies + 1) })}>+</button>
                  <span className="placed">{count}/{part.copies} en plancha</span>
                </div>
                <div className="fold">
                  <button className="fold-head" type="button" onClick={() => toggleFold(part.id, "size")}>
                    <span className={`chev ${fold === "size" ? "open" : ""}`}>›</span> Tamaño
                    <span className="fold-val">{fmt(part.width)} × {fmt(part.height)} mm</span>
                  </button>
                  {fold === "size" && (
                    <div className="fold-body">
                      <div className="fold-line">
                        <span>Ancho</span>
                        <input
                          className="cc-input"
                          type="number"
                          min={1}
                          max={2000}
                          step={1}
                          defaultValue={Number(part.width.toFixed(1))}
                          onBlur={(e) => {
                            const w = Math.max(1, Number(e.target.value) || part.width);
                            const h = (part.height / part.width) * w;
                            dispatch({ type: "RESIZE_PART", id: part.id, width: w, height: h });
                          }}
                        />
                        <span>Alto</span>
                        <input
                          className="cc-input"
                          type="number"
                          min={1}
                          max={2000}
                          step={1}
                          defaultValue={Number(part.height.toFixed(1))}
                          onBlur={(e) => {
                            const h = Math.max(1, Number(e.target.value) || part.height);
                            const w = (part.width / part.height) * h;
                            dispatch({ type: "RESIZE_PART", id: part.id, width: w, height: h });
                          }}
                        />
                        <span>mm</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="fold">
                  <button className="fold-head" type="button" onClick={() => toggleFold(part.id, "offset")}>
                    <span className={`chev ${fold === "offset" ? "open" : ""}`}>›</span> Borde adicional
                    <span className="fold-val">{fmt(part.offsetMm)} mm</span>
                  </button>
                  {fold === "offset" && (
                    <div className="fold-body">
                      <div className="fold-line">
                        <input
                          className="cc-input"
                          type="number"
                          min={0}
                          max={20}
                          step={0.5}
                          value={part.offsetMm}
                          onChange={(e) =>
                            dispatch({
                              type: "UPDATE_PART",
                              id: part.id,
                              patch: { offsetMm: Math.max(0, Math.min(20, Number(e.target.value) || 0)) },
                              nest: false,
                            })
                          }
                          onBlur={() => { if (doc.settings.autoNest) dispatch({ type: "NEST" }); }}
                        />
                        <span>mm</span>
                        <button type="button" className="chip" onClick={() => rotatePart(part)}>Girar</button>
                        <button type="button" className="chip" onClick={() => pinPart(part)}>Fijar</button>
                        {part.kind === "vector" && (
                          <select
                            value={part.operation}
                            onChange={(e) => dispatch({ type: "UPDATE_PART", id: part.id, patch: { operation: e.target.value as Operation }, nest: false })}
                          >
                            <option value="cut">Cortar</option>
                            <option value="engrave">Grabar</option>
                            <option value="score">Marcar</option>
                          </select>
                        )}
                      </div>
                      <div className="micro-help">
                        El borde expande solo el exterior; los agujeros conservan su medida. La imagen se graba y el contorno se corta.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {selectedGroups.length === 0 && selection.partIds.length === 1 && (
        <button
          type="button"
          className="cc-btn"
          onClick={() => {
            if (selection.placementIds.length) {
              dispatch({ type: "GROUP_PLACEMENTS", placementIds: selection.placementIds, name: "Figura" });
            }
          }}
          disabled={selection.placementIds.length < 2}
          title="Agrupa las piezas seleccionadas como una figura"
        >
          Agrupar selección
        </button>
      )}

      <button type="button" className="cc-btn" onClick={onOpenLibrary} title="Figuras guardadas con sus imágenes">
        <Icon name="folder" size={13} /> Biblioteca de figuras
      </button>

      {!!doc.parts.length && (
        <div className="file-hint">
          Consejo: activa <b>Auto optimizar</b> en Ajustes y suelta varias piezas para colocarlas solas.
        </div>
      )}

      <button
        className="cc-btn btn-clear-all"
        disabled={!doc.parts.length}
        onClick={() => dispatch({ type: "CLEAR" })}
      >
        Descartar piezas
      </button>
    </div>
  );
}

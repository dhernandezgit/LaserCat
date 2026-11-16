import { useEffect, useMemo, useState } from "react";
import type { Dispatch } from "react";
import type { Assembly, Doc, Part, SelectionState } from "../types";
import type { Action } from "../lib/store";
import { shapePart } from "../lib/demo";
import { fmt } from "../lib/geom";
import { getGroups, groupBounds } from "../lib/assembly";
import {
  cloneSavedGroup,
  deleteSavedGroup,
  groupJson,
  groupParts,
  groupThumbnail,
  loadGroupLibrary,
  notifyGroupsChanged,
  saveGroupToLibrary,
  type SavedGroup,
} from "../lib/groupLibrary";
import { downloadText, safeFileName } from "../lib/download";
import { PartThumb } from "./PartThumb";
import { Badge, Button, Icon, IconButton, Stepper } from "./UI";

const OP_LABEL: Record<Part["operation"], string> = {
  cut: "Corte",
  engrave: "Grabado",
  score: "Marcado",
};

export function PartsPanel({
  doc,
  dispatch,
  selection,
}: {
  doc: Doc;
  dispatch: Dispatch<Action>;
  selection: SelectionState;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [library, setLibrary] = useState<SavedGroup[]>(() => loadGroupLibrary());
  const groups = getGroups(doc);
  const groupedPartIds = useMemo(
    () => new Set(groups.flatMap((g) => g.members.map((m) => m.partId))),
    [groups],
  );
  const placed = useMemo(() => {
    const map = new Map<string, number>();
    for (const pl of doc.placements) map.set(pl.partId, (map.get(pl.partId) || 0) + 1);
    return map;
  }, [doc.placements]);
  const groupPlaced = useMemo(() => {
    const map = new Map<string, number>();
    for (const pl of doc.placements) {
      if (pl.assemblyId) map.set(pl.assemblyId, (map.get(pl.assemblyId) || 0) + 1);
    }
    return map;
  }, [doc.placements]);

  useEffect(() => {
    const reload = () => setLibrary(loadGroupLibrary());
    window.addEventListener("lasercat:groups-changed", reload);
    return () => window.removeEventListener("lasercat:groups-changed", reload);
  }, []);

  const selectPart = (part: Part) => {
    const pl = doc.placements.find((p) => p.partId === part.id);
    dispatch({ type: "SELECT", partIds: [part.id], placementIds: pl ? [pl.id] : [] });
    if (pl) dispatch({ type: "SET_PAGE", page: pl.page });
  };

  const selectGroup = (group: Assembly) => {
    const pls = doc.placements.filter((p) => p.assemblyId === group.id);
    dispatch({
      type: "SELECT",
      partIds: group.members.map((m) => m.partId),
      placementIds: pls.map((p) => p.id),
    });
    if (pls[0]) dispatch({ type: "SET_PAGE", page: pls[0].page });
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addShape = (kind: "rect" | "circle" | "hex" | "star") => {
    const part = shapePart(kind, kind === "rect" ? 60 : 50, kind === "rect" ? 40 : 50);
    dispatch({ type: "ADD_SHAPE", shape: part });
    dispatch({ type: "TOAST", text: `${part.name} añadido a la plancha.` });
  };

  const saveGroup = (group: Assembly) => {
    const parts = groupParts(doc, group);
    const thumb = groupThumbnail(doc, group);
    const ok = saveGroupToLibrary(group, parts, thumb);
    downloadText(
      `${safeFileName(group.name, "figura")}.lasercat-group.json`,
      groupJson(group, parts),
      "application/json",
    );
    notifyGroupsChanged();
    dispatch({
      type: "TOAST",
      text: ok
        ? "Figura guardada con sus imágenes (biblioteca + JSON)."
        : "JSON descargado, pero la biblioteca local está llena.",
      kind: ok ? "ok" : "warn",
    });
  };

  const insertSaved = (saved: SavedGroup) => {
    const { parts, group } = cloneSavedGroup(saved);
    dispatch({ type: "ADD_PARTS", parts, groups: [group] });
    dispatch({ type: "TOAST", text: `Figura «${saved.name}» insertada.`, kind: "ok" });
  };

  const ungrouped = doc.parts.filter((p) => !groupedPartIds.has(p.id));

  return (
    <div className="panel-stack">
      <div className="panel-head">
        <div>
          <h2>Diseño</h2>
          <p>
            {groups.length} figura{groups.length === 1 ? "" : "s"} · {doc.parts.length} pieza{doc.parts.length === 1 ? "" : "s"} ·{" "}
            {doc.placements.length} colocada{doc.placements.length === 1 ? "" : "s"}
          </p>
        </div>
        <Badge kind="neutral">{groups.length + ungrouped.length}</Badge>
      </div>

      <div className="import-row">
        <button type="button" className="import-card primary" onClick={() => dispatch({ type: "SET_UI", patch: { showSvgDialog: true } })}>
          <span className="import-icon"><Icon name="layers" size={22} /></span>
          <b>Importar SVG</b>
          <em>Con imágenes y grupos</em>
        </button>
        <button type="button" className="import-card" onClick={() => dispatch({ type: "SET_UI", patch: { showImageDialog: true, pendingImageCut: true } })}>
          <span className="import-icon"><Icon name="image" size={22} /></span>
          <b>Imagen</b>
          <em>Contorno o grabado</em>
        </button>
      </div>

      <div className="shape-row">
        <span>Crear</span>
        <div className="shape-buttons">
          <button type="button" title="Rectángulo" onClick={() => addShape("rect")}><Icon name="shapes" size={16} /><small>Rect</small></button>
          <button type="button" title="Círculo" onClick={() => addShape("circle")}><span className="circle-glyph" /><small>Círculo</small></button>
          <button type="button" title="Hexágono" onClick={() => addShape("hex")}><span className="hex-glyph" /><small>Hex</small></button>
          <button type="button" title="Estrella" onClick={() => addShape("star")}><span className="star-glyph">★</span><small>Estrella</small></button>
        </div>
      </div>

      {!doc.parts.length && (
        <div className="panel-empty">
          <Icon name="cat" size={36} />
          <p>Aún no hay piezas. Importa un SVG con imágenes o crea una forma para empezar.</p>
          <Button size="sm" variant="secondary" icon="sparkles" onClick={() => {
            const parts = [shapePart("hex", 70, 70), shapePart("star", 45, 45)];
            dispatch({ type: "ADD_PARTS", parts });
          }}>
            Añadir ejemplo rápido
          </Button>
        </div>
      )}

      {groups.length > 0 && <div className="section-label">Figuras</div>}
      <div className="parts-list">
        {groups.map((group) => {
          const members = groupParts(doc, group);
          const isActive = members.some((m) => selection.partIds.includes(m.id));
          const ops = Array.from(new Set(members.map((m) => m.operation)));
          const placedMembers = groupPlaced.get(group.id) || 0;
          const totalMembers = members.length * Math.max(1, group.copies);
          const thumb = groupThumbnail(doc, group);
          return (
            <div className={`group-card ${isActive ? "active" : ""}`} key={group.id}>
              <div className="group-card-head" onClick={() => selectGroup(group)}>
                <div className="group-card-thumb">
                  {thumb ? <img src={thumb} alt="" /> : <Icon name="shapes" size={20} />}
                </div>
                <div className="group-card-info">
                  <div className="part-name">{group.name}</div>
                  <div className="part-meta">
                    <span>{members.length} pieza{members.length === 1 ? "" : "s"}</span>
                    {ops.map((op) => <Badge key={op} kind={op}>{OP_LABEL[op]}</Badge>)}
                  </div>
                  <div className="part-sub">
                    <span className={placedMembers < totalMembers ? "warn-text" : "ok-text"}>
                      {placedMembers}/{totalMembers} en plancha
                    </span>
                    {members.some((m) => m.kind === "raster") && <span className="offset-tag">con imagen</span>}
                  </div>
                </div>
                <div className="group-card-side" onClick={(e) => e.stopPropagation()}>
                  <Stepper
                    value={group.copies}
                    min={1}
                    max={99}
                    onChange={(v) => dispatch({ type: "SET_ASSEMBLY_COPIES", id: group.id, copies: v })}
                  />
                  <div className="part-actions">
                    <IconButton icon="save" title="Guardar figura con imágenes" size={14} onClick={() => saveGroup(group)} />
                    <IconButton icon="chevronDown" title={expanded.has(group.id) ? "Ocultar piezas" : "Ver piezas"} size={14} onClick={() => toggleExpand(group.id)} />
                  </div>
                </div>
              </div>
              {expanded.has(group.id) && (
                <div className="group-members-list">
                  {members.map((part) => {
                    const count = placed.get(part.id) || 0;
                    return (
                      <div className="group-member-row" key={part.id} onClick={() => selectGroup(group)}>
                        <PartThumb part={part} size={28} />
                        <span className="member-name">{part.name}</span>
                        <Badge kind={part.operation}>{OP_LABEL[part.operation]}</Badge>
                        <span className="member-count">{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {ungrouped.length > 0 && groups.length > 0 && <div className="section-label">Piezas sueltas</div>}
      <div className="parts-list">
        {ungrouped.map((part) => {
          const count = placed.get(part.id) || 0;
          const active = selection.partIds.includes(part.id);
          return (
            <div
              key={part.id}
              className={`part-card ${active ? "active" : ""}`}
              onClick={() => selectPart(part)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter") selectPart(part); }}
            >
              <PartThumb part={part} size={48} />
              <div className="part-info">
                <div className="part-name" title={part.name}>{part.name}</div>
                <div className="part-meta">
                  <span>{fmt(part.width)}×{fmt(part.height)} mm</span>
                  <Badge kind={part.operation}>{OP_LABEL[part.operation]}</Badge>
                  {part.offsetMm > 0 && <span className="offset-tag">+{fmt(part.offsetMm)} borde</span>}
                </div>
                <div className="part-sub">
                  <span className={count < part.copies ? "warn-text" : "ok-text"}>
                    {count}/{part.copies} en plancha
                  </span>
                  {count < part.copies && <span className="mini-warn"><Icon name="alert" size={12} /> sin sitio</span>}
                </div>
              </div>
              <div className="part-side" onClick={(e) => e.stopPropagation()}>
                <Stepper
                  value={part.copies}
                  min={0}
                  max={999}
                  onChange={(v) => dispatch({ type: "SET_COPIES", id: part.id, copies: v })}
                />
                <div className="part-actions">
                  <IconButton icon="copy" title="Duplicar pieza" size={14} onClick={() => dispatch({ type: "DUPLICATE_PART", id: part.id })} />
                  <IconButton icon="trash" title="Eliminar pieza" size={14} onClick={() => dispatch({ type: "REMOVE_PARTS", ids: [part.id] })} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="panel-actions">
        {doc.parts.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            icon="trash"
            onClick={() => {
              dispatch({ type: "CLEAR" });
              dispatch({ type: "TOAST", text: "Plancha vaciada. Ctrl+Z para recuperar.", kind: "warn" });
            }}
          >
            Vaciar
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon="sparkles"
          onClick={() => {
            const parts = [shapePart("hex", 70, 70), shapePart("star", 45, 45)];
            dispatch({ type: "ADD_PARTS", parts });
          }}
        >
          Ejemplo
        </Button>
      </div>

      <div className="section-label">Biblioteca de figuras</div>
      {library.length === 0 ? (
        <div className="library-empty">
          <Icon name="save" size={18} />
          <p>Guarda una figura desde su tarjeta (icono del disquete) para reutilizarla con sus imágenes.</p>
        </div>
      ) : (
        <div className="library-list">
          {library.map((saved) => (
            <div className="library-card" key={saved.id}>
              <div className="library-thumb">
                {saved.thumbnail ? <img src={saved.thumbnail} alt="" /> : <Icon name="shapes" size={18} />}
              </div>
              <div className="library-info">
                <b>{saved.name}</b>
                <span>{saved.parts.length} piezas · {new Date(saved.createdAt).toLocaleDateString()}</span>
              </div>
              <IconButton icon="plus" title="Insertar figura" size={15} onClick={() => insertSaved(saved)} />
              <IconButton icon="trash" title="Borrar de la biblioteca" size={14} onClick={() => { deleteSavedGroup(saved.id); setLibrary(loadGroupLibrary()); }} />
            </div>
          ))}
        </div>
      )}

      <div className="panel-tip">
        <Icon name="magnet" size={15} />
        <div>
          <b>Atajos:</b> clic en una figura para moverla entera; <kbd>Mayús</kbd> para varias; <kbd>R</kbd> gira;
          <kbd>Ctrl</kbd>+<kbd>G</kbd> agrupa piezas seleccionadas.
        </div>
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import type { Dispatch } from "react";
import type { Doc, Part, SelectionState } from "../types";
import type { Action } from "../lib/store";
import { shapePart } from "../lib/demo";
import { fmt } from "../lib/geom";
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
  const [addOpen, setAddOpen] = useState(false);
  const placed = useMemo(() => {
    const map = new Map<string, number>();
    for (const pl of doc.placements) map.set(pl.partId, (map.get(pl.partId) || 0) + 1);
    return map;
  }, [doc.placements]);

  const selectPart = (part: Part) => {
    const pl = doc.placements.find((p) => p.partId === part.id);
    dispatch({
      type: "SELECT",
      partIds: [part.id],
      placementIds: pl ? [pl.id] : [],
    });
    if (pl) dispatch({ type: "SET_PAGE", page: pl.page });
  };

  const addShape = (kind: "rect" | "circle" | "hex" | "star") => {
    const part = shapePart(kind, kind === "rect" ? 60 : 50, kind === "rect" ? 40 : 50);
    dispatch({ type: "ADD_SHAPE", shape: part });
    dispatch({ type: "TOAST", text: `${part.name} añadido a la plancha.` });
    setAddOpen(false);
  };

  return (
    <div className="panel-stack">
      <div className="panel-head">
        <div>
          <h2>Piezas</h2>
          <p>{doc.parts.length} diseño{doc.parts.length === 1 ? "" : "s"} · {doc.placements.length} colocada{doc.placements.length === 1 ? "" : "s"}</p>
        </div>
        <Badge kind="neutral">{doc.parts.length}</Badge>
      </div>

      <div className="import-row">
        <button type="button" className="import-card primary" onClick={() => dispatch({ type: "SET_UI", patch: { showSvgDialog: true } })}>
          <span className="import-icon"><Icon name="layers" size={22} /></span>
          <b>Importar SVG</b>
          <em>Separa grupos y capas</em>
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

      <div className="parts-list">
        {!doc.parts.length && (
          <div className="panel-empty">
            <Icon name="cat" size={36} />
            <p>Aún no hay piezas. Importa un SVG o crea una forma para empezar.</p>
            <Button size="sm" variant="secondary" icon="sparkles" onClick={() => {
              const parts = [shapePart("hex", 70, 70), shapePart("star", 45, 45)];
              dispatch({ type: "ADD_PARTS", parts });
            }}>
              Añadir ejemplo rápido
            </Button>
          </div>
        )}
        {doc.parts.map((part) => {
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

      {doc.parts.length > 0 && (
        <div className="panel-actions">
          <Button
            size="sm"
            variant="ghost"
            icon="trash"
            onClick={() => {
              dispatch({ type: "CLEAR" });
              dispatch({ type: "TOAST", text: "Plancha vaciada. Ctrl+Z para recuperar.", kind: "warn" });
            }}
          >
            Vaciar plancha
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="sparkles"
            onClick={() => {
              const parts = [shapePart("hex", 70, 70), shapePart("star", 45, 45)];
              dispatch({ type: "ADD_PARTS", parts });
            }}
          >
            Añadir ejemplo
          </Button>
        </div>
      )}

      <div className="panel-tip">
        <Icon name="magnet" size={15} />
        <div>
          <b>Atajos:</b> arrastra para mover (0,5 mm), <kbd>Mayús</kbd> para varios, <kbd>R</kbd> gira 90°,
          <kbd>Ctrl</kbd>+<kbd>D</kbd> duplica.
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef } from "react";
import type { Dispatch } from "react";
import type { Doc, SelectionState, SheetStats } from "../../types";
import type { Action } from "../../lib/store";
import { formatDuration } from "../../lib/laser";
import { Board } from "../Board";
import { WoodCanvas } from "../WoodCanvas";
import { Wood3DCanvas } from "../Wood3DCanvas";
import type { Wood3DOptions } from "../../lib/wood3d";
import { Icon } from "../UI";

export function ViewerShell({
  doc,
  dispatch,
  selection,
  stats,
  page,
  pages,
  zoom,
  setZoom,
  showGrid,
  setShowGrid,
  view,
  setView,
  wood3dOptions,
  missing,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onOptimize,
  onSaveProject,
  onExport,
  onOpenProject,
  onDropFiles,
  previewOptions,
  onNeedHelp,
}: {
  doc: Doc;
  dispatch: Dispatch<Action>;
  selection: SelectionState;
  stats: SheetStats;
  page: number;
  pages: number;
  zoom: number;
  setZoom: (z: number | ((z: number) => number)) => void;
  showGrid: boolean;
  setShowGrid: (v: boolean) => void;
  view: "plan" | "wood" | "wood3d";
  setView: (v: "plan" | "wood" | "wood3d") => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onOptimize: () => void;
  onSaveProject: () => void;
  onExport: () => void;
  onOpenProject: () => void;
  onDropFiles: (files: File[]) => void;
  previewOptions: Parameters<typeof WoodCanvas>[0]["options"];
  wood3dOptions: Wood3DOptions;
  missing: number;
  onNeedHelp: () => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      setZoom((z) => Math.max(0.5, Math.min(6, z * factor)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setZoom]);

  return (
    <div className="viewer">
      <div className="viewer-top">
        <div className="view-group">
          <button type="button" className={view === "plan" ? "on" : ""} onClick={() => setView("plan")} title="Ver la plancha y mover piezas">
            <Icon name="grid" size={14} /> Plancha
          </button>
          <button type="button" className={view === "wood" ? "on" : ""} onClick={() => setView("wood")} title="Simulación en madera">
            <Icon name="wood" size={14} /> Madera
          </button>
          <button type="button" className={view === "wood3d" ? "on" : ""} onClick={() => setView("wood3d")} title="Ver la madera en 3D, con grosor y piezas retiradas">
            <Icon name="shapes" size={14} /> 3D
          </button>
        </div>
        <button type="button" className={showGrid ? "soft-on" : ""} onClick={() => setShowGrid(!showGrid)} title="Mostrar u ocultar la cuadrícula">
          <Icon name="ruler" size={14} /> Cuadrícula
        </button>
        <button
          type="button"
          onClick={() => {
            setZoom((z) => (z > 1.01 ? 1 : 1.6));
          }}
          title="Acercar o encuadrar"
        >
          <Icon name="fit" size={14} /> {Math.round(zoom * 100)}%
        </button>
        {pages > 1 && (
          <button type="button" onClick={() => dispatch({ type: "SET_PAGE", page: (page + 1) % pages })} title="Cambiar de plancha">
            <Icon name="layers" size={14} /> {page + 1}/{pages}
          </button>
        )}
      </div>

      <div className="canvas" ref={canvasRef}>
        {view === "plan" ? (
          <Board
            doc={doc}
            dispatch={dispatch}
            selection={selection}
            page={page}
            zoom={zoom}
            showGrid={showGrid}
            onDropFiles={onDropFiles}
          />
        ) : view === "wood3d" ? (
          <Wood3DCanvas doc={doc} page={page} options={wood3dOptions} />
        ) : (
          <WoodCanvas doc={doc} page={page} options={previewOptions} />
        )}

        <div className="viewer-floating">
          <div className="left">
            <button type="button" title="Deshacer (Ctrl+Z)" onClick={onUndo} disabled={!canUndo}>
              <Icon name="undo" size={15} />
            </button>
            <button type="button" title="Rehacer (Ctrl+Y)" onClick={onRedo} disabled={!canRedo}>
              <Icon name="redo" size={15} />
            </button>
            <button type="button" title="Ayuda" onClick={onNeedHelp}>
              <Icon name="help" size={15} />
            </button>
          </div>
          <div className="right">
            <button type="button" title="Acercar" onClick={() => setZoom((z) => Math.min(6, z + 0.2))}>+</button>
            <span className="zoom-label">{Math.round(zoom * 100)}%</span>
            <button type="button" title="Alejar" onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))}>−</button>
            <button type="button" title="Encuadrar (F)" onClick={() => setZoom(1)}>
              <Icon name="fit" size={14} />
            </button>
          </div>
        </div>

        {missing > 0 && (
          <div className="unplaced-banner" role="alert">
            <span>⚠ {missing} pieza{missing === 1 ? "" : "s"} sin colocar. Pulsa Optimizar para colocarlas.</span>
            <button type="button" className="cc-btn" onClick={onOptimize}>Recolocar</button>
          </div>
        )}
      </div>

      <div className="viewer-bottom">
        <div className="optimize-row">
          <button type="button" className="optimize-btn" onClick={onOptimize} title="Recolocar todas las piezas y figuras">
            ✦ Optimizar ✦
          </button>
        </div>
        <div className="save-row">
          <input
            className="cc-input"
            value={doc.name}
            onChange={(e) => dispatch({ type: "RENAME", name: e.target.value })}
            placeholder="Nombre del proyecto"
            title="Nombre del proyecto"
          />
          <button type="button" className="cc-btn" onClick={onOpenProject} title="Abrir proyecto o figura .json">
            <Icon name="folder" size={14} />
          </button>
          <button type="button" className="cc-btn" onClick={onSaveProject} title="Descargar proyecto .json">
            <Icon name="save" size={14} /> Guardar
          </button>
          <button type="button" className="cc-btn primary" onClick={onExport} title="Exportar SVG en mm y ZIP para LightBurn">
            <Icon name="download" size={14} /> Exportar
          </button>
        </div>
        <div className="viewer-stats">
          <span><b>{Math.round(stats.efficiency * 100)}%</b> aprovechamiento</span>
          <span><b>{stats.placed}</b> piezas</span>
          <span><b>{pages}</b> plancha{pages === 1 ? "" : "s"}</span>
          <span><b>{formatDuration(stats.timeSeconds)}</b> estimado</span>
          <span style={{ marginLeft: "auto" }}>
            <span className={`dot ${missing ? "off" : ""}`} style={{ width: 8, height: 8, background: missing ? "var(--danger)" : "#6ecf8a", borderRadius: "50%", display: "inline-block", marginRight: 4 }} />
            {missing ? `${missing} sin colocar` : "Todo dentro del margen"}
          </span>
        </div>
      </div>
    </div>
  );
}

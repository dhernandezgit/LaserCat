import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Doc } from "./types";
import {
  createInitialState,
  reducer,
  saveStoredDoc,
} from "./lib/store";
import { computeStats, MACHINE_BY_ID } from "./lib/laser";
import { downloadText, pickFiles, readFileText, safeFileName } from "./lib/download";
import { Header } from "./components/Header";
import { PartsPanel } from "./components/PartsPanel";
import { SheetPanel } from "./components/SheetPanel";
import { GrabadoPanel } from "./components/GrabadoPanel";
import { MaterialPanel } from "./components/MaterialPanel";
import { Inspector } from "./components/Inspector";
import { Board } from "./components/Board";
import { WoodCanvas } from "./components/WoodCanvas";
import { StatsBar } from "./components/StatsBar";
import { SvgImportDialog } from "./components/SvgImportDialog";
import { ImageImportDialog } from "./components/ImageImportDialog";
import { ExportDialog } from "./components/ExportDialog";
import { HelpDialog } from "./components/HelpDialog";
import { Button, Icon, IconButton, Segmented } from "./components/UI";

type Tab = "diseno" | "plancha" | "grabado" | "material";
type MobilePanel = "panel" | "settings" | null;

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [saved, setSaved] = useState(true);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const warnedQuota = useRef(false);
  const { doc, ui, selection } = state;

  const stats = useMemo(() => computeStats(doc), [doc]);
  const pages = Math.max(1, ...doc.placements.map((p) => p.page + 1));
  const currentPage = Math.min(ui.page, pages - 1);
  const totalCopies = doc.parts.reduce((s, p) => s + p.copies, 0);
  const missing = Math.max(0, totalCopies - doc.placements.length);
  const unplaced = state.lastNest?.unplaced || 0;

  // Autoguardado en el navegador
  useEffect(() => {
    setSaved(false);
    const t = setTimeout(() => {
      const ok = saveStoredDoc(doc);
      setSaved(ok);
      if (!ok && !warnedQuota.current) {
        warnedQuota.current = true;
        dispatch({
          type: "TOAST",
          text: "El proyecto es muy grande para el guardado local. Descarga el JSON para no perderlo.",
          kind: "warn",
        });
      }
    }, 600);
    return () => clearTimeout(t);
  }, [doc]);

  // Cerrar el aviso solo
  useEffect(() => {
    if (!ui.toast) return;
    const t = setTimeout(() => dispatch({ type: "DISMISS_TOAST" }), 4200);
    return () => clearTimeout(t);
  }, [ui.toast]);

  // Encuadrar desde el tablero
  useEffect(() => {
    const fit = () => setZoom(1);
    window.addEventListener("lasercat:fit", fit);
    return () => window.removeEventListener("lasercat:fit", fit);
  }, []);

  const anyDialog = ui.showSvgDialog || ui.showImageDialog || ui.showExportDialog || ui.showHelpDialog;

  const openProject = async () => {
    const [f] = await pickFiles(".json,application/json");
    if (!f) return;
    try {
      const text = await readFileText(f);
      const parsed = JSON.parse(text);
      dispatch({ type: "LOAD_PROJECT", doc: parsed });
      setZoom(1);
    } catch {
      dispatch({ type: "TOAST", text: "No se pudo leer el proyecto JSON.", kind: "error" });
    }
  };

  const saveProject = () => {
    const json = JSON.stringify({ ...doc, updatedAt: Date.now() }, null, 2);
    downloadText(`${safeFileName(doc.name, "lasercat")}.json`, json, "application/json");
    dispatch({ type: "TOAST", text: "Proyecto descargado.", kind: "ok" });
  };

  // Atajos de teclado
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (anyDialog) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "REDO" : "UNDO" });
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        dispatch({ type: "REDO" });
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveProject();
        return;
      }
      if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void openProject();
        return;
      }
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        dispatch({ type: "SELECT", partIds: doc.parts.map((p) => p.id), placementIds: doc.placements.map((p) => p.id) });
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (selection.placementIds.length) {
          selection.placementIds.forEach((id) => dispatch({ type: "DUPLICATE_PLACEMENT", id }));
        } else if (selection.partIds.length) {
          selection.partIds.forEach((id) => dispatch({ type: "DUPLICATE_PART", id }));
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selection.placementIds.length) {
          e.preventDefault();
          selection.placementIds.forEach((id) => dispatch({ type: "DELETE_PLACEMENT", id }));
        } else if (selection.partIds.length) {
          e.preventDefault();
          dispatch({ type: "REMOVE_PARTS", ids: selection.partIds });
        }
        return;
      }
      if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        selection.placementIds.forEach((id) => dispatch({ type: "ROTATE_PLACEMENT", id, delta: e.shiftKey ? -90 : 90 }));
        return;
      }
      if (e.key === "f") {
        e.preventDefault();
        setZoom(1);
        return;
      }
      if (e.key === "Escape") {
        dispatch({ type: "SELECT", partIds: [], placementIds: [] });
        setMobilePanel(null);
        return;
      }
      if (e.key.startsWith("Arrow") && selection.placementIds.length) {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        const positions = doc.placements
          .filter((p) => selection.placementIds.includes(p.id))
          .map((p) => ({ id: p.id, x: p.x + dx, y: p.y + dy }));
        dispatch({ type: "SET_POSITIONS", positions, key: `nudge-${selection.placementIds.join("-")}` });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyDialog, doc, selection]);

  const onDropFiles = (files: File[]) => {
    if (!files.length) return;
    const svg = files.find((f) => /\.svg$/i.test(f.name) || f.type === "image/svg+xml");
    const img = files.find((f) => /^image\//.test(f.type) && f.type !== "image/svg+xml");
    if (svg) {
      dispatch({ type: "SET_UI", patch: { showSvgDialog: true, pendingSvgFile: svg } });
      if (files.length > 1) dispatch({ type: "TOAST", text: "Los archivos se importan de uno en uno.", kind: "warn" });
      return;
    }
    if (img) {
      dispatch({ type: "SET_UI", patch: { showImageDialog: true, pendingImageFile: img } });
      if (files.length > 1) dispatch({ type: "TOAST", text: "Las imágenes se importan de una en una.", kind: "warn" });
      return;
    }
    dispatch({ type: "TOAST", text: "Formato no reconocido. Usa SVG, PNG, JPG o WEBP.", kind: "warn" });
  };

  const changeTab = (tab: Tab) => {
    dispatch({ type: "SET_UI", patch: { tab, view: tab === "material" ? "wood" : "plan" } });
    setMobilePanel(null);
  };

  const closeSvg = () => dispatch({ type: "SET_UI", patch: { showSvgDialog: false, pendingSvgFile: null } });
  const closeImage = () => dispatch({ type: "SET_UI", patch: { showImageDialog: false, pendingImageFile: null, pendingImageCut: true } });

  const panel =
    ui.tab === "diseno" ? (
      <PartsPanel doc={doc} dispatch={dispatch} selection={selection} />
    ) : ui.tab === "plancha" ? (
      <SheetPanel doc={doc} dispatch={dispatch} />
    ) : ui.tab === "grabado" ? (
      <GrabadoPanel doc={doc} dispatch={dispatch} />
    ) : (
      <MaterialPanel doc={doc} dispatch={dispatch} />
    );

  const previewOptions = useMemo(
    () => ({
      speciesId: doc.settings.previewSpecies,
      power: doc.settings.previewPower,
      speed: doc.settings.previewSpeed,
      passes: doc.settings.previewPasses,
      showCut: true,
      showEngrave: true,
      showGuides: true,
    }),
    [doc.settings.previewSpecies, doc.settings.previewPower, doc.settings.previewSpeed, doc.settings.previewPasses],
  );

  return (
    <div className="app">
      <Header
        doc={doc}
        dispatch={dispatch}
        canUndo={state.past.length > 0}
        canRedo={state.future.length > 0}
        saved={saved}
        activeTab={ui.tab}
        onOpenProject={openProject}
        onExport={() => dispatch({ type: "SET_UI", patch: { showExportDialog: true } })}
        onHelp={() => dispatch({ type: "SET_UI", patch: { showHelpDialog: true } })}
        onTab={changeTab}
      />

      <div className="app-body">
        <aside className="sidebar">
          <div className="sidebar-scroll">{panel}</div>
          <div className="sidebar-foot">
            <span>LaserCat · {(MACHINE_BY_ID[doc.settings.machineId] || MACHINE_BY_ID.s30).name}</span>
            <span>todo local</span>
          </div>
        </aside>

        <main className="stage">
          <div className="stage-top">
            <div className="stage-left">
              <Segmented
                value={ui.view}
                onChange={(v) => dispatch({ type: "SET_UI", patch: { view: v } })}
                options={[
                  { value: "plan", label: "Plancha" },
                  { value: "wood", label: "Madera" },
                ]}
              />
              {pages > 1 && (
                <div className="page-nav">
                  <IconButton icon="chevron" className="flip" size={15} title="Plancha anterior" disabled={currentPage === 0} onClick={() => dispatch({ type: "SET_PAGE", page: currentPage - 1 })} />
                  <span>Plancha {currentPage + 1} / {pages}</span>
                  <IconButton icon="chevron" size={15} title="Plancha siguiente" disabled={currentPage >= pages - 1} onClick={() => dispatch({ type: "SET_PAGE", page: currentPage + 1 })} />
                </div>
              )}
              <Button size="sm" variant="ghost" icon="sparkles" onClick={() => dispatch({ type: "NEST" })}>
                Optimizar
              </Button>
            </div>

            <div className="stage-right">
              <div className="view-tools">
                <IconButton icon="grid" title={showGrid ? "Ocultar cuadrícula" : "Mostrar cuadrícula"} active={showGrid} onClick={() => setShowGrid(!showGrid)} />
                <IconButton icon="minus" title="Alejar" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, Math.round((z - 0.5) * 10) / 10))} />
                <span className="zoom-label">{Math.round(zoom * 100)} %</span>
                <IconButton icon="plus" title="Acercar" disabled={zoom >= 5} onClick={() => setZoom((z) => Math.min(5, Math.round((z + 0.5) * 10) / 10))} />
                <IconButton icon="fit" title="Encuadrar (F)" onClick={() => setZoom(1)} />
              </div>
              <div className="mobile-tools">
                <Button size="sm" variant="secondary" icon="layers" onClick={() => setMobilePanel("panel")}>Piezas</Button>
                <Button size="sm" variant="secondary" icon="settings" onClick={() => setMobilePanel("settings")}>Ajustes</Button>
              </div>
            </div>
          </div>

          <div className={`stage-canvas ${ui.view === "wood" ? "wood-mode" : ""}`}>
            {ui.view === "plan" ? (
              <Board
                doc={doc}
                dispatch={dispatch}
                selection={selection}
                page={currentPage}
                zoom={zoom}
                showGrid={showGrid}
                onDropFiles={onDropFiles}
              />
            ) : (
              <WoodCanvas doc={doc} page={currentPage} options={previewOptions} />
            )}
          </div>

          <StatsBar
            stats={stats}
            missing={missing}
            unplaced={unplaced}
            onExport={() => dispatch({ type: "SET_UI", patch: { showExportDialog: true } })}
          />
        </main>

        <Inspector doc={doc} dispatch={dispatch} selection={selection} />
      </div>

      <SvgImportDialog open={ui.showSvgDialog} initialFile={ui.pendingSvgFile} dispatch={dispatch} onClose={closeSvg} />
      <ImageImportDialog
        open={ui.showImageDialog}
        initialFile={ui.pendingImageFile}
        initialMode={ui.pendingImageMode}
        initialCut={ui.pendingImageCut}
        engraveOutput={doc.settings.engraveOutput}
        dotsPerMm={doc.settings.ditherDotsPerMm}
        dispatch={dispatch}
        onClose={closeImage}
      />
      <ExportDialog open={ui.showExportDialog} doc={doc} dispatch={dispatch} onClose={() => dispatch({ type: "SET_UI", patch: { showExportDialog: false } })} />
      <HelpDialog open={ui.showHelpDialog} doc={doc} onClose={() => dispatch({ type: "SET_UI", patch: { showHelpDialog: false } })} />

      {mobilePanel && (
        <div className="mobile-drawer-wrap" onClick={(e) => { if (e.target === e.currentTarget) setMobilePanel(null); }}>
          <div className="mobile-drawer">
            <div className="drawer-head">
              <b>{mobilePanel === "settings" ? "Ajustes" : (["diseno", "plancha", "grabado", "material"].includes(ui.tab) ? { diseno: "Piezas", plancha: "Plancha", grabado: "Grabado", material: "Material" }[ui.tab] : "Panel")}</b>
              <IconButton icon="x" title="Cerrar" onClick={() => setMobilePanel(null)} />
            </div>
            <div className="drawer-body">
              {mobilePanel === "panel" ? panel : <Inspector doc={doc} dispatch={dispatch} selection={selection} />}
            </div>
          </div>
        </div>
      )}

      {ui.toast && (
        <div className={`toast toast-${ui.toast.kind}`} role="status">
          <Icon name={ui.toast.kind === "error" || ui.toast.kind === "warn" ? "alert" : "check"} size={16} />
          <span>{ui.toast.text}</span>
          <button type="button" onClick={() => dispatch({ type: "DISMISS_TOAST" })} aria-label="Cerrar aviso">
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

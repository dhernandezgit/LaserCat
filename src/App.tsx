import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Assembly, Doc, Part } from "./types";
import {
  createInitialState,
  reducer,
  saveStoredDoc,
  normalizeDoc,
} from "./lib/store";
import { computeStats } from "./lib/laser";
import { pickFiles, readFileText, downloadText, downloadBytes, safeFileName } from "./lib/download";
import { buildGroupZip, cloneSavedGroup, groupJson, groupParts, groupThumbnail, notifyGroupsChanged, saveGroupToLibrary } from "./lib/groupLibrary";
import { applyTheme, themeRecorded } from "./lib/themes";
import { buildTestCard, testCardReadme } from "./lib/testcard";
import { makeZip } from "./lib/export";
import { svgFileToParts, imageFileToPart } from "./lib/autoImport";
import { DesignPanel } from "./components/shell/DesignPanel";
import { ViewerShell } from "./components/shell/ViewerShell";
import { SettingsShell } from "./components/shell/SettingsShell";
import { StatusShell } from "./components/shell/StatusShell";
import { WelcomeDialog, useWelcome } from "./components/shell/WelcomeDialog";
import { GroupLibraryDialog } from "./components/shell/GroupLibraryDialog";
import { SvgImportDialog } from "./components/SvgImportDialog";
import { ImageImportDialog } from "./components/ImageImportDialog";
import { ExportDialog } from "./components/ExportDialog";
import { HelpDialog } from "./components/HelpDialog";
import { WoodCompareDialog } from "./components/WoodCompareDialog";
import { Icon } from "./components/UI";

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [theme, setTheme] = useState(() => themeRecorded().key);
  const [busy, setBusy] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [helpSection, setHelpSection] = useState<"inicio" | "svg" | "pegatinas" | "lightburn" | "materiales" | "atajos" | "creditos">("inicio");
  const [leftW, setLeftW] = useState(31);
  const [centerW, setCenterW] = useState(34);
  const warnedQuota = useRef(false);
  const welcome = useWelcome();
  const { doc, ui, selection } = state;
  const previewOptions = useMemo(
    () => ({
      speciesId: doc.settings.previewSpecies,
      burnTone: doc.settings.previewBurnTone,
      power: doc.settings.previewPower,
      speed: doc.settings.previewSpeed,
      passes: doc.settings.previewPasses,
      showCut: true,
      showEngrave: true,
      showGuides: true,
    }),
    [doc.settings.previewSpecies, doc.settings.previewBurnTone, doc.settings.previewPower, doc.settings.previewSpeed, doc.settings.previewPasses],
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const wood3dOptions = useMemo(
    () => ({ ...previewOptions, depthMm: doc.settings.wood3dDepth ?? 3 }),
    [previewOptions, doc.settings.wood3dDepth],
  );

  const stats = useMemo(() => computeStats(doc), [doc]);
  const pages = Math.max(1, ...doc.placements.map((p) => p.page + 1));
  const page = Math.min(ui.page, pages - 1);
  const groups = doc.groups || [];
  const groupedPartIds = new Set(groups.flatMap((g) => g.members.map((m) => m.partId)));
  const wantedPieces = doc.parts.reduce((sum, p) => sum + (groupedPartIds.has(p.id) ? 0 : Math.max(0, p.copies)), 0) +
    groups.reduce((sum, g) => sum + g.members.length * Math.max(0, g.copies), 0);
  const missing = Math.max(0, wantedPieces - doc.placements.length);
  const anyDialog =
    ui.showSvgDialog || ui.showImageDialog || ui.showExportDialog || ui.showHelpDialog ||
    compareOpen || welcome.visible || libraryOpen;

  // Autoguardado local
  useEffect(() => {
    const t = setTimeout(() => {
      const ok = saveStoredDoc(doc);
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

  useEffect(() => {
    if (!ui.toast) return;
    const t = setTimeout(() => dispatch({ type: "DISMISS_TOAST" }), 4200);
    return () => clearTimeout(t);
  }, [ui.toast]);

  const openProject = async () => {
    const [f] = await pickFiles(".json,application/json");
    if (!f) return;
    try {
      const text = await readFileText(f);
      const parsed = JSON.parse(text);
      if (parsed?.format === "lasercat-group" && parsed.group && Array.isArray(parsed.parts)) {
        const clean = normalizeDoc({
          version: 1,
          name: parsed.name || "Figura",
          parts: parsed.parts,
          placements: [],
          sheet: { width: 300, height: 300, margin: 5 },
          settings: {},
        });
        if (!clean) throw new Error("Figura no válida");
        const cloned = cloneSavedGroup({
          id: parsed.group.id || "saved",
          name: parsed.name || parsed.group.name || "Figura",
          createdAt: Date.now(),
          parts: clean.parts,
          group: parsed.group,
        });
        dispatch({ type: "ADD_PARTS", parts: cloned.parts, groups: [cloned.group] });
        dispatch({ type: "TOAST", text: `Figura «${cloned.group.name}» cargada.`, kind: "ok" });
        return;
      }
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

  const optimize = useCallback(() => {
    setBusy(true);
    window.setTimeout(() => {
      dispatch({ type: "NEST" });
      setBusy(false);
    }, 40);
  }, []);

  const onDropFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    const parts: Part[] = [];
    const groups: Assembly[] = [];
    let added = 0;
    try {
      for (const file of files) {
        const isSvg = /\.svg$/i.test(file.name) || file.type === "image/svg+xml";
        try {
          if (isSvg) {
            const payload = await svgFileToParts(file);
            parts.push(...payload.parts);
            groups.push(...payload.groups);
            added++;
          } else if (/^image\//.test(file.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) {
            const part = await imageFileToPart(file, doc.settings.imageDropMode || "cut");
            parts.push(part);
            added++;
          }
        } catch (e: any) {
          dispatch({ type: "TOAST", text: `${file.name}: ${e?.message || "no se pudo importar"}`, kind: "warn" });
        }
      }
      if (parts.length) {
        dispatch({ type: "ADD_PARTS", parts, groups, nest: true });
        dispatch({
          type: "TOAST",
          text: `${added} archivo${added === 1 ? "" : "s"} añadido${added === 1 ? "" : "s"}${groups.length ? ` en ${groups.length} figura${groups.length === 1 ? "" : "s"}` : ""} y colocado${added === 1 ? "" : "s"}.`,
          kind: "ok",
        });
      }
    } finally {
      setBusy(false);
    }
  }, [doc.settings.imageDropMode]);

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
      text: ok ? "Figura guardada con sus imágenes (biblioteca + JSON)." : "JSON descargado, pero la biblioteca local está llena.",
      kind: ok ? "ok" : "warn",
    });
  };

  const exportGroup = (group: Assembly) => {
    const bundle = buildGroupZip(doc, group);
    if (!bundle) {
      dispatch({ type: "TOAST", text: "No se pudo preparar la figura.", kind: "error" });
      return;
    }
    downloadBytes(bundle.name, bundle.bytes);
    dispatch({ type: "TOAST", text: "Figura exportada con SVG, imágenes y LEEME.", kind: "ok" });
  };

  const downloadTestCard = () => {
    const card = buildTestCard(doc);
    const zip = makeZip([
      { name: "tarjeta-pruebas-grabado.svg", data: card.svg },
      { name: "tarjeta-pruebas-ajustes.csv", data: card.csv },
      { name: "LEEME-tarjeta.txt", data: testCardReadme(doc, card) },
    ]);
    downloadBytes(`${safeFileName(doc.name, "lasercat")}-tarjeta-pruebas.zip`, zip);
    dispatch({ type: "TOAST", text: "Tarjeta de pruebas descargada: SVG + ajustes CSV.", kind: "ok" });
  };

  const report = () => {
    const body = [
      "Describe aquí el problema:",
      "",
      "---",
      `Proyecto: ${doc.name}`,
      `Piezas: ${doc.parts.length}`,
      `Planchas: ${pages}`,
      `Máquina: ${doc.settings.machineId}`,
      `Material: ${doc.settings.materialId}`,
      `Navegador: ${navigator.userAgent}`,
      `Fecha: ${new Date().toISOString()}`,
    ].join("\n");
    window.open(
      `https://github.com/dhernandezgit/LaserCat/issues/new?title=${encodeURIComponent("[Bug] ")}&body=${encodeURIComponent(body)}`,
      "_blank",
      "noopener",
    );
  };

  const support = () => window.open("https://github.com/dhernandezgit/LaserCat", "_blank", "noopener");
  const openHelp = (section: typeof helpSection = "inicio") => {
    setHelpSection(section);
    dispatch({ type: "SET_UI", patch: { showHelpDialog: true } });
  };
  const detailedHelp = () => {
    welcome.cerrar();
    openHelp("inicio");
  };

  // Atajos
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
      if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (selection.placementIds.length >= 2) {
          dispatch({ type: "GROUP_PLACEMENTS", placementIds: selection.placementIds, name: "Figura" });
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
        if (selection.placementIds.length) {
          dispatch({ type: "ROTATE_SELECTION", placementIds: selection.placementIds, delta: e.shiftKey ? -90 : 90 });
        }
        return;
      }
      if (e.key === "f") {
        e.preventDefault();
        setZoom(1);
        return;
      }
      if (e.key === "Escape") {
        dispatch({ type: "SELECT", partIds: [], placementIds: [] });
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

  const startDrag = (which: "left" | "center") => {
    const onMove = (e: MouseEvent) => {
      const total = window.innerWidth;
      const x = (e.clientX / total) * 100;
      if (which === "left") setLeftW(Math.min(42, Math.max(20, x)));
      else setCenterW(Math.min(52, Math.max(24, x - leftW)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const message = busy
    ? "Optimizando…"
    : !doc.parts.length
      ? "Listo para empezar"
      : missing > 0
        ? `No caben todas las piezas: ${missing} sin colocar`
        : `Listo · ${doc.parts.length} pieza${doc.parts.length === 1 ? "" : "s"} en ${pages} plancha${pages === 1 ? "" : "s"}`;

  return (
    <div className="app">
      <div className="main">
        <div className="panel left" style={{ width: `${leftW}%` }}>
          <DesignPanel
            doc={doc}
            dispatch={dispatch}
            selection={selection}
            onDropFiles={onDropFiles}
            onOpenSvgDialog={() => dispatch({ type: "SET_UI", patch: { showSvgDialog: true, pendingSvgFile: null } })}
            onOpenImageDialog={() => dispatch({ type: "SET_UI", patch: { showImageDialog: true, pendingImageFile: null, pendingImageCut: true } })}
            onOpenProject={openProject}
            onSaveGroup={saveGroup}
            onExportGroup={exportGroup}
            onOpenLibrary={() => setLibraryOpen(true)}
          />
        </div>
        <div className="splitter" onMouseDown={() => startDrag("left")} />
        <div className="viewer-wrap" style={{ width: `${centerW}%` }}>
          <ViewerShell
            doc={doc}
            dispatch={dispatch}
            selection={selection}
            stats={stats}
            page={page}
            pages={pages}
            zoom={zoom}
            setZoom={setZoom}
            showGrid={showGrid}
            setShowGrid={setShowGrid}
            view={ui.view}
            setView={(v) => dispatch({ type: "SET_UI", patch: { view: v } })}
            canUndo={state.past.length > 0}
            canRedo={state.future.length > 0}
            onUndo={() => dispatch({ type: "UNDO" })}
            onRedo={() => dispatch({ type: "REDO" })}
            onOptimize={optimize}
            onSaveProject={saveProject}
            onExport={() => dispatch({ type: "SET_UI", patch: { showExportDialog: true } })}
            onOpenProject={openProject}
            onDropFiles={onDropFiles}
            previewOptions={previewOptions}
            wood3dOptions={wood3dOptions}
            missing={missing}
            onNeedHelp={() => welcome.abrir()}
          />
        </div>
        <div className="splitter" onMouseDown={() => startDrag("center")} />
        <div className="panel right" style={{ flex: 1 }}>
          <SettingsShell
            doc={doc}
            dispatch={dispatch}
            theme={theme}
            onTheme={setTheme}
            stats={stats}
            view={ui.view}
            onView={(v) => dispatch({ type: "SET_UI", patch: { view: v } })}
            showGrid={showGrid}
            onShowGrid={setShowGrid}
            onOpenImageDialog={() => dispatch({ type: "SET_UI", patch: { showImageDialog: true, pendingImageFile: null, pendingImageCut: true } })}
            onOpenSvgDialog={() => dispatch({ type: "SET_UI", patch: { showSvgDialog: true, pendingSvgFile: null } })}
            onCompare={() => setCompareOpen(true)}
            onTestCard={downloadTestCard}
            onHelp={() => openHelp("inicio")}
            onReport={report}
            onOptimize={optimize}
            onOpenLibrary={() => setLibraryOpen(true)}
            previewOptions={previewOptions}
          />
        </div>
      </div>

      <StatusShell
        doc={doc}
        stats={stats}
        message={message}
        busy={busy}
        progress={0.6}
        onHelp={() => welcome.abrir()}
        onReport={report}
        onSupport={support}
      />

      <SvgImportDialog
        open={ui.showSvgDialog}
        initialFile={ui.pendingSvgFile}
        dispatch={dispatch}
        onClose={() => dispatch({ type: "SET_UI", patch: { showSvgDialog: false, pendingSvgFile: null } })}
      />
      <ImageImportDialog
        open={ui.showImageDialog}
        initialFile={ui.pendingImageFile}
        initialMode={ui.pendingImageMode}
        initialCut={ui.pendingImageCut}
        engraveOutput={doc.settings.engraveOutput}
        dotsPerMm={doc.settings.ditherDotsPerMm}
        dispatch={dispatch}
        onClose={() => dispatch({ type: "SET_UI", patch: { showImageDialog: false, pendingImageFile: null, pendingImageCut: true } })}
      />
      <ExportDialog
        open={ui.showExportDialog}
        doc={doc}
        dispatch={dispatch}
        onClose={() => dispatch({ type: "SET_UI", patch: { showExportDialog: false } })}
      />
      <HelpDialog
        open={ui.showHelpDialog}
        doc={doc}
        initialSection={helpSection}
        onClose={() => dispatch({ type: "SET_UI", patch: { showHelpDialog: false } })}
      />
      <WoodCompareDialog open={compareOpen} doc={doc} options={previewOptions} onClose={() => setCompareOpen(false)} />
      <GroupLibraryDialog open={libraryOpen} onClose={() => setLibraryOpen(false)} dispatch={dispatch} />
      <WelcomeDialog
        open={welcome.visible}
        onClose={welcome.cerrar}
        onDetailedHelp={detailedHelp}
        onLightBurn={() => { welcome.cerrar(); openHelp("lightburn"); }}
      />

      {ui.toast && (
        <div className={`toast toast-${ui.toast.kind}`} role="status">
          <Icon name={ui.toast.kind === "error" || ui.toast.kind === "warn" ? "alert" : "check"} size={15} />
          <span>{ui.toast.text}</span>
          <button type="button" onClick={() => dispatch({ type: "DISMISS_TOAST" })} aria-label="Cerrar aviso">
            <Icon name="x" size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

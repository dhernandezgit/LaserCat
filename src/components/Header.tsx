import { useEffect, useRef, useState } from "react";
import type { Dispatch } from "react";
import type { Doc } from "../types";
import type { Action } from "../lib/store";
import { downloadText, safeFileName } from "../lib/download";
import { THEMES } from "../lib/themes";
import { Button, Icon, IconButton } from "./UI";

const TABS = [
  { id: "diseno", label: "Diseño", icon: "layers" as const },
  { id: "plancha", label: "Plancha", icon: "grid" as const },
  { id: "grabado", label: "Grabado", icon: "engrave" as const },
  { id: "material", label: "Material", icon: "wood" as const },
] as const;

function ProjectName({ doc, dispatch }: { doc: Doc; dispatch: Dispatch<Action> }) {
  const [name, setName] = useState(doc.name);
  useEffect(() => setName(doc.name), [doc.name]);
  return (
    <input
      className="project-name"
      value={name}
      aria-label="Nombre del proyecto"
      spellCheck={false}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => {
        const v = name.trim() || "Sin título";
        setName(v);
        if (v !== doc.name) dispatch({ type: "RENAME", name: v });
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { setName(doc.name); e.currentTarget.blur(); }
      }}
    />
  );
}

export function Header({
  doc,
  dispatch,
  canUndo,
  canRedo,
  saved,
  activeTab,
  theme,
  onTheme,
  onOpenProject,
  onExport,
  onHelp,
  onTab,
}: {
  doc: Doc;
  dispatch: Dispatch<Action>;
  canUndo: boolean;
  canRedo: boolean;
  saved: boolean;
  activeTab: "diseno" | "plancha" | "grabado" | "material";
  theme: string;
  onTheme: (id: string) => void;
  onOpenProject: () => void;
  onExport: () => void;
  onHelp: () => void;
  onTab: (tab: "diseno" | "plancha" | "grabado" | "material") => void;
}) {
  const saveProject = () => {
    const json = JSON.stringify({ ...doc, updatedAt: Date.now() }, null, 2);
    downloadText(`${safeFileName(doc.name, "lasercat")}.json`, json, "application/json");
  };

  const [themeOpen, setThemeOpen] = useState(false);
  const themeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!themeOpen) return;
    const close = (e: MouseEvent) => {
      if (themeRef.current && !themeRef.current.contains(e.target as Node)) setThemeOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [themeOpen]);

  return (
    <header className="app-header">
      <div className="brand">
        <button type="button" className="brand-logo" onClick={onHelp} title="Acerca de LaserCat">
          <img src={`${import.meta.env.BASE_URL}icon.png`} alt="LaserCat" />
        </button>
        <div className="brand-text">
          <div className="brand-line">
            <h1>LaserCat</h1>
            <span className="version">v1.0</span>
          </div>
          <span className="tagline">taller de corte y grabado láser</span>
        </div>
      </div>

      <div className="project-block">
        <ProjectName doc={doc} dispatch={dispatch} />
        <span className={`save-dot ${saved ? "ok" : ""}`}>
          <i /> {saved ? "guardado en este navegador" : "guardando…"}
        </span>
      </div>

      <nav className="main-tabs" aria-label="Secciones">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab-btn ${t.id === activeTab ? "active" : ""}`}
            onClick={() => onTab(t.id)}
          >
            <Icon name={t.icon} size={16} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <div className="header-actions">
        <div className="history-buttons">
          <IconButton icon="undo" title="Deshacer (Ctrl+Z)" disabled={!canUndo} onClick={() => dispatch({ type: "UNDO" })} />
          <IconButton icon="redo" title="Rehacer (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => dispatch({ type: "REDO" })} />
        </div>
        <IconButton icon="folder" title="Abrir proyecto o figura (.json)" onClick={onOpenProject} />
        <IconButton icon="save" title="Descargar proyecto (.json)" onClick={saveProject} />
        <div className="theme-picker" ref={themeRef}>
          <IconButton icon="palette" title="Cambiar tema" active={themeOpen} onClick={() => setThemeOpen(!themeOpen)} />
          {themeOpen && (
            <div className="theme-menu">
              <div className="theme-menu-title">Tema</div>
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`theme-option ${theme === t.id ? "active" : ""}`}
                  onClick={() => { onTheme(t.id); setThemeOpen(false); }}
                >
                  <span className="theme-swatches">
                    {t.swatch.map((c) => <i key={c} style={{ background: c }} />)}
                  </span>
                  <span className="theme-name">
                    <b>{t.name}</b>
                    <em>{t.description}</em>
                  </span>
                  {theme === t.id && <Icon name="check" size={14} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <IconButton icon="help" title="Ayuda y guía LightBurn" onClick={onHelp} />
        <Button variant="primary" icon="download" size="md" className="export-btn" onClick={onExport}>
          Exportar
        </Button>
      </div>
    </header>
  );
}

export { TABS };

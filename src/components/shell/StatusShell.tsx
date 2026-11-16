import type { Doc } from "../../types";
import { Icon } from "../UI";

export function StatusShell({
  doc,
  message,
  busy,
  onHelp,
  onReport,
  onSupport,
  progress,
}: {
  doc: Doc;
  message: string;
  busy?: boolean;
  onHelp: () => void;
  onReport: () => void;
  onSupport: () => void;
  progress?: number;
}) {
  const icon = `${import.meta.env.BASE_URL}icon.png`;
  return (
    <div className="statusbar">
      <div className="brand" title="LaserCat">
        <img src={icon} alt="LaserCat" />
        <span className="nombre">LaserCat</span>
      </div>
      <div className="center">
        <span className="msg">{busy ? "Optimizando…" : message}</span>
        {busy && (
          <span className="progress" title="Progreso de la optimización">
            <div style={{ width: `${Math.round(Math.max(0.05, Math.min(1, progress ?? 0.35)) * 100)}%` }} />
          </span>
        )}
      </div>
      <div className="right">
        <button className="app-info" onClick={onHelp} title="Guía rápida y pasos para LightBurn">
          <Icon name="help" size={13} /> Cómo usar
        </button>
        <button className="app-info" onClick={onReport} title="Abrir un issue de GitHub con los datos del proyecto">
          <Icon name="alert" size={13} /> Reportar
        </button>
        <button className="app-info support" onClick={onSupport} title="Ver el repositorio de LaserCat">
          <Icon name="external" size={13} /> Apoyar
        </button>
        <span className="version-chip" title="Versión de LaserCat">v1.0</span>
        <span className="version-chip" title={doc.settings.machineId}>
          <span className="dot" /> {busy ? "Corte" : "Listo"}
        </span>
      </div>
    </div>
  );
}

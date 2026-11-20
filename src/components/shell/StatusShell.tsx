import type { Doc, SheetStats } from "../../types";
import { formatDuration } from "../../lib/laser";
import { Icon } from "../UI";

export function StatusShell({
  doc,
  stats,
  message,
  busy,
  onHelp,
  onReport,
  onSupport,
  progress,
}: {
  doc: Doc;
  stats: SheetStats;
  message: string;
  busy?: boolean;
  onHelp: () => void;
  onReport: () => void;
  onSupport: () => void;
  progress?: number;
}) {
  const icon = `${import.meta.env.BASE_URL}icon.png`;
  const pct = Math.round(Math.max(0.05, Math.min(1, progress ?? 0.35)) * 100);
  return (
    <div className="statusbar">
      <div className="brand" title="LaserCat">
        <img src={icon} alt="LaserCat" />
        <span className="nombre">LaserCat</span>
      </div>
      <div className="center">
        <span className="msg">{busy ? `Optimizando… ${pct}%` : message}</span>
        {busy && (
          <span className="progress" title={`Progreso de la optimización: ${pct}%`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div style={{ width: `${pct}%` }} />
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
        {stats.placed > 0 && (
          <span className="version-chip" title="Tiempo estimado de corte y grabado">
            <Icon name="flame" size={12} /> {formatDuration(stats.timeSeconds)}
          </span>
        )}
        <span className="version-chip" title="Versión de LaserCat">v1.0</span>
        <span className="version-chip" title={doc.settings.machineId}>
          <span className="dot" /> {busy ? "Corte" : "Listo"}
        </span>
      </div>
    </div>
  );
}

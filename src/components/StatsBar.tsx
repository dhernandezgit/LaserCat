import type { SheetStats } from "../types";
import { formatDuration } from "../lib/laser";
import { Icon, Progress } from "./UI";

export function StatsBar({
  stats,
  missing,
  unplaced,
  onExport,
}: {
  stats: SheetStats;
  missing: number;
  unplaced: number;
  onExport: () => void;
}) {
  const hasWarning = missing > 0 || unplaced > 0;
  return (
    <div className="stats-bar">
      <div className="stats-group">
        <div className="stat">
          <span>Piezas</span>
          <b>{stats.placed}</b>
        </div>
        <div className="stat">
          <span>Planchas</span>
          <b>{stats.pages}</b>
        </div>
        <div className="stat wide">
          <span>Aprovechamiento</span>
          <div className="stat-progress">
            <Progress value={stats.efficiency} />
            <b>{Math.round(stats.efficiency * 100)} %</b>
          </div>
        </div>
        <div className="stat">
          <span>Tiempo</span>
          <b>{formatDuration(stats.timeSeconds)}</b>
        </div>
        <div className="stat hide-sm">
          <span>Corte</span>
          <b>{(stats.cutLength / 1000).toFixed(2)} m</b>
        </div>
        <div className="stat hide-sm">
          <span>Grabado</span>
          <b>{(stats.engraveArea / 10000).toFixed(2)} dm²</b>
        </div>
      </div>

      {hasWarning ? (
        <div className="stat-warning">
          <Icon name="alert" size={15} />
          {unplaced > 0 ? `${unplaced} no caben` : `${missing} sin colocar`}
        </div>
      ) : (
        <div className="stat-ok">
          <Icon name="check" size={15} />
          Todo dentro del margen
        </div>
      )}

      <button type="button" className="stats-export" onClick={onExport}>
        <Icon name="download" size={16} />
        <span>LightBurn</span>
      </button>
    </div>
  );
}

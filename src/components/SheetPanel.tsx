import type { Dispatch } from "react";
import type { Doc, Sheet } from "../types";
import type { Action } from "../lib/store";
import { computeStats, formatDuration, MACHINE_BY_ID } from "../lib/laser";
import { Badge, Button, Field, NumberField, Progress, Segmented, Toggle } from "./UI";

const PRESETS: { label: string; w: number; h: number }[] = [
  { label: "30 × 30", w: 300, h: 300 },
  { label: "40 × 40", w: 400, h: 400 },
  { label: "30 × 20", w: 300, h: 200 },
  { label: "60 × 40", w: 600, h: 400 },
  { label: "A4", w: 210, h: 297 },
  { label: "A3", w: 297, h: 420 },
];

export function SheetPanel({ doc, dispatch }: { doc: Doc; dispatch: Dispatch<Action> }) {
  const s = doc.sheet;
  const stats = computeStats(doc);
  const machine = MACHINE_BY_ID[doc.settings.machineId] || MACHINE_BY_ID.s30;
  const set = (patch: Partial<Sheet>, nest = true) => dispatch({ type: "SET_SHEET", patch, nest });

  return (
    <div className="panel-stack">
      <div className="panel-head">
        <div>
          <h2>Plancha</h2>
          <p>Área de trabajo y optimización</p>
        </div>
        <Badge kind={stats.efficiency > 0.6 ? "ok" : "neutral"}>{Math.round(stats.efficiency * 100)}%</Badge>
      </div>

      <div className="preset-grid">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className={`preset-chip ${Math.abs(s.width - p.w) < 0.01 && Math.abs(s.height - p.h) < 0.01 ? "active" : ""}`}
            onClick={() => set({ width: p.w, height: p.h })}
          >
            {p.label}<small>mm</small>
          </button>
        ))}
      </div>

      <div className="two-col">
        <Field label="Ancho">
          <NumberField value={s.width} min={20} max={2000} step={1} suffix="mm" onChange={(v) => set({ width: v })} />
        </Field>
        <Field label="Alto">
          <NumberField value={s.height} min={20} max={2000} step={1} suffix="mm" onChange={(v) => set({ height: v })} />
        </Field>
      </div>

      <div className="three-col">
        <Field label="Margen" hint="Borde seguro">
          <NumberField value={s.margin} min={0} max={100} step={0.5} suffix="mm" onChange={(v) => set({ margin: v })} />
        </Field>
        <Field label="Separación" hint="Entre piezas">
          <NumberField value={s.spacing} min={0} max={100} step={0.5} suffix="mm" onChange={(v) => set({ spacing: v })} />
        </Field>
        <Field label="Kerf" hint="Grosor del haz">
          <NumberField value={s.kerf} min={0} max={3} step={0.05} suffix="mm" onChange={(v) => set({ kerf: v })} />
        </Field>
      </div>

      {s.width > machine.workWidth || s.height > machine.workHeight ? (
        <div className="inline-warn">
          La plancha supera el área de la {machine.name} ({machine.workWidth}×{machine.workHeight} mm).
        </div>
      ) : null}

      <div className="divider" />

      <Field label="Rotación de las piezas" hint="El optimizador elige el mejor giro por pieza.">
        <Segmented
          value={s.rotation}
          onChange={(v) => set({ rotation: v })}
          options={[
            { value: "no", label: "Sin girar" },
            { value: "90", label: "90°" },
            { value: "libre", label: "Libre" },
          ]}
        />
      </Field>

      <Field label="Calidad de empaquetado" hint="Máxima es la recomendada: menos planchas y más aprovechamiento.">
        <Segmented
          value={s.quality}
          onChange={(v) => set({ quality: v })}
          options={[
            { value: "rapida", label: "Rápida" },
            { value: "equilibrada", label: "Equilibrada" },
            { value: "maxima", label: "Máxima" },
          ]}
        />
      </Field>

      <div className="toggles">
        <Toggle
          checked={s.singlePage}
          onChange={(v) => set({ singlePage: v })}
          label="Solo una plancha"
          hint="No genera planchas extra."
        />
        <Toggle
          checked={doc.settings.autoNest}
          onChange={(v) => dispatch({ type: "SET_SETTINGS", patch: { autoNest: v } })}
          label="Recolocar al cambiar"
          hint="Optimiza automáticamente al importar o cambiar copias."
        />
      </div>

      <Button
        variant="primary"
        size="lg"
        icon="sparkles"
        className="wide"
        onClick={() => dispatch({ type: "NEST" })}
      >
        Optimizar plancha
      </Button>

      <div className="stat-block">
        <div className="stat-line">
          <span>Aprovechamiento</span>
          <b>{Math.round(stats.efficiency * 100)} %</b>
        </div>
        <Progress value={stats.efficiency} />
        <div className="stat-line small">
          <span>{stats.placed} piezas · {stats.pages} plancha{stats.pages === 1 ? "" : "s"}</span>
          <span>{formatDuration(stats.timeSeconds)}</span>
        </div>
      </div>

      <div className="hint-card">
        <b>Cómo aprovechar al máximo</b>
        <ul>
          <li>Margen 5 mm y separación 3 mm son un buen punto de partida.</li>
          <li>Usa <b>Máxima</b> con rotación libre para formas irregulares.</li>
          <li>Fija las piezas que ya te gustan con el pin: se respetan al reoptimizar.</li>
          <li>El kerf se descuenta del corte; la separación ya lo tiene en cuenta.</li>
        </ul>
      </div>
    </div>
  );
}

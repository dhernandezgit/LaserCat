import type { Dispatch } from "react";
import type { Doc } from "../types";
import type { Action } from "../lib/store";
import {
  LAYERS,
  laserPresetFor,
  MACHINE_BY_ID,
  MACHINES,
  MATERIAL_BY_ID,
  MATERIALS,
} from "../lib/laser";
import { Badge, Button, Field, Segmented, Slider } from "./UI";

export function GrabadoPanel({ doc, dispatch }: { doc: Doc; dispatch: Dispatch<Action> }) {
  const machine = MACHINE_BY_ID[doc.settings.machineId] || MACHINE_BY_ID.s30;
  const material = MATERIAL_BY_ID[doc.settings.materialId] || MATERIAL_BY_ID.tilo;
  const cut = laserPresetFor(material.id, "cut", machine.id);
  const eng = laserPresetFor(material.id, "engrave", machine.id);
  const score = laserPresetFor(material.id, "score", machine.id);
  const set = (patch: Partial<typeof doc.settings>) => dispatch({ type: "SET_SETTINGS", patch });

  const openImage = (mode: "threshold" | "grayscale" | "dither") =>
    dispatch({ type: "SET_UI", patch: { showImageDialog: true, pendingImageMode: mode, pendingImageFile: null, pendingImageCut: false } });

  return (
    <div className="panel-stack">
      <div className="panel-head">
        <div>
          <h2>Grabado</h2>
          <p>Máquina, material y capas</p>
        </div>
        <Badge kind="engrave">{machine.watt} W</Badge>
      </div>

      <div className="two-col">
        <Field label="Máquina">
          <select
            className="select"
            value={doc.settings.machineId}
            onChange={(e) => set({ machineId: e.target.value })}
          >
            {MACHINES.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
        <Field label="Material">
          <select
            className="select"
            value={doc.settings.materialId}
            onChange={(e) => set({ materialId: e.target.value })}
          >
            {MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
      </div>

      <div className="preset-summary">
        <div className="preset-head">
          <b>{material.name} · {material.thickness} mm</b>
          <span>{machine.name}</span>
        </div>
        <div className="preset-rows">
          <div><span className="dot dot-cut" /> Corte <b>{cut.power}%</b> · {cut.speed} mm/min · {cut.passes} pas.</div>
          <div><span className="dot dot-engrave" /> Grabado <b>{eng.power}%</b> · {eng.speed} mm/min · {eng.passes} pas.</div>
          <div><span className="dot dot-score" /> Marcado <b>{score.power}%</b> · {score.speed} mm/min</div>
        </div>
        <p>{material.cut.notes}</p>
      </div>

      <Field label="Grabado de imágenes" hint="Elige cómo quieres convertir la imagen en un trabajo láser.">
        <div className="mode-cards">
          <button type="button" className="mode-card" onClick={() => openImage("threshold")}>
            <span className="mode-icon bw" />
            <b>Blanco y negro</b>
            <em>Silueta nítida. Ideal para logos, plantillas y recortes.</em>
          </button>
          <button type="button" className="mode-card" onClick={() => openImage("grayscale")}>
            <span className="mode-icon gray" />
            <b>Grises</b>
            <em>Fotos y retratos con intensidad continua.</em>
          </button>
          <button type="button" className="mode-card" onClick={() => openImage("dither")}>
            <span className="mode-icon dots" />
            <b>Tramado</b>
            <em>Puntos con más contraste y carácter.</em>
          </button>
        </div>
      </Field>

      <Field label="Formato del grabado vectorial" hint="Los vectores se pueden exportar como relleno o como puntos de semitono.">
        <Segmented
          value={doc.settings.engraveOutput}
          onChange={(v) => set({ engraveOutput: v })}
          options={[
            { value: "raster", label: "Mapa de bits" },
            { value: "vector", label: "Puntos" },
          ]}
        />
      </Field>

      {doc.settings.engraveOutput === "vector" && (
        <Slider
          label="Densidad de puntos"
          min={1}
          max={8}
          step={0.5}
          value={doc.settings.ditherDotsPerMm}
          onChange={(v) => set({ ditherDotsPerMm: v })}
          format={(v) => `${v} puntos/mm`}
        />
      )}

      <div className="divider" />

      <div className="section-label">Capas del archivo</div>
      <div className="layer-list">
        {LAYERS.map((l) => (
          <div className="layer-row" key={l.id}>
            <span className="layer-swatch" style={{ background: l.color }} />
            <div>
              <b>{l.name}</b>
              <em>{l.description}</em>
            </div>
          </div>
        ))}
      </div>

      <div className="hint-card">
        <b>LightBurn</b>
        <p>
          Los colores del SVG crean capas separadas. Asigna <b>Relleno</b> a GRABADO y <b>Línea</b> al resto.
          El archivo incluye una hoja de ajustes y un LEEME con el orden recomendado.
        </p>
      </div>

      <Button variant="secondary" icon="image" className="wide" onClick={() => openImage("threshold")}>
        Importar imagen para grabar
      </Button>
    </div>
  );
}

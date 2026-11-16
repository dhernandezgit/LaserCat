import { useMemo, useState } from "react";
import type { Dispatch } from "react";
import type { Doc } from "../types";
import type { Action } from "../lib/store";
import { SPECIES, SPECIES_BY_ID, BURN_TONES } from "../lib/wood";
import { laserPresetFor, MATERIAL_BY_ID, MACHINE_BY_ID } from "../lib/laser";
import { buildTestCard, testCardReadme, type TestCard } from "../lib/testcard";
import { makeZip, svgToDataUrl } from "../lib/export";
import { downloadBytes, safeFileName } from "../lib/download";
import { Button, Field, Slider, Toggle, Badge, Icon } from "./UI";
import { WoodGallery } from "./WoodCanvas";
import { WoodCompareDialog } from "./WoodCompareDialog";

export function MaterialPanel({ doc, dispatch }: { doc: Doc; dispatch: Dispatch<Action> }) {
  const [testCard, setTestCard] = useState<TestCard | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const set = (patch: Partial<typeof doc.settings>) => dispatch({ type: "SET_SETTINGS", patch });
  const options = useMemo(
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
  const sp = SPECIES_BY_ID[doc.settings.previewSpecies] || SPECIES[0];
  const material = MATERIAL_BY_ID[doc.settings.materialId] || MATERIAL_BY_ID.tilo;
  const machine = MACHINE_BY_ID[doc.settings.machineId] || MACHINE_BY_ID.s30;
  const eng = laserPresetFor(material.id, "engrave", machine.id);

  return (
    <div className="panel-stack">
      <div className="panel-head">
        <div>
          <h2>Material</h2>
          <p>Prueba cómo quedará en madera</p>
        </div>
        <Badge kind="neutral">{sp.name}</Badge>
      </div>

      <div className="species-grid">
        {SPECIES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`species-chip ${doc.settings.previewSpecies === s.id ? "active" : ""}`}
            onClick={() => {
              const patch: any = { previewSpecies: s.id };
              if (MATERIAL_BY_ID[s.id]) patch.materialId = s.id;
              set(patch);
            }}
            title={s.name}
          >
            <span className="species-swatch" style={{ background: `linear-gradient(135deg, ${s.light} 0%, ${s.base} 48%, ${s.dark} 100%)` }} />
            <span>{s.name}</span>
          </button>
        ))}
      </div>

      <div className="tone-row">
        <span className="tone-label">Tono del láser</span>
        <div className="tone-swatches">
          {BURN_TONES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tone-swatch ${doc.settings.previewBurnTone === t.id ? "active" : ""}`}
              title={t.name}
              onClick={() => set({ previewBurnTone: t.id })}
            >
              <i style={{ background: t.color }} />
              <span>{t.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="preview-controls">
        <Slider
          label="Intensidad del láser"
          min={5}
          max={100}
          step={1}
          value={doc.settings.previewPower}
          onChange={(v) => set({ previewPower: v })}
          format={(v) => `${v} %`}
        />
        <Slider
          label="Velocidad"
          min={300}
          max={8000}
          step={100}
          value={doc.settings.previewSpeed}
          onChange={(v) => set({ previewSpeed: v })}
          format={(v) => `${v} mm/min`}
        />
        <Slider
          label="Pasadas"
          min={1}
          max={4}
          step={1}
          value={doc.settings.previewPasses}
          onChange={(v) => set({ previewPasses: v })}
          format={(v) => `${v}`}
        />
      </div>

      <div className="quick-actions">
        <Button variant="primary" icon="wood" onClick={() => dispatch({ type: "SET_UI", patch: { view: "wood" } })}>
          Ver a lo grande
        </Button>
        <Button variant="secondary" icon="engrave" onClick={() => set({ previewPower: eng.power, previewSpeed: eng.speed, previewPasses: eng.passes })}>
          Ajustes
        </Button>
      </div>

      <div className="section-label">Diferentes intensidades · {sp.name}</div>
      <WoodGallery doc={doc} base={options} />

      <Button variant="secondary" icon="grid" className="wide" onClick={() => setCompareOpen(true)}>
        Comparar 4 maderas × 4 intensidades
      </Button>

      <div className="testcard-box">
        <div className="section-head">
          <h3>Tarjeta de pruebas</h3>
          <Badge kind="neutral">24 celdas</Badge>
        </div>
        <p>
          6 potencias × 4 velocidades con un color por celda. Al importarla en LightBurn, cada color es una capa:
          el CSV te dice qué ajuste poner en cada una.
        </p>
        {testCard && (
          <div className="testcard-preview">
            <img src={svgToDataUrl(testCard.svg)} alt="Tarjeta de pruebas" />
            <div className="testcard-meta">
              <span>{testCard.powers.join(" / ")} %</span>
              <span>{testCard.speeds.join(" / ")} mm/min</span>
            </div>
          </div>
        )}
        <Button
          variant="secondary"
          icon="flame"
          className="wide"
          onClick={() => {
            const card = buildTestCard(doc);
            setTestCard(card);
            const zip = makeZip([
              { name: "tarjeta-pruebas-grabado.svg", data: card.svg },
              { name: "tarjeta-pruebas-ajustes.csv", data: card.csv },
              { name: "LEEME-tarjeta.txt", data: testCardReadme(doc, card) },
            ]);
            downloadBytes(`${safeFileName(doc.name, "lasercat")}-tarjeta-pruebas.zip`, zip);
            dispatch({ type: "TOAST", text: "Tarjeta de pruebas descargada: SVG + ajustes CSV.", kind: "ok" });
          }}
        >
          Descargar tarjeta de pruebas
        </Button>
        <span className="micro-help">
          Valores calculados para {material.name} y {machine.name}. Cambia de material arriba para otra tabla.
        </span>
      </div>

      <div className="hint-card">
        <b>La simulación no es una promesa</b>
        <p>
          Cada máquina, lente y tablero quema distinto. Las intensidades altas oscurecen más, pero también
          pueden quemar el detalle. Prueba primero en una esquina o con la tarjeta de pruebas del material.
        </p>
      </div>

      <div className="material-card">
        <div className="material-head">
          <span className="material-swatch" style={{ background: sp.base }} />
          <div>
            <b>{material.name}</b>
            <em>{material.thickness} mm · {machine.name}</em>
          </div>
        </div>
        <p>{material.engrave.notes}</p>
        <div className="material-numbers">
          <span><b>{eng.power} %</b> potencia</span>
          <span><b>{eng.speed}</b> mm/min</span>
          <span><b>{eng.interval}</b> mm intervalo</span>
        </div>
      </div>

      <WoodCompareDialog
        open={compareOpen}
        doc={doc}
        options={options}
        onClose={() => setCompareOpen(false)}
      />
    </div>
  );
}

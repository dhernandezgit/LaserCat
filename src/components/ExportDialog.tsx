import { useEffect, useMemo, useState } from "react";
import type { Dispatch } from "react";
import type { Doc } from "../types";
import type { Action } from "../lib/store";
import { buildAllSheets, buildExportFiles, buildSettingsCsv, makeZip, svgToDataUrl } from "../lib/export";
import { computeStats, formatDuration, laserPresetFor, LAYER_COLORS, MACHINE_BY_ID, MATERIAL_BY_ID } from "../lib/laser";
import { dataUrlToBytes, downloadBytes, downloadText, safeFileName } from "../lib/download";
import { loadImage } from "../lib/trace";
import { renderWoodPreview, type WoodPreviewOptions } from "../lib/wood";
import { Badge, Button, Callout, Field, Icon, Modal, NumberField, Toggle } from "./UI";

export function ExportDialog({
  open,
  doc,
  dispatch,
  onClose,
}: {
  open: boolean;
  doc: Doc;
  dispatch: Dispatch<Action>;
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const stats = useMemo(() => computeStats(doc), [doc]);
  const material = MATERIAL_BY_ID[doc.settings.materialId] || MATERIAL_BY_ID.tilo;
  const machine = MACHINE_BY_ID[doc.settings.machineId] || MACHINE_BY_ID.s30;
  const cut = laserPresetFor(material.id, "cut", machine.id);
  const eng = laserPresetFor(material.id, "engrave", machine.id);
  const score = laserPresetFor(material.id, "score", machine.id);
  const pages = Math.max(1, ...doc.placements.map((p) => p.page + 1));
  const options = useMemo(
    () => ({
      kerf: doc.settings.exportKerf,
      bridges: doc.settings.exportBridges,
      bridgeCount: doc.settings.bridgeCount,
      bridgeWidth: doc.settings.bridgeWidth,
      frame: doc.settings.exportFrame,
      order: doc.settings.exportOrder,
      notes: doc.settings.exportNotes,
    }),
    [doc.settings],
  );
  const sheets = useMemo(() => buildAllSheets(doc, options), [doc, options]);
  const current = sheets[Math.min(page, sheets.length - 1)];

  useEffect(() => {
    if (open) setPage(0);
  }, [open]);

  useEffect(() => {
    if (page >= pages) setPage(Math.max(0, pages - 1));
  }, [pages, page]);

  const setSetting = (patch: Partial<typeof doc.settings>) => dispatch({ type: "SET_SETTINGS", patch });

  const rasterFiles = () =>
    doc.parts
      .filter((p) => p.kind === "raster" && p.raster)
      .map((p) => ({
        name: `imagenes/${safeFileName(p.name)}-${p.id}.png`,
        data: dataUrlToBytes(p.raster!.dataUrl),
        part: p,
      }));

  const downloadZip = async () => {
    setBusy(true);
    try {
      const files = buildExportFiles(doc, options);
      for (const f of rasterFiles()) files.push({ name: f.name, data: f.data });
      // Previsualizaciones de madera por plancha
      const images = new Map<string, HTMLImageElement>();
      for (const p of doc.parts) {
        if (p.kind === "raster" && p.raster) {
          try { images.set(p.id, await loadImage(p.raster.dataUrl)); } catch { /* ignore */ }
        }
      }
      const wp: WoodPreviewOptions = {
        speciesId: doc.settings.previewSpecies,
        burnTone: doc.settings.previewBurnTone,
        power: doc.settings.previewPower,
        speed: doc.settings.previewSpeed,
        passes: doc.settings.previewPasses,
        showCut: true,
        showEngrave: true,
        showGuides: false,
      };
      for (let i = 0; i < sheets.length; i++) {
        const canvas = document.createElement("canvas");
        canvas.width = 1400;
        canvas.height = Math.round(1400 * (doc.sheet.height / doc.sheet.width));
        renderWoodPreview(canvas, doc, i, wp, images);
        files.push({
          name: `previews/plancha-${String(i + 1).padStart(2, "0")}-madera.png`,
          data: dataUrlToBytes(canvas.toDataURL("image/png")),
        });
      }
      const bytes = makeZip(files);
      downloadBytes(`${safeFileName(doc.name, "lasercat")}-lightburn.zip`, bytes);
    } finally {
      setBusy(false);
    }
  };

  const copySettings = async () => {
    try {
      await navigator.clipboard.writeText(buildSettingsCsv(doc));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Exportar para LightBurn"
      subtitle="SVG en milímetros reales, capas por color y todo empaquetado."
      width="1080px"
      footer={
        <>
          <div className="footer-info">
            <Badge kind="neutral">{pages} plancha{pages === 1 ? "" : "s"}</Badge>
            <Badge kind="neutral">{stats.placed} piezas</Badge>
            <span className="muted-text">Aprovechamiento {Math.round(stats.efficiency * 100)} %</span>
          </div>
          <div className="footer-buttons">
            <Button variant="ghost" onClick={onClose}>Cerrar</Button>
            <Button variant="secondary" icon="file" onClick={() => {
              const json = JSON.stringify({ ...doc, updatedAt: Date.now() }, null, 2);
              downloadText(`${safeFileName(doc.name, "lasercat")}.json`, json, "application/json");
            }}>
              Proyecto JSON
            </Button>
            <Button variant="primary" icon="download" onClick={downloadZip} disabled={busy || !doc.parts.length}>
              {busy ? "Preparando…" : "Descargar ZIP"}
            </Button>
          </div>
        </>
      }
    >
      <div className="export-layout">
        <div className="export-preview">
          <div className="export-tabs">
            {sheets.map((s, i) => (
              <button key={s.name} type="button" className={page === i ? "active" : ""} onClick={() => setPage(i)}>
                Plancha {i + 1}
              </button>
            ))}
          </div>
          <div className="export-canvas">
            {current ? (
              <img src={svgToDataUrl(current.svg)} alt={`Plancha ${page + 1}`} />
            ) : (
              <div className="preview-placeholder"><Icon name="file" size={30} /></div>
            )}
          </div>
          <div className="export-canvas-meta">
            <span>{doc.sheet.width} × {doc.sheet.height} mm · margen {doc.sheet.margin} mm · kerf {doc.sheet.kerf} mm</span>
            <Button size="sm" variant="secondary" icon="download" onClick={() => current && downloadText(current.name, current.svg, "image/svg+xml")}>
              SVG de esta plancha
            </Button>
          </div>
          <div className="export-stats">
            <div><span>Tiempo estimado</span><b>{formatDuration(stats.timeSeconds)}</b></div>
            <div><span>Corte</span><b>{Math.round(stats.cutLength / 10) / 100} m</b></div>
            <div><span>Grabado</span><b>{Math.round(stats.engraveArea / 100) / 100} dm²</b></div>
          </div>
        </div>

        <aside className="export-options">
          <h3>Ajustes del archivo</h3>
          <Toggle checked={doc.settings.exportKerf} onChange={(v) => setSetting({ exportKerf: v })} label="Compensar kerf" hint={`${doc.sheet.kerf} mm: el corte se desplaza hacia el desperdicio.`} />
          <Toggle checked={doc.settings.exportBridges} onChange={(v) => setSetting({ exportBridges: v })} label="Puentes de sujeción" hint="Deja la pieza unida por pequeñas pestañas." />
          {doc.settings.exportBridges && (
            <div className="two-col">
              <Field label="Puentes">
                <NumberField value={doc.settings.bridgeCount} min={1} max={12} step={1} onChange={(v) => setSetting({ bridgeCount: v })} />
              </Field>
              <Field label="Ancho">
                <NumberField value={doc.settings.bridgeWidth} min={0.5} max={10} step={0.5} suffix="mm" onChange={(v) => setSetting({ bridgeWidth: v })} />
              </Field>
            </div>
          )}
          <Toggle checked={doc.settings.exportOrder} onChange={(v) => setSetting({ exportOrder: v })} label="Ordenar recorridos" hint="Ordena por cercanía para reducir viajes." />
          <Toggle checked={doc.settings.exportFrame} onChange={(v) => setSetting({ exportFrame: v })} label="Recuadro exterior" hint="Añade el marco completo de la plancha en la capa roja MARCAS; puedes desactivarlo." />
          <Toggle checked={doc.settings.exportNotes} onChange={(v) => setSetting({ exportNotes: v })} label="Notas en el SVG" hint="Material y ajustes dentro del archivo." />

          <div className="divider" />
          <h3>Capas</h3>
          <div className="export-layers">
            {[
              { id: "engrave", name: "GRABADO", color: LAYER_COLORS.engrave, mode: "Relleno", desc: `${eng.power}% · ${eng.speed} mm/min` },
              { id: "score", name: "MARCADO", color: LAYER_COLORS.score, mode: "Línea", desc: `${score.power}% · ${score.speed} mm/min` },
              { id: "cut", name: "CORTE", color: LAYER_COLORS.cut, mode: "Línea", desc: `${cut.power}% · ${cut.speed} mm/min` },
              { id: "border", name: "BORDE", color: LAYER_COLORS.border, mode: "Línea", desc: "corte interior" },
              { id: "marks", name: "MARCAS", color: LAYER_COLORS.marks, mode: "Línea", desc: "referencia" },
            ].map((l) => (
              <div className="export-layer" key={l.id}>
                <span className="layer-swatch" style={{ background: l.color }} />
                <b>{l.name}</b>
                <span>{l.mode}</span>
                <em>{l.desc}</em>
              </div>
            ))}
          </div>

          <div className="divider" />
          <div className="lightburn-steps">
            <b>En LightBurn</b>
            <ol>
              <li>Archivo → Importar y elige el SVG.</li>
              <li>Comprueba que mide {doc.sheet.width} × {doc.sheet.height} mm.</li>
              <li>Ordena las capas: grabado → marcado → borde → corte.</li>
              <li>Coloca en origen de usuario o coordenadas absolutas.</li>
            </ol>
          </div>
          <Button size="sm" variant="ghost" icon="copy" onClick={copySettings}>{copied ? "Ajustes copiados" : "Copiar ajustes CSV"}</Button>
        </aside>
      </div>

      <Callout kind="info">
        El ZIP incluye los SVG por plancha, las imágenes de grabado sueltas, la previsualización en madera, un CSV de capas y un LEEME.
        Los SVG ya vienen en milímetros: no los redimensiones al importar.
      </Callout>
    </Modal>
  );
}

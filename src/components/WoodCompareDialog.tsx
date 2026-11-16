import { useEffect, useMemo, useRef, useState } from "react";
import type { Doc } from "../types";
import { loadImage } from "../lib/trace";
import { renderWoodPreview, SPECIES_BY_ID, type WoodPreviewOptions } from "../lib/wood";
import { Button, Modal } from "./UI";

const SPECIES_IDS = ["tilo", "roble", "nogal", "cerezo"];
const POWERS = [25, 45, 70, 100];

export function WoodCompareDialog({
  open,
  doc,
  options,
  onClose,
}: {
  open: boolean;
  doc: Doc;
  options: WoodPreviewOptions;
  onClose: () => void;
}) {
  const canvases = useRef<(HTMLCanvasElement | null)[][]>(
    SPECIES_IDS.map(() => POWERS.map(() => null)),
  );
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    for (const part of doc.parts) {
      if (part.kind !== "raster" || !part.raster) continue;
      loadImage(part.raster.dataUrl)
        .then((img) => {
          if (cancelled) return;
          setImages((prev) => {
            if (prev.has(part.id)) return prev;
            const m = new Map(prev);
            m.set(part.id, img);
            return m;
          });
        })
        .catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [open, doc.parts]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timers: number[] = [];
    const render = (si: number, pi: number) => {
      if (cancelled) return;
      const canvas = canvases.current[si]?.[pi];
      if (!canvas) return;
      canvas.width = 280;
      canvas.height = 280;
      renderWoodPreview(
        canvas,
        doc,
        0,
        {
          ...options,
          speciesId: SPECIES_IDS[si],
          power: POWERS[pi],
          showCut: true,
          showEngrave: true,
          showGuides: false,
        },
        images,
      );
    };
    // Renderizar de uno en uno para que el modal aparezca con fluidez.
    let delay = 40;
    for (let si = 0; si < SPECIES_IDS.length; si++) {
      for (let pi = 0; pi < POWERS.length; pi++) {
        timers.push(window.setTimeout(() => render(si, pi), delay));
        delay += 35;
      }
    }
    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
    };
  }, [open, doc, options, images]);

  const speciesRows = useMemo(
    () => SPECIES_IDS.map((id) => SPECIES_BY_ID[id] || SPECIES_BY_ID.tilo),
    [],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Comparador de maderas"
      subtitle={`Mismo diseño, cuatro maderas y cuatro intensidades · velocidad ${options.speed} mm/min · ${options.passes} pasada(s).`}
      width="1180px"
      className="compare-modal"
      footer={
        <div className="compare-foot">
          <span className="micro-help">La simulación es orientativa. La mejor combinación depende de tu lente, foco y tablero.</span>
          <Button variant="primary" onClick={onClose}>Volver al taller</Button>
        </div>
      }
    >
      <div className="compare-intro">
        Cada columna cambia la **potencia**; cada fila, la **madera**. Los agujeros, bordes y líneas de corte son los de tu plancha actual.
      </div>
      <div className="compare-grid">
        <div className="compare-corner">Madera / potencia</div>
        {POWERS.map((p) => (
          <div className="compare-head" key={p}>{p} %</div>
        ))}
        {speciesRows.map((sp, si) => (
          <div className="compare-row" key={sp.id}>
            <div className="compare-label">
              <span className="species-swatch" style={{ background: `linear-gradient(135deg, ${sp.light}, ${sp.base} 55%, ${sp.dark})` }} />
              <b>{sp.name}</b>
            </div>
            {POWERS.map((p, pi) => (
              <div className="compare-cell" key={p}>
                <canvas
                  ref={(el) => { canvases.current[si][pi] = el; }}
                  aria-label={`${sp.name} al ${p} %`}
                />
                <span>{sp.name} · {p} %</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="compare-legend">
        Más potencia = más oscuridad, pero también más riesgo de quemar el detalle. Para fotos y retratos suele ganar
        una intensidad media; para siluetas y texto, sube hasta que el borde quede limpio.
      </div>
    </Modal>
  );
}

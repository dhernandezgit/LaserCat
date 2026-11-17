import { useEffect, useMemo, useRef, useState } from "react";
import type { Doc } from "../types";
import { loadImage } from "../lib/trace";
import { downloadDataUrl } from "../lib/download";
import { renderWoodPreview, SPECIES_BY_ID, type WoodPreviewOptions } from "../lib/wood";
import { Icon } from "./UI";

export function useRasterImages(doc: Doc): Map<string, HTMLImageElement> {
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map());
  useEffect(() => {
    let cancelled = false;
    const next = new Map(images);
    let changed = false;
    for (const part of doc.parts) {
      if (part.kind !== "raster" || !part.raster) continue;
      if (next.has(part.id)) continue;
      changed = true;
      loadImage(part.raster.dataUrl)
        .then((img) => {
          if (cancelled) return;
          setImages((prev) => {
            const m = new Map(prev);
            m.set(part.id, img);
            return m;
          });
        })
        .catch(() => undefined);
    }
    if (!changed && next.size !== images.size) setImages(next);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.parts]);
  return images;
}

export function WoodCanvas({ doc, page, options }: { doc: Doc; page: number; options: WoodPreviewOptions }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(900);
  const images = useRasterImages(doc);
  const sp = SPECIES_BY_ID[options.speciesId] || SPECIES_BY_ID.tilo;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const w = Math.max(320, Math.min(1500, el.clientWidth - 8));
      setWidth(w);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = width;
    const h = Math.max(220, Math.round(w * (doc.sheet.height / doc.sheet.width)));
    canvas.width = w;
    canvas.height = h;
    renderWoodPreview(canvas, doc, page, options, images);
  }, [doc, page, options, width, images]);

  return (
    <div className="wood-view" ref={wrapRef}>
      <div className="wood-frame">
        <canvas ref={canvasRef} style={{ width: "100%", height: "auto", display: "block" }} />
        <div className="wood-badge">
          <Icon name="wood" size={15} />
          {sp.name} · {options.power} % · {options.speed} mm/min · {options.passes} pase{options.passes === 1 ? "" : "s"}
        </div>
        <button
          type="button"
          className="wood-download"
          title="Descargar esta previsualización en PNG"
          onClick={() => {
            const canvas = canvasRef.current;
            if (canvas) downloadDataUrl(`lasercat-madera-${sp.id}-${options.power}p.png`, canvas.toDataURL("image/png"));
          }}
        >
          <Icon name="download" size={15} /> PNG
        </button>
      </div>
      <p className="wood-note">
        Simulación orientativa. La madera real varía: haz una prueba pequeña antes de grabar la pieza buena.
      </p>
    </div>
  );
}

export function WoodGallery({ doc, base }: { doc: Doc; base: WoodPreviewOptions }) {
  const images = useRasterImages(doc);
  const powers = [25, 45, 70, 100];
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);

  useEffect(() => {
    for (let i = 0; i < powers.length; i++) {
      const canvas = refs.current[i];
      if (!canvas) continue;
      const w = 260;
      const h = Math.max(150, Math.round(w * (doc.sheet.height / doc.sheet.width)));
      canvas.width = w;
      canvas.height = h;
      renderWoodPreview(canvas, doc, 0, { ...base, power: powers[i] }, images);
    }
  }, [doc, base, images]);

  return (
    <div className="wood-gallery">
      {powers.map((p, i) => (
        <div className="gallery-card" key={p}>
          <canvas ref={(el) => { refs.current[i] = el; }} />
          <div className="gallery-meta">
            <b>{p} %</b>
            <span>{base.speciesId}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

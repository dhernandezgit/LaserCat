import { useEffect, useMemo, useRef, useState } from "react";
import type { Doc } from "../types";
import { downloadDataUrl } from "../lib/download";
import { SPECIES_BY_ID } from "../lib/wood";
import { renderWood3D, type Wood3DOptions } from "../lib/wood3d";
import { useRasterImages } from "./WoodCanvas";
import { Icon } from "./UI";

export function Wood3DCanvas({ doc, page, options }: { doc: Doc; page: number; options: Wood3DOptions }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(900);
  const images = useRasterImages(doc);
  const sp = SPECIES_BY_ID[options.speciesId] || SPECIES_BY_ID.tilo;
  const depth = options.depthMm ?? 3;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(Math.max(320, Math.min(1500, el.clientWidth - 8)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = useMemo(() => Math.max(320, Math.round(width * 0.72)), [width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    renderWood3D(canvas, doc, page, options, images);
  }, [doc, page, options, width, height, images]);

  return (
    <div className="wood-view" ref={wrapRef}>
      <div className="wood-frame wood3d-frame">
        <canvas ref={canvasRef} style={{ width: "100%", height: "auto", display: "block" }} />
        <div className="wood-badge">
          <Icon name="wood" size={15} /> 3D · {sp.name} · {depth.toFixed(1)} mm
        </div>
        <button
          type="button"
          className="wood-download"
          title="Descargar esta vista 3D en PNG"
          onClick={() => {
            const canvas = canvasRef.current;
            if (canvas) downloadDataUrl(`lasercat-madera-3d-${sp.id}-${depth}mm.png`, canvas.toDataURL("image/png"));
          }}
        >
          <Icon name="download" size={15} /> PNG
        </button>
      </div>
      <p className="wood-note">
        Vista 3D orientativa del tablero y de las piezas retiradas. El grosor se puede ajustar en Ajustes → Material.
      </p>
    </div>
  );
}

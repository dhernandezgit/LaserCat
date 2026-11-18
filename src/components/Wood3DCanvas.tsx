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
  const [yaw, setYaw] = useState(28);
  const [tilt, setTilt] = useState(56);
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ x: number; y: number; yaw: number; tilt: number } | null>(null);
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
  const renderOptions = useMemo(() => ({ ...options, yaw, tilt, zoom }), [options, yaw, tilt, zoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    renderWood3D(canvas, doc, page, renderOptions, images);
  }, [doc, page, renderOptions, width, height, images]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.max(0.55, Math.min(2.6, z * (e.deltaY < 0 ? 1.08 : 1 / 1.08))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const startOrbit = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, yaw, tilt };
  };
  const moveOrbit = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setYaw(d.yaw + (e.clientX - d.x) * 0.45);
    setTilt(Math.max(24, Math.min(78, d.tilt + (e.clientY - d.y) * 0.25)));
  };
  const endOrbit = () => { drag.current = null; };

  return (
    <div className="wood-view" ref={wrapRef}>
      <div className="wood-frame wood3d-frame">
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "auto", display: "block", touchAction: "none", cursor: "grab" }}
          onPointerDown={startOrbit}
          onPointerMove={moveOrbit}
          onPointerUp={endOrbit}
          onPointerCancel={endOrbit}
        />
        <div className="wood-badge">
          <Icon name="wood" size={15} /> 3D · {sp.name} · {depth.toFixed(1)} mm
        </div>
        <button type="button" className="wood3d-reset" title="Centrar la vista 3D" onClick={() => { setYaw(28); setTilt(56); setZoom(1); }}>
          ⟲
        </button>
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
        Arrastra para orbitar y usa la rueda para acercar. Se muestran las piezas recortadas, no el sobrante. El grosor se ajusta en Ajustes → Material.
      </p>
    </div>
  );
}

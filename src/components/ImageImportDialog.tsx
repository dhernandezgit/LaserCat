import { useEffect, useMemo, useState } from "react";
import type { Dispatch } from "react";
import type { Contour, EngraveMode, Operation, Part } from "../types";
import type { Action } from "../lib/store";
import {
  ditherAtkinson,
  ditherFloydSteinberg,
  ditherOrdered,
  fileToDataUrl,
  halftoneDots,
  imageDataToDataUrl,
  loadImage,
  loadImageData,
  traceImage,
} from "../lib/trace";
import { normalizeOrigin, contoursBounds, fmt } from "../lib/geom";
import { offsetContours } from "../lib/clipper";
import { pickFiles } from "../lib/download";
import { uid } from "../lib/demo";
import { Badge, Button, Callout, Icon, Modal, NumberField, Segmented, Slider, Stepper, Toggle } from "./UI";

type Mode = "cut" | "engrave-threshold" | "engrave-gray" | "engrave-dither" | "engrave-halftone";

const MODES: { id: Mode; name: string; desc: string }[] = [
  { id: "cut", name: "Silueta de corte", desc: "Contorno exterior + agujeros. Para recortar la forma." },
  { id: "engrave-threshold", name: "Grabado B/N", desc: "Vector sólido en blanco y negro. Logos y plantillas." },
  { id: "engrave-gray", name: "Grabado en grises", desc: "Mapa de bits con todas las intensidades. Fotos." },
  { id: "engrave-dither", name: "Grabado tramado", desc: "Puntos de alto contraste. Texturas y retratos." },
  { id: "engrave-halftone", name: "Semitono vectorial", desc: "Miles de puntos vectoriales. Grabado sin imagen." },
];

interface Preview {
  kind: "vector" | "raster";
  contours?: Contour[];
  svgPath?: string;
  dataUrl?: string;
  width: number;
  height: number;
  loops?: number;
  dots?: number;
}

export function ImageImportDialog({
  open,
  initialFile,
  initialMode,
  initialCut,
  engraveOutput,
  dotsPerMm,
  dispatch,
  onClose,
}: {
  open: boolean;
  initialFile: File | null;
  initialMode: EngraveMode;
  initialCut: boolean;
  engraveOutput: "vector" | "raster";
  dotsPerMm: number;
  dispatch: Dispatch<Action>;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState("");
  const [image, setImage] = useState<ImageData | null>(null);
  const [mode, setMode] = useState<Mode>("cut");
  const [targetWidth, setTargetWidth] = useState(80);
  const [threshold, setThreshold] = useState(160);
  const [invert, setInvert] = useState(false);
  const [removeBg, setRemoveBg] = useState(false);
  const [simplify, setSimplify] = useState(true);
  const [smooth, setSmooth] = useState(0);
  const [minArea, setMinArea] = useState(0.35);
  const [ditherKind, setDitherKind] = useState<"floyd" | "atkinson" | "ordered">("floyd");
  const [dotDensity, setDotDensity] = useState(dotsPerMm || 3);
  const [offset, setOffset] = useState(2);
  const [copies, setCopies] = useState(1);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [busyFile, setBusyFile] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initialFile) {
      void openFile(initialFile);
    }
    if (initialCut) {
      setMode("cut");
    } else {
      setMode(
        initialMode === "threshold"
          ? "engrave-threshold"
          : initialMode === "grayscale"
            ? "engrave-gray"
            : "engrave-dither",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFile]);

  const openFile = async (f: File) => {
    try {
      if (!/^image\//.test(f.type) && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name)) {
        throw new Error("Formato no soportado. Usa PNG, JPG, WEBP o GIF. Para SVG, usa el importador SVG.");
      }
      if (f.size > 18 * 1024 * 1024) throw new Error("La imagen supera los 18 MB.");
      setBusyFile(true);
      setError("");
      const data = await loadImageData(f, 1400, true);
      setFile(f);
      setImage(data.image);
      setOriginalUrl(data.dataUrl);
      setTargetWidth((w) => Math.min(w, Math.round((data.image.width / 300) * 25.4) || 80));
      setPreview(null);
    } catch (e: any) {
      setError(e?.message || "No se pudo abrir la imagen.");
    } finally {
      setBusyFile(false);
    }
  };

  useEffect(() => {
    if (!image || !open) return;
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(() => {
      try {
        const aspect = image.height / image.width;
        const widthMm = Math.max(2, targetWidth);
        const heightMm = widthMm * aspect;
        if (mode === "cut" || mode === "engrave-threshold") {
          const dpi = (image.width / widthMm) * 25.4;
          const res = traceImage(image, {
            threshold,
            invert,
            alphaThreshold: 40,
            simplifyPx: simplify ? 0.55 : 0,
            minAreaMm2: minArea,
            dpi,
            smooth,
            removeBackground: removeBg,
          });
          if (cancelled) return;
          const normalized = normalizeOrigin(res.contours);
          const b = contoursBounds(normalized);
          setPreview({
            kind: "vector",
            contours: normalized,
            svgPath: normalized
              .map((c) => `M${c.map((p) => `${fmt(p.x)} ${fmt(p.y)}`).join("L")}Z`)
              .join(""),
            width: b.w,
            height: b.h,
            loops: res.loops,
          });
        } else if (mode === "engrave-halftone") {
          const dots = halftoneDots(image, widthMm, heightMm, { dotsPerMm: dotDensity, maxDots: 24000 });
          if (cancelled) return;
          const normalized = normalizeOrigin(dots);
          const b = contoursBounds(normalized);
          // Con miles de puntos, dibujar el SVG en el navegador puede congelar
          // la vista previa: mostramos la imagen original y el número de puntos.
          const heavy = dots.length > 5000;
          setPreview({
            kind: "vector",
            contours: normalized,
            svgPath: heavy
              ? undefined
              : normalized.map((c) => `M${c.map((p) => `${fmt(p.x)} ${fmt(p.y)}`).join("L")}Z`).join(""),
            dataUrl: heavy ? imageDataToDataUrl(image) : undefined,
            width: b.w,
            height: b.h,
            dots: dots.length,
          });
        } else {
          let out = image;
          if (mode === "engrave-dither") {
            out = ditherKind === "atkinson"
              ? ditherAtkinson(image, threshold)
              : ditherKind === "ordered"
                ? ditherOrdered(image, threshold)
                : ditherFloydSteinberg(image, threshold);
          }
          if (invert) {
            const inv = new ImageData(out.width, out.height);
            for (let i = 0; i < out.data.length; i += 4) {
              inv.data[i] = 255 - out.data[i];
              inv.data[i + 1] = 255 - out.data[i + 1];
              inv.data[i + 2] = 255 - out.data[i + 2];
              inv.data[i + 3] = out.data[i + 3];
            }
            out = inv;
          }
          const url = imageDataToDataUrl(out);
          if (cancelled) return;
          setPreview({ kind: "raster", dataUrl: url, width: widthMm, height: heightMm });
        }
        setError("");
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "No se pudo procesar la imagen.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 260);
    return () => { cancelled = true; clearTimeout(t); };
  }, [image, mode, targetWidth, threshold, invert, removeBg, simplify, smooth, minArea, ditherKind, dotDensity, open]);

  const isVector = preview?.kind === "vector";
  const operation: Operation = mode === "cut" ? "cut" : "engrave";

  const confirm = (nest: boolean) => {
    if (!image || !preview) return;
    const base = (file?.name || "imagen").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Imagen";
    const width = preview.width;
    const height = preview.height;
    let part: Part;
    if (preview.kind === "vector" && preview.contours) {
      part = {
        id: uid("img"),
        name: base,
        kind: "vector",
        contours: preview.contours,
        width,
        height,
        operation,
        offsetMm: Math.max(0, offset),
        separateBorder: false,
        copies,
        source: "image",
        color: operation === "engrave" ? "#8a4f7d" : "#b5651d",
      };
    } else {
      const dpi = (image.width / Math.max(1, targetWidth)) * 25.4;
      const rasterMode: EngraveMode = mode === "engrave-gray" ? "grayscale" : mode === "engrave-dither" ? "dither" : "threshold";
      part = {
        id: uid("img"),
        name: base,
        kind: "raster",
        contours: [],
        width,
        height,
        operation: "engrave",
        offsetMm: Math.max(0, offset),
        separateBorder: false,
        copies,
        source: "image",
        color: "#8a4f7d",
        raster: {
          dataUrl: preview.dataUrl!,
          width: image.width,
          height: image.height,
          dpi,
          mode: rasterMode,
          threshold,
          invert,
        },
      };
    }
    dispatch({ type: "ADD_PARTS", parts: [part], nest });
    dispatch({ type: "TOAST", text: `${part.name} importada${nest ? " y colocada" : ""}.`, kind: "ok" });
    reset();
    onClose();
  };

  const reset = () => {
    setFile(null);
    setOriginalUrl("");
    setImage(null);
    setPreview(null);
    setError("");
    setMode("cut");
    setInvert(false);
    setRemoveBg(false);
    setOffset(2);
    setCopies(1);
    setThreshold(160);
    setDotDensity(dotsPerMm || 3);
  };

  const modeInfo = MODES.find((m) => m.id === mode)!;
  const targetHeight = image ? (targetWidth * image.height) / image.width : 0;

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Importar imagen"
      subtitle="Convierte una foto o un dibujo en un trabajo de corte o grabado."
      width="1120px"
      footer={
        <>
          <div className="footer-info">
            {preview && <Badge kind={operation === "cut" ? "cut" : "engrave"}>{operation === "cut" ? "Corte" : "Grabado"}</Badge>}
            {preview && <span className="muted-text">{fmt(preview.width)} × {fmt(preview.height)} mm · {copies} copia(s)</span>}
          </div>
          <div className="footer-buttons">
            <Button variant="ghost" onClick={() => { reset(); onClose(); }}>Cancelar</Button>
            <Button variant="secondary" icon="move" disabled={!preview || busy} onClick={() => confirm(false)}>Añadir sin mover</Button>
            <Button variant="primary" icon="sparkles" disabled={!preview || busy} onClick={() => confirm(true)}>Añadir y colocar</Button>
          </div>
        </>
      }
    >
      {!image ? (
        <div className="image-choose">
          <div
            className="svg-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void openFile(f);
            }}
            onClick={async () => {
              const [f] = await pickFiles("image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp");
              if (f) void openFile(f);
            }}
          >
            <div className="drop-icon"><Icon name="image" size={34} /></div>
            <b>Arrastra una imagen aquí</b>
            <span>o haz clic para elegir un archivo</span>
            <em>PNG, JPG, WEBP, GIF · se procesa en tu navegador</em>
          </div>
          {busyFile && <div className="loading-line">Leyendo imagen…</div>}
          {error && <Callout kind="warn">{error}</Callout>}
          <div className="choose-tips">
            <div><b>Logo o silueta</b><span>Usa fondo transparente y el modo B/N para un contorno limpio.</span></div>
            <div><b>Foto</b><span>Grises o tramado dan más detalle en madera.</span></div>
            <div><b>Pegatina</b><span>Añade un borde de 2–3 mm y corta el contorno.</span></div>
          </div>
        </div>
      ) : (
        <div className="image-editor">
          <div className="image-modes">
            {MODES.map((m) => (
              <button key={m.id} type="button" className={`mode-card ${mode === m.id ? "active" : ""}`} onClick={() => setMode(m.id)}>
                <b>{m.name}</b>
                <em>{m.desc}</em>
              </button>
            ))}
          </div>

          <div className="image-preview-row">
            <div className="image-pane">
              <span className="pane-label">Original</span>
              <div className="image-box">
                {originalUrl && <img src={originalUrl} alt="Original" />}
              </div>
            </div>
            <div className="image-pane">
              <span className="pane-label">Resultado {busy && <em>procesando…</em>}</span>
              <div className="image-box checker">
                {preview?.kind === "vector" && preview.svgPath ? (
                  <svg viewBox={`0 0 ${Math.max(0.1, preview.width)} ${Math.max(0.1, preview.height)}`} preserveAspectRatio="xMidYMid meet">
                    <path d={preview.svgPath} fill={operation === "cut" ? "#b5651d" : "#5b3420"} fillRule="evenodd" />
                  </svg>
                ) : preview?.dataUrl ? (
                  <img src={preview.dataUrl} alt="Resultado" />
                ) : (
                  <div className="preview-placeholder"><Icon name="image" size={28} /></div>
                )}
              </div>
              {preview?.kind === "vector" && (
                <span className="pane-meta">{preview.dots ? `${preview.dots} puntos` : `${preview.loops} contornos`} · {fmt(preview.width)}×{fmt(preview.height)} mm</span>
              )}
              {preview?.kind === "raster" && <span className="pane-meta">Mapa de bits · {image.width}×{image.height} px</span>}
            </div>
          </div>

          <div className="image-options">
            <div className="options-col">
              <label className="mini-field">
                <span>Ancho final</span>
                <NumberField value={targetWidth} min={2} max={1000} step={1} suffix="mm" onChange={setTargetWidth} />
              </label>
              <div className="option-note">Alto: <b>{fmt(targetHeight)} mm</b> · proporción bloqueada</div>
              <label className="mini-field">
                <span>Borde / offset</span>
                <NumberField value={offset} min={0} max={20} step={0.5} suffix="mm" onChange={setOffset} />
              </label>
              <div className="option-note">Se corta alrededor del grabado. 0 = sin borde.</div>
              <div className="copy-line">
                <span>Copias</span>
                <Stepper value={copies} min={1} max={99} onChange={setCopies} />
              </div>
              <Button size="sm" variant="ghost" icon="upload" onClick={async () => {
                const [f] = await pickFiles("image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp");
                if (f) void openFile(f);
              }}>Cambiar imagen</Button>
            </div>

            <div className="options-col">
              {(mode === "engrave-gray" || mode === "engrave-halftone") ? (
                <Callout kind="info">
                  {mode === "engrave-gray"
                    ? "Se exporta como imagen PNG incrustada; en LightBurn usa modo Imagen → Grises."
                    : "Se exportan puntos vectoriales; en LightBurn usa Relleno. A más puntos, más detalle y más tiempo."}
                </Callout>
              ) : (
                <>
                  <Slider label="Umbral" min={0} max={255} step={1} value={threshold} onChange={setThreshold} format={(v) => String(v)} />
                  <p className="option-help">Más umbral = más zonas oscuras se convierten en corte/grabado.</p>
                </>
              )}
              {mode === "engrave-halftone" && (
                <Slider label="Densidad" min={1} max={8} step={0.5} value={dotDensity} onChange={setDotDensity} format={(v) => `${v} puntos/mm`} />
              )}
              {mode === "engrave-dither" && (
                <label className="mini-field">
                  <span>Tramado</span>
                  <select className="select" value={ditherKind} onChange={(e) => setDitherKind(e.target.value as any)}>
                    <option value="floyd">Floyd–Steinberg (suave)</option>
                    <option value="atkinson">Atkinson (contraste)</option>
                    <option value="ordered">Ordenado 8×8 (regular)</option>
                  </select>
                </label>
              )}
              {(mode === "cut" || mode === "engrave-threshold") && (
                <>
                  <Toggle checked={simplify} onChange={setSimplify} label="Simplificar contorno" hint="0,55 px; reduce nodos." />
                  <Slider label="Suavizado" min={0} max={2} step={1} value={smooth} onChange={setSmooth} format={(v) => v === 0 ? "ninguno" : `${v} pasada(s)`} />
                  <Slider label="Tamaño mínimo" min={0.05} max={5} step={0.05} value={minArea} onChange={setMinArea} format={(v) => `${v} mm²`} />
                </>
              )}
              <Toggle checked={removeBg} onChange={setRemoveBg} label="Quitar fondo claro" hint="Ignora el blanco y lo transparente." />
              <Toggle checked={invert} onChange={setInvert} label="Invertir" hint="Para dibujos blancos sobre fondo negro." />
              {error && <Callout kind="warn">{error}</Callout>}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

import { useMemo, useRef, useState } from "react";
import type { Dispatch } from "react";
import type { Doc, Part, Placement, SelectionState } from "../types";
import type { Action } from "../lib/store";
import { contoursToPath, fmt } from "../lib/geom";
import { effectiveGeometry, placeEffective } from "../lib/laser";
import { Icon, IconButton } from "./UI";

interface Box {
  id: string;
  part: Part;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function Board({
  doc,
  dispatch,
  selection,
  page,
  zoom,
  showGrid = true,
  onDropFiles,
}: {
  doc: Doc;
  dispatch: Dispatch<Action>;
  selection: SelectionState;
  page: number;
  zoom: number;
  showGrid?: boolean;
  onDropFiles: (files: File[]) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{
    start: { x: number; y: number };
    origins: { id: string; x: number; y: number }[];
    moved: boolean;
    pointerId: number;
  } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dragging, setDragging] = useState(false);

  const partsById = useMemo(() => new Map(doc.parts.map((p) => [p.id, p])), [doc.parts]);
  const placements = useMemo(() => doc.placements.filter((p) => p.page === page), [doc.placements, page]);

  const boxes = useMemo<Box[]>(() => {
    const out: Box[] = [];
    for (const pl of placements) {
      const part = partsById.get(pl.partId);
      if (!part) continue;
      const g = placeEffective(part, pl);
      out.push({ id: pl.id, part, x: pl.x, y: pl.y, w: g.rotatedW, h: g.rotatedH });
    }
    return out;
  }, [placements, partsById]);

  const overlaps = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 0.5 && oy > 0.5) {
          set.add(a.id);
          set.add(b.id);
        }
      }
    }
    return set;
  }, [boxes]);

  const outside = useMemo(() => {
    const set = new Set<string>();
    const { margin, width, height } = doc.sheet;
    for (const b of boxes) {
      if (b.x < margin - 0.01 || b.y < margin - 0.01 || b.x + b.w > width - margin + 0.01 || b.y + b.h > height - margin + 0.01) {
        set.add(b.id);
      }
    }
    return set;
  }, [boxes, doc.sheet]);

  const selected = new Set(selection.placementIds);

  const toSvg = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const p = svg.createSVGPoint();
    p.x = clientX;
    p.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const q = p.matrixTransform(ctm.inverse());
    return { x: q.x, y: q.y };
  };

  const startDrag = (e: React.PointerEvent, pl: Placement) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const current = selection.placementIds;
    let ids: string[];
    if (e.shiftKey) {
      ids = current.includes(pl.id) ? current.filter((x) => x !== pl.id) : [...current, pl.id];
    } else if (current.includes(pl.id)) {
      ids = current;
    } else {
      ids = [pl.id];
    }
    const partIds = Array.from(
      new Set(ids.map((id) => doc.placements.find((p) => p.id === id)?.partId).filter(Boolean) as string[]),
    );
    dispatch({ type: "SELECT", partIds, placementIds: ids });
    if (!ids.length) return;
    const start = toSvg(e.clientX, e.clientY);
    const origins = doc.placements.filter((p) => ids.includes(p.id)).map((p) => ({ id: p.id, x: p.x, y: p.y }));
    drag.current = { start, origins, moved: false, pointerId: e.pointerId };
    svgRef.current?.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toSvg(e.clientX, e.clientY);
    let dx = p.x - d.start.x;
    let dy = p.y - d.start.y;
    if (!e.altKey) {
      dx = Math.round(dx * 2) / 2;
      dy = Math.round(dy * 2) / 2;
    }
    if (!d.moved && Math.hypot(dx, dy) > 0.35) d.moved = true;
    if (!d.moved) return;
    dispatch({
      type: "SET_POSITIONS",
      key: `drag-${d.origins.map((o) => o.id).join("-")}`,
      positions: d.origins.map((o) => ({ id: o.id, x: o.x + dx, y: o.y + dy })),
    });
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!drag.current) return;
    try {
      svgRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drag.current = null;
    setDragging(false);
  };

  const pad = 15;
  const sheetW = doc.sheet.width;
  const sheetH = doc.sheet.height;
  const fullW = sheetW + pad * 2;
  const fullH = sheetH + pad * 2;
  const z = Math.max(1, Math.min(6, zoom));
  const vw = fullW / z;
  const vh = fullH / z;
  const vx = -pad + (fullW - vw) / 2;
  const vy = -pad + (fullH - vh) / 2;

  const grid: React.ReactNode[] = [];
  if (showGrid) {
    for (let x = 10; x < sheetW; x += 10) {
      grid.push(
        <line key={`gx${x}`} x1={x} y1={0} x2={x} y2={sheetH} stroke="rgba(74,52,30,.09)" strokeWidth={0.12} />,
      );
    }
    for (let y = 10; y < sheetH; y += 10) {
      grid.push(
        <line key={`gy${y}`} x1={0} y1={y} x2={sheetW} y2={y} stroke="rgba(74,52,30,.09)" strokeWidth={0.12} />,
      );
    }
    for (let x = 50; x < sheetW; x += 50) {
      grid.push(
        <line key={`gxm${x}`} x1={x} y1={0} x2={x} y2={sheetH} stroke="rgba(74,52,30,.16)" strokeWidth={0.18} />,
      );
    }
    for (let y = 50; y < sheetH; y += 50) {
      grid.push(
        <line key={`gym${y}`} x1={0} y1={y} x2={sheetW} y2={y} stroke="rgba(74,52,30,.16)" strokeWidth={0.18} />,
      );
    }
  }

  const ruler: React.ReactNode[] = [];
  for (let x = 0; x <= sheetW; x += 10) {
    const major = x % 50 === 0;
    ruler.push(
      <line
        key={`tx${x}`}
        x1={x}
        y1={-3.6}
        x2={x}
        y2={major ? -8 : -5.4}
        stroke="var(--ruler)"
        strokeWidth={major ? 0.28 : 0.16}
      />,
    );
    if (major) {
      ruler.push(
        <text key={`ttx${x}`} x={x + 0.6} y={-9.2} fontSize={3.4} fill="var(--ruler)" fontFamily="var(--font-ui)" textAnchor="middle">
          {x}
        </text>,
      );
    }
  }
  for (let y = 0; y <= sheetH; y += 10) {
    const major = y % 50 === 0;
    ruler.push(
      <line
        key={`ty${y}`}
        x1={-3.6}
        y1={y}
        x2={major ? -8 : -5.4}
        y2={y}
        stroke="var(--ruler)"
        strokeWidth={major ? 0.28 : 0.16}
      />,
    );
    if (major) {
      ruler.push(
        <text
          key={`tty${y}`}
          x={-9.4}
          y={y + 1.1}
          fontSize={3.4}
          fill="var(--ruler)"
          fontFamily="var(--font-ui)"
          textAnchor="middle"
          transform={`rotate(-90 ${-9.4} ${y + 1})`}
        >
          {y}
        </text>,
      );
    }
  }
  ruler.push(
    <text key="mm" x={-9.5} y={-9.2} fontSize={3} fill="var(--ruler)" fontFamily="var(--font-ui)">
      mm
    </text>,
  );

  const renderPlacement = (pl: Placement) => {
    const part = partsById.get(pl.partId);
    if (!part) return null;
    const g = effectiveGeometry(part);
    const pg = placeEffective(part, pl);
    const m = pg.matrix;
    const isSel = selected.has(pl.id);
    const isHover = hover === pl.id;
    const bad = overlaps.has(pl.id) || outside.has(pl.id);
    const dBase = contoursToPath(g.base);
    const dOuter = contoursToPath(g.outer);
    const dInner = contoursToPath(g.innerCut);
    const stroke = bad ? "#a3351f" : isSel ? "var(--select)" : "#4b321b";

    return (
      <g
        key={pl.id}
        transform={`matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`}
        className={`placement ${isSel ? "selected" : ""} ${dragging && isSel ? "dragging" : ""}`}
        onPointerDown={(e) => startDrag(e, pl)}
        onPointerEnter={() => setHover(pl.id)}
        onPointerLeave={() => setHover((h) => (h === pl.id ? null : h))}
        style={{ cursor: "grab" }}
      >
        {/* relleno invisible para capturar el puntero en toda la caja */}
        <rect
          x={g.width * 0.001}
          y={g.height * 0.001}
          width={Math.max(0.1, g.width)}
          height={Math.max(0.1, g.height)}
          fill="transparent"
          stroke="none"
        />
        {part.kind === "raster" && part.raster ? (
          <image
            x={g.baseBounds.x}
            y={g.baseBounds.y}
            width={Math.max(0.01, g.baseBounds.w)}
            height={Math.max(0.01, g.baseBounds.h)}
            href={part.raster.dataUrl}
            preserveAspectRatio="none"
            opacity={0.92}
          />
        ) : part.operation === "engrave" ? (
          <path d={dBase} fill="rgba(72,43,20,.72)" fillRule="evenodd" opacity={0.95} stroke={stroke} strokeWidth={0.18} />
        ) : part.operation === "score" ? (
          <path d={dBase} fill="none" stroke="#6b6236" strokeWidth={0.32} strokeDasharray="1.4 1" strokeLinecap="round" />
        ) : (
          <path
            d={dBase}
            fill={g.hasOffset ? "rgba(138,90,43,.12)" : "rgba(164,112,55,.24)"}
            fillRule="evenodd"
            opacity={g.hasOffset ? 1 : 1}
            stroke={stroke}
            strokeWidth={0.28}
          />
        )}
        {g.hasOffset && part.operation !== "engrave" && (
          <path d={dBase} fill="none" stroke={stroke} strokeWidth={0.2} strokeDasharray="1.1 0.9" opacity={0.75} />
        )}
        {g.hasOffset && <path d={dOuter} fill="none" stroke={stroke} strokeWidth={0.38} />}
        {part.separateBorder && dInner && (
          <path d={dInner} fill="none" stroke="var(--select)" strokeWidth={0.25} strokeDasharray="0.8 0.7" />
        )}
        {g.hasOffset && part.operation === "engrave" && (
          <path d={dOuter} fill="none" stroke={stroke} strokeWidth={0.38} />
        )}
      </g>
    );
  };

  const hoverBox = hover ? boxes.find((b) => b.id === hover) : null;
  const selBoxes = boxes.filter((b) => selected.has(b.id));

  return (
    <div
      className={`board-wrap ${dragOver ? "drag-over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onDropFiles(Array.from(e.dataTransfer.files || []));
      }}
    >
      <svg
        ref={svgRef}
        className="board-svg"
        viewBox={`${vx} ${vy} ${vw} ${vh}`}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerDown={(e) => {
          const t = e.target as Element;
          if (!t.closest || !t.closest(".placement")) dispatch({ type: "SELECT", partIds: [], placementIds: [] });
        }}
      >
        <defs>
          <filter id="sheet-shadow" x="-8%" y="-8%" width="116%" height="116%">
            <feDropShadow dx="0" dy="2.2" stdDeviation="2.4" floodColor="#3b2412" floodOpacity="0.35" />
          </filter>
          <pattern id="paper-grain" width="6" height="6" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.08" fill="rgba(90,60,30,.14)" />
            <circle cx="4.5" cy="3.2" r="0.06" fill="rgba(90,60,30,.10)" />
          </pattern>
        </defs>

        {/* sombra y hoja */}
        <rect x={0} y={0} width={sheetW} height={sheetH} fill="rgba(0,0,0,.18)" transform="translate(1.4 1.6)" rx={1.5} />
        <rect x={0} y={0} width={sheetW} height={sheetH} fill="#fbf5e7" filter="url(#sheet-shadow)" rx={1.5} />
        <rect x={0} y={0} width={sheetW} height={sheetH} fill="url(#paper-grain)" />
        {grid}
        <rect x={0} y={0} width={sheetW} height={sheetH} fill="none" stroke="rgba(80,55,28,.55)" strokeWidth={0.4} />

        {/* margen de seguridad */}
        <rect
          x={doc.sheet.margin}
          y={doc.sheet.margin}
          width={Math.max(1, sheetW - doc.sheet.margin * 2)}
          height={Math.max(1, sheetH - doc.sheet.margin * 2)}
          fill="none"
          stroke="rgba(120,85,45,.42)"
          strokeWidth={0.18}
          strokeDasharray="2.2 1.8"
        />

        {ruler}

        <g className="placements">{placements.map(renderPlacement)}</g>

        {selBoxes.map((b) => (
          <g key={`sel-${b.id}`} pointerEvents="none">
            <rect
              x={b.x - 1.2}
              y={b.y - 1.2}
              width={b.w + 2.4}
              height={b.h + 2.4}
              fill="none"
              stroke="var(--select)"
              strokeWidth={0.32}
              strokeDasharray="1.4 1"
            />
            <rect x={b.x - 1.2} y={b.y - 1.2} width={1.6} height={1.6} fill="var(--select)" />
            <rect x={b.x + b.w - 0.4} y={b.y - 1.2} width={1.6} height={1.6} fill="var(--select)" />
            <rect x={b.x - 1.2} y={b.y + b.h - 0.4} width={1.6} height={1.6} fill="var(--select)" />
            <rect x={b.x + b.w - 0.4} y={b.y + b.h - 0.4} width={1.6} height={1.6} fill="var(--select)" />
            <g transform={`translate(${b.x + b.w / 2} ${b.y + b.h + 5.2})`}>
              <rect x={-16} y={-3.4} width={32} height={4.6} rx={1.2} fill="var(--select)" opacity={0.92} />
              <text x={0} y={-0.1} textAnchor="middle" fontSize={2.8} fill="#fff8ea" fontFamily="var(--font-ui)">
                {fmt(b.w)} × {fmt(b.h)} mm
              </text>
            </g>
          </g>
        ))}

        {hoverBox && !selected.has(hoverBox.id) && (
          <g pointerEvents="none" transform={`translate(${hoverBox.x + hoverBox.w / 2} ${hoverBox.y - 3.5})`}>
            <rect x={-18} y={-3.4} width={36} height={4.4} rx={1.2} fill="rgba(47,30,16,.9)" />
            <text x={0} y={-0.2} textAnchor="middle" fontSize={2.7} fill="#fff8ea" fontFamily="var(--font-ui)">
              {hoverBox.part.name}
            </text>
          </g>
        )}
      </svg>

      {!doc.parts.length && (
        <div className="board-empty">
          <div className="empty-cat"><Icon name="cat" size={54} /></div>
          <h3>La mesa está esperando</h3>
          <p>
            Arrastra un <b>SVG</b> o una <b>imagen</b> aquí, o empieza con una forma.
          </p>
          <div className="empty-actions">
            <button type="button" className="btn btn-primary btn-md" onClick={() => dispatch({ type: "SET_UI", patch: { showSvgDialog: true } })}>
              <Icon name="upload" size={17} /> Importar SVG
            </button>
            <button type="button" className="btn btn-secondary btn-md" onClick={() => dispatch({ type: "SET_UI", patch: { showImageDialog: true, pendingImageCut: true } })}>
              <Icon name="image" size={17} /> Importar imagen
            </button>
          </div>
          <span className="empty-hint">También puedes crear un rectángulo, círculo o estrella desde la barra de piezas.</span>
        </div>
      )}

      {dragOver && (
        <div className="drop-veil">
          <Icon name="upload" size={38} />
          <b>Suelta el archivo para importarlo</b>
          <span>SVG, PNG, JPG, WEBP…</span>
        </div>
      )}

      <div className="board-corner-tools">
        <IconButton
          icon="fit"
          title="Encuadrar (F)"
          onClick={() => {
            // El zoom lo controla App; se expone mediante un evento global sencillo.
            window.dispatchEvent(new CustomEvent("lasercat:fit"));
          }}
        />
      </div>
    </div>
  );
}

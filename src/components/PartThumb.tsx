import type { Part } from "../types";
import { contoursToPath } from "../lib/geom";
import { effectiveGeometry } from "../lib/laser";

export function PartThumb({ part, size = 46 }: { part: Part; size?: number }) {
  if (part.kind === "raster" && part.raster) {
    return (
      <div className="part-thumb raster" style={{ width: size, height: size }}>
        <img src={part.raster.dataUrl} alt="" />
      </div>
    );
  }
  const g = effectiveGeometry(part);
  const all = g.outer.length ? g.outer : part.contours;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const c of all) for (const p of c) { xs.push(p.x); ys.push(p.y); }
  const minX = Math.min(...xs, 0);
  const minY = Math.min(...ys, 0);
  const maxX = Math.max(...xs, 1);
  const maxY = Math.max(...ys, 1);
  const w = Math.max(0.1, maxX - minX);
  const h = Math.max(0.1, maxY - minY);
  const pad = Math.max(w, h) * 0.08 + 0.5;
  const dOuter = contoursToPath(all);
  const dBase = contoursToPath(g.base);
  const fill =
    part.operation === "engrave" ? "var(--ink)" : part.operation === "score" ? "none" : "var(--wood-3)";
  const stroke = part.operation === "engrave" ? "var(--ink)" : "var(--wood-6)";
  return (
    <div className="part-thumb" style={{ width: size, height: size }}>
      <svg viewBox={`${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}`} width="100%" height="100%">
        {g.hasOffset && (
          <path d={dOuter} fill="rgba(140,90,40,.10)" stroke="var(--wood-4)" strokeWidth={0.3} strokeDasharray="1 0.8" />
        )}
        <path
          d={dBase}
          fill={g.hasOffset ? "none" : fill}
          stroke={stroke}
          strokeWidth={0.35}
          fillRule="evenodd"
          opacity={part.operation === "score" ? 0.85 : 1}
        />
      </svg>
    </div>
  );
}

export function MiniSvg({ d, viewBox, color = "var(--wood-6)", filled = false }: { d: string; viewBox: string; color?: string; filled?: boolean }) {
  return (
    <svg viewBox={viewBox} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      <path d={d} fill={filled ? color : "none"} stroke={color} strokeWidth={0.3} fillRule="evenodd" />
    </svg>
  );
}

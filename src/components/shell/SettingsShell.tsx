import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch } from "react";
import type { Doc, ImageDropMode, Operation, PackMode, PlacementMethod, Quality, RotationMode, Sheet } from "../../types";
import type { Action } from "../../lib/store";
import {
  LAYERS,
  laserPresetFor,
  MACHINE_BY_ID,
  MACHINES,
  MATERIAL_BY_ID,
  MATERIALS,
  formatDuration,
} from "../../lib/laser";
import { SPECIES, BURN_TONES, type WoodPreviewOptions } from "../../lib/wood";
import { THEMES, themeByKey } from "../../lib/themes";
import { fmt } from "../../lib/geom";
import { Icon, type IconNameType } from "../UI";

const TABS: { id: string; label: string; icon: IconNameType }[] = [
  { id: "general", label: "General", icon: "settings" },
  { id: "optim", label: "Optim.", icon: "sparkles" },
  { id: "border", label: "Borde", icon: "shapes" },
  { id: "image", label: "Imagen", icon: "image" },
  { id: "material", label: "Material", icon: "wood" },
  { id: "view", label: "Vista", icon: "eye" },
  { id: "extras", label: "Extras", icon: "help" },
];

const SECTION_KEYWORDS: Record<string, string> = {
  general: "general plancha hoja pagina tamaño ancho alto margen separacion kerf rotacion calidad metodo copias auto optimizar",
  optim: "optimizacion metodo greedy largest voronoi genetico compactar cajas forma real rotacion tiempo recalcular",
  border: "borde offset pegatina contorno exterior agujeros separado",
  image: "imagen foto grabado b/n grises tramado silueta svg incrustada",
  material: "material madera maquina laser potencia velocidad pasadas tilo abedul roble nogal cerezo bambu mdf pino carton tono",
  view: "vista tema color interfaz cuadricula madera plancha contornos",
  extras: "extras lightburn capas exportar ayuda reportar privacidad historial version",
};

function Num({
  value,
  onCommit,
  min = 0,
  max = 2000,
  step = 1,
  suffix,
  title,
}: {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  title?: string;
}) {
  const [text, setText] = useState(String(Math.round(value * 100) / 100));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(Math.round(value * 100) / 100));
  }, [value]);
  const commit = () => {
    focused.current = false;
    const v = Number(text.replace(",", "."));
    if (!Number.isFinite(v)) return;
    const clamped = Math.max(min, Math.min(max, v));
    setText(String(clamped));
    onCommit(clamped);
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0 }}>
      <input
        className="cc-input"
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        title={title}
        onFocus={() => { focused.current = true; }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
      {suffix && <span style={{ fontSize: 10, color: "var(--textSoft)", flex: "none" }}>{suffix}</span>}
    </span>
  );
}

function Sect({
  id,
  title,
  icon,
  open,
  toggle,
  children,
}: {
  id: string;
  title: string;
  icon: IconNameType;
  open: boolean;
  toggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`sect ${open ? "open" : ""}`} data-sect={id}>
      <div className="sect-head" onClick={() => toggle(id)}>
        <span className="sect-icono"><Icon name={icon} size={14} /></span>
        <span>{title}</span>
        <span className="arrow">▼</span>
      </div>
      {open && <div className="sect-body">{children}</div>}
    </div>
  );
}

function ToggleLine({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle-line" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function SettingsShell({
  doc,
  dispatch,
  theme,
  onTheme,
  stats,
  view,
  onView,
  showGrid,
  onShowGrid,
  onOpenImageDialog,
  onOpenSvgDialog,
  onCompare,
  onTestCard,
  onHelp,
  onReport,
  onOptimize,
  onOpenLibrary,
  previewOptions,
}: {
  doc: Doc;
  dispatch: Dispatch<Action>;
  theme: string;
  onTheme: (key: string) => void;
  stats: { efficiency: number; timeSeconds: number; pages: number; placed: number };
  view: "plan" | "wood" | "wood3d";
  onView: (v: "plan" | "wood" | "wood3d") => void;
  showGrid: boolean;
  onShowGrid: (v: boolean) => void;
  onOpenImageDialog: () => void;
  onOpenSvgDialog: () => void;
  onCompare: () => void;
  onTestCard: () => void;
  onHelp: () => void;
  onReport: () => void;
  onOptimize: () => void;
  onOpenLibrary: () => void;
  previewOptions: WoodPreviewOptions;
}) {
  const [tab, setTab] = useState("general");
  const [busca, setBusca] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({
    general: true, optim: false, border: false, image: false,
    material: false, view: false, extras: false,
  });
  const [borderAll, setBorderAll] = useState(0);
  const th = themeByKey(theme);
  const sheet = doc.sheet;
  const settings = doc.settings;
  const machine = MACHINE_BY_ID[settings.machineId] || MACHINE_BY_ID.s30;
  const material = MATERIAL_BY_ID[settings.materialId] || MATERIAL_BY_ID.tilo;
  const cut = laserPresetFor(material.id, "cut", machine.id);
  const eng = laserPresetFor(material.id, "engrave", machine.id);
  const score = laserPresetFor(material.id, "score", machine.id);
  const q = busca.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const matches = (id: string) => !q || q.length < 2 || SECTION_KEYWORDS[id].includes(q) || TABS.find((t) => t.id === id)?.label.toLowerCase().includes(q);

  const setSheet = (patch: Partial<Sheet>, nest = true) => dispatch({ type: "SET_SHEET", patch, nest });
  const setSettings = (patch: Partial<typeof settings>) => dispatch({ type: "SET_SETTINGS", patch });
  const openTab = (id: string) => {
    setTab(id);
    setOpen((prev) => {
      const next: Record<string, boolean> = {};
      for (const t of TABS) next[t.id] = t.id === id;
      return { ...prev, ...next, [id]: true };
    });
    setTimeout(() => document.querySelector(`[data-sect="${id}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 90);
  };
  const toggle = (id: string) => {
    setTab(id);
    setOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const presets = [
    { label: "300×300", w: 300, h: 300 },
    { label: "A4", w: 210, h: 297 },
    { label: "A3", w: 297, h: 420 },
    { label: "A5", w: 148, h: 210 },
    { label: "Letter", w: 216, h: 279 },
    { label: "400×400", w: 400, h: 400 },
  ];

  const methodLabel: Record<PlacementMethod, string> = {
    auto: "Selección inteligente",
    greedy: "Greedy / Bottom-Left",
    largest: "Largest First",
    voronoi: "Voronoi (huecos libres)",
    genetic: "Genético (máxima calidad)",
  };
  const qualityLabel: Record<Quality, string> = { rapida: "Rápida", equilibrada: "Normal", maxima: "Exacta" };
  const rotationLabel: Record<RotationMode, string> = { no: "Sin girar", "90": "90° y múltiplos", libre: "Cualquier ángulo" };
  const usedAngles = Array.from(new Set(
    doc.placements.map((p) => Math.round(p.angle) % 360),
  )).sort((a, b) => a - b);
  const angleText = usedAngles.length ? `${usedAngles.join("° / ")}°` : "0°";

  return (
    <div className="settings-panel">
      <div className="settings-head">
        <h2>Ajustes</h2>
        <button className="theme-badge" type="button" title="Cambiar tema" onClick={() => openTab("view")}>
          {th.label.toLowerCase()}
        </button>
      </div>

      <div className="seg" role="group" aria-label="Modo de empaquetado">
        <button type="button" className={(sheet.packMode ?? "shape") === "shape" ? "on" : ""} onClick={() => setSheet({ packMode: "shape", rotation: "libre" })}>
          Forma real
          <small>Silueta, cualquier ángulo</small>
        </button>
        <button type="button" className={(sheet.packMode ?? "shape") === "box" ? "on" : ""} onClick={() => setSheet({ packMode: "box", rotation: "90" })}>
          Rectángulos
          <small>Por caja, más rápido</small>
        </button>
      </div>

      <div className="quick-chips">
        <button type="button" onClick={() => onView("wood3d")} title="Ver la madera en 3D con el grosor y el corte">
          ✦ 3D
        </button>
        <button type="button" className={sheet.singlePage ? "on" : ""} onClick={() => setSheet({ singlePage: !sheet.singlePage })} title="No generar más de una plancha">
          Solo 1 plancha
        </button>
        <button type="button" className={settings.autoNest ? "on" : ""} onClick={() => setSettings({ autoNest: !settings.autoNest })} title="Colocar automáticamente al importar o cambiar copias">
          Auto optimizar
        </button>
      </div>

      <div className="modo-row">
        <button type="button" className={!settings.expert ? "on" : ""} onClick={() => setSettings({ expert: false })} title="Solo lo esencial">
          Modo básico
        </button>
        <button type="button" className={settings.expert ? "on" : ""} onClick={() => setSettings({ expert: true })} title="Muestra todos los controles finos">
          Modo experto
        </button>
        <button type="button" onClick={() => { setSheet({ rotation: "libre", quality: "maxima", method: "genetic" }); }} title="Rotación libre y búsqueda a fondo">
          Cálculo libre
        </button>
      </div>

      <div className="tabs-ajustes">
        <div className="tab-rail">
          {TABS.filter((t) => settings.expert || t.id !== "optim").map((t) => (
            <button key={t.id} type="button" className={tab === t.id ? "on" : ""} onClick={() => openTab(t.id)}>
              <Icon name={t.icon} size={11} /> {t.label}
            </button>
          ))}
        </div>
        <input
          className="busca-ajustes"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar…"
          title="Buscar ajustes por nombre, sinónimo o errata"
        />
      </div>

      {matches("general") && (
        <Sect id="general" title="General" icon="grid" open={!!open.general || q.length >= 2} toggle={toggle}>
          <div className="ctl">
            <label>Plancha</label>
            <div className="preset-grid">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={`cc-btn ${Math.abs(sheet.width - p.w) < 0.1 && Math.abs(sheet.height - p.h) < 0.1 ? "on" : ""}`}
                  onClick={() => setSheet({ width: p.w, height: p.h })}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="two">
            <div className="ctl">
              <label>Ancho</label>
              <Num value={sheet.width} min={20} max={2000} step={1} suffix="mm" onCommit={(v) => setSheet({ width: v })} />
            </div>
            <div className="ctl">
              <label>Alto</label>
              <Num value={sheet.height} min={20} max={2000} step={1} suffix="mm" onCommit={(v) => setSheet({ height: v })} />
            </div>
          </div>
          <div className="three">
            <div className="ctl">
              <label>Margen</label>
              <Num value={sheet.margin} min={0} max={100} step={0.5} suffix="mm" onCommit={(v) => setSheet({ margin: v })} />
            </div>
            <div className="ctl">
              <label>Separación</label>
              <Num value={sheet.spacing} min={0} max={100} step={0.5} suffix="mm" onCommit={(v) => setSheet({ spacing: v })} />
            </div>
            <div className="ctl">
              <label>Kerf</label>
              <Num value={sheet.kerf} min={0} max={3} step={0.05} suffix="mm" onCommit={(v) => setSheet({ kerf: v })} />
            </div>
          </div>
          <div className="two">
            <div className="ctl">
              <label>Rotación</label>
              <select className="cc-input" value={sheet.rotation} onChange={(e) => setSheet({ rotation: e.target.value as RotationMode })}>
                {(Object.keys(rotationLabel) as RotationMode[]).map((r) => <option key={r} value={r}>{rotationLabel[r]}</option>)}
              </select>
            </div>
            <div className="ctl">
              <label>Calidad</label>
              <select className="cc-input" value={sheet.quality} onChange={(e) => setSheet({ quality: e.target.value as Quality })}>
                {(Object.keys(qualityLabel) as Quality[]).map((k) => <option key={k} value={k}>{qualityLabel[k]}</option>)}
              </select>
            </div>
          </div>
          {settings.expert ? (
            <div className="ctl">
              <label>Método de colocación</label>
              <select className="cc-input" value={sheet.method ?? "auto"} onChange={(e) => setSheet({ method: e.target.value as PlacementMethod })}>
                {(Object.keys(methodLabel) as PlacementMethod[]).map((m) => <option key={m} value={m}>{methodLabel[m]}</option>)}
              </select>
              <span className="hint">El método se aplica a la próxima colocación; «Auto optimizar» lo hace al cambiar copias o importar.</span>
            </div>
          ) : (
            <div className="micro-help">Modo básico: selección inteligente y forma real. Cambia a <b>Modo experto</b> para elegir métodos, compactación y más.</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <ToggleLine checked={settings.autoNest} onChange={(v) => setSettings({ autoNest: v })} label="Recolocar automáticamente" hint="Al importar, cambiar copias o editar medidas" />
            <ToggleLine checked={sheet.singlePage} onChange={(v) => setSheet({ singlePage: v })} label="Solo una plancha" hint="Avisa si algo no cabe en lugar de crear más hojas" />
          </div>
          <button type="button" className="cc-btn primary big" onClick={onOptimize}>✦ Optimizar la plancha</button>
          <div className="machine-box">
            <div className="preset-line"><b>Aprovechamiento</b><span>{Math.round(stats.efficiency * 100)} %</span></div>
            <div className="preset-line"><span>{stats.placed} piezas · {stats.pages} plancha{stats.pages === 1 ? "" : "s"}</span><span>{formatDuration(stats.timeSeconds)}</span></div>
            <div className="preset-line"><span>Método</span><span>{methodLabel[sheet.method ?? "auto"]}</span></div>
            <div className="preset-line"><span>Orientaciones usadas</span><span>{angleText}</span></div>
            <div className="preset-line"><span>Orientaciones disponibles</span><span>{sheet.rotation === "libre" ? "24 pasos de 15° (0°–345°)" : sheet.rotation === "90" ? "4 (0°/90°/180°/270°)" : "1 (0°)"}</span></div>
            <span className="micro-help">El aprovechamiento es la superficie real de las siluetas; los huecos no cuentan.</span>
            {sheet.width > machine.workWidth || sheet.height > machine.workHeight ? (
              <span style={{ color: "var(--danger)" }}>La plancha supera el área de {machine.name}.</span>
            ) : (
              <span>Dentro del área de {machine.name}.</span>
            )}
          </div>
        </Sect>
      )}

      {matches("optim") && (
        <Sect id="optim" title="Optimización" icon="sparkles" open={!!open.optim || (q.length >= 2 && SECTION_KEYWORDS.optim.includes(q))} toggle={toggle}>
          <div className="ctl">
            <label>Método</label>
            <select className="cc-input" value={sheet.method ?? "auto"} onChange={(e) => setSheet({ method: e.target.value as PlacementMethod })}>
              {(Object.keys(methodLabel) as PlacementMethod[]).map((m) => <option key={m} value={m}>{methodLabel[m]}</option>)}
            </select>
            <span className="hint">Greedy es el más rápido. Genético busca más combinaciones; puede tardar unos segundos.</span>
          </div>
          <div className="two">
            <div className="ctl">
              <label>Calidad</label>
              <select className="cc-input" value={sheet.quality} onChange={(e) => setSheet({ quality: e.target.value as Quality })}>
                {(Object.keys(qualityLabel) as Quality[]).map((k) => <option key={k} value={k}>{qualityLabel[k]}</option>)}
              </select>
            </div>
            <div className="ctl">
              <label>Forma</label>
              <select className="cc-input" value={sheet.packMode ?? "shape"} onChange={(e) => setSheet({ packMode: e.target.value as PackMode })}>
                <option value="shape">Forma real</option>
                <option value="box">Rectángulos</option>
              </select>
            </div>
          </div>
          <div className="ctl">
            <label>Objetivo de la colocación</label>
            <div className="segmented" role="tablist" aria-label="Objetivo de colocación">
              <button
                type="button"
                className={(settings.packStyle ?? "comfortable") === "comfortable" ? "active" : ""}
                onClick={() => setSettings({ packStyle: "comfortable", compact: false })}
              >
                Cómodo
              </button>
              <button
                type="button"
                className={(settings.packStyle ?? "comfortable") === "compact" ? "active" : ""}
                onClick={() => setSettings({ packStyle: "compact", compact: true })}
              >
                Compacto
              </button>
            </div>
            <span className="hint">Cómodo reparte las piezas por la plancha; Compacto las aprieta para ocupar el mínimo espacio.</span>
          </div>
          <div className="micro-help">Las figuras con imágenes se mueven y giran como una unidad. Si una no cabe, baja la separación o prueba la calidad Exacta.</div>
          <button type="button" className="cc-btn primary" onClick={onOptimize}>Recalcular ahora</button>
        </Sect>
      )}

      {matches("border") && (
        <Sect id="border" title="Borde / pegatina" icon="shapes" open={!!open.border || (q.length >= 2 && SECTION_KEYWORDS.border.includes(q))} toggle={toggle}>
          <div className="ctl">
            <label>Borde global</label>
            <div className="row">
              <Num value={borderAll} min={0} max={20} step={0.5} suffix="mm" onCommit={setBorderAll} />
              <button type="button" className="cc-btn" onClick={() => dispatch({ type: "SET_ALL_OFFSET", value: borderAll })}>Aplicar a todas</button>
            </div>
            <span className="hint">Se calcula sobre la forma final; los agujeros conservan su tamaño. En una imagen, el dibujo se graba y este contorno se corta.</span>
          </div>
          <div className="micro-help">
            Para ajustar una sola pieza, abre su tarjeta en la izquierda y despliega <b>Borde adicional</b>. Las figuras guardan el borde de cada miembro.
          </div>
          <div className="machine-box">
            <b>Kerf y separación</b>
            <span>El kerf compensa el grosor del haz en el corte. La separación ya se aplica al anidar; no la metas dos veces.</span>
          </div>
        </Sect>
      )}

      {matches("image") && (
        <Sect id="image" title="Imágenes" icon="image" open={!!open.image || (q.length >= 2 && SECTION_KEYWORDS.image.includes(q))} toggle={toggle}>
          <div className="ctl">
            <label>Al soltar una imagen</label>
            <select className="cc-input" value={settings.imageDropMode ?? "cut"} onChange={(e) => setSettings({ imageDropMode: e.target.value as ImageDropMode })}>
              <option value="cut">Silueta de corte</option>
              <option value="engrave-threshold">Grabar B/N</option>
              <option value="engrave-gray">Grabar en grises</option>
            </select>
            <span className="hint">Las imágenes dentro de un SVG siempre se importan como grabado, conservando su posición.</span>
          </div>
          <div className="ctl">
            <label>Salida del grabado vectorial</label>
            <select className="cc-input" value={settings.engraveOutput} onChange={(e) => setSettings({ engraveOutput: e.target.value as "raster" | "vector" })}>
              <option value="raster">Mapa de bits (recomendado)</option>
              <option value="vector">Puntos de semitono</option>
            </select>
          </div>
          <div className="ctl">
            <label>Densidad de puntos</label>
            <input type="range" min={1} max={8} step={0.5} value={settings.ditherDotsPerMm} onChange={(e) => setSettings({ ditherDotsPerMm: Number(e.target.value) })} />
            <span className="hint">{settings.ditherDotsPerMm} puntos/mm · solo para salida vectorial</span>
          </div>
          <div className="two">
            <button type="button" className="cc-btn" onClick={onOpenImageDialog}>Importar imagen…</button>
            <button type="button" className="cc-btn" onClick={onOpenSvgDialog}>Revisar SVG…</button>
          </div>
        </Sect>
      )}

      {matches("material") && (
        <Sect id="material" title="Material y madera" icon="wood" open={!!open.material || (q.length >= 2 && SECTION_KEYWORDS.material.includes(q))} toggle={toggle}>
          <div className="two">
            <div className="ctl">
              <label>Máquina</label>
              <select className="cc-input" value={settings.machineId} onChange={(e) => setSettings({ machineId: e.target.value })}>
                {MACHINES.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div className="ctl">
              <label>Material</label>
              <select className="cc-input" value={settings.materialId} onChange={(e) => setSettings({ materialId: e.target.value })}>
                {MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
          <div className="machine-box">
            <b>{material.name} · {material.thickness} mm</b>
            <span>{machine.name} · {machine.watt} W</span>
            <div className="preset-line"><span>Corte</span><span>{cut.power}% · {cut.speed} mm/min · {cut.passes} pas.</span></div>
            <div className="preset-line"><span>Grabado</span><span>{eng.power}% · {eng.speed} mm/min · {eng.passes} pas.</span></div>
            <div className="preset-line"><span>Marcado</span><span>{score.power}% · {score.speed} mm/min</span></div>
          </div>
          <div className="ctl">
            <label>Madera de la simulación</label>
            <div className="species-grid">
              {SPECIES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`species-chip ${settings.previewSpecies === s.id ? "on" : ""}`}
                  onClick={() => setSettings({ previewSpecies: s.id })}
                  title={s.name}
                >
                  <span className="swatch" style={{ background: `linear-gradient(135deg, ${s.light}, ${s.base} 50%, ${s.dark})` }} />
                  {s.name}
                </button>
              ))}
            </div>
          </div>
          <div className="ctl">
            <label>Tono del láser</label>
            <div className="tone-row">
              {BURN_TONES.map((t) => (
                <button key={t.id} type="button" className={`tone-chip ${(settings.previewBurnTone ?? "miel") === t.id ? "on" : ""}`} onClick={() => setSettings({ previewBurnTone: t.id })}>
                  <i style={{ background: t.color }} /> {t.name}
                </button>
              ))}
            </div>
          </div>
          <div className="two">
            <div className="ctl">
              <label>Intensidad</label>
              <input type="range" min={5} max={100} step={1} value={settings.previewPower} onChange={(e) => setSettings({ previewPower: Number(e.target.value) })} />
              <span className="hint">{settings.previewPower} %</span>
            </div>
            <div className="ctl">
              <label>Velocidad</label>
              <input type="range" min={300} max={8000} step={100} value={settings.previewSpeed} onChange={(e) => setSettings({ previewSpeed: Number(e.target.value) })} />
              <span className="hint">{settings.previewSpeed} mm/min</span>
            </div>
          </div>
          <div className="ctl">
            <label>Pasadas</label>
            <input type="range" min={1} max={4} step={1} value={settings.previewPasses} onChange={(e) => setSettings({ previewPasses: Number(e.target.value) })} />
            <span className="hint">{settings.previewPasses}</span>
          </div>
          <div className="two">
            <button type="button" className="cc-btn" onClick={() => onView("wood")}>Ver en madera</button>
            <button type="button" className="cc-btn primary" onClick={() => onView("wood3d")}>Ver en 3D</button>
          </div>
          <div className="ctl">
            <label>Grosor / profundidad</label>
            <input
              type="range"
              min={0.5}
              max={12}
              step={0.5}
              value={settings.wood3dDepth ?? 3}
              onChange={(e) => setSettings({ wood3dDepth: Number(e.target.value) })}
            />
            <span className="hint">{(settings.wood3dDepth ?? 3).toFixed(1)} mm · arrastra en la vista 3D para orbitar y usa la rueda para acercar.</span>
          </div>
          <div className="two">
            <button type="button" className="cc-btn" onClick={onCompare}>Comparar 4 × 4</button>
            <button type="button" className="cc-btn" onClick={() => onView("plan")}>Volver a la plancha</button>
          </div>
          <button type="button" className="cc-btn" onClick={onTestCard}>Descargar tarjeta de pruebas</button>
          <div className="micro-help">La simulación es orientativa: cada lente, tablero y velocidad quema distinto. Usa una prueba pequeña antes de la pieza buena.</div>
        </Sect>
      )}

      {matches("view") && (
        <Sect id="view" title="Vista y tema" icon="eye" open={!!open.view || (q.length >= 2 && SECTION_KEYWORDS.view.includes(q))} toggle={toggle}>
          <div className="ctl">
            <label>Tema</label>
            <div className="theme-grid">
              {THEMES.map((t) => (
                <button key={t.key} type="button" className={`theme-chip ${theme === t.key ? "active" : ""}`} onClick={() => onTheme(t.key)} title={t.label}>
                  <span className="dot" style={{ background: t.colors.accent }} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="two">
            <button type="button" className={`cc-btn ${view === "plan" ? "primary" : ""}`} onClick={() => onView("plan")}>Plancha</button>
            <button type="button" className={`cc-btn ${view === "wood" ? "primary" : ""}`} onClick={() => onView("wood")}>Madera</button>
          </div>
          <ToggleLine checked={showGrid} onChange={onShowGrid} label="Cuadrícula y guías de la plancha" />
          <div className="ctl">
            <label>Leyenda de capas</label>
            <div className="layer-legend">
              {LAYERS.map((l) => <div className="layer-row" key={l.id}><span className="layer-dot" style={{ background: l.color }} /><b>{l.name}</b><span>{l.description}</span></div>)}
            </div>
          </div>
          <div className="micro-help">El tema se recuerda en este navegador. Eevee es el inicial; también están Wiwi, Fidough, Sprigatito y el resto de la paleta CryCat.</div>
        </Sect>
      )}

      {matches("extras") && (
        <Sect id="extras" title="Extras y LightBurn" icon="help" open={!!open.extras || (q.length >= 2 && SECTION_KEYWORDS.extras.includes(q))} toggle={toggle}>
          <div className="machine-box">
            <b>Exportación para LightBurn</b>
            <span>SVG en milímetros reales, capas por color, imágenes incrustadas, kerf, puentes, marcas y CSV.</span>
            <span>El ZIP incluye SVG por plancha, proyecto JSON, LEEME, CSV, PNGs y previews.</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <ToggleLine checked={settings.exportKerf} onChange={(v) => setSettings({ exportKerf: v })} label="Compensar kerf" />
            <ToggleLine checked={settings.exportBridges} onChange={(v) => setSettings({ exportBridges: v })} label="Puentes de sujeción" />
            <ToggleLine checked={settings.exportFrame} onChange={(v) => setSettings({ exportFrame: v })} label="Recuadro exterior" />
            <ToggleLine checked={settings.exportOrder} onChange={(v) => setSettings({ exportOrder: v })} label="Ordenar recorridos" />
            <ToggleLine checked={settings.exportNotes} onChange={(v) => setSettings({ exportNotes: v })} label="Notas y material en el SVG" />
          </div>
          <button type="button" className="cc-btn primary" onClick={() => dispatch({ type: "SET_UI", patch: { showExportDialog: true } })}>Abrir exportación</button>
          <button type="button" className="cc-btn" onClick={onOpenLibrary}>Abrir biblioteca de figuras</button>
          <button type="button" className="cc-btn" onClick={onHelp}>Cómo usar LaserCat</button>
          <button type="button" className="cc-btn" onClick={onReport}>Reportar un problema</button>
          <div className="micro-help">
            <b>Privacidad:</b> todo se calcula en tu navegador. Los archivos no se suben a ningún servidor. Puedes descargar el proyecto en JSON y la figura en JSON/ZIP.
          </div>
          <div className="micro-help">
            <b>Historial:</b> Ctrl+Z / Ctrl+Y. Cada figura guardada conserva sus imágenes. Versión 1.0.
          </div>
        </Sect>
      )}

      <div className="settings-credits">
        LaserCat · hecho por <b>Daniel Hernández Ferrándiz</b> para el taller láser.
        <br />Misma interfaz que CryCat, con corte y grabado en milímetros.
      </div>
    </div>
  );
}

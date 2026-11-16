import { useEffect, useMemo, useState } from "react";
import type { Dispatch } from "react";
import type { Assembly, Doc, Part, Placement, SelectionState } from "../types";
import type { Action } from "../lib/store";
import { fmt } from "../lib/geom";
import {
  computeStats,
  effectiveGeometry,
  formatDuration,
  laserPresetFor,
  MACHINE_BY_ID,
  MATERIAL_BY_ID,
} from "../lib/laser";
import { assemblyGeometry, getGroups } from "../lib/assembly";
import {
  buildGroupZip,
  groupJson,
  groupParts,
  groupThumbnail,
  notifyGroupsChanged,
  saveGroupToLibrary,
} from "../lib/groupLibrary";
import { downloadBytes, downloadText, safeFileName } from "../lib/download";
import { PartThumb } from "./PartThumb";
import { Badge, Button, Icon, IconButton, NumberField, Progress, Segmented, Stepper, Toggle } from "./UI";

function TextField({
  value,
  onCommit,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="text-input"
      value={text}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (text.trim() && text !== value) onCommit(text.trim()); else setText(value); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { setText(value); e.currentTarget.blur(); }
      }}
    />
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="inspector-section">
      <div className="section-head">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Inspector({
  doc,
  dispatch,
  selection,
}: {
  doc: Doc;
  dispatch: Dispatch<Action>;
  selection: SelectionState;
}) {
  const [aspectLock, setAspectLock] = useState(true);

  const placements = useMemo(
    () => doc.placements.filter((p) => selection.placementIds.includes(p.id)),
    [doc.placements, selection.placementIds],
  );
  const parts = useMemo(
    () => doc.parts.filter((p) => selection.partIds.includes(p.id)),
    [doc.parts, selection.partIds],
  );
  const placement: Placement | null = placements.length === 1 ? placements[0] : null;
  const part: Part | null =
    parts.length === 1
      ? parts[0]
      : placement
        ? doc.parts.find((p) => p.id === placement.partId) || null
        : null;

  const group =
    placements.length > 1 &&
    placements.every((p) => p.assemblyId && p.assemblyId === placements[0].assemblyId)
      ? getGroups(doc).find((g) => g.id === placements[0].assemblyId)
      : undefined;

  if (group) {
    return <GroupInspector doc={doc} dispatch={dispatch} group={group} placements={placements} />;
  }

  if (placements.length > 1) {
    const pinnedCount = placements.filter((p) => p.pinned).length;
    return (
      <aside className="inspector">
        <div className="inspector-head">
          <div>
            <span className="eyebrow">Selección</span>
            <h2>{placements.length} piezas</h2>
          </div>
          <Badge kind="neutral">{pinnedCount} fijadas</Badge>
        </div>
        <div className="inspector-body">
          <CalloutBox icon="move">
            Arrastra cualquiera para moverlas juntas. Las medidas exactas se editan de una en una.
          </CalloutBox>
          <div className="action-grid">
            <Button
              variant="secondary"
              icon="pin"
              onClick={() => placements.forEach((p) => dispatch({ type: "PIN_PLACEMENT", id: p.id, pinned: true }))}
            >
              Fijar todas
            </Button>
            <Button
              variant="secondary"
              icon="unlock"
              onClick={() => placements.forEach((p) => dispatch({ type: "PIN_PLACEMENT", id: p.id, pinned: false }))}
            >
              Liberar
            </Button>
            <Button
              variant="secondary"
              icon="rotate"
              onClick={() => dispatch({ type: "ROTATE_SELECTION", placementIds: placements.map((p) => p.id), delta: 90 })}
            >
              Girar 90°
            </Button>
            <Button
              variant="secondary"
              icon="shapes"
              onClick={() => dispatch({ type: "GROUP_PLACEMENTS", placementIds: placements.map((p) => p.id), name: "Grupo" })}
            >
              Agrupar
            </Button>
            <Button
              variant="secondary"
              icon="trash"
              onClick={() => placements.forEach((p) => dispatch({ type: "DELETE_PLACEMENT", id: p.id }))}
            >
              Quitar
            </Button>
          </div>
          <div className="selection-list">
            {placements.map((p) => {
              const pt = doc.parts.find((x) => x.id === p.partId);
              return (
                <button
                  key={p.id}
                  type="button"
                  className="selection-row"
                  onClick={() => dispatch({ type: "SELECT", partIds: pt ? [pt.id] : [], placementIds: [p.id] })}
                >
                  {pt && <PartThumb part={pt} size={30} />}
                  <span>{pt?.name || "Pieza"}</span>
                  <em>pág. {p.page + 1}</em>
                </button>
              );
            })}
          </div>
        </div>
      </aside>
    );
  }

  if (!part) return <EmptyInspector doc={doc} dispatch={dispatch} />;

  const geo = effectiveGeometry(part);
  const placedCount = doc.placements.filter((p) => p.partId === part.id).length;
  const update = (patch: Partial<Part>, nest = false) =>
    dispatch({ type: "UPDATE_PART", id: part.id, patch, nest, key: `part-${part.id}-${Object.keys(patch).join("-")}` });
  const setPlacement = (patch: Partial<Placement>) => {
    if (placement) dispatch({ type: "SET_PLACEMENT", id: placement.id, patch });
  };
  const changeWidth = (w: number) => {
    const h = aspectLock && part.width > 0 ? Math.max(0.1, (part.height * w) / part.width) : part.height;
    dispatch({ type: "RESIZE_PART", id: part.id, width: w, height: h });
  };
  const changeHeight = (h: number) => {
    const w = aspectLock && part.height > 0 ? Math.max(0.1, (part.width * h) / part.height) : part.width;
    dispatch({ type: "RESIZE_PART", id: part.id, width: w, height: h });
  };

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div className="inspector-part">
          <PartThumb part={part} size={52} />
          <div>
            <span className="eyebrow">{part.source === "image" ? "Imagen" : part.source === "demo" ? "Ejemplo" : "Vector"}</span>
            <h2>{part.name}</h2>
          </div>
        </div>
        <div className="head-actions">
          <IconButton
            icon="copy"
            title="Duplicar"
            onClick={() =>
              placement
                ? dispatch({ type: "DUPLICATE_PLACEMENT", id: placement.id })
                : dispatch({ type: "DUPLICATE_PART", id: part.id })
            }
          />
          <IconButton
            icon="trash"
            title="Eliminar diseño"
            onClick={() => dispatch({ type: "REMOVE_PARTS", ids: [part.id] })}
          />
        </div>
      </div>

      <div className="inspector-body">
        <Section title="Identidad">
          <TextField value={part.name} onCommit={(v) => update({ name: v })} ariaLabel="Nombre de la pieza" />
          <div className="inline-pills">
            <Badge kind="neutral">{fmt(part.width)} × {fmt(part.height)} mm</Badge>
            <Badge kind={placedCount < part.copies ? "warn" : "ok"}>{placedCount}/{part.copies} en plancha</Badge>
          </div>
        </Section>

        <Section title="Operación">
          <Segmented
            value={part.operation}
            onChange={(v) => update({ operation: v })}
            options={[
              { value: "cut", label: "Cortar" },
              { value: "engrave", label: "Grabar" },
              { value: "score", label: "Marcar" },
            ]}
          />
          <p className="micro-help">
            {part.operation === "cut"
              ? "El contorno se corta. Si hay borde, se corta el contorno exterior."
              : part.operation === "engrave"
                ? "El relleno se graba. Si hay borde, el diseño se graba y el borde se corta."
                : "Solo se marca la línea, sin atravesar la madera."}
          </p>
        </Section>

        <Section title="Tamaño y copias">
          <div className="size-row">
            <label>
              <span>Ancho</span>
              <NumberField value={part.width} min={0.2} max={2000} step={0.5} suffix="mm" onChange={changeWidth} />
            </label>
            <button
              type="button"
              className={`aspect-btn ${aspectLock ? "on" : ""}`}
              onClick={() => setAspectLock(!aspectLock)}
              title={aspectLock ? "Proporción bloqueada" : "Proporción libre"}
            >
              <Icon name={aspectLock ? "lock" : "unlock"} size={15} />
            </button>
            <label>
              <span>Alto</span>
              <NumberField value={part.height} min={0.2} max={2000} step={0.5} suffix="mm" onChange={changeHeight} />
            </label>
          </div>
          <div className="copy-row">
            <span>Copias</span>
            <Stepper value={part.copies} min={0} max={999} onChange={(v) => dispatch({ type: "SET_COPIES", id: part.id, copies: v })} />
            <em>{placedCount < part.copies ? "Faltan piezas por colocar" : "Todas colocadas"}</em>
          </div>
        </Section>

        <Section title="Borde / offset" action={part.offsetMm > 0 ? <Badge kind="cut">+{fmt(part.offsetMm)} mm</Badge> : undefined}>
          <div className="offset-row">
            <NumberField
              value={part.offsetMm}
              min={0}
              max={40}
              step={0.5}
              suffix="mm"
              onChange={(v) => update({ offsetMm: v }, true)}
            />
            <div className="offset-presets">
              {[0, 1, 2, 3, 5].map((v) => (
                <button
                  key={v}
                  type="button"
                  className={Math.abs(part.offsetMm - v) < 0.01 ? "active" : ""}
                  onClick={() => update({ offsetMm: v }, true)}
                >
                  {v === 0 ? "sin" : `+${v}`}
                </button>
              ))}
            </div>
          </div>
          <p className="micro-help">
            Expande el contorno alrededor del diseño. Perfecto para pegatinas, imanes y llaveros.
            {part.operation === "engrave" && part.offsetMm > 0 ? " El diseño se graba y el borde se corta." : ""}
            {part.operation === "cut" && part.offsetMm > 0 ? " Se corta el contorno exterior." : ""}
          </p>
          {part.offsetMm > 0 && part.operation === "cut" && (
            <Toggle
              checked={part.separateBorder}
              onChange={(v) => update({ separateBorder: v })}
              label="Cortar también el diseño interior"
              hint="Útil para pegatinas de dos capas."
            />
          )}
          {geo.hasOffset && (
            <div className="dim-note">
              Tamaño final con borde: <b>{fmt(geo.width)} × {fmt(geo.height)} mm</b>
            </div>
          )}
        </Section>

        {placement && (
          <Section title="Posición en la plancha">
            <div className="two-col">
              <label>
                <span>X</span>
                <NumberField value={placement.x} min={-500} max={2000} step={0.5} suffix="mm" onChange={(v) => setPlacement({ x: v })} />
              </label>
              <label>
                <span>Y</span>
                <NumberField value={placement.y} min={-500} max={2000} step={0.5} suffix="mm" onChange={(v) => setPlacement({ y: v })} />
              </label>
            </div>
            <div className="rotate-row">
              <span>Giro</span>
              <NumberField value={placement.angle} min={0} max={359} step={1} suffix="°" onChange={(v) => setPlacement({ angle: v })} />
              <IconButton icon="rotate" title="Girar 90°" onClick={() => dispatch({ type: "ROTATE_PLACEMENT", id: placement.id, delta: 90 })} />
              <IconButton icon="rotate" title="Girar -90°" className="flip" onClick={() => dispatch({ type: "ROTATE_PLACEMENT", id: placement.id, delta: -90 })} />
            </div>
            <div className="inline-toggles">
              <Toggle checked={placement.mirror} onChange={(v) => setPlacement({ mirror: v })} label="Espejo" />
              <Toggle
                checked={placement.pinned}
                onChange={(v) => dispatch({ type: "PIN_PLACEMENT", id: placement.id, pinned: v })}
                label="Fijar"
                hint="Se queda donde está al optimizar."
              />
            </div>
            <div className="placement-actions">
              <Button size="sm" variant="ghost" icon="copy" onClick={() => dispatch({ type: "DUPLICATE_PLACEMENT", id: placement.id })}>
                Duplicar
              </Button>
              <Button size="sm" variant="ghost" icon="trash" onClick={() => dispatch({ type: "DELETE_PLACEMENT", id: placement.id })}>
                Quitar de la plancha
              </Button>
            </div>
          </Section>
        )}

        {part.kind === "raster" && part.raster && (
          <Section title="Imagen de grabado">
            <div className="raster-meta">
              <img src={part.raster.dataUrl} alt="Grabado" />
              <div>
                <b>{part.raster.width} × {part.raster.height} px</b>
                <span>{Math.round(part.raster.dpi)} ppp</span>
                <span>Modo: {part.raster.mode === "grayscale" ? "grises" : part.raster.mode === "dither" ? "tramado" : "B/N"}</span>
              </div>
            </div>
            <p className="micro-help">
              Para cambiar el umbral o el tramado, vuelve a importar la imagen con el modo deseado.
            </p>
            <Button size="sm" variant="secondary" icon="image" onClick={() => dispatch({ type: "SET_UI", patch: { showImageDialog: true } })}>
              Reimportar con otro modo
            </Button>
          </Section>
        )}

        <Section title="Notas">
          <textarea
            className="notes-input"
            placeholder="Material, cliente, ajustes especiales…"
            value={part.notes || ""}
            onChange={(e) => update({ notes: e.target.value })}
          />
        </Section>
      </div>
    </aside>
  );
}

function GroupInspector({
  doc,
  dispatch,
  group,
  placements,
}: {
  doc: Doc;
  dispatch: Dispatch<Action>;
  group: Assembly;
  placements: Placement[];
}) {
  const parts = groupParts(doc, group);
  const geo = assemblyGeometry(group, parts);
  const thumb = groupThumbnail(doc, group);
  const pinned = placements.length > 0 && placements.every((p) => p.pinned);
  const total = parts.length * Math.max(1, group.copies);

  const saveFigure = () => {
    const ok = saveGroupToLibrary(group, parts, thumb);
    downloadText(
      `${safeFileName(group.name, "figura")}.lasercat-group.json`,
      groupJson(group, parts),
      "application/json",
    );
    notifyGroupsChanged();
    dispatch({
      type: "TOAST",
      text: ok
        ? "Figura guardada con sus imágenes: biblioteca + JSON."
        : "JSON descargado, pero la biblioteca local está llena.",
      kind: ok ? "ok" : "warn",
    });
  };

  const exportFigure = () => {
    const bundle = buildGroupZip(doc, group);
    if (!bundle) {
      dispatch({ type: "TOAST", text: "No se pudo preparar la figura.", kind: "error" });
      return;
    }
    downloadBytes(bundle.name, bundle.bytes);
    dispatch({ type: "TOAST", text: "Figura exportada con SVG, imágenes y LEEME.", kind: "ok" });
  };

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div className="inspector-part">
          <div className="group-head-thumb">
            {thumb ? <img src={thumb} alt="" /> : <Icon name="shapes" size={24} />}
          </div>
          <div>
            <span className="eyebrow">Figura · {parts.length} piezas</span>
            <h2>{group.name}</h2>
          </div>
        </div>
        <div className="head-actions">
          <IconButton
            icon="copy"
            title="Duplicar figura"
            onClick={() => parts[0] && dispatch({ type: "DUPLICATE_PART", id: parts[0].id })}
          />
          <IconButton
            icon="trash"
            title="Eliminar figura"
            onClick={() => dispatch({ type: "REMOVE_PARTS", ids: parts.map((p) => p.id) })}
          />
        </div>
      </div>

      <div className="inspector-body">
        <Section title="Identidad">
          <TextField
            value={group.name}
            onCommit={(v) => dispatch({ type: "RENAME_ASSEMBLY", id: group.id, name: v })}
            ariaLabel="Nombre de la figura"
          />
          <div className="inline-pills">
            <Badge kind="neutral">{fmt(geo.width)} × {fmt(geo.height)} mm</Badge>
            <Badge kind="ok">{group.copies} copia{group.copies === 1 ? "" : "s"}</Badge>
            {parts.some((p) => p.kind === "raster") && <Badge kind="engrave">con imagen</Badge>}
          </div>
          <div className="copy-row">
            <span>Copias de la figura</span>
            <Stepper
              value={group.copies}
              min={1}
              max={99}
              onChange={(v) => dispatch({ type: "SET_ASSEMBLY_COPIES", id: group.id, copies: v })}
            />
            <em>{placements.length} de {total} piezas colocadas</em>
          </div>
        </Section>

        <Section title="Composición">
          <div className="assembly-members">
            {parts.map((part) => (
              <div className="assembly-member" key={part.id}>
                <PartThumb part={part} size={34} />
                <div className="assembly-member-info">
                  <b>{part.name}</b>
                  <span>
                    {part.kind === "raster" ? "Imagen de grabado" : `${fmt(part.width)} × ${fmt(part.height)} mm`}
                  </span>
                </div>
                <select
                  className="select mini"
                  value={part.operation}
                  disabled={part.kind === "raster"}
                  onChange={(e) =>
                    dispatch({
                      type: "UPDATE_PART",
                      id: part.id,
                      patch: { operation: e.target.value as Part["operation"] },
                    })
                  }
                >
                  <option value="cut">Cortar</option>
                  <option value="engrave">Grabar</option>
                  <option value="score">Marcar</option>
                </select>
              </div>
            ))}
          </div>
          <p className="micro-help">
            La figura se mueve, gira y se anida como una unidad. Las imágenes se conservan al guardar y exportar.
          </p>
        </Section>

        <Section title="Acciones">
          <div className="action-grid">
            <Button variant="secondary" icon="rotate" onClick={() => dispatch({ type: "ROTATE_ASSEMBLY", id: group.id, delta: 90 })}>
              Girar 90°
            </Button>
            <Button variant="secondary" icon="rotate" className="flip" onClick={() => dispatch({ type: "ROTATE_ASSEMBLY", id: group.id, delta: -90 })}>
              Girar −90°
            </Button>
            <Button variant="secondary" icon={pinned ? "unlock" : "pin"} onClick={() => dispatch({ type: "PIN_ASSEMBLY", id: group.id, pinned: !pinned })}>
              {pinned ? "Liberar" : "Fijar"}
            </Button>
            <Button variant="secondary" icon="shapes" onClick={() => dispatch({ type: "UNGROUP", id: group.id })}>
              Desagrupar
            </Button>
          </div>
        </Section>

        <Section title="Guardar esta figura">
          <div className="save-group-actions">
            <Button variant="primary" icon="save" className="wide" onClick={saveFigure}>
              Guardar «{group.name}»
            </Button>
            <Button variant="secondary" icon="download" className="wide" onClick={exportFigure}>
              Exportar figura para LightBurn (ZIP)
            </Button>
          </div>
          <p className="micro-help">
            Se guarda con sus <b>imágenes incrustadas</b>, sus piezas de corte y su propio nombre. El JSON sirve para
            reinsertarla en LaserCat; el ZIP incluye SVG por capas, imágenes, CSV y LEEME.
          </p>
        </Section>

        <p className="inspector-foot">
          Para volver a importar figuras desde LightBurn, exporta <b>SVG con imágenes incrustadas</b> o un <b>.lbrn2</b>
          {" "}(soporte nativo en camino).
        </p>
      </div>
    </aside>
  );
}

function CalloutBox({ icon, children }: { icon: "move" | "info" | "pin"; children: React.ReactNode }) {
  return (
    <div className="callout callout-info">
      <Icon name={icon} size={16} />
      <div>{children}</div>
    </div>
  );
}

function EmptyInspector({ doc, dispatch }: { doc: Doc; dispatch: Dispatch<Action> }) {
  const stats = computeStats(doc);
  const material = MATERIAL_BY_ID[doc.settings.materialId] || MATERIAL_BY_ID.tilo;
  const machine = MACHINE_BY_ID[doc.settings.machineId] || MACHINE_BY_ID.s30;
  const cuts = laserPresetFor(material.id, "cut", machine.id);
  const eng = laserPresetFor(material.id, "engrave", machine.id);

  const missing = doc.parts.reduce((n, p) => n + Math.max(0, p.copies - doc.placements.filter((pl) => pl.partId === p.id).length), 0);
  const outside = doc.placements.filter((pl) => {
    const part = doc.parts.find((p) => p.id === pl.partId);
    if (!part) return false;
    const g = effectiveGeometry(part);
    return pl.x < doc.sheet.margin - 0.01 || pl.y < doc.sheet.margin - 0.01 ||
      pl.x + g.width > doc.sheet.width - doc.sheet.margin + 0.01 ||
      pl.y + g.height > doc.sheet.height - doc.sheet.margin + 0.01;
  }).length;
  const unplaced = missing + outside;

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div>
          <span className="eyebrow">Resumen</span>
          <h2>{doc.name || "Sin título"}</h2>
        </div>
        <Badge kind={stats.efficiency > 0.6 ? "ok" : "neutral"}>{Math.round(stats.efficiency * 100)} %</Badge>
      </div>
      <div className="inspector-body">
        <div className="summary-card">
          <div className="summary-row">
            <span>Plancha</span>
            <b>{fmt(doc.sheet.width)} × {fmt(doc.sheet.height)} mm</b>
          </div>
          <div className="summary-row">
            <span>Piezas</span>
            <b>{doc.placements.length} / {doc.parts.reduce((s, p) => s + p.copies, 0)}</b>
          </div>
          <div className="summary-row">
            <span>Tiempo estimado</span>
            <b>{formatDuration(stats.timeSeconds)}</b>
          </div>
          <Progress value={stats.efficiency} />
          <div className="summary-row muted">
            <span>Aprovechamiento</span>
            <span>{Math.round(stats.efficiency * 100)} %</span>
          </div>
        </div>

        <Section title="Máquina y material">
          <div className="mini-meta">
            <span className="mini-icon"><Icon name="flame" size={18} /></span>
            <div>
              <b>{machine.name}</b>
              <em>{material.name} · {material.thickness} mm</em>
            </div>
          </div>
          <div className="preset-rows compact">
            <div><span className="dot dot-cut" /> Corte {cuts.power}% · {cuts.speed} mm/min</div>
            <div><span className="dot dot-engrave" /> Grabado {eng.power}% · {eng.speed} mm/min</div>
          </div>
          <Button size="sm" variant="ghost" icon="settings" onClick={() => dispatch({ type: "SET_UI", patch: { tab: "grabado" } })}>
            Cambiar ajustes
          </Button>
        </Section>

        <Section title="Estado">
          {unplaced > 0 ? (
            <div className="warn-list">
              {missing > 0 && <div><Icon name="alert" size={15} /> {missing} copia(s) sin colocar</div>}
              {outside > 0 && <div><Icon name="alert" size={15} /> {outside} pieza(s) fuera del margen</div>}
            </div>
          ) : (
            <div className="ok-line"><Icon name="check" size={16} /> Todo colocado dentro del margen</div>
          )}
          {doc.parts.length === 0 && (
            <p className="micro-help">La plancha está vacía. Importa un SVG, una imagen o crea una forma.</p>
          )}
        </Section>

        <Section title="Atajos de taller">
          <ul className="shortcut-list">
            <li><kbd>R</kbd> girar 90° <kbd>Mayús</kbd>+<kbd>R</kbd> al revés</li>
            <li><kbd>Ctrl</kbd>+<kbd>D</kbd> duplicar · <kbd>Supr</kbd> quitar</li>
            <li><kbd>F</kbd> encuadrar · <kbd>Ctrl</kbd>+<kbd>Z</kbd> deshacer</li>
            <li><kbd>Alt</kbd> al arrastrar: sin imán de 0,5 mm</li>
          </ul>
        </Section>

        <div className="inspector-cta">
          <Button variant="primary" icon="download" className="wide" onClick={() => dispatch({ type: "SET_UI", patch: { showExportDialog: true } })}>
            Exportar para LightBurn
          </Button>
          <Button variant="secondary" icon="wood" className="wide" onClick={() => dispatch({ type: "SET_UI", patch: { view: "wood" } })}>
            Ver en madera
          </Button>
        </div>

        <p className="inspector-foot">
          LaserCat calcula todo en tu navegador. Tus archivos no se suben a ningún servidor.
        </p>
      </div>
    </aside>
  );
}

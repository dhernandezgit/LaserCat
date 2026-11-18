import { useEffect, useState } from "react";
import type { Doc } from "../types";
import { laserPresetFor, MACHINE_BY_ID, MATERIAL_BY_ID, MATERIALS } from "../lib/laser";
import { Badge, Icon, Modal } from "./UI";

const SECTIONS = [
  { id: "inicio", label: "Empezar" },
  { id: "svg", label: "Importar SVG" },
  { id: "pegatinas", label: "Pegatinas" },
  { id: "lightburn", label: "LightBurn" },
  { id: "materiales", label: "Materiales" },
  { id: "atajos", label: "Atajos" },
  { id: "creditos", label: "Créditos" },
] as const;

export function HelpDialog({ open, doc, onClose, initialSection = "inicio" }: { open: boolean; doc: Doc; onClose: () => void; initialSection?: (typeof SECTIONS)[number]["id"] }) {
  const [section, setSection] = useState<(typeof SECTIONS)[number]["id"]>(initialSection);
  useEffect(() => {
    if (open) setSection(initialSection);
  }, [open, initialSection]);
  const material = MATERIAL_BY_ID[doc.settings.materialId] || MATERIAL_BY_ID.tilo;
  const machine = MACHINE_BY_ID[doc.settings.machineId] || MACHINE_BY_ID.s30;
  const cut = laserPresetFor(material.id, "cut", machine.id);
  const eng = laserPresetFor(material.id, "engrave", machine.id);

  return (
    <Modal open={open} onClose={onClose} title="Taller LaserCat" subtitle="Guía rápida, importación y ajustes para LightBurn." width="1040px" className="help-modal">
      <div className="help-layout">
        <nav className="help-nav">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className={section === s.id ? "active" : ""} onClick={() => setSection(s.id)}>
              {s.label}
            </button>
          ))}
          <div className="help-version">
            <Badge kind="neutral">v1.0</Badge>
            <span>Todo se calcula en tu navegador.</span>
          </div>
        </nav>

        <div className="help-content">
          {section === "inicio" && (
            <>
              <h2>Del SVG a la madera, sin sustos</h2>
              <p className="lead">
                LaserCat prepara la plancha, separa las piezas de un SVG, calcula el hueco real entre formas y deja un
                archivo listo para importar en LightBurn. Está pensado para diodos como la <b>SculpFun S30</b>, pero
                funciona con cualquier láser.
              </p>
              <div className="help-steps">
                <div><span>1</span><b>Importa</b><p>Arrastra un SVG o una imagen. Las imágenes grandes del SVG se convierten en figuras que engloban sus cortes.</p></div>
                <div><span>2</span><b>Ordena</b><p>Revisa Grupos, Piezas, Mapa y Parejas. Renombra, agrupa o separa antes de añadir.</p></div>
                <div><span>3</span><b>Ajusta</b><p>Elige plancha (30×30 cm por defecto), margen de 5 mm, separación y kerf.</p></div>
                <div><span>4</span><b>Previsualiza</b><p>Cambia de madera, tono e intensidad para ver cómo quedará antes de quemar.</p></div>
                <div><span>5</span><b>Exporta</b><p>Descarga los SVG por capas y el ZIP con instrucciones para LightBurn.</p></div>
              </div>
              <div className="help-note">
                <Icon name="info" size={16} />
                <p>La plancha inicial es de 300×300 mm con 5 mm de margen. Se puede cambiar en <b>Plancha</b>. El tema <b>Eevee</b> es el predeterminado; cámbialo con el badge de <b>Ajustes → Vista y tema</b>.</p>
              </div>
            </>
          )}

          {section === "svg" && (
            <>
              <h2>Importar un SVG sin perder la cabeza</h2>
              <p>Arrastra un SVG a la columna <b>Piezas</b> y se añade y coloca solo. El importador separa cada forma en <b>islas</b> (contorno exterior + agujeros) y las agrupa por cercanía, por las imágenes grandes y por los grupos del archivo original. Si quieres revisar escala, grupos y operaciones antes de añadir, pulsa <b>Revisar SVG</b>.</p>
              <div className="help-note">
                <Icon name="image" size={16} />
                <p><b>SVG con imágenes:</b> si el SVG lleva las imágenes <b>incrustadas</b> (data URL), se importan como grabado y la imagen grande se convierte en el ancla de una <b>figura</b>. Sus cortes, ranuras y puertas se agrupan a su alrededor. Las imágenes enlazadas desde fuera no se pueden leer.</p>
              </div>
              <div className="help-cols">
                <div>
                  <h3>Qué detecta</h3>
                  <ul>
                    <li>Un solo <code>&lt;path&gt;</code> con 40 iconos → 40 piezas.</li>
                    <li>Ojos, letras o detalles dentro de una silueta → agujeros, no piezas sueltas.</li>
                    <li>Grupos de Inkscape e Illustrator → se respetan como pistas.</li>
                    <li>Imágenes incrustadas → grabado + figura automática.</li>
                    <li>Trazos sin relleno → contorno de corte del grosor del trazo.</li>
                    <li>Unidades mm, cm, pulgadas, puntos y viewBox.</li>
                  </ul>
                </div>
                <div>
                  <h3>Si algo sale mal</h3>
                  <ul>
                    <li>Baja <b>Cercanía</b> para separar más.</li>
                    <li>Sube <b>Cercanía</b> o usa <b>Fusionar</b> para unir geometrías.</li>
                    <li><b>Grupos</b> muestra cada figura; puedes renombrarla, cambiar copias, separar o quitar miembros.</li>
                    <li><b>Mapa</b> muestra las piezas y los recuadros de cada figura en su sitio original.</li>
                    <li>En <b>Piezas</b>, selecciona varias y pulsa <b>Agrupar</b> para crear una figura manual.</li>
                  </ul>
                </div>
              </div>
              <div className="help-note">
                <Icon name="alert" size={16} />
                <p>El texto SVG no se convierte a trazados. Convierte los textos a curvas en tu editor antes de importar.</p>
              </div>
              <p className="micro-help">Los ajustes manuales se conservan mientras el número de piezas no cambie; si cambias la escala o el modo de agrupación, se recalcula la separación.</p>
              <h3>Guardar una figura con sus imágenes</h3>
              <p>En la tarjeta de una figura pulsa el <b>disquete</b> para guardarla con su nombre y sus imágenes. Se guarda en la <b>Biblioteca de figuras</b> y descarga un <code>.lasercat-group.json</code> con las imágenes dentro. <b>Exportar figura para LightBurn (ZIP)</b> genera un SVG por capas con las imágenes incrustadas, los PNG, el CSV y el LEEME.</p>
            </>
          )}

          {section === "pegatinas" && (
            <>
              <h2>Pegatinas, imanes y llaveros</h2>
              <p>El <b>borde</b> (offset) expande el contorno alrededor del diseño. Se calcula sobre la forma final, con agujeros y todo.</p>
              <ol className="help-list">
                <li>Importa el diseño y ponlo en <b>Grabar</b> si quieres el dibujo quemado.</li>
                <li>En la tarjeta de la pieza, despliega <b>Borde adicional</b> y súbelo a 2–3 mm.</li>
                <li>LaserCat graba el diseño y corta el contorno exterior del borde.</li>
                <li>Si quieres una pegatina de dos capas, activa <b>Cortar también el diseño interior</b>.</li>
              </ol>
              <div className="help-note">
                <Icon name="sparkles" size={16} />
                <p>El kerf se aplica al contorno de corte, no al grabado. La separación entre piezas ya tiene en cuenta el kerf para que no se toquen.</p>
              </div>
              <h3>Grabado de imágenes</h3>
              <p><b>B/N</b> para logos y siluetas, <b>Grises</b> para fotos con detalle, <b>Tramado</b> para más contraste y <b>Semitono vectorial</b> si necesitas un SVG sin imagen incrustada.</p>
            </>
          )}

          {section === "lightburn" && (
            <>
              <h2>LightBurn, paso a paso</h2>
              <ol className="help-list">
                <li>Descarga el ZIP desde <b>Exportar</b>.</li>
                <li>En LightBurn: <b>Archivo → Importar</b> y elige el SVG de la plancha.</li>
                <li>Comprueba las medidas: {doc.sheet.width} × {doc.sheet.height} mm. No cambies la escala.</li>
                <li>Los colores crean capas. Asigna <b>Relleno</b> a GRABADO y <b>Línea</b> a MARCADO, BORDE y CORTE.</li>
                <li>Ordena las capas: grabado → marcado → borde → corte.</li>
                <li>Usa <b>Coordenadas absolutas</b> o <b>Origen de usuario</b> y coloca la madera.</li>
              </ol>
              <div className="help-table">
                <table>
                  <thead><tr><th>Capa</th><th>Color</th><th>Modo</th><th>Potencia</th><th>Velocidad</th></tr></thead>
                  <tbody>
                    <tr><td><span className="dot dot-engrave" />GRABADO</td><td><code>#0000FF</code></td><td>Relleno</td><td>{eng.power} %</td><td>{eng.speed} mm/min</td></tr>
                    <tr><td><span className="dot dot-score" />MARCADO</td><td><code>#008000</code></td><td>Línea</td><td>{laserPresetFor(material.id, "score", machine.id).power} %</td><td>{laserPresetFor(material.id, "score", machine.id).speed} mm/min</td></tr>
                    <tr><td><span className="dot dot-cut" />CORTE</td><td><code>#000000</code></td><td>Línea</td><td>{cut.power} %</td><td>{cut.speed} mm/min</td></tr>
                    <tr><td><span className="dot" style={{ background: "#ff00ff" }} />BORDE</td><td><code>#FF00FF</code></td><td>Línea</td><td>{cut.power} %</td><td>{cut.speed} mm/min</td></tr>
                    <tr><td><span className="dot" style={{ background: "#ff0000" }} />MARCAS</td><td><code>#FF0000</code></td><td>Línea</td><td>—</td><td>referencia</td></tr>
                  </tbody>
                </table>
              </div>
              <h3>Optimización incluida</h3>
              <ul>
                <li><b>Kerf:</b> el corte se compensa hacia el desperdicio.</li>
                <li><b>Puentes:</b> pestañas que evitan que la pieza salte.</li>
                <li><b>Orden:</b> recorridos ordenados por cercanía.</li>
                <li><b>Capas:</b> grabado antes que corte, para que la pieza no se mueva.</li>
                <li><b>Figuras:</b> se anidan como una unidad, con compactación posterior y rotación si cabe.</li>
              </ul>
              <h3>Volver de LightBurn a LaserCat</h3>
              <p>Para reimportar una figura con sus imágenes y grupos, exporta desde LightBurn un <b>SVG con las imágenes incrustadas</b> (no enlazadas). LaserCat lo lee y vuelve a crear la figura y sus cortes.</p>
              <p className="micro-help">Si necesitas conservar capas, grupos e imágenes de forma nativa, el formato ideal es <code>.lbrn2</code>. Comparte un proyecto de ejemplo y añadimos el parser nativo; mientras tanto, el SVG con imágenes es el camino fiable.</p>
              <p className="micro-help">Los ajustes son un punto de partida para {machine.name} y {material.name}. Cada máquina y cada tablero cambia: haz siempre una prueba pequeña.</p>
            </>
          )}

          {section === "materiales" && (
            <>
              <h2>Materiales y ajustes de partida</h2>
              <p>Valores orientativos para <b>{machine.name}</b>. Empieza bajo y sube potencia o baja velocidad poco a poco.</p>
              <div className="help-table scroll">
                <table>
                  <thead><tr><th>Material</th><th>Grosor</th><th>Corte</th><th>Grabado</th></tr></thead>
                  <tbody>
                    {MATERIALS.map((m) => {
                      const c = laserPresetFor(m.id, "cut", machine.id);
                      const e = laserPresetFor(m.id, "engrave", machine.id);
                      return (
                        <tr key={m.id}>
                          <td>{m.name}</td>
                          <td>{m.thickness} mm</td>
                          <td>{c.power} % · {c.speed} mm/min · {c.passes} pas.</td>
                          <td>{e.power} % · {e.speed} mm/min</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="help-note">
                <Icon name="flame" size={16} />
                <p>Aire asistido encendido para corte, especialmente en DM, abedul y nogal. Limpia la lente y extrae el humo.</p>
              </div>
              <h3>Tonos de quemado</h3>
              <p>En <b>Material → Tono del láser</b> puedes simular el mismo trabajo en <b>miel, café, carbón, gris o rojizo</b>. El tono afecta a la simulación, no al archivo de corte; la potencia y la madera mandan en el resultado real.</p>
              <h3>Vista 3D y corte</h3>
              <p>En <b>Material</b> pulsa <b>Ver en 3D</b>. Ajusta el <b>grosor</b> (3 mm por defecto), arrastra para orbitar y usa la rueda para acercar. La vista muestra las <b>piezas recortadas</b>, no el tablero sobrante.</p>
            </>
          )}

          {section === "atajos" && (
            <>
              <h2>Atajos de taller</h2>
              <div className="shortcut-grid">
                <div><kbd>Ctrl</kbd>+<kbd>Z</kbd><span>Deshacer</span></div>
                <div><kbd>Ctrl</kbd>+<kbd>Mayús</kbd>+<kbd>Z</kbd><span>Rehacer</span></div>
                <div><kbd>Ctrl</kbd>+<kbd>D</kbd><span>Duplicar</span></div>
                <div><kbd>Supr</kbd><span>Quitar de la plancha</span></div>
                <div><kbd>R</kbd><span>Girar 90°</span></div>
                <div><kbd>Mayús</kbd>+<kbd>R</kbd><span>Girar -90°</span></div>
                <div><kbd>Ctrl</kbd>+<kbd>G</kbd><span>Agrupar selección</span></div>
                <div><kbd>F</kbd><span>Encuadrar</span></div>
                <div><kbd>Ctrl</kbd>+<kbd>A</kbd><span>Seleccionar todo</span></div>
                <div><kbd>←↑↓→</kbd><span>Mover 1 mm (Mayús: 5)</span></div>
                <div><kbd>Alt</kbd><span>Mover sin imán</span></div>
                <div><kbd>Ctrl</kbd>+<kbd>S</kbd><span>Guardar proyecto</span></div>
                <div><kbd>Esc</kbd><span>Deseleccionar / cerrar</span></div>
              </div>
              <p className="micro-help">El imán mueve en pasos de 0,5 mm. La selección múltiple funciona con Mayús + clic o arrastrando sobre varias piezas.</p>
            </>
          )}

          {section === "creditos" && (
            <>
              <h2>LaserCat</h2>
              <p className="lead">
                Una herramienta de taller para preparar corte y grabado láser. Nace como hermana de <b>CryCat</b>,
                adaptada de la Cricut a la madera, el diodo y LightBurn.
              </p>
              <div className="credits-list">
                <div><b>Hecho por</b><span>Daniel Hernández Ferrándiz</span></div>
                <div><b>Inspirado en</b><span>CryCat Tool</span></div>
                <div><b>Máquina por defecto</b><span>SculpFun S30 · 10 W</span></div>
                <div><b>Material por defecto</b><span>Tilo / basswood · 3 mm</span></div>
                <div><b>Privacidad</b><span>Sin servidor, sin cuentas, sin subir archivos.</span></div>
              </div>
              <p className="micro-help">
                LightBurn es una marca de LightBurn Software. SculpFun es una marca de SculpFun. LaserCat es una
                herramienta independiente, sin afiliación. Los ajustes son orientativos y el usuario es responsable
                de operar su máquina con seguridad: gafas, extracción y vigilancia.
              </p>
              <p className="micro-help">
                <a href="https://github.com/dhernandezgit/LaserCat" target="_blank" rel="noreferrer">github.com/dhernandezgit/LaserCat</a>
                {" · "}
                <a href="https://docs.lightburnsoftware.com/" target="_blank" rel="noreferrer">Documentación de LightBurn</a>
              </p>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

# ðŸˆ LaserCat

<div align="center">
<img src="public/icon.png" width="96" alt="LaserCat" />

**Corte y grabado lÃ¡ser, sin pelearte con la plancha.**

[![Deploy](https://github.com/dhernandezgit/LaserCat/actions/workflows/pages.yml/badge.svg)](https://github.com/dhernandezgit/LaserCat/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-8a5a2b.svg)](LICENSE)
[![LightBurn ready](https://img.shields.io/badge/LightBurn-SVG%20mm-000000.svg)](https://docs.lightburnsoftware.com/)
</div>

LaserCat es un taller local-first para preparar trabajos de lÃ¡ser: importa tus SVG e imÃ¡genes,
separa las piezas, agrupa figuras completas, calcula el hueco real entre formas, aplica bordes y kerf,
previsualiza el resultado en distintas maderas y exporta SVG en milÃ­metros listos para **LightBurn**.

Hecho para diodos como la **SculpFun S30 (10 W)**, con **tilo de 3 mm** como material de partida.
Funciona con cualquier lÃ¡ser y cualquier plancha. La interfaz copia la disposiciÃ³n y el flujo de
**CryCat** (tres columnas, tarjetas, barra inferior y temas pastel), adaptada al corte y grabado lÃ¡ser.
Arranca con el tema **Eevee**.

- ðŸŒ **App:** https://dhernandezgit.github.io/LaserCat/
- ðŸ“¦ **Repo:** https://github.com/dhernandezgit/LaserCat
- ðŸªµ Sin servidor, sin cuenta y sin subir archivos.
- ðŸ§© Todo se guarda en tu navegador; tambiÃ©n puedes descargar el proyecto `.json`.

![LaserCat Â· plancha de 300 Ã— 300 mm](docs/plancha.png)

---

## âœ¨ QuÃ© hace

### Plancha y empaquetado

- **Plancha de 300 Ã— 300 mm por defecto**, con margen de seguridad de **5 mm** y separaciÃ³n de **3 mm**.
- **Empaquetado por forma real**, no por cajas: se rasteriza cada pieza y se comprueba la colisiÃ³n
  con su geometrÃ­a, asÃ­ que una estrella puede encajar junto a la oreja de un gato.
- **4 mÃ©todos de colocaciÃ³n** (Greedy/Bottom-Left, Largest First, Voronoi/huecos libres y GenÃ©tico),
  **3 calidades** (RÃ¡pida / Normal / **Exacta**) y **compactaciÃ³n** posterior tipo DeepNest.
- **RotaciÃ³n** 0Â°/90Â°/ mÃºltiplos/Ã¡ngulo libre, **copias** y **mÃºltiples planchas**. En **forma real** se usan todos los ángulos por defecto; **Rectángulos** limita a 90° para ir más rápido.
- **Kerf** configurable: el corte se compensa hacia el desperdicio para que la pieza final mida lo que debe.
- **Fijar piezas** con el pin (o al arrastrarlas): el resto se recoloca alrededor.
- Aprovechamiento, nÃºmero de planchas y **tiempo estimado** de corte/grabado en directo.

### Importar SVG de verdad

- **Unidades reales**: mm, cm, pulgadas, puntos, pÃ­xeles y `viewBox`.
- **Transformaciones** (`matrix`, `translate`, `scale`, `rotate`, `skew`), `use`, `rect`, `circle`,
  `ellipse`, `line`, `polyline`, `polygon` y rutas completas con curvas y arcos.
- **ImÃ¡genes SVG incrustadas** (`<image>` con data URL): se importan como **grabado** y sirven de
  ancla para agrupar los cortes que las rodean; una imagen grande se convierte en una figura que
  engloba sus piezas.
- **SeparaciÃ³n inteligente en islas**: un solo `<path>` con 40 iconos se convierte en 40 piezas;
  los ojos, letras y ventanas interiores se mantienen como **agujeros**, no como piezas sueltas.
- **Grupos de Inkscape/Illustrator** respetados como pistas, con nombres de capa.
- **Rellenos blancos â†’ huecos** (opcional): los detalles blancos dentro de una silueta se recortan.
- **Trazos sin relleno** convertidos a contorno de corte del grosor del trazo.
- **Mapa de piezas** con la posiciÃ³n original, colores, **recuadros de figuras** y lista de
  **parejas** (â€œquÃ© se empareja con quÃ©â€). Puedes **fusionar**, **agrupar**, **separar** y renombrar
  antes de aÃ±adir.
- Escala por **ancho**, **alto** o tamaÃ±o real; simplificaciÃ³n de curvas configurable.
- PestaÃ±a **Grupos** con tarjetas por figura: nombre, copias, miembros, operaciÃ³n, incluir/excluir,
  separar y vista previa con la imagen y los cortes ya montados.

### Figuras y ensamblajes

- Una **figura** es un grupo de piezas que se mueve, gira, fija, duplica y **se anida como una
  unidad**. La imagen grabada y sus cortes mantienen el registro exacto del SVG original.
- **Agrupar** desde el importador o con `Ctrl` + `G` en el tablero; **Desagrupar** desde la tarjeta de la figura.
- Cada figura tiene **copias independientes**, nombre propio y miembros con su operaciÃ³n
  (cortar / grabar / marcar).
- El empaquetado **compacta** las figuras despuÃ©s de colocarlas y puede rotarlas si la plancha lo
  permite, sin romper la alineaciÃ³n interna.
- **Biblioteca de figuras**: guarda una figura con su nombre y sus **imÃ¡genes incluidas** y
  reutilÃ­zala en otro proyecto. Se descarga un `.lasercat-group.json` con las imÃ¡genes en base64 y,
  desde la tarjeta, un **ZIP para LightBurn** con SVG por capas, PNG, CSV y LEEME.

![Figura creada con varias piezas y anidada como una unidad](docs/figuras.png)

![Mapa de grupos y piezas del importador](docs/mapa-grupos.png)

### ImÃ¡genes para cortar o grabar

- **Silueta de corte**: contorno + agujeros, ideal para pegatinas y recortes.
- **Grabado B/N**: vector sÃ³lido en blanco y negro.
- **Grabado en grises**: mapa de bits con todas las intensidades para fotos.
- **Tramado**: Floydâ€“Steinberg, Atkinson u ordenado 8Ã—8.
- **Semitono vectorial**: miles de puntos vectoriales, sin imagen incrustada.
- Umbral, invertir, quitar fondo claro, suavizado, tamaÃ±o mÃ­nimo y **borde/offset**.

### Bordes y pegatinas

- **Offset en mm** calculado sobre la forma final, no sobre la caja.
- El borde expande solo el exterior: **los agujeros conservan su tamaÃ±o**.
- Si la pieza es de **grabado**, el diseÃ±o se graba y el contorno exterior se corta.
- OpciÃ³n de **borde separado** para pegatinas de dos capas.
- El kerf se aplica al corte, nunca al grabado.

### Vista en madera

- **Vista 3D de las piezas recortadas**: profundidad configurable (**3 mm por defecto**), órbita con arrastre, inclinación y zoom con la rueda. No muestra el tablero sobrante.
- **9 maderas**: tilo, abedul, roble, nogal, cerezo, bambÃº, DM/MDF, pino y cartÃ³n.
- **5 tonos de lÃ¡ser**: miel, cafÃ©, carbÃ³n, gris y rojizo, para comparar el mismo trabajo con
  distintas quemaduras.
- **Intensidad, velocidad y pasadas** en directo, con halo de quemado y lÃ­neas de corte.
- GalerÃ­a de **4 intensidades** para comparar de un vistazo y **comparador 4 maderas Ã— 4 intensidades**.
- Exporta la previsualizaciÃ³n a PNG.
- SimulaciÃ³n orientativa: cada mÃ¡quina, lente y tablero quema distinto.

![Distintas maderas con el mismo diseÃ±o](docs/maderas.jpg)

![Comparador de 4 maderas y 4 intensidades](docs/comparador.png)

![Vista 3D de las piezas recortadas](docs/3d.png)

### Temas y aspecto

- **Eevee** por defecto: crema, caramelo y paneles claros, con la misma disposiciÃ³n de tres columnas,
  tarjetas redondeadas y barra inferior que CryCat.
- TambiÃ©n **Wiwi**, **Sylveon**, **Leafeon**, **Vaporeon**, **Umbreon**, **Fidough**, **Sprigatito**,
  **Maushold**, **Jirachi**, **Espeon** y **Espeon shiny**.
- El tema se cambia desde el **badge de Ajustes â†’ Vista y tema** y se recuerda en el navegador.

![Tema Eevee con figuras y tonos de madera](docs/tonos.png)

### Exportar a LightBurn

- **SVG en milÃ­metros reales** (`width="300mm"`, `viewBox="0 0 300 300"`), sin transformaciones en los vectores.
- **Capas por color**, que LightBurn convierte en capas separadas:
  - Azul `#0000FF` â†’ **GRABADO** (Relleno)
  - Verde `#008000` â†’ **MARCADO** (LÃ­nea)
  - Negro `#000000` â†’ **CORTE** (LÃ­nea)
  - Magenta `#FF00FF` â†’ **BORDE** (LÃ­nea)
  - Rojo `#FF0000` â†’ **MARCAS** (referencia; se puede ignorar)
- Grabado antes que corte en el orden del documento.
- **Kerf**, **puentes de sujeciÃ³n**, marcas de esquina y **orden de recorridos** por cercanÃ­a.
- ImÃ¡genes de grabado **incrustadas** en el SVG y tambiÃ©n como PNG sueltos en el ZIP.
- ExportaciÃ³n **por figura**: desde su tarjeta, un ZIP compacto con el SVG de esa figura, sus
  imÃ¡genes, el CSV de capas y el LEEME.
- El ZIP completo incluye:
  - `*-plancha-01.svg`, `*-plancha-02.svg`â€¦
  - `lasercat-proyecto.json`
  - `ajustes-capas.csv`
  - `LEEME-LightBurn.txt`
  - `imagenes/*.png`
  - `previews/*-madera.png`

![RevisiÃ³n de figuras importadas](docs/importar-svg.png)

### Volver de LightBurn a LaserCat

Para reimportar desde LightBurn una figura con sus imÃ¡genes y grupos, exporta un **SVG con las
imÃ¡genes incrustadas** (data URL, no enlazadas). LaserCat lo lee, vuelve a detectar las figuras y
separa los cortes. El formato nativo `.lbrn2` conserva capas y grupos, pero todavÃ­a no tiene parser;
si compartes un proyecto de ejemplo, se puede aÃ±adir soporte nativo. Mientras tanto, el SVG con
imÃ¡genes incrustadas es el camino fiable.

![Tarjeta de una figura con tamaÃ±o, borde, guardado y exportaciÃ³n](docs/guardar-figura.png)

![Biblioteca de figuras guardadas con sus imÃ¡genes](docs/biblioteca.png)

### Extras de taller

- **Biblioteca de figuras** guardadas con sus imÃ¡genes, nombres propios y miniaturas.
- **Tarjeta de pruebas** de 24 celdas (6 potencias Ã— 4 velocidades), un color por celda y CSV de ajustes.
- **Presets de material** para S30 de 10 W, S30 Pro de 20 W, S30 Ultra de 22 W, diodo de 5 W y COâ‚‚ de 40 W.
- **Historial** con deshacer/rehacer, autoguardado local, proyecto `.json`, atajos y diseÃ±o responsive.
- **Sin servidor**: React + TypeScript, todo el cÃ¡lculo en el navegador.

---

## ðŸš€ Empezar en 5 pasos

1. Abre **https://dhernandezgit.github.io/LaserCat/** (o ejecuta `npm run dev`).
2. **Arrastra** tus SVG o imÃ¡genes a la columna **Piezas** (o al tablero). Se aÃ±aden y colocan solos.
3. Revisa las tarjetas: tamaÃ±o, copias, borde y operaciÃ³n. Las figuras se mueven y anidan enteras.
4. Ajusta **Plancha** y **OptimizaciÃ³n** a la derecha: margen 5 mm, separaciÃ³n 3 mm, kerf 0,15 mm,
   mÃ©todo y calidad. Activa **Auto optimizar** si quieres que se recoloche al cambiar algo.
5. Pulsa **Exportar** e importa el SVG en LightBurn. Para guardar una figura suelta, usa el
   **disquete** de su tarjeta y recupÃ©rala desde **Biblioteca de figuras**.

> **Consejo:** la calidad **Exacta** suele meter en una plancha lo que la rÃ¡pida reparte en dos.
> Si algo no cabe, prueba Exacta o GenÃ©tico, baja la separaciÃ³n o reduce el borde. Las figuras se
> compactan despuÃ©s de anidar y conservan la alineaciÃ³n entre imagen y cortes.

---

## ðŸ§­ La interfaz

La app sigue la disposiciÃ³n de CryCat: **Piezas** a la izquierda, **visor** en el centro, **Ajustes** a la
derecha y **barra de estado** abajo. Los tres paneles tienen separadores arrastrables.

| Zona | Para quÃ© sirve |
|---|---|
| **Piezas** | Arrastrar archivos, seleccionar, copias, tamaÃ±o, borde, operaciones y biblioteca. |
| **Visor** | Plancha/madera, arrastrar, girar, fijar, zoom, pÃ¡ginas, Optimizar y Guardar/Exportar. |
| **Ajustes â†’ General** | Plancha, presets A4/A3/A5/Letter, margen, separaciÃ³n, kerf, rotaciÃ³n, calidad y mÃ©todo. |
| **Ajustes â†’ OptimizaciÃ³n** | MÃ©todo, forma real/rectÃ¡ngulos, compactaciÃ³n y recÃ¡lculo. |
| **Ajustes → Material → 3D** | Grosor, órbita y piezas recortadas en 3D. |
| **Ajustes â†’ Borde / Imagen / Material** | Offset global, importaciÃ³n de imÃ¡genes, madera, tonos, potencia y tarjeta de pruebas. |
| **Ajustes â†’ Vista y tema** | 12 temas CryCat, cuadrÃ­cula y leyenda de capas. |
| **Barra inferior** | CÃ³mo usar, reportar, apoyar, versiÃ³n y estado del taller. |

<p align="center">
  <img src="docs/movil.png" width="260" alt="LaserCat en mÃ³vil" />
  <br />
  <sub>La misma plancha en el mÃ³vil: los paneles se apilan y el tablero conserva el zoom y los controles.</sub>
</p>

### Atajos

| Atajo | AcciÃ³n |
|---|---|
| `Ctrl` + `Z` / `Ctrl` + `MayÃºs` + `Z` | Deshacer / rehacer |
| `Ctrl` + `D` | Duplicar |
| `Supr` | Quitar de la plancha |
| `R` / `MayÃºs` + `R` | Girar +90Â° / âˆ’90Â° |
| `Ctrl` + `G` | Agrupar las piezas seleccionadas como figura |
| `F` | Encuadrar |
| `Ctrl` + `A` | Seleccionar todo |
| Flechas | Mover 1 mm (MayÃºs: 5 mm) |
| `Alt` + arrastrar | Mover sin imÃ¡n de 0,5 mm |
| `Ctrl` + `S` / `Ctrl` + `O` | Guardar / abrir proyecto `.json` |
| `Esc` | Deseleccionar / cerrar |

> Un clic en cualquier miembro selecciona la **figura completa**; `MayÃºs` + clic aÃ±ade o quita figuras.
> `Ctrl` + `O` tambiÃ©n acepta un `.lasercat-group.json` guardado desde la biblioteca.

---

## ðŸªµ Maderas y ajustes de partida

Valores orientativos para **SculpFun S30 de 10 W**. Empieza bajo y ajusta con una prueba pequeÃ±a.

| Material | Grosor | Corte | Grabado |
|---|---:|---|---|
| Tilo / basswood | 3 mm | 100 % Â· 300 mm/min Â· 1 pasada | 35 % Â· 3600 mm/min |
| Abedul / contrachapado | 3 mm | 100 % Â· 280 mm/min Â· 1 pasada | 38 % Â· 3300 mm/min |
| Roble | 4 mm | 100 % Â· 180 mm/min Â· 2 pasadas | 45 % Â· 2600 mm/min |
| Nogal | 3 mm | 100 % Â· 250 mm/min Â· 1 pasada | 40 % Â· 3000 mm/min |
| Cerezo | 3 mm | 100 % Â· 260 mm/min Â· 1 pasada | 38 % Â· 3100 mm/min |
| BambÃº | 3 mm | 100 % Â· 200 mm/min Â· 2 pasadas | 35 % Â· 3400 mm/min |
| DM / MDF | 3 mm | 100 % Â· 350 mm/min Â· 1 pasada | 42 % Â· 3500 mm/min |
| Pino | 3 mm | 100 % Â· 380 mm/min Â· 1 pasada | 32 % Â· 4000 mm/min |
| CartÃ³n | 2 mm | 70 % Â· 900 mm/min Â· 1 pasada | 25 % Â· 5000 mm/min |
| Cuero vegetal | 2 mm | 60 % Â· 500 mm/min Â· 1 pasada | 20 % Â· 3000 mm/min |
| AcrÃ­lico negro | 3 mm | 100 % Â· 200 mm/min Â· 1 pasada | 30 % Â· 3000 mm/min |

Los presets se ajustan automÃ¡ticamente al cambiar de mÃ¡quina (S30 Pro y Ultra son mÃ¡s rÃ¡pidas;
el diodo de 5 W, mÃ¡s lento).

---

## ðŸ–¨ï¸ LightBurn, paso a paso

1. Descarga el ZIP en **Exportar**.
2. En LightBurn: **Archivo â†’ Importar** y elige el SVG de la plancha.
3. Comprueba que mide **300 Ã— 300 mm** (o la medida que hayas puesto). No cambies la escala.
4. Los colores crean las capas. Asigna **Relleno** a GRABADO y **LÃ­nea** al resto.
5. Ordena las capas: **GRABADO â†’ MARCADO â†’ BORDE â†’ CORTE â†’ MARCAS**.
6. Coloca la madera y usa **Coordenadas absolutas** u **Origen de usuario**.
7. Enfoca, enciende el aire y lanza el trabajo.

**Ajustes del CSV** (ejemplo con tilo y S30):

| Capa | Color | Modo | Potencia | Velocidad | Pasadas |
|---|---|---|---:|---:|---:|
| GRABADO | `#0000FF` | Relleno | 35 % | 3600 mm/min | 1 |
| MARCADO | `#008000` | LÃ­nea | 18 % | 3600 mm/min | 1 |
| BORDE | `#FF00FF` | LÃ­nea | 100 % | 300 mm/min | 1 |
| CORTE | `#000000` | LÃ­nea | 100 % | 300 mm/min | 1 |
| MARCAS | `#FF0000` | LÃ­nea | 20 % | 300 mm/min | 1 |

> Los valores son un punto de partida. Haz siempre una prueba en un retal: la lente, el foco,
> la humedad y la madera cambian el resultado.

![ExportaciÃ³n preparada para LightBurn](docs/exportar.png)

### Tarjeta de pruebas

En **Material â†’ Tarjeta de pruebas** puedes descargar un ZIP con:

- un SVG de **200 Ã— 150 mm** con **24 celdas** (6 potencias Ã— 4 velocidades),
- un CSV que dice quÃ© potencia y velocidad asignar a cada color,
- un LEEME con instrucciones.

Cada celda incluye un bloque sÃ³lido, un cÃ­rculo fino, un peine de lÃ­neas y un damero para comparar
oscuridad, detalle y resoluciÃ³n. Es la forma mÃ¡s rÃ¡pida de afinar tu madera.

![Tarjeta de pruebas de 24 celdas](docs/tarjeta-pruebas.jpg)

---

## ðŸ§± Desarrollo

Requisitos: **Node.js 20+**.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 59 tests (geometría, importador SVG con imágenes, figuras, nesting geométrico, export, store, tarjeta)
npm run typecheck
npm run build      # dist/ estÃ¡tico
npm run preview
```

### Estructura

```
src/
  lib/
    geom.ts          contornos, Ã¡reas, rotaciones, simplificaciÃ³n
    clipper.ts       booleanos y offsets robustos (Clipper)
    svgImport.ts     parser SVG, imÃ¡genes incrustadas, unidades, islas y figuras
    autoImport.ts    soltar archivos y aÃ±adirlos sin diÃ¡logos
    trace.ts         marching squares, umbral, tramado, semitono
    nest.ts          empaquetado por forma real (mÃ©todos + compactaciÃ³n)
    assembly.ts      figuras/ensamblajes, geometrÃ­a combinada y rotaciÃ³n
    groupLibrary.ts  biblioteca, JSON y ZIP por figura
    wood3d.ts        proyección 3D de piezas, grosor y órbita
    themes.ts        los 12 temas pastel de CryCat
    laser.ts         mÃ¡quinas, materiales, capas, kerf y tiempos
    export.ts        SVG para LightBurn, puentes, ZIP y LEEME
    wood.ts          textura procedural, tonos y simulaciÃ³n de quemado
    testcard.ts      tarjeta de pruebas de 24 celdas
    store.ts         estado, historial, autoguardado y normalizaciÃ³n
  components/        diÃ¡logos y piezas compartidas
  components/shell/  FilePanel, Viewer, Settings y StatusBar estilo CryCat
  styles.css         estilos de los diÃ¡logos y base
  crycat.css         disposiciÃ³n de tres columnas, tarjetas y temas
examples/            SVG e imagen de muestra propios
docs/                capturas para el README
```

### Tests

```bash
npm test           # 59 tests (geometría, importador SVG con imágenes, figuras, nesting geométrico, export, store, tarjeta)
```

Cubren, entre otras cosas:

- Ãreas, rotaciones, RDP, offsets con huecos y kerf.
- ImportaciÃ³n de SVG con mm/viewBox, transformaciones, trazos, imÃ¡genes incrustadas, grupos y blancos como huecos.
- SeparaciÃ³n de islas, agrupaciÃ³n por distancia real, figuras automÃ¡ticas y nombres de grupo.
- Figuras: geometrÃ­a combinada, offsets, rotaciÃ³n, copias, fijado, biblioteca y JSON con imÃ¡genes.
- Tres modos de imagen: silueta, agujeros, marching squares, tramado y semitono.
- Nesting sin solapes reales, respeto del margen, varias planchas y compactaciÃ³n.
- ExportaciÃ³n con capas, kerf, puentes, imÃ¡genes y ZIP.
- Historial, copias, pin y normalizaciÃ³n de proyectos.
- Tarjeta de pruebas y validez XML.

### Despliegue

El workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) compila y publica en
GitHub Pages en cada push a `main`. La app es 100 % estÃ¡tica y usa rutas relativas, asÃ­ que tambiÃ©n
puedes servir `dist/` desde cualquier sitio.

---

## ðŸ”’ Privacidad

- **No hay servidor**: los SVG, imÃ¡genes, proyectos y ajustes se quedan en tu navegador.
- El autoguardado usa `localStorage`. Si el proyecto es muy grande, descarga el `.json`.
- No se suben archivos a ningÃºn sitio. No hay cuentas ni analÃ­tica.
- La app no modifica tus archivos originales.

---

## âš ï¸ Seguridad y descargo

- Usa **gafas de protecciÃ³n** adecuadas para la longitud de onda de tu lÃ¡ser.
- Enciende **extracciÃ³n/ventilaciÃ³n** y no dejes la mÃ¡quina desatendida.
- Los ajustes de potencia/velocidad son **orientativos**. Haz pruebas en retales.
- La simulaciÃ³n en madera es una aproximaciÃ³n artÃ­stica, no una garantÃ­a del resultado.
- **LightBurn** es una marca de LightBurn Software. **SculpFun** es una marca de SculpFun.
  LaserCat es una herramienta independiente, sin afiliaciÃ³n ni patrocinio.
- La app se ofrece **tal cual**, sin garantÃ­as.

---

## â¤ï¸ CrÃ©ditos

Hecha por **Daniel HernÃ¡ndez FerrÃ¡ndiz**, como hermana de [CryCat](https://github.com/dhernandezgit/CryCat-Tool),
la herramienta que colocaba imÃ¡genes para Cricut. LaserCat cambia el papel por madera, el plotter por
un diodo y el PNG por SVG en milÃ­metros.

- InspiraciÃ³n, filosofÃ­a, disposiciÃ³n de tres columnas, tarjetas, atajos, temas pastel y barra inferior: **CryCat Tool**, adaptados al lÃ¡ser.
- Icono: recorte cuadrado superior de la foto original de LaserCat.
- GeometrÃ­a robusta: [clipper-lib](https://github.com/junmer/clipper-lib).
- ZIP: [fflate](https://github.com/101arrowz/fflate).
- Interfaz: React + Vite + TypeScript.

Si te sirve, pÃ¡sate por el repo y deja una estrella â­.

---

## ðŸ‡¬ðŸ‡§ English in a nutshell

**LaserCat** is a local-first laser cutting/engraving layout studio. It imports SVGs with real
units, embedded images and groups, splits them into smart islands (holes included), handles white
cut-outs, imports images as silhouettes / B&W / grayscale / dither / vector halftone, builds movable
figures (image engraving + cut pieces), applies sticker offsets and kerf, nests parts and figures
using their true shape with post-compaction, previews the result on nine wood species with five laser
tones, and exports LightBurn-ready SVG in millimetres with colour-coded layers, bridges and a ZIP
containing the project, per-figure exports, layer CSV, embedded raster images and wood previews.
Defaults: SculpFun S30 10 W, 300 Ã— 300 mm sheet, 5 mm margin, basswood 3 mm. Eevee is the default
theme, with Sylveon, Leafeon, Vaporeon, Umbreon and Taller available. No server, no account, no uploads.

Built by **Daniel HernÃ¡ndez FerrÃ¡ndiz**. MIT licensed.


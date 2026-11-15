# 🐈 LaserCat

<div align="center">
<img src="public/icon.svg" width="96" alt="LaserCat" />

**Corte y grabado láser, sin pelearte con la plancha.**
</div>

LaserCat es un taller local-first para preparar trabajos de láser: importa tus SVG e imágenes,
separa las piezas, calcula el hueco real entre formas, aplica bordes y kerf, previsualiza el
resultado en distintas maderas y exporta SVG en milímetros listos para **LightBurn**.

Hecho para diodos como la **SculpFun S30 (10 W)**, con **tilo de 3 mm** como material de partida.
Funciona con cualquier láser y cualquier plancha.

- 🌐 **App:** https://dhernandezgit.github.io/LaserCat/
- 📦 **Repo:** https://github.com/dhernandezgit/LaserCat
- 🪵 Sin servidor, sin cuenta y sin subir archivos.
- 🧩 Todo se guarda en tu navegador; también puedes descargar el proyecto `.json`.

![LaserCat · plancha de 300 × 300 mm](docs/plancha.png)

---

## ✨ Qué hace

### Plancha y empaquetado

- **Plancha de 300 × 300 mm por defecto**, con margen de seguridad de **5 mm** y separación de **3 mm**.
- **Empaquetado por forma real**, no por cajas: se rasteriza cada pieza y se comprueba la colisión
  con su geometría, así que una estrella puede encajar junto a la oreja de un gato.
- **3 calidades** (Rápida / Equilibrada / **Máxima**, la recomendada), rotación 0°/90°/libre y
  **múltiples planchas** cuando hace falta.
- **Kerf** configurable: el corte se compensa hacia el desperdicio para que la pieza final mida lo que debe.
- **Fijar piezas** para que no se muevan al reoptimizar; el resto se recoloca alrededor.
- Aprovechamiento, número de planchas y **tiempo estimado** de corte/grabado en directo.

### Importar SVG de verdad

- **Unidades reales**: mm, cm, pulgadas, puntos, píxeles y `viewBox`.
- **Transformaciones** (`matrix`, `translate`, `scale`, `rotate`, `skew`), `use`, `rect`, `circle`,
  `ellipse`, `line`, `polyline`, `polygon` y rutas completas con curvas y arcos.
- **Separación inteligente en islas**: un solo `<path>` con 40 iconos se convierte en 40 piezas;
  los ojos, letras y ventanas interiores se mantienen como **agujeros**, no como piezas sueltas.
- **Grupos de Inkscape/Illustrator** respetados como pistas, con nombres de capa.
- **Rellenos blancos → huecos** (opcional): los detalles blancos dentro de una silueta se recortan.
- **Trazos sin relleno** convertidos a contorno de corte del grosor del trazo.
- **Mapa de piezas** con la posición original, colores, líneas de cercanía y lista de **parejas**
  (“qué se empareja con qué”). Puedes **unir**, **separar** y renombrar antes de añadir.
- Escala por **ancho**, **alto** o tamaño real; simplificación de curvas configurable.

### Imágenes para cortar o grabar

- **Silueta de corte**: contorno + agujeros, ideal para pegatinas y recortes.
- **Grabado B/N**: vector sólido en blanco y negro.
- **Grabado en grises**: mapa de bits con todas las intensidades para fotos.
- **Tramado**: Floyd–Steinberg, Atkinson u ordenado 8×8.
- **Semitono vectorial**: miles de puntos vectoriales, sin imagen incrustada.
- Umbral, invertir, quitar fondo claro, suavizado, tamaño mínimo y **borde/offset**.

### Bordes y pegatinas

- **Offset en mm** calculado sobre la forma final, no sobre la caja.
- El borde expande solo el exterior: **los agujeros conservan su tamaño**.
- Si la pieza es de **grabado**, el diseño se graba y el contorno exterior se corta.
- Opción de **borde separado** para pegatinas de dos capas.
- El kerf se aplica al corte, nunca al grabado.

### Vista en madera

- **9 maderas**: tilo, abedul, roble, nogal, cerezo, bambú, DM/MDF, pino y cartón.
- **Intensidad, velocidad y pasadas** en directo, con halo de quemado y líneas de corte.
- Galería de **4 intensidades** para comparar de un vistazo.
- Exporta la previsualización a PNG.
- Simulación orientativa: cada máquina, lente y tablero quema distinto.

![Distintas maderas con el mismo diseño](docs/maderas.jpg)

### Exportar a LightBurn

- **SVG en milímetros reales** (`width="300mm"`, `viewBox="0 0 300 300"`), sin transformaciones en los vectores.
- **Capas por color**, que LightBurn convierte en capas separadas:
  - Azul `#0000FF` → **GRABADO** (Relleno)
  - Verde `#008000` → **MARCADO** (Línea)
  - Negro `#000000` → **CORTE** (Línea)
  - Magenta `#FF00FF` → **BORDE** (Línea)
  - Rojo `#FF0000` → **MARCAS** (referencia; se puede ignorar)
- Grabado antes que corte en el orden del documento.
- **Kerf**, **puentes de sujeción**, marcas de esquina y **orden de recorridos** por cercanía.
- Imágenes de grabado **incrustadas** en el SVG y también como PNG sueltos en el ZIP.
- El ZIP incluye:
  - `*-plancha-01.svg`, `*-plancha-02.svg`…
  - `lasercat-proyecto.json`
  - `ajustes-capas.csv`
  - `LEEME-LightBurn.txt`
  - `imagenes/*.png`
  - `previews/*-madera.png`

![Revisión de piezas importadas](docs/importar-svg.png)

### Extras de taller

- **Tarjeta de pruebas** de 24 celdas (6 potencias × 4 velocidades), un color por celda y CSV de ajustes.
- **Presets de material** para S30 de 10 W, S30 Pro de 20 W, S30 Ultra de 22 W, diodo de 5 W y CO₂ de 40 W.
- **Historial** con deshacer/rehacer, autoguardado local, proyecto `.json`, atajos y diseño responsive.
- **Sin servidor**: React + TypeScript, todo el cálculo en el navegador.

---

## 🚀 Empezar en 5 pasos

1. Abre **https://dhernandezgit.github.io/LaserCat/** (o ejecuta `npm run dev`).
2. Arrastra un **SVG** o una **imagen** al tablero, o pulsa **Importar SVG**.
3. Revisa el **mapa**, une/separa lo que haga falta y pulsa **Añadir y colocar**.
4. Ajusta la plancha: 300 × 300 mm, margen 5 mm, separación 3 mm, kerf 0,15 mm.
5. Pulsa **Exportar → Descargar ZIP** e importa el SVG en LightBurn.

> **Consejo:** la calidad **Máxima** suele meter en una plancha lo que la calidad rápida reparte en dos.
> Si algo no cabe, prueba Máxima, baja la separación o reduce el borde.

---

## 🧭 La interfaz

| Zona | Para qué sirve |
|---|---|
| **Piezas** | Importar, ver todas las piezas, copias, operación, bordes y atajos. |
| **Plancha** | Tamaño, margen, separación, kerf, rotación, calidad y optimización. |
| **Grabado** | Máquina, material, presets y capas del archivo. |
| **Material** | Maderas, intensidad, galería de pruebas y tarjeta de pruebas. |
| **Inspector derecho** | Editar la pieza seleccionada: tamaño, copias, borde, operación, posición y pin. |
| **Tablero** | Arrastrar, girar, fijar y ver el aprovechamiento. |
| **Vista Madera** | Simulación realista antes de quemar. |

<p align="center">
  <img src="docs/movil.png" width="260" alt="LaserCat en móvil" />
  <br />
  <sub>La misma plancha en el móvil: el tablero manda y los paneles se abren como cajones.</sub>
</p>

### Atajos

| Atajo | Acción |
|---|---|
| `Ctrl` + `Z` / `Ctrl` + `Mayús` + `Z` | Deshacer / rehacer |
| `Ctrl` + `D` | Duplicar |
| `Supr` | Quitar de la plancha |
| `R` / `Mayús` + `R` | Girar +90° / −90° |
| `F` | Encuadrar |
| `Ctrl` + `A` | Seleccionar todo |
| Flechas | Mover 1 mm (Mayús: 5 mm) |
| `Alt` + arrastrar | Mover sin imán de 0,5 mm |
| `Ctrl` + `S` / `Ctrl` + `O` | Guardar / abrir proyecto `.json` |
| `Esc` | Deseleccionar / cerrar |

---

## 🪵 Maderas y ajustes de partida

Valores orientativos para **SculpFun S30 de 10 W**. Empieza bajo y ajusta con una prueba pequeña.

| Material | Grosor | Corte | Grabado |
|---|---:|---|---|
| Tilo / basswood | 3 mm | 100 % · 300 mm/min · 1 pasada | 35 % · 3600 mm/min |
| Abedul / contrachapado | 3 mm | 100 % · 280 mm/min · 1 pasada | 38 % · 3300 mm/min |
| Roble | 4 mm | 100 % · 180 mm/min · 2 pasadas | 45 % · 2600 mm/min |
| Nogal | 3 mm | 100 % · 250 mm/min · 1 pasada | 40 % · 3000 mm/min |
| Cerezo | 3 mm | 100 % · 260 mm/min · 1 pasada | 38 % · 3100 mm/min |
| Bambú | 3 mm | 100 % · 200 mm/min · 2 pasadas | 35 % · 3400 mm/min |
| DM / MDF | 3 mm | 100 % · 350 mm/min · 1 pasada | 42 % · 3500 mm/min |
| Pino | 3 mm | 100 % · 380 mm/min · 1 pasada | 32 % · 4000 mm/min |
| Cartón | 2 mm | 70 % · 900 mm/min · 1 pasada | 25 % · 5000 mm/min |
| Cuero vegetal | 2 mm | 60 % · 500 mm/min · 1 pasada | 20 % · 3000 mm/min |
| Acrílico negro | 3 mm | 100 % · 200 mm/min · 1 pasada | 30 % · 3000 mm/min |

Los presets se ajustan automáticamente al cambiar de máquina (S30 Pro y Ultra son más rápidas;
el diodo de 5 W, más lento).

---

## 🖨️ LightBurn, paso a paso

1. Descarga el ZIP en **Exportar**.
2. En LightBurn: **Archivo → Importar** y elige el SVG de la plancha.
3. Comprueba que mide **300 × 300 mm** (o la medida que hayas puesto). No cambies la escala.
4. Los colores crean las capas. Asigna **Relleno** a GRABADO y **Línea** al resto.
5. Ordena las capas: **GRABADO → MARCADO → BORDE → CORTE → MARCAS**.
6. Coloca la madera y usa **Coordenadas absolutas** u **Origen de usuario**.
7. Enfoca, enciende el aire y lanza el trabajo.

**Ajustes del CSV** (ejemplo con tilo y S30):

| Capa | Color | Modo | Potencia | Velocidad | Pasadas |
|---|---|---|---:|---:|---:|
| GRABADO | `#0000FF` | Relleno | 35 % | 3600 mm/min | 1 |
| MARCADO | `#008000` | Línea | 18 % | 3600 mm/min | 1 |
| BORDE | `#FF00FF` | Línea | 100 % | 300 mm/min | 1 |
| CORTE | `#000000` | Línea | 100 % | 300 mm/min | 1 |
| MARCAS | `#FF0000` | Línea | 20 % | 300 mm/min | 1 |

> Los valores son un punto de partida. Haz siempre una prueba en un retal: la lente, el foco,
> la humedad y la madera cambian el resultado.

![Exportación preparada para LightBurn](docs/exportar.png)

### Tarjeta de pruebas

En **Material → Tarjeta de pruebas** puedes descargar un ZIP con:

- un SVG de **200 × 150 mm** con **24 celdas** (6 potencias × 4 velocidades),
- un CSV que dice qué potencia y velocidad asignar a cada color,
- un LEEME con instrucciones.

Cada celda incluye un bloque sólido, un círculo fino, un peine de líneas y un damero para comparar
oscuridad, detalle y resolución. Es la forma más rápida de afinar tu madera.

![Tarjeta de pruebas de 24 celdas](docs/tarjeta-pruebas.jpg)

---

## 🧱 Desarrollo

Requisitos: **Node.js 20+**.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 54 tests (geometría, importador, nesting, export, store, tarjeta)
npm run typecheck
npm run build      # dist/ estático
npm run preview
```

### Estructura

```
src/
  lib/
    geom.ts          contornos, áreas, rotaciones, simplificación
    clipper.ts       booleanos y offsets robustos (Clipper)
    svgImport.ts     parser SVG, unidades, transformaciones, islas y grupos
    trace.ts         marching squares, umbral, tramado, semitono
    nest.ts          empaquetado por forma real (raster + colisión)
    laser.ts         máquinas, materiales, capas, kerf y tiempos
    export.ts        SVG para LightBurn, puentes, ZIP y LEEME
    wood.ts          textura procedural y simulación de quemado
    testcard.ts      tarjeta de pruebas de 24 celdas
    store.ts         estado, historial, autoguardado y normalización
  components/        interfaz React
  styles.css         tema de papel, nogal y latón
examples/            SVG e imagen de muestra
docs/                capturas para el README
```

### Tests

```bash
npm test
```

Cubren, entre otras cosas:

- Áreas, rotaciones, RDP, offsets con huecos y kerf.
- Importación de SVG con mm/viewBox, transformaciones, trazos, grupos y blancos como huecos.
- Separación de islas, agrupación por distancia real y nombres de grupo.
- Tres modos de imagen: silueta, agujeros, marching squares, tramado y semitono.
- Nesting sin solapes reales, respeto del margen y varias planchas.
- Exportación con capas, kerf, puentes, imágenes y ZIP.
- Historial, copias, pin y normalización de proyectos.
- Tarjeta de pruebas y validez XML.

### Despliegue

El workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) compila y publica en
GitHub Pages en cada push a `main`. La app es 100 % estática y usa rutas relativas, así que también
puedes servir `dist/` desde cualquier sitio.

---

## 🔒 Privacidad

- **No hay servidor**: los SVG, imágenes, proyectos y ajustes se quedan en tu navegador.
- El autoguardado usa `localStorage`. Si el proyecto es muy grande, descarga el `.json`.
- No se suben archivos a ningún sitio. No hay cuentas ni analítica.
- La app no modifica tus archivos originales.

---

## ⚠️ Seguridad y descargo

- Usa **gafas de protección** adecuadas para la longitud de onda de tu láser.
- Enciende **extracción/ventilación** y no dejes la máquina desatendida.
- Los ajustes de potencia/velocidad son **orientativos**. Haz pruebas en retales.
- La simulación en madera es una aproximación artística, no una garantía del resultado.
- **LightBurn** es una marca de LightBurn Software. **SculpFun** es una marca de SculpFun.
  LaserCat es una herramienta independiente, sin afiliación ni patrocinio.
- La app se ofrece **tal cual**, sin garantías.

---

## ❤️ Créditos

Hecha por **Daniel Hernández Ferrándiz**, como hermana de [CryCat](https://github.com/dhernandezgit/CryCat-Tool),
la herramienta que colocaba imágenes para Cricut. LaserCat cambia el papel por madera, el plotter por
un diodo y el PNG por SVG en milímetros.

- Inspiración y filosofía: **CryCat Tool**.
- Geometría robusta: [clipper-lib](https://github.com/junmer/clipper-lib).
- ZIP: [fflate](https://github.com/101arrowz/fflate).
- Interfaz: React + Vite + TypeScript.

Si te sirve, pásate por el repo y deja una estrella ⭐.

---

## 🇬🇧 English in a nutshell

**LaserCat** is a local-first laser cutting/engraving layout studio. It imports SVGs with real
units and groups, splits them into smart islands (holes included), handles white cut-outs, imports
images as silhouettes / B&W / grayscale / dither / vector halftone, applies sticker offsets and
kerf, nests parts using their true shape, previews the result on nine wood species, and exports
LightBurn-ready SVG in millimetres with colour-coded layers, bridges and a ZIP containing the
project, layer CSV, embedded raster images and wood previews. Defaults: SculpFun S30 10 W,
300 × 300 mm sheet, 5 mm margin, basswood 3 mm. No server, no account, no uploads.

Built by **Daniel Hernández Ferrándiz**. MIT licensed.

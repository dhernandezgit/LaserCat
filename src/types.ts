/** Tipos centrales de LaserCat. Todas las medidas estÃ¡n en milÃ­metros. */

export interface Pt {
  x: number;
  y: number;
}

export type Contour = Pt[];

export type Operation = "cut" | "engrave" | "score";
export type SvgFillRule = "nonzero" | "evenodd";
export type Quality = "rapida" | "equilibrada" | "maxima";
export type RotationMode = "no" | "90" | "libre";
export type PlacementMethod = "auto" | "greedy" | "largest" | "voronoi" | "genetic";
export type PackMode = "shape" | "box";
export type ImageDropMode = "cut" | "engrave-threshold" | "engrave-gray";
export type EngraveMode = "threshold" | "grayscale" | "dither";

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RasterData {
  /** PNG data URL, ya preparado (blanco y negro o grises). */
  dataUrl: string;
  width: number;
  height: number;
  /** ResoluciÃ³n de la imagen, para colocarla a tamaÃ±o fÃ­sico. */
  dpi: number;
  mode: EngraveMode;
  threshold: number;
  invert: boolean;
  /** Matriz afín que lleva el cuadrado unitario de la imagen al bbox local (mm). */
  matrix?: [number, number, number, number, number, number];
}

/** Miembro de un ensamblaje: pieza + desplazamiento relativo al grupo. */
export interface AssemblyMember {
  partId: string;
  dx: number;
  dy: number;
}

/** Grupo de piezas que se mueve, gira y anida como una sola figura. */
export interface Assembly {
  id: string;
  name: string;
  members: AssemblyMember[];
  copies: number;
  color?: string;
}

export interface Part {
  id: string;
  name: string;
  kind: "vector" | "raster";
  /** Contornos locales en mm. El bbox empieza en 0,0. */
  contours: Contour[];
  width: number;
  height: number;
  operation: Operation;
  /** Borde de pegatina en mm (0 = sin borde). */
  offsetMm: number;
  /** Borde independiente para cortar en otra pasada. */
  separateBorder: boolean;
  copies: number;
  source: "svg" | "image" | "demo";
  raster?: RasterData;
  /** Tinte de identificaciÃ³n en el mapa de piezas. */
  color?: string;
  /** Grupo de origen (para el importador). */
  groupId?: string;
  /** Ensamblaje al que pertenece la pieza. */
  assemblyId?: string;
  notes?: string;
  lockedSize?: boolean;
}

export interface Placement {
  id: string;
  partId: string;
  page: number;
  /** Esquina superior izquierda del bbox ya girado, en mm de la plancha. */
  x: number;
  y: number;
  angle: number;
  mirror: boolean;
  pinned: boolean;
  /** Ensamblaje al que pertenece esta colocaciÃ³n. */
  assemblyId?: string;
}

export interface Sheet {
  width: number;
  height: number;
  margin: number;
  spacing: number;
  /** CompensaciÃ³n de kerf total en mm. El corte se desplaza kerf/2. */
  kerf: number;
  rotation: RotationMode;
  quality: Quality;
  /** Estrategia de colocación. */
  method?: PlacementMethod;
  /** Forma real o cajas envolventes. */
  packMode?: PackMode;
  /** Solo una plancha: avisa si algo no cabe. */
  singlePage: boolean;
}

export interface LaserPreset {
  id: string;
  name: string;
  power: number;
  speed: number; // mm/min
  passes: number;
  interval: number; // mm entre lÃ­neas de grabado
  airAssist: boolean;
  notes: string;
}

export interface MaterialPreset {
  id: string;
  name: string;
  species: string;
  thickness: number;
  cut: LaserPreset;
  engrave: LaserPreset;
  score: LaserPreset;
}

export interface Machine {
  id: string;
  name: string;
  watt: number;
  workWidth: number;
  workHeight: number;
}

export interface DocSettings {
  machineId: string;
  materialId: string;
  /** Modo simple u holgado para no saturar la interfaz. */
  expert: boolean;
  /** Recolocar automÃ¡ticamente al importar o cambiar copias. */
  autoNest: boolean;
  imageDropMode?: ImageDropMode;
  compact?: boolean;
  wood3dDepth?: number;
  /** Ajustes de exportaciÃ³n. */
  exportBridges: boolean;
  bridgeCount: number;
  bridgeWidth: number;
  exportKerf: boolean;
  exportFrame: boolean;
  exportOrder: boolean;
  exportNotes: boolean;
  /** Grabado vectorial (puntos) frente a mapa de bits. */
  engraveOutput: "vector" | "raster";
  ditherDotsPerMm: number;
  previewSpecies: string;
  previewBurnTone?: string;
  previewPower: number;
  previewSpeed: number;
  previewPasses: number;
}

export interface Doc {
  version: 1;
  name: string;
  parts: Part[];
  placements: Placement[];
  groups?: Assembly[];
  sheet: Sheet;
  settings: DocSettings;
  /** Semilla del puzzle de madera de ejemplo, si el proyecto es ese demo. */
  puzzleSeed?: number;
  createdAt: number;
  updatedAt: number;
}

export interface SelectionState {
  partIds: string[];
  placementIds: string[];
}

export interface SheetStats {
  pages: number;
  placed: number;
  unplaced: number;
  efficiency: number;
  usedArea: number;
  sheetArea: number;
  cutLength: number;
  engraveArea: number;
  timeSeconds: number;
}

export interface NestOptions {
  sheet: Sheet;
  rotation: RotationMode;
  quality: Quality;
  /** Estrategia de colocación. */
  method?: PlacementMethod;
  /** Forma real o cajas envolventes. */
  packMode?: PackMode;
  compact?: boolean;
  /** Marcas de piezas que ya estÃ¡n colocadas y no deben moverse. */
  pinned: Placement[];
}

export interface NestRequestPart {
  partId: string;
  copies: number;
  /** Contornos efectivos (sin kerf, con borde de pegatina aplicado). */
  contours: Contour[];
  width: number;
  height: number;
  raster?: boolean;
  /** Si se indican, se usan estos Ã¡ngulos en lugar de la rotaciÃ³n global. */
  angles?: number[];
}

export interface NestResult {
  placements: Omit<Placement, "id" | "pinned">[];
  pages: number;
  unplaced: number;
  efficiency: number;
  usedArea: number;
  elapsedMs: number;
}

export interface LayerStyle {
  id: Operation | "border" | "marks";
  name: string;
  color: string;
  fill: boolean;
  description: string;
}

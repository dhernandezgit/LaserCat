/** Temas visuales de LaserCat. Eevee es el predeterminado. */

export interface Theme {
  id: string;
  name: string;
  description: string;
  swatch: [string, string, string];
}

export const THEMES: Theme[] = [
  {
    id: "eevee",
    name: "Eevee",
    description: "Crema, caramelo y papel cálido.",
    swatch: ["#fdf7ec", "#c79355", "#8d4f1e"],
  },
  {
    id: "sylveon",
    name: "Sylveon",
    description: "Rosa suave y tinta frambuesa.",
    swatch: ["#fff6f8", "#d98aa2", "#8b4f68"],
  },
  {
    id: "leafeon",
    name: "Leafeon",
    description: "Verde salvia y papel lino.",
    swatch: ["#fbfaef", "#9caf73", "#4f6b3e"],
  },
  {
    id: "vaporeon",
    name: "Vaporeon",
    description: "Azul agua y tinta profunda.",
    swatch: ["#f8fdff", "#7fd0e6", "#1f6b7a"],
  },
  {
    id: "umbreon",
    name: "Umbreon",
    description: "Noche, lavanda y oro viejo.",
    swatch: ["#2a2637", "#6b5a9a", "#d4a94a"],
  },
  {
    id: "taller",
    name: "Taller",
    description: "Nogal oscuro y latón, el tema original.",
    swatch: ["#352313", "#c5974f", "#f0e1c8"],
  },
];

export const THEME_STORAGE = "lasercat-theme";

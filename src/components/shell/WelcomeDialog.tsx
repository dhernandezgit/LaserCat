import { useEffect, useState } from "react";

const KEY = "lasercat-bienvenida-v1";

export function useWelcome() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);
  const cerrar = () => {
    setVisible(false);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
  };
  return { visible, abrir: () => setVisible(true), cerrar };
}

export function WelcomeDialog({
  open,
  onClose,
  onDetailedHelp,
  onLightBurn,
}: {
  open: boolean;
  onClose: () => void;
  onDetailedHelp: () => void;
  onLightBurn: () => void;
}) {
  if (!open) return null;
  return (
    <div className="cc-modal-back" role="dialog" aria-modal="true" aria-label="Cómo usar LaserCat">
      <div className="cc-modal">
        <h2>Cómo usar LaserCat</h2>
        <p className="lead">El mismo flujo de CryCat, con las herramientas del láser: coloca, ajusta y exporta en un solo sitio.</p>
        <div className="cc-welcome-steps">
          <div className="cc-welcome-card">
            <span className="num">1</span>
            <div className="txt">
              <b>Suelta tus diseños</b>
              <p>SVG, PNG, JPG, WEBP, GIF o BMP. También puedes arrastrarlos sobre la plancha. Se añaden y colocan solos.</p>
            </div>
          </div>
          <div className="cc-welcome-card">
            <span className="num">2</span>
            <div className="txt">
              <b>Revisa grupos y tamaño</b>
              <p>Las imágenes SVG grandes se convierten en figuras que engloban sus cortes. Ajusta tamaño, copias y borde en cada tarjeta.</p>
            </div>
          </div>
          <div className="cc-welcome-card">
            <span className="num">3</span>
            <div className="txt">
              <b>Deja que se coloque solo</b>
              <p>Activa <b>Auto optimizar</b> y elige método, rotación y calidad. Mueve o fija piezas; el resto se recoloca alrededor.</p>
            </div>
          </div>
          <div className="cc-welcome-card">
            <span className="num">4</span>
            <div className="txt">
              <b>Previsualiza en madera</b>
              <p>Cambia de madera, tono e intensidad en <b>Material</b>. La simulación es orientativa: haz una prueba pequeña.</p>
            </div>
          </div>
          <div className="cc-welcome-card">
            <span className="num">5</span>
            <div className="txt">
              <b>Guarda y exporta</b>
              <p><b>Guardar</b> descarga el proyecto; <b>Exportar</b> crea el ZIP para LightBurn en milímetros, con capas e imágenes incrustadas.</p>
            </div>
          </div>
        </div>
        <p className="micro-help">Las figuras guardadas conservan sus imágenes. Tus archivos originales nunca se modifican.</p>
        <div className="cc-modal-foot">
          <button type="button" className="cc-btn" onClick={onDetailedHelp}>
            Guía detallada
          </button>
          <button type="button" className="cc-btn" onClick={onLightBurn}>
            Pasos en LightBurn
          </button>
          <button type="button" className="cc-btn primary" onClick={onClose}>
            ¡Entendido!
          </button>
        </div>
      </div>
    </div>
  );
}

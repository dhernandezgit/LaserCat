import { useEffect, useState } from "react";
import type { Dispatch } from "react";
import type { Action } from "../../lib/store";
import {
  cloneSavedGroup,
  deleteSavedGroup,
  loadGroupLibrary,
  notifyGroupsChanged,
  type SavedGroup,
} from "../../lib/groupLibrary";
import { Icon } from "../UI";

export function GroupLibraryDialog({
  open,
  onClose,
  dispatch,
}: {
  open: boolean;
  onClose: () => void;
  dispatch: Dispatch<Action>;
}) {
  const [items, setItems] = useState<SavedGroup[]>([]);
  useEffect(() => {
    if (!open) return;
    setItems(loadGroupLibrary());
    const reload = () => setItems(loadGroupLibrary());
    window.addEventListener("lasercat:groups-changed", reload);
    return () => window.removeEventListener("lasercat:groups-changed", reload);
  }, [open]);

  if (!open) return null;

  const insert = (saved: SavedGroup) => {
    const { parts, group } = cloneSavedGroup(saved);
    dispatch({ type: "ADD_PARTS", parts, groups: [group] });
    dispatch({ type: "TOAST", text: `Figura «${saved.name}» insertada.`, kind: "ok" });
    onClose();
  };

  return (
    <div className="cc-modal-back" role="dialog" aria-modal="true" aria-label="Biblioteca de figuras">
      <div className="cc-modal" style={{ maxWidth: 760 }}>
        <h2>Biblioteca de figuras</h2>
        <p className="lead">Figuras guardadas con su nombre y sus imágenes. Insértalas en esta plancha o bórralas.</p>
        {!items.length && (
          <div className="library-empty-box">
            <Icon name="save" size={24} />
            <b>Aún no hay figuras guardadas</b>
            <span>Pulsa el disquete en una tarjeta de figura para guardarla con sus imágenes.</span>
          </div>
        )}
        <div className="library-grid">
          {items.map((saved) => (
            <div className="library-item" key={saved.id}>
              <div className="library-thumb">
                {saved.thumbnail ? <img src={saved.thumbnail} alt="" /> : <Icon name="shapes" size={22} />}
              </div>
              <div className="library-meta">
                <b>{saved.name}</b>
                <span>{saved.parts.length} piezas · {new Date(saved.createdAt).toLocaleDateString()}</span>
              </div>
              <button type="button" className="cc-btn primary" onClick={() => insert(saved)}>
                Insertar
              </button>
              <button
                type="button"
                className="cc-icon danger"
                title="Borrar de la biblioteca"
                onClick={() => {
                  deleteSavedGroup(saved.id);
                  notifyGroupsChanged();
                  setItems(loadGroupLibrary());
                }}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="cc-modal-foot">
          <button type="button" className="cc-btn" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

import React from "react";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("LaserCat crashed", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash-screen">
        <div className="crash-card">
          <img src={`${import.meta.env.BASE_URL}icon.png`} alt="LaserCat" />
          <h1>LaserCat se ha atascado</h1>
          <p>
            Ha ocurrido un error inesperado. Tu proyecto guardado en este navegador sigue ahí.
            Recarga la página para volver al taller.
          </p>
          <pre>{this.state.error.message}</pre>
          <div className="crash-actions">
            <button type="button" className="btn btn-primary btn-md" onClick={() => window.location.reload()}>
              Recargar
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-md"
              onClick={() => {
                localStorage.removeItem("lasercat-doc-v1");
                window.location.reload();
              }}
            >
              Empezar de cero
            </button>
          </div>
        </div>
      </div>
    );
  }
}

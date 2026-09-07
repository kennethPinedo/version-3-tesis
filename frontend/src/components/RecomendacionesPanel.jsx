import { useEffect, useState } from "react";
import { req } from "../lib/api";

/**
 * Panel de analítica PRESCRIPTIVA.
 *
 * Consume `GET /predicciones/{id}/recomendaciones/`, donde las reglas compuestas
 * se evalúan a partir de la salida de los modelos. Se resuelve en el backend a
 * propósito: así el plan de acción queda versionado, auditable y no puede
 * contradecir la predicción mostrada en pantalla.
 *
 * @param {Object} props
 * @param {number|null} props.predId  Id de la predicción vigente.
 * @param {boolean} [props.compacto]  Oculta el detalle de acciones (dashboard).
 */
export default function RecomendacionesPanel({ predId, compacto = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!predId) { setData(null); setError(""); return; }
    let cancelado = false;
    setLoading(true);
    setError("");
    req(`/predicciones/${predId}/recomendaciones/`)
      .then((res) => { if (!cancelado) setData(res); })
      .catch((err) => { if (!cancelado) setError(err.message || "No se pudieron cargar las recomendaciones."); })
      .finally(() => { if (!cancelado) setLoading(false); });
    return () => { cancelado = true; };
  }, [predId]);

  if (!predId) {
    return <p className="form-legend">Genera una predicción para obtener el plan de acción.</p>;
  }
  if (loading) {
    return <p className="form-legend">Generando plan de acción…</p>;
  }
  if (error) {
    return <div className="alert-error" role="alert">{error}</div>;
  }
  if (!data?.recomendaciones?.length) {
    return <p className="form-legend">Sin recomendaciones disponibles.</p>;
  }

  const { contexto, recomendaciones, aviso } = data;

  return (
    <div>
      {contexto?.convergencia && (
        <div
          className="alert-error"
          role="alert"
          style={{ marginBottom: 12, fontWeight: 600 }}
        >
          ⚠ Convergencia de factores: probabilidad alta de TDAH junto con riesgo académico alto.
        </div>
      )}

      <ul className="rec-list">
        {recomendaciones.map((r) => (
          <li key={r.id} className="rec-item" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
            <span className="rec-icon">{r.icono}</span>
            <span className="rec-text" style={{ flex: 1, minWidth: 220 }}>
              <b>{r.titulo}</b>
              <span style={{ display: "block", fontSize: "0.74rem", color: "#94a3b8", margin: "2px 0 0" }}>
                Regla: {r.regla} · Responsable: {r.responsable}
              </span>
              {!compacto && (
                <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "#475569", fontSize: "0.84rem", lineHeight: 1.6 }}>
                  {r.acciones.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              )}
            </span>
            <span className={`priority-tag priority-tag--${r.prioridad === "critica" ? "alta" : r.prioridad}`}>
              {r.prioridad_label}
            </span>
          </li>
        ))}
      </ul>

      {aviso && (
        <p
          style={{
            marginTop: 12, padding: "10px 12px", background: "#fffbeb",
            border: "1px solid #fde68a", borderRadius: 8,
            color: "#92400e", fontSize: "0.76rem", lineHeight: 1.6,
          }}
        >
          <b>Aviso: </b>{aviso}
        </p>
      )}
    </div>
  );
}

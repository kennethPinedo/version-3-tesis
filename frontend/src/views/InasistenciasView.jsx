import { useEffect, useState } from "react";
import { reqJson } from "../lib/api";

/**
 * Módulo "Control de Inasistencias" (rol Docente).
 *
 * Registra los días de inasistencia acumulados del estudiante. Es un módulo
 * INDEPENDIENTE de la encuesta EDAH: el instrumento psicométrico contiene
 * únicamente sus 20 ítems. Al guardar, el backend recalcula la predicción
 * porque las inasistencias son una de las tres variables del MODELO 2.
 *
 * @param {Object} props
 * @param {Array<{id:number, nombre:string, apellido:string, grado:string, inasistencias?:number}>} props.alumnos
 * @param {() => Promise<void>|void} props.onGuardado  Refresca datos del padre.
 * @param {(msg: string, error?: boolean) => void} [props.notify]  Toast global.
 */
export default function InasistenciasView({ alumnos, onGuardado, notify }) {
  const [alumnoId, setAlumnoId] = useState("");
  const [dias, setDias] = useState("0");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState({ msg: "", error: false });

  const alumnoSel = alumnos.find((a) => String(a.id) === String(alumnoId)) ?? null;

  // Precarga el valor vigente del alumno seleccionado.
  useEffect(() => {
    setFeedback({ msg: "", error: false });
    setDias(alumnoSel ? String(alumnoSel.inasistencias ?? 0) : "0");
  }, [alumnoId]); // eslint-disable-line react-hooks/exhaustive-deps

  const guardar = async (e) => {
    e.preventDefault();
    if (!alumnoId) {
      setFeedback({ msg: "Selecciona un estudiante.", error: true });
      return;
    }
    const valor = Number(dias);
    if (!Number.isInteger(valor) || valor < 0) {
      setFeedback({ msg: "Los días de inasistencia deben ser un entero mayor o igual a 0.", error: true });
      return;
    }

    setLoading(true);
    setFeedback({ msg: "", error: false });
    try {
      const res = await reqJson(
        `/alumnos/${alumnoId}/inasistencias`,
        "PUT",
        { inasistencias: valor }
      );
      const extra = res.prediccion_actualizada
        ? " La predicción del estudiante se recalculó con el nuevo valor."
        : " (Aún no hay encuesta EDAH: la predicción se generará cuando se aplique.)";
      setFeedback({ msg: (res.mensaje ?? "Inasistencias guardadas.") + extra, error: false });
      notify?.(`Inasistencias actualizadas: ${valor} día(s).`);
      await onGuardado?.();
    } catch (err) {
      setFeedback({ msg: err.message || "No se pudieron guardar las inasistencias.", error: true });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="notas-layout">
      <h1 className="page-title">Control de Inasistencias</h1>
      <article className="panel panel-notas">
        <p className="form-legend full">
          Registra los días de inasistencia acumulados del estudiante. Este dato alimenta
          directamente el modelo de <strong>Riesgo Académico</strong>, junto con las notas y
          la probabilidad de TDAH.
        </p>

        <form className="grid notas-form" onSubmit={guardar}>
          <div className="field-group full">
            <label htmlFor="inasist-alumno">Estudiante</label>
            <select
              id="inasist-alumno"
              value={alumnoId}
              onChange={(e) => setAlumnoId(e.target.value)}
              disabled={loading}
              required
            >
              <option value="">-- Selecciona --</option>
              {alumnos.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre} {a.apellido} - {a.grado}
                </option>
              ))}
            </select>
          </div>

          <div className="field-group full" style={{ maxWidth: 280 }}>
            <label htmlFor="inasist-dias">Días de inasistencia acumulados</label>
            <input
              id="inasist-dias"
              type="number"
              min="0"
              step="1"
              max="365"
              value={dias}
              onChange={(e) => setDias(e.target.value)}
              disabled={loading || !alumnoId}
              required
            />
          </div>

          {alumnoSel && (
            <div
              className="full"
              style={{ padding: "10px 14px", background: "#f1f5f9", borderRadius: 8, fontSize: "0.92rem" }}
            >
              <b>Valor registrado actualmente:</b>{" "}
              <span style={{ fontWeight: 700, color: "#1e3a5f" }}>
                {alumnoSel.inasistencias ?? 0} día(s)
              </span>
            </div>
          )}

          {feedback.msg && (
            <div className={feedback.error ? "alert-error" : "alert-success"} role="status">
              {feedback.msg}
            </div>
          )}

          <button className="full" type="submit" disabled={loading || !alumnoId}>
            {loading ? "Guardando…" : "Guardar Inasistencias"}
          </button>
        </form>
      </article>
    </div>
  );
}

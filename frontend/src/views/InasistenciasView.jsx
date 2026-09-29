import React, { useCallback, useEffect, useMemo, useState } from "react";
import { reqJson } from "../lib/api";

/**
 * Control de Inasistencias.
 *
 * Se registra la asistencia POR FECHA, no como un total acumulado. El contador
 * anterior decía «7 días» sin decir cuáles, y eso no permitía distinguir siete
 * faltas repartidas en el año de una semana entera seguida, que para un tutor
 * significan cosas distintas.
 *
 * Se anota también la asistencia, no solo la falta: «asistió» distingue «vino
 * ese día» de «nadie lo anotó», y esa diferencia importa cuando alguien revisa
 * el historial meses después.
 */

const ESTADOS = ["No asistió", "Asistió"];

/** Fecha de hoy en formato yyyy-mm-dd, en hora local (no UTC). */
function hoyISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Día de la semana de una fecha yyyy-mm-dd, sin pasar por UTC.
 *
 * `new Date("2026-09-26")` se interpreta como medianoche UTC, así que en Perú
 * (UTC-5) devuelve el día anterior y un sábado pasaría por viernes.
 */
function diaSemana(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d).getDay(); // 0=domingo, 6=sábado
}

const esFinDeSemana = (iso) => [0, 6].includes(diaSemana(iso));

const NOMBRE_DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function formatearFecha(iso) {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-").map(Number);
  const f = new Date(a, m - 1, d);
  return `${NOMBRE_DIA[f.getDay()]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${a}`;
}

export default function InasistenciasView({ alumnos, notify, confirmar, onGuardado }) {
  const [alumnoId, setAlumnoId] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [estado, setEstado] = useState(ESTADOS[0]);
  const [datos, setDatos] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [feedback, setFeedback] = useState({ msg: "", error: false });

  const alumnoSel = alumnos.find((a) => String(a.id) === String(alumnoId)) ?? null;

  const cargar = useCallback(() => {
    if (!alumnoId) { setDatos(null); return; }
    reqJson(`/alumnos/${alumnoId}/asistencias`)
      .then(setDatos)
      .catch(() => setDatos(null));
  }, [alumnoId]);

  useEffect(() => {
    setFeedback({ msg: "", error: false });
    cargar();
  }, [cargar]);

  // El navegador bloquea los fines de semana solo si se le impide elegirlos, y
  // el atributo `max` evita además las fechas futuras.
  const finde = fecha && esFinDeSemana(fecha);

  const guardar = async (e) => {
    e.preventDefault();
    if (!alumnoId) { setFeedback({ msg: "Selecciona un estudiante.", error: true }); return; }
    if (finde) {
      setFeedback({ msg: `El ${NOMBRE_DIA[diaSemana(fecha)]} no es día lectivo.`, error: true });
      return;
    }

    const yaExiste = datos?.registros?.find((r) => r.fecha === fecha);
    if (confirmar && !await confirmar({
      titulo: yaExiste
        ? `¿Corregir el registro del ${formatearFecha(fecha)}?`
        : `¿Registrar «${estado}» el ${formatearFecha(fecha)}?`,
      mensaje: yaExiste
        ? `Ese día ya estaba anotado como «${yaExiste.estado}». Se reemplazará por «${estado}».`
        : "Si el estado es «No asistió», el total del estudiante sube en uno y su "
          + "predicción de riesgo se recalcula.",
      detalles: [
        { etiqueta: "Estudiante", valor: alumnoSel ? `${alumnoSel.nombre} ${alumnoSel.apellido}` : "—" },
        { etiqueta: "Fecha", valor: formatearFecha(fecha) },
        { etiqueta: "Estado", valor: estado, antes: yaExiste?.estado },
      ],
      tono: yaExiste ? "aviso" : "normal",
      textoConfirmar: yaExiste ? "Sí, corregir" : "Sí, registrar",
    })) return;

    setGuardando(true);
    try {
      const r = await reqJson(`/alumnos/${alumnoId}/asistencias`, "POST", { fecha, estado });
      setFeedback({ msg: r.mensaje, error: false });
      notify?.(r.mensaje);
      cargar();
      await onGuardado?.();
    } catch (err) {
      setFeedback({ msg: err.message || "No se pudo registrar.", error: true });
    } finally {
      setGuardando(false);
    }
  };

  const borrar = async (registro) => {
    if (confirmar && !await confirmar({
      titulo: `¿Eliminar el registro del ${formatearFecha(registro.fecha)}?`,
      mensaje: registro.estado === "No asistió"
        ? "El total de inasistencias bajará en uno y la predicción se recalculará."
        : "Ese día dejará de constar como asistido.",
      tono: "peligro",
      textoConfirmar: "Sí, eliminar",
    })) return;

    try {
      const r = await reqJson(`/alumnos/${alumnoId}/asistencias/${registro.id}`, "DELETE");
      notify?.(r.mensaje);
      cargar();
      await onGuardado?.();
    } catch (err) {
      notify?.(err.message || "No se pudo eliminar.", true);
    }
  };

  const faltas = useMemo(
    () => (datos?.registros ?? []).filter((r) => r.estado === "No asistió"),
    [datos],
  );

  return (
    <div className="notas-layout">
      <h1 className="page-title">Control de Inasistencias</h1>

      <article className="panel panel-notas">
        <p className="form-legend full">
          Se registra día a día. Los sábados y domingos no son lectivos y el
          calendario no permite elegirlos.
        </p>

        <form className="grid" onSubmit={guardar}>
          <div className="field-group full">
            <label htmlFor="asist-alumno">Estudiante</label>
            <select id="asist-alumno" value={alumnoId} onChange={(e) => setAlumnoId(e.target.value)} required>
              <option value="">-- Selecciona --</option>
              {alumnos.map((a) => (
                <option key={a.id} value={a.id}>{a.nombre} {a.apellido} — {a.grado}</option>
              ))}
            </select>
          </div>

          <div className="field-group">
            <label htmlFor="asist-estado">¿Asistió?</label>
            <select id="asist-estado" value={estado} onChange={(e) => setEstado(e.target.value)}>
              {ESTADOS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="field-group">
            <label htmlFor="asist-fecha">Fecha</label>
            <input
              id="asist-fecha"
              type="date"
              value={fecha}
              max={hoyISO()}
              onChange={(e) => setFecha(e.target.value)}
              aria-describedby="asist-fecha-ayuda"
              required
            />
            <span id="asist-fecha-ayuda" className="form-legend" style={{ marginTop: 4 }}>
              {finde
                ? <strong style={{ color: "var(--alto)" }}>
                    El {NOMBRE_DIA[diaSemana(fecha)]} no es día lectivo.
                  </strong>
                : <>Día lectivo, de lunes a viernes. No se admiten fechas futuras.</>}
            </span>
          </div>

          {feedback.msg && (
            <div
              className={`full ${feedback.error ? "alert-error" : "alert-success"}`}
              role={feedback.error ? "alert" : "status"}
              aria-live="polite"
            >
              {feedback.msg}
            </div>
          )}

          <button className="full" type="submit" disabled={guardando || !alumnoId || finde}>
            {guardando
              ? (<><span className="spinner" aria-hidden="true" style={{ marginRight: 8, verticalAlign: "-2px" }} />Guardando…</>)
              : "Registrar"}
          </button>
        </form>
      </article>

      {alumnoSel && datos && (
        <article className="panel">
          <h2 className="chart-title">
            Histórico de {alumnoSel.nombre} {alumnoSel.apellido}
          </h2>

          {datos.registros.length === 0 ? (
            <p className="form-legend">
              Todavía no hay días registrados para este estudiante.
            </p>
          ) : (
            <div className="asist-tabla-wrap">
              <table className="tabla">
                <thead>
                  <tr><th>Estudiante</th><th>Fecha</th><th>Estado</th><th>Registrado por</th><th></th></tr>
                </thead>
                <tbody>
                  {datos.registros.map((r) => (
                    <tr key={r.id}>
                      <td>{alumnoSel.nombre} {alumnoSel.apellido}</td>
                      <td>{formatearFecha(r.fecha)}</td>
                      <td>
                        {/* El icono acompaña al color: con deuteranopia el rojo
                            y el cian se distinguen, pero el símbolo no depende
                            de verlos (WCAG 1.4.1). */}
                        <span className={r.estado === "No asistió" ? "asist-falta" : "asist-ok"}>
                          <span aria-hidden="true">{r.estado === "No asistió" ? "✕" : "✓"}</span> {r.estado}
                        </span>
                      </td>
                      <td>{r.registrado_por}</td>
                      <td>
                        <button type="button" className="lista-btn lista-btn--del" onClick={() => borrar(r)}>
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* El total es lo que consume el modelo de riesgo, así que se muestra
              desglosado: si no cuadrase con la lista, habría que poder ver por qué. */}
          <div className="asist-total">
            <div className="asist-total-fila">
              <span>Inasistencias con fecha registrada</span>
              <strong>{datos.faltas_con_fecha}</strong>
            </div>
            {datos.inasistencias_previas > 0 && (
              <div className="asist-total-fila asist-total-fila--nota">
                <span>
                  Anteriores a este registro
                  <br />
                  <span className="form-legend">
                    Constaban como total acumulado, sin fecha anotada. Se conservan
                    para no alterar el historial del estudiante.
                  </span>
                </span>
                <strong>{datos.inasistencias_previas}</strong>
              </div>
            )}
            <div className="asist-total-fila asist-total-fila--suma">
              <span>Total de inasistencias</span>
              <strong>{datos.total} día(s)</strong>
            </div>
          </div>

          {faltas.length > 0 && (
            <p className="form-legend" style={{ marginTop: "var(--e3)" }}>
              Este total es una de las tres variables del modelo de riesgo académico,
              junto al promedio de notas y la probabilidad de TDAH. Cada cambio
              recalcula la predicción del estudiante.
            </p>
          )}
        </article>
      )}
    </div>
  );
}

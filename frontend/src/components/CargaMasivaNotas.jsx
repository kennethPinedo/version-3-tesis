import { useState } from "react";
import { uploadFile } from "../lib/api";

const PLANTILLA = "alumno_id,bimestre,asignatura,calificacion";

/**
 * Carga masiva de notas (CSV / Excel) contra `POST /notas/carga-masiva/`.
 *
 * La validación fila por fila se hace en el backend, que devuelve las filas
 * aceptadas y el motivo exacto de cada rechazo sin abortar el lote.
 *
 * @param {Object} props
 * @param {() => Promise<void>|void} [props.onProcesado] Refresca datos del padre.
 * @param {(msg: string, error?: boolean) => void} [props.notify]
 */
export default function CargaMasivaNotas({ onProcesado, notify }) {
  const [archivo, setArchivo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState(null);

  const descargarPlantilla = () => {
    const contenido = `${PLANTILLA}\n1,1,Matemática,A\n1,1,Comunicación,AD\n`;
    const url = URL.createObjectURL(new Blob([contenido], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla_notas.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const procesar = async (e) => {
    e.preventDefault();
    setError("");
    setResultado(null);
    if (!archivo) {
      setError("Selecciona un archivo CSV o Excel.");
      return;
    }

    setLoading(true);
    try {
      const res = await uploadFile("/notas/carga-masiva/", archivo, "archivo");
      setResultado(res);
      notify?.(res.mensaje ?? "Archivo procesado.", res.procesados === 0);
      if (res.procesados > 0) await onProcesado?.();
    } catch (err) {
      setError(err.message || "No se pudo procesar el archivo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="grid notas-form" onSubmit={procesar}>
      <p className="form-legend full">
        Archivo <strong>CSV</strong> o <strong>Excel (.xlsx)</strong> con las columnas{" "}
        <strong>{PLANTILLA}</strong>. La fila de encabezado es opcional. Reglas:{" "}
        <strong>bimestre</strong> entero entre 1 y 4; <strong>calificacion</strong> AD, A, B o C.
        Las filas válidas se guardan aunque otras sean rechazadas.
      </p>

      <div className="full" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="file"
          accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setResultado(null); setError(""); }}
          disabled={loading}
          style={{ flex: 1, minWidth: 240 }}
        />
        <button
          type="button"
          onClick={descargarPlantilla}
          style={{ width: "auto", padding: "8px 14px", background: "#475569" }}
        >
          ⬇ Plantilla CSV
        </button>
      </div>

      {error && <div className="alert-error full" role="alert">{error}</div>}

      {resultado && (
        <div className="full">
          <div
            className={resultado.procesados > 0 ? "alert-success" : "alert-error"}
            role="status"
          >
            <b>{resultado.procesados}</b> nota(s) registrada(s) ·{" "}
            <b>{resultado.rechazados}</b> fila(s) rechazada(s) ·{" "}
            <b>{resultado.predicciones_actualizadas}</b> predicción(es) actualizada(s).
          </div>

          {resultado.errores?.length > 0 && (
            <div
              style={{
                marginTop: 10, padding: "10px 14px", background: "#fef2f2",
                border: "1px solid #fecaca", borderRadius: 8, maxHeight: 220, overflowY: "auto",
              }}
            >
              <b style={{ color: "#b91c1c", fontSize: "0.86rem" }}>Detalle de filas rechazadas</b>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "#7f1d1d", fontSize: "0.82rem", lineHeight: 1.7 }}>
                {resultado.errores.map((msg, i) => <li key={i}>{msg}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      <button className="full" type="submit" disabled={loading || !archivo}>
        {loading ? "Procesando archivo…" : "Procesar archivo"}
      </button>
    </form>
  );
}

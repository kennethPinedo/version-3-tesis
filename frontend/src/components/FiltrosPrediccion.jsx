import { FILTROS_INICIALES, hayFiltroActivo } from "../lib/predicciones";

const OPCIONES_TDAH = [
  { value: "Todos", label: "Todos" },
  { value: "Alta",  label: "Probabilidad Alta" },
  { value: "Media", label: "Probabilidad Media" },
  { value: "Baja",  label: "Probabilidad Baja" },
];

const OPCIONES_RIESGO = [
  { value: "Todos", label: "Todos" },
  { value: "Alto",  label: "Alto" },
  { value: "Medio", label: "Medio" },
  { value: "Bajo",  label: "Bajo" },
];

/**
 * Controles de filtrado cruzado (AND) para los dashboards.
 *
 * @param {Object} props
 * @param {import("../lib/predicciones").FiltrosPrediccion} props.filtros
 * @param {(f: import("../lib/predicciones").FiltrosPrediccion) => void} props.onChange
 * @param {number} [props.total]      Total de registros disponibles.
 * @param {number} [props.mostrados]  Registros tras aplicar el filtro.
 */
export default function FiltrosPrediccion({ filtros, onChange, total, mostrados }) {
  const activo = hayFiltroActivo(filtros);

  return (
    <article className="panel" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="field-group" style={{ minWidth: 220, flex: 1 }}>
          <label htmlFor="filtro-tdah">Probabilidad de TDAH</label>
          <select
            id="filtro-tdah"
            value={filtros.tdah}
            onChange={(e) => onChange({ ...filtros, tdah: e.target.value })}
          >
            {OPCIONES_TDAH.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="field-group" style={{ minWidth: 220, flex: 1 }}>
          <label htmlFor="filtro-riesgo">Nivel de Riesgo Académico</label>
          <select
            id="filtro-riesgo"
            value={filtros.riesgo}
            onChange={(e) => onChange({ ...filtros, riesgo: e.target.value })}
          >
            {OPCIONES_RIESGO.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => onChange({ ...FILTROS_INICIALES })}
          disabled={!activo}
          style={{ width: "auto", padding: "8px 16px", opacity: activo ? 1 : 0.5 }}
        >
          Limpiar filtros
        </button>
      </div>

      {typeof total === "number" && (
        <p className="form-legend" style={{ margin: "10px 0 0" }}>
          {activo
            ? `Mostrando ${mostrados} de ${total} estudiante(s) evaluado(s) · filtro cruzado activo.`
            : `${total} estudiante(s) evaluado(s).`}
        </p>
      )}
    </article>
  );
}

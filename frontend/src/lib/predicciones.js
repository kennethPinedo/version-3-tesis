/**
 * Helpers compartidos de predicción: normalización de niveles, colores y el
 * filtrado cruzado que usan los dos dashboards.
 *
 * @typedef {Object} Prediccion
 * @property {number} id
 * @property {number} alumno
 * @property {string|null} alumno_nombre
 * @property {"Alto"|"Medio"|"Bajo"} nivel_riesgo
 * @property {number} probabilidad
 * @property {string|null} nivel_tdah   "Sospecha Baja|Media|Alta"
 * @property {number|null} confianza_tdah
 * @property {number|null} inasistencias
 * @property {string|null} fecha_prediccion
 *
 * @typedef {"Todos"|"Alta"|"Media"|"Baja"} FiltroTdah
 * @typedef {"Todos"|"Alto"|"Medio"|"Bajo"} FiltroRiesgo
 * @typedef {{tdah: FiltroTdah, riesgo: FiltroRiesgo}} FiltrosPrediccion
 */

/*
 * Se apunta a los tokens del CSS en lugar de repetir los hexadecimales: cuando
 * «Bajo» pasó de verde a cian —porque con deuteranopia el verde y el ámbar se
 * veían idénticos— estas constantes se quedaron con el verde viejo y la
 * interfaz mostraba dos colores distintos para lo mismo. Con var() eso no
 * puede repetirse: el color vive en un único sitio.
 */
export const RIESGO_COLORS = {
  Alto: "var(--alto)",
  Medio: "var(--medio)",
  Moderado: "var(--medio)",
  Bajo: "var(--bajo)",
};

export const PROB_COLORS = {
  "Sospecha Alta": "var(--alto)",
  "Sospecha Media": "var(--medio)",
  "Sospecha Baja": "var(--bajo)",
  // Predicciones antiguas, sin la distribución completa del modelo.
  "Resto de clases": "var(--linea-fuerte)",
};

/** @type {FiltrosPrediccion} */
export const FILTROS_INICIALES = { tdah: "Todos", riesgo: "Todos" };

/*
 * Opciones de los desplegables de filtro.
 *
 * Estaban escritas dos veces —en FiltrosPrediccion.jsx y en el buscador del
 * dashboard— y ya habían empezado a divergir en las etiquetas. Aquí viven una
 * sola vez, junto a la función que las aplica, para que añadir un nivel no
 * exija acordarse de tocar dos archivos.
 */
export const OPCIONES_RIESGO = [
  { value: "Todos", label: "Todos" },
  { value: "Alto", label: "Alto" },
  { value: "Medio", label: "Medio" },
  { value: "Bajo", label: "Bajo" },
];

export const OPCIONES_TDAH = [
  { value: "Todos", label: "Todas" },
  { value: "Alta", label: "Alta" },
  { value: "Media", label: "Media" },
  { value: "Baja", label: "Baja" },
];

/**
 * Texto visible del indicador de TDAH: muestra "Probabilidad" en vez de
 * "Sospecha" (solo presentación; el modelo sigue usando "Sospecha").
 * @param {string|null|undefined} s
 */
export const tdahTexto = (s) => String(s ?? "—").replace("Sospecha", "Probabilidad");

/**
 * Normaliza la clase del modelo al nivel mostrado en el dashboard.
 * Acepta tanto el vocabulario nuevo ("Sospecha Alta") como el antiguo
 * ("Con TDAH") de predicciones guardadas hace tiempo.
 * @param {string|null|undefined} nivelTdah
 * @returns {"Alta"|"Media"|"Baja"}
 */
export function tdahNivelProb(nivelTdah) {
  const n = String(nivelTdah ?? "");
  if (n.includes("Alta") || n === "Con TDAH") return "Alta";
  if (n.includes("Media") || n.startsWith("Sospechoso")) return "Media";
  return "Baja";
}

/** Fecha legible: "16 de junio de 2026, 14:30" */
export function formatFecha(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("es-PE", {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Deja solo la predicción más reciente de cada alumno.
 * (El backend ya devuelve ordenado por fecha descendente.)
 * @param {Prediccion[]} predicciones
 * @returns {Prediccion[]}
 */
export function ultimaPorAlumno(predicciones) {
  const porAlumno = {};
  (predicciones ?? []).forEach((p) => {
    if (!porAlumno[p.alumno]) porAlumno[p.alumno] = p;
  });
  return Object.values(porAlumno);
}

/**
 * Filtrado CRUZADO (AND) por probabilidad de TDAH y nivel de riesgo académico.
 * @param {Prediccion[]} predicciones
 * @param {FiltrosPrediccion} filtros
 * @returns {Prediccion[]}
 */
export function filtrarPredicciones(predicciones, filtros) {
  const { tdah = "Todos", riesgo = "Todos" } = filtros ?? {};
  return (predicciones ?? []).filter((p) => {
    const okTdah = tdah === "Todos" || tdahNivelProb(p.nivel_tdah) === tdah;
    const okRiesgo = riesgo === "Todos" || p.nivel_riesgo === riesgo;
    return okTdah && okRiesgo;
  });
}

/** ¿Hay algún filtro activo? @param {FiltrosPrediccion} filtros */
export function hayFiltroActivo(filtros) {
  return (filtros?.tdah ?? "Todos") !== "Todos" || (filtros?.riesgo ?? "Todos") !== "Todos";
}

/**
 * Contadores por grupo sobre el conjunto YA filtrado (así las tarjetas KPI
 * reaccionan al filtrado cruzado).
 * @param {Prediccion[]} predicciones
 */
export function contarPorGrupo(predicciones) {
  const riesgo = { Alto: 0, Medio: 0, Bajo: 0 };
  const tdah = { Alta: 0, Media: 0, Baja: 0 };
  (predicciones ?? []).forEach((p) => {
    if (riesgo[p.nivel_riesgo] != null) riesgo[p.nivel_riesgo]++;
    tdah[tdahNivelProb(p.nivel_tdah)]++;
  });
  return { riesgo, tdah };
}

/**
 * Matriz de roles y navegación (RBAC).
 *
 * Fuente única de verdad para: qué ve cada rol en la barra lateral, a qué rutas
 * puede navegar y qué acciones puede ejecutar dentro de una vista.
 *
 * @typedef {"Administrador"|"Psicólogo"|"Docente"} Rol
 * @typedef {"dashboard"|"general"|"alumno"|"lista"|"encuesta"|"inasistencias"|"predicciones"|"notas"|"expediente"} Vista
 */

/**
 * Orden canónico del menú lateral. "inasistencias" va inmediatamente después de
 * "encuesta"; cada rol renderiza este mismo orden filtrado por sus permisos.
 * @type {Vista[]}
 */
export const VISTAS = [
  "dashboard",
  "general",
  "alumno",
  "lista",
  "encuesta",
  "inasistencias",
  "predicciones",
  "notas",
  "expediente",
];

/** @type {Record<Vista, {icon: string, label: string}>} */
export const NAV_LABELS = {
  dashboard:     { icon: "⊞", label: "Dashboard" },
  general:       { icon: "▦", label: "Dashboard General" },
  alumno:        { icon: "◎", label: "Registrar Alumno" },
  lista:         { icon: "≡", label: "Listado de Alumnos" },
  encuesta:      { icon: "☰", label: "Encuesta Psicoeducativa" },
  inasistencias: { icon: "🗓", label: "Control de Inasistencias" },
  predicciones:  { icon: "↗", label: "Historial de Predicciones" },
  notas:         { icon: "✎", label: "Subir Notas" },
  expediente:    { icon: "⊡", label: "Expediente Psicológico" },
};

/**
 * Vistas permitidas por rol.
 *  - Docente: gestión académica (alumnos, inasistencias, notas) sin acceso clínico.
 *  - Psicólogo: evaluación clínica y expediente; el listado es de solo lectura.
 * @type {Record<Rol, Vista[]>}
 */
const PERMISOS = {
  "Administrador": VISTAS,
  "Docente": [
    "dashboard",
    "general",
    "alumno",
    "lista",
    "inasistencias",
    "predicciones",
    "notas",
  ],
  "Psicólogo": [
    "dashboard",
    "general",
    "lista",
    "encuesta",
    "predicciones",
    "expediente",
  ],
};

/**
 * Vistas de un rol, en el orden canónico del menú.
 * @param {string} rol
 * @returns {Vista[]}
 */
export function viewsDeRol(rol) {
  const permitidas = PERMISOS[rol] ?? VISTAS;
  return VISTAS.filter((v) => permitidas.includes(v));
}

/**
 * ¿El rol puede entrar a la vista?
 * @param {string} rol @param {string} vista
 */
export function puedeVer(rol, vista) {
  return viewsDeRol(rol).includes(/** @type {Vista} */ (vista));
}

/**
 * Permiso de escritura sobre el listado de alumnos (crear / editar / eliminar).
 * El Psicólogo accede en modo estricto de solo lectura.
 * @param {string} rol
 */
export function puedeGestionarAlumnos(rol) {
  return rol === "Docente" || rol === "Administrador";
}

/**
 * Vista inicial tras iniciar sesión (siempre permitida para el rol).
 * @param {string} rol
 * @returns {Vista}
 */
export function vistaInicial(rol) {
  return viewsDeRol(rol)[0] ?? "dashboard";
}

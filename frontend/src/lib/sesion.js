/**
 * Sesión del usuario en el navegador.
 *
 * Se usa `sessionStorage` y no `localStorage` a propósito: el token se borra al
 * cerrar la pestaña. En un sistema que maneja datos clínicos de menores, dejar
 * la sesión abierta indefinidamente en un equipo compartido —el aula, la sala
 * de profesores— es un riesgo que no compensa la comodidad.
 */
const CLAVE = "tesis.sesion";

/** @returns {string|null} */
export function leerToken() {
  try {
    return sessionStorage.getItem(CLAVE);
  } catch {
    return null; // modo privado o almacenamiento bloqueado
  }
}

/** @param {string} token */
export function guardarToken(token) {
  try {
    sessionStorage.setItem(CLAVE, token);
  } catch {
    /* sin almacenamiento: la sesión durará lo que dure la página */
  }
}

export function borrarToken() {
  try {
    sessionStorage.removeItem(CLAVE);
  } catch {
    /* nada que borrar */
  }
}

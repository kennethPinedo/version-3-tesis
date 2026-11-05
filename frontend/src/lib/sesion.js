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

/**
 * Última vista visitada, para que F5 no devuelva al usuario al inicio.
 *
 * Va en `sessionStorage` por el mismo motivo que el token: muere con la
 * pestaña. Quien lo lea debe comprobar que el rol activo puede ver esa vista;
 * aquí no se valida nada, es solo almacenamiento.
 */
const CLAVE_VISTA = "tesis.vista";

/** @returns {string|null} */
export function leerVista() {
  try {
    return sessionStorage.getItem(CLAVE_VISTA);
  } catch {
    return null;
  }
}

/** @param {string} vista */
export function guardarVista(vista) {
  try {
    sessionStorage.setItem(CLAVE_VISTA, vista);
  } catch {
    /* sin almacenamiento: al recargar se abrirá la vista inicial */
  }
}

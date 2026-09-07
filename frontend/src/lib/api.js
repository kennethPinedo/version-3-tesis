/**
 * Cliente HTTP del sistema. Centraliza la URL base, el parseo de errores de
 * FastAPI y la subida de archivos.
 *
 * @typedef {Object} ApiErrorShape
 * @property {number} status  Código HTTP.
 * @property {string} message Mensaje legible ya extraído de `detail`.
 */

export const API =
  (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000") + "/api";

/** Error de API con el status y el `detail` ya desempaquetado. */
export class ApiError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Extrae un mensaje legible del cuerpo de error de FastAPI, que puede ser
 * `{detail: "texto"}` o `{detail: [{loc, msg}, ...]}` (errores de Pydantic).
 * @param {Response} res
 * @returns {Promise<string>}
 */
async function mensajeDeError(res) {
  const texto = await res.text().catch(() => "");
  try {
    const data = JSON.parse(texto);
    const detail = data?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((d) => {
          const campo = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : "";
          return campo ? `${campo}: ${d.msg}` : d.msg;
        })
        .join(" · ");
    }
  } catch {
    /* el cuerpo no era JSON: se usa el texto crudo */
  }
  return texto || `Error ${res.status}`;
}

/**
 * Petición JSON.
 * @template T
 * @param {string} path Ruta relativa al prefijo /api (ej. "/alumnos/").
 * @param {RequestInit} [options]
 * @returns {Promise<T>}
 * @throws {ApiError}
 */
export async function req(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`, { cache: "no-store", ...options });
  } catch {
    throw new ApiError(
      "No se pudo conectar con el servidor. Verifica que el backend esté encendido.",
      0
    );
  }
  if (!res.ok) throw new ApiError(await mensajeDeError(res), res.status);
  if (res.status === 204) return /** @type {any} */ (null);
  return res.json();
}

/**
 * Petición JSON con cuerpo (POST/PUT/PATCH).
 * @template T
 * @param {string} path
 * @param {"POST"|"PUT"|"PATCH"|"DELETE"} method
 * @param {unknown} [body]
 * @returns {Promise<T>}
 */
export function reqJson(path, method, body) {
  return req(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * Sube un archivo por multipart/form-data.
 * @template T
 * @param {string} path
 * @param {File} file
 * @param {string} [campo] Nombre del campo esperado por el backend.
 * @returns {Promise<T>}
 */
export function uploadFile(path, file, campo = "archivo") {
  const fd = new FormData();
  fd.append(campo, file);
  // Sin Content-Type manual: el navegador añade el boundary del multipart.
  return req(path, { method: "POST", body: fd });
}

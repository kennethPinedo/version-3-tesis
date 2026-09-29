import React, { useCallback, useEffect, useState } from "react";
import { reqJson } from "../lib/api";
import { NAV_LABELS, VISTAS, viewsDeRol } from "../lib/rbac";

/**
 * Accesos y Seguridad. Solo Administrador (el backend lo vuelve a comprobar).
 *
 * Alternativa deliberada al alta y baja de usuarios: el centro tiene tres
 * cuentas fijas, una por rol, y un formulario de creación para eso serían
 * campos que nadie usa. Lo que sí hace falta a diario es lo de aquí:
 *   · atender a quien no puede entrar,
 *   · cerrar una sesión que quedó abierta en un aula,
 *   · poder responder qué ve cada rol, que es lo que pregunta un auditor.
 *
 * No hay envío de correos: exigiría un servicio externo de pago. El aviso es
 * presencial, que en un colegio es el canal que de verdad se usa.
 */

const ESTADO_ETIQUETA = {
  pendiente: { texto: "Pendiente", clase: "ac-estado--pend" },
  atendida:  { texto: "Atendida",  clase: "ac-estado--ok" },
  caducada:  { texto: "Caducada",  clase: "ac-estado--cad" },
};

const fecha = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

export default function AccesosView({ confirmar, notify, rolActual }) {
  const [cuentas, setCuentas] = useState([]);
  const [solicitudes, setSolicitudes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [atendiendo, setAtendiendo] = useState(null);   // id de la solicitud
  const [nueva, setNueva] = useState("");
  const [trabajando, setTrabajando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [a, r] = await Promise.all([
        reqJson("/auth/accesos"),
        reqJson("/auth/recuperaciones"),
      ]);
      setCuentas(a);
      setSolicitudes(r);
      setError("");
    } catch (e) {
      setError(e.message || "No se pudieron cargar los accesos.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const atender = async (solicitud) => {
    if (!nueva.trim()) {
      notify("Escribe la contraseña nueva antes de confirmar.", true);
      return;
    }
    const ok = await confirmar({
      titulo: "Restablecer contraseña",
      mensaje: `Se cambiará la contraseña de «${solicitud.usuario}» y se cerrarán sus sesiones abiertas. Tendrás que comunicársela en persona.`,
      tono: "aviso",
      textoConfirmar: "Sí, restablecer",
    });
    if (!ok) return;

    setTrabajando(true);
    try {
      const r = await reqJson(`/auth/recuperaciones/${solicitud.id}/atender`, "POST", {
        password_nueva: nueva,
      });
      notify(r.mensaje);
      setAtendiendo(null);
      setNueva("");
      cargar();
    } catch (e) {
      notify(e.message || "No se pudo restablecer.", true);
    } finally {
      setTrabajando(false);
    }
  };

  const cerrarSesiones = async (cuenta) => {
    const propia = cuenta.rol === rolActual;
    const ok = await confirmar({
      titulo: "Cerrar sesiones",
      mensaje: propia
        ? `Vas a cerrar las ${cuenta.sesiones_abiertas} sesión(es) de «${cuenta.usuario}», incluida la tuya: tendrás que volver a entrar.`
        : `Se cerrarán las ${cuenta.sesiones_abiertas} sesión(es) abiertas de «${cuenta.usuario}». Su contraseña no cambia.`,
      tono: propia ? "peligro" : "aviso",
      textoConfirmar: "Sí, cerrar",
    });
    if (!ok) return;

    try {
      const r = await reqJson(`/auth/accesos/${cuenta.id}/cerrar-sesiones`, "POST", {});
      notify(r.mensaje);
      cargar();
    } catch (e) {
      notify(e.message || "No se pudieron cerrar las sesiones.", true);
    }
  };

  if (cargando) return <div className="dashboard"><p className="muted">Cargando…</p></div>;
  if (error) return <div className="dashboard"><p className="alert-error" role="alert">{error}</p></div>;

  const pendientes = solicitudes.filter((s) => s.estado === "pendiente");

  return (
    <div className="dashboard">
      <h1 className="page-title">Accesos y Seguridad</h1>

      {/* Lo accionable va primero: si hay alguien esperando para entrar, eso
          es lo urgente, no el inventario de cuentas. */}
      <section className="mm-bloque">
        <h2>
          Solicitudes de recuperación
          {pendientes.length > 0 && <span className="ac-contador">{pendientes.length}</span>}
        </h2>

        {solicitudes.length === 0 ? (
          <p className="muted">Nadie ha pedido recuperar su acceso.</p>
        ) : (
          <table className="tabla">
            <thead>
              <tr>
                <th>Cuenta</th><th>Rol</th><th>Solicitado</th><th>Estado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {solicitudes.map((s) => {
                const e = ESTADO_ETIQUETA[s.estado] ?? { texto: s.estado, clase: "" };
                return (
                  <React.Fragment key={s.id}>
                    <tr>
                      <td><strong>{s.usuario}</strong><br /><span className="muted">{s.nombre}</span></td>
                      <td>{s.rol}</td>
                      <td>{fecha(s.fecha_solicitud)}</td>
                      <td><span className={`ac-estado ${e.clase}`}>{e.texto}</span></td>
                      <td>
                        {s.estado === "pendiente" && (
                          <button
                            type="button"
                            className="lista-btn"
                            onClick={() => { setAtendiendo(atendiendo === s.id ? null : s.id); setNueva(""); }}
                          >
                            {atendiendo === s.id ? "Cancelar" : "Restablecer"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {atendiendo === s.id && (
                      <tr>
                        <td colSpan={5}>
                          <div className="ac-form">
                            <label htmlFor={`pw-${s.id}`}>Contraseña nueva para {s.usuario}</label>
                            <input
                              id={`pw-${s.id}`}
                              type="text"
                              autoComplete="off"
                              value={nueva}
                              onChange={(ev) => setNueva(ev.target.value)}
                              placeholder="mínimo 8 caracteres"
                            />
                            {/* En texto visible a propósito: el administrador
                                tiene que leerla para dictarla, y ocultarla solo
                                provocaría que la escriba mal dos veces. */}
                            <p className="form-legend">
                              Se muestra en claro porque vas a comunicarla en persona.
                              No se envía por ningún medio.
                            </p>
                            <button type="button" onClick={() => atender(s)} disabled={trabajando}>
                              {trabajando ? "Aplicando…" : "Confirmar restablecimiento"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="mm-bloque">
        <h2>Cuentas del sistema</h2>
        <table className="tabla">
          <thead>
            <tr>
              <th>Cuenta</th><th>Rol</th><th>Último acceso</th><th>Sesiones abiertas</th><th></th>
            </tr>
          </thead>
          <tbody>
            {cuentas.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.usuario}</strong><br /><span className="muted">{c.nombre}</span></td>
                <td>{c.rol}</td>
                <td>{fecha(c.ultimo_acceso)}</td>
                <td>{c.sesiones_abiertas}</td>
                <td>
                  {c.sesiones_abiertas > 0 && (
                    <button type="button" className="lista-btn lista-btn--del" onClick={() => cerrarSesiones(c)}>
                      Cerrar sesiones
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* La matriz se deriva de rbac.js, no se escribe a mano: así no puede
          quedar desfasada respecto a lo que el sistema hace de verdad. */}
      <section className="mm-bloque">
        <h2>Qué ve cada rol</h2>
        <p className="mm-sub">
          Generado a partir de la configuración de permisos, no transcrito: si
          los permisos cambian, esta tabla cambia con ellos.
        </p>
        <div className="ac-matriz-wrap">
          <table className="tabla ac-matriz">
            <thead>
              <tr>
                <th>Pantalla</th>
                <th>Administrador</th><th>Psicólogo</th><th>Docente</th>
              </tr>
            </thead>
            <tbody>
              {VISTAS.map((v) => (
                <tr key={v}>
                  <td>{NAV_LABELS[v]?.label ?? v}</td>
                  {["Administrador", "Psicólogo", "Docente"].map((rol) => {
                    const puede = viewsDeRol(rol).includes(v);
                    return (
                      <td key={rol} className="ac-celda">
                        <span className={puede ? "ac-si" : "ac-no"} aria-label={puede ? "sí" : "no"}>
                          {puede ? "✓" : "—"}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mm-pie">
          Ocultar una opción del menú no impide llamar a la API. Cada endpoint
          comprueba el rol por su cuenta; esta tabla describe ambas capas.
        </p>
      </section>
    </div>
  );
}

import { useEffect, useRef } from "react";

/**
 * Diálogo de confirmación para acciones que modifican datos.
 *
 * Sustituye a `window.confirm`, que no respeta el tema de la aplicación, no
 * admite detalle alguno y en algunos navegadores se bloquea igual que un popup.
 *
 * Cumple el patrón «alertdialog» de WAI-ARIA: el foco entra al abrirse, queda
 * atrapado dentro mientras está abierto y vuelve al botón que lo disparó al
 * cerrarse (WCAG 2.4.3). Escape siempre cancela: la salida nunca destruye nada.
 *
 * En las acciones destructivas el foco inicial es «Cancelar», no «Confirmar»,
 * para que un Enter por inercia no borre un registro.
 */

const TONOS = {
  /** Borrados y acciones irreversibles. */
  peligro: {
    color: "var(--alto)",
    fondo: "var(--alto-suave)",
    icono: "⚠",
    confirmarPorDefecto: "Sí, eliminar",
  },
  /** Cambios que arrastran otros efectos (recálculos, cierre de sesiones). */
  aviso: {
    color: "var(--medio)",
    fondo: "var(--medio-suave)",
    icono: "!",
    confirmarPorDefecto: "Sí, continuar",
  },
  /** Altas y guardados corrientes. */
  normal: {
    color: "var(--marca-oscura)",
    fondo: "var(--marca-suave)",
    icono: "?",
    confirmarPorDefecto: "Sí, guardar",
  },
};

const FOCALIZABLES = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * @param {Object} props
 * @param {string} props.titulo                 Pregunta breve ("¿Eliminar a Ana Quispe?").
 * @param {string} [props.mensaje]              Qué consecuencia tiene aceptar.
 * @param {Array<{etiqueta: string, valor: string, antes?: string}>} [props.detalles]
 *        Resumen de lo que va a cambiar. Con `antes` se muestra «antes → después».
 * @param {"peligro"|"aviso"|"normal"} [props.tono]
 * @param {string} [props.textoConfirmar]
 * @param {string} [props.textoCancelar]
 * @param {(aceptado: boolean) => void} props.onResponder
 */
export default function DialogoConfirmacion({
  titulo,
  mensaje,
  detalles = [],
  tono = "normal",
  textoConfirmar,
  textoCancelar = "Cancelar",
  onResponder,
}) {
  const caja = useRef(null);
  const focoInicial = useRef(null);
  const focoPrevio = useRef(null);
  const t = TONOS[tono] ?? TONOS.normal;

  useEffect(() => {
    focoPrevio.current = document.activeElement;
    focoInicial.current?.focus();
    // El fondo no debe poder desplazarse mientras el diálogo está abierto.
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflowPrevio;
      // Devolver el foco al disparador: sin esto el lector de pantalla
      // reaparece al principio del documento.
      if (focoPrevio.current instanceof HTMLElement) focoPrevio.current.focus();
    };
  }, []);

  const alPulsarTecla = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onResponder(false);
      return;
    }
    if (e.key !== "Tab") return;
    const focos = caja.current?.querySelectorAll(FOCALIZABLES);
    if (!focos?.length) return;
    const primero = focos[0];
    const ultimo = focos[focos.length - 1];
    if (e.shiftKey && document.activeElement === primero) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  };

  const esPeligro = tono === "peligro";

  return (
    <div
      className="confirm-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onResponder(false); }}
    >
      <div
        ref={caja}
        className="confirm-caja"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-titulo"
        aria-describedby={mensaje ? "confirm-mensaje" : undefined}
        onKeyDown={alPulsarTecla}
      >
        <div className="confirm-cabecera">
          <span
            className="confirm-icono"
            style={{ background: t.fondo, color: t.color }}
            aria-hidden="true"
          >
            {t.icono}
          </span>
          <h2 id="confirm-titulo" className="confirm-titulo">{titulo}</h2>
        </div>

        {mensaje && (
          <p id="confirm-mensaje" className="confirm-mensaje">{mensaje}</p>
        )}

        {detalles.length > 0 && (
          <dl className="confirm-detalles">
            {detalles.map((d) => (
              <div key={d.etiqueta} className="confirm-detalle">
                <dt>{d.etiqueta}</dt>
                <dd>
                  {d.antes !== undefined && (
                    <>
                      <span className="confirm-antes">{d.antes}</span>
                      <span className="confirm-flecha" aria-label="cambia a"> → </span>
                    </>
                  )}
                  <span className={d.antes !== undefined ? "confirm-despues" : undefined}>
                    {d.valor}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        )}

        <div className="confirm-acciones">
          <button
            type="button"
            ref={esPeligro ? null : focoInicial}
            className={esPeligro ? "danger" : undefined}
            onClick={() => onResponder(true)}
          >
            {textoConfirmar ?? t.confirmarPorDefecto}
          </button>
          <button
            type="button"
            ref={esPeligro ? focoInicial : null}
            className="confirm-cancelar"
            onClick={() => onResponder(false)}
          >
            {textoCancelar}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useCallback, useRef, useState } from "react";
import DialogoConfirmacion from "../components/DialogoConfirmacion";

/**
 * Confirmación como promesa, para poder escribirla en línea dentro del
 * manejador que ya existe:
 *
 *   if (!await confirmar({ titulo: "¿Guardar?", tono: "normal" })) return;
 *
 * La alternativa habitual —un estado por cada acción y un modal por pantalla—
 * obliga a partir cada manejador en dos y multiplica el mismo modal por toda
 * la aplicación. Aquí hay un único diálogo y el manejador se lee de corrido.
 *
 * @returns {{confirmar: (opciones: Object) => Promise<boolean>, dialogo: JSX.Element|null}}
 */
export function useConfirmacion() {
  const [peticion, setPeticion] = useState(null);
  const resolver = useRef(null);

  const confirmar = useCallback((opciones) => new Promise((resolve) => {
    // Si ya había una confirmación abierta se cancela: nunca se apilan.
    resolver.current?.(false);
    resolver.current = resolve;
    setPeticion(opciones);
  }), []);

  const responder = useCallback((aceptado) => {
    setPeticion(null);
    const r = resolver.current;
    resolver.current = null;
    r?.(aceptado);
  }, []);

  const dialogo = peticion
    ? <DialogoConfirmacion {...peticion} onResponder={responder} />
    : null;

  return { confirmar, dialogo };
}

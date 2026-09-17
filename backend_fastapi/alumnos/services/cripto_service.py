"""Cifrado del documento de identidad.

El documento es a la vez dato sensible y clave única del estudiante, y esas dos
exigencias se contradicen: para cifrarlo bien hace falta que el mismo número
produzca un texto distinto cada vez (si no, comparar cifrados revela cuáles
coinciden), pero para garantizar que no se repita hace falta poder compararlos.

La solución son dos columnas:

  documento_cifrado  Fernet (AES-128-CBC + HMAC-SHA256). Reversible, con vector
                     de inicialización aleatorio: dos alumnos con documentos
                     distintos, o el mismo número guardado dos veces, producen
                     textos cifrados diferentes.
  documento_huella   HMAC-SHA256 del número con una pimienta del servidor.
                     Determinista, por lo que sirve de índice único y permite
                     buscar por documento, pero no es invertible: quien lea la
                     base no puede deducir el número a partir de la huella.

Las claves viven en variables de entorno, nunca en el repositorio. Si faltan,
el sistema las genera al arrancar y avisa por consola: es cómodo en desarrollo,
pero en producción hay que fijarlas o los datos dejarán de poder descifrarse en
el siguiente despliegue.
"""
import hashlib
import hmac
import os
import re

from cryptography.fernet import Fernet, InvalidToken

# ── Tipos de documento admitidos y su longitud exacta ─────────────────────
# Longitudes según los documentos peruanos vigentes (RENIEC y Migraciones).
TIPOS_DOCUMENTO = {
    "DNI": {
        "etiqueta": "DNI",
        "longitud": 8,
        "patron": r"^\d{8}$",
        "ayuda": "8 dígitos, sin puntos ni guiones.",
    },
    "CE": {
        "etiqueta": "Carné de Extranjería",
        "longitud": 9,
        "patron": r"^\d{9}$",
        "ayuda": "9 dígitos.",
    },
    "PASAPORTE": {
        "etiqueta": "Pasaporte",
        "longitud": 9,
        "patron": r"^[A-Z0-9]{9}$",
        "ayuda": "9 caracteres: letras mayúsculas y dígitos.",
    },
}


def _clave_fernet() -> Fernet:
    clave = os.getenv("DOCUMENTO_KEY")
    if not clave:
        clave = Fernet.generate_key().decode()
        os.environ["DOCUMENTO_KEY"] = clave
        print("[cripto] AVISO: DOCUMENTO_KEY no estaba definida. Se generó una "
              "temporal. Añádela al .env o los documentos guardados hoy no se "
              "podrán descifrar tras reiniciar:")
        print(f"         DOCUMENTO_KEY={clave}")
    return Fernet(clave.encode() if isinstance(clave, str) else clave)


def _pimienta() -> bytes:
    p = os.getenv("DOCUMENTO_PEPPER")
    if not p:
        p = hashlib.sha256(os.getenv("DOCUMENTO_KEY", "desarrollo").encode()).hexdigest()
        os.environ["DOCUMENTO_PEPPER"] = p
    return p.encode()


def normalizar(numero: str) -> str:
    """Quita espacios y guiones y pasa a mayúsculas antes de validar o cifrar."""
    return re.sub(r"[\s\-.]", "", (numero or "")).upper()


def validar(tipo: str, numero: str):
    """Devuelve (numero_normalizado, None) o (None, motivo_del_rechazo)."""
    spec = TIPOS_DOCUMENTO.get(tipo)
    if not spec:
        return None, f"Tipo de documento no válido. Usa: {', '.join(TIPOS_DOCUMENTO)}."

    limpio = normalizar(numero)
    if not limpio:
        return None, "El número de documento es obligatorio."
    if len(limpio) != spec["longitud"]:
        return None, (f"El {spec['etiqueta']} debe tener exactamente "
                      f"{spec['longitud']} caracteres. Recibido: {len(limpio)}.")
    if not re.match(spec["patron"], limpio):
        return None, f"Formato no válido para {spec['etiqueta']}. {spec['ayuda']}"
    return limpio, None


def cifrar(numero: str) -> str:
    return _clave_fernet().encrypt(numero.encode()).decode()


def descifrar(token: str) -> str:
    """Devuelve el número, o cadena vacía si el token no corresponde a la clave
    actual (por ejemplo, tras rotarla sin migrar los datos)."""
    if not token:
        return ""
    try:
        return _clave_fernet().decrypt(token.encode()).decode()
    except (InvalidToken, Exception):
        return ""


def huella(numero: str) -> str:
    """Huella determinista para el índice único. No es invertible."""
    return hmac.new(_pimienta(), numero.encode(), hashlib.sha256).hexdigest()


def enmascarar(numero: str) -> str:
    """«••••5678». Se muestra así en la interfaz: el dato completo solo se
    revela cuando el usuario lo pide expresamente."""
    if not numero:
        return "—"
    if len(numero) <= 4:
        return "•" * len(numero)
    return "•" * (len(numero) - 4) + numero[-4:]

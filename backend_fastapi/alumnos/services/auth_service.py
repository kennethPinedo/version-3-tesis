"""Servicio de autenticación.

Sin dependencias externas: el cifrado usa PBKDF2-HMAC-SHA256 de la biblioteca
estándar (recomendado por NIST SP 800-132) y los tokens se generan con
`secrets`, que emplea el generador criptográfico del sistema operativo.

Decisión de diseño: la recuperación de contraseña la atiende el administrador,
no un correo automático. El sistema gestiona cuentas institucionales asignadas,
no registros públicos, y así no hace falta configurar un servidor de correo ni
depender de un servicio externo para poder entrar.
"""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Header, HTTPException
from sqlalchemy.orm import Session

from alumnos.models import Usuario, Sesion, SolicitudRecuperacion

# Coste del derivado. 200 000 iteraciones es el orden que recomienda OWASP
# para PBKDF2-SHA256 y mantiene el login por debajo de ~100 ms.
ITERACIONES = 200_000
DURACION_SESION = timedelta(hours=8)        # jornada laboral
DURACION_SOLICITUD = timedelta(days=3)
LONGITUD_MINIMA = 8

ROLES_VALIDOS = ("Administrador", "Psicólogo", "Docente")


# ══ Contraseñas ═══════════════════════════════════════════════════════════
def hashear(password: str) -> str:
    """Devuelve "iteraciones$sal$hash". La sal es única por contraseña."""
    sal = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), sal, ITERACIONES)
    return f"{ITERACIONES}${sal.hex()}${dk.hex()}"


def verificar(password: str, almacenado: str) -> bool:
    """Comparación en tiempo constante: no filtra información por el tiempo."""
    try:
        iteraciones, sal_hex, hash_hex = almacenado.split("$")
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(sal_hex), int(iteraciones)
        )
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


def validar_fortaleza(password: str) -> Optional[str]:
    """Devuelve el motivo del rechazo, o None si la contraseña es aceptable."""
    if len(password) < LONGITUD_MINIMA:
        return f"La contraseña debe tener al menos {LONGITUD_MINIMA} caracteres."
    if password.isdigit() or password.isalpha():
        return "La contraseña debe combinar letras y números."
    if password.lower() in ("contrasena", "password", "12345678", "admin123"):
        return "Esa contraseña es demasiado común. Elige otra."
    return None


# ══ Sesiones ══════════════════════════════════════════════════════════════
def crear_sesion(db: Session, usuario: Usuario) -> Sesion:
    sesion = Sesion(
        usuario_id=usuario.id,
        token=secrets.token_urlsafe(32),
        expira=datetime.utcnow() + DURACION_SESION,
    )
    usuario.ultimo_acceso = datetime.utcnow()
    db.add(sesion)
    db.commit()
    db.refresh(sesion)
    return sesion


def cerrar_sesion(db: Session, token: str) -> None:
    db.query(Sesion).filter(Sesion.token == token).delete()
    db.commit()


def usuario_de_token(db: Session, token: Optional[str]) -> Optional[Usuario]:
    if not token:
        return None
    sesion = db.query(Sesion).filter(Sesion.token == token).first()
    if not sesion:
        return None
    if sesion.expira < datetime.utcnow():
        db.delete(sesion)
        db.commit()
        return None
    usuario = db.query(Usuario).filter(Usuario.id == sesion.usuario_id).first()
    return usuario if usuario and usuario.activo else None


def extraer_token(authorization: Optional[str]) -> Optional[str]:
    """Lee el token de la cabecera «Authorization: Bearer <token>»."""
    if not authorization:
        return None
    partes = authorization.split()
    if len(partes) == 2 and partes[0].lower() == "bearer":
        return partes[1]
    return None


# ══ Dependencias de FastAPI ═══════════════════════════════════════════════
def requerir_usuario(db: Session, authorization: Optional[str]) -> Usuario:
    usuario = usuario_de_token(db, extraer_token(authorization))
    if not usuario:
        raise HTTPException(status_code=401, detail="Sesión no válida o expirada. Vuelve a iniciar sesión.")
    return usuario


def requerir_administrador(db: Session, authorization: Optional[str]) -> Usuario:
    usuario = requerir_usuario(db, authorization)
    if usuario.rol != "Administrador":
        raise HTTPException(status_code=403, detail="Esta acción requiere el rol de Administrador.")
    return usuario


# ══ Recuperación ══════════════════════════════════════════════════════════


def sembrar_usuarios_iniciales(db: Session) -> int:
    """Crea las tres cuentas institucionales la primera vez.

    Son las credenciales de siempre y se entra con ellas directamente: no hay
    cambio obligatorio. La contrasena se guarda cifrada (PBKDF2), pero el flujo
    de acceso es el sencillo que el equipo ya conocia.
    """
    iniciales = [
        ("admin", "Administrador del sistema", "Administrador", "admin123"),
        ("psicologo", "Psicólogo institucional", "Psicólogo", "psico123"),
        ("docente", "Docente de aula", "Docente", "docente123"),
    ]
    creados = 0
    for usuario, nombre, rol, clave in iniciales:
        if db.query(Usuario).filter(Usuario.usuario == usuario).first():
            continue
        db.add(Usuario(
            usuario=usuario, nombre=nombre, rol=rol,
            password_hash=hashear(clave), activo=1, debe_cambiar=0,
        ))
        creados += 1
    if creados:
        db.commit()
    return creados

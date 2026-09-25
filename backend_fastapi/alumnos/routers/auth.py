"""Autenticación: ingreso, cambio de contraseña y recuperación asistida."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from alumnos.models import Usuario, SolicitudRecuperacion
from alumnos.services import auth_service as auth

router = APIRouter()


def sesion_requerida(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> Usuario:
    """Dependencia para proteger los routers de datos.

    Sin ella el inicio de sesión sería decorativo: cualquiera podría leer los
    expedientes llamando a la API directamente, sin pasar por la interfaz.
    """
    return auth.requerir_usuario(db, authorization)


# Mensaje único de acceso fallido. Se define aquí para que no pueda
# divergir entre los distintos puntos que lo devuelven.
CREDENCIALES_INVALIDAS = "Credenciales inválidas"


# ══ Esquemas ══════════════════════════════════════════════════════════════
class LoginIn(BaseModel):
    # Sin min_length: un campo vacío no debe producir el error en inglés de
    # Pydantic, sino el mismo «Credenciales inválidas» que el resto de fallos.
    usuario: str = Field(default="", max_length=50)
    password: str = Field(default="", max_length=128)


class CambioPasswordIn(BaseModel):
    password_actual: str = Field(min_length=1, max_length=128)
    password_nueva: str = Field(min_length=1, max_length=128)


def _usuario_dict(u: Usuario) -> dict:
    return {
        "id": u.id,
        "usuario": u.usuario,
        "nombre": u.nombre,
        "rol": u.rol,
        "debe_cambiar": bool(u.debe_cambiar),
        "ultimo_acceso": u.ultimo_acceso.isoformat() if u.ultimo_acceso else None,
    }


# ══ Ingreso ═══════════════════════════════════════════════════════════════
@router.post("/auth/login")
def login(data: LoginIn, db: Session = Depends(get_db)):
    nombre = data.usuario.strip().lower()

    # Un único mensaje para todos los fallos —campo vacío, usuario inexistente
    # o contraseña incorrecta—: distinguirlos permitiría averiguar qué cuentas
    # existen en el sistema probando nombres uno a uno.
    if not nombre or not data.password:
        raise HTTPException(status_code=401, detail=CREDENCIALES_INVALIDAS)

    usuario = db.query(Usuario).filter(Usuario.usuario == nombre).first()
    if not usuario or not auth.verificar(data.password, usuario.password_hash):
        raise HTTPException(status_code=401, detail=CREDENCIALES_INVALIDAS)
    if not usuario.activo:
        raise HTTPException(status_code=403, detail="Esta cuenta está desactivada. Consulta con el administrador.")

    sesion = auth.crear_sesion(db, usuario)
    return {
        "token": sesion.token,
        "expira": sesion.expira.isoformat(),
        "usuario": _usuario_dict(usuario),
    }


@router.post("/auth/logout")
def logout(authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    token = auth.extraer_token(authorization)
    if token:
        auth.cerrar_sesion(db, token)
    return {"mensaje": "Sesión cerrada."}


@router.get("/auth/yo")
def yo(authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    """Permite al frontend restaurar la sesión tras recargar la página."""
    return _usuario_dict(auth.requerir_usuario(db, authorization))


# ══ Cambio de contraseña ══════════════════════════════════════════════════
@router.post("/auth/cambiar-password")
def cambiar_password(
    data: CambioPasswordIn,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    usuario = auth.requerir_usuario(db, authorization)

    if not auth.verificar(data.password_actual, usuario.password_hash):
        raise HTTPException(status_code=400, detail="La contraseña actual no es correcta.")
    if data.password_actual == data.password_nueva:
        raise HTTPException(status_code=400, detail="La contraseña nueva debe ser distinta de la actual.")

    motivo = auth.validar_fortaleza(data.password_nueva)
    if motivo:
        raise HTTPException(status_code=400, detail=motivo)

    usuario.password_hash = auth.hashear(data.password_nueva)
    usuario.debe_cambiar = 0
    db.commit()
    return {"mensaje": "Contraseña actualizada.", "usuario": _usuario_dict(usuario)}

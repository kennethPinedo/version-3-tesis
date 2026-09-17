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


# ══ Esquemas ══════════════════════════════════════════════════════════════
class LoginIn(BaseModel):
    usuario: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=128)


class CambioPasswordIn(BaseModel):
    password_actual: str = Field(min_length=1, max_length=128)
    password_nueva: str = Field(min_length=1, max_length=128)


class SolicitudIn(BaseModel):
    usuario: str = Field(min_length=1, max_length=50)


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
    usuario = db.query(Usuario).filter(Usuario.usuario == data.usuario.strip().lower()).first()

    # Un único mensaje para usuario inexistente y contraseña incorrecta: revelar
    # cuál de los dos falló permitiría enumerar las cuentas del sistema.
    if not usuario or not auth.verificar(data.password, usuario.password_hash):
        raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos.")
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


# ══ Recuperación asistida ═════════════════════════════════════════════════
@router.post("/auth/recuperacion/solicitar")
def solicitar_recuperacion(data: SolicitudIn, db: Session = Depends(get_db)):
    """Registra la petición y devuelve el código de referencia.

    La respuesta es idéntica exista o no la cuenta, para no revelar qué usuarios
    están dados de alta. Solo se crea la solicitud si el usuario es real.
    """
    nombre = data.usuario.strip().lower()
    usuario = db.query(Usuario).filter(Usuario.usuario == nombre).first()

    codigo = None
    if usuario and usuario.activo:
        codigo = auth.crear_solicitud(db, usuario).codigo

    return {
        "mensaje": (
            "Si la cuenta existe, tu solicitud quedó registrada. Comunica el código de "
            "referencia al administrador del sistema para que reponga tu contraseña."
        ),
        # El código solo viaja cuando la cuenta es real; si no, es null y el
        # mensaje sigue siendo el mismo.
        "codigo": codigo,
        "vigencia_dias": auth.DURACION_SOLICITUD.days,
    }


@router.get("/auth/recuperacion/pendientes")
def listar_pendientes(authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    """Bandeja del administrador con las solicitudes por atender."""
    auth.requerir_administrador(db, authorization)

    ahora = datetime.utcnow()
    filas = (
        db.query(SolicitudRecuperacion, Usuario)
        .join(Usuario, Usuario.id == SolicitudRecuperacion.usuario_id)
        .filter(SolicitudRecuperacion.estado == "pendiente")
        .order_by(SolicitudRecuperacion.fecha_solicitud.desc())
        .all()
    )
    return [
        {
            "id": s.id,
            "codigo": s.codigo,
            "usuario": u.usuario,
            "nombre": u.nombre,
            "rol": u.rol,
            "fecha_solicitud": s.fecha_solicitud.isoformat() if s.fecha_solicitud else None,
            "caducada": s.expira < ahora,
        }
        for s, u in filas
    ]


@router.post("/auth/recuperacion/{solicitud_id}/atender")
def atender_recuperacion(
    solicitud_id: int,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    """Repone la contraseña y devuelve una temporal, visible UNA sola vez.

    No se almacena en claro: se entrega en esta respuesta y se guarda su hash.
    El usuario queda obligado a cambiarla en su próximo ingreso.
    """
    auth.requerir_administrador(db, authorization)

    solicitud = db.query(SolicitudRecuperacion).filter(SolicitudRecuperacion.id == solicitud_id).first()
    if not solicitud:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada.")
    if solicitud.estado != "pendiente":
        raise HTTPException(status_code=400, detail="Esta solicitud ya fue atendida.")
    if solicitud.expira < datetime.utcnow():
        solicitud.estado = "caducada"
        db.commit()
        raise HTTPException(status_code=400, detail="La solicitud caducó. Pide al usuario que la genere de nuevo.")

    usuario = db.query(Usuario).filter(Usuario.id == solicitud.usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="La cuenta asociada ya no existe.")

    temporal = auth.generar_password_temporal()
    usuario.password_hash = auth.hashear(temporal)
    usuario.debe_cambiar = 1

    solicitud.estado = "atendida"
    solicitud.fecha_atencion = datetime.utcnow()

    # Al reponer la contraseña se cierran las sesiones abiertas de esa cuenta.
    from alumnos.models import Sesion
    db.query(Sesion).filter(Sesion.usuario_id == usuario.id).delete()
    db.commit()

    return {
        "mensaje": f"Contraseña repuesta para «{usuario.usuario}».",
        "usuario": usuario.usuario,
        "password_temporal": temporal,
        "aviso": "Entrégasela en persona. No vuelve a mostrarse y el usuario deberá cambiarla al ingresar.",
    }

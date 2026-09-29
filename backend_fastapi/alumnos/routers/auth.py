"""Autenticación: ingreso, cambio de contraseña y recuperación asistida."""
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from alumnos.models import Sesion, Usuario, SolicitudRecuperacion
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


# ══ Recuperación de contraseña ════════════════════════════════════════════
# Diseño deliberadamente sin correo electrónico: enviar mensajes exige un
# servicio externo (SendGrid, SES) que cuesta dinero y añade un punto de fallo.
# En un colegio, docente y administrador comparten edificio: el canal de aviso
# es presencial y basta con que el sistema deje constancia de la petición.
#
# Tampoco se generan contraseñas temporales. El administrador escribe la nueva
# y la comunica en persona; así no hay una credencial válida viajando por
# ningún sitio ni caducando sin que nadie se entere.

class RecuperacionIn(BaseModel):
    usuario: str = Field(default="", max_length=50)


class AtenderRecuperacionIn(BaseModel):
    password_nueva: str = Field(min_length=1, max_length=128)


# Ventana en la que la petición sigue siendo atendible.
HORAS_VIGENCIA_SOLICITUD = 72

MENSAJE_SOLICITUD = (
    "Si la cuenta existe, tu solicitud quedó registrada. "
    "Acércate al administrador del sistema para que restablezca tu acceso."
)


@router.post("/auth/recuperar")
def solicitar_recuperacion(data: RecuperacionIn, db: Session = Depends(get_db)):
    """Registra que alguien no puede entrar. No confirma si la cuenta existe.

    La respuesta es idéntica exista o no el usuario: decir «ese usuario no
    existe» permitiría averiguar qué cuentas hay probando nombres, el mismo
    motivo por el que el login tiene un único mensaje de error.
    """
    nombre = data.usuario.strip().lower()
    if not nombre:
        return {"mensaje": MENSAJE_SOLICITUD}

    usuario = db.query(Usuario).filter(Usuario.usuario == nombre).first()
    if usuario:
        # Una sola petición viva por cuenta: si insiste, se renueva la vigencia
        # en lugar de acumular filas que el administrador tendría que cribar.
        pendiente = (
            db.query(SolicitudRecuperacion)
            .filter(
                SolicitudRecuperacion.usuario_id == usuario.id,
                SolicitudRecuperacion.estado == "pendiente",
            )
            .first()
        )
        ahora = datetime.utcnow()
        vence = ahora + timedelta(hours=HORAS_VIGENCIA_SOLICITUD)
        if pendiente:
            pendiente.fecha_solicitud = ahora
            pendiente.expira = vence
        else:
            db.add(
                SolicitudRecuperacion(
                    usuario_id=usuario.id,
                    codigo=secrets.token_hex(8),
                    estado="pendiente",
                    fecha_solicitud=ahora,
                    expira=vence,
                )
            )
        db.commit()

    return {"mensaje": MENSAJE_SOLICITUD}


def _solo_administrador(usuario: Usuario) -> Usuario:
    if usuario.rol != "Administrador":
        raise HTTPException(
            status_code=403,
            detail="Solo un administrador puede gestionar los accesos.",
        )
    return usuario


@router.get("/auth/recuperaciones")
def listar_recuperaciones(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    """Peticiones de recuperación, para la bandeja del administrador."""
    _solo_administrador(auth.requerir_usuario(db, authorization))

    ahora = datetime.utcnow()
    # Las vencidas se marcan al leerlas: evita una tarea programada solo para
    # esto y garantiza que la bandeja nunca muestre algo ya inatendible.
    vencidas = (
        db.query(SolicitudRecuperacion)
        .filter(
            SolicitudRecuperacion.estado == "pendiente",
            SolicitudRecuperacion.expira < ahora,
        )
        .all()
    )
    for s in vencidas:
        s.estado = "caducada"
    if vencidas:
        db.commit()

    filas = (
        db.query(SolicitudRecuperacion, Usuario)
        .join(Usuario, Usuario.id == SolicitudRecuperacion.usuario_id)
        .order_by(SolicitudRecuperacion.fecha_solicitud.desc())
        .limit(50)
        .all()
    )
    return [
        {
            "id": s.id,
            "usuario": u.usuario,
            "nombre": u.nombre,
            "rol": u.rol,
            "estado": s.estado,
            "fecha_solicitud": s.fecha_solicitud.isoformat() if s.fecha_solicitud else None,
            "expira": s.expira.isoformat() if s.expira else None,
            "fecha_atencion": s.fecha_atencion.isoformat() if s.fecha_atencion else None,
        }
        for s, u in filas
    ]


@router.post("/auth/recuperaciones/{solicitud_id}/atender")
def atender_recuperacion(
    solicitud_id: int,
    data: AtenderRecuperacionIn,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    """El administrador fija la contraseña nueva y cierra la petición."""
    _solo_administrador(auth.requerir_usuario(db, authorization))

    solicitud = db.query(SolicitudRecuperacion).filter(
        SolicitudRecuperacion.id == solicitud_id
    ).first()
    if not solicitud:
        raise HTTPException(status_code=404, detail="Esa solicitud no existe.")
    if solicitud.estado != "pendiente":
        raise HTTPException(
            status_code=409,
            detail=f"Esa solicitud ya está {solicitud.estado}.",
        )

    usuario = db.query(Usuario).filter(Usuario.id == solicitud.usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="La cuenta ya no existe.")

    motivo = auth.validar_fortaleza(data.password_nueva)
    if motivo:
        raise HTTPException(status_code=400, detail=motivo)

    usuario.password_hash = auth.hashear(data.password_nueva)
    solicitud.estado = "atendida"
    solicitud.fecha_atencion = datetime.utcnow()

    # Se cierran las sesiones abiertas: si alguien pidió recuperar el acceso,
    # cabe la posibilidad de que otro lo tuviera.
    db.query(Sesion).filter(Sesion.usuario_id == usuario.id).delete()
    db.commit()

    return {
        "mensaje": f"Contraseña de {usuario.usuario} restablecida. "
                   "Comunícasela en persona; no se envía por ningún medio.",
        "usuario": _usuario_dict(usuario),
    }


# ══ Administración de accesos ═════════════════════════════════════════════
@router.get("/auth/accesos")
def listar_accesos(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    """Estado de las cuentas y sus sesiones abiertas."""
    _solo_administrador(auth.requerir_usuario(db, authorization))

    ahora = datetime.utcnow()
    usuarios = db.query(Usuario).order_by(Usuario.id).all()
    return [
        {
            "id": u.id,
            "usuario": u.usuario,
            "nombre": u.nombre,
            "rol": u.rol,
            "activo": bool(u.activo),
            "ultimo_acceso": u.ultimo_acceso.isoformat() if u.ultimo_acceso else None,
            "sesiones_abiertas": db.query(Sesion)
            .filter(Sesion.usuario_id == u.id, Sesion.expira > ahora)
            .count(),
        }
        for u in usuarios
    ]


@router.post("/auth/accesos/{usuario_id}/cerrar-sesiones")
def cerrar_sesiones(
    usuario_id: int,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    """Revoca todas las sesiones de una cuenta, sin cambiar su contraseña."""
    admin = _solo_administrador(auth.requerir_usuario(db, authorization))

    usuario = db.query(Usuario).filter(Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Esa cuenta no existe.")

    n = db.query(Sesion).filter(Sesion.usuario_id == usuario_id).delete()
    db.commit()
    aviso = " Cerraste también la tuya: tendrás que volver a entrar." if admin.id == usuario_id else ""
    return {
        "mensaje": f"Se cerraron {n} sesión(es) de {usuario.usuario}.{aviso}",
        "cerradas": n,
    }


# ══ Credenciales que se muestran en la pantalla de acceso ═════════════════
@router.get("/auth/cuentas-demo")
def cuentas_demo(db: Session = Depends(get_db)):
    """Cuentas que todavía conservan su contraseña inicial.

    La pantalla de acceso mostraba esta lista escrita a mano en el frontend, y
    se desincronizó: anunciaba «psicologo / psico123» cuando esa cuenta tenía
    otra contraseña, así que la pista era falsa justo para quien la necesitaba.

    Aquí se comprueba cada cuenta contra su contraseña documentada y solo se
    devuelven las que coinciden. Eso hace dos cosas a la vez:

      · La pantalla no puede volver a mentir: si una contraseña cambia, esa
        cuenta desaparece de la lista en lugar de seguir anunciando la vieja.
      · No se revela nada nuevo. Estas credenciales ya estaban impresas en la
        pantalla de acceso; lo que cambia es que ahora desaparecen en cuanto
        dejan de ser las de por defecto, que es cuando revelarlas importaría.

    Sin sesión a propósito: se consulta antes de poder iniciarla.
    """
    visibles = []
    for usuario, _nombre, rol, clave in auth.CUENTAS_INICIALES:
        u = db.query(Usuario).filter(Usuario.usuario == usuario).first()
        if not u or not u.activo:
            continue
        # Solo si sigue siendo la inicial. Si alguien la cambió, la pista deja
        # de mostrarse en lugar de quedarse obsoleta.
        if auth.verificar(clave, u.password_hash):
            visibles.append({"usuario": u.usuario, "rol": u.rol, "password": clave})

    return {
        "cuentas": visibles,
        "total_cuentas": db.query(Usuario).filter(Usuario.activo == 1).count(),
    }

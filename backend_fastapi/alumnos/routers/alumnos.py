import re
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from database import get_db
from alumnos.models import (
    Alumno, Asistencia, Encuesta, ExpedientePsicologico, HistorialInasistencias,
    Nota, PrediccionAcademica, Usuario,
)
from alumnos.services import generar_prediccion_alumno
from alumnos.services import auth_service as auth
from alumnos.services import cripto_service as cripto


def _usuario_opcional(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> Optional[Usuario]:
    """Quien esta llamando, si se puede saber.

    El router ya esta protegido a nivel de aplicacion, asi que aqui no hace
    falta volver a exigir sesion: solo se quiere el nombre para dejarlo en el
    historial. Si no se puede resolver, se anota como desconocido en lugar de
    rechazar una operacion que por lo demas es valida.
    """
    try:
        return auth.usuario_de_token(db, auth.extraer_token(authorization))
    except Exception:
        return None

router = APIRouter()

# Tope defensivo: un año escolar peruano tiene ~190 días lectivos.
MAX_INASISTENCIAS = 365

# El colegio solo matricula en el tramo de transición entre primaria y
# secundaria, que es donde se aplica el instrumento EDAH.
NIVELES = {"Primaria": [6], "Secundaria": [1]}   # nivel -> grados admitidos

# Nombres: letras (con tildes y ñ), dígitos, espacios, apóstrofo y guion.
# Lo que se persigue son los caracteres especiales —etiquetas HTML, comillas,
# símbolos—, no los números: los registros de la institución usan nombres como
# «Alumno 01», y un apellido puede llevar un ordinal («Juan Pablo 2»).
_RE_NOMBRE = re.compile(r"^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9'\- ]*$")
# Contacto: admite teléfonos y también un nombre con teléfono.
_RE_CONTACTO = re.compile(r"^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 +().,\-']+$")


def _limpiar(texto: str) -> str:
    """Recorta y colapsa espacios repetidos."""
    return re.sub(r"\s{2,}", " ", (texto or "").strip())


class AlumnoCreate(BaseModel):
    """Alta y edición de alumno.

    `condicion_social` fue retirada por depuración de datos sensibles: ya no se
    recibe ni se expone (la columna sigue en la BD solo como legado).
    """
    nombre: str = Field(min_length=2, max_length=100)
    apellido: str = Field(min_length=2, max_length=100)
    # El instrumento se aplica en el tramo 6.o de primaria - 1.o de secundaria,
    # cuyas edades tipicas son 11 y 12 anios.
    edad: int = Field(ge=11, le=12)
    nivel: str = Field(default="Secundaria")
    grado: int = Field(ge=1, le=6, description="Número de grado dentro del nivel")
    anio_cursada: int = Field(default=2024, ge=2000, le=2100)
    contacto_emergente: str = Field(min_length=3, max_length=100)
    genero: str = "No especificado"
    tipo_documento: str = Field(default="DNI")
    numero_documento: str = Field(min_length=1, max_length=20)

    @field_validator("nombre", "apellido")
    @classmethod
    def _sin_caracteres_raros(cls, v: str) -> str:
        limpio = _limpiar(v)
        if not _RE_NOMBRE.match(limpio):
            raise ValueError(
                "Solo se admiten letras, números, espacios, apóstrofo y guion. "
                "No uses signos ni símbolos."
            )
        return limpio

    @field_validator("contacto_emergente")
    @classmethod
    def _contacto_valido(cls, v: str) -> str:
        limpio = _limpiar(v)
        if not _RE_CONTACTO.match(limpio):
            raise ValueError("El contacto contiene caracteres no permitidos.")
        return limpio

    @field_validator("genero")
    @classmethod
    def _genero_valido(cls, v: str) -> str:
        limpio = _limpiar(v)
        if limpio not in ("Masculino", "Femenino", "Otro", "No especificado"):
            raise ValueError("Género no válido.")
        return limpio

    @field_validator("nivel")
    @classmethod
    def _nivel_valido(cls, v: str) -> str:
        if v not in NIVELES:
            raise ValueError(f"El nivel debe ser {' o '.join(NIVELES)}.")
        return v

    @field_validator("tipo_documento")
    @classmethod
    def _tipo_valido(cls, v: str) -> str:
        if v not in cripto.TIPOS_DOCUMENTO:
            raise ValueError(f"Tipo de documento no válido: {', '.join(cripto.TIPOS_DOCUMENTO)}.")
        return v

    def validar_cruzado(self) -> Optional[str]:
        """Comprobaciones que dependen de más de un campo."""
        admitidos = NIVELES[self.nivel]
        if self.grado not in admitidos:
            grados = " o ".join(f"{g}°" for g in admitidos)
            return f"En {self.nivel} solo se admite {grados} grado."
        _, motivo = cripto.validar(self.tipo_documento, self.numero_documento)
        return motivo


class InasistenciasUpdate(BaseModel):
    """Módulo Control de Inasistencias (rol Docente)."""
    inasistencias: int = Field(ge=0, le=MAX_INASISTENCIAS)


def _alumno_dict(a: Alumno) -> dict:
    """El documento sale SIEMPRE enmascarado. El número completo se obtiene
    con GET /alumnos/{id}/documento, en una llamada aparte y deliberada."""
    numero = cripto.descifrar(a.documento_cifrado) if a.documento_cifrado else ""
    return {
        "id": a.id,
        "nombre": a.nombre,
        "apellido": a.apellido,
        "edad": a.edad,
        "grado": a.grado,
        "nivel": getattr(a, "nivel", None) or "Secundaria",
        "anio_cursada": a.anio_cursada,
        "contacto_emergente": a.contacto_emergente,
        "genero": a.genero,
        "inasistencias": int(getattr(a, "inasistencias", 0) or 0),
        "tipo_documento": a.tipo_documento,
        "documento_enmascarado": cripto.enmascarar(numero) if numero else "—",
    }


def _get_alumno(db: Session, alumno_id: int) -> Alumno:
    a = db.query(Alumno).filter(Alumno.id == alumno_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Alumno no encontrado.")
    return a


def _aplicar_documento(db: Session, alumno: Alumno, data: AlumnoCreate) -> None:
    """Cifra el documento y comprueba que no pertenezca ya a otro estudiante."""
    numero, motivo = cripto.validar(data.tipo_documento, data.numero_documento)
    if motivo:
        raise HTTPException(status_code=400, detail=motivo)

    huella = cripto.huella(numero)
    duplicado = (
        db.query(Alumno)
        .filter(Alumno.documento_huella == huella, Alumno.id != (alumno.id or -1))
        .first()
    )
    if duplicado:
        raise HTTPException(
            status_code=409,
            detail=(f"Ese documento ya está registrado a nombre de "
                    f"{duplicado.nombre} {duplicado.apellido}."),
        )

    alumno.tipo_documento = data.tipo_documento
    alumno.documento_cifrado = cripto.cifrar(numero)
    alumno.documento_huella = huella


@router.get("/documentos/tipos")
def tipos_documento():
    """Catálogo para que el formulario conozca longitudes y formatos."""
    return [
        {"valor": k, "etiqueta": v["etiqueta"], "longitud": v["longitud"], "ayuda": v["ayuda"]}
        for k, v in cripto.TIPOS_DOCUMENTO.items()
    ]


@router.get("/niveles")
def niveles():
    return [{"nivel": n, "grados": list(range(1, tope + 1))} for n, tope in NIVELES.items()]


@router.get("/alumnos/")
def list_alumnos(db: Session = Depends(get_db)):
    return [_alumno_dict(a) for a in db.query(Alumno).order_by(Alumno.id).all()]


@router.post("/alumnos/", status_code=201)
def create_alumno(data: AlumnoCreate, db: Session = Depends(get_db)):
    motivo = data.validar_cruzado()
    if motivo:
        raise HTTPException(status_code=400, detail=motivo)

    a = Alumno(
        nombre=data.nombre, apellido=data.apellido, edad=data.edad,
        nivel=data.nivel, grado=f"{data.grado}° de {data.nivel}",
        anio_cursada=data.anio_cursada,
        contacto_emergente=data.contacto_emergente, genero=data.genero,
    )
    _aplicar_documento(db, a, data)
    db.add(a)
    db.commit()
    db.refresh(a)
    return _alumno_dict(a)


@router.get("/alumnos/{alumno_id}/")
def get_alumno(alumno_id: int, db: Session = Depends(get_db)):
    return _alumno_dict(_get_alumno(db, alumno_id))


@router.get("/alumnos/{alumno_id}/documento")
def ver_documento(alumno_id: int, db: Session = Depends(get_db)):
    """Revela el número completo. Se pide expresamente, nunca viaja en el listado."""
    a = _get_alumno(db, alumno_id)
    numero = cripto.descifrar(a.documento_cifrado) if a.documento_cifrado else ""
    if not numero:
        raise HTTPException(
            status_code=404,
            detail=("Este estudiante no tiene documento registrado, o se guardó con "
                    "una clave de cifrado distinta a la actual."),
        )
    return {"tipo": a.tipo_documento, "numero": numero}


@router.put("/alumnos/{alumno_id}/")
def update_alumno(alumno_id: int, data: AlumnoCreate, db: Session = Depends(get_db)):
    motivo = data.validar_cruzado()
    if motivo:
        raise HTTPException(status_code=400, detail=motivo)

    a = _get_alumno(db, alumno_id)
    a.nombre = data.nombre
    a.apellido = data.apellido
    a.edad = data.edad
    a.nivel = data.nivel
    a.grado = f"{data.grado}° de {data.nivel}"
    a.anio_cursada = data.anio_cursada
    a.contacto_emergente = data.contacto_emergente
    a.genero = data.genero
    _aplicar_documento(db, a, data)

    db.commit()
    db.refresh(a)
    return _alumno_dict(a)


@router.put("/alumnos/{alumno_id}/inasistencias")
def update_inasistencias(
    alumno_id: int,
    data: InasistenciasUpdate,
    db: Session = Depends(get_db),
    usuario: Optional[Usuario] = Depends(_usuario_opcional),
):
    """Persiste las inasistencias acumuladas y actualiza el vector predictivo.

    Las inasistencias son una de las tres variables del MODELO 2
    (Promedio, Inasistencias, Prob_TDAH), así que al cambiarlas la predicción
    vigente queda obsoleta y se regenera aquí mismo. Si el alumno todavía no
    tiene encuesta EDAH no es un error: el valor se guarda y la predicción se
    generará cuando exista la encuesta.
    """
    a = _get_alumno(db, alumno_id)
    anterior = int(getattr(a, "inasistencias", 0) or 0)
    a.inasistencias = data.inasistencias

    # Queda constancia del cambio. Sin esto solo se conserva el ultimo numero y
    # no hay forma de distinguir una correccion de captura de un empeoramiento
    # real del estudiante, ni de saber quien lo registro.
    if anterior != data.inasistencias:
        db.add(HistorialInasistencias(
            alumno_id=alumno_id,
            valor_anterior=anterior,
            valor_nuevo=data.inasistencias,
            anio_lectivo=getattr(a, "anio_cursada", None),
            registrado_por=getattr(usuario, "usuario", None) if usuario else None,
        ))

    db.commit()
    db.refresh(a)

    prediccion_actualizada = False
    detalle: Optional[str] = None
    try:
        generar_prediccion_alumno(db, alumno_id)
        prediccion_actualizada = True
    except HTTPException as exc:
        detalle = str(exc.detail)

    return {
        "alumno": _alumno_dict(a),
        "prediccion_actualizada": prediccion_actualizada,
        "detalle": detalle,
        "mensaje": (
            f"Inasistencias actualizadas a {data.inasistencias} día(s)."
            + (" Predicción recalculada." if prediccion_actualizada else "")
        ),
    }


@router.get("/alumnos/{alumno_id}/inasistencias/historial")
def historial_inasistencias(alumno_id: int, db: Session = Depends(get_db)):
    """Cambios registrados en el contador de inasistencias de un estudiante.

    Responde a lo que el numero suelto no puede: cuando subio, cuanto subio de
    una vez y quien lo anoto. Un salto de 4 a 40 dias en una sola anotacion se
    parece mas a un error de captura que a un mes de ausencias, y el modelo de
    riesgo usa ese dato.
    """
    a = _get_alumno(db, alumno_id)
    filas = (
        db.query(HistorialInasistencias)
        .filter(HistorialInasistencias.alumno_id == alumno_id)
        .order_by(HistorialInasistencias.fecha.desc(), HistorialInasistencias.id.desc())
        .limit(100)
        .all()
    )
    return {
        "alumno": alumno_id,
        "valor_actual": int(getattr(a, "inasistencias", 0) or 0),
        "anio_lectivo": getattr(a, "anio_cursada", None),
        # El tope es del ano lectivo completo: decirlo evita que «45» se lea
        # como un porcentaje o como dias de un bimestre.
        "maximo_admitido": MAX_INASISTENCIAS,
        "movimientos": [
            {
                "id": h.id,
                "valor_anterior": h.valor_anterior,
                "valor_nuevo": h.valor_nuevo,
                "diferencia": h.valor_nuevo - h.valor_anterior,
                "anio_lectivo": h.anio_lectivo,
                "registrado_por": h.registrado_por or "No consta",
                "fecha": h.fecha.isoformat() if h.fecha else None,
            }
            for h in filas
        ],
    }


@router.delete("/alumnos/{alumno_id}/", status_code=204)
def delete_alumno(alumno_id: int, db: Session = Depends(get_db)):
    """Elimina un alumno, siempre que no tenga historial.

    Un alumno con notas, encuestas, predicciones o expediente NO se puede
    borrar: esos registros son el corpus con el que se entrenaron y validaron
    los modelos, y no hay forma de recuperarlos. Quien quiera eliminarlo debe
    retirar antes ese historial, deliberadamente.

    La base de datos ya lo impide por integridad referencial, pero por sí sola
    devolvería un error crudo (HTTP 500). Aquí se comprueba primero para poder
    responder un 409 que diga exactamente qué lo está bloqueando.
    """
    a = _get_alumno(db, alumno_id)

    dependencias = [
        ("nota", "notas", db.query(Nota).filter(Nota.alumno_id == alumno_id).count()),
        ("encuesta", "encuestas", db.query(Encuesta).filter(Encuesta.alumno_id == alumno_id).count()),
        ("predicción", "predicciones",
         db.query(PrediccionAcademica).filter(PrediccionAcademica.alumno_id == alumno_id).count()),
        ("expediente", "expedientes",
         db.query(ExpedientePsicologico).filter(ExpedientePsicologico.alumno_id == alumno_id).count()),
    ]
    bloqueos = [(sing, plur, n) for sing, plur, n in dependencias if n]

    if bloqueos:
        detalle = ", ".join(f"{n} {sing if n == 1 else plur}" for sing, plur, n in bloqueos)
        raise HTTPException(
            status_code=409,
            detail=(f"No se puede eliminar a {a.nombre} {a.apellido}: tiene {detalle} "
                    f"en su historial. Retira primero esos registros si de verdad "
                    f"quieres darlo de baja."),
        )

    db.delete(a)
    db.commit()


# ══ Asistencia por fecha ══════════════════════════════════════════════════
# Sustituye al contador agregado. «N dias» no permitia saber si las faltas
# estaban repartidas o concentradas en una semana, y eso significa cosas muy
# distintas para un tutor.

ESTADOS_ASISTENCIA = ("Asistió", "No asistió")


class AsistenciaIn(BaseModel):
    fecha: date
    estado: str

    @field_validator("estado")
    @classmethod
    def _estado_valido(cls, v: str) -> str:
        limpio = _limpiar(v)
        if limpio not in ESTADOS_ASISTENCIA:
            raise ValueError(f"El estado debe ser {' o '.join(ESTADOS_ASISTENCIA)}.")
        return limpio

    @field_validator("fecha")
    @classmethod
    def _fecha_valida(cls, v: date) -> date:
        # Sabado=5, domingo=6. No hay clase, así que registrar una falta esos
        # días solo puede ser un error de quien la anota.
        if v.weekday() >= 5:
            dia = "sábado" if v.weekday() == 5 else "domingo"
            raise ValueError(f"El {dia} no es día lectivo: no se registra asistencia.")
        if v > date.today():
            raise ValueError("No se puede registrar la asistencia de un día que aún no ha ocurrido.")
        return v


def _recalcular_inasistencias(db: Session, alumno_id: int) -> int:
    """Deja Alumno.inasistencias al día y devuelve el total.

    El total es el que consume el modelo de riesgo, así que no puede quedar
    desincronizado de los registros: se recalcula entero en lugar de sumar o
    restar uno, que es donde aparecen los descuadres.
    """
    a = _get_alumno(db, alumno_id)
    con_fecha = (
        db.query(Asistencia)
        .filter(Asistencia.alumno_id == alumno_id, Asistencia.estado == "No asistió")
        .count()
    )
    a.inasistencias = int(getattr(a, "inasistencias_previas", 0) or 0) + con_fecha
    return a.inasistencias


def _asistencia_dict(x: Asistencia) -> dict:
    return {
        "id": x.id,
        "fecha": x.fecha.isoformat() if x.fecha else None,
        "estado": x.estado,
        "registrado_por": x.registrado_por or "No consta",
        "fecha_registro": x.fecha_registro.isoformat() if x.fecha_registro else None,
    }


@router.get("/alumnos/{alumno_id}/asistencias")
def listar_asistencias(alumno_id: int, db: Session = Depends(get_db)):
    """Registros de asistencia de un alumno, del más reciente al más antiguo."""
    a = _get_alumno(db, alumno_id)
    filas = (
        db.query(Asistencia)
        .filter(Asistencia.alumno_id == alumno_id)
        .order_by(Asistencia.fecha.desc())
        .all()
    )
    previas = int(getattr(a, "inasistencias_previas", 0) or 0)
    faltas = sum(1 for x in filas if x.estado == "No asistió")
    return {
        "alumno": alumno_id,
        "registros": [_asistencia_dict(x) for x in filas],
        "faltas_con_fecha": faltas,
        # Se declara aparte, no se suma en silencio: son días que constaban como
        # total agregado antes de que existiera este registro y nadie anotó su
        # fecha. Ocultarlos haría que el total no cuadrase con la lista.
        "inasistencias_previas": previas,
        "total": previas + faltas,
        "maximo_admitido": MAX_INASISTENCIAS,
        "anio_lectivo": getattr(a, "anio_cursada", None),
    }


@router.post("/alumnos/{alumno_id}/asistencias", status_code=201)
def registrar_asistencia(
    alumno_id: int,
    data: AsistenciaIn,
    db: Session = Depends(get_db),
    usuario: Optional[Usuario] = Depends(_usuario_opcional),
):
    """Registra si el alumno asistió o no en una fecha concreta.

    Si ya existe un registro de ese día, se corrige en lugar de duplicarlo: un
    alumno no puede haber asistido y faltado el mismo día.
    """
    _get_alumno(db, alumno_id)
    quien = getattr(usuario, "usuario", None) if usuario else None

    existente = (
        db.query(Asistencia)
        .filter(Asistencia.alumno_id == alumno_id, Asistencia.fecha == data.fecha)
        .first()
    )
    if existente:
        anterior = existente.estado
        existente.estado = data.estado
        existente.registrado_por = quien
        existente.fecha_registro = datetime.utcnow()
        registro, corregido = existente, anterior != data.estado
    else:
        registro = Asistencia(
            alumno_id=alumno_id, fecha=data.fecha, estado=data.estado,
            registrado_por=quien,
        )
        db.add(registro)
        corregido = False

    db.flush()
    total = _recalcular_inasistencias(db, alumno_id)
    db.commit()
    db.refresh(registro)

    # Las inasistencias son una de las tres variables del modelo, así que la
    # predicción vigente queda obsoleta en cuanto cambia el total.
    prediccion_actualizada = False
    try:
        generar_prediccion_alumno(db, alumno_id)
        prediccion_actualizada = True
    except HTTPException:
        pass

    return {
        "registro": _asistencia_dict(registro),
        "total_inasistencias": total,
        "prediccion_actualizada": prediccion_actualizada,
        "mensaje": (
            ("Registro corregido: " if corregido else "")
            + f"{data.estado} el {data.fecha.strftime('%d/%m/%Y')}. "
            + f"Total de inasistencias: {total} día(s)."
            + (" Predicción recalculada." if prediccion_actualizada else "")
        ),
    }


@router.delete("/alumnos/{alumno_id}/asistencias/{asistencia_id}", status_code=200)
def borrar_asistencia(alumno_id: int, asistencia_id: int, db: Session = Depends(get_db)):
    """Retira un registro anotado por error."""
    _get_alumno(db, alumno_id)
    x = (
        db.query(Asistencia)
        .filter(Asistencia.id == asistencia_id, Asistencia.alumno_id == alumno_id)
        .first()
    )
    if not x:
        raise HTTPException(status_code=404, detail="Ese registro no existe.")

    fecha = x.fecha
    db.delete(x)
    db.flush()
    total = _recalcular_inasistencias(db, alumno_id)
    db.commit()

    try:
        generar_prediccion_alumno(db, alumno_id)
    except HTTPException:
        pass

    return {
        "mensaje": f"Registro del {fecha.strftime('%d/%m/%Y')} eliminado. "
                   f"Total de inasistencias: {total} día(s).",
        "total_inasistencias": total,
    }

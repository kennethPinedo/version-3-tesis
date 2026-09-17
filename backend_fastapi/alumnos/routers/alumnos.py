import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from database import get_db
from alumnos.models import Alumno
from alumnos.services import generar_prediccion_alumno
from alumnos.services import cripto_service as cripto

router = APIRouter()

# Tope defensivo: un año escolar peruano tiene ~190 días lectivos.
MAX_INASISTENCIAS = 365

NIVELES = {"Primaria": 6, "Secundaria": 5}   # nivel -> grado máximo

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
    edad: int = Field(ge=3, le=30)
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
        tope = NIVELES[self.nivel]
        if self.grado > tope:
            return f"{self.nivel} llega hasta {tope}° grado."
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
):
    """Persiste las inasistencias acumuladas y actualiza el vector predictivo.

    Las inasistencias son una de las tres variables del MODELO 2
    (Promedio, Inasistencias, Prob_TDAH), así que al cambiarlas la predicción
    vigente queda obsoleta y se regenera aquí mismo. Si el alumno todavía no
    tiene encuesta EDAH no es un error: el valor se guarda y la predicción se
    generará cuando exista la encuesta.
    """
    a = _get_alumno(db, alumno_id)
    a.inasistencias = data.inasistencias
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


@router.delete("/alumnos/{alumno_id}/", status_code=204)
def delete_alumno(alumno_id: int, db: Session = Depends(get_db)):
    a = _get_alumno(db, alumno_id)
    db.delete(a)
    db.commit()

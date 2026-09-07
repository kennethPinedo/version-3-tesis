from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from alumnos.models import Alumno
from alumnos.services import generar_prediccion_alumno

router = APIRouter()

# Tope defensivo: un año escolar peruano tiene ~190 días lectivos.
MAX_INASISTENCIAS = 365


class AlumnoCreate(BaseModel):
    """Alta y edición de alumno.

    `condicion_social` fue retirada por depuración de datos sensibles: ya no se
    recibe ni se expone (la columna sigue en la BD solo como legado).
    """
    nombre: str = Field(min_length=1, max_length=100)
    apellido: str = Field(min_length=1, max_length=100)
    edad: int = Field(ge=3, le=30)
    grado: str = Field(min_length=1, max_length=50)
    anio_cursada: int = Field(default=2024, ge=2000, le=2100)
    contacto_emergente: str = Field(min_length=1, max_length=100)
    genero: str = "No especificado"


class InasistenciasUpdate(BaseModel):
    """Módulo Control de Inasistencias (rol Docente)."""
    inasistencias: int = Field(ge=0, le=MAX_INASISTENCIAS)


def _alumno_dict(a: Alumno) -> dict:
    return {
        "id": a.id,
        "nombre": a.nombre,
        "apellido": a.apellido,
        "edad": a.edad,
        "grado": a.grado,
        "anio_cursada": a.anio_cursada,
        "contacto_emergente": a.contacto_emergente,
        "genero": a.genero,
        "inasistencias": int(getattr(a, "inasistencias", 0) or 0),
    }


def _get_alumno(db: Session, alumno_id: int) -> Alumno:
    a = db.query(Alumno).filter(Alumno.id == alumno_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Alumno no encontrado.")
    return a


@router.get("/alumnos/")
def list_alumnos(db: Session = Depends(get_db)):
    return [_alumno_dict(a) for a in db.query(Alumno).order_by(Alumno.id).all()]


@router.post("/alumnos/", status_code=201)
def create_alumno(data: AlumnoCreate, db: Session = Depends(get_db)):
    a = Alumno(**data.model_dump())
    db.add(a)
    db.commit()
    db.refresh(a)
    return _alumno_dict(a)


@router.get("/alumnos/{alumno_id}/")
def get_alumno(alumno_id: int, db: Session = Depends(get_db)):
    return _alumno_dict(_get_alumno(db, alumno_id))


@router.put("/alumnos/{alumno_id}/")
def update_alumno(alumno_id: int, data: AlumnoCreate, db: Session = Depends(get_db)):
    a = _get_alumno(db, alumno_id)
    for k, v in data.model_dump().items():
        setattr(a, k, v)
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

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from alumnos.models import Alumno, Encuesta

router = APIRouter()

_KEYS_DA = [f"DA{i}" for i in range(1, 6)]
_KEYS_HI = [f"HI{i}" for i in range(1, 6)]
_KEYS_TC = [f"TC{i}" for i in range(1, 11)]
_ALL_KEYS = _KEYS_DA + _KEYS_HI + _KEYS_TC

# Escala EDAH: 0 = Nunca, 1 = Algunas veces, 2 = Bastantes veces, 3 = Siempre.
_Item = Field(ge=0, le=3)


class EncuestaCreate(BaseModel):
    """Instrumento EDAH: EXCLUSIVAMENTE sus 20 ítems.

    Las inasistencias se registran en el módulo independiente
    "Control de Inasistencias" (PUT /alumnos/{id}/inasistencias) y ya no
    forman parte de este instrumento psicométrico.
    """
    alumno: int
    DA1: int = _Item; DA2: int = _Item; DA3: int = _Item; DA4: int = _Item; DA5: int = _Item
    HI1: int = _Item; HI2: int = _Item; HI3: int = _Item; HI4: int = _Item; HI5: int = _Item
    TC1: int = _Item; TC2: int = _Item; TC3: int = _Item; TC4: int = _Item; TC5: int = _Item
    TC6: int = _Item; TC7: int = _Item; TC8: int = _Item; TC9: int = _Item; TC10: int = _Item


def _encuesta_dict(e: Encuesta) -> dict:
    d = {"id": e.id, "alumno": e.alumno_id}
    for k in _ALL_KEYS:
        d[k] = getattr(e, k)
    d["da_total"] = sum(getattr(e, k) for k in _KEYS_DA)
    d["hi_total"] = sum(getattr(e, k) for k in _KEYS_HI)
    d["tc_total"] = sum(getattr(e, k) for k in _KEYS_TC)
    d["fecha_aplicacion"] = str(e.fecha_aplicacion) if e.fecha_aplicacion else None
    return d


@router.get("/encuestas/")
def list_encuestas(alumno: Optional[int] = None, db: Session = Depends(get_db)):
    # Se desempata por id descendente: dos encuestas del mismo día se ordenan
    # por orden de registro, no de forma indefinida.
    q = db.query(Encuesta).order_by(Encuesta.fecha_aplicacion.desc(), Encuesta.id.desc())
    if alumno:
        q = q.filter(Encuesta.alumno_id == alumno)
    return [_encuesta_dict(e) for e in q.all()]


@router.post("/encuestas/", status_code=201)
def create_encuesta(data: EncuestaCreate, db: Session = Depends(get_db)):
    d = data.model_dump()
    alumno_id = d.pop("alumno")
    if not db.query(Alumno).filter(Alumno.id == alumno_id).first():
        raise HTTPException(status_code=404, detail="Alumno no encontrado.")

    # inasistencias=0: columna legado que sigue siendo NOT NULL en bases de
    # datos ya creadas. El valor real vive en Alumno.inasistencias.
    e = Encuesta(alumno_id=alumno_id, inasistencias=0, **d)
    db.add(e)
    db.commit()
    db.refresh(e)
    return _encuesta_dict(e)

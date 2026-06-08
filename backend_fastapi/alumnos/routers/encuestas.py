from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel
from database import get_db
from alumnos.models import Encuesta

router = APIRouter()

_KEYS_DA = [f"DA{i}" for i in range(1, 6)]
_KEYS_HI = [f"HI{i}" for i in range(1, 6)]
_KEYS_TC = [f"TC{i}" for i in range(1, 11)]
_ALL_KEYS = _KEYS_DA + _KEYS_HI + _KEYS_TC


class EncuestaCreate(BaseModel):
    alumno: int
    DA1: int; DA2: int; DA3: int; DA4: int; DA5: int
    HI1: int; HI2: int; HI3: int; HI4: int; HI5: int
    TC1: int; TC2: int; TC3: int; TC4: int; TC5: int
    TC6: int; TC7: int; TC8: int; TC9: int; TC10: int


def _encuesta_dict(e: Encuesta) -> dict:
    d = {"id": e.id, "alumno": e.alumno_id}
    for k in _ALL_KEYS:
        d[k] = getattr(e, k)
    d["fecha_aplicacion"] = str(e.fecha_aplicacion) if e.fecha_aplicacion else None
    return d


@router.get("/encuestas/")
def list_encuestas(alumno: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(Encuesta).order_by(Encuesta.fecha_aplicacion.desc())
    if alumno:
        q = q.filter(Encuesta.alumno_id == alumno)
    return [_encuesta_dict(e) for e in q.all()]


@router.post("/encuestas/", status_code=201)
def create_encuesta(data: EncuestaCreate, db: Session = Depends(get_db)):
    d = data.model_dump()
    alumno_id = d.pop("alumno")
    e = Encuesta(alumno_id=alumno_id, **d)
    db.add(e)
    db.commit()
    db.refresh(e)
    return _encuesta_dict(e)

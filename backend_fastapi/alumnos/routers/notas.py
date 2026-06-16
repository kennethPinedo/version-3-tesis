from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel
from database import get_db
from alumnos.models import Nota

router = APIRouter()


class NotaCreate(BaseModel):
    alumno: int
    asignatura: str
    calificacion_literal: str
    bimestre: int = 1  # 1, 2, 3 o 4


def _nota_dict(n: Nota) -> dict:
    return {
        "id": n.id,
        "alumno": n.alumno_id,
        "asignatura": n.asignatura,
        "calificacion_literal": n.calificacion_literal,
        "bimestre": getattr(n, "bimestre", 1),
        "fecha_registro": str(n.fecha_registro) if n.fecha_registro else None,
    }


@router.get("/notas/")
def list_notas(alumno: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(Nota).order_by(Nota.fecha_registro.desc())
    if alumno:
        q = q.filter(Nota.alumno_id == alumno)
    return [_nota_dict(n) for n in q.all()]


@router.post("/notas/", status_code=201)
def create_nota(data: NotaCreate, db: Session = Depends(get_db)):
    d = data.model_dump()
    alumno_id = d.pop("alumno")
    # Upsert: si ya existe la nota de ese curso en ese bimestre, se actualiza
    # (evita duplicados que distorsionarían el promedio del bimestre).
    existente = (
        db.query(Nota)
        .filter(
            Nota.alumno_id == alumno_id,
            Nota.asignatura == d["asignatura"],
            Nota.bimestre == d["bimestre"],
        )
        .first()
    )
    if existente:
        existente.calificacion_literal = d["calificacion_literal"]
        db.commit()
        db.refresh(existente)
        return _nota_dict(existente)
    n = Nota(alumno_id=alumno_id, **d)
    db.add(n)
    db.commit()
    db.refresh(n)
    return _nota_dict(n)

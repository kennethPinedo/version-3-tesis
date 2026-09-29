from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import extract
from sqlalchemy.orm import Session

from database import get_db
from alumnos.models import Alumno, EdicionEncuesta, Encuesta
from alumnos.services import generar_prediccion_alumno
from alumnos.services import auth_service as auth

router = APIRouter()

_KEYS_DA = [f"DA{i}" for i in range(1, 6)]
_KEYS_HI = [f"HI{i}" for i in range(1, 6)]
_KEYS_TC = [f"TC{i}" for i in range(1, 11)]
_ALL_KEYS = _KEYS_DA + _KEYS_HI + _KEYS_TC

# Escala EDAH: 0 = Nunca, 1 = Algunas veces, 2 = Bastantes veces, 3 = Siempre.
_Item = Field(ge=0, le=3)

# Quien responde la escala. El EDAH no lo contesta el nino: lo rellena un adulto
# que lo observa a diario, y la lectura clinica cambia segun cual sea. El
# psicologo casi nunca es el informante: normalmente transcribe lo que respondio
# el docente o la familia, y esa distincion tiene que quedar registrada.
INFORMANTES = ("Docente", "Padre/Madre/Apoderado", "Psicologo (observacion directa)")


class EncuestaCreate(BaseModel):
    """Instrumento EDAH: EXCLUSIVAMENTE sus 20 ítems.

    Las inasistencias se registran en el módulo independiente
    "Control de Inasistencias" (PUT /alumnos/{id}/inasistencias) y ya no
    forman parte de este instrumento psicométrico.
    """
    alumno: int
    informante: str = Field(default="Docente")
    DA1: int = _Item; DA2: int = _Item; DA3: int = _Item; DA4: int = _Item; DA5: int = _Item
    HI1: int = _Item; HI2: int = _Item; HI3: int = _Item; HI4: int = _Item; HI5: int = _Item
    TC1: int = _Item; TC2: int = _Item; TC3: int = _Item; TC4: int = _Item; TC5: int = _Item
    TC6: int = _Item; TC7: int = _Item; TC8: int = _Item; TC9: int = _Item; TC10: int = _Item


    @field_validator("informante")
    @classmethod
    def _informante_valido(cls, v: str) -> str:
        limpio = (v or "").strip()
        if limpio not in INFORMANTES:
            raise ValueError(f"El informante debe ser uno de: {', '.join(INFORMANTES)}.")
        return limpio


def _regenerar_si_procede(db: Session, alumno_id: int) -> bool:
    """Recalcula la predicción del alumno si es posible.

    La probabilidad de TDAH es la variable de más peso del modelo de riesgo
    (55,6%), así que registrar o corregir la escala deja obsoleta la predicción
    vigente. Antes no se regeneraba: solo lo hacían las inasistencias y la
    carga masiva de notas, lo cual era incoherente.
    """
    try:
        generar_prediccion_alumno(db, alumno_id)
        return True
    except HTTPException:
        # Sin notas todavía no se puede predecir. No es un error: la encuesta
        # se guarda igual y la predicción llegará cuando existan.
        return False


def _encuesta_dict(e: Encuesta, db: Optional[Session] = None) -> dict:
    d = {"id": e.id, "alumno": e.alumno_id}
    for k in _ALL_KEYS:
        d[k] = getattr(e, k)
    d["da_total"] = sum(getattr(e, k) for k in _KEYS_DA)
    d["hi_total"] = sum(getattr(e, k) for k in _KEYS_HI)
    d["tc_total"] = sum(getattr(e, k) for k in _KEYS_TC)
    d["fecha_aplicacion"] = str(e.fecha_aplicacion) if e.fecha_aplicacion else None
    # Las 35 encuestas anteriores a este campo no lo tienen. Se dice que no
    # consta, en lugar de suponer un informante que nadie registro.
    d["informante"] = e.informante or "No consta"

    # Historial de correcciones, de la más reciente a la más antigua.
    if db is not None:
        ediciones = (
            db.query(EdicionEncuesta)
            .filter(EdicionEncuesta.encuesta_id == e.id)
            .order_by(EdicionEncuesta.fecha_edicion.desc())
            .all()
        )
        anio = datetime.utcnow().year
        d["ediciones"] = [
            {
                "fecha": x.fecha_edicion.isoformat() if x.fecha_edicion else None,
                "editado_por": x.editado_por or "No consta",
                "resumen": x.resumen or "",
            }
            for x in ediciones
        ]
        usadas = sum(1 for x in ediciones
                     if x.fecha_edicion and x.fecha_edicion.year == anio)
        d["ediciones_este_anio"] = usadas
        d["ediciones_restantes"] = max(0, MAX_EDICIONES_ANUALES - usadas)
    return d


@router.get("/encuestas/")
def list_encuestas(alumno: Optional[int] = None, db: Session = Depends(get_db)):
    # Se desempata por id descendente: dos encuestas del mismo día se ordenan
    # por orden de registro, no de forma indefinida.
    q = db.query(Encuesta).order_by(Encuesta.fecha_aplicacion.desc(), Encuesta.id.desc())
    if alumno:
        q = q.filter(Encuesta.alumno_id == alumno)
    return [_encuesta_dict(e, db) for e in q.all()]


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

    # Antes esto no ocurría: el psicólogo aplicaba la escala, la guardaba, y la
    # predicción que se seguía mostrando venía de la encuesta anterior. Solo las
    # inasistencias y la carga masiva de notas regeneraban, lo cual dejaba fuera
    # precisamente a la variable de más peso del modelo.
    prediccion_actualizada = _regenerar_si_procede(db, alumno_id)

    salida = _encuesta_dict(e, db)
    salida["prediccion_actualizada"] = prediccion_actualizada
    return salida


# ══ Edición de una encuesta ya guardada ═══════════════════════════════════
# El EDAH era inmutable: corregir un error obligaba a aplicarlo de nuevo, y
# quedaban dos aplicaciones para un unico momento de evaluacion. Ahora se puede
# corregir, pero con limite y dejando constancia.
#
# El limite existe porque es un instrumento psicometrico: si se pudiera
# reescribir sin restriccion, la puntuacion dejaria de reflejar lo que observo
# el informante y pasaria a reflejar lo que alguien decidio despues.

MAX_EDICIONES_ANUALES = 2


def _ediciones_del_anio(db: Session, encuesta_id: int, anio: int) -> int:
    """Cuantas veces se corrigio esta encuesta dentro del año indicado."""
    return (
        db.query(EdicionEncuesta)
        .filter(
            EdicionEncuesta.encuesta_id == encuesta_id,
            extract("year", EdicionEncuesta.fecha_edicion) == anio,
        )
        .count()
    )


def _resumir_cambios(anterior: dict, nuevo: dict) -> str:
    """«DA3: 1 -> 2 | TC7: 0 -> 1». Solo lo que cambia."""
    partes = [
        f"{k}: {anterior[k]} -> {nuevo[k]}"
        for k in _ALL_KEYS
        if anterior.get(k) != nuevo.get(k)
    ]
    if anterior.get("informante") != nuevo.get("informante"):
        partes.append(f"Informante: {anterior.get('informante')} -> {nuevo.get('informante')}")
    return " | ".join(partes)


@router.put("/encuestas/{encuesta_id}")
def editar_encuesta(
    encuesta_id: int,
    data: EncuestaCreate,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    """Corrige una encuesta ya registrada. Máximo dos veces por año.

    No se permite cambiar de alumno: eso no es una corrección, es otra
    encuesta. Si el error fue registrarla a quien no era, se borra y se aplica
    de nuevo.
    """
    e = db.query(Encuesta).filter(Encuesta.id == encuesta_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="Esa encuesta no existe.")

    d = data.model_dump()
    alumno_id = d.pop("alumno")
    if alumno_id != e.alumno_id:
        raise HTTPException(
            status_code=400,
            detail="Una corrección no puede cambiar de estudiante. Si la encuesta se "
                   "registró a quien no era, elimínala y vuelve a aplicarla.",
        )

    anio = datetime.utcnow().year
    usadas = _ediciones_del_anio(db, encuesta_id, anio)
    if usadas >= MAX_EDICIONES_ANUALES:
        raise HTTPException(
            status_code=409,
            detail=f"Esta encuesta ya se corrigió {usadas} vez/veces en {anio}, que es el "
                   f"máximo permitido. Si hace falta un registro distinto, aplica la "
                   f"escala de nuevo: se conservan ambas y las predicciones usan la más "
                   f"reciente.",
        )

    anterior = {k: getattr(e, k) for k in _ALL_KEYS}
    anterior["informante"] = e.informante
    resumen = _resumir_cambios(anterior, d)
    if not resumen:
        raise HTTPException(
            status_code=400,
            detail="No hay ningún cambio que guardar: la encuesta es idéntica a la actual.",
        )

    for k in _ALL_KEYS:
        setattr(e, k, d[k])
    e.informante = d["informante"]

    usuario = None
    try:
        usuario = auth.usuario_de_token(db, auth.extraer_token(authorization))
    except Exception:
        pass

    db.add(EdicionEncuesta(
        encuesta_id=encuesta_id,
        editado_por=getattr(usuario, "usuario", None) if usuario else None,
        resumen=resumen,
    ))
    db.commit()
    db.refresh(e)

    # La probabilidad de TDAH es la variable de más peso del modelo de riesgo
    # (55,6%), así que corregir la escala deja obsoleta la predicción vigente.
    prediccion_actualizada = _regenerar_si_procede(db, e.alumno_id)

    return {
        "encuesta": _encuesta_dict(e, db),
        "cambios": resumen,
        "ediciones_usadas": usadas + 1,
        "ediciones_restantes": MAX_EDICIONES_ANUALES - (usadas + 1),
        "prediccion_actualizada": prediccion_actualizada,
        "mensaje": (
            f"Encuesta corregida. Te queda "
            f"{MAX_EDICIONES_ANUALES - (usadas + 1)} corrección/es este año."
            + (" Predicción recalculada." if prediccion_actualizada else "")
        ),
    }


@router.delete("/encuestas/{encuesta_id}", status_code=200)
def borrar_encuesta(encuesta_id: int, db: Session = Depends(get_db)):
    """Retira una encuesta registrada por error, con su historial de ediciones."""
    e = db.query(Encuesta).filter(Encuesta.id == encuesta_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="Esa encuesta no existe.")

    alumno_id = e.alumno_id
    db.query(EdicionEncuesta).filter(EdicionEncuesta.encuesta_id == encuesta_id).delete()
    db.delete(e)
    db.commit()

    # Al desaparecer, la predicción pasa a apoyarse en la encuesta anterior —o
    # en ninguna—, así que hay que recalcularla.
    _regenerar_si_procede(db, alumno_id)
    return {"mensaje": "Encuesta eliminada."}

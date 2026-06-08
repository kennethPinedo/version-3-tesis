from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel
from database import get_db
from alumnos.models import Alumno, Nota, Encuesta, PrediccionAcademica
from alumnos.ml.prediccion import predecir_riesgo

router = APIRouter()

_MAPEO_NOTAS = {"AD": 20, "A": 17, "B": 14, "C": 11}

# Mapeo condicion_social (string del frontend) → valor numérico 0-24
# para que el modelo ML reciba el mismo rango con el que fue entrenado
_SOCIAL_NUMERICO = {
    "ninguna": 4, "ningún problema": 4,
    "leve": 6,
    "moderado": 12, "moderada": 12,
    "grave": 20,
}


class GenerarPrediccionIn(BaseModel):
    alumno: int


def _social_numerico(condicion: str) -> int:
    return _SOCIAL_NUMERICO.get((condicion or "").lower().strip(), 4)


def _tdah_coded(prob: float) -> int:
    if prob <= 0.30: return 0
    if prob <= 0.70: return 1
    return 2


def _nivel_tdah(da_total: int, hi_total: int) -> str:
    if da_total > 10 or hi_total > 10:
        return "Posible TDAH"
    return "Sin TDAH"


def _pred_dict(p: PrediccionAcademica, alumno_nombre: str = None) -> dict:
    cond = p.condiciones_psicoeducativas or ""
    total_atencion       = None
    total_hiperactividad = None
    prob_tdah_stored     = None

    for part in cond.split("|"):
        part = part.strip()
        if part.startswith("Atención (total):"):
            try: total_atencion = int(part.split(":")[1].strip().split("/")[0])
            except Exception: pass
        elif part.startswith("Hiperactividad (total):"):
            try: total_hiperactividad = int(part.split(":")[1].strip().split("/")[0])
            except Exception: pass
        elif part.startswith("Prob TDAH:"):
            try: prob_tdah_stored = float(part.split(":")[1].strip())
            except Exception: pass

    if total_atencion is not None and total_hiperactividad is not None:
        nivel_tdah = _nivel_tdah(total_atencion, total_hiperactividad)
    else:
        nivel_tdah = None

    return {
        "id": p.id,
        "alumno": p.alumno_id,
        "alumno_nombre": alumno_nombre,
        "promedio_notas": p.promedio_notas,
        "nivel_riesgo": p.nivel_riesgo,
        "probabilidad": p.probabilidad,
        "prediccion_notas": p.prediccion_notas,
        "condiciones_psicoeducativas": p.condiciones_psicoeducativas,
        "fecha_prediccion": p.fecha_prediccion.isoformat() if p.fecha_prediccion else None,
        "nivel_tdah": nivel_tdah,
        "total_atencion": total_atencion,
        "total_hiperactividad": total_hiperactividad,
        "prob_tdah": prob_tdah_stored,
    }


@router.get("/predicciones/")
def list_predicciones(alumno: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(PrediccionAcademica).order_by(PrediccionAcademica.fecha_prediccion.desc())
    if alumno:
        q = q.filter(PrediccionAcademica.alumno_id == alumno)
    result = []
    for p in q.all():
        a = db.query(Alumno).filter(Alumno.id == p.alumno_id).first()
        nombre = f"{a.nombre} {a.apellido}" if a else None
        result.append(_pred_dict(p, nombre))
    return result


@router.post("/predicciones/generar/")
def generar_prediccion(data: GenerarPrediccionIn, db: Session = Depends(get_db)):
    alumno_id = data.alumno
    alumno = db.query(Alumno).filter(Alumno.id == alumno_id).first()
    if not alumno:
        raise HTTPException(status_code=404, detail="Alumno no encontrado.")

    notas = db.query(Nota).filter(Nota.alumno_id == alumno_id).all()
    if not notas:
        raise HTTPException(
            status_code=400,
            detail="No se pudo generar prediccion. Verifique notas y encuesta.",
        )

    valores = [_MAPEO_NOTAS.get(n.calificacion_literal, 0) for n in notas]
    promedio_notas = sum(valores) / len(valores)

    encuesta = (
        db.query(Encuesta)
        .filter(Encuesta.alumno_id == alumno_id)
        .order_by(Encuesta.fecha_aplicacion.desc())
        .first()
    )
    if not encuesta:
        raise HTTPException(
            status_code=400,
            detail="No se pudo generar prediccion. Verifique notas y encuesta.",
        )

    total_atencion       = sum(getattr(encuesta, f"DA{i}") for i in range(1, 6))
    total_hiperactividad = sum(getattr(encuesta, f"HI{i}") for i in range(1, 6))
    total_conducta       = sum(getattr(encuesta, f"TC{i}") for i in range(1, 11))

    # ── Probabilidad TDAH (fórmula) ────────────────────────────────────────────
    prob_tdah  = round(max(total_atencion, total_hiperactividad) / 15.0, 4)
    nivel_tdah = _nivel_tdah(total_atencion, total_hiperactividad)

    # ── Predicción de Riesgo Académico (modelo ML) ─────────────────────────────
    condicion_social_num = _social_numerico(alumno.condicion_social)
    nivel_riesgo, probabilidad = predecir_riesgo({
        "DA_total":         total_atencion,
        "HI_total":         total_hiperactividad,
        "promedio_notas":   promedio_notas,
        "condicion_social": condicion_social_num,
    })

    condiciones_texto = (
        f"Atención (total): {total_atencion}/15 | "
        f"Hiperactividad (total): {total_hiperactividad}/15 | "
        f"Trastorno de Conducta (total): {total_conducta}/30 | "
        f"Prob TDAH: {prob_tdah:.4f} | "
        f"Condición social: {alumno.condicion_social} | "
        f"Promedio notas: {promedio_notas:.2f}"
    )

    pred = (
        db.query(PrediccionAcademica)
        .filter(PrediccionAcademica.alumno_id == alumno_id)
        .first()
    )
    if pred:
        pred.promedio_notas              = promedio_notas
        pred.nivel_riesgo                = nivel_riesgo
        pred.probabilidad                = probabilidad
        pred.prediccion_notas            = f"{promedio_notas:.2f}"
        pred.condiciones_psicoeducativas = condiciones_texto
    else:
        pred = PrediccionAcademica(
            alumno_id                = alumno_id,
            promedio_notas           = promedio_notas,
            nivel_riesgo             = nivel_riesgo,
            probabilidad             = probabilidad,
            prediccion_notas         = f"{promedio_notas:.2f}",
            condiciones_psicoeducativas = condiciones_texto,
        )
        db.add(pred)

    db.commit()
    db.refresh(pred)
    result = _pred_dict(pred, f"{alumno.nombre} {alumno.apellido}")
    result["nivel_tdah"]           = nivel_tdah
    result["total_atencion"]       = total_atencion
    result["total_hiperactividad"] = total_hiperactividad
    result["total_conducta"]       = total_conducta
    result["prob_tdah"]            = prob_tdah
    return result

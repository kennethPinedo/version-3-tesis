import os
import json
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from alumnos.models import Alumno, PrediccionAcademica
from alumnos.ml.prediccion import obtener_shap, obtener_shap_riesgo
from alumnos.ml.recomendaciones import generar_recomendaciones
from alumnos.services import generar_prediccion_alumno, nivel_tdah_cribado

router = APIRouter()

_ML_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "ml"))
_METRICAS_PATH = os.path.join(_ML_DIR, "metricas.json")
_METRICAS_RIESGO_PATH = os.path.join(_ML_DIR, "metricas_riesgo.json")


def _leer_json(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


@router.get("/metricas/")
def get_metricas():
    """Métricas macro del MODELO 1 (recall, f1, precision, accuracy, especificidad)."""
    return _leer_json(_METRICAS_PATH)


@router.get("/metricas-riesgo/")
def get_metricas_riesgo():
    """Métricas macro del MODELO 2 (Riesgo Académico)."""
    return _leer_json(_METRICAS_RIESGO_PATH)


class GenerarPrediccionIn(BaseModel):
    alumno: int


def _parse_condiciones(cond: Optional[str]) -> Dict[str, str]:
    """Convierte `condiciones_psicoeducativas` ("k: v | k: v") en dict."""
    fields: Dict[str, str] = {}
    for part in (cond or "").split("|"):
        part = part.strip()
        if ":" in part:
            k, v = part.split(":", 1)
            fields[k.strip()] = v.strip()
    return fields


def _campo_int(fields: Dict[str, str], key: str, default=None):
    try:
        return int(fields[key].split("/")[0]) if key in fields else default
    except Exception:
        return default


def _campo_float(fields: Dict[str, str], key: str, default=None):
    try:
        return float(fields[key]) if key in fields else default
    except Exception:
        return default


def _pred_dict(p: PrediccionAcademica, alumno_nombre: Optional[str] = None) -> dict:
    fields = _parse_condiciones(p.condiciones_psicoeducativas)

    hi_total = _campo_int(fields, "HI_total")
    da_total = _campo_int(fields, "DA_total")
    nivel_tdah = fields.get("Nivel_TDAH") or (
        nivel_tdah_cribado(hi_total or 0, da_total or 0)
        if (hi_total is not None and da_total is not None) else None
    )

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
        "confianza_tdah": _campo_float(fields, "Confianza_TDAH"),
        "referencia_psicometrica": fields.get("Referencia_Psicometrica"),
        "hi_total": hi_total,
        "da_total": da_total,
        "tc_total": _campo_int(fields, "TC_total"),
        "inasistencias": _campo_int(fields, "Inasistencias"),
        "nota_b1": fields.get("Nota_B1"),
        "nota_b2": fields.get("Nota_B2"),
        "nota_b3": fields.get("Nota_B3"),
        "nota_b4": fields.get("Nota_B4"),
        "promedio_final": fields.get("Promedio_Final"),
        # compatibilidad con campos anteriores del frontend
        "total_atencion": da_total,
        "total_hiperactividad": hi_total,
        "total_conducta": _campo_int(fields, "TC_total"),
        "prob_tdah": _campo_float(fields, "Prob_TDAH"),
    }


def _get_pred(db: Session, pred_id: int) -> PrediccionAcademica:
    pred = db.query(PrediccionAcademica).filter(PrediccionAcademica.id == pred_id).first()
    if not pred:
        raise HTTPException(status_code=404, detail="Predicción no encontrada.")
    return pred


@router.get("/predicciones/")
def list_predicciones(alumno: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(PrediccionAcademica).order_by(
        PrediccionAcademica.fecha_prediccion.desc(), PrediccionAcademica.id.desc()
    )
    if alumno:
        q = q.filter(PrediccionAcademica.alumno_id == alumno)

    predicciones = q.all()
    nombres = {
        a.id: f"{a.nombre} {a.apellido}"
        for a in db.query(Alumno).filter(
            Alumno.id.in_({p.alumno_id for p in predicciones})
        ).all()
    } if predicciones else {}
    return [_pred_dict(p, nombres.get(p.alumno_id)) for p in predicciones]


@router.get("/predicciones/{pred_id}/shap/")
def shap_prediccion(pred_id: int, db: Session = Depends(get_db)):
    pred = _get_pred(db, pred_id)
    fields = _parse_condiciones(pred.condiciones_psicoeducativas)

    # Reconstruye los 20 ítems EDAH desde condiciones_psicoeducativas
    datos = {
        **{f"HI{i}": _campo_int(fields, f"HI{i}", 0) for i in range(1, 6)},
        **{f"DA{i}": _campo_int(fields, f"DA{i}", 0) for i in range(1, 6)},
        **{f"TC{i}": _campo_int(fields, f"TC{i}", 0) for i in range(1, 11)},
    }
    return obtener_shap(
        datos,
        fields.get("Nivel_TDAH", "Sospecha Baja"),
        _campo_float(fields, "Prob_TDAH", 0.0),
    )


@router.get("/predicciones/{pred_id}/shap-riesgo/")
def shap_riesgo(pred_id: int, db: Session = Depends(get_db)):
    """Explicación SHAP del MODELO 2 (Riesgo Académico)."""
    pred = _get_pred(db, pred_id)
    fields = _parse_condiciones(pred.condiciones_psicoeducativas)
    tiene_notas = fields.get("Promedio_Final", "—") not in ("—", "")
    return obtener_shap_riesgo(
        pred.promedio_notas,
        _campo_int(fields, "Inasistencias", 0),
        _campo_float(fields, "Prob_TDAH", 0.0),
        pred.nivel_riesgo or "Bajo",
        tiene_notas=tiene_notas,
    )


@router.get("/predicciones/{pred_id}/recomendaciones/")
def recomendaciones_prediccion(pred_id: int, db: Session = Depends(get_db)):
    """Analítica PRESCRIPTIVA: plan de acción derivado de ambos modelos.

    Los disparadores son la salida de los modelos (`Nivel_TDAH`, `nivel_riesgo`)
    y las inasistencias, de modo que el plan nunca contradice la predicción.
    """
    pred = _get_pred(db, pred_id)
    fields = _parse_condiciones(pred.condiciones_psicoeducativas)

    resultado = generar_recomendaciones(
        nivel_tdah=fields.get("Nivel_TDAH"),
        nivel_riesgo=pred.nivel_riesgo,
        da_total=_campo_int(fields, "DA_total", 0),
        hi_total=_campo_int(fields, "HI_total", 0),
        tc_total=_campo_int(fields, "TC_total", 0),
        inasistencias=_campo_int(fields, "Inasistencias", 0),
        promedio_final=fields.get("Promedio_Final", "—"),
    )
    resultado["prediccion"] = pred.id
    resultado["alumno"] = pred.alumno_id
    return resultado


@router.post("/predicciones/generar/")
def generar_prediccion(data: GenerarPrediccionIn, db: Session = Depends(get_db)):
    pred = generar_prediccion_alumno(db, data.alumno)
    alumno = db.query(Alumno).filter(Alumno.id == pred.alumno_id).first()
    nombre = f"{alumno.nombre} {alumno.apellido}" if alumno else None
    return _pred_dict(pred, nombre)

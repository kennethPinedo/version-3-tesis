import os
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel
from database import get_db
from alumnos.models import Alumno, Nota, Encuesta, PrediccionAcademica
from alumnos.ml.prediccion import (predecir_tdah, obtener_shap,
                                   predecir_riesgo, obtener_shap_riesgo)

router = APIRouter()

_METRICAS_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "ml", "metricas.json"))


@router.get("/metricas/")
def get_metricas():
    """Métricas macro del modelo (recall, f1, precision, accuracy, especificidad)."""
    try:
        with open(_METRICAS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

_NOTA_NUM = {"C": 0, "B": 1, "A": 2, "AD": 3}
_NOTA_LET = {0: "C", 1: "B", 2: "A", 3: "AD"}


class GenerarPrediccionIn(BaseModel):
    alumno: int


def _promedio_bimestre(notas_bimestre: list) -> float:
    """Promedio numérico (0-3) de una lista de notas literales."""
    if not notas_bimestre:
        return 0.0
    return sum(_NOTA_NUM.get(n, 0) for n in notas_bimestre) / len(notas_bimestre)


def _nivel_tdah(hi_total: int, da_total: int) -> str:
    if hi_total > 10 or da_total > 10:
        return "Con TDAH"
    if hi_total >= 7 or da_total >= 7:
        return "Sospechoso de TDAH"
    return "Sin TDAH"


def _nivel_tdah_prob(prob: float) -> str:
    """Nivel de TDAH a partir de la probabilidad combinada (EDAH + rendimiento académico)."""
    if prob > 0.66:
        return "Con TDAH"
    if prob >= 0.45:
        return "Sospechoso de TDAH"
    return "Sin TDAH"


def _pred_dict(p: PrediccionAcademica, alumno_nombre: str = None) -> dict:
    cond = p.condiciones_psicoeducativas or ""
    fields = {}
    for part in cond.split("|"):
        part = part.strip()
        if ":" in part:
            k, v = part.split(":", 1)
            fields[k.strip()] = v.strip()

    def _int(key, default=None):
        try: return int(fields[key].split("/")[0]) if key in fields else default
        except: return default

    def _float(key, default=None):
        try: return float(fields[key]) if key in fields else default
        except: return default

    hi_total = _int("HI_total")
    da_total = _int("DA_total")
    nivel_tdah = fields.get("Nivel_TDAH") or (
        _nivel_tdah(hi_total or 0, da_total or 0) if (hi_total is not None and da_total is not None) else None
    )

    return {
        "id":                           p.id,
        "alumno":                       p.alumno_id,
        "alumno_nombre":                alumno_nombre,
        "promedio_notas":               p.promedio_notas,
        "nivel_riesgo":                 p.nivel_riesgo,
        "probabilidad":                 p.probabilidad,
        "prediccion_notas":             p.prediccion_notas,
        "condiciones_psicoeducativas":  p.condiciones_psicoeducativas,
        "fecha_prediccion":             p.fecha_prediccion.isoformat() if p.fecha_prediccion else None,
        "nivel_tdah":                   nivel_tdah,
        "confianza_tdah":               _float("Confianza_TDAH"),
        "referencia_psicometrica":      fields.get("Referencia_Psicometrica"),
        "hi_total":                     hi_total,
        "da_total":                     da_total,
        "tc_total":                     _int("TC_total"),
        "inasistencias":                _int("Inasistencias"),
        "nota_b1":                      fields.get("Nota_B1"),
        "nota_b2":                      fields.get("Nota_B2"),
        "nota_b3":                      fields.get("Nota_B3"),
        "nota_b4":                      fields.get("Nota_B4"),
        "promedio_final":               fields.get("Promedio_Final"),
        # compatibilidad con campos anteriores
        "total_atencion":               da_total,
        "total_hiperactividad":         hi_total,
        "prob_tdah":                    _float("Prob_TDAH"),
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


@router.get("/predicciones/{pred_id}/shap/")
def shap_prediccion(pred_id: int, db: Session = Depends(get_db)):
    pred = db.query(PrediccionAcademica).filter(PrediccionAcademica.id == pred_id).first()
    if not pred:
        raise HTTPException(status_code=404, detail="Predicción no encontrada.")

    cond = pred.condiciones_psicoeducativas or ""
    fields = {}
    for part in cond.split("|"):
        part = part.strip()
        if ":" in part:
            k, v = part.split(":", 1)
            fields[k.strip()] = v.strip()

    def _int(key, default=0):
        try: return int(fields[key].split("/")[0]) if key in fields else default
        except: return default

    def _float(key, default=0.0):
        try: return float(fields[key]) if key in fields else default
        except: return default

    # Reconstruir los 20 ítems EDAH desde condiciones_psicoeducativas
    datos = {
        **{f"HI{i}": _int(f"HI{i}") for i in range(1, 6)},
        **{f"DA{i}": _int(f"DA{i}") for i in range(1, 6)},
        **{f"TC{i}": _int(f"TC{i}") for i in range(1, 11)},
    }
    nivel_tdah = fields.get("Nivel_TDAH", "Sin TDAH")
    prob_tdah  = _float("Prob_TDAH")
    return obtener_shap(datos, nivel_tdah, prob_tdah)


@router.get("/predicciones/{pred_id}/shap-riesgo/")
def shap_riesgo(pred_id: int, db: Session = Depends(get_db)):
    """Explicación SHAP del MODELO 2 (Riesgo Académico)."""
    pred = db.query(PrediccionAcademica).filter(PrediccionAcademica.id == pred_id).first()
    if not pred:
        raise HTTPException(status_code=404, detail="Predicción no encontrada.")

    cond = pred.condiciones_psicoeducativas or ""
    fields = {}
    for part in cond.split("|"):
        part = part.strip()
        if ":" in part:
            k, v = part.split(":", 1)
            fields[k.strip()] = v.strip()

    def _float(key, default=0.0):
        try: return float(fields[key]) if key in fields else default
        except: return default
    def _int(key, default=0):
        try: return int(fields[key].split("/")[0]) if key in fields else default
        except: return default

    pf = pred.promedio_notas
    tiene_notas = (fields.get("Promedio_Final", "—") not in ("—", ""))
    return obtener_shap_riesgo(pf, _int("Inasistencias"), _float("Prob_TDAH"),
                               pred.nivel_riesgo or "Bajo", tiene_notas=tiene_notas)


@router.post("/predicciones/generar/")
def generar_prediccion(data: GenerarPrediccionIn, db: Session = Depends(get_db)):
    alumno_id = data.alumno
    alumno = db.query(Alumno).filter(Alumno.id == alumno_id).first()
    if not alumno:
        raise HTTPException(status_code=404, detail="Alumno no encontrado.")

    # ── Encuesta (EDAH + inasistencias) ─────────────────────────────────────
    encuesta = (
        db.query(Encuesta)
        .filter(Encuesta.alumno_id == alumno_id)
        .order_by(Encuesta.fecha_aplicacion.desc())
        .first()
    )
    if not encuesta:
        raise HTTPException(status_code=400,
            detail="No se pudo generar predicción. Registra la encuesta EDAH primero.")

    hi_items = [getattr(encuesta, f"HI{i}") for i in range(1, 6)]
    da_items = [getattr(encuesta, f"DA{i}") for i in range(1, 6)]
    tc_items = [getattr(encuesta, f"TC{i}") for i in range(1, 11)]
    hi_total = sum(hi_items)
    da_total = sum(da_items)
    tc_total = sum(tc_items)
    inasistencias = getattr(encuesta, "inasistencias", 0)

    # ── Notas por bimestre (opcionales) ──────────────────────────────────────
    # La predicción se genera con o sin notas. Si no hay notas, el componente
    # académico queda como "sin dato" y la predicción se apoya en la encuesta EDAH.
    notas = db.query(Nota).filter(Nota.alumno_id == alumno_id).all()

    def _notas_bimestre(b: int) -> list:
        return [n.calificacion_literal for n in notas if getattr(n, "bimestre", 1) == b]

    bimestres = {b: _notas_bimestre(b) for b in (1, 2, 3, 4)}
    todas     = [n.calificacion_literal for n in notas]

    # Valores numéricos para el MODELO: un bimestre SIN nota se pasa como NaN (dato
    # faltante). XGBoost lo trata como "desconocido" y NO lo cuenta como C, de modo
    # que las notas que no registras no inflan el riesgo académico.
    _NAN = float("nan")
    def _num_modelo(notas_b: list) -> float:
        return round(_promedio_bimestre(notas_b), 4) if notas_b else _NAN
    mb1, mb2, mb3, mb4 = (_num_modelo(bimestres[b]) for b in (1, 2, 3, 4))
    m_pf = round(_promedio_bimestre(todas), 4) if todas else _NAN

    # Promedio real de lo registrado (0.0 si no hay nada): solo para mostrar y TDAH.
    pf_num = round(_promedio_bimestre(todas), 4)

    def _letra(val): return _NOTA_LET.get(round(val), "C")

    # Letras para MOSTRAR: reflejan solo lo realmente registrado ("—" si no hay nota).
    def _letra_display(b: int) -> str:
        return _letra(_promedio_bimestre(bimestres[b])) if bimestres[b] else "—"
    nb1, nb2, nb3, nb4 = (_letra_display(b) for b in (1, 2, 3, 4))
    pf_letra = _letra(pf_num) if todas else "—"

    # ── Indicador TDAH: lo decide el MODELO usando SOLO la evaluación EDAH ─────
    # Solo los 20 ítems (DA / HI / TC). Las inasistencias y notas NO influyen aquí,
    # de modo que dos alumnos con el mismo EDAH dan el mismo indicador de TDAH.
    datos = {
        **{f"HI{i}": hi_items[i-1] for i in range(1, 6)},
        **{f"DA{i}": da_items[i-1] for i in range(1, 6)},
        **{f"TC{i}": tc_items[i-1] for i in range(1, 11)},
    }
    tdah            = predecir_tdah(datos)
    nivel_tdah      = tdah["nivel"]          # clase con mayor probabilidad (modelo)
    confianza_tdah  = tdah["confianza"]      # probabilidad de la clase ganadora
    prob_tdah       = tdah["prob_tdah"]      # P(Sospechoso) + P(Con TDAH)

    # ── Riesgo Académico: MODELO 2 (XGBoost) = Notas + Inasistencias + Prob_TDAH ─
    riesgo       = predecir_riesgo(pf_num, inasistencias, prob_tdah, tiene_notas=bool(todas))
    nivel_riesgo = riesgo["nivel"]
    probabilidad = riesgo["probabilidad"]

    # ── Referencia psicométrica (regla EDAH HI>=7 o DA>=7) — SOLO informativa ──
    # Nunca pisa ni altera la salida del modelo; es una nota al pie clínica.
    ref_clinica = _nivel_tdah(hi_total, da_total)
    referencia_psicometrica = f"{ref_clinica} (cribado EDAH HI>=7 o DA>=7)"

    # ── Guardar condiciones (formato parseable por SHAP) ─────────────────────
    condiciones = (
        f"HI_total: {hi_total}/15 | DA_total: {da_total}/15 | TC_total: {tc_total}/30 | "
        + " | ".join(f"HI{i}: {hi_items[i-1]}" for i in range(1, 6)) + " | "
        + " | ".join(f"DA{i}: {da_items[i-1]}" for i in range(1, 6)) + " | "
        + " | ".join(f"TC{i}: {tc_items[i-1]}" for i in range(1, 11)) + " | "
        f"Inasistencias: {inasistencias} | "
        f"Nota_B1: {nb1} | Nota_B2: {nb2} | "
        f"Nota_B3: {nb3} | Nota_B4: {nb4} | "
        f"Promedio_Final: {pf_letra} | "
        f"Nota_B1_Num: {mb1} | Nota_B2_Num: {mb2} | "
        f"Nota_B3_Num: {mb3} | Nota_B4_Num: {mb4} | "
        f"Promedio_Final_Num: {m_pf} | Prob_TDAH: {prob_tdah} | "
        f"Confianza_TDAH: {confianza_tdah} | Nivel_TDAH: {nivel_tdah} | "
        f"Referencia_Psicometrica: {referencia_psicometrica}"
    )

    pred = PrediccionAcademica(
        alumno_id                   = alumno_id,
        promedio_notas              = pf_num,
        nivel_riesgo                = nivel_riesgo,
        probabilidad                = probabilidad,
        prediccion_notas            = pf_letra,
        condiciones_psicoeducativas = condiciones,
    )
    db.add(pred)
    db.commit()
    db.refresh(pred)

    result = _pred_dict(pred, f"{alumno.nombre} {alumno.apellido}")
    result.update({
        "nivel_tdah":   nivel_tdah,
        "confianza_tdah": confianza_tdah,
        "referencia_psicometrica": referencia_psicometrica,
        "hi_total":     hi_total,
        "da_total":     da_total,
        "tc_total":     tc_total,
        "inasistencias": inasistencias,
        "nota_b1":      nb1,
        "nota_b2":      nb2,
        "nota_b3":      nb3,
        "nota_b4":      nb4,
        "promedio_final": pf_letra,
        "prob_tdah":    prob_tdah,
    })
    return result

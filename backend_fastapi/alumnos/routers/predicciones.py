from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel
from database import get_db
from alumnos.models import Alumno, Nota, Encuesta, PrediccionAcademica
from alumnos.ml.prediccion import predecir_riesgo, obtener_shap

router = APIRouter()

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

    # Reconstruir vector de 26 features desde condiciones_psicoeducativas
    hi_items = [_int(f"HI{i}") for i in range(1, 6)]
    da_items = [_int(f"DA{i}") for i in range(1, 6)]
    tc_items = [_int(f"TC{i}") for i in range(1, 11)]

    datos = {
        **{f"HI{i}": hi_items[i-1] for i in range(1, 6)},
        **{f"DA{i}": da_items[i-1] for i in range(1, 6)},
        **{f"TC{i}": tc_items[i-1] for i in range(1, 11)},
        "Inasistencias":    _int("Inasistencias"),
        "Nota_B1_Num":      _float("Nota_B1_Num"),
        "Nota_B2_Num":      _float("Nota_B2_Num"),
        "Nota_B3_Num":      _float("Nota_B3_Num"),
        "Nota_B4_Num":      _float("Nota_B4_Num"),
        "Promedio_Final_Num": _float("Promedio_Final_Num"),
    }
    return obtener_shap(datos, pred.nivel_riesgo or "Bajo", float(pred.probabilidad or 0))


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

    # ── Predicción ───────────────────────────────────────────────────────────
    datos = {
        **{f"HI{i}": hi_items[i-1] for i in range(1, 6)},
        **{f"DA{i}": da_items[i-1] for i in range(1, 6)},
        **{f"TC{i}": tc_items[i-1] for i in range(1, 11)},
        "Inasistencias":      inasistencias,
        "Nota_B1_Num":        mb1,
        "Nota_B2_Num":        mb2,
        "Nota_B3_Num":        mb3,
        "Nota_B4_Num":        mb4,
        "Promedio_Final_Num": m_pf,
    }
    nivel_riesgo, probabilidad = predecir_riesgo(datos)

    # ── Indicador TDAH ────────────────────────────────────────────────────────
    # Base: encuesta EDAH (atención/hiperactividad). Si hay notas, el rendimiento
    # académico también influye: a peor promedio, mayor indicio de TDAH.
    edah_prob = max(hi_total, da_total) / 15.0
    if todas:
        acad_factor = (3.0 - pf_num) / 3.0          # 0 (AD, mejor) … 1 (C, peor)
        prob_tdah   = round(min(1.0, 0.70 * edah_prob + 0.30 * acad_factor), 4)
        nivel_tdah  = _nivel_tdah_prob(prob_tdah)
    else:
        prob_tdah   = round(edah_prob, 4)
        nivel_tdah  = _nivel_tdah(hi_total, da_total)

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
        f"Promedio_Final_Num: {m_pf} | Prob_TDAH: {prob_tdah} | Nivel_TDAH: {nivel_tdah}"
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

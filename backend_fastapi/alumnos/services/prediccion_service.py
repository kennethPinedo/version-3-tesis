"""Servicio de predicción.

Centraliza la generación de la predicción de un alumno para que la consuman
todos los puntos de entrada que modifican su vector de características:

  - POST  /predicciones/generar/        (generación manual)
  - PUT   /alumnos/{id}/inasistencias   (módulo Control de Inasistencias)
  - POST  /notas/carga-masiva/          (carga masiva CSV/Excel)

El vector del MODELO 2 (Riesgo Académico) es
[Promedio_Cont, Inasistencias, Prob_TDAH]; al cambiar cualquiera de los tres,
la predicción vigente queda obsoleta y debe regenerarse.
"""
from typing import Dict, List, Optional, Sequence

from fastapi import HTTPException
from sqlalchemy.orm import Session

from alumnos.models import Alumno, Encuesta, Nota, PrediccionAcademica
from alumnos.ml.prediccion import predecir_tdah, predecir_riesgo

NOTA_NUM: Dict[str, int] = {"C": 0, "B": 1, "A": 2, "AD": 3}
NOTA_LET: Dict[int, str] = {0: "C", 1: "B", 2: "A", 3: "AD"}

_NAN = float("nan")


def promedio_bimestre(notas_literales: Sequence[str]) -> float:
    """Promedio numérico (0-3) de una lista de notas literales."""
    if not notas_literales:
        return 0.0
    return sum(NOTA_NUM.get(n, 0) for n in notas_literales) / len(notas_literales)


def nivel_tdah_cribado(hi_total: int, da_total: int) -> str:
    """Regla de cribado EDAH (HI>=7 o DA>=7). SOLO informativa: no decide nada."""
    if hi_total > 10 or da_total > 10:
        return "Con TDAH"
    if hi_total >= 7 or da_total >= 7:
        return "Sospechoso de TDAH"
    return "Sin TDAH"


def _ultima_encuesta(db: Session, alumno_id: int) -> Optional[Encuesta]:
    # Se ordena también por id descendente para desempatar dos encuestas
    # aplicadas el mismo día (fecha_aplicacion es Date, no DateTime).
    return (
        db.query(Encuesta)
        .filter(Encuesta.alumno_id == alumno_id)
        .order_by(Encuesta.fecha_aplicacion.desc(), Encuesta.id.desc())
        .first()
    )


def generar_prediccion_alumno(db: Session, alumno_id: int) -> PrediccionAcademica:
    """Genera y persiste la predicción vigente del alumno.

    Raises:
        HTTPException 404: el alumno no existe.
        HTTPException 400: el alumno aún no tiene encuesta EDAH aplicada.
    """
    alumno = db.query(Alumno).filter(Alumno.id == alumno_id).first()
    if not alumno:
        raise HTTPException(status_code=404, detail="Alumno no encontrado.")

    encuesta = _ultima_encuesta(db, alumno_id)
    if not encuesta:
        raise HTTPException(
            status_code=400,
            detail="No se pudo generar predicción. Registra la encuesta EDAH primero.",
        )

    hi_items: List[int] = [getattr(encuesta, f"HI{i}") for i in range(1, 6)]
    da_items: List[int] = [getattr(encuesta, f"DA{i}") for i in range(1, 6)]
    tc_items: List[int] = [getattr(encuesta, f"TC{i}") for i in range(1, 11)]
    hi_total, da_total, tc_total = sum(hi_items), sum(da_items), sum(tc_items)

    # Las inasistencias vienen del ALUMNO (módulo independiente), no de la encuesta.
    inasistencias = int(getattr(alumno, "inasistencias", 0) or 0)

    # ── Notas por bimestre (opcionales) ──────────────────────────────────────
    notas = db.query(Nota).filter(Nota.alumno_id == alumno_id).all()

    def _notas_bimestre(b: int) -> List[str]:
        return [n.calificacion_literal for n in notas if getattr(n, "bimestre", 1) == b]

    bimestres = {b: _notas_bimestre(b) for b in (1, 2, 3, 4)}
    todas = [n.calificacion_literal for n in notas]

    # Un bimestre SIN nota se guarda como NaN (dato faltante), de modo que las
    # notas no registradas no inflen el riesgo académico.
    def _num_modelo(notas_b: List[str]) -> float:
        return round(promedio_bimestre(notas_b), 4) if notas_b else _NAN

    mb1, mb2, mb3, mb4 = (_num_modelo(bimestres[b]) for b in (1, 2, 3, 4))
    m_pf = round(promedio_bimestre(todas), 4) if todas else _NAN
    pf_num = round(promedio_bimestre(todas), 4)

    def _letra(val: float) -> str:
        return NOTA_LET.get(round(val), "C")

    def _letra_display(b: int) -> str:
        return _letra(promedio_bimestre(bimestres[b])) if bimestres[b] else "—"

    nb1, nb2, nb3, nb4 = (_letra_display(b) for b in (1, 2, 3, 4))
    pf_letra = _letra(pf_num) if todas else "—"

    # ── MODELO 1 — Indicador TDAH: SOLO los 20 ítems EDAH ────────────────────
    datos = {
        **{f"HI{i}": hi_items[i - 1] for i in range(1, 6)},
        **{f"DA{i}": da_items[i - 1] for i in range(1, 6)},
        **{f"TC{i}": tc_items[i - 1] for i in range(1, 11)},
    }
    tdah = predecir_tdah(datos)
    nivel_tdah = tdah["nivel"]
    confianza_tdah = tdah["confianza"]
    prob_tdah = tdah["prob_tdah"]
    # Distribución completa [P(Baja), P(Media), P(Alta)]. Se persiste para que la
    # interfaz pueda graficar lo que el modelo realmente devuelve, en lugar de
    # reconstruir las clases restantes a partir de la confianza.
    p_baja, p_media, p_alta = tdah["proba"]

    # ── MODELO 2 — Riesgo Académico: Notas + Inasistencias + Prob_TDAH ───────
    riesgo = predecir_riesgo(pf_num, inasistencias, prob_tdah, tiene_notas=bool(todas))

    referencia_psicometrica = (
        f"{nivel_tdah_cribado(hi_total, da_total)} (cribado EDAH HI>=7 o DA>=7)"
    )

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
        f"Proba_Baja: {p_baja} | Proba_Media: {p_media} | Proba_Alta: {p_alta} | "
        f"Confianza_TDAH: {confianza_tdah} | Nivel_TDAH: {nivel_tdah} | "
        f"Referencia_Psicometrica: {referencia_psicometrica}"
    )

    pred = PrediccionAcademica(
        alumno_id=alumno_id,
        promedio_notas=pf_num,
        nivel_riesgo=riesgo["nivel"],
        probabilidad=riesgo["probabilidad"],
        prediccion_notas=pf_letra,
        condiciones_psicoeducativas=condiciones,
    )
    db.add(pred)
    db.commit()
    db.refresh(pred)
    return pred


def regenerar_predicciones(db: Session, alumno_ids: Sequence[int]) -> int:
    """Regenera la predicción de varios alumnos. Ignora los que aún no tienen
    encuesta EDAH (no es un error: simplemente todavía no son predecibles).

    Returns:
        Cantidad de predicciones efectivamente regeneradas.
    """
    generadas = 0
    for aid in set(alumno_ids):
        try:
            generar_prediccion_alumno(db, aid)
            generadas += 1
        except HTTPException:
            continue
    return generadas

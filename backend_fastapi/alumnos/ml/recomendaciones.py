"""Motor de recomendaciones — analitica PRESCRIPTIVA.

Cierra la cadena descriptivo -> diagnostico (SHAP) -> predictivo (XGBoost) ->
**prescriptivo**: traduce la salida de los dos modelos en acciones concretas.

Reglas COMPUESTAS (cruzan el indicador de TDAH con el riesgo academico y las
inasistencias) en lugar de umbrales sueltos. El disparador es SIEMPRE la salida
del modelo (`nivel_tdah`, `nivel_riesgo`), nunca un corte paralelo sobre los
totales EDAH: asi el panel de recomendaciones no puede contradecir la prediccion.
"""
from typing import Any, Dict, List, Optional

AVISO_CLINICO = (
    "Estas recomendaciones son orientaciones pedagógicas de apoyo generadas a "
    "partir de un modelo estadístico. El EDAH es un instrumento de CRIBADO, no "
    "de diagnóstico: la clasificación de TDAH no constituye un diagnóstico "
    "clínico y solo un profesional habilitado puede emitirlo. La decisión final "
    "corresponde siempre al equipo psicopedagógico."
)

_PRIORIDAD_LABEL = {
    "critica": "Prioridad crítica",
    "alta": "Prioridad alta",
    "media": "Prioridad media",
    "baja": "Prioridad baja",
}
_ORDEN_PRIORIDAD = {"critica": 0, "alta": 1, "media": 2, "baja": 3}

# Umbral institucional de inasistencias que activa el protocolo de asistencia.
UMBRAL_INASISTENCIAS = 5


def _rec(id_: str, regla: str, prioridad: str, icono: str, titulo: str,
         acciones: List[str], responsable: str) -> Dict[str, Any]:
    return {
        "id": id_,
        "regla": regla,
        "prioridad": prioridad,
        "prioridad_label": _PRIORIDAD_LABEL[prioridad],
        "icono": icono,
        "titulo": titulo,
        "acciones": acciones,
        "responsable": responsable,
    }


def _es_tdah_alta(nivel_tdah: Optional[str]) -> bool:
    n = str(nivel_tdah or "")
    return "Alta" in n or n == "Con TDAH"


def _es_tdah_media(nivel_tdah: Optional[str]) -> bool:
    n = str(nivel_tdah or "")
    return "Media" in n or n.startswith("Sospechoso")


def generar_recomendaciones(
    nivel_tdah: Optional[str],
    nivel_riesgo: Optional[str],
    da_total: int = 0,
    hi_total: int = 0,
    tc_total: int = 0,
    inasistencias: int = 0,
    promedio_final: str = "—",
) -> Dict[str, Any]:
    """Devuelve el plan de accion prescriptivo del alumno.

    Args:
        nivel_tdah: salida del MODELO 1 ("Sospecha Baja|Media|Alta").
        nivel_riesgo: salida del MODELO 2 ("Bajo|Medio|Alto").
        da_total / hi_total / tc_total: totales EDAH (contexto, no disparadores).
        inasistencias: dias acumulados del modulo Control de Inasistencias.
        promedio_final: nota literal del promedio ("AD|A|B|C|—").
    """
    tdah_alta = _es_tdah_alta(nivel_tdah)
    tdah_media = _es_tdah_media(nivel_tdah)
    riesgo_alto = nivel_riesgo == "Alto"
    riesgo_medio = nivel_riesgo == "Medio"
    da_predominante = da_total > hi_total
    inasistencias_criticas = inasistencias > UMBRAL_INASISTENCIAS

    recs: List[Dict[str, Any]] = []

    # REGLA COMPUESTA 3 (convergencia): mayor prioridad, se evalua primero.
    if tdah_alta and riesgo_alto:
        recs.append(_rec(
            "convergencia_tdah_riesgo",
            "Probabilidad Alta de TDAH + Riesgo Académico Alto",
            "critica", "🚨",
            "Derivación prioritaria a psicopedagogía",
            [
                "Derivar de forma prioritaria al área de psicopedagogía para evaluar "
                "adaptaciones curriculares no significativas (tiempo adicional, "
                "formato de evaluación, cantidad de ítems).",
                "Programar evaluación tutorial coordinada entre tutor, docente de "
                "aula y psicólogo, con acta de acuerdos.",
                "Establecer un cronograma de seguimiento con revisión al cierre de "
                "cada bimestre.",
            ],
            "Equipo psicopedagógico (coordina tutor)",
        ))

    # REGLA COMPUESTA 1: TDAH alto con deficit de atencion predominante.
    if tdah_alta and da_predominante:
        recs.append(_rec(
            "tdah_alta_da_predominante",
            "Probabilidad Alta de TDAH + Déficit de Atención predominante",
            "alta", "🧩",
            "Adecuación del entorno y de la consigna en aula",
            [
                "Fragmentar las tareas en bloques cortos (10-15 min) con pausas "
                "activas entre bloques.",
                "Ubicar al estudiante en primera fila, lejos de ventanas, puertas y "
                "zonas de tránsito.",
                "Entregar consignas visuales paso a paso (apoyo gráfico o lista de "
                "cotejo), verificando la comprensión antes de iniciar.",
            ],
            "Docente de aula",
        ))

    # Complemento: TDAH alto pero con hiperactividad/impulsividad predominante.
    if tdah_alta and not da_predominante:
        recs.append(_rec(
            "tdah_alta_hi_predominante",
            "Probabilidad Alta de TDAH + Hiperactividad/Impulsividad predominante",
            "alta", "🏃",
            "Estrategias de autorregulación y manejo de impulsos",
            [
                "Incorporar pausas activas y encargos de movimiento con propósito "
                "(repartir materiales, borrar la pizarra) cada 15-20 minutos.",
                "Acordar señales no verbales de autocontrol pactadas con el "
                "estudiante para redirigir sin exponerlo ante el grupo.",
                "Aplicar talleres de manejo de impulsos y espera de turnos.",
            ],
            "Docente de aula / tutor",
        ))

    # REGLA COMPUESTA 2: riesgo academico alto con inasistencias elevadas.
    if riesgo_alto and inasistencias_criticas:
        recs.append(_rec(
            "riesgo_alto_inasistencias",
            f"Riesgo Académico Alto + Inasistencias > {UMBRAL_INASISTENCIAS}",
            "alta", "📉",
            "Plan de nivelación y protocolo de asistencia",
            [
                "Elaborar un plan de nivelación curricular bimestral con metas por "
                "asignatura y fecha de verificación.",
                "Citar preventivamente a los apoderados para comunicar el riesgo y "
                "firmar compromiso de asistencia.",
                "Abrir ficha de seguimiento de asistencia diaria con reporte semanal "
                "al tutor.",
            ],
            "Tutor / docente de aula",
        ))

    # Reglas de cobertura: el plan nunca queda vacio ni contradice al modelo.
    if tdah_media and not tdah_alta:
        recs.append(_rec(
            "tdah_media_seguimiento",
            "Probabilidad Media de TDAH",
            "media", "🔎",
            "Observación sistemática y seguimiento",
            [
                "Registrar observaciones de aula durante 4 semanas (atención "
                "sostenida, finalización de tareas, autorregulación).",
                "Reaplicar el EDAH al cierre del período de observación para "
                "contrastar la evolución.",
                "Anticipar apoyos de organización: agenda visible y verificación de "
                "materiales al inicio de la jornada.",
            ],
            "Psicólogo / tutor",
        ))

    if riesgo_alto and not inasistencias_criticas:
        recs.append(_rec(
            "riesgo_alto_academico",
            "Riesgo Académico Alto",
            "alta", "📚",
            "Refuerzo académico focalizado",
            [
                "Priorizar las asignaturas con calificación C en un plan de refuerzo "
                "de corto plazo.",
                "Coordinar con la familia el acompañamiento de tareas en casa.",
                "Monitorear el rendimiento de forma continua y registrar avances.",
            ],
            "Docente de aula",
        ))

    if riesgo_medio:
        recs.append(_rec(
            "riesgo_medio_monitoreo",
            "Riesgo Académico Medio",
            "media", "📊",
            "Monitoreo periódico del rendimiento",
            [
                "Revisar el promedio al cierre de cada bimestre y comparar la "
                "tendencia con el bimestre anterior.",
                "Reforzar hábitos de estudio y entrega puntual de tareas.",
            ],
            "Docente de aula",
        ))

    if inasistencias_criticas and not riesgo_alto:
        recs.append(_rec(
            "inasistencias_alerta",
            f"Inasistencias > {UMBRAL_INASISTENCIAS} sin riesgo académico alto",
            "media", "🗓️",
            "Alerta preventiva de asistencia",
            [
                f"Verificar el motivo de las {inasistencias} inasistencias "
                "acumuladas y registrarlo en la ficha del estudiante.",
                "Comunicar a los apoderados antes de que el ausentismo impacte el "
                "rendimiento.",
            ],
            "Tutor",
        ))

    if not recs:
        recs.append(_rec(
            "sin_alertas",
            "Sin indicadores de riesgo",
            "baja", "✅",
            "Continuar con el plan regular",
            [
                "Mantener las actividades regulares y el registro periódico de notas "
                "e inasistencias.",
                "Reaplicar el EDAH al cierre del año escolar como control.",
            ],
            "Docente de aula",
        ))

    recs.sort(key=lambda r: _ORDEN_PRIORIDAD[r["prioridad"]])

    return {
        "contexto": {
            "nivel_tdah": nivel_tdah,
            "nivel_riesgo": nivel_riesgo,
            "da_total": da_total,
            "hi_total": hi_total,
            "tc_total": tc_total,
            "inasistencias": inasistencias,
            "promedio_final": promedio_final,
            "factor_edah_predominante": (
                "Déficit de Atención" if da_predominante
                else "Hiperactividad/Impulsividad"
            ),
            "convergencia": bool(tdah_alta and riesgo_alto),
        },
        "recomendaciones": recs,
        "aviso": AVISO_CLINICO,
    }

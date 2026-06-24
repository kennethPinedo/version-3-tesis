import os
import joblib
import numpy as np
from xgboost import XGBClassifier
import shap

_MODELO_PATH = os.path.join(os.path.dirname(__file__), "modelo_xgb.pkl")

if os.path.exists(_MODELO_PATH):
    modelo     = joblib.load(_MODELO_PATH)
    _explainer = shap.TreeExplainer(modelo)
else:
    modelo     = None
    _explainer = None
    print("AVISO: Modelo no encontrado. Ejecuta entrenar_modelo.py primero.")

# ── MODELO 2: Riesgo Académico (Notas + Inasistencias + Prob_TDAH) ────────────
_MODELO_RIESGO_PATH = os.path.join(os.path.dirname(__file__), "modelo_riesgo_xgb.pkl")
if os.path.exists(_MODELO_RIESGO_PATH):
    modelo_riesgo     = joblib.load(_MODELO_RIESGO_PATH)
    _explainer_riesgo = shap.TreeExplainer(modelo_riesgo)
else:
    modelo_riesgo     = None
    _explainer_riesgo = None
    print("AVISO: Modelo de riesgo no encontrado. Ejecuta entrenar_riesgo.py.")

_RIESGO_LABELS   = {0: "Bajo", 1: "Medio", 2: "Alto"}
_RIESGO_IDX      = {"Bajo": 0, "Medio": 1, "Alto": 2}
_FEATURES_RIESGO = ["Promedio_Final_Num", "Inasistencias", "Prob_TDAH"]

# El indicador de TDAH se determina SOLO con la evaluación EDAH (20 ítems):
# Item_01-05 = HI1-HI5 (Hiperactividad/Impulsividad)
# Item_06-10 = DA1-DA5 (Déficit de Atención)
# Item_11-20 = TC1-TC10 (Trastornos de Conducta)
# Las inasistencias y notas NO entran aquí (van en el Riesgo Académico).
_FEATURE_NAMES = [f"Item_{str(i).zfill(2)}" for i in range(1, 21)]

# El indicador de TDAH se expresa como nivel de SOSPECHA (Baja / Media / Alta).
# Clase 0 = sin indicios, 1 = indicios moderados, 2 = indicios altos.
_TDAH_LABELS = {0: "Sospecha Baja", 1: "Sospecha Media", 2: "Sospecha Alta"}
_CLASE_IDX   = {"Sospecha Baja": 0, "Sospecha Media": 1, "Sospecha Alta": 2}


def _build_vector(datos: dict) -> list:
    """Vector de 20 ítems EDAH (HI + DA + TC) en el orden de entrenamiento."""
    hi = [datos[f"HI{i}"] for i in range(1, 6)]   # → Item_01-05
    da = [datos[f"DA{i}"] for i in range(1, 6)]   # → Item_06-10
    tc = [datos[f"TC{i}"] for i in range(1, 11)]  # → Item_11-20
    return hi + da + tc


def predecir_tdah(datos: dict) -> dict:
    """Clasificación de TDAH según el MODELO (XGBoost) usando SOLO la evaluación EDAH.

    Retorna:
      - nivel:     clase con mayor probabilidad ∈ {"Sin TDAH","Sospechoso","Con TDAH"}.
      - confianza: probabilidad de la clase ganadora.
      - prob_tdah: P(Sospechoso) + P(Con TDAH) = probabilidad de presentar TDAH.
      - proba:     [P(Sin), P(Sospechoso), P(Con)].
    """
    if modelo is None:
        return {"nivel": "Sin TDAH", "confianza": 0.0, "prob_tdah": 0.0, "proba": [1.0, 0.0, 0.0]}
    X     = np.array([_build_vector(datos)])
    proba = modelo.predict_proba(X)[0]            # [P(Sin), P(Sospechoso), P(Con)]
    clase = int(np.argmax(proba))
    return {
        "nivel":     _TDAH_LABELS[clase],
        "confianza": round(float(proba[clase]), 4),
        "prob_tdah": round(float(proba[1] + proba[2]), 4),
        "proba":     [round(float(p), 4) for p in proba],
    }


def obtener_shap(datos: dict, nivel_tdah: str, prob_tdah: float = 0.0) -> dict:
    """Explica la clasificación de TDAH según el aporte de cada subescala EDAH."""
    if _explainer is None:
        return {"nivel": nivel_tdah, "base_value": 0.0, "features": [], "interpretacion": ""}

    X         = np.array([_build_vector(datos)])
    shap_vals = _explainer.shap_values(X)
    class_idx = _CLASE_IDX.get(nivel_tdah, 0)
    ev        = _explainer.expected_value

    # Explicar sobre el EJE "tendencia a TDAH" = contribución a NO ser «Sospecha Baja»
    # (= -SHAP de la clase 0). Así un valor alto en DA/HI se muestra SIEMPRE como
    # "aumenta TDAH" y uno bajo como "reduce" (intuitivo para el psicólogo), evitando
    # los signos confusos del SHAP de una sola clase en modelos multiclase.
    def _sv(ci):
        if isinstance(shap_vals, list):
            return np.asarray(shap_vals[ci][0], dtype=float)
        if getattr(shap_vals, "ndim", 0) == 3:
            return np.asarray(shap_vals[0, :, ci], dtype=float)
        return np.asarray(shap_vals[0], dtype=float)
    sv   = -_sv(0)
    base = float(ev[class_idx]) if hasattr(ev, "__len__") else float(ev)

    hi_total = sum(datos[f"HI{i}"] for i in range(1, 6))
    da_total = sum(datos[f"DA{i}"] for i in range(1, 6))
    tc_total = sum(datos[f"TC{i}"] for i in range(1, 11))

    shap_hi = round(float(sum(sv[0:5])),   4)
    shap_da = round(float(sum(sv[5:10])),  4)
    shap_tc = round(float(sum(sv[10:20])), 4)

    def _dir(s):
        return "↑ Aumenta TDAH" if s > 0 else "↓ Reduce TDAH"

    features = [
        {"feature": "da", "label": "Déficit de Atención (DA)",        "value_fmt": f"{da_total}/15", "shap": shap_da, "direccion": _dir(shap_da)},
        {"feature": "hi", "label": "Hiperactividad/Impulsividad (HI)", "value_fmt": f"{hi_total}/15", "shap": shap_hi, "direccion": _dir(shap_hi)},
        {"feature": "tc", "label": "Trastornos de Conducta (TC)",      "value_fmt": f"{tc_total}/30", "shap": shap_tc, "direccion": _dir(shap_tc)},
    ]
    features.sort(key=lambda f: abs(f["shap"]), reverse=True)

    interpretacion = _generar_interpretacion(nivel_tdah, hi_total, da_total, tc_total, prob_tdah)
    return {
        "nivel":          nivel_tdah,
        "base_value":     round(base, 4),
        "features":       features,
        "interpretacion": interpretacion,
    }


def _generar_interpretacion(nivel: str, hi_total: int, da_total: int, tc_total: int, prob_tdah: float = 0.0) -> str:
    prob_pct = round(prob_tdah * 100, 1)

    def nivel_sub(v: int, mx: int) -> str:
        r = v / mx
        if r >= 0.60: return "elevado"
        if r >= 0.45: return "moderado"
        return "bajo"

    da_n = nivel_sub(da_total, 15)
    hi_n = nivel_sub(hi_total, 15)
    tc_n = nivel_sub(tc_total, 30)

    p1 = (
        f"La evaluación EDAH muestra Déficit de Atención {da_n} ({da_total}/15), "
        f"Hiperactividad/Impulsividad {hi_n} ({hi_total}/15) y Trastornos de Conducta {tc_n} ({tc_total}/30). "
        f"El déficit de atención y la hiperactividad/impulsividad son los indicadores nucleares del TDAH; "
        f"la conducta es un factor secundario."
    )

    if nivel == "Sospecha Alta":
        p2 = (f"Los indicadores nucleares (atención e hiperactividad) son altos, por lo que el modelo "
              f"estima una «Sospecha Alta» de TDAH (probabilidad: {prob_pct}%); se recomienda "
              f"evaluación diagnóstica especializada.")
    elif nivel == "Sospecha Media":
        p2 = (f"Los indicadores de atención e hiperactividad son moderados, por lo que el modelo estima "
              f"una «Sospecha Media» de TDAH ({prob_pct}%); conviene seguimiento y evaluación.")
    else:
        p2 = (f"Los indicadores nucleares del TDAH son bajos, por lo que el modelo estima una "
              f"«Sospecha Baja» de TDAH (probabilidad: {prob_pct}%).")

    return p1 + "\n\n" + p2


# ══════════════════════════════════════════════════════════════════════════════
#  MODELO 2 — RIESGO ACADÉMICO (XGBoost + SHAP)
# ══════════════════════════════════════════════════════════════════════════════

def _num_a_letra(val: float) -> str:
    try:
        if val != val:  # NaN
            return "—"
    except Exception:
        return "—"
    if val >= 2.5: return "AD"
    if val >= 1.5: return "A"
    if val >= 0.5: return "B"
    return "C"


def predecir_riesgo(promedio_num: float, inasistencias: int, prob_tdah: float,
                    tiene_notas: bool = True) -> dict:
    """Riesgo Académico según el MODELO 2 (XGBoost) usando Notas + Inasistencias + Prob_TDAH.

    Retorna: nivel ∈ {Bajo, Medio, Alto}, probabilidad (score 0-1), confianza, proba[3].
    """
    if modelo_riesgo is None:
        return {"nivel": "Bajo", "probabilidad": 0.0, "confianza": 0.0, "proba": [1.0, 0.0, 0.0]}
    pf = float(promedio_num) if tiene_notas else float("nan")
    X  = np.array([[pf, float(inasistencias), float(prob_tdah)]])
    proba = modelo_riesgo.predict_proba(X)[0]
    clase = int(np.argmax(proba))
    score = round(0.5 * float(proba[1]) + float(proba[2]), 4)   # 0 (Bajo) … 1 (Alto)
    return {
        "nivel":        _RIESGO_LABELS[clase],
        "probabilidad": score,
        "confianza":    round(float(proba[clase]), 4),
        "proba":        [round(float(p), 4) for p in proba],
    }


def obtener_shap_riesgo(promedio_num: float, inasistencias: int, prob_tdah: float,
                        nivel: str, tiene_notas: bool = True) -> dict:
    """Explica el Riesgo Académico (aporte de Notas, Inasistencias y Prob_TDAH)."""
    if _explainer_riesgo is None:
        return {"nivel": nivel, "features": [], "interpretacion": ""}
    pf = float(promedio_num) if tiene_notas else float("nan")
    X  = np.array([[pf, float(inasistencias), float(prob_tdah)]])
    sv = _explainer_riesgo.shap_values(X)
    # Explicar sobre el EJE de RIESGO = contribución a NO ser «Bajo» (= -SHAP de la
    # clase 0). Así un factor que eleva el riesgo (peores notas, más faltas, más TDAH)
    # se muestra SIEMPRE como "aumenta riesgo", coherente con el indicador e intuitivo.
    def _s(ci):
        if isinstance(sv, list):
            return np.asarray(sv[ci][0], dtype=float)
        if getattr(sv, "ndim", 0) == 3:
            return np.asarray(sv[0, :, ci], dtype=float)
        return np.asarray(sv[0], dtype=float)
    s = -_s(0)

    labels = {"Promedio_Final_Num": "Rendimiento (notas)", "Inasistencias": "Inasistencias",
              "Prob_TDAH": "Probabilidad de TDAH"}
    vals   = {"Promedio_Final_Num": _num_a_letra(pf) if tiene_notas else "Sin notas",
              "Inasistencias": str(int(inasistencias)),
              "Prob_TDAH": f"{round(prob_tdah * 100)}%"}
    feats = []
    for i, fn in enumerate(_FEATURES_RIESGO):
        feats.append({
            "feature":   fn,
            "label":     labels[fn],
            "value_fmt": vals[fn],
            "shap":      round(float(s[i]), 4),
            "direccion": "↑ Aumenta riesgo" if s[i] > 0 else "↓ Reduce riesgo",
        })
    feats.sort(key=lambda f: abs(f["shap"]), reverse=True)
    top = feats[0]
    interp = (f"El modelo estima un Riesgo Académico {nivel}. El factor más influyente es "
              f"{top['label']} ({top['value_fmt']}). El riesgo integra el rendimiento académico, "
              f"las inasistencias y la probabilidad de TDAH.")
    return {"nivel": nivel, "features": feats, "interpretacion": interp}

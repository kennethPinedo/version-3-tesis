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

_RIESGO_MAP = {0: "Bajo", 1: "Medio", 2: "Alto"}
_CLASE_IDX  = {"Bajo": 0, "Medio": 1, "Alto": 2}

# Orden exacto de features con el que fue entrenado el modelo
# Item_01-05 = HI1-HI5 (Hiperactividad)
# Item_06-10 = DA1-DA5 (Déficit de Atención)
# Item_11-20 = TC1-TC10 (Trastorno de Conducta)
_FEATURE_NAMES = [
    "Item_01", "Item_02", "Item_03", "Item_04", "Item_05",
    "Item_06", "Item_07", "Item_08", "Item_09", "Item_10",
    "Item_11", "Item_12", "Item_13", "Item_14", "Item_15",
    "Item_16", "Item_17", "Item_18", "Item_19", "Item_20",
    "Inasistencias",
    "Nota_B1_Num", "Nota_B2_Num", "Nota_B3_Num", "Nota_B4_Num",
    "Promedio_Final_Num",
]

_NOTA_NUM = {"C": 0, "B": 1, "A": 2, "AD": 3}


def _build_vector(datos: dict) -> list:
    """Construye el vector de 26 features en el orden correcto."""
    hi = [datos[f"HI{i}"] for i in range(1, 6)]   # → Item_01-05
    da = [datos[f"DA{i}"] for i in range(1, 6)]   # → Item_06-10
    tc = [datos[f"TC{i}"] for i in range(1, 11)]  # → Item_11-20
    return hi + da + tc + [
        datos["Inasistencias"],
        datos["Nota_B1_Num"],
        datos["Nota_B2_Num"],
        datos["Nota_B3_Num"],
        datos["Nota_B4_Num"],
        datos["Promedio_Final_Num"],
    ]


def predecir_riesgo(datos: dict) -> tuple:
    """Retorna (nivel: str, score: float). nivel ∈ {Bajo, Medio, Alto}."""
    if modelo is None:
        return "Bajo", 0.0
    X    = np.array([_build_vector(datos)])
    prob = modelo.predict_proba(X)[0]
    # Score ponderado: clase 1 (Sospechoso/Medio) cuenta 0.5, clase 2 (TDAH/Alto) cuenta 1.0
    score = round(0.5 * float(prob[1]) + float(prob[2]), 4)
    if score <= 0.33:
        nivel = "Bajo"
    elif score <= 0.66:
        nivel = "Medio"
    else:
        nivel = "Alto"
    return nivel, score


def obtener_shap(datos: dict, nivel_predicho: str, probabilidad: float = 0.0) -> dict:
    if _explainer is None:
        return {"nivel": nivel_predicho, "base_value": 0.0, "features": [], "interpretacion": ""}

    X         = np.array([_build_vector(datos)])
    shap_vals = _explainer.shap_values(X)
    class_idx = _CLASE_IDX.get(nivel_predicho, 0)
    ev        = _explainer.expected_value

    if isinstance(shap_vals, list):
        sv   = shap_vals[class_idx][0]
        base = float(ev[class_idx]) if hasattr(ev, "__len__") else float(ev)
    elif shap_vals.ndim == 3:
        sv   = shap_vals[0, :, class_idx]
        base = float(ev[class_idx]) if hasattr(ev, "__len__") else float(ev)
    else:
        sv   = shap_vals[0]
        base = float(ev[class_idx]) if hasattr(ev, "__len__") else float(ev)

    # ── Agrupación en 3 bloques temáticos ────────────────────────────────────
    # [0-4]   HI  → Hiperactividad
    # [5-9]   DA  → Déficit de Atención
    # [10-19] TC  → Trastorno de Conducta
    # [20]    Inasistencias
    # [21-25] Notas B1-B4 + Promedio Final

    hi_total  = sum(datos[f"HI{i}"] for i in range(1, 6))
    da_total  = sum(datos[f"DA{i}"] for i in range(1, 6))
    tc_total  = sum(datos[f"TC{i}"] for i in range(1, 11))

    shap_hi    = round(float(sum(sv[0:5])),   4)
    shap_da    = round(float(sum(sv[5:10])),  4)
    shap_tc    = round(float(sum(sv[10:20])), 4)
    shap_edah  = round(shap_hi + shap_da + shap_tc, 4)  # bloque TDAH unificado
    shap_inast = round(float(sv[20]), 4)
    shap_notas = round(float(sum(sv[21:26])), 4)

    promedio_num = datos.get("Promedio_Final_Num", 0)

    features = [
        {
            "feature":   "edah",
            "label":     "Indicadores TDAH (EDAH)",
            "value_fmt": f"HI:{hi_total}/15  DA:{da_total}/15  TC:{tc_total}/30",
            "shap":      shap_edah,
            "direccion": "↑ Aumenta riesgo" if shap_edah > 0 else "↓ Reduce riesgo",
        },
        {
            "feature":   "inasistencias",
            "label":     "Inasistencias",
            "value_fmt": str(int(datos["Inasistencias"])),
            "shap":      shap_inast,
            "direccion": "↑ Aumenta riesgo" if shap_inast > 0 else "↓ Reduce riesgo",
        },
        {
            "feature":   "notas",
            "label":     "Rendimiento Académico",
            "value_fmt": _num_a_letra(promedio_num),
            "shap":      shap_notas,
            "direccion": "↑ Aumenta riesgo" if shap_notas > 0 else "↓ Reduce riesgo",
        },
    ]
    features.sort(key=lambda f: abs(f["shap"]), reverse=True)

    interpretacion = _generar_interpretacion(nivel_predicho, features, datos, probabilidad)
    return {
        "nivel":          nivel_predicho,
        "base_value":     round(base, 4),
        "features":       features,
        "interpretacion": interpretacion,
    }


def _num_a_letra(val: float) -> str:
    if val >= 2.5: return "AD"
    if val >= 1.5: return "A"
    if val >= 0.5: return "B"
    return "C"


def _generar_interpretacion(nivel: str, features: list, datos: dict, probabilidad: float = 0.0) -> str:
    prob_pct = round(probabilidad * 100, 1)

    hi_total  = sum(datos[f"HI{i}"] for i in range(1, 6))
    da_total  = sum(datos[f"DA{i}"] for i in range(1, 6))
    tc_total  = sum(datos[f"TC{i}"] for i in range(1, 11))
    inasist   = int(datos["Inasistencias"])
    prom_num  = datos.get("Promedio_Final_Num", 0)
    prom_letra = _num_a_letra(prom_num)

    def edah_nivel():
        total_edah = hi_total + da_total + tc_total
        if total_edah >= 35: return "elevados"
        if total_edah >= 20: return "moderados"
        return "bajos"

    def inasist_nivel():
        if inasist >= 15: return "alta"
        if inasist >= 8:  return "moderada"
        return "baja"

    def prom_nivel():
        if prom_letra == "AD": return "excelente (AD)"
        if prom_letra == "A":  return "bueno (A)"
        if prom_letra == "B":  return "en proceso (B)"
        return "en inicio (C)"

    # EDAH siempre primero — es la variable central del modelo
    edah_f  = next((f for f in features if f["feature"] == "edah"), None)
    other_f = [f for f in features if f["feature"] != "edah"]

    paragraphs = []

    # ── Párrafo 1: indicadores EDAH ─────────────────────────────────────────
    if edah_f:
        nd  = edah_nivel()
        inc = edah_f["shap"] > 0
        if inc:
            p1 = (
                f"El estudiante presenta indicadores {nd} en la evaluación EDAH "
                f"(Hiperactividad: {hi_total}/15, Déficit de Atención: {da_total}/15, "
                f"Trastorno de Conducta: {tc_total}/30), constituyendo el factor central "
                f"que influye en el incremento del riesgo académico estimado por el modelo."
            )
        else:
            p1 = (
                f"El estudiante presenta indicadores {nd} en la evaluación EDAH "
                f"(Hiperactividad: {hi_total}/15, Déficit de Atención: {da_total}/15, "
                f"Trastorno de Conducta: {tc_total}/30), siendo el elemento de mayor "
                f"influencia en la reducción del riesgo académico estimado."
            )
        paragraphs.append(p1)

    # ── Párrafo 2: factores secundarios ─────────────────────────────────────
    if other_f:
        parts = []
        for f in other_f:
            name = f["feature"]
            inc  = f["shap"] > 0
            if name == "inasistencias":
                nd_i = inasist_nivel()
                if inc:
                    parts.append(
                        f"la {nd_i} cantidad de inasistencias ({inasist} días) "
                        f"representa un factor adicional de riesgo"
                    )
                else:
                    parts.append(
                        f"la {nd_i} cantidad de inasistencias ({inasist} días) "
                        f"contribuye a mitigar el riesgo estimado"
                    )
            elif name == "notas":
                nd_p = prom_nivel()
                if inc:
                    if prom_letra in ("A", "AD"):
                        parts.append(
                            f"el {nd_p} rendimiento académico no logra compensar "
                            f"completamente los demás factores de riesgo presentes"
                        )
                    else:
                        parts.append(
                            f"el rendimiento académico {nd_p} representa "
                            f"un factor adicional de riesgo"
                        )
                else:
                    parts.append(
                        f"el {nd_p} rendimiento académico contribuye a "
                        f"mitigar el riesgo estimado"
                    )

        if len(parts) == 1:
            connector = "Asimismo" if other_f[0]["shap"] > 0 else "Por otro lado"
            paragraphs.append(f"{connector}, {parts[0]}.")
        elif len(parts) == 2:
            same_dir = (other_f[0]["shap"] > 0) == (other_f[1]["shap"] > 0)
            joiner   = "así como" if same_dir else "mientras que"
            paragraphs.append(f"Adicionalmente, {parts[0]}, {joiner} {parts[1]}.")

    # ── Párrafo final ────────────────────────────────────────────────────────
    paragraphs.append(
        f"En consecuencia, el sistema clasifica al estudiante con un nivel de "
        f"Riesgo Académico {nivel} ({prob_pct}%)."
    )

    return "\n\n".join(paragraphs)

import os
import joblib
import numpy as np
from xgboost import XGBClassifier

_MODELO_PATH = os.path.join(os.path.dirname(__file__), "modelo_xgb.pkl")

if os.path.exists(_MODELO_PATH):
    modelo = joblib.load(_MODELO_PATH)
else:
    modelo = None
    print("AVISO: Modelo no encontrado en alumnos/ml/modelo_xgb.pkl.")

# Features: DA_total, HI_total, promedio_notas, condicion_social (0-24)
_RIESGO_MAP = {0: "Bajo", 1: "Medio", 2: "Alto"}


def predecir_riesgo(datos: dict) -> tuple:
    """
    datos: {DA_total, HI_total, promedio_notas, condicion_social}
    Retorna (nivel_riesgo: str, probabilidad: float)
    """
    if modelo is None:
        return "Bajo", 0.0
    X = np.array([[
        datos["DA_total"],
        datos["HI_total"],
        datos["promedio_notas"],
        datos["condicion_social"],
    ]])
    prob  = modelo.predict_proba(X)[0]          # [P(Bajo), P(Medio), P(Alto)]
    score = round(0.5 * float(prob[1]) + float(prob[2]), 4)  # score 0-1 ponderado por severidad

    if score <= 0.33:
        nivel = "Bajo"
    elif score <= 0.66:
        nivel = "Medio"
    else:
        nivel = "Alto"

    return nivel, score

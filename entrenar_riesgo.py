"""
MODELO 2 — RIESGO ACADÉMICO (XGBoost + SHAP)
Predice el Riesgo Académico (Bajo / Medio / Alto) a partir de:
  - Notas (histórico real de la institución)  → Promedio_Final_Num
  - Inasistencias
  - Probabilidad de TDAH (salida del Modelo 1)
Requiere que el modelo de TDAH (modelo_xgb.pkl) ya exista.
"""
import os
import json
import joblib
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import (classification_report, accuracy_score,
                             confusion_matrix, recall_score, precision_score, f1_score)
from sklearn.utils.class_weight import compute_sample_weight
import shap

BASE   = os.path.dirname(__file__)
ML_DIR = os.path.join(BASE, "backend_fastapi", "alumnos", "ml")
CLASES = ["Bajo", "Medio", "Alto"]

df = pd.read_csv(os.path.join(BASE, "dataset_tdah_bimestral_500.csv"))

# ── 1. Probabilidad de TDAH de cada alumno (con el MODELO 1 sobre el EDAH) ─────
modelo_tdah = joblib.load(os.path.join(ML_DIR, "modelo_xgb.pkl"))
edah_cols   = [f"Item_{str(i).zfill(2)}" for i in range(1, 21)]
proba_tdah  = modelo_tdah.predict_proba(df[edah_cols].values)
df["Prob_TDAH"] = proba_tdah[:, 1] + proba_tdah[:, 2]   # P(Sospechoso)+P(Con TDAH)

# ── 2. Features del riesgo = Notas + Inasistencias + Prob_TDAH ────────────────
# Promedio CONTINUO (media de los 4 bimestres). Coincide con cómo la app calcula
# el promedio en inferencia (media de las notas reales) y con cómo se generó la
# etiqueta de riesgo. Antes se usaba Promedio_Final_Num (entero de la LETRA), lo
# que creaba un desajuste train/inferencia y predicciones erráticas en la frontera
# Bajo/Medio (alumnos con notas A pero promedio 1.6-1.7 saltaban a "Medio").
df["Promedio_Cont"] = df[["Nota_B1_Num", "Nota_B2_Num", "Nota_B3_Num", "Nota_B4_Num"]].mean(axis=1)
FEATURES = ["Promedio_Cont", "Inasistencias", "Prob_TDAH"]
X = df[FEATURES]

# ── Etiqueta de Riesgo (índice compuesto) ─────────────────────────────────────
# Se re-deriva aquí usando la Prob_TDAH CONTINUA del Modelo 1 (no el estado
# entero), de modo que el Modelo 2 consuma explícitamente la salida del Modelo 1.
# Pesos: notas y TDAH altos (0.40 c/u); inasistencias menor pero MONÓTONA (0.20).
# Se conserva un ruido pequeño para que la frontera sea realista (no una regla
# perfecta). Sustituye a la columna Estado_Riesgo del dataset (queda como legado).
np.random.seed(7)
_acad = (3.0 - df["Promedio_Cont"]) / 3.0              # 0 (AD, mejor) … 1 (C, peor)
_inas = np.minimum(df["Inasistencias"] / 20.0, 1.0)   # 0 … 1
_tdah = df["Prob_TDAH"]                                # 0 … 1 (continuo, Modelo 1)
_score = 0.40 * _acad + 0.20 * _inas + 0.40 * _tdah + np.random.normal(0, 0.06, len(df))
y = pd.Series(np.where(_score < 0.40, 0, np.where(_score < 0.66, 1, 2)), index=df.index)
print(f"Features riesgo: {FEATURES}")
print(f"Distribución Riesgo (0=Bajo,1=Medio,2=Alto):\n{y.value_counts().sort_index()}\n")

X_train, X_val, y_train, y_val = train_test_split(
    X, y, test_size=0.20, random_state=42, stratify=y
)
sample_weight = compute_sample_weight(class_weight="balanced", y=y_train)

# ── 3. Entrenamiento XGBoost ──────────────────────────────────────────────────
# Pesos por variable: priorizar Notas y Prob_TDAH; las Inasistencias pesan menos
# pero lo suficiente para que su efecto sea MONÓTONO (más faltas = más riesgo) y
# no quede como ruido (antes 0.6 generaba el comportamiento al revés).
# Orden de features: [Promedio_Cont, Inasistencias, Prob_TDAH]
FEATURE_WEIGHTS = np.array([2.5, 1.3, 2.5], dtype=float)

modelo = XGBClassifier(
    objective="multi:softprob", num_class=3,
    n_estimators=400, learning_rate=0.05, max_depth=3,
    subsample=0.8, colsample_bytree=0.7, min_child_weight=5,
    gamma=0.2, reg_alpha=0.3, reg_lambda=2.0,
    eval_metric="mlogloss", early_stopping_rounds=40, random_state=7,
)
modelo.fit(X_train, y_train, sample_weight=sample_weight,
           feature_weights=FEATURE_WEIGHTS,
           eval_set=[(X_val, y_val)], verbose=False)

# ── 4. Evaluación ─────────────────────────────────────────────────────────────
y_pred_tr = modelo.predict(X_train)
y_pred_va = modelo.predict(X_val)
acc_tr = accuracy_score(y_train, y_pred_tr)
acc_va = accuracy_score(y_val,   y_pred_va)
print(f"Accuracy  Train: {acc_tr:.4f}  Val: {acc_va:.4f}  (brecha: {acc_tr-acc_va:.4f})")
print("\n--- Reporte Riesgo (Validación) ---")
print(classification_report(y_val, y_pred_va, target_names=CLASES))
print("Importancia de variables:")
for f, imp in sorted(zip(FEATURES, modelo.feature_importances_), key=lambda x: -x[1]):
    print(f"  {f:<22} {imp*100:5.1f}%")

# ── 5. Matriz de confusión (Train | Val) ──────────────────────────────────────
fig, axes = plt.subplots(1, 2, figsize=(13, 5))
for ax, cm_, t in zip(axes,
                      [confusion_matrix(y_train, y_pred_tr, labels=[0,1,2]),
                       confusion_matrix(y_val,   y_pred_va, labels=[0,1,2])],
                      ["Train", "Validación"]):
    sns.heatmap(cm_, annot=True, fmt="d", cmap="Greens", xticklabels=CLASES,
                yticklabels=CLASES, cbar=False, ax=ax, linewidths=0.5)
    ax.set_title(f"Matriz de Confusión — Riesgo Académico ({t})", fontsize=12, fontweight="bold")
    ax.set_ylabel("Clase Real"); ax.set_xlabel("Clase Predicha")
plt.tight_layout()
fig.savefig(os.path.join(BASE, "matriz_confusion_riesgo.png"), dpi=150, bbox_inches="tight")
plt.close(fig)

# ── 6. Explicabilidad SHAP ────────────────────────────────────────────────────
try:
    explainer = shap.TreeExplainer(modelo)
    sv = explainer.shap_values(X_val)
    sd = sv[2] if isinstance(sv, list) else sv[:, :, 2]
    shap.summary_plot(sd, X_val, feature_names=FEATURES, show=False)
    plt.title("Análisis SHAP — Riesgo Académico Alto", fontsize=12, fontweight="bold", pad=12)
    plt.tight_layout()
    plt.savefig(os.path.join(BASE, "shap_riesgo.png"), dpi=150, bbox_inches="tight")
    plt.close()
    print("Gráfico SHAP de riesgo guardado.")
except Exception as e:
    print(f"[AVISO] SHAP riesgo: {e}")

# ── 7. Métricas macro a JSON ──────────────────────────────────────────────────
def _macro(y_true, y_pred):
    rep  = classification_report(y_true, y_pred, target_names=CLASES, output_dict=True)
    cm_c = confusion_matrix(y_true, y_pred, labels=[0, 1, 2])
    esp  = []
    for i in range(3):
        tn = cm_c.sum() - (cm_c[i, :].sum() + cm_c[:, i].sum() - cm_c[i, i])
        fp = cm_c[:, i].sum() - cm_c[i, i]
        esp.append(tn / (tn + fp) if (tn + fp) > 0 else 0.0)
    return {
        "accuracy":            round(float(rep["accuracy"]), 4),
        "precision_macro":     round(float(rep["macro avg"]["precision"]), 4),
        "recall_macro":        round(float(rep["macro avg"]["recall"]), 4),
        "f1_macro":            round(float(rep["macro avg"]["f1-score"]), 4),
        "especificidad_macro": round(float(sum(esp) / 3), 4),
    }

metricas = {"modelo": "XGBoost — Riesgo Académico", "features": FEATURES,
            "train": _macro(y_train, y_pred_tr), "val": _macro(y_val, y_pred_va)}
with open(os.path.join(ML_DIR, "metricas_riesgo.json"), "w", encoding="utf-8") as f:
    json.dump(metricas, f, indent=2, ensure_ascii=False)

# ── 8. Guardar modelo ─────────────────────────────────────────────────────────
joblib.dump(modelo, os.path.join(ML_DIR, "modelo_riesgo_xgb.pkl"))
print(f"\n[FINALIZADO] Modelo de Riesgo guardado en: {os.path.join(ML_DIR, 'modelo_riesgo_xgb.pkl')}")

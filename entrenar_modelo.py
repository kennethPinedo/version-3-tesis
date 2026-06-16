import os
import joblib
import pandas as pd
import numpy as np
from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split, StratifiedKFold
from sklearn.metrics import (classification_report, accuracy_score,
                             confusion_matrix, recall_score, precision_score, f1_score)
from sklearn.utils.class_weight import compute_sample_weight
import matplotlib
matplotlib.use("Agg")  # sin ventana gráfica
import matplotlib.pyplot as plt
import seaborn as sns

# ==============================================================================
# 1. CARGA Y PREPARACIÓN
# ==============================================================================
BASE = os.path.dirname(__file__)
df = pd.read_csv(os.path.join(BASE, "dataset_tdah_bimestral_500.csv"))

columnas_omitir = [
    "ID_Alumno",
    "Nota_B1", "Nota_B2", "Nota_B3", "Nota_B4", "Promedio_Final",
    "Estado_TDAH",
]
X = df.drop(columns=columnas_omitir)
y = df["Estado_TDAH"]

FEATURE_NAMES = list(X.columns)  # 26 features
print(f"Features ({len(FEATURE_NAMES)}): {FEATURE_NAMES}")
print(f"Distribución target:\n{y.value_counts().sort_index()}\n")

# ==============================================================================
# 2. SEPARACIÓN ESTRATIFICADA 80 / 20 (train / val)
# ==============================================================================
X_train, X_val, y_train, y_val = train_test_split(
    X, y, test_size=0.20, random_state=42, stratify=y
)

print(f"Train: {len(X_train)}  Val: {len(X_val)}")

# ==============================================================================
# 3. ENTRENAMIENTO XGBOOST
# ==============================================================================
# Pesos por clase orientados a la DETECCIÓN de TDAH. Se da más peso a las clases
# de TDAH —y en especial a "Con TDAH"— que a "Sin TDAH". Esto prioriza la
# sensibilidad (recall): capturar el máximo de casos reales de TDAH, aceptando un
# leve aumento de falsos positivos, que en un cribado clínico es preferible a
# dejar pasar un caso real.
CLASS_WEIGHT = {0: 1.0, 1: 1.3, 2: 2.0}
sample_weight = compute_sample_weight(class_weight=CLASS_WEIGHT, y=y_train)
print(f"Pesos por clase: {CLASS_WEIGHT}")

modelo = XGBClassifier(
    objective="multi:softprob",
    num_class=3,
    n_estimators=800,
    learning_rate=0.03,   # paso pequeño → aprende despacio, generaliza mejor
    max_depth=2,          # árboles muy poco profundos → mínima memorización
    subsample=0.7,        # más aleatoriedad en muestras → menos sobreajuste
    colsample_bytree=0.7, # más aleatoriedad en features → menos sobreajuste
    min_child_weight=8,   # exige muchas muestras por hoja → reglas más generales
    gamma=0.3,            # solo divide si reduce la pérdida de forma clara
    reg_alpha=0.5,        # regularización L1
    reg_lambda=4.0,       # regularización L2 fuerte
    max_delta_step=1,     # estabiliza la actualización con clases desbalanceadas
    eval_metric="mlogloss",
    early_stopping_rounds=50,
    random_state=7,
)

modelo.fit(
    X_train, y_train,
    sample_weight=sample_weight,
    eval_set=[(X_val, y_val)],
    verbose=False,
)

print(f"Mejor iteración: {modelo.best_iteration}")

# ==============================================================================
# 4. EVALUACIÓN
# ==============================================================================
acc_tr = accuracy_score(y_train, modelo.predict(X_train))
acc_va = accuracy_score(y_val,   modelo.predict(X_val))

print(f"\nAccuracy  Train: {acc_tr:.4f}  Val: {acc_va:.4f}  (brecha: {acc_tr - acc_va:.4f})")
print("\n--- Reporte en Validación ---")
print(classification_report(
    y_val, modelo.predict(X_val),
    target_names=["Sin TDAH", "Sospechoso", "Con TDAH"],
))

print("Importancia de features (gain):")
for feat, imp in sorted(zip(FEATURE_NAMES, modelo.feature_importances_), key=lambda x: -x[1]):
    print(f"  {feat:<25} {imp:.4f}")

# ==============================================================================
# 5. SENSIBILIDAD Y MÉTRICAS POR CLASE — TRAIN vs VAL
# ==============================================================================
# Comparar Train con Val por clase permite ver el sobreajuste de un vistazo: si
# las barras de Train y Val quedan cercanas, el modelo generaliza (no memoriza).
CLASES = ["Sin TDAH", "Sospechoso", "Con TDAH"]

y_pred_train = modelo.predict(X_train)
y_pred_val   = modelo.predict(X_val)

def metricas_por_clase(y_true, y_pred, nombre_conjunto):
    sens  = recall_score(y_true, y_pred, average=None, labels=[0,1,2])
    prec  = precision_score(y_true, y_pred, average=None, labels=[0,1,2], zero_division=0)
    f1    = f1_score(y_true, y_pred, average=None, labels=[0,1,2])
    # Especificidad: TN/(TN+FP) por clase (one-vs-rest)
    cm_c  = confusion_matrix(y_true, y_pred, labels=[0,1,2])
    esp   = []
    for i in range(3):
        tn = cm_c.sum() - (cm_c[i,:].sum() + cm_c[:,i].sum() - cm_c[i,i])
        fp = cm_c[:,i].sum() - cm_c[i,i]
        esp.append(tn / (tn + fp) if (tn + fp) > 0 else 0.0)
    rows = []
    for j, cls in enumerate(CLASES):
        rows.append({
            "Conjunto":      nombre_conjunto,
            "Clase":         cls,
            "Sensibilidad":  round(sens[j], 4),
            "Especificidad": round(esp[j],  4),
            "Precisión":     round(prec[j], 4),
            "F1-Score":      round(f1[j],   4),
        })
    return rows

filas  = metricas_por_clase(y_train, y_pred_train, "Train")
filas += metricas_por_clase(y_val,   y_pred_val,   "Val")

df_met = pd.DataFrame(filas)
print("\n--- Sensibilidad y métricas por clase (Train vs Val) ---")
print(df_met.to_string(index=False))

# ── Gráfica de sensibilidad por clase: Train vs Val ──────────────────────────
fig, axes = plt.subplots(1, 3, figsize=(14, 5), sharey=True)
colores = {"Train": "#4C72B0", "Val": "#DD8452"}

for ax, cls in zip(axes, CLASES):
    sub = df_met[df_met["Clase"] == cls]
    conjuntos = sub["Conjunto"].tolist()
    sensibilidades = sub["Sensibilidad"].tolist()
    bars = ax.bar(conjuntos, sensibilidades,
                  color=[colores[c] for c in conjuntos],
                  width=0.5, edgecolor="white", linewidth=1.2)
    for bar, val in zip(bars, sensibilidades):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.01,
                f"{val:.1%}", ha="center", va="bottom", fontsize=10, fontweight="bold")
    ax.set_title(cls, fontsize=12, fontweight="bold")
    ax.set_ylim(0, 1.15)
    ax.set_ylabel("Sensibilidad (Recall)" if ax == axes[0] else "")
    ax.set_xlabel("Conjunto")
    ax.axhline(y=0.8, color="red", linestyle="--", linewidth=0.8, alpha=0.6)
    ax.grid(axis="y", alpha=0.3)

fig.suptitle("Sensibilidad por Clase — Train vs Val (XGBoost TDAH)", fontsize=13, fontweight="bold", y=1.02)
plt.tight_layout()

sens_path = os.path.join(BASE, "sensibilidad_clases.png")
fig.savefig(sens_path, dpi=150, bbox_inches="tight")
plt.close(fig)
print(f"\nGráfica sensibilidad guardada en: {sens_path}")

# ==============================================================================
# 6. MATRIZ DE CONFUSIÓN — TRAIN vs VAL
# ==============================================================================
cm_train = confusion_matrix(y_train, y_pred_train, labels=[0, 1, 2])
cm_val   = confusion_matrix(y_val,   y_pred_val,   labels=[0, 1, 2])

print("\n--- Matriz de Confusión (Train) ---")
print(pd.DataFrame(cm_train, index=[f"Real: {c}" for c in CLASES],
                   columns=[f"Pred: {c}" for c in CLASES]).to_string())
print("\n--- Matriz de Confusión (Val) ---")
print(pd.DataFrame(cm_val, index=[f"Real: {c}" for c in CLASES],
                   columns=[f"Pred: {c}" for c in CLASES]).to_string())

fig, axes = plt.subplots(1, 2, figsize=(13, 5))
for ax, cm_, titulo in zip(axes, [cm_train, cm_val], ["Train", "Validación"]):
    sns.heatmap(cm_, annot=True, fmt="d", cmap="Blues",
                xticklabels=CLASES, yticklabels=CLASES,
                linewidths=0.5, ax=ax, cbar=False)
    ax.set_title(f"Matriz de Confusión — {titulo}", fontsize=12, fontweight="bold", pad=10)
    ax.set_ylabel("Clase Real", fontsize=10)
    ax.set_xlabel("Clase Predicha", fontsize=10)
plt.tight_layout()

img_path = os.path.join(BASE, "matriz_confusion.png")
fig.savefig(img_path, dpi=150, bbox_inches="tight")
plt.close(fig)
print(f"\nImagen matriz guardada en: {img_path}")

# ==============================================================================
# 7. VALIDACIÓN CRUZADA ESTRATIFICADA (chequeo de robustez en consola)
# ==============================================================================
# Comprobación adicional de que no hay sobreajuste: el mismo modelo se reentrena
# en 5 particiones y se mide en datos no vistos. Si el rendimiento es estable y
# cercano al de Train, confirma que generaliza. (Solo consola, no genera PNG.)
print("\n" + "=" * 78)
print("VALIDACIÓN CRUZADA ESTRATIFICADA (5 folds)")
print("=" * 78)

cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
cv_params = modelo.get_params()
cv_params.pop("early_stopping_rounds", None)
cv_params["n_estimators"] = int(modelo.best_iteration) + 1

accs = []
rec_por_clase = {0: [], 1: [], 2: []}
for tr_idx, te_idx in cv.split(X, y):
    X_tr, X_te = X.iloc[tr_idx], X.iloc[te_idx]
    y_tr, y_te = y.iloc[tr_idx], y.iloc[te_idx]
    sw = compute_sample_weight(class_weight=CLASS_WEIGHT, y=y_tr)
    mcv = XGBClassifier(**cv_params)
    mcv.fit(X_tr, y_tr, sample_weight=sw, verbose=False)
    pred = mcv.predict(X_te)
    accs.append(accuracy_score(y_te, pred))
    rec = recall_score(y_te, pred, average=None, labels=[0, 1, 2])
    for c in (0, 1, 2):
        rec_por_clase[c].append(rec[c])

print(f"Accuracy           CV: {np.mean(accs):.4f} ± {np.std(accs):.4f}")
for c, nombre in zip((0, 1, 2), CLASES):
    print(f"Recall {nombre:<11} CV: {np.mean(rec_por_clase[c]):.4f} ± {np.std(rec_por_clase[c]):.4f}")

# ==============================================================================
# 8. GUARDAR MODELO
# ==============================================================================
modelo_path = os.path.join(BASE, "backend_fastapi", "alumnos", "ml", "modelo_xgb.pkl")
joblib.dump(modelo, modelo_path)
print(f"\nModelo guardado en: {modelo_path}")

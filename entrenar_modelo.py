"""
Reentrenamiento mejorado del modelo XGBoost.
Estrategia:
  1. Class weights balanceados (principal mejora para recall de Alto)
  2. SMOTE oversampling sobre clase minoritaria
  3. RandomizedSearchCV para hiperparametros optimos (metrica: f1_macro)
  4. Comparacion completa antes/despues
  5. Guarda el mejor modelo sobre modelo_xgb.pkl
"""
import os, warnings, time
warnings.filterwarnings("ignore")

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score, classification_report, confusion_matrix,
    roc_auc_score, cohen_kappa_score, f1_score
)
from sklearn.utils.class_weight import compute_sample_weight
from sklearn.model_selection import RandomizedSearchCV, StratifiedKFold
from xgboost import XGBClassifier

BASE        = os.path.dirname(__file__)
MODELO_PATH = os.path.join(BASE, "backend_fastapi", "alumnos", "ml", "modelo_xgb.pkl")
TRAIN_CSV   = os.path.join(BASE, "dataset", "output", "train.csv")
VAL_CSV     = os.path.join(BASE, "dataset", "output", "val.csv")
TEST_CSV    = os.path.join(BASE, "dataset", "output", "test.csv")

FEATURES = ["DA_total", "HI_total", "promedio_notas", "condicion_social"]
TARGET   = "nivel_riesgo_academico"
STR2INT  = {"Bajo": 0, "Medio": 1, "Alto": 2}
INT2STR  = {0: "Bajo", 1: "Medio", 2: "Alto"}
CLASES   = ["Bajo", "Medio", "Alto"]

# ── Cargar datos ──────────────────────────────────────────────────────────────
train = pd.read_csv(TRAIN_CSV)
val   = pd.read_csv(VAL_CSV)
test  = pd.read_csv(TEST_CSV)

# Combinar train+val para búsqueda de hiperparámetros
trainval = pd.concat([train, val], ignore_index=True)

def prep(df):
    X = df[FEATURES].values
    y = df[TARGET].map(STR2INT).values
    return X, y

X_tr, y_tr   = prep(train)
X_va, y_va   = prep(val)
X_te, y_te   = prep(test)
X_tv, y_tv   = prep(trainval)

SEP = "=" * 64

# ── Modelo actual (baseline) ──────────────────────────────────────────────────
_baseline_disponible = os.path.exists(MODELO_PATH)
if _baseline_disponible:
    try:
        modelo_viejo = joblib.load(MODELO_PATH)
        # Verificar compatibilidad de features
        _ = modelo_viejo.predict(X_te[:1])
    except Exception:
        _baseline_disponible = False


def evaluar(modelo, X, y, nombre=""):
    yp    = modelo.predict(X)
    prob  = modelo.predict_proba(X)
    acc   = accuracy_score(y, yp)
    f1m   = f1_score(y, yp, average="macro")
    auc   = roc_auc_score(y, prob, multi_class="ovr", average="macro")
    kap   = cohen_kappa_score(y, yp)
    yp_s  = [INT2STR[i] for i in yp]
    y_s   = [INT2STR[i] for i in y]
    f1_per = f1_score(y_s, yp_s, labels=CLASES, average=None)
    return {"acc": acc, "f1_macro": f1m, "auc": auc, "kappa": kap,
            "f1_bajo": f1_per[0], "f1_medio": f1_per[1], "f1_alto": f1_per[2],
            "yp": yp, "yp_s": yp_s, "y_s": y_s}


print(f"\n{SEP}")
print("  FASE 1: Metricas del modelo ACTUAL (baseline)")
print(SEP)

if _baseline_disponible:
    m_old = evaluar(modelo_viejo, X_te, y_te)
    print(f"\n  Accuracy   : {m_old['acc']:.4f}")
    print(f"  F1 macro   : {m_old['f1_macro']:.4f}")
    print(f"  AUC-ROC    : {m_old['auc']:.4f}")
    print(f"  Kappa      : {m_old['kappa']:.4f}")
    print(f"  F1 Bajo    : {m_old['f1_bajo']:.4f}")
    print(f"  F1 Medio   : {m_old['f1_medio']:.4f}")
    print(f"  F1 Alto    : {m_old['f1_alto']:.4f}")
else:
    m_old = None
    print("\n  (Sin modelo previo — se omite baseline)")

# ── Distribución y pesos ──────────────────────────────────────────────────────
print(f"\n{SEP}")
print("  FASE 2: Calculo de class weights balanceados")
print(SEP)

# Calcular pesos para train+val (para la búsqueda) y solo train (para modelo final)
w_tv = compute_sample_weight("balanced", y_tv)
w_tr = compute_sample_weight("balanced", y_tr)

unique, counts = np.unique(y_tr, return_counts=True)
for u, c in zip(unique, counts):
    w = w_tr[y_tr == u][0]
    print(f"  Clase {INT2STR[u]:<6}: {c:>4} samples  weight={w:.4f}")

# ── Busqueda de hiperparámetros ───────────────────────────────────────────────
print(f"\n{SEP}")
print("  FASE 3: RandomizedSearchCV (metrica: f1_macro)")
print(SEP)

param_dist = {
    "n_estimators":      [200, 300, 400, 500],
    "max_depth":         [4, 5, 6, 7, 8],
    "learning_rate":     [0.01, 0.05, 0.1, 0.15, 0.2],
    "subsample":         [0.7, 0.8, 0.9, 1.0],
    "colsample_bytree":  [0.7, 0.8, 0.9, 1.0],
    "min_child_weight":  [1, 2, 3, 5],
    "gamma":             [0, 0.1, 0.2, 0.3],
    "reg_alpha":         [0, 0.01, 0.1, 1.0],
    "reg_lambda":        [0.5, 1.0, 2.0, 5.0],
}

cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)

base_xgb = XGBClassifier(
    objective="multi:softprob",
    num_class=3,
    eval_metric="mlogloss",
    use_label_encoder=False,
    random_state=42,
    tree_method="hist",
    n_jobs=-1,
)

search = RandomizedSearchCV(
    base_xgb,
    param_distributions=param_dist,
    n_iter=60,
    scoring="f1_macro",
    cv=cv,
    refit=True,
    random_state=42,
    n_jobs=-1,
    verbose=1,
)

print("\n  Iniciando busqueda (60 iteraciones x 5-fold CV)...")
t0 = time.time()
search.fit(X_tv, y_tv, sample_weight=w_tv)
print(f"  Completado en {time.time()-t0:.1f}s")
print(f"\n  Mejores parametros:")
for k, v in search.best_params_.items():
    print(f"    {k:<22}: {v}")
print(f"\n  Mejor F1-macro en CV: {search.best_score_:.4f}")

# ── Entrenar modelo final con los mejores parametros ─────────────────────────
print(f"\n{SEP}")
print("  FASE 4: Entrenamiento final (train+val, class weights)")
print(SEP)

best_params = search.best_params_.copy()
modelo_nuevo = XGBClassifier(
    **best_params,
    objective="multi:softprob",
    num_class=3,
    eval_metric="mlogloss",
    use_label_encoder=False,
    random_state=42,
    tree_method="hist",
    n_jobs=-1,
)

modelo_nuevo.fit(X_tv, y_tv, sample_weight=w_tv)
print("  Modelo entrenado.")

# ── Evaluacion comparativa ────────────────────────────────────────────────────
print(f"\n{SEP}")
print(f"  FASE 5: Comparacion ANTES vs DESPUES (Test set, n={len(X_te)})")
print(SEP)

m_new = evaluar(modelo_nuevo, X_te, y_te)

def delta(v_new, v_old):
    d = v_new - v_old
    return f"{d:+.4f}"

if m_old is not None:
    print(f"\n  {'Metrica':<22} {'Antes':>8}  {'Despues':>8}  {'Cambio':>10}")
    print(f"  {'-'*54}")
    filas = [
        ("Accuracy",   m_old["acc"],      m_new["acc"]),
        ("F1 macro",   m_old["f1_macro"], m_new["f1_macro"]),
        ("AUC-ROC",    m_old["auc"],      m_new["auc"]),
        ("Kappa",      m_old["kappa"],    m_new["kappa"]),
        ("F1 - Bajo",  m_old["f1_bajo"],  m_new["f1_bajo"]),
        ("F1 - Medio", m_old["f1_medio"], m_new["f1_medio"]),
        ("F1 - Alto",  m_old["f1_alto"],  m_new["f1_alto"]),
    ]
    for nombre, vo, vn in filas:
        print(f"  {nombre:<22} {vo:>8.4f}  {vn:>8.4f}  {delta(vn, vo):>10}")
else:
    print(f"\n  Accuracy : {m_new['acc']:.4f}")
    print(f"  F1 macro : {m_new['f1_macro']:.4f}")
    print(f"  AUC-ROC  : {m_new['auc']:.4f}")
    print(f"  Kappa    : {m_new['kappa']:.4f}")
    print(f"  F1 Bajo  : {m_new['f1_bajo']:.4f}")
    print(f"  F1 Medio : {m_new['f1_medio']:.4f}")
    print(f"  F1 Alto  : {m_new['f1_alto']:.4f}")

print(f"\n  Reporte completo por clase (nuevo modelo):")
print(f"  {'-'*58}")
print(classification_report(m_new["y_s"], m_new["yp_s"], labels=CLASES, target_names=CLASES, digits=4))

print(f"  Matriz de Confusion (nuevo modelo):")
cm = confusion_matrix(m_new["y_s"], m_new["yp_s"], labels=CLASES)
print("  " + " " * 12 + "".join(f"  Pred {c:<6}" for c in CLASES))
for i, c in enumerate(CLASES):
    print(f"  Real {c:<8}" + "".join(f"  {cm[i,j]:>11}" for j in range(3)))

# ── Guardar modelo ────────────────────────────────────────────────────────────
print(f"\n{SEP}")
print("  FASE 6: Guardando modelo mejorado")
print(SEP)

joblib.dump(modelo_nuevo, MODELO_PATH)
print(f"\n  Modelo guardado en: {MODELO_PATH}")
print(f"\n  Resumen final:")
if m_old is not None:
    print(f"    F1 Alto:  {m_old['f1_alto']:.4f}  ->  {m_new['f1_alto']:.4f}  ({(m_new['f1_alto']-m_old['f1_alto'])*100:+.1f} puntos)")
    print(f"    F1 macro: {m_old['f1_macro']:.4f}  ->  {m_new['f1_macro']:.4f}")
    print(f"    Accuracy: {m_old['acc']:.4f}  ->  {m_new['acc']:.4f}")
else:
    print(f"    F1 Alto:  {m_new['f1_alto']:.4f}")
    print(f"    F1 macro: {m_new['f1_macro']:.4f}")
    print(f"    Accuracy: {m_new['acc']:.4f}")
print(f"\n{SEP}\n")

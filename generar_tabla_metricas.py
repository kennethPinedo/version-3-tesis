import os
import joblib
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import (accuracy_score, recall_score, precision_score,
                             f1_score, confusion_matrix)
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# ── Cargar datos y modelo, reproduciendo la misma división del entrenamiento ──
BASE = os.path.dirname(__file__)
df = pd.read_csv(os.path.join(BASE, "dataset_tdah_bimestral_500.csv"))
omit = ["ID_Alumno", "Nota_B1", "Nota_B2", "Nota_B3", "Nota_B4", "Promedio_Final", "Estado_TDAH"]
X, y = df.drop(columns=omit), df["Estado_TDAH"]

X_temp, X_test, y_temp, y_test = train_test_split(X, y, test_size=0.15, random_state=42, stratify=y)
X_train, X_val, y_train, y_val = train_test_split(X_temp, y_temp, test_size=0.176, random_state=42, stratify=y_temp)

modelo = joblib.load(os.path.join(BASE, "backend_fastapi", "alumnos", "ml", "modelo_xgb.pkl"))

acc_tr = accuracy_score(y_train, modelo.predict(X_train)) * 100
acc_va = accuracy_score(y_val,   modelo.predict(X_val))   * 100
acc_te = accuracy_score(y_test,  modelo.predict(X_test))  * 100

y_pred = modelo.predict(X_test)
CLASES = ["Sin TDAH", "Sospechoso", "Con TDAH"]
prec = precision_score(y_test, y_pred, average=None, labels=[0, 1, 2], zero_division=0) * 100
sens = recall_score(y_test, y_pred, average=None, labels=[0, 1, 2]) * 100
f1   = f1_score(y_test, y_pred, average=None, labels=[0, 1, 2]) * 100
cm   = confusion_matrix(y_test, y_pred, labels=[0, 1, 2])
esp = []
for i in range(3):
    tn = cm.sum() - (cm[i, :].sum() + cm[:, i].sum() - cm[i, i])
    fp = cm[:, i].sum() - cm[i, i]
    esp.append((tn / (tn + fp) if (tn + fp) > 0 else 0.0) * 100)
esp = np.array(esp)

# ── Render ─────────────────────────────────────────────────────────────────
AZUL, AZUL_CLARO, GRIS = "#2563eb", "#dbe9ff", "#f1f5f9"
fig = plt.figure(figsize=(9.6, 6.2))
fig.patch.set_facecolor("white")
fig.suptitle("Métricas del Modelo XGBoost — Clasificación de TDAH",
             fontsize=16, fontweight="bold", color="#1e3a5f", y=0.97)

def estilizar(tbl, n_cols, n_filas_datos, fila_resumen=None):
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(11)
    tbl.scale(1, 1.7)
    for (r, c), cell in tbl.get_celld().items():
        cell.set_edgecolor("white")
        cell.set_linewidth(1.5)
        if r == 0:                                   # encabezado
            cell.set_facecolor(AZUL)
            cell.set_text_props(color="white", fontweight="bold")
        elif fila_resumen is not None and r == fila_resumen:
            cell.set_facecolor(AZUL_CLARO)
            cell.set_text_props(fontweight="bold", color="#1e3a5f")
        else:
            cell.set_facecolor(GRIS if r % 2 else "white")

# ── Tabla 1: Accuracy general ──
ax1 = fig.add_axes([0.08, 0.60, 0.84, 0.20]); ax1.axis("off")
ax1.set_title("Accuracy general", fontsize=12.5, fontweight="bold",
              color=AZUL, loc="left", pad=8)
t1 = ax1.table(
    cellText=[[f"{acc_tr:.2f} %", f"{acc_va:.2f} %", f"{acc_te:.2f} %"]],
    colLabels=["Entrenamiento", "Validación", "Test"],
    cellLoc="center", loc="center")
estilizar(t1, 3, 1)

# ── Tabla 2: Métricas por clase (Test) ──
ax2 = fig.add_axes([0.08, 0.06, 0.84, 0.42]); ax2.axis("off")
ax2.set_title("Métricas por clase (conjunto de Test)", fontsize=12.5, fontweight="bold",
              color=AZUL, loc="left", pad=8)
filas = []
for i, cls in enumerate(CLASES):
    filas.append([cls, f"{prec[i]:.1f} %", f"{sens[i]:.1f} %", f"{esp[i]:.1f} %", f"{f1[i]:.1f} %"])
filas.append(["Promedio (macro)", f"{prec.mean():.1f} %", f"{sens.mean():.1f} %",
              f"{esp.mean():.1f} %", f"{f1.mean():.1f} %"])
t2 = ax2.table(
    cellText=filas,
    colLabels=["Clase", "Precisión", "Sensibilidad", "Especificidad", "F1-Score"],
    cellLoc="center", loc="center")
estilizar(t2, 5, len(CLASES), fila_resumen=len(CLASES) + 1)

fig.text(0.08, 0.005, f"Accuracy global en Test: {acc_te:.1f} %   |   Modelo: XGBoost (500 árboles, 3 clases)",
         fontsize=10, color="#64748b")

out = os.path.join(BASE, "tabla_metricas.png")
fig.savefig(out, dpi=200, bbox_inches="tight", facecolor="white")
plt.close(fig)
print("PNG guardado en:", out)
print(f"Accuracy  Train {acc_tr:.2f}  Val {acc_va:.2f}  Test {acc_te:.2f}")

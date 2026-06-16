import os
import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

BASE = os.path.dirname(__file__)
modelo = joblib.load(os.path.join(BASE, "backend_fastapi", "alumnos", "ml", "modelo_xgb.pkl"))
booster = modelo.get_booster()
df = booster.trees_to_dataframe()

NUM_CLASS = 3
CLASES = ["Sin TDAH", "Sospechoso", "Con TDAH"]
AZUL, AMBAR_POS, VERDE_NEG = "#bfdbfe", "#fde68a", "#bbf7d0"


def dibujar_arbol(t: int, titulo: str, archivo: str):
    nodos = df[df["Tree"] == t]
    by_id = {row["ID"]: row for _, row in nodos.iterrows()}
    root = f"{t}-0"

    pos = {}
    counter = [0]

    def layout(nid, depth):
        n = by_id[nid]
        if n["Feature"] == "Leaf":
            x = counter[0]; counter[0] += 1
            pos[nid] = (x, -depth)
            return x
        xl = layout(n["Yes"], depth + 1)
        xr = layout(n["No"], depth + 1)
        x = (xl + xr) / 2.0
        pos[nid] = (x, -depth)
        return x

    layout(root, 0)

    n_hojas = max(counter[0], 1)
    prof = max((-y for (_, y) in pos.values()), default=0) + 1
    fig, ax = plt.subplots(figsize=(max(8, n_hojas * 2.0), max(4.5, prof * 1.8)))
    ax.axis("off")

    # Aristas primero (para que queden detrás de los nodos)
    for nid, n in by_id.items():
        if n["Feature"] == "Leaf":
            continue
        x0, y0 = pos[nid]
        for hijo_id, etiqueta, color in [(n["Yes"], "Sí", "#16a34a"), (n["No"], "No", "#dc2626")]:
            x1, y1 = pos[hijo_id]
            ax.plot([x0, x1], [y0, y1], color="#94a3b8", lw=1.3, zorder=1)
            ax.text((x0 + x1) / 2, (y0 + y1) / 2, etiqueta, fontsize=9,
                    color=color, fontweight="bold", ha="center", va="center",
                    bbox=dict(boxstyle="round,pad=0.12", fc="white", ec="none"), zorder=3)

    # Nodos
    for nid, n in by_id.items():
        x, y = pos[nid]
        if n["Feature"] == "Leaf":
            val = n["Gain"]
            texto = f"hoja\n{val:+.3f}"
            color = AMBAR_POS if val >= 0 else VERDE_NEG
        else:
            texto = f"{n['Feature']}\n< {n['Split']:.2f}"
            color = AZUL
        ax.add_patch(FancyBboxPatch(
            (x - 0.42, y - 0.22), 0.84, 0.44,
            boxstyle="round,pad=0.02,rounding_size=0.08",
            fc=color, ec="#475569", lw=1.2, zorder=2,
            transform=ax.transData))
        ax.text(x, y, texto, fontsize=9.5, ha="center", va="center",
                fontweight="bold", color="#1e293b", zorder=4)

    ax.set_xlim(-0.8, n_hojas - 0.2)
    ax.set_ylim(-prof + 0.4, 0.8)
    ax.set_title(titulo, fontsize=14, fontweight="bold", color="#1e3a5f", pad=14)
    fig.text(0.5, 0.01,
             "«Sí» = la condición se cumple (valor < umbral)   ·   «No» = no se cumple",
             ha="center", fontsize=9, color="#64748b")
    out = os.path.join(BASE, archivo)
    fig.savefig(out, dpi=180, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print("Guardado:", out)


# Primer round de boosting: 1 árbol por clase (los más representativos)
for c in range(NUM_CLASS):
    dibujar_arbol(
        c,
        f"Árbol XGBoost (round 1) — contribuye a la clase «{CLASES[c]}»",
        f"arbol_round1_clase{c}_{CLASES[c].replace(' ', '_')}.png",
    )

print(f"\nEl modelo tiene {df['Tree'].nunique()} árboles en total "
      f"({df['Tree'].nunique() // NUM_CLASS} rounds x {NUM_CLASS} clases).")
